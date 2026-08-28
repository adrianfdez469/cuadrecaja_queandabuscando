---
feature: F-021
agente: sdd-designer
actualizado: 2026-08-28T13:10:12Z
estado: listo
---

> **Ciclo 1, cerrado.** Se escribió en paralelo con `sdd-architect` y ahora está
> **conciliado con `.agent/specs/F-021/architecture.md`** (`estado: listo`). No
> queda ninguna pregunta abierta.
>
> **DP1 — RESUELTA (2026-08-28, el humano).** Respuesta literal: **«Dos bloques
> (Recomendado)»**. Lo que casó por texto —capa léxica y capa difusa **juntas**,
> sin distinguirlas— va arriba; debajo, separado, «Otros productos de la misma
> categoría». Está escrito así en § Inventario, § Estructura por breakpoint,
> § Accesibilidad y § Textos, y **no se vuelve a preguntar**.
>
> **A1–A5 conciliados con el arquitecto**, con dos ajustes que ya están
> aplicados en todo el documento y no solo en la tabla:
>
> - **A3 se recorta.** El contrato da `totalCount` (el total de las tres capas
>   antes de paginar) pero **no un contador por capa**. Se cae la línea de conteo
>   partida que este documento traía en el ciclo 1
>   (`3 productos coinciden. Más abajo, 44 de la misma categoría.`): ahora hay
>   **un solo número, el total**, y los bloques no llevan cifra. Ver § Textos y
>   § Por qué los bloques no llevan número.
> - **A5 cambia de forma.** La paginación es por **número de página** (`?p=`,
>   base 1, acotada a `[1, STORE_SEARCH_MAX_PAGE]` con `clampSearchPage`), no por
>   desplazamiento. De ahí sale un estado nuevo que el ciclo 1 no tenía:
>   **página fuera de rango**.
>
> Lo demás del contrato confirma lo que ya estaba diseñado: `StoreSearchItem` es
> `CatalogProduct & { layer }` (A2), el tope por página es 24 (A4), la capa 3 se
> siembra desde lo que casó por texto (A1), y **no hay resaltado ni snippet** —
> el arquitecto recomienda no marcar la coincidencia en este ciclo y **este
> diseño no la marca**.

## Qué se miró antes de diseñar

`AGENTS.md` entero (§ Arquitectura, § Prohibiciones —en especial la de
`"use client"` en cualquier cosa que renderice catálogo—, § El presupuesto de
JavaScript no es un muro, § Cosas que muerden, § Idioma),
`.agent/specs/F-021/spec.md` completa (E1–E18, R1–R17, la tabla de casos límite,
los 9 criterios literales y los 3 `[nuevo]`), `.agent/progress/F-021.md`, y el
código de `src/app/[slug]/page.tsx`, `src/app/[slug]/layout.tsx`,
`src/app/[slug]/p/[productSlug]/page.tsx`, `src/app/[slug]/sucursales/page.tsx`,
`src/components/store/ProductCard.tsx`, `src/components/store/BranchBar.tsx`,
`src/components/store/StoreClosedNotice.tsx`, los ocho primitivos de
`src/components/ui/`, `src/theme/tokens.css`, `src/app/globals.css`,
`src/features/theming/storeTheme.ts`, `src/lib/searchTerm.ts`,
`src/lib/availability.ts`, `src/constants/marketplace.ts` y
`src/app/error.tsx`.

**Esta vez sí se miró la pantalla, y en los tres anchos.** Levanté
`npm run dev` contra el Postgres de `docker-compose.yml` y abrí las páginas
reales. La extensión de Chrome sí está conectada, pero no consigue redimensionar
la ventana (devuelve éxito y el viewport se queda en 1485 px), así que los
anchos de verdad los saqué con Playwright —que ya está instalado, es lo que usa
`.agent/templates/visual.mjs`— capturando `/tienda-demo` y `/tienda-dos` a 360,
768 y 1280 en tema claro, y a 1485 en oscuro por la extensión.

Lo que se ve hoy, y que este diseño no puede contradecir:

- **360 px:** cabecera `bg-brand` con el nombre de la tienda a la izquierda y
  `Carrito` a la derecha; la ciudad desaparece (`hidden sm:inline`). Debajo,
  `Catálogo` en `text-2xl font-semibold`, la descripción en `text-fg-muted`, y
  la rejilla de **dos columnas** con `gap-4`. Nada hace scroll horizontal.
- **768 px:** tres columnas. **1280 px:** cuatro. Es exactamente
  `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` de `src/app/[slug]/page.tsx:147`.
- **La marca cae de verdad.** `tienda-dos` (`themeTokens` con `brand` verde,
  `accent` rojo y `radius: "round"`) pinta la cabecera verde, el precio verde y
  las tarjetas con esquinas de 2 rem. `tienda-demo` (sin `themeTokens`) sale
  azul y con esquinas de 1 rem. La tira `Destacado` usa `accent`.
- **La tarjeta es el lenguaje visual del catálogo:** cuadrado de imagen
  `aspect-square` sobre `bg-surface-muted` (o el texto `Sin imagen`), nombre en
  `text-sm font-medium line-clamp-2`, precio en `text-brand text-base` y
  `font-semibold`, y `Badge` de disponibilidad solo cuando no es `AVAILABLE`
  (`Agotado` en `muted`, `Pocas unidades` en `warning`). Verificado con
  `Chocolate en barra` de `tienda-dos`, que sale agotado y **sigue siendo un
  enlace a su ficha**.

La consecuencia de diseño más importante de todo lo anterior está en una línea:
**la página de resultados reutiliza `ProductCard` y la misma rejilla, sin tocar
ninguno de los dos.** Si el comprador tiene que darse cuenta de que cambió de
pantalla, el diseño falló.

---

## Supuestos sobre la lectura — conciliados con `architecture.md`

Los cinco supuestos del ciclo 1, con lo que respondió el contrato. **Ninguno
queda abierto.** Los dos que cambiaron están aplicados en todo el documento, no
solo en esta tabla.

