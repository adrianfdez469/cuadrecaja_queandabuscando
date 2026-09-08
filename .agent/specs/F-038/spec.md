---
feature: F-038
agente: sdd-spec
actualizado: 2026-09-08T01:07:49Z
estado: listo
---

> Nace de la **S-008** de cuadrecaja (`.agent/solicitudes.md` § «Cerradas»,
> «S-008 · Qué monedas enseña el escaparate»), **concedida** y ya **publicada**:
> `docs/sync-contract.md` § «Cambios respecto a la v11» (la v12, aditiva) y
> § «Cambios respecto a la v12» (la v12.1, tres aclaraciones). El contrato es
> **vinculante y va por delante del código a propósito**: la v12 anuncia la
> entidad y sus dos errores, y su cabecera avisa de que todavía no están en pie.
> Esta spec construye el lado receptor y se ajusta al contrato, no al revés.
> Hermano que lee lo que este escribe: **F-039** (lo que el comprador ve), que
> no es este feature.

## Problema

La lista de monedas que un comercio quiere enseñar en su escaparate existe en
cuadrecaja (`NegocioMoneda`, con su bandera `activo`) y **no tiene por dónde
viajar**: el sobre del sync acepta cinco entidades —`STORE`, `CATEGORY`,
`PRODUCT`, `CURRENCY`, `EXCHANGE_RATE` (`src/features/sync/schemas.ts:136`)— y
ninguna habla del **negocio**: `CURRENCY` es global y ni siquiera lleva
`businessId`. Hoy un evento `BUSINESS` responde **`400 INVALID_BATCH` y se lleva
el lote entero por delante**, incluidos los `PRODUCT` que viajaran con él, que es
exactamente lo que la cabecera del contrato pide no provocar
(`docs/sync-contract.md` L10-12: «no lo emitáis hasta el aviso»).

Mientras eso siga así, el escaparate tiene los dos insumos —la tabla global de
monedas y las tasas por negocio— y le falta la única señal que no puede deducir.
Y la alternativa que el propio contrato recomendaba antes de la v12 —«para
retirar una moneda, `active: false`»— **se aplica sobre una tabla global a la
plataforma** (`prisma/schema.prisma:530-540`, `Currency` sin `businessId`): un
negocio que retire el euro se lo retira a todos.

Este feature construye **solo la mitad de escritura**: el sobre acepta la sexta
entidad, la lista se guarda contra el negocio autenticado con su guarda
anti-rancio, y los dos errores por evento que la v12 publicó existen de verdad.
Nadie la lee todavía.

## Alcance

### Dentro

1. La sexta rama del `discriminatedUnion` de `src/features/sync/schemas.ts:136`,
   con su `businessPayloadSchema` **laxo a propósito** (R1, R2).
2. Un handler nuevo —business.ts (por crear), en
   `src/features/sync/server/handlers/`— y su rama en el `switch` de
   `applyEvent` (`src/features/sync/server/processBatch.ts:159-176`) (R5).
3. Dos columnas nuevas en el modelo `Business` (`prisma/schema.prisma:126-153`):
   la lista y su marca de origen, con su migración (R8, R16).
4. El valor `BUSINESS` en el enum `SyncEntity` de la base
   (`prisma/schema.prisma:89-95`), sin el cual `recordBatch` no puede ni
   registrar el evento (`src/features/sync/server/inbox.ts:52`) (R16).
5. Las dos constantes de error de la v12 en `src/constants/sync.ts`, que **hoy no
   existen** aunque el contrato ya las publique (R14, I1).
6. La rama `BUSINESS` de `dependencyRoleOf`
   (`src/features/sync/dependencies.ts:49-68`), que **no añade ninguna
   dependencia de orden**: ambas columnas a `null` (R12).
7. La bandera nueva de `scripts/send-catalog-batch.mjs` (criterio 12, R22).
8. Las pruebas: unidad del sobre y del handler, y los escenarios contra Postgres
   real a través del `POST` de verdad.
9. Al cerrar: la **v12.2** de `docs/sync-contract.md` y la línea fechada en
   `.agent/solicitudes.md` (criterio 13, R19, R20).

### Fuera (explícito)

1. **Pintar las monedas en la tienda.** Eso es **F-039**. Este feature es de
   escritura pura: se guarda la lista y **nadie la lee** (criterio 11, R13). No
   se toca `resolvePrice`, ni `getStoreRates`, ni ninguna página de `src/app/`.
2. **Invalidar caché.** Ningún `revalidate*` nuevo, porque no hay lector al que
   la caché pueda quedarle vieja (R13, SP1). Es de F-039, junto con su lector.
3. **Mover `businessName` o `baseCurrency` fuera de `STORE`.** Los sigue
   escribiendo `handleStore` (`src/features/sync/server/handlers/store.ts:71-74`)
   y este handler no los toca (R10).
4. **Tocar la tabla global `Currency`** o `ExchangeRate`. El handler nunca
   inserta una moneda provisional, a diferencia de `handleExchangeRate`
   (`src/features/sync/server/handlers/misc.ts:230-234`) (R9, criterio 7).
5. **Sembrar la lista.** `prisma/seed.ts` no cambia: la columna nace con su
   valor por defecto y nadie la lee (criterio 11).
6. **Las zonas (S-007 / v13).** `ZONE_TARIFF` aparece en el criterio 2 **como
   ejemplo de vocabulario que hay que seguir rechazando**, no como algo a
   construir (I3).
7. **Cambiar el orden de `recordBatch`** (`src/features/sync/server/inbox.ts:64`)
   ni la forma de la guarda de ninguna otra entidad.
8. **Un estado nuevo en el 207.** `stale`, `processed` y `failed` ya existen
   (`src/features/sync/schemas.ts:199-205`) y bastan (R15).
9. **Editar el documento de cuadrecaja** (`.agents/solicitudes-qab.md`, en su
   repo). El traslado al otro equipo lo hace el humano (D2, R20).

## Actores y precondiciones

Lo dispara **cuadrecaja**, con `POST /api/internal/sync/catalog`
(`src/app/api/internal/sync/catalog/route.ts:23`) y su bearer token. Lo que el
sistema ya garantiza y de lo que dependen los escenarios:

- **El negocio existe siempre antes del evento.** La fila `Business` la crea el
  aprovisionamiento (`src/features/sync/server/provisioning.ts:47-50`) o el
  acuñado del token, y **sin esa fila no hay token que autentique el lote**
  (`src/features/sync/server/caller.ts:29-40`). Por eso `BUSINESS` no añade
  dependencia de orden, y por eso el handler nunca crea nada: solo actualiza.
- **La identidad la da el token, no el payload.** `caller.businessId` es el uuid
  interno y `caller.externalId` el `Negocio.id` del POS
  (`src/features/sync/server/caller.ts:10-16`). Todo `where` va por el primero.
- **Un `businessId` que no case aborta el lote antes de escribir nada.**
  `findCatalogMismatch` (`src/features/sync/identity.ts:19-33`) recorre los
  payloads que llevan `businessId` y el route devuelve `403 BUSINESS_MISMATCH`
  **antes** de `processCatalogBatch`, y por tanto antes de `recordBatch`
  (`src/app/api/internal/sync/catalog/route.ts:39-41`).
- **El orden de aplicación es el de `occurredAt`**, no el del array del POST
  (`src/features/sync/server/inbox.ts:62-64`), con `sort` estable.
- **Un duplicado no entra en el bucle**: sale por `duplicateIds`
  (`src/features/sync/server/processBatch.ts:56-59`) sin llamar a ningún handler.
