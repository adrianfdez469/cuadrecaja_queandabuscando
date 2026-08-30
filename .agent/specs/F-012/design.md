---
feature: F-012
agente: sdd-designer
actualizado: 2026-08-29T04:29:37Z
estado: listo
---

## Qué se miró antes de diseñar

`AGENTS.md` completo (§ Arquitectura, § Prohibiciones, **§ El presupuesto de
JavaScript no es un muro**, § Cosas que muerden, § Idioma), `spec.md` de F-012
entera (E1–E27, R1–R22, la tabla de errores visibles, el contrato de datos, los
criterios y I1–I7), `.agent/progress/F-012.md` § Decisiones tomadas (D1–D8),
`.agent/specs/F-010/design.md` completa —de donde sale el lenguaje visual que
esto reutiliza—, y el código de `src/app/[slug]/layout.tsx`,
`src/features/cart/components/CartBadge.tsx`,
`src/features/cart/components/CheckoutForm.tsx`, `src/features/cart/cartStore.ts`,
`src/components/ui/` (`Button.tsx`, `Field.tsx`, `Alert.tsx`, `Card.tsx`,
`Container.tsx`, `RadioCard.tsx`), `src/theme/tokens.css`, `src/app/globals.css`,
`src/constants/orders.ts`, `src/lib/supabase/client.ts`, `src/proxy.ts` y
`src/app/sesion-cerrada/page.tsx`. Fichas leídas:
`.agent/playbook/bundle-fuera-de-presupuesto.md`,
`.agent/playbook/set-state-en-efecto-prohibido.md`,
`.agent/playbook/next-dev-uno-por-directorio.md`,
`.agent/playbook/check-harness-falso-positivo-ruta-abreviada.md`.

**`architecture.md` de F-012 todavía no existía** cuando escribí esto:
`sdd-architect` trabaja en paralelo. Lo que este documento necesita de él está
aislado en § Lo que la pantalla necesita, como cinco necesidades numeradas
NC1–NC5, cada una con qué pasa si la respuesta es «no se puede». **Ninguna de
las cinco cambia una pantalla**; cambian, como mucho, un estado de la cabecera.

### Lo que medí de verdad, y lo que no

Esto no son estimaciones de memoria. Lo ejecuté en este worktree hoy:

| Qué                                                                    | Cómo                                                                                            | Resultado                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Presupuesto de JS de hoy                                               | `npm run build` (salió 0) + `npm run check:bundle`                                              | **176,9 KB gzip** en la página más pesada, presupuesto 193 → **16,1 KB libres** |
| Página más pesada medida                                               | idem                                                                                            | `bodega-central/p/agua-natural-500-ml.html` (una `●` de ficha de producto)      |
| Qué pesa `createBrowserClient` de `@supabase/ssr` en el navegador      | `esbuild --bundle --minify --format=esm --platform=browser` sobre un módulo que solo lo importa | **61,2 KB gzip** (233,6 KB sin comprimir)                                       |
| Qué pesa solo el cliente de Auth (`AuthClient` de `@supabase/auth-js`) | idem                                                                                            | **23,9 KB gzip** (100,8 KB sin comprimir)                                       |
| La cabecera real, tal como se sirve hoy                                | `.next/server/app/tienda-demo.html` del build de arriba                                         | ver § 0, con su HTML citado                                                     |
| La cabecera a 360 y a 768                                              | build servido en estático y abierto en Chrome, ventana a 360×760 y 768×800                      | ver § 0                                                                         |

Las dos medidas de `esbuild` son un bundle aislado, sin la deduplicación que
Next hace con los chunks compartidos: la cifra real será algo menor, pero el
**orden de magnitud y la razón entre las dos** es lo que decide, y eso no cambia.

Lo que **no** pude mirar: las pantallas nuevas, porque no existen. Los pasos
`V1`–`V21` de § Verificación visual quedan escritos uno a uno para quien las
construya. Y el `next dev` que escucha en el 3000 de esta máquina **no es de este
worktree** (su `cwd` es `.orca-worktree-trash/wt-1787975564239-8d7709e1`): no
probé contra él a propósito, que es justo lo que avisa la ficha
`next-dev-uno-por-directorio`.

---

## Flujo de usuario

Una frase: **quien quiera deja de teclear sus datos entra una vez —por Google,
Facebook, Apple o un código de 6 dígitos—, vuelve exactamente a donde estaba, y
desde entonces el checkout le rellena los campos que dejó vacíos.**

```
      ┌── icono de la cabecera de cualquier página de tienda ─────────┐
      │        href /cuenta  (o /cuenta/entrar?next=/[slug]           │
      │                       si el cliente ya sabe que no hay sesión)│
      │                                                               │
/[slug]/checkout ── «Si ya tienes cuenta, entra…» ──┐                 │
      │  (carrito y ruta se conservan, R16)          │                 │
      ▼                                              ▼                 ▼
                        /cuenta/entrar?next=<destino>
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        │ Google / Facebook / Apple│ Correo                   │
        ▼                          ▼                          │
   proveedor externo         paso 1: correo                    │
        │                          │  «Enviarme un código»     │
        ▼                          ▼                          │
 /auth/callback?code=…&next=…  paso 2: código de 6 dígitos     │
        │  canjea, 307              │  ✓  ✗(1)  ✗(2)  ✗(3)=agotado
        │                          │  reenviar (30 s)          │
        └───────────┬──────────────┘                          │
                    ▼                                          │
        primer login → se crea el Customer (invisible)         │
                    ▼                                          │
              destino = next validado (R7), o /cuenta ─────────┘
                    │
     ┌──────────────┴───────────────┐
     ▼                              ▼
/[slug]/checkout               /cuenta
 carrito intacto,               perfil: nombre · teléfono · correo
 campos vacíos rellenos          guardar · cerrar sesión → /
```

**Los dos puntos de entrada, y dónde vuelve cada uno.**

| Desde                                            | Enlace                                 | `next`             | Al terminar aterriza en                 |
| ------------------------------------------------ | -------------------------------------- | ------------------ | --------------------------------------- |
| Icono de la cabecera, con sesión                 | `/cuenta?desde=/[slug]`                | —                  | `/cuenta`, con «Volver a la tienda»     |
| Icono de la cabecera, sin sesión o sin saber     | `/cuenta` → redirige (E24)             | `/cuenta`          | `/cuenta`                               |
| Icono de la cabecera, sabiendo que no hay sesión | `/cuenta/entrar?next=/[slug]`          | `/[slug]`          | La portada de esa tienda                |
| Línea del checkout                               | `/cuenta/entrar?next=/[slug]/checkout` | `/[slug]/checkout` | **El checkout, con el carrito intacto** |
| `/cuenta` sin sesión (E24)                       | redirección del servidor               | `/cuenta`          | `/cuenta`                               |
| Sesión caducada al abrir `/cuenta` (E25)         | redirección + `aviso=sesion`           | `/cuenta`          | `/cuenta`                               |

**Vueltas atrás y qué se pierde.**

| Desde → hacia                                       | Qué se conserva                                                                      | Qué se pierde                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Checkout → `/cuenta/entrar` → checkout (E15, D4)    | **El carrito entero** (`localStorage`, `cartStore`) y la ruta                        | **Lo tecleado en el formulario** (R16). Por eso el enlace avisa cuando hay algo escrito, y por eso al volver el perfil lo rellena. |
| Paso «código» → paso «correo» («Cambiar el correo») | El correo tecleado, para no volver a escribirlo                                      | El código pedido: hay que pedir otro                                                                                               |
| `/cuenta/entrar` → «Volver sin entrar»              | Todo lo del origen (el carrito nunca se toca)                                        | Nada                                                                                                                               |
| Botón atrás del navegador desde `/auth/callback`    | —                                                                                    | Nada: el callback no deja entrada propia en el historial (307, no render)                                                          |
| Cerrar sesión → `/`                                 | **El carrito de cada tienda** (E4, R19: solo se borran las cookies de Supabase Auth) | La sesión. Nada más.                                                                                                               |

**Lo que D6 cambia en la interfaz: nada.** Que `Order.customerId` pase a
escribirse cuando hay sesión no añade ni una pantalla ni una línea de texto —
no hay historial de pedidos (D2 sigue intacta) y el comprobante de F-010 no
cambia. Lo digo explícitamente porque «el pedido queda enlazado» suena a algo
que se ve, y no se ve.

---

## Inventario de pantallas y estados

### 0 · El icono de cuenta en la cabecera de la tienda (D7)

Vive en `src/app/[slug]/layout.tsx`, al lado de `CartBadge`. La cabecera que se
sirve **hoy**, sacada del build de esta mañana (`.next/server/app/tienda-demo.html`),
es esta y no cambia de altura:

