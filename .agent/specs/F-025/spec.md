---
feature: F-025
agente: sdd-spec
actualizado: 2026-08-31T13:26:39Z
estado: listo
---

> Trasladado de `.agent/specs/propuestas/navegacion-atras-y-breadcrumb.md` el
> 2026-08-29, cuando el humano aprobó promoverlo a feature con la recomendación
> del agente para SP1, SP2 y SP3 (ver § Huecos y preguntas al humano — quedan
> anotadas como RESUELTAS, no se borran). Los 14 criterios de este documento ya
> están en `.agent/features.json` bajo F-025 y pasan a `[ya]`.
>
> Origen: pedido del humano del 2026-08-29, textual: «quiero que en las tiendas
> haya un botón para viajar a atrás siempre, un breadcrumb para poder ir directo
> a alguna página de la ruta en la que te encuentras, un selector de categorías y
> subcategorías, filtros avanzados […], ordenamientos avanzados, reseñas y
> calificaciones. Agrégalos en varios features en dependencia de su alcance y
> relación». El pedido se partió en cuatro propuestas independientes; esta
> cubre solo la primera mitad de la primera frase: volver atrás y el rastro de
> navegación. Las otras viven en F-026 (categorías), F-027 (filtros y orden) y
> `.agent/specs/propuestas/resenas-y-calificaciones.md` (todavía sin promover:
> el humano pidió revisarla antes).
>
> **Actualizado el 2026-08-31** con SP4 y SP5, que el humano resolvió después de
> que F-026 cerrara en `passes: true` y añadiera una **décima** pantalla pública
> que este documento no contemplaba: `/[slug]/c/[categorySlug]`. Lo que cambia:
> esa pantalla gana su rastro y la ficha de producto gana un eslabón de
> categoría, con el «atrás» de la ficha apuntando a la categoría. Los 14
> criterios que ya están en `.agent/features.json` **no se tocan** (regla 3);
> los que exige SP4 se proponen aquí marcados `[nuevo]` y los añade el humano
> (regla 4). Todo lo demás —SP1, SP2 y SP3 incluidos— se conserva.

## Problema

Dentro de una tienda no hay forma fiable de retroceder. Lo que hay hoy es un
enlace por página, cada uno inventado aparte y ninguno en la mayoría:

- `src/app/[slug]/layout.tsx:78` — el nombre de la tienda en el header enlaza a
  `/${canonicalSlug}`. Es lo único que existe en la ficha de producto, y no dice
  que sea «atrás»: dice el nombre de la tienda.
- `src/app/[slug]/sucursales/page.tsx:44` — un «← Volver a {nombre}» propio.
- `src/app/[slug]/pedido/[code]/not-found.tsx:17` — un `<Link href="..">`
  relativo.
- `src/app/[slug]/c/[categorySlug]/not-found.tsx:29` — **otro** `<Link href="..">`
  relativo, con el mismo defecto. No estaba en esta lista porque F-026 lo creó
  después de escribirse este documento (I10).
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
   presente en las **diez** pantallas públicas de tienda: catálogo de sucursal,
   **catálogo por categoría** (`/[slug]/c/[categorySlug]`, la que añadió F-026),
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
7. **El eslabón de categoría** (RESUELTO por SP4), en las dos pantallas donde
   hay dato: la vista de categoría (`{M}` › `{S}` › `{Categoría}`) y la ficha de
   producto (`{M}` › `{S}` › `{Categoría}` › `{Producto}`). No cuesta ninguna
   consulta nueva: `categoryName` y `categorySlug` ya viajan en `CatalogProduct`
   (`src/features/catalog/server/queries.ts:69-74`, rellenados en la línea
   275-276) y la ficha ya los pinta como chip
   (`src/app/[slug]/p/[productSlug]/page.tsx:194-201`); el `href` lo construye
   `storeCategoryPath()` (`src/features/catalog/storeCategories.ts:78`), que ya
   usa el slug canónico.
8. **La sustitución** del `<Link href="..">` relativo de
   `src/app/[slug]/c/[categorySlug]/not-found.tsx:29` por una salida con slug
   canónico. Es exactamente el defecto de I3 —el relativo conserva el slug
   pedido, así que entrando por un alias devuelve al alias—, sobre un archivo
   que F-026 creó después de escribirse I3 (I10).

### Fuera (explícito)

- **El historial del navegador.** No se lee, no se manipula, no se detecta si
  existe. Nada de `history.back()`, `router.back()` ni `document.referrer`.
- **El panel de admin** (`src/app/admin/**`). Ya tiene su propio patrón «← X»
  repetido en siete páginas; unificarlo es otro trabajo y no lo ve ningún
  comprador.
- **Recordar de dónde venía el comprador.** El rastro es función de la URL, no
  del camino (R1). En particular, volver desde una ficha a los resultados de
  búsqueda queda fuera: RESUELTO por SP2 — siempre al catálogo.
- **La subcategoría.** El eslabón de **categoría** ya no está fuera: entra por
  SP4 (§ Dentro, punto 7). F-026 no lo decidió, lo **delegó aquí** —
  «esta propuesta le entrega el dato (tienda › categoría › producto); la forma
  la decide F-025» (`.agent/specs/F-026/spec.md:543-544`), y su
  `.agent/specs/F-026/architecture.md:739-744` repite que el dato está. Lo que
  **sigue fuera** es un segundo nivel de taxonomía: `LocalCategory` no tiene
  campo de padre y `GlobalCategory` solo tiene cuatro filas planas sin padre
  (`.agent/specs/F-026/spec.md:118-120` y § Datos de ese documento), y su SP1
  dejó las subcategorías como feature futuro. Sin dato no hay eslabón (R7).
