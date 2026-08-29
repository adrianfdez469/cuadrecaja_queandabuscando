---
feature: F-012
agente: sdd-implementer
actualizado: 2026-08-29T15:53:19Z
estado: listo
---

## Qué se construyó

Los once pasos de `plan.md`, en su orden, con `bash .agent/verify.sh F-012`
en 0 al final de cada uno.

| Archivo                                                                                              | Qué hace                                                                                                                                                                                                                                           | Paso | Criterio  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------- |
| `src/constants/account.ts`                                                                           | Nombres de las dos cookies, timeouts (`PROFILE_FETCH_TIMEOUT_MS`, `ORDER_CUSTOMER_LINK_TIMEOUT_MS`), tope de cuerpo, longitud/intentos/cuenta atrás del código OTP                                                                                 | 1    | 5, 6      |
| `src/lib/safeNextPath.ts` (+ `.test.ts`)                                                             | `safeNextPath()`/`DEFAULT_NEXT` — pura, sin Zod                                                                                                                                                                                                    | 1    | 6, R7/E27 |
| `src/lib/supabase/config.ts`                                                                         | `isSupabaseAuthConfigured()`, sin Zod, apto para cliente                                                                                                                                                                                           | 1    | 6         |
| `src/features/account/types.ts`                                                                      | `AccountProfile`, `AccountState`, `OAuthProvider` — planos                                                                                                                                                                                         | 1    | 3         |
| `src/features/account/authErrors.ts`                                                                 | `CustomerAuthError` + `mapEmailOtpError`/`mapOAuthStartError`/`mapCodeExchangeError`                                                                                                                                                               | 1    | 1b, 5     |
| `src/features/account/schemas.ts` (+ `.test.ts`)                                                     | `accountProfileSchema` (R15), `sendOtpRequestSchema`, `verifyOtpRequestSchema`, `startOAuthRequestSchema`                                                                                                                                          | 1    | 1b, 3     |
| `src/lib/auth/customerSession.ts` (+ `.test.ts`)                                                     | El único módulo que lee/escribe la sesión de cliente y habla con Supabase Auth: `getCustomerUser`, `sendEmailOtp`, `verifyEmailOtp`, `startOAuth`, `exchangeCustomerCode`, `signOutCustomer`, `hasCustomerSessionCookie`, `refreshCustomerSession` | 2    | 1b, 5, 6  |
| `src/lib/supabase/server.ts` (modificado)                                                            | `cookieOptions.name = CUSTOMER_COOKIE`; devuelve `null` sin configuración en vez de lanzar                                                                                                                                                         | 2    | 5, 6      |
| `src/lib/supabase/client.ts` (modificado)                                                            | Mismo `cookieOptions.name` y guarda; sigue sin consumidores (DA5)                                                                                                                                                                                  | 2    | —         |
| `src/features/account/boundaries.test.ts`                                                            | Guarda de fronteras: `cookies()` fuera de `orders/`/`app/[slug]/`; solo 3 archivos + `storage.ts` importan `@supabase/*`; ningún `"use client"` los importa; `"slug"` fuera del `matcher`                                                          | 3    | 4, 5      |
| `src/features/account/server/customers.ts` (+ `.db.test.ts`)                                         | `ensureCustomerForUser` (idempotente, un `upsert`), `findCustomerIdByUserId`, `getProfileByUserId`, `updateProfileByUserId`                                                                                                                        | 4    | 2         |
| `src/features/orders/server/prismaErrors.ts` (+ `.test.ts`, **fuera de alcance — ver Desviaciones**) | `isUniqueViolation` reconoce también la forma de error de Prisma 7 + `@prisma/adapter-pg` (sin `meta.target`)                                                                                                                                      | 4    | 2 (E8)    |
| `src/app/api/account/otp/route.ts` (+ `.test.ts`)                                                    | `POST`: `signInWithOtp`                                                                                                                                                                                                                            | 5    | 1b        |
| `src/app/api/account/otp/verify/route.ts` (+ `.test.ts`)                                             | `POST`: `verifyOtp` + `ensureCustomerForUser` (E5)                                                                                                                                                                                                 | 5    | 1b, 2     |
| `src/app/api/account/oauth/route.ts` (+ `.test.ts`)                                                  | `POST`: `signInWithOAuth` (`skipBrowserRedirect`), `redirectTo` con `safeNextPath`                                                                                                                                                                 | 5    | 1b        |
| `src/app/auth/callback/route.ts` (+ `.test.ts`)                                                      | Canjea el código, sanea `next`, `307` a destino o a `aviso=…`                                                                                                                                                                                      | 5    | 1b        |
| `src/app/api/account/logout/route.ts` (+ `.test.ts`)                                                 | `POST`: `signOutCustomer` → `303` a `/`                                                                                                                                                                                                            | 5    | 5         |
| `src/app/api/account/_lib/respond.ts`                                                                | `NO_STORE`, `readAccountJsonBody` (tope de 4 KB), `zodInvalidBody`, `authUnavailable`                                                                                                                                                              | 5    | —         |
| `src/app/api/account/profile/route.ts` (+ `.test.ts`)                                                | `GET` (siempre 200), `PUT` (identidad solo por sesión, R20)                                                                                                                                                                                        | 6    | 3         |
| `src/features/account/components/SignInCard.tsx` (+ `.test.tsx`)                                     | `/cuenta/entrar` completa: los dos pasos, 4 métodos, reenvío/cuenta atrás, intentos, avisos                                                                                                                                                        | 7    | 1b, 6     |
| `src/features/account/components/ProfileForm.tsx` (+ `.test.tsx`)                                    | `/cuenta`: editar, guardar, cerrar sesión                                                                                                                                                                                                          | 7    | 3         |
| `src/app/cuenta/entrar/page.tsx` (+ `.test.tsx`)                                                     | Sanea `next`/`aviso`, compone `SignInCard`; 200 sin Auth configurado (E26)                                                                                                                                                                         | 7    | 6         |
| `src/app/cuenta/page.tsx`                                                                            | Lee la sesión, asegura el `Customer`, redirige sin sesión (E24/E25)                                                                                                                                                                                | 7    | 3         |
| `src/features/account/accountStore.ts` (+ `.test.tsx`)                                               | `useSessionHint` (cookie de pista, sin red) y `getAccountProfile` (fetch deduplicado)                                                                                                                                                              | 8    | 6         |
| `src/features/account/components/AccountBadge.tsx` (+ `.test.tsx`)                                   | Icono de cuenta, 3 estados, sin `@supabase/*`                                                                                                                                                                                                      | 8    | 6         |
| `src/app/[slug]/layout.tsx` (modificado)                                                             | Monta `AccountBadge` en las tres cabeceras                                                                                                                                                                                                         | 8    | 6         |
| `src/features/cart/components/CheckoutForm.tsx` (modificado, + `.autocomplete.test.tsx`)             | Pide el perfil en paralelo con la cotización; `lo tecleado ?? lo del perfil ?? ""`; línea de estado + enlace `entra`                                                                                                                               | 9    | 3         |
| `src/features/account/server/orderIdentity.ts` (+ `.test.ts`)                                        | `resolveOrderCustomerId()` — nunca lanza, cortada a 600 ms                                                                                                                                                                                         | 10   | 2, 4      |
| `src/features/orders/server/createOrder.ts` (modificado, + asertos nuevos en `.test.ts`)             | Segundo argumento `customerLink`, `= Promise.resolve(null)` por defecto                                                                                                                                                                            | 10   | 4         |
| `src/app/api/orders/route.ts` (modificado)                                                           | Arranca `resolveOrderCustomerId()` antes de leer el cuerpo                                                                                                                                                                                         | 10   | 4         |
| `src/proxy.ts` (modificado, + `.test.ts`)                                                            | `matcher` + `/cuenta*`, `/auth*`; bifurcado por prefijo ANTES del redirect de admin                                                                                                                                                                | 11   | 4, 5      |
| `src/app/robots.ts` (modificado)                                                                     | `disallow` + `/cuenta`, `/auth`                                                                                                                                                                                                                    | 11   | —         |

