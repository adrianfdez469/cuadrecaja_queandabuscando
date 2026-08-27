---
feature: F-011
agente: sdd-designer
actualizado: 2026-08-26T18:12:00Z
estado: listo
---

> **Ciclo 3 — alcance nuevo: abrir y cerrar la tienda al público.** El humano
> contestó `DP6`, `DP7` y `DP8` (§ Respuestas del humano) y añadió seis
> decisiones que **revierten HD2 en su mitad de «deshabilitar»**:
>
> - **HD10** — el panel **habilita y deshabilita la tienda al público**, con
>   motivo visible para el comprador. Publicar por primera vez sigue siendo del
>   POS; lo que HD2 prohibía y ahora se hace es **cerrar y volver a abrir**.
> - **HD11** — cerrada se ve como **página, no como 404**: 200 con el nombre, la
>   marca y el mensaje; sin catálogo, sin carrito, y el checkout rechazando
>   pedidos. La página de un pedido ya hecho **sigue accesible**.
> - **HD12** — **retroactivo**: las tiendas que ya existen quedan cerradas.
> - **HD13** — **un solo estado compartido**, gana el último que escriba, panel o
>   POS.
> - **HD14** — el motivo sale de una **lista fija** más un **texto corto
>   opcional**, pintado como texto y **nunca** como HTML.
> - **HD15** — **sin endpoint nuevo**: el POS ya lo puede cerrar con
>   `publishToStore: false`, que está en el contrato.
>
> Lo que añade este ciclo: § Inventario **§ 8** (la página cerrada que ve el
> comprador) y **§ 9** (el interruptor del panel, el motivo, la
> previsualización y el estado en el listado), más los ajustes que eso obliga en
> § 1, § 2, § Componentes, § Tokens, § Accesibilidad, § Coste de cliente,
> § Textos y § Verificación (`V23`–`V32`). **La página cerrada es una pantalla
> que hoy no existe**: el catálogo se lee con `status: "PUBLISHED"` y hoy una
> tienda no publicada responde 404.

> **Ciclo 2.** Las cinco preguntas `DP1..DP5` del ciclo 1 están contestadas
> (§ Respuestas del humano) y dos respuestas movieron el suelo:
>
> - **HD6 — el editor de branding espera a `Storefront`** (ADR 0012): la marca va
>   a poseer slug, branding y contacto, así que vestir hoy una `Store` sería
>   diseñar sobre una columna que va a cambiar de dueño. **Congelado.**
> - **DP1 → no**: descripción y contacto de la tienda quedan en **modo lectura**.
>   La tanda 1b no se construye: ni las cuatro columnas de override, ni su
>   migración, ni su ADR.
> - **HD9 — se invierten las tandas.** Lo que se firma y se implementa ahora es
>   lo que era la tanda 2: **editor de producto, subida de imágenes y
>   promociones**. ADR 0012 no toca precios, stock ni pedidos, así que nada de
>   esto está bloqueado. Con ello se cae del alcance inmediato el **criterio 5**
>   (branding inválido) y entran los criterios **3** y **4**.
>
> Lo que este documento diseña al detalle es, por tanto, **producto, imágenes y
> promociones**, más cómo se ve el descuento en la vitrina. Lo del ciclo 1 que
> queda bloqueado **no se borró**: está íntegro en
> § Congelado — diseñado y esperando a `Storefront`, con lo que hay que releer
> cuando se desbloquee.

## Qué se miró antes de diseñar

Ciclo 1: `AGENTS.md`, `spec.md` completa (E1–E34, R1–R30, criterios, I1–I8),
`.agent/progress/F-011.md` (HD1–HD4), `.agent/specs/F-010/design.md`,
`src/components/ui/`, `src/app/admin/`, `src/theme/tokens.css`,
`src/features/theming/storeTheme.ts`, `scripts/check-bundle-budget.mjs`,
`scripts/check-theme-tokens.mjs`.

Ciclo 2, además: `docs/adr/0012-storefront-sobre-store.md` (el motivo del
congelamiento), `prisma/schema.prisma` (`StoreProduct`, `Promotion`, `Order`,
`OrderItem`), `src/lib/pricing.ts`, `src/lib/money.ts`, `src/lib/availability.ts`,
`src/features/catalog/server/queries.ts`, `src/features/orders/types.ts`,
`src/features/orders/server/quote.ts`, `src/features/orders/server/createOrder.ts`,
`src/features/orders/server/pull.ts`, `src/components/store/ProductCard.tsx`,
`src/app/[slug]/page.tsx`, `src/app/[slug]/p/[productSlug]/page.tsx`,
`src/features/cart/components/{CartLineRow,OrderSummary,CheckoutForm}.tsx`,
`src/features/orders/components/OrderLinesTable.tsx`, `next.config.ts` y
`src/constants/`.

`.agent/specs/F-011/architecture.md` seguía en plantilla mientras escribía esto
(su agente lo detalla en paralelo: emulador de Storage, `next.config.ts`,
endpoints y cálculo de promociones). Mis suposiciones sobre su terreno están en
§ Cómo encaja con `architecture.md`, cada una con qué pasa si decide otra cosa.
No escribí en su archivo.

### Lo que verifiqué de verdad, mirando

Levanté `npm run dev -- -p 3011` (puerto libre; ningún `next dev` en este
directorio — ficha `next-dev-uno-por-directorio`), acuñé sesión con
`QAB_BASE_URL=http://localhost:3011 node scripts/mint-sso-token.mjs`, abrí Chrome
y consulté la base del docker del 5433. Resultados reales:

- **VE1 — El panel de hoy.** `/admin` renderiza `Tus tiendas` y la tarjeta de
  «todavía no tiene funcionalidad». Su cabecera es `bg-surface` con borde: **el
  panel no está branded**, y así se queda.
- **VE2 — Modo oscuro.** El sistema estaba en oscuro y el panel se ve bien:
  `bg-bg`, tarjeta `bg-surface`, `text-fg`. Ni un color literal fuera de sitio.
- **VE3 — El presupuesto de JavaScript no mide el panel.**
  `find .next/server/app -name '*.html' | grep -c admin` → **0**;
  `.next/server/app/admin/` solo tiene `page.js` y su manifiesto.
  `check-bundle-budget.mjs` recorre únicamente `.html`, así que una isla de
  `/admin` **no puede** empujar los 193 KB de las páginas de tienda. Es el hecho
  que sostiene § Coste de cliente, comprobado y no supuesto.
- **VE4 — El branding vivo y su borde feo.** `/tienda-dos` sale verde con
  esquinas de 2 rem, y la cinta `Destacado` queda recortada por el
  `overflow-hidden` del `Card`. Sigue siendo cierto y ahora importa por otra
  razón: la cinta es de `featured`, que **sí** se edita en esta tanda.
- **VE5 — `accent` se ve en un solo sitio.** `grep -rn accent src` fuera de
  `storeTheme.ts` y `tokens.css` → `src/components/store/ProductCard.tsx:31`, la
  cinta `Destacado`. Marcar `featured` es lo único que hace visible el acento.
- **VE6 — Los valores de branding guardados hoy son `oklch(...)`.** Relevante
  solo para la parte congelada; queda anotado ahí.
- **VE7 — Una tienda no publicada no tiene página pública**
  (`queries.ts:43`, `status: "PUBLISHED"`). El listado y el hub esconden «Ver la
  tienda» en `DRAFT` y `SUSPENDED`.
- **VE8 — La expulsión por sesión vencida no se explica.**
  `src/app/admin/layout.tsx:10` va a `/?admin=sesion-requerida` y nadie lee ese
  parámetro (`grep -n searchParams -r src/app`). Sigue vivo y lo arregla
  `/sesion-cerrada`.
- **VE9 — El precio que ve el comprador ya no es el número del POS.**
  `Cerveza Cristal` tiene `syncedPrice = 1.20 USD`; la tasa vigente es
  `USD → 440` y `Business.baseCurrencyCode = CUP`. La ficha pública dice, literal,
  **`$528.00`**. Es la razón entera de cómo está diseñado el campo de
  `priceOverride`: quien lo teclee escribe **USD** y su cliente ve **CUP**.
- **VE10 — Un override no se ve como una rebaja.**
  `aceite-de-girasol-900-ml` tiene `syncedPrice 1250.00` y
  `priceOverride 1150.00`; la ficha muestra `$1,150.00` **y nada tachado**.
  Correcto, y lo fijo como regla: **el precio propio no se tacha; una promoción
  sí** (§ La vitrina con descuento).
- **VE11 — La trampa de R14 está en los datos de hoy.**
  `SELECT priceOverride, priceOverrideCurrency` → `1150.00, NULL`. Hay filas con
  override sin moneda, que hoy heredan la sincronizada por
  `src/lib/pricing.ts:35`. El editor necesita un estado para eso (§ 3, «override
  heredado»).
- **VE12 — `Promotion` no tiene nombre y el seed no tiene ninguna.**
  `prisma/schema.prisma:320-340`: `type`, `scope`, `value`, `conditions`,
  `startsAt`, `endsAt`, `active`. Ni `name` ni `label`. Y
  `SELECT count(*) FROM "Promotion"` → **0**. De ahí salió **DP6**, ya contestada
  («sí, se añade `Promotion.name`»), y la nota de fixture del § Verificación.
- **VE13 — El catálogo tapa los huecos de imagen con la imagen canónica.**
  `queries.ts:110-116`: si `imageUrls` está vacío se usa
  `canonicalProduct.imageUrl`. En el seed **todos** los productos tienen 0
  imágenes y ningún canónico tiene imagen, así que hoy todo sale con el recuadro
  `Sin imagen`. El cargador necesita distinguir esos tres casos, y los distingue.
- **VE14 — `orderBy: [{ featured: "desc" }, …]`** (`queries.ts:87`): marcar
  `featured` **mueve el producto al principio** del catálogo, además de ponerle la
  cinta. El texto de ayuda del editor lo dice.

**Ciclo 3, sobre la tienda cerrada.** Cuatro comprobaciones más, hechas contra el
servidor de desarrollo y la base del docker:

- **VE15 — El 404 de hoy es real, y es del `status`.** Inserté una tienda nueva en
  `DRAFT` (`tienda-prueba-cerrada`) y `curl` respondió **404**; `/no-existe`
  también responde 404 con `No encontramos`. Confirmado: **la página cerrada de
  HD11 es una pantalla que hoy no existe**, y lo que la impide es el
  `status: "PUBLISHED"` de `queries.ts:43`. (La tienda de prueba se borró; la base
  quedó con las dos del seed en `PUBLISHED`.)
- **VE16 — Y la trampa que se va a comer quien verifique esto.** Cambiar `status`
  **con SQL no cambia la página, en ninguno de los dos sentidos**: puse
  `tienda-demo` en `DRAFT` y siguió sirviendo su catálogo con 200 —incluso tras
  reiniciar el servidor y borrar `.next/cache`—, y publiqué la tienda de prueba y
  siguió respondiendo 404. Manda el `unstable_cache` con el tag `store:<slug>`
  (`src/lib/cache.ts:18`) hasta que alguien revalide. Dos consecuencias: **B10 no
  es opcional** (cerrar tiene que llamar a `revalidateStores([slug])` en el acto),
  y `V23` **se hace cerrando desde el panel**, nunca con un `UPDATE` a mano, o el
  verificador concluirá que HD11 no funciona.
- **VE17 — Cuánto pesa quitar el carrito de la cabecera.** En el build de
  producción que hay en `.next`: `index.html` (la landing, sin carrito) referencia
  **9** `<script src>` únicos y `tienda-demo.html` (con `CartBadge`) **10**. La
  página cerrada, sin carrito, se queda en el nivel de la landing: es la más
  liviana de la aplicación, como dice § Coste de cliente.
- **VE18 — El tamaño de la ventana, otra vez, no.** Volví a probar
  `resize_window` a 360×780 en una ventana nueva: responde «Successfully resized»
  y la captura sigue midiendo lo mismo (952×1255 esta vez). **Tres ciclos, cinco
  intentos, tres ventanas distintas.** No hay juicio a 360 ni a 768.

### Lo que NO pude verificar, otra vez

**No hay juicio a 360 ni a 768.** `resize_window` responde «Successfully resized»
y la captura sigue midiendo lo mismo (probé 360×780 y 400×800 en dos ventanas
distintas, en los dos ciclos). El navegador funciona para leer pantallas reales,
**no** para cambiar el tamaño de la ventana en este entorno. Todo lo que digo de
360 y 768 sale de las clases de Tailwind y del precedente de F-010. Los pasos
`V8`–`V22` quedan **sin ejecutar** y son el hueco que hay que meter como paso del
plan, no como nota al pie. Es la segunda vez que se dice.

Tampoco vi ninguna pantalla nueva: no existen. Y no hay ni un objeto en Storage
que mirar: el emulador de HD1 lo monta `sdd-architect` en este ciclo.

---

## Cómo encaja con `architecture.md`

Seis suposiciones. Ninguna cambia una pantalla; cambian nombres, verbos o de
dónde sale un número.

| #   | Suposición                                                                                                                                                                                                                                                               | Si él decide otra cosa                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Las escrituras del panel son route handlers bajo `/api/admin/` (R5): producto (`PATCH`), imágenes (`POST` multipart y `PATCH` del orden), promociones (`POST`/`PATCH`/`DELETE`)                                                                                          | Da igual el verbo y la forma de la URL: las islas mandan a la URL que reciben por prop                                                                                                                                                 |
| B2  | El 400 trae los problemas con su `path`, tipo `{"error":"INVALID_BODY","issues":[{"path":["priceOverride"],"message":"…"}]}`                                                                                                                                             | Sin `path`, los errores solo se pintan en el resumen de arriba y no debajo de cada campo. Se ve peor, no se rompe                                                                                                                      |
| B3  | El endpoint del producto **devuelve el precio efectivo ya resuelto y formateado por el servidor** (`{"effective":{"amount":"484.00","currency":"CUP"},"source":"override"}`)                                                                                             | Si no lo devuelve, el precio nuevo del comprador solo aparece al recargar. Lo pido explícito: es lo que hace que el campo de precio no sea a ciegas                                                                                    |
| B4  | La subida es **una petición por archivo**, en serie                                                                                                                                                                                                                      | Si fuera una petición con N archivos, se cae el estado «subimos 2 de 3» y un fallo se lleva la tanda entera. Es la única de las seis que sí cambia pantalla                                                                            |
| B5  | El precio con promoción se calcula dentro de la lectura cacheada del catálogo (R28) y llega a la vista como **dos importes ya resueltos** (el de lista y el vigente), nunca como una regla que la vista aplica                                                           | Si la vista tuviera que aplicar el descuento, sería una segunda implementación del precio y violaría R16                                                                                                                               |
| B7  | La lectura pública resuelve la tienda **en los dos estados** y expone: si está abierta, el **código** del motivo, el **texto opcional**, **quién** cerró (`PANEL` · `POS` · `PLATAFORMA`) y **cuándo**. Sin «quién», el punto 5 de HD15 no se puede escribir en pantalla | Si la lectura sigue filtrando `status: "PUBLISHED"`, § 8 no se puede construir: es la única suposición de este ciclo sin la que no hay pantalla                                                                                        |
| B8  | `POST /api/orders/quote` y `POST /api/orders` rechazan con un código propio y **devuelven la frase del motivo**, para que el banner del carrito y del checkout digan por qué                                                                                             | Si reutiliza el `404 STORE_NOT_FOUND` que ya existe, la pantalla es la de F-010 (`Esta tienda ya no está disponible.`) y se pierde el motivo. Funciona; dice menos                                                                     |
| B9  | `pullOrders` **sigue sin filtrar por el estado de la tienda** (`pull.ts:62` filtra solo por `id > since`), así que cerrar al público no interrumpe la entrega de los pedidos pendientes al POS                                                                           | Si le añade un filtro por estado, la tercera consecuencia del microcopy de cierre («los sigues recibiendo en Cuadre de Caja») se vuelve **mentira** y hay que reescribirla                                                             |
| B10 | Cerrar y abrir llaman a `revalidateStores([slug])` en el acto (R10)                                                                                                                                                                                                      | Sin eso, el QR de la pared sigue sirviendo el catálogo desde el CDN hasta una hora después de cerrar                                                                                                                                   |
| B6  | `QuoteLine` gana un campo para el precio de lista y `QuoteResponse` uno para el descuento de alcance `ORDER` (§ La vitrina con descuento)                                                                                                                                | Sin eso, el carrito no puede tachar nada y el checkout no puede cuadrar `total = subtotal − descuento + envío`. **No vale reusar `originalUnitPrice`**: hoy significa «antes de convertir la moneda» (`prisma/schema.prisma:431`, R5b) |

---

## Flujo de usuario

Una frase: **el admin entra desde Cuadre de Caja, elige una tienda, y desde ahí
arregla lo que el POS no sabe — la foto, el texto, el precio online, qué se ve y
qué está en oferta — y cada guardado se refleja en la vitrina en el acto.**

```
Cuadre de Caja ─「Ir a mi tienda online」─► /admin/sso ──► /admin
                                                            │  listado de tiendas
                                                            ▼
                                        /admin/tiendas/<store>          ← hub
                                          │ ┌──────────────────────────────────┐
                                          │ │ Tu tienda al público  [Abierta]  │
                                          │ │「Cerrar la tienda al público」→   │
                                          │ │   motivo (lista fija) + mensaje   │
                                          │ │   + vista de lo que ve el cliente │
                                          │ └──────────────────────────────────┘
                                          │  datos del POS en lectura
                                          │  「Productos」 「Promociones」
                                          │  (colores y contacto: en camino, HD6)
                    ┌─────────────────────┴─────────────────────┐
                    ▼                                           ▼
    /…/<store>/productos                          /…/<store>/promociones
      │ buscador `?q=`, filtros, paginación          │ listado con estado
      │ casillas ─「Crear promoción con los          │「Nueva promoción」
      │              3 productos elegidos」──────────┤ 「Editar」「Activar/Desactivar」「Borrar」
      ▼                                              ▼
    /…/productos/<product>                        /…/promociones/nueva | <promo>
      ├ Card 1 · Datos de Cuadre de Caja (lectura)   tipo · valor · alcance · ventana
      ├ Card 2 · Lo que ves en tu tienda  ──► PATCH  ──► POST/PATCH
      │    descripción · visible · destacado
      │    precio propio (o el del POS)
      └ Card 3 · Imágenes  ──► POST multipart (una por archivo)

    Cada guardado revalida la tienda (R10) ──► la vitrina cambia enseguida
```

**Y el otro flujo, el que empieza en una pared** (HD10–HD12). El comprador
escanea el QR y la tienda está cerrada:

```
QR ──► /[slug]                    200 · nombre + marca + motivo (+ mensaje)
        │                              sin catálogo · sin carrito · sin precios
        ├─ /[slug]/p/<producto>    la misma página cerrada (no se lee el producto)
        ├─ /[slug]/carrito         la misma, + «tu carrito sigue en este teléfono»
        ├─ /[slug]/checkout        la misma; y el endpoint rechaza el pedido
        └─ /[slug]/pedido/<code>   SIGUE ACCESIBLE, con un aviso arriba
                                        「Escribir por WhatsApp」 si hay número
```

**Vueltas atrás y qué se pierde.**

| Desde → hacia                                  | Qué se conserva                             | Qué se pierde                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Editor de producto → listado                   | Lo guardado                                 | Lo editado y no guardado, en la tarjeta 2. **Las imágenes ya subidas no se pierden**: se guardan al subirlas, no al «Guardar cambios» |
| Listado con casillas marcadas → otra página    | Nada                                        | La selección. Va en la query (`?productos=…`), así que el botón atrás **sí** la recupera                                              |
| Alta de promoción → listado de promociones     | Nada: no se escribió                        | Todo el formulario. El enlace de volver lo dice                                                                                       |
| Quitar una imagen                              | El archivo sigue en el almacenamiento (R22) | Su sitio en el producto. No hay deshacer: hay que volver a subirla                                                                    |
| Borrar una promoción                           | Los pedidos ya creados no cambian (E34)     | La promoción. Confirmación en línea antes                                                                                             |
| Sesión vencida a mitad de cualquier formulario | **Lo tecleado sigue en pantalla** (isla)    | Nada, si vuelve a entrar en otra pestaña y reintenta                                                                                  |

**Puntos de no retorno:** subir una imagen (queda en el bucket para siempre, R22),
borrar una promoción, y **publicar un precio equivocado** — que es reversible en
la base pero no en lo que ya vio un comprador. Por eso el precio es el único campo
con doble confirmación visual: un radio para elegir «precio propio» y el importe
efectivo escrito con letras después de guardar.

---

## Inventario de pantallas y estados

### 1 · `/admin` — listado de tiendas (E1)

`<h1>Tus tiendas</h1>` y una **lista** de tarjetas, una por tienda, en una sola
columna hasta 1280: un admin de este producto tiene entre 1 y 5 locales y una
cuadrícula de tres columnas para dos tarjetas hace que parezca que falta algo.

