---
feature: F-037
agente: sdd-spec
actualizado: 2026-09-07T19:00:43Z
estado: listo
---

> Nace de la **S-006** de cuadrecaja (`.agent/solicitudes.md` § «S-004, S-005 y
> S-006 · Las tres reglas que cambió la v11»), aceptada **con una corrección de
> alcance**: de las dos dependencias que ellos nombran, `CURRENCY → PRODUCT`
> **no existe de este lado**. La regla ya está publicada y es **vinculante**:
> `docs/sync-contract.md` § «Cambios respecto a la v10.1» ③ y la fila
> `DEPENDENCY_FAILED_IN_BATCH` del § Vocabulario de errores. Esta spec se ajusta
> al contrato, no al revés. Hermanos de la misma v11, ya en pie:
> `.agent/specs/F-035/spec.md` (la caché) y `.agent/specs/F-036/spec.md` (la
> tasa vigente).

## Problema

El bucle de `processCatalogBatch` (`src/features/sync/server/processBatch.ts:69`)
aplica cada evento **como si fuera el único**: lo que pasó con el anterior no
condiciona al siguiente. Con eso, un lote en el que la `CATEGORY` falla y el
`PRODUCT` que la referencia va detrás deja **el producto publicado y mal**:
`resolveLocalCategory` (`src/features/sync/server/handlers/product.ts:291-304`)
no encuentra la fila, devuelve `null`, el producto se guarda con
`localCategoryId: NULL` y el evento responde `processed`, así que viaja en `ok`
(`src/features/sync/schemas.ts:250-257`) y **el POS marca su fila de outbox como
hecha**. Nadie repara eso: la categoría que entre después no va a buscar quién
la esperaba, y el producto se queda sin categoría hasta el siguiente evento **de
ese producto**.

La segunda dependencia hace lo mismo en pequeño: si la `CURRENCY` falla y detrás
va una `EXCHANGE_RATE` de ese código, `handleExchangeRate`
(`src/features/sync/server/handlers/misc.ts:212-216`) crea la fila provisional
`USD / USD` —`name` y `symbol` iguales al código— en una tabla que es **global a
la plataforma**. Esta sí la repara el propio reintento del `CURRENCY`, cuyo
`update` escribe el nombre y el símbolo de verdad encima (`misc.ts:186`), y por
eso el corazón del feature es `CATEGORY → PRODUCT`.

## Alcance

### Dentro

1. Que el bucle secuencial de `processBatch.ts` **lleve las claves que
   fallaron** y desvíe a `failed[]` los eventos posteriores del mismo lote que
   las referencian, sin llamar a su handler (R8).
2. Las **dos** dependencias del contrato, y solo esas: `CATEGORY → PRODUCT` por
   `categoryId` ↔ `localCategoryId`, y `CURRENCY → EXCHANGE_RATE` por `code` ↔
   `currency` (R3).
3. La constante `DEPENDENCY_FAILED_IN_BATCH` en `src/constants/sync.ts`, con la
   forma que ya tiene ahí `STORE_DELIVERY_CONFIG_INCONSISTENT`
   (`src/constants/sync.ts:23`) (R9).
4. Que el evento arrastrado quede **`FAILED` en el inbox** y por tanto vuelva a
   entrar en la siguiente entrega (`recordBatch`,
   `src/features/sync/server/inbox.ts:38-45`) (R10).
5. Que un evento arrastrado **no aporte nada** a la invalidación de caché del
   final del lote (R12).
6. Las pruebas: la unidad del bucle con handlers mockeados y los escenarios
   contra Postgres real a través del `POST` de verdad.

### Fuera (explícito)

1. **Reparar lo ya aplicado mal.** Una categoría que llega en otro lote no va a
   buscar los productos que se quedaron con `localCategoryId: NULL`, y sigue sin
   ir. Está escrito en el contrato («la cascada evita aplicar mal; no repara lo
   ya aplicado mal») y en las `notes` del feature.
2. **Arrastrar entre lotes distintos.** La memoria del arrastre vive y muere
   dentro de una invocación de `processCatalogBatch`. Un `CATEGORY` que falló en
   la entrega anterior no arrastra nada en la siguiente (R7).
3. **Arrastrar hacia atrás.** Un evento ya aplicado no se deshace, no se
   reescribe y no cambia de estado porque uno posterior falle (R1, criterio 6).
4. **Mover la versión de `docs/sync-contract.md`.** Criterio 9: la regla ③ y la
   fila del vocabulario ya están publicadas. Si al implementar se descubre que
   lo escrito no es implementable, **sube al humano y no se edita** — toda
   edición mueve la versión de la primera línea (AGENTS.md § Documentación, hook
   `.claude/hooks/sync-contract-version.sh`) (R16).
5. **`CURRENCY → PRODUCT`.** No es una dependencia aquí:
   `StoreProduct.syncedPriceCurrency` es un `String` plano, sin clave ajena
   (`prisma/schema.prisma:453`) y sin consulta previa (R6, criterio 5).
6. **Cambiar el cable.** Ningún campo nuevo, ningún enum nuevo, ninguna regla de
   validación nueva: `src/features/sync/schemas.ts` no se toca (R15).
7. **Tocar el orden de aplicación** que fija `recordBatch`
   (`src/features/sync/server/inbox.ts:64`). Este feature se apoya en él; no lo
   cambia (R17, SP1).
8. **Tocar la lógica interna de los handlers.** Las guardas anti-rancias, el
   corte de `CUP` y la resolución de categoría siguen exactamente como están: lo
   que cambia es **quién llega** a ellos.
9. **Decirle al POS cuál fue la dependencia.** El contrato fija la cadena
   exacta; `failed[].error` es esa cadena y nada más (R20).

## Actores y precondiciones

Lo dispara **cuadrecaja**, con `POST /api/internal/sync/catalog` y su bearer
token (`src/app/api/internal/sync/catalog/route.ts:23`). Precondiciones que el
sistema ya garantiza y de las que dependen los escenarios:

- **Un lote es de un solo negocio.** `findCatalogMismatch`
  (`src/app/api/internal/sync/catalog/route.ts:39`) aborta con
  `403 BUSINESS_MISMATCH` antes de `processCatalogBatch`, así que no hay lote
  mezclado y el arrastre nunca cruza negocios.
- **El orden de aplicación no es el del array del POST.** `recordBatch` ordena
  `fresh` por `occurredAt` antes de devolverlo (`inbox.ts:62-64`), con un
  `localeCompare` de cadenas y un `sort` estable: a igual `occurredAt` se
  conserva el orden del array (R1, I1).
