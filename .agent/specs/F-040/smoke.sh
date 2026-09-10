#!/usr/bin/env bash
# Verificación en runtime de F-040 (la tienda muda). La ejecuta
# `bash .agent/verify.sh F-040 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL, contra la base real de docker-compose.yml (ya migrada).
#
# Cubre los criterios 1, 2, 3, 4, 5 y 7 (el 6 se verifica aparte — ver
# tests.md § Cómo se contó el criterio 6, procedimiento de F-025, no
# reproducible con la app arriba porque necesita reiniciar `next dev` con el
# log de Prisma activado y comparar dos estados del código). El criterio 8
# es `bash .agent/verify.sh F-040 --full` en sí mismo.
#
# Siembra su propio fixture con `.agent/specs/F-040/seed-muted-store.ts`
# (Prisma directo — `Business.baseCurrencyCode` no se puede fijar por el
# sync, docs/sync-contract.md § payload de BUSINESS) y lo borra al final,
# pase lo que pase (trap). Cuatro tiendas, dos negocios, prefijo
# `f040-smoke-` + un sufijo único por corrida — nunca colisiona con otra
# corrida sobre el mismo Postgres compartido (AGENTS.md § Cosas que
# muerden).
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
SUFFIX="f040sm$(date +%s)"

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
    printf 'SMOKE FAIL %s — SÍ se encontró %s (no debía aparecer)\n' "$1" "$3"
    FAILS=$((FAILS + 1))
  fi
}

# no_price <qué se espera> <html> — ausencia de un IMPORTE real ($100.00),
# no de cualquier "$": el payload de streaming de React lleva referencias
# como "$5"/"$2f" que un `grep '\$'` ingenuo confunde con dinero.
no_price() {
  if node -e '
    const html = process.argv[1];
    process.exit(/\$[0-9]{1,3}(,[0-9]{3})*\.[0-9]{2}/.test(html) ? 1 : 0);
  ' "$2"; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — apareció un importe con forma de precio\n' "$1"
    FAILS=$((FAILS + 1))
  fi
}

psql_val() { # psql_val <SQL>
  docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "$1"
}

FRASE="Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando pedidos."

cleanup() {
  npx tsx .agent/specs/F-040/seed-muted-store.ts down "$SUFFIX" >/dev/null 2>&1
}
trap cleanup EXIT

echo "--- sembrando el fixture (seed-muted-store.ts up $SUFFIX) ---"
FIXTURE_JSON="$(npx tsx .agent/specs/F-040/seed-muted-store.ts up "$SUFFIX" 2>/tmp/f040-seed-err.log)"
if [ -z "$FIXTURE_JSON" ]; then
  echo "SMOKE FAIL no se pudo sembrar el fixture de la tienda muda"
  cat /tmp/f040-seed-err.log
  FAILS=$((FAILS + 1))
  echo
  printf '%d aserciones fallidas\n' "$FAILS"
  exit 1
fi

jget() { node -e 'const o=JSON.parse(process.argv[1]); const p=process.argv[2].split("."); let v=o; for (const k of p) v=v?.[k]; process.stdout.write(String(v ?? ""));' "$FIXTURE_JSON" "$1"; }

MUDA_SLUG="$(jget mudaBase.slug)"
MUDA_STORE_ID="$(jget mudaBase.storeId)"
PROD0="$(jget mudaBase.productSlugs.0)"
CAT_SLUG="$(jget mudaBase.categorySlug)"
E16_SLUG="$(jget mudaE16.slug)"
PARCIAL_SLUG="$(jget parcial.slug)"
VACIA_SLUG="$(jget vacia.slug)"

echo "fixture: muda=$MUDA_SLUG e16=$E16_SLUG parcial=$PARCIAL_SLUG vacia=$VACIA_SLUG"

# ============================================================
# Criterio 1 (E1) — las SIETE vistas de la tienda muda por moneda base.
# ============================================================
echo "--- criterio 1 (E1) — las siete vistas ---"
for path in "" "/p/$PROD0" "/catalogo" "/c/$CAT_SLUG" "/buscar?q=algo" "/carrito" "/checkout"; do
  html="$(body "$BASE/$MUDA_SLUG$path")"
  check "criterio 1 — GET /$MUDA_SLUG$path responde 200" 200 "$(code "$BASE/$MUDA_SLUG$path")"
  contains "criterio 1 — /$MUDA_SLUG$path trae la frase" "$html" "$FRASE"
  not_contains "criterio 1 — /$MUDA_SLUG$path sin 'Consultar'" "$html" "Consultar"
  not_contains "criterio 1 — /$MUDA_SLUG$path sin el mensaje de catálogo vacío" "$html" \
    "todavía no tiene productos publicados"
  no_price "criterio 1 — /$MUDA_SLUG$path sin ningún importe" "$html"
