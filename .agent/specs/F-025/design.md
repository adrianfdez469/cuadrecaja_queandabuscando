---
feature: F-025
agente: sdd-designer
actualizado: 2026-08-31T14:26:24Z
estado: listo
---

> **Ciclo 0.** Escrito en paralelo con `sdd-architect`: este documento decide
> **qué se ve**; él decide cómo se construye (nombres de archivo, tipos,
> `prefetch`, y cómo dos `not-found.tsx` que no reciben `params` salen por el
> slug canónico). Donde aquí se nombra un archivo por crear, es una propuesta de
> la spec, no una imposición al arquitecto.
>
> **Lo que este ciclo cierra**, que `spec.md` § No decidido a propósito dejó
> abierto: el separador (§ Decisión 3), si el «atrás» es una fila propia o el
> penúltimo eslabón (§ Decisión 1), qué pasa en 360 px con cuatro eslabones
> (§ Decisión 2) y cómo se ve el rastro de un solo eslabón (§ Decisión 4).
>
> **La única pregunta al humano, DP1, está RESUELTA** por el humano el
> 2026-08-31, opción (b): la ficha de producto pierde el enlace de categoría
> que tenía encima del `<h1>` y la categoría pasa a verse **solo** en el rastro.
> Queda cerrada al final del documento, con las tres opciones a la vista, y
> propagada a § Decisión 2, § Inventario de pantallas y estados, § Estructura
> por breakpoint, § Componentes de UI y § Verificación visual (V11, sin
> renumerar V1–V10). Por eso este documento pasa a `estado: listo`.

## Qué se miró antes de diseñar

`AGENTS.md` entero: § Prohibiciones (la de `"use client"` en cualquier cosa que
renderice catálogo, que aquí es determinante), § El presupuesto de JavaScript no
es un muro, § Idioma y § Cosas que muerden —de esta última, la trampa del
archivo inexistente entre comillas invertidas y la de Prettier sobre la prosa del
arnés—. `.agent/specs/F-025/spec.md` completa (E1–E21, R1–R22, § Casos límite,
I1–I11, los 14 criterios `[ya]` y los siete `[nuevo]`, SP1–SP5) y
`.agent/progress/F-025.md` § Decisiones tomadas.

Los dos diseños con los que este rastro convive en la misma franja vertical:
`.agent/specs/F-026/design.md` (la fila de chips; su § Decisión 1 y su
§ Estructura por breakpoint fijan el reparto de esa zona, y este documento **no
lo contradice** — ver § Decisión 5) y `.agent/specs/F-021/design.md` (la caja de
búsqueda). También `.agent/specs/F-017/design.md` por `BranchBar`.

Del código: `src/app/[slug]/layout.tsx`, las diez pantallas de `src/app/[slug]/`
—`src/app/[slug]/page.tsx`, `src/app/[slug]/c/[categorySlug]/page.tsx`,
`src/app/[slug]/p/[productSlug]/page.tsx`, `src/app/[slug]/buscar/page.tsx`,
`src/app/[slug]/carrito/page.tsx`, `src/app/[slug]/checkout/page.tsx`,
`src/app/[slug]/pedido/[code]/page.tsx`, `src/app/[slug]/sucursales/page.tsx`—,
los dos `not-found.tsx` de segmento
(`src/app/[slug]/pedido/[code]/not-found.tsx`,
`src/app/[slug]/c/[categorySlug]/not-found.tsx`) y el global
`src/app/not-found.tsx`; `src/components/store/BranchBar.tsx`,
`src/components/store/StoreCategoryNav.tsx`,
`src/components/store/StoreSearchBox.tsx`,
`src/components/store/StoreClosedNotice.tsx`, `src/components/ui/Container.tsx`,
`src/components/ui/Button.tsx`, `src/features/cart/components/CartView.tsx`,
`src/features/catalog/storeCategories.ts`, `src/theme/tokens.css`,
`src/app/globals.css` y `scripts/check-theme-tokens.mjs`.

### Se miró la pantalla de verdad, y con números

`next dev` **de este checkout**, en el puerto 3100 —el 3000 estaba libre, pero la
ficha `.agent/playbook/next-dev-uno-por-directorio.md` pide comprobar el
directorio del proceso antes de creerse nada, y se comprobó con `lsof`:
`cwd = /Users/adrian/orca/workspaces/queandabuscando/logperch`—. Todo lo de abajo
está medido contra ese servidor con Playwright, el que ya usa el arnés, a 360,
768 y 1280, en claro y en oscuro, y en las dos paletas del seed (`tienda-demo`
azul por defecto y `tienda-dos` con `brand: oklch(0.62 0.17 145)` y
`radius: "round"`).

**El caso de cuatro eslabones no hizo falta agrupar nada para verlo.** La base de
desarrollo ya tiene una marca con dos sucursales renderizables, `el-trebol`
(«El Trébol», con `el-trebol-centro` PUBLISHED y `el-trebol-playa` SUSPENDED), y
`/el-trebol` sirve el selector y `/el-trebol-centro` una sucursal **con
`BranchBar`**. Es la misma jerarquía que monta `.agent/specs/F-017/smoke.sh` con
`bodega-uno`/`bodega-dos`, sin agrupar nada (agrupar no tiene vuelta atrás).

Geometría de **hoy** a 360 px, medida (`top` en píxeles desde el borde superior
del viewport):

| Pantalla                       | Cabecera | `BranchBar` | Caja de búsqueda | `<h1>` | Chips | Rejilla / imagen |
| ------------------------------ | -------- | ----------- | ---------------- | ------ | ----- | ---------------- |
| `/tienda-demo`                 | 0 (68)   | —           | 100              | 176    | 288   | 372              |
| `/tienda-demo/c/bebidas`       | 0 (68)   | —           | 100              | 176    | 264   | 348              |
| `/tienda-demo/p/…`             | 0 (68)   | —           | 92               | 556    | —     | 136 (imagen)     |
| `/tienda-demo/carrito`         | 0 (68)   | —           | —                | 100    | —     | —                |
| `/el-trebol-centro`            | 0 (68)   | 68 (92)     | 192              | 268    | —     | —                |
| `/tienda-demo/p/no-existe`     | —        | —           | —                | 276    | —     | —                |
| `/el-trebol` (selector)        | 0 (68)   | —           | —                | 100    | —     | —                |
| `/el-trebol-centro/sucursales` | 0 (68)   | —           | —                | 128    | —     | —                |

Dos cosas que esa tabla enseña y que el diseño usa:

1. **`/tienda-demo/p/no-existe` no tiene cabecera.** Es I6/E15 medido: hoy cae en
   `src/app/not-found.tsx` y pierde el marco de la tienda entero.
2. **`BranchBar` cuesta 92 px a 360 px**, no 44: a móvil se apila
   (`flex-col`, `py-3`, y el enlace con `min-h-11`). El rastro tiene que caber
   **debajo** de eso sin empujar la rejilla fuera de la pantalla.

Anchos reales de etiqueta a `text-sm` (medidos en la página real, no estimados):
`La Rampa · Vedado` 129 px, `La Rampa · Marianao` 140 px, `La Rampa · Playa`
114 px, `El Trébol` 58 px, `El Trébol · Centro Habana` 169 px, `Bebidas` 54 px,
`Panadería` 67 px, `Carrito` 45 px, `Pagar` 39 px, `Cambiar de sucursal` 120 px,
`Jugo de mango 1 L` 125 px, `Refresco de cola 1.5 L` 145 px, `Buscar «jugo»`
95 px. Separador `›` con `px-1.5`: 17 px. A 360 px, `Container` deja **328 px
útiles**.

---

## Decisión 1 — el «atrás» es el penúltimo eslabón, no una fila propia

**Una sola fila. Un solo control. El «atrás» es el penúltimo eslabón del rastro,
y se distingue porque es el único elemento de la fila con contraste pleno, peso
medio y subrayado permanente.** No hay una segunda fila con «← Volver a X», y no
hay ningún botón de vuelta al pie.

Esto es lo que el humano pidió —«un botón para viajar a atrás siempre» **y** «un
breadcrumb»— resuelto como R2 lo define: **la misma cosa**. Lo que este documento
añade es que también se **ve** como una sola cosa.

**Se probó la alternativa en el navegador y tiene un precio medido.** La variante
«fila propia» —`← {Categoría}` arriba y el rastro debajo— se prototipó sobre la
página real:

| Variante                                             | Alto a 360 px | Por qué no                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Una fila (esta)**                                  | **44 px**     | —                                                                                                                                                                                                                               |
| Fila de «atrás» + rastro en `text-xs`, sin toque     | 64 px medido  | El rastro pequeño deja los eslabones en ~16 px de alto: **incumple R17**, que pide 44 px de área táctil en cada eslabón enlazable                                                                                               |
| Fila de «atrás» + rastro con R17 cumplido            | **88 px**     | Dos filas de 44. En un teléfono de 740 px de alto son **12 % del viewport** en cromo de navegación, repetido en las diez pantallas, y la rejilla del catálogo ya arranca hoy en y=372 (medido arriba)                           |
| «Atrás» al pie de la pantalla (mejor para el pulgar) | —             | Es un **segundo control de vuelta** en la misma pantalla: R14. Y en la ficha de producto competiría con `Agregar al carrito`, que es la acción que esa pantalla existe para ofrecer                                             |
| Flecha `←` delante del eslabón de vuelta             | 44 px         | Se probó y se descartó **mirándolo**: con dos eslabones (`← La Rampa · Vedado › Carrito`) lee perfecto, pero con cuatro la flecha cae **en medio de la cadena** (`El Tr… › El Trébol · Centro … › ← Panade… › Ref…`) y confunde |
| Chevron SVG en vez de `←`                            | 44 px         | Lo mismo, y además pone un `‹` a 17 px de un `›`: dos ángulos opuestos seguidos en una fila que ya usa ángulos como separador                                                                                                   |

**El pulgar, dicho sin adornos.** El rastro vive arriba del todo, que es la peor
zona de un teléfono para un control que se usa a menudo. Se acepta, y la razón es
que la alternativa que ayuda al pulgar —un control al pie— es exactamente el
segundo control de vuelta que R14 prohíbe, y duplicaría el destino en el árbol de
accesibilidad (dos enlaces, mismo nombre, misma URL). Lo que sí se hace para
compensar: el eslabón de vuelta es un objetivo de **44 px de alto** y, en 360 px,
es el eslabón que **más ancho recibe** (§ Decisión 2), así que es el más fácil de
acertar de toda la fila.

**Cómo se distingue, y no es solo color.** Tres señales a la vez sobre el
penúltimo eslabón, y la de en medio es la que hace el trabajo:

1. `text-fg` frente al `text-fg-muted` de todos los demás (16.82 : 1 contra
   5.38 : 1 sobre `bg`, medido).
2. **Subrayado permanente** (`underline underline-offset-4`). Es el único
   elemento subrayado de la fila en reposo. Una diferencia de **forma**, no de
   tono: se ve igual en escala de grises y en las dos paletas.
3. `font-medium` frente a `font-normal`.

Y el eslabón actual —el último— es **texto muted sin subrayar**: el único de la
fila que no se puede pulsar es también el único que no parece pulsable.

---

## Decisión 2 — cuatro eslabones en 360 px: una fila, recorte por prioridad, cero desplazamiento

**El rastro es siempre una sola línea de 44 px. No envuelve, no se desplaza
horizontalmente, no colapsa ningún eslabón (R12) y no provoca desplazamiento
horizontal de la página (E17). Cada eslabón se recorta con puntos suspensivos por
CSS, y el ancho se reparte por prioridad.**

**Lo que se descartó, con el motivo:**

| Forma                                     | Por qué no                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desplazamiento horizontal solo del rastro | Deja **el eslabón de vuelta y el actual fuera de pantalla**, a la derecha: el comprador ve la marca —lo que menos le sirve— y tiene que deslizar para llegar al único control de la fila. Y llevar la fila hasta el final sin JavaScript exige el truco de `dir="rtl"`, que en una UI española con `«»` es un riesgo de renderizado que no compensa |
| Envolver a dos o tres líneas              | R17 obliga a 44 px por eslabón enlazable, así que dos líneas son 88 px y tres son 132. Es el mismo coste que la fila propia de § Decisión 1, sin su ventaja                                                                                                                                                                                         |
| Esconder la marca por CSS a 360 px        | R12, literal: «en pantallas estrechas se recorta cada eslabón, **no se esconde ninguno**»                                                                                                                                                                                                                                                           |
| Recortar todos por igual                  | Se midió: con cuatro nombres largos deja **cuatro etiquetas de 8 caracteres**. Un rastro así es decoración, no navegación                                                                                                                                                                                                                           |

**El reparto, y es una regla, no una impresión.** Cuando el ancho no alcanza, los
eslabones ceden en este orden:

1. **Primero el eslabón actual.** Es el único que no es enlace, y en **siete** de
   las diez pantallas el `<h1>` de la propia página dice lo mismo dos líneas más
   abajo: `Bebidas`, el nombre del producto, `Buscar en la tienda`,
   `Resultados para «…»`, `Tu carrito`, `Confirmar pedido` y
   `Cambiar de sucursal`. En `/[slug]/pedido/[code]` no hay `<h1>`, pero el
   código se pinta justo debajo a `text-3xl` bajo el rótulo `Tu código`
   (`src/app/[slug]/pedido/[code]/page.tsx`). Y en las **dos pantallas raíz**
   —`/[slug]` en modo sucursal de una sola sucursal y en modo selector— el
   eslabón actual es el único de la fila: no compite con nadie y no se recorta
   nunca.
2. **Después los antepasados** (marca, y sucursal cuando no es la vuelta).
3. **El eslabón de vuelta, nunca**, salvo que se pase de su tope.

**DP1 refuerza el punto 3 y no mueve ni un número de esta sección.** Desde que
la ficha de producto pierde el enlace de categoría de encima del `<h1>`
(§ Preguntas al humano, DP1), el eslabón de vuelta es **el único sitio de la
ficha donde se ve el nombre de la categoría**: si se recortara, ese dato
desaparecería de la pantalla. El reparto ya lo protegía por otra razón, así que
la regla no cambia; ahora hay dos motivos en vez de uno. Los anchos medidos de
las tablas de abajo tampoco cambian: son de la fila del rastro, y la línea que
se quita vive **debajo** de ella.

En utilidades, sobre el `<li>` de cada eslabón:

| Eslabón       | Encoge          | Suelo      | Tope                                                                  |
| ------------- | --------------- | ---------- | --------------------------------------------------------------------- |
| Antepasados   | `shrink` (1)    | `min-w-12` | —                                                                     |
| **De vuelta** | **`shrink-0`**  | `min-w-12` | `max-w-[calc(100%-3rem)]` · `…-6rem]` · `…-9rem]` según haya 2, 3 o 4 |
| Actual        | `shrink-[9999]` | `min-w-12` | —                                                                     |

**El tope no es un número mágico: es la fórmula `100% − 3rem × (n−1)`** — lo que
queda cuando todos los demás eslabones ya tienen su suelo de `3rem`. Con eso, la
suma de mínimos es exactamente el 100 % del ancho disponible y **el rastro no
puede desbordar nunca**, con los nombres que traiga el POS. Se comprobó midiendo
`document.documentElement.scrollWidth` en las catorce escenas, a 360, 768 y 1280,
en claro y oscuro: **siempre igual al viewport**, incluido el caso patológico. La
tabla de topes es un `Record<number, string>` literal (2, 3 y 4 son los únicos
tamaños que produce la tabla de rutas de la spec); Tailwind necesita la clase
escrita entera en el código, no compuesta en tiempo de ejecución.

**Qué se ve, medido, con los datos reales del seed a 360 px** (ancho de cada
etiqueta; «entero» significa que no aparecen puntos suspensivos):

| Escena                                              | Eslabones                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `/tienda-demo/carrito`                              | `La Rampa · Vedado` 129 entero · `Carrito` 45 entero                   |
| `/tienda-demo/checkout`                             | 128 entero · `Carrito` 46 entero · `Pagar` 39 entero                   |
| `/tienda-demo/c/bebidas`                            | 129 entero · `Bebidas` 53 entero                                       |
| `/tienda-demo/p/jugo-de-mango-1-l`                  | 128 entero · **`Bebidas` 54 entero** · `Jugo de mango 1 L` 120 recorte |
| `/el-trebol-centro`                                 | `El Trébol` 58 entero · `El Trébol · Centro Habana` 169 entero         |
| `/el-trebol-centro/sucursales`                      | 58 entero · **169 entero** · `Cambiar de sucursal` 73 recorte          |
| Ficha con 4, nombres normales                       | 48 recorte · 138 recorte · **`Panadería` 67 entero** · 35 recorte      |
| Ficha con 4, nombres patológicos (36–90 caracteres) | 48 · 35 · **171** · 35, todos con puntos suspensivos, **sin desborde** |

Léase la columna en negrita: **en las ocho escenas el eslabón de vuelta llega
entero o es el que más ancho recibe.** Eso es exactamente lo que la prioridad
compra.

**El texto completo sigue en el DOM** (E17): el recorte es
`overflow: hidden` + `text-overflow: ellipsis` sobre el `<span>` interior
(`truncate`), no un `slice()` en el servidor. El lector de pantalla lee el nombre
entero, y `Ctrl+F` lo encuentra.

**A partir de `sm:` no hay nada que repartir**: a 768 px caben los cuatro
eslabones con nombres reales sin un solo recorte (58 + 169 + 67 + 145 + tres
separadores = 490 px de los 720 útiles), y a 1280 sobran 600 px. Las mismas
clases sirven en los tres anchos: el tope `calc()` y los suelos solo actúan
cuando hacen falta.

---

## Decisión 3 — el separador es un `›` en el DOM, marcado como decorativo

`<span aria-hidden="true">›</span>`, hermano del enlace dentro del mismo `<li>`,
con `px-1.5` y `text-fg-muted`. **No** un pseudo-elemento CSS. Tres razones, la
primera es la que decide:

1. **Un `::before` con `content` no es silencioso.** Chromium expone el contenido
   generado en el árbol de accesibilidad y los lectores de pantalla lo anuncian.
   R15 exige que el separador no se lea, y `aria-hidden="true"` es la única forma
   de garantizarlo. Es la misma técnica con la que `BranchBar` y `ProductCard`
   ya esconden lo decorativo.
2. **El pseudo-elemento se comería el recorte.** Si el `›` viviera dentro de la
   caja que lleva `truncate`, los puntos suspensivos podrían comérselo y el
   separador desaparecería justo en el caso estrecho, que es cuando más hace
   falta para entender la jerarquía. Como hermano con `shrink-0`, nunca se
   recorta.
3. Si el CSS no llega a cargar, un `›` en el HTML sigue separando las etiquetas;
   un `::before` deja `El TrébolBebidasJugo de mango`.

**Por qué `›` y no otro.** `/` se confunde con una URL. `»` es el mismo signo con
el que R11 envuelve el término de búsqueda (`Buscar «café»`) y repetirlo en dos
papeles distintos en la misma línea es cómo se pierde el vocabulario. `·` ya lo
usan los nombres de sucursal del seed («La Rampa · Vedado», «El Trébol · Centro
Habana»), así que usarlo de separador haría ilegible la jerarquía. `→` pesa
demasiado tinta. Queda `›`, que además es el que ya usa la prosa de
`.agent/specs/F-025/spec.md` para dibujar el rastro.

---

## Decisión 4 — el rastro de un solo eslabón se dibuja, en voz baja

E1, E12 y el criterio 12: en `/tienda-demo` (marca de una sola sucursal) y en
`/{brandSlug}` en modo selector el rastro tiene **un eslabón, sin enlaces y sin
«atrás»**. Se dibuja. El riesgo, que es real, es que parezca un error: la
cabecera del `layout` ya pinta ese mismo nombre en `text-xl font-semibold` sobre
`bg-brand`, así que el eslabón único es **texto duplicado**.

Se miraron las dos formas en la pantalla real y se elige la segunda:

| Forma del eslabón único          | Cómo se lee                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `text-fg font-medium`            | Como un **segundo título** debajo del título. Es la que parece un error de maquetación                          |
| **`text-fg-muted`, peso normal** | Como una **línea de ubicación**, en el mismo registro visual que el eslabón actual de las otras nueve pantallas |

La regla que sale de ahí es más simple que la excepción que evita: **el eslabón
actual es siempre `text-fg-muted`, esté solo o acompañado.** No hay un caso
especial para `n = 1`; hay una sola manera de pintar el eslabón actual.

Lo que hace que no parezca un error es la **constancia**: la fila está en el
mismo sitio, con la misma altura y el mismo estilo en las diez pantallas, así que
verla con un solo elemento se lee como «estás en el techo de esta tienda» y no
como «aquí falta algo». Y la altura fija (44 px con enlaces o sin ellos, porque
el `min-h-11` está en el `<ol>`) evita que la caja de búsqueda y el `<h1>` salten
de sitio al navegar de `/tienda-demo` a `/tienda-demo/carrito`: medido, el rastro
arranca en **y = 84 px** en las tres pantallas que se instrumentaron.

---

## Decisión 5 — el rastro es texto; los chips siguen siendo píldoras

F-026 puso en `/[slug]` y en `/[slug]/c/[categorySlug]` una fila de **píldoras**
(`rounded-md`, borde, `bg-surface-muted`, y la activa `bg-brand`), 52 px de alto,
justo debajo del `<h1>`. El rastro entra **por encima de todo eso** (R10) y
comparte pantalla con ella.

**El reparto de lenguaje visual es explícito y este documento lo fija:** el
rastro es **texto plano** —sin fondo, sin borde, sin `rounded-*`, sin sombra— y
el selector de categorías son **píldoras**. Dos filas de píldoras apiladas
serían indistinguibles; una fila de texto y una de píldoras se leen como dos
cosas distintas a primera vista. Se comprobó en captura sobre
`/tienda-demo/c/bebidas`.

**No se contradice nada de `.agent/specs/F-026/design.md`:** su reparto vertical
—caja de búsqueda → `<h1>` → conteo → chips → rejilla— se conserva entero y en el
mismo orden, con las mismas clases; la fila de chips no cambia de sitio respecto
a lo que tiene encima y debajo. Lo único que cambia es que **todo el bloque baja
44 px**, que es el coste del rastro. Medido a 360 px en
`/tienda-demo/c/bebidas`: chips de y=264 a y=308, rejilla de y=348 a y=392.

Que el chip «Todo el catálogo» y el eslabón de vuelta del rastro apunten al mismo
sitio en la vista de categoría **no es un segundo control de vuelta**: R21 ya lo
zanjó (uno es un selector, el otro la ubicación) y los dos `<nav>` tienen
`aria-label` distinto, `Ruta` y `Categorías`.

---

## Flujo de usuario

En una frase: **el comprador entra por un QR a cualquier pantalla de la tienda,
con el historial vacío, y encima del título encuentra siempre la misma línea que
le dice dónde está y le ofrece subir un escalón —o cualquiera de los de arriba—
sin depender del botón «atrás» del navegador.**

```
QR / enlace directo  (historial vacío)
   ▼
cualquier pantalla de /[slug]/**
   │
   │  <nav aria-label="Ruta">  ← siempre, encima del <h1>, en las diez
   │
   ├─ eslabón de vuelta (penúltimo, subrayado)  → un escalón arriba
   ├─ cualquier eslabón anterior                → directo a ese nivel
   └─ eslabón actual                            → no es enlace (E16)

Escalones, por pantalla:
  {Marca}  →  /{brandSlug}          (solo si branchCount > 1, R4; SP3: el selector)
  {Sucursal} → /{canonicalSlug}     (el catálogo completo)
  {Categoría} → /{canonicalSlug}/c/{categorySlug}   (SP4)
  {Producto} · Carrito · Pagar · Buscar «…» · Pedido X · Cambiar de sucursal
```

**Vueltas atrás y qué se pierde.**

| Desde → hacia                                | Qué se conserva                                             | Qué se pierde                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ficha → categoría (SP5)                      | El carrito. La categoría entera, porque está en la URL      | Nada                                                                                                                                                                 |
| Ficha sin categoría → catálogo (R19)         | El carrito                                                  | Nada                                                                                                                                                                 |
| Ficha a la que se llegó buscando → categoría | El carrito                                                  | **Los resultados de la búsqueda.** SP2, decidido: el rastro es función de la URL, no del camino. La caja de búsqueda sigue en la ficha y en el destino               |
| Checkout → carrito                           | El carrito entero                                           | **Lo escrito en el formulario de contacto.** `CheckoutForm` solo guarda la clave de idempotencia; avisar antes de salir exige JavaScript (§ Casos límite de la spec) |
| Carrito → catálogo                           | El carrito, intacto                                         | Nada                                                                                                                                                                 |
| Pedido → catálogo                            | El pedido, que ya está hecho y vive en su URL con su código | Nada. **No** se vuelve al checkout: E10                                                                                                                              |
| Sucursal → marca (selector)                  | El carrito de esa sucursal, que es suyo                     | Nada: cada sucursal guarda el suyo (HS5)                                                                                                                             |
| Cualquiera, entrando por un alias            | **Todo**, y la URL pasa a hablar en canónico (R3, E5)       | Nada                                                                                                                                                                 |

**No hay punto de no retorno.** El rastro es de solo lectura: no escribe, no
consulta y no toca el carrito.

---

## Inventario de pantallas y estados

La fila es **el mismo componente** en las diez, montado por cada página (R9,
I1). En la tabla, `{M}` solo aparece si `branchCount > 1` (R4) y **el eslabón en
negrita es el de vuelta**.

### Las diez pantallas

| #   | Pantalla                    | Rastro                                          | «Atrás» apunta a               |
| --- | --------------------------- | ----------------------------------------------- | ------------------------------ |
| 1   | `/[slug]` sucursal          | `{M}` › **{S}** · o solo `{S}` con una sucursal | `/{brandSlug}` · o **ninguno** |
| 2   | `/[slug]` selector de marca | `{M}`                                           | **Ninguno** (E12, SP1)         |
| 3   | `/[slug]/c/[categorySlug]`  | `{M}` › **{S}** › `{Categoría}`                 | `/{canonicalSlug}`             |
| 4   | `/[slug]/p/[productSlug]`   | `{M}` › `{S}` › **{Categoría}** › `{Producto}`  | `/…/c/{categorySlug}` (SP5)    |
| 5   | `/[slug]/buscar?q=…`        | `{M}` › **{S}** › `Buscar «{término}»`          | `/{canonicalSlug}`             |
| 6   | `/[slug]/buscar` sin `q`    | `{M}` › **{S}** › `Buscar`                      | `/{canonicalSlug}`             |
| 7   | `/[slug]/carrito`           | `{M}` › **{S}** › `Carrito`                     | `/{canonicalSlug}`             |
| 8   | `/[slug]/checkout`          | `{M}` › `{S}` › **Carrito** › `Pagar`           | `/{canonicalSlug}/carrito`     |
| 9   | `/[slug]/pedido/[code]`     | `{M}` › **{S}** › `Pedido {código}`             | `/{canonicalSlug}` (E10)       |
| 10  | `/[slug]/sucursales`        | `{M}` › **{S}** › `Cambiar de sucursal`         | `/{canonicalSlug}`             |

