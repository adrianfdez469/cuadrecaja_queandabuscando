---
feature: F-023
agente: sdd-designer
actualizado: 2026-08-28T16:44:36Z
estado: listo
---

> **Este feature no añade ninguna pantalla.** Cambia el marcado de las cuatro
> imágenes que ya existen —tarjeta del catálogo, foto de la ficha, galería del
> editor y miniatura del listado del panel— y con él el peso que paga el
> comprador. Todo lo que sigue es HTML: **cero JavaScript de cliente nuevo**
> (R16), y de hecho **menos** del que hay hoy, porque salen los cuatro
> `next/image`.

## Qué se miró antes de diseñar

`AGENTS.md` (§ Prohibiciones — `"use client"` y catálogo; § El presupuesto de
JavaScript no es un muro), `.agent/specs/F-023/spec.md` completa (E1–E14,
R1–R16, I1–I7, § No decidido a propósito), `.agent/specs/F-011/design.md`
(§ 4c la galería y su tabla de estados, VE13, VE18) y el código real:
`src/components/store/ProductCard.tsx`, `src/app/[slug]/page.tsx`,
`src/components/store/StoreSearchResults.tsx`,
`src/app/[slug]/p/[productSlug]/page.tsx`,
`src/features/admin/components/ImageUploader.tsx`,
`src/features/admin/components/ProductTable.tsx`,
`src/components/ui/Container.tsx`, `src/components/ui/Card.tsx`,
`src/features/catalog/server/queries.ts`, `src/constants/media.ts`,
`src/constants/admin.ts`, `src/theme/tokens.css` y `next.config.ts`.

`.agent/specs/F-023/architecture.md` se estaba escribiendo en paralelo mientras
yo escribía esto. Lo que supongo de su terreno está en
§ Cómo encaja con `architecture.md`, cada suposición con qué pasa si decide
otra cosa. No escribí en su archivo.

### Lo que NO verifiqué mirando, y por qué

**No levanté la app.** Dos razones, las dos verificables:

1. **No hay nada que mirar.** El seed no escribe `imageUrls` nunca (I5 de la
   spec) y ningún `CanonicalProduct` del seed tiene `imageUrl` (VE13 de
   `.agent/specs/F-011/design.md`), así que hoy **todas** las tarjetas de
   `/tienda-demo` salen con el recuadro `Sin imagen`. Abrir el navegador me
   habría enseñado quince cuadros grises.
2. **El navegador de este entorno no cambia de tamaño.** VE18 de F-011:
   `resize_window` responde «Successfully resized» y la captura mide lo mismo;
   tres ciclos, cinco intentos, tres ventanas. Un juicio a 360 y a 768 no se
   puede emitir aquí.

Lo que sí hice, porque para decidir anchos y breakpoints basta y es exacto: **la
geometría aritmética** de las clases de Tailwind que ya están en el repo (tabla
en § Estructura por breakpoint) y **el cálculo de contraste** del hueco
`Sin imagen` en claro y en oscuro, convirtiendo los `oklch()` de
`src/theme/tokens.css` a luminancia relativa (números en § Accesibilidad). Los
pasos `V1`–`V12` de § Verificación visual quedan **sin ejecutar** y son un paso
del plan, no una nota al pie. Es la tercera vez que este repo lo dice.

---

## Flujo de usuario

Ningún flujo cambia de forma. Cambian dos costos dentro de flujos que ya
existen:

1. **El comprador abre `/[slug]`.** El HTML llega del CDN como hoy (~3 KB).
   Dentro, cada tarjeta trae un `<picture>` con dos URLs absolutas del bucket.
   El navegador elige AVIF o WebP **antes** de pedir nada, sin
   `/_next/image`, sin optimizador y sin esperar al JavaScript. Las cuatro
   primeras tarjetas piden su imagen en el acto; el resto espera al scroll.
2. **El admin sube una foto.** El flujo de F-011 no se toca: elige archivo →
   sube sola → aparece en la cuadrícula. Lo nuevo es (a) que puede tardar un
   poco más —se codifican cuatro variantes antes del `201`—, (b) que si la
   variante de tarjeta quedó pesada se lo decimos sin bloquear (E3), y (c) que
   **quitar una imagen ahora sí borra el archivo** (R9), lo que obliga a
   cambiar dos textos que F-011 escribió prometiendo lo contrario (I1).

Vueltas atrás y qué se pierde:

| Vuelta atrás                                 | Qué se pierde                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| El admin quita una imagen                    | **El archivo.** Ya no es reversible: hay que volver a subirla. El texto lo dice antes y después                          |
| El admin cancela la confirmación             | Nada                                                                                                                     |
| El admin reemplaza (sube nueva, quita vieja) | Nada visible; la vieja y sus cuatro variantes dejan de existir tras la revalidación (R14: escribir → revalidar → borrar) |
| El comprador vuelve atrás desde la ficha     | Nada: las variantes de tarjeta ya están en caché del navegador y del CDN                                                 |

---

## Decisiones de diseño

Las que la spec me delegó (§ No decidido a propósito), cerradas.

### D1 — Los dos anchos: **400 y 800 px**. Confirmados

Los indicativos de R2 se confirman tal cual. La aritmética que los sostiene está
en § Estructura por breakpoint; en corto:

- **Tarjeta**: la caja de imagen mide entre **156 px** (móvil de 360, dos
  columnas) y **264 px** (escritorio ≥ 1152, cuatro columnas). Un ancho de 400
  cubre DPR 1 en todo el rango con holgura y DPR 2 hasta 200 px de caja.
