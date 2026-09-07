---
feature: F-036
agente: sdd-tester
actualizado: 2026-09-07T13:25:26Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno en el entorno que `AGENTS.md` § Cosas que muerden
manda por extensión de archivo:

- **Unidad** (`*.test.ts`, proyecto `node` de vitest): `misc.test.ts`
  (`handleExchangeRate`, con `prisma` mockeado) y `rates.test.ts`
  (`buildCurrentRatesSql`/`loadCurrentRates`, con `prisma` mockeado). Los
  escribió `sdd-implementer` en los pasos 3 y 4 del plan; aquí se
  re-ejecutan y se leen como evidencia de C2 y de la mitad estructural de
  C4 (el `ORDER BY` completo, desempate por `id` incluido).
- **`db`** (`*.db.test.ts`, proyecto `db`, Postgres real): el nuevo
  `rates.db.test.ts` (criterio 7 — paso 8 del plan), escrito en este ciclo.
- **Runtime** (`.agent/specs/F-036/smoke.sh`, con `next dev` en pie): los
  criterios que solo se ven con la app arriba y el histórico persistido —
  1, 2, 3, 4 y 6.
- **De una sola pasada, contra una base de usar y tirar**
  (`.agent/specs/F-036/migracion-fila-vieja.sh`, criterio 5 — paso 7 del
  plan): el único criterio que exige un estado del esquema (sin la
  columna) al que la suite `db` no puede volver (spec.md I3), porque corre
  siempre contra un esquema ya migrado.

## Mapa criterio → prueba

| Criterio de aceptación                                                                                           | Prueba                                                                                                                                                            | Archivo                                                                                      | Resultado                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1. La tasa vigente es la de `updatedAt` mayor, verificado leyendo el catálogo público y cotizando en el checkout | Smoke, escenario de spec.md C1 (480 gana sobre 440 rancio, en ambos lectores)                                                                                     | `.agent/specs/F-036/smoke.sh` § criterios 1, 2, 6                                            | `--smoke` → 0. 15/15 aserciones `ok`, 0 fallidas                                                                                        |
| 2. El evento rancio responde `processed` y viaja en `ok`, nunca en `failed`                                      | Unidad (`prisma` mockeado, sin rama `STALE`) + runtime (cuerpo real del `POST`)                                                                                   | `src/features/sync/server/handlers/misc.test.ts`; `.agent/specs/F-036/smoke.sh` § criterio 2 | `vitest run --project server misc.test.ts` → 23/23. Smoke: 3/3 `ok`                                                                     |
| 3. Las dos filas siguen en `ExchangeRate`; sigue sin haber forma de borrar una                                   | Runtime (`psql_val count`, antes de la limpieza del guion) + grep estático de `src/` en busca de `delete`/`deleteMany`/`update`/`upsert`                          | `.agent/specs/F-036/smoke.sh` § criterio 3; grep manual (ver § Ejecuciones)                  | Smoke: `count = 2` → `ok`. Grep sobre código de producción: 0 coincidencias                                                             |
| 4. Con `updatedAt` idéntico, gana el que llegó el último                                                         | Unidad (el `ORDER BY` completo, desempate por `id`, carácter por carácter) + runtime (dos eventos con el MISMO `updatedAt` literal, 500 y luego 600)              | `src/features/catalog/server/rates.test.ts`; `.agent/specs/F-036/smoke.sh` § criterio 4      | `vitest run --project server rates.test.ts` → 6/6. Smoke: 3/3 `ok`                                                                      |
| 5. Una fila sembrada ANTES de migrar no se convierte en vigente por no tener marca; sembrado real, no simulado   | Guion de una pasada contra una base de usar y tirar (comprueba que la columna no existe, siembra, migra, verifica NULL, verifica que la nueva gana)               | `.agent/specs/F-036/migracion-fila-vieja.sh`                                                 | Exit 0. 0 aserciones fallidas (ver § Ejecuciones para la salida completa)                                                               |
| 6. Los dos lectores dan la misma respuesta, comprobado en la misma corrida                                       | Runtime: la vitrina (`price_of` del HTML) y el checkout (`unitPrice` de `POST /api/orders/quote`) comparados ENTRE SÍ, en los cuatro escenarios de arriba         | `.agent/specs/F-036/smoke.sh` § "criterio 6" (repetido tras cada escenario)                  | 4/4 comparaciones cruzadas `ok` (paso 3, paso 5/6, y el escenario del criterio 4)                                                       |
| 7. La lectura de tasas no hace `Seq Scan`; el `EXPLAIN` nombra un índice con el criterio de orden nuevo          | `db`: `EXPLAIN (FORMAT JSON)` de la sentencia EXACTA de `buildCurrentRatesSql`, con ~2020 filas (2000 de relleno de otro negocio + 20 propias) y `VACUUM ANALYZE` | `src/features/catalog/server/rates.db.test.ts`                                               | `vitest run --project db rates.db.test.ts` → 2/2. Sin `Seq Scan` sobre `ExchangeRate`; el plan nombra `ExchangeRate_current_rate_idx`   |
| 8. `docs/sync-contract.md` no se vuelve a mover salvo que se descubra que la regla ② no es implementable         | `git status`/`git log main..HEAD` sobre ese archivo, en vez de `git diff main` (la rama arrastra trabajo anterior ya mergeado)                                    | —                                                                                            | `git status --short docs/sync-contract.md` vacío; `git log --oneline main..HEAD -- docs/sync-contract.md` vacío → intacto en este ciclo |
| 9. `bash .agent/verify.sh F-036 --full` termina con código 0                                                     | El propio sensor                                                                                                                                                  | —                                                                                            | `--full` → 0. Las nueve etapas (harness, typecheck, lint, format, test, prisma, build, theme, bundle) en verde. 1395/1395 tests         |