done

echo "--- criterio 1 (E5/E6) — producto y categoría inexistentes enseñan el mismo aviso, no 404 ---"
check "E5 — /p/no-existe en tienda muda responde 200, no 404" 200 "$(code "$BASE/$MUDA_SLUG/p/no-existe")"
check "E6 — /c/no-existe en tienda muda responde 200, no 404" 200 "$(code "$BASE/$MUDA_SLUG/c/no-existe")"

echo "--- criterio 1 (E16) — la variante: base CUP, productos en EUR sin tasa ---"
E16_HTML="$(body "$BASE/$E16_SLUG")"
check "E16 — GET /$E16_SLUG responde 200" 200 "$(code "$BASE/$E16_SLUG")"
contains "E16 — trae la frase" "$E16_HTML" "$FRASE"
no_price "E16 — sin ningún importe" "$E16_HTML"

# ============================================================
# Criterio 7 — la ficha dice lo mismo que la portada.
# ============================================================
echo "--- criterio 7 ---"
PORTADA_HTML="$(body "$BASE/$MUDA_SLUG")"
FICHA_HTML="$(body "$BASE/$MUDA_SLUG/p/$PROD0")"
PORTADA_FRASE="$(node -e 'const h=process.argv[1]; const f=process.argv[2]; process.stdout.write(h.includes(f)?"1":"0")' "$PORTADA_HTML" "$FRASE")"
FICHA_FRASE="$(node -e 'const h=process.argv[1]; const f=process.argv[2]; process.stdout.write(h.includes(f)?"1":"0")' "$FICHA_HTML" "$FRASE")"
check "criterio 7 — la MISMA frase en portada y ficha" "$PORTADA_FRASE" "$FICHA_FRASE"
not_contains "criterio 7 — la ficha sin botón de añadir al carrito" "$FICHA_HTML" "Añadir al carrito"
not_contains "criterio 7 — la ficha sin 'Consultar precio'" "$FICHA_HTML" "Consultar precio"

# ============================================================
# Criterio 2 (E2) — solo algunos sin precio: catálogo normal, sin aviso.
# ============================================================
echo "--- criterio 2 (E2) ---"
PARCIAL_HTML="$(body "$BASE/$PARCIAL_SLUG")"
check "criterio 2 — GET /$PARCIAL_SLUG responde 200" 200 "$(code "$BASE/$PARCIAL_SLUG")"
not_contains "criterio 2 — SIN la frase de cierre" "$PARCIAL_HTML" "$FRASE"
contains "criterio 2 — los dos productos con precio siguen en el catálogo" "$PARCIAL_HTML" \
  "F-040 producto parcial resuelve 1 ${SUFFIX}"
contains "criterio 2 — trae al menos un importe real" "$PARCIAL_HTML" '$100.00'

# ============================================================
# Criterio 3 (E3) — tienda publicada y vacía: su mensaje de siempre.
# ============================================================
echo "--- criterio 3 (E3) ---"
VACIA_HTML="$(body "$BASE/$VACIA_SLUG")"
check "criterio 3 — GET /$VACIA_SLUG responde 200" 200 "$(code "$BASE/$VACIA_SLUG")"
not_contains "criterio 3 — SIN la frase de cierre" "$VACIA_HTML" "$FRASE"
contains "criterio 3 — el mensaje de catálogo vacío de siempre" "$VACIA_HTML" \
  "todavía no tiene productos publicados"

# ============================================================
# Criterio 4 (E10) — la detección no escribe nada: la fila, idéntica antes
# y después de visitar las siete URL.
# ============================================================
echo "--- criterio 4 (E10) ---"
ROW_SQL="SELECT status, \"disabledReasonCode\", \"disabledMessage\", \"disabledAt\" FROM \"Store\" WHERE id='$MUDA_STORE_ID'"
ROW_BEFORE="$(psql_val "$ROW_SQL")"
for path in "" "/p/$PROD0" "/catalogo" "/c/$CAT_SLUG" "/buscar?q=algo" "/carrito" "/checkout"; do
  code "$BASE/$MUDA_SLUG$path" >/dev/null
