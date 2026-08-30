# 0023 — La cuenta del comprador: sesión propia, en el servidor, sin tocar el checkout de invitado

**Aceptada** · 29 de agosto de 2026 · firmada por el humano junto con
`.agent/specs/F-012/plan.md`

## Contexto

ADR 0005 decidió dos sistemas de autenticación separados y anticipó que la
sesión del comprador viviría en cookies `sb-` de Supabase Auth. ADR 0016 decidió
que existe **una** ruta pública de escritura (`POST /api/orders`), que añadir
otra «es una decisión de este mismo peso», y describió esa ruta como una que
**no lee cookies de sesión** (R24 de F-010, verificada con un `grep` que sigue
vivo en `.agent/specs/F-010/tests.md`, fila 4).

F-012 construye la cuenta y trae tres cosas que rozan las dos ADR anteriores:

1. **D6** (decisión del humano, 2026-08-29) manda escribir `Order.customerId`
   cuando quien confirma tiene sesión. Alguien tiene que resolver esa identidad
   en la petición del pedido.
2. La pantalla de acceso puede hablar con Supabase desde el navegador o desde el
   servidor. Medido en este repo: un módulo de navegador que solo importa
   `createBrowserClient` pesa **61,2 KB gzip**.
3. El nombre de la cookie del comprador tiene que ser una constante comprobable
   (criterio 5 de F-012), y `sb-<ref>-auth-token` depende de una variable de
   entorno que en el entorno de desarrollo de hoy está vacía.

## Decisión

**1. Supabase Auth se llama únicamente desde el servidor.** El navegador nunca
importa `@supabase/*`: la isla de `/cuenta/entrar` habla por `fetch` con rutas
propias (`/api/account/otp`, `/api/account/otp/verify`, `/api/account/oauth`) y
esas rutas llaman a `lib/auth/customerSession.ts`, el único módulo que construye
un cliente de Supabase y el único que lee o escribe la sesión del comprador.

Consecuencias buenas, en orden de importancia: la cookie de sesión puede ser
**`httpOnly`** (con el flujo en el navegador no podría serlo, porque el cliente
la escribe con `document.cookie`); **0 KB** de Supabase en el bundle, contra los
61,2 KB que habrían aterrizado en todas las páginas de catálogo si el enlace de
cuenta de la cabecera hubiera acabado importando el cliente por accidente; y
pulsar «Continuar con Google» deja de esperar una descarga antes de redirigir.

**2. Dos cookies propias, con nombre fijado a mano.**
`qab-shopper-auth` para la sesión (`httpOnly`, `path=/`, `sameSite=lax`), fijada
con `cookieOptions.name` para no depender del identificador del proyecto; y
`qab-shopper-hint`, un booleano sin credencial ni dato personal, legible por
JavaScript, cuyo único trabajo es que el icono de cuenta de la cabecera sepa cómo
pintarse **sin una petición por página de catálogo**. Ninguna decisión de
servidor mira la segunda. Ninguna de las dos es prefijo de `qab-admin-session`.

**3. `POST /api/orders` resuelve la sesión, pero nunca la exige.** La resolución
la hace la ruta —no `features/orders/`, que sigue sin ver una cookie en su vida—,
arranca antes de leer el cuerpo, se corta a 600 ms y, ante cualquier fallo,
devuelve `null`. El `customerId` **jamás** sale del cuerpo, de la query ni de una
cabecera. El pedido de invitado sigue siendo el camino principal y no cambia en
nada.

## Lo que esto NO cambia de ADR 0016

- Sigue habiendo **una sola** ruta pública que escribe pedidos, y sigue sin
  autenticación. Las rutas nuevas de `/api/account/*` escriben `Customer`, una
  tabla que el sync no lee ni escribe y que el POS no consume.
- Las seis defensas de aquella ADR siguen en pie tal cual. Las rutas nuevas
  heredan las dos que les aplican: `content-type: application/json` estricto —que
  fuerza el _preflight_ CORS y deja fuera el POST cruzado— y un tope de cuerpo.
- Lo único que se corrige es una frase: aquel documento decía que el checkout no
  lee cookies de sesión. Desde D6, la ruta del pedido **sí** las lee, para
  enlazar y nunca para autorizar. La invariante que de verdad importaba —«se
  puede completar un pedido sin iniciar sesión»— se sigue verificando con el
  mismo comando de siempre, y además pasa a estar cubierta por un test de
  fronteras permanente.

## Alternativas descartadas

- **Acceso resuelto en el navegador** (lo que ADR 0005 anticipaba): 61,2 KB gzip
  en la ruta de acceso, cookie que no puede ser `httpOnly`, y un botón que
  descarga antes de redirigir. Se conserva como plan B **solo para OAuth**
  (23,9 KB, únicamente `@supabase/auth-js`) si el canje PKCE iniciado en el
  servidor diera problemas en producción.
- **Dejar el nombre por defecto `sb-<ref>-auth-token`**: no es comprobable de
  forma estable, no existe cuando la URL está vacía, y sin un nombre propio
  cerrar sesión no puede distinguir sus cookies de las ajenas.
- **Que la cabecera pregunte por HTTP si hay sesión**: una petición dinámica por
  cada página de catálogo servida desde el CDN, para pintar un punto de ocho
  píxeles.
- **Resolver la identidad dentro de `createOrder`**: metería una lectura de
  cookies en `src/features/orders/`, que es exactamente lo que el criterio 4 de
  F-010 prohíbe.

## Consecuencia — el límite que se acepta a sabiendas

`qab-shopper-hint` puede quedarse rancia: dice «hay sesión» cuando la sesión ya
murió. Lo peor que produce es que el icono lleve a `/cuenta` y `/cuenta` mande a
entrar, que es el escenario E25 de la spec, ya diseñado. Se autocorrige en el
proxy y en la respuesta del perfil. Se acepta porque la alternativa —preguntar al
servidor— cuesta una petición por página de catálogo, que es mucho más cara que
un desvío ocasional.

## Reabrir cuando

Aparezca un segundo consumidor de la sesión de comprador que necesite datos que
hoy no cruzan al navegador (el historial de pedidos es el candidato evidente),
o cuando el canje PKCE en el servidor demuestre no funcionar contra un proyecto
Supabase real — que es lo único de esta ADR que no se ha podido ejecutar todavía
(`.agent/specs/F-012/spec.md`, I7).