```html
<header class="bg-brand text-brand-contrast">
  <div class="flex items-center gap-3 py-5 …">
    <a class="min-w-0 flex-1 truncate text-xl font-semibold …" href="/tienda-demo"
      >La Rampa · Vedado</a
    >
    <span class="hidden text-sm opacity-80 sm:inline">· La Habana</span>
    <a
      class="text-sm font-medium whitespace-nowrap …"
      aria-label="Carrito"
      href="/tienda-demo/carrito"
      >Carrito</a
    >
  </div>
</header>
```

Abierta a 360 en Chrome, entre el final del nombre y la palabra «Carrito» sobran
del orden de **180 px**: el icono cabe sin apretar nada, y un nombre más largo
sigue truncándose como ya lo hace (`flex-1 truncate`).

**La restricción que manda (R11).** Ese HTML es ISR (`revalidate = 3600`) y lo
comparten todos los visitantes. Así que **el HTML tiene que ser idéntico para
todo el mundo** y el estado de sesión solo puede aparecer después, en el
navegador. La técnica es exactamente la de `CartBadge`: el componente lleva
`"use client"`, su `getServerSnapshot()` devuelve **«desconocido»**, y el adorno
que distingue los estados **solo se renderiza en el estado definido**. Así el
HTML prerenderizado y el primer render de hidratación coinciden, no hay
_mismatch_ y no se pinta nunca una mentira.

**Los tres estados, y por qué ninguno mueve un píxel.**

| Estado                                                                                                        | `href`                        | Qué se ve                                                                                                                     | `aria-label`         |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Desconocido** — el primer frame, el HTML cacheado, y para siempre si el JS nunca llega o si NC1 no se puede | `/cuenta?desde=/[slug]`       | El glifo de persona, contorno, `currentColor`. Sin punto.                                                                     | `Tu cuenta`          |
| **Invitado** — el cliente ya sabe que no hay sesión                                                           | `/cuenta/entrar?next=/[slug]` | **Exactamente lo mismo.** Sin punto.                                                                                          | `Entrar a tu cuenta` |
| **Con sesión**                                                                                                | `/cuenta?desde=/[slug]`       | Lo mismo **más** un punto de 8 px en la esquina superior derecha de la caja                                                   | `Tu cuenta`          |
| **Auth sin configurar (E26)**                                                                                 | —                             | **El icono no existe.** Lo decide el servidor leyendo `publicEnv`, que es igual para todos: sigue sin depender de quién mira. | —                    |

**Por qué no hay salto de layout, dicho con medidas:**

1. El ancla es **siempre** una caja de tamaño fijo: `relative inline-flex h-11 w-11
items-center justify-center -my-2` (44×44 de objetivo táctil). El `-my-2`
   compensa los 8 px que la caja se pasa de la altura de la fila, así que **la
   cabecera sigue midiendo 68 px** (`py-5` = 20 + 20, más los 28 px de la línea
   `text-xl`) y no crece 16 px en todas las páginas de tienda.
2. El glifo es un `<svg>` de 24×24 centrado, el mismo en los tres estados.
3. El punto de «con sesión» es `absolute top-1.5 right-1.5 h-2 w-2 rounded-full`,
   fuera del flujo: aparecer o desaparecer no reordena nada.
4. El texto visible **no depende de la sesión**. A partir de `sm` se ve la
   palabra `Cuenta` al lado del glifo, y dice `Cuenta` en los tres estados. Lo
   que cambia con la sesión es el `aria-label` y el `href`, que no ocupan
   espacio. Si el rótulo pasara de `Entrar` a `Cuenta` al hidratar, el ancho de
   la cabecera se movería delante de los ojos de todo el mundo.

**Dónde aparece.** En las cuatro variantes de cabecera que hoy existen: tienda
abierta, tienda cerrada, y la cabecera de marca del selector de sucursales. La
razón por la que `CartBadge` desaparece de una tienda cerrada —«aquí no hay nada
que comprar»— no vale para la cuenta, que es global (D1) y sigue teniendo
sentido. Coste extra: ninguno, es el mismo componente.

**Orden dentro de la cabecera:** nombre · ciudad (`sm+`) · `Carrito` · icono de
cuenta. El carrito es la acción primaria y se queda con su palabra; la cuenta es
el punto de entrada discreto que pidió D7 y a 360 es solo el glifo.

### 1 · `/cuenta/entrar` — paso «correo» (el estado inicial)

Fuera del slug (D1), así que **no hay cabecera de tienda ni tema de tienda**:
estas páginas son de queandabuscando y usan los tokens base. No se intenta
teñirlas con la marca de la tienda de origen: haría falta consultar la tienda a
partir de `next`, y el precio es una consulta y una página menos cacheable a
cambio de un color. Lo que sí hay, para que el salto no desoriente, es un enlace
de vuelta explícito.

Estructura: barra superior mínima (`bg-surface border-b`) con `queandabuscando`
enlazando a `/` y, si `next` es una ruta válida de tienda (R7), `Volver a la
tienda`. Debajo, una tarjeta centrada `max-w-sm`.

| Estado                                               | Qué se ve                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Normal**                                           | `<h1>Entrar a tu cuenta</h1>` + subtítulo. Tres botones `secondary` a todo el ancho, `min-h-12`, apilados: `Continuar con Google`, `Continuar con Facebook`, `Continuar con Apple`, cada uno con el glifo del proveedor en `<svg>` (decorativo, `aria-hidden`). Separador `o`. Campo `Correo` + botón primario `Enviarme un código`. Al pie: `No usamos contraseña: te mandamos un código de 6 dígitos.`                       |
| **Antes del JS**                                     | Todo el marcado está y se lee; los botones existen y son pulsables pero no hacen nada hasta hidratar. Un `<noscript>`: `Para entrar a tu cuenta necesitas activar JavaScript. Puedes seguir comprando sin cuenta: tus pedidos funcionan igual.` **Esto no es un callejón**: el pedido de invitado sigue siendo el camino completo.                                                                                             |
| **Correo vacío o mal escrito**                       | Error bajo el campo, `aria-invalid`, foco en el campo. No se llama a nadie.                                                                                                                                                                                                                                                                                                                                                    |
| **Enviando el código**                               | El `<fieldset>` entero deshabilitado, el botón con `aria-busy="true"` y texto `Enviando el código…`. Los tres botones de proveedor también quedan deshabilitados: no tiene sentido empezar dos accesos a la vez.                                                                                                                                                                                                               |
| **Enviado**                                          | Transición al paso «código» (§ 2). No hay navegación: misma URL, misma pestaña (R3), y por eso `next` y el carrito siguen exactamente donde estaban.                                                                                                                                                                                                                                                                           |
| **Demasiados envíos** (`over_email_send_rate_limit`) | `Alert tone="warning"` sobre el campo: `Pediste varios códigos seguidos. Espera un minuto y vuelve a intentarlo.` El botón queda deshabilitado con `aria-describedby` a ese aviso. El límite es el de Supabase; F-012 no añade el suyo (R5).                                                                                                                                                                                   |
| **Saliendo hacia un proveedor**                      | El botón pulsado pasa a `aria-busy` con `Abriendo Google…` (ídem los otros dos) y los demás se deshabilitan. Después la pestaña navega fuera: no hay más pantalla que diseñar.                                                                                                                                                                                                                                                 |
| **Proveedor no habilitado (E23)**                    | `Alert tone="danger"`: `Ese método de acceso no está disponible ahora mismo.` **Los otros tres siguen funcionando** y el foco vuelve al botón pulsado.                                                                                                                                                                                                                                                                         |
| **Red caída**                                        | `Alert tone="danger"`: `Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.` Nada se pierde: el correo tecleado sigue ahí.                                                                                                                                                                                                                                                                                |
| **Vuelta con error del callback (E19)**              | `Alert tone="danger"` arriba de la tarjeta, **renderizado por el servidor** desde `?aviso=caducado`: `El acceso caducó. Vuelve a intentarlo.` Se lee sin esperar el JS.                                                                                                                                                                                                                                                        |
| **Vuelta con `error` del proveedor (E20)**           | Igual, con `?aviso=cancelado`: `No se completó el acceso.` Tono `warning`: cancelar no es un fallo.                                                                                                                                                                                                                                                                                                                            |
| **Sesión caducada al abrir `/cuenta` (E25)**         | Igual, con `?aviso=sesion`: `Tu sesión se cerró. Vuelve a entrar.` Tono `warning`.                                                                                                                                                                                                                                                                                                                                             |
| **Auth sin configurar (E26)**                        | La página responde **200**. `Alert tone="warning"` arriba: `El acceso a tu cuenta no está disponible ahora mismo.` / `Puedes seguir comprando sin cuenta: tus pedidos funcionan igual.` Los cuatro métodos se pintan **deshabilitados**, con `aria-describedby` a ese aviso, en vez de desaparecer: un formulario que se esfuma da a entender que la página está rota. Y el enlace `Volver a la tienda` es la salida evidente. |

