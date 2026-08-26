---
feature: F-010
agente: sdd-designer
actualizado: 2026-08-26T03:43:46Z
estado: listo
---

> **Ciclo 2.** Las cuatro preguntas `DP1..DP4` están respondidas por el humano
> (§ Respuestas del humano) y este documento ya está conciliado con
> `architecture.md`: la suposición **A2 del ciclo 1 quedó descartada** —no hay
> índice de precios en el HTML, hay un `POST /api/orders/quote`— y con ella se
> rediseñó el estado de carga de `/carrito` y de `/checkout`, que pasa de ser un
> parpadeo a ser **una pantalla que el público objetivo va a ver a menudo**.
> Lo que cambió respecto al ciclo 1 está marcado con **[c2]**.

## Qué se miró antes de diseñar

`AGENTS.md` (§ Arquitectura, § Prohibiciones, § Cosas que muerden, § Idioma),
`spec.md` de F-010 completa (E1–E27, R1–R31, casos límite, 21 criterios),
**`architecture.md` completa [c2]**, `.agent/progress/F-010.md` § Decisiones
tomadas, `features.json` para F-003, F-004, F-012, F-013 y F-016, la ficha
`.agent/playbook/bundle-fuera-de-presupuesto.md`, y el código de
`src/app/[slug]/`, `src/components/{ui,store}/`, `src/theme/tokens.css`,
`src/app/globals.css`, `src/features/theming/storeTheme.ts`,
`src/lib/{money,pricing,availability,slug}.ts` y `src/features/orders/server/pull.ts`.

**Lo que se pudo verificar de verdad y lo que no.** Había un servidor de
desarrollo escuchando en `localhost:3000`, así que las pantallas **actuales** se
leyeron sobre su HTML servido, no sobre el JSX:

- `GET /tienda-demo/p/jugo-de-mango-1-l` (agotado) trae
  `<button class="… bg-brand text-brand-contrast … min-h-12 px-6 text-lg" disabled="">Agotado</button>`.
  El botón deshabilitado ya viene en el HTML, sin JS: E5 hoy se cumple y hay que
  no romperlo.
- La cabecera servida es `<header class="bg-brand text-brand-contrast">` con el
  nombre de la tienda y la ciudad, y **no tiene ningún enlace al carrito**.
- El precio se pinta con `text-brand text-3xl font-semibold` → `$380.00`.

**No hay juicio visual a 360/768/1280.** La extensión de Chrome no está
conectada (`Browser extension is not connected`), así que no abrí ninguna
pantalla en un navegador. Las medidas de este documento salen de leer el HTML y
las clases de Tailwind, no de mirar píxeles. Eso **no se resuelve en este ciclo**:
los pasos `V7`–`V22` de § Verificación quedan para quien tenga el navegador
delante, y son ejecutables uno a uno.

## Cómo encaja con `architecture.md` **[c2]**

El ciclo 1 se escribió en paralelo con el arquitecto y dejó cinco suposiciones.
Este es el resultado de conciliarlas. **No queda ninguna suposición abierta.**

| #   | Suposición del ciclo 1                                                                                 | Resultado                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | El transporte de la confirmación es indistinto mientras devuelva los cuerpos de la tabla de respuestas | **Confirmada.** Es `POST /api/orders`, route handler público (para que el criterio 3 se pueda ejercitar con `curl`). Los códigos 201/200/400/404/409/429/500 son los de la spec. |
| A2  | El servidor manda un índice de precios de todo el catálogo con el HTML del carrito                     | **DESCARTADA.** Ver abajo.                                                                                                                                                       |
| A3  | `Store.id` llega como prop                                                                             | **Confirmada.** Las cuatro islas reciben `storeId` (y `storeSlug`). Clave `qab.cart.v1.<Store.id>`, nunca por slug (R12).                                                        |
| A4  | El módulo de carrito del cliente no importa Zod                                                        | **Confirmada como restricción**, trasladada al arquitecto. Vale para todo lo que aterrice en una página `●`: ni Zod, ni `decimal.js`, ni `zustand`.                              |
| A5  | La página del pedido recibe datos planos ya serializados                                               | **Confirmada.** Render de servidor puro del snapshot congelado, `noindex`, sin caché.                                                                                            |

**A2 se cae, y con razón.** El servidor no puede conocer `localStorage` durante
el `GET` de `/[slug]/carrito`: no es una preferencia, es un hecho. El arquitecto
puso el precio detrás de **`POST /api/orders/quote`**, que comparte `quoteCart()`
con la creación del pedido — y eso es lo que impide que lo que el carrito enseña
y lo que el checkout valida se separen. Mi índice de catálogo habría mandado
cientos de KB en una tienda de 5 000 productos y habría sido una segunda
implementación del precio.

**Lo que eso me obliga a rediseñar, y es el grueso de este ciclo:**

1. `/carrito` tiene **un segundo viaje**. Entre que la isla hidrata y que llega
   la cotización hay un estado real, no un parpadeo. En una conexión limitada es
   **la** pantalla del carrito durante varios segundos.
2. Lo mismo en `/checkout`: además del resumen y el total, **las opciones de
   entrega también llegan con la cotización** (`store.deliveryEnabled`,
   `deliveryFee`, `checkoutMode` viajan en la respuesta de `quote`, no en las
   props de la isla). Eso reordena la pantalla, § Estructura por breakpoint.
3. La cotización puede **fallar**, ir **lenta**, o quedar **obsoleta** cuando el
   comprador cambia una cantidad. Los tres tienen estado diseñado.

**Lo que el contrato de la isla me da y me quita:**

```ts
// respuesta 200 de POST /api/orders/quote — lo único que el carrito sabe del servidor
{ store: { slug, name, currencyCode, checkoutMode, deliveryEnabled, deliveryFee },
  lines: [{ storeProductId, slug, name, qty, unitPrice, currencyCode, lineTotal,
            originalUnitPrice, originalCurrencyCode, orderable, reason? }],
  subtotal, capturedAt }
```

- **No trae `imageUrl`.** Decisión: **el carrito no lleva miniaturas [c2]**. En
  el ciclo 1 las había. Pedir que el payload las traiga significa N peticiones de
  imagen más en un teléfono con conexión limitada, para reconocer algo que el
  nombre ya identifica y que además está a un toque de distancia en su ficha. Se
  quitan, y de paso desaparece un motivo de salto de maquetación.
- **Trae `reason`** (`OUT_OF_STOCK` · `REMOVED` · `NO_PRICE`), que es exactamente
  lo que E7 necesita pintar por línea.
- Con el carrito vacío **no se hace ninguna petición**: la isla pinta el estado
  vacío y ya. Cero viajes para cero líneas.

**Aritmética en el cliente.** La única cuenta que hace el navegador es
`total = subtotal + deliveryFee`, con las dos cadenas que vino del servidor, y se
hace con `add()` de `src/lib/money.ts` (puro, `BigInt`, sin dependencias), nunca
con `Number`. Ese valor es el `expectedTotal` que se manda: se compara, no se
persiste (R6, R7). `AddToCartButton` y `CartBadge` **no** pueden importar
`lib/money`: viven en páginas `●` y no muestran ningún importe.

---

## Flujo de usuario

Una frase: **el comprador ve un producto, lo agrega sin salir de la ficha, revisa
el carrito con precios que el servidor cotiza en ese momento, deja nombre y
teléfono, elige retiro o envío, confirma, y aterriza en una página con su código.**

```
/[slug]  ó  /[slug]/p/[productSlug]
      │  «Agregar al carrito»  (isla, sin navegación — E1)
      │        contador de la cabecera: 0 → 1
      ▼
/[slug]/carrito          ← enlace de la cabecera, o «Ver carrito» bajo el botón
      │  al montar:  POST /api/orders/quote   ← el segundo viaje [c2]
      │  cantidades (recotiza con rebote), quitar, vaciar
      │  bloqueo: si alguna línea no es pedible hay que quitarla (E7)
      ▼
/[slug]/checkout         ← «Continuar»
      │  al montar:  POST /api/orders/quote   ← trae también entrega y tarifa [c2]
      │  contacto · notas · entrega · total
      │  Confirmar  ──► 409 PRICE_CHANGED  → se redibuja el total, misma pantalla,
      │             │                        segundo «Confirmar con el total nuevo» (E13)
      │             ├─► 409 ITEMS_UNAVAILABLE → se marcan las líneas, «Quitar» en sitio (E12)
      │             ├─► 429 → aviso y espera
      │             └─► 500 / red caída → «Reintentar» (misma clave, R26/R27)
      ▼  201 · se vacía el carrito de ESA tienda · navegación dura
/[slug]/pedido/[code]    ← código, estado, resumen, y en WHATSAPP el enlace wa.me
```

**Vueltas atrás y qué se pierde.**

