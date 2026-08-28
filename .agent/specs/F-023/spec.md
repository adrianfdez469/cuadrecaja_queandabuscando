---
feature: F-023
agente: sdd-spec
actualizado: 2026-08-28T16:32:06Z
estado: listo
---

## Problema

Hoy toda imagen de producto se sirve por `next/image`: el navegador pide
`/_next/image?url=…&w=…&q=…` y **el servidor la optimiza en caliente, en cada
petición** (`src/components/store/ProductCard.tsx:38`,
`src/app/[slug]/p/[productSlug]/page.tsx:151`, `next.config.ts`). Eso tiene dos
costos que aparecen justo cuando llega el tráfico: en Vercel la optimización de
imágenes es un recurso **medido**, y la primera imagen de una tarjeta puede
pesar más que las ~3 KB de HTML que F-004/F-017 consiguieron servir desde el
CDN. El comprador con conexión limitada —el público objetivo declarado— paga
esa diferencia.

F-023 mueve el trabajo al momento de subir: la app genera las variantes una
vez, las guarda en el bucket y la tienda las sirve **directo desde el CDN de
Supabase**, sin optimizador intermedio. Sustituye únicamente el cuarto
`acceptance_criteria` de F-011 («… y la sirve por `next/image`»), que por la
regla 3 no se toca allí.

## Alcance

### Dentro

- **Generación de variantes al subir**, dentro de la propia app (SP1, decidido
  por el humano el 2026-08-28): al recibir el archivo en el endpoint de subida
  se producen las variantes y se suben al mismo bucket. Sin transformación de
  imágenes de Supabase (de pago en algunos planes).
- **Dos formatos** por variante: AVIF (preferido) y WebP (respaldo), más el
  original tal cual llegó.
- **Servido directo del CDN**: la tienda pública deja de emitir URLs de
  `/_next/image`; el HTML apunta a los objetos públicos del bucket.
- **Selección de formato y tamaño en el marcado** (`<picture>` + `srcset`),
  sin JavaScript de cliente.
- **Panel**: la galería del editor y las miniaturas del listado
  (`src/features/admin/components/ImageUploader.tsx`,
  `src/features/admin/components/ProductTable.tsx`) usan también la variante
  chica del CDN; ninguna pantalla de la app queda pidiendo `/_next/image`.
- **Ciclo de vida del objeto**: quitar o reemplazar una imagen desde el panel,
  y borrar un producto desde el sync, dejan de generar huérfanos en el bucket
  (sustituye la R22 de F-011, ver «Incongruencias»).
- **Presupuesto de peso de imágenes** de una página de catálogo, medido contra
  un servidor levantado, con su propia comprobación ejecutable.
- **`next.config.ts`**: la optimización en caliente queda desactivada, de modo
  que reintroducir un `<Image>` por descuido no pueda volver a encenderla.

### Fuera (explícito)

- **Recorte, rotación o edición** de la imagen en el panel. Se sube lo que el
  admin manda.
- **Imágenes de `CanonicalProduct`** (`prisma/schema.prisma:305`, `imageUrl`)
  para el marketplace. Mismo mecanismo, otro feature.
- **Editor de `Storefront.logoUrl` y `coverUrl`.** F-011 los aparcó «esperando
  a F-023» (`.agent/specs/F-011/spec.md`, I15), pero ningún
  `acceptance_criteria` de F-023 los nombra y el backlog es del humano
  (regla 4). Si algún día se escriben, lo harán por este mismo pipeline.
- **Recolección retroactiva** de los objetos que F-011 ya dejó huérfanos en el
  bucket antes de este feature. Las filas viejas siguen funcionando (R11).
- **Migración de datos**: `StoreProduct.imageUrls` no cambia de forma ni de
  significado, así que no hay migración de Prisma en este feature.
- **Bajar el presupuesto de JavaScript** de F-013. F-023 solo se compromete a
  no subirlo (criterio 7).

## Actores y precondiciones

| Actor                   | Qué dispara                                                   |
| ----------------------- | ------------------------------------------------------------- |
| Administrador de tienda | Sube, reordena, quita o reemplaza imágenes desde el panel     |
| Comprador               | Carga `/[slug]`, `/[slug]/buscar` y `/[slug]/p/[productSlug]` |
| cuadrecaja (sync)       | Envía `product.delete` / `publishToStore: false`              |

