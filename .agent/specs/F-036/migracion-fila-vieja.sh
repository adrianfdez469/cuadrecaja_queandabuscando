#!/usr/bin/env bash
# F-036 criterio 5 (spec.md C5, plan.md paso 7): "Una fila sembrada ANTES de
# la migracion no se convierte en la vigente por no tener marca de origen:
# tras migrar, un escenario con una fila vieja y una nueva devuelve la
# nueva. Verificado sembrando la fila vieja antes de migrar, no
# simulandolo."
#
# NO es un test de la suite y no puede serlo (spec.md I3): `npm test` corre
# siempre contra un esquema YA migrado, y este criterio exige un estado del
# esquema —sin la columna `sourceUpdatedAt`— al que la suite no puede
# volver. Es un guion de una sola pasada contra una base de USAR Y TIRAR
# propia (nunca la compartida: esa ya está migrada hoy — comprobado por el
# orquestador antes de este ciclo — y por eso el paso 0 de abajo existe:
# para abortar en rojo en vez de dar un falso verde si algo deja este guion
# corriendo contra una base que ya tiene la columna).
#
# Orden (spec.md § C5, plan.md paso 7):
#   (setup) CREATE DATABASE de usar y tirar + aplicar el juego de
#           migraciones PRE-F036 (la migración de F-036 se saca
#           temporalmente de prisma/migrations/ para poder aplicar
#           exactamente "el juego actual" sin ella, calcado de la variante
#           repetible que spec.md § C5 describe — la carpeta ya existe,
#           la generó sdd-implementer, así que en vez de crearla después
#           se saca del camino y se repone).
#   (0) comprobar que sourceUpdatedAt NO existe todavía -> ABORTAR EN ROJO
#       si existe (esto es lo que impide el falso verde).
#   (1) sembrar por SQL una fila de tasa VIEJA (createdAt de enero 2026,
#       sin sourceUpdatedAt porque la columna todavía no existe).
#   (2) aplicar la migración de F-036 con `migrate deploy`.
#   (3) comprobar que la fila vieja quedó con sourceUpdatedAt = NULL
#       (PD1: nadie la rellena; NULLS LAST hace el trabajo del relleno).
#   (4) el escenario: una tasa NUEVA con marca gana sobre la vieja sin
#       marca, leída con la MISMA sentencia que
#       src/features/catalog/server/rates.ts (buildCurrentRatesSql)
#       ejecuta en producción.
#   (5) DROP DATABASE, siempre — también si algo de arriba falla.
#
# Moneda sintética propia de esta corrida: "MXR". Nunca CUP/USD/MLC/EUR/ABC
# (monedas reales o ya usadas por otro *.db.test.ts), nunca QAB (F-035) ni
# ZZZ (F-027).
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 1

CONTAINER="queandabuscando-postgres"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="queandabuscando_f036_c5_$(date +%s)"
DB_URL="postgresql://postgres:postgres@localhost:${DB_PORT}/${DB_NAME}"
MIGRATION_NAME="20260907123926_exchange_rate_source_updated_at"
MIGRATION_DIR="prisma/migrations/${MIGRATION_NAME}"
SYNTH_CURRENCY="MXR"
STASH="$(mktemp -d)"
FAILS=0
DB_CREATED=0

psql1() { # psql1 <SQL>  ->  primera línea de salida (evita "INSERT 0 1"
  #  pegado detrás del valor de un RETURNING, que psql -Atc no suprime).
  docker exec "$CONTAINER" psql -U postgres -d "$DB_NAME" -Atc "$1" | head -1
}

psql_exec() { # psql_exec <SQL>  ->  sin capturar salida
  docker exec "$CONTAINER" psql -U postgres -d "$DB_NAME" -c "$1" >/dev/null
}

cleanup() {
  # Repone la carpeta de la migración dondequiera que esté (antes o después
  # de aplicarla, según en qué paso haya fallado el guion).
  if [ -d "$STASH/$(basename "$MIGRATION_DIR")" ] && [ ! -d "$MIGRATION_DIR" ]; then
    mv "$STASH/$(basename "$MIGRATION_DIR")" "$MIGRATION_DIR"
  fi
  # Paso 5, siempre — también si algo de arriba falló.
  if [ "$DB_CREATED" = "1" ]; then
    docker exec "$CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" >/dev/null 2>&1
    echo "--- paso 5: DROP DATABASE $DB_NAME ---"
  fi
  rm -rf "$STASH"
}
trap cleanup EXIT

echo "--- creando base de usar y tirar: $DB_NAME ---"
if ! docker exec "$CONTAINER" psql -U postgres -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null; then
  printf 'C5 ABORT no se pudo crear la base %s\n' "$DB_NAME"
  exit 2
fi
DB_CREATED=1

# La migración de F-036 ya existe en disco (la generó sdd-implementer): se
# saca temporalmente para poder aplicar solo "el juego actual" (pre-F036).
mv "$MIGRATION_DIR" "$STASH/"

echo "--- aplicando el juego de migraciones PRE-F036 ---"
if ! DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL" npx prisma migrate deploy >/tmp/f036-c5-deploy1.log 2>&1; then
  cat /tmp/f036-c5-deploy1.log
  printf 'C5 ABORT el juego pre-F036 no se aplicó\n'
  exit 2
