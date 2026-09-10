---
feature: F-045
agente: sdd-spec
actualizado: 2026-09-10T04:14:22Z
estado: listo
---

> Transposición de la propuesta ya aceptada
> `.agent/specs/propuestas/store-escribe-el-negocio-antes-de-las-guardas.md`
> (§ «Respuestas del humano (2026-09-10)»: SP1-SP5 contestadas). Todas las
> rutas y líneas que se citan aquí se **volvieron a abrir** contra el árbol de
> hoy; las que se habían movido están corregidas y anotadas en § Incongruencias
> (SI6, y SI1-SI8 en conjunto). Depende de F-043, que ya tiene
> `passes: true`.

## Problema

`handleStore` escribe dos columnas del negocio —`Business.name` y
`Business.baseCurrencyCode`— como su **primera** sentencia, antes de leer la
sucursal y antes de toda guarda
(`src/features/sync/server/handlers/store.ts:74-78`). Nadie usa el resultado.
Por eso un evento `STORE` que el sistema reporta como `failed`, como
`skipped_not_published` o —lo peor— como `stale` **ya escribió**: la guarda
anti-rancio de `:116-121` existe para que un evento viejo reentregado no pise
datos nuevos y estas dos columnas se la saltan por estar escritas tres líneas
antes.

Importa porque `Business.baseCurrencyCode` no es cosmético: es la moneda en la
que se pinta el catálogo (`src/features/catalog/server/queries.ts:144,183`), la
frase «Cobramos en X» de `src/app/[slug]/layout.tsx:156`, la moneda con la que
`src/features/orders/server/quote.ts:132,142` cotiza un pedido y `resolvePrice`
convierte importes, y el «El monto se entiende en …» del panel del comerciante
(`src/features/admin/server/stores.ts:97,111` →
`src/features/admin/components/PromotionForm.tsx:169`). Y los caminos que
escriben de más son justo los que **no** revalidan —vuelven sin
`touchedStoreSlug`, `src/features/sync/server/handlers/types.ts:57-59`, así que
`src/features/sync/server/processBatch.ts:133` no invalida nada—, de modo que
la portada (ISR 3600 s, `src/app/[slug]/layout.tsx:33`) y el catálogo
(`revalidate = 0`) pueden discrepar de moneda durante una hora.

Es la incongruencia **I4** que F-043 dejó escrita, medida y **no** arreglada
(`.agent/specs/F-043/spec.md:517-524` y `.agent/specs/F-043/architecture.md:197-229`,
AD4; decisión AP1=(a) del humano el 2026-09-09).

## Alcance

### Dentro

1. Que `Business.name` y `Business.baseCurrencyCode` se escriban **solo** cuando
   el evento `STORE` va a aplicar algo, en los tres caminos que escriben:
   despublicación de una sucursal existente (`prisma.store.update` de
   `src/features/sync/server/handlers/store.ts:140-159`), alta de sucursal nueva
   (`createStorefrontWithStore`, `:226-241`) y actualización de una existente
   (`prisma.store.update`, `:271-292`).
2. La forma del arreglo ya está elegida por el humano (SP2 → **opción (a)**): un
   helper **privado** en el mismo archivo, llamado justo antes de cada una de
   las tres escrituras, exactamente donde el archivo ya coloca
   `assertDeliveryConsistent` (`:137`, `:213`, `:260`) y `assertZoneKnown`
   (`:138`, `:214`, `:261`), y donde sus docstrings declaran esa colocación como
   doctrina («Called HERE, right before the write it guards, never once at the
   top», `:341-342` y `:366-369`).
3. Que **ninguna respuesta HTTP cambie**: mismos códigos, mismos `status`,
   mismos `error`, mismo `ok`/`failed`/`results`, mismo `SyncEvent.status`.
4. Invertir el aserto de I4 de F-043
   (`src/features/sync/server/handlers/business.db.test.ts:673-676`) y reescribir
   su comentario de `:673` y el título del `it(` de `:646` para que digan que
   F-045 corrigió I4 (SP3 → sí, en el mismo commit).
5. Reescribir los dos comentarios que hoy documentan el defecto y dejarán de ser
   ciertos: el de `src/features/sync/server/handlers/store.ts:71-73` y la nota de
   I4 de `src/constants/sync.ts:136-139`.
6. Subir `docs/sync-contract.md` a **v13.3** (SP4 → menor) y devolverle la
   promesa fuerte: § Datos y contrato de esta spec.

### Fuera (explícito)

- **Mover, adelantar o retrasar cualquier guarda.** `assertDeliveryConsistent`,
  `assertZoneKnown`, `assertOpeningHoursValid` (`:205`) y las dos
  comprobaciones de `timezone` (`:219-221`, `:268-270`) se quedan **exactamente**
  donde están. Llamarlas al principio convertiría `SKIPPED` y `STALE` en
  `failed[]`, contra E9/E12 de F-041, contra los comentarios de `:133-136` y
  `:256-259` y contra `.agent/specs/F-043/architecture.md:221-224`.