| #      | Lo que supuse                                                                                       | Veredicto del contrato                                                                                                                                                                                                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | La capa 3 se siembra desde la categoría de lo que casó en las capas 1–2, así que nunca aparece sola | **Confirmado.** En el SQL de la lectura, la subconsulta de categorías sale de la unión de las capas 1 y 2. Cero por texto es cero total, y el bloque «Otros productos de la misma categoría» **no existe sin bloque 1**. Además la capa 3 está topada aparte (`STORE_SEARCH_EXPANSION_MAX = 24`): es contexto, no puede inundar la pantalla. |
| **A2** | La lectura devuelve lo mismo que `getStoreCatalog`                                                  | **Confirmado, y mejor de lo que pedí:** `StoreSearchItem = CatalogProduct & { layer }`, el tipo exacto que `ProductCard` ya pinta. No hay una segunda manera de calcular el precio, así que el riesgo que me preocupaba —el mismo producto con dos precios en dos pantallas— no puede ocurrir por construcción.                              |
| **A3** | Total de la consulta **y** contador por capa                                                        | **A medias.** Hay `totalCount` (las tres capas, antes de paginar: es lo que se registra) y hay `layer` por producto, que es lo que necesitan los dos bloques. **No hay contador por capa.** Consecuencia aplicada: un solo número en pantalla, el total, y los bloques sin cifra. Ver § Por qué los bloques no llevan número.                |
| **A4** | Tope por página múltiplo de 12, recomendado 24                                                      | **Confirmado:** `STORE_SEARCH_PAGE_SIZE = 24`. La última fila encaja exacta a 2, 3 y 4 columnas.                                                                                                                                                                                                                                             |
| **A5** | `q` + `desde` (desplazamiento, base 0)                                                              | **Cambiado a mejor:** `q` + **`p`**, número de página en base 1, acotado a `[1, STORE_SEARCH_MAX_PAGE]` (50) con `clampSearchPage`. Sigue siendo legible y escribible a mano, que era lo que pedía. Trae un estado nuevo: `?p=9` con dos páginas de resultados es una página **vacía pero no «sin resultados»**. Diseñado abajo.             |

Dos cosas más del contrato que este diseño acata:

- **No hay resaltado ni snippet** de la coincidencia dentro del nombre. El
  arquitecto lo desaconseja en este ciclo y aquí no se marca nada: la tarjeta de
  resultado es `ProductCard` **exactamente igual** que en el catálogo.
- El componente de lista vive en src/components/store/StoreSearchResults.tsx
  (etapa 5, por crear) y la página en src/app/[slug]/buscar/page.tsx (etapa 5,
  por crear). La lectura es `searchStoreProducts` en
  src/features/catalog/server/search.ts (etapa 4, por crear).

---

## Flujo de usuario

En una frase: **el comprador entra por el QR a `/[slug]`, tiene la caja de
búsqueda antes que el catálogo, escribe, pulsa `Buscar`, el navegador hace un
`GET` a /[slug]/buscar?q=… (por crear) y el servidor le devuelve una página
entera de resultados que se lee sin esperar a ningún JavaScript.**

```
QR / enlace
   ▼
/[slug]                       ← catálogo. La caja es lo primero del contenido
   │  <form method="get" action="/[slug]/buscar">   ── sin JS, navegación dura
   ▼
/[slug]/buscar?q=coca+cola    ← página propia, servidor, dinámica (R15)
   │  ├─ con resultados  → rejilla idéntica a la del catálogo
   │  ├─ sin resultados  → vacío explicado + la caja con el término dentro
   │  └─ q vacía/basura  → la caja con su ayuda, y NINGUNA consulta (E10)
   │
   ├─ «Página siguiente» → /[slug]/buscar?q=coca+cola&p=2        (E15)
   ├─ toca una tarjeta   → /[slug]/p/[productSlug]  ← desde ahí, la caja sigue ahí
   └─ «Ver todo el catálogo» → /[slug]
```

**Vueltas atrás y qué se pierde.**

| Desde → hacia                                   | Qué se conserva                                                                                                    | Qué se pierde                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Resultados → catálogo (botón atrás o el enlace) | El carrito, intacto. La búsqueda queda en el historial: volver adelante la repite tal cual                         | Nada                                                                                                                         |
| Ficha → resultados (botón atrás)                | **Los resultados y la página en la que estaba**, porque la URL los contiene enteros                                | Nada. Esto es la razón principal de que la consulta viaje en la URL y no en un `POST`                                        |
| Página 2 → página 1                             | Todo                                                                                                               | Nada                                                                                                                         |
| Resultados → resultados (otra búsqueda)         | El término anterior queda en el historial y en el autocompletado nativo del navegador                              | Nada                                                                                                                         |
| Compartir la URL por WhatsApp                   | **Todo**: quien la abre ve la misma búsqueda. Es gratis por ser un `GET`, y es lo que un `POST` nos habría quitado | Nada                                                                                                                         |
| Búsqueda en la tienda A → tienda B              | Cada tienda tiene su URL y su caja. No hay estado compartido                                                       | El término no se arrastra de una tienda a otra, **a propósito**: R6 dice que la búsqueda no cruza tiendas, ni en la interfaz |

**No hay punto de no retorno.** Buscar no escribe nada que el comprador vea; la
fila del registro (R4) es invisible para él y no cambia ninguna pantalla.

**Dónde vive la caja, y por qué no en el `layout`.** La cabecera de
`src/app/[slug]/layout.tsx` es compartida por `/carrito`, `/checkout`,
`/pedido/[code]`, `/sucursales` y el modo selector. Meter la caja ahí la pondría
en el checkout —F-010 ya decidió que ofrecer «cambiar de sucursal» a dos campos
de pagar empuja a abandonar, y «buscar otra cosa» es peor— y en el selector,
donde /[slug]/buscar (por crear) es 404 (E13): un formulario que lleva a un 404
es un defecto. Además, un `layout` de servidor no puede saber en qué ruta está
sin JavaScript de cliente.

Así que la caja se coloca **por página**, exactamente como ya se coloca
`BranchBar` (`src/components/store/BranchBar.tsx`, que las páginas montan y el
`layout` no). Está en las **tres pantallas de mirar** y en ninguna más:

| Pantalla                                     | ¿Caja? | Por qué                                                                                              |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `/[slug]` en modo sucursal y `PUBLISHED`     | **Sí** | Es la puerta. Primer elemento del contenido                                                          |
| /[slug]/buscar (por crear)                   | **Sí** | Rebuscar sin volver atrás es la mitad del valor de la pantalla                                       |
| `/[slug]/p/[productSlug]` con tienda abierta | **Sí** | Quien llega por un enlace directo o desde el buscador de Google no debería tener que subir a la raíz |
| `/[slug]` en modo selector                   | No     | E13: la marca no tiene buscador. Un formulario aquí llevaría a un 404                                |
| Tienda `SUSPENDED` (cualquiera de las tres)  | No     | E14: no se ejecuta ninguna consulta de catálogo. Una caja que no busca es peor que no tener caja     |
| `/carrito`, `/checkout`, `/pedido/[code]`    | No     | Sacar a alguien del pago para buscar otra cosa es sabotearle el pedido                               |
| `/sucursales`                                | No     | Pantalla de tránsito, `noindex`, una sola decisión                                                   |

**Coste asumido a propósito:** en la ficha de producto la caja empuja la imagen
unos 64 px hacia abajo a 360 px. A cambio, la búsqueda deja de ser un sitio al
que hay que volver. Si al mirarlo en pantalla (paso V8) resulta intolerable, la
alternativa —quitarla solo de la ficha— no toca nada más de este documento.

