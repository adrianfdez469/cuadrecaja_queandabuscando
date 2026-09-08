---
feature: F-037
agente: sdd-tester
actualizado: 2026-09-07T19:26:56Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno probando lo que solo él puede probar (AD6):

- **`src/features/sync/dependencies.test.ts`** (`sdd-implementer`, paso 3 del
  plan — ya escrito y verde, no se toca ni se duplica): el álgebra de claves
  del módulo puro, sin mocks porque no hace falta ninguno — 23 casos, entorno
  `server` (`*.test.ts` → `node`, AGENTS.md § Cosas que muerden).
- **`src/features/sync/server/processBatch.test.ts`** (paso 7, este ciclo): el
  bucle, con los cinco handlers, `./inbox` y `@/lib/cache` mockeados —
  demuestra a quién se llama y a quién no, y qué sale en
  `results`/`ok`/`failed`. Entorno `server`. Los 12 casos preexistentes no se
  tocaron: 10 casos nuevos se añadieron al final del archivo, con sus propios
  helpers (`dep*Event`), y el único cambio a código compartido fue añadir
  `handleProduct.mockReset()` al `beforeEach` (un hueco real: ninguno de los
  12 casos viejos usa PRODUCT, así que nunca hizo falta antes).
- **`src/features/sync/server/dependencyCascade.db.test.ts`** (paso 8, nuevo,
  este ciclo): Postgres real, por el `POST` de verdad, con `next/cache`
  mockeado (passthrough) — C1-C8. Entorno `db` (`*.db.test.ts`, corre en serie
  con el resto del proyecto `db`, `fileParallelism: false`).

