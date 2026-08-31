#!/usr/bin/env bash
# Verificación en runtime de F-027 (filtros y ordenamiento del catálogo). La
# ejecuta `bash .agent/verify.sh F-027 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL, contra la base real de docker-compose.yml (`npm run seed`
# ya corrido) y con QAB_BEARER_TOKEN (el token de seed-negocio-1, F-018) en el
# entorno.
#
# Cubre los criterios 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14 y 15 de F-027. Los
# criterios 1 (comparación contra `main`), 2 (marcadores de `npm run build`),
# 12 (`check-bundle-budget.mjs` + `grep "use client"`) y 16 (el propio
# `verify.sh --full`) se verifican fuera de este guion — están en tests.md §
# Ejecuciones con su comando y su salida real.
#
# Copiado con el criterio de `.agent/specs/F-026/smoke.sh` (los helpers
# `check`/`code`/`body`/`contains`/`not_contains`/`sync_token`/`now`) — no lo
# importa, porque son features distintos y su propio guion tiene que seguir
# pasando tal cual.
#
# Regla de datos: los criterios 5, 6, 7 y 8 no tienen fixture en el seed
# (`tienda-demo` tiene cero promociones, ninguna moneda sin tasa, no trae
# "ácido"/"azúcar" y no tiene 25 productos con el mismo createdAt) — este
# guion crea su PROPIA tienda sintética por sync (`f027-store-$SUFFIX`, nunca
# `seed-tienda-1`/`tienda-demo`), aditiva como ya hace `smoke-nueva-*` de
# F-017: queda en la base al terminar, y ninguna aserción de aquí ni de otro
# feature depende de un conteo exacto de tiendas o de productos en
# `seed-negocio-1`, solo de `contains`/`not_contains` sobre lo que ESTE guion
# creó con SU sufijo.
#
# `priceOverride` (criterio 5) y `Promotion` (criterios 5 y E22) NO son
# sincronizables: docs/sync-contract.md:472 dice literalmente que un PRODUCT
# "nunca toca priceOverride ... ni featured: son del panel", y `Promotion` no
# viaja en el contrato en absoluto (son del panel de administración). Se
# escriben con `psql` directo — la única vía para un dato que en producción
# pondría el panel — y como un `UPDATE`/`INSERT` directo NO dispara
# `revalidateTag` (la trampa que F-026 fichó para no repetir), este guion
# manda un evento de sync adicional, inocuo, sobre el MISMO storeProductId
# justo después, cuyo único propósito es forzar `revalidateStores()` para
# esta tienda antes de leer la página pública. Nunca se verifica una
# revalidación con `psql`: la comprobación siempre es sobre el HTML que
# devuelve `$BASE`, nunca sobre lo que dice la fila.
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

