#!/usr/bin/env bash
# Verificación en runtime de F-036 (la tasa vigente de un par (negocio,
# moneda) pasa a ser la de updatedAt mayor, no la última que llegó). La
# ejecuta `bash .agent/verify.sh F-036 --smoke` con `next dev` ya levantado
# en $SMOKE_BASE_URL, contra la base real de docker-compose.yml (ya
# migrada) y con QAB_BEARER_TOKEN (el token de seed-negocio-1, F-018) en el
# entorno.
#
# Cubre los criterios 1, 2, 3, 4 y 6 de F-036 (plan.md paso 9 dice "1, 6";
# 2, 3 y 4 se añaden aquí porque es literalmente el mismo escenario en
# vuelo — spec.md los pide "en ese escenario" / "después del escenario 1" —
# y no repetirlo por SQL a mano es lo que ya fichó F-026 en su § Fallos
# encontrados). El criterio 5 se verifica aparte, contra una base de usar y
# tirar, en `.agent/specs/F-036/migracion-fila-vieja.sh` (spec.md I3: no
# puede vivir aquí, `next dev` corre siempre contra un esquema YA migrado).
# El criterio 7 se verifica en
# `src/features/catalog/server/rates.db.test.ts` (EXPLAIN con volumen). El
# 8 y el 9 se verifican en `tests.md` directamente.
#
# Copiado del criterio de `.agent/specs/F-035/smoke.sh` (los helpers
# check/code/body/contains/not_contains/price_of/psql_val/sync_token/now,
# y el mismo cuidado de limpieza al final) — no lo importa, porque son
# features distintos y su propio guion tiene que seguir pasando tal cual.
#
# LA TRAMPA MÁS CARA (heredada de F-035, spec.md C1 de este feature la
# repite): nunca se mueve la tasa de USD/MLC/EUR — el seed solo inserta una
# fila si esa moneda no tiene ya una, así que un `npm run seed` posterior no
# las restaura, y son fixture de lectura de otros features. Moneda
# sintética propia de ESTE feature: "KZR" — tres letras, nunca
# CUP/USD/MLC/EUR (reales), nunca QAB (F-035) ni ZZZ (F-027, reservada para
# su caso "sin tasa": darle una tasa aquí la rompería para siempre), ni
# ABC/WVX/MXR (ya usadas por otros *.db.test.ts / guiones de este mismo
# feature). Y, con el orden nuevo, ningún evento de este guion puede dejar
# en KZR una marca en el futuro lejano: una marca de 2099 dejaría este
# mismo guion fallando en su PRÓXIMA corrida, porque sus tasas de hoy ya no
# ganarían nunca — así que todas las marcas de abajo son `now()` o
# literales de "hoy", nunca futuras.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
SUFFIX="$(date +%s)"
KZR_CURRENCY="KZR"

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

contains() { # contains <qué se espera> <html> <aguja>
  if node -e '
    const [html, needle] = [process.argv[1], process.argv[2]];
    process.exit(html.includes(needle) ? 0 : 1);
  ' "$2" "$3"; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — no se encontró %s\n' "$1" "$3"
    FAILS=$((FAILS + 1))
  fi
}

# price_of <html> <nombre-producto>  →  el texto exacto del precio de la
# tarjeta, o "" si el nombre no aparece (misma forma que F-035/F-026/F-027).
price_of() {
  node -e '
    const [html, name] = [process.argv[1], process.argv[2]];
    const marker = `>${name}</h3>`;
    const idx = html.indexOf(marker);
    if (idx === -1) { process.stdout.write(""); process.exit(0); }
    const m = html.slice(idx, idx + 400).match(/<p class="text-brand text-base font-semibold">([^<]*)<\/p>/);
    process.stdout.write(m ? m[1] : "");
  ' "$1" "$2"
}

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

# sync_catalog <json-events-array-as-string>  →  hace el POST y devuelve el
# cuerpo. `businessId` es siempre seed-negocio-1 (Distribuidora La Rampa,
# dueña de tienda-demo/seed-tienda-1 en la base de desarrollo).
sync_catalog() {
  curl -s -X POST "$BASE/api/internal/sync/catalog" \
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
    -d "{\"businessId\":\"seed-negocio-1\",\"events\":$1}"
}

