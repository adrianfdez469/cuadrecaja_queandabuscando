---
propuesta: navegacion-atras-y-breadcrumb
agente: sdd-spec
actualizado: 2026-08-29T04:00:00Z
estado: promovida
---

> **PROMOVIDA a F-025 el 2026-08-29.** El contenido completo, con las preguntas ya resueltas por el humano, vive ahora en `.agent/specs/F-025/spec.md`. Este archivo se conserva como historial de la propuesta original, sin editar.

> Origen: pedido del humano del 2026-08-29, textual: «quiero que en las tiendas
> haya un botón para viajar a atrás siempre, un breadcrumb para poder ir directo
> a alguna página de la ruta en la que te encuentras, un selector de categorías y
> subcategorías, filtros avanzados […], ordenamientos avanzados, reseñas y
> calificaciones. Agrégalos en varios features en dependencia de su alcance y
> relación».
>
> Este documento cubre **solo la primera mitad de la primera frase**: volver
> atrás y el rastro de navegación. Las otras tres viven en
> `.agent/specs/propuestas/categorias-y-subcategorias.md`,
> `.agent/specs/propuestas/filtros-y-ordenamiento-avanzados.md` y
> `.agent/specs/propuestas/resenas-y-calificaciones.md`.

## Problema

Dentro de una tienda no hay forma fiable de retroceder. Lo que hay hoy es un
enlace por página, cada uno inventado aparte y ninguno en la mayoría:

- `src/app/[slug]/layout.tsx:78` — el nombre de la tienda en el header enlaza a
  `/${canonicalSlug}`. Es lo único que existe en la ficha de producto, y no dice
  que sea «atrás»: dice el nombre de la tienda.
- `src/app/[slug]/sucursales/page.tsx:44` — un «← Volver a {nombre}» propio.
- `src/app/[slug]/pedido/[code]/not-found.tsx:17` — un `<Link href="..">`
  relativo.
- `src/app/[slug]/pedido/[code]/page.tsx:126` — un «Seguir comprando», y encima
  con `<a>` en vez de `<Link>`.
- `src/features/cart/components/CartView.tsx:163` — un «Volver a la tienda» que
  **solo** aparece cuando la tienda está cerrada.

En `/[slug]/carrito` abierto, en `/[slug]/checkout` y en `/[slug]/buscar?q=…` con
resultados no hay ningún control de vuelta. Y en ninguna página se ve **dónde
estás**: con F-017 la jerarquía real es Marca → Sucursal → pantalla, y esa
jerarquía no está dibujada en ningún sitio.

Importa más aquí que en otra tienda online porque la entrada típica no es la
portada: es un QR impreso por local (F-017, `docs/adr/0018-registro-de-slugs-y-slug-canonico.md`).
Quien entra así llega directamente a una ficha o a un catálogo **con el historial
del navegador vacío**: el «atrás» del teléfono lo saca del sitio.

## Alcance

### Dentro

1. **Un rastro de navegación** (`breadcrumb`) clicable, calculado por la ruta,
   presente en las nueve pantallas públicas de tienda: catálogo de sucursal,
   selector de marca, ficha de producto, resultados de búsqueda, búsqueda vacía,
   carrito, checkout, página de pedido y cambio de sucursal.
2. **Un control de «volver atrás»** derivado del **mismo** rastro: es su
   penúltimo eslabón, nunca el historial del navegador (R2, I2).
3. **Una sola función que construye el rastro** —lo que hoy son cinco enlaces
   ad-hoc— y un solo componente de servidor que lo pinta. Ficheros previstos:
   src/features/storefront/trail.ts (por crear) y
   src/components/store/StoreTrail.tsx (por crear).
4. **Un `not-found` propio del segmento de tienda**: src/app/[slug]/not-found.tsx
   (por crear), para que un 404 dentro de una tienda conserve el marco de la
   tienda en vez de caer en `src/app/not-found.tsx` (I6). Es la misma razón que
   ya justifica `src/app/[slug]/pedido/[code]/not-found.tsx`.
5. **`BreadcrumbList` de schema.org** en JSON-LD, solo en las páginas
   indexables (R13).
6. **La sustitución** del «← Volver a {nombre}» de
   `src/app/[slug]/sucursales/page.tsx:44` por el rastro. No se apilan dos
   controles de vuelta en la misma pantalla (R14).

### Fuera (explícito)

- **El historial del navegador.** No se lee, no se manipula, no se detecta si
  existe. Nada de `history.back()`, `router.back()` ni `document.referrer`.