- **Ficha**: la caja mide entre **328 px** (móvil de 360, una columna) y
  **536 px** (escritorio ≥ 1152, dos columnas). Un ancho de 800 cubre DPR 1 en
  todo el rango y DPR 2 hasta 400 px de caja, que es casi todo el móvil.

400 es además el ancho que hace verdadera la aritmética de R8: 300 KB ÷ 15
productos del seed ≈ 20 KB **por variante de tarjeta**, que es exactamente el
objeto que se descarga (ver D3).

### D2 — Las variantes son **cuadradas, con recorte centrado**

Las cuatro superficies que muestran una imagen de producto —tarjeta, ficha,
galería del editor, miniatura del listado— son hoy `aspect-square` con
`object-cover`. El navegador **ya recorta al centro** en las cuatro. Generar la
variante como un cuadrado de 400×400 y 800×800 (encajar cubriendo y recortar al
centro) da exactamente el mismo píxel en pantalla y añade cuatro cosas:

1. **El peso es determinista.** Sin esto, una foto vertical 3:4 a 400 px de
   ancho tiene 400×533 = 33 % más píxeles que una cuadrada, y el tope de 20 KB
   de R8 deja de significar nada.
2. **`width="400" height="400"` en el `<img>` es cierto**, así que la relación
   de aspecto intrínseca coincide con la caja y no hay CLS ni siquiera antes de
   que aplique el CSS.
3. **El `openGraph` puede declarar `width`/`height`** (R15), que es lo que hace
   que WhatsApp pinte la tarjeta grande en vez de la miniatura de al lado.
4. Cero configuración por imagen.

Esto **no contradice** § Fuera de alcance («Recorte, rotación o edición de la
imagen **en el panel**»): no se añade ninguna herramienta de recorte, el admin
sigue subiendo lo que quiere, y **el original se conserva intacto** (R3), que es
la fuente de la que se regenera todo si algún día queremos otra relación de
aspecto. Lo que el admin pierde respecto a hoy: nada — hoy ya no ve los bordes
de una foto panorámica en ninguna pantalla.

### D3 — La tarjeta ofrece **un solo candidato por formato**; la ficha, dos

Esta es la decisión que más peso mueve y va contra el reflejo de escribir
`srcset="…400w, …800w"` en todas partes.

Si la tarjeta ofreciera los dos anchos, un teléfono con DPR 3 a 390 px de
viewport necesitaría 513 px de imagen y **elegiría el 800** para cada tarjeta:
15 × ~70 KB ≈ 1 MB en la página que el presupuesto declara de 300 KB. El
presupuesto seguiría pasando —E7 lo mide a DPR 1— y el comprador con datos
móviles, que es el público objetivo declarado del feature, pagaría el triple.
R8 dejaría de proteger a nadie, que es justo lo contrario de lo que I4 dice que
hace.

Por eso:

- **Tarjeta** (tienda y panel): `srcset` con **una** URL, la de 400, sin
  descriptor `w` y **sin `sizes`**. Todo cliente descarga el mismo objeto de
  ~20 KB. Efecto lateral bueno: el «candidato AVIF de menor ancho» que mide el
  criterio 3 pasa a ser **el único candidato**, así que la comprobación de
  presupuesto mide bytes reales y no una ficción de DPR 1.
- **Ficha**: `srcset` con **los dos** anchos y su `sizes`. Ahí la caja es grande,
  la imagen es una sola, es el LCP, y un móvil de DPR 1 se sigue llevando el
  400 mientras el escritorio se lleva el 800.

**El costo aceptado**, dicho con su número: en un escritorio retina a 1280 px la
tarjeta muestra 400 px de imagen en una caja de 264 CSS px a DPR 2, es decir un
escalado de **1,32×**. En una miniatura de producto es una suavidad que hay que
buscar; es el precio de que el móvil pague 20 KB y no 70. Si `V6` la juzga
inaceptable, el remedio no exige rediseñar nada: subir el ancho de tarjeta a
512 en la constante y bajar un escalón la calidad para no pasar de 20 KB.

### D4 — Calidades y topes de peso

Objetivo y aviso separados: el codificador **apunta** al objetivo bajando por la
escalera; solo si tras el último escalón sigue por encima del **tope** avisa
(E3). Nunca falla por peso.

| Variante       | Píxeles | Escalera de calidad | Objetivo           | Tope (aviso E3)      |
| -------------- | ------- | ------------------- | ------------------ | -------------------- |
| tarjeta · AVIF | 400×400 | 52 → 46 → 40 → 34   | 18 KB (18 432 B)   | **20 KB (20 480 B)** |
| tarjeta · WebP | 400×400 | 74 → 66 → 58        | 30 KB (30 720 B)   | — (no avisa)         |
| ficha · AVIF   | 800×800 | 54 → 48 → 42        | 72 KB (73 728 B)   | — (no avisa)         |
| ficha · WebP   | 800×800 | 76 → 68 → 60        | 120 KB (122 880 B) | — (no avisa)         |

Por qué estos números:

- **El único tope duro es el de R8**, y es 20 KB sobre la variante **AVIF de
  tarjeta**, porque es exactamente el objeto que mide el criterio 3 y el único
  que se descarga 15 veces en una página.
- **El objetivo va 10 % por debajo del tope** (18 KB) a propósito: 15 × 20 480 B
  = 307 200 B, que es el presupuesto **clavado**, sin un byte de margen. Con
  18 KB de objetivo el catálogo de referencia aterriza en ~270 KB y la
  comprobación no vive al filo.
- **El WebP no avisa** porque no lo mide nadie y casi nadie lo descarga: la
  línea base de navegadores que Tailwind 4 ya exige (Safari 16.4+, Chrome 111+,
  Firefox 128+, R4) soporta AVIF. El WebP es la red de seguridad de los
  WebViews viejos, no el camino normal; darle un objetivo generoso es correcto.
