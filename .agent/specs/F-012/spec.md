---
feature: F-012
agente: sdd-spec
actualizado: 2026-08-29T04:23:31Z
estado: listo
---

## Problema

Hoy no existe ninguna cuenta de comprador. El checkout de F-010 es siempre de
invitado: nombre, teléfono y correo se teclean **en cada pedido**, en un teclado
de móvil, justo en el paso donde se abandona un carrito. `Customer` existe en la
base (`prisma/schema.prisma`, con `supabaseUserId String? @unique`) pero no hay
una sola fila: `src/features/orders/server/createOrder.ts:249` escribe
`customerId: null` siempre.

F-012 abre una cuenta **opcional**, con Supabase Auth: quien quiera, entra una
vez, guarda sus datos de contacto y deja de teclearlos. Quien no quiera, pide
exactamente igual que hoy — esa es la promesa que F-010 ya hizo y que este
feature no puede romper.

## Alcance

### Dentro

- Tres rutas **fuera del slug** (D1), porque una sesión sirve para todas las
  tiendas y porque `/[slug]/**` está fuera del `matcher` de `src/proxy.ts` a
  propósito:
  - `/cuenta` — perfil de contacto y cerrar sesión.
  - `/cuenta/entrar` — los cuatro métodos de acceso.
  - `/auth/callback` — canje del código que devuelve el proveedor de OAuth.

  Las tres palabras ya están reservadas en `src/lib/slug.ts`: `cuenta`, `auth`,
  `login` y `logout` están en `RESERVED_SLUGS`. El nombre no se inventa aquí.

- Entrar con **Google**, **Facebook** y **Apple** (OAuth de Supabase) y con
  **correo** (código de un solo uso; ver R3).
- Creación del `Customer` en el primer inicio de sesión, enlazado por
  `supabaseUserId`.
- Perfil de contacto editable: **nombre, teléfono y correo**. Nada más (D2).
- Cerrar sesión.
- Autocompletado de los campos **vacíos** del formulario de checkout con el
  perfil, sin pisar lo que la persona ya tecleó (D4).
- Volver al punto de partida después de entrar, incluido el checkout, con el
  carrito intacto (D4).
- **Enlace del pedido con la cuenta (D6):** `Order.customerId` se escribe con el
  `Customer` de quien confirma con sesión, y queda `null` cuando no la hay (R14).
  Es un dato que se guarda, no una pantalla: el historial de pedidos sigue fuera.
- **Un punto de entrada a la cuenta en la cabecera de la tienda (D7)**, resuelto
  en cliente para no romper el HTML cacheado por ISR (R23, con R11 como límite).
  Cómo se ve —el icono, su sitio, su rótulo— lo decide `sdd-designer`.
- Un único módulo que lee y escribe la sesión del cliente:
  lib/auth/customerSession.ts (por crear), como exige `AGENTS.md` §
  Prohibiciones.
- Tres pruebas de no-regresión que son criterios por derecho propio: el pedido de
  invitado sigue funcionando (criterio 4), las cookies de cliente y de admin no se
  pisan (criterio 5) y, sin Supabase Auth configurado, la tienda y el checkout
  siguen enteros (criterio 6).

### Fuera (explícito)

- **Historial de pedidos.** No hay lista de pedidos en `/cuenta`, ni ninguna
  pantalla nueva que muestre pedidos, ni forma de consultarlos por cuenta (D2).
  Lo que sí ocurre desde D6 es que el pedido **queda enlazado**
  (`Order.customerId`, R14): se guarda el dato para que el historial sea posible
  después, no se enseña. Ver I1.
- **Direcciones guardadas.** `CustomerAddress` no se lee, no se escribe y no
  aparece en ninguna pantalla (D2). El checkout sigue pidiendo la dirección de
  entrega a mano.
- **Contraseñas.** No hay registro con contraseña, ni cambio, ni recuperación, ni
  «olvidé mi contraseña». Ver R3 y § No decidido a propósito.
- **Reclamar pedidos de invitado anteriores** por correo o por teléfono. Un
  pedido hecho sin sesión se queda sin dueño para siempre en este ciclo.
- **Unificar identidades.** Si la misma persona entra hoy con Google y mañana con
  su correo y Supabase le da dos `user.id` distintos, son dos `Customer`. Ver R8
  y E6.
- **Borrar la cuenta y exportar los datos.**
- **Escribir el perfil desde el checkout.** Confirmar un pedido nunca modifica el
  `Customer` (R13). El perfil se escribe desde `/cuenta` y se siembra en el
  primer login, y de ningún otro sitio.
- **Permisos.** La cuenta de cliente no da acceso a nada de `/admin` ni cambia
  ninguna autorización existente.
- **Cuenta por tienda.** Una sola cuenta global (D1). No hay «registrarse en esta
  tienda».
- **Cualquier correo que no sea el propio código de acceso.** Ni bienvenida, ni
  avisos, ni recibos.

## Actores y precondiciones

**Actor único: el comprador** (anónimo por defecto). El administrador aparece
solo en E14, y únicamente para comprobar que las dos sesiones no se estorban.

Precondiciones de entorno, todas fuera del código y responsabilidad del humano
(ya anotadas en `.agent/progress/F-012.md` § Bloqueado por):

1. Un proyecto Supabase con **Auth** disponible y los providers `google`,
   `facebook` y `apple` habilitados en su panel.
