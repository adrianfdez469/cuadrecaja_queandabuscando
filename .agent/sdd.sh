#!/usr/bin/env bash
# Memoria del sistema de agentes SDD. Crea, inspecciona y anota el trabajo de un
# feature. Ningún agente escribe la bitácora a mano: la escribe con `log`.
# Las reglas que impone este script son las de .agent/features.json → "rules".
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# shellcheck source=.agent/lib.sh
. .agent/lib.sh

SPECS=".agent/specs"
PROP="$SPECS/propuestas"
PROG=".agent/progress"
TPL=".agent/templates"
PLAYBOOK=".agent/playbook"
ARTIFACTS="spec architecture design plan impl tests"
ESTADOS="borrador listo obsoleto"

# feature <id> <expresión js sobre el feature> — imprime el resultado, o falla.
feature() {
  node -e "
    const f = require('./.agent/features.json');
    const x = f.features.find((x) => x.id === '$1');
    if (!x) process.exit(1);
    const out = ($2);
    if (out !== undefined && out !== null) console.log(out);
  " 2>/dev/null
}

cmd_new() {
  local id="" motivo=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --pese-a) shift; motivo="${1:-}" ;;
      *) id="$1" ;;
    esac
    shift
  done
  valid_id "$id"
  feature "$id" 'x.id' >/dev/null ||
    die "$id no está en .agent/features.json. El backlog lo escribe el humano (regla 4): pídeselo antes de seguir."

  # Regla 2: un feature retirado no se empieza; el humano lo reactiva si toca.
  [ "$(feature "$id" "x.status || 'active'")" = "deprecated" ] &&
    die "$id está marcado \"status\": \"deprecated\" en .agent/features.json (regla 2).
$(feature "$id" "'  notes: ' + (x.notes || '(sin notes)')")
Si hay que retomarlo, lo reactiva el humano — ese archivo es suyo."

  # Regla 5: no se empieza un feature cuyas dependencias no pasen todavía.
  local bloqueantes
  bloqueantes="$(feature "$id" "
    x.depends_on
      .filter((d) => !(f.features.find((y) => y.id === d) || {}).passes)
      .join(', ')
  ")"
  if [ -n "$bloqueantes" ]; then
    # Se puede empezar igual, pero lo decide el humano y queda escrito. Mismo
    # trato que `verify.sh dismiss`: el override existe y exige argumentarlo.
    [ -n "$motivo" ] || die "$id depende de $bloqueantes, que no pasa(n) todavía (regla 5).
Empezar igual lo decide el humano. Si ya lo decidió, dilo y queda anotado:
  bash .agent/sdd.sh new $id --pese-a 'lo que dijo el humano'"
    warn "$id se empieza con $bloqueantes sin pasar. Motivo: $motivo"
  fi

  mkdir -p "$SPECS/$id"
  local created=0 dst
  for a in $ARTIFACTS; do
    dst="$SPECS/$id/$a.md"
    if [ -f "$dst" ]; then
      printf '  = %s (ya existía, intacto)\n' "$dst"
    else
      sed -e "s/^feature: F-XXX$/feature: $id/" "$TPL/$a.md" >"$dst"
      printf '  + %s\n' "$dst"
      created=$((created + 1))
    fi
  done

  if [ -f "$PROG/$id.md" ]; then
    printf '  = %s (ya existía, intacto)\n' "$PROG/$id.md"
  else
    sed -e "s/F-XXX/$id/g" -e "s/^actualizado: .*/actualizado: $(now)/" "$PROG/TEMPLATE.md" >"$PROG/$id.md"
    # Una excepción que solo se imprimió se pierde con la sesión.
    [ -n "$bloqueantes" ] && [ -n "$motivo" ] &&
      sed -i.bak -e "s|^Nada, o el qué y el quién|$bloqueantes sin pasar (regla 5). El humano lo autorizó: $motivo|" \
        "$PROG/$id.md" && rm -f "$PROG/$id.md.bak"
    printf '  + %s\n' "$PROG/$id.md"
  fi
  printf '\n%d artefactos nuevos. Los que ya existían NO se tocaron.\n' "$created"
}

