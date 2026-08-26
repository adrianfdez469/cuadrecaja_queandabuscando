#!/usr/bin/env bash
# Sensor determinista del arnés.
#
# Corre las mismas comprobaciones que el CI, en orden de coste creciente, y se
# para en la primera que falla. Cuando falla NO pide ayuda: guarda la salida
# cruda, extrae una firma del error, busca esa firma en la bitácora de problemas
# (.agent/playbook/) e imprime el feedback listo para reinyectar al agente.
#
# Códigos de salida — el bucle de auto-corrección se gobierna con ellos:
#   0  PASA        → sigue al handoff (¿queda alguna lección por anotar?)
#   1  FALLA       → arregla y vuelve a ejecutar
#   2  ESTANCADO   → la misma firma tres intentos seguidos: deja de insistir
#   3  uso incorrecto
set -uo pipefail

cd "$(dirname "$0")/.." || exit 3
# shellcheck source=.agent/lib.sh
. .agent/lib.sh

RUNS=".agent/runs"
PLAYBOOK=".agent/playbook"
SPECS=".agent/specs"
SMOKE_PORT="${SMOKE_PORT:-3100}"

# Orden deliberado: lo que falla más rápido y señala más de cerca, primero.
STAGES_RAPIDO="typecheck lint format test"
STAGES_COMPLETO="harness typecheck lint format test prisma build theme bundle"

stage_cmd() {
  case "$1" in
    harness)   echo "npm run check:harness" ;;
    typecheck) echo "npm run typecheck" ;;
    lint)      echo "npm run lint" ;;
    format)    echo "npm run format:check" ;;
    test)      echo "npm test" ;;
    prisma)    echo "npx prisma validate" ;;
    build)     echo "npm run build" ;;
    theme)     echo "npm run check:theme" ;;
    bundle)    echo "npm run check:bundle" ;;
    smoke)     echo "(servidor de desarrollo + .agent/specs/<ID>/smoke.sh)" ;;
    *)         return 1 ;;
  esac
}

# ---------------------------------------------------------------- firmas ----

# Quita colores, rutas absolutas y espacios de sobra. Lo que queda tiene que ser
# igual entre dos ejecuciones del MISMO fallo, y distinto entre fallos distintos:
# de esa estabilidad depende la detección de estancamiento.
normalize() {
  sed -e $'s/\033\[[0-9;]*[a-zA-Z]//g' \
      -e 's#[A-Za-z]*:\{0,1\}/[^ :()]*/##g' \
      -e 's/[[:space:]]\{1,\}/ /g' \
      -e 's/^ //' -e 's/ $//' |
    cut -c1-110
}

primera_linea_de_error() {
  grep -aiE 'error|fail|✗|✘|not ok|Cannot|Unexpected' "$1" | head -1
}

# La firma es <etapa>:<lo más específico que da esa herramienta>. Un código TS o
# una regla de ESLint identifican el fallo mejor que su mensaje, que cambia con
# el símbolo; para el resto se normaliza el primer error.
extract_signature() { # <etapa> <log>
  local st="$1" log="$2" line=""
  case "$st" in
    typecheck) line="$(grep -aoE 'error TS[0-9]+' "$log" | head -1)" ;;
    lint)      line="$(awk '/^[[:space:]]+[0-9]+:[0-9]+[[:space:]]+error/ { print $NF; exit }' "$log")" ;;
    format)    line="$(grep -aqE 'Code style issues' "$log" && echo 'archivos sin formatear')" ;;
    test)      line="$(grep -aoE '(AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|ZodError|Prisma[A-Za-z]*Error|Error): .*' "$log" | head -1)" ;;
    smoke)     line="$(grep -aoE 'SMOKE FAIL.*' "$log" | head -1)" ;;
  esac
  [ -z "$line" ] && line="$(primera_linea_de_error "$log")"
  [ -z "$line" ] && line="sin mensaje reconocible"
  printf '%s:%s' "$st" "$(printf '%s' "$line" | normalize)"
}

# -------------------------------------------------------------- bitácora ----