- **El panel de admin** (`src/app/admin/**`). Ya tiene su propio patrón «← X»
  repetido en siete páginas; unificarlo es otro trabajo y no lo ve ningún
  comprador.
- **Recordar de dónde venía el comprador.** El rastro es función de la URL, no
  del camino (R1). En particular, volver desde una ficha a los resultados de
  búsqueda queda fuera: ver SP2 y la incongruencia I7.
- **Un eslabón de categoría.** Lo decide la propuesta hermana
  `.agent/specs/propuestas/categorias-y-subcategorias.md`; aquí solo se deja el
  hueco (§ No decidido a propósito).
- **Conservar filtros y ordenamientos al volver.** Propuesta hermana
  `.agent/specs/propuestas/filtros-y-ordenamiento-avanzados.md`.
- **Tocar `BranchBar`** (`src/components/store/BranchBar.tsx`). Sigue igual: es
  una **acción** («Cambiar de sucursal»), no una ubicación. Ver SP3.
- **Unificar `/[brandSlug]` (selector) con `/[slug]/sucursales`**, que hoy pintan
  casi la misma pantalla (I5).
- **Cualquier cambio de datos.** Sin migración, sin schema, sin contrato.

## Actores y precondiciones

**El comprador, sin cuenta y sin sesión** — la misma frontera pública de
`docs/adr/0016-escritura-publica-sin-sesion.md`. También lo usa el comerciante
cuando revisa su propia tienda publicada, pero no aparece ningún dato distinto
para él.

Precondiciones:

- El slug resuelve con `requireResolution()`
  (`src/features/storefront/server/resolve.ts:216`). Si no resuelve, gana
  `notFound()` y no hay rastro que dibujar (R16).
- F-004 (rutas públicas con ISR), F-010 (carrito, checkout, pedido), F-017
  (Storefront → Store) y F-021 (`/[slug]/buscar`) están en `passes: true`. Las
  cuatro aportan pantallas al rastro; **F-004 y F-017 son las dependencias
  duras**: sin la resolución marca/sucursal no hay jerarquía que dibujar.
- No hace falta ninguna consulta nueva: `brandSlug`, `brandName`,
  `canonicalSlug` y `branchCount` ya vienen en `BranchResolution`
  (`src/features/storefront/server/resolve.ts:41`), y el nombre del producto, el
  término de búsqueda y el código del pedido ya los tiene cargados cada página
  (R7).

## Comportamiento esperado

**E1 — el catálogo de una marca de una sola sucursal es el techo.**
Dada `tienda-demo`, marca con una única sucursal, cuando el comprador abre
`/tienda-demo`, entonces el rastro tiene **un solo eslabón** —el nombre de la
tienda, sin enlace, `aria-current="page"`— y **no** se dibuja ningún control de
«atrás» (SP1 puede cambiar esto).

**E2 — bajo una marca con varias sucursales, el catálogo cuelga de la marca.**
Dada una marca con dos sucursales renderizables (`bodega-uno` agrupada con
`bodega-dos`, como monta `.agent/specs/F-017/smoke.sh`), cuando el comprador
abre `/bodega-uno`, entonces el rastro es `{Marca} › {Bodega Uno}` con el primer
eslabón enlazando a `/{brandSlug}` y el segundo sin enlace, y el control de
«atrás» apunta a `/{brandSlug}`.

**E3 — la ficha de producto vuelve al catálogo de su sucursal.**
Dada la ficha `/tienda-demo/p/{productSlug}`, cuando se renderiza, entonces el
último eslabón es el **nombre del producto** sin enlace, el penúltimo es la
sucursal con `href="/tienda-demo"`, y el control de «atrás» apunta a esa misma
URL. Todo ello está en el HTML servido, antes de cualquier JavaScript.

**E4 — el enlace directo sin historial se comporta igual.**
Dado un comprador que llega a `/tienda-demo/p/{productSlug}` escaneando un QR
—pestaña nueva, historial vacío—, cuando pulsa «atrás» del rastro, entonces va a
`/tienda-demo`. El resultado es idéntico al de un comprador que llegó navegando:
el destino no depende de cómo llegó (R1).

**E5 — el rastro habla siempre en slug canónico.**
Dado que `bodega-central` tiene el alias `bodega-central-vedado`
(`prisma/seed.ts:426`), cuando el comprador abre `/bodega-central-vedado/carrito`,
entonces todos los `href` del rastro usan `bodega-central` y **ninguno** contiene
`bodega-central-vedado`. No hay redirección: la página sigue respondiendo 200 en
las dos URLs (F-017, criterio 3).

