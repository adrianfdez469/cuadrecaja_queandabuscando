---
feature: F-038
agente: sdd-architect
actualizado: 2026-09-08T01:18:35Z
estado: listo
---

> Diseño sobre `.agent/specs/F-038/spec.md` en `estado: listo` (22 reglas
> R1-R22, 18 escenarios E1-E18, 14 criterios y dos preguntas `SP1`/`SP2` **no
> bloqueantes**, cada una con su defecto ya escrito como regla). No reabro nada
> de eso: aquí se decide **cómo** se construye, que es exactamente lo que la
> spec dejó en § «No decidido a propósito» —los nombres de las dos columnas, el
> reparto de las pruebas, si hay guion de humo propio, si el handler avisa por
> log y cómo se dedupe— más lo que el orquestador añadió: la firma exacta, el
> SQL exacto, el coste de escritura y la lista completa de lo que rompe en
> compilación.
>
> `design.md` está en `estado: no aplica` y sigue estándolo: backend puro, cero
> pantallas, cero JavaScript de cliente.
>
> Las tres decisiones del humano del 2026-09-07 —**D1** v12.2 menor, **D2** el
> aviso en el contrato y en `.agent/solicitudes.md`, **D3** `/^[A-Z]{3}$/` sin
> normalizar— están incorporadas y no se vuelven a abrir. `SP1` y `SP2` se
> diseñan **sobre su defecto** (R13 y R2); qué cambiaría exactamente con la otra
> opción está escrito en § Riesgos, una línea cada una, para que responderlas
> tarde no obligue a rediseñar.
>
> **Cuatro cosas comprobadas aquí, ejecutando, no leyendo:**
>
> 1. **`ALTER TYPE … ADD VALUE` SÍ corre dentro de la transacción de la
>    migración en este proyecto.** Postgres 16.15 (la imagen exacta de
>    `docker-compose.yml`). Reproducido en una base de usar y tirar
>    (`f038_scratch`, creada y borrada; la base `queandabuscando` **no se
>    tocó**): un `BEGIN`, el `ALTER TYPE`, los dos `ADD COLUMN` y un `COMMIT`
>    en el mismo bloque → `COMMIT` limpio. Lo único prohibido es **usar** el
>    valor nuevo en esa misma transacción (`55P04 unsafe use of new value`), y
>    esta migración no inserta ninguna fila. **No hay que partirla.** Lo
>    confirma además el precedente ya aplicado
>    `prisma/migrations/20260830170714_order_renegotiation/migration.sql`, con
>    tres `ADD VALUE` en un archivo.
> 2. **El SQL exacto que emite Prisma 7.9.1 para este cambio**, medido con
>    `npx prisma migrate diff` contra la base real y contra una base de sombra
>    con las 15 migraciones reproducidas. Está en § Modelo de datos, literal.
> 3. **Prisma 7.9.1 NO propone ningún `DROP INDEX` en este diff.** Medido dos
>    veces (contra la compartida y contra la de sombra): la salida son
>    exactamente cuatro líneas de SQL y ninguna es un `DROP`. Los cinco índices
>    GIN/parciales siguen los cinco en pie después de aplicar
>    (`SELECT count(*) FROM pg_indexes WHERE indexname IN (…)` → `5`). La regla
>    de R16(a) **no desaparece**: sigue siendo «lee cada `DROP INDEX` del
>    archivo generado y bórralo si coincide con uno de los cinco nombres» — lo
>    que este ciclo aporta es que, medido, la lista a borrar está vacía.
> 4. **La columna de lista rellena las filas que ya existen.** Un `ADD COLUMN`
>    de `TEXT[]` con `DEFAULT ARRAY[]::TEXT[]` sobre una tabla con
>    filas deja `{}` en todas, no `NULL` (Postgres 11+ guarda el default y no
>    reescribe la tabla). Verificado en la misma base de usar y tirar. Ningún
>    backfill, ninguna fila con `NULL` en un campo que Prisma tipa como no
>    nulo.

## Estado actual relevante

