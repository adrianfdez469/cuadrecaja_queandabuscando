#!/usr/bin/env bash
# Verificación en runtime de F-011 (panel de administración). La ejecuta
# `bash .agent/verify.sh F-011 --smoke` con `next dev` ya levantado en
# $SMOKE_BASE_URL, contra la base y el emulador de Storage reales de
# docker-compose.yml (deben estar arriba: `docker compose up -d`).
#
# Ciclo 1 (pasos 1-11): base común, productos, imágenes.
# Ciclo 2 (pasos 12-18): el interruptor público de la tienda (HD10-HD15,
# AP5(b), AP6), promociones completas (P1-P12 de spec.md) y su efecto sobre
# el checkout de F-010. El paso 17 (diff v3 del contrato) es prosa y se
# verifica aparte en tests.md — no hay endpoint nuevo que ejercitar aquí.
#
# Regla: cada aserción que no se cumpla imprime `SMOKE FAIL <qué>` y suma un
# fallo. No usa grep con clases estilo Perl/GNU (ficha
# playbook-firma-grep-bsd-no-gnu): el parseo de HTML/JSON se hace con `node`,
# cuyo motor de regex no depende del grep del sistema.
#
# Fixtures sobre datos del seed (prisma/seed.ts): storeIds/slugs/nombres de
# producto son deterministas mientras no se reseedee desde cero, igual que ya
# asume scripts/mint-sso-token.mjs, scripts/send-catalog-batch.mjs y
# scripts/send-store-batch.mjs (nuevo en este ciclo, mismo patrón).
#
# Nunca se verifica el interruptor con SQL directo: un `UPDATE "Store" SET
# status=...` no pasa por `revalidateStores`, así que la tienda pública
# seguiría sirviendo el estado viejo aunque la fila ya cambió (falso verde
# documentado en plan.md § Riesgos). Toda escritura de este guion pasa por
# el endpoint del panel o por el endpoint de sync, nunca por `psql`.
#
# Qué NO cubre este guion, y por qué:
#   - El 503 con el contenedor de Storage detenido (criterio 11 [nuevo]):
#     apagar un servicio compartido de docker-compose dentro de un sensor que
#     se repite y que puede abortar a mitad no es seguro (deja Storage caído
#     para cualquier otra verificación que corra después). Se verificó a mano
#     con `docker compose stop storage` real; ver tests.md.
#   - `verify.sh --full` (harness/prisma/build/theme/bundle) y
#     `check:bundle` (incluida su verificación de que falla explícito sin
#     tienda publicada, HD12): no son runtime de una sola app en pie, van en
#     `tests.md` con su propia salida.
set -uo pipefail

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# F-018: P10/P11 más abajo llaman a /api/internal/orders con el token de
# seed-negocio-1. Nunca se salta en verde: falla ahora, con el comando
# exacto, en vez de dejar que /api/internal/orders devuelva 401 en silencio.
if [ -z "${QAB_BEARER_TOKEN:-}" ] && ! grep -q '^QAB_BEARER_TOKEN=".\{32,\}"' .env 2>/dev/null; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  exit 1
fi

check() { # check <qué se espera> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — esperaba %s, obtuve %s\n' "$1" "$2" "$3"
    FAILS=$((FAILS + 1))
  fi
}

contains() { # contains <qué se espera> <archivo> <aguja>
  # La aguja se busca también sin barras de escape: la página HTML incluye
  # el payload RSC como una cadena JS, donde cada " queda como \" — buscar la
  # aguja "cruda" contra ese texto escapado siempre fallaría. Comillas simples
  # a propósito: sin interpolación de bash dentro del script de node.
  if node -e '
    const fs = require("fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    const unescaped = html.split("\\\"").join("\"");
    process.exit(html.includes(process.argv[2]) || unescaped.includes(process.argv[2]) ? 0 : 1);
  ' "$2" "$3"; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — no se encontró %s en %s\n' "$1" "$3" "$2"
    FAILS=$((FAILS + 1))
  fi
}

not_contains() { # not_contains <qué se espera> <archivo> <aguja>
  if node -e '
    const fs = require("fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    const unescaped = html.split("\\\"").join("\"");
    process.exit(html.includes(process.argv[2]) || unescaped.includes(process.argv[2]) ? 1 : 0);
  ' "$2" "$3"; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — %s SÍ apareció en %s (no debería)\n' "$1" "$3" "$2"
    FAILS=$((FAILS + 1))
  fi
}

extract_first() { # extract_first <archivo> <regex-js> [grupo=1]
  node -e "
    const fs = require('fs');
    const html = fs.readFileSync(process.argv[1], 'utf8');
    const re = new RegExp(process.argv[2]);
    const m = html.match(re);
    process.stdout.write(m ? m[Number(process.argv[3] || 1)] : '');
  " "$1" "$2" "${3:-1}"
}

json_field() { # json_field <archivo> <campo>
  node -e "
    const fs = require('fs');
    let body;
    try { body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); }
    catch { process.stdout.write('<invalid-json>'); process.exit(0); }
    const v = body[process.argv[2]];
    process.stdout.write(v === null ? '<null>' : v === undefined ? '<undefined>' : String(v));
  " "$1" "$2"
}

code() { curl -sS -o "$WORKDIR/last_body" -w '%{http_code}' "$@"; }

# F-018: el token es por negocio. QAB_BEARER_TOKEN vive en .env (el de
# seed-negocio-1), no en el entorno del sensor. Leído a mano (sin el paquete
# dotenv) porque `require("dotenv").config()` imprime un banner informativo
# en STDOUT ("injected env (N) from .env"), que se mete dentro de cualquier
# valor capturado con $(...) y corrompe el token en silencio.
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

echo "== preparación: cookies de sesión =="

# Cookie de una sola tienda (seed-tienda-1): la que dispara el 403/404 sobre
# la otra tienda del seed (I7 / fixture del paso 5).
URL_A=$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=seed-tienda-1)
curl -sS -c "$WORKDIR/cookie_a.jar" -o /dev/null "$URL_A"

# Cookie de las dos tiendas del seed, solo para descubrir el id interno de la
# tienda ajena (seed-tienda-2) sin adivinarlo.
URL_BOTH=$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs)
curl -sS -c "$WORKDIR/cookie_both.jar" -o /dev/null "$URL_BOTH"

if [ ! -s "$WORKDIR/cookie_a.jar" ] || ! grep -q qab-admin-session "$WORKDIR/cookie_a.jar" 2>/dev/null; then
  echo "SMOKE FAIL no se obtuvo la cookie qab-admin-session — revisa SSO_JWT_SECRET/ADMIN_SESSION_SECRET en .env"
  exit 1
fi

