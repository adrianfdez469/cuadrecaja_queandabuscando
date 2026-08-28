---
feature: F-023
agente: sdd-architect
actualizado: 2026-08-28T16:47:38Z
estado: listo
---

## Estado actual relevante

Leído, no supuesto. Lo que ya existe y este feature reutiliza tal cual:

| Pieza                                                                                                                                                                                  | Qué hace hoy                                                                                                                                      | Qué le pasa en F-023                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/lib/supabase/storage.ts`                                                                                                                                                          | Único módulo que habla con la API de Storage. `storageAvailability()`, `uploadStoreObject()`, `publicUrlFor()`, `publicUrlPrefix()`. Nunca lanza. | **Se extiende** con subida en lote, borrado por claves y borrado por prefijo |
| `src/features/admin/storagePaths.ts`                                                                                                                                                   | `objectPathFor({storeId, storeProductId, ext})` → `stores/<storeId>/products/<storeProductId>/<uuid>.<ext>`                                       | **Cambia de forma** (mismo nombre, misma firma, otra ruta)                   |
| `src/lib/imageType.ts`                                                                                                                                                                 | `detectImageMime()` por números mágicos, `extensionForMime()`                                                                                     | Sin cambios. Sigue siendo la puerta de entrada                               |
| `src/constants/media.ts`                                                                                                                                                               | `IMAGE_MAX_BYTES`, `IMAGE_ALLOWED_MIME`, `IMAGE_EXTENSION_FOR_MIME`, `PRODUCT_MAX_IMAGES`                                                         | **Gana** el juego de variantes, el tope por imagen y el tope de píxeles      |
| `src/features/admin/server/mutations.ts`                                                                                                                                               | Único escritor del panel. `commit()` privado escribe y revalida. `appendProductImage`, `saveProduct`                                              | **Gana** la generación al subir y el borrado de objetos tras `commit()`      |
| `src/app/api/admin/stores/[storeId]/products/[storeProductId]/images/route.ts`                                                                                                         | Autoriza → 409 tope → 503 Storage → `formData` → sniff → `appendProductImage`                                                                     | Mismo orden; una etapa nueva (codificar) entre el sniff y la subida          |
| `src/features/sync/server/handlers/product.ts` (95-107)                                                                                                                                | Una sola rama para `DELETE` y `publishToStore:false`: borrado suave                                                                               | **Se parte** en dos (R10)                                                    |
| `src/features/sync/server/processBatch.ts`                                                                                                                                             | Recoge los `HandlerOutcome` y revalida **una vez al final** del lote                                                                              | **Gana** el drenaje de purgas, después de revalidar                          |
| `src/components/store/ProductCard.tsx`, `src/app/[slug]/p/[productSlug]/page.tsx`, `src/features/admin/components/ProductTable.tsx`, `src/features/admin/components/ImageUploader.tsx` | Los **cuatro** sitios que importan `next/image`                                                                                                   | Los cuatro pasan a un componente compartido nuevo                            |
| `next.config.ts`                                                                                                                                                                       | `formats`, `remotePatterns` derivados de la URL de Supabase, `dangerouslyAllowLocalIP`                                                            | Los tres se van; queda `images: { unoptimized: true }` (R1)                  |
| `scripts/check-bundle-budget.mjs`                                                                                                                                                      | Presupuesto de JS de cliente, con guardia de «ninguna tienda publicada»                                                                           | No se toca. Es el **molde** del guion de imágenes                            |
| `prisma/seed.ts`                                                                                                                                                                       | 15 productos en `tienda-demo`; nunca escribe `imageUrls`                                                                                          | **Gana** una etapa de siembra de imágenes, condicional a Storage             |
| `docker-compose.yml` + `docker/`                                                                                                                                                       | Emulador de Storage real (4 servicios), bucket público `store-media`                                                                              | Sin cambios. Ya sirve objetos estáticos con su `content-type`                |

### Cinco cosas que solo se ven leyendo, y que cambian el diseño

1. **`next/image` es un componente de cliente.** Los cuatro call sites de
   arriba arrastran su runtime al bundle. Quitarlo hace **bajar** el número de
   `npm run check:bundle`, no subirlo: el criterio 7 se cumple por sustracción.
2. **`sharp` ya está en la lista por defecto de `serverExternalPackages` de
   Next** (`node_modules/next/dist/lib/server-external-packages.jsonc`, línea
   88). Añadirlo como dependencia **no** exige tocar `next.config.ts` ni luchar
   con el bundler: Next lo deja fuera del bundle del servidor por sí solo.
3. **La API de Storage no borra por prefijo.** `.remove()` recibe claves
   explícitas y `.list()` **no es recursiva**: devuelve un nivel, con las
   «carpetas» como entradas de `id: null`. Con el layout que propone este
   documento, E11 son dos niveles de listado (1 + nº de imágenes ≤ 9 llamadas),
   no una.
4. **La revalidación del sync ocurre al final del lote**, en
   `processBatch.ts:80-93`, no dentro del handler. R14 exige borrar el objeto
   **después** de escribir _y revalidar_: por eso la purga no puede vivir dentro
   de `handleProduct`, tiene que viajar en el `HandlerOutcome`.
5. **`@next/next/no-img-element` es `warn`, no `error`**
   (`node_modules/@next/eslint-plugin-next/dist/index.js:87`), y `npm run lint`
   corre sin `--max-warnings`. Un `<img>` no rompe el sensor, pero deja ruido en
   cada ejecución: se apaga a propósito, con comentario, en un `files:` acotado
   de `eslint.config.mjs`.

## Decisión

**Una imagen deja de ser un objeto y pasa a ser un directorio.** Al subir, la
app decodifica una vez con `sharp`, emite el juego de variantes (dos anchos × dos
formatos) y sube los cinco objetos —original incluido— bajo un directorio propio
identificado por `uuid`. `imageUrls` sigue guardando **una** URL, la del
original, y todo lo demás se **deriva de esa cadena** con una función pura que no
consulta ni la base ni el bucket. La tienda pinta un `<picture>` con dos
`<source>` y un `<img>` de respaldo, todo desde el CDN de Supabase, y
`next.config.ts` apaga el optimizador para que nadie pueda volver a encenderlo
por descuido.

Las tres decisiones que la spec me dejó abiertas, resueltas:

- **(a) Forma de las rutas y función de derivación** → el `uuid` deja de ser un
  nombre de archivo y pasa a ser un **directorio**; dentro, el original se llama
  literalmente `original.<ext>` y cada variante `w<ancho>.<formato>`. Una URL de
  F-011 termina en `<uuid>.<ext>`; una de F-023 termina en `<uuid>/original.<ext>`.
  Distinguibles mirando **solo la ruta** (R11), y todo lo de una imagen cuelga de
  un prefijo listable y borrable de una vez.
- **(b) Codificador y runtime** → `sharp`, en un módulo nuevo de `src/lib/` que
  es el único autorizado a importarlo, invocado en runtime Node dentro de la
  petición de subida (SP1). Ver § El codificador.
- **(c) Presupuesto de imágenes** → guion propio con código de salida, llamado
  desde `.agent/specs/F-023/smoke.sh`. **No** una etapa nueva de
  `.agent/verify.sh`. Ver § El presupuesto de imágenes, con los tres motivos.

### Alternativas descartadas, una línea cada una

- **Transformación de imágenes de Supabase** — cerrada por SP1 (de pago en
  algunos planes) y volvería a ser trabajo por petición.
- **`images.unoptimized` dejando `<Image>` en su sitio** — Next emitiría el
  `<img>` con el original de 4 MB y sin `<picture>`: ni R4 ni R7.
- **Un `loader` propio de `next/image`** — sigue arrastrando el componente de
  cliente al bundle y añade una indirección para producir la misma URL estática
  que el marcado ya puede escribir.
- **`@jsquash/avif` + `@jsquash/webp` (WASM)** — corre en cualquier runtime, pero
  codifica AVIF varias veces más lento que libvips; una entrada de 4 MB /
  8000×8000 (caso límite explícito de la spec) se comería el tiempo de la
  función.
- **`@squoosh/lib`** — archivado por Google, sin mantenimiento.
- **Generar las variantes en un trabajo en segundo plano** — no hay cola en este
  repo (ADR 0015, «sin broker todavía») y SP1 fija que ocurre en la petición.
- **Guardar las URLs de las variantes en la base (`imageUrls` como JSON)** —
  rompe R5, el contrato del panel y el `.refine()` de
  `src/features/admin/schemas.ts:43`, y obliga a un backfill que R11 hace
  innecesario.
- **Recortar a cuadrado al generar** (permitiría emitir `width`/`height` y
  ahorrar bytes) — la spec pone «recorte» explícitamente fuera de alcance. Se
  deja anotado para `sdd-designer` como opción, no como decisión mía.
- **Etapa nueva `images` en `.agent/verify.sh`** — ver § El presupuesto de
  imágenes; rompería el CI y el propio `npm run check:harness`.

## Componentes

Las capas son las de `AGENTS.md`. «(por crear)» marca lo que todavía no existe:
por la convención de `AGENTS.md` § Cosas que muerden, esas rutas van **sin**
comillas invertidas hasta que existan.

### Nuevos

| Componente                    | Capa                 | Responsabilidad                                                                                                                                                                                                                           | Archivo                                           |
| ----------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Derivación de variantes       | `src/lib/`           | **Puro y sin entorno.** `deriveImageVariants(url)`, `imageObjectNamesFor(originalName)`, `productObjectPrefix()`, `socialImageUrl(url)`. Sin `node:crypto`, sin Prisma, sin React: importable también desde el árbol de cliente del panel | src/lib/imageVariants.ts (por crear)              |
| Codificador                   | `src/lib/`           | **El único módulo que importa `sharp`.** `encodeImageVariants(bytes, mime)` → resultado discriminado. Nunca lanza                                                                                                                         | src/lib/imageEncoder.ts (por crear)               |
| Imagen responsiva             | `src/components/ui/` | Server component sin dominio: `<picture>` AVIF/WebP + `<img>` de respaldo, o `<img>` simple para una URL heredada (R11). Cero JavaScript de cliente                                                                                       | src/components/ui/ResponsiveImage.tsx (por crear) |
| Guarda de fronteras de imagen | prueba (`node`)      | (a) nadie bajo `src/` importa `next/image`; (b) solo el codificador importa `sharp`; (c) solo `src/lib/supabase/storage.ts` llama a `.remove(`/`.list(`                                                                                   | src/lib/boundaries.test.ts (por crear)            |
| Presupuesto de peso de imagen | `scripts/`           | Pide el HTML de una tienda levantada, extrae el candidato AVIF de menor ancho de cada `<picture>`, hace `HEAD`, suma y compara con 300 KB. Falla en medición vacía                                                                        | scripts/check-image-budget.mjs (por crear)        |
| Fixture de siembra            | datos                | Una fotografía real (≥ 1200 px de ancho, no un color plano) para que el criterio 3 mida algo                                                                                                                                              | prisma/fixtures/producto-demo.jpg (por crear)     |
| Guion de runtime              | arnés                | Los criterios 1, 3, 4, 5 y 6 contra la app levantada y el emulador                                                                                                                                                                        | `.agent/specs/F-023/smoke.sh` (por crear)         |

Pruebas unitarias nuevas que el diseño exige (el detalle de casos es de
`sdd-tester`): src/lib/imageVariants.test.ts, src/lib/imageEncoder.test.ts y
src/components/ui/ResponsiveImage.test.tsx, todas por crear.

### Modificados

| Archivo                                                                        | Cambio                                                                                                                                                 | Por qué                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `src/lib/supabase/storage.ts`                                                  | `+ uploadStoreObjects()`, `+ removeStoreObjects()`, `+ removeStoreObjectsUnder()`, `+ objectPathOf()`; `uploadStoreObject()` gana `{upsert}`           | R14: nadie más habla con Storage                         |
| `src/features/admin/storagePaths.ts`                                           | `objectPathFor()` mantiene nombre y firma, devuelve `…/<uuid>/original.<ext>`                                                                          | El fichero **no** se borra (ver § Qué se rompe, punto 6) |
| `src/constants/media.ts`                                                       | `+ IMAGE_VARIANT_WIDTHS`, `+ IMAGE_VARIANT_FORMATS`, `+ IMAGE_ORIGINAL_BASENAME`, `+ IMAGE_VARIANT_MAX_BYTES`, `+ IMAGE_MAX_PIXELS`, `+ IMAGE_QUALITY` | R2: nada de magic numbers                                |
| `src/features/admin/server/mutations.ts`                                       | `appendProductImage` codifica y sube el juego; `saveProduct` purga los objetos de las URLs que desaparecieron, **después** de `commit()`               | R6, R9, R14                                              |
| `src/app/api/admin/stores/[storeId]/products/[storeProductId]/images/route.ts` | Etapa de codificación entre el sniff y la escritura; `runtime`/`maxDuration` literales; `invalidFile("decode")`                                        | SP1, caso límite «archivo corrupto»                      |
| `src/features/sync/server/handlers/types.ts`                                   | `HandlerOutcome` gana `purgeObjectPrefix?: string`                                                                                                     | R14: purgar después de revalidar                         |
| `src/features/sync/server/handlers/product.ts`                                 | La rama 95-107 se parte: `DELETE` vacía `imageUrls` y reporta el prefijo; `publishToStore:false` no                                                    | R10, E11, E12                                            |
| `src/features/sync/server/processBatch.ts`                                     | Recoge los prefijos y los drena **después** de `revalidateStores`/`revalidateSlugs`                                                                    | R13, R14                                                 |
| `src/components/store/ProductCard.tsx`                                         | `<Image>` → `<ResponsiveImage>`                                                                                                                        | R1, R4                                                   |
| `src/app/[slug]/p/[productSlug]/page.tsx`                                      | `<Image>` → `<ResponsiveImage priority>`; `openGraph.images` pasa por `socialImageUrl()`                                                               | R4, R15                                                  |
| `src/features/admin/components/ProductTable.tsx`                               | `<Image>` → `<ResponsiveImage>`                                                                                                                        | «ninguna pantalla pide `/_next/image`»                   |
| `src/features/admin/components/ImageUploader.tsx`                              | `<Image>` → `<ResponsiveImage>`; el copy de la línea 169 deja de mentir (I1)                                                                           | I1; el texto exacto es de `sdd-designer`                 |
| `next.config.ts`                                                               | `images: { unoptimized: true }` y fuera `formats`, `remotePatterns`, `dangerouslyAllowLocalIP`                                                         | R1                                                       |
| `eslint.config.mjs`                                                            | `@next/next/no-img-element: "off"` para src/components/ui/ResponsiveImage.tsx                                                                          | Un `<img>` deliberado no es un aviso útil                |
| `package.json`                                                                 | `+ "sharp"` en `dependencies`; `+ "check:images"` en `scripts`                                                                                         | El codificador y su guion                                |
| `prisma/seed.ts`                                                               | Etapa `seedProductImages`, condicional a `storageAvailability()`                                                                                       | I5                                                       |
| `src/features/admin/storagePaths.test.ts`                                      | La expresión regular del primer caso admite el directorio                                                                                              | Ver § Qué se rompe                                       |
| `src/features/admin/server/mutations.test.ts`                                  | El `vi.mock("@/lib/supabase/storage")` gana los exports nuevos                                                                                         | Ver § Qué se rompe                                       |
| `src/features/sync/server/handlers/product.test.ts`                            | Casos nuevos de E11/E12 sobre `purgeObjectPrefix`                                                                                                      | Criterio 6, mitad simétrica                              |

## Flujo de datos

### Rutas de objeto — la decisión (a)

Hoy (F-011), una imagen es **un objeto**:

```
stores/<storeId>/products/<storeProductId>/<uuid>.jpg
```

Desde F-023, una imagen es **un directorio de cinco objetos**:

```
stores/<storeId>/products/<storeProductId>/<uuid>/original.jpg   ← lo que va en imageUrls
stores/<storeId>/products/<storeProductId>/<uuid>/w400.avif
stores/<storeId>/products/<storeProductId>/<uuid>/w400.webp
stores/<storeId>/products/<storeProductId>/<uuid>/w800.avif
stores/<storeId>/products/<storeProductId>/<uuid>/w800.webp
```

Los anchos `400`/`800` son **indicativos**: los fija `sdd-designer` (R2) y viven
en `src/constants/media.ts`. Lo que este documento fija es la **gramática** del
nombre: `w<ancho>.<formato>` y `original.<ext>`.

Las tres condiciones que § Datos y contrato de la spec exige, cumplidas:

- **(a) La derivación no consulta nada.** Es sustitución del último segmento de
  una cadena. Sin `fetch`, sin Prisma, sin variables de entorno.
- **(b) Una URL de F-011 es distinguible por su ruta.** El último segmento de una
  URL de F-011 es `<uuid>.<ext>` y su penúltimo es el `storeProductId`; el de una
  de F-023 es literalmente `original.<ext>` y su penúltimo es un `uuid`.
  `randomUUID()` no produce nunca la cadena `original`, así que la ambigüedad no
  existe ni siquiera en teoría. La derivación exige **las dos** condiciones —
  nombre `original.<ext>` **y** penúltimo segmento con forma de UUID v4— para
  que una URL ajena que casualmente termine en `/original.jpg` tampoco entre.
- **(c) Todo lo de una imagen cuelga de un prefijo listable**, el directorio
  `<uuid>/`; y todo lo de un producto cuelga de
  `stores/<storeId>/products/<storeProductId>/`, que es el que E11 borra entero.

### El contrato de la derivación (R5)

En src/lib/imageVariants.ts (por crear), puro y sin entorno:

```ts
export type ImageVariant = { width: number; url: string };
export type ImageVariantSet = {
  /** Prefijo común de la imagen: la URL hasta el directorio <uuid>, con la barra final. */
  dir: string;
  avif: ImageVariant[]; // ordenados de menor a mayor ancho
  webp: ImageVariant[];
  /** El <img> de respaldo: el WebP del ancho de tarjeta (R4). */
  fallbackUrl: string;
  /** Lo que R15 manda al openGraph: el WebP del ancho de detalle. */
  socialUrl: string;
};

/** `null` = URL heredada de F-011, o ajena al bucket → `<img>` simple (R11, E9). */
export function deriveImageVariants(url: string): ImageVariantSet | null;

/** Todos los nombres de objeto de una imagen, a partir del nombre del original.
 *  Lo usan la subida (para escribir) y el borrado del panel (para borrar). */
export function imageObjectNamesFor(ext: string): string[];

/** `stores/<storeId>/products/<storeProductId>/` — el prefijo que E11 borra. */
export function productObjectPrefix(input: { storeId: string; storeProductId: string }): string;

/** R15. Devuelve la URL heredada tal cual si no hay variantes. */
export function socialImageUrl(url: string): string;
```

`node:crypto` **no** entra en este módulo: la generación del `uuid` se queda en
`src/features/admin/storagePaths.ts`, que es servidor. Esa separación es lo que
permite que `ImageUploader.tsx` —que es `"use client"`— importe la derivación sin
arrastrar un módulo de Node al bundle.

### Subida (E1, E2, E3, R6)

```
POST multipart
  → guardAdminStore                                  0 queries → 401/403
  → getProductForEdit                                1 query   → 403 E24 / 409 E23   (antes de leer el cuerpo)
  → storageAvailability()                            0 queries → 503
  → request.formData() + tamaño + detectImageMime()            → 400 empty|too_large|mime
  → encodeImageVariants(bytes, mime)                 CPU, 0 I/O → 400 decode | 503 encode_failed
  → dir = objectPathFor({storeId, storeProductId, ext})         un uuid nuevo por imagen
  → uploadStoreObjects([original, 4 variantes])      5 PUT en paralelo
        cualquiera falla → removeStoreObjects(lo ya subido)  →  503, imageUrls INTACTO   (E2/R6)
  → UPDATE imageUrls = push(url del original)        1 query atómico
  → revalidateStores([slug])                         dentro de commit()
  → 201 { url, imageUrls, warning? }
```

Tres propiedades que esta secuencia compra:

- **R6 (todo-o-nada) sale gratis** porque la codificación va **antes** de tocar
  Storage: el 90 % de los fallos posibles (archivo corrupto, formato imposible,
  timeout de CPU) ocurren cuando todavía no hay ni un objeto escrito. La única
  mitad mala que queda es «objetos subidos, fila sin escribir», que es
  exactamente la que F-011 ya aceptaba y que la spec vuelve a aceptar («los
  objetos ya subidos quedan como huérfanos conocidos»). La limpieza best-effort
  de la línea del fallo la reduce en la práctica a cero.
- **Nunca hay una URL rota**, porque el `push` es lo último.
- **El tope de 8 sigue siendo check-then-act sin bloqueo**, igual que en F-011,
  y por el mismo motivo (el pooler corre en modo transacción). Aceptado allí, no
  se reabre.

`warning` es el campo opcional de E3: el codificador devuelve el tamaño de cada
variante y, si la de tarjeta supera `IMAGE_VARIANT_MAX_BYTES` (R8) tras agotar el
rango de calidad, la respuesta lo arrastra. `ImageUploader.tsx:58` solo lee
`imageUrls`, así que ningún consumidor existente se rompe.

### Quitar o reemplazar una imagen desde el panel (E10, R9, R14)

Hoy «quitar» no es un endpoint: `ImageUploader.handleRemove` recorta el array en
memoria y `ProductForm` lo persiste con el `PUT` del producto, que entra por
`saveProduct`. Ahí es donde se engancha el borrado, y en ningún otro sitio:

```
saveProduct(storeId, storeProductId, body)
  existing = findFirst({ ..., select: { …, imageUrls: true } })   ← +1 columna, +0 round-trips
  updated  = await commit(slug, () => update + reindex)           ← escribe Y revalida
  removed  = existing.imageUrls.filter(u => !body.imageUrls.includes(u))
  if (removed.length) await purge(removed)                        ← DESPUÉS del commit (R14)
  return { kind: "saved", … }
```

Dos detalles que no son cosméticos:

- **`await`, nunca `void`.** En una función serverless, una promesa suelta
  después de que la respuesta salió se cancela con el proceso: el borrado no
  ocurriría la mitad de las veces y el síntoma sería un huérfano intermitente,
  el peor tipo de bug. Cuesta 50-150 ms sobre un `PUT` que ya es interactivo.
- **`purge` es best-effort (R13).** Traduce cada URL con
  `objectPathOf()` —que devuelve `null` para lo que no está bajo nuestro bucket,
  y ahí se para— expande con `imageObjectNamesFor()` y hace **una** llamada
  `removeStoreObjects()` con todas las claves. Si Storage está caído, se
  registra en el log y `saveProduct` devuelve `saved` igual: la fila ya está
  escrita y revalidada.

Una URL heredada de F-011 se traduce a **una** clave (el objeto plano) y se borra
igual. No hay backfill, pero tampoco se acumulan huérfanos nuevos de las filas
viejas.

### Borrado desde el sync (E11, E12, E13, R10, R12, R13, R14)

La rama de `product.ts:95-107` se parte en dos por `operation`, y el handler
**no llama a Storage**:

```ts
if (operation === "DELETE" || !payload.publishToStore) {
  if (!existing) return SKIPPED;
  const terminal = operation === "DELETE"; // R10
  await prisma.storeProduct.update({
    where: { id: existing.id },
    data: {
      deletedAt: new Date(),
      visible: false,
      sourceUpdatedAt: payloadUpdatedAt,
      // Única excepción a ADR 0007 que introduce F-023, acotada al DELETE
      // terminal: se vacía porque su contenido dejó de existir.
      ...(terminal ? { imageUrls: [] } : {}),
    },
  });
  return {
    status: "processed",
    touchedStoreSlug: canonical,
    touchedBrandSlug: store.storefront.slug,
    touchedProductId: existing.id,
    ...(terminal
      ? {
          purgeObjectPrefix: productObjectPrefix({
            storeId: store.id,
            storeProductId: existing.id,
          }),
        }
      : {}),
  };
}
```

El prefijo viaja en el `HandlerOutcome` y lo drena `processBatch.ts`, **después**
de `revalidateStores`/`revalidateSlugs`/`revalidateStorefronts`, junto al resto
de efectos de fin de lote. Tres razones, y las tres son requisitos, no gusto:

1. **R14 lo exige literalmente**: «el borrado del objeto ocurre después de la
   escritura y su revalidación». En el sync la revalidación no está en el
   handler, está al final del lote (`processBatch.ts:80-93`). Purgar dentro del
   handler sería purgar _antes_ de revalidar.
2. **R13 sale por construcción.** El array `results` ya está cerrado cuando se
   drenan las purgas: un fallo de Storage no puede convertir un evento
   `processed` en `failed` porque para entonces el evento ya se reportó. Eso es
   exactamente lo que `AGENTS.md` § Cosas que muerden prohíbe hacer al revés.
3. **El handler se queda testeable sin mocks de red.** E11 y E12 se comprueban
   asertando sobre el `purgeObjectPrefix` del outcome —presente en `DELETE`,
   ausente en `publishToStore:false`—, que es la mitad simétrica que el
   criterio 6 pide verificar en `npm test`. `product.test.ts` no necesita
   `vi.mock("@/lib/supabase/storage")`.

El drenaje deduplica por prefijo (un `Set`), así que un lote con 200 `DELETE` del
mismo producto reentregado hace **una** purga. Y `removeStoreObjectsUnder` es
idempotente (R12): borrar lo ya borrado es éxito, y un `DELETE` reentregado ni
siquiera llega —`sourceUpdatedAt` lo marca `STALE` antes (E13).

`removeStoreObjectsUnder(prefix)` en `src/lib/supabase/storage.ts`:

```
list(prefix)                                  ← 1 llamada; devuelve UN nivel
  entradas con id === null  → son directorios de imagen → list(prefix + name + "/")
  entradas con id !== null  → objetos planos (URLs heredadas de F-011)
remove([...todas las claves])                 ← 1 llamada
```

Dos niveles bastan y son todo el layout que existe; la función lleva un tope
duro de claves y de subdirectorios para que un prefijo inesperadamente enorme no
convierta un evento de sync en una tormenta de peticiones. Listar y no derivar de
`imageUrls` es deliberado: el criterio 6 pide **0 objetos bajo el prefijo**, y
solo el listado se lleva por delante también los huérfanos de una subida que
falló a mitad y los objetos planos de F-011.

### Servido (E5, E6, E7, E8, E9, R1, R4, R16)

`ResponsiveImage` es un server component **sin dominio** —de ahí que viva en
`src/components/ui/` y no en `src/components/store/`: lo usan las dos tiendas y
las dos pantallas del panel, y `AGENTS.md` reserva `components/store/` para lo
público—. Su contrato:

```tsx
<ResponsiveImage
  src={product.imageUrls[0]} // la URL del original, tal como está en la fila
  alt={product.name}
  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
  priority={false}
  className="absolute inset-0 h-full w-full object-cover"
/>
```

- Con variantes → `<picture>` con `<source type="image/avif" srcset="…400w, …800w" sizes>`,
  `<source type="image/webp" …>` y `<img src={fallbackUrl}>` (R4). Sin JPEG de
  respaldo, por el motivo que R4 ya argumenta.
- Sin variantes (`deriveImageVariants` devuelve `null`) → `<img src>` a secas
  (R11, E9). La página no se rompe y la tarjeta sigue pintando el producto.
- `priority` → `fetchpriority="high"` y `loading="eager"`; en su ausencia,
  `loading="lazy"` + `decoding="async"`, que es lo que de verdad protege a una
  tienda con 200 productos (I4).
- **Sin `width`/`height` intrínsecos**, a propósito: no los conocemos sin
  guardarlos, y guardarlos rompería R5. No hay regresión de CLS porque el hueco
  ya lo reserva el contenedor `relative aspect-square` que `<Image fill>` exigía
  y que se conserva tal cual. El `<img>` se posiciona absoluto dentro, como
  hacía `fill`.
- **Cero JavaScript de cliente** (R16): no lleva `"use client"`. Que
  `ImageUploader.tsx` lo importe desde su árbol de cliente lo mete en **ese**
  bundle (el del panel, que no entra en `check:bundle` porque el guion mide la
  página de tienda más pesada), y no en el de la tienda.

`E8` (producto sin imágenes) no llega nunca al componente: los call sites ya
tienen su `{image ? … : <div>Sin imagen</div>}` y se conserva.

El diseño responsivo del `<picture>`, los `sizes` exactos, la galería del panel y
el copy de I1 son de `sdd-designer`; aquí solo queda fijado que hay **un**
componente y que su entrada es la URL del original.

### `next.config.ts` (R1)

```ts
const nextConfig: NextConfig = {
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
};
```

`formats`, `remotePatterns` y `dangerouslyAllowLocalIP` se van con el optimizador
tal como R1 manda: sin `remotePatterns` no hay host permitido que optimizar, y
`dangerouslyAllowLocalIP` existía **solo** para que el emulador de
`localhost:54321` no se topara con la protección anti-SSRF del optimizador. Con
`unoptimized: true`, reintroducir un `<Image>` por descuido produce un `<img>`
con la URL cruda: molesto, pero no vuelve a encender el recurso medido. La
segunda mitad de esa defensa es la guarda (a) de src/lib/boundaries.test.ts (por
crear), que falla si algún módulo bajo `src/` vuelve a importar `next/image`
—complemento explícito que el criterio 2 pide.

## El codificador — la decisión (b)

**`sharp`**, dependencia de producción nueva, aislada en src/lib/imageEncoder.ts
(por crear), único módulo autorizado a importarla (guarda (b) de
src/lib/boundaries.test.ts, por crear). El porqué, contra las alternativas ya
listadas:

- Es **libvips**, no una reimplementación: el único codificador AVIF de Node con
  rendimiento de producción y mantenimiento activo.
- Vercel publica binarios precompilados para su runtime de Node y **Next ya lo
  trata como externo del servidor** por defecto
  (`node_modules/next/dist/lib/server-external-packages.jsonc:88`), así que no
  hay que tocar `next.config.ts` ni pelearse con el empaquetado.
- No afecta al criterio 7: `npm run check:bundle` mide JavaScript de **cliente**
  (I6). Sí engorda el despliegue (~30 MB del binario linux-x64) y sí consume CPU
  en la petición de subida, que es lo que SP1 aceptó.

Contrato, del mismo molde que `src/lib/supabase/storage.ts` (**nunca lanza**):

```ts
export type EncodedVariant = {
  width: number;
  format: "avif" | "webp";
  contentType: "image/avif" | "image/webp";
  bytes: Buffer;
};
export type EncodeResult =
  | { ok: true; variants: EncodedVariant[]; heaviestCardBytes: number }
  | { ok: false; reason: "decode_failed" | "too_many_pixels" | "encode_failed" };

export async function encodeImageVariants(
  bytes: Buffer,
  mime: AllowedImageMime,
): Promise<EncodeResult>;
```

Cuatro cosas que el implementador **no** puede omitir, cada una por un motivo
concreto:

1. **`.rotate()` antes de redimensionar.** `sharp` descarta los metadatos al
   codificar, y con ellos la orientación EXIF. Sin esa llamada, la foto de un
   teléfono sale de lado en las cuatro variantes mientras el original se ve
   derecho: el bug más difícil de atribuir de todo este feature.
2. **`limitInputPixels: IMAGE_MAX_PIXELS`.** Un PNG de 4 MB puede declarar
   30000×30000 y reventar la memoria de la función al decodificar. El caso
   límite que la spec **sí** acepta es 8000×8000 = 64 MP, así que el tope se pone
   por encima con margen (80 MP) y por debajo del absurdo. Sobrepasarlo es
   `too_many_pixels` → 400, no un OOM.
3. **Una sola decodificación, cuatro codificaciones.** `const pipeline =
sharp(bytes, {…})` y luego `pipeline.clone().resize(…)` por variante. Decodificar
   cuatro veces multiplica por cuatro la parte cara.
4. **`withoutEnlargement: false`.** La variante `w400` mide **siempre** 400 px de
   ancho, aunque el original mida 300. Es unos bytes de más en un caso raro, y a
   cambio los descriptores `400w`/`800w` del `srcset` que emite la derivación
   pura son **siempre** verdad —que es la única manera de que una función que no
   consulta nada pueda escribirlos.

Presupuesto de tiempo, medido en órdenes de magnitud para que el plan sepa qué
vigilar: decodificar un JPEG de 4 MB ≈ 150 ms; cada WebP ≈ 30-60 ms; cada AVIF ≈
150-900 ms según ancho y `effort`. Total esperado 1,5-2,5 s en el peor caso
admitido, y 300-500 ms para la foto de teléfono típica (~1 MB). El `effort` de
AVIF es la palanca: bajarlo cambia segundos por unos pocos por ciento de tamaño.
Las calidades exactas las fija `sdd-designer` contra R8 y las ajusta
`sdd-implementer` con la medición delante.

`export const maxDuration` en la ruta de subida se escribe como **literal**
(`AGENTS.md` § Cosas que muerden: Next analiza los segment config exports
estáticamente). `export const runtime = "nodejs"` es el valor por defecto de un
route handler; se escribe igualmente, también literal, porque documenta que este
endpoint **no** puede migrar a edge.

## El presupuesto de imágenes — la decisión (c)

**Un guion propio, scripts/check-image-budget.mjs (por crear), invocado desde
`.agent/specs/F-023/smoke.sh` (por crear). No una etapa nueva de
`.agent/verify.sh`.** Tres motivos, en orden de peso:

1. **Una etapa de `--full` corre sin servidor y sin emulador.** El criterio 3
   dice literalmente «medido sobre el servidor levantado», y la única etapa del
   arnés que levanta uno es `smoke`. Una etapa `images` en `STAGES_COMPLETO`
   se ejecutaría en el CI —donde no hay `docker-compose`, ni bucket
   `store-media`, ni imagen sembrada— y estaría en rojo en cada PR.
2. **Lo impide el propio `npm run check:harness`.** Su comprobación 5
   (`scripts/check-harness.mjs`, § «init.sh demands scripts that package.json
   defines») exige que **toda** etapa de `STAGES_COMPLETO` cuyo comando sea un
   `npm run` esté también en la lista que `.agent/init.sh` verifica. Añadir la
   etapa arrastra una modificación del comprobador de entorno para algo que el
   entorno no puede garantizar. Y el criterio 8 incluye `harness`.
3. **Hay precedente exacto y probado.** `scripts/check-bundle-budget.mjs` es un
   guion suelto con código de salida, expuesto por un script de `package.json`.
   Copiar ese molde da `npm run check:images` para el humano y una línea en el
   smoke para el sensor, que es lo único que la spec exige («un comando con
   código de salida y que falle en medición vacía»).

Comportamiento del guion, con las **cuatro** condiciones de salida distinta de 0:

```
node scripts/check-image-budget.mjs [--base http://localhost:3100] [--slug tienda-demo]

1. GET  $BASE/$SLUG
2. de cada <source type="image/avif"> toma el candidato de MENOR ancho (E7, criterio 3)
3. deduplica por URL
4. HEAD de cada una → content-length
5. imprime la tabla por imagen y el total
   exit 1  si el total supera IMAGE_BUDGET_KB (300)
   exit 1  si el conjunto está VACÍO ......................... guardia de medición vacía (I5)
   exit 1  si alguna respuesta no es 200 ..................... una variante 404 mide 0 bytes
   exit 1  si alguna respuesta no trae content-length ........ (cae a GET y cuenta bytes)
   exit 0  en el resto
```

La tercera condición es la que evita el falso verde más peligroso de este
feature: una derivación equivocada produce URLs que no existen, el `HEAD`
devuelve 404, `content-length: 0`, el total da 0 KB y el guion pasaría en verde
midiendo una página con todas las imágenes rotas. Es la misma lección que HD12 de
F-011 dejó escrita dentro de `scripts/check-bundle-budget.mjs`.

`IMAGE_BUDGET_KB = 300` vive **en el guion**, como `BUDGET_KB`, con la misma
convención de `AGENTS.md`: subirlo no es silencioso, se cambia dejando en el
comentario quién, por qué y **la medición**. Duplica en apariencia el
`IMAGE_VARIANT_MAX_BYTES` de `src/constants/media.ts`, pero no son el mismo
número: uno es el total de la página (R7) y el otro el tope por imagen (R8), y la
aritmética que los une (300 KB ÷ 15 productos del seed) queda escrita en los dos
comentarios. Un `.mjs` no puede importar un `.ts`, y ese es exactamente el motivo
por el que `check-bundle-budget.mjs` ya hardcodea su número.

## Sembrar una imagen de verdad (I5)

Sin esto el criterio 3 mide cero bytes y pasa en verde sin comprobar nada. Tres
opciones, y la elegida:

- **(a) `prisma/seed.ts` sube un fixture real por el mismo camino que el panel.**
  Elegida.
- (b) Un guion aparte llamado desde el smoke — deja `npm run dev` sin imágenes y
  obliga a cada feature futuro a conocer el guion.
- (c) Un archivo en `public/` — viola el `.refine()` de prefijo de bucket
  (`src/features/admin/schemas.ts:43`) y E5.

Cómo (a) sobrevive a las dos restricciones que la matarían:

- **El CI corre `npm run seed` dos veces y no tiene Storage.** La etapa empieza
  por `storageAvailability()`; si no está disponible, imprime un aviso y
  **no escribe `imageUrls`**. Es la misma disciplina de `.agent/init.sh` con el
  emulador: `warn`, nunca `bad`. El CI sigue verde y la página que
  `check:bundle` mide sigue siendo la de hoy.
- **El seed tiene que ser idempotente.** El directorio de la imagen sembrada es
  **determinista**, no un `randomUUID()`: un UUID derivado del `storeProductId`,
  de modo que la segunda corrida reescribe los mismos cinco objetos (de ahí el
  `{ upsert: true }` nuevo de `uploadStoreObject`) y **asigna** el mismo array de
  una URL en vez de hacer `push`. Dos corridas, un juego de objetos, un array
  idéntico.

Qué se siembra: **todos** los productos de `tienda-demo`. Con uno solo, el
criterio 3 mediría ~20 KB y pasaría por goleada sin decir nada; con los 15, mide
contra el presupuesto de verdad (15 × el tope de R8 ≈ 300 KB) y cualquier
regresión de calidad o de ancho lo pone en rojo, que es justo la presión que este
feature quiere. Para no pagar 15 codificaciones: se codifica **una vez** el
fixture y se suben los mismos buffers bajo los 15 directorios (~75 PUT contra el
emulador local, unos segundos).

El fixture, prisma/fixtures/producto-demo.jpg (por crear), tiene que ser una
**fotografía real de al menos 1200 px de ancho**. Un color plano o el
`sample.jpg` de 4 KB de F-011 comprimen a casi nada en AVIF y dejarían el
criterio 3 pasando vacuamente, que es la misma trampa que I5 describe con otro
disfraz. Su procedencia y licencia es AP2.

## Contratos

### Storage — la superficie completa tras F-023

Todo en `src/lib/supabase/storage.ts` (R14). Ninguna función lanza; todas
devuelven un resultado discriminado con `StorageFailureReason`.

| Función                                     | Entrada                               | Salida                                                                                                             |
| ------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `storageAvailability()`                     | —                                     | `{ok:true} \| {ok:false, reason}` — sin cambios                                                                    |
| `uploadStoreObject(path, bytes, ct, opts?)` | `opts?: { upsert?: boolean }` (nuevo) | `{ok:true,url} \| {ok:false,reason}` — sin cambios salvo la opción                                                 |
| `uploadStoreObjects(objects)`               | `{path,bytes,contentType}[]`          | `{ok:true,urls} \| {ok:false,reason,uploadedPaths}` — `uploadedPaths` es lo que la limpieza de E2 tiene que borrar |
| `removeStoreObjects(paths)`                 | `string[]` (claves de objeto)         | `{ok:true,removed} \| {ok:false,reason}` — idempotente (R12)                                                       |
| `removeStoreObjectsUnder(prefix)`           | `string`                              | `{ok:true,removed} \| {ok:false,reason}` — listado de dos niveles + remove                                         |
| `objectPathOf(publicUrl)`                   | `string`                              | `string \| null` — inversa de `publicUrlFor`; `null` si no es de nuestro bucket                                    |
| `publicUrlPrefix()`, `publicUrlFor(path)`   | —                                     | Sin cambios                                                                                                        |

### Endpoint de subida

`POST /api/admin/stores/[storeId]/products/[storeProductId]/images`

| Estado  | Cuerpo                                         | Cuándo                                                                                          |
| ------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 201     | `{ url, imageUrls, warning?: "heavy_image" }`  | E1; `warning` es E3                                                                             |
| 400     | `{ error:"INVALID_FILE", reason:"empty" }`     | Sin cambios (F-011)                                                                             |
| 400     | `{ error:"INVALID_FILE", reason:"too_large" }` | Sin cambios (F-011)                                                                             |
| 400     | `{ error:"INVALID_FILE", reason:"mime" }`      | Sin cambios (F-011)                                                                             |
| 400     | `{ error:"INVALID_FILE", reason:"decode" }`    | **Nuevo.** `decode_failed` o `too_many_pixels` del codificador — caso límite «archivo corrupto» |
| 401/403 | Sin cambios                                    | E4/E24                                                                                          |
| 409     | `{ error:"TOO_MANY_IMAGES" }`                  | Sin cambios                                                                                     |
| 503     | `{ error:"STORAGE_UNAVAILABLE", reason }`      | Storage caído **o** `encode_failed`                                                             |

`invalidFile()` en `src/app/api/admin/_lib/respond.ts` amplía su unión de
`"mime" | "too_large" | "empty"` a incluir `"decode"`. Es un cambio de tipo, no
de forma: el cuerpo sigue siendo `{ error, reason }`.

### Zod

**Ninguno cambia.** R5 lo garantiza: `imageUrls` sigue siendo
`z.array(z.string().url()).max(PRODUCT_MAX_IMAGES)` con el `.refine()` de prefijo
de bucket (`src/features/admin/schemas.ts:26-45`), porque lo que se guarda sigue
siendo una URL pública absoluta del original. `src/features/admin/schemas.test.ts`
no se toca.

### Contrato con cuadrecaja

Sin cambios de forma. `docs/sync-contract.md` no sube de versión: no hay campo
nuevo, ni entidad nueva, ni operación nueva. Lo único que cambia es un **efecto**
del lado de queandabuscando en la rama `DELETE` —vaciar `imageUrls` y borrar los
objetos—, y es la única excepción a ADR 0007 que introduce este feature, acotada
al `DELETE` terminal y documentada en la ADR que se propone abajo. `handleStore`,
`handleCategory` y los demás handlers no se tocan.

## Modelo de datos y migraciones

**Ninguna migración.** `StoreProduct.imageUrls String[]`
(`prisma/schema.prisma:388`) no cambia de tipo ni de significado: sigue
guardando URLs públicas absolutas del original, una por imagen, máximo 8. No
hay índice nuevo, no hay columna nueva, no hay tabla nueva. Ninguno de los dos
comandos que `AGENTS.md` marca como prohibidos aparece por ningún lado, ni haría
falta.

Lo que sí es un cambio de datos —y no de esquema— es el vaciado de `imageUrls`
en la rama `DELETE` del sync. No necesita backfill: solo aplica a eventos
futuros.

## Escalabilidad y límites

Números, no adjetivos. «Se rompe primero» = el orden en que se caen las cosas al
multiplicar por 100.

**Subida (la parte cara).** Por imagen: 1 decodificación + 4 codificaciones,
1,5-2,5 s de CPU en el peor caso admitido (4 MB, 64 MP) y 300-500 ms en el caso
típico; 5 PUT concurrentes contra Storage (≈ 1 round-trip de reloj de pared) en
vez de 1; 1 `UPDATE`. **Round-trips a Postgres: los mismos que hoy** (1 lectura
del producto + 1 `update`).

- **Lo primero que se rompe: la memoria de la función.** Una imagen de 64 MP
  decodificada a RGBA ocupa ~256 MB. Con la función por defecto de Vercel
  (1024 MB) eso deja sitio para **una** subida grande a la vez por instancia;
  dos concurrentes en el mismo contenedor son un OOM. Mitigación en el diseño:
  `limitInputPixels` (80 MP) y `sharp.concurrency(1)` por proceso, que además
  evita que cuatro hilos de libvips se peleen por el CPU de una función de
  vCPU fraccionada. Umbral aproximado: ~2 subidas concurrentes de más de 30 MP
  por instancia.
- **Lo segundo: el tiempo de función.** Un lote de 8 imágenes seleccionadas de
  golpe en el panel se sube **secuencialmente**
  (`ImageUploader.handleFiles` hace un `for` con `await`, hoy ya), así que son 8
  peticiones de ~2 s, no una de 16 s. Cada una está muy por debajo del
  `maxDuration`. No cambia nada aquí; se anota porque parece un riesgo y no lo es.

**Servido.** Cero coste por petición: la app deja de tocar la imagen. El HTML
crece por `<picture>` (dos `<source>` con dos candidatos ≈ 4 URL absolutas de
Supabase, ~520 B por imagen) y **decrece** por lo que se va: un `<Image fill>`
emite hoy un `srcset` con toda la escala de `deviceSizes` (~1,6 KB por imagen)
más el `src` de `/_next/image`. Neto: el HTML de `/[slug]` con 15 productos se
**reduce**, y con él lo que decide el primer pintado. El número exacto lo dirá
`check:bundle`, que ya imprime el HTML gzip de la página más pesada.

- **Lo primero que se rompe al escalar aquí no es el peso, es la paginación.**
  `src/app/[slug]/page.tsx` no pagina (I4): una tienda con 200 productos emite
  200 `<picture>`. El presupuesto de 300 KB se mide contra el catálogo de
  referencia; lo que de verdad protege al comprador es el tope por imagen (R8)
  más el `loading="lazy"` de todo lo que no está en el primer pliegue. Umbral:
  a partir de ~60 productos el HTML de la página supera los 30 KB gzip y la
  paginación pasa a ser un feature necesario, no una mejora.

**Bucket.** 5 objetos por imagen en vez de 1, y ~1,4× los bytes (el original
domina: R3 lo conserva sin recomprimir). A escala: 100 tiendas × 500 productos ×
2 imágenes = 100.000 imágenes = **500.000 objetos** y del orden de 200 GB,
dominados por los originales. Eso —no el número de objetos— es el primer coste
que aparece. Si un día muerde, la salida es mover los originales a un prefijo
frío o dejar de conservarlos, lo que reabriría R3 con una ADR nueva.

**Borrado por prefijo.** 1 + (nº de imágenes) llamadas de listado ≤ 9, más 1 de
`remove`, por producto borrado. Un lote de sync con 500 `DELETE` de productos con
imágenes dispararía ~5.000 llamadas a Storage al final del lote. Umbral y
mitigación: el drenaje se ejecuta con concurrencia acotada y con tope de claves;
si un cliente empieza a mandar purgas masivas, el siguiente paso es una cola —y
no la hay (ADR 0015), así que es una pregunta, no un atajo.

**JavaScript de cliente (criterio 7, R16).** Se **va** el runtime de
`next/image` de la página de tienda y no entra nada nuevo: `ResponsiveImage` es
servidor allí. Delta esperado sobre `BUDGET_KB`: **negativo o cero**. Si sube,
es señal de que un componente de catálogo ganó un `"use client"`, que es
exactamente para lo que existe el guion. `BUDGET_KB` **no se sube** en este
feature.

**Base de datos.** Cero queries nuevas, cero N+1, cero `$transaction` (el pooler
corre en modo transacción). `saveProduct` añade **una columna** a un `select` que
ya se hacía. El handler del sync no añade ninguna.

## Patrones a seguir / antipatrones a evitar

- **Storage solo por `src/lib/supabase/storage.ts`** (R14, F-011 R17). La guarda
  (c) de src/lib/boundaries.test.ts (por crear) lo respalda con un grep, porque
  un `route.ts` queda fuera de la regla de ESLint que solo cubre `*.tsx`.
- **Toda escritura del panel por `commit()`** (`AGENTS.md` § Frontera de
  escritura, ADR 0017). El borrado de objetos va **después** de `commit()`, nunca
  dentro de la función que escribe.
- **`export const revalidate`/`runtime`/`maxDuration` literales** (`AGENTS.md` §
  Cosas que muerden). Una constante importada rompe el build con un mensaje que
  no dice qué archivo.
- **Nada de `"use client"` en algo que renderice catálogo** (`AGENTS.md` §
  Prohibiciones). `ResponsiveImage` es la pieza que hace posible cumplirlo: hoy
  el catálogo depende de `next/image`, que es cliente.
- **Nada de magic numbers**: anchos, formatos, calidades, tope por imagen y tope
  de píxeles a `src/constants/media.ts` (R2).
- **Idempotencia del sync** (`AGENTS.md` § Cosas que muerden). El guardia de
  `sourceUpdatedAt` no se toca; el borrado de objetos es idempotente por
  construcción (R12) y no puede convertir un evento en `failed` (R13).
- **No armar a mano el array de slugs a revalidar** (`AGENTS.md` §
  Prohibiciones). Este feature no toca la revalidación: reutiliza
  `revalidateStores`/`expandBrandTouch` exactamente como están.
- **Un archivo que todavía no existe no se cita entre comillas invertidas**
  (`AGENTS.md` § Cosas que muerden). Este documento lo respeta y el plan tiene
  que seguir respetándolo etapa a etapa, o `npm run check:harness` pone en rojo
  el criterio 8.
- **Antipatrón: `void purge(...)`.** Una promesa sin `await` después de la
  respuesta se cancela con la función serverless. Siempre `await`.
- **Antipatrón: derivar variantes consultando el bucket.** R5 lo prohíbe y
  convertiría cada tarjeta en un round-trip.
- **Antipatrón: `revalidateProducts`.** `productTag` no lo declara ninguna
  lectura (F-011, I3); la ficha de producto lee `getStoreCatalog`. Este feature
  no lo usa.

## Qué se rompe de lo ya verificado, y cómo se evita

Ocho cosas, con su arreglo. Las siete primeras son trabajo del plan; la octava
es AP1.

1. **`src/features/admin/storagePaths.test.ts`** afirma
   `/^stores\/store-1\/products\/product-1\/[0-9a-f-]{36}\.jpg$/`. Con el
   directorio nuevo, la ruta termina en `/<uuid>/original.jpg` y el caso falla.
   _Arreglo:_ actualizar la expresión regular. El segundo caso («dos llamadas,
   uuids distintos») sigue pasando sin tocarlo. Es una prueba, no un
   `acceptance_criteria`: se edita sin preguntar.
2. **`src/features/admin/server/mutations.test.ts`** ya hace
   `vi.mock("@/lib/supabase/storage", …)` (línea 53) con los exports de hoy.
   `saveProduct` pasará a llamar a `objectPathOf` y `removeStoreObjects`, que en
   el mock serían `undefined` → `TypeError` en **todos** los casos de
   `saveProduct`, no solo en los de imágenes. _Arreglo:_ añadir los exports
   nuevos al mock, y un caso que verifique que quitar una URL provoca **una**
   llamada de borrado y que no quitarla no provoca ninguna.
3. **`src/features/sync/server/handlers/product.test.ts`** — sus casos de
   `DELETE` y de `publishToStore:false` (líneas 254-268 y 319-332) siguen
   pasando tal cual, porque el handler **no** llama a Storage (esa fue una de las
   tres razones de la decisión). _Arreglo:_ nada roto; se **añaden** los casos de
   E11/E12 sobre `purgeObjectPrefix`.
4. **`npm run check:bundle` (criterio 7).** Quitar `next/image` cambia el bundle
   de la página medida. Se espera que **baje**. _Arreglo:_ ninguno preventivo;
   si subiera, la causa es un `"use client"` nuevo y se arregla ahí, nunca
   subiendo `BUDGET_KB`.
5. **La página medida por `check:bundle` gana imágenes.** El guion mide
   JavaScript y HTML gzip, no imágenes, así que la siembra no lo mueve. Y como
   en el CI no hay Storage, la siembra ni siquiera ocurre allí. Sin impacto.
6. **`npm run check:harness` si se borra o renombra un archivo citado.**
   `.agent/specs/F-011/architecture.md` cita entre comillas invertidas
   `src/features/admin/storagePaths.ts`, `src/lib/supabase/storage.ts`,
   `src/lib/imageType.ts`, `src/constants/media.ts` y
   `src/features/admin/components/ImageUploader.tsx`. F-011 está `passes: true`,
   así que esas líneas **no** quedan exentas por el mecanismo de «feature
   pendiente» de `scripts/check-harness.mjs` y el check las exige en disco.
   _Consecuencia dura para el plan:_ **ninguno de esos archivos puede
   desaparecer ni cambiar de ruta.** Por eso `objectPathFor` se queda donde está
   —cambiando de forma pero no de casa— en vez de mudarse a `src/lib/`, que es
   donde el reparto de capas lo habría puesto de haber empezado hoy. Es la
   restricción que más forma le da a este diseño y conviene que el plan la lleve
   escrita.
7. **`prisma/seed.ts` corriendo dos veces en el CI** (paso «Seed is
   idempotente»). Ya está resuelto por construcción: directorio determinista,
   `upsert: true`, asignación en vez de `push`, y salto completo cuando
   `storageAvailability()` dice que no. Es la parte del plan que más merece un
   paso verificable propio (`npm run seed && npm run seed` con el emulador
   **arriba**, que es más de lo que comprueba el CI).
8. **`.agent/specs/F-011/smoke.sh`, líneas 288-305, se queda en rojo.** Afirma
   que `/_next/image?url=…&w=640&q=75` responde `200` y que convierte a
   avif/webp. Con `images.unoptimized: true` el optimizador responde `400`. No
   lo corre el CI y no forma parte de ningún criterio de F-023, pero
   `bash .agent/verify.sh F-011 --smoke` dejará de pasar el día que alguien lo
   ejecute, y un smoke rojo en un feature cerrado envenena el sensor. **No lo
   toco: está fuera de mi frontera y es artefacto de otro feature.** Es AP1.

## Riesgos y plan B

| Riesgo                                                                                | Probabilidad | Plan B                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharp` no instala o no resuelve en el runtime de Vercel                              | baja         | Está en `serverExternalPackages` por defecto; si aun así falla, `@jsquash/*` (WASM) con el mismo contrato `EncodeResult` y anchos más chicos              |
| Las cuatro codificaciones se pasan del tiempo de función con entradas grandes         | media        | Bajar `effort` de AVIF; si no basta, reducir el tope de píxeles por debajo de 64 MP y devolver `too_many_pixels` → 400 con copy explícito                 |
| 15 × la variante de tarjeta no cabe en 300 KB                                         | media        | Es el resultado que el feature quiere descubrir: se baja calidad/ancho (R8), **no** se sube el presupuesto en silencio                                    |
| El emulador de Storage devuelve un `content-type` distinto del subido (E6/criterio 4) | baja         | El `content-type` se pone explícito en cada `upload`; si el emulador lo pisara, el smoke lo detecta en el paso del criterio 4 y se ajusta la subida       |
| Un `<img>` sin dimensiones intrínsecas provoca CLS                                    | baja         | El contenedor `aspect-square` ya reservaba el hueco para `<Image fill>` y se conserva; si `sdd-designer` encuentra un caso sin contenedor, se le pone uno |
| El drenaje de purgas alarga un lote de sync grande                                    | baja         | Concurrencia acotada y tope de claves; si molesta, el prefijo se acumula en una tabla de pendientes y lo drena otro feature                               |

## ¿Hace falta una ADR?

**Sí.** Tres decisiones estructurales que sobreviven a este feature y que quien
llegue después necesita encontrar sin leer una spec: (a) no hay optimización de
imágenes en caliente en este producto; (b) una imagen es un directorio y sus
variantes se derivan de la ruta, no de la base; (c) el bucket es un derivado de
`imageUrls`, lo que introduce la única excepción a ADR 0007 —el sync vaciando
`imageUrls` en el `DELETE` terminal—.

Número siguiente: **0022**. Título propuesto: «Imágenes derivadas al subir,
servidas del CDN». Supersede la R22 de F-011 y matiza ADR 0007. El borrador
queda en `docs/adr/0022-imagenes-derivadas-al-subir.md`.

## Preguntas al humano

**AP1 — `.agent/specs/F-011/smoke.sh` se queda en rojo (punto 8 de § Qué se
rompe). ¿Se arregla, o se deja?**
Las líneas 288-305 comprueban que `/_next/image` responde `200`. F-023 apaga el
optimizador por R1, así que pasarán a `400`. El `acceptance_criteria` que ese
paso verificaba es exactamente el que F-023 sustituye, y la regla 3 protege el
**criterio**, no el guion que lo comprueba.

- **(a) [recomendada]** Autorizar a `sdd-implementer` a sustituir ese bloque por
  la comprobación equivalente de F-023: que la URL del original responde `200`
  desde el CDN y que su variante AVIF también. Cuesta ~10 líneas, deja los dos
  smokes verdes y no toca ningún `acceptance_criteria`.
- (b) Dejarlo rojo y anotarlo en el `impl.md` de F-023. Barato hoy, caro el día
  que alguien corra `--smoke` sobre F-011 y no sepa si es este feature o una
  regresión.
- (c) Marcar F-011 como `deprecated` en `features.json` — desproporcionado, y el
  backlog es tuyo (regla 4).

**AP2 — ¿De dónde sale la fotografía del seed?**
El criterio 3 necesita una foto real de ≥ 1200 px en prisma/fixtures/ (por
crear); el `sample.jpg` de 4 KB de F-011 comprime a casi nada y dejaría la
medición vacua con otro disfraz.

- **(a) [recomendada]** Una foto CC0/dominio público (Unsplash/Pexels con la
  atribución en un prisma/fixtures/README.md, por crear), ~200-400 KB. Comprometida al
  repo, ~300 KB de peso permanente en el árbol.
- (b) La aportas tú (una foto de producto real del piloto). Mejor
  representatividad, misma mecánica.
- (c) Una imagen sintética generada al vuelo — se descarta: el ruido sintético
  comprime de forma poco representativa y el número del criterio 3 mentiría.

**AP3 — Tope de píxeles de entrada: 80 MP y una subida grande a la vez por
instancia. ¿Se acepta?**
La spec acepta explícitamente 8000×8000 (64 MP) y eso son ~256 MB de RAM al
decodificar, sobre una función de 1024 MB.

- **(a) [recomendada]** Aceptar 80 MP con `sharp.concurrency(1)`, y que la
  segunda subida grande concurrente en la misma instancia devuelva `503` en vez
  de tumbar el proceso. Coste: cero configuración de plataforma.
- (b) Subir la memoria de la función de subida en Vercel a 2 GB. Cuesta dinero y
  es una decisión tuya, no mía.
- (c) Bajar el tope a 30 MP y rechazar con `400` lo que la spec dice que se
  acepta — contradice un caso límite ya firmado, no lo hago sin que lo digas.
