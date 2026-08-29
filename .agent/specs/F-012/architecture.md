---
feature: F-012
agente: sdd-architect
actualizado: 2026-08-29T05:05:00Z
estado: listo
---

> **Convención de rutas.** Un archivo que todavía no existe se escribe **sin
> comillas invertidas** y con `(por crear)` detrás (`AGENTS.md` § Cosas que
> muerden). En este documento eso es casi todo: una arquitectura nombra el
> edificio que aún no está construido. Cuando el implementador los cree, ganan
> sus comillas.

## Estado actual relevante

Lo que ya existe y se reutiliza **tal cual**:

| Pieza                                           | Estado hoy                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/supabase/server.ts`                    | `createSupabaseServerClient()` sobre `createServerClient` + `cookies()`. **Nadie lo importa todavía**: F-012 es su primer consumidor.                                                           |
| `src/lib/supabase/client.ts`                    | `createSupabaseBrowserClient()`. También sin consumidores — y F-012 **no** lo estrena (DA5).                                                                                                    |
| `src/lib/auth/adminSession.ts`                  | El modelo a imitar: `ADMIN_COOKIE` exportada, tres funciones, un solo sitio que lee la cookie.                                                                                                  |
| `src/lib/env.ts`                                | `publicEnv.supabaseUrl` / `supabaseAnonKey` caen a `""` cuando faltan. Importa `zod`: **no se puede importar desde cliente**.                                                                   |
| `src/proxy.ts`                                  | `matcher` = `/admin` y `/admin/:path((?!sso).*)`. Sin cookie de admin → `307` a `/?admin=sesion-requerida`.                                                                                     |
| `src/lib/slug.ts`                               | `cuenta`, `auth`, `login` y `logout` ya están en `RESERVED_SLUGS`. Nada que añadir.                                                                                                             |
| `src/features/orders/server/createOrder.ts`     | Un único `prisma.order.create` con `customerId: null` fijo. Sin `$transaction`. Recibe por argumento todo lo que escribe.                                                                       |
| `src/app/api/orders/route.ts`                   | `dynamic = "force-dynamic"`. Valida con `createOrderRequestSchema` y llama a `createOrder(parsed.data)`. **No lee cookies.**                                                                    |
| `src/features/orders/contact.ts`                | `normalizeName` / `normalizePhone`, puras. Su comentario ya anuncia que F-012 las reutiliza.                                                                                                    |
| `src/constants/orders.ts`                       | Los cinco límites de contacto que R15 manda compartir.                                                                                                                                          |
| `src/features/cart/components/CheckoutForm.tsx` | Isla de cliente que ya hace `fetch` a `/api/orders/quote` y a `/api/orders`. Sin `credentials`: el navegador ya manda las cookies del mismo origen.                                             |
| `src/features/cart/cartStore.ts`                | El patrón de estado de cliente del repo: un módulo + `useSyncExternalStore`, `getServerSnapshot()` estable, almacenamiento leído fuera del render.                                              |
| `src/lib/httpJson.ts`                           | `readJsonBody(request, { maxBytes })` + `serializableIssues(zodError)`, lo que ya usan las rutas del panel.                                                                                     |
| `src/features/orders/server/prismaErrors.ts`    | `isUniqueViolation(error, campo)` — genérica, se reutiliza para `supabaseUserId`.                                                                                                               |
| `prisma/schema.prisma`                          | `Customer.supabaseUserId String? @unique`, `Order.customerId String?` y `@@index([customerId])`. **Nada que migrar.**                                                                           |
| `@supabase/ssr` 0.12.5                          | `cookieOptions.name` fija el `storageKey` en los dos clientes; con URL o key vacías **lanzan**; el verificador PKCE se guarda por el mismo adaptador de cookies (verificado en `node_modules`). |

Las restricciones duras, comprobadas en la fuente y no de memoria:

1. **`.agent/specs/F-010/tests.md`, fila 4** ejecuta
   `git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"` y exige que
   no devuelva nada. F-010 está cerrado con `passes: true`. Hoy `cookies()` solo
   aparece en `src/lib/auth/adminSession.ts` y `src/lib/supabase/server.ts`.
2. El `matcher` de `src/proxy.ts` **jamás** toca `/[slug]`
   (`.agent/playbook/proxy-matcher-anula-isr.md`).
3. El pooler corre en modo transacción: ninguna query del cliente global dentro
   de un `$transaction` (`.agent/playbook/pooler-transaccion-deadlock.md`).
4. `export const revalidate` tiene que ser un **literal**
   (`.agent/playbook/revalidate-no-literal.md`).
5. `scripts/check-bundle-budget.mjs` mide la **página prerenderizada más
   pesada**: hoy 176,9 KB gzip contra 193. `sdd-designer` midió que un módulo de
   navegador que solo importa `createBrowserClient` pesa **61,2 KB gzip**. Ese
   número decide DA5.
6. `.test.ts` → proyecto `node`; `.test.tsx` → `ui` (jsdom); `.db.test.ts` →
   `db`, contra Postgres real.

## Decisión

**Forma general.** Un feature nuevo, `src/features/account/`, con su `server/`
para lo único que toca Prisma; un módulo de sesión, lib/auth/customerSession.ts
(por crear), que es el **único** sitio donde se lee o se escribe la sesión de
cliente y **el único** que habla con Supabase Auth; tres pantallas y seis rutas
de API fuera del slug; y **dos** puntos de contacto con lo ya construido, los dos
fuera de los árboles que vigila F-010: `src/app/api/orders/route.ts` (resuelve la
identidad) y `src/features/cart/components/CheckoutForm.tsx` (pide el perfil por
HTTP). El catálogo no se entera de que existe una sesión, y ni un byte de
`@supabase/*` llega al navegador.

### DA1 — El perfil se lee por HTTP desde la isla que ya existe (NC2)

`GET /api/account/profile` (por crear en src/app/api/account/profile/route.ts).
La isla `CheckoutForm` lo pide **al montar**, en paralelo con la cotización que
ya pide, y lo aplica solo a los campos que sigan siendo «todavía nada» (la
derivación en render de `design.md` § 5). El servidor de `/[slug]/checkout` no
lee la sesión, no la espera y no la conoce: R18 y la fila 4 de F-010 se cumplen
por construcción, no por disciplina.

- **Momento**: en el mismo efecto de montaje que hoy dispara `fetchQuote`,
  diferido con `setTimeout(…, 0)` por la misma razón que aquél (regla
  `react-hooks/set-state-in-effect`, ficha `set-state-en-efecto-prohibido`).
- **Si tarda**: nada. El formulario es usable desde el primer frame (R17); lo que
  llegue tarde solo rellena lo que siga vacío (E13).
- **Si falla** (500, red, Auth caído): silencio, sin reintento (E16, E17).
- **Timeout**: `AbortController` a `PROFILE_FETCH_TIMEOUT_MS` (3000).
- Alternativas descartadas: leerlo en `src/app/[slug]/checkout/page.tsx`
  (**rompe la fila 4 de F-010**, el único límite innegociable de I4); pasarlo por
  el HTML del layout (es ISR: R11); una cookie con el perfil en claro (dato
  personal en cada petición al CDN, y R19 lo prohíbe).

### DA2 — El `customerId` lo resuelve la ruta y viaja como promesa a `createOrder`

`src/app/api/orders/route.ts` **no está** en ninguno de los dos árboles que
vigila el grep de F-010, y `createOrder` ya recibe por argumento todo lo que
escribe. Verificado leyendo los dos archivos. Entonces:

1. La ruta arranca la resolución de identidad **antes** de leer el cuerpo, sin
   `await`: `const customerLink = resolveOrderCustomerId();`
2. Pasa la promesa como segundo argumento: `createOrder(parsed.data, customerLink)`.
3. `createOrder` la espera **una sola vez, justo antes** del `prisma.order.create`
   —cuando ya gastó la búsqueda de tienda, la cotización y la consulta de
   idempotencia—, así que en el camino normal la identidad ya está resuelta y el
   pedido **no se retrasa** (R14).

