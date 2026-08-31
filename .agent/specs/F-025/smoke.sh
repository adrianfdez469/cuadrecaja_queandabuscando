#!/usr/bin/env bash
# Verificación en runtime de F-025 (rastro de navegación / breadcrumb). La
# ejecuta `bash .agent/verify.sh F-025 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL, contra la base real de docker-compose.yml (`npm run seed`
# ya corrido), con QAB_BEARER_TOKEN (token de seed-negocio-1, F-018) y con
# SSO_JWT_SECRET/ADMIN_SESSION_SECRET configurados en el entorno — hacen falta
# para acuñar la cookie de admin que agrupa bodega-uno/bodega-dos (criterios
# 5, 11, 18), igual que hace `.agent/specs/F-017/smoke.sh`. Si faltan, ese
# bloque se salta con un aviso y los criterios que dependen de él quedan sin
# cubrir aquí (quedan cubiertos igual con la evidencia recogida a mano y
# documentada en tests.md).
#
# Cubre los criterios 1, 5, 6, 7, 8, 10, 11, 12, 15, 16, 17, 18, 20 y 21. Los
# criterios 2 y 9 son SOLO de navegador (--visual, V9 y V2/V11 respectivamente
# — ver .agent/specs/F-025/visual.mjs). Los criterios 3, 4, 13, 14 y 19 no son
# de runtime: 3/19 los verifica `npm run build` (SSG, no ƒ), 4 los verifica
# `grep`+`node scripts/check-bundle-budget.mjs`, 13 se midió aparte con el log
# de consultas de Prisma (`git stash` del feature para tener un "antes" real,
# `.next` limpio, mismo calentamiento en los dos lados — ver tests.md § Cómo
# se verificó C13) y 14 es el propio `verify.sh --full`.
#
# AVISO IMPORTANTE sobre bodega-uno (impl.md § Qué necesita quien pruebe,
# confirmado EJECUTANDO en este ciclo, no solo leído): agrupar
# bodega-uno/bodega-dos "como hace .agent/specs/F-017/smoke.sh" (POST a
# /api/admin/stores/<bodega-uno>/branches con joiningStoreId=bodega-dos) deja
# «bodega-uno» como el slug de la MARCA (selector) para siempre —
# regroupStoreIntoBrand() (src/features/storefront/server/registry.ts) le da
# al store PRIMARY (el dueño del endpoint) un slug NUEVO
# ("bodega-uno-2") y al JOINING el slug que ya tenía ("bodega-dos", sin
# cambiar). Consecuencia: /bodega-uno/carrito y /bodega-uno/c/<cat> NO
# resuelven como sucursal (dan 404, kind=selector no sirve esas rutas) — el
# criterio 5 y la mitad de tres "position" del 18, escritos contra
# "/bodega-uno" literal, no son reproducibles con esta agrupación en NINGUNA
# dirección de POST (quien sea el PRIMARY pierde su slug literal, sea cual
# sea). Sustituido por /bodega-dos/carrito y /bodega-dos/c/<cat> — la
# SUCURSAL HERMANA, dentro de la MISMA marca agrupada de la MISMA forma
# canónica — que demuestra exactamente lo mismo que el criterio pide (tres
# eslabones, el segundo enlaza a la propia URL de la sucursal, sin slug de
# marca ajeno). El criterio 11 (/bodega-uno/sucursales) SÍ es literalmente
# reproducible: esa pantalla acepta tanto una resolución de marca (selector)
# como de sucursal, así que "bodega-uno" sirve sin problema.
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