**El `action` usa siempre el slug canónico** (`store.canonicalSlug`), igual que
hace hoy `BranchBar` con `/sucursales`. Un alias vivo (R22 de F-011) sigue
respondiendo 200 en su propia URL; al buscar, el comprador aterriza en la
canónica, que es la que queremos que comparta.

---

## Inventario de pantallas y estados

### 0 · La caja de búsqueda — el mismo componente en las tres pantallas

Componente nuevo de servidor, sin directiva: StoreSearchBox (por crear, en
`src/components/store/`). Recibe `storeSlug`, `storeName` y, opcionalmente,
`term` y `autoFocus`.

```
<form method="get" action="/tienda-demo/buscar" role="search"
      aria-label="Buscar en La Rampa · Vedado">
  <label for="q" class="sr-only">Buscar productos en La Rampa · Vedado</label>
  <input id="q" name="q" type="search" enterkeyhint="search"
         maxlength="{MAX}" value="{term}" placeholder="Buscar en la tienda" />
  <button type="submit">Buscar</button>
</form>
```

Cinco decisiones dentro de esas seis líneas:

1. **`type="search"`, no `type="text"`.** Regala la ✕ de borrar de iOS y
   Android, y el teclado del móvil trae la tecla de lupa. Cero JavaScript.
2. **`enterkeyhint="search"`** para que esa tecla diga «buscar» y no «ir».
3. **Sin `autocomplete="off"`.** El historial de envíos del propio navegador es
   un autocompletado gratis, del lado del cliente y sin una sola consulta.
   `spec.md` § Fuera excluye **nuestro** autocompletado, no el suyo.
4. **Sin `required`.** Bloquear el envío vacío en el navegador solo cubre uno de
   los tres casos de E10 —quedan los espacios y la puntuación, y la URL escrita
   a mano—, así que la pantalla de servidor hay que diseñarla igual; y a cambio
   deja un formulario que en algunos móviles no hace nada visible al pulsar
   `Buscar`, que es justo el callejón sin salida que queremos evitar.
5. **`maxlength` = el máximo del término** (hoy
   `MARKETPLACE_SEARCH_TERM_MAX_LENGTH`, ver I7). Evita que 5 000 caracteres
   salgan del teléfono. **No sustituye a E11**: la URL escrita a mano sigue
   llegando larga y el servidor sigue truncando.

**Ayuda bajo la caja**, en `text-fg-muted text-sm`: solo en /[slug]/buscar
(por crear) —en el catálogo sería ruido sobre una pantalla que ya se explica
sola—. Texto exacto en § Textos.

### 1 · `/[slug]` — el catálogo, con un añadido y ni un cambio más

La caja se inserta como **primer hijo del `Container`**, encima de
`<h1>Catálogo</h1>`. Nada más de la página se mueve: ni la rejilla, ni las
tarjetas, ni `BranchBar`, ni el vacío de «Esta tienda todavía no tiene productos
publicados».

Estados: los de hoy. La tienda cerrada y el modo selector ya devuelven antes, y
por ahí la caja no se renderiza.

### 2 · /[slug]/buscar (por crear) — la pantalla nueva

Orden vertical, idéntico en los tres estados para que la pantalla sea
predecible: `BranchBar` (solo si la marca tiene 2+ sucursales, como en el
catálogo) → caja → `<h1>` → línea de conteo o de explicación → contenido.

| Estado                                                     | Qué se ve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Con resultados** (E1, E2, E2b, E4)                       | `<h1>Resultados para «coca cola»</h1>`, la línea de conteo con **el total**, y la rejilla en **dos bloques** (DP1, respuesta del humano): **bloque 1** con todo lo de `layer` 1 y 2 —léxica y difusa **sin distinguirse entre sí**— y sin encabezado visible (lo lleva el `<h1>`); **bloque 2** con lo de `layer` 3, separado por `border-t`, con `<h2>Otros productos de la misma categoría</h2>` y su subtítulo. Las tarjetas son `ProductCard` sin tocar, sin resaltado y sin insignia de capa. |
| **Con resultados, sin capa 3** (caso límite)               | Solo el bloque 1. El bloque 2 **no se renderiza**: ni el `<h2>`, ni el subtítulo, ni el `border-t`, ni una frase del tipo «no hay relacionados». La vista lo decide contando `items.filter(i => i.layer === 3)` de **esta** página; no asume que la tercera sección exista. Es el caso normal en una tienda sin `GlobalCategory` ni `LocalCategory`, y el arquitecto lo subraya.                                                                                                                   |
| **Producto agotado entre los resultados** (E6)             | Aparece **en su posición**, con su `Badge` `Agotado` y enlazando a su ficha, exactamente como en el catálogo. **La disponibilidad no reordena nada**: R10 fija el orden total en capa · puntuación · nombre · identificador, y `availability` no está en esa lista (R7). Hundir los agotados sería inventarse una regla que la spec no tiene.                                                                                                                                                      |
| **Producto sin precio resoluble**                          | `ProductCard` ya pinta `Consultar`. Heredado, sin trabajo.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Sin resultados** (E5)                                    | `<h1>Sin resultados para «xyz»</h1>`, la frase, tres consejos en `<ul>`, y `Ver todo el catálogo`. **La caja sigue arriba con el término dentro**, que es lo que convierte el vacío en un reintento de una sola edición. Tono `muted`, nunca `danger`: no encontrar no es un error. La fila del registro se escribe igual y no se ve.                                                                                                                                                              |
| **Consulta vacía / solo espacios / solo puntuación** (E10) | `<h1>Buscar en la tienda</h1>`, la caja **con el foco puesto**, la ayuda, y `Ver todo el catálogo`. Si la `q` venía en la URL pero no dejaba ninguna letra ni dígito, una línea `muted` lo dice. **Sin consulta y sin fila de registro.**                                                                                                                                                                                                                                                          |
| **Término truncado** (E11)                                 | Como «con resultados» o «sin resultados» según toque, más una línea `text-fg-muted text-sm` bajo el conteo. El `<h1>` y el `value` del input muestran **`StoreSearchResult.term`** —el término ya normalizado y truncado, que el contrato devuelve justo para esto—, no los 5 000 caracteres: si no, el encabezado revienta la maquetación y el reintento vuelve a mandar el bloque entero. Que hubo truncado se sabe comparando la `q` recortada con ese `term`.                                  |
| **Término con `&`, `\|`, `!`, `:*`, comillas** (E12)       | Nada especial: la pantalla es la de «con resultados» o la de «sin resultados». El `<h1>` lo imprime tal cual (React escapa). **No hay estado de error**, que es precisamente lo que R8 compra.                                                                                                                                                                                                                                                                                                     |
| **Página 2 y siguientes** (E15)                            | Igual, más la línea `Resultados 25 a 48 de 61.` y la navegación. Si en esa página **solo** hay productos de capa 3, se renderiza solo el bloque 2 con su `<h2>`; el `<h1>` y el conteo de arriba mantienen el contexto. Es lo **normal** en una búsqueda larga: la capa 3 va topada a 24 y siempre al final, así que el bloque 2 casi siempre cae en la última página.                                                                                                                             |
| **Página fuera de rango** (`?p=9` con 2 páginas)           | **No es «sin resultados» y no puede parecerlo.** `clampSearchPage` acota `p` a `[1, 50]`, así que la página existe y responde 200, pero `items` viene vacío con `totalCount > 0`. Se ve: el `<h1>` de siempre, la línea de conteo con el total, y un `Alert tone="muted"` con `Esta página ya no tiene resultados.` más el enlace `Volver a la primera página`. Sin rejilla y sin los consejos del vacío: no hay nada que corregir en el término.                                                  |
| **Tienda `SUSPENDED`** (E14)                               | `StoreClosedNotice` idéntico al de `/[slug]`, con `extraNote`, y `BranchBar` con `isOpen={false}`. **Sin caja, sin rejilla y sin consulta.**                                                                                                                                                                                                                                                                                                                                                       |
| **Slug en modo selector** (E13)                            | 404 por el `not-found` global. Ver abajo por qué no lleva uno propio.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Slug inexistente o `DRAFT`**                             | 404, por el resolvedor de siempre.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Base caída** (E17)                                       | La consulta lanza y salta `src/app/error.tsx`: `Algo salió mal` + `Reintentar`. **Nunca una lista vacía.** Ver § Coste de cliente sobre por qué no hay un `error.tsx` propio.                                                                                                                                                                                                                                                                                                                      |
| **Fallo al registrar** (E16)                               | **Ningún estado.** El comprador ve sus resultados y no se entera. Diseñar un aviso aquí sería contarle un problema nuestro.                                                                                                                                                                                                                                                                                                                                                                        |
| **Cargando**                                               | Con un `<form method="get">` la navegación es dura: la carga la pinta el navegador y no hay nada que diseñar. La **paginación** sí usa `next/link`, así que la transición es de cliente: para eso, loading.tsx (por crear) en el segmento, **componente de servidor**, con la caja y `Buscando…`. Ver § Coste de cliente.                                                                                                                                                                          |
| **Sin permiso**                                            | No existe. F-021 no tiene sesión: el comprador es anónimo (`docs/adr/0016-escritura-publica-sin-sesion.md`).                                                                                                                                                                                                                                                                                                                                                                                       |

