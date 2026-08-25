#!/usr/bin/env bash
# Lo que comparten sdd.sh y verify.sh. Se hace source DESPUÉS de haber hecho
# cd a la raíz del repo. No ejecuta nada por sí solo.

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

die() {
  printf '\033[31m%s\033[0m\n' "$*" >&2
  exit 1
}

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
titulo() { printf '\033[1m%s\033[0m\n' "$*"; }

# Lee un campo del frontmatter YAML de un archivo. front <archivo> <campo>
front() {
  [ -f "$1" ] || return 1
  awk -v k="$2" '
    NR==1 && $0!="---" { exit }
    NR>1 && $0=="---" { exit }
    $0 ~ "^"k":" {
      sub("^"k":[ ]*", "")
      # No es un parser de YAML: solo quita las comillas que hagan falta para
      # que un valor con ": " dentro se pueda escribir sin romper el campo.
      if (($0 ~ /^".*"$/) || ($0 ~ /^'"'"'.*'"'"'$/)) $0 = substr($0, 2, length($0) - 2)
      print; exit
    }
  ' "$1"
}

valid_id() {
  case "$1" in
    F-[0-9][0-9][0-9]) return 0 ;;
    *) die "id inválido: '$1'. Se espera F-NNN, tal como aparece en .agent/features.json." ;;
  esac
}