Cada `Card`: `<h2>` con el nombre (enlace al hub), **un solo** `Badge` que
contesta «¿me pueden comprar?» (`Abierta` · `Cerrada` · `Suspendida` ·
`Borrador`) con su segunda línea cuando hace falta —la tabla completa está en
§ 9 § El estado en el listado y en el hub—, la línea `{ciudad} · {dirección}`
truncada, y un pie con **tres** enlaces de destino distinto:
`Productos` · `Promociones` · `Ver la tienda ↗`. La tira de muestras de paleta
del ciclo 1 se cae con HD6: no hay nada que enseñar todavía.

| Estado                                                         | Qué se ve                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal**                                                     | Solo las tiendas de `session.storeIds`; ni otra del mismo `Business` (E1)                                                                                                                                                                                |
| **Una sola tienda**                                            | La misma pantalla con una tarjeta. **Sin redirección** (DP5 → a): el criterio 1 se verifica curleando este listado                                                                                                                                       |
| **Ninguna** (`storeIds: []`)                                   | `Alert tone="muted"`: `Todavía no tienes ninguna tienda asignada.` + `Publica un local desde Cuadre de Caja y va a aparecer aquí.` Ni rojo ni `role="alert"`                                                                                             |
| **Alguna tienda del token ya no existe**                       | Se omite, y debajo en `text-fg-muted text-sm`: `Una de las tiendas de tu acceso ya no está disponible.`                                                                                                                                                  |
| **Tienda no publicada**                                        | Igual, con `Badge` `Borrador`, **sin** «Ver la tienda» (VE7) y con: `Todavía no es visible para tus clientes. Se publica desde Cuadre de Caja.` Los enlaces a productos y promociones **siguen activos**: vestir el catálogo antes de abrir es lo normal |
| **Tienda cerrada al público** (HD10)                           | `Badge` `Cerrada` + la segunda línea que dice **quién** la cerró (§ 9). «Ver la tienda ↗» **se mantiene**: lleva a la página cerrada, que es justo lo que se quiere comprobar. Sin acción de abrir aquí: se abre desde el hub, después de mirar          |
| **Primer día de HD12** (todas cerradas, ninguna abierta nunca) | Encima de la lista, una sola vez, `Alert tone="warning"`: `Tus tiendas están cerradas al público.` + `Revisa que el catálogo, las fotos y los precios estén como quieres, y ábrelas cuando estés listo.`                                                 |
| **Cargando**                                                   | `loading.tsx`: el `<h1>` real + `<p role="status">Cargando tus tiendas…</p>`. Cero JS                                                                                                                                                                    |
| **Error de base de datos**                                     | El `src/app/error.tsx` que ya existe                                                                                                                                                                                                                     |
| **Sin sesión**                                                 | No se renderiza: el layout redirige a `/sesion-cerrada` (§ 10)                                                                                                                                                                                           |

### 2 · `/admin/tiendas/<store>` — hub de la tienda (E2, E3)

Cabecera: `← Tus tiendas`, `<h1>` con el nombre, y debajo la URL pública
enlazada si está publicada. Luego **cuatro** bloques:

0. **Card «Tu tienda al público»** — el interruptor de HD10, **el primero de la
   pantalla** porque es la acción con más consecuencias del panel. Diseñado al
   detalle en § 9.
1. **Card «Datos de Cuadre de Caja»** — el `<dl>` de lectura con `Nombre`,
   `Dirección`, `Ciudad`, `Provincia`, `Estado`, más la nota de que eso se edita en
   Cuadre de Caja. **Ojo con el cambio de este ciclo:** la nota ya no puede decir
   que abrir y cerrar se hace allí (HD10 lo trae al panel); lo que sigue siendo
   del POS es **publicar por primera vez**. La fila `Estado` muestra la
   publicación (`Publicada` · `Borrador` · `Suspendida`); si está abierta o
   cerrada al público lo dice el bloque 0, que es donde se cambia. Es
   literalmente lo que pide E2 y está diseñada al detalle en § Congelado § 2a:
   **esa tarjeta no está congelada, se construye ahora**; lo congelado es lo que
   iba debajo.
2. **Dos tarjetas de destino**, grandes y pulsables enteras (son un `<Link>` con
   un `<h2>` dentro, no una tarjeta con enlaces sueltos): `Productos` con el
   contador `48 productos · 3 ocultos · 12 sin imagen`, y `Promociones` con
   `2 vigentes · 1 programada` o `Ninguna todavía`.
3. **Card «Colores y contacto»**, `Alert tone="muted"` dentro:
   `En camino.` / `Los colores de tu tienda y el texto de contacto se van a editar aquí. Todavía no: primero llega el cambio que le da a tu marca una sola dirección para todas tus sucursales.` Sin botones, sin campos. Que el hueco esté nombrado es lo que evita que el admin lo busque en otra parte.

| Estado                         | Qué se ve                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Tienda ajena o inexistente** | **404** de Next, sin el nombre de la tienda en el cuerpo (E3, R7, criterio 6)                                                    |
| **Tienda sin productos**       | La tarjeta de productos dice `Todavía no hay productos. Los crea Cuadre de Caja al sincronizar.` y **no** enlaza a ninguna parte |
| **Borrador / Suspendida**      | La nota del estado, igual que en el listado                                                                                      |
| **Cargando**                   | `loading.tsx` con el `<h1>` y `Cargando la tienda…`                                                                              |

### 3 · `/admin/tiendas/<store>/productos` — listado de productos (E14)

Server component, **cero JavaScript propio**. Es la pantalla que más va a usar el
admin y la que más productos puede tener, así que todo el estado vive en la URL.

**Cabecera.** `<h1>Productos</h1>`, y debajo la línea de conteos, cada uno un
enlace que filtra: `48 productos · 3 ocultos · 5 con precio propio ·
12 sin imagen · 2 borrados`. Debajo, un `<form method="get">` con un solo campo
`Buscar por nombre` y su botón `Buscar` (GET nativo: cero JS, y la búsqueda queda
en la URL para compartir o volver).

**Filas.** Una `<li>` por `StoreProduct`, no una tabla: a 360 px una tabla de
seis columnas es scroll horizontal garantizado.

- Miniatura de 48 px (`next/image`) o un recuadro `bg-surface-muted` con `Sin
imagen`.
- Nombre local, enlace al editor. Debajo, en `text-fg-muted text-sm`, la
  categoría.
- Precio: el **efectivo**, formateado por `lib/pricing` + `lib/money` en el
  servidor (R16), y si la moneda del producto no es la del negocio, su original
  entre paréntesis: `$528.00 · 1.20 USD`.
- `Badge`s, solo cuando dicen algo: `Oculto` (`muted`), `Destacado` (`warning`),
  `Precio propio` (`muted`), `Con promoción` (`positive`), `Agotado` /
  `Pocas unidades` (los tonos que ya da `AVAILABILITY_TONE`).
- Casilla de selección a la izquierda, dentro del `<form>` de la barra de abajo.

**Barra de selección** (aparece solo con algo marcado, al final de la lista, en
flujo): `3 productos elegidos` + `Crear promoción con estos productos` (submit
`GET` a `/promociones/nueva?productos=…`) + `Quitar la selección`. Es lo único que
hace la casilla: **no hay edición masiva** (E15 es de a uno) y así se dice.

**Orden.** El mismo que la vitrina: destacados primero, luego por nombre
(`queries.ts:87`), para que el admin vea su portada en el mismo orden que su
cliente. Los borrados suaves van **al final**, siempre, aunque haya paginación.

| Estado                            | Qué se ve                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Normal**                        | La lista paginada (`?pagina=`), con `Anterior` / `Siguiente` como enlaces y el rango escrito: `21–40 de 48`                                                                                                                                |
| **Tienda sin ningún producto**    | `Alert tone="muted"`: `Todavía no hay productos en esta tienda.` + `Los productos los crea Cuadre de Caja al sincronizar. Cuando aparezcan aquí vas a poder ponerles foto, descripción y precio online.`                                   |
| **Búsqueda sin resultados**       | `No encontramos ningún producto con «arrz».` + `Ver todos los productos` (enlace que limpia `?q=`). El término se muestra tal como se escribió                                                                                             |
| **Filtro sin resultados**         | `Ningún producto está oculto.` / `Ningún producto tiene precio propio.` / `Todos tus productos tienen imagen.` — en positivo cuando la lista vacía es una buena noticia                                                                    |
| **Producto borrado en el POS**    | Fila en `text-fg-muted`, `Badge tone="danger"` `Borrado en Cuadre de Caja`, **sin enlace al editor** y sin casilla. Debajo: `Si vuelve a aparecer en Cuadre de Caja, vuelve aquí con todo lo que le pusiste.` (el sync lo puede resucitar) |
| **Producto sin precio resoluble** | En vez del importe, `Sin precio` (`text-fg-muted`) y un `Badge tone="warning"` `No se puede pedir`. Pasa cuando falta la tasa de su moneda: es la misma condición que hace `NO_PRICE` en el carrito                                        |
| **Cargando**                      | `loading.tsx` con el `<h1>`, la línea de conteos en gris y `Cargando tus productos…`                                                                                                                                                       |
| **Muchos productos**              | La paginación es del servidor. **No hay filtrado en el cliente**: en una tienda de 5 000 productos, mandar la lista entera al navegador es lo contrario de lo que este proyecto hace                                                       |

### 4 · `/admin/tiendas/<store>/productos/<product>` — editor de producto (E15, E16, E19)

Cabecera: `← Productos`, `<h1>` con el nombre local, y `Ver en la tienda ↗` si el
producto es visible y la tienda está publicada. Tres tarjetas.

#### 4a · Card «Datos de Cuadre de Caja» — lectura

`<dl>` con: `Nombre`, `Precio` (`1.20 USD`), `Disponibilidad` (`Badge` con
`AVAILABILITY_LABEL`), `Categoría`, `Última sincronización` (fecha y hora de
`syncedAt`). Y la misma nota que el hub:

> `Esto se edita en Cuadre de Caja.` `Aquí lo ves para saber contra qué estás trabajando: si el precio o el stock están mal, corrígelos allí y se actualizan solos.`

Texto, no campos deshabilitados: un `<input disabled>` gris parece un formulario
roto o un permiso que se te olvidó pedir.

| Estado                         | Qué se ve                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Producto borrado (`deletedAt`) | `Alert tone="danger"` arriba de todo: `Cuadre de Caja borró este producto.` + `No se puede editar. Si vuelve a aparecer, lo que le pusiste sigue aquí.` Las tarjetas 4b y 4c se renderizan **dentro de un `<fieldset disabled>`**, visibles y no operables: se ve que el trabajo no se perdió |
| `Agotado`                      | El `Badge` `muted` y una línea: `Tu cliente lo ve, pero no lo puede pedir mientras esté agotado.` (`isOrderable`)                                                                                                                                                                             |
| Sin categoría                  | `—`                                                                                                                                                                                                                                                                                           |

#### 4b · Card «Lo que ves en tu tienda» — la isla del producto

Arriba de la tarjeta, **una sola línea que contesta la pregunta que trae el
admin**, calculada en el servidor:

> `Ahora tu cliente ve: $528.00` — y, cuando el importe no sale del precio
> sincronizado tal cual, el motivo entre paréntesis: `(precio propio)` ·
> `(promoción del 20 %)` · `(1.20 USD al cambio de hoy)`. Si el producto está
> oculto: `Ahora tu cliente no lo ve: está oculto.`

Luego cuatro bloques, en este orden:

**(i) Visibilidad.** `<fieldset>` con `<legend>¿Se ve en tu tienda?</legend>` y
dos `RadioCard`:

- `Se ve` — `Aparece en el catálogo y se puede pedir.`
- `Está oculto` — `No aparece, no se puede abrir su página y no se puede pedir.`

Dos radios y no una casilla, porque las consecuencias son grandes y así cada
opción puede llevar su frase. Cuando se elige `Está oculto` aparece debajo, en
`warning`: `Si alguien tiene el enlace guardado, va a ver una página de «no
encontrado».` (E18, y es verdad: `/[slug]/p/<slug>` responde 404).

**(ii) Destacado.** Una casilla `Destacar este producto`, con ayuda:
`Sale primero en tu catálogo y con la etiqueta «Destacado».` (VE5, VE14 — las dos
cosas que hace, dichas donde se decide).

**(iii) Descripción.** `<textarea rows=4 maxLength=1000>`, etiqueta
`Descripción`, ayuda: `Si lo dejas vacío se muestra la descripción del catálogo
general.` Y cuando existe la canónica, debajo:
`Del catálogo general: «Precio en divisa.»` — el mismo patrón de «lo que se ve si
no escribes nada» que se diseñó para el contacto, que es real
(`queries.ts:110`).

**(iv) Precio.** El bloque delicado. `<fieldset>` con
`<legend>Precio en tu tienda</legend>`:

- Primera línea, lectura: `Cuadre de Caja manda 1.20 USD.`
- Dos `RadioCard`:
  - `Usar el precio de Cuadre de Caja` — `Se actualiza solo cada vez que lo cambies en el POS.` (marcada cuando no hay override)
  - `Poner un precio propio` — `Cuadre de Caja deja de mandar en el precio online de este producto.`
- Al elegir `Poner un precio propio` aparece **debajo** el campo: etiqueta
  `Precio propio`, `<input inputMode="decimal">` y, **pegada al campo y como
  texto, no como selector**, la moneda: `USD`. Ayuda:
  `Se guarda en USD, la moneda que Cuadre de Caja manda hoy para este producto. Tu cliente lo ve convertido a CUP al cambio del día.`
- El importe convertido **no se calcula en el navegador**: convertir exige la
  tasa y sería una segunda implementación del precio (R16). Lo dice el servidor:
  al cargar, en la línea de arriba; al guardar, en el banner (B3).
- Elegir `Usar el precio de Cuadre de Caja` y guardar es **la** forma de quitar el
  override: se manda `null` en las dos columnas (R14). No hace falta vaciar un
  campo ni adivinar que vacío significa algo.

| Estado del precio                              | Qué se ve                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin override**                               | Primer radio marcado, sin campo. La línea de arriba dice `Ahora tu cliente ve: $528.00 (1.20 USD al cambio de hoy)`                                                                                                                                   |
| **Con override**                               | Segundo radio marcado, el campo con el importe, la moneda al lado. Línea de arriba: `Ahora tu cliente ve: $484.00 (precio propio)`                                                                                                                    |
| **Override heredado, sin moneda** (VE11)       | Igual, más un `Alert tone="warning"` dentro del bloque: `Este precio propio se guardó sin moneda y hoy se entiende en CUP. Al guardar queda fijado en CUP.` Es exactamente la fila `aceite-de-girasol-900-ml` del seed                                |
| **Cero** (E17, R15)                            | Se acepta y se avisa al lado, en `warning`: `0 es un precio real: tu cliente va a ver «$0.00» y va a poder pedirlo. Si querías volver al precio del POS, elige la primera opción.`                                                                    |
| **Negativo o con tres decimales**              | 400 del servidor, error bajo el campo: `Escribe un importe de 0 o más, con hasta dos decimales.`                                                                                                                                                      |
| **La moneda del POS cambió desde el override** | La línea de lectura lo canta: `Cuadre de Caja manda ahora 1.20 USD, y tu precio propio está en CUP.` + `Alert tone="warning"`: `Revisa tu precio propio: el POS cambió la moneda de este producto.` Es el escenario que R14 existe para hacer visible |
| **Hay una promoción vigente encima**           | Bajo el bloque: `Hay una promoción activa sobre este producto: tu cliente ve $422.40.` + enlace `Ver promociones`. El descuento se calcula **sobre este precio** (E30), y así queda dicho donde se teclea                                             |
| **Sin tasa de cambio para su moneda**          | `Alert tone="danger"`: `No podemos convertir USD a CUP: falta la tasa del día. Tu cliente no puede pedir este producto hasta que Cuadre de Caja mande la tasa.` El campo sigue editable                                                               |

**Acción de la tarjeta:** `Guardar cambios` (un solo botón para los cuatro campos:
descripción, visible, destacado y precio — que es lo que el criterio 3 fija por el
endpoint del panel).

| Estado de la tarjeta                                | Qué se ve                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Antes de hidratar**                               | Todo visible y legible; los radios y los campos son HTML y se pueden tocar. Lo que no funciona es guardar                                                                                   |
| **Sin JavaScript**                                  | `<noscript>` en la tarjeta, `Alert tone="warning"`: `Para editar este producto necesitas activar JavaScript. Lo que está publicado se ve más arriba.` (DP2 → sí)                            |
| **Editando**                                        | Junto al botón, `text-fg-muted text-sm`: `Sin guardar.` El botón nunca se deshabilita por «no hay cambios»                                                                                  |
| **Guardando**                                       | Botón `disabled`, `Guardando…`, `aria-busy="true"`, `<fieldset>` deshabilitado                                                                                                              |
| **Guardado (200)**                                  | `Alert tone="positive"` sobre el formulario, **con el número dentro** (B3): `Guardado. Tu cliente ve $484.00.` + `Ver en la tienda ↗`. Se queda hasta el siguiente guardado; no es un toast |
| **Guardado, oculto**                                | `Guardado. Tu cliente no lo ve: está oculto.`                                                                                                                                               |
| **Guardado, tienda en borrador**                    | `Guardado. Se va a ver en cuanto publiques la tienda desde Cuadre de Caja.`                                                                                                                 |
| **400**                                             | Resumen rojo arriba con foco + error por campo (§ Errores y validación). **Nada se guardó**, y lo tecleado sigue en pantalla                                                                |
| **401 / 403 / 404 / 500 / red**                     | Los mismos banners y textos de todo el panel (§ Textos). El 403 solo puede pasar si el acceso cambió a mitad de sesión (E19: la comprobación es sobre el `storeId` **del producto**)        |
| **El sync cambió el precio mientras editaba (E16)** | No se detecta y no se avisa: son columnas distintas y no hay conflicto. Al recargar, la tarjeta 4a trae el precio nuevo. Si había override, el comprador no vio ningún cambio               |

#### 4c · Card «Imágenes» — el cargador (E20–E26)

Isla propia, separada del formulario del producto por una razón de comportamiento:
**una imagen se guarda al subirla, no al pulsar «Guardar cambios»**. Mezclarlas
haría que salir de la pantalla perdiera unas cosas y no otras.

**Anatomía en reposo.** Una cuadrícula de miniaturas cuadradas (`aspect-square`,
`next/image`), en el orden de `imageUrls`. La primera lleva un `Badge`
`Principal`. Cada una, debajo: `Hacer principal` (todas menos la primera) y
`Quitar`. Al final de la cuadrícula, el botón de añadir:

```
<label class="… (aspecto de Button secondary) …">
  Agregar imágenes
  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple class="sr-only">
</label>
```

Ayuda permanente, debajo: `JPG, PNG, WebP o AVIF. Hasta 5 MB cada una y 8 en
total.` Y la frase que hace honesto a R22:
`Quitar una imagen la saca de tu tienda; el archivo se queda guardado en el almacenamiento.`

**El orden y la principal.** El orden es el del arreglo; la principal es la
primera, y es la que sale en la tarjeta del catálogo, en la ficha y en el
`openGraph`. La única operación de orden es `Hacer principal`, que mueve esa
imagen al frente y **no** reordena el resto (mover a mano cada posición está fuera
de alcance en la spec, y arrastrar en un teléfono es un problema de accesibilidad
por sí solo). Al quitar la primera, la segunda pasa a principal sola (E26) y se
anuncia: `Ahora la principal es «foto-2.jpg».`