**Por qué los proveedores van primero y el correo debajo.** Un toque contra
escribir un correo, esperar, abrir el buzón, volver y teclear seis dígitos. El
correo es el camino largo y es el que se ofrece como alternativa, no como opción
por defecto — aunque sea, por I7 y D3, el único que hoy se puede verificar de
punta a punta.

### 2 · `/cuenta/entrar` — paso «código» (D5, R3, R5)

Sustituye **en sitio** al contenido de la tarjeta. Misma URL, misma pestaña,
mismo `next`, mismo carrito.

Encabezado: `<h2>Escribe el código</h2>` y, debajo, `Te mandamos un código de 6
dígitos a ana@x.cu.` con un botón de texto `Cambiar el correo` que vuelve al
paso 1 **conservando el correo tecleado**.

**El campo, que es la pieza delicada de todo el feature.** Es **un solo
`<input>`**, no seis casillas:

- `type="text"` con `inputMode="numeric"` y `pattern="[0-9]*"` → teclado
  numérico en el móvil, sin la ruleta de `type="number"`.
- `autoComplete="one-time-code"` → iOS y Android ofrecen el código del SMS o del
  correo encima del teclado. Seis casillas separadas rompen ese autorrelleno
  casi siempre, y ese es el motivo principal de no usarlas.
- `maxLength={6}`, y en cada cambio se **filtran los no-dígitos**, así que pegar
  `123 456` o `Tu código es 123456` desde el portapapeles deja `123456`. Pegar
  funciona nativo, que con seis casillas hay que reimplementarlo.
- `enterKeyHint="go"` → la tecla del teclado móvil envía, sin buscar el botón.
- `text-center text-2xl tracking-[0.35em] min-h-14`, ancho completo. A 360 px los
  seis dígitos ocupan ~135 px de los 328 disponibles: sobra sitio.
- `<label>` visible: `Código de 6 dígitos`.

**Cuándo se comprueba solo, y cuándo no.** Si los seis dígitos llegan **de golpe**
—autorrelleno del sistema o pegado— se comprueba sin pedir nada más: es
inequívoco y ahorra un toque con una sola mano. Si se teclean **uno a uno**, no:
solo se habilita el botón. Con tres intentos y nada más (R5), enviar solo en
cuanto el sexto dígito aparece le quita a la persona la oportunidad de revisar
lo que escribió, y un dedo en un teclado de móvil se equivoca.

| Estado                               | Qué se ve                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vacío / a medio escribir**         | Botón primario `Entrar` **deshabilitado**, con `aria-describedby` a la ayuda `Escribe los 6 dígitos.` Debajo, `Reenviar el código` deshabilitado con su cuenta atrás.                                                                                                                          |
| **Seis dígitos escritos**            | `Entrar` habilitado.                                                                                                                                                                                                                                                                           |
| **Comprobando**                      | `<fieldset>` deshabilitado, botón `Comprobando…` con `aria-busy="true"`.                                                                                                                                                                                                                       |
| **Código incorrecto, intento 1 y 2** | `aria-invalid` en el campo y error debajo: `Ese código no es correcto. Te quedan 2 intentos.` / `… te queda 1 intento.` El foco vuelve al campo **con el texto seleccionado**, para que teclear reemplace sin borrar. El campo NO se vacía solo: si se equivocó en un dígito, quiere ver cuál. |
| **Código agotado, 3.er fallo (R5)**  | El campo y `Entrar` **desaparecen** —ese código ya no sirve para nada— y en su lugar `Alert tone="danger"`, que recibe el foco: `Ese código ya no sirve. Pide uno nuevo.` Debajo, el primario pasa a ser `Pedir un código nuevo`, y sigue `Cambiar el correo`.                                 |
| **Código caducado o ya usado (E21)** | Mismo formato que el agotado, con `El código caducó. Pide uno nuevo.`                                                                                                                                                                                                                          |
| **Correo sin confirmar (E22)**       | `Alert tone="warning"`: `Todavía no confirmaste ese correo: busca el mensaje de confirmación o pide un código nuevo.` El campo se mantiene.                                                                                                                                                    |
| **Cuenta atrás del reenvío**         | `Reenviar el código` queda deshabilitado 30 s desde cada envío, con el rótulo `Reenviar el código (30 s)` bajando de segundo en segundo, y `aria-live="off"` en el número — el segundero no se le lee a nadie. Al llegar a 0 vuelve a `Reenviar el código`, habilitado.                        |
| **Reenviado**                        | El campo se vacía y toma el foco, el contador de intentos vuelve a 3, la cuenta atrás se reinicia y un `aria-live="polite"` anuncia una vez: `Te mandamos un código nuevo.`                                                                                                                    |
| **Reenvío rechazado por Supabase**   | El mismo aviso de «demasiados envíos» del paso 1, sobre el campo, sin perder lo tecleado.                                                                                                                                                                                                      |
| **Red caída al comprobar**           | `Alert tone="danger"` con `Parece que se cortó la conexión…`. **No cuenta como intento fallido en la pantalla**: el contador solo baja cuando el servidor dice que el código estaba mal.                                                                                                       |
| **Correcto**                         | El botón pasa a `Entrando…` con `aria-busy`, y **navegación dura** al destino de R6 (no `router.push`: la sesión acaba de cambiar y lo que hay que releer es el servidor). El botón atrás no devuelve a un formulario de acceso ya consumido.                                                  |

**Por qué aquí sí hay cuenta atrás y en el 429 del checkout no.** F-010 la
descartó para una espera de seis minutos que se entiende igual dicha en minutos.
Aquí la espera son 30 segundos, la persona está parada mirando la pantalla sin
nada que hacer, y sin número no sabe si el botón se va a despertar o está roto.
Es un temporizador que se apaga solo y que existe en una ruta `ƒ` que nadie
carga desde el catálogo. Si el temporizador choca contra
`react-hooks/set-state-in-effect` (ficha `set-state-en-efecto-prohibido`, y ojo:
el `setState` va **dentro del callback del `setInterval`**, no en el cuerpo del
efecto, que es lo que la regla persigue), la degradación aceptable es dejar
`Reenviar el código` siempre habilitado y que conteste el límite de Supabase con
el aviso que ya está diseñado. **Lo que no vale es quitar el reenvío.**

### 3 · `/auth/callback` — sin pantalla, a propósito

D1 pide «un estado de tránsito y de error». El mejor estado de tránsito posible
aquí es **no renderizar nada**: la ruta canjea el código y responde **307**, así
que el navegador pasa de la página del proveedor a `/[slug]/checkout` o a
`/cuenta` sin dibujar un cascarón a medias por el camino. Y el estado de error
**tampoco se pinta aquí**: se redirige a `/cuenta/entrar?aviso=…`, que es donde
está el botón para volver a intentarlo (E19, E20). Un mensaje de error en una
ruta técnica sin nada que pulsar es un callejón.

| Caso                                               | Qué hace                                                           | Qué ve la persona                         |
| -------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| `code` válido                                      | Canjea, escribe cookies, **307** al `next` validado (R6, R7)       | La página de destino                      |
| `code` inválido o caducado (E19)                   | Ni sesión ni `Customer`; **307** a `/cuenta/entrar?aviso=caducado` | `El acceso caducó. Vuelve a intentarlo.`  |
| `error=access_denied` o cualquier `error` (E20)    | **307** a `/cuenta/entrar?aviso=cancelado`                         | `No se completó el acceso.`               |
| `next` a otro dominio, `//otro.com`, `/../x` (E27) | Se ignora; destino `/cuenta` (R7)                                  | Su cuenta. Sin mensaje: no hizo nada malo |
| Algo revienta antes de poder redirigir             | Salta `src/app/error.tsx`, que ya existe                           | La pantalla de error global               |

**Si `sdd-architect` necesita que esto sea una página en vez de una ruta** (por
ejemplo, porque el canje tiene que ocurrir en el navegador), entonces sí hace
falta pantalla, y es esta: tarjeta centrada, `<h1>Entrando…</h1>`, un párrafo
`Un momento, estamos terminando de entrar.` dentro de un contenedor
`aria-live="polite" aria-busy="true"`, sin animación y sin botón. Y el error
sigue sin pintarse aquí: redirige igual. Es la única parte de este documento
cuya forma depende de una decisión que no es mía (NC4).

### 4 · `/cuenta` — perfil y cerrar sesión

**No tiene estado «cargando».** La página lee la sesión en el servidor y llega
con los tres valores ya puestos en el HTML; la isla de cliente solo aporta la
edición y el envío. Es la opción más barata y la que mejor se ve en una conexión
mala, y es posible porque `/cuenta` está fuera del slug y de la prohibición de
R18.

