#!/usr/bin/env bash
# Verificación en runtime de F-039 (equivalentes en otras monedas en el
# escaparate). La ejecuta `bash .agent/verify.sh F-039 --smoke` con `next dev`
# ya levantado en $SMOKE_BASE_URL, contra la base real de docker-compose.yml
# (ya sembrada, `npm run seed`) y con QAB_BEARER_TOKEN (el token de
# seed-negocio-1, F-018) en el entorno.
#
# Cubre lo que solo se ve con la app en pie (architecture.md § Pruebas, última
# fila): criterio 2 (todos los equivalentes en el HTML crudo, sin ejecutar
# nada), criterio 3 (la preferencia no crea variante de caché — dos Cookie/
# Accept-Language distintos, mismo cuerpo), criterio 8 (un EXCHANGE_RATE
# cambia los equivalentes en la primera visita posterior), criterio 9 (lista
# vacía = nada nuevo), criterio 12 con DH5 (el selector solo ofrece monedas
# con equivalente calculable, y cuenta sus opciones), criterio 6 (el
# equivalente coincide al céntimo con lo que cobra el checkout, creando un
# pedido real — I1 de spec.md, en sus dos comparaciones) y el recorrido de las
# cinco pantallas. También DH3 (carrito/checkout): superficie añadida que
# ningún acceptance_criteria nombra, verificada aquí sin contar para ningún
# criterio.
#
# El resto de los once criterios vive en unitario/db: criterio 1 y 5 en
# ProductCard.test.tsx y priceEquivalents.test.ts; criterio 4 también en
# ProductCard.test.tsx (y aquí, mitad DH5, con datos reales); criterio 7 en
# priceEquivalents.test.ts (no hay negocio sembrado con base distinta de CUP,
# spec.md C7); criterio 10 en `npm run check:bundle` (--full) y en este
# archivo (nada de client bundle nuevo lo mide un smoke); criterio 11 es
# `verify.sh --full` mismo.
#
# Copiado con el criterio de F-035/F-038 (los helpers check/code/body/
# contains/not_contains/psql_val/sync_token/now, y mint_token de F-018) — no
# se importa: son features distintos y su propio guion tiene que seguir
# pasando tal cual.
#
# DATOS, y por qué estas dos tiendas (I3 de spec.md):
#   - tienda-demo (seed-negocio-1): displayCurrencies=["CUP","USD","MLC"],
#     con tasas de las dos — el humo de F-038 lo dejó así a propósito. Sirve
#     para C2, C3, C6 y el recorrido de pantallas: NUNCA se le toca la lista
#     ni las tasas aquí, así que el residuo que deja el humo de F-038 sigue
#     siendo verdad después de correr este guion.
#   - el-faro (seed-negocio-2): displayCurrencies=[] en el seed — el estado
#     exacto del criterio 9. Se usa primero TAL CUAL para verificar C9, y
#     LUEGO se le manda un BUSINESS con ["CUP","USD","EUR"] (sin tasa de EUR
#     al principio) para C4/C8/C12(b)/DH5, restaurando la lista a [] al
#     final para que la precondición de C9 siga valiendo en la próxima
#     corrida. El token de seed-negocio-2 se acuña aquí mismo (mint_token
#     rota — ficha mint-token-rota-el-token-en-bd-compartida —, aceptado
#     porque el árbol es de esta sesión, mismo patrón que F-018/smoke.sh).
#
# LA TRAMPA DEL DIFF NO DETERMINISTA (ficha
# smoke-diff-html-rsc-no-determinista, ya mordió a F-038): dos peticiones
# `curl` seguidas de la MISMA página bajo `next dev` no salen byte a byte
# idénticas — el streaming RSC reordena sus propios ids dentro de los
# `<script>`. El control de abajo lo comprueba ANTES de comparar nada de
# verdad, y la comparación real siempre quita los `<script>` de los dos lados.
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

# normalize_html <html>  →  aplicada a las DOS mitades por igual cuando se
# comparan dos peticiones de la MISMA página (ficha
# smoke-diff-html-rsc-no-determinista): quita TODOS los `<script>` de los dos
# lados, que es exactamente lo que un lector sin JavaScript recibe.
normalize_html() {
  printf '%s' "$1" | node -e '
    const html = require("fs").readFileSync(0, "utf8");
    process.stdout.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
  '
}