| Pieza                                                   | Qué aporta, y qué se reutiliza tal cual                                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sync/schemas.ts`                          | `syncEventSchema` (línea 136), la unión discriminada de cinco ramas, y `barcodes: z.array(z.string())` (línea 95), que es el molde literal de R2                                             |
| `src/features/sync/server/processBatch.ts`              | El bucle, el `catch` que ya construye `failed[]`/`results[]` y `applyEvent` (línea 164). Gana **una rama y un import**, nada más                                                             |
| `src/features/sync/server/handlers/types.ts`            | `HandlerOutcome`, `PROCESSED` (línea 57), `STALE` y `SyncEventFailure` (línea 71). **No cambian** (R15)                                                                                      |
| `src/features/sync/server/handlers/misc.ts`             | `handleCategory` (guarda anti-rancia en la línea 125, rama `DELETE` en la 131): el orden **contrario** al de R5, y por eso el molde de este handler es su forma, no su orden                 |
| `src/features/sync/server/handlers/store.ts`            | `prisma.business.update` (línea 72) — hoy el **único** escritor de `Business` desde el sync — y la guarda de la línea 115. Ninguno de los dos cambia (R10)                                   |
| `src/features/sync/server/handlers/product.ts`          | La misma guarda, línea 92. Tercera copia de la forma; la de este feature es la cuarta                                                                                                        |
| `src/features/sync/dependencies.ts`                     | `dependencyRoleOf` y su `default` con `const exhaustive: never` (líneas 65-68). Gana **un `case`** que devuelve dos `null` (R12), y es el sensor que nombra la entidad                       |
| `src/features/sync/identity.ts`                         | `findCatalogMismatch` y su condición `"businessId" in event.payload` (línea 28). **No cambia una línea** (R18/I6). Es además el precedente de capa: lógica pura del sync, fuera de `server/` |
| `src/features/sync/server/inbox.ts`                     | `recordBatch` (el `sort` estable de la línea 64) y `markFailed` (recorte a 500, línea 92). No cambian; su `entity: event.entity` es uno de los sitios que rompen en compilación (§ AD8)      |
| `src/features/sync/server/caller.ts`                    | `resolveCaller`: lee la fila `Business` por `syncTokenHash` en la **misma petición**. Es lo que hace que la fila exista siempre y lo que sostiene el diseño de un solo round-trip (§ AD3)    |
| `src/constants/sync.ts`                                 | Cinco constantes `string`, con `STORE_OPENING_HOURS_INVALID` (línea 34) y `DEPENDENCY_FAILED_IN_BATCH` (línea 61) como forma exacta a copiar                                                 |
| `src/features/orders/server/bell.ts`                    | El precedente del repo de «una sentencia condicional de un solo round-trip, **sin `$transaction`**, porque el pooler corre en modo transacción». Es el patrón de AD3                         |
| `prisma/schema.prisma`                                  | `enum SyncEntity` (línea 89), `model Business` (línea 126), `StoreProduct.imageUrls` (línea 465) —único precedente de columna array escalar— y `ExchangeRate.sourceUpdatedAt` (línea 557)    |
| `src/features/sync/server/dependencyCascade.db.test.ts` | El molde exacto del `*.db.test.ts` que entra por el `POST` de verdad: `vi.mock("next/cache")`, `await import(route)`, `post(session, events: unknown[])`, `createFixtureSession()`           |
| `src/features/sync/server/handlers/misc.test.ts`        | El molde del test de handler con Prisma mockeado por método                                                                                                                                  |
| `src/features/marketplace/server/dbFixtures.ts`         | `createFixtureSession()` — negocio propio, `syncToken` real, `businessExternalId`, `cleanup`. La fixture de este feature **no necesita nada nuevo**                                          |
| `scripts/send-catalog-batch.mjs`                        | El `suffix` fijo con `--repeat` (línea 58) y el patrón de bandera con caso de `--store-config` (líneas 63-70)                                                                                |
| `.agent/specs/F-036/smoke.sh`                           | Los helpers `check`/`code`/`body`/`sync_token` y el cuidado con las monedas quemadas. Se copian, no se importan                                                                              |

Nada nuevo en `src/app/`, `src/components/`, `src/lib/`, `src/features/catalog/`
ni `src/features/storefront/`. Cero rutas, cero tags de caché, cero tokens de
tema, cero bytes de JavaScript de cliente.

## Decisión

Una **columna de lista y una marca** en `Business`; una **sexta rama laxa** en
el sobre; un **handler nuevo** que hace dos comprobaciones puras y **una sola
sentencia condicional** contra Postgres; y **ningún** camino de invalidación,
porque no hay lector. Ocho decisiones, en orden de dependencia.

### AD1 — dos columnas, y se llaman `displayCurrencies` y `displayCurrenciesSourceUpdatedAt`

**Decisión.**

```prisma
model Business {
  // …
  active            Boolean  @default(true)
  /// F-038 (R8): what the merchant wants the storefront to show, in the order
  /// the POS sent it. Plain text, no `@relation` to `Currency` on purpose
  /// (R9): a code the merchant declares before its `CURRENCY` arrives is a
  /// normal, transient state, not an error. `@default([])` and "never
  /// received a BUSINESS event" are indistinguishable, and they mean the same
  /// thing to whoever reads it (F-039).
  displayCurrencies                String[]  @default([])
  /// The `updatedAt` of the BUSINESS payload that last wrote the list above —
  /// the instant the LIST changed (contract v12.1), not this row's own
  /// `updatedAt`. NULLABLE and WITHOUT `@default`, exactly like
  /// `ExchangeRate.sourceUpdatedAt` and `Store.sourceUpdatedAt`: no backfill,
  /// and the first delivery after the migration lands whatever its mark (E16).
  displayCurrenciesSourceUpdatedAt DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  // …
}
```

**Por qué `displayCurrenciesSourceUpdatedAt` y no `displayCurrenciesUpdatedAt`,
que es lo que proponía R8.** Porque `Business` **ya tiene** un `updatedAt`
(`@updatedAt`, gestionado por Prisma), y `displayCurrenciesUpdatedAt` al lado se
lee como «cuándo tocamos nosotros esa columna». Las cuatro columnas de este repo
que guardan la marca del payload del POS se llaman todas `sourceUpdatedAt`
(`Store`, `StoreProduct`, `LocalCategory`, `ExchangeRate`): `source` es la
palabra que este esquema ya usa para «lo que mandó el otro lado», y el prefijo
`displayCurrencies` es lo que R8 exige para que no se confunda con «la marca de
la fila `Business`». 32 caracteres, muy por debajo del límite de 63 de un
identificador de Postgres. Alternativas descartadas: `currenciesUpdatedAt`
(pierde el vínculo con la columna que protege), `sourceUpdatedAt` a secas (R8 lo
prohíbe con su motivo: `handleStore` escribe `name` y `baseCurrencyCode` en esta
misma fila **sin guarda ninguna**, así que una marca de fila sería mentira).

**Sin índice, a propósito.** Nadie consulta por `displayCurrencies` (criterio 11:
nadie la lee) y F-039 la leerá por `Business.id`, que es la clave primaria. Un
índice GIN sobre el array solo tendría sentido para una consulta del tipo «qué
negocios enseñan EUR», que nadie ha pedido; si aparece, es de F-039 o del
marketplace, no de aquí.

### AD2 — el valor `BUSINESS` del enum y las dos columnas van en **una sola** migración, sin partir

**Decisión.** Un `migration.sql` con dos sentencias, en este orden: primero el
`ALTER TYPE`, después el `ALTER TABLE`. El SQL literal y el procedimiento están
en § Modelo de datos y migraciones; aquí solo la decisión de que **no se parte**,
que es lo que el encargo pedía comprobar en vez de suponer: en Postgres 16.15
`ALTER TYPE … ADD VALUE` corre dentro de un bloque de transacción sin problema
—verificado ejecutándolo—, y la restricción real (no poder **usar** el valor
nuevo en la misma transacción, `55P04`) no aplica porque esta migración no
escribe ninguna fila de `SyncEvent`.

### AD3 — el handler es src/features/sync/server/handlers/business.ts (por crear), y escribe con **una sola sentencia condicional**

**Decisión: la firma, calcada de las tres primeras.**

```ts
export async function handleBusiness(
  payload: BusinessPayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
  businessId: string,
): Promise<HandlerOutcome>;
```

Idéntica a `handleStore`, `handleProduct` y `handleCategory`. **No** lleva
`renderableBranches: RenderableBranchLookup` —el cuarto parámetro de
`handleCurrency`/`handleExchangeRate`— porque no invalida nada (R13, SP1(a));
pedirlo «por si acaso» sería un parámetro muerto que el día de F-039 alguien
tendría que cablear igualmente.

**La rama del `switch` de `applyEvent`** (`src/features/sync/server/processBatch.ts`,
línea 164), añadida **la última**, en el mismo orden en que el contrato enumera
las entidades:

```ts
    case "BUSINESS":
      return handleBusiness(event.payload, event.operation, businessId);
```

**El cuerpo, con el orden de R5 y su coste medido:**

```ts
// 1. R5(1) — puro, cero round-trips. Antes que la guarda a propósito (E6):
//    un DELETE no es una operación de esta entidad en NINGÚN instante.
if (operation === "DELETE") {
  console.warn("[sync] BUSINESS event rejected: DELETE is not an operation of this entity", {
    businessId,
  });
  throw new SyncEventFailure(BUSINESS_DELETE_NOT_SUPPORTED);
}

// 2. R5(2)/R3 — puro, cero round-trips. Un error de FORMA no puede depender
//    de una marca de tiempo (E7).
const invalid = findInvalidDisplayCurrency(payload.displayCurrencies);
if (invalid !== null) {
  console.warn("[sync] BUSINESS event rejected: malformed displayCurrencies member", {
    businessId,
    member: invalid,
  });
  throw new SyncEventFailure(BUSINESS_DISPLAY_CURRENCIES_INVALID);
}

