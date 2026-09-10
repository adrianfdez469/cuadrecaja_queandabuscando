---
feature: F-045
agente: sdd-architect
actualizado: 2026-09-10T04:28:36Z
estado: listo
---

> **La spec fijó el MOMENTO (R1, R2) y el RESULTADO (E1-E12); esto fija la
> FORMA, el SITIO exacto y el REPARTO de pruebas.** Siete decisiones,
> `AD1`-`AD7`, y ninguna reabre lo que el humano cerró el 2026-09-10: opción
> (a) entera, sin `$transaction` (pooler), sin `nested write` como arreglo, sin
> mover guardas, sin tocar el `.default("CUP")`, contrato en v13.3 menor y el
> aserto de I4 invertido en vez de borrado. Cero archivos nuevos, cero
> migración, cero endpoints: **una función privada, tres llamadas, tres
> archivos de prueba y tres párrafos del contrato.**

## Estado actual relevante

Leído en el árbol de hoy, no deducido. Lo que se reutiliza **tal cual** y lo que
cambia:

| Archivo                                                                      | Qué hay hoy                                                                                                | Qué le pasa en F-045                                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/features/sync/server/handlers/store.ts:71-78`                           | El comentario «R8/E16» y `prisma.business.update`, la **primera** sentencia del handler                    | El `update` se encapsula en `applyBusinessFields` (AD1); el comentario pasa a ser su docstring (AD7) |
| `src/features/sync/server/handlers/store.ts:80-108`                          | El `findUnique` de la sucursal, con su `select` ya ensanchado por F-022/F-032/F-017                        | Pasa a ser la **primera** sentencia del handler. Cero cambios dentro                                 |
| `src/features/sync/server/handlers/store.ts:137-138`, `:213-214`, `:260-261` | `assertDeliveryConsistent` + `assertZoneKnown`, las guardas gemelas                                        | **No se mueven** (R5). Son el modelo de la doctrina, no el sitio exacto de la llamada nueva (AD2)    |
| `src/features/sync/server/handlers/store.ts:205`                             | `assertOpeningHoursValid`, en el tronco común de los caminos que publican                                  | No se mueve. Queda **encima** de las tres llamadas nuevas                                            |
| `src/features/sync/server/handlers/store.ts:219-221`, `:268-270`             | Las dos comprobaciones de `timezone`, **por debajo** de `assertZoneKnown` en sus caminos                   | Son las que deciden el sitio real de dos de las tres llamadas (AD2). No se tocan                     |
| `src/features/sync/server/handlers/store.ts:140-159`, `:226-241`, `:271-292` | Las tres escrituras de sucursal (despublicación, alta, actualización)                                      | Cada una gana **una línea** justo encima                                                             |
| `src/features/sync/server/handlers/store.ts:245-247`                         | El `throw new Error` genérico del alta                                                                     | Queda **después** de la llamada, a propósito (CL6). Ni una línea                                     |
| `src/features/sync/server/handlers/store.ts:313-391`                         | `siblingTouch`, `rowDeliveryConfig` y las tres `assert*` privadas                                          | Se reutilizan. El helper nuevo se inserta **antes** de `siblingTouch` (AD1)                          |
| `src/features/sync/server/handlers/types.ts:86`                              | `class SyncEventFailure`                                                                                   | Cero líneas                                                                                          |
| `src/features/sync/server/processBatch.ts:119-133`                           | El `catch` que hace `failed[]` y las cuatro invalidaciones                                                 | Cero líneas. Es la red de E12/R3                                                                     |
| `src/features/sync/server/handlers/store.test.ts:23`, `:32-33`, `:104`       | El mock `businessUpdate`, ya reseteado en el `beforeEach`                                                  | Es el instrumento del criterio 6, ya montado: cero maquinaria nueva (AD5)                            |
| `src/features/sync/server/handlers/business.db.test.ts:140-164`              | El helper `storeEvent`, con `businessName`/`baseCurrency` a pelo                                           | Gana tres parámetros opcionales (AD5)                                                                |
| `src/features/sync/server/handlers/business.db.test.ts:180-185`              | `readBusiness`, que solo selecciona `displayCurrencies` y su marca                                         | **No se toca**: se le suma un lector propio de las dos columnas (AD5)                                |
| `src/features/sync/server/handlers/business.db.test.ts:646-684`              | El aserto de I4 de F-043, hoy verde afirmando el defecto                                                   | Se **invierte**, no se borra (R10). Las otras tres aserciones siguen (AD5)                           |
| `src/features/sync/server/handlers/storePublishGate.db.test.ts:57-140`       | La receta del `timezone` ilegible (`$executeRaw` + sucursal `SUSPENDED`)                                   | Se reutiliza en un `it` nuevo del mismo archivo (AD5)                                                |
| `src/features/marketplace/server/dbFixtures.ts:177-235`                      | `createFixtureSession`: negocio con `name: "F-015 fixture <token>"` y `baseCurrencyCode` `CUP` por defecto | Se reutiliza. Ese par de valores es la línea base de las lecturas «antes» (AD5)                      |
| `src/constants/sync.ts:136-139`                                              | La nota de I4 dentro del docstring de `STORE_ZONE_UNKNOWN`                                                 | Se reescribe (AD7)                                                                                   |
| `docs/sync-contract.md:3`, `:49`, `:230-240`, `:1892`                        | Versión, changelog y las **dos** salvedades de I4                                                          | v13.3 (AD6)                                                                                          |
| `docs/sync-contract.md:1883`, `:1885`                                        | Las dos filas que hoy mienten (`STORE_DELIVERY_CONFIG_INCONSISTENT`, `STORE_OPENING_HOURS_INVALID`)        | **No se tocan**: el arreglo las vuelve verdad (SI3)                                                  |
| `src/features/sync/server/provisioning.ts:47`                                | El otro —y único— escritor de `Business.name`                                                              | Fuera de alcance: nace ahí el negocio, al acuñarle el token                                          |
| `src/features/sync/server/handlers/business.ts`                              | `handleBusiness`, dueño de `displayCurrencies` y de nada más                                               | Cero líneas (spec § Fuera)                                                                           |

No hay componente de producto nuevo, ni pantalla, ni ruta, ni schema Zod nuevo,
ni migración. **No hay ningún archivo nuevo en `src/`.**

## Decisión

### AD1 — `applyBusinessFields`, privada en `store.ts`, insertada antes de `siblingTouch`

```ts
/**
 * F-045 (R1, R2): the two BUSINESS columns that ride on a STORE event —
 * `name` and `baseCurrencyCode`. R8/E16 of F-018 still hold and they are
 * about WHICH ROW, not about where this runs: `businessId` is the caller's
 * OWN authenticated identity (never `payload.businessId`), and this is an
 * `update`, never an `upsert` — the sync does not create businesses, they
 * are born when their token is minted (`provisioning.ts`).
 *
 * WHERE it is called is the whole feature, and it is doctrine, not taste:
 * HERE, as the LAST statement before each of the three store writes, after
 * EVERY guard of that path — never once at the top, which is where it lived
 * until F-045 and why an event answered `stale`, `skipped_not_published` or
 * `failed` still moved the merchant's base currency (I4). Same rule as
 * `assertDeliveryConsistent`/`assertZoneKnown` below, plus one they do not
 * need: a guard added later goes ABOVE this call, never between it and the
 * write — below it, the defect is back in miniature.
 *
 * `select: { id: true }` is not a leftover to clean up: nobody reads the
 * result (someone did in 613b254, when this was an `upsert`), and it is the
 * narrowest RETURNING Prisma will emit for an `update`.
 */
