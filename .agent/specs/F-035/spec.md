---
feature: F-035
agente: sdd-spec
actualizado: 2026-09-07T01:25:25Z
estado: listo
---

> Nace de la **S-004** de cuadrecaja (`.agent/solicitudes.md` § «S-004, S-005 y
> S-006 · Las tres reglas que cambió la v11»), aceptada y **ya publicada** en la
> regla ① de `docs/sync-contract.md` § «Cambios respecto a la v10.1». La regla
> está escrita; lo que falta es cumplirla. Precedente directo:
> `.agent/specs/F-026/spec.md`, que resolvió el mismo problema para `CATEGORY`.

## Problema

Aplicar una tasa nueva no expira nada: `handleExchangeRate` y `handleCurrency`
devuelven `PROCESSED` a secas (`src/features/sync/server/handlers/misc.ts:176`
y `:203`), sin `touchedStoreSlugs`, así que la vitrina sigue sirviendo el
importe convertido con la tasa vieja **hasta 58 minutos** —el techo son los
3600 s de `STOREFRONT_REVALIDATE` (`src/lib/cache.ts:54`)— mientras el checkout
ya cotiza con la nueva, porque `loadFreshRates`
(`src/features/orders/server/quote.ts:151`) nunca se cachea. El comprador que
añade al carrito lo que vio y pulsa «pedir» se lleva un
`409 PRICE_CHANGED` (`src/app/api/orders/route.ts:84`) que no sabe interpretar:
el precio que le cobran no es el que leyó, y ninguna de las dos cifras está
mal — solo están a distinta edad.

## Alcance

### Dentro

1. Que `handleExchangeRate` y `handleCurrency` resuelvan las sucursales
   renderizables del negocio y las devuelvan en `touchedStoreSlugs`
   (`src/features/sync/server/handlers/types.ts:26`), que es el campo que
   `processBatch.ts` ya drena.
2. Pasar `businessId` a `handleCurrency`, que hoy no lo recibe
   (`src/features/sync/server/processBatch.ts:130`).
3. Las pruebas que **cuentan** invalidaciones (R12) y las que fijan el
   conjunto exacto de slugs (R5, R6, R7).

### Fuera (explícito)

1. **Repintar la página.** Invalidar es expirar la marca, no re-renderizar: la
   vitrina se rehace en la primera visita posterior. Lo dice la regla ① del
   contrato con estas palabras («Lo que no promete: instantaneidad»).
2. **Tocar el checkout.** Lee fresco desde siempre
   (`src/features/orders/server/quote.ts:151`); el criterio 7 es una obligación
   de **no** regresionar, no de cambiar nada.
3. **Cualquier cambio en lo que el POS envía.** Ni campo nuevo, ni enum nuevo,
   ni código de error nuevo. `exchangeRatePayloadSchema` y
   `currencyPayloadSchema` (`src/features/sync/schemas.ts:112` y `:120`) quedan
   intactos.
4. **Mover la versión de `docs/sync-contract.md`.** Criterio 8: la regla ya
   está escrita en la v11. Solo se mueve si al implementar se descubre que lo
   escrito no es implementable (R15).
5. **Un mecanismo de invalidación nuevo.** No hay tag nuevo, no hay lectura
   nueva, no hay revalidación por evento (R8, R11).
6. **La guarda anti-rancia de la tasa vigente.** Es F-036, que depende de este
   feature y no al revés (`.agent/features.json`).
7. **Arreglar el defecto latente de `affectedStoreSlugs`** que I1 describe: es
   código de F-026 y su arreglo es un feature del humano (regla 4). Este
   feature solo se obliga a **no heredarlo** (R6).

## Actores y precondiciones

Lo dispara **cuadrecaja**, con `POST /api/internal/sync/catalog` y su bearer
token (`src/app/api/internal/sync/catalog/route.ts`). Nadie más: ni el panel ni
la tienda pública escriben tasas.

Precondiciones que el sistema ya garantiza y de las que este feature depende:

- **El negocio del evento es el del token.** `findCatalogMismatch`
  (`route.ts:39`) aborta el lote entero con `403 BUSINESS_MISMATCH` **antes** de
  `processCatalogBatch` si el `businessId` de la raíz o de cualquier payload no
  coincide. Por eso `caller.businessId` es una fuente legítima y no una
  suposición.
- **Los handlers no revalidan.** Devuelven qué tocaron; `processBatch.ts:93-104`
  dispara una sola `revalidateStores`/`revalidateSlugs`/`revalidateStorefronts`/
  `revalidateProducts` al final del lote, con `Set`s deduplicados.
- **Todo lo que el sync escribe es idempotente** (AGENTS.md § Cosas que
  muerden). `handleExchangeRate` es la única entidad de las cinco que **añade**
  fila en vez de actualizarla (append-only), y eso no cambia aquí.

## Comportamiento esperado

**E1 — una tasa nueva se ve en la primera visita posterior.**
Dado un negocio con una sucursal publicada y un producto con
`syncedPriceCurrency` distinta de la moneda base de la tienda, y dada su página
ya cacheada mostrando el importe convertido con la tasa vieja; cuando llega un
`EXCHANGE_RATE` de esa moneda con `rate` distinta; entonces el **siguiente**
`GET` de `/[slug]` devuelve 200 con el importe convertido con la tasa nueva, sin
esperar 3600 s y sin reiniciar el servidor.