- **El `.default("CUP")` de `baseCurrency`**
  (`src/features/sync/schemas.ts:42`). Es un defecto real y **distinto**
  —omitir la moneda la reinicia a `CUP` también en un evento que se aplica— y
  quitarlo es una **mayor** del contrato, que hoy promete el default
  explícitamente (`docs/sync-contract.md:2146`). SP5 lo sacó de aquí: va como
  F-046, con su propia propuesta en
  `.agent/specs/propuestas/baseCurrency-omitido-cae-en-cup.md`.
- **Una marca anti-rancio propia para el negocio.** Sin una columna nueva (y su
  migración), dos sucursales del mismo negocio entregadas fuera de orden siguen
  resolviéndose por «gana el último que llegue» — propiedad que el propio
  contrato ya declara asumida en `docs/sync-contract.md:1286`. Este feature no
  la cambia: solo saca de esa carrera a los eventos que ni siquiera se aplican.
- **Envolver `handleStore` en `$transaction`** (opción (d) de la propuesta).
  Descartada por el humano y prohibida por AGENTS.md § Cosas que muerden: el
  pooler de Supabase corre en modo transacción y el cliente global hace deadlock
  dentro de un `$transaction`. Es la misma razón que ya está escrita en
  `src/features/sync/server/handlers/business.ts:36-37`.
- **El `nested write` de Prisma** (opción (b)): queda como **optimización
  posterior**, no como arreglo, porque el camino de alta pasa por
  `createStorefrontWithStore` (`src/features/storefront/server/registry.ts:70`),
  que es componente compartido y no tiene dónde plegarse.
- **Dejar de escribir `Business.name` desde `STORE`** aunque hoy no lo lea nadie
  en `src/`. Es una decisión de propiedad de campos con el otro equipo, no de
  posición de una escritura, y la tabla de propiedad del contrato se la asigna
  a cuadrecaja.
- **`handleBusiness`** (`src/features/sync/server/handlers/business.ts`): sigue
  siendo dueño de `displayCurrencies` y sigue sin tocar `name`/
  `baseCurrencyCode` (su R10, `:41-42`).
- **Reparar los negocios que ya tengan la moneda mal** por este defecto. Sin
  backfill: § No decidido.
- **F-044** (reconciliación del tarifario). Sin relación. Este feature entra
  **antes** (SP1).
- **Ningún cambio de schema.** `prisma/schema.prisma:153` (`name`) y `:160`
  (`baseCurrencyCode`) se quedan como están.

## Actores y precondiciones

Lo dispara el POS de cuadrecaja enviando un evento `STORE` a
`POST /api/internal/sync/catalog`
(`src/app/api/internal/sync/catalog/route.ts`) con el token Bearer del negocio.

Precondiciones, todas anteriores al handler:

- El `Business` **existe**: nace al acuñarle su token
  (`src/features/sync/server/provisioning.ts:47`), nunca por un payload — R8 de
  F-018 (`.agent/specs/F-018/spec.md:312-314`).
- El lote pasó autenticación (`resolveCaller`,
  `src/features/sync/server/caller.ts:31-42`) y la comprobación de coherencia de
  `businessId` (`route.ts:39-41`), y pasó el schema del sobre (`route.ts:31-37`):
  lo que no pasa el schema es un `400` y **no llega** al handler.
- `businessId` es la identidad **interna** ya autenticada, nunca
  `payload.businessId`.

Escritores de estas dos columnas en todo `src/`, comprobado con
`grep -rn "business\.\(update\|upsert\|create\)" src --exclude-dir=generated`:
solo `src/features/sync/server/handlers/store.ts:74` y el alta de
`src/features/sync/server/provisioning.ts:47`.
`src/features/sync/server/handlers/business.ts:83` y
`src/features/sync/server/provisioning.ts:68` son `updateMany` sobre otras
columnas.

## Comportamiento esperado

`E1-E6` **cambian** con este feature; `E7-E12` describen lo que **no** puede
cambiar. En todos, «las dos columnas» significa `Business.name` y
`Business.baseCurrencyCode` de la fila del negocio autenticado.

- **E1 (rancio) — cambia.** Dado un negocio con `name: "Nombre NUEVO"` y
  `baseCurrencyCode: "USD"`, y una sucursal suya con
  `sourceUpdatedAt` posterior o igual al `updatedAt` de un evento `STORE` que
  trae `businessName: "Nombre VIEJO"` y `baseCurrency: "CUP"`, cuando se procesa
  ese evento, entonces la respuesta es `207`, el evento aparece en `ok` con
  `status: "stale"`, `Store.sourceUpdatedAt` no se mueve **y** las dos columnas
  siguen valiendo `"Nombre NUEVO"` / `"USD"`. Hoy quedan en
  `"Nombre VIEJO"` / `"CUP"` (medición M1 de la propuesta).
- **E2 (`STORE_ZONE_UNKNOWN`) — cambia.** Dado un evento `STORE` cuyo `zoneCode`
  no está en el catálogo publicado **o** no tiene la forma del DPA (las dos
  causas caen en la misma guarda desde F-043), cuando se procesa, entonces
  responde `207` con ese evento en `failed[]` con `STORE_ZONE_UNKNOWN` y las dos
  columnas quedan **idénticas** a las leídas antes de la petición.
- **E3 (`STORE_OPENING_HOURS_INVALID`) — cambia.** Igual que E2, con un
  `openingHours` que no pasa `openingHoursSchema` (`src/lib/openingHours.ts`).