Un criterio sin fila es un criterio sin cubrir. Los nueve tienen fila y los
nueve se verificaron ejecutando algo.

## Ejecuciones

### Criterio 9 — el sensor completo

```
$ bash .agent/verify.sh F-036 --full
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       30s   (134 archivos, 1395/1395 pruebas)
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s

PASA
```

Código de salida: **0**.

### Criterios 1, 2, 3, 4, 6 — el smoke

```
$ bash .agent/verify.sh F-036 --smoke
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     8s
  ✓ test       30s
  ✓ smoke      4s

PASA
```

Salida de `.agent/specs/F-036/smoke.sh` (`.agent/runs/F-036/021-smoke.log`),
15 aserciones, todas `ok`, 0 fallidas:

```
  ok   criterio 1 (paso 1) — el EXCHANGE_RATE inicial (T2, rate:480) se procesó
  ok   criterio 1 (paso 3) — /tienda-demo responde 200
  ok   criterio 1 (paso 3) — vitrina con la tasa MAYOR (rate:480 x price:1)
  ok   criterio 2 — el evento rancio (T1<T2) responde processed (results[0].status)
  ok   criterio 2 — el eventId rancio viaja en ok
  ok   criterio 2 — failed queda vacío (no gasta ningún reintento del outbox)
  ok   criterio 1 (paso 5) — la vitrina SIGUE con la tasa MAYOR tras el evento rancio (nunca 440)
  ok   criterio 1 (paso 6) — el checkout cotiza con la tasa MAYOR tras el evento rancio
  ok   criterio 6 — vitrina y checkout coinciden ENTRE SÍ (paso 3, antes del evento rancio)
  ok   criterio 6 — vitrina y checkout coinciden ENTRE SÍ (paso 5/6, después del evento rancio)
  ok   criterio 3 — las dos filas del escenario 1 (480 y 440) siguen en ExchangeRate
  ok   criterio 4 — con updatedAt idéntico, gana el ÚLTIMO en llegar (vitrina, rate:600)
  ok   criterio 4 — con updatedAt idéntico, gana el ÚLTIMO en llegar (checkout, rate:600)
  ok   criterio 6 — vitrina y checkout coinciden ENTRE SÍ (criterio 4)

0 aserciones fallidas
```

Sin líneas de error en la salida cruda del servidor (revisado a mano contra
`SERVIDOR_ERROR_RE`). Base comprobada limpia después: `ExchangeRate` en 4
filas (las mismas de antes de empezar), `Currency` sin `KZR`, sin
`StoreProduct` huérfano.

