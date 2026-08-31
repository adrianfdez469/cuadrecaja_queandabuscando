#!/usr/bin/env bash
# Verificación en runtime de F-026 (selector de categorías y vista por
# categoría). La ejecuta `bash .agent/verify.sh F-026 --smoke` con `next dev`
# ya levantado en $SMOKE_BASE_URL, contra la base real de docker-compose.yml
# (`npm run seed` ya corrido) y con QAB_BEARER_TOKEN (el token de
# seed-negocio-1, F-018) en el entorno.
#
# Cubre los criterios 1-11 y 14, y V9 (el enlace de salida del 404 de
# categoría). Los criterios 12, 13 y 15 se verifican con `npm run build`,
# `node scripts/check-bundle-budget.mjs` y el propio `verify.sh --full`, no
# aquí. Copiado con criterio de `.agent/specs/F-017/smoke.sh` (los helpers
# `check`/`code`/`body`/`contains`/`json_field`/`sync_token`) — no lo importa,
# porque son features distintos y su propio guion tiene que seguir pasando
# tal cual.
#
# Regla de datos: TODO lo que este guion crea o cambia por sync usa un
# `externalId` con sufijo de timestamp (`smoke-*-$SUFFIX`), nunca los
# nombres de la fixture original (`tienda-demo`, `Bebidas`, `Alimentos`,
# `Aseo`, `Panadería`, ni ninguno de sus 28 StoreProduct). Mutar la fixture
# de la base compartida para probar un criterio y no poder deshacerlo
# limpiamente es exactamente el error que costó una hora de reparación
# manual la primera vez que se escribió este guion (tests.md § Fallos
# encontrados) — de ahí la regla, no una preferencia de estilo. Cada
# categoría/producto sintético que crea queda en la base al terminar
# (aditivo, igual que `smoke-nueva-*` en F-017): no rompe ninguna otra
# aserción porque toda comprobación de aquí usa `contains`, nunca un conteo
# exacto de "cuántas categorías tiene tienda-demo".
#
# Nunca se verifica una revalidación con `psql`: toda escritura de este
# guion pasa por el endpoint del sync, y solo entonces se lee la página
# pública — un `UPDATE` directo no dispara `revalidateTag` y daría un falso
# verde (AGENTS.md § Cosas que muerden). `psql` solo se usa para leer el
# slug que el sync generó (criterios 10 y 11), nunca para escribir algo que
# una página tenga que reflejar.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
SUFFIX="$(date +%s)"

check() { # check <qué se espera> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — esperaba %s, obtuve %s\n' "$1" "$2" "$3"
    FAILS=$((FAILS + 1))
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }

contains() { # contains <qué se espera> <texto> <aguja>
  if node -e '
    const [html, needle] = [process.argv[1], process.argv[2]];
    process.exit(html.includes(needle) ? 0 : 1);
  ' "$2" "$3"; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — no se encontró %s\n' "$1" "$3"
    FAILS=$((FAILS + 1))
  fi
}

not_contains() { # not_contains <qué se espera> <texto> <aguja>
  if node -e '
    const [html, needle] = [process.argv[1], process.argv[2]];
    process.exit(html.includes(needle) ? 1 : 0);
  ' "$2" "$3"; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — SÍ se encontró %s (no debía)\n' "$1" "$3"
    FAILS=$((FAILS + 1))
  fi
}

# price_of <html> <nombre-producto>  →  el texto exacto del precio de la
# tarjeta, o "" si el nombre no aparece — para el criterio 4 (carácter a
# carácter, nunca comparado a ojo).
price_of() {
  node -e '
    const [html, name] = [process.argv[1], process.argv[2]];
    const marker = `>${name}</h3>`;
    const idx = html.indexOf(marker);
    if (idx === -1) { process.stdout.write(""); process.exit(0); }
    const m = html.slice(idx, idx + 400).match(/<p class="text-brand text-base font-semibold">([^<]*)<\/p>/);
    process.stdout.write(m ? m[1] : "");
  ' "$1" "$2"
}

psql_val() { # psql_val <SQL>
  docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "$1"
}

