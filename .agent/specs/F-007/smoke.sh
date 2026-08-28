#!/usr/bin/env bash
# Verificación en runtime de F-007 (pedidos por pull y reporte de estado). La
# ejecuta `bash .agent/verify.sh F-007 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL.
#
# Casi todo el trabajo lo hace scripts/pull-orders.mjs, que es donde viven las
# aserciones de los cuatro criterios. Este guion existe para dos cosas que el
# .mjs no puede hacer solo: enganchar con el sensor —el prefijo SMOKE FAIL es lo
# que pesca extract_signature— y comprobar antes de nada que la app que responde
# es la que se acaba de levantar.
#
# Da por hecho que `npm run seed` ya corrió contra la base a la que apunta
# DATABASE_URL/DIRECT_URL: tienda-demo tiene que existir con productos
# disponibles, porque el guion siembra los pedidos por el checkout público.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0

run_mode() { # run_mode <bandera> <qué criterio cubre>
  if QAB_BASE_URL="$BASE" node scripts/pull-orders.mjs "$1"; then
    printf '  ok   pull-orders.mjs %s (%s)\n' "$1" "$2"
  else
    printf 'SMOKE FAIL pull-orders.mjs %s (%s) — ver la salida de arriba\n' "$1" "$2"
    FAILS=$((FAILS + 1))
  fi
}

# ------------------------------------------------------- antes de nada ----

# Verde contra la aplicación equivocada es la peor salida posible del sensor
# (ficha next-dev-uno-por-directorio). verify.sh ya comprueba que el puerto
# estaba libre antes de levantar; esto comprueba lo otro: que ahí hay algo
# nuestro respondiendo, y no se ejecutan 44 aserciones contra el vacío.
if ! curl -sf -o /dev/null "$BASE/tienda-demo"; then
  printf 'SMOKE FAIL la app no responde en %s — sin servidor no se verifica nada\n' "$BASE"
  exit 1
fi

# El .mjs necesita el token de seed-negocio-1 para hacer de POS (F-018: el
# token es por negocio). Si no está, sus 44 aserciones fallarían todas con un
# 401/503 y el motivo real quedaría enterrado. Nunca se salta en verde.
if [ -z "${QAB_BEARER_TOKEN:-}" ] && ! grep -q '^QAB_BEARER_TOKEN=".\{32,\}"' .env 2>/dev/null; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  exit 1
fi

# --------------------------------------------------- los cuatro criterios ----

run_mode --paginate    'criterio 1 — { orders, nextCursor } y el cursor'
run_mode --transition  'criterio 2 — PENDING → PULLED'
run_mode --status      'criterio 3 — reporte de estado y 404'
run_mode --no-outbound 'criterio 4 — ninguna llamada saliente'

# ---------------------------------------------------------------------------

printf '\n%d modos fallidos\n' "$FAILS"
[ "$FAILS" -eq 0 ]