contains() { # contains <qué> <html> <aguja>
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

not_contains() { # not_contains <qué> <html> <aguja>
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

count_of() { # count_of <html> <aguja> — cuántas veces aparece
  node -e '
    const [html, needle] = [process.argv[1], process.argv[2]];
    let n = 0, i = -1;
    while ((i = html.indexOf(needle, i + 1)) !== -1) n++;
    process.stdout.write(String(n));
  ' "$1" "$2"
}

# nav_of <html> — el bloque <nav aria-label="Ruta">…</nav>, o "" si no está.
nav_of() {
  node -e '
    const html = process.argv[1];
    const s = html.indexOf("<nav aria-label=\"Ruta\"");
    if (s === -1) { process.stdout.write(""); process.exit(0); }
    const e = html.indexOf("</nav>", s) + 6;
    process.stdout.write(html.slice(s, e));
  ' "$1"
}

crumb_count() { # crumb_count <nav-html> — cuenta <li> dentro del <ol>
  node -e '
    const nav = process.argv[1];
    process.stdout.write(String((nav.match(/<li /g) || []).length));
  ' "$1"
}

current_label() { # current_label <nav-html> — el texto del <span aria-current="page">…</span>, sin las clases de en medio
  node -e '
    const nav = process.argv[1];
    const m = nav.match(/aria-current="page"[^>]*><span class="truncate">([^<]*)<\/span>/);
    process.stdout.write(m ? m[1] : "");
  ' "$1"
}

ldjson_positions() { # ldjson_positions <html> — cuántas "position" tiene el BreadcrumbList, o "-1" si no hay script
  node -e '
    const html = process.argv[1];
    const s = html.indexOf("application/ld+json");
    if (s === -1) { process.stdout.write("-1"); process.exit(0); }
    const scriptStart = html.indexOf(">", s) + 1;
    const scriptEnd = html.indexOf("</script>", scriptStart);
    const json = html.slice(scriptStart, scriptEnd);
    process.stdout.write(String((json.match(/"position"/g) || []).length));
  ' "$1"
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

sync_catalog() { # sync_catalog <json-events-array-as-string>
  curl -s -X POST "$BASE/api/internal/sync/catalog" \
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
    -d "{\"businessId\":\"seed-negocio-1\",\"events\":$1}"
}

NOW_COUNTER=0
now() { # milisegundos reales y estrictamente crecientes (guarda anti-rancio)
  NOW_COUNTER=$((NOW_COUNTER + 1))
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$NOW_COUNTER"
}

product_event() { # product_event <eventId> <storeProductId> <productId> <storeId> <name> <categoryId-or-null> <price> <canonicalProductId-or-null>
  local cat_json canon_json
  if [ "$6" = "null" ]; then cat_json="null"; else cat_json="\"$6\""; fi
  if [ "$8" = "null" ]; then canon_json="null"; else canon_json="\"$8\""; fi
  printf '{"eventId":"%s","entity":"PRODUCT","operation":"UPDATE","occurredAt":"%s","payload":{"storeProductId":"%s","productId":"%s","businessId":"seed-negocio-1","storeId":"%s","localName":"%s","barcodes":[],"localCategoryId":%s,"price":%s,"currency":"CUP","canonicalProductId":%s,"imageUrl":null,"publishToStore":true,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$4" "$5" "$cat_json" "$7" "$canon_json" "$(now)"
}

if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
fi

# =========================================================== criterio 1 ====
# Ficha con categoría: nav[aria-label="Ruta"] con <a href="/tienda-demo"> y,
# como último elemento, el nombre del producto con aria-current="page" y sin
# href.

PROD_HTML="$(body "$BASE/tienda-demo/p/jugo-de-mango-1-l")"
check 'criterio 1 — /tienda-demo/p/jugo-de-mango-1-l responde 200' 200 "$(code "$BASE/tienda-demo/p/jugo-de-mango-1-l")"
PROD_NAV="$(nav_of "$PROD_HTML")"
contains 'criterio 1 — el nav trae href="/tienda-demo"' "$PROD_NAV" 'href="/tienda-demo"'
check 'criterio 1 — el último eslabón es el producto, aria-current="page"' 'Jugo de mango 1 L' "$(current_label "$PROD_NAV")"
not_contains 'criterio 1 — el eslabón actual NO lleva href' "$(printf '%s' "$PROD_NAV" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const i=d.indexOf("aria-current");process.stdout.write(d.slice(i,i+120))})')" 'href='

# =========================================================== criterio 2 ====
printf '  --   criterio 2 — SOLO navegador (JS deshabilitado, pulsar el eslabón de sucursal). Ver .agent/specs/F-025/visual.mjs.\n'

# =========================================================== criterio 3 ====
printf '  --   criterio 3 — SOLO build ("npm run build" marca /[slug] y /[slug]/p/[productSlug] como ●). Ver tests.md § Cómo se verificó.\n'

# =========================================================== criterio 4 ====
printf '  --   criterio 4 — SOLO grep+bundle ("node scripts/check-bundle-budget.mjs"). Ver tests.md § Cómo se verificó.\n'

# =========================================================== criterio 5 ====
# En una marca con dos sucursales, tres eslabones y el segundo enlaza a la
# propia sucursal — ver el AVISO de cabecera sobre por qué se usa bodega-dos
# y no el literal bodega-uno.

UNO_ID="$(psql_val "SELECT id FROM \"Store\" WHERE \"externalId\"='seed-tienda-5'")"
DOS_ID="$(psql_val "SELECT id FROM \"Store\" WHERE \"externalId\"='seed-tienda-6'")"
GROUPED="0"
if [ -n "$UNO_ID" ] && [ -n "$DOS_ID" ]; then
  UNO_SF="$(psql_val "SELECT \"storefrontId\" FROM \"Store\" WHERE id='$UNO_ID'")"
  DOS_SF="$(psql_val "SELECT \"storefrontId\" FROM \"Store\" WHERE id='$DOS_ID'")"
  if [ "$UNO_SF" = "$DOS_SF" ]; then
    GROUPED="1"
    printf '  (bodega-uno y bodega-dos ya están agrupadas de una corrida anterior — no se repite el POST)\n'
  elif [ -n "${SSO_JWT_SECRET:-}" ] && [ -n "${ADMIN_SESSION_SECRET:-}" ]; then
    URL_GROUP="$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=seed-tienda-5,seed-tienda-6)"
    if [ -n "$URL_GROUP" ]; then
      COOKIE_JAR="$(mktemp)"
      curl -sS -c "$COOKIE_JAR" -o /dev/null "$URL_GROUP"
      RESP_CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -X POST \
        -H 'content-type: application/json' -d "{\"joiningStoreId\":\"$DOS_ID\"}" \
        "$BASE/api/admin/stores/$UNO_ID/branches")"
      check 'criterio 5 (agrupar, calentando) — POST de agrupar bodega-uno+bodega-dos responde 200' 200 "$RESP_CODE"
      rm -f "$COOKIE_JAR"
      GROUPED="1"
    else
      printf 'SMOKE FAIL criterio 5 — no se pudo acuñar el token SSO para agrupar (revisa SSO_JWT_SECRET)\n'
      FAILS=$((FAILS + 1))
    fi
  else
    printf 'SMOKE FAIL criterio 5 — SSO_JWT_SECRET/ADMIN_SESSION_SECRET no están configurados: no se puede agrupar bodega-uno/bodega-dos\n'
    FAILS=$((FAILS + 1))
  fi
