#!/usr/bin/env bash
# Verificación en runtime de F-023 (imágenes derivadas al subir, servidas del
# CDN). La ejecuta `bash .agent/verify.sh F-023 --smoke` con `next dev` ya
# levantado en $SMOKE_BASE_URL, contra la base y el emulador de Storage
# reales de docker-compose.yml (deben estar arriba: `docker compose up -d`).
#
# Cubre los criterios que architecture.md/spec.md marcan como "necesitan el
# emulador de Storage levantado y la base sembrada": 1, 3, 4, 5 y 6. Los
# criterios 2, 7 y 8 se verifican en `tests.md` (curl estático, check:bundle,
# verify --full), no aquí.
#
# Corre `npm run seed` al principio, a propósito: el criterio 3 depende de
# que `prisma/fixtures/producto-demo.jpg` esté subido a los 15 productos de
# `tienda-demo` (`prisma/seed.ts::seedProductImages`), y sembrar es
# idempotente (architecture.md § Sembrar una imagen de verdad).
#
# Regla: cada aserción que no se cumpla imprime `SMOKE FAIL <qué>` y suma un
# fallo.
set -uo pipefail

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

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

check_not() { # check_not <qué se espera> <no-esperado> <obtenido>
  if [ "$2" != "$3" ]; then
    printf '  ok   %s\n' "$1"
  else
    printf 'SMOKE FAIL %s — obtuve %s, que es justo lo que no debía pasar\n' "$1" "$3"
    FAILS=$((FAILS + 1))
  fi
}

contains() { # contains <qué se espera> <archivo> <aguja>
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

# Lee las credenciales de Storage directamente de .env — nunca de la app, que
# no expone un endpoint de listado. Mismo patrón que el DATABASE_URL directo
# de `.agent/specs/F-011/smoke.sh` para leer `themeTokens`.
supabase_env() { # supabase_env <NOMBRE_VAR>
  node -e '
    const fs = require("fs");
    const env = fs.readFileSync(".env", "utf8");
    const re = new RegExp("^" + process.argv[1] + "=\"([^\"]*)\"", "m");
    const m = env.match(re);
    process.stdout.write(m ? m[1] : "");
  ' "$1"
}
SUPABASE_URL=$(supabase_env NEXT_PUBLIC_SUPABASE_URL)
SERVICE_ROLE_KEY=$(supabase_env SUPABASE_SERVICE_ROLE_KEY)
BUCKET=$(supabase_env SUPABASE_STORAGE_BUCKET)
BUCKET="${BUCKET:-store-media}"

list_bucket() { # list_bucket <prefix> — imprime el JSON crudo de .list()
  curl -sS -X POST "$SUPABASE_URL/storage/v1/object/list/$BUCKET" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"prefix\":\"$1\"}"
}

json_length() { # json_length <json-string>
  node -e "
    let arr;
    try { arr = JSON.parse(process.argv[1]); } catch { arr = []; }
    process.stdout.write(String(Array.isArray(arr) ? arr.length : 0));
  " "$1"
}

first_entry_name() { # first_entry_name <json-string>
  node -e "
    let arr;
    try { arr = JSON.parse(process.argv[1]); } catch { arr = []; }
    process.stdout.write(arr[0]?.name ?? '');
  " "$1"
}

echo "== preparación: sembrar (idempotente) — el criterio 3 depende de las imágenes de tienda-demo =="
SEED_OUT=$(npm run seed 2>&1)
SEED_CODE=$?
if [ "$SEED_CODE" != 0 ]; then
  echo "SMOKE FAIL npm run seed no terminó en 0"
  echo "$SEED_OUT" | tail -30
  exit 1
fi

echo "== preparación: cookies de sesión =="
URL_BOTH=$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=seed-tienda-1,seed-tienda-2)
curl -sS -c "$WORKDIR/cookie.jar" -o /dev/null "$URL_BOTH"
if [ ! -s "$WORKDIR/cookie.jar" ] || ! grep -q qab-admin-session "$WORKDIR/cookie.jar" 2>/dev/null; then
  echo "SMOKE FAIL no se obtuvo la cookie qab-admin-session — revisa SSO_JWT_SECRET/ADMIN_SESSION_SECRET en .env"
  exit 1
fi