**E6 — los resultados de búsqueda cuelgan de la sucursal.**
Dada `/tienda-demo/buscar?q=café`, cuando se renderiza, entonces el rastro es
`… › {Sucursal} › Buscar «café»`, con el término **normalizado** que devuelve
`normalizeSearchTerm()` —nunca el crudo de la URL— y el «atrás» apunta al
catálogo.

**E7 — la búsqueda sin término también tiene rastro.**
Dada `/tienda-demo/buscar` sin `q`, cuando se renderiza, entonces el último
eslabón es `Buscar`, sin comillas y sin término.

**E8 — el carrito.**
Dada `/tienda-demo/carrito`, entonces el rastro es `… › {Sucursal} › Carrito` y
el «atrás» apunta al catálogo. Esto vale con el carrito lleno y con el carrito
vacío: el rastro se pinta en el servidor y no sabe nada del `localStorage`.

**E9 — el checkout cuelga del carrito.**
Dada `/tienda-demo/checkout`, entonces el rastro es
`… › {Sucursal} › Carrito › Pagar` y el «atrás» apunta a `/tienda-demo/carrito`,
no al catálogo.

**E10 — la página del pedido no cuelga del checkout.**
Dada `/tienda-demo/pedido/{code}`, entonces el rastro es
`… › {Sucursal} › Pedido {código formateado}` —sin eslabón de carrito ni de
pagar— y el «atrás» apunta al catálogo. El pedido ya está hecho: devolver a
alguien al checkout es ofrecerle repetirlo.

**E11 — cambiar de sucursal.**
Dada `/bodega-uno/sucursales`, entonces el rastro es
`{Marca} › {Bodega Uno} › Cambiar de sucursal`, y el «← Volver a {nombre}» que
hoy pinta `src/app/[slug]/sucursales/page.tsx:44` **ya no está**: hay un solo
control de vuelta en la pantalla.

**E12 — el selector de marca es el techo.**
Dada una marca con dos sucursales y su propia URL `/{brandSlug}` en modo
selector, entonces el rastro tiene un solo eslabón (el nombre de la marca, sin
enlace) y no hay «atrás».

**E13 — una sucursal cerrada tiene el mismo rastro que una abierta.**
Dada `tienda-cerrada` (`status: SUSPENDED`), cuando el comprador abre
`/tienda-cerrada/p/{cualquiera}`, entonces responde 200 con el aviso de cerrada
y con el rastro completo, cuyo «atrás» lleva a `/tienda-cerrada` — que es
justamente la pantalla que trae el teléfono y el WhatsApp del negocio
(`src/components/store/StoreClosedNotice.tsx`).

**E14 — sin JavaScript, funciona.**
Dado un navegador con JavaScript deshabilitado, cuando el comprador pulsa
cualquier eslabón del rastro, entonces navega. El rastro son `<a href>` en el
HTML servido; no hay ningún módulo de cliente involucrado (R8).

**E15 — un 404 dentro de la tienda no expulsa de la tienda.**
Dada `/tienda-demo/p/no-existe`, cuando responde 404, entonces la página se
pinta **dentro** de `src/app/[slug]/layout.tsx`: conserva el header con el
nombre de la tienda, su tema (`data-store="tienda-demo"`) y un camino de vuelta
al catálogo. Hoy cae en `src/app/not-found.tsx` y ofrece «Volver al inicio» de
la plataforma (I6).

**E16 — el eslabón actual nunca es un enlace.**
Dado cualquier rastro, cuando se renderiza, entonces su último eslabón es texto
con `aria-current="page"` y sin `href`. Un enlace a la página en la que ya
estás es ruido para todo el mundo y una trampa con lector de pantalla. Es la
misma decisión que ya tomó HD11 en `src/app/[slug]/layout.tsx:73`.

**E17 — un nombre largo se recorta, no rompe.**
Dado un producto cuyo nombre mide 120 caracteres, cuando se renderiza el rastro
en 360 px de ancho, entonces el eslabón se recorta visualmente con puntos
suspensivos (CSS), el texto completo sigue en el DOM —así el lector de pantalla
lo lee entero— y el rastro no empuja al contenido fuera de la pantalla ni obliga
a desplazamiento horizontal.

## Reglas de negocio