Estructura: la misma barra superior de § 1 (con `Volver a la tienda` si `desde`
es válido), `<h1>Tu cuenta</h1>`, una `Card` con los tres campos y `Guardar
cambios`, y **separada por `border-t mt-8 pt-6`**, la zona de cerrar sesión.

| Estado                                                                                   | Qué se ve                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin sesión (E24)**                                                                     | No se ve: redirección del servidor a `/cuenta/entrar?next=/cuenta`. Nunca un 404 ni un error.                                                                                                                                                                           |
| **Sesión caducada al entrar (E25)**                                                      | Igual, más `aviso=sesion` → `Tu sesión se cerró. Vuelve a entrar.` en la pantalla de acceso.                                                                                                                                                                            |
| **Normal**                                                                               | `Nombre y apellidos`, `Teléfono`, `Correo`, con sus valores. `Guardar cambios` **deshabilitado hasta que algo cambie**, con `aria-describedby` a `No hay cambios que guardar.`                                                                                          |
| **Perfil vacío** (primer login por Apple, que puede no dar ni nombre ni correo real, R9) | Los tres campos vacíos y, bajo el título, una línea `text-fg-muted text-sm`: `Completa tus datos y no vuelvas a teclearlos en cada pedido.` Es el estado vacío de esta pantalla y no es un error.                                                                       |
| **Guardando**                                                                            | `<fieldset>` deshabilitado, botón `Guardando…` con `aria-busy="true"`.                                                                                                                                                                                                  |
| **Guardado (E9)**                                                                        | `Alert tone="positive"` sobre el formulario: `Guardamos tus datos.` Se queda hasta la siguiente edición — **no es un toast**: ni portal, ni temporizador, ni foco robado, y quien tarda en leer llega a tiempo.                                                         |
| **Inválido (E10, R15)**                                                                  | No se envía nada. `<div role="alert" tabindex="-1">` arriba con `Revisa 2 datos antes de guardar` y enlaces a cada campo; error bajo cada control; **lo demás tecleado se conserva**. Mismos límites y mensajes que el contacto del pedido (`src/constants/orders.ts`). |
| **Error de red o 500 al guardar**                                                        | `Alert tone="danger"`: `No pudimos guardar tus datos. Revisa tu conexión y vuelve a intentar.` + `Reintentar`. **Nada de lo tecleado se pierde.**                                                                                                                       |
| **La sesión caducó mientras editaba**                                                    | `Alert tone="warning"`: `Tu sesión se cerró mientras editabas. Vuelve a entrar y guarda otra vez.` + botón `Entrar de nuevo` → `/cuenta/entrar?next=/cuenta`. Se dice que hay que guardar otra vez porque es verdad: al navegar se pierde lo tecleado.                  |
| **Cerrar sesión (E4)**                                                                   | Botón `secondary`, abajo, lejos del primario, con la línea `Cerrar sesión no borra tu carrito.` **Sin confirmación**: no se destruye nada, y esa frase es lo que quita el miedo. Al pulsar, `Cerrando sesión…` y navegación dura a `/`.                                 |
| **Fallo al cerrar sesión**                                                               | `Alert tone="danger"`: `No pudimos cerrar tu sesión. Revisa tu conexión y vuelve a intentar.` La sesión sigue viva, que es lo honesto.                                                                                                                                  |

**Lo que esta pantalla NO tiene**, y no por olvido (D2): historial de pedidos,
direcciones guardadas, contraseña, foto, borrar la cuenta, exportar datos, y
«conectar otro método de acceso».

### 5 · `/[slug]/checkout` — el autocompletado (D4, R17, E12–E17)

Cambia **una** cosa de la pantalla de F-010: la sección de contacto gana una
línea de estado bajo su título, y esa línea existe siempre.

**La regla de oro es R17: el checkout no espera a nadie.** Los tres campos se
pintan, se enfocan y se escriben desde el primer instante, exactamente igual que
hoy. Nada se deshabilita, nada se atenúa, no hay esqueleto y no hay spinner.

**Cómo gana lo tecleado sin un solo `setState` en un `useEffect`.** El valor de
cada campo se **deriva en el render**, que es literalmente la salida que
`AGENTS.md` señala («si se deriva del render, derívalo»):

- el estado guarda **lo que la persona escribió**, y su valor inicial es
  «todavía nada» —no la cadena vacía—;
- el perfil, cuando llega, se guarda con el mismo camino con el que hoy se
  guarda la cotización: dentro del `.then` del `fetch`, que es un callback, no
  el cuerpo de un efecto;
- lo que se pinta es `lo tecleado ?? lo del perfil ?? ""`.

Consecuencias, que son exactamente E12–E14:

- Campo intacto y perfil con valor → aparece el valor (E12).
- Campo con «Ana P.» → sigue diciendo «Ana P.», llegue el perfil cuando llegue (E13).
- **Campo que la persona vació a propósito** → lo tecleado es la cadena vacía,
  que no es «todavía nada», así que se queda vacío (E13, segunda frase).
- Perfil sin teléfono → el teléfono se queda vacío con su validación de siempre (E14).

**Y un campo pasa a ser «suyo» también al recibir el foco**, no solo al recibir
una tecla. Sin eso, alguien con el cursor puesto en el nombre y el teclado
abierto vería aparecer texto bajo el dedo y el cursor saltar al final. Enfocar
un campo ya es decir «este lo lleno yo».

| Estado                                              | Qué se ve                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primer instante, sin saber si hay sesión (R17)**  | El formulario de siempre. La línea bajo `Tus datos de contacto` dice: `La tienda te va a contactar por aquí. Si ya tienes cuenta, entra y los rellenamos.` con `entra` como enlace a `/cuenta/entrar?next=/[slug]/checkout`.                                                                                     |
| **Sin sesión (E16)**                                | **Idéntico al estado anterior, para siempre.** Ningún error, ningún aviso, nada deshabilitado, ningún texto que sugiera que hace falta entrar.                                                                                                                                                                   |
| **Con sesión, perfil aplicado**                     | Los campos vacíos aparecen rellenos y la línea cambia **en el mismo sitio** a: `Rellenamos tus datos guardados. Puedes cambiarlos.` Se anuncia una vez con `aria-live="polite"`.                                                                                                                                 |
| **Con sesión, perfil sin nada que aportar**         | Los campos siguen vacíos y la línea queda en `La tienda te va a contactar por aquí.` Sin enlace de entrar: ya entró.                                                                                                                                                                                             |
| **Con sesión, pero la persona ya tecleó todo**      | No se rellena nada y la línea es la del caso anterior. Ningún «no pudimos rellenar»: no ha pasado nada digno de contarse.                                                                                                                                                                                        |
| **El perfil no llega (red, 500, Auth caído)**       | **Silencio absoluto.** La línea se queda en la variante inicial. Es una mejora, no un requisito: un error aquí asustaría a alguien que solo quiere pedir arroz.                                                                                                                                                  |
| **Sesión caducada a mitad del checkout (E17)**      | Nada cambia en el formulario. Se pide como invitado con lo que hay escrito, el pedido se crea igual, y como mucho el icono de la cabecera vuelve al estado de invitado.                                                                                                                                          |
| **Vuelta de entrar a mitad del pedido (E15, D4)**   | El carrito trae los mismos productos y cantidades, la URL vuelve a ser `/[slug]/checkout`, la cotización se rehace como en cualquier carga, y los campos vacíos ya vienen rellenos. Lo que se había tecleado antes de irse no se promete (R16) — y por eso se avisa antes de salir.                              |
| **Salir a entrar con el formulario a medio llenar** | Al pulsar el enlace, si **algún** campo de contacto tiene algo escrito, aparece una confirmación en línea (el patrón de `¿Vaciar el carrito?` de F-010): `Si entras ahora se pierde lo que escribiste aquí.` con `Sí, entrar` y `No`. Con los campos vacíos —el caso normal— navega directo, sin preguntar nada. |

**Por qué la línea de estado tiene sitio reservado.** F-010 dejó escrita la
regla de que nada que llegue tarde puede aparecer **encima** de algo que ya se
podía tocar o escribir. Esa línea existe desde el primer render con
`min-h-10 text-xs` (dos líneas a 360 px), y solo **cambia de texto**: no se
inserta, no empuja los campos y no mueve el cursor de nadie. Las tres variantes
tienen que caber en dos líneas a 360; están medidas para eso (la más larga son
82 caracteres).

**Por qué no hay adorno por campo.** Ni icono, ni color, ni «del perfil» al lado
de cada `input`. Tres adornos que aparecen y desaparecen son tres motivos de
salto y bastante ruido para decir algo que una sola frase dice mejor. Y el valor
rellenado **no se pinta distinto**: es un valor normal y editable, no una
sugerencia.

---

## Estructura por breakpoint

360 primero, y en serio: esto se usa con una mano, en el paso donde se abandona
un carrito. `Container` ya da `max-w-6xl px-4 sm:px-6` y nada de lo nuevo lo
cambia.

