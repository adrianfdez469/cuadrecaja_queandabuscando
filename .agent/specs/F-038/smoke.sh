#!/usr/bin/env bash
# Verificación en runtime de F-038 (el sobre del sync acepta BUSINESS y
# guarda displayCurrencies). La ejecuta `bash .agent/verify.sh F-038 --smoke`
# con `next dev` ya levantado en $SMOKE_BASE_URL, contra la base real de
# docker-compose.yml (ya migrada con la migración de este feature) y con
# QAB_BEARER_TOKEN (el token de seed-negocio-1, F-018) en el entorno.
#
# Cubre C12 entero (las cuatro salidas del guion --business que distingue
# processed/failed/stale/duplicate) y C11(b) (la vitrina no cambia). El
# resto de los catorce criterios vive en pruebas unitarias, en
# business.db.test.ts (sdd-tester) o se comprueba por otro medio (C13, C14).
#
# Helpers (check/code/body/psql_val/sync_token) copiados de
# .agent/specs/F-036/smoke.sh — no importados: son features distintos y su
# propio guion tiene que seguir pasando tal cual (architecture.md § AD7).
#
# ORDEN, con sus dos trampas (architecture.md § AD7):
#
#   1. C12, los seis comandos de spec.md R22, en ESE orden y no en otro:
#      `--business` va PRIMERO a propósito. Sobre un negocio cuya marca de
#      origen es NULL (E16, nunca recibió un BUSINESS, o su fila es anterior
#      a esta migración), `--business --stale` respondería `processed` y no
#      `stale`, porque la guarda anti-rancio no rechaza nada cuando no hay
#      marca guardada con la que comparar.
#   2. El par `--repeat` no es idempotente entre corridas de este guion
#      contra la MISMA base: `--repeat` fija el eventId
#      (scripts/send-catalog-batch.mjs), así que una corrida anterior deja
#      esas dos filas ya en SyncEvent y el PRIMER `--repeat` de esta corrida
#      respondería `duplicate` en vez de `processed`. Se borran por SQL,
#      acotado a esos dos ids exactos, justo antes del par — con
#      `--unknown-store` en ese par para que sean EXACTAMENTE dos filas
#      (PRODUCT + BUSINESS) y no tres: `--unknown-store` es la única forma
#      de que este guion no envíe también un STORE con el mismo suffix fijo.
#   3. C11(b), con un control ANTES de tocar nada: dos peticiones seguidas a
#      la misma página del seed, diffeadas entre sí. Si ya difieren (algo de
#      `next dev` no determinista, nunca este feature), el guion normaliza
#      la comparación igual en las dos mitades del escenario real y lo dice
#      en su salida — un diff en rojo sin ese control no distingue «este
#      feature pintó algo» de «dev no es determinista».
#   4. El residuo es veraz por construcción: el ÚLTIMO evento BUSINESS que
#      esta corrida aplica con éxito es el primer `--repeat` (caso `ok`,
#      las tres monedas reales del seed: CUP, USD, MLC), así que
#      seed-negocio-1 queda con una lista que un comerciante de verdad
#      podría haber mandado. `--business=forty` NUNCA se llama aquí (ese
#      caso es de C10, cubierto en business.db.test.ts) — no hace falta
#      restaurar nada al final.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

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

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }

psql_val() { # psql_val <SQL>
  docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "$1"
}

sync_token() {
  if [ -n "${QAB_BEARER_TOKEN:-}" ]; then
    printf '%s' "$QAB_BEARER_TOKEN"
    return
  fi
  node -e '
    const fs = require("fs");
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^QAB_BEARER_TOKEN="([^"]*)"/m);
    process.stdout.write(m ? m[1] : "");
  '
}

TOKEN="$(sync_token)"

# send_business <extra-args...>  →  corre send-catalog-batch.mjs contra el
# BASE de este guion, con el token de seed-negocio-1, y devuelve la salida
# CRUDA (la línea "HTTP <status>" seguida del JSON con indentación).
send_business() {
  QAB_BASE_URL="$BASE" QAB_BEARER_TOKEN="$TOKEN" node scripts/send-catalog-batch.mjs "$@" 2>&1
}

# http_status_of <salida-cruda>  →  el código HTTP de la primera línea.
http_status_of() {
  printf '%s' "$1" | head -1 | node -e '
    const line = require("fs").readFileSync(0, "utf8");
    const m = line.match(/HTTP (\d+)/);
    process.stdout.write(m ? m[1] : "");
  '
}

# business_result <salida-cruda>  →  "status|error" del evento BUSINESS de
# ese lote (el único results[] cuyo eventId contiene "business").
business_result() {
  printf '%s' "$1" | node -e '
    const raw = require("fs").readFileSync(0, "utf8");
    const idx = raw.indexOf("{");
    const json = JSON.parse(raw.slice(idx));
    const r = (json.results ?? []).find((r) => r.eventId.includes("business"));
    process.stdout.write(r ? `${r.status}|${r.error ?? ""}` : "MISSING|MISSING");
  '
}

