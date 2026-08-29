#!/usr/bin/env bash
# Verificación en runtime de F-012 (cuenta opcional del cliente final). La
# ejecuta `bash .agent/verify.sh F-012 --smoke` con `next dev` ya levantado
# en $SMOKE_BASE_URL, sobre la BASE DE DATOS REAL (DATABASE_URL/DIRECT_URL,
# nunca `prisma migrate reset`/`db push` — AGENTS.md § Comandos prohibidos).
#
# Este feature tiene un bloqueo de ENTORNO documentado en spec.md I7 y en
# `.agent/progress/F-012.md` § Bloqueado por: `.env` no trae credenciales de
# un proyecto Supabase con Auth real (`NEXT_PUBLIC_SUPABASE_URL` apunta al
# emulador de Storage local, que no habla Auth — confirmado:
# `curl http://localhost:54321/auth/v1/user` → 404 de nginx, sin ninguna ruta
# de Auth detrás). Sin eso, NINGÚN script puede producir una sesión de
# Supabase que `supabase.auth.getClaims()` acepte como válida: para un JWT
# HS256 (el caso normal) siempre hace una llamada de red real a
# `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/user` (verificado leyendo
# node_modules/@supabase/auth-js/dist/module/GoTrueClient.js, función
# getClaims()) — no hay forma de falsificarla sin un backend de Auth real, y
# fabricar uno sería simular el criterio, exactamente lo que el encargo de
# este ciclo pide no hacer.
#
# Por eso este guion tiene DOS partes:
#   1. Automatizada: todo lo que criterios 2, 3, 4, 5 y 6 permiten ejercitar
#      SIN una sesión de Supabase verificada — que es casi todo, porque D6/R14
#      exige explícitamente que resolver la identidad nunca bloquee ni haga
#      fallar el pedido (E17), así que "sesión presente pero irresoluble" es
#      un camino real y probable, no un atajo de la prueba.
#   2. Manual, marcada con "MANUAL —": el criterio 1a (correo de punta a
#      punta) y las dos mitades de otros criterios que solo existen con una
#      sesión de Supabase realmente verificada (el autocompletado end-to-end
#      del criterio 3, y la mitad "/cuenta responde 200" del criterio 5).
#
# Da por hecho que `npm run seed` ya corrió: tienda-demo tiene al menos un
# producto disponible.
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

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }

# ============================================================================
# PARTE 1 — automatizada, sin sesión de Supabase real
# ============================================================================

# --------------------------------------------------- criterio 6 (E26) ------
# El estado REAL de este worktree hoy: NEXT_PUBLIC_SUPABASE_URL apunta al
# emulador de Storage, no vacío — así que esto verifica el camino "Auth
# configurado mal", no el "Auth vacío" exacto de la spec. Esa forma exacta
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

# -------------------------------------------- criterio 4/R14 — inyección ---
# Manda customerId en el cuerpo, en la query y en una cabecera: los tres se
# ignoran. Necesita un producto orderable real — lo saca de la base con un
# `node` suelto (mismo patrón que scripts/place-order.mjs) en vez de psql,
# para no necesitar DATABASE_URL exportado en el shell del smoke.
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
  printf 'SMOKE FAIL R14 — no se encontró producto orderable en tienda-demo (¿corrió npm run seed?)\n'
  FAILS=$((FAILS + 1))