## Desviaciones

**Ninguna de alcance.** Nada de lo de abajo añade una pantalla, un dato
guardado, una dependencia o una migración fuera de lo que `plan.md` firmó.
Dos desviaciones reales, más una decisión de interpretación:

1. **`src/features/orders/server/prismaErrors.ts` no estaba en la lista de
   los seis archivos que el plan autorizaba tocar** (`src/proxy.ts`,
   `src/app/[slug]/layout.tsx`, `src/app/robots.ts`, `CheckoutForm.tsx`,
   `createOrder.ts`, `src/app/api/orders/route.ts`). Lo toqué porque el paso 4 dejó
   al descubierto un bug real, no hipotético: con Prisma 7 +
   `@prisma/adapter-pg` (el conector que corre este repo, local y en
   producción), un `P2002` real contra Postgres **no** trae el `meta.target`
   clásico que `isUniqueViolation()` esperaba — el nombre de la columna vive
   anidado en `meta.driverAdapterError.cause.constraint.fields`, citado con
   comillas dobles literales. Sin el arreglo, la prueba de E8/R12 (dos
   primeros logins concurrentes) fallaba de verdad contra Postgres local: el
   `catch` de `ensureCustomerForUser` nunca reconocía la colisión y el error
   crudo se propagaba. El arreglo es una función nueva **añadida** al
   `if`/`else` existente — ningún camino que ya reconocía la forma clásica
   cambia — y de paso corrige el mismo hueco latente que ya tenía
   `createOrder.ts` para sus propias colisiones de `code`/`idempotencyKey`
   (nunca antes probado contra Postgres real, solo con errores mockeados a
   mano). Fichado: `.agent/playbook/prisma7-p2002-sin-meta-target-driver-adapter.md`.
   Los asertos existentes de `prismaErrors.test.ts` seguían intactos; añadí
   uno nuevo para la forma nueva.