- **Un duplicado nunca entra en el bucle.** `duplicateIds`
  (`processBatch.ts:47-50`) se resuelve sin llamar a ningún handler, así que un
  evento duplicado no puede fallar y por tanto no puede arrastrar (R2).
- **Un evento que falla ya vuelve en `failed[]` y queda `FAILED`.** El `catch`
  del bucle (`processBatch.ts:91-95`) y `markFailed` (`inbox.ts:85-96`) son el
  camino que este feature reutiliza sin cambiarlo.
- **`processed`, `stale`, `skipped_not_published` y `duplicate` viajan en `ok`.**
  `summarize` mete en `ok` todo lo que no sea `failed`
  (`src/features/sync/schemas.ts:250-257`).
- **La respuesta es siempre `207`** mientras `processCatalogBatch` no lance
  (`route.ts:45`). Este feature no introduce ningún código HTTP nuevo.

## Comportamiento esperado

**E1 — una `CATEGORY` que falla arrastra al `PRODUCT` posterior que la
referencia.**
Dado un lote de dos eventos, aplicados en este orden: un `CATEGORY` con
`categoryId: "cat-1"` que **falla**, y después un `PRODUCT` con
`localCategoryId: "cat-1"`; cuando se procesa; entonces la respuesta trae los
**dos** en `failed[]`, el del producto con
`error: "DEPENDENCY_FAILED_IN_BATCH"` exacto; `ok` no contiene ninguno de los
dos; `handleProduct` no llega a llamarse; y el lote no crea ni modifica ninguna
fila de `StoreProduct` de ese `storeProductId` (criterio 1, I2).

**E2 — el arrastrado se reenvía tal cual y entra.**
Dado el `PRODUCT` de E1, con **el mismo `eventId`, el mismo `updatedAt` y el
mismo payload byte a byte**; cuando se entrega en un lote posterior donde el
`CATEGORY` de `cat-1` se aplica bien; entonces responde `processed`, no `stale`
y no `duplicate`, y la fila de `StoreProduct` queda con `localCategoryId`
apuntando a la categoría. La guarda anti-rancia no lo rechaza porque **nunca se
escribió nada** con esa marca: el evento no llegó a aplicarse (criterio 2).

**E3 — un `PRODUCT` cuya categoría no viene en el lote sigue como hasta hoy.**
Dado un lote con un solo `PRODUCT` con `localCategoryId: "cat-9"`, sin ningún
evento `CATEGORY` de esa clave; cuando se procesa; entonces responde
`processed`, viaja en `ok` y la fila queda con `localCategoryId: NULL`. La regla
vieja no cambia fuera del lote (criterio 3, R7).

**E4 — una `CURRENCY` que falla arrastra la `EXCHANGE_RATE` posterior de ese
código.**
Dado un lote con un `CURRENCY` de `code: "ZQX"` que **falla** y, después, una
`EXCHANGE_RATE` con `currency: "ZQX"`; cuando se procesa; entonces los dos
vuelven en `failed[]`, la tasa con `DEPENDENCY_FAILED_IN_BATCH`; no se inserta
ninguna fila de `ExchangeRate`; y **no queda ninguna fila de `Currency` con
`code = name = symbol = "ZQX"`**, porque el `upsert` provisional de
`misc.ts:212-216` nunca se ejecuta (criterio 4, I3).

**E5 — `CURRENCY` no arrastra `PRODUCT`.**
Dado el mismo `CURRENCY` fallido de E4 y, después, un `PRODUCT` con
`currency: "ZQX"`; cuando se procesa; entonces el producto responde `processed`,
viaja en `ok` y su fila queda con `syncedPriceCurrency: "ZQX"`. Un producto en
una moneda que nadie declaró se publica bien: no consulta la tabla de monedas ni
tiene clave ajena contra ella (criterio 5, R6).

**E6 — el arrastre es solo hacia adelante.**
Dado un lote cuyo orden de **aplicación** es: `PRODUCT` con
`localCategoryId: "cat-1"` primero (`occurredAt` menor) y `CATEGORY` de
`cat-1` que falla después (`occurredAt` mayor); cuando se procesa; entonces el
producto responde `processed`, su fila queda escrita, y nada la deshace ni la
marca. El orden se controla en la prueba **con `occurredAt`**, no con la
posición en el array, porque `recordBatch` reordena (criterio 6, R1).

**E7 — el resto del lote se aplica.**
Dado un lote con el `CATEGORY` fallido de E1, el `PRODUCT` arrastrado, y un
tercer `PRODUCT` **sin relación** con esa categoría (`localCategoryId: null` o
de otra clave); cuando se procesa; entonces el tercero responde `processed` y
está en `ok`, y `failed[]` tiene exactamente dos entradas. El fallo no es daño
colateral para lo que no dependía de él (criterio 7, R14).

**E8 — el arrastrado no queda procesado en el inbox.**
Dado el `PRODUCT` arrastrado de E1; cuando termina el lote; entonces su fila de
`SyncEvent` tiene `status = "FAILED"` y `error = "DEPENDENCY_FAILED_IN_BATCH"`;
y al reenviarlo, `recordBatch` lo devuelve en `fresh` (nunca en `duplicateIds`),
así que responde `processed` — nunca `duplicate` (criterio 8, R10).

**E9 — una `CATEGORY` que responde `stale` no arrastra nada.**
Dado un `CATEGORY` cuya guarda anti-rancia lo rechaza (`misc.ts:124-129`,
`sourceUpdatedAt` guardado ≥ el del payload) y, después, un `PRODUCT` de esa
clave; cuando se procesa; entonces la categoría responde `stale`, el producto
responde `processed` y se aplica con su categoría. `stale` es un camino normal y
frecuente, no un fallo (R2).

**E10 — `skipped_not_published` tampoco arrastra.**
Dada una `EXCHANGE_RATE` de `currency: "CUP"`, que responde
`skipped_not_published` antes de escribir nada (`misc.ts:210`), o un `PRODUCT`
de una tienda que no es de este negocio (`product.ts:75`); cuando se procesa;
entonces nada posterior se ve afectado: solo `failed[]` arrastra (R2).