**E2 — cuatro monedas en un lote son una invalidación por sucursal.**
Dado un lote con cuatro `EXCHANGE_RATE` de cuatro monedas del mismo negocio;
cuando se procesa; entonces `revalidateStores` se llama **una** vez, con un
`Set` cuyo contenido es exactamente el conjunto de R2, y la cuenta de R12 vale
`2 × N` (N = sucursales renderizables del negocio), no `4 × 2 × N`.

**E3 — el negocio de al lado se sigue sirviendo de caché.**
Dados `seed-negocio-1` y `seed-negocio-2` sembrados (`prisma/seed.ts:326` y
`:552`); cuando llega un `EXCHANGE_RATE` de `seed-negocio-1`; entonces ningún
tag de `el-faro` se expira, y su página sigue respondiendo el HTML que tenía
cacheado.

**E4 — un `CURRENCY` invalida las sucursales del emisor y de nadie más.**
Dado un `CURRENCY` con `code`, `name` y `symbol`; cuando se procesa con el token
de `seed-negocio-1`; entonces el conjunto invalidado es el de R2 para
`seed-negocio-1`, aunque la fila que se escribe sea global a la plataforma
(`prisma/schema.prisma`, `Currency` sin `businessId`) y aunque hoy ninguna
página la lea (R10).

**E5 — un negocio sin sucursal renderizable acepta el evento y no invalida.**
Dado un negocio cuyas sucursales están todas en `DRAFT` (o que no tiene
ninguna); cuando llega su `EXCHANGE_RATE`; entonces la respuesta es `207` con
`results[0].status === "processed"`, la fila de `ExchangeRate` queda escrita, y
la cuenta de R12 vale **0**. No falla, no lanza, no devuelve `failed[]`.

**E6 — 500 eventos no son más invalidaciones que sucursales.**
Dado un lote de 500 eventos (el máximo, `MAX_CATALOG_EVENTS`
en `src/features/sync/schemas.ts:17`) que mezcla `EXCHANGE_RATE`, `CATEGORY`,
`PRODUCT` y `STORE` de un negocio con tres sucursales renderizables; cuando se
procesa; entonces la cuenta de R12 vale 6 (3 sucursales × 2 tags), y
`revalidateStores` se llamó una sola vez.

**E7 — el checkout no cambia de comportamiento.**
Dado un `EXCHANGE_RATE` recién aplicado; cuando se cotiza inmediatamente
después; entonces la cotización usa la tasa nueva, igual que hoy y sin depender
de que la invalidación haya ocurrido — `loadFreshRates` no lee ninguna caché ni
ningún tag.

**E8 — un `EXCHANGE_RATE` de `CUP` no invalida nada.**
Dado un `EXCHANGE_RATE` con `currency: "CUP"`; cuando se procesa; entonces la
respuesta de ese evento es `skipped_not_published` (misc.ts:187, y
`docs/sync-contract.md` § `payload` de `EXCHANGE_RATE`), no se escribe ninguna
fila y la cuenta de R12 vale 0 para ese evento.

**E9 — una marca de varias sucursales se invalida por el slug propio de cada
una, nunca por el de la marca.**
Dada la marca `el-trebol` de `prisma/seed.ts:518` —`el-trebol-centro`
(`PUBLISHED`), `el-trebol-playa` (`SUSPENDED`) y `el-trebol-almacén` (`DRAFT`,
`Store.slug` a `null`)—; cuando llega un `EXCHANGE_RATE` de su negocio;
entonces el conjunto invalidado contiene `el-trebol-centro` y
`el-trebol-playa`, **no** contiene `el-trebol` (que sirve el selector, no un
catálogo) y **no** contiene la sucursal en `DRAFT`. Y el evento **no falla**:
ver R6.

**E10 — un lote mezclado funde su conjunto con el de los demás handlers.**
Dado un lote con un `EXCHANGE_RATE`, un `CATEGORY` y un `PRODUCT` del mismo
negocio; cuando se procesa; entonces hay **una** llamada a `revalidateStores`
cuyo `Set` es la unión de los tres conjuntos, deduplicada — el `PRODUCT` no
añade una segunda llamada por su `touchedStoreSlug`, ni el `CATEGORY` por su
`touchedStoreSlugs` (esto último ya está probado en
`src/features/sync/server/processBatch.test.ts:268`).

**E11 — el evento repetido no invalida dos veces de más.**
Dado el mismo `eventId` entregado dos veces; cuando el segundo llega; entonces
`recordBatch` lo reporta `duplicate` sin llamar al handler
(`processBatch.ts:38-43`), así que no aporta ningún slug y la cuenta de R12 de
ese segundo lote vale 0.

## Reglas de negocio

**R1 — invalida lo que se escribió, no lo que se recibió.** Un handler devuelve
`touchedStoreSlugs` solo en el camino en que **escribe**. `EXCHANGE_RATE` de
`CUP` sale por `return SKIPPED` (misc.ts:187) antes del `upsert` de `Currency` y
del `create` de `ExchangeRate`: cero slugs (E8). Comprobable por el `outcome`
del handler, sin levantar nada.

