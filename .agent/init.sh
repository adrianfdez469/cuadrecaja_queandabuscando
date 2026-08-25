#!/usr/bin/env bash
# Verifica que el entorno sirve para trabajar. Termina en ENTORNO LISTO o dice
# exactamente qué falta. Pensado para correr al inicio de cada sesión.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }

echo "== Node =="
WANT="$(tr -d 'v \n' < .nvmrc 2>/dev/null)"
HAVE="$(node -v 2>/dev/null | tr -d 'v')"
if [ -z "$HAVE" ]; then
  bad "node no está en el PATH"
elif [ "${HAVE%%.*}" = "$WANT" ]; then
  ok "node v$HAVE (.nvmrc pide v$WANT)"
else
  bad "node v$HAVE pero .nvmrc pide v$WANT — ejecuta: nvm use"
fi

echo "== Dependencias =="
if [ -d node_modules ]; then ok "node_modules presente"; else bad "faltan dependencias — ejecuta: npm ci"; fi
if [ -d src/generated/prisma ]; then
  ok "cliente Prisma generado"
else
  bad "cliente Prisma sin generar — ejecuta: npm run db:generate"
fi

echo "== Scripts declarados =="
for s in dev build start lint format:check typecheck test seed db:migrate check:bundle; do
  if node -e "process.exit(require('./package.json').scripts['$s']?0:1)" 2>/dev/null; then
    ok "npm run $s"
  else
    bad "falta el script '$s' en package.json"
  fi
done

echo "== Variables de entorno =="
if [ ! -f .env ]; then
  bad ".env no existe — cópialo de .env.example"
else
  # Toda variable sin valor por defecto en .env.example debe tener valor en .env.
  MISSING=""
  while IFS= read -r key; do
    val="$(grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
    [ -z "$val" ] && MISSING="$MISSING $key"
  done < <(grep -oE '^[A-Z_]+=' .env.example | tr -d '=' | grep -vE '^(SUPABASE_SERVICE_ROLE_KEY)$')
  if [ -n "$MISSING" ]; then
    warn "sin valor en .env:$MISSING"
  else
    ok "todas las variables de .env.example tienen valor"
  fi
fi

echo "== Base de datos =="
DB_CHECK="$(node -e '
require("dotenv/config");
const { Client } = require("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.log("NOURL"); process.exit(0); }
const c = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
c.connect()
  .then(() => c.query("select 1"))
  .then(() => { console.log("OK"); return c.end(); })
  .catch((e) => { console.log("ERR " + e.message); process.exit(0); });
' 2>/dev/null)"
case "$DB_CHECK" in
  OK) ok "Postgres alcanzable" ;;
  NOURL) bad "DATABASE_URL no está definida" ;;
  *) warn "Postgres no alcanzable: ${DB_CHECK#ERR }" ;;
esac

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mENTORNO LISTO\033[0m\n'
  echo "Siguiente: lee AGENTS.md y .agent/features.json, y elige un feature con passes:false."
else
  printf '\033[31mENTORNO INCOMPLETO\033[0m — resuelve los ✗ de arriba.\n'
  exit 1
fi