- **E4 (`STORE_DELIVERY_CONFIG_INCONSISTENT`, forma `207`) — cambia.** Igual que
  E2, con un `payload` que **solo mezclado con la fila guardada** resulta
  contradictorio (la forma `400` la corta el `refine` del sobre y no llega al
  handler).
- **E5 (`STORE_TIMEZONE_INVALID`) — cambia.** Igual que E2, en el camino de
  republicación (`store.ts:268-270`): una sucursal `SUSPENDED` cuyo `timezone`
  no es legible por este runtime y un evento con `publishToStore: true`.
- **E6 (`skipped_not_published`) — cambia.** Dado (a) un evento `STORE` cuya
  sucursal pertenece a **otro** negocio (colisión de `externalId`,
  `store.ts:112`) o (b) un evento que despublica una sucursal que aquí no existe
  (`store.ts:132`), cuando se procesa, entonces responde `207` con
  `status: "skipped_not_published"` **y** no mueve ninguna de las dos columnas.
- **E7 (actualización que se aplica) — sin cambio.** Dado un evento `STORE`
  válido sobre una sucursal ya publicada, cuando se procesa, entonces responde
  `processed` y las dos columnas quedan con `payload.businessName` y
  `payload.baseCurrency`.
- **E8 (alta) — sin cambio.** Dado el primer `STORE` de una sucursal (la marca y
  la sucursal se crean en el mismo evento), cuando se procesa, entonces responde
  `processed`, se crea la marca **y** las dos columnas quedan con los valores del
  payload. Es literalmente E16 de F-018
  (`.agent/specs/F-018/spec.md:217-221`).
- **E9 (despublicación que se aplica) — sin cambio.** Dado un `STORE` con
  `publishToStore: false` sobre una sucursal existente, o un
  `operation: "DELETE"`, cuando se aplica, entonces responde `processed` y las
  dos columnas quedan con los valores del payload: un evento que despublica
  sigue configurando (E10 de F-022), y el nombre del negocio es información del
  negocio, no de la publicación.
- **E10 (lote mixto) — cambia el resultado observable.** Dado un lote con dos
  eventos `STORE` del **mismo** negocio y de **sucursales distintas**, uno que se
  aplica con `businessName: "BUENO"` / `baseCurrency: "USD"` y otro que falla con
  `businessName: "MALO"` / `baseCurrency: "CUP"`, cuando se procesa, entonces el
  valor final de las dos columnas es `"BUENO"` / `"USD"` **sea cual sea el orden
  de los dos eventos dentro del lote**. Hoy gana el último que se procese. Un
  `STORE` no `requires` nada (`src/features/sync/dependencies.ts:69-74`), así que
  el fallo de uno nunca bloquea al otro y las dos permutaciones son alcanzables.
- **E11 (`DEPENDENCY_FAILED_IN_BATCH`) — sin cambio.** Un evento bloqueado por
  una dependencia caída del mismo lote falla en
  `src/features/sync/server/processBatch.ts:93`, **antes** de entrar al handler,
  así que hoy tampoco escribe. Ningún `STORE` puede llegar aquí hoy —`STORE` no
  `requires` nada—, pero el escenario queda fijado para que nadie lo mueva.
- **E12 (respuestas intactas) — sin cambio, y es la red de seguridad.** Para
  E1-E11, el código HTTP, el `status`, el `error`, la pertenencia a
  `ok`/`failed`/`results` y el `SyncEvent.status`/`SyncEvent.error` escritos son
  **idénticos** antes y después del arreglo.

## Reglas de negocio

- **R1 — Las dos columnas se escriben si y solo si el evento escribe algo.** Ni
  antes de una guarda, ni en un camino que devuelve sin escribir. Es la regla
  que define el feature.
- **R2 — La escritura va inmediatamente antes de cada una de las tres
  escrituras de sucursal**, después de todas las guardas de ese camino, en la
  misma posición que ya ocupan `assertDeliveryConsistent` y `assertZoneKnown`.
  No hay una cuarta llamada ni una llamada compartida al principio.
- **R3 — Ninguna respuesta cambia** (E12). Ni el cuerpo, ni el código, ni lo que
  se escribe en `SyncEvent`.
- **R4 — R8/E16 de F-018 se conservan literalmente.** La escritura apunta a
  `businessId` —la identidad autenticada—, nunca a `payload.businessId`; es un
  `update`, nunca un `upsert`; el sync **no crea negocios**.
- **R5 — Ninguna guarda se mueve.** Ni al principio, ni a otro sitio, ni se
  duplica.
- **R6 — El número de escrituras no sube.** Un `STORE` que se aplica llama a
  `prisma.business.update` **exactamente una** vez, igual que hoy; uno que
  devuelve `stale`, `skipped_not_published` o `failed` lo llama **cero** veces,
  una menos que hoy.
- **R7 — Idempotencia intacta.** Reenviar el mismo evento sigue dejando el mismo
  estado final, como exige AGENTS.md § Cosas que muerden para todo lo que
  escribe el sync.