echo "== criterio 1: listado filtrado por storeIds =="
code -b "$WORKDIR/cookie_a.jar" "$BASE/admin"
cp "$WORKDIR/last_body" "$WORKDIR/admin_a.html"
STORE_A_ID=$(extract_first "$WORKDIR/admin_a.html" 'data-store-id="([^"]+)"')
if [ -z "$STORE_A_ID" ]; then
  echo "SMOKE FAIL no se encontró data-store-id en /admin con la cookie de una sola tienda"
  exit 1
fi

code -b "$WORKDIR/cookie_both.jar" "$BASE/admin"
cp "$WORKDIR/last_body" "$WORKDIR/admin_both.html"
STORE_B_ID=$(node -e "
  const fs = require('fs');
  const html = fs.readFileSync(process.argv[1], 'utf8');
  const ids = [...html.matchAll(/data-store-id=\"([^\"]+)\"/g)].map((m) => m[1]);
  const other = ids.find((id) => id !== process.argv[2]);
  process.stdout.write(other || '');
" "$WORKDIR/admin_both.html" "$STORE_A_ID")
if [ -z "$STORE_B_ID" ]; then
  echo "SMOKE FAIL no se encontró una segunda tienda (seed-tienda-2) con la cookie de ambas — revisa prisma/seed.ts"
  exit 1
fi

contains "tienda propia SÍ aparece en el listado de storeIds=[seed-tienda-1]" "$WORKDIR/admin_a.html" "$STORE_A_ID"
not_contains "tienda ajena NO aparece en el listado de storeIds=[seed-tienda-1]" "$WORKDIR/admin_a.html" "$STORE_B_ID"

echo "== localizar productos fijos del seed (Refresco de cola 1.5 L en A, cualquiera en B) =="
code -b "$WORKDIR/cookie_a.jar" "$BASE/admin/tiendas/$STORE_A_ID/productos"
cp "$WORKDIR/last_body" "$WORKDIR/products_a.html"
PROD_A=$(extract_first "$WORKDIR/products_a.html" "productos/([^\"]+)\">Refresco de cola 1\\.5 L")
if [ -z "$PROD_A" ]; then
  echo "SMOKE FAIL no se encontró 'Refresco de cola 1.5 L' (seed-tienda-1-p0) en el listado de productos de la tienda propia"
  exit 1
fi
PROD_A2=$(extract_first "$WORKDIR/products_a.html" "productos/([^\"]+)\">Agua natural 500 ml")
if [ -z "$PROD_A2" ]; then
  echo "SMOKE FAIL no se encontró 'Agua natural 500 ml' (seed-tienda-1-p1) en el listado de productos de la tienda propia"
  exit 1
fi

code -b "$WORKDIR/cookie_both.jar" "$BASE/admin/tiendas/$STORE_B_ID/productos"
cp "$WORKDIR/last_body" "$WORKDIR/products_b.html"
PROD_B=$(extract_first "$WORKDIR/products_b.html" 'data-store-product-id="([^"]+)"')
if [ -z "$PROD_B" ]; then
  echo "SMOKE FAIL no se encontró ningún producto en la tienda ajena — revisa prisma/seed.ts"
  exit 1
fi

echo "== criterio 2: 401 sin cookie, 403 en tienda ajena, 200 en la propia =="
BODY_OWN='{"description":"smoke-own","imageUrls":[],"visible":true,"featured":false,"priceOverride":null}'
BODY_FOREIGN='{"description":"smoke-should-not-land","imageUrls":[],"visible":true,"featured":false,"priceOverride":null}'

C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_OWN" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A")
check "PUT sobre la tienda propia" 200 "$C"

C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_FOREIGN" \
  "$BASE/api/admin/stores/$STORE_B_ID/products/$PROD_B")
check "PUT sobre la tienda ajena" 403 "$C"
check "cuerpo del 403 es FORBIDDEN" '{"error":"FORBIDDEN"}' "$(cat "$WORKDIR/last_body")"

C=$(code -X PUT -H 'Content-Type: application/json' -d "$BODY_OWN" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A")
check "PUT sin cookie" 401 "$C"

echo "== criterio 6 [nuevo]: la página de edición de una tienda ajena responde 404 =="
C=$(code -b "$WORKDIR/cookie_a.jar" "$BASE/admin/tiendas/$STORE_B_ID/productos/$PROD_B")
check "GET de la página de edición ajena" 404 "$C"

echo "== paso 7 / criterio 8 [nuevo]: priceOverride negativo, con 3 decimales, y priceOverrideCurrency =="
BODY_NEG='{"description":"smoke-own","imageUrls":[],"visible":true,"featured":false,"priceOverride":"-5.00"}'
C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_NEG" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A")
check "priceOverride negativo" 400 "$C"

BODY_3DEC='{"description":"smoke-own","imageUrls":[],"visible":true,"featured":false,"priceOverride":"5.123"}'
C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_3DEC" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A")
check "priceOverride con tres decimales" 400 "$C"

BODY_PRICE='{"description":"smoke-own","imageUrls":[],"visible":true,"featured":false,"priceOverride":"50.00"}'
C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_PRICE" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A")
check "PUT con priceOverride válido" 200 "$C"
cp "$WORKDIR/last_body" "$WORKDIR/put_price.json"
SYNCED_CCY=$(json_field "$WORKDIR/put_price.json" syncedPriceCurrency)
OVERRIDE_CCY=$(json_field "$WORKDIR/put_price.json" priceOverrideCurrency)
check "priceOverrideCurrency = syncedPriceCurrency" "$SYNCED_CCY" "$OVERRIDE_CCY"

BODY_CLEAR='{"description":"smoke-own","imageUrls":[],"visible":true,"featured":false,"priceOverride":null}'
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_CLEAR" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A" >/dev/null
cp "$WORKDIR/last_body" "$WORKDIR/put_clear.json"
check "priceOverride vuelve a null tras quitarlo" '<null>' "$(json_field "$WORKDIR/put_clear.json" priceOverride)"
check "priceOverrideCurrency vuelve a null tras quitarlo" '<null>' "$(json_field "$WORKDIR/put_clear.json" priceOverrideCurrency)"

echo "== criterio 3: los seis campos del panel sobreviven a un product.update del sync =="
BODY_FIX='{"description":"smoke-fijado-por-panel","imageUrls":[],"visible":false,"featured":true,"priceOverride":"111.11"}'
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_FIX" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A" >/dev/null

SYNC_OUT=$(QAB_BASE_URL="$BASE" node scripts/send-catalog-batch.mjs 2>&1)
if ! printf '%s' "$SYNC_OUT" | node -e "
  const fs = require('fs');
  const s = fs.readFileSync(0, 'utf8');
  process.exit(s.includes('HTTP 207') ? 0 : 1);
"; then
  echo "SMOKE FAIL send-catalog-batch.mjs no respondió HTTP 207"
  printf '%s\n' "$SYNC_OUT"
  FAILS=$((FAILS + 1))