Las tres condiciones de R14, una por una:

- **Sale solo de la sesión del servidor.** `createOrderRequestSchema` no declara
  `customerId` y `z.object` descarta las claves desconocidas: un `customerId` en
  el cuerpo no llega a `createOrder`, que recibe `parsed.data` y nunca el JSON
  crudo. La query y las cabeceras no se leen. Se prueba con un POST de invitado
  que lleve `customerId` en el cuerpo: el pedido sale con `null`.
- **Nunca impide ni retrasa.** `resolveOrderCustomerId()` **jamás rechaza** y
  siempre se resuelve en ≤ `ORDER_CUSTOMER_LINK_TIMEOUT_MS` (600 ms), por
  `Promise.race` contra un temporizador. Cualquier fallo —Auth caído, token
  caducado, Prisma lento— devuelve `null` (E17). Sin cookie de cliente se
  resuelve en 0 ms, sin tocar red ni base: el camino de invitado no paga nada.
- **No cambia lo que ve el POS.** `customerId` no aparece en
  `src/features/orders/server/pull.ts`, ni en `src/features/orders/types.ts`, ni
  en `docs/sync-contract.md`. Verificado.

Firma nueva, con valor por defecto para que **ningún** call site ni ninguna
prueba de F-010 cambie (su criterio 4 exige la suite «sin cambios en sus
asertos»):

```ts
export async function createOrder(
  body: CreateOrderRequest,
  /** Resolves to the signed-in shopper's Customer.id, or null. NEVER rejects. */
  customerLink: Promise<string | null> = Promise.resolve(null),
): Promise<CreateOrderResult>;
```

- Alternativas descartadas: resolver la identidad **antes** de llamar a
  `createOrder` y pasar un `string | null` (más simple, pero suma el viaje a
  Supabase en serie al camino crítico del pedido, que es justo lo que R14
  prohíbe); actualizar el `Order` después de crearlo (segunda escritura, y puede
  llegar tarde al `pull` del POS); que `createOrder` resuelva la identidad
  (metería `cookies()` en `src/features/orders/` y rompería F-010).

### DA3 — Dos cookies propias: `qab-shopper-auth` y `qab-shopper-hint`

**La de sesión.** `@supabase/ssr` escribe por defecto `sb-<ref>-auth-token`,
donde `<ref>` sale de `NEXT_PUBLIC_SUPABASE_URL`. **No sirve**: (a) el criterio 5
tiene que ser comprobable de forma estable y ese nombre depende de una variable
de entorno; (b) en el entorno del criterio 6 la URL es `""` y no hay `<ref>` del
que derivar nada; (c) sin nombre propio, `signOutCustomer` no puede saber qué
cookies son suyas (E4, R19). Se fija con `cookieOptions: { name: CUSTOMER_COOKIE }`
—los dos clientes de `@supabase/ssr` copian ese nombre a `auth.storageKey`,
verificado en `node_modules/@supabase/ssr/dist/main/`— con el valor
`"qab-shopper-auth"`:

- distinto de `ADMIN_COOKIE` (`"qab-admin-session"`) ✔ y ninguno prefijo del
  otro ✔ (R21);
- las cookies derivadas que escribe la librería —`qab-shopper-auth.0`,
  `qab-shopper-auth.1` (troceado, `utils/chunker.js`),
  `qab-shopper-auth-code-verifier` y `qab-shopper-auth-flow-<id>-code-verifier`
  (PKCE)— comparten **nuestro** prefijo y ninguna puede colisionar con la de
  admin;
- opciones: `httpOnly: true` (posible gracias a DA5), `path: "/"`,
  `sameSite: "lax"`, `secure` en producción.

**La pista de sesión** (`qab-shopper-hint`, valor `"1"`), que es la respuesta a
NC1. Es una cookie **sin credencial y sin dato personal**: solo dice «este
navegador tiene sesión». La escribe y la borra el mismo módulo que la sesión, en
los mismos tres momentos (entrar por código, entrar por proveedor, cerrar
sesión), y a diferencia de la de sesión **no es `httpOnly`**, porque su único
propósito es que el icono de la cabecera pueda saber en qué estado pintarse
**sin ir a la red y sin importar nada de `@supabase/*`**.

- `httpOnly: false`, `path: "/"`, `sameSite: "lax"`, `secure` en producción,
  `max-age` de `CUSTOMER_HINT_MAX_AGE_DAYS` (30).
- Tampoco es prefijo de `qab-admin-session` ni al revés, y la prueba del
  criterio 5 compara **las tres** constantes.
- **No es autoridad de nada.** Ninguna decisión de servidor la mira. Si miente
  —la sesión murió y la cookie sigue—, lo peor que pasa es que el icono lleve a
  `/cuenta` y `/cuenta` redirija a entrar, que es E25 tal cual. Se autocorrige en
  dos sitios: el proxy la borra cuando refresca y no hay sesión, y el store la
  borra cuando `/api/account/profile` responde `signedIn: false`.
- Alternativa descartada: una marca en `localStorage`. Con DA5 el acceso ocurre
  entero en el servidor, así que **no hay JavaScript en el momento de entrar** que
  pudiera escribirla, y la primera página de tienda tras entrar mostraría el
  estado equivocado.

**Dónde vive el literal.** Los tres nombres en src/constants/account.ts (por
crear) —que es donde `AGENTS.md` manda las cadenas mágicas—, y
lib/auth/customerSession.ts (por crear) los **reexporta verbatim**, así que
`import { CUSTOMER_COOKIE } from "@/lib/auth/customerSession"` funciona y R21 se
cumple al pie de la letra. La razón de no declararlos en el módulo de sesión es
mecánica: ese módulo toca `next/headers` y el store de cliente que lee la pista
no puede depender de él.

### DA4 — El refresco vive en `src/proxy.ts`, con el `matcher` ampliado y bifurcado

```ts
matcher: ["/admin/:path((?!sso).*)", "/admin", "/cuenta/:path*", "/cuenta", "/auth/:path*"];
```

y en el handler, **lo primero de todo**, una bifurcación por prefijo:

- `/admin*` → exactamente la lógica de hoy, sin tocar una línea;
- el resto (`/cuenta*`, `/auth*`) → `refreshCustomerSession(request, response)` y
  `NextResponse.next()`. **Nunca redirige**: quien no tiene sesión de cliente
  tiene que poder abrir `/cuenta/entrar`, y `/cuenta` decide por su cuenta (E24).
  Eso es I5, resuelto;
- `/[slug]` no entra en el `matcher` en ninguna forma, y un test de fronteras lo
  vigila.

**Por qué hace falta.** `/cuenta` es un Server Component: ahí `cookies().set()`
no puede escribir (el `try/catch` de `src/lib/supabase/server.ts` se lo traga a
propósito). Si el token de acceso caducó, `supabase-js` lo refresca en memoria y
**no puede guardar el refresh token rotado**; repetir eso pasado el intervalo de
reutilización de Supabase acaba invalidando la sesión de alguien que no hizo nada
malo. El proxy corre antes y escribe en la respuesta, así que la página recibe
cookies frescas y no tiene que refrescar nada. Con DA5 no hay cliente de
navegador que refresque en segundo plano, así que este es el **único** sitio
donde el refresco puede ocurrir de forma fiable.

**Qué cuesta.** El proxy llama a `supabase.auth.getSession()`, que lee la cookie
y **solo sale a la red si el token expiró** (`__loadSession` → `_callRefreshToken`,
verificado en `@supabase/auth-js`). No es `getUser()`: el proxy **no autoriza, no
decide y no lee identidad** —eso es siempre `getCustomerUser()`—, solo mantiene
la cookie viva y, de paso, borra la pista si ya no hay sesión. Coste en el 99%
de las peticiones a `/cuenta`: un parseo local. Y esas rutas ya son dinámicas: no
hay ISR que anular. `AGENTS.md` y la propia documentación de Next avisan de que
el proxy no es sitio para datos lentos; esto no lo es.