**R2 — el conjunto es «toda sucursal renderizable del negocio del token»,
resuelto de la base.** Para `EXCHANGE_RATE` el negocio es `caller.businessId`
(`processBatch.ts:64`), que `findCatalogMismatch` ya garantizó igual a
`payload.businessId`. Para `CURRENCY` es `caller.businessId` y solo eso: el
payload no lleva `businessId` y la tabla es global (`schemas.ts:112`,
`docs/sync-contract.md` § `payload` de `CURRENCY` ①). La unidad es el
**negocio**, no la marca: un `Business` puede tener varias `Storefront`
(`prisma/schema.prisma:144`) y las tasas cuelgan del negocio
(`prisma/schema.prisma:524`), así que el conjunto cruza todas sus marcas.

**R3 — «sucursal publicada» del criterio 5 significa `status != DRAFT`**, es
decir `PUBLISHED` **y** `SUSPENDED`. Es la única definición de «renderizable»
que este repo tiene, y la usan los diez sitios que la necesitan:
`src/lib/publicSlug.ts:22` (la define en el contrato de `canonicalSlug`),
`src/features/catalog/server/queries.ts:443` (`loadPublishedStorefronts`),
`src/features/storefront/server/resolve.ts:99`,
`src/features/sync/server/handlers/store.ts:102`,
`src/features/sync/server/handlers/product.ts:65`,
`src/features/sync/server/handlers/misc.ts:35`,
`src/features/sync/server/availability.ts:40`,
`src/features/admin/server/branding.ts:15`,
`src/features/admin/server/stores.ts:29` y
`src/features/admin/server/mutations.ts:167`. Y lo confirma el 404:
`requireStore` solo lanza `notFound()` para `DRAFT`
(`src/features/catalog/server/queries.ts:201`), así que una `SUSPENDED`
responde 200 con su aviso de cerrada y **su página queda cacheada bajo
`storeTag`**. Consecuencia para el criterio 5: el caso que no invalida nada es
el negocio con **todas** sus sucursales en `DRAFT`, o sin ninguna.

**R3b — la parte de R3 que es preventiva, dicha aparte para que nadie la
confunda con lo demás.** Hoy **ninguna** de las cinco páginas que convierten
importes lee las tasas en el camino de una sucursal no publicada: las cinco
devuelven el aviso de cerrada antes de llamar a `getStoreRates`
(`src/app/[slug]/page.tsx:116`, `src/app/[slug]/catalogo/page.tsx:122`,
`src/app/[slug]/c/[categorySlug]/page.tsx:90`,
`src/app/[slug]/p/[productSlug]/page.tsx:113`,
`src/app/[slug]/buscar/page.tsx:132`). Incluir las `SUSPENDED` cuesta dos
`revalidateTag` por sucursal y compra dos cosas: que el día en que una página
cerrada muestre un importe no haya que acordarse de este archivo, y que el
conjunto de F-035 sea **el mismo** que ya calculan los otros nueve sitios de
R3. Restringirlo a `PUBLISHED` también satisfaría los criterios 1 a 7; se
elige `status != DRAFT` por consistencia, y queda escrito para que sea una
decisión y no un descuido.

**R4 — `brandBranchCount` se cuenta sobre los hermanos no-`DRAFT`, nunca sobre
el subconjunto que se va a invalidar.** Son dos filtros distintos y el precedente
los tiene separados a propósito: `loadPublishedStorefronts` selecciona los
miembros con `status: { not: "DRAFT" }`
(`src/features/catalog/server/queries.ts:443`) y **solo después** descarta los
que no están `PUBLISHED` para pre-renderizar
(`src/features/catalog/server/queries.ts:463`). Contar sobre el subconjunto
haría que `el-trebol-centro` —el único `PUBLISHED` de una marca con dos
renderizables— saliera con el canónico `el-trebol` en vez de
`el-trebol-centro`, y su página quedaría rancia **para siempre** bajo un tag que
nadie expira. Es la mitad más fácil de equivocar de todo el feature.

**R5 — el slug que se devuelve es el canónico, producido por `canonicalSlug()`**
(`src/lib/publicSlug.ts:31`). Nunca `Store.slug` a pelo, nunca el slug de la
marca a pelo, nunca el slug con el que llegó una URL: `touchedStoreSlugs` es
`readonly PublicSlug[]` y `PublicSlug` es nominal, así que un `string` sin pasar
por ahí no compila.

**R6 — la resolución no puede lanzar.** `canonicalSlug()` lanza
(`src/lib/publicSlug.ts:33-38`) cuando una sucursal de una marca multi-sucursal
no tiene `Store.slug`, y una `DRAFT` puede no tenerlo (`Store.slug` es
`String?`, `prisma/schema.prisma:236`; `el-trebol-almacén` es exactamente ese
caso, `prisma/seed.ts:540-542`). Si el `where` de la resolución no filtra
`status: { not: "DRAFT" }`, ese `throw` se convierte en un evento en `failed[]`
y el POS reintenta un lote que nunca va a entrar. El filtro va **en el `where`**,
no en un `.filter()` posterior. Comprobable: E9 y, en unidad, un caso con una
sucursal `DRAFT` sin slug entre las filas devueltas.

