#!/usr/bin/env bash
# Verificación en runtime de F-018 (la identidad del llamante sale del token).
# La ejecuta `bash .agent/verify.sh F-018 --smoke` con `next dev` ya levantado
# en $SMOKE_BASE_URL y con la base sembrada (`npm run seed`): dos negocios,
# `seed-negocio-1` (tienda-demo, tienda-dos, …) y `seed-negocio-2` (el-faro,
# `seed-tienda-7`).
#
# Cubre lo que solo se ve por HTTP de verdad: C1 en runtime, C3, C5, C10-C13.
# El resto (C2, C4, C6, C7, C8, C9) se verifica con `verify.sh --full` y con
# los tests unitarios/db — este guion no los repite.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0

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

json_field() { # <JSON en stdin> | json_field <campo>
  node -e '
    let body;
    try { body = JSON.parse(require("fs").readFileSync(0, "utf8")); }
    catch { process.stdout.write("<invalid-json>"); process.exit(0); }
    const v = body[process.argv[1]];
    process.stdout.write(v === null ? "<null>" : v === undefined ? "<undefined>" : String(v));
  ' "$1"
}

# `mint:token` imprime, en su última línea no vacía, el token en claro. Nunca
# se salta en verde: si `npx tsx` falla, `$(...)` queda vacío y los checks de
# abajo lo notan como un 401/503, no como un skip silencioso.
mint_token() { # mint_token <externalId>
  npx tsx scripts/mint-sync-token.ts "$1" 2>/dev/null | tail -n1
}

echo "== preparación: acuñar/rotar los tokens de los dos negocios del seed =="

TOKEN_A="$(mint_token seed-negocio-1)"
TOKEN_B="$(mint_token seed-negocio-2)"

if [ -z "$TOKEN_A" ] || [ -z "$TOKEN_B" ]; then
  printf 'SMOKE FAIL no se pudo acuñar el token de seed-negocio-1 y/o seed-negocio-2 — ver scripts/mint-sync-token.ts\n'
  exit 1
fi

# --------------------------------------------------------- C3: E2-E4 ----

check 'C3 — sin cabecera responde 401 o 503 (según haya hashes configurados), nunca 200' \
  '1' "$( [ "$(code "$BASE/api/internal/orders")" != 200 ] && echo 1 || echo 0 )"

RANDOM_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(36).toString("base64url"))')"
check 'C3 — un token que no resuelve ningún negocio responde 401' 401 \
  "$(code -H "authorization: Bearer $RANDOM_TOKEN" "$BASE/api/internal/orders")"

# --------------------------------------------------------- C1 en runtime ----

ORDERS_A="$(curl -s -H "authorization: Bearer $TOKEN_A" "$BASE/api/internal/orders?since=0&limit=500")"
ORDERS_B="$(curl -s -H "authorization: Bearer $TOKEN_B" "$BASE/api/internal/orders?since=0&limit=500")"

A_HAS_B_STORE="$(echo "$ORDERS_A" | node -e '
  let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
    const j=JSON.parse(d);
    console.log((j.orders||[]).some(o=>o.storeExternalId==="seed-tienda-7") ? "1" : "0");
  });
')"
check 'C1 — el pull de A no trae ningún pedido de la tienda de B (seed-tienda-7)' 0 "$A_HAS_B_STORE"

B_HAS_A_STORE="$(echo "$ORDERS_B" | node -e '
  let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
    const j=JSON.parse(d);
    console.log((j.orders||[]).some(o=>o.storeExternalId==="seed-tienda-1") ? "1" : "0");
  });
')"
check 'C1 — el pull de B no trae ningún pedido de la tienda de A (seed-tienda-1)' 0 "$B_HAS_A_STORE"

# --------------------------------------------------------- C11 ----

check 'C11 — reconciliation con el token de A y el storeId de B responde 404' 404 \
  "$(code -H "authorization: Bearer $TOKEN_A" "$BASE/api/internal/reconciliation?storeId=seed-tienda-7")"

