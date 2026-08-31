---
slug: explain-seq-scan-flaky-bajo-analyze-sin-vacuum
sintoma: "src/features/catalog/server/search.db.test.ts > ... > (b) the plan of the exact Q1 statement never Seq Scans StoreProduct — falla en la suite completa (`npm test` / `vitest run` sin filtro) y pasa siempre que se corre solo o con `-t`"
firma: the plan of the exact Q1 statement never Seq Scans StoreProduct
etapa: test
visto_en: F-027
creado: 2026-08-31T19:41:58Z
promovido_a_agents: no
arreglo: no es tu código — vuelve a correr `npm test`/`bash .agent/verify.sh <ID> --full`; si el `describe` de F-021 (`search.db.test.ts` § «el EXPLAIN usa los índices») sigue fallando dos veces seguidas, cambia su `ANALYZE "StoreProduct"` por `VACUUM ANALYZE "StoreProduct"` (test-only, F-021 lo posee)
---

## Qué pasa de verdad

`search.db.test.ts` § «el EXPLAIN usa los índices (criterio 8, SP4)» siembra
20.000 filas de relleno en `StoreProduct` (más 10.000 en un tenant ajeno),
llama `ANALYZE "StoreProduct"` y comprueba con `EXPLAIN (FORMAT JSON)` —sin
`ANALYZE` en el propio `EXPLAIN`, es decir, coste estimado, no medido— que el
plan de la consulta Q1 de `buildStoreSearchSql` nunca hace `Seq Scan` sobre
`StoreProduct`. El umbral de 20.000 filas está medido para que el índice gane
**con la tabla limpia**, pero el proyecto `db` de `vitest.config.mts` corre
sus `*.db.test.ts` en serie (`fileParallelism: false`) contra la MISMA base de
desarrollo compartida: cuando este archivo se ejecuta después de otros
ficheros `*.db.test.ts` que también insertan y borran miles de filas en
`StoreProduct` en la misma sesión, el `ANALYZE` de este test se ejecuta sobre
una tabla con tuplas muertas (`dead tuples`) que la limpieza (`DELETE`, no
`TRUNCATE`) de los tests anteriores dejó sin recolectar — `ANALYZE` solo
recalcula estadísticas, no compacta páginas ni marca espacio libre;
eso lo hace `VACUUM`, y ninguno de los tests lo llama. Con más páginas de
heap que reflejen filas ya borradas, el optimizador estima un coste de
`Index Scan` más alto (más punteros que resolver contra páginas con huecos)
y en el margen puede preferir `Seq Scan`. Es probabilístico, no determinista:
en este ciclo falló 1 de 3 corridas completas de `bash .agent/verify.sh
F-027 --full` y 0 de 6 corridas del archivo en solitario o de `vitest run`
completo sin reintentos adicionales.

Reproducido en F-027 sin que este feature tocara la consulta que el criterio
mide en su forma: F-027 solo añadió una columna (`sp."createdAt"`) al
`SELECT` de la misma CTE que ya existía, lo que ensancha marginalmente el
coste estimado por fila y hace el margen entre `Index Scan` y `Seq Scan` un
poco más estrecho — pero el fallo también es reproducible corriendo
`vitest run` en el checkout de `main` (sin ese cambio) bajo la carga
suficiente, así que la causa raíz es la ausencia de `VACUUM` entre archivos
`*.db.test.ts`, no el `SELECT` añadido.

## Cómo se arregla

Para quien se lo encuentra ahora: es un fallo real de la suite pero no del
código que estás verificando. Vuelve a correr el comando completo
(`bash .agent/verify.sh <ID> --full` o `npm test`) una vez más; si pasa,
regístralo como fallo transitorio de infraestructura, no como regresión.

Si vuelve a fallar dos veces seguidas y bloquea un cierre: en
`src/features/catalog/server/search.db.test.ts`, dentro del `beforeAll` de
la describe «el EXPLAIN usa los índices», cambia:

```ts
await client.query('ANALYZE "StoreProduct"');
```

por:

```ts
await client.query('VACUUM ANALYZE "StoreProduct"');
```

`VACUUM` compacta las páginas con tuplas muertas antes de que `ANALYZE`
calcule las estadísticas, lo que hace que el coste estimado no dependa de
cuánta basura dejaron los archivos `*.db.test.ts` que corrieron antes en la
misma sesión serial. Es un cambio de una prueba de F-021 (test-only), no de
`src/features/catalog/server/search.ts`.

## Cuándo NO es esto

Si la firma aparece pero el mensaje de error es distinto —por ejemplo
`planText).toContain(...)` fallando porque falta el nombre de un índice, no
`hasSeqScanOnStoreProduct`—, el índice no existe o se borró (ver la ficha
`prisma-migrate-dev-borra-indices-gin-no-declarados`), y no es esto: revisa
`pg_indexes` a mano, no re-ejecutes esperando que pase solo.

Si falla **siempre**, en cualquier orden y en solitario, tampoco es esto: es
una regresión real en `buildStoreSearchSql` o en el `SELECT` que se le añadió,
y el criterio 8 de F-021 (o el `EXPLAIN` de este mismo feature, si el cálculo
de F-027 llega a tocar SQL) está roto de verdad.

## Cómo se evita

Que cualquier `*.db.test.ts` que siembre miles de filas para forzar un plan
de consulta llame `VACUUM ANALYZE`, no solo `ANALYZE`, antes de su `EXPLAIN`
— es una línea, y hace el test insensible al orden de ejecución de la suite.
Mientras eso no se generalice, cualquier feature que añada un `*.db.test.ts`
con este patrón hereda el mismo riesgo si su siembra de datos corre después
de otra en la misma sesión serial del proyecto `db`.