**R7 — una consulta por evento, ninguna por sucursal.** La resolución es **un**
`prisma.store.findMany` con el `businessId` y el `select` anidado que ya usa
`affectedStoreSlugs` (misc.ts:28-39) — nunca una consulta por sucursal ni una
por marca. Comprobable contando llamadas al mock de `findMany`.

**R8 — cero invalidaciones por evento.** Los dos handlers **no** importan
`src/lib/cache.ts` ni llaman a ninguna `revalidate*`: devuelven y ya. Quien
invalida es `processBatch.ts:93`, una vez por lote. Comprobable: el módulo de
handlers no tiene esa importación, y `revalidateStores` se llama una sola vez
por lote (E2, E6, E10).

**R9 — nadie arma a mano el array de slugs de una marca.** Es la prohibición
literal de AGENTS.md § Prohibiciones y el defecto que
`.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
fichó tres veces. Dos precisiones que este feature necesita y que la ficha no
dice porque no se le presentó el caso:

1. Este feature es **estructuralmente inmune** al defecto de la ficha: lo que
   se invalida es el negocio **entero**, así que no hay hermana que se quede
   fuera por construcción. Ninguna sucursal cambia de significado sin estar ya
   en el conjunto.
2. El embudo tipado que existe para «una marca y sus miembros renderizables»
   es `expandBrandRevalidation()`
   (`src/features/storefront/server/registry.ts:310`), no `expandBrandTouch()`;
   el segundo produce **valores de slug** para `slugTag`, que no es lo que hace
   falta aquí. Si la arquitectura decide pasar por él, hay que agrupar por
   `Storefront` primero, porque es por marca y el conjunto de R2 es por
   negocio. El `.map()` sobre stores que devuelve `canonicalSlug(...)` —la
   forma que ya usa misc.ts:41— **no** dispara el guardián de
   `src/features/storefront/server/boundaries.test.ts:143`, cuyo patrón exige
   un `.slug` desnudo tras la flecha; que no lo dispare no es permiso, es un
   dato para que nadie lo interprete como una alarma nueva.

**R10 — no hay tag nuevo ni lectura nueva.** Las cinco páginas que convierten
importes leen las tasas por `getStoreRates`, cacheado con
`storeTag(branch.canonicalSlug)` (`src/features/catalog/server/queries.ts:404`),
que es uno de los dos tags que `revalidateStores` expira
(`src/lib/cache.ts:86-93`). Verificado una por una — `/[slug]`
(`src/app/[slug]/page.tsx:144`), `/[slug]/catalogo`
(`src/app/[slug]/catalogo/page.tsx:92` y `:151`), `/[slug]/c/[categorySlug]`
(`src/app/[slug]/c/[categorySlug]/page.tsx:119`), `/[slug]/p/[productSlug]`
(`src/app/[slug]/p/[productSlug]/page.tsx:141`) y `/[slug]/buscar`
(`src/app/[slug]/buscar/page.tsx:212`)— y **ninguna** pinta un importe
convertido leyendo por otra vía: no hay ningún otro llamador de `getStoreRates`
ni de `convert()` en `src/app/`. Las cuatro páginas restantes bajo `/[slug]`
(`carrito`, `checkout`, `pedido/[code]`, `sucursales`) son `force-dynamic` con
`revalidate = 0`: no tienen caché que expirar.

**R11 — `revalidateStorefronts` y `revalidateProducts` no se tocan.** El
selector de una marca no pinta ningún importe (`src/app/[slug]/page.tsx:107`
sirve `BranchList`), así que `storefrontTag` no va a rancio por una tasa. Y
`productTag` no lo lee **nadie** hoy: la ficha de producto lee catálogo y tasas
por `storeCatalogTag`/`storeTag` (`src/app/[slug]/p/[productSlug]/page.tsx:139`),
así que expirar `storeTag` ya la cubre. Por tanto ninguno de los dos handlers
devuelve `touchedBrandSlug`, `touchedProductId` ni `touchedSlugValues`.

**R12 — así se cuenta una invalidación, y esta regla es la que hace
verificables los criterios 2 y 6.** Una invalidación es **una llamada a
`revalidateTag` cuyo primer argumento empieza por `store:`**. Ni «una llamada a
`revalidateStores`» ni «un evento»:

- `revalidateStores` se llama **siempre** una vez por lote, incluso con el
  `Set` vacío (`processBatch.ts:93`), y con el `Set` vacío dispara **cero**
  `revalidateTag` (`src/lib/cache.ts:87-91`). Por eso «no invalidar nada» del
  criterio 5 se mide en `revalidateTag`, no en `revalidateStores`.
- `revalidateStores` expira **dos** tags por sucursal, `storeTag` y
  `storeCatalogTag` (`src/lib/cache.ts:89-90`), así que la cuenta esperada es
  `2 × N` con N = tamaño del conjunto de R2. Es la misma aritmética que ya
  afirma `src/lib/cache.test.ts:50` («2 stores x 2 tags»).

Dos puntos de observación, los dos ya usados en este repo:

1. **Agregación**: mockear `@/lib/cache` y afirmar
   `expect(revalidateStores).toHaveBeenCalledOnce()` más el contenido exacto
   del `Set`, como hace `src/features/sync/server/processBatch.test.ts:263-266`.
2. **Cuenta de tags**: mockear solo `next/cache` con un `revalidateTag`
   contador y dejar `src/lib/cache.ts` real, como hace
   `src/lib/cache.test.ts:4-8`; entonces la cuenta es
   `revalidateTag.mock.calls.filter(([tag]) => tag.startsWith("store:")).length`.

Lo que **no** cuenta como invalidación de este feature: los `slug:` que
`revalidateSlugs` dispara sobre el mismo conjunto (R13) y los `product:` de
`revalidateProducts`, que aquí siempre son cero.

**R13 — el conjunto también viaja a `revalidateSlugs`, y se acepta.**
`processBatch.ts:100` pasa `new Set([...touchedStores, ...touchedSlugValues])` a
`revalidateSlugs`, así que devolver N slugs hace que se expiren además N tags
`slug:`. No es un mecanismo nuevo ni un daño: la resolución se recalcula en la
siguiente petición y el precedente es F-026, cuyos `touchedStoreSlugs` ya viajan
por ahí. Queda escrito para que nadie lo cuente como regresión ni intente
separar los dos `Set`, que sería un cambio en `processBatch.ts` fuera de este
alcance.

**R14 — el orden de entrega sigue sin importar.** La invalidación no introduce
estado: se calcula del estado de la base **después** de escribir, dos entregas
del mismo evento dan el mismo conjunto, y un lote reintentado invalida lo mismo
(E11). Es la propiedad que AGENTS.md § Cosas que muerden exige a todo handler
nuevo, y este feature no la toca porque no escribe nada nuevo.

**R15 — el contrato no se mueve.** Criterio 8: la regla ① de la v11 ya está
publicada y este feature la implementa tal cual. Solo se mueve la versión de la
primera línea de `docs/sync-contract.md` si al implementar se descubre que lo
escrito **no es implementable**, y entonces se dice qué cambió y por qué; toda
edición de ese archivo mueve la versión (AGENTS.md § Documentación, y el hook
`.claude/hooks/sync-contract-version.sh`). Hoy no se conoce ninguna razón para
moverla: las dos condiciones de la regla ① salen del `processBatch.ts` que ya
existe, y la frase «hoy ninguna página pública lee esa tabla» es cierta
(`prisma.currency` solo aparece en los dos `upsert` de misc.ts).

## Casos límite y errores

| Caso                                                                            | Qué tiene que pasar                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXCHANGE_RATE` de `CUP`                                                        | `skipped_not_published`, ninguna fila escrita, **cero** invalidaciones (R1, E8)                                                                                           |
| Negocio con todas las sucursales en `DRAFT`                                     | `processed`, fila escrita, cero invalidaciones, sin `throw` (E5)                                                                                                          |
| Negocio con todas las sucursales en `SUSPENDED`                                 | **Sí** invalida, por R3/R3b. Es la lectura deliberada del criterio 5, y por eso el criterio se verifica con el caso `DRAFT`, que satisface las dos lecturas               |
| Marca de varias sucursales                                                      | El slug propio de cada renderizable; nunca el de la marca; la `DRAFT` fuera y **sin** hacer fallar el evento (E9, R4, R6)                                                 |
| Marca de una sola sucursal renderizable                                         | El slug de la **marca** es el canónico (`src/lib/publicSlug.ts:32`), incluso si la sucursal tiene `Store.slug` propio como `bodega-central-vedado` (`prisma/seed.ts:452`) |
| Lote que mezcla `EXCHANGE_RATE` + `CATEGORY` + `PRODUCT` del mismo negocio      | Una sola `revalidateStores` con la unión deduplicada (E10)                                                                                                                |
| 500 `EXCHANGE_RATE` del mismo negocio                                           | `2 × N` invalidaciones, no `500 × 2 × N`; y a lo sumo 500 consultas de resolución, una por evento (R7, R12)                                                               |
| Moneda que nunca se declaró (`EXCHANGE_RATE` de una moneda sin fila `Currency`) | Sin cambio: `handleExchangeRate` ya crea la fila provisional con `name`/`symbol` iguales al código (misc.ts:189-193) e invalida como cualquier otra                       |
| Evento duplicado (mismo `eventId`)                                              | `duplicate` sin llamar al handler, cero invalidaciones (E11)                                                                                                              |
| Un `EXCHANGE_RATE` que falla (base caída a mitad)                               | El `catch` de `processBatch.ts:84` lo reporta en `failed[]`; el handler no llegó a devolver nada, así que **no aporta slugs**. Un evento fallido no invalida              |
| `CURRENCY` con `active: false`                                                  | Mismo camino: `upsert` y el conjunto de R2. `operation` se ignora por completo (contrato § `payload` de `CURRENCY` ②) y `DELETE` no borra nada                            |
| Tasa rancia (cuando F-036 exista)                                               | Sigue respondiendo `processed` (contrato § ② de la v11), así que sigue invalidando. Invalidar de más es barato; este feature no anticipa nada de F-036                    |