else
  printf 'SMOKE FAIL criterio 5 — no se encontraron bodega-uno/bodega-dos (seed-tienda-5/6) en la base\n'
  FAILS=$((FAILS + 1))
fi

if [ "$GROUPED" = "1" ]; then
  # Slug propio de bodega-dos (el JOINING, conserva su slug literal) y de
  # bodega-uno (el PRIMARY, ahora es el slug de LA MARCA, no de su sucursal).
  BODEGA_DOS_SLUG="$(psql_val "SELECT slug FROM \"Store\" WHERE id='$DOS_ID'")"
  BODEGA_UNO_BRAND_SLUG="$(psql_val "SELECT sf.slug FROM \"Store\" s JOIN \"Storefront\" sf ON sf.id=s.\"storefrontId\" WHERE s.id='$UNO_ID'")"
  check 'criterio 5 — bodega-dos conservó su propio slug literal (agrupar como PRIMARY se lo habría quitado)' \
    'bodega-dos' "$BODEGA_DOS_SLUG"

  BODEGA_DOS_HTML="$(body "$BASE/$BODEGA_DOS_SLUG/carrito")"
  BODEGA_DOS_NAV="$(nav_of "$BODEGA_DOS_HTML")"
  check "criterio 5 — GET /$BODEGA_DOS_SLUG/carrito responde 200" 200 "$(code "$BASE/$BODEGA_DOS_SLUG/carrito")"
  check 'criterio 5 — tres eslabones (Marca › Sucursal › Carrito)' 3 "$(crumb_count "$BODEGA_DOS_NAV")"
  contains "criterio 5 — el segundo eslabón enlaza a /$BODEGA_DOS_SLUG (su propia sucursal)" \
    "$BODEGA_DOS_NAV" "href=\"/$BODEGA_DOS_SLUG\""
  contains "criterio 5 — el primero enlaza a la marca (/$BODEGA_UNO_BRAND_SLUG)" \
    "$BODEGA_DOS_NAV" "href=\"/$BODEGA_UNO_BRAND_SLUG\""

  # La literal /bodega-uno/carrito, documentada como NO reproducible: 404,
  # porque "bodega-uno" es ahora la marca (selector), no una sucursal.
  UNO_CARRITO_CODE="$(code "$BASE/bodega-uno/carrito")"
  if [ "$UNO_CARRITO_CODE" = "404" ]; then
    printf '  ok   criterio 5 (documentado) — /bodega-uno/carrito da 404: "bodega-uno" es ahora la marca, no una sucursal (ver AVISO de cabecera)\n'
  else
    printf 'SMOKE FAIL criterio 5 (documentado) — se esperaba 404 en /bodega-uno/carrito (ya no es un 404 — revisar si la agrupación cambió de forma), dio %s\n' "$UNO_CARRITO_CODE"
    FAILS=$((FAILS + 1))
  fi