2. **`.agent/playbook/jsdoc-glob-cierra-comentario-de-golpe.md`**: un bug
   mío propio, no una desviación de alcance, pero vale la pena que quien
   retome lo sepa — un comentario JSDoc con `` `features/*/server/` `` (un
   glob de ruta con `*` entre dos `/`) contiene literalmente `*/`, que cierra
   el comentario a mitad de frase y hace que `tsc`/`oxc` interpreten el
   resto del archivo como código. Arreglado reescribiendo la frase sin el
   patrón; fichado para que no vuelva a costar media hora de lectura de
   stack traces sin sentido.
3. **Interpretación, no desviación**: la guarda de fronteras (paso 3)
   permite que `src/lib/supabase/storage.ts` importe `@supabase/supabase-js`
   además de los tres archivos que `architecture.md` § Componentes nombra
   literalmente. Ese archivo es de F-011 (Storage de imágenes), no tiene
   nada que ver con Auth, y ya existía antes de este feature — la lectura
   literal de architecture.md se equivocó por omisión, no por diseño. La
   guarda real que importa para el presupuesto de JS —"ningún `"use client"`
   importa `@supabase/*`"— se mantiene sin excepciones.

Dos notas de implementación que no se deducen leyendo el código:

- **`mapEmailOtpError` mapea el código `otp_expired` de Supabase a nuestro
  `"invalid"`, no a `"expired"`.** GoTrue devuelve ese mismo código tanto
  para un dígito mal tecleado como para un código realmente caducado o ya
  usado — no los distingue del lado del servidor. Elegí `"invalid"` porque
  es el caso común (un tecleo torcido) y porque el contador de intentos de
  `SignInCard` es quien decide el estado terminal después de tres fallos,
  independientemente del motivo exacto. `mapCodeExchangeError` (la vuelta de
  OAuth, un código totalmente distinto) sigue mapeando a `"expired"` por
  defecto. Quien verifique el criterio 1a contra un Supabase real debería
  confirmar que este mensaje se siente correcto con un código de verdad
  caducado.
- **`ProviderButton` y `AccountTopBar`**, que `design.md` § Componentes de UI
  nombra como piezas propias, viven inline dentro de `SignInCard.tsx` y de
  cada `page.tsx` de cuenta respectivamente, no como archivos separados. El
  plan (paso 7) solo nombra `SignInCard.tsx` y `ProfileForm.tsx`; nada de lo
  que hacen esas dos piezas necesita reutilizarse en otro sitio hoy.

## Plan B de PP2 (canje PKCE)

**No se aplicó.** El entorno de este worktree sigue sin Supabase Auth
configurado (PP3: eso lo deja el humano antes de que llegue `sdd-tester`), así
que el canje PKCE iniciado en el servidor (DA5) nunca se ejecutó contra un
proyecto real — ni falló ni tuvo ocasión de fallar. Se implementó y se
verificó la opción (c) tal como la firmó el plan: `signInWithOAuth` con
`skipBrowserRedirect: true` y `exchangeCodeForSession` desde
`lib/auth/customerSession.ts`, con el `cookieOptions.name` confirmado leyendo
`node_modules/@supabase/ssr/dist/main/createServerClient.js` (mapea a
`auth.storageKey`, tal como architecture.md afirma) y con pruebas mockeadas
para las rutas y el callback (criterio 1b). El plan B queda preautorizado y
sin usar; si el canje falla la primera vez que se pruebe contra Supabase real
(criterio 1a, trabajo de `sdd-tester`/el humano), aplicarlo es la opción (b)
descrita en `architecture.md` § DA5 y `design.md` § Coste de cliente.

