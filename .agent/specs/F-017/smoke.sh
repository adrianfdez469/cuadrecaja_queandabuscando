#!/usr/bin/env bash
# Verificación en runtime de F-017 (Storefront por encima de Store), etapa 1.
# La ejecuta `bash .agent/verify.sh F-017 --smoke` con `next dev` ya levantado
# en $SMOKE_BASE_URL, contra la base real de docker-compose.yml (`npm run
# seed` ya corrido) y con SYNC_TOKEN en el entorno.
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
  node -e '
    const fs = require("fs");
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^SYNC_TOKEN="([^"]*)"/m);
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
  printf 'SMOKE FAIL SYNC_TOKEN no está en .env — no se puede probar el servicio de slug\n'
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

# ---------------------------------------------------------------------------

printf '\n%d aserciones fallidas\n' "$FAILS"
[ "$FAILS" -eq 0 ]
