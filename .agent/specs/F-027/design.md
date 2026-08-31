---
feature: F-027
agente: sdd-designer
actualizado: 2026-08-31T18:30:37Z
estado: listo
---

> Escrito en paralelo con `sdd-architect` y **conciliado con
> `.agent/specs/F-027/architecture.md`**, que cerró en `estado: listo` mientras
> esto se escribía. Todo lo que este documento dice está diseñado con el
> **rótulo visible**, nunca con el nombre del parámetro: por eso la conciliación
> no cambió ni una etiqueta ni una pantalla. De la arquitectura se toman aquí
> tres cosas que el diseño necesita nombrar —la ruta es **`/[slug]/catalogo`**,
> la faceta de categoría viaja como parámetro **repetido** (que es exactamente
> lo que emiten unas casillas con el mismo `name`, sin una línea de JavaScript),
> y `CatalogFilterResult.applied` es **lo aplicado de verdad**, que es lo que
> pintan los chips (R18)—. Lo único que este diseño le sigue pidiendo al
> contrato está en § Lo que este diseño le pide al arquitecto, marcado como
> **abierto**.
>
> **Lo que el humano ya cerró y aquí no se reabre:** SP1 (no se ofrece «más
> vendido»), SP2 (el filtro de categoría reutiliza el vocabulario de F-026 sin
> renombrarlo), SP3 (filtro y orden por precio en la capa de aplicación, con
> `resolvePrice`), SP4 (el catálogo filtrado vive en una **ruta dinámica
> propia**, hermana de `/[slug]/buscar`; `/[slug]` se queda como está y solo gana
> un enlace) y SP5 (**conteos por faceta** aquí, y no en `/[slug]/buscar`). Y de
> la spec, R3: **ningún filtro va marcado por defecto**; «solo lo que hay» es
> opt-in.
>
> Lo que este documento cierra son los ocho huecos que `spec.md` § No decidido a
> propósito le asignó a diseño: la disposición del panel, las etiquetas en
> español (incluida la de «más reciente», honesta con **I9**), los tramos de
> precio, los chips de filtro aplicado, los tres vacíos, la paginación, el enlace
> de entrada y la accesibilidad. **No queda ninguna pregunta abierta.**

## Qué se miró antes de diseñar

`AGENTS.md` entero —§ Prohibiciones (la de `"use client"` en cualquier cosa que
renderice catálogo, que aquí es la regla que decide el diseño), § El presupuesto
de JavaScript no es un muro, § Cosas que muerden, § Idioma—, el feature F-027
completo en `.agent/features.json` (16 criterios y `notes`),
`.agent/specs/F-027/spec.md` de punta a punta (E1–E22, R1–R20, la tabla de casos
límite, I1–I10, SP1–SP5 y § No decidido a propósito) y
`.agent/progress/F-027.md`.

Los tres diseños hermanos que comparten pantalla con este:
`.agent/specs/F-021/design.md` (la caja de búsqueda),
`.agent/specs/F-025/design.md` (el rastro) y `.agent/specs/F-026/design.md` (la
fila de categorías) — de este último, además, la lección de teclado que costó un
`fix`.

Del código: `src/app/[slug]/page.tsx`, `src/app/[slug]/buscar/page.tsx`,
`src/app/[slug]/layout.tsx`, los diez de `src/components/store/`
(`ProductCard.tsx`, `StoreSearchBox.tsx`, `StoreSearchResults.tsx`,
`StoreCategoryNav.tsx`, `StoreTrail.tsx`, `StoreClosedNotice.tsx`,
`BranchBar.tsx`), los de `src/components/ui/` (`Button.tsx`, `Alert.tsx`,
`Field.tsx`, `Card.tsx`, `Badge.tsx`, `Container.tsx`), `src/lib/pricing.ts`,
`src/lib/money.ts`, `src/lib/availability.ts`, `src/constants/storeSearch.ts`,
`src/features/storefront/trail.ts`, `src/theme/tokens.css` y
`scripts/check-bundle-budget.mjs`.

### Se miró la pantalla de verdad, y con números

Levanté `next dev` **en el 3200** después de comprobar que ningún otro proceso
lo ocupaba (`AGENTS.md` § Cosas que muerden: «comprueba el directorio del
proceso antes de creerte lo que ves»; el único `node` escuchando en esta máquina
era un 5173 ajeno). Todo lo de abajo está medido contra ese servidor y contra la
base de desarrollo ya sembrada, con Playwright, no estimado.

**Geometría de hoy de `/tienda-demo`** (arriba en px desde el inicio del
documento; ancho útil de `Container`, 328 px a 360):

| Elemento                      | 360 | 768 | 1280 |
| ----------------------------- | --- | --- | ---- |
| Rastro (F-025)                | 84  | 84  | 84   |
| Caja de búsqueda (F-021)      | 144 | 144 | 144  |
| `<h1>Catálogo</h1>` (32 alto) | 220 | 220 | 220  |
| Fila de categorías (F-026)    | 332 | 308 | 308  |
| **Primera fila de tarjetas**  | 416 | 392 | 392  |

Ese 416 es el presupuesto que este feature no puede empeorar: en un móvil de
800 px de alto ya solo entra media tarjeta.

**El prototipo, inyectado en la página real y medido en su sitio** (no
estimado): panel, chips y enlace de entrada, con las cuatro categorías reales de
`tienda-demo` y, en la segunda columna, con las quince que F-026 midió como
techo realista.

| Pieza                                               | 360             | 768 | 1280 |
| --------------------------------------------------- | --------------- | --- | ---- |
| Panel **plegado** (solo el `<summary>`)             | **46**          | 46  | 46   |
| Panel **abierto**, 4 categorías                     | **869**         | 563 | 368  |
| Panel **abierto**, 15 categorías (con el tope de 8) | 1093            | 787 | 551  |
| Fila de chips, 1 filtro puesto                      | 44              | 44  | 44   |
| Fila de chips, **7 filtros** (el peor caso)         | **252**         | 96  | 96   |
| Fila del `<h1>` con el enlace de entrada            | **44** (era 32) | 44  | 44   |

Y tres medidas que deciden cosas concretas:

- **«Catálogo» + «Filtrar y ordenar» caben en una sola línea a 360 px**: 104 px
  el `<h1>`, 133 px el enlace, 12 px de hueco = 249 de los 328 disponibles.
  Medido, no calculado a ojo: `unaSolaLinea: true`.
- **Ningún ancho provoca desplazamiento horizontal de la página**
  (`scrollWidth === innerWidth` en 360, 768 y 1280, con el panel abierto y con
  siete chips).
- **El `<summary>` es el primer tabulador y `Enter` lo abre**, sin una línea de
  JavaScript; el orden de tabulación dentro del panel es exactamente el del DOM
  (`sum → select → desde → hasta → tramo → categoría → Aplicar`).

Y una comprobación que cambió una regla de este diseño: **una casilla marcada
dentro de un `<details>` cerrado se envía igual** (`FormData` devolvió
`cat=bebidas` con el panel plegado). Es decir, un filtro puesto puede quedarse
aplicándose sin que se vea. De ahí sale la regla de § Decisión 1 de que **un
grupo con algo aplicado llega abierto** — no es una cortesía, es lo que impide
un estado invisible.

También medí lo que un `<form method="get">` pelado escribe en la URL al pulsar
«Aplicar»: `precio_min=&precio_max=&orden=`. Los campos de texto vacíos y el
`<select>` **siempre** se envían. No hay manera de evitarlo sin JavaScript, y lo
que se hace con ello está en § Decisión 7.

### Y se miraron los precios de verdad, en la base

Contra la base de desarrollo ya sembrada (`prisma/seed.ts`), con el precio
**mostrado** —`priceOverride` si lo hay, convertido a la moneda de exhibición
del negocio con la tasa vigente, que es lo que compone `resolvePrice`—:

| Tienda                  | n   | mín | tercil 1 | mediana | tercil 2 | máx  |
| ----------------------- | --- | --- | -------- | ------- | -------- | ---- |
| `tienda-demo`           | 15  | 90  | 350      | 450     | 540      | 1150 |
| `tienda-dos`            | 5   | 245 | 470      | 600     | 880      | 1400 |
| `el-faro`               | 2   | 410 | —        | 410     | —        | 890  |
| `bodega-dos`            | 2   | 528 | —        | 528     | —        | 780  |
| `bodega-uno-2`          | 2   | 450 | —        | 450     | —        | 620  |
| `bodega-central-vedado` | 2   | 120 | —        | 120     | —        | 450  |

Los quince de `tienda-demo`, ordenados: 90, 120, 230, 260, 350, 380, 410, 450,
**528** (1.20 USD × 440), 540, 620, **737** (3.50 MLC × 210.5), 780, 890,
**1150** (override de 1250). Y el resto del inventario de facetas de esa tienda:
Alimentos 5, Bebidas 4, Aseo 3, Panadería 3; 9 `AVAILABLE`, 4 `LOW_STOCK`,
2 `OUT_OF_STOCK`; 3 destacados; y **cero promociones en toda la base**.

