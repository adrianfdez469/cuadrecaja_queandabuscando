---
feature: F-039
agente: sdd-designer
actualizado: 2026-09-08T12:06:06Z
estado: listo
---

> Escrito **en paralelo** con `.agent/specs/F-039/architecture.md`, que cerró
> en `estado: listo` a las 04:26 —con esto ya escrito— y **conciliado con él
> después**. La conciliación no cambió ni una pantalla ni una palabra de este
> documento: el mecanismo que eligió (AD4, atributo en `<html>` + N+1 reglas de
> CSS servidas + guion en línea de 324 bytes antes del pintado) **cumple las
> cuatro exigencias** que aquí se escribieron sin conocerlo, y su § Restricciones
> para el diseñador coincide punto por punto con lo que la maqueta ya hacía. Lo
> que la conciliación sí añadió está marcado: los **nombres** que ya están
> decididos (el atributo `data-equiv`, la clave `qab.reference-currency.v1`, el
> centinela `none`, los archivos de src/features/currency/ por crear) y los
> **bytes de HTML medidos por él**, que son más altos que los míos y son los que
> hay que planificar (§ Coste de cliente).
>
> **Lo que el humano cerró el 2026-09-08 y aquí no se reabre:** DH1 (con
> JavaScript, principal en la base + **solo** el equivalente elegido; los demás
> viajan y se ocultan; sin JavaScript se ven todos), DH2 (**un** selector en la
> cabecera, para toda la tienda, recordado entre visitas), DH3 (el equivalente
> acompaña también al agregado de carrito y checkout, con el aviso del cobro),
> DH4 (SP1(a) defecto = primera declarada calculable, con opción explícita de
> volver a solo la base; SP2(a) sin tope; SP3(a) el tachado y los chips de
> F-027 no llevan equivalente) y **DH5** (una moneda declarada **sin tasa
> vigente no se ofrece en el selector**: desaparece de las opciones mientras no
> haya tasa y vuelve sola cuando llegue su `EXCHANGE_RATE`; la lista guardada no
> se poda). DH5 llegó **después** de la primera versión de este documento, como
> respuesta a DP3, y lo que movió está enumerado en § Preguntas al humano; lo
> más visible es que **D6 ya no existe** y que la región viva pasó a `sr-only`.
> `spec.md` y `architecture.md` se están ajustando a DH5 en paralelo: R1, § «Las
> dos capas», E6 y § «Casos límite» de la primera, y `data-ref-choices` con
> `equivalentCurrencies` de la segunda.
>
> Lo que este documento cierra son los tres huecos que
> `.agent/specs/F-039/spec.md` § No decidido a propósito le dio al diseño: **las
> palabras exactas** (su punto 3), la mitad visible del **revelar/ocultar** (su
> punto 2) y, por DH2/DH3, la forma y el sitio del selector y del aviso. **No
> queda ninguna decisión de pantalla abierta** y las cuatro `DP1..DP4` del final
> están **cerradas**: DP1, DP2 y DP4 en la opción recomendada, DP3 con la cuarta
> opción que escribió el humano (DH5). Se conservan con su razonamiento, no
> borradas.

## Qué se miró antes de diseñar

`AGENTS.md` entero, con parada en § Prohibiciones (la de `"use client"` en
cualquier cosa que renderice catálogo, que es la regla que decide este diseño, y
la de `setState` dentro de un `useEffect`), § «El presupuesto de JavaScript no
es un muro», § Cosas que muerden y § Idioma. `.agent/specs/F-039/spec.md`
completo —E1..E18, R1..R22, la tabla de trece casos límite, I1..I6, SP1..SP3 y
§ No decidido a propósito—, la entrada F-039 de `.agent/features.json` con sus
once criterios y su `notes`, y `.agent/progress/F-039.md` (DH1..DH4).
`.agent/specs/F-027/design.md` como referencia de tono y de método, y
`.agent/specs/F-038/design.md`, que es un «no aplica» y explica por qué el
diseño empieza aquí.

Del código: `src/components/store/ProductCard.tsx` (el precio, L62-73),
`src/components/store/StoreCatalogResults.tsx` y
`src/components/store/StoreSearchResults.tsx` (la rejilla,
`grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4` en las dos),
`src/app/[slug]/layout.tsx` (la cabecera y su `revalidate = 3600` literal),
`src/app/[slug]/page.tsx`, `src/app/[slug]/c/[categorySlug]/page.tsx`,
`src/app/[slug]/catalogo/page.tsx`, `src/app/[slug]/buscar/page.tsx`,
`src/app/[slug]/p/[productSlug]/page.tsx` (el importe grande, L202-217),
`src/features/cart/components/CartView.tsx` (el subtotal, L299-312),
`src/features/cart/components/CheckoutForm.tsx` (los importes, L435-453, y su
`OrderSummary` de L833-849), `src/features/cart/components/OrderSummary.tsx`,
`src/components/store/StoreFilterPanel.tsx`, y el precedente exacto de un
control que solo existe tras hidratar:
`src/features/cart/components/CartBadge.tsx` con
`src/features/cart/cartStore.ts:83-85`, `src/features/cart/cartStorage.ts` y
`src/constants/cart.ts:14`. De los primitivos, `src/components/ui/Card.tsx`,
`src/components/ui/Container.tsx`, `src/components/ui/Badge.tsx` y
`src/components/ui/Button.tsx`; de tema, `src/theme/tokens.css`,
`src/app/globals.css`, `src/features/theming/storeTheme.ts` y
`scripts/check-theme-tokens.mjs`; de coste, `scripts/check-bundle-budget.mjs`.
Y `src/lib/money.ts` (`convert` L141-161, `formatMoney` L192-194) con
`src/lib/pricing.ts`.

### Se miró la pantalla de verdad, y con números

Levanté `next dev` **en el 3200** de este worktree después de comprobar que
nadie ocupaba el puerto (los dos únicos `node` escuchando en la máquina eran un
5173 y un 5555 ajenos; AGENTS.md § «Un solo `next dev` por directorio»). Todo lo
que sigue está **medido** con Playwright contra ese servidor y la base de
desarrollo ya sembrada, y el prototipo se inyectó en la página real, no en una
maqueta aparte. Nada de esta sección es una estimación.

**Geometría de hoy de `/tienda-demo`** (15 productos con precio):

| Elemento                                | 360       | 768       | 1280      |
| --------------------------------------- | --------- | --------- | --------- |
| Cabecera (una fila)                     | 68        | 68        | 68        |
| Rejilla: columnas                       | **2**     | 3         | 4         |
| Ancho de tarjeta                        | **156**   | 229       | 264       |
| Ancho útil del texto dentro de la tarj. | **132**   | 205       | 240       |
| Alto de tarjeta (mín/máx)               | 230 / 280 | 327 / 333 | 362 / 368 |
| Línea del precio (16 px / 600)          | 24        | 24        | 24        |
| Primera tarjeta, desde el inicio        | 668       | 584       | 584       |

Dos correcciones al enunciado del ciclo, medidas: **a 360 px la rejilla tiene
dos columnas, no una** (`grid-cols-2`, tarjeta de 156 px), y ese ancho de 132 px
de texto es el que decide casi todo lo de abajo. Y el ancho libre de la fila de
marca a 360 es **cero**: el nombre de la tienda ya va con `truncate` y ocupa
214 px de los 328 disponibles junto a «Carrito» (46) y «Cuenta» (44).

**El prototipo, medido en su sitio.** Equivalentes en la misma línea del
precio, en un contenedor que envuelve (`flex flex-wrap items-baseline gap-x-2`),
con `formatMoney` real (`es-CU`):

| Estado                  | 360: alto máx. de tarjeta | 768          | 1280         |
| ----------------------- | ------------------------- | ------------ | ------------ |
| Hoy, sin equivalentes   | 280                       | 333          | 368          |
| 1 equivalente           | 290 (+10)                 | 333 (**+0**) | 368 (**+0**) |
| 2 equivalentes          | 296 (+16)                 | 349 (+16)    | 368 (**+0**) |
| 3 equivalentes          | 312 (+32)                 | 349 (+16)    | 384 (+16)    |
| 5 equivalentes          | 344 (+64)                 | 365 (+32)    | 400 (+32)    |
| **40 equivalentes**     | **792 (+512)**            | 573 (+240)   | 592 (+224)   |
| 3 en el DOM, 1 visible  | 290                       | 333          | 368          |
| 40 en el DOM, 1 visible | **290**                   | **333**      | **368**      |

Las dos últimas filas son el hallazgo que sostiene DH1: ocultar con
`display: none` devuelve la maqueta **exactamente** a la del caso de un
equivalente, sean tres o cuarenta los que viajen en el HTML. Y en ningún ancho,
con ningún número de monedas, aparece desplazamiento horizontal
(`scrollWidth === innerWidth` en 360, 768 y 1280).