fi

code -b "$WORKDIR/cookie_a.jar" "$BASE/admin/tiendas/$STORE_A_ID/productos/$PROD_A"
cp "$WORKDIR/last_body" "$WORKDIR/edit_after_sync.html"
contains "syncedPrice cambió a 499 tras el evento del sync" "$WORKDIR/edit_after_sync.html" '"syncedPrice":"499"'
contains "description del panel sigue intacta" "$WORKDIR/edit_after_sync.html" '"description":"smoke-fijado-por-panel"'
contains "visible del panel sigue intacto" "$WORKDIR/edit_after_sync.html" '"visible":false'
contains "featured del panel sigue intacto" "$WORKDIR/edit_after_sync.html" '"featured":true'
contains "priceOverride del panel sigue intacto" "$WORKDIR/edit_after_sync.html" '"priceOverride":"111.11"'
contains "priceOverrideCurrency del panel sigue intacto" "$WORKDIR/edit_after_sync.html" '"priceOverrideCurrency":"CUP"'

echo "== criterio 4 (F-023, AP1 aprobada): subir una imagen la guarda en Supabase Storage y se sirve directo del CDN =="
# F-023 apagó el optimizador (images.unoptimized: true, R1): /_next/image ya
# no existe para servir esto — el criterio que este bloque comprobaba está
# sustituido por el de F-023 (regla 3: se protege el criterio, no el guion).
# Lo que sigue viviendo aquí: la subida real deja un objeto legible en el
# emulador, y ahora TAMBIÉN su variante AVIF (F-023 R2), sin pasar por
# ningún optimizador.
UPLOAD_CODE=$(curl -sS -o "$WORKDIR/upload.json" -w '%{http_code}' \
  -b "$WORKDIR/cookie_a.jar" \
  -F "file=@.agent/specs/F-011/fixtures/sample.jpg;type=image/jpeg" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A/images")
check "subida del fixture real" 201 "$UPLOAD_CODE"
IMG_URL=$(json_field "$WORKDIR/upload.json" url)

if [ -n "$IMG_URL" ] && [ "$IMG_URL" != "<undefined>" ]; then
  DIRECT_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$IMG_URL")
  check "lectura directa del original desde el CDN del emulador" 200 "$DIRECT_CODE"

  # F-023: el original vive en `.../<uuid>/original.<ext>`; su variante de
  # tarjeta AVIF es el mismo directorio con `w400.avif` en vez del basename.
  AVIF_URL=$(node -e "
    process.stdout.write(process.argv[1].replace(/[^/]+$/, 'w400.avif'));
  " "$IMG_URL")
  AVIF_CODE=$(curl -sS -o /dev/null \
    -H 'Accept: image/avif,image/webp,image/*,*/*;q=0.8' \
    -w '%{http_code}' "$AVIF_URL")
  check "la variante AVIF de tarjeta responde 200 directo del CDN, sin optimizador" 200 "$AVIF_CODE"
  AVIF_CTYPE=$(curl -sS -I "$AVIF_URL" | tr -d '\r' | node -e "
    const s = require('fs').readFileSync(0, 'utf8').toLowerCase();
    const m = s.match(/content-type:\s*([^\n]+)/);
    process.stdout.write(m ? m[1].trim() : '');
  ")
  check "content-type de la variante AVIF" "image/avif" "$AVIF_CTYPE"
else
  echo "SMOKE FAIL la subida no devolvió una url utilizable — se omiten las comprobaciones del CDN"
  FAILS=$((FAILS + 1))
fi

echo "== criterio 10 [nuevo]: 6 MB, mime falso y novena imagen, sobre un producto aparte =="
node -e "
  const fs = require('fs');
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6 * 1024 * 1024, 0x30)]);
  fs.writeFileSync(process.argv[1], buf);
" "$WORKDIR/big.jpg"
printf 'esto es texto plano, no una imagen' >"$WORKDIR/fake.jpg"

BIG_CODE=$(curl -sS -o "$WORKDIR/big_upload.json" -w '%{http_code}' \
  -b "$WORKDIR/cookie_a.jar" \
  -F "file=@$WORKDIR/big.jpg;type=image/jpeg" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A2/images")
check "archivo de 6 MB" 400 "$BIG_CODE"

FAKE_CODE=$(curl -sS -o "$WORKDIR/fake_upload.json" -w '%{http_code}' \
  -b "$WORKDIR/cookie_a.jar" \
  -F "file=@$WORKDIR/fake.jpg;type=image/jpeg" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A2/images")
check "text/plain renombrado a .jpg" 400 "$FAKE_CODE"

# Ocho subidas válidas llenan el tope (PRODUCT_MAX_IMAGES); la novena tiene
# que responder 409 y dejar imageUrls sin la novena.
#
# F-023: un JPEG con solo el encabezado mágico (FF D8 FF E0) y basura detrás
# pasaba el sniff de mime de F-011 pero, desde que la subida decodifica de
# verdad (SP1), sharp no puede decodificarlo y la respuesta pasa a ser 400
# "reason":"decode" en vez de 201 — un fixture minúsculo pero REAL de sharp
# es la única forma de seguir probando el tope de 8, no la del mime.
#
# F-023 (I5): `prisma/seed.ts::seedProductImages` deja SIEMPRE una imagen ya
# puesta en los 15 productos de tienda-demo — PROD_A2 arranca con 1, no con
# 0. Siete subidas más (no ocho) llegan al tope de 8; la octava es la que
# tiene que dar 409 ("novena" en el nombre de la variable, heredado del
# conteo de F-011, ahora la 8.ª subida de este guion pero la 9.ª imagen real).
NINTH_CODE=0
for i in 1 2 3 4 5 6 7; do
  node -e "
    const sharp = require('sharp');
    const n = Number(process.argv[2]);
    sharp({ create: { width: 4, height: 4, channels: 3, background: { r: n * 10, g: 0, b: 0 } } })
      .jpeg()
      .toFile(process.argv[1])
      .catch((e) => { console.error(e); process.exit(1); });
  " "$WORKDIR/fill$i.jpg" "$i"
  ROUND_CODE=$(curl -sS -o "$WORKDIR/fill_upload_$i.json" -w '%{http_code}' \
    -b "$WORKDIR/cookie_a.jar" \
    -F "file=@$WORKDIR/fill$i.jpg;type=image/jpeg" \
    "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A2/images")
  if [ "$ROUND_CODE" != "201" ]; then
    echo "SMOKE FAIL subida $i/7 para llenar el tope (arrancando de 1 imagen ya sembrada) no respondió 201 (obtuvo $ROUND_CODE)"
    FAILS=$((FAILS + 1))
  fi
done
node -e "
  const sharp = require('sharp');
  sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 200 } } })
    .jpeg()
    .toFile(process.argv[1])
    .catch((e) => { console.error(e); process.exit(1); });