- **AVIF pide menos número que WebP para la misma calidad percibida**; de ahí
  que las escaleras arranquen en ~52 y ~75 respectivamente.
- **La ficha tolera más peso** porque es **una** imagen, está sobre el pliegue y
  es la que el comprador mira para decidir. 800×800 tiene 4× los píxeles de
  400×400: ~4× los bytes al mismo ajuste.

Estos valores son **el punto de partida con justificación, no un dogma**: la
spec autoriza explícitamente a `sdd-implementer` a ajustarlos «con la medición
delante». Lo que no se ajusta sin volver aquí es el **tope de 20 KB**, que es
regla de negocio (R8).

Nota de CPU (I6): se decodifica el original **una vez**, se producen los dos
búferes cuadrados y sobre cada uno corre la escalera. El peor caso son 4
variantes × 4 escalones = 16 codificaciones, todas de 400 o 800 px de lado —
baratas. Lo caro es decodificar el original de 4 MB, y eso ocurre una sola vez.

### D5 — Cuál WebP lleva el `<img>` de respaldo

R4 lo fija para la tarjeta: **el WebP del ancho de tarjeta**. En la ficha uso
**el WebP del ancho de detalle**, que es la lectura literal de la misma regla
aplicada a su superficie. Lo dejo escrito para que no se lea como desviación:

| Superficie                  | `<img src>` de respaldo |
| --------------------------- | ----------------------- |
| Tarjeta (tienda y panel)    | WebP 400                |
| Ficha de producto           | WebP 800                |
| Miniatura del listado admin | WebP 400                |

El criterio 4 se verifica sobre `$BASE/$SLUG` —tarjetas— y ahí la regla se
cumple al pie de la letra. En la práctica este `src` **no se pinta nunca** en la
línea base soportada: todo navegador que entiende `<picture>` entiende WebP, así
que siempre gana un `<source>`. Es el último recurso, y también lo que se lleva
un «guardar imagen como».

---

## Inventario de pantallas y estados

### 1 · Tarjeta del catálogo — `src/components/store/ProductCard.tsx`

Usada en `/[slug]` (`src/app/[slug]/page.tsx`) y en `/[slug]/buscar`
(`src/components/store/StoreSearchResults.tsx`, dos rejillas). Componente de
servidor, y sigue siéndolo.

| Estado                                               | Qué se ve                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Con imagen del bucket con variantes** (el normal)  | El `<picture>` de abajo. Caja `aspect-square` sobre `bg-surface-muted`, `object-cover`. Idéntico a hoy en pantalla                                                                                                                                 |
| **Sin imagen** (E8)                                  | El recuadro actual **sin cambios**: `bg-surface-muted` + `Sin imagen` en `text-fg-muted text-sm`, centrado. **Cero peticiones**: no se emite ningún `<img>`                                                                                        |
| **URL heredada de F-011 o ajena al bucket** (E9/R11) | Un `<img>` simple con esa URL, con las mismas clases (`object-cover`) y `loading="lazy"`. **Se ve igual que una tarjeta normal**: no hay badge, no hay aviso, no hay hueco. El comprador no tiene por qué enterarse de qué pipeline generó la foto |
| **La imagen heredada no carga (404)**                | El navegador pinta el `alt`, que es el **nombre del producto**, sobre el recuadro `bg-surface-muted`. Degradación legible, no un icono roto sobre blanco                                                                                           |
| **Antes de que llegue la imagen**                    | El recuadro `bg-surface-muted` de la caja, con su tamaño ya reservado por `aspect-square` + `width`/`height`. **Cero CLS**                                                                                                                         |

Marcado exacto del caso normal (el resto de la tarjeta —cinta `Destacado`,
`Link`, precio, `Badge`— no se toca):

```html
<div class="bg-surface-muted relative aspect-square">
  <picture>
    <source type="image/avif" srcset="{avif400}" />
    <source type="image/webp" srcset="{webp400}" />
    <img
      src="{webp400}"
      alt="{product.name}"
      width="400"
      height="400"
      loading="lazy"
      decoding="async"
      class="absolute inset-0 size-full object-cover"
    />
  </picture>
</div>
```

- **`absolute inset-0 size-full`**, no `h-full w-full` a secas: reproduce
  exactamente lo que hacía `next/image` con `fill` y no depende de qué
  `display` tenga `<picture>` (que por defecto es `inline`). Es el cambio de
  clases más pequeño que deja el layout idéntico.
- **Sin `sizes` y sin descriptores `w`**: D3.
- **`width`/`height`**: ciertos gracias a D2. Redundan con `aspect-square`, y
  esa redundancia es la que salva el layout si el CSS tarda.

**Carga diferida (I4).** `ProductCard` gana una prop `eager?: boolean`
(por defecto `false`). Quien la pone es quien conoce el orden:

- `src/app/[slug]/page.tsx`: `eager={index < CATALOG_EAGER_IMAGE_COUNT}` con
  `CATALOG_EAGER_IMAGE_COUNT = 4` en `src/constants/media.ts`.
- `src/components/store/StoreSearchResults.tsx`: lo mismo **solo en la primera
  rejilla** (coincidencias). La de «Otros productos de la misma categoría» va
  entera en `lazy`: nunca está sobre el pliegue.

Cuatro, y no otro número, porque es **la primera fila completa de escritorio**
(4 columnas desde 1024) y **las dos primeras filas de móvil** (2 columnas),
que es aproximadamente lo que cabe sobre el pliegue en un teléfono con la
`BranchBar` y el buscador encima. Coste: 4 × ~20 KB = ~80 KB antes del primer
scroll, sobre un presupuesto de 300 KB.

