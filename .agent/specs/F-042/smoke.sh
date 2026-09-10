#!/usr/bin/env bash
# Verificación en runtime de F-042 (el comprador elige su zona en el
# checkout). La ejecuta `bash .agent/verify.sh F-042 --smoke` con `next dev`
# ya levantado en $SMOKE_BASE_URL, contra la base real de docker-compose.yml
# (ya sembrada, `npm run seed`).
#
# Cubre lo que solo se ve con la app en pie y sin ejecutar JavaScript
# (curl, y `node scripts/check-geometry-budget.mjs`): criterio 1 (solo las
# zonas con tarifa resoluble, ni la retirada ni la NOT_SERVED bajo una
# provincia con FEE), criterio 6 (el mapa sirve exactamente la cobertura
# declarada — cuatro municipios, y una provincia entera), criterio 7 (el
# paso de provincia aparece solo con dos o más), y criterio 9 (una tienda
# ZONE_BASED sin ninguna zona resoluble no ofrece domicilio, y un POST con
# fulfillment DELIVERY responde el error propio en vez de crear un pedido de
# mostrador en silencio).
#
# Los demás criterios (C2, C5, C8, C10) son de `visual.mjs`, de unitario o de
# `db` — ver `.agent/specs/F-042/plan.md` § Pasos y `architecture.md` § la
# tabla de tests.
#
# FIXTURE: el-faro (seed-tienda-7, seed-negocio-2). NO tienda-demo ni
# tienda-dos: las dos son fixtures estables que otros seis smokes ya leen
# (F-010, F-011, F-017, F-018, F-019, F-023) y ninguno espera que cambien de
# modo de envío. el-faro ya es el fixture "mutar y restaurar" de F-039 para
# otra cosa (`displayCurrencies`); aquí se mutan su modo de envío y su
# tarifario, y SÍ se restauran al final — el mismo criterio de higiene.
#
# El token de seed-negocio-2 se ACUÑA aquí (mint_token ROTA — ficha
# mint-token-rota-el-token-en-bd-compartida — aceptado porque el árbol es de
# esta sesión, mismo patrón que F-018/F-039).
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
SUFFIX="$(date +%s)"

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

mint_token() { # mint_token <externalId>
  npx tsx scripts/mint-sync-token.ts "$1" 2>/dev/null | tail -n1
}

NOW_COUNTER=0
now() {
  NOW_COUNTER=$((NOW_COUNTER + 1))
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$NOW_COUNTER"
}

sync_catalog() { # sync_catalog <token> <business-id-literal> <json-events-array-as-string>
  curl -s -X POST "$BASE/api/internal/sync/catalog" \
    -H 'content-type: application/json' -H "authorization: Bearer $1" \
    -d "{\"businessId\":\"$2\",\"events\":$3}"
}

store_event() { # store_event <eventId> <deliveryEnabled-bool> <deliveryFeeMode>
  node -e '
    const [eventId, deliveryEnabled, deliveryFeeMode, updatedAt] = process.argv.slice(1);
    console.log(JSON.stringify({
      eventId,
      entity: "STORE",
      operation: "UPDATE",
      occurredAt: updatedAt,
      payload: {
        storeId: "seed-tienda-7",
        businessId: "seed-negocio-2",
        businessName: "Colmado El Faro",
        name: "Colmado El Faro",
        baseCurrency: "CUP",
        deliveryEnabled: deliveryEnabled === "true",
        deliveryFeeMode,
        publishToStore: true,
        updatedAt,
      },
    }));
  ' "$1" "$2" "$3" "$(now)"
}

zone_tariff_fee() { # zone_tariff_fee <eventId> <zoneCode> <amount>
  node -e '
    const [eventId, zoneCode, amount, updatedAt] = process.argv.slice(1);
    console.log(JSON.stringify({
      eventId, entity: "ZONE_TARIFF", operation: "UPDATE", occurredAt: updatedAt,
      payload: { storeId: "seed-tienda-7", zoneCode, rule: "FEE", deliveryFee: Number(amount), updatedAt },
    }));
  ' "$1" "$2" "$3" "$(now)"
}