| Zona                                  | 360                                                                                                                                                                                                                  | 768                                                                                                              | 1280                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Cabecera de tienda**                | Nombre truncado · `Carrito ⟨n⟩` · **glifo de cuenta solo** (44×44, `-my-2`, sin rótulo). La ciudad ya está oculta desde F-010. Altura de la cabecera: **68 px, la de hoy, sin cambio**.                              | Igual + la palabra `Cuenta` junto al glifo (`hidden sm:inline`)                                                  | Igual que 768                                                                                                 |
| **Barra superior de cuenta**          | `queandabuscando` a la izquierda, `Volver a la tienda` a la derecha, ambos `text-sm`, `py-3`. Si el nombre no cabe, el que trunca es el de la izquierda.                                                             | Igual, `py-4`                                                                                                    | Igual                                                                                                         |
| **Tarjeta de acceso**                 | `w-full` dentro de `Container`, `py-10`. Botones a todo el ancho, apilados, `gap-3`.                                                                                                                                 | `max-w-sm mx-auto`, `py-16`                                                                                      | **Igual que 768.** Un formulario de acceso no mejora por ser ancho; centrado y estrecho se lee de una ojeada. |
| **Campo del código**                  | Ancho completo, `min-h-14`, `text-2xl tracking-[0.35em] text-center`. Seis dígitos ≈ 135 px de 328: sobra. Debajo, `Entrar` a todo el ancho, `size="lg"`; debajo, `Reenviar el código` como botón de texto centrado. | Igual, dentro de la tarjeta estrecha                                                                             | Igual                                                                                                         |
| **`/cuenta` · formulario**            | Una columna, `max-w-md`, campos a todo el ancho, `min-h-11`                                                                                                                                                          | **Sigue en una columna.** Tres campos en dos columnas dentro de una tarjeta de 448 px es apretarlos por simetría | Igual                                                                                                         |
| **`/cuenta` · cerrar sesión**         | Bloque propio tras `border-t mt-8 pt-6`, botón `secondary` a todo el ancho                                                                                                                                           | Botón al ancho de su contenido                                                                                   | Igual                                                                                                         |
| **Checkout · línea de estado**        | Bajo `Tus datos de contacto`, `text-xs`, `min-h-10` (dos líneas reservadas)                                                                                                                                          | Una línea; el hueco reservado sobra y no se nota                                                                 | Igual                                                                                                         |
| **Checkout · confirmación de salida** | En línea, justo debajo de esa línea, empujando **hacia abajo** el formulario y nunca hacia arriba                                                                                                                    | Igual                                                                                                            | Igual                                                                                                         |

Ningún elemento nuevo hace scroll horizontal a 360, ninguna pantalla nueva tiene
más de una acción primaria visible, y ninguna barra queda fija abajo: en las
pantallas de cuenta el teclado del móvil sube y taparía justo el botón.

---

## Componentes de UI

**Se reutilizan tal cual, sin tocar ni una línea:** `Container`, `Card`,
`Button` (`primary` y `secondary`, `size="lg"` para las acciones de acceso),
`Field` —que ya cablea `id`, `aria-describedby` y `aria-invalid`, que es
exactamente lo que hace falta seis veces aquí— y `Alert` con sus cuatro tonos y
su `role` ya resuelto por tono.

**Primitivos nuevos en `src/components/ui/`: ninguno.** El campo del código es
un `<input>` normal dentro de un `Field`; todo lo especial son atributos
(`inputMode`, `autoComplete="one-time-code"`, `maxLength`) y clases de tipografía.
Un primitivo `OtpInput` solo existiría para envolver seis casillas que este
diseño rechaza a propósito.

**Componentes de dominio.** Dónde viven exactamente lo decide `sdd-architect`;
esto describe qué hace cada uno y si necesita la directiva.

| Componente                 | Qué hace                                                                                                           | `"use client"`                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `AccountBadge`             | El icono de la cabecera con sus tres estados                                                                       | **Sí** — se suscribe a la señal de sesión con `useSyncExternalStore`, igual que `CartBadge`. Es la única forma de cumplir R11. |
| Señal de sesión de cliente | Módulo con `subscribe`/`getSnapshot`/`getServerSnapshot` (= «desconocido»)                                         | **Sí** (módulo, no componente). **No importa nada de `@supabase/*`**: ver § Coste de cliente                                   |
| `SignInCard`               | Toda la pantalla de `/cuenta/entrar`: los dos pasos, los cuatro métodos, los errores, el reenvío y su cuenta atrás | **Sí** — es el estado más grande de F-012                                                                                      |
| `ProviderButton`           | Botón de proveedor: glifo + rótulo + estado ocupado                                                                | No. Recibe `onClick` y `busy` de `SignInCard`                                                                                  |
| `ProfileForm`              | Los tres campos de `/cuenta`, el guardado y sus errores                                                            | **Sí** — edición y envío                                                                                                       |
| `SignOutButton`            | Cerrar sesión y navegar a `/`                                                                                      | **Sí** — un `onClick` y un estado ocupado. Puede vivir dentro de `ProfileForm` y ahorrarse la directiva propia                 |
| `AccountTopBar`            | La barra superior de las páginas de cuenta                                                                         | No — dos enlaces, servidor puro                                                                                                |
| `CheckoutForm`             | Ya existe y **ya es cliente**; solo cambia el origen de los valores                                                | Sin cambio                                                                                                                     |

**Lo que no puede pasar, y hay que mirarlo en el diff porque ningún sensor lo
ve:** que `AccountBadge` o la señal de sesión importen `src/lib/supabase/client.ts`,
directa o indirectamente. Eso llevaría 61 KB gzip a **todas** las páginas de
catálogo. Es el error de una sola línea que este feature puede cometer.

---

## Tokens y tema

**No hace falta ningún token nuevo.** Todo sale de `src/theme/tokens.css` tal
como está:

| Uso                                                                                             | Token / utilidad                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Icono de cuenta en la cabecera                                                                  | `currentColor` sobre `bg-brand text-brand-contrast` — hereda del `<header>`, sin clase de color propia                                                                                       |
| Punto de «con sesión»                                                                           | `bg-brand-contrast` sobre el fondo `brand` de la cabecera: **el mismo par de contraste que la tienda ya eligió** para la palabra «Carrito»                                                   |
| Fondo de página / tarjeta / barra superior                                                      | `bg-bg`, `bg-surface`, `bg-surface-muted`                                                                                                                                                    |
| Bordes, separadores y el `border-t` de cerrar sesión                                            | `border-border`                                                                                                                                                                              |
| Texto y texto secundario                                                                        | `text-fg`, `text-fg-muted`                                                                                                                                                                   |
| Acciones primarias (`Enviarme un código`, `Entrar`, `Guardar cambios`, `Pedir un código nuevo`) | `bg-brand text-brand-contrast` vía `Button variant="primary"`                                                                                                                                |
| Botones de proveedor y `Cerrar sesión`                                                          | `Button variant="secondary"` (`bg-surface-muted`, `border-border`)                                                                                                                           |
| Confirmación de guardado                                                                        | `Alert tone="positive"` → `bg-positive/12 text-positive`                                                                                                                                     |
| Avisos (cancelado, sesión cerrada, sin confirmar, Auth caído)                                   | `Alert tone="warning"` → `bg-warning/15 text-warning`                                                                                                                                        |
| Errores (código incorrecto o agotado, red, guardado fallido)                                    | `Alert tone="danger"` → `bg-danger/12 text-danger`, y `text-danger` en los errores de campo                                                                                                  |
| Esquinas                                                                                        | `rounded-sm                                                                                                                                                                                  | md  | lg`por nombre, **nunca**`rounded-[--radius-lg]`(sintaxis v3 que`npm run check:theme`persigue). El punto usa`rounded-full`, que no es un token overridable y por eso no se deforma con `radius: round` |
| Sombra de las tarjetas                                                                          | `shadow-card`                                                                                                                                                                                |
| Anillo de foco                                                                                  | `focus-visible:outline-brand outline-2 outline-offset-2`, el de `Button`                                                                                                                     |
| Tipografía                                                                                      | `font-sans` y la escala de Tailwind. Único valor arbitrario: `tracking-[0.35em]` en el campo del código, del mismo tipo que el `tracking-[0.2em]` que F-010 ya usa para el código del pedido |

**Cómo responde al branding por tienda.** Con una asimetría deliberada:

- **La cabecera sí.** El icono hereda `brand` / `brand-contrast` del `<header>`,
  así que en cada tienda se ve de su color sin una sola clase condicional.
- **Las páginas de cuenta no.** `/cuenta` y `/cuenta/entrar` viven fuera de
  `[slug]`, no llevan `data-store` y no reciben `renderStoreTheme`: son de
  queandabuscando y usan los tokens base. Es coherente con D1 —una cuenta, no
  una cuenta por tienda— y evita que el color de una tienda cualquiera decida
  cómo se ve el formulario donde alguien teclea su correo.