else
  QUOTE=$(body -X POST "$BASE/api/orders/quote" -H 'content-type: application/json' \
    -d "{\"storeSlug\":\"tienda-demo\",\"items\":[{\"storeProductId\":\"$R14_PRODUCT_ID\",\"qty\":1}]}")
  SUBTOTAL=$(node -e "console.log(JSON.parse(process.argv[1]).subtotal)" "$QUOTE" 2>/dev/null)
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
  R14_CODE=$(echo "$R14_RESPONSE" | head -n1 | node -e "
    let d='';process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{console.log(JSON.parse(d).code ?? '')}catch{console.log('')}});
  ")

  check 'R14 — POST /api/orders con customerId inyectado sigue en 201' 201 "$R14_STATUS"

  if [ -n "$R14_CODE" ]; then
    R14_CUSTOMER_ID=$(node -e '
      import("dotenv/config").then(async () => {
        const { Client } = await import("pg");
        const db = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
        await db.connect();
        const { rows } = await db.query(`SELECT "customerId" FROM "Order" WHERE code = $1`, [process.argv[1]]);
        await db.end();
        console.log(rows[0]?.customerId ?? "");
      });
    ' "$R14_CODE" 2>/dev/null)
    if [ -z "$R14_CUSTOMER_ID" ]; then
      printf '  ok   R14 — Order.customerId quedó NULL pese al customerId inyectado (cuerpo/query/cabecera ignorados)\n'
    else
      printf 'SMOKE FAIL R14 — Order.customerId = %s (debía ser NULL: la inyección NO se ignoró)\n' "$R14_CUSTOMER_ID"
      FAILS=$((FAILS + 1))
    fi
  else
    printf 'SMOKE FAIL R14 — no se pudo leer el code del pedido creado\n'
    FAILS=$((FAILS + 1))
  fi
fi

# ---------------------------------------------- criterio 2/4 — E17 real ----
# Una cookie de sesión PRESENTE pero irresoluble (no hay backend de Auth real
# que la verifique) es justo lo que produce este entorno para CUALQUIER valor
# no vacío de qab-shopper-auth: demuestra el camino real de E17 (nunca
# bloquea el pedido) sin necesitar simular una sesión válida.
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
  ' "${R14_PRODUCT_ID:-}" "${SUBTOTAL:-0.00}")" 2>/dev/null)
check 'E17 — pedido con cookie de sesión irresoluble sigue en 201 (nunca bloquea)' 201 "$E17_STATUS"

# ---------------------------------------------------------- criterio 3 -----
GET_PROFILE=$(body "$BASE/api/account/profile")
echo "$GET_PROFILE" | grep -q '"signedIn":false' &&
  printf '  ok   GET /api/account/profile sin sesión: signedIn:false, nunca un error\n' ||
  { printf 'SMOKE FAIL GET /api/account/profile sin sesión no respondió signedIn:false — %s\n' "$GET_PROFILE"; FAILS=$((FAILS + 1)); }

check '/[slug]/checkout responde 200 con una cookie de sesión irresoluble presente' 200 \
  "$(code "$BASE/tienda-demo/checkout" -H 'Cookie: qab-shopper-auth=smoke-garbage-session')"

# ---------------------------------------------------------- criterio 5 -----
# R21 (nombres de cookie) y la mitad "logout de cliente no toca la cookie de
# admin" se demuestran con cookies fabricadas — el borrado de
# signOutCustomer() decide por NOMBRE de cookie, nunca por identidad, así
# que no hace falta que ninguna de las dos sea una sesión real.
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

# La mitad "/admin y /cuenta responden 200 a la vez" necesita una sesión de
# admin REAL (JWT firmado con ADMIN_SESSION_SECRET) — solo posible si el
# entorno actual tiene SSO_JWT_SECRET/ADMIN_SESSION_SECRET/CRON_SECRET
# rellenos (ficha env-optional-secreto-vacio-rompe-serverenv: `.env.example`
# los deja en "", lo que hace que serverEnv() lance y getAdminSession()
# devuelva null pase lo que pase). Si no están, se avisa y NO se cuenta como
# fallo: es un hueco de entorno ajeno a F-012, no algo que este feature rompió.
ADMIN_SECRET_LEN=$(grep -E '^ADMIN_SESSION_SECRET=' .env 2>/dev/null | sed -E 's/^ADMIN_SESSION_SECRET="?([^"]*)"?$/\1/' | wc -c)
if [ "${ADMIN_SECRET_LEN:-0}" -gt 32 ]; then
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
  ADMIN_STATUS=$(code "$BASE/admin" -H "Cookie: qab-admin-session=$ADMIN_JWT; qab-shopper-hint=1")
  check 'criterio 5 — /admin en 200 con una cookie de cliente (hint) presente a la vez' 200 "$ADMIN_STATUS"
  curl -s -o /dev/null -X POST "$BASE/api/account/logout" -H "Cookie: qab-admin-session=$ADMIN_JWT; qab-shopper-hint=1"
  ADMIN_STATUS_AFTER=$(code "$BASE/admin" -H "Cookie: qab-admin-session=$ADMIN_JWT")
  check 'criterio 5 — /admin sigue en 200 tras cerrar la sesión de cliente' 200 "$ADMIN_STATUS_AFTER"
else
  printf '  ..  criterio 5 — /admin+/cuenta en vivo: SALTADO, ADMIN_SESSION_SECRET/SSO_JWT_SECRET/CRON_SECRET no están rellenos en .env (ficha env-optional-secreto-vacio-rompe-serverenv). No cuenta como fallo de F-012.\n'
fi

# ============================================================================
# PARTE 2 — MANUAL, bloqueada por I7: sin un proyecto Supabase de Auth real
# ============================================================================
cat <<'MANUAL'

-------------------------------------------------------------------------
MANUAL — criterio 1a (correo, de punta a punta). Necesita en .env:
  NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY de un proyecto
  Supabase de DESARROLLO con Auth habilitado, el provider "email" activo, y
  la plantilla de correo de "Magic Link"/"OTP" editada para incluir
  {{ .Token }} (si no, llega un enlace en vez de un código de 6 dígitos y el
  paso 2 de abajo no tiene nada que teclear — D5/R3).

  1. npm run dev (o confirma que ya hay uno de ESTE worktree — comprueba con
     `lsof -a -p <pid> -d cwd -Fn`, ficha next-dev-uno-por-directorio: el
     next dev del puerto 3000 de esta máquina NO es de este worktree).
  2. Abre http://localhost:<puerto>/cuenta/entrar en un navegador.
  3. Escribe el correo de una bandeja que controles y pide el código.
  4. ASERTO 1 — llega un correo con un código de 6 dígitos (no un enlace).
  5. Teclea el código en la misma pestaña.
  6. ASERTO 2 — el navegador acaba en /cuenta.
  7. ASERTO 3 — /cuenta muestra el perfil (nombre/correo sembrados si el
     proveedor los trae; teléfono vacío, R9).
  8. ASERTO 4 — antes y después, la cuenta de filas sube en exactamente 1:
       node -e '
         import("dotenv/config").then(async()=>{
           const {Client}=await import("pg");
           const db=new Client({connectionString:process.env.DIRECT_URL});
           await db.connect();
           const {rows}=await db.query(
             `select count(*) from "Customer" where "supabaseUserId" is not null`);
           console.log(rows[0].count);
           await db.end();
         });'
     Corre este comando ANTES del paso 3 y DESPUÉS del paso 6; la diferencia
     tiene que ser exactamente 1.

MANUAL — criterio 3, de punta a punta (con sesión REAL del bloque anterior):
  1. Con la sesión del bloque de arriba todavía viva en el mismo navegador,
     guarda un perfil completo en /cuenta (nombre, teléfono, correo).
  2. Abre /tienda-demo/checkout con el carrito con al menos un producto.
  3. ASERTO — los tres campos de contacto aparecen YA rellenos con el
     perfil guardado, sin teclear nada, y el pedido se puede confirmar así.

MANUAL — criterio 5, la mitad que necesita una sesión de cliente REAL:
  1. En el MISMO navegador de los dos bloques de arriba (sesión de cliente
     viva), abre también /admin con una sesión de admin real (SSO real de
     cuadrecaja, o el JWT fabricado que monta la Parte 1 automatizada si
     ADMIN_SESSION_SECRET está relleno).
  2. ASERTO — /admin y /cuenta responden 200 A LA VEZ (dos pestañas, mismo
     navegador, mismas cookies).
  3. Cierra sesión desde /cuenta ("Cerrar sesión").
  4. ASERTO — /admin, recargada, SIGUE en 200 (la sesión de admin no se
     tocó).
-------------------------------------------------------------------------
MANUAL

printf '\n%d aserciones automatizadas fallidas (la Parte 2 es manual y no cuenta aquí)\n' "$FAILS"
[ "$FAILS" -eq 0 ]
