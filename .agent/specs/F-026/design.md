---
feature: F-026
agente: sdd-designer
actualizado: 2026-08-31T05:49:51Z
estado: listo
---

> **Ciclo 1, cerrado.** Se escribió en paralelo con `sdd-architect` y luego se
> concilió con lo construido. Lo que este diseño le pidió al arquitecto sigue
> numerado en § Lo que este diseño le pide al arquitecto (RD1–RD8).
>
> **Las tres preguntas de diseño están RESUELTAS** (2026-08-31, el humano):
> **DP1** en (a) —el chip activo se queda con la pareja `brand`/`brand-contrast`
> y el contraste se arregla en la raíz, en un feature aparte—, **DP2** en (a)
> —el nombre de la categoría en la ficha de producto es un enlace, ya
> implementado— y **DP3** en (b) —las vistas de categoría **no** entran en
> `src/app/sitemap.ts`, aunque siguen siendo indexables—. Están al final, con
> sus opciones y sin borrar, igual que `spec.md` hizo con SP1–SP4.
>
> **TP1, que levantó `sdd-tester`, también está resuelto:** el umbral de dos o
> más categorías es **solo de `/[slug]`**; la vista de categoría dibuja la fila
> **siempre**. Está escrito como regla en § Inventario, en las dos pantallas.
>
> **Y una corrección de este documento, no de la implementación:** el fallo de
> V5 que levantó `sdd-tester` era una tensión real de § Decisión 1 —el asomo que
> señala «esto se desliza» es lo que impide que el navegador arrastre a la vista
> el chip enfocado—. Se cierra **con CSS puro**, `scroll-padding-inline: 50%`,
> comprobado en el navegador contra siete repartos de anchos. Está en § El asomo
> tenía un precio escondido, en § Componentes de UI, en § Accesibilidad (donde
> el ciclo 1 afirmaba algo falso), como **RD9** y partiendo V5 en V5a y V5b.
>
> **Lo que el humano ya cerró y aquí no se reabre:** SP2 (ruta propia y estática
> por categoría, no un panel ni un query param), SP3 (slug legible y congelado
> en la URL), SP4 (esto es navegación; los filtros son F-027 y **no se dibuja ni
> su hueco**), SP1 (**un solo nivel**: ni árbol, ni migas de subcategoría, ni un
> segundo nivel «para cuando lo haya»).

## Qué se miró antes de diseñar

`AGENTS.md` entero —§ Prohibiciones (la de `"use client"` en cualquier cosa que
renderice catálogo), § El presupuesto de JavaScript no es un muro, § Cosas que
muerden, § Idioma—, `.agent/specs/F-026/spec.md` completa (E1–E15, R1–R14, la
tabla de casos límite, I1–I10, los 15 criterios y § No decidido a propósito),
`.agent/progress/F-026.md`, y los dos diseños con los que colinda:
`.agent/specs/F-021/design.md` (la caja de búsqueda, que convive con el selector
en la misma pantalla) y `.agent/specs/F-017/design.md` (`BranchBar`).

Del código: `src/app/[slug]/page.tsx`, `src/app/[slug]/layout.tsx`,
`src/app/[slug]/buscar/page.tsx`, `src/app/[slug]/sucursales/page.tsx`,
`src/app/[slug]/pedido/[code]/not-found.tsx`, `src/app/not-found.tsx`,
`src/app/sitemap.ts`, `src/components/store/ProductCard.tsx`,
`src/components/store/StoreSearchBox.tsx`, `src/components/store/BranchBar.tsx`,
`src/components/store/StoreClosedNotice.tsx`, los diez de
`src/components/ui/`, `src/features/catalog/server/queries.ts`,
`src/features/theming/storeTheme.ts`, `src/theme/tokens.css`,
`src/app/globals.css`, `scripts/check-theme-tokens.mjs` y `next.config.ts`.

### Se miró la pantalla de verdad, y con números

**El `next dev` del puerto 3000 no era de este checkout.** `lsof` lo daba en
`/Users/adrian/orca/workspaces/queandabuscando/.orca-worktree-trash/…`: es
exactamente la trampa de `AGENTS.md` § Cosas que muerden («comprueba el
directorio del proceso antes de creerte lo que ves»). Levanté el mío en el
**3100** y todo lo de abajo está medido contra ese.

Con Playwright —el que ya usa el arnés— abrí `/tienda-demo` y `/tienda-dos` a
360, 768 y 1280, en claro y en oscuro, e **inyecté el selector prototipado en la
página real** para medirlo en su sitio en vez de estimarlo. Geometría de hoy en
`/tienda-demo`, a 360:

| Elemento                    | Arriba (px) | Alto (px) |
| --------------------------- | ----------- | --------- |
| Cabecera `bg-brand`         | 0           | 68        |
| Caja de búsqueda (F-021)    | 100         | 44        |
| `<h1>Catálogo</h1>`         | 176         | 32        |
| Rejilla (2 columnas, gap-4) | 296         | —         |

Anchos reales de un chip a `text-sm px-3` (medidos, no estimados):
«Aseo» 60 px, «Bebidas» 80 px, «Alimentos» 93 px, «Panadería» 93 px,
«Higiene personal» 139 px, «Todo el catálogo» 136 px, y un nombre patológico
(«Productos de limpieza para el hogar») 266 px.

Y la medición que decide la forma del selector, con **16 chips** (15 categorías
más el de volver):

| Forma del selector        | 360 px               | 768 px | 1280 px |
| ------------------------- | -------------------- | ------ | ------- |
| Una fila que **envuelve** | **372 px** (6 filas) | 148 px | 96 px   |
| Una fila **desplazable**  | **52 px**            | —      | —       |
| Envolviendo, con 5 chips  | 96 px (2 filas)      | 44 px  | 44 px   |

A 360 px, envolver 15 categorías empuja la rejilla de `y=296` a `y=692`: en una
pantalla de 800 px de alto **no se ve ni un producto entero**. Eso es lo que
descarta «que envuelva siempre», y está capturado.

---

## Flujo de usuario

En una frase: **el comprador entra a `/[slug]`, ve encima de la rejilla una fila
de categorías que son enlaces, toca una y el servidor le devuelve una página
propia con solo esa categoría, desde la que siempre puede volver a todo el
catálogo o saltar a otra categoría sin pasar por el medio.**

```
QR / enlace
   ▼
/[slug]                                  ← catálogo completo
   │  caja de búsqueda (F-021)
   │  <nav aria-label="Categorías">  ← chip «Todo el catálogo» ACTIVO + una por categoría
   ▼
/[slug]/c/[categorySlug]  (por crear)    ← página propia, estática, indexable
   │  la MISMA fila, con el chip de esta categoría activo
   │
   ├─ «Todo el catálogo»  → /[slug]            (R6: siempre presente)
   ├─ otra categoría      → /[slug]/c/otra     (sin pasar por el catálogo)
   ├─ toca una tarjeta    → /[slug]/p/[productSlug]
   ├─ nombre de la tienda → /[slug]            (la cabecera del layout ya enlaza)
   └─ «Buscar»            → /[slug]/buscar?q=… (búsqueda de toda la tienda)
```

**Vueltas atrás y qué se pierde.**

| Desde → hacia                       | Qué se conserva                                                   | Qué se pierde                                                                            |
| ----------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Categoría → catálogo                | El carrito, intacto. La categoría queda en el historial           | Nada                                                                                     |
| Categoría → otra categoría          | Todo. Es una navegación lateral, no un ida y vuelta               | Nada                                                                                     |
| Ficha de producto → categoría       | La categoría entera, porque está en la URL                        | Nada                                                                                     |
| Compartir la URL de una categoría   | **Todo.** Quien la abre ve el mismo recorte. Es lo que compra SP2 | Nada                                                                                     |
| Categoría borrada en el POS (E8)    | El producto sigue en `/[slug]`                                    | La URL guardada deja de existir: 404 con marco de tienda y salida al catálogo (abajo)    |
| Categoría renombrada en el POS (E7) | **La URL**, que no se mueve (R8). El chip muestra el nombre nuevo | Nada                                                                                     |
| Tienda A → tienda B                 | Cada tienda tiene sus categorías y su fila                        | La categoría no se arrastra entre tiendas, a propósito: no hay categoría global (R2, I2) |