- Alternativas descartadas: **ningún refresco** (la sesión moriría a la hora y el
  Server Component podría invalidarla al refrescar sin poder persistir); **una
  ruta de API que refresca** (obliga a cada pantalla a acordarse de llamarla, que
  es el tipo de disciplina que este repo prefiere convertir en estructura).

### DA5 — Supabase Auth se llama **desde el servidor**; el navegador habla con nuestra API

Es la opción (c) que `sdd-designer` recomendó en su § Coste de cliente, y la
elijo por cuatro razones que se suman:

1. **0 KB de `@supabase/*` en el navegador**, contra 61,2 KB de la opción (a) y
   23,9 KB de la (b). El «error de una línea» que el diseño teme —que Supabase
   entre en el árbol de la cabecera y las páginas `●` pasen de 176,9 a ≈238 KB—
   deja de ser evitable por disciplina y pasa a ser **imposible**: ningún módulo
   de cliente importa nada de Supabase, y un test de fronteras lo prueba.
2. **La cookie de sesión puede ser `httpOnly`.** Con el flujo resuelto en el
   navegador no podría serlo (el cliente la escribe con `document.cookie`), y un
   token de comprador quedaría legible por cualquier JavaScript de la página.
3. **Nadie espera una descarga para entrar.** Con la opción (a), pulsar
   «Continuar con Google» descarga 61 KB **antes** de poder redirigir: en 3G son
   uno o dos segundos de botón que no hace nada. Aquí el toque es un `fetch` de
   ~200 bytes y la redirección sale enseguida.
4. **Las pantallas no cambian ni un píxel.** La isla `SignInCard` conserva todos
   sus estados —`aria-busy`, transición en sitio al paso «código» sin navegar,
   contador de intentos, cuenta atrás del reenvío, errores que no cuentan como
   intento—: lo único que cambia es a quién le habla el `fetch`.

Reparto exacto: la isla llama por `fetch` a rutas nuestras
(`/api/account/otp`, `/api/account/otp/verify`, `/api/account/oauth`); esas rutas
llaman a lib/auth/customerSession.ts (por crear); y ese módulo es el único que
usa `createSupabaseServerClient`. `signInWithOAuth` se invoca con
`skipBrowserRedirect: true` —en el servidor la librería solo redirige si detecta
navegador— y devolvemos su `data.url` para que la isla haga
`window.location.assign(url)`. El verificador PKCE queda guardado por el mismo
adaptador de cookies, que es lo que hace posible el canje posterior en
`/auth/callback` (verificado en `@supabase/auth-js/dist/main/lib/helpers.js`:
el verificador se persiste vía `this.storage`, que aquí son nuestras cookies).

- Consecuencia para el criterio 1b: el aserto «pulsar cada botón llama a
  `signInWithOAuth` una vez con su `provider` y su `redirectTo`» se verifica en
  **dos** archivos en vez de uno —un `.test.tsx` que comprueba que cada botón
  hace el `POST` con su `provider`, y un `.test.ts` que comprueba que la ruta
  llama a `signInWithOAuth` con ese `provider` y con
  `redirectTo === "<origen>/auth/callback?next=<destino codificado>"`—. El
  aserto es literalmente el mismo; cambia el archivo donde vive. `design.md`
  § Coste de cliente ya deja escrito que el contrato 1b «no dice desde qué lado
  se llama».
- Plan B si el canje PKCE diera problemas en producción: la opción (b), solo
  `@supabase/auth-js` en el navegador para OAuth, dejando el correo en el
  servidor. Cuesta 23,9 KB en una ruta `ƒ` y no cambia ninguna pantalla.
- `src/lib/supabase/client.ts` **se queda sin consumidores**. No se borra (no es
  alcance de F-012), pero se le añade el mismo `cookieOptions.name` y la guarda
  de configuración, para que quien lo estrene mañana no escriba cookies con otro
  nombre.

## Respuesta a las cinco necesidades de `design.md`

| NC  | Qué pedía la pantalla                                                  | Respuesta                                                                                                                                                       |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NC1 | Señal local y síncrona de «hay sesión», sin red y sin `@supabase/*`    | **Sí**: la cookie `qab-shopper-hint` (booleana, sin dato personal), leída por un módulo con `useSyncExternalStore`. **Cero peticiones por página de catálogo.** |
| NC2 | El perfil en el navegador en `/[slug]/checkout`, tras el primer render | **Sí**: `GET /api/account/profile` desde la isla (DA1). Tres cadenas planas o `null`; sin `id`, sin `supabaseUserId`, sin fechas.                               |
| NC3 | Desde qué lado se llama a Supabase Auth                                | **Opción (c)**, la recomendada: desde el servidor. 0 KB de `@supabase/*` en el navegador (DA5).                                                                 |
| NC4 | `/auth/callback`, ¿ruta o página?                                      | **Ruta** (`route.ts`), la recomendada. No hay pantalla de tránsito que construir.                                                                               |
| NC5 | `/cuenta` con el perfil ya resuelto en el servidor                     | **Sí**: la página lo lee en el servidor y lo pasa como prop. Sin estado «cargando».                                                                             |

Ninguna necesidad se resuelve por la variante que el diseñador marcó como peor,
así que **no hay pantalla que retocar**.

## Componentes