**Por qué los bloques no llevan número.** El contrato da `totalCount` —las tres
capas juntas, antes de paginar— y `layer` por producto, pero **no un contador por
capa**. Derivarlo contando `items` solo cuenta **esta** página: en una búsqueda de
tres páginas, «3 coincidencias» en la página 1 y «24 coincidencias» en la página 2
serían dos afirmaciones distintas sobre lo mismo, y las dos falsas. Un número que
cambia de significado al pasar de página es peor que ningún número. Así que:

- **Un solo número en pantalla, el total**, junto al `<h1>`: `47 resultados en
{tienda}.`
- **Los encabezados de bloque no llevan cifra.** «Otros productos de la misma
  categoría» dice qué son; cuántos son se ve.
- Ese total es **exactamente** el `resultCount` que se registra (R4, R5). Lo que
  ve el comprador y lo que verá el comerciante en su registro es el mismo número:
  no hay dos aritméticas que puedan separarse.
- Contar por capa **sí** se usa, pero solo para una decisión booleana: si
  `items.filter(i => i.layer === 3)` está vacío en esta página, el bloque 2 no se
  renderiza. Eso es correcto página a página y no aparece en pantalla como cifra.

**Por qué no hay `not-found.tsx` en el segmento.** `/[slug]/pedido/[code]` tiene
uno para no perder el marco de la tienda, y tiene sentido: ahí la tienda existe
y solo falla el código. Aquí los dos caminos a 404 son «el slug no existe» y «el
slug es una marca en modo selector»: en el primero no hay tienda de la que pintar
la cabecera, y en el segundo lo correcto es no sugerir que la marca tiene
buscador. El `not-found` global (`src/app/not-found.tsx`) dice lo que hay que
decir y no cuesta nada.

**Indexación.** `robots: { index: false }` en el `generateMetadata` de la
página, como ya hace `/[slug]/sucursales`, y fuera de `src/app/sitemap.ts`. Una
página de resultados es contenido delgado y duplicado; además es dinámica (R15)
y cada rastreo sería una consulta y una fila de registro que ensucia el dato con
el que el humano va a decidir SP1.

### 3 · `/[slug]/p/[productSlug]` — un añadido y nada más

La caja entra entre `BranchBar` y el `Container` de dos columnas, dentro de su
propio `Container className="pt-6"`. La ficha no cambia en nada más.

---

## Estructura por breakpoint

360 primero. `Container` ya da `mx-auto w-full max-w-6xl px-4 sm:px-6`: a 360 px
quedan 328 px útiles, medidos en la captura real.

| Zona                              | 360                                                                                                                                                                              | 768                                                             | 1280                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Caja de búsqueda**              | Una fila: `flex gap-2`. Input `flex-1 min-w-0 min-h-11`, botón `Buscar` `shrink-0 min-h-11 px-4` (≈ 88 px). Al input le quedan ≈ 232 px: caben «detergente líquido» sin cortarse | Igual, con el `<form>` limitado a `max-w-2xl` (672 px)          | Igual que 768. **No** se estira a 1152 px: un campo de búsqueda de un metro no ayuda a nadie |
| **Ayuda bajo la caja**            | `text-sm`, dos líneas como mucho                                                                                                                                                 | Una línea                                                       | Una línea                                                                                    |
| **`<h1>` + conteo**               | Apilados. `<h1>` `text-2xl font-semibold` —el mismo que `Catálogo`—, con `break-words` para que un término pegado de 120 caracteres sin espacios no provoque scroll horizontal   | Igual                                                           | Igual                                                                                        |
| **Rejilla de resultados**         | `grid grid-cols-2 gap-4` — **idéntica a la del catálogo, clase por clase**, para que `sizes` de `next/image` en `ProductCard` siga siendo correcto y no se descargue de más      | `sm:grid-cols-3`                                                | `lg:grid-cols-4`                                                                             |
| **Separación entre bloque 1 y 2** | `mt-10 border-t border-border pt-6`. El `<h2>` en `text-lg font-semibold` y su subtítulo en `text-sm text-fg-muted`                                                              | Igual, `<h2>` `text-xl`                                         | Igual                                                                                        |
| **Paginación**                    | `<nav>` con los dos enlaces **apilados a todo el ancho**, `min-h-11`, en orden de lectura: anterior y luego siguiente. La línea `Resultados 25 a 48 de 61.` encima, `text-sm`    | En fila, `sm:flex-row sm:justify-between`                       | Igual que 768                                                                                |
| **Vacío y consulta vacía**        | Una columna. Los consejos en `<ul class="list-disc pl-5">`. Botón `Ver todo el catálogo` a todo el ancho                                                                         | Todo el bloque a `max-w-2xl`; el botón al ancho de su contenido | Igual que 768                                                                                |
| **Tienda cerrada**                | Lo que ya hace `StoreClosedNotice` a 360, sin cambios                                                                                                                            | Igual                                                           | Igual                                                                                        |
| **Caja en la ficha de producto**  | Encima de la imagen, a todo el ancho                                                                                                                                             | A todo el ancho del `Container`, encima de las dos columnas     | Igual, `max-w-2xl`                                                                           |