Con `eager`: se omite `loading` (o sea, `eager`), se omite `decoding="async"`,
y **solo la tarjeta de índice 0** lleva además `fetchpriority="high"` — es la
candidata a LCP de la página.

### 2 · Ficha de producto — `src/app/[slug]/p/[productSlug]/page.tsx`

| Estado                       | Qué se ve                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Con imagen con variantes** | El `<picture>` de abajo, en la caja `aspect-square rounded-lg overflow-hidden` que ya existe. Sin `loading="lazy"`: está sobre el pliegue |
| **Sin imagen** (E8)          | El recuadro actual sin cambios: `Sin imagen` en `text-fg-muted`, centrado, sin `text-sm` (la caja es grande). Cero peticiones             |
| **URL heredada** (E9/R11)    | `<img>` simple con esa URL, mismas clases, sin `loading`, con `fetchpriority="high"`                                                      |

```html
<div class="bg-surface-muted relative aspect-square overflow-hidden rounded-lg">
  <picture>
    <source
      type="image/avif"
      srcset="{avif400} 400w, {avif800} 800w"
      sizes="(min-width: 1152px) 536px, (min-width: 768px) calc(50vw - 40px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
    />
    <source
      type="image/webp"
      srcset="{webp400} 400w, {webp800} 800w"
      sizes="(min-width: 1152px) 536px, (min-width: 768px) calc(50vw - 40px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
    />
    <img
      src="{webp800}"
      alt="{product.name}"
      width="800"
      height="800"
      fetchpriority="high"
      class="absolute inset-0 size-full object-cover"
    />
  </picture>
</div>
```

El `sizes` sale de la geometría real y por eso lleva `calc()` en vez del
`(max-width: 768px) 100vw, 50vw` de hoy, que ignora los canalones y pide de
más:

| Rango de viewport | Cómo se calcula                                          | Resultado            |
| ----------------- | -------------------------------------------------------- | -------------------- |
| ≥ 1152 px         | contenedor tope 1152 − 48 de `px-6` − 32 de `gap-8`, ÷ 2 | `536px`              |
| 768 – 1151 px     | (100vw − 48 − 32) ÷ 2                                    | `calc(50vw - 40px)`  |
| 640 – 767 px      | una columna, 100vw − 48 de `px-6`                        | `calc(100vw - 48px)` |
| < 640 px          | una columna, 100vw − 32 de `px-4`                        | `calc(100vw - 32px)` |

Qué elige, en la práctica: móvil de 390 a DPR 1 → **400** (~18 KB); el mismo
móvil a DPR 2 → **800**; escritorio de 1280 a DPR 1 → **800**. Ningún cliente
pide más de lo que enseña.

**`priority` de `next/image` desaparece y no se sustituye por un
`<link rel="preload">`.** El `<img>` está en el HTML inicial, en el primer
`Container` con contenido, y el preescáner del navegador lo encuentra antes de
ejecutar nada. Un `preload` tendría que fijar formato y, si acierta AVIF donde
el cliente no lo soporta, descarga dos veces.

**`openGraph` (R15).** `images: [{ url: webp800, width: 800, height: 800 }]`.
Las dimensiones se pueden declarar porque la variante es cuadrada por D2, y son
lo que hace que WhatsApp pinte la previsualización grande. Con URL heredada se
pasa la URL tal cual y **sin** `width`/`height`, como hoy.

### 3 · Galería del editor — `src/features/admin/components/ImageUploader.tsx`

La cuadrícula es `grid-cols-4 gap-3 sm:grid-cols-6` dentro del formulario del
producto: las celdas quedan entre ~80 y ~140 CSS px. **La variante de tarjeta
(400) las cubre sobradamente hasta DPR 3**, así que aquí también va un solo
candidato por formato, igual que D3.

```html
<div class="bg-surface-muted relative aspect-square overflow-hidden rounded">
  <picture>
    <source type="image/avif" srcset="{avif400}" />
    <source type="image/webp" srcset="{webp400}" />
    <img
      src="{webp400}"
      alt="Imagen {i} de {n}"
      width="400"
      height="400"
      loading="lazy"
      decoding="async"
      class="absolute inset-0 size-full object-cover"
    />
  </picture>
</div>
```

El `alt` **no cambia** (`Imagen 1 de 3`): sigue siendo correcto, porque en el
editor lo que importa es la posición, no el contenido, y el nombre del producto
ya está en el `<h1>` de la pantalla.

Cambios de estado respecto a la tabla de F-011 (§ 4c de
`.agent/specs/F-011/design.md`), **solo estas tres filas**:

| Estado                                              | Antes (F-011)                                                                                                                                  | Ahora (F-023)                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quitar, paso 2**                                  | `Quitamos la imagen de tu producto.` + «nada dice borrada»                                                                                     | `Quitamos la imagen y borramos el archivo.` — ahora **sí** se borra (R9) y prometer lo contrario sería la mentira                                                          |
| **`imageUrls` con una URL que no es del bucket**    | La miniatura **no cargaba** (`next/image` daba 400 por `remotePatterns`) y se veía `Sin imagen` + `Badge tone="warning"` `No se puede mostrar` | La miniatura **carga**: es un `<img>` simple (R11). Se conserva un distintivo, pero informativo, no de error: `Badge tone="muted"` `Imagen externa`, y `Quitar` disponible |
| **Subida correcta con variante pesada** (E3, nueva) | —                                                                                                                                              | La miniatura entra normal; el banner pasa a `Alert tone="warning"` y la línea del archivo dice `Lista, pero pesada` (textos exactos en § Textos)                           |

