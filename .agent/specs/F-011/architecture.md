---
feature: F-011
agente: sdd-architect
actualizado: 2026-08-26T19:07:22Z
estado: listo
---

## Qué cambió en este ciclo (HD5–HD15)

Este documento se reescribió cuando el humano invirtió las tandas. Lo que se
firma e implementa **ahora** es lo que la spec llamaba tanda 2: **productos,
imágenes y promociones**. Lo llamo **tanda A** para no arrastrar un número que
ya significa otra cosa.

| Decisión | Efecto sobre este documento                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HD5**  | La tanda 1b se cae. Ver § Lo que HD5 y HD6 detuvieron: no se borra, se marca.                                                                                                          |
| **HD6**  | AP2 respondida (b): no se construye editor sobre `Store`. Branding y contacto quedan bloqueados hasta `Storefront`. **Consecuencia nueva: el criterio 5 no se puede cerrar. Ver AP4.** |
| **HD7**  | Transporte cerrado: isla de cliente con `fetch` + `<noscript>`. Se cae la salida de emergencia con formulario plano.                                                                   |
| **HD8**  | Registrada, **sin efecto en esta tanda**: no hay editor de branding que pueda guardar un color ilegible. Aplica cuando llegue `Storefront`.                                            |
| **HD9**  | Tandas invertidas. Todo lo que estaba marcado «detalle pendiente para el plan de la tanda 2» está ahora al detalle aquí.                                                               |
| **HD10** | Alcance nuevo: el panel habilita y deshabilita la tienda al público. **Supera la mitad de HD2 que hablaba de `status`**, y el handler del sync que HD2 congeló **sí se modifica**.     |
| **HD11** | La tienda deshabilitada responde 200 con una página, no 404. La página de un pedido ya hecho sigue accesible.                                                                          |
| **HD12** | La migración deja deshabilitadas también las tiendas existentes. Ver § Qué se rompe de lo ya verificado.                                                                               |
| **HD13** | Un solo estado compartido, gana el último. Ver § El guarda anti-rancio: hay una consecuencia que no puedo decidir yo (**AP5**).                                                        |
| **HD14** | Motivo por lista fija + texto corto opcional, pintado como texto.                                                                                                                      |
| **HD15** | Sin endpoint nuevo en el contrato. Solo un campo opcional de motivo → v3 aditiva, **propuesta** en § El contrato.                                                                      |

**AP3 y AP4 contestadas por el humano**: tope de imagen **4 MB** (a
`src/constants/media.ts` con el motivo en el comentario, y `FILE_SIZE_LIMIT` del
emulador en 10 MB para que el tope que muerde sea el nuestro), y **F-011 se queda
en `passes: false` con 4 de 5 criterios**, con el quinto esperando a `Storefront`.
Las dos quedan como decisiones de este documento, no como preguntas.

## Estado actual relevante

Lo que **ya existe y se reutiliza tal cual** (inventario primero: un componente
nuevo que duplica uno existente es una regresión):

| Pieza                                                       | Qué aporta                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/auth/adminSession.ts`                              | `getAdminSession()` y **`canManageStore(session, storeId)`**. No se reimplementa ni se copia la comparación.                                                             |
| `src/app/admin/layout.tsx`                                  | Guarda de sesión + `dynamic = "force-dynamic"` + cabecera. Se conserva; solo se le añade navegación.                                                                     |
| `src/proxy.ts`                                              | Redirige `/admin/**` sin cookie. `matcher` no toca `/[slug]` ni `/api/**`. **Se deja intacto** (ver antipatrones).                                                       |
| `src/lib/cache.ts`                                          | `revalidateStores(slugs)`, ya usado por `src/features/sync/server/processBatch.ts:57` y `availability.ts:65`.                                                            |
| `src/lib/pricing.ts`                                        | `effectivePrice()` (precedencia override, ADR 0007) y `displayPrice()`. Las promociones **componen** sobre esto.                                                         |
| `src/lib/money.ts`                                          | Aritmética en unidades menores con BigInt y `convert()` por el ancla CUP. Todo importe de promoción pasa por aquí.                                                       |
| `src/features/catalog/server/queries.ts`                    | `loadCatalog`/`loadStore`/`loadRates` cacheados y tagueados. Es donde entran las promociones (R28).                                                                      |
| `src/features/orders/server/quote.ts`                       | `quoteCart` — «el único sitio que decide un precio». Es donde entran las promociones en el pedido.                                                                       |
| `src/features/orders/server/createOrder.ts`                 | Persiste el snapshot en un solo round-trip, sin `$transaction`. Aquí entra `discountTotal`.                                                                              |
| `src/app/api/internal/_lib/issues.ts`                       | `serializableIssues(ZodError)` → `{path,message}[]`. Convención de error de validación del repo.                                                                         |
| `src/app/api/orders/_lib/body.ts`                           | `readJsonBody()` (content-type estricto + tope de bytes) y `NO_STORE`. Patrón anti-CSRF de ADR 0016.                                                                     |
| `src/app/api/orders/route.ts`                               | Patrón de ruta: la decisión vive en `features/*/server/`, la ruta solo mapea un resultado discriminado a HTTP (`toResponse`).                                            |
| `src/features/orders/schemas.ts`                            | Estilo Zod del repo: constantes en `src/constants/`, `satisfies z.ZodType<WireType>`.                                                                                    |
| `src/components/ui/{Field,Button,Alert,Card,Container}.tsx` | **Todos son server components hoy.** Alcanzan para los formularios del panel; no se crean primitivos nuevos.                                                             |
| `src/components/store/ProductCard.tsx`                      | Ya llama a `displayPrice`. Es el único sitio del listado donde se muestra un precio: el tachado entra ahí.                                                               |
| `@supabase/supabase-js` 2.112                               | Ya es dependencia. Su cliente de Storage pega a `${url}/storage/v1/...`, que es exactamente la forma de R21.                                                             |
| `prisma/schema.prisma`                                      | `StoreProduct` ya tiene su bloque «owned by the admin panel»; `Promotion` ya existe con `@@index([storeId, active])`; `Order.discountTotal` ya existe con `@default(0)`. |
| `scripts/mint-sso-token.mjs`                                | Fixture de sesión. Le falta una bandera (I7).                                                                                                                            |

Lo que **no existe**: `src/features/admin/`, nada bajo `src/app/api/admin/`,
ningún `"use server"`, ningún módulo de Storage, ninguna lectura de `Promotion`.

### Cuatro cosas que solo se ven leyendo, y que cambian el diseño

1. **`OrderItem.originalUnitPrice` ya está ocupada, y su significado es
   contrato publicado.** `prisma/schema.prisma:432-434` la documenta como «precio
   efectivo ANTES de convertir», `pull.ts:95-110` la manda al POS y
   `docs/sync-contract.md:331` publica la fórmula
   `unitPrice = convert(originalUnitPrice, currencyCode, rateSnapshot.rates)`.
   **Consecuencia dura**: si una promoción descontara después de convertir, esa
   fórmula deja de dar el mismo céntimo y eso es una v3 del contrato — justo lo
   que I5 y R29 prohíben. Por eso el descuento se aplica **en la moneda del
   producto, antes de convertir** (ver § Promociones). En el ciclo anterior
   escribí que `originalUnitPrice` servía para el precio tachado: **era falso**,
   y queda corregido aquí.
2. **`CheckoutForm.tsx:248` calcula `expectedTotal = subtotal + deliveryFee` en
   el cliente.** Con una promoción de alcance `ORDER`, el servidor calculará
   `subtotal - discountTotal + deliveryFee` y **todo checkout responderá 409
   `PRICE_CHANGED`**. Es la forma más probable de romper F-010 con este feature,
   y por eso `QuoteResponse` gana `discountTotal` y la isla lo resta.
3. **`Store.checkoutMode`/`deliveryFee` del seed son fixtures de F-010**: la
   tienda `tienda-demo` es `WHATSAPP` sin delivery y `tienda-dos` es `ONSITE` con
   `deliveryFee = 500`. Cualquier fixture nuevo se añade sin tocar esas dos filas.
4. **El presupuesto de bundle no mide `/admin`.** Medido en este ciclo:
   `npm run build` deja 25 `*.html` en `.next/server/app` y **ninguno bajo
   `admin/`** (es `force-dynamic`), y `check-bundle-budget.mjs:34-62` solo
   recorre `*.html`. La página más pesada está en **182.1 KB gzip** de 193 KB.

## Decisión

**Una feature nueva `src/features/admin/` con un embudo único de escritura, y la
primera escritura que lo atraviesa es la de producto.** La autorización se decide
una sola vez en una función pura sobre la sesión; su resultado es un tipo marcado
(`AuthorizedStoreId`) que solo ella puede producir, y **todas las mutaciones lo
exigen por firma**: escribir sin autorizar no compila. Todas las escrituras del
panel viven en **un solo archivo** (`features/admin/server/mutations.ts`) y todas
pasan por un `commit()` privado que revalida la tienda: escribir sin revalidar no
es posible sin editar ese archivo.

**Las promociones no reimplementan ni un céntimo de la lógica de precios.** Se
componen en tres pasos puros —`effectivePrice()` (existente) →
`applyPromotion()` (nuevo) → `convert()` (existente)— dentro de **un único
compositor** `resolvePrice()` en `src/lib/pricing.ts` que usan los dos caminos
que muestran o cobran un precio. El descuento de línea vive **dentro** de
`unitPrice` (R29) y el de pedido en `Order.discountTotal`, así que
`docs/sync-contract.md` no cambia.

**Las imágenes hablan con la API de Supabase Storage siempre** (HD1), contra un
emulador propio en `docker-compose.yml` en desarrollo. No hay driver de disco ni
abstracción que permita no hablar con la API.

**Alternativas descartadas**, una línea cada una:

- Server actions: una acción que lanza no da código HTTP verificable y el
  criterio 2 exige un 403 con `curl` (R5).
- Autorización repetida en cada handler: es exactamente el fallo que el tipo
  marcado hace imposible.
- Un módulo de escritura por entidad: tres sitios donde olvidar la revalidación.
- URL del panel por `slug`: el `slug` es del sync y obliga a una lectura antes de
  poder responder 403. Va por `id`.
- Promoción calculada en el componente: quedaría fuera de la lectura cacheada
  (R28) y el pedido tendría otra implementación.
- Precio tachado guardado en `OrderItem.originalUnitPrice`: rompe la fórmula
  publicada del contrato (hallazgo 1).
- `$executeRaw` para copiar `syncedPriceCurrency` en un round-trip: se salta la
  lista blanca de columnas, que es la garantía central del diseño.
- Driver de disco o abstracción sobre Storage: **prohibido por HD1**.

## Lo que HD5 y HD6 detuvieron

No se borra: quien retome tiene que saber que existió, que estaba diseñado y por
qué se paró.

| Pieza diseñada                                                                                                                             | Estado                             | Motivo                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuatro columnas `descriptionOverride`, `phoneOverride`, `whatsappOverride`, `emailOverride` en `Store`                                     | **Detenido por HD5**               | Contacto y descripción quedan en modo lectura. Sin columnas nuevas, no hay migración en este feature.                                                                                    |
| Migración aditiva `<ts>_store_panel_overrides`                                                                                             | **Detenido por HD5**               | Ver arriba. F-011 **no toca `prisma/`**.                                                                                                                                                 |
| «el módulo de precedencia de tienda, cancelado por HD5 y nunca creado» (`effectiveStoreProfile`, `whatsappNumber`) y sus tres consumidores | **Detenido por HD5**               | La precedencia `override ?? sincronizado` de tienda ya no existe. Ojo: el `whatsapp ?? phone` **sigue duplicado** en `quote.ts:92` y `read.ts:92`; era una limpieza que se cae con esto. |
| E10–E13 y la parte de R13 referida a la tienda                                                                                             | **Detenido por HD5**               | Sin columnas de override no hay escenario que verificar.                                                                                                                                 |
| `PUT /api/admin/stores/{id}/content`                                                                                                       | **Detenido por HD5**               | —                                                                                                                                                                                        |
| `PUT /api/admin/stores/{id}/branding`, `saveBranding`, `BrandingForm`                                                                      | **Detenido por HD6**               | `Store.themeTokens` es «branding», y ADR 0012 dice que el branding lo poseerá `Storefront`.                                                                                              |
| Criterio 5 (`branding inválido rechazado por themeTokensSchema`)                                                                           | **Bloqueado por HD6**              | No hay endpoint de branding que lo rechace. **F-011 no puede llegar a `passes: true`.** Ver **AP4**.                                                                                     |
| HD8 (branding ilegible permitido, sin validación de contraste)                                                                             | **Sin efecto todavía**             | Se registra para cuando exista el editor. No añade ni quita nada a esta tanda.                                                                                                           |
| Mitad (a) de la ADR 0017 (overrides de tienda como extensión de ADR 0007)                                                                  | **Retirada**                       | La ADR se reescribió: ver § ¿Hace falta una ADR?                                                                                                                                         |
| ADR 0007 extendida a la tienda                                                                                                             | **Sigue vigente para el producto** | `priceOverride ?? syncedPrice` no lo toca HD5 ni HD6: es el corazón de esta tanda.                                                                                                       |

**Actualización por HD10**: la mitad de HD2 que decía «sobre `status` manda el
sync, el panel no lo escribe nunca» **queda superada**. Lo que sigue en pie de
HD2 es la otra mitad —contacto y descripción son del sync— y lo sigue por HD5, no
por HD2. Dos consecuencias que hay que arrastrar hasta el final del documento: la
lista blanca de columnas del panel **crece** con `status` y las tres de motivo, y
la aserción de `boundaries.test.ts` que prohibía `status` **se invierte**. Está
detallado en § El endpoint del panel.

Lo que **sobrevive** de la tanda 1 y se construye ahora porque los endpoints de
producto lo necesitan: el listado de tiendas filtrado por `storeIds`, la
autorización, la capa HTTP de `/api/admin/`, el embudo de escritura y la
revalidación. **Revisado tras HD9**: la forma no cambia. Lo único que cambia es
que la primera escritura que atraviesa el embudo es de `StoreProduct` y no de
`Store`, y eso tiene dos consecuencias concretas, ambas a favor:

- La lista blanca de columnas deja de ser de una sola tabla. Pasa a haber **tres**
  tipos de escritura (`StoreProduct`, `imageUrls`, `Promotion`) y ninguno menciona
  una columna del sync. Como en esta tanda **no hay ninguna escritura sobre
  `Store`**, el criterio 7 `[nuevo]` (ningún `status`/`publishedAt` en un `data`)
  se cumple trivialmente y por construcción.
- La escritura de producto necesita el `syncedPriceCurrency` del momento (R14) y
  el `slug` para revalidar, así que hace **una lectura previa acotada al
  `storeId`**. Esa lectura es además la que decide el 403 de E19, con lo que la
  comprobación de pertenencia de la fila (R4) sale gratis.

## Componentes

### Autorización, HTTP y listado (base común)

| Componente                                    | Capa                 | Responsabilidad                                                                                                                                                               | Archivo                                       |
| --------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `authorization.ts`                            | `features/admin/`    | Puro. `authorizeStore(session, storeId)` → `{ok:true, storeId: AuthorizedStoreId}` \| `{ok:false, denial:"UNAUTHORIZED"\|"FORBIDDEN"}`. Envuelve `canManageStore`. 0 queries. | `src/features/admin/authorization.ts`         |
| `types.ts`                                    | `features/admin/`    | Tipos de cable del panel: `AdminStoreListItem`, `AdminProductRow`, `ProductWriteBody`, `PromotionBody`, `AdminWriteResult`.                                                   | `src/features/admin/types.ts`                 |
| `src/app/api/admin/_lib/guard.ts`             | `src/app/` (HTTP)    | Mapea `authorizeStore` a HTTP: **401** sin cookie (E5), **403** en tienda ajena (E4). Gemelo de `src/app/api/internal/_lib/guard.ts`.                                         | `src/app/api/admin/_lib/guard.ts`             |
| `src/app/api/admin/_lib/respond.ts`           | `src/app/` (HTTP)    | JSON estricto + tope de bytes + `NO_STORE` + `INVALID_BODY` con `serializableIssues`. Mapea `AdminWriteResult` a status.                                                      | `src/app/api/admin/_lib/respond.ts`           |
| `httpJson.ts`                                 | `src/lib/`           | Única implementación de `serializableIssues`, del tipo `SerializableIssue` y de `readJsonBody(request,{maxBytes})` (puro: devuelve motivo, no `NextResponse`).                | `src/lib/httpJson.ts`                         |
| `src/features/admin/server/stores.ts`         | `features/*/server/` | **Prisma, lectura.** `listManagedStores(session)`, `requireManagedStore(storeId)` (`notFound()` para E3).                                                                     | `src/features/admin/server/stores.ts`         |
| `src/features/admin/components/StoreList.tsx` | `features/admin/`    | Server component. Tabla del listado; cada fila con `data-store-id` (fixture de verificación).                                                                                 | `src/features/admin/components/StoreList.tsx` |
| Listado                                       | `src/app/`           | `/admin` reescrito. `export const dynamic = "force-dynamic"` **literal**.                                                                                                     | `src/app/admin/page.tsx`                      |
| Hub de tienda                                 | `src/app/`           | `/admin/tiendas/[storeId]`: datos de tienda en **solo lectura** (E2 sin branding, con la nota de que publicar y vestir se hacen fuera) + enlaces a productos y promociones.   | `src/app/admin/tiendas/[storeId]/page.tsx`    |
| `constants/admin.ts`                          | `src/constants/`     | `ADMIN_MAX_BODY_BYTES`, `ADMIN_PRODUCTS_PAGE_SIZE`, `ADMIN_PRODUCT_DESCRIPTION_MAX_LENGTH`.                                                                                   | `src/constants/admin.ts`                      |

### Productos

| Componente                                       | Capa                 | Responsabilidad                                                                                                                                                                           | Archivo                                                                 |
| ------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/features/admin/server/products.ts`          | `features/*/server/` | **Prisma, lectura.** `listStoreProducts(storeId, {page, q})`, `getProductForEdit(storeId, storeProductId)`. Incluye `visible:false` y marca los `deletedAt` (E14).                        | `src/features/admin/server/products.ts`                                 |
| `schemas.ts`                                     | `features/*/schemas` | `productWriteSchema` (`description`, `imageUrls`, `priceOverride`, `visible`, `featured`), `promotionBodySchema` discriminado por `scope`.                                                | `src/features/admin/schemas.ts`                                         |
| `src/features/admin/server/mutations.ts`         | `features/*/server/` | **Prisma, escritura. El único archivo del panel que escribe.** `commit()` privado revalida. `saveProduct`, `appendProductImage`, `createPromotion`, `updatePromotion`, `deletePromotion`. | `src/features/admin/server/mutations.ts`                                |
| `src/features/admin/components/ProductForm.tsx`  | `features/admin/`    | `"use client"` (HD7). Isla: estado, `fetch`, `issues` en línea, `<noscript>` con el aviso.                                                                                                | `src/features/admin/components/ProductForm.tsx`                         |
| `src/features/admin/components/ProductTable.tsx` | `features/admin/`    | Server component. Listado paginado con precio sincronizado y override (E14).                                                                                                              | `src/features/admin/components/ProductTable.tsx`                        |
| Listado de productos                             | `src/app/`           | `/admin/tiendas/[storeId]/productos`                                                                                                                                                      | `src/app/admin/tiendas/[storeId]/productos/page.tsx`                    |
| Editor de producto                               | `src/app/`           | `/admin/tiendas/[storeId]/productos/[storeProductId]`                                                                                                                                     | `src/app/admin/tiendas/[storeId]/productos/[storeProductId]/page.tsx`   |
| Endpoint de producto                             | `src/app/`           | `PUT` (alias `PATCH`) de los seis campos del panel.                                                                                                                                       | `src/app/api/admin/stores/[storeId]/products/[storeProductId]/route.ts` |

### Imágenes

| Componente                                        | Capa              | Responsabilidad                                                                                                                                                                       | Archivo                                                                         |
| ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/lib/supabase/storage.ts`                     | `src/lib/`        | **El único sitio que habla con la API de Storage.** `storageAvailability()`, `uploadStoreObject()`, `publicUrlFor()`, `publicUrlPrefix()`. Resultados discriminados; **nunca lanza**. | `src/lib/supabase/storage.ts`                                                   |
| `storagePaths.ts`                                 | `features/admin/` | Puro y testeable sin Storage: `objectPathFor({storeId, storeProductId, ext})` → `stores/<storeId>/products/<storeProductId>/<uuid>.<ext>` (R19).                                      | `src/features/admin/storagePaths.ts`                                            |
| `imageType.ts`                                    | `src/lib/`        | Puro: mime **por contenido** (números mágicos de jpeg/png/webp/avif) + extensión canónica (R20).                                                                                      | `src/lib/imageType.ts`                                                          |
| `constants/media.ts`                              | `src/constants/`  | `IMAGE_ALLOWED_MIME`, `IMAGE_MAX_BYTES`, `PRODUCT_MAX_IMAGES`.                                                                                                                        | `src/constants/media.ts`                                                        |
| `src/features/admin/components/ImageUploader.tsx` | `features/admin/` | `"use client"`. `input[type=file]`, `FormData`, barra de estado, borrado por reordenamiento del array.                                                                                | `src/features/admin/components/ImageUploader.tsx`                               |
| Endpoint de subida                                | `src/app/`        | `POST` `multipart/form-data` (única ruta del panel que no es JSON).                                                                                                                   | `src/app/api/admin/stores/[storeId]/products/[storeProductId]/images/route.ts`  |
| Emulador                                          | infra             | Cuatro servicios en `docker-compose.yml` + dos archivos en `docker/`. Ver § Emulador de Storage.                                                                                      | `docker-compose.yml`, `docker/storage-roles.sql`, `docker/storage-gateway.conf` |
| Optimizador                                       | infra             | `remotePatterns` derivando **protocolo, host y puerto** (R23). Ver § next.config.ts.                                                                                                  | `next.config.ts`                                                                |