- **Todo lo que no sea `failed` viaja en `ok`**: `summarize`
  (`src/features/sync/schemas.ts:250-257`). `stale` viaja en `ok`.
- **Un fallo por evento se expresa lanzando `SyncEventFailure`**
  (`src/features/sync/server/handlers/types.ts:71`): el `catch` del bucle
  (`src/features/sync/server/processBatch.ts:117-125`) ya lo convierte en
  `failed[].error`, `results[].error` y `markFailed`, sin tocar una línea allí.
- **La respuesta es siempre `207`** mientras `processCatalogBatch` no lance
  (`src/app/api/internal/sync/catalog/route.ts:45`).

## Comportamiento esperado

**E1 — una lista válida se guarda.**
Dado un negocio autenticado sin lista guardada, cuando llega un lote con un
evento `entity: "BUSINESS"`, `operation: "UPDATE"` y
`payload: { businessId, displayCurrencies: ["CUP","USD","EUR"], updatedAt: T }`,
entonces la respuesta es `207`, ese `eventId` está en `ok`, su entrada de
`results` dice `status: "processed"`, y la fila `Business` de ese negocio guarda
exactamente `["CUP","USD","EUR"]` —en ese orden— y la marca `T`.

**E2 — un `entity` que el contrato no define sigue matando el lote.**
Dado un lote con un evento `entity: "ZONE_TARIFF"` y otro `PRODUCT` perfectamente
válido, cuando se envía, entonces la respuesta es `400` con
`{"error":"INVALID_BATCH","issues":[…]}`, **ninguna** fila de `SyncEvent` queda
escrita y el `PRODUCT` **no** se aplica. Aceptar `BUSINESS` no abre el sobre.

**E3 — un miembro malformado falla solo ese evento.**
Dado un lote con un `BUSINESS` cuyo `displayCurrencies` es `["CUP","usd"]` y un
`PRODUCT` válido detrás, cuando se envía, entonces la respuesta es `207`, el
`BUSINESS` está en `failed[]` con `error: "BUSINESS_DISPLAY_CURRENCIES_INVALID"`
y **no** en `ok`, el `PRODUCT` responde `processed`, y la lista guardada del
negocio es **byte a byte la que había antes** (incluida su marca de origen, que
tampoco avanza).

**E4 — un `DELETE` se rechaza y no escribe.**
Dado un negocio con `["CUP","USD"]` guardado y marca `T0`, cuando llega un
`BUSINESS` con `operation: "DELETE"` y `updatedAt: T1 > T0`, entonces ese evento
vuelve en `failed[]` con `error: "BUSINESS_DELETE_NOT_SUPPORTED"`, la lista sigue
siendo `["CUP","USD"]` y la marca sigue siendo `T0` —comprobado leyendo la fila
antes y después—. Vaciar la lista es enviar `[]` (E10), nunca un `DELETE`.

**E5 — un evento rancio responde `stale` y no pisa la lista nueva.**
Dado un negocio con `["CUP","USD"]` y marca `T1`, cuando llega un `BUSINESS`
válido con `updatedAt: T0 ≤ T1` y `displayCurrencies: ["CUP"]`, entonces
`results[].status === "stale"`, el evento viaja en `ok` (no es un error: el POS
no debe reenviarlo), la lista sigue siendo `["CUP","USD"]` y la marca sigue
siendo `T1`. La igualdad cuenta como rancio: la comparación es `>=` (R6).

**E6 — un `DELETE` rancio responde `BUSINESS_DELETE_NOT_SUPPORTED`, no `stale`.**
Dado el mismo negocio de E5, cuando llega un `BUSINESS` con
`operation: "DELETE"` y `updatedAt: T0 ≤ T1`, entonces vuelve en `failed[]` con
`BUSINESS_DELETE_NOT_SUPPORTED`. El rechazo del `DELETE` corre **antes** que la
guarda anti-rancio (R5): un `DELETE` no es una operación de esta entidad en
ningún instante, y responder `stale` lo metería en `ok`, el POS marcaría su
outbox como hecho y **nunca se enteraría** de que esa operación no existe, que es
justo el silencio que el contrato dice evitar («se rechaza en vez de ignorarse en
silencio a propósito»).

**E7 — un evento rancio con un miembro malformado responde el error del miembro.**
Mismo orden que E6: `BUSINESS_DISPLAY_CURRENCIES_INVALID`, no `stale`. Un código
basura tiene que llegarle al POS aunque el evento hubiera sido descartado por
viejo; si no, el reintento posterior con marca nueva vuelve a fallar y nadie
había avisado.

**E8 — una lista con códigos repetidos se guarda deduplicada.**
Dado `displayCurrencies: ["CUP","USD","CUP","EUR","USD"]`, entonces
`status: "processed"`, sin error, y lo guardado es `["CUP","USD","EUR"]`: se
conserva la **primera** aparición de cada código y el orden relativo del payload
(R4). La deduplicación es por **igualdad exacta**, sin plegar mayúsculas (D3).

**E9 — una moneda sin fila en `Currency` ni ninguna tasa no falla y no se crea.**
Dado `displayCurrencies: ["CUP","XTS"]` con `XTS` sin fila en `Currency` y sin
ninguna `ExchangeRate`, entonces `status: "processed"`, lo guardado incluye
`XTS`, y `Currency` **no gana ninguna fila**: ni `XTS`, ni una provisional con
`name` y `symbol` iguales al código. La lista es una declaración del comerciante,
no una lista derivada; lo que no se puede calcular se omite al pintar, y eso es
F-039.

**E10 — la lista vacía se acepta.**
Dado `displayCurrencies: []`, entonces `status: "processed"` y la lista guardada
queda vacía, que significa «solo la moneda base». No es un error, no es un
borrado y no es equivalente a no haber recibido nunca un evento a efectos de lo
que se pinta (que hoy es nada, criterio 11).

**E11 — un `businessId` ajeno rechaza el lote entero.**
Dado un `BUSINESS` cuyo `payload.businessId` no es el `externalId` del token,
cuando se envía —solo o acompañado de eventos válidos—, entonces la respuesta es
`403 {"error":"BUSINESS_MISMATCH"}`, **ninguna** fila de `SyncEvent` queda
escrita y ninguna lista cambia. Sale gratis de `findCatalogMismatch`
(`src/features/sync/identity.ts:27-29`) en cuanto el payload lleve `businessId`
(I6): lo que este feature aporta es la **prueba** de que sigue siendo cierto.

**E12 — cuarenta códigos válidos entran.**
Dado un `displayCurrencies` con 40 códigos válidos distintos, entonces
`status: "processed"` y los 40 quedan guardados en orden. No hay `.max()` en
ningún sitio (R17).

**E13 — reenviar el mismo `eventId` responde `duplicate`.**
Dado un `BUSINESS` ya aplicado (`SyncEvent.status = "PROCESSED"`), cuando se
reenvía el mismo `eventId`, entonces `results[].status === "duplicate"`, viaja en
`ok` y el handler **no se llama**. Un `BUSINESS` que volvió en `failed[]` (E3,
E4) queda `FAILED` y **sí** se reprocesa en la siguiente entrega: un evento
fallido no es un duplicado (AGENTS.md § Cosas que muerden).

**E14 — `BUSINESS` no arrastra ni es arrastrado.**
Dado un lote con una `CATEGORY` que falla y un `BUSINESS` posterior, entonces el
`BUSINESS` se aplica normalmente; y dado un lote con un `BUSINESS` que falla (E3)
y un `PRODUCT`/`EXCHANGE_RATE` posterior, entonces esos se aplican normalmente.
`dependencyRoleOf` devuelve `{ provides: null, requires: null }` para `BUSINESS`
(R12), así que la lista de dependencias del contrato sigue teniendo **dos y solo
dos**.