sync_token() {
  if [ -n "${QAB_BEARER_TOKEN:-}" ]; then
    printf '%s' "$QAB_BEARER_TOKEN"
    return
  fi
  node -e '
    const fs = require("fs");
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^QAB_BEARER_TOKEN="([^"]*)"/m);
    process.stdout.write(m ? m[1] : "");
  '
}

TOKEN="$(sync_token)"

# sync_catalog <json-events-array-as-string>  →  hace el POST y devuelve el
# cuerpo. `businessId` es siempre seed-negocio-1 (Distribuidora La Rampa,
# dueño de tienda-demo/seed-tienda-1 en la base de desarrollo).
sync_catalog() {
  curl -s -X POST "$BASE/api/internal/sync/catalog" \
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
    -d "{\"businessId\":\"seed-negocio-1\",\"events\":$1}"
}

# now — milisegundos reales y estrictamente crecientes entre llamadas.
# `date` de macOS no tiene %N (nanosegundos): dos eventos de este guion que
# caigan en el mismo segundo compartirían `updatedAt` con segundo-precisión,
# y la guarda anti-rancia (`sourceUpdatedAt.getTime() >= payloadUpdatedAt.getTime()`,
# product.ts y misc.ts) trata un empate como STALE — el segundo evento del
# PAR se descartaría en silencio y el criterio "probado" no probaría nada.
# Un contador propio, sumado en milisegundos sobre la hora real, es más
# barato y más portable que instalar coreutils solo para este guion.
NOW_COUNTER=0
now() {
  NOW_COUNTER=$((NOW_COUNTER + 1))
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$NOW_COUNTER"
}

category_event() { # category_event <eventId> <operation> <categoryId> <name>
  printf '{"eventId":"%s","entity":"CATEGORY","operation":"%s","occurredAt":"%s","payload":{"categoryId":"%s","businessId":"seed-negocio-1","name":"%s","color":null,"updatedAt":"%s"}}' \
    "$1" "$2" "$(now)" "$3" "$4" "$(now)"
}

product_event() { # product_event <eventId> <storeProductId> <productId> <name> <categoryId-or-null> <price> <publishToStore>
  local cat_json
  if [ "$5" = "null" ]; then cat_json="null"; else cat_json="\"$5\""; fi
  printf '{"eventId":"%s","entity":"PRODUCT","operation":"UPDATE","occurredAt":"%s","payload":{"storeProductId":"%s","productId":"%s","businessId":"seed-negocio-1","storeId":"seed-tienda-1","localName":"%s","barcodes":[],"localCategoryId":%s,"price":%s,"currency":"CUP","canonicalProductId":null,"imageUrl":null,"publishToStore":%s,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$4" "$cat_json" "$6" "$7" "$(now)"
}

if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
fi

# --------------------------------------------------- criterio 1 ----
# tienda-demo (seed-tienda-1) trae 4 categorías con stock en la base de
# desarrollo (bebidas, alimentos, aseo, panadería) — fixture de solo
# lectura, nunca mutada por este guion.

STORE_HTML="$(body "$BASE/tienda-demo")"
check 'criterio 1 — /tienda-demo responde 200' 200 "$(code "$BASE/tienda-demo")"
contains 'criterio 1 — enlace a /tienda-demo/c/bebidas' "$STORE_HTML" 'href="/tienda-demo/c/bebidas"'
contains 'criterio 1 — enlace a /tienda-demo/c/alimentos' "$STORE_HTML" 'href="/tienda-demo/c/alimentos"'
contains 'criterio 1 — enlace a /tienda-demo/c/aseo' "$STORE_HTML" 'href="/tienda-demo/c/aseo"'
contains 'criterio 1 — enlace a /tienda-demo/c/panaderia' "$STORE_HTML" 'href="/tienda-demo/c/panaderia"'
not_contains 'criterio 1 — ninguna categoría de otro negocio (otro-negocio)' "$STORE_HTML" 'href="/tienda-demo/c/otro-negocio"'

# --------------------------------------------------- criterio 2 ----

BEBIDAS_HTML="$(body "$BASE/tienda-demo/c/bebidas")"
check 'criterio 2 — /tienda-demo/c/bebidas responde 200' 200 "$(code "$BASE/tienda-demo/c/bebidas")"
contains 'criterio 2 — trae un producto de bebidas' "$BEBIDAS_HTML" "Refresco de cola"
not_contains 'criterio 2 — NO trae un producto de aseo' "$BEBIDAS_HTML" "Jabón de baño"