| Componente               | Capa                       | Responsabilidad                                                                                  | Archivo                                                       |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Sesión de cliente        | `src/lib/`                 | **El único** sitio que lee/escribe la sesión y el único que habla con Supabase Auth (R19, I6)    | lib/auth/customerSession.ts (por crear)                       |
| Constantes de cuenta     | `src/constants/`           | Los tres nombres de cookie, timeouts, tope de cuerpo, intentos del código                        | src/constants/account.ts (por crear)                          |
| Destino seguro           | `src/lib/`                 | `safeNextPath()` — R7/E27. Pura, sin Zod, usable en cliente y servidor                           | src/lib/safeNextPath.ts (por crear)                           |
| ¿Auth configurado?       | `src/lib/`                 | `isSupabaseAuthConfigured()` leyendo `process.env.NEXT_PUBLIC_*` sin Zod (criterio 6, E26)       | src/lib/supabase/config.ts (por crear)                        |
| Cliente de servidor      | `src/lib/`                 | Añade `cookieOptions.name` y devuelve `null` si no hay configuración                             | `src/lib/supabase/server.ts` (se modifica)                    |
| Cliente de navegador     | `src/lib/`                 | Ídem, aunque F-012 no lo use (DA5)                                                               | `src/lib/supabase/client.ts` (se modifica)                    |
| `Customer` en la base    | `features/account/server/` | `ensureCustomerForUser`, `getProfileByUserId`, `updateProfileByUserId`, `findCustomerIdByUserId` | src/features/account/server/customers.ts (por crear)          |
| Identidad para el pedido | `features/account/server/` | `resolveOrderCustomerId()`: sesión + `Customer.id`, con timeout y sin excepciones                | src/features/account/server/orderIdentity.ts (por crear)      |
| Esquemas                 | `features/*/schemas.ts`    | Zod del perfil y de las tres rutas de acceso, con los límites de `src/constants/orders.ts` (R15) | src/features/account/schemas.ts (por crear)                   |
| Tipos planos             | `src/features/account/`    | `AccountProfile`, `AccountState` — lo que cruza al navegador y nada más                          | src/features/account/types.ts (por crear)                     |
| Errores de Auth          | `src/features/account/`    | Código de Supabase → clave estable (`caducado`, `cancelado`, `sin-confirmar`, …)                 | src/features/account/authErrors.ts (por crear)                |
| Señal de sesión          | `src/features/account/`    | `useSyncExternalStore` sobre la cookie de pista + caché del perfil. **NC1**                      | src/features/account/accountStore.ts (por crear)              |
| Isla de acceso           | `src/features/account/`    | `SignInCard` de `design.md` §§ 1–2. `fetch` a rutas propias; **jamás** importa `@supabase/*`     | src/features/account/components/SignInCard.tsx (por crear)    |
| Isla del perfil          | `src/features/account/`    | Edita, envía el `PUT`, pinta los `issues` del servidor, cierra sesión                            | src/features/account/components/ProfileForm.tsx (por crear)   |
| Icono de cuenta          | `src/features/account/`    | `AccountBadge` de `design.md` § 0: se suscribe a la señal, sin red                               | src/features/account/components/AccountBadge.tsx (por crear)  |
| `/cuenta`                | `src/app/`                 | Lee la sesión, asegura el `Customer`, pinta el perfil; redirige sin sesión (E24/E25)             | src/app/cuenta/page.tsx (por crear)                           |
| `/cuenta/entrar`         | `src/app/`                 | Compone la isla; **200 siempre**, incluso sin Auth configurado (E26)                             | src/app/cuenta/entrar/page.tsx (por crear)                    |
| `/auth/callback`         | `src/app/`                 | Canjea el `code` y redirige. Sin pantalla (NC4)                                                  | src/app/auth/callback/route.ts (por crear)                    |
| Enviar el código         | `src/app/`                 | `POST`: `signInWithOtp`                                                                          | src/app/api/account/otp/route.ts (por crear)                  |
| Comprobar el código      | `src/app/`                 | `POST`: `verifyOtp` + `ensureCustomerForUser` (E5 por el camino del correo)                      | src/app/api/account/otp/verify/route.ts (por crear)           |
| Salir hacia un proveedor | `src/app/`                 | `POST`: `signInWithOAuth` con `skipBrowserRedirect`; devuelve `{ url }`                          | src/app/api/account/oauth/route.ts (por crear)                |
| Perfil por HTTP          | `src/app/`                 | `GET` (autocompletado) y `PUT` (guardar)                                                         | src/app/api/account/profile/route.ts (por crear)              |
| Cerrar sesión            | `src/app/`                 | `POST` → `303` a `/`                                                                             | src/app/api/account/logout/route.ts (por crear)               |
| Guarda de fronteras      | pruebas                    | Convierte en test permanente el grep de F-010, R19 y el «error de una línea» del diseño          | src/features/account/boundaries.test.ts (por crear)           |
| Proxy                    | `src/app/`                 | `matcher` ampliado y bifurcado (DA4)                                                             | `src/proxy.ts` (se modifica)                                  |
| Checkout                 | `src/features/cart/`       | Pide el perfil y rellena lo vacío (DA1)                                                          | `src/features/cart/components/CheckoutForm.tsx` (se modifica) |
| Creación del pedido      | `features/orders/server/`  | Acepta el segundo argumento y escribe `customerId` (DA2)                                         | `src/features/orders/server/createOrder.ts` (se modifica)     |
| Ruta del pedido          | `src/app/`                 | Resuelve la identidad y se la pasa (DA2)                                                         | `src/app/api/orders/route.ts` (se modifica)                   |
| Cabecera de tienda       | `src/app/`                 | Monta el icono junto a `CartBadge`, en las tres variantes de cabecera                            | `src/app/[slug]/layout.tsx` (se modifica)                     |
| Robots                   | `src/app/`                 | Añade `/cuenta` y `/auth` a `disallow`                                                           | `src/app/robots.ts` (se modifica)                             |

**Por qué `src/features/account/`**: la carpeta nombra lo que el comprador ve —su
cuenta—, igual que `cart` nombra el carrito y no `CartLine`. `server/` dentro de
ella es lo único que importa Prisma, que es la regla de la tabla de capas.

**Por qué la identidad del pedido vive en `features/account/` y no en
`features/orders/`**: porque necesita la sesión, y `src/features/orders/` no
puede verla ni de lejos (R18). El pegamento lo pone `src/app/api/orders/route.ts`,
que es exactamente lo que `AGENTS.md` dice que hace `src/app/`: **rutea y
compone**.

**Por qué el módulo de sesión vive en `src/lib/` aunque haga E/S**: por el mismo
precedente que `src/lib/auth/adminSession.ts`, y porque `docs/adr/0005` ya dice
que ese archivo y lib/auth/customerSession.ts (por crear) son los dos únicos
puntos donde se lee una sesión. Es la frontera de autenticación, no lógica de
dominio: no toca Prisma y no renderiza nada.

## Flujo de datos

### 1. Entrar con correo (E1, R3/D5)

1. `/cuenta/entrar` (servidor) sanea `next` con `safeNextPath()` y lo pasa como
   prop a la isla, junto con `authConfigured` y el `aviso` de la query.
2. La isla: `POST /api/account/otp { email }` → la ruta llama a
   `sendEmailOtp(email)` → `signInWithOtp({ email })`. La pantalla pasa al paso
   «código» **en sitio**, sin navegar (misma URL, mismo carrito).
3. `POST /api/account/otp/verify { email, token }` → `verifyEmailOtp` →
   `verifyOtp({ email, token, type: "email" })`. La ruta escribe las cookies de
   sesión y la pista, llama a `ensureCustomerForUser()` (**E5** por este camino) y
   devuelve `{ signedIn: true, profile }`.
4. La isla hace `window.location.assign(next)` — navegación dura, para que el
   destino se renderice ya con la cookie puesta (`design.md` § 2).

Los tres intentos de R5/E21 los cuenta la isla, tal como los describe el diseño:
el contador solo baja cuando el servidor responde «código incorrecto», nunca por
un fallo de red.

### 2. Entrar con un proveedor (E2, E3) — PKCE, canje en el servidor

1. `POST /api/account/oauth { provider, next }` → `startOAuth(provider, redirectTo)`
   con `redirectTo = "<origen de la petición>/auth/callback?next=<next codificado>"`
   y `skipBrowserRedirect: true`. El verificador PKCE queda en la cookie
   `qab-shopper-auth-code-verifier`. La ruta responde `{ url }`.
2. La isla hace `window.location.assign(url)`. Si la ruta responde
   `409 PROVIDER_DISABLED`, la isla pinta el aviso de E23 y los demás métodos
   siguen vivos.
3. El proveedor devuelve a `/auth/callback`, que:
   - con `error` en la query → `307` a `/cuenta/entrar?aviso=cancelado` (E20);
   - sin `code`, o con canje fallido → `307` a `/cuenta/entrar?aviso=caducado`
     (E19), sin sesión y sin `Customer`;
   - con canje bueno → `ensureCustomerForUser()` → `307` a `safeNextPath(next)`
     (R6, R7, E27).
4. Nunca hay pantalla intermedia (NC4).

### 3. Autocompletado del checkout (E12–E14, R17)

1. `CheckoutForm` monta → dos `fetch` en paralelo: la cotización de siempre y
   `GET /api/account/profile` a través de src/features/account/accountStore.ts
   (por crear), que **deduplica**: una sola petición por carga de página aunque
   haya dos islas suscritas.
2. La ruta: sin cookie de sesión → `{ signedIn: false, profile: null }` sin tocar
   red ni base. Con cookie → `getCustomerUser()` → `getProfileByUserId()`.
3. La isla guarda el perfil en el `.then` del `fetch` —un callback, no el cuerpo
   de un efecto— y pinta `lo tecleado ?? lo del perfil ?? ""` (`design.md` § 5).

### 4. Confirmar el pedido, con sesión (E28) y sin ella (E16)