code -b "$WORKDIR/cookie.jar" "$BASE/admin"
cp "$WORKDIR/last_body" "$WORKDIR/admin.html"
# Dos tiendas visibles con esta cookie (seed-tienda-1 y seed-tienda-2) — se
# localiza cada id por proximidad de texto a su propio nombre, no por orden
# del listado.
STORE_A_ID=$(node -e "
  const fs = require('fs');
  const html = fs.readFileSync(process.argv[1], 'utf8');
  const re = /data-store-id=\"([^\"]+)\"/g;
  let m, found = '';
  while ((m = re.exec(html))) {
    if (html.slice(m.index, m.index + 400).includes('La Rampa · Vedado')) { found = m[1]; break; }
  }
  process.stdout.write(found);
" "$WORKDIR/admin.html")
STORE_C_ID=$(node -e "
  const fs = require('fs');
  const html = fs.readFileSync(process.argv[1], 'utf8');
  const re = /data-store-id=\"([^\"]+)\"/g;
  let m, found = '';
  while ((m = re.exec(html))) {
    if (html.slice(m.index, m.index + 400).includes('La Rampa · Playa')) { found = m[1]; break; }
  }
  process.stdout.write(found);
" "$WORKDIR/admin.html")
if [ -z "$STORE_A_ID" ] || [ -z "$STORE_C_ID" ]; then
  echo "SMOKE FAIL no se encontraron tienda-demo y tienda-dos en /admin — revisa prisma/seed.ts"
  exit 1
fi

code -b "$WORKDIR/cookie.jar" "$BASE/admin/tiendas/$STORE_A_ID/productos"
cp "$WORKDIR/last_body" "$WORKDIR/products_a.html"
PROD_A=$(extract_first "$WORKDIR/products_a.html" "productos/([^\"]+)\">Refresco de cola 1\\.5 L")
if [ -z "$PROD_A" ]; then
  echo "SMOKE FAIL no se encontró 'Refresco de cola 1.5 L' en tienda-demo — revisa prisma/seed.ts"
  exit 1
fi

code -b "$WORKDIR/cookie.jar" "$BASE/admin/tiendas/$STORE_C_ID/productos"
cp "$WORKDIR/last_body" "$WORKDIR/products_c.html"
PROD_C=$(extract_first "$WORKDIR/products_c.html" "productos/([^\"]+)\">Coca-Cola 1\\.5L")
if [ -z "$PROD_C" ]; then
  echo "SMOKE FAIL no se encontró 'Coca-Cola 1.5L' en tienda-dos — revisa prisma/seed.ts"
  exit 1
fi

echo "== criterio 1: subir una imagen deja el original MÁS sus 4 variantes en el bucket =="
# PROD_C (tienda-dos) nunca lo toca la siembra de imágenes (solo tienda-demo,
# I5) — parte en cero, así que el prefijo del producto tiene que terminar
# con EXACTAMENTE un directorio de imagen tras esta subida.
UPLOAD1_CODE=$(curl -sS -o "$WORKDIR/upload1.json" -w '%{http_code}' \
  -b "$WORKDIR/cookie.jar" \
  -F "file=@.agent/specs/F-011/fixtures/sample.jpg;type=image/jpeg" \
  "$BASE/api/admin/stores/$STORE_C_ID/products/$PROD_C/images")
check "subida a un producto sin imágenes previas" 201 "$UPLOAD1_CODE"
PROD_C_URL=$(json_field "$WORKDIR/upload1.json" url)
PROD_C_IMAGE_URLS=$(node -e "
  const b = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(JSON.stringify(b.imageUrls));
" "$WORKDIR/upload1.json")
check "imageUrls trae exactamente [url]" "[\"$PROD_C_URL\"]" "$PROD_C_IMAGE_URLS"

TOP_LIST=$(list_bucket "stores/$STORE_C_ID/products/$PROD_C/")
check "un solo directorio de imagen bajo el producto" 1 "$(json_length "$TOP_LIST")"
IMAGE_UUID_DIR=$(first_entry_name "$TOP_LIST")
INNER_LIST=$(list_bucket "stores/$STORE_C_ID/products/$PROD_C/$IMAGE_UUID_DIR/")
check "el directorio de la imagen tiene 5 objetos (original + 2 anchos × 2 formatos)" 5 "$(json_length "$INNER_LIST")"

echo "== criterio 4: con Accept: image/avif responde AVIF, sin él el respaldo WebP =="
code "$BASE/tienda-demo"
cp "$WORKDIR/last_body" "$WORKDIR/tienda_demo.html"
AVIF_URL=$(extract_first "$WORKDIR/tienda_demo.html" '<source type="image/avif" srcSet="([^"]+)"')
# design.md D3: en la tarjeta el <img> de respaldo apunta al MISMO objeto que
# el <source type="image/webp"> (un solo candidato, sin descriptor) — así que
# la propia URL del source webp ES la URL de respaldo, sin tener que cruzar
# hasta el <img> vecino.
FALLBACK_URL=$(extract_first "$WORKDIR/tienda_demo.html" '<source type="image/webp" srcSet="([^"]+)"')
if [ -z "$AVIF_URL" ] || [ -z "$FALLBACK_URL" ]; then
  echo "SMOKE FAIL no se encontró un <picture> de tarjeta en /tienda-demo — revisa que la siembra de imágenes corrió"
  FAILS=$((FAILS + 1))
else
  AVIF_CTYPE=$(curl -sS -I -H 'Accept: image/avif,image/webp,*/*' "$AVIF_URL" | tr -d '\r' | grep -i '^content-type' | cut -d' ' -f2)
  check "curl con Accept: image/avif responde image/avif" "image/avif" "$AVIF_CTYPE"
  WEBP_CTYPE=$(curl -sS -I -H 'Accept: image/webp,*/*' "$FALLBACK_URL" | tr -d '\r' | grep -i '^content-type' | cut -d' ' -f2)
  check "curl con Accept: image/webp (sin avif) responde image/webp" "image/webp" "$WEBP_CTYPE"
fi

echo "== criterio 3: el peso total de imágenes de la página de catálogo está bajo presupuesto =="
node scripts/check-image-budget.mjs --base="$BASE" --slug=tienda-demo
IMAGE_BUDGET_CODE=$?
check "check-image-budget.mjs termina en 0" 0 "$IMAGE_BUDGET_CODE"

echo "== criterio 5: reemplazar la imagen de un producto — la vieja y sus 4 variantes dejan de existir =="
code -b "$WORKDIR/cookie.jar" "$BASE/admin/tiendas/$STORE_A_ID/productos/$PROD_A"
cp "$WORKDIR/last_body" "$WORKDIR/edit_before.html"
OLD_AVIF_URL=$(extract_first "$WORKDIR/edit_before.html" '<source type="image/avif" srcSet="([^"]+)"')
if [ -z "$OLD_AVIF_URL" ]; then
  echo "SMOKE FAIL no se encontró la imagen sembrada de 'Refresco de cola 1.5 L' — revisa npm run seed"
  FAILS=$((FAILS + 1))
else
  OLD_DIR=$(node -e "process.stdout.write(process.argv[1].replace(/[^/]+$/, ''))" "$OLD_AVIF_URL")
  OLD_URL="${OLD_DIR}original.jpg"

  UPLOAD2_CODE=$(curl -sS -o "$WORKDIR/upload2.json" -w '%{http_code}' \
    -b "$WORKDIR/cookie.jar" \
    -F "file=@.agent/specs/F-011/fixtures/sample.jpg;type=image/jpeg" \
    "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A/images")
  check "subida de la imagen de reemplazo" 201 "$UPLOAD2_CODE"
  NEW_URL=$(json_field "$WORKDIR/upload2.json" url)

  # R3: el original NUNCA se sirve en una página de catálogo — solo sus
  # variantes derivadas. La comparación se hace sobre el DIRECTORIO de la
  # imagen (el "original.jpg" nunca aparecerá tal cual en /tienda-demo).
  NEW_DIR=$(node -e "process.stdout.write(process.argv[1].replace(/[^/]+$/, ''))" "$NEW_URL")

  REPLACE_BODY="{\"description\":null,\"imageUrls\":[\"$NEW_URL\"],\"visible\":true,\"featured\":true,\"priceOverride\":null}"
  PUT_CODE=$(code -b "$WORKDIR/cookie.jar" -X PUT -H 'Content-Type: application/json' -d "$REPLACE_BODY" \
    "$BASE/api/admin/stores/$STORE_A_ID/products/$PROD_A")
  check "PUT del editor que quita la vieja y deja solo la nueva" 200 "$PUT_CODE"

  code "$BASE/tienda-demo"
  cp "$WORKDIR/last_body" "$WORKDIR/tienda_demo_after_replace.html"
  contains "el directorio de la imagen nueva aparece en /tienda-demo" \
    "$WORKDIR/tienda_demo_after_replace.html" "${NEW_DIR}w400.avif"
  not_contains "el directorio de la imagen vieja YA NO aparece en /tienda-demo" \
    "$WORKDIR/tienda_demo_after_replace.html" "${OLD_DIR}w400.avif"

  for SUFFIX in original.jpg w400.avif w400.webp w800.avif w800.webp; do
    OLD_OBJECT_URL="${OLD_DIR}${SUFFIX}"
    OLD_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$OLD_OBJECT_URL")
    check_not "objeto viejo ($SUFFIX) ya NO responde 200" 200 "$OLD_CODE"
  done
fi

echo "== criterio 6: un DELETE del sync borra los objetos y vacía imageUrls =="
DELETE_BODY=$(node -e "
  process.stdout.write(JSON.stringify({
    businessId: 'seed-negocio-1',
    events: [{
      eventId: 'evt-f023-delete-' + Date.now(),
      entity: 'PRODUCT',
      operation: 'DELETE',
      occurredAt: new Date().toISOString(),
      payload: {
        storeProductId: 'seed-tienda-2-p0',
        productId: 'seed-producto-c0',
        businessId: 'seed-negocio-1',
        storeId: 'seed-tienda-2',
        localName: 'Coca-Cola 1.5L',
        barcodes: ['7501031311309'],
        localCategoryId: 'seed-cat-bebidas',
        price: 470,
        currency: 'CUP',
        canonicalProductId: null,
        imageUrl: null,
        publishToStore: true,
        updatedAt: new Date().toISOString(),
      },
    }],
  }));
")
DELETE_CODE=$(curl -sS -o "$WORKDIR/delete.json" -w '%{http_code}' \
  -H "Authorization: Bearer $(sync_token)" -H 'Content-Type: application/json' \
  -d "$DELETE_BODY" "$BASE/api/internal/sync/catalog")
check "POST DELETE al sync" 207 "$DELETE_CODE"
DELETE_STATUS=$(node -e "
  const b = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(b.results?.[0]?.status ?? '');
" "$WORKDIR/delete.json")
check "el evento se procesó" "processed" "$DELETE_STATUS"

AFTER_DELETE_LIST=$(list_bucket "stores/$STORE_C_ID/products/$PROD_C/")
check "el prefijo del producto queda con 0 objetos tras el DELETE" 0 "$(json_length "$AFTER_DELETE_LIST")"

code -b "$WORKDIR/cookie.jar" "$BASE/admin/tiendas/$STORE_C_ID/productos/$PROD_C"
cp "$WORKDIR/last_body" "$WORKDIR/edit_after_delete.html"
contains "imageUrls quedó vacío tras el DELETE" "$WORKDIR/edit_after_delete.html" '"imageUrls":[]'

echo "== limpieza: revivir seed-tienda-2-p0 para que este guion se pueda correr dos veces seguidas =="
# `npm run seed` NO deshace un borrado suave (nunca toca deletedAt en su
# propio upsert — esa es la mitad que solo un evento real del sync puede
# hacer, exactamente como en producción: "Producto borrado y vuelto a crear
# con el mismo externalId" del caso límite de spec.md). Sin este evento de
# revivir, la SEGUNDA corrida de este guion no encontraría "Coca-Cola 1.5L"
# como enlace en el listado de tiendas-dos (un producto borrado se pinta como
# texto plano, sin <a href>, en ProductTable.tsx) y el criterio 1 fallaría
# por una razón ajena a lo que este guion prueba.
REVIVE_BODY=$(node -e "
  process.stdout.write(JSON.stringify({
    businessId: 'seed-negocio-1',
    events: [{
      eventId: 'evt-f023-revive-' + Date.now(),
      entity: 'PRODUCT',
      operation: 'UPDATE',
      occurredAt: new Date().toISOString(),
      payload: {
        storeProductId: 'seed-tienda-2-p0',
        productId: 'seed-producto-c0',
        businessId: 'seed-negocio-1',
        storeId: 'seed-tienda-2',
        localName: 'Coca-Cola 1.5L',
        barcodes: ['7501031311309'],
        localCategoryId: 'seed-cat-bebidas',
        price: 470,
        currency: 'CUP',
        canonicalProductId: null,
        imageUrl: null,
        publishToStore: true,
        updatedAt: new Date().toISOString(),
      },
    }],
  }));
")
curl -sS -o /dev/null -H "Authorization: Bearer $(sync_token)" -H 'Content-Type: application/json' \
  -d "$REVIVE_BODY" "$BASE/api/internal/sync/catalog"
echo "  (npm run seed vuelve a dejar los 15 productos de tienda-demo con su imagen"
echo "   determinista — este guion se puede correr dos veces seguidas sin resembrar a mano)"

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