**E15 — la tienda pública no cambia.**
Dado el catálogo del seed y una página pública cualquiera de él, cuando se
captura su HTML, se aplica un `BUSINESS` con `["CUP","USD","EUR"]` sobre ese
negocio y se vuelve a capturar, entonces los dos HTML son **idénticos**. Este
feature no pinta nada.

**E16 — el primer evento sobre un negocio sin marca entra.**
Dado un negocio cuya marca de origen es `NULL` (nunca recibió un `BUSINESS`, o su
fila es anterior a la migración), cuando llega cualquier `BUSINESS` válido,
entonces se aplica, sea cual sea su `updatedAt` — incluida una marca tan vieja
como `2000-01-01T00:00:00.000Z`, la que ya usa `scripts/send-catalog-batch.mjs`
con `--stale`. Es la misma forma nullable que `Store.sourceUpdatedAt`
(`prisma/schema.prisma:295`) y `LocalCategory.sourceUpdatedAt`
(`prisma/schema.prisma:356`): protege desde la segunda entrega en adelante y no
necesita backfill.

**E17 — dos `BUSINESS` del mismo negocio en el mismo lote.**
Dado un lote con dos eventos `BUSINESS`, `occurredAt` y `updatedAt` crecientes,
entonces los dos responden `processed` y lo que queda guardado es la lista del
**segundo**. El primero escribe y el segundo lo pisa: la guarda solo rechaza lo
que llega con marca menor o igual.

**E18 — `CREATE` y `UPDATE` hacen lo mismo.**
Dado el mismo payload con `operation: "CREATE"` y con `operation: "UPDATE"`, el
resultado es idéntico: el payload trae la lista **completa**, no un delta, así
que no hay nada que distinguir. Solo `DELETE` se comporta distinto (E4).

## Reglas de negocio

**R1 — el sobre gana una sexta rama, y solo una.** `syncEventSchema`
(`src/features/sync/schemas.ts:136`) añade
`{ eventId, entity: z.literal("BUSINESS"), operation, occurredAt, payload }` con
la misma forma que las otras cinco. Cualquier otro valor de `entity` sigue
cayendo en el `invalid_union_discriminator` de Zod y produciendo el
`400 INVALID_BATCH` del route (E2).

**R2 — laxo en el sobre, estricto en el aplicador, y la frontera está aquí.**
`displayCurrencies` se declara `z.array(z.string())`, calcado de `barcodes`
(`src/features/sync/schemas.ts:92`). Lo que decide cada capa:

| Qué llega                                   | Dónde se decide | Qué responde                        |
| ------------------------------------------- | --------------- | ----------------------------------- |
| Falta `displayCurrencies`, o `businessId`   | sobre           | `400 INVALID_BATCH` del lote entero |
| `displayCurrencies: "USD"` (no es lista)    | sobre           | `400 INVALID_BATCH` del lote entero |
| `updatedAt` que no es ISO 8601              | sobre           | `400 INVALID_BATCH` del lote entero |
| `["usd"]`, `["US1"]`, `["€€€"]`, `["USDD"]` | aplicador       | `207` con ese evento en `failed[]`  |
| `operation: "DELETE"`                       | aplicador       | `207` con ese evento en `failed[]`  |

Declararlo `z.array(z.string().length(3))` convertiría un código basura en un
`400` que se lleva los otros 499 eventos del lote: es la decisión de diseño del
feature y sigue el camino que abrió `openingHours` en la v9
(`src/constants/sync.ts:34`). El miembro **no string** (`[123]`, `[null]`) es el
único caso en el que la frontera admite discusión: ver SP2.

**R3 — qué es un código válido (D3, humano, 2026-09-07).** Exactamente **tres
letras mayúsculas A-Z**: `/^[A-Z]{3}$/`. **No se normaliza a mayúsculas** —eso
inventaría una conversión que el contrato no menciona y que el otro lado no
espera— y no se recortan espacios. Motivo del humano: un código que no case con
ninguna fila de `Currency` no se pinta nunca y nadie se entera, y el fallo
silencioso es justo lo que esta entidad viene a evitar. Un solo miembro
malformado hace fallar el evento **entero**: no se guarda la lista sin él.

**R4 — la deduplicación es exacta y estable.** Por igualdad de cadena, byte a
byte, conservando la primera aparición y el orden relativo del resto (E8). El
orden importa: el contrato dice que el escaparate «la respeta en el orden en que
llega». Los duplicados se descartan **sin error**.

**R5 — el orden de las cuatro comprobaciones del handler, fijado aquí.**

1. `operation === "DELETE"` → `BUSINESS_DELETE_NOT_SUPPORTED`.
2. Algún miembro no cumple R3 → `BUSINESS_DISPLAY_CURRENCIES_INVALID`.
3. Guarda anti-rancio (`>=`) → `STALE`.
4. Escritura de la lista deduplicada y de la marca.

Los pasos 1 y 2 son **puros** y corren antes de tocar la base: un evento
malformado no cuesta ni un round-trip. Esto es **lo contrario** de lo que hace
`handleCategory`, donde la guarda corre antes de la rama del `DELETE`
(`src/features/sync/server/handlers/misc.ts:122-131`), y la diferencia no es un
descuido: allí el `DELETE` es una operación **legítima** y la guarda decide si
aplicarla o no; aquí el `DELETE` **no es una operación de la entidad**, es un
evento mal formado, de la misma familia que un código basura. Un error de forma
no puede depender de una marca de tiempo (E6, E7).

**R6 — la guarda es la de RECHAZAR y devolver `STALE`, no la de orden de F-036.**
La misma forma que `STORE` (`…/handlers/store.ts:112-119`), `CATEGORY`
(`…/handlers/misc.ts:122-128`) y `PRODUCT` (`…/handlers/product.ts:87-94`):
`if (marcaGuardada && marcaGuardada.getTime() >= marcaDelPayload.getTime()) return STALE`.
**No** la forma de `EXCHANGE_RATE` (F-036, `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`),
que escribe siempre y decide al leer. La razón es la que separa las dos familias:
la de orden existe porque `ExchangeRate` es **append-only y su histórico es el
producto**, así que hay filas entre las que elegir al leer. `displayCurrencies`
es **una sola columna de una sola fila**, un conjunto que se reemplaza entero:
no hay histórico, no hay nada que elegir al leer, y «escribir siempre» sería
literalmente dejar que gane el último en llegar, que es el fallo que la guarda
existe para evitar. Copiar la forma de una entidad esperando el mecanismo de la
otra es el error que AGENTS.md § Cosas que muerden ficha.

**R7 — el `updatedAt` es el instante en que cambió la lista, y aquí solo se
guarda.** La v12.1 lo fija del lado emisor: no es «la marca de la fila de
origen» —no hay fila de origen, la lista es un conjunto— y **sobre todo no es el
máximo de las marcas de sus filas**, porque **retirar** una moneda haría **bajar**
ese máximo, el evento legítimo que sigue llegaría más viejo que el guardado, se
respondería `stale` y **la retirada no se aplicaría nunca sin que nada fallara**.
De este lado no hay nada que validar: la marca se guarda tal cual y se compara.
Lo que sí hay es una consecuencia para las pruebas: **el escenario de la retirada
(`["CUP","USD"]` → `["CUP"]` con marca creciente) tiene que estar probado**
(E17), porque es el caso que esa trampa habría roto en silencio.