# quote <storeSlug> <storeProductId> <qty>  →  POST /api/orders/quote, el
# mismo endpoint público que usan el carrito y el checkout (criterio 6: el
# lector del checkout, sin caché).
quote() {
  curl -s -X POST "$BASE/api/orders/quote" \
    -H 'content-type: application/json' \
    -d "{\"storeSlug\":\"$1\",\"items\":[{\"storeProductId\":\"$2\",\"qty\":$3}]}"
}

# now — milisegundos reales y estrictamente crecientes entre llamadas (la
# misma razón que ya fichó F-026: `date` de macOS no tiene %N).
NOW_COUNTER=0
now() {
  NOW_COUNTER=$((NOW_COUNTER + 1))
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$NOW_COUNTER"
}

# exchange_rate_event <eventId> <currency> <rate>  →  updatedAt = now()
# (avanza en cada llamada).
exchange_rate_event() {
  printf '{"eventId":"%s","entity":"EXCHANGE_RATE","operation":"CREATE","occurredAt":"%s","payload":{"businessId":"seed-negocio-1","currency":"%s","rate":%s,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$(now)"
}

# exchange_rate_event_at <eventId> <currency> <rate> <updatedAt>  →
# updatedAt EXPLÍCITO, para el criterio 4: dos eventos con el MISMO
# updatedAt literal (occurredAt sigue avanzando; no es lo que decide la
# vigencia — R1/R2 leen solo payload.updatedAt).
exchange_rate_event_at() {
  printf '{"eventId":"%s","entity":"EXCHANGE_RATE","operation":"CREATE","occurredAt":"%s","payload":{"businessId":"seed-negocio-1","currency":"%s","rate":%s,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$4"
}

product_event() { # product_event <eventId> <storeProductId> <productId> <storeId> <name> <price> <currency>
  printf '{"eventId":"%s","entity":"PRODUCT","operation":"UPDATE","occurredAt":"%s","payload":{"storeProductId":"%s","productId":"%s","businessId":"seed-negocio-1","storeId":"%s","localName":"%s","barcodes":[],"localCategoryId":null,"price":%s,"currency":"%s","canonicalProductId":null,"imageUrl":null,"publishToStore":true,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$4" "$5" "$6" "$7" "$(now)"
}

if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
fi

