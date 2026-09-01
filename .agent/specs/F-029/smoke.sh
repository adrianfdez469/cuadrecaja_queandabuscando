#!/usr/bin/env bash
# Verificación en runtime de F-029 (los secretos opcionales de .env.example
# dejan de romper serverEnv() en silencio). La ejecuta
# `bash .agent/verify.sh F-029 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL.
#
# Precondición: Postgres arriba y `npm run seed` aplicado (usa
# seed-negocio-1, seed-usuario-1, seed-tienda-1 — los mismos fixtures que
# scripts/mint-sso-token.mjs asume por omisión).
#
# Guardián (R10, architecture.md § D4): los dos guiones de humo comparten el
# mismo `node scripts/dev-secrets.mjs --check`. Si las tres claves no son
# utilizables, este guion aborta entero con un `SMOKE FAIL` que nombra el
# generador — nunca las escribe él mismo. Un smoke que rellena el entorno que
# está probando escondería justo el fallo que este feature persigue.
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

env_sha() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 .env | awk '{print $1}'
  else
    sha256sum .env | awk '{print $1}'
  fi
}

# ----------------------------------------------------------------- 1 -------
# Guardián compartido con .agent/specs/F-012/smoke.sh. No escribe .env.
GUARDIAN_OUT="$(node scripts/dev-secrets.mjs --check 2>&1)"
GUARDIAN_CODE=$?
if [ "$GUARDIAN_CODE" -ne 0 ]; then
  printf 'SMOKE FAIL node scripts/dev-secrets.mjs --check salió %s (faltan o son cortas: %s) — genera los secretos con: node scripts/dev-secrets.mjs --write\n' \
    "$GUARDIAN_CODE" "$(echo "$GUARDIAN_OUT" | tr '\n' ' ')"
  exit 1
fi

# ----------------------------------------------------------------- 2 -------
# Testigo: el sha256 de .env tiene que ser idéntico al empezar y al terminar.
HASH_BEFORE="$(env_sha)"

# ----------------------------------------------------------------- 3 -------
# Negativo primero: sin esto, el 200 del paso 5 no probaría nada.
check 'GET /admin sin cookie redirige (307, src/proxy.ts)' 307 "$(code "$BASE/admin")"

# ----------------------------------------------------------------- 4 -------
# Acuñar un token SSO real y canjearlo por una cookie de sesión de admin.
SSO_URL="$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs)"
TOKEN="$(node -e 'console.log(new URL(process.argv[1]).searchParams.get("token"))' "$SSO_URL")"

SSO_HEADERS="$(curl -s -D - -o /dev/null "$SSO_URL")"
SSO_STATUS="$(echo "$SSO_HEADERS" | head -n1 | tr -d '\r' | awk '{print $2}')"
check 'GET /admin/sso?token=... canjea el token (307 a /admin)' 307 "$SSO_STATUS"

ADMIN_COOKIE="$(echo "$SSO_HEADERS" | grep -i '^set-cookie: qab-admin-session=' | head -n1 |
  sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);?.*/\1/' | tr -d '\r')"
if [ -z "$ADMIN_COOKIE" ]; then
  printf 'SMOKE FAIL /admin/sso no devolvió un Set-Cookie para qab-admin-session\n'
  FAILS=$((FAILS + 1))
fi

# ----------------------------------------------------------------- 5 -------
# El pago (E4, criterio 7): la cookie real abre el panel.
check 'GET /admin con la cookie de sesión responde 200' 200 "$(code -H "Cookie: $ADMIN_COOKIE" "$BASE/admin")"

# ----------------------------------------------------------------- 6 -------
# Cookie presente pero ilegible: separa «cookie presente» de «cookie válida»
# (lo que la ficha del playbook describe como indistinguible sin esto).
check 'GET /admin con cookie basura vuelve a redirigir (307)' 307 \
  "$(code -H 'Cookie: qab-admin-session=no-es-un-jwt' "$BASE/admin")"

# ----------------------------------------------------------------- 7 -------
# Limpieza acotada: borra solo la fila de SsoTokenUse de ESTA corrida, leyendo
# el jti del propio token en vez de consultar por fecha (idempotente al
# repetir el humo).
if [ -n "$TOKEN" ]; then
  JTI="$(node -e '
    const token = process.argv[1];
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    console.log(payload.jti ?? "");
  ' "$TOKEN")"
  if [ -n "$JTI" ]; then
    node -e '
      import("dotenv/config").then(async () => {
        const { Client } = await import("pg");
        const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
        await db.connect();
        await db.query(`delete from "SsoTokenUse" where jti = $1`, [process.argv[1]]);
        await db.end();
      });
    ' "$JTI" >/dev/null 2>&1
  fi
fi

# Testigo, comparado al terminar (criterio 7: sin tocar .env a mano ni
# revertir nada después).
HASH_AFTER="$(env_sha)"
check 'sha256(.env) idéntico al empezar y al terminar' "$HASH_BEFORE" "$HASH_AFTER"

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