**R8 — dos columnas nuevas en `Business`, y ninguna otra.** Una lista de texto
—único precedente de columna array escalar en todo el schema:
`StoreProduct.imageUrls String[] @default([])`, `prisma/schema.prisma:465`— y una
marca `DateTime?` **nullable y sin `@default`**, por lo mismo que
`ExchangeRate.sourceUpdatedAt` (`prisma/schema.prisma:557`): así no hace falta
backfill y la primera entrega después de la migración entra (E16). Nombres
propuestos: `displayCurrencies String[] @default([])` y
`displayCurrenciesUpdatedAt DateTime?`. El segundo nombre no se llama
`sourceUpdatedAt` a secas a propósito: no es la marca de la fila `Business` —a la
que `handleStore` también escribe `name` y `baseCurrencyCode` sin guarda ninguna
(`…/handlers/store.ts:71-74`)—, es la marca **de esa lista**. El nombre final es
del arquitecto; que sean dos columnas y esa nulabilidad, no.

**R9 — el handler no toca `Currency` ni `ExchangeRate`.** Ni lee ni escribe:
comprobable con el número de filas de `Currency` antes y después (E9, criterio 7).
Es la diferencia deliberada con `handleExchangeRate`, que sí hace un `upsert`
provisional (`…/handlers/misc.ts:230-234`) porque tiene una clave ajena que
satisfacer; aquí la lista es texto suelto, sin `@relation`, y eso es a propósito:
una moneda declarada por el comerciante que todavía no tiene su `CURRENCY` es un
estado **normal y transitorio**, no un error.

**R10 — el handler no toca ningún otro campo de `Business`.** Ni `name`, ni
`baseCurrencyCode`, ni `active`, ni `syncTokenHash`. Los dos primeros son de
`STORE` y siguen siéndolo.

**R11 — se escribe sobre `caller.businessId`, nunca sobre el `businessId` del
payload.** El payload lo lleva porque el contrato lo exige y porque
`findCatalogMismatch` lo comprueba, pero es **redundante y comprobado, no
autoritativo** (F-018). El `where` va por el uuid interno que ya trae
`applyEvent` (`src/features/sync/server/processBatch.ts:159-176`).

**R12 — ninguna dependencia de lote nueva.** `dependencyRoleOf` gana
`case "BUSINESS": return { provides: null, requires: null }`. **Hay que tocar ese
archivo aunque no haga nada**: su `default` exhaustivo
(`const exhaustive: never`, `src/features/sync/dependencies.ts:65-68`) pone
`npm run typecheck` en rojo **nombrando la entidad** en cuanto el union crece, y
eso es la señal que su comentario anuncia, no un estorbo. La lista de
dependencias del contrato (v11 ③) sigue teniendo dos.

**R13 — este feature no invalida caché.** Ningún `revalidateStores`,
`revalidateSlugs`, `revalidateStorefronts` ni `revalidateProducts`, y por tanto
el `HandlerOutcome` que devuelve es `PROCESSED` pelado
(`src/features/sync/server/handlers/types.ts:57`). Motivo: no hay lector, así que
no hay página a la que le pueda quedar vieja (criterio 11). **Advertencia para
F-039**: el día que exista el lector, la invalidación tiene que llegar **con él**
o una página cacheada servirá la lista anterior hasta el techo de 3600 s. Ver
SP1.

**R14 — las dos constantes de la v12, con la forma que ya tiene el archivo.**
`BUSINESS_DISPLAY_CURRENCIES_INVALID` y `BUSINESS_DELETE_NOT_SUPPORTED` en
`src/constants/sync.ts`, que es un módulo de constantes `string` —no un enum—
igual que `STORE_OPENING_HOURS_INVALID` (`src/constants/sync.ts:34`) y
`DEPENDENCY_FAILED_IN_BATCH` (`src/constants/sync.ts:61`). Las cadenas viajan
**exactas, sin adornos**: nada de `BUSINESS_DISPLAY_CURRENCIES_INVALID: usd`, ni
el índice del miembro, ni el código. El POS compara contra la cadena literal de
la tabla del § Vocabulario de errores. El detalle, si se quiere, va a un
`console.warn` (R21). Las pruebas **importan la constante**, nunca copian la
cadena.

**R15 — ningún estado nuevo ni ningún campo nuevo en la respuesta.**
`EVENT_STATUS` (`src/features/sync/schemas.ts:199-205`) y `HandlerOutcome`
(`src/features/sync/server/handlers/types.ts:6`) no cambian: `stale` ya existe y
los dos errores viajan por `SyncEventFailure`
(`src/features/sync/server/handlers/types.ts:71`), que el `catch` de siempre
convierte. Añadir un miembro `"failed"` al `HandlerOutcome` caería en el `else`
de `processBatch.ts` sin error del compilador y el evento se reportaría en `ok`
—el bug que AGENTS.md ficha como «un evento fallido NO es un duplicado»—.

**R16 — la migración, y la trampa que trae.** Una sola migración con
`ALTER TYPE "SyncEntity" ADD VALUE 'BUSINESS'` y las dos columnas de R8. Dos
cosas que ya mordieron aquí: (a) `prisma migrate dev` propone `DROP INDEX` de los
cinco índices GIN y parciales que no se representan en el schema, **en un diff
que no tiene nada que ver**; hay que quitarlos del `migration.sql` a mano, con la
nota que el precedente ya escribió
(`prisma/migrations/20260830170714_order_renegotiation/migration.sql:19-26`);
(b) `prisma migrate reset` y `prisma db push` están **prohibidos** (AGENTS.md
§ Comandos prohibidos): si la migración parece necesitar uno de los dos, se
pregunta.

**R17 — sin tope de longitud, a propósito.** Ni en el schema del sobre, ni en el
handler, ni en la columna. Un tope convierte un dato que el POS no puede cambiar
en un `400` permanente — la misma razón por la que `barcodes` no lo tiene desde
la v4. El único tope que sigue existiendo es el del lote:
`MAX_CATALOG_EVENTS = 500` (`src/features/sync/schemas.ts:17`).

**R18 — la comprobación de identidad no se toca, se prueba.** `findCatalogMismatch`
funciona con `BUSINESS` **sin cambiar una línea** porque su condición es
`"businessId" in event.payload` (`src/features/sync/identity.ts:27-29`) y el
payload lo lleva. Lo que este feature añade es la prueba que lo fija (criterio 9,
E11) y la línea del union de tipos que hace que TypeScript lo estreche bien.

**R19 — el contrato sube a v12.2, menor (D1, humano, 2026-09-07).** Retirar el
aviso de que `entity` todavía no acepta `BUSINESS` **no cambia ninguna ruta,
campo, enum ni regla**: solo dice que el lado receptor ya está en pie. La **v13
queda reservada para las zonas (S-007 / F-041)**, que ya está anunciada como tal
en la propia v12 (§ «Lo que NO entra en la v12») y en `.agent/solicitudes.md`.
Son **tres** los sitios que dejan de ser ciertos, no uno (I9), y toda edición
mueve la versión de la primera línea, con su línea en «Cambios respecto a la
v12.1» y el hook `.claude/hooks/sync-contract-version.sh` vigilando.

**R20 — el aviso a cuadrecaja se escribe aquí y lo traslada el humano (D2).** Va
en la nueva versión del contrato **y** en una línea fechada de
`.agent/solicitudes.md`, en la entrada **S-008 de § «Cerradas»** —añadida, no
sustituyendo el registro de lo que se publicó el 2026-09-06—. Su
`.agents/solicitudes-qab.md` **no se edita desde aquí**: es de su repo.