async function applyBusinessFields(
  businessId: string,
  payload: Pick<StorePayload, "businessName" | "baseCurrency">,
): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: { name: payload.businessName, baseCurrencyCode: payload.baseCurrency },
    select: { id: true },
  });
}
```

**Nombre.** `applyBusinessFields`, el que el humano ya escribió en las notas de
`.agent/features.json`; además `apply…` es el verbo que usa toda la spec para
«el evento se aplica», que es exactamente la condición que este helper acaba de
codificar. No `writeBusiness…` (dice cómo, no qué) ni `updateBusiness…` (se
confunde con `handleBusiness`, que es de otra entidad y no toca estas columnas).

**Privada en `src/features/sync/server/handlers/store.ts`, no módulo aparte.**
Cuatro razones, en orden de peso:

1. **No hay un segundo llamador y el inventario lo demuestra.** Los escritores
   de estas dos columnas en todo `src/` son dos: `store.ts:74` y el alta de
   `src/features/sync/server/provisioning.ts:47` (spec § Actores, comprobado con
   el `grep` que ahí se cita). El segundo crea el negocio al acuñar el token y
   nunca querría este helper. Un módulo con un solo importador no gana capa: la
   gana ya `features/sync/server/`, que es donde vive `store.ts`.
2. **Es el precedente inmediato de este mismo repo.** AD1 de F-043 eligió gemela
   privada sobre helper compartido con el criterio «el helper se gana el sitio
   cuando la pregunta deje de ser la misma». Aquí ni siquiera hay dos preguntas.
3. **La colocación es la mitad del valor, y solo se lee donde se llama.** Sacar
   la función a otro archivo aleja el docstring de las tres llamadas, que es
   justo lo que este feature necesita que nadie pueda deshacer por descuido.
4. **Criterio de corte, escrito para el que venga.** Se extrae el día que un
   **segundo handler de entrada** tenga que escribir campos del negocio que
   cuadrecaja posee — el candidato concreto es que `BUSINESS` acabe adueñándose
   de `name`/`baseCurrencyCode` (hoy explícitamente no lo hace, R10 de F-038,
   `src/features/sync/server/handlers/business.ts:41-42`). Ese día el sitio es
   un módulo compartido de `src/features/sync/server/` y la firma que hará falta
   ya no es esta, sino una con marca anti-rancio propia del negocio (hoy fuera
   de alcance). Extraer hoy no adelanta ni una línea de ese día.

**Dónde va la definición dentro del archivo: justo después de `handleStore` y
antes de `siblingTouch` (`store.ts:313`)**, no al final con las `assert*`. Las
tres `assert*` son una familia que declara en sus docstrings «never writes
anything itself»; meter entre ellas la única privada que **sí** escribe invita a
leerla en diagonal como una cuarta guarda.

**Firma.** `Pick<StorePayload, "businessName" | "baseCurrency">` en vez del
`StorePayload` entero: nombra en el tipo las dos únicas claves del payload que
son del **negocio** y no de la sucursal, que es la distinción que este feature
existe para hacer visible. Las dos son `string` no nulas en el tipo inferido
(`src/features/sync/schemas.ts:28` y `:42`), así que no hay caso nulo que
tolerar. Devuelve `Promise<void>`: nadie usa el resultado y que el tipo lo diga
impide que vuelva a aparecer un consumidor y con él la tentación de subirla.

### AD2 — Las tres llamadas van **la última** antes de cada escritura, no «al lado de `assertZoneKnown`»

Es la decisión con más trampa del feature, y la trampa tiene nombre: en dos de
los tres caminos, `assertZoneKnown` **no** es la última guarda.

| #   | Camino                                             | Línea de hoy donde se inserta | Qué queda **inmediatamente antes**                                                        | Qué queda **inmediatamente después**                                                        |
| --- | -------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Despublicación de una sucursal existente (E9, CL1) | entre `:139` y `:140`         | `const optInChanged = existing.sourceOptIn !== false;` (`:139`)                           | `await prisma.store.update({ where: { id: existing.id }, … })` (`:140-159`)                 |
| 2   | Alta de sucursal nueva (E8)                        | entre `:221` y `:222`         | el cierre del `if (!isCanonicalTimeZone(DEFAULT_STORE_TIMEZONE))` (`:219-221`)            | el comentario «E9/HS2 …» (`:222-225`) y `await createStorefrontWithStore({ … })` (`:226`)   |
| 3   | Actualización de una publicada (E7)                | entre `:270` y `:271`         | el cierre del `if (optInChanged && !isCanonicalTimeZone(existing.timezone))` (`:268-270`) | `const updated = await prisma.store.update({ where: { id: existing.id }, … })` (`:271-292`) |

**Por qué «la última antes de la escritura» y no «pegada a `assertZoneKnown`»:**
en el camino 3 hay una guarda **por debajo** de `assertZoneKnown` (`:268-270`),
y es exactamente la que produce `STORE_TIMEZONE_INVALID`, o sea el cuarto código
del criterio 2 (E5). Poner la llamada en `:262` la dejaría escribiendo en ese
fallo y el criterio 2 se caería por un cuarto de su enunciado. Lo mismo, en
menor grado, en el camino 2 con la comprobación del `timezone` por defecto
(`:219-221`), que hoy alimenta el caso «E13 alta que viola R8» de
`store.test.ts:567`. La regla que hay que poder repetir de memoria es **«después
de todas las guardas de ESE camino, la última línea antes de la escritura»**, y
por eso está en el docstring de AD1 en vez de en un comentario suelto.

**Alternativa descartada, y no es la (b):** poner la llamada del camino 2
**después** de `createStorefrontWithStore` y de su `if (!created.ok)`
(`:244-248`) cerraría también la ventana de CL6. Se descarta porque R2 dice
«inmediatamente antes de cada una de las tres escrituras», porque CL6 aceptó esa
ventana por escrito, porque el `throw` es inalcanzable (E14 de F-017:
`proposedSlug: null` nunca se rechaza) y —lo que de verdad pesa— porque una
tercera colocación distinta rompe la única frase que hace la doctrina
memorizable. Coste de la simetría: el `Error` genérico seguiría dejando las dos
columnas escritas, en un camino que hoy no se puede alcanzar.

**Lo que NO se hace, otra vez, porque el archivo invita a hacerlo:** ni una
cuarta llamada, ni una llamada compartida arriba, ni mover `assertZoneKnown`,
`assertDeliveryConsistent`, `assertOpeningHoursValid` o las dos de `timezone`
(R5, AD4 de F-043, E9/E12 de F-041). Adelantar una guarda convierte `SKIPPED` y
`STALE` en `failed[]`, que es un cambio de contrato con cuadrecaja disfrazado de
refactor.

### AD3 — El `select: { id: true }` se queda, y se dice por qué

Es lo único de la sentencia de hoy que parece basura (la spec lo llama
«vestigial», SI1). Se conserva: sin él, Prisma emite el `RETURNING` de todas las
columnas de `Business` —incluido `displayCurrencies`— por una escritura cuyo
resultado nadie mira. Retirarlo no ahorra un round-trip y sí ensancha la
respuesta. Lo que se corrige es la **razón**: no está ahí porque alguien lea el
`id`, sino porque es el `RETURNING` más estrecho. Escrito en el docstring para
que la próxima limpieza no lo quite «porque no se usa».

### AD4 — Opción (a) entera: ni `nested write`, ni `$transaction`, ni deduplicar por lote

R2 lo cierra y **estoy de acuerdo**, así que no hay `AP` que subir por aquí. Las
tres tentaciones, con su motivo de descarte en una línea:

- **`nested write` de Prisma (b) solo en el camino de actualización:** plegaría
  una escritura de las tres, dejaría los otros dos caminos con (a) y convertiría
  la doctrina en «depende del camino». Además, el alta pasa por
  `createStorefrontWithStore` (`src/features/storefront/server/registry.ts:70`),
  componente compartido con el panel, y no tiene dónde plegarse. Queda como
  optimización posterior con su umbral escrito en § Escalabilidad.
- **`$transaction`:** prohibida por AGENTS.md § Cosas que muerden — el pooler de
  Supabase corre en modo transacción y el cliente global hace deadlock dentro.
  La misma razón que ya está escrita en
  `src/features/sync/server/handlers/business.ts:36-37` y en
  `src/features/storefront/server/registry.ts:55-58`.
- **Una sola escritura por lote (deduplicar N `STORE` del mismo negocio):**
  cambia el número de escrituras que el criterio 6 fija en «exactamente una por
  evento que se aplica» y necesita estado entre eventos en `processBatch.ts`,
  que hoy no lo tiene. Fuera.

### AD5 — Reparto de pruebas: tres archivos existentes, ningún `*.db.test.ts` nuevo

**Se sigue la recomendación de la spec**, con el número que la sostiene: hay
**23** archivos `*.db.test.ts` y el proyecto `db` corre con
`fileParallelism: false` (`vitest.config.mts:76-82`), así que un archivo nuevo
cuesta una sesión de fixture y un arranque de módulo más en serie, para
escenarios que caben en dos archivos que ya montan exactamente este arnés.

| Criterio | Qué prueba                                                       | Archivo                                                         | Proyecto | Forma                                                                                       |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| 1        | `STORE_ZONE_UNKNOWN` no mueve las dos columnas                   | `src/features/sync/server/handlers/business.db.test.ts:646-684` | `db`     | **Se invierte** el aserto de I4 (R10); las otras tres aserciones de F-043 se quedan         |
| 2 (a)    | `STORE_OPENING_HOURS_INVALID`                                    | `src/features/sync/server/handlers/business.db.test.ts`         | `db`     | `it` nuevo en el `describe` de F-045                                                        |
| 2 (b)    | `STORE_DELIVERY_CONFIG_INCONSISTENT` en su forma `207`           | `src/features/sync/server/handlers/business.db.test.ts`         | `db`     | `it` nuevo: `deliveryEnabled: true` a secas sobre la fila `FLAT_RATE`/`deliveryFee: null`   |
| 2 (c)    | `STORE_TIMEZONE_INVALID`                                         | `src/features/sync/server/handlers/storePublishGate.db.test.ts` | `db`     | `it` nuevo, reusando la receta de `$executeRaw` de `:60-62` — **un solo evento en el lote** |
| 2 (d)    | El cuarto código es el del criterio 1                            | —                                                               | —        | Ya cubierto                                                                                 |
| 3        | Rancio: `stale` dentro de `ok` y las columnas conservan lo NUEVO | `src/features/sync/server/handlers/business.db.test.ts`         | `db`     | `it` nuevo                                                                                  |
| 4        | Los dos `skipped_not_published`                                  | `src/features/sync/server/handlers/business.db.test.ts`         | `db`     | **Dos** `it`: el de otro negocio abre una segunda `FixtureSession`                          |
| 5 (a)    | Los tres caminos que sí aplican                                  | `src/features/sync/server/handlers/business.db.test.ts`         | `db`     | **Un** `it` con tres peticiones y una lectura tras cada una                                 |
| 5 (b)    | Lote mixto en los **dos** órdenes                                | `src/features/sync/server/handlers/business.db.test.ts`         | `db`     | **Dos** `it`, uno por permutación (CL2: sucursales distintas y valores distintos)           |
| 6        | El recuento de escrituras (1 / 0)                                | `src/features/sync/server/handlers/store.test.ts`               | `server` | Asertos añadidos a **once** tests que ya existen; ni un `it` nuevo                          |
| 7        | El contrato en v13.3                                             | `docs/sync-contract.md`                                         | —        | `grep` + el hook `.claude/hooks/sync-contract-version.sh`; no hay archivo de prueba         |
| 8        | El sensor                                                        | —                                                               | —        | `bash .agent/verify.sh F-045 --full`                                                        |

**Por qué los escenarios de `STORE` viven en un archivo que se llama
`business.db.test.ts`:** porque lo que está bajo prueba es la fila `Business`,
no la sucursal — es el mismo argumento que ya escribió F-043 en el docstring de
`storeEvent` (`:133-139`), y ahí sigue valiendo. Van en un `describe` **nuevo y
propio** («F-045: un `STORE` que no se aplica no toca las dos columnas del
negocio»), con su `beforeEach`/`afterEach` de sesión fresca por test, no colgando
del `describe` de `BUSINESS`: la sesión fresca por test es aquí un requisito, no
una costumbre —cada test lee «antes» y «después» de la **misma** fila y un resto
de otro test cambiaría lo que significa «igual»—, y el `afterEach` de F-045
necesita un paso más que el de `BUSINESS` (el `Slug`, abajo).

**Cuatro cosas del arnés que hay que tocar, y solo cuatro:**

1. `storeEvent` (`business.db.test.ts:140-164`) gana tres parámetros opcionales:
   `businessName?`, `baseCurrency?` y un objeto de claves extra del `payload`
   (para `openingHours`, `deliveryEnabled`, `publishToStore`). Los valores por
   defecto de hoy se conservan para no tocar el test de F-043 más de lo que R10
   pide. Su docstring, que hoy explica I4 como defecto vivo, se reescribe (AD7).
2. Un lector propio, `readBusinessIdentity(businessId)`, que selecciona
   exactamente `{ name, baseCurrencyCode }` — para que el aserto sea
   `expect(after).toEqual(before)` de una línea. **`readBusiness` (`:180-185`) no
   se toca**: es de los escenarios de `BUSINESS` y ensancharlo mezcla dos
   preguntas. El nuevo lector sustituye además los dos `select` inlineados de
   `:650-653` y `:669-672`.
3. **Anti-vacuidad, y hoy falta.** El `storeEvent` de hoy manda
   `baseCurrency: "CUP"`, que es **el mismo valor** que la fixture deja en la
   columna (`Business.baseCurrencyCode` es `@default("CUP")`,
   `prisma/schema.prisma:160`): un `toEqual` contra esa mitad no probaría nada.
   Todo evento que deba **no** escribir viaja con las dos columnas **distintas**
   de las de la fila — la receta es `baseCurrency: "USD"` y un `businessName`
   con la palabra `RECHAZADO`/`VIEJO` y el `token` de la sesión.
4. **El camino de alta deja un `Slug` huérfano.** `createStorefrontWithStore`
   escribe `Storefront` + `Slug` + `Store`; `session.cleanup()`
   (`src/features/marketplace/server/dbFixtures.ts`) borra el negocio y el
   `Storefront`/`Store` extra caen por `onDelete: Cascade`, pero la fila de
   `Slug` sobrevive con sus FKs a `NULL` (`prisma/schema.prisma:258-259`,
   `SetNull`) y **ocupa su valor para siempre** (R13 de F-017). El test del
   criterio 5 (a) manda `slug: "<token>-alta"` en el payload para que el valor
   derivado sea único por sesión y borra la fila antes de `session.cleanup()`
   con `prisma.slug.deleteMany({ where: { value: { startsWith: session.token } } })`.
   Es el primer test del proyecto `db` que ejercita el alta por la ruta real: sin
   este paso, cada ejecución de la suite deja basura en el registro de slugs.

**Dos trampas más para quien escriba los tests, ya verificadas leyendo el
código:**

- En el `it` del criterio 5 (a) los tres eventos van sobre `updatedAt`
  **crecientes**: la actualización y la despublicación caen sobre la misma
  sucursal y `sourceUpdatedAt` avanza con cada una (`store.ts:116-121`), así que
  un segundo evento con la misma fecha responde `stale` y el test mediría otra
  cosa.
- En `storePublishGate.db.test.ts` el `it` existente (`:57-140`) manda en el
  mismo lote un `STORE` **sano** que sí aplica y por tanto sí escribe las dos
  columnas: por eso el criterio 2 (c) necesita un `it` **propio** con un único
  evento, no un aserto añadido al que ya está. Y su sesión es de `beforeAll`
  compartida: la lectura «antes» se hace dentro del `it`, nunca en el `beforeAll`.

**El criterio 6 se cubre sin un solo `it` nuevo**, con el mock que ya existe:
`toHaveBeenCalledOnce()` en los cuatro tests que aplican —`:124` (actualización),
`:139` (junto al `toHaveBeenCalledWith` que ya está), `:164` (despublicación) y
`:278` (alta)— y `not.toHaveBeenCalled()` en los siete que no: `:113` (stale),
`:149` (otro negocio), `:297` (`DELETE` sin fila), `:234`
(`STORE_TIMEZONE_INVALID`), `:308` (`STORE_OPENING_HOURS_INVALID`), `:488`
(`STORE_DELIVERY_CONFIG_INCONSISTENT`) y `:567` (alta que viola R8, que es el
único que prueba la colocación del camino 2 en el proyecto rápido).

### AD6 — El contrato: v13.3, tres ediciones que **quitan** salvedades y dos filas que no se tocan

`docs/sync-contract.md` sube de **v13.2** a **v13.3** (R9, menor). Cuatro sitios,
en este orden:

1. **La línea 3.** `**Versión 13.2** · 9 de septiembre de 2026` →
   `**Versión 13.3** · 10 de septiembre de 2026`, el resto de la línea literal.
   Es lo que mira el hook `.claude/hooks/sync-contract-version.sh` (compara la
   línea 3 con la de `HEAD`), así que se cambia **en la misma edición**, no
   después.
2. **§ «`zoneCode` en el `payload` de `STORE`», `:230-240`.** Se retira entera la
   salvedad de `:234-238` («**El nombre del negocio y su moneda base sí pueden
   haberse escrito**: … que F-043 hace alcanzable con una causa más y no
   arregla») y el «**de la sucursal**» de `:233` vuelve a ser «ninguno de sus
   otros campos se aplica». En su lugar, la promesa fuerte en positivo y **sin
   escribir el identificador `Business.name`** (el criterio 7 exige que
   `grep -c 'Business.name'` dé 0): «tampoco el nombre del negocio ni su moneda
   base, que viajan en este mismo evento (v13.3)». Se conserva la frase final
   «Es el mismo patrón que ya tiene
   `STORE_OPENING_HOURS_INVALID`/`STORE_TIMEZONE_INVALID` desde la v9», que
   ahora es verdad de las tres.
3. **La fila de `STORE_ZONE_UNKNOWN` de la tabla de respuestas, `:1892`.** Fuera
   el inciso «— `Business.name`/`baseCurrencyCode` sí pueden haberse escrito (I4,
   ver § …)» y el «**de la sucursal**» del mismo renglón. La clase de reintento
   (**reintentable**) y el resto de la fila no se tocan.
4. **Una entrada nueva en § «Cambios respecto a la v12.2»**, entre el
   encabezado (`:49`) y el párrafo de la v13.2 (`:51`) — la sección va de más
   nueva a más vieja. Contenido mínimo: qué promesa se refuerza (un `STORE` que
   responde `failed`, `stale` o `skipped_not_published` no escribe **nada**, ni
   siquiera lo del negocio), que **no exige cambiar nada** en el POS y por eso es
   menor, y —si `AP1` se resuelve por la recomendación— que las filas de
   `STORE_OPENING_HOURS_INVALID` y `STORE_DELIVERY_CONFIG_INCONSISTENT` dejan de
   tener esa salvedad implícita.

**Las dos filas que NO se tocan** (`:1883` y `:1885`): hoy prometen «No escribe
nada» y «ninguno de sus campos se aplica —tampoco un `name` o un `phone`—», y
hoy mienten. Después del arreglo son exactas **sin una sola edición**. Es SI3, y
es la comprobación más barata de que el arreglo va en la dirección correcta: un
arreglo que obligara a debilitarlas sería el arreglo equivocado.

**Verificación del criterio 7, literal:** `grep -n 'Versión 13.3'` da la línea 3;
`grep -c 'Business.name'` da `0` (hoy 1, la `:1892`); `grep -c 'I4'` da `0` (hoy
2, `:237` y `:1892`), que es la que cubre **también** el § de `zoneCode`, escrito
en prosa castellana (SI7).

### AD7 — Los cuatro comentarios que dejan de ser ciertos

| Comentario                                                           | Qué dice hoy                                                                                              | Qué dice después                                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sync/server/handlers/store.ts:71-73`                   | Justifica con «R8/E16» una sentencia que está la primera                                                  | Desaparece de ahí: su contenido —a qué fila apunta y que no crea negocios— pasa al docstring de `applyBusinessFields`, ya **sin** implicar posición (SI1)                               |
| `src/constants/sync.ts:136-139`                                      | «It does NOT promise that nothing at all was written … (I4, `store.ts:74-78`, not fixed by this feature)» | La promesa completa: el evento falla y **no se escribe nada**, tampoco las dos columnas del negocio; se cita F-045 y se retira la referencia a `store.ts:74-78`, que ya no existe (SI6) |
| `src/features/sync/server/handlers/business.db.test.ts:133-139`      | El docstring de `storeEvent` explica I4 como defecto vivo                                                 | Explica por qué estos escenarios de `STORE` viven en este archivo (la fila bajo prueba es `Business`) y que F-045 cerró I4                                                              |
| `src/features/sync/server/handlers/business.db.test.ts:646` y `:673` | El título del `it(` y «I4: already applied — handleStore's very first statement, unguarded»               | El título dice que F-045 corrigió I4 y el comentario, que las dos columnas no se movieron porque la escritura vive ahora detrás de las guardas (R10, SP3)                               |