Estos seis números y esas tres listas son los que deciden § Decisión 2 y
§ Decisión 4. No hay ninguna afirmación sobre precios en este documento que no
salga de esta tabla.

---

## Flujo de usuario

En una frase: **el comprador entra a `/[slug]`, toca «Filtrar y ordenar» junto al
título del catálogo, aterriza en una ruta propia con el panel ya abierto, marca
lo que quiera, pulsa «Aplicar», y vuelve la misma ruta con el panel plegado, sus
filtros convertidos en chips que se quitan de uno en uno, y la rejilla de
siempre debajo.**

```
QR / enlace
   ▼
/[slug]                                    ← catálogo completo, ● (SSG), intacto
   │  rastro (F-025) · caja de búsqueda (F-021)
   │  <h1>Catálogo</h1>          «Filtrar y ordenar» →──────┐
   │  fila de categorías (F-026)                            │
   ▼                                                        ▼
/[slug]/p/[productSlug]                     /[slug]/catalogo (por crear), ƒ (Dynamic)
                                              │  panel ABIERTO (no hay nada aplicado)
                                              │  «Aplicar»
                                              ▼
                                            la misma ruta, con parámetros
                                              │  chips de lo aplicado · panel PLEGADO
                                              │  «N productos» · rejilla · paginación
                                              │
                                              ├─ ✕ de un chip   → la misma ruta, sin ese filtro, página 1
                                              ├─ «Quitar todos» → la misma ruta, sin parámetros, panel abierto
                                              ├─ «Ver todo el catálogo» → /[slug]
                                              ├─ una tarjeta    → /[slug]/p/[productSlug]
                                              └─ «Buscar»       → /[slug]/buscar?q=…
```

**Vueltas atrás y qué se pierde.**

| Desde → hacia                          | Qué se conserva                                                                | Qué se pierde                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `/[slug]/catalogo` → `/[slug]`         | El carrito. El estado filtrado queda entero en el historial                    | Los filtros: `/[slug]` es el catálogo completo, a propósito (R1) |
| Quitar un chip                         | Los demás filtros y el orden                                                   | Ese filtro, y la página: se vuelve a la 1 (R9, E13)              |
| «Quitar todos»                         | Nada de filtros; el panel llega abierto para volver a elegir                   | Todos los filtros **y el orden**. Ver el aviso de abajo          |
| Ficha de producto → atrás              | **Todo**, porque el estado está en la URL (R19: no hay memoria en ningún lado) | Nada                                                             |
| Compartir la URL filtrada por WhatsApp | **Todo.** Quien la abre ve el mismo recorte                                    | Nada. Es `noindex` con canónica a `/[slug]` (R14), y eso es todo |
| Cambiar de sucursal (`BranchBar`)      | Nada del filtrado: otra tienda, otras categorías, otros precios                | Los filtros, y está bien: un `localCategoryId` no cruza tiendas  |
| Recargar mañana                        | Lo que diga la URL                                                             | Nada guardado: sin cookie, sin `localStorage`, sin fila (R19)    |

**«Quitar todos» quita también el orden, y se dice.** El botón lleva a la ruta
sin ningún parámetro. Nombrarlo «Quitar todos los filtros» y que además
restableciera el orden en silencio sería mentir a medias; por eso el enlace se
llama **«Quitar todos los filtros»** y el orden se restablece **solo si no hay
ningún filtro puesto y el orden es lo único aplicado** — en ese caso el enlace
que se pinta es otro, «Volver al orden de la tienda». Los dos textos exactos
están en § Textos.

**No hay punto de no retorno.** Filtrar no escribe nada: ni un registro (los
filtros no entran en el registro de consultas de F-021, por R5 de aquella spec),
ni una cookie, ni el carrito.

---

## Decisión 1 — el panel es un `<details>` dentro de un `<form method="get">`, y llega abierto o plegado según lo que haya aplicado

**La forma:** un `<form method="get">` que envuelve un solo `<details>`. El
`<summary>` es la cabecera «Filtros y orden»; dentro van los cuatro grupos
(`<fieldset>` + `<legend>`), el botón «Aplicar» y la salida «Quitar todos los
filtros». Nada más: **ni acordeón por faceta a primer nivel, ni diálogo modal,
ni cajón lateral.**

**La regla de apertura, que es la mitad de la decisión:**

| Situación al cargar la ruta                     | El panel llega… | Por qué                                                                                       |
| ----------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| Sin ningún filtro ni orden (se acaba de entrar) | **abierto**     | El comprador acaba de tocar «Filtrar y ordenar». Esconderle el panel es no darle lo que pidió |
| Con algo aplicado                               | **plegado**     | Ya eligió; lo que quiere ver ahora son los productos. Los chips le dicen qué está puesto      |
| Con algo aplicado y **cero resultados**         | **abierto**     | Lo único útil que puede hacer es cambiar los filtros (E16)                                    |

Es estado **de servidor**: el atributo `open` lo decide quien renderiza. Cero
JavaScript, y sobrevive a cada navegación porque no depende de que el navegador
recuerde nada.

**Cuántas facetas se ven sin desplegar: cero, y a propósito.** No hay un estado
intermedio con «las dos facetas más usadas siempre visibles»: cuáles son las dos
cambia por tienda, y tener dos maneras de llegar a la misma casilla es tener dos
cosas que pueden desacordarse. Lo que se ve con el panel plegado son **los
chips**, que muestran todo lo que está puesto y ya permiten quitarlo sin abrir
nada. Medido: plegado cuesta **46 px** en los tres anchos.

**Por qué el `<details>` sí y las alternativas no:**

| Alternativa                           | Por qué no                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel **siempre desplegado**          | Medido: **869 px** a 360 con cuatro categorías. La rejilla arrancaría en y≈1 300 y la pantalla de resultados no enseñaría un solo producto. Es exactamente el fallo que F-026 midió con los chips que envuelven                                      |
| **Diálogo modal** («hoja» de filtros) | Necesita mover el foco al abrir, devolverlo al cerrar, atraparlo dentro y cerrar con `Escape`. Las cuatro cosas son JavaScript de cliente en una pantalla que renderiza catálogo. Un `<dialog>` sin `showModal()` no es modal, y `showModal()` es JS |
| Un `<details>` **por faceta**         | Cuatro `<summary>` de 44 px = 176 px de mobiliario antes de la primera casilla, y el comprador tiene que abrir cuatro cosas para ver lo que hay. Un solo desplegable con todo dentro cuesta 46 px y un toque                                         |
| **Página aparte** solo para filtrar   | Dobla la navegación (ir a filtrar, volver a ver) y rompe el bucle real, que es marcar → ver → corregir                                                                                                                                               |
| **Barra lateral** a 1280              | Encogería la rejilla y obligaría a cambiar el `sizes` de las imágenes de `ProductCard` (F-023). El panel a lo ancho deja las clases de la rejilla **idénticas** a las de `/[slug]`, que es lo que garantiza que no se descargue ni un píxel de más   |

**Un grupo con algo aplicado llega abierto, y esto no es un adorno.** Está
medido arriba: una casilla marcada dentro de un `<details>` cerrado **se envía
igual**. Si el panel plegado escondiera un filtro puesto y el comprador no
tuviera chips, tendría un catálogo recortado por algo invisible. Por eso: el
panel plegado **siempre** va acompañado de los chips, y el sub-desplegable de
«ver más categorías» llega abierto si alguna de las que esconde está marcada.

**El «Aplicar» se pega abajo mientras el panel esté abierto.** `position:
sticky; bottom: 0` sobre la fila de acciones, dentro del `<details>`. Comprobado
en el navegador a 360×700: con el panel abierto la barra queda clavada al borde
inferior de la ventana mientras se recorre el panel (`bottom: 700`), y en cuanto
el final del panel llega a la pantalla sube y se va con él. Es CSS puro y ahorra
un desplazamiento de 800 px para llegar al botón. Se apaga en `lg:` (a 1280 el
panel abierto mide 368 px y el botón ya se ve).

## Decisión 2 — el precio se pide con dos campos, y los atajos los calcula cada tienda con sus propios precios

**Dos campos abiertos («Desde» y «Hasta») son el mecanismo; tres atajos
derivados de los precios reales de esa tienda son la comodidad; y una línea dice
entre qué y qué se mueve el catálogo.** Los atajos **no** son un vocabulario
aparte: son enlaces que escriben números en esos mismos dos parámetros, así que
al volver la página los campos aparecen rellenos con esos números y los chips
dicen «Desde $350» y «Hasta $540». Un solo estado, tres maneras de verlo.

**Por qué no una escalera fija en el código («hasta 200 / 200 a 500 / más de
500»), que es lo que la spec dejaba sobre la mesa.** Con los precios de verdad:

| Escalera                                 | `tienda-demo` (15) | `tienda-dos` (5)       | Las cuatro de 2 productos |
| ---------------------------------------- | ------------------ | ---------------------- | ------------------------- |
| Fija: hasta 200 / 200 a 500 / más de 500 | **2 / 6 / 7**      | **0 / 2 / 3**          | sin sentido               |
| Derivada de los terciles (350 y 540)     | **5 / 5 / 5**      | (no se dibuja, n < 12) | no se dibuja              |