- **Tocar `StoreCategoryNav`** (`src/components/store/StoreCategoryNav.tsx`).
  Su chip «Todo el catálogo» apunta a `/[slug]`, igual que el «atrás» del rastro
  en la vista de categoría, pero es un **selector**, no navegación de cabecera:
  mismo reparto que con `BranchBar` (R14, R21).
- **Conservar filtros y ordenamientos al volver.** F-027.
- **Tocar `BranchBar`** (`src/components/store/BranchBar.tsx`). Sigue igual: es
  una **acción** («Cambiar de sucursal»), no una ubicación. RESUELTO por SP3.
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
- **F-026 también está en `passes: true`**, y desde SP4 es una dependencia real
  aunque no figure en el `depends_on` de F-025 (I11). Aporta la décima pantalla,
  `categorySlug` en `CatalogProduct` y `storeCategoryPath()`.
- No hace falta ninguna consulta nueva: `brandSlug`, `brandName`,
  `canonicalSlug` y `branchCount` ya vienen en `BranchResolution`
  (`src/features/storefront/server/resolve.ts:41`), y el nombre del producto, el
  término de búsqueda y el código del pedido ya los tiene cargados cada página
  (R7). Lo mismo vale para el eslabón nuevo: `categoryName`/`categorySlug`
  vienen en la fila del producto (`src/features/catalog/server/queries.ts:275-276`)
  y la vista de categoría ya tiene `view.category` en la mano
  (`src/app/[slug]/c/[categorySlug]/page.tsx:120`).

## Comportamiento esperado

**E1 — el catálogo de una marca de una sola sucursal es el techo.**
Dada `tienda-demo`, marca con una única sucursal, cuando el comprador abre
`/tienda-demo`, entonces el rastro tiene **un solo eslabón** —el nombre de la
tienda, sin enlace, `aria-current="page"`— y **no** se dibuja ningún control de
«atrás» (RESUELTO por SP1: así es, sin excepción).

**E2 — bajo una marca con varias sucursales, el catálogo cuelga de la marca.**
Dada una marca con dos sucursales renderizables (`bodega-uno` agrupada con
`bodega-dos`, como monta `.agent/specs/F-017/smoke.sh`), cuando el comprador
abre `/bodega-uno`, entonces el rastro es `{Marca} › {Bodega Uno}` con el primer
eslabón enlazando a `/{brandSlug}` y el segundo sin enlace, y el control de
«atrás» apunta a `/{brandSlug}`.

**E3 — la ficha de producto cuelga de su categoría.**
Dada la ficha `/tienda-demo/p/{productSlug}` de un producto **con** categoría,
cuando se renderiza, entonces el rastro es
`{M} › {S} › {Categoría} › {nombre del producto}`: el último eslabón es el
nombre del producto sin enlace, el **penúltimo es la categoría**, con el `href`
que devuelve `storeCategoryPath(store.canonicalSlug, product.categorySlug)`
(`/tienda-demo/c/{categorySlug}`), y el control de «atrás» apunta a esa misma
URL de categoría. El eslabón de la sucursal sigue ahí, un escalón más arriba,
con `href="/tienda-demo"`. Todo ello está en el HTML servido, antes de cualquier
JavaScript. Hasta el 2026-08-31 este escenario decía que el penúltimo eslabón
era la sucursal; lo cambia SP4, y que el «atrás» le siga a la categoría en vez
de al catálogo lo zanja SP5 a favor de R2. Un producto **sin** categoría es
E19.

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

**E13 — una sucursal cerrada tiene el mismo rastro que una abierta, hasta donde
llega el dato.**
Dada `tienda-cerrada` (`status: SUSPENDED`), cuando el comprador abre
`/tienda-cerrada/carrito`, `/tienda-cerrada/checkout`, `/tienda-cerrada/buscar`,
`/tienda-cerrada/sucursales` o `/tienda-cerrada/pedido/{code}`, entonces
responde 200 con el aviso de cerrada y con **el mismo rastro** que tendría
abierta (R6): esas pantallas no necesitan leer el catálogo para etiquetar sus
eslabones.
En cambio `/tienda-cerrada/p/{cualquiera}` y `/tienda-cerrada/c/{cualquiera}`
**nunca leen el catálogo** cuando la tienda no está `PUBLISHED` —es HD11, y está
escrito en el código: `src/app/[slug]/p/[productSlug]/page.tsx:106-131` y
`src/app/[slug]/c/[categorySlug]/page.tsx:85-108`—, así que no existe el nombre
del producto ni el de la categoría y su rastro **se detiene en la sucursal**
(R20, I9). Sigue respondiendo 200 y sigue enseñando el teléfono y el WhatsApp
del negocio, que es lo que importaba: los trae el propio contenido de la página
(`src/components/store/StoreClosedNotice.tsx`), no el rastro.

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

**E18 — la vista por categoría tiene su propio rastro.**
Dada `/tienda-demo/c/bebidas` —la ruta que añadió F-026, ya en `passes: true`—,
cuando se renderiza, entonces el rastro es `{M} › {S} › Bebidas`: el último
eslabón lleva la etiqueta de `view.category.name`
(`src/app/[slug]/c/[categorySlug]/page.tsx:120`) sin enlace y con
`aria-current="page"`, el anterior es la sucursal con `href="/tienda-demo"`, y
el «atrás» apunta a `/tienda-demo`, el catálogo completo. La fila de chips de
`StoreCategoryNav` (`<nav aria-label="Categorías">`) se queda donde está y no
cuenta como segundo control de vuelta (R21).