// 3 + 4. R5(3)+R5(4) en UNA sentencia: la guarda `>=` es el `WHERE`, y el
//        `count` distingue stale de processed. UN round-trip, sin
//        `$transaction` (AGENTS.md § Cosas que muerden: el pooler corre en
//        modo transacción y el cliente global no puede entrar en un bloque
//        transaccional). Misma SEMÁNTICA que la guarda de STORE/CATEGORY/
//        PRODUCT — una sentencia en vez de dos, nunca la forma de orden de
//        EXCHANGE_RATE (R6, docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md).
const payloadUpdatedAt = new Date(payload.updatedAt);
const written = await prisma.business.updateMany({
  where: {
    id: businessId,
    OR: [
      { displayCurrenciesSourceUpdatedAt: null },
      { displayCurrenciesSourceUpdatedAt: { lt: payloadUpdatedAt } },
    ],
  },
  data: {
    displayCurrencies: { set: dedupeDisplayCurrencies(payload.displayCurrencies) },
    displayCurrenciesSourceUpdatedAt: payloadUpdatedAt,
  },
});

return written.count === 0 ? STALE : PROCESSED;
```

**Por qué un `updateMany` condicional y no leer-y-escribir como las otras tres.**
Tres razones, en orden de peso:

1. **Cuesta la mitad.** Las otras tres leen la fila porque necesitan algo más
   que la marca (el `id` existente, el slug, la configuración de compra). Aquí
   no se necesita **nada** de la fila salvo la marca, y la marca cabe en el
   `WHERE`. Un round-trip en vez de dos, en un lote que puede traer 500 eventos.
2. **No tiene ventana de actualización perdida.** El `UPDATE` con la guarda en
   su propio `WHERE` se evalúa atómicamente bajo `READ COMMITTED`: dos lotes
   concurrentes del mismo negocio se serializan sobre la fila y el más viejo
   **pierde** siempre. La pareja leer-y-escribir tiene una ventana en la que los dos leen
   la marca vieja y el segundo pisa al primero. Y la forma «obvia» de cerrar esa
   ventana —envolver el par en un `$transaction`— es exactamente lo que
   `AGENTS.md` prohíbe con el pooler de Supabase en modo transacción.
3. **`stale` y `processed` se distinguen sin ambigüedad.** `count === 0`
   significa «ninguna fila cumplió el `WHERE`», y en este handler eso solo puede
   ser «la marca guardada es `>=` la del payload», porque **la fila existe
   siempre**: `resolveCaller` (`src/features/sync/server/caller.ts`) la leyó por
   `syncTokenHash` en esta misma petición para autenticar el lote. Sin esa
   precondición el `count === 0` sería ambiguo y habría que confirmar con una
   segunda consulta; con ella, no. Queda escrito aquí y en el comentario del
   handler porque es la única premisa que sostiene el atajo.

**Lo que el handler NO hace, y se prueba:** no toca `Currency` ni `ExchangeRate`
(R9), no toca `name`/`baseCurrencyCode`/`active`/`syncTokenHash` (R10), no
resuelve el negocio desde el payload (R11: el `where` va por `businessId`, el
uuid interno que `applyEvent` ya trae), y devuelve `PROCESSED` pelado, sin
ningún campo `touched*` (R13).

### AD4 — la deduplicación es `[...new Set(codes)]`, y vive en un módulo puro

**Decisión.** src/features/sync/displayCurrencies.ts (por crear), hermano de
`src/features/sync/identity.ts` y `src/features/sync/dependencies.ts`: capa
`src/features/*/` (lógica de dominio pura), sin Prisma, sin React, sin
importaciones de valor fuera de sí mismo.

```ts
/** R3 (D3, humano 2026-09-07): exactly three uppercase A-Z letters. Never
 *  case-folded, never trimmed — a code that matches no `Currency` row is
 *  never painted and nobody notices, and the silent failure is what this
 *  entity exists to prevent. */
export const DISPLAY_CURRENCY_CODE = /^[A-Z]{3}$/;

/** The FIRST member that is not a valid code, or `null` when every one is.
 *  Returns the value (not a boolean) so the caller can name it in its
 *  `console.warn` — the wire error carries no detail at all (R14). */
export function findInvalidDisplayCurrency(codes: readonly string[]): string | null;

/** R4: exact string equality, byte for byte; the FIRST occurrence survives and
 *  the relative order of the rest is preserved. `Set` IS that rule —
 *  SameValueZero, insertion order — so this is the statement of R4, not an
 *  implementation of it. */
export function dedupeDisplayCurrencies(codes: readonly string[]): string[];
```

`dedupeDisplayCurrencies` es `[...new Set(codes)]`: `Set` compara con
SameValueZero (igualdad exacta, sin plegar mayúsculas ni recortar) y conserva el
orden de inserción, que es literalmente R4. Alternativa descartada:
`codes.filter((c, i, a) => a.indexOf(c) === i)`, O(n²) y que además **no dice**
qué comparación hace.

**Por qué un módulo y no dos funciones privadas dentro del handler.** Porque R5
exige que los pasos 1 y 2 sean **puros y anteriores a la base**, y un módulo
puro es lo que permite probar R3 y R4 —las dos reglas de las que depende el
vocabulario de error que ve el POS— en el proyecto `server`, **sin mockear
Prisma para nada**. Es el mismo reparto que ya hacen
`src/features/sync/server/storeConfig.ts` y `src/lib/openingHours.ts` respecto de
`src/features/sync/server/handlers/store.ts`.

### AD5 — sí hay `console.warn`, dos sitios, prefijo `[sync]`, nunca en el camino `stale`

**Decisión.** Los dos rechazos del handler (AD3, pasos 1 y 2) emiten un
`console.warn` con el prefijo `[sync]` **al principio de la línea** y sin la
palabra `Error` en ninguna parte, exactamente como el que `processBatch.ts` ya
imprime para `DEPENDENCY_FAILED_IN_BATCH`. Nunca `console.error`: una línea con
esa forma marca las etapas `smoke`/`visual`/`probe` como «el servidor se cayó»
aunque todo haya respondido bien (R21, ficha
`.agent/playbook/console-error-dispara-guardian-servidor.md`).

**Por qué hace falta.** La cadena que viaja al POS va **sin adornos** (R14): no
lleva el código ofensivo ni su índice. Sin este log, la única forma de saber
_cuál_ de los cuarenta códigos venía mal es leer `SyncEvent.payload` en
Postgres. El log lo pone en la salida del servidor, que es donde se mira
primero.

**Dos límites del log, y no son un descuido.** (a) El `eventId` **no está en
ámbito**: los handlers reciben `payload`, `operation` y `businessId`, y cambiar
la firma solo para poder loguear un id obligaría a tocar los otros cinco
handlers — la correlación con el outbox del POS la da `SyncEvent.error` +
`businessId`. (b) **No se loguea la lista entera**, solo el primer miembro
ofensivo: una lista de cuarenta códigos en el log es ruido.

**Nada se loguea en el camino `stale`.** Es un desenlace normal y esperado; un
lote reentregado de 500 eventos imprimiría 500 líneas de nada.

### AD6 — el reparto de las pruebas: seis archivos en `server`, uno en `db`

**Decisión, archivo por archivo.** Lo que no necesita Postgres no lo pide, y
todo lo que el criterio expresa como «responde 207 … verificado leyendo la fila»
entra por el `POST` de verdad.

| Archivo                                                           | Proyecto | Existe                | Qué cubre                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/sync/schemas.test.ts`                               | `server` | sí, se extiende       | La frontera de R2: un `BUSINESS` válido pasa; `ZONE_TARIFF` no (mitad unitaria de C2); falta `displayCurrencies`, `displayCurrencies: "USD"` y un `updatedAt` no-ISO fallan; **`["usd"]`, `["US1"]` y 40 códigos PASAN aquí**                                |
| src/features/sync/displayCurrencies.test.ts (por crear)           | `server` | **no, hay que crear** | R3 parametrizado (`"usd"`, `"US1"`, `"€€€"`, `"USDD"`, `""`, `"  "`, `"USD "`) y R4 (primera aparición, orden relativo, `[]`, 40 distintos). Sin Prisma, sin mocks                                                                                           |
| src/features/sync/server/handlers/business.test.ts (por crear)    | `server` | **no, hay que crear** | El handler con Prisma mockeado: el **orden** de R5, que los pasos 1 y 2 no llaman a `updateMany` ni una vez, que `count: 0` → `STALE` y `count: 1` → `PROCESSED` pelado, que el `where` va por `businessId` y que `currency`/`exchangeRate` no se tocan (R9) |
| `src/features/sync/dependencies.test.ts`                          | `server` | sí, se extiende       | `dependencyRoleOf` de un `BUSINESS` → `{ provides: null, requires: null }` (R12), y el `BUSINESS` entra en el bucle de «no entity plays both roles at once»                                                                                                  |
| `src/features/sync/identity.test.ts`                              | `server` | sí, se extiende       | Mitad unitaria de C9 (R18/I6): un `BUSINESS` con `businessId` ajeno devuelve `events[0].payload.businessId`; uno propio devuelve `null`. **Sin tocar `src/features/sync/identity.ts`**                                                                       |
| `src/features/sync/server/processBatch.test.ts`                   | `server` | sí, se extiende       | El enrutado: un `BUSINESS` llama a `handleBusiness(payload, operation, caller.businessId)` y a nadie más; y la mitad unitaria de E14 (un `BUSINESS` que falla no arrastra al `PRODUCT` siguiente)                                                            |
| src/features/sync/server/handlers/business.db.test.ts (por crear) | `db`     | **no, hay que crear** | C1, C2 (mitad `POST`), C3, C4 + E6, C5 + la retirada de R7, C6, C7, C8, C9 (mitad `POST`), C10, E13, E16 y E17. Todo contra el `POST` real y leyendo la fila                                                                                                 |