```
POST /api/orders
 ├─ resolveOrderCustomerId()             ← arranca aquí, SIN await
 │    ├─ ¿hay cookie nuestra? no → null  (0 ms, 0 red, 0 SQL)
 │    ├─ getCustomerUser()               ← JWT verificado, normalmente en local
 │    └─ findCustomerIdByUserId(user.id) ← 1 SELECT por índice único
 ├─ readJsonBody + createOrderRequestSchema      (en paralelo con lo anterior)
 └─ createOrder(parsed.data, customerLink)
      ├─ tienda, mezcla, cotización, guarda de idempotencia   (2–4 round-trips)
      ├─ const customerId = await customerLink  ← ya resuelto en el caso normal
      └─ prisma.order.create({ data: { …, customerId } })
```

Todo lo que puede salir mal en la rama izquierda devuelve `null`; nada de esa
rama puede lanzar hacia arriba.

### 5. Cerrar sesión (E4, E18)

La isla hace `POST /api/account/logout` → `signOutCustomer()` →
`supabase.auth.signOut({ scope: "local" })` (la librería borra sus cookies por el
mismo adaptador) **más** un barrido explícito de las cookies cuyo nombre sea
`CUSTOMER_COOKIE` o empiece por `CUSTOMER_COOKIE + "."` o `+ "-"`, y el borrado
de `CUSTOMER_HINT_COOKIE`. `qab-admin-session` no entra en ese conjunto: no
empieza por `qab-shopper-auth` y no es prefijo suyo. Respuesta `303` a `/`, así
que también funciona desde un `<form method="post">` si el JavaScript falla.

### 6. El icono de la cabecera (D7, R23, E29, NC1)

`src/app/[slug]/layout.tsx` monta la isla junto a `CartBadge` y le pasa
`authConfigured` (calculado en el servidor, igual para todos, así que el HTML de
ISR sigue siendo uno solo). La isla arranca en «desconocido» —`getServerSnapshot()`
devuelve ese estado, como hace `cartStore` con el carrito vacío, así que no hay
_mismatch_ de hidratación— y al suscribirse lee la cookie de pista, **de forma
síncrona, sin red y sin Supabase**. El HTML cacheado no depende de nadie (R11) y
sin JavaScript se queda el enlace estático, que es lo que R23 permite como mínimo.

## Contratos

### La superficie pública de lib/auth/customerSession.ts (por crear)

```ts
export { CUSTOMER_COOKIE, CUSTOMER_HINT_COOKIE } from "@/constants/account"; // R19/R21

export type CustomerUser = {
  id: string; // Supabase user.id → Customer.supabaseUserId
  email: string | null;
  fullName: string | null; // user_metadata.full_name ?? user_metadata.name
};

export type CustomerAuthError =
  | "not_configured" // E26
  | "invalid" // código incorrecto (E21)
  | "expired" // código caducado o ya usado (E19, E21)
  | "cancelled" // el proveedor devolvió `error` (E20)
  | "email_not_confirmed" // E22
  | "provider_disabled" // E23
  | "rate_limited" // límite de envíos de Supabase (R5)
  | "unavailable"; // Supabase no responde

export type CustomerAuthResult =
  { ok: true; user: CustomerUser } | { ok: false; reason: CustomerAuthError };

/** ¿Hay alguna cookie NUESTRA en esta petición? Sin red, sin base. */
export async function hasCustomerSessionCookie(): Promise<boolean>;

/** La identidad verificada, o null. NUNCA lanza. */
export async function getCustomerUser(): Promise<CustomerUser | null>;

/** Correo, paso 1 (E1). */
export async function sendEmailOtp(
  email: string,
): Promise<{ ok: true } | { ok: false; reason: CustomerAuthError }>;

/** Correo, paso 2 (E1, E21, E22). Escribe las cookies de sesión y la pista. */
export async function verifyEmailOtp(email: string, token: string): Promise<CustomerAuthResult>;

/** OAuth, ida (E2, E23). Devuelve la URL del proveedor; no redirige. */
export async function startOAuth(
  provider: "google" | "facebook" | "apple",
  redirectTo: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: CustomerAuthError }>;

/** OAuth, vuelta (E3, E19). Escribe las cookies de sesión y la pista. */
export async function exchangeCustomerCode(code: string): Promise<CustomerAuthResult>;

/** Cierra la sesión y borra SOLO las cookies de cliente (E4, E18). */
export async function signOutCustomer(): Promise<void>;

/** Solo para `src/proxy.ts`: refresca la cookie de una petición en vuelo.
 *  No lee identidad, no decide nada, no redirige. */
export async function refreshCustomerSession(
  request: NextRequest,
  response: NextResponse,
): Promise<void>;
```

Cinco notas que son parte del contrato:

1. **`getCustomerUser()` usa `auth.getClaims()`**, no `getUser()`: verifica el JWT
   en local contra el JWKS cacheado y solo sale a la red la primera vez del
   proceso (o si el proyecto usa el secreto simétrico heredado, en cuyo caso la
   propia librería cae a `getUser()`). Es lo que hace que enlazar un pedido
   cueste microsegundos y no un viaje a Supabase.
2. Todas las funciones **capturan cualquier excepción** y devuelven el caso «sin
   sesión» o un `reason`. Una URL vacía, un token corrupto o Supabase caído se
   ven igual desde fuera (E17, E26).
3. `next/headers` se importa **dentro** de cada función
   (`const { cookies } = await import("next/headers")`), no en el tope del
   módulo: `src/proxy.ts` importa este mismo archivo y su bundle no debe
   arrastrar una API que allí no existe.
4. `refreshCustomerSession` construye su propio `createServerClient` sobre
   `request.cookies` / `response.cookies`, llama a `getSession()` y, si no hay
   sesión, borra la cookie de pista. Nada más.
5. Cada función que **establece** una sesión escribe las dos cookies —sesión y
   pista— en el mismo sitio, y `signOutCustomer` borra las dos. No hay otro
   escritor.

### Rutas nuevas

| Ruta                      | Método | Entrada                    | Salida 2xx                        | Errores                                                               | Segmento                     |
| ------------------------- | ------ | -------------------------- | --------------------------------- | --------------------------------------------------------------------- | ---------------------------- |
| `/api/account/otp`        | POST   | `{ email }`                | `200 { sent: true }`              | `400 INVALID_BODY` · `429 RATE_LIMITED` · `503 AUTH_UNAVAILABLE`      | `dynamic = "force-dynamic"`  |
| `/api/account/otp/verify` | POST   | `{ email, token }`         | `200 { signedIn: true, profile }` | `400 INVALID_BODY` · `401 { error: "OTP_REJECTED", reason }` · `503`  | `dynamic = "force-dynamic"`  |
| `/api/account/oauth`      | POST   | `{ provider, next }`       | `200 { url }`                     | `400 INVALID_BODY` · `409 PROVIDER_DISABLED` · `503 AUTH_UNAVAILABLE` | `dynamic = "force-dynamic"`  |
| `/api/account/profile`    | GET    | nada (la cookie)           | `200 { signedIn, profile }`       | ninguno: **siempre 200**                                              | `dynamic = "force-dynamic"`  |
| `/api/account/profile`    | PUT    | `{ name, phone, email }`   | `200 { signedIn: true, profile }` | `400 INVALID_BODY` · `401 UNAUTHORIZED`                               | `dynamic = "force-dynamic"`  |
| `/api/account/logout`     | POST   | nada                       | `303` a `/`                       | ninguno: cerrar dos veces es lo mismo que una                         | `dynamic = "force-dynamic"`  |
| `/auth/callback`          | GET    | `?code`, `?next`, `?error` | `307` al `next` validado          | `307` a `/cuenta/entrar?aviso=…`                                      | `dynamic = "force-dynamic"`  |
| `/cuenta`                 | página | —                          | HTML con el perfil                | `307` a `/cuenta/entrar?next=/cuenta[&aviso=sesion]`                  | `dynamic` + `revalidate = 0` |
| `/cuenta/entrar`          | página | `?next`, `?aviso`          | HTML, **200 siempre** (E26)       | —                                                                     | `dynamic` + `revalidate = 0` |