**E19 — un producto sin categoría conserva el rastro corto.**
Dado un producto cuyo `localCategoryId` es nulo —un estado real, no hipotético:
un `CATEGORY`/`DELETE` del POS lo produce porque la clave ajena es
`ON DELETE SET NULL` (`.agent/specs/F-026/spec.md:165-169`)—, cuando se abre su
ficha, entonces `product.categorySlug` y `product.categoryName` valen `null`, el
eslabón de categoría **no se pone** (R7, R19) y el rastro vuelve a ser
`{M} › {S} › {Producto}` con el «atrás» en el catálogo. Es exactamente la misma
condición con la que hoy se pinta o no el chip de la ficha
(`src/app/[slug]/p/[productSlug]/page.tsx:194`): los dos campos, o ninguno.

**E20 — la vista por categoría de una tienda cerrada no tiene eslabón de
categoría.**
Dada `/tienda-cerrada/c/{lo-que-sea}`, que responde **200** con el aviso de
cerrada para cualquier `categorySlug`, exista o no —comprobado por F-026 en
`.agent/specs/F-026/smoke.sh:203-204`—, cuando se renderiza, entonces el rastro
es `{M} › {S}` con la sucursal como eslabón actual (sin `href`,
`aria-current="page"`) y sin control de «atrás» si la marca tiene una sola
sucursal (R2, R20). Es la única forma honesta: la página no leyó el catálogo, no
tiene nombre que poner, y poner el `categorySlug` crudo de la URL sería inventar
una etiqueta que el comerciante nunca escribió.

**E21 — una categoría que ya no existe sale de la tienda por la puerta canónica.**
Dada `/bodega-central-vedado/c/no-existe`, que hoy responde 404 dentro del marco
de la tienda con `src/app/[slug]/c/[categorySlug]/not-found.tsx`, cuando se
renderiza, entonces su salida al catálogo usa el slug **canónico**
(`/bodega-central`) y ya no el `<Link href="..">` relativo de la línea 29, que
devuelve al alias por el que se entró (I3, I10). `not-found.tsx` no recibe
`params` en Next: el apaño que se elija tiene que ser **uno solo**, el mismo que
para `src/app/[slug]/pedido/[code]/not-found.tsx` — lo cierra `sdd-architect`.

## Reglas de negocio

- **R1 — el rastro es función de la URL resuelta, y de nada más.** Ni historial,
  ni `Referer`, ni cookie, ni parámetro de procedencia. Dos compradores en la
  misma URL ven exactamente el mismo rastro.
- **R2 — el «atrás» es el penúltimo eslabón.** Un rastro de un solo eslabón no
  dibuja «atrás». Una sola definición para las dos cosas que pidió el humano:
  imposible que se contradigan. **Desde SP4 esto tiene una consecuencia
  concreta**: el penúltimo eslabón de la ficha de producto es la categoría, así
  que el «atrás» de la ficha va a `/[slug]/c/[categorySlug]`, no al catálogo
  completo. Entre R2 y la lectura literal de SP2 **gana R2** (RESUELTO por SP5),
  y SP2 queda **matizado, no roto**: SP2 se escribió contra marcar la
  procedencia en la URL (`?from=buscar&q=…`), que obligaría a leer
  `searchParams` en la ficha, la volvería `ƒ` y rompería el criterio 1 de F-004
  (I7). La categoría no incurre en nada de eso: es un segmento de ruta
  determinista, sin `searchParams`, y F-026 dejó esa ruta pre-renderizada en `●`
  (`.agent/specs/F-026/tests.md:70`). Volver desde una ficha a los **resultados
  de búsqueda** sigue estando fuera, exactamente como decidió SP2. Un producto
  sin categoría vuelve al catálogo por R19, que es la regla, no una excepción.
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
  mismo sitio, en las diez pantallas. En `/[slug]` y en `/[slug]/c/[categorySlug]`
  la pila real es `BranchBar` → `StoreSearchBox` → `<h1>` → `StoreCategoryNav` →
  rejilla (`src/app/[slug]/page.tsx:139-154`,
  `src/app/[slug]/c/[categorySlug]/page.tsx:128-145`): el rastro entra por
  encima de todo eso, y la fila de chips no se mueve.
- **R11 — etiquetas.** Marca: `Storefront.name`. Sucursal: `Store.name`.
  Categoría: `LocalCategory.name` tal y como llega en `categoryName` /
  `view.category.name` — nunca el `categorySlug` de la URL (E20). Producto: el
  nombre del producto. Búsqueda: `Buscar «{término normalizado}»`.
  Pedido: `Pedido {formatOrderCode(code)}`. Carrito: `Carrito`. Checkout:
  `Pagar`. Cambio de sucursal: `Cambiar de sucursal`. Todas en español
  (AGENTS.md § Idioma); el código, en inglés.
- **R12 — el rastro nunca colapsa eslabones.** Nada de «…» que expanda al
  pulsar: eso es JavaScript. En pantallas estrechas se recorta cada eslabón
  (E17), no se esconde ninguno.