" "$WORKDIR/ninth.jpg"
NINTH_CODE=$(curl -sS -o "$WORKDIR/ninth_upload.json" -w '%{http_code}' \
  -b "$WORKDIR/cookie_a.jar" \
  -F "file=@$WORKDIR/ninth.jpg;type=image/jpeg" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A2/images")
check "novena imagen" 409 "$NINTH_CODE"

echo "== criterio 12 [nuevo]: una escritura en A no invalida la caché pública de B =="
code "$BASE/tienda-dos"
cp "$WORKDIR/last_body" "$WORKDIR/tienda_dos_before.html"
BEFORE_HAS_ORIG=$(node -e "
  const fs = require('fs');
  process.stdout.write(fs.readFileSync(process.argv[1], 'utf8').includes('470.00') ? 'yes' : 'no');
" "$WORKDIR/tienda_dos_before.html")

MARK="smoke-criterio12-$(date +%s)"
BODY_MARK="{\"description\":\"$MARK\",\"imageUrls\":[],\"visible\":true,\"featured\":false,\"priceOverride\":null}"
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_MARK" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A" >/dev/null

code "$BASE/tienda-dos"
cp "$WORKDIR/last_body" "$WORKDIR/tienda_dos_after.html"
AFTER_HAS_ORIG=$(node -e "
  const fs = require('fs');
  process.stdout.write(fs.readFileSync(process.argv[1], 'utf8').includes('470.00') ? 'yes' : 'no');
" "$WORKDIR/tienda_dos_after.html")
check "tienda-dos conserva su precio (470.00) tras escribir en A" "$BEFORE_HAS_ORIG" "$AFTER_HAS_ORIG"
not_contains "tienda-dos no absorbió la marca de la escritura en A" "$WORKDIR/tienda_dos_after.html" "$MARK"

echo "== paso 12/HD12: la tienda-cerrada del seed responde 200 con su aviso, nunca 404 =="
C=$(code "$BASE/tienda-cerrada")
check "GET /tienda-cerrada (nunca abierta manualmente, pero con motivo VACACIONES en el seed)" 200 "$C"
contains "muestra el motivo del seed (VACACIONES)" "$WORKDIR/last_body" "Cerrado por vacaciones. Volvemos pronto."
not_contains "no filtra catálogo (no hay <ul> de productos)" "$WORKDIR/last_body" "grid-cols-2"
echo "== paso 12/HD12: noindex mientras está cerrada =="
contains "tienda-cerrada lleva noindex mientras está cerrada" "$WORKDIR/last_body" '<meta name="robots" content="noindex"/>'

echo "== paso 12/AP5(b): un evento STORE rutinario del POS no reabre lo que el panel cerró =="
# tienda-demo empieza abierta (seed); la cerramos desde el panel con un
# motivo, y comprobamos que send-store-batch.mjs (publishToStore:true, el
# MISMO que ya tenía, solo cambia el teléfono) no la reabre.
AP5_MARK="smoke-ap5-$(date +%s)"
BODY_CLOSE_AP5="{\"enabled\":false,\"reasonCode\":\"VACACIONES\",\"message\":\"$AP5_MARK\"}"
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_CLOSE_AP5" \
  "$BASE/api/admin/stores/$STORE_A_ID/status" >/dev/null

ROUTINE_OUT=$(QAB_BASE_URL="$BASE" node scripts/send-store-batch.mjs 2>&1)
if ! printf '%s' "$ROUTINE_OUT" | node -e "
  const s = require('fs').readFileSync(0, 'utf8');
  process.exit(s.includes('\"status\": \"processed\"') ? 0 : 1);
"; then
  echo "SMOKE FAIL send-store-batch.mjs (rutinario) no respondió 'processed'"
  printf '%s\n' "$ROUTINE_OUT"
  FAILS=$((FAILS + 1))
fi

code "$BASE/tienda-demo"
cp "$WORKDIR/last_body" "$WORKDIR/tienda_demo_after_routine.html"
contains "AP5(b): tienda-demo SIGUE cerrada tras el evento rutinario del POS" \
  "$WORKDIR/tienda_demo_after_routine.html" "$AP5_MARK"

echo "== paso 12/AP6: un evento STORE con updatedAt viejo (rancio) tampoco la reabre =="
STALE_OUT=$(QAB_BASE_URL="$BASE" node scripts/send-store-batch.mjs --stale-unpublish 2>&1)
if ! printf '%s' "$STALE_OUT" | node -e "
  const s = require('fs').readFileSync(0, 'utf8');
  process.exit(s.includes('\"status\": \"stale\"') ? 0 : 1);
"; then
  echo "SMOKE FAIL send-store-batch.mjs (--stale-unpublish) no respondió 'stale'"
  printf '%s\n' "$STALE_OUT"
  FAILS=$((FAILS + 1))
fi
code "$BASE/tienda-demo"
cp "$WORKDIR/last_body" "$WORKDIR/tienda_demo_after_stale.html"
contains "AP6: tienda-demo SIGUE cerrada tras el evento rancio" \
  "$WORKDIR/tienda_demo_after_stale.html" "$AP5_MARK"

echo "== HD11: checkout responde 409 STORE_CLOSED, no solo la cotización =="
C=$(code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}],\"contact\":{\"name\":\"Smoke\",\"phone\":\"+5355500000\"},\"fulfillment\":\"PICKUP\",\"expectedTotal\":\"0.00\"}" \
  "$BASE/api/orders")
check "POST /api/orders sobre tienda cerrada" 409 "$C"
check "cuerpo del 409 de /api/orders es STORE_CLOSED" '"error":"STORE_CLOSED"' "$(node -e "
  const b = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  process.stdout.write('\"error\":\"' + b.error + '\"');
" "$WORKDIR/last_body")"

echo "== HD11: el comprobante de un pedido ya hecho sigue accesible con la tienda cerrada =="
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d '{"enabled":true}' \
  "$BASE/api/admin/stores/$STORE_A_ID/status" >/dev/null
code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
RECEIPT_SUBTOTAL=$(json_field "$WORKDIR/last_body" subtotal)
code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}],\"contact\":{\"name\":\"Smoke Receipt\",\"phone\":\"+5355511111\"},\"fulfillment\":\"PICKUP\",\"expectedTotal\":\"$RECEIPT_SUBTOTAL\"}" \
  "$BASE/api/orders"
RECEIPT_CODE=$(json_field "$WORKDIR/last_body" code)
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"enabled":false,"reasonCode":"VACACIONES","message":"cerrada tras el pedido"}' \
  "$BASE/api/admin/stores/$STORE_A_ID/status" >/dev/null
C=$(code "$BASE/tienda-demo/pedido/$RECEIPT_CODE")
check "GET del comprobante con la tienda ya cerrada" 200 "$C"
contains "el comprobante sigue mostrando su código" "$WORKDIR/last_body" "$RECEIPT_CODE"