Tres cosas que decide ese cuadro:

1. En `tienda-demo` el primer tramo fijo esconde el **87 %** del catálogo y el
   último el 53 %: un atajo de 2 productos entre 15 no es un atajo.
2. En `tienda-dos` el primer tramo fijo está **vacío**. Y como en esta
   superficie se muestran conteos (SP5), se leería literalmente «Hasta $200
   (0)»: un atajo que garantiza el vacío, pintado a tamaño de botón.
3. Y el argumento que cierra: **`Business.baseCurrencyCode` es por negocio**. El
   seed ya tiene productos en CUP, USD y MLC, y la moneda de exhibición podría
   ser cualquiera. En una tienda que exhibiera en USD, con los precios de esos
   mismos productos (1.20, 2.00, 3.50), «hasta 200» contendría el catálogo
   entero. Una escalera escrita en el código solo sería correcta para el orden
   de magnitud del peso cubano.

**Cómo se calculan los tres tramos** (la fórmula, para que sea verificable y no
opinable): sobre los precios **resueltos** de los productos que quedan tras las
**demás** facetas, se toman el tercil 1 y el tercil 2, y se redondea cada uno a
**dos cifras significativas**. Con `tienda-demo`: 350 y 540, y los tramos salen
5/5/5. Los rótulos son «Hasta $350», «De $350 a $540» y «Más de $540», con su
conteo cada uno.

**Y cuándo no se dibujan**, que es la otra mitad: hacen falta **12 o más
productos con precio resoluble**, los dos cortes tienen que ser **distintos**
después de redondear y **ninguno de los tres tramos puede quedar vacío**. Si
algo de eso falla, quedan los dos campos y la línea de rango, y ya. Doce porque
por debajo de eso el catálogo entero es media página de resultados (el tope es 24) y cada tramo tendría tres o cuatro productos: menos información que los
44 px que cuesta.

**La línea de rango es el sustituto honesto del deslizador que no vamos a
tener:** «En esta tienda los precios van de $90 a $1 150.» Resuelve el problema
real de dos campos abiertos —que el comprador no sabe en qué orden de magnitud
está— sin un solo byte de JavaScript, y funciona en cualquier moneda.

**Un límite conocido, escrito antes de que muerda:** R6 fija los límites como
enteros no negativos en la moneda de exhibición. En una tienda cuya moneda de
exhibición tuviera precios por debajo de 10, filtrar por enteros sería casi
inútil. Hoy los dos negocios de la base exhiben en CUP y no hay ninguno así, y
R6 es regla de `spec.md`. Queda anotado para el día que aparezca; no se cambia
aquí.

## Decisión 3 — «más reciente» se llama **«Últimos añadidos al catálogo»**, y lleva su letra pequeña

I9 dice la verdad incómoda: `StoreProduct.createdAt` es **cuándo apareció la
fila en esta base**, no cuándo el negocio empezó a vender el producto, y en el
alta inicial de una tienda cuatrocientos productos comparten instante y el orden
lo deciden enteramente los desempates.

Rótulo elegido: **«Últimos añadidos al catálogo»**. Es literalmente cierto —
mide cuándo entró el producto **en este catálogo**— y no promete nada más.

Descartados, con el motivo:

| Rótulo descartado   | Por qué miente                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| «Novedades»         | Afirma que el producto es nuevo **en el negocio**. Un arroz que lleva ocho años en la bodega saldría de «novedad» |
| «Lo más nuevo»      | Lo mismo, y además suena a propiedad del producto y no a un orden                                                 |
| «Recién llegados»   | Afirma una llegada de mercancía. `createdAt` no sabe nada de mercancía                                            |
| «Más reciente»      | ¿Más reciente qué? La ambigüedad es justo lo que I9 pide no dejar                                                 |
| «Por fecha de alta» | Cierto pero en idioma de inventario; el comprador no sabe qué es un alta                                          |

**Y la letra pequeña, que solo aparece cuando ese orden está aplicado**, debajo
del selector y en la línea de resultados: «Ordenado por cuándo entró cada
producto en este catálogo. Los que llegaron en el mismo envío salen juntos, por
orden alfabético.» Esa segunda frase es E10 y R8 contados en español: explica
por qué en una tienda recién dada de alta este orden se parece sospechosamente
al alfabético, en vez de dejar que parezca un error.

## Decisión 4 — una faceta que no separa el catálogo en dos no se dibuja

Es la misma regla con la que F-026 decidió no pintar su fila con una sola
categoría («todo» o «esa una» son el mismo conjunto, y eso no es una elección),
aplicada **por faceta**:

| Faceta                    | Se dibuja si…                                                        | En `tienda-demo`, hoy    |
| ------------------------- | -------------------------------------------------------------------- | ------------------------ |
| **Ordenar por**           | Hay 2 o más productos                                                | Sí                       |
| **Precio**                | Hay 2 o más productos con precio resoluble y no todos valen lo mismo | Sí (90 … 1 150)          |
| **Categoría**             | Hay 2 o más categorías con conteo > 0                                | Sí (4)                   |
| **Solo lo que hay ahora** | Hay al menos un agotado **y** al menos uno que no lo está            | Sí (2 agotados de 15)    |
| **Solo con descuento**    | Hay al menos uno con promoción vigente **y** al menos uno sin        | **No**: cero promociones |
| **Solo destacados**       | Hay al menos un destacado **y** al menos uno que no lo es            | Sí (3 de 15)             |

Ese «No» de la fila del descuento es el ejemplo que justifica la regla entera:
con la base de hoy, «Solo con descuento (0)» sería una casilla que en **todas**
las tiendas lleva al vacío garantizado. Y en cuanto llegue la primera promoción
del POS, aparece sola, sin que nadie despliegue nada.

**La excepción, obligatoria:** una faceta que no se dibujaría **se dibuja
igualmente si tiene un valor aplicado en la URL**. Si no, un filtro llegado por
un enlace compartido se podría quitar desde su chip pero no desde el panel, y el
panel estaría enseñando un estado que no es el suyo.

**Y de aquí sale también el enlace de entrada:** en `/[slug]`, «Filtrar y
ordenar» se pinta cuando la tienda tiene **2 o más productos visibles y al menos
una faceta se dibujaría**. Con las tiendas de la base: `tienda-demo` sí,
`tienda-dos` sí, las cuatro de dos productos sí (tienen dos categorías
distintas), una tienda de un solo producto no.

**Los conteos, y qué significan exactamente.** El número de una opción es
**cuántos productos hay de esa opción dentro de lo que ya filtran las demás
facetas** — no dentro de lo que filtra la suya, porque dentro de una faceta los
valores se suman (R2). Consecuencias, dichas para que nadie las descubra en
producción: sin nada marcado, «Bebidas (4)» es exactamente lo que se verá al
marcarlo; con «Panadería» ya marcado, ese «Bebidas (4)» son los cuatro que se
**añadirían**. Y siempre se cuentan sobre el resultado completo, nunca sobre la
página que se está viendo.

## Decisión 5 — el chip entero es el botón de quitar

Un chip de filtro aplicado es **un solo `<a>`** que contiene el texto y una ✕
decorativa, no un texto con una ✕ diminuta al lado. Motivo: la ✕ sola sería un
objetivo de 16 px en un móvil, y el error clásico de este patrón es
precisamente ese. Así el objetivo es el chip completo (44 px de alto medidos), y
hay **una parada de tabulación por filtro**, no dos.

**Y no se parecen a los chips de F-026.** La fila de categorías usa `bg-brand
text-brand-contrast` para decir «aquí estás». Un chip de filtro aplicado dice
«esto está puesto, tócalo para quitarlo» — lo contrario. Se dibuja con la pareja
**inactiva** de F-026 (`bg-surface-muted`, `border-border`, `text-fg`), que en
esta pantalla es la única píldora que hay, y la ✕ es lo que la distingue. Dos
píldoras iguales con significados opuestos en el mismo producto sería peor que
dos formas distintas.

**Qué se pinta y qué no.** R18 en una línea: **se pinta lo que se aplicó**. Una
categoría inexistente, un `precio_min` mayor que `precio_max`, letras donde va un
número, un parámetro desconocido o el valor cuarenta y uno de una faceta acotada
a cuarenta **no generan chip**, porque no filtraron nada (R10, E15, criterio 11).

**Orden fijo** (R11, el mismo del vocabulario en la URL): categorías por nombre,
«Desde», «Hasta», «Solo lo que hay ahora», «Solo con descuento», «Solo
destacados». Y al final, cuando hay **dos o más**, el enlace «Quitar todos los
filtros».

**El orden elegido no es un chip.** Quitar un filtro y «quitar» un orden no son
la misma operación —lo segundo devuelve al orden de la tienda, no a «sin
orden»—, así que el orden aplicado se dice **en la línea de resultados**, con
palabras: «15 productos, ordenados por precio, de menor a mayor.»

## Decisión 6 — el enlace de entrada va en la fila del `<h1>`, y no toca nada más

En `/[slug]`, «Filtrar y ordenar» se pinta **a la derecha del `<h1>Catálogo</h1>`,
en la misma fila**.