- **R1 — el rastro es función de la URL resuelta, y de nada más.** Ni historial,
  ni `Referer`, ni cookie, ni parámetro de procedencia. Dos compradores en la
  misma URL ven exactamente el mismo rastro.
- **R2 — el «atrás» es el penúltimo eslabón.** Un rastro de un solo eslabón no
  dibuja «atrás». Una sola definición para las dos cosas que pidió el humano:
  imposible que se contradigan.
- **R3 — todo `href` del rastro usa el slug canónico**, el que devuelve
  `canonicalSlug()` (`src/lib/publicSlug.ts:32`), nunca el slug pedido. Es lo
  que fija `docs/adr/0018-registro-de-slugs-y-slug-canonico.md`, y lo que evita
  que un alias se propague como si fuera la URL de la tienda.
- **R4 — el eslabón de marca solo existe si `branchCount > 1`.** Con una sola
  sucursal, marca y sucursal **son la misma URL**
  (`src/lib/publicSlug.ts:32`): dos eslabones al mismo sitio serían mentira.
- **R5 — el último eslabón nunca lleva `href`** (E16).
- **R6 — el rastro no cambia con `Store.status`.** Abierta o cerrada, los mismos
  eslabones y los mismos destinos (E13). El aviso de cerrada lo da el contenido,
  no la navegación.
- **R7 — cero consultas nuevas.** El rastro se construye con lo que la página ya
  cargó. Si un eslabón necesitara un dato que no está, el eslabón no se pone.
- **R8 — cero JavaScript de cliente.** Ningún archivo de este feature lleva
  `"use client"`. AGENTS.md § Prohibiciones lo veta explícitamente en cualquier
  cosa que renderice catálogo, y el rastro se monta en el catálogo.
- **R9 — el rastro se renderiza en cada página, no en el layout.**
  `src/app/[slug]/layout.tsx` no sabe en qué ruta hija está (I1). Es el mismo
  reparto que ya usan `src/components/store/BranchBar.tsx` y
  `src/components/store/StoreSearchBox.tsx`: componente compartido, montado por
  cada página.
- **R10 — orden vertical fijo**: header (layout) → `BranchBar` cuando la haya →
  rastro → contenido. El rastro va siempre por encima del `<h1>` y siempre en el
  mismo sitio, en las nueve pantallas.
- **R11 — etiquetas.** Marca: `Storefront.name`. Sucursal: `Store.name`.
  Producto: el nombre del producto. Búsqueda: `Buscar «{término normalizado}»`.
  Pedido: `Pedido {formatOrderCode(code)}`. Carrito: `Carrito`. Checkout:
  `Pagar`. Cambio de sucursal: `Cambiar de sucursal`. Todas en español
  (AGENTS.md § Idioma); el código, en inglés.
- **R12 — el rastro nunca colapsa eslabones.** Nada de «…» que expanda al
  pulsar: eso es JavaScript. En pantallas estrechas se recorta cada eslabón
  (R17/E17), no se esconde ninguno.
- **R13 — `BreadcrumbList` solo donde se indexa.** En `/[slug]` (modo sucursal y
  modo selector) y en `/[slug]/p/[productSlug]`. Nunca en `/carrito`,
  `/checkout`, `/pedido/[code]`, `/sucursales` ni `/buscar`: las cinco declaran
  `robots: { index: false }` hoy, y meter datos estructurados en una página que
  se pide no indexar es contradecirse en el mismo HTML.
- **R14 — un solo control de vuelta por pantalla.** El «← Volver a {nombre}» de
  `src/app/[slug]/sucursales/page.tsx:44` desaparece. **No** desaparecen el
  «Seguir comprando» de `src/app/[slug]/pedido/[code]/page.tsx:126` ni el
  «Volver a la tienda» de `src/features/cart/components/CartView.tsx:163`: esos
  dos están **al final del contenido** y son llamadas a la acción, no
  navegación de cabecera. Sí se corrige el `<a>` del primero a `<Link>` (I4).
- **R15 — accesibilidad.** El rastro es un `<nav aria-label="Ruta">` con un
  `<ol>`; los separadores son decorativos (`aria-hidden="true"` o generados por
  CSS) y nunca se leen; el eslabón actual lleva `aria-current="page"`. Mismo
  patrón que `src/components/store/BranchBar.tsx:32`.
- **R16 — sin resolución no hay rastro.** Un slug retirado, una marca sin
  sucursales renderizables o un `DRAFT` dan 404 antes de construir nada.