# propose <slug> — una idea que todavía no es feature. El humano decide si entra
# al backlog; mientras tanto la propuesta vive aquí y sobrevive a la sesión.
cmd_propose() {
  local slug="$1"
  case "$slug" in
    [a-z0-9]*[a-z0-9] | [a-z0-9]) ;;
    *) die "slug inválido: '$slug'. Minúsculas, números y guiones, p. ej. carrito-express." ;;
  esac
  case "$slug" in
    *[!a-z0-9-]*) die "slug inválido: '$slug'. Minúsculas, números y guiones, p. ej. carrito-express." ;;
  esac

  mkdir -p "$PROP"
  local dst="$PROP/$slug.md"
  [ -f "$dst" ] && {
    printf '  = %s (ya existía, intacto)\n' "$dst"
    return 0
  }

  sed -e "s/^feature: F-XXX$/propuesta: $slug/" -e "s/^estado: borrador$/estado: propuesta/" "$TPL/spec.md" >"$dst"
  printf '  + %s\n' "$dst"
  printf '\nNo es un feature todavía. Cuando el humano la acepte, la añade a\n'
  printf '.agent/features.json y entonces: bash .agent/sdd.sh new F-NNN\n'
}

# Marca en rojo un valor que no esté en su lista. campo_fmt <valor> <válidos...>
campo_fmt() {
  local v="$1" e
  shift
  [ -z "$v" ] && {
    printf '\033[31m(vacío)\033[0m'
    return
  }
  for e in "$@"; do
    [ "$v" = "$e" ] && {
      printf '%s' "$v"
      return
    }
  done
  printf '\033[31m%s?\033[0m' "$v"
}

# Última línea del historial del sensor, en una línea legible.
ultima_verificacion() {
  local j=".agent/runs/$1/journal.tsv"
  [ -f "$j" ] || { echo "—"; return; }
  tail -1 "$j" | awk -F'\t' '{
    printf "%s · intento %s · %s%s", $4, $2, $3, ($5=="—" ? "" : " · " $5)
  }'
}

# learn <slug> — abre una ficha nueva en la bitácora de problemas. Lo que se
# aprende arreglando un fallo vive aquí, no en el progreso: el progreso se borra.
cmd_learn() {
  local slug="$1" dst
  case "$slug" in
    *[!a-z0-9-]* | "" | -* | *-)
      die "slug inválido: '$slug'. Minúsculas, números y guiones, p. ej. pooler-transaccion-deadlock."
      ;;
  esac
  dst="$PLAYBOOK/$slug.md"
  [ -f "$dst" ] && {
    printf '  = %s (ya existía, intacto)\n' "$dst"
    printf 'Si el arreglo que dice ya no sirve, corrígela: una ficha que miente\ncuesta más que ninguna.\n'
    return 0
  }
  mkdir -p "$PLAYBOOK"
  sed -e "s/^slug: .*/slug: $slug/" -e "s/^creado: .*/creado: $(now)/" "$PLAYBOOK/TEMPLATE.md" >"$dst"
  printf '  + %s\n' "$dst"
  cat <<AVISO

Rellénala ahora, con el fallo delante. Los dos campos que hacen el trabajo:
  firma:   el ERE que verify.sh buscará en el log del próximo fallo igual
  arreglo: una línea imperativa; es lo que se imprimirá cuando lo reconozca