| Estado                                                | Qué se ve                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reposo con imágenes propias**                       | La cuadrícula, la primera con `Principal`, el botón de agregar y las dos líneas de ayuda                                                                                                                                                                                                                    |
| **Sin imágenes propias, pero hay canónica** (VE13)    | Una sola miniatura, con `Badge tone="muted"` `Del catálogo general`, **sin** `Quitar` ni `Hacer principal`, y la línea: `Todavía no subiste fotos. Se muestra la imagen del catálogo general; en cuanto subas una tuya, manda la tuya.`                                                                     |
| **Sin nada** (el caso del seed de hoy)                | Un recuadro `bg-surface-muted` con `Sin imagen` y: `Tu producto se ve con un recuadro gris. Una foto propia es lo que más cambia si tus clientes compran o no.`                                                                                                                                             |
| **Eligiendo archivos**                                | Nada intermedio: el selector nativo del sistema, que en un teléfono ofrece cámara y galería. Al cerrarlo empieza la subida sola — no hay un segundo botón `Subir`, que solo serviría para que alguien lo olvide                                                                                             |
| **Subiendo** (B4: una petición por archivo, en serie) | El botón queda `disabled`; encima de la cuadrícula, `role="status"`: `Subiendo 2 de 3…` y una lista con el nombre de cada archivo y su estado (`Subiendo…` · `Lista` · el error). Cada imagen que termina **aparece ya en la cuadrícula**: no se espera a la tanda completa                                 |
| **Subida correcta (201, E20)**                        | La miniatura entra al final de la cuadrícula; `Alert tone="positive"`: `Subimos 3 imágenes.` (o `1 imagen`)                                                                                                                                                                                                 |
| **Éxito parcial**                                     | `Alert tone="warning"`: `Subimos 2 de 3 imágenes.` + la lista de la que falló con su motivo y un `Reintentar` **solo para ese archivo** (el `<input type="file">` no puede reusar la selección anterior, así que `Reintentar` vuelve a abrir el selector; el texto lo dice: `Elegir de nuevo «foto-3.jpg»`) |
| **Tipo no admitido (400, E22)**                       | Fila en `danger`: `logo.pdf — Ese archivo no es una imagen. Solo JPG, PNG, WebP o AVIF.`                                                                                                                                                                                                                    |
| **Extensión mentirosa (400, E22)**                    | `notas.jpg — El archivo dice ser una imagen pero no lo es.` El mime se decide por el contenido (R20); el texto no acusa al admin de mentir, describe                                                                                                                                                        |
| **Demasiado grande (400, E22)**                       | `foto.jpg — Pesa 6,2 MB y el máximo es 5 MB. Manda una foto más pequeña.`                                                                                                                                                                                                                                   |
| **Tope alcanzado (409, E23)**                         | Dos capas: con 8 imágenes el botón sale `disabled` con `aria-describedby` a `Ya tienes 8 imágenes, que es el máximo. Quita alguna para agregar otra.`; y si igual llega un 409 (dos pestañas), el mismo texto como `Alert tone="warning"` y **nada se subió**                                               |
| **Storage caído (503, E25)**                          | `Alert tone="danger"`: `No pudimos guardar la imagen: el almacenamiento no está disponible.` + `No se subió nada y tu producto no cambió. Vuelve a intentar en unos minutos; si sigue igual, avísale a soporte.` + `Reintentar`. **Nunca** queda una URL apuntando a un objeto que no existe                |
| **Sin credencial de servicio** (I8)                   | Es el mismo 503 y el mismo texto: para el admin es la misma situación. El motivo técnico va al log del servidor, no a su pantalla                                                                                                                                                                           |
| **Red caída a mitad de la tanda**                     | Las que ya subieron se quedan; el resto: `Se cortó la conexión. Subimos 1 de 3 imágenes.` + `Reintentar`                                                                                                                                                                                                    |
| **Quitar, paso 1**                                    | Confirmación **en línea**, donde estaba el botón: `¿Quitar esta imagen?` con `Sí, quitar` / `No`. El foco pasa a `Sí, quitar`; `Escape` cancela                                                                                                                                                             |
| **Quitar, paso 2 (200, R22)**                         | La miniatura desaparece; `Alert tone="positive"`: `Quitamos la imagen de tu producto.` Nada dice «borrada»: no se borró del almacenamiento, y prometerlo sería mentir                                                                                                                                       |
| **Quitar la única imagen**                            | La cuadrícula pasa al estado «sin nada» (o al de la canónica, si existe), sin recargar                                                                                                                                                                                                                      |
| **`imageUrls` con una URL que no es del bucket**      | La miniatura no carga (`next/image` responde 400 por `remotePatterns`) y se ve el recuadro `Sin imagen` con `Badge tone="warning"` `No se puede mostrar` y `Quitar` disponible. **La pantalla no se rompe** (spec, casos límite)                                                                            |
| **Antes de hidratar / sin JavaScript**                | Las miniaturas y la ayuda se ven; el `<input type="file">` existe pero no sube nada. `<noscript>`: `Para subir imágenes necesitas activar JavaScript.`                                                                                                                                                      |

### 5 · `/admin/tiendas/<store>/promociones` — listado (P1, E29)

Server component, cero JavaScript salvo la confirmación de borrado (que es una
isla mínima; ver § Coste de cliente).

`<h1>Promociones</h1>` + `Nueva promoción` (primario). Debajo, **la regla que
manda, escrita una vez y en sitio visible** (R26, E31):

> `Si dos promociones caen sobre el mismo producto, se aplica solo la que deje el precio más bajo. Nunca se suman.`

Una `<li>` por promoción, con:

- **El nombre que escribió el admin** (DP6 → sí: `Promotion.name`, columna
  opcional), y debajo, en `text-fg-muted text-sm`, el **rótulo derivado** de sus
  propios datos. Cuando no hay nombre —las creadas por API, o si el admin lo deja
  vacío— el rótulo derivado **sube** al primer renglón: no queda ninguna fila
  anónima. Rótulos derivados: `20 % en 3 productos` ·
  `15 % en Bebidas` · `−100.00 CUP en todo el pedido` ·
  `−100.00 CUP en pedidos de más de $2,000.00`.
- `Badge` de estado, calculado en el servidor con R25: `Vigente` (`positive`) ·
  `Programada` (`warning`) · `Vencida` (`muted`) · `Inactiva` (`muted`).
- Ventana en texto: `Desde el 26 ago 2026, 9:00 · Sin fecha de fin` /
  `Del 26 ago al 3 sep 2026`.
- Acciones: `Editar` · `Desactivar` / `Activar` · `Borrar`.

| Estado                                 | Qué se ve                                                                                                                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ninguna promoción** (el seed de hoy) | `Alert tone="muted"`: `Todavía no tienes promociones.` + `Una promoción baja el precio de unos productos, de una categoría o de todo el pedido, durante el tiempo que tú digas.` + `Nueva promoción`                                                |
| **Vigente**                            | Fila normal, `Badge` verde                                                                                                                                                                                                                          |
| **Programada**                         | `Badge` `Programada` + `Empieza el 1 sep 2026, 8:00.` Y la nota de R28: `Cuando llegue la hora puede tardar hasta una hora en verse en tu tienda.`                                                                                                  |
| **Vencida**                            | Fila en `text-fg-muted`, `Badge` `Vencida`. **No se borra sola**: sirve de plantilla y de historia. `Editar` sigue disponible                                                                                                                       |
| **Inactiva**                           | `Badge` `Inactiva` + `No se está aplicando.` (E29)                                                                                                                                                                                                  |
| **Sin productos que le apliquen**      | `Badge tone="warning"` `No aplica a nada` + `Los productos que elegiste ya no están o están ocultos.` (el caso de la spec: producto borrado suave después)                                                                                          |
| **Se solapa con otra**                 | Debajo del rótulo, `text-fg-muted text-sm`: `Comparte productos con «15 % en Bebidas»: en esos, gana el precio más bajo.` Si el arquitecto ve caro calcular el solape, se degrada a la frase general de la cabecera y no se pierde nada verificable |
| **Activar / Desactivar**               | Es un `PATCH` inmediato, sin confirmación (es reversible de un toque). Al volver: `Alert tone="positive"`: `Promoción activada. Tu tienda ya la aplica.` / `Promoción desactivada. Tu tienda vuelve a los precios de siempre.`                      |
| **Borrar, paso 1**                     | Confirmación en línea: `¿Borrar esta promoción?` + `Los pedidos que ya se hicieron no cambian.` con `Sí, borrar` / `No`. Esa segunda frase es E34 dicha donde importa                                                                               |
| **Borrar, paso 2 (200)**               | La fila desaparece; `Alert tone="positive"`: `Promoción borrada.`                                                                                                                                                                                   |
| **403 al activar o borrar** (E33)      | `Alert tone="danger"`: `Ya no tienes permiso sobre esta promoción.`                                                                                                                                                                                 |
| **Cargando**                           | `loading.tsx` con `<h1>` y `Cargando tus promociones…`                                                                                                                                                                                              |

### 6 · `/…/promociones/nueva` y `/…/promociones/<promo>` — alta y edición (P1–P3)

Una isla, un `<form>`, cinco bloques. La edición es la misma pantalla con los
valores puestos y el botón cambiado.

**(0) Cómo la llamas.** `Field` con `TextInput maxLength=60`: `Nombre para ti`,
ayuda `Solo lo ves tú; tus clientes no.` Opcional (DP6 → sí, columna nullable):
vacío, el listado usa el rótulo derivado. Va primero porque es lo que el admin va
a buscar cuando tenga cinco promociones parecidas.

**(i) Qué descuenta.** `<fieldset><legend>Tipo de descuento</legend>` con dos
`RadioCard`: `Porcentaje` (`Baja un % del precio.`) y
`Monto fijo` (`Baja una cantidad fija.`).

**(ii) Cuánto.** Un campo `inputMode="decimal"` con el sufijo **en texto** a su
derecha: `%` o la moneda base del negocio, `CUP`. Ayuda según el tipo:

- Porcentaje: `Entre 0 y 100. Ej.: 20 para un 20 % de descuento.`
- Monto fijo: `El monto se entiende en CUP, la moneda base de tu negocio, y se convierte al cambio del día para los productos en otra moneda.` (R27, I4 dicho en español)

**(iii) Sobre qué.** `<fieldset><legend>¿A qué se le aplica?</legend>` con tres
`RadioCard`: `Productos elegidos` · `Una categoría` · `Todo el pedido`.

- **`Productos elegidos`** — la lista llega en la URL desde el listado de
  productos (`?productos=id,id,id`) y se muestra como una lista con el nombre de
  cada uno y `Quitar`, más el enlace `Elegir otros productos` que vuelve al
  listado con las casillas marcadas. **Por qué así y no un buscador dentro del
  formulario:** el buscador y la paginación del listado ya existen y son de
  servidor; meter un selector de 5 000 productos en el formulario significa o
  mandarlos todos al navegador (cientos de KB en un teléfono con datos contados)
  o inventar un endpoint de búsqueda solo para esto. Límite escrito:
  `Puedes elegir hasta 20 productos por promoción.` (a `src/constants/`).
- **`Una categoría`** — un `<select>` con las categorías locales de la tienda (4
  en el seed, decenas como mucho). Ayuda: `Se aplica a todos los productos de esa categoría, también a los que lleguen después.`
- **`Todo el pedido`** — un campo opcional `Mínimo de compra` con la moneda base
  al lado. Ayuda: `Si lo dejas vacío, se aplica a cualquier pedido.` (R30, E32)

**(iv) Cuándo.** Dos `<input type="datetime-local">`: `Empieza` (obligatorio, por
defecto ahora) y `Termina` (opcional). Ayuda:
`La hora es la de este dispositivo.` + `Si dejas «Termina» vacío, la promoción sigue hasta que la desactives.`

**(v) Estado.** Casilla `Activar ahora`, marcada por defecto, con
`Puedes desactivarla en cualquier momento sin borrarla.`

Bajo el botón, siempre visible, la nota que evita la llamada a soporte:

> `Los cambios se ven en tu tienda enseguida. Cuando una promoción empieza o termina por su fecha, puede tardar hasta una hora en reflejarse.` (R28)

**Acción:** `Crear promoción` / `Guardar cambios`.

| Estado                                         | Qué se ve                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alta, sin productos en la URL**              | El alcance `Productos elegidos` se puede marcar, y debajo: `Todavía no elegiste ningún producto.` + `Elegir productos` (enlace al listado). El botón de guardar **no** se deshabilita: el 400 del servidor es el que manda (R30) y así el mensaje es uno solo |
| **Porcentaje fuera de rango (400, P2)**        | Error bajo el campo: `El porcentaje tiene que estar entre 0 y 100. El 0 no vale: no descontaría nada.`                                                                                                                                                        |
| **Monto fijo cero o negativo (400, P2)**       | `El monto tiene que ser mayor que 0.`                                                                                                                                                                                                                         |
| **Fin anterior o igual al inicio (400, P2)**   | Error bajo `Termina`: `La fecha de fin tiene que ser posterior a la de inicio.`                                                                                                                                                                               |
| **Alcance sin su contenido (400, R30)**        | `Elige al menos un producto.` / `Elige una categoría.` — debajo del bloque del alcance, no en el resumen a secas                                                                                                                                              |
| **Un producto de otra tienda en la URL (400)** | `Alert tone="danger"`: `Uno de los productos elegidos no es de esta tienda.` + `Volver a elegir`. No se filtra en silencio: filtrar callado dejaría una promoción distinta de la que el admin pidió                                                           |
| **Más de 20 productos**                        | `Elegiste 24 productos y el máximo por promoción es 20.` + `Volver a elegir`                                                                                                                                                                                  |
| **Descuento mayor que el precio**              | Se acepta, y se avisa junto al campo, en `warning`: `En algunos productos el descuento es mayor que el precio: esos van a costar $0.00, nunca menos.` (R27)                                                                                                   |
| **Guardado (200/201)**                         | Vuelve al listado con `Alert tone="positive"`: `Promoción creada. Tu tienda ya la aplica.` / `…, empieza el 1 sep 2026, 8:00.` según la ventana. Con `Ver la tienda ↗`                                                                                        |
| **Guardado, inactiva**                         | `Promoción creada, pero está desactivada. Actívala cuando quieras que se aplique.`                                                                                                                                                                            |
| **400 / 401 / 403 / 404 / 500 / red**          | Los banners comunes del panel (§ Textos)                                                                                                                                                                                                                      |
| **Antes de hidratar / sin JavaScript**         | El formulario se lee y se teclea; no guarda. `<noscript>` con el texto común                                                                                                                                                                                  |
| **Edición de una promoción vencida**           | `Alert tone="muted"` arriba: `Esta promoción ya terminó. Si cambias la fecha de fin, vuelve a aplicarse.`                                                                                                                                                     |

### 7 · La vitrina con descuento — lo que ve el comprador

Esta es la parte del feature que **no** está en el panel y sin la cual las
promociones no existen. Cuatro pantallas ya construidas por F-010 y una regla que
las gobierna: **el descuento se muestra siempre como un par de importes, nunca
como un color nuevo ni un porcentaje suelto.**

**Por qué el par y no una etiqueta.** `accent` ya está ocupado por la cinta
`Destacado` (VE5) y un producto puede estar destacado y en oferta a la vez; y una
etiqueta `-20 %` en un tono de estado (`positive`/`danger`) usaría un color que
significa otra cosa. El par de precios se entiende sin leyenda, no inventa token
y no choca con nada.

**Y la palabra «Antes» va escrita.** Un `line-through` a secas no lo lee ningún
lector de pantalla; es la misma decisión que F-010 tomó para el 409 de precio.

| Pantalla                                                      | Cómo se ve el descuento                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tarjeta del catálogo** (`ProductCard`)                      | Donde hoy hay un importe (`text-brand text-base font-semibold`) van dos: el vigente igual que hoy, y debajo `Antes $500.00` en `text-fg-muted text-xs line-through` (el `line-through` **solo** sobre el importe, no sobre la palabra). Sin insignia. **Sigue siendo server component, sin directiva** |
| **Ficha de producto**                                         | El vigente en `text-3xl`, `Antes $500.00` debajo, y una línea `text-fg-muted text-sm`: `Promoción: 20 % de descuento.` (o `Promoción: $100.00 de descuento.`). El botón de agregar no cambia                                                                                                           |
| **Carrito**                                                   | Por línea: `$400.00 c/u` y debajo `Antes $500.00` (`text-fg-muted line-through`). Necesita **B6**: `QuoteLine` con el precio de lista. El total de línea sigue siendo el que manda el servidor                                                                                                         |
| **Checkout**                                                  | Lo mismo por línea. Y si hay promoción de alcance `ORDER`, una fila nueva en `OrderSummary` entre `Subtotal` y `Envío`: `Descuento` `−$200.00`, y el total pasa a `subtotal − descuento + envío` con `subtract()` de `lib/money` sobre cadenas del servidor (E32)                                      |
| **Comprobante del pedido**                                    | Los importes cobrados, sin tachados: `OrderItem` guarda el `unitPrice` **ya descontado** (R29) y no existe columna para el precio de lista. Si `Order.discountTotal > 0`, `OrderLinesTable` muestra la fila `Descuento`. **Es una limitación consciente**, no un olvido: ver **DP8**                   |
| **Promoción que empieza o termina entre cotizar y confirmar** | No hace falta pantalla nueva: es el `409 PRICE_CHANGED` que F-010 ya diseñó, con `Antes … · Ahora …` por línea y el botón `Confirmar con el total nuevo`. R28 (hasta una hora de retardo en un borde de ventana) es justo lo que lo hace posible, y por eso ese 409 existe                             |

**Lo que este bloque le pide a `architecture.md`** (B5, B6), dicho como
requisito de pantalla y no como esquema:

1. La lectura cacheada del catálogo entrega, por producto, **el importe vigente y
   el de lista**, los dos ya resueltos y en la moneda de visualización. La vista
   no aplica ninguna regla de promoción (R16, R26).
2. `QuoteLine` gana el importe de lista por línea. **No se reutiliza
   `originalUnitPrice`**: hoy significa «efectivo antes de convertir la moneda»
   (`prisma/schema.prisma:431-433`, y `pull.ts:95-99` lo publica al POS con ese
   significado). Darle un segundo significado rompería el contrato sin cambiar una
   línea de `docs/sync-contract.md`, que es la peor forma de romperlo.
3. `QuoteResponse` gana el descuento de alcance `ORDER`, porque el checkout tiene
   que poder cuadrar el total que promete (`expectedTotal`, R6/R7 de F-010).
4. Cuando no hay promoción, el importe de lista llega **igual** al vigente o
   `null`, y la vista no pinta ningún «Antes». Un `Antes $500.00 · Ahora $500.00`
   es peor que no decir nada.

### 8 · La tienda cerrada al público — lo que ve el comprador (HD10, HD11, HD12, HD14)

**Es una pantalla que hoy no existe.** El catálogo se lee con
`status: "PUBLISHED"` (`queries.ts:43`) y `requireStore` llama a `notFound()`, así
que hoy una tienda no publicada responde **404**. HD11 cambia eso para la tienda
cerrada: **200, con su nombre y su marca**. El motivo es físico, el mismo de
ADR 0012: **el QR está pegado en una pared**. Quien lo escanea y recibe un 404
cree que el negocio no existe; quien recibe «estamos realizando adecuaciones»
vuelve mañana.

**Qué se ve, en este orden**

1. **La cabecera de la tienda**, la de siempre (`bg-brand text-brand-contrast`,
   nombre y ciudad), **sin el enlace al carrito**: `CartBadge` no se renderiza
   (HD11). Y el nombre va como **texto, no como enlace**: no hay a dónde ir.
2. `<h1>` con el nombre de la tienda. En la cabecera está pequeño y como marca;
   aquí es el título de la página, y es lo que confirma que el QR llevó al sitio
   correcto.
3. **El motivo**, dentro de un `Alert tone="warning"`, en una sola frase corta,
   tomada de la lista fija por su código (§ 9). Es lo más grande de la pantalla
   después del nombre.
4. **El mensaje del admin**, si lo escribió: hasta 140 caracteres, en
   `whitespace-pre-line`, **pintado como texto y nunca como HTML** (HD14). Ni
   Markdown, ni enlaces autodetectados, ni `dangerouslySetInnerHTML`: es texto que
   un tercero escribe y que se sirve a todo el que escanee.
5. **Qué hacer a continuación.** Y aquí lo importante es no prometer nada falso:
   - Si la tienda tiene `whatsapp` o `phone`: enlace-botón
     `Escribir por WhatsApp`, con un mensaje ya escrito y neutro (§ Textos). Es lo
     único útil que se le puede ofrecer a alguien parado frente a un cartel.
   - Si tiene `address`: la dirección como dato, en `text-fg-muted`, **sin**
     invitar a ir: la tienda online cerrada no dice nada del local físico.
   - Si no hay ni número ni dirección: nada. Un «vuelve pronto» sin fecha es
     ruido.
   - **No hay «ver otras tiendas»**: no existe ningún directorio
     (`src/app/(marketing)/page.tsx` es una landing sin listado, comprobado). El
     marketplace es otro feature.
6. Una última línea, `text-fg-muted text-sm`:
   `Esta página se actualiza sola cuando la tienda vuelva a abrir.`

**Qué NO se ve, y no es una omisión**

- **Catálogo y precios**: ni un producto, ni un importe. La lectura del catálogo
  no se hace (es una consulta menos, no una consulta filtrada).
- **Carrito**: ni el enlace de la cabecera, ni la burbuja, ni la página.
- **Buscador**: la tienda no tiene buscador hoy (`/[slug]/page.tsx` es un `<h1>` y
  una cuadrícula), así que no hay nada que esconder; queda dicho para que nadie
  lo añada aquí después.
- **Nada de JavaScript propio.** Sin `CartBadge`, la página cerrada es **la más
  liviana de toda la aplicación**: menos módulos de cliente que el catálogo.

**Metadatos.** `title: "{tienda} · No disponible ahora"`, la descripción con el
motivo, y **`robots: { index: false }`** mientras esté cerrada: no se quiere que
Google indexe «cerrado» como el contenido de esa tienda ni que lo siga sirviendo
en los resultados cuando vuelva a abrir. Al abrir, el `revalidate` de la
revalidación devuelve los metadatos normales.

**Tres redacciones del motivo, según quién cerró** (§ 9 y HD15):

| Quién cerró                                               | Qué frase se pinta                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El admin, con un motivo de la lista                       | La frase de ese motivo, más su mensaje opcional                                                                                                            |
| Cuadre de Caja (`publishToStore: false`, HD15)            | `Esta tienda no está tomando pedidos por ahora.` — el POS no manda ningún motivo, y no se inventa uno                                                      |
| Nadie: nunca se abrió desde el cambio (HD12, retroactivo) | `Esta tienda todavía no está tomando pedidos por internet.` — es la verdad literal del primer día                                                          |
| La plataforma (suspensión)                                | `Esta tienda no está disponible en este momento.` Neutro a propósito: el comprador no tiene por qué saber que hay un problema administrativo. Ver **DP10** |

