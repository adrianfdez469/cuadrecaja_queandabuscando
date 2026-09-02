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
# Distinto del de smoke: las dos etapas pueden pedirse en la misma ejecución.
VISUAL_PORT="${VISUAL_PORT:-3101}"
# Distinto de los otros dos por el mismo motivo, y porque `probe` arranca y
# rearranca su PROPIO next dev (no lo levanta esta etapa — DA6 de F-030).
PROBE_PORT="${PROBE_PORT:-3102}"

# Orden deliberado: lo que falla más rápido y señala más de cerca, primero.
# Lo que cuenta como «el servidor petó» en el log de next dev, para las etapas
# que levantan la app. ERE POSIX puro a propósito: verify.sh corre con el grep
# real del sistema (BSD en macOS), que no entiende \b ni \w — ficha
# playbook-firma-grep-bsd-no-gnu.
#
# El patrón anterior, '(⨯|Unhandled|Error:)', fallaba por los DOS lados sobre un
# error real de Supabase Auth: la línea que importa, «Error [AuthApiError]: …»,
# NO contiene la subcadena «Error:» y se escapaba; y la que sí disparaba era el
# relleno del volcado, «  __isAuthError: true,». Ahora se exige que la línea
# EMPIECE por algo acabado en Error (TypeError, AuthApiError, Error a secas),
# que es como los imprime Node. El prefijo exige mayúscula inicial para que una
# línea de aplicación como «onError: ...» no dispare el guardián.
SERVIDOR_ERROR_RE='(⨯|Unhandled|^[[:space:]]*([A-Z][A-Za-z]*)?Error([^A-Za-z0-9_]|$))'

# La única excepción del guardián, y se justifica o se quita — cada excepción en
# un sensor lo erosiona un poco. La imprime @supabase/auth-js, NO código de este
# repo, cuando se le presenta un token de refresco ya revocado (una pestaña que
# sobrevive al logout de otra, o un smoke que sigue usando el frasco de cookies
# viejo a propósito para afirmar que /cuenta vuelve a exigir entrar).
#
# auth-js YA clasifica esta situación como warn en vez de error, pero solo para
# los códigos refresh_token_not_found, refresh_token_already_used y
# session_expired (GoTrueClient.js:3663-3676). El emulador local
# (supabase/auth:v2.196.0) responde error_code: validation_failed, que no está
# en esa lista, así que sale por console.error. Comprobado con una petición
# directa al emulador, no deducido.
#
# Si algún día el emulador devuelve el código correcto, esta línea sobra.
SERVIDOR_ERROR_IGNORAR_RE='Error \[AuthApiError\]: Refresh token is not valid'

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
    visual)    echo "(servidor de desarrollo + chromium headless + .agent/specs/<ID>/visual.mjs)" ;;
    probe)     echo "(servidor propio + proxy lento + scripts/order-link-probe.mjs)" ;;
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
    visual)    line="$(grep -aoE 'VISUAL FAIL.*' "$log" | head -1)" ;;
    probe)     line="$(grep -aoE 'PROBE FAIL.*' "$log" | head -1)" ;;
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
  elif [ "$1" = "visual" ]; then
    correr_visual "$2"
  elif [ "$1" = "probe" ]; then
    correr_probe "$2"
  else
    eval "$cmd" >>"$2" 2>&1
  fi
}