Precondiciones:

1. F-011 `passes: true` (único `depends_on`), con su endpoint de subida vivo:
   `src/app/api/admin/stores/[storeId]/products/[storeProductId]/images/route.ts`.
2. Bucket de Supabase Storage con lectura pública
   (`SUPABASE_STORAGE_BUCKET`, por defecto `store-media`) y
   `SUPABASE_SERVICE_ROLE_KEY` en el servidor (F-011, R17/R18).
3. Sesión de admin con el `storeId` en `storeIds` (F-011, criterios 1 y 2): la
   autorización no cambia y se sigue comprobando **antes** de leer el archivo.
4. Para medir el criterio 3 hace falta el emulador de Storage levantado y una
   tienda publicada **con imágenes** (ver «Casos límite», medición vacía).

## Comportamiento esperado

**Subida y generación**

- **E1** — Dado un admin autorizado y un archivo válido (JPEG, PNG, WebP o
  AVIF, ≤ 4 MB, mime detectado por contenido), cuando hace `POST` al endpoint
  de imágenes, entonces se suben al bucket, bajo el prefijo del producto, el
  objeto original **y** las variantes derivadas (dos anchos × dos formatos),
  y la respuesta sigue siendo `201` con `{ url, imageUrls }`, donde `url` es
  la **URL pública del original** y `imageUrls` la lista ya actualizada de la
  fila.
- **E2** — Dado que la generación de una variante falla, cuando termina la
  petición, entonces **no** queda un juego a medias publicado: o están todas
  las variantes del juego o la respuesta es un error y `imageUrls` no cambia
  (R6).
- **E3** — Dada una imagen cuya variante de tarjeta, ya generada, supera el
  tope por imagen (R8), cuando la subida termina, entonces la imagen se guarda
  igual y la respuesta incluye un aviso que el panel muestra al admin («la
  imagen quedó pesada»), sin bloquear el guardado.
- **E4** — Dado un archivo que no es imagen, o pesa más de 4 MB, o el producto
  ya tiene 8 imágenes, entonces la respuesta es la misma de F-011 (`400`
  `mime`, `400` `too_large`, `409` `too_many_images`), no se sube **ningún**
  objeto y `imageUrls` no cambia.

**Servido**

- **E5** — Dada una página de tienda (`/[slug]`, `/[slug]/buscar`,
  `/[slug]/p/[productSlug]`), cuando se pide su HTML, entonces **ninguna** URL
  de imagen empieza por `/_next/image`: todas apuntan al prefijo público del
  bucket (`…/storage/v1/object/public/<bucket>/…`).
- **E6** — Dado un navegador que acepta AVIF, cuando resuelve el `<picture>` de
  una tarjeta, entonces pide la variante `.avif` y el CDN responde `200` con
  `content-type: image/avif`. Dado un navegador que no lo acepta, resuelve el
  respaldo `.webp` y el CDN responde `200` con `content-type: image/webp`
  (R4, y la aclaración I3 sobre qué significa aquí «responde»).
- **E7** — Dado el catálogo de una tienda, cuando se suman los bytes de la
  variante que elegiría un cliente móvil (viewport 390 px, DPR 1, acepta
  AVIF) para cada imagen del HTML, entonces el total está por debajo del
  presupuesto de 300 KB (R7, SP2).
- **E8** — Dado un producto sin imágenes, cuando se renderiza su tarjeta y su
  página, entonces se muestra el hueco «Sin imagen» actual, sin `<img>` roto y
  sin petición de red.
- **E9** — Dada una fila con una URL heredada de F-011 (sin variantes) o
  ajena al prefijo del bucket, cuando se renderiza, entonces se pinta un
  `<img>` simple con esa URL y la página no se rompe (R11).

**Ciclo de vida del objeto**

- **E10** — Dado un producto con una imagen, cuando el admin la reemplaza
  (sube la nueva y quita la vieja), entonces tras la revalidación el HTML de
  la tienda muestra la nueva, y el original **y todas las variantes** de la
  vieja dejan de existir en el bucket: pedirlas responde `404`/`400`, no una
  imagen.
- **E11** — Dado un producto con imágenes, cuando llega un evento de sync con
  `operation: DELETE` para ese producto, entonces —además del borrado suave
  que ya hace `src/features/sync/server/handlers/product.ts:95-107`— se vacía
  `imageUrls` y se borran del bucket todos los objetos bajo el prefijo del
  producto.