fi

# Sin marca (tienda-demo, una sola sucursal): dos eslabones y ningún slug de
# marca distinto de sí misma.
DEMO_CART_HTML="$(body "$BASE/tienda-demo/carrito")"
DEMO_CART_NAV="$(nav_of "$DEMO_CART_HTML")"
check 'criterio 5 — /tienda-demo/carrito responde 200' 200 "$(code "$BASE/tienda-demo/carrito")"
check 'criterio 5 — /tienda-demo/carrito tiene DOS eslabones' 2 "$(crumb_count "$DEMO_CART_NAV")"
not_contains 'criterio 5 — /tienda-demo/carrito no enlaza a ninguna marca ajena (bodega-uno)' "$DEMO_CART_NAV" 'href="/bodega-uno"'

# =========================================================== criterio 6 ====
# Alias vivo: el rastro usa SIEMPRE el canónico, cero apariciones del alias.

ALIAS_HTML="$(body "$BASE/bodega-central-vedado/carrito")"
ALIAS_NAV="$(nav_of "$ALIAS_HTML")"
check 'criterio 6 — /bodega-central-vedado/carrito responde 200' 200 "$(code "$BASE/bodega-central-vedado/carrito")"
check 'criterio 6 — /bodega-central/carrito (canónico) responde 200' 200 "$(code "$BASE/bodega-central/carrito")"
contains 'criterio 6 — el rastro usa el slug canónico bodega-central' "$ALIAS_NAV" 'href="/bodega-central"'
check 'criterio 6 — CERO apariciones del alias dentro del nav' 0 "$(count_of "$ALIAS_NAV" 'bodega-central-vedado')"

# =========================================================== criterio 7 ====
# Tienda cerrada: rastro idéntico al de una abierta.

CERRADA_HTML="$(body "$BASE/tienda-cerrada/carrito")"
CERRADA_NAV="$(nav_of "$CERRADA_HTML")"
check 'criterio 7 — /tienda-cerrada/carrito responde 200' 200 "$(code "$BASE/tienda-cerrada/carrito")"
contains 'criterio 7 — el rastro apunta a /tienda-cerrada' "$CERRADA_NAV" 'href="/tienda-cerrada"'
check 'criterio 7 — dos eslabones (como una tienda abierta)' 2 "$(crumb_count "$CERRADA_NAV")"

# =========================================================== criterio 8 ====
# Término de 300 caracteres, truncado a SEARCH_TERM_MAX_LENGTH (120), nunca
# el crudo.