es_entrada() {
  case "${1##*/}" in README.md | TEMPLATE.md) return 1 ;; esac
  [ -f "$1" ]
}

# Slugs de .agent/playbook/ cuya 'firma' (ERE) aparece en el log del fallo.
# Es el mismo mecanismo que usa `sdd.sh done` para saber si un fallo ya tiene
# lección escrita: una entrada solo cubre lo que de verdad reconoce.
match_playbook() { # <log>
  local f firma
  [ -d "$PLAYBOOK" ] || return 0
  for f in "$PLAYBOOK"/*.md; do
    es_entrada "$f" || continue
    firma="$(front "$f" firma)"
    { [ -z "$firma" ] || [ "$firma" = "—" ]; } && continue
    grep -aqEi -- "$firma" "$1" 2>/dev/null && basename "$f" .md
  done
}

# Una entrada de bitácora anota en qué features mordió. No se cuenta cuántas
# veces se reintentó (eso mediría la testarudez del agente), sino en cuántos
# features distintos apareció: eso es lo que dice si merece subir a AGENTS.md.
anotar_visto_en() { # <slug> <feature>
  local f="$PLAYBOOK/$1.md" visto tmp
  [ -f "$f" ] || return 0
  [ "$2" = "_libre" ] && return 0
  visto="$(front "$f" visto_en)"
  case " $visto " in *" $2 "* | *"$2,"*) return 0 ;; esac
  tmp="$(mktemp)"
  awk -v id="$2" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm && $0=="---"    { fm=0; print; next }
    fm && /^visto_en:/ {
      v = $0; sub(/^visto_en:[ ]*/, "", v)
      if (v == "" || v == "—") print "visto_en: " id
      else print "visto_en: " v ", " id
      next
    }
    { print }
  ' "$f" >"$tmp" && mv "$tmp" "$f"
}

imprimir_entrada() { # <slug>
  local f="$PLAYBOOK/$1.md"
  printf '  \033[1m%s\033[0m — %s\n' "$1" "$(front "$f" sintoma)"
  printf '     arreglo: %s\n' "$(front "$f" arreglo)"
  printf '     ficha:   %s\n' "$f"
}

# -------------------------------------------------------------- historial ----
# journal.tsv: ts \t intento \t etapa \t resultado \t firma \t log
# Es scratch local (.gitignore): lo que sobrevive al feature es la bitácora.

# Uso incorrecto: sale 3, no 1. No es que el código falle, es que la llamada
# no significa nada.
die_uso() { DIE_CODE=3 die "$@"; }

journal_de() { echo "$RUNS/$1/journal.tsv"; }

# Solo cuentan las ejecuciones reales del sensor: cada una escribe una fila
# FALLA o PASA. DESCARTA no ejecuta nada y no debe desplazar el contador.
siguiente_intento() {
  local j
  j="$(journal_de "$1")"
  [ -f "$j" ] || { echo 1; return; }
  echo $(($(awk -F'\t' '$4=="FALLA" || $4=="PASA"' "$j" | wc -l | tr -d ' ') + 1))
}

# Cuántas veces seguidas termina el historial con esta misma firma.
# DESCARTA es contabilidad, no un intento: si reseteara la racha, descartar una
# firma cualquiera desactivaría ESTANCADO para todas las demás.
repeticiones() { # <feature> <firma>
  local j
  j="$(journal_de "$1")"
  [ -f "$j" ] || { echo 0; return; }
  awk -F'\t' -v f="$2" '
    $4=="DESCARTA" { next }
    { if ($4=="FALLA" && $5==f) n++; else n=0 }
    END { print n+0 }
  ' "$j"
}