done
ROW_AFTER="$(psql_val "$ROW_SQL")"
check "criterio 4 — la fila de Store es IDÉNTICA antes y después de las siete visitas" \
  "$ROW_BEFORE" "$ROW_AFTER"

# ============================================================
# Criterio 5 (E11, E12) — cotizar y crear un pedido en la tienda muda.
# ============================================================
echo "--- criterio 5 (E11, E12) ---"
OFFER_ID="$(psql_val "SELECT sp.id FROM \"StoreProduct\" sp WHERE sp.\"storeId\"='$MUDA_STORE_ID' LIMIT 1")"
ORDERS_BEFORE="$(psql_val "SELECT count(*) FROM \"Order\" WHERE \"storeId\"='$MUDA_STORE_ID'")"

QUOTE_RESPONSE="$(curl -s -X POST "$BASE/api/orders/quote" -H 'content-type: application/json' \
  -d "{\"storeSlug\":\"$MUDA_SLUG\",\"items\":[{\"storeProductId\":\"$OFFER_ID\",\"qty\":1}]}")"
QUOTE_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/orders/quote" \
  -H 'content-type: application/json' \
  -d "{\"storeSlug\":\"$MUDA_SLUG\",\"items\":[{\"storeProductId\":\"$OFFER_ID\",\"qty\":1}]}")"
check "E11 — POST /api/orders/quote responde 200 (nunca 500, nunca STORE_CLOSED)" 200 "$QUOTE_CODE"
contains "E11 — la línea trae reason NO_PRICE" "$QUOTE_RESPONSE" '"reason":"NO_PRICE"'
contains "E11 — orderable:false" "$QUOTE_RESPONSE" '"orderable":false'
contains "E11 — subtotal 0.00" "$QUOTE_RESPONSE" '"subtotal":"0.00"'

for fulfillment_case in \
  'PICKUP|{}' \
  'DELIVERY|{"deliveryAddress":"Calle 1 e/ 2 y 4","zoneCode":"23.01"}'
do
  FULFILLMENT="${fulfillment_case%%|*}"
  EXTRA_RAW="${fulfillment_case#*|}"
  EXTRA_FIELDS=""
  if [ "$EXTRA_RAW" != "{}" ]; then
    EXTRA_FIELDS=",$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(Object.entries(o).map(([k,v])=>JSON.stringify(k)+":"+JSON.stringify(v)).join(","))' "$EXTRA_RAW")"
  fi
  BODY="{\"storeSlug\":\"$MUDA_SLUG\",\"items\":[{\"storeProductId\":\"$OFFER_ID\",\"qty\":1}],\"contact\":{\"name\":\"Cliente F-040\",\"phone\":\"+5350000000\"},\"fulfillment\":\"$FULFILLMENT\",\"expectedTotal\":\"0.00\"$EXTRA_FIELDS}"
  RESPONSE="$(curl -s -X POST "$BASE/api/orders" -H 'content-type: application/json' -d "$BODY")"
  ORDER_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/orders" -H 'content-type: application/json' -d "$BODY")"
  check "E12 — POST /api/orders ($FULFILLMENT) responde 409, nunca 500" 409 "$ORDER_CODE"
  contains "E12 — ($FULFILLMENT) ITEMS_UNAVAILABLE" "$RESPONSE" '"error":"ITEMS_UNAVAILABLE"'
  contains "E12 — ($FULFILLMENT) la línea trae reason NO_PRICE" "$RESPONSE" '"reason":"NO_PRICE"'
done

ORDERS_AFTER="$(psql_val "SELECT count(*) FROM \"Order\" WHERE \"storeId\"='$MUDA_STORE_ID'")"
check "E12 — CERO pedidos nuevos (ni PICKUP ni DELIVERY crearon fila)" "$ORDERS_BEFORE" "$ORDERS_AFTER"

INVALID_AMOUNT_ORDERS="$(psql_val "SELECT count(*) FROM \"Order\" WHERE \"storeId\"='$MUDA_STORE_ID' AND (subtotal IS NULL OR total IS NULL)")"
check "E12 — cero filas de pedido con importes inválidos (NULL)" "0" "$INVALID_AMOUNT_ORDERS"

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
