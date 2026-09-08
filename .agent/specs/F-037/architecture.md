---
feature: F-037
agente: sdd-architect
actualizado: 2026-09-07T17:39:05Z
estado: listo
---

> Diseño sobre `.agent/specs/F-037/spec.md` en `estado: listo` (20 reglas
> R1-R20, 18 escenarios E1-E18, tres preguntas `SP1`-`SP3` **no bloqueantes**
> con su defecto ya escrito como regla). No reabro nada de eso: aquí se decide
> **cómo** se construye, que es exactamente lo que la spec dejó en § «No
> decidido a propósito» —dónde vive el estado del arrastre, cómo se expresa el
> desvío, el reparto de las pruebas y si el `console.warn` existe— más las dos
> cosas que el orquestador añadió: cómo se extrae la clave sin `any` ni `switch`
> sin vigilar, y cómo R12 sale de la forma del código.
>
> `design.md` queda en `estado: no aplica`: backend puro, cero JavaScript de
> cliente, cero pantallas.
>
> **El contrato no se toca** (criterio 9, R16): `docs/sync-contract.md` v12.1 ya
> publica la regla ③ y la fila `DEPENDENCY_FAILED_IN_BATCH`. Nada de este diseño
> pide moverlo, y § Contratos explica por qué lo escrito es implementable tal
> cual.
>
> Dos comprobaciones hechas aquí, no heredadas:
>
> 1. **La palanca del `\u0000` funciona y la adopto.** Reproducida contra el
>    `queandabuscando-postgres` local (puerto 5433) con el driver `pg` del
>    adapter, en una `TEMP TABLE` que muere con la sesión: el `INSERT` de
>    `"Bebidas\u0000"` en una columna `text` responde
>    `code: 22021 | invalid byte sequence for encoding "UTF8": 0x00`. La base
>    compartida no se tocó. Ver § AD6.
> 2. **La lista de códigos de moneda quemados que da la spec está incompleta.**
>    `exchangeRateAllDraft.db.test.ts` ya usa `"ABC"` y no lo borra al terminar.
>    El código de la prueba de C4 se elige fuera de esa lista y **se borra**.

## Estado actual relevante

| Pieza                                                               | Qué aporta, y qué se reutiliza tal cual                                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sync/server/processBatch.ts`                          | El bucle secuencial (línea 69), el `catch` que ya construye `failed[]` y `results[]` (líneas 91-95) y `applyEvent` (línea 128). Único archivo de producto que cambia de comportamiento |
| `src/features/sync/server/handlers/types.ts`                        | `SyncEventFailure` (línea 71), la clase que F-032 creó para un fallo **por evento** cuyo mensaje es vocabulario del POS. Se reutiliza sin tocarla                                      |
| `src/features/sync/server/businessBranches.ts`                      | `createRenderableBranchLookup` (F-035): el molde de «estado creado UNA vez por lote, que muere con la invocación». El tracker de este feature es su gemelo sin consultas               |
| `src/features/sync/schemas.ts`                                      | `SyncEventInput`, unión discriminada por `entity` (línea 136), y `EventStatus` (línea 199). **Solo se importan tipos**; el archivo no cambia (R15)                                     |
| `src/features/sync/identity.ts`                                     | El precedente de capa: lógica pura de dominio del sync, con `import type` de `./schemas`, fuera de `server/` y sin Prisma. El módulo nuevo se coloca a su lado                         |
| `src/constants/sync.ts`                                             | `STORE_DELIVERY_CONFIG_INCONSISTENT` (línea 23) y `STORE_TIMEZONE_INVALID` (línea 43): la forma exacta que copia la constante nueva                                                    |
| `src/features/sync/server/inbox.ts`                                 | `recordBatch` (el orden de aplicación, línea 64) y `markFailed` (línea 85). **No cambian** (R17); son precondición                                                                     |
| `src/features/sync/server/handlers/misc.ts`                         | `handleCategory` (línea 109), `handleCurrency` (línea 173), `handleExchangeRate` (línea 205). No cambian: cambia **quién llega** a ellos                                               |
| `src/features/sync/server/handlers/product.ts`                      | `resolveLocalCategory` (línea 291) y su `null`. No cambia                                                                                                                              |
| `src/features/sync/server/processBatch.test.ts`                     | 12 casos con **todos** los handlers, `./inbox` y `@/lib/cache` mockeados. Es el archivo de la unidad del bucle, y que sus casos sigan intactos es la no-regresión de R18               |
| `src/features/sync/server/processBatch.invalidationCount.test.ts`   | Cuenta `revalidateTag` de verdad (F-035, 2 × N). **No se toca**: un arrastrado no aporta nada, así que la cuenta no cambia                                                             |
| `src/features/sync/server/handlers/storePublishGate.db.test.ts`     | El molde del db-test que entra por el `POST` de verdad: `Bearer session.syncToken`, `207`, `body.failed`, `prisma.syncEvent.findUnique` y la limpieza de `SyncEvent` en el `afterAll`  |
| `src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts` | El mock de `next/cache` que hace falta para llamar al `POST` desde Vitest, y el precedente de que su código de moneda (`"ABC"`) quedó sin borrar                                       |
| `src/features/marketplace/server/dbFixtures.ts`                     | `createFixtureSession`: `syncToken`, `businessExternalId`, `createStore`, `createLocalCategory`, `trackCanonical` y `cleanup`. La fixture de C1-C8 no necesita nada nuevo              |
| `src/features/catalog/server/rates.db.test.ts`                      | El precedente de «la tabla `Currency` es global: usa un código propio y **bórralo** en el `afterAll`» (línea 106)                                                                      |

Nada nuevo en `src/app/`, `src/components/`, `src/lib/`, `prisma/`. Cero
endpoints, cero esquemas Zod, cero tags de caché, cero migraciones, cero
JavaScript de cliente, cero pasos operativos nuevos (`docs/despliegue.md` ya
documenta la v11 y su `DEPENDENCY_FAILED_IN_BATCH` en su § de versiones).

## Decisión

Un **módulo puro nuevo** guarda las claves que fallaron en este lote y contesta,
por evento, si algo lo bloquea; `processBatch.ts` lo crea una vez por invocación
y, cuando la respuesta no es `null`, **lanza `SyncEventFailure` antes de
`applyEvent`** para que el `catch` de siempre construya el fallo. Seis
decisiones, en orden de dependencia.

### AD1 — el estado vive en src/features/sync/dependencies.ts (por crear), es un `Set` de claves compuestas y se crea por lote

**Decisión.** Un módulo sin Prisma, sin React y sin importaciones de valor —solo
`import type` de `./schemas`—, con una fábrica y dos métodos:

```ts
export function createBatchDependencies(): BatchDependencies;