apuntar() { # <feature> <intento> <etapa> <resultado> <firma> <log>
  local j
  j="$(journal_de "$1")"
  mkdir -p "$(dirname "$j")"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(now)" "$2" "$3" "$4" "${5//$'\t'/ }" "${6:-—}" >>"$j"
}

# Fallos del historial que todavía no reconoce ninguna entrada de la bitácora
# ni descartó nadie. Es lo que convierte el aprendizaje en obligatorio:
# `sdd.sh done` no cierra el feature mientras esta lista tenga algo.
cmd_pending() { # <feature>
  local id="${1:-_libre}" j log firma
  j="$(journal_de "$id")"
  [ -f "$j" ] || return 0
  awk -F'\t' '
    $4=="DESCARTA" { fuera[$5]=1 }
    $4=="FALLA"    { visto[$5]=$6 }
    END { for (f in visto) if (!(f in fuera)) print f "\t" visto[f] }
  ' "$j" | sort |
    while IFS=$'\t' read -r firma log; do
      # Una entrada cubre el fallo solo si de verdad lo reconoce: se comprueba
      # con el mismo grep que lo habría sugerido durante el bucle.
      [ -f "$log" ] && [ -n "$(match_playbook "$log")" ] && continue
      printf '%s\t%s\n' "$firma" "$log"
    done
}

# Un fallo que no da lección a nadie (un typo, un puerto ocupado) se cierra
# diciéndolo, no callándolo.
cmd_dismiss() { # <feature> <firma> <motivo>
  local id="$1" firma="$2" motivo="${3:-}"
  [ -n "$firma" ] && [ -n "$motivo" ] ||
    die "uso: bash .agent/verify.sh dismiss F-007 '<firma>' 'motivo'"
  [ -f "$(journal_de "$id")" ] || die "no hay ejecuciones registradas de $id."
  apuntar "$id" 0 "—" "DESCARTA" "$firma" "$motivo"
  printf 'Descartado para %s: %s\n  motivo: %s\n' "$id" "$firma" "$motivo"
}

# ----------------------------------------------------------------- etapas ----

correr_etapa() { # <etapa> <log>
  local cmd
  cmd="$(stage_cmd "$1")" || return 3
  printf '$ %s\n\n' "$cmd" >"$2"
  if [ "$1" = "smoke" ]; then
    correr_smoke "$2"
  else
    eval "$cmd" >>"$2" 2>&1
  fi
}

# Feedback de ejecución, no de compilación: levanta la app de verdad, corre las
# peticiones de .agent/specs/<ID>/smoke.sh y deja en el log TAMBIÉN lo que
# escribió el servidor. Un 500 sin la traza del servidor no es feedback.
correr_smoke() { # <log>
  local script="$SPECS/$FEATURE/smoke.sh" srvlog pid i code=0
  if [ ! -f "$script" ]; then
    # Verde sin ejecutar nada es peor que rojo. El prefijo SMOKE FAIL es el que
    # pesca extract_signature, así que entra al journal como cualquier fallo.
    # La firma va sin ruta: normalize borra los directorios y la dejaría ilegible.
    echo "SMOKE FAIL falta el guion de runtime del feature" >>"$1"
    echo "  no existe $script — cópialo de .agent/templates/smoke.sh" >>"$1"
    return 1
  fi
  srvlog="$(mktemp)"
  PORT="$SMOKE_PORT" npx next dev -p "$SMOKE_PORT" >"$srvlog" 2>&1 &
  pid=$!
  for i in $(seq 1 60); do
    curl -sf -o /dev/null "http://localhost:$SMOKE_PORT/" && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    SMOKE_BASE_URL="http://localhost:$SMOKE_PORT" bash "$script" >>"$1" 2>&1
    code=$?
  else
    echo "SMOKE FAIL el servidor de desarrollo no llegó a levantar" >>"$1"
    code=1
  fi
  pkill -P "$pid" 2>/dev/null
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  {
    echo
    echo "--- salida del servidor (runtime feedback) ---"
    tail -80 "$srvlog"
  } >>"$1"
  rm -f "$srvlog"
  # Un error en el servidor cuenta como fallo aunque las peticiones respondan.
  grep -aqE '(⨯|Unhandled|Error:)' "$srvlog" 2>/dev/null && code=1
  return $code
}

# ------------------------------------------------------------------ verify ----

cmd_verify() {
  local etapas="$STAGES_RAPIDO" solo="" smoke=0
  FEATURE="_libre"
  # La misma llamada, para repetirla tal cual tras arreglar. `_libre` es un
  # nombre interno para el trabajo sin feature: no se puede volver a pasar.
  INVOCACION="bash .agent/verify.sh${*:+ $*}"

  while [ $# -gt 0 ]; do
    case "$1" in
      F-[0-9][0-9][0-9]) FEATURE="$1" ;;
      --full) etapas="$STAGES_COMPLETO" ;;
      --smoke) smoke=1 ;;
      --only) shift; solo="${1:-}"; [ -n "$solo" ] || die_uso "uso: --only <etapa>" ;;
      *) die_uso "opción desconocida: $1