# Feedback de ejecución, no de compilación: levanta la app de verdad, corre las
# peticiones de .agent/specs/<ID>/smoke.sh y deja en el log TAMBIÉN lo que
# Nadie más puede estar escuchando en el puerto que vamos a usar. Si lo está, el
# `next dev` de abajo no consigue el puerto —o Next elige otro y nadie se enteraría—
# y el sensor acabaría probando la aplicación de un extraño y saliendo VERDE. Pasó
# de verdad: un `next dev` de OTRO checkout del mismo repo ocupando el 3000 hace
# creer que un feature no se implementó. Verde contra la app equivocada es la peor
# salida posible del sensor, así que esto falla antes de levantar nada.
# El puerto de un `next-server` que ya esté corriendo DESDE ESTE directorio, o
# vacío. Se compara el cwd del proceso, no el nombre: en esta máquina hay varios
# checkouts del mismo repo y el de al lado sirve código distinto —fue justo la
# confusión que hizo creer que F-010 no estaba implementado.
servidor_propio() {
  local raiz pid cwd puerto
  raiz="$(pwd -P)"
  for pid in $(pgrep -f 'next-server' 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    [ "$cwd" = "$raiz" ] || continue
    puerto="$(lsof -Pan -p "$pid" -i -sTCP:LISTEN 2>/dev/null |
      sed -n 's/.*:\([0-9]\{1,\}\) (LISTEN).*/\1/p' | head -1)"
    [ -n "$puerto" ] && { echo "$puerto"; return 0; }
  done
  return 0
}

puerto_libre() { # <puerto> <prefijo-de-firma> <log>
  local ocupa
  ocupa="$(lsof -tPan -i "TCP:$1" -s TCP:LISTEN 2>/dev/null | head -1)"
  [ -z "$ocupa" ] && return 0
  {
    printf '%s el puerto %s ya está ocupado por el PID %s\n' "$2" "$1" "$ocupa"
    printf '  %s\n' "$(ps -p "$ocupa" -o command= 2>/dev/null | cut -c1-100)"
    printf '  Levantar la app ahí probaría OTRA aplicación y podría salir verde.\n'
    printf '  Ciérralo (kill %s) o usa otro puerto: SMOKE_PORT=3101 bash .agent/verify.sh …\n' "$ocupa"
  } >>"$3"
  return 1
}

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
  # Mismo motivo que en correr_visual, que ya lo hacía: Next 16 admite UN solo
  # `next dev` por directorio, y no lo decide por el puerto. Lanzar otro muere
  # con «Another next dev server is already running» aunque le des un puerto
  # libre. Faltaba aquí, y se pagó en el CI: dos etapas smoke en el mismo
  # trabajo (F-028 y F-020), la segunda sin poder levantar el suyo.
  local puerto=""
  puerto="$(servidor_propio)"
  if [ -n "$puerto" ]; then
    printf '  (reutilizo el next dev de este worktree en el puerto %s)\n' "$puerto" >>"$1"
    srvlog="$(mktemp)"
    pid=""
  else
    puerto="$SMOKE_PORT"
    puerto_libre "$puerto" "SMOKE FAIL" "$1" || return 1
    srvlog="$(mktemp)"
    PORT="$puerto" npx next dev -p "$puerto" >"$srvlog" 2>&1 &
    pid=$!
    for i in $(seq 1 60); do
      curl -sf -o /dev/null "http://localhost:$puerto/" && break
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
  fi
  if [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; then
    SMOKE_BASE_URL="http://localhost:$puerto" bash "$script" >>"$1" 2>&1
    code=$?
  else
    echo "SMOKE FAIL el servidor de desarrollo no llegó a levantar" >>"$1"
    code=1
  fi
  if [ -n "$pid" ]; then
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  fi
  {
    echo
    echo "--- salida del servidor (runtime feedback) ---"
    if [ -z "$pid" ]; then
      # Igual que en correr_visual: un «--- salida del servidor ---» vacío se
      # lee como «el servidor no dijo nada», que es la conclusión contraria a
      # la verdadera. Aquí NO se miró.
      echo "  (no capturada: se reutilizó el next dev del puerto $puerto,"
      echo "   que escribe en la terminal donde se lanzó. El guardián de"
      echo "   errores de servidor NO se aplica en esta corrida.)"
    else
      tail -80 "$srvlog"
    fi
  } >>"$1"
  # Un error en el servidor cuenta como fallo aunque las peticiones respondan.
  # El grep va ANTES del rm: al revés miraba un archivo recién borrado, salía 2
  # con el «No such file» tragado por 2>/dev/null, y el guardián no disparó
  # NUNCA — ni aquí ni en correr_visual — desde que se escribió (87d8ce2).
  # Solo cuando el log es nuestro: sobre el del servidor reutilizado no hay nada
  # que mirar, y un archivo vacío daría un verde que nadie ha comprobado.
  if [ -n "$pid" ]; then
    guardian_servidor "$srvlog" "SMOKE FAIL" "$1" || code=1
  fi
  rm -f "$srvlog"
  return $code
}