export type BatchDependencies = {
  /** La clave que impide aplicar este evento, o `null`. O(1). */
  blockedBy(event: SyncEventInput): DependencyKey | null;
  /** Cómo terminó un evento que SÍ se ejecutó. O(1). */
  note(event: SyncEventInput, status: EventStatus): void;
};
```

Dentro, un único `Set<DependencyKey>` con la clave **compuesta**
`` `${entity}:${valor}` ``, y `note` como la máquina de estados completa, en un
solo sitio legible:

| `status` que se le pasa                   | Qué hace con la clave que el evento **aporta** | Por qué                                                                     |
| ----------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `"failed"`                                | `add`                                          | R2: solo arrastra lo que acaba en `failed[]`                                |
| `"processed"` · `"stale"`                 | `delete`                                       | R13/E17: la fila **existe** en el momento de aplicar lo que venga detrás    |
| `"skipped_not_published"` · `"duplicate"` | nada                                           | Ni prueba que la fila exista ni prueba que falte: no añade y tampoco limpia |

**Por qué un `Set` de claves compuestas y no dos `Set` sueltos.** E16 exige que
`CATEGORY:USD` y `CURRENCY:USD` no colisionen. Con la clave compuesta eso es
cierto **por construcción y por tipo**: `DependencyKey` es
`` `${DependencySource}:${string}` `` —un template literal type—, así que una
cadena cruda no se puede meter en el `Set` sin pasar por el constructor de
claves, y los dos prefijos posibles (`CATEGORY`, `CURRENCY`) no son prefijo uno
del otro, luego la codificación es inyectiva sea cual sea el valor (aunque lleve
`:`, espacios o mayúsculas — R4/E11: la comparación es la del `Set`, byte a byte,
sin `trim` ni `toUpperCase` en ningún punto). Dos `Set` separados también
resolverían E16, pero obligan a un `switch` extra en cada método para elegir
cuál.

**Por qué `src/features/sync/` y no `src/lib/` ni `server/`.** `src/lib/` es
«lógica pura y reutilizable» y esto **no** es reutilizable: conoce `entity`,
`payload.categoryId` y `payload.currency`, que son vocabulario del contrato de
sync. `server/` es donde vive lo que toca Prisma y este módulo no consulta nada
(R7, y es la mitad de la garantía de «cero round-trips nuevos»: si no importa
`@/lib/prisma`, no puede consultar). Queda `src/features/sync/`, la capa «lógica
de un dominio», donde ya está `src/features/sync/identity.ts` con la misma forma
exacta: puro, `import type` de `./schemas`, llamado desde una capa de arriba.

**Por qué un módulo y no dos `Set` locales del bucle.** Tres razones concretas:
el `switch` exhaustivo de AD3 necesita un sitio donde el compilador lo vigile y
donde una entidad nueva rompa **una** compilación con un mensaje que la nombre;
R13 (limpiar) y E11 (exactitud) se prueban en microsegundos sin mockear cinco
handlers ni `recordBatch`; y SP2/SP3, si el humano cambia de opinión, se
convierten en **una línea identificable** (ver § Impacto de SP1-SP3) en vez de en
una edición del bucle. El coste es un archivo más: aceptado.

**Escalabilidad, que es lo que corta la discusión.** `blockedBy` y `note` son
`Set.has`/`add`/`delete` sobre una clave que se construye leyendo **un** campo
del payload: O(1) por evento, O(n) por lote. **Nunca** se recorre el array de
eventos, ni al apuntar ni al consultar — el antipatrón a evitar es exactamente
«para cada evento, mirar los anteriores», que en el lote máximo de 500 eventos
(`MAX_CATALOG_EVENTS`, `src/features/sync/schemas.ts:17`) serían 124 750
comparaciones para no encontrar nada el 99 % de las veces. Números en
§ Escalabilidad.

### AD2 — el desvío se expresa lanzando `SyncEventFailure`, dentro del `try`, antes de `applyEvent`

**Decisión.** El bucle queda así (el diff es de nueve líneas):

```ts
const dependencies = createBatchDependencies();

