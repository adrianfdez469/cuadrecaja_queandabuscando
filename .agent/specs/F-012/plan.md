---
feature: F-012
agente: orquestador
actualizado: 2026-08-29T15:10:32Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Quien compre en una de estas tiendas podrá, **si quiere**, entrar una vez con
Google, Facebook, Apple o un código de seis dígitos que le llega por correo, y
dejar guardados su nombre, su teléfono y su correo. A partir de ahí, cada vez que
pida algo el formulario de checkout le llega con esos tres campos ya puestos, y
sus pedidos quedan enlazados a su cuenta.

Quien no quiera cuenta pide exactamente igual que hoy: **nada del checkout de
invitado cambia**. Ni un campo, ni un paso, ni una petición más. Esa es la
promesa que F-010 ya hizo y este feature no la toca.

Lo que **no** cambia: la tienda se sigue leyendo sin esperar el JavaScript, el
pedido que ve el POS es el mismo byte a byte, y no hay ninguna migración de base
de datos.

## Pasos

Once pasos. Cada uno se puede verificar solo, y `bash .agent/verify.sh F-012`
tiene que salir 0 al final de cada uno — no solo al final del último.

| Nº  | Qué se hace                                                                                                                                                                               | Archivos                                                                                                                                                                                                     | Criterio que acerca | Cómo se verifica                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cimientos puros, sin E/S: nombres de cookie y timeouts, `safeNextPath()`, detector de «¿hay Auth configurado?», tipos planos, mapa de errores de Supabase a claves estables, esquemas Zod | src/constants/account.ts · src/lib/safeNextPath.ts · src/lib/supabase/config.ts · src/features/account/types.ts · src/features/account/authErrors.ts · src/features/account/schemas.ts (los seis, por crear) | 5, 6                | `npm test` con pruebas nuevas en el proyecto `node`: la tabla de `next` hostiles de E27 acaba toda en `/cuenta`; los límites del perfil son los mismos de `src/constants/orders.ts` (R15) |
| 2   | El módulo de sesión de cliente: **el único** sitio que lee o escribe la sesión del comprador y el único que habla con Supabase Auth                                                       | lib/auth/customerSession.ts (por crear) · `src/lib/supabase/server.ts` y `src/lib/supabase/client.ts` (se modifican: `cookieOptions.name` y `null` sin configuración)                                        | 1, 5, 6             | `npm test`: la constante del nombre de cookie de cliente y `ADMIN_COOKIE` son distintas y ninguna es prefijo de la otra (R21); sin `NEXT_PUBLIC_SUPABASE_URL` el módulo devuelve `null`   |
| 3   | La **guarda de fronteras**, escrita pronto a propósito para que vigile todos los pasos siguientes                                                                                         | src/features/account/boundaries.test.ts (por crear)                                                                                                                                                          | 4, 5                | `npm test`: convierte en prueba permanente el `git grep` de la fila 4 de F-010, la regla R19 y el «error de una línea» del diseño (`@supabase/*` en el árbol de la cabecera)              |
| 4   | El `Customer` en la base: crearlo idempotente por `supabaseUserId` en un solo viaje, leerlo y actualizarlo. Sin `$transaction` con el cliente global                                      | src/features/account/server/customers.ts (por crear)                                                                                                                                                         | 2                   | `npm test` contra el Postgres local: dos llamadas concurrentes con el mismo `supabaseUserId` dejan **una** fila; `npx prisma migrate status` limpio, sin migración nueva                  |
| 5   | Las cuatro rutas de acceso más el callback: pedir código, comprobar código, salir hacia un proveedor, canjear el `code`, cerrar sesión. Auth se llama **desde el servidor** (DA5)         | src/app/api/account/otp/route.ts · src/app/api/account/otp/verify/route.ts · src/app/api/account/oauth/route.ts · src/app/auth/callback/route.ts · src/app/api/account/logout/route.ts (por crear)           | 1, 2, 5             | `npm test` en el proyecto `node`: cada botón de proveedor llega a `signInWithOAuth` con su `provider` y su `redirectTo`; el callback con `next` hostil acaba en `/cuenta` (E27)           |
| 6   | El perfil por HTTP: `GET` para el autocompletado y `PUT` para guardar, con los `issues` de Zod devueltos por campo                                                                        | src/app/api/account/profile/route.ts (por crear)                                                                                                                                                             | 3                   | `npm test`: `GET` sin sesión responde «no hay perfil» sin error; `PUT` con nombre corto devuelve el `issue` en el campo; ninguna respuesta lleva `id` ni `supabaseUserId`                 |
| 7   | Las dos pantallas de cuenta y sus islas: pedir correo, teclear el código con su reenvío, y el perfil editable con cerrar sesión                                                           | src/app/cuenta/page.tsx · src/app/cuenta/entrar/page.tsx · src/features/account/components/SignInCard.tsx · src/features/account/components/ProfileForm.tsx (por crear)                                      | 1, 3, 6             | `npm test` en jsdom sobre los estados de `design.md` §§ 1–2; `/cuenta/entrar` responde **200 incluso sin Auth configurado** (E26)                                                         |
| 8   | El icono de cuenta en la cabecera de la tienda: señal local y síncrona desde la cookie de pista, con `useSyncExternalStore`. **Cero peticiones por página de catálogo**                   | src/features/account/accountStore.ts · src/features/account/components/AccountBadge.tsx (por crear) · `src/app/[slug]/layout.tsx` (se modifica)                                                              | 6                   | `npm run build && npm run check:bundle` sigue por debajo de 193 KB; el paso 3 sigue verde (nada de `@supabase/*` en ese árbol); `/[slug]` sigue marcada `●` en la salida del build        |
| 9   | El autocompletado del checkout: la isla pide el perfil al montar, rellena **solo** los campos vacíos, y si tarda o falla no se entera nadie                                               | `src/features/cart/components/CheckoutForm.tsx` (se modifica)                                                                                                                                                | 3                   | `npm test` en jsdom: E12 rellena los tres; E13 con «Ana P.» ya tecleado respeta el nombre; E14 deja el teléfono vacío; E16 sin sesión deja los tres vacíos y **sin** error                |
| 10  | El enlace del pedido: la ruta resuelve la identidad y la pasa a `createOrder` como promesa que nunca rechaza, cortada a 600 ms y esperada justo antes de escribir                         | src/features/account/server/orderIdentity.ts (por crear) · `src/app/api/orders/route.ts` y `src/features/orders/server/createOrder.ts` (se modifican)                                                        | 2, 4                | `psql "$DATABASE_URL"`: con sesión el pedido lleva el `id` del `Customer`, sin sesión lleva `NULL`, con sesión caducada `NULL`; la suite entera de F-010 en verde **sin tocar un aserto** |
| 11  | El refresco de sesión en el proxy, con el `matcher` ampliado a `/cuenta*` y `/auth*` y **bifurcado por prefijo antes del redirect de admin**. Y `/cuenta` y `/auth` a `disallow`          | `src/proxy.ts` y `src/app/robots.ts` (se modifican)                                                                                                                                                          | 4, 5                | `grep -n "slug" src/proxy.ts` no devuelve nada dentro del `matcher` (R22); un comprador sin cookie de admin en `/cuenta` **no** acaba en `/?admin=sesion-requerida` (I5)                  |

