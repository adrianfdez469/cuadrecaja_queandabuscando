---
feature: F-033
agente: sdd-implementer
actualizado: 2026-09-02T18:53:25Z
estado: borrador
---

## Qué se construyó

Los pasos 1 a 8 de `plan.md`. Los pasos 9, 10 y 11 (pruebas nuevas, `*.db.test.ts`
y la verificación de cierre) son de `sdd-tester` y no se tocaron.

| Archivo                                              | Qué hace                                                                                                                                                                                                                                                                                                                                                         | Criterio que cubre |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/features/orders/server/pulledOrder.ts` (nuevo)  | R2: EL `select` (`PULLED_ORDER_SELECT`) y EL mapeo (`toPulledOrder`) del payload del POS, un solo sitio. Extraído de `pull.ts` sin cambiar una línea (refactor puro).                                                                                                                                                                                            | prepara R2         |
| `src/constants/orders.ts` (sección añadida)          | `ORDER_QUERY_ISSUE`, `ORDER_LATERAL_IDS_MAX` (100), `ORDER_ID_MAX` (techo `int8`), `ORDER_PULL_LIMIT_MIN/MAX/DEFAULT`.                                                                                                                                                                                                                                           | 6, 7, 8            |
| `src/features/orders/server/expiry.ts` (+1 export)   | `readAfterExpirySweeps<T>`: compone los dos barridos + la lectura en una `$transaction([...])` de array. `pull.ts` y `lateralRead.ts` la usan.                                                                                                                                                                                                                   | prepara R8         |
| `src/features/orders/server/pull.ts` (aligerado)     | Se queda solo con el `where`/`orderBy`/`take` del pull, el `updateMany` de `PULLED` y `nextCursor`. Firma y cuerpo de respuesta intactos.                                                                                                                                                                                                                        | 1–9 (refactor)     |
| `src/features/orders/internalOrdersQuery.ts` (nuevo) | `parseInternalOrdersQuery`: presencia primero (R6), luego modo, luego el Zod de ese modo. Tres schemas hermanos. Devuelve `SerializableIssue[]`, nunca un `ZodError`.                                                                                                                                                                                            | 6, 7, 8            |
| `src/features/orders/server/lateralRead.ts` (nuevo)  | `readOrdersByStatus`, `readOrdersByIds`. No importa `pull.ts`: R7 se sostiene por construcción (sin `updateMany` en su grafo de imports).                                                                                                                                                                                                                        | 1, 3, 5, 9         |
| `src/app/api/internal/orders/route.ts` (sustituido)  | Despacha los tres modos con `parseInternalOrdersQuery`. `nextCursor: null` se pone en un único sitio para las dos laterales (DA7). `pullOrders` sigue con 3 argumentos.                                                                                                                                                                                          | 1–9                |
| `docs/sync-contract.md` (v7 → v8)                    | Los ocho puntos de `spec.md` § «Qué tiene que decir la v8»: nueva sección «Cambios respecto a la v7», fila del endpoint, § ③④ «Las lecturas laterales», acotación de `PENDING → PULLED`, fila `400 INVALID_QUERY`, enlace del timbre al parámetro concreto, y la aclaración de que la lateral no cuenta para «un solo pull en vuelo» + fila en § Modos de falla. | 13                 |
| `scripts/pull-orders.mjs` (+1 modo)                  | `--lateral` → `verifyLateralRead()`: seed, pull, `propose()` (nuevo, copiado de la forma de `renegotiate-order.mjs`), lectura por estado, lectura por ids, y los cinco rechazos. Añadido a la lista `only`/`run`, incluida la de por defecto.                                                                                                                    | 12                 |

## Desviaciones

Ninguna de los pasos firmados. Dos decisiones que el plan dejaba a mi criterio
(forma exacta de prosa, no alcance):

- **El compositor `readAfterExpirySweeps<T>`** se implementó tal como
  `architecture.md` DA2 lo especifica, sin caer al plan B (array inline en
  cada función): el genérico contra `$transaction` en forma de array
  tipó sin fricción en `npm run typecheck`, así que el riesgo listado en
  `plan.md` § «Riesgos y plan B» no se materializó.
- **`as const satisfies Prisma.OrderSelect`** (sin caer a
  `Prisma.validator<...>()`) infirió `PulledOrderRow` sin ayuda extra —
  tampoco hizo falta el plan B de DA1.
- **`src/app/api/internal/orders/route.ts` es una reescritura completa**, no
  un parche línea a línea, porque el `querySchema` de dos campos y su única
  rama de 400 desaparecen enteros (DA7 los sustituye por el parser +
  despacho). El comportamiento del modo `pull` es exactamente el de antes:
  `route.test.ts` pasa sin editarse, palabra por palabra.

## Comandos ejecutados

- `bash .agent/verify.sh F-033` → `PASA` — typecheck · lint · format · test
  Última corrida en verde tras el paso 8.
- `bash .agent/verify.sh F-033 --full` → `PASA` — harness · typecheck · lint · format · test · prisma · build · theme · bundle
  Incluye `src/features/orders/server/pull.db.test.ts` contra Postgres real
  (parte de `npm test`), en verde sin editarlo.
- `npx vitest run src/features/orders/server/pull.test.ts` → 18 passed,
  `git diff --stat` de ese archivo vacío (paso 1/3).
- `npx vitest run src/app/api/internal/orders/route.test.ts src/app/api/internal/boundaries.test.ts` →
  18 passed, ninguno de los dos editado (paso 6).
- `npm run typecheck` → verde en cada paso.
- `grep -rn 'updateMany' src/features/orders/server/lateralRead.ts` → sin
  resultados (paso 5; el comentario que explica la ausencia se escribió sin
  usar la propia palabra, para no autodispararse).
- Servidor de desarrollo levantado (`npm run dev`, un solo proceso, puerto
  3000 libre antes de arrancar) + `npm run seed` +
  `npm run mint:token -- seed-negocio-1`, y contra él:
  `node scripts/pull-orders.mjs --lateral --store=bodega-central-vedado` →
  **0 aserciones fallidas, código de salida 0**;
  `node scripts/pull-orders.mjs --store=bodega-central-vedado` (sin banderas)
  → los cinco bloques (`Criterio 1`, `2`, `3`, `12`, `4`) como secciones
  distintas, `grep -c '^== '` ≥ 1, 0 fallidas, salida 0. Servidor detenido al
  terminar.
- `docs/sync-contract.md`: `sed -n '3p'` → `**Versión 8**`; hook
  `.claude/hooks/sync-contract-version.sh` sin avisar en ninguna edición
  (la versión se movió en la primera); `npx prettier --check` en verde tras
  reformatear con el procedimiento copia/formatea/diffea de la ficha
  `prettier-write-reescribe-prosa-ajena` (prosa propia, así que se aplicó
  directo, y un salto de línea que partía un span de código en dos se
  reescribió a mano para que no perdiera la indentación de la viñeta).
- `bash .agent/verify.sh pending F-033` → vacío.

## Deuda dejada

Ninguna en el código de los pasos 1–8. Lo que queda explícitamente fuera —y
está anotado también en `plan.md` § «Qué queda fuera»— es de otros dueños:

- **El bug preexistente de `scripts/pull-orders.mjs::pickOrderableProduct()`**
  con el store `tienda-demo` por defecto (`Store.slug` es `NULL` desde F-017;
  ficha `pull-orders-mjs-store-slug-nulo-tras-f017`, `promovido_a_agents: no`).
  Afecta a **todos** los modos del guion, no solo a `--lateral`: lo confirmé
  corriendo `--paginate` sin tocar nada, con el mismo error. No es mío
  arreglarlo (no está en el alcance de F-033, y ya tiene su propia ficha con
  el arreglo descrito pero no aplicado); usé el workaround que la ficha ya
  documenta (`--store=bodega-central-vedado`, una tienda que sí conserva
  `ownSlug`) para verificar el criterio 12 en vivo.
- **Los pasos 9, 10 y 11** (pruebas unitarias del parser/ruta/lateralRead,
  `lateralRead.db.test.ts` con el `EXPLAIN`, y la verificación de cierre con
  `--smoke`) — de `sdd-tester`, tal como fija `plan.md` § Coste.

## Qué necesita quien pruebe

- Entorno: `.env` con `DATABASE_URL`/`DIRECT_URL` apuntando al Postgres
  compartido del worktree (ya alineado por el orquestador al principio del
  feature), `npm run seed` corrido al menos una vez, y un token acuñado con
  `npm run mint:token -- seed-negocio-1`.
- Los tres modos del endpoint, para probar a mano:
  - `GET /api/internal/orders?since=0&limit=100` (pull, sin cambios de la v7).
  - `GET /api/internal/orders?status=AWAITING_CUSTOMER&limit=10&after=0`
    (lateral por estado).
  - `GET /api/internal/orders?ids=1,2,3` (lateral por ids, tope 100).
- Los cinco mensajes de rechazo viven en `ORDER_QUERY_ISSUE`
  (`src/constants/orders.ts`): `IDS_LIMIT_EXCEEDED`, `SINCE_WITH_LATERAL_READ`,
  `STATUS_WITH_IDS`, `AFTER_WITHOUT_STATUS`, `LIMIT_WITH_IDS`. Todos con
  `path: []` salvo `IDS_LIMIT_EXCEEDED`, que va con `path: ["ids"]`.
- Lo frágil: el guion de humo necesita `--store=` distinto del default
  mientras la ficha de arriba siga sin arreglarse — si `sdd-tester` levanta
  el servidor para `--smoke`/`--probe` y usa el store por defecto, va a
  tropezar con el mismo error, no con una regresión de este feature.
- El `EXPLAIN` del criterio 11 (paso 10, de `sdd-tester`) tiene que copiar el
  `where` EXACTO de `readOrdersByStatus` en `lateralRead.ts`
  (`{ businessId, status, id: { gt: after } }`, `orderBy: { id: "asc" }`) y
  seguir la ficha `explain-seq-scan-flaky-bajo-analyze-sin-vacuum`
  (`VACUUM ANALYZE`, no solo `ANALYZE`).

## Preguntas al humano

Ninguna abierta que bloquee al probador. Dos observaciones, no preguntas:

- **IP1** — El bug preexistente de `pickOrderableProduct()` con `tienda-demo`
  (ficha `pull-orders-mjs-store-slug-nulo-tras-f017`) sigue sin arreglar y
  afecta a los cinco modos del guion, no solo al nuevo. Está fuera del
  alcance de F-033 (no lo toca ningún criterio ni ningún paso del plan), pero
  cualquiera que corra el guion sin `--store=` va a tropezar con él. ¿Vale la
  pena un feature/fix aparte para F-017 en algún momento, o se deja como
  está mientras nadie lo note en un ciclo real?