El docstring gemelo de `src/constants/sync.ts:30-32`
(`STORE_OPENING_HOURS_INVALID`) **no se toca**: no repite la salvedad, solo
promete lo que a partir de ahora es verdad (SI3).

## Componentes

| Componente             | Capa                    | Responsabilidad                                                                             | Archivo                                                 |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `applyBusinessFields`  | `features/sync/server/` | Escribir `Business.name`/`baseCurrencyCode` del negocio autenticado. Privada, tres llamadas | `src/features/sync/server/handlers/store.ts`            |
| `handleStore`          | `features/sync/server/` | Sin cambio de responsabilidad: pierde su primera sentencia y gana tres líneas               | `src/features/sync/server/handlers/store.ts`            |
| `readBusinessIdentity` | prueba (`db`)           | Leer el par `{ name, baseCurrencyCode }` para los asertos «antes»/«después»                 | `src/features/sync/server/handlers/business.db.test.ts` |

Nada en `src/app/`, nada en `src/components/`, nada en `src/lib/`, nada en
`src/features/*/schemas.ts`. La regla de capas de AGENTS.md se cumple sin
esfuerzo: Prisma sigue solo en `features/*/server/`.

## Flujo de datos

Las **catorce** salidas de `handleStore` (SI2: trece nombradas más el error de
base), con lo que escriben del negocio hoy y después. Es la tabla que prueba
E1-E12 y R6 de un vistazo:

| #   | Salida                                                         | Línea de hoy | Hoy escribe | Después | Escenario |
| --- | -------------------------------------------------------------- | ------------ | ----------- | ------- | --------- |
| 1   | `return SKIPPED` — la sucursal es de otro negocio              | `:112`       | sí          | **no**  | E6, CL4   |
| 2   | `return STALE` — evento rancio                                 | `:120`       | sí          | **no**  | E1, CL5   |
| 3   | `return SKIPPED` — despublicar algo que no existe              | `:132`       | sí          | **no**  | E6        |
| 4   | `assertDeliveryConsistent` (despublicación)                    | `:137`       | sí          | **no**  | E4        |
| 5   | `assertZoneKnown` (despublicación)                             | `:138`       | sí          | **no**  | E2        |
| 6   | **escritura** de despublicación                                | `:140-159`   | sí          | **sí**  | E9, CL1   |
| 7   | `assertOpeningHoursValid`                                      | `:205`       | sí          | **no**  | E3        |
| 8   | `assertDeliveryConsistent` (alta)                              | `:213`       | sí          | **no**  | E4        |
| 9   | `assertZoneKnown` (alta)                                       | `:214`       | sí          | **no**  | E2        |
| 10  | `timezone` por defecto no canónico (alta)                      | `:219-221`   | sí          | **no**  | E5        |
| 11  | **escritura** de alta                                          | `:226-241`   | sí          | **sí**  | E8        |
| 12  | `throw new Error` genérico                                     | `:245-247`   | sí          | **sí**  | CL6       |
| 13  | `assertDeliveryConsistent` / `assertZoneKnown` (actualización) | `:260-261`   | sí          | **no**  | E2, E4    |
| 14  | `timezone` ilegible al republicar                              | `:268-270`   | sí          | **no**  | E5        |
| 15  | **escritura** de actualización                                 | `:271-292`   | sí          | **sí**  | E7        |
| —   | Error de base **en** la escritura de sucursal                  | —            | sí          | **sí**  | CL7, SI8  |