- **E12** — Dado el mismo producto, cuando llega en cambio un evento con
  `publishToStore: false` (despublicar, que hoy comparte rama con el DELETE),
  entonces el borrado suave ocurre igual pero **las imágenes se conservan
  intactas**: volver a publicar devuelve el producto con sus fotos (R10).
- **E13** — Dado un DELETE que ya se procesó, cuando se reentrega (reintento
  del outbox), entonces el resultado es idéntico: el guardia de
  `sourceUpdatedAt` lo marca `STALE` y, si igualmente se ejecutara el borrado,
  borrar objetos ya borrados es un no-op con éxito (R12).
- **E14** — Dado Storage caído en el momento de un borrado (panel o sync),
  cuando la operación termina, entonces la escritura en Postgres se confirma
  igual, el fallo se registra en el log del servidor y el evento de sync
  **no** se reporta como fallido (R13). El objeto que quedó atrás es deuda
  conocida, no una corrupción de datos.

## Reglas de negocio

- **R1 — Ninguna imagen se optimiza por petición.** Ni en la tienda ni en el
  panel. `next.config.ts` desactiva el optimizador
  (`images.unoptimized: true`), con lo que `remotePatterns` y
  `dangerouslyAllowLocalIP` dejan de hacer falta y se van con él.
- **R2 — El juego de variantes es fijo y vive en constantes.** Dos anchos
  (uno de tarjeta y uno de detalle; indicativos 400 y 800 px, los confirma
  `sdd-designer`) × dos formatos (AVIF y WebP). Nada de magic numbers:
  `src/constants/media.ts` es su sitio, junto a `IMAGE_MAX_BYTES`.
- **R3 — El original se conserva** tal cual se subió, sin recomprimir: es la
  fuente de la que se regeneran las variantes si el juego cambia. No se sirve
  nunca en una página de catálogo.
- **R4 — La elección de formato la hace el cliente en el marcado, no el
  servidor en caliente**: `<picture>` con un `<source type="image/avif">`, un
  `<source type="image/webp">` y un `<img>` de respaldo apuntando al WebP del
  ancho de tarjeta. Sin JPEG de respaldo: Tailwind 4 ya exige navegadores
  (Safari 16.4+, Chrome 111+, Firefox 128+) donde AVIF y WebP están
  soportados, así que un tercer formato sería peso muerto en el bucket.
- **R5 — `StoreProduct.imageUrls` sigue guardando una sola URL por imagen: la
  del original.** Las variantes se **derivan** de ella con una función pura,
  sin consultar la base ni el bucket. Ni el esquema, ni el contrato con
  cuadrecaja, ni la validación de prefijo de bucket
  (`src/features/admin/schemas.ts:43`) cambian.
- **R6 — La subida es todo-o-nada de cara a la fila.** `imageUrls` se escribe
  **después** de que el original y todas sus variantes estén en el bucket. El
  orden sigue siendo el de F-011: subir primero, escribir después; la mitad
  mala posible es un objeto huérfano, nunca una URL rota.
- **R7 — Presupuesto de peso de imágenes: 300 KB** por página de catálogo
  (SP2, decidido por el humano el 2026-08-28). Es un número nuevo, no derivado
  de F-013 —que solo mide JavaScript—, y se mide en bytes transferidos
  (`content-length`, sin gzip: ya vienen comprimidos), sumando **una** variante
  por imagen: la que elegiría el cliente móvil de E7.
- **R8 — Tope por imagen.** El presupuesto dividido entre el catálogo de
  referencia da el tope de la variante de tarjeta (300 KB ÷ 15 productos del
  seed ≈ 20 KB). El generador apunta a él bajando calidad dentro de un rango
  acotado; si aun así lo supera, avisa (E3) en vez de fallar.
- **R9 — El bucket es un derivado de `imageUrls`.** Cuando una URL deja de
  estar referenciada por una fila viva, su original y sus variantes se borran.
  Esto **sustituye la R22 de F-011** («quitar una URL no borra el objeto»),
  que aquel feature dejó explícitamente para otro (ver «Incongruencias», I1).
- **R10 — Borrar no es despublicar.** El borrado de objetos solo ocurre en el
  camino terminal —`operation: DELETE` del sync, o el admin quitando la imagen
  en el panel—, nunca en `publishToStore: false`, que es un interruptor
  reversible de todos los días. Un despublicar que borrara las fotos
  destruiría trabajo del admin sin que nadie lo pidiera.