**Cambio respecto a lo que `architecture.md` § AD6 prescribía para el paso
8**: la palanca del byte nulo (U+0000 en `payload.name`) NO funciona a
través del `POST` real, para ninguna de las dos entidades — verificado
ejecutando, no leyendo (§ Fallos encontrados #1). Se sustituyó por dos
palancas que si funcionan, verificadas cada una con la suite en verde:
agotar los 999 candidatos de `uniqueSlug` para `CATEGORY` (la propia
"alternativa sin exotismos" que AD6 ya proponía) y romper a propósito la
invariante de ADR 0018 para `CURRENCY` (una marca de dos sucursales con una
rama `PUBLISHED` sin `slug` propio, que hace lanzar `canonicalSlug()` dentro
de `renderableBranches`). La elección de palanca es conjunta
arquitecto/`sdd-tester` (spec.md § No decidido a propósito, punto 3), así que
esto se resuelve aquí y se reporta, no se pregunta.

## Mapa criterio → prueba

| Criterio de aceptación (texto literal de `features.json`)                                                                                                                                                               | Prueba  | Archivo                                                                                                                                                                                                                  | Resultado  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1. "Un lote con un CATEGORY que falla y un PRODUCT posterior que lo referencia devuelve los DOS en failed[], el PRODUCT con error DEPENDENCY_FAILED_IN_BATCH, y no queda ninguna fila de StoreProduct de ese producto." | C1 (E1) | `dependencyCascade.db.test.ts` → `"C1/C7/C8: a failed CATEGORY drags the PRODUCT..."`; unidad complementaria en `processBatch.test.ts` → `"R8/E1 (unit half)/E7: ..."` (handleProduct nunca llamado)                     | PASA       |
| 2. "Ese mismo PRODUCT reenviado TAL CUAL, con su updatedAt original, en un lote donde el CATEGORY entra bien, se aplica y queda con su categoria: la guarda anti-rancio no lo responde stale."                          | C2 (E2) | `dependencyCascade.db.test.ts`, segunda mitad del mismo `it` (`second.body.results`, `processed`, nunca `stale`/`duplicate`; fila con `localCategoryId` real)                                                            | PASA       |
| 3. "Un PRODUCT cuya categoria NO viene en el lote se sigue guardando con localCategoryId NULL y respondiendo processed: la regla vieja no cambia fuera del lote."                                                       | C3 (E3) | `dependencyCascade.db.test.ts` → `"C3: a PRODUCT whose category is NOT in the batch..."`                                                                                                                                 | PASA       |
| 4. "Un CURRENCY que falla arrastra la EXCHANGE_RATE posterior del mismo lote con ese code, y no queda ninguna fila de moneda con name y symbol iguales al codigo."                                                      | C4 (E4) | `dependencyCascade.db.test.ts` → `"C4/C5: a failed CURRENCY drags the EXCHANGE_RATE..."`; unidad complementaria en `processBatch.test.ts` → `"E10/R2: ..."`                                                              | PASA       |
| 5. "Un PRODUCT cuya moneda es la de un CURRENCY que fallo en el mismo lote se aplica igual y responde processed: CURRENCY no arrastra PRODUCT."                                                                         | C5 (E5) | mismo `it` que el anterior, mitad PRODUCT                                                                                                                                                                                | PASA       |
| 6. "El arrastre es solo hacia adelante: un PRODUCT que va ANTES del CATEGORY fallido en el mismo lote se aplica sin que lo toque nada."                                                                                 | C6 (E6) | `dependencyCascade.db.test.ts` → `"C6: the cascade is decided by occurredAt..."` (CATEGORY primero en el array, PRODUCT con `occurredAt` menor); mitad de unidad en `processBatch.test.ts` → `"E6 (unit half, R1): ..."` | PASA       |
| 7. "El resto del lote se aplica: un PRODUCT sin relacion con el evento fallido responde processed en ese mismo lote."                                                                                                   | C7 (E7) | `dependencyCascade.db.test.ts`, mismo `it` de C1 (tercer evento, `failed` con exactamente 2 entradas); unidad en `processBatch.test.ts` → mismo caso R8/E1/E7 y también `"E13/R11: ..."`                                 | PASA       |
| 8. "Un evento arrastrado no queda marcado como procesado en el inbox: reenviarlo despues responde processed, nunca duplicate."                                                                                          | C8 (E8) | `dependencyCascade.db.test.ts`, mismo `it` de C1 (SyncEvent `FAILED` con la constante justo después del primer `POST`; segundo `POST` → `processed`)                                                                     | PASA       |
| 9. "docs/sync-contract.md ya documenta la regla y el error en la v11... este feature NO vuelve a mover la version salvo que al implementarlo se descubra que lo escrito no es implementable."                           | —       | `git diff --stat main -- docs/sync-contract.md` (vacío)                                                                                                                                                                  | PASA       |
| 10. "bash .agent/verify.sh F-037 --full termina con codigo 0."                                                                                                                                                          | C10     | `bash .agent/verify.sh F-037 --full; echo $?`                                                                                                                                                                            | PASA (`0`) |

Cobertura adicional de reglas y escenarios que no tienen su propio criterio
numerado pero que el plan (paso 7) pidió explícitamente, todos en
`processBatch.test.ts`: R8 (`handleProduct` no llamado), E9 (`stale` no
arrastra), E10 (`skipped_not_published` no arrastra, mitad CURRENCY), E13 (no
hay cadena), E15 (una CATEGORY arrastra a sus tres PRODUCT posteriores), E17
con su excepción de hoy (una `CATEGORY` `UPDATE` reparadora limpia la clave;
una `CATEGORY` `DELETE` reparadora NO la limpia — impl.md § Qué necesita
quien pruebe lo pedía explícitamente), E18 (lote sin fallos, no-regresión) y
E14 (las cuatro `revalidate*` reciben los mismos conjuntos con o sin el
evento arrastrado). Ningún criterio de `features.json` cubre estos R/E por sí
solos — están para que el veredicto de C1-C8 no dependa solo de la lectura
del código, sino de haber ejercitado también los bordes que el plan pidió.

## Ejecuciones

Todos los comandos se corrieron desde la raíz del repo, con el Postgres de
`docker-compose.yml` ya levantado y migrado.

```
$ npx vitest run src/features/sync/server/processBatch.test.ts --project server
 Test Files  1 passed (1)
      Tests  22 passed (22)

$ npx vitest run src/features/sync/server/dependencyCascade.db.test.ts --project db
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run src/features/sync/server/processBatch.test.ts src/features/sync/server/dependencyCascade.db.test.ts src/features/sync/dependencies.test.ts --project server --project db
 Test Files  3 passed (3)
      Tests  49 passed (49)

$ bash .agent/verify.sh F-037 --full ; echo "EXIT: $?"
== Verificación F-037 · intento 15 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       5s
  ✓ format     7s
  ✓ test       25s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     1s
PASA
EXIT: 0

$ bash .agent/verify.sh pending F-037
(vacío)

$ git diff --stat main -- docs/sync-contract.md
(vacío)

$ git diff --stat HEAD -- src/features/sync/schemas.ts src/features/sync/server/inbox.ts
(vacío)
```

`npm test` dentro de `verify.sh --full` corre los tres proyectos
(`server`/`ui`/`db`) de una vez: 136 archivos, 1432 pruebas, todas en verde —
incluye los 12 casos preexistentes de `processBatch.test.ts` sin tocar (E18),
los 23 de `dependencies.test.ts` (paso 3, sin duplicar), los 22 de
`processBatch.test.ts` (12 + 10 nuevos) y los 4 de
`dependencyCascade.db.test.ts`.

No hizo falta `.agent/specs/F-037/smoke.sh`: los diez criterios se verifican
con `test` (unidad + `db`) y con el propio `verify.sh --full`; no hay nada
que solo se vea con la app levantada (F-037 no toca UI, no toca rutas
públicas, y `route.ts` ya se ejercita de verdad en los dos `*.db.test.ts`
existentes de sync más el nuevo).

## Fallos encontrados

**#1 — severidad: bloqueaba el paso 8 tal como estaba diseñado. Destinatario:
`sdd-architect`.**

`architecture.md` § AD6 prescribe forzar el fallo de `handleCategory`/
`handleCurrency` con un U+0000 al final de `payload.name`, verificado (dice
el propio documento) "contra el Postgres local de este repo... en una tabla
temporal". Ejecutándolo de verdad contra el pipeline completo (`POST` →
`recordBatch` → `applyEvent`), el fallo no ocurre donde AD6 esperaba: `recordBatch`
(`src/features/sync/server/inbox.ts:49`) persiste el `payload` ENTERO como
`Json` en `SyncEvent.payload`, en una única sentencia `createMany` para TODOS
los eventos nuevos del lote, ANTES de que ningún handler corra. Postgres
rechaza un U+0000 dentro de `json`/`jsonb` con el mismo rigor que dentro de
`text` (`22P05 unsupported Unicode escape sequence`, no el `22021` que AD6
documentó — esa comprobación se hizo aislada, nunca contra `recordBatch`).
Como la sentencia es una sola para todo el lote, un evento envenenado tira el
`createMany` entero: el `POST` responde `500 BATCH_FAILED` en vez de `207`
con ese evento en `failed[]`, y NINGÚN evento del lote queda registrado en
`SyncEvent` — ni siquiera los sanos. Esto no es un matiz de una entidad: pasa
igual para `CATEGORY` y para `CURRENCY`, así que ninguna de las dos mitades
de C1-C8 era alcanzable con la palanca tal como está escrita.

