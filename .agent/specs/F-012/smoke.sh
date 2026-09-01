#!/usr/bin/env bash
# Verificación en runtime de F-012 (cuenta opcional del cliente final). La
# ejecuta `bash .agent/verify.sh F-012 --smoke` con `next dev` ya levantado
# en $SMOKE_BASE_URL, sobre la BASE DE DATOS REAL (DATABASE_URL/DIRECT_URL,
# nunca `prisma migrate reset`/`db push` — AGENTS.md § Comandos prohibidos).
#
# SEGUNDO CICLO: F-028 (emulador local de Supabase Auth, `passes: true`) ya
# está en pie, y con él `scripts/auth-otp.mjs` hace el ciclo completo de
# acceso por correo — SIN humano, contra las rutas PROPIAS de F-012
# (`POST /api/account/otp`, `POST /api/account/otp/verify`, las mismas que
# llama `SignInCard`). Eso convierte en automatizable casi TODO lo que el
# primer ciclo dejó en la Parte 2 (MANUAL): el criterio 1a entero, el
# positivo de D6 (Order.customerId con sesión válida), el segundo login sin
# duplicar (criterio 2), y la mitad de criterio 5 que necesita una sesión de
# cliente real a la vez que una de admin.
#
# Lo que SIGUE sin poder automatizarse aquí, y por qué (ver § PARTE 2 al
# final): el autocompletado del criterio 3 rellena los tres campos del
# checkout en el CLIENTE, después de hidratar (`CheckoutForm.tsx` hace
# `fetch("/api/account/profile")` en un efecto) — no hay nada de eso en el
# HTML que `curl` puede leer. Este smoke SÍ prueba, con HTTP real, que el
# dato que ese `fetch` va a recibir es el correcto (`GET /api/account/profile`
# con la sesión real, tras guardar el perfil); lo que no puede hacer sin un
# navegador es mirar el DOM ya rellenado.
#
# Da por hecho que `npm run seed` ya corrió: tienda-demo tiene al menos un
# producto disponible.
#
# GUARDIÁN (F-029, decisión del humano 2026-08-31 — PP2 de
# .agent/specs/F-029/plan.md): `node scripts/dev-secrets.mjs --check` corre
# aquí, junto al `cd`, antes de cualquier aserción. Si sale distinto de 0, este
# guion ABORTA LA CORRIDA ENTERA con `SMOKE FAIL` nombrando el generador — no
# es un fallo aislado del criterio 5, es un entorno mal montado. Comparte
# contrato con .agent/specs/F-029/smoke.sh: un nombre por línea de cada clave
# ausente o corta.
set -uo pipefail

cd "$(dirname "$0")/../../.." || exit 1

GUARDIAN_OUT="$(node scripts/dev-secrets.mjs --check 2>&1)"
GUARDIAN_CODE=$?
if [ "$GUARDIAN_CODE" -ne 0 ]; then
  printf 'SMOKE FAIL node scripts/dev-secrets.mjs --check salió %s (faltan o son cortas: %s) — genera los secretos con: node scripts/dev-secrets.mjs --write\n' \
    "$GUARDIAN_CODE" "$(echo "$GUARDIAN_OUT" | tr '\n' ' ')"
  exit 1
fi

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

# `.env`, sin depender de que el shell que invoca el smoke lo tenga
# exportado (mismo patrón que .agent/specs/F-028/smoke.sh).
env_val() {
  node -e '
    import("dotenv/config").then(() => {
      console.log(process.env[process.argv[1]] ?? "");
    });
  ' "$1"
}

customer_count_by_email() {
  node -e '
    import("dotenv/config").then(async () => {
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const { rows } = await db.query(
        `select count(*)::int as n from "Customer" where email = $1`,
        [process.argv[1]],
      );
      await db.end();
      console.log(rows[0].n);
    });
  ' "$1"
}