### Promociones

| Componente                                        | Capa                 | Responsabilidad                                                                                                                                | Archivo                                                                                            |
| ------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `promotions.ts`                                   | `src/lib/`           | **Puro.** `indexPromotions()` (el `Map`), `selectPromotion()` (R26), `applyPromotion()` (R27), `orderDiscount()` (R30). Sin Prisma, sin React. | `src/lib/promotions.ts`                                                                            |
| `pricing.ts` (+)                                  | `src/lib/`           | Gana `resolvePrice()`: el **único** compositor precedencia → promoción → conversión. `displayPrice()` pasa a ser un envoltorio suyo.           | `src/lib/pricing.ts`                                                                               |
| `money.ts` (+)                                    | `src/lib/`           | Gana `percentageOff(money, percent)` y `compare(a,b)`. Toda la aritmética sigue en un solo módulo, en BigInt.                                  | `src/lib/money.ts`                                                                                 |
| `src/features/catalog/server/queries.ts` (+)      | `features/*/server/` | `loadCatalog` lee las promociones vigentes **dentro** de la lectura cacheada (R28) y adjunta candidatas por producto.                          | `src/features/catalog/server/queries.ts`                                                           |
| `src/features/orders/server/quote.ts` (+)         | `features/*/server/` | `quoteCart` lee promociones frescas, usa el **mismo** `resolvePrice` y calcula `discountTotal`.                                                | `src/features/orders/server/quote.ts`                                                              |
| `src/features/orders/server/createOrder.ts` (+)   | `features/*/server/` | Persiste `discountTotal` y `total = subtotal - discountTotal + deliveryFee`.                                                                   | `src/features/orders/server/createOrder.ts`                                                        |
| `CheckoutForm.tsx` (+)                            | `features/cart/`     | `expectedTotal` resta `discountTotal` (hallazgo 2). Sin esto, todo checkout con promoción `ORDER` da 409.                                      | `src/features/cart/components/CheckoutForm.tsx`                                                    |
| `ProductCard.tsx` (+)                             | `components/store/`  | Llama a `resolvePrice` y tacha `listPrice` cuando existe (E27).                                                                                | `src/components/store/ProductCard.tsx`                                                             |
| `src/features/admin/server/promotions.ts`         | `features/*/server/` | **Prisma, lectura** del panel: `listPromotions(storeId)`, `getPromotion(storeId, id)`.                                                         | `src/features/admin/server/promotions.ts`                                                          |
| `src/features/admin/components/PromotionForm.tsx` | `features/admin/`    | `"use client"`. Alta y edición.                                                                                                                | `src/features/admin/components/PromotionForm.tsx`                                                  |
| Pantalla y endpoints                              | `src/app/`           | `/admin/tiendas/[storeId]/promociones` + `POST`/`PUT`/`DELETE`.                                                                                | `src/app/admin/tiendas/[storeId]/promociones/…`, `src/app/api/admin/stores/[storeId]/promotions/…` |

### Retoques de reutilización

Cada uno es un paso verificable del plan, y ninguno duplica código existente.

| Archivo existente                     | Cambio                                                                                                                  | Por qué                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/app/api/internal/_lib/issues.ts` | Pasa a ser `export { serializableIssues } from "@/lib/httpJson"`.                                                       | Una sola implementación; sus call sites no cambian.                             |
| `src/features/orders/types.ts`        | `InvalidBodyIssue` queda como alias de `SerializableIssue`; `QuoteLine`/`QuoteResponse` ganan campos (ver § Contratos). | AGENTS.md prohíbe duplicar interfaces; `lib/` no puede depender de `features/`. |
| `src/app/admin/layout.tsx`            | Navegación: enlace a `/admin`. Nada más.                                                                                | No se toca la guarda ni el `force-dynamic`.                                     |
| `scripts/mint-sso-token.mjs`          | Bandera `--stores=<externalId>[,…]` (por omisión, las dos de hoy).                                                      | I7. Ver § Fixtures.                                                             |
| `.agent/init.sh`                      | Un `warn` (nunca `bad`) con el estado del emulador de Storage.                                                          | El entorno debe seguir diciendo ENTORNO LISTO sin los contenedores de imágenes. |

### Pruebas que exige la arquitectura

El detalle de casos es de `tests.md`; esto es lo que el diseño no puede quedarse
sin comprobar.

- `src/features/admin/authorization.test.ts` (node) — 401 sin sesión, 403 ajena, ok propia. Sin base de datos.
- `src/features/admin/schemas.test.ts` (node) — `priceOverride` negativo y con tres decimales → error; `0` → válido (ADR 0007); `imageUrls` con una URL fuera del bucket → error; `conditions` por `scope` (R30); `endsAt <= startsAt` → error.
- `src/features/admin/storagePaths.test.ts` (node) — la ruta lleva el `storeId` y un uuid distinto en dos llamadas.
- `src/lib/imageType.test.ts` (node) — un `text/plain` renombrado a `.jpg` no pasa; los cuatro mimes válidos sí.
- `src/lib/promotions.test.ts` (node) — R25 (ventana), R26 (gana la más baja, desempate por `startsAt` y por `id`), R27 (`PERCENTAGE` en rango, `FIXED` convertida, suelo en 0), R30 (`minSubtotal`), y `conditions` inválido → la promoción **no aplica a nada**.
- `src/lib/pricing.test.ts` (+) — `resolvePrice` sobre `priceOverride` (E30), sin promoción da exactamente lo que daba `displayPrice`, y `beforeConversion` cumple `unitPrice = convert(beforeConversion, …)` (la fórmula del contrato).
- `src/features/admin/server/mutations.test.ts` (node, `vi.mock` de `@/lib/cache`) — **cada** función exportada llama a `revalidateStores` con el slug de su tienda.
- `src/features/admin/server/boundaries.test.ts` (node) — (a) nadie importa `@/lib/prisma` fuera de `features/admin/server/`; (b) `revalidateStores` solo se importa en `mutations.ts`; (c) las cadenas `status`, `publishedAt`, `syncedPrice`, `localName` y `availability` no aparecen en `mutations.ts` (HD2, R8). Existe porque la regla de ESLint solo cubre `src/app/**/*.tsx` y un `route.ts` no la activa.
- `src/features/sync/server/handlers/product.test.ts` (node, **nuevo**) — el criterio 3: `handleProduct` de `UPDATE` no toca los seis campos del panel. Hoy la invariante solo vive en un comentario (`product.ts:83-86`) y no tiene ninguna prueba.

## Flujo de datos

### Escritura de producto (el camino que decide todo)

```mermaid
sequenceDiagram
  participant I as Isla ProductForm
  participant R as route.ts
  participant G as _lib/guard.ts
  participant A as authorization.ts
  participant M as server/mutations.ts
  participant DB as Postgres
  participant C as lib/cache.ts

  I->>R: PUT JSON { description, imageUrls, priceOverride, visible, featured }
  R->>G: guardAdminStore(storeId)
  G->>A: authorizeStore(session, storeId)
  A-->>G: ok(AuthorizedStoreId) | denial
  G-->>R: 401 / 403   (0 queries)
  R->>R: readJsonBody + productWriteSchema.safeParse → 400 INVALID_BODY
  R->>M: saveProduct(authorizedStoreId, storeProductId, data)
  M->>DB: SELECT syncedPriceCurrency, deletedAt, store.slug WHERE id=$1 AND storeId=$2
  DB-->>M: fila | vacío → { kind:"product_not_in_store" } → 403
  M->>DB: UPDATE "StoreProduct" SET <solo columnas del panel> WHERE id=$1 AND storeId=$2
  M->>C: revalidateStores([slug])
  M-->>R: { kind:"saved", … }
  R-->>I: 200 JSON (cache-control: no-store)