**E11 — la clave se compara exacta, byte a byte.**
Dado un `CURRENCY` con `code: "usd"` que falla y, después, una `EXCHANGE_RATE`
con `currency: "USD"`; cuando se procesa; entonces la tasa se aplica
(`processed`). Son dos filas distintas de `Currency` —su `code` es el `@id` y el
índice es exacto—, así que la tasa nunca dependió de la que falló. Lo mismo con
espacios: `" cat-1"` y `"cat-1"` son claves distintas, aquí y en el
`findUnique` por `businessId_externalId` de `misc.ts:114-117` (R4).

**E12 — un `PRODUCT` sin categoría no participa nunca.**
Dado un `CATEGORY` que falla y, después, un `PRODUCT` con `localCategoryId`
`null`, ausente o `""`; cuando se procesa; entonces responde `processed`. La
cadena vacía cuenta como «sin categoría»: `resolveLocalCategory` la trata como
`null` (`product.ts:295`) y `categoryPayloadSchema` no puede producirla como
clave (`categoryId` es `.min(1)`, `schemas.ts:78`) (R5).

**E13 — no hay cadena.**
Dado un `CATEGORY` que falla, un `PRODUCT` arrastrado, y detrás una
`EXCHANGE_RATE` y otro `PRODUCT`; cuando se procesa; entonces el arrastrado **no
arrastra a nadie**: ni `PRODUCT` ni `EXCHANGE_RATE` son origen de ninguna
dependencia reconocida, así que el conjunto de claves solo crece con eventos
`CATEGORY` y `CURRENCY` fallidos (R11).

**E14 — el arrastrado no invalida nada.**
Dado el lote de E1; cuando termina; entonces las llamadas del final del bucle
(`processBatch.ts:100-111`) reciben exactamente los mismos valores que recibiría
el mismo lote **sin** el evento arrastrado: el arrastrado no aporta
`touchedStoreSlug`, `touchedStoreSlugs`, `touchedBrandSlug`, `touchedProductId`,
`touchedSlugValues` ni `purgeObjectPrefix`. El número de llamadas no cambia
—`revalidateStores`/`revalidateSlugs`/`revalidateStorefronts`/`revalidateProducts`
se llaman siempre, aunque sea con conjuntos vacíos— y `removeStoreObjectsUnder`
no se llama por él (R12).

**E15 — una categoría fallida arrastra a TODOS sus productos posteriores.**
Dado un `CATEGORY` fallido y tres `PRODUCT` posteriores de esa clave; cuando se
procesa; entonces los tres vuelven con `DEPENDENCY_FAILED_IN_BATCH` y ninguna de
sus tres filas se escribe. Un solo fallo, N arrastrados.

**E16 — el cruce de tipos no arrastra.**
Dado un `CATEGORY` fallido con `categoryId: "USD"` y, después, una
`EXCHANGE_RATE` con `currency: "USD"`; cuando se procesa; entonces la tasa se
aplica. La clave se empareja **por par de entidades**, no por el valor suelto:
una categoría solo arrastra `PRODUCT`, una moneda solo `EXCHANGE_RATE` (R3).

**E17 — una clave que se repara dentro del lote deja de arrastrar.**
Dado un `CATEGORY` de `cat-1` que falla, después otro `CATEGORY` de `cat-1`
**que no es un `DELETE`** y se aplica bien (`processed` o `stale`), y después un
`PRODUCT` de `cat-1`; cuando se procesa; entonces el producto responde
`processed` y queda con su categoría: en el momento de aplicarlo la fila
**existe**, así que ya no depende de lo que falló (R13, SP3).

**E18 — un lote sin fallos se comporta exactamente igual que hoy.**
Dado cualquier lote en el que ningún evento falla; cuando se procesa; entonces
la respuesta, los estados del inbox y el número de invalidaciones son idénticos
a los de antes de este feature. La cascada solo se dispara cuando algo **ya**
falló (R18).

**E19 — un `DELETE` de categoría NO repara la clave.**
Dado un lote cuyo orden de aplicación es: ① un `CATEGORY` de `cat-1` que
**falla**; ② un `CATEGORY` de `cat-1` con `operation: "DELETE"` que **no
encuentra la fila** y responde `processed` sin escribir nada
(`misc.ts:131-132`); ③ un `PRODUCT` con `localCategoryId: "cat-1"`; cuando se
procesa; entonces ① y ③ vuelven en `failed[]` —③ con
`DEPENDENCY_FAILED_IN_BATCH`—, ② responde `processed` y viaja en `ok`, y **no
queda ninguna fila de `StoreProduct` de ese producto**. Sin la excepción de R13,
② habría limpiado la clave y ③ se habría aplicado con `localCategoryId: NULL`,
que es exactamente lo que F-037 viene a impedir. La otra mitad del escenario, en
el mismo lote o en otro: un `CURRENCY` de `code: "ZQX"` que falla, un `CURRENCY`
de `ZQX` con `operation: "DELETE"` detrás —que hace el mismo `upsert` que un
`UPDATE`, porque `handleCurrency` ignora `operation`— y después una
`EXCHANGE_RATE` de `ZQX`: esa **sí** se aplica, porque tras ese `DELETE` la fila
de `Currency` existe de verdad (R13).

## Reglas de negocio

**R1 — «posterior» es posterior en el ORDEN DE APLICACIÓN, no en el array del
POST.** `recordBatch` devuelve `fresh` ordenado por `occurredAt`
(`inbox.ts:64`), y ese es el orden en el que el bucle aplica. Un lote de prueba
controla quién va antes **con `occurredAt`**; a igual `occurredAt` decide el
orden del array, porque el `sort` de V8 es estable. Comprobable: el mismo par de
eventos enviado en el orden inverso del array, con los mismos `occurredAt`, da
el mismo resultado.

**R2 — solo arrastra un evento que acaba en `failed[]`.** `stale`,
`skipped_not_published`, `duplicate` y `processed` **no** arrastran, y `stale`
es el caso frecuente: una `CATEGORY` reentregada por el outbox responde `stale`
todos los días (`misc.ts:124-129`). Comprobable por escenario (E9, E10) y por
construcción: la clave se apunta en el `catch` del bucle, no en el camino feliz.

**R3 — las dependencias reconocidas son dos, y el par de entidades forma parte
de la clave.**

| Falla      | Clave del que falla  | Arrastra a      | Clave del dependiente     |
| ---------- | -------------------- | --------------- | ------------------------- |
| `CATEGORY` | `payload.categoryId` | `PRODUCT`       | `payload.localCategoryId` |
| `CURRENCY` | `payload.code`       | `EXCHANGE_RATE` | `payload.currency`        |

