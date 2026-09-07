#!/usr/bin/env bash
# Verificación en runtime de F-035 (una tasa o una moneda invalida la caché
# del catálogo de ese negocio). La ejecuta `bash .agent/verify.sh F-035
# --smoke` con `next dev` ya levantado en $SMOKE_BASE_URL, contra la base
# real de docker-compose.yml (`npm run seed` ya corrido) y con
# QAB_BEARER_TOKEN (el token de seed-negocio-1, F-018) en el entorno.
#
# Cubre los criterios 1, 3 y 7 de F-035 (plan.md paso 7). Los criterios 2, 4
# y 6 (contar invalidaciones con revalidateStores/revalidateTag) ya están
# verificados en unidad — R12 se compone de `src/lib/cache.test.ts` (la
# aritmética "2 tags x N stores") más
# `src/features/sync/server/processBatch.test.ts` (una sola `revalidateStores`
# por lote, la MISMA función de memo pasada a los dos handlers) más
# `src/features/sync/server/businessBranches.test.ts` (un solo `findMany` por
# lote) — nunca en runtime, porque `next dev` no expone contador de
# `revalidateTag`. El criterio 5 se verifica contra Postgres real en
# `src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts`. El
# criterio 8 se verifica con `git diff --stat main -- docs/sync-contract.md`
# y el 9 con el propio `verify.sh --full` — ninguno de los dos aquí.
#
# Copiado con el criterio de `.agent/specs/F-026/smoke.sh` (los helpers
# `check`/`code`/`body`/`contains`/`not_contains`/`price_of`/`psql_val`/
# `sync_token`/`now`) — no lo importa, porque son features distintos y su
# propio guion tiene que seguir pasando tal cual.
#
# LA TRAMPA MÁS CARA (spec.md C1, plan.md paso 7): nunca se mueve la tasa de
# USD. El seed solo inserta una fila de RATES si esa moneda no tiene ya una
# (`prisma/seed.ts`), así que un `npm run seed` posterior NO restaura los 440,
# y `Cerveza Cristal` (1.20 USD -> 528 CUP) es fixture de lectura de otros
# features, incluida la lista de precios de
# `src/features/catalog/catalogFilters.test.ts`. Este guion usa una moneda
# sintética de tres letras propia — "QAB" — nunca "ZZZ" (ya reservada por
# F-027 para su propio caso "sin tasa": darle una tasa aquí la rompería para
# siempre) y nunca ninguna de las tres monedas reales del seed (CUP/USD/MLC).
# El producto sintético que la usa también es propio de esta corrida
# (externalId con sufijo de timestamp) y se borra al final, con el mismo
# cuidado de revalidar después de borrar que ya fichó F-026 (tests.md § Fallos
# encontrados): un DELETE por SQL no dispara `revalidateTag`, así que el
# servidor que atendió esta corrida seguiría sirviendo el producto borrado
# desde su Data Cache hasta que expire STOREFRONT_REVALIDATE (3600s) si no se
# fuerza un evento de sync inocuo después.
#
# Criterio 3: ningún UPDATE de este guion pasa por psql para verificar una
# revalidación — es al revés, la técnica (ya documentada en
# `.agent/specs/F-027/smoke.sh`) es usar un UPDATE directo por psql
# PRECISAMENTE PORQUE no dispara `revalidateTag`, para demostrar que el
# EXCHANGE_RATE de un negocio no expira la página de otro. El dato que se
# toca es `StoreProduct.localName` de "Miel de abeja 250 g" en el-faro
# (seed-negocio-2, fixture de F-018), restaurado al final del guion.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
SUFFIX="$(date +%s)"
QAB_CURRENCY="QAB"

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

not_contains() { # not_contains <qué se espera> <html> <aguja>
  if node -e '
    const [html, needle] = [process.argv[1], process.argv[2]];
    process.exit(html.includes(needle) ? 1 : 0);
  ' "$2" "$3"; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — SÍ se encontró %s (no debía)\n' "$1" "$3"
    FAILS=$((FAILS + 1))
  fi
}