if [ -n "$TOKEN" ]; then
  # ================================================================
  # Criterios 1, 2 y 6 — el guion de spec.md C1, calcado, con el checkout
  # (criterio 6) leído en la MISMA corrida que la vitrina.
  # ================================================================
  echo "--- criterios 1, 2, 6 ---"

  PROD1="smoke-f036-prod-$SUFFIX"
  PRODNAME1="Smoke F036 Producto $SUFFIX"

  # (1) POST un EXCHANGE_RATE de una moneda sintética propia, rate:480,
  # updatedAt:T2 — el MAYOR de los dos que se envían en este bloque.
  R1="$(sync_catalog "[$(exchange_rate_event "evt-f036-rate1-$SUFFIX" "$KZR_CURRENCY" 480)]")"
  contains 'criterio 1 (paso 1) — el EXCHANGE_RATE inicial (T2, rate:480) se procesó' "$R1" '"status":"processed"'

  # (2) POST un PRODUCT sintético en seed-tienda-1 (tienda-demo) con esa
  # moneda y price:1 — 1 x rate:480 = $480.00: el importe convertido ES la
  # tasa, que es justo lo que criterio 6 necesita para comparar los dos
  # lectores sin escribir un número a mano dos veces.
  sync_catalog "[$(product_event "evt-f036-prod-$SUFFIX" "$PROD1" "smoke-f036-canon-$SUFFIX" "seed-tienda-1" "$PRODNAME1" 1 "$KZR_CURRENCY")]" >/dev/null
  PROD1_ID="$(psql_val "SELECT id FROM \"StoreProduct\" WHERE \"externalId\"='$PROD1'")"

  # (3) GET /tienda-demo y afirmar $480.00 — calienta la caché de F-035 (sin
  # ella el paso 5 no probaría nada: la página podría estar sirviendo un
  # HTML viejo por razones que no tienen nada que ver con este feature).
  BEFORE_HTML="$(body "$BASE/tienda-demo")"
  check 'criterio 1 (paso 3) — /tienda-demo responde 200' 200 "$(code "$BASE/tienda-demo")"
  BEFORE_PRICE="$(price_of "$BEFORE_HTML" "$PRODNAME1")"
  check 'criterio 1 (paso 3) — vitrina con la tasa MAYOR (rate:480 x price:1)' '$480.00' "$BEFORE_PRICE"

  # (4) POST el EXCHANGE_RATE rancio: rate:440, updatedAt:T1 < T2 —
  # calculado ANTES de T2 para que sea inequívocamente menor, en vez de
  # confiar en que `now()` produzca dos milisegundos distintos.
  T1="$(node -e 'process.stdout.write(new Date(Date.now() - 60_000).toISOString())')"
  R4="$(sync_catalog "[{\"eventId\":\"evt-f036-rate2-$SUFFIX\",\"entity\":\"EXCHANGE_RATE\",\"operation\":\"CREATE\",\"occurredAt\":\"$(now)\",\"payload\":{\"businessId\":\"seed-negocio-1\",\"currency\":\"$KZR_CURRENCY\",\"rate\":440,\"updatedAt\":\"$T1\"}}]")"
  # Criterio 2: el evento rancio responde processed y viaja en ok, nunca en
  # failed — no gasta ningún reintento del outbox del POS.
  R4_STATUS="$(node -e '
    const body = JSON.parse(process.argv[1]);
    process.stdout.write(body.results?.[0]?.status ?? "");
  ' "$R4")"
  check 'criterio 2 — el evento rancio (T1<T2) responde processed (results[0].status)' 'processed' "$R4_STATUS"
  contains 'criterio 2 — el eventId rancio viaja en ok' "$R4" "\"evt-f036-rate2-$SUFFIX\""
  R4_FAILED="$(node -e '
    const body = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(body.failed ?? null));
  ' "$R4")"
  check 'criterio 2 — failed queda vacío (no gasta ningún reintento del outbox)' '[]' "$R4_FAILED"

  # (5) GET /tienda-demo UNA vez y afirmar que SIGUE $480.00 — el paso que
  # prueba el feature: el evento rancio (T1) SÍ invalida la caché (F-035),
  # así que la página se rehace, y solo el orden nuevo (T2 > T1) impide que
  # muestre 440.
  AFTER_HTML="$(body "$BASE/tienda-demo")"
  AFTER_PRICE="$(price_of "$AFTER_HTML" "$PRODNAME1")"
  check 'criterio 1 (paso 5) — la vitrina SIGUE con la tasa MAYOR tras el evento rancio (nunca 440)' '$480.00' "$AFTER_PRICE"

  # (6) POST /api/orders/quote — el checkout, sin caché.
  QUOTE1="$(quote "tienda-demo" "$PROD1_ID" 1)"
  QUOTE1_PRICE="$(node -e '
    const body = JSON.parse(process.argv[1]);
    const line = body.lines.find((l) => l.storeProductId === process.argv[2]);
    process.stdout.write(line ? String(line.unitPrice) : "");
  ' "$QUOTE1" "$PROD1_ID")"
  check 'criterio 1 (paso 6) — el checkout cotiza con la tasa MAYOR tras el evento rancio' '480.00' "$QUOTE1_PRICE"

  # Criterio 6, la parte fina: los DOS lectores comparados ENTRE SÍ en la
  # misma corrida, no cada uno contra un número escrito a mano dos veces
  # (aunque los dos checks de arriba YA lo hacen contra el literal
  # esperado — esta es la comparación cruzada que el criterio pide
  # explícitamente).
  check 'criterio 6 — vitrina y checkout coinciden ENTRE SÍ (paso 3, antes del evento rancio)' "\$$QUOTE1_PRICE" "$BEFORE_PRICE"
  check 'criterio 6 — vitrina y checkout coinciden ENTRE SÍ (paso 5/6, después del evento rancio)' "$AFTER_PRICE" "\$$QUOTE1_PRICE"

  # ================================================================
  # Criterio 3 — las DOS filas del escenario de arriba siguen en
  # ExchangeRate (el histórico no pierde ninguna), medido ANTES de la
  # limpieza de este guion.
  # ================================================================
  echo "--- criterio 3 ---"
  KZR_ROWS_AFTER_C1="$(psql_val "SELECT count(*) FROM \"ExchangeRate\" WHERE \"currencyCode\"='$KZR_CURRENCY'")"
  check 'criterio 3 — las dos filas del escenario 1 (480 y 440) siguen en ExchangeRate' '2' "$KZR_ROWS_AFTER_C1"

  # ================================================================
  # Criterio 4 — con dos eventos de updatedAt IDÉNTICO y tasas distintas,
  # gana el que llegó el último. El aviso del propio feature (spec.md I1):
  # "el último en llegar" no es una promesa cronológica exacta más allá de
  # lo que TIMESTAMP(3) puede distinguir — createdAt desempata, e id DESC
  # es el último recurso si hasta createdAt empatara (no ocurre aquí: dos
  # POST secuenciales por HTTP quedan separados por más de 1 ms).
  # ================================================================
  echo "--- criterio 4 ---"

  TIE_UPDATED_AT="$(now)"
  sync_catalog "[$(exchange_rate_event_at "evt-f036-tie1-$SUFFIX" "$KZR_CURRENCY" 500 "$TIE_UPDATED_AT")]" >/dev/null
  sync_catalog "[$(exchange_rate_event_at "evt-f036-tie2-$SUFFIX" "$KZR_CURRENCY" 600 "$TIE_UPDATED_AT")]" >/dev/null

  TIE_HTML="$(body "$BASE/tienda-demo")"
  TIE_PRICE_HTML="$(price_of "$TIE_HTML" "$PRODNAME1")"
  check 'criterio 4 — con updatedAt idéntico, gana el ÚLTIMO en llegar (vitrina, rate:600)' '$600.00' "$TIE_PRICE_HTML"

  TIE_QUOTE="$(quote "tienda-demo" "$PROD1_ID" 1)"
  TIE_QUOTE_PRICE="$(node -e '
    const body = JSON.parse(process.argv[1]);
    const line = body.lines.find((l) => l.storeProductId === process.argv[2]);
    process.stdout.write(line ? String(line.unitPrice) : "");
  ' "$TIE_QUOTE" "$PROD1_ID")"
  check 'criterio 4 — con updatedAt idéntico, gana el ÚLTIMO en llegar (checkout, rate:600)' '600.00' "$TIE_QUOTE_PRICE"
  check 'criterio 6 — vitrina y checkout coinciden ENTRE SÍ (criterio 4)' "$TIE_PRICE_HTML" "\$$TIE_QUOTE_PRICE"

  # ------------------------------------------------- limpieza ----
  # Todo lo sintético de ESTA corrida se borra al final — mismo cuidado que
  # F-035 ya fichó (tests.md § Fallos encontrados) y que su propio
  # smoke.sh aplica ahora: un DELETE por SQL no dispara revalidateTag, así
  # que el servidor seguiría sirviendo el HTML con el producto/la tasa
  # sintéticos hasta STOREFRONT_REVALIDATE (3600s) si no se fuerza un
  # evento de sync inocuo después.
  psql_val "DELETE FROM \"StoreProduct\" WHERE \"externalId\"='$PROD1'" >/dev/null
  psql_val "
    DELETE FROM \"CanonicalProduct\" cp
      WHERE NOT EXISTS (SELECT 1 FROM \"StoreProduct\" sp WHERE sp.\"canonicalProductId\" = cp.id)
        AND cp.name = '$PRODNAME1';
  " >/dev/null
  # Las cuatro tasas sintéticas de esta corrida (480, 440, 500, 600) y la
  # moneda que las sostiene. El orden importa: las tasas antes que la
  # moneda, que es a quien apuntan por clave ajena.
  psql_val "DELETE FROM \"ExchangeRate\" WHERE \"currencyCode\"='$KZR_CURRENCY'" >/dev/null
  psql_val "DELETE FROM \"Currency\" WHERE code='$KZR_CURRENCY'" >/dev/null
  sync_catalog "[$(product_event "evt-f036-cleanup-revalidate-$SUFFIX" "seed-tienda-1-p0" "seed-producto-0" "seed-tienda-1" "Refresco de cola 1.5 L" 450 "CUP")]" >/dev/null
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