**La regla que gobierna los tres anchos:** una sola columna de decisiones, nada
que provoque scroll horizontal (ni un término de 120 caracteres sin espacios), y
**la rejilla de resultados nunca deja de ser la rejilla del catálogo**.

---

## Componentes de UI

**Se reutilizan tal cual, sin tocar una línea:** `Container`, `Card`, `Badge`,
`Button`, `Alert`, `ProductCard`, `BranchBar`, `StoreClosedNotice`.

**Dos componentes nuevos**, los dos de servidor y los dos en
`src/components/store/`. El segundo lo ubica `architecture.md`; el primero es
mío:

| Componente                                              | Qué hace                                                                                                                           | Por qué no alcanza lo que hay                                                                                                                                                                                                                | `"use client"`                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| StoreSearchBox (por crear)                              | El `<form method="get">` completo: landmark, etiqueta oculta, input, botón y ayuda opcional                                        | En el repo **no existe ningún `<input>` reutilizable**; los del panel viven dentro de `Field` y de formularios de cliente. Repetir estas seis líneas en tres páginas garantiza que una de las tres pierda el `role="search"` o el `min-h-11` | **No.** No tiene estado ni eventos: es HTML    |
| src/components/store/StoreSearchResults.tsx (por crear) | Los **dos bloques** de DP1 (`<section>` + `<h2>` + `<ul>` + `ProductCard`) y el pie de paginación, a partir de `StoreSearchResult` | Es donde vive la única regla nueva de presentación: partir `items` por `layer` en 1–2 y 3. Dentro de la página, esa regla quedaría mezclada con el resolver, el 404 y el registro                                                            | **No.** Compone `ProductCard`, no lo sustituye |

`Field` **no** se usa: envuelve `<label>` visible + ayuda + error para
formularios de varios campos, y aquí hay un solo control con la etiqueta oculta y
el botón al lado; forzarlo añadiría una etiqueta visible que no aporta nada.

Los tres estados sin rejilla —vacío, consulta vacía y página fuera de rango— se
componen dentro de la página: son un `Alert`, un `<ul>` y un enlace, y no tienen
nada que compartir con la lista.

---

## Tokens y tema

**No hace falta ni un token nuevo.** Todo sale de `src/theme/tokens.css` tal
como está hoy.

| Uso                                                           | Token / utilidad                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Fondo del input                                               | `bg-surface`                                                                                                         |
| Borde del input y separador entre bloques                     | `border-border`                                                                                                      |
| Texto escrito, encabezados                                    | `text-fg`                                                                                                            |
| Marcador de posición, conteo, ayuda, subtítulo del bloque 2   | `placeholder:text-fg-muted`, `text-fg-muted`                                                                         |
| Botón `Buscar`                                                | `bg-brand text-brand-contrast` (la variante `primary` de `Button`, sin tocarla)                                      |
| `Ver todo el catálogo`, `Página anterior`, `Página siguiente` | variante `secondary` de `Button` sobre un `Link`: `bg-surface-muted text-fg border border-border`                    |
| Aviso de consulta vacía / de término truncado                 | `Alert tone="muted"` → `bg-surface-muted text-fg-muted border-border`, `role="status"`                               |
| Esquinas del input y de los bloques                           | `rounded-md` / `rounded-lg`. **Nunca** `rounded-[--radius-md]`: es la sintaxis v3 que persigue `npm run check:theme` |
| Sombra                                                        | Ninguna propia. La caja es un input con borde, no una tarjeta flotante; `shadow-card` ya lo ponen las tarjetas       |
| Anillo de foco                                                | `focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2`, calcado de `Button`            |
| Tipografía                                                    | `font-sans` y la escala de Tailwind (`text-sm`, `text-lg`, `text-2xl`). Sin tamaños arbitrarios                      |

**Cómo responde al branding por tienda (F-003 / F-011 / F-016).** La tienda
redefine `brand`, `brandContrast`, `accent`, `accentContrast` y la escala
`radius`, y nada más (`src/features/theming/storeTheme.ts`). Consecuencias
buscadas, y comprobadas contra `tienda-dos`, que tiene `radius: "round"`:

- El botón `Buscar` sale del color de la tienda y emparejado con su contraste,
  igual que `Agregar al carrito`. Es donde la marca tiene que caer.
- El input y los bloques se redondean solos: `rounded-md` resuelve a
  `var(--radius-md)`, que con `round` pasa de 0.625 rem a 1.25 rem. Ninguna
  medida está clavada.
- Los precios de las tarjetas siguen en `text-brand` **porque `ProductCard` no
  se toca** y así ya se ven en el catálogo. La coherencia manda sobre mi
  preferencia.

**Una decisión deliberada contra la marca:** el conteo de resultados y el
`<h1>` van en `text-fg`, nunca en `text-brand`. Es el mismo argumento que dejó
escrito F-010: `storeTheme.ts` valida que el color sea un color CSS, no que
contraste, y una tienda con un `brand` casi blanco dejaría ilegible el dato que
explica la pantalla. La marca se queda donde va acompañada de su
`brand-contrast`.

**Riesgo heredado, no nuevo:** una tienda con `brand` casi igual al fondo deja
el anillo de foco del input casi invisible. Es el mismo agujero que F-010 anotó
para un F-016bis (validar contraste en `storeTheme.ts`); F-021 no lo abre ni lo
empeora.

---

## Accesibilidad

**Landmarks y encabezados.**

- El `<form>` lleva `role="search"` y `aria-label="Buscar en {nombre de la
tienda}"`. Hay **uno solo por página**, así que el landmark no se duplica.
- Un `<h1>` por página, distinto en cada estado, y nunca un nivel saltado.
  `<h2 class="sr-only">Coincidencias con tu búsqueda</h2>` para el bloque 1 —el
  orden de encabezados queda completo para quien navega por encabezados, sin
  ruido visual— y `<h2>` visible para el bloque 2. Cada bloque es una
  `<section aria-labelledby="…">`, y **el del bloque 2 desaparece entero** —
  `<section>`, `<h2>` y subtítulo— cuando la página no trae capa 3: un
  encabezado que titula una lista vacía es peor que no tenerlo.