| Desde → hacia                                                            | Qué se conserva                             | Qué se pierde                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout → Carrito («Volver al carrito», y el botón atrás del navegador) | Las líneas y sus cantidades                 | **Lo tecleado en el formulario**: nombre, teléfono, correo, dirección, notas. R13 prohíbe guardarlo. El enlace de vuelta lo dice: «Volver al carrito (se pierde lo que escribiste)». **La cotización también se pierde y se vuelve a pedir [c2]**: es un viaje más, y por eso el enlace de vuelta no es la acción destacada. |
| Carrito → Catálogo                                                       | Todo el carrito                             | Nada                                                                                                                                                                                                                                                                                                                         |
| Ficha → Ficha                                                            | Todo                                        | Nada                                                                                                                                                                                                                                                                                                                         |
| Pedido → Catálogo («Seguir comprando»)                                   | Nada: el carrito ya se vació                | Nada recuperable. El pedido sigue en su URL.                                                                                                                                                                                                                                                                                 |
| Cerrar el navegador en cualquier punto antes de confirmar                | El carrito, hasta 30 días (R15)             | El formulario                                                                                                                                                                                                                                                                                                                |
| Cambiar de tienda                                                        | El carrito de cada tienda por separado (E4) | Nada                                                                                                                                                                                                                                                                                                                         |

**El punto de no retorno es uno solo:** el `201`. Antes de eso nada se ha
escrito; después, el comprador no puede editar ni cancelar (fuera de alcance).
Por eso el botón dice literalmente «Confirmar pedido» y encima lleva el total en
grande: la pantalla tiene que dejar claro qué es lo que se está confirmando.

---

## Inventario de pantallas y estados

### 0 · Cabecera de tienda (`src/app/[slug]/layout.tsx`) — toca en todas

| Estado                                                      | Qué se ve                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Antes del JS (siempre, incluido el HTML de las páginas SSG) | Enlace `Carrito` a la derecha del nombre de la tienda. **Sin burbuja.** El `getServerSnapshot()` del store de cliente devuelve un carrito vacío, así que el conteo es 0 y **la burbuja solo se renderiza con `count > 0`**: el HTML servido y la primera hidratación coinciden (sin _mismatch_) y nunca se pinta un «0» que sería mentira. |
| Hidratado, carrito vacío                                    | `Carrito` sin burbuja                                                                                                                                                                                                                                                                                                                      |
| Hidratado, con líneas                                       | `Carrito` + burbuja con el número de **unidades** (no de líneas: es lo que la gente cuenta), tope visual `99+`                                                                                                                                                                                                                             |
| Otra pestaña modificó el carrito                            | La burbuja se actualiza por el evento `storage` (E23)                                                                                                                                                                                                                                                                                      |
| `localStorage` bloqueado (E21)                              | Conteo en memoria de esa pestaña; al recargar vuelve a vacío. No hay error visible.                                                                                                                                                                                                                                                        |

### 1 · Ficha de producto — la isla de agregar

La isla **se renderiza siempre**, también para un producto agotado, y recibe
`disabled` ya calculado por el servidor con `isOrderable()` **[c2]**. Un
componente de cliente también se renderiza en el servidor, así que el atributo
`disabled=""` está en el HTML prerenderizado (E5, criterio 2a) sin que haya dos
caminos de código. Nada de `next/dynamic` con `ssr: false`: eso sí lo rompería.

| Estado                                 | Qué se ve                                                                                                                                                                                                                       | Notas                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pedible, antes del JS                  | El botón `Agregar al carrito` tal cual está hoy (`bg-brand`, `min-h-12`). Pulsarlo antes de hidratar no hace nada visible; React reproduce los clics discretos al terminar de hidratar, pero **no se diseña contando con eso**. | La isla sustituye solo al `<button>` de la línea 105 de la página actual. |
| Pedible, hidratado, aún sin agregar    | Igual                                                                                                                                                                                                                           |                                                                           |
| Agregando                              | El botón mantiene su texto y gana `aria-busy`. La operación es síncrona sobre `localStorage`: **no hay spinner**, poner uno sería teatro.                                                                                       |                                                                           |
| Agregado                               | El botón pasa 2 s a `✓ Agregado`, luego vuelve a `Agregar al carrito`. Debajo aparece, y **se queda**, la línea: `En tu carrito: 2 · Ver carrito` (enlace a `/[slug]/carrito`).                                                 | Cumple E1 y E2 sin steppers ni estado extra.                              |
| Agotado (E5)                           | Botón `Agotado`, `disabled` **en el HTML servido**.                                                                                                                                                                             | Verificado hoy con curl sobre la versión actual.                          |
| Tope de 50 líneas alcanzado (R14)      | El botón queda deshabilitado y debajo: `Tu carrito ya tiene 50 productos distintos. Quita alguno para agregar este.` con enlace al carrito.                                                                                     |                                                                           |
| Tope de 99 unidades en esa línea (R14) | `Ya tienes 99 unidades de este producto, que es el máximo.` El carrito no cambia.                                                                                                                                               |                                                                           |
| `localStorage` bloqueado (E21)         | Se agrega igual (memoria). Bajo el botón, una vez por visita: `Tu navegador no está guardando el carrito. Si recargas la página vas a perderlo.` (tono `warning`)                                                               | Ninguna página lanza error.                                               |

### 2 · `/[slug]/carrito` — **la pantalla que más cambió [c2]**

La vida de esta pantalla son **tres fases**, y las tres se ven de verdad en una
conexión lenta. La regla que las gobierna: **la lista no se mueve nunca.** Las
líneas y las cantidades ya están en `localStorage` desde el primer milisegundo;
lo único que falta son los importes, así que lo único que aparece son los
importes. Ni esqueletos que saltan, ni filas que cambian de alto.

| Fase / estado                                    | Qué se ve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F0 · Antes de hidratar** (HTML servido)        | `<h1>Tu carrito</h1>` + bloque con `aria-busy="true"`: `Cargando tu carrito…`. El servidor no puede saber qué hay en el teléfono; esto es honesto y dura milisegundos.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **F0 · Sin JavaScript**                          | `<noscript>`: `Para armar un pedido necesitas activar JavaScript. Puedes seguir viendo el catálogo` + enlace. La spec deja fuera pedir sin JS a propósito; lo que no se vale es dejar un «Cargando…» eterno.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **F1 · Hidratado, cotización en vuelo**          | **Las líneas completas ya están pintadas**: nombre (enlace a la ficha), cantidad y stepper operativos, `Quitar` operativo. El precio unitario se muestra con el valor de `display.unitPrice` guardado al agregar, en `text-fg-muted` — el contrato del carrito lo autoriza exactamente para esto («solo para pintar al instante»). **El total de línea no se pinta**: es aritmética y está prohibido calcularla en el cliente; su hueco queda reservado con el mismo alto. En el resumen, donde va el subtotal: `Calculando…`. `Continuar` deshabilitado, con `aria-describedby` al texto `Calculando el total…`.  |
| **F1 · Va lenta** (> 3 s)                        | Bajo el resumen aparece: `Estamos calculando los precios actuales. En una conexión lenta puede tardar un poco.` No se cancela nada, no aparece ningún spinner nuevo.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **F2 · Cotizado (E6)**                           | Los precios unitarios pasan a los del servidor y a `text-fg`; aparecen los totales de línea y el subtotal; `Continuar` se habilita. Un `aria-live="polite"` anuncia una vez: `Subtotal actualizado: $1 350.00.`                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Recotización tras cambiar una cantidad**       | El cambio se aplica a `localStorage` **al instante** (el número sube sin esperar a nadie) y la cotización se repite con un rebote de ~400 ms. Mientras vuelve, los importes ya conocidos siguen visibles con `opacity-60` y el resumen lleva `aria-busy="true"`. **La lista no se mueve y no se deshabilita nada.** Una respuesta vieja que llegue tarde se descarta.                                                                                                                                                                                                                                              |
| **Cotización fallida (red o 500)**               | La lista sigue en pantalla con los precios provisionales. Banner `danger` `role="alert"`: `No pudimos calcular los precios ahora mismo.` / `Revisa tu conexión. Los precios que ves son los de cuando agregaste y pueden haber cambiado.` Acción primaria `Reintentar`. `Continuar` deshabilitado. **Tras un reintento también fallido** aparece un enlace secundario `Continuar de todos modos`: el checkout vuelve a cotizar y, pase lo que pase, el servidor re-precia al crear (R6, R7), así que nada incorrecto puede persistirse — y bloquear la venta entera por una conexión mala es peor que dejar pasar. |
| **Cotización 404 `STORE_NOT_FOUND`**             | `Esta tienda ya no está disponible.` + enlace al inicio. Sin lista.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Vacío (E6)**                                   | Título, `Todavía no agregaste nada.`, botón secundario `Ver el catálogo` → `/[slug]`. **Sin botón de continuar y sin ninguna petición de cotización.**                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Línea agotada (E7, E12)**                      | `reason: OUT_OF_STOCK`. La fila se apaga (`text-fg-muted`), `Badge tone="muted"` con `Agotado`, total de línea `—`, el stepper desaparece y `Quitar` pasa a primario.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Línea eliminada u oculta (E7)**                | `reason: REMOVED` → `Ya no está disponible`. No enlaza a la ficha (sería un 404).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Línea sin precio (E7)**                        | `reason: NO_PRICE` → `Sin precio disponible`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Alguna línea no pedible**                      | Aviso `role="status"` sobre el resumen: `Hay 1 producto que no se puede pedir. Quítalo para continuar.` (`2 productos … Quítalos`). `Continuar` deshabilitado con `aria-describedby` a ese aviso. El subtotal que devuelve el servidor **no** las cuenta.                                                                                                                                                                                                                                                                                                                                                          |
| **Precio distinto del que se guardó al agregar** | Manda el del servidor y se sustituye sin comentario. Silencioso a propósito: aquí todavía no hay nada que confirmar, y avisar de un cambio en una pantalla donde no se decide nada solo genera ruido. Donde sí se avisa es en el 409 del checkout (E13).                                                                                                                                                                                                                                                                                                                                                           |
| **Carrito corrupto o de otra versión (E22)**     | Se descarta en silencio → estado vacío. Sin mensaje: el comprador no hizo nada malo y no puede hacer nada al respecto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Carrito de más de 30 días (R15)**              | Se descarta → estado vacío, con la línea `Tu carrito anterior caducó porque los precios ya no eran los mismos.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`localStorage` bloqueado (E21)**               | Funciona en memoria. Aviso `warning` una vez arriba: `Tu navegador no está guardando el carrito. No cierres esta pestaña hasta terminar.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Error del propio cascarón**                    | Salta `src/app/error.tsx`, que ya existe. No hay estado propio.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 3 · `/[slug]/checkout`