- **R17 — área táctil de 44 px** (`min-h-11`) en cada eslabón enlazable, como el
  resto del storefront (`src/components/store/BranchBar.tsx:35`,
  `src/components/store/StoreSearchBox.tsx`).
- **R18 — el rastro no rompe el estático.** `/[slug]` y
  `/[slug]/p/[productSlug]` siguen marcándose `●` en el build. Cualquier
  implementación que necesite `headers()`, `cookies()` o `searchParams` en esas
  dos rutas está descartada por esta regla (I1, I7).

## Casos límite y errores

- **Marca y sucursal con nombres casi iguales** («Bodega Central» y «Bodega
  Central · Vedado», `prisma/seed.ts:426`). Se muestran los dos: las URL son
  distintas y adivinar cuál sobra es peor que repetir. No se deduplica por
  texto.
- **Marca y sucursal con el nombre _idéntico_**. Igual: dos eslabones, dos
  destinos. Quien los llamó igual es el comerciante, y el panel es donde se
  arregla.
- **La marca se agrupa mientras la página está en caché.** `branchCount` pasa de
  1 a 2 y el rastro de la sucursal debería ganar el eslabón de marca. Lo cubre
  ya el embudo de revalidación de F-017 (`expandBrandTouch()`,
  `src/features/storefront/server/registry.ts`): agrupar toca todos los slugs de
  la marca. **No** hace falta invalidación nueva, pero sí una comprobación: si
  el rastro se dibujara desde un dato que no está tageado, quedaría rancio para
  siempre — el fallo exacto que fichó `revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado`.
- **Término de búsqueda hostil**: 300 caracteres, comillas angulares, `<script>`.
  El rastro usa `StoreSearchResult.term` —ya normalizado y truncado a
  `SEARCH_TERM_MAX_LENGTH` (`src/constants/search.ts`)— y React escapa el texto.
  Nunca el `searchParams.q` crudo.
- **Checkout a medio llenar.** Pulsar el eslabón «Carrito» pierde lo escrito:
  `CheckoutForm` solo guarda en `sessionStorage` la clave de idempotencia
  (`src/features/cart/components/CheckoutForm.tsx:180`), no los datos de
  contacto. **Se acepta**: el botón «atrás» del navegador ya hace exactamente
  eso hoy, y avisar antes de salir exige JavaScript. Si molesta, lo arregla
  persistir el formulario, que es otro feature.
- **Código de pedido inexistente.** Gana `src/app/[slug]/pedido/[code]/not-found.tsx`,
  que ya tiene su propio marco; su `<Link href="..">` relativo se cambia por el
  rastro con slug canónico (I3).
- **Producto inexistente / slug de tienda inexistente.** El primero pasa a
  resolverse dentro de la tienda (E15). El segundo —`/tienda-que-no-existe`—
  no tiene tienda que dibujar y se queda con `src/app/not-found.tsx`, como hoy.
- **`/[slug]/sucursales` de una marca de una sola sucursal.** Ya responde 404
  (`src/app/[slug]/sucursales/page.tsx:33`). No cambia.
- **Prefetch.** Tres `<Link>` más por página que Next puede prefetchear al
  entrar en viewport. Son URL que ya están en ISR, así que el coste es una
  petición cacheada; si en la medición pesa, `prefetch={false}` en los eslabones
  del rastro. Decisión del arquitecto, no del humano.
- **Concurrencia, permisos, reintentos**: no aplican. El rastro es de solo
  lectura, sin sesión, sin escritura y sin efecto secundario.

## Datos y contrato

**No toca `docs/sync-contract.md`, ni `prisma/schema.prisma`, ni el panel.** Sin
migración, sin campo nuevo, sin evento nuevo. Es una función pura sobre datos que
las páginas ya tienen en la mano.

Forma propuesta del contrato interno (en src/features/storefront/trail.ts, por
crear):

```ts
/** Un eslabón. `href: null` marca el actual — y solo el último puede serlo. */
export type Crumb = { readonly label: string; readonly href: string | null };

/** Nunca vacío: toda pantalla pública de tienda tiene al menos su propio eslabón. */
export type Trail = readonly [Crumb, ...Crumb[]];

/** El destino de «atrás», o null si el rastro tiene un solo eslabón (R2). */
export function backTarget(trail: Trail): Crumb | null;
```

Tabla del rastro por ruta (`{M}` = marca, presente solo si `branchCount > 1`,
R4; `{S}` = sucursal):

