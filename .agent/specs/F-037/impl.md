---
feature: F-037
agente: sdd-implementer
actualizado: 2026-09-07T18:54:54Z
estado: listo
---

## Qué se construyó

| Archivo                                          | Qué hace                                                                                                                                                                                                                                                                                                                                                                    | Criterio que cubre |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/constants/sync.ts`                          | Añade `DEPENDENCY_FAILED_IN_BATCH = "DEPENDENCY_FAILED_IN_BATCH"`, con el mismo tipo de comentario que `STORE_DELIVERY_CONFIG_INCONSISTENT` (AD4)                                                                                                                                                                                                                           | 1, 4               |
| `src/features/sync/dependencies.ts` (nuevo)      | `dependencyRoleOf(event)` — `switch` exhaustivo con guarda `never` — y `createBatchDependencies()`: un `Set<DependencyKey>` de claves compuestas, con `blockedBy` y `note`, tal como los definió AD1/AD3, más la excepción del paso 4b (`note` no limpia un `CATEGORY` `DELETE`)                                                                                            | 1, 3, 4, 5, 6, 7   |
| `src/features/sync/dependencies.test.ts` (nuevo) | El álgebra de claves sin mocks: E11 (mayúsculas/espacios), E16 (`CATEGORY:USD` ≠ `CURRENCY:USD`), E12/R5 (`null`/`undefined`/`""`), R11 (ninguna fila con los dos papeles), R13 (`note` limpia con `processed` y `stale`, no con `skipped_not_published`/`duplicate`), R2 (solo `failed` añade), y el paso 4b (un `CATEGORY` `DELETE` no limpia, un `CURRENCY` `DELETE` sí) | 3, 5, 6            |
| `src/features/sync/server/processBatch.ts`       | La guarda del bucle: `dependencies.blockedBy(event)` antes de `applyEvent`, un `console.warn("[sync] …")` con `eventId`/`entity`/`dependency` y `throw new SyncEventFailure(DEPENDENCY_FAILED_IN_BATCH)`; los dos `note()` (camino feliz y `catch`); y el `console.error` preexistente de la purga de Storage pasado a `console.warn` (AD2, AD5, AP2)                       | 1, 4, 6, 7, 8, 10  |
| `AGENTS.md`                                      | Una frase añadida en § «Cosas que muerden», sin reescribir el párrafo: el orden de entrega sigue sin importar para **lo que se escribe**, pero desde F-037 el orden **dentro de un lote** decide si un evento correcto se aplica o vuelve en `failed[]` (AP1, I4)                                                                                                           | 10                 |

`SyncEventFailure`, `src/features/sync/server/inbox.ts`,
`src/features/sync/schemas.ts` y los tres handlers de
`src/features/sync/server/handlers/` quedan **sin tocar** (`git diff` vacío
en los tres, salvo el `import` nuevo de `SyncEventFailure` en
`processBatch.ts`, que ya existía como export). `docs/sync-contract.md` no se
tocó (`git diff --stat main -- docs/sync-contract.md` vacío).

## Desviaciones

Ninguna respecto al plan **ya reescrito y refirmado** (`plan.md`, paso 4b y
PP5). El código sigue AD1-AD5 al pie de la letra en todo lo demás: mismo
nombre de tipos (`DependencySource`, `DependencyKey`, `DependencyRole`,
`BatchDependencies`), misma tabla en `dependencyRoleOf`, mismo punto de
lanzamiento (`throw` dentro del `try`, antes de `applyEvent`), mismos dos
`note()` (uno tras `applyEvent`, otro en el `catch`), y R12 sigue saliendo de
la forma del código sin ninguna comprobación añadida.

**Historial de esta sección, porque cambió de forma en el mismo ciclo.** Un
`code-review` sobre el diff encontró un hueco real en R13/AD1 tal como
estaba diseñado (no en cómo lo implementé): `handleCategory` tiene una
tercera forma de terminar `"processed"` que AD1 no contempló — un `DELETE`
de una `CATEGORY` cuyo `existing` es `null` responde `PROCESSED` **sin
escribir nada** (`src/features/sync/server/handlers/misc.ts`, `if
(!existing) return PROCESSED;` — documentado como no-op en
`docs/sync-contract.md:1393`). Si esa `categoryId` había fallado antes en el
MISMO lote y ese `DELETE` llegaba después, R13 (tal como estaba firmada)
limpiaba la clave aunque la fila siguiera sin existir, y un `PRODUCT`
posterior se aplicaba sin categoría — el bug exacto que F-037 existe para
cerrar. No lo parcheé en ese momento porque arreglarlo cambiaba la tabla de
AD1 firmada por el arquitecto: lo dejé escrito como hallazgo, sin tocar el
código, y se lo pasé al orquestador.

**El humano decidió (2026-09-07, PP5) y el plan se reescribió con el paso
4b**: `note()` deja de limpiar la clave cuando `event.entity === "CATEGORY"`
y `event.operation === "DELETE"` — un `DELETE` de categoría nunca prueba que
la fila exista, la borre o no encuentre nada. `CURRENCY` es la mitad
contraria y **sigue limpiando siempre**: comprobado en
`src/features/sync/server/handlers/misc.ts`, `handleCurrency` no recibe
`operation` en absoluto (a diferencia de `handleCategory`, que sí la recibe
y ramifica por ella) y siempre hace `prisma.currency.upsert(...)`, así que
tras CUALQUIER evento `CURRENCY` — incluido un `DELETE` — la fila
genuinamente existe. Comprobado también en el `applyEvent` de
`processBatch.ts`: la llamada a `handleCurrency` no le pasa `operation`
(`return handleCurrency(event.payload, businessId, renderableBranches);`),
mientras que la de `handleCategory` sí
(`handleCategory(event.payload, event.operation, businessId)`).

Implementado: `note()`, dentro de la rama `processed`/`stale`, sale sin
tocar el `Set` si `event.entity === "CATEGORY" && event.operation ===
"DELETE"` — una condición dentro de `dependencies.ts`, sin tocar ningún
handler ni el cable. Dos casos nuevos en
`src/features/sync/dependencies.test.ts` fijan la excepción: un `CATEGORY`
`DELETE` de una clave que falló antes NO limpia el bloqueo, y un `CURRENCY`
`DELETE` de una clave que falló antes SÍ lo limpia. **`sdd-tester`: E17
tiene ahora esta excepción** — si extiendes `processBatch.test.ts` con un
caso de E17 que use un `CATEGORY` `DELETE` como el evento "reparador",
espera que el `PRODUCT` siguiente SIGA bloqueado, no que se aplique.

Un matiz sobre el paso 3, no una desviación: el plan lo asigna a
`sdd-implementer` (reparto «pasos 1-6» de `plan.md`), así que
`src/features/sync/dependencies.test.ts` lo escribí yo en este ciclo, no
`sdd-tester`. Lo aclaro porque el encargo de este ciclo hablaba solo de «no
escribas `processBatch.test.ts` ni el db-test», que son los pasos 7 y 8 — el
paso 3 no estaba en esa lista de exclusión y el plan lo confirma.

AD6 (el reparto completo de pruebas y la palanca del byte nulo en
`payload.name`) es de `sdd-tester` (pasos 7-8): no toqué
`processBatch.test.ts` ni escribí ningún `*.db.test.ts`.

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-037` → aprobado: sí (antes de escribir nada).
- `bash .agent/verify.sh F-037` → intento 2 tras un `npm run format`
  (`dependencies.test.ts` sin formatear en el primer intento — ficha
  `.agent/playbook/prettier-sin-formatear.md`, ya la reconocía) → **PASA**
  (typecheck · lint · format · test, los cuatro en verde).