contains() { # contains <qué se espera> <html> <aguja>
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

not_contains() { # not_contains <qué se espera> <html> <aguja>
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

# h3_order <html>  →  el orden de los <h3> (nombres de producto), uno por
# línea — la forma barata de comprobar un orden completo sin depender de
# clases CSS que puedan cambiar.
h3_order() {
  node -e '
    const html = process.argv[1];
    const re = /<h3[^>]*>([^<]+)<\/h3>/g;
    let m; const out = [];
    while ((m = re.exec(html))) out.push(m[1]);
    process.stdout.write(out.join("\n"));
  ' "$1"
}

# index_of <lista-una-por-línea> <texto>  →  posición 1-based, o 0 si no está.
index_of() {
  printf '%s\n' "$1" | grep -n -F -x "$2" | head -1 | cut -d: -f1 | tr -d '\n'
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

# now — milisegundos reales y estrictamente crecientes entre llamadas (macOS
# `date` no tiene %N). La misma razón que ya fichó F-026: dos eventos con el
# mismo `updatedAt` chocan con la guarda anti-rancia y el segundo del par se
# descarta en silencio.
NOW_COUNTER=0
now() {
  NOW_COUNTER=$((NOW_COUNTER + 1))
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$NOW_COUNTER"
}

store_event() { # store_event <eventId> <storeId> <name>
  printf '{"eventId":"%s","entity":"STORE","operation":"CREATE","occurredAt":"%s","payload":{"storeId":"%s","businessId":"seed-negocio-1","businessName":"Distribuidora La Rampa","name":"%s","publishToStore":true,"baseCurrency":"CUP","updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$(now)"
}

product_event() { # product_event <eventId> <storeProductId> <productId> <storeId> <name> <price> <currency>
  printf '{"eventId":"%s","entity":"PRODUCT","operation":"UPDATE","occurredAt":"%s","payload":{"storeProductId":"%s","productId":"%s","businessId":"seed-negocio-1","storeId":"%s","localName":"%s","barcodes":[],"localCategoryId":null,"price":%s,"currency":"%s","canonicalProductId":null,"imageUrl":null,"publishToStore":true,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$4" "$5" "$6" "$7" "$(now)"
}

if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
fi

# =====================================================================
# Criterios 3 y 4 — sobre tienda-demo, sin sembrar nada (fixture real):
# 2 OUT_OF_STOCK ("Papel sanitario x4", "Jugo de mango 1 L"), 4 categorías
# con conteo disjunto (bebidas 4, alimentos 5, aseo 3, panadería 3).
# =====================================================================

echo "--- criterio 3 ---"
SIN_FILTRO="$(body "$BASE/tienda-demo/catalogo")"
check 'criterio 3 — /tienda-demo/catalogo sin filtro responde 200' 200 "$(code "$BASE/tienda-demo/catalogo")"
contains 'criterio 3 — sin filtro trae el agotado' "$SIN_FILTRO" 'Papel sanitario x4'
contains 'criterio 3 — sin filtro trae el disponible' "$SIN_FILTRO" 'Arroz blanco 1 kg'
CON_HAY="$(body "$BASE/tienda-demo/catalogo?disponibilidad=hay")"
not_contains 'criterio 3 — "solo lo que hay" deja fuera el agotado' "$CON_HAY" 'Papel sanitario x4'
contains 'criterio 3 — "solo lo que hay" conserva el disponible' "$CON_HAY" 'Arroz blanco 1 kg'

echo "--- criterio 4 ---"
UNION_HTML="$(body "$BASE/tienda-demo/catalogo?categorySlug=bebidas&categorySlug=alimentos")"
contains 'criterio 4 — unión trae una bebida' "$UNION_HTML" 'Refresco de cola 1.5 L'
contains 'criterio 4 — unión trae un alimento' "$UNION_HTML" 'Arroz blanco 1 kg'
not_contains 'criterio 4 — unión NO trae aseo' "$UNION_HTML" 'Jabón de baño'
INTERSECCION_HTML="$(body "$BASE/tienda-demo/catalogo?categorySlug=bebidas&disponibilidad=hay")"
contains 'criterio 4 — intersección conserva la bebida disponible' "$INTERSECCION_HTML" 'Agua natural 500 ml'
not_contains 'criterio 4 — intersección deja fuera la bebida agotada' "$INTERSECCION_HTML" 'Jugo de mango 1 L'
not_contains 'criterio 4 — intersección NO trae alimentos' "$INTERSECCION_HTML" 'Arroz blanco 1 kg'

# =====================================================================
# Semilla propia para 5, 6, 7 y 8 — una tienda sintética con lo que el
# seed no trae.
# =====================================================================

echo "--- sembrando f027-store-$SUFFIX ---"
STORE_ID="f027-store-$SUFFIX"
sync_catalog "[$(store_event "evt-store-$SUFFIX" "$STORE_ID" "F027 Test Store $SUFFIX")]" >/dev/null

EVENTS="["
EVENTS+="$(product_event "evt-override-$SUFFIX" "f027-p-override-$SUFFIX" "f027-prod-override-$SUFFIX" "$STORE_ID" "F027 Override Test $SUFFIX" 900 CUP),"
EVENTS+="$(product_event "evt-promo-$SUFFIX" "f027-p-promo-$SUFFIX" "f027-prod-promo-$SUFFIX" "$STORE_ID" "F027 Promo Test $SUFFIX" 600 CUP),"
EVENTS+="$(product_event "evt-norate-$SUFFIX" "f027-p-norate-$SUFFIX" "f027-prod-norate-$SUFFIX" "$STORE_ID" "F027 Sin Tasa Test $SUFFIX" 100 ZZZ),"
EVENTS+="$(product_event "evt-acido-$SUFFIX" "f027-p-acido-$SUFFIX" "f027-prod-acido-$SUFFIX" "$STORE_ID" "ácido $SUFFIX" 50 CUP),"
EVENTS+="$(product_event "evt-agua-$SUFFIX" "f027-p-agua-$SUFFIX" "f027-prod-agua-$SUFFIX" "$STORE_ID" "Agua $SUFFIX" 51 CUP),"
EVENTS+="$(product_event "evt-azucar-$SUFFIX" "f027-p-azucar-$SUFFIX" "f027-prod-azucar-$SUFFIX" "$STORE_ID" "azúcar $SUFFIX" 52 CUP)"
for i in $(seq 1 25); do
  ii=$(printf '%02d' "$i")
  EVENTS+=",$(product_event "evt-reciente-$i-$SUFFIX" "f027-p-recent-$i-$SUFFIX" "f027-prod-recent-$i-$SUFFIX" "$STORE_ID" "F027 Reciente $ii $SUFFIX" $((10 + i)) CUP)"
done
EVENTS+="]"
sync_catalog "$EVENTS" >/dev/null

STORE_DB_ID="$(psql_val "SELECT id FROM \"Store\" WHERE \"externalId\"='$STORE_ID'")"
# A single-branch storefront's `Slug` row carries `storefrontId`, not
# `storeId` (that column is only set for the STORE-kind alias a brand's
# OWN branch gets once it groups 2+ stores) — join through `storefrontId`,
# never assume `storeId` is populated.
STORE_SLUG="$(psql_val "SELECT sl.value FROM \"Slug\" sl JOIN \"Store\" st ON st.\"storefrontId\"=sl.\"storefrontId\" WHERE st.id='$STORE_DB_ID'")"
PROMO_SP_ID="$(psql_val "SELECT id FROM \"StoreProduct\" WHERE \"externalId\"='f027-p-promo-$SUFFIX'")"