Un caso límite que **no** existe: dos negocios en el mismo lote. El
`403 BUSINESS_MISMATCH` de `route.ts:39` lo hace imposible antes de que
`processCatalogBatch` corra.

## Datos y contrato

Ni el `payload` de `EXCHANGE_RATE` ni el de `CURRENCY` cambian ni un campo.
Lo que cambia es de nuestro lado y en tres líneas:

| Pieza                                              | Hoy                               | Después                                                                        |
| -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `handleExchangeRate(payload, businessId)`          | `return PROCESSED` (misc.ts:203)  | `touchedStoreSlugs` con el conjunto de R2                                      |
| `handleCurrency(payload)`                          | `return PROCESSED` (misc.ts:176)  | recibe `businessId` y devuelve el mismo conjunto                               |
| `applyEvent` (`processBatch.ts:129-130`)           | `handleCurrency(event.payload)`   | le pasa `businessId`                                                           |
| `HandlerOutcome.touchedStoreSlugs` (`types.ts:26`) | «Only `handleCategory` sets this» | tres handlers lo ponen; el comentario que dice lo contrario hay que corregirlo |

El tipo no cambia: `readonly PublicSlug[]`, ya drenado por
`processBatch.ts:75-77`. La respuesta HTTP no cambia: `207` con
`results[].status` (`route.ts:44`).