- **R13 — `BreadcrumbList` solo donde se indexa.** En `/[slug]` (modo sucursal y
  modo selector), en `/[slug]/p/[productSlug]` y **también en
  `/[slug]/c/[categorySlug]`**. Este último se comprobó en el código, no se
  supuso: su `generateMetadata` pone `robots: { index: false }` **solo** en la
  rama de tienda cerrada (`src/app/[slug]/c/[categorySlug]/page.tsx:50-52`); la
  rama publicada devuelve título, descripción y `alternates.canonical` sin
  ningún `robots`, con el comentario «indexable on purpose, no
  `robots: { index: false }` — unlike `/[slug]/buscar`, which sets it
  deliberately» (líneas 63-69). Corolario coherente con esa misma rama: una
  tienda cerrada no lleva `BreadcrumbList` en ninguna de sus pantallas, porque
  todas se declaran no indexables. Nunca en `/carrito`, `/checkout`,
  `/pedido/[code]`, `/sucursales` ni `/buscar`: las cinco declaran
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
- **R18 — el rastro no rompe el estático.** `/[slug]`,
  `/[slug]/p/[productSlug]` y `/[slug]/c/[categorySlug]` siguen marcándose `●`
  en el build —las tres lo están hoy (`.agent/specs/F-026/tests.md:70`)—.
  Cualquier implementación que necesite `headers()`, `cookies()` o
  `searchParams` en esas rutas está descartada por esta regla (I1, I7).
- **R19 — sin categoría no hay eslabón de categoría.** Si
  `product.categorySlug` o `product.categoryName` es `null`, la ficha pinta
  `{M} › {S} › {Producto}` y su «atrás» vuelve a ser el catálogo (E19). Es R7
  aplicado —«si un eslabón necesitara un dato que no está, el eslabón no se
  pone»—, no una excepción a R2: el penúltimo eslabón sigue siendo el destino
  del «atrás»; lo que cambia es cuál es el penúltimo. Nunca se inventa una
  categoría «Sin categoría», que es la misma decisión que ya tomó F-026 para su
  selector (`.agent/specs/F-026/spec.md:153-158`).
- **R20 — en una tienda cerrada el rastro se detiene donde se acaba el dato.**
  `/[slug]/p/[productSlug]` y `/[slug]/c/[categorySlug]` no leen el catálogo
  cuando `Store.status !== "PUBLISHED"` (HD11), así que su último eslabón es la
  sucursal, sin `href` y con `aria-current="page"` (E13, E20, I9). Las demás
  pantallas cerradas conservan su rastro completo, y con ellas el criterio 7 de
  `.agent/features.json`, que es sobre `/tienda-cerrada/carrito`. Esta regla
  **matiza R6**, que se escribió sin mirar HD11.
- **R21 — el rastro no es el selector de categorías, y no lo sustituye.**
  `src/components/store/StoreCategoryNav.tsx` sigue tal cual en `/[slug]` y en
  `/[slug]/c/[categorySlug]`. Que su chip «Todo el catálogo» apunte al mismo
  sitio que el «atrás» del rastro no viola R14: uno es un **selector** —la misma
  categoría de cosa que `BranchBar`— y el otro es la ubicación. Las dos
  regiones son `<nav>` con `aria-label` distinto («Ruta» y «Categorías»), así
  que un lector de pantalla las distingue por nombre.
- **R22 — la etiqueta y el destino de la categoría salen de un solo sitio.**
  Etiqueta: `categoryName` (ficha) o `view.category.name` (vista de categoría).
  Destino: `storeCategoryPath(store.canonicalSlug, categorySlug)`
  (`src/features/catalog/storeCategories.ts:78`), nunca una plantilla escrita a
  mano — es lo que garantiza R3 sobre esta ruta y lo que hace que un cambio en
  `CATEGORY_ROUTE_SEGMENT` (`src/constants/catalog.ts`) no deje el rastro
  apuntando a una URL muerta.

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
- **Producto sin categoría.** Rastro de tres eslabones y «atrás» al catálogo
  (E19, R19). No se inventa etiqueta ni se deja un eslabón vacío: `null` en
  `categorySlug`/`categoryName` es un estado esperado, no un error.
- **Categoría inexistente, mal formada, de otra sucursal o que se quedó sin
  productos visibles.** Las cuatro dan 404 hoy, por diseño de F-026
  (`src/app/[slug]/c/[categorySlug]/page.tsx:118`, «cero productos visibles ⇒
  `notFound()`»; nunca una lista vacía). Ese 404 se pinta dentro del marco de la
  tienda con `src/app/[slug]/c/[categorySlug]/not-found.tsx`, y lo único que
  cambia aquí es su salida: slug canónico en vez de `href=".."` (E21, I10).
- **Un producto visible cuya categoría no tiene vista.** No puede ocurrir por
  construcción: `getStoreCategoryView` deriva la categoría de la misma lista de
  productos visibles (`src/features/catalog/server/queries.ts:321-337`), así que
  si el producto se ve, su categoría tiene al menos un producto y su URL
  responde 200. El eslabón de categoría de la ficha nunca apunta a un 404
  **dentro de la misma sucursal**. La excepción conocida y aceptada: los
  resultados de búsqueda, que proyectan `categorySlug` desde otra consulta
  (`src/features/catalog/server/search.ts:214-215`) — pero la búsqueda no pinta
  eslabón de categoría (§ Datos y contrato).