2. `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `.env`. Hoy
   `src/lib/env.ts` las deja en `""` cuando faltan, y `.env.example` apunta al
   emulador de Storage local, que no habla Auth: de ahí E21, que **no** es un
   caso hipotético sino el estado actual de este worktree.
3. `<NEXT_PUBLIC_SITE_URL>/auth/callback` registrado en la lista de _Redirect
   URLs_ del proyecto, para desarrollo y para producción.
4. Una bandeja de correo controlada por quien pruebe, para el criterio 1 por
   correo (D3).

Nada de esto bloquea especificar, diseñar ni construir; bloquea **verificar**.

## Comportamiento esperado

Los números son **etiquetas estables**, no un orden: E28 y E29 se añadieron en la
revisión de D6/D7 y viven junto a los escenarios con los que se leen, no al final,
para no invalidar las citas que otros artefactos ya hacen por número.

### Entrar

- **E1 — Entrar con correo.** Dado un visitante sin sesión en `/cuenta/entrar`,
  cuando escribe su correo y pide el código, entonces la aplicación llama a
  `signInWithOtp({ email })`, la pantalla pasa a pedir el **código de 6 dígitos**
  **en la misma pestaña**, y al teclearlo correctamente se llama a `verifyOtp`,
  queda una sesión de Supabase y el navegador termina en el destino de R6.
- **E2 — Entrar con un proveedor.** Dado el mismo visitante, cuando pulsa
  «Continuar con Google» (ídem Facebook y Apple), entonces se llama a
  `signInWithOAuth` con **ese** `provider` y con
  `redirectTo = <origen>/auth/callback?next=<destino>`, y el navegador sale hacia
  el proveedor.
- **E3 — El callback canjea el código.** Dado un regreso del proveedor a
  `/auth/callback?code=<code>&next=<destino>`, cuando la ruta se ejecuta,
  entonces canjea el código por una sesión, escribe las cookies de sesión y
  redirige al `destino` validado por R7.
- **E4 — Cerrar sesión.** Dada una persona con sesión en `/cuenta`, cuando pulsa
  «Cerrar sesión», entonces se cierran la sesión y sus cookies, el navegador
  queda en `/`, y **ninguna** cookie ajena a Supabase Auth se borra (R19).
- **E29 — El punto de entrada de la cabecera (D7).** Dado el catálogo de una
  tienda, entonces hay un punto de entrada discreto a la cuenta en su cabecera:
  sin sesión lleva a `/cuenta/entrar` conservando el origen (R6), y con sesión
  lleva a `/cuenta`. El **HTML cacheado es el mismo para todos** los visitantes y
  la diferencia se resuelve en el navegador (R11, R23); mientras no se resuelva,
  la cabecera no salta ni empuja el catálogo hacia abajo.

### El `Customer` del primer login

- **E5 — Primer login.** Dado que no existe ningún `Customer` con
  `supabaseUserId = <user.id>`, cuando esa persona completa el acceso por
  cualquiera de los cuatro métodos, entonces existe **exactamente uno**, con los
  campos sembrados según R9, antes de que se pinte `/cuenta`.
- **E6 — Logins siguientes.** Dado que ya existe ese `Customer`, cuando la misma
  persona vuelve a entrar, entonces **no** se crea otro y **no** se sobrescribe
  ninguno de sus tres campos, aunque el proveedor devuelva un nombre distinto
  (R10).
- **E7 — Un `Customer` con el mismo correo y `supabaseUserId` nulo.** Dado un
  `Customer` cuyo `email` coincide con el del usuario que entra pero cuyo
  `supabaseUserId` es `null`, cuando esa persona entra por primera vez, entonces
  la fila antigua **no se toca** y se crea una nueva. El correo es un dato de
  contacto, no una identidad (R8, I3).
- **E8 — Dos primeros logins concurrentes.** Dadas dos peticiones simultáneas
  para el mismo `user.id` (dos pestañas, un doble envío del callback, un
  reintento del navegador), cuando ambas intentan crear el `Customer`, entonces
  al terminar hay **exactamente una** fila, **ninguna** de las dos peticiones
  responde 5xx y las dos acaban en el destino normal. La colisión del índice
  único `supabaseUserId` se resuelve releyendo la fila ganadora, no propagando el
  error (R12).

### Perfil

- **E9 — Ver y guardar el perfil.** Dada una persona con sesión, cuando abre
  `/cuenta`, entonces ve sus tres campos con los valores guardados; cuando los
  edita y guarda con valores válidos (R15), entonces la pantalla confirma el
  guardado y una recarga muestra los valores nuevos.
- **E10 — Perfil inválido.** Cuando guarda con un teléfono de 3 dígitos o un
  nombre vacío, entonces **no** se guarda nada, el error se muestra junto al
  campo y los demás valores tecleados se conservan.
- **E11 — Perfil ajeno.** Dada una petición de guardado que intenta indicar de
  algún modo _a qué_ `Customer` escribe, entonces ese dato se ignora: la fila
  afectada se determina **solo** por la sesión (R20).

### Autocompletado en el checkout

- **E12 — Campos vacíos.** Dada una persona con sesión y perfil
  `{ name: "Ana Pérez", phone: "+53 5555 5555", email: "ana@x.cu" }`, cuando abre
  `/[slug]/checkout` con el formulario recién cargado, entonces nombre, teléfono
  y correo aparecen rellenos con esos valores y puede confirmar sin teclear
  ninguno.
- **E13 — Lo tecleado gana (D4).** Dado que ya escribió «Ana P.» en el nombre
  cuando llega el perfil, entonces el nombre **sigue** siendo «Ana P.» y solo se
  rellenan los campos que estaban vacíos. Un campo que la persona **vació a
  propósito** cuenta como tecleado y tampoco se rellena.
- **E14 — Perfil incompleto.** Dado un perfil con nombre y correo pero sin
  teléfono, entonces se rellenan nombre y correo y el teléfono queda vacío, con
  su validación de siempre.
- **E15 — Entrar a mitad del checkout (D4).** Dado un carrito con productos y el
  formulario a medio llenar en `/[slug]/checkout`, cuando la persona va a entrar
  y vuelve, entonces: el carrito tiene **los mismos productos y cantidades**, la
  URL vuelve a ser `/[slug]/checkout`, y los campos que había tecleado se
  vuelven a poder teclear sin que se pierda el pedido. Lo que se conserva del
  formulario a través del viaje **no** se promete (R16); el carrito, sí.

### El pedido: invitado y con sesión

- **E16 — Invitado, igual que hoy.** Dado un navegador **sin ninguna cookie**,
  cuando se arma un carrito y se confirma el pedido, entonces ocurre exactamente
  lo de F-010 E10/E11: se crea el `Order` en `PENDING` **con `customerId` a
  `null`**, el carrito se vacía y la pantalla acaba en `/[slug]/pedido/[code]`.
  Ningún paso pide entrar, ningún texto sugiere que haga falta, y **nada del
  formulario aparece deshabilitado mientras se resuelve si hay sesión** (R17).
- **E28 — Con sesión, el pedido queda enlazado (D6).** Dada una persona con
  sesión válida y su `Customer`, cuando confirma el pedido, entonces el `Order`
  se crea igual que en E16 salvo por un dato: `customerId` es el `id` de **su**
  `Customer`. El contacto del pedido sigue siendo el que hay en el formulario, no
  el del perfil; el `Customer` **no** se modifica (R13); y ninguna pantalla nueva
  aparece.
- **E17 — Sesión expirada, o irresoluble, a mitad del checkout.** Dado que la
  sesión de cliente caduca, se invalida o simplemente no se puede resolver
  (Supabase no responde) mientras se llena el formulario, cuando la persona
  confirma, entonces el pedido se crea igual, como invitado y con `customerId` a
  `null`, con lo que hay en el formulario. No hay redirección a entrar, no se
  pierde nada de lo tecleado y no aparece ningún error bloqueante: **resolver la
  identidad nunca puede impedir un pedido** (R14).

### Las dos sesiones

- **E18 — Conviven.** Dado un navegador con sesión de admin (`qab-admin-session`)
  y sesión de cliente a la vez, entonces `/admin` sigue funcionando y `/cuenta`
  también; cerrar la sesión de cliente **no** cierra la de admin, y cerrar la de
  admin **no** cierra la de cliente.

### Errores visibles

- **E19 — Código de OAuth inválido o caducado.** Dado un `/auth/callback` con un
  `code` que Supabase rechaza, entonces **no** se crea sesión ni `Customer`, y la
  persona acaba en `/cuenta/entrar` con un mensaje que explica que el acceso
  caducó y le ofrece intentarlo otra vez. Nunca una pantalla de error de Next ni
  un 500.
- **E20 — El proveedor devuelve un error o la persona cancela.** Dado un regreso
  a `/auth/callback` con `error=access_denied` (o cualquier `error`), entonces se
  vuelve a `/cuenta/entrar` con un mensaje neutro («No se completó el acceso»),
  sin sesión y sin `Customer`.
- **E21 — Código de correo incorrecto, caducado o ya usado.** Entonces el mensaje
  lo dice, el campo del código queda enfocado y hay un botón para pedir uno
  nuevo. Después de R5 intentos fallidos seguidos con el mismo código, la
  pantalla ofrece solo pedir uno nuevo.
- **E22 — Correo sin confirmar.** Dado un proyecto Supabase configurado para
  exigir confirmación y una cuenta con el correo sin confirmar, cuando Supabase
  responde `email_not_confirmed`, entonces se muestra «Todavía no confirmaste
  ese correo: busca el mensaje de confirmación o pide un código nuevo». No se
  crea sesión ni `Customer`.
- **E23 — Provider no habilitado.** Dado que el proyecto no tiene habilitado,
  por ejemplo, `apple`, cuando alguien pulsa ese botón, entonces se muestra «Ese
  método de acceso no está disponible ahora mismo» y los demás siguen
  funcionando. Nada se rompe.
- **E24 — `/cuenta` sin sesión.** Dado un visitante sin sesión, cuando abre
  `/cuenta`, entonces ve `/cuenta/entrar` (redirección) y **no** un error ni un 404.
- **E25 — Sesión expirada al abrir `/cuenta`.** Entonces se ve `/cuenta/entrar`
  con «Tu sesión se cerró. Vuelve a entrar», y al entrar se llega otra vez a
  `/cuenta`.
- **E26 — Supabase Auth sin configurar.** Dado un entorno donde
  `NEXT_PUBLIC_SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_ANON_KEY` están vacías
  (el estado de hoy de este worktree, `src/lib/env.ts` las deja en `""`),
  entonces `npm run build` **termina en 0**, `/cuenta/entrar` responde 200 con un
  aviso de que el acceso no está disponible, y **la tienda y el checkout
  funcionan con normalidad**. Un fallo de configuración de Auth nunca puede
  tumbar la tienda.
- **E27 — `next` manipulado.** Dado `/auth/callback?code=...&next=https://otro.com`
  (o `//otro.com`, o `/../x`), entonces se ignora y se redirige a `/cuenta`
  (R7).