Los dos valores de la primera fila son el **externalId del POS**, no el `id`
interno: es lo que compara `findUnique({ businessId_externalId })` en
`misc.ts:114-117` y en `product.ts:296-299`. Ninguna otra combinación arrastra
(E16).

**R4 — la comparación es exacta: sin recortar espacios y sin plegar
mayúsculas.** Es la única correcta, porque es la que hace la base: `Currency.code`
es el `@id` (`prisma/schema.prisma:531`) y `handleCurrency`/`handleExchangeRate`
lo escriben verbatim (`misc.ts:178-187`, `:212-216`); `LocalCategory` se busca y
se crea por `(businessId, externalId)` verbatim. Normalizar aquí y no allí sería
arrastrar eventos que la base habría tratado como independientes; no normalizar
en ninguno de los dos sitios es lo que hace que «arrastra» signifique
exactamente «habría tocado esa fila». Los schemas no normalizan nada:
`z.string().min(1)` y `z.string().length(3)` (`schemas.ts:78`, `:113`, `:104`,
`:122`) — a diferencia de `provisionCredentialSchema`, que sí hace `.trim()`
(`schemas.ts:244`) y demuestra que aquí la omisión es deliberada.

**R5 — un dependiente sin clave nunca se arrastra.** `localCategoryId` es
`.nullish()` y sin `.min(1)` (`schemas.ts:102`), así que `null`, ausente y `""`
son posibles; los tres significan «sin categoría» para `resolveLocalCategory`
(`product.ts:295`) y los tres quedan fuera del arrastre (E12).

**R6 — `CURRENCY` no arrastra `PRODUCT`, y no es un olvido.**
`StoreProduct.syncedPriceCurrency` es un `String` plano, sin clave ajena contra
`Currency` (`prisma/schema.prisma:453`), y `handleProduct` no consulta esa tabla
en ningún punto. Comprobable por escenario (E5) y por grep: no hay ninguna
lectura de `prisma.currency` en `src/features/sync/server/handlers/product.ts`.

**R7 — la decisión se toma con lo que se vio en ESTE lote, sin ninguna consulta
nueva.** No se pregunta a la base si la categoría ya existía de antes, ni si la
moneda ya tenía fila. Consecuencia aceptada y declarada: si el `CATEGORY`
fallido era un `UPDATE` de una categoría **que ya existía**, el `PRODUCT`
posterior se arrastra igual aunque se hubiera aplicado bien; cuesta un reintento
del outbox y compra determinismo y cero round-trips. Es la letra del contrato,
que empareja por clave y no por estado.

**R8 — el evento arrastrado no llega a su handler.** Ni consulta, ni escribe, ni
invalida: el bucle lo desvía **antes** de `applyEvent` (`processBatch.ts:71`,
`:128-145`). Es lo que hace verdadera la mitad de los criterios 1 y 4 («no queda
ninguna fila…»). Comprobable en unidad: con los handlers mockeados,
`handleProduct` no se llamó ni una vez con ese payload.

**R9 — el mensaje sale de una constante, no de un literal.** Un `export const
DEPENDENCY_FAILED_IN_BATCH = "DEPENDENCY_FAILED_IN_BATCH"` en
`src/constants/sync.ts`, con la misma forma y el mismo tipo de comentario que
`STORE_DELIVERY_CONFIG_INCONSISTENT` (`src/constants/sync.ts:15-23`) y
`STORE_OPENING_HOURS_INVALID` (`:25-34`). AGENTS.md § Prohibiciones prohíbe los
magic strings; y el test que afirma la cadena **importa la constante**, igual
que hace `storePublishGate.db.test.ts:8` con `STORE_TIMEZONE_INVALID`.

**R10 — el estado del arrastrado, en los tres sitios donde se mide.**
`results[].status === "failed"` con `error` igual a la constante; una entrada en
`failed[]` con `{ id, error }` y **nada** en `ok`; y la fila de `SyncEvent` en
`status: "FAILED"` con ese `error` (`markFailed`, `inbox.ts:85-96`). Ese estado
es justo el que hace que `recordBatch` lo vuelva a coger en la siguiente entrega
(`inbox.ts:38-45`): un evento fallido **no** es un duplicado (AGENTS.md § Cosas
que muerden), y reportarlo en `ok` haría que el POS diera por buena una
actualización que se perdió.

**R11 — no hay cascada en cadena, y se dice en vez de darse por hecho.** Con las
dos únicas dependencias reconocidas, ningún dependiente es a su vez origen: un
`PRODUCT` arrastrado no arrastra nada y una `EXCHANGE_RATE` arrastrada tampoco.
El conjunto de claves solo lo alimentan `CATEGORY` y `CURRENCY` **fallidas**, y
un arrastrado nunca añade su propia clave. Comprobable: E13, y por construcción
—las claves se apuntan por entidad, y `PRODUCT`/`EXCHANGE_RATE` no tienen
entrada en la tabla de R3—.

**R12 — un evento arrastrado no aporta nada a la invalidación.** No escribió
nada, así que no puede haber tocado ninguna página: nada suyo entra en
`touchedStores`, `touchedBrands`, `touchedProducts`, `touchedSlugValues` ni
`purgePrefixes` (`processBatch.ts:52-64`). El número de llamadas de
invalidación por lote no cambia —las cuatro se disparan siempre, incluso con
conjuntos vacíos— y el presupuesto de F-035 (`2 × N` por lote) se conserva.

**R13 — la clave deja de arrastrar si un evento posterior de la MISMA entidad y
la MISMA clave termina bien, CON UNA EXCEPCIÓN: un `CATEGORY` con
`operation: "DELETE"` no la limpia nunca.** Si un segundo `CATEGORY` de `cat-1`
responde `processed` o `stale`, la fila existe en el momento en que el `PRODUCT`
siguiente se aplique, así que ese producto ya no depende de lo que falló y no se
arrastra (E17). Es la lectura precisa del contrato («los eventos posteriores que
dependen de **él**»): sin esto se arrastrarían eventos que se habrían aplicado
correctamente.