TERM_300="$(node -e 'process.stdout.write("a".repeat(300))')"
TERM_120="$(node -e 'process.stdout.write("a".repeat(120))')"
SEARCH_HTML="$(curl -s -G "$BASE/tienda-demo/buscar" --data-urlencode "q=$TERM_300")"
SEARCH_NAV="$(nav_of "$SEARCH_HTML")"
check 'criterio 8 — GET /tienda-demo/buscar?q=<300 chars> responde 200' 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' -G "$BASE/tienda-demo/buscar" --data-urlencode "q=$TERM_300")"
contains 'criterio 8 — el rastro trae el término truncado a 120' "$SEARCH_NAV" "$TERM_120"
not_contains 'criterio 8 — el rastro NO trae el término crudo de 300' "$SEARCH_NAV" "$TERM_300"

# =========================================================== criterio 9 ====
printf '  --   criterio 9 — SOLO navegador (medido: ningún notFound() de esta app sirve HTML real; el criterio se reformuló para eso). Ver .agent/specs/F-025/visual.mjs § V9.\n'

# ========================================================== criterio 10 ====
# BreadcrumbList en la ficha, ausente en el carrito.

check 'criterio 10 — la ficha lleva <script type="application/ld+json"> con BreadcrumbList' 1 \
  "$(count_of "$PROD_HTML" '"@type":"BreadcrumbList"')"
check 'criterio 10 — el carrito NO lleva application/ld+json' 0 "$(count_of "$DEMO_CART_HTML" 'application/ld+json')"

# ========================================================== criterio 11 ====
# /bodega-uno/sucursales SÍ es literalmente reproducible (no necesita
# kind=branch). "Volver a" no aparece MÁS DE UNA VEZ — features.json usa esa
# redacción a propósito: el HTML crudo de CUALQUIER página de esta app lleva
# "Volver al inicio" (el 404 global de la plataforma) embebido, escapado y
# PREEXISTENTE en el payload de React Flight de hidratación — invisible en el
# DOM renderizado (confirmado con Playwright en visual.mjs § V8: 0
# apariciones contra el texto que el navegador pinta), pero SÍ lo ve un
# `grep` sobre el HTML crudo, que es lo que hace este guion. Un `grep -c`
# ingenuo que exigiera 0 estaría probando algo que ningún notFound() de esta
# app cumple hoy — no es un fallo de F-025 (impl.md § Qué necesita quien
# pruebe, confirmado aquí ejecutando).

if [ "$GROUPED" = "1" ]; then
  SUC_HTML="$(body "$BASE/bodega-uno/sucursales")"
  SUC_NAV="$(nav_of "$SUC_HTML")"
  check 'criterio 11 — /bodega-uno/sucursales responde 200' 200 "$(code "$BASE/bodega-uno/sucursales")"
  check 'criterio 11 — exactamente un nav[aria-label="Ruta"]' 1 "$(node -e 'const h=process.argv[1];process.stdout.write(String((h.match(/<nav aria-label=\"Ruta\"/g)||[]).length))' "$SUC_HTML")"
  VOLVER_A_COUNT="$(count_of "$SUC_HTML" 'Volver a')"
  if [ "$VOLVER_A_COUNT" -le 1 ]; then
    printf '  ok   criterio 11 — "Volver a" no aparece más de una vez en el HTML crudo (%s; la única aparición, si hay, es el 404 global preexistente embebido en el payload de Flight — invisible en el DOM, ver visual.mjs § V8)\n' "$VOLVER_A_COUNT"
  else
    printf 'SMOKE FAIL criterio 11 — "Volver a" aparece %s veces (más de una)\n' "$VOLVER_A_COUNT"
    FAILS=$((FAILS + 1))
  fi
else
  printf '  --   criterio 11 — se saltó: bodega-uno/bodega-dos no se pudieron agrupar en esta corrida (ver criterio 5)\n'
fi

# ========================================================== criterio 12 ====
# Marca de una sola sucursal: un solo eslabón, sin ningún <a> DENTRO DEL NAV
# de la ruta (spec.md avisa: /tienda-demo también monta
# nav[aria-label="Categorías"], que SÍ tiene <a> — hay que acotar al nav de
# la ruta, no a la página entera).