## Reglas de negocio

**Acceso**

- **R1** — La cuenta es **global**: una sesión vale para todas las tiendas y las
  rutas de cuenta viven fuera de `/[slug]` (D1).
- **R2** — Los cuatro métodos de acceso dan **la misma** cuenta: no hay
  diferencias de permiso, de pantalla ni de datos según por dónde se entró.
- **R3** — El acceso por correo es con **código de un solo uso de 6 dígitos
  tecleado en la misma pestaña**, no con contraseña ni con enlace mágico. Motivo:
  (a) una contraseña arrastra registro, cambio y recuperación, que D2 deja fuera;
  (b) un enlace mágico se abre a menudo en el navegador embebido de la app de
  correo, que es **otro** contexto de navegador, y allí el carrito de
  `src/features/cart/cartStore.ts` —`localStorage`— no existe: D4 quedaría
  incumplida justo en el caso que la motiva.
- **R4** — El acceso no exige que el correo del perfil coincida con el correo con
  el que se entró: son campos distintos y el del perfil es editable.
- **R5** — Tres intentos fallidos seguidos del mismo código agotan ese código
  (E21). El límite de envíos por correo y por minuto es el que imponga Supabase;
  F-012 no añade el suyo.
- **R6** — Después de entrar, el destino es el `next` guardado antes de empezar
  el flujo; si no hay ninguno, `/cuenta`.