# price_of <html> <nombre-producto>  →  el texto exacto del precio de la
# tarjeta, o "" si el nombre no aparece (misma forma que F-026/F-027).
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
# dueña de tienda-demo/seed-tienda-1 en la base de desarrollo) — el mismo
# negocio para los criterios 1 y 3, que es justo lo que C3 necesita afirmar
# (que SU evento no toca `el-faro`, de seed-negocio-2).
sync_catalog() {
  curl -s -X POST "$BASE/api/internal/sync/catalog" \
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
    -d "{\"businessId\":\"seed-negocio-1\",\"events\":$1}"
}

# quote <storeSlug> <storeProductId> <qty>  →  POST /api/orders/quote, el
# mismo endpoint público que usan el carrito y el checkout (criterio 7:
# `loadFreshRates` no cachea nada, así que esto nunca depende de que la
# invalidación de este guion haya corrido).
quote() {
  curl -s -X POST "$BASE/api/orders/quote" \
    -H 'content-type: application/json' \
    -d "{\"storeSlug\":\"$1\",\"items\":[{\"storeProductId\":\"$2\",\"qty\":$3}]}"
}

# now — milisegundos reales y estrictamente crecientes entre llamadas (la
# misma razón que ya fichó F-026: `date` de macOS no tiene %N, y dos eventos
# con el mismo `updatedAt` chocan con la guarda anti-rancia — el segundo del
# par se descartaría en silencio).
NOW_COUNTER=0
now() {
  NOW_COUNTER=$((NOW_COUNTER + 1))
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$NOW_COUNTER"
}

