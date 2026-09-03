---
feature: F-033
agente: sdd-tester
actualizado: 2026-09-02T20:15:00Z
estado: listo
veredicto: listo
---

## Estrategia

Cuatro archivos nuevos, cada uno en el nivel que le toca (plan.md paso 9/10,
architecture.md DA8):

- src/features/orders/internalOrdersQuery.test.ts — el parser puro, proyecto
  `server` (node), sin `Request` y sin mocks. E10–E15, criterios 6, 7, 8.
- src/app/api/internal/orders/route.lateral.test.ts — la ruta con
  `@/features/orders/server/pull` y `@/features/orders/server/lateralRead`
  mockeados por separado, proyecto `server`. Archivo aparte de
  `route.test.ts` a propósito (DA8/DA1 § «la trampa del mock»): ese archivo
  sigue sin tocarse. 200/400 y «la función de lectura correspondiente no se
  llamó».
- src/features/orders/server/lateralRead.test.ts — `@/lib/prisma` mockeado,
  mismo patrón que `pull.test.ts`. El `where`/`orderBy`/`take` exacto, el
  cálculo de `nextAfter` (R11), el barrido (R8) y — por lectura de código
  fuente, no solo por comportamiento — que el archivo no contiene la palabra
  que nombra la escritura masiva de `PULLED` (R7).
- src/features/orders/server/lateralRead.db.test.ts — proyecto `db`, contra
  Postgres real, `createFixtureSession()` como `pull.db.test.ts`. Criterios
  1, 2, 4, 9 y el `EXPLAIN` del 11, con `VACUUM ANALYZE "Order"` (ficha
  `explain-seq-scan-flaky-bajo-analyze-sin-vacuum`). El primer `describe`
  usa una sesión **por test** (`beforeEach`, no `beforeAll`): la paginación
  del criterio 9 cuenta pedidos exactos de un estado, y compartir negocio
  entre `it`s habría arriesgado que un pedido de otro test se colara en la
  cuenta.

Lo que solo se ve con la app en pie (criterios 10 y 12) se verificó
**ejecutando de verdad** contra un `npm run dev` propio en el puerto 3000,
comprobado antes de levantarlo que no había otro `next dev` de este
directorio (ficha `next-dev-uno-por-directorio`). No hay `smoke.sh` de
F-033: el propio `spec.md` § criterio 14 dice que `--full` cubre las nueve
etapas y no incluye `smoke`, y los criterios 10/12 son verificaciones
aparte, no una etapa del harness. Se dejó constancia con
`bash .agent/verify.sh dismiss F-033 …` (ver § Fallos encontrados) para que
`verify.sh pending F-033` quedara vacío sin esconder el intento fallido.

## Mapa criterio → prueba