# --------------------------------------------------- criterio 4 ----
# "Aceite de girasol 900 ml" tiene priceOverride en la base de desarrollo:
# el mismo precio, carácter a carácter, en /[slug] y en su categoría.

ALIMENTOS_HTML="$(body "$BASE/tienda-demo/c/alimentos")"
PRICE_SLUG="$(price_of "$STORE_HTML" "Aceite de girasol 900 ml")"
PRICE_CAT="$(price_of "$ALIMENTOS_HTML" "Aceite de girasol 900 ml")"
if [ -z "$PRICE_SLUG" ] || [ -z "$PRICE_CAT" ]; then
  printf 'SMOKE FAIL criterio 4 — no se encontró el precio de Aceite de girasol en una de las dos vistas (slug=%s cat=%s)\n' "$PRICE_SLUG" "$PRICE_CAT"
  FAILS=$((FAILS + 1))
else
  check 'criterio 4 — mismo precio carácter a carácter en /[slug] y en la categoría' "$PRICE_SLUG" "$PRICE_CAT"
fi

# --------------------------------------------------- criterio 5 ----
# bodega-uno (seed-tienda-5) solo tiene alimentos y bebidas en stock —
# "aseo" existe en el negocio pero sin producto ahí (I10): 404, igual que
# un identificador inexistente.

check 'criterio 5 — categoría del negocio sin stock en ESTA sucursal → 404' 404 "$(code "$BASE/bodega-uno/c/aseo")"
check 'criterio 5 — identificador de categoría inexistente → 404' 404 "$(code "$BASE/tienda-demo/c/no-existe-$SUFFIX")"

# --------------------------------------------------- criterio 6 ----
# el-trebol (storefront con 2 sucursales renderizables) resuelve a
# kind:selector — ninguna categoría bajo el slug de marca. tienda-cerrada
# es una marca de una sola sucursal SUSPENDED: el aviso de cerrada, para
# CUALQUIER categorySlug (incluido uno inventado) — la prueba de que el
# aviso sale ANTES de consultar el catálogo es justamente que un
# categorySlug que no existe en absoluto no produce 404 aquí.

check 'criterio 6 — slug en modo selector (el-trebol) → 404' 404 "$(code "$BASE/el-trebol/c/lo-que-sea-$SUFFIX")"
SUSPENDED_HTML="$(body "$BASE/tienda-cerrada/c/categoria-inventada-$SUFFIX")"
check 'criterio 6 — tienda SUSPENDED con categorySlug inventado → 200 (nunca 404)' 200 "$(code "$BASE/tienda-cerrada/c/categoria-inventada-$SUFFIX")"
contains 'criterio 6 — el aviso de cerrada está en el HTML (sin consulta de catálogo)' "$SUSPENDED_HTML" "Cerrado"

# --------------------------------------------------- criterio 14 ----
# curl nunca ejecuta JavaScript: seguir el enlace del selector con curl y
# encontrar los productos en el HTML de la categoría ES la prueba de E15.

check 'criterio 14 — la categoría se lee entera sin ejecutar ni un byte de JS (curl)' 200 "$(code "$BASE/tienda-demo/c/alimentos")"
contains 'criterio 14 — el nombre y el precio del producto están en el HTML servido' "$ALIMENTOS_HTML" "Aceite de girasol 900 ml"

# --------------------------------------------------- V9 ----
# El 404 de categoría conserva el marco de la tienda y su enlace de salida
# usa un href relativo (".."), no la ruta absoluta ni "../.." (impl.md §
# Desviaciones) — la resolución real del navegador ya se comprobó a mano
# con el navegador (haciendo click, con JavaScript activo) y aterriza en
# /tienda-demo, no en "/".
#
# Lo que este bloque comprueba es distinto y más estricto: si esa cabecera y
# ese enlace llegan como HTML de verdad en la respuesta del servidor —sin
# depender de que el cliente ejecute React para pintarlos— o si, como pasa
# hoy, SOLO viajan dentro del payload de React Flight que Next serializa
# para hidratar (`grep -c '<a '` es 0 en la respuesta cruda de CUALQUIER
# `notFound()` de esta app, no solo el de este feature: se comprobó también
# contra `/[slug]/pedido/[code]/not-found.tsx`, que este archivo dice haber
# calcado, y contra el 404 global). Es un hallazgo de este ciclo de
# pruebas, PRE-EXISTENTE y transversal a toda la app — no lo introduce
# F-026 y ninguno de sus 15 criterios lo exige tal cual está escrito — pero
# si algún día un `notFound()` SÍ vuelve a servir HTML real, este bloque
# debe empezar a pasar solo, y si un día deja de servir ni el texto, hay
# que enterarse. Ver tests.md § Fallos encontrados.