uso: bash .agent/verify.sh [F-NNN] [--full] [--smoke] [--only <etapa>]" ;;
    esac
    shift
  done

  [ -n "$solo" ] && etapas="$solo"
  if [ "$smoke" = 1 ]; then
    # El guion de runtime vive en la spec del feature: sin ID no hay qué correr.
    [ "$FEATURE" = "_libre" ] &&
      die_uso "--smoke necesita un F-NNN: el guion vive en .agent/specs/<ID>/smoke.sh
uso: bash .agent/verify.sh F-007 --smoke"
    case " $etapas " in *" smoke "*) ;; *) etapas="$etapas smoke" ;; esac
  fi

  local intento dir
  intento="$(siguiente_intento "$FEATURE")"
  dir="$RUNS/$FEATURE"
  mkdir -p "$dir"

  titulo "== Verificación $FEATURE · intento $intento =="

  local st log t0 code=0 fallada=""
  for st in $etapas; do
    stage_cmd "$st" >/dev/null || die_uso "etapa desconocida: $st"
    log="$(printf '%s/%03d-%s.log' "$dir" "$intento" "$st")"
    t0=$SECONDS
    correr_etapa "$st" "$log"
    code=$?
    if [ "$code" -eq 0 ]; then
      ok "$(printf '%-10s %s' "$st" "$((SECONDS - t0))s")"
    else
      bad "$(printf '%-10s %s  (salida %s)' "$st" "$((SECONDS - t0))s" "$code")"
      fallada="$st"
      break
    fi
  done

  [ -n "$fallada" ] || { pasa "$intento"; return 0; }

  # ---- FALLA: capturar, firmar, consultar la bitácora, reinyectar ----
  local firma slugs veces
  firma="$(extract_signature "$fallada" "$log")"
  slugs="$(match_playbook "$log")"
  apuntar "$FEATURE" "$intento" "$fallada" "FALLA" "$firma" "$log"
  veces="$(repeticiones "$FEATURE" "$firma")"

  echo
  printf '\033[31mFALLA en %s.\033[0m\n' "$fallada"
  echo
  echo "--- FEEDBACK DE EJECUCIÓN (salida real, sin resumir) ---"
  # Vitest y tsc entierran la causa en el medio y el resumen al final. Se
  # muestran las dos cosas: las líneas de error, y la cola. Si el log es corto,
  # se muestra entero y no hace falta ni una cosa ni la otra.
  local total errores
  total="$(wc -l <"$log" | tr -d ' ')"
  if [ "$total" -le 40 ]; then
    cat "$log"
  else
    errores="$(grep -aE 'error|Error|✗|FAIL|Unexpected|Cannot' "$log" | head -20)"
    [ -n "$errores" ] && printf '%s\n\n  […]\n\n' "$errores"
    tail -25 "$log"
  fi
  echo "--- fin del feedback ---"
  echo "log completo: $log"
  echo
  printf 'Firma: \033[1m%s\033[0m\n' "$firma"

  if [ -n "$slugs" ]; then
    echo
    titulo "YA NOS PASÓ — la bitácora reconoce este fallo:"
    for s in $slugs; do
      imprimir_entrada "$s"
      anotar_visto_en "$s" "$FEATURE"
    done
    echo "  Lee la ficha ANTES de improvisar. Si el arreglo que propone ya no"
    echo "  sirve, corrígela: una ficha que miente cuesta más que ninguna."
  else
    echo
    warn "La bitácora no reconoce este fallo. Si resulta ser una trampa del"
    printf '    repo y no un descuido, al arreglarlo: bash .agent/sdd.sh learn <slug>\n'
  fi

  echo
  if [ "$veces" -ge 3 ]; then
    printf '\033[31m== ESTANCADO ==\033[0m\n'
    echo "Es la ${veces}ª vez seguida con la MISMA firma. Deja de auto-corregir:"
    echo "  · si el plan no aguanta   → vuelve a sdd-architect"
    echo "  · si el requisito no cierra → vuelve a sdd-spec"
    echo "  · si hace falta más alcance del que el humano firmó en plan.md → se"
    echo "    reescribe el plan y se vuelve a firmar; no se amplía por el camino"
    echo "  · si es decisión de producto o toca algo prohibido → pregunta al humano"
    return 2
  fi
  [ "$veces" -eq 2 ] && warn "Segundo intento con la misma firma: cambia de hipótesis, no de sintaxis."
  echo "Siguiente: arregla y vuelve a ejecutar → $INVOCACION"
  return 1
}