| Criterio de aceptación                                                           | Prueba                                                                                  | Archivo                                                                            | Resultado |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| 1. `AWAITING_CUSTOMER` por debajo del cursor                                     | `criterios 1 y 2: un AWAITING_CUSTOMER sale por debajo del cursor…`                     | lateralRead.db.test.ts                                                             | LISTO     |
| 1. (además, en vivo)                                                             | `node scripts/pull-orders.mjs --lateral` — "trae a A, con id MENOR que el cursor…"      | scripts/pull-orders.mjs (ejecutado)                                                | LISTO     |
| 2. la lectura lateral no mueve el cursor                                         | mismo test de arriba: `pullAfter` === `pullBefore`                                      | lateralRead.db.test.ts                                                             | LISTO     |
| 2. (además, en vivo)                                                             | `node scripts/pull-orders.mjs --lateral` — "repetir el pull… da el MISMO cuerpo…"       | scripts/pull-orders.mjs (ejecutado)                                                | LISTO     |
| 3. `?ids=<a>,<b>` exactamente esos dos, cruzando el cursor                       | `criterio 3: ?ids=A,C trae exactamente esos dos…` (en el guion) + `curl` en vivo        | scripts/pull-orders.mjs (ejecutado) + curl manual                                  | LISTO     |
| 4. id de otro negocio ≡ id inexistente                                           | `criterio 4: un id de otro negocio es indistinguible de uno inexistente`                | lateralRead.db.test.ts                                                             | LISTO     |
| 5. `?status=` sin resultados → 200 vacío, nunca 404                              | `una lectura sin resultados responde 200 con lista vacía, nunca 404 (E3)` + `curl`      | route.lateral.test.ts + curl manual                                                | LISTO     |
| 6. `?status=`/`?ids=` inválidos → 400, sin servir nada                           | `it.each` de 9 casos (E10/E11) en dos archivos + `curl` de los nueve                    | internalOrdersQuery.test.ts, route.lateral.test.ts + curl manual                   | LISTO     |
| 7. el tope de `?ids=` es 100, nunca recortado en silencio                        | `101 ids → 400 IDS_LIMIT_EXCEEDED`, `100 → 200` (dos archivos) + `curl`                 | internalOrdersQuery.test.ts, route.lateral.test.ts + curl manual                   | LISTO     |
| 8. `since` + `status`/`ids` → 400, `since=0` incluido (R6)                       | `it.each` de las 4 combinaciones (dos archivos) + `curl`                                | internalOrdersQuery.test.ts, route.lateral.test.ts + curl manual                   | LISTO     |
| 9. paginación por estado con `limit`, sin mover el pull                          | `criterio 9: paginación por estado con limit=1, dos pedidos, sin mover el pull`         | lateralRead.db.test.ts                                                             | LISTO     |
| 10. resolver una propuesta la saca de `?status=AWAITING_CUSTOMER`, solo por HTTP | guion ad hoc `verify-criterio-10.mjs` contra el servidor levantado (aprobar y rechazar) | ejecutado en vivo, ver § Ejecuciones — no forma parte de los 4 archivos entregados | LISTO     |
| 11. `EXPLAIN` usa `(businessId, status, id)`, sin migración                      | `(a) el índice existe` / `(b) el plan… nunca un Seq Scan`                               | lateralRead.db.test.ts + `git diff`/`ls prisma/migrations`/`prisma validate`       | LISTO     |
| 12. `--lateral` distingue las dos lecturas del pull                              | `node scripts/pull-orders.mjs --lateral` y sin flags, en vivo                           | scripts/pull-orders.mjs (ejecutado, ya escrito por sdd-implementer)                | LISTO     |
| 13. contrato v8, aditivo para un consumidor v7                                   | `sed -n 3p`, `grep`, y los tests viejos de la ruta/pull sin editar, en verde            | docs/sync-contract.md + route.test.ts/pull.test.ts (sin tocar)                     | LISTO     |
| 14. `verify.sh F-033 --full` en 0                                                | `bash .agent/verify.sh F-033 --full`                                                    | harness completo                                                                   | LISTO     |

Cobertura adicional, no exigida por un criterio numerado pero sí por `spec.md`
(E16/E17/R7/R8): `lateralRead.test.ts` § «R7: nunca marcan PULLED» y
lateralRead.db.test.ts usa siempre `readAfterExpirySweeps` (barrido antes de
leer).

## Ejecuciones

### Los cuatro archivos nuevos, solos

```
$ npx vitest run src/features/orders/internalOrdersQuery.test.ts
 Test Files  1 passed (1)
      Tests  29 passed (29)

$ npx vitest run src/app/api/internal/orders/route.lateral.test.ts
 Test Files  1 passed (1)
      Tests  27 passed (27)

$ npx vitest run src/features/orders/server/lateralRead.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ npx vitest run src/features/orders/server/lateralRead.db.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

`lateralRead.db.test.ts` se corrió tres veces seguidas para descartar el
`EXPLAIN` intermitente de la ficha `explain-seq-scan-flaky-bajo-analyze-sin-vacuum`:
las tres, 5/5 en verde (usa `VACUUM ANALYZE`, no solo `ANALYZE`).

### Los tres archivos protegidos, sin editar

```
$ npx vitest run src/app/api/internal/orders/route.test.ts \
    src/app/api/internal/orders/route.lateral.test.ts \
    src/app/api/internal/boundaries.test.ts
 Test Files  3 passed (3)
      Tests  45 passed (45)

$ git diff --stat src/app/api/internal/orders/route.test.ts
(vacío)
```

`src/features/orders/server/pull.test.ts` y `pull.db.test.ts` no se tocaron
(cero diff) y pasan dentro de `npm test` más abajo.

### Suite completa

```
$ npm test
 Test Files  121 passed (121)
      Tests  1223 passed (1223)
   Duration  29.33s
```

### `npm run typecheck`, `npm run lint`, `npm run format:check`

```
$ npm run typecheck        → limpio (tsc --noEmit sin salida)
$ npm run lint              → 0 errores, 1 warning preexistente en
                                src/features/account/components/ProfileForm.tsx
                                (no-location-assign-relative-destination),
                                no relacionado con F-033