- **R7** — `next` solo se acepta si es una **ruta relativa del propio sitio**:
  empieza por `/`, no empieza por `//`, no contiene `..` y no trae esquema. En
  cualquier otro caso se usa `/cuenta`. Sin esto, `/auth/callback` es un
  redirector abierto con la cookie recién puesta.

**Identidad y `Customer`**

- **R8** — La identidad de un `Customer` es `supabaseUserId` y **solo**
  `supabaseUserId`. Nunca se busca, se enlaza ni se fusiona por correo o por
  teléfono. El `email` de `Customer` es dato de contacto tecleado por una
  persona, no una credencial verificada: enlazar por él convertiría cualquier
  fila futura en un camino de apropiación de cuenta.
- **R9** — En la creación (y solo en ella) se copian del usuario de Supabase:
  - `email` ← `user.email` si lo hay;
  - `name` ← el primero no vacío de `user.user_metadata.full_name` y
    `user.user_metadata.name`, recortado al máximo de `src/constants/orders.ts`;
  - `phone` ← **nada**: queda `null` (ni Google ni Apple lo dan de forma fiable, y
    Apple además puede no dar ni el nombre ni un correo real).

  **No se copia ni se guarda en ningún sitio**: la foto o `avatar_url`, el
  identificador del proveedor, el idioma, ningún token de acceso o de refresco
  del proveedor y ninguna copia del blob de `user_metadata`. F-012 **no añade
  columnas**: lo que no cabe en `Customer` no se guarda (I1).

- **R10** — Los logins siguientes **no** escriben en `Customer`. El perfil es de
  quien lo edita desde que existe; el proveedor solo lo siembra.
- **R11** — Ninguna página cacheada por ISR renderiza HTML que dependa de la
  sesión. `src/app/[slug]/layout.tsx` y las páginas de catálogo comparten su HTML
  entre todos los visitantes: un saludo con nombre allí sería el nombre de otro.
- **R12** — La creación del `Customer` es **idempotente por `supabaseUserId`** y
  segura ante concurrencia: se resuelve en un solo viaje a la base apoyándose en
  el índice único que ya existe, y una colisión se traduce en releer la fila, no
  en un error. Nada de `$transaction` con el cliente global (`AGENTS.md` § Cosas
  que muerden: el pooler corre en modo transacción). **No hace falta migración**:
  `supabaseUserId String? @unique` ya está en `prisma/schema.prisma`.

**Checkout**

- **R13** — Confirmar un pedido **nunca** escribe en `Customer`. El perfil se
  escribe desde `/cuenta` y en el primer login, y de ningún otro sitio. Desde D6
  esta regla importa **más**, no menos: el pedido enlaza con la cuenta (R14), y la
  tentación inmediata es aprovechar para «actualizar» el perfil con el contacto
  del formulario. No se hace: el teléfono con el que alguien pide hoy para su
  madre no es su teléfono.
- **R14** — `Order.customerId` se escribe con el `id` del `Customer` de quien
  confirma **cuando hay sesión válida**, y con `null` cuando no la hay (**D6**,
  decisión del humano del 2026-08-29, que **revoca** la versión anterior de esta
  regla, la cual dejaba `customerId` siempre a `null`). Motivo del humano:
  enlazar hoy cuesta una línea, porque el campo ya existe y es nullable, y no
  hacerlo deja huérfanos para siempre todos los pedidos hasta que exista el
  feature de historial. Con tres condiciones que sí son de esta spec:
  - el `customerId` sale **solo** de la sesión resuelta en el servidor: si viene
    en el cuerpo, en la query o en una cabecera de la petición, se **ignora**, o
    cualquiera podría colgar sus pedidos de la cuenta de otro;
  - resolver la identidad **nunca** puede impedir, retrasar visiblemente ni hacer
    fallar la creación del pedido: si no se puede resolver, se escribe `null`
    (E17);
  - el enlace **no** enciende ninguna pantalla nueva (§ Fuera) ni cambia nada de
    lo que ve el POS (§ Datos y contrato).
