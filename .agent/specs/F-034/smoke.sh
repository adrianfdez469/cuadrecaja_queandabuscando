#!/usr/bin/env bash
# Verificación en runtime de F-034 (alta de negocio por API). La ejecuta
# `bash .agent/verify.sh F-034 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL.
#
# Restricción dura (architecture.md § Pruebas, ficha
# mint-token-rota-el-token-en-bd-compartida): la base es COMPARTIDA entre el
# checkout principal y todos los worktrees. Este guion NUNCA toca
# `seed-negocio-1` ni `seed-negocio-2` — ni por SQL ni por `npm run
# mint:token` — y todo lo que necesita "un negocio que existe" crea el suyo,
# con `externalId` propio bajo el prefijo `f034-smoke-<epoch>`, que la
# limpieza del final borra por completo.
#
# El criterio 2 (I8) se ejecuta literal gracias al paso 6 del plan: el mismo
# `externalId` recién provisionado se exporta como `QAB_BUSINESS_ID`, así que
# `scripts/send-catalog-batch.mjs --token=<el devuelto>` autentica contra SU
# PROPIO negocio en vez de contra `seed-negocio-1` — sin la vía (a) de I8, que
# habría rotado el token del seed.
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

# `.env`, sin depender de que el shell que invoca el smoke lo tenga
# exportado (mismo patrón que .agent/specs/F-028/smoke.sh).
env_val() {
  node -e '
    import("dotenv/config").then(() => {
      console.log(process.env[process.argv[1]] ?? "");
    });
  ' "$1"
}

sha256_hex() { # <valor en claro>
  node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1], 'utf8').digest('hex'))" "$1"
}

json_field() { # <json> <campo> — "null" para JSON null, "" si falta o no parsea
  node -e '
    try {
      const body = JSON.parse(process.argv[1]);
      const value = body[process.argv[2]];
      console.log(value === null ? "null" : value === undefined ? "" : value);
    } catch { console.log(""); }
  ' "$1" "$2"
}

SECRET="$(env_val QAB_PROVISIONING_SECRET)"
CONFIGURED_HASH="$(env_val PROVISIONING_SECRET_SHA256)"

# ============================================ guardián de precondición =====
# Nunca un salto en verde (F-015): si el secreto no está repartido a este
# worktree, o el hash configurado no es el suyo, el smoke aborta con el
# comando de arreglo — no sigue adelante fingiendo que probó algo.
if [ -z "$SECRET" ] || [ -z "$CONFIGURED_HASH" ]; then
  printf 'SMOKE FAIL faltan QAB_PROVISIONING_SECRET o PROVISIONING_SECRET_SHA256 en .env — genera el par (docs/despliegue.md §5, .env.example) y añádelos a tu .env local\n'
  exit 1
fi
COMPUTED_HASH="$(sha256_hex "$SECRET")"
if [ "$(printf '%s' "$CONFIGURED_HASH" | tr '[:upper:]' '[:lower:]')" != "$COMPUTED_HASH" ]; then
  printf 'SMOKE FAIL PROVISIONING_SECRET_SHA256 en .env no es el SHA-256 de QAB_PROVISIONING_SECRET — vuelve a generar el par\n'
  exit 1
fi

# =========================================================== acceso a BD ===
# Mismo patrón que .agent/specs/F-028/smoke.sh: node -e + pg, DIRECT_URL con
# DATABASE_URL como respaldo.
business_count() { # <externalId>
  node -e '
    import("dotenv/config").then(async () => {
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const { rows } = await db.query(
        `select count(*)::int as n from "Business" where "externalId" = $1`,
        [process.argv[1]],
      );
      await db.end();
      console.log(rows[0].n);
    });
  ' "$1"
}

business_field() { # <externalId> <columna>
  node -e '
    import("dotenv/config").then(async () => {
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const column = process.argv[2];
      const { rows } = await db.query(
        `select "${column}" as v from "Business" where "externalId" = $1`,
        [process.argv[1]],
      );
      await db.end();
      console.log(rows[0] ? (rows[0].v ?? "") : "");
    });
  ' "$1" "$2"
}

business_create() { # <externalId> [active=true|false]
  node -e '
    import("dotenv/config").then(async () => {
      const { randomUUID } = await import("node:crypto");
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const active = process.argv[2] !== "false";
      await db.query(
        `insert into "Business" (id, "externalId", name, active, "updatedAt")
         values ($1, $2, $2, $3, now())`,
        [randomUUID(), process.argv[1], active],
      );
      await db.end();
    });
  ' "$1" "${2:-true}"
}