- **R8 — La guarda anti-rancio de `STORE` sigue siendo de la forma que
  RECHAZA**, no la de orden de `EXCHANGE_RATE` (AGENTS.md § Cosas que muerden;
  ADR 0030). Este feature amplía su cobertura a dos columnas más; no cambia su
  mecanismo.
- **R9 — El contrato sube un dígito MENOR: v13.2 → v13.3** (SP4). Menor porque
  no cambia nada de lo que el POS envía ni recibe, y porque el POS no puede
  observar esas dos columnas: no hay lectura de vuelta y el hash de
  reconciliación del § ⑤ cubre productos, nunca el negocio. La v13 sigue sin
  publicar (`docs/sync-contract.md:3-8`), así que cada edición es una revisión
  del mismo borrador — la misma lógica con la que la v13.1 y la v13.2 se
  numeraron (`docs/sync-contract.md:67-70`).
- **R10 — El aserto de I4 de F-043 se invierte, no se borra.** Las otras
  aserciones de esa misma prueba —que no hay `400` de lote, que el evento vuelve
  en `failed[]` con `STORE_ZONE_UNKNOWN` y que `Store.zoneCode` sigue `null`—
  sostienen el criterio 3 de F-043 y **no se tocan**. La regla 3 del backlog
  protege los `acceptance_criteria` escritos, no las pruebas (SP3).

## Casos límite y errores

Numerados `CL1..CL9`, estables para que el arquitecto y el probador los citen.

1. **CL1 — `operation: "DELETE"`.** Sale por la rama de despublicación
   (`store.ts:167-169`), que **sí** escribe la sucursal; las dos columnas se
   aplican con ella. Sin cambio (E9). Además borra el tarifario de esa sucursal,
   que este feature no toca.
2. **CL2 — Un lote con dos `STORE`, uno bueno y uno malo.** E10. Para que el
   aserto distinga algo, los dos eventos tienen que llevar **valores distintos**
   de `businessName`/`baseCurrency` y apuntar a **sucursales distintas**: dos
   eventos sobre la misma sucursal harían `stale` al segundo y el escenario
   dejaría de ser el que se quiere medir.
3. **CL3 — Un lote de N `STORE` todos fallidos.** Hoy son N `UPDATE` inútiles;
   después, cero. No necesita prueba propia aparte de R6.
4. **CL4 — Reintento del mismo evento fallido.** El outbox de cuadrecaja
   reentrega hasta seis veces por fila (`QAB_OUTBOX_MAX_ATTEMPTS = 6`, notas de
   F-043): hoy son seis escrituras del negocio, después ninguna. El re-procesado
   de `SyncEvent` no cambia (R4/E15 de F-043).
5. **CL5 — Un evento rancio reentregado sobre un negocio que otro evento acaba
   de actualizar.** Es E1 y es el caso que justifica el feature por sí solo: hoy
   retrocede la moneda base y lo reporta dentro de `ok`, o sea en silencio.
6. **CL6 — El `throw new Error(...)` genérico de `store.ts:245-247`.** Es la
   decimotercera salida del handler y **no** es un `SyncEventFailure`, así que su
   mensaje interno viaja tal cual al `failed[].error` del POS
   (`src/features/sync/server/processBatch.ts:125-127`). Es inalcanzable en la
   práctica (`proposedSlug: null` nunca se rechaza, E14 de F-017). Después del
   arreglo tampoco escribiría, porque queda **después** de la llamada al helper
   solo en el camino de alta: el implementador tiene que colocar la llamada
   antes de `createStorefrontWithStore` y aceptar que, si esa creación fallara,
   las dos columnas quedarían escritas sin sucursal creada. Es idéntico al riesgo
   que ya se corre con cualquier error de base en las otras dos escrituras y no
   se resuelve sin transacción, que está fuera de alcance.
7. **CL7 — Un error de base en la escritura de la sucursal.** Con el arreglo, las
   dos columnas ya están escritas cuando la escritura de sucursal revienta. Es
   una ventana **estrictamente más pequeña** que la de hoy (hoy están escritas
   siempre) y no se cierra sin `$transaction`. Aceptado a propósito; anotado en
   § No decidido.
8. **CL8 — Concurrencia.** Dos lotes del mismo negocio a la vez siguen
   resolviéndose por «gana el último», igual que hoy y que
   `docs/sync-contract.md:1286`. Fuera de alcance.
9. **CL9 — Un negocio cuya moneda base ya está mal por este defecto.** El
   arreglo no la repara; el siguiente `STORE` que se aplique la deja bien. Sin
   backfill (§ No decidido).

## Datos y contrato

**Sin migración, sin endpoint nuevo, sin campo nuevo.** Ni una línea de
`prisma/schema.prisma`: `Business.name` (`:153`) y `Business.baseCurrencyCode`
(`:160`, `String @default("CUP")`) se quedan como están.

**`docs/sync-contract.md` sube de v13.2 a v13.3** (R9, SP4). Hay que tocar la
primera línea de versión (`:3`) o el hook
`.claude/hooks/sync-contract-version.sh` protesta, como exige AGENTS.md
§ Documentación. Los tres sitios, todos en la dirección de **quitar** salvedades:

1. **§ «`zoneCode` en el `payload` de `STORE`»,
   `docs/sync-contract.md:230-240`.** Se va la frase «**El nombre del negocio y
   su moneda base sí pueden haberse escrito**: `handleStore` los actualiza en su
   primera línea, antes de esta o de cualquier otra guarda — defecto preexistente
   desde la v9 (I4 de …), que F-043 hace alcanzable con una causa más y no
   arregla» (`:234-238`), y el «**de la sucursal**» de `:233` vuelve a ser un
   simple «ninguno de sus otros campos se aplica».
2. **La fila de `STORE_ZONE_UNKNOWN` de la tabla de respuestas,
   `docs/sync-contract.md:1892`.** Fuera el inciso «`Business.name`/
   `baseCurrencyCode` sí pueden haberse escrito (I4, ver § …)» y el «de la
   sucursal» del mismo renglón.
3. **Una entrada nueva en § «Cambios respecto a la v12.2»
   (`docs/sync-contract.md:49`)**, donde ya viven las de la v13, v13.1 y v13.2.

**Dos filas que NO hay que tocar porque el arreglo las vuelve verdad**: la de
`STORE_OPENING_HOURS_INVALID` (`docs/sync-contract.md:1885`), que promete
«ninguno de sus campos se aplica —tampoco un `name` o un `phone` que viajaran
con él—», y la de `STORE_DELIVERY_CONFIG_INCONSISTENT`
(`docs/sync-contract.md:1883`), que promete «No escribe nada». Hoy las dos
mienten; después son exactas. Ver SI3.

**Estado de partida verificable del criterio 7, comprobado hoy:**

| Comando                                            | Hoy | Tras F-045 |
| -------------------------------------------------- | --- | ---------- |
| `grep -c 'Business.name' docs/sync-contract.md`    | 1   | 0          |
| `grep -c 'I4' docs/sync-contract.md`               | 2   | 0          |
| `grep -c 'baseCurrencyCode' docs/sync-contract.md` | 1   | 0          |

La única línea que `grep 'Business.name'` encuentra es la **1892**, confirmado.
Pero **`grep -c 'Business.name'` a 0 es necesario y no suficiente**: la salvedad
de I4 tocó **dos** sitios del contrato, y el segundo
(`docs/sync-contract.md:234-238`) la escribe en prosa castellana —«El nombre del
negocio y su moneda base»— sin usar el identificador, así que ese grep no lo ve.
El que los cubre a los dos es `grep -c 'I4'`, que hoy da **2** (`:237` y
`:1892`). El criterio 7 nombra explícitamente los dos sitios, así que el grep de
`I4` es su comprobación completa, no un añadido.

## Criterios de aceptación propuestos

Los ocho son los de `.agent/features.json`, **literales y sin ablandar**
(marcados `[ya]`). Bajo cada uno, cómo se comprueba **ejecutando**.

1. `[ya]` «Un STORE rechazado con STORE_ZONE_UNKNOWN deja Business.name y
   Business.baseCurrencyCode exactamente como estaban, leidas antes y despues de
   la peticion, y la respuesta sigue siendo 207 con ese evento en failed[] con
   ese codigo.»
   **Cómo:** por la ruta HTTP real, contra Postgres. `createFixtureSession`,
   `prisma.business.findUniqueOrThrow({ select: { name, baseCurrencyCode } })`
   antes; `POST /api/internal/sync/catalog` con un `STORE` de `zoneCode: "99.99"`
   (bien formado, ausente del catálogo) o `"2101"` (mal formado) y un
   `businessName`/`baseCurrency` **distintos** de los de la fila; la misma
   lectura después. Asertos: `status === 207`,
   `results[0] === { eventId, status: "failed", error: "STORE_ZONE_UNKNOWN" }`,
   `after` **igual** a `before`.
   Ejecución: `npx vitest run --project db <archivo>`; en el sensor entra por
   `bash .agent/verify.sh F-045`.
2. `[ya]` «Lo mismo, con su propia peticion y sus dos lecturas, para
   STORE_OPENING_HOURS_INVALID, para STORE_DELIVERY_CONFIG_INCONSISTENT en su
   forma de 207 y para STORE_TIMEZONE_INVALID: los cuatro codigos de error de
   STORE dejan las dos columnas intactas.»
   **Cómo:** tres peticiones más, cada una con su par de lecturas.
   `STORE_OPENING_HOURS_INVALID`: `openingHours` que no pasa
   `openingHoursSchema`. `STORE_DELIVERY_CONFIG_INCONSISTENT` en `207`: un
   `payload` que solo es contradictorio **mezclado con la fila**, no por sí solo
   (por sí solo lo corta el `refine` del sobre con un `400`).
   `STORE_TIMEZONE_INVALID`: la receta ya escrita en
   `src/features/sync/server/handlers/storePublishGate.db.test.ts:59-62` —una
   sucursal `SUSPENDED` más
   `UPDATE "Store" SET "timezone" = 'Nowhere/Nothing'` por `$executeRaw`— y luego
   un evento con `publishToStore: true`. En los cuatro, `after` igual a `before`.