Lo que limpia es la **prueba de que la fila existe**, y un `DELETE` de categoría
no la da nunca: si encontró la fila la **borró**, y si no la encontró responde
`processed` sin escribir nada
(`if (!existing) return PROCESSED;`,
`src/features/sync/server/handlers/misc.ts:131-132`). En los dos casos la
categoría **no está** después del evento, así que limpiar la clave dejaría pasar
al `PRODUCT` siguiente para que se aplicara con `localCategoryId: NULL` — el
fallo exacto que este feature existe para cerrar (E19). Decisión del humano
(2026-09-07), literal: «solo para CATEGORY: un CATEGORY con operation DELETE deja
de limpiar la clave, y CURRENCY sigue limpiando porque su handler ignora la
operacion y siempre hace upsert».

**La asimetría con `CURRENCY` es real y es el sitio donde alguien la copiaría
mal.** `handleCurrency` **no recibe `operation`** —`applyEvent` no se la pasa
(`src/features/sync/server/processBatch.ts:171-172`)— y hace un `upsert`
incondicional (`misc.ts:178-187`), así que después de **cualquier** evento
`CURRENCY`, `DELETE` incluido, la fila de `Currency` existe de verdad y limpiar
es correcto. La regla no es «un `DELETE` nunca limpia»: es «un `DELETE` de
**categoría** nunca limpia», porque es la única de las dos entidades cuyo
`DELETE` borra algo.

Dos matices que se dejan a propósito del lado conservador, porque equivocarse
hacia «no limpiar» cuesta un reintento y hacia «limpiar» cuesta un producto
publicado sin categoría:

- Un `CATEGORY` de `DELETE` que responde `stale` **sí** prueba que la fila
  existe (la guarda solo puede rechazarlo si encontró `existing`,
  `misc.ts:124-129`), y aun así no limpia: la regla mira `operation`, no el
  desenlace. Simplifica a cambio de un falso bloqueo raro.
- `skipped_not_published` y `duplicate` no limpian tampoco, y no por
  descuido: no prueban ni que la fila esté ni que falte. Hoy es teórico —
  ninguno de los dos handlers-origen devuelve `skipped`— y así queda escrito
  para el día que alguno lo devuelva.

**R14 — el aislamiento del resto del lote se mantiene.** Lo que no depende de la
clave fallida se aplica exactamente como hoy, incluidos los eventos de otras
entidades y los `PRODUCT` de otras categorías (E7). Este feature no introduce
ningún camino que aborte el lote entero: el único que existe sigue siendo el
`catch` externo del route (`route.ts:46-51`, `500 BATCH_FAILED`).

**R15 — no hay cambio de cable.** `src/features/sync/schemas.ts` no cambia:
ningún campo, ningún enum, ninguna validación. `EVENT_STATUS`
(`schemas.ts:199-205`) tampoco: `failed` ya existe y es el estado que usa el
arrastrado. Comprobable: `git diff` de ese archivo vacío al cerrar.

**R16 — el contrato no se mueve.** Criterio 9. Comprobable:
`git diff --stat main -- docs/sync-contract.md` vacío al cerrar. Si algo no
resulta implementable, **sube al humano** y solo con su decisión se mueve la
versión.

**R17 — `recordBatch` no se toca.** Su orden es la precondición de R1, no el
objeto del feature (SP1). Comprobable: `git diff` de
`src/features/sync/server/inbox.ts` vacío al cerrar, salvo comentario.

**R18 — no-regresión: sin fallos, todo igual.** Un lote en el que nada falla
produce byte a byte la misma respuesta que antes del feature y el mismo número
de invalidaciones (E18). Es lo que hace que el precio de la cascada —«mientras
la dependencia siga fallando, el dependiente deja de existir en vez de existir
mal», contrato ③ límite 3— solo se pague cuando algo ya había fallado.

**R19 — se arrastra por clave, sea cual sea la `operation`.** Un `PRODUCT` con
`operation: "DELETE"` o con `publishToStore: false` cuyo `localCategoryId`
coincide con una `CATEGORY` fallida **se arrastra igual**, aunque su camino no
lea la categoría (`product.ts:96-128` devuelve antes de resolverla). Es la letra
del contrato, que no distingue por operación, y es lo que las `notes` describen
(«llevar las claves fallidas y desviar a `failed[]` los posteriores que las
referencian»). Coste declarado: una baja o una despublicación se retrasa una
entrega. Ver SP2.

**R20 — `failed[].error` es exactamente la cadena, sin adornos.** Nada de
`DEPENDENCY_FAILED_IN_BATCH: cat-1` ni del `eventId` de la dependencia: el POS
compara la cadena del § Vocabulario de errores. El detalle, si se quiere, va a un
`console.warn` con prefijo `[sync]` —**nunca** `console.error`, que dispara el
guardián de servidor de las etapas que levantan la app (AGENTS.md § Cosas que
muerden, ficha `.agent/playbook/console-error-dispara-guardian-servidor.md`)—.

## Casos límite y errores