## Criterios de aceptación propuestos

Los nueve son los de `.agent/features.json`, sin tocar ni una palabra
(regla 3). Aquí van con **qué se envía, qué se observa y con qué se mide**.

**C1 `[ya]`** — «Tras enviar un EXCHANGE_RATE con una tasa distinta, la pagina
de catalogo de cada sucursal publicada de ese negocio muestra el importe
convertido con la tasa nueva en la PRIMERA visita posterior, sin esperar los
3600s y sin reiniciar el servidor.»
Se mide con la app levantada, en un smoke .agent/specs/F-035/smoke.sh
(por crear) calcado de `.agent/specs/F-026/smoke.sh` (que ya tiene `sync_catalog`,
`price_of`, `psql_val` y el token). Guion: (1) `POST` un `EXCHANGE_RATE` de una
moneda sintética de tres letras propia de la corrida, estilo el `ZZZ` de
`.agent/specs/F-027/smoke.sh:190`, con `rate: 100`; (2) `POST` un `PRODUCT`
sintético en `seed-tienda-1` con esa moneda y `price: 1`; (3) `GET /tienda-demo`
y afirmar el importe de la tasa vieja; (4) `POST` el mismo `EXCHANGE_RATE` con
`rate: 200`; (5) `GET /tienda-demo` **una** vez y afirmar el importe doble. El
paso 3 es imprescindible: sin calentar la caché, el paso 5 no prueba que se
expiró nada.
**Trampa que hay que escribir en el plan:** no se mueva la tasa de `USD`. El
seed solo inserta `RATES` si no hay ya una fila de esa moneda
(`prisma/seed.ts:337`), así que un `npm run seed` posterior **no** restaura los
440, y `Cerveza Cristal` (1.20 USD → 528 CUP) es fixture de lectura de otros
features, incluida la lista de precios de
`src/features/catalog/catalogFilters.test.ts:345`. Moneda sintética, o la
fixture compartida queda corrupta para todos.

**C2 `[ya]`** — «Un lote con cuatro EXCHANGE_RATE de cuatro monedas del mismo
negocio invalida cada sucursal UNA sola vez, no cuatro, verificado contando las
invalidaciones que dispara ese lote.»
Se envía un lote de cuatro `EXCHANGE_RATE` (cuatro `currency` distintas, ninguna
`CUP`). Se observa con los dos puntos de R12: `revalidateStores` llamado una vez
con el `Set` esperado, y `2 × N` llamadas a `revalidateTag` con tag `store:`. La
cuenta se afirma como número exacto, no como «≤».

**C3 `[ya]`** — «Un EXCHANGE_RATE de un negocio no invalida ninguna pagina de
otro negocio, verificado con dos negocios sembrados: la pagina del segundo se
sigue sirviendo desde cache despues del evento.»
Unidad: el conjunto de R2 para `seed-negocio-1` no contiene `el-faro`.
HTTP: `GET /el-faro` para calentar; un `UPDATE` directo por `psql` sobre un dato
visible de esa tienda (un `localName`, restaurado al final del guion), que **no**
dispara ningún `revalidateTag` —es la técnica que `.agent/specs/F-027/smoke.sh:222`
ya documenta—; `POST` el `EXCHANGE_RATE` de `seed-negocio-1`; `GET /el-faro` otra
vez y afirmar que **sigue** el valor viejo. Que siga el viejo es la prueba de que
su caché no se expiró; comparar HTML byte a byte no lo probaría, porque un
re-render idéntico da el mismo HTML.

**C4 `[ya]`** — «Un CURRENCY invalida las sucursales del negocio que lo emite y
de ningun otro.»
Se envía un `CURRENCY` con el token de `seed-negocio-1`. Se observa el mismo
conjunto de C2 y la ausencia de `el-faro`. No hay nada visible que comprobar por
HTTP: ninguna página lee `Currency` (R15), y el criterio no lo pide.