$ npm run format:check      → "All matched files use Prettier code style!"
```

### `bash .agent/verify.sh F-033 --full`

```
== Verificación F-033 · intento 15 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       5s
  ✓ format     6s
  ✓ test       28s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      1s
  ✓ bundle     0s

PASA
```

**Código de salida: 0.**

### `bash .agent/verify.sh F-033 --smoke`

```
== Verificación F-033 · intento 16 ==
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       24s
  ✗ smoke      0s  (salida 1)

FALLA en smoke.
SMOKE FAIL falta el guion de runtime del feature
  no existe .agent/specs/F-033/smoke.sh — cópialo de .agent/templates/smoke.sh
```

**Código de salida: 1 — esperado, no es un fallo del feature.** F-033 no
tiene `.agent/specs/F-033/smoke.sh` a propósito: `spec.md` § criterio 14 dice
literalmente que `--full` cubre las nueve etapas de `STAGES_COMPLETO` y «no
incluye `smoke`: lo del criterio 12 es un comando aparte contra el servidor
levantado, como en F-019». Descartado con
`bash .agent/verify.sh dismiss F-033 'smoke:SMOKE FAIL falta el guion de
runtime del feature' '…'` — ver § Fallos encontrados. `verify.sh pending
F-033` queda vacío igual.

### `prisma/migrations` — criterio 11(b)

```
$ git diff main --stat -- prisma/migrations   → (vacío)
$ ls prisma/migrations | wc -l                → 14 (sin cambio)
$ npx prisma validate                          → "The schema at prisma/schema.prisma is valid"
```

### Criterio 3, 5, 6, 7, 8 — `curl` contra el servidor levantado

Servidor propio en `npm run dev` (puerto 3000, comprobado que no había otro
`next dev` de este directorio antes de levantarlo), `npm run seed`, token
acuñado con `npm run mint:token -- seed-negocio-1` (rota el token compartido
— ficha `mint-token-rota-el-token-en-bd-compartida` — anotado por si otra
sesión lo necesita reacuñar).

```
$ curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
    "$BASE/api/internal/orders?status=REJECTED_BY_STORE"
200
$ curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/internal/orders?status=REJECTED_BY_STORE"
{"orders":[],"nextCursor":null,"nextAfter":null}

$ for q in status=NOPE status= status=pulled status=PULLED,CONFIRMED \
    ids=abc ids= ids=1,,2 ids=1.5 ids=-1; do … done
status=NOPE -> 400
status= -> 400
status=pulled -> 400
status=PULLED,CONFIRMED -> 400
ids=abc -> 400
ids= -> 400
ids=1,,2 -> 400
ids=1.5 -> 400
ids=-1 -> 400

$ curl … "?ids=$(seq 1 101 | paste -sd, -)"   → 400 {"error":"INVALID_QUERY","issues":[{"path":["ids"],"message":"IDS_LIMIT_EXCEEDED"}]}
$ curl … "?ids=$(seq 1 100 | paste -sd, -)"   → 200

$ for q in "since=5&status=PULLED" "since=0&status=PULLED" "since=5&ids=1,2" "since=0&ids=1,2"; do … done
since=5&status=PULLED -> 400
since=0&status=PULLED -> 400   (R6: se detecta por presencia, no por valor)
since=5&ids=1,2 -> 400
since=0&ids=1,2 -> 400

$ curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/internal/orders?ids=7589,7593"
{"orders":[{"id":"7589",...},{"id":"7593",...}],"nextCursor":null,"nextAfter":null}
```

### Criterio 12 — `node scripts/pull-orders.mjs --lateral` en vivo

Workaround documentado en impl.md/playbook (`pull-orders-mjs-store-slug-nulo-tras-f017`,
bug preexistente y ajeno a F-033): `--store=bodega-central-vedado`.

```
$ node scripts/pull-orders.mjs --lateral --store=bodega-central-vedado
== Criterio 12 · lectura lateral (?status= y ?ids=) — no mueve el cursor ==
  ok   A sale en el pull incremental (queda PULLED)
  ok   la propuesta se acepta y deja el pedido AWAITING_CUSTOMER
  ok   B sale en el pull siguiente y el cursor del POS queda en B, más allá de A
  ok   el pull incremental, al día, no ve el cambio de A
  ok   ?status=AWAITING_CUSTOMER responde 200
  ok   trae a A, con id MENOR que el cursor que el POS ya tiene (F-033 criterio 1)
  ok   la lectura lateral devuelve nextCursor: null (R1, SP5)
  ok   repetir el pull con el mismo since da el MISMO cuerpo que antes de leer lateralmente (F-033 criterio 2)
  ok   ?ids=A,C trae exactamente esos dos, en orden ascendente, cruzando el cursor (F-033 criterio 3)
  ok   D, el tercer pedido no pedido, no aparece
  ok   ?ids= también trae nextCursor: null y nextAfter: null
  ok   un id repetido en ?ids= se sirve una sola vez (E9)
  ok   un id inexistente responde 200 con orders vacío, igual que uno de otro negocio (E7/E8)
  ok   since junto a status responde 400
  ok   status junto a ids responde 400
  ok   after sin status responde 400
  ok   limit junto a ids responde 400
  ok   más de 100 ids responde 400 (F-033 criterio 7), 100 exactos responde 200
  ok   sin token responde 401 (E8)