**Lo que se guarda es el código, no la frase.** En la base van el código del
motivo y el texto opcional; la oración en español vive en `src/constants/` y se
resuelve al renderizar. Consecuencia buscada: corregir una redacción arregla
todas las tiendas cerradas a la vez, y no queda ninguna copia rancia de una frase
en una fila.

**Los bordes, uno por uno**

| Caso                                                                               | Qué pasa                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/[slug]`**                                                                      | La página cerrada, 200                                                                                                                                                                                                                                                                                                      |
| **`/[slug]/p/[productSlug]`** (llega directo a una ficha, de un enlace compartido) | La página cerrada, 200, **sin leer el producto**. Dos ventajas: una consulta menos, y no se filtra si ese producto existe o no. No se nombra el producto: para nombrarlo habría que leerlo, que es justo lo que se evita                                                                                                    |
| **Producto inexistente en tienda cerrada**                                         | La misma página cerrada. Un 404 de producto dentro de una tienda cerrada es información que a nadie le sirve                                                                                                                                                                                                                |
| **`/[slug]/carrito` y `/[slug]/checkout`**                                         | La página cerrada, 200, **con una línea más**: `Si tenías productos en el carrito, siguen guardados en este teléfono: cuando la tienda vuelva a abrir los vas a encontrar ahí.` Es cierto —el carrito vive en `localStorage` por `Store.id` y dura 30 días (`CART_EXPIRY_DAYS`)— y cuesta cero JavaScript decirlo           |
| **Carrito lleno de esa tienda**                                                    | No se puede saber en el servidor (`localStorage` no viaja), así que **la frase de arriba se pinta siempre** en esas dos rutas, no condicionada. Es la alternativa a montar una isla en la página más liviana de la aplicación                                                                                               |
| **El carrito caduca mientras la tienda está cerrada**                              | Se descarta en silencio a los 30 días, como cualquier carrito viejo (R15 de F-010). Aceptado: los precios ya no serían los mismos                                                                                                                                                                                           |
| **La burbuja del carrito en otras tiendas**                                        | Intacta: los carritos están namespaceados por `Store.id` (R12 de F-010)                                                                                                                                                                                                                                                     |
| **`/[slug]/pedido/[code]` de un pedido ya hecho**                                  | **Sigue accesible** (HD11), completa y con su atajo de WhatsApp. Encima del comprobante, `Alert tone="muted"`: `Esta tienda cerró sus pedidos online por ahora.` + `Este pedido ya lo tiene la tienda. Si necesitas hablar con ellos, aquí abajo están sus datos.` La cabecera sigue sin `CartBadge`                        |
| **Un pedido de otra tienda**                                                       | Sin relación: cada `/[slug]` resuelve su propia tienda                                                                                                                                                                                                                                                                      |
| **Alguien con el checkout abierto cuando se cierra la tienda**                     | El `POST /api/orders/quote` y el `POST /api/orders` **rechazan** (B8). En las pantallas de F-010, que ya tienen su banner para esto: `Alert tone="danger"` con `Esta tienda dejó de tomar pedidos.` + la frase del motivo + `No se creó ningún pedido.` `Confirmar` queda deshabilitado con `aria-describedby` a ese banner |
| **Una página ya servida por el CDN o una pestaña abierta**                         | Puede seguir mostrando el catálogo hasta que caduque la caché. Por eso cerrar **revalida en el acto** (R10, B10) y por eso el rechazo del checkout es la puerta que de verdad cierra: la pantalla puede ir rezagada, el pedido no                                                                                           |
| **`generateStaticParams`**                                                         | Hoy solo prerrenderiza publicadas (`getPublishedStoreSlugs`). Una tienda cerrada que no esté en esa lista se renderiza en la primera petición y se cachea: es una optimización de arranque en caliente, no un requisito, y el comentario del propio archivo ya lo dice                                                      |
| **Tienda en `DRAFT`, nunca publicada**                                             | Sigue siendo **404**. No hay QR en la pared de una tienda que nunca se abrió, y una página cerrada para algo que nunca existió le da existencia pública a un borrador                                                                                                                                                       |

### 9 · El interruptor del panel (HD10, HD13, HD14, HD15)

**Dónde vive.** En el hub de la tienda (§ 2), en su **propia tarjeta y la
primera**, encima de «Datos de Cuadre de Caja». Es la acción con más consecuencias
de todo el panel: no se esconde en un pie ni se mezcla con los datos de lectura.
No va en el listado de tiendas (§ 1) a propósito: abrir o cerrar se hace después
de mirar la tienda, y meter una escritura en `/admin` obligaría a montar una isla
en la única pantalla del panel que hoy tiene cero JavaScript.

#### Estado abierta

`<h2>Tu tienda al público</h2>`, `Badge tone="positive"` `Abierta`, y:

- `Tus clientes pueden ver el catálogo y hacer pedidos.`
- `Ver la tienda ↗`
- `Button variant="secondary"` `Cerrar la tienda al público`. **No es un
  interruptor de dos posiciones** (`switch`): un botón que dice lo que va a pasar
  es más difícil de pulsar por error que un control que cambia de lado, y no hay
  que adivinar si el gris es «apagado» o «desactivado».

#### Estado cerrada

`Badge tone="warning"` `Cerrada`, `Alert tone="warning"` con tres cosas:

1. **Desde cuándo y quién** (HD15): `La cerraste tú el 26 ago, 9:14.` ·
   `La cerró Cuadre de Caja el 26 ago, 9:14.` ·
   `Nunca la abriste al público.` (el caso de HD12, el primer día).
2. **Lo que ve el cliente**, con el bloque de la página cerrada renderizado de
   verdad (la previsualización de abajo).
3. `Button` primario `Abrir la tienda al público` — **sin confirmación**: abrir no
   destruye nada y la asimetría es deliberada (cerrar cuesta tres toques, abrir
   uno).

Y cuando la cerró Cuadre de Caja, una frase más, que es el punto 5 del encargo:

> `Si no fuiste tú, alguien la desactivó en Cuadre de Caja.` `Puedes volver a abrirla desde aquí; manda la última acción, venga de donde venga.` (HD13)

Sin esa frase, el negocio ve su tienda cerrada, el panel encendido y concluye que
el panel está roto.

#### Cómo se elige el motivo (HD14)

Al pulsar `Cerrar la tienda al público`, el botón se sustituye **en su sitio** por
el formulario de cierre —sin diálogo, sin foco atrapado, mismo patrón que las
otras tres confirmaciones del panel—:

**(i)** `<fieldset><legend>¿Por qué la cierras?</legend>` con seis `RadioCard`.
Cada tarjeta muestra **la frase exacta que va a leer el comprador**, no una
etiqueta interna: se elige viendo el resultado.

| Código                  | Lo que ve el comprador                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `ADECUACIONES`          | `Estamos realizando adecuaciones en la tienda.`                            |
| `FUERA_DE_SERVICIO`     | `Tienda temporalmente fuera de servicio.`                                  |
| `REPONIENDO_INVENTARIO` | `Estamos reponiendo el inventario. Volvemos en cuanto tengamos productos.` |
| `VACACIONES`            | `Cerrado por vacaciones. Volvemos pronto.`                                 |
| `SOLO_EN_EL_LOCAL`      | `Por ahora atendemos solo en el local, no por internet.`                   |
| `OTRO`                  | Nada propio: **obliga** a escribir el mensaje de abajo                     |

Las dos primeras son las que dio el humano, literales. Los códigos y sus frases
van a `src/constants/` (AGENTS.md prohíbe cadenas mágicas) y **en la base se
guarda el código**, nunca la frase (§ 8).

**(ii)** `Field` con `TextArea maxLength=140`:
`Mensaje para tus clientes (opcional)`, ayuda:
`Una línea, en tus palabras. Se muestra tal como la escribas.` Con `OTRO`
marcado la etiqueta pierde el «(opcional)» y el servidor lo exige.

**(iii)** La previsualización (abajo).

**(iv)** Las consecuencias, en una lista y en este orden, que es el orden en el
que importan:

> - `Tus clientes van a ver el mensaje que elijas, no tu catálogo.`
> - `Nadie va a poder hacer pedidos nuevos.`
> - `Los pedidos que ya te hicieron no se cancelan, y los sigues recibiendo en Cuadre de Caja.`
> - `Puedes volver a abrirla en cualquier momento desde aquí.`

La tercera es verdad comprobada, no un consuelo: `pullOrders`
(`src/features/orders/server/pull.ts:62`) filtra por `id > since` y **no** por el
estado de la tienda, así que cerrar al público no interrumpe la entrega de los
pedidos pendientes al POS. Si el arquitecto le añadiera un filtro por estado,
esta frase se vuelve mentira: queda como **B9**.

**(v)** Las dos acciones: `Button` `Sí, cerrar la tienda` (`variant="secondary"`
con el texto explícito, no un rojo que invite a mirar el color en vez de leer) y
`No cerrar`. El foco pasa al primer `RadioCard` al abrirse el formulario;
`Escape` y `No cerrar` cancelan y devuelven el foco al botón que lo abrió.

#### La previsualización (punto 3 del encargo)

**Lo barato y lo bueno coinciden**: el bloque del motivo de la página cerrada es un
componente presentacional **sin directiva** (`ClosedStoreNotice`), así que la isla
del interruptor lo renderiza con el motivo y el texto que hay elegidos **en ese
momento**, sin viaje al servidor y sin código duplicado. Lo que el admin ve es
literalmente el mismo componente que el comprador, con las mismas cadenas.

Dos honestidades que van escritas al lado:

- `Así se ve el aviso. La cabecera con los colores de tu tienda no se muestra aquí.` — el panel no aplica el branding de ninguna tienda (§ Tokens, y HD6 dejó congelada la maqueta de marca).
- Y después de guardar, el enlace de verdad: `Ver cómo la ve tu cliente ↗`, que abre `/[slug]` en otra pestaña. La previsualización es para decidir; el enlace es para comprobar.

#### Estados del interruptor

| Estado                                  | Qué se ve                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Abierta**                             | `Badge` `Abierta`, la frase, `Ver la tienda ↗`, `Cerrar la tienda al público`                                                                                                                                                                                                      |
| **Cerrada por el admin**                | `Badge` `Cerrada`, quién y cuándo, el aviso tal como lo ve el cliente, `Abrir la tienda al público`, y un enlace `Cambiar el motivo` que reabre el formulario **sin cerrar nada** (ya está cerrada: se guarda solo el motivo)                                                      |
| **Cerrada desde Cuadre de Caja** (HD15) | Igual, más la frase de HD13. `Cambiar el motivo` **también está**: el admin puede ponerle un motivo propio a un cierre que no hizo él, y eso es mejor que dejar el texto neutro puesto                                                                                             |
| **Nunca abierta** (HD12, el primer día) | `Badge` `Cerrada` + `Nunca la abriste al público.` + `Cuando abras, tus clientes van a poder ver el catálogo y pedir.` El botón primario es `Abrir la tienda al público`, y es **la acción más destacada de todo el panel** ese día                                                |
| **Suspendida por la plataforma**        | `Badge tone="danger"` `Suspendida` y el botón **deshabilitado**, con `aria-describedby` a: `Esta tienda está suspendida por queandabuscando. Esto no se resuelve desde aquí: escribe a soporte.` Sin formulario de motivo                                                          |
| **Borrador (nunca publicada)**          | Sin interruptor: `Alert tone="muted"`: `Esta tienda todavía no está publicada. Se publica desde Cuadre de Caja; después vas a poder abrirla y cerrarla desde aquí.` Publicar la primera vez sigue siendo del POS — HD10 revierte HD2 solo en la mitad de abrir y cerrar al público |
| **Cerrando**                            | El botón `disabled` con `Cerrando…` y `aria-busy="true"`; el `<fieldset>` deshabilitado                                                                                                                                                                                            |
| **Cerrada con éxito (200)**             | `Alert tone="positive"` `role="status"`: `Tu tienda está cerrada al público.` + `Tus clientes ven el aviso que elegiste.` + `Ver cómo la ve tu cliente ↗`. El bloque pasa al estado «cerrada por el admin»                                                                         |
| **Abierta con éxito (200)**             | `Alert tone="positive"`: `Tu tienda está abierta. Tus clientes ya pueden pedir.` + `Ver la tienda ↗`                                                                                                                                                                               |
| **`OTRO` sin mensaje (400)**            | Error bajo el `TextArea`: `Escribe el mensaje que van a leer tus clientes.` Nada se cerró                                                                                                                                                                                          |
| **Mensaje de más de 140 (400)**         | `El mensaje no puede pasar de 140 caracteres.`                                                                                                                                                                                                                                     |
| **Motivo fuera de la lista (400)**      | Al resumen: `Ese motivo no está en la lista. Recarga la página y vuelve a elegir.` Solo alcanzable con un cuerpo manipulado                                                                                                                                                        |
| **401 / 403 / 404 / 500 / red**         | Los banners comunes del panel (§ Textos). En el 403: `Ya no tienes permiso para abrir o cerrar esta tienda.`                                                                                                                                                                       |
| **Carrera con el POS** (HD13)           | No se detecta y no se bloquea: gana el último que escribió. Al recargar, el bloque dice quién fue. Es lo que HD13 pide, y fingir un bloqueo optimista que no existe sería peor                                                                                                     |
| **Antes de hidratar / sin JavaScript**  | El estado, el motivo y el aviso **se leen**; el botón no hace nada. `<noscript>`: `Para abrir o cerrar tu tienda necesitas activar JavaScript.`                                                                                                                                    |

#### El estado en el listado y en el hub (punto 4 del encargo)

El `Badge` del listado pasa a contestar **la pregunta que de verdad tiene el
admin** —«¿me pueden comprar?»— y no la del esquema de la base:

| Situación                                | `Badge`                 | Segunda línea de la tarjeta          |
| ---------------------------------------- | ----------------------- | ------------------------------------ |
| Publicada y abierta                      | `Abierta` (`positive`)  | —                                    |
| Publicada y cerrada por el admin         | `Cerrada` (`warning`)   | `La cerraste tú el 26 ago.`          |
| Publicada y cerrada desde Cuadre de Caja | `Cerrada` (`warning`)   | `La cerró Cuadre de Caja el 26 ago.` |
| Publicada y nunca abierta (HD12)         | `Cerrada` (`warning`)   | `Nunca la abriste al público.`       |
| Suspendida por la plataforma             | `Suspendida` (`danger`) | `Escribe a soporte.`                 |
| Nunca publicada                          | `Borrador` (`muted`)    | `Se publica desde Cuadre de Caja.`   |

Un solo `Badge` y no dos: dos insignias juntas («Publicada» + «Cerrada») se leen
como una contradicción, y la publicación sin apertura no le dice nada al negocio.

Y **el primer día de HD12**, cuando todas las tiendas quedan cerradas: encima de
la lista, una sola vez y solo si alguna tienda está cerrada y nunca fue abierta,
`Alert tone="warning"`:

> `Tus tiendas están cerradas al público.` `Revisa que el catálogo, las fotos y los precios estén como quieres, y ábrelas cuando estés listo.`

En el hub, el enlace «Ver la tienda ↗» se mantiene también cerrada —lleva a la
página cerrada, que es información útil— y el contador de productos y promociones
no cambia: cerrar no oculta nada del panel.

### 10 · Estados que no son pantalla, y `/sesion-cerrada`

| Caso                                                                      | Qué pasa                                                                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tienda, producto o promoción ajenos, por URL                              | **404** de Next, sin el nombre del recurso en el cuerpo (R7, E3, criterio 6)                                                       |
| Endpoint sin cookie (E5)                                                  | 401 JSON `{"error":"UNAUTHORIZED"}`. Un endpoint no redirige                                                                       |
| Endpoint sobre recurso ajeno (E4, E19, E24, E33)                          | 403 JSON `{"error":"FORBIDDEN"}`, y en la subida **antes de leer el cuerpo del archivo** (E24)                                     |
| Página del panel sin sesión (R6)                                          | Redirección a **`/sesion-cerrada`**                                                                                                |
| Tienda **cerrada al público**, cualquier ruta pública salvo la del pedido | **200** con la página cerrada (§ 8). Es la excepción a «no publicada → 404», y solo para las cerradas: un `DRAFT` sigue siendo 404 |

**`/sesion-cerrada`** es una página estática, **fuera** de `/admin` para no chocar
con la guarda del layout: `<h1>Tu sesión se cerró</h1>`,
`Por seguridad, la sesión del panel dura 12 horas.`,
`Entra otra vez desde Cuadre de Caja, con el botón «Ir a mi tienda online».` y un
enlace `Ir al inicio`. Sustituye el destino de `src/app/admin/layout.tsx:10`
(VE8). La alternativa —que la portada lea `searchParams`— convierte una página
estática en dinámica, que es lo que F-013 está intentando evitar. **No la cubre
ningún criterio**: si el orquestador la deja fuera, se cae sola y el hueco queda
anotado.

---

## Errores y validación

**1. El panel nunca imprime el mensaje de Zod.** Los mensajes del esquema van en
inglés (AGENTS.md § Idioma) y la UI en español, así que la isla **mapea el `path`**
y descarta el `message`:

| `path`                         | Texto debajo del campo                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `description`                  | `La descripción no puede pasar de 1000 caracteres.`                                                                                |
| `visible` / `featured`         | `Elige una de las dos opciones.` (solo alcanzable con un cuerpo manipulado)                                                        |
| `priceOverride`                | `Escribe un importe de 0 o más, con hasta dos decimales.`                                                                          |
| `priceOverrideCurrency`        | Al resumen: `No pudimos determinar la moneda de este producto. Recarga la página y vuelve a intentar.`                             |
| `reason` (motivo del cierre)   | Al resumen: `Ese motivo no está en la lista. Recarga la página y vuelve a elegir.`                                                 |
| `message` (mensaje del cierre) | `Escribe el mensaje que van a leer tus clientes.` / `El mensaje no puede pasar de 140 caracteres.`                                 |
| `name`                         | `El nombre no puede pasar de 60 caracteres.`                                                                                       |
| `type` / `scope`               | `Elige una de las opciones.`                                                                                                       |
| `value` (porcentaje)           | `El porcentaje tiene que estar entre 0 y 100. El 0 no vale: no descontaría nada.`                                                  |
| `value` (monto)                | `El monto tiene que ser mayor que 0.`                                                                                              |
| `startsAt`                     | `Escribe cuándo empieza.`                                                                                                          |
| `endsAt`                       | `La fecha de fin tiene que ser posterior a la de inicio.`                                                                          |
| `conditions.storeProductIds`   | `Elige al menos un producto.` / `Uno de los productos elegidos no es de esta tienda.` / `El máximo por promoción es 20 productos.` |
| `conditions.localCategoryIds`  | `Elige una categoría.` / `Esa categoría no es de esta tienda.`                                                                     |
| `conditions.minSubtotal`       | `Escribe un mínimo de 0 o más, o déjalo vacío.`                                                                                    |
| archivo (subida)               | Los textos por archivo de § 4c, que van junto al nombre del archivo y no en un resumen                                             |
| clave desconocida              | Al resumen: `Hay un dato que el panel no reconoce ({clave}). Recarga la página y vuelve a intentar.`                               |
| cualquier otro                 | `Revisa este dato.` — un texto genérico es mejor que un mensaje en inglés                                                          |

**2. El resumen arriba del formulario.** `Alert tone="danger"` con `role="alert"` y
`tabIndex={-1}`, que **recibe el foco por programa** (el patrón que ya usa
`CheckoutForm.tsx:437-438`):

> `No se guardó nada. Revisa 2 datos.`
> · `<a href="#priceOverride">Precio propio: escribe un importe de 0 o más, con hasta dos decimales.</a>`
> · `<a href="#endsAt">Termina: la fecha de fin tiene que ser posterior a la de inicio.</a>`

La primera frase es la importante y va primera: **nada cambió en la base**.

**3. Debajo de cada campo.** `Field` ya cablea `aria-invalid` y
`aria-describedby` cuando recibe `error` (`Field.tsx:36-46`).

**4. Cuándo se valida.** Al guardar, contra el servidor. La isla **no** reimplementa
ninguna regla: ni el rango del porcentaje, ni los dos decimales del precio, ni el
mime del archivo. Los `type`, `inputMode`, `maxLength`, `accept` y `min` del HTML
están puestos —evitan el viaje inútil y abren el teclado correcto— pero **el que
decide es el servidor**, y el error que se pinta es el suyo. Al corregir un campo
su error se limpia al escribir.

**5. Un guardado correcto.** `Alert tone="positive"`, que ya es `role="status"`
(`Alert.tsx:19-24`): se anuncia sin interrumpir, **no roba el foco** y **no se va
solo**. Sin `router.refresh()`: la pantalla ya muestra lo que mandó, y el importe
efectivo lo trae la propia respuesta (B3).

**6. Nada de `alert()`, `confirm()` ni toast.** Las tres confirmaciones del
feature —quitar imagen, borrar promoción, y la de branding cuando se descongele—
son en línea, donde está el botón.

---

## Estructura por breakpoint

360 primero. `Container` ya da `mx-auto max-w-6xl px-4 sm:px-6` y no se toca.

| Zona                                | 360                                                                                                                                                                                                                                                                                           | 768                                                                                 | 1280                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Listado de tiendas**              | Una columna; nombre + `Badge` en la primera fila (`shrink-0`), ciudad debajo, los tres enlaces en una fila que envuelve, `min-h-11` cada uno                                                                                                                                                  | Una columna `max-w-3xl`; enlaces a la derecha                                       | Igual que 768. **No se abre a cuadrícula**                                                                                                                                      |
| **Hub de la tienda**                | `<dl>` de una columna, y las dos tarjetas de destino apiladas a todo el ancho, `min-h-20`                                                                                                                                                                                                     | `<dl>` a dos columnas; destinos en dos columnas                                     | Igual que 768, `max-w-4xl`                                                                                                                                                      |
| **Listado de productos · fila**     | Miniatura 48 px a la izquierda; a su derecha nombre y categoría; **segunda fila** con el precio y los `Badge`s. Dos filas porque cinco cosas en 360 px o se solapan o bajan de 44 px. La casilla va la primera, `h-11 w-11` de área                                                           | Una fila: casilla, miniatura, nombre + categoría, precio, `Badge`s                  | Igual que 768, con la miniatura a 64 px                                                                                                                                         |
| **Listado de productos · buscador** | El campo a todo el ancho y el botón debajo, también a todo el ancho                                                                                                                                                                                                                           | Campo y botón en la misma fila                                                      | Igual que 768                                                                                                                                                                   |
| **Listado de productos · conteos**  | `flex-wrap`, cada conteo un enlace `min-h-11`; se leen como dos o tres líneas                                                                                                                                                                                                                 | Una línea                                                                           | Una línea                                                                                                                                                                       |
| **Barra de selección**              | En flujo, al final de la lista, a todo el ancho. **No `sticky`**: en 360 px una barra fija abajo tapa la última fila y compite con el teclado                                                                                                                                                 | En flujo                                                                            | En flujo                                                                                                                                                                        |
| **Editor de producto · orden**      | 1 volver + `<h1>`, 2 datos del POS, 3 «Lo que ves en tu tienda», 4 imágenes                                                                                                                                                                                                                   | Igual                                                                               | Dos columnas `lg:grid-cols-[1fr_20rem]`: las tarjetas a la izquierda, **imágenes** a la derecha (`sticky top-6`), porque es la única tarjeta que se mira mientras se edita otra |
| **Editor · precio**                 | Los dos `RadioCard` apilados; al elegir «precio propio», el campo aparece **debajo** (nunca encima de lo que se acaba de pulsar), con la moneda a su derecha, `shrink-0`                                                                                                                      | Los dos radios en fila; el campo debajo, `max-w-xs`                                 | Igual que 768                                                                                                                                                                   |
| **Editor · imágenes**               | Cuadrícula `grid-cols-2`; cada miniatura con sus dos acciones debajo, `min-h-11`. El botón de agregar ocupa una celda entera                                                                                                                                                                  | `grid-cols-3`                                                                       | `grid-cols-2` dentro de la columna estrecha de 20 rem                                                                                                                           |
| **Promociones · fila**              | Rótulo y `Badge` en la primera fila; ventana debajo; las tres acciones en una fila que envuelve                                                                                                                                                                                               | Rótulo + `Badge` + ventana en una fila; acciones a la derecha                       | Igual que 768                                                                                                                                                                   |
| **Promoción · formulario**          | Un bloque por fila; `RadioCard` apiladas; las dos fechas apiladas                                                                                                                                                                                                                             | `RadioCard` de tipo en fila, las de alcance apiladas (llevan frase); fechas en fila | Igual que 768, `max-w-2xl`                                                                                                                                                      |
| **Banners**                         | A todo el ancho, arriba del `<form>` al que pertenecen — **no** arriba de la página: hay hasta tres formularios por pantalla                                                                                                                                                                  | Igual                                                                               | Igual                                                                                                                                                                           |
| **Vitrina · par de precios**        | El vigente donde hoy está el precio; `Antes …` debajo, `text-xs`. **No comparten fila**: en 360 px dos importes en una línea se cortan                                                                                                                                                        | Debajo también, `text-sm`                                                           | Debajo                                                                                                                                                                          |
| **Página cerrada**                  | Cabecera de la tienda (sin carrito) + un bloque a todo el ancho, `max-w-md`, centrado verticalmente con `py-16`: `<h1>`, el motivo, el mensaje, el botón de WhatsApp a todo el ancho (`min-h-12`). Nada más en la pantalla: es la única del proyecto donde eso es un acierto y no un descuido | Igual, `max-w-lg`, botón al ancho de su contenido                                   | Igual, `py-24`                                                                                                                                                                  |
| **Interruptor del panel**           | La tarjeta a todo el ancho, primera. Los seis `RadioCard` del motivo apilados (llevan frase, no caben en fila), `min-h-14`; el `TextArea` a todo el ancho; las dos acciones apiladas, `Sí, cerrar la tienda` arriba                                                                           | Motivos apilados, acciones en fila                                                  | Igual que 768; la tarjeta no se estira más allá de `max-w-4xl` del hub                                                                                                          |

**La regla en 360:** una columna, sin scroll horizontal, una acción primaria por
tarjeta, nada fijo arriba ni abajo, y **nada que llegue tarde por encima de algo
que ya se podía tocar**.

---

## Componentes de UI

**Se reutilizan tal cual:** `Container`, `Card`, `Badge`, `Alert`, `Button`,
`Field`, `RadioCard`. `QuantityStepper` no se usa.

**Primitivos nuevos en `src/components/ui/`**, los dos **sin directiva**:

| Componente  | Por qué no alcanza lo que hay                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TextInput` | La cadena `border-border min-h-11 w-full rounded-md border px-3` está copiada **cinco veces** en `CheckoutForm.tsx` (512, 532, 546, 608 y su variante 562). El panel añadiría diez copias más |
| `TextArea`  | Lo mismo con `min-h-20 … py-2`. Dos componentes y no uno con bandera: el elemento es distinto y `Field` recibe un render prop justo para no forzar una forma única                            |