Orden nuevo dentro del handler, en tres líneas: **leer la sucursal → decidir →
escribir el negocio → escribir la sucursal**. Hoy es _escribir el negocio → leer
→ decidir → escribir la sucursal_, y esas dos primeras palabras son el defecto
entero.

**Consecuencia que la spec pedía y que ahora se puede afirmar:** después del
arreglo, **toda** escritura de `baseCurrencyCode` sale por uno de los tres
caminos que devuelven `touchedStoreSlug`/`touchedBrandSlug`
(`store.ts:175-180`, `:249-253`, `:298-303`), así que
`src/features/sync/server/processBatch.ts:132-142` invalida `storeTag` y
`storeCatalogTag` de ese slug (`src/lib/cache.ts:86-93`). La ventana de hasta una
hora entre la portada (ISR 3600, `src/app/[slug]/layout.tsx:33`) y el catálogo
(`revalidate = 0`) que describe § Problema **deja de poder abrirla un evento que
no se aplica**: hoy la abren justo los caminos que no revalidan.

## Contratos

**Interno** (el único nuevo):

```ts
applyBusinessFields(
  businessId: string,
  payload: Pick<StorePayload, "businessName" | "baseCurrency">,
): Promise<void>
```

Privada, no exportada, sin test propio: se prueba por sus tres llamadas.