Una URL **del bucket pero heredada de F-011** (sin juego de variantes) no lleva
badge ninguno: es una imagen legítima que simplemente no tiene variantes, y
marcarla sería pedirle al admin que arregle algo que no está roto.

El resto de la tabla de F-011 —subiendo, éxito parcial, mime, 4 MB, tope de 8,
503, red caída, `noscript`— sigue **exactamente igual**.

### 4 · Miniatura del listado — `src/features/admin/components/ProductTable.tsx`

Caja de `size-12` (48 px). Mismo marcado que la galería, con `alt=""` (la
miniatura es decorativa: el nombre del producto está en el enlace de al lado) y
`fetchpriority="low"` además de `loading="lazy"`.

| Estado           | Qué se ve                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Con imagen**   | El `<picture>` con la variante 400                                                                                                                                                      |
| **Sin imagen**   | El recuadro `bg-surface-muted` **sin el texto de 10 px**: `Sin imagen` pasa a `sr-only`. Ver § Accesibilidad: `text-[10px]` en una caja de 48 px no se lee, y la fila ya dice el nombre |
| **URL heredada** | `<img>` simple. Sin distintivo: el listado no es sitio para diagnosticar                                                                                                                |

**El costo, dicho con su número, porque no es gratis.** `ADMIN_PRODUCTS_PAGE_SIZE`
es 50 (`src/constants/admin.ts`) y R2 no me deja un tercer ancho, así que una
caja de 48 px se sirve con un objeto de 400 px: ~20 KB donde `next/image`
entregaba ~2 KB. Con `loading="lazy"` el navegador solo pide lo que el admin
llega a ver: ~10 filas de primera pantalla ≈ **200 KB**, y **~1 MB** si recorre
la página entera hasta abajo. Lo acepto porque (a) es una pantalla de
escritorio, autenticada, de un admin que ya está trabajando; (b) son los
**mismos objetos** que su propia tienda pública ya sirvió, así que el CDN y la
caché del navegador los tienen calientes; y (c) la alternativa —un tercer ancho
solo para el panel— rompe R2 y añade un objeto más por imagen en el bucket para
siempre. Si algún día molesta, lo barato no es un ancho nuevo: es bajar
`ADMIN_PRODUCTS_PAGE_SIZE`.

---

## Estructura por breakpoint

La geometría de la que salen 400 y 800. Contenedor `mx-auto w-full max-w-6xl
px-4 sm:px-6` (`src/components/ui/Container.tsx`); tope 1152 px; `px-4` = 32 px
de canalón total, `px-6` = 48 px.

**Rejilla del catálogo** — `grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4`
(idéntica en `/[slug]` y en `/[slug]/buscar`):

| Zona                     | 360px                            | 768px      | 1280px         |
| ------------------------ | -------------------------------- | ---------- | -------------- |
| Columnas                 | 2                                | 3          | 4              |
| Ancho útil               | 328 px                           | 720 px     | 1104 px (tope) |
| **Caja de imagen (CSS)** | **156 px**                       | **229 px** | **264 px**     |
| Necesita a DPR 2         | 312 px                           | 459 px     | 528 px         |
| Necesita a DPR 3         | 468 px                           | 688 px     | (irrelevante)  |
| **Se descarga**          | AVIF 400 (~18 KB)                | AVIF 400   | AVIF 400       |
| Sobre el pliegue         | 4 tarjetas `eager`, resto `lazy` | idem       | idem           |

El rango completo, para que no haya que recalcularlo: 360 → 156 px · 390 →
171 px · 430 → 191 px · 640 → 187 px · 768 → 229 px · 1024 → 232 px · ≥ 1152 →
264 px. **La caja nunca pasa de 264 px**, y ese es el hecho que hace de 400 un
ancho suficiente y de 800 un derroche en la tarjeta.

**Ficha de producto** — `grid gap-8 py-8 md:grid-cols-2`:

| Zona                     | 360px                                 | 768px                          | 1280px               |
| ------------------------ | ------------------------------------- | ------------------------------ | -------------------- |
| Disposición              | Apilada: foto arriba, datos debajo    | Dos columnas iguales           | Dos columnas iguales |
| **Caja de imagen (CSS)** | **328 px**                            | **344 px**                     | **536 px**           |
| Necesita a DPR 2         | 656 px                                | 688 px                         | 1072 px              |
| **Se descarga**          | AVIF 400 a DPR 1, AVIF 800 a DPR 2+   | AVIF 400 a DPR 1, 800 a DPR 2+ | AVIF 800             |
| Sobre el pliegue         | Sí — `eager` + `fetchpriority="high"` | Sí                             | Sí                   |

A 1280 y DPR 2 la caja pediría 1072 px y recibe 800: **1,34× de escalado**, el
mismo orden que la tarjeta y por la misma razón (R2 fija dos anchos). En la
única pantalla donde eso se notaría —escritorio retina— es también donde la
conexión suele ser mejor; el intercambio contrario, un tercer ancho de 1200 px,
no cabe en R2.

**Galería del editor** — `grid-cols-4 gap-3 sm:grid-cols-6`: celdas de ~80 px a
360, ~105 px a 768, ~140 px a 1280. Una sola variante de 400 cubre las tres a
DPR 3 (la peor: 140 × 3 = 420 ≈ 400, escalado 1,05×).

**Miniatura del listado**: 48 px fijos en los tres breakpoints.

Nada se apila distinto, nada se oculta y nada cambia de jerarquía respecto a
hoy: **este feature no mueve un píxel de layout.** Esa es la propiedad que
`V1`–`V6` tienen que confirmar.