**Cómo se anuncia el conteo, y por qué NO con `aria-live`.** Aquí no hay nada
que cambie sin navegar: cada búsqueda es un documento nuevo. Una región viva en
una carga de página no se anuncia de forma fiable y, cuando lo hace, duplica lo
que el lector ya va a leer. El mecanismo real son tres cosas, en este orden:

1. **El `<title>`**, que es lo primero que anuncian NVDA, JAWS y VoiceOver al
   terminar de cargar: `coca cola · 12 resultados · queandabuscando` con
   resultados, y `Sin resultados para «xyz» · queandabuscando` sin ellos. El
   veredicto llega antes de leer nada.
2. **El `<h1>`**, que repite el término.
3. **La línea de conteo**, un `<p>` inmediatamente después del `<h1>`, con
   texto real —no un atributo— y con el plural correcto.

El único `aria-live` de la pantalla no existe. El único `role="status"` es el
del `Alert` `muted` de la consulta vacía y el del término truncado, y lo pone
`Alert` solo (`src/components/ui/Alert.tsx`).

**Foco.**

- **`autofocus` en el input solo en el estado de consulta vacía.** Es el
  atributo HTML, no `useEffect`: funciona sin hidratar y no necesita directiva.
  Es la única pantalla donde escribir es lo único que se puede hacer.
- **Nunca `autofocus` con resultados ni con cero resultados.** En un móvil
  abriría el teclado encima de lo que el comprador acaba de pedir, y en un
  lector movería el punto de lectura por detrás del titular que explica qué
  pasó.
- Orden de tabulación en la página de resultados: nombre de la tienda → (enlace
  de `BranchBar`, si hay) → `Carrito` → input → `Buscar` → tarjeta 1 … tarjeta
  n → `Página anterior` → `Página siguiente`. Es el orden del DOM: no se
  reordena nada con CSS, y por eso el `flex-col` de 360 y el `flex-row` de 768
  mantienen anterior→siguiente.
- El anillo de foco es visible en los cuatro sitios enfocables nuevos (input,
  `Buscar`, los dos enlaces de paginación) y usa el mismo
  `focus-visible:outline-2 outline-offset-2` que ya tiene `Button`.

**Teclado.** Enter dentro del input envía el formulario: comportamiento nativo
de un `<form>` con un solo campo de texto, sin un `onKeyDown`. La ✕ de
`type="search"` es del navegador y es alcanzable con el ratón; con teclado se
borra seleccionando, que es lo de siempre.

**Área de toque.** Input `min-h-11` (44 px), botón `Buscar` `min-h-11 px-4`,
enlaces de paginación `inline-flex items-center min-h-11 px-4`, `Ver todo el
catálogo` con `Button size="md"`. Las tarjetas ya son enlaces de más de 200 px
de alto.

**Contraste.** Todo se apoya en pares que ya están en producción: `text-fg` y
`text-fg-muted` sobre `bg` y sobre `surface`, en claro y en oscuro (la captura
de la extensión salió en oscuro y se lee). Los dos textos secundarios de esta
pantalla —la ayuda y el subtítulo del bloque 2— van en `text-sm`, **no en
`text-xs`**: 12 px en `fg-muted` es el tamaño en el que este repo ya pone
avisos, y para una línea que hay que leer de verdad se queda corto.

**Nada se comunica solo por color.** La diferencia entre el bloque 1 y el
bloque 2 es un encabezado con texto, no un tono. El agotado es un `Badge` con la
palabra `Agotado`, como ya hace el catálogo.

**Idioma y comillas.** El término se envuelve en `«…»` —comillas españolas— en
el `<h1>` y en la frase del vacío, para que se distinga del texto que lo rodea
sin recurrir a la cursiva, que algunos lectores no anuncian.

---

## Coste de cliente

**Cero componentes de cliente nuevos. Cero.** Lo que este feature añade al
navegador es HTML:

| Pieza                          | Directiva | Por qué                                                                                        |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------- |
| StoreSearchBox (por crear)     | **No**    | Un `<form method="get">` con un `<input>` y un `<button type="submit">`. Ni estado ni eventos  |
| StoreSearchResults (por crear) | **No**    | Parte `items` por `layer` y pinta `ProductCard`. Es una función pura sobre un array            |
| La página de resultados        | **No**    | Lee `searchParams`, consulta y pinta. Es catálogo: `AGENTS.md` § Prohibiciones lo **prohíbe**  |
| `ProductCard`                  | **No**    | Ya es de servidor y no se toca                                                                 |
| Paginación                     | **No**    | Dos `next/link`. Un `Link` se usa desde un componente de servidor sin arrastrar nada al bundle |
| loading.tsx (por crear)        | **No**    | `loading.tsx` es un componente de **servidor**; solo `error.tsx` obliga a `"use client"`       |

**Por qué no hay `error.tsx` propio en el segmento, y es importante.** En Next,
un `error.tsx` **tiene** que llevar `"use client"`. Poner uno en el segmento de
búsqueda metería un módulo de cliente en una página que renderiza catálogo:
exactamente lo que R14 y `AGENTS.md` prohíben. El `src/app/error.tsx` que ya
existe cubre la ruta desde la raíz, ya está en el árbol de todas las páginas de
tienda de hoy y **no añade ni un byte nuevo**. E17 se cumple con él: la base
caída pinta `Algo salió mal`, nunca una lista vacía.

**Lo único que ya viaja a estas pantallas** es lo de F-010: `CartBadge` en la
cabecera del `layout`. No cambia.

**Presupuesto.** `node scripts/check-bundle-budget.mjs` tiene que seguir en 0
sin tocar `BUDGET_KB` — es el criterio 11 `[nuevo]` de la spec. Si sube, hay una
regresión que investigar, no un número que subir: aquí no hay nada que pueda
crecer legítimamente.

**Qué se queda fuera por costar JavaScript, y no vuelve por la puerta de atrás.**
Autocompletado en vivo, «quizás quisiste decir», filtrado instantáneo mientras
se teclea, scroll infinito y un botón ✕ propio para vaciar la caja: los cinco
están ya excluidos en `spec.md` § Fuera. **No propongo ningún JavaScript
progresivo opcional**, ni siquiera «pequeño»: el sustituto de los cinco es lo
que el navegador regala gratis —el historial del propio campo y la ✕ nativa de
`type="search"`—, y añadir una isla a la pantalla de búsqueda sería el primer
paso para que el catálogo dejara de leerse sin esperar al JavaScript.

