#!/usr/bin/env bash
# Las solicitudes que el equipo de cuadrecaja nos deja escritas EN SU REPO, y qué
# contestamos nosotros. El documento de ellos es la fuente; `.agent/solicitudes.md`
# es nuestra respuesta. Este script cruza los dos y dice si hay algo nuevo.
#
# Nunca falla: una sesión que no toca la integración tiene que seguir leyendo
# ENTORNO LISTO con el repo de cuadrecaja ausente o desactualizado.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# shellcheck source=.agent/lib.sh
. .agent/lib.sh

DOC_REL=".agents/solicitudes-qab.md"      # dónde vive dentro del repo de ellos
LEDGER=".agent/solicitudes.md"            # nuestra respuesta, una fila por solicitud
PIN=".agent/cuadrecaja.path"              # ruta fijada a mano (no se commitea)
SEEN=".agent/runs/solicitudes-qab.sha"    # huella de lo último que miramos, por máquina

BREVE=0
case "${1:-}" in
  --breve) BREVE=1 ;;
  "") ;;
  *) DIE_CODE=3 die "uso: bash .agent/solicitudes.sh [--breve]" ;;
esac

expandir() { case "$1" in "~") printf '%s' "$HOME" ;; "~/"*) printf '%s' "$HOME/${1#\~/}" ;; *) printf '%s' "$1" ;; esac; }

# Vale tanto la raíz del repo como la ruta del propio documento, que es lo que
# uno acaba pegando cuando lo tiene delante. Imprime el documento, o nada.
doc_en() {
  case "$1" in
    "") return 1 ;;
    */solicitudes-qab.md) [ -f "$1" ] && printf '%s\n' "$1" ;;
    *) [ -f "$1/$DOC_REL" ] && printf '%s\n' "$1/$DOC_REL" ;;
  esac
}

# La ruta del repo de cuadrecaja es de cada máquina, así que no se escribe en
# ningún archivo versionado: primero lo que alguien fijó a mano, y si no, los
# hermanos del directorio de trabajo Y del checkout principal — media jornada se
# trabaja desde un worktree, cuyo padre no es el padre del repo.
autodetectar() {
  local raiz padre cand
  raiz="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  for padre in "$(dirname "$PWD")" "$(dirname "$(dirname "${raiz:-/nonexistent/.git}")")"; do
    for cand in "$padre/cuadrecaja" "$padre/cuadre-caja/cuadrecaja"; do
      doc_en "$cand" && return 0
    done
  done
  return 1
}

# Los ids son las filas que empiezan por `| S-NNN` en la tabla «## Abiertas» de
# cualquiera de los dos documentos — solo esa sección: los dos tienen debajo
# detalle y cerradas, y una solicitud ya zanjada no puede volver a avisar.
# Una tabla es un formato pobre para parsear y perfecto para leer: gana leer, y
# de aquí solo salen la primera columna y el texto de otra.
ids_de() {
  awk '/^## Abiertas/ { dentro = 1; next } /^## / { dentro = 0 } dentro' "$1" 2>/dev/null |
    grep -oE '^\|[[:space:]]*S-[0-9]{3}' | grep -oE 'S-[0-9]{3}' | sort -u
}
# columna n de la fila de <id>. col <archivo> <id> <n>
col() { awk -F'|' -v id="$2" -v n="$3" '$2 ~ id { gsub(/^[ \t]+|[ \t]+$/, "", $(n)); print $(n); exit }' "$1"; }

FIJADA=""; FUENTE=""
if [ -n "${CUADRECAJA_REPO:-}" ]; then
  FIJADA="$(expandir "$CUADRECAJA_REPO")"; FUENTE="\$CUADRECAJA_REPO"
elif [ -f "$PIN" ]; then
  FIJADA="$(expandir "$(grep -vE '^[[:space:]]*(#|$)' "$PIN" | head -1)")"; FUENTE="$PIN"
fi