hash_reused_as_business_token_count() { # <hash>
  node -e '
    import("dotenv/config").then(async () => {
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const { rows } = await db.query(
        `select count(*)::int as n from "Business" where "syncTokenHash" = $1`,
        [process.argv[1]],
      );
      await db.end();
      console.log(rows[0].n);
    });
  ' "$1"
}

cleanup_smoke_rows() { # <prefijo>
  node -e '
    import("dotenv/config").then(async () => {
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const like = `${process.argv[1]}%`;
      await db.query(`delete from "SyncEvent" where "businessId" like $1`, [like]);
      await db.query(`delete from "Business" where "externalId" like $1`, [like]);
      await db.end();
    });
  ' "$1"
}

# ==================================================== helpers HTTP =========
# Cada uno imprime "CODE\nBODY" en dos líneas — UNA sola petición, nunca dos,
# porque una segunda llamada con el mismo externalId caería en E4 (R3: nunca
# rota) y falsearía el código que el criterio quiere ver.
post() { # <path> <authorization o vacío> <body>
  if [ -n "$2" ]; then
    curl -sS -w '\n%{http_code}' -X POST "$BASE$1" \
      -H "authorization: $2" -H 'content-type: application/json' -d "$3"
  else
    curl -sS -w '\n%{http_code}' -X POST "$BASE$1" \
      -H 'content-type: application/json' -d "$3"
  fi
}
post_code() { post "$@" | tail -1; }
post_body() { post "$@" | sed '$d'; }

post_headers() { # <path> <authorization o vacío> <body>
  if [ -n "$2" ]; then
    curl -sSD - -o /dev/null -X POST "$BASE$1" \
      -H "authorization: $2" -H 'content-type: application/json' -d "$3"
  else
    curl -sSD - -o /dev/null -X POST "$BASE$1" \
      -H 'content-type: application/json' -d "$3"
  fi
}
has_no_store() { # <headers>
  echo "$1" | grep -qi '^cache-control: *no-store'
}

EPOCH="$(date +%s)"
BASE_ID="f034-smoke-$EPOCH"
AUTH="Bearer $SECRET"

# ================================================== criterio 1 (E1) ========
RESPONSE_1="$(post /api/provisioning/credential "$AUTH" "{\"externalId\":\"$BASE_ID\"}")"
CODE_1="$(echo "$RESPONSE_1" | tail -1)"
BODY_1="$(echo "$RESPONSE_1" | sed '$d')"
TOKEN="$(json_field "$BODY_1" token)"

check 'criterio 1 — POST con externalId nuevo → 201' 201 "$CODE_1"
check 'criterio 1 — el token no viene vacío' 48 "${#TOKEN}"
check 'criterio 1 — queda exactamente una fila Business con ese externalId' 1 "$(business_count "$BASE_ID")"

# ================================= criterio 2 (E2, I8) y mitad de criterio 6
# QAB_BUSINESS_ID hace que el argv del criterio quede BYTE A BYTE como está
# escrito, autenticando contra el negocio recién provisionado en vez de
# contra seed-negocio-1 (architecture.md § Cómo se ejecuta el criterio 2).
export QAB_BUSINESS_ID="$BASE_ID"
CATALOG_OUT_1="$(QAB_BASE_URL="$BASE" node scripts/send-catalog-batch.mjs --token="$TOKEN" 2>&1)"
CATALOG_CODE_1="$(echo "$CATALOG_OUT_1" | head -1 | awk '{print $2}')"
check 'criterio 2 — el token acuñado autentica: send-catalog-batch → 207 (mitad 2 del criterio 6 de paso)' 207 "$CATALOG_CODE_1"

# ================================================== criterio 3 (E4) ========
RESPONSE_3="$(post /api/provisioning/credential "$AUTH" "{\"externalId\":\"$BASE_ID\"}")"
CODE_3="$(echo "$RESPONSE_3" | tail -1)"
BODY_3="$(echo "$RESPONSE_3" | sed '$d')"
HASH_AFTER_REPEAT="$(business_field "$BASE_ID" syncTokenHash)"

check 'criterio 3 — repetir la MISMA llamada → 200' 200 "$CODE_3"
check 'criterio 3 — el token es null en la repetición' 'null' "$(json_field "$BODY_3" token)"
check 'criterio 3 — el syncTokenHash de la base es byte a byte idéntico antes y después' \
  "$(sha256_hex "$TOKEN")" "$HASH_AFTER_REPEAT"

# ================================================== criterio 4 (E5) ========
CATALOG_OUT_2="$(QAB_BASE_URL="$BASE" node scripts/send-catalog-batch.mjs --token="$TOKEN" 2>&1)"
CATALOG_CODE_2="$(echo "$CATALOG_OUT_2" | head -1 | awk '{print $2}')"
check 'criterio 4 — tras la repetición, el token de la 1ª llamada sigue en 207 (registrar no rota nunca)' 207 "$CATALOG_CODE_2"
unset QAB_BUSINESS_ID