# El guardián de errores del servidor: una etapa que levanta la app no puede
# darse por buena solo porque las peticiones respondieran. Imprime SIEMPRE una
# línea con el prefijo de fallo de su etapa, y no solo devuelve el código: sin
# esa línea, `extract_signature` no encuentra prefijo, cae en la primera línea
# de error que pille y la firma cambia entre corridas — con lo que el corte a
# los tres intentos (ESTANCADO) deja de cortar.
guardian_servidor() {
  local srvlog="$1" prefijo="$2" destino="$3" linea=""
  linea="$(grep -aE "$SERVIDOR_ERROR_RE" "$srvlog" 2>/dev/null |
    grep -avE "$SERVIDOR_ERROR_IGNORAR_RE" | head -1)"
  [ -z "$linea" ] && return 0
  {
    echo
    echo "$prefijo el servidor registró un error, aunque las peticiones respondieran:"
    echo "  $linea"
    echo "  (guardián de $SERVIDOR_ERROR_RE sobre la salida de next dev)"
  } >>"$destino"
  return 1
}

# Lo que `curl` no puede ver: si la lista salta, si el foco va donde debe, si el
# formulario es anunciable, si la pantalla aguanta un viewport de 360 px o una
# conexión de 3G. Levanta la app y se la entrega a un Chromium headless que
# maneja `.agent/specs/<ID>/visual.mjs`.
#
# Headless y por Bash a propósito: la extensión de Chrome necesita que un humano
# la conecte, no existe en CI y no es reproducible entre sesiones. Esta etapa la
# corre cualquier agente que tenga Bash, que son todos.
correr_visual() { # <log>
  local script="$SPECS/$FEATURE/visual.mjs" srvlog shots traces pid i code=0
  if [ ! -f "$script" ]; then
    # Misma regla que smoke: un feature con interfaz que no tiene guion visual no
    # está «sin comprobar», está en rojo. F-010 se cerró con 22 pasos visuales sin
    # ejecutar precisamente porque nada lo impedía.
    echo "VISUAL FAIL falta el guion visual del feature" >>"$1"
    echo "  no existe $script — cópialo de .agent/templates/visual.mjs" >>"$1"
    return 1
  fi
  if [ ! -d node_modules/playwright ]; then
    echo "VISUAL FAIL playwright no está instalado" >>"$1"
    echo "  npm install --save-dev playwright && npx playwright install chromium" >>"$1"
    return 1
  fi
  shots="$RUNS/$FEATURE/shots"
  rm -rf "$shots"
  mkdir -p "$shots"
  # El trace (si el guion lo graba con context.tracing) es lo único que deja
  # "reproducir" la corrida entera con `npx playwright show-trace <zip>` —
  # headless no tiene ventana que ver en vivo, esto es el sustituto.
  traces="$RUNS/$FEATURE/traces"
  rm -rf "$traces"
  mkdir -p "$traces"

  # Next 16 solo admite UN `next dev` por directorio, sea el puerto que sea: si
  # ya hay uno de ESTE worktree, lanzar otro muere con «Another next dev server
  # is already running» y el sensor solo veía «no llegó a levantar». Reutilizarlo
  # es además lo correcto — es el servidor que el humano está mirando.
  local puerto=""
  puerto="$(servidor_propio)"
  if [ -n "$puerto" ]; then
    printf '  (reutilizo el next dev de este worktree en el puerto %s)\n' "$puerto" >>"$1"
    srvlog="$(mktemp)"
    pid=""
  else
    puerto="$VISUAL_PORT"
    puerto_libre "$puerto" "VISUAL FAIL" "$1" || return 1
    srvlog="$(mktemp)"
    PORT="$puerto" npx next dev -p "$puerto" >"$srvlog" 2>&1 &
    pid=$!
    for i in $(seq 1 60); do
      curl -sf -o /dev/null "http://localhost:$puerto/" && break
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
  fi

  if curl -sf -o /dev/null "http://localhost:$puerto/"; then
    VISUAL_BASE_URL="http://localhost:$puerto" VISUAL_SHOTS="$shots" VISUAL_TRACES="$traces" \
      node "$script" >>"$1" 2>&1
    code=$?
  else
    echo "VISUAL FAIL el servidor de desarrollo no responde en $puerto" >>"$1"
    code=1
  fi
  if [ -n "$pid" ]; then
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  fi
  {
    echo
    printf -- '--- capturas en %s ---\n' "$shots"
    ls -1 "$shots" 2>/dev/null | sed 's/^/  /'
    echo
    printf -- '--- traces en %s (npx playwright show-trace <archivo>) ---\n' "$traces"
    ls -1 "$traces" 2>/dev/null | sed 's/^/  /'
    echo
    echo "--- salida del servidor (runtime feedback) ---"
    if [ -z "$pid" ]; then
      # Servidor reutilizado: lo lanzó el humano en su terminal y su salida va
      # allí, no a este archivo. Decirlo importa — un «--- salida del servidor
      # ---» vacío se lee como «el servidor no dijo nada», que es justo la
      # conclusión contraria a la verdadera: aquí NO se miró.
      echo "  (no capturada: se reutilizó el next dev del puerto $puerto,"
      echo "   que escribe en la terminal donde se lanzó. El guardián de"
      echo "   errores de servidor NO se aplica en esta corrida.)"
    else
      tail -80 "$srvlog"
    fi
  } >>"$1"
  # Mismo guardián que en correr_smoke, y por el mismo motivo: antes del rm.
  # Solo cuando el log es nuestro: sobre el del servidor reutilizado no hay nada
  # que mirar, y un archivo vacío daría un verde que nadie ha comprobado.
  if [ -n "$pid" ]; then
    guardian_servidor "$srvlog" "VISUAL FAIL" "$1" || code=1
  fi
  rm -f "$srvlog"
  return $code
}