Medido: los dos caben a 360 px (104 + 12 + 133 de 328) y la fila pasa de 32 a
**44 px de alto**. El coste vertical total de este feature sobre el catálogo son
**12 px**: la primera fila de tarjetas baja de y=416 a y=428.

Por qué ahí y no en otro sitio:

| Sitio                                   | Por qué no                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Debajo de la fila de categorías (F-026) | Una fila propia de 44 px + su margen: 60 px que empujan la rejilla. Y quedaría pegado a los chips, como si filtrara **dentro** de la categoría   |
| Al lado del botón «Buscar»              | Es la caja de búsqueda de F-021, que se monta idéntica en tres pantallas. Meterle un segundo botón la parte en dos variantes                     |
| En el `layout`                          | Lo comparten `/carrito`, `/checkout`, `/pedido/[code]` y el modo selector. El mismo argumento que ya escribieron F-021 y F-026                   |
| Flotando sobre la rejilla               | Tapa producto y necesita `position: fixed` con área segura; y en la pantalla que importa, el móvil, taparía justo la tarjeta que se está mirando |

**No estorba a F-025 ni a F-026:** el rastro vive encima de la caja de búsqueda
y no se toca; la fila de categorías vive debajo de la descripción y no se toca.
El enlace se mete en una fila que hoy está medio vacía, entre las dos.

**No se pinta en la vista de categoría de F-026, y es deliberado.** Llevar el
filtro desde ahí exigiría preseleccionar esa categoría en `/[slug]/catalogo`, y
el nombre del parámetro lo está fijando `sdd-architect` ahora mismo (SP2).
Cuando exista, es un enlace más y una línea; no lo abre este ciclo.

## Decisión 7 — la URL que escribe el formulario se acepta como es; no hay redirección

Medido arriba: un `<form method="get">` pelado escribe
`precio_min=&precio_max=&orden=` aunque el comprador no toque esos campos. No
hay forma de evitarlo sin JavaScript.

**Se acepta.** Esos valores vacíos se ignoran (R10, que ya obliga a ignorar
cualquier cosa que no se entienda) y **todos los enlaces que la página genera**
—chips, tramos, paginación, «quitar todos»— se construyen canónicos, en el orden
fijo de R11 y sin parámetros vacíos. En cuanto el comprador toca cualquier cosa,
la URL queda limpia.

**La alternativa, descartada:** normalizar y redirigir a la URL canónica. Es más
bonito en la barra de direcciones y cuesta un viaje extra en cada «Aplicar»,
pero sobre todo mete un 3xx justo donde el criterio 11 exige que una URL con
basura **responda 200**. No vale la pena arriesgar un criterio cerrado por
estética de URL.

**Y la opción por defecto del selector de orden tiene que canonizar a «sin
orden».** Es la diferencia entre que E12 siga siendo cierto o no: si el
`<option>` marcado por defecto llevara un valor que el servidor entiende como un
orden explícito, el formulario **siempre** enviaría uno, y el camino «sin orden →
el de capas de F-021» —que es lo que verifican los criterios 9 y 10— dejaría de
existir en la interfaz. La arquitectura ya lo resuelve por las dos vías posibles:
la cadena vacía se ignora como cualquier valor que no está en la tabla, y
`sort=relevancia` está definido como **exactamente lo mismo que no mandar
`sort`** y desaparece al canonizar. Así que: «Más relevantes» en
`/[slug]/buscar` lleva el token `relevancia`, y «Destacados primero» en
`/[slug]/catalogo` lleva la cadena vacía, porque para el orden por defecto del
catálogo no hay token y no hace falta inventar uno. Las dos son opciones
**reales y marcables** —no un hueco en blanco— y las dos producen la misma URL
que no elegir nada.

---

## Inventario de pantallas y estados

### 1 · `/[slug]` — un enlace, y ni un cambio más

Ni `BranchBar`, ni el rastro, ni la caja de búsqueda, ni la fila de categorías,
ni las clases de la rejilla, ni `ProductCard`, ni el vacío de siempre. Solo el
`<h1>` pasa a ser una fila de dos elementos.

| Estado                                    | Qué se ve                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Con productos y alguna faceta que dibujar | El enlace «Filtrar y ordenar» a la derecha del `<h1>`                     |
| Con productos pero ninguna faceta útil    | **Sin enlace** (§ Decisión 4)                                             |
| Tienda sin ningún producto visible        | **Sin enlace.** El mensaje de siempre, intacto (E17)                      |
| Tienda `SUSPENDED`                        | `StoreClosedNotice` como hoy. Sin enlace y sin consulta de catálogo (E18) |
| Modo selector de marca                    | Lista de sucursales como hoy. Sin enlace (E19)                            |
| Base caída                                | `src/app/error.tsx`, que ya está en el árbol                              |

**Criterio 1, dicho para el que lo verifique:** este enlace **no toca ni el
conjunto ni el orden** de los productos. Y criterio 2: es un `<a>` con el
prefetch apagado; `/[slug]` sigue siendo `●` (SSG).

### 2 · `/[slug]/catalogo` (la página, por crear) — la pantalla nueva

Orden vertical, de arriba abajo, para que el comprador no note que cambió de
pantalla: `BranchBar` (si la marca agrupa 2+ sucursales) · rastro (F-025, último
eslabón «Filtrar y ordenar») · caja de búsqueda (F-021, la misma, sin cambios) ·
`<h1>Filtrar y ordenar</h1>` · chips · panel · línea de resultados · rejilla ·
paginación.

**El `<h1>` repite las palabras del enlace que trajo al comprador aquí.** No es
casualidad: es la comprobación más barata de «llegué a donde quería».

**La fila de categorías de F-026 NO se monta aquí.** Dos mecanismos de categoría
en la misma pantalla —una fila que **navega a otra página** y unas casillas que
**filtran esta**— es una trampa. La categoría, en esta pantalla, es una faceta
más.

| Estado                                          | Qué se ve                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin parámetros** (se acaba de entrar)         | Panel **abierto**, ningún chip, ninguna casilla marcada (R3), la línea «15 productos» y el catálogo completo en el orden de siempre                        |
| **Con filtros y resultados**                    | Chips · panel **plegado** con su contador · «7 productos» · rejilla · paginación si procede                                                                |
| **Con filtros y cero resultados** (E16)         | Chips · panel **abierto** · el vacío de § Los tres vacíos. **Sin rejilla y sin paginación**                                                                |
| **Página más allá de la última**                | Chips · panel plegado · un `Alert` `muted` con «Volver a la primera página», que **conserva filtros y orden**. Nunca la pantalla de «no queda nada»        |
| **Tienda sin ningún producto visible** (E17)    | **Sin panel, sin chips, sin selector de orden y sin línea de resultados.** El mensaje de `/[slug]`, palabra por palabra                                    |
| **Parámetros basura** (E15)                     | 200. Se aplica lo válido, se ignora el resto **en silencio** y no aparece ni un chip por ellos (R18)                                                       |
| **Un filtro de una faceta que no se dibujaría** | La faceta se dibuja igual, con ese valor marcado (§ Decisión 4)                                                                                            |
| **Producto sin precio resoluble** (E7)          | `ProductCard` ya pinta `Consultar`. Fuera de cualquier rango; **último** en los dos órdenes por precio. Sin aviso ni distintivo nuevo: la ficha ya lo dice |
| **Producto agotado sin «solo lo que hay»**      | Aparece **en su sitio**, con su `Badge` `Agotado`, como en `/[slug]` (E2, R3)                                                                              |
| **Tienda `SUSPENDED`** (E18)                    | `StoreClosedNotice` con `extraNote` y `BranchBar` con `isOpen={false}`. **Sin panel y sin consulta de catálogo**                                           |
| **Slug en modo selector** (E19)                 | 404, igual que `/[slug]/buscar`                                                                                                                            |
| **Tienda `DRAFT` o slug inexistente**           | 404 del resolvedor de siempre                                                                                                                              |
| **Alias vivo de sucursal**                      | 200. Todos los `href` que dibuja la pantalla usan `canonicalSlug`, como `BranchBar`                                                                        |
| **Base caída**                                  | `src/app/error.tsx`. **Nunca** una rejilla vacía disfrazada de «con estos filtros no queda nada» (R16 de F-021, aquí igual)                                |
| **Cargando**                                    | Nada, y **sin `loading.tsx`**: una sola lectura ya cacheada por tienda (SP3), y además un `loading.tsx` rompería el 404 de E19 (ver § Coste de cliente)    |
| **Sin permiso**                                 | No existe. El comprador es anónimo (`docs/adr/0016-escritura-publica-sin-sesion.md`)                                                                       |

### 3 · `/[slug]/buscar` — gana el selector de orden, y nada más

| Qué gana                                                                       | Qué **no** gana                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| El selector de orden, con «Más relevantes» primero y marcado por defecto (E11) | El panel de facetas: SP5 ya aceptó la asimetría entre las dos superficies |
| Los chips, **si la URL trae filtros** (R17, R18)                               | Los conteos por faceta: SP5, resuelto por el humano                       |