# ================================================== criterio 5 (E3) ========
EXTERNAL_ID_E3="$BASE_ID-e3"
business_create "$EXTERNAL_ID_E3" >/dev/null
COUNT_BEFORE_E3="$(business_count "$EXTERNAL_ID_E3")"
RESPONSE_5="$(post /api/provisioning/credential "$AUTH" "{\"externalId\":\"$EXTERNAL_ID_E3\"}")"
CODE_5="$(echo "$RESPONSE_5" | tail -1)"
BODY_5="$(echo "$RESPONSE_5" | sed '$d')"
COUNT_AFTER_E3="$(business_count "$EXTERNAL_ID_E3")"

TOKEN_5="$(json_field "$BODY_5" token)"
check 'criterio 5 — negocio existente sin syncTokenHash → 201' 201 "$CODE_5"
check 'criterio 5 — el token no viene vacío' 48 "${#TOKEN_5}"
check 'criterio 5 — no crea ningún Business nuevo (el mismo externalId, count sin cambio)' "$COUNT_BEFORE_E3" "$COUNT_AFTER_E3"

# ================================================== criterio 7 (E7) ========
BODY_MISSING="$(post_body /api/provisioning/credential "" '{"externalId":"f034-smoke-e7-missing"}')"
CODE_MISSING="$(post_code /api/provisioning/credential "" '{"externalId":"f034-smoke-e7-missing"}')"
BODY_BASIC="$(post_body /api/provisioning/credential "Basic $SECRET" '{"externalId":"f034-smoke-e7-basic"}')"
CODE_BASIC="$(post_code /api/provisioning/credential "Basic $SECRET" '{"externalId":"f034-smoke-e7-basic"}')"
BODY_WRONG="$(post_body /api/provisioning/credential "Bearer not-the-secret-but-still-32-chars-long" '{"externalId":"f034-smoke-e7-wrong"}')"
CODE_WRONG="$(post_code /api/provisioning/credential "Bearer not-the-secret-but-still-32-chars-long" '{"externalId":"f034-smoke-e7-wrong"}')"

check 'criterio 7 — cabecera ausente → 401' 401 "$CODE_MISSING"
check 'criterio 7 — otro esquema (Basic) → 401' 401 "$CODE_BASIC"
check 'criterio 7 — Bearer con valor equivocado → 401' 401 "$CODE_WRONG"
check 'criterio 7 — los tres cuerpos son idénticos (missing = basic)' "$BODY_MISSING" "$BODY_BASIC"
check 'criterio 7 — los tres cuerpos son idénticos (basic = wrong)' "$BODY_BASIC" "$BODY_WRONG"

# ================================================== criterio 8 (E8) ========
CODE_E8_EMPTY="$(post_code /api/provisioning/credential "$AUTH" '{}')"
BODY_E8_EMPTY="$(post_body /api/provisioning/credential "$AUTH" '{}')"
CODE_E8_BLANK="$(post_code /api/provisioning/credential "$AUTH" '{"externalId":"   "}')"
CODE_E8_NOJSON="$(post_code /api/provisioning/credential "$AUTH" 'no soy json')"

check 'criterio 8 — sin externalId → 400' 400 "$CODE_E8_EMPTY"
check 'criterio 8 — sin externalId → INVALID_BODY' 'INVALID_BODY' "$(json_field "$BODY_E8_EMPTY" error)"
check 'criterio 8 — externalId en blanco → 400' 400 "$CODE_E8_BLANK"
check 'criterio 8 — cuerpo no JSON → 400' 400 "$CODE_E8_NOJSON"
check 'criterio 8 — ninguno de los tres crea un Business' 0 "$(business_count 'f034-smoke-e8-nunca-existe')"

# ================================================== criterio 9 (E9) ========
EXTERNAL_ID_E9="$BASE_ID-e9"
business_create "$EXTERNAL_ID_E9" false >/dev/null
RESPONSE_9="$(post /api/provisioning/credential "$AUTH" "{\"externalId\":\"$EXTERNAL_ID_E9\"}")"
CODE_9="$(echo "$RESPONSE_9" | tail -1)"
BODY_9="$(echo "$RESPONSE_9" | sed '$d')"

check 'criterio 9 — Business.active = false → 403' 403 "$CODE_9"
check 'criterio 9 — cuerpo BUSINESS_INACTIVE' 'BUSINESS_INACTIVE' "$(json_field "$BODY_9" error)"
check 'criterio 9 — no acuña: syncTokenHash sigue nulo' '' "$(business_field "$EXTERNAL_ID_E9" syncTokenHash)"