# Provoca el fallo de verdad de F-030: un proxy lento delante del Auth real de
# F-028, para ver el instrumento de src/features/account/server/orderLinkObserver.ts
# dispararse en condiciones reales. A diferencia de smoke/visual, esta etapa
# NUNCA reutiliza un `next dev` ajeno: el guion necesita arrancar el suyo con
# `NEXT_PUBLIC_SUPABASE_URL` apuntando a un proxy que él mismo levanta, y
# necesita rearrancarlo a mitad de camino con otro entorno (corrida F) — nada
# de eso se puede hacer sobre un servidor que ya está corriendo con otra
# configuración (architecture.md § F-030 DA6).
correr_probe() { # <log>
  local script="scripts/order-link-probe.mjs" srvlog puerto_propio code=0 i
  if [ ! -f "$script" ]; then
    echo "PROBE FAIL falta el guion del probe" >>"$1"
    echo "  no existe $script" >>"$1"
    return 1
  fi

  # A diferencia de smoke/visual: si YA hay un next dev de este worktree, esta
  # etapa FALLA en vez de reutilizarlo — ese servidor apunta al Auth real sin
  # retraso y su salida no va a ningún archivo que esta etapa pueda leer.
  puerto_propio="$(servidor_propio)"
  if [ -n "$puerto_propio" ]; then
    {
      printf 'PROBE FAIL ya hay un next dev de este worktree en el puerto %s\n' "$puerto_propio"
      echo "  Esta etapa no puede reutilizarlo: necesita arrancar el suyo con"
      echo "  NEXT_PUBLIC_SUPABASE_URL apuntando a su proxy lento y necesita"
      echo "  capturar su salida en un archivo propio. Ciérralo y repite."
    } >>"$1"
    return 1
  fi

  puerto_libre "$PROBE_PORT" "PROBE FAIL" "$1" || return 1

  srvlog="$(mktemp)"
  PROBE_PORT="$PROBE_PORT" PROBE_SERVER_LOG="$srvlog" node "$script" >>"$1" 2>&1
  code=$?

  {
    echo
    echo "--- salida del servidor (runtime feedback) ---"
    tail -120 "$srvlog"
  } >>"$1"
  # Mismo guardián que smoke/visual, y por el mismo motivo: antes del rm.
  guardian_servidor "$srvlog" "PROBE FAIL" "$1" || code=1
  rm -f "$srvlog"

  # El guion limpia su propio next dev en su `finally`/SIGINT, pero esta etapa
  # no se fía a ciegas: un next dev huérfano rompe el smoke de CUALQUIER otro
  # feature con un mensaje que no dice la causa (AGENTS.md § "Un solo next
  # dev por directorio"). Hasta ~5s de espera antes de darlo por fallado.
  for i in $(seq 1 10); do
    lsof -tPan -i "TCP:$PROBE_PORT" -s TCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.5
  done
  if lsof -tPan -i "TCP:$PROBE_PORT" -s TCP:LISTEN >/dev/null 2>&1; then
    {
      printf 'PROBE FAIL el puerto %s sigue ocupado tras terminar el guion\n' "$PROBE_PORT"
      echo "  el guion dejó un next dev huérfano — mátalo antes de verificar otro feature"
    } >>"$1"
    code=1
  fi

  return $code
}