- **Nombre de categoría largo junto a nombre de producto largo, en 360 px.** La
  ficha pasa a tener cuatro eslabones y dos de ellos pueden venir del POS sin
  ningún tope de longitud. **E17 basta como regla** —recorte visual por CSS,
  texto completo en el DOM, sin desplazamiento horizontal— y R12 sigue
  prohibiendo colapsar eslabones. Lo que E17 no dice, y sigue sin decirse a
  propósito, es **cómo se reparte el ancho** entre cuatro eslabones cuando dos
  compiten: es aspecto, lo cierra `sdd-designer` (§ No decidido a propósito),
  con el precedente de que el `<h1>` de la vista de categoría ya usa
  `break-words` (`src/app/[slug]/c/[categorySlug]/page.tsx:136`).
- **Renombrar o borrar una categoría en el POS con la ficha en caché.** No hace
  falta invalidación nueva y esta vez se puede afirmar, no suponer: la etiqueta
  del eslabón sale de `getStoreCatalog()`, la **misma** lectura cacheada que ya
  pinta el producto, tageada con `storeCatalogTag(canonicalSlug)`
  (`src/features/catalog/server/queries.ts:283-289`, `src/lib/cache.ts:29`) y
  expirada por `revalidateStores()` (`src/lib/cache.ts:86-91`), que es lo que
  dispara el handler de `CATEGORY` que F-026 reescribió. Y el nombre ya no puede
  quedarse rancio por entrega desordenada: F-026 **cerró su I8** añadiendo la
  guarda anti-rancia a `handleCategory`
  (`.agent/specs/F-026/architecture.md:549-556`,
  `src/features/sync/server/handlers/misc.ts`) precisamente porque «deja de dar
  igual en cuanto el nombre es un elemento de navegación» — que es lo que este
  feature acaba de convertirlo. La comprobación sigue siendo obligatoria: mismo
  fallo fichado en
  `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`.
- **Alias de sucursal en la vista de categoría.** `/bodega-central-vedado/c/x`
  responde 200 sin redirección (F-026, RD7) y su rastro habla en `bodega-central`
  por R3 + R22, porque `storeCategoryPath()` recibe `store.canonicalSlug`.
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

**El tipo sigue bastando con SP4 dentro.** Un eslabón de categoría es un
`Crumb` más —etiqueta y `href`—, no una clase distinta de eslabón: `backTarget`
sigue siendo «el penúltimo» y el `BreadcrumbList` sigue siendo «la lista
numerada». No hace falta ni un campo de tipo de eslabón ni una variante. Lo
único que cambia es **quién construye el rastro de la ficha**: necesita recibir
`categoryName` y `categorySlug`, los dos anulables, y no poner el eslabón si
alguno falta (R19). Anulables **a la vez**: `CatalogProduct` los rellena de la
misma fila (`src/features/catalog/server/queries.ts:275-276`), así que «uno sí y
otro no» no es un estado alcanzable — y aun así el constructor exige los dos,
como ya hace el chip de la ficha.

Tabla del rastro por ruta (`{M}` = marca, presente solo si `branchCount > 1`,
R4; `{S}` = sucursal):

| Ruta                                                | Rastro                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/[slug]` selector                                  | `{M}`                                                                         |
| `/[slug]` sucursal                                  | `{M}` › `{S}`                                                                 |
| `/[slug]/c/[categorySlug]`                          | `{M}` › `{S}` › `{Categoría}` — nuevo, SP4 (E18)                              |
| `/[slug]/p/[productSlug]`                           | `{M}` › `{S}` › `{Categoría}` › `{nombre del producto}` — cambia con SP4 (E3) |
| `/[slug]/p/[productSlug]` sin categoría             | `{M}` › `{S}` › `{nombre del producto}`, como antes de SP4 (E19, R19)         |
| `/[slug]/buscar` sin `q`                            | `{M}` › `{S}` › `Buscar`                                                      |
| `/[slug]/buscar?q=…`                                | `{M}` › `{S}` › `Buscar «{término}»`                                          |
| `/[slug]/carrito`                                   | `{M}` › `{S}` › `Carrito`                                                     |
| `/[slug]/checkout`                                  | `{M}` › `{S}` › `Carrito` › `Pagar`                                           |
| `/[slug]/pedido/[code]`                             | `{M}` › `{S}` › `Pedido {código}`                                             |
| `/[slug]/sucursales`                                | `{M}` › `{S}` › `Cambiar de sucursal`                                         |
| `/[slug]/p/…` y `/[slug]/c/…` con la tienda cerrada | `{M}` › `{S}` — el dato no se lee (R20, E13, E20)                             |

La búsqueda **no** gana eslabón de categoría aunque sus filas también traigan
`categorySlug` (`src/features/catalog/server/search.ts:214-215`): sus resultados
mezclan categorías, así que no hay una a la que colgarlos. La ficha a la que se
llega desde la búsqueda sí lo tiene, porque el rastro es función de la URL de la
ficha y de nada más (R1).

Límites: cada `label` se recorta visualmente por CSS, no en el servidor (E17).
Ninguna etiqueta se trunca en el DOM salvo el término de búsqueda, que ya llega
truncado a `SEARCH_TERM_MAX_LENGTH` desde F-021.

## Criterios de aceptación propuestos

Los 14 ya están en `.agent/features.json` bajo F-025 (marcados `[ya]`). Se
verifican con `curl` contra `next start` y con el build, salvo C2, que necesita
la etapa `--visual` del arnés.

Los siete `[nuevo]` (15-21) salen de SP4 y **todavía no están en
`.agent/features.json`**: ese archivo es del humano (reglas 3 y 4), así que este
agente no lo toca. Se le proponen tal cual están escritos aquí; hasta que él los
añada, `passes: true` de F-025 se decide con los 14 de siempre y estos siete se
verifican igual, pero cuentan como comprobación extra, no como criterio del
backlog.

1. `[ya]` `curl -s http://localhost:3000/tienda-demo/p/<slug>` devuelve HTML que
   contiene un `<nav aria-label="Ruta">`, dentro de él un `<a href="/tienda-demo">`
   y, como último elemento de la lista, el nombre del producto con
   `aria-current="page"` y **sin** `href`.