DOC=""
if [ -n "$FIJADA" ]; then
  DOC="$(doc_en "$FIJADA")"
  # Una ruta fijada que no vale se dice, nunca se ignora en silencio: quien la
  # escribió cree que está mirando su documento.
  [ -n "$DOC" ] || warn "$FUENTE apunta a $FIJADA, que no contiene $DOC_REL — sigo buscando por mi cuenta"
fi
[ -n "$DOC" ] || DOC="$(autodetectar)"

if [ -z "$DOC" ]; then
  warn "no encuentro el repo de cuadrecaja — sin él no se ven sus solicitudes.
    Fíjalo con: echo '/ruta/a/cuadrecaja' > $PIN   (o export CUADRECAJA_REPO=...)"
  exit 0
fi

ABIERTAS="$(ids_de "$DOC")"
NUESTRAS="$(ids_de "$LEDGER")"
SIN_TRIAR="$(comm -23 <(printf '%s\n' "$ABIERTAS") <(printf '%s\n' "$NUESTRAS") | grep -c . )"
CERRADAS="$(comm -13 <(printf '%s\n' "$ABIERTAS") <(printf '%s\n' "$NUESTRAS") | grep -c . )"
TOTAL="$(printf '%s\n' "$ABIERTAS" | grep -c .)"

# Un id que ya está en las dos tablas deja de avisar para siempre, y entonces una
# solicitud reescrita pasaría inadvertida. La huella cubre ese hueco: cambia el
# texto, cambia el sha, y esta máquina lo dice una vez.
HUELLA="$(shasum -a 256 "$DOC" 2>/dev/null | cut -d' ' -f1)"
CAMBIO=0
[ -f "$SEEN" ] && [ "$(cat "$SEEN" 2>/dev/null)" = "$HUELLA" ] || CAMBIO=1

if [ "$BREVE" -eq 1 ]; then
  if [ "$SIN_TRIAR" -gt 0 ]; then
    warn "$SIN_TRIAR solicitud(es) de cuadrecaja sin triar de $TOTAL abiertas — bash .agent/solicitudes.sh"
  elif [ "$CAMBIO" -eq 1 ]; then
    warn "su documento de solicitudes cambió desde la última vez — bash .agent/solicitudes.sh"
  elif [ "$CERRADAS" -gt 0 ]; then
    warn "$CERRADAS solicitud(es) ya no están abiertas para ellos — cierra su fila en $LEDGER"
  else
    ok "$TOTAL solicitud(es) de cuadrecaja, todas con postura anotada en $LEDGER"
  fi
  exit 0
fi

titulo "Solicitudes de cuadrecaja"
echo "  fuente: $DOC"
echo "  nuestra respuesta: $LEDGER"
[ "$CAMBIO" -eq 1 ] && warn "el documento cambió desde la última vez que se miró en esta máquina"
echo

for id in $ABIERTAS; do
  pide="$(col "$DOC" "$id" 3)"
  if printf '%s\n' "$NUESTRAS" | grep -qx "$id"; then
    ok "$id · $pide
      nuestra postura: $(col "$LEDGER" "$id" 4)"
  else
    warn "$id · $pide
      SIN TRIAR — léela entera en el documento de ellos y anota la postura en $LEDGER"
  fi
done

for id in $(comm -13 <(printf '%s\n' "$ABIERTAS") <(printf '%s\n' "$NUESTRAS")); do
  warn "$id ya no está en su tabla de abiertas — la dieron por resuelta o retirada; cierra su fila en $LEDGER"
done

echo
echo "Qué hacer con una solicitud nueva, en este orden:"
echo "  1. Leerla entera en $DOC — la tabla es el índice, no la solicitud."
echo "  2. Anotar la postura en $LEDGER (una fila; sin triar no cuenta)."
echo "  3. Si aceptamos y toca construir: el feature lo escribe el humano en"
echo "     .agent/features.json, o queda como idea con 'sdd.sh propose <slug>'."
echo "  4. Si cambia lo que el POS envía o recibe: versión nueva de"
echo "     docs/sync-contract.md, mayor, coordinada con ellos (AGENTS.md § Documentación)."

mkdir -p "$(dirname "$SEEN")" && printf '%s\n' "$HUELLA" > "$SEEN"