`export const dynamic = "force-dynamic"` y `export const revalidate = 0` van
**literales** en cada archivo (ficha `revalidate-no-literal`), y toda respuesta
JSON lleva `cache-control: no-store`, como el resto de la API de este repo.

**Defensa de las cuatro rutas `POST`**, que son públicas y sin sesión previa: el
mismo `content-type: application/json` estricto y el mismo tope de cuerpo que
`docs/adr/0016` fija para `/api/orders` (defensa 4 de esa ADR: fuerza el
_preflight_ CORS y deja fuera el POST cruzado desde otro origen), más
`ACCOUNT_MAX_BODY_BYTES` (4 KB, que es de sobra para un correo y seis dígitos).
No añaden capacidad nueva a internet: la `anon key` de Supabase es pública por
diseño y cualquiera puede llamar hoy a `signInWithOtp` contra el proyecto sin
pasar por aquí. El límite de envíos sigue siendo el de Supabase (R5).

**Todas las respuestas JSON son planas**: tres cadenas y un booleano. Ni `id`, ni
`supabaseUserId`, ni fechas — el contrato de `spec.md` § Datos y contrato, que es
la misma regla que F-010 R22.

```ts
// src/features/account/types.ts (por crear) — plano, sin Zod, apto para el navegador
export type AccountProfile = { name: string | null; phone: string | null; email: string | null };
export type AccountState = { signedIn: boolean; profile: AccountProfile | null };
```

### El esquema del `PUT` (R15, R20)

```ts
// src/features/account/schemas.ts (por crear) — SOLO servidor
const optionalName = z
  .string()
  .transform(normalizeName) // src/features/orders/contact.ts
  .refine((v) => v === "" || v.length >= CONTACT_NAME_MIN_LENGTH, "Name is too short")
  .refine((v) => v.length <= CONTACT_NAME_MAX_LENGTH, "Name is too long");
// phone: normalizePhone + "" o entre CONTACT_PHONE_MIN_DIGITS y MAX_DIGITS
// email: trim + "" o email() y ≤ CONTACT_EMAIL_MAX_LENGTH

export const accountProfileSchema = z.object({
  name: optionalName,
  phone: optionalPhone,
  email: optionalEmail,
}); // sin `customerId`, sin `id`, sin `supabaseUserId`: R20 por construcción
```

La cadena vacía significa «vaciar este campo» y se persiste como `null`. Un
perfil puede estar incompleto; lo que no puede es guardar un valor que el
checkout rechazaría después (R15). La isla del perfil **no valida con Zod**:
pinta los `issues` que devuelve el 400, que es lo que `design.md` § 4 pide (error
bajo cada campo, lo demás intacto) y evita meter Zod en el árbol de cliente.

### Tabla de errores visibles → mecanismo

| Escenario | Quién lo detecta                            | Qué hace el sistema                                                                    |
| --------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| E19       | `exchangeCustomerCode` → `expired`          | `307` a `/cuenta/entrar?aviso=caducado`                                                |
| E20       | `/auth/callback` ve `?error=`               | `307` a `/cuenta/entrar?aviso=cancelado`                                               |
| E21       | `401 OTP_REJECTED` con `reason`             | la isla pinta el error junto al campo y descuenta un intento de `OTP_MAX_ATTEMPTS` (3) |
| E22       | `authErrors.ts` mapea `email_not_confirmed` | mensaje propio, sin sesión                                                             |
| E23       | `409 PROVIDER_DISABLED`                     | mensaje propio; los otros tres métodos siguen                                          |
| E24 / E25 | `/cuenta`, con `hasCustomerSessionCookie()` | **con** cookie y sin usuario → `aviso=sesion`; **sin** cookie → sin aviso              |
| E26       | `isSupabaseAuthConfigured()`                | `/cuenta/entrar` responde 200 con los cuatro métodos deshabilitados                    |
| E27       | `safeNextPath()`                            | destino `/cuenta`                                                                      |

El texto exacto de cada mensaje lo fija `design.md`; aquí solo está la clave
estable (`caducado`, `cancelado`, `sesion`) que comparten las dos capas, que es
la misma que el diseño ya escribió en sus tablas.

### `safeNextPath` (R7, E27)

```ts
export const DEFAULT_NEXT = "/cuenta";
export function safeNextPath(raw: string | null | undefined): string;
```