for (const event of fresh) {
  try {
    const blocker = dependencies.blockedBy(event);
    if (blocker) {
      console.warn("[sync] event blocked by a failed dependency in the same batch:", {
        eventId: event.eventId,
        entity: event.entity,
        dependency: blocker,
      });
      throw new SyncEventFailure(DEPENDENCY_FAILED_IN_BATCH);
    }

    const outcome = await applyEvent(event, caller.businessId, renderableBranches);
    dependencies.note(event, outcome.status);
    // …las seis líneas de invalidación y los `push`, sin tocar…
  } catch (error) {
    dependencies.note(event, "failed");
    // …el `catch` de hoy, sin tocar…
  }
}
```

**Por qué lanzar y no empujar a `failed[]`/`results[]`.** Tres razones, en orden
de peso:

1. **Un solo sitio construye un resultado fallido en este archivo.** R10 pide el
   mismo estado en tres sitios (`results[].status`, `failed[]`, y la fila de
   `SyncEvent` vía `markFailed`). El `catch` ya los produce los tres; empujar a
   mano duplicaría su cuerpo y dejaría dos copias que se pueden desincronizar
   —el truncado a 500 de `markFailed`, un log futuro, un campo nuevo—. Es el
   mismo fallo que `scripts/check-harness.mjs` existe para pescar en la prosa,
   pero en el código.
2. **El control no puede caer dentro de `applyEvent`.** R8 no depende de que
   alguien se acuerde de poner `continue` después del `push`: un `throw` no
   sigue. Es la diferencia entre una guarda y un comentario.
3. **La clase ya significa esto.** `SyncEventFailure` es, literalmente, «un fallo
   **por evento**, cuyo `message` es la cadena del vocabulario de errores» — es
   lo que hacen hoy `STORE_TIMEZONE_INVALID` y
   `STORE_DELIVERY_CONFIG_INCONSISTENT`. Inventar un segundo mecanismo para el
   tercer miembro del mismo vocabulario, en el mismo archivo, es la regresión que
   el método llama «un componente nuevo que duplica uno existente».

**Y el comentario de `SyncEventFailure`
(`src/features/sync/server/handlers/types.ts:61-70`): su argumento NO aplica
aquí, y hay que decirlo.** Ese comentario explica por qué un fallo por evento se
**lanza** en vez de añadirse como miembro de `HandlerOutcome["status"]`: porque
un `"failed"` en esa unión caería en el `else` del bucle (`skipped.push(...)`)
**sin error de compilación**, y el evento se reportaría en `ok` — justo la ficha
«un evento fallido NO es un duplicado». Ese razonamiento es sobre el **canal de
vuelta de un handler**: un handler solo puede hablar por su `return` o por una
excepción, y el `return` lo consume un `if/else` que el compilador no vigila.
Aquí el que decide es `processBatch.ts`, que **es el dueño** de `failed[]` y de
`results[]`: no necesita canal para hablar consigo mismo, así que ese argumento
no obliga a nada en esta decisión. Lo que sí sigue vigente es su conclusión
práctica —el `catch` ya convierte `error.message` en las tres cosas, cero líneas
nuevas—, y esa es la que se aprovecha.

**El coste, dicho con número.** Una excepción por evento arrastrado, con captura
de pila: del orden de 1-3 µs cada una. En el peor lote imaginable (499
arrastrados) es ~1 ms, contra los cientos de milisegundos de I/O que ese mismo
lote ya paga. No es un argumento contra lanzar.

### AD3 — la clave se extrae con **un** `switch` sobre `entity`, con guarda `never`, y una entidad nueva no compila

**Decisión.** Una sola función pura, con una sola tabla, que devuelve **los dos
papeles** del evento:

```ts
/** Las dos entidades cuyo fallo bloquea a otras (R3). */
export type DependencySource = Extract<SyncEventInput["entity"], "CATEGORY" | "CURRENCY">;

/** El par de entidades es PARTE de la clave (E16). */
export type DependencyKey = `${DependencySource}:${string}`;

export type DependencyRole = {
  /** Clave que este evento posee: si falla, bloquea a los que la requieren. */
  provides: DependencyKey | null;
  /** Clave que este evento necesita ya aplicada. */
  requires: DependencyKey | null;
};

export function dependencyRoleOf(event: SyncEventInput): DependencyRole;
```

La tabla, que es la de R3 y la del contrato, y ningún otro par:

| `entity`        | `provides`                           | `requires`                                                         |
| --------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `CATEGORY`      | `CATEGORY:` con `payload.categoryId` | `null`                                                             |
| `CURRENCY`      | `CURRENCY:` con `payload.code`       | `null`                                                             |
| `PRODUCT`       | `null`                               | `CATEGORY:` con `payload.localCategoryId`; `null` si es falsy (R5) |
| `EXCHANGE_RATE` | `null`                               | `CURRENCY:` con `payload.currency`                                 |
| `STORE`         | `null`                               | `null`                                                             |

**Una sola función y no dos** (una para el origen y otra para el dependiente):
dos funciones son dos `switch` que actualizar y uno que olvidar. R11 («no hay
cadena») se lee de un vistazo en esta tabla: **ninguna fila tiene las dos
columnas llenas**.

**Qué falla en compilación si mañana F-038 añade `BUSINESS`.** El `switch` cierra
con la guarda que `applyEvent` no tiene:

```ts
default: {
  const exhaustive: never = event;
  throw new Error(`dependencyRoleOf: unhandled entity ${JSON.stringify(exhaustive)}`);
}
```

y `npm run typecheck` responde, en **esa** línea:
`Type '{ eventId: string; entity: "BUSINESS"; … }' is not assignable to type 'never'`
— nombra la entidad olvidada. Sin la guarda el compilador también protestaría,
porque el tipo de retorno está anotado (`TS2366: Function lacks ending return
statement and return type does not include 'undefined'`), pero con un mensaje que
no dice **cuál** entidad falta; por eso se pone la guarda además de la anotación.
Y `strict: true` (`tsconfig.json`) hace que las dos protecciones estén activas de
verdad.

**Por qué no se apoya en el `switch` de `applyEvent`.** Ese no tiene `default`:
si se añade una entidad sin caso, su tipo de retorno inferido pasa a incluir
`undefined` y el error aparece **en otra línea** (`outcome.touchedStoreSlug`,
«possibly undefined»), con un mensaje que no menciona la entidad. Sirve de red,
no de guarda, y endurecerlo no es de este feature (§ Riesgos, 5).

**Nada de `any` en ningún punto** (AGENTS.md § Prohibiciones): dentro de cada
`case`, `event` ya está estrechado por la unión discriminada, así que
`event.payload.categoryId` es `string` sin aserción, sin `as` y sin index
signature. El único literal nuevo es el separador `":"`, encapsulado en el
constructor de claves del módulo; los prefijos **no** son cadenas inventadas:
salen del `entity` del propio evento, y `DependencySource` se deriva con
`Extract<…>` de `SyncEventInput`, de modo que renombrar `CATEGORY` en
`schemas.ts` rompería también aquí.

### AD4 — la constante, y nada más que la constante

**Decisión.** En `src/constants/sync.ts`, con la forma y el tipo de comentario de
sus vecinas:

```ts
/**
 * F-037 (R9, R20): un evento correcto que NO se aplica porque otro anterior
 * del MISMO lote, del que dependía, falló (`CATEGORY` → sus `PRODUCT`,
 * `CURRENCY` → sus `EXCHANGE_RATE`). Viaja tal cual, sin adornos, en
 * `failed[].error` del `207` y en `SyncEvent.error` — el POS compara la
 * cadena del § Vocabulario de errores de `docs/sync-contract.md`.
 */