**En la fila 4, el eslabón de categoría es —desde DP1— el único sitio de la
ficha donde aparece la categoría.** `src/app/[slug]/p/[productSlug]/page.tsx`
deja de pintar el enlace de categoría que tenía encima del `<h1>`, el que puso
F-026 al resolver su DP2: mismo nombre, mismo `href` y mismo destino que el
eslabón de vuelta, a 60 px de distancia. Lo que **no** se toca es ningún chip
del catálogo: `src/components/store/StoreCategoryNav.tsx` sigue igual en
`/[slug]` y en `/[slug]/c/[categorySlug]` (§ Decisión 5), y
`src/components/store/BranchBar.tsx` tampoco se rediseña.

### Los estados de cada una

| Estado                                              | Qué se ve                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal**                                          | La fila de arriba, primer hijo del `Container` de contenido de la página, encima de todo lo demás                                                                                                                                                                    |
| **Un solo eslabón** (1 y 2 con una sucursal)        | La fila igual, con el nombre en `text-fg-muted` y `aria-current="page"`, **sin ningún `<a>` dentro** (criterio 12). Ver § Decisión 4                                                                                                                                 |
| **Producto sin categoría** (E19, R19)               | `{M}` › **{S}** › `{Producto}`: el eslabón de categoría no se pone y la vuelta es el catálogo. **Nunca** un eslabón «Sin categoría» ni un hueco. Desde DP1, encima del `<h1>` no hay nada **tenga categoría o no**: la ficha se ve igual por arriba en los dos casos |
| **Tienda cerrada, pantallas 5–10** (E13, R6)        | Rastro **idéntico** al de una tienda abierta. El aviso lo da `StoreClosedNotice`, no la navegación                                                                                                                                                                   |
| **Tienda cerrada, pantallas 3 y 4** (E20, R20, I9)  | El rastro **se detiene en la sucursal**: `{M}` › `{S}` con `{S}` como actual, sin `href`. La página no leyó el catálogo, así que no hay nombre de producto ni de categoría que poner, y el `categorySlug` de la URL no es una etiqueta que el comerciante escribiera |
| **Carrito vacío**                                   | El rastro no cambia: se pinta en el servidor y no sabe nada del `localStorage`                                                                                                                                                                                       |
| **Búsqueda sin resultados / página fuera de rango** | El rastro no cambia: `Buscar «{término}»` con el término ya normalizado y truncado a `SEARCH_TERM_MAX_LENGTH`, nunca el crudo de la URL                                                                                                                              |
| **Catálogo sin productos**                          | El rastro no cambia. El mensaje de vacío que ya existe, intacto                                                                                                                                                                                                      |
| **Cargando**                                        | Nada que diseñar y **sin `loading.tsx`**: el rastro está en el primer byte del HTML, antes que cualquier imagen                                                                                                                                                      |
| **Error** (`src/app/error.tsx`)                     | **Sin rastro, y es correcto**: ese componente no conoce la tienda. Además es de cliente por obligación de Next, así que ni siquiera podría montarse aquí sin romper R8                                                                                               |
| **Sin permiso**                                     | No existe: el comprador es anónimo (`docs/adr/0016-escritura-publica-sin-sesion.md`)                                                                                                                                                                                 |
| **Alias vivo** (`/bodega-central-vedado/…`)         | 200 sin redirección, y **todos** los `href` del rastro en `bodega-central`. Visualmente idéntico a entrar por el canónico                                                                                                                                            |
| **Marca y sucursal con nombres casi iguales**       | Los dos eslabones, sin deduplicar. Se ve `El Trébol › El Trébol · Centro Habana`, que es la verdad: son dos URL distintas                                                                                                                                            |

### Las tres pantallas de 404 — no llevan rastro, llevan una salida

`not-found.tsx` no recibe `params` en Next, así que **no puede construir un
rastro** (no sabe el slug, ni la marca, ni el número de sucursales). No se
inventa uno. Lo que llevan es **un solo enlace de salida**, centrado, con el
marco de la tienda alrededor.

| Archivo                                         | Qué cambia                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| src/app/[slug]/not-found.tsx (por crear)        | **Nuevo** (E15, criterio 9): hoy `/tienda-demo/p/no-existe` cae en `src/app/not-found.tsx` y pierde cabecera, tema y `data-store` |
| `src/app/[slug]/c/[categorySlug]/not-found.tsx` | Mismo texto y misma maqueta; solo cambia **a dónde** sale: slug canónico en vez de `href=".."` (E21, I10)                         |
| `src/app/[slug]/pedido/[code]/not-found.tsx`    | Igual (I3)                                                                                                                        |

Maqueta de las tres, calcada de las dos que ya existen: `Container` con
`flex flex-1 flex-col items-center justify-center py-24 text-center`, un `<h1>`
`text-2xl font-semibold`, una explicación en `text-fg-muted mt-3 max-w-md` y el
enlace a `mt-8`.

**El enlace de salida se dibuja como el `Ver todo el catálogo` de
`src/app/[slug]/buscar/page.tsx`** —fondo `bg-surface-muted`, `text-fg`,
`border-border`, `min-h-11 px-4 rounded-md`— y **no** como el `text-brand`
subrayado que usan hoy los dos `not-found`. Motivo medido: `text-brand` sobre
`bg` da **3.32 : 1** en `tienda-dos`, por debajo del 4.5 : 1 que AA pide a texto
de 14–16 px; la pareja `text-fg`/`bg-surface-muted` da **15.84 : 1**. Es el
agujero heredado que F-010 y F-021 ya anotaron; este feature **no añade una
instancia nueva** y, como E21 obliga a tocar los dos archivos existentes de todos
modos, los alinea a los tres. Las clases se declaran **locales al componente**:
`SECONDARY_LINK_CLASSES` vive dentro de una página (deuda conocida de F-021) y
este feature no la arrastra ni la refactoriza.

> **Nota de cierre de ciclo (2026-08-31).** Los tres párrafos de arriba se
> escribieron en paralelo con `sdd-architect`, y él resolvió la salida de otra
> manera: la canónica la pone `src/app/[slug]/layout.tsx` con el enlace del
> nombre de la tienda que ya pinta, y **los tres `not-found.tsx` se quedan sin
> enlace propio** (`.agent/specs/F-025/architecture.md` § Los dos
> `not-found.tsx` sin `params`, en `estado: listo`, y paso 6 de
> `.agent/specs/F-025/plan.md`, ya firmado). Manda eso. De esta sección
> sobreviven la maqueta y los textos —el `<h1>` y la explicación de cada 404, y
> que ninguno lleve rastro—; **cae el enlace de salida dentro del cuerpo**, y con
> él la columna «Enlace» de la tabla de § Textos y la fila «Salida del 404» de la
> tabla de contraste, que quedan como lo que se midió y no como lo que se va a
> construir. Consecuencia práctica, y está escrita en V9: el enlace que se pulsa
> para salir de un 404 es el de la cabecera.
>
> El hueco que el arquitecto dejó a este agente —un 404 dentro de una tienda
> **cerrada** se queda sin salida, y son dos URL concretas— se acepta tal cual:
> darle un enlace a la cabecera de una tienda cerrada contradice HD11 (ahí el
> nombre es un `<span>` a propósito, porque la página enlazaría a sí misma) y
> este ciclo no abre esa decisión.

---

## Estructura por breakpoint

`Container` da `mx-auto w-full max-w-6xl px-4 sm:px-6`: 328 px útiles a 360,
720 a 768 y 1104 a 1280.

| Zona                            | 360                                                                                                                                        | 768                                                | 1280                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| **Fila del rastro**             | Una línea, `min-h-11` (**44 px fijos**, con uno o con cuatro eslabones), `mb-4`. Nunca envuelve, nunca se desplaza                         | Igual                                              | Igual. **No** se centra ni se estira: alineada a la izquierda |
| **Etiqueta**                    | `text-sm`, `truncate`, suelo `min-w-12`. Reparto por prioridad (§ Decisión 2)                                                              | Igual; con nombres reales no se recorta ninguna    | Igual                                                         |
| **Separador**                   | `›`, `px-1.5`, `shrink-0`, 17 px                                                                                                           | Igual                                              | Igual                                                         |
| **Área táctil de cada eslabón** | `min-h-11` en el `<a>`: 44 px de alto por todo el ancho que le toque                                                                       | Igual                                              | Igual                                                         |
| **Posición**                    | Primer hijo del `Container` de contenido, con `pt-4` en ese contenedor: el rastro arranca en **y = 84 px** en todas las pantallas          | Igual                                              | Igual                                                         |
| **Debajo de `BranchBar`**       | `BranchBar` mide 92 px a 360 (se apila): el rastro va después, sobre `bg`, sin franja propia — dos bandas de color seguidas serían pesadas | `BranchBar` en una fila (44 px); el rastro después | Igual                                                         |
| **Fila de chips de F-026**      | Sin tocar: `-mx-4 overflow-x-auto`, 52 px, debajo del `<h1>`. Solo baja 44 px                                                              | Sin tocar (envuelve desde `sm:`)                   | Sin tocar                                                     |
| **404 de tienda**               | Columna centrada `py-24`, como los dos que ya existen                                                                                      | Igual                                              | Igual                                                         |