---

## Componentes de UI

**Uno nuevo, y compartido por las cuatro superficies.** Un primitivo de
`src/components/ui/` (nombre y ruta finales de `sdd-architect`; yo describo el
contrato) que recibe una URL de original y emite el `<picture>`, o el `<img>`
simple si la URL no tiene variantes derivables (R11). Sin él, las mismas
quince líneas de marcado se copian en cuatro archivos y la primera divergencia
—un `loading` que falta, un `type` mal escrito— pasa desapercibida.

Contrato mínimo:

| Prop        | Para qué                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `src`       | La URL del original, tal cual está en `imageUrls`                                                         |
| `alt`       | Obligatoria, `string` (puede ser `""` para decorativas). Sin valor por defecto: un alt olvidado es un bug |
| `variant`   | `"card"` \| `"detail"`. Decide qué candidatos y qué `src` de respaldo (D5)                                |
| `sizes`     | Opcional. Presente solo en `"detail"`; su ausencia es lo que produce el candidato único de D3             |
| `priority`  | Opcional. `true` → sin `loading`, con `fetchpriority="high"`; ausente → `loading="lazy" decoding="async"` |
| `className` | Las clases del `<img>`. Por defecto `absolute inset-0 size-full object-cover`                             |

Es un **componente de servidor sin estado**: no lleva `"use client"` y por tanto
puede usarse dentro de `ImageUploader.tsx`, que sí es una isla, sin arrastrar
nada nuevo al bundle.

**Reutilizados sin tocar:** `Card`, `Container`, `Badge`, `Alert`. El único
`Badge` nuevo es de contenido, no de forma: `tone="muted"` con `Imagen externa`.

**No hace falta ningún componente nuevo para el hueco «Sin imagen»**: son tres
variantes de un `div` con dos clases y ya están escritas en los cuatro
archivos. Extraerlas no paga su import.

---

## Tokens y tema

**Cero tokens nuevos.** `src/theme/tokens.css` no se toca.

- Hueco «Sin imagen»: `bg-surface-muted` + `text-fg-muted`, que es lo que ya
  hay. Ambos son `var(--color-…)`, así que `scripts/check-theme-tokens.mjs`
  pasa.
- Caja de imagen: `bg-surface-muted` como fondo mientras carga y como fondo de
  un `object-cover` que no llena (no puede ocurrir con D2, pero cuesta cero).
- `rounded-lg` en la ficha, `rounded` en el panel: como hoy, y resuelven a
  `--radius-*`.

**Respuesta al branding por tienda:** ninguna, y es deliberado. Las fotos son
fotos, y el hueco de ausencia se pinta con **superficie neutra**, no con
`--color-brand`. Una tienda que eligió verde intenso vería quince rectángulos
verdes en su catálogo si el hueco fuera de marca; el gris de superficie se
comporta igual de bien en el tema claro, en el oscuro y bajo cualquiera de las
cuatro variables que una tienda puede redefinir. Es la misma lógica por la que
`accent` solo aparece en la cinta `Destacado` (VE5 de F-011).

---

## Accesibilidad

**Textos alternativos — confirmado: no cambia ninguno.**

| Superficie     | `alt`               | Por qué está bien                                                        |
| -------------- | ------------------- | ------------------------------------------------------------------------ |
| Tarjeta        | `product.name`      | Es el contenido de la imagen y el destino del enlace que la envuelve     |
| Ficha          | `product.name`      | Idem; el `<h1>` lo repite, que es aceptable para una foto de producto    |
| Galería editor | `Imagen {i} de {n}` | Lo que importa ahí es la posición, que es lo que el admin manipula       |
| Listado admin  | `""`                | Decorativa: el nombre está en el enlace hermano. Un alt aquí sería ruido |

El `alt` **vive en el `<img>`**, nunca en el `<picture>` ni en un `<source>`:
es el mismo elemento de siempre y los lectores de pantalla no notan el cambio.

**Contraste del hueco «Sin imagen»** — calculado convirtiendo los `oklch()` de
`src/theme/tokens.css` a luminancia relativa:

| Combinación                                      | Ratio      | AA (4,5:1) |
| ------------------------------------------------ | ---------- | ---------- |
| `text-fg-muted` sobre `bg-surface-muted`, claro  | **5,05:1** | pasa       |
| `text-fg-muted` sobre `bg-surface-muted`, oscuro | **5,99:1** | pasa       |

Pasa en los dos temas, así que el texto se queda en `text-fg-muted` y **no** hay
que subirlo a `text-fg`. Lo que sí cambia es un caso: en la miniatura de 48 px
del listado, el `text-[10px]` actual cumple el ratio pero **no se lee** —«Sin
imagen» partido en dos líneas dentro de 48 px—; pasa a `sr-only`, con lo que el
lector de pantalla lo sigue anunciando y la vista recibe un cuadro gris limpio.
En la tarjeta (`text-sm`, caja ≥ 156 px) y en la ficha se queda visible.

**Lo que no cambia porque no puede:** una imagen no es focalizable, así que el
orden de foco, el área de toque y el comportamiento con teclado son
exactamente los de hoy en las cuatro pantallas. La única superficie interactiva
tocada es la galería del editor, y sus botones (`Hacer principal`, `Quitar`,
`Sí, quitar`, `No`) no se mueven ni cambian de tamaño.

**Movimiento y parpadeo:** ninguno. No hay transición de entrada, ni blur-up, ni
placeholder animado — eso exigiría JavaScript o un data-URI incrustado en el
HTML, y las dos cosas son justo lo que este feature quita. Nada que declarar
para `prefers-reduced-motion`.