Aquí también hay cotización, y además **trae las opciones de entrega [c2]**:
`deliveryEnabled` y `deliveryFee` viajan en la respuesta de `quote`, no en las
props de la isla, para que una tienda que apagó el envío hace diez minutos no
siga ofreciéndolo desde una página cacheada. Consecuencia de maquetación, y es la
razón del orden vertical de § Estructura por breakpoint: **todo lo que llega
tarde vive junto, al final, encima del botón, y nunca por encima del cursor de
alguien que está tecleando.**

| Fase / estado                                  | Qué se ve                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F0 · Antes de hidratar**                     | El formulario de contacto y las notas **ya están en el HTML y son legibles y tecleables**: no dependen de nada. El resumen dice `Cargando tu pedido…`, el bloque de entrega dice `Cargando las opciones de entrega…`, y `Confirmar pedido` está `disabled` — para que nadie confirme un carrito que el navegador todavía no leyó.                                                                                 |
| **F0 · Sin JavaScript**                        | El mismo `<noscript>` que el carrito.                                                                                                                                                                                                                                                                                                                                                                             |
| **F1 · Cotización en vuelo**                   | Igual que F0 pero con los campos ya interactivos. Se puede ir tecleando el nombre y el teléfono **mientras** llega la cotización: es tiempo que no se pierde, y es la razón de que el contacto vaya arriba.                                                                                                                                                                                                       |
| **F1 · Va lenta** (> 3 s)                      | Bajo el resumen: `Estamos calculando el total. En una conexión lenta puede tardar un poco.`                                                                                                                                                                                                                                                                                                                       |
| **F2 · Cotizado, tienda sin delivery (E8)**    | El bloque de entrega **desaparece** (no queda un hueco vacío) y el resumen muestra subtotal y total, sin línea de envío. Contacto, notas, total, `Confirmar`.                                                                                                                                                                                                                                                     |
| **F2 · Cotizado, tienda con delivery (E9)**    | Dos tarjetas-radio: `Recoger en la tienda` (marcada por defecto) y `Envío a domicilio · $500.00`. Al elegir envío aparece **debajo** el campo `Dirección de entrega`, obligatorio, y en el resumen la línea `Envío`. El total se recalcula en el cliente sumando dos cadenas del servidor con `add()` de `lib/money`.                                                                                             |
| **`deliveryEnabled` con `deliveryFee = null`** | Idéntico a la tienda sin delivery. Ni «gratis» ni «a coordinar» (R3).                                                                                                                                                                                                                                                                                                                                             |
| **Cotización fallida**                         | Banner `danger` + `Reintentar`. **Aquí `Confirmar` no se habilita de ninguna manera**: el payload exige `expectedTotal` y sin cotización no hay total que prometer. Es la diferencia con el carrito, donde sí se deja pasar.                                                                                                                                                                                      |
| **Carrito vacío al llegar**                    | No se muestra el formulario: `Tu carrito está vacío.` + `Ver el catálogo`. Evita teclear diez campos para nada.                                                                                                                                                                                                                                                                                                   |
| **Alguna línea no pedible al llegar**          | Aviso `danger` arriba + `Volver al carrito` como acción primaria. El formulario se muestra dentro de un `<fieldset disabled>`, no oculto: se ve que el trabajo no se perdió.                                                                                                                                                                                                                                      |
| **Validación fallida (cliente)**               | Resumen de errores arriba con `role="alert"`, foco movido a él, y error bajo cada campo. Ver § Accesibilidad y § Textos.                                                                                                                                                                                                                                                                                          |
| **Enviando**                                   | Botón `disabled` con texto `Enviando pedido…` y `aria-busy="true"`; el `<fieldset>` entero deshabilitado; `aria-live` anuncia `Enviando tu pedido, espera un momento.` Segundo clic imposible.                                                                                                                                                                                                                    |
| **409 `ITEMS_UNAVAILABLE` (E12)**              | Banner `danger` `role="alert"`: `Algo cambió mientras hacías el pedido.` + `No se creó ningún pedido.` Cada línea afectada del resumen se marca con su motivo y un botón `Quitar` en sitio. El primario pasa a `Quitar y volver a confirmar` y sigue deshabilitado mientras quede alguna. Enlace secundario `Volver al carrito`. Quitar en sitio y no obligar a volver es lo que salva el formulario ya tecleado. |
| **409 `PRICE_CHANGED` (E13)**                  | Banner `warning` `role="alert"`: `El precio cambió mientras hacías el pedido.` Cada línea cambiada muestra `Antes $450.00 · Ahora $480.00` — el anterior con `line-through` **y** con la palabra «Antes», porque un tachado solo no lo lee nadie con lector. El total nuevo, destacado. El primario pasa a `Confirmar con el total nuevo`. **Nada se reenvía solo.** La `idempotencyKey` no cambia (R26).         |
| **429 (E26)**                                  | Banner `warning`: `Ya enviaste varios pedidos en los últimos minutos.` + `Espera unos 6 minutos e intenta de nuevo.` (minutos redondeados hacia arriba desde `retryAfterSeconds`; **sin cuenta atrás en vivo**, un `setInterval` por segundo no vale lo que cuesta). Botón deshabilitado con ese texto.                                                                                                           |
| **400 `INVALID_BODY`**                         | Los `issues` que mapeen a un campo se pintan en su campo; los que no, en el banner: `Revisa los datos del pedido.`                                                                                                                                                                                                                                                                                                |
| **400 `EMPTY_CART`**                           | Se pasa al estado «carrito vacío» de arriba.                                                                                                                                                                                                                                                                                                                                                                      |
| **404 `STORE_NOT_FOUND`**                      | Banner `danger`: `Esta tienda ya no está disponible.` + enlace al inicio.                                                                                                                                                                                                                                                                                                                                         |
| **500 `ORDER_CREATE_FAILED`**                  | Banner `danger`: `No pudimos guardar tu pedido. No se te cobró nada y tu carrito sigue completo.` + `Reintentar` (misma clave → seguro, R27).                                                                                                                                                                                                                                                                     |
| **Red caída / `fetch` que lanza**              | Igual, con `Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.` + `Reintentar`. Este es **el** caso probable del público objetivo: por eso el reintento es un botón grande, no un enlace.                                                                                                                                                                                                   |
| **200 idempotente (E24)**                      | Se trata como el 201: se vacía el carrito y se navega. El comprador no tiene por qué enterarse de que su primer envío sí llegó.                                                                                                                                                                                                                                                                                   |
| **201 (E10)**                                  | Se vacía el carrito de esa tienda, se borra la clave de idempotencia, se muestra `Pedido creado. Abriendo tu comprobante…` y se navega **duro** a `/[slug]/pedido/[code]` (no `router.push`: se quiere que el botón atrás no devuelva a un formulario con el carrito ya vacío).                                                                                                                                   |

De dónde sale el «Antes» de E13: si sale del servidor (AP1 → a) o del último
`quote` que la isla ya tiene en memoria (AP1 → b), **la pantalla es la misma**.
Esa pregunta del arquitecto no cambia ni un píxel de aquí.