Al terminar el paso 11: `bash .agent/verify.sh F-012 --full` en 0, y
`sdd-tester` escribe .agent/specs/F-012/smoke.sh (por crear) con lo que hay que
hacer a mano contra un proyecto Supabase real, que es el criterio 1a.

## De dónde sale cada paso

| Paso | Sale de                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Componentes (filas 2–6, 9–11) · R7/E27 y R15 de `spec.md` · criterio 6                           |
| 2    | R19 e I6 de `spec.md` · `architecture.md` § DA3 y § La superficie pública del módulo de sesión · R21 (criterio 5)    |
| 3    | `.agent/specs/F-010/tests.md` fila 4 · R18/I4 y R19 de `spec.md` · `design.md` § Riesgos, riesgo (1)                 |
| 4    | R12 y E5–E8 de `spec.md` · `architecture.md` § La creación idempotente · `AGENTS.md` § Cosas que muerden (el pooler) |
| 5    | E1–E4 de `spec.md` · D5/R3 · `architecture.md` § DA5 y § Rutas nuevas · NC3 y NC4 de `design.md`                     |
| 6    | R15, R20 y el contrato de datos de `spec.md` · `architecture.md` § El esquema del `PUT` · NC2 y NC5 de `design.md`   |
| 7    | `design.md` §§ 1–2 (11 y 12 estados) y § 4 · E21–E26 de `spec.md` · criterio 6                                       |
| 8    | D7 y R23/E29 de `spec.md` · R11 · `design.md` § 0 · NC1 · `architecture.md` § DA1 (la señal desde la cookie)         |
| 9    | E12–E16 y R17 de `spec.md` · D4 · `architecture.md` § DA1 · `design.md` § 5                                          |
| 10   | D6 y R13/R14 de `spec.md` · E17 y E28 · `architecture.md` § DA2                                                      |
| 11   | R22 e I5 de `spec.md` · `architecture.md` § DA4                                                                      |

No hay ningún paso que no salga de una línea escrita antes.

## Qué queda fuera

Lo que alguien podría esperar de «tener cuenta» y **no** se construye aquí:

- **Historial de pedidos.** El pedido queda enlazado (D6) pero no hay ninguna
  pantalla que liste pedidos. El dato se guarda para que el historial sea posible
  después; la pantalla es un feature que decidas tú.
- **Direcciones guardadas.** `CustomerAddress` existe en la base y no se lee, no
  se escribe y no aparece. El checkout sigue pidiendo la dirección a mano.
- **Contraseñas.** Ni registro, ni cambio, ni recuperación. El acceso por correo
  es el código de seis dígitos (D5).
- **Reclamar pedidos de invitado anteriores.** Un pedido hecho sin sesión se
  queda sin dueño para siempre.