export const DEPENDENCY_FAILED_IN_BATCH = "DEPENDENCY_FAILED_IN_BATCH";
```

**Comprobado si hace falta exportar algo más: no.** No existe en el repo ninguna
unión de códigos de error del sync ni ningún `Record` que los enumere
—`STORE_TIMEZONE_INVALID`, `STORE_OPENING_HOURS_INVALID` y
`STORE_DELIVERY_CONFIG_INCONSISTENT` son tres `const` sueltas, sin tipo común, y
`EventResult["error"]` es un `string` opcional
(`src/features/sync/schemas.ts:209-213`)—, así que **la cadena basta**; crear la
unión ahora sería un refactor de tres archivos que este feature no necesita. Los
tipos nuevos (`DependencyKey`, `DependencySource`, `DependencyRole`,
`BatchDependencies`) se exportan desde el módulo de AD1, que es su dominio, no
desde `src/constants/sync.ts`.

La prueba que afirma la cadena **importa la constante**, nunca la reescribe (R9,
como `src/features/sync/server/handlers/storePublishGate.db.test.ts:8`).

### AD5 — que un arrastrado no invalide nada sale de la forma del código, no de la disciplina

**Decisión.** No se añade ninguna comprobación: se aprovecha el alcance léxico
que el bucle ya tiene.

Las cinco acumulaciones de invalidación (`touchedStores`, `touchedBrands`,
`touchedProducts`, `touchedSlugValues`, `purgePrefixes`;
`src/features/sync/server/processBatch.ts:73-85`) leen **exclusivamente** de
`outcome`, y `outcome` es un `const` declarado **dentro del `try`, después del
`await`**. Un evento arrastrado lanza antes de esa declaración, así que:

- en el `catch` la variable `outcome` **no existe** —no está en el alcance—, de
  modo que un futuro editor no puede añadir «solo esta línea» sin que
  `npm run typecheck` se lo diga (`Cannot find name 'outcome'`);
- no hay ninguna rama en la que un evento tenga a la vez `status: "failed"` y un
  `outcome` del que copiar slugs.

Es decir: R12 no es una regla que respetar, es el único código que compila. Y el
número de llamadas tampoco cambia (E14): las cuatro `revalidate*` están **fuera**
del bucle y se disparan siempre, aunque los conjuntos vayan vacíos, y
`removeStoreObjectsUnder` solo se llama por cada prefijo de `purgePrefixes`, que
un arrastrado no puede llenar. El presupuesto de F-035 (2 × N por lote) se
conserva sin tocar
`src/features/sync/server/processBatch.invalidationCount.test.ts`.

El `console.warn` de la guarda **sí** existe (la spec lo dejaba abierto, § No
decidido 4): sin él, un `DEPENDENCY_FAILED_IN_BATCH` en el POS es inatribuible
—R20 prohíbe meter la clave en la cadena de error, así que el único sitio donde
esa clave puede verse es nuestro log—. Va con prefijo `[sync]` **al principio**
de la línea y con `console.warn`, nunca `console.error`, que dispara el guardián
de servidor de `smoke`/`visual`/`probe` (AGENTS.md § Cosas que muerden; ficha
`.agent/playbook/console-error-dispara-guardian-servidor.md`). Volumen máximo:
una línea por evento arrastrado, hasta 499 por lote, y solo en un lote en el que
**ya** había un fallo.

### AD6 — el reparto de las pruebas, y la palanca del `\u0000`

**Decisión.** Tres archivos, y ninguno duplica lo que prueba otro.

| Archivo                                                           | Con qué                                                                             | Qué prueba, y por qué ahí                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| src/features/sync/dependencies.test.ts (por crear)                | Nada mockeado: el módulo es puro                                                    | El álgebra de claves: E11 (`"usd"` distinto de `"USD"`; `" cat-1"` distinto de `"cat-1"`), E16 (`CATEGORY:USD` distinto de `CURRENCY:USD`), E12/R5 (`null`, ausente, `""`), R11 (ninguna fila con los dos papeles) y R13 (`note` limpia con `processed` y con `stale`, y **no** con `skipped_not_published`) |
| `src/features/sync/server/processBatch.test.ts` (se extiende)     | Los cinco handlers, `./inbox` y `@/lib/cache` mockeados, como ya hacen sus 12 casos | El bucle: R8 (`handleProduct` **no se llamó**), el arrastre hacia adelante sobre el `fresh` que devuelve el `recordBatch` mockeado (E6, mitad de unidad), E7, E9, E10, E13, E15, E17, y E14 comparando los argumentos de las cuatro `revalidate*` con los del mismo lote **sin** el evento arrastrado        |
| src/features/sync/server/dependencyCascade.db.test.ts (por crear) | Postgres real, por el `POST` de verdad; solo `next/cache` mockeado                  | Lo que solo la base demuestra: C1-C8. Qué filas **no** quedan, el `FAILED` del inbox y el reenvío que responde `processed`                                                                                                                                                                                   |

El db-test va **al lado de `processBatch.ts`** —no en `handlers/`— porque su
sujeto es el bucle, igual que `src/features/sync/server/tenantScoping.db.test.ts`
y `src/features/sync/server/reconciliation.db.test.ts` viven ahí. Es el archivo
15 del proyecto `db`, que corre **en serie** (`fileParallelism: false`,
`vitest.config.mts`): no añade conexiones concurrentes, sí unos segundos de
reloj.

**La mitad de E6 que la unidad NO puede probar.** En
`src/features/sync/server/processBatch.test.ts`, `recordBatch` está mockeado, así
que el test fija `fresh` a mano y solo demuestra que el bucle arrastra **hacia
adelante en el orden que recibe**. Que ese orden lo decida `occurredAt` y no la
posición en el array es de C6 y solo se ve en el db-test, con la categoría
**primero** en el array del `POST` y el `occurredAt` menor en el producto: si
alguien quitara el `sort` de `inbox.ts:64`, ese test se pondría rojo y el de
unidad no.

**La palanca para hacer fallar una dependencia sin mocks: adopto el `\u0000` en
`payload.name`.** Reproducido aquí, no heredado (ver el encabezado): un `text` de
Postgres responde `22021 invalid byte sequence for encoding "UTF8": 0x00`. La
cadena sobrevive a `JSON.stringify` → cuerpo HTTP → `request.json()` y pasa
`z.string().min(1)` (`src/features/sync/schemas.ts:80`, `:114`), que es la
condición para llegar al handler. Y el error se propaga: `createCategory` solo
reintenta si `isUniqueViolation(error, "slug")`
(`src/features/sync/server/handlers/misc.ts:98`), que es falso para un 22021, así
que **lo relanza**.

**Por qué esa y no la alternativa de la spec.** Saturar los 999 candidatos de
`uniqueSlug` (`src/lib/slug.ts:107`) es determinista, pero (a) cuesta ~1000
consultas por caso, contra 0 consultas extra de la palanca del byte nulo, y (b)
**solo sirve para `CATEGORY`**: `handleCurrency` no genera slug, hace un `upsert`
directo (`src/features/sync/server/handlers/misc.ts:178`), así que C4 se quedaría
sin forma de fallar sin mocks — y con mocks deja de ser un db-test. Un `name` con
un byte nulo sirve para las **dos** entidades origen con el mismo truco, y es el
único campo de texto libre que las dos comparten.

**Reglas para el andamio de `sdd-tester`, sacadas de los archivos que ya
existen.** El evento **origen** se afirma solo por su presencia en `failed[]`,
nunca por el texto de su `error` (es un mensaje del driver, no vocabulario
nuestro, y cambiaría con una versión de `pg`). `next/cache` se mockea o el `POST`
revienta con `Invariant: static generation store missing` (ficha
`.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`). Las
filas de `SyncEvent` se borran en el `afterAll`
(`deleteMany({ where: { businessId: session.businessExternalId } })`), como los
dos db-tests de sync que ya entran por el `POST`. El `CanonicalProduct` que
`handleProduct` crea por la vía del EAN se registra con `session.trackCanonical`
o `cleanup()` lo deja atrás
(`src/features/sync/server/handlers/product.db.test.ts`). Y el código de moneda
de C4 es **propio y se borra**: fuera de `CUP`, `USD`, `MLC`, `EUR`, `ABC`,
`XYZ`, `AAA`, `BBB`, `CCC`, `DDD`, `WVX`, `QAB` y `ZZZ` —`"FQV"` está libre,
comprobado por grep— y con su `prisma.currency.deleteMany` en el `afterAll`, como
`src/features/catalog/server/rates.db.test.ts:106`, porque `Currency` no tiene
`businessId` y `cleanup()` no la alcanza (I3).

## Componentes

| Componente                                      | Capa                        | Responsabilidad                                                                                      | Archivo                                                           |
| ----------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `dependencyRoleOf`                              | `src/features/sync/`        | Traduce un evento a `{ provides, requires }` con el `switch` exhaustivo de AD3. Pura, sin estado     | src/features/sync/dependencies.ts (por crear)                     |
| `createBatchDependencies` / `BatchDependencies` | `src/features/sync/`        | El `Set` de claves fallidas de UN lote: `blockedBy` y `note`. Nace y muere con la invocación (R7)    | src/features/sync/dependencies.ts (por crear)                     |
| `DEPENDENCY_FAILED_IN_BATCH`                    | `src/constants/`            | La única fuente de la cadena que ven el POS y el inbox (R9, R20)                                     | `src/constants/sync.ts`                                           |
| La guarda del bucle                             | `src/features/sync/server/` | Consulta `blockedBy`, avisa con `console.warn` y lanza `SyncEventFailure` antes de `applyEvent` (R8) | `src/features/sync/server/processBatch.ts`                        |
| Los dos `note` del bucle                        | `src/features/sync/server/` | Alimentan el `Set`: `outcome.status` en el camino feliz, `"failed"` en el `catch` (R2, R13)          | `src/features/sync/server/processBatch.ts`                        |
| Unidad del álgebra de claves                    | prueba                      | E11, E12, E13, E16, R5, R11, R13 sin mockear nada                                                    | src/features/sync/dependencies.test.ts (por crear)                |
| Unidad del bucle                                | prueba                      | R8, E6 (mitad), E7, E9, E10, E13, E14, E15, E17, E18                                                 | `src/features/sync/server/processBatch.test.ts`                   |
| Escenarios contra Postgres real                 | prueba                      | C1-C8 por el `POST` de verdad                                                                        | src/features/sync/server/dependencyCascade.db.test.ts (por crear) |

`SyncEventFailure` (`src/features/sync/server/handlers/types.ts`) se **reutiliza
sin modificarla**; `src/features/sync/server/inbox.ts`,
`src/features/sync/schemas.ts` y los tres handlers no cambian.

## Flujo de datos

Un lote, de arriba abajo. Lo nuevo va marcado con «▸».

1. `POST /api/internal/sync/catalog` → `withInternalAuth` resuelve el `caller`;
   Zod valida; `findCatalogMismatch` aborta con `403` si el `businessId` no es
   del llamante (`src/app/api/internal/sync/catalog/route.ts:39`). El lote es de
   **un** negocio, así que el arrastre nunca cruza negocios.
2. `recordBatch` graba lo no grabado, aparta los duplicados **liquidados** y
   devuelve `fresh` ordenado por `occurredAt`
   (`src/features/sync/server/inbox.ts:64`). Ese orden es la definición de
   «posterior» (R1). No se toca (R17).
3. ▸ `const dependencies = createBatchDependencies()` — un `Set` vacío, junto al
   `createRenderableBranchLookup` de F-035, con la misma vida.
4. Por cada evento de `fresh`, dentro del `try`:
   1. ▸ `dependencies.blockedBy(event)`: `dependencyRoleOf(event).requires` y, si
      no es `null`, un `set.has(...)`. Dos operaciones de hash.
   2. ▸ si devuelve una clave: `console.warn("[sync] …")` y
      `throw new SyncEventFailure(DEPENDENCY_FAILED_IN_BATCH)`. **El handler no
      se llama** (R8): `applyEvent` está en la línea siguiente.
   3. si no: `applyEvent` como hoy y ▸ `dependencies.note(event, outcome.status)`
      inmediatamente después del `await` — la llamada que limpia la clave de una
      categoría reparada dentro del lote (R13/E17).
   4. Las seis acumulaciones de invalidación y los `push` de siempre.
5. En el `catch`, para cualquier fallo —del handler o de la guarda—: ▸
   `dependencies.note(event, "failed")`, y después las dos líneas de hoy, que
   ponen la cadena en `failed[]` y en `results[]`.
6. Fuera del bucle, sin cambios: `markProcessed`/`markSkipped`/`markFailed`, las
   cuatro `revalidate*`, el drenaje de `purgePrefixes` y `summarize`.

Una consecuencia que conviene dejar escrita: como en el `catch` cae **también**
el arrastrado, `note(event, "failed")` se ejecuta para él. Hoy eso es un no-op
—ningún evento tiene `provides` y `requires` a la vez (R11, la tabla de AD3)—, y
esa línea es exactamente el punto donde habría que decidir qué hacer si existiera
una cadena. Si F-038 añade un `BUSINESS` que a la vez dependa de algo y sea
dependencia de otra cosa, **esta es la línea a revisar**, y E13 es el test que se
pondría rojo si se revisa mal.

## Contratos

**Tipos nuevos** (todos en src/features/sync/dependencies.ts (por crear);
ninguno viaja por el cable):

```ts
export type DependencySource = Extract<SyncEventInput["entity"], "CATEGORY" | "CURRENCY">;
export type DependencyKey = `${DependencySource}:${string}`;
export type DependencyRole = { provides: DependencyKey | null; requires: DependencyKey | null };
export type BatchDependencies = {
  blockedBy(event: SyncEventInput): DependencyKey | null;
  note(event: SyncEventInput, status: EventStatus): void;
};
export function dependencyRoleOf(event: SyncEventInput): DependencyRole;
export function createBatchDependencies(): BatchDependencies;
```

**Esquemas Zod:** ninguno nuevo, ninguno modificado (R15).
`src/features/sync/schemas.ts` cierra con `git diff` vacío.

**Endpoints:** ninguno nuevo. `POST /api/internal/sync/catalog` sigue
respondiendo `207` siempre que `processCatalogBatch` no lance
(`src/app/api/internal/sync/catalog/route.ts:45`), y este diseño no introduce
ningún camino que lance hacia arriba: todo lo que la guarda lanza cae en el
`catch` **del bucle**, no en el del route.

**Tabla de errores:**

| Código                       | Dónde aparece                                                                 | Significado                                                                                        | Quién lo produce            |
| ---------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------- |
| `DEPENDENCY_FAILED_IN_BATCH` | `207` en `failed[].error` y `results[].error`; `SyncEvent.error` con `FAILED` | El evento es correcto; falló otro **anterior del mismo lote** del que depende. Reintentar tal cual | La guarda del bucle (nuevo) |
| `BUSINESS_MISMATCH`          | `403`, cuerpo entero                                                          | Sin cambios                                                                                        | `route.ts:39`               |
| `BATCH_FAILED`               | `500`, cuerpo entero                                                          | Sin cambios: el único camino que aborta el lote entero sigue siendo el `catch` del route (R14)     | `route.ts:46`               |

**Qué del contrato publicado se comprueba implementable aquí** (criterio 9): la
tabla de dos dependencias es la de AD3; «solo hacia adelante y solo dentro del
lote» es el orden del bucle más la vida del `Set` (R1, R7); «reintentadlo tal
cual con su `updatedAt` original» se sostiene porque el arrastrado **nunca
escribió**, así que la guarda anti-rancia compara contra lo que hubiera antes —o
contra nada— y no responde `stale` (E2; es la forma que **rechaza**, una de las
dos que distingue `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`); y la
cadena viaja sin adornos (R20). **Nada que mover en `docs/sync-contract.md`.**

## Modelo de datos y migraciones

**Ninguna.** Cero tablas, cero columnas, cero índices, cero cambios en
`prisma/schema.prisma`. El estado del arrastre vive en memoria y muere con la
invocación (R7, § Fuera 2), que es justo lo que evita la tentación de una tabla
de «pendientes» que luego habría que limpiar. Ningún comando de los prohibidos
(`prisma migrate reset`, `prisma db push`) entra siquiera en la conversación.

## Escalabilidad y límites

Todo lo de aquí es por invocación de `processCatalogBatch`, con el lote máximo
que el esquema permite: **500 eventos** (`MAX_CATALOG_EVENTS`).

| Magnitud                                 | Antes                      | Después                                                    |
| ---------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Round-trips a Postgres por evento        | 1-6 según entidad          | **idénticos** (R7: cero consultas nuevas)                  |
| Operaciones nuevas en memoria por evento | 0                          | 1 `switch` y hasta 2 operaciones de hash                   |
| Operaciones nuevas por lote de 500       | 0                          | hasta 1500, decenas de µs                                  |
| Memoria nueva por lote                   | 0                          | hasta 500 claves de ~45 B: **≤ 45 KB**, liberados al salir |
| Llamadas de invalidación por lote        | 4 más `purgePrefixes.size` | **idénticas** (R12, E14)                                   |
| JavaScript de cliente                    | —                          | **0 bytes**: nada de esto llega al navegador               |

**Qué se rompe primero al multiplicar por 100.** Nada de este feature: el tamaño
del `Set` está acotado por `MAX_CATALOG_EVENTS`, que es una constante del cable,
no por el número de tiendas, de productos ni de negocios. Cien veces más lotes
cuestan cien veces lo mismo por lote y no comparten estado entre sí. Lo que sí
empeora, y ya empeoraba antes de F-037, es el propio bucle: es **secuencial**,
así que un lote de 500 `PRODUCT` son ~1500-3000 round-trips en serie; ese es el
techo real del endpoint y este feature no lo mueve ni un milisegundo (de hecho lo
baja algo cuando hay arrastre: un arrastrado ahorra sus 3-4 consultas).

**El antipatrón que este diseño excluye a propósito.** Decidir el arrastre
mirando el array de eventos —`fresh.slice(0, i).some(...)`, un `filter` por
evento o un `find` de «quién falló antes»— es O(n²): 124 750 comparaciones en el
lote máximo, para un caso que el 99 % de las veces no encuentra nada. El `Set`
convierte eso en 500 consultas de hash.

**El pooler.** Ninguna consulta nueva y ninguna transacción nueva, así que la
restricción de AGENTS.md § Cosas que muerden (el pooler de Supabase en modo
transacción) no entra en juego. Merece decirse que el diseño **reduce**
ligeramente la presión sobre el pool en el peor caso.

## Patrones a seguir / antipatrones a evitar

- **Un evento fallido NO es un duplicado** (AGENTS.md § Cosas que muerden). El
  arrastrado sale en `failed[]` y **nunca** en `ok`; `summarize`
  (`src/features/sync/schemas.ts:250`) lo garantiza porque solo mira
  `status !== "failed"`, y `markFailed` lo deja en `FAILED` para que
  `recordBatch` lo vuelva a coger (R10, E8, C8).
- **`console.warn` con prefijo `[sync]` al principio, nunca `console.error`**
  (AGENTS.md § Cosas que muerden; ficha
  `.agent/playbook/console-error-dispara-guardian-servidor.md`). La línea nueva
  **no** copia la forma de `processBatch.ts:121`, que es preexistente y contra la
  ficha (I5, AP2).
- **Sin `any` y sin magic strings** (AGENTS.md § Prohibiciones): la unión
  discriminada estrecha sola (AD3) y la cadena sale de `src/constants/sync.ts`
  (AD4).
- **Las dos propiedades del sync se mantienen**: nadie toca las guardas
  anti-rancias ni la idempotencia; lo que cambia es **quién llega** a los
  handlers, no lo que hacen. Las dos formas de la guarda —la que rechaza con
  `STALE` y la de orden de `EXCHANGE_RATE`— siguen intactas
  (`docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`).
- **Prisma solo en `features/*/server/`**: el módulo nuevo no lo importa, y esa
  ausencia es parte de la garantía de R7.
- **Antipatrón — consultar la base para decidir el arrastre.** «Miro si la
  categoría ya existía» son 500 consultas nuevas por lote y contradice R7: la
  letra del contrato empareja **por clave**, no por estado.
- **Antipatrón — meter la clave en el mensaje de error.** R20: el POS compara la
  cadena exacta. El detalle va al `console.warn`.
- **Antipatrón — `continue` después de empujar a mano a `failed[]`.** Ver AD2.

## Riesgos y plan B

1. **Un `SKIPPED` futuro en `handleCategory`/`handleCurrency`.** `note` solo
   limpia con `processed`/`stale`; con `skipped_not_published` no limpia. Es la
   opción **conservadora** (un `SKIPPED` no prueba que la fila exista), pero si
   algún día una `CATEGORY` puede responder `skipped`, habrá que releer R13. Está
   escrito en la tabla de AD1 y fijado por un caso de
   src/features/sync/dependencies.test.ts (por crear).
2. **La palanca del byte nulo deja de dar 22021.** Si una versión de `pg` o del
   adapter valida antes, el error cambia de forma **pero sigue lanzando**, que es
   lo único que la prueba necesita; por eso el andamio no afirma el texto del
   error del evento origen. Plan B: los 999 candidatos de `uniqueSlug` para C1-C3
   y, para C4, un `vi.mock` parcial de `./handlers/misc` que degrada ese caso a
   unidad.
3. **Los offsets de `occurredAt` (I1, SP1).** El orden lo fija un `localeCompare`
   de cadenas y `z.iso.datetime({ offset: true })` admite `+02:00`; con offsets
   mezclados, «posterior» deja de ser cronológico y una cascada podría no
   dispararse. Todos los ejemplos del contrato usan `Z`. Se documenta, no se
   arregla (R17). Plan B si algún día aparece: un feature propio, una línea en
   `src/features/sync/server/inbox.ts` y su no-regresión.
4. **`Currency` es global (I3).** El proyecto `db` corre en serie
   (`fileParallelism: false`), así que no hay carrera con otros archivos; el
   riesgo real es dejar basura, y se cubre con el código propio y el borrado en
   el `afterAll` (AD6).
5. **El `switch` de `applyEvent` sigue sin guarda `never`.** Endurecerlo son tres
   líneas en el archivo que este feature ya toca, pero está fuera del alcance de
   la spec; lo natural es que lo haga F-038 al añadir `BUSINESS`, que es quien lo
   va a necesitar.

## ¿Hace falta una ADR?

**No.** La decisión estructural —«un fallo arrastra dentro del lote, y con ello
el orden dentro de un lote pasa a decidir»— ya está tomada y publicada fuera del
código, en `docs/sync-contract.md` § «Cambios respecto a la v10.1» ③, que es
vinculante y que este feature obedece; y lo que decide **este** documento es
forma, no estructura: un módulo puro, un `Set`, una excepción que ya existía.
Ninguna ADR vigente lo contradice —la 0030 va de la guarda anti-rancia; la 0001 y
la 0002, del transporte y de quién inicia—. Lo que sí merece registro permanente
es la media verdad que la spec detecta en AGENTS.md (I4), y para eso una línea en
§ Cosas que muerden vale más y se lee más que una ADR: es AP1.

## Impacto de SP1-SP3 en este diseño

Diseñado sobre los **defectos** que la spec ya escribió como regla. Qué cambiaría
de aquí si el humano elige la otra opción, una línea cada una:

- **SP1** (el orden por cadenas de `inbox.ts:64`): **cero cambios** en este
  diseño —el tracker es agnóstico del orden y `fresh` es una entrada—; solo se
  añadiría un paso de plan sobre `src/features/sync/server/inbox.ts` con su
  propia no-regresión, y decaería la comprobación «`git diff` de `inbox.ts`
  vacío» de R17.
- **SP2** (arrastrar o no un `PRODUCT` de `DELETE`/`publishToStore: false`): una
  sola condición en el `case "PRODUCT"` de `dependencyRoleOf` —`requires: null`
  cuando `operation === "DELETE" || !payload.publishToStore`— más un caso en
  src/features/sync/dependencies.test.ts (por crear); ni el bucle, ni el `Set`,
  ni la constante, ni el db-test cambian de forma. Que sea **una** línea es
  justamente lo que compra haber sacado la tabla a una función pura (AD1).
- **SP3** (limpiar o no una clave reparada): se borra la llamada
  `dependencies.note(event, outcome.status)` del camino feliz y la rama de
  `delete` dentro de `note`, y E17 pasa a esperar `DEPENDENCY_FAILED_IN_BATCH`;
  el `Set` se vuelve de solo crecer y `note` queda con un único caso.

## Preguntas al humano

Ninguna de las tres bloquea el diseño —todas tienen defecto y recomendación—,
pero **sí bloquean la firma del plan**, que es donde deben contestarse.

**AP1 — ¿se corrige en AGENTS.md la línea de que «el orden de entrega no
importa» (I4 de la spec), y en qué commit?**
Por qué importa: § Cosas que muerden dice hoy que la idempotencia y la guarda
anti-rancia hacen irrelevante el orden. A partir de F-037 sigue siendo cierto
**para lo que se escribe**, y deja de serlo para **si un evento correcto se
aplica o vuelve en `failed[]`** dentro de un lote. Un agente que lea solo esa
frase diseñará mal el próximo handler. Opciones: (a) una línea en esa sección, en
**el mismo commit que el código**, como hizo F-036 con las dos formas de la
guarda; (b) una ADR 0031 «el orden dentro de un lote decide»; (c) nada, y confiar
en el contrato. **Recomendación: (a)** — es una frase, la sección existe
exactamente para esto, y una ADR para el matiz de una frase infla el índice.

**AP2 — ¿se arregla, en el mismo commit, el `console.error` preexistente de
`processBatch.ts:121`?**
Por qué importa: está **en el archivo que este feature toca**, a nueve líneas de
donde va el `console.warn` nuevo, y contradice la ficha del guardián de servidor
—cualquier línea con esa forma pone en rojo `smoke`/`visual`/`probe` por «el
servidor se cayó» aunque todo haya respondido bien—. Dejarlo ahí invita a
copiarlo. Opciones: (a) cambiarlo a `console.warn("[sync] …")` en el mismo commit
(una línea, sin cambio de comportamiento); (b) dejarlo, por disciplina de
alcance; (c) un `/fix` aparte, que también alcanzaría el gemelo de
`src/app/api/internal/sync/catalog/route.ts:49`. **Recomendación: (a) para el de
`processBatch.ts` y (c) para el del route**, que sí está fuera de este archivo.

**AP3 — ¿el diagnóstico es una línea por evento arrastrado o una por lote?**
Por qué importa: R20 prohíbe meter la clave en `failed[].error`, así que el log
es el único sitio donde se puede saber **qué** dependencia arrastró a quién. Una
línea por arrastrado da la atribución completa pero puede escribir hasta 499
líneas en un lote catastrófico; una línea por lote, con el recuento y las claves
distintas, es más corta y pierde el `eventId`. Opciones: (a) una por evento
arrastrado (elegida en AD5); (b) una por lote, agregada al final, con
`{ blocked: n, dependencies: [...] }`. **Recomendación: (a)**, porque solo se
dispara cuando algo **ya** falló y porque el `eventId` es lo que el POS y
nosotros necesitamos cruzar; si el humano prefiere (b), cambia el sitio de la
llamada y el tracker gana un contador.