if [ -z "$STORE_DB_ID" ] || [ -z "$STORE_SLUG" ]; then
  printf 'SMOKE FAIL no se pudo sembrar la tienda sintética (sync sin token o sin conexión)\n'
  FAILS=$((FAILS + 1))
else
  # priceOverride y Promotion son del panel, no del sync (docs/sync-contract.md:472)
  psql_val "UPDATE \"StoreProduct\" SET \"priceOverride\"=300, \"priceOverrideCurrency\"='CUP' WHERE \"externalId\"='f027-p-override-$SUFFIX'" >/dev/null
  psql_val "INSERT INTO \"Promotion\" (id, \"storeId\", name, type, scope, value, conditions, \"startsAt\", \"endsAt\", active, \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid(), '$STORE_DB_ID', 'F027 smoke promo', 'PERCENTAGE', 'PRODUCT', 50, '{\"storeProductIds\":[\"$PROMO_SP_ID\"]}'::jsonb, now() - interval '1 day', now() + interval '1 day', true, now(), now())" >/dev/null
  # criterio 8: 25 productos con EL MISMO createdAt, en el futuro para que
  # ganen "más reciente" sobre el resto del catálogo sintético.
  psql_val "UPDATE \"StoreProduct\" SET \"createdAt\"='2099-01-01T00:00:00Z' WHERE \"externalId\" LIKE 'f027-p-recent-%-$SUFFIX'" >/dev/null
  # criterio 14: uno invisible, otro borrado — nunca deben aparecer.
  psql_val "UPDATE \"StoreProduct\" SET visible=false WHERE \"externalId\"='f027-p-recent-1-$SUFFIX'" >/dev/null
  psql_val "UPDATE \"StoreProduct\" SET \"deletedAt\"=now() WHERE \"externalId\"='f027-p-recent-2-$SUFFIX'" >/dev/null

  # Un UPDATE/INSERT directo no dispara revalidateTag (playbook F-026): un
  # evento de sync inocuo sobre el mismo storeProductId fuerza
  # revalidateStores() antes de leer la página pública.
  sync_catalog "[$(product_event "evt-touch-$SUFFIX" "f027-p-override-$SUFFIX" "f027-prod-override-$SUFFIX" "$STORE_ID" "F027 Override Test $SUFFIX" 900 CUP)]" >/dev/null

  echo "--- criterio 5 ---"
  HASTA_500="$(body "$BASE/$STORE_SLUG/catalogo?precio_max=500")"
  contains 'criterio 5 — override 900→300 aparece bajo "hasta 500"' "$HASTA_500" "F027 Override Test $SUFFIX"
  contains 'criterio 5 — promo 600→300 (50%) aparece bajo "hasta 500"' "$HASTA_500" "F027 Promo Test $SUFFIX"
  DESDE_500="$(body "$BASE/$STORE_SLUG/catalogo?precio_min=500")"
  not_contains 'criterio 5 — override NO aparece bajo "desde 500"' "$DESDE_500" "F027 Override Test $SUFFIX"

  echo "--- criterio 6 ---"
  SIN_LIMITE="$(body "$BASE/$STORE_SLUG/catalogo?precio_min=0")"
  not_contains 'criterio 6 — sin tasa no aparece ni con precio_min=0' "$SIN_LIMITE" "F027 Sin Tasa Test $SUFFIX"
  ASC_P1="$(h3_order "$(body "$BASE/$STORE_SLUG/catalogo?sort=precio_asc")")"
  ASC_P2="$(h3_order "$(body "$BASE/$STORE_SLUG/catalogo?sort=precio_asc&p=2")")"
  ASC_ALL="$(printf '%s\n%s' "$ASC_P1" "$ASC_P2")"
  check 'criterio 6 — sin tasa es la ÚLTIMA fila en precio_asc' "F027 Sin Tasa Test $SUFFIX" "$(printf '%s\n' "$ASC_ALL" | tail -1)"
  DESC_P1="$(h3_order "$(body "$BASE/$STORE_SLUG/catalogo?sort=precio_desc")")"
  DESC_P2="$(h3_order "$(body "$BASE/$STORE_SLUG/catalogo?sort=precio_desc&p=2")")"
  DESC_ALL="$(printf '%s\n%s' "$DESC_P1" "$DESC_P2")"
  check 'criterio 6 — sin tasa es la ÚLTIMA fila en precio_desc también' "F027 Sin Tasa Test $SUFFIX" "$(printf '%s\n' "$DESC_ALL" | tail -1)"

  echo "--- criterio 7 ---"
  NOMBRE_ORDEN="$(h3_order "$(body "$BASE/$STORE_SLUG/catalogo?sort=nombre")")"
  I_ACIDO="$(index_of "$NOMBRE_ORDEN" "ácido $SUFFIX")"
  I_AGUA="$(index_of "$NOMBRE_ORDEN" "Agua $SUFFIX")"
  I_AZUCAR="$(index_of "$NOMBRE_ORDEN" "azúcar $SUFFIX")"
  if [ -n "$I_ACIDO" ] && [ -n "$I_AGUA" ] && [ -n "$I_AZUCAR" ] &&
    [ "$I_ACIDO" -lt "$I_AGUA" ] && [ "$I_AGUA" -lt "$I_AZUCAR" ]; then
    printf '  ok   criterio 7 — ácido (%s) < Agua (%s) < azúcar (%s)\n' "$I_ACIDO" "$I_AGUA" "$I_AZUCAR"
  else
    printf 'SMOKE FAIL criterio 7 — orden esperado ácido<Agua<azúcar, posiciones %s/%s/%s\n' "$I_ACIDO" "$I_AGUA" "$I_AZUCAR"
    FAILS=$((FAILS + 1))
  fi

  echo "--- criterio 8 ---"
  RECIENTE_P1="$(h3_order "$(body "$BASE/$STORE_SLUG/catalogo?sort=reciente")")"
  RECIENTE_P2="$(h3_order "$(body "$BASE/$STORE_SLUG/catalogo?sort=reciente&p=2")")"
  N1=$(printf '%s\n' "$RECIENTE_P1" | wc -l | tr -d ' ')
  N2=$(printf '%s\n' "$RECIENTE_P2" | wc -l | tr -d ' ')
  N_TOTAL=$((N1 + N2))
  N_DISTINCT=$(printf '%s\n%s\n' "$RECIENTE_P1" "$RECIENTE_P2" | sort -u | wc -l | tr -d ' ')
  check 'criterio 8 — página1+página2 sin repetidos ni omisiones (mismo createdAt)' "$N_TOTAL" "$N_DISTINCT"

  echo "--- criterio 14 ---"
  for Q in "" "?sort=precio_asc" "?sort=reciente" "?sort=reciente&p=2" "?disponibilidad=hay" "?promocion=si"; do
    HTML="$(body "$BASE/$STORE_SLUG/catalogo$Q")"
    not_contains "criterio 14 — invisible ausente con [$Q]" "$HTML" "F027 Reciente 01 $SUFFIX"
    not_contains "criterio 14 — borrado ausente con [$Q]" "$HTML" "F027 Reciente 02 $SUFFIX"
  done