```

Puntos que no son adorno:

1. **El 403 de tienda ajena no toca la base.** `session.storeIds` son ids
   internos (`admin/sso/route.ts:47-51`): la pertenencia es una comparación de
   conjuntos. Una tienda que no existe también da 403: no se filtra existencia.
2. **El 403 de producto ajeno cuesta 1 query** y sale de la misma lectura que
   trae `syncedPriceCurrency` (R14) y el `slug` (R10). R4 sin round-trip extra.
3. **Dos round-trips, ningún `$transaction`.** El pooler corre en modo
   transacción (AGENTS.md, ficha `pooler-transaccion-deadlock`). No se puede
   hacer en uno: Prisma no sabe escribir `priceOverrideCurrency = syncedPriceCurrency`
   sin leerlo, y hacerlo con `$executeRaw` se saltaría la lista blanca de
   columnas, que es la garantía central del diseño.
4. **El `data` del `UPDATE` está tipado con una lista blanca**, así que
   `syncedPrice`, `localName`, `availability`, `sourceUpdatedAt` o `deletedAt`
   no son un descuido posible: son un error de compilación (R8, criterio 3).
5. **La revalidación vive dentro de `commit()`**, no en la ruta.

### Subida de imagen

```
POST multipart → guard (0 queries, 403 E4)
   → SELECT imageUrls, store.slug WHERE id=$1 AND storeId=$2     ← 403 E24 ANTES de leer el cuerpo
   → longitud actual >= PRODUCT_MAX_IMAGES → 409 (E23)
   → storageAvailability() → 503 con motivo (E25, I8)
   → request.formData() + sniff de mime por contenido → 400 (E22)
   → uploadStoreObject(path)                                     ← 1 llamada a la API de Supabase
   → UPDATE imageUrls = push(publicUrl)                          ← atómico, sin leer-modificar-escribir
   → revalidateStores([slug]) → 201 { url, imageUrls }
```

El orden **subir y después escribir** es deliberado (caso límite de la spec): si
la escritura falla queda un objeto huérfano en el bucket y **ninguna URL rota**.
El `uuid` de la ruta hace que un reintento cree otro objeto en vez de pisar uno.
`imageUrls: { push: url }` es una escritura atómica de Postgres: dos subidas
simultáneas no se pierden. La comprobación del máximo usa la longitud leída antes,
así que dos subidas a la vez pueden dejar 9: se acepta y se documenta, porque la
alternativa es un lock que el pooler no quiere.

### Lecturas del panel

`/admin` → sesión (0 queries) → `listManagedStores`: **0 queries** si
`storeIds` está vacío, **1** si no (`findMany where id in`, nunca `businessId`,
criterio 1). `/admin/tiendas/[id]` → `requireManagedStore` (0 queries) + 1
`findUnique`. `/admin/tiendas/[id]/productos` → 1 `findMany` paginado
(`take: ADMIN_PRODUCTS_PAGE_SIZE`) + 1 `count`. Nada pasa por `cached()` y todas
las páginas llevan `dynamic = "force-dynamic"` literal (R9, E9).

### Lectura pública tras la escritura (R10, I3)

`revalidateStores([slug])` dispara `revalidateTag(storeTag(slug))` y
`revalidateTag(storeCatalogTag(slug))` con `expire: 0`. Son los dos tags que
declaran `getStoreBySlug`, `getStoreCatalog` y `getStoreRates`
(`catalog/server/queries.ts:67-155`), y es el mismo mecanismo que ya usa el sync
(`processBatch.ts:57`): probado, no nuevo. **`revalidateProducts` no se usa
nunca**: `productTag` (`lib/cache.ts:22`) no lo declara ninguna lectura —la ficha
de producto lee `getStoreCatalog`—, así que un panel que confiara en él dejaría
la vitrina vieja hasta 3600 s (I3). Como la revalidación está dentro de
`commit()`, la elección del tag se hace **una vez, en un archivo**.

## Contratos

### Autorización — un solo sitio

```ts
// src/features/admin/authorization.ts   (puro: sin Prisma, sin React, sin fetch)
declare const authorized: unique symbol;
/** Un storeId que YA pasó por authorizeStore. Las mutaciones exigen este tipo. */
export type AuthorizedStoreId = string & { readonly [authorized]: true };

export type AdminDenial = "UNAUTHORIZED" | "FORBIDDEN";
export type AuthorizeResult =
  | { ok: true; storeId: AuthorizedStoreId; session: AdminSession }
  | { ok: false; denial: AdminDenial };

export function authorizeStore(session: AdminSession | null, storeId: string): AuthorizeResult;
// null            → UNAUTHORIZED → 401 en API, redirect en página (ya lo hace el layout)
// !canManageStore → FORBIDDEN    → 403 en API, notFound() en página (E3, R7)
```

Las tres respuestas salen del **mismo** valor, mapeado en dos sitios y solo dos:
`src/app/api/admin/_lib/guard.ts` (401/403) y
`features/admin/server/stores.ts::requireManagedStore` (`notFound()`, gemelo de
`requireStore` en catalog). No se usa `forbidden()` de Next 16: exige
`experimental.authInterrupts` y E3 pide 404, no 403.

### El embudo

```ts
// src/features/admin/server/mutations.ts — el ÚNICO archivo del panel que escribe
import type { Prisma } from "@/generated/prisma/client";

/** Las ÚNICAS columnas de StoreProduct que el panel puede escribir (R8). */
type PanelProductColumn =
  "description" | "imageUrls" | "priceOverride" | "priceOverrideCurrency" | "visible" | "featured";
type PanelProductWrite = Pick<Prisma.StoreProductUpdateInput, PanelProductColumn>;

export type AdminWriteResult<T> =
  | { kind: "saved"; value: T }
  | { kind: "created"; id: string; value: T }
  | { kind: "product_not_in_store" } // → 403 (E19)
  | { kind: "promotion_not_in_store" } // → 403 (E33)
  | { kind: "product_deleted" } // → 409: un producto borrado suave no se edita
  | { kind: "too_many_images" } // → 409 (E23)
  | { kind: "invalid_conditions"; issues: SerializableIssue[] } // → 400 (R30)
  | { kind: "storage_unavailable"; reason: StorageFailure } // → 503 (E25)
  | { kind: "failed" }; // → 500

/** Escribe y revalida. Ninguna mutación exportada escribe fuera de aquí. */
async function commit<T>(slug: string, write: () => Promise<T>): Promise<T> {
  const value = await write();
  revalidateStores([slug]);
  return value;
}

export function saveProduct(
  storeId: AuthorizedStoreId,
  storeProductId: string,
  body: ProductWriteBody,
): Promise<AdminWriteResult<AdminProductRow>>;
export function appendProductImage(
  storeId: AuthorizedStoreId,
  storeProductId: string,
  file: UploadedImage,
): Promise<AdminWriteResult<{ url: string; imageUrls: string[] }>>;
export function createPromotion(
  storeId: AuthorizedStoreId,
  body: PromotionBody,
): Promise<AdminWriteResult<AdminPromotionRow>>;
export function updatePromotion(
  storeId: AuthorizedStoreId,
  promotionId: string,
  body: PromotionBody,
): Promise<AdminWriteResult<AdminPromotionRow>>;
export function deletePromotion(
  storeId: AuthorizedStoreId,
  promotionId: string,
): Promise<AdminWriteResult<{ id: string }>>;
```

### Endpoints

`content-type: application/json` **estricto** en todos menos en la subida (es lo
que fuerza el preflight CORS; con `sameSite: lax` el envío cruzado ni lleva
cookie — ADR 0016 §defensa 4). Tope `ADMIN_MAX_BODY_BYTES` = 16 KB (un
`imageUrls` de 8 URLs y una descripción larga caben de sobra). Todas las
respuestas llevan `cache-control: no-store`. `PATCH` es alias de `PUT` en las
rutas de reemplazo, porque la verificación de la spec está escrita con `PATCH` y
un 405 ahí sería un falso negativo del sensor.

```
PUT   /api/admin/stores/{storeId}/products/{storeProductId}          (alias PATCH)
  body (reemplazo, el estado completo del formulario):
    { description: string | null,
      imageUrls: string[],                    // ≤ 8, cada una bajo el prefijo público del bucket
      priceOverride: string | null,           // decimal ≥ 0, 2 decimales; "0" es un precio real
      visible: boolean, featured: boolean }
  200 { id, slug, description, imageUrls, priceOverride, priceOverrideCurrency, visible, featured }
  · priceOverrideCurrency NO se acepta del cliente: lo pone el servidor igual al
    syncedPriceCurrency del momento (R14). priceOverride null ⇒ las dos a null.

POST  /api/admin/stores/{storeId}/products/{storeProductId}/images
  multipart/form-data, campo `file`
  201 { url, imageUrls }

POST  /api/admin/stores/{storeId}/promotions
  body { type: "PERCENTAGE"|"FIXED", scope: "PRODUCT"|"CATEGORY"|"ORDER",
         value: string, startsAt: string, endsAt: string | null, active: boolean,
         conditions: <discriminado por scope, R30> }
  201 { id, … }
PUT   /api/admin/stores/{storeId}/promotions/{promotionId}           (alias PATCH)
  200 { id, … }
DELETE /api/admin/stores/{storeId}/promotions/{promotionId}
  200 { id, deleted: true }
```

### Tabla de errores

| Código  | Cuerpo                                                                                                                   | Cuándo                                                                                            | Dónde se decide                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 200/201 | payload del recurso                                                                                                      | Guardado o creado                                                                                 | `route.ts` ← `AdminWriteResult`                            |
| 400     | `{"error":"INVALID_BODY","issues":[{"path":[…],"message":…}]}`                                                           | Zod, JSON inválido, `content-type` no JSON, cuerpo > 16 KB, `conditions` fuera de la tienda (R30) | `src/app/api/admin/_lib/respond.ts` + `serializableIssues` |
| 400     | `{"error":"INVALID_FILE","reason":"mime"\|"too_large"\|"empty"}`                                                         | Mime por contenido fuera de la lista, > `IMAGE_MAX_BYTES`, o sin archivo (E22)                    | ruta de imágenes                                           |
| 401     | `{"error":"UNAUTHORIZED"}`                                                                                               | Sin cookie o vencida (E5). Un endpoint no redirige.                                               | `src/app/api/admin/_lib/guard.ts`                          |
| 403     | `{"error":"FORBIDDEN"}`                                                                                                  | `storeId` fuera de `session.storeIds` (E4), o fila de otra tienda (E19, E24, E33)                 | `src/app/api/admin/_lib/guard.ts` / `mutations.ts`         |
| 404     | `{"error":"NOT_FOUND"}`                                                                                                  | La tienda autorizada ya no existe (borrada entre dos inicios de sesión)                           | `mutations.ts`                                             |
| 409     | `{"error":"TOO_MANY_IMAGES","max":8}`                                                                                    | El producto ya llegó al máximo (E23)                                                              | `mutations.ts`                                             |
| 409     | `{"error":"PRODUCT_DELETED"}`                                                                                            | Producto borrado suave: se muestra marcado, no se edita                                           | `mutations.ts`                                             |
| 405     | (Next)                                                                                                                   | Método no exportado                                                                               | Next                                                       |
| 500     | `{"error":"WRITE_FAILED"}`                                                                                               | Excepción no prevista, con `console.error("[admin] …")`                                           | `route.ts`                                                 |
| 503     | `{"error":"STORAGE_UNAVAILABLE","reason":"missing_service_role_key"\|"missing_supabase_url"\|"unreachable"\|"rejected"}` | Storage caído o sin credencial (E25, R18, **I8**)                                                 | `lib/supabase/storage.ts` → `mutations.ts`                 |

Del lado **público** hay un error nuevo por HD11, con su propia explicación en
§ El checkout y el pedido: **409 `{"error":"STORE_CLOSED"}`** en
`POST /api/orders/quote` y en `POST /api/orders`.

**I8, cerrado**: `serverEnv()` mantiene `SUPABASE_SERVICE_ROLE_KEY` como
`optional()` —volverla obligatoria rompería `serverEnv()` para toda la app, que
no necesita Storage— y es `storageAvailability()` quien decide en el borde. El
`reason` va en el cuerpo **y** en `console.error`, precisamente para que
«emulador apagado» (`unreachable`) no se confunda con «criterio 4 fallido».

### Esquemas Zod

```ts
// src/features/admin/schemas.ts
const decimal2 = z.string().regex(/^\d+(\.\d{1,2})?$/, "Not an amount with 2 decimals");

