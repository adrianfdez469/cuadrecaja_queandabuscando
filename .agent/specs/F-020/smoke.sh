#!/usr/bin/env bash
# Verificación en runtime de F-020 (el timbre de Realtime). La ejecuta
# `bash .agent/verify.sh F-020 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL, la base sembrada (`npm run seed`) y el emulador de
# Realtime arriba (`docker compose up -d`) — sin él, cada modo aborta con un
# error de conexión al minar la credencial, que es exactamente el fallo que
# hay que ver, no esconder.
#
# El grueso vive en scripts/realtime-bell.mjs (nueve modos, uno por criterio
# de runtime de spec.md § "Criterios de aceptación propuestos" — 1, 2, 3, 4,
# 8, 9, 10, 11 y 13; los otros ocho criterios los verifica `verify.sh --full`
# sin runtime, o son el propio `--full --smoke`); este guion solo lo invoca
# con la URL correcta y traduce sus fallos ("FAIL  <label>") al prefijo
# "SMOKE FAIL" que el sensor busca — el guion de modos es reutilizable fuera
# de verify.sh (se puede correr a mano contra cualquier QAB_BASE_URL) y no
# tiene por qué conocer esa convención.
#
# Los criterios 3 y 11 detienen y vuelven a levantar el contenedor
# `realtime` (docker/README, architecture.md § Riesgos): Next 16 solo admite
# UN `next dev` por directorio, y ese ya lo tiene levantado `verify.sh` —
# no hay forma de reiniciarlo con otra URL a mitad de la corrida.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

export QAB_BASE_URL="${SMOKE_BASE_URL:-http://localhost:3100}"

OUTPUT="$(node scripts/realtime-bell.mjs 2>&1)"
STATUS=$?

echo "$OUTPUT" | sed -E 's/^FAIL  /SMOKE FAIL /'

exit "$STATUS"