**Nota sobre el criterio 4 (aviso del encargo, y por qué el guion lo respeta
así):** «gana el que llegó el último» no es una promesa cronológica exacta
más allá de lo que `TIMESTAMP(3)` distingue. El guion envía dos eventos con
el **mismo `updatedAt` literal** (500 y luego 600) y observa que gana 600 en
los dos lectores — eso demuestra lo que el `ORDER BY` de `buildCurrentRatesSql`
promete de verdad: `sourceUpdatedAt DESC NULLS LAST, createdAt DESC, id DESC`.
El desempate real, en este caso, lo resuelve `createdAt` (dos `INSERT` HTTP
secuenciales quedan separados por más de 1 ms en la práctica, nunca
observado colisionar — spec.md I1); si `createdAt` **también** empatara, el
último recurso es `id DESC`, que es determinista pero **no** cronológico
(un UUID v4 no correlaciona con el orden de inserción). El unitario de
`rates.test.ts` es el que afirma esa cadena completa, carácter por carácter
— la smoke demuestra el comportamiento observable; el unitario demuestra
que el código lo promete de forma estructural, no solo por casualidad de
horario.

### Criterio 5 — el guion contra una base de usar y tirar

```
$ bash .agent/specs/F-036/migracion-fila-vieja.sh
--- creando base de usar y tirar: queandabuscando_f036_c5_1788787193 ---
--- aplicando el juego de migraciones PRE-F036 ---
--- paso 0: sourceUpdatedAt todavía no existe ---
  ok   paso 0 — sourceUpdatedAt no existe (count=0)
--- paso 1: sembrar la fila vieja por SQL, antes de migrar ---
  ok   paso 1 — fila vieja sembrada (daa904b7-...), rate=111, createdAt=2026-01-01, sin sourceUpdatedAt (la columna no existe todavía)
--- paso 2: aplicar la migración de F-036 ---
  ok   paso 2 — migración de F-036 aplicada
--- paso 3: la fila vieja quedó con sourceUpdatedAt = NULL ---
  ok   paso 3 — sourceUpdatedAt de la fila vieja es NULL (PD1: sin relleno)
--- paso 4: el escenario -- una fila NUEVA con marca gana sobre la vieja sin marca ---
  ok   paso 4 — gana la fila NUEVA (rate=222, con marca); la VIEJA (rate=111, sin marca) no vuelve a ganar nunca

0 aserciones fallidas
--- paso 5: DROP DATABASE queandabuscando_f036_c5_1788787193 ---
$ echo $?
0
```

Comprobado por separado que el paso 0 abortaría de verdad si la migración ya
estuviera aplicada (el falso verde que existe para impedir): se creó una
base efímera, se le aplicaron las 15 migraciones (incluida la de F-036) y se
repitió la consulta del paso 0 — dio `count=1`, la condición que dispara el
`exit 1`. Base efímera borrada acto seguido.

Base compartida `queandabuscando` comprobada intacta antes y después de
correr el guion (nunca la toca: crea y borra su propia base):
`ExchangeRate` en 4 filas, sin la columna tocada, `prisma/migrations/`
con la carpeta de F-036 exactamente donde la dejó `sdd-implementer`
(`git status --short prisma/` → solo `?? prisma/migrations/20260907123926_.../`).

### Criterio 7 — el `EXPLAIN` con volumen

```
$ npx vitest run --project db src/features/catalog/server/rates.db.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

(a) el índice `ExchangeRate_current_rate_idx` existe y su `indexdef`
contiene `sourceUpdatedAt`. (b) el plan de la sentencia EXACTA de
`buildCurrentRatesSql` (capturada vía `Prisma.Sql`, nunca copiada a mano)
no tiene ningún nodo `Seq Scan` cuyo `Relation Name` sea `ExchangeRate`, y
el texto del plan nombra `ExchangeRate_current_rate_idx` — con 2000 filas de
relleno de un negocio distinto y 20 del negocio objetivo, `VACUUM ANALYZE`
antes del `EXPLAIN`. Base comprobada limpia después (`ExchangeRate` vuelve a
4 filas).

### Criterio 8 — `docs/sync-contract.md` intacto

```
$ git status --short docs/sync-contract.md
(vacío)
$ git rev-parse main; git rev-parse origin/main; git merge-base main HEAD
8e5db4bf...   (los tres iguales — main local está al día y es la base de esta rama)
$ git log --oneline main..HEAD -- docs/sync-contract.md
(vacío)
```

`git diff --stat main -- docs/sync-contract.md` no sirve aquí porque esta
rama arrastra trabajo anterior ya mergeado (F-034/F-035) que también tocó
el contrato antes de que F-036 empezara — `git log main..HEAD` sobre el
archivo es lo que aísla los commits de ESTE ciclo, y no hay ninguno.

### Criterios 2 y 4 — unitario

```
$ npx vitest run --project server src/features/sync/server/handlers/misc.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)