- `bash .agent/verify.sh F-037 --full` → **PASA**, código de salida **0**
  confirmado con `echo $?` (harness · typecheck · lint · format · test ·
  prisma · build · theme · bundle, los nueve en verde). Repetido tras el paso
  4b (`note()` con la excepción de `CATEGORY` `DELETE`, dos casos nuevos en
  `dependencies.test.ts`) → misma salida, **0**.
- `npx vitest run src/features/sync/dependencies.test.ts --project server`
  aparte, tras el paso 4b: 23/23 casos en verde (los 21 de antes más los dos
  nuevos de la excepción).
- `npm test` (dentro de `verify.sh`) corrió el proyecto `server`; el proyecto
  `db` no se ejercitó en este ciclo porque no añadí ningún `*.db.test.ts`
  (ese es el paso 8, de `sdd-tester`) — los 12 casos existentes de
  `processBatch.test.ts` y el resto de la suite de `server` siguieron verdes
  sin que yo los tocara (R18, no-regresión).
- `npx prettier --write AGENTS.md` seguido de `diff` contra la copia previa
  del archivo (guardada antes de editar) — el diff muestra únicamente la
  frase añadida, sin ninguna línea reflowed a viñeta ni ningún cambio de
  sentido; `npx prettier` reportó `AGENTS.md ... (unchanged)`.

## Deuda dejada

Ninguna deliberada. Lo que sí queda, tal como el plan lo dejó fuera:

- `src/features/sync/server/processBatch.test.ts` sin extender (paso 7,
  `sdd-tester`): la mitad de unidad de R8/E6/E7/E9/E10/E13/E14/E15/E17.
- Ningún `*.db.test.ts` nuevo (paso 8, `sdd-tester`): C1-C8 contra Postgres
  real por el `POST` de verdad.
- El `console.error` gemelo de
  `src/app/api/internal/sync/catalog/route.ts:49` sigue **sin tocar**, tal
  como decidió el humano en PP4: queda para un `/fix` aparte.

## Qué necesita quien pruebe

- **El módulo está listo para usarse sin mocks**: `createBatchDependencies()`
  y `dependencyRoleOf()` (`src/features/sync/dependencies.ts`) son puros —
  nada que levantar, nada que mockear más allá de lo que ya mockea
  `processBatch.test.ts`.