**La marca de aproximado, elegida midiendo.** Cuántas de las 15 tarjetas
mantienen el precio y su equivalente en **una sola línea**:

| Marca    | 360         | 768   | 1280  |
| -------- | ----------- | ----- | ----- |
| `≈`      | **10 / 15** | 15/15 | 15/15 |
| `aprox.` | **0 / 15**  | 15/15 | 15/15 |

A 360 px `aprox.` parte en dos líneas **todas** las tarjetas y `≈` solo las de
precio largo (`$499.00`, `$1,150.00`, `$890.00`, `$380.00`, `$540.00`). Eso
decide § Textos D1 sin discutir de gustos.

**El HTML que cuesta** (misma URL, mismo catálogo de 15 productos; crudo y
gzip, que es lo que mira `scripts/check-bundle-budget.mjs`):

| Equivalentes por tarjeta | HTML crudo        | HTML gzip               |
| ------------------------ | ----------------- | ----------------------- |
| Hoy                      | 83 803 B          | 13 048 B                |
| 1                        | +4 095 B          | **+222 B (+0,22 KB)**   |
| 2                        | +6 240 B          | +380 B                  |
| 3                        | +8 385 B          | +443 B                  |
| 5                        | +12 675 B         | +542 B                  |
| **40**                   | +87 750 B (×2,05) | **+1 843 B (+1,80 KB)** |

Cuarenta monedas duplican el HTML crudo y cuestan **1,8 KB comprimidos**. El
coste real del caso extremo no son los bytes: es la tarjeta de 792 px y una
página de 7 069 px de alto a 360 (hoy 2 973). Con JavaScript, ninguno de los dos
existe.

**Y el coste de servidor de formatear**, que es de quien va a memoizar
`Intl.NumberFormat` (`src/lib/money.ts:173-192`), medido en este Node 24.13.1
con 24 tarjetas por página:

| Monedas | Sin memo | Con un formateador por moneda |
| ------- | -------- | ----------------------------- |
| 2       | 0,7 ms   | 0,1 ms                        |
| 3       | 0,9 ms   | 0,1 ms                        |
| 40      | 12,2 ms  | 1,4 ms                        |

**Contraste real, compuesto en pantalla** (calculado sobre los colores que
resuelven de verdad los tokens de `src/theme/tokens.css`, en los dos temas):

| Par                                                  | Claro    | Oscuro   |
| ---------------------------------------------------- | -------- | -------- |
| `text-fg-muted` sobre la tarjeta (`--color-surface`) | **5,53** | **6,63** |
| `text-fg-muted` sobre el fondo de página             | 5,38     | 7,16     |
| `text-brand-contrast` sobre `--color-brand`, opaco   | **4,84** | 4,84     |
| lo mismo con `opacity-90`                            | 4,22     | 4,22     |
| lo mismo con `opacity-80` (lo que usa hoy la ciudad) | 3,64     | 3,64     |
| `text-fg` sobre `--color-surface` (el `<select>`)    | 17,30    | 15,31    |

Ese 4,22 es la razón por la que el aviso de la cabecera va **sin** `opacity`
(D8): con `opacity-90` ya no pasa AA para texto normal.

**Y una comprobación de accesibilidad, no una promesa.** Con tres equivalentes
en el DOM y dos con `display: none`, el nombre accesible del enlace de la
tarjeta que calcula Chromium es, literalmente:

```
link "Arroz blanco 1 kg Arroz blanco 1 kg $620.00 aproximadamente US$1.02"
```

El elegido entra con la palabra completa; el `≈` no se anuncia (va
`aria-hidden`); MLC y EUR **no aparecen**. Eso es C15 y R15 verificados en un
motor real. (El nombre del producto sale dos veces porque el `alt` de la imagen
y el `<h3>` ya lo repiten hoy: deuda anterior, no de este feature.)

---

## Flujo de usuario

En una frase: **el comprador entra a cualquier página de la tienda, ve el precio
en la moneda que se le va a cobrar con su equivalente aproximado al lado, y si
quiere otro equivalente lo cambia una vez en la cabecera y le acompaña por todo
el catálogo, la ficha, el carrito y el checkout, también la próxima visita.**

```
QR / enlace  ──►  /[slug]  (HTML servido, idéntico para todos)
                    │  cabecera: nombre · Carrito · Cuenta
                    │  sub-barra: «Cobramos en CUP.»          [hueco 160×44]
                    │  rejilla: $620.00  ≈ US$1.41  ≈ MLC 2.95  ≈ EUR 1.29
                    │
     ┌──────────────┴───────────────────────────────┐
     │ SIN JavaScript                               │ CON JavaScript
     ▼                                              ▼
  se queda así: los N equivalentes,             antes del primer pintado queda
  el aviso, y ningún control que                solo el elegido (o el primero
  no haría nada                                 declarado calculable, DH4/SP1)
                                                   │
                                                   │  al hidratar, en el hueco
                                                   │  aparece  [También en USD ▾]
                                                   ▼
                                    ┌──────────────┴───────────────┐
                                    │ «También en MLC»             │ «Solo CUP»
                                    ▼                              ▼
                        cada precio cambia de equivalente     ningún equivalente,
                        (una sola línea, sin ir al servidor)  solo el principal
                                    │
                                    ├─► /[slug]/c/… · /catalogo · /buscar · /p/…
                                    │   la misma elección, sin volver a elegirla
                                    ├─► /[slug]/carrito   subtotal + ≈ + aviso
                                    ├─► /[slug]/checkout  total + ≈ + aviso
                                    └─► otra visita, otro día, mismo navegador:
                                        sigue puesta (una clave de localStorage)
```

**Vueltas atrás y qué se pierde.** Hay una sola y es completa: la opción
**«Solo CUP»** del selector devuelve la pantalla al estado sin equivalentes y se
recuerda igual que cualquier otra elección, así que nada queda irreversible
(era la condición que SP1 le puso a su propia recomendación). Cambiar de moneda
no pierde nada: no toca el carrito, no recarga, no cambia la URL, no altera el
conjunto ni el orden de los resultados (R14) y no manda nada al servidor (R11).
Lo único que **no** vuelve atrás por sí solo es el aviso «Cobramos en CUP.»:
está en el HTML servido y no se puede quitar, a propósito.

---

## Las cuatro superficies

Las cuatro pintan lo mismo con la misma pieza y el mismo orden de lectura:
**importe principal → equivalentes en el orden de la lista declarada**. Nada más
tiene equivalente: ni el tachado «Antes …» (`src/components/store/ProductCard.tsx:69-73`), ni los
chips de rango de F-027, ni los campos del panel de filtros (DH4/SP3(a) y
`.agent/specs/F-039/spec.md` § Fuera punto 5).

### 1. La tarjeta en la rejilla — `src/components/store/ProductCard.tsx`

El equivalente va **dentro del mismo párrafo del precio**, como un grupo que
envuelve, no en un párrafo aparte. Es lo que hace que a 768 y 1280 un
equivalente cueste **cero** píxeles de alto (medido) y que a 360 la mayoría de
las tarjetas sigan en una línea.

```
┌─ 156 px (360) ───────────┐      ┌─ 264 px (1280) ───────────────────┐
│ [imagen 1:1]             │      │ [imagen 1:1]                      │
│ Arroz blanco 1 kg        │      │ Arroz blanco 1 kg                 │
│ $620.00  ≈ US$1.41       │      │ $620.00  ≈ US$1.41  ≈ MLC 2.95    │
│ Antes $650.00            │      │ Antes $650.00                     │
│ [Pocas unidades]         │      │ [Pocas unidades]                  │
└──────────────────────────┘      └───────────────────────────────────┘
```

- **Jerarquía (R3).** El principal se queda tal cual, 16 px / 600 y color de
  marca. El grupo de equivalentes es `text-fg-muted text-xs font-normal`
  (12 px / 400, gris). Más pequeño, más claro y sin color de marca: tres
  señales, no una.
- **Un elemento por equivalente, con todo dentro.** Cada uno es el elemento que
  lleva el `data-equiv="MLC"` de AD4, y dentro van **las tres cosas** que tienen
  que desaparecer juntas: el `≈`, la palabra para el lector de pantalla y el
  importe. Nada de eso queda fuera (restricción 1 del arquitecto), o lo que
  quede se seguiría anunciando.
- **Cada equivalente no se parte por dentro.** `whitespace-nowrap` por
  equivalente: envuelve entre equivalentes, nunca dentro de `≈ MLC 2.95`.
- **Sin separadores de puntuación.** El espacio lo pone `gap-x-2` (8 px), no un
  `·` ni una coma. Es una decisión de diseño con consecuencia técnica: al
  ocultar uno no queda huérfano ningún signo, que es exactamente lo que pasaría
  con separadores en el texto. Es además, palabra por palabra, la restricción 2
  del arquitecto (nada de `::before` sobre el segundo, nada de `:nth-child`,
  nada que dependa de cuántos quedan visibles): el `gap` de un contenedor flex
  se porta bien porque `display: none` saca al elemento del flujo, y el
  contenedor no cuenta a nadie.
