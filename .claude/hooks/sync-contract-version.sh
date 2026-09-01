#!/usr/bin/env bash
# PostToolUse: avisa si docs/sync-contract.md se editó sin mover la versión de
# su línea 3. La regla está en AGENTS.md § Documentación y en el propio
# contrato, § «Versionado de este documento».
set -uo pipefail

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null)
[ -n "$file" ] || exit 0

case "$file" in
  docs/sync-contract.md | */docs/sync-contract.md) ;;
  *) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
doc="$root/docs/sync-contract.md"
[ -f "$doc" ] || exit 0

# Sin cambios respecto a HEAD no hay nada que versionar.
git -C "$root" diff --quiet HEAD -- docs/sync-contract.md 2>/dev/null && exit 0

ahora=$(sed -n 3p "$doc")
antes=$(git -C "$root" show HEAD:docs/sync-contract.md 2>/dev/null | sed -n 3p)
[ -n "$antes" ] || exit 0
[ "$ahora" = "$antes" ] || exit 0

msg="docs/sync-contract.md cambió pero su línea 3 sigue en «${ahora}». Toda edición del contrato mueve la versión: mayor (5 → 6) si cambia lo que el POS envía o recibe, menor (5 → 5.1) si solo aclara lo ya acordado. Actualiza la línea 3 y añade la entrada en «Cambios respecto a la vN»."
jq -nc --arg m "$msg" '{systemMessage:$m, hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$m}}'