fi

# =====================================================================
# Criterio 9 y 10 — /[slug]/buscar, sobre tienda-demo (fixture real,
# misma comprobación que .agent/specs/F-021/tests.md § Criterios 1, 2).
# =====================================================================

echo "--- criterio 9 ---"
BUSCAR_SIN_ORDEN="$(body "$BASE/tienda-demo/buscar?q=Refresco%20de%20cola%201.5%20L")"
BUSCAR_ORDEN="$(h3_order "$BUSCAR_SIN_ORDEN")"
check 'criterio 9 — F-021 criterio 1: coincidencia exacta en posición 1' 'Refresco de cola 1.5 L' "$(printf '%s\n' "$BUSCAR_ORDEN" | sed -n '1p')"
contains 'criterio 9 — F-021 criterio 2: arrastra la categoría (Agua natural)' "$BUSCAR_SIN_ORDEN" 'Agua natural 500 ml'
contains 'criterio 9 — F-021 criterio 2: arrastra la categoría (Cerveza Cristal)' "$BUSCAR_SIN_ORDEN" 'Cerveza Cristal'

echo "--- criterio 10 ---"
BUSCAR_CON_ORDEN="$(h3_order "$(body "$BASE/tienda-demo/buscar?q=Refresco%20de%20cola%201.5%20L&sort=precio_asc")")"
PRIMERO_ORDENADO="$(printf '%s\n' "$BUSCAR_CON_ORDEN" | sed -n '1p')"
if [ "$PRIMERO_ORDENADO" != "Refresco de cola 1.5 L" ]; then
  printf '  ok   criterio 10 — con sort=precio_asc el primero YA NO es la capa léxica (%s)\n' "$PRIMERO_ORDENADO"