- **Orden dentro de la tarjeta.** Principal, equivalentes, y **después** el
  tachado «Antes …». El equivalente pertenece al número que se cobra y va pegado
  a él; el tachado, que ya es gris y de 12 px, queda debajo y se distingue por
  su palabra («Antes») y por el `line-through`.
- **1 equivalente:** a 360 diez de quince tarjetas siguen en una línea y cinco
  crecen 16 px; a 768 y 1280, cero cambio.
- **3 equivalentes:** +32 px a 360, +16 a 768 y 1280. La rejilla sigue cuadrada
  porque las filas de `grid` estiran a la más alta: no hay tarjetas de altura
  desigual, hay filas un poco más altas.
- **40 equivalentes:** solo lo ve quien no ejecuta JavaScript. La tarjeta llega
  a 792 px a 360 (el bloque de equivalentes ocupa 536 px, 20 líneas de 12 px), y
  el documento pasa de 2 973 a 7 069 px. **No se rompe nada**: no hay
  desplazamiento horizontal, la imagen no se deforma (`aspect-square`), las dos
  columnas siguen alineadas y la insignia de disponibilidad sigue dentro. Es un
  catálogo largo de leer, que es la consecuencia honesta de SP2(a) y lo que el
  comerciante decidió al declarar cuarenta monedas. No se trunca (la poda
  invisible es justo lo que prohíbe la regla ① del contrato).
- **Producto sin precio:** «Consultar» como hoy y **ningún** equivalente. Ni
  `≈`, ni hueco, ni guion (E9).

Las cuatro páginas que pintan `ProductCard` lo ganan a la vez sin retoques
propios: `src/app/[slug]/page.tsx`,
`src/app/[slug]/c/[categorySlug]/page.tsx`, `src/app/[slug]/catalogo/page.tsx`
(por `StoreCatalogResults`) y `src/app/[slug]/buscar/page.tsx` (por
`StoreSearchResults` y, con filtros puestos, por `StoreCatalogResults`).

### 2. La ficha de producto — `src/app/[slug]/p/[productSlug]/page.tsx`

Mismo trato, una escala más arriba. El principal es de 30 px / 600
(`text-3xl font-semibold`, L202) y los equivalentes suben a **14 px**
(`text-sm`) porque hay sitio: la columna mide 328 px a 360 y 536 a 1280.

```
Arroz blanco 1 kg
$620.00   ≈ US$1.41
Antes $650.00
Promoción: 10% de descuento.
[Disponible]
```

Medido: con 1 equivalente el bloque **no crece en ningún ancho** (36 px de línea
en los tres); con 3 crece 20 px solo a 360; con 40 crece 200 px a 360 y 768 y
120 a 1280, y el botón de agregar baja lo mismo. `AddToCartButton` no cambia:
sigue recibiendo el importe y la moneda base (L237-238).

### 3. El subtotal del carrito — `src/features/cart/components/CartView.tsx`

El equivalente va **debajo** del subtotal, alineado a la derecha con él, dentro
de la misma región `aria-live` que ya existe (L297-312). Aquí no hay N
equivalentes nunca: el cliente calcula **el elegido** y nada más, así que el
problema de las cuarenta monedas no llega a esta pantalla.

```
┌─ barra inferior fija (360) ─────────────────┐
│ Subtotal                        $4,400.00   │  18 px / 600
│                                ≈ US$10.00   │  14 px / 400, gris
│ El envío se calcula en el siguiente paso.   │  12 px, gris
│ Cobramos en CUP; el equivalente es          │
│ aproximado.                                 │
│ [        Continuar        ]                 │
└─────────────────────────────────────────────┘
```

- Mientras la cotización está en vuelo el subtotal dice «Calculando…» como hoy y
  **no** se pinta ningún `≈`: un equivalente de un número que no está todavía
  sería peor que nada.
- El aviso se **añade al párrafo que ya existe** («El envío se calcula en el
  siguiente paso.»), no en uno nuevo: a 360 son dos líneas de 12 px en total en
  una barra fija que ya es lo más caro de esa pantalla. Y solo se añade cuando
  hay equivalente que enseñar.
- Sin JavaScript esta pantalla sigue diciendo lo de hoy («Para armar un pedido
  necesitas activar JavaScript…», L115-122). No gana nada y no pierde nada.

### 4. El resumen del checkout — `src/features/cart/components/OrderSummary.tsx`

Igual, sobre el **total**. El aviso entra por la ranura `note` que el componente
ya tiene (`text-fg-muted text-xs`, L75) y el equivalente pide **una ranura
nueva**, hermana de `partialNotice`: son dos cosas distintas —un importe y una
frase— y meterlas en la misma cadena las pegaría.

```
Subtotal                  $4,400.00
Descuento                   −$40.00
Envío                       $200.00
───────────────────────────────────
Total                     $4,560.00     16 px / 600
más el envío por confirmar              (solo si el envío está por cotizar)
                         ≈ US$10.36     14 px / 400, gris
Cobramos en CUP; el equivalente es aproximado.
```

- **Solo el total lleva equivalente**, no el subtotal, ni el descuento, ni el
  envío. Motivo: el total es el número por el que el comprador decide, y cuatro
  equivalentes en una columna de cuatro filas convierten el resumen en una tabla
  de cambio. Es la misma disciplina de DH4/SP3(a) aplicada dentro de la pantalla.
- **El orden con el total parcial** deja «más el envío por confirmar» pegado al
  número, como lo puso F-031 a propósito (ese aviso habla del número mismo), y
  el `≈` va detrás. Un total parcial también lleva su equivalente: es el
  agregado que se está enseñando.
- El cuerpo del `POST /api/orders` no cambia ni un carácter: `expectedTotal` y
  `expectedUnitPrice` siguen en la base (`src/features/cart/components/CheckoutForm.tsx:313-324`).

---

## El selector de moneda de referencia

### Dónde, exactamente

En una **segunda fila de la cabecera de la tienda**
(`src/app/[slug]/layout.tsx`), dentro del `<header class="bg-brand">`, separada
de la fila de marca por un filete y con el mismo `Container`: el aviso a la
izquierda, el selector pegado al borde derecho, debajo de «Cuenta».

```
┌───────────────────────────────────────────────────────────────┐
│ La Rampa · Vedado              · La Habana  Carrito  ⃝ Cuenta │ 68 px
├───────────────────────────────────────────────────────────────┤
│ Cobramos en CUP.                        [ También en USD  ▾ ] │ 53 px
└───────────────────────────────────────────────────────────────┘
```

**Por qué una fila nueva y no la fila de marca**, medido: a 360 px meter un
control de 160 px en la fila de marca deja el nombre de la tienda en **53 px**
(«La Ra…»), porque el nombre ya va con `truncate` y no hay ni un píxel libre. El
nombre de la tienda es su identidad; una fila de 53 px es más barata que
borrarlo. Descartado también repartir —selector en la fila de marca a partir de
768 y sub-barra solo a 360—: son dos maquetas que mantener y dos huecos que
reservar para ahorrar 53 px en el ancho donde sobra espacio.

**Lo que cuesta**, medido y aceptado (DP1): la cabecera pasa de 68 a **121 px**
y la primera tarjeta baja de 668 a **721** a 360, de 584 a **637** a 768 y 1280.
Solo en las tiendas cuyo negocio declara alguna moneda extra: con la lista vacía
la fila **no existe** (criterio 9).

### Su forma: un `<select>` nativo

Un `<select>` del sistema, no un menú propio. Razones, en orden de peso:

1. **Es el único que ya sabe todo lo que hay que saber**: teclado completo
   (`Tab`, flechas, `Home`/`End`, escribir las primeras letras), rol y estado
   correctos para el lector de pantalla, y en móvil la rueda nativa del sistema,
   que es lo que el comprador ya usa. Un menú propio hay que enseñárselo todo, y
   la mitad se olvida.
2. **Pesa lo que nada**: cero dependencias y cero código de posicionamiento. El
   presupuesto no es un muro (AGENTS.md), pero entre dos opciones gana la que
   menos pesa, y aquí la que menos pesa es además la más accesible.
3. **Aguanta las cuarenta monedas sin diseño extra**: la lista larga la resuelve
   el sistema operativo con su propio desplazamiento. Un menú propio necesitaría
   maqueta, altura máxima y foco atrapado para el mismo caso.

Forma exacta: alto **44 px** (`h-11`, el área de toque que ya usa el repo),
ancho **fijo de 160 px** (`w-40`), `rounded-md`, `border`, y —esto importa—
**fondo `bg-surface` y texto `text-fg`**, no transparente sobre la marca. Dos
motivos: en Windows la lista desplegada hereda el color del control, y un
`<select>` transparente con texto blanco deja las opciones ilegibles; y sobre la
barra de marca un control con fondo propio se lee como control, que es lo que
hace que alguien lo toque. Contraste medido del texto del control: **17,30** en
claro y **15,31** en oscuro.