### 4 · `/[slug]/pedido/[code]` — 100 % servidor, cero módulos de cliente

**Esta propiedad es un requisito, no una casualidad [c2]** (DP2 del humano): la
página que muestra nombre, teléfono y dirección de una persona no ejecuta ni un
byte de JavaScript propio. Nada de botón «copiar el código», nada de «ver datos»,
nada de refresco automático. El enlace de WhatsApp es un `<a>`, no un botón.

| Estado                                         | Qué se ve                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Recién creado, `WHATSAPP` con número (E18)** | Banner `positive` `¡Pedido recibido!`, el código en grande `A7K3M-9PQR2`, `Estado: Pendiente de confirmación`, enlace-botón `Enviar el pedido por WhatsApp` presentado como **atajo opcional** (DP1), explicación, entrega, contacto, líneas y totales.                                                                                          |
| **`WHATSAPP` sin `whatsapp` ni `phone`**       | Todo igual **menos** el enlace. En su lugar, una tarjeta `muted`: `Esta tienda todavía no tiene un número de WhatsApp publicado. Guarda tu código: la tienda ya recibió el pedido.`                                                                                                                                                              |
| **`ONSITE` (E18)**                             | Todo igual, **sin** enlace y **sin** esa tarjeta. Nada en el HTML contiene `wa.me` (criterio 11).                                                                                                                                                                                                                                                |
| **`PENDING`**                                  | `Pendiente de confirmación` · `positive`. «La tienda todavía no lo revisó.»                                                                                                                                                                                                                                                                      |
| **`PULLED`**                                   | `Recibido por la tienda` · `positive`. «La tienda ya lo tiene en su sistema.»                                                                                                                                                                                                                                                                    |
| **`CONFIRMED` (E19)**                          | `Confirmado` · `positive`. «La tienda confirmó tu pedido.»                                                                                                                                                                                                                                                                                       |
| **`READY`**                                    | Con dirección: `Listo para enviar`; sin dirección: `Listo para recoger` · `positive`.                                                                                                                                                                                                                                                            |
| **`DELIVERED`**                                | `Entregado` · `muted`. «Gracias por tu compra.»                                                                                                                                                                                                                                                                                                  |
| **`CANCELLED`**                                | `Cancelado` · `danger`. «La tienda canceló este pedido. Si no sabes por qué, contáctala.» + los datos de contacto de la tienda si los hay.                                                                                                                                                                                                       |
| **Contacto y entrega**                         | **Completos y a la vista** (DP2): nombre, teléfono y, si hubo envío, la dirección entera. El comprador tiene que poder comprobar la dirección **antes** de que salga el repartidor, y eso pesa más que esconder un dato que él mismo acaba de teclear. La protección es el `code` inadivinable (R17), el `noindex` y la ausencia de caché (R18). |
| **Código inexistente o de otra tienda (E17)**  | 404 con la cabecera de la tienda puesta: `No encontramos ese pedido.` / `Revisa el código: son 10 caracteres y a veces se confunde un 0 con una O.` / `Ver el catálogo`. Un `not-found.tsx` en el segmento del pedido, para no perder el marco de la tienda.                                                                                     |
| **Carga**                                      | No hay: es HTML servido de una sola pieza. Esto es exactamente el objetivo de F-013.                                                                                                                                                                                                                                                             |
| **Actualización de estado**                    | Nota al pie: `Actualiza la página para ver el estado más reciente.` **No hay polling.**                                                                                                                                                                                                                                                          |

No hay estado «sin permiso» en ninguna pantalla: F-010 no tiene sesión (R24). Su
equivalente es el 404 del código desconocido, que además es lo que protege la PII.

---

## Estructura por breakpoint

360 primero. `Container` ya da `max-w-6xl px-4 sm:px-6`; nada de lo nuevo lo
cambia.

| Zona                                   | 360                                                                                                                                                                                                                                                                                                                                                                                | 768                                                                           | 1280                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cabecera de tienda**                 | Nombre (truncado a una línea) + `Carrito ⟨n⟩` a la derecha. La ciudad **se oculta** (`hidden sm:inline`): hoy compite con el nombre y a partir de ahora también con el carrito.                                                                                                                                                                                                    | Nombre · ciudad · `Carrito ⟨n⟩`                                               | Igual que 768                                                                                                                                          |
| **Ficha de producto**                  | Sigue apilada (`md:grid-cols-2` ya vigente). Botón de agregar **a todo el ancho** (`w-full sm:w-auto`), `min-h-12`.                                                                                                                                                                                                                                                                | Dos columnas, botón al ancho de su contenido                                  | Igual                                                                                                                                                  |
| **Carrito · lista** **[c2]**           | Una columna, **sin miniatura**. Fila: `[nombre / precio unitario]` + total de línea a la derecha; **segunda fila** con el stepper y `Quitar`. Dos filas porque cuatro cosas en 360 px o se solapan o bajan de 44 px de toque. El hueco del total de línea está reservado desde F1, así que al llegar la cotización **el alto de la fila no cambia**.                               | Una sola fila por línea: nombre, stepper, total, `Quitar`                     | Igual que 768, con más aire                                                                                                                            |
| **Carrito · resumen**                  | Barra **fija abajo** (`sticky bottom-0`, `bg-surface`, `border-t`, `shadow-card`): `Subtotal $X` (o `Calculando…`) + `Continuar` a todo el ancho. La lista lleva `pb-28` para no quedar debajo.                                                                                                                                                                                    | Tarjeta al final de la lista, en flujo. Sin barra fija.                       | Columna derecha `sticky top-6`, `lg:grid-cols-[1fr_20rem]`                                                                                             |
| **Checkout · orden vertical** **[c2]** | 1 resumen plegado (`<details>`: `3 productos · $1 240.00`, o `Calculando…`), 2 **contacto**, 3 **notas**, 4 **entrega**, 5 total desglosado, 6 `Confirmar`. El contacto sube y la entrega baja **porque la entrega llega con la cotización**: así todo lo que aparece tarde queda agrupado al final, encima del botón, y nunca empuja el campo en el que alguien está escribiendo. | Igual, con el resumen **desplegado** (`<details open>`)                       | Dos columnas `lg:grid-cols-[1fr_22rem]`: contacto y notas a la izquierda; entrega, resumen, total y `Confirmar` en tarjeta `sticky top-6` a la derecha |
| **Checkout · campos**                  | Uno por fila, a todo el ancho, `min-h-11`                                                                                                                                                                                                                                                                                                                                          | Nombre y teléfono comparten fila (`sm:grid-cols-2`); el resto a todo el ancho | Igual que 768                                                                                                                                          |
| **Checkout · entrega**                 | Dos tarjetas-radio apiladas, toda la tarjeta clicable, `min-h-14`. Mientras se cotiza, una línea `muted` del mismo alto que **una** tarjeta: al llegar la respuesta crece hacia abajo, nunca hacia arriba.                                                                                                                                                                         | Dos en fila                                                                   | Dos en fila                                                                                                                                            |
| **Checkout · confirmar**               | En flujo, al final, a todo el ancho, `size="lg"`. **No** se hace `sticky`: en 360 px taparía el campo que se está escribiendo cuando sube el teclado.                                                                                                                                                                                                                              | Igual                                                                         | Dentro de la tarjeta del resumen                                                                                                                       |
| **Pedido · cabecera del comprobante**  | Código en `text-3xl tracking-[0.2em]`, partido `XXXXX-XXXXX` para que quepa. Badge de estado debajo.                                                                                                                                                                                                                                                                               | `text-4xl`, badge al lado                                                     | Igual que 768                                                                                                                                          |
| **Pedido · atajo de WhatsApp**         | A todo el ancho, inmediatamente debajo del código                                                                                                                                                                                                                                                                                                                                  | Ancho de contenido                                                            | Ancho de contenido                                                                                                                                     |
| **Pedido · líneas y totales**          | Apilado, una columna                                                                                                                                                                                                                                                                                                                                                               | Una columna, ancho `max-w-2xl`                                                | Dos columnas: líneas y totales a la izquierda, entrega y contacto a la derecha                                                                         |
| **Barra fija (solo carrito, 360)**     | `pb-[env(safe-area-inset-bottom)]` para el iPhone con barra de gestos                                                                                                                                                                                                                                                                                                              | No aplica                                                                     | No aplica                                                                                                                                              |

**La regla que gobierna las tres pantallas nuevas en 360:** una columna, nada que
haga scroll horizontal, una sola acción primaria visible, y **nada que llegue
tarde por encima de algo que ya se podía tocar o escribir**.

---

## Componentes de UI

**Se reutilizan tal cual, sin tocarlos:** `Container`, `Card`, `Badge`
(los cuatro tonos ya cubren todo lo que se necesita), `Button` (las tres
variantes y `min-h-11`/`min-h-12` ya dan el área de toque), `ProductCard`
(intacto: **sigue siendo server component**, R21, y no monta ninguna isla).

