#!/usr/bin/env bash
# Verificación en runtime de F-028 (emulador local de Supabase Auth). La
# ejecuta `bash .agent/verify.sh F-028 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL, y con `docker compose up -d` ya corrido antes (los seis
# servicios: postgres, storage-db, storage, supabase-gateway, auth-db, auth,
# mailpit).
#
# Orden deliberado, no arbitrario (architecture.md § Riesgos):
#   1a/1b primero — el paso 1 del plan (el renombrado del gateway) es la
#   trampa del feature, y se verifica contra la API de Storage, no solo la de
#   Auth. 2 antes de 3, porque 3 (las rutas de F-012) depende de que el ciclo
#   básico de correo ya funcione. 8 al final: es el único que no necesita el
#   ciclo de correo.
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

# `.env`, sin depender de que el shell que invoca el smoke lo tenga
# exportado (mismo patrón que .agent/specs/F-012/smoke.sh).
env_val() {
  node -e '
    import("dotenv/config").then(() => {
      console.log(process.env[process.argv[1]] ?? "");
    });
  ' "$1"
}

SUPABASE_URL="$(env_val NEXT_PUBLIC_SUPABASE_URL)"
ANON_KEY="$(env_val NEXT_PUBLIC_SUPABASE_ANON_KEY)"
SERVICE_KEY="$(env_val SUPABASE_SERVICE_ROLE_KEY)"

if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ] || [ -z "$SERVICE_KEY" ]; then
  printf 'SMOKE FAIL faltan claves en .env — ejecuta: node scripts/storage-dev-keys.mjs --write\n'
  FAILS=$((FAILS + 1))
fi

# ================================================== criterio 1 (E1) ========
check 'criterio 1a — GET /auth/v1/health' 200 "$(code "$SUPABASE_URL/auth/v1/health")"

STORAGE_BODY="$(body "$SUPABASE_URL/storage/v1/bucket" -H "Authorization: Bearer $SERVICE_KEY")"
if echo "$STORAGE_BODY" | grep -q store-media; then
  printf '  ok   criterio 1b — /storage/v1/bucket sigue devolviendo store-media (no regresión del renombrado del gateway)\n'
else
  printf 'SMOKE FAIL criterio 1b — /storage/v1/bucket no trae store-media: %s\n' "$STORAGE_BODY"
  FAILS=$((FAILS + 1))
fi

# ================================================== criterio 2 (E2-E4) =====
GOTRUE_OUT="$(node scripts/auth-otp.mjs --quiet --json 2>&1)"
GOTRUE_CODE=$?
if [ "$GOTRUE_CODE" -eq 0 ]; then
  GOTRUE_UUID="$(node -e "try{console.log(JSON.parse(process.argv[1]).user_id ?? '')}catch{console.log('')}" "$GOTRUE_OUT")"
  if echo "$GOTRUE_UUID" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
    printf '  ok   criterio 2 — scripts/auth-otp.mjs termina en 0 con un user_id UUID (%s)\n' "$GOTRUE_UUID"
  else
    printf 'SMOKE FAIL criterio 2 — auth-otp.mjs salió 0 pero sin user_id con forma de UUID: %s\n' "$GOTRUE_OUT"
    FAILS=$((FAILS + 1))
  fi
else
  printf 'SMOKE FAIL criterio 2 — auth-otp.mjs salió %s: %s\n' "$GOTRUE_CODE" "$GOTRUE_OUT"
  FAILS=$((FAILS + 1))
fi

# ================================================== criterio 3 (E5-E6) =====
customer_count() {
  node -e '
    import("dotenv/config").then(async () => {
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const { rows } = await db.query(
        `select count(*)::int as n from "Customer" where "supabaseUserId" is not null`,
      );
      await db.end();
      console.log(rows[0].n);
    });
  '
}

COUNT_BEFORE="$(customer_count)"
COOKIE_JAR="$(mktemp)"
APP_OUT="$(node scripts/auth-otp.mjs --mode app --app "$BASE" --cookie-jar "$COOKIE_JAR" --quiet --json 2>&1)"
APP_CODE=$?
COUNT_AFTER="$(customer_count)"