| Caso                                                                              | Qué tiene que pasar                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CATEGORY` que responde `stale`                                                   | No arrastra. Camino normal y frecuente (E9, R2)                                                                                                                                                                                                 |
| `EXCHANGE_RATE` de `CUP`                                                          | Sigue respondiendo `skipped_not_published` antes de escribir (`misc.ts:210`). Si una `CURRENCY` de `code: "CUP"` falló antes en el lote, se arrastra igual, por R7 y R19: no escribe nada, y no se mete conocimiento de `CUP` fuera del handler |
| Evento duplicado en el lote                                                       | Sale por `duplicateIds` sin pasar por el bucle: no falla, no arrastra y no se arrastra (`processBatch.ts:47-50`)                                                                                                                                |
| El `PRODUCT` arrastrado ya tenía fila de una entrega anterior                     | La fila **no se toca**: ni `localName`, ni precio, ni `sourceUpdatedAt`, ni `syncedAt`. El criterio 1 se lee como «el lote no escribe» (I2)                                                                                                     |
| La moneda de E4 ya tenía fila provisional de antes                                | Sigue ahí: la cascada evita crearla, no la repara. El criterio 4 se lee sobre lo que **este** lote deja (I3)                                                                                                                                    |
| `CATEGORY` fallida de una categoría que ya existía                                | Arrastra igual (R7). Cuesta un reintento; no corrompe nada                                                                                                                                                                                      |
| `PRODUCT` con `operation: "DELETE"` de una categoría fallida                      | Se arrastra (R19). La baja se retrasa una entrega — SP2                                                                                                                                                                                         |
| Dos `CATEGORY` de la misma clave, la primera falla y la segunda entra             | El `PRODUCT` posterior se aplica (E17, R13) — **salvo que la segunda sea un `DELETE`**: entonces la clave sigue bloqueando y el producto vuelve con `DEPENDENCY_FAILED_IN_BATCH` (E19)                                                          |
| Un `CURRENCY` que falla y otro de la misma clave con `operation: "DELETE"` detrás | La clave **sí** se limpia y la `EXCHANGE_RATE` posterior se aplica: `handleCurrency` ignora `operation` y siempre hace `upsert`, así que la fila existe (R13, E19)                                                                              |
| Reintento del arrastrado con su `updatedAt` original                              | Entra: nunca se escribió nada con esa marca, así que la guarda compara contra algo más viejo (E2). La trampa de «un evento reencolado necesita marca nueva» es de la reparación a posteriori, no de esto                                        |
| Fila de `SyncEvent` tras un reintento bueno                                       | `status: "PROCESSED"`, pero **conserva el `error` viejo**: `markProcessed` (`inbox.ts:69-75`) no lo limpia. Es cosmético; una prueba afirma sobre `status`, no sobre `error`                                                                    |
| Lote de 500 eventos con una `CATEGORY` fallida al principio                       | Se arrastran solo los `PRODUCT` de esa clave; el resto se aplica. Coste O(1) por evento (una consulta a un `Set`), sin round-trips nuevos                                                                                                       |
| La base se cae a mitad del lote                                                   | Cada evento que lance vuelve en `failed[]` por el `catch` de siempre; los que fallen por eso también arrastran, porque **todo** `failed[]` arrastra (R2). Correcto: nada se aplicó                                                              |
| `error.message` largo del fallo original                                          | `markFailed` lo recorta a 500 (`inbox.ts:92`). La constante mide 27, así que el arrastrado nunca se recorta                                                                                                                                     |

## Datos y contrato

El `payload` no cambia (R15). Lo que cambia es de nuestro lado:

| Pieza                                            | Hoy                                               | Después                                                  |
| ------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------- |
| `src/constants/sync.ts`                          | Cuatro constantes de vocabulario y límites        | + `DEPENDENCY_FAILED_IN_BATCH` (R9)                      |
| `src/features/sync/server/processBatch.ts:69-96` | Cada evento se aplica sin mirar a los anteriores  | Lleva las claves fallidas y desvía a `failed[]` (R3, R8) |
| `src/features/sync/server/inbox.ts`              | —                                                 | Sin cambios (R17)                                        |
| `src/features/sync/schemas.ts`                   | —                                                 | Sin cambios (R15)                                        |
| `src/features/sync/server/handlers/*`            | —                                                 | Sin cambios (§ Fuera, 8)                                 |
| `docs/sync-contract.md`                          | v12.1, regla ③ y fila del vocabulario ya escritas | Sin cambios (R16)                                        |

Lo que el contrato ya fija y esta spec solo obedece: la cadena
`DEPENDENCY_FAILED_IN_BATCH` en `failed[]` de un `207`
(`docs/sync-contract.md`, fila del § Vocabulario de errores), la tabla de las
dos dependencias, «solo hacia adelante y solo dentro del lote», y el consejo al
POS de reintentar **tal cual** con el `updatedAt` original.

## Criterios de aceptación propuestos

Los diez son los de `.agent/features.json`, sin tocar ni una palabra (regla 3).
Dónde vive cada verificación:

- **Unidad del bucle**, con los handlers mockeados y `recordBatch` mockeado, en
  la línea de `src/features/sync/server/processBatch.test.ts`: prueba a quién se
  llama y a quién no, y qué sale en `results`/`ok`/`failed`.
- **Postgres real a través del `POST` de verdad**, en la línea de
  `src/features/sync/server/handlers/storePublishGate.db.test.ts` y
  `src/features/sync/server/handlers/product.db.test.ts`: prueba qué filas
  quedan. El nombre y el reparto exacto de los archivos nuevos son del
  arquitecto (§ No decidido, 1).
- **Cómo se fuerza el fallo de la dependencia sin mocks**, que es la única
  dificultad real de los `*.db.test.ts`: `handleCategory` y `handleCurrency` no
  tienen ninguna rama de fallo propia. La palanca comprobada es un byte que
  Postgres no puede almacenar en un `text` —el `\u0000` que un JSON puede llevar
  sin problema— dentro de `payload.name`:
  pasa `z.string().min(1)`, viaja bien en JSON, y el `INSERT` muere con
  `22021 invalid byte sequence for encoding "UTF8": 0x00`. Verificado contra el
  Postgres local de este repo con el mismo driver `pg` que usa el adapter de
  Prisma, en una tabla temporal. Alternativa sin exotismos, si esa se prefiere
  no usar: saturar los 999 candidatos de `uniqueSlug` (`src/lib/slug.ts:107-112`)
  para esa categoría, que hace lanzar a `generateCategorySlug` **antes** de
  escribir; cuesta 999 consultas y es igual de determinista.

**C1 `[ya]`** — «Un lote con un CATEGORY que falla y un PRODUCT posterior que lo
referencia devuelve los DOS en failed[], el PRODUCT con error
DEPENDENCY_FAILED_IN_BATCH, y no queda ninguna fila de StoreProduct de ese
producto.»
E1. En el `*.db.test.ts`: `body.failed` tiene los dos `eventId`, el del producto
con `error` igual a la constante **importada**; `body.ok` no los contiene;
`prisma.storeProduct.findUnique({ storeId_externalId })` devuelve `null`; y
`prisma.storeProduct.count()` acotado a ese `externalId` vale lo mismo antes y
después (I2). En unidad, además: `handleProduct` no se llamó.

**C2 `[ya]`** — «Ese mismo PRODUCT reenviado TAL CUAL, con su updatedAt
original, en un lote donde el CATEGORY entra bien, se aplica y queda con su
categoria: la guarda anti-rancio no lo responde stale.»
E2. Segundo `POST` con el **mismo** `eventId` y el **mismo** objeto `payload`
(la prueba reutiliza la misma constante, no una copia editada) y un `CATEGORY`
de esa clave que sí entra. Se afirma `results[].status === "processed"` (ni
`stale` ni `duplicate`) y que la fila de `StoreProduct` tiene `localCategoryId`
igual al `id` de la `LocalCategory` de `cat-1`.

**C3 `[ya]`** — «Un PRODUCT cuya categoria NO viene en el lote se sigue
guardando con localCategoryId NULL y respondiendo processed: la regla vieja no
cambia fuera del lote.»
E3. Un lote de un solo evento: `results[0].status === "processed"` y la fila con
`localCategoryId: null`. Es la no-regresión de `product.ts:300-303`.

**C4 `[ya]`** — «Un CURRENCY que falla arrastra la EXCHANGE_RATE posterior del
mismo lote con ese code, y no queda ninguna fila de moneda con name y symbol
iguales al codigo.»
E4. Con un código de moneda **propio de la prueba** —la tabla `Currency` es
global a la plataforma y la comparten los demás `*.db.test.ts` y los smokes: ni
`CUP`, ni `USD`, ni `MLC`, ni `QAB` (F-035), ni `ZZZ` (F-027), ni `WVX`
(`src/features/catalog/server/rates.db.test.ts:47`)—, y **borrado al terminar**,
como hace ese mismo archivo en su `afterAll` (`rates.db.test.ts:106`). Se
afirma: los dos en `failed[]`, la tasa con la constante;
`prisma.currency.findUnique({ where: { code } })` devuelve `null` (o, si existía
de antes, sigue con su `name`/`symbol` de antes, I3); y
`prisma.exchangeRate.count({ where: { currencyCode } })` vale 0.

**C5 `[ya]`** — «Un PRODUCT cuya moneda es la de un CURRENCY que fallo en el
mismo lote se aplica igual y responde processed: CURRENCY no arrastra PRODUCT.»
E5. En el mismo lote de C4, un tercer evento `PRODUCT` con `currency` igual a
ese código: `processed`, en `ok`, y su fila con
`syncedPriceCurrency` igual al código.

**C6 `[ya]`** — «El arrastre es solo hacia adelante: un PRODUCT que va ANTES del
CATEGORY fallido en el mismo lote se aplica sin que lo toque nada.»
E6. El orden se fija con `occurredAt` (`"…T10:00:00.000Z"` para el producto,
`"…T11:00:00.000Z"` para la categoría), **no** con la posición en el array,
porque `recordBatch` reordena (`inbox.ts:64`, R1, I1). Para que la prueba
demuestre que entiende eso, el array del `POST` lleva la categoría **primero**:
si alguien quitara el `sort`, el producto pasaría a ir después y el test se
pondría rojo. Se afirma: el producto en `ok` con `processed` y su fila escrita
con el contenido del payload.

**C7 `[ya]`** — «El resto del lote se aplica: un PRODUCT sin relacion con el
evento fallido responde processed en ese mismo lote.»
E7. Cuarto evento del mismo lote, con `localCategoryId: null` o de otra
categoría: `processed`, en `ok`, fila escrita. Y `body.failed` con exactamente
las dos entradas esperadas, no tres.

**C8 `[ya]`** — «Un evento arrastrado no queda marcado como procesado en el
inbox: reenviarlo despues responde processed, nunca duplicate.»
E8. `prisma.syncEvent.findUnique({ where: { eventId } })` con
`status === "FAILED"` y `error` igual a la constante justo después del primer
lote; y el segundo `POST` de C2 con `results[].status === "processed"`. Es la
mitad que AGENTS.md ficha como «un evento fallido NO es un duplicado»: si
saliera `duplicate`, el POS daría por aplicada una actualización que nunca
entró.

**C9 `[ya]`** — «docs/sync-contract.md ya documenta la regla y el error en la
v11 (seccion 'Cambios respecto a la v10.1' ③ y la fila
DEPENDENCY_FAILED_IN_BATCH del vocabulario): este feature NO vuelve a mover la
version salvo que al implementarlo se descubra que lo escrito no es
implementable.»
`git diff --stat main -- docs/sync-contract.md` vacío al cerrar (R16). **Este
análisis no encontró nada no implementable**: las dos dependencias, la clave, el
«solo hacia adelante», el reintento con la marca original y la cadena del
vocabulario se sostienen sobre el código de hoy. Lo único que el contrato no
decide y esta spec sí es lo que llevan R13 —incluida su excepción de
`CATEGORY` + `DELETE`, que salió al implementar— y R19, y ninguna de las dos
contradice su letra: la regla ③ sigue siendo cierta palabra por palabra, así que
esta esquina no da nada que pedirle al equipo de cuadrecaja.

**C10 `[ya]`** — «bash .agent/verify.sh F-037 --full termina con codigo 0.»
Tal cual. Tres recordatorios para no perder un ciclo: `--full` incluye la etapa
`harness`, que se pone roja tanto por citar entre comillas invertidas un archivo
que aún no existe como por citar abreviada la ruta de uno que sí existe
(AGENTS.md § Cosas que muerden); `npm run format` sobre **lo que escribas** en
`.agent/`, porque `format:check` es lo que valida el CI; y `npm test` incluye el
proyecto `db`, que necesita el Postgres de `docker-compose.yml` levantado y ya
migrado.

## Incongruencias detectadas

**I1 — el orden de aplicación no es cronológico si el POS envía offsets.**
`recordBatch` ordena con `a.occurredAt.localeCompare(b.occurredAt)`
(`inbox.ts:64`), una comparación de **cadenas**, mientras que
`z.iso.datetime({ offset: true })` (`schemas.ts:20`) admite `+02:00` además de
`Z`. Con offsets mezclados, `"2026-09-01T11:00:00Z"` se ordena antes que
`"2026-09-01T10:00:00-05:00"`, que ocurrió tres horas después. Hasta hoy no
importaba —el orden era una optimización y la guarda anti-rancia lo hacía
irrelevante—; con F-037 el orden **decide** quién arrastra a quién. Todos los
ejemplos del contrato usan `Z`, así que el caso es hipotético. No lo arregla
este feature (R17): SP1.

**I2 — el criterio 1 dice «no queda ninguna fila de StoreProduct de ese
producto», y eso solo es literal si el producto es nuevo.** Si ese
`storeProductId` ya tenía fila de una entrega anterior, la fila existe y seguirá
existiendo: lo que el feature garantiza es que **este lote no la crea ni la
modifica**. No se toca el criterio (regla 3); se verifica en su forma fuerte
—producto nuevo, `findUnique` → `null`— y además con la forma general: ninguna
columna de la fila preexistente cambia (`sourceUpdatedAt`, `localName`,
`syncedAt`).

**I3 — el criterio 4 tiene la misma forma, agravada por ser una tabla global.**
`Currency` no tiene `businessId` (`prisma/schema.prisma:530-537`) y la comparten
todos los negocios, los `*.db.test.ts` y los smokes. «No queda ninguna fila de
moneda con name y symbol iguales al codigo» se verifica sobre un código propio
de la prueba, que además hay que **borrar al terminar** — la lección que dejó
F-035 («su smoke borra las tasas que escribió», commit `85d037a`).

**I4 — AGENTS.md dice que el orden de entrega no importa, y a partir de aquí
importa dentro del lote.** § Cosas que muerden: «Todo lo que el sync escribe es
idempotente y va guardado contra escrituras rancias. Gracias a eso el orden de
entrega no importa». Sigue siendo cierto para **lo que se escribe**, pero con
F-037 el orden **dentro de un lote** decide si un evento correcto se aplica o
vuelve en `failed[]` (criterio 6). No propongo cambiar la frase todavía: si al
implementar se ve que induce a error, la corrección es una línea en esa sección
y va **en el mismo commit que el código**, como hizo F-036 con las dos formas de
la guarda.

**I5 — `processBatch.ts:121` usa `console.error`.** Es preexistente y no es de
este feature, pero cae justo en el archivo que se va a tocar y contradice
AGENTS.md § Cosas que muerden: cualquier línea con esa forma pone en rojo las
etapas `smoke`/`visual`/`probe` por «el servidor se cayó», aunque todo haya
respondido bien (ficha
`.agent/playbook/console-error-dispara-guardian-servidor.md`). Lo mismo en
`src/app/api/internal/sync/catalog/route.ts:49`. **Fuera de alcance**: se anota
para que quien implemente no copie esa forma en la línea nueva (R20).

## Huecos y preguntas al humano

Las tres se escribieron **no bloqueantes a propósito**: cada una lleva su
decisión por defecto ya escrita como regla, así que el arquitecto y el
implementador pudieron seguir sin esperar respuesta. Por eso este documento
cierra en `estado: listo`, con el mismo criterio que
`.agent/specs/F-036/spec.md`. **SP3 ya está contestada** por el humano
(2026-09-07) y su respuesta está incorporada a R13 y a E19; SP1 y SP2 siguen
abiertas y su defecto es lo que se construyó.

**SP1 — ¿arregla este feature el orden de `recordBatch`, o se documenta la
limitación?**
Qué falta: decidir si `inbox.ts:64` pasa a ordenar por instante en vez de por
cadena. Por qué importa: «posterior» se define sobre ese orden (R1), y con
`occurredAt` en offsets distintos de `Z` el orden no es cronológico (I1), así
que una cascada podría no dispararse en un caso en el que debía. Por qué no
bloquea: todos los ejemplos del contrato usan `Z` y no se ha observado nunca
otra cosa. Opciones: (a) no tocarlo, documentar la limitación y dejar la
comparación de cadenas (defecto, R17); (b) cambiarlo aquí a
`new Date(a.occurredAt).getTime()`, que es una línea pero cambia el orden de
aplicación de **todas** las entidades y merecería su propia no-regresión;
(c) un feature aparte, que el backlog lo escribe el humano (regla 4).
**Recomendación: (a) ahora y (c) si alguna vez cuadrecaja emite offsets** — el
arreglo es barato pero toca el camino de todos los lotes, y meterlo aquí mezcla
dos cambios en un feature que ya cambia cuándo un evento correcto falla.

**SP2 — ¿se arrastra un `PRODUCT` de `DELETE` o de `publishToStore: false`?**
Qué falta: confirmar R19. Por qué importa: ese camino **no lee la categoría**
(`product.ts:96-128` devuelve antes), así que arrastrarlo no evita ningún dato a
medias; lo que hace es **retrasar una entrega la desaparición de un producto de
la vitrina**, que es dejar visible algo que el comerciante quiso quitar. Por qué
no bloquea: el defecto está escrito y es el literal del contrato. Opciones:
(a) arrastrar por clave, sin mirar `operation` ni `publishToStore` (defecto:
literal, sin ramas nuevas, sin conocer la forma del payload más allá de la
clave); (b) excluir `operation: "DELETE"` y `publishToStore: false`, que son dos
campos que el bucle ya tiene delante. **Recomendación: (a)**, porque el contrato
es vinculante y su tabla no distingue por operación; (b) es defendible y cuesta
una condición, y si el humano la prefiere, cambia solo R19 y su escenario.

**SP3 — ¿una clave reparada dentro del mismo lote deja de arrastrar?**
**RESUELTA por el humano el 2026-09-07**, al implementar: sí, **con la excepción
de `CATEGORY` + `DELETE`**. Literal: «Sí, y solo para CATEGORY: un CATEGORY con
operation DELETE deja de limpiar la clave, y CURRENCY sigue limpiando porque su
handler ignora la operacion y siempre hace upsert». La pregunta era si limpiar
la clave (a) o dejar el conjunto de solo-crecer (b); se eligió (a), y un
`code-review` sobre el diff encontró el hueco que (a) tenía tal como estaba
escrita: `handleCategory` responde `processed` **sin escribir nada** cuando un
`DELETE` no encuentra la fila (`misc.ts:131-132`), así que «terminó bien» no
significaba «la fila existe». R13 lleva la excepción y su razonamiento; E19 es
el escenario que la fija. Se deja aquí, y no borrada, porque es el registro de
por qué la regla tiene una esquina que nadie adivinaría leyendo solo el
contrato.

## No decidido a propósito

1. **Dónde vive el estado del arrastre y qué forma tiene** (dos `Set` en el
   bucle, un `Map` por entidad, una función pura extraída y probada aparte, o un
   módulo nuevo). Es de `sdd-architect`. Lo que no se negocia: R8 (el handler no
   se llama) y R12 (no aporta a la invalidación).
2. **Si el desvío se expresa lanzando `SyncEventFailure`
   (`src/features/sync/server/handlers/types.ts:71`) y dejando que el `catch` de
   siempre lo convierta, o empujando directamente a `failed[]`/`results`.** Las
   dos producen la misma respuesta; la primera reutiliza el camino existente y
   la segunda evita lanzar para un caso previsto. Del arquitecto.
3. **El reparto exacto de las pruebas entre archivos** —extender
   `src/features/sync/server/processBatch.test.ts` o abrir uno nuevo, y en qué
   `*.db.test.ts` viven C1-C8—, y cuál de las dos palancas de fallo se usa. Del
   arquitecto y del `sdd-tester`, con lo que ya quedó medido en § Criterios.
4. **Si el `console.warn` de diagnóstico del arrastre existe o no.** R20 dice
   qué forma tendría si existe; que haga falta es del arquitecto.