**Primitivos nuevos en `src/components/ui/`:**

| Componente  | Por qué no alcanza lo que hay                                                                                                                                                                                                    | Directiva |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `Field`     | Hoy no existe **ningún** input en el repo. Envuelve `<label>` + control + ayuda + error, y cablea `id`, `aria-describedby` y `aria-invalid` en un solo sitio. Si esto se repite a mano seis veces, dos de las seis quedarán mal. | Ninguna   |
| `Alert`     | Los cuatro banners (`danger`, `warning`, `positive`, `muted`) con el `role` correcto según el tono. `Badge` es para etiquetas de una palabra, no para un párrafo con un botón dentro.                                            | Ninguna   |
| `RadioCard` | La elección retiro/envío tiene que ser una superficie grande y clicable con estado visible sin depender solo del color. Un `<input type=radio>` suelto en 360 px es un objetivo de 20 px.                                        | Ninguna   |

**Componentes de dominio.** El arquitecto los ubica en `src/features/cart/` y
`src/features/orders/`; este diseño no discute la ubicación.

| Componente          | Qué hace                                                                                 | `"use client"`                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cartStore`         | Módulo de estado + `useCart()` con `useSyncExternalStore`, evento `storage`              | **Sí** (módulo, no componente)                                                                                                                                                                |
| `AddToCartButton`   | El botón de la ficha + la línea «En tu carrito: n · Ver carrito»                         | **Sí** — `onClick` y estado local                                                                                                                                                             |
| `CartBadge`         | El enlace de la cabecera con la burbuja                                                  | **Sí** — suscripción al store                                                                                                                                                                 |
| `CartView`          | Toda la pantalla del carrito, incluida la cotización y sus tres fases                    | **Sí**                                                                                                                                                                                        |
| `CheckoutForm`      | Formulario + entrega + resumen + envío + errores                                         | **Sí** — el estado más grande del feature                                                                                                                                                     |
| `QuantityStepper`   | `−` n `+` accesible **[c2]**                                                             | **No.** Recibe `onDecrement`, `onIncrement` y `onChange` de `CartView`. El arquitecto fija cuatro islas y ni una más; un stepper sin estado propio no necesita la directiva y así se respeta. |
| `CartLineRow`       | Presentación de una línea (nombre, precio, estado, hueco reservado del total)            | No: se usa desde `CartView` y desde el resumen del checkout                                                                                                                                   |
| `OrderSummary`      | Subtotal · envío · total, con la variante «antes/ahora» de E13 y el estado `Calculando…` | No                                                                                                                                                                                            |
| `OrderStatusBadge`  | `OrderStatus` → etiqueta en español + tono                                               | No — **server component puro**, lo usa la página del pedido                                                                                                                                   |
| `OrderLinesTable`   | Las líneas congeladas del pedido                                                         | No — server component                                                                                                                                                                         |
| `WhatsappOrderLink` | El `<a href="wa.me/…">`, o la tarjeta de «sin número»                                    | No — server component; es un enlace                                                                                                                                                           |

Sobre `Field`, `Alert`, `RadioCard`, `QuantityStepper`, `CartLineRow` y
`OrderSummary`: **no llevan directiva y aun así acaban en el bundle de cliente**
porque los importa un componente que sí la lleva. Eso es correcto y no
contradice `AGENTS.md`: la prohibición es poner `"use client"` donde no hay
estado ni eventos, no que un componente presentacional sea reutilizable desde
ambos lados. Lo que **no** puede pasar es que `ProductCard`, las páginas de
catálogo, `OrderStatusBadge` o `OrderLinesTable` sean importados desde un
componente de cliente: eso los arrastraría al bundle.

---

## Tokens y tema

**No hace falta ni un token nuevo.** Todo sale de `src/theme/tokens.css` tal como
está hoy:

| Uso                                                                      | Token / utilidad                                                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fondo de página / tarjeta / zona apagada                                 | `bg-bg`, `bg-surface`, `bg-surface-muted`                                                                                                                 |
| Bordes y separadores                                                     | `border-border`                                                                                                                                           |
| Texto y texto secundario                                                 | `text-fg`, `text-fg-muted`                                                                                                                                |
| Precio provisional mientras se cotiza **[c2]**                           | `text-fg-muted` (el mismo apagado que el resto de lo secundario: no se inventa un token «pendiente»)                                                      |
| Acciones primarias (agregar, continuar, confirmar, WhatsApp, reintentar) | `bg-brand text-brand-contrast`                                                                                                                            |
| Acciones secundarias (volver, ver catálogo, quitar)                      | variante `secondary` de `Button`                                                                                                                          |
| Éxito (banner del pedido, estados vivos)                                 | `bg-positive/12 text-positive`                                                                                                                            |
| Aviso (precio cambiado, 429, `localStorage`)                             | `bg-warning/15 text-warning`                                                                                                                              |
| Error (líneas no pedibles, cotización caída, 500, red)                   | `bg-danger/12 text-danger`                                                                                                                                |
| Bordes de banner                                                         | `border-danger/30`, `border-warning/30`, `border-positive/30`                                                                                             |
| Esquinas                                                                 | `rounded-sm\|md\|lg` (nunca `rounded-[--radius-lg]`: es la sintaxis v3 que rompió F-003 y que `check:theme` persigue)                                     |
| Sombra de tarjetas y de la barra fija                                    | `shadow-card`                                                                                                                                             |
| Anillo de foco                                                           | `focus-visible:outline-brand outline-2 outline-offset-2`, igual que `Button` hoy                                                                          |
| Recotización en vuelo **[c2]**                                           | `opacity-60` sobre los importes ya conocidos. Sin animación: `prefers-reduced-motion` ya está resuelto en `globals.css` y así no hay nada que desactivar. |
| Tipografía                                                               | `font-sans` + la escala de Tailwind (`text-sm`…`text-3xl`). Sin tamaños arbitrarios.                                                                      |

**Cómo responde al branding por tienda (F-003 / F-016).** La tienda puede
redefinir `brand`, `brandContrast`, `accent`, `accentContrast` y la escala
`radius` (`sharp|soft|round`), y nada más. Consecuencias buscadas:

- El botón de agregar, `Continuar`, `Confirmar pedido`, `Reintentar` y el atajo de
  WhatsApp cambian de color con la tienda: la marca cae donde el comprador mira.
- Con `radius: round` (`--radius-lg: 2rem`) las tarjetas del carrito, las
  tarjetas-radio y el banner del pedido se redondean solos. Ninguna medida está
  clavada.
- La tarjeta-radio seleccionada usa `border-brand` + `bg-brand/8`.

**Una decisión deliberada contra la marca:** los importes **no** van en
`text-brand`. En el catálogo sí (así está hoy y no se toca), pero en el carrito,
el checkout y el pedido el subtotal y el total van en `text-fg font-semibold`.
Razón: `brand` lo elige la tienda y `storeTheme.ts` solo valida que sea un color
CSS, no que contraste. Un color de marca claro sobre `--color-bg` deja un precio
ilegible, y el precio es el dato que decide la compra. La marca se queda en el
botón, donde va emparejada con `brand-contrast`, que la tienda elige junto con ella.

- Los tonos `positive` / `warning` / `danger` **no** son overridables: una tienda
  no puede pintar de verde un error. Correcto y a propósito.
- Riesgo que queda vivo: una tienda con `brand` casi blanco y `brandContrast`
  también claro deja los botones ilegibles. No es de F-010 arreglarlo (haría
  falta validar contraste en `storeTheme.ts`); queda anotado para un F-016bis.

---

## Accesibilidad

**Orden de foco (Tab), por pantalla.**

- _Ficha:_ nombre de la tienda → `Carrito` → … contenido … → `Agregar al carrito`
  → (si ya se agregó) `Ver carrito`. El enlace «Ver carrito» aparece **después**
  del botón en el DOM, así que se inserta sin mover el foco de nadie.
- _Carrito:_ cabecera → por línea: nombre → `−` → campo de cantidad → `+` →
  `Quitar` → … → `Vaciar carrito` → `Continuar`. Al **quitar** una línea el foco
  pasa al `Quitar` de la línea siguiente, o al `Ver el catálogo` del estado vacío
  si era la última: el foco nunca se cae al `<body>`. **Cuando llega la
  cotización no se mueve el foco [c2]**: solo cambian textos.
- _Checkout:_ (banner de error si existe) → nombre → teléfono → correo → notas →
  entrega → dirección (solo si envío) → `Confirmar`. La dirección se **inserta
  debajo** de la tarjeta-radio de envío, se anuncia con `aria-live` y el foco
  **no** se mueve solo: mover el foco por marcar un radio desorienta.
- _Pedido:_ `Enviar el pedido por WhatsApp` es el primer elemento enfocable del
  contenido, después de la cabecera.

**Los estados de carga, contados a quien no ve la pantalla [c2].**

- El resumen del carrito y el del checkout son un contenedor con
  `aria-live="polite"` y `aria-busy="true"` mientras se cotiza. Al terminar,
  `aria-busy="false"` y se anuncia una sola vez: `Subtotal actualizado: $1 350.00.`
  / `Total actualizado: $1 850.00.`
- El texto `Calculando…` es texto real dentro de ese contenedor, no un atributo:
  quien lo lee, lo lee.
- `Continuar` y `Confirmar` deshabilitados llevan `aria-describedby` al texto que
  explica por qué (`Calculando el total…`, `Hay 1 producto que no se puede pedir…`,
  `Espera unos 6 minutos…`). Un botón gris sin motivo es un callejón sin salida.
- La recotización tras cambiar una cantidad **no** se anuncia como carga; solo se
  anuncia el subtotal nuevo cuando llega. Anunciar «calculando» en cada toque del
  `+` convierte el lector en una alarma.
- El banner de cotización fallida es `role="alert"`: interrumpe, porque cambia el
  significado del botón que el comprador estaba a punto de pulsar.

**Errores de formulario — el punto delicado.**

1. Se valida al enviar, no en cada tecla. Después del primer envío fallido, cada
   campo se revalida al salir de él (`blur`) para que el error desaparezca en
   cuanto se corrige.
2. Al fallar: un `<div role="alert" tabindex="-1">` arriba recibe el foco por
   programa y contiene `Revisa 2 datos antes de continuar` y una lista de
   **enlaces** (`<a href="#field-phone">Teléfono: escribe un número de 8 a 15