- **R11 — Compatibilidad hacia atrás por la forma de la ruta.** La función de
  derivación reconoce si una URL tiene variantes mirando **solo su ruta**. Una
  URL heredada de F-011 (`…/<uuid>.<ext>`, sin juego de variantes) se pinta
  como `<img>` simple. No hay backfill obligatorio.
- **R12 — Los borrados son idempotentes.** Borrar un objeto inexistente es
  éxito. Es la misma exigencia que AGENTS.md § «Cosas que muerden» impone a
  todo lo que el sync escribe.
- **R13 — Un fallo de Storage no tumba la escritura ni el evento.** El borrado
  de objetos es _best-effort_: se registra en el log y se sigue. Reportar
  `failed` un evento de sync cuyo efecto en Postgres sí ocurrió haría que el
  POS lo reintentara sin necesidad; reportarlo `ok` cuando la fila no se
  escribió es el error contrario, que AGENTS.md prohíbe explícitamente. Aquí
  la fila **sí** se escribe.
- **R14 — Todo lo que toca Storage pasa por `src/lib/supabase/storage.ts`** —
  único módulo que habla con su API (F-011, R17)— y toda escritura del panel
  sigue pasando por `commit()` en
  `src/features/admin/server/mutations.ts`, que revalida. El borrado del
  objeto ocurre **después** de la escritura y su revalidación, para que la
  ventana en la que una página cacheada apunta a un objeto ya borrado sea la
  mínima posible.
- **R15 — El `openGraph` no usa AVIF.** `src/app/[slug]/p/[productSlug]/page.tsx:69`
  pasa a apuntar a la variante WebP del ancho de detalle (acotada en peso),
  porque los rastreadores de WhatsApp y las redes no aceptan AVIF de forma
  fiable y el original puede pesar 4 MB. Una URL heredada (R11) se pasa tal
  cual, como hoy.
- **R16 — Nada de esto añade JavaScript de cliente.** `<picture>` es HTML; los
  componentes de catálogo siguen siendo de servidor (AGENTS.md prohíbe
  `"use client"` en algo que renderice catálogo).

## Casos límite y errores

| Caso                                                        | Comportamiento                                                                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archivo corrupto o con mime mentido en el nombre            | `detectImageMime` (`src/lib/imageType.ts:15`) decide por contenido. Si el decodificador falla al generar, `400` y cero objetos                                                                 |
| Imagen enorme dentro del límite (4 MB, 8000×8000)           | Se acepta; las variantes se generan con el tope de anchos de R2. Si la codificación excede el tiempo de la función, `503`                                                                      |
| Fallo a mitad de generar variantes                          | E2: no se escribe `imageUrls`; los objetos ya subidos quedan como huérfanos conocidos y el admin puede reintentar                                                                              |
| Dos subidas concurrentes al mismo producto                  | Igual que en F-011: el `uuid` de la ruta evita colisión; el tope de 8 sigue siendo check-then-act sin bloqueo (aceptado allí)                                                                  |
| Reintento de una subida que falló al escribir la fila       | Nuevo `uuid`, nuevo juego de variantes; el juego anterior queda huérfano (deuda conocida, no rompe nada)                                                                                       |
| Quitar la imagen principal de un producto con dos           | La segunda pasa a principal (F-011, E26) y solo se borran los objetos de la quitada                                                                                                            |
| Reemplazo con la página aún cacheada                        | R14: escribir → revalidar → borrar. Ventana mínima; si un cliente pide el objeto en ese hueco recibe `404` y ve el hueco vacío                                                                 |
| URL en `imageUrls` que no es del bucket                     | R11: `<img>` simple. La tarjeta debe seguir pintando el producto, no romper la página                                                                                                          |
| Producto sin imágenes                                       | E8: hueco «Sin imagen», cero peticiones                                                                                                                                                        |
| Storage caído durante la subida                             | Sin cambios respecto a F-011: `503` con `reason`, `imageUrls` intacto                                                                                                                          |
| Storage caído durante un borrado                            | R13: se registra y se sigue; queda un huérfano                                                                                                                                                 |
| DELETE del sync reentregado                                 | E13/R12: `STALE` por `sourceUpdatedAt`, y el borrado sería no-op de todos modos                                                                                                                |
| Producto borrado y vuelto a crear con el mismo `externalId` | Vuelve sin imágenes (sus objetos se borraron en el DELETE). El admin las sube otra vez; el POS dijo que ese producto se borró                                                                  |
| Medición vacía del presupuesto                              | Si la página medida no tiene **ninguna** imagen, la comprobación **falla**, no pasa en verde. Misma lección que el guardia de `scripts/check-bundle-budget.mjs` cuando no hay tienda publicada |

