#!/usr/bin/env bash
# Verificación en runtime de F-019 (la renegociación del pedido). La ejecuta
# `bash .agent/verify.sh F-019 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL y con la base sembrada (`npm run seed`): tienda-demo
# (WHATSAPP, sin envío) y tienda-dos (ONSITE, con envío), las dos del negocio
# seed-negocio-1.
#
# El grueso vive en scripts/renegotiate-order.mjs (siete modos, uno por
# criterio de spec.md § "Criterios de aceptación propuestos"); este guion
# solo lo invoca con la URL correcta y traduce sus fallos ("FAIL  <label>")
# al prefijo "SMOKE FAIL" que el sensor busca — el guion de modos es
# reutilizable fuera de verify.sh (se puede correr a mano contra cualquier
# QAB_BASE_URL) y no tiene por qué conocer esa convención.
#
# Cubre los criterios 1, 2, 3, 4(a), 5, 7 y 9. El 4(b) lo cubre
# src/features/orders/server/expiry.db.test.ts (--project db, contra
# Postgres real); el 6 y el 8 los cubre este mismo guion (6, dentro de
# --approve) y verify.sh --full + un grep sobre docs/sync-contract.md (8);
# el 10 es el propio "verify.sh --full = 0".
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

export QAB_BASE_URL="${SMOKE_BASE_URL:-http://localhost:3100}"

OUTPUT="$(node scripts/renegotiate-order.mjs 2>&1)"
STATUS=$?

echo "$OUTPUT" | sed -E 's/^FAIL  /SMOKE FAIL /'

exit "$STATUS"