**Tres decisiones dentro de este reparto, con su motivo:**

1. **Un archivo de unidad propio para el handler, no un `describe` más en
   `src/features/sync/server/handlers/misc.test.ts`.** Ese archivo ya son 17 KB
   y monta un mock de Prisma para tres handlers de tres entidades distintas;
   la convención del directorio es un archivo de test por módulo de handler
   (`store.test.ts`, `product.test.ts`, `misc.test.ts`), y business.ts (por
   crear) es un módulo propio.
2. **Un solo `*.db.test.ts`, no dos.** C2 y C9 podrían caer en
   `src/features/sync/server/handlers/storePublishGate.db.test.ts` o en
   `src/features/sync/server/tenantScoping.db.test.ts`, pero esos son de F-032 y
   F-018; juntar los trece escenarios de esta entidad en un archivo hace que el
   feature se revise de una lectura. Es el mismo criterio con el que F-037 abrió
   `src/features/sync/server/dependencyCascade.db.test.ts` en vez de repartir.
3. **`processBatch.test.ts` tiene que mockear el módulo nuevo aunque no lo
   pruebe.** Ese archivo mockea `./handlers/store`, `./handlers/product` y
   `./handlers/misc`; si `./handlers/business` queda sin mockear, sus **doce
   casos actuales** cargan el módulo real y con él `@/lib/prisma`. Es un paso
   del plan, no un descubrimiento en rojo.

**Dos trampas del `*.db.test.ts` nuevo, heredadas y ya fichadas:**

- **`vi.mock("next/cache")` es obligatorio** para llamar al route handler desde
  Vitest, o revienta con `Invariant: static generation store missing` (ficha
  `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`).
- **El código de moneda sintético de C7 tiene que estar libre.** `Currency` es
  global a la plataforma. Quemados hasta hoy: `CUP`, `USD`, `MLC` (seed), `EUR`,
  `ABC`, `XYZ`, `AAA`, `BBB`, `CCC`, `DDD`, `WVX`, `QAB`, `ZZZ`, `FQV`, `KZR`,
  `MXR`. **La gracia de C7 es que este handler no escribe en `Currency`**, así
  que el código elegido no necesita limpieza — y esa ausencia de `afterAll` es
  parte de lo que el criterio demuestra. Cuidado con los 40 códigos de C10: se
  generan `AAA`, `AAB`, … y **`AAA` ya está quemado**; da igual, porque tampoco
  se escribe en `Currency`, pero conviene no elegirlos con criterio de moneda
  real (C10 lo dice).
- El evento `ZONE_TARIFF` de C2 **no es asignable a `SyncEventInput`**. Se envía
  por el helper `post(session, events: unknown[])` que
  `dependencyCascade.db.test.ts` ya usa: `unknown[]`, nunca `any` (ESLint lo
  prohíbe como error).

### AD7 — sí, F-038 tiene guion de humo propio

**Decisión.** .agent/specs/F-038/smoke.sh (por crear), ejecutable con
`bash .agent/verify.sh F-038 --smoke`.

**Por qué.** El criterio 14 pide `--full`, que **no** incluye la etapa `smoke`
(`.agent/verify.sh`, línea 75, la lista `STAGES_COMPLETO`), así que el guion no
es obligatorio. Pero C11(b) y C12 exigen `next dev` levantado y **son doce
comandos con sus asertos**: dejarlos «a mano» significa que se ejecutan una vez,
el día que se cierra el feature, y nunca más. F-035 y F-036 —los dos features
hermanos de este, ambos de sync y ambos con guion de escritura— tomaron la misma
decisión, y sus helpers (`check`, `code`, `body`, `sync_token`) se copian tal
cual.

**Qué cubre y en qué orden**, que es donde están las dos trampas:

1. **C12, los seis comandos de la spec, en ese orden exacto y no en otro.**
   `--business` va **primero** a propósito: sobre un negocio cuya marca es
   `NULL` (E16), `--business --stale` respondería `processed` y no `stale`,
   porque la guarda no rechaza nada cuando no hay marca. La secuencia de la spec
   ya lo respeta; el guion tiene que fijarlo, con un comentario que diga por qué.
2. **El par `--repeat` no es idempotente entre corridas.** `--repeat` fija el
   `eventId` (`scripts/send-catalog-batch.mjs`, línea 58), así que en la
   **segunda** ejecución del guion contra la misma base el primer `--repeat` ya
   responde `duplicate` y el aserto «processed, luego duplicate» falla sin que
   nada esté roto. El guion borra por SQL, justo antes de ese par, las filas de
   `SyncEvent` cuyo `eventId` es uno de los dos ids fijos, igual que los
   guiones de F-035 y F-036 limpian lo suyo.
3. **C11(b), con un control antes del escenario.** Se hace `curl` de una página
   pública del seed **dos veces seguidas y se diffean entre sí** antes de tocar
   nada: si ya difieren (un nonce, el orden de los chunks de `__next_f` en
   `next dev`), el aserto del escenario se hace sobre la misma normalización en
   las dos mitades, y el guion lo dice en su salida. Sin ese control, un `diff`
   en rojo no distingue «este feature pintó algo» de «dev no es determinista», y
   ese diagnóstico es justo el que cuesta un ciclo.