El ancho fijo de 160 px cabe siempre y no depende de los datos: el texto más
largo posible es «También en XXX» (110 px a 14 px) porque los códigos son
siempre de tres letras (`/^[A-Z]{3}$/`, `src/features/sync/displayCurrencies.ts:15`),
y a 360 px el aviso (126 px) + `gap` (12) + control (160) = **298 de los 328**
disponibles: una línea, sin envolver. Medido, con la etiqueta más larga
seleccionada y sin recorte (`scrollWidth === clientWidth`).

### Qué opciones lista, y en qué orden

1. **«Solo CUP»** primero. Es el estado sin equivalentes y la vuelta atrás que
   pidió SP1; ponerlo arriba lo hace encontrable sin recorrer la lista.
2. Después, **las monedas declaradas que tienen tasa en esta tienda**, en el
   orden de la lista y menos la base (R2). Sin reordenar por nada más: el orden
   es del comerciante.
3. **Una moneda declarada sin tasa vigente no se ofrece** (DH5, humano
   2026-09-08). Desaparece de las opciones mientras no haya tasa, y vuelve sola
   —sin que nadie toque nada— en la primera visita posterior a su
   `EXCHANGE_RATE`, que es el camino de E11 y del criterio 8. **La lista
   guardada no se poda**: `Business.displayCurrencies` sigue intacta, y lo que
   se decide aquí es solo qué se ofrece en pantalla.

   Por qué es mejor que listarla: es **la misma razón por la que el selector no
   está en el HTML servido** (R13, «un control que sin JavaScript no hace nada
   es peor que ningún control»). Una opción que no puede cambiar ni un importe
   en ninguna tarjeta es un control muerto dentro de otro control, y explicarla
   con una frase —lo que este documento proponía antes en D6— es pagar texto,
   una región viva más ancha y un estado más para conservar algo que nadie puede
   usar. Deshabilitarla tampoco: un `<option disabled>` sigue ocupando sitio en
   la rueda del móvil y sigue pidiendo explicación.

   Lo que la capa 2 sí sigue haciendo, y que este cambio **no** toca, es omitir
   el importe que no se puede calcular producto a producto: eso es el criterio 4
   y sigue en pie (§ Inventario, fila «Moneda declarada sin tasa»).

### Qué se ve antes de hidratar

R13 prohíbe que el selector esté en el HTML servido, porque un control que sin
JavaScript no hace nada es peor que ningún control. Así que el HTML servido lleva
la sub-barra con el aviso y, en el sitio del control, un **hueco vacío de
160 × 44 px**; el selector aparece dentro de ese hueco al hidratar, con la
técnica de `CartBadge` (`getServerSnapshot` sin preferencia,
`src/features/cart/cartStore.ts:83-85`).

**Por qué no hay salto de maqueta, medido en el prototipo:** la fila mide 53 px
antes y después de que el control aparezca (`min-h-11` + `py-1` + filete manda,
y el control mide 44), la cabecera 121 px en los dos casos, y la primera tarjeta
está en 721 (360) y 637 (768 y 1280) **antes y después**. Ni un píxel.

El hueco es explícito y no incidental a propósito: sin él la fila también
mediría 53 px hoy —el aviso ocupa 20— pero un aviso que algún día envuelva a dos
líneas, o un control que crezca, convertiría el «no se mueve» en suerte. El
hueco cuesta unos 40 bytes de HTML y convierte la invariante en estructura.

---

## Inventario de pantallas y estados

Cada fila es un estado que alguien puede verificar. «Nada nuevo» significa
literalmente eso: el HTML de antes de este feature.

| Estado                                                                                    | Qué se ve                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin lista declarada** (`[]`, o solo la base, o `["CUP"]` con base CUP)                  | Nada nuevo: ni sub-barra, ni aviso, ni selector, ni `≈`. Un solo importe. Es el criterio 9 y el estado de todo negocio recién sembrado                                                                                                                |
| **Normal, sin JavaScript**                                                                | Aviso + los N equivalentes de cada precio, todos visibles, en el orden declarado. Ningún control                                                                                                                                                      |
| **Normal, con JavaScript, primera visita**                                                | Aviso + selector + **un** equivalente: el primero declarado que tenga tasa (DH4/SP1(a)). El selector muestra esa moneda seleccionada                                                                                                                  |
| **Con JavaScript, preferencia guardada**                                                  | Igual, con la moneda guardada. No se vuelve a elegir nunca (E4)                                                                                                                                                                                       |
| **«Solo CUP» elegido**                                                                    | Aviso + selector en «Solo CUP» + ningún equivalente en ninguna pantalla. Idéntico a la lista vacía salvo la sub-barra                                                                                                                                 |
| **Moneda declarada sin tasa en esta tienda**                                              | Su equivalente no se pinta en **ningún** producto, los demás sí y el principal queda intacto (criterio 4). Y **no se ofrece en el selector** (DH5): no hay estado «elegida sin tasa» que diseñar. La lista guardada no se toca                        |
| **…y llega su tasa**                                                                      | La primera visita posterior la ofrece en el selector y pinta su equivalente, sin que nadie toque la lista (E11, criterio 8). Nadie tiene que volver a elegir: quien ya tenía otra preferencia la conserva                                             |
| **Declara monedas pero ninguna con tasa**                                                 | Nada nuevo, exactamente como la lista vacía: sin equivalente calculable no hay nada que ofrecer ni que avisar, así que no hay sub-barra. Consecuencia de DH5 y la única fila que cambió de comportamiento con él                                      |
| **Producto sin precio resoluble**                                                         | «Consultar», cero equivalentes, cero `≈` (E9). En la rejilla su tarjeta es la única sin segunda línea: es correcto, no un hueco                                                                                                                       |
| **Preferencia guardada que esta tienda no ofrece** (no la declara, o la declara sin tasa) | Solo el principal; el selector muestra «Solo CUP», que es lo que se está viendo; la preferencia **no se borra** (E17/R17, y DP4 cerrada)                                                                                                              |
| **`localStorage` no disponible** (privado, cuota llena)                                   | El selector funciona igual y la elección vale para la sesión, en memoria, como el carrito (`src/features/cart/cartStorage.ts:24-38`). **Sin aviso al comprador**: perder una moneda de referencia no merece la alarma que sí merece perder un carrito |
| **Valor ilegible en la clave** (`qab.reference-currency.v1`, AD9)                         | Se trata como «sin preferencia» → el defecto de SP1(a). Nada falla, nada se dice                                                                                                                                                                      |
| **40 monedas declaradas**                                                                 | Con JavaScript, un equivalente. Sin JavaScript, cuarenta: tarjeta de 792 px a 360, página de 7 069 px, sin desplazamiento horizontal                                                                                                                  |
| **Tienda cerrada** (`status !== "PUBLISHED"`)                                             | Nada nuevo: esa rama no consulta el catálogo ni pinta importes (`src/app/[slug]/page.tsx:117-138`), así que **no** lleva sub-barra ni selector, igual que no lleva carrito                                                                            |
| **Marca con varias sucursales** (`kind: "selector"`)                                      | Nada nuevo: esa cabecera no pinta ningún importe (y ya no lleva `CartBadge`)                                                                                                                                                                          |
| **`/[slug]/pedido/[code]` y la cuenta**                                                   | La sub-barra está (viene del layout) y no hay ningún importe con equivalente: el selector no tiene efecto visible. Es I6, aceptado. Por eso el aviso dice «Cobramos en CUP.» y **no** habla de equivalentes: en esa pantalla también es verdad        |
| **Carrito vacío / cotización en vuelo / error de cotización**                             | Como hoy. El `≈` solo aparece cuando hay un importe firme que acompañar                                                                                                                                                                               |
| **Catálogo con filtros de F-027 puestos**                                                 | Los chips, el orden y los tramos siguen en la base y no ganan `≈` (R14). El panel ya dice «En CUP.» debajo de los campos de precio (`src/components/store/StoreFilterPanel.tsx:144`), así que R14 no necesita ni una palabra nueva                    |

---

## Estructura por breakpoint

