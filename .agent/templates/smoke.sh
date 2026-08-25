#!/usr/bin/env bash
# Verificación en runtime del feature F-XXX. La ejecuta `bash .agent/verify.sh
# F-XXX --smoke` con la app ya levantada; $SMOKE_BASE_URL apunta a ella.
#
# Regla: cada aserción que no se cumpla imprime `SMOKE FAIL <qué>` y suma un
# fallo. Eso es lo que el sensor busca para poner firma al error. Lo que escriba
# el servidor se guarda aparte y se pega al mismo log: no hace falta capturarlo.
set -uo pipefail

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

code() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1"; }
body() { curl -s "$BASE$1"; }

# --- Ejemplos; sustitúyelos por los escenarios E1..En de spec.md -------------

check "la tienda de ejemplo responde" 200 "$(code /tienda-demo)"

# El catálogo tiene que leerse sin JavaScript: si el nombre del producto no está
# en el HTML que llega, se está renderizando en cliente.
if body /tienda-demo | grep -q "Producto de ejemplo"; then
  printf '  ok   el catálogo viene en el HTML\n'
else
  printf 'SMOKE FAIL el catálogo no viene en el HTML del servidor\n'
  FAILS=$((FAILS + 1))
fi

# ----------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
