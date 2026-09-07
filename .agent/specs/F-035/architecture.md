---
feature: F-035
agente: sdd-architect
actualizado: 2026-09-07T01:46:33Z
estado: listo
---

> Diseño sobre `.agent/specs/F-035/spec.md` en `estado: listo`, con `SP1`
> abierta pero **no bloqueante** (la propia spec lo dice). `design.md` está en
> `estado: no aplica` y no hay interfaz que decidir.
>
> Este documento decide **las tres** cosas que la spec dejó a propósito en
> § «No decidido a propósito» para arquitectura —memoización, ubicación de la
> resolución y forma del `select`— y **nada más**: ni alcance, ni criterios, ni
> R1..R15, ni el contrato. Deja dos preguntas al humano, `AP1` y `AP2`, y
> **ninguna de las dos bloquea** la firma del plan.
>
> Un hallazgo cambia la recomendación literal de la spec y va dicho arriba
> porque el resto del documento depende de él: **`cache()` de React no memoiza
> dentro de un route handler en esta configuración de Next**. Ver § AD1.

## Estado actual relevante

| Pieza                                        | Qué aporta, y se reutiliza tal cual                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sync/server/processBatch.ts`   | El embudo: acumula en `touchedStores` (línea 45) y dispara **una** `revalidateStores` por lote (línea 93). No cambia de forma, solo de argumentos              |
| `src/features/sync/server/handlers/misc.ts`  | `handleCurrency` (línea 165) y `handleExchangeRate` (línea 183), y sobre todo `outcomeOf` (línea 50), que ya convierte «cero slugs» en `PROCESSED` pelado      |
| `src/features/sync/server/handlers/types.ts` | `HandlerOutcome.touchedStoreSlugs?: readonly PublicSlug[]` (línea 26). El tipo **no cambia**; su comentario sí (I4)                                            |
| `src/features/storefront/server/registry.ts` | `expandBrandRevalidation()` (línea 310): el embudo tipado «marca + miembros renderizables → canónicos». Calcula `brandBranchCount` **él**, de `members.length` |
| `src/features/catalog/server/queries.ts`     | `loadPublishedStorefronts` (línea 434): la consulta con raíz en `Storefront` y `where` anidado (línea 443) que R4 pone como modelo. Es el molde de AD3         |
| `src/lib/publicSlug.ts`                      | `canonicalSlug()` (línea 31) y el tipo nominal `PublicSlug`: un `string` sin pasar por ahí no compila (R5)                                                     |
| `src/lib/cache.ts`                           | `revalidateStores` (línea 86) dispara `storeTag` + `storeCatalogTag`, los dos tags que `getStoreRates` (`src/features/catalog/server/queries.ts:404`) usa      |
| `prisma/schema.prisma`                       | `@@index([businessId])` de `Storefront` (línea 202) y `@@index([storefrontId])` de `Store` (línea 316): la consulta de AD3 ya está indexada por los dos lados  |

Nada nuevo en `src/lib/`, nada en `src/app/`, nada de cliente. Cero tags nuevos
(R10), cero entradas de caché nuevas, cero migraciones.

## Decisión

Una consulta con raíz en `Storefront`, memoizada por lote en una clausura que
`processCatalogBatch` crea y pasa a los dos handlers, que la convierten en
`touchedStoreSlugs` con el embudo tipado que ya existe. Tres decisiones, en
orden de dependencia.

### AD1 — se memoiza por lote, con una clausura de ámbito de lote, no con `cache()`

**Decisión: memoizar, y la memoización es correcta, no solo rápida** — pero
**no** con `cache()` de React, que es lo que la spec recomendaba.

**Por qué no `cache()`.** `cache()` sólo memoiza si React tiene un _cache
dispatcher_ instalado; sin él, la implementación **llama a la función y ya**
(`node_modules/next/dist/compiled/react/cjs/react.react-server.development.js`,
la rama `if (!dispatcher) return fn.apply(null, arguments)`). Ese dispatcher lo
instala el renderizador de RSC, y el runtime de route handler de esta
configuración no lo trae: `getCacheForType` aparece 2 veces en
`node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js` y **0**
veces en `app-route.runtime.prod.js`, `app-route-turbo.runtime.prod.js` y sus
variantes `dev` (sólo lo traen las variantes `-experimental`, que exigen banderas
que `next.config.ts` no activa — y `src/lib/cache.ts:19-22` ya dejó escrito que
`cacheComponents` no se enciende). El sync entra por
`src/app/api/internal/sync/catalog/route.ts`, un route handler. Consecuencias de
haber elegido `cache()`:

1. En producción seguirían siendo **500 consultas** en el lote de 500 eventos,
   con un comentario en el código afirmando lo contrario.
2. **Ningún test lo detectaría en ninguna dirección**: en Vitest tampoco hay
   dispatcher, así que un test que afirme «un solo `findMany` para 500 eventos»
   falla, y uno que afirme «uno por evento» pasa — con y sin `cache()`. La
   memoización sería literalmente inobservable.

Los dos únicos usos de `cache()` del repo (`src/features/catalog/server/queries.ts:1`
y `src/features/storefront/server/resolve.ts:1`) se llaman desde páginas, donde
el dispatcher sí existe; el único route handler que los alcanza
(`src/app/[slug]/pedido/[code]/respuesta/route.ts`) los llama una vez por
petición, así que ahí no cuesta nada. No hay nada que arreglar fuera de F-035:
el hallazgo es sobre el runtime, no sobre ese archivo.

**La forma elegida.** Una fábrica que devuelve una clausura con un `Map` dentro,
invocada **dentro** de `processCatalogBatch` y pasada como tercer argumento a los
dos handlers. Es estado **por lote**, creado y descartado con la llamada: no es
estado a nivel de módulo (lo que la spec prohíbe, porque se compartiría entre
peticiones y entre negocios) y no depende de ningún runtime. Se memoiza la
**promesa**, no el valor, y en caso de rechazo se **borra la entrada**: así un
corte de base a mitad de lote hace fallar el evento que lo sufrió (fila «Un
`EXCHANGE_RATE` que falla» de la tabla de casos límite) y no envenena a los 400
siguientes con la misma promesa rechazada.

Es **perezosa a propósito**: la consulta no se lanza hasta el primer
`EXCHANGE_RATE`/`CURRENCY` del lote, así que un lote de 500 `PRODUCT` no paga
nada, y el conjunto se toma **después** de las escrituras que ese lote ya hizo.

**Qué pasa si la memoización devuelve un conjunto rancio dentro del mismo lote.**
El caso del enunciado —`STORE` que publica en el evento 3, `EXCHANGE_RATE` en el
7— sólo es rancio si el primer evento de tasa fue **anterior** al `STORE`
(evento 2, digamos). Analizado hasta el final, **no se pierde ninguna
invalidación que hubiera que hacer**, y por tres razones encadenadas:

1. **El conjunto sólo puede crecer dentro de un lote, nunca encogerse.** El
   sync no escribe `DRAFT` en ninguna parte: la ruta de despublicar de
   `handleStore` escribe `SUSPENDED` (`src/features/sync/server/handlers/store.ts:144`),
   que sigue siendo renderizable por R3. De hecho **ningún** escritor del repo
   escribe `DRAFT`: el panel escribe `PUBLISHED`/`SUSPENDED`
   (`src/features/admin/server/mutations.ts:420` y `:430`) y el sync crea
   `PUBLISHED` (`src/features/sync/server/handlers/store.ts:220`). Un `DRAFT` sólo
   llega del `@default(DRAFT)` del schema, es decir del seed.
2. **Toda sucursal que entra a mitad de lote entra por un evento `STORE` que la
   reporta él mismo.** Las dos ramas de escritura de `handleStore` devuelven
   `touchedStoreSlug` (líneas 164, 237 y 285) y `processBatch.ts:66` lo mete en
   **el mismo** `Set` que la resolución de F-035, antes de la única
   `revalidateStores` del final. Sus dos tags se expiran igual.
3. **Y en el caso peor —una marca que pasa de 1 a 2 renderizables a mitad de
   lote— el conjunto rancio es _mejor_ que el fresco.** El tag con el que está
   guardada la entrada de caché es el que tenía cuando se escribió: la sucursal
   que ya existía guardó sus lecturas bajo `storeTag(brandSlug)`, porque ése era
   su canónico (`src/lib/publicSlug.ts:32`). El conjunto rancio contiene
   `brandSlug` y la expira. El conjunto fresco contendría los slugs propios de
   las dos, que **no** son el tag de esa entrada. Además el conjunto fresco
   puede **lanzar**: si la sucursal recién publicada no tiene `Store.slug`,
   `canonicalSlug()` lanza con `brandBranchCount = 2`, y ese `throw` mandaría el
   `EXCHANGE_RATE` a `failed[]` por culpa de una invariante que rompió otro
   handler. Recalcular por evento **expone** F-035 a ese estado; memoizar lo
   deja fuera.

Por tanto memoizar es correcto y además es lo verificable: «un `findMany` por
lote» se afirma con un mock de `prisma`, sin runtime de Next y sin trucos.
Coste: R7 («una por evento, ninguna por sucursal») se cumple con margen, porque
el techo real queda en **una por lote**.

Alternativas descartadas: `cache()` de React (inerte en el route handler, ver
arriba); estado a nivel de módulo (se comparte entre peticiones y entre
negocios: prohibido por la spec y sería la peor variante de C3);
`AsyncLocalStorage` (misma semántica que la clausura con más maquinaria y sin
precedente en el repo); resolver **eagerly** al principio del lote (consulta en
lotes que no tocan ninguna tasa, y toma el conjunto antes de las escrituras del
propio lote, que es justo lo que el punto 3 de arriba desmonta); recalcular por
evento (correcto y aceptado por la propia tabla de casos límite de la spec, pero
1000 sentencias SQL de más en el peor caso y expuesto al `throw` del punto 3 —
queda como plan B en § Riesgos).

### AD2 — la resolución vive en un módulo nuevo del sync, y llama a `expandBrandRevalidation()`

**Decisión:** un módulo nuevo, src/features/sync/server/businessBranches.ts
(por crear), capa `features/*/server/` —la única que puede tocar Prisma según
la tabla de Arquitectura de `AGENTS.md`—, que hace **la** consulta y delega la
conversión a canónicos en `expandBrandRevalidation()`
(`src/features/storefront/server/registry.ts:310`). Los handlers de
`src/features/sync/server/handlers/misc.ts` no ven Prisma para esto: reciben la
clausura y la invocan.

El criterio de corte es escalabilidad, en dos sentidos concretos:

1. **Escalabilidad de llamadores, no estética.** El conjunto «toda sucursal
   renderizable de un negocio» no es de las tasas: es de cualquier evento cuyo
   alcance sea el **negocio**. F-036 ya depende de F-035 y verifica leyendo el
   catálogo público; el siguiente evento con alcance de negocio (una
   configuración, un método de pago, una promoción del negocio) necesitará
   exactamente esta función. Un módulo con nombre propio es donde el segundo
   llamador la reutiliza; una función privada dentro de `misc.ts` es donde el
   segundo llamador **copia el `where`**, y copiar el `where` es cómo nace un I1.
2. **La memoización tiene que vivir en algún sitio que no sea la lógica por
   entidad.** La fábrica de AD1 la crea `processBatch.ts` y la consumen dos
   handlers: si la consulta vive dentro de `misc.ts`, `processBatch.ts` acaba
   importando de `src/features/sync/server/handlers/misc.ts` una fábrica que no tiene nada que ver con
   categorías, monedas ni tasas.

Alternativas descartadas: **extender `affectedStoreSlugs`** (`misc.ts:27`) —los
dos `where` no son el mismo (el de F-026 filtra «producto en la categoría» y
**no** filtra `status`; el de F-035 filtra `status` y nada más), así que unirlas
obliga a un parámetro que decide qué filtros se aplican, que es exactamente la
confusión que R4 prohíbe, y además tocaría código de F-026 que `SP1` reserva al
humano; **una función hermana en el mismo `misc.ts`** —vale, pero deja dos
consultas casi iguales a diez líneas una de otra e invita a «unificarlas», que
es como F-035 heredaría el hueco de I1—; **meterla en
`src/features/storefront/server/registry.ts`** —ese módulo es el dueño de `Slug`
por `src/features/storefront/server/boundaries.test.ts` y no es el sitio de una
consulta con alcance de negocio del sync—; **pasar por `expandBrandTouch()`**
—produce **valores** de slug para `slugTag`, que no es lo que hace falta (R9
punto 2).

Y la precisión de R9 punto 2 —«usarlo obliga a agrupar por marca primero,
porque es por marca y el conjunto de R2 es por negocio»— deja de ser un coste en
cuanto la consulta se enraíza en `Storefront`: **la agrupación es la consulta**.
Eso es lo que une AD2 con AD3.

### AD3 — el `select` con raíz en `Storefront`: el segundo número no existe

**Decisión:** la consulta arranca en `Storefront`, no en `Store`, y la única
colección de miembros que existe en el código es la ya filtrada:

```ts
// src/features/sync/server/businessBranches.ts (por crear)
const brands = await prisma.storefront.findMany({
  where: { businessId },
  select: {
    slug: true,
    stores: { where: { status: { not: "DRAFT" } }, select: { slug: true } },
  },
});

return brands.flatMap((brand) => expandBrandRevalidation(brand.slug, brand.stores).canonicalSlugs);
```

Por qué esta forma hace **imposible** equivocar R4, y no sólo difícil:

1. **`brandBranchCount` no es un valor que este código pueda calcular ni
   pasar.** `expandBrandRevalidation()` lo deriva de `members.length`
   (`src/features/storefront/server/registry.ts:310-326`). El error que R4
   describe —contar sobre el subconjunto que se va a invalidar en vez de sobre
   los hermanos no-`DRAFT`— necesita **dos números**; aquí hay **uno**, y es el
   mismo array que se invalida. La confusión no es representable.
2. **La coincidencia de los dos filtros es una propiedad de F-035, no una
   casualidad.** El subconjunto a invalidar es «los hermanos no-`DRAFT`», que es
   literalmente el conjunto sobre el que hay que contar. En F-026 los dos
   difieren de verdad (subconjunto = «con producto en la categoría»), y por eso
   su `select` anidado necesita los dos filtros separados: **reusar la forma de
   F-026 aquí sería importar un peligro que este feature no tiene**.
3. **El compilador cierra la puerta de al lado.** El parámetro de
   `expandBrandRevalidation` es `readonly BrandMemberSlug[]` =
   `{ slug: string | null }[]` (`src/features/storefront/server/registry.ts:215`),
   así que pasarle la fila de la marca, o una fila de `Store`, o el array sin
   filtrar de otro `select`, no compila. Y su retorno es el nominal
   `BrandRevalidationSet` (línea 288): los canónicos son `PublicSlug` producidos
   por `canonicalSlug()` (R5) y no hay forma de fabricarlos a mano.
4. **El filtro va en el `where` anidado** (R6): una `DRAFT` sin `Store.slug`
   —`el-trebol-almacén`, `prisma/seed.ts:539-545`— no llega nunca a
   `canonicalSlug()`, así que no hay `throw` que convertir en `failed[]`. No hay
   ningún `.filter()` posterior porque no hay nada que filtrar después.
5. **El precedente es exacto.** `loadPublishedStorefronts`
   (`src/features/catalog/server/queries.ts:434-455`) es esta misma consulta:
   raíz en `Storefront`, `where: { status: { not: "DRAFT" } }` anidado (línea
   443), `branchCount = storefront.stores.length` (línea 453) y `canonicalSlug`
   por miembro. R4 la cita como modelo. F-035 es esa consulta **menos** el
   estrechamiento a `PUBLISHED` de la línea 463 (que es de pre-render, no de
   invalidación) y **más** `where: { businessId }`.
6. **`.brandSlugs` se ignora a propósito** (R11): el selector de marca no pinta
   importes, así que `storefrontTag` no va a rancio por una tasa. Ignorar la
   mitad de un retorno es más barato que duplicar el bucle de `canonicalSlug`,
   que es lo que la prohibición de `AGENTS.md` § Prohibiciones existe para
   evitar. Y el guardián de `src/features/storefront/server/boundaries.test.ts:143`
   no se roza: no hay ningún `.map()` a `.slug` en el código nuevo.

**Lo único que queda equivocable, y qué lo caza.** Mover o borrar el `where`
anidado. Dos fixtures que **ya están en el seed** lo convierten en test rojo:

| Fixture                                                                                                             | Qué afirma el test                                                                                  | Qué falla si el `where` no está                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `el-trebol` — `PUBLISHED` + `SUSPENDED` + `DRAFT` sin slug (`prisma/seed.ts:518-546`)                               | El conjunto es exactamente `el-trebol-centro` y `el-trebol-playa`, y el evento responde `processed` | `canonicalSlug()` lanza por la `DRAFT` sin slug → el evento cae en `failed[]`. Es E9 y R6 en el mismo aserto                |
| `bodega-central` — marca de **una** renderizable cuya sucursal **sí** tiene `Store.slug` (`prisma/seed.ts:448-465`) | El canónico es `bodega-central` (el de la **marca**), nunca `bodega-central-vedado`                 | Cualquier `brandBranchCount` que no sea «hermanos no-`DRAFT` de esta marca» devuelve el slug propio → el fallo de R4 exacto |

El segundo es el que importa para R4: es el único caso del repo donde los dos
resultados posibles son ambos slugs vivos, así que un aserto de igualdad exacta
distingue el cálculo correcto del incorrecto. Sin él, R4 no tiene sensor.

### Lo que esto añade a la tabla § Datos y contrato de la spec

La spec fija que `handleCurrency` **reciba `businessId`**; se cumple. Lo que
este diseño añade es un **tercer** parámetro en los dos handlers (la clausura de
AD1), que es donde vive la decisión que la spec me delegó. No cambia ningún
tipo de `HandlerOutcome`, ni la respuesta HTTP, ni el contrato.

## Componentes

| Componente                              | Capa                 | Responsabilidad                                                                                        | Archivo                                                  |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `loadRenderableBranchSlugs`             | `features/*/server/` | La consulta de AD3. Único sitio con Prisma del feature. No lanza salvo invariante roto (AP1)           | src/features/sync/server/businessBranches.ts (por crear) |
| `createRenderableBranchLookup`          | `features/*/server/` | La fábrica del memo por lote: `Map` en clausura, promesa memoizada, entrada borrada si se rechaza      | src/features/sync/server/businessBranches.ts (por crear) |
| `RenderableBranchLookup`                | tipo                 | `(businessId: string) => Promise<readonly PublicSlug[]>` — lo que los handlers reciben                 | src/features/sync/server/businessBranches.ts (por crear) |
| `handleExchangeRate`                    | `features/*/server/` | Tras escribir, `outcomeOf(await lookup(businessId))`. Sigue saliendo por `SKIPPED` en `CUP` antes (R1) | `src/features/sync/server/handlers/misc.ts`              |
| `handleCurrency`                        | `features/*/server/` | Igual, tras el `upsert`. Gana `businessId` y la clausura                                               | `src/features/sync/server/handlers/misc.ts`              |
| `processCatalogBatch`/`applyEvent`      | `features/*/server/` | Crea la clausura una vez por lote y la pasa. La invalidación del final **no cambia**                   | `src/features/sync/server/processBatch.ts`               |
| Comentario de `touchedStoreSlugs`       | tipo                 | Corrección de I4                                                                                       | `src/features/sync/server/handlers/types.ts`             |
| Comentario de `expandBrandRevalidation` | `features/*/server/` | Anotar su segundo llamador. **Sólo comentario**: ni firma ni cuerpo cambian                            | `src/features/storefront/server/registry.ts`             |

### Archivos que toca cada cambio

| Archivo                                                       | Qué cambia                                                                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/features/sync/server/businessBranches.ts (por crear)      | Nuevo: la consulta, la fábrica del memo y el tipo. Importa `prisma`, `expandBrandRevalidation` y `PublicSlug`                                                                      |
| `src/features/sync/server/handlers/misc.ts`                   | Firmas de `handleCurrency` (línea 165) y `handleExchangeRate` (línea 183); `return PROCESSED` (líneas 176 y 203) → `outcomeOf(...)`. Cero importaciones de `src/lib/cache.ts` (R8) |
| `src/features/sync/server/processBatch.ts`                    | Una línea que crea la clausura antes del bucle; `applyEvent` gana un parámetro; los dos `case` (líneas 129-132) lo pasan                                                           |
| `src/features/sync/server/handlers/types.ts`                  | Comentario de las líneas 21-22 (I4). El tipo de la línea 26 **no** se toca                                                                                                         |
| `src/features/storefront/server/registry.ts`                  | Comentario de `expandBrandRevalidation` (línea 310): deja de tener un solo llamador                                                                                                |
| `src/features/sync/server/handlers/misc.test.ts`              | Los llamadores directos de los dos handlers necesitan el tercer argumento, más los casos nuevos (R5, R6, R7, E5, E8, E9)                                                           |
| `src/features/sync/server/processBatch.test.ts`               | El memo (un `findMany` por lote), la unión de E10 y la cuenta de R12. Los mocks de handlers (líneas 35-36) ya aceptan cualquier aridad                                             |
| src/features/sync/server/businessBranches.test.ts (por crear) | Los dos fixtures de la tabla de AD3, con `prisma` mockeado                                                                                                                         |
| .agent/specs/F-035/smoke.sh (por crear)                       | C1 y C3, calcado de `.agent/specs/F-026/smoke.sh` (guion y trampa de la moneda sintética: ya escritos en la spec)                                                                  |

Lo que **no** se toca, y va escrito para que el plan no lo ordene: `src/lib/cache.ts`,
`src/lib/publicSlug.ts`, `src/features/sync/schemas.ts`, `prisma/schema.prisma`,
`docs/sync-contract.md` (R15, criterio 8), `affectedStoreSlugs` de
`src/features/sync/server/handlers/misc.ts:27` (SP1) y
`src/app/api/internal/sync/catalog/route.ts`.

La fixture del criterio 5 (un negocio con **todas** sus sucursales en `DRAFT`)
la decide `sdd-tester`: la spec la dejó abierta a propósito (§ No decidido, punto 3) y este diseño no la condiciona — con el `Map` vacío o con cero marcas, la
resolución devuelve `[]` y `outcomeOf` da `PROCESSED` pelado, que es lo que C5
mide.

## Flujo de datos

Un lote, de principio a fin. Sólo los pasos con estrella son nuevos.

1. `POST /api/internal/sync/catalog` → `withInternalAuth` resuelve `caller`, y
   `findCatalogMismatch` (`src/app/api/internal/sync/catalog/route.ts:39`) aborta
   con `403 BUSINESS_MISMATCH` si algún `businessId` no es el del token. Por eso
   un lote es de **un** negocio y el `Map` del memo tendrá una sola entrada.
2. `processCatalogBatch` → `recordBatch` separa `fresh` de `duplicateIds` (E11).
3. ★ `const renderableBranches = createRenderableBranchLookup();` — cero
   consultas todavía.
4. Por cada evento fresco, `applyEvent(event, caller.businessId, renderableBranches)`.
5. `EXCHANGE_RATE`: `CUP` → `SKIPPED` **antes** de escribir y antes de resolver
   (R1, E8). Si no: `currency.upsert`, `exchangeRate.create`, ★
   `outcomeOf(await renderableBranches(businessId))`.
   `CURRENCY`: `currency.upsert`, ★ lo mismo. El `operation` se sigue ignorando.
6. ★ La primera de esas invocaciones lanza la consulta de AD3 (2 sentencias SQL);
   las 499 siguientes reciben la misma promesa. Si se rechaza, la entrada se
   borra y el siguiente evento vuelve a intentarlo; el que la sufrió cae en
   `failed[]` por el `catch` de `processBatch.ts:84`.
7. `processBatch.ts:75-77` vuelca `touchedStoreSlugs` en el `Set` `touchedStores`,
   el mismo de `handleCategory`, `handleProduct` y `handleStore`.
8. `revalidateStores(touchedStores)` una vez (línea 93) → `2 × N` `revalidateTag`
   con prefijo `store:` (R12). `revalidateSlugs` recibe el mismo conjunto más
   `touchedSlugValues` (línea 100) → `N` tags `slug:` más, aceptado por R13.
   `revalidateStorefronts` y `revalidateProducts` no reciben nada nuevo (R11).
9. La primera visita posterior a `/[slug]` (o a `/[slug]/catalogo`, cuya **ruta**
   no se cachea pero cuyas tasas sí, I3) re-lee `getStoreRates` y pinta la tasa
   nueva. Nadie repinta nada antes (Fuera 1).

## Contratos

Nada cruza una frontera HTTP: sin endpoint nuevo, sin body nuevo y por tanto
**sin esquema Zod nuevo**. Los contratos son de tipos.

```ts
// src/features/sync/server/businessBranches.ts (por crear)

/** Pregunta «¿qué sucursales renderizables tiene este negocio?», memoizada
 *  por LOTE. Los handlers reciben esto, nunca `prisma`. */
