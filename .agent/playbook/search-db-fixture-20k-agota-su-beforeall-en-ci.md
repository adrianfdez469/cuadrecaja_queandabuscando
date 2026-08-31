---
slug: search-db-fixture-20k-agota-su-beforeall-en-ci
sintoma: "el job `verify` del CI falla en `npm test` con «Hook timed out in 60000ms» en el `beforeAll` de search.db.test.ts, arrastrando un «TypeError: Cannot read properties of undefined (reading 'end')» en su `afterAll` y un segundo timeout de 10 s en vitest.setup.db.ts — y las mismas pruebas pasan en local"
firma: Hook timed out in 60000ms
etapa: test
visto_en: F-027 (PR #26, al entregar)
creado: 2026-08-31T20:40:00Z
promovido_a_agents: no
arreglo: "no es tu código si `git diff main -- src/features/catalog/server/search.db.test.ts` sale vacío y tu rama no añade ningún `*.db.test.ts`: relanza solo el trabajo fallido con `gh run rerun <id> --failed` y espera. Si falla DOS veces seguidas con esta misma firma, entonces sí es real y sube el presupuesto del `beforeAll` (test-only, F-021 lo posee)"
---

## Qué pasa de verdad

El `describe` de F-021 «el EXPLAIN usa los índices (criterio 8, SP4)»
(`src/features/catalog/server/search.db.test.ts:406`) siembra **20.000
ofertas** en su `beforeAll` —10.000 en la tienda del fixture y 10.000 en un
inquilino de relleno, el volumen mínimo que hace que el planificador prefiera
los dos GIN— y después corre `ANALYZE "StoreProduct"`. Todo eso con un
presupuesto de **60 s**.

En una máquina de desarrollo sobra. En el runner compartido de GitHub Actions
no siempre: el hook agota los 60 s, y entonces caen dos cosas más que **no son
fallos independientes aunque el log las liste como tales**:

- `afterAll` explota con `Cannot read properties of undefined (reading 'end')`
  porque `client` nunca llegó a asignarse — el `beforeAll` murió antes de
  `new Client(...)`.
- `vitest.setup.db.ts:52` agota su propio hook de 10 s limpiando lo que el
  fixture dejó a medias.

Tres entradas de `##[error]` en el log, **una sola causa**. Perseguir la del
`TypeError` es perseguir el síntoma del síntoma.

## Cómo se distingue de un fallo de verdad

Antes de tocar nada, dos comprobaciones que cuestan segundos:

```bash
git diff main --stat -- src/features/catalog/server/search.db.test.ts   # ¿lo tocaste?
git diff main --name-only | grep '\.db\.test\.ts'                       # ¿añadiste carga a la suite de base de datos?
gh run list --branch main --workflow ci.yml --limit 8                   # ¿main está verde?
```

Si el primero sale vacío, el segundo sale vacío y `main` está verde, tu rama no
puede haber causado esto: el camino que el hook recorre no pasa por tu cambio.
Relanza el trabajo. En F-027 pasó exactamente así — el diff de la rama sobre
`search.ts` era añadir `createdAt` al `SELECT`, que no toca la siembra del
fixture, y el relanzamiento salió verde en los tres trabajos.

## Cuándo NO es esto

Si tu rama **sí** añade un `*.db.test.ts`, no lo relances: le añadiste carga a
la misma base y el fixture de 20.000 filas es el primero que se queda sin
tiempo. Y si el log dice «the plan of the exact Q1 statement never Seq Scans
StoreProduct» en vez de un timeout, es la otra ficha —
`explain-seq-scan-flaky-bajo-analyze-sin-vacuum` — que es el mismo `describe`
fallando por una razón distinta.

## Cómo se evita

No está evitado. Las dos fichas de este mismo `describe` dicen lo mismo desde
dos ángulos: **es la prueba más cara del repositorio y vive al borde de su
presupuesto**. Si vuelve a costar tiempo, lo que hay que discutir no es el
timeout sino si el volumen de 20.000 filas tiene que pagarse en cada `npm test`
o puede quedarse en una etapa aparte que no bloquee el ciclo corto.