export const productWriteSchema = z
  .object({
    description: z
      .string()
      .trim()
      .max(ADMIN_PRODUCT_DESCRIPTION_MAX_LENGTH)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null), // R13
    imageUrls: z
      .array(z.string().url().startsWith(publicUrlPrefix()))
      .max(PRODUCT_MAX_IMAGES)
      .default([]),
    priceOverride: decimal2.nullable().default(null), // R15: "0" válido
    visible: z.boolean(),
    featured: z.boolean(),
  })
  .strict() satisfies z.ZodType<ProductWriteBody>;

const promotionBase = {
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: decimal2,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  active: z.boolean().default(true),
};
export const promotionBodySchema = z
  .discriminatedUnion("scope", [
    z.object({
      scope: z.literal("PRODUCT"),
      ...promotionBase,
      conditions: z.object({ storeProductIds: z.array(z.string().uuid()).min(1) }).strict(),
    }),
    z.object({
      scope: z.literal("CATEGORY"),
      ...promotionBase,
      conditions: z.object({ localCategoryIds: z.array(z.string().uuid()).min(1) }).strict(),
    }),
    z.object({
      scope: z.literal("ORDER"),
      ...promotionBase,
      conditions: z.object({ minSubtotal: decimal2.optional() }).strict(),
    }),
  ])
  .refine(percentageInRange, "PERCENTAGE must be in (0, 100]") // R27
  .refine(fixedPositive, "FIXED must be > 0") // R27
  .refine(endsAfterStarts, "endsAt must be after startsAt"); // caso límite
```

`publicUrlPrefix()` es lo que impide que el panel guarde en `imageUrls` una URL
que no sea del bucket (R21): las filas viejas o manipuladas siguen renderizando
sin imagen, pero no se pueden crear nuevas. Que los ids de `conditions` sean de
la tienda no lo puede saber Zod: lo comprueba `mutations.ts` con **1 query**
(`count` sobre `StoreProduct` con `storeId`, o sobre `LocalCategory` con el
`businessId` de la tienda, que es su ámbito real) y devuelve
`invalid_conditions` → 400 (R30: un `conditions` que no valida es un 400, nunca
una promoción que aplica a todo).

### Cambios en el cable interno (no en el contrato con cuadrecaja)

```ts
// src/features/orders/types.ts
export type QuoteLine = {
  …lo de hoy…,
  /** Precio de lista en la moneda del pedido, si una promoción bajó el precio. */
  listUnitPrice: string | null;
};
export type QuoteResponse = {
  …lo de hoy…,
  /** Descuento de alcance ORDER, en la moneda del pedido. "0" si no hay. */
  discountTotal: string;
};
```

Es cable interno entre `/api/orders/quote` y las islas del carrito, **no**
`docs/sync-contract.md`. `CheckoutForm.tsx:248` pasa a calcular
`expectedTotal = subtotal - discountTotal + deliveryFee` (hallazgo 2). Sin este
cambio, cualquier promoción de alcance `ORDER` hace que **todos** los checkouts
respondan 409 `PRICE_CHANGED`, que es un fallo de F-010 —ya verificado— causado
por F-011. La verificación de F-010 se vuelve a correr al cerrar esta tanda.

## Promociones al detalle

### El orden de las operaciones, y por qué no es negociable

```
effectivePrice(product)      → Money en la moneda DEL PRODUCTO   (lib/pricing.ts, ya existe)
applyPromotion(...)          → Money en la moneda DEL PRODUCTO   (lib/promotions.ts, nuevo)
convert(..., orderCurrency)  → Money en la moneda DEL PEDIDO     (lib/money.ts, ya existe)
```

El descuento se aplica **antes** de convertir. No es una preferencia: es lo que
mantiene viva la fórmula que `docs/sync-contract.md:331` publica al POS,

```
unitPrice = convert(originalUnitPrice, currencyCode, rateSnapshot.rates)
```

porque `OrderItem.originalUnitPrice` es «el precio efectivo antes de convertir»
(`prisma/schema.prisma:432`), y con promoción el precio efectivo **es** el
descontado. Descontar después de convertir rompería la fórmula al céntimo y eso
es una v3 del contrato, que I5 y R29 descartan explícitamente.

Y como el descuento se calcula sobre la salida de `effectivePrice()`, **E30 sale
gratis**: si hay `priceOverride`, el porcentaje se aplica sobre el override y
nunca sobre `syncedPrice`. Ninguna vista reimplementa la precedencia (R16).

### El compositor único

```ts
// src/lib/pricing.ts  (+)
export type ResolvedPrice = {
  /** Precio cobrado/mostrado, ya convertido a `targetCurrency`. */
  price: Money;
  /** El MISMO dinero antes de convertir. Es lo que va a OrderItem.originalUnitPrice. */
  beforeConversion: Money;
  /** Precio de lista convertido, para el tachado. `null` si ninguna promoción aplicó. */
  listPrice: Money | null;
  isOverridden: boolean;
  promotionId: string | null;
};

export function resolvePrice(
  product: PriceFields,
  options: {
    targetCurrency: string;
    rates: RateTable;
    /** Candidatas ya filtradas por vigencia y alcance. Vacío = camino de hoy. */
    promotions?: readonly AppliedPromotion[];
    /** Moneda en la que se interpreta el `value` de una promoción FIXED (R27). */
    baseCurrency: string;
  },
): ResolvedPrice;

/** Se mantiene, implementado sobre resolvePrice: un solo camino de código. */
export function displayPrice(
  product: PriceFields,
  displayCurrency: string,
  rates: RateTable,
): EffectivePrice;
```

`resolvePrice` es el único sitio donde se encadenan los tres pasos, y lo usan
**los dos** caminos que muestran o cobran un precio: `ProductCard` (y la ficha de
producto) y `quoteLine`. Cuando `promotions` viene vacío, devuelve exactamente lo
que devuelve hoy `displayPrice` — condición que fija un test.

### El módulo puro

```ts
// src/lib/promotions.ts   (sin Prisma, sin React)
export type PromotionRow = {
  id: string;
  type: "PERCENTAGE" | "FIXED";
  scope: "PRODUCT" | "CATEGORY" | "ORDER";
  value: string;
  conditions: unknown;
  startsAt: Date;
  endsAt: Date | null;
  active: boolean;
};
export type AppliedPromotion = Omit<PromotionRow, "conditions" | "scope"> & {
  scope: "PRODUCT" | "CATEGORY";
};
export type OrderPromotion = Omit<PromotionRow, "conditions" | "scope"> & {
  minSubtotal: string | null;
};

export type PromotionIndex = {
  /** O(1). Devuelve las candidatas de un producto: las suyas más las de su categoría. */
  forProduct(storeProductId: string, localCategoryId: string | null): readonly AppliedPromotion[];
  readonly order: readonly OrderPromotion[];
};

/** Construye el Map UNA vez por lectura. O(filas). */
export function indexPromotions(rows: readonly PromotionRow[], now: Date): PromotionIndex;

/** R26: gana la que deja el precio más bajo; empate por startsAt asc, luego id asc. */
export function selectPromotion(
  candidates: readonly AppliedPromotion[],
  price: Money,
  ctx: { rates: RateTable; baseCurrency: string },
): AppliedPromotion | null;

/** R27. Nunca por debajo de 0. */
export function applyPromotion(
  price: Money,
  promotion: AppliedPromotion,
  ctx: { rates: RateTable; baseCurrency: string },
): { price: Money; listPrice: Money };