- **R15** — Los tres campos del perfil se validan con **las mismas** reglas y los
  mismos límites que el contacto del pedido (`src/constants/orders.ts`:
  `CONTACT_NAME_MIN_LENGTH`, `CONTACT_NAME_MAX_LENGTH`,
  `CONTACT_PHONE_MIN_DIGITS`, `CONTACT_PHONE_MAX_DIGITS`,
  `CONTACT_EMAIL_MAX_LENGTH`), o un perfil «válido» podría autocompletar un
  formulario que después se rechaza. Un perfil puede tener **campos vacíos**; lo
  que no puede es tener un valor que no pasaría el checkout.
- **R16** — Lo que se conserva al ir a entrar y volver es el **carrito** y la
  **ruta**. F-012 no promete conservar lo tecleado en el formulario durante ese
  viaje; sí promete que al volver el perfil rellena los campos vacíos, que es lo
  que hace que no se note.
- **R17** — El checkout **no espera** a saber si hay sesión: los campos de
  contacto se pintan y se pueden escribir desde el primer instante, igual que
  hoy. Si el perfil llega tarde, solo rellena lo que siga vacío (E13).
- **R18** — Nada de F-012 puede hacer que `src/app/[slug]/**` o
  `src/features/orders/**` lean cookies de sesión: el criterio 4 de F-010 se
  verifica, literalmente, con
  `grep -rn "cookies()" src/features/orders/ src/app/\[slug\]/` vacío
  (`.agent/specs/F-010/spec.md`, criterio 4). Ver I4: es la restricción que más
  condiciona **dónde** se lee el perfil para autocompletar, y la resuelve
  `sdd-architect`.

**Sesiones**

- **R19** — La sesión de cliente se lee y se escribe en **un solo módulo**,
  lib/auth/customerSession.ts (por crear), y el nombre de su cookie es una
  **constante exportada** desde ahí. Ningún otro archivo lee cookies de sesión de
  cliente a mano (`AGENTS.md` § Prohibiciones).
- **R20** — Toda ruta de cuenta deriva la identidad **solo** de la sesión. Ningún
  identificador de cliente viaja en el cuerpo, en la query ni en una cabecera.
- **R21** — El nombre de la cookie de cliente y `ADMIN_COOKIE`
  (`src/lib/auth/adminSession.ts`, valor `qab-admin-session`) son **distintos**, y
  ninguno es prefijo del otro. Cerrar una sesión borra únicamente sus propias
  cookies.
- **R22** — Si hace falta refrescar la sesión de cliente en `src/proxy.ts`, su
  `matcher` puede crecer hacia `/cuenta` y `/auth`, **jamás** hacia `/[slug]`
  (`AGENTS.md` § Cosas que muerden, ficha
  `.agent/playbook/proxy-matcher-anula-isr.md`). Y no basta con añadir la ruta:
  hoy el proxy **redirige a `/?admin=sesion-requerida` toda ruta del `matcher`
  sin `ADMIN_COOKIE`**, así que meter `/cuenta` sin bifurcar por ruta mandaría a
  la portada a todo comprador sin sesión de admin (I5).

**Presencia en la tienda**

- **R23** — Hay un punto de entrada a la cuenta en la cabecera de la tienda
  (D7) y **se resuelve en el navegador**: el HTML que sirve el CDN es idéntico
  para todos (R11). No puede llevar `"use client"` a ningún componente que
  renderice catálogo (`AGENTS.md` § Prohibiciones), no puede bloquear ni retrasar
  la primera pintura del catálogo, y sin JavaScript deja como mucho un enlace
  estático a `/cuenta`, nunca un nombre ni un estado de sesión. Pesa contra el
  presupuesto de JavaScript de cliente, así que entre dos formas que cumplan lo
  anterior gana la que menos pese (`AGENTS.md` § El presupuesto de JavaScript no
  es un muro). Su forma la decide `sdd-designer`.

## Casos límite y errores

| Situación                                            | Qué hace el sistema                                              | Qué ve la persona                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| `code` de OAuth inválido o caducado (E19)            | Sin sesión, sin `Customer`; vuelta a `/cuenta/entrar`            | «El acceso caducó. Vuelve a intentarlo.»               |
| El proveedor devuelve `error` / se cancela (E20)     | Igual, sin registrar nada                                        | «No se completó el acceso.»                            |
| Código de correo incorrecto o caducado (E21)         | Sin sesión; el código se agota a los 3 fallos                    | Error junto al campo y «Pedir un código nuevo»         |
| Correo sin confirmar (E22)                           | Sin sesión                                                       | «Todavía no confirmaste ese correo…»                   |
| Provider deshabilitado en el proyecto (E23)          | Nada cambia; el resto de botones siguen                          | «Ese método no está disponible ahora mismo.»           |
| Sesión expirada a mitad del checkout (E17)           | Sigue como invitado; el pedido se crea con `customerId` a `null` | Nada bloqueante; el enlace de cuenta vuelve a «Entrar» |
| Sesión expirada al abrir `/cuenta` (E25)             | Redirección a `/cuenta/entrar` con `next=/cuenta`                | «Tu sesión se cerró. Vuelve a entrar.»                 |
| Supabase Auth sin configurar (E26)                   | Tienda y checkout intactos; `npm run build` sale 0               | Aviso en `/cuenta/entrar`; ningún error de la tienda   |
| Dos primeros logins a la vez (E8)                    | Un solo `Customer`; la colisión se relee (R12)                   | Nada: entra normalmente                                |
| Ya hay un `Customer` con ese correo, sin enlace (E7) | Se crea uno nuevo; la fila vieja no se toca (R8)                 | Nada                                                   |
| `next` a otro dominio (E27)                          | Se ignora; destino `/cuenta` (R7)                                | Acaba en su cuenta                                     |
| Perfil con teléfono inválido (E10)                   | No se guarda nada                                                | Error junto al campo, lo demás intacto                 |
| Supabase no responde al confirmar (E17)              | El pedido se crea igual, sin enlazar (R14)                       | Nada: el pedido sale como siempre                      |
| Sin JavaScript                                       | No se puede entrar (el flujo es de cliente)                      | La tienda y el catálogo se siguen leyendo (R11, R23)   |