Reproducción exacta: cualquier evento `CATEGORY` o `CURRENCY` cuyo
`payload.name` termine en `String.fromCharCode(0)`, enviado por el `POST`
real (no mockeando `./inbox`), produce `response.status === 500` y
`(await response.json()).error === "BATCH_FAILED"`, nunca `207`.

`archivo:línea` sospechoso: `src/features/sync/server/inbox.ts:49`
(`recordBatch`'s `prisma.syncEvent.createMany`) — no es un bug, es la
precondición que AD6 no tuvo en cuenta al elegir la palanca.

**No lo arreglé yo** (no es código de producto lo que falla — la limitación
es de Postgres, y `recordBatch` no cambia por R17): sustituí la palanca por
las dos descritas en § Estrategia, ambas verificadas ejecutando (ver
`dependencyCascade.db.test.ts`, todo el archivo pasa). Elección de palanca:
conjunta arquitecto/`sdd-tester` por spec.md § No decidido a propósito, punto
3 — no bloqueante, resuelta aquí.

Lección: `.agent/playbook/null-byte-en-payload-revienta-recordbatch-no-el-handler.md`
(nueva, `firma: unsupported Unicode escape sequence|22P05`). No estaba en
`bash .agent/verify.sh pending F-037` (el sensor no llegó a ver el `500`: se
descubrió y corrigió antes de que ninguna corrida de `verify.sh` lo
capturara), así que no había nada que fichar vía esa cola — se escribe la
ficha de todos modos porque es una lección reutilizable (AGENTS.md §
Documentación: "fallo que volverá a pasar → una ficha en `.agent/playbook/`").

## Huecos de cobertura

- **E19 (la excepción de R13 con `CATEGORY` `DELETE`) no tiene su propio
  `it` en el db-test.** Vive completa en `dependencies.test.ts` (paso 3,
  álgebra pura) y en su forma de bucle-con-mocks en `processBatch.test.ts`
  (`"E17/R13's exception..."`, este ciclo). Ninguno de los diez criterios de
  `features.json` la nombra explícitamente (no es C1-C10; es un caso límite
  de R13/E19 que la spec añadió el mismo día), así que no es un criterio sin
  cubrir — es una decisión consciente de no repetir en Postgres real algo que
  el álgebra pura y el bucle mockeado ya fijan sin ambigüedad, y que además
  no puede alcanzarse desde cero de forma limpia con las palancas de este
  archivo (la 999-slug-exhaustion bloquea la CREACIÓN, no un `DELETE`
  posterior sobre una fila que nunca llegó a existir — construirlo exigiría
  una tercera palanca solo para este borde). Riesgo residual: bajo — el
  camino de producción es el mismo `note()` en los tres niveles, y el nivel
  más barato (unidad pura) ya lo fija.
- **SP1 (el orden por cadena de `recordBatch`, con offsets no-`Z`) sigue sin
  probarse**, tal como el plan lo dejó fuera (R17, "no se toca"). No es un
  hueco de este ciclo: es alcance explícitamente fuera, con su propia
  recomendación (c) si cuadrecaja llega a emitir offsets.
- **El `console.warn` de diagnóstico** (`eventId`/`entity`/`dependency`) no
  se afirma en ningún test de este ciclo. `impl.md` deja dicho que es
  opcional para quien pruebe; no se hizo porque no lo pide ningún criterio y
  R20 ya prohíbe expresamente meter esa información en `failed[].error`
  (que sí se comprueba, contra la constante importada, en todos los casos
  relevantes).

## Veredicto

**LISTO.** Los diez `acceptance_criteria` de `.agent/features.json` se
verificaron ejecutando algo (tabla de arriba); `bash .agent/verify.sh F-037
--full` termina en `0`; `bash .agent/verify.sh pending F-037` está vacío. El
único fallo encontrado (§ Fallos encontrados #1) es sobre el DISEÑO de la
prueba (AD6), no sobre el código de producto, y quedó resuelto en este mismo
ciclo con una palanca alternativa verificada — no bloquea el veredicto, y se
devuelve a `sdd-architect` como corrección de documentación para que AD6 deje
de recomendar una palanca que no funciona.

## Preguntas al humano

Ninguna. No hay ningún criterio que no se pueda verificar tal como está
escrito, y el único hallazgo (AD6) tiene una solución ya construida y verde,
no una decisión de producto pendiente.