**No hay punto de no retorno.** Navegar por categoría no escribe nada, no
consulta nada del comprador y no cambia el carrito.

**Dónde vive la fila, y por qué no en el `layout`.** Mismo argumento que F-021
escribió para la caja de búsqueda, y por los mismos dos motivos: el `layout` de
`src/app/[slug]/layout.tsx` es compartido por `/carrito`, `/checkout`,
`/pedido/[code]`, `/sucursales` y el modo selector —ofrecer «vete a otra
categoría» a dos campos de pagar es sabotear el pedido, y bajo un slug en modo
selector la vista de categoría es 404 (E10), así que ahí la fila enlazaría a
404—, y un `layout` de servidor no sabe en qué ruta está sin JavaScript de
cliente. La fila la montan **las páginas**, exactamente como ya montan
`BranchBar`.

Vive en **dos pantallas y en ninguna más**:

| Pantalla                                  | ¿Fila?                                | Por qué                                                                                                                   |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/[slug]` en modo sucursal y `PUBLISHED`  | **Sí**, si hay ≥1 categoría con stock | Es la puerta: quien entra a mirar no tiene término que teclear                                                            |
| /[slug]/c/[categorySlug] (por crear)      | **Sí**, siempre                       | Es a la vez el «dónde estoy», el salto lateral y la salida obligatoria de R6                                              |
| `/[slug]/buscar`                          | **No**                                | Parecería que filtra los resultados, y en realidad los tira. Filtrar dentro de una búsqueda es F-027                      |
| `/[slug]/p/[productSlug]`                 | **No**                                | La ficha ya imprime el nombre de su categoría, y desde DP2 ese nombre **es un enlace** a su vista. Un enlace, no una fila |
| `/[slug]` en modo selector                | **No**                                | E10: una marca no tiene catálogo ni categorías                                                                            |
| Tienda `SUSPENDED`                        | **No**                                | E11: no se ejecuta ninguna consulta de catálogo. Una fila que no lleva a ningún sitio es peor que ninguna fila            |
| `/carrito`, `/checkout`, `/pedido/[code]` | **No**                                | Pantallas de pagar                                                                                                        |
| `/[slug]/sucursales`                      | **No**                                | Pantalla de tránsito, `noindex`, una sola decisión                                                                        |

---

## Decisión 1 — la forma del selector

**Una fila de chips: desplazable horizontalmente a 360 px, que envuelve a partir
de `sm:` (640 px). Enlaces `<a href>` dentro de un `<nav>`, cero JavaScript.**

La spec dejaba tres formas abiertas y pedía una cuarta si se me ocurría. Esta es
la cuarta: no es «chips desplazables» ni «chips que envuelven», es **las dos, por
CSS puro, según el ancho**. El motivo está medido arriba:

| Forma                           | Por qué no                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chips que envuelven **siempre** | Medido: 15 categorías = **372 px** a 360 px, la rejilla cae entera fuera de pantalla. En la vista de categoría es peor: el comprador acaba de elegir «Bebidas» y no ve ni una bebida                                                                                       |
| Chips desplazables **siempre**  | A 1280 px sobra ancho para 11 chips y aun así escondería el resto detrás de un gesto. Esconder cuando hay sitio no se justifica                                                                                                                                            |
| Lista lateral                   | A 360 px una barra lateral tiene que convertirse en otra cosa igualmente, y a 1280 obliga a partir `/[slug]` en dos columnas: encogería la rejilla y cambiaría el `sizes` de las imágenes de `ProductCard`. Un feature de navegación no vale una remodelación del catálogo |
| `<details>` plegable            | Nace **cerrado** y no recuerda nada entre páginas: navegar de categoría en categoría obligaría a abrirlo cada vez. Y el problema que este feature resuelve es que el comprador **no sabe qué hay**; esconder la respuesta detrás de un toque es no resolverlo              |

Lo que se gana con la mezcla: a 360 px el selector cuesta **52 px** fijos, entren
4 categorías o 15; a partir de 640 px se ven todas sin gesto ninguno (15
categorías = 3 filas a 768, 2 filas a 1280). Y a 360 px la fila se sangra a los
bordes de la pantalla (`-mx-4 px-4`), de modo que el chip siguiente asoma
cortado en el borde derecho: es el indicio de «esto se desliza», medido en
`3 chips enteros + 1 asomando` con los nombres reales de la base de desarrollo
(«Todo el catálogo», «Alimentos» y «Aseo» enteros, **«Bebidas» asomando 29 px de
sus 79**, y «Panadería» entera fuera de pantalla).

**Lo que se pierde, dicho sin adornos:** a 360 px, con más de tres categorías,
las demás están detrás de un deslizamiento. No hay JavaScript que lleve la fila
hasta el chip **activo** al cargar la página, y **no lo va a haber**: sería
`"use client"` en algo que renderiza catálogo. Lo compensa que en la vista de
categoría el `<h1>` es el nombre de la categoría, justo encima de la fila: el
«dónde estoy» nunca depende de que el chip activo se vea.

### El asomo tenía un precio escondido, y se paga con una línea de CSS

Esto es una corrección del ciclo 1, escrita aquí porque el error estaba aquí.
`sdd-tester` tradujo V5 a `.agent/specs/F-026/visual.mjs` y **falló**, cinco
corridas iguales: al tabular, el chip que **asoma** se queda asomando. La causa
no es la implementación, es la tensión de este mismo apartado: Chromium arrastra
a la vista un elemento enfocado solo cuando está **totalmente fuera** de la
región útil del scrollport; un chip que asoma está _parcialmente_ dentro, así
que el navegador decide que no hay nada que hacer. El asomo que da la señal de
«esto se desliza» es exactamente lo que desarma el arrastre nativo. Y
`scrollIntoView()` está cerrado por R9.

**Hay una tercera vía y es CSS puro:
`scroll-padding-inline: 50%` en el contenedor desplazable.** `scroll-padding`
encoge la «región de visionado óptimo» que el navegador usa para decidir si un
elemento enfocado está dentro; al 50 % por cada lado esa región **colapsa a un
punto en el centro**, así que ningún chip puede estar «parcialmente dentro»:
todos cuentan como fuera, y el navegador centra el que recibe el foco. Es una
propiedad de scroll, **no de maquetación**: no mueve nada, no cambia el ancho de
nada y **no toca el asomo**.

Comprobado en el navegador, no razonado. Ejecuté el bucle de tabulación de V5
sobre `/tienda-demo` a 360 px —con las 19 categorías que la base tenía en ese
momento— y además contra siete repartos de anchos sintéticos, para no atar la
decisión a los nombres de hoy. Chips que acaban **fuera** de la ventana al
enfocarse, sobre el total:

| Reparto de anchos                         | sin nada | `2rem` | `4rem` | `6rem` | `9.5rem` | **`50%`** |
| ----------------------------------------- | -------- | ------ | ------ | ------ | -------- | --------- |
| Los 4 reales de hoy                       | 1 / 5    | 1 / 5  | 0      | 0      | 0        | **0**     |
| Los 4 reales + 15 nombres largos (226 px) | 9 / 20   | 9 / 20 | 7 / 20 | 0      | 0        | **0**     |
| Todos estrechos (60 px)                   | 2 / 13   | 0      | 0      | 0      | 0        | **0**     |
| Estrecho y ancho alternando (60 / 153 px) | 4 / 9    | 4 / 9  | 4 / 9  | 4 / 9  | 3 / 9    | **0**     |
| Todos medianos (93 px)                    | 3 / 13   | 0      | 0      | 0      | 0        | **0**     |
| Uno monstruoso de 266 px entre otros      | 2 / 7    | 2 / 7  | 1 / 7  | 1 / 7  | 1 / 7    | **0**     |

**Por eso el valor es `50%` y no un número fijo de `rem`.** Un valor fijo
funciona con los nombres de hoy y falla con otros: la fila «estrecho y ancho
alternando» sigue rompiéndose hasta con 9.5 rem, porque cuánto padding hace
falta depende del ancho de cada chip y del siguiente. Los nombres los pone el
POS del comerciante y no los controla nadie de este lado, así que el único valor
defendible es el que **no depende de los datos**. `50%` lo es.

**Lo que sigue sin poder cumplirse, y queda aceptado por escrito:** un chip **más
ancho que el propio scrollport** —un nombre de categoría de unos 45 caracteres
en un móvil de 360 px— no puede quedar entero dentro de la ventana por mucho que
la fila se desplace. Es una imposibilidad física, no un fallo del mecanismo: no
hay CSS ni JavaScript que la arregle, solo truncar el nombre, que R13 prohíbe.
Está anotado como el límite de V5.

Efecto secundario, medido y aceptado: con la región colapsada, la fila se mueve
en **casi cada** `Tab` en vez de solo cuando el chip está fuera (18 movimientos
en 20 chips, frente a 8). Para quien navega con teclado es una mejora, no un
ruido: el chip enfocado queda **siempre centrado**, lo que es más predecible que
«a veces salta y a veces no». Y no afecta a quien desliza con el dedo: el
desplazamiento manual no pasa por este algoritmo.

A partir de `sm:` la propiedad es **inerte**, porque la fila deja de ser
contenedor desplazable (`sm:overflow-visible`). Verificado a 768 px:
`overflow-x: visible`, nada que desplazar, ningún cambio de comportamiento.

**Dónde se sitúa exactamente.** Inmediatamente **encima de la rejilla**, en las
dos pantallas, sin excepción. Es lo que hace que las dos se sientan la misma
pantalla:

```
BranchBar                       (solo si la marca tiene 2+ sucursales — F-017, sin tocarlo)
Container
  StoreSearchBox                (F-021, sin tocarlo)
  <h1>                          «Catálogo»  |  «Bebidas»
  <p>                           descripción de la tienda  |  «7 productos en La Rampa · Vedado.»
  <nav aria-label="Categorías"> ← LA FILA, en las dos pantallas
  <ul class="grid …">           ← la rejilla del catálogo, clase por clase