**Externo: ninguno cambia.** Ni el esquema del sobre, ni `StorePayload`, ni la
forma de la respuesta, ni el código HTTP, ni el `status` de ningún evento, ni lo
que se escribe en `SyncEvent` (R3/E12). La tabla de errores de `STORE` se queda
con sus cuatro códigos y sus cuatro significados:

| Código                               | Cuándo                                            | Qué escribía   | Qué escribe |
| ------------------------------------ | ------------------------------------------------- | -------------- | ----------- |
| `STORE_ZONE_UNKNOWN`                 | `zoneCode` fuera del catálogo o sin forma de DPA  | las 2 columnas | **nada**    |
| `STORE_OPENING_HOURS_INVALID`        | `openingHours` no pasa `openingHoursSchema`       | las 2 columnas | **nada**    |
| `STORE_DELIVERY_CONFIG_INCONSISTENT` | Contradicción visible solo al mezclar con la fila | las 2 columnas | **nada**    |
| `STORE_TIMEZONE_INVALID`             | Publicar sobre un `timezone` ilegible             | las 2 columnas | **nada**    |

## Modelo de datos y migraciones

**Ninguna.** Ni una línea de `prisma/schema.prisma`: `Business.name` (`:153`) y
`Business.baseCurrencyCode` (`:160`) se quedan igual, sin índice nuevo y sin
columna nueva. No hace falta `prisma migrate dev`, y por tanto no aparece ninguno
de los dos comandos prohibidos de AGENTS.md.

Nota deliberada: **no** se añade una marca anti-rancio propia del negocio (haría
falta una columna y su migración). Dos sucursales del mismo negocio entregadas
fuera de orden siguen resolviéndose por «gana el último que llegue», propiedad
que el contrato ya declara asumida (`docs/sync-contract.md:1286`). Este feature
solo saca de esa carrera a los eventos que ni siquiera se aplican.

## Escalabilidad y límites