**C5 `[ya]`** — «Un negocio sin ninguna sucursal publicada acepta el
EXCHANGE_RATE y responde processed sin invalidar nada ni fallar.»
Hace falta una fixture que hoy no existe: un negocio con sus sucursales en
`DRAFT`. Se mide con el `outcome` del handler (`status: "processed"` y **sin**
`touchedStoreSlugs`) o, si se hace contra Postgres, con la respuesta `207` y
`results[0].status === "processed"` más cero llamadas a `revalidateTag`. Si se
escribe como `*.db.test.ts`, hay que mockear `next/cache` desde arriba del
archivo: ficha
`.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`.

**C6 `[ya]`** — «Un lote de 500 eventos sobre tres tiendas no dispara mas
invalidaciones que las de esas tres sucursales, verificado con el mismo conteo
del criterio 2.»
Mismo contador de R12. Ojo con la lectura: para un `EXCHANGE_RATE` las
sucursales afectadas **no** son «las tiendas que el lote nombra» —una tasa no
nombra ninguna— sino todas las renderizables del negocio, así que el escenario
tiene que usar un negocio cuyas renderizables sean exactamente esas tres (ver
I2). Lo que el criterio fija, y es lo que hay que afirmar, es que la cuenta
depende del **conjunto de sucursales** y no del número de eventos: 500 eventos y
6 invalidaciones.

**C7 `[ya]`** — «El checkout sigue cotizando con la tasa fresca inmediatamente
despues del evento, sin depender de la invalidacion: no hay regresion respecto
de hoy.»
Se mide como no-regresión: la suite de `src/features/orders/server/quote.ts`
sigue en verde y `loadFreshRates` sigue sin caché ni tag —comprobable porque su
módulo no importa `cached` de `src/lib/cache.ts`—. Con la app levantada, cotizar
justo después del evento y afirmar el importe con la tasa nueva.

**C8 `[ya]`** — «La regla ya esta escrita en docs/sync-contract.md v11 (seccion
'Cambios respecto a la v10.1' ①): este feature NO vuelve a mover la version
salvo que al implementarlo se descubra que lo escrito no es implementable, y en
ese caso mueve la version y dice que cambio.»
Se mide con `git diff --stat main -- docs/sync-contract.md` vacío al cerrar el
feature. Si no lo está, la primera línea del fichero tiene que haberse movido y
la sección de cambios tiene que decir qué cambió (R15).

**C9 `[ya]`** — «bash .agent/verify.sh F-035 --full termina con codigo 0.»
Tal cual. Recordatorio para quien escriba prosa del arnés: `--full` incluye la
etapa `harness`, que falla si se cita entre comillas invertidas un archivo que
todavía no existe (AGENTS.md § Cosas que muerden) — por eso el smoke de C1 va
escrito sin comillas y con «(por crear)».

## Incongruencias detectadas

**I1 — `affectedStoreSlugs` de F-026 puede hacer fallar un evento `CATEGORY`, y
este feature no debe heredar el hueco.** `src/features/sync/server/handlers/misc.ts:28`
selecciona las tiendas del negocio con producto en la categoría **sin filtrar
`status`**, y luego llama a `canonicalSlug()` con el `brandBranchCount` contado
sobre los hermanos no-`DRAFT` (misc.ts:35). Si una sucursal `DRAFT` sin
`Store.slug` pertenece a una marca con dos o más renderizables,
`canonicalSlug()` lanza (`src/lib/publicSlug.ts:33-38`) y ese `CATEGORY` vuelve
en `failed[]` con un mensaje que no habla de categorías. Con el seed de hoy no
se reproduce —las tres sucursales de `el-trebol` no tienen ningún
`StoreProduct` (`prisma/seed.ts:904-947` no siembra productos)—, pero en
producción basta un almacén en borrador con inventario. **No se arregla aquí**:
es un criterio de F-026, la regla 3 prohíbe tocarlo y la regla 4 prohíbe que un
agente añada el feature que lo corrija. Queda como criterio propuesto:
`[nuevo]` «Un `CATEGORY` con productos en una sucursal `DRAFT` sin slug propio,
en una marca de dos o más sucursales renderizables, responde `processed` y no
`failed`.» Y queda en SP1 para el humano.

**I2 — el criterio 6 cuenta sucursales del lote; una tasa no tiene sucursales
en el lote.** «Un lote de 500 eventos sobre tres tiendas» describe bien un lote
de `PRODUCT` —cada evento nombra su `storeId`— y describe mal un lote de
`EXCHANGE_RATE`, que no nombra ninguna tienda y afecta a **todas** las
renderizables del negocio, sean tres u ocho. La misma frase está en el contrato
(«Un lote de 500 eventos sobre tres tiendas expira esas tres sucursales», § ①)
y en `.agent/solicitudes.md` («hace seis llamadas, no mil»). No es un error de
fondo: lo que las tres frases prometen es **coalescencia** (una invalidación por
sucursal por lote, nunca una por evento), y eso se cumple. Se resuelve por
lectura, sin tocar ni el criterio ni el contrato: C6 se verifica con un negocio
cuyas renderizables sean exactamente esas tres. Con el seed de hoy,
`seed-negocio-1` tiene **ocho** (`tienda-demo`, `tienda-dos`, `tienda-cerrada`,
`bodega-central`, `bodega-uno`, `bodega-dos`, `el-trebol-centro`,
`el-trebol-playa`), así que un lote de 500 sobre él da 16 invalidaciones, no 6,
y eso **también** cumple el criterio bien leído.