NOTFOUND_HTML="$(body "$BASE/tienda-demo/c/categoria-que-no-existe-$SUFFIX")"
check 'V9 — 404 de categoría responde 404' 404 "$(code "$BASE/tienda-demo/c/categoria-que-no-existe-$SUFFIX")"
contains 'V9 — el texto de la cabecera de la tienda llega en la respuesta (como HTML real o, hoy, dentro del payload de hidratación)' "$NOTFOUND_HTML" "La Rampa"
# El payload de React Flight va embebido como literal de cadena JS dentro
# del HTML: sus comillas llegan escapadas con una barra invertida de
# verdad (`\"href\":\"..\"`), no como `"href":".."` sin escapar — de ahí la
# aguja tal cual.
contains 'V9 — el href de salida (".." ) llega en la respuesta (como HTML real o, hoy, dentro del payload de hidratación)' "$NOTFOUND_HTML" '\"href\":\"..\"'
NOTFOUND_REAL_ANCHOR="$(printf '%s' "$NOTFOUND_HTML" | grep -c '<a ')"
if [ "$NOTFOUND_REAL_ANCHOR" -gt 0 ]; then
  printf '  ok   V9 (más estricto que hoy) — el 404 de categoría SÍ trae un <a> real, navegable sin JavaScript\n'
else
  printf 'CONOCIDO V9 — el 404 de categoría NO trae ningún <a> real en el HTML crudo (0 en grep -c "<a "): sin JavaScript, un comprador que llega aquí no tiene forma de volver al catálogo desde este enlace. Pre-existente y transversal (afecta también a /[slug]/pedido/[code]/not-found.tsx y al 404 global de la app) — no es un fallo nuevo de F-026, así que no suma a FAILS, pero tests.md lo reporta a sdd-architect.\n'
fi

# =============================================================== escritura por sync ===
# A partir de aquí, todo lo que se crea o cambia usa un externalId propio de
# esta corrida ($SUFFIX): nunca los nombres de la fixture original.