# normalize_html <html>  →  aplicada a las DOS mitades por igual cuando el
# control detecta que next dev no es determinista aquí (AD7(3)). Medido al
# escribir este guion con difflib carácter a carácter: dos peticiones
# seguidas de /tienda-demo, sin tocar nada, difieren SOLO dentro de sus
# `<script>` — el id de reanudación de React (`self.__next_r="..."`) y la
# numeración interna del streaming RSC, que Next reordena por petición según
# el orden en que las promesas resuelven, sin relación con el contenido.
# Quitando TODOS los `<script>…</script>` de los dos lados, son byte a byte
# idénticos — que es además lo que AGENTS.md ya pide de esta tienda («se lee
# sin esperar el JavaScript»): lo que un `curl -s` sin JS le muestra a quien
# mira es exactamente lo que queda tras esta normalización.
normalize_html() {
  printf '%s' "$1" | node -e '
    const html = require("fs").readFileSync(0, "utf8");
    process.stdout.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
  '
}

if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
fi

if [ -n "$TOKEN" ]; then
  # ================================================================
  # Control de C11(b), ANTES de tocar nada (AD7(3)).
  # ================================================================
  echo "--- control C11(b) ---"
  CTRL1="$(body "$BASE/tienda-demo")"
  CTRL2="$(body "$BASE/tienda-demo")"
  if [ "$CTRL1" = "$CTRL2" ]; then
    echo "  ok   dos peticiones seguidas de /tienda-demo son byte a byte idénticas — next dev es determinista aquí ahora mismo"
    NORMALIZE=0
  else
    echo "  aviso dos peticiones seguidas de /tienda-demo YA difieren sin que este guion haya tocado nada — next dev no es determinista para esta página; la comparación de más abajo se normaliza en las DOS mitades (nunca solo en una)"
    NORMALIZE=1
  fi

  # ================================================================
  # Criterio 12 — las cuatro salidas del guion --business, en el orden
  # exacto de spec.md R22.
  # ================================================================
  echo "--- criterio 12 ---"

  # (1) --business (caso "ok" por defecto): sobre un negocio cuya marca
  # PUEDE ser NULL (E16) — tiene que ir antes que --stale.
  OUT1="$(send_business --business)"
  check 'criterio 12 (1/6) — HTTP 207' '207' "$(http_status_of "$OUT1")"
  check 'criterio 12 (1/6) — --business responde processed' 'processed|' "$(business_result "$OUT1")"

  # (2) --business=invalid: failed BUSINESS_DISPLAY_CURRENCIES_INVALID.
  OUT2="$(send_business --business=invalid)"
  check 'criterio 12 (2/6) — --business=invalid responde failed BUSINESS_DISPLAY_CURRENCIES_INVALID' \
    'failed|BUSINESS_DISPLAY_CURRENCIES_INVALID' "$(business_result "$OUT2")"

  # (3) --business=delete: failed BUSINESS_DELETE_NOT_SUPPORTED.
  OUT3="$(send_business --business=delete)"
  check 'criterio 12 (3/6) — --business=delete responde failed BUSINESS_DELETE_NOT_SUPPORTED' \
    'failed|BUSINESS_DELETE_NOT_SUPPORTED' "$(business_result "$OUT3")"

  # (4) --business --stale: la marca que dejó (1) es más nueva que
  # 2000-01-01, así que este SÍ debe ser stale (la marca ya no es NULL).
  OUT4="$(send_business --business --stale)"
  check 'criterio 12 (4/6) — --business --stale responde stale' 'stale|' "$(business_result "$OUT4")"

  # AD7(2): borrado acotado a los dos ids fijos de ESTE guion, justo antes
  # del par --repeat — o una corrida anterior contra la misma base deja el
  # PRIMER --repeat respondiendo duplicate en vez de processed.
  psql_val "DELETE FROM \"SyncEvent\" WHERE \"eventId\" IN ('evt-product-fixed', 'evt-business-fixed')" >/dev/null

  # (5) --business --repeat --unknown-store: PRIMERA vez con este eventId
  # fijo tras el borrado de arriba → processed. `--unknown-store` es lo que
  # deja el borrado en EXACTAMENTE dos filas (PRODUCT + BUSINESS, nunca
  # STORE).
  OUT5="$(send_business --business --repeat --unknown-store)"
  check 'criterio 12 (5/6) — --business --repeat (primera vez) responde processed' 'processed|' "$(business_result "$OUT5")"

  # (6) La MISMA llamada otra vez: el eventId es el mismo → duplicate.
  OUT6="$(send_business --business --repeat --unknown-store)"
  check 'criterio 12 (6/6) — --business --repeat (segunda vez) responde duplicate' 'duplicate|' "$(business_result "$OUT6")"

  # ================================================================
  # Criterio 11(b) — la vitrina no cambia. Un BUSINESS más (caso "ok") entre
  # un curl "antes" y un curl "después" de la MISMA página.
  # ================================================================
  echo "--- criterio 11(b) ---"
  BEFORE="$(body "$BASE/tienda-demo")"
  send_business --business >/dev/null
  AFTER="$(body "$BASE/tienda-demo")"

  if [ "$NORMALIZE" = 1 ]; then
    BEFORE="$(normalize_html "$BEFORE")"
    AFTER="$(normalize_html "$AFTER")"
  fi

  check 'criterio 11(b) — /tienda-demo antes y después de un BUSINESS son idénticas (este feature no pinta nada)' \
    "$BEFORE" "$AFTER"
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
