#!/usr/bin/env bash
# Verifica que el entorno sirve para trabajar. Termina en ENTORNO LISTO o dice
# exactamente qué falta. Pensado para correr al inicio de cada sesión.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# shellcheck source=.agent/lib.sh
. .agent/lib.sh

FAIL=0

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
for s in dev build start lint format format:check typecheck test seed db:generate db:migrate check:theme check:bundle check:harness; do
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
  # Las tres claves locales de Storage no viven en el repo: las genera cada
  # máquina con `node scripts/storage-dev-keys.mjs --write`, así que se avisan
  # aparte y con su comando, no como «falta una variable» sin más.
  done < <(grep -oE '^[A-Z_]+=' .env.example | tr -d '=' | grep -vE '^(SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|STORAGE_JWT_SECRET|SUPABASE_JWT_SECRET)$')
  if [ -n "$MISSING" ]; then
    warn "sin valor en .env:$MISSING"
  else
    ok "todas las variables de .env.example tienen valor"
  fi
fi

echo "== Secretos de desarrollo =="
if [ -f .env ]; then
  # Las tres NO se asignan en .env.example (un valor vacío rompe serverEnv()
  # y .optional() de Zod permite ausente, nunca ""), así que el bucle de
  # arriba no puede verlas: este chequeo es su sustituto, no un duplicado.
  SECRETS_OUT="$(node scripts/dev-secrets.mjs --check 2>/dev/null)"
  SECRETS_CODE=$?
  if [ "$SECRETS_CODE" -eq 0 ]; then
    ok "secretos de desarrollo con valor válido (SSO, sesión de admin, cron)"
  elif [ "$SECRETS_CODE" -eq 1 ] && [ -n "$SECRETS_OUT" ]; then
    warn "sin generar o por debajo del mínimo: $(echo "$SECRETS_OUT" | tr '\n' ' ')— ejecuta: node scripts/dev-secrets.mjs --write"
  else
    warn "no se pudo comprobar los secretos de desarrollo — ejecuta: node scripts/dev-secrets.mjs --check"
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
  # F-015 (PP1, plan.md): el proyecto `db` de vitest falla ruidosamente si
  # Postgres no responde — nunca un salto silencioso. Un aviso aquí haría que
  # ENTORNO LISTO saliera verde justo antes de que `npm test` se ponga rojo,
  # así que esto pasa de warn a bad.
  *) bad "Postgres no alcanzable: ${DB_CHECK#ERR } — ejecuta: docker compose up -d postgres && npm run db:deploy" ;;
esac

echo "== Storage =="
# Nunca con `bad`: una sesión que no toca imágenes tiene que seguir leyendo
# ENTORNO LISTO con el emulador parado (architecture.md § Emulador de Storage).
SUPABASE_URL="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
SERVICE_KEY="$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
  warn "claves locales de Storage sin generar — ejecuta: node scripts/storage-dev-keys.mjs --write"
elif curl -fsS -m 3 "$SUPABASE_URL/storage/v1/bucket" -H "Authorization: Bearer $SERVICE_KEY" 2>/dev/null | grep -q store-media; then
  ok "emulador de Storage arriba, bucket store-media presente"
else
  warn "emulador de Storage no responde — ejecuta: docker compose up -d"
fi

echo "== Auth =="
# Nunca con `bad`: una sesión que no toca la cuenta del comprador tiene que
# seguir leyendo ENTORNO LISTO con el emulador parado (F-028, R4, E10).
#
# El renombrado de `storage-gateway` a `supabase-gateway` (D4) deja el
# contenedor viejo ocupando el 54321 si alguien no pasó por
# `--remove-orphans`: el síntoma sin este aviso es «port is already
# allocated», que no menciona ni el renombrado ni el arreglo (E16, R11). Si
# `docker` no está o no responde, esto no imprime nada — nunca convierte
# "Docker parado" en ruido.
if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'queandabuscando-storage-gateway'; then
  warn "el contenedor viejo queandabuscando-storage-gateway sigue vivo — ejecuta: docker compose up -d --remove-orphans"
fi
if curl -fsS -m 3 "$SUPABASE_URL/auth/v1/health" >/dev/null 2>&1; then
  ok "emulador de Auth arriba (/auth/v1/health)"
else
  warn "emulador de Auth no responde — ejecuta: docker compose up -d"
fi
if curl -fsS -m 3 "http://localhost:54324/readyz" >/dev/null 2>&1; then
  ok "capturador de correo arriba (Mailpit, http://localhost:54324)"
else
  warn "Mailpit no responde en http://localhost:54324 — comprueba el puerto y ejecuta: docker compose up -d"
fi

echo "== Realtime =="
# Nunca con `bad`: una sesión que no crea pedidos tiene que seguir leyendo
# ENTORNO LISTO con el emulador parado (F-020, R17, criterio 12).
ANON_KEY="$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  warn "claves locales de Realtime sin generar — ejecuta: node scripts/storage-dev-keys.mjs --write"
elif curl -fsS -m 3 "$SUPABASE_URL/realtime/v1/api/tenants/realtime-dev/health" \
  -H "Authorization: Bearer $ANON_KEY" >/dev/null 2>&1; then
  ok "emulador de Realtime arriba (inquilino realtime-dev)"
else
  warn "emulador de Realtime no responde — ejecuta: docker compose up -d"
fi

echo "== Solicitudes de cuadrecaja =="
# El otro equipo anota lo que necesita de nuestra API en SU repo
# (.agents/solicitudes-qab.md); esto lo cruza con nuestra respuesta
# (.agent/solicitudes.md) y avisa de lo que llegó nuevo. Nunca `bad`: una sesión
# que no toca la integración tiene que seguir leyendo ENTORNO LISTO aunque ese
# repo no esté clonado en esta máquina.
bash .agent/solicitudes.sh --breve

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mENTORNO LISTO\033[0m\n'
  echo "Siguiente: elige un feature del backlog y abre con /sdd F-NNN."
else
  printf '\033[31mENTORNO INCOMPLETO\033[0m — resuelve los ✗ de arriba.\n'
  exit 1
fi