- El riesgo que F-010 dejó vivo sigue vivo y no lo agrava nada de aquí: una
  tienda con `brand` casi blanco y `brandContrast` también claro deja la
  cabecera ilegible, icono incluido. Es el mismo defecto que ya afecta a
  «Carrito» y su arreglo sigue siendo validar contraste en
  `src/features/theming/storeTheme.ts`, fuera de F-012.

---

## Accesibilidad

**Orden de foco (Tab).**

- _Cabecera de tienda:_ nombre de la tienda → `Carrito` → **icono de cuenta** →
  contenido. El icono va el último de la cabecera: es el punto de entrada
  discreto, no la primera parada de quien navega con teclado.
- _`/cuenta/entrar`, paso correo:_ `queandabuscando` → `Volver a la tienda` →
  (banner de aviso, si lo hay) → `Continuar con Google` → Facebook → Apple →
  campo `Correo` → `Enviarme un código`.
- _paso código:_ `Cambiar el correo` → campo del código → `Entrar` →
  `Reenviar el código`.
- _`/cuenta`:_ barra superior → (banner) → `Nombre` → `Teléfono` → `Correo` →
  `Guardar cambios` → `Cerrar sesión`.
- _Checkout:_ sin cambios respecto de F-010, salvo que el enlace `entra` de la
  línea de estado entra en el orden **antes** del campo `Nombre`, porque está
  encima de él en el DOM.

**El foco al cambiar de paso, que es lo que más se estropea.**

1. Al pasar de «correo» a «código», el foco va **al campo del código**, no al
   título: quien lo ve quiere teclear y quien no lo ve necesita saber dónde
   está. El contexto no se pierde porque el `aria-describedby` del campo apunta
   al párrafo `Te mandamos un código de 6 dígitos a ana@x.cu.`, así que un lector
   de pantalla lo dice al recibir el foco.
2. El movimiento se hace con el patrón que exige `AGENTS.md`: una **intención en
   un `useRef`**, puesta a `true` en el manejador y **consumida** en el efecto —
   el mismo que ya usa `CheckoutForm` con `wantsSummaryFocusRef`. Nunca un
   `setState` en el efecto, y nunca un `setTimeout(…, 0)` para callar el lint.
3. Tras un código incorrecto, el foco vuelve al campo **con el texto
   seleccionado**. Tras el tercer fallo, el foco va al `Alert` de «ya no sirve»
   (`tabindex="-1"`), porque el campo ha dejado de existir y el foco no puede
   caerse al `<body>`.
4. Tras un reenvío, el foco vuelve al campo ya vacío.
5. Al fallar la validación de `/cuenta`, el foco va al resumen de errores, igual
   que en el checkout de F-010.
6. **Cuando llega el perfil al checkout, el foco no se mueve jamás.** Ni cuando
   se rellenan campos, ni cuando cambia la línea de estado.

**Anuncios a un lector de pantalla.**

- Los errores usan `Alert` con `tone="danger"`/`"warning"`, que ya rinde
  `role="alert"`: interrumpen, porque cambian lo que la persona iba a hacer.
- `Guardamos tus datos.` es `tone="positive"` → `role="status"`: informa sin
  cortar.
- `Te mandamos un código nuevo.` y `Rellenamos tus datos guardados.` se anuncian
  **una vez** en un `aria-live="polite"`.
- El número de la cuenta atrás del reenvío **no** se anuncia (`aria-live="off"`):
  un segundero leído en voz alta es una alarma.
- El contador de intentos viaja dentro del `<p id="…-error">` del campo, así que
  se lee al recibir el foco y no hay que buscarlo.
- Los botones deshabilitados llevan siempre `aria-describedby` al texto que
  explica por qué: `Escribe los 6 dígitos.`, `No hay cambios que guardar.`,
  `El acceso a tu cuenta no está disponible ahora mismo.` Un botón gris sin
  motivo es un callejón sin salida.

**Objetivos táctiles y teclado.**

- Icono de cuenta: **44×44** reales (`h-11 w-11` con `-my-2` para no engordar la
  cabecera). De paso queda anotado que el enlace `Carrito` de hoy mide unos
  20 px de alto y se arreglaría con el mismo `-my-2 min-h-11`; **no es de F-012**
  y no lo toco.
- Botones de proveedor y acciones primarias: `min-h-12`. Campos: `min-h-11`.
  `Reenviar el código` y `Cambiar el correo` son `<button type="button">` de
  texto con `min-h-11 px-3`, no enlaces con aspecto de texto pequeño.
- El campo del código funciona con teclado físico igual que con el del móvil:
  se pega con `Ctrl/Cmd+V`, se envía con Enter.
- Nada se comunica solo por color: el punto de sesión iniciada lleva su
  `aria-label` en el enlace, los errores llevan su texto, y el valor que vino
  del perfil no se distingue por color porque no se distingue en absoluto.
- `autoComplete`: `email` en los dos correos, `name`, `tel`, y
  `one-time-code` en el código. `type="email"` e `inputMode="numeric"` para que
  se abra el teclado correcto en el móvil.
- `prefers-reduced-motion` ya está resuelto en `src/app/globals.css` y aquí no
  se diseña ni una animación, así que no hay nada que desactivar.
- Contraste: los pares de texto de estas pantallas son los mismos de F-010 sobre
  `bg` y `surface` (`text-fg`, `text-fg-muted`, `text-danger`), y `positive` /
  `warning` / `danger` **no son overridables por la tienda**: nadie puede pintar
  de verde un error.

---

## Coste de cliente

**El punto de partida, medido hoy en este worktree** (`npm run build` en 0 y
después `npm run check:bundle`):

```
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 176.9 KB gzipped (budget 193 KB)
    HTML:      3.4 KB gzipped — this is what decides first paint
```

Quedan **16,1 KB libres**. Y hay que tener presente qué mide ese guion: **solo
páginas prerenderizadas**. De las cuatro pantallas de F-012, `/cuenta/entrar`,
`/cuenta` y `/auth/callback` son `ƒ` y **no entran en la medida** — lo que no
significa que no cuesten en el teléfono de alguien. La única pieza de F-012 que
cae en una página medida es el icono de la cabecera.

| Módulo                                                    | Directiva      | Por qué la necesita (regla de `AGENTS.md`)                                                                             | Dónde aterriza                             | Estimado gzip                |
| --------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- |
| Señal de sesión de cliente                                | `"use client"` | Un valor que viene de fuera de React y se pinta → `useSyncExternalStore`, igual que `cartStore`. Sin Context y sin Zod | **Todas** las de tienda, incluidas las `●` | ~0,7 KB                      |
| `AccountBadge`                                            | `"use client"` | Se suscribe a esa señal. Es la única manera de que el HTML de ISR no dependa de la sesión (R11, D7)                    | **Todas** las de tienda, incluidas las `●` | ~0,5 KB (glifo SVG incluido) |
| `SignInCard` (+ `ProviderButton`)                         | `"use client"` | Dos pasos, cuatro métodos, validación, errores, reenvío y cuenta atrás                                                 | `/cuenta/entrar` (`ƒ`)                     | ~5 KB propios                |
| `ProfileForm` (+ `SignOutButton`)                         | `"use client"` | Edición, envío, errores, cerrar sesión                                                                                 | `/cuenta` (`ƒ`)                            | ~2 KB                        |
| Cambios en `CheckoutForm`                                 | ya es cliente  | Valores derivados y una petición más                                                                                   | `/[slug]/checkout` (`ƒ`)                   | ~0,5 KB                      |
| `AccountTopBar`, la página de `/cuenta`, `/auth/callback` | —              | Servidor puro                                                                                                          | —                                          | 0                            |

**Impacto sobre el presupuesto: +1,2 KB, y no hay que subir `BUDGET_KB`.**
176,9 + ~1,2 ≈ **178,1 KB** frente a los 193 de
`scripts/check-bundle-budget.mjs`. Queda margen de sobra. Lo digo explícito
porque `AGENTS.md` permite subirlo documentándolo y **aquí no hace falta**: si
tras construirlo la medida se dispara, no es este diseño, es una dependencia
colada, y la ficha `.agent/playbook/bundle-fuera-de-presupuesto.md` es lo que hay
que aplicar antes de tocar el número.

**La cifra que sí decide algo, y está medida.** Un módulo de navegador que solo
importa `createBrowserClient` de `@supabase/ssr` —lo que hace hoy
`src/lib/supabase/client.ts`— pesa **61,2 KB gzip** al empaquetarlo
(`esbuild --bundle --minify --format=esm --platform=browser`), porque
`createClient` de `supabase-js` arrastra estáticamente Realtime, PostgREST,
Storage y Functions y nada de eso se sacude. El cliente de Auth a solas
(`AuthClient` de `@supabase/auth-js`) pesa **23,9 KB gzip**.