dígitos</a>`). Con lector se oye el resumen entero; con teclado se salta al campo.
3. Cada control marcado con `aria-invalid="true"` y `aria-describedby="…-error"`,
   apuntando al `<p id="…-error">` de debajo. El texto del error **es el texto
   accesible**: no hay iconos que digan cosas que el texto no diga.
4. El error nunca se comunica solo por color: lleva su texto y el prefijo del
   campo. `text-danger` sobre `bg-bg` es un contraste ≥ 4,5:1 en claro y en
   oscuro, y no es overridable.
5. Los banners de 409/429/500 son `role="alert"`. Los avisos del carrito
   («hay 1 producto que no se puede pedir») son `role="status"`: informan sin
   interrumpir.

**Otros compromisos concretos.**

- Área de toque mínima 44×44 px en todo lo interactivo: `Button` ya da
  `min-h-11`/`min-h-12`; el `−`/`+` del stepper es `h-11 w-11`; `Quitar` es un
  `<button>` de texto con `min-h-11 px-3`.
- El stepper: `−` y `+` son `<button type="button">` con
  `aria-label="Quitar una unidad de Café Cubita"` / `"Agregar una unidad de Café
Cubita"`. La cantidad va en un `<input type="text" inputmode="numeric">` con
  `<label class="sr-only">Cantidad de Café Cubita</label>`, tecleable y no solo
  pulsable. En el `−` de la cantidad 1 el botón queda `disabled` y `Quitar` es el
  camino de salida: bajar a 0 y ver desaparecer la fila sin avisar es peor.
- Cada cambio de cantidad y cada baja se anuncian en `aria-live="polite"`:
  `Café Cubita: 3 unidades.` / `Quitaste Café Cubita.`
- El contador de la cabecera: el enlace tiene `aria-label="Carrito, 3 productos"`;
  la burbuja va `aria-hidden`. Sin número, `aria-label="Carrito"` a secas.
- Teclado en las tarjetas-radio: son `<input type="radio">` reales dentro de un
  `<fieldset>` con `<legend>¿Cómo lo quieres recibir?</legend>`; flechas para
  moverse, comportamiento nativo. Sin `div role=radio` hecho a mano.
- `autocomplete="name"`, `"tel"`, `"email"`, `"street-address"`;
  `inputmode="tel"` en el teléfono y `type="email"` en el correo, para que se abra
  el teclado correcto. `enterkeyhint="next"`.
- El código del pedido: `<p class="tracking-[0.2em]">` con el texto visible
  agrupado `A7K3M-9PQR2` y `aria-label="Código del pedido: A 7 K 3 M 9 P Q R 2"`,
  separado por espacios, para que el lector lo dicte carácter a carácter en vez de
  intentar pronunciarlo.
- La página del pedido no tiene JavaScript, así que **su accesibilidad no depende
  de que hidrate nada**. Es la pantalla más robusta del feature y conviene que
  siga siéndolo.

---

## Coste de cliente

**El presupuesto de verdad.** `scripts/check-bundle-budget.mjs` mide solo páginas
**prerenderizadas**, así que de las cuatro pantallas nuevas únicamente cuentan las
que viven en rutas SSG: `/[slug]` y `/[slug]/p/[productSlug]`. El carrito, el
checkout y la página del pedido son `ƒ` y **no entran en la medida** — lo que no
significa que no cuesten en el teléfono de alguien.

| Módulo                                                                   | Directiva                             | Por qué la necesita (regla de `AGENTS.md`)                                                                                       | Rutas donde aterriza                       | Estimado (gzip) |
| ------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------- |
| `cartStorage` + esquema del carrito                                      | —                                     | Lectura/escritura/validación de `localStorage`. **Sin Zod** (A4).                                                                | Todas donde haya isla                      | ~1,5 KB         |
| `cartStore`                                                              | `"use client"`                        | Estado compartido entre dos subárboles con `useSyncExternalStore`; sin Context, para no meter un cliente en el layout de las SSG | Todas donde haya isla                      | ~1,0 KB         |
| `CartBadge`                                                              | `"use client"`                        | Suscripción al store + evento `storage`. Lo exige E1.                                                                            | **Todas** las de tienda, incluidas las SSG | ~0,6 KB         |
| `AddToCartButton`                                                        | `"use client"`                        | `onClick` + estado del «✓ Agregado»                                                                                              | Ficha de producto (SSG)                    | ~1,2 KB         |
| `CartView` (+ `QuantityStepper`, `CartLineRow`, `OrderSummary`, `Alert`) | `"use client"` solo en `CartView`     | Estado del carrito, cotización, sus tres fases y sus errores                                                                     | Carrito (ƒ)                                | ~4 KB           |
| `CheckoutForm` (+ `Field`, `RadioCard`, `lib/money`)                     | `"use client"` solo en `CheckoutForm` | Formulario, validación, entrega, envío y manejo de 409/429/500                                                                   | Checkout (ƒ)                               | ~6 KB           |
| Página del pedido                                                        | —                                     | **Cero módulos de cliente propios** (DP2)                                                                                        | Pedido (ƒ)                                 | 0               |

**Impacto sobre el presupuesto (criterio 21):** de todo lo anterior, en las
páginas medidas solo caen `cartStorage` + `cartStore` + `CartBadge` +
`AddToCartButton` ≈ **4,3 KB gzip** sobre los ~180 KB de suelo de Next 16 +
React 19. Estimación a confirmar midiendo: `BUNDLE_BUDGET_KB` alrededor de **195**
(medido ~184 + los ~10 KB de margen que ya representan los 190 de hoy). Si la
medida real se va bastante por encima, **no se sube el número sin mirar**: casi
seguro hay un `"use client"` de más o una dependencia colada (Zod, `decimal.js`,
`zustand`, `lib/money` en la ficha), y la ficha
`.agent/playbook/bundle-fuera-de-presupuesto.md` es lo que hay que aplicar.

**Coste consciente aprobado por el humano (DP3):** el contador va en la cabecera
de **todas** las páginas de tienda, incluidas las `●` del catálogo. Son ~1,6 KB
(`cartStore` + `CartBadge`) que F-013 hereda; sin él, desde la portada de la
tienda no habría forma de saber que hay algo en el carrito ni de llegar a él, y
E1 no se cumpliría. **Anotado explícitamente para F-013.**

**Seis cosas que se descartaron por lo que cuestan en JavaScript:**

1. **Gestor de estado (`zustand`, Context global).** Prohibido por SP4 y resuelto
   por el arquitecto con un módulo + `useSyncExternalStore`. `zustand` sigue en
   `package.json` sin usar: es dependencia muerta que F-013 puede quitar.
2. **Botón «copiar el código» en la página del pedido.** Sería el único
   `"use client"` de una página que hoy no tiene ninguno, y el humano pidió
   conservar esa propiedad (DP2). El código es corto y se selecciona con el dedo.
3. **Cuenta atrás en vivo del 429.** Un `setInterval` por segundo para un dato que
   se entiende igual en minutos.
4. **Refresco automático del estado del pedido.** Polling es JS permanente y red
   constante para quien tiene conexión limitada. Una frase que dice «actualiza la
   página» hace el mismo trabajo. La versión buena de esto es la propuesta
   `timbre-realtime`.