export type RenderableBranchLookup = (businessId: string) => Promise<readonly PublicSlug[]>;

/** Creado DENTRO de `processCatalogBatch`, una vez por lote — nunca a nivel
 *  de módulo, que se compartiría entre peticiones y entre negocios. */
export function createRenderableBranchLookup(): RenderableBranchLookup;
```

```ts
// src/features/sync/server/handlers/misc.ts — las dos firmas
export async function handleCurrency(
  payload: CurrencyPayload,
  businessId: string,
  renderableBranches: RenderableBranchLookup,
): Promise<HandlerOutcome>;

export async function handleExchangeRate(
  payload: ExchangeRatePayload,
  businessId: string,
  renderableBranches: RenderableBranchLookup,
): Promise<HandlerOutcome>;
```

`HandlerOutcome` **no cambia**: `touchedStoreSlugs?: readonly PublicSlug[]` ya
existe (`src/features/sync/server/handlers/types.ts:26`) y ya lo drena
`processBatch.ts:75-77`.

**Tabla de errores**: ninguna nueva. Los estados posibles de un evento siguen
siendo los de hoy —`processed`, `skipped_not_published`, `stale`, `duplicate`,
`failed`— y este feature no añade ni un código. En particular no hay ningún
camino nuevo a `failed[]`: la resolución no lanza por dato de negocio (R6), sólo
puede lanzar si la invariante de ADR 0018 ya está rota en la base, que es `AP1`.

### La corrección de I4

`src/features/sync/server/handlers/types.ts:21-22` dice hoy «Only
`handleCategory` sets this today» y deja de ser cierto en el mismo commit. El
texto de reemplazo, en inglés como manda `AGENTS.md` § Idioma, y que dice el
**por qué** de cada uno para que la próxima persona no tenga que deducirlo:

> Set by three handlers, all for the same reason — the entity they write
> belongs to the BUSINESS, not to one branch, so its readers live in N
> branches: `handleCategory` (F-026), and `handleCurrency` /
> `handleExchangeRate` (F-035, whose readers are the five pages that convert
> amounts through `getStoreRates`). `processBatch.ts` folds it into the SAME
> `Set` that already feeds `revalidateStores`, so this never adds a new
> invalidation call.

## Modelo de datos y migraciones

**Ninguna migración.** Ni tabla, ni columna, ni índice, ni backfill. Ninguno de
los dos comandos prohibidos de `AGENTS.md` aparece en este feature, ni parece
necesario.

Índices que la consulta de AD3 usa, los dos ya en `prisma/schema.prisma`:
`@@index([businessId])` de `Storefront` (línea 202) para la sentencia raíz, y
`@@index([storefrontId])` de `Store` (línea 316) para la de los miembros. La
tabla `ExchangeRate` no se lee aquí, así que su
`@@index([businessId, currencyCode, createdAt])` (línea 534) sigue siendo
asunto de F-036.

## Escalabilidad y límites

**Por evento de tasa o moneda, después del primero del lote: 0 consultas.** El
primero paga **una llamada Prisma**, que son **dos sentencias SQL** —Prisma
resuelve la relación anidada con un `SELECT` propio, que es la estrategia por
defecto sin el preview `relationJoins`, que este schema no activa—: un index
scan sobre `Storefront` por `businessId` y otro sobre `Store` por
`storefrontId IN (...)` con el filtro de `status`. Con el seed de hoy,
`seed-negocio-1`: 7 marcas y 8 sucursales renderizables, menos de 1 KB de
respuesta.

**El peor caso del enunciado, 500 eventos en un lote** (`MAX_CATALOG_EVENTS`,
`src/features/sync/schemas.ts:17`), todos `EXCHANGE_RATE` del mismo negocio:

| Variante               | Sentencias SQL de resolución | Total del lote (las escrituras ya cuestan 2 por evento: `upsert` + `create`) |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| Memoizado (lo elegido) | **2**                        | ~1002                                                                        |
| Recalculado por evento | 1000                         | ~2000                                                                        |
| `cache()` de React     | 1000 (inerte, § AD1)         | ~2000, creyendo que son 1002                                                 |

Con 2-5 ms de ida y vuelta contra el pooler, memoizar ahorra 2-5 s en ese lote;
con la base en otra región (20-50 ms) ahorra 20-50 s, que es la diferencia entre
un lote que responde y uno que se corta. **Por qué es aceptable**: porque el
número que crece con el tamaño del lote son las escrituras que el lote ya hacía,
y la resolución deja de crecer del todo. Ninguna de las dos sentencias va dentro
de un `$transaction`, así que no hay nada que pueda hacer deadlock contra el
pooler en modo transacción (`AGENTS.md` § Cosas que muerden).

**Invalidaciones, que es lo que los criterios 2 y 6 cuentan:** `2 × N` con
`N` = sucursales renderizables del negocio, **independiente del número de
eventos**. Con `seed-negocio-1` son 16 (8 sucursales), no 6 — I2 ya explicó que
eso también cumple el criterio bien leído. Más `N` tags `slug:` por R13. Total
`3 × N` tags por lote.

**Qué se rompe primero al multiplicar por 100.** No es la consulta: es la
invalidación. Un negocio con 100 marcas y 300 sucursales renderizables sigue
resolviendo en 2 sentencias (~10 KB, 300 filas), pero cada lote que traiga una
tasa dispara **900** `revalidateTag` secuenciales y deja 300 catálogos fríos,
que se re-renderizan de golpe en la siguiente oleada de visitas. El umbral
aproximado está en **~200 sucursales renderizables por negocio**: a partir de
ahí la invalidación domina el coste del lote y el arreglo natural sería un tag
por negocio, que R10 pone explícitamente fuera de alcance. Queda como `AP2`.

**JavaScript de cliente: 0 KB nuevos**, ni un byte —no hay componente— así que
`npm run check:bundle` no cambia de número. **Entradas de caché nuevas: 0. Tags
nuevos: 0.** Duración de la caché: sin cambios, el suelo de 3600 s de
`STOREFRONT_REVALIDATE` (`src/lib/cache.ts:54`); lo que cambia es que ahora
también la invalida una tasa.

## Qué se rompe si alguien implementa esto mal

Una línea por decisión, y cada una es una decisión distinta que alguien puede
tomar mal:

- **Contar `brandBranchCount` sobre el subconjunto a invalidar** (R4):
  `el-trebol-centro` se invalida bajo `store:el-trebol` y su página se queda
  rancia **para siempre** bajo un tag que nadie expira.
- **Filtrar `status` con un `.filter()` en vez de en el `where`** (R6):
  `canonicalSlug()` lanza sobre `el-trebol-almacén` y el `EXCHANGE_RATE` entra
  en `failed[]`, que el POS reintenta hasta agotar su outbox.
- **Memo a nivel de módulo** en vez de clausura por lote: el conjunto de un
  negocio invalida las páginas de otro (adiós criterio 3) y un servidor de larga
  vida nunca vuelve a recalcularlo.
- **Memoizar con `cache()` de React**: 500 consultas en producción con un
  comentario que dice que hay una, y ningún test capaz de notar la diferencia.
- **Memoizar la promesa rechazada sin borrar la entrada**: un corte de base de
  200 ms convierte los 400 eventos siguientes del lote en `failed[]`.
- **Resolver al principio del lote (eager)** en vez de perezosamente: se
  consulta en lotes que no traen ninguna tasa, y el conjunto se toma antes de
  las escrituras del propio lote.
- **Resolver antes de escribir**, o antes del `return SKIPPED` de `CUP`: se
  invalida lo que no se escribió y R1/E8 caen.
- **Llamar a `revalidate*` desde el handler** (R8): 500 eventos son 1000
  `revalidateTag` y los criterios 2 y 6 fallan por definición.
- **Devolver además `touchedBrandSlug`/`touchedProductId`** (R11): expira tags
  que nadie lee y contradice una regla que la spec ya cerró.
- **Registrar algo con `console.error`** en el código nuevo (I5): pone roja la
  etapa `smoke` completa sin que nada haya fallado. El código nuevo de F-035 no
  registra nada, ni con `console.warn`.
- **Arreglar de paso el hueco de I1 en `affectedStoreSlugs`**: reabre un
  criterio ya verificado de F-026 y se lo quita de las manos al humano (SP1).

## Patrones a seguir / antipatrones a evitar

- **`AGENTS.md` § Arquitectura**: la única capa que toca Prisma es
  `features/*/server/`, y el módulo nuevo está ahí. Los handlers reciben una
  función, no el cliente.
- **`AGENTS.md` § Prohibiciones, «armar a mano el array de slugs de una
  marca»**: se cumple pasando por `expandBrandRevalidation()`. Cero
  `.map(...)`/`.reduce`/`for` sobre sucursales en el código nuevo — ni en la
  forma que el grep de `src/features/storefront/server/boundaries.test.ts:143`
  reconoce ni en las siete que no reconoce.
- **`AGENTS.md` § Cosas que muerden, el pooler en modo transacción**: ninguna
  consulta nueva dentro de un `$transaction`.
- **`AGENTS.md` § Cosas que muerden, la idempotencia del sync**: este feature no
  escribe nada, así que las dos propiedades siguen intactas; el conjunto se
  deriva del estado de la base y dos entregas del mismo evento dan lo mismo
  (R14).
- **`AGENTS.md` § Cosas que muerden, `console.error`**: el código nuevo no
  instrumenta nada.
- **`AGENTS.md` § Cosas que muerden, las comillas invertidas de `check:harness`**:
  los cuatro archivos que este feature va a crear están citados en este
  documento **sin** comillas y con `(por crear)`.
- **`AGENTS.md` § Idioma**: el código y sus comentarios en inglés; este
  documento en español.

## Riesgos y plan B

| Riesgo                                                                                                      | Plan B                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El tercer parámetro en los dos handlers le parece demasiado al humano                                       | Recalcular por evento: se borran la fábrica y el parámetro, la resolución se llama directa y todo lo demás queda igual. Cuesta 1000 sentencias en el peor caso y la propia tabla de casos límite de la spec lo acepta («a lo sumo 500 consultas de resolución, una por evento») |
| La invariante de ADR 0018 está rota en la base (un no-`DRAFT` de una marca multi-sucursal sin `Store.slug`) | La resolución lanza, como lanzan ya los otros cinco sitios que la asumen. No se traga el error: tragárselo dejaría la sucursal rancia para siempre **y** el evento en `ok`. Ver `AP1`                                                                                           |
| Un negocio con cientos de sucursales convierte cada tasa en cientos de invalidaciones                       | Es el comportamiento que la regla ① del contrato promete. El umbral y el arreglo (un tag por negocio, hoy fuera de alcance por R10) quedan en `AP2`                                                                                                                             |
| Alguien «unifica» la consulta nueva con `affectedStoreSlugs` en un refactor futuro                          | Los dos `where` son distintos y el comentario del módulo nuevo lo dirá; los dos fixtures de la tabla de AD3 se ponen rojos si la unificación pierde el filtro de `status`                                                                                                       |

## ¿Hace falta una ADR?

**No.** Este feature aplica un mecanismo que ya está decidido y documentado:
`docs/adr/0018-registro-de-slugs-y-slug-canonico.md` (el canónico de una marca), la elección de
`unstable_cache` + `revalidateTag` que `src/lib/cache.ts:19-22` justifica, y el
embudo de invalidación por lote de `processBatch.ts`. No contradice ninguna ADR
existente. El único candidato a convención nueva —«el memo por lote se pasa como
parámetro, no con `cache()`, porque en un route handler `cache()` es un no-op»—
es una **ficha de playbook**, no una ADR; la escribirá quien cierre el feature si
el sensor la pide, y el slug propuesto está en la respuesta de este agente.

## Preguntas al humano

**AP1 — ¿abrimos algo para la invariante de ADR 0018, o la dejamos donde está?**
Qué es: hoy nada impide en la base que una sucursal **no**-`DRAFT` de una marca
con dos o más renderizables se quede sin `Store.slug`, y en ese estado
`canonicalSlug()` lanza. La resolución de F-035 lo hereda igual que los otros
cinco sitios que ya asumen la invariante
(`src/features/catalog/server/queries.ts:466`,
`src/features/sync/server/handlers/store.ts:157` y `:278`,
`src/features/admin/server/mutations.ts:178`,
`src/features/storefront/server/registry.ts:310`). **No bloquea**: ningún
escritor del repo escribe `DRAFT` (comprobado: el panel escribe
`PUBLISHED`/`SUSPENDED` y el sync crea `PUBLISHED`), así que el estado sólo se
alcanza republicando una `DRAFT` sembrada a mano —`el-trebol-almacén` es
exactamente esa fila— y para llegar ahí el propio `handleStore` ya tiene que
haber fallado antes. Opciones: (a) nada, queda escrito aquí; (b) un feature del
humano que añada el `CHECK` en migración o una consulta de inventario; (c) que
F-035 se lo trague con un `catch` por marca. **Recomendación: (b) cuando toque,
y (a) mientras tanto.** (c) no: dejaría una sucursal rancia para siempre y el
evento reportado como bueno, que es peor que un fallo visible.

**AP2 — ¿hasta cuántas sucursales por negocio aceptamos «invalidar el negocio
entero»?** Qué es: el conjunto de R2 es por negocio, así que una sola tasa
expira `3 × N` tags y deja `N` catálogos fríos. Con el seed son 24 tags; con un
negocio de 300 sucursales son 900 y una oleada de 300 renders en frío. **No
bloquea** F-035, que implementa la regla ① tal como está escrita. Opciones: (a)
nada ahora, el umbral queda documentado en § Escalabilidad (~200 sucursales
renderizables); (b) un feature que introduzca un tag por negocio
(`business:<id>`) del que cuelguen las lecturas de tasas, lo que reduce la
invalidación a **un** tag por lote pero es un mecanismo nuevo que R10 excluye de
F-035 y que habría que coordinar con la redacción del contrato. **Recomendación:
(a)**, y reabrir con (b) el día que un negocio real pase de las ~200 sucursales
o que alguien mida la oleada de renders en frío.