De ahí salen dos consecuencias, y son la parte importante de esta sección:

1. **Nada de `@supabase/*` puede tocar el árbol de la cabecera.** Si
   `AccountBadge` o su señal importaran `src/lib/supabase/client.ts`, la página
   `●` más pesada pasaría de 176,9 a ≈ 238 KB: **45 KB por encima del
   presupuesto**, en todas las páginas de catálogo de todas las tiendas, y por
   un punto de 8 píxeles. `npm run check:bundle` lo pescaría, que es exactamente
   la regresión para la que existe. El diseño resuelve la señal con NC1, que no
   habla con Supabase.
2. **La pantalla de acceso tiene tres formas de hacer lo mismo, con precios muy
   distintos**, y elegir es de `sdd-architect` (NC3). El diseño es idéntico en
   las tres, así que aquí solo pongo la factura:

   | Cómo habla `/cuenta/entrar` con Supabase                           | Coste en el navegador      |
   | ------------------------------------------------------------------ | -------------------------- |
   | (a) `createBrowserClient` de `@supabase/ssr`, como hoy             | **+61,2 KB gzip**          |
   | (b) solo `@supabase/auth-js`                                       | **+23,9 KB gzip**          |
   | (c) `fetch` a rutas propias, y Supabase se llama desde el servidor | **+0 KB de `@supabase/*`** |

   `AGENTS.md` § El presupuesto no es un muro dice que entre varias opciones
   gana la que menos pese, y que lo que no se hace es recortar la pantalla.
   Aquí ninguna pantalla se recorta: **(c) da exactamente la misma interfaz por
   61 KB menos**, y de propina deja el flujo de acceso funcionando en un
   navegador donde el JS tarde, porque los dos pasos pueden ser envíos de
   formulario de verdad. Recomiendo (c), y (b) si (c) complica el canje de OAuth.
   El contrato de verificación 1b (D3) —«pulsar cada botón llama a
   `signInWithOAuth` una vez con su `provider` y su `redirectTo`»— se cumple
   igual en las tres: no dice desde qué lado se llama.

**Descartado por lo que cuesta, no por lo que vale:**

1. **Preguntarle al servidor si hay sesión desde la cabecera.** Una petición por
   página de catálogo, para **todos** los visitantes, incluidos los que nunca
   van a entrar. En las conexiones que este proyecto tiene delante eso es peor
   que cualquier kilobyte. Por eso NC1 pide una señal **local y síncrona**, y por
   eso, si no la hay, el icono se queda en «desconocido» y no pasa nada.
2. **Seis casillas para el código.** Más marcado, más manejadores, teclas de
   borrado y flechas a mano, y rompen el autorrelleno del sistema, que es
   justamente lo que hace corto este paso en un móvil.
3. **Un `<dialog>` modal para entrar sin salir del checkout.** Ahorraría el viaje
   de ida y vuelta, pero mete gestión de foco, `inert`, la tecla Escape y el
   cliente de Auth **dentro del árbol del checkout**. Con (c) la vuelta al
   checkout ya conserva el carrito y rellena los campos: el modal compra poco y
   paga mucho.
4. **Guardar el formulario del checkout antes de ir a entrar.** R16 dice que no
   se promete, y sería PII escrita en `localStorage` a cambio de que la persona
   no repita tres campos que el perfil va a rellenar al volver.
5. **Iconos de proveedor de una librería.** Tres `<svg>` en línea contra decenas
   de KB.
6. **Toast de «guardado».** Portal, temporizador y foco, para lo que un `Alert`
   en su sitio dice mejor y sin desaparecer antes de que lo lean.

---

## Textos

Español, tuteo, frases cortas, el registro que ya usa la tienda.

**Cabecera de tienda**

- Rótulo visible (`sm+`, igual en los tres estados): `Cuenta`
- `aria-label`: `Tu cuenta` · si el cliente ya sabe que no hay sesión:
  `Entrar a tu cuenta`

**Barra superior de las páginas de cuenta**

- `queandabuscando` · `Volver a la tienda` · `Volver al inicio` (cuando no hay
  origen válido)

**`/cuenta/entrar` — paso correo**

- `<h1>`: `Entrar a tu cuenta`
- Subtítulo: `Guarda tus datos una vez y no vuelvas a teclearlos en cada pedido.`
- `Continuar con Google` · `Continuar con Facebook` · `Continuar con Apple`
- Ocupado: `Abriendo Google…` · `Abriendo Facebook…` · `Abriendo Apple…`
- Separador: `o`
- Campo: `Correo` · ayuda: `Te mandamos un código de 6 dígitos.`
- Botón: `Enviarme un código` · ocupado: `Enviando el código…`
- Pie: `No usamos contraseña.`
- `noscript`: `Para entrar a tu cuenta necesitas activar JavaScript. Puedes seguir comprando sin cuenta: tus pedidos funcionan igual.`
- Error de correo: `Escribe un correo válido. Ej.: ana@correo.cu`
- Envíos seguidos: `Pediste varios códigos seguidos. Espera un minuto y vuelve a intentarlo.`
- Proveedor caído (E23): `Ese método de acceso no está disponible ahora mismo.`
- Red: `Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.`
- Vuelta del callback (E19): `El acceso caducó. Vuelve a intentarlo.`
- Vuelta cancelada (E20): `No se completó el acceso.`
- Sesión cerrada (E25): `Tu sesión se cerró. Vuelve a entrar.`
- Auth sin configurar (E26): `El acceso a tu cuenta no está disponible ahora mismo.` / `Puedes seguir comprando sin cuenta: tus pedidos funcionan igual.`

**`/cuenta/entrar` — paso código**

- `<h2>`: `Escribe el código`
- `Te mandamos un código de 6 dígitos a {correo}.`
- `Cambiar el correo`
- Campo: `Código de 6 dígitos` · ayuda: `Escribe los 6 dígitos.`
- Botón: `Entrar` · ocupado: `Comprobando…` · al acertar: `Entrando…`
- Incorrecto: `Ese código no es correcto. Te quedan 2 intentos.` /
  `Ese código no es correcto. Te queda 1 intento.`
- Agotado (R5): `Ese código ya no sirve. Pide uno nuevo.`
- Caducado o ya usado (E21): `El código caducó. Pide uno nuevo.`
- Sin confirmar (E22): `Todavía no confirmaste ese correo: busca el mensaje de confirmación o pide un código nuevo.`
- `Reenviar el código` · esperando: `Reenviar el código ({n} s)` ·
  reenviado: `Te mandamos un código nuevo.`
- `Pedir un código nuevo`

**`/cuenta`**

- `<h1>`: `Tu cuenta`
- Perfil vacío: `Completa tus datos y no vuelvas a teclearlos en cada pedido.`
- Campos: `Nombre y apellidos` · `Teléfono` (ayuda: `Por aquí te va a contactar la tienda. Ej.: +53 5555 5555`) · `Correo`
- `Guardar cambios` · ocupado: `Guardando…` · deshabilitado: `No hay cambios que guardar.`
- Guardado: `Guardamos tus datos.`
- Resumen de errores: `Revisa {n} dato(s) antes de guardar`
- Errores de campo: los mismos que el checkout de F-010, por R15
- Fallo al guardar: `No pudimos guardar tus datos. Revisa tu conexión y vuelve a intentar.` + `Reintentar`
- Sesión caída mientras editaba: `Tu sesión se cerró mientras editabas. Vuelve a entrar y guarda otra vez.` + `Entrar de nuevo`
- `Cerrar sesión` · ocupado: `Cerrando sesión…` · nota: `Cerrar sesión no borra tu carrito.`
- Fallo al cerrar: `No pudimos cerrar tu sesión. Revisa tu conexión y vuelve a intentar.`

**`/[slug]/checkout`**

- Título de la sección (nuevo, hoy los campos no tienen encabezado propio): `Tus datos de contacto`
- Línea de estado, variante inicial y de invitado: `La tienda te va a contactar por aquí. Si ya tienes cuenta, entra y los rellenamos.` (`entra` es el enlace)
- Línea de estado, perfil aplicado: `Rellenamos tus datos guardados. Puedes cambiarlos.`
- Línea de estado, con sesión sin nada que rellenar: `La tienda te va a contactar por aquí.`
- Confirmación antes de salir: `Si entras ahora se pierde lo que escribiste aquí.` · `Sí, entrar` · `No`

**`/auth/callback`**, solo si acaba siendo página (NC4): `Entrando…` /
`Un momento, estamos terminando de entrar.`

---

## Constantes que este diseño introduce

Magic numbers a `src/constants/` (`AGENTS.md` § Prohibiciones). Van a
src/constants/account.ts (por crear), o donde `sdd-architect` decida:

| Constante                             | Valor | De dónde sale                                                                                |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| Longitud del código                   | `6`   | R3 y D5                                                                                      |
| Intentos por código                   | `3`   | R5 — el que agota el código y el que alimenta «Te quedan {n} intentos»                       |
| Espera antes de reenviar, en segundos | `30`  | Decisión de esta pantalla: bastante para no machacar el envío, poco para no bloquear a nadie |

Los límites de los tres campos del perfil **no** son nuevos: son los de
`src/constants/orders.ts` (R15).

---

## Verificación visual

Con `npm run dev` en **este** directorio (y comprobando antes que el servidor
que responde es el de este worktree: ficha `next-dev-uno-por-directorio`), a
360, 768 y 1280, en claro y en oscuro, y con al menos dos tiendas de colores
distintos (`tienda-demo` y `bodega-central` sirven).

**Cabecera**

- `V1` — `/tienda-demo` a 360: el glifo de cuenta se ve a la derecha de
  `Carrito`, la cabecera **sigue midiendo 68 px** y el nombre de la tienda no
  se parte en dos líneas.
- `V2` — a 768 aparece la palabra `Cuenta` junto al glifo y la ciudad sigue
  visible; nada se solapa.
- `V3` — Con el JS bloqueado en las DevTools, el glifo **sigue estando** en el
  HTML y su enlace lleva a `/cuenta`.
- `V4` — Grabar el primer segundo de carga: entre el HTML servido y el
  hidratado **no se mueve nada** en la cabecera. Con sesión, el punto aparece
  sin desplazar el glifo ni el nombre.
- `V5` — En una tienda con `brand` claro y otra con `brand` oscuro, el glifo y
  el punto se leen en las dos.
- `V6` — Con `NEXT_PUBLIC_SUPABASE_URL=""`, el icono **no aparece** y la
  cabecera se ve exactamente como hoy.

**`/cuenta/entrar`**

- `V7` — A 360, la tarjeta entera cabe sin scroll horizontal y los cuatro
  métodos se ven sin desplazarse (o con un desplazamiento corto).
- `V8` — Pedir un código: el paso cambia **sin navegar**, el foco queda en el
  campo del código y, en un móvil real, se abre el teclado **numérico**.
- `V9` — Pegar `123 456` desde el portapapeles deja `123456` y **se comprueba
  solo**. Teclear seis dígitos a mano **no** comprueba solo: habilita `Entrar`.
- `V10` — En un móvil real con el código recién llegado, el sistema lo ofrece
  encima del teclado (`autocomplete="one-time-code"`).
- `V11` — Tres códigos incorrectos seguidos: los mensajes bajan 2 → 1 → agotado,
  el campo desaparece al tercero y el foco cae en el aviso, no en el `<body>`.
- `V12` — `Reenviar el código` está deshabilitado con su cuenta atrás, se
  despierta a los 30 s, y al reenviar el campo se vacía, toma el foco y el
  contador de intentos vuelve a 3.
- `V13` — Con un lector de pantalla, al recibir el foco el campo dice a qué
  correo se mandó el código.
- `V14` — `/cuenta/entrar?aviso=caducado`, `…=cancelado` y `…=sesion` pintan sus
  tres banners, **con el JS bloqueado también**.
- `V15` — Con `NEXT_PUBLIC_SUPABASE_URL=""`: la página responde 200, se ve el
  aviso, los cuatro métodos salen deshabilitados y `Volver a la tienda` funciona.

**`/cuenta`**

- `V16` — Con sesión y perfil: los tres campos llegan **rellenos en el HTML**
  (verlo con `curl` y el JS bloqueado), y `Guardar cambios` está deshabilitado
  hasta cambiar algo.
- `V17` — Guardar con un teléfono de 3 dígitos: no se guarda nada, el foco salta
  al resumen de errores y **lo demás tecleado sigue ahí**.
- `V18` — Cerrar sesión desde una pestaña con carrito lleno: se llega a `/`, y al
  volver a `/tienda-demo/carrito` **el carrito sigue completo**.

**Checkout**

- `V19` — Sin sesión: los tres campos vacíos, ningún error, nada deshabilitado y
  el pedido de invitado llega hasta el comprobante.
- `V20` — Con sesión y perfil, y la red frenada a «Slow 3G»: los campos se pueden
  **escribir desde el primer instante**; cuando llega el perfil solo se rellenan
  los vacíos, la línea de estado cambia **sin mover los campos**, y si había un
  campo enfocado, ni el texto ni el cursor se tocan.
- `V21` — Desde el checkout con el carrito lleno: `entra` → entrar → volver. La
  URL vuelve a `/tienda-demo/checkout`, el carrito trae los mismos productos y
  cantidades, y los campos vacíos vienen rellenos. Repetirlo con algo escrito en
  el nombre: aparece la confirmación de que se pierde.

---

## Lo que la pantalla necesita del arquitecto

`architecture.md` no existía cuando escribí esto. Estas son las cinco cosas que
las pantallas necesitan, con **qué pasa si la respuesta es que no se puede**.
Ninguna deja el diseño en el aire.

- **NC1 — Una señal local y síncrona de «hay sesión», legible en el navegador
  sin ir a la red y sin importar nada de `@supabase/*`.** La necesita el icono
  de la cabecera, que vive en páginas `●` de todas las tiendas. Un booleano y
  nada más: **ningún dato personal**, ni nombre, ni correo, ni identificador.
  Si no se puede, el icono se queda para siempre en el estado «desconocido» —
  que es un estado diseñado, con su `href` y su `aria-label`, y que funciona.
  Lo que **no** es aceptable es resolverlo con una petición por página de
  catálogo.
- **NC2 — El perfil disponible en el navegador estando en `/[slug]/checkout`,
  después del primer render, como tres cadenas planas (`name`, `phone`, `email`)
  o «no hay perfil».** Sin `id`, sin `supabaseUserId`, sin fechas (contrato de
  datos de la spec). Con la restricción dura de R18/I4: **`src/app/[slug]/**` y
  `src/features/orders/**` no pueden leer cookies**. Si el perfil no llega, la
  pantalla no cambia y nadie se entera.
- **NC3 — Desde qué lado se llama a Supabase Auth en `/cuenta/entrar`.** El
  diseño es el mismo en las tres opciones; la factura no: 61,2 · 23,9 · 0 KB
  gzip. Ver § Coste de cliente.
- **NC4 — Si `/auth/callback` es ruta o página.** Si es ruta —lo recomendado— no
  hay pantalla que construir. Si es página, la pantalla de tránsito está escrita
  en § 3.
- **NC5 — Que `/cuenta` reciba el perfil ya resuelto en el servidor**, para que
  el HTML llegue con los tres valores puestos. Es lo que le quita a esa pantalla
  el estado «cargando». Si tuviera que pedirlo desde el navegador, haría falta un
  estado más, y lo diría: campos deshabilitados con `aria-busy` y `Cargando tus
datos…` en lugar de los valores. **Prefiero mucho la primera.**

Y una restricción que no es una pregunta: **`src/proxy.ts` no puede crecer hacia
`/[slug]`** (R22 e I5). Si la sesión se refresca ahí, es sobre `/cuenta` y
`/auth`, bifurcando por ruta antes del redirect de admin — o media tienda acaba
en `/?admin=sesion-requerida`.

---

## Preguntas al humano

**Ninguna.** D1–D8 cerraron lo que estaba abierto y el resto lo decidí aquí, con
el motivo escrito al lado para que se pueda discutir en la firma del plan:

- **Un solo campo para el código, no seis casillas** (§ 2) — por el autorrelleno
  del sistema, por el pegado y por el lector de pantalla.
- **Comprobar solo cuando los seis dígitos llegan de golpe, no al teclearlos** —
  con tres intentos, quitarle a alguien la oportunidad de revisar es caro.
- **Cuenta atrás de 30 s en el reenvío**, aunque F-010 rechazara la del 429 — la
  espera es corta y la persona está parada delante.
- **Las páginas de cuenta no llevan el color de la tienda** (§ Tokens) — la
  cuenta es global (D1); el icono de la cabecera sí lo lleva.
- **Cerrar sesión no pide confirmación** — no destruye nada, y la frase
  «Cerrar sesión no borra tu carrito» hace el trabajo que haría el diálogo.
- **El valor que viene del perfil no se marca por campo** (§ 5) — una sola línea
  con sitio reservado, en vez de tres adornos que aparecen y empujan.
- **El icono de cuenta también sale en la cabecera de una tienda cerrada y en la
  de marca** — la razón por la que allí no hay carrito no aplica a una cuenta
  global.

Esto **anula** la línea de `spec.md` § Fuera que dejaba el enlace de cuenta de
la cabecera fuera de alcance: D7 lo convirtió en requisito y `sdd-spec` está
incorporándolo. No toqué ese archivo.