| Zona                                 | 360px                                                                              | 768px                                                       | 1280px                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Cabecera, fila de marca              | Igual que hoy: nombre truncado + Carrito + Cuenta (icono)                          | Igual + ciudad + «Cuenta»                                   | Igual                                     |
| Cabecera, sub-barra                  | 53 px: aviso (20 px, una línea) izquierda, control 160×44 derecha                  | 53 px, lo mismo, con el control en el borde del `Container` | 53 px, lo mismo                           |
| Rejilla                              | 2 columnas, tarjeta 156, texto útil 132                                            | 3 columnas, tarjeta 229                                     | 4 columnas, tarjeta 264                   |
| Equivalentes en la tarjeta           | 12 px; 1 equivalente cabe en la línea del precio en 10 de 15 tarjetas              | 12 px; 1 cabe siempre; 2 abren segunda línea                | 12 px; **2** caben en la línea del precio |
| Ficha: equivalentes                  | 14 px, bajo el `<h1>`, columna única (la imagen va arriba)                         | 14 px, columna derecha (`md:grid-cols-2`)                   | 14 px, columna derecha                    |
| Carrito: subtotal                    | Barra **fija** abajo; `≈` bajo el subtotal; aviso de dos líneas                    | Igual, aún fija                                             | Columna `lg:sticky`; aviso en una línea   |
| Checkout: resumen                    | `≈` bajo el total, a la derecha; aviso de dos líneas                               | Igual                                                       | Igual, en una línea                       |
| Qué se apila                         | Todo en una columna; el aviso y el control comparten fila porque cabe (298 de 328) | —                                                           | —                                         |
| Qué **no** se oculta en ningún ancho | El aviso, el principal y la marca `≈`. Nunca                                       | —                                                           | —                                         |

Nada de este feature se oculta por ancho. La única cosa que desaparece en móvil
es lo que ya desaparecía (la ciudad, la palabra «Cuenta»).

---

## El destello

Es el riesgo visual del feature y hay que decirlo con números: entre el HTML que
llega —con **todos** los equivalentes visibles— y el estado reducido a uno, la
página **encoge**. Medido a 360 px con el catálogo real de 15 productos:

| Monedas declaradas | Documento con todos | Documento con uno | Lo que se movería   |
| ------------------ | ------------------- | ----------------- | ------------------- |
| 3                  | 3 229 px            | 3 011 px          | 218 px (7 %)        |
| 5                  | 3 485 px            | 3 011 px          | 474 px (14 %)       |
| 40                 | 7 069 px            | 3 011 px          | **4 058 px (57 %)** |

Un salto así **después** del primer pintado no es un parpadeo: es la rejilla
subiendo bajo el dedo del comprador mientras decide qué toca. Con dos monedas
—lo normal— serían 16 px por fila de tarjetas, apenas perceptible; con cuarenta
es media página.

De ahí las cuatro exigencias de diseño. **No dicen cómo.** Se escribieron sin
conocer el mecanismo y **el mecanismo que eligió el arquitecto las cumple las
cuatro**: AD4 pone el atributo en `<html>` desde un guion en línea de 324 bytes
que es primer hijo del `div` de la tienda —o sea que corre **antes de que exista
la primera tarjeta**, que es EX1—, y usa `:not()` en vez de «ocultar todo y
revelar el elegido» precisamente para no imponerle un `display` al elemento
visible, que es lo que esta maqueta necesita. Si el mecanismo cambiara, lo que
tiene que seguir en pie es esto:

- **EX1 — Sin dos estados.** Con JavaScript, el comprador **no llega a ver** el
  estado de N equivalentes. La reducción se decide **antes del primer pintado**
  de la rejilla, no después de hidratar.
- **EX2 — Cero reflow al hidratar.** Cuando el selector aparece en su hueco, no
  se mueve ni un píxel: la sub-barra mide 53 px y la primera tarjeta está a 721
  (360) y 637 (768/1280) antes y después. Es la invariante medida en
  § El selector y hay que conservarla.
- **EX3 — Si no llega a tiempo, no se reduce.** Si la decisión no puede tomarse
  antes del pintado —guion bloqueado por una política de contenido, error,
  cualquier cosa—, la página se queda **en el estado servido** (todos visibles)
  el resto de esa carga. Una reducción tardía está prohibida: ver todos los
  equivalentes es correcto y está previsto (criterio 2); verlos y que
  desaparezcan medio segundo después no lo está.
- **EX4 — Lo que el comprador hace sí puede mover la maqueta.** Cambiar de
  moneda en el selector es una acción suya y el movimiento es su respuesta:
  ahí sí se acepta el reflow (16 px por fila a 360 con una moneda de más), sin
  animación —`prefers-reduced-motion` ya está atendido en
  `src/app/globals.css` y aquí no hay nada que animar— y sin mover el foco, que
  se queda en el selector.

Y una restricción que el mecanismo tampoco puede saltarse, porque es de
accesibilidad y no de estética: **ocultar es `display: none` o el atributo
`hidden`, nunca solo visual** (R15, y verificado arriba en el árbol de
accesibilidad real).

---

## Lo que este diseño le exige al arquitecto

Cinco cosas, todas observables, ninguna con implementación impuesta. Las cinco
**ya están contestadas** por `.agent/specs/F-039/architecture.md`; se dejan
escritas porque son la exigencia, y la exigencia sobrevive a un cambio de
mecanismo.

1. **EX1..EX4** de arriba. → AD4 (guion antes del pintado, `:not()` para no
   tocar el `display` del visible).
2. El HTML servido lleva **todos** los equivalentes **visibles**, en el orden de
   la lista declarada, y ninguna clase ni atributo estático que oculte alguno
   (R13, criterio 2). → AD4, tercera pieza: el documento servido no lleva
   `data-ref-currency`, así que ninguna regla casa.
3. Cada equivalente tiene que ser **direccionable por su código de moneda** para
   que el cliente pueda revelar uno y ocultar los demás sin volver a formatear
   nada (R12: el cliente no convierte ni formatea importes del catálogo). →
   AD4: `data-equiv="<CÓDIGO>"`.
4. El selector necesita, del servidor, **el conjunto de monedas declaradas con
   equivalente calculable en esta tienda**, en el orden de la lista, más el
   código de la base. Nada de eso depende del visitante, así que R11 se
   mantiene. → AD5 trae la lista (la columna de la línea 139) y AD1 sabe
   calcular la parte difícil (`defaultEquivalentCurrency` ya elige **la**
   primera con tasa, que es SP1(a)).

   **Esto es lo único que DH5 le mueve al mecanismo**, y es un cambio de
   conjunto, no de forma: antes el selector listaba `equivalentCurrencies`
   —que a propósito **no** poda por tasa (R1)— y ahora lista ese mismo conjunto
   filtrado por «tiene tasa». Los dos usos siguen existiendo y no son el mismo:
   la lista sin podar es lo que el comerciante declaró y lo que el servidor
   intenta pintar; la podada es lo que se **ofrece**. Cómo se expone —una
   exportación más, un segundo argumento, o derivarlo en el llamante con
   `priceEquivalents` de cualquier importe de la página— es del arquitecto, que
   lo está revisando en paralelo junto con `data-ref-choices` de su AD4. Lo que
   el diseño pide es que el conjunto que el selector lista y el que el guion de
   arranque valida sean **el mismo**: si difieren, una preferencia guardada
   podría sobrevivir a la validación y luego no aparecer entre las opciones, que
   es el estado que DH5 vino a borrar.

5. **Un formateador `Intl` memoizado por moneda** (medido: 12,2 ms → 1,4 ms con
   40 monedas y 24 tarjetas). Es coste de servidor por render de ISR, no del
   comprador, pero es el único número de este feature que crece multiplicando.
   → AD6, con tope de 64 entradas y el `null` de la rama de respaldo memoizado
   también.

Y su § Restricciones para el diseñador, las cinco, comprobadas contra esta
maqueta: (1) el elemento con `data-equiv` contiene el `≈`, la palabra y el
importe — **nada** fuera; (2) los equivalentes son hermanos en un contenedor
`flex flex-wrap gap-x-2` que no cuenta a nadie; (3) el `display` del visible es
el que le da la maqueta; (4) en el HTML servido no hay nada oculto —y el
`sr-only` de esta maqueta envuelve **la palabra «aproximadamente», nunca un
equivalente**, que es la lectura correcta de esa restricción: el importe está
siempre visible—; (5) con lista vacía no aparece nada, tampoco el hueco del
selector, porque la sub-barra entera solo se emite cuando hay al menos un
equivalente.

---

## Componentes de UI

**Se reutiliza todo lo que existe.** `src/components/ui/Card.tsx` y
`src/components/ui/Container.tsx` sin tocar; `src/components/ui/Badge.tsx`,
`src/components/ui/Button.tsx` y `src/components/ui/Field.tsx` no entran (el
selector no es un campo de formulario de `Field`: no lleva rótulo visible ni
mensaje de error, y forzarlo ahí traería una maqueta que aquí no cabe).

**Lo que hay que crear son dos piezas**, y ninguna es un primitivo nuevo:

1. **El grupo de equivalentes** de un importe: recibe los `Money[]` que devuelve
   `priceEquivalents` (AD1) y los pinta con su `data-equiv`, su marca y su
   nombre accesible. Es de servidor, sin estado, y lo usan la tarjeta, la ficha
   y —con un solo elemento— el carrito y el checkout. Dónde vive lo decide el
   arquitecto (su tabla de § Componentes lo reparte junto a las piezas de
   src/features/currency/, por crear); lo que el diseño pide es que sea **uno**,
   para que las cuatro superficies no puedan discrepar en la marca igual que no
   pueden discrepar en el redondeo.