/** R30 + R26 para alcance ORDER. Acotado a `subtotal`: el total nunca es negativo. */
export function orderDiscount(
  subtotal: Money,
  promotions: readonly OrderPromotion[],
  ctx: { rates: RateTable; baseCurrency: string },
): { discount: Money; promotionId: string | null };
```

**Dónde se indexa el `Map`.** Dentro de `indexPromotions`, en una sola pasada
sobre las filas, y se llama **una vez por lectura** —no una vez por línea—:

- Filtra por vigencia (R25: `active && startsAt <= now && (endsAt == null || endsAt > now)`).
- Valida `conditions` con el esquema de su `scope`. **Una fila cuyo `conditions`
  no valida se descarta con un `console.warn` y no aplica a nada** (R30): el modo
  de fallo peligroso sería tratarla como «aplica a todo».
- Construye `Map<storeProductId, AppliedPromotion[]>` y
  `Map<localCategoryId, AppliedPromotion[]>`, y la lista de `ORDER`.

Coste total O(filas + líneas) en vez de O(filas × líneas). Escrito ingenuo, con
500 productos y 200 promociones son 100.000 comparaciones de `Decimal` por
regeneración de la vitrina.

**Moneda (R27, I4), cerrado sin columna nueva.** `Promotion.value` no tiene
moneda (`schema.prisma:327`). Convención: `PERCENTAGE` es adimensional;
`FIXED` se interpreta en `Business.baseCurrencyCode` y se convierte a la moneda
de la línea con `convert()` y las mismas tasas que el resto del cálculo. Si la
conversión no es posible (falta la tasa), **la promoción se ignora** y se
registra: nunca se lanza. Es coherente entre la vitrina y el pedido porque los
dos caminos usan las mismas tasas, y el checkout tiene además la red del 409.
La alternativa —`Promotion.valueCurrency`— sigue siendo una migración aditiva si
el humano la prefiere después; la convención queda escrita en la ADR 0017.

**Aritmética.** `src/lib/money.ts` gana dos funciones para que ningún cálculo se
salga del módulo que hace todo en BigInt: `percentageOff(price, percent)` y
`compare(a, b)` (que es lo que `selectPromotion` necesita para elegir el mínimo
sin pasar por `Number`).

### Cómo entra en la lectura cacheada (R28)

`loadCatalog` (dentro de `cached(..., { tags: [storeCatalogTag(slug)] })`) hace
**una** query más y adjunta candidatas a cada producto:

```ts
const [products, promotions] = await Promise.all([ …lo de hoy…,
  prisma.promotion.findMany({
    where: { store: { slug }, active: true, startsAt: { lte: now },
             OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    select: { id: true, type: true, scope: true, value: true, conditions: true,
              startsAt: true, endsAt: true, active: true },
  }),
]);
const index = indexPromotions(promotions, now);
// CatalogProduct gana: promotions: AppliedPromotion[]
```

`CatalogProduct` gana **un campo**, no una interfaz nueva (AGENTS.md prohíbe
duplicarlas). La vigencia se evalúa **dentro** de la lectura cacheada, que es
exactamente lo que R28 acepta: un borde de ventana se ve con hasta
`STOREFRONT_REVALIDATE` (3600 s) de retardo, escribir una promoción revalida en
el acto (R10), y el checkout recalcula en caliente. No se añade cron (fuera de
alcance por decisión de la spec).

Por qué se adjuntan las **candidatas** y no el precio final: elegir la ganadora
necesita el precio, y el precio necesita `displayCurrency` y `rates`, que son
argumentos de la página, no de la lectura. Adjuntar candidatas mantiene la
selección en un solo sitio (`resolvePrice`) para vitrina y pedido.

### Cómo entra en el pedido

`quoteCart` ya lee productos y tasas frescas en un `Promise.all`; se le añade la
misma lectura de promociones (fresca, **no** cacheada: un precio viejo aquí es un
total equivocado allá) y `quoteLine` pasa de

```ts
const original = effectivePrice(product);
const unitPrice = convert(original, storeCurrency, rates);
```

a un único `resolvePrice(product, { targetCurrency: storeCurrency, rates, promotions, baseCurrency })`,
del que sale:

| Campo del pedido                 | De dónde                                 | Por qué                                                                                              |
| -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `OrderItem.unitPrice`            | `resolved.price`                         | **Con el descuento dentro** (R29, E28)                                                               |
| `OrderItem.currencyCode`         | `resolved.price.currency`                | La moneda del pedido                                                                                 |
| `OrderItem.lineTotal`            | `multiply(resolved.price, qty)`          | `Σ lineTotal = subtotal` sigue en pie                                                                |
| `OrderItem.originalUnitPrice`    | `resolved.beforeConversion`              | **Sigue significando «efectivo antes de convertir»**: la fórmula del contrato se mantiene al céntimo |
| `OrderItem.originalCurrencyCode` | `resolved.beforeConversion.currency`     | Ídem                                                                                                 |
| `Order.discountTotal`            | `orderDiscount(subtotal, …).discount`    | **Solo** el descuento de alcance `ORDER` (R29)                                                       |
| `Order.total`                    | `subtotal - discountTotal + deliveryFee` | La fórmula que el contrato ya publica                                                                |
| `listUnitPrice` (solo cable)     | `resolved.listPrice`                     | Tachado en el carrito. **No se persiste**                                                            |

**El precio de lista no se guarda en el pedido**, y es una decisión: no hay
columna para él, `originalUnitPrice` está ocupada con otro significado publicado,
y ningún criterio ni requisito `P1..P12` pide auditar el precio anterior de un
pedido cerrado. Si el negocio lo pide, es una migración aditiva
(`OrderItem.listUnitPrice` + `promotionId`) y un feature propio. E34 se cumple
por construcción: los importes del pedido están congelados en filas, nada los
recalcula, y `rateSnapshot` sigue siendo la única fuente de tasas históricas.

## Emulador de Storage (HD1)

**Decisión: `docker-compose.yml`, cuatro servicios nuevos.** Es el riesgo número
uno de la tanda, así que va con criterio de abandono explícito y con los pasos
contados.

### Los servicios

| Servicio              | Imagen                       | Para qué                                                                                  | Puerto            |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| `postgres`            | `postgres:16-alpine`         | **El de hoy. No se toca.**                                                                | 5433:5432         |
| `storage-db`          | `postgres:16-alpine`         | Base propia de `storage-api` (esquema `storage`, sus roles). Volumen propio.              | ninguno (interno) |
| `storage`             | `supabase/storage-api:<tag>` | La API de Supabase Storage de verdad, en modo single-tenant, backend de archivo.          | ninguno (interno) |
| `storage-gateway`     | `nginx:1.27-alpine`          | Traduce `/storage/v1/*` → `storage:5000/*`. Es lo que da a la URL la forma exacta de R21. | **54321:80**      |
| `storage-bucket-init` | `curlimages/curl:8.11.0`     | Un solo disparo: crea el bucket público `store-media`. Idempotente.                       | —                 |

Variables de `storage` (single-tenant): `MULTI_TENANT=false`, `TENANT_ID=stub`,
`REGION=stub`, `GLOBAL_S3_BUCKET=stub`, `STORAGE_BACKEND=file`,
`FILE_STORAGE_BACKEND_PATH=/var/lib/storage`, `FILE_SIZE_LIMIT=10485760`,
`ENABLE_IMAGE_TRANSFORMATION=false`, `PGRST_JWT_SECRET=<secreto de desarrollo>`,
`ANON_KEY=<clave anon local>`, `SERVICE_KEY=<clave service local>`,
`DATABASE_URL=postgres://postgres:postgres@storage-db:5432/storage`.
Volumen para `/var/lib/storage` y healthcheck contra `GET /status`.

### Cinco decisiones dentro de esta decisión, cada una por un motivo concreto

1. **Base de datos aparte, no la de la app.** `storage-api` corre sus propias
   migraciones y crea un esquema `storage`. Si viviera en `queandabuscando`,
   cualquier `prisma migrate diff` podría verlo. Verificable: tras levantar todo,
   `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   no menciona `storage`.
2. **Contenedor de Postgres aparte, no otra base en el de hoy.** `storage-api`
   espera roles al estilo Supabase (`anon`, `authenticated`, `service_role`,
   `supabase_storage_admin`), y la forma limpia de crearlos es
   `docker-entrypoint-initdb.d`, **que solo corre con el volumen vacío**. El
   volumen `queandabuscando-pgdata` ya tiene datos, así que ahí nunca correría.
   Un contenedor nuevo con volumen nuevo lo resuelve y no pone en riesgo la base
   de desarrollo. Archivo: `docker/storage-roles.sql`.
3. **nginx y no Kong.** `storage-api` monta sus rutas en `/`
   (`/object/public/<bucket>/<path>`), mientras `@supabase/supabase-js` pega a
   `${url}/storage/v1/...`. Hace falta traducir el prefijo, y eso es una regla:
   `location /storage/v1/ { proxy_pass http://storage:5000/; }`. Kong es la pieza
   del stack completo y trae configuración desproporcionada.
   **Con `client_max_body_size 10m` en esa conf**: el valor por omisión de nginx
   es 1 MB y una subida de 2 MB moriría con un 413 de nginx que no es ninguno de
   los errores de nuestra tabla. Archivo: `docker/storage-gateway.conf`.
4. **Bucket sembrado por un servicio de un disparo**, no por un script que haya
   que recordar: `POST /storage/v1/bucket` con la clave de servicio y
   `{"name":"store-media","public":true}`, tratando el 409 como éxito. Así
   `docker compose up -d` deja el entorno del criterio 4 completo, que es lo que
   la spec ya asume.
5. **Sin `imgproxy`.** Solo hace falta para `/render/image`, y aquí optimiza
   `next/image`.

### `.env.example` y el entorno

Las cuatro variables **ya existen** en `.env.example`; lo que cambia son sus
valores de desarrollo y un comentario:

```
NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"   # emulador de docker compose
NEXT_PUBLIC_SUPABASE_ANON_KEY="<clave anon local de Supabase>"
SUPABASE_SERVICE_ROLE_KEY="<clave service local de Supabase>"
SUPABASE_STORAGE_BUCKET="store-media"
```

Las dos claves son las conocidas del desarrollo local de Supabase, firmadas con
el mismo secreto que recibe `PGRST_JWT_SECRET`: son públicas a propósito y solo
valen contra el emulador. **No hace falta tocar el chequeo de variables de
`.agent/init.sh`**: su bucle solo exige que las claves de `.env.example` tengan
valor en `.env`, y estas cuatro ya estaban declaradas.

Lo que sí se añade a `.agent/init.sh` es un bloque `== Storage ==` que llama a

```bash
curl -fsS -m 3 "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/bucket" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | grep -q store-media
```

y reporta con **`warn`, nunca con `bad`**: una sesión que no toca imágenes tiene
que seguir leyendo **ENTORNO LISTO** (`init.sh:77-83` corta con `FAIL`, y `warn`
no lo pone). El aviso dice literalmente qué ejecutar (`docker compose up -d`).
`sdd.sh start` no cambia: llama a `init.sh` y ya.

### Consecuencia aceptada

Apuntar `NEXT_PUBLIC_SUPABASE_URL` al emulador deja sin servicio al cliente de
Supabase Auth del comprador (`src/lib/supabase/client.ts`): no hay `gotrue` en
este compose. Hoy ya está roto (el `.env` apunta a `placeholder.supabase.co`), así
que no es una regresión, y **F-012** decidirá si añade el servicio de auth al
mismo compose. Queda escrito para que no se descubra en medio de F-012.

### Pasos y criterio de abandono

Son **seis pasos verificables**, ninguno de más de un archivo:

1. `docker/storage-roles.sql` y `docker/storage-gateway.conf`.
2. Los cuatro servicios y los dos volúmenes en `docker-compose.yml`.
3. Valores locales en `.env.example`.
4. Bloque `== Storage ==` (`warn`) en `.agent/init.sh`.
5. `remotePatterns` en `next.config.ts` (§ siguiente).
6. Verificación de extremo a extremo (§ Verificación del criterio 4).

**Riesgo conocido**: el compose oficial de Supabase arranca `storage-api` con un
`POSTGREST_URL` apuntando a PostgREST. Para crear un bucket, subir y descargar
un objeto público **no debería** hacer falta, pero si el arranque o la subida
fallan con un error que menciona PostgREST o `POSTGREST_URL`, se añade
`postgrest/postgrest` como **quinto servicio**: es un paso previsto, no un
rediseño.

**Criterio de abandono, explícito para que no sea «cuando me harte»**: si tras
**dos** intentos de arranque —el segundo ya con PostgREST— el emulador no sirve
`GET /storage/v1/bucket` con 200, o si aparece la necesidad de un **sexto**
servicio, se abandona el compose y se pasa al plan B: **la CLI de Supabase**
(`supabase start`) invocada desde un script de entorno, sacrificando «todo en
docker-compose» y conservando HD1 (API de Supabase de verdad, sin driver de
disco). El plan B se anota en el progreso del feature y se ficha en el playbook.

## `next.config.ts` — protocolo, host y puerto

Hoy (`next.config.ts:12-14`) el patrón fija `protocol: "https"` y **omite el
puerto**. Con el emulador (`http`, `localhost:54321`) `next/image` responde
**400** y el criterio 4 se cae sin que nadie entienda por qué: el optimizador
compara puerto, y un `port` ausente en el patrón significa «solo el puerto por
omisión del protocolo».

```ts
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : undefined;

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: supabase
      ? [
          {
            protocol: supabase.protocol.replace(":", "") as "http" | "https",
            hostname: supabase.hostname,
            // Sin esto, `localhost:54321` no coincide y el optimizador da 400.
            ...(supabase.port ? { port: supabase.port } : {}),
            // La restricción de ruta se conserva: solo objetos públicos.
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
  typescript: { ignoreBuildErrors: false },
};
```

Tres propiedades del diseño que hay que no perder:

- **Deriva, no enumera**: no hay una lista con «localhost» dentro. En producción
  `NEXT_PUBLIC_SUPABASE_URL` es `https://<ref>.supabase.co` sin puerto, el
  spread no añade `port` y el patrón queda **idéntico al de hoy**. Un patrón
  para desarrollo no queda abierto en producción.
- **`pathname` sigue restringido** a `/storage/v1/object/public/**`: el
  optimizador no se convierte en un proxy de imágenes de cualquier ruta del host.
- **Se lee en build.** `next.config.ts` corre al construir: la variable tiene que
  estar puesta en `next build`, no solo al arrancar. En Vercel ya lo está; en
  local, `.env` lo cubre.

### Verificación del criterio 4 (paso 6, y lo que el smoke tiene que hacer)

```bash
docker compose up -d                       # incluye storage, gateway y el bucket
curl -fsS http://localhost:54321/storage/v1/bucket \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | grep -q store-media
npm run db:migrate && npm run seed && npm run build && npx next start &
# cookie con la bandera de I7
node scripts/mint-sso-token.mjs --stores=seed-tienda-1
curl -F file=@fixture.jpg -b cookie \
  ".../api/admin/stores/$STORE_ID/products/$PRODUCT_ID/images"      # → 201 + url
curl -sI "$URL"                                                     # → 200 desde el emulador
curl -s http://localhost:3000/tienda-demo | grep -o '/_next/image?url=[^"]*'
curl -sI "http://localhost:3000/_next/image?url=…&w=640&q=75"       # → 200 + image/avif|webp
docker compose stop storage && curl -s -o /dev/null -w '%{http_code}' -F file=@fixture.jpg …  # → 503
```

El último comando es el que separa «emulador apagado» de «criterio 4 fallido»: el
cuerpo del 503 trae `reason`.

## Modelo de datos y migraciones

**El alcance de productos, imágenes y promociones no necesita ninguna
migración.** Lo que sí la necesita es el interruptor de HD10, y va aparte, con su
`UPDATE` retroactivo, en § La migración. Conviene defender explícitamente esta
separación: son dos pasos del plan, no uno, y el primero puede firmarse sin el
segundo.

Del lado de productos y promociones no hace falta nada nuevo:

- `StoreProduct` ya tiene sus seis columnas del panel
  (`schema.prisma:266-272`), con el bloque de comentarios que marca la frontera.
- `Promotion` ya existe completa, con `@@index([storeId, active])`, que es
  exactamente el índice de la query de promociones vigentes.
- `Order.discountTotal` ya existe con `@default(0)` y ya viaja al POS
  (`pull.ts:84`), así que activarla no cambia el contrato.
- `imageUrls` ya es `String[] @default([])`, y Prisma sabe hacerle `push`.
- Las cuatro columnas de override de tienda **no se crean** (HD5).

Del lado del interruptor (HD10–HD14), tres columnas nuevas en `Store` y un
`UPDATE` retroactivo: el SQL exacto, el mapa de estados y los dos bloques
condicionados a AP5/AP6 están en § Habilitar y deshabilitar la tienda al público.

Si en el camino algo pareciera necesitar `prisma migrate reset` o
`prisma db push`, **hay que parar y preguntar** (AGENTS.md § Comandos
prohibidos). Aquí no hay ni una razón para ninguno de los dos.

En la migración del interruptor queda en pie la trampa fichada: revisar el `migration.sql` generado y borrar cualquier `DROP INDEX` de los
índices GIN de `CanonicalProduct`, que Prisma no declara
(`prisma-migrate-dev-borra-indices-gin-no-declarados`).

## Fixtures

**I7 — la tienda ajena.** `scripts/mint-sso-token.mjs:28` firma hoy
`["seed-tienda-1","seed-tienda-2"]`, así que no hay ninguna tienda ajena contra
la que provocar el 403. Decisión: **bandera en el script**, no tienda nueva en el
seed.

```
node scripts/mint-sso-token.mjs                        # las dos (como hoy)
node scripts/mint-sso-token.mjs --stores=seed-tienda-1 # solo la primera → tienda-dos es ajena
```

Toma **`externalId`s** (lo que manda el POS); `/admin/sso` los mapea a ids
internos. Descartado añadir una tercera tienda al seed: `tienda-demo` y
`tienda-dos` son fixtures de F-010 (`checkoutMode`, `deliveryFee`) y no se tocan.
Descartado un segundo `AdminUser`: la autorización sale del token, no de la tabla.

Las URLs del panel llevan **ids internos** (uuid): la verificación los saca del
listado (`StoreList` emite `data-store-id`, y `ProductTable` emite
`data-store-product-id`) o con `psql -c 'select id, slug from "Store"'`, que el
smoke ya necesita para comprobar `imageUrls` antes y después. Que eso decida la
forma del HTML es el motivo de que esté escrito en la arquitectura.

**Fixture de imagen**: un JPEG pequeño de verdad (no un `.txt` renombrado) y un
archivo mayor que el tope, generados en el propio smoke con `head -c` y un JPEG
mínimo en base64, para no meter binarios en el repo.

## Habilitar y deshabilitar la tienda al público (HD10–HD15)

Alcance nuevo, y **supera la mitad de HD2 que hablaba de `status`**: el panel
ahora sí escribe ese estado y `src/features/sync/server/handlers/store.ts` —que HD2 había congelado— se
modifica. La otra mitad de HD2 (contacto y descripción son del sync) sigue en
pie: HD5 la dejó en modo lectura.

### El modelo: un solo estado, el que ya existe

**Se reutiliza `Store.status` con su enum actual** (`DRAFT`/`PUBLISHED`/`SUSPENDED`),
sin valores nuevos. HD13 pide un solo estado compartido y `SUSPENDED` ya
significa exactamente «existió y ahora no se vende»: es lo que escribe hoy
`handlers/store.ts:35-42` cuando el POS retira su `publishToStore`.

Descartado añadir un `DISABLED` para distinguir «cerrada por el negocio» de
«retirada por el POS»: serían dos estados que **renderizan igual** (HD11), y
obligaría a cambiar todo `status === "SUSPENDED"` por una comprobación de dos
valores. Lo que distingue un caso del otro es el motivo, y para eso hay columna.

Mapa completo de estado → público, que es la decisión que `queries.ts` necesita:

| `status`    | `/[slug]`                             | `/[slug]/p/…` | Carrito y checkout         | `/[slug]/pedido/[code]` |
| ----------- | ------------------------------------- | ------------- | -------------------------- | ----------------------- |
| `PUBLISHED` | 200 con catálogo                      | 200           | 200 / pedido aceptado      | 200                     |
| `SUSPENDED` | **200 con el aviso de cierre** (HD11) | **404**       | redirige a `/[slug]` / 409 | **200** (HD11)          |
| `DRAFT`     | **404**                               | 404           | 404                        | 200 si el pedido existe |

`DRAFT` sigue siendo «nunca fue pública»: no hay URL que honrar ni marca que
mostrar, así que 404. Hoy nada la produce (`handleStore` crea en `PUBLISHED`); es
el `@default` del schema y conviene que tenga significado escrito.

### Motivo y texto libre (HD14)

Tres columnas nuevas en `Store`, todas nullables:

| Columna              | Tipo        | Para qué                                                                                        |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `disabledReasonCode` | `String?`   | Clave de la lista fija. `null` = cerrada sin motivo declarado (p. ej. el POS retiró su opt-in). |
| `disabledMessage`    | `String?`   | Texto corto opcional del negocio, ≤ `STORE_DISABLED_MESSAGE_MAX_LENGTH`.                        |
| `disabledAt`         | `DateTime?` | Cuándo se cerró. Para la pantalla del panel y para poder auditar.                               |

**La lista fija va a `src/constants/storeClosure.ts`, no a un enum de Prisma**, y
es una decisión con dos motivos concretos: (1) la lista es vocabulario de
producto y va a cambiar con el copy, y un enum de Prisma exige migración cada
vez; (2) HD15 abre la puerta a que el POS mande un motivo, y un valor
desconocido llegando a un enum de base **rompe la escritura del sync**, que es lo
último que queremos. Con `String?` + validación Zod contra las claves conocidas,
un motivo que no reconocemos se guarda como texto en `disabledMessage` y
`disabledReasonCode` queda `null`.

```ts
// src/constants/storeStatus.ts
export const STORE_DISABLED_REASONS = {
  TEMPORARILY_CLOSED: "Cerrado temporalmente",
  VACATION: "De vacaciones",
  RESTOCKING: "Reponiendo inventario",
  RENOVATION: "En reforma",
  PLATFORM_ROLLOUT: "Pendiente de habilitar", // el que deja la migración (HD12)
  OTHER: "Otro motivo",
} as const;
export type StoreDisabledReason = keyof typeof STORE_DISABLED_REASONS;
export const STORE_DISABLED_MESSAGE_MAX_LENGTH = 160;
```

Las **claves** son el contrato (las usan el panel, la página y la migración); las
etiquetas en español son copy y las afina `design.md`. Un solo mapa para los dos
consumidores: el formulario del panel y el aviso público.

**El texto se pinta como texto, nunca como HTML** (HD14). React escapa por
omisión, así que la regla operativa es: **ninguna llamada a
`dangerouslySetInnerHTML` con esto**, y el aviso no acepta Markdown. Merece
decirse porque el layout de la tienda **ya usa** `dangerouslySetInnerHTML` para el
`<style>` del tema (`src/app/[slug]/layout.tsx:28`), así que el patrón está a la
vista y a una copia-pega de distancia.

### La migración

Aditiva, y con el `UPDATE` retroactivo de HD12 explícito. **Ningún comando
prohibido**: se genera con `npm run db:migrate` y se aplica con
`prisma migrate deploy`.

```sql
-- prisma/migrations/<ts>_store_public_switch/migration.sql

-- 1. Columnas del interruptor. Nullables, sin DEFAULT: Postgres ≥ 11 no reescribe la tabla.
ALTER TABLE "Store" ADD COLUMN "disabledReasonCode" TEXT,
                    ADD COLUMN "disabledMessage"    TEXT,
                    ADD COLUMN "disabledAt"         TIMESTAMP(3);

-- 2. HD12 — retroactivo a todas las que hoy se leen en público.
--    Solo las PUBLISHED: una tienda ya SUSPENDED conserva su motivo (null).
UPDATE "Store"
   SET "status"             = 'SUSPENDED',
       "disabledReasonCode" = 'PLATFORM_ROLLOUT',
       "disabledAt"         = now()
 WHERE "status" = 'PUBLISHED';

-- 3. SOLO si el humano acepta AP6 (guarda anti-rancio).
ALTER TABLE "Store" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);

-- 4. SOLO si el humano acepta AP5 opción (b) (transición del opt-in del POS).
ALTER TABLE "Store" ADD COLUMN "sourceOptIn" BOOLEAN;
```

Los bloques 3 y 4 están separados a propósito: el plan se puede escribir y
firmar con los bloques 1 y 2, y AP5/AP6 solo añaden columnas y ramas de handler,
nunca reescriben lo anterior.

Sin índices nuevos: `@@index([status])` ya existe y es el que usan
`getPublishedStoreSlugs` y el sitemap. **Trampa fichada**: revisar el
`migration.sql` generado y borrar cualquier `DROP INDEX` de
`CanonicalProduct_searchVector_idx` o `CanonicalProduct_name_trgm_idx`, que
Prisma no declara (ficha `prisma-migrate-dev-borra-indices-gin-no-declarados`).

**Consecuencia operativa de HD12, dicha en voz alta**: aplicar esta migración en
un entorno con tiendas vivas **apaga todas las vitrinas a la vez**, y cada
negocio tiene que volver a abrir la suya (o esperar un evento del POS, según
AP5). No es un efecto colateral: es lo que HD12 pide. Mitigación disponible si el
humano la quiere, en una línea de SQL aparte: una lista blanca de slugs que se
quedan abiertos. Hoy no hay producción, así que el coste real es el del entorno de
desarrollo, y ahí lo arregla `npm run seed`.

### El guarda anti-rancio — y qué no arregla

Hallazgo que cambia el análisis: **el payload de `STORE` ya trae `updatedAt`**
(`src/features/sync/schemas.ts:42`), y el docstring del módulo dice literalmente que
«`updatedAt` en cada payload es el guarda anti-escritura-rancia». `handleStore`
simplemente **no lo usa**, porque no hay columna contra la que comparar. Es decir:
el guarda es implementable **sin tocar el contrato**, con el mismo mecanismo que
ya usa `handleProduct:42-48` y con el estado `stale` que ya existe en
`EVENT_STATUS`.

Con eso, «gana el último» de HD13 puede significar dos cosas distintas:

| Semántica                                                 | Qué pasa con un evento reencolado del POS que es viejo               |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| **(i) Gana el último que llega** — lo de hoy              | Resucita la tienda que el admin acababa de cerrar.                   |
| **(ii) Gana el último de verdad** — con `sourceUpdatedAt` | Se descarta como `stale`. Un evento **nuevo** del POS sigue ganando. |

**(ii) no cambia quién gana entre el panel y el POS**: un evento nuevo del POS
sigue pisando al panel, que es lo que HD13 dice. Solo impide que un evento que
**no** es el último se haga pasar por el último. Por eso lo propongo como la
lectura correcta de HD13 y lo dejo documentado (**AP6**, veto de una palabra).

**Y ahora lo que el guarda NO arregla, que es más grave y no estaba en la mesa.**
`handleStore:78-85` pone `status: "PUBLISHED"` en **todo** evento `STORE` con
`publishToStore: true`. No solo en los que hablan de publicación: también en el
que llega porque alguien cambió el teléfono, la dirección o el nombre en el POS.
Con un solo estado compartido y sin más matices, la secuencia realista es:

```
El negocio cierra la tienda desde el panel   → SUSPENDED, motivo «De vacaciones»
Alguien corrige el teléfono en el POS        → evento STORE, publishToStore: true
                                             → PUBLISHED. La tienda reabre sola.
```

Eso **no** es un evento reencolado: es el camino normal, y un `sourceUpdatedAt`
no lo evita, porque ese evento es legítimamente el más nuevo. Es una consecuencia
de HD13 que no puedo resolver sin decidir por el humano, así que **no la decido**:
va como **AP5**, con la opción que a mi juicio cumple HD13 sin este efecto (que
el POS escriba el estado solo cuando **su** opt-in cambia) y con lo que cuesta
cada camino.

### El handler del sync, ahora sí modificado

`src/features/sync/server/handlers/store.ts`. Lo que **se conserva intacto**,
porque F-005 y F-006 lo verificaron:

- El `upsert` del `Business` y la generación de slug único al crear.
- La rama `operation === "DELETE" || !payload.publishToStore` sin fila existente
  → `SKIPPED` (`skipped_not_published`). **Ese estado sigue existiendo y con el
  mismo significado**, y sigue viajando en `ok` para que el POS marque su outbox.
- `touchedStoreSlug` en toda rama que cambia algo, que es lo que alimenta
  `revalidateStores(touchedStores)` en `processBatch.ts:57`.
- El ciclo de disponibilidad de F-006 no se toca: `applyAvailability`
  (`sync/server/availability.ts:27-30`) busca la tienda **sin filtrar por
  `status`**, así que una tienda cerrada sigue aceptando disponibilidad y
  confirmando al POS. Es lo correcto: el stock sigue llegando mientras la vitrina
  está cerrada, y al reabrir no hay que resincronizar nada. **Verificado leyendo:
  no hace falta ningún cambio ahí.**

Lo que **cambia**:

1. **Escribe `sourceUpdatedAt: payload.updatedAt`** y devuelve `STALE` cuando
   `existing.sourceUpdatedAt >= payload.updatedAt`, copiando la comparación de
   `handleProduct:46` (incluido el `>=`, que hace idempotente el reenvío exacto).
   Solo con AP6 aceptada.
2. **Al republicar, limpia el motivo**: `disabledReasonCode`, `disabledMessage` y
   `disabledAt` a `null` cuando el estado pasa a `PUBLISHED`. Sin esto, una tienda
   reabierta conserva «De vacaciones» en la base y la primera pantalla que lo lea
   miente.
3. **Al suspender, guarda el motivo si viene** (HD15/v3):
   `disabledMessage: payload.unpublishReason ?? null`, `disabledReasonCode: null`
   (el POS no habla nuestro vocabulario de motivos), `disabledAt: new Date()`.
4. **`publishedAt` se queda como está**: lo pone el sync la primera vez y en cada
   republicación, y el panel no lo toca nunca. Reabrir desde el panel **no** lo
   modifica: `publishedAt` es «cuándo el negocio se dio de alta en la vitrina», no
   «cuándo abrió hoy». Para eso está `disabledAt`.
5. Con AP5(b): escribe `status`/`publishedAt`/`disabled*` **solo** cuando
   `payload.publishToStore !== existing.sourceOptIn`, y actualiza `sourceOptIn`
   siempre. Con AP5(a): los escribe en todo evento, como hoy.

El bloque `common` (nombre, dirección, teléfono…) no cambia en absoluto: sigue
siendo del sync, y HD5 dejó el panel fuera de esas columnas.

### La lectura pública

Hoy `status: "PUBLISHED"` aparece en cuatro sitios de lectura:
`queries.ts:45` (`loadStore`), `queries.ts:84` (`loadCatalog`),
`queries.ts:168` (`getPublishedStoreSlugs`) y `quote.ts:68` (`loadStoreForOrder`).
El cambio es quirúrgico y **solo uno de los cuatro pierde el filtro**:

| Sitio                    | Cambio                                                                                      | Por qué                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadStore`              | **Quita** el filtro; `StoreSummary` gana `status`, `disabledReasonCode`, `disabledMessage`. | Es el único que necesita distinguir «no existe» de «existe y está cerrada» (HD11). Tres campos, ninguna interfaz nueva.                                                                                               |
| `loadCatalog`            | **Conserva** el filtro.                                                                     | Cinturón y tirantes: aunque una página olvide comprobar, una tienda cerrada devuelve catálogo vacío. Y regala el 404 de `/[slug]/p/[productSlug]`, que busca el producto dentro de `getStoreCatalog` (`page.tsx:36`). |
| `getPublishedStoreSlugs` | **Conserva** el filtro.                                                                     | Solo se prerenderiza y se anuncia en el sitemap lo que está abierto.                                                                                                                                                  |
| `loadStoreForOrder`      | **Quita** el filtro; `OrderStore` gana `status`.                                            | El checkout tiene que responder «cerrada», no «no existe». Ver § El checkout.                                                                                                                                         |

- **`requireStore(slug)`** pasa a hacer `notFound()` cuando la fila no existe **o
  `status === "DRAFT"`**, y devuelve la tienda cuando está `SUSPENDED`.
- **El aviso de cierre lo pinta la página, no el layout.** `src/app/[slug]/layout.tsx`
  sigue renderizando la marca (nombre, tema, pie) y solo esconde el `CartBadge`
  cuando está cerrada. Si el aviso viviera en el layout sustituyendo a
  `{children}`, se llevaría por delante `/[slug]/pedido/[code]`, que HD11 exige
  que siga accesible. `src/app/[slug]/page.tsx` es quien bifurca: `PUBLISHED` →
  catálogo; `SUSPENDED` → `<StoreClosedNotice>` y **ni una llamada a
  `getStoreCatalog`** (una query menos y ninguna posibilidad de filtrar catálogo).
- **`/[slug]/pedido/[code]` no necesita ni una línea**: `getOrderByCode`
  (`read.ts:55-56`) filtra por `code` y `store.slug`, **nunca** por `status`.
  Verificado leyendo. HD11 se cumple gratis.
- **`/[slug]/carrito` y `/[slug]/checkout`**: `redirect(`/${slug}`)` cuando está
  cerrada, que es donde está la explicación. No se vacía el carrito.

**Componente nuevo**: `src/components/store/StoreClosedNotice.tsx`, server
component (`components/store/` es «componentes de la tienda pública»), recibe
`{ storeName, reasonCode, message }` y compone con `Alert` y `Container`. Cero
JavaScript de cliente.

**ISR, sitemap, robots y `generateStaticParams`:**

- **El mecanismo de caché no cambia.** La página cerrada es una página ISR más,
  tagueada con `storeTag(slug)`; el interruptor del panel llama a
  `revalidateStores([slug])` dentro del `commit()`, así que **cerrar y abrir se
  ven en el acto** sin esperar el piso de ISR. `export const revalidate = 3600`
  sigue siendo un **literal** (AGENTS.md) y **el `matcher` de `src/proxy.ts` no se
  toca**: hacer match sobre `/[slug]` para decidir si está cerrada anularía toda
  la estrategia ISR, y es el error más fácil de cometer en este repo.
- **`generateStaticParams`**: sigue prerenderizando solo `PUBLISHED`. Una tienda
  cerrada no se prerenderiza; se renderiza en la primera petición y se cachea.
- **`sitemap.ts`**: sin cambios de código —usa `getPublishedStoreSlugs`— y el
  efecto es el correcto: una tienda cerrada desaparece del sitemap y vuelve al
  reabrir.
- **`robots.ts`**: sin cambios (`/api/`, `/admin`). La página cerrada añade
  `robots: { index: false }` en su propio `generateMetadata`: indexar una página
  sin contenido con el nombre del negocio es peor que no indexarla.
  **Contrapartida aceptada y escrita**: una tienda cerrada muchas semanas pierde
  posicionamiento, y lo recupera al reabrir cuando el buscador vuelva a pasar.

### El checkout y el pedido

Con el filtro fuera de `loadStoreForOrder`, hay que rechazar explícitamente o una
tienda cerrada vendería.

- `quoteCart` recibe la tienda con su `status`. Si no está `PUBLISHED`,
  `quoteBySlug` devuelve un resultado nuevo y la ruta responde
  **409 `{"error":"STORE_CLOSED","reasonCode":…,"message":…}`**.
- `createOrder` gana `{ kind: "store_closed" }`, comprobado **antes** de cotizar
  y antes del guarda de abuso, y la ruta responde **409
  `{"error":"STORE_CLOSED"}`**.

**Por qué 409 y no 404 ni 503**: la tienda existe (404 mentiría, y además la
página sí responde 200), no es un fallo del servidor (503 mentiría), y F-010 ya
usa 409 para «tu carrito ya no se puede cumplir» (`ITEMS_UNAVAILABLE`,
`PRICE_CHANGED`), así que la isla del carrito **ya tiene la forma de esa rama** y
solo hay que añadirle el caso. El docstring de `quote/route.ts:10-12` dice hoy
«Always 200 while the store exists»: esa frase deja de ser verdad y hay que
corregirla en el mismo cambio, o es una mentira que alguien creerá.

**El carrito que ya estaba en `localStorage` se conserva.** Está namespaceado por
tienda (`features/cart/cartStorage.ts`) y un cierre es temporal: vaciarlo sería
destruir datos del comprador por una condición reversible. La página del carrito
redirige a la vitrina, que explica el cierre; si el comprador llega directo al
checkout, el 409 le da el mensaje y la isla deshabilita el envío. El copy lo pone
`design.md`.

### El endpoint del panel

```
PUT /api/admin/stores/{storeId}/status        (alias PATCH)
  body { enabled: true }
       | { enabled: false, reasonCode: <clave de STORE_DISABLED_REASONS>, message?: string }
  200  { storeId, slug, status, disabledReasonCode, disabledMessage, disabledAt }
```

- Mismo guard (401/403 sin tocar la base) y **mismo embudo**: `setStoreEnabled()`
  en `features/admin/server/mutations.ts`, dentro de `commit()`, así que la
  revalidación de la tienda es automática e inmediata (HD10 exige que cerrar y
  abrir se vean en el acto).
- **Un round-trip**: `update where {id} data {...} select {slug}`. `P2025` → 404
  `NOT_FOUND` (tienda borrada entre dos inicios de sesión).
- `enabled: false` **exige** `reasonCode` (Zod: unión discriminada por `enabled`,
  así que «cerrar sin motivo» es un 400 y no un descuido). `message` se recorta,
  se valida por longitud y el vacío se guarda como `null` (R13).
- `enabled: true` pone `status: "PUBLISHED"` y **limpia las tres columnas** de
  motivo, exactamente como el handler del sync (§ handler, punto 2).
- **La lista blanca de columnas del panel crece**, y esto es un cambio real
  respecto del ciclo anterior:

  ```ts
  type PanelStoreColumn = "status" | "disabledReasonCode" | "disabledMessage" | "disabledAt";
  ```

  `publishedAt`, `slug`, `name` y el resto siguen fuera. **Y hay que invertir una
  aserción de `boundaries.test.ts`**: la que decía «`status` no aparece en el
  módulo de escritura del panel» pasa a decir «`status` aparece **solo** en
  `setStoreEnabled`, y `publishedAt` no aparece nunca». Si nadie lo escribe, el
  siguiente agente «arreglará» el código para satisfacer un test obsoleto.

- **El criterio 7 `[nuevo]` de la spec queda contradicho por HD10** (proponía
  grepear `status` y `publishedAt` en el módulo de escritura del panel y no
  encontrar ninguno). No es de los cinco `[ya]`, así que lo puede retirar el
  orquestador al destilar el plan; queda dicho aquí para que no se cuele.

### El contrato (HD15) — v3 aditiva, propuesta

Confirmado leyendo: **no hace falta endpoint nuevo**. `publishToStore: false` en
el evento `STORE` ya deja la tienda en `SUSPENDED`
(`handlers/store.ts:35-42`), y el payload ya trae `updatedAt`
(`src/features/sync/schemas.ts:42`), así que el guarda anti-rancio tampoco pide contrato.

Lo único que aporta la v3 es **un campo opcional de motivo**. Diff exacto
propuesto para `docs/sync-contract.md` (**no lo edito yo**: hay otro equipo al
otro lado y eso lo comunica el humano):

```diff
 ## Payload de `STORE`
 | Campo            | Tipo    | Notas                                        |
 | ---------------- | ------- | -------------------------------------------- |
 | `publishToStore` | boolean | El opt-in del negocio para esta tienda.      |
+| `unpublishReason`| string? | **v3, opcional.** Motivo visible al comprador |
+|                  |         | cuando `publishToStore` es `false`. Texto     |
+|                  |         | plano, ≤ 160 caracteres, se pinta como texto. |
+|                  |         | Se ignora cuando `publishToStore` es `true`.  |
 | `updatedAt`      | string  | ISO 8601 con desplazamiento. Guarda anti-rancio. |
```

Más un párrafo de v3 con **dos avisos de comportamiento** que no cambian el
cable pero sí lo que el POS observa:

1. **El panel puede cerrar y abrir la tienda por su cuenta** (HD10). Un
   `GET` del POS puede ver una tienda cerrada que él nunca cerró.
2. **Un evento `STORE` con `publishToStore: true` puede reabrir una tienda que el
   negocio cerró desde el panel** (HD13, y es el objeto de AP5). Si el POS manda
   eventos `STORE` por cualquier edición de la tienda, conviene que su equipo lo
   sepa.

**Qué tiene que hacer el otro equipo: nada.** El campo es opcional; omitirlo deja
el comportamiento de hoy. Lo que sí conviene: **la v2 nunca se le avisó**
(nota de F-010 en `.agent/features.json`), así que el anuncio de la v3 debería
llevar también los cambios de la v2 —`originalUnitPrice`, `originalCurrencyCode`,
`originalLineTotal`— o el POS se encontrará con dos versiones de golpe.

### Qué se rompe de lo ya verificado, y con qué paso se arregla

HD12 apaga todas las tiendas existentes. Feature por feature:

| Feature                        | Qué asume                                                                                    | Qué le pasa con HD12                                                                                                                                                                                                                                        | Paso que lo arregla                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **seed**                       | `seedStore` escribe `status: "PUBLISHED"` en `create` **y** en `update` (`seed.ts:337,343`). | **Nada, y es deliberado**: `npm run seed` vuelve a publicar las dos tiendas después de la migración.                                                                                                                                                        | Un comentario en `seed.ts` que diga que contradice el `UPDATE` de HD12 **a propósito**, porque es un fixture. Sin comentario, alguien lo «arregla». |
| **F-004** (vitrina)            | `/tienda-demo` responde 200 con catálogo.                                                    | Pasa si se corre `seed` tras `db:migrate`. Falla si solo se migra.                                                                                                                                                                                          | Documentar el orden `db:migrate && seed` en el plan; ya es el orden de `AGENTS.md § Comandos`.                                                      |
| **F-005** (sync catálogo)      | `skipped_not_published`, y que un `STORE` con `publishToStore: true` publica.                | Sigue pasando. Con AP5(b) el segundo evento ya no republica si el opt-in no cambió → **hay que revisar si algún test lo asume**.                                                                                                                            | Test nuevo de `handleStore` que fije la semántica elegida en AP5, y revisión de `inbox.test.ts` (hoy no toca `status`).                             |
| **F-006** (disponibilidad)     | El ciclo convergente confirma al POS.                                                        | **Nada**: `applyAvailability` no filtra por `status` (verificado leyendo).                                                                                                                                                                                  | Ninguno. Se anota como comprobado para que nadie lo «arregle».                                                                                      |
| **F-007** (pull de pedidos)    | `smoke.sh:37` exige que `/tienda-demo` responda 2xx.                                         | Pasa con el seed. La página de pedido nunca dependió de `status`.                                                                                                                                                                                           | Ninguno.                                                                                                                                            |
| **F-010** (carrito y checkout) | `smoke.sh` usa `tienda-demo` (WHATSAPP) y `tienda-dos` (ONSITE + envío, criterio 12).        | Pasa con el seed. **Las dos tiendas tienen que seguir `PUBLISHED`**.                                                                                                                                                                                        | **No suspender ninguna de las dos en el seed.** El fixture de tienda cerrada es una tercera (abajo).                                                |
| **`check:bundle`**             | Mide el HTML prerenderizado más pesado.                                                      | Si ninguna tienda queda `PUBLISHED` al construir, `generateStaticParams` devuelve `[]`, no se prerenderiza ninguna vitrina y el presupuesto **mide `index.html`**: pasa en verde midiendo otra cosa. **Pérdida silenciosa de cobertura**, no un fallo rojo. | El seed mantiene `tienda-demo` publicada. Además, el plan añade al smoke una comprobación de que la página medida es una de tienda.                 |
| **`check:theme`**              | Lee el CSS compilado (`scripts/check-theme-tokens.mjs:26`), no HTML de tienda.               | **Nada** (verificado leyendo).                                                                                                                                                                                                                              | Ninguno.                                                                                                                                            |
| **`mint-sso-token.mjs`**       | Firma `seed-tienda-1` y `seed-tienda-2`.                                                     | Nada.                                                                                                                                                                                                                                                       | La bandera `--stores=` de I7 sigue siendo lo único que necesita.                                                                                    |

**Fixture nuevo recomendado**: una tercera tienda en el seed,
`seed-tienda-3` / `tienda-cerrada`, en `SUSPENDED` con
`disabledReasonCode: "VACATION"` y un `disabledMessage` corto. Motivo: HD11 tiene
que poder verificarse **justo después de `npm run seed`**, sin llamar a ningún
endpoint, y sin tocar las dos tiendas de las que dependen F-004, F-007 y F-010.
No entra en el token del SSO, así que además sirve de fixture de tienda ajena
para el 403 sin depender de la bandera. Cerrar y reabrir por el panel se prueba
sobre `tienda-demo`, que sí está en la sesión.

## Escalabilidad y límites

Números, no adjetivos. «100×» sobre el estado de hoy: 2 tiendas, 20 productos,
0 promociones.

| Camino                       | Round-trips            | Crece con              | Qué se rompe primero, y cuándo                                                                                                              |
| ---------------------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin` listado             | 1 (0 si sin tiendas)   | tiendas de la sesión   | No pagina; a ~200 filas la página pesa. Pero el techo real llega antes: ver la cookie, abajo.                                               |
| `/admin/.../productos`       | 2 (`findMany`+`count`) | catálogo               | Pagina de 50. El `orderBy: localName` no tiene índice: a ~50.000 productos por tienda el sort en Postgres empieza a notarse.                |
| Guardado de producto         | **2**                  | —                      | Lectura acotada (403 + moneda + slug) y `UPDATE`. Sin `$transaction`.                                                                       |
| Subida de imagen             | 2 + 1 a Storage        | —                      | El archivo se bufferiza en memoria: ver **AP3**. `imageUrls` con `push` no lee-modifica-escribe.                                            |
| Promoción (alta/edición)     | 2–3                    | ids en `conditions`    | El `count` de validación es un `IN` indexado; con 5.000 ids en `conditions` el cuerpo choca antes con el tope de 16 KB, que es lo correcto. |
| Interruptor de tienda (HD10) | **1**                  | —                      | `update … RETURNING slug` + revalidación. Cerrar y abrir se ven en el acto.                                                                 |
| Vitrina cerrada (HD11)       | **1** (era 3)          | —                      | No llama a `getStoreCatalog` ni a `getStoreRates`: dos queries menos y ninguna posibilidad de filtrar catálogo.                             |
| Revalidación por escritura   | 2 `revalidateTag`      | —                      | En Vercel, ~10–30 ms cada una. Solo afecta al slug propio (criterio 12 `[nuevo]`).                                                          |
| Regeneración de `/[slug]`    | **4** (era 3)          | catálogo y promociones | La promoción añade **una** query, no un N+1. `loadCatalog` sin paginar es lo que se rompe primero, y es deuda de F-004.                     |
| Cotización del carrito       | **3** (era 2)          | líneas del carrito     | Igual: una query más, fresca. `quoteCart` ya indexa por id con un `Map`.                                                                    |

**El techo duro y poco obvio: la cookie de sesión.** `storeIds` son uuid de 36
caracteres dentro del JWT de `qab-admin-session`: ~38 bytes por tienda en JSON y
~52 tras el base64url. Con el resto de claims y la firma, el límite de ~4 KB por
cookie se alcanza alrededor de **60–65 tiendas en una sesión**, y el navegador
descarta la cookie **en silencio**: el admin no entra y no hay mensaje. Es un
límite de F-008, pero el listado del panel es donde se va a ver. El arreglo
—guardar `storeIds` en base y llevar solo el `adminUserId` en la cookie— es otro
feature.

**Panel contra sync, concurrentes.** Los conjuntos de columnas son disjuntos (R8)
y el `UPDATE` del panel enumera solo las suyas por tipo, así que el orden de
llegada no importa y no hace falta bloqueo. Lo que rompería datos es un `data`
con una columna del sync leída antes: el tipo `PanelProductWrite` lo impide en
compilación y `boundaries.test.ts` por si alguien lo esquiva. Dos pestañas del
panel: gana la última, campo a campo, sin fingir bloqueo optimista.

**Promociones, coste real.** `indexPromotions` es O(filas) una vez por lectura;
`selectPromotion` es O(candidatas) por línea, y las candidatas de un producto son
típicamente 0–2. El umbral práctico está en **~200 promociones vigentes por
tienda**: por encima, la carga cacheada del catálogo crece (cada producto lleva
sus candidatas) y conviene mover la selección a la lectura, pasándole las tasas.
Coste en la carga cacheada: 500 productos × 2 candidatas × ~120 bytes ≈ **120 KB**
extra por entrada de caché.

**JavaScript de cliente.** Medido en este ciclo: la página más pesada del
storefront está en **182.1 KB gzip** de 193 KB de presupuesto, y
`check-bundle-budget.mjs` solo recorre `*.html` de `.next/server/app` —tras
`npm run build` hay 25 y **ninguno bajo `admin/`**, porque `/admin` es
`force-dynamic`. Conclusión: **las islas del panel suman 0 KB al presupuesto** y
el criterio 15 se cumple sin tocar `BUNDLE_BUDGET_KB`. Las dos únicas formas de
empeorarlo, y las dos están prohibidas aquí:

1. Poner `"use client"` en algo que la vitrina renderice. `Field`, `Button`,
   `Alert`, `Card`, `Container` y `ProductCard` son server components **y tienen
   que seguir siéndolo**. La interactividad del panel vive en componentes propios
   de `features/admin/components/`.
2. Meter `src/lib/promotions.ts` en el árbol de cliente. Es puro y tentador, pero
   `CheckoutForm` **no** debe calcular descuentos: recibe `discountTotal` del
   servidor. Lo único que la isla suma es `subtract` de `lib/money.ts`, que ya
   viaja.

F-013 quiere bajar el número: el panel no puede dejar ni un kilobyte en la
vitrina.

## Patrones a seguir / antipatrones a evitar

**A seguir**

- La decisión vive en `features/*/server/`; `src/app/` solo mapea a HTTP, como
  `app/api/orders/route.ts::toResponse`. AGENTS.md § Arquitectura.
- Prisma **solo** en `features/*/server/`. La regla de ESLint cubre
  `src/app/**/*.tsx`, no `route.ts`: de ahí `boundaries.test.ts`.
- Constantes en `src/constants/` (AGENTS.md prohíbe números y cadenas mágicas):
  mimes, bytes, máximo de imágenes, tamaño de página, longitudes.
- `export const dynamic = "force-dynamic"` **literal** en cada página nueva del
  panel. Mismo motivo que el `revalidate` literal de AGENTS.md.
- Errores de validación con `serializableIssues()` y forma
  `{error, issues:[{path,message}]}`, con una sola implementación en
  `src/lib/httpJson.ts`.
- Zod contra el tipo de cable con `satisfies z.ZodType<...>`.
- Toda la aritmética de dinero en `src/lib/money.ts`, en BigInt. Ningún
  `Number(precio)` en el camino de un importe.
- Tests de servidor en `*.test.ts` (proyecto node); `*.test.tsx` solo islas
  (jsdom). AGENTS.md: `jose` falla el `instanceof` en jsdom.

**A evitar**

- **Tocar el `matcher` de `src/proxy.ts`.** No hay que añadir `/api/admin`: si el
  proxy lo interceptara, la escritura sin cookie devolvería un **302** en vez del
  **401** de E5 y el criterio se caería en silencio. Y `/[slug]` no se toca jamás
  (AGENTS.md, ADR 0006, ficha `proxy-matcher-anula-isr`).
- `revalidateProducts` en el panel (I3): tag muerto.
- Aplicar el descuento **después** de convertir: rompe la fórmula publicada del
  contrato (§ Promociones).
- Escribir el precio de lista en `OrderItem.originalUnitPrice`: esa columna
  significa otra cosa y el POS la lee.
- Calcular el total en el cliente sin `discountTotal`: 409 en todos los checkouts.
- `$transaction` para dos escrituras del panel: innecesario y peligroso con el
  pooler en modo transacción.
- `$executeRaw` para copiar `syncedPriceCurrency`: se salta la lista blanca.
- Aceptar `priceOverrideCurrency` del cliente: R14 dice que lo pone el servidor.
- Borrar el objeto del bucket al quitar una URL (R22): deja roto lo ya servido.
- Server actions: no hay ninguna en el repo y R5 exige código HTTP verificable.
- Zod en el árbol de cliente: la isla pinta los `issues` que devuelve el servidor.
- **`dangerouslySetInnerHTML` con el mensaje de cierre** (HD14). El patrón está a
  la vista en `src/app/[slug]/layout.tsx:28`, que lo usa legítimamente para el
  `<style>` del tema. El mensaje del negocio se pinta como texto y nada más.
- Pintar el aviso de cierre **en el layout** en lugar de en la página: se llevaría
  por delante `/[slug]/pedido/[code]`, que HD11 exige que siga accesible.
- Filtrar por `status` en `features/orders/server/read.ts`: la página de un pedido
  ya hecho no depende de que la tienda esté abierta.
- Quitar el filtro `status: "PUBLISHED"` de `loadCatalog`: es lo que garantiza que
  una tienda cerrada no sirva catálogo aunque una página olvide comprobar.
- Vaciar el carrito de `localStorage` porque la tienda cerró: el cierre es
  reversible y el carrito es del comprador.

## Riesgos y plan B

| Riesgo                                                               | Plan B                                                                                                                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/storage-api` single-tenant pide más bootstrap del previsto | PostgREST como quinto servicio (previsto). Si hace falta un sexto, o dos arranques fallan: CLI de Supabase. Criterio escrito en § Emulador.                                   |
| `next/image` sigue dando 400 con el emulador                         | Los tres sospechosos, en orden: falta `port` en el patrón, `pathname` distinto porque el gateway no traduce, o `NEXT_PUBLIC_SUPABASE_URL` ausente en `next build`.            |
| Promociones rompen el checkout de F-010 (409 en todos los pedidos)   | Es el hallazgo 2, ya diseñado: `discountTotal` en el cable y en la isla. **La verificación de F-010 se vuelve a correr al cerrar la tanda**, no se asume.                     |
| Cambiar `resolvePrice` altera precios sin promociones                | Test que fija: sin candidatas, `resolvePrice` devuelve exactamente lo que `displayPrice` devolvía. Los tests de `pricing`/`quote` existentes son la red.                      |
| Dos subidas simultáneas dejan 9 imágenes                             | Aceptado y escrito. La alternativa es un lock que el pooler no quiere.                                                                                                        |
| Objeto huérfano en el bucket cuando la escritura falla               | Aceptado por R22 y por el orden de los pasos. La recolección es otro feature.                                                                                                 |
| F-011 no puede cerrar por el criterio 5 (HD6)                        | **AP4**. Cuatro de los cinco criterios sí se cierran en esta tanda.                                                                                                           |
| HD12 apaga todas las vitrinas al migrar                              | Es lo que HD12 pide. En desarrollo lo devuelve `npm run seed`; para un entorno con tiendas vivas, una lista blanca de slugs en un `UPDATE` aparte, escrita en § La migración. |
| Un evento rutinario del POS reabre una tienda cerrada por el negocio | **AP5**. Con (a) es el comportamiento; con (b) desaparece por una columna y una rama.                                                                                         |
| Un evento reencolado del outbox resucita una tienda cerrada          | **AP6**. El campo ya viaja en el payload, así que el guarda no cuesta contrato.                                                                                               |
| El presupuesto de bundle mide `index.html` en vez de una vitrina     | Consecuencia silenciosa de HD12: el seed mantiene `tienda-demo` publicada y el smoke comprueba **qué** página se midió. Ver § Qué se rompe.                                   |
| Alguien «arregla» el seed para que respete HD12                      | Un comentario en `seed.ts` que diga que la contradicción es deliberada, más el test de `handleStore` que fija la semántica de AP5.                                            |
| El tope de imagen choca con el límite de cuerpo de la plataforma     | **AP3**, con recomendación cerrada abajo.                                                                                                                                     |

## ¿Hace falta una ADR?

**Sí, y se reescribió por segunda vez.**
`docs/adr/0017-frontera-de-escritura-del-panel.md`. HD10 obliga: su mitad (a)
decía que `status` es del sync y **eso ya no es verdad**. Tres partes:

(a) **La frontera de escritura del panel.** Qué columnas posee el panel en
`StoreProduct`, que la frontera se hace cumplir con una lista blanca en el tipo y
no con disciplina, y que `priceOverrideCurrency` se escribe siempre explícito.
Incluye por qué el editor de branding y contacto espera a `Storefront` (HD6) y
qué se detuvo con HD5.

(b) **El descuento vive dentro de `unitPrice`, y `originalUnitPrice` conserva su
significado publicado.** El POS no ve el desglose, el contrato no cambia de
versión, y la fórmula `unitPrice = convert(originalUnitPrice, …)` sigue dando el
mismo céntimo. Con ella queda escrita la convención de moneda de
`Promotion.value` (R27/I4).

(c) **`Store.status` es un estado compartido, no del sync** (HD10, HD13). Quién
puede escribirlo, qué significa «gana el último», qué columnas acompañan al
cierre, y las dos consecuencias abiertas (AP5, AP6) anotadas **como abiertas**,
para que quien lea la ADR sepa que esa parte tiene una decisión pendiente y no la
invente.

No supera ninguna otra ADR: extiende 0007, respeta 0012 (por eso HD6), no toca
0005, 0006 ni 0016. Es el único archivo fuera de `.agent/` que toco.

## Preguntas al humano

**AP3 y AP4 quedan contestadas** (4 MB; `passes: false` con 4 de 5) y están
recogidas como decisiones en § Qué cambió en este ciclo. Las dos que siguen nacen
de HD13 y son las únicas que bloquean la firma.

**AP5 — Con un solo estado compartido, ¿un evento `STORE` rutinario del POS
reabre una tienda que el negocio cerró?** (Es la consecuencia de HD13 que decidí
**no** decidir.)

`handleStore:78-85` pone `status: "PUBLISHED"` en **todo** evento con
`publishToStore: true`, incluidos los que llegan porque alguien cambió el
teléfono o la dirección en el POS. Con HD13 tal cual, la secuencia realista es:
el negocio cierra por vacaciones desde el panel, alguien corrige el teléfono en
el POS, y la tienda **reabre sola**. No es un evento reencolado —es el camino
normal— y por eso un guarda anti-rancio no lo evita.

- (a) **Sí, HD13 literal**: cualquier evento con `publishToStore: true` reabre.
  Cuesta cero código (es lo de hoy) y hace que el interruptor del panel sea poco
  fiable en la práctica: el negocio no puede saber cuándo su cierre se deshará.
- (b) **El POS solo escribe el estado cuando su propio opt-in cambia** —
  recomendada. Se guarda el último `publishToStore` visto (`Store.sourceOptIn
Boolean?`, columna aditiva) y el handler toca `status` solo en la transición.
  Sigue habiendo **un solo estado y gana el último**: lo que cambia es que «el POS
  escribió el estado» pasa a significar «el POS dijo algo sobre publicación», no
  «el POS mandó cualquier evento». Coste: una columna y una rama.
- (c) Dos estados (uno del panel y otro del sync, y la vitrina abre solo si los
  dos dicen sí). Es lo que HD13 descartó; lo listo para que se vea que la opción
  intermedia (b) no es lo mismo.

**Recomendación: (b).** Con (a), lo primero que va a pasar en producción es que un
negocio cerrado reaparezca abierto sin que nadie lo tocara, y se va a reportar
como bug.

**AP6 — ¿Se añade `Store.sourceUpdatedAt` como guarda anti-rancio?** (Propuesta y
documentada, no aplicada: veto de una palabra.)

El payload de `STORE` **ya trae `updatedAt`** (`src/features/sync/schemas.ts:42`) y el propio
docstring del módulo dice que es el guarda anti-escritura-rancia; `handleStore`
no lo usa porque no hay columna contra la que comparar. **No hace falta tocar el
contrato.**

- (a) **Sí** — recomendada. Una columna aditiva, la misma comparación que
  `handleProduct:46`, y el estado `stale` ya existe en `EVENT_STATUS` y ya viaja
  en `ok`. Con ella, «gana el último» significa el último **de verdad** y un
  evento reencolado deja de resucitar una tienda cerrada. No cambia quién gana
  entre el panel y el POS: un evento nuevo del POS sigue pisando al panel.
- (b) No: se acepta que un reintento viejo del outbox pueda reabrir una tienda,
  que es el riesgo que HD13 dice explícitamente que se asume.

**Recomendación: (a)**, porque creo que es lo que hace que HD13 signifique lo que
parece querer decir. Si tu lectura es que asumir ese riesgo era parte de la
decisión, dilo y se queda en (b): el diseño funciona igual, y la migración tiene
ese `ALTER TABLE` en un bloque aparte precisamente para poder no aplicarlo.