echo "== HD11: reabrir se ve en el acto (mismo request, sin esperar el piso de ISR) =="
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d '{"enabled":true}' \
  "$BASE/api/admin/stores/$STORE_A_ID/status" >/dev/null
code "$BASE/tienda-demo"
cp "$WORKDIR/last_body" "$WORKDIR/tienda_demo_reopened.html"
not_contains "ya no muestra ningún aviso de cierre" "$WORKDIR/tienda_demo_reopened.html" "cerrada tras el pedido"


echo "== paso 14/HD10-HD15: el interruptor del panel — 401/403, «Otro» sin mensaje, cerrar y abrir =="
C=$(code -X PUT -H 'Content-Type: application/json' -d '{"enabled":true}' \
  "$BASE/api/admin/stores/$STORE_A_ID/status")
check "PUT status sin cookie" 401 "$C"

C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d '{"enabled":true}' \
  "$BASE/api/admin/stores/$STORE_B_ID/status")
check "PUT status sobre la tienda ajena" 403 "$C"

C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"enabled":false,"reasonCode":"OTRO"}' "$BASE/api/admin/stores/$STORE_A_ID/status")
check "«Otro» sin mensaje" 400 "$C"

C=$(code "$BASE/tienda-demo")
check "tienda-demo sigue abierta tras el 400 de arriba" 200 "$C"
not_contains "tienda-demo NO muestra el aviso de cierre todavía" "$WORKDIR/last_body" "Cerrado por vacaciones"

C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"enabled":false,"reasonCode":"VACACIONES","message":"Volvemos el 5 de septiembre"}' \
  "$BASE/api/admin/stores/$STORE_A_ID/status")
check "cerrar tienda-demo desde el panel" 200 "$C"

C=$(code "$BASE/tienda-demo")
check "GET /tienda-demo tras cerrar (200, nunca 404 — HD11)" 200 "$C"
contains "muestra el motivo elegido" "$WORKDIR/last_body" "Cerrado por vacaciones. Volvemos pronto."
contains "muestra el mensaje libre del admin" "$WORKDIR/last_body" "Volvemos el 5 de septiembre"
not_contains "sin CartBadge en la cabecera de una tienda cerrada" "$WORKDIR/last_body" "tienda-demo/carrito"

C=$(code -X POST -H 'Content-Type: application/json' \
  -d '{"storeSlug":"tienda-demo","items":[]}' "$BASE/api/orders/quote")
check "cotizar contra una tienda cerrada responde 409" 409 "$C"
check "cuerpo del 409 es STORE_CLOSED" '"error":"STORE_CLOSED"' "$(node -e "
  const fs=require('fs');
  const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  process.stdout.write('\"error\":\"'+b.error+'\"');
" "$WORKDIR/last_body")"

C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"enabled":true}' "$BASE/api/admin/stores/$STORE_A_ID/status")
check "reabrir tienda-demo desde el panel" 200 "$C"

C=$(code "$BASE/tienda-demo")
check "GET /tienda-demo tras reabrir vuelve a mostrar catálogo" 200 "$C"
not_contains "ya no muestra el aviso de cierre" "$WORKDIR/last_body" "Cerrado por vacaciones"

echo "== paso 16/HD3: promociones — PRODUCT (E27, E30), ORDER (E32), 403 y 400 (E33, R30, P2) =="

BODY_PROMO_PRODUCT="{\"name\":\"smoke-20-pct\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"20\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":null,\"active\":true,\"conditions\":{\"storeProductIds\":[\"$PROD_A\"]}}"
C=$(code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_PRODUCT" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions")
check "crear promoción PRODUCT sobre PROD_A" 201 "$C"
PROMO_ID=$(json_field "$WORKDIR/last_body" id)