---

## Coste de cliente

**Cero JavaScript nuevo, y menos del que hay.** R16 se cumple por construcción:
`<picture>`, `<source>` y `<img>` son HTML; la negociación de formato la hace el
navegador antes de ejecutar nada.

| Archivo                                           | Antes                                          | Después                                    |
| ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `src/components/store/ProductCard.tsx`            | Servidor, importa `next/image`                 | Servidor, sin imports nuevos               |
| `src/app/[slug]/p/[productSlug]/page.tsx`         | Servidor, importa `next/image`                 | Servidor                                   |
| `src/features/admin/components/ProductTable.tsx`  | Servidor, importa `next/image`                 | Servidor                                   |
| `src/features/admin/components/ImageUploader.tsx` | **Isla** (F-011: subida, confirmación, banner) | **Sigue siendo isla, con un import menos** |

Ninguno gana `"use client"`; ninguno lo necesita, porque no hay estado ni
eventos en un `<picture>`. La prohibición de `AGENTS.md` («nunca en algo que
renderice catálogo») no se roza siquiera.

Sobre el **criterio 7** (`check-bundle-budget.mjs` sigue en 0 sin subir
`BUDGET_KB`): el componente cliente de `next/image` deja de estar referenciado
por las páginas de tienda, así que el número **debería bajar**. Si por lo que
sea no bajase, tampoco sube: no se añade un solo byte de cliente. Y `BUDGET_KB`
no se toca en ninguna dirección — bajarlo «porque ahora cabe» convertiría en
muro lo que `AGENTS.md` § El presupuesto de JavaScript no es un muro dice que no
lo es.

**El presupuesto que sí es nuevo es el de imágenes**, y conviene no
confundirlos: 300 KB de bytes de imagen (R7), medidos sobre servidor levantado,
sumando **todas** las tarjetas de la página aunque el `lazy` haga que un
comprador real solo descargue las 4 primeras (~80 KB) hasta que haga scroll. Es
un tope de peor caso, no una predicción.

---

## Textos

Microcopy exacto, en español. **Tres textos cambian y uno es nuevo**; todo lo
demás de F-011 se queda como está.

**Cambian (los obliga I1: quitar ahora borra):**