3. `[ya]` «Un STORE rancio responde stale dentro de ok y las dos columnas
   conservan los valores NUEVOS: partiendo de name 'Nombre NUEVO' y
   baseCurrencyCode 'USD' y enviando un evento viejo que trae 'Nombre VIEJO' y
   'CUP', la lectura posterior sigue diciendo 'Nombre NUEVO' y 'USD'.»
   **Cómo:** montar la fila con esos dos valores exactos y la sucursal con
   `sourceUpdatedAt` posterior al `updatedAt` del evento; enviar el evento viejo;
   asertar `status === 207`, `body.ok` contiene el `eventId`,
   `results[0].status === "stale"`, `Store.sourceUpdatedAt` sin mover, y la
   lectura posterior `{ name: "Nombre NUEVO", baseCurrencyCode: "USD" }`.
   **Nota para el probador:** el helper `storeEvent` de
   `src/features/sync/server/handlers/business.db.test.ts:140-164` fija
   `businessName: "Negocio F-043"` y `baseCurrency: "CUP"` a pelo, y
   `readBusiness` (`:180-185`) solo selecciona `displayCurrencies`. Los dos hay
   que ampliarlos con parámetros opcionales; no basta con reusarlos tal cual.
4. `[ya]` «Un STORE de una sucursal de otro negocio y un STORE que despublica
   una sucursal inexistente responden skipped_not_published y no mueven ninguna
   de las dos columnas, verificado leyendolas despues.»
   **Cómo:** dos peticiones. (a) Un `STORE` cuyo `storeId` es el `externalId` de
   una sucursal de **otra** sesión de fixture (`store.ts:112`). (b) Un `STORE`
   con `publishToStore: false` y un `storeId` que no existe (`store.ts:132`).
   En las dos: `results[0].status === "skipped_not_published"` y `after` igual a
   `before`.
5. `[ya]` «Un STORE que si se aplica las sigue escribiendo en los tres caminos
   —alta de sucursal nueva, actualizacion de una publicada y despublicacion de
   una existente—, verificado leyendo las dos columnas tras cada uno; y en un
   lote con un STORE bueno y otro que falla, el valor final es el del bueno, sea
   cual sea el orden de los dos eventos en el lote.»
   **Cómo:** tres peticiones que se aplican, cada una con `businessName`/
   `baseCurrency` propios y su lectura posterior: alta (`storeId` nuevo,
   `publishToStore: true`), actualización (sucursal ya `PUBLISHED`) y
   despublicación (`publishToStore: false` sobre una existente). Más **dos**
   peticiones para la segunda mitad: el mismo lote de dos `STORE` de sucursales
   distintas, uno bueno («BUENO»/`USD`) y uno con `zoneCode` desconocido
   («MALO»/`CUP`), enviado en los **dos** órdenes; en ambos, la lectura final da
   «BUENO»/`USD`. Ver CL2.
6. `[ya]` «El numero de escrituras no sube: contadas con el mock de
   src/features/sync/server/handlers/store.test.ts, un STORE que se aplica llama
   a business.update una vez, y uno que devuelve stale, skipped_not_published o
   failed lo llama cero veces.»
   **Cómo:** con el mock `businessUpdate` que ese archivo ya tiene
   (`src/features/sync/server/handlers/store.test.ts:23` y `:32-33`), reseteado
   en su `beforeEach` (`:104`). En el camino que se aplica,
   `expect(businessUpdate).toHaveBeenCalledOnce()` además del
   `toHaveBeenCalledWith({ where: { id: BUSINESS_ID } })` que ya vive en
   `:144-146`. En `stale`, `skipped_not_published` y `failed`,
   `expect(businessUpdate).not.toHaveBeenCalled()` — el caso de otro negocio ya
   está montado en `:149-160` y hoy solo asertaba `storeUpdate`.
   Ejecución: `npx vitest run --project server src/features/sync/server/handlers/store.test.ts`.
7. `[ya]` «docs/sync-contract.md sube a v13.3 retirando la salvedad de I4 del §
   de zoneCode en el payload de STORE y de la fila de STORE_ZONE_UNKNOWN, con su
   entrada en 'Cambios respecto a la v12.2'; grep -c 'Business.name'
   docs/sync-contract.md da 0.»
   **Cómo:** `grep -n 'Versión 13.3' docs/sync-contract.md` da la línea 3;
   `grep -c 'Business.name' docs/sync-contract.md` da `0` (hoy `1`, línea 1892);
   `grep -c 'I4' docs/sync-contract.md` da `0` (hoy `2`, líneas 237 y 1892), que
   es lo que cubre **también** el § de `zoneCode`; y la entrada nueva aparece
   bajo `docs/sync-contract.md:49`. El hook
   `.claude/hooks/sync-contract-version.sh` no protesta. Ver § Datos y contrato
   para por qué el grep de `Business.name` solo no basta.
8. `[ya]` «bash .agent/verify.sh F-045 --full termina con codigo 0.»
   **Cómo:** `bash .agent/verify.sh F-045 --full; echo $?` imprime `0`.
   Incluye `npm run format:check`, que es lo que valida el CI también sobre los
   `.md` de `.agent/` y sobre `docs/sync-contract.md`.

## Incongruencias detectadas

Prefijo `SI` (las `I…` de la propuesta se conservan con su número entre
paréntesis para poder cruzarlas).

