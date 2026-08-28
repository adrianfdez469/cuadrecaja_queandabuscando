#!/usr/bin/env bash
# Verificación en runtime de F-017 (Storefront por encima de Store), etapa 1.
# La ejecuta `bash .agent/verify.sh F-017 --smoke` con `next dev` ya levantado
# en $SMOKE_BASE_URL, contra la base real de docker-compose.yml (`npm run
# seed` ya corrido) y con QAB_BEARER_TOKEN (el token de seed-negocio-1, F-018)
# en el entorno.
#
# Cubre los criterios 1, 3, 4, 5 y 8 (7 y 9 se verifican con `npm run build`
# en `--full`, no aquí — el build en sí ES la verificación). Copiado con
# criterio de `.agent/specs/F-010/smoke.sh` y `.agent/specs/F-011/smoke.sh`
# (los helpers `check`/`code`/`body`, el `contains`/`json_field` por `node`
# para no depender del grep del sistema — ficha playbook-firma-grep-bsd-no-gnu)
# — no los importa, porque F-010 y F-011 son features distintos y sus propios
# guiones tienen que seguir pasando tal cual.
#
# Regla: cada aserción que no se cumpla imprime `SMOKE FAIL <qué>` y suma un
# fallo.
#
# Nunca se verifica una revalidación con `psql`: toda escritura de este guion
# pasa por el endpoint del sync o del panel, y solo entonces se lee la página
# pública — un `UPDATE` directo no dispara `revalidateTag` y daría un falso
# verde (AGENTS.md § Cosas que muerden). `psql` solo se usa para comprobar
# restricciones de la base en sí (criterios 4 y 5), nunca para cambiar algo
# que una página tenga que reflejar.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

BASE="${SMOKE_BASE_URL:-http://localhost:3100}"
FAILS=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

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
header() { curl -sI "$@"; }

json_field() { # <JSON en stdin> | json_field <campo>
  node -e '
    let body;
    try { body = JSON.parse(require("fs").readFileSync(0, "utf8")); }
    catch { process.stdout.write("<invalid-json>"); process.exit(0); }
    const v = body[process.argv[1]];
    process.stdout.write(v === null ? "<null>" : v === undefined ? "<undefined>" : String(v));
  ' "$1"
}

contains() { # contains <qué se espera> <texto> <aguja>
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

matches() { # matches <qué se espera> <valor> <regex>
  if node -e '
    const [value, pattern] = [process.argv[1], process.argv[2]];
    process.exit(new RegExp(pattern).test(value) ? 0 : 1);
  ' "$2" "$3"; then
    printf '  ok   %s (%s)\n' "$1" "$2"
  else
    printf 'SMOKE FAIL %s — %s no cumple /%s/\n' "$1" "$2" "$3"
    FAILS=$((FAILS + 1))
  fi
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

# --------------------------------------------------- criterio 1 ----

STORE_HTML="$(body "$BASE/tienda-demo")"
check 'criterio 1 — /tienda-demo responde 200' 200 "$(code "$BASE/tienda-demo")"
contains 'criterio 1 — el catálogo viene en el HTML servido' "$STORE_HTML" "Refresco de cola"
SELECTOR_MARKS=$(printf '%s' "$STORE_HTML" | grep -cE 'data-branch-picker|name="sucursal"|Elegir sucursal')
check 'criterio 1 — el HTML NO contiene el marcador del selector' 0 "$SELECTOR_MARKS"

# --------------------------------------------------- criterio 3 ----

# `bodega-central` es la marca; su sucursal conserva `bodega-central-vedado`
# como slug propio (prisma/seed.ts). Las dos URL tienen que responder 200,
# sin redirección, y sin que el criterio 4 de F-004 se rompa (el catálogo
# sigue en el HTML por cualquiera de las dos).
check 'criterio 3 — el slug de marca /bodega-central responde 200' 200 "$(code "$BASE/bodega-central")"
ALIAS_CODE="$(curl -s -o /dev/null --max-redirs 0 -w '%{http_code}' "$BASE/bodega-central-vedado")"
check 'criterio 3 — el alias vivo /bodega-central-vedado responde 200 (ni 404 ni redirección)' 200 "$ALIAS_CODE"
ALIAS_LOCATION="$(curl -sI --max-redirs 0 "$BASE/bodega-central-vedado" | grep -ic '^location:')"
check 'criterio 3 — el alias NO lleva cabecera Location' 0 "$ALIAS_LOCATION"

ALIAS_HTML="$(body "$BASE/bodega-central-vedado")"
contains 'criterio 3 — el alias declara su canónico (R22)' "$ALIAS_HTML" 'rel="canonical" href="'"$(node -e 'console.log((process.env.NEXT_PUBLIC_SITE_URL||"http://localhost:3000"))')"'/bodega-central"'

check 'una URL que no existe responde 404' 404 "$(code "$BASE/esta-marca-no-existe-nunca")"

# --------------------------------------------------- criterios 4/5 ----
# Restricciones de la BASE, no del código — nunca se revierten a mano y
# nunca se pide que una página las refleje (por eso psql es correcto aquí).

DUP_SLUG="$(docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
  "INSERT INTO \"Slug\"(value, kind) VALUES ('tienda-demo','STOREFRONT')" 2>&1)"
echo "$DUP_SLUG" | grep -qi 'duplicate key value violates unique constraint' &&
  printf '  ok   criterio 4 — un slug ya tomado por una sucursal falla por restricción única\n' ||
  { printf 'SMOKE FAIL criterio 4 — el INSERT duplicado no falló por restricción — %s\n' "$DUP_SLUG"; FAILS=$((FAILS + 1)); }

RESERVED_ROW="$(docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
  "SELECT count(*) FROM \"Slug\" WHERE value='admin' AND kind='RESERVED'")"