**R21 — instrumentación con `console.warn` y prefijo `[sync]`.** Nunca
`console.error`: las etapas que levantan la app comparan la salida cruda de
`next dev` contra `SERVIDOR_ERROR_RE` y una línea con esa forma marca la etapa
como «el servidor se cayó» aunque todo haya respondido bien (ficha
`.agent/playbook/console-error-dispara-guardian-servidor.md`). Que haga falta un
log es del arquitecto; su forma, no.

**R22 — la bandera del guion de humo compone con las que ya hay.**
`--business[=caso]`, con la misma forma que `--store-config[=caso]`
(`scripts/send-catalog-batch.mjs:64-71`): añade un evento `BUSINESS` al lote que
el guion ya envía. Casos mínimos: `ok` (por defecto), `invalid`, `delete`,
`empty`, `dup`, `forty`. Los cuatro desenlaces del criterio 12 salen de
componerla con lo que el guion ya sabe hacer: `processed` con `--business`,
`failed` con `--business=invalid` o `=delete`, `stale` con
`--business --stale`, y `duplicate` con `--business --repeat` corrido dos veces
(el `eventId` se vuelve fijo, `scripts/send-catalog-batch.mjs:59`). La salida ya
imprime `HTTP <status>` y el JSON entero con `results[]`, así que los cuatro se
distinguen a simple vista.

## Casos límite y errores

| Caso                                                                | Qué tiene que pasar                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayCurrencies` ausente                                         | `400 INVALID_BATCH` del lote entero: es obligatorio en el contrato y su presencia es forma del sobre (R2)                                                                                                                                                                                                  |
| `displayCurrencies: [123]` o `[null]`                               | `400` con el defecto de R2 (`z.array(z.string())`, como `barcodes`). Es la única frontera discutible del feature: SP2                                                                                                                                                                                      |
| `["CUP", "cup"]`                                                    | `failed[]` con `BUSINESS_DISPLAY_CURRENCIES_INVALID`: `cup` no cumple R3 y **no** se pliega a mayúsculas (D3). Nada se guarda                                                                                                                                                                              |
| `["CUP", "CUP"]`                                                    | `processed` con `["CUP"]` guardado (R4). Duplicado no es error                                                                                                                                                                                                                                             |
| `[""]`, `["  "]`, `["USD "]`                                        | `failed[]`: ninguno cumple `/^[A-Z]{3}$/`, y no se recorta (R3)                                                                                                                                                                                                                                            |
| Lista con 40 códigos (criterio 10)                                  | `processed`, los 40 guardados. Sin tope en ninguna capa (R17)                                                                                                                                                                                                                                              |
| Negocio que nunca recibió un `BUSINESS`                             | Columna con su `@default([])` y marca `NULL`. El primer evento entra sea cual sea su marca (E16). Indistinguible de un `[]` explícito, y da igual: significan lo mismo para quien lea (F-039)                                                                                                              |
| `DELETE` sobre un negocio sin lista guardada                        | Igual que E4: `failed[]` con `BUSINESS_DELETE_NOT_SUPPORTED`. No hay rama «no había nada que borrar»                                                                                                                                                                                                       |
| Criterio 3, «la lista guardada queda como estaba», si no había nada | Se lee como «este lote no la escribe»: sigue con su `@default([])` y su marca `NULL` (I5)                                                                                                                                                                                                                  |
| Dos `BUSINESS` del mismo lote con `occurredAt` idéntico             | El `sort` de `recordBatch` es estable (`src/features/sync/server/inbox.ts:64`), así que gana el último del array; y si sus `updatedAt` también empatan, el segundo responde `stale` por el `>=` (R6). Determinista, y nada se corrompe                                                                     |
| `BUSINESS` de un lote que además trae 499 `PRODUCT`                 | Ningún round-trip nuevo por evento ajeno: el handler solo corre para su propio evento                                                                                                                                                                                                                      |
| `error.message` de los dos códigos                                  | 35 y 30 caracteres; `markFailed` recorta a 500 (`src/features/sync/server/inbox.ts:92`): nunca se recortan                                                                                                                                                                                                 |
| El evento falla y se reintenta sin corregir                         | Vuelve a fallar, con el mismo código. Queda `FAILED` en el inbox y **no** se reporta como `duplicate` (E13)                                                                                                                                                                                                |
| La base se cae a mitad del lote                                     | El `catch` de siempre lo reporta `failed`; nada quedó a medias porque la escritura es un solo `update` de una fila                                                                                                                                                                                         |
| Guion de humo sobre el seed                                         | `--business` deja la lista escrita en `seed-negocio-1`. Hoy es inocuo (nadie la lee) y por eso el caso por defecto manda las **tres monedas reales del seed** (`CUP`, `USD`, `MLC`): un residuo veraz. `=forty` deja basura — se restaura corriendo `--business` otra vez, que lleva marca nueva y la pisa |

## Datos y contrato

El `payload` de `BUSINESS` ya está publicado en `docs/sync-contract.md`
§ «`payload` de `BUSINESS` (v12)» (~L1416-1480) y esta spec solo obedece:

```jsonc
{
  "businessId": "uuid", // tiene que coincidir con el del token
  "displayCurrencies": ["CUP", "USD", "EUR"],
  "updatedAt": "2026-09-06T14:03:00.000Z", // instante en que cambió la LISTA
}
```

| Campo               | Tipo       | Obligatorio | Dónde se valida                     | Qué pasa si está mal                          |
| ------------------- | ---------- | ----------- | ----------------------------------- | --------------------------------------------- |
| `businessId`        | `string`   | sí          | sobre + route                       | `400 INVALID_BATCH` / `403 BUSINESS_MISMATCH` |
| `displayCurrencies` | `string[]` | sí          | sobre (tipo) + aplicador (miembros) | `400` / `207 failed[]`                        |
| `updatedAt`         | ISO 8601   | sí          | sobre                               | `400 INVALID_BATCH`                           |

Lo que cambia de nuestro lado:

| Pieza                                                  | Hoy                                                           | Después                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/features/sync/schemas.ts:136`                     | Cinco entidades                                               | Seis: `+ BUSINESS`, con `businessPayloadSchema` laxo (R1, R2)     |
| `src/constants/sync.ts`                                | Cinco constantes, ninguna de la v12                           | + los dos códigos de la v12 (R14)                                 |
| `prisma/schema.prisma:89-95`                           | `enum SyncEntity` con cinco valores                           | + `BUSINESS` (R16)                                                |
| `prisma/schema.prisma:126-153`                         | `Business` sin lista ni marca                                 | + `displayCurrencies String[] @default([])` y su `DateTime?` (R8) |
| `src/features/sync/server/processBatch.ts:159-176`     | `switch` de cinco ramas                                       | Seis ramas                                                        |
| handlers                                               | `store` · `product` · `misc` (tres)                           | + business.ts (por crear)                                         |
| `src/features/sync/dependencies.ts:49-68`              | Cinco `case` + `never`                                        | + `case "BUSINESS"` con las dos columnas a `null` (R12)           |
| `src/features/sync/identity.ts:19`                     | Comprueba lo que lleve `businessId`                           | **Sin cambios** — ya lo cubre (R18, I6)                           |
| `scripts/send-catalog-batch.mjs`                       | Siete banderas                                                | + `--business[=caso]` (R22)                                       |
| `docs/sync-contract.md`                                | v12.1, con el aviso en tres sitios                            | **v12.2**, menor, con los tres retirados (R19, I9)                |
| `.agent/solicitudes.md`                                | S-008 en «Cerradas»                                           | + una línea fechada con el aviso (R20)                            |
| `AGENTS.md` § Cosas que muerden                        | «rechaza y devuelve `STALE` (`STORE`, `CATEGORY`, `PRODUCT`)» | + `BUSINESS` en esa enumeración (I8)                              |
| `src/app/`, `src/components/`, `src/features/catalog/` | —                                                             | **Sin cambios** (criterio 11, R13)                                |

