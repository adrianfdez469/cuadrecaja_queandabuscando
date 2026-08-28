#!/usr/bin/env bash
# Verificación en runtime de F-010 (carrito y checkout). La ejecuta
# `bash .agent/verify.sh F-010 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL. Recorre, en orden, lo que design.md llama V1..V6 —lo que
# se puede comprobar sin navegador— y luego ejercita la creación real de
# pedidos con scripts/place-order.mjs, que es lo que hace verificables los
# criterios 3 y 4 (spec.md R25).
#
# Da por hecho que `npm run seed` ya corrió contra la base a la que apunta
# DATABASE_URL/DIRECT_URL: tienda-demo (WHATSAPP, sin envío) y tienda-dos
# (ONSITE, con envío) tienen que existir con sus productos.
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

check_ge() { # check_ge <qué se espera> <minimo> <obtenido>
  if [ "$3" -ge "$2" ] 2>/dev/null; then
    printf '  ok   %s (%s)\n' "$1" "$3"
  else
    printf 'SMOKE FAIL %s — esperaba >= %s, obtuve %s\n' "$1" "$2" "$3"
    FAILS=$((FAILS + 1))
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1"; }
body() { curl -s "$BASE$1"; }

# F-018: el criterio 11/V4/V5 de más abajo llama a /api/internal/orders con
# el token de seed-negocio-1. Nunca se salta en verde: falla ahora, con el
# comando exacto, en vez de dejar que LAST_CODE quede vacío más abajo.
if [ -z "${QAB_BEARER_TOKEN:-}" ] && ! grep -q '^QAB_BEARER_TOKEN=".\{32,\}"' .env 2>/dev/null; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  exit 1
fi

# ---------------------------------------------------------------- V1..V6 ----

# V1 — el botón de agregar de un producto agotado llega deshabilitado en el
# HTML servido, sin esperar al JS. El atributo, no la clase: `grep -c
# 'disabled'` a secas siempre pasa por `disabled:pointer-events-none` del
# Button (ficha del hallazgo del diseñador, criterio 2a).
DISABLED_COUNT=$(body /tienda-demo/p/jugo-de-mango-1-l | grep -c 'disabled=""')
check_ge 'V1 — botón "Agotado" con disabled="" en el HTML' 1 "$DISABLED_COUNT"

# V2 — /carrito trae el cascarón de carga y el <noscript>, ambos servidos.
CARRITO_HTML="$(body /tienda-demo/carrito)"
echo "$CARRITO_HTML" | grep -qi 'Cargando tu carrito' &&
  printf '  ok   V2 — /carrito trae "Cargando tu carrito…" en el HTML\n' ||
  { printf 'SMOKE FAIL V2 — "Cargando tu carrito…" no está en el HTML servido\n'; FAILS=$((FAILS + 1)); }
echo "$CARRITO_HTML" | grep -qi '<noscript>' &&
  printf '  ok   V2 — /carrito trae <noscript>\n' ||
  { printf 'SMOKE FAIL V2 — /carrito no trae <noscript>\n'; FAILS=$((FAILS + 1)); }

# V3 — el checkout trae los campos de contacto YA en el HTML, no después de
# hidratar (design.md F0: "no dependen de nada").
body /tienda-demo/checkout | grep -qi 'Nombre y apellidos' &&
  printf '  ok   V3 — /checkout trae "Nombre y apellidos" en el HTML servido\n' ||
  { printf 'SMOKE FAIL V3 — los campos de contacto no vienen en el HTML servido\n'; FAILS=$((FAILS + 1)); }

# V6 — la cabecera trae el enlace "Carrito" en toda página de tienda,
# incluidas las SSG, y sin burbuja antes de hidratar (getServerSnapshot vacío).
STORE_HTML="$(body /tienda-demo)"
echo "$STORE_HTML" | grep -qo 'Carrito' &&
  printf '  ok   V6 — la cabecera trae el enlace Carrito\n' ||
  { printf 'SMOKE FAIL V6 — la cabecera no trae el enlace Carrito\n'; FAILS=$((FAILS + 1)); }

# ------------------------------------------------------- criterio 6 (●/ƒ) ----

check '/[slug] responde 200 (sigue existiendo tras el feature)' 200 "$(code /tienda-demo)"
check '/[slug]/carrito responde 200 (ƒ, nunca cacheada)' 200 "$(code /tienda-demo/carrito)"
check '/[slug]/checkout responde 200' 200 "$(code /tienda-demo/checkout)"
check '/[slug]/pedido/<code inexistente> responde 404 (E17)' 404 "$(code /tienda-demo/pedido/ZZZZZZZZZZ)"

CARRITO_NO_STORE="$(curl -sI "$BASE/tienda-demo/carrito" | grep -ic 's-maxage')"
check 'V2/criterio 6 — /carrito no lleva s-maxage' 0 "$CARRITO_NO_STORE"

# ------------------------------------------------ POST /api/orders/quote ----

QUOTE_BODY=$(curl -s -X POST "$BASE/api/orders/quote" \
  -H 'content-type: application/json' \
  -d '{"storeSlug":"tienda-demo","items":[]}')
echo "$QUOTE_BODY" | grep -q '"subtotal":"0.00"' &&
  printf '  ok   quote vacío responde subtotal 0.00\n' ||
  { printf 'SMOKE FAIL quote vacío no responde subtotal 0.00 — %s\n' "$QUOTE_BODY"; FAILS=$((FAILS + 1)); }

QUOTE_404=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/orders/quote" \
  -H 'content-type: application/json' -d '{"storeSlug":"no-existe","items":[]}')
check 'quote de una tienda inexistente responde 404' 404 "$QUOTE_404"

# ------------------------------------------------------------ criterio 4 ----

# Sin cabecera Cookie en ningún punto del camino de escritura (R24).
if git grep -qn 'cookies()' -- src/features/orders/ "src/app/[slug]/"; then
  printf 'SMOKE FAIL criterio 4 — se encontró cookies() en el camino del pedido\n'
  FAILS=$((FAILS + 1))
else
  printf '  ok   criterio 4 — sin lectura de cookies() en el camino del pedido\n'
fi

# ---------------------------------------------- creación real de pedidos ----
# scripts/place-order.mjs ES el ejercitador de R25: crea el pedido sin
# navegador y sin Cookie, y lo comprueba contra la base (criterios 3 y 4).

if QAB_BASE_URL="$BASE" node scripts/place-order.mjs; then
  printf '  ok   place-order.mjs (pedido normal, criterios 3 y 4)\n'
else
  printf 'SMOKE FAIL place-order.mjs (pedido normal) — ver salida arriba\n'
  FAILS=$((FAILS + 1))
fi

if QAB_BASE_URL="$BASE" node scripts/place-order.mjs --idempotent; then
  printf '  ok   place-order.mjs --idempotent (criterio 16)\n'
else
  printf 'SMOKE FAIL place-order.mjs --idempotent — ver salida arriba\n'
  FAILS=$((FAILS + 1))
fi

if QAB_BASE_URL="$BASE" node scripts/place-order.mjs --store=tienda-dos --delivery; then
  printf '  ok   place-order.mjs --store=tienda-dos --delivery (criterio 12)\n'
else
  printf 'SMOKE FAIL place-order.mjs --delivery — ver salida arriba\n'
  FAILS=$((FAILS + 1))
fi

# ---------------------------------------------------------- criterio 11 ----

# tienda-demo es WHATSAPP con número: la página del pedido debe traer wa.me.
LAST_CODE=$(curl -s "$BASE/api/internal/orders?since=0&limit=1" \
  -H "authorization: Bearer ${QAB_BEARER_TOKEN:-$(grep -m1 '^QAB_BEARER_TOKEN' .env | cut -d'"' -f2)}" |
  node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);console.log(j.orders?.[0]?.code ?? "");}catch{console.log("");}})')

if [ -n "$LAST_CODE" ]; then
  WA_COUNT=$(body "/tienda-demo/pedido/$LAST_CODE" | grep -c 'wa.me')
  check_ge 'criterio 11 — WHATSAPP trae wa.me en la página del pedido' 1 "$WA_COUNT"

  # V5 — la página del pedido no añade ni un módulo de cliente respecto a la
  # tienda (DP2: cero JS propio).
  STORE_CHUNKS=$(body /tienda-demo | grep -c '_next/static/chunks')
  ORDER_CHUNKS=$(body "/tienda-demo/pedido/$LAST_CODE" | grep -c '_next/static/chunks')
  check 'V5 — /pedido/[code] no añade chunks de cliente' "$STORE_CHUNKS" "$ORDER_CHUNKS"
else
  printf 'SMOKE FAIL no se pudo leer un code por /api/internal/orders para V4/V5/criterio 11\n'
  FAILS=$((FAILS + 1))
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