## Datos y contrato

**`Customer`** — sin cambios de schema. Los cuatro campos que F-012 toca:

| Campo            | Tipo      | Obligatorio   | Quién lo escribe                            |
| ---------------- | --------- | ------------- | ------------------------------------------- |
| `supabaseUserId` | `String?` | sí, `@unique` | Solo la creación del primer login (R8, R12) |
| `name`           | `String?` | no            | Primer login (R9) y `/cuenta`               |
| `phone`          | `String?` | no            | Solo `/cuenta` — nunca el proveedor (R9)    |
| `email`          | `String?` | no            | Primer login (R9) y `/cuenta`               |

`addresses` no se lee ni se escribe (§ Fuera). De `orders`, F-012 escribe **un
solo campo**: `Order.customerId` en el momento de crear el pedido (R14). Ningún
pedido ya existente se actualiza, y ningún otro campo de `Order` cambia.

**Perfil, tal como lo consume el checkout**: tres cadenas ya normalizadas y
recortadas —`name`, `phone`, `email`— o la ausencia de perfil. Nada más cruza
esa frontera: ni `id`, ni `supabaseUserId`, ni fechas. Es la misma regla que
F-010 R22 (a un componente de cliente solo le llegan datos planos), y evita que
el identificador interno de un cliente circule por el navegador.

**Límites y formato**: los de `src/constants/orders.ts` (R15). Teléfono
normalizado con las funciones que ya usa el pedido
(`src/features/orders/contact.ts`), para que un perfil guardado no pueda producir
un pedido rechazado.

**Contrato con cuadrecaja**: **ninguno**. F-012 no toca `docs/sync-contract.md`
y no cambia el payload de `/api/internal/orders`: `customerId` no aparece hoy ni
en `src/features/orders/server/pull.ts`, ni en `src/features/orders/types.ts`, ni
en `docs/sync-contract.md`, así que escribirlo (R14) es invisible para el POS. El
pedido que viaja al POS sigue siendo el mismo byte a byte.

## Criterios de aceptación propuestos

Los **seis** de `.agent/features.json`, en su orden, cada uno con lo que hay que
**ejecutar** para darlo por cierto. Los archivos de prueba que se nombran no
existen todavía; sus rutas exactas las fija `sdd-architect` y las crea
`sdd-tester`.

1. `[ya]` **«Se puede iniciar sesión con Google, Facebook, Apple y correo.»** —
   se parte en dos mitades, según D3:

   1a. **Correo, de punta a punta.** Con las claves de un proyecto Supabase de
   desarrollo en `.env`, `npm run dev`, abrir `/cuenta/entrar`, pedir el código
   para una bandeja controlada, teclearlo, y comprobar los tres hechos: (i) el
   navegador acaba en `/cuenta`; (ii) `/cuenta` muestra el perfil; (iii)
   `psql "$DATABASE_URL" -c 'select count(*) from "Customer" where "supabaseUserId" is not null'`
   sube exactamente en 1. El procedimiento y sus asertos quedan escritos en
   .agent/specs/F-012/smoke.sh (por crear), copiado de
   `.agent/templates/smoke.sh`, con los pasos manuales marcados como tales: una
   verificación que no queda escrita es una que nadie repite.

   1b. **Los tres proveedores, por contrato.** `npm test` con pruebas que
   comprueban, sin red: (i) pulsar cada uno de los tres botones llama a
   `signInWithOAuth` **una** vez, con `provider` `google`, `facebook` y `apple`
   respectivamente y con
   `redirectTo === "<origen>/auth/callback?next=<destino codificado>"`; (ii) una
   petición a `/auth/callback?code=abc&next=/cuenta` llama a
   `exchangeCodeForSession("abc")` y responde 307 a `/cuenta`; (iii) con el canje
   fallando, responde 307 a `/cuenta/entrar` con el aviso de error y **no** crea
   ningún `Customer` (E19).

2. `[ya]` **«El primer inicio de sesión crea un Customer enlazado por
   supabaseUserId.»** — `npm test` sobre la función de `features/*/server/` que
   lo hace, contra la base local:
   - llamada 1 con `user.id = U` → hay 1 fila con `supabaseUserId = U`;
   - llamada 2 con el mismo `U` y otro `full_name` → sigue habiendo 1 fila y el
     `name` **no** cambió (E6, R10);
   - con una fila previa `{ email: "ana@x.cu", supabaseUserId: null }` y un
     `user` con ese mismo correo → quedan **2** filas y la vieja sigue con
     `supabaseUserId` nulo (E7, R8);
   - `await Promise.all([ensure(U), ensure(U)])` resuelve las dos sin excepción y
     `select count(*) ... where "supabaseUserId" = U` devuelve **1** (E8, R12);
   - `npx prisma migrate status` no reporta ninguna migración pendiente: F-012 no
     añade ninguna.