**Coste vertical, medido antes y después a 360 px:**

| Pantalla                 | Antes                      | Después                                    |
| ------------------------ | -------------------------- | ------------------------------------------ |
| `/tienda-demo`           | búsqueda 100 · rejilla 372 | rastro 84 · búsqueda 144 · rejilla **416** |
| `/tienda-demo/c/bebidas` | búsqueda 100 · rejilla 348 | rastro 84 · búsqueda 144 · rejilla **392** |
| `/tienda-demo/p/…`       | búsqueda 92 · imagen 136   | rastro 84 · búsqueda 144 · imagen **220**  |

**+44 px en nueve pantallas y +52 px en la ficha de producto.** La ficha paga
8 px más porque su contenedor tenía `pt-6` y pasa a `pt-4`, y se acepta a
propósito: es lo que deja el rastro **exactamente a la misma altura (y = 84) en
las diez pantallas**, que es lo que R10 pide y lo que evita que la línea salte al
navegar.

**Qué mueve DP1 en esa tabla: ni un número, y se dice aquí para que nadie tenga
que deducirlo.** Las tres filas medidas —búsqueda, rejilla e imagen— están
**por encima** de la línea que se quita: a 360 px la rejilla de la ficha se
apila en una sola columna y el enlace de categoría vivía en la **segunda**,
debajo de la imagen. Lo que sí sube es el `<h1>` de la ficha y todo lo que
cuelga de él —precio, disponibilidad, `Agregar al carrito`—: **24 px**, que son
los 20 px de la caja de línea del enlace (`text-sm`, o sea `line-height:
1.25rem`) más los 4 px del `mt-1` del `<h1>`, que se queda sin nada encima y se
va con él, igual que en `sucursales`. Eso es aritmética de CSS sobre clases que
ya están en el archivo, no una medición nueva; DP1 dijo «20 px» contando solo el
enlace. **Balance de la ficha, que es la pantalla más apretada de las diez:
+52 px de la búsqueda a la imagen y −24 px del `<h1>` para abajo, o sea +28 px
netos** hasta el botón de comprar. Es la única de las diez que recupera algo.

**La regla que gobierna los tres anchos:** nada provoca desplazamiento horizontal
de la página con ningún nombre —comprobado midiendo `scrollWidth` en catorce
escenas × tres anchos × dos esquemas de color—, la fila mide siempre 44 px, y
ninguna clase de `StoreCategoryNav`, `StoreSearchBox`, `BranchBar` ni de la
rejilla cambia.

---

## Componentes de UI

**Se reutilizan tal cual, sin tocar una línea:** `Container`, `BranchBar`,
`StoreSearchBox`, `StoreCategoryNav`, `StoreClosedNotice`, `ProductCard`,
`BranchList`.

**Un componente nuevo, de servidor** (el nombre y la firma los cierra
`sdd-architect`; la spec propone src/components/store/StoreTrail.tsx, por crear,
alimentado por src/features/storefront/trail.ts, por crear):

| Pieza                                    | Qué hace                                                                                           | Por qué no alcanza lo que hay                                                                                                                                                      | `"use client"`                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| La fila del rastro (por crear)           | El `<nav aria-label="Ruta">`, el `<ol>`, los separadores, el `aria-current` y el reparto de anchos | Lo montan **diez páginas**. Repetir estas clases diez veces es cómo una de las diez pierde el `min-h-11`, el `aria-hidden` del separador o el tope `calc()` que impide el desborde | **No.** Es un `<ol>` de `<a>`          |
| src/app/[slug]/not-found.tsx (por crear) | El 404 con marco de tienda                                                                         | El global echa al comprador de la tienda (I6)                                                                                                                                      | **No.** `not-found.tsx` es de servidor |

**`Button` no se usa.** Renderiza un `<button>` y no tiene modo enlace; los
eslabones son `<a>`. Del enlace de salida de los 404 se copia su vocabulario de
clases, la misma técnica que ya usan `StoreClosedNotice` y
`src/app/[slug]/buscar/page.tsx`.

**Clases propuestas al implementador.** Orientativas en el detalle; **obligatorio
es lo que dicen § Tokens, § Accesibilidad y § Decisión 2.**

```
<nav aria-label="Ruta" class="mb-4">
  <ol class="flex min-h-11 min-w-0 items-center">

    <!-- antepasado -->
    <li class="flex min-w-12 shrink items-center">
      <a href="…" class="ENLACE ANTEPASADO">
        <span class="truncate">{label}</span>
      </a>
    </li>

    <!-- eslabón de vuelta (penúltimo) — el tope depende de cuántos eslabones haya -->
    <li class="flex min-w-12 shrink-0 items-center max-w-[calc(100%-6rem)]">
      <span aria-hidden="true" class="text-fg-muted shrink-0 px-1.5">›</span>
      <a href="…" class="ENLACE DE VUELTA">
        <span class="truncate">{label}</span>
      </a>
    </li>

    <!-- actual: nunca un <a>, nunca un href (E16, R5) -->
    <li class="flex min-w-12 shrink-[9999] items-center">
      <span aria-hidden="true" class="text-fg-muted shrink-0 px-1.5">›</span>
      <span aria-current="page" class="text-fg-muted flex min-h-11 min-w-0 items-center">
        <span class="truncate">{label}</span>
      </span>
    </li>

  </ol>
</nav>

base de todo eslabón : flex min-h-11 min-w-0 items-center
                       focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2
ENLACE ANTEPASADO    : + text-fg-muted hover:text-fg hover:underline hover:underline-offset-4
ENLACE DE VUELTA     : + text-fg font-medium underline underline-offset-4 hover:decoration-2
actual               : + text-fg-muted   (sin hover, sin subrayado, sin href)

tope del eslabón de vuelta, literal por número de eslabones — Tailwind necesita
la clase escrita entera, no compuesta en tiempo de ejecución:
  2 → max-w-[calc(100%-3rem)]
  3 → max-w-[calc(100%-6rem)]
  4 → max-w-[calc(100%-9rem)]
```

Tres detalles que **no** son decorativos y por eso están escritos aquí y no
descubiertos en revisión:

- **`min-w-0` en el `<a>` y `min-w-12` en el `<li>`.** Si el suelo se pone en el
  `<a>` en vez de en el `<li>`, el `<li>` encoge por debajo de su hijo, el `<a>`
  desborda y **la página gana desplazamiento horizontal**. Pasó en el prototipo,
  medido: `scrollWidth` 385 con un viewport de 360.
- **El separador va fuera de la caja que lleva `truncate`**, con `shrink-0`, o
  los puntos suspensivos se lo comen (§ Decisión 3).
- **El rastro no lleva `overflow-hidden` en ningún contenedor.** No lo necesita
  —los suelos y el tope garantizan que cabe— y ponerlo recortaría el anillo de
  foco, que sale 2 px fuera de la caja. Es la misma mordida que F-026 pagó con su
  `py-1` en la fila desplazable; aquí se evita no creando el contenedor
  desplazable.

**Dónde lo monta cada página.** Siempre **primer hijo del primer `Container` de
contenido**, y ese contenedor pasa a `pt-4`:

| Página                                          | Contenedor de hoy                                     | Cambio                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/[slug]/page.tsx` (sucursal y selector) | `<Container className="py-8">`                        | `pt-4 pb-8`                                                                                                                                                              |
| `src/app/[slug]/page.tsx` (cerrada)             | `<Container className="py-8">`                        | `pt-4 pb-8`                                                                                                                                                              |
| `src/app/[slug]/c/[categorySlug]/page.tsx`      | `<Container className="py-8">`                        | `pt-4 pb-8`                                                                                                                                                              |
| `src/app/[slug]/p/[productSlug]/page.tsx`       | `<Container className="pt-6">` (la búsqueda)          | `pt-4`, y **se borra** el `<Link>` de categoría de encima del `<h1>` (DP1); el `<h1>` pierde su `mt-1` y pasa a ser el primer hijo de su columna                         |
| `src/app/[slug]/buscar/page.tsx` (3 estados)    | `<Container className="py-8">`                        | `pt-4 pb-8`                                                                                                                                                              |
| `src/app/[slug]/carrito/page.tsx`               | `<Container className="py-8">`                        | `pt-4 pb-8`                                                                                                                                                              |
| `src/app/[slug]/checkout/page.tsx`              | `<Container className="py-8">`                        | `pt-4 pb-8`                                                                                                                                                              |
| `src/app/[slug]/pedido/[code]/page.tsx`         | `<Container className="max-w-2xl py-8 lg:max-w-4xl">` | `max-w-2xl pt-4 pb-8 lg:max-w-4xl` — **el rastro va dentro de ese `Container`, no de uno propio**, o a 1280 px quedaría 128 px a la izquierda de la columna de contenido |
| `src/app/[slug]/sucursales/page.tsx`            | `<Container className="py-8">`                        | `pt-4 pb-8`, **se borra** el `<Link>` «← Volver a {nombre}» y el `<h1>` pierde su `mt-1`                                                                                 |

**En las pantallas de tienda cerrada de `src/app/[slug]/page.tsx`,
`src/app/[slug]/c/[categorySlug]/page.tsx`,
`src/app/[slug]/p/[productSlug]/page.tsx` y `src/app/[slug]/buscar/page.tsx`,
`BranchBar` se renderiza _después_ del `Container`**, no antes. La regla «primer hijo del contenedor de contenido» deja ahí el rastro
encima del aviso de cerrada y encima de `BranchBar`. Es una desviación del orden
literal de R10 (`BranchBar` → rastro) **heredada del código de hoy, no
introducida aquí**: mover `BranchBar` en esas cuatro ramas sería tocarla, y
§ Fuera de la spec lo prohíbe.

---

## Tokens y tema

**No hace falta ningún token nuevo**, ni tocar `src/theme/tokens.css`.

| Uso                                 | Token / utilidad                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Eslabón antepasado y eslabón actual | `text-fg-muted`                                                                                           |
| Antepasado en `hover`               | `text-fg` + subrayado                                                                                     |
| Eslabón de vuelta                   | `text-fg`, `font-medium`, `underline underline-offset-4`                                                  |
| Separador                           | `text-fg-muted`                                                                                           |
| Anillo de foco                      | `focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2`, calcado de `Button` |
| Tipografía                          | `font-sans` (heredada) y `text-sm`. Sin tamaños arbitrarios                                               |
| Fondo                               | **Ninguno.** El rastro va sobre el `bg` de la página                                                      |
| Borde, sombra, esquinas             | **Ninguno.** Sin `rounded-*`, sin `shadow-card`, sin `border`: es texto (§ Decisión 5)                    |

**Cómo responde al branding por tienda.** Una tienda solo redefine `brand`,
`brandContrast`, `accent`, `accentContrast` y la escala `radius`. **El rastro no
usa ninguno de los cuatro colores de marca para pintar texto ni fondo**, y no usa
`radius` en absoluto. Consecuencias, y las dos son deliberadas:

- **El rastro se lee exactamente igual en las dos paletas del seed.** Verificado
  en captura a 360 px en `tienda-demo` (azul) y `tienda-dos` (verde, `radius:
"round"`), en claro y en oscuro.
- **No hereda el agujero conocido** de la pareja `bg-brand`/`text-brand-contrast`
  (3.33 : 1 en `tienda-dos`), que F-010, F-021 y F-026 ya anotaron. Un rastro que
  pintara el eslabón de vuelta en `text-brand` habría metido una instancia nueva
  de ese fallo justo en el único control de la fila: **por eso el eslabón de
  vuelta es `text-fg` y no `text-brand`**, aunque `BranchBar` y los `not-found`
  de hoy usen `text-brand` para sus enlaces.
- `brand` **sí** se usa, en un solo sitio donde es seguro: el **anillo de foco**,
  que WCAG 1.4.11 mide contra 3 : 1, no contra 4.5 : 1.

`npm run check:theme` no tiene nada que objetar: no hay ni un `rounded-[--x]` ni
un valor arbitrario que sea una propiedad personalizada desnuda. El único valor
arbitrario del diseño es `max-w-[calc(100%-Nrem)]`, que es una longitud.

---

## Accesibilidad

**Landmark y estructura.** `<nav aria-label="Ruta">` con un `<ol>` de `<li>`,
uno por eslabón. Uno solo por página, así que el landmark no se duplica; y
convive sin ambigüedad con `<nav aria-label="Sucursal">` (`BranchBar`),
`<nav aria-label="Categorías">` (`StoreCategoryNav`) y el `role="search"` de
`StoreSearchBox`, porque los cuatro tienen nombre distinto (R21). Un `<ol>` y no
un `<ul>`: el orden **significa** jerarquía.

**Sin encabezado propio para la fila.** Nada de `<h2 class="sr-only">Ruta</h2>`:
el `aria-label` del landmark ya la nombra y un encabezado más entre la cabecera y
el `<h1>` de la página ensucia el esquema. Es la misma decisión que tomó F-026.

**El eslabón actual.** `aria-current="page"` sobre un `<span>`, **nunca un `<a>`
y nunca un `href`** (E16, R5). Un enlace a la página en la que ya estás es una
trampa con lector de pantalla.

**Los separadores no se leen.** `aria-hidden="true"` explícito, no contenido
generado por CSS (§ Decisión 3). Un lector anuncia «Ruta, lista de 4 elementos:
El Trébol, enlace… Panadería, enlace… Refresco de cola 1.5 L, página actual», sin
un solo «mayor que».

**El texto recortado se lee entero.** El recorte es visual (`truncate`); el nodo
de texto lleva el nombre completo. Un nombre de producto de 120 caracteres se
anuncia completo aunque en pantalla se vean nueve.

**Orden de foco**, que es el del DOM y no se reordena con CSS. En
`/[slug]/c/[categorySlug]` de una marca con varias sucursales: nombre de la
tienda (cabecera) → `Carrito` → `Cuenta` → enlace de `BranchBar` → **marca →
sucursal** (los eslabones del rastro; el actual no recibe foco porque no es
enlace) → campo de búsqueda → `Buscar` → `Todo el catálogo` → categoría 1…n →
tarjeta 1…n. El rastro queda **antes** de la caja de búsqueda y de los chips, que
es el orden en que se decide: primero «dónde estoy y de dónde vengo», después
«qué busco».

**Anillo de foco, y el caso que se rompe solo.** `outline-offset-2` deja el
anillo fuera de la caja del eslabón, sobre el fondo de la página. Como aquí no
hay ningún contenedor con `overflow` —al contrario que en la fila de chips de
F-026—, **no se recorta por ningún lado**. Entre dos eslabones hay 17 px de
separador, así que dos anillos de 2 px a 2 px de distancia no se solapan.
Contraste del anillo `outline-brand` contra `bg`, medido:

| Anillo contra `bg`                | Claro    | Oscuro   |
| --------------------------------- | -------- | -------- |
| `tienda-demo` (marca por defecto) | 4.83 : 1 | 3.84 : 1 |
| `tienda-dos` (marca verde)        | 3.32 : 1 | 5.59 : 1 |

Los cuatro superan el 3 : 1 de WCAG 1.4.11.

**Contraste del texto, medido en las dos paletas** (el rastro no usa color de
marca, así que los números son los mismos en `tienda-demo` y en `tienda-dos`):

| Pareja                                         | Claro         | Oscuro        |
| ---------------------------------------------- | ------------- | ------------- |
| Eslabón de vuelta: `text-fg` sobre `bg`        | **16.82 : 1** | **16.53 : 1** |
| Antepasado y actual: `text-fg-muted` / `bg`    | 5.38 : 1      | 7.16 : 1      |
| Separador `›`: `text-fg-muted` / `bg`          | 5.38 : 1      | 7.16 : 1      |
| Salida del 404: `text-fg` / `bg-surface-muted` | 15.84 : 1     | 13.87 : 1     |

Todos por encima del 4.5 : 1 de AA para texto de 14 px. **Ninguna pareja de este
feature está por debajo**, que es la primera vez que un feature de storefront
puede escribir esa frase.

**Área de toque.** `min-h-11` (44 px) en cada `<a>`, como `BranchBar` y
`StoreSearchBox` (R17). El ancho es el que le toque a la etiqueta, con suelo de
`min-w-12` (48 px): en el peor caso medido, un eslabón mide 48 × 44 px. Los
separadores de 17 px entre objetivos evitan que dos eslabones contiguos se pisen.

**Nada se comunica solo por color.** El eslabón de vuelta lleva subrayado (forma)
y peso, además del contraste; el actual lleva `aria-current`. En escala de grises
la fila sigue siendo legible: se probó desaturando la captura.

**Idioma.** `lang="es"` lo pone el layout raíz. Los nombres de sucursal, marca,
categoría y producto los manda el POS y se imprimen tal cual (React escapa): un
nombre con `&`, comillas o emoji no rompe nada. El término de búsqueda llega ya
normalizado y truncado desde F-021, nunca crudo.

**Movimiento.** Ninguno. Sin transiciones propias, sin `scroll-snap`, sin
desplazamiento: nada que `prefers-reduced-motion` tenga que apagar.

---

## Coste de cliente

**Cero componentes de cliente. Cero.** Lo que este feature añade al navegador es
HTML y unas cuantas declaraciones CSS que Tailwind ya sabe emitir.

| Pieza                                    | Directiva | Por qué                                                                                                                    |
| ---------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| La fila del rastro (por crear)           | **No**    | Un `<ol>` de `<a>`. Ni estado ni eventos. Y se monta en el catálogo, donde `AGENTS.md` § Prohibiciones veta `"use client"` |
| El constructor del rastro (por crear)    | **No**    | Una función pura sobre datos que la página ya cargó (R7)                                                                   |
| src/app/[slug]/not-found.tsx (por crear) | **No**    | `not-found.tsx` es de servidor; solo `error.tsx` obliga a `"use client"`                                                   |
| El recorte con puntos suspensivos        | **No**    | `text-overflow: ellipsis`. Ni un `ResizeObserver`, ni una medición, ni un `useEffect`                                      |
| El reparto de anchos                     | **No**    | El algoritmo de flexbox. Ni un cálculo en JavaScript                                                                       |

**El «atrás» no lee el historial, y por eso no cuesta nada** (I2). `history.back()`
o `router.back()` exigirían `"use client"` en el árbol del catálogo —prohibido— y
además fallarían en el caso que este feature existe para resolver: el QR abre una
pestaña con el historial vacío.

**Sin `<noscript>`.** Con JavaScript desactivado la fila es **la misma**: son
`<a href>` en el HTML servido. Eso es E14 y el criterio 2, y no hay nada que
explicarle a nadie.

**Sin `error.tsx` propio de segmento.** En Next tiene que llevar `"use client"`:
ponerlo aquí metería un módulo de cliente en un árbol que renderiza catálogo.
`src/app/error.tsx` ya cubre la ruta desde la raíz y no añade ni un byte.

**Presupuesto.** `node scripts/check-bundle-budget.mjs` tiene que seguir en 0
**sin tocar `BUDGET_KB`** (criterio 4). Aquí no hay nada que pueda crecer
legítimamente: si sube, hay una regresión que investigar, no un número que subir.

**Lo que se queda fuera por costar JavaScript, y no vuelve por la puerta de
atrás:** un «…» que expanda los eslabones al pulsar (R12 lo prohíbe por escrito),
llevar el rastro hasta el eslabón activo al cargar, medir el ancho para decidir
cuánto recortar, un `title` que aparezca al mantener pulsado en móvil, y recordar
de dónde venía el comprador. Los cinco necesitan un módulo de cliente o un
`searchParams` que volvería `ƒ` la ficha (I7, R18).

---

## Textos

Microcopy exacto, en español. Las etiquetas del rastro las fija **R11** y este
documento no inventa ninguna:

| Eslabón            | Texto                                                                            |
| ------------------ | -------------------------------------------------------------------------------- |
| Landmark           | `Ruta` (en `aria-label`, no visible)                                             |
| Marca              | `{Storefront.name}` — p. ej. `El Trébol`                                         |
| Sucursal           | `{Store.name}` — p. ej. `La Rampa · Vedado`                                      |
| Categoría          | `{LocalCategory.name}` — p. ej. `Bebidas`. **Nunca** el `categorySlug` de la URL |
| Producto           | el nombre del producto, tal cual                                                 |
| Búsqueda con `q`   | `Buscar «{término normalizado}»`                                                 |
| Búsqueda sin `q`   | `Buscar`                                                                         |
| Carrito            | `Carrito`                                                                        |
| Checkout           | `Pagar`                                                                          |
| Pedido             | `Pedido {formatOrderCode(code)}`                                                 |
| Cambio de sucursal | `Cambiar de sucursal`                                                            |
| Separador          | `›`, decorativo, no se lee                                                       |

**Ni una etiqueta lleva la palabra «Volver».** No es un capricho de estilo: el
criterio 11 de `.agent/features.json` pide que en `/bodega-uno/sucursales` la
cadena `Volver a` no aparezca más de una vez, y el criterio 11 de
`.agent/specs/F-025/spec.md` —la misma comprobación, redactada distinto— pide que
**ya no aparezca**. Con el «← Volver a {nombre}» de
`src/app/[slug]/sucursales/page.tsx` borrado y ninguna etiqueta nueva que lo
contenga, **las dos redacciones se cumplen a la vez** y quien escriba el
`smoke.sh` no tiene que elegir cuál obedece. Cuidado al añadir textos: `Volver al
catálogo` contiene `Volver a`.

**Los tres 404, palabra por palabra.** Los dos primeros son los de hoy; solo
cambia el destino del enlace y su aspecto:

| Pantalla                                        | `<h1>`                       | Explicación                                                                                                          | Enlace                 |
| ----------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `src/app/[slug]/c/[categorySlug]/not-found.tsx` | `Esta categoría ya no está`  | `Puede que la tienda la haya quitado o que sus productos hayan cambiado de sitio. Siguen en el catálogo.`            | `Ver todo el catálogo` |
| `src/app/[slug]/pedido/[code]/not-found.tsx`    | `No encontramos ese pedido.` | `Revisa el código: son 10 caracteres y a veces se confunde un 0 con una O.`                                          | `Ver el catálogo`      |
| src/app/[slug]/not-found.tsx (por crear)        | `Este producto ya no está`   | `Puede que la tienda lo haya quitado o que se haya quedado sin existencias. El resto del catálogo sigue disponible.` | `Ver todo el catálogo` |

`Ver todo el catálogo` es, a propósito, **la misma frase** que ya usan
`src/app/[slug]/buscar/page.tsx` y el chip de `StoreCategoryNav`: una tercera
manera de nombrar el mismo destino es cómo un producto pierde su vocabulario.

**El `<h1>` del 404 nuevo habla de un producto** porque `/[slug]/p/no-existe` es
el camino que lo motiva (E15, criterio 9). Ese archivo captura también cualquier
otro `notFound()` del segmento que no tenga uno más cercano; si el arquitecto
encuentra un camino donde el texto mienta, la salida sigue siendo correcta y el
título es lo único que habría que generalizar (`Esto ya no está`).

---

## Lo que este diseño le pide al arquitecto

- **RD1 — un solo componente para las diez pantallas.** Diez copias del `<ol>`
  son diez oportunidades de perder el `min-h-11`, el `aria-hidden` o el tope
  `calc()` que impide el desborde.
- **RD2 — el componente tiene que saber cuántos eslabones hay** para elegir el
  tope del eslabón de vuelta (§ Decisión 2). Con `Trail` en la mano es
  `trail.length`; no hace falta ningún dato nuevo.
- **RD3 — el eslabón actual se renderiza con `<span aria-current="page">`, nunca
  con un `<a>` sin `href`.** Un `<a>` sin `href` no es un enlace pero sigue
  saliendo en algunos árboles de accesibilidad como texto genérico.
- **RD4 — el rastro no puede necesitar `headers()`, `cookies()` ni
  `searchParams`** en `/[slug]`, `/[slug]/p/[productSlug]` ni
  `/[slug]/c/[categorySlug]` (R18, criterios 3 y 19).
- **RD5 — la salida canónica de los dos `not-found.tsx` existentes y del nuevo
  tiene que ser una sola solución, no tres** (E21, I10). El diseño no depende de
  cuál sea: pide solo que el `href` resultante sea absoluto y canónico.
- **RD6 — el `<script type="application/ld+json">` con `BreadcrumbList` es
  invisible y puede ir donde el arquitecto quiera** dentro de las tres rutas
  indexables (R13). No forma parte de la fila y no debe alterar su maqueta.
- **RD7 — si se decide `prefetch={false}` en los eslabones** (queda abierto en
  la spec, es suyo), el diseño no cambia: no hay ningún estado visual que dependa
  del prefetch.

---

## Verificación visual

Con `npm run dev` levantado y los datos de `npm run seed`. Traducible a
.agent/specs/F-025/visual.mjs (por crear) por `sdd-tester`. Los pasos V1–V4 y
V9 son los que un `curl` **no** puede comprobar.

**Son once, no diez.** `.agent/specs/F-025/plan.md` se firmó citando «V1–V10»
porque V11 nació al cerrar DP1, después de la firma. V1–V10 **no se renumeran**
—el plan y `.agent/specs/F-025/architecture.md` los citan por número—: V11 se
añade al final y el guion visual lleva once pasos, como el de F-026.

- **V1 · La fila está donde dice R10, en las diez.** A 360 px, en
  `/tienda-demo`, `/tienda-demo/c/bebidas`, `/tienda-demo/p/jugo-de-mango-1-l`,
  `/tienda-demo/buscar?q=jugo`, `/tienda-demo/buscar`, `/tienda-demo/carrito`,
  `/tienda-demo/checkout`, `/el-trebol`, `/el-trebol-centro` y
  `/el-trebol-centro/sucursales`: el `nav[aria-label="Ruta"]` existe, está por
  encima del `<h1>`, y su `getBoundingClientRect().top` vale **84** en las que
  no tienen `BranchBar`.
- **V2 · La fila mide 44 px con uno y con cuatro eslabones**, en los tres anchos.
- **V3 · Ninguna pantalla gana desplazamiento horizontal.**
  `document.documentElement.scrollWidth === window.innerWidth` en las diez, a
  360, 768 y 1280, y también con un nombre de producto de 120 caracteres.
- **V4 · El eslabón de vuelta no se recorta cuando hay hueco.** En
  `/el-trebol-centro` a 360 px, `El Trébol · Centro Habana` se ve entero
  (`scrollWidth <= clientWidth` en su `<span>`); en la ficha con cuatro
  eslabones, el penúltimo es el que más ancho recibe de los cuatro.
- **V5 · El foco se ve y no se recorta.** Tabulando desde la cabecera, cada
  eslabón enlazable recibe un anillo visible **completo** (no cortado por ningún
  borde) y el eslabón actual **no** recibe foco. Ida con `Tab` y vuelta con
  `Shift+Tab`.
- **V6 · Las dos paletas y los dos esquemas de color.** `/tienda-demo/carrito` y
  `/tienda-dos/carrito`, en claro y en oscuro: la fila se ve idéntica salvo por
  el fondo de la página, y el eslabón de vuelta se distingue del actual sin
  mirar el color (captura desaturada).
- **V7 · El rastro y los chips no se confunden.** En `/tienda-demo/c/bebidas` a
  360 px, la fila del rastro no tiene fondo ni borde ni esquinas redondeadas, y
  la de chips sí. La fila de chips sigue midiendo **52 px** y sigue siendo la que
  se desplaza.
- **V8 · Un solo control de vuelta en `/…/sucursales`.** La cadena `Volver a` no
  aparece en el HTML, y hay exactamente un `nav[aria-label="Ruta"]`.
- **V9 · El 404 conserva la tienda y su salida lleva al canónico.** Es **la
  única prueba del criterio 9**, no una inspección de apoyo: el criterio se
  reformuló el 2026-08-31 para verificarse con navegador porque está medido que
  en esta app **ningún `notFound()` sirve HTML real** —el cuerpo va vacío y el
  árbol viaja en el payload de React Flight, `.agent/specs/F-025/architecture.md`
  § El 404 dentro de una tienda—, así que `curl` no puede verlo y esa mitad es de
  `.agent/specs/propuestas/404-sin-salida-sin-javascript.md`, no de este feature.
  Cuatro asertos, en el mismo sitio y con el mismo método que la V9 de
  `.agent/specs/F-026/visual.mjs` (navegador headless contra la app que levanta
  el arnés):
  1. `goto('/tienda-demo/p/no-existe')` devuelve **404** en el `Response` del
     documento. El estado se comprueba, no se supone.
  2. Con la página ya renderizada, el DOM tiene `[data-store="tienda-demo"]` y
     la cabecera de la tienda con su nombre (`La Rampa · Vedado`). No es la
     página de 404 genérica de la plataforma, que es lo que sale hoy.
  3. **Pulsar** esa cabecera —el enlace al slug canónico de
     `src/app/[slug]/layout.tsx`, que es la salida desde que los tres 404
     perdieron la suya propia— aterriza en `/tienda-demo` con 200. Se pulsa, no
     se lee el `href`: un `href` correcto dentro de un árbol que no se recupera
     no es un camino de vuelta, y el criterio pide un camino.
  4. Lo mismo entrando por un alias: `/bodega-central-vedado/c/no-existe` da 404
     y su salida aterriza en **`/bodega-central`**, nunca en
     `/bodega-central-vedado`.

  Aviso para `sdd-tester`: la V9 de `.agent/specs/F-026/visual.mjs` pulsa hoy el
  `Ver todo el catálogo` **propio** del 404 de categoría. El paso 6 del plan lo
  borra, así que ese guion tendrá que pulsar la cabecera igual que este.

- **V10 · La tienda cerrada.** `/tienda-cerrada/carrito` enseña el rastro
  completo; `/tienda-cerrada/c/lo-que-sea` responde 200 y su rastro termina en la
  sucursal, sin eslabón de categoría.
- **V11 · En la ficha, la categoría aparece una sola vez y dentro del rastro.**
  Es DP1 vista, y es la comprobación que el paso 4 del plan firmado pide para
  PP1. En `/tienda-demo/p/jugo-de-mango-1-l` a 360 px:
  1. Dentro del `nav[aria-label="Ruta"]` hay **exactamente un** `<a>` cuyo texto
     es `Bebidas`, y es el eslabón de vuelta.
  2. **Fuera** de ese `nav` no queda **ninguno**: cero elementos renderizados
     cuyo texto sea `Bebidas` (con la regla del elemento más pequeño que
     contiene el texto, `:text-is("Bebidas")`, para que el `<a>` y su `<span>`
     interior no se cuenten dos veces). Así se descartan a la vez el enlace
     duplicado de la opción (a) y el texto sin enlace de la (c). El
     `<script type="application/ld+json">` sí lleva la cadena y **debe**
     llevarla: no es texto renderizado y no cuenta.
  3. El `<h1>` del producto es el **primer hijo** de su columna de la rejilla
     (`h1.parentElement.firstElementChild === h1`). Esto es lo que demuestra que
     la línea de encima **no está**, y no solo que no diga «Bebidas».
  4. Control de que DP1 no se pasó de largo: en `/tienda-demo/c/bebidas` la fila
     de chips sigue teniendo su chip `Bebidas` activo. Lo que se quitó es la
     línea de la ficha, no el selector de categorías del catálogo (V7).

---

## Preguntas al humano

**DP1 — la ficha de producto va a decir «Bebidas» dos veces. ¿Se quita una?
RESUELTA por el humano el 2026-08-31: opción (b).**
Palabras literales, al firmar `.agent/specs/F-025/plan.md`, donde esta misma
pregunta viajó como PP1: «Apruebo. Y en PP1, quitar la línea de encima del
título: que la categoría aparezca solo en el rastro.» Eligió (b) **sabiendo que
revierte el efecto visible de DP2 de F-026, que fue una decisión suya del
2026-08-29**: se le advirtió por escrito y aun así la eligió. Era la
recomendación de este documento y, por su cuenta, también la de
`sdd-architect`.

**Lo que se implementa, en una línea:** `src/app/[slug]/p/[productSlug]/page.tsx`
deja de pintar el `<Link>` de categoría de encima del `<h1>`, el `<h1>` pierde
su `mt-1`, y el eslabón de vuelta del rastro se queda como el único sitio de la
ficha donde aparece la categoría. **No se toca ningún chip del catálogo**, ni
`src/components/store/StoreCategoryNav.tsx` ni
`src/components/store/BranchBar.tsx`. Está en el paso 4 del plan firmado y se
verifica con V11.

La pregunta se conserva entera debajo, con las tres opciones y (b) marcada, para
que se vea qué se descartó.

Desde SP4 el rastro de la ficha lleva la categoría como eslabón de vuelta, con el
`href` que da `storeCategoryPath()`. Y `src/app/[slug]/p/[productSlug]/page.tsx`
ya pinta, justo encima del `<h1>`, **ese mismo nombre como enlace a esa misma
URL**: lo puso F-026 al resolver su DP2 («el nombre de la categoría en la ficha
de producto es un enlace»), decidido por ti el 2026-08-31. Con el rastro dentro,
en 360 px quedan dos enlaces idénticos a 60 px de distancia: uno en la fila del
rastro y otro pegado al título. Para un lector de pantalla son dos enlaces con el
mismo nombre y el mismo destino.

- **(a) No tocar nada.** El rastro es cromo de navegación y la línea de encima
  del `<h1>` es metadato del producto; cada una tiene su papel. Es lo que dice
  hoy la spec, que en ningún sitio pide quitarla, y **es la opción por defecto:
  si no respondes, se implementa esta y nada se bloquea.**
- **(b) Quitar la línea de encima del `<h1>` en la ficha. ← ELEGIDA.** El rastro la sustituye
  con ventaja: mismo nombre, mismo enlace, mismo destino, y además dice de qué
  sucursal cuelga. Ahorra 20 px de alto en la pantalla más apretada y elimina el
  enlace duplicado. **Recomendada**, con la advertencia de que revierte el efecto
  visible de DP2 de F-026, que fue una decisión tuya.
- **(c) Dejarla, pero como texto sin enlace.** Quita la duplicación de destino y
  conserva el dato junto al título. Deshace DP2 a medias, que suele ser la peor
  de las tres.

Recomendación: **(b)**. Es la única que reconoce que el rastro ya hace ese
trabajo, y lo hace mejor.

**Dónde se propagó la respuesta dentro de este documento**, para que el
implementador no tenga que deducirlo:

| Sección                             | Qué cambió                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| § Decisión 2                        | Un motivo más para que el eslabón de vuelta no encoja nunca. **Ningún ancho medido cambia**: son de la fila del rastro y la línea que se quita está debajo                     |
| § Inventario de pantallas y estados | La fila 4 y el estado «Producto sin categoría»: encima del `<h1>` ya no hay nada, tenga categoría o no                                                                         |
| § Estructura por breakpoint         | **Ningún número de la tabla de coste vertical cambia** —búsqueda, rejilla e imagen están por encima de la línea que se quita—. Lo que se mueve es el `<h1>` para abajo: −24 px |
| § Componentes de UI                 | La tabla de «Dónde lo monta cada página»: la ficha, además de `pt-6`→`pt-4`, borra el `<Link>` y el `mt-1`                                                                     |
| § Verificación visual               | **V11**, añadido al final. V1–V10 se quedan con su número porque el plan firmado y `.agent/specs/F-025/architecture.md` los citan así                                          |

**Las decisiones 1 a 5 no cambian.** DP1 no contradice ninguna: el reparto de
anchos, el separador, el eslabón único y el reparto de lenguaje visual con los
chips se sostienen igual con la línea quitada. Y no queda ninguna pregunta
abierta en este documento.