check 'criterio 5 — "admin" está sembrado como RESERVED en el registro' 1 "$RESERVED_ROW"

DUP_RESERVED="$(docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
  "INSERT INTO \"Slug\"(value, kind) VALUES ('admin','STOREFRONT')" 2>&1)"
echo "$DUP_RESERVED" | grep -qi 'duplicate key value violates unique constraint' &&
  printf '  ok   criterio 5 — crear una marca con slug "admin" choca con la clave primaria\n' ||
  { printf 'SMOKE FAIL criterio 5 — el INSERT con slug reservado no falló — %s\n' "$DUP_RESERVED"; FAILS=$((FAILS + 1)); }

# --------------------------------------------------- HS7 ----

if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
else
  FREE_BODY="$(curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/internal/slug-availability?slug=una-marca-que-no-existe-$(date +%s)")"
  check 'HS7 — slug libre: reason=free' "free" "$(echo "$FREE_BODY" | json_field reason)"
  check 'HS7 — slug libre: reserving siempre false' "false" "$(echo "$FREE_BODY" | json_field reserving)"

  TAKEN_BODY="$(curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/internal/slug-availability?slug=tienda-demo")"
  check 'HS7 — slug tomado: reason=taken' "taken" "$(echo "$TAKEN_BODY" | json_field reason)"

  RESERVED_BODY="$(curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/internal/slug-availability?slug=admin")"
  check 'HS7 — slug reservado: reason=reserved' "reserved" "$(echo "$RESERVED_BODY" | json_field reason)"
  # No es "admin-tienda" a secas: R13 (un slug retirado no vuelve al pool)
  # hace que, tras la PRIMERA vez que alguien publique de verdad con ese
  # disfraz en esta base, el pronóstico pase a "admin-tienda-2",
  # "admin-tienda-3"... El contrato (§ El servicio de disponibilidad de
  # slug) solo promete el prefijo del disfraz, no que "admin-tienda" siga
  # libre para siempre — así que la aserción no puede fijar el valor exacto
  # sin acoplarse al estado de una base compartida entre worktrees.
  matches 'HS7 — slug reservado: el disfraz pronosticado empieza por admin-tienda' \
    "$(echo "$RESERVED_BODY" | json_field resolvedSlug)" '^admin-tienda(-[0-9]+)?$'

  OWN_BODY="$(curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/internal/slug-availability?slug=tienda-demo&storeId=seed-tienda-1")"
  check 'HS7 — slug propio: reason=own' "own" "$(echo "$OWN_BODY" | json_field reason)"

  check 'HS7 — sin token responde 401' 401 "$(code "$BASE/api/internal/slug-availability?slug=x")"
  check 'HS7 — sin slug ni name responde 400' 400 "$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $TOKEN" "$BASE/api/internal/slug-availability")"