Comprueba que la firma pesca de verdad:
  grep -aEi -- '<tu firma>' .agent/runs/<F-NNN>/*.log
AVISO
}

# playbook [texto] — lista las fichas, o busca por texto en todas.
cmd_playbook() {
  local f slug sintoma visto n prom
  [ -d "$PLAYBOOK" ] || die "no existe $PLAYBOOK/."

  if [ $# -gt 0 ]; then
    printf '\033[1mFichas que mencionan «%s»:\033[0m\n' "$1"
    grep -rlia -- "$1" "$PLAYBOOK"/*.md 2>/dev/null |
      grep -v -e README.md -e TEMPLATE.md |
      while read -r f; do
        printf '  %-34s %s\n' "$(basename "$f" .md)" "$(front "$f" sintoma)"
      done
    return 0
  fi

  n=0
  printf '\033[1m%-34s %-10s %-4s %s\033[0m\n' FICHA ETAPA "→AG" "VISTO EN"
  for f in "$PLAYBOOK"/*.md; do
    case "${f##*/}" in README.md | TEMPLATE.md) continue ;; esac
    slug="$(basename "$f" .md)"
    visto="$(front "$f" visto_en)"
    # →AG: ya está en AGENTS.md § Cosas que muerden, la bitácora que se lee antes.
    [ "$(front "$f" promovido_a_agents)" = "sí" ] && prom="sí" || prom="—"
    printf '  %-32s %-10s %-4s %s\n' "$slug" "$(front "$f" etapa)" "$prom" "${visto:-—}"
    # Dos features distintos mordidos por la misma trampa: deja de ser anécdota.
    if [ "$(printf '%s' "$visto" | tr ',' '\n' | grep -c 'F-')" -ge 2 ] &&
      [ "$(front "$f" promovido_a_agents)" != "sí" ]; then
      printf '    \033[33m↑ candidata a AGENTS.md § Cosas que muerden\033[0m\n'
    fi
    n=$((n + 1))
  done
  printf '\n%d fichas. Detalle: bash .agent/sdd.sh playbook <texto>\n' "$n"
}