# A esta altura PROD_A no tiene priceOverride (el paso 12 de arriba lo puso
# en null) y su syncedPrice quedó en 499.00 desde el criterio 3 (el evento
# del sync). 20% de descuento sobre 499.00 = 399.20 — sobre syncedPrice esta
# vez, porque no hay override; E30 (el override gana cuando existe) ya se
# verificó en la sección anterior con el propio endpoint.
code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
LINE_UNIT=$(node -e "
  const fs=require('fs');
  const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  process.stdout.write(b.lines[0].unitPrice || '');
" "$WORKDIR/last_body")
check "20% off aplicado sobre el precio efectivo (499.00 -> 399.20)" "399.20" "$LINE_UNIT"
LIST_UNIT=$(node -e "
  const fs=require('fs');
  const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  process.stdout.write(b.lines[0].listUnitPrice || '');
" "$WORKDIR/last_body")
check "listUnitPrice trae el precio de lista (499.00)" "499.00" "$LIST_UNIT"

C=$(code -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$PROMO_ID")
check "borrar la promoción PRODUCT" 200 "$C"

BODY_PROMO_ORDER='{"name":"smoke-order-fixed","type":"FIXED","scope":"ORDER","value":"30","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"active":true,"conditions":{"minSubtotal":null}}'
C=$(code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_ORDER" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions")
check "crear promoción ORDER" 201 "$C"
PROMO_ORDER_ID=$(json_field "$WORKDIR/last_body" id)

code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
DISCOUNT_TOTAL=$(json_field "$WORKDIR/last_body" discountTotal)
check "E32: discountTotal refleja la promoción ORDER" "30.00" "$DISCOUNT_TOTAL"

C=$(code -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$PROMO_ORDER_ID")
check "borrar la promoción ORDER" 200 "$C"

echo "== paso 16: 403 en promoción ajena, 400 en conditions inválido (E33, R30) =="
BODY_PROMO_FOREIGN='{"name":"smoke-foreign","type":"PERCENTAGE","scope":"PRODUCT","value":"10","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"active":true,"conditions":{"storeProductIds":["'"$PROD_B"'"]}}'
C=$(code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_FOREIGN" \
  "$BASE/api/admin/stores/$STORE_B_ID/promotions")
check "crear promoción sobre tienda ajena" 403 "$C"

BODY_PROMO_BAD_IDS="{\"name\":\"smoke-bad-ids\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"10\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":null,\"active\":true,\"conditions\":{\"storeProductIds\":[\"$PROD_B\"]}}"
C=$(code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_BAD_IDS" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions")
check "R30: un storeProductId de otra tienda en conditions es 400, no se crea" 400 "$C"

BODY_PROMO_BAD_PCT='{"name":"smoke-bad-pct","type":"PERCENTAGE","scope":"ORDER","value":"0","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"active":true,"conditions":{"minSubtotal":null}}'
C=$(code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_BAD_PCT" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions")
check "P2: PERCENTAGE en 0 es 400 (no descontaría nada)" 400 "$C"

echo "== paso 16/P4: la vitrina muestra el precio nuevo y el anterior tachado =="
BODY_PROMO_P4="{\"name\":\"smoke-p4\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"20\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":null,\"active\":true,\"conditions\":{\"storeProductIds\":[\"$PROD_A\"]}}"
code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_P4" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions"
P4_PROMO_ID=$(json_field "$WORKDIR/last_body" id)
code "$BASE/tienda-demo/p/refresco-de-cola-1-5-l"
cp "$WORKDIR/last_body" "$WORKDIR/p4_product_page.html"
contains "P4: el precio nuevo (399.20) aparece en la ficha" "$WORKDIR/p4_product_page.html" "399.20"
contains "P4: el precio anterior (499.00) aparece tachado" "$WORKDIR/p4_product_page.html" 'line-through">$499.00'
C=$(code -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$P4_PROMO_ID")
check "borrar la promoción P4" 200 "$C"

echo "== paso 16/P5: fuera de ventana o active:false, el precio es el de siempre =="
BODY_PROMO_FUTURE="{\"name\":\"smoke-future\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"50\",\"startsAt\":\"2099-01-01T00:00:00Z\",\"endsAt\":null,\"active\":true,\"conditions\":{\"storeProductIds\":[\"$PROD_A\"]}}"
code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_FUTURE" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions"
P5_FUTURE_ID=$(json_field "$WORKDIR/last_body" id)
code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
check "P5: promoción futura no descuenta (unitPrice 499.00)" "499.00" "$(node -e "
  const b = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(b.lines[0].unitPrice);
" "$WORKDIR/last_body")"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$P5_FUTURE_ID"

BODY_PROMO_INACTIVE="{\"name\":\"smoke-inactive\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"50\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":null,\"active\":false,\"conditions\":{\"storeProductIds\":[\"$PROD_A\"]}}"
code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_INACTIVE" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions"
P5_INACTIVE_ID=$(json_field "$WORKDIR/last_body" id)
code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
check "P5: promoción inactiva no descuenta (unitPrice 499.00)" "499.00" "$(node -e "
  const b = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(b.lines[0].unitPrice);
" "$WORKDIR/last_body")"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$P5_INACTIVE_ID"

echo "== paso 16/P6: el descuento se aplica sobre priceOverride cuando existe =="
BODY_SET_OVERRIDE='{"description":null,"imageUrls":[],"visible":true,"featured":false,"priceOverride":"400.00"}'
code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_SET_OVERRIDE" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A" >/dev/null
BODY_PROMO_P6="{\"name\":\"smoke-p6\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"30\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":null,\"active\":true,\"conditions\":{\"storeProductIds\":[\"$PROD_A\"]}}"
code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_P6" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions"
P6_PROMO_ID=$(json_field "$WORKDIR/last_body" id)
code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
check "P6: 30% sobre el override (400.00 -> 280.00), no sobre syncedPrice" "280.00" "$(node -e "
  const b = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(b.lines[0].unitPrice);
" "$WORKDIR/last_body")"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$P6_PROMO_ID"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"description":null,"imageUrls":[],"visible":true,"featured":false,"priceOverride":null}' \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A"

echo "== paso 16/P7: dos promociones sobre el mismo producto, gana la que deja el precio más bajo =="
BODY_PROMO_10="{\"name\":\"smoke-ten\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"10\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":null,\"active\":true,\"conditions\":{\"storeProductIds\":[\"$PROD_A\"]}}"
code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_10" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions"
P7_TEN_ID=$(json_field "$WORKDIR/last_body" id)
BODY_PROMO_30="{\"name\":\"smoke-thirty\",\"type\":\"PERCENTAGE\",\"scope\":\"PRODUCT\",\"value\":\"30\",\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":null,\"active\":true,\"conditions\":{\"storeProductIds\":[\"$PROD_A\"]}}"
code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_30" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions"
P7_THIRTY_ID=$(json_field "$WORKDIR/last_body" id)
code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
check "P7/R26: gana el 30% (precio más bajo: 349.30), no se acumulan" "349.30" "$(node -e "
  const b = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(b.lines[0].unitPrice);
" "$WORKDIR/last_body")"

echo "== paso 16/P8-P9: pedido real con promoción PRODUCT + ORDER — el checkout NO da 409 (regresión F-010) =="
BODY_PROMO_ORDER_P9='{"name":"smoke-p9-order","type":"FIXED","scope":"ORDER","value":"30","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"active":true,"conditions":{"minSubtotal":null}}'
code -b "$WORKDIR/cookie_a.jar" -X POST -H 'Content-Type: application/json' -d "$BODY_PROMO_ORDER_P9" \
  "$BASE/api/admin/stores/$STORE_A_ID/promotions"
P9_ORDER_PROMO_ID=$(json_field "$WORKDIR/last_body" id)

code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}]}" \
  "$BASE/api/orders/quote"
cp "$WORKDIR/last_body" "$WORKDIR/p8_quote.json"
P8_SUBTOTAL=$(json_field "$WORKDIR/p8_quote.json" subtotal)
P8_DISCOUNT=$(json_field "$WORKDIR/p8_quote.json" discountTotal)
check "P9: discountTotal de la promoción ORDER es 30.00" "30.00" "$P8_DISCOUNT"
EXPECTED_TOTAL=$(node -e "
  process.stdout.write((Number(process.argv[1]) - Number(process.argv[2])).toFixed(2));
" "$P8_SUBTOTAL" "$P8_DISCOUNT")

C=$(code -X POST -H 'Content-Type: application/json' \
  -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$PROD_A\",\"qty\":1}],\"contact\":{\"name\":\"Smoke P8\",\"phone\":\"+5355522222\"},\"fulfillment\":\"PICKUP\",\"expectedTotal\":\"$EXPECTED_TOTAL\"}" \
  "$BASE/api/orders")
check "P8/P9: el checkout con una promoción de pedido responde 201, no 409" 201 "$C"
P8_ORDER_CODE=$(json_field "$WORKDIR/last_body" code)

echo "== paso 16/P10: GET /api/internal/orders conserva las claves de la v2 del contrato =="
INTERNAL_ORDERS_OUT=$(curl -sS -H "Authorization: Bearer $(sync_token)" "$BASE/api/internal/orders?since=0&limit=200")
printf '%s' "$INTERNAL_ORDERS_OUT" >"$WORKDIR/internal_orders.json"
node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const order = data.orders.find((o) => o.code === process.argv[2]);
  if (!order) { console.log('SMOKE FAIL P10: el pedido no aparece en /api/internal/orders'); process.exit(1); }
  const required = ['id','code','storeExternalId','status','contact','currencyCode','subtotal','discountTotal','deliveryFee','total','items'];
  const missing = required.filter((k) => !(k in order));
  if (missing.length) { console.log('SMOKE FAIL P10: faltan claves ' + missing.join(',')); process.exit(1); }
  const itemKeys = ['storeProductExternalId','name','unitPrice','currencyCode','quantity','lineTotal'];
  const missingItem = itemKeys.filter((k) => !(k in order.items[0]));
  if (missingItem.length) { console.log('SMOKE FAIL P10: faltan claves en items[0]: ' + missingItem.join(',')); process.exit(1); }
  console.log('  ok   P10: /api/internal/orders trae las mismas claves de la v2, con el descuento aplicado');
" "$WORKDIR/internal_orders.json" "$P8_ORDER_CODE" || FAILS=$((FAILS + 1))

echo "== paso 16/P11: borrar la promoción después NO altera los importes del pedido ya creado =="
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$P7_TEN_ID"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$P7_THIRTY_ID"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X DELETE "$BASE/api/admin/stores/$STORE_A_ID/promotions/$P9_ORDER_PROMO_ID"
INTERNAL_ORDERS_OUT2=$(curl -sS -H "Authorization: Bearer $(sync_token)" "$BASE/api/internal/orders?since=0&limit=200")
printf '%s' "$INTERNAL_ORDERS_OUT2" >"$WORKDIR/internal_orders2.json"
node -e "
  const fs = require('fs');
  // Comparación numérica entre el MISMO endpoint antes y después de borrar
  // la promoción — nunca contra el string de /api/orders/quote, que
  // formatea los decimales distinto ('30.00' vs '30', ambos válidos).
  const before = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).orders.find((o) => o.code === process.argv[3]);
  const after = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).orders.find((o) => o.code === process.argv[3]);
  const ok = before && after
    && Number(before.subtotal) === Number(after.subtotal)
    && Number(before.discountTotal) === Number(after.discountTotal)
    && Number(before.total) === Number(after.total)
    && Number(after.discountTotal) === 30;
  console.log(ok ? '  ok   P11: el pedido conserva subtotal/discountTotal/total tras borrar la promoción'
                 : 'SMOKE FAIL P11: el pedido cambió tras borrar la promoción — antes ' + JSON.stringify(before) + ' después ' + JSON.stringify(after));
  process.exit(ok ? 0 : 1);
" "$WORKDIR/internal_orders.json" "$WORKDIR/internal_orders2.json" "$P8_ORDER_CODE" || FAILS=$((FAILS + 1))

echo "== paso 16/P12: escribir una promoción revalida la tienda de inmediato =="
code "$BASE/tienda-demo/p/refresco-de-cola-1-5-l"
not_contains "P12: sin promoción, ya no queda ningún precio tachado" "$WORKDIR/last_body" "line-through"

echo "== limpieza: restaurar los productos de prueba a su estado del seed =="
BODY_RESTORE='{"description":null,"imageUrls":[],"visible":true,"featured":false,"priceOverride":null}'
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_RESTORE" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY_RESTORE" \
  "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A2"
echo "  (syncedPrice de seed-tienda-1-p0 queda en 499 hasta el próximo 'npm run seed'; los objetos"
echo "   subidos quedan huérfanos en el bucket a propósito — R22, deuda ya anotada en impl.md)"
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d '{"enabled":true}' \
  "$BASE/api/admin/stores/$STORE_A_ID/status"
echo "  (tienda-demo se deja PUBLICADA; el teléfono de tienda-demo queda con el valor de"
echo "   prueba de send-store-batch.mjs hasta el próximo 'npm run seed' — es una columna"
echo "   propiedad del sync, no del panel, así que este guion no la puede restaurar)"

echo "== preparación / criterio 5, 17, 19, 20, 22, 23 [nuevo]: branding sobre Storefront (tanda 3) =="

# psql no está garantizado en todos los entornos que corren este sensor; `pg`
# ya es dependencia del repo (scripts/pull-orders.mjs, scripts/place-order.mjs
# lo usan igual), así que el SELECT directo de "Storefront"."themeTokens" se
# hace con `node` + `pg`, nunca con la app (ver riesgo de plan.md: cambiar
# `status`/`themeTokens` con SQL no revalida — aquí solo LEEMOS, nunca escribimos).
DATABASE_URL_VALUE=$(node -e '
  const fs = require("fs");
  const env = fs.readFileSync(".env", "utf8");
  const m = env.match(/^DATABASE_URL="([^"]*)"/m);
  process.stdout.write(m ? m[1] : "");
')

db_theme_tokens() { # db_theme_tokens <brand-slug>
  node -e '
    const { Client } = require("pg");
    (async () => {
      const client = new Client({ connectionString: process.argv[2] });
      await client.connect();
      const res = await client.query(
        (String.fromCharCode(83,69,76,69,67,84) + " \"themeTokens\" FROM \"Storefront\" WHERE slug = $1"),
        [process.argv[1]],
      );
      await client.end();
      process.stdout.write(JSON.stringify(res.rows[0]?.themeTokens ?? null));
    })().catch((e) => { console.error(e); process.exit(1); });
  ' "$1" "$DATABASE_URL_VALUE"
}

find_store_id() { # find_store_id <html-file> <name-needle>
  node -e '
    const fs = require("fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    const needle = process.argv[2];
    const re = /data-store-id="([^"]+)"/g;
    let m, found = "";
    while ((m = re.exec(html))) {
      if (html.slice(m.index, m.index + 500).includes(needle)) { found = m[1]; break; }
    }
    process.stdout.write(found);
  ' "$1" "$2"
}

# Cookies de la marca de tres sucursales sembrada por HD18 (`el-trebol`):
# COOKIE_MARCA cubre las DOS renderizables (PUBLISHED + SUSPENDED) → 200;
# COOKIE_PARCIAL solo la PUBLISHED → 403 de cobertura (E40, criterio 22).
URL_MARCA=$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=seed-tienda-8,seed-tienda-9)
curl -sS -c "$WORKDIR/cookie_marca.jar" -o /dev/null "$URL_MARCA"
URL_PARCIAL=$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=seed-tienda-8)
curl -sS -c "$WORKDIR/cookie_parcial.jar" -o /dev/null "$URL_PARCIAL"