zone_tariff_not_served() { # zone_tariff_not_served <eventId> <zoneCode>
  node -e '
    const [eventId, zoneCode, updatedAt] = process.argv.slice(1);
    console.log(JSON.stringify({
      eventId, entity: "ZONE_TARIFF", operation: "UPDATE", occurredAt: updatedAt,
      payload: { storeId: "seed-tienda-7", zoneCode, rule: "NOT_SERVED", updatedAt },
    }));
  ' "$1" "$2" "$(now)"
}

zone_tariff_inherit() { # zone_tariff_inherit <eventId> <zoneCode>
  node -e '
    const [eventId, zoneCode, updatedAt] = process.argv.slice(1);
    console.log(JSON.stringify({
      eventId, entity: "ZONE_TARIFF", operation: "UPDATE", occurredAt: updatedAt,
      payload: { storeId: "seed-tienda-7", zoneCode, rule: "INHERIT", updatedAt },
    }));
  ' "$1" "$2" "$(now)"
}

TOKEN="$(mint_token seed-negocio-2)"
if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL no se pudo acuñar el token de seed-negocio-2 — ver scripts/mint-sync-token.ts\n'
  FAILS=$((FAILS + 1))
fi

if [ -n "$TOKEN" ]; then
  # ================================================================
  # Deja el-faro en ZONE_BASED, con domicilio.
  # ================================================================
  echo "--- switching el-faro to ZONE_BASED ---"
  R_STORE="$(sync_catalog "$TOKEN" seed-negocio-2 "[$(store_event "evt-f042-store-$SUFFIX" true ZONE_BASED)]")"
  contains 'STORE (ZONE_BASED) se procesó' "$R_STORE" '"status":"processed"'

  # ================================================================
  # Criterio 1 / caso límite 3 — provincia 23 con FEE 300 y 23.05 (Regla)
  # NOT_SERVED: aparecen los otros 14 municipios de La Habana, "Regla" y
  # "23.05" NO aparecen en ninguna forma.
  # ================================================================
  echo "--- criterio 1 ---"
  R_PROV="$(sync_catalog "$TOKEN" seed-negocio-2 "[$(zone_tariff_fee "evt-f042-prov23-$SUFFIX" 23 300)]")"
  contains 'ZONE_TARIFF provincia 23 FEE 300 se procesó' "$R_PROV" '"status":"processed"'
  R_2305="$(sync_catalog "$TOKEN" seed-negocio-2 "[$(zone_tariff_not_served "evt-f042-2305-$SUFFIX" 23.05)]")"
  contains 'ZONE_TARIFF 23.05 NOT_SERVED se procesó' "$R_2305" '"status":"processed"'

  HTML="$(body "$BASE/el-faro/checkout")"
  check '/el-faro/checkout responde 200' 200 "$(code "$BASE/el-faro/checkout")"
  contains 'criterio 1 — el bloque de zona está en el HTML de la primera respuesta' "$HTML" '¿Cómo lo quieres recibir?'
  contains 'criterio 1 — "Playa" (23.01) aparece' "$HTML" 'Playa'
  contains 'criterio 1 — "Marianao" (23.11) aparece' "$HTML" 'Marianao'
  not_contains 'criterio 1 — "Regla" (23.05, NOT_SERVED bajo una provincia con FEE) NO aparece' "$HTML" 'Regla'
  not_contains 'criterio 1 — el código "23.05" no aparece en ninguna forma' "$HTML" '23.05'

  # ================================================================
  # Criterio 6 (primera cifra) — la provincia entera: 15 municipios menos
  # el NOT_SERVED = 14 zonas exactas, ni la provincia entera (15) ni el país.
  # ================================================================
  echo "--- criterio 6 (provincia entera, 14 de 15) ---"
  node scripts/check-geometry-budget.mjs --base="$BASE" --slug=el-faro --expect=14
  check 'criterio 6 — la provincia entera sirve EXACTAMENTE 14 zonas (15 menos NOT_SERVED)' 0 "$?"

  # ================================================================
  # Retracta la provincia 23 (INHERIT) antes de la siguiente fixture, para
  # que no contamine la cuenta de "exactamente cuatro".
  # ================================================================
  R_RETRACT="$(sync_catalog "$TOKEN" seed-negocio-2 "[$(zone_tariff_inherit "evt-f042-retract23-$SUFFIX" 23)]")"
  contains 'ZONE_TARIFF provincia 23 retractada (INHERIT) se procesó' "$R_RETRACT" '"status":"processed"'

  # ================================================================
  # Criterio 6 (segunda cifra) / criterio 7 (sin paso de provincia) —
  # cuatro municipios de UNA sola provincia (21, Pinar del Río), sin fila de
  # provincia: exactamente 4 zonas, y el paso de provincia NO está en el DOM.
  # ================================================================
  echo "--- criterio 6 (cuatro municipios) / criterio 7 (una sola provincia) ---"
  FOUR_EVENTS="[$(zone_tariff_fee "evt-f042-2101-$SUFFIX" 21.01 200),$(zone_tariff_fee "evt-f042-2102-$SUFFIX" 21.02 200),$(zone_tariff_fee "evt-f042-2103-$SUFFIX" 21.03 250),$(zone_tariff_fee "evt-f042-2104-$SUFFIX" 21.04 250)]"
  R_FOUR="$(sync_catalog "$TOKEN" seed-negocio-2 "$FOUR_EVENTS")"
  contains 'los cuatro ZONE_TARIFF de Pinar del Río se procesaron' "$R_FOUR" '"status":"processed"'

  node scripts/check-geometry-budget.mjs --base="$BASE" --slug=el-faro --expect=4
  check 'criterio 6 — cuatro municipios sirven EXACTAMENTE 4 zonas, no la provincia' 0 "$?"

  HTML_ONE_PROV="$(body "$BASE/el-faro/checkout")"
  not_contains 'criterio 7 — con cobertura en una sola provincia, el paso de provincia NO está' "$HTML_ONE_PROV" '>Provincia<'

  # ================================================================
  # Criterio 7 (con paso de provincia) — se añade un municipio de OTRA
  # provincia (29, Ciego de Ávila): ahora sí aparece el paso.
  # ================================================================
  echo "--- criterio 7 (dos provincias) ---"
  R_OTHER_PROV="$(sync_catalog "$TOKEN" seed-negocio-2 "[$(zone_tariff_fee "evt-f042-2901-$SUFFIX" 29.01 400)]")"
  contains 'ZONE_TARIFF 29.01 se procesó' "$R_OTHER_PROV" '"status":"processed"'

  HTML_TWO_PROV="$(body "$BASE/el-faro/checkout")"
  contains 'criterio 7 — con cobertura en dos provincias, el paso de provincia SÍ está' "$HTML_TWO_PROV" '>Provincia<'
  contains 'criterio 7 — Pinar del Río está entre las opciones' "$HTML_TWO_PROV" 'Pinar del Río'
  contains 'criterio 7 — Ciego de Ávila está entre las opciones' "$HTML_TWO_PROV" 'Ciego de Ávila'

  node scripts/check-geometry-budget.mjs --base="$BASE" --slug=el-faro --expect=5
  check 'criterio 6 — cinco municipios de dos provincias sirven EXACTAMENTE 5 zonas' 0 "$?"

  # ================================================================
  # Criterio 9 — retracta TODO el tarifario: sin ninguna zona resoluble, no
  # se ofrece domicilio en absoluto, y un POST con DELIVERY responde el
  # error propio en vez de crear un pedido de mostrador en silencio.
  # ================================================================
  echo "--- criterio 9 ---"
  RETRACT_ALL="[$(zone_tariff_inherit "evt-f042-r2101-$SUFFIX" 21.01),$(zone_tariff_inherit "evt-f042-r2102-$SUFFIX" 21.02),$(zone_tariff_inherit "evt-f042-r2103-$SUFFIX" 21.03),$(zone_tariff_inherit "evt-f042-r2104-$SUFFIX" 21.04),$(zone_tariff_inherit "evt-f042-r2901-$SUFFIX" 29.01),$(zone_tariff_inherit "evt-f042-r2305-$SUFFIX" 23.05)]"
  R_RETRACT_ALL="$(sync_catalog "$TOKEN" seed-negocio-2 "$RETRACT_ALL")"
  contains 'la retractación completa del tarifario se procesó' "$R_RETRACT_ALL" '"status":"processed"'

  HTML_EMPTY="$(body "$BASE/el-faro/checkout")"
  not_contains 'criterio 9 — sin ninguna zona resoluble, el bloque de "¿Cómo lo quieres recibir?" NO aparece' "$HTML_EMPTY" '¿Cómo lo quieres recibir?'

  PHONE="+53$(date +%s | tail -c 9)"
  # "Miel de abeja 250 g" de el-faro (seed-tienda-7) — un item REAL y
  # orderable, para llegar de verdad al paso 4.2 de createOrder.ts: un
  # storeProductId inventado da ITEMS_UNAVAILABLE (409) en el paso 4, ANTES
  # de que el 4.2 tenga oportunidad de contestar (E17/E20 necesitan pasar
  # ese paso primero).
  MIEL_ID="1e114ef9-48cf-433c-96f1-14f732e8d5e2"
  QUOTE_MIEL="$(curl -s -X POST "$BASE/api/orders/quote" -H 'content-type: application/json' \
    -d "{\"storeSlug\":\"el-faro\",\"items\":[{\"storeProductId\":\"$MIEL_ID\",\"qty\":1}]}")"
  MIEL_SUBTOTAL="$(printf '%s' "$QUOTE_MIEL" | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(b.subtotal ?? "")')"
  ORDER_BODY_WITH_ITEM=$(node -e '
    const [subtotal, phone] = process.argv.slice(1);
    console.log(JSON.stringify({
      storeSlug: "el-faro",
      items: [{ storeProductId: "1e114ef9-48cf-433c-96f1-14f732e8d5e2", qty: 1 }],
      contact: { name: "Smoke F042", phone },
      fulfillment: "DELIVERY",
      deliveryAddress: "Calle Enramada 100",
      expectedTotal: subtotal,
    }));
  ' "$MIEL_SUBTOTAL" "$PHONE")
  ORDER_RESPONSE2="$(body -X POST "$BASE/api/orders" -H 'content-type: application/json' -d "$ORDER_BODY_WITH_ITEM")"
  ORDER_HTTP2="$(code -X POST "$BASE/api/orders" -H 'content-type: application/json' -d "$ORDER_BODY_WITH_ITEM")"
  check 'criterio 9 — POST DELIVERY sin ninguna zona resoluble responde 400' 400 "$ORDER_HTTP2"
  contains 'criterio 9 — POST DELIVERY sin ninguna zona resoluble responde DELIVERY_ZONE_REQUIRED (E17/E20)' "$ORDER_RESPONSE2" 'DELIVERY_ZONE_REQUIRED'

  # ================================================================
  # Restaura el-faro (higiene, mismo criterio que F-039): deliveryEnabled
  # false, sin modo de envío mutado — su precondición de otros smokes no
  # incluye deliveryFeeMode, pero se deja limpio de todas formas.
  # ================================================================
  echo "--- restaurando el-faro ---"
  R_RESTORE="$(sync_catalog "$TOKEN" seed-negocio-2 "[$(store_event "evt-f042-restore-$SUFFIX" false FLAT_RATE)]")"
  contains 'STORE de restauración se procesó' "$R_RESTORE" '"status":"processed"'
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