3. `[ya]` **«Los datos de contacto guardados se autocompletan en el siguiente
   pedido.»** — `npm test` en jsdom sobre el formulario de checkout
   (`src/features/cart/components/CheckoutForm.tsx`):
   - con perfil `{name, phone, email}` y formulario recién montado, los tres
     `input` valen exactamente eso y se puede enviar sin teclear (E12);
   - con «Ana P.» ya tecleado en el nombre antes de que llegue el perfil, el
     nombre sigue siendo «Ana P.» y el resto sí se rellena (E13, D4);
   - con perfil sin teléfono, el teléfono queda vacío (E14);
   - sin sesión, los tres quedan vacíos y **no** aparece ningún error (E16).

   Y de punta a punta en .agent/specs/F-012/smoke.sh (por crear): con sesión y
   perfil guardado, abrir `/tienda-demo/checkout` con el carrito lleno y ver los
   campos rellenos.

4. `[ya]` **«Un pedido de invitado sigue siendo posible: la ruta de checkout no
   exige sesión.»** — se verifica exactamente con lo que ya verificaba F-010, y
   tiene que seguir dando lo mismo:
   - el mismo `POST /api/orders` **sin cabecera `Cookie`** responde 201;
   - `grep -rn "cookies()" src/features/orders/ src/app/\[slug\]/` no devuelve
     nada (R18);
   - `npm test` con la suite de F-010 en verde, sin cambios en sus asertos;
   - `npm run build` sigue marcando `/[slug]/checkout` como `ƒ` y `/[slug]` como
     `●`;
   - `grep -n "slug" src/proxy.ts` no devuelve nada dentro del `matcher` (R22).

   Y, **por D6**, la otra mitad del mismo comportamiento —que un pedido con
   sesión sí quede enlazado sin que nada de eso deje de cumplirse— se verifica
   contra la base con el pedido recién creado:
   - sin sesión:
     `psql "$DATABASE_URL" -c 'select "customerId" from "Order" where code = ...'`
     devuelve `NULL` (E16);
   - con sesión válida: la misma consulta devuelve el `id` del `Customer` de esa
     persona, y `select count(*) from "Customer"` no sube (el enlace no crea
     clientes, R13);
   - con la sesión caducada a mitad: devuelve `NULL` y el pedido existe igual
     (E17).

5. `[ya]` **«Las sesiones de cliente y de admin no comparten cookie: sus nombres
   son distintos.»** — `npm test` con dos pruebas y una comprobación con la app
   en pie:
   - una prueba que compara la constante del nombre de cookie de cliente
     (lib/auth/customerSession.ts, por crear) con `ADMIN_COOKIE` de
     `src/lib/auth/adminSession.ts`: son distintas y ninguna es prefijo de la
     otra (R21);
   - una prueba de la ruta de cerrar sesión de cliente: las cookies que borra no
     incluyen `qab-admin-session`, y la de cerrar sesión de admin no borra
     ninguna de cliente (E18, R19);
   - en .agent/specs/F-012/smoke.sh (por crear): con las dos sesiones vivas en el
     mismo navegador, `/admin` y `/cuenta` responden 200 a la vez, y tras cerrar
     la de cliente `/admin` sigue en 200.

6. `[ya]` **«Con Supabase Auth sin configurar, la tienda y el checkout funcionan
   igual y el build pasa.»** → con `NEXT_PUBLIC_SUPABASE_URL=""`,
   `npm run build` sale 0, la portada de una tienda publicada responde 200
   (`curl -s -o /dev/null -w '%{http_code}' localhost:3000/tienda-demo`) y el
   pedido de invitado se crea igual (E26). Es el estado real de este worktree
   hoy y el modo más fácil de tumbar la tienda con un feature que nadie usa
   todavía.

Y, transversal a todos, `bash .agent/verify.sh F-012 --full` en 0.

El humano aceptó el criterio 6 y lo escribió él mismo en `.agent/features.json`
el 2026-08-29 (regla 4). **Ya no queda ningún criterio propuesto**: el otro que
esta spec había propuesto —que `/auth/callback` no redirija fuera del sitio— no
entra como criterio de aceptación por decisión del humano (D8), pero **R7 y E27
siguen vigentes**: la protección se implementa y se prueba igual. Su prueba
—`next` valiendo `https://otro.com`, `//otro.com`, `/../x` o `javascript:…`, y
las cuatro acabando en `/cuenta`— va en la suite del callback junto a la del
criterio 1b; lo único que cambia es que no es una puerta para `passes: true`.

## Incongruencias detectadas

- **I1 — El comentario de `Customer` promete historial; F-012 guarda el dato
  pero no lo enseña.** `prisma/schema.prisma` dice de `Customer`: «an account
  only persists contact details **and order history**». Tras D6 la mitad de datos
  ya es cierta —`Order.customerId` se escribe (R14) y el índice
  `@@index([customerId])` de `Order` pasa a tener sentido—, pero **no hay ninguna
  pantalla de historial** y consultarlo no es posible desde la aplicación. La
  frase del schema seguirá siendo una promesa a medias hasta que el humano meta
  el historial en el backlog (regla 4). Quien lea ese comentario y busque la
  pantalla, no la va a encontrar.
- **I2 — `Customer` no tiene dónde guardar nada de un proveedor OAuth.** No hay
  columna para foto, ni para el identificador del proveedor, ni para el proveedor
  mismo. Lejos de ser un problema, es lo que hace que R9 no necesite migración:
  se copia lo que cabe y se descarta el resto. Si alguien propone añadir columnas
  para esto, está fuera de alcance.
- **I3 — El correo de `Customer` no es una credencial.** Es el mismo campo que el
  checkout de invitado rellenaría si algún día creara `Customer` (hoy no lo hace:
  `createOrder.ts:249`). Enlazar por correo (E7) sería, en cuanto exista
  cualquier camino que cree filas con correo sin verificar, un camino de
  apropiación de cuentas. De ahí R8, que es más estricta de lo que el criterio 2
  exige.