DEMO_HTML="$(body "$BASE/tienda-demo")"
DEMO_NAV="$(nav_of "$DEMO_HTML")"
check 'criterio 12 — /tienda-demo responde 200' 200 "$(code "$BASE/tienda-demo")"
check 'criterio 12 — un solo eslabón' 1 "$(crumb_count "$DEMO_NAV")"
check 'criterio 12 — CERO <a> dentro del nav de la ruta' 0 "$(node -e 'const h=process.argv[1];process.stdout.write(String((h.match(/<a /g)||[]).length))' "$DEMO_NAV")"

# ========================================================== criterio 13 ====
printf '  --   criterio 13 — medido aparte (git stash del feature + .next limpio + mismo calentamiento antes/después). Ver tests.md § Cómo se verificó C13: 26 consultas en los dos lados.\n'

# ========================================================== criterio 14 ====
printf '  --   criterio 14 — es el propio "bash .agent/verify.sh F-025 --full".\n'

# ========================================================== criterio 15 ====
# Vista de categoría: nav con href a la sucursal y "Bebidas" como último
# eslabón, sin href.

CAT_HTML="$(body "$BASE/tienda-demo/c/bebidas")"
CAT_NAV="$(nav_of "$CAT_HTML")"
check 'criterio 15 — /tienda-demo/c/bebidas responde 200' 200 "$(code "$BASE/tienda-demo/c/bebidas")"
contains 'criterio 15 — el nav trae href="/tienda-demo"' "$CAT_NAV" 'href="/tienda-demo"'
check 'criterio 15 — el último eslabón es Bebidas, aria-current="page", sin href' 'Bebidas' "$(current_label "$CAT_NAV")"

# ========================================================== criterio 16 ====
# La ficha con categoría: tres eslabones, el penúltimo enlaza a la categoría.

check 'criterio 16 — dentro del nav, href="/tienda-demo/c/bebidas"' 1 "$(count_of "$PROD_NAV" 'href="/tienda-demo/c/bebidas"')"
check 'criterio 16 — tres eslabones (no dos)' 3 "$(crumb_count "$PROD_NAV")"
contains 'criterio 16 — el último eslabón sigue siendo el producto' "$PROD_NAV" 'Jugo de mango 1 L'

# ========================================================== criterio 17 ====
# PRODUCT/UPDATE con localCategoryId null quita el eslabón; reenviarlo con su
# categoría lo restaura. No destructivo: mismo precio/canónico/visible al
# terminar, verificado con psql.

BEFORE_CAT="$(psql_val "SELECT \"localCategoryId\" FROM \"StoreProduct\" WHERE \"externalId\"='seed-tienda-1-p3'")"
BEFORE_PRICE="$(psql_val "SELECT \"syncedPrice\" FROM \"StoreProduct\" WHERE \"externalId\"='seed-tienda-1-p3'")"
BEFORE_CANON="$(psql_val "SELECT \"canonicalProductId\" FROM \"StoreProduct\" WHERE \"externalId\"='seed-tienda-1-p3'")"
CAT_EXTERNAL_ID="$(psql_val "SELECT \"externalId\" FROM \"LocalCategory\" WHERE id='$BEFORE_CAT'")"

sync_catalog "[$(product_event "evt-c17-null-$SUFFIX" "seed-tienda-1-p3" "seed-producto-3" "seed-tienda-1" "Jugo de mango 1 L" "null" "${BEFORE_PRICE%.*}" "$BEFORE_CANON")]" >/dev/null
AFTER_NULL_HTML="$(body "$BASE/tienda-demo/p/jugo-de-mango-1-l")"
AFTER_NULL_NAV="$(nav_of "$AFTER_NULL_HTML")"
check 'criterio 17 — tras localCategoryId:null, el nav ya NO trae href="/tienda-demo/c/bebidas"' 0 \
  "$(count_of "$AFTER_NULL_NAV" 'href="/tienda-demo/c/bebidas"')"
check 'criterio 17 — el rastro queda en dos eslabones' 2 "$(crumb_count "$AFTER_NULL_NAV")"

sync_catalog "[$(product_event "evt-c17-restore-$SUFFIX" "seed-tienda-1-p3" "seed-producto-3" "seed-tienda-1" "Jugo de mango 1 L" "$CAT_EXTERNAL_ID" "${BEFORE_PRICE%.*}" "$BEFORE_CANON")]" >/dev/null
RESTORED_HTML="$(body "$BASE/tienda-demo/p/jugo-de-mango-1-l")"
RESTORED_NAV="$(nav_of "$RESTORED_HTML")"
check 'criterio 17 — reenviado con su categoría, vuelve a traer href="/tienda-demo/c/bebidas"' 1 \
  "$(count_of "$RESTORED_NAV" 'href="/tienda-demo/c/bebidas"')"