| Ruta                      | Rastro                                  |
| ------------------------- | --------------------------------------- |
| `/[slug]` selector        | `{M}`                                   |
| `/[slug]` sucursal        | `{M}` › `{S}`                           |
| `/[slug]/p/[productSlug]` | `{M}` › `{S}` › `{nombre del producto}` |
| `/[slug]/buscar` sin `q`  | `{M}` › `{S}` › `Buscar`                |
| `/[slug]/buscar?q=…`      | `{M}` › `{S}` › `Buscar «{término}»`    |
| `/[slug]/carrito`         | `{M}` › `{S}` › `Carrito`               |
| `/[slug]/checkout`        | `{M}` › `{S}` › `Carrito` › `Pagar`     |
| `/[slug]/pedido/[code]`   | `{M}` › `{S}` › `Pedido {código}`       |
| `/[slug]/sucursales`      | `{M}` › `{S}` › `Cambiar de sucursal`   |

Límites: cada `label` se recorta visualmente por CSS, no en el servidor (E17).
Ninguna etiqueta se trunca en el DOM salvo el término de búsqueda, que ya llega
truncado a `SEARCH_TERM_MAX_LENGTH` desde F-021.

## Criterios de aceptación propuestos

Todos `[nuevo]`. Se verifican con `curl` contra `next start` y con el build,
salvo C2, que necesita la etapa `--visual` del arnés.

1. `curl -s http://localhost:3000/tienda-demo/p/<slug>` devuelve HTML que
   contiene un `<nav aria-label="Ruta">`, dentro de él un `<a href="/tienda-demo">`
   y, como último elemento de la lista, el nombre del producto con
   `aria-current="page"` y **sin** `href`.
2. Con JavaScript deshabilitado (`page.setJavaScriptEnabled(false)` en
   `visual.mjs`), pulsar el eslabón de la sucursal en la ficha de producto
   navega a `/tienda-demo` y la página resultante responde 200.
3. `npm run build` sigue marcando `/[slug]` y `/[slug]/p/[productSlug]` como `●`
   (SSG), no como `ƒ` — el criterio 1 de F-004 no se degrada.
4. `grep -rn "use client" src/features/storefront/ src/components/store/` no
   devuelve ninguna línea de los archivos de este feature, y
   `node scripts/check-bundle-budget.mjs` termina con código 0 **sin** haber
   subido `BUDGET_KB` en `scripts/check-bundle-budget.mjs`.
5. En una marca con dos sucursales (montada como en `.agent/specs/F-017/smoke.sh`),
   `GET /bodega-uno/carrito` contiene **tres** eslabones y el segundo enlaza a
   `/bodega-uno`; `GET /tienda-demo/carrito` contiene **dos** y ninguno enlaza a
   un slug de marca distinto de `tienda-demo`.
6. `GET /bodega-central-vedado/carrito` contiene `href="/bodega-central"` dentro
   del `<nav aria-label="Ruta">` y **cero** apariciones de
   `bodega-central-vedado` dentro de ese `<nav>`. Las dos URL siguen
   respondiendo 200.
7. `GET /tienda-cerrada/carrito` responde 200 y su rastro apunta a
   `/tienda-cerrada`, idéntico al de una tienda abierta.
8. `GET "/tienda-demo/buscar?q=<300 caracteres>"` responde 200 y el `<nav aria-label="Ruta">`
   contiene el término truncado a `SEARCH_TERM_MAX_LENGTH`, no el crudo.
9. `GET /tienda-demo/p/no-existe` responde **404** y su HTML contiene
   `data-store="tienda-demo"` y un enlace a `/tienda-demo`; hoy contiene
   «Volver al inicio» y ningún `data-store`.
10. `GET /tienda-demo/p/<slug>` contiene un
    `<script type="application/ld+json">` con `"@type":"BreadcrumbList"`, y
    `GET /tienda-demo/carrito` **no** lo contiene.
11. `GET /bodega-uno/sucursales` contiene exactamente **un** control de vuelta:
    la cadena `Volver a` ya no aparece en su HTML.
12. `GET /tienda-demo` (marca de una sucursal) contiene el `<nav aria-label="Ruta">`
    con un solo eslabón y sin ningún `<a>` dentro — o lo que decida SP1.
13. El número de consultas a la base que ejecuta `/tienda-demo/p/<slug>` es el
    mismo antes y después del cambio, medido con el log de consultas de Prisma y
    anotado en `tests.md` (R7).
14. `bash .agent/verify.sh <ID> --full` termina con código 0.

## Incongruencias detectadas