cmd_status() {
  local ids id a file st up ciclo
  if [ $# -gt 0 ]; then
    valid_id "$1"
    ids="$1"
  else
    ids="$(ls "$SPECS" 2>/dev/null | grep -E '^F-[0-9]{3}$' | sort)"
    [ -z "$ids" ] && {
      echo "Sin features en curso bajo $SPECS/."
      return 0
    }
  fi

  for id in $ids; do
    printf '\033[1m== %s ==\033[0m\n' "$id"
    if ! feature "$id" "
      '  ' + x.description + '\n' +
      '  status: ' + (x.status || 'active') +
      ' | passes: ' + x.passes +
      ' | depends_on: ' + (x.depends_on.join(', ') || '—') +
      ' | criterios: ' + x.acceptance_criteria.length
    "; then
      echo "  (no está en features.json)"
    fi

    for a in $ARTIFACTS; do
      file="$SPECS/$id/$a.md"
      if [ -f "$file" ]; then
        up="$(front "$file" actualizado)"
        st="$(campo_fmt "$(front "$file" estado)" $ESTADOS)"
        # El veredicto del probador es el que gobierna el cierre, no su estado.
        [ "$a" = "tests" ] &&
          st="$st | veredicto: $(campo_fmt "$(front "$file" veredicto)" listo no-listo)"
        # Y la firma del humano en el plan es la que gobierna si se implementa.
        [ "$a" = "plan" ] &&
          st="$st | aprobado: $(campo_fmt "$(front "$file" aprobado)" sí no)"
        printf '  %-16s %-22s %s\n' "$a.md" "${up:-?}" "$st"
      else
        printf '  %-16s %s\n' "$a.md" "—"
      fi
    done

    if [ -f "$PROG/$id.md" ]; then
      ciclo="$(front "$PROG/$id.md" ciclo)"
      printf '  \033[1mCiclos de prueba:\033[0m %s\n' "${ciclo:-0}"
      printf '  \033[1mPróximo paso:\033[0m %s\n' \
        "$(awk '/^## Próximo paso concreto/{f=1;next} /^## /{f=0} f && NF {print; exit}' "$PROG/$id.md")"
      printf '  \033[1mÚltima verificación:\033[0m %s\n' "$(ultima_verificacion "$id")"
      local sinleccion
      sinleccion="$(bash .agent/verify.sh pending "$id" | wc -l | tr -d ' ')"
      [ "$sinleccion" -gt 0 ] &&
        printf '  \033[33mFallos sin lección escrita: %s\033[0m (bash .agent/verify.sh pending %s)\n' "$sinleccion" "$id"
      printf '  \033[1mÚltima entrada de bitácora:\033[0m\n'
      awk '/^### /{last=NR} {l[NR]=$0} END{ if(last) for(i=last;i<=NR;i++) print "    " l[i] }' "$PROG/$id.md" | head -12
    else
      printf '  (sin %s/%s.md — feature sin empezar)\n' "$PROG" "$id"
    fi
    echo
  done
}

# log <id> <agente> — el cuerpo de la entrada se lee de stdin.
cmd_log() {
  local id="$1" agente="${2:-}"
  valid_id "$id"
  [ -n "$agente" ] || die "falta el agente: bash .agent/sdd.sh log $id sdd-architect < entrada.md"
  [ -f "$PROG/$id.md" ] || die "no existe $PROG/$id.md — ejecuta antes: bash .agent/sdd.sh new $id"
  [ -t 0 ] && die "el cuerpo de la entrada se pasa por stdin (heredoc)."

  local body
  body="$(cat)"
  [ -n "${body// /}" ] || die "entrada vacía; no se anota nada."

  local ts
  ts="$(now)"
  {
    printf '\n### %s — %s\n\n' "$ts" "$agente"
    printf '%s\n' "$body"
  } >>"$PROG/$id.md"

  # Un ciclo es una vuelta de prueba: solo el probador lo incrementa.
  local inc=0
  [ "$agente" = "sdd-tester" ] && inc=1

  local tmp
  tmp="$(mktemp)"
  awk -v ts="$ts" -v inc="$inc" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm && $0=="---"    { fm=0; print; next }
    fm && /^actualizado:/ { print "actualizado: " ts; next }
    fm && /^ciclo:/ && inc=="1" { print "ciclo: " ($2 + 1); next }
    { print }
  ' "$PROG/$id.md" >"$tmp" && mv "$tmp" "$PROG/$id.md"

  printf 'Anotado en %s/%s.md como %s.\n' "$PROG" "$id" "$agente"
  [ "$inc" = 1 ] && printf 'Ciclo de prueba nº %s.\n' "$(front "$PROG/$id.md" ciclo)"
  return 0
}

# ¿Está el plan firmado? gate <id> — es la puerta que abre la implementación.
# Sale 0 si el humano lo aprobó, 1 si no. Lo ejecuta el implementador antes de
# escribir la primera línea, y no es una formalidad: un plan sin firmar es un
# plan que nadie ha leído.
cmd_gate() {
  local id="$1" plan ap
  valid_id "$id"
  plan="$SPECS/$id/plan.md"
  [ -f "$plan" ] || die "no existe $plan.
Antes de implementar hay un plan que el humano aprueba. Lo escribe el
orquestador destilando spec.md + architecture.md (+ design.md):
  bash .agent/sdd.sh new $id     si el feature no está empezado"

  ap="$(front "$plan" aprobado)"
  case "$ap" in
    sí | si)
      ok "$plan → aprobado: $ap"
      printf '  Firma: %s\n' "$(grep -a '^- 2' "$plan" | tail -1)"
      printf '  Implementa ESTE plan. Desviarse de un paso firmado se anota en\n'
      printf '  impl.md § Desviaciones; cambiar el alcance vuelve al humano.\n'
      return 0
      ;;
  esac

  printf '\033[31m%s\033[0m\n' "$plan → aprobado: ${ap:-vacío}. El humano no ha firmado el plan." >&2
  cat >&2 <<AVISO
No se implementa. Lo que toca es al orquestador, no a ti:
  · si el plan está a medias (estado: borrador) → terminarlo
  · si está listo → enseñárselo al humano y, cuando diga que sí:
      bash .agent/sdd.sh approve $id '<lo que dijo, literal>'
AVISO
  return 1
}

# approve <id> '<lo que dijo el humano>' — la firma del plan. Solo la ejecuta el
# orquestador, y solo después de que el humano lo haya dicho de verdad: es el
# mismo trato que "passes": true, el único punto donde alguien se moja.
cmd_approve() {
  local id="$1" palabras="${2:-}" plan a st
  valid_id "$id"
  plan="$SPECS/$id/plan.md"
  [ -f "$plan" ] || die "no existe $plan — no hay nada que aprobar."
  [ -n "${palabras// /}" ] || die "falta lo que dijo el humano, literal:
  bash .agent/sdd.sh approve $id 'ok, pero sin el paso 4'
Sin sus palabras esto sería el agente aprobándose a sí mismo."

  case "$(front "$plan" aprobado)" in
    sí | si)
      printf '  = %s ya estaba aprobado (intacto).\n' "$plan"
      printf 'Si el plan cambió de alcance, no se re-firma encima: se reescribe\n'
      printf 'plan.md con estado: borrador y se vuelve a enseñar al humano.\n'
      return 0
      ;;
  esac

  st="$(front "$plan" estado)"
  [ "$st" = "listo" ] ||
    die "$plan está en estado: ${st:-vacío}. Un plan con preguntas abiertas (PP1..PPn)