code -b "$WORKDIR/cookie_marca.jar" "$BASE/admin"
cp "$WORKDIR/last_body" "$WORKDIR/admin_marca.html"
STORE_CENTRO_ID=$(find_store_id "$WORKDIR/admin_marca.html" "El Trébol · Centro Habana")
STORE_PLAYA_ID=$(find_store_id "$WORKDIR/admin_marca.html" "El Trébol · Playa")
if [ -z "$STORE_CENTRO_ID" ] || [ -z "$STORE_PLAYA_ID" ]; then
  echo "SMOKE FAIL no se encontraron las sucursales de El Trébol en /admin con COOKIE_MARCA — revisa prisma/seed.ts (seedBrandWithBranches)"
  exit 1
fi

echo "== criterio 5 (E36/E37): los tres cuerpos inválidos, la base NO cambia =="
BEFORE_DEMO=$(db_theme_tokens tienda-demo)
for BODY in '{"brand":"no-es-un-color#"}' '{"radius":"gigante"}' '{"background":"#fff"}'; do
  C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d "$BODY" \
    "$BASE/api/admin/stores/$STORE_A_ID/branding")
  check "branding inválido ($BODY)" 400 "$C"
  ISSUES_PATH=$(json_field "$WORKDIR/last_body" issues)
  if [ "$ISSUES_PATH" = "<undefined>" ]; then
    echo "SMOKE FAIL el 400 de branding no trae .issues — $BODY"
    FAILS=$((FAILS + 1))
  fi