**Por qué los chips sí.** El vocabulario es compartido (R17): una URL con `q` y
con filtros es válida en esta pantalla. Sin chips, esos filtros recortarían los
resultados **sin que nada lo dijera**, que es exactamente lo que R18 existe para
impedir. Con chips, el comprador ve qué está puesto y puede quitarlo, aunque en
esta pantalla no haya panel donde ponerlo.

**El selector no ofrece «Destacados primero»** aquí: ese es el orden por defecto
del **catálogo**, no el de una búsqueda, y ofrecerlo sugeriría que «sin orden»
significa eso, cuando significa el orden por capas de F-021 (E12).

**Y no aparece cuando no hay nada que ordenar**: ni en la pantalla de consulta
vacía, ni en la de cero resultados.

### Los tres vacíos, y el cuarto que no es un vacío

Son **cuatro pantallas distintas**, y la prueba de que están bien hechas es que
ninguna se puede confundir con otra leyendo solo su primera frase.

| Cuál                                         | Cuándo                                               | Primera frase                                        | Qué ofrece                                                                         | Panel           |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| **a) La tienda no tiene productos** (E17)    | Cero `StoreProduct` visibles                         | «Esta tienda todavía no tiene productos publicados.» | Nada. No hay nada que ofrecer, y decirlo es la respuesta                           | **No**          |
| **b) La búsqueda no encontró nada**          | `q` con resultado vacío. **Es la de F-021, intacta** | «Sin resultados para «…»»                            | Las tres sugerencias de F-021 y «Ver todo el catálogo»                             | No              |
| **c) Con estos filtros no queda nada** (E16) | Filtros válidos, resultado vacío                     | «Con estos filtros no queda ningún producto.»        | Los chips (cada uno se quita), «Quitar todos los filtros» y «Ver todo el catálogo» | **Sí, abierto** |
| **d) Página más allá de la última**          | Página válida, sin filas                             | «Esta página ya no tiene resultados.»                | «Volver a la primera página», **conservando filtros y orden**                      | Sí, plegado     |

**(a) usa la misma cadena que `/[slug]`, carácter por carácter.** El criterio 12
dice «el mensaje de siempre», y la manera de que lo siga siendo dentro de un año
es que sea literalmente la misma frase.

**(c) nombra los filtros, no los describe.** «Con estos filtros no queda ningún
producto» y debajo los chips reales, que son a la vez la lista y el remedio. Y
**nunca** «no encontramos»: ese verbo es de (b), y E16 pide justamente que no se
confundan.

**(d) no es un vacío.** Hay resultados; lo que no hay es esa página. Copia el
tratamiento que `/[slug]/buscar` ya da hoy con su `Alert` `muted`, incluida la
palabra «Volver».

---

## Estructura por breakpoint

Móvil primero. `Container` da `mx-auto w-full max-w-6xl px-4 sm:px-6`: 328 px
útiles a 360. Todo lo de esta tabla está **medido** con el prototipo inyectado en
la página real.

| Zona                  | 360                                                                                                          | 768                                          | 1280                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------- |
| **Enlace de entrada** | En la fila del `<h1>`, a la derecha (`flex flex-wrap items-center justify-between gap-3`). Fila de **44 px** | Igual                                        | Igual                                        |
| **Chips**             | `flex flex-wrap gap-2`. **Envuelven, no se desplazan.** 44 px con uno; **252 px** con siete (el peor caso)   | 96 px con siete                              | 96 px con siete                              |
| **Panel plegado**     | **46 px**                                                                                                    | 46 px                                        | 46 px                                        |
| **Panel abierto**     | Los grupos en **1 columna**: 869 px con 4 categorías, 1 093 con 15                                           | **2 columnas** (`sm:grid-cols-2`): 563 / 787 | **4 columnas** (`lg:grid-cols-4`): 368 / 551 |
| **Fila de acciones**  | Apilada (`Aplicar` arriba), **pegajosa** al borde inferior mientras el panel esté abierto                    | En fila; pegajosa                            | En fila; **no** pegajosa (`lg:static`)       |
| **Grupo «Categoría»** | Filas de 44 px, una por categoría, hasta **8**; el resto en un `<details>` anidado                           | Igual                                        | Igual                                        |
| **Campos de precio**  | «Desde» y «Hasta» al 50 % cada uno, en una fila                                                              | Igual                                        | Igual                                        |
| **Atajos de tramo**   | `flex flex-wrap gap-2`; con los rótulos reales, **dos filas** (96 px)                                        | Dos filas                                    | Dos filas                                    |
| **Selector de orden** | `<select>` a ancho completo, 44 px                                                                           | Igual                                        | Igual                                        |
| **Rejilla**           | `mt-8 grid grid-cols-2 gap-4` — **idéntica a la de `/[slug]`, clase por clase**                              | `sm:grid-cols-3`                             | `lg:grid-cols-4`                             |
| **Paginación**        | Apilada, dos enlaces de 44 px                                                                                | En fila, con el conteo a la izquierda        | Igual                                        |

**La regla que gobierna los tres anchos:** el mismo DOM en los tres —una sola
forma, un solo orden de foco, una sola cosa que probar—, la rejilla nunca deja de
ser la rejilla de `/[slug]` (para que el `sizes` de `ProductCard` siga siendo
correcto y no se descargue de más, F-023), y **nada provoca desplazamiento
horizontal de la página**, comprobado con el panel abierto y siete chips.

**Lo que se pierde, dicho sin adornos:** a 360 px el panel abierto mide 869 px,
más de una pantalla. Quien lo abre tiene que desplazarse para verlo entero. Se
compensa con tres cosas y ninguna es JavaScript: llega abierto solo cuando no
hay nada aplicado, el «Aplicar» se pega abajo, y en cuanto se aplica algo el
panel vuelve plegado a 46 px con los chips arriba.

**Y por qué el panel no se puede «forzar abierto» a 1280 con CSS**, que sería lo
elegante: el estado de un `<details>` es un atributo, no una propiedad de
presentación, y ningún motor garantiza que se pueda anular desde una hoja de
estilos. Renderizar dos DOM distintos por ancho significaría **dos formularios y
dos veces cada control** — el mismo `name` duplicado en la misma página. Se
queda un solo `<details>` en los tres anchos, y a 1280 abrirlo cuesta un toque
para ver un panel de 368 px.

---

## Componentes de UI

**Se reutilizan tal cual, sin tocar una línea:** `Container`, `Card`, `Badge`,
`Alert`, `ProductCard`, `BranchBar`, `StoreSearchBox`, `StoreClosedNotice`,
`StoreTrail`, `ResponsiveImage`.

**Piezas nuevas**, todas de servidor, en `src/components/store/` (los nombres los
pone `sdd-architect`; la forma, este documento):

| Pieza                                       | Qué hace                                                                                | Por qué no alcanza lo que hay                                                                                                             | `"use client"`                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| El panel de filtros (por crear)             | El `<form method="get">`, el `<details>`, los cuatro `<fieldset>` y la fila de acciones | No hay nada parecido en el repo. Y es la pieza que decide la regla de apertura: repartirla entre dos páginas es perderla                  | **No**                                             |
| La fila de chips aplicados (por crear)      | Un `<ul>` de `<a>` con su ✕, más «Quitar todos los filtros»                             | **Lo montan dos pantallas** (`/[slug]/catalogo` y `/[slug]/buscar`): repetir el marcado es cómo una pierde su `min-h-11`                  | **No**                                             |
| El selector de orden (por crear)            | `<label>` + `<select>`, con la lista de opciones según haya término de búsqueda o no    | Se monta suelto en `/[slug]/buscar` (con su propio botón «Ordenar») y empotrado en el panel. Un solo sitio donde vive la lista de rótulos | **No**                                             |
| La línea de resultados (por crear)          | «N productos, ordenados por …», más la letra pequeña de § Decisión 3                    | La de `StoreSearchResults` dice «Resultados» y vive dentro de la paginación de búsqueda                                                   | **No**                                             |
| La página de `/[slug]/catalogo` (por crear) | Resuelve, lee, filtra, ordena, pagina, pinta                                            | —                                                                                                                                         | **No.** Renderiza catálogo: `AGENTS.md` lo prohíbe |

**La paginación se copia, no se comparte.** `StoreSearchResults` la lleva
incrustada junto con su partición en dos bloques (coincidencias / misma
categoría), que aquí no existe. Se replica su **forma** exacta —`<nav
aria-label>`, conteo a la izquierda, «Página anterior» / «Página siguiente» con
`SECONDARY_LINK_CLASSES`— cambiando «Resultados» por «Productos». Extraer un
componente común de paginación es un `refactor:` aparte, y este feature no lo
arrastra ni lo arregla.

**`Button` se usa para «Aplicar»** (es un `<button type="submit">` de verdad,
variante `primary`) y **no** para los enlaces: `Button` renderiza un `<button>` y
no tiene modo enlace. Los chips, los tramos y la paginación son `<a>` que copian
la pareja de clases secundaria, la misma técnica de `SECONDARY_LINK_CLASSES` que
ya usan `src/app/[slug]/buscar/page.tsx` y `src/components/store/StoreSearchResults.tsx`.