2. `[ya]` Con JavaScript deshabilitado (`page.setJavaScriptEnabled(false)` en
   `visual.mjs`), pulsar el eslabón de la sucursal en la ficha de producto
   navega a `/tienda-demo` y la página resultante responde 200.
3. `[ya]` `npm run build` sigue marcando `/[slug]` y `/[slug]/p/[productSlug]` como `●`
   (SSG), no como `ƒ` — el criterio 1 de F-004 no se degrada.
4. `[ya]` `grep -rn "use client" src/features/storefront/ src/components/store/` no
   devuelve ninguna línea de los archivos de este feature, y
   `node scripts/check-bundle-budget.mjs` termina con código 0 **sin** haber
   subido `BUDGET_KB` en `scripts/check-bundle-budget.mjs`.
5. `[ya]` En una marca con dos sucursales (montada como en `.agent/specs/F-017/smoke.sh`),
   `GET /bodega-uno/carrito` contiene **tres** eslabones y el segundo enlaza a
   `/bodega-uno`; `GET /tienda-demo/carrito` contiene **dos** y ninguno enlaza a
   un slug de marca distinto de `tienda-demo`.
6. `[ya]` `GET /bodega-central-vedado/carrito` contiene `href="/bodega-central"` dentro
   del `<nav aria-label="Ruta">` y **cero** apariciones de
   `bodega-central-vedado` dentro de ese `<nav>`. Las dos URL siguen
   respondiendo 200.
7. `[ya]` `GET /tienda-cerrada/carrito` responde 200 y su rastro apunta a
   `/tienda-cerrada`, idéntico al de una tienda abierta.
8. `[ya]` `GET "/tienda-demo/buscar?q=<300 caracteres>"` responde 200 y el `<nav aria-label="Ruta">`
   contiene el término truncado a `SEARCH_TERM_MAX_LENGTH`, no el crudo.
9. `[ya]` `GET /tienda-demo/p/no-existe` responde **404** y su HTML contiene
   `data-store="tienda-demo"` y un enlace a `/tienda-demo`; hoy contiene
   «Volver al inicio» y ningún `data-store`.
10. `[ya]` `GET /tienda-demo/p/<slug>` contiene un
    `<script type="application/ld+json">` con `"@type":"BreadcrumbList"`, y
    `GET /tienda-demo/carrito` **no** lo contiene.
11. `[ya]` `GET /bodega-uno/sucursales` contiene exactamente **un** control de vuelta:
    la cadena `Volver a` ya no aparece en su HTML.
12. `[ya]` `GET /tienda-demo` (marca de una sucursal) contiene el `<nav aria-label="Ruta">`
    con un solo eslabón y sin ningún `<a>` dentro (RESUELTO por SP1).
13. `[ya]` El número de consultas a la base que ejecuta `/tienda-demo/p/<slug>` es el
    mismo antes y después del cambio, medido con el log de consultas de Prisma y
    anotado en `tests.md` (R7).
14. `[ya]` `bash .agent/verify.sh F-025 --full` termina con código 0.
15. `[nuevo]` `curl -s http://localhost:3000/tienda-demo/c/bebidas` responde 200
    y su HTML contiene un `<nav aria-label="Ruta">` que incluye
    `href="/tienda-demo"` y, como último elemento de la lista, `Bebidas` con
    `aria-current="page"` y **sin** `href`.
16. `[nuevo]` `curl -s http://localhost:3000/tienda-demo/p/jugo-de-mango-1-l`
    contiene, **dentro** del `<nav aria-label="Ruta">`, `href="/tienda-demo/c/bebidas"`,
    y su último elemento es `Jugo de mango 1 L` con `aria-current="page"` y sin
    `href`: tres eslabones, no dos (`tienda-demo` es marca de una sola sucursal,
    R4).
17. `[nuevo]` Tras enviar un `PRODUCT`/`UPDATE` firmado con
    `"localCategoryId":null` sobre ese mismo producto —el mismo generador de
    eventos que ya usa `.agent/specs/F-026/smoke.sh:140-145`—,
    `GET /tienda-demo/p/jugo-de-mango-1-l` **no** contiene
    `href="/tienda-demo/c/bebidas"` dentro del `<nav aria-label="Ruta">` y su
    rastro queda en dos eslabones; reenviar el evento con su `localCategoryId`
    original lo restaura (comprobación no destructiva, R19/E19).
18. `[nuevo]` `GET /tienda-demo/c/bebidas` contiene un
    `<script type="application/ld+json">` con `"@type":"BreadcrumbList"` y tres
    `"position"`, y `GET /tienda-cerrada/c/<cualquier-cosa>` responde 200 y **no**
    lo contiene (R13, R20).
19. `[nuevo]` `npm run build` sigue marcando `/[slug]/c/[categorySlug]` como `●`
    (SSG), no como `ƒ` — hoy lo es (`.agent/specs/F-026/tests.md:70`), y este
    feature no puede degradarlo (R18).