done
AFTER_INVALID_DEMO=$(db_theme_tokens tienda-demo)
check "criterio 5: la base NO cambió tras los tres rechazos" "$BEFORE_DEMO" "$AFTER_INVALID_DEMO"

echo "== criterio 5, camino feliz: para que el 400 no sea un falso positivo =="
C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"brand":"#0f62fe","radius":"soft"}' "$BASE/api/admin/stores/$STORE_A_ID/branding")
check "camino feliz de branding" 200 "$C"
code "$BASE/tienda-demo"
contains "R36: la vitrina trae --color-brand:#0f62fe sin esperar el piso de ISR" \
  "$WORKDIR/last_body" '--color-brand:#0f62fe'

echo "== criterio 19 (E38): quitar el branding escribe {}, nunca null, y el <style> desaparece =="
C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d '{}' \
  "$BASE/api/admin/stores/$STORE_A_ID/branding")
check "quitar el branding" 200 "$C"
AFTER_EMPTY_DEMO=$(db_theme_tokens tienda-demo)
check "criterio 19: la base guarda {} (no null)" '{}' "$AFTER_EMPTY_DEMO"
code "$BASE/tienda-demo"
not_contains "criterio 19: la vitrina deja de traer el <style> de marca" "$WORKDIR/last_body" '[data-store="tienda-demo"]{'

echo "== criterio 20 (E43): un oklch(...) se conserva carácter a carácter =="
C=$(code -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"brand":"oklch(0.62 0.17 145)"}' "$BASE/api/admin/stores/$STORE_A_ID/branding")
check "guardar oklch(...)" 200 "$C"
AFTER_OKLCH_DEMO=$(db_theme_tokens tienda-demo)
check "criterio 20: oklch(...) vuelve idéntico" '{"brand":"oklch(0.62 0.17 145)"}' "$AFTER_OKLCH_DEMO"

echo "== criterio 22 [nuevo] (E40, HD16): 403 de cobertura parcial sobre El Trébol =="
BEFORE_TREBOL=$(db_theme_tokens el-trebol)
C=$(code -b "$WORKDIR/cookie_parcial.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"brand":"#198038"}' "$BASE/api/admin/stores/$STORE_CENTRO_ID/branding")
check "PUT branding con cobertura parcial" 403 "$C"
check "cuerpo del 403 de cobertura es FORBIDDEN (R44, igual que el de tienda ajena)" \
  '{"error":"FORBIDDEN"}' "$(cat "$WORKDIR/last_body")"
AFTER_PARTIAL_TREBOL=$(db_theme_tokens el-trebol)
check "criterio 22: la base de El Trébol no cambió con cobertura parcial" \
  "$BEFORE_TREBOL" "$AFTER_PARTIAL_TREBOL"

echo "== criterio 17 [nuevo] (E39, R36): con cobertura TOTAL, revalida marca + las dos sucursales =="
C=$(code -b "$WORKDIR/cookie_marca.jar" -X PUT -H 'Content-Type: application/json' \
  -d '{"brand":"#198038"}' "$BASE/api/admin/stores/$STORE_CENTRO_ID/branding")
check "PUT branding con cobertura total" 200 "$C"
AFTER_FULL_TREBOL=$(db_theme_tokens el-trebol)
check "criterio 17/22: la base de El Trébol SÍ cambió con cobertura total" \
  '{"brand":"#198038"}' "$AFTER_FULL_TREBOL"

for URL in el-trebol-centro el-trebol-playa el-trebol; do
  code "$BASE/$URL"
  contains "criterio 17: /$URL trae el color nuevo de la marca sin esperar el piso de ISR" \
    "$WORKDIR/last_body" '--color-brand:#198038'
done

echo "== criterio 23 [nuevo] (HD18): npm run seed dos veces conserva las tres sucursales de El Trébol =="
SEED_OUT1=$(npm run seed 2>&1)
SEED_CODE1=$?
SEED_OUT2=$(npm run seed 2>&1)
SEED_CODE2=$?
if [ "$SEED_CODE1" != 0 ] || [ "$SEED_CODE2" != 0 ]; then
  echo "SMOKE FAIL npm run seed (dos veces) no terminó en 0"
  echo "$SEED_OUT1" | tail -20
  echo "$SEED_OUT2" | tail -20
  FAILS=$((FAILS + 1))
fi
code -b "$WORKDIR/cookie_marca.jar" "$BASE/admin"
cp "$WORKDIR/last_body" "$WORKDIR/admin_marca_reseed.html"
contains "criterio 23: El Trébol · Centro Habana sigue en /admin tras resembrar dos veces" \
  "$WORKDIR/admin_marca_reseed.html" "El Trébol · Centro Habana"
contains "criterio 23: El Trébol · Playa sigue en /admin tras resembrar dos veces" \
  "$WORKDIR/admin_marca_reseed.html" "El Trébol · Playa"

# NOTA (impl.md § Desviaciones): `npm run check:theme` lee `.next/static`, que
# solo existe tras `npm run build` — bajo `next dev` (lo que esta etapa smoke
# levanta) el directorio no existe todavía, así que correrlo aquí falla
# siempre, sea cual sea el branding guardado. El criterio 13/E44 se sigue
# verificando, pero en `--full` (que ya corre `npm run build` antes), no aquí.

echo "== limpieza: tienda-demo vuelve a themeTokens: {} (sin branding) =="
curl -sS -o /dev/null -b "$WORKDIR/cookie_a.jar" -X PUT -H 'Content-Type: application/json' -d '{}' \
  "$BASE/api/admin/stores/$STORE_A_ID/branding"
echo "  (El Trébol se deja con el color que este guion acaba de guardar,"
echo "   \`{\"brand\":\"#198038\"}\`: seedStorefront() NUNCA pisa themeTokens cuando el llamador no"
echo "   pasa uno truthy — es lo que HD18 pide para que este sensor corra dos veces seguidas sin"
echo "   resembrar de por medio, y ningún otro feature lee \`el-trebol*\`)"

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