## Comandos ejecutados

- `npm run typecheck` → 0
- `npm run lint` → 0
- `npm run format:check` → 0 (tras `npm run format` en cada punto de control;
  ficha `prettier-sin-formatear`, ya conocida)
- `npm test` → 0, 71+ archivos, ~700 pruebas (incluye el proyecto `db` contra
  Postgres local: `customers.db.test.ts`)
- `npx prisma validate` → 0. Ninguna migración nueva; `Customer.supabaseUserId`
  y `Order.customerId` ya existían.
- `npm run build` → 0. `/[slug]` sigue `●`, `/[slug]/checkout` sigue `ƒ`.
- `npm run check:theme` → 0
- `npm run check:bundle` → **0**, página más pesada
  `bodega-central/p/agua-natural-500-ml.html`, **177,6 KB gzip** contra el
  presupuesto de 193 KB (15,4 KB libres). No hizo falta tocar `BUDGET_KB`.
- `bash .agent/verify.sh F-012 --full` → **0**
- `bash .agent/verify.sh pending F-012` → vacío
- `git grep -n "cookies()" src/features/orders/ "src/app/[slug]/"` → vacío
  (F-010 fila 4 sigue verde, ahora también como prueba permanente en
  `boundaries.test.ts`)
- `grep -n "slug" src/proxy.ts` → nada dentro del `matcher`

## Deuda dejada

- **La confirmación "Si entras ahora se pierde lo que escribiste aquí" del
  checkout (design.md § 5, última fila)** está implementada de forma
  funcional pero visualmente más simple que el diseño (un texto en línea con
  dos enlaces/botón, no el patrón exacto de `¿Vaciar el carrito?` de F-010).
  No tiene prueba propia — E12-E16, que sí exige el paso, están cubiertas.
  Quien pula la interfaz de cuenta puede alinear esta pieza al patrón exacto
  sin tocar ningún contrato.
- **El foco y los anuncios de `SignInCard` cubren los casos centrales**
  (cambio de paso, código agotado, reenvío) pero no los 12 estados de
  `design.md` § 2 uno por uno con su propia prueba — algunos textos de aviso
  menores (p. ej. la variante exacta de "demasiados envíos" en el paso de
  reenvío) están implementados pero no tienen un test dedicado.
- **`mapEmailOtpError`** (ver Desviaciones) es la pieza con más
  incertidumbre real: su mapeo de `otp_expired` es una decisión razonada
  pero no verificada contra Supabase de verdad. Es exactamente lo que el
  criterio 1a de `sdd-tester` va a ejercitar primero.

## Qué necesita quien pruebe

- **El entorno de Supabase Auth (PP3) sigue sin configurar en este
  worktree** — es responsabilidad del humano, no mía, y no bloqueaba
  implementar. Antes del criterio 1a hace falta: `NEXT_PUBLIC_SUPABASE_URL`
  y `NEXT_PUBLIC_SUPABASE_ANON_KEY` reales en `.env`, los providers `google`,
  `facebook` y `apple` habilitados, `<NEXT_PUBLIC_SITE_URL>/auth/callback`
  en las _Redirect URLs_, y la plantilla de correo con `{{ .Token }}` (si no,
  llega un enlace mágico y el paso 2 de `/cuenta/entrar` no tiene nada que
  teclear).
- **Rutas para probar a mano**: `/cuenta/entrar` (los cuatro métodos),
  `/cuenta` (perfil, requiere sesión), `/auth/callback` (nunca a mano, solo
  como destino de un proveedor real), `/[slug]/checkout` con y sin sesión.
- **Lo más frágil**: el mapeo de errores de Supabase en `authErrors.ts` — ver
  Deuda dejada — y el canje PKCE de DA5, que solo se ha verificado leyendo el
  código de `@supabase/auth-js`, nunca ejecutándolo.
- **`npx prisma migrate status`** debería seguir sin reportar nada
  pendiente — no se planificó ninguna migración.

## Preguntas al humano

Ninguna. Las tres decisiones que el plan me dejó (PP1-PP3) se resolvieron tal
como quedaron escritas: PP1 no se tocó, PP2 no hizo falta aplicarlo (arriba),
PP3 no bloqueó nada de lo que construí.