# El handoff empieza aquí, no cuando alguien se acuerda: al pasar, el sensor
# dice qué fallos de este ciclo siguen sin lección escrita.
pasa() { # <intento>
  apuntar "$FEATURE" "$1" "todas" "PASA" "—" "—"
  echo
  printf '\033[32mPASA\033[0m\n'
  local pend
  pend="$(cmd_pending "$FEATURE")"
  if [ -n "$pend" ]; then
    echo
    titulo "Antes de cerrar — fallos de este ciclo sin entrada en la bitácora:"
    printf '%s\n' "$pend" | while IFS=$'\t' read -r f l; do
      printf '  · %s\n    (%s)\n' "$f" "$l"
    done
    echo
    echo "Por cada uno que sea una trampa del repo y no un descuido tuyo:"
    echo "  bash .agent/sdd.sh learn <slug>       escribe la ficha"
    echo "  bash .agent/verify.sh dismiss $FEATURE '<firma>' 'motivo'"
    echo "                                        si no da lección a nadie"
    echo "sdd.sh done no cierra el feature mientras esta lista tenga algo."
  fi
}

case "${1:-}" in
  pending)
    shift
    cmd_pending "${1:-_libre}"
    ;;
  dismiss)
    shift
    [ $# -ge 2 ] || die "uso: bash .agent/verify.sh dismiss F-007 '<firma>' 'motivo'"
    cmd_dismiss "$@"
    ;;
  journal)
    shift
    j="$(journal_de "${1:-_libre}")"
    [ -f "$j" ] || { echo "(sin ejecuciones registradas)"; exit 0; }
    printf '%-22s %-4s %-10s %-6s %s\n' FECHA Nº ETAPA RESULT FIRMA
    awk -F'\t' '{ printf "%-22s %-4s %-10s %-6s %s\n", $1, $2, $3, $4, $5 }' "$j"
    ;;
  -h | --help | help)
    cat <<'HELP'
Sensor determinista del arnés. Corre las comprobaciones del CI —salvo las que
necesitan Postgres, que solo se ven allí— y, si algo falla, devuelve el feedback
y lo que la bitácora sepa de ese fallo.

  bash .agent/verify.sh F-007              typecheck · lint · format · test
  bash .agent/verify.sh F-007 --full       + prisma · build · theme · bundle
  bash .agent/verify.sh F-007 --smoke      + app levantada y peticiones reales
  bash .agent/verify.sh F-007 --only test  una sola etapa
  bash .agent/verify.sh journal F-007      historial de intentos
  bash .agent/verify.sh pending F-007      fallos sin lección escrita
  bash .agent/verify.sh dismiss F-007 '<firma>' 'motivo'   fallo sin lección

Salida: 0 PASA · 1 FALLA · 2 ESTANCADO (misma firma 3 veces) · 3 uso incorrecto
HELP
    ;;
  *)
    cmd_verify "$@"
    ;;
esac