2. **La sub-barra de moneda de referencia**: el aviso servido por el layout, el
   hueco, el `<select>` y la frase de una línea que aparece al elegir. El
   `<select>` es la isla, que el arquitecto ya sitúa en
   src/features/currency/components/ReferenceCurrencySelect.tsx (por crear), y
   es la **única** pieza con `"use client"` de este feature. El aviso, en
   cambio, lo pinta el servidor en `src/app/[slug]/layout.tsx`: tiene que estar
   sin JavaScript, y no hay razón para pagarlo en el bundle.

Y una ranura nueva en un componente que ya existe: `OrderSummary`
(`src/features/cart/components/OrderSummary.tsx`) necesita una línea propia para
el equivalente del total, hermana de `partialNotice`, porque su `note` ya está
ocupada por el aviso y meter las dos cosas en la misma cadena juntaría un
importe con una frase.

`ProductCard` **sigue siendo un componente de servidor**. Es la prohibición de
AGENTS.md § Prohibiciones —nunca `"use client"` en algo que renderice catálogo—
y aquí no hace falta ni un gramo: el cliente revela, no pinta.

---

## Tokens y tema

Todo sale de `src/theme/tokens.css` a través de utilidades que resuelven por
`var()`, que es lo que comprueba `scripts/check-theme-tokens.mjs`. **Ningún
color, tamaño ni radio nuevo**: este feature no añade una línea a
`src/theme/tokens.css`.

| Pieza                          | Utilidades                                                                      | Token                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Importe principal              | sin cambios (`text-brand text-base font-semibold`)                              | `--color-brand`                                                  |
| Equivalente en la tarjeta      | `text-fg-muted text-xs font-normal`                                             | `--color-fg-muted`                                               |
| Equivalente en ficha y totales | `text-fg-muted text-sm`                                                         | `--color-fg-muted`                                               |
| Aviso de la sub-barra          | hereda `text-brand-contrast` de la cabecera, `text-sm`, **sin `opacity`**       | `--color-brand-contrast`                                         |
| Filete de la sub-barra         | `border-t border-brand-contrast/25`                                             | `--color-brand-contrast` (por `color-mix`, sigue en `var()`)     |
| Control                        | `bg-surface text-fg border border-border rounded-md h-11 w-40 text-sm`          | `--color-surface`, `--color-fg`, `--color-border`, `--radius-md` |
| Foco del control               | `focus-visible:outline-2 focus-visible:outline-offset-2 outline-brand-contrast` | `--color-brand-contrast`                                         |

**Cómo reacciona al branding por tienda.** La sub-barra vive dentro de
`bg-brand`, así que se rebrandea sola: `renderStoreTheme`
(`src/features/theming/storeTheme.ts`) redefine `--color-brand` y
`--color-brand-contrast` en el ámbito `[data-store="…"]`, que es más específico
que `:root`, y el filete y el aviso lo siguen. El control, en cambio, va a
propósito con `--color-surface`/`--color-fg`, que **no** son de los cuatro que
una tienda puede sobrescribir: pase lo que pase con la paleta de la tienda, la
lista de monedas se lee. El anillo de foco usa el par
`brand`/`brand-contrast`, que por definición contrastan entre sí en cualquier
branding —un `outline-brand` sobre la barra de marca sería invisible, y ese es
justo el error que este renglón evita—.

En **tema oscuro** no hay ninguna regla propia: los mismos tokens ya se
redefinen en `@media (prefers-color-scheme: dark)` y el equivalente gana
contraste (5,53 → 6,63). No hace falta una segunda decisión.

---

## Accesibilidad

**Los ocultos salen del árbol (R15).** Verificado, no prometido: con tres
equivalentes en el DOM y dos con `display: none`, el nombre accesible del enlace
de la tarjeta es «Arroz blanco 1 kg Arroz blanco 1 kg $620.00 aproximadamente
US$1.02» — el elegido entra, los otros dos no aparecen. Eso es C15. Si el
mecanismo cambiara a algo que solo oculta visualmente (`opacity`, `clip`,
`visibility` heredada, un `aria-hidden` suelto), el lector de pantalla anunciaría
tres o cuarenta precios por producto y el feature sería inutilizable con lector.
`display: none` o `hidden`, y no hay tercera opción.

**Nombre accesible de cada equivalente (R16).** El `≈` va `aria-hidden` y a su
lado va la palabra **«aproximadamente»** para el lector de pantalla. Un `≈`
suelto lo anuncian distinto cada lector y algunos lo callan; la palabra no se
presta a interpretación. Cuesta unos 70 bytes crudos por equivalente y ninguno
del importe, que no se duplica.

**Contraste, medido** (todos AA para texto normal, y los equivalentes están en
12 px, que no es texto grande): equivalente sobre la tarjeta **5,53** en claro y
**6,63** en oscuro; equivalente sobre el fondo de página 5,38 y 7,16; aviso de la
sub-barra sobre la marca **4,84** opaco —de ahí que vaya sin `opacity`: con
`opacity-90` cae a 4,22 y ya no pasa—; texto del control **17,30** y **15,31**.

**Foco y etiquetado del selector.** Orden de tabulación en la cabecera: nombre
de la tienda → Carrito → Cuenta → **selector** → contenido. Es el orden del DOM
y coincide con el visual. El control es un `<select>` con `<label>` asociado por
`for`/`id`, y ese rótulo es **`sr-only`**: su nombre accesible es «Moneda de
referencia», y visualmente no se pinta porque el texto de la opción
seleccionada («También en USD») ya dice qué hace y porque a 360 px no cabe un
rótulo más. Área de toque 160 × 44 px. Anillo de foco visible sobre la barra de
marca (`outline-brand-contrast`, dos píxeles, con dos de separación). Con
teclado no hay nada nuevo que aprender: es el `<select>` del sistema.

**Qué anuncia un lector de pantalla al cambiar de moneda.** Dos cosas y en este
orden: (1) el propio `<select>`, que anuncia la opción nueva como cualquier
selector del sistema; (2) una región `aria-live="polite"` **de una sola frase**
en la sub-barra, **vacía en el HTML servido y en el primer render de cliente**
—si trajera texto, un lector la anunciaría al cargar sin que nadie haya elegido
nada— y rellenada solo tras una elección: «Ahora también en USD.» o «Ahora solo
en CUP.».

Esa región es **`sr-only`**, y lo es por DH5. Cuando una moneda sin tasa podía
elegirse, la región tenía que ser visible porque era el único sitio donde el
cambio se notaba; ahora **toda** elección posible cambia importes en pantalla,
así que quien mira ya tiene su confirmación y repetirla en texto sería ruido.
Quien no mira sigue teniendo la frase.

Lo que **no** se hace, y es la decisión que importa: los precios de la rejilla
**no** van en una región `aria-live`. Cambiar de moneda toca 24 importes; una
región viva ahí dispararía veinticuatro anuncios y taparía el único que hace
falta. La frase única es la que informa; los precios se leen navegando, como
siempre.

**En carrito y checkout**, el anuncio del importe que ya existe se amplía en vez
de duplicarse: «Subtotal actualizado: $4,400.00, aproximadamente US$10.00.» Un
solo anuncio con los dos números, dentro de la región `aria-live` que ya está
ahí (`src/features/cart/components/CartView.tsx:297-312`).

---

## Coste de cliente

**Qué lleva `"use client"`, y por qué está permitido.** Una sola pieza: la
sub-barra de la cabecera. Tiene estado (la preferencia), evento (`change`) y
lectura de `localStorage`, así que no cae en «`"use client"` sin estado ni
eventos»; y **no renderiza catálogo**, que es la mitad prohibida de esa regla.
Es el mismo caso, en el mismo sitio y con la misma técnica que
`src/features/cart/components/CartBadge.tsx` y
`src/features/account/components/AccountBadge.tsx`, que ya viven en esa cabecera.

`ProductCard`, la ficha y la rejilla siguen enteras en el servidor. El
equivalente del carrito y del checkout se calcula en pantallas que **ya** son de
cliente (`CartView`, `CheckoutForm`), llamando a `convert`
(`src/lib/money.ts:141`), que es usar la función del checkout, no escribir una
segunda (R10/R12).

**Kilobytes, estimados y con el método a la vista.** Referencias reales: la
página más pesada medía **182,1 KB** gzip de JavaScript cuando F-010 subió el
presupuesto a **193** (`scripts/check-bundle-budget.mjs:22-26`).