$ npx vitest run --project server src/features/catalog/server/rates.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Criterio 3 — la mitad estática (grep)

```
$ grep -rn "exchangeRate\.\(delete\|deleteMany\|update\|updateMany\|upsert\)" src/ --include="*.ts" --include="*.tsx" \
    | grep -v "src/generated/" | grep -v "\.test\.ts"
(sin coincidencias)
```

Las únicas coincidencias sin filtrar son código generado por Prisma
(ejemplos de JSDoc en `src/generated/prisma/models/ExchangeRate.ts`, nunca
invocados) y la limpieza del propio `rates.db.test.ts` (que borra sus
FILAS DE RELLENO, no histórico de producción) — ninguna de las dos es un
camino de borrado de la aplicación.

## Fallos encontrados

**Uno, de infraestructura de esta sesión, no del código de F-036 — ficha
nueva escrita y aplicada.** El primer intento de `--smoke` (intento 18)
falló con 12 aserciones rojas, con la firma ``Unknown argument
`sourceUpdatedAt`. Available options are marked with ?`` en el cuerpo de la
respuesta del criterio 2. Investigado: el `next-server` que `verify.sh`
reutilizó (puerto 3001, mismo `cwd` de este worktree — confirmado con
`lsof -a -p <pid> -d cwd -Fn`) llevaba corriendo desde el 5 de septiembre,
**dos días antes** de que `sdd-implementer` regenerara
`src/generated/prisma` (7 de septiembre, 09:39) — su cliente de Prisma en
memoria no conocía la columna nueva, aunque el schema, la migración y el
resto de la suite ya la vieran bien. No es un bug de `handleExchangeRate`
ni de este feature: es un servidor de desarrollo obsoleto de una sesión
anterior. Arreglo: `kill` del proceso confirmado como propio de este
worktree, y reintento — `verify.sh` levantó uno nuevo con el cliente ya
regenerado, y el intento 19 pasó en 0. Ficha nueva:
`.agent/playbook/next-dev-stale-prisma-client-tras-schema-change.md`
(`promovido_a_agents: no` — solo `visto_en: F-036` por ahora).
`bash .agent/verify.sh pending F-036` → vacío tras escribirla.

Ningún fallo del código de producción de los pasos 1-6 y 10 encontrado.
Nada que devolver a `sdd-spec`, `sdd-architect` ni `sdd-implementer`.

## Huecos de cobertura

- El criterio 4 nunca se probó forzando dos escrituras en el MISMO
  milisegundo de `createdAt` (desempate real por `id`): spec.md I1 ya deja
  escrito que ese empate nunca se ha observado en la base real y que
  forzarlo de forma determinista no es practicable desde un guion de shell
  contra HTTP. El unitario (`rates.test.ts`) sí afirma esa rama del
  `ORDER BY` carácter por carácter, así que la promesa del código está
  cubierta aunque el caso extremo de milisegundo no se ejecutó end-to-end.
- No se probó el riesgo que PD3 deja escrito (una sucursal renderizable que
  pasara a `DRAFT` invalidaría la invariante de la caché de tasas por
  negocio): es inalcanzable hoy con el código del repo (nada escribe
  `DRAFT` sobre una sucursal `PUBLISHED`/`SUSPENDED`), así que no hay forma
  de ejercitarlo sin escribir código fuera del alcance de este feature. El
  comentario de `getStoreRates` es la mitigación que el plan pidió, y está.

## Veredicto

**LISTO.** Los nueve criterios de aceptación se verificaron ejecutando algo
y viendo su salida real — ninguno se dio por bueno leyendo código.
`bash .agent/verify.sh F-036 --full` → código de salida **0**.
`bash .agent/verify.sh pending F-036` → vacío.

## Preguntas al humano

Ninguna. Los cuatro pasos del encargo (7, 8, 9, 11) se completaron sin
encontrar un criterio inverificable ni un fallo cuya gravedad fuera una
decisión de producto.