# principal_of <html> <nombre-producto>  →  el importe principal (base) tal
# como lo muestra la tarjeta/ficha: el primer <span>…</span> dentro del
# párrafo del precio, ANTES de cualquier data-equiv (architecture.md AD4,
# markup verificado ejecutando contra la app real).
principal_of() {
  node -e '
    const [html, name] = [process.argv[1], process.argv[2]];
    const marker = `>${name}</h3>`;
    const idx = html.indexOf(marker);
    if (idx === -1) { process.stdout.write(""); process.exit(0); }
    const m = html.slice(idx, idx + 800).match(/<span>([^<]*)<\/span>/);
    process.stdout.write(m ? m[1] : "");
  ' "$1" "$2"
}

# equiv_of <html> <nombre-producto> <código>  →  el texto del equivalente de
# esa moneda para ese producto ("US$0.27"), o "" si esa moneda no tiene
# elemento data-equiv para ese producto (R5/C4: se omite, no se pinta vacío).
equiv_of() {
  node -e '
    const [html, name, code] = [process.argv[1], process.argv[2], process.argv[3]];
    const marker = `>${name}</h3>`;
    const idx = html.indexOf(marker);
    if (idx === -1) { process.stdout.write(""); process.exit(0); }
    const window = html.slice(idx, idx + 2000);
    const needle = `data-equiv="${code}"`;
    const i2 = window.indexOf(needle);
    if (i2 === -1) { process.stdout.write(""); process.exit(0); }
    const after = window.slice(i2);
    const m = after.match(/<\/span>\s*<span class="sr-only">[^<]*<\/span>([^<]*)<\/span>/);
    process.stdout.write(m ? m[1] : "");
  ' "$1" "$2" "$3"
}

# numeric_of <texto>  →  solo los dígitos/decimales finales ("US$0.27" ->
# "0.27", "$120.00" -> "120.00", "MLC 0.57" -> "0.57"), para comparar contra
# `convert(...).amount` sin pelear con el símbolo o el espacio que antepone
# cada moneda.
numeric_of() {
  node -e '
    const m = process.argv[1].match(/(-?\d[\d.,]*)$/);
    process.stdout.write(m ? m[1] : "");
  ' "$1"
}