# ================================================= criterio 10 (E10) =======
EXTERNAL_ID_E10="$BASE_ID-e10"
BODY_10A_FILE="$(mktemp)"
BODY_10B_FILE="$(mktemp)"
post /api/provisioning/credential "$AUTH" "{\"externalId\":\"$EXTERNAL_ID_E10\"}" >"$BODY_10A_FILE" &
PID_A=$!
post /api/provisioning/credential "$AUTH" "{\"externalId\":\"$EXTERNAL_ID_E10\"}" >"$BODY_10B_FILE" &
PID_B=$!
wait "$PID_A"
wait "$PID_B"
CODE_10A="$(tail -1 "$BODY_10A_FILE")"
CODE_10B="$(tail -1 "$BODY_10B_FILE")"
rm -f "$BODY_10A_FILE" "$BODY_10B_FILE"

CODES_10_SORTED="$(printf '%s\n%s\n' "$CODE_10A" "$CODE_10B" | sort | tr '\n' ',' | sed 's/,$//')"
check 'criterio 10 — dos altas concurrentes: un 200 y un 201, ninguna 500' '200,201' "$CODES_10_SORTED"
check 'criterio 10 — queda UN solo Business con ese externalId' 1 "$(business_count "$EXTERNAL_ID_E10")"

# ================================================= criterio 11 (E13) =======
CODE_11="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/internal/orders?since=0" -H "authorization: $AUTH")"
check 'criterio 11 — el secreto de aprovisionamiento no autentica /api/internal/orders → 401' 401 "$CODE_11"

# ============================================= criterio 16 (E14, nuevo) ====
# La mitad simétrica del criterio 11: el token de sync de ESTE MISMO negocio
# desechable (nunca el de seed-negocio-1) no autentica la ruta de
# aprovisionamiento.
CODE_16="$(post_code /api/provisioning/credential "Bearer $TOKEN" '{"externalId":"f034-smoke-e14-nunca"}')"
check 'criterio 16 — un token de negocio no autentica /api/provisioning/credential → 401' 401 "$CODE_16"
check 'criterio 16 — no crea nada con ese intento' 0 "$(business_count 'f034-smoke-e14-nunca')"

# ============================================= criterio 17 (nuevo, R10) ====
EXTERNAL_ID_HDR="$BASE_ID-hdr"
HEADERS_201="$(post_headers /api/provisioning/credential "$AUTH" "{\"externalId\":\"$EXTERNAL_ID_HDR\"}")"
HEADERS_200="$(post_headers /api/provisioning/credential "$AUTH" "{\"externalId\":\"$EXTERNAL_ID_HDR\"}")"
HEADERS_401="$(post_headers /api/provisioning/credential "" '{"externalId":"f034-smoke-e17-nunca"}')"

if has_no_store "$HEADERS_201" && has_no_store "$HEADERS_200" && has_no_store "$HEADERS_401"; then
  printf '  ok   criterio 17 — cache-control: no-store en 201, 200 y 401\n'
else
  printf 'SMOKE FAIL criterio 17 — cache-control: no-store falta en alguna respuesta\n'
  FAILS=$((FAILS + 1))
fi

# ============================================= criterio 20 (E17, nuevo) ====
EXTERNAL_ID_NAME_1="$BASE_ID-name1"
EXTERNAL_ID_NAME_2="$BASE_ID-name2"
post /api/provisioning/credential "$AUTH" \
  "{\"externalId\":\"$EXTERNAL_ID_NAME_1\",\"name\":\"Bodega La Rampa\"}" >/dev/null
post /api/provisioning/credential "$AUTH" "{\"externalId\":\"$EXTERNAL_ID_NAME_2\"}" >/dev/null

check 'criterio 20 — con name, Business.name es el enviado' 'Bodega La Rampa' \
  "$(business_field "$EXTERNAL_ID_NAME_1" name)"
check 'criterio 20 — sin name, Business.name es el propio externalId' "$EXTERNAL_ID_NAME_2" \
  "$(business_field "$EXTERNAL_ID_NAME_2" name)"

# =========================================== la trampa que la ADR prohíbe ==
# El digest del secreto de aprovisionamiento y el hash de un token de negocio
# viven en el mismo espacio de valores (los dos son SHA-256 hex). Esta
# consulta es la que detectaría que alguien cableó el secreto como
# credencial de sync (docs/adr/0029-alta-de-negocio-por-api.md, punto 2).
check 'el digest del secreto de aprovisionamiento NUNCA es el syncTokenHash de un Business' 0 \
  "$(hash_reused_as_business_token_count "$COMPUTED_HASH")"

# ========================================================== limpieza =======
cleanup_smoke_rows "f034-smoke-"

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