- **I1 — el layout no puede pintar el rastro, y la vía obvia rompe el ISR.**
  `src/app/[slug]/layout.tsx:19` solo recibe `params`; un layout de App Router no
  conoce la ruta hija. Averiguarla exigiría `headers()` —que vuelve dinámico el
  segmento y tira el `●` que verifica el criterio 1 de F-004— o una cabecera
  puesta desde `src/proxy.ts`, cuyo `matcher` **tiene prohibido** tocar `/[slug]`
  (`src/proxy.ts:24` y AGENTS.md § Cosas que muerden: «es el error más fácil de
  cometer en este repo»). De ahí R9.
- **I2 — un botón «atrás» con `history.back()` choca dos veces.** Primero con
  AGENTS.md § Prohibiciones: exige `"use client"` y estaría en el árbol del
  catálogo, que es exactamente donde está vetado. Y segundo con el producto: la
  entrada por QR (F-017,
  `docs/adr/0018-registro-de-slugs-y-slug-canonico.md`) deja el historial vacío,
  así que ese botón, o no hace nada, o saca al comprador del sitio. Un `<Link>`
  a una URL padre determinista no tiene ninguno de los dos problemas y además
  vive en el HTML servido.
- **I3 — hoy el mismo gesto está escrito de tres maneras.**
  `src/app/[slug]/sucursales/page.tsx:44` («← Volver a {nombre}», absoluto),
  `src/app/[slug]/pedido/[code]/not-found.tsx:17` (`<Link href="..">`, relativo)
  y `src/app/[slug]/layout.tsx:78` (el nombre de la tienda). El relativo, además,
  **conserva el slug pedido**: entrando por `bodega-central-vedado` te devuelve a
  `bodega-central-vedado`, contra la regla que fija `src/lib/publicSlug.ts:1-12`.
- **I4 — `src/app/[slug]/pedido/[code]/page.tsx:126` usa `<a href>` en vez de
  `<Link>`** para volver al catálogo: recarga la aplicación entera. Es la única
  navegación interna del storefront que lo hace.
- **I5 — hay dos pantallas casi idénticas para elegir sucursal.** `/{brandSlug}`
  en modo selector (`src/app/[slug]/page.tsx:78`, «Elige tu sucursal») y
  `/[slug]/sucursales` (`src/app/[slug]/sucursales/page.tsx`, «Cambiar de
  sucursal»); las dos pintan `BranchList` con distinto `variant`. El rastro
  obliga a elegir a cuál apunta el eslabón de marca: SP3.
- **I6 — un 404 dentro de una tienda expulsa de la tienda.** Solo el pedido tiene
  `not-found.tsx` propio, y su comentario dice literalmente por qué: «it renders
  inside `[slug]/layout.tsx`, so a wrong or foreign code still shows the store's
  own header instead of losing the tienda's frame entirely». `/[slug]/p/no-existe`
  sí lo pierde: cae en `src/app/not-found.tsx`, sin tema, sin header y con
  «Volver al inicio» a la landing de la plataforma.
- **I7 — la lectura ingenua del pedido rompe un criterio ya verificado.** «Volver
  a donde estaba» sugiere marcar la procedencia en la URL
  (`/p/x?from=buscar&q=café`). Leer `searchParams` en
  `src/app/[slug]/p/[productSlug]/page.tsx` convierte la ficha en dinámica y el
  build dejaría de marcarla `●`: eso es el criterio 1 de F-004, `passes: true`
  desde entonces. Por eso R1 y SP2.
- **I8 — «siempre» no es literalmente posible.** En `/tienda-demo` (marca de una
  sola sucursal) no hay ninguna página padre **dentro de la tienda**. Cualquier
  «atrás» ahí sale del negocio. SP1.

## Huecos y preguntas al humano

**SP1 — ¿cuál es el techo de la navegación: la tienda o la plataforma?**
Qué falta: qué hace el «atrás» —y si existe un eslabón inicial en el rastro— en
la raíz de una tienda (`/tienda-demo` de una marca con una sucursal, y
`/{brandSlug}` en modo selector). Por qué bloquea: decide si el rastro puede
sacar al comprador de la tienda, y cambia el criterio 12. Opciones:
(a) **no se dibuja «atrás» en la raíz** y el rastro empieza en la marca —el
comprador que llegó por QR nunca ve un enlace fuera del negocio—;
(b) el rastro empieza con un eslabón `Inicio` → `/`;
(c) como (b), pero solo cuando exista una home de marketplace de verdad.
Recomendación: **(a)**. Hoy `/` es una landing comercial dirigida a
_comerciantes_ (`src/app/(marketing)/page.tsx`), no un directorio de tiendas:
mandar allí a quien está comprando es una fuga, no una vuelta. Si algún día
existe el marketplace, se añade el eslabón y ninguna otra regla cambia.