exchange_rate_event() { # exchange_rate_event <eventId> <currency> <rate>
  printf '{"eventId":"%s","entity":"EXCHANGE_RATE","operation":"CREATE","occurredAt":"%s","payload":{"businessId":"seed-negocio-1","currency":"%s","rate":%s,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$(now)"
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
  # Criterio 1 — el guion de cinco pasos de spec.md C1, calcado.
  # ================================================================
  echo "--- criterio 1 ---"

  PROD1="smoke-f035-prod-$SUFFIX"
  PRODNAME1="Smoke F035 Producto $SUFFIX"

  # (1) POST un EXCHANGE_RATE con rate:100, de una moneda sintética propia.
  R1="$(sync_catalog "[$(exchange_rate_event "evt-f035-rate1-$SUFFIX" "$QAB_CURRENCY" 100)]")"
  contains 'criterio 1 (paso 1) — el EXCHANGE_RATE inicial se procesó' "$R1" '"status":"processed"'

  # (2) POST un PRODUCT sintético en seed-tienda-1 (tienda-demo) con esa
  # moneda y price:1 — 1 x rate:100 = 100.00 en la moneda base (CUP).
  sync_catalog "[$(product_event "evt-f035-prod-$SUFFIX" "$PROD1" "smoke-f035-canon-$SUFFIX" "seed-tienda-1" "$PRODNAME1" 1 "$QAB_CURRENCY")]" >/dev/null

  # (3) GET /tienda-demo y afirmar el importe de la tasa VIEJA — este paso es
  # imprescindible (spec.md C1): sin calentar la caché aquí, el paso 5 no
  # probaría que se expiró nada.
  BEFORE_HTML="$(body "$BASE/tienda-demo")"
  check 'criterio 1 (paso 3) — /tienda-demo responde 200' 200 "$(code "$BASE/tienda-demo")"
  check 'criterio 1 (paso 3) — precio con la tasa vieja (rate:100 x price:1)' '$100.00' "$(price_of "$BEFORE_HTML" "$PRODNAME1")"

  # (4) POST el MISMO EXCHANGE_RATE con rate:200.
  sync_catalog "[$(exchange_rate_event "evt-f035-rate2-$SUFFIX" "$QAB_CURRENCY" 200)]" >/dev/null

  # (5) GET /tienda-demo UNA vez y afirmar el importe DOBLE — la primera
  # visita posterior ya tiene que verlo, sin esperar los 3600s ni reiniciar
  # el servidor (E1, criterio 1).
  AFTER_HTML="$(body "$BASE/tienda-demo")"
  check 'criterio 1 (paso 5) — precio con la tasa nueva, en la PRIMERA visita posterior (rate:200 x price:1 = doble)' '$200.00' "$(price_of "$AFTER_HTML" "$PRODNAME1")"

  # Guardado para el criterio 7 (misma sucursal, mismo producto sintético,
  # cotizado justo después del EXCHANGE_RATE de arriba).
  PROD1_ID="$(psql_val "SELECT id FROM \"StoreProduct\" WHERE \"externalId\"='$PROD1'")"

  # ================================================================
  # Criterio 3 — el negocio de al lado (seed-negocio-2 / el-faro) se sigue
  # sirviendo de caché tras el EXCHANGE_RATE de seed-negocio-1.
  # ================================================================
  echo "--- criterio 3 ---"

  ORIGINAL_NAME="Miel de abeja 250 g"
  TEMP_NAME="Miel de abeja 250 g SMOKE TEMP $SUFFIX"
  # el-faro is a SINGLE-branch business (seed-negocio-2): its public slug
  # lives on `Storefront.slug`, not on `Store.slug` — a lone branch's own
  # `slug` column stays NULL (F-017; only a branch reached by its own alias,
  # or one of several siblings, ever gets a value there). Join through
  # `storefrontId`, never assume `Store.slug` is populated (same lesson
  # `.agent/specs/F-027/smoke.sh` already wrote down for the same reason).
  MIEL_ID="$(psql_val "SELECT sp.id FROM \"StoreProduct\" sp JOIN \"Store\" s ON s.id = sp.\"storeId\" JOIN \"Storefront\" sf ON sf.id = s.\"storefrontId\" WHERE sf.slug='el-faro' AND sp.\"localName\"='$ORIGINAL_NAME'")"

  if [ -z "$MIEL_ID" ]; then
    printf 'SMOKE FAIL criterio 3 — no se encontró "%s" en el-faro (fixture de F-018 movida o renombrada)\n' "$ORIGINAL_NAME"
    FAILS=$((FAILS + 1))
  else
    # Calentar: la primera lectura deja el HTML de el-faro en Data Cache
    # bajo storeTag(el-faro).
    FARO_BEFORE="$(body "$BASE/el-faro")"
    check 'criterio 3 (calentando) — /el-faro responde 200' 200 "$(code "$BASE/el-faro")"
    contains 'criterio 3 (calentando) — trae el nombre original' "$FARO_BEFORE" "$ORIGINAL_NAME"

    # UPDATE directo por psql: cambia el dato en la base pero NO dispara
    # revalidateTag (técnica de .agent/specs/F-027/smoke.sh) — se restaura
    # al final de este bloque, pase lo que pase.
    psql_val "UPDATE \"StoreProduct\" SET \"localName\"='$TEMP_NAME' WHERE id='$MIEL_ID'" >/dev/null

    FARO_STILL_CACHED="$(body "$BASE/el-faro")"
    contains 'criterio 3 (el UPDATE por psql NO revalida por sí solo) — sigue el nombre original' "$FARO_STILL_CACHED" "$ORIGINAL_NAME"
    not_contains 'criterio 3 (el UPDATE por psql NO revalida por sí solo) — el nombre nuevo NO aparece todavía' "$FARO_STILL_CACHED" "$TEMP_NAME"

    # El EXCHANGE_RATE de seed-negocio-1 — el negocio DISTINTO del de
    # el-faro (seed-negocio-2).
    sync_catalog "[$(exchange_rate_event "evt-f035-rate3-$SUFFIX" "$QAB_CURRENCY" 300)]" >/dev/null

    # GET /el-faro otra vez: si el evento de seed-negocio-1 hubiera invalidado
    # de más, este HTML traería el nombre nuevo (que SÍ está en la base desde
    # el UPDATE de arriba). Que siga el viejo es la prueba de que su caché NO
    # se expiró — comparar HTML byte a byte no probaría nada, porque un
    # re-render idéntico da el mismo HTML (spec.md C3).
    FARO_AFTER="$(body "$BASE/el-faro")"
    contains 'criterio 3 — tras el EXCHANGE_RATE de OTRO negocio, el-faro SIGUE con el nombre viejo' "$FARO_AFTER" "$ORIGINAL_NAME"
    not_contains 'criterio 3 — el-faro NO muestra el nombre nuevo (su caché no se expiró)' "$FARO_AFTER" "$TEMP_NAME"

    # Restaurado, pase lo que pase con las aserciones de arriba.
    psql_val "UPDATE \"StoreProduct\" SET \"localName\"='$ORIGINAL_NAME' WHERE id='$MIEL_ID'" >/dev/null
  fi

  # ================================================================
  # Criterio 7 — el checkout cotiza con la tasa fresca justo después del
  # evento, sin depender de ninguna invalidación (no-regresión).
  # ================================================================
  echo "--- criterio 7 ---"

  if [ -z "${PROD1_ID:-}" ]; then
    printf 'SMOKE FAIL criterio 7 — no se pudo resolver el storeProductId del producto sintético del criterio 1\n'
    FAILS=$((FAILS + 1))
  else
    # Una tasa MÁS fresca todavía, inmediatamente antes de cotizar — para que
    # este criterio no dependa de que el criterio 1 haya dejado la caché en
    # ningún estado en particular.
    sync_catalog "[$(exchange_rate_event "evt-f035-rate4-$SUFFIX" "$QAB_CURRENCY" 400)]" >/dev/null
    QUOTE_RESPONSE="$(quote "tienda-demo" "$PROD1_ID" 1)"
    QUOTE_PRICE="$(node -e '
      const body = JSON.parse(process.argv[1]);
      const line = body.lines.find((l) => l.storeProductId === process.argv[2]);
      process.stdout.write(line ? String(line.unitPrice) : "");
    ' "$QUOTE_RESPONSE" "$PROD1_ID")"
    check 'criterio 7 — el checkout cotiza con la tasa RECIÉN aplicada (rate:400 x price:1), sin esperar ninguna invalidación' '400.00' "$QUOTE_PRICE"
  fi

  # ------------------------------------------------- limpieza ----
  # Todo lo sintético de ESTA corrida se borra al final. El DELETE es SQL
  # directo y NUNCA pasa por revalidateTag() (misma trampa que F-026 fichó en
  # tests.md § Fallos encontrados): el servidor que atendió esta corrida
  # seguiría sirviendo, desde su Data Cache, la versión CON el producto
  # sintético hasta que expire STOREFRONT_REVALIDATE (3600s) — la base ya
  # está limpia, la RESPUESTA no. Un evento de sync real, aunque no cambie
  # nada visible, es lo único que dispara revalidateStores() de verdad.
  psql_val "DELETE FROM \"StoreProduct\" WHERE \"externalId\"='$PROD1'" >/dev/null
  # `resolveCanonical`'s orphan branch (product.ts) names the CanonicalProduct
  # after `payload.localName` — never after the synthetic `productId` this
  # guion sent, which the handler does not read at all.
  psql_val "
    DELETE FROM \"CanonicalProduct\" cp
      WHERE NOT EXISTS (SELECT 1 FROM \"StoreProduct\" sp WHERE sp.\"canonicalProductId\" = cp.id)
        AND cp.name = '$PRODNAME1';
  " >/dev/null
  # Las tasas sintéticas de esta corrida, y la moneda que las sostiene. Sin
  # esto la tabla acumula cuatro filas de QAB POR CORRIDA en una base que
  # comparten todos los worktrees: el primer ciclo de F-035 dejó 19, y el
  # lector de tasas acabó trayendo 23 filas para devolver 4. La tabla es
  # append-only en el PRODUCTO (no hay camino de borrado en el contrato ni en
  # ningún handler), lo cual no obliga a que un guion de prueba deje su
  # basura en una base de desarrollo. El orden importa: las tasas antes que
  # la moneda, que es a quien apuntan por clave ajena.
  psql_val "DELETE FROM \"ExchangeRate\" WHERE \"currencyCode\"='$QAB_CURRENCY'" >/dev/null
  psql_val "DELETE FROM \"Currency\" WHERE code='$QAB_CURRENCY'" >/dev/null
  sync_catalog "[$(product_event "evt-f035-cleanup-revalidate-$SUFFIX" "seed-tienda-1-p0" "seed-producto-0" "seed-tienda-1" "Refresco de cola 1.5 L" 450 "CUP")]" >/dev/null
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