fi

# --------------------------------------------------- E9: sync crea marca ----

if [ -n "$TOKEN" ]; then
  NEW_ID="smoke-nueva-$(date +%s)"
  SYNC_BODY="$(curl -s -X POST "$BASE/api/internal/sync/catalog" \
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
    -d '{
      "businessId": "seed-negocio-1",
      "events": [{
        "eventId": "evt-'"$NEW_ID"'",
        "entity": "STORE",
        "operation": "CREATE",
        "occurredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
        "payload": {
          "storeId": "'"$NEW_ID"'",
          "businessId": "seed-negocio-1",
          "businessName": "Distribuidora La Rampa",
          "name": "Smoke Nueva Marca",
          "publishToStore": true,
          "baseCurrency": "CUP",
          "updatedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
        }
      }]
    }')"
  check 'E9 — el evento STORE de una tienda nueva sale processed' "processed" "$(echo "$SYNC_BODY" | node -e '
    let body; try { body = JSON.parse(require("fs").readFileSync(0,"utf8")); } catch { process.stdout.write("<invalid>"); process.exit(0); }
    process.stdout.write((body.results && body.results[0] && body.results[0].status) || "<missing>");
  ')"
  NEW_SLUG="$(docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
    "SELECT sf.slug FROM \"Store\" s JOIN \"Storefront\" sf ON sf.id = s.\"storefrontId\" WHERE s.\"externalId\" = '$NEW_ID'")"
  if [ -n "$NEW_SLUG" ]; then
    check 'E9 — la marca nueva responde 200 en su slug' 200 "$(code "$BASE/$NEW_SLUG")"
  else
    printf 'SMOKE FAIL E9 — no se encontró la marca creada por el evento\n'
    FAILS=$((FAILS + 1))
  fi
fi

# --------------------------------------------------- etapa 2: criterios 2 y 6 ----
# `bodega-uno`/`bodega-dos` (seed-tienda-5/6) son fixtures de un solo uso
# para agrupar (architecture.md § prisma/seed.ts) — nunca tienda-demo ni
# tienda-dos, que romperían el criterio 3 de F-004, el smoke.sh de F-010 y
# la medición de check:bundle. Agrupar no tiene vuelta, así que esta sección
# es idempotente: si una corrida anterior ya las agrupó, no repite el POST y
# solo verifica el estado resultante.

psql_val() { # psql_val <SQL>
  docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "$1"
}

# post_json <cookie-jar> <url> <json-body>  →  imprime "<código>\n<cuerpo>"
post_json() {
  curl -sS -b "$1" -X POST -H 'content-type: application/json' -d "$3" -w '\n%{http_code}' "$2"
}
response_code() { printf '%s' "$1" | tail -n1; } # la última línea de post_json
response_body() { printf '%s' "$1" | sed '$d'; } # todo menos la última línea

UNO_ID="$(psql_val "SELECT id FROM \"Store\" WHERE \"externalId\"='seed-tienda-5'")"
DOS_ID="$(psql_val "SELECT id FROM \"Store\" WHERE \"externalId\"='seed-tienda-6'")"
DEMO_ID="$(psql_val "SELECT id FROM \"Store\" WHERE \"externalId\"='seed-tienda-1'")"

if [ -z "$UNO_ID" ] || [ -z "$DOS_ID" ]; then
  printf 'SMOKE FAIL etapa 2 — no se encontraron bodega-uno/bodega-dos (seed-tienda-5/6) en la base\n'
  FAILS=$((FAILS + 1))