- **SI1 (era I1) — El comentario de
  `src/features/sync/server/handlers/store.ts:71-73` justifica con «R8/E16» algo
  que R8 y E16 no dicen.** R8 (`.agent/specs/F-018/spec.md:312-314`) dice que el
  sync no crea negocios y que solo actualiza el autenticado; E16
  (`.agent/specs/F-018/spec.md:217-221`) dice que un `STORE` que llega antes de
  que exista ninguna tienda actualiza `name` y `baseCurrencyCode` del negocio ya
  existente y **no crea ningún `Business`**. **Ninguna de las dos habla de la
  posición** de la escritura: hablan de a qué fila apunta y de que no crea filas.
  La posición es un residuo histórico —en `613b254` era un `upsert` cuyo
  resultado hacía falta abajo; `12eacc8` lo volvió `update` y lo dejó en el
  sitio—. Verificado hoy leyendo el archivo entero: nada por debajo de `:78`
  depende de esa llamada, y su `select: { id: true }` es vestigial. El comentario
  se reescribe (§ Alcance, punto 5).
- **SI2 (era I4bis) — La lista de salidas de `handleStore` que circula en los
  documentos está incompleta.** Entre `:78` y el final hay **trece** salidas
  nombradas, más cualquier error de base: tres retornos tempranos (`:112`,
  `:120`, `:132`), **tres** `assertDeliveryConsistent` (`:137`, `:213`, `:260`),
  **tres** `assertZoneKnown` (`:138`, `:214`, `:261`), un
  `assertOpeningHoursValid` (`:205`), **dos** comprobaciones de `timezone`
  (`:219-221`, `:268-270`) y el `throw new Error` genérico de `:245-247`. Lo que
  se suele citar son los sitios donde el `throw` está **definido** (`:351`,
  `:374`, `:389`), no donde se **llama**, y para quien tiene que mover algo son
  cosas distintas.
- **SI3 (era I2) — El contrato solo se corrigió en uno de los cuatro sitios donde
  miente, y no se arreglan debilitándolos.** La v13.2 debilitó § `zoneCode`
  (`docs/sync-contract.md:233-238`) y la fila de `STORE_ZONE_UNKNOWN` (`:1892`),
  pero la fila de `STORE_OPENING_HOURS_INVALID` (`:1885`) sigue prometiendo
  «ninguno de sus campos se aplica —tampoco un `name` o un `phone`—» y la de
  `STORE_DELIVERY_CONFIG_INCONSISTENT` (`:1883`) sigue diciendo «No escribe
  nada». Las dos son falsas hoy y por la misma causa. Este feature las vuelve
  verdad **sin tocarlas**. Precisión sobre la propuesta: el docstring gemelo
  vive en `src/constants/sync.ts:30-32`, no en `:29-32`, y solo para
  `STORE_OPENING_HOURS_INVALID`; el de
  `STORE_DELIVERY_CONFIG_INCONSISTENT` (`:15-22`) no repite esa promesa.
- **SI4 (era I3) — `baseCurrency` tiene un `.default("CUP")` que convierte
  «omitir» en «reiniciar».** `src/features/sync/schemas.ts:42` es
  `z.string().length(3).default("CUP")`, así que un `STORE` sin ese campo pone la
  moneda base en `CUP` aunque el negocio fuera `USD` (medición M2 de la
  propuesta). Choca con la doctrina «omitir no es apagar» que la ADR 0028 y el
  propio contrato aplican a las cinco columnas de compra y a `zoneCode`
  (`docs/sync-contract.md:222-228`). Hoy es **contrato**, no bug
  (`docs/sync-contract.md:2146`). **Fuera de F-045 por decisión del humano
  (SP5)**: va como F-046, propuesta en
  `.agent/specs/propuestas/baseCurrency-omitido-cae-en-cup.md`. Queda anotado
  aquí porque cambia lo que el criterio 2 puede afirmar: un evento rechazado que
  **omita** `baseCurrency` seguirá siendo `CUP` en el payload parseado, pero con
  F-045 ya no llegará a la columna.
- **SI5 (nueva, precisión sobre la propuesta) — `Business.baseCurrencyCode`
  tiene un consumidor más de los tres que la propuesta listó.** Además de
  `src/features/catalog/server/queries.ts:144,183`,
  `src/app/[slug]/layout.tsx:156` y `src/features/orders/server/quote.ts:132,142`,
  lo lee el **panel del comerciante**:
  `src/features/admin/server/stores.ts:97,111` lo sirve a
  `src/features/admin/components/PromotionForm.tsx:169` («El monto se entiende en
  X, la moneda base de tu negocio») y a las tres páginas de promociones de
  `src/app/admin/tiendas/[storeId]/`. No cambia el veredicto de gravedad; sí
  amplía a quién se le miente. En cambio se confirma lo otro: **`Business.name`
  tiene cero lectores** en `src/` fuera del propio handler que lo escribe, los
  tests y las fixtures — las seis consultas a `Business` seleccionan otra cosa
  (`src/app/admin/sso/route.ts:41-44`, `src/features/sync/server/caller.ts:32-35`
  y `:51-54`, `src/features/sync/server/provisioning.ts:80-83`, y los tres
  `select` anidados de arriba).