Round-trips contra Postgres por evento `STORE`, contados sobre el código:

| Camino                                     | Hoy                                                      | Después               |
| ------------------------------------------ | -------------------------------------------------------- | --------------------- |
| Rancio (`stale`)                           | 2 (`business.update` + `store.findUnique`)               | **1**                 |
| `skipped_not_published` (las dos formas)   | 2                                                        | **1**                 |
| Fallo por cualquiera de las cuatro guardas | 2                                                        | **1**                 |
| Actualización que aplica                   | 3 (`business.update` + `findUnique` + `store.update`)    | 3 (mismo, otro orden) |
| Despublicación que aplica                  | 3, +1 si `operation: "DELETE"` (`zoneTariff.deleteMany`) | igual                 |
| Alta que aplica                            | 3 + 1..N de `slugTaken` (`registry.ts:47-54`)            | igual                 |

**El número que importa.** Un lote de 500 eventos —el tamaño con el que trabaja
el propio contrato, `docs/sync-contract.md:924`— en el que 100 `STORE` fallan por
un catálogo de zonas no convergido: hoy son **100 `UPDATE` inútiles sobre la
misma fila `Business`**, cada uno tomando y soltando el bloqueo de fila; después
son **cero**. Y con el outbox de cuadrecaja reentregando hasta seis veces por
fila (`QAB_OUTBOX_MAX_ATTEMPTS = 6`, CL4), son 600 escrituras que no ocurren por
cada tanda de reintentos.

**Lo que se rompe primero, con su umbral.** Los eventos que **sí** aplican siguen
haciendo un `UPDATE` cada uno sobre la **misma** fila del negocio: un negocio con
200 sucursales que sincroniza todo su parque en un lote toma 200 bloqueos de fila
en serie sobre `Business`. Eso ya pasa hoy y F-045 no lo cambia (R6 lo fija a
propósito: «no sube», no «baja»). Si algún día ese perfil aparece —cientos de
sucursales del mismo negocio en un lote y contención medible—, el arreglo es la
opción (b)/deduplicar por lote, **no** volver a subir la llamada al principio,
que es la que este feature está bajando.

Sin efecto en el cliente: cero KB de JavaScript, cero componentes, cero
`"use client"`. Sin efecto en caché salvo el descrito en § Flujo de datos, que es
una ventana que se cierra.

**Coste en la suite.** El proyecto `db` corre en serie
(`vitest.config.mts:76-82`). Medido hoy:
`npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts`
tarda **1,41 s** con 18 tests (~59 ms/test). Los **siete** `it` nuevos de ese
archivo y el **uno** de `storePublishGate.db.test.ts` añaden ≈0,5 s al proyecto
`db`; el criterio 6 no añade ningún test, solo asertos, y corre en `server`
(milisegundos). Un `store.db.test.ts` nuevo habría costado, además, una sesión de
fixture y un arranque de módulo más, en serie.

## Patrones a seguir / antipatrones a evitar

- **La guarda anti-rancio de `STORE` es de las que RECHAZAN**, no la de orden de
  `EXCHANGE_RATE` (AGENTS.md § Cosas que muerden;
  `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`). F-045 amplía su
  cobertura a dos columnas más; no toca su mecanismo (R8).
- **Idempotencia y guarda anti-rancia, las dos propiedades que el sync mantiene
  al escribir** (AGENTS.md § Cosas que muerden). Después del arreglo, reenviar el
  mismo evento deja el mismo estado final y **una** copia menos de escrituras
  rancias.
- **Un evento fallido NO es un duplicado** (AGENTS.md). Nada de este feature
  cambia lo que va a `ok[]`/`failed[]`; el criterio 6 y E12 lo vigilan por los
  dos lados.
- **Ninguna guarda se mueve** (R5). El antipatrón exacto, ya nombrado por AD4 de
  F-043: llamarla arriba convierte `SKIPPED`/`STALE` en `failed[]`.
- **Nada de `$transaction` con el cliente global** (pooler en modo transacción).
- **Prosa del arnés y Prettier**: `npm run format` sobre lo que uno escriba antes
  de dar la etapa por buena, y **nunca** formatear a ciegas un documento ajeno
  (AGENTS.md § Cosas que muerden). Aplica a este archivo, a
  `.agent/progress/F-045.md` y a `docs/sync-contract.md`.
- **`console.warn` con prefijo, nunca `console.error`**: este feature no añade
  instrumentación, y no hace falta ninguna — la ausencia de escritura se prueba
  leyendo la fila, no logueando.

## Riesgos y plan B

| Riesgo                                                                                               | Probabilidad | Mitigación                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Alguien coloca la llamada «al lado de `assertZoneKnown`» y deja `STORE_TIMEZONE_INVALID` escribiendo | alta         | La tabla de AD2 con las tres líneas exactas, el docstring de AD1 y el aserto de `store.test.ts:234` del criterio 6   |
| Un cambio futuro añade una guarda **debajo** de la llamada y reabre el defecto en pequeño            | media        | La frase «una guarda nueva va ENCIMA de esta llamada» en el docstring, y los siete `not.toHaveBeenCalled()`          |
| El test del alta deja un `Slug` huérfano en la base de cada desarrollador y del CI                   | media        | AD5 punto 4: `slug` derivado del `token` y `slug.deleteMany` antes de `session.cleanup()`                            |
| CL7/SI8: error de base entre las dos escrituras deja el negocio escrito sin sucursal escrita         | baja         | Aceptado por escrito. Es **estrictamente menor** que hoy (hoy se escribe siempre) y no se cierra sin `$transaction`  |
| El hook del contrato protesta o el CI cae por `format:check` sobre un `.md`                          | media        | La línea 3 se mueve **en la misma edición** (AD6.1) y `npm run format` sobre lo escrito, diffeado antes de commitear |
| El `it` de F-043 se «arregla» borrándolo en vez de invirtiéndolo                                     | baja         | R10 y AD5 fila 1: las otras tres aserciones sostienen el criterio 3 de F-043                                         |

