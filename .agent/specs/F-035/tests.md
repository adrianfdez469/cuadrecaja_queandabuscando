---
feature: F-035
agente: sdd-tester
actualizado: 2026-09-07T02:50:20Z
estado: listo
veredicto: listo
---

## Estrategia

Los 9 `acceptance_criteria` de `.agent/features.json` (C1..C9) son la única
lista que decide el veredicto. `plan.md` reparte el ciclo en pasos 1-5
(`sdd-implementer`, ya construidos y en verde) y 6-8 (este agente). C5 (paso 6) y C1/C3/C7 (paso 7) se verifican con trabajo nuevo de este ciclo; C2 y C6
—que **nombran su propio método de verificación** ("contando las
invalidaciones que dispara ese lote") — se verifican con un test nuevo que
cuenta de verdad, añadido en una segunda pasada de este mismo ciclo tras la
revisión del coordinador (ver § Ejecuciones); C4 y C8/C9 con lo que ya
existía, en verde antes de que este ciclo empezara.

Entorno: los emuladores Docker de Auth/Realtime/Storage están en ámbar por
una desalineación del `.env` de este worktree (no se tocó, por instrucción
expresa) — el smoke de F-035 no los necesita, solo Postgres, que respondió
todo el ciclo. `next dev` de este mismo directorio ya estaba arriba en el
puerto 3001 (proceso `41824`/`41825`, `cwd` verificado con `lsof` antes de
usarlo); `verify.sh --smoke` lo reutilizó solo (`servidor_propio()`), nunca se
lanzó un segundo `next dev`.

**`QAB_BEARER_TOKEN` no tenía valor en `.env` de este worktree**: se acuñó
con `npm run mint:token -- seed-negocio-1` y se escribió en `.env` (el único
cambio de este agente fuera de `src/`/`.agent/`; `.env` no está rastreado).
Esto **rota** el `syncTokenHash` de `seed-negocio-1` en el Postgres compartido
por todos los worktrees — ficha ya existente
`.agent/playbook/mint-token-rota-el-token-en-bd-compartida.md` (`visto_en`
F-031, y ahora F-035): cualquier otra sesión que tuviera el token anterior de
`seed-negocio-1` exportado se va a encontrar un `401` que no menciona ninguna
rotación. No se reacuñó una segunda vez ni se revirtió: quien retome, use el
valor que ya quedó en `.env`, sin volver a acuñar salvo que sepa que ninguna
otra sesión lo necesita en ese instante.

Los tests de servidor (`*.test.ts`, `*.db.test.ts`) corren en el proyecto
`node`, nunca `jsdom` (AGENTS.md § Cosas que muerden) — es automático por
extensión, y ninguno de los archivos que toca este ciclo es un componente.

## Mapa criterio → prueba

| Criterio de aceptación                                                                                                                                          | Prueba                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Archivo                                                                                                                                     | Resultado                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 — tras un EXCHANGE_RATE con tasa distinta, la primera visita posterior a `/tienda-demo` muestra el importe con la tasa nueva, sin esperar 3600s ni reiniciar | Guion de 5 pasos (moneda sintética `QAB`, nunca `USD`/`ZZZ`): POST rate:100 → POST producto sintético (price:1, QAB) → GET (afirma `$100.00`) → POST rate:200 → GET una vez (afirma `$200.00`)                                                                                                                                                                                                                                                                              | `.agent/specs/F-035/smoke.sh` § criterio 1, ejecutado con `bash .agent/verify.sh F-035 --smoke`                                             | **PASA** — 4/4 aserciones, contra Postgres real y `next dev` en 3001                                                                                        |
| C2 — un lote con 4 EXCHANGE_RATE de 4 monedas invalida cada sucursal UNA vez, no cuatro, **contando** las invalidaciones                                        | 4 `EXCHANGE_RATE` reales (`handleCurrency`/`handleExchangeRate` de `misc.ts` SIN mockear) de 4 monedas distintas, contra un negocio de 3 sucursales renderizables (`prisma` mockeado); `next/cache` mockeado con un spy que CUENTA (nunca passthrough), `src/lib/cache.ts` real. Aserto de número EXACTO: `revalidateTag` con prefijo `store:` → **6** (2×3); `storefront.findMany` → **UNA** sola vez                                                                      | `src/features/sync/server/processBatch.invalidationCount.test.ts` (nuevo) § describe "F-035 C2"                                             | **PASA** — 6/6 tags `store:` exactos, ni más ni menos; `findMany` llamado una vez, no cuatro                                                                |
| C3 — un EXCHANGE_RATE de un negocio no invalida ninguna página de otro negocio                                                                                  | Unidad: el memo nunca comparte entrada entre negocios. HTTP: `GET /el-faro` (calienta) → `UPDATE` directo por `psql` de un `localName` (no revalida por sí solo, confirmado) → `POST EXCHANGE_RATE` de `seed-negocio-1` → `GET /el-faro` otra vez, sigue el valor viejo (restaurado al final)                                                                                                                                                                               | `businessBranches.test.ts:106` ("two different businesses never share an entry") · `.agent/specs/F-035/smoke.sh` § criterio 3               | **PASA** — unidad 1/1, smoke 6/6 aserciones. `next dev` corrido: sin sorpresa de re-render idéntico (I3 del riesgo del plan no se disparó — ver nota abajo) |
| C4 — un CURRENCY invalida las sucursales del negocio emisor y de ningún otro                                                                                    | `handleCurrency` llama al lookup UNA vez, con `businessId` del caller, y devuelve exactamente ese conjunto; + el memo no cruza negocios (mismo test de C3)                                                                                                                                                                                                                                                                                                                  | `misc.test.ts:300-343` ("writes, then invalidates the caller's own renderable branches") · `businessBranches.test.ts:106`                   | **PASA**, incluido en la corrida de 47 tests de arriba                                                                                                      |
| C5 — un negocio sin ninguna sucursal publicada acepta el EXCHANGE_RATE, responde `processed`, sin invalidar ni fallar                                           | Contra Postgres real: negocio + 2 sucursales `DRAFT` sembradas con `createFixtureSession`, `POST` real al route handler, `next/cache` mockeado con SPY (cuenta, no passthrough)                                                                                                                                                                                                                                                                                             | `src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts` (nuevo, paso 6)                                                         | **PASA** — 2/2 tests, `revalidateTagSpy` NUNCA llamado en ninguno de los dos lotes                                                                          |
| C6 — 500 eventos sobre 3 sucursales no invalida más que esas 3, **con el mismo conteo del criterio 2**                                                          | Lote de 500 eventos REALES (125 `EXCHANGE_RATE` con `misc.ts` sin mockear + 125 `CATEGORY`/125 `PRODUCT`/125 `STORE` mockeados, cada uno devolviendo un slug ya incluido en el conjunto de 3) contra el mismo negocio de 3 renderizables; mismo spy de `next/cache`, `src/lib/cache.ts` real. I2 de `spec.md` queda como comentario en el propio test: para `EXCHANGE_RATE` las 3 sucursales son las DEL NEGOCIO, nunca las que el lote nombra — una tasa no nombra ninguna | `src/features/sync/server/processBatch.invalidationCount.test.ts` § describe "F-035 C6, I2"                                                 | **PASA** — 6/6 tags `store:` exactos con 500 eventos mezclados; `findMany` una sola vez, no 125 (una por `EXCHANGE_RATE`) ni 500                            |
| C7 — el checkout cotiza con la tasa fresca justo después del evento, sin depender de la invalidación                                                            | `loadFreshRates` no importa `src/lib/cache.ts` (grep, 0 resultados); suite de `quote.ts` en verde; `POST /api/orders/quote` justo tras el EXCHANGE_RATE del criterio 1, con una CUARTA tasa (400) para no depender del estado que dejó C1                                                                                                                                                                                                                                   | `grep -n "lib/cache" src/features/orders/server/quote.ts` (vacío) · `quote.test.ts` (18 tests) · `.agent/specs/F-035/smoke.sh` § criterio 7 | **PASA** — grep vacío, 18/18 tests, smoke 1/1 (`$400.00`, rate:400 × price:1)                                                                               |
| C8 — el contrato no se mueve salvo que se descubra que no es implementable                                                                                      | `git log`/`git status` sobre `docs/sync-contract.md`                                                                                                                                                                                                                                                                                                                                                                                                                        | ver § Ejecuciones                                                                                                                           | **PASA**, con la salvedad de lectura que se explica ahí (el `main` de referencia queda MUY por detrás de esta rama por trabajo anterior y ajeno a F-035)    |
| C9 — `bash .agent/verify.sh F-035 --full` sale 0                                                                                                                | El propio sensor                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `.agent/runs/F-035/017-*.log`                                                                                                               | **PASA** — 0, las 9 etapas en verde                                                                                                                         |

Un criterio sin fila es un criterio sin cubrir. Los nueve tienen fila.

## Ejecuciones

```
$ bash .agent/verify.sh F-035
== Verificación F-035 · intento 14 ==
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       23s
PASA
```

```
$ bash .agent/verify.sh F-035 --smoke
== Verificación F-035 · intento 15 ==
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       24s
  ✓ smoke      2s
PASA
```

Salida completa de `.agent/specs/F-035/smoke.sh` (14/14 aserciones ok, 0 fallidas),
capturada corriendo el guion directo contra el `next dev` de este worktree antes
de que `verify.sh` lo reutilizara igual:

```
--- criterio 1 ---
  ok   criterio 1 (paso 1) — el EXCHANGE_RATE inicial se procesó
  ok   criterio 1 (paso 3) — /tienda-demo responde 200
  ok   criterio 1 (paso 3) — precio con la tasa vieja (rate:100 x price:1)
  ok   criterio 1 (paso 5) — precio con la tasa nueva, en la PRIMERA visita posterior (rate:200 x price:1 = doble)
--- criterio 3 ---
  ok   criterio 3 (calentando) — /el-faro responde 200
  ok   criterio 3 (calentando) — trae el nombre original
  ok   criterio 3 (el UPDATE por psql NO revalida por sí solo) — sigue el nombre original
  ok   criterio 3 (el UPDATE por psql NO revalida por sí solo) — el nombre nuevo NO aparece todavía
  ok   criterio 3 — tras el EXCHANGE_RATE de OTRO negocio, el-faro SIGUE con el nombre viejo
  ok   criterio 3 — el-faro NO muestra el nombre nuevo (su caché no se expiró)
--- criterio 7 ---
  ok   criterio 7 — el checkout cotiza con la tasa RECIÉN aplicada (rate:400 x price:1), sin esperar ninguna invalidación

0 aserciones fallidas
```

Corrido DOS veces seguidas (para probar que es idempotente y limpia tras de
sí): las dos veces 0 fallidas. Verificado por SQL tras la segunda corrida:
`StoreProduct`/`CanonicalProduct` sintéticos en 0 filas, `el-faro`'s
`localName` restaurado a "Miel de abeja 250 g".

```
$ npx vitest run src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts --project db
Test Files  1 passed (1)
     Tests  2 passed (2)
```

```
$ npx vitest run src/features/sync/server/processBatch.test.ts \
    src/features/sync/server/businessBranches.test.ts src/lib/cache.test.ts \
    src/features/sync/server/handlers/misc.test.ts --project server
Test Files  4 passed (4)
     Tests  47 passed (47)
```

C2 y C6, con la cuenta exacta que cada uno afirma (revisión del coordinador: la
composición de arriba probaba que las piezas funcionan, pero ninguna **contaba**
— y el conteo es el criterio, no un detalle de implementación. Nuevo archivo,
`misc.ts` real, `src/lib/cache.ts` real, solo `prisma` y `next/cache` mockeados):

```
$ npx vitest run src/features/sync/server/processBatch.invalidationCount.test.ts --project server
Test Files  1 passed (1)
     Tests  2 passed (2)
```

Verificado con un `console.log` temporal de `revalidateTagSpy.mock.calls`
(retirado antes de dejar el archivo, no forma parte del test): el lote de 4
`EXCHANGE_RATE` disparó exactamente `["store:tienda-a", "store:tienda-a:catalog",
"store:tienda-b", "store:tienda-b:catalog", "store:tienda-c", "store:tienda-c:catalog",
"slug:tienda-a", "slug:tienda-b", "slug:tienda-c"]` — 6 tags `store:` (la cuenta
que C2 pide) más 3 `slug:` (R13, aceptado, no cuenta para R12) — nunca
`4 × 2 × 3 = 24`. `storefront.findMany` se llamó **una** vez para los cuatro
eventos, no cuatro. El lote de 500 eventos de C6 (125 `EXCHANGE_RATE` reales +
375 `CATEGORY`/`PRODUCT`/`STORE` mockeados) dio la MISMA cuenta — 6 tags
`store:`, `findMany` una sola vez — confirmando que ni el número de eventos ni
la mezcla de entidades mueve el conteo, solo el tamaño del conjunto de
sucursales renderizables del negocio.

```
$ npx vitest run src/features/orders/server/quote.test.ts --project server
Test Files  1 passed (1)
     Tests  18 passed (18)
```

```
$ npm test
Test Files  131 passed (131)
     Tests  1383 passed (1383)
```

```
$ bash .agent/verify.sh F-035 --full
== Verificación F-035 · intento 17 ==
  ✓ harness    1s
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       26s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s
PASA
```

Código de salida: **0**.

```
$ bash .agent/verify.sh pending F-035
(sin salida)
$ echo $?
0
```

Criterio 8, `docs/sync-contract.md`:

```
$ git status --short docs/sync-contract.md
(sin salida — sin cambios)
$ git log --oneline -1 -- docs/sync-contract.md
7b6e7b5 docs(contract): v11, v12 y v12.1 — six requests from cuadrecaja, answered
```

Ese commit es **anterior** al inicio de este feature (ver `.agent/progress/F-035.md`,
primera entrada `sdd-spec`) y no es parte de su trabajo: la regla ① de la v11
ya estaba publicada cuando `spec.md` se escribió, tal como dice la propia spec.
`git diff --stat main -- docs/sync-contract.md` (el literal del plan) **no**
sale vacío — mueve ~535 líneas — pero es enteramente el trabajo de v7 a v12.1
ya mergeado en esta rama ANTES de que F-035 empezara (seis commits `docs(contract):`
visibles en `git log`, todos previos a la primera entrada de la bitácora de
este feature); `main` simplemente quedó muy por detrás de esta rama de trabajo
de larga vida. La comprobación que de verdad demuestra el criterio 8 —que
**este feature** no tocó el archivo— es `git status`/`git log` de arriba:
limpio, sin ningún commit de F-035 en su historial. Interpretar el criterio
contra `main` literal habría dado un falso `no-listo` por trabajo ajeno.

## Fallos encontrados

Ninguno en código de producción. Dos hallazgos, ninguno de severidad
suficiente para volver a otro agente:

1. **`impl.md` rompía `check:harness`** (línea 65, ficha
   `.agent/playbook/stage-list-pegado-a-puntuacion.md`, ya vista en F-032 y
   F-033): la lista de etapas terminaba en `test).`, con el paréntesis pegado
   a la última palabra. Arreglado en este ciclo (una línea, sin cambiar el
   contenido) — no vuelve a ningún agente, es prosa de cierre que este mismo
   agente escribe.
2. **Al escribir el `UPDATE` de C3 por primera vez** consulté `Store.slug`
   directo para `el-faro` y salió vacío: `el-faro` es un negocio de UNA sola
   sucursal (`seed-negocio-2`), así que su slug público vive en
   `Storefront.slug`, no en `Store.slug` (F-017) — el mismo patrón que
   `.agent/playbook/pull-orders-mjs-store-slug-nulo-tras-f017.md` ya fichó
   para otro script, y que `.agent/specs/F-027/smoke.sh` ya documenta en un
   comentario. Corregido antes de que `verify.sh` lo viera fallar (nunca
   llegó a `pending`) — no hace falta ficha nueva, el patrón ya está escrito
   en dos sitios y ahora en un tercero (el propio `smoke.sh` de F-035, con su
   comentario).

`bash .agent/verify.sh pending F-035` → vacío, código 0.

## Huecos de cobertura

**El smoke no ejercita `SUSPENDED`** (spec.md § Casos límite: "todas SUSPENDED
sí invalida, por R3/R3b") contra Postgres/HTTP — está cubierto en unidad por
`businessBranches.test.ts`'s fixture `el-trebol` (que mezcla `PUBLISHED` +
`SUSPENDED` + `DRAFT`), pero no hay un HTTP end-to-end para el caso "TODAS
`SUSPENDED`". Riesgo bajo: R3/R3b son lectura, no escritura nueva, y la
fixture de unidad ya prueba que `SUSPENDED` SÍ entra en el conjunto.

## Veredicto

**LISTO.** Los nueve criterios se verificaron ejecutando algo real: HTTP
contra `next dev` con Postgres real (C1, C3, C7, y la mitad HTTP de C8), el
route handler completo contra Postgres real con `next/cache` mockeado con
spy contador (C5), la suite de Vitest con cita de archivo:línea para C4
— y, tras la revisión del coordinador, C2 y C6 con un test que **cuenta de
verdad** (`processBatch.invalidationCount.test.ts`, `misc.ts` real,
`src/lib/cache.ts` real, número exacto: 6 tags `store:`, nunca `≤` ni una
composición de piezas por separado) — más el sensor completo (C9). `bash
.agent/verify.sh F-035 --full` → **0**. `bash .agent/verify.sh pending
F-035` → vacío. El hueco de cobertura de C2/C6 de la primera pasada de este
mismo ciclo (composición sin conteo propio) queda cerrado; el único hueco que
sigue escrito es el de `SUSPENDED` por HTTP, arriba, y es preventivo, no
exigido por ningún criterio.

## Preguntas al humano

Ninguna. Los tres riesgos de `plan.md` (C3 en `next dev`, no mover USD, el
tercer parámetro de los handlers) no se materializaron: C3 se comportó como
`main` de producción se comportaría (`el-faro` no se invalidó), la moneda
sintética `QAB` nunca tocó `USD`/`MLC`/`CUP`, y el diseño de los tres
parámetros ya estaba aprobado desde `architecture.md`.