**Sin `<noscript>`.** F-010 necesitaba uno porque el carrito vive en
`localStorage`. Aquí no hay nada que explicar: con el JavaScript desactivado, la
pantalla es **la misma**. Eso es E18 y el criterio 11.

---

## Textos

Microcopy exacto, en español. `{tienda}` es `store.name` («La Rampa · Vedado»),
`{término}` es el término **ya normalizado y truncado**, `{n}` el total.

**Caja de búsqueda**

| Dónde                                 | Texto                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `aria-label` del formulario           | `Buscar en {tienda}`                                                      |
| `<label>` oculta                      | `Buscar productos en {tienda}`                                            |
| `placeholder`                         | `Buscar en la tienda`                                                     |
| Botón                                 | `Buscar`                                                                  |
| Ayuda (solo en la página de búsqueda) | `Escribe el nombre de un producto. Por ejemplo: arroz, refresco o jabón.` |

**Con resultados**

| Dónde                      | Texto                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| `<title>`                  | `{término} · {n} resultados` (singular: `{término} · 1 resultado`)      |
| `<h1>`                     | `Resultados para «{término}»`                                           |
| Conteo, único              | `{n} resultados en {tienda}.` · singular: `1 resultado en {tienda}.`    |
| `<h2>` oculto del bloque 1 | `Coincidencias con tu búsqueda`                                         |
| `<h2>` del bloque 2        | `Otros productos de la misma categoría`                                 |
| Subtítulo del bloque 2     | `No coinciden con lo que escribiste, pero son del mismo tipo.`          |
| Término truncado (E11)     | `Tu búsqueda era muy larga. Buscamos con las primeras {máximo} letras.` |

`{n}` es `totalCount`, el total de las tres capas: **ni los bloques ni sus
encabezados llevan cifra**, por lo que explica § Por qué los bloques no llevan
número. El `{máximo}` se interpola desde la constante del término, nunca se
escribe `120` en el JSX (`AGENTS.md` § Prohibiciones: magic numbers).

**Sin resultados** (E5)

| Dónde             | Texto                                                                         |
| ----------------- | ----------------------------------------------------------------------------- |
| `<title>`         | `Sin resultados para «{término}»`                                             |
| `<h1>`            | `Sin resultados para «{término}»`                                             |
| Párrafo           | `No encontramos ningún producto para «{término}» en {tienda}.`                |
| Antes de la lista | `Puedes probar así:`                                                          |
| Consejo 1         | `Revisa si falta o sobra alguna letra.`                                       |
| Consejo 2         | `Prueba con una palabra sola: «refresco» en vez de «refresco de cola 1.5 L».` |
| Consejo 3         | `Prueba con otra manera de llamarlo.`                                         |
| Acción            | `Ver todo el catálogo`                                                        |

Ni «lo sentimos» ni «¡vaya!»: el comprador no hizo nada mal y la disculpa no le
devuelve el producto. Y **no se le ofrecen productos destacados ni «los más
buscados»**: sería una segunda consulta y convertiría un fallo de búsqueda en un
escaparate. Si el humano quiere eso, es un feature suyo (regla 4), y encajaría
justo debajo de los consejos sin mover nada de esta pantalla.

**Consulta vacía o sin letras ni dígitos** (E10)

| Dónde                               | Texto                                                         |
| ----------------------------------- | ------------------------------------------------------------- |
| `<title>`                           | `Buscar en {tienda}`                                          |
| `<h1>`                              | `Buscar en la tienda`                                         |
| Párrafo                             | `Escribe el nombre de un producto para buscarlo en {tienda}.` |
| Aviso, solo si venía `q` y no valía | `Escribe al menos una letra o un número para buscar.`         |
| Acción                              | `Ver todo el catálogo`                                        |

**Paginación** (E15)

| Dónde                    | Texto                                     |
| ------------------------ | ----------------------------------------- |
| Línea de posición        | `Resultados {primero} a {último} de {n}.` |
| `aria-label` del `<nav>` | `Páginas de resultados`                   |
| Enlace atrás             | `Página anterior`                         |
| Enlace adelante          | `Página siguiente`                        |

`{primero}` es `(page - 1) * pageSize + 1` y `{último}` es
`{primero} + items.length - 1`; los tres datos vienen de `StoreSearchResult`. El
enlace de atrás se renderiza cuando `page > 1` y apunta a `?q=…&p={page-1}` —sin
`p` cuando la anterior es la 1, para que la primera página tenga una sola URL—; el
de adelante, cuando `hasMore`, a `?q=…&p={page+1}`. **Ninguno de los dos aparece
deshabilitado**: un enlace que no lleva a ningún sitio se omite.

**Página fuera de rango** (`?p` más allá de los resultados)

| Dónde  | Texto                                 |
| ------ | ------------------------------------- |
| Aviso  | `Esta página ya no tiene resultados.` |
| Acción | `Volver a la primera página`          |

**Tienda cerrada** (E14) — `StoreClosedNotice` con su texto de siempre, más
`extraNote`: `No se puede buscar mientras la tienda esté cerrada.`

**Cargando** (solo en la transición de cliente de la paginación)
— `Buscando…`, dentro de un contenedor con `aria-busy="true"`.

---

## Verificación visual

Pasos ejecutables, para traducir a `.agent/specs/F-021/visual.mjs` (que
`bash .agent/sdd.sh done` exige en cuanto este documento esté en `listo`).
Datos: los del `npm run seed`. `tienda-demo` es azul y `radius` por defecto;
`tienda-dos` es verde, `radius: "round"`, y trae `Coca-Cola 1.5L`,
`Café molido 250 g` y `Chocolate en barra` **agotado** — el trío que ejercita
E1, E3, E4 y E6 de una vez. `tienda-cerrada` está `SUSPENDED` y
`bodega-central` es el slug en modo selector.