## Criterios de aceptación propuestos

Los catorce son los de `.agent/features.json`, sin tocar ni una palabra (regla
3). Dónde vive cada verificación:

- **Unidad del sobre** en `src/features/sync/schemas.test.ts` (qué acepta y qué
  no) y de la identidad en `src/features/sync/identity.test.ts`.
- **Unidad del handler** con Prisma mockeado, en la línea de
  `src/features/sync/server/handlers/misc.test.ts`: el orden de R5 y qué se
  llama y qué no.
- **Postgres real a través del `POST` de verdad**, en la línea de
  `src/features/sync/server/handlers/product.db.test.ts`: qué queda en la fila.
  Corre en el proyecto `db` de `vitest.config.mts`, que necesita el Postgres de
  `docker-compose.yml` levantado y migrado. El reparto exacto de archivos nuevos
  es del arquitecto (§ No decidido, 2).
- **Runtime**, con `scripts/send-catalog-batch.mjs` contra `next dev`.

**C1 `[ya]`** — «Un lote con un evento de entity BUSINESS y una lista valida
responde 207 con ese evento en ok y status processed, y la lista queda guardada
para ese negocio, verificado leyendo la fila.»
E1, en el `*.db.test.ts`: `response.status === 207`, `body.ok` contiene el
`eventId`, `body.results` lo trae con `status: "processed"`, y
`prisma.business.findUnique({ where: { id } })` devuelve la lista exacta y la
marca. Se afirma sobre el **array completo y en orden**, no sobre `includes`.

**C2 `[ya]`** — «Un evento con un entity que el contrato no define (por ejemplo
ZONE_TARIFF) sigue respondiendo 400 INVALID_BATCH del lote entero: aceptar
BUSINESS no abre el sobre a cualquier cosa.»
E2. En unidad: `syncEventSchema.safeParse({ entity: "ZONE_TARIFF", … }).success`
es `false`. Contra el `POST`: `400`, `body.error === "INVALID_BATCH"`, y
`prisma.syncEvent.count({ where: { eventId: { in: [losDos] } } })` vale `0`, con
el `PRODUCT` válido del mismo lote sin fila escrita. Doble valor: `ZONE_TARIFF`
es vocabulario de la **v13**, así que este test es también la guarda de que no se
cuela antes de tiempo (I3).

**C3 `[ya]`** — «Un miembro malformado de displayCurrencies devuelve SOLO ese
evento en failed[] con BUSINESS_DISPLAY_CURRENCIES_INVALID, el resto del lote se
aplica, y la lista guardada queda como estaba.»
E3, contra el `POST`: `207`; `body.failed` tiene **exactamente una** entrada, con
`error` igual a la constante **importada** de `src/constants/sync.ts`;
`body.ok` contiene el `eventId` del `PRODUCT` y no el del `BUSINESS`; la fila del
negocio conserva lista y marca. Se siembra una lista previa con un primer
`BUSINESS` válido, para que «como estaba» tenga contenido y no sea el vacío (I5).
Casos parametrizados: `"usd"`, `"US1"`, `"€€€"`, `"USDD"`, `""`.

**C4 `[ya]`** — «Un BUSINESS con operation DELETE devuelve failed[] con
BUSINESS_DELETE_NOT_SUPPORTED y no escribe nada, comprobado leyendo la lista
antes y despues.»
E4: se lee la fila, se envía el `DELETE`, se vuelve a leer; lista y marca
idénticas, y `body.failed[0].error` igual a la constante importada. Y la variante
de E6 (`DELETE` con marca rancia) afirmando que **no** responde `stale`, que es
lo que fija el orden de R5.

**C5 `[ya]`** — «Un BUSINESS con updatedAt menor o igual al guardado responde
stale, viaja en ok y no pisa la lista nueva.»
E5, contra el `POST`, con los **dos** bordes: `<` y `==`. Se afirma
`results[].status === "stale"`, `body.ok` lo contiene, `body.failed` está vacío,
y la fila conserva lista y marca. Y el escenario que R7 exige: una **retirada**
(`["CUP","USD"]` → `["CUP"]` con marca creciente) que **sí** se aplica — el caso
que la lectura mala del `updatedAt` habría roto en silencio.

**C6 `[ya]`** — «Una lista con codigos repetidos se guarda deduplicada y responde
processed, sin error.»
E8: entra `["CUP","USD","CUP","EUR","USD"]`, queda `["CUP","USD","EUR"]` —el
aserto es sobre el array **en orden**, que es lo que prueba que la dedup es
estable— y `body.failed` está vacío.

**C7 `[ya]`** — «Un BUSINESS que cita una moneda que no tiene fila en Currency ni
ninguna tasa responde processed: no falla y no crea ninguna moneda provisional.»
E9. `Currency` es **global a la plataforma** y la comparten los demás
`*.db.test.ts` y los guiones de humo, así que el código sintético es **propio de
la prueba** y no puede ser ninguno de los ya tomados: ni `CUP`/`USD`/`MLC` (seed),
ni `QAB` (F-035), ni `ZZZ` (F-027), ni `WVX`
(`src/features/catalog/server/rates.db.test.ts:47`). Se afirma
`prisma.currency.findUnique({ where: { code } })` → `null` **después** del lote y
`prisma.exchangeRate.count({ where: { currencyCode } })` → `0`. Como este handler
no escribe nada en esas tablas, la prueba **no necesita limpiar** — y esa
ausencia de limpieza es justamente lo que demuestra el criterio.

**C8 `[ya]`** — «displayCurrencies con lista vacia se acepta y deja la lista
vacia, que significa 'solo la moneda base'.»
E10: se siembra `["CUP","USD"]`, se envía `[]` con marca mayor, y la fila queda
con array de longitud `0` y `status: "processed"`.

**C9 `[ya]`** — «Un BUSINESS cuyo businessId no es el del token responde 403
BUSINESS_MISMATCH del lote entero y no escribe nada.»
E11, en dos capas: unidad en `src/features/sync/identity.test.ts` —un evento
`BUSINESS` con otro `businessId` devuelve `events[0].payload.businessId`— y
contra el `POST`: `403`, `body.error === "BUSINESS_MISMATCH"`, y
`prisma.syncEvent.count({ where: { eventId } })` → `0`, que es lo que prueba que
abortó **antes** de `recordBatch` y que ningún reintento lo verá como
`duplicate`. Sale gratis (I6): el criterio se cumple sin tocar `identity.ts`.

**C10 `[ya]`** — «Cuarenta codigos validos en la misma lista se aceptan: no hay
tope de longitud.»
E12: 40 códigos generados, `processed`, y la fila con `length === 40` y el mismo
orden. Se generan con letras A-Z (`AAA`, `AAB`, …), nunca códigos ISO reales, que
no hacen falta y confundirían a quien lea el test.

**C11 `[ya]`** — «Este feature no pinta nada en la tienda publica: las paginas de
la tienda del seed muestran exactamente lo que mostraban antes, comprobado con el
mismo catalogo.»
E15, en dos formas, porque «antes» no es capturable una vez el código está
escrito: (a) **estática**, `git diff --stat main -- src/app src/components
src/features/catalog src/features/storefront` **vacío** al cerrar; y (b)
**dinámica**, con `next dev` levantado: `curl -s` de una página del seed, un
`POST` con un `BUSINESS` de `["CUP","USD","EUR"]` sobre ese negocio, y otro
`curl -s` de la misma página — los dos cuerpos **idénticos** (`diff` con código
0). La segunda es la que de verdad demuestra el criterio, y encaja en
.agent/specs/F-038/smoke.sh (por crear) si el arquitecto decide que este feature
tenga guion propio (§ No decidido, 3). Con `npm test` verde además: ninguna
prueba de UI cambia.