# convert_via_money <amount> <base> <target> <rates-json>  →  el `.amount` de
# `convert()` de verdad (src/lib/money.ts), NUNCA reimplementado a mano (R10):
# el guion de humo llama a la MISMA función que el producto, igual que hace
# el propio código de carrito/checkout (R12, excepción acotada).
convert_via_money() {
  npx tsx -e '
    import { convert, money } from "./src/lib/money.ts";
    const [amount, base, target, ratesJson] = process.argv.slice(1);
    const m = money(amount, base);
    try {
      process.stdout.write(convert(m, target, JSON.parse(ratesJson)).amount);
    } catch {
      process.stdout.write("");
    }
  ' "$1" "$2" "$3" "$4"
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

# mint_token <externalId>  →  ficha mint-token-rota-el-token-en-bd-compartida:
# ESTO ROTA. Aceptado aquí para seed-negocio-2, exactamente como ya hace
# .agent/specs/F-018/smoke.sh, porque el árbol es de esta sesión (el humano le
# pidió a F-041 que esperara). Nunca se usa sobre seed-negocio-1, cuyo token
# ya viene fijo en .env y lo necesitan otros guiones de humo de este mismo
# árbol.
mint_token() {
  npx tsx scripts/mint-sync-token.ts "$1" 2>/dev/null | tail -n1
}

TOKEN_A="$(sync_token)"

# now — milisegundos reales y estrictamente crecientes entre llamadas (F-026:
# `date` de macOS no tiene %N, y dos eventos con el mismo `updatedAt` chocan
# con la guarda anti-rancia).
NOW_COUNTER=0
now() {
  NOW_COUNTER=$((NOW_COUNTER + 1))
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$NOW_COUNTER"
}

# sync_catalog <token> <business-id-literal> <json-events-array-as-string>
sync_catalog() {
  curl -s -X POST "$BASE/api/internal/sync/catalog" \
    -H 'content-type: application/json' -H "authorization: Bearer $1" \
    -d "{\"businessId\":\"$2\",\"events\":$3}"
}

business_event() { # business_event <eventId> <displayCurrencies-json-array>
  printf '{"eventId":"%s","entity":"BUSINESS","operation":"UPDATE","occurredAt":"%s","payload":{"businessId":"seed-negocio-2","displayCurrencies":%s,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$(now)"
}

exchange_rate_event() { # exchange_rate_event <eventId> <currency> <rate>
  printf '{"eventId":"%s","entity":"EXCHANGE_RATE","operation":"CREATE","occurredAt":"%s","payload":{"businessId":"seed-negocio-2","currency":"%s","rate":%s,"updatedAt":"%s"}}' \
    "$1" "$(now)" "$2" "$3" "$(now)"
}

if [ -z "$TOKEN_A" ]; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
fi

TOKEN_B="$(mint_token seed-negocio-2)"
if [ -z "$TOKEN_B" ]; then
  printf 'SMOKE FAIL no se pudo acuñar el token de seed-negocio-2 — ver scripts/mint-sync-token.ts\n'
  FAILS=$((FAILS + 1))
fi

if [ -n "$TOKEN_A" ] && [ -n "$TOKEN_B" ]; then
  # ================================================================
  # Control: dos peticiones seguidas de la MISMA página, sin tocar nada.
  # (architecture.md § AD7(3), ficha smoke-diff-html-rsc-no-determinista)
  # ================================================================
  echo "--- control (no determinismo del streaming RSC) ---"
  CTRL1="$(body "$BASE/tienda-demo")"
  CTRL2="$(body "$BASE/tienda-demo")"
  if [ "$CTRL1" = "$CTRL2" ]; then
    echo "  ok   dos peticiones seguidas de /tienda-demo son byte a byte idénticas ahora mismo"
  else
    echo "  aviso next dev no es determinista para esta página ahora mismo — las comparaciones de abajo ya normalizan quitando <script> en los dos lados"
  fi

  # ================================================================
  # Criterio 2 — todos los equivalentes viajan en el HTML crudo, sin
  # ejecutar nada (tienda-demo, displayCurrencies=["CUP","USD","MLC"]).
  # ================================================================
  echo "--- criterio 2 ---"

  DEMO_HTML="$(body "$BASE/tienda-demo")"
  check '/tienda-demo responde 200' 200 "$(code "$BASE/tienda-demo")"
  contains 'criterio 2 — el equivalente de USD viaja en el HTML crudo' "$DEMO_HTML" 'data-equiv="USD"'
  contains 'criterio 2 — el equivalente de MLC viaja en el HTML crudo' "$DEMO_HTML" 'data-equiv="MLC"'
  # OJO: el <style> generado SÍ contiene el texto "data-ref-currency" (es el
  # selector CSS, [data-ref-currency="USD"] …) — eso es esperado y forma
  # parte de C2. Lo que R13 prohíbe es que el propio <html ...> lleve el
  # ATRIBUTO puesto, así que se comprueba solo esa etiqueta, no el documento
  # entero.
  HTML_TAG="$(printf '%s' "$DEMO_HTML" | node -e 'const m=require("fs").readFileSync(0,"utf8").match(/<html[^>]*>/);process.stdout.write(m?m[0]:"")')"
  not_contains 'criterio 2 — la etiqueta <html> servida NO lleva data-ref-currency (solo el cliente lo escribe, R13)' "$HTML_TAG" 'data-ref-currency'

  PRINCIPAL_AGUA="$(principal_of "$DEMO_HTML" "Agua natural 500 ml")"
  EQUIV_USD_AGUA="$(equiv_of "$DEMO_HTML" "Agua natural 500 ml" "USD")"
  EQUIV_MLC_AGUA="$(equiv_of "$DEMO_HTML" "Agua natural 500 ml" "MLC")"
  check 'criterio 2 — "Agua natural 500 ml" trae su principal' 1 "$([ -n "$PRINCIPAL_AGUA" ] && echo 1 || echo 0)"
  check 'criterio 2 — "Agua natural 500 ml" trae su equivalente USD' 1 "$([ -n "$EQUIV_USD_AGUA" ] && echo 1 || echo 0)"
  check 'criterio 2 — "Agua natural 500 ml" trae su equivalente MLC' 1 "$([ -n "$EQUIV_MLC_AGUA" ] && echo 1 || echo 0)"

  # Usable sin JavaScript, la otra mitad del criterio 10 (curl nunca ejecuta
  # JavaScript, así que esto es EXACTAMENTE lo que vería un lector sin JS —
  # y el mecanismo de ocultar es CSS que solo casa con un atributo que solo
  # el cliente escribe, ya comprobado arriba que está ausente).
  contains 'criterio 10 (usable sin JS) — el enlace a la ficha del producto está en el HTML' "$DEMO_HTML" 'href="/tienda-demo/p/agua-natural-500-ml"'
  not_contains 'criterio 10 (usable sin JS) — el catálogo no pide activar JavaScript' "$DEMO_HTML" 'necesitas activar JavaScript'

  # ================================================================
  # Criterio 3 — la preferencia no crea variante de caché: dos Cookie/
  # Accept-Language distintos dan el MISMO cuerpo (byte a byte tras quitar
  # los <script>).
  # ================================================================
  echo "--- criterio 3 ---"

  R1="$(curl -s -H 'Cookie: qab.reference-currency.v1=USD; otracosa=1' -H 'Accept-Language: en-US,en;q=0.9' "$BASE/tienda-demo")"
  R2="$(curl -s -H 'Cookie: qab.reference-currency.v1=MLC' -H 'Accept-Language: es-ES,es;q=0.9' "$BASE/tienda-demo")"
  check 'criterio 3 — dos peticiones con Cookie/Accept-Language distintos devuelven el MISMO cuerpo (normalizado)' \
    "$(normalize_html "$R1")" "$(normalize_html "$R2")"

  # ================================================================
  # Criterio 9 — un negocio sin monedas extra declaradas (el-faro,
  # seed-negocio-2, [] tal como lo deja el seed) no muestra NADA nuevo.
  # Se comprueba ANTES de tocar nada de el-faro (I3 de spec.md).
  # ================================================================
  echo "--- criterio 9 (antes de tocar el-faro) ---"

  FARO_BEFORE="$(body "$BASE/el-faro")"
  check '/el-faro responde 200' 200 "$(code "$BASE/el-faro")"
  not_contains 'criterio 9 — sin selector (data-ref-choices ausente)' "$FARO_BEFORE" 'data-ref-choices='
  not_contains 'criterio 9 — sin ningún equivalente (data-equiv ausente)' "$FARO_BEFORE" 'data-equiv='
  not_contains 'criterio 9 — sin la sub-barra "Cobramos en"' "$FARO_BEFORE" 'Cobramos en'

  # ================================================================
  # Criterio 4 / 12(b) / DH5 — moneda declarada SIN tasa: no se ofrece en el
  # selector, y su equivalente no se pinta en ningún producto.
  # ================================================================
  echo "--- criterio 4 / 12(b) / DH5 (EUR sin tasa) ---"

  R_BIZ1="$(sync_catalog "$TOKEN_B" seed-negocio-2 "[$(business_event "evt-f039-biz1-$SUFFIX" '["CUP","USD","EUR"]')]")"
  contains 'BUSINESS (["CUP","USD","EUR"]) se procesó' "$R_BIZ1" '"status":"processed"'

  R_RATE_USD="$(sync_catalog "$TOKEN_B" seed-negocio-2 "[$(exchange_rate_event "evt-f039-usd1-$SUFFIX" USD 440)]")"
  contains 'EXCHANGE_RATE USD (el-faro) se procesó' "$R_RATE_USD" '"status":"processed"'

  FARO_EUR_SIN_TASA="$(body "$BASE/el-faro")"
  contains 'criterio 4 — el equivalente de USD SÍ se pinta' "$FARO_EUR_SIN_TASA" 'data-equiv="USD"'
  not_contains 'criterio 4 — el equivalente de EUR NO se pinta (sin tasa vigente)' "$FARO_EUR_SIN_TASA" 'data-equiv="EUR"'
  contains 'criterio 4 — el principal sigue presente ("Miel de abeja 250 g")' "$FARO_EUR_SIN_TASA" '>Miel de abeja 250 g</h3>'
  check 'criterio 12(b)/DH5 — el selector ofrece EXACTAMENTE "USD" (EUR fuera, cero apariciones en el control)' \
    'data-ref-choices="USD"' "$(printf '%s' "$FARO_EUR_SIN_TASA" | grep -oE 'data-ref-choices="[^"]*"')"

  # ================================================================
  # Criterio 8 / E19 — llega la tasa que faltaba: la PRIMERA visita
  # posterior ya trae el equivalente nuevo Y la moneda entra sola al
  # selector, sin reenviar BUSINESS y sin esperar el suelo de revalidación.
  # ================================================================
  echo "--- criterio 8 / E19 (llega la tasa de EUR) ---"

  R_RATE_EUR="$(sync_catalog "$TOKEN_B" seed-negocio-2 "[$(exchange_rate_event "evt-f039-eur1-$SUFFIX" EUR 500)]")"
  contains 'EXCHANGE_RATE EUR (el-faro) se procesó' "$R_RATE_EUR" '"status":"processed"'

  FARO_CON_EUR="$(body "$BASE/el-faro")"
  contains 'criterio 8 — el equivalente de EUR aparece en la PRIMERA visita posterior' "$FARO_CON_EUR" 'data-equiv="EUR"'
  check 'criterio 12(b)/E19 — el selector ahora ofrece "USD EUR" (EUR entró solo, sin reenviar BUSINESS)' \
    'data-ref-choices="USD EUR"' "$(printf '%s' "$FARO_CON_EUR" | grep -oE 'data-ref-choices="[^"]*"')"

  MIEL_EUR_1="$(equiv_of "$FARO_CON_EUR" "Miel de abeja 250 g" "EUR")"
  EXPECTED_MIEL_EUR_1="$(convert_via_money 890.00 CUP EUR '{"USD":"440","EUR":"500"}')"
  check 'criterio 8 — el equivalente de EUR coincide con convert() al primer valor de tasa' \
    "$EXPECTED_MIEL_EUR_1" "$(numeric_of "$MIEL_EUR_1")"

  # Y una tasa que CAMBIA (no solo una que llega por primera vez), también
  # sin esperar el suelo de revalidación ni reiniciar nada — la otra mitad
  # de "aplicar un EXCHANGE_RATE cambia los equivalentes".
  R_RATE_EUR2="$(sync_catalog "$TOKEN_B" seed-negocio-2 "[$(exchange_rate_event "evt-f039-eur2-$SUFFIX" EUR 550)]")"
  contains 'EXCHANGE_RATE EUR (nueva tasa, 550) se procesó' "$R_RATE_EUR2" '"status":"processed"'
  FARO_EUR_CAMBIADA="$(body "$BASE/el-faro")"
  MIEL_EUR_2="$(equiv_of "$FARO_EUR_CAMBIADA" "Miel de abeja 250 g" "EUR")"
  EXPECTED_MIEL_EUR_2="$(convert_via_money 890.00 CUP EUR '{"USD":"440","EUR":"550"}')"
  check 'criterio 8 — la tasa de EUR CAMBIADA se refleja en la PRIMERA visita posterior' \
    "$EXPECTED_MIEL_EUR_2" "$(numeric_of "$MIEL_EUR_2")"
  check 'criterio 8 — el equivalente cambió de verdad respecto de la tasa anterior' \
    1 "$([ "$MIEL_EUR_1" != "$MIEL_EUR_2" ] && echo 1 || echo 0)"

  # ================================================================
  # Criterio 5 — la moneda base se muestra aunque NO venga en la lista
  # declarada (R4: nada comprueba la pertenencia de la base a
  # displayCurrencies para pintar el principal). Lista SIN "CUP".
  # ================================================================
  echo "--- criterio 5 ---"

  R_BIZ_SIN_BASE="$(sync_catalog "$TOKEN_B" seed-negocio-2 "[$(business_event "evt-f039-biz-sinbase-$SUFFIX" '["USD"]')]")"
  contains 'BUSINESS (["USD"], SIN "CUP") se procesó' "$R_BIZ_SIN_BASE" '"status":"processed"'
  FARO_SIN_BASE="$(body "$BASE/el-faro")"
  contains 'criterio 5 — el principal ("Miel de abeja 250 g", CUP) sigue presente aunque CUP no esté en la lista' \
    "$FARO_SIN_BASE" '>Miel de abeja 250 g</h3>'
  check 'criterio 5 — el principal sigue siendo $890.00 (la base), sin cambiar' \
    '$890.00' "$(principal_of "$FARO_SIN_BASE" "Miel de abeja 250 g")"
  contains 'criterio 5 — el equivalente de USD se sigue pintando (la lista sin la base no rompe nada)' \
    "$FARO_SIN_BASE" 'data-equiv="USD"'

  # Restaura el-faro a la lista vacía (I3 de spec.md): la próxima corrida de
  # este guion, y la de cualquier otro que asuma seed-negocio-2 sin monedas
  # extra, tiene que encontrar la misma precondición que encontró esta.
  R_BIZ_RESTORE="$(sync_catalog "$TOKEN_B" seed-negocio-2 "[$(business_event "evt-f039-biz-restore-$SUFFIX" '[]')]")"
  contains 'BUSINESS de restauración ([]) se procesó' "$R_BIZ_RESTORE" '"status":"processed"'
  FARO_RESTORED="$(body "$BASE/el-faro")"
  not_contains 'el-faro queda restaurado: sin selector' "$FARO_RESTORED" 'data-ref-choices='
  not_contains 'el-faro queda restaurado: sin equivalentes' "$FARO_RESTORED" 'data-equiv='

  # ExchangeRate es append-only (ADR 0030): la lista vuelve a [] arriba, pero
  # las filas de tasa que este guion le dejó a seed-negocio-2 (USD, EUR)
  # SOBREVIVEN en la base compartida. Si no se borran, la PRÓXIMA corrida de
  # este mismo guion encuentra EUR con tasa vigente desde el principio y el
  # bloque "criterio 4 / DH5 (EUR sin tasa)" de arriba deja de tener nada que
  # probar (comprobado: reventó así en la segunda corrida manual antes de
  # añadir esto). Nunca se toca la tabla `Currency` (global, R6): USD y EUR
  # ya existían antes de este guion y otros negocios pueden usarlas.
  FARO_BUSINESS_ID="$(psql_val "SELECT id FROM \"Business\" WHERE \"externalId\"='seed-negocio-2'")"
  if [ -n "$FARO_BUSINESS_ID" ]; then
    psql_val "DELETE FROM \"ExchangeRate\" WHERE \"businessId\"='$FARO_BUSINESS_ID' AND \"currencyCode\" IN ('USD','EUR')" >/dev/null
  fi

  # ================================================================
  # Criterio 6 — el equivalente coincide al céntimo con lo que cobra el
  # checkout, creando un pedido REAL y comparando los dos números (I1 de
  # spec.md: el checkout nunca cobra en la moneda del equivalente, así que
  # se comparan las DOS mitades que sí son literales — (a) el principal es
  # el importe cobrado, (b) el equivalente es convert() de ese mismo importe
  # con las mismas tasas de esa cotización).
  # ================================================================
  echo "--- criterio 6 ---"

  AGUA_ID="e253f046-fb9b-407c-9085-85c069cc2f3e"
  QUOTE="$(curl -s -X POST "$BASE/api/orders/quote" -H 'content-type: application/json' \
    -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$AGUA_ID\",\"qty\":1}]}")"
  UNIT_PRICE="$(printf '%s' "$QUOTE" | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(b.lines[0].unitPrice)')"
  QUOTE_SUBTOTAL="$(printf '%s' "$QUOTE" | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(b.subtotal)')"
  RATES_JSON="$(printf '%s' "$QUOTE" | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(b.rates))')"
  DISPLAY_CURRENCIES_JSON="$(printf '%s' "$QUOTE" | node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(b.store.displayCurrencies))')"

  check '(a) el principal de la tarjeta === unitPrice de la cotización, en la moneda base' \
    "$(numeric_of "$PRINCIPAL_AGUA")" "$UNIT_PRICE"

  EXPECTED_EQUIV_USD="$(convert_via_money "$UNIT_PRICE" CUP USD "$RATES_JSON")"
  check '(b) el equivalente de la tarjeta === convert(unitPrice, USD, tasas de esa cotización)' \
    "$EXPECTED_EQUIV_USD" "$(numeric_of "$EQUIV_USD_AGUA")"

  # DH3, no cuenta como criterio (I2 de spec.md): lo que carrito y checkout
  # necesitan para pintar el equivalente del agregado viaja en la MISMA
  # cotización, no en una lectura aparte (AD3).
  check 'DH3 — QuoteResponse publica displayCurrencies (["CUP","USD","MLC"])' \
    '["CUP","USD","MLC"]' "$DISPLAY_CURRENCIES_JSON"
  check 'DH3 — QuoteResponse.rates trae la tabla ENTERA, la MISMA que produjo el subtotal' \
    '{"MLC":"210.5","USD":"440"}' "$RATES_JSON"

  # Ahora el pedido de verdad: mismo producto, mismo storeSlug.
  PHONE="+53$(date +%s | tail -c 9)"
  ORDER_BODY=$(node -e '
    const [subtotal, phone] = process.argv.slice(1);
    console.log(JSON.stringify({
      storeSlug: "tienda-demo",
      items: [{ storeProductId: "e253f046-fb9b-407c-9085-85c069cc2f3e", qty: 1 }],
      contact: { name: "Smoke F039", phone },
      fulfillment: "PICKUP",
      expectedTotal: subtotal,
    }));
  ' "$QUOTE_SUBTOTAL" "$PHONE")
  ORDER_HTTP=$(curl -s -o /tmp/f039-order-response.json -w '%{http_code}' -X POST "$BASE/api/orders" \
    -H 'content-type: application/json' -d "$ORDER_BODY")
  check 'criterio 6 — POST /api/orders responde 201' 201 "$ORDER_HTTP"

  if [ "$ORDER_HTTP" = "201" ]; then
    ORDER_CODE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/f039-order-response.json","utf8")).code)')"
    ORDER_ROW="$(psql_val "SELECT oi.\"unitPrice\", oi.\"currencyCode\" FROM \"Order\" o JOIN \"OrderItem\" oi ON oi.\"orderId\"=o.id WHERE o.code='$ORDER_CODE'")"
    ORDER_UNIT_PRICE="$(printf '%s' "$ORDER_ROW" | cut -d'|' -f1)"
    ORDER_CURRENCY="$(printf '%s' "$ORDER_ROW" | cut -d'|' -f2)"

    check 'criterio 6 — el pedido creado cobra en la moneda BASE (CUP)' 'CUP' "$ORDER_CURRENCY"
    check 'criterio 6 — el pedido creado guarda el MISMO unitPrice que el principal de la tarjeta' \
      "$(numeric_of "$PRINCIPAL_AGUA")" "$ORDER_UNIT_PRICE"

    # I1 de spec.md: "las tasas de esa cotización" son las de la COTIZACIÓN
    # (RATES_JSON, QuoteResponse.rates/AD3), no las de
    # Order.rateSnapshot — ese campo solo guarda las monedas de ORIGEN que de
    # verdad tuvieron que convertirse para fijar el precio del pedido (R9 de
    # createOrder.ts: "Only the currencies actually used in the order"), y
    # "Agua natural 500 ml" ya está en la base (CUP) — su rateSnapshot.rates
    # es {} aunque el negocio sí tenga tasa de USD. Confirmado leyendo la
    # fila antes de escribir este aserto, no asumido.
    EXPECTED_EQUIV_FROM_ORDER="$(convert_via_money "$ORDER_UNIT_PRICE" CUP USD "$RATES_JSON")"
    check 'criterio 6 — convert(unitPrice_del_pedido, USD, tasas de la cotización) === equivalente que vio la tarjeta' \
      "$EXPECTED_EQUIV_FROM_ORDER" "$(numeric_of "$EQUIV_USD_AGUA")"
  fi

  # ================================================================
  # El recorrido de las cinco pantallas (criterio 12(a), DH2): un solo
  # selector/mecanismo que aplica a las cinco, sin volver a elegir.
  # ================================================================
  echo "--- las cinco pantallas ---"

  for path in "/tienda-demo" "/tienda-demo/c/bebidas" "/tienda-demo/catalogo" "/tienda-demo/buscar?q=agua" "/tienda-demo/p/agua-natural-500-ml"; do
    HTML="$(body "$BASE$path")"
    check "las cinco pantallas — $path responde 200" 200 "$(code "$BASE$path")"
    contains "las cinco pantallas — $path trae data-ref-choices (el mismo mecanismo en las cinco)" "$HTML" 'data-ref-choices='
    contains "las cinco pantallas — $path trae al menos un equivalente" "$HTML" 'data-equiv='
  done
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