order_customer_id() {
  node -e '
    import("dotenv/config").then(async () => {
      const { Client } = await import("pg");
      const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
      await db.connect();
      const { rows } = await db.query(`select "customerId" from "Order" where code = $1`, [process.argv[1]]);
      await db.end();
      console.log(rows[0]?.customerId ?? "");
    });
  ' "$1" 2>/dev/null
}

order_code_from_response() { # <cuerpo JSON de la respuesta>
  node -e "
    let d='';process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{console.log(JSON.parse(d).code ?? '')}catch{console.log('')}});
  " <<<"$1"
}

# ============================================================================
# PARTE 1 — automatizada
# ============================================================================

# --------------------------------------------------- criterio 6 (E26) ------
# El estado REAL de este worktree hoy: NEXT_PUBLIC_SUPABASE_URL apunta al
# emulador de Auth+Storage, no vacío — así que esto verifica el camino "Auth
# configurado", no el "Auth vacío" exacto de la spec. Esa forma exacta
# (`NEXT_PUBLIC_SUPABASE_URL=""`) necesita un build aparte porque son
# variables NEXT_PUBLIC_* — se verificó a mano y queda registrado, con el
# comando exacto, en tests.md (criterio 6): no cabe en un smoke contra un
# servidor ya levantado con el .env de siempre.
check '/tienda-demo responde 200 (la tienda no se cae por Auth)' 200 "$(code "$BASE/tienda-demo")"
check '/cuenta/entrar responde 200 (nunca 500, E26/E22-E23)' 200 "$(code "$BASE/cuenta/entrar")"

# --------------------------------------------------------- criterio 4 ------
# Lo que F-010 ya verificaba, repetido aquí porque F-012 es quien podía
# romperlo (I4): sin cabecera Cookie, el pedido de invitado se sigue
# creando.
if git grep -qn 'cookies()' -- src/features/orders/ "src/app/[slug]/"; then
  printf 'SMOKE FAIL criterio 4 — se encontró cookies() en el camino del pedido (rompe F-010 fila 4)\n'
  FAILS=$((FAILS + 1))
else
  printf '  ok   criterio 4 — sin lectura de cookies() en src/features/orders/ ni src/app/[slug]/ (R18)\n'
fi

if QAB_BASE_URL="$BASE" node scripts/place-order.mjs; then
  printf '  ok   place-order.mjs (pedido de invitado, sin Cookie, criterio 4/E16)\n'
else
  printf 'SMOKE FAIL place-order.mjs (pedido de invitado) — ver salida arriba\n'
  FAILS=$((FAILS + 1))
fi

# Producto orderable real de tienda-demo, reusado por varios bloques de abajo
# (R14 sin sesión, E17, D6 positivo, sesión caducada).
R14_PRODUCT_ID=$(node -e '
import("dotenv/config").then(async () => {
  const { Client } = await import("pg");
  const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `SELECT sp.id FROM "StoreProduct" sp
       JOIN "Store" s ON s.id = sp."storeId"
       JOIN "Storefront" sf ON sf.id = s."storefrontId"
      WHERE sf.slug = $1 AND sp.availability != '"'"'OUT_OF_STOCK'"'"'
        AND sp.visible = true AND sp."deletedAt" IS NULL
      LIMIT 1`,
    ["tienda-demo"],
  );
  await db.end();
  console.log(rows[0]?.id ?? "");
});
' 2>/dev/null)

if [ -z "$R14_PRODUCT_ID" ]; then
  printf 'SMOKE FAIL no se encontró producto orderable en tienda-demo (¿corrió npm run seed?)\n'
  FAILS=$((FAILS + 1))
fi

quote_subtotal() { # <productId>
  local q
  q=$(body -X POST "$BASE/api/orders/quote" -H 'content-type: application/json' \
    -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$1\",\"qty\":1}]}")
  node -e "console.log(JSON.parse(process.argv[1]).subtotal)" "$q" 2>/dev/null
}