## Datos y contrato

**Base de datos.** Sin cambios. `StoreProduct.imageUrls String[]`
(`prisma/schema.prisma:388`) sigue guardando URLs públicas absolutas del
original, una por imagen, máximo 8 (`PRODUCT_MAX_IMAGES`).

**Contrato con cuadrecaja.** Sin cambios. `imageUrls` es propiedad del panel y
el sync no lo pisa: `docs/sync-contract.md` («el sync no escribe `description`,
`imageUrls`, `visible` ni `featured`: son del panel») y
`docs/adr/0007-price-override.md`. El único punto nuevo de contacto con el
sync es un **borrado de objetos** en la rama `DELETE`, que no escribe ninguna
columna que el sync no escriba ya (`deletedAt`, `visible`, `sourceUpdatedAt`)
salvo `imageUrls`, que se **vacía** porque su contenido dejó de existir. Es la
única excepción a ADR 0007 que introduce este feature y está acotada al
`DELETE` terminal.

**Rutas de objeto.** Hoy:
`stores/<storeId>/products/<storeProductId>/<uuid>.<ext>`
(`src/features/admin/storagePaths.ts`). F-023 mantiene el prefijo por producto
—es lo que permite borrar por prefijo en E11— y añade un juego de variantes
derivable con una función pura a partir de la URL del original (R5, R11). La
forma concreta la fija `sdd-architect`; lo que la spec exige es: (a) que la
derivación no consulte nada, (b) que una URL de F-011 sea distinguible de una
de F-023 por su ruta, y (c) que todo lo de una imagen cuelgue de un prefijo
que se pueda listar y borrar de una vez.

**Tipos MIME.** Entrada: `IMAGE_ALLOWED_MIME` de `src/constants/media.ts`
(JPEG, PNG, WebP, AVIF). Salida: `image/avif` y `image/webp`, con el
`content-type` puesto en la subida —de él depende E6.

**Unidades.** Todos los pesos en bytes; el presupuesto se expresa en KB
binarios (1 KB = 1024 B), igual que `scripts/check-bundle-budget.mjs`.

**Respuesta del endpoint de subida.** `201 { url, imageUrls }` como hoy, más un
campo opcional de aviso para E3. Ningún consumidor existente se rompe:
`src/features/admin/components/ImageUploader.tsx:58` solo lee `imageUrls`.

## Criterios de aceptación propuestos

Los ocho de `.agent/features.json`, en su orden, traducidos a algo ejecutable.
Ninguno cambia de contenido (regla 3) y no se propone ninguno nuevo.
`$BASE` = URL del servidor levantado (`SMOKE_PORT`, 3100 por defecto);
`$SLUG` = una tienda publicada con imágenes.

1. `[ya]` **«Subir una imagen deja más de un objeto en el bucket: original más
   variantes.»** → `POST $BASE/api/admin/stores/<storeId>/products/<pid>/images`
   con `-F file=@.agent/specs/F-011/fixtures/sample.jpg` y la cookie de admin
   responde `201`; listar por la API de Storage el prefijo
   `stores/<storeId>/products/<pid>/` devuelve **5** objetos (1 original + 2
   anchos × 2 formatos), y `SELECT "imageUrls"` de esa fila contiene
   exactamente una URL nueva, la del original.
2. `[ya]` **«El HTML servido de `/[slug]` no contiene ninguna URL de
   `/_next/image`.»** → `curl -s $BASE/$SLUG | grep -c "_next/image"` imprime
   `0`, y lo mismo para `$BASE/$SLUG/p/<producto>` y `$BASE/$SLUG/buscar?q=…`.
   Complementado por un test de `npm test` que falla si algún módulo bajo
   `src/` importa `next/image`.