- **I4 — El criterio 3 tira hacia leer la sesión donde el criterio 4 de F-010
  prohíbe leerla.** F-010 verifica su criterio 4 con
  `grep -rn "cookies()" src/features/orders/ src/app/\[slug\]/` vacío
  (`.agent/specs/F-010/spec.md`, criterio 4) y con su R24. Autocompletar el
  formulario desde el servidor en `src/app/[slug]/checkout/page.tsx` haría que ese
  grep dejara de estar vacío y rompería la verificación de un feature ya cerrado.
  **Y desde D6 la restricción vale también en el sentido de escritura**: el
  pedido tiene que quedar enlazado (R14) sin que aparezca `cookies()` en esos dos
  árboles. Verificado en `.agent/specs/F-010/tests.md`, fila 4, que ejecuta
  `git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"` y exige que no
  devuelva nada.
  La spec no elige el mecanismo —es de `sdd-architect`—, pero sí fija la
  obligación (R18) y deja anotados dos insumos: el formulario ya es una isla de
  cliente que hace `fetch` a `/api/orders/quote`, y la creación del pedido entra
  por `src/app/api/orders/route.ts`, que **no está en ninguno de los dos árboles
  que el grep vigila**. Ver § No decidido a propósito.
- **I5 — Ampliar el `matcher` de `src/proxy.ts` con `/cuenta` sin más lo rompe
  todo.** El proxy de hoy redirige a `/?admin=sesion-requerida` **cualquier** ruta
  del `matcher` que no traiga `ADMIN_COOKIE`. Si el refresco de la sesión de
  cliente se resuelve ahí, hay que bifurcar por ruta primero. Y `/[slug]` no entra
  en el `matcher` en ningún caso (R22).
- **I6 — `AGENTS.md` dice que solo `lib/auth/*` lee cookies de sesión, y
  `src/lib/supabase/server.ts` ya lee todas las cookies** (`cookies()` +
  `createServerClient`). La lectura literal de la prohibición la incumpliría
  cualquier ruta que llame a `createSupabaseServerClient`. Lectura que propone
  esta spec, y que `sdd-architect` debe hacer explícita: la identidad del cliente
  se obtiene **únicamente** llamando a lib/auth/customerSession.ts (por crear); ese
  módulo puede usar `createSupabaseServerClient` por dentro, y ninguna ruta lee el
  nombre de una cookie de sesión por su cuenta.
- **I7 — El entorno de hoy no puede verificar el criterio 1.** `.env` sale de
  `.env.example`, cuyo `NEXT_PUBLIC_SUPABASE_URL` apunta al emulador de Storage
  local, que no habla Auth, y `NEXT_PUBLIC_SUPABASE_ANON_KEY` está vacía. Ya está
  anotado en `.agent/progress/F-012.md` § Bloqueado por; queda aquí porque es la
  causa de que el criterio 1 se parta en 1a y 1b (D3) y de que E26 sea un
  requisito y no un detalle.

## Huecos y preguntas al humano

Ninguna. D1 a D4 cerraron lo que estaba abierto antes de escribir, y D5 a D8
—del 2026-08-29, sobre la primera versión de este documento— cerraron lo que esta
spec había decidido por su cuenta: **D5** confirma R3 (código de 6 dígitos, ni
contraseña ni enlace mágico); **D6** revoca R14 y manda enlazar el pedido;
**D7** decide que sí hay punto de entrada en la cabecera (R23); **D8** convierte
el criterio propuesto 6 en criterio de `.agent/features.json` y deja el 7 fuera
sin tocar R7 ni E27. Lo que sigue decidido por esta spec, y por tanto discutible
en la firma del plan, es R8 (identidad solo por `supabaseUserId`) y R13 (el
checkout no escribe en `Customer`).

## No decidido a propósito

- **Dónde se lee el perfil para autocompletar el checkout** (ruta de API,
  componente, momento de la petición) — `sdd-architect`, con R18 e I4 como
  restricción dura.
- **El nombre exacto de la cookie de sesión de cliente** y si se personaliza el
  `storageKey` de `@supabase/ssr` — `sdd-architect`. Lo que la spec exige es que
  sea una constante exportada y distinta de `ADMIN_COOKIE` (R21).
- **Dónde vive el refresco de la sesión** (proxy con `matcher` ampliado, ruta de
  API, o ningún refresco) — `sdd-architect`, con R22 e I5.
- **Cómo se ve el punto de entrada de la cabecera** — `sdd-designer`. Que exista
  ya no está abierto (D7); lo que queda es el icono, su sitio, su rótulo y su
  comportamiento sin JavaScript, con R11 y R23 como límite.
- **Cómo llega el `customerId` a la creación del pedido** — `sdd-architect`, con
  R14, R18 e I4 como restricción dura. Insumo, no decisión: `POST /api/orders`
  vive en `src/app/api/orders/route.ts`, fuera de los dos árboles que vigila el
  criterio 4 de F-010, y `createOrder` ya recibe todo lo que escribe como
  argumento (`src/features/orders/server/createOrder.ts` fija hoy
  `customerId: null` en un solo sitio). Si el arquitecto encuentra un camino
  mejor, esta spec no se lo impide: lo que exige es el requisito, no el sitio.
- **Las contraseñas**, si alguna vez se quieren: D5 confirmó que el acceso por
  correo es por código (R3), así que un acceso con contraseña sería alcance nuevo
  y saldría como feature aparte, escrito por el humano (regla 4).