| Qué añade este diseño                                                                                                                                                                                                        | Estimación gzip                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| La sub-barra: componente + almacén de la preferencia + adaptador de storage (del tamaño y la forma de `src/features/cart/components/CartBadge.tsx` más `src/features/cart/cartStorage.ts`, sin escucha del evento `storage`) | **+0,45 a 0,70 KB**             |
| `convert` arrastrado al árbol de cliente por carrito y checkout (una función de `src/lib/money.ts`, que ya está ahí)                                                                                                         | +0,10 a 0,20 KB                 |
| `ProductCard`, ficha, rejilla                                                                                                                                                                                                | **0**                           |
| **Total en la página de catálogo**                                                                                                                                                                                           | **≈ +0,6 a 0,9 KB** sobre 182,1 |

Con eso el presupuesto de 193 KB **no hay que tocarlo**. Pero la cifra que vale
es la medida: el criterio 10 exige `npm run check:bundle` antes y después y las
dos cifras escritas en `.agent/progress/F-039.md`, y si hubiera que subir
`BUDGET_KB` se sube con la medición en el comentario, nunca en silencio (R21 y
AGENTS.md § «El presupuesto de JavaScript no es un muro»).

**Un detalle de contabilidad que conviene saber antes de medir:** el guion en
línea con el que AD4 cumple EX1 es un `<script>` **sin `src`**, y
`scripts/check-bundle-budget.mjs` solo suma los `<script src>`. Sus 324 bytes no
aparecerán en la columna de JavaScript: aparecerán en la del **HTML**, junto con
los equivalentes. Anotar las dos columnas es lo que hace honesto el criterio 10,
y el arquitecto llegó a la misma conclusión por su lado.

**El HTML, que en esta app es el número que decide.** Aquí hay que quedarse con
la medición del arquitecto y no con la mía, y conviene saber por qué difieren.
La mía es la página real (`/tienda-demo`, 15 productos) con **los mismos**
importes de equivalente repetidos en todas las tarjetas: +0,22 KB gzip con uno,
+0,43 con tres, +1,80 con cuarenta. La suya son 24 tarjetas con importes
**distintos** en cada una: +0,26 con uno, +0,43 con dos, +0,60 con tres y
**+6,3 KB con cuarenta**. La diferencia del caso extremo es gzip comprimiendo
cadenas idénticas, que en un catálogo de verdad no lo son: **la cifra con la que
hay que planificar es la suya**, y su § Escalabilidad ya deja escrito el umbral
—si C10 mide más de ~2× el HTML de hoy, la conversación es el tope de SP2(b) y
es un feature nuevo del humano, no una poda de este ciclo—. En lo que las dos
mediciones coinciden es en lo que decide el diseño: con dos o tres monedas, que
es lo real, el HTML crece medio kilobyte. Más, una vez por página, el `<style>`
generado (205 bytes con dos monedas) y el guion (324).

**Qué queda utilizable sin JavaScript**, que es la otra mitad del criterio 10:
**todo lo que este feature aporta al catálogo**. Los importes principales y
**todos** los equivalentes, con su marca y su aviso, en las cinco pantallas de
catálogo y en la ficha. Lo único que no está es el selector, que sin JavaScript
no tendría nada que hacer, y por eso no se sirve (R13). El carrito y el checkout
siguen necesitando JavaScript exactamente como hoy, y lo siguen diciendo con las
mismas palabras.

---

## Textos

Todos en español (AGENTS.md § Idioma). `CUP`, `USD`, `EUR` son ejemplos: el
código de la base y de cada moneda es un dato.

**D1 — la marca de aproximado: `≈`, no `aprox.`** Visible:
`≈ US$1.41` (el `≈`, un espacio, y el importe de `formatMoney`). Elegida
midiendo: a 360 px `aprox.` parte en dos líneas **las quince** tarjetas y `≈`
solo cinco. Y hay una segunda razón, de lectura: `aprox.` es una abreviatura que
un lector de pantalla anuncia como «aprox», mientras que el `≈` se puede
esconder del árbol y poner la palabra completa detrás. Nada de «~», que es un
signo de teclado y no de matemáticas, ni de «≃»/«≅», que no están en todas las
fuentes.

**D2 — el nombre accesible del equivalente: «aproximadamente US$1.41».** El `≈`
va `aria-hidden` y la palabra va en un elemento `sr-only` delante del importe,
que no se duplica. Verificado en el árbol de accesibilidad real.

**D3 — la frase del cobro, una por pantalla: «Cobramos en CUP.»** Vive en la
sub-barra de la cabecera, en el HTML servido, así que la llevan **todas** las
pantallas de la tienda sin repetir la frase en cinco archivos. Tres decisiones
dentro de esta frase:

- **«Cobramos», en primera persona del plural.** Es la voz que ya usa la tienda
  («¿Vaciar el carrito?», «Todavía no agregaste nada.»). «El cobro se realiza en
  CUP» es la voz de un banco.
- **No dice nada de los equivalentes.** Deliberado: la sub-barra viene del
  layout y aparece también en `/[slug]/pedido/[code]`, donde no hay ningún
  equivalente (I6). Una frase que hablara de ellos sería falsa allí; «Cobramos
  en CUP.» es verdad en todas. Lo aproximado lo dice cada equivalente por su
  cuenta (D1/D2), que es donde R16 lo pide.
- **Usa el código, no el símbolo ni el nombre.** El código es lo que el POS
  declara, es lo que se ve en los equivalentes (`MLC 2.95`, `EUR 1.29`) y es lo
  único que existe para una moneda cualquiera: `formatMoney` pinta `$` para CUP
  y `US$` para USD por `Intl`, y no hay tabla de nombres que consultar (R6
  prohíbe apoyarse en `Currency`). Consecuencia asumida: en una tienda con base
  CUP el comprador ve `$620.00` arriba y «Cobramos en CUP.» abajo; van en la
  misma barra que el selector, que también habla en códigos, así que la
  correspondencia se lee sola.

**D4 — la etiqueta del selector: «Moneda de referencia».** `sr-only`. Es el
nombre que usa la propia spec y no promete nada que el control no haga: no
filtra, no cambia lo que se cobra, es una referencia. No se pinta porque la
opción seleccionada ya lo explica y porque a 360 px no cabe (medido: aviso 126 +
rótulo 145 + control 160 > 328).

**D5 — las opciones.**

| Opción                | Texto                                                     |
| --------------------- | --------------------------------------------------------- |
| Volver a solo la base | **«Solo CUP»**                                            |
| Cada moneda declarada | **«También en USD»**, «También en MLC», «También en EUR»… |

«Solo CUP» es la opción explícita que pidió DH4/SP1(a) y va **primera**.
«También en …» dice exactamente lo que pasa —se **añade** un equivalente, no se
cambia el precio— y funciona igual de bien como estado del control cerrado que
como opción de la lista, que es lo que permite ahorrarse el rótulo visible. Se
descartó «Ver también en …» (verbo de acción para describir un estado) y
«Equivalente en …» (palabra de contable).

**D6 — retirada por DH5, y no hay frase que la sustituya.** Este documento
proponía «Ahora no tenemos el cambio de EUR.» para explicar por qué elegir una
moneda declarada sin tasa no hacía nada. Con DH5 esa moneda **no se ofrece**
(§ El selector, punto 3), así que el estado que la frase explicaba no existe y
la frase sobra. El número se conserva vacío a propósito: D7, D8 y D9 se citan
desde otras secciones y renumerarlos rompería las referencias.

Consecuencia medida, y es a favor: la sub-barra **nunca** gana una segunda
frase, así que sus 53 px y su única línea a 360 px (aviso 126 px + `gap` 12 +
control 160 = 298 de los 328) valen en **todos** los estados, no solo en el
normal. Desaparece la única situación en la que la cabecera podía crecer sola.

**D7 — el anuncio al cambiar** (región `aria-live="polite"`, una frase, vacía al
cargar): «Ahora también en USD.» · «Ahora solo en CUP.» Son las dos únicas
elecciones posibles desde DH5, y las dos tienen efecto visible.

**D8 — el carrito.** El párrafo que ya existe bajo el subtotal se amplía cuando
hay equivalente:

> El envío se calcula en el siguiente paso. Cobramos en CUP; el equivalente es
> aproximado.

Y el anuncio de la región viva: «Subtotal actualizado: $4,400.00,
aproximadamente US$10.00.»

**D9 — el checkout** (por la ranura `note` de `OrderSummary`, cuando hay
equivalente):

> Cobramos en CUP; el equivalente es aproximado.

Aquí sí se nombra el equivalente, en singular, porque en esa pantalla hay
exactamente uno y la frase acompaña al importe agregado, que es lo que DH3 y R16
exigen literalmente.

**Lo que no cambia ni una letra:** «Consultar» y «Consultar precio», «Antes
…», «Subtotal», «Envío», «Total», «Total parcial», «más el envío por confirmar»,
«Calculando…», el aviso de `<noscript>` del carrito y todos los rótulos del
panel de filtros de F-027.

---

## Verificación visual

Qué mirar, en qué ancho y con qué datos. Los cinco primeros son de ojo y los tres
últimos de número; todos se pueden convertir en un paso de plan.