5. **Toast flotante al agregar.** Portal, temporizador y gestión de foco. El texto
   que cambia en el propio botón, más la burbuja de la cabecera, comunica lo mismo
   por ~0 bytes.
6. **Esqueleto animado mientras se cotiza [c2].** Cuesta CSS y marcado para fingir
   una lista que **ya tenemos de verdad** en `localStorage`. Se pintan las líneas
   reales y solo se reserva el hueco de los importes.

**Lo que hay que vigilar en la revisión del diff** (no lo detecta ningún sensor):
que `ProductCard` y las páginas de `[slug]` sigan sin directiva y sin montar
islas (R21), que ninguna isla use `useSearchParams()` —saca la página de `●`—,
que ningún componente de cliente importe algo de `features/*/server/`, y que el
`matcher` de `src/proxy.ts` siga sin tocar `/[slug]` (R20, ficha
`proxy-matcher-anula-isr`).

---

## Textos

Todo en español, en el registro que ya usa la tienda: tuteo, frases cortas, sin
signos de exclamación salvo en la confirmación del pedido.

**Cabecera:** `Carrito` · `aria-label`: `Carrito, {n} productos` / `Carrito`

**Ficha de producto**

- `Agregar al carrito` · `Agotado` · `✓ Agregado`
- `En tu carrito: {n} · Ver carrito`
- `Tu carrito ya tiene 50 productos distintos. Quita alguno para agregar este.`
- `Ya tienes 99 unidades de este producto, que es el máximo.`
- `Tu navegador no está guardando el carrito. Si recargas la página vas a perderlo.`

**Carrito**

- Título: `Tu carrito`
- Antes de hidratar: `Cargando tu carrito…`
- `noscript`: `Para armar un pedido necesitas activar JavaScript. Puedes seguir viendo el catálogo.`
- Vacío: `Todavía no agregaste nada.` / botón `Ver el catálogo`
- Caducado: `Tu carrito anterior caducó porque los precios ya no eran los mismos.`
- Por línea: `{precio} c/u` · `Quitar` · `aria-label` del stepper: `Agregar una unidad de {producto}` / `Quitar una unidad de {producto}`
- Estados de línea: `Agotado` · `Ya no está disponible` · `Sin precio disponible`
- Aviso de bloqueo: `Hay {n} producto(s) que no se puede(n) pedir. Quítalo(s) para continuar.`
- `Vaciar carrito` → confirmación en línea: `¿Vaciar el carrito?` con `Sí, vaciar` y `No`
- Resumen: `Subtotal` · `El envío se calcula en el siguiente paso.` · botón `Continuar`
- **Cotización [c2]:** `Calculando…` (en el lugar del importe) · `Calculando el total…` (el texto al que apunta el botón deshabilitado) · `Estamos calculando los precios actuales. En una conexión lenta puede tardar un poco.` · anuncio `Subtotal actualizado: {importe}.`
- **Cotización fallida [c2]:** `No pudimos calcular los precios ahora mismo.` / `Revisa tu conexión. Los precios que ves son los de cuando agregaste y pueden haber cambiado.` / botón `Reintentar` / enlace `Continuar de todos modos`
- Aviso de almacenamiento: `Tu navegador no está guardando el carrito. No cierres esta pestaña hasta terminar.`

**Checkout**

- Título: `Confirmar pedido`
- Volver: `Volver al carrito (se pierde lo que escribiste)`
- Resumen plegado: `Tu pedido · {n} productos · {subtotal}` / `Ver detalle` · `Ocultar detalle`
- **Cotización [c2]:** `Cargando tu pedido…` · `Cargando las opciones de entrega…` · `Estamos calculando el total. En una conexión lenta puede tardar un poco.` · anuncio `Total actualizado: {importe}.`
- **Cotización fallida [c2]:** `No pudimos calcular el total.` / `Sin el total actualizado no podemos crear el pedido. Revisa tu conexión y vuelve a intentar.` / botón `Reintentar`
- Entrega: `<legend>¿Cómo lo quieres recibir?</legend>` · `Recoger en la tienda` (`Sin costo de envío`) · `Envío a domicilio` (`+ {tarifa}`)
- Campos: `Nombre y apellidos` · `Teléfono` (ayuda: `Por aquí te va a contactar la tienda. Ej.: +53 5555 5555`) · `Correo (opcional)` · `Dirección de entrega` (ayuda: `Calle, número, entre calles y municipio.`) · `Notas para la tienda (opcional)` (ayuda: `Por ejemplo: tocar el timbre de abajo.`)
- Totales: `Subtotal` · `Envío` · `Total`
- Expectativa (DP4, **texto literal aprobado, no se cambia ni una palabra**):
  `La tienda va a revisar tu pedido y te va a contactar por teléfono para confirmarlo. Al enviarlo no se reserva ninguna unidad ni se cobra nada.`
- Botón: `Confirmar pedido` → `Enviando pedido…` → `Pedido creado. Abriendo tu comprobante…`

_Errores de campo_ (uno por regla, tal cual):

- `Escribe tu nombre.`
- `El nombre es demasiado corto.` / `El nombre no puede pasar de 80 caracteres.`
- `Escribe un teléfono para que la tienda pueda contactarte.`
- `El teléfono tiene que tener entre 8 y 15 dígitos.`
- `Ese correo no parece válido.`
- `Escribe la dirección donde quieres recibir el pedido.`
- `La dirección es demasiado corta: agrega calle y número.`
- `Las notas no pueden pasar de 500 caracteres.`
- Resumen: `Revisa {n} dato(s) antes de continuar`

_Errores del servidor:_

- 409 líneas: `Algo cambió mientras hacías el pedido.` / `No se creó ningún pedido. Quita lo que ya no está disponible y vuelve a confirmar.` / botón `Quitar y volver a confirmar`
- 409 precio: `El precio cambió mientras hacías el pedido.` / `No se creó ningún pedido. Este es el total actualizado.` / por línea `Antes {x} · Ahora {y}` / botón `Confirmar con el total nuevo`
- 429: `Ya enviaste varios pedidos en los últimos minutos.` / `Espera unos {n} minutos e intenta de nuevo. Si es un error, llama a la tienda.`
- 400 genérico: `Revisa los datos del pedido.`
- 400 carrito vacío: `Tu carrito está vacío.` / `Ver el catálogo`
- 404 tienda: `Esta tienda ya no está disponible.`
- 500: `No pudimos guardar tu pedido. No se te cobró nada y tu carrito sigue completo.` / `Reintentar`
- Red: `Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.` / `Reintentar`

**Página del pedido**

- `¡Pedido recibido!` · `Tu código` · `Guarda este código: es la forma de encontrar tu pedido.`
- Estados: `Pendiente de confirmación` · `Recibido por la tienda` · `Confirmado` · `Listo para recoger` / `Listo para enviar` · `Entregado` · `Cancelado`
- Explicaciones: `La tienda todavía no lo revisó.` · `La tienda ya lo tiene en su sistema.` · `La tienda confirmó tu pedido.` · `Puedes pasar a recogerlo.` / `Va en camino.` · `Gracias por tu compra.` · `La tienda canceló este pedido. Si no sabes por qué, contáctala.`
- `Actualiza la página para ver el estado más reciente.`
- Expectativa (DP4, el mismo texto literal): `La tienda va a revisar tu pedido y te va a contactar por teléfono para confirmarlo. Al enviarlo no se reserva ninguna unidad ni se cobra nada.`
- Secciones: `Entrega` (`Recoger en la tienda` / `Envío a {dirección}`) · `Contacto` · `Tu pedido` · `Subtotal` / `Envío` / `Total`
- WhatsApp (**atajo opcional**, DP1): enlace `Enviar el pedido por WhatsApp` + ayuda `Si quieres, avísale también por WhatsApp: se abre con el mensaje ya escrito.` — nunca «falta un paso», porque el pedido ya está hecho y la tienda lo va a recoger por su sistema (R1).
- Sin número: `Esta tienda todavía no tiene un número de WhatsApp publicado. Guarda tu código: la tienda ya recibió el pedido.`
- Pie: `Seguir comprando`
- 404: `No encontramos ese pedido.` / `Revisa el código: son 10 caracteres y a veces se confunde un 0 con una O.` / `Ver el catálogo`

**Mensaje de WhatsApp** — texto exacto antes de URL-encodear, `\n` reales:

```
Hola {store.name}, acabo de hacer un pedido en su tienda.

Código: {A7K3M-9PQR2}

{qty} x {nombre} — {lineTotal}
{qty} x {nombre} — {lineTotal}

Subtotal: {subtotal}
Envío: {deliveryFee}
Total: {total}

Entrega: {Recoger en la tienda | Envío a {dirección}}
A nombre de: {contactName} ({contactPhone})

Ver el pedido: {URL absoluta de /[slug]/pedido/[code]}
```