3. `[ya]` **«El peso total de imágenes de una página de catálogo está por
   debajo del presupuesto, medido sobre el servidor levantado.»** → la
   comprobación de presupuesto de imágenes (guion nuevo, por crear, invocado
   desde `.agent/specs/F-023/smoke.sh`) pide `$BASE/$SLUG`, extrae de cada
   `<picture>` el candidato AVIF de menor ancho, hace `HEAD` de cada uno, suma
   sus `content-length` y **termina en 0** si el total ≤ 300 KB. Termina en 1
   si lo supera **y también si no encontró ninguna imagen** (medición vacía).
4. `[ya]` **«Con `Accept: image/avif` se responde AVIF y sin él se responde el
   respaldo.»** → del HTML de `$BASE/$SLUG` se toma la URL `.avif` del
   `<source type="image/avif">` y la del `<img>` de respaldo;
   `curl -sI -H 'Accept: image/avif,image/webp,*/*' <avif>` responde `200` con
   `content-type: image/avif`, y `curl -sI -H 'Accept: image/webp,*/*'
<respaldo>` responde `200` con `content-type: image/webp`.
5. `[ya]` **«Reemplazar la imagen de un producto cambia lo que se ve tras la
   revalidación, sin dejar variantes viejas servidas.»** → se guarda la URL
   vieja y sus 4 variantes derivadas; se sube una imagen nueva y se guarda el
   producto sin la vieja (`PUT` del editor); después: `curl -s $BASE/$SLUG`
   contiene la URL nueva y **no** la vieja, y `curl -sI` de la vieja y de cada
   una de sus 4 variantes responde `404` (o `400`), nunca `200`.
6. `[ya]` **«Borrar un producto no deja objetos huérfanos en el bucket.»** →
   con un producto que tiene al menos una imagen, se entrega un evento de sync
   `product` con `operation: DELETE` por el endpoint de ingesta; después:
   listar el prefijo `stores/<storeId>/products/<pid>/` devuelve **0** objetos
   y `SELECT "imageUrls"` de esa fila devuelve `{}`. El caso simétrico
   (`publishToStore: false`, E12) se verifica en `npm test`: los objetos y
   `imageUrls` **no** cambian.
7. `[ya]` **«`node scripts/check-bundle-budget.mjs` sigue terminando con código
   0.»** → tras `npm run build`, ese comando exacto sale con `0` sin subir
   `BUDGET_KB`.
8. `[ya]` **«`bash .agent/verify.sh F-023 --full` termina con código 0.»** →
   ese comando exacto (harness · typecheck · lint · format · test · prisma ·
   build · theme · bundle) sale con `0`.

Los criterios 1, 3, 4, 5 y 6 necesitan el emulador de Storage levantado y la
base sembrada; su sitio natural es `.agent/specs/F-023/smoke.sh`
(`bash .agent/verify.sh F-023 --smoke`), que ya monta servidor y recoge el log.

## Incongruencias detectadas

- **I1 — La R22 de F-011 dice lo contrario de los criterios 5 y 6 de F-023.**
  `.agent/specs/F-011/spec.md` § Reglas: «Quitar una URL de `imageUrls` no
  borra el objeto del bucket. […] la recolección de huérfanos es otro
  feature». Ese «otro feature» es este: los criterios 5 («sin dejar variantes
  viejas servidas») y 6 («no deja objetos huérfanos») lo piden explícitamente.
  Resuelto por R9/R10, que sustituyen la R22 sin tocar F-011 (regla 3, mismo
  patrón que la sustitución del criterio 4). **Arrastra un cambio de copy**:
  `src/features/admin/components/ImageUploader.tsx:169` promete hoy «el
  archivo se queda guardado en el almacenamiento», y a partir de F-023 será
  mentira. No bloqueante.
- **I2 — «Borrar un producto» no existe como operación en el repo.** El único
  camino de borrado es el borrado **suave** del sync
  (`src/features/sync/server/handlers/product.ts:95-107`), y esa misma rama
  atiende `publishToStore: false`, que es reversible y cotidiano. Tomado al
  pie de la letra, el criterio 6 borraría las fotos del admin cada vez que un
  tendero desmarca «publicar en la tienda». **Decidido, no preguntado**
  (R10): se parte la rama y solo `operation: DELETE` borra objetos y vacía
  `imageUrls`; `publishToStore: false` los conserva. Si el humano quería la
  otra semántica, es un cambio contenido en un handler, pero conviene que lo
  confirme al leer esto.