- **La guarda ya vive en `processBatch.ts`**: dentro del `try`, `blocker =
dependencies.blockedBy(event)`; si `blocker` no es `null`, lanza
  `SyncEventFailure(DEPENDENCY_FAILED_IN_BATCH)` **antes** de `applyEvent` —
  así que un `vi.fn()` de `handleProduct`/`handleCategory`/etc. nunca se
  llamará para el evento arrastrado (R8), comprobable con
  `expect(handleProduct).not.toHaveBeenCalled()`.
- **`note()` corre en dos sitios**: justo después del `await applyEvent`
  (con `outcome.status`) y en el `catch` (con `"failed"` fijo, cubre tanto la
  guarda como cualquier fallo real del handler).
- **La palanca del byte nulo de AD6 NO la adopté yo — es del paso 8.** No
  necesité forzar ningún fallo de handler real en este ciclo (los pasos 1-6
  no incluyen ningún `*.db.test.ts`), así que no comprobé esa palanca de
  primera mano; lo que sí dejé comprobado, indirectamente, es que
  `SyncEventFailure` sigue exportándose sin cambios desde
  `src/features/sync/server/handlers/types.ts` y que el `catch` de
  `processBatch.ts` sigue construyendo `failed[]`/`results[]`/`markFailed`
  con `error.message`, que es lo que ese db-test necesita para que
  `body.failed[].error` salga con la constante exacta cuando el `throw` es
  el mío (`SyncEventFailure`) — la palanca del byte nulo solo hace falta
  para que el evento **origen** (`CATEGORY`/`CURRENCY`) falle de verdad sin
  mocks, algo que este ciclo no ejercita.
- **El código de moneda propio de C4 (paso 8) NO es mío**: yo no escribí
  ningún `*.db.test.ts`, así que no dejé ningún código de moneda que borrar.
  `architecture.md` § AD6 ya deja `"FQV"` como el código libre recomendado
  (comprobado por grep contra `CUP`, `USD`, `MLC`, `EUR`, `ABC`, `XYZ`,
  `AAA`, `BBB`, `CCC`, `DDD`, `WVX`, `QAB`, `ZZZ`) — quien escriba
  src/features/sync/server/dependencyCascade.db.test.ts (paso 8, por crear)
  debe usarlo y borrarlo en su `afterAll` (`prisma.currency.deleteMany`),
  como hace `src/features/catalog/server/rates.db.test.ts:106`.
- **`note` es conservador con `skipped_not_published`/`duplicate`**: ni añade
  ni limpia — está fijado por dos casos en
  `src/features/sync/dependencies.test.ts`. Si algún día `handleCategory` o
  `handleCurrency` responden `skipped`, hay que releer R13 (riesgo 1 de
  `architecture.md`).
- **Paso 4b, la excepción de R13 que E17 tiene que respetar ahora**: `note()`
  NO limpia la clave cuando `event.entity === "CATEGORY"` y
  `event.operation === "DELETE"` — fijado por dos casos nuevos en
  `src/features/sync/dependencies.test.ts` (`"a CATEGORY DELETE of a key that
failed before does NOT clear the block"` y `"a CURRENCY DELETE of a key that
failed before DOES clear the block"`). Si `sdd-tester` escribe un caso de
  E17 en `processBatch.test.ts` o en el db-test del paso 8 usando un `CATEGORY`
  `DELETE` como el evento que "repara" la clave, el `PRODUCT` siguiente tiene
  que seguir en `failed[]` — sería el caso que este ciclo NO puede probar en
  el bucle real, solo en el módulo puro.
- **El `console.warn` de diagnóstico** imprime `eventId`, `entity` y
  `dependency` (la clave completa, p. ej. `"CATEGORY:cat-1"`) — una línea
  por evento arrastrado, nunca agregada. Útil para que `sdd-tester` verifique
  el `eventId` correcto si decide afirmar sobre `console.warn` en algún test
  (no lo hice yo: R20 prohíbe meter la clave en `failed[].error`, no en el
  log, pero nada impide comprobarlo en unidad si se quiere).

## Preguntas al humano

Ninguna. Las cinco (PP1-PP5) ya venían resueltas en el plan firmado (y
refirmado) y las implementé tal cual: PP1 (a, arrastra por clave sin mirar
`operation` ni `publishToStore` — `dependencyRoleOf` no lee ninguno de los
dos), PP2 (a, la clave se limpia con `processed`/`stale`), PP3 (a, `inbox.ts`
intacto), PP4 (los dos arreglos adyacentes en el mismo cambio: la línea de
`AGENTS.md` y el `console.error`→`console.warn` de `processBatch.ts`; el
gemelo de `route.ts` queda fuera, para un `/fix`), PP5 (sí, y solo para
`CATEGORY`: un `DELETE` deja de limpiar la clave; `CURRENCY` sigue limpiando
siempre porque su handler ignora `operation` — paso 4b).