**I3 — el criterio 1 habla de los 3600 s como si el problema fuera solo el ISR,
y en dos de las cinco páginas es la caché de datos.** `/[slug]/catalogo` y
`/[slug]/buscar` son `force-dynamic` con `revalidate = 0`
(`src/app/[slug]/catalogo/page.tsx:44-45`,
`src/app/[slug]/buscar/page.tsx:41-42`), así que su **ruta** no se cachea; pero
las dos leen las tasas por `getStoreRates`, que es un `unstable_cache` con el
suelo de 3600 s (`src/lib/cache.ts:75`). La ventana de desfase existe igual en
ellas, y el arreglo es el mismo tag. No cambia nada de lo que hay que construir;
cambia lo que hay que **mirar** al verificar C1, y por eso está escrito.

**I4 — el comentario de `touchedStoreSlugs` dejará de ser cierto.**
`src/features/sync/server/handlers/types.ts:21-22` dice «Only `handleCategory` sets
this today». Con este feature lo ponen tres handlers; el comentario hay que
corregirlo en el mismo commit, o la siguiente persona lee una mentira en el
único sitio donde este campo está documentado.

**I5 — `processBatch.ts:114` usa `console.error`**, que AGENTS.md § Cosas que
muerden prohíbe para toda instrumentación de servidor
(`.agent/playbook/console-error-dispara-guardian-servidor.md`). Es
**pre-existente**, del camino de purga de imágenes de F-023, y no lo introduce
F-035. Se anota por dos razones: porque está en el archivo que este feature
edita, y porque el código nuevo de F-035 **no debe registrar nada** — no tiene
por qué, y añadir un `console.error` aquí pondría roja la etapa `smoke` por algo
que no es un fallo.

**I6 — `revalidateProducts`/`productTag` no tienen lector.** `productTag`
(`src/lib/cache.ts:31`) solo aparece en `src/lib/cache.test.ts`: ningún
`cached()` lo usa como tag, y la ficha de producto se invalida por
`storeTag`/`storeCatalogTag`. No afecta a este feature —R11 ya dice que no lo
toca— pero explica por qué devolver `touchedProductId` desde estos handlers
sería trabajo sin efecto.

## Huecos y preguntas al humano

**SP1 — ¿entra I1 en el backlog como feature propio?**
Qué falta: una decisión de backlog, que es del humano (regla 4). **No bloquea**
F-035: R6 obliga a este feature a filtrar `status` en el `where` y con eso el
defecto no se hereda; lo que queda vivo es el `CATEGORY` de F-026, que sigue
pudiendo devolver `failed[]` en producción. Opciones: (a) feature nuevo que
arregle `affectedStoreSlugs` con el criterio `[nuevo]` de I1; (b) arreglarlo de
paso en F-035 como cambio de una línea en la misma función, asumiendo que toca
un criterio ya verificado de F-026; (c) dejarlo escrito aquí y no hacer nada.
**Recomendación: (a)**, y mientras tanto (c). Es un `throw` en el camino
caliente del sync, la misma severidad que la tercera instancia de la ficha
`revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`, pero
mezclarlo con F-035 haría que un feature de invalidación reabra el camino de
escritura de categorías, y eso es exactamente lo que la regla 3 quiere evitar.

No hay ninguna otra pregunta abierta: todo lo demás se resolvió leyendo el
código y está citado con su ruta. Por eso este documento cierra en
`estado: listo`.

## No decidido a propósito

1. **Si el conjunto se memoiza por lote o se recalcula por evento.** Es de
   `sdd-architect`. R7 fija el techo (una consulta por evento, ninguna por
   sucursal) y R12 fija lo que se cuenta; con 500 `EXCHANGE_RATE` del mismo
   negocio, «por evento» son 500 `findMany` idénticos, unos pocos segundos de
   lote sobre el pooler en modo transacción. Recomendación para quien decida:
   memoizar por petición con `cache()` de React, la misma técnica que ya usa
   `getStoreCategories` (`src/features/catalog/server/queries.ts:329`); lo que
   **no** vale es estado a nivel de módulo, que se compartiría entre
   peticiones.
2. **Si la resolución vive en `affectedStoreSlugs`, en una función hermana o en
   `expandBrandRevalidation()`.** También de `sdd-architect`. Las dos
   consultas son parecidas pero no iguales: la de F-026 filtra por producto en
   una categoría, la de F-035 no filtra nada más que el negocio y el `status`.
   R9 punto 2 dice qué embudo existe y qué le falta para servir a un conjunto
   por negocio.
3. **La fixture del criterio 5** (un negocio con todas sus sucursales en
   `DRAFT`): si se resuelve mockeando `prisma` o sembrando en un
   `*.db.test.ts`, lo decide `sdd-tester`. Lo que la spec exige es el
   comportamiento, no el andamio.
4. **Si `SUSPENDED` entra en el conjunto el día que una página cerrada muestre
   un importe.** Hoy entra por R3, y si mañana alguien restringe a `PUBLISHED`
   tendrá que releer R3b antes.
