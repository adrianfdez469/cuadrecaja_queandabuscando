---
slug: null-byte-en-payload-revienta-recordbatch-no-el-handler
sintoma: >
  un `*.db.test.ts` que intenta forzar el fallo de un handler de sync con un
  U+0000 dentro de un campo de texto del `payload` recibe `500 BATCH_FAILED`
  del `POST` entero, en vez del `207` con ESE evento en `failed[]` que la
  prueba esperaba.
firma: unsupported Unicode escape sequence|22P05
etapa: test
visto_en: F-037
creado: 2026-09-07T19:24:08Z
promovido_a_agents: no
arreglo: >
  no metas un U+0000 en el payload de un evento de sync — un campo distinto
  de texto libre no constreñido por la base (un `LocalCategory.name` de sobra
  para agotar `uniqueSlug`, o una invariante real ya rota a propósito, como
  ADR 0018 para `Currency`/`renderableBranches`) fuerza el mismo fallo del
  handler SIN tocar el payload.
---

## Qué pasa de verdad

`recordBatch` (`src/features/sync/server/inbox.ts:49`) escribe el `payload`
ENTERO de cada evento nuevo como `Json` en `SyncEvent.payload`, en UNA sola
sentencia `createMany` que cubre TODOS los eventos nuevos del lote, ANTES de
que ningún handler corra. Postgres rechaza un U+0000 dentro de un `json`/
`jsonb` con el mismo rigor que dentro de un `text` — el error real es
`22P05 unsupported Unicode escape sequence`, no el `22021 invalid byte
sequence for encoding "UTF8": 0x00` que `architecture.md` § AD6 documentó
(esa comprobación se hizo contra una tabla `text` aislada, nunca contra
`recordBatch`). Como la sentencia es una sola para todo el lote, UN evento
envenenado tira el `createMany` entero: `processCatalogBatch` nunca llega a
`applyEvent`, el `route.ts` responde `500 BATCH_FAILED`, y NINGÚN evento del
lote — ni siquiera los sanos — queda registrado en `SyncEvent`.

## Cómo se arregla

No hay arreglo de producto: es una limitación real y permanente de Postgres
(`json`/`jsonb` y `text` comparten la prohibición del byte nulo), y
`recordBatch` escribiendo el payload completo antes del bucle es una decisión
correcta y sin relación con este feature (R17, no se toca). El arreglo es de
la PRUEBA: usa una palanca que rompa el handler sin tocar el contenido del
`payload` — agotar los candidatos de `uniqueSlug` (`src/lib/slug.ts:107-112`,
para `CATEGORY`, `src/features/sync/server/dependencyCascade.db.test.ts` §
beforeAll) o romper a propósito la invariante ADR 0018 de un negocio
desechable (para `CURRENCY`, mismo archivo, caso C4/C5: una tienda
`PUBLISHED` sin `slug` propio en una marca de dos sucursales, que hace
lanzar a `canonicalSlug()` dentro de `renderableBranches`, DESPUÉS de que
`handleCurrency` ya escribió su propia fila).

## Cuándo NO es esto

Si el `500` trae `BATCH_FAILED` pero el log NO menciona `22P05` ni
`SyncEvent.payload`/`createMany`, es otro fallo — mirar la traza completa de
`route.ts` antes de asumir esta ficha (p. ej. un error genuino de conexión a
Postgres, que también cae en el mismo `catch` externo).

## Cómo se evita

`architecture.md` § AD6 debería verificar la palanca contra el pipeline REAL
(`recordBatch` incluido), no contra una tabla temporal aislada — ver
`.agent/specs/F-037/tests.md` § Fallos encontrados #1, devuelto a
`sdd-architect`. Si otro feature necesita forzar el fallo de un handler de
sync sin mocks, la lista de preguntas es: ¿qué corre ANTES del handler
(`recordBatch`, cualquier guarda anti-rancia) y podría reventar antes de
tiempo con la misma palanca?