if [ -n "$TOKEN" ]; then
  # --------------------------------------------------- criterio 3 ----
  # Un producto sintético, en una categoría sintética, propios de esta
  # corrida — nunca "Jabón de baño" ni "Aseo".

  CAT3="smoke-cat3-$SUFFIX"
  PROD3="smoke-prod3-$SUFFIX"
  R="$(sync_catalog "[$(category_event "evt-c3-cat-$SUFFIX" CREATE "$CAT3" "Smoke Categoria Tres $SUFFIX"),$(product_event "evt-c3-prod-$SUFFIX" "$PROD3" "smoke-canon-3-$SUFFIX" "Smoke Producto Visible $SUFFIX" "$CAT3" 100 true)]")"
  CAT3_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT3'")"
  if [ -z "$CAT3_SLUG" ]; then
    printf 'SMOKE FAIL criterio 3 — el sync no creó la categoría sintética (%s)\n' "$R"
    FAILS=$((FAILS + 1))
  else
    HTML_BEFORE="$(body "$BASE/tienda-demo/c/$CAT3_SLUG")"
    contains 'criterio 3 — el producto sintético aparece, visible=true' "$HTML_BEFORE" "Smoke Producto Visible $SUFFIX"

    # visible = false (publishToStore:false → soft-delete, product.ts)
    sync_catalog "[$(product_event "evt-c3-hide-$SUFFIX" "$PROD3" "smoke-canon-3-$SUFFIX" "Smoke Producto Visible $SUFFIX" "$CAT3" 100 false)]" >/dev/null
    HTML_HIDDEN="$(body "$BASE/tienda-demo/c/$CAT3_SLUG")"
    not_contains 'criterio 3 — visible=false lo quita de la vista de su categoría' "$HTML_HIDDEN" "Smoke Producto Visible $SUFFIX"

    # republicar y marcar OUT_OF_STOCK — la publicación del sync no toca
    # `visible` en el UPDATE (product.ts: "visible ... belong to the admin
    # panel"), así que hay que restaurarlo con SQL para poder seguir
    # probando el resto de este criterio; no es una revalidación que la
    # página tenga que reflejar, es la única vía para des-esconder un
    # producto fuera del panel admin, documentada en product.ts.
    sync_catalog "[$(product_event "evt-c3-show-$SUFFIX" "$PROD3" "smoke-canon-3-$SUFFIX" "Smoke Producto Visible $SUFFIX" "$CAT3" 100 true)]" >/dev/null
    psql_val "UPDATE \"StoreProduct\" SET visible = true WHERE \"externalId\"='$PROD3'" >/dev/null
    TOKEN_ID="$(psql_val "SELECT id FROM \"StoreProduct\" WHERE \"externalId\"='$PROD3'")"
    curl -s -X POST "$BASE/api/internal/sync/availability" \
      -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
      -d "{\"businessId\":\"seed-negocio-1\",\"items\":[{\"storeProductId\":\"$PROD3\",\"storeId\":\"seed-tienda-1\",\"availability\":\"OUT_OF_STOCK\"}]}" >/dev/null

    HTML_OOS="$(body "$BASE/tienda-demo/c/$CAT3_SLUG")"
    contains 'criterio 3 — OUT_OF_STOCK sigue apareciendo' "$HTML_OOS" "Smoke Producto Visible $SUFFIX"
    contains 'criterio 3 — con su distintivo de agotado' "$HTML_OOS" "Agotado"
  fi

  # --------------------------------------------------- criterio 7 ----

  CAT7="smoke-cat7-$SUFFIX"
  PROD7="smoke-prod7-$SUFFIX"
  sync_catalog "[$(category_event "evt-c7-cat-$SUFFIX" CREATE "$CAT7" "Smoke Categoria Siete $SUFFIX"),$(product_event "evt-c7-prod-$SUFFIX" "$PROD7" "smoke-canon-7-$SUFFIX" "Smoke Producto Precio $SUFFIX" "$CAT7" 100 true)]" >/dev/null
  CAT7_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT7'")"
  BEFORE_SLUG_HTML="$(body "$BASE/tienda-demo")"
  BEFORE_PRICE=$(price_of "$BEFORE_SLUG_HTML" "Smoke Producto Precio $SUFFIX")
  check 'criterio 7 (calentando) — precio inicial en /[slug]' '$100.00' "$BEFORE_PRICE"

  sync_catalog "[$(product_event "evt-c7-price-$SUFFIX" "$PROD7" "smoke-canon-7-$SUFFIX" "Smoke Producto Precio $SUFFIX" "$CAT7" 777 true)]" >/dev/null
  AFTER_SLUG_HTML="$(body "$BASE/tienda-demo")"
  AFTER_CAT_HTML="$(body "$BASE/tienda-demo/c/$CAT7_SLUG")"
  check 'criterio 7 — /[slug] muestra el precio nuevo' '$777.00' "$(price_of "$AFTER_SLUG_HTML" "Smoke Producto Precio $SUFFIX")"
  check 'criterio 7 — la vista de SU categoría también muestra el precio nuevo (no solo /[slug])' '$777.00' "$(price_of "$AFTER_CAT_HTML" "Smoke Producto Precio $SUFFIX")"

  # --------------------------------------------------- criterio 8 ----

  CAT8A="smoke-cat8a-$SUFFIX"
  CAT8B="smoke-cat8b-$SUFFIX"
  PROD8="smoke-prod8-$SUFFIX"
  sync_catalog "[$(category_event "evt-c8-cata-$SUFFIX" CREATE "$CAT8A" "Smoke Categoria Ocho A $SUFFIX"),$(category_event "evt-c8-catb-$SUFFIX" CREATE "$CAT8B" "Smoke Categoria Ocho B $SUFFIX"),$(product_event "evt-c8-prod-$SUFFIX" "$PROD8" "smoke-canon-8-$SUFFIX" "Smoke Producto Movil $SUFFIX" "$CAT8A" 50 true)]" >/dev/null
  CAT8A_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT8A'")"
  CAT8B_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT8B'")"
  contains 'criterio 8 (calentando) — el producto empieza en la categoría A' \
    "$(body "$BASE/tienda-demo/c/$CAT8A_SLUG")" "Smoke Producto Movil $SUFFIX"

  sync_catalog "[$(product_event "evt-c8-move-$SUFFIX" "$PROD8" "smoke-canon-8-$SUFFIX" "Smoke Producto Movil $SUFFIX" "$CAT8B" 50 true)]" >/dev/null
  not_contains 'criterio 8 — desaparece de la categoría anterior (A)' \
    "$(body "$BASE/tienda-demo/c/$CAT8A_SLUG")" "Smoke Producto Movil $SUFFIX"
  contains 'criterio 8 — aparece en la categoría nueva (B)' \
    "$(body "$BASE/tienda-demo/c/$CAT8B_SLUG")" "Smoke Producto Movil $SUFFIX"

  # --------------------------------------------------- criterio 9 ----

  CAT9="smoke-cat9-$SUFFIX"
  PROD9="smoke-prod9-$SUFFIX"
  sync_catalog "[$(category_event "evt-c9-cat-$SUFFIX" CREATE "$CAT9" "Smoke Categoria Nueve $SUFFIX"),$(product_event "evt-c9-prod-$SUFFIX" "$PROD9" "smoke-canon-9-$SUFFIX" "Smoke Producto Borrado $SUFFIX" "$CAT9" 40 true)]" >/dev/null
  CAT9_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT9'")"
  contains 'criterio 9 (calentando) — el selector trae la categoría antes de borrarla' \
    "$(body "$BASE/tienda-demo")" "Smoke Categoria Nueve $SUFFIX"

  sync_catalog "[$(category_event "evt-c9-del-$SUFFIX" DELETE "$CAT9" "Smoke Categoria Nueve $SUFFIX")]" >/dev/null
  not_contains 'criterio 9 — desaparece del selector' "$(body "$BASE/tienda-demo")" "Smoke Categoria Nueve $SUFFIX"
  check 'criterio 9 — su vista responde 404' 404 "$(code "$BASE/tienda-demo/c/$CAT9_SLUG")"
  contains 'criterio 9 — sus productos SIGUEN en /[slug]' "$(body "$BASE/tienda-demo")" "Smoke Producto Borrado $SUFFIX"

  # --------------------------------------------------- criterio 10 ----

  CAT10="smoke-cat10-$SUFFIX"
  PROD10="smoke-prod10-$SUFFIX"
  sync_catalog "[$(category_event "evt-c10-cat-$SUFFIX" CREATE "$CAT10" "Smoke Categoria Diez $SUFFIX"),$(product_event "evt-c10-prod-$SUFFIX" "$PROD10" "smoke-canon-10-$SUFFIX" "Smoke Producto Diez $SUFFIX" "$CAT10" 30 true)]" >/dev/null
  CAT10_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT10'")"

  sync_catalog "[$(category_event "evt-c10-ren-$SUFFIX" UPDATE "$CAT10" "Smoke Categoria Diez Renombrada $SUFFIX")]" >/dev/null
  RENAMED_HTML="$(body "$BASE/tienda-demo/c/$CAT10_SLUG")"
  check 'criterio 10 — la URL vieja sigue respondiendo 200 tras renombrar' 200 "$(code "$BASE/tienda-demo/c/$CAT10_SLUG")"
  contains 'criterio 10 — el <h1> trae el nombre nuevo' "$RENAMED_HTML" "Smoke Categoria Diez Renombrada $SUFFIX"
  contains 'criterio 10 — el selector de /[slug] también trae el nombre nuevo' \
    "$(body "$BASE/tienda-demo")" "Smoke Categoria Diez Renombrada $SUFFIX"

  # --------------------------------------------------- criterio 11 ----
  # Dos nombres que slugifican igual ("Ñame" y "name" colisionan en "name"
  # tras strip de diacríticos) — el segundo tiene que desambiguarse con
  # sufijo, y las dos URL solo listan su propio producto.

  CAT11A="smoke-cat11a-$SUFFIX"
  CAT11B="smoke-cat11b-$SUFFIX"
  PROD11A="smoke-prod11a-$SUFFIX"
  PROD11B="smoke-prod11b-$SUFFIX"
  sync_catalog "[$(category_event "evt-c11a-$SUFFIX" CREATE "$CAT11A" "Ñame $SUFFIX"),$(category_event "evt-c11b-$SUFFIX" CREATE "$CAT11B" "name $SUFFIX")]" >/dev/null
  CAT11A_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT11A'")"
  CAT11B_SLUG="$(psql_val "SELECT slug FROM \"LocalCategory\" WHERE \"externalId\"='$CAT11B'")"

  if [ "$CAT11A_SLUG" = "$CAT11B_SLUG" ] || [ -z "$CAT11A_SLUG" ] || [ -z "$CAT11B_SLUG" ]; then
    printf 'SMOKE FAIL criterio 11 — las dos categorías homónimas NO desambiguaron a slugs distintos (%s vs %s)\n' "$CAT11A_SLUG" "$CAT11B_SLUG"
    FAILS=$((FAILS + 1))
  else
    printf '  ok   criterio 11 — dos slugs distintos para nombres que colisionan (%s / %s)\n' "$CAT11A_SLUG" "$CAT11B_SLUG"
  fi

  sync_catalog "[$(product_event "evt-c11a-prod-$SUFFIX" "$PROD11A" "smoke-canon-11a-$SUFFIX" "Smoke Producto Once A $SUFFIX" "$CAT11A" 10 true),$(product_event "evt-c11b-prod-$SUFFIX" "$PROD11B" "smoke-canon-11b-$SUFFIX" "Smoke Producto Once B $SUFFIX" "$CAT11B" 20 true)]" >/dev/null

  HTML_11A="$(body "$BASE/tienda-demo/c/$CAT11A_SLUG")"
  HTML_11B="$(body "$BASE/tienda-demo/c/$CAT11B_SLUG")"
  check 'criterio 11 — la primera URL responde 200' 200 "$(code "$BASE/tienda-demo/c/$CAT11A_SLUG")"
  check 'criterio 11 — la segunda URL responde 200' 200 "$(code "$BASE/tienda-demo/c/$CAT11B_SLUG")"
  contains 'criterio 11 — la primera solo lista su propio producto (A)' "$HTML_11A" "Smoke Producto Once A $SUFFIX"
  not_contains 'criterio 11 — la primera NO lista el producto de la segunda (B)' "$HTML_11A" "Smoke Producto Once B $SUFFIX"
  contains 'criterio 11 — la segunda solo lista su propio producto (B)' "$HTML_11B" "Smoke Producto Once B $SUFFIX"
  not_contains 'criterio 11 — la segunda NO lista el producto de la primera (A)' "$HTML_11B" "Smoke Producto Once A $SUFFIX"

  # ------------------------------------------------- limpieza ----
  # Todo lo sintético de ESTA corrida (siempre con "$SUFFIX" en su
  # externalId) se borra al final, en SQL directo — nunca por sync,
  # nunca revalidado: son fixtures desechables, creadas y destruidas
  # dentro de la misma ejecución, no algo que una página tenga que
  # reflejar. Sin este bloque, cada corrida de `--smoke` deja categorías
  # y productos huérfanos para siempre y la base de desarrollo compartida
  # crece sin límite (28 StoreProduct/5 LocalCategory de hoy no
  # significarían nada la próxima vez que alguien los lea). No limpia lo
  # que dejaron corridas ANTERIORES (llevan otro sufijo) — si esta base
  # ya acumuló fixtures de una corrida vieja, se borran a mano con el
  # mismo patrón (`externalId LIKE 'smoke-%'`), una sola vez.
  psql_val "
    DELETE FROM \"StoreProduct\" WHERE \"externalId\" LIKE 'smoke-prod%-$SUFFIX';
    DELETE FROM \"LocalCategory\" WHERE \"externalId\" LIKE 'smoke-cat%-$SUFFIX';
    DELETE FROM \"CanonicalProduct\" cp
      WHERE NOT EXISTS (SELECT 1 FROM \"StoreProduct\" sp WHERE sp.\"canonicalProductId\" = cp.id)
        AND cp.name LIKE '%$SUFFIX';
  " >/dev/null
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