# -------------------------------------------- criterio 4/R14 — inyección, ---
# ------------------------------------------------------- SIN sesión --------
# Manda customerId en el cuerpo, en la query y en una cabecera: los tres se
# ignoran.
if [ -n "$R14_PRODUCT_ID" ]; then
  SUBTOTAL=$(quote_subtotal "$R14_PRODUCT_ID")
  PHONE="+53$(date +%s)r14"
  ORDER_BODY=$(node -e '
    console.log(JSON.stringify({
      storeSlug: "tienda-demo",
      items: [{ storeProductId: process.argv[1], qty: 1 }],
      contact: { name: "Smoke R14", phone: process.argv[2] },
      fulfillment: "PICKUP",
      expectedTotal: process.argv[3],
      customerId: "11111111-1111-1111-1111-111111111111",
    }));
  ' "$R14_PRODUCT_ID" "$PHONE" "${SUBTOTAL:-0.00}")

  R14_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST \
    "$BASE/api/orders?customerId=22222222-2222-2222-2222-222222222222" \
    -H 'content-type: application/json' \
    -H 'X-Customer-Id: 33333333-3333-3333-3333-333333333333' \
    -d "$ORDER_BODY")
  R14_STATUS=$(echo "$R14_RESPONSE" | tail -n1)
  R14_CODE=$(order_code_from_response "$(echo "$R14_RESPONSE" | head -n1)")

  check 'R14 (sin sesión) — POST /api/orders con customerId inyectado sigue en 201' 201 "$R14_STATUS"

  if [ -n "$R14_CODE" ]; then
    R14_CUSTOMER_ID=$(order_customer_id "$R14_CODE")
    if [ -z "$R14_CUSTOMER_ID" ]; then
      printf '  ok   R14 (sin sesión) — Order.customerId quedó NULL pese al customerId inyectado\n'
    else
      printf 'SMOKE FAIL R14 (sin sesión) — Order.customerId = %s (debía ser NULL)\n' "$R14_CUSTOMER_ID"
      FAILS=$((FAILS + 1))
    fi
  else
    printf 'SMOKE FAIL R14 (sin sesión) — no se pudo leer el code del pedido creado\n'
    FAILS=$((FAILS + 1))
  fi
fi