- **I3 — El criterio 4 describe una negociación por `Accept` que un objeto
  estático en el CDN no puede hacer.** Supabase Storage devuelve el
  `content-type` con el que se subió el objeto; no negocia. Hacer negociación
  real exigiría un handler propio por imagen, que es exactamente el trabajo
  por petición que este feature elimina. Traducción adoptada (R4): la elección
  la hace el cliente en el `<picture>`, y el comportamiento observable es el
  que el criterio pide —quien acepta AVIF recibe AVIF; quien no, el respaldo—.
  El criterio no se toca; su verificación es la del punto 4 de arriba.
- **I4 — Un presupuesto «total por página» no tiene tope natural.** `/[slug]`
  no pagina: `src/app/[slug]/page.tsx` renderiza el catálogo completo, así que
  una tienda con 200 productos supera cualquier cifra fija. Los 300 KB de SP2
  se miden contra el catálogo de referencia del seed (15 productos del demo);
  lo que de verdad protege al comprador en una tienda grande es el tope **por
  imagen** de R8 más el `loading="lazy"` de todo lo que no está en el primer
  pliegue. No bloqueante: el criterio se verifica como está escrito, sobre la
  página medida.
- **I5 — El seed no pone ninguna imagen.** `prisma/seed.ts` nunca escribe
  `imageUrls`, así que hoy el criterio 3 mediría cero bytes y pasaría en verde
  sin comprobar nada. De ahí el guardia de medición vacía (R7 y el último caso
  límite), calcado del que `scripts/check-bundle-budget.mjs` ya tiene para
  «ninguna tienda publicada». Sembrar imágenes exige objetos reales en el
  emulador: el cómo es de `sdd-architect`.
- **I6 — Añadir un codificador de imágenes es una dependencia de producción
  nueva.** No hay ninguna en `package.json`; `sharp` es la opción canónica en
  Node y Vercel la soporta, pero es un binario nativo y encaja AVIF con costo
  de CPU (segundos para 4 MB). No afecta al criterio 7 —`check:bundle` mide
  JavaScript de **cliente**— pero sí al tiempo de la función de subida y al
  tamaño del despliegue. Decisión de `sdd-architect`; la spec solo exige que
  la generación ocurra en el servidor, en runtime Node, dentro de la petición
  de subida (SP1).
- **I7 — `Storefront.logoUrl` y `coverUrl` siguen sin quien las escriba.**
  F-011 (I15) las aparcó «esperando a F-023», pero ningún
  `acceptance_criteria` de F-023 las nombra. Fuera de alcance por regla 4; la
  incongruencia sigue viva y es del humano decidir si abre un feature.

## Huecos y preguntas al humano

**Ninguna abierta.** Las dos que traía la propuesta las cerró el humano el
2026-08-28 y están transcritas aquí:

- **SP1 (cerrada)** — Las variantes las genera **la propia app al subir la
  imagen**, no la transformación de imágenes de Supabase (de pago en algunos
  planes). Está en el alcance § Dentro y en E1.
- **SP2 (cerrada)** — El presupuesto de peso total de imágenes de una página
  de catálogo es **~300 KB**. Número **nuevo**: F-013 solo mide JavaScript y no
  aporta una cifra de imágenes de la que derivarlo. Está en R7 y en el
  criterio 3.

Lo de I2 no es una pregunta abierta: está decidido en R10. Se señala para que
el humano pueda desdecirlo barato si su intención era otra.

## No decidido a propósito

- **Los anchos exactos y las calidades de compresión.** Salen del diseño
  responsivo y de medir contra R8: los fija `sdd-designer` y los ajusta
  `sdd-implementer` con la medición delante. La spec solo fija que son **dos**
  anchos y que viven en constantes (R2).
- **La forma literal de las rutas de las variantes** y el nombre de la función
  de derivación: de `sdd-architect`, con las tres condiciones de § Datos y
  contrato.
- **Dónde vive la comprobación de presupuesto de imágenes** (guion propio
  llamado desde el smoke, o etapa nueva de `.agent/verify.sh`): de
  `sdd-architect`. Lo que la spec exige es que sea un comando con código de
  salida y que falle en medición vacía.
- **Backfill de las imágenes ya subidas por F-011.** R11 hace que funcionen
  sin él. Si alguien lo quiere, es trabajo aparte.