**C12 `[ya]`** — «node scripts/send-catalog-batch.mjs gana una bandera que envia
un BUSINESS contra el servidor levantado y su salida distingue processed, stale,
failed y duplicate.»
R22. Se ejecuta, con `next dev` levantado y `QAB_BEARER_TOKEN` del negocio del
seed:

```bash
node scripts/send-catalog-batch.mjs --business              # processed
node scripts/send-catalog-batch.mjs --business=invalid      # failed  BUSINESS_DISPLAY_CURRENCIES_INVALID
node scripts/send-catalog-batch.mjs --business=delete       # failed  BUSINESS_DELETE_NOT_SUPPORTED
node scripts/send-catalog-batch.mjs --business --stale      # stale
node scripts/send-catalog-batch.mjs --business --repeat     # processed
node scripts/send-catalog-batch.mjs --business --repeat     # duplicate
```

Cada línea imprime `HTTP 207` y el JSON con la entrada de `results` del evento
`BUSINESS` en el estado esperado. Es también el guion propio que
`docs/sync-contract.md` § Verificación dice que la v12 «tendrá cuando exista»
(I9).

**C13 `[ya]`** — «Al cerrarlo: se retira de la cabecera de docs/sync-contract.md
el aviso de que entity todavia no acepta BUSINESS, se mueve la version del
documento, y se avisa al equipo de cuadrecaja de que ya pueden dejar de filtrar
el evento en su drenaje.»
Tres acciones, con D1 y D2 (R19, R20), y el aviso está en **tres** sitios, no en
uno (I9):

1. `docs/sync-contract.md` L10-12 (cabecera), § «Cambios requeridos en
   cuadrecaja» → «De la v12», punto 1 (~L2432-2436), y § Verificación
   (~L2644-2650, «la v12 lo hará con el suyo cuando exista» + el bloque de
   comandos, que gana las líneas de C12).
2. Primera línea a **12.2**, con su § «Cambios respecto a la v12.1». Verificable:
   `head -3 docs/sync-contract.md | grep -c '12.2'` → `1`, y un `grep -c` de la
   frase «todavía no admite» sobre `docs/sync-contract.md` → `0`.
3. Una línea fechada en `.agent/solicitudes.md`, en la entrada S-008 de
   § «Cerradas». El traslado a su repo lo hace el humano.

**C14 `[ya]`** — «bash .agent/verify.sh F-038 --full termina con codigo 0.»
Tal cual: `harness typecheck lint format test prisma build theme bundle`. Cuatro
recordatorios para no perder un ciclo: (a) la etapa `harness` se pone roja tanto
por citar entre comillas invertidas un archivo que **aún no existe** —el handler
nuevo, la migración, el `*.db.test.ts` nuevo: se escriben **sin** comillas
invertidas y con `(por crear)` detrás, y ganan sus comillas cuando existan— como
por citar **abreviada** la ruta de uno que sí existe; (b) `npm run format` sobre
lo que se escriba en `.agent/`, porque `format:check` es lo que valida el CI, y
**sin formatear a ciegas documentos ajenos**; (c) `npm test` incluye el proyecto
`db`, que necesita el Postgres de `docker-compose.yml` levantado y **migrado con
la migración nueva**; (d) la etapa `prisma` no corre `migrate deploy`: que la
migración aplique limpio se comprueba localmente.

## Incongruencias detectadas

**I1 — el contrato publica una entidad y dos códigos de error que el código no
tiene.** No es un error del contrato: es deliberado y está avisado en su cabecera
(«está acordado y publicado **antes** de estar implementado»). Inventario exacto
de lo que falta hoy:

| Publicado en el contrato              | Estado en el código                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `entity: "BUSINESS"`                  | Ausente del union (`src/features/sync/schemas.ts:136`) → `400`                     |
| `SyncEntity.BUSINESS`                 | Ausente del enum de la base (`prisma/schema.prisma:89-95`)                         |
| `BUSINESS_DISPLAY_CURRENCIES_INVALID` | Ausente de `src/constants/sync.ts` (que tiene cinco constantes, ninguna de la v12) |
| `BUSINESS_DELETE_NOT_SUPPORTED`       | Ausente de `src/constants/sync.ts`                                                 |
| `displayCurrencies` guardado          | `Business` (`prisma/schema.prisma:126-153`) no tiene lista ni marca                |

Consecuencia para quien escriba los artefactos siguientes: mientras esos archivos
no existan, **no se citan entre comillas invertidas** (business.ts, la migración,
los tests nuevos), o `npm run check:harness` los da por referencias muertas y
pone `--full` en rojo — ya pasó en F-011 y F-017 (AGENTS.md § Cosas que muerden).
El check tiene una exención por feature no cerrado
(`scripts/check-harness.mjs:110-116`), pero **no se depende de ella**: desaparece
en cuanto F-038 pasa a `passes: true`.

**I2 — el criterio 2 y el criterio 3 parecen contradecirse y no lo hacen: son las
dos capas de la misma validación.** El 2 exige que un `entity` desconocido siga
matando el lote entero (laxitud cero en el sobre para el **vocabulario**); el 3
exige que un miembro malformado falle solo su evento (laxitud total en el sobre
para el **contenido**). La frontera está escrita en R2 con su tabla: tipo y
presencia en Zod → `400`; forma del miembro y `operation` en el handler → `207
failed[]`. El único caso que la tabla resuelve por defecto y admite discusión es
el miembro **no string** (SP2).

**I3 — el ejemplo del criterio 2 es vocabulario de la v13.** `ZONE_TARIFF` es la
entidad acordada para las zonas (S-007), **cerrada de diseño y todavía no
publicada** (`docs/sync-contract.md` § «Lo que NO entra en la v12»;
`.agent/solicitudes.md` § Abiertas, fila S-007). No es una incoherencia: es una
elección afortunada, porque el test se convierte en la guarda de que ese
vocabulario no entra antes que su feature (F-041). Se anota para que nadie lo
lea como «hay que soportarlo».

**I4 — el criterio 5 dice `stale` y no dice cuál de las dos guardas.** Hay dos
formas en este repo y **no son intercambiables** (AGENTS.md § Cosas que muerden):
rechazar-y-`STALE` (`STORE`, `CATEGORY`, `PRODUCT`) y la de orden de
`EXCHANGE_RATE` (F-036, ADR 0030), que escribe siempre y decide al leer. R6 fija
la primera, con el motivo: la de orden solo tiene sentido sobre una tabla
append-only cuyo histórico es el producto, y aquí hay **una columna de una fila**.
La trampa que hace esto crítico es de la v12.1 y la vio el arné de cuadrecaja: si
el emisor mandara como `updatedAt` el **máximo** de las marcas de las filas de la
lista, **retirar** una moneda bajaría ese máximo y la retirada no se aplicaría
jamás, en silencio (R7). De nuestro lado no se puede detectar; lo que sí se puede
—y R7 exige— es **probar el escenario de la retirada** (C5).

**I5 — el criterio 3 dice «la lista guardada queda como estaba», y eso solo es
literal si había algo guardado.** Si el negocio nunca recibió un `BUSINESS`, la
columna está en su `@default([])` y la marca en `NULL`: lo que el feature
garantiza es que **este lote no la escribe**. No se toca el criterio (regla 3); se
verifica en su forma fuerte —sembrando una lista antes— y en la débil. Es la
misma forma que la I2 de `.agent/specs/F-037/spec.md`.