> **Regla que no se negocia:** en `src/components/ui/` **jamás** entra
> `"use client"`. Esos primitivos los importan componentes de servidor de la
> tienda pública; una directiva ahí convertiría `Card`, `Field` o `Button` en
> módulos de cliente en `/[slug]` y reventaría el presupuesto de F-013 sin que
> nadie lo relacione con el panel.

**Componentes del panel.** La ubicación la fija `sdd-architect`; propongo
`src/features/admin/components/`. Ninguno lo importa nunca una página de tienda.

| Componente             | Qué hace                                                                                                                                                                                                                                   | `"use client"`                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StoreListCard`        | Tarjeta del listado de tiendas                                                                                                                                                                                                             | **No**                                                                                                                                                                                                                                                       |
| `StoreStatusBadge`     | `StoreStatus` → etiqueta española + tono + su frase                                                                                                                                                                                        | **No**                                                                                                                                                                                                                                                       |
| `PosFactsCard`         | El `<dl>` de lectura + la nota. Sirve para la tienda y para el producto                                                                                                                                                                    | **No**                                                                                                                                                                                                                                                       |
| `ProductRow`           | Una fila del listado de productos                                                                                                                                                                                                          | **No**                                                                                                                                                                                                                                                       |
| `ProductPanelForm`     | La tarjeta 4b: visibilidad, destacado, descripción, precio, `fetch`, banners                                                                                                                                                               | **Sí** — es isla                                                                                                                                                                                                                                             |
| `ProductImageUploader` | La tarjeta 4c: selección, subida en serie, quitar, hacer principal, sus siete estados de error                                                                                                                                             | **Sí** — es isla                                                                                                                                                                                                                                             |
| `PromotionRow`         | Una fila del listado de promociones, con su rótulo derivado y su `Badge`                                                                                                                                                                   | **No**                                                                                                                                                                                                                                                       |
| `PromotionActions`     | `Activar`/`Desactivar` y la confirmación en línea de `Borrar`                                                                                                                                                                              | **Sí** — la más pequeña; ver § Coste de cliente                                                                                                                                                                                                              |
| `StorePublicSwitch`    | `"use client"`                                                                                                                                                                                                                             | Estado (motivo elegido y mensaje), eventos (`onSubmit` con `fetch`, abrir y cancelar el formulario) y **la previsualización en vivo**, que es la razón por la que no puede ser un `<form>` nativo: el admin tiene que ver el aviso antes de cerrar su tienda | `/admin/tiendas/*` (ƒ) | ~2 KB |
| `PromotionForm`        | Alta y edición                                                                                                                                                                                                                             | **Sí** — es isla                                                                                                                                                                                                                                             |
| `promotionLabel()`     | `Promotion` → `20 % en 3 productos`. **Función pura en `src/lib/`**, no componente: la usan el listado (servidor) y el banner de la isla                                                                                                   | —                                                                                                                                                                                                                                                            |
| `ClosedStoreNotice`    | El bloque del motivo: título, frase del motivo, mensaje del admin (texto plano) y el contacto si existe. **Lo usan la página pública y la previsualización del panel**, que es lo que garantiza que el admin vea lo mismo que el comprador | **No** — sin estado propio                                                                                                                                                                                                                                   |
| `StorePublicSwitch`    | La tarjeta 0 del hub: estado, quién cerró, formulario del motivo, previsualización, `fetch`, banners                                                                                                                                       | **Sí** — es isla                                                                                                                                                                                                                                             |
| `StoreOpenBadge`       | El `Badge` de cuatro estados del listado y del hub, con su segunda línea                                                                                                                                                                   | **No** — servidor puro                                                                                                                                                                                                                                       |

**Cambios en componentes de tienda ya existentes** (los hace el implementador;
ninguno gana directiva):

| Archivo                                                                      | Cambio                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/store/ProductCard.tsx`                                       | El par de precios cuando llega un importe de lista distinto del vigente. **Sigue sin directiva**                                                                        |
| `src/app/[slug]/p/[productSlug]/page.tsx`                                    | El par + la línea `Promoción: …`                                                                                                                                        |
| `src/features/cart/components/CartLineRow.tsx`                               | Una prop más para el `Antes …` por línea. Sigue sin directiva                                                                                                           |
| `src/features/cart/components/OrderSummary.tsx`                              | Una fila opcional `Descuento` entre `Subtotal` y `Envío`. Sigue sin directiva                                                                                           |
| `src/features/orders/components/OrderLinesTable.tsx`                         | La fila `Descuento` cuando `discountTotal > 0`. Server component                                                                                                        |
| `src/app/[slug]/layout.tsx`                                                  | Resuelve la tienda en los dos estados; **no renderiza `CartBadge`** cuando está cerrada, y el nombre deja de ser enlace. Sigue sin directiva                            |
| `src/app/[slug]/page.tsx`, `p/[productSlug]/page.tsx`, `carrito`, `checkout` | Cuando está cerrada, renderizan `ClosedStoreNotice` en vez de su contenido, **sin leer catálogo ni producto**, y `generateMetadata` devuelve `robots: { index: false }` |
| `src/app/[slug]/pedido/[code]/page.tsx`                                      | Un `Alert tone="muted"` arriba cuando la tienda está cerrada. El resto, intacto                                                                                         |

---

## Tokens y tema

**Ni un token nuevo.** Todo de `src/theme/tokens.css`:

| Uso                                                           | Token / utilidad                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fondos del panel                                              | `bg-bg`, `bg-surface`, `bg-surface-muted`                                                                                                            |
| Bordes, separadores, marco de miniatura                       | `border-border`                                                                                                                                      |
| Texto, texto secundario, `Antes …`, precio provisional        | `text-fg`, `text-fg-muted`                                                                                                                           |
| Acción primaria (`Guardar…`, `Nueva promoción`, `Reintentar`) | `Button` primario: `bg-brand text-brand-contrast` — el azul de la plataforma                                                                         |
| Acción secundaria (`Agregar imágenes`, `No`, `Volver`)        | `secondary` / `ghost`                                                                                                                                |
| Guardado, activada, subida correcta                           | `Alert tone="positive"`                                                                                                                              |
| Aviso (cero, moneda cambiada, tope, éxito parcial, sin JS)    | `Alert tone="warning"`                                                                                                                               |
| Error (400, 401, 403, 404, 500, 503, red)                     | `Alert tone="danger"`                                                                                                                                |
| Neutro (sin productos, sin promociones, sin imágenes)         | `Alert tone="muted"`                                                                                                                                 |
| Tienda cerrada: el aviso del comprador y el bloque del panel  | `Alert tone="warning"`. **No `danger`**: para el comprador no es un error ni una culpa de nadie, y para el admin es un estado legítimo que él eligió |
| `Badge` de apertura                                           | `Abierta` → `positive`; `Cerrada` → `warning`; `Suspendida` → `danger`; `Borrador` → `muted`                                                         |
| `Badge`s del listado                                          | `muted` (oculto, precio propio), `warning` (destacado, no aplica), `positive` (con promoción), `danger` (borrado)                                    |
| Disponibilidad                                                | `AVAILABILITY_TONE` de `src/lib/availability.ts`, sin duplicar el mapeo                                                                              |
| Esquinas                                                      | `rounded-sm\|md\|lg` — **nunca** `rounded-[--radius-lg]`                                                                                             |
| Sombra                                                        | `shadow-card`                                                                                                                                        |
| Foco                                                          | `focus-visible:outline-brand outline-2 outline-offset-2`                                                                                             |
| Tipografía                                                    | `font-sans` + la escala de Tailwind. Sin tamaños arbitrarios                                                                                         |

**El panel no se viste con la marca de la tienda.** Con HD6 esto es todavía más
sencillo que en el ciclo 1: en toda esta tanda **no hay un solo sitio del panel
donde se aplique el branding de una tienda**. Las miniaturas del producto y las
tarjetas del listado usan las superficies de la plataforma. El único lugar donde
los colores de la tienda aparecen es la tienda misma.

**Cómo reacciona la vitrina al branding de cada tienda**, ahora que hay
descuentos: el importe vigente sigue en `text-brand` en la tarjeta y en la ficha
(así está hoy, `ProductCard.tsx:57`, y no se toca), y el `Antes …` va en
`text-fg-muted`, que **no** es overridable. Consecuencia buscada: una tienda con
un `brand` de bajo contraste puede volver ilegible su precio nuevo, pero **nunca**
el precio anterior ni el `Descuento` del resumen, que van en tokens de texto. Es
la misma decisión que tomó F-010 con el subtotal y el total.

**La página cerrada y el branding.** Es la única pantalla nueva de este ciclo que
**sí** se viste con los colores de la tienda, y solo en la cabecera
(`bg-brand text-brand-contrast`), que es la que ya existe. El aviso va en tokens
de plataforma (`warning`, `text-fg`, `bg-surface`): así el mensaje se lee aunque la
tienda tenga un `brand` de bajo contraste, que es exactamente el riesgo que F-010
dejó anotado. Y la previsualización del panel **no** pinta la cabecera de marca
(§ 9), lo que va dicho al lado en vez de fingido.

**Modo oscuro.** Verificado en el panel (VE2) y en la vitrina (VE4, VE9, VE10:
todas las capturas de estos dos ciclos son en oscuro). Lo que hay que mirar con
lupa cuando se implemente: el `line-through` sobre `text-fg-muted` en oscuro
—`oklch(0.7 …)` sobre `oklch(0.17 …)`— y los `Badge` `warning` sobre `bg-surface`.
Va como paso `V19`.

---

## Accesibilidad

**Orden de foco (Tab).**

- _Listado de productos:_ `Panel de administración` → `← Tus tiendas` → campo de
  búsqueda → `Buscar` → los conteos-enlace → por fila: casilla → nombre → …
  → `Anterior`/`Siguiente` → (si hay selección) `Crear promoción con estos
productos` → `Quitar la selección`. La barra de selección aparece **al final del
  DOM**, así que marcar una casilla no mueve el foco de nadie.
- _Editor de producto:_ `← Productos` → (banner si existe) → radios de
  visibilidad (un `tab` al grupo, flechas dentro) → casilla de destacado →
  descripción → radios de precio → campo de precio (solo si «precio propio») →
  `Guardar cambios` → **luego** la tarjeta de imágenes: por miniatura
  `Hacer principal` → `Quitar` → `Agregar imágenes`.
- _El campo de precio se inserta debajo del radio_ y se anuncia con
  `aria-live="polite"`; el foco **no** se mueve solo (mover el foco por marcar un
  radio desorienta, F-010).
- _Promoción:_ (banner) → tipo → valor → alcance → contenido del alcance →
  `Empieza` → `Termina` → `Activar ahora` → `Crear promoción`.
- _Tras un 400:_ el foco salta al resumen (`tabIndex={-1}` + `focus()`) y desde
  sus enlaces se llega a cada campo con un `tab`.
- _Tras un 200:_ **el foco no se mueve.**
- _Confirmaciones en línea:_ al abrirse, el foco va a `Sí, quitar` / `Sí, borrar`;
  con `No` o `Escape` vuelve al botón que la abrió. El foco no se cae al `<body>`
  en ningún camino, tampoco al desaparecer una miniatura: pasa al `Quitar` de la
  siguiente, o al botón `Agregar imágenes` si era la última.

**Semántica.**

- Un `<h1>` por pantalla, `<h2>` por tarjeta. Cada `<form>` con
  `aria-labelledby` al `id` de su `<h2>`.
- Los datos del POS son `<dl>`/`<dt>`/`<dd>`, no inputs deshabilitados.
- Visibilidad, tipo y alcance son `<fieldset><legend>` con `RadioCard`, que ya es
  un `<input type="radio">` real: flechas y anuncio los da el navegador.
- Las casillas del listado tienen `<label class="sr-only">Elegir Arroz blanco 1
kg</label>`: una casilla sin etiqueta en una tabla es un control anónimo para
  quien no ve la fila.
- La galería es una `<ul>`; cada miniatura, un `<li>` con la imagen y sus dos
  botones. `alt` de la miniatura: **el nombre del producto**, no el del archivo
  (`Arroz blanco 1 kg, imagen 2 de 3`). El nombre del archivo aparece como texto
  en las filas de subida, donde sí importa cuál falló.
- `Subiendo 2 de 3…` vive en un contenedor `role="status"` `aria-busy="true"`;
  cada archivo terminado se anuncia una vez (`«foto-1.jpg» lista.`). Los errores
  de archivo van en `role="alert"`.
- El par de precios de la vitrina: `Antes` es texto real; el `line-through` va
  solo sobre el importe. El precio vigente **no** lleva `aria-label` inventado.
- `Badge`s: son texto, no color solo. `Oculto`, `Destacado`, `Precio propio`,
  `Con promoción`, `Vigente`, `Vencida` se leen tal cual.

**La tienda cerrada y su interruptor.**

- _Página cerrada:_ un `<h1>` con el nombre de la tienda, el aviso en un
  contenedor `role="status"` (informa, no interrumpe: nadie ha hecho nada), y el
  enlace de WhatsApp como **primer y único elemento enfocable** del contenido. La
  cabecera pierde el enlace del carrito, así que el recorrido de tabulación de esa
  página tiene una o dos paradas: es la pantalla más simple del proyecto y hay que
  dejarla así.
- El mensaje del admin se pinta con `whitespace-pre-line` y **como texto**: sin
  `dangerouslySetInnerHTML`, sin Markdown y sin autodetectar enlaces (HD14). Un
  texto de un tercero servido a cualquiera que escanee un cartel no se interpreta.
- El aviso del comprobante del pedido es `Alert tone="muted"` con `role="status"`:
  no puede interrumpir la lectura del código del pedido, que es para lo que esa
  página existe.
- _Interruptor:_ es un `<button>` que dice la acción (`Cerrar la tienda al
público`), no un `role="switch"` cuyo estado hay que deducir. Al abrirse el
  formulario, el foco va al primer `RadioCard`; `Escape` y `No cerrar` lo cancelan
  y devuelven el foco al botón que lo abrió. Los seis motivos son radios reales
  dentro de `<fieldset><legend>`, con la **frase que verá el comprador** como
  etiqueta visible: se elige leyendo el resultado, no un código.
- El botón deshabilitado por suspensión lleva `aria-describedby` al texto que
  explica por qué. Un botón gris sin motivo es un callejón sin salida.
- El estado se comunica **con texto**, nunca solo con el color del `Badge`:
  `Abierta`, `Cerrada`, `Suspendida`, `Borrador` se leen tal cual.

**Contraste y área de toque.**

- Todo el texto del panel es `text-fg`/`text-fg-muted` sobre `bg-bg`/`bg-surface`.
  Los tonos de estado no son overridables por la tienda.
- 44 px mínimos: `Button` da `min-h-11`; `TextInput` `min-h-11`; las casillas del
  listado se envuelven en un `<label>` de `h-11 w-11`; `Hacer principal` y
  `Quitar` son botones de texto con `min-h-11 px-3`; las `RadioCard` `min-h-14`.
- `Agregar imágenes` es un `<label>` con aspecto de botón envolviendo un
  `<input type="file" class="sr-only">`: **`sr-only`, no `display:none`**, para que
  siga siendo enfocable con teclado y el `<label>` lo active con `Enter`.

**Teclado.** `Enter` en cualquier campo envía **su** formulario (los formularios
están separados, así que no se puede crear una promoción desde el campo de
precio). Ningún atajo propio, ningún `tabindex` positivo, ningún diálogo modal en
toda la tanda: sin foco atrapado no hay foco que se escape.

---

## Coste de cliente

**El presupuesto no mide el panel, y está comprobado** (VE3):
`check-bundle-budget.mjs` recorre los `.html` de `.next/server/app`, y las
páginas del panel son `force-dynamic` (R9), así que no emiten `.html`. Lo que sí
lo empeoraría, y es lo que hay que vigilar en la revisión del diff:

1. **`"use client"` en `src/components/ui/`.** Prohibido. Es la única vía por la
   que el panel puede contaminar `/[slug]`.
2. **`ProductCard` o las páginas de `[slug]` ganando una directiva** al añadir el
   par de precios. El descuento es HTML y CSS: **cero bytes de JavaScript**.
3. **Una dependencia nueva** para imágenes o dinero (`browser-image-compression`,
   `dayjs`, `decimal.js` en el cliente). Ninguna.
4. **Zod en el árbol de cliente.** Las tres islas mapean `path` → español desde un
   objeto plano; no validan.

| Módulo                                      | Directiva      | Por qué la necesita, contra la regla de `AGENTS.md`                                                                                                                                                                                              | Dónde aterriza                  | Estimado (gzip)         |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ----------------------- |
| `ProductPanelForm`                          | `"use client"` | Estado (cuatro campos, y el de precio aparece y desaparece con el radio) y eventos (`onSubmit` con `fetch`, banners, errores por campo)                                                                                                          | `/admin/…/productos/*` (ƒ)      | ~3 KB                   |
| `ProductImageUploader`                      | `"use client"` | Es la única pantalla del feature con trabajo **asíncrono por elemento**: N subidas en serie, con progreso, éxito parcial y siete errores distintos. Sin estado de cliente no existe                                                              | `/admin/…/productos/*` (ƒ)      | ~3 KB                   |
| `PromotionForm`                             | `"use client"` | Estado del formulario, campos que dependen del alcance, `fetch`, banners                                                                                                                                                                         | `/admin/…/promociones/*` (ƒ)    | ~3 KB                   |
| `PromotionActions`                          | `"use client"` | `onClick` de activar/desactivar y la confirmación en línea de borrar. **Es la única isla discutible del feature**: la alternativa es un `<form method="post">` por fila y un `303`, cero JS. Si el orquestador quiere recortar, este es el sitio | `/admin/…/promociones` (ƒ)      | ~1 KB                   |
| Listados, hub, `loading`, `/sesion-cerrada` | —              | **Cero módulos de cliente**. Todo servidor                                                                                                                                                                                                       | `/admin/**`                     | 0                       |
| La vitrina con descuento                    | —              | `ProductCard`, la ficha y `OrderLinesTable` siguen siendo **server components**. El carrito y el checkout son islas que ya existen: ganan props, no bytes                                                                                        | `/[slug]`, `/[slug]/p/*` (●)    | **0**                   |
| La página cerrada (§ 8)                     | —              | **Cero módulos de cliente, y menos que el catálogo**: sin `CartBadge` no monta ni el store del carrito. Es la página más liviana de toda la aplicación, y la que más falta que lo sea: la abre alguien parado en la calle                        | `/[slug]` y sus rutas (● / ISR) | **0, y baja el número** |

**Cinco islas, cinco justificaciones, y la de las promociones señalada como
recortable.** La del interruptor no lo es: sin estado de cliente no hay
previsualización del aviso, y cerrar la tienda a ciegas es justo lo que no se
quiere en la acción más destructiva del panel. Y
en las tres grandes, el HTML de la primera respuesta ya trae los campos con sus
valores (un componente de cliente también se renderiza en el servidor): en una
conexión lenta el admin **lee** su producto antes de que llegue el JavaScript; lo
que espera es poder cambiarlo.

**Cosas que se descartaron por lo que cuestan.**

1. **Reducir la imagen en el navegador antes de subirla.** Es lo más tentador de
   toda la tanda —5 MB por 4G contada duele— y lo más caro: `canvas`, codificación,
   rotación por EXIF y un bug silencioso de calidad. Descartado en esta tanda y
   convertido en **DP7**, porque es una decisión sobre el público y no sobre la
   técnica.
2. **Barra de progreso por bytes.** `XMLHttpRequest` con `onprogress` en vez de
   `fetch`, para un dato que en la práctica salta de 0 a 100. Un contador de
   archivos cuesta cero y dice lo mismo.
3. **Arrastrar para reordenar las imágenes.** Biblioteca de _drag and drop_, o
   400 líneas propias, más un modo accesible por teclado que hay que diseñar
   aparte. `Hacer principal` resuelve el 95 % del caso real.
4. **Selector de productos con búsqueda dentro del formulario de promoción.**
   O manda 5 000 productos al navegador, o inventa un endpoint de búsqueda solo
   para eso. Se reusa el listado, que ya busca y pagina en el servidor.
5. **Vista previa del precio convertido mientras se teclea.** Exige la tasa en el
   cliente y sería una segunda implementación del precio (R16). Lo dice el
   servidor al guardar (B3).
6. **Filtrado y ordenamiento del listado en el cliente.** Todo va por URL: se
   comparte, el botón atrás funciona y no cuesta un byte.
7. **Edición masiva** (ocultar 20 productos de una vez). Fuera de la spec (E15 es
   de a uno) y multiplica los estados de error parcial. La casilla del listado
   sirve **solo** para crear una promoción.

### El transporte del formulario — recomendación, con DP2 ya contestado

**Isla de cliente con `fetch`** contra el mismo route handler de `/api/admin/` que
curlean los criterios, `content-type: application/json` para producto y
promoción, y `multipart/form-data` para la subida (que es lo único que no puede
ser JSON). Los motivos, con lo que este ciclo añade:

1. **Un solo transporte y un solo camino de escritura.** Lo que manda la pantalla
   es byte a byte lo que manda `curl`: el 403 del criterio 2, el 201 del criterio
   4 y los 400/409/503 de las imágenes se ejercitan por la misma puerta que usa
   la UI.
2. **Los errores se pintan donde importan.** Con `fetch`, el 400 llega al sitio
   que tiene el `path`, el foco y lo tecleado. Un POST nativo obliga a un `303`
   con el error en la query (datos del negocio en la URL) o en una cookie flash
   que **no se puede borrar al leerla**, porque una página de Next no puede
   escribir cookies.
3. **La subida de imágenes no tiene alternativa razonable sin JavaScript.** Un
   `<form enctype="multipart/form-data">` nativo sube y **navega**: se pierde la
   pantalla, no hay «subimos 2 de 3», y un 503 en el archivo 4 deja al admin en una
   página blanca sin saber qué se guardó. Es el argumento más fuerte de los tres.
4. **La sesión de 12 h vence a mitad del formulario** y con `fetch` es un banner,
   no una pérdida de trabajo.
5. **No cuesta presupuesto** (VE3), y la escritura sigue siendo un route handler,
   que es lo único que R5 exige.

Coste aceptado y aprobado (DP2 → sí): **sin JavaScript el panel no escribe**. Se
compensa con el `<noscript>` de cada tarjeta y con que todo lo que es lectura
—listados, datos del POS, precios efectivos, estado de las promociones— se lee sin
JavaScript. Si `sdd-architect` recomienda otra cosa, lo resuelve el orquestador;
lo único que cambia de este documento es el estado «sin JavaScript» de tres
tarjetas.

---

## Textos

Español, tuteo, frases cortas, sin signos de exclamación. Registro de negocio:
«tu tienda», «tus clientes», «Cuadre de Caja» con mayúsculas.

**Listado de tiendas**

- `Tus tiendas` · `Publicada` · `Borrador` · `Suspendida`
- `Productos` · `Promociones` · `Ver la tienda ↗` (`aria-label`: `Ver la tienda en una pestaña nueva`)
- `Todavía no tienes ninguna tienda asignada.` / `Publica un local desde Cuadre de Caja y va a aparecer aquí.`
- `Una de las tiendas de tu acceso ya no está disponible.`
- `Todavía no es visible para tus clientes. Se publica desde Cuadre de Caja.`
- `Cargando tus tiendas…`

**Hub de la tienda**

- `← Tus tiendas` · `Datos de Cuadre de Caja`
- `Nombre` · `Dirección` · `Ciudad` · `Provincia` · `Estado` · vacío: `—`
- `Esto se edita en Cuadre de Caja.` / `Aquí lo ves para saber qué está publicado: si algo está mal, corrígelo allí y se actualiza solo.`
- `{n} productos · {n} ocultos · {n} sin imagen` · `{n} vigentes · {n} programada`
- `Ninguna todavía` · `Todavía no hay productos. Los crea Cuadre de Caja al sincronizar.`
- `Colores y contacto` — `En camino.` / `Los colores de tu tienda y el texto de contacto se van a editar aquí. Todavía no: primero llega el cambio que le da a tu marca una sola dirección para todas tus sucursales.`

**Listado de productos**

- `Productos` · `Buscar por nombre` · `Buscar`
- `{n} productos` · `{n} ocultos` · `{n} con precio propio` · `{n} sin imagen` · `{n} borrados`
- `Oculto` · `Destacado` · `Precio propio` · `Con promoción` · `Borrado en Cuadre de Caja` · `Sin precio` · `No se puede pedir`
- `Elegir {producto}` (etiqueta `sr-only` de la casilla)
- `{n} productos elegidos` · `Crear promoción con estos productos` · `Quitar la selección`
- `21–40 de 48` · `Anterior` · `Siguiente`
- `Todavía no hay productos en esta tienda.` / `Los productos los crea Cuadre de Caja al sincronizar. Cuando aparezcan aquí vas a poder ponerles foto, descripción y precio online.`
- `No encontramos ningún producto con «{término}».` / `Ver todos los productos`
- `Ningún producto está oculto.` · `Ningún producto tiene precio propio.` · `Todos tus productos tienen imagen.`
- `Si vuelve a aparecer en Cuadre de Caja, vuelve aquí con todo lo que le pusiste.`
- `Cargando tus productos…`

**Editor de producto — datos del POS**

- `← Productos` · `Ver en la tienda ↗` · `Datos de Cuadre de Caja`
- `Nombre` · `Precio` · `Disponibilidad` · `Categoría` · `Última sincronización`
- `Esto se edita en Cuadre de Caja.` / `Aquí lo ves para saber contra qué estás trabajando: si el precio o el stock están mal, corrígelos allí y se actualizan solos.`
- `Cuadre de Caja borró este producto.` / `No se puede editar. Si vuelve a aparecer, lo que le pusiste sigue aquí.`
- `Tu cliente lo ve, pero no lo puede pedir mientras esté agotado.`

**Editor de producto — lo que ves en tu tienda**

- `Lo que ves en tu tienda`
- `Ahora tu cliente ve: {importe}` · `(precio propio)` · `(promoción del {n} %)` · `({importe original} al cambio de hoy)`
- `Ahora tu cliente no lo ve: está oculto.`
- `¿Se ve en tu tienda?` · `Se ve` (`Aparece en el catálogo y se puede pedir.`) · `Está oculto` (`No aparece, no se puede abrir su página y no se puede pedir.`)
- `Si alguien tiene el enlace guardado, va a ver una página de «no encontrado».`
- `Destacar este producto` — `Sale primero en tu catálogo y con la etiqueta «Destacado».`
- `Descripción` — `Si lo dejas vacío se muestra la descripción del catálogo general.` · `Del catálogo general: «{texto}»`
- `Precio en tu tienda` · `Cuadre de Caja manda {importe} {moneda}.`
- `Usar el precio de Cuadre de Caja` — `Se actualiza solo cada vez que lo cambies en el POS.`
- `Poner un precio propio` — `Cuadre de Caja deja de mandar en el precio online de este producto.`
- `Precio propio` — `Se guarda en {moneda}, la moneda que Cuadre de Caja manda hoy para este producto. Tu cliente lo ve convertido a {base} al cambio del día.`
- `Este precio propio se guardó sin moneda y hoy se entiende en {base}. Al guardar queda fijado en {base}.`
- `0 es un precio real: tu cliente va a ver «$0.00» y va a poder pedirlo. Si querías volver al precio del POS, elige la primera opción.`
- `Cuadre de Caja manda ahora {importe} {moneda}, y tu precio propio está en {otra}.` / `Revisa tu precio propio: el POS cambió la moneda de este producto.`
- `Hay una promoción activa sobre este producto: tu cliente ve {importe}.` / `Ver promociones`
- `No podemos convertir {moneda} a {base}: falta la tasa del día. Tu cliente no puede pedir este producto hasta que Cuadre de Caja mande la tasa.`
- `Guardar cambios` → `Guardando…` · `Sin guardar.`
- `Guardado. Tu cliente ve {importe}.` · `Guardado. Tu cliente no lo ve: está oculto.` · `Guardado. Se va a ver en cuanto publiques la tienda desde Cuadre de Caja.`
- `noscript`: `Para editar este producto necesitas activar JavaScript. Lo que está publicado se ve más arriba.`

**Editor de producto — imágenes**

- `Imágenes` · `Principal` · `Hacer principal` · `Quitar` · `Agregar imágenes`
- `JPG, PNG, WebP o AVIF. Hasta 5 MB cada una y 8 en total.`
- `Quitar una imagen la saca de tu tienda; el archivo se queda guardado en el almacenamiento.`
- `Del catálogo general` / `Todavía no subiste fotos. Se muestra la imagen del catálogo general; en cuanto subas una tuya, manda la tuya.`
- `Tu producto se ve con un recuadro gris. Una foto propia es lo que más cambia si tus clientes compran o no.`
- `Subiendo {n} de {total}…` · `Subiendo…` · `Lista` · `«{archivo}» lista.`
- `Subimos {n} imágenes.` · `Subimos 1 imagen.` · `Subimos {n} de {total} imágenes.`
- `Elegir de nuevo «{archivo}»`
- `{archivo} — Ese archivo no es una imagen. Solo JPG, PNG, WebP o AVIF.`
- `{archivo} — El archivo dice ser una imagen pero no lo es.`
- `{archivo} — Pesa {n} MB y el máximo es 5 MB. Manda una foto más pequeña.`
- `Ya tienes 8 imágenes, que es el máximo. Quita alguna para agregar otra.`
- `No pudimos guardar la imagen: el almacenamiento no está disponible.` / `No se subió nada y tu producto no cambió. Vuelve a intentar en unos minutos; si sigue igual, avísale a soporte.`
- `Se cortó la conexión. Subimos {n} de {total} imágenes.`
- `¿Quitar esta imagen?` · `Sí, quitar` · `No` · `Quitamos la imagen de tu producto.`
- `Ahora la principal es «{archivo}».` · `No se puede mostrar`
- `alt` de miniatura: `{producto}, imagen {n} de {total}`
- `noscript`: `Para subir imágenes necesitas activar JavaScript.`

**Promociones — listado**

- `Promociones` · `Nueva promoción`
- `Si dos promociones caen sobre el mismo producto, se aplica solo la que deje el precio más bajo. Nunca se suman.`
- Rótulos derivados: `{n} % en {n} productos` · `{n} % en {categoría}` · `−{importe} en todo el pedido` · `−{importe} en pedidos de más de {importe}`
- `Vigente` · `Programada` · `Vencida` · `Inactiva` · `No aplica a nada`
- `Desde el {fecha} · Sin fecha de fin` · `Del {fecha} al {fecha}` · `Empieza el {fecha}.`
- `Cuando llegue la hora puede tardar hasta una hora en verse en tu tienda.`
- `No se está aplicando.` · `Los productos que elegiste ya no están o están ocultos.`
- `Comparte productos con «{otra}»: en esos, gana el precio más bajo.`
- `Editar` · `Activar` · `Desactivar` · `Borrar`
- `Promoción activada. Tu tienda ya la aplica.` · `Promoción desactivada. Tu tienda vuelve a los precios de siempre.`
- `¿Borrar esta promoción?` / `Los pedidos que ya se hicieron no cambian.` · `Sí, borrar` · `No` · `Promoción borrada.`
- `Ya no tienes permiso sobre esta promoción.`
- `Todavía no tienes promociones.` / `Una promoción baja el precio de unos productos, de una categoría o de todo el pedido, durante el tiempo que tú digas.`
- `Cargando tus promociones…`

**Promociones — formulario**

- `Nueva promoción` · `Editar promoción` · `← Promociones`
- `Nombre para ti` — `Solo lo ves tú; tus clientes no.`
- `Tipo de descuento` · `Porcentaje` (`Baja un % del precio.`) · `Monto fijo` (`Baja una cantidad fija.`)
- `Cuánto` — `Entre 0 y 100. Ej.: 20 para un 20 % de descuento.` / `El monto se entiende en {base}, la moneda base de tu negocio, y se convierte al cambio del día para los productos en otra moneda.`
- `¿A qué se le aplica?` · `Productos elegidos` · `Una categoría` · `Todo el pedido`
- `Todavía no elegiste ningún producto.` · `Elegir productos` · `Elegir otros productos` · `Puedes elegir hasta 20 productos por promoción.`
- `Se aplica a todos los productos de esa categoría, también a los que lleguen después.`
- `Mínimo de compra` — `Si lo dejas vacío, se aplica a cualquier pedido.`
- `Empieza` · `Termina` — `La hora es la de este dispositivo.` / `Si dejas «Termina» vacío, la promoción sigue hasta que la desactives.`
- `Activar ahora` — `Puedes desactivarla en cualquier momento sin borrarla.`
- `Los cambios se ven en tu tienda enseguida. Cuando una promoción empieza o termina por su fecha, puede tardar hasta una hora en reflejarse.`
- `En algunos productos el descuento es mayor que el precio: esos van a costar $0.00, nunca menos.`
- `Crear promoción` · `Guardar cambios` → `Guardando…`
- `Promoción creada. Tu tienda ya la aplica.` · `Promoción creada, empieza el {fecha}.` · `Promoción creada, pero está desactivada. Actívala cuando quieras que se aplique.`
- `Esta promoción ya terminó. Si cambias la fecha de fin, vuelve a aplicarse.`
- `Uno de los productos elegidos no es de esta tienda.` / `Volver a elegir`
- `Elegiste {n} productos y el máximo por promoción es 20.`

**Vitrina (lo que ve el comprador)**

- `Antes {importe}` (la palabra escrita; el `line-through` solo sobre el importe)
- `Promoción: {n} % de descuento.` · `Promoción: {importe} de descuento.`
- `Descuento` (fila del resumen del checkout y del comprobante)

**Tienda cerrada — lo que ve el comprador** (§ 8)

- `<title>`: `{tienda} · No disponible ahora` · `<h1>`: `{tienda}`
- Motivos de la lista fija, literales:
  - `Estamos realizando adecuaciones en la tienda.`
  - `Tienda temporalmente fuera de servicio.`
  - `Estamos reponiendo el inventario. Volvemos en cuanto tengamos productos.`
  - `Cerrado por vacaciones. Volvemos pronto.`
  - `Por ahora atendemos solo en el local, no por internet.`
- Sin motivo, según quién cerró:
  - POS (HD15): `Esta tienda no está tomando pedidos por ahora.`
  - Nunca abierta (HD12): `Esta tienda todavía no está tomando pedidos por internet.`
  - Suspendida por la plataforma: `Esta tienda no está disponible en este momento.`
- `Escribir por WhatsApp` — mensaje ya escrito, antes de URL-encodear:
  `Hola {tienda}, vi su tienda online. ¿Cuándo vuelven a tomar pedidos?`
- `Dirección: {dirección}`
- `Esta página se actualiza sola cuando la tienda vuelva a abrir.`
- En `/carrito` y `/checkout`, una línea más: `Si tenías productos en el carrito, siguen guardados en este teléfono: cuando la tienda vuelva a abrir los vas a encontrar ahí.`
- En la página de un pedido: `Esta tienda cerró sus pedidos online por ahora.` / `Este pedido ya lo tiene la tienda. Si necesitas hablar con ellos, aquí abajo están sus datos.`
- Si el pedido se intenta confirmar con la tienda cerrada (B8): `Esta tienda dejó de tomar pedidos.` + la frase del motivo + `No se creó ningún pedido.`

**Tienda cerrada — el interruptor del panel** (§ 9)

- `Tu tienda al público` · `Abierta` · `Cerrada` · `Suspendida` · `Borrador`
- Abierta: `Tus clientes pueden ver el catálogo y hacer pedidos.` · `Ver la tienda ↗` · `Cerrar la tienda al público`
- Cerrada: `La cerraste tú el {fecha}.` · `La cerró Cuadre de Caja el {fecha}.` · `Nunca la abriste al público.` · `Cuando abras, tus clientes van a poder ver el catálogo y pedir.`
- `Si no fuiste tú, alguien la desactivó en Cuadre de Caja.` / `Puedes volver a abrirla desde aquí; manda la última acción, venga de donde venga.`
- `Abrir la tienda al público` · `Cambiar el motivo`
- `¿Por qué la cierras?` · `Otro motivo` · `Mensaje para tus clientes (opcional)` — `Una línea, en tus palabras. Se muestra tal como la escribas.`
- Consecuencias, en este orden: `Tus clientes van a ver el mensaje que elijas, no tu catálogo.` / `Nadie va a poder hacer pedidos nuevos.` / `Los pedidos que ya te hicieron no se cancelan, y los sigues recibiendo en Cuadre de Caja.` / `Puedes volver a abrirla en cualquier momento desde aquí.`
- `Sí, cerrar la tienda` · `No cerrar` → `Cerrando…`
- `Así se ve el aviso. La cabecera con los colores de tu tienda no se muestra aquí.`
- `Tu tienda está cerrada al público.` / `Tus clientes ven el aviso que elegiste.` / `Ver cómo la ve tu cliente ↗`
- `Tu tienda está abierta. Tus clientes ya pueden pedir.`
- `Escribe el mensaje que van a leer tus clientes.` · `El mensaje no puede pasar de 140 caracteres.` · `Ese motivo no está en la lista. Recarga la página y vuelve a elegir.`
- `Esta tienda está suspendida por queandabuscando. Esto no se resuelve desde aquí: escribe a soporte.`
- `Esta tienda todavía no está publicada. Se publica desde Cuadre de Caja; después vas a poder abrirla y cerrarla desde aquí.`
- `Ya no tienes permiso para abrir o cerrar esta tienda.`
- `noscript`: `Para abrir o cerrar tu tienda necesitas activar JavaScript.`
- Listado, primer día: `Tus tiendas están cerradas al público.` / `Revisa que el catálogo, las fotos y los precios estén como quieres, y ábrelas cuando estés listo.`

**Banners comunes de todo el panel**

- 400: `No se guardó nada. Revisa {n} dato(s).`
- 401: `Tu sesión se cerró.` / `Vuelve a entrar desde Cuadre de Caja y guarda otra vez. No perdimos lo que escribiste.` / `Volver a entrar`
- 403: `Ya no tienes permiso para editar esto.` / `Pide el acceso en Cuadre de Caja.`
- 404: `Esto ya no existe.` / `Volver`
- 500: `No pudimos guardar.` / `No se cambió nada. Vuelve a intentar en un momento.` / `Reintentar`
- Red: `Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.` / `Reintentar`

**`/sesion-cerrada`**

- `Tu sesión se cerró` / `Por seguridad, la sesión del panel dura 12 horas.` / `Entra otra vez desde Cuadre de Caja, con el botón «Ir a mi tienda online».` / `Ir al inicio`

---

## Verificación

`VE1`–`VE14` **están ejecutados** en los dos ciclos, con su resultado en § Qué se
miró. `V1`–`V7` no necesitan navegador. `V8`–`V22` **no se ejecutaron**: las
pantallas no existen y, además, **este entorno no puede cambiar el tamaño de la
ventana** (probado cuatro veces, dos ventanas distintas, los dos ciclos). Los
pasos de 360 y 768 px hay que meterlos en el plan como paso propio, con alguien
que tenga una ventana que obedezca.

**Fixtures que hacen falta antes de correr nada de esto** (son de implementación,
no de producto, y salen de lo que vi en la base):

- Una bandera en `scripts/mint-sso-token.mjs` para firmar **una sola** tienda: hoy
  firma las dos del seed (`:27`) y sin eso no hay «tienda ajena» contra la que
  probar el 403 (I7 de la spec).
- **Ninguna promoción en el seed** (VE12): hace falta al menos una vigente sobre
  `seed-tienda-1-p0`, una programada y una vencida, o `V13`–`V16` no tienen nada
  que mirar.
- **Ningún producto tiene imagen** y ningún canónico tampoco (VE13): el estado
  «sin nada» del cargador es el que se ve por defecto; para probar el estado «del
  catálogo general» hay que sembrar un `CanonicalProduct.imageUrl`.

**Sin navegador** (con `npm run dev`, cookie de `mint-sso-token.mjs`, `curl -b`)

- **V1** — `curl -s -b cookie /admin` contiene `tienda-demo` y **no**
  `tienda-dos` con el token de una sola tienda (criterio 1).
- **V2** — `curl -s -b cookie <hub>` contiene `Datos de Cuadre de Caja` y
  `Esto se edita en Cuadre de Caja.`, y **no** contiene `Publicar` ni
  `Despublicar` (HD2). Contiene también `Colores y contacto` y `En camino.`
  (HD6 visible, no un hueco silencioso).
- **V3** — `curl -s -b cookie <listado de productos>` trae el nombre de un
  producto oculto y su `Badge` `Oculto` (E14: el panel ve lo que la vitrina no).
- **V4** — `curl -s -b cookie "<listado>?q=arrz"` trae
  `No encontramos ningún producto con «arrz».`
- **V5** — `curl -s -b cookie <editor de un producto de otra tienda> -o /dev/null -w '%{http_code}'`
  → `404`, y el cuerpo no trae su nombre (R7, criterio 6). El `PATCH` del mismo
  producto → `403` con `{"error":"FORBIDDEN"}` (E19), y sin cookie → `401`.
- **V6** — Con una promoción del 20 % vigente sobre un producto de `500`:
  `curl -s /tienda-demo | grep -c 'Antes'` ≥ 1 y el HTML trae `$400.00` (P4, E27).
  Y `curl -s /tienda-demo | grep -c '_next/static/chunks'` **igual** que antes de
  la promoción: el descuento no añadió ni un módulo de cliente.
- **V7** — `grep -rn "use client" src/components/ui/` vacío;
  `grep -rn "features/admin" src/app/\[slug\] src/components/store` vacío;
  `npm run build && npm run check:bundle && npm run check:theme` en 0 (criterios
  13 y 15); `find .next/server/app -name '*.html' | grep -c admin` → `0`.

**Con navegador**

- **V8** — 360 px, listado de productos con 40 productos: sin scroll horizontal;
  la fila cabe en dos líneas; casilla, nombre y precio no se solapan; la casilla
  mide ≥ 44 px.
- **V9** — 360 px, editor de producto: al marcar `Poner un precio propio` el campo
  aparece **debajo** del radio y nada de arriba se mueve; con el teclado abierto
  sobre el importe, la moneda sigue visible al lado.
- **V10** — 360 px, imágenes: cuadrícula de dos columnas; `Hacer principal` y
  `Quitar` miden ≥ 44 px y no se tocan entre sí.
- **V11** — 768 px: `<dl>` a dos columnas, radios de tipo en fila, fechas en fila.
- **V12** — 1280 px: editor a dos columnas con la tarjeta de imágenes `sticky` a la
  derecha, acompañando el scroll sin salirse de su tarjeta.
- **V13** — Precio: poner `1.10` en un producto en USD y guardar → banner
  `Guardado. Tu cliente ve $484.00.`; abrir la ficha pública en otra pestaña y ver
  `$484.00` **sin esperar el piso de ISR** (R10). Volver a `Usar el precio de
Cuadre de Caja`, guardar, y ver `$528.00` otra vez (criterio 8).
- **V14** — Precio 0: se guarda, la vitrina muestra `$0.00` y el producto se puede
  pedir (E17). El aviso amarillo aparece antes de guardar.
- **V15** — Sync encima del panel: fijar los cinco campos, correr
  `node scripts/send-catalog-batch.mjs`, recargar el editor: la tarjeta 4a trae el
  precio nuevo y las cinco cosas del panel **intactas** (criterio 3, E16).
- **V16** — Imágenes: subir tres JPEG de golpe → `Subiendo 1 de 3…` visible, las
  miniaturas apareciendo de a una, banner `Subimos 3 imágenes.`; la primera con
  `Principal`; la ficha pública trae `src` con `/_next/image?url=` y esa URL
  responde 200 con `image/avif` o `image/webp` (criterio 4, E21).
- **V17** — Imágenes, errores: un PDF renombrado a `.jpg`, uno de 6 MB y una
  novena imagen → los tres mensajes exactos de § 4c, y `SELECT "imageUrls"` sin
  cambios (E22, E23, criterio 10). Parar el contenedor de Storage y subir → el
  banner de 503 y `imageUrls` sin cambios (E25, criterio 11).
- **V18** — Imágenes, quitar: quitar la primera de dos → la segunda queda
  `Principal`, la vitrina usa esa (E26), y el objeto **sigue** en el bucket (R22).
- **V19** — Promociones: crear un 20 % sobre un producto → la tarjeta y la ficha
  muestran `Antes $500.00` y `$400.00`; el carrito muestra el par por línea; el
  checkout cuadra `subtotal − descuento + envío` con una promoción `ORDER` de
  mínimo (E32); confirmar el pedido y comprobar que `OrderItem.unitPrice` es el
  precio con descuento (E28, P8). Y en **modo oscuro**, mirar el `line-through`
  sobre `text-fg-muted` y los `Badge` `warning`.
- **V20** — Promociones, validación: `120 %`, monto `0`, fin anterior al inicio y
  alcance de productos vacío → los cuatro mensajes de § 6, y ninguna fila creada
  (P2, P3).
- **V21** — Solo teclado, del listado de productos a `Crear promoción`: foco
  visible en todo, los radios con flechas, las confirmaciones se cancelan con
  `Escape` y el foco vuelve al botón que las abrió.
- **V22** — Lector de pantalla (VoiceOver): la casilla de una fila se anuncia con
  el nombre del producto; `Subiendo 2 de 3…` se oye una vez por archivo; el error
  de un archivo interrumpe; el par de precios se oye como `Antes 500 pesos`
  (nunca un tachado mudo). Y con JavaScript desactivado: los tres listados y las
  dos pantallas de edición **se leen enteros**, con sus tres `<noscript>`.

**Tienda cerrada al público** (HD10–HD15). `V23`–`V27` no necesitan navegador.

- **V23** — **Cerrar desde el panel, no con SQL** (VE16: un `UPDATE` a mano no
  cambia la página, manda la caché con el tag `store:<slug>`). Con la tienda
  cerrada desde el interruptor:
  `curl -s -o /dev/null -w '%{http_code}' /tienda-demo` → **200** (no 404), y el
  cuerpo contiene el nombre de la tienda y la frase del
  motivo. Lo mismo en `/tienda-demo/p/arroz-blanco-1-kg`, `/tienda-demo/carrito` y
  `/tienda-demo/checkout`.
- **V24** — El mismo HTML **no** contiene ningún nombre de producto, ningún
  importe, ni la palabra `Carrito` (HD11: sin catálogo, sin precios, sin carrito).
  Y `grep -c '_next/static/chunks'` da **menos** módulos que con la tienda abierta.
- **V25** — `curl -s /tienda-demo | grep -i 'noindex'` → sale, mientras esté
  cerrada; con la tienda abierta, **no** sale.
- **V26** — Con un pedido ya creado: `curl -s /tienda-demo/pedido/<code>` responde
  **200**, trae el código, los importes y `wa.me` si la tienda es `WHATSAPP`, más
  el aviso de tienda cerrada (HD11).
- **V27** — `POST /api/orders/quote` y `POST /api/orders` sobre la tienda cerrada
  responden el código de B8 y **ninguna fila de `Order` se crea**. Y un mensaje de
  cierre con `<b>hola</b>` sale en el HTML **escapado**, nunca como etiqueta
  (HD14): `curl -s /tienda-demo | grep -c '&lt;b&gt;'` ≥ 1.
- **V28** — 360 px: la página cerrada se lee entera sin scroll; el botón de
  WhatsApp mide ≥ 44 px y va a todo el ancho.
- **V29** — Panel: cerrar la tienda eligiendo `Estamos realizando adecuaciones` y
  un mensaje propio → banner de éxito, y `/tienda-demo` muestra las dos frases
  **sin esperar el piso de ISR** (R10, B10). Volver a abrir → el catálogo vuelve.
- **V30** — Panel: `Otro motivo` sin mensaje → error bajo el `TextArea` y **nada
  se cierra** (comprobar con `curl` que la tienda sigue abierta).
- **V31** — HD15: cerrar desde el POS con `publishToStore: false`
  (`node scripts/send-catalog-batch.mjs` o el evento `STORE` equivalente) → el hub
  dice `La cerró Cuadre de Caja el …` y el botón de abrir **funciona** (HD13: gana
  el último).
- **V32** — HD12: tras la migración, `/admin` muestra el aviso del primer día y
  las dos tiendas del seed salen con `Badge` `Cerrada` y
  `Nunca la abriste al público.`; `/tienda-demo` responde 200 con
  `Esta tienda todavía no está tomando pedidos por internet.`

**Un aviso sobre el criterio 7 propuesto en la spec.** Decía que un `grep` de
`status` y `publishedAt` en el módulo de escritura del panel no debía encontrar
ninguna de las dos columnas (HD2). Con **HD10** eso ya no puede cumplirse tal cual
si el estado de apertura vive en `status`: el panel **tiene** que escribirlo. Lo
que sigue siendo cierto y hay que verificar es la otra mitad: **el panel nunca
escribe `publishedAt`**, y **nunca publica una tienda que está en `DRAFT`**. Es
propuesta de la spec y no uno de los cinco criterios firmados, así que se ajusta
sin tocar `features.json`; queda dicho para que nadie lo dé por roto.

---

## Respuestas del humano

Las cinco del ciclo 1, cerradas y aplicadas:

- **DP1 → no.** La tanda 1b se cae: descripción y contacto de la tienda quedan en
  lectura. Sin columnas de override, sin migración, sin ADR 0017 por esa vía.
  Aplicado: la tarjeta «Texto y contacto» está en § Congelado y **no se
  construye**; el hub solo la nombra dentro de «Colores y contacto · En camino».
- **DP2 → sí.** El panel puede exigir JavaScript para escribir, con el
  `<noscript>` de cada tarjeta. Aplicado en § Coste de cliente y en los tres
  estados «sin JavaScript».
- **DP3 → sí**, las seis paletas con esos nombres. Queda en § Congelado hasta que
  el branding se descongele; los valores van a `src/constants/` cuando llegue.
- **DP4 → (a).** Se puede guardar un branding ilegible; el aviso es la maqueta.
  Sin validación de contraste en el servidor. Deuda anotada.
- **DP5 → (a).** Siempre el listado, sin redirección con una sola tienda.
  Aplicado en § 1.

Las tres del ciclo 2, cerradas y aplicadas:

- **DP6 → sí.** `Promotion.name` se añade como columna opcional con su migración.
  Aplicado: en el listado de promociones el rótulo es **el nombre que escribió el
  admin** y el derivado (`20 % en 3 productos`) pasa a la segunda línea; en el
  formulario, `Nombre para ti` con ayuda `Solo lo ves tú; tus clientes no.` El
  rótulo derivado no se borra del diseño: es el respaldo cuando el nombre está
  vacío.
- **DP7 → no.** La foto no se reduce en el navegador en esta tanda. Aplicado: el
  cargador sube el archivo tal cual, con el límite de 5 MB y el texto
  `Manda una foto más pequeña.` Queda como feature propio con su criterio medible.
- **DP8 → no.** El comprobante no dice cuánto ahorró. Aplicado: muestra lo
  cobrado, y la fila `Descuento` **solo** cuando la promoción era de alcance
  `ORDER` (`Order.discountTotal`, que ya existe). Sin columnas nuevas en
  `OrderItem` y sin conversación de contrato con cuadrecaja.

Y las seis decisiones del ciclo 3 (HD10–HD15) están aplicadas en § 8, § 9 y en
los ajustes de § 1, § 2, § Componentes, § Tokens, § Accesibilidad, § Coste de
cliente, § Textos y § Verificación. **HD2 queda superada solo en su mitad**: el
panel abre y cierra al público, y **no** publica por primera vez.

## Preguntas al humano

Tres nuevas, del alcance de HD10–HD15. Bloquean la firma del plan.

**DP9 — ¿Se aprueban los seis motivos y sus frases literales?** Son las que va a
leer el comprador, y las escribí yo salvo las dos primeras, que son las del
humano:

1. `Estamos realizando adecuaciones en la tienda.`
2. `Tienda temporalmente fuera de servicio.`
3. `Estamos reponiendo el inventario. Volvemos en cuanto tengamos productos.`
4. `Cerrado por vacaciones. Volvemos pronto.`
5. `Por ahora atendemos solo en el local, no por internet.`
6. `Otro motivo` (obliga a escribir el mensaje)

- (a) **Las seis, literales.**
- (b) Cambiar o quitar alguna, o añadir otra.
- **Recomendación: (a).** Cubren lo que de verdad cierra una tienda de barrio, y
  las cinco primeras dejan al comprador con una idea de cuándo volver. Cambiarlas
  después es editar una constante y arregla todas las tiendas a la vez, porque en
  la base se guarda el código y no la frase.

**DP10 — ¿Qué ve el comprador cuando la tienda está suspendida por la
plataforma?** No es lo mismo que un cierre del negocio: es un problema entre
queandabuscando y el negocio (impago, incumplimiento).

- (a) **La misma página cerrada, con un texto neutro** que no explica nada:
  `Esta tienda no está disponible en este momento.`
- (b) 404, como hoy.
- **Recomendación: (a).** El QR sigue pegado en la pared y el comprador no tiene
  culpa de nada; y un 404 hace que el negocio parezca inexistente en vez de
  pausado. Con (a), además, el admin ve en su panel el botón deshabilitado y el
  «escribe a soporte», que es la única acción útil que le queda.

**DP11 — ¿La página cerrada ofrece el WhatsApp de la tienda?**

- (a) **Sí, si la tienda tiene número** (`whatsapp ?? phone`), como enlace-botón
  con un mensaje ya escrito y neutro. Si no tiene, no se ofrece nada.
- (b) No: la tienda está cerrada y no se le manda tráfico a un canal que quizá
  tampoco esté atendido.
- **Recomendación: (a).** Es la única cosa útil que se le puede ofrecer a alguien
  parado frente a un cartel, y el negocio ya publicó ese número para recibir
  pedidos por ahí (es el mismo que usa el atajo de F-010). El riesgo de (b) es
  peor: una pantalla sin salida.

---

# Congelado — diseñado y esperando a `Storefront`

**No borrar.** Todo lo que sigue es diseño terminado del ciclo 1 que **no se
construye ahora**:

- **Por HD6** (ADR 0012): el editor de branding. `Storefront` va a poseer slug,
  branding y contacto, así que las cinco propiedades se van a editar contra la
  **marca**, no contra la sucursal. La forma de las pantallas se sostiene; lo que
  cambia es de qué fila salen los valores y en qué URL vive el editor.
- **Por DP1 → no**: la tarjeta de texto y contacto de la tienda, con sus cuatro
  columnas de override.

**Y un aviso sobre HD2 dentro de este bloque:** el texto congelado dice, en la
tarjeta 2a y en su microcopy, que publicar y despublicar se hace en Cuadre de
Caja. Con **HD10** eso es cierto solo a medias: **abrir y cerrar al público es
ahora del panel** (§ 9) y solo **publicar por primera vez** sigue siendo del POS.
Cuando esto se descongele, esa nota se reescribe con la redacción de § 2.

**Qué hay que releer el día que se descongele**, además de lo de abajo:

1. **La URL y el dueño.** El editor pasa a ser de la marca:
   `/admin/marcas/<storefront>` o equivalente. El listado de `/admin` cambia de
   «tus tiendas» a «tu marca y tus sucursales», y eso **sí** es rediseño, no
   ajuste.
2. **La maqueta.** Sigue valiendo entera, pero la barra superior de la vitrina con
   varias sucursales lleva selector (ADR 0012), y eso hay que verlo en la
   previsualización o el admin va a ver una maqueta que no existe.
3. **VE6 sigue siendo cierto**: hay valores `oklch(...)` guardados y un
   `<input type="color">` no los representa. El control de color con campo de
   texto **con** `name` y selector **sin** `name` es la respuesta a eso y no
   caduca.
4. **DP3 → sí** (las seis paletas con esos nombres) y **DP4 → (a)** (se puede
   guardar ilegible, avisa la maqueta) ya están contestadas: no hay que volver a
   preguntarlas.
5. **La tanda 1b está cancelada, no aplazada.** Si alguien la reabre, es un
   feature nuevo con la ADR de propiedad de campos por delante: I1 de la spec
   explica por qué no basta «la última escritura gana».

Lo que sigue es el texto del ciclo 1, tal cual, salvo esta advertencia.

## Editor de tienda del ciclo 1 — congelado, salvo la tarjeta 2a

Cabecera de la pantalla: enlace `← Tus tiendas`, `<h1>` con el nombre de la
tienda y, debajo, `text-fg-muted text-sm` con la URL pública
(`queandabuscando.com/tienda-demo`) enlazada si está publicada.

Luego **tres tarjetas** en este orden, que es el orden de la pregunta que el
admin trae: «¿qué hay publicado?» → «¿cómo se ve?» → «¿qué dice?».

### 2a · Card «Datos de Cuadre de Caja» — lectura (E2)

> **Esta tarjeta NO está congelada.** Es la que se construye ahora, en el hub de
> la tienda (§ Inventario § 2) y, con los campos del producto, en el editor de
> producto (§ 4a). Se conserva aquí porque su diseño se escribió en este sitio.

`<h2>Datos de Cuadre de Caja</h2>` y un `<dl>` con cinco filas: `Nombre`,
`Dirección`, `Ciudad`, `Provincia`, `Estado`. El estado va como `Badge`, igual que
en el listado.

**Los datos de lectura son texto, no campos deshabilitados.** Un `<input
disabled>` gris parece un formulario roto o un permiso que se te olvidó pedir;
una lista de definiciones parece lo que es: información. Es la respuesta concreta
a «cómo se comunica que no se puede editar sin que parezca un error».

Cierra la tarjeta un `Alert tone="muted"` con dos frases:

> `Esto se edita en Cuadre de Caja.` `Aquí lo ves para saber qué está publicado:
si algo está mal, corrígelo allí y se actualiza solo.`

Y, cuando el estado no es `Publicada`, una segunda línea que depende del estado:

- `Borrador` → `Tu tienda todavía no es visible para tus clientes. Publícala desde Cuadre de Caja.`
- `Suspendida` → `Tu tienda está suspendida y no es visible para tus clientes. Eso se resuelve en Cuadre de Caja.`

Ninguna de las dos es un error: `tone="warning"` en `Borrador` (hay algo que
hacer, y no está aquí) y `tone="danger"` en `Suspendida`. **Ni un control de
publicar en ningún estado** (HD2).

| Estado                             | Qué se ve                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Campo nulo (`province`, `address`) | `—` en `text-fg-muted`, no una fila que desaparece: que el POS no lo mandó también es información                       |
| `Borrador`                         | La tarjeta entera igual, más la línea de arriba, y **el resto de la pantalla funciona**: se puede vestir antes de abrir |

### 2b · Card «Colores y forma» — el branding (E6, E7, E8)

> **Congelada por HD6.** Espera a `Storefront` (ADR 0012). Con ella espera el
> criterio 5 de `features.json`.

Es la pantalla con más decisiones. Cuatro bloques, en este orden vertical:

**(i) Previsualización.** Una maqueta de la vitrina del comprador, con los
valores **que hay ahora en el formulario** (no los guardados):

- Barra superior `bg-brand text-brand-contrast` con el nombre real de la tienda,
  igual que `src/app/[slug]/layout.tsx:32`.
- Dos tarjetas de producto en miniatura, con nombres reales de dos productos de
  la tienda si los hay (`Café molido 250 g`) o dos genéricos si no
  (`Producto de ejemplo`), su precio en `text-brand` —así se pinta hoy,
  `ProductCard.tsx:57`— y **la primera con la cinta `Destacado`**
  (`bg-accent text-accent-contrast`), que es el único sitio donde `accent` se ve
  (VE5). Sin `accent` en la maqueta, dos de los cinco tokens se editarían a ciegas.
- Un rectángulo con el aspecto del botón `Agregar al carrito`
  (`bg-brand text-brand-contrast`, `rounded-md`, `min-h-12`), que es donde el
  comprador mira. **Es un `<span>`, no un `<button>`**: nada de la maqueta entra
  en el orden de tabulación ni promete ser pulsable.
- Debajo, en `text-fg-muted text-xs`, el resumen en texto de lo elegido:
  `Color principal #0f62fe · Texto sobre el principal: claro · Esquinas suaves`.

Cómo se aplica el color sin romper nada de F-016: el contenedor de la maqueta
lleva las **propiedades personalizadas en su `style`**
(`--color-brand`, `--color-brand-contrast`, `--color-accent`,
`--color-accent-contrast`, `--radius-sm|md|lg`), calculadas por la misma función
pura que usa `renderStoreTheme` (A4). Las utilidades de dentro siguen siendo
`bg-brand`, `text-brand`, `rounded-md`, `rounded-lg` — **nunca**
`rounded-[--radius-lg]`, que es la sintaxis v3 que `check:theme` persigue. Las
propiedades personalizadas heredan, así que no hace falta ni un `<style>` ni un
`data-store`: **la maqueta no debe emitir una regla `[data-store="slug"]`**, o
pelearía con la de la tienda real si alguien copia el patrón.

Consecuencia buscada de que sea una isla: la maqueta **se renderiza también en el
servidor** (un componente de cliente se renderiza en el servidor), así que el
HTML de la primera carga ya trae la previsualización de lo guardado, sin esperar
JavaScript. Lo que llega con la hidratación es que **cambie** al mover un control.

**(ii) Paletas.** Seis atajos (`Button variant="secondary"`, `type="button"`,
chips en fila que envuelve) que rellenan los cuatro colores de una vez:
`Azul` · `Verde` · `Naranja` · `Vino` · `Turquesa` · `Grafito`. Cada chip lleva
dos muestras de color y su nombre. Encima, el rótulo
`Empieza por una paleta y ajusta después.` Los valores exactos de las seis salen
a `src/constants/` (AGENTS.md prohíbe números y cadenas mágicas) y **son
hexadecimales**, que es lo que un dueño de negocio reconoce.

Los chips **no** son un campo del formulario: no tienen `name` y no se envían.
Solo escriben en los cuatro controles de abajo, que son la única fuente de lo que
se guarda. Así no hay un séptimo valor que validar ni una clave fuera del esquema
(R12).

**(iii) Los cuatro colores.** Dos `Field` para el par principal y dos para el par
de acento, cada uno con el mismo control compuesto:

- Un `<input type="text">` con `name` (`brand`, `brandContrast`, `accent`,
  `accentContrast`), que es **el valor que se guarda**. Ayuda:
  `Un color CSS: #0f62fe, oklch(0.62 0.17 145) o un nombre como teal.`
- A su lado, un `<input type="color">` **sin `name`**, `h-11 w-14`, que solo
  escribe en el campo de texto. Sin `name` por VE6: la base tiene hoy valores
  `oklch(...)` que un selector de color no sabe representar, y si se enviara
  mandaría `#000000` y pintaría de negro la tienda de alguien sin que lo pidiera.
  El selector es una **ayuda de entrada**, no el dato.
- Cuando el valor del texto no es un `#rrggbb`, el selector se queda en su valor
  por defecto y debajo aparece, en `text-fg-muted text-xs`:
  `El selector solo entiende colores en formato #rrggbb. Tu color se guarda tal como está escrito.`

Los dos «contraste» no se llaman contraste en pantalla. Etiquetas:

- `Color principal` / `Texto sobre el color principal`
- `Color de acento` / `Texto sobre el color de acento`

Y el de texto, además del par texto+selector, trae dos atajos
`Claro` / `Oscuro` que escriben los dos valores de `src/constants/`. Nueve de
cada diez veces la respuesta correcta es una de esas dos.

**(iv) Esquinas.** Un `<fieldset>` con `<legend>Esquinas</legend>` y tres
`RadioCard` (`name="radius"`): `Rectas` · `Suaves` · `Muy redondeadas`, con
`value` `sharp` · `soft` · `round`. Cada tarjeta lleva una muestra cuadrada de
40 px con `rounded-lg` **dentro de su propia escala inline**, así que la tarjeta
enseña la forma que promete. Cuarta opción: `Las de siempre`, que deja `radius`
sin enviar (equivalente a no tener la clave).

**Acciones de la tarjeta**, en este orden en el DOM:
`Button` primario `Guardar branding` · `Button variant="ghost"`
`Quitar el branding`.

| Estado                                 | Qué se ve                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal, con branding guardado**      | Los cuatro campos con su valor, el radio marcado, la maqueta pintada. Ningún banner                                                                                                                                                                                                                        |
| **Normal, sin branding** (`null`/`{}`) | Campos vacíos, `Las de siempre` marcado, la maqueta con la paleta por defecto de `tokens.css`, y arriba `Alert tone="muted"`: `Tu tienda usa la paleta por defecto. Elige una paleta para que se parezca a tu negocio.`                                                                                    |
| **Antes de hidratar**                  | Todo visible y legible: la maqueta con lo guardado, los campos con sus valores, los radios operables (son HTML). Lo único que no funciona son los chips de paleta, los atajos `Claro`/`Oscuro`, el selector de color y el guardado                                                                         |
| **Sin JavaScript**                     | Un `<noscript>` dentro de la tarjeta, `Alert tone="warning"`: `Para editar los colores necesitas activar JavaScript. Lo que ya está guardado se ve más arriba.` (DP2)                                                                                                                                      |
| **Editando** (algo cambió sin guardar) | La maqueta ya cambió; junto al botón, `text-fg-muted text-sm`: `Sin guardar.` El botón no se deshabilita nunca por «no hay cambios»: comparar estados para deshabilitar un botón es la clase de listeza que falla                                                                                          |
| **Guardando**                          | Botón `disabled`, texto `Guardando…`, `aria-busy="true"`; el `<fieldset>` de los controles deshabilitado. Segundo clic imposible                                                                                                                                                                           |
| **Guardado (200, E6/E9)**              | `Alert tone="positive"` sobre el formulario: `Branding guardado.` + `Tus clientes ya lo ven en tu tienda.` y, si está publicada, el enlace `Ver la tienda ↗`. **Se queda ahí hasta el siguiente guardado**: nada de un toast que se pierda. Desaparece la línea `Sin guardar.`                             |
| **Guardado en tienda no publicada**    | Igual, pero el segundo texto es: `Se va a ver en cuanto publiques la tienda desde Cuadre de Caja.` Prometer que «tus clientes ya lo ven» sería mentira (VE7)                                                                                                                                               |
| **Inválido (400, E7)**                 | Ver § Errores y validación. Resumen rojo arriba con foco, error debajo de cada campo, **nada guardado** y la maqueta **sigue mostrando lo que el admin tecleó**, no lo de la base: si se cambia, el error deja de tener a qué referirse                                                                    |
| **Sesión vencida (401)**               | `Alert tone="danger"`: `Tu sesión se cerró.` + `Vuelve a entrar desde Cuadre de Caja y guarda otra vez. No perdimos lo que escribiste.` + enlace `Volver a entrar` → `/sesion-cerrada`. Los campos **quedan como estaban**                                                                                 |
| **Sin permiso (403)**                  | No se puede llegar desde la UI (la página ya sería 404, E3), pero puede pasar si el acceso cambió a mitad de sesión: `Alert tone="danger"`: `Ya no tienes permiso para editar esta tienda.` + `Pide el acceso en Cuadre de Caja.` Los controles se deshabilitan: seguir tecleando no lleva a ningún sitio  |
| **Tienda borrada (404)**               | `Alert tone="danger"`: `Esta tienda ya no existe.` + enlace `Volver a tus tiendas`                                                                                                                                                                                                                         |
| **Error del servidor (500)**           | `Alert tone="danger"`: `No pudimos guardar.` + `No se cambió nada. Vuelve a intentar en un momento.` + `Reintentar`                                                                                                                                                                                        |
| **Red caída**                          | Igual, con `Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.` + `Reintentar`. Es el caso probable del público objetivo, así que es un botón grande y no un enlace                                                                                                                  |
| **Quitar el branding (E8), paso 1**    | El botón se sustituye **en sitio** por una confirmación en línea (mismo patrón que `Vaciar carrito` de F-010, sin diálogo ni foco atrapado): `¿Quitar el branding y volver a la paleta por defecto?` con `Sí, quitar` (`danger`, o `secondary` con el texto explícito) y `No`. El foco pasa a `Sí, quitar` |
| **Quitar el branding, paso 2 (200)**   | Se manda `{}`. Al volver: campos vacíos, `Las de siempre` marcado, la maqueta con la paleta por defecto, y `Alert tone="positive"`: `Quitamos el branding. Tu tienda usa la paleta por defecto.`                                                                                                           |
| **Formulario vacío guardado a mano**   | Mismo resultado que «Quitar»: el servidor escribe `{}` (R11). No hay dos comportamientos para el mismo hecho                                                                                                                                                                                               |

### 2c · Card «Texto y contacto» — tanda 1b (E10–E13)

> **Cancelada por DP1 → no.** No se construye: descripción y contacto de la
> tienda quedan en modo lectura. E10–E13 salen del alcance con ella.

**Depende de DP1.** Si el humano no firma la tanda 1b, esta tarjeta entera se
convierte en cuatro filas más de la tarjeta 2a (lectura, con la misma nota) y se
cae todo lo de abajo. Está escrita aparte justo para que se pueda recortar sin
tocar nada más.

Cuatro `Field`, uno por columna de override:

| Campo       | Control                                                 | Etiqueta            | Ayuda                                                                              |
| ----------- | ------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| descripción | `<textarea rows=3 maxLength=500>`                       | `Descripción corta` | `Lo que aparece debajo del nombre en tu tienda. Máximo 500 caracteres.`            |
| teléfono    | `<input type="tel" inputMode="tel" autoComplete="off">` | `Teléfono`          | `Con código de país. Ej.: +53 5555 5555`                                           |
| WhatsApp    | `<input type="tel" inputMode="tel">`                    | `WhatsApp`          | `Es el número al que te llegan los pedidos. Si lo dejas vacío se usa el teléfono.` |
| correo      | `<input type="email" autoComplete="off">`               | `Correo`            | `Opcional. No se muestra a los compradores en la tienda.`                          |

Y **el mecanismo que hace entendible la precedencia**, que es lo delicado de esta
tarjeta: cada campo cuyo override está vacío muestra el valor del POS como
`placeholder` y, debajo de la ayuda, en `text-fg-muted text-xs`:
`Ahora se muestra lo que envía Cuadre de Caja: «+5350000001».` Cuando el override
tiene valor, esa línea cambia a un botón de texto:
`Usar el de Cuadre de Caja («+5350000001»)`, que vacía el campo. Un campo vacío
significa exactamente eso y el admin no tiene que deducirlo (E13, R13).

| Estado                                                          | Qué se ve                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Normal, sin overrides**                                       | Los cuatro vacíos con el `placeholder` del POS y su línea de «ahora se muestra…»                                                                                                                       |
| **Normal, con overrides**                                       | Los valores propios, y por campo el botón `Usar el de Cuadre de Caja (…)`                                                                                                                              |
| **El POS tampoco mandó nada**                                   | Sin `placeholder`; la línea dice `Cuadre de Caja no envió ninguno: si lo dejas vacío, no se muestra nada.`                                                                                             |
| **Guardado (200)**                                              | `Alert tone="positive"`: `Texto y contacto guardados.` + `Tus clientes ya lo ven en tu tienda.` (o la variante de no publicada)                                                                        |
| **Inválido (400)**                                              | Igual que branding: resumen arriba con foco + error por campo. Los errores posibles son pocos: correo con forma inválida, teléfono con caracteres que no son dígitos ni `+`, descripción de más de 500 |
| **Un campo con solo espacios**                                  | El servidor lo guarda como `null` (R13) y al recargar el campo sale vacío con su `placeholder`. La UI no lo trata como error: no lo es                                                                 |
| **401 / 403 / 404 / 500 / red**                                 | Exactamente los mismos banners y textos que en branding. Es el mismo mecanismo de guardado y no se inventan dos vocabularios                                                                           |
| **El sync cambió el valor sincronizado mientras editaba (E11)** | No se detecta y no se avisa: son columnas distintas, no hay conflicto. Al recargar, el `placeholder` y la línea de «ahora se muestra…» traen el valor nuevo. Es correcto y es lo que dice la spec      |

### Tokens del branding (ciclo 1, congelado)

**El panel no se viste con la marca de la tienda, y es a propósito.** El único
sitio de todo `/admin` donde aparecen `brand`, `brandContrast`, `accent`,
`accentContrast` y la escala de radios de una tienda es **dentro del contenedor
de `StorefrontPreview`**. Tres razones: (1) el admin tiene que distinguir «mi
panel» de «mi vitrina» para que la maqueta signifique algo; (2) un botón
`Guardar` pintado con un `brand` que el propio admin acaba de dejar ilegible es
una trampa; (3) el panel puede gestionar varias tiendas y no hay una marca que le
corresponda.

**Cómo reacciona al branding de cada tienda.** Solo la maqueta, y por el mismo
mecanismo que la tienda real: propiedades personalizadas en un ancestro, y
utilidades que las leen por `var()` gracias al `@theme` plano de
`tokens.css:15`. Diferencia única: la tienda las emite en un `<style>` con
`[data-store="slug"]` desde el servidor y la maqueta las pone en el `style` del
contenedor, porque su valor cambia con lo que el admin teclea. **La maqueta no
emite `<style>` ni usa `data-store`** (dos reglas para lo mismo pelearían) y
**no** usa valores arbitrarios de Tailwind para los radios (F-016).

**Modo oscuro.** El panel funciona: verificado en VE2. La maqueta hereda el
esquema de color del dispositivo del admin, así que en oscuro **enseña la vitrina
en oscuro**. Limitación aceptada, con su frase: `Así se ve con el modo oscuro de
este dispositivo. Tus clientes con modo claro ven los mismos colores sobre fondo
claro.` Un conmutador claro/oscuro solo para la maqueta exigiría redefinir las
superficies con valores literales dentro del contenedor; no lo vale en la tanda 1.

**Riesgo que queda vivo** (heredado de F-010): `themeTokensSchema` valida que sea
un color CSS, no que contraste. Una tienda puede dejarse los botones ilegibles.
La maqueta es hoy la única defensa, más esta línea bajo la previsualización:
`Fíjate en que el texto del botón se lea bien.` Validar contraste de verdad es
DP4.

---

### Microcopy congelado (ciclo 1)

**Editor — cabecera y datos del POS**

- `← Tus tiendas`
- `Datos de Cuadre de Caja`
- `Nombre` · `Dirección` · `Ciudad` · `Provincia` · `Estado` · valor vacío: `—`
- `Esto se edita en Cuadre de Caja.` /
  `Aquí lo ves para saber qué está publicado: si algo está mal, corrígelo allí y se actualiza solo.`
- Borrador: `Tu tienda todavía no es visible para tus clientes. Publícala desde Cuadre de Caja.`
- Suspendida: `Tu tienda está suspendida y no es visible para tus clientes. Eso se resuelve en Cuadre de Caja.`

**Editor — colores y forma**

- `Colores y forma`
- `Vista previa de tu tienda` · `Así se ve con el modo oscuro de este dispositivo. Tus clientes con modo claro ven los mismos colores sobre fondo claro.`
- `Fíjate en que el texto del botón se lea bien.`
- `Empieza por una paleta y ajusta después.` · `Azul` `Verde` `Naranja` `Vino` `Turquesa` `Grafito`
- `Color principal` — ayuda `Un color CSS: #0f62fe, oklch(0.62 0.17 145) o un nombre como teal.`
- `Texto sobre el color principal` · atajos `Claro` · `Oscuro`
- `Color de acento` — ayuda `Se usa en la etiqueta «Destacado» de tus productos.`
- `Texto sobre el color de acento`
- `El selector solo entiende colores en formato #rrggbb. Tu color se guarda tal como está escrito.`
- `Esquinas`: `Rectas` · `Suaves` · `Muy redondeadas` · `Las de siempre`
- `Guardar branding` → `Guardando…`
- `Quitar el branding` → `¿Quitar el branding y volver a la paleta por defecto?` con `Sí, quitar` / `No`
- Sin branding: `Tu tienda usa la paleta por defecto. Elige una paleta para que se parezca a tu negocio.`
- `Sin guardar.`
- `noscript`: `Para editar los colores necesitas activar JavaScript. Lo que ya está guardado se ve más arriba.`

**Editor — texto y contacto** (tanda 1b)

- `Texto y contacto`
- `Descripción corta` — `Lo que aparece debajo del nombre en tu tienda. Máximo 500 caracteres.`
- `Teléfono` — `Con código de país. Ej.: +53 5555 5555`
- `WhatsApp` — `Es el número al que te llegan los pedidos. Si lo dejas vacío se usa el teléfono.`
- `Correo` — `Opcional. No se muestra a los compradores en la tienda.`
- `Ahora se muestra lo que envía Cuadre de Caja: «{valor}».`
- `Usar el de Cuadre de Caja («{valor}»)`
- `Cuadre de Caja no envió ninguno: si lo dejas vacío, no se muestra nada.`
- `Guardar texto y contacto` → `Guardando…`

### Componentes congelados (ciclo 1)

Los que solo existen para el branding y el contacto. Ninguno se construye ahora;
se anotan para que quien descongele no vuelva a decidirlos.

| Componente          | Qué hacía                                                                                                | `"use client"`                           |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `StorefrontPreview` | La maqueta de la vitrina, con `variant: "strip" \| "full"`. La renderizaba la isla y también el servidor | **No** — sin estado propio               |
| `ColorTokenField`   | `Field` + `TextInput` + `<input type="color">` **sin `name`** + los atajos `Claro`/`Oscuro`              | **No** — controlado desde `BrandingForm` |
| `PalettePreview`    | Las tres muestras de color de la tarjeta del listado de tiendas                                          | **No**                                   |
| `BrandingForm`      | La tarjeta 2b entera                                                                                     | **Sí** — isla                            |
| `StoreContentForm`  | La tarjeta 2c entera                                                                                     | **Sí** — isla (cancelada con DP1)        |

**Y el cambio en código existente que la maqueta necesita**, que sigue siendo
cierto el día que se descongele: extraer de `src/features/theming/storeTheme.ts`

```ts
export function themeCustomProperties(tokens: ThemeTokens): Record<string, string>;
```

que devuelva `{"--color-brand": "…", "--radius-md": "…", …}` con los
`CUSTOM_PROPERTY` y `RADIUS_SCALE` que ya están ahí, y que `renderStoreTheme`
serialice **su salida**. La maqueta la usa para su `style`. Sin eso se duplican la
escala de radios y el mapeo de nombres: dos fuentes para la misma verdad.