| Dónde                                       | Antes                                                                                        | Ahora                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ImageUploader.tsx`, segunda línea de ayuda | `Quitar una imagen la saca de tu tienda; el archivo se queda guardado en el almacenamiento.` | `Quitar una imagen la saca de tu tienda y borra el archivo. No se puede deshacer.`             |
| `ImageUploader.tsx`, confirmación en línea  | (solo los botones `Sí, quitar` / `No`)                                                       | Antes de los botones, en `text-xs`: `Se borra el archivo.` Los dos botones no cambian de texto |
| `ImageUploader.tsx`, banner tras quitar     | `Quitamos la imagen de tu producto.`                                                         | `Quitamos la imagen y borramos el archivo.`                                                    |

**Nuevo (E3, la variante quedó por encima de los 20 KB):**

| Situación                                    | Texto                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Banner, todas subieron y alguna quedó pesada | `Alert tone="warning"`: `Subimos 3 imágenes. 1 quedó pesada y puede verse lenta con datos móviles.`  |
| Lo mismo con una sola imagen                 | `Alert tone="warning"`: `Subimos 1 imagen, pero quedó pesada y puede verse lenta con datos móviles.` |
| Línea de esa imagen en la lista de estado    | `foto-3.jpg — Lista, pero pesada`                                                                    |
| Consejo, una sola vez debajo del banner      | `Se guardó igual. Si puedes, vuelve a subirla más chica o con menos detalle de fondo.`               |

El aviso **nunca** usa `tone="danger"` ni la palabra «error»: la imagen se
guardó y el producto está bien. Y no dice «20 KB» ni «AVIF»: un tendero no tiene
por qué saber qué es eso; sabe lo que es que su tienda se vea lenta.

**Distintivo de imagen ajena al bucket** (galería del editor):
`Badge tone="muted"` con `Imagen externa`. Sustituye al
`Badge tone="warning"` `No se puede mostrar` de F-011, que describía un fallo
que ya no ocurre.

**No cambia nada de:** `Sin imagen` (los cuatro sitios),
`JPG, PNG, WebP o AVIF. Hasta 4 MB cada una y 8 en total.`,
`Agregar imágenes`, `Principal`, `Hacer principal`, `Quitar`, `Sí, quitar`,
`No`, `Subiendo…`, `Lista`, `Subimos N imágenes.`, `Subimos N de M imágenes.`,
ni ninguno de los mensajes de error de `uploadErrorMessage`.

---

## Verificación visual

Doce pasos. `V1`–`V6` son los que **no** pude ejecutar (§ Lo que NO verifiqué);
`V7`–`V12` son ejecutables sin ojo humano y su sitio natural es
`.agent/specs/F-023/smoke.sh`, donde ya viven los criterios 1, 3, 4, 5 y 6.

**Datos necesarios en los tres primeros:** una tienda publicada con **al menos
15 productos con imagen real** subida por el pipeline de F-023 (I5: el seed no
pone ninguna; el cómo es de `sdd-architect`), más **un producto con una URL
heredada de F-011** y **un producto sin imágenes**, para que E8 y E9 se vean en
la misma pantalla que el caso normal.

| #   | Qué mirar                                                                                                                                                 | Dónde / viewport                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| V1  | La rejilla del catálogo **no se movió ni un píxel** respecto a la captura previa al cambio: mismo alto de tarjeta, mismo recorte, misma cinta `Destacado` | `/[slug]` a 360, 768 y 1280                       |
| V2  | El producto sin imagen y el de URL heredada **no destacan**: uno es un cuadro gris con `Sin imagen` legible, el otro se ve como cualquier otra tarjeta    | `/[slug]` a 360 y 1280                            |
| V3  | La ficha: la foto llena su caja, la columna de datos no se descuelga, y a 768 las dos columnas siguen siendo iguales                                      | `/[slug]/p/[productSlug]` a 360, 768, 1280        |
| V4  | Modo oscuro: el hueco `Sin imagen` se lee (5,99:1 calculado, confirmarlo con el ojo) y el borde de la caja no desaparece contra `bg-surface`              | `/[slug]` con el sistema en oscuro                |
| V5  | Panel: la cuadrícula de la galería y las miniaturas del listado se ven nítidas; la miniatura sin imagen es un cuadro gris limpio, sin texto partido       | `/admin/tiendas/<id>/productos` y el editor, 1280 |
| V6  | **El juicio de D3**: en un escritorio retina (DPR 2) a 1280, ¿la tarjeta se ve aceptablemente nítida con la variante de 400? Si no, el remedio está en D3 | `/[slug]` a 1280, DPR 2                           |
| V7  | Ninguna URL de `/_next/image` en el HTML de las tres páginas de tienda (criterio 2)                                                                       | `curl` + `grep -c`                                |
| V8  | Cada `<picture>` de tarjeta tiene **exactamente un** candidato AVIF y **uno** WebP, y el `<img>` apunta al WebP de 400 (D3, D5, criterio 4)               | `curl` + parseo                                   |
| V9  | El `<picture>` de la ficha tiene **dos** candidatos por formato con `400w`/`800w` y el `sizes` con `calc()` de § 2                                        | `curl` + parseo                                   |
| V10 | Las 4 primeras tarjetas **sin** `loading="lazy"` y la primera con `fetchpriority="high"`; **todas** las demás con `loading="lazy"`                        | `curl` + parseo                                   |
| V11 | Ninguna variante AVIF de tarjeta pasa de 20 480 B, y la suma de las 15 queda bajo 307 200 B (R8, R7, criterio 3)                                          | `HEAD` sobre cada URL                             |
| V12 | El producto sin imágenes no emite **ninguna** petición de imagen: cero `<img>` y cero `<source>` en su tarjeta (E8)                                       | `curl` + parseo                                   |

`V11` tiene una trampa que conviene dejar escrita: la comprobación de
presupuesto lee candidatos **de dentro de un `<picture>`**, así que una imagen
heredada (R11), que se pinta como `<img>` suelto, **no se cuenta** — y puede
pesar hasta 4 MB. No es un fallo de la comprobación, es su alcance: el
presupuesto mide lo que F-023 genera. Consecuencia práctica: los datos con los
que se mide el criterio 3 tienen que estar generados por este pipeline, no
sembrados a mano con URLs cualesquiera, o la medición sale verde midiendo el
producto equivocado.

---

## Cómo encaja con `architecture.md`

Cinco suposiciones. Ninguna cambia una pantalla; cambian nombres o de dónde sale
una URL.

| #   | Suposición                                                                                                                                               | Si él decide otra cosa                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | La función pura de derivación devuelve, dada la URL del original, las **cuatro** URLs (400/800 × avif/webp) o `null` si esa URL no tiene variantes (R11) | Da igual la firma: el componente pregunta y ramifica. Solo necesita distinguir «hay variantes» de «no hay»                                                     |
| B2  | Las variantes se generan **cuadradas**, con recorte centrado, a 400×400 y 800×800 (D2)                                                                   | Si decide conservar la relación de aspecto, caen los `width`/`height` exactos y el `width`/`height` del `openGraph`; el resto del marcado aguanta              |
| B3  | Los anchos, las escaleras de calidad, el tope de 20 KB y `CATALOG_EAGER_IMAGE_COUNT` viven en `src/constants/media.ts` (R2)                              | Otro archivo de `src/constants/` sirve igual                                                                                                                   |
| B4  | El componente de `<picture>` es de **servidor** y puede renderizarse dentro de la isla `ImageUploader.tsx`                                               | Si por algún motivo tuviera que ser cliente, el panel sobreviviría (VE3 de F-011: `check:bundle` no mide `/admin`), pero la tienda **no**: ahí es innegociable |
| B5  | El aviso de E3 viaja en el `201` del endpoint como un campo opcional junto a `url` e `imageUrls`, por imagen                                             | Si viaja por otro camino, el texto y el `tone` de § Textos no cambian; solo cambia quién los dispara                                                           |

---

## Preguntas al humano

**Ninguna.** No queda ninguna decisión de diseño abierta: los anchos (D1), el
recorte (D2), el número de candidatos (D3), las calidades (D4) y el respaldo
(D5) están cerrados con su justificación, y las cuatro pantallas tienen todos
sus estados escritos.

Dos cosas que **no** son preguntas pero conviene que el humano vea al firmar el
plan, porque son cambios de comportamiento visibles que él no pidió
explícitamente:

1. **Quitar una imagen pasa a borrar el archivo** y tres textos del panel se
   reescriben para no mentir (§ Textos). Es consecuencia directa de R9/I1, que
   ya están en la spec `listo`; lo señalo porque es lo único de este feature que
   un admin nota como pérdida.
2. **La miniatura del listado del panel se encarece** de ~2 KB a ~20 KB por
   fila (§ 4), porque R2 solo permite dos anchos y ninguno es de 48 px. Está
   acotado con `lazy` y cuantificado; si el número molesta, la palanca barata es
   `ADMIN_PRODUCTS_PAGE_SIZE`, no un tercer ancho.