4. **El residuo es veraz.** `--business` por defecto manda las tres monedas
   reales del seed (`CUP`, `USD`, `MLC`), así que lo que queda escrito en
   `seed-negocio-1` es cierto. `--business=forty` deja basura y se restaura
   corriendo `--business` otra vez, que lleva marca nueva y la pisa: el guion
   termina siempre con esa llamada.

### AD8 — lo que rompe en compilación al crecer el union, enumerado

Añadir la sexta rama a `syncEventSchema` rompe **tres** sitios de producto. Los
tres son la señal que sus propios comentarios anuncian; van en el plan como
pasos, no como sorpresas.

| #   | Dónde                                                        | Qué error, y si nombra la entidad                                                                                                                                                                                 |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/features/sync/dependencies.ts`, líneas 65-68            | `const exhaustive: never = event` deja de compilar (TS2322) **nombrando `BUSINESS`** en el mensaje. Es el sensor que R12 describe, y el motivo por el que hay que tocar ese archivo aunque el `case` no haga nada |
| 2   | `src/features/sync/server/processBatch.ts`, línea 164        | El `switch` de `applyEvent` no tiene `default`, así que su tipo de retorno gana `undefined` y el error salta **abajo**, en el `await applyEvent(…)` del bucle («possibly undefined»), **sin nombrar la entidad**  |
| 3   | `src/features/sync/server/inbox.ts`, dentro de `recordBatch` | `entity: event.entity` se pasa al `createMany` de `SyncEvent`, tipado `$Enums.SyncEntity`. `"BUSINESS"` no es asignable **hasta que `prisma/schema.prisma` tenga el valor Y se haya corrido `prisma generate`**   |

**La consecuencia de orden, que es lo que importa para el plan:** el sitio 3
obliga a que **el schema de Prisma y `npx prisma generate` vayan ANTES** de
tocar `src/features/sync/schemas.ts`. Al revés, `npm run typecheck` sale rojo
por un motivo que no es el trabajo de nadie y cuesta un ciclo diagnosticarlo.

Un cuarto sitio, de pruebas y no de compilación, está en AD6(3):
`src/features/sync/server/processBatch.test.ts` tiene que mockear
`./handlers/business` o sus doce casos actuales cargan Prisma de verdad.

**No rompe** `src/features/sync/identity.ts` (R18/I6: su condición es
`"businessId" in event.payload` y el payload lo lleva), ni
`src/features/sync/server/reconciliation.ts`, ni
`src/features/storefront/server/registry.ts`, ni ningún `*.tsx`. Comprobado con
`grep` sobre `.entity` y `SyncEntity` en todo `src/` y `scripts/`: los dos únicos
`switch` del repo sobre `event.entity` son los sitios 1 y 2.

## Componentes

| Componente                                               | Capa                        | Responsabilidad                                                                            | Archivo                                                   |
| -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `businessPayloadSchema` + la sexta rama                  | `src/features/*/schemas.ts` | Forma y presencia: `businessId`, `displayCurrencies: z.array(z.string())`, `updatedAt` ISO | `src/features/sync/schemas.ts`                            |
| Los dos códigos de error de la v12                       | `src/constants/`            | Vocabulario exacto que compara el POS, sin adornos (R14)                                   | `src/constants/sync.ts`                                   |
| `findInvalidDisplayCurrency` + `dedupeDisplayCurrencies` | `src/features/*/` (puro)    | R3 y R4. Sin Prisma, sin React                                                             | src/features/sync/displayCurrencies.ts (por crear)        |
| `handleBusiness`                                         | `src/features/*/server/`    | Las cuatro comprobaciones de R5 y la única escritura                                       | src/features/sync/server/handlers/business.ts (por crear) |
| La rama del `switch`                                     | `src/features/*/server/`    | Enrutar `BUSINESS` al handler                                                              | `src/features/sync/server/processBatch.ts`                |
| `case "BUSINESS"` de `dependencyRoleOf`                  | `src/features/*/` (puro)    | Declarar que no participa en el arrastre (R12)                                             | `src/features/sync/dependencies.ts`                       |
| Las dos columnas y el valor del enum                     | `prisma/`                   | Dónde vive la lista y su marca                                                             | `prisma/schema.prisma` + la migración (por crear)         |
| `--business[=caso]`                                      | `scripts/`                  | Verificación en runtime de los cuatro desenlaces (R22)                                     | `scripts/send-catalog-batch.mjs`                          |

**Los presets de `--business` van dentro de `scripts/send-catalog-batch.mjs`,
no en un módulo aparte.** `scripts/store-event.mjs` existe porque **dos**
guiones comparten los eventos `STORE` y ya habían divergido; aquí el consumidor
es uno solo. La forma es la misma tabla de datos que `STORE_CONFIG_CASES` —seis
entradas, `ok` (las tres monedas del seed), `invalid`, `delete` (que además
cambia la `operation`), `empty`, `dup`, `forty`—, con un comentario que diga que
se muda a su propio módulo el día que un segundo guion la necesite.

## Flujo de datos

```
POST /api/internal/sync/catalog
  └─ withInternalAuth → resolveCaller: LEE la fila Business por syncTokenHash  ← la fila existe (AD3)
  └─ catalogBatchSchema.safeParse   ← ZONE_TARIFF muere aquí: 400 INVALID_BATCH (E2)
  └─ findCatalogMismatch            ← businessId ajeno: 403, antes de recordBatch (E11)
  └─ processCatalogBatch
       └─ recordBatch: escribe SyncEvent (entity = 'BUSINESS'), ordena por occurredAt
       └─ por evento:
            dependencies.blockedBy(event) → siempre null para BUSINESS (R12)
            applyEvent → case "BUSINESS" → handleBusiness(payload, operation, businessId)
                 1. DELETE?            → console.warn + throw SyncEventFailure   (0 round-trips)
                 2. ¿miembro inválido? → console.warn + throw SyncEventFailure   (0 round-trips)
                 3+4. updateMany condicional                                     (1 round-trip)
                        count === 0 → STALE      → results[].status = "stale", viaja en ok
                        count === 1 → PROCESSED  → results[].status = "processed"
            dependencies.note(event, outcome.status) → no-op: provides === null
       └─ markProcessed / markFailed
       └─ revalidate* : el BUSINESS no aporta NADA a ninguno de los cuatro Sets (R13)
  └─ 207
```

Los dos `throw` no necesitan una línea nueva en `processBatch.ts`: el `catch`
del bucle ya convierte `error.message` en `failed[].error`, `results[].error` y
`markFailed` (R15, la razón por la que `SyncEventFailure` existe desde F-032).

## Contratos

**El sobre** (`src/features/sync/schemas.ts`), sexta rama al final del union,
en el orden en que el contrato enumera las entidades:

```ts
export const businessPayloadSchema = z.object({
  businessId: z.string().min(1),
  /** F-038 v12 (R2, SP2(a)): LAX on purpose, calcado de `barcodes` (line 95).
   *  The MEMBERS are checked in the applier, never here — declaring
   *  `z.string().length(3)` would turn one junk code into a
   *  `400 INVALID_BATCH` that takes the other 499 events of the batch down
   *  with it. No `.max()` either (R17). */
  displayCurrencies: z.array(z.string()),
  /** The instant the LIST changed (contract v12.1), never the max of its
   *  rows' marks — see spec.md R7. Only stored and compared here. */
  updatedAt: isoDate,
});

// …dentro de syncEventSchema, tras la rama de EXCHANGE_RATE:
  z.object({
    eventId: z.string().min(1),
    entity: z.literal("BUSINESS"),
    operation: syncOperationSchema,
    occurredAt: isoDate,
    payload: businessPayloadSchema,
  }),

export type BusinessPayload = z.infer<typeof businessPayloadSchema>;
```

**Las dos constantes** (`src/constants/sync.ts`), con la forma que ya tiene el
archivo —módulo de constantes `string`, no un enum— y su comentario de origen:

```ts
export const BUSINESS_DISPLAY_CURRENCIES_INVALID = "BUSINESS_DISPLAY_CURRENCIES_INVALID";
export const BUSINESS_DELETE_NOT_SUPPORTED = "BUSINESS_DELETE_NOT_SUPPORTED";
```

Las pruebas **importan la constante**, nunca copian la cadena (R14).

**La tabla de errores de esta entidad**, que es la que el contrato ya publicó y
este feature pone en pie:

| Qué llega                                      | Capa que decide | Respuesta                                                        |
| ---------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `entity` fuera del vocabulario (`ZONE_TARIFF`) | sobre           | `400 INVALID_BATCH`, lote entero, cero filas de `SyncEvent`      |
| Falta `businessId`/`displayCurrencies`         | sobre           | `400 INVALID_BATCH`, lote entero                                 |
| `displayCurrencies` no es lista, o `[123]`     | sobre           | `400 INVALID_BATCH`, lote entero (defecto de SP2; ver § Riesgos) |
| `updatedAt` no ISO 8601                        | sobre           | `400 INVALID_BATCH`, lote entero                                 |
| `businessId` ajeno al token                    | route           | `403 BUSINESS_MISMATCH`, antes de `recordBatch`                  |
| `operation: "DELETE"`                          | handler, paso 1 | `207`, `failed[]` con `BUSINESS_DELETE_NOT_SUPPORTED`            |
| Miembro que no casa `/^[A-Z]{3}$/`             | handler, paso 2 | `207`, `failed[]` con `BUSINESS_DISPLAY_CURRENCIES_INVALID`      |
| Marca guardada `>=` la del payload             | handler, paso 3 | `207`, `results[].status = "stale"`, **en `ok`**, nada escrito   |
| Todo bien                                      | handler, paso 4 | `207`, `processed`, lista deduplicada y marca escritas           |

Ningún estado nuevo en `EVENT_STATUS` y ningún miembro nuevo en
`HandlerOutcome` (R15). `docs/sync-contract.md` **no se toca en este diseño**:
se toca al cerrar, en la v12.2 (D1, R19), en los tres sitios que I9 enumera.

## Modelo de datos y migraciones

### El SQL exacto, medido

Nombre propuesto de la carpeta: `<timestamp>_business_display_currencies`.
Contenido de su `migration.sql`, que es **literalmente** lo que emite
`npx prisma migrate diff` para este cambio (medido dos veces: contra la base
compartida y contra una base de sombra con las 15 migraciones reproducidas):

```sql
-- AlterEnum
ALTER TYPE "SyncEntity" ADD VALUE 'BUSINESS';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "displayCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "displayCurrenciesSourceUpdatedAt" TIMESTAMP(3);
```

**El orden importa y es este.** El `ALTER TYPE` primero porque es la sentencia
que podría exigir partir el archivo si el motor no la admitiera en transacción;
comprobado que sí (ver la cabecera de este documento y AD2), va delante y no
pasa nada. El `ALTER TABLE` es aditivo puro: `TEXT[]` con default constante no
reescribe la tabla y rellena las filas existentes con `{}`.

**Qué hay que quitar a mano del archivo que genere `prisma migrate dev`.**
Medido: **nada, en este diff concreto**. Prisma 7.9.1 no propone ningún
`DROP INDEX` aquí, ni contra la base compartida ni contra una de sombra
reproducida desde `prisma/migrations/`, y los cinco índices GIN/parciales siguen
los cinco en pie después de aplicar. **La regla de R16(a) sigue viva igualmente**:
se abre el `migration.sql` generado, se busca `DROP INDEX`, y se borra toda línea
que nombre uno de los cinco de la ficha
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`
(`CanonicalProduct_searchVector_idx`, `CanonicalProduct_name_trgm_idx`,
`StoreProduct_visible_catalog_idx`, `StoreProduct_searchVector_idx`,
`StoreProduct_searchDocument_trgm_idx`). Que la lista salga vacía esta vez no
convierte el paso en opcional: F-036 midió cuatro en su diff y el precedente
`prisma/migrations/20260830170714_order_renegotiation/migration.sql` documenta en
su cabecera las que quitó. Si aparece alguno, se quita y se documenta en la
cabecera del archivo con la misma forma que ese precedente.

### Cómo se genera, y qué NO se ejecuta

```bash
# 1. Generar SIN aplicar. `migrate dev` a secas (npm run db:migrate) APLICA:
#    en este ciclo no se aplica nada a la base compartida.
npx prisma migrate dev --create-only --name business_display_currencies

# 2. Revisar el migration.sql: comparar cada DROP INDEX contra los cinco
#    nombres de la ficha; quitar los que coincidan (medido: ninguno).

# 3. Regenerar el cliente — sin esto, `inbox.ts` no compila (AD8, sitio 3).
npx prisma generate

# 4. Validar la migración contra una base de USAR Y TIRAR, nunca la
#    compartida (queandabuscando). Reproducido de punta a punta al escribir
#    este documento:
docker exec queandabuscando-postgres psql -U postgres -c 'CREATE DATABASE f038_check;'
DIRECT_URL=postgresql://postgres:postgres@localhost:5433/f038_check \
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/f038_check \
  npx prisma migrate deploy
#    y el aserto de que el archivo dice exactamente lo que dice el schema:
DIRECT_URL=postgresql://postgres:postgres@localhost:5433/f038_check \
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/f038_check \
  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