no se firma: se resuelven primero, se pone estado: listo y entonces se enseña."

  # Firmar un plan construido sobre documentos a medias es firmar el aire.
  for a in spec architecture; do
    st="$(front "$SPECS/$id/$a.md" estado)"
    [ "$st" = "listo" ] ||
      die "$SPECS/$id/$a.md está en estado: ${st:-vacío}.
El plan sale de ahí: mientras ese documento no esté listo, lo que se firmaría
es una intención, no un plan. Vuelve al agente que lo escribe."
  done
  st="$(front "$SPECS/$id/design.md" estado)"
  [ "$st" = "listo" ] ||
    warn "design.md está en estado: ${st:-vacío} — correcto si el feature no tiene interfaz."

  local ts
  ts="$(now)"
  local tmp
  tmp="$(mktemp)"
  awk -v ts="$ts" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm && $0=="---"    { fm=0; print; next }
    fm && /^actualizado:/ { print "actualizado: " ts; next }
    fm && /^aprobado:/    { print "aprobado: sí"; next }
    { print }
  ' "$plan" >"$tmp" && mv "$tmp" "$plan"

  # La firma va al pie, en § Aprobación: el plan que se implementa y la razón por
  # la que se implementa viven en el mismo archivo. Las llaves de ${palabras} no
  # son cosmética: bash 3.2 lee «$palabras» como el nombre `palabras»`.
  printf '\n- %s — aprobado por el humano: «%s»\n' "$ts" "$palabras" >>"$plan"

  ok "$plan → aprobado: sí"
  if [ -f "$PROG/$id.md" ]; then
    cmd_log "$id" humano <<ENTRADA
- Hizo: aprobó el plan
- Escribió: $plan (aprobado: sí)
- Dijo: «${palabras}»
- Siguiente agente sugerido: sdd-implementer (el plan ya es ejecutable)
ENTRADA
  else
    warn "no existe $PROG/$id.md: la firma no quedó en ninguna bitácora."
  fi
  printf 'Ya se puede implementar. El implementador lo comprueba con:\n'
  printf '  bash .agent/sdd.sh gate %s\n' "$id"
}

cmd_done() {
  local id="$1"
  valid_id "$id"
  [ -f "$PROG/$id.md" ] || die "no hay $PROG/$id.md que cerrar."

  local v
  v="$(front "$SPECS/$id/tests.md" veredicto)"
  [ "$v" = "listo" ] || die "tests.md dice veredicto: '${v:-vacío}'. Solo se cierra con 'listo'."

  # Lo que se cierra tiene que ser lo que el humano aprobó. Si nunca firmó el
  # plan, lo construido no se puede comparar con nada acordado.
  local ap
  ap="$(front "$SPECS/$id/plan.md" aprobado)"
  case "$ap" in
    sí | si) ;;
    *) die "$SPECS/$id/plan.md dice aprobado: '${ap:-vacío}'.
Este feature se construyó sin que el humano firmase el plan. Antes de cerrarlo,
que lo lea y lo firme —o diga qué cambió— y quede escrito:
  bash .agent/sdd.sh approve $id '<lo que dijo>'" ;;
  esac

  # Los criterios marcados tienen que ser todos los del feature, no los que a
  # alguien le apeteció listar.
  local marcados total
  marcados="$(awk '
    /^## Criterios cubiertos/ { sec = 1; next }
    /^## / { sec = 0 }
    /<!--/ { com = 1 }
    sec && !com && /^- \[[xX]\]/ { n++ }
    /-->/ { com = 0 }
    END { print n + 0 }
  ' "$PROG/$id.md")"
  total="$(feature "$id" 'x.acceptance_criteria.length')" || die "$id no está en .agent/features.json."
  [ "$marcados" -eq "$total" ] ||
    die "$PROG/$id.md marca $marcados criterios y el feature tiene $total. Cada uno necesita su línea '- [x]' con el comando que lo verifica (regla 1)."

  # Handoff: lo que falló durante el ciclo tiene que haber dejado lección. El
  # momento de escribirla es este, no "algún día": el progreso se borra abajo.
  local pend
  pend="$(bash .agent/verify.sh pending "$id")"
  [ -z "$pend" ] || die "quedan fallos de $id sin explicar en $PLAYBOOK/:

$(printf '%s\n' "$pend" | awk -F'\t' '{ print "  · " $1 }')

Por cada uno, una de dos:
  bash .agent/sdd.sh learn <slug>                 si volverá a pasar
  bash .agent/verify.sh dismiss $id '<firma>' '<motivo>'   si fue un descuido
La bitácora de problemas es lo único que sobrevive al feature; $PROG/$id.md no."

  # Regla 6: un feature con passes:false y sin progreso se lee como SIN EMPEZAR.
  # Por eso el humano firma antes de que esto borre nada.
  local passes
  passes="$(feature "$id" 'x.passes')"
  [ "$passes" = "true" ] || die "$id sigue con \"passes\": false en .agent/features.json.
Borrar el progreso ahora lo dejaría como 'sin empezar' (regla 6) y la próxima
sesión lo reempezaría encima de $SPECS/$id/.
Pide al humano que ponga \"passes\": true — ese archivo es suyo — y vuelve."

  rm -f "$PROG/$id.md"
  printf 'Cerrado %s. Se borró el progreso; %s/%s/ se conserva como especificación viva.\n' "$id" "$SPECS" "$id"
}

cmd_start() {
  bash .agent/init.sh || exit 1
  echo
  cmd_status "$@"
}

case "${1:-}" in
  start)
    shift
    cmd_start "$@"
    ;;
  new)
    shift
    [ $# -ge 1 ] || die "uso: sdd.sh new F-NNN"
    cmd_new "$@"
    ;;
  propose)
    shift
    [ $# -ge 1 ] || die "uso: sdd.sh propose <slug>"
    cmd_propose "$@"
    ;;
  status)
    shift
    cmd_status "$@"
    ;;
  learn)
    shift
    [ $# -ge 1 ] || die "uso: sdd.sh learn <slug>"
    cmd_learn "$@"
    ;;
  playbook)
    shift
    cmd_playbook "$@"
    ;;
  log)
    shift
    [ $# -ge 1 ] || die "uso: sdd.sh log F-NNN <agente> < cuerpo"
    cmd_log "$@"
    ;;
  approve)
    shift
    [ $# -ge 1 ] || die "uso: sdd.sh approve F-NNN '<lo que dijo el humano>'"
    cmd_approve "$@"
    ;;
  gate)
    shift
    [ $# -ge 1 ] || die "uso: sdd.sh gate F-NNN"
    cmd_gate "$@"
    ;;
  done)
    shift
    [ $# -ge 1 ] || die "uso: sdd.sh done F-NNN"
    cmd_done "$@"
    ;;
  *)
    cat <<'HELP'
Memoria del sistema de agentes SDD.

  bash .agent/sdd.sh start [F-007]    comprueba el entorno y muestra el estado
  bash .agent/sdd.sh new F-007        crea .agent/specs/F-007/ y el progreso
       ... --pese-a '<motivo>'         empezar aunque un depends_on no pase
  bash .agent/sdd.sh propose <slug>   una idea que todavía no es feature
  bash .agent/sdd.sh status [F-007]   artefactos, ciclos, próximo paso y bitácora
  (el sensor va aparte: bash .agent/verify.sh --help)
  bash .agent/sdd.sh gate F-007       ¿aprobó el humano el plan? (0 sí · 1 no)
  bash .agent/sdd.sh approve F-007 '<lo que dijo el humano>'
                                      firma el plan; sin esto no se implementa
  bash .agent/sdd.sh playbook [texto] bitácora de problemas ya resueltos
  bash .agent/sdd.sh learn <slug>     abre una ficha nueva en esa bitácora
  bash .agent/sdd.sh log F-007 sdd-architect <<'ENTRADA'
  - Hizo: ...
  - Escribió: .agent/specs/F-007/architecture.md
  - Deja pendiente: ...
  - Siguiente agente sugerido: sdd-designer (motivo)
  ENTRADA
  bash .agent/sdd.sh done F-007       cierra el feature (exige "passes": true)
HELP
    ;;
esac