else
  URL_GROUP="$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=seed-tienda-5,seed-tienda-6)"
  curl -sS -c "$WORKDIR/cookie_group.jar" -o /dev/null "$URL_GROUP"

  UNO_SF="$(psql_val "SELECT \"storefrontId\" FROM \"Store\" WHERE id='$UNO_ID'")"
  DOS_SF="$(psql_val "SELECT \"storefrontId\" FROM \"Store\" WHERE id='$DOS_ID'")"

  if [ "$UNO_SF" = "$DOS_SF" ]; then
    printf '  (bodega-uno y bodega-dos ya están agrupadas de una corrida anterior — no se repite el POST)\n'
  else
    echo "== etapa 2: POST de agrupar (criterio 2) =="
    RESPONSE="$(post_json "$WORKDIR/cookie_group.jar" "$BASE/api/admin/stores/$UNO_ID/branches" \
      "{\"joiningStoreId\":\"$DOS_ID\"}")"
    check 'criterio 2 — POST propia+propia responde 200' 200 "$(response_code "$RESPONSE")"
  fi

  # Releer siempre desde la base, ya sea que el POST se acabara de aplicar o
  # ya estuviera aplicado de antes — nunca se repite la vista previa como si
  # fuera lo que aplicó.
  BRAND_SLUG="$(psql_val "SELECT slug FROM \"Storefront\" WHERE id='$UNO_SF'")"
  if [ -z "$BRAND_SLUG" ]; then
    BRAND_SLUG="$(psql_val "SELECT sf.slug FROM \"Store\" s JOIN \"Storefront\" sf ON sf.id = s.\"storefrontId\" WHERE s.id='$UNO_ID'")"
  fi
  UNO_OWN_SLUG="$(psql_val "SELECT slug FROM \"Store\" WHERE id='$UNO_ID'")"
  DOS_OWN_SLUG="$(psql_val "SELECT slug FROM \"Store\" WHERE id='$DOS_ID'")"

  SELECTOR_HTML="$(body "$BASE/$BRAND_SLUG")"
  check 'criterio 2 — GET /<marca> responde 200' 200 "$(code "$BASE/$BRAND_SLUG")"
  contains 'criterio 2 — el selector trae el nombre de Bodega Uno' "$SELECTOR_HTML" "Bodega Uno"
  contains 'criterio 2 — el selector trae el nombre de Bodega Dos' "$SELECTOR_HTML" "Bodega Dos"
  SELECTOR_MARK=$(printf '%s' "$SELECTOR_HTML" | grep -c 'data-branch-picker')
  check 'criterio 2 — el selector SÍ trae data-branch-picker' 1 "$SELECTOR_MARK"

  check 'criterio 3/HS4 — la sucursal de bodega-dos sigue respondiendo 200 (sin cambios)' \
    200 "$(curl -s -o /dev/null --max-redirs 0 -w '%{http_code}' "$BASE/$DOS_OWN_SLUG")"

  DISTINCT_SLUGS="$(node -e 'process.stdout.write(process.argv[1] !== process.argv[2] ? "1" : "0")' \
    "$UNO_OWN_SLUG" "$BRAND_SLUG")"
  check 'HS10 — la sucursal de bodega-uno estrenó su propio slug, distinto del de la marca' \
    1 "$DISTINCT_SLUGS"

  SUCURSALES_HTML="$(body "$BASE/$UNO_OWN_SLUG/sucursales")"
  check 'criterio 6 — GET .../sucursales responde 200' 200 "$(code "$BASE/$UNO_OWN_SLUG/sucursales")"
  contains 'criterio 6 — la frase del carrito está en el HTML servido (sin esperar JS)' \
    "$SUCURSALES_HTML" 'Tu carrito no se mueve: cada sucursal guarda el suyo.'

  echo "== etapa 2: rechazos del endpoint de agrupar (§ Tabla de errores) =="
  check 'agrupar — sin cookie responde 401' 401 \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
      -d "{\"joiningStoreId\":\"$DOS_ID\"}" "$BASE/api/admin/stores/$UNO_ID/branches")"

  check 'agrupar — cuerpo inválido responde 400' 400 \
    "$(curl -s -o /dev/null -w '%{http_code}' -b "$WORKDIR/cookie_group.jar" -X POST \
      -H 'content-type: application/json' -d '{}' "$BASE/api/admin/stores/$UNO_ID/branches")"

  if [ -n "$DEMO_ID" ]; then
    URL_ONLY_UNO="$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=seed-tienda-5)"
    curl -sS -c "$WORKDIR/cookie_only_uno.jar" -o /dev/null "$URL_ONLY_UNO"
    check 'agrupar — sin permiso sobre la tienda que se une responde 403' 403 \
      "$(curl -s -o /dev/null -w '%{http_code}' -b "$WORKDIR/cookie_only_uno.jar" -X POST \
        -H 'content-type: application/json' -d "{\"joiningStoreId\":\"$DEMO_ID\"}" \
        "$BASE/api/admin/stores/$UNO_ID/branches")"
  fi