#    → "-- This is an empty migration."   (comprobado)
docker exec queandabuscando-postgres psql -U postgres -c 'DROP DATABASE f038_check;'
```

`prisma migrate reset` y `prisma db push` **no aparecen y no hacen falta**
(AGENTS.md § Comandos prohibidos): el cambio es aditivo, no hay deriva
(`npx prisma migrate status` sobre la compartida da «Database schema is up to
date!», comprobado) y no hay nada que rellenar.

**Aplicar la migración a la base compartida es decisión del humano**, una sola
vez y anunciada: es `AP1`. Mientras no se aplique, el proyecto `db` de la suite
queda rojo **en todos los worktrees** con el error `does not exist in the current
database` — no es un bug de quien implemente, es la ficha
`.agent/playbook/code-ahead-of-shared-db-migration-rompe-db-tests.md`, y se
documenta en `impl.md` con el código de salida real en vez de forzarlo a verde.

### Nada nuevo en `docs/despliegue.md` § 1, pero sí en § 8.3 — y la spec no lo vio

La migración no necesita línea en § 1 «La base de datos»: es aditiva, viaja en
`prisma/migrations/`, `npm run db:deploy` la aplica sola, no lleva backfill y el
aviso genérico de los `DROP INDEX` ya está escrito ahí.

Lo que **sí** deja de ser cierto está en otro sitio, y es un hallazgo de este
ciclo: `docs/despliegue.md` § 8.3 «⟳ Publicar una versión del contrato»,
párrafo «**De la v12 hay que avisar en un orden concreto, y esta es la parte
operativa**», dice hoy que «`entity` no admite todavía `BUSINESS`» y que «el
aviso se manda cuando el schema del sobre lo acepte». Al cerrar F-038 el schema
lo acepta, así que ese párrafo pasa a describir un paso **ya hecho** y hay que
fecharlo. **I9 de la spec enumera tres sitios y son cuatro**: los tres del
contrato más este. La corrección es del ciclo que cierra el feature, no de
F-039, y AGENTS.md la exige explícitamente («paso operativo nuevo → una línea en
`docs/despliegue.md`, en el mismo ciclo que lo introduce»). No lo toco: lo
señalo para que el plan lo liste.

## Escalabilidad y límites

**Coste del handler, en round-trips, que es la pregunta del encargo:**

| Desenlace                             | Round-trips | Por qué                                              |
| ------------------------------------- | ----------- | ---------------------------------------------------- |
| `BUSINESS_DELETE_NOT_SUPPORTED`       | **0**       | Comprobación pura antes de tocar la base (R5)        |
| `BUSINESS_DISPLAY_CURRENCIES_INVALID` | **0**       | Ídem                                                 |
| `stale`                               | **1**       | El `updateMany` condicional que no casa ninguna fila |
| `processed`                           | **1**       | El mismo `updateMany`, que casa una                  |

Comparación honesta: `handleCategory` cuesta 2-3 (leer, escribir, resolver
sucursales), `handleStore` 3+, `handleExchangeRate` 3 (`upsert` de `Currency`,
`create` de la tasa, memo de sucursales). Este es el handler más barato de los
seis, y lo es porque no tiene nada que leer.

**Un lote de 500 eventos con K `BUSINESS` dentro cuesta exactamente K
round-trips más**, sin N+1 y sin ninguna consulta por evento ajeno: el handler
solo corre para su propio evento y no consulta ni `Currency` ni `ExchangeRate`
(R9). Con el techo del lote (`MAX_CATALOG_EVENTS = 500`), el peor caso absoluto
—500 `BUSINESS` del mismo negocio— son 500 `UPDATE` de una fila, todos menos el
último respondiendo `stale` o pisándose en orden; ninguno bloquea a los demás más
de lo que Postgres serializa una fila.

**El pooler.** Una sentencia, nunca dentro de un `$transaction`: el pooler de
Supabase corre en **modo transacción** y el cliente global no puede entrar en un
bloque transaccional sin hacer deadlock contra la conexión del pool (AGENTS.md
§ Cosas que muerden). El precedente literal de esta forma es
`src/features/orders/server/bell.ts`. Ese es el motivo por el que la alternativa
«leer-y-escribir dentro de una transacción para que la guarda sea atómica»
**está descartada de raíz**, no por gusto.

**Volumen de datos.** Dos columnas en una tabla de una fila por negocio.
Cuarenta códigos ocupan ~320 bytes en línea; el umbral de TOAST son ~2 KB, así
que harían falta más de 250 códigos para que la fila saliera fuera de línea, y
esa lista no existe (hay ~180 monedas ISO). Con 100× negocios (10 000 filas) son
~3 MB. La marca son 8 bytes. **Lo que se rompe primero al multiplicar por 100 no
es nada de este feature**: es el `IN (500 ids)` de `recordBatch`, que ya existía.

**La suite.** El proyecto `db` pasa de 15 a 16 archivos y corre en serie
(`fileParallelism: false`, `vitest.config.mts`), así que el coste es tiempo de
pared —del orden de los otros archivos de sync, unos segundos—, no presión de
conexiones. El techo declarado de conexiones no se mueve.

**Caché y JavaScript de cliente:** cero y cero. No hay tag que invalidar porque
no hay lector (R13), y `git diff --stat main -- src/app src/components
src/features/catalog src/features/storefront` tiene que salir **vacío** al
cerrar (C11(a)); este diseño no toca ninguno de esos cuatro directorios.

## Patrones a seguir / antipatrones a evitar

**A seguir:**

- La guarda **rechaza-y-`STALE`**, no la de orden (R6, AGENTS.md § Cosas que
  muerden y `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`). El
  comentario del handler tiene que decir que la **semántica** es la de
  `STORE`/`CATEGORY`/`PRODUCT` y que lo único distinto es que cabe en una
  sentencia, para que nadie lea el `updateMany` como una tercera forma.
- Un fallo por evento se **lanza** con `SyncEventFailure`, nunca se añade como
  miembro de `HandlerOutcome` (R15: caería en el `else` de `processBatch.ts` sin
  error del compilador y el evento se reportaría en `ok`).
- Prisma solo en `src/features/*/server/` (AGENTS.md § Arquitectura). Lo puro
  —R3 y R4— vive fuera, junto a `identity.ts` y `dependencies.ts`.
- `console.warn` con prefijo `[scope]` al principio de la línea, nunca
  `console.error` (AGENTS.md § Cosas que muerden, R21).
- Nada de magic strings: el regex y los dos códigos son constantes exportadas
  (AGENTS.md § Prohibiciones).

**A evitar, con nombre y apellidos:**

- **Normalizar a mayúsculas o recortar espacios** en los códigos. D3 lo prohíbe
  y el motivo está en R3: inventaría una conversión que el otro lado no espera.
- **Envolver la lectura y la escritura en un `$transaction`** (ver
  § Escalabilidad).
- **Dar de alta una `Currency` provisional** para un código que no la tiene,
  copiando `handleExchangeRate` (R9). Ese `upsert` existe allí porque hay una
  clave ajena que satisfacer; aquí la lista es texto suelto a propósito.
- **Escribir sobre `payload.businessId`.** El `where` va por el uuid interno
  (R11, F-018).
- **Poner un `.max()`** en el schema, en el handler o en la columna (R17).
- **Citar entre comillas invertidas un archivo que aún no existe** en cualquier
  `.md` de `.agent/` (AGENTS.md § Cosas que muerden): sin comillas y con
  «(por crear)» detrás, y ganan sus comillas cuando existan. La exención de
  `scripts/check-harness.mjs` para features abiertos **desaparece** en cuanto
  F-038 pase a `passes: true`, así que no se depende de ella.

### La línea de `AGENTS.md` que cambia (I8) — no la toco yo

`AGENTS.md`, § Cosas que muerden, **línea 191**. La frase exacta de hoy es:

```
devuelve `STALE` (`STORE`, `CATEGORY`, `PRODUCT`) y la de **orden**, de
```

y tiene que pasar a enumerar cuatro:

```
devuelve `STALE` (`STORE`, `CATEGORY`, `PRODUCT`, `BUSINESS`) y la de
**orden**, de
```

Dos avisos para quien la edite. Va **en el mismo commit que el código** (I8,
igual que hizo F-036 al añadir la forma de orden). Y añadir doce caracteres
reajusta el salto de línea del párrafo: hay que pasar `npm run format` y
**diffear**, porque Prettier reindenta la prosa del arnés y una línea de
continuación que empiece por `-`, `+` o `*` se convierte en viñeta y cambia el
sentido de la frase (AGENTS.md § Cosas que muerden, la segunda mitad de la
trampa de Prettier).

## Riesgos y plan B

1. **La base compartida sin migrar deja el proyecto `db` rojo en todos los
   worktrees.** Es lo esperado y está fichado
   (`.agent/playbook/code-ahead-of-shared-db-migration-rompe-db-tests.md`). Plan
   B: no hay: se documenta en `impl.md` con el código de salida real y se espera
   a que el humano aplique (`AP1`). Forzarlo a verde es lo único prohibido.
2. **El `diff` de C11(b) puede salir rojo por culpa de `next dev`, no del
   feature.** Mitigado con el control de AD7(3): dos `curl` seguidos de la misma
   página antes de tocar nada. Si el control ya difiere, la comparación se
   normaliza igual en las dos mitades y el guion lo dice.
3. **El par `--repeat` del guion de humo no es idempotente.** Mitigado con el
   `DELETE FROM "SyncEvent"` de AD7(2). Si el humano prefiere no borrar filas
   desde un guion, el plan B es aceptar que ese aserto solo vale en la primera
   corrida y decirlo en la salida — peor, y por eso no es el elegido.
4. **`SP1` sin responder.** Se diseña sobre R13 (no invalidar). **Si el humano
   elige invalidar ya**: `handleBusiness` gana un cuarto parámetro
   `renderableBranches: RenderableBranchLookup` (la firma de `handleCurrency`),
   devuelve `outcomeOf(await renderableBranches(businessId))` en vez de
   `PROCESSED`, `applyEvent` le pasa el memo del lote, el coste del camino
   `processed` sube de 1 a 2 round-trips **solo en el primer `BUSINESS` de cada
   negocio del lote** (el memo hace gratis el resto), y
   `src/features/sync/server/processBatch.invalidationCount.test.ts` gana un
   caso. Nada más se mueve.
5. **`SP2` sin responder.** Se diseña sobre R2 (`z.array(z.string())`). **Si el
   humano elige `z.array(z.unknown())`**: cambia **una línea** de
   `businessPayloadSchema`, `findInvalidDisplayCurrency` pasa a recibir
   `readonly unknown[]` y su primera comprobación es `typeof x !== "string"`, y
   una fila de § Casos límite de la spec se mueve de `400` a `207 failed[]`. El
   orden de R5, la dedup y la guarda **no se tocan**, porque la dedup ya corre
   sobre una lista validada.
6. **Alguien lee el `updateMany` como una tercera forma de guarda** y la copia
   en una entidad que sí necesita leer la fila. Mitigado con el comentario que
   § Patrones exige y con la línea de `AGENTS.md` de I8, que mete `BUSINESS` en
   la familia correcta.
7. **`docs/despliegue.md` § 8.3 se queda diciendo que el aviso está pendiente.**
   Riesgo real: el otro equipo lee § 8.3 para saber cuándo emitir. Mitigado
   listándolo como paso (§ Modelo de datos, último apartado).

## ¿Hace falta una ADR?

**No.** La decisión estructural que este feature podría haber abierto —cuál de
las dos formas de la guarda usa una entidad nueva— ya está tomada y escrita:
`docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md` explica por qué
`EXCHANGE_RATE` decide al leer, y R6 explica por qué `displayCurrencies` **no**
es ese caso (una columna de una fila, sin histórico entre el que elegir). Este
diseño **obedece** esa ADR, no la contradice. El `updateMany` condicional de AD3
no es una decisión estructural nueva: es la misma semántica de guarda que ya
existe, en una sentencia en vez de dos, con el patrón de round-trip único que
`src/features/orders/server/bell.ts` ya usa y que `AGENTS.md` ya impone por el
pooler.

## Preguntas al humano

**AP1 — ¿cuándo se aplica la migración de F-038 a la base compartida de
`docker-compose.yml`, y quién avisa?**
Qué falta: el acto de aplicar. Por qué importa: la comparten todos los
worktrees; mientras no se aplique, **todos** los `*.db.test.ts` del repo fallan
con `does not exist in the current database` —no solo los de este feature— y el
criterio 14 (`--full` en 0) no puede darse por bueno, porque `npm test` incluye
el proyecto `db`. Por qué no bloquea el diseño: nada de lo escrito aquí cambia
según la respuesta. Opciones: (a) el humano aplica `npx prisma migrate deploy`
una sola vez, anunciado, **después** de que el implementador genere y valide la
migración en una base de usar y tirar y **antes** de que el `sdd-tester` corra
la suite; (b) el implementador la aplica en su ciclo. **Recomendación: (a)**,
que es lo que la ficha `code-ahead-of-shared-db-migration-rompe-db-tests`
concluyó tras F-036 y lo que este encargo ya ordena.

**AP2 — `docs/despliegue.md` § 8.3 tiene un párrafo que deja de ser cierto al
cerrar F-038, y el criterio 13 no lo menciona. ¿Entra en este ciclo?**
Qué falta: decidir si se edita ahora o se deja para F-039. Por qué importa: ese
párrafo es la **parte operativa** del aviso a cuadrecaja («no emitir `BUSINESS`
hasta el aviso… el aviso se manda cuando el schema del sobre lo acepte»), y es
el sitio que se consulta al desplegar. Si no se toca, el documento de despliegue
seguirá diciendo que el aviso está pendiente después de haberse mandado — el
mismo error que ese mismo párrafo cuenta que ya se cometió con la v6 («ese aviso
se quedó puesto tres versiones después de dejar de ser cierto»). Por qué no
bloquea: es una línea de documentación, no cambia código. Opciones: (a) se edita
en el mismo ciclo, junto con la v12.2 y la línea de `.agent/solicitudes.md`, y
el plan lo lista como cuarto sitio de I9; (b) se deja anotado para después.
**Recomendación: (a)**, y AGENTS.md § Documentación lo exige de todos modos
(«paso operativo nuevo → una línea en `docs/despliegue.md`, en el mismo ciclo
que lo introduce»).

**AP3 — ¿el guion de humo puede borrar filas de `SyncEvent` de la base
compartida?**
Qué falta: permiso para el `DELETE FROM "SyncEvent" WHERE "eventId" IN (…)` de
AD7(2), acotado a los dos ids fijos que `--repeat` genera. Por qué importa: sin
él, el aserto «processed y luego duplicate» de C12 solo es cierto la primera vez
que el guion corre contra una base dada, y a partir de la segunda el guion sale
rojo sin que nada esté roto — un sensor que miente es peor que no tenerlo. Por
qué no bloquea: si la respuesta es no, el guion sigue existiendo y ese aserto se
degrada. Opciones: (a) sí, acotado a esos ids y solo dentro de
`.agent/specs/F-038/smoke.sh` —**recomendación**, es la misma clase de limpieza
que los guiones de F-035 y F-036 ya hacen con sus monedas—; (b) no, y el guion
acepta `processed` o `duplicate` en la primera de las dos llamadas, imprimiendo
por qué.