- La línea `Envío:` **solo** aparece si hubo envío.
- Con más de 10 líneas se emiten las 10 primeras y una línea
  `… y {n} productos más (están en el enlace).` — así el `wa.me` no se pasa de los
  ~2 000 caracteres que algunos clientes truncan.
- El número sale de `Store.whatsapp ?? Store.phone`, solo dígitos, sin `+`. Sin
  número no hay enlace (E18) y se muestra la tarjeta de arriba.
- El `<a>` va con `rel="noopener noreferrer"` y `target="_blank"`.

---

## Verificación

Lista ejecutable, un paso por línea, pensada para que `sdd-tester` la corra de
arriba abajo. `V1`–`V6` no necesitan navegador; `V7`–`V22` sí, y **no se
ejecutaron en este ciclo** porque la extensión de Chrome no está conectada.

**Sin navegador** (con `npm run dev` o el servidor que ya escucha en `:3000`)

- **V1** — `curl -s localhost:3000/tienda-demo/p/jugo-de-mango-1-l | grep -c 'disabled=""'` ≥ 1.
  **`disabled=""`, no `disabled`:** la clase `disabled:pointer-events-none` del
  `Button` contiene la palabra, así que un `grep 'disabled'` pasa siempre y no
  prueba nada. Es un falso positivo del criterio 2(a) de la spec, comprobado sobre
  el HTML real de hoy.
- **V2** — `curl -s localhost:3000/tienda-demo/carrito | grep -i 'Cargando tu carrito'` → sale;
  `| grep -i noscript` → sale.
- **V3** — `curl -s localhost:3000/tienda-demo/checkout | grep -i 'Nombre y apellidos'` → sale:
  los campos de contacto vienen en el HTML servido, no después de hidratar.
- **V4** — `curl -s localhost:3000/tienda-demo/pedido/<code> | grep -c 'wa.me'` → ≥ 1 en la
  tienda `WHATSAPP` y exactamente **0** en la `ONSITE` (criterio 11).
- **V5** — `curl -s localhost:3000/tienda-demo/pedido/<code> | grep -c '_next/static/chunks'`
  → el mismo número que `curl -s localhost:3000/tienda-demo`: la página del pedido
  no añadió ni un módulo de cliente (DP2).
- **V6** — `curl -s localhost:3000/tienda-demo | grep -o 'Carrito'` → sale, y en ese
  HTML **no** hay burbuja de conteo.

**Con navegador, en Chrome**

- **V7** — 360 px, `/tienda-demo/carrito` con 3 líneas: sin scroll horizontal, la
  barra fija no tapa la última línea, `−`/`+`/`Quitar` miden ≥ 44 px.
- **V8** — 360 px, `/tienda-demo/checkout` con el teclado abierto sobre el campo
  del teléfono: el botón `Confirmar` **no** flota encima del campo.
- **V9** — 768 px: el resumen del checkout sale desplegado; nombre y teléfono en fila.
- **V10** — 1280 px: carrito y checkout a dos columnas; el resumen `sticky`
  acompaña el scroll sin salirse de su tarjeta.
- **V11 [c2]** — **La lista no salta.** DevTools → _Performance insights_ o
  _Layout Shift Regions_ activo; recargar `/carrito` con 3 líneas: entre F1 y F2
  no debe registrarse desplazamiento de las filas. Solo cambian los importes.
- **V12 [c2]** — **Cotización lenta.** Throttling _Slow 4G_: se ven las líneas con
  el precio provisional en `text-fg-muted`, `Calculando…` en el subtotal, y a los
  3 s aparece el texto de conexión lenta. `Continuar` deshabilitado todo ese rato.
- **V13 [c2]** — **Cotización caída.** DevTools → _Network_ → _Offline_, recargar
  `/carrito`: banner de error, lista visible con precios provisionales, `Reintentar`
  presente, `Continuar` deshabilitado. Pulsar `Reintentar` con la red aún caída y
  comprobar que **entonces** aparece `Continuar de todos modos`.
- **V14 [c2]** — **Recotización.** Con red normal, pulsar `+` tres veces seguidas:
  el número sube al instante en los tres toques, se hace **una** petición (rebote),
  y los importes se atenúan sin que la fila cambie de alto.
- **V15 [c2]** — **Checkout sin cotización.** Offline en `/checkout`: los campos de
  contacto se pueden teclear, el bloque de entrega dice que está cargando, y
  `Confirmar` no se habilita bajo ninguna circunstancia.
- **V16** — **Branding:** las tres pantallas en `/tienda-dos` (verde, `radius:
round`): botones verdes, esquinas notablemente más redondas, y los importes
  **igual de legibles** que en `tienda-demo` porque no dependen de `brand`.
- **V17** — **Oscuro:** `prefers-color-scheme: dark` en las cuatro pantallas;
  mirar sobre todo los banners `warning` y `danger` y el texto apagado de una línea
  agotada.
- **V18** — **Teclado solo:** del catálogo a `Confirmar` sin ratón; con un envío
  inválido, el foco cae en el resumen de errores y el enlace `Teléfono` lleva al campo.
- **V19** — **Lector de pantalla** (VoiceOver): cambiar una cantidad y oír el
  anuncio; oír `Subtotal actualizado…` una sola vez al llegar la cotización; entrar
  en el error del teléfono y oír el mensaje; oír el código del pedido deletreado.
- **V20** — **`localStorage` bloqueado:** ventana privada con almacenamiento
  bloqueado: agregar, ver el aviso `warning`, llegar a confirmar sin un solo error
  en consola (E21).
- **V21** — **Sin JavaScript** (DevTools → _Disable JavaScript_): `/tienda-demo` y
  la ficha se leen enteras; `/carrito` muestra el `noscript` y no un «Cargando…»
  eterno; `/pedido/<code>` se ve **completa**, porque no tiene JS propio.
- **V22** — **Conexión lenta en la ficha** (_Slow 4G_): el precio y el botón están
  visibles antes de que llegue el JS; el botón responde en cuanto hidrata.

---

## Respuestas del humano

Las cuatro preguntas del ciclo 1, cerradas. Ya están aplicadas arriba; se
conservan con su número para no perder la trazabilidad.

- **DP1 → atajo opcional.** El pedido ya está hecho y la pantalla lo dice; el
  enlace `wa.me` se ofrece como algo que el comprador puede hacer si quiere. Es lo
  que dice R1 y es lo cierto. Aplicado en el microcopy de la página del pedido:
  `Si quieres, avísale también por WhatsApp…`, nunca «falta un paso».
- **DP2 → contacto completo.** Nombre, teléfono y dirección a la vista en
  `/[slug]/pedido/[code]`, con `noindex` y sin caché (E16, R18). El comprador
  necesita comprobar la dirección antes de que salga el repartidor. **Sin botón de
  «ver datos»:** esa página se queda en 100 % servidor, cero módulos de cliente, y
  eso es una propiedad que se conserva a propósito y se verifica en `V5`.
- **DP3 → el contador va en la cabecera de todas las páginas de tienda**,
  incluidas las `●`, asumiendo los ~1,6 KB de cliente. Anotado como coste
  consciente en § Coste de cliente y señalado para F-013.
- **DP4 → el texto se aprueba literal**, sin cambiar una palabra: `La tienda va a
revisar tu pedido y te va a contactar por teléfono para confirmarlo. Al enviarlo
no se reserva ninguna unidad ni se cobra nada.` Va en el checkout encima del
  botón y repetido en la página del pedido.

**Ninguna pregunta abierta de diseño.** Las dos del arquitecto (`AP1` sobre el
`was` por línea y `AP2` sobre el abuso rotando teléfonos) siguen siendo suyas y
**no cambian ninguna pantalla de aquí**: con `AP1 → a` el «Antes» viene del
servidor y con `AP1 → b` del último `quote` que la isla ya tiene en memoria; se ve
igual en los dos casos.

**Cuatro decisiones que tomé yo al aterrizar el `quote`, por si alguien las
discute:** (1) el carrito **pierde las miniaturas**, porque el payload de `quote`
no trae `imageUrl` y pedirlo significaría N peticiones de imagen más en una
conexión limitada; (2) mientras se cotiza se pinta el `display.unitPrice` guardado
en `localStorage` en tono apagado —el contrato del carrito lo autoriza
explícitamente para esto— pero **nunca** el total de línea, que es aritmética;
(3) en el carrito, tras un reintento fallido, se ofrece `Continuar de todos modos`,
porque el checkout recotiza y el servidor re-precia al crear (R6, R7), así que
nada incorrecto puede persistirse y bloquear la venta por una conexión mala es
peor; en el checkout **no** se ofrece, porque `expectedTotal` es obligatorio;
(4) en el checkout la entrega baja por debajo de las notas, para que lo que llega
tarde no empuje nunca el campo que alguien está tecleando.