20. `[nuevo]` `GET /bodega-central-vedado/c/<categoría con stock>` responde 200 y
    su `<nav aria-label="Ruta">` contiene `href="/bodega-central"` y **cero**
    apariciones de `bodega-central-vedado` (R3, R22).
21. `[nuevo]` `GET /bodega-central-vedado/c/no-existe` responde 404 y su HTML
    contiene un enlace a `/bodega-central`, con **cero** apariciones de
    `href=".."` y cero de `bodega-central-vedado` (E21, I10).

**Ninguno de los 14 existentes queda invalidado por SP4**, comprobado uno a uno
contra la redacción literal de `.agent/features.json`:

- **El 1 sobrevive.** Pide «un `<a href="/tienda-demo">`» y «como último
  elemento, el nombre del producto con `aria-current="page"` y sin href»: las
  dos cosas siguen siendo ciertas con la categoría en medio, porque el eslabón
  de la sucursal no desaparece, solo deja de ser el penúltimo. Lo que **no**
  dice el criterio 1 —y por eso no se rompe— es que el penúltimo sea la
  sucursal; eso lo decía E3 de este documento, y es lo que se ha corregido.
- **El 2 sobrevive**: habla del «eslabón de la sucursal», que sigue existiendo y
  sigue llevando a `/tienda-demo`. Deja de ser el control de «atrás», pero el
  criterio nunca dijo que lo fuera.
- **El 10 sobrevive** y se queda corto: sigue siendo cierto que la ficha lleva
  `BreadcrumbList` y el carrito no. No cubre la ruta de categoría, que ahora
  también es indexable — por eso el 18.
- **El 12 sobrevive con una precaución de redacción**: «sin ningún `<a>` dentro»
  hay que evaluarlo **dentro del `<nav aria-label="Ruta">`**, porque desde F-026
  `/tienda-demo` monta además un `<nav aria-label="Categorías">` lleno de `<a>`
  (`src/components/store/StoreCategoryNav.tsx`). El criterio ya dice «el rastro»,
  así que se cumple; quien escriba el `smoke.sh` tiene que acotar el `grep` a
  ese `<nav>` o medirá el otro.
- **El 13 sobrevive y se vuelve más valioso**: el eslabón de categoría reusa
  `product.categoryName`/`categorySlug` de la fila que la ficha ya carga, así
  que el número de consultas no cambia. Si alguna implementación llamara a
  `getStoreCategoryView` desde la ficha, este criterio la pillaría.

Si el humano prefiere que el criterio 1 diga explícitamente que el penúltimo
eslabón de la ficha es la categoría, eso **no** se reformula en
`.agent/features.json` (regla 3): se añade como criterio nuevo. Aquí ese papel
lo hace el 16.

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
  sucursal»); las dos pintan `BranchList` con distinto `variant`. RESUELTO por
  SP3: el eslabón de marca apunta al selector.
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
  desde entonces. RESUELTO por SP2: siempre al catálogo.
- **I8 — «siempre» no es literalmente posible.** En `/tienda-demo` (marca de una
  sola sucursal) no hay ninguna página padre **dentro de la tienda**. RESUELTO
  por SP1: no se dibuja «atrás» en la raíz.
- **I9 — una tienda cerrada no tiene con qué etiquetar su último eslabón, y este
  documento daba por hecho que sí.** E13 decía «rastro completo» para
  `/tienda-cerrada/p/{cualquiera}`, pero la ficha corta antes de leer el
  producto cuando `Store.status !== "PUBLISHED"`
  (`src/app/[slug]/p/[productSlug]/page.tsx:106-131`, HD11: «the closed notice,
  WITHOUT reading the product — not even to decide it exists»), y F-026 copió
  ese mismo patrón en la vista de categoría
  (`src/app/[slug]/c/[categorySlug]/page.tsx:85-108`), que además responde 200
  para **cualquier** `categorySlug`, exista o no. O se abre una consulta —contra
  HD11 y contra R7— o el rastro se detiene en la sucursal. Se resuelve por
  escrito con R20: se detiene. La mitad de la ficha es preexistente; la de la
  categoría la trajo F-026.
- **I10 — el defecto de I3 se ha duplicado mientras esta spec esperaba.**
  `src/app/[slug]/c/[categorySlug]/not-found.tsx:29` vuelve a resolver la salida
  con `<Link href="..">`. Su comentario razona bien la **profundidad** —desde
  `/[slug]/c/[categorySlug]`, `..` cae en `/[slug]/`, y así es— pero no el
  **slug**: la resolución relativa conserva el que pidió el navegador, así que
  entrando por `bodega-central-vedado` la salida es `bodega-central-vedado`,
  contra `src/lib/publicSlug.ts:1-12` y contra ADR 0018. Son ya dos archivos con
  el mismo apaño (`src/app/[slug]/pedido/[code]/not-found.tsx:17`) y ninguno de
  los dos puede leer `params`: la solución tiene que ser una, no dos (E21).
- **I11 — el `depends_on` de F-025 no incluye F-026, y desde SP4 debería.**
  `.agent/features.json` lista `["F-004","F-010","F-017","F-021"]`, pero el
  eslabón de categoría se apoya en la ruta, el campo `categorySlug` y
  `storeCategoryPath()` que trajo F-026. **No bloquea nada**: F-026 está en
  `passes: true`, así que la regla 5 se cumple igual. Se anota porque el
  `depends_on` es del humano (regla 4) y porque un lector futuro que reordene el
  backlog necesita ver esa flecha.