fi

# --------------------------------------------------- etapa 2: repro de sdd-tester (revalidación al agrupar/re-agrupar) ----
# `regroupStoreIntoBrand()` reveló dos huecos de revalidación reales
# (tests.md § Fallos encontrados #1 y #2, `sdd-tester`): una marca que se
# QUEDA con una sola sucursal seguía sirviendo el selector viejo, y las
# hermanas PREEXISTENTES de la marca primaria nunca se enteraban de un
# tercer miembro nuevo. Fixtures propias, creadas por el sync — nunca
# `tienda-demo`/`tienda-dos`/`bodega-uno`/`bodega-dos` — porque este bloque
# SÍ vuelve a tocar una marca ya agrupada, cosa que las fixtures de un solo
# uso no deben sufrir dos veces.

sync_create_store() { # sync_create_store <externalId> <name>
  curl -s -X POST "$BASE/api/internal/sync/catalog"     -H 'content-type: application/json' -H "authorization: Bearer $TOKEN"     -d '{
      "businessId": "seed-negocio-1",
      "events": [{
        "eventId": "evt-'"$1"'",
        "entity": "STORE",
        "operation": "CREATE",
        "occurredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
        "payload": {
          "storeId": "'"$1"'",
          "businessId": "seed-negocio-1",
          "businessName": "Distribuidora La Rampa",
          "name": "'"$2"'",
          "publishToStore": true,
          "baseCurrency": "CUP",
          "updatedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
        }
      }]
    }' >/dev/null
}

store_id_by_external() { psql_val "SELECT id FROM \"Store\" WHERE \"externalId\"='$1'"; }

if [ -z "$TOKEN" ]; then
  printf 'SMOKE FAIL etapa 2 (revalidación) — QAB_BEARER_TOKEN no disponible, acúñalo con: npm run mint:token -- seed-negocio-1\n'
  FAILS=$((FAILS + 1))