**`Field` no se usa.** Envuelve un control con etiqueta, ayuda y error, y aquí no
hay errores de validación que mostrar: R10 obliga a **ignorar** en silencio lo
que no se entiende, no a señalarlo. Las etiquetas se ponen a mano, con `<label
htmlFor>` y `<fieldset>`/`<legend>`, que es lo que `Field` no cubre.

**Clases propuestas al implementador** (orientativas; lo obligatorio es lo que
dicen § Tokens y § Accesibilidad):

```
form   : (sin clases; solo method="get" y action)
details: border-border bg-surface rounded-md border
summary: flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-medium
         focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2
grupos : grid grid-cols-1 gap-4 p-3 sm:grid-cols-2 lg:grid-cols-4 items-start
legend : text-sm font-medium text-fg
fila de casilla: flex min-h-11 items-center gap-3 text-sm
input  : border-border bg-surface text-fg min-h-11 w-full rounded-md border px-3
         focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2
acciones: sticky bottom-0 col-span-full flex flex-col gap-2 border-t border-border
          bg-surface p-3 sm:flex-row lg:static lg:border-0
chip   : bg-surface-muted text-fg border-border inline-flex min-h-11 items-center gap-2
         rounded-md border px-3 text-sm hover:bg-surface
         focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2
```

---

## Tokens y tema

**No hace falta ningún token nuevo.** Todo sale de `src/theme/tokens.css` tal
como está.

| Uso                                       | Token / utilidad                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Caja del panel                            | `bg-surface`, `border-border`, `rounded-md`                                                                        |
| Fondo del chip y del enlace de entrada    | `bg-surface-muted`, `hover:bg-surface`, `border-border`, `text-fg`                                                 |
| Botón «Aplicar»                           | `Button` variante `primary`: `bg-brand text-brand-contrast`                                                        |
| Conteos por faceta                        | `text-fg-muted`, `text-sm`                                                                                         |
| Línea de rango de precios y letra pequeña | `text-fg-muted`, `text-xs`                                                                                         |
| `<h1>`, `<legend>`, etiquetas             | `text-fg`. **Nunca** `text-brand`                                                                                  |
| Línea de resultados                       | `text-fg`                                                                                                          |
| Vacío (c) y (a)                           | `text-fg` el título, `text-fg-muted` la explicación                                                                |
| Aviso de página más allá de la última     | `Alert` tono `muted`, el mismo que usa hoy `/[slug]/buscar`                                                        |
| Esquinas                                  | `rounded-md`. **Nunca** `rounded-[--radius-md]` (sintaxis v3 que persigue `npm run check:theme`) ni `rounded-full` |
| Anillo de foco                            | `focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2`, calcado de `Button`          |
| Sombra                                    | Ninguna. El panel no flota; `shadow-card` es de las tarjetas                                                       |
| Tipografía                                | `font-sans` y la escala de Tailwind (`text-xs`, `text-sm`, `text-2xl`). Sin tamaños arbitrarios                    |

**Cómo responde al branding por tienda.** La tienda solo redefine `brand`,
`brandContrast`, `accent`, `accentContrast` y la escala `radius`
(`src/features/theming/storeTheme.ts`). En esta pantalla el color de la tienda
aparece en exactamente dos sitios: el botón «Aplicar» y el anillo de foco de
todos los controles. Todo lo demás —chips, casillas, conteos, títulos— va en
`fg`/`surface`, que es la misma decisión deliberada que ya escribieron F-021 y
F-026: `storeTheme.ts` valida que el color **sea** un color, no que contraste, y
una tienda con un `brand` casi blanco dejaría ilegible el texto que explica la
pantalla. El `radius` de la tienda redondea el panel, los chips y los campos
solo, porque todos usan `rounded-md`.

**El `accent` no aparece.** La franja `Destacado` de `ProductCard` lo sigue
usando y no se toca — y conviene que el filtro «Solo destacados» **no** copie ese
color: uno marca un producto, el otro es un control.

**Modo oscuro:** nada específico. Todos los tokens usados se redefinen en el
bloque de `prefers-color-scheme: dark` que ya existe, y los controles nativos
(`<input type="checkbox">`, `<select>`) siguen el esquema del sistema si el
`color-scheme` de la página está declarado, que es cosa de `src/app/globals.css`
y no de este feature.

---

## Accesibilidad

**Landmarks y estructura.** La pantalla tiene el `<nav aria-label="Ruta">` del
rastro, el `<form role="search">` de F-021 y, nuevos: el `<form>` del panel (sin
rol, es un formulario corriente), un `<nav aria-label="Filtros aplicados">` para
los chips y un `<nav aria-label="Páginas del catálogo">` para la paginación. Un
solo `<h1>`; los vacíos usan `<h2>`, no un segundo `<h1>`.

**Etiquetas, una por control, sin excepción.**

| Control                | Cómo se etiqueta                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Cada casilla           | `<label>` que **envuelve** el `<input>` y su texto, de modo que toda la fila de 44 px es el objetivo                |
| Cada grupo             | `<fieldset>` + `<legend>` («Ordenar por», «Precio», «Categoría», «Otros filtros»)                                   |
| «Desde» / «Hasta»      | `<label for>` propio cada uno, con el rótulo visible. **Nunca** solo un `placeholder`                               |
| El `<select>` de orden | `<label for="orden">Ordenar por</label>`                                                                            |
| El `<summary>`         | Su propio texto. **No** lleva un `<button>` dentro: el `<summary>` ya es el control                                 |
| Cada chip              | El `<a>` entero, con nombre accesible «Quitar el filtro Categoría: Bebidas» vía `aria-label`; la ✕ es `aria-hidden` |
| Cada atajo de tramo    | El texto del enlace («De $350 a $540»), que ya se explica solo                                                      |

**Los rótulos de las casillas se bastan solos.** Cada uno dice «Solo lo que hay
ahora», no «Lo que hay ahora» apoyado en su `<legend>`: no todos los lectores de
pantalla anuncian la leyenda en cada control, y una casilla que suene «lo que
hay ahora» sin el «solo» significa lo contrario de lo que hace.

**Los conteos, anunciados una sola vez y sin puntuación de más.** El paréntesis
que se ve es decorativo y el número se dice en palabras:

```html
<span>Bebidas</span>
<span aria-hidden="true">(4)</span>
<span class="sr-only">4 productos</span>
```

Con uno solo, «1 producto». Así el lector dice «Bebidas, 4 productos, casilla,
no marcada» en vez de «Bebidas, abre paréntesis, 4, cierra paréntesis».

**Teclado, y aquí está la lección de F-026.** Aquella fila de chips se desplaza
horizontalmente, y por eso necesitó `scroll-padding-inline: 50%` para que el
navegador arrastrara a la vista el chip enfocado, más un `py-1` para que
`overflow-x: auto` no recortara el anillo de foco. **En esta pantalla no hay ni
un `overflow` en ningún eje**: los chips **envuelven** en los tres anchos, los
tramos también, y el grupo de categorías se acota a ocho filas con un
`<details>` anidado en vez de convertirse en una caja que se desplaza. No hay
nada que arrastrar y no hay nada que recortar el anillo. Es la misma trampa,
esquivada por construcción y no por parche.

**El recorrido con teclado, comprobado en el navegador** (con el panel plegado,
un chip puesto): rastro → caja de búsqueda → «Buscar» → chip → «Quitar todos» →
`<summary>` → línea de resultados (no focalizable) → primera tarjeta → … →
paginación. Con el panel abierto, entre el `<summary>` y la línea de resultados
se intercalan, en este orden exacto: `<select>` de orden → «Desde» → «Hasta» →
los tres tramos → las casillas de categoría → («Ver N categorías más» si lo hay)
→ las casillas de «Otros filtros» → «Aplicar» → «Quitar todos los filtros».
`Enter` sobre el `<summary>` abre y cierra; medido, sin JavaScript.

**Área de toque:** 44 px de alto mínimo en absolutamente todo lo tocable —
casillas (por envolverlas en su `<label>`), chips, tramos, `<summary>`, campos,
`<select>`, botones y enlaces de paginación. Es `min-h-11`, el mismo que ya
imponen `Button` y los chips de F-026.

**Foco visible en todo**, incluido el `<summary>`, que sin clases no hereda el
anillo de nadie: `focus-visible:outline-brand outline-2 outline-offset-2`.

**Sin `aria-live` en la línea de resultados.** Cada aplicación de filtros es una
navegación completa: el documento es nuevo y una región viva en un documento
recién cargado o no anuncia nada o duplica lo que el lector ya va a leer. Lo que
sí cambia es el `<title>`, que es lo que un lector de pantalla anuncia al
aterrizar.

**Campos numéricos:** `type="number"` con `inputMode="numeric"`, `min="0"` y
`step="1"` — el teclado numérico en el móvil sin una línea de JavaScript. **Sin
`required` y sin `pattern`**: un campo vacío tiene que poder enviarse, porque
vacío significa «sin límite». Y si el navegador bloquea un negativo, mejor; el
servidor lo ignora igual (R10).