# ------------------------------------------------------------------ verify ----

cmd_verify() {
  local etapas="$STAGES_RAPIDO" solo="" smoke=0 visual=0 probe=0
  FEATURE="_libre"
  # La misma llamada, para repetirla tal cual tras arreglar. `_libre` es un
  # nombre interno para el trabajo sin feature: no se puede volver a pasar.
  INVOCACION="bash .agent/verify.sh${*:+ $*}"

  while [ $# -gt 0 ]; do
    case "$1" in
      F-[0-9][0-9][0-9]) FEATURE="$1" ;;
      --full) etapas="$STAGES_COMPLETO" ;;
      --smoke) smoke=1 ;;
      --visual) visual=1 ;;
      --probe) probe=1 ;;
      --only) shift; solo="${1:-}"; [ -n "$solo" ] || die_uso "uso: --only <etapa>" ;;
      *) die_uso "opción desconocida: $1
uso: bash .agent/verify.sh [F-NNN] [--full] [--smoke] [--visual] [--probe] [--only <etapa>]" ;;
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

  if [ "$visual" = 1 ]; then
    # Igual que smoke: el guion visual vive en la spec del feature.
    [ "$FEATURE" = "_libre" ] &&
      die_uso "--visual necesita un F-NNN: el guion vive en .agent/specs/<ID>/visual.mjs
uso: bash .agent/verify.sh F-010 --visual"
    case " $etapas " in *" visual "*) ;; *) etapas="$etapas visual" ;; esac
  fi

  if [ "$probe" = 1 ]; then
    # El guion vive en scripts/, no en la spec del feature (F-030 decisión del
    # humano), pero lo que necesita el F-NNN es el DIARIO del sensor
    # (.agent/runs/<ID>/), de donde salen la firma, el conteo de repeticiones
    # y el corte por ESTANCADO (architecture.md § F-030 DA6).
    [ "$FEATURE" = "_libre" ] &&
      die_uso "--probe necesita un F-NNN: el diario de intentos vive en .agent/runs/<ID>/
uso: bash .agent/verify.sh F-030 --probe"
    case " $etapas " in *" probe "*) ;; *) etapas="$etapas probe" ;; esac
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

  [ -n "$fallada" ] || { pasa "$intento" "$etapas"; return 0; }

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
pasa() { # <intento> <etapas-que-corrieron>
  # Se apuntan las etapas de verdad, no un "todas" que no dice nada: es lo que
  # permite a `sdd.sh done` saber si la etapa `visual` llegó a ejecutarse alguna
  # vez, y a quien lea el historial saber qué se comprobó en cada intento.
  apuntar "$FEATURE" "$1" "${2:-—}" "PASA" "—" "—"
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
  bash .agent/verify.sh F-010 --visual     + chromium headless sobre las pantallas
  bash .agent/verify.sh F-030 --probe      + servidor propio, proxy lento contra el Auth real
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