# ---------------------------------------------- criterio 2/4 — E17 real ----
# Una cookie de sesión PRESENTE pero con un valor que no decodifica a nada
# (ni siquiera JSON) — el camino más barato de "irresoluble", junto al de la
# sesión CADUCADA de verdad que se prueba más abajo con un JWT real.
if [ -n "$R14_PRODUCT_ID" ]; then
  E17_STATUS=$(code -X POST "$BASE/api/orders" -H 'content-type: application/json' \
    -H 'Cookie: qab-shopper-auth=smoke-garbage-session' \
    -d "$(node -e '
      console.log(JSON.stringify({
        storeSlug: "tienda-demo",
        items: [{ storeProductId: process.argv[1], qty: 1 }],
        contact: { name: "Smoke E17", phone: "+53"+Date.now().toString().slice(-9) },
        fulfillment: "PICKUP",
        expectedTotal: process.argv[2],
      }));
    ' "$R14_PRODUCT_ID" "${SUBTOTAL:-0.00}")")
  check 'E17 — pedido con cookie de sesión ilegible sigue en 201 (nunca bloquea)' 201 "$E17_STATUS"
fi

# ---------------------------------------------------------- criterio 3 -----
GET_PROFILE=$(body "$BASE/api/account/profile")
echo "$GET_PROFILE" | grep -q '"signedIn":false' &&
  printf '  ok   GET /api/account/profile sin sesión: signedIn:false, nunca un error\n' ||
  { printf 'SMOKE FAIL GET /api/account/profile sin sesión no respondió signedIn:false — %s\n' "$GET_PROFILE"; FAILS=$((FAILS + 1)); }

check '/[slug]/checkout responde 200 con una cookie de sesión ilegible presente' 200 \
  "$(code "$BASE/tienda-demo/checkout" -H 'Cookie: qab-shopper-auth=smoke-garbage-session')"

# ---------------------------------------------------------- criterio 5 -----
# R21 (nombres de cookie) y la mitad "logout de cliente no toca la cookie de
# admin" se demuestran con cookies fabricadas — el borrado de
# signOutCustomer() decide por NOMBRE de cookie, nunca por identidad, así
# que no hace falta que ninguna de las dos sea una sesión real. La mitad que
# SÍ necesita sesiones reales va más abajo, con auth-otp.mjs + el JWT de
# admin.
LOGOUT_HEADERS=$(curl -s -D - -o /dev/null -X POST "$BASE/api/account/logout" \
  -H 'Cookie: qab-admin-session=smoke-fake-admin; qab-shopper-auth=smoke-fake-shopper; qab-shopper-hint=1')
if echo "$LOGOUT_HEADERS" | grep -qi '^set-cookie: qab-admin-session'; then
  printf 'SMOKE FAIL criterio 5 — POST /api/account/logout puso un Set-Cookie para qab-admin-session (debía no tocarla)\n'
  FAILS=$((FAILS + 1))
else
  printf '  ok   criterio 5 — logout de cliente no manda Set-Cookie para qab-admin-session\n'
fi
echo "$LOGOUT_HEADERS" | grep -qi '^set-cookie: qab-shopper-auth=;' &&
  printf '  ok   criterio 5 — logout de cliente SÍ borra qab-shopper-auth\n' ||
  { printf 'SMOKE FAIL criterio 5 — logout de cliente no borró qab-shopper-auth\n'; FAILS=$((FAILS + 1)); }

# ============================================================================
# Lo que el emulador de F-028 desbloquea: sesiones REALES, con
# scripts/auth-otp.mjs, sin humano.
# ============================================================================

SUPABASE_URL="$(env_val NEXT_PUBLIC_SUPABASE_URL)"
ANON_KEY="$(env_val NEXT_PUBLIC_SUPABASE_ANON_KEY)"

if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  printf '  ..  criterio 1a y derivados SALTADOS — NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY vacías (criterio 6: eso es el estado ESPERADO cuando Auth no está configurado, no un fallo de F-012)\n'
else
  # -------------------------------------------- criterio 1a (E1-E4) — real -
  # El ciclo completo de acceso por correo, por las rutas PROPIAS de F-012
  # (POST /api/account/otp, POST /api/account/otp/verify — las que
  # SignInCard llama), sin humano.
  CRITERIO1A_EMAIL="smoke-f012+$(date +%s)@local.test"
  COOKIE_JAR_1A="$(mktemp)"
  COUNT_BEFORE_1A="$(customer_count_by_email "$CRITERIO1A_EMAIL")"
  AUTH_OTP_OUT_1A="$(node scripts/auth-otp.mjs --mode app --app "$BASE" --email "$CRITERIO1A_EMAIL" \
    --cookie-jar "$COOKIE_JAR_1A" --quiet --json 2>&1)"
  AUTH_OTP_CODE_1A=$?
  COUNT_AFTER_1A="$(customer_count_by_email "$CRITERIO1A_EMAIL")"

  if [ "$AUTH_OTP_CODE_1A" -eq 0 ]; then
    printf '  ok   criterio 1a — scripts/auth-otp.mjs --mode app termina en 0 (código de 6 dígitos leído de Mailpit, canjeado por las rutas de F-012)\n'
    check 'criterio 1a — Customer sube en exactamente 1 (iii)' 1 "$((COUNT_AFTER_1A - COUNT_BEFORE_1A))"

    COOKIE_1A="$(cat "$COOKIE_JAR_1A" 2>/dev/null)"
    check 'criterio 1a — GET /cuenta con la sesión responde 200 (i, el navegador acaba ahí)' 200 \
      "$(code "$BASE/cuenta" -H "Cookie: $COOKIE_1A")"
    if body "$BASE/cuenta" -H "Cookie: $COOKIE_1A" | grep -qF "$CRITERIO1A_EMAIL"; then
      printf '  ok   criterio 1a — /cuenta muestra el perfil (correo sembrado, ii)\n'
    else
      printf 'SMOKE FAIL criterio 1a — /cuenta no muestra el correo %s\n' "$CRITERIO1A_EMAIL"
      FAILS=$((FAILS + 1))
    fi

    # ------------------------------------------ criterio 2 (E6/E8/R10/R12) -
    # Guarda un nombre a mano y comprueba que el SEGUNDO login del MISMO
    # correo no crea otra fila y no lo pisa.
    curl -s -o /dev/null -X PUT "$BASE/api/account/profile" -H "Cookie: $COOKIE_1A" \
      -H 'content-type: application/json' \
      -d "{\"name\":\"Smoke Segundo Login\",\"phone\":\"+5355588899\",\"email\":\"$CRITERIO1A_EMAIL\"}"

    COOKIE_JAR_1A_2="$(mktemp)"
    AUTH_OTP_OUT_1A_2="$(node scripts/auth-otp.mjs --mode app --app "$BASE" --email "$CRITERIO1A_EMAIL" \
      --cookie-jar "$COOKIE_JAR_1A_2" --quiet --json 2>&1)"
    AUTH_OTP_CODE_1A_2=$?
    COUNT_AFTER_SEGUNDO="$(customer_count_by_email "$CRITERIO1A_EMAIL")"

    if [ "$AUTH_OTP_CODE_1A_2" -eq 0 ]; then
      check 'criterio 2 — segundo login del mismo correo NO crea otra fila (E8/R12)' 1 "$COUNT_AFTER_SEGUNDO"
      COOKIE_1A_2="$(cat "$COOKIE_JAR_1A_2" 2>/dev/null)"
      PERFIL_TRAS_SEGUNDO="$(body "$BASE/api/account/profile" -H "Cookie: $COOKIE_1A_2")"
      if echo "$PERFIL_TRAS_SEGUNDO" | grep -q '"name":"Smoke Segundo Login"'; then
        printf '  ok   criterio 2 — el segundo login NO reescribió el perfil guardado (E6/R10)\n'
      else
        printf 'SMOKE FAIL criterio 2 — el perfil cambió tras el segundo login: %s\n' "$PERFIL_TRAS_SEGUNDO"
        FAILS=$((FAILS + 1))
      fi
    else
      printf 'SMOKE FAIL criterio 2 — el segundo login (mismo correo) salió %s: %s\n' "$AUTH_OTP_CODE_1A_2" "$AUTH_OTP_OUT_1A_2"
      FAILS=$((FAILS + 1))
    fi
    rm -f "$COOKIE_JAR_1A_2"

    # ------------------------------------------------ criterio 3 — datos ---
    # Lo que SÍ es automatizable sin un navegador (ver cabecera del archivo):
    # el dato que el fetch de CheckoutForm va a recibir es el que se guardó.
    if echo "$PERFIL_TRAS_SEGUNDO" | grep -q '"phone":"+5355588899"'; then
      printf '  ok   criterio 3 — GET /api/account/profile con sesión trae el perfil guardado (lo que CheckoutForm.tsx consume al hidratar)\n'
    else
      printf 'SMOKE FAIL criterio 3 — el perfil guardado no se lee de vuelta: %s\n' "$PERFIL_TRAS_SEGUNDO"
      FAILS=$((FAILS + 1))
    fi

    # -------------------------------------- criterio 4/D6 positivo — real --
    # Con la MISMA sesión real: el pedido queda enlazado con el id del
    # Customer (D6), y un customerId inyectado en cuerpo/query/cabecera se
    # sigue ignorando aunque HAYA sesión (R14).
    if [ -n "$R14_PRODUCT_ID" ]; then
      REAL_CUSTOMER_ID=$(node -e '
        import("dotenv/config").then(async () => {
          const { Client } = await import("pg");
          const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
          await db.connect();
          const { rows } = await db.query(`select id from "Customer" where email = $1`, [process.argv[1]]);
          await db.end();
          console.log(rows[0]?.id ?? "");
        });
      ' "$CRITERIO1A_EMAIL" 2>/dev/null)

      SUBTOTAL_D6=$(quote_subtotal "$R14_PRODUCT_ID")
      PHONE_D6="+53$(date +%s)d6"
      ORDER_BODY_D6=$(node -e '
        console.log(JSON.stringify({
          storeSlug: "tienda-demo",
          items: [{ storeProductId: process.argv[1], qty: 1 }],
          contact: { name: "Smoke D6 con sesion", phone: process.argv[2] },
          fulfillment: "PICKUP",
          expectedTotal: process.argv[3],
          customerId: "11111111-1111-1111-1111-111111111111",
        }));
      ' "$R14_PRODUCT_ID" "$PHONE_D6" "${SUBTOTAL_D6:-0.00}")

      D6_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST \
        "$BASE/api/orders?customerId=22222222-2222-2222-2222-222222222222" \
        -H 'content-type: application/json' \
        -H 'X-Customer-Id: 33333333-3333-3333-3333-333333333333' \
        -H "Cookie: $COOKIE_1A" \
        -d "$ORDER_BODY_D6")
      D6_STATUS=$(echo "$D6_RESPONSE" | tail -n1)
      D6_CODE=$(order_code_from_response "$(echo "$D6_RESPONSE" | head -n1)")
      check 'criterio 4/D6 — pedido con sesión válida (+ inyección) responde 201' 201 "$D6_STATUS"

      if [ -n "$D6_CODE" ]; then
        check 'criterio 4/D6 — Order.customerId = el Customer real de la sesión (inyección ignorada)' \
          "$REAL_CUSTOMER_ID" "$(order_customer_id "$D6_CODE")"
      else
        printf 'SMOKE FAIL criterio 4/D6 — no se pudo leer el code del pedido con sesión\n'
        FAILS=$((FAILS + 1))
      fi
    fi

    # -------------------------------- criterio 5 con sesiones REALES -------
    # R21 y la mitad de cookies fabricadas ya se probaron arriba; esto añade
    # la mitad que de verdad necesitaba una sesión de cliente REAL. La de
    # admin necesita un JWT minted a mano — ahora incondicional (F-029): el
    # guardián de la cabecera ya garantizó que ADMIN_SESSION_SECRET es
    # utilizable, así que las cuatro aserciones de abajo se ejecutan siempre,
    # sin la rama SALTADO que existía antes de que las tres claves fueran
    # generables por un comando.
    ADMIN_JWT=$(node -e '
      import("dotenv/config").then(async () => {
        const { SignJWT } = await import("jose");
        const secret = new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET);
        const token = await new SignJWT({
          adminUserId: "smoke-admin", externalId: "smoke", name: "Smoke Admin",
          businessId: "smoke-business", storeIds: [],
        }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret);
        console.log(token);
      });
    ' 2>/dev/null)
    COMBINED_COOKIE="qab-admin-session=$ADMIN_JWT; $COOKIE_1A"

    check 'criterio 5 — /admin en 200 con sesión de CLIENTE real presente a la vez' 200 \
      "$(code "$BASE/admin" -H "Cookie: $COMBINED_COOKIE")"
    check 'criterio 5 — /cuenta en 200 con sesión de ADMIN real presente a la vez' 200 \
      "$(code "$BASE/cuenta" -H "Cookie: $COMBINED_COOKIE")"

    curl -s -o /dev/null -X POST "$BASE/api/account/logout" -H "Cookie: $COMBINED_COOKIE"

    check 'criterio 5 — /admin sigue en 200 tras cerrar la sesión de cliente' 200 \
      "$(code "$BASE/admin" -H "Cookie: qab-admin-session=$ADMIN_JWT")"
    check 'criterio 5 — /cuenta ahora exige entrar (307): la sesión de cliente SÍ se cerró' 307 \
      "$(code "$BASE/cuenta" -H "Cookie: $COOKIE_1A")"

    # ------------------------------------------------------ limpieza -------
    # R12 — borra SOLO la fila que ESTA corrida creó, para que el aserto de
    # conteo de la próxima corrida siga siendo estable (mismo patrón que
    # .agent/specs/F-028/smoke.sh).
    node -e '
      import("dotenv/config").then(async () => {
        const { Client } = await import("pg");
        const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
        await db.connect();
        await db.query(`delete from "Customer" where email = $1`, [process.argv[1]]);
        await db.end();
      });
    ' "$CRITERIO1A_EMAIL" >/dev/null 2>&1
  else
    printf 'SMOKE FAIL criterio 1a — scripts/auth-otp.mjs --mode app salió %s: %s\n' "$AUTH_OTP_CODE_1A" "$AUTH_OTP_OUT_1A"
    FAILS=$((FAILS + 1))
    printf '  ..  criterio 2, 4/D6 positivo y 5 (sesiones reales) SALTADOS — dependían del login de criterio 1a, que falló arriba\n'
  fi
  rm -f "$COOKIE_JAR_1A"

  # ------------------------------ criterio 4/D6 — sesión CADUCADA real -----
  # No basta con una cookie ilegible (ya probado arriba, E17): esto firma un
  # JWT REAL con el MISMO secreto que usa el emulador (STORAGE_JWT_SECRET =
  # GOTRUE_JWT_SECRET en docker-compose.yml), con "exp" en el pasado.
  # Supabase lo rechaza por CADUCIDAD de verdad (no por firma inválida) —
  # confirmado antes de usarlo, contra /auth/v1/user — que es la diferencia
  # real entre "caducada" e "irresoluble" que E17 nombra.
  if [ -n "$R14_PRODUCT_ID" ]; then
    EXPIRED_COOKIE=$(node -e '
      import("dotenv/config").then(async () => {
        const { SignJWT } = await import("jose");
        const secret = new TextEncoder().encode(process.env.STORAGE_JWT_SECRET);
        const now = Math.floor(Date.now() / 1000);
        const exp = now - 3600;
        const payload = {
          iss: `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/auth/v1`,
          sub: "00000000-0000-0000-0000-000000000000",
          aud: "authenticated",
          email: "smoke-expired@local.test",
          role: "authenticated",
        };
        const jwt = await new SignJWT(payload)
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt(now - 7200)
          .setExpirationTime(exp)
          .sign(secret);
        const session = {
          access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp,
          refresh_token: "smoke-expired-refresh",
          user: {
            id: "00000000-0000-0000-0000-000000000000", aud: "authenticated",
            role: "authenticated", email: "smoke-expired@local.test",
          },
        };
        const b64 = Buffer.from(JSON.stringify(session)).toString("base64");
        console.log(`qab-shopper-auth=base64-${b64}; qab-shopper-hint=1`);
      });
    ' 2>/dev/null)

    # Sanidad: confirma que ESTE JWT en concreto lo rechaza el emulador por
    # caducado (no por cualquier otra razón), antes de usarlo en un pedido.
    EXPIRED_ACCESS_TOKEN=$(node -e "
      const c = process.argv[1];
      const m = /qab-shopper-auth=base64-([^;]+)/.exec(c);
      const session = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
      console.log(session.access_token);
    " "$EXPIRED_COOKIE")
    EXPIRED_SANITY=$(curl -s "$SUPABASE_URL/auth/v1/user" -H "apikey: $ANON_KEY" \
      -H "Authorization: Bearer $EXPIRED_ACCESS_TOKEN")
    if echo "$EXPIRED_SANITY" | grep -q 'token is expired'; then
      printf '  ok   sesión caducada — el emulador la rechaza por EXPIRACIÓN, no por firma (sanidad previa)\n'
    else
      printf 'SMOKE FAIL sesión caducada — el emulador no la rechazó por expiración: %s\n' "$EXPIRED_SANITY"
      FAILS=$((FAILS + 1))
    fi

    SUBTOTAL_EXP=$(quote_subtotal "$R14_PRODUCT_ID")
    PHONE_EXP="+53$(date +%s)exp"
    ORDER_BODY_EXP=$(node -e '
      console.log(JSON.stringify({
        storeSlug: "tienda-demo",
        items: [{ storeProductId: process.argv[1], qty: 1 }],
        contact: { name: "Smoke sesion caducada", phone: process.argv[2] },
        fulfillment: "PICKUP",
        expectedTotal: process.argv[3],
      }));
    ' "$R14_PRODUCT_ID" "$PHONE_EXP" "${SUBTOTAL_EXP:-0.00}")

    EXP_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/orders" \
      -H 'content-type: application/json' -H "Cookie: $EXPIRED_COOKIE" -d "$ORDER_BODY_EXP")
    EXP_STATUS=$(echo "$EXP_RESPONSE" | tail -n1)
    EXP_CODE=$(order_code_from_response "$(echo "$EXP_RESPONSE" | head -n1)")
    check 'criterio 4/D6 — pedido con sesión CADUCADA (JWT real, exp pasado) sigue en 201 (E17)' 201 "$EXP_STATUS"

    if [ -n "$EXP_CODE" ]; then
      EXP_ORDER_CUSTOMER_ID=$(order_customer_id "$EXP_CODE")
      if [ -z "$EXP_ORDER_CUSTOMER_ID" ]; then
        printf '  ok   criterio 4/D6 — Order.customerId quedó NULL con la sesión caducada (E17)\n'
      else
        printf 'SMOKE FAIL criterio 4/D6 — Order.customerId = %s con sesión caducada (debía ser NULL)\n' "$EXP_ORDER_CUSTOMER_ID"
        FAILS=$((FAILS + 1))
      fi
    else
      printf 'SMOKE FAIL criterio 4/D6 — no se pudo leer el code del pedido con sesión caducada\n'
      FAILS=$((FAILS + 1))
    fi
  fi
fi

# ============================================================================
# PARTE 2 — lo único que de verdad sigue necesitando un humano (o un
# `visual.mjs` con Playwright, que no se pidió en este ciclo)
# ============================================================================
cat <<'MANUAL'

-------------------------------------------------------------------------
MANUAL — criterio 3, el DOM ya relleno del checkout. Todo lo demás de este
criterio (perfil guardado, GET /api/account/profile con sesión trayéndolo de
vuelta) ya lo prueba la Parte 1 de arriba. Lo único que queda es mirar la
pantalla, porque `CheckoutForm.tsx` rellena los tres campos EN EL CLIENTE
tras hidratar (un `fetch("/api/account/profile")` en un efecto) — no hay
nada de eso en el HTML que `curl` pueda leer.

  1. Con una sesión creada por el bloque de arriba (o
     `node scripts/auth-otp.mjs --mode app --cookie-jar <archivo>` a mano) y
     un perfil guardado (`PUT /api/account/profile`), abre
     /tienda-demo/checkout con el carrito con al menos un producto, usando
     esa MISMA cookie en el navegador.
  2. ASERTO — los tres campos de contacto aparecen YA rellenos con el
     perfil guardado, sin teclear nada, y el pedido se puede confirmar así.

Esto se verificó ya, real, en este ciclo (ver tests.md): sesión creada por
`scripts/auth-otp.mjs --mode app`, perfil guardado desde /cuenta, y
/tienda-demo/checkout con los tres campos rellenos, capturado con el
navegador conectado. No se automatiza aquí porque haría falta Playwright
(no pedido para este ciclo) y el repo ya separa esa clase de verificación en
`.agent/specs/<ID>/visual.mjs` (`bash .agent/verify.sh <ID> --visual`), no en
`smoke.sh`.
-------------------------------------------------------------------------
MANUAL

printf '\n%d aserciones automatizadas fallidas (la Parte 2 no cuenta aquí)\n' "$FAILS"
[ "$FAILS" -eq 0 ]