**Contraste.** Los conteos y la línea de rango van en `text-fg-muted`, el mismo
token que la línea de resultados de F-021 ya usa para texto informativo. El
conteo, además, **nunca es la única fuente**: la lista se puede usar entera sin
leer un solo número.

---

## Coste de cliente

**Cero componentes de cliente. Cero.** Lo que este feature añade al navegador es
HTML.

| Pieza                            | Directiva | Por qué                                                                                         |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| El panel de filtros (por crear)  | **No**    | `<form method="get">`, `<details>`, `<input>`, `<select>`. Ni estado de React ni un solo evento |
| La fila de chips (por crear)     | **No**    | Un `<ul>` de `<a>`                                                                              |
| El selector de orden (por crear) | **No**    | Un `<label>` y un `<select>` dentro de un formulario                                            |
| La página filtrable (por crear)  | **No**    | Renderiza catálogo: `AGENTS.md` § Prohibiciones lo prohíbe explícitamente                       |
| `ProductCard`, la rejilla        | **No**    | Ya son de servidor y no se tocan                                                                |
| El «Aplicar» pegajoso            | **No**    | `position: sticky` es CSS. Ni un `onScroll` ni un observador                                    |
| El desplegable                   | **No**    | `<details>` es revelación nativa: funciona **antes** de que exista hidratación, no después      |

**Sin `error.tsx` propio en el segmento**, y es importante: en Next un
`error.tsx` **tiene** que llevar `"use client"`, y ponerlo aquí metería un módulo
de cliente en un árbol que renderiza catálogo. `src/app/error.tsx` ya cubre la
ruta desde la raíz y no añade ni un byte. **Sin `loading.tsx`**, y aquí hay un
motivo más duro que el de F-026 («la espera no da tiempo a leerse»): esta página
llama a `notFound()` para el slug en modo selector (E19), y un `loading.tsx` en
el segmento haría que respondiera 200 con cuerpo de 404. Lo tiene fichado el
arnés y lo recoge `.agent/specs/F-027/architecture.md`.

**Sin `<noscript>`.** Con el JavaScript desactivado la pantalla es **la misma**:
el formulario navega porque es `method="get"`, los chips y los tramos son `<a
href>`, el desplegable abre porque es nativo y los nombres y precios están en el
HTML. Eso es E14 y el criterio 13, y no hay nada que explicarle a nadie.

**Prefetch apagado** en el enlace de entrada, en los chips, en los tramos y en la
paginación. Todos apuntan a una **ruta dinámica**: precargarlos es pedirle al
servidor que renderice páginas que quizá nadie visite, en la conexión que este
producto tiene como objetivo. Es el mismo argumento que RD5 de F-026, agravado
porque allí el destino era estático y aquí no.

**Presupuesto.** `node scripts/check-bundle-budget.mjs` tiene que seguir en 0
**sin tocar `BUDGET_KB`** — es el criterio 12, y aquí no hay nada que pueda
crecer legítimamente: si sube, hay una regresión que investigar, no un número que
subir. Se comprueba junto con `grep -rn "use client" src/components/store/`, que
no debe devolver **ningún** componente de filtro.

**Lo que se queda fuera por costar JavaScript, y no vuelve por la puerta de
atrás:** aplicar al marcar una casilla (sin pulsar «Aplicar»), un deslizador de
precio, autocompletado de facetas, actualizar los conteos en vivo mientras se
marca, un diálogo modal de filtros y recordar la última selección del comprador.
Los seis necesitan un módulo de cliente en una pantalla de catálogo; los cinco
primeros están además fuera por `spec.md` § Alcance › Fuera, y el sexto por R19.

---

## Textos

Microcopy exacto, en español. `{tienda}` es `store.name`, `{n}` un número,
`{moneda}` el código de la moneda de exhibición (hoy `CUP` en las dos empresas de
la base) y `$…` el importe formateado con el mismo símbolo que usan las tarjetas.

**El enlace de entrada y el título**

| Elemento                     | Texto                          |
| ---------------------------- | ------------------------------ |
| Enlace en `/[slug]`          | `Filtrar y ordenar`            |
| `<h1>` de `/[slug]/catalogo` | `Filtrar y ordenar`            |
| Último eslabón del rastro    | `Filtrar y ordenar`            |
| `<title>` sin filtros        | `Filtrar y ordenar · {tienda}` |
| `<title>` con filtros        | `{n} productos · {tienda}`     |

Las mismas tres palabras en el enlace, en el título y en el rastro. Una segunda
manera de nombrar el mismo sitio es cómo un producto pierde su vocabulario.

**El panel**

| Elemento                         | Texto                          |
| -------------------------------- | ------------------------------ |
| `<summary>`, sin nada aplicado   | `Filtros y orden`              |
| `<summary>`, con `{n}` aplicados | `Filtros y orden ({n})`        |
| Botón de envío                   | `Aplicar`                      |
| Salida, si hay algún filtro      | `Quitar todos los filtros`     |
| Salida, si solo hay orden        | `Volver al orden de la tienda` |
| Enlace al catálogo completo      | `Ver todo el catálogo`         |

**Ordenar por** (`<legend>`: `Ordenar por`)

| Opción                         | Cuándo se ofrece                                            |
| ------------------------------ | ----------------------------------------------------------- |
| `Más relevantes`               | Solo con término de búsqueda; marcada por defecto ahí (E11) |
| `Destacados primero`           | Solo sin término de búsqueda; marcada por defecto ahí       |
| `Precio: de menor a mayor`     | Siempre                                                     |
| `Precio: de mayor a menor`     | Siempre                                                     |
| `Nombre: de la A a la Z`       | Siempre                                                     |
| `Últimos añadidos al catálogo` | Siempre                                                     |

Letra pequeña, **solo** cuando ese último está aplicado:
`Ordenado por cuándo entró cada producto en este catálogo. Los que llegaron en
el mismo envío salen juntos, por orden alfabético.`

**Precio** (`<legend>`: `Precio`)

| Elemento              | Texto                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| Línea de rango        | `En esta tienda los precios van de $90 a $1 150.`                      |
| Ayuda bajo los campos | `En {moneda}. Números enteros; déjalo en blanco para no poner límite.` |
| Etiqueta del primero  | `Desde`                                                                |
| Etiqueta del segundo  | `Hasta`                                                                |
| Atajos                | `Hasta $350` · `De $350 a $540` · `Más de $540`                        |

**Categoría** (`<legend>`: `Categoría`)

| Elemento              | Texto                                                            |
| --------------------- | ---------------------------------------------------------------- |
| Cada casilla          | `{categoría}` + `({n})` visible + `{n} productos` para el lector |
| Desplegable del resto | `Ver {n} categorías más`                                         |

**Otros filtros** (`<legend>`: `Otros filtros`)

| Casilla                 | Qué hace                                   |
| ----------------------- | ------------------------------------------ |
| `Solo lo que hay ahora` | Deja fuera los `OUT_OF_STOCK` (E2, R3)     |
| `Solo con descuento`    | Solo con promoción **vigente ahora** (E22) |
| `Solo destacados`       | Solo `featured`                            |

**Los chips**

| Elemento                      | Texto                                             |
| ----------------------------- | ------------------------------------------------- |
| Etiqueta del landmark         | `Filtros aplicados` (en `aria-label`, no visible) |
| Categoría                     | `Categoría: {categoría}`                          |
| Límite inferior / superior    | `Desde $350` · `Hasta $540`                       |
| Los tres booleanos            | El mismo texto de su casilla, tal cual            |
| Nombre accesible de cada chip | `Quitar el filtro {texto del chip}`               |
| Último chip, con 2 o más      | `Quitar todos los filtros`                        |

**La línea de resultados y la paginación**

| Situación            | Texto                                                    |
| -------------------- | -------------------------------------------------------- |
| Sin filtros ni orden | `{n} productos en {tienda}.`                             |
| Con orden aplicado   | `{n} productos, ordenados por precio, de menor a mayor.` |
| Uno solo             | `1 producto en {tienda}.`                                |
| Paginando            | `Productos {a} a {b} de {n}.`                            |
| Enlaces              | `Página anterior` · `Página siguiente`                   |

**Los cuatro vacíos**

| Cuál                        | Texto                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| (a) Tienda sin productos    | `Esta tienda todavía no tiene productos publicados.` — **la misma cadena que `/[slug]`** |
| (b) Búsqueda sin resultados | La de F-021, sin tocar una letra                                                         |
| (c) Filtros sin resultados  | `Con estos filtros no queda ningún producto.` + `Quita alguno para ver más productos.`   |
| (d) Página inexistente      | `Esta página ya no tiene resultados.` + `Volver a la primera página`                     |

**Lo que ningún texto de esta pantalla dice:** «No encontramos» (es de la
búsqueda, y E16 pide que no se confundan), «Novedades» (§ Decisión 3), «Filtros
avanzados» (no hay unos básicos), «Limpiar» (se quita, no se limpia) y
«Resultados» en `/[slug]/catalogo` (aquí son **productos**; «resultados» es de
buscar algo).

---

## Lo que este diseño le pide al arquitecto