Devuelve `raw` solo si: empieza por `/`, **no** empieza por `//` ni por `/\`, no
contiene `..`, no contiene `\` ni caracteres de control, y mide menos de
`NEXT_PATH_MAX_LENGTH` (512). En cualquier otro caso, `/cuenta`. `javascript:…`
cae por la primera condición. Pura y sin dependencias: la usan el callback, las
dos páginas y las islas. El `desde` del icono de cabecera (`design.md` § 0) pasa
por la misma función.

## Modelo de datos y migraciones

**No hace falta ninguna migración, y no se planifica ninguna.**
`Customer.supabaseUserId String? @unique`, `Customer.name/phone/email` y
`Order.customerId String?` con `@@index([customerId])` ya están en
`prisma/schema.prisma`. `npx prisma migrate status` tiene que seguir sin reportar
nada pendiente (criterio 2). Ninguna columna nueva: lo que no cabe en `Customer`
no se guarda (R9, I2).

### La creación idempotente (R12, E5–E8), en un solo viaje

```ts
// src/features/account/server/customers.ts (por crear)
export async function ensureCustomerForUser(user: CustomerUser): Promise<AccountProfile> {
  const seed = {
    supabaseUserId: user.id,
    email: seedEmail(user.email), // null si pasa de CONTACT_EMAIL_MAX_LENGTH
    name: seedName(user.fullName), // normalizeName, y null si no llega al mínimo
    phone: null, // R9: nunca del proveedor
  };
  try {
    return await prisma.customer.upsert({
      where: { supabaseUserId: user.id },
      create: seed,
      update: {}, // R10: los logins siguientes NO escriben
      select: { name: true, phone: true, email: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error, "supabaseUserId")) throw error;
    // E8: perdimos la carrera. Se relee la fila ganadora, no se propaga el error.
    const won = await prisma.customer.findUnique({
      where: { supabaseUserId: user.id },
      select: { name: true, phone: true, email: true },
    });
    if (won) return won;
    throw error;
  }
}
```

Por qué así, punto por punto:

- **Un solo round-trip** en los dos caminos normales (primer login y logins
  siguientes): el `upsert` se apoya en el índice único que ya existe, con un
  `where` de un solo campo único y sin escrituras anidadas, que es la forma que
  Prisma compila a un `INSERT … ON CONFLICT` nativo.
- **Sin `$transaction`**, que es lo que el pooler en modo transacción no perdona.
  Es una sentencia, no una transacción interactiva.
- **La colisión la decide la base, no un «mira si existe»**, que es el mismo
  patrón con el que `createOrder` resuelve hoy `idempotencyKey` y el que
  `docs/adr/0016` defiende como el único que no pierde la carrera. El `catch` es
  una segunda consulta **solo** en el caso raro de E8.
- **`update: {}`** es lo que hace cierto R10: volver a entrar con otro
  `full_name` no toca el perfil (segundo aserto del criterio 2).
- **Nunca se busca por `email`** (R8, E7): el `where` es `supabaseUserId` y solo
  `supabaseUserId`. Una fila vieja con el mismo correo y `supabaseUserId` nulo no
  entra en el `where`, así que no se toca y se crea una nueva.
- Se reutiliza `isUniqueViolation` de
  `src/features/orders/server/prismaErrors.ts`. Si el import cruzado entre
  features molesta, el movimiento correcto es subirla a `src/lib/`, no duplicarla.

**Aviso para el implementador**: si el `catch` se convirtiera en el camino normal
(porque Prisma no compilara el `upsert` a nativo y un `ON CONFLICT DO NOTHING`
devolviera cero filas), la salida sigue siendo correcta —se relee y se devuelve—,
pero deja de ser «un solo viaje». Quien lo demuestra es la prueba de E8 en
src/features/account/server/customers.db.test.ts (por crear), contra Postgres
real, que es el proyecto `db` de `vitest.config.mts`.

### Las otras tres consultas

| Función                                  | SQL                                                                     | Coste                |
| ---------------------------------------- | ----------------------------------------------------------------------- | -------------------- |
| `findCustomerIdByUserId(userId)`         | `SELECT id FROM "Customer" WHERE "supabaseUserId" = $1`                 | índice único, ~1 ms  |
| `getProfileByUserId(userId)`             | `SELECT name, phone, email FROM "Customer" WHERE "supabaseUserId" = $1` | índice único, ~1 ms  |
| `updateProfileByUserId(userId, profile)` | `UPDATE "Customer" SET … WHERE "supabaseUserId" = $1`                   | índice único, 1 fila |

El `UPDATE` filtra por `supabaseUserId`, **no** por `id`: aunque alguien colara un
`id` en el cuerpo, no hay ningún camino por el que ese valor llegue al `where`
(R20, E11).

## Criterio 6 — con Supabase Auth sin configurar

Estado de hoy de este worktree: `publicEnv.supabaseUrl === ""` y
`supabaseAnonKey === ""`. `createServerClient` **lanza** con esos valores
(verificado en el código de la librería), así que la regla es: **nadie construye
un cliente sin preguntar antes**.

| Pieza                          | Con Auth sin configurar                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isSupabaseAuthConfigured()`   | `false`. Lee `process.env.NEXT_PUBLIC_*` directamente, **sin Zod**, para poder importarse desde una isla sin arrastrar `src/lib/env.ts` al navegador. |
| `createSupabaseServerClient()` | devuelve `null` en vez de lanzar; todo lo que dependa de él ve «sin sesión»                                                                           |
| `getCustomerUser()`            | `null`, sin red                                                                                                                                       |
| Las tres rutas de acceso       | `503 AUTH_UNAVAILABLE`; la isla ya está deshabilitada, así que nadie las llama                                                                        |
| `GET /api/account/profile`     | `200 { signedIn: false, profile: null }`                                                                                                              |
| `POST /api/orders`             | idéntico a hoy: `customerId` `null`, 201                                                                                                              |
| `/cuenta/entrar`               | **200** con el aviso y los cuatro métodos deshabilitados (`design.md` § 1)                                                                            |
| `/cuenta`                      | `307` a `/cuenta/entrar` (no hay sesión posible)                                                                                                      |
| `src/proxy.ts`                 | `refreshCustomerSession` sale sin hacer nada                                                                                                          |
| Icono de la cabecera           | no se renderiza: `authConfigured` es `false` para todo el mundo, así que el HTML de ISR sigue siendo uno solo                                         |
| `npm run build`                | **0**. Ningún módulo construye un cliente en tiempo de importación: todo es perezoso y dentro de funciones.                                           |

Y lo que decide el criterio: la tienda y el checkout no cambian en nada. El único
camino por el que Auth toca el checkout es un `fetch` cuyo fallo se ignora.

## Escalabilidad y límites

**Consultas por checkout.**

| Camino                       | Viajes a Postgres                 | Viajes a Supabase Auth                                                                                |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Invitado (hoy y después)     | los mismos de F-010               | **0** (corta al no ver cookie)                                                                        |
| Con sesión                   | **+1** (`findCustomerIdByUserId`) | 0 en el caso normal (`getClaims` verifica en local); 1 la primera vez del proceso, para traer el JWKS |
| Sesión caducada / Auth caído | +0                                | 1 intento, cortado a 600 ms → `customerId` `null`                                                     |

El `+1` corre **en paralelo** con la búsqueda de tienda y la cotización, así que
no alarga el pedido. El autocompletado añade una petición HTTP a
`/[slug]/checkout` (que ya es `force-dynamic`) y **cero** al catálogo cacheado:
el icono de la cabecera se resuelve con una cookie, no con una petición (NC1).

**Cuando `Customer` tenga cientos de miles de filas.** Todas las consultas de
este feature entran por `supabaseUserId`, que es `@unique` y por tanto tiene su
índice B-tree: búsquedas de una fila, `O(log n)`, ~1 ms tanto a 10⁵ como a 10⁷
filas. No hay ni un `findMany`, ni un `count`, ni una respuesta que crezca con el
número de clientes. Lo que sí crece es `Order.customerId`: su `@@index([customerId])`
ya existe y hoy no lo usa nadie —desde F-012 empieza a tener sentido, y es
exactamente el índice que el futuro historial necesitará—. El escritor de pedidos
paga por él un mantenimiento de índice imperceptible.

**Lo que se rompe primero, con su umbral.** No es la base: es el **peso de la
cookie**. Un token de Supabase troceado ronda los 2–4 KB y, con `path: "/"`,
viaja en **cada** petición al origen de quien tiene sesión, incluidas las de las
páginas de catálogo servidas por el CDN. En 3G son decenas de milisegundos de
subida por navegación. Es el precio de una sesión legible por el servidor y se
acepta; lo que no se acepta es descubrirlo tarde, así que la verificación tiene
que incluir una petición **con la cookie puesta** comprobando que la página de
tienda sigue sirviéndose de caché (`x-vercel-cache: HIT`, o el `age` de la
respuesta) y no se ha vuelto dinámica.

**Presupuesto de JavaScript.** Hoy 176,9 KB gzip contra 193. F-012 añade al
catálogo la isla del icono y la señal de sesión: **~1,2 KB** medidos por
`sdd-designer` → ≈178,1 KB. **No hay que subir `BUDGET_KB`.** Y con DA5 la
regresión de 61,2 KB que el diseño teme no es evitable por disciplina sino
imposible: ningún módulo de cliente importa `@supabase/*`, y el test de fronteras
lo comprueba. Si `check:bundle` se pusiera rojo por esto, la causa sería una
dependencia colada y lo que aplica es la ficha
`.agent/playbook/bundle-fuera-de-presupuesto.md`, no subir el número.

**Caché.** Nada de lo que F-012 añade se cachea: todas sus rutas son
`force-dynamic` con `no-store`, y ninguna toca `revalidateTag` ni el ISR de la
tienda. `src/app/[slug]/**` conserva su `revalidate = 3600` y sus tags intactos.

## Patrones a seguir / antipatrones a evitar

**A seguir**

- Una sola puerta a la sesión y a Supabase Auth: lib/auth/customerSession.ts (por
  crear). Ninguna ruta lee el nombre de una cookie por su cuenta (R19,
  `AGENTS.md` § Prohibiciones, e I6 resuelto: `createSupabaseServerClient` puede
  leer cookies **por dentro** de ese módulo, y solo ahí).
- Prisma solo en `src/features/account/server/`. La regla de ESLint ya lo impone
  para `components/` y `app/**/*.tsx`; la guarda de texto lo extiende a `route.ts`.
- Errores del proveedor traducidos a un **código propio** en un solo módulo
  (`authErrors.ts`), no cadenas de Supabase repartidas por las pantallas
  (`AGENTS.md` § Prohibiciones: magic strings).
- Estado de cliente con `useSyncExternalStore` en un módulo, como
  `src/features/cart/cartStore.ts`, con `getServerSnapshot()` estable en el estado
  «desconocido» para que el HTML de ISR y el primer render coincidan.
- Una guarda de fronteras, src/features/account/boundaries.test.ts (por crear),
  que vuelve permanente lo que hoy es un grep manual:
  1. `cookies()` no aparece en `src/features/orders/**` ni en `src/app/[slug]/**`
     (la fila 4 de F-010, ahora dentro de `npm test`);
  2. los únicos archivos que importan `@supabase/*` son
     `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts` y el módulo de
     sesión;
  3. **ningún archivo con `"use client"` importa `@supabase/*`** — el «error de
     una línea» de `design.md` § Coste de cliente, cerrado con un test;
  4. `"slug"` no aparece en el `matcher` de `src/proxy.ts`.
     Ojo con la ficha `boundaries-guard-cruzado-por-patron-de-texto`: son regex de
     texto, y hay que redactarlas para que no atrapen por casualidad a un feature
     ajeno.

**A evitar**

- `cookies()` —o cualquier lectura de sesión— en `src/features/orders/**` o
  `src/app/[slug]/**`. Rompe un feature cerrado.
- Ampliar el `matcher` con `/[slug]` «solo para probar».
- `$transaction` para crear el `Customer`.
- `export const revalidate = ALGO_IMPORTADO`.
- Escribir en `Customer` desde el checkout (R13), por tentador que sea tener ahí
  el teléfono recién tecleado.
- Poner el `fetch` del perfil en el cuerpo de un `useEffect` con un `setState`
  detrás (ficha `set-state-en-efecto-prohibido`).
- Importar `@/lib/env` desde una isla: arrastra Zod al navegador. Para eso está
  src/lib/supabase/config.ts (por crear).

## Riesgos y plan B

1. **El canje PKCE con el flujo iniciado en el servidor.** Verificado en el
   código de `@supabase/auth-js` que el verificador se persiste vía `this.storage`
   —nuestras cookies— y que `skipBrowserRedirect` está soportado, pero no lo he
   ejecutado contra un proyecto real (I7: este worktree no tiene Auth). Si
   fallara, el plan B es la opción (b) de `design.md`: solo `@supabase/auth-js` en
   el navegador **para OAuth**, dejando el correo en el servidor. Cuesta 23,9 KB
   gzip en una ruta `ƒ` y no cambia ninguna pantalla.
2. **`next/headers` en el bundle del proxy.** Mitigado por diseño (import
   perezoso dentro de cada función). Si aun así el build se quejara, la salida es
   partir el módulo en dos archivos hermanos dentro de `lib/auth/`, lo que
   debilitaría la lectura literal de R19: sería una pregunta al humano, no una
   decisión del implementador.
3. **Prisma no compila el `upsert` a un `ON CONFLICT` nativo.** El resultado sigue
   siendo correcto; lo que se pierde es la promesa de «un solo viaje» de R12 en el
   primer login. Si aparece, se sustituye por `$queryRaw` con
   `INSERT … ON CONFLICT ("supabaseUserId") DO NOTHING RETURNING …` más relectura:
   sigue siendo una sentencia y sigue sin `$transaction`.
4. **La cookie de sesión llega a las páginas de catálogo** y algún día algún CDN
   decide no cachear una petición con cookies. Se verifica explícitamente
   (§ Escalabilidad). Si pasara, la salida sería restringir el `path` de la cookie
   de sesión a `/cuenta`, `/auth` y `/api`, lo que hay que medir antes de tocar
   nada porque `POST /api/orders` la necesita.
5. **La cookie de pista puede quedarse rancia** (la sesión murió y ella sigue).
   Efecto máximo: el icono lleva a `/cuenta` y `/cuenta` manda a entrar, que es
   E25. Se autocorrige en el proxy y en la respuesta del perfil.
6. **Cuatro rutas `POST` públicas nuevas.** No amplían lo que internet puede
   hacer —la `anon key` es pública y esos mismos endpoints de Supabase ya son
   alcanzables sin nosotros— pero sí amplían **nuestra** superficie. Van con el
   `content-type` estricto, el tope de cuerpo y `no-store`, y quedan anotadas en
   la ADR nueva, que es lo que `docs/adr/0016` exige de cualquier ruta pública de
   escritura.

## Qué NO hace falta, dicho para que nadie lo añada

- **Ninguna migración de Prisma.** Ni una columna, ni un índice, ni un
  `prisma/migrations/*` nuevo. `Customer.supabaseUserId` y `Order.customerId` ya
  existen y son nullable. Si alguien planifica una migración en F-012, se
  equivocó de sitio (y `npx prisma migrate status` limpio es parte del criterio 2).
- **Ningún cambio en `docs/sync-contract.md`** ni en el payload de
  `/api/internal/orders`. El pedido que ve el POS es el mismo byte a byte.
- **Ninguna dependencia nueva en `package.json`.** `@supabase/ssr` y
  `@supabase/supabase-js` ya están, y con DA5 solo se usan en el servidor.
- **Ningún cambio en `src/lib/slug.ts`**: las cuatro palabras ya están reservadas.
- **Ningún historial de pedidos, ninguna dirección guardada, ninguna contraseña**
  (D2). Ninguna pantalla que liste `Order` por `Customer`.
- **Ninguna columna para datos del proveedor** (I2): ni foto, ni provider, ni
  tokens.
- **Ningún `revalidateTag`, ningún cambio de ISR, ningún `export const revalidate`
  nuevo en `src/app/[slug]/**`.**
- **Ningún cambio en `src/lib/auth/adminSession.ts`.** Las dos sesiones no se
  tocan (E18).
- **Ningún `BUDGET_KB` nuevo** en `scripts/check-bundle-budget.mjs`.

## Una precondición de entorno que `spec.md` no lista

`spec.md` § Actores y precondiciones enumera cuatro cosas que el humano tiene que
dejar hechas en el proyecto Supabase. Falta una quinta, que es la que hace posible
R3/D5: la plantilla de correo de acceso («Magic Link») del proyecto tiene que
incluir **`{{ .Token }}`**, o Supabase manda un enlace en vez del código de 6
dígitos y el paso 2 de la pantalla no tiene nada que teclear. No cambia una línea
de código; sí bloquea la verificación del criterio 1a. Va anotado aquí para que
llegue a `.agent/progress/F-012.md` § Bloqueado por.

## ¿Hace falta una ADR?

**Sí, y queda escrita en borrador**: `docs/adr/0023-cuenta-del-comprador.md`, en
estado **Propuesta**, para que la firme el humano junto con `plan.md`. Tres
decisiones ya tomadas cambian de forma y no se pueden cambiar en silencio:

- **ADR 0016** dice que existe **una** ruta pública de escritura y que añadir otra
  «es una decisión de este mismo peso», y da por hecho que «el checkout no lee
  cookies de sesión» (R24 de F-010). D6 cambia lo segundo: `POST /api/orders`
  **sí** resuelve una sesión, aunque nunca para autorizar; y F-012 añade cuatro
  rutas `POST` públicas más.
- **ADR 0005** anunció que la sesión de cliente usaría cookies `sb-`. DA3 la fija
  a `qab-shopper-auth` y añade `qab-shopper-hint`.
- **ADR 0005** también da por hecho el flujo de Supabase resuelto en el navegador.
  DA5 lo mueve entero al servidor, con la consecuencia buena de que la cookie de
  comprador puede ser `httpOnly`.

## Preguntas al humano

**Ninguna.** Las cuatro decisiones que `spec.md` dejó abiertas están tomadas
(DA1–DA4, más DA5 que responde a NC3), ninguna necesita un comando prohibido,
ninguna cambia el contrato con cuadrecaja, ninguna añade coste de infraestructura
y ninguna amplía el alcance de D2.

Dos cosas que **no** son preguntas pero que el humano debería leer antes de firmar
el plan:

1. **La plantilla de correo del proyecto Supabase necesita `{{ .Token }}`**
   (§ arriba). Es la única precondición nueva que aparece en este ciclo.
2. `src/app/api/orders/route.ts` pasa a leer una sesión. Sigue sin exigirla, sin
   esperarla y sin fallar por ella —y la fila 4 de F-010 sigue verde, porque esa
   ruta no está en ninguno de los dos árboles que el grep vigila—, pero es un
   cambio real respecto de lo que dejó escrito `docs/adr/0016`. De ahí la ADR.