**SP2 — ¿volver desde una ficha de producto a los resultados de búsqueda?**
Qué falta: si al pulsar «atrás» en `/[slug]/p/x`, habiendo llegado desde
`/[slug]/buscar?q=café`, hay que aterrizar en los resultados o en el catálogo.
Por qué bloquea: la única forma sin JavaScript es marcar la procedencia en la URL
del producto, y eso vuelve dinámica una ruta que F-004 verificó como `●` (I7).
Opciones:
(a) **siempre al catálogo**, y que el buscador siga visible en la ficha —ya lo
está, `src/app/[slug]/p/[productSlug]/page.tsx:172—`;
(b) `?from=` en cada enlace de resultado, aceptando que la ficha pase a `ƒ`
(dinámica) y renunciando al ISR de la pantalla más visitada de la tienda;
(c) (a) ahora y reabrirlo si el registro de consultas de F-021 muestra que la
búsqueda es la puerta de entrada mayoritaria.
Recomendación: **(c)**. El coste de (b) es alto y permanente; el de (a) es que
un comprador reescriba una búsqueda, y el dato para decidirlo ya se está
recogiendo (`recordStoreSearchQuery`).

**SP3 — ¿a dónde apunta el eslabón de la marca: al selector o a «cambiar de
sucursal»?**
Qué falta: elegir entre `/{brandSlug}` y `/{slug}/sucursales`, que hoy pintan
casi la misma lista (I5). Por qué bloquea: cambia el `href` de un eslabón que
aparece en las nueve pantallas de toda marca con varias sucursales, y decide si
`BranchBar` sigue teniendo sentido. Opciones:
(a) **al selector `/{brandSlug}`**, que es el padre jerárquico real, dejando
`/sucursales` como la **acción** que ya enlaza `BranchBar` (con su aviso del
carrito);
(b) a `/{slug}/sucursales`, y entonces `BranchBar` pasa a ser redundante y se
podría retirar;
(c) unificar las dos pantallas en una — fuera del alcance de esta propuesta.
Recomendación: **(a)**. Son dos cosas distintas: el selector es un sitio, el
cambio de sucursal es una acción con consecuencias sobre el carrito que F-017
tardó dos rondas de decisión del humano en fijar. Fundirlas aquí, de rebote, es
la clase de cambio que reabre esa discusión sin pretenderlo.

## No decidido a propósito

- **Un eslabón de categoría entre la sucursal y el producto.** Si prospera
  `.agent/specs/propuestas/categorias-y-subcategorias.md`, el rastro querrá
  `{M} › {S} › {Categoría} › {Subcategoría} › {Producto}`. Aquí **no se diseña**:
  lo único que se hace es que el rastro sea una **lista construida**, no
  `JSX` escrito a mano por página, para que insertar eslabones sea añadir
  elementos y no reescribir nueve pantallas. Quién lo cierra: el `sdd-spec` de
  esa propuesta, y le tocará decidir además de qué categoría cuelga un producto
  que está en varias.
- **Conservar filtros y orden al volver** (`?orden=precio&marca=x` en el eslabón
  del catálogo). Mismo bloqueo que SP2: son `searchParams`. Lo cierra
  `.agent/specs/propuestas/filtros-y-ordenamiento-avanzados.md`.
- **El aspecto exacto**: separador, tamaño, si el «atrás» es una fila propia
  encima del rastro o el propio penúltimo eslabón destacado, y qué pasa en 360 px
  con cuatro eslabones. Lo cierra `sdd-designer`.
- **Si los `<Link>` del rastro llevan `prefetch={false}`.** Se decide midiendo,
  no antes. Lo cierra `sdd-architect`.
- **Unificar el patrón «← X» del panel de admin** con este rastro. Siete páginas
  de `src/app/admin/tiendas/**` lo repiten a mano; es deuda real, pero no la ve
  ningún comprador y mezclarla aquí ensancha el feature sin motivo.
- **Persistir el formulario del checkout** para que volver al carrito no pierda
  lo escrito. Lo destapa este feature (§ Casos límite), pero lo arregla F-012 o
  un feature propio.