Nueve peticiones. **Siete ya están cerradas** en
`.agent/specs/F-027/architecture.md`, que llegó a `listo` a la vez que este
documento; se dejan escritas con su resolución, porque lo que aquí se pidió es
lo que allí hay que seguir cumpliendo. **Dos siguen abiertas** y son las que el
plan tiene que recoger.

**RD1 — el rótulo, no el parámetro. CERRADA.** Ninguna etiqueta de § Textos
depende del nombre del parámetro. Lo que el diseño necesitaba del vocabulario
era: que la categoría reutilice el parámetro de F-026 (SP2), que la opción por
defecto del orden canonice a «sin orden» y que los dos límites de precio sean
**dos** parámetros independientes, para que «Desde» y «Hasta» generen dos chips
que se quitan por separado. Las tres las da la tabla del vocabulario
(`categorySlug` repetido, `sort` sin token para el orden por defecto,
`precio_min` y `precio_max`).

**RD2 — el conteo por faceta, con las demás facetas aplicadas. CERRADA.** La
regla de § Decisión 4 —«Bebidas (4)» es cuántos **añadiría** marcarla— es
literalmente la que la arquitectura acumula en la misma pasada, y viaja en
`CatalogFilterResult.facets`. Sobre el resultado completo, nunca sobre la
página.

**RD3 — el mínimo, el máximo y los dos terciles del catálogo. ABIERTA.** Es lo
único del diseño que el contrato de hoy **no** transporta:
`CatalogFilterResult.facets` lleva las categorías y los tres booleanos, y no
lleva el rango de precios. Sin esos cuatro números no se pueden pintar ni la
línea «los precios van de $90 a $1 150» ni los tres atajos de § Decisión 2. Se
calculan en el mismo recorrido y sobre los mismos precios ya resueltos, así que
no cuestan una segunda pasada: lo que hace falta es un sitio donde ponerlos, y
que respeten el umbral de 12 productos con precio y las tres condiciones de no
degeneración.

**RD4 — un formateador de importes enteros. ABIERTA.** «$350», no «$350.00»:
los límites son enteros por R6 y mostrar decimales afirma una precisión que el
parámetro no tiene. Tiene que salir del mismo `Intl` que `formatMoney` de
`src/lib/money.ts`, para que el símbolo no pueda discrepar del de las tarjetas.
Afecta a los chips de precio, a los tres atajos y a la línea de rango.

**RD5 — el tope por página. CERRADA, y en contra de lo que este diseño
proponía.** Se pedía una constante propia con el valor 24; la arquitectura
reutiliza `STORE_SEARCH_PAGE_SIZE` de `src/constants/storeSearch.ts` con el
argumento de que dos constantes con el mismo valor son una divergencia esperando
a pasar. Es su capa y su llamada. Lo que el diseño necesita se cumple igual: el
valor sigue siendo **24**, que es múltiplo de 2, 3 y 4 —las columnas de la
rejilla a 360, 768 y 1280— y por eso la última fila nunca queda a medias.

**RD6 — ningún enlace ni el formulario emiten el parámetro de página. CERRADA**
por la canonización, que omite `p=1`. Es como R9/E13 se cumple por construcción
en vez de por acordarse.

**RD7 — orden fijo de los parámetros y sin valores vacíos en lo que genera la
página. CERRADA:** un solo constructor de URL para chips, atajos y paginación.
El formulario sigue pudiendo escribir `precio_min=&precio_max=&orden=` en la
barra de direcciones, y eso está aceptado en § Decisión 7.

**RD8 — un tope por faceta antes de tocar los datos. CERRADA** en 12 valores. El
diseño solo añade una consecuencia visible: lo que se recorte **no genera chip**,
porque no se aplicó (R18).

**RD9 — dos números medidos para el implementador.** El panel plegado son 46 px
y el enlace de entrada añade 12 px a `/[slug]`. Si en la revisión visual salen
otros, algo se desvió de este documento.

---

## Verificación visual

Con `npm run seed` en la base y la app levantada (un solo `next dev`, y
comprobando de qué directorio es). Cada paso que no se cumpla se anota como
`VISUAL FAIL <qué>`.

| #       | Qué mirar                                                                                                                                                            | Dónde                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **V1**  | `/tienda-demo`: «Filtrar y ordenar» a la derecha del `<h1>`, **en la misma línea**, fila de 44 px, y la primera tarjeta en y≈428 (era 416)                           | 360, 768, 1280                                          |
| **V2**  | Sin parámetros: el panel llega **abierto**, ninguna casilla marcada (R3) y ningún chip                                                                               | 360                                                     |
| **V3**  | Con un filtro puesto: panel **plegado** (46 px), `Filtros y orden (1)`, y el chip encima                                                                             | 360, 1280                                               |
| **V4**  | Panel abierto: 1 columna a 360 (~869 px con las 4 categorías), 2 a 768 (~563), 4 a 1280 (~368)                                                                       | 360, 768, 1280                                          |
| **V5**  | **Ningún desplazamiento horizontal de la página** con el panel abierto y siete chips puestos (`scrollWidth === innerWidth`)                                          | 360, 768, 1280                                          |
| **V6**  | El «Aplicar» se queda pegado al borde inferior mientras se recorre el panel abierto, y se despega al llegar al final del panel; a 1280 no es pegajoso                | 360, 1280                                               |
| **V7**  | Recorrido con `Tab` completo, en el orden de § Accesibilidad, con **anillo de foco visible y sin recortar** en cada parada, incluido el `<summary>`                  | 360                                                     |
| **V8**  | `Enter` sobre el `<summary>` abre y cierra el panel **con el JavaScript desactivado**                                                                                | 360                                                     |
| **V9**  | Con JavaScript desactivado: marcar dos casillas + «Aplicar» recarga con el resultado filtrado; la ✕ de un chip lo quita (E14)                                        | 360                                                     |
| **V10** | Los conteos: `Bebidas (4)`, `Alimentos (5)`, `Aseo (3)`, `Panadería (3)`, `Solo lo que hay ahora (13)`, `Solo destacados (3)`; y **«Solo con descuento» no aparece** | `/tienda-demo`                                          |
| **V11** | Los tres atajos de precio, con `Hasta $350 (5)`, `De $350 a $540 (5)`, `Más de $540 (5)`, y la línea «los precios van de $90 a $1 150»                               | `/tienda-demo`                                          |
| **V12** | En `tienda-dos` (5 productos) **no** hay atajos de tramo: solo los dos campos y la línea de rango                                                                    | `/tienda-dos`                                           |
| **V13** | Elegir «Últimos añadidos al catálogo» muestra la letra pequeña; ningún texto de la pantalla dice «Novedades»                                                         | 360                                                     |
| **V14** | Los cuatro vacíos, uno a uno, y que las cuatro primeras frases son distintas                                                                                         | 360                                                     |
| **V15** | Con `tienda-cerrada` (`SUSPENDED`): `StoreClosedNotice`, sin panel y sin chips; y un slug de marca en modo selector: 404                                             | 360                                                     |
| **V16** | En claro y en oscuro: el chip aplicado **no** se confunde con el chip activo de la fila de categorías de F-026; «Aplicar» sale del `brand` de la tienda              | `/tienda-demo` y `/tienda-dos` (verde, `radius: round`) |
| **V17** | Un lector de pantalla (o el árbol de accesibilidad) anuncia «Bebidas, 4 productos» y no «abre paréntesis»                                                            | 360                                                     |
| **V18** | Un filtro puesto dentro del sub-desplegable de categorías hace que ese sub-desplegable llegue **abierto**                                                            | 360, con 15 categorías sembradas                        |

---

## Preguntas al humano

**Ninguna, y `estado: listo`.** Lo que queda pendiente no es una decisión del
humano sino dos peticiones al arquitecto —**RD3** (el rango y los terciles de
precio, que el contrato de hoy no transporta) y **RD4** (el formateador de
importes enteros)—, las dos dentro de su propia frontera y las dos anotadas para
que el plan las recoja.

Los ocho huecos que `spec.md` § No decidido a propósito le asignó a
diseño quedan cerrados en § Decisión 1 a 7 y en § Inventario, y los tres que
podían haber sido preguntas se cerraron con dato en vez de con opinión:

- **Los tramos de precio** los decidió la tabla de precios reales de la base, no
  una preferencia (§ Decisión 2).
- **El rótulo de «más reciente»** lo decidió I9, que dice exactamente qué mide
  `createdAt` y qué pasa en el alta inicial (§ Decisión 3).
- **Si `/[slug]/buscar` lleva panel de facetas** lo decidió SP5, que ya aceptó la
  asimetría entre las dos superficies y dejó escrito que se puede añadir después
  «sin cambiar ninguna URL». Lo que sí lleva son los chips, para que un filtro
  llegado por la URL nunca actúe en silencio (§ Inventario 3).

Queda **anotado, no preguntado**, un límite que hoy no toca a nadie: R6 fija los
límites de precio como enteros de la moneda de exhibición, y en una tienda cuyos
precios estuvieran por debajo de 10 en su moneda el filtro sería casi inútil. Los
dos negocios de la base exhiben en CUP y ninguno está en ese caso. Cuando
aparezca el primero, es una pregunta para el humano y un cambio en `spec.md`, no
un parche aquí.