fi

echo "--- paso 0: sourceUpdatedAt todavía no existe ---"
COL_COUNT="$(psql1 "SELECT count(*) FROM information_schema.columns WHERE table_name='ExchangeRate' AND column_name='sourceUpdatedAt'")"
if [ "$COL_COUNT" != "0" ]; then
  printf 'C5 ABORT paso 0 -- sourceUpdatedAt YA existe (%s) en una base con solo el juego pre-F036 aplicado. Es justo el falso verde que este guion existe para impedir: no se sigue.\n' "$COL_COUNT"
  exit 1
fi
echo "  ok   paso 0 — sourceUpdatedAt no existe (count=$COL_COUNT)"

echo "--- paso 1: sembrar la fila vieja por SQL, antes de migrar ---"
BIZ_ID="$(psql1 "INSERT INTO \"Business\" (id, \"externalId\", name, \"updatedAt\") VALUES (gen_random_uuid(), 'f036-c5-biz-$(date +%s)', 'F-036 C5 fixture', now()) RETURNING id")"
if [ -z "$BIZ_ID" ]; then
  printf 'C5 ABORT paso 1 -- no se pudo crear el negocio del que cuelga la fila vieja\n'
  exit 2
fi
psql_exec "INSERT INTO \"Currency\" (code, name, symbol, active) VALUES ('$SYNTH_CURRENCY','$SYNTH_CURRENCY','$SYNTH_CURRENCY', true) ON CONFLICT DO NOTHING"
OLD_ID="$(psql1 "INSERT INTO \"ExchangeRate\" (id, \"businessId\", \"currencyCode\", rate, \"createdAt\") VALUES (gen_random_uuid(), '$BIZ_ID', '$SYNTH_CURRENCY', 111, '2026-01-01T00:00:00Z') RETURNING id")"
if [ -z "$OLD_ID" ]; then
  printf 'C5 ABORT paso 1 -- el INSERT de la fila vieja no devolvió id\n'
  exit 2
fi
echo "  ok   paso 1 — fila vieja sembrada ($OLD_ID), rate=111, createdAt=2026-01-01, sin sourceUpdatedAt (la columna no existe todavía)"

echo "--- paso 2: aplicar la migración de F-036 ---"
mv "$STASH/$(basename "$MIGRATION_DIR")" "$MIGRATION_DIR"
if ! DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL" npx prisma migrate deploy >/tmp/f036-c5-deploy2.log 2>&1; then
  cat /tmp/f036-c5-deploy2.log
  printf 'C5 ABORT paso 2 -- migrate deploy de F-036 falló\n'
  exit 2
fi
echo "  ok   paso 2 — migración de F-036 aplicada"

echo "--- paso 3: la fila vieja quedó con sourceUpdatedAt = NULL ---"
OLD_MARK="$(psql1 "SELECT \"sourceUpdatedAt\" IS NULL FROM \"ExchangeRate\" WHERE id='$OLD_ID'")"
if [ "$OLD_MARK" = "t" ]; then
  echo "  ok   paso 3 — sourceUpdatedAt de la fila vieja es NULL (PD1: sin relleno)"
else
  printf 'C5 FAIL paso 3 -- sourceUpdatedAt de la fila vieja NO es NULL (es "%s")\n' "$OLD_MARK"
  FAILS=$((FAILS + 1))
fi

echo "--- paso 4: el escenario -- una fila NUEVA con marca gana sobre la vieja sin marca ---"
NEW_ID="$(psql1 "INSERT INTO \"ExchangeRate\" (id, \"businessId\", \"currencyCode\", rate, \"createdAt\", \"sourceUpdatedAt\") VALUES (gen_random_uuid(), '$BIZ_ID', '$SYNTH_CURRENCY', 222, now(), now()) RETURNING id")"
if [ -z "$NEW_ID" ]; then
  printf 'C5 FAIL paso 4 -- el INSERT de la fila nueva no devolvió id\n'
  FAILS=$((FAILS + 1))
else
  # La MISMA sentencia que src/features/catalog/server/rates.ts
  # (buildCurrentRatesSql) ejecuta en producción: DISTINCT ON con
  # NULLS LAST en sourceUpdatedAt como primera clave de desempate.
  WINNER="$(psql1 "SELECT DISTINCT ON (\"currencyCode\") rate FROM \"ExchangeRate\" WHERE \"businessId\"='$BIZ_ID' ORDER BY \"currencyCode\" ASC, \"sourceUpdatedAt\" DESC NULLS LAST, \"createdAt\" DESC, id DESC")"
  if [ "$WINNER" = "222.000000" ]; then
    echo "  ok   paso 4 — gana la fila NUEVA (rate=222, con marca); la VIEJA (rate=111, sin marca) no vuelve a ganar nunca"
  else
    printf 'C5 FAIL paso 4 -- esperaba 222.000000 (la fila nueva), obtuve "%s" -- la fila vieja sin marca habría resucitado (justo el fallo que F-036 arregla)\n' "$WINNER"
    FAILS=$((FAILS + 1))
  fi
fi

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