else
  SUFFIX="$(date +%s)"
  EXT_A="grp2-primary-$SUFFIX"
  EXT_B="grp2-joining-$SUFFIX"
  EXT_D="grp2-shrink-$SUFFIX"
  EXT_E="grp2-third-$SUFFIX"

  sync_create_store "$EXT_A" "Grupo Dos Primary $SUFFIX"
  sync_create_store "$EXT_B" "Grupo Dos Joining $SUFFIX"
  sync_create_store "$EXT_D" "Grupo Dos Shrink $SUFFIX"
  sync_create_store "$EXT_E" "Grupo Dos Third $SUFFIX"

  ID_A="$(store_id_by_external "$EXT_A")"
  ID_B="$(store_id_by_external "$EXT_B")"
  ID_D="$(store_id_by_external "$EXT_D")"
  ID_E="$(store_id_by_external "$EXT_E")"

  if [ -z "$ID_A" ] || [ -z "$ID_B" ] || [ -z "$ID_D" ] || [ -z "$ID_E" ]; then
    printf 'SMOKE FAIL etapa 2 (revalidación) — el sync no creó las cuatro tiendas de repro\n'
    FAILS=$((FAILS + 1))
  else
    URL_REPRO="$(QAB_BASE_URL="$BASE" node scripts/mint-sso-token.mjs --stores=$EXT_A,$EXT_B,$EXT_D,$EXT_E)"
    curl -sS -c "$WORKDIR/cookie_repro.jar" -o /dev/null "$URL_REPRO"

    # Paso 1: A absorbe a B — A pasa a tener 2 sucursales.
    R1="$(post_json "$WORKDIR/cookie_repro.jar" "$BASE/api/admin/stores/$ID_A/branches" "{\"joiningStoreId\":\"$ID_B\"}")"
    check 'repro — A absorbe a B (200)' 200 "$(response_code "$R1")"
    A_BRAND_SLUG="$(psql_val "SELECT sf.slug FROM \"Store\" s JOIN \"Storefront\" sf ON sf.id=s.\"storefrontId\" WHERE s.id='$ID_A'")"

    # sdd-tester (ciclo 4): calienta la página de A ANTES de encogerla —
    # sin esto, la aserción de abajo sería un acierto de caché frío (la
    # PRIMERA vez que alguien pide /A ya sería después del encogimiento, así
    # que resolvería fresco y "pasaría" aunque el arreglo no existiera). Es
    # el mismo vicio que el implementador cazó en la aserción de la
    # hermana E — aquí lo cierro para la marca de A también.
    A_HTML_BEFORE_SHRINK="$(body "$BASE/$A_BRAND_SLUG")"
    A_PICKER_BEFORE_SHRINK=$(printf '%s' "$A_HTML_BEFORE_SHRINK" | grep -c 'data-branch-picker')
    check 'repro (calentando caché) — /A todavía sirve el selector de 2 ANTES de encogerse' 1 "$A_PICKER_BEFORE_SHRINK"

    # Paso 2: D absorbe a B — B se MUEVE de la marca de A a la de D. La
    # marca de A se queda con UNA sola sucursal (fallo #1: su slug propio
    # tiene que dejar de servir el selector de inmediato).
    R2="$(post_json "$WORKDIR/cookie_repro.jar" "$BASE/api/admin/stores/$ID_D/branches" "{\"joiningStoreId\":\"$ID_B\"}")"
    check 'repro — D absorbe a B, la marca de A se encoge a 1 (200)' 200 "$(response_code "$R2")"

    A_HTML_AFTER_SHRINK="$(body "$BASE/$A_BRAND_SLUG")"
    A_PICKER_AFTER_SHRINK=$(printf '%s' "$A_HTML_AFTER_SHRINK" | grep -c 'data-branch-picker')
    check '[ALTA #1] la marca de A, YA CALENTADA con el selector viejo, deja de servirlo — sin esperar el piso de ISR'       0 "$A_PICKER_AFTER_SHRINK"

    D_BRAND_SLUG="$(psql_val "SELECT sf.slug FROM \"Store\" s JOIN \"Storefront\" sf ON sf.id=s.\"storefrontId\" WHERE s.id='$ID_D'")"
    B_OWN_SLUG="$(psql_val "SELECT slug FROM \"Store\" WHERE id='$ID_B'")"

    # sdd-tester (ciclo 4): mismo calentamiento para la hermana B antes del
    # paso 3 — su propia /sucursales tiene que estar realmente cacheada SIN
    # E, o la aserción de abajo tampoco prueba nada.
    B_SUCURSALES_BEFORE_THIRD="$(body "$BASE/$B_OWN_SLUG/sucursales")"

    # Paso 3: D absorbe a E también. La marca de D pasa a tener D, B, E.
    # B ya estaba ahí ANTES de este paso (fallo #2: su propia página tiene
    # que enterarse del tercer miembro sin esperar el piso de ISR).
    R3="$(post_json "$WORKDIR/cookie_repro.jar" "$BASE/api/admin/stores/$ID_D/branches" "{\"joiningStoreId\":\"$ID_E\"}")"
    check 'repro — D absorbe también a E, la marca de D llega a 3 (200)' 200 "$(response_code "$R3")"

    E_NAME="$(psql_val "SELECT name FROM \"Store\" WHERE id='$ID_E'")"
    B_HAD_E_BEFORE=$(printf '%s' "$B_SUCURSALES_BEFORE_THIRD" | grep -Fc "$E_NAME")
    check 'repro (calentando caché) — /sucursales de B todavía NO trae a E antes del paso 3'       0 "$B_HAD_E_BEFORE"

    B_SUCURSALES_HTML="$(body "$BASE/$B_OWN_SLUG/sucursales")"
    contains "[ALTA #2] la sucursal B, YA en la marca antes del paso 3, ve a E en su propia /sucursales"       "$B_SUCURSALES_HTML" "Grupo Dos Third $SUFFIX"

    D_HTML="$(body "$BASE/$D_BRAND_SLUG")"
    contains 'repro — el selector de D, con las tres, trae a las tres' "$D_HTML" "Grupo Dos Shrink $SUFFIX"
    contains 'repro — el selector de D trae a B' "$D_HTML" "Grupo Dos Joining $SUFFIX"
    contains 'repro — el selector de D trae a E' "$D_HTML" "Grupo Dos Third $SUFFIX"

    # -------- setStoreEnabled: la misma clase de fallo, hallada al buscar
    # "más de lo mismo" — un cambio de estado en una marca multi-sucursal
    # no revalidaba el slug de la marca ni el de las hermanas.
    STATUS_BODY='{"enabled":false,"reasonCode":"VACACIONES","message":"Cerrado por inventario"}'
    STATUS_CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$WORKDIR/cookie_repro.jar" -X PUT       -H 'content-type: application/json' -d "$STATUS_BODY" "$BASE/api/admin/stores/$ID_D/status")"
    check 'setStoreEnabled — suspender D (200)' 200 "$STATUS_CODE"

    D_HTML_AFTER_SUSPEND="$(body "$BASE/$D_BRAND_SLUG")"
    contains '[setStoreEnabled] el selector de la marca refleja el cierre de D de inmediato'       "$D_HTML_AFTER_SUSPEND" "Cerrada ahora"

    B_SUCURSALES_AFTER_SUSPEND="$(body "$BASE/$B_OWN_SLUG/sucursales")"
    contains '[setStoreEnabled] la propia /sucursales de B (hermana) también refleja el cierre de D'       "$B_SUCURSALES_AFTER_SUSPEND" "Cerrada ahora"

    # -------- handleStore() rutina de sync: la MISMA clase de fallo, pero en
    # el camino que corre con cada lote real de Cuadre de Caja (tests.md §
    # Fallos encontrados #3, [ALTA]) — un evento STORE que solo cambia
    # name/city/etc de una sucursal YA EXISTENTE de una marca multi-sucursal
    # (D tiene D, B y E tras los pasos de arriba) no revalidaba ni el
    # selector de la marca ni ninguna hermana.
    E_OWN_SLUG="$(psql_val "SELECT slug FROM \"Store\" WHERE id='$ID_E'")"
    RENAMED="Grupo Dos Joining $SUFFIX RENOMBRADA"
    # Precalienta la resolución propia de E ANTES del evento: si nadie la
    # hubiera leído todavía, un acierto de caché frío (no una revalidación
    # correcta) haría pasar la aserción de abajo aunque el arreglo no
    # existiera — justo el falso verde que este guion existe para evitar.
    body "$BASE/$E_OWN_SLUG/sucursales" >/dev/null
    curl -s -X POST "$BASE/api/internal/sync/catalog"       -H 'content-type: application/json' -H "authorization: Bearer $TOKEN"       -d '{
        "businessId": "seed-negocio-1",
        "events": [{
          "eventId": "evt-'"$EXT_B"'-rename",
          "entity": "STORE",
          "operation": "UPDATE",
          "occurredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
          "payload": {
            "storeId": "'"$EXT_B"'",
            "businessId": "seed-negocio-1",
            "businessName": "Distribuidora La Rampa",
            "name": "'"$RENAMED"'",
            "publishToStore": true,
            "baseCurrency": "CUP",
            "updatedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
          }
        }]
      }' >/dev/null

    D_HTML_AFTER_RENAME="$(body "$BASE/$D_BRAND_SLUG")"
    contains '[ALTA #3] evento STORE de rutina sobre B — el SELECTOR de la marca de D muestra el nombre nuevo de inmediato'       "$D_HTML_AFTER_RENAME" "$RENAMED"

    E_SUCURSALES_AFTER_RENAME="$(body "$BASE/$E_OWN_SLUG/sucursales")"
    contains '[ALTA #3] evento STORE de rutina sobre B — la HERMANA E ve el nombre nuevo en su propia /sucursales de inmediato'       "$E_SUCURSALES_AFTER_RENAME" "$RENAMED"
  fi
fi

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