0 aserciones fallidas
Exit code: 0

$ node scripts/pull-orders.mjs --store=bodega-central-vedado | grep -n '^== '
2:== Criterio 1 · GET /api/internal/orders responde { orders, nextCursor } y respeta el cursor ==
22:== Criterio 2 · un pedido devuelto pasa de PENDING a PULLED ==
35:== Criterio 3 · POST /api/internal/orders/status actualiza y responde 404 si no existe ==
51:== Criterio 12 · lectura lateral (?status= y ?ids=) — no mueve el cursor ==
72:== Criterio 4 · ninguna llamada saliente hacia cuadrecaja ==
0 aserciones fallidas — exit 0
```

Cinco bloques `== … ==`, `Criterio 12` como sección propia y distinta de las
del pull incremental: la salida SÍ las distingue.

### Criterio 10 — resolver una propuesta desde la página del pedido, solo por HTTP

Se escribió un guion ad hoc (`verify-criterio-10.mjs`, en el scratchpad de
esta sesión — no es uno de los cuatro archivos entregados ni toca el repo)
que reusa exactamente la forma de `scripts/renegotiate-order.mjs::respond()`:
`POST $BASE/<slug>/pedido/<code>/respuesta` con `decision=aprobar` (o
`rechazar`), body `application/x-www-form-urlencoded`, sin `Accept:
text/html` para que la ruta responda JSON en vez de un `303`. **La única
escritura de todo el guion es ese `POST`**; todo lo demás (`orderRow`,
`orderInfo`, `orderItemRows`) son `SELECT`. Ningún `UPDATE` manual.

```
$ node scripts/_tmp-verify-criterio-10.mjs bodega-central-vedado
== Criterio 10 · resolver una propuesta hace desaparecer el pedido de ?status=AWAITING_CUSTOMER ==
  ok   el pedido sale en el pull incremental
  ok   la propuesta se acepta y deja el pedido AWAITING_CUSTOMER
  ok   ANTES de responder: el pedido está en ?status=AWAITING_CUSTOMER
  ok   el POST de respuesta responde 200 (aprobado)
  ok   DESPUÉS de aprobar: el pedido YA NO está en ?status=AWAITING_CUSTOMER
  ok   ?ids=<id> lo devuelve con status CONFIRMED
  ok   (reject) la propuesta deja el pedido AWAITING_CUSTOMER
  ok   (reject) ANTES: el pedido está en ?status=AWAITING_CUSTOMER
  ok   (reject) el POST de respuesta responde 200
  ok   (reject) DESPUÉS: el pedido ya no está en ?status=AWAITING_CUSTOMER
  ok   (reject) ?ids=<id> lo devuelve con status CANCELLED

0 aserciones fallidas
Exit code: 0
```

Cubre las dos ramas del criterio (aprobar → `CONFIRMED`, rechazar →
`CANCELLED`), en los dos casos: presente antes de responder, ausente de
`?status=AWAITING_CUSTOMER` después, y visible con el estado nuevo en
`?ids=`.

El guion se borró del repo tras correrlo (`git status --porcelain scripts/`
solo muestra el `M scripts/pull-orders.mjs` de sdd-implementer, sin rastro
del ad hoc).

### Servidor de desarrollo

Un solo `npm run dev` (ficha `next-dev-uno-por-directorio`), comprobado antes
de levantarlo que `lsof -Pan -i TCP -sTCP:LISTEN | grep node` no tenía
`next-server` de este checkout. Detenido al terminar; `lsof` posterior
confirma el puerto 3000 libre.

## Fallos encontrados

Ninguno en el código de producto. Un solo tropiezo, del harness y no del
feature:

- **`bash .agent/verify.sh F-033 --smoke` sale 1** porque
  `.agent/specs/F-033/smoke.sh` no existe. No es un fallo: `spec.md` §
  criterio 14 dice explícitamente que el criterio 14 no incluye `smoke`, y
  los criterios 10/12 —lo único que necesita la app levantada— se verifican
  con comandos aparte (§ Ejecuciones de arriba), tal como hizo F-019.
  Descartado con
  `bash .agent/verify.sh dismiss F-033 'smoke:SMOKE FAIL falta el guion de