AFTER_CAT="$(psql_val "SELECT \"localCategoryId\" FROM \"StoreProduct\" WHERE \"externalId\"='seed-tienda-1-p3'")"
check 'criterio 17 (no destructivo) — localCategoryId quedó exactamente como antes' "$BEFORE_CAT" "$AFTER_CAT"

# ========================================================== criterio 18 ====
# BreadcrumbList: DOS "position" en tienda-demo (marca de una sola sucursal,
# R4), TRES en la marca de dos sucursales (sustituida por bodega-dos, mismo
# motivo que el criterio 5) y CERO en la tienda cerrada.

check 'criterio 18 — /tienda-demo/c/bebidas: DOS "position" (R4, marca de una sucursal)' 2 "$(ldjson_positions "$CAT_HTML")"

if [ "$GROUPED" = "1" ]; then
  BODEGA_DOS_CAT_HTML="$(body "$BASE/$BODEGA_DOS_SLUG/c/bebidas")"
  check "criterio 18 — /$BODEGA_DOS_SLUG/c/bebidas responde 200" 200 "$(code "$BASE/$BODEGA_DOS_SLUG/c/bebidas")"
  check "criterio 18 — /$BODEGA_DOS_SLUG/c/bebidas: TRES \"position\" (marca de dos sucursales)" 3 "$(ldjson_positions "$BODEGA_DOS_CAT_HTML")"
else
  printf '  --   criterio 18 (mitad de tres) — se saltó: bodega-uno/bodega-dos no se pudieron agrupar (ver criterio 5)\n'
fi

CERRADA_CAT_HTML="$(body "$BASE/tienda-cerrada/c/loquesea-$SUFFIX")"
check 'criterio 18 — /tienda-cerrada/c/<cualquiera> responde 200' 200 "$(code "$BASE/tienda-cerrada/c/loquesea-$SUFFIX")"
check 'criterio 18 — tienda cerrada: CERO application/ld+json' 0 "$(count_of "$CERRADA_CAT_HTML" 'application/ld+json')"

# ========================================================== criterio 19 ====
printf '  --   criterio 19 — SOLO build ("npm run build" marca /[slug]/c/[categorySlug] como ●). Ver tests.md § Cómo se verificó.\n'

# ========================================================== criterio 20 ====
# Alias en la vista de categoría: todo el rastro habla en canónico.

ALIAS_CAT_HTML="$(body "$BASE/bodega-central-vedado/c/bebidas")"
ALIAS_CAT_NAV="$(nav_of "$ALIAS_CAT_HTML")"
check 'criterio 20 — /bodega-central-vedado/c/bebidas responde 200' 200 "$(code "$BASE/bodega-central-vedado/c/bebidas")"
contains 'criterio 20 — el nav trae href="/bodega-central"' "$ALIAS_CAT_NAV" 'href="/bodega-central"'
check 'criterio 20 — CERO apariciones del alias' 0 "$(count_of "$ALIAS_CAT_NAV" 'bodega-central-vedado')"

# ========================================================== criterio 21 ====
# 404 de categoría por alias: sale por el canónico, y ningún not-found.tsx
# del segmento conserva href="..".

check 'criterio 21 — /bodega-central-vedado/c/no-existe responde 404' 404 \
  "$(code "$BASE/bodega-central-vedado/c/no-existe-$SUFFIX")"
if grep -rn 'href="\.\."' "src/app/[slug]/" >/tmp/f025-href-relativo.txt 2>&1; then
  printf 'SMOKE FAIL criterio 21 — quedan href=".." en src/app/[slug]/:\n'
  cat /tmp/f025-href-relativo.txt
  FAILS=$((FAILS + 1))
else
  printf '  ok   criterio 21 — cero href=".." en src/app/[slug]/\n'
fi
rm -f /tmp/f025-href-relativo.txt

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