**I6 — el criterio 9 ya está cubierto por código que existe, y hay que
comprobarlo igualmente.** `findCatalogMismatch` recorre los payloads con
`"businessId" in event.payload` (`src/features/sync/identity.ts:27-29`), así que
`BUSINESS` entra en la comprobación **el mismo día que entra en el union**, sin
tocar una línea de ese archivo. Verificado leyendo el archivo, no supuesto. Lo
único que hay que hacer es **escribir el test** (C9) — y no borrar por
«simplificación» la condición `in`, que es lo que hace esto automático para
`BUSINESS` y sigue excluyendo a `CURRENCY`, que no lleva `businessId`.

**I7 — el criterio 11 convierte este feature en solo-escritura, y eso deja una
deuda con nombre.** Se guarda la lista y **nadie la lee**. Consecuencia directa:
no hay invalidación de caché (R13), y el día que F-039 traiga el lector, la
invalidación tiene que llegar **con él** o una página cacheada servirá la lista
vieja hasta el techo de 3600 s — el mismo agujero que F-035 cerró para las tasas
(«revalida solo lo que se escribe, no lo que cambia de significado»). Queda
escrito aquí porque es exactamente el tipo de cosa que nadie recuerda dos
features después. Ver SP1.

**I8 — AGENTS.md enumera las entidades de cada forma de guarda y esa lista se
queda corta.** § Cosas que muerden: «la que **rechaza** y devuelve `STALE`
(`STORE`, `CATEGORY`, `PRODUCT`)». Con F-038 son cuatro. La corrección es una
línea y va **en el mismo commit que el código**, como hizo F-036 al añadir la
forma de orden.

**I9 — el aviso que el criterio 13 manda retirar está en tres sitios del
contrato, no solo en la cabecera.** Retirar solo el primero deja el documento
diciendo dos cosas falsas:

1. **Cabecera**, L10-12: «un evento `BUSINESS` todavía responde
   `400 INVALID_BATCH`, porque `entity` aún no admite ese valor — no lo emitáis
   hasta el aviso».
2. **§ «Cambios requeridos en cuadrecaja» → «De la v12»**, punto 1 (~L2432-2436):
   «No lo emitáis hasta que se avise… `entity` todavía no admite `BUSINESS`… se
   lleva el lote entero por delante». Es **el sitio que el otro equipo lee para
   saber qué hacer**, así que es el más caro de olvidar.
3. **§ Verificación** (~L2644-2650): «Ni la v11 ni la v12 tienen guion propio…
   la v12 lo hará con el suyo cuando exista» — y con C12 ya existe, así que ese
   párrafo gana las líneas de `--business` en su bloque de comandos.

Los tres van en la misma edición, que es la v12.2 (D1). Nada de esto cambia una
ruta, un campo, un enum ni una regla: sigue siendo **menor**, y **la v13 sigue
reservada para las zonas**.

## Huecos y preguntas al humano

Las dos están escritas **no bloqueantes a propósito**: cada una lleva su decisión
por defecto ya escrita como regla, así que el arquitecto y el implementador
pueden seguir sin esperar respuesta. Por eso este documento cierra en
`estado: listo`, con el mismo criterio que `.agent/specs/F-036/spec.md` y
`.agent/specs/F-037/spec.md`. Las tres decisiones que el humano ya tomó el
2026-09-07 —la versión del contrato (D1, R19), cómo se avisa a cuadrecaja (D2,
R20) y qué es un código malformado (D3, R3/R4)— están incorporadas y no se
vuelven a preguntar.

**SP1 — ¿la escritura de la lista invalida la caché de las sucursales del
negocio, o eso llega con F-039?**
Qué falta: decidir si el handler devuelve `touchedStoreSlugs` como hacen
`handleCurrency` y `handleExchangeRate` (`…/handlers/misc.ts:199`, F-035) o el
`PROCESSED` pelado. Por qué importa: si no lo hace ahora y F-039 tampoco lo
añade, la primera página cacheada servirá la lista vieja hasta 3600 s, que es el
agujero que F-035 vino a cerrar para las tasas. Por qué no bloquea: hoy **nadie
lee la lista**, así que la diferencia es literalmente invisible (criterio 11).
Opciones: (a) no invalidar, y que F-039 lo traiga junto con su lector —defecto,
R13—; (b) invalidar ya, reutilizando el memo por lote
`createRenderableBranchLookup` (`src/features/sync/server/businessBranches.ts`),
que es una línea y deja el problema resuelto para siempre. **Recomendación: (a)**,
porque invalidar sin lector es coste puro y porque el criterio 11 quiere este
feature inerte de cara al público; el riesgo real de (a) es el olvido, y contra
eso está I7 y esta pregunta, que F-039 hereda.

**SP2 — un miembro que no es una cadena (`[123]`, `[null]`), ¿mata el lote o
falla solo su evento?**
Qué falta: elegir el tipo del array en el sobre. Por qué importa: con
`z.array(z.string())` un `[123]` da `400 INVALID_BATCH` y **se lleva los otros
499 eventos del lote**, que es exactamente el daño que la decisión de diseño del
feature dice evitar; con `z.array(z.unknown())` todo miembro raro cae en el
aplicador y vuelve como `BUSINESS_DISPLAY_CURRENCIES_INVALID` de ese evento. Por
qué no bloquea: el contrato declara `string[]` y D3 define «malformado» sobre
cadenas, así que el defecto es defendible y está escrito. Opciones:
(a) `z.array(z.string())`, calcado de `barcodes` (`src/features/sync/schemas.ts:92`)
—defecto, R2—; (b) `z.array(z.unknown())` en el sobre y un `typeof x === "string"`
más en el aplicador, con lo que **ningún** contenido de la lista puede matar un
lote. **Recomendación: (b) si el humano quiere coherencia con el motivo, (a) si
la quiere con el tipo publicado.** Me inclino por (a) por una razón concreta: es
el precedente del repo, y un POS que emita números en un campo declarado
`string[]` tiene un bug de serialización que afecta a más campos que este — un
`400` ruidoso lo encuentra antes. Cambiar a (b) cuesta una línea del schema y una
condición del handler, y solo mueve R2 y una fila de § Casos límite.

## No decidido a propósito

1. **El nombre exacto de las dos columnas** y si la marca se llama
   `displayCurrenciesUpdatedAt` u otra cosa. Del arquitecto. Lo que no se
   negocia: que sean **dos** columnas y que la marca sea `DateTime?` sin
   `@default` (R8).
2. **El reparto de las pruebas entre archivos** —extender
   `src/features/sync/server/handlers/misc.test.ts` o abrir uno nuevo, y en qué
   `*.db.test.ts` viven C1-C10—. Del arquitecto y del `sdd-tester`.
3. **Si F-038 tiene guion de humo propio** (.agent/specs/F-038/smoke.sh, por
   crear) o si C11(b) y C12 se ejecutan a mano con `next dev` levantado. El
   criterio 14 pide `--full`, que **no** incluye la etapa `smoke`
   (`.agent/verify.sh:62`), así que no es obligatorio. Del arquitecto.
4. **Si el handler emite un `console.warn` de diagnóstico** cuando rechaza. R21
   fija su forma si existe; que haga falta, no.
5. **Cómo se dedupe** (un `Set` con orden de inserción, un `filter` con
   `indexOf`): da igual mientras cumpla R4. Del implementador.