check 'reconciliation con el token de A y una tienda propia responde 200' 200 \
  "$(code -H "authorization: Bearer $TOKEN_A" "$BASE/api/internal/reconciliation?storeId=seed-tienda-1")"

# --------------------------------------------------------- C12 ----

AVAIL_BODY="$(curl -s -X POST "$BASE/api/internal/sync/availability" \
  -H "authorization: Bearer $TOKEN_A" -H 'content-type: application/json' \
  -d '{"businessId":"seed-negocio-1","items":[{"storeProductId":"seed-tienda-7-p0","storeId":"seed-tienda-7","availability":"OUT_OF_STOCK"}]}')"
check 'C12 — disponibilidad con el token de A y un item de la tienda de B responde 200' 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/internal/sync/availability" \
    -H "authorization: Bearer $TOKEN_A" -H 'content-type: application/json' \
    -d '{"businessId":"seed-negocio-1","items":[{"storeProductId":"seed-tienda-7-p0","storeId":"seed-tienda-7","availability":"OUT_OF_STOCK"}]}')"
check 'C12 — ese item NO aparece en confirmed' '' "$(echo "$AVAIL_BODY" | node -e '
  let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
    const j=JSON.parse(d);
    const found=(j.confirmed||[]).some(([spId])=>spId==="seed-tienda-7-p0");
    console.log(found ? "PRESENTE" : "");
  });
')"

# --------------------------------------------------------- C13 ----

SLUG_BODY="$(curl -s -H "authorization: Bearer $TOKEN_A" "$BASE/api/internal/slug-availability?slug=el-faro&storeId=seed-tienda-7")"
check 'C13 — slug-availability con el token de A y el storeId de B: storeKnown=false' 'false' \
  "$(echo "$SLUG_BODY" | json_field storeKnown)"
REASON_C13="$(echo "$SLUG_BODY" | json_field reason)"
check 'C13 — reason nunca es "own" para la tienda de B' '1' "$( [ "$REASON_C13" != "own" ] && echo 1 || echo 0 )"

# --------------------------------------------------------- C10 ----

echo "== C10: negocio inactivo (docker exec, restaurado al final) =="

docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
  "UPDATE \"Business\" SET active=false WHERE \"externalId\"='seed-negocio-2'" >/dev/null

check 'C10 — un token válido de un negocio con active:false responde 403' 403 \
  "$(code -H "authorization: Bearer $TOKEN_B" "$BASE/api/internal/orders")"
INACTIVE_BODY="$(curl -s -H "authorization: Bearer $TOKEN_B" "$BASE/api/internal/orders")"
check 'C10 — el cuerpo es BUSINESS_INACTIVE' 'BUSINESS_INACTIVE' "$(echo "$INACTIVE_BODY" | json_field error)"

docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
  "UPDATE \"Business\" SET active=true WHERE \"externalId\"='seed-negocio-2'" >/dev/null

check 'C10 — restaurado: B vuelve a responder 200' 200 \
  "$(code -H "authorization: Bearer $TOKEN_B" "$BASE/api/internal/orders")"

# --------------------------------------------------------- C5: rotación ----

echo "== C5: rotar el token de A no afecta a B =="

OLD_TOKEN_A="$TOKEN_A"
NEW_TOKEN_A="$(mint_token seed-negocio-1)"

check 'C5 — el token viejo de A deja de responder 200 (pasa a 401)' 401 \
  "$(code -H "authorization: Bearer $OLD_TOKEN_A" "$BASE/api/internal/orders")"
check 'C5 — el token nuevo de A responde 200' 200 \
  "$(code -H "authorization: Bearer $NEW_TOKEN_A" "$BASE/api/internal/orders")"
check 'C5 — el token de B, sin tocar, sigue respondiendo 200' 200 \
  "$(code -H "authorization: Bearer $TOKEN_B" "$BASE/api/internal/orders")"

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