## Huecos y preguntas al humano

**SP1 — ¿cuál es el techo de la navegación: la tienda o la plataforma?
RESUELTO por el humano el 2026-08-29: opción (a).**
No se dibuja «atrás» en la raíz de una tienda (marca de una sola sucursal, o
`/{brandSlug}` en modo selector): el rastro empieza en la marca y nunca sale
hacia la landing comercial de la plataforma (`src/app/(marketing)/page.tsx`),
que hoy está dirigida a comerciantes, no a compradores. Si algún día existe un
marketplace/directorio de tiendas de verdad, se añade el eslabón entonces y
ninguna otra regla de este documento cambia.

**SP2 — ¿volver desde una ficha de producto a los resultados de búsqueda?
RESUELTO por el humano el 2026-08-29: opción (c).**
Siempre al catálogo completo por ahora (el buscador sigue visible en la ficha).
Se reabre como cambio futuro si el registro de consultas de F-021
(`recordStoreSearchQuery`) muestra que la búsqueda es la puerta de entrada
mayoritaria — en ese momento se decide si vale la pena volver `ƒ` la ficha de
producto para soportar `?from=`.

> **Matizado por SP5 el 2026-08-31, no revocado.** Lo que SP2 cerró —no volver a
> los **resultados de búsqueda**, no marcar la procedencia en la URL— sigue
> cerrado exactamente igual. Lo que cambia es que «el catálogo completo» deja de
> ser el destino del «atrás» de la ficha **cuando el producto tiene categoría**:
> pasa a serlo su categoría, que es su padre jerárquico real y una URL estática
> sin `searchParams` (R2, E3). Sin categoría, el destino vuelve a ser el
> catálogo completo, tal cual dice SP2 (R19, E19).

**SP3 — ¿a dónde apunta el eslabón de la marca: al selector o a «cambiar de
sucursal»? RESUELTO por el humano el 2026-08-29: opción (a).**
Al selector `/{brandSlug}`, que es el padre jerárquico real. `/[slug]/sucursales`
sigue siendo la **acción** «Cambiar de sucursal» que enlaza `BranchBar` (con su
aviso sobre el carrito) — no se funde con el selector.

**SP4 — F-026 añadió `/[slug]/c/[categorySlug]` y dejó escrito que «la forma del
breadcrumb la decide F-025; el dato está». Esta spec es anterior y dejó el
eslabón de categoría fuera. ¿Qué alcance le damos? RESUELTO por el humano el
2026-08-31: «Ambos: pantalla + eslabón».**
Literal de la opción elegida: «La vista de categoría gana su rastro
(`{M} › {S} › {Categoría}`) y la ficha de producto pasa a
`{M} › {S} › {Categoría} › {Producto}`. El dato ya está en la página
(`product.categorySlug`/`categoryName`, ya se pinta el chip en la línea 194), así
que no cuesta consulta nueva. Habría que añadir 1-2 `acceptance_criteria` a
`features.json` — ese archivo es tuyo.» Comprobado en el código antes de
escribirlo: el chip está en `src/app/[slug]/p/[productSlug]/page.tsx:194-201`,
los dos campos se rellenan en `src/features/catalog/server/queries.ts:275-276`
desde la misma fila, y el `href` lo da
`storeCategoryPath()` (`src/features/catalog/storeCategories.ts:78`). Los
criterios que hacen falta son siete, no dos (15-21), porque además de las dos
pantallas hay que fijar el caso sin categoría, el JSON-LD de la ruta nueva, el
`●` del build, el alias y el 404 de categoría.

**SP5 — con el eslabón de categoría dentro chocan R2 («atrás» es el penúltimo
eslabón) y SP2 (desde una ficha siempre se vuelve al catálogo completo). ¿Cuál
gana? RESUELTO por el humano el 2026-08-31: «Gana R2: atrás va a la categoría».**
Literal de la opción elegida: «Una sola definición para rastro y atrás,
imposible que se contradigan — que es justo por lo que R2 existe. SP2 se
escribió contra el historial de búsqueda (`?from=`), no contra la categoría:
volver a la categoría sigue siendo una URL determinista, estática y sin
`searchParams`. Se anota SP2 como matizado, no como roto.» Escrito en R2 y en la
nota de SP2; el producto **sin** categoría no es una excepción a esto sino una
aplicación de R7, y vive en R19/E19.

## No decidido a propósito

- **Un eslabón de _subcategoría_ entre la categoría y el producto.** El de
  categoría ya está decidido (SP4) y esta viñeta deja de aplicarle. El segundo
  nivel sigue sin decidirse porque **no hay dato**: `LocalCategory` no tiene
  campo de padre y `GlobalCategory` solo tiene cuatro filas planas, como
  verificó F-026, que dejó las subcategorías como feature futuro (su SP1). Sin
  dato no hay eslabón (R7). Lo que sí se mantiene, y SP4 acaba de demostrar que
  valía la pena, es que el rastro sea una **lista construida** y no `JSX`
  escrito a mano por página: meter la categoría es añadir un elemento a la
  lista, no reescribir diez pantallas.
- **Conservar filtros y orden al volver** (`?orden=precio&marca=x` en el eslabón
  del catálogo). Mismo bloqueo que SP2: son `searchParams`. Lo cierra F-027.
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