else
  printf 'SMOKE FAIL criterio 10 — con sort=precio_asc el primero debería cambiar respecto al orden por capas\n'
  FAILS=$((FAILS + 1))
fi
check 'criterio 10 — precio_asc reordena de punta a punta (Agua natural, la más barata, primero)' 'Agua natural 500 ml' "$PRIMERO_ORDENADO"

# =====================================================================
# Criterio 11 — combinación válida sin resultados, y tienda sin productos.
# =====================================================================

echo "--- criterio 11 ---"
VACIO_FILTROS="$(body "$BASE/tienda-demo/catalogo?categorySlug=bebidas&precio_min=99999")"
check 'criterio 11 — combinación válida sin resultados responde 200' 200 "$(code "$BASE/tienda-demo/catalogo?categorySlug=bebidas&precio_min=99999")"
contains 'criterio 11 — el vacío nombra los filtros aplicados' "$VACIO_FILTROS" 'Con estos filtros no queda ningún producto'
contains 'criterio 11 — el vacío ofrece quitar todos' "$VACIO_FILTROS" 'Quitar todos los filtros'
contains 'criterio 11 — el vacío ofrece el catálogo completo' "$VACIO_FILTROS" 'Ver todo el catálogo'
# el-trebol-centro: rama PUBLISHED de la fixture con 0 StoreProduct visibles.
SIN_PRODUCTOS="$(body "$BASE/el-trebol-centro/catalogo")"
check 'criterio 11 — tienda sin productos responde 200' 200 "$(code "$BASE/el-trebol-centro/catalogo")"
contains 'criterio 11 — tienda sin productos: el mensaje de siempre' "$SIN_PRODUCTOS" 'Esta tienda todavía no tiene productos publicados'
not_contains 'criterio 11 — tienda sin productos: sin panel de filtros' "$SIN_PRODUCTOS" 'Filtros y orden'

# =====================================================================
# Criterio 13 — noindex + canónica en cualquier URL filtrada u ordenada.
# =====================================================================

echo "--- criterio 13 ---"
FILTRADA="$(body "$BASE/tienda-demo/catalogo?categorySlug=bebidas")"
contains 'criterio 13 — noindex' "$FILTRADA" '<meta name="robots" content="noindex"/>'
contains 'criterio 13 — canónica a /tienda-demo' "$FILTRADA" 'rel="canonical" href="'

# =====================================================================
# Criterio 15 — tienda SUSPENDED sin panel, slug selector 404.
# =====================================================================

echo "--- criterio 15 ---"
CERRADA="$(body "$BASE/tienda-cerrada/catalogo")"
check 'criterio 15 — tienda SUSPENDED responde 200 (aviso, no 404)' 200 "$(code "$BASE/tienda-cerrada/catalogo")"
not_contains 'criterio 15 — tienda SUSPENDED sin panel de filtros' "$CERRADA" 'Filtros y orden'
check 'criterio 15 — slug selector (el-trebol) responde 404' 404 "$(code "$BASE/el-trebol/catalogo")"
check 'criterio 15 — slug selector (bodega-uno) responde 404' 404 "$(code "$BASE/bodega-uno/catalogo")"

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