1. **Sin JavaScript, tres monedas.** `/tienda-demo` con
   `displayCurrencies = ["CUP","USD","MLC"]` (que es como el humo de F-038 dejó
   `seed-negocio-1`) y el JavaScript deshabilitado en el navegador, a 360, 768 y
   1280: cada tarjeta enseña el principal y **los dos** equivalentes, la
   sub-barra enseña el aviso, y **no hay ningún control**. Ni desplazamiento
   horizontal en ningún ancho.
2. **Con JavaScript, primera visita.** La misma URL con `localStorage` limpio:
   una sola línea de equivalente (USD, la primera declarada con tasa), el
   selector en «También en USD», y —esto es lo que hay que mirar de verdad— **no
   se ve pasar** el estado de dos equivalentes. Grabar la carga y revisarla
   fotograma a fotograma si hace falta: es EX1.
3. **El salto que no debe existir.** Comparar la posición de la primera tarjeta
   antes y después de hidratar: 721 px a 360 y 637 a 768 y 1280, las dos veces.
   Es EX2 y sale de una medición, así que se comprueba con una medición.
4. **Cambiar de moneda.** Elegir «También en MLC» y «Solo CUP»: cambian los 15
   importes de golpe, sin petición al servidor (mirar la pestaña de red), el foco
   se queda en el selector, y al recargar y al navegar a `/[slug]/catalogo`,
   `/[slug]/buscar` y una ficha sigue puesta (criterio 12).
5. **Los tres casos raros.** (a) Con `["CUP","USD","EUR"]` y sin tasa de EUR:
   el catálogo enseña el equivalente de USD en todas las tarjetas, **ninguna
   aparición de EUR como importe**, el principal presente, y —esto es lo nuevo
   de DH5— **EUR no está entre las opciones del selector**: se cuentan las
   opciones y son «Solo CUP» y «También en USD», dos. (b) Al aplicar un
   `EXCHANGE_RATE` de EUR, la primera visita posterior lo ofrece y pinta su
   equivalente, sin reiniciar nada y sin volver a elegir (es el guion de humo
   del criterio 8, con una comprobación más). (c) Con la lista vacía
   (`seed-negocio-2`, o `--business=empty` antes de medir, que es la
   precondición que anotó I3): la página tiene que ser **idéntica** a la de hoy,
   sin sub-barra — y lo mismo si declara monedas y **ninguna** tiene tasa.
6. **Con cuarenta monedas, a 360.** Que se pueda leer y desplazar: tarjeta de
   ~792 px, página de ~7 069, dos columnas alineadas, ninguna imagen deformada,
   cero desplazamiento horizontal. Es el peor caso de SP2(a) y hay que verlo una
   vez con los ojos.
7. **Tema oscuro y branding de tienda.** Las mismas cinco pantallas con
   `prefers-color-scheme: dark`, y con una tienda que sobrescriba
   `--color-brand`: el equivalente sigue legible (6,63) y el control sigue en
   `--color-surface`, no en el color de la tienda.
8. **Lector de pantalla.** Con USD elegido, el nombre accesible de una tarjeta
   contiene «$620.00» y «aproximadamente US$1.02» y **no** contiene el de MLC
   (C15). Al cambiar de moneda se oye **una** frase, no veinticuatro.

Lo medido en este ciclo se puede reproducir contra `next dev` en el 3200 de este
worktree; los números de § Qué se miró antes de diseñar son la línea base contra
la que comparar.

---

## Preguntas al humano

**Las cuatro están cerradas por el humano el 2026-09-08**, anotado por el
orquestador. Tres en la opción recomendada y **una con una cuarta opción que él
escribió y que no estaba en la lista** (DP3 → DH5). Se conservan enteras, con su
razonamiento y su respuesta, porque lo que hay que poder leer más adelante no es
qué se decidió, es **por qué**. No queda ninguna pregunta abierta: por eso este
documento cierra en `estado: listo`.

**DP3 — CERRADA con una opción nueva: DH5.** El humano no eligió ninguna de las
tres. Escribió: «si en la tienda tienen una moneda configurada sin tasa no se
debe mostrar», y confirmó el alcance: una moneda declarada sin tasa vigente
**no se ofrece en el selector**; desaparece de las opciones mientras no haya
tasa y vuelve sola cuando llegue su `EXCHANGE_RATE`. Descartadas: dejarla
listada e inerte (era mi (a) más una frase) y dejarla listada y deshabilitada.
Qué cambió en este documento, y es todo lo que cambió: § El selector punto 3
(el conjunto que se ofrece), § Inventario (fuera el estado «elegida sin tasa»,
dentro «llega su tasa» y «declara monedas pero ninguna con tasa»), § Textos D6
(retirada, sin sustituta), § Accesibilidad (la región viva pasa a `sr-only`
porque ya no hay nada que enseñar que no se vea en los precios), § Lo que este
diseño le exige al arquitecto punto 4 y § Verificación visual punto 5. **Ninguna
medición se movió**, y una desapareció a favor: la sub-barra ya no puede crecer
a dos líneas en ningún estado.

**DP1 — CERRADA en (a): se acepta.** La cabecera crece 53 px en toda la tienda,
incluidas las páginas que no pintan importes. Es el precio medido de DH2 y se
paga. El razonamiento con el que se decidió, tal como se le presentó:

**DP1 — la cabecera crece 53 px en toda la tienda.** De 68 a 121 px, y la
primera tarjeta baja a 721 px a 360 (hoy 668), en **todas** las páginas de una
tienda que declare monedas, incluidas las que no pintan importes
(`/[slug]/pedido/[code]`). Es el precio de DH2 («un selector en la cabecera»)
medido. Opciones: **(a)** aceptarlo —recomendada—; (b) que la sub-barra solo
aparezca en las páginas que pintan importes, lo que obliga al layout a saber qué
pinta cada página, y la spec ya llamó a eso «peor que el defecto» (I6);
(c) mover el selector al pie, que es donde nadie lo encuentra y contradice DH2.
**Recomendación: (a)**, y si el espacio molesta, la solución es una frase más
corta, no arquitectura.

**DP2 — CERRADA en (a): se acepta la repetición.** En carrito y checkout la
frase se dice dos veces, porque DH3 y R16 la piden junto al importe agregado y
la de la cabecera viene del layout. El razonamiento:

**DP2 — «Cobramos en CUP.» se dice dos veces en carrito y checkout.** Una en la
sub-barra (viene del layout) y otra junto al importe agregado, porque DH3 y R16
la piden **ahí** literalmente. Opciones: **(a)** aceptar la repetición
—recomendada: son doce píxeles de texto gris y la segunda está donde se decide
pagar—; (b) sacar la frase del layout y repetirla en las cinco pantallas de
catálogo más la ficha, con seis sitios donde puede divergir; (c) suprimir la de
la sub-barra en esas dos rutas, que es la opción (b) de DP1 disfrazada.
**Recomendación: (a)**.

**DP3 — «Ahora no tenemos el cambio de EUR.»: ¿es la palabra correcta?** (La
pregunta tal como se hizo; la respuesta fue DH5, arriba.) Es la frase que veía
quien elegía una moneda declarada sin tasa, y era la única de este diseño que
dependía de cómo se habla en Cuba y no de una medición. Opciones: **(a)** «Ahora
no tenemos el cambio de EUR.» —recomendada, es la palabra de la calle—;
(b) «EUR no tiene tasa en esta tienda.», exacta y de base de datos; (c) no decir
nada y dejar que elegir EUR no tenga efecto visible, que es lo que E6 permitía y
lo que parece una avería. Recomendé (a); el humano vio que las tres discutían
cómo explicar un control muerto en vez de quitarlo, y quitó el control.

**DP4 — CERRADA en (a): se acepta.** El sistema no borra nada por su cuenta; si
el comprador toca el selector en una tienda que no ofrece su moneda, se guarda
la elección nueva y se pierde la anterior. El razonamiento:

**DP4 — elegir «Solo CUP» en una tienda que no declara tu moneda pisa tu
preferencia.** R17 y E17 mandan **no borrar** la preferencia guardada cuando la
tienda no la declara, y así se hace: en la tienda B el comprador ve solo el
principal y en la A sigue viendo su EUR. Pero el selector de B tiene que mostrar
algo, y muestra «Solo CUP», que es lo que se está viendo; si el comprador lo
toca —aunque sea para volver a lo mismo—, esa elección se guarda y el EUR se
pierde. Opciones: **(a)** aceptarlo: el sistema no borra nada, el comprador
decide —recomendada—; (b) una opción extra tipo «(tu moneda: EUR, no disponible
aquí)» seleccionada, que explica el estado y añade una opción rara a la lista;
(c) dos claves de `localStorage`, una por tienda, que contradice R17 («una sola
clave, sin sufijo de tienda»). **Recomendación: (a)**.