**Plan B** (no se prevé necesitarlo): si el criterio 5 (b) —lote mixto en los dos
órdenes— resultara inestable, la causa sería que los dos eventos apuntan a la
misma sucursal, no el arreglo; CL2 ya lo dice y la receta es sucursales distintas
y valores distintos. No hay plan B sobre la forma del arreglo: la (a) es del
humano y la (d) está prohibida por el pooler.

## Orden de pasos para el implementador

Cada paso deja el árbol en un estado que se puede verificar solo, y el paso 1
deja **un** rojo esperado y nombrado.

| Paso | Qué                                                                                                                                                             | Qué verifica                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | El helper `applyBusinessFields` (AD1) y las tres llamadas (AD2) en `src/features/sync/server/handlers/store.ts`; con ello se va el comentario de `:71-73`       | `npm run typecheck` y `npx vitest run --project server src/features/sync/server/handlers/store.test.ts` verdes; `npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts` **falla exactamente en `:674-676`** y en ningún otro sitio: es la prueba de que el arreglo funciona |
| 2    | El criterio 6 en `src/features/sync/server/handlers/store.test.ts` (AD5): cuatro `toHaveBeenCalledOnce()` y siete `not.toHaveBeenCalled()`                      | `npx vitest run --project server src/features/sync/server/handlers/store.test.ts` — segundos, y cierra el criterio 6 entero antes de tocar la base                                                                                                                                                      |
| 3    | Invertir el aserto de I4 (R10) y el arnés de `business.db.test.ts`: `storeEvent` con parámetros, `readBusinessIdentity`, docstrings de `:133-139`/`:646`/`:673` | `npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts` vuelve a verde; cierra el criterio 1                                                                                                                                                                                |
| 4    | Los siete `it` nuevos del `describe` de F-045 en `business.db.test.ts`: criterios 2 (a), 2 (b), 3, 4 (×2) y 5 (×3)                                              | El mismo comando; cierra los criterios 2 (a), 2 (b), 3, 4 y 5. Comprobar además que no quedan filas de `Slug` con el `token` de la sesión                                                                                                                                                               |
| 5    | El `it` de `STORE_TIMEZONE_INVALID` en `src/features/sync/server/handlers/storePublishGate.db.test.ts`                                                          | `npx vitest run --project db src/features/sync/server/handlers/storePublishGate.db.test.ts`; cierra el criterio 2 entero                                                                                                                                                                                |
| 6    | La nota de I4 de `src/constants/sync.ts:136-139` (AD7)                                                                                                          | `npm run typecheck` y `npm run lint`; es prosa, no hay test                                                                                                                                                                                                                                             |
| 7    | `docs/sync-contract.md` a v13.3 (AD6): línea 3, § `zoneCode`, fila `:1892`, entrada nueva en § «Cambios respecto a la v12.2»                                    | `grep -n 'Versión 13.3'` → línea 3; `grep -c 'Business.name'` → `0`; `grep -c 'I4'` → `0`; el hook no protesta; cierra el criterio 7                                                                                                                                                                    |
| 8    | `npm run format` sobre lo escrito (diffear antes de aceptar) y el sensor completo                                                                               | `bash .agent/verify.sh F-045 --full; echo $?` → `0`; cierra el criterio 8                                                                                                                                                                                                                               |

Un commit por unidad coherente (AGENTS.md § Git). El natural son dos:
`fix(sync): un STORE que no se aplica no escribe el negocio (F-045)` con los
pasos 1-6, y `docs(sync-contract): v13.3 …` con el 7.

## ¿Hace falta una ADR?

**No.** No es una decisión estructural nueva: es la aplicación de una doctrina que
este repositorio ya tiene escrita en los docstrings de `assertDeliveryConsistent`
(`store.ts:335-343`) y `assertZoneKnown` (`:355-370`) —«called HERE, right before
the write it guards, never once at the top»— a la única sentencia del handler que
se la saltaba. No contradice ninguna ADR: 0028 («omitir no es apagar») y 0030 (la
tasa la decide la lectura) no hablan de posición de escrituras, y AD4 de F-043
—que decidió **no** arreglarlo entonces— se respeta al pie de la letra, porque su
motivo era «F-043 no necesita tocar ese archivo y no tiene pruebas que lo
cubran», y este feature es precisamente el que las trae.

Lo que sí queda escrito, y en el sitio donde se lee: el docstring de AD1.

## Preguntas al humano

**`AP1` — ¿La entrada de la v13.3 en «Cambios respecto a la v12.2» menciona que
las filas de `STORE_OPENING_HOURS_INVALID` y `STORE_DELIVERY_CONFIG_INCONSISTENT`
también mentían, o se limita a `zoneCode`/I4?** Es una decisión de qué se le
cuenta al otro equipo, no de código: esas dos filas prometen desde la v9 algo que
hasta hoy era falso, y el arreglo las vuelve verdad **sin tocarlas** (SI3). El
criterio 7 solo exige retirar la salvedad de I4 en sus dos sitios, así que las
dos respuestas lo cumplen.

- **(a) Mencionarlo** — una frase del tipo «y con ello dejan de tener esa
  salvedad implícita las filas de `STORE_OPENING_HOURS_INVALID` y
  `STORE_DELIVERY_CONFIG_INCONSISTENT`, que la v9 prometió y que hasta esta
  revisión no era exacta».
- **(b) No mencionarlo** — la entrada habla solo de lo que se edita.

**Recomendación: (a).** La v13 sigue **sin publicar**
(`docs/sync-contract.md:3-8`), así que la confesión cuesta una frase y llega
antes de que nadie haya construido sobre la promesa; y cuadrecaja clasifica sus
reintentos por lo que el contrato promete que se escribió, de modo que saber que
esas dos filas eran optimistas puede explicarle un dato viejo que ya vio.

**No bloquea la firma del plan ni los pasos 1-6:** afecta a una frase del paso 7.
Si no llega respuesta, se aplica la recomendación y se anota en la bitácora.