- **Unificar identidades.** Entrar hoy con Google y mañana con el correo puede
  dar dos cuentas distintas, porque la identidad es `supabaseUserId` y solo eso:
  enlazar por correo sería un camino de apropiación de cuenta.
- **Borrar la cuenta y exportar los datos.**
- **Que el checkout escriba en el perfil.** Confirmar un pedido enlaza, pero
  nunca modifica el `Customer`. El teléfono con el que alguien pide hoy para su
  madre no es su teléfono.
- **Migraciones, dependencias nuevas y cambios en el contrato con cuadrecaja.**
  Ninguna de las tres.

## Riesgos y plan B

**No hay migración de datos, no se toca `docs/sync-contract.md`, no se usa
ninguno de los comandos que `AGENTS.md` marca como prohibidos y no se añade
ninguna dependencia.** Los tres riesgos reales:

1. **El canje PKCE iniciado en el servidor (DA5) no está probado contra un
   Supabase real.** El arquitecto lo verificó leyendo `@supabase/auth-js`, pero
   este worktree no tiene Auth (I7). Se notaría en el paso 5, al canjear el
   `code`. **Plan B**: mover solo OAuth al navegador con `@supabase/auth-js`,
   dejando el correo en el servidor. Cuesta 23,9 KB gzip en una ruta `ƒ` —no en
   las páginas de catálogo— y no cambia ninguna pantalla. Ver PP2.
2. **El presupuesto de JavaScript.** Hay 16,1 KB libres medidos hoy y el icono
   cuesta ~1,2 KB, así que sobra sitio. Pero si `@supabase/*` entrara por error
   en el árbol de la cabecera serían ~45 KB por encima. Por eso el paso 3 escribe
   la guarda **antes** que el paso 8, y no después.
3. **Cuatro rutas `POST` públicas nuevas.** No amplían lo que internet puede
   hacer contra Supabase —la clave anónima es pública—, pero sí amplían nuestra
   superficie. Van con `content-type` estricto, tope de cuerpo y `no-store`, y
   quedan anotadas en la ADR, que es lo que `docs/adr/0016` exige.

## Coste

- **Un ciclo de `sdd-implementer`** para los once pasos, con el bucle de
  verificación corriendo dentro. Después, **uno de `sdd-tester`**.
- **Se toca lo que ya funciona en seis archivos**: `src/proxy.ts`,
  `src/app/[slug]/layout.tsx`, `src/app/robots.ts`,
  `src/features/cart/components/CheckoutForm.tsx`,
  `src/features/orders/server/createOrder.ts` y `src/app/api/orders/route.ts`.
  Los dos últimos son el camino del pedido, que es lo más delicado del repo: por
  eso el paso 10 exige la suite de F-010 en verde **sin tocar un aserto**.
- **Dar marcha atrás a mitad** es barato hasta el paso 7 incluido: todo lo nuevo
  vive en archivos nuevos y basta con no montarlo. A partir del paso 8 hay que
  deshacer los seis archivos de arriba, y el más caro es
  `createOrder.ts` — aunque su cambio está diseñado para ser inerte por defecto
  (`= Promise.resolve(null)`), así que quitar la línea de la ruta lo desactiva
  sin tocarlo.

## Preguntas antes de aprobar

Las tres las respondió el humano el 2026-08-29, **antes** de firmar. Ninguna
queda abierta.

**PP1 — La ADR 0023: se firma con el plan.** `docs/adr/0023-cuenta-del-comprador.md`
pasa de **Propuesta** a **Aceptada** en el mismo acto que este plan. Corrige tres
cosas ya escritas: la 0016 daba por hecho que el checkout no lee cookies (D6 lo
cambia) y que hay una sola ruta pública de escritura (F-012 añade cuatro); la
0005 anunció cookies `sb-` y el flujo de Auth en el navegador, y DA3/DA5 lo
cambian a `qab-shopper-auth` y a servidor.

**PP2 — El plan B del riesgo 1 queda PREAUTORIZADO.** Si el canje PKCE iniciado
en el servidor falla contra un Supabase real, `sdd-implementer` aplica el plan B
**sin parar a preguntar**: solo OAuth al navegador con `@supabase/auth-js`,
dejando el correo en el servidor. Coste 23,9 KB gzip en una ruta `ƒ` —no en las
páginas de catálogo—, ninguna pantalla cambia. Debe **anotarlo en `impl.md`**
como desvío del plan, con lo que falló; preautorizado no es silencioso.

**PP3 — El entorno de Supabase lo deja hecho el humano antes de que llegue
`sdd-tester`.** Plantilla de correo con `{{ .Token }}` (o llega un enlace mágico
en vez del código de seis dígitos y la pantalla del paso 7 no tiene nada que
teclear), más `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en
`.env`. Los once pasos se construyen mientras tanto: **no bloquea implementar,
bloquea verificar el criterio 1**.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-012 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-29T15:10:32Z — aprobado por el humano: «Aprobado, adelante — los once pasos, el «qué queda fuera» y PP1-PP3 tal como quedaron escritas. ADR 0023 se firma con el plan; plan B de PKCE preautorizado; el entorno de Supabase lo dejo hecho antes del tester.»