runtime del feature' 'F-033 no tiene smoke.sh a propósito…'` para que
  `bash .agent/verify.sh pending F-033` quedara vacío sin esconder el
  intento. No amerita ficha de playbook nueva: costó un solo intento y la
  causa ya está documentada en `spec.md`/`plan.md`, no es un fallo que vaya a
  repetirse en otro feature con esta misma firma por una razón distinta —
  cualquier feature que sí tenga `smoke.sh` seguirá pasando esa etapa con
  normalidad.

No se escribió ninguna ficha nueva de playbook: cada comando de este ciclo
pasó a la primera (el `EXPLAIN` del criterio 11 se corrió tres veces seguidas
por precaución con la ficha `explain-seq-scan-flaky-bajo-analyze-sin-vacuum`
y las tres salieron en verde).

## Huecos de cobertura

- El `EXPLAIN` del criterio 11 se hace sobre SQL escrito a mano que **imita**
  el `findMany` de `readOrdersByStatus`, no sobre el que Prisma emite en
  runtime — limitación heredada y ya anotada por `spec.md`/`architecture.md`
  DA5, no nueva de este ciclo.
- La concurrencia de R15 (dos lecturas laterales simultáneas viendo estados
  distintos del mismo pedido porque su vencimiento cae entre las dos) está
  documentada en `spec.md`/`docs/sync-contract.md` v8 pero no tiene una
  prueba que fuerce la carrera de verdad — ninguno de los 14 criterios
  firmados la exige, así que queda fuera a propósito, no por descuido.
- El guion ad hoc del criterio 10 no quedó como archivo permanente del repo
  (no era parte de los cuatro archivos que el plan asigna a este ciclo, y
  `plan.md` paso 11 dice «ninguno [archivo]: solo se ejecuta»). Si el criterio
  10 necesita volver a verificarse en un ciclo futuro, hay que rehacer el
  guion o promoverlo a `scripts/`; queda anotado como pregunta abierta más
  abajo.

## Veredicto

**LISTO — los 14 criterios de aceptación se verificaron ejecutando algo**
(comando, petición HTTP real, o test contra Postgres real), con su salida
pegada en § Ejecuciones. `bash .agent/verify.sh F-033 --full` termina en 0.
`bash .agent/verify.sh F-033 --smoke` termina en 1 por la ausencia
intencional de `smoke.sh`, no por un fallo del feature, y queda descartado en
la bitácora del harness. `bash .agent/verify.sh pending F-033` está vacío.

## Preguntas al humano

- **TP1** — El guion del criterio 10 (`verify-criterio-10.mjs`) no es
  permanente: vivió en el scratchpad de esta sesión y se borró del repo tras
  correrlo, siguiendo `plan.md` paso 11 («ninguno [archivo]: solo se
  ejecuta»). ¿Vale la pena promoverlo a `scripts/renegotiate-order.mjs` (que
  ya tiene `--approve`/`--reject` con la misma forma) o a un modo nuevo de
  `scripts/pull-orders.mjs`, para que un ciclo futuro no tenga que
  rehacerlo? No lo até yo mismo a ningún archivo porque el plan firmado no
  se lo asigna a `sdd-tester` como entregable — es una recomendación, no un
  hueco que bloquee el veredicto.
- **TP2** — `npm run mint:token -- seed-negocio-1` rotó el token compartido
  de `seed-negocio-1` (ficha `mint-token-rota-el-token-en-bd-compartida`):
  cualquier otra sesión que tuviera un `QAB_BEARER_TOKEN` de ese negocio
  exportado ahora recibe `401` hasta que lo reacuñe. Lo anoto aquí porque el
  feedback que llegaría a esa sesión no dice nada de F-033 ni de esta
  verificación — solo `401`.