```

Por qué debajo del `<h1>` y no encima: la fila gobierna la rejilla, no la
página. Ponerla entre el título y su lista la ata visualmente a lo que cambia
cuando se toca. Y por qué debajo de la caja de búsqueda: la caja es para quien
sabe qué quiere; la fila, para quien no. Ese es el orden en que se descarta.

---

## Decisión 2 — la tarjeta del catálogo **no** muestra el nombre de la categoría

La spec lo delegaba explícitamente. **No se muestra.** Cuatro razones, la
tercera es la que cierra el asunto:

1. **Densidad.** A 360 px la tarjeta ya apila imagen cuadrada, nombre a dos
   líneas, precio, «Antes …» cuando hay promoción y el `Badge` de
   disponibilidad, en una columna de 156 px. Una quinta línea en `text-xs`
   compite justo con el `Badge`, que sí es información que cambia la decisión.
2. **Es ruido puro en la mitad de los sitios donde aparecería.** En la vista de
   categoría, las catorce tarjetas repetirían la misma palabra que ya está en el
   `<h1>` y en el chip activo.
3. **No podría ser un enlace, y parecería uno.** `ProductCard` envuelve
   **todo** su contenido en un único `<Link>` a la ficha
   (`src/components/store/ProductCard.tsx`). Un `<a>` dentro de otro `<a>` es
   HTML inválido, así que el nombre de la categoría sería texto muerto con
   pinta de tocable dentro de una tarjeta tocable. Para hacerlo enlace habría
   que desmontar la tarjeta —sacar el enlace de la envoltura y ponerlo solo
   sobre la imagen y el nombre—, y eso es reimplementar el catálogo, que es
   exactamente lo que R4 prohíbe.
4. **El dato ya tiene su sitio.** La ficha del producto lo imprime
   (`src/app/[slug]/p/[productSlug]/page.tsx:190`), con espacio y sin competir
   con nada.

Consecuencia: `ProductCard` **no se toca en este feature**. Ni una línea.

Dónde sí pagaría, y no es mío: en `/[slug]/buscar`, donde los resultados vienen
mezclados de varias categorías y saber de cuál es cada uno sí informa. Es
pantalla de F-021 y no entra aquí.

---

## Inventario de pantallas y estados

### 1 · `/[slug]` — el catálogo, con un añadido y ni un cambio más

Se inserta la fila entre la descripción y la rejilla. **No se mueve nada más**:
ni `BranchBar`, ni la caja de búsqueda, ni el `<h1>`, ni las clases de la
rejilla, ni `ProductCard`, ni el vacío de «Esta tienda todavía no tiene
productos publicados».

| Estado                                                | Qué se ve                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Con productos y ≥1 categoría con stock visible        | La fila, con «Todo el catálogo» **primero y activo** (`aria-current="page"`) y una entrada por categoría, ordenadas por nombre. Debajo, la rejilla de siempre |
| **Tienda sin ningún producto**                        | **Sin fila.** El mensaje de vacío que ya existe, intacto                                                                                                      |
| **Con productos pero ninguno con categoría** (I4, E6) | **Sin fila.** Ni siquiera con el chip «Todo el catálogo» solo: un selector de una entrada que apunta a la página en la que ya estás es mobiliario             |
| Con una sola categoría con stock                      | **Sin fila.** Mismo argumento: «Todo el catálogo» + una categoría que contiene lo mismo no es una elección. Ver § Umbral, abajo                               |
| Tienda `SUSPENDED` (E11)                              | `StoreClosedNotice` y `BranchBar` como hoy. Sin fila y **sin consulta de catálogo**                                                                           |
| Modo selector de marca                                | Lista de sucursales como hoy. Sin fila (E10)                                                                                                                  |
| Base caída                                            | `src/app/error.tsx`, que ya está en el árbol. **Nunca una fila vacía disfrazada de «esta tienda no tiene categorías»**                                        |

**Umbral, y es solo de esta pantalla.** En `/[slug]` la fila se dibuja cuando hay
**dos o más** categorías con stock visible. Con una sola, la única navegación
posible es «todo» o «esa una», que en una tienda de una categoría son el mismo
conjunto. Esto **no** contradice R13 (que prohíbe paginar o truncar una lista que
sí se muestra): no se recorta ninguna lista, se decide que no hay lista que
mostrar. El criterio 1 —«un enlace por cada categoría con al menos un producto
visible»— se comprueba en `tienda-demo`, que tiene cuatro.

**El umbral NO se aplica en la vista de categoría**, que dibuja la fila
**siempre**, aunque el negocio tenga una sola categoría. Está escrito como regla
en § 2, aquí y en ningún otro sitio, porque es exactamente lo que el ciclo 1
dejó sin decir: `sdd-tester` lo levantó como **TP1** al ver que la
implementación había tenido que decidirlo sola. **Resuelto por el humano el
2026-08-31: la asimetría es correcta y se queda.**

### 2 · La vista por categoría (ruta por crear, resuelta en SP2)

Orden vertical idéntico al del catálogo, para que el comprador no tenga que
darse cuenta de que cambió de pantalla.

**Regla: la fila se dibuja SIEMPRE en esta pantalla**, cualesquiera que sean el
número de categorías del negocio. El umbral de dos o más de § 1 es **solo de
`/[slug]`**, y la asimetría es deliberada por dos motivos, los dos con los que
el humano la confirmó el 2026-08-31 al resolver **TP1**:

1. Aquí «Todo el catálogo» y la categoría en la que estás son **dos conjuntos
   distintos**, así que la fila ofrece una elección real. En `/[slug]` con una
   sola categoría los dos enlaces enseñan lo mismo, y eso no es una elección.
2. Aplicar el umbral aquí dejaría la vista de categoría **sin camino de vuelta
   visible**, y R6 exige que ese camino esté presente en toda vista de
   categoría, sin excepciones.

| Estado                                                     | Qué se ve                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal** (E2)                                            | `<h1>Bebidas</h1>`, la línea `7 productos en {tienda}.`, la fila con «Bebidas» activo, y la rejilla con `ProductCard` sin tocar, en el mismo orden que el catálogo (`featured` y luego nombre)                                |
| **El negocio tiene una sola categoría** (TP1)              | **La fila se dibuja igual.** El umbral de ≥2 categorías es **solo de `/[slug]`**: aquí «Todo el catálogo» y la categoría actual son dos conjuntos distintos, y quitarla dejaría la pantalla sin camino de vuelta visible (R6) |
| **Todos los productos agotados** (R3, caso límite)         | Idéntica. Aparecen los agotados **en su posición**, con su `Badge` `Agotado`, enlazando a su ficha, como ya hace `/[slug]`. **Ningún aviso extra**: el catálogo completo no lo pone, y ponerlo aquí sería inventar una regla  |
| **Producto sin precio resoluble**                          | `ProductCard` ya pinta `Consultar`. Heredado, cero trabajo                                                                                                                                                                    |
| **Producto con `priceOverride`** (E4)                      | El mismo precio que en `/[slug]`, carácter a carácter, porque es el mismo `ProductCard` sobre el mismo `CatalogProduct`                                                                                                       |
| **Vacía**                                                  | **No existe.** Una categoría sin producto visible en esta sucursal es 404 (E5, E9), nunca una página que confirme que la categoría existe. No hay estado vacío que diseñar, y es a propósito                                  |
| **Categoría inexistente, mal formada, o de otra sucursal** | 404 con **el marco de la tienda**: ver § El 404 de categoría, abajo (E9)                                                                                                                                                      |
| **Categoría borrada en el POS** (E8)                       | El mismo 404. Sus productos siguen en `/[slug]`, y el 404 lo dice con todas las letras y ofrece el enlace                                                                                                                     |
| **Categoría renombrada en el POS** (E7)                    | La misma URL, 200, y el `<h1>`, el `<title>` y el chip con el nombre nuevo                                                                                                                                                    |
| **Slug en modo selector** (E10)                            | 404. Sin marco de tienda: bajo una marca no hay sucursal cuya cabecera pintar, y sugerir que la marca tiene categorías sería mentir                                                                                           |
| **Tienda `SUSPENDED`** (E11)                               | `StoreClosedNotice` con `extraNote`, y `BranchBar` con `isOpen={false}`. **Sin fila, sin rejilla y sin consulta de catálogo**                                                                                                 |
| **Tienda `DRAFT` o slug inexistente** (E12)                | 404 del resolvedor de siempre                                                                                                                                                                                                 |
| **Base caída**                                             | `src/app/error.tsx`. Nunca «esta categoría no tiene nada»                                                                                                                                                                     |
| **Alias vivo de sucursal**                                 | Las dos URL responden 200. Todos los `href` que dibuja esta pantalla usan `canonicalSlug`, igual que `BranchBar`, y el `<link rel="canonical">` apunta a la canónica                                                          |
| **Cargando**                                               | Nada que diseñar y **sin `loading.tsx`**: la página es estática y la transición del enlace es de un salto. Un `Cargando…` que sustituye una página ya cacheada se vería más que la propia espera                              |
| **Sin permiso**                                            | No existe. El comprador es anónimo (`docs/adr/0016-escritura-publica-sin-sesion.md`)                                                                                                                                          |

### 3 · El 404 de categoría — con el marco de la tienda

Aquí **sí** hace falta un `not-found.tsx` propio en el segmento (por crear),
al contrario que en F-021, y por una diferencia concreta: allí los dos caminos a
404 eran «el slug no existe» y «el slug es una marca», y en ninguno de los dos
hay sucursal de la que pintar cabecera. Aquí la tienda **existe, está publicada
y el comprador está dentro de ella**: lo que falló es la categoría, casi siempre
porque el comerciante la borró en su POS (E8, I4) y alguien guardó el enlace.
Mandarlo al 404 global lo echa de la tienda, que es justo lo que R6 quiere
evitar. Es el mismo criterio que ya aplicó `src/app/[slug]/pedido/[code]/not-found.tsx`.

Como `not-found.tsx` no recibe `params` en Next, el enlace de salida es
**relativo**, la misma técnica que usa ese archivo (`href=".."` allí; `"../.."`
aquí, porque este segmento cuelga dos niveles). Está anotado como RD4 y como
paso de verificación V9, porque es exactamente el tipo de detalle que se
descubre roto en producción.

Contenido: `<h1>`, una frase que dice dónde están los productos, y el enlace.
Microcopy exacto en § Textos. La cabecera del `layout` **ya** enlaza al catálogo
con el nombre de la tienda, así que incluso si el enlace relativo fallara habría
una salida: R6 no cuelga de un solo hilo.

---

## Estructura por breakpoint

Móvil primero. `Container` da `mx-auto w-full max-w-6xl px-4 sm:px-6`: a 360 px
quedan 328 px útiles, y la fila los rompe a propósito con `-mx-4 px-4` para
sangrarse hasta los bordes de la pantalla (360 px de recorrido, y el chip que
asoma cae en el borde físico, no en el margen).

| Zona                       | 360                                                                                                                                                                                      | 768                                                                                                | 1280                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Fila de categorías**     | **Una sola fila desplazable**: `-mx-4 overflow-x-auto px-4 py-1` sobre un `<ul class="flex gap-2">`. Alto fijo **52 px**, entren 4 categorías o 40. Medido: 3 chips enteros + 1 asomando | **Envuelve** (`sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0`). 15 categorías = 3 filas, 148 px | Envuelve. 15 categorías = 2 filas, 96 px. **No** se centra ni se estira: alineada a la izquierda |
| **Chip**                   | `min-h-11` (44 px de toque), `px-3`, `text-sm`, `rounded-md`, `shrink-0`, `whitespace-nowrap`                                                                                            | Igual, `sm:whitespace-normal` para que un nombre patológico envuelva dentro del chip               | Igual                                                                                            |
| **Nombre largo**           | El chip **no se trunca nunca** (R13). A 360 px se desliza; el peor caso medido (266 px) cabe en el recorrido                                                                             | Si no cupiera en el ancho, envuelve dentro del chip y esa fila crece                               | Igual                                                                                            |
| **`<h1>` de la categoría** | `text-2xl font-semibold`, el mismo que `Catálogo`, con `break-words`                                                                                                                     | Igual                                                                                              | Igual                                                                                            |
| **Línea de conteo**        | `text-fg` debajo del `<h1>`, `mt-2`                                                                                                                                                      | Igual                                                                                              | Igual                                                                                            |
| **Rejilla**                | `mt-8 grid grid-cols-2 gap-4` — **idéntica a la del catálogo, clase por clase**, para que el `sizes` de las imágenes siga siendo correcto y no se descargue de más                       | `sm:grid-cols-3`                                                                                   | `lg:grid-cols-4`                                                                                 |
| **Caja de búsqueda**       | La de F-021, sin cambios                                                                                                                                                                 | Igual                                                                                              | Igual                                                                                            |
| **`BranchBar`**            | Como hoy, primer elemento, solo si la marca agrupa 2+ sucursales                                                                                                                         | Igual                                                                                              | Igual                                                                                            |
| **404 de categoría**       | Una columna centrada, `py-24`, como los dos `not-found` que ya existen                                                                                                                   | Igual                                                                                              | Igual                                                                                            |

**La regla que gobierna los tres anchos:** nada provoca scroll horizontal _de la
página_ —el desplazamiento vive dentro de la fila y solo a 360 px—, la rejilla
nunca deja de ser la rejilla del catálogo, y el coste vertical del selector en
el móvil es constante y conocido: 52 px más el `mt-6`.

---

## Componentes de UI

**Se reutilizan tal cual, sin tocar una línea:** `Container`, `Card`, `Badge`,
`ProductCard`, `BranchBar`, `StoreSearchBox`, `StoreClosedNotice`,
`ResponsiveImage`.

**Un componente nuevo**, de servidor, en `src/components/store/` (el nombre lo
pone `sdd-architect`; la forma, este documento):

| Pieza                                       | Qué hace                                                                                                                           | Por qué no alcanza lo que hay                                                                                                                                                                                                           | `"use client"`                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| La fila de categorías (por crear)           | El `<nav>` con su `aria-label`, el `<ul>`, el chip «Todo el catálogo» y uno por categoría, y la marca de activo por `aria-current` | No hay ningún componente de chip ni de fila desplazable en el repo. Y **lo montan dos páginas**: repetir estas líneas en las dos es cómo una de las dos pierde el `min-h-11`, el `aria-current` o el `py-1` que salva el anillo de foco | **No.** Es un `<ul>` de `<a>`               |
| La página de la categoría (por crear)       | Resuelve, consulta, 404 o pinta                                                                                                    | —                                                                                                                                                                                                                                       | **No.** Es catálogo: `AGENTS.md` lo prohíbe |
| El `not-found.tsx` del segmento (por crear) | El 404 con marco de tienda                                                                                                         | El global echa al comprador de la tienda                                                                                                                                                                                                | **No.** `not-found.tsx` es de servidor      |

**`Button` no se usa, y sí su vocabulario.** `Button` renderiza un `<button>` y
no tiene modo enlace; los chips son `<a>`. Se copia su pareja de clases, que es
la técnica que ya inventó F-021 con `SECONDARY_LINK_CLASSES` dentro de
`src/app/[slug]/buscar/page.tsx`. Que esa constante viva dentro de una página y
no en un módulo compartido es deuda conocida de F-021; **este feature no la
arrastra ni la arregla**: el componente nuevo declara sus propias clases, y si
alguien quiere unificar las dos, es un `refactor:` aparte.

**Clases propuestas al implementador** (orientativas; lo que es obligatorio es
lo que dicen § Tokens y § Accesibilidad):

```
<nav aria-label="Categorías"
     class="mt-6 -mx-4 overflow-x-auto px-4 py-1 scroll-px-[50%]
            sm:mx-0 sm:overflow-visible sm:px-0">
  <ul class="flex gap-2 sm:flex-wrap">
    <li class="shrink-0"> <a …> </li>
  </ul>