| #       | Viewport     | Qué se hace                                                                 | Qué tiene que cumplirse                                                                                                                                                                                        |
| ------- | ------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | 360          | `GET /tienda-demo`                                                          | Hay un `[role="search"]` y es el primer elemento del `<main>`. El input mide ≥ 44 px de alto. `document.documentElement.scrollWidth <= 360`                                                                    |
| **V2**  | 360          | Escribir `coca` en `/tienda-dos` y pulsar `Buscar`                          | La URL pasa a `/tienda-dos/buscar?q=coca`. El `<h1>` contiene `Resultados para «coca»`. La primera tarjeta es `Coca-Cola 1.5L` (criterio 1)                                                                    |
| **V3**  | 360          | Contexto con `javaScriptEnabled: false`, repetir V2                         | Mismo resultado: la URL cambia y `Coca-Cola 1.5L` está en el HTML (E18, criterio 11)                                                                                                                           |
| **V4**  | 360          | `GET /tienda-dos/buscar?q=cocacola`                                         | `Coca-Cola 1.5L` está entre los resultados (criterio 4, capa difusa)                                                                                                                                           |
| **V5**  | 360          | `GET /tienda-dos/buscar?q=` (vacío)                                         | `<h1>` = `Buscar en la tienda`; `document.activeElement.id === "q"`; cero tarjetas                                                                                                                             |
| **V6**  | 360          | `GET /tienda-dos/buscar?q=zzzzzzzz`                                         | `<h1>` empieza por `Sin resultados`; el input conserva `zzzzzzzz`; existe un enlace a `/tienda-dos` con el texto `Ver todo el catálogo`; **cero** elementos con `role="alert"`                                 |
| **V7**  | 360/768/1280 | `GET /tienda-dos/buscar?q=a` y medir las tarjetas                           | 2, 3 y 4 por fila respectivamente (misma `top` en el `getBoundingClientRect`), igual que en `/tienda-dos`                                                                                                      |
| **V8**  | 360          | `GET /tienda-dos/p/coca-cola-1-5l`                                          | Hay `[role="search"]`; la imagen del producto empieza por debajo de él; sin scroll horizontal. **Captura para mirar el coste de los 64 px**                                                                    |
| **V9**  | 360          | `/tienda-dos/buscar?q=chocolate`                                            | La tarjeta de `Chocolate en barra` aparece, lleva el `Badge` `Agotado` y su `<a>` apunta a la ficha (E6)                                                                                                       |
| **V10** | 1280         | `/tienda-dos/buscar?q=coca`                                                 | El `<form>` mide ≤ 672 px y su borde izquierdo coincide con el del `<h1>`. El `background-color` del botón `Buscar` es el mismo que el de la cabecera; el `border-radius` del input es el de la escala `round` |
| **V11** | 360          | Tabular desde el nombre de la tienda en `/tienda-dos/buscar?q=coca`         | El foco pasa por input → `Buscar` → primera tarjeta, en ese orden, y el `outline-width` del elemento enfocado es ≥ 2 px                                                                                        |
| **V12** | 360          | `/tienda-cerrada/buscar?q=arroz`                                            | Responde 200, aparece el aviso de cerrada, **no** hay `[role="search"]` y no hay ninguna tarjeta (E14)                                                                                                         |
| **V13** | 360          | `/bodega-central/buscar?q=arroz`                                            | HTTP 404 (E13)                                                                                                                                                                                                 |
| **V14** | 360          | `q` de 5 000 caracteres                                                     | HTTP 200; aparece la línea de término truncado; `scrollWidth <= 360`; el `<h1>` no desborda (E11)                                                                                                              |
| **V15** | 360          | `q` = `co&ca\|!:*"(`                                                        | HTTP 200 y ningún error de consola (E12, criterio 12)                                                                                                                                                          |
| **V16** | 360          | Un término con más de 24 resultados; seguir `Página siguiente`              | El `href` conserva `q` y lleva `p=2`; ningún `slug` de producto se repite entre las dos páginas; en la página 2 existe `Página anterior` (E15)                                                                 |
| **V17** | 360          | `/tienda-dos/buscar?q=a&p=40` (dentro del tope, más allá de los resultados) | HTTP 200; el `<h1>` sigue siendo `Resultados para «a»`; **no** aparece `Sin resultados`; hay un aviso `Esta página ya no tiene resultados.` y un enlace `Volver a la primera página`                           |
| **V18** | 360          | Un término que devuelva capa 3 (p. ej. `cafe` en `tienda-dos`)              | Existe un `<h2>` con `Otros productos de la misma categoría` **por debajo** de la primera tarjeta, y ninguna tarjeta lleva insignia de capa ni texto resaltado (DP1 → dos bloques)                             |
| **V19** | 360          | Un término de una tienda sin categorías, o cualquiera sin capa 3            | **No** existe ningún `<h2>` de «misma categoría», ni un `border-t` huérfano, ni ninguna frase sobre relacionados                                                                                               |
| **V20** | 360          | Todas las anteriores                                                        | Cero `console.error` y cero `pageerror` en toda la sesión                                                                                                                                                      |
| **V21** | 360 y 1280   | `colorScheme: "dark"` sobre `/tienda-dos/buscar?q=cafe`                     | Captura para que un humano compruebe que el conteo, la ayuda y el subtítulo del bloque 2 se leen en oscuro                                                                                                     |

**V18 y V19 son el par que comprueba DP1**: uno exige el segundo bloque cuando
hay capa 3, el otro exige que no quede ni rastro de él cuando no la hay. Sin los
dos, «dos bloques» es una frase de un documento y no una propiedad de la
pantalla.

---

## Preguntas al humano

**No queda ninguna.**

**DP1 — ¿cuánto se separan visualmente las tres capas? RESUELTA (2026-08-28, el
humano).** Respuesta literal: **«Dos bloques (Recomendado)»** — la opción (b).

_Qué faltaba:_ decidir si el comprador ve una sola lista ordenada o secciones, y
con qué nombre. No era maquetación: es lo que hace que un resultado se lea como
«esto es lo que pediste» o como «esto te lo sugerimos».

_Cómo queda escrito:_ arriba, **lo que casó por texto** —capas 1 y 2 juntas, sin
distinguir la léxica de la difusa—, sin encabezado visible y con un
`<h2 class="sr-only">Coincidencias con tu búsqueda</h2>` para el lector de
pantalla. Debajo, separado por `mt-10 border-t border-border pt-6`, el bloque
`<h2>Otros productos de la misma categoría</h2>` con el subtítulo
`No coinciden con lo que escribiste, pero son del mismo tipo.` Ese segundo
bloque **no se renderiza** cuando la página no trae ningún `layer === 3`.
Ninguna tarjeta lleva insignia de capa ni resaltado. Está en § Inventario
(fila «Con resultados»), § Estructura por breakpoint (fila «Separación entre
bloque 1 y 2»), § Accesibilidad (encabezados) y § Textos, y lo comprueban V18 y
V19.

_Las dos opciones descartadas, para que no vuelvan por su cuenta:_ (a) una sola
lista —el «Cola-loca» a media pantalla se lee como un buscador roto, que es
justo el caso que la spec puso como objetivo— y (c) tres bloques —para el
comprador, que «cocacola» encuentre «Coca-Cola 1.5 L» **es** un acierto (E4);
etiquetarlo de «parecido» le resta confianza a un resultado correcto y expone
una distinción que es nuestra, no suya.

---

_Nada más queda abierto._ Lo demás que podía parecer pregunta está decidido
aquí, con su razón: la caja va por página y no en el `layout`; la ficha de
producto también la lleva; no hay `error.tsx` ni `not-found.tsx` propios; la
página es `noindex`; el vacío no ofrece destacados; los agotados no se hunden;
los bloques no llevan cifra porque el contrato no da contador por capa; y no hay
ni una línea de JavaScript progresivo.