if [ "$APP_CODE" -eq 0 ]; then
  DIFF=$((COUNT_AFTER - COUNT_BEFORE))
  check 'criterio 3 — exactamente un Customer nuevo (E6)' 1 "$DIFF"

  COOKIE_HEADER="$(cat "$COOKIE_JAR" 2>/dev/null)"
  CUENTA_BODY="$(curl -s -H "Cookie: $COOKIE_HEADER" "$BASE/cuenta")"
  CUENTA_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $COOKIE_HEADER" "$BASE/cuenta")"
  check 'criterio 3 — GET /cuenta con la cookie' 200 "$CUENTA_CODE"

  APP_EMAIL="$(node -e "try{console.log(JSON.parse(process.argv[1]).profile?.email ?? '')}catch{console.log('')}" "$APP_OUT")"
  if [ -n "$APP_EMAIL" ] && echo "$CUENTA_BODY" | grep -qF "$APP_EMAIL"; then
    printf '  ok   criterio 3 — /cuenta trae el correo del perfil\n'
  else
    printf 'SMOKE FAIL criterio 3 — /cuenta no trae el correo %s en su HTML\n' "$APP_EMAIL"
    FAILS=$((FAILS + 1))
  fi

  # R12 — limpieza: borra SOLO la fila que ESTA corrida creó, para que el
  # aserto de conteo de la próxima corrida siga siendo estable.
  if [ -n "$APP_EMAIL" ]; then
    node -e '
      import("dotenv/config").then(async () => {
        const { Client } = await import("pg");
        const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
        await db.connect();
        await db.query(`delete from "Customer" where email = $1`, [process.argv[1]]);
        await db.end();
      });
    ' "$APP_EMAIL" >/dev/null 2>&1
  fi
else
  printf 'SMOKE FAIL criterio 3 — auth-otp.mjs --mode app salió %s: %s\n' "$APP_CODE" "$APP_OUT"
  FAILS=$((FAILS + 1))
fi
rm -f "$COOKIE_JAR"

# ================================================== criterio 8 (E7-E8) =====
authorize_location() { # <provider>
  curl -sD - -o /dev/null "$SUPABASE_URL/auth/v1/authorize?provider=$1&redirect_to=http://localhost:3000/auth/callback" \
    -H "apikey: $ANON_KEY"
}
status_of() { echo "$1" | head -1 | tr -d '\r' | awk '{print $2}'; }
location_of() { echo "$1" | grep -i '^location:' | head -1 | cut -d' ' -f2- | tr -d '\r'; }

FACEBOOK_HEADERS="$(authorize_location facebook)"
FACEBOOK_STATUS="$(status_of "$FACEBOOK_HEADERS")"
FACEBOOK_LOCATION="$(location_of "$FACEBOOK_HEADERS")"
if [ "$FACEBOOK_STATUS" = "302" ] && echo "$FACEBOOK_LOCATION" | grep -q 'facebook.com' &&
  echo "$FACEBOOK_LOCATION" | grep -q 'redirect_uri=' && echo "$FACEBOOK_LOCATION" | grep -q 'state='; then
  printf '  ok   criterio 8 — authorize?provider=facebook → 302 con redirect_uri y state\n'
else
  printf 'SMOKE FAIL criterio 8 — facebook: esperaba 302 a facebook.com con redirect_uri y state, obtuve %s %s\n' \
    "$FACEBOOK_STATUS" "$FACEBOOK_LOCATION"
  FAILS=$((FAILS + 1))
fi

# Riesgo (d), architecture.md § Riesgos: GoTrue hace descubrimiento OIDC
# contra accounts.google.com en la primera petición de `authorize`. Si la
# red de este entorno lo estorba, esta mitad se anota en vez de fallar el
# criterio por un motivo ajeno a la configuración (PP2).
GOOGLE_HEADERS="$(authorize_location google)"
GOOGLE_STATUS="$(status_of "$GOOGLE_HEADERS")"
GOOGLE_LOCATION="$(location_of "$GOOGLE_HEADERS")"
if [ "$GOOGLE_STATUS" = "302" ]; then
  if echo "$GOOGLE_LOCATION" | grep -q 'accounts.google.com' && echo "$GOOGLE_LOCATION" | grep -q 'redirect_uri=' &&
    echo "$GOOGLE_LOCATION" | grep -q 'state='; then
    printf '  ok   criterio 8 — authorize?provider=google → 302 con redirect_uri y state\n'
  else
    printf 'SMOKE FAIL criterio 8 — google: 302 pero sin los campos esperados: %s\n' "$GOOGLE_LOCATION"
    FAILS=$((FAILS + 1))
  fi
else
  printf '  ..  criterio 8 (google) SALTADO — authorize respondió %s, no 302. GoTrue hace descubrimiento OIDC contra accounts.google.com al construir el proveedor (architecture.md § Riesgos, riesgo d); si la red de este entorno lo bloquea, esta mitad del criterio se verifica solo con facebook. No cuenta como fallo de F-028.\n' "$GOOGLE_STATUS"
fi

# ================================================== E9 — Apple =============
# Se observa, no se asierta: ningún acceptance_criteria de F-028 nombra a
# Apple (su `secret` tiene que ser un JWT firmado con una clave privada real).
APPLE_HEADERS="$(authorize_location apple)"
APPLE_STATUS="$(status_of "$APPLE_HEADERS")"
APPLE_LOCATION="$(location_of "$APPLE_HEADERS")"
printf '  ..  apple: authorize respondió %s%s (observación E9, sin aserto)\n' \
  "$APPLE_STATUS" "${APPLE_LOCATION:+ → $APPLE_LOCATION}"

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