</nav>

chip, base    : inline-flex min-h-11 items-center rounded-md border px-3 text-sm
                whitespace-nowrap sm:whitespace-normal
                focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2
chip, inactivo: bg-surface-muted text-fg border-border font-medium hover:bg-surface
chip, activo  : bg-brand text-brand-contrast border-transparent font-semibold
                + aria-current="page"
```

El `py-1` **no es decorativo**: `overflow-x: auto` recorta también el eje
vertical, así que sin él el anillo de foco (`outline-offset-2`, 2 px de grosor)
se corta por arriba y por abajo dentro de la fila desplazable. 4 px de relleno
es exactamente lo que hace falta. Es el bug clásico de este patrón y por eso
está escrito aquí y no descubierto en revisión.

El `scroll-px-[50%]` **tampoco**: es lo que hace que el navegador arrastre a la
vista el chip que recibe el foco, y sin él V5 no pasa (§ El asomo tenía un
precio escondido). **Compilado y comprobado en este proyecto**: con la Tailwind 4
de aquí, `scroll-px-[50%]` produce exactamente `scroll-padding-inline: 50%`. Si
alguna vez dejara de hacerlo, la propiedad literal —`[scroll-padding-inline:50%]`
— dice lo mismo y `npm run check:theme` no se queja de ninguna de las dos (su
aviso es para un valor que sea una propiedad personalizada desnuda, no para un
porcentaje).

---

## Tokens y tema

**No hace falta ningún token nuevo.** Todo sale de `src/theme/tokens.css` tal
como está.

| Uso                     | Token / utilidad                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fondo del chip inactivo | `bg-surface-muted`, y `hover:bg-surface`                                                                                                                                                                    |
| Borde del chip          | `border-border`                                                                                                                                                                                             |
| Texto del chip inactivo | `text-fg`                                                                                                                                                                                                   |
| Chip activo             | `bg-brand text-brand-contrast` — la pareja de `Button` variante `primary`, sin tocar `Button`                                                                                                               |
| `<h1>` de la categoría  | `text-fg` (heredado del `body`), nunca `text-brand`                                                                                                                                                         |
| Línea de conteo         | `text-fg`                                                                                                                                                                                                   |
| Texto del 404           | `text-fg-muted` para la explicación, `text-brand` para el enlace, como los dos `not-found` que ya hay                                                                                                       |
| Esquinas del chip       | `rounded-md`. **Nunca** `rounded-[--radius-md]`, que es la sintaxis v3 que persigue `npm run check:theme`, y **nunca** `rounded-full`, que es un 9999 px fijo y se saltaría la escala `radius` de la tienda |
| Anillo de foco          | `focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2`, calcado de `Button`                                                                                                   |
| Sombra                  | Ninguna. Un chip no flota; `shadow-card` es de las tarjetas                                                                                                                                                 |
| Tipografía              | `font-sans` y la escala de Tailwind (`text-sm`, `text-2xl`). Sin tamaños arbitrarios                                                                                                                        |

**Cómo responde al branding por tienda.** La tienda solo redefine `brand`,
`brandContrast`, `accent`, `accentContrast` y la escala `radius`
(`src/features/theming/storeTheme.ts`). Comprobado contra `tienda-dos`
(`brand` verde, `radius: "round"`):

- El chip activo sale del color de la tienda, emparejado con su
  `brand-contrast`, igual que el botón `Buscar` y `Agregar al carrito`.
- Los chips se redondean solos: `rounded-md` resuelve a `var(--radius-md)`, que
  con `round` pasa de 0.625 rem a 1.25 rem y los deja casi cápsula. Verificado en
  captura.
- El `<h1>` y el conteo van en `text-fg`, **nunca** en `text-brand`. Es la misma
  decisión deliberada que dejó escrita F-021: `storeTheme.ts` valida que el
  color sea un color CSS, no que contraste, y una tienda con un `brand` casi
  blanco dejaría ilegible el texto que explica la pantalla.
- El `accent` no aparece en este feature. La franja `Destacado` de
  `ProductCard` lo sigue usando y no se toca.

---

## Accesibilidad

**Landmark y estructura.** `<nav aria-label="Categorías">` con un `<ul>` de
`<li>` y un `<a>` por entrada. Hay **uno solo por página**, así que el landmark
no se duplica.

**Por qué `<nav>` y no `role="tablist"`.** Un `tablist` promete paneles que se
intercambian en la misma página y foco por flechas. Aquí cada chip **navega a
otra URL**: anunciar pestañas sería mentirle al lector de pantalla, y las
flechas exigirían `"use client"`, que está prohibido en algo que renderiza
catálogo. Son enlaces y se anuncian como enlaces.

**Sin encabezado propio para la fila.** Nada de un `<h2 class="sr-only">`: el
`aria-label` del landmark ya la nombra, y un encabezado más entre «Catálogo» y
la rejilla ensucia el esquema sin añadir información. Lo que hace de etiqueta
visible es el **chip «Todo el catálogo» activo**: al ver que está marcado, se
entiende que los demás son partes de eso.

**Cómo se marca la categoría activa dentro de su propia vista.** Tres cosas a la
vez, y ninguna es solo color:

1. `aria-current="page"` en su `<a>`. Es lo que anuncia «página actual» y lo
   único que un lector de pantalla necesita.
2. Relleno en vez de contorno: fondo `bg-brand` frente a `bg-surface-muted` con
   borde. Es una diferencia de **forma**, no de tono.
3. `font-semibold` frente a `font-medium`.

Y por encima de las tres, el `<h1>` de la página **es** el nombre de la
categoría: quien no vea la fila —o quien la tenga desplazada a 360 px— sabe
dónde está por el titular, que es lo primero que se lee y lo primero que se
anuncia.

**El chip activo sigue siendo un enlace.** Recarga su propia página. Mantiene el
orden de tabulación uniforme y evita el salto de foco que produce sustituir un
`<a>` por un `<span>` entre una página y otra.

**Orden de foco** en la vista de categoría, que es el del DOM y no se reordena
con CSS: nombre de la tienda (cabecera) → enlace de `BranchBar`, si lo hay →
`Carrito` → `Cuenta` → campo de búsqueda → `Buscar` → **`Todo el catálogo` →
categoría 1 … categoría n** → tarjeta 1 … tarjeta n. Las categorías quedan antes
que los productos, que es el orden en que se decide.

**El desplazamiento a 360 px es accesible con teclado, pero NO «sin nada
añadido» — el ciclo 1 se equivocó aquí.** Los chips son enfocables y no hace
falta `tabindex` en el contenedor —WCAG 2.1.1 lo pide solo cuando el contenido
desplazable no tiene nada enfocable dentro, y añadirlo metería una parada de
tabulación vacía—. Lo que este documento daba por regalado y no lo era es el
**arrastre a la vista**: el navegador no mueve la fila si el chip enfocado ya
asomaba, que es justo el caso que este diseño provoca a propósito. Lo paga
`scroll-padding-inline: 50%` en el contenedor, y está explicado con sus
mediciones en § El asomo tenía un precio escondido. Sin esa línea, un usuario de
teclado enfoca un chip que se queda cortado por el borde de la pantalla; con
ella, el chip enfocado queda **siempre centrado**. Verificado hacia adelante con
`Tab` y hacia atrás con `Shift+Tab`, los 19 chips, sin un solo fallo.

**Anillo de foco, incluido el caso que se rompe solo.** `outline-offset-2` deja
el anillo **fuera** de la caja del chip, sobre el fondo de la página: por eso el
chip activo, que es `bg-brand`, no acaba con un anillo `brand` sobre `brand`
invisible. Contra `bg`, medido:

| Anillo `outline-brand` contra `bg` | Claro    | Oscuro   |
| ---------------------------------- | -------- | -------- |
| `tienda-demo` (marca por defecto)  | 4.83 : 1 | 3.84 : 1 |
| `tienda-dos` (marca verde)         | 3.32 : 1 | 5.59 : 1 |

Los cuatro superan el 3 : 1 que WCAG 1.4.11 pide a un indicador de foco. Y con
`gap-2` (8 px) entre chips, un anillo de 2 px a 2 px de distancia cabe sin
solaparse con el vecino.

**Contraste del texto, medido (no estimado), en las dos variantes de branding:**

| Pareja                                                    | Claro        | Oscuro       |
| --------------------------------------------------------- | ------------ | ------------ |
| Chip inactivo: `text-fg` sobre `bg-surface-muted`         | 15.84 : 1    | 13.87 : 1    |
| Chip activo `tienda-demo`: `brand-contrast` sobre `brand` | 4.84 : 1     | 4.84 : 1     |
| Chip activo `tienda-dos`: `brand-contrast` sobre `brand`  | **3.33 : 1** | **3.33 : 1** |
| Explicación del 404: `text-fg-muted` sobre `bg`           | 5.38 : 1     | 7.16 : 1     |

**Los 3.33 : 1 del chip activo en `tienda-dos` no pasan el 4.5 : 1 de AA para
texto de 14 px, y no se ocultan aquí.** Es un agujero **heredado, no nuevo**: la
misma pareja `bg-brand`/`text-brand-contrast` la usa hoy el botón `Buscar` (16
px, mismo 3.33 : 1) y `Agregar al carrito` en esa tienda, porque `storeTheme.ts`
valida que el valor sea un color CSS y no que contraste con su pareja. F-010 ya
lo anotó para un «F-016bis» y F-021 lo repitió como riesgo heredado. Lo que este
diseño hace es (a) no empeorarlo —el chip no es la única señal: el `<h1>` lleva
el nombre—, y (b) **subirlo como DP1**, porque la solución correcta es validar
el contraste al guardar la marca, no forkear el lenguaje visual en los chips.

**Área de toque.** Chip `min-h-11` (44 px) con `px-3`; `gap-2` (8 px) entre
chips, de modo que dos objetivos contiguos no se pisan. Las tarjetas ya son
enlaces de más de 200 px de alto.

**Nada se comunica solo por color.** El activo lleva `aria-current`, relleno y
peso. El agotado sigue siendo un `Badge` con la palabra `Agotado`.

**Idioma.** `lang="es"` lo pone el layout raíz. Los nombres de categoría son los
que manda el POS y se imprimen tal cual (React escapa): un nombre con comillas,
`&` o emoji no rompe nada ni necesita estado de error.

**Movimiento.** Ninguno. Sin transiciones propias, sin `scroll-snap` —con chips
de ancho variable el ajuste por saltos se siente errático—, y por tanto nada que
`prefers-reduced-motion` tenga que apagar.

---

## Coste de cliente

**Cero componentes de cliente. Cero.** Lo que este feature añade al navegador es
HTML.

| Pieza                              | Directiva | Por qué                                                                                |
| ---------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| La fila de categorías (por crear)  | **No**    | Un `<nav>` con un `<ul>` de `<a>`. Ni estado ni eventos                                |
| La página de categoría (por crear) | **No**    | Renderiza catálogo: `AGENTS.md` § Prohibiciones lo prohíbe explícitamente              |
| El `not-found.tsx` del segmento    | **No**    | `not-found.tsx` es un componente de servidor; solo `error.tsx` obliga a `"use client"` |
| `ProductCard`, la rejilla          | **No**    | Ya son de servidor y no se tocan                                                       |
| El desplazamiento horizontal a 360 | **No**    | `overflow-x: auto` es CSS. Ni un `onScroll`, ni un `scrollIntoView`, ni un observador  |

**Sin `error.tsx` propio en el segmento, y es importante.** En Next un
`error.tsx` **tiene** que llevar `"use client"`: ponerlo aquí metería un módulo
de cliente en un árbol que renderiza catálogo, exactamente lo que R9 y
`AGENTS.md` prohíben. El `src/app/error.tsx` que ya existe cubre la ruta desde
la raíz y no añade ni un byte.

**Sin `loading.tsx`.** Sería de servidor y por tanto gratis, pero la página es
estática: la espera real es un salto a la caché, y un `Cargando…` que reemplaza
una pantalla ya pintada se ve más de lo que dura.

**Sin `<noscript>`.** Con el JavaScript desactivado la pantalla es **la misma**:
la fila navega igual porque son `<a href>` y los nombres y precios están en el
HTML. Eso es E15 y el criterio 14, y no hay nada que explicarle a nadie.

**Prefetch: apagado en los chips.** Es la única decisión de coste de este
documento y va contra el valor por defecto. Un `next/link` a una ruta estática
se precarga al entrar en el viewport; con 15 categorías eso son **15 cargas
útiles de RSC** que nadie pidió, en la conexión que este producto tiene como
objetivo, para ahorrar una navegación que el CDN sirve en un viaje. Los chips se
dibujan con el prefetch desactivado (RD5). La rejilla no cambia: `ProductCard`
sigue como está.

**Presupuesto.** `node scripts/check-bundle-budget.mjs` tiene que seguir en 0
**sin tocar `BUDGET_KB`** —es el criterio 13—, y aquí no hay nada que pueda
crecer legítimamente: si sube, hay una regresión que investigar, no un número
que subir.

**Lo que se queda fuera por costar JavaScript, y no vuelve por la puerta de
atrás:** llevar la fila hasta el chip activo al cargar, un botón de flecha para
desplazarla, marcar el chip activo desde el cliente, filtrar la rejilla sin
navegar y cualquier animación de transición entre categorías. Los cinco
necesitan un módulo de cliente en una pantalla de catálogo. El sustituto de
todos ellos es el `<h1>`.

---

## Textos

Microcopy exacto, en español. `{tienda}` es `store.name` («La Rampa · Vedado»),
`{categoría}` el nombre tal como lo manda el POS, `{n}` el número de productos
visibles.

**La fila de categorías**

| Elemento              | Texto                                         |
| --------------------- | --------------------------------------------- |
| Etiqueta del landmark | `Categorías` (en `aria-label`, no visible)    |
| Primer chip, siempre  | `Todo el catálogo`                            |
| Chips siguientes      | `{categoría}`, tal cual, ordenados por nombre |

**Por qué `Todo el catálogo` y no `Todo`.** Medido: `Todo el catálogo` ocupa
136 px de los 360 de la fila a móvil, y `Todo` ocuparía unos 60 — la diferencia
es **un chip de categoría más visible sin deslizar**. Aun así gana el texto
largo, por dos razones: es el enlace que R6 obliga a tener siempre y no puede
depender de que se adivine a dónde lleva, y es **la misma frase que ya usa
`/[slug]/buscar`** («Ver todo el catálogo»). Una tercera manera de nombrar el
mismo destino es cómo un producto pierde su vocabulario. Queda anotado con su
número por si alguna vez se revisa.

**La vista de categoría**

| Elemento                       | Texto                                                            |
| ------------------------------ | ---------------------------------------------------------------- |
| `<h1>`                         | `{categoría}` — a secas, sin «Categoría:» ni comillas            |
| Línea bajo el `<h1>`, plural   | `{n} productos en {tienda}.`                                     |
| Línea bajo el `<h1>`, singular | `1 producto en {tienda}.`                                        |
| `<title>`                      | `{categoría} en {tienda}`                                        |
| `description`                  | `Mira los productos de {categoría} en {tienda} y haz tu pedido.` |
| `robots`                       | **Sin `noindex`.** La vista es indexable a propósito (R12)       |

**El 404 de categoría**

| Elemento    | Texto                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `<h1>`      | `Esta categoría ya no está`                                                                               |
| Explicación | `Puede que la tienda la haya quitado o que sus productos hayan cambiado de sitio. Siguen en el catálogo.` |
| Enlace      | `Ver todo el catálogo`                                                                                    |

La segunda frase es la que hace el trabajo: es literalmente lo que ocurre tras
un `CATEGORY`/`DELETE` (E8, I4), y evita que alguien crea que la tienda cerró o
que perdió sus productos.

**Tienda cerrada, en la vista de categoría**

| Elemento                           | Texto                                                             |
| ---------------------------------- | ----------------------------------------------------------------- |
| `extraNote` de `StoreClosedNotice` | `No se puede ver esta categoría mientras la tienda esté cerrada.` |

Calcado en forma del que ya usa `/[slug]/buscar` («No se puede buscar mientras
la tienda esté cerrada.»), a propósito.

**Textos que NO cambian**, y se listan para que nadie los reescriba: el vacío
del catálogo («Esta tienda todavía no tiene productos publicados.»), el
marcador de la caja de búsqueda, `Destacado`, `Agotado`, `Pocas unidades`,
`Consultar`, `Antes`, y todo `BranchBar`.

---

## Lo que este diseño le pide al arquitecto

Ocho requisitos concretos para `.agent/specs/F-026/architecture.md`. Están aquí
para que se concilien en el `plan.md`, no para que se descubran programando.

| #       | Requisito                                                                                                                                                                                                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RD1** | La lectura tiene que devolver, además de los productos, la lista para la fila: `{ slug, name }` por categoría, derivada **del mismo filtro de visibilidad** que el catálogo (R1, R3), ordenada por nombre con **colación española** (que «Ñ» y los acentos caigan donde un hispanohablante los busca). La necesitan **las dos** pantallas            |
| **RD2** | **No hace falta el conteo por categoría.** Los chips no llevan número, a propósito: a 360 px «(7)» ensancha cada chip y un número que solo cuenta lo visible invita a la pregunta «¿por qué 7 y no 9?». Si más adelante se quisieran, se pedirían entonces                                                                                           |
| **RD3** | La vista de categoría devuelve el **nombre** de la categoría (para el `<h1>`, el `<title>` y el chip activo) y sus productos en el **mismo tipo y el mismo orden** que `getStoreCatalog` (`CatalogProduct[]`, `featured` y luego nombre), para que la rejilla y `ProductCard` se reutilicen sin tocarlos (R4, E4)                                    |
| **RD4** | Cero productos visibles para un slug que resuelve ⇒ `notFound()`. **La vista de categoría no tiene estado vacío.** Y el `not-found.tsx` del segmento (por crear) no recibe `params` en Next: su enlace de salida ha de ser relativo (`"../.."`), como el de `src/app/[slug]/pedido/[code]/not-found.tsx`. Si eso no resuelve limpio, propón otra vía |
| **RD5** | Los chips se dibujan con `next/link` y **el prefetch desactivado** (§ Coste de cliente). El valor exacto de la propiedad, contra `node_modules/next/dist/docs/`, es tuyo: en Next 16 esa API cambió                                                                                                                                                  |
| **RD6** | La fila es **un solo componente** montado por las dos páginas, nunca por el `layout` (§ Flujo). Mismo argumento que F-021 escribió para `StoreSearchBox`                                                                                                                                                                                             |
| **RD7** | Todo `href` que dibuje esta pantalla usa `canonicalSlug`, como ya hace `BranchBar`. Un alias vivo sigue respondiendo 200 y el `<link rel="canonical">` apunta a la canónica                                                                                                                                                                          |
| **RD8** | La vista de categoría **no** lleva `robots: { index: false }` (R12), al revés que `/[slug]/buscar`. En `src/app/sitemap.ts` **no** entra: DP3 se resolvió en (b) el 2026-08-31. Indexable sí, entrada propia en el sitemap no                                                                                                                        |
| **RD9** | **Para quien implemente, añadido tras el fallo de V5:** el contenedor desplazable de la fila lleva `scroll-px-[50%]` (`scroll-padding-inline: 50%`), sin el cual el chip enfocado se queda cortado al tabular. Es una línea, es CSS, no cambia maquetación y no toca el asomo. Motivo y mediciones en § El asomo tenía un precio escondido           |

---

## Verificación visual

Qué mirar para dar el diseño por correcto. Con `npm run dev` **en un puerto que
sea de este checkout** (ver arriba: el 3000 estaba ocupado por otra copia del
repo) y la base de desarrollo, que trae 28 productos en 4 categorías bajo
`tienda-demo`.

| #       | Qué                                                                                                                                                                                                                                                                                                                                                                                                                                                | Dónde                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **V1**  | A 360 px la fila mide 52 px, y ese alto no cambia con el número de categorías. Con la fixture limpia se ven **enteros** `Todo el catálogo` (activo), `Alimentos` y `Aseo`; **`Bebidas` asoma cortada** (29 px de sus 79) **en el borde derecho de la pantalla, no en el margen**; y `Panadería` queda fuera, que es el sentido de que la fila se deslice                                                                                           | `/tienda-demo`                 |
| **V2**  | A 768 y 1280 px la fila envuelve y **no** hay barra de desplazamiento horizontal en ninguna parte                                                                                                                                                                                                                                                                                                                                                  | `/tienda-demo`                 |
| **V3**  | En la vista de «Bebidas»: el `<h1>` dice `Bebidas`, la línea de conteo cuadra con el número de tarjetas, y el chip `Bebidas` está relleno y con `aria-current="page"`                                                                                                                                                                                                                                                                              | vista de categoría             |
| **V4**  | La rejilla de la vista de categoría es **píxel a píxel** la del catálogo a los tres anchos: mismas columnas, mismo `gap`, misma tarjeta                                                                                                                                                                                                                                                                                                            | los dos                        |
| **V5a** | Con el teclado, el orden: `Tab` recorre búsqueda → `Buscar` → `Todo el catálogo` → las categorías en el orden de la fila → tarjetas, sin parada vacía, y el anillo de foco se ve **entero** en cada chip, incluido el activo (el `py-1` es lo que lo salva del recorte de `overflow-x`)                                                                                                                                                            | `/tienda-demo` y una categoría |
| **V5b** | Con el teclado, el arrastre: a 360 px, **cada chip enfocado queda entero dentro de la ventana**, hacia adelante con `Tab` y hacia atrás con `Shift+Tab`. Es lo que compra `scroll-padding-inline: 50%`, y sin esa línea V5b falla en el chip que asoma. **Excepción aceptada por escrito:** un chip más ancho que el scrollport (≈45 caracteres a 360 px) no puede caber entero; ahí lo exigible es que se vea su inicio y su anillo, no que quepa | `/tienda-demo` y una categoría |
| **V6**  | En `tienda-dos` (marca verde, `radius: "round"`), los chips salen casi cápsula y el activo sale verde. En oscuro los inactivos siguen distinguiéndose del fondo                                                                                                                                                                                                                                                                                    | `/tienda-dos`                  |
| **V7**  | Con el JavaScript desactivado, tocar un chip carga la vista con sus productos en el HTML (criterio 14)                                                                                                                                                                                                                                                                                                                                             | `/tienda-demo`                 |
| **V8**  | Una tienda `SUSPENDED` no dibuja fila, ni en el catálogo ni en la vista de categoría                                                                                                                                                                                                                                                                                                                                                               | tienda cerrada                 |
| **V9**  | El 404 de categoría conserva la cabecera de la tienda y **su enlace lleva a `/tienda-demo`** (con o sin redirección 308). Es el punto frágil de RD4                                                                                                                                                                                                                                                                                                | una categoría inventada        |
| **V10** | Con 15 categorías sembradas a mano, a 360 px la fila sigue midiendo 52 px y la primera fila de productos sigue viéndose sin bajar                                                                                                                                                                                                                                                                                                                  | `/tienda-demo`                 |
| **V11** | Una tienda cuyos productos no tienen categoría no dibuja fila **ninguna**, ni con un solo chip                                                                                                                                                                                                                                                                                                                                                     | tienda sin categorías          |

---

## Preguntas al humano

Tres, las tres **RESUELTAS por el humano el 2026-08-31**. Se quedan escritas con
sus opciones, como `spec.md` hizo con SP1–SP4: la pregunta y las alternativas
descartadas son la mitad del valor de la respuesta, y este documento es el que
sobrevive al cierre del feature.

**DP1 — El chip activo de una tienda con marca propia mide 3.33 : 1, por debajo
del 4.5 : 1 de AA. ¿Se acepta como deuda heredada o se cambia el chip?
RESUELTA por el humano el 2026-08-31: opción (a).**

Medido sobre `tienda-dos` (`brand` verde, `brandContrast` por defecto casi
blanco). No es un problema que cree este feature: la misma pareja la usan hoy el
botón `Buscar` y `Agregar al carrito` en esa tienda, porque
`src/features/theming/storeTheme.ts` valida que el valor sea un color CSS y no
que contraste con su pareja.

- **(a) Aceptarlo aquí y abrir el arreglo donde está el problema** — el chip
  usa `bg-brand`/`text-brand-contrast` como todo lo demás, y se abre un feature
  que valide el contraste al guardar la marca (el «F-016bis» que F-010 ya
  anotó y F-021 repitió). **Recomendada:** arregla de una vez el botón `Buscar`,
  que es peor porque todo el mundo lo toca, en vez de dejar un chip distinto a
  todo lo demás.
- (b) Chip activo con borde de marca y fondo `bg-brand/10`, texto en `text-fg`
  (nunca baja de 13 : 1). Contrasta siempre, pero inventa un segundo lenguaje de
  «seleccionado» que compite con el `primary` de `Button`.
- (c) Calcular `brandContrast` en vez de dejar que la tienda lo mande. Es un
  cambio de producto y de datos, no de esta pantalla.

**Lo resuelto, para quien lea esto dentro de un año:** el chip activo se queda
con `bg-brand`/`text-brand-contrast`, igual que `Button` variante `primary`, y
**no se forkea el lenguaje visual** para salvar un chip. El 3.33 : 1 sigue ahí y
sigue siendo de quien lo causa: `src/features/theming/storeTheme.ts`, que valida
que el valor sea un color CSS y no que contraste con su pareja. El arreglo va a
la raíz, en **un feature aparte que valida el contraste al guardar la marca** y
que abre el humano — el mismo que arregla de paso el botón `Buscar` y
`Agregar al carrito`, que hoy fallan igual y los toca todo el mundo. Nada de
esto es deuda de F-026: es deuda de F-016 que F-026 midió.

**DP2 — En la ficha de producto, el nombre de la categoría es texto plano
(`src/app/[slug]/p/[productSlug]/page.tsx:190`). ¿Se convierte en enlace a la
vista de la categoría en este ciclo? RESUELTA por el humano el 2026-08-31:
opción (a).**

- **(a) Sí.** Una línea, cero JavaScript, y cierra el círculo
  catálogo → categoría → producto → categoría, que es lo que hace que la
  navegación se sienta un sistema y no una pantalla suelta. **Recomendada.**
- (b) No: dejarlo a F-025, que es dueño de las migas de pan y va a querer
  nombrar ese mismo nivel (tienda › categoría › producto).

El riesgo de (a) es pisar a F-025; el de (b), que este feature entregue el nivel
intermedio y nadie lo use hasta que F-025 se construya. Si se elige (a), la
frontera sigue siendo clara: **un enlace, no unas migas**.

**Lo resuelto:** sí, y **ya está implementado** — el nombre de la categoría en la
ficha enlaza a su vista. La frontera se respetó: **un enlace, no unas migas**;
las migas siguen siendo de F-025.

**DP3 — ¿Entran las vistas de categoría en `src/app/sitemap.ts`? RESUELTA por el
humano el 2026-08-31: opción (b) — NO entran.**

R12 dice que la vista es indexable, y el `sitemap.ts` de hoy lista una URL por
sucursal.

- **(a) Sí**, una URL por tienda × categoría. **Recomendada:** es contenido
  estable con nombre propio, y es la mitad del valor de haber elegido una ruta
  propia en SP2. Con los datos de hoy son 4 URL más por tienda.
- (b) No: que el rastreador las descubra siguiendo la fila. Más barato de
  construir, más lento de indexar, y deja el sitemap contando una historia
  incompleta de la tienda.

Coste de (a), para el arquitecto: `sitemap.ts` necesita las categorías con stock
de cada tienda, y hoy solo pide los slugs canónicos.

**Lo resuelto:** las vistas de categoría **no** entran en `src/app/sitemap.ts`.
`sitemap.ts` sigue listando una URL por sucursal y nada más, y no necesita
conocer las categorías de nadie. Ojo con lo que esto **no** significa: la vista
sigue siendo **indexable** (R12, RD8), sin `robots: { index: false }`; lo que se
decide aquí es únicamente que se descubre siguiendo la fila de enlaces desde
`/[slug]`, no por una entrada propia en el sitemap. Si alguna vez se revisa, lo
que cambia es `sitemap.ts`, no esta pantalla.