- **SI6 (nueva, de líneas) — Tres citas de la propuesta se habían movido o
  estaban redondeadas.** La nota de I4 en las constantes es
  `src/constants/sync.ts:136-139`, no `:137-139` (la frase empieza a mitad de la
  `:136`; el literal `store.ts:74-78` está en la `:138`). El `throw` genérico es
  `store.ts:245-247`, no `:244-248` (la `:244` es el `if (!created.ok) {`). Y el
  párrafo de § `zoneCode` del contrato es `docs/sync-contract.md:230-240`, con la
  salvedad en `:234-238`, no `:228-239`. Las demás —`store.ts:71-78`, `:138`,
  `:221`, `:270`, `business.db.test.ts:673-676`, `schemas.ts:42`,
  `docs/sync-contract.md:1883`, `:1885`, `:1892`, `:2146`, `:49`,
  `F-018/spec.md:312` y `:217-221`— **están donde la propuesta las dejó**.
- **SI7 (nueva) — El criterio 7 pide un grep que no cubre todo lo que el propio
  criterio nombra.** `grep -c 'Business.name' docs/sync-contract.md` solo ve la
  fila `:1892`; la salvedad del § `zoneCode` (`:234-238`) está escrita en prosa y
  ese grep la deja pasar a 0 sin haberla tocado. **No se ablanda el criterio** ni
  se cambia (regla 3): se le añade la comprobación que sí lo cubre,
  `grep -c 'I4' docs/sync-contract.md` a 0, en § Datos y contrato y en el
  criterio 7 de esta spec.
- **SI8 (nueva, del propio arreglo) — Se cambia una ventana de fallo por otra
  más pequeña, y conviene decirlo en voz alta.** Hoy las dos columnas se
  escriben **siempre**; con el arreglo se escriben justo **antes** de la
  escritura de la sucursal, así que un error de base en esa segunda escritura
  las deja aplicadas sin sucursal escrita (CL6, CL7). Cerrar esa ventana exige
  `$transaction`, que está prohibida por el pooler y fuera de alcance. Es
  estrictamente mejor que hoy y no hace falta decidir nada: queda escrito para
  que nadie lo descubra probando.

## Huecos y preguntas al humano

**Ninguna. No queda ninguna pregunta abierta, y eso es información, no un
hueco.** Las cinco que la propuesta dejó —`SP1` (entra como F-045 y antes de
F-044), `SP2` (opción (a), helper privado; (d) descartada, (b) como optimización
posterior), `SP3` (sí, se invierte el aserto de F-043), `SP4` (v13.3, menor, y la
v13 se publica después) y `SP5` (el `.default("CUP")` fuera, va como F-046)—
están contestadas por escrito en
`.agent/specs/propuestas/store-escribe-el-negocio-antes-de-las-guardas.md`
§ «Respuestas del humano (2026-09-10)» y aplicadas aquí. La numeración de este
documento sigue en **`SP6`** para quien tenga que abrir una nueva.

Lo único que este ciclo añade y que **no** es una pregunta sino un aviso ya
resuelto es `SI7`: el criterio 7 se cumple tal como está escrito y se le suma
una comprobación que lo completa, sin tocarlo.

## No decidido a propósito

- **Dónde vive exactamente el helper y cómo se llama** —privado en
  `src/features/sync/server/handlers/store.ts` o módulo aparte— y si el camino de
  actualización aprovecha además el `nested write` de la opción (b) dejando (a)
  solo en el alta. Lo fija el **arquitecto**. Esta spec fija el **momento** (R1,
  R2) y el **resultado** (E1-E12), no la forma.
- **En qué archivo de prueba acaba cada criterio.** Recomendación de la
  propuesta, que sigue en pie tras releer el árbol: **no** crear un
  `store.db.test.ts` nuevo —hay 23 `*.db.test.ts` y ese proyecto corre en serie a
  propósito (`vitest.config.mts:76-82`)—, sino repartir entre
  `src/features/sync/server/handlers/business.db.test.ts` (donde vive el aserto a
  invertir y el helper `storeEvent`) y
  `src/features/sync/server/handlers/storePublishGate.db.test.ts` (que ya
  ejercita `STORE` por la ruta real y ya sabe fabricar el `timezone` ilegible).
  El criterio 6 va en `src/features/sync/server/handlers/store.test.ts`, proyecto
  `server`. Decisión final del **arquitecto** con el **probador**.
- **Si hay que reparar los negocios que ya tengan la moneda base mal por este
  defecto** (CL9). No hay forma de saber cuáles son sin comparar contra el POS, y
  el siguiente `STORE` que se aplique los deja bien solos. Un backfill parece
  desproporcionado; lo decide el **humano** si aparece un caso real.
- **La ventana de CL7** (error de base entre las dos escrituras). Cerrarla exige
  transacción, prohibida por el pooler. Se acepta y se documenta.
- **Si `Business.name` debería dejar de viajar en el `STORE`**, ya que no lo lee
  nadie (SI5). Es una decisión de propiedad de campos con el otro equipo, no de
  este arreglo.
- **Si el `Error` genérico que manda su mensaje interno al POS
  (`processBatch.ts:125-127`) merece algo.** Inalcanzable hoy; era la I5 de la
  propuesta y sigue sin ser de este feature.
