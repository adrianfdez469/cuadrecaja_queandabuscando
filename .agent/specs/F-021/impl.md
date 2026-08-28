---
feature: F-021
agente: sdd-implementer
actualizado: 2026-08-28T14:30:00Z
estado: listo
---

## Qué se construyó

Los 18 pasos de `plan.md`, en orden, sin saltar ninguno.

| Archivo                                                                       | Qué hace                                                                                                                                                                                        | Paso   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `src/constants/search.ts` (nuevo)                                             | `SEARCH_TS_CONFIG`, `SEARCH_TERM_MAX_LENGTH`, `SEARCH_DOCUMENT_SEPARATOR` — compartidas con F-015                                                                                               | 1      |
| `src/constants/storeSearch.ts` (nuevo)                                        | `STORE_SEARCH_PAGE_SIZE/LAYER_MAX/EXPANSION_MAX/RANK_WEIGHTS/MAX_PAGE`                                                                                                                          | 1      |
| `src/constants/marketplace.ts`                                                | Pierde `MARKETPLACE_SEARCH_TS_CONFIG`/`MARKETPLACE_SEARCH_TERM_MAX_LENGTH` (movidas). Conserva los topes de paginación y el lote del backfill, que son suyos                                    | 1      |
| `src/features/search/server/expressions.ts` (nuevo)                           | `searchQueryOf`, `canonicalSearchVectorOf` (renombrado), `storeProductSearchVectorOf` (nuevo, ponderado) — EL único archivo con `to_tsvector(` bajo `src/`                                      | 2      |
| `src/features/marketplace/server/searchVector.ts`                             | Deja de definir las expresiones; las importa. Re-exporta `searchQueryOf` para no tocar `search.ts` del marketplace                                                                              | 2      |
| `src/features/marketplace/server/boundaries.test.ts`                          | G1(b) exige exactamente los DOS escritores (`searchVector.ts`, `searchIndex.ts`); G2 apunta a `expressions.ts`; G3 sin cambio de forma; G6 (nueva) y G7 (nueva) — mismas guardas, más estrictas | 3      |
| `src/lib/searchTerm.ts` / `.test.ts`                                          | `clampSearchPage` puro, con 7 pruebas de unidad                                                                                                                                                 | 4      |
| `prisma/schema.prisma`                                                        | `StoreProduct.searchDocument`/`searchVector` (tercer bloque de propiedad); modelo `StoreSearchQuery`; `Store.searchQueries`                                                                     | 5      |
| `prisma/migrations/20260828132737_store_product_search/migration.sql` (nuevo) | Migración editada a mano: sin los `DROP INDEX` de los tres índices no declarados; con los dos GIN nuevos y el relleno inicial. **Aplicada** contra la base compartida                           | 6      |
| `.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`       | Ampliada de 2 a 5 índices no declarados                                                                                                                                                         | 7      |
| `src/features/catalog/server/searchIndex.ts` (nuevo)                          | `reindexStoreProduct`, `reindexStoreProductsOfCanonical`, y **`reindexStoreProductsOfStore`** (no estaba en el plan — ver § Desviaciones)                                                       | 8      |
| `src/features/sync/server/handlers/product.ts` / `.test.ts` / `.db.test.ts`   | Llama al reindexador tras `recordAlias`, nunca en `STALE`/soft-delete. 4 pruebas mockeadas nuevas + 1 prueba real (criterio 10, E9)                                                             | 9      |
| `src/features/admin/server/mutations.ts` / `.test.ts`                         | `saveProduct` reindexa dentro de su propio `commit()`, después del `update` tipado. 1 prueba mockeada nueva                                                                                     | 10     |
| `prisma/seed.ts`                                                              | `GLOBAL_CATEGORIES`, `globalCategoryId` solo en canónicos con `ean`, `LocalCategory.globalCategoryId` relleno, `reindexStoreProduct` por cada oferta sembrada                                   | 11     |
| `src/features/marketplace/server/dbFixtures.ts`                               | `createLocalCategory`, `createGlobalCategory`, `createOffer` con `description`/`localCategoryId`, `createFillerOffers` (rediseñado — ver § Desviaciones), `ensureFillerTenant` extraído         | 12     |
| `src/features/catalog/server/search.ts` (nuevo)                               | `searchStoreProducts`, `buildStoreSearchSql` (exportado para el EXPLAIN), tipos del contrato                                                                                                    | 13     |
| `src/features/catalog/server/searchLog.ts` / `.test.ts` (nuevo)               | `recordStoreSearchQuery`, nunca lanza                                                                                                                                                           | 13     |
| `src/features/catalog/server/search.db.test.ts` (nuevo)                       | 19 pruebas contra Postgres real: criterios 1,2,3,4,5,7 + E2b, R17, visibilidad, hostiles, paginación, y el bug de `totalCount` en página fuera de rango (ver § Desviaciones)                    | 13, 14 |
| `describe(...EXPLAIN...)` en `search.db.test.ts`                              | Criterio 8: 10 000+10 000 filas de relleno (no 2 000 — ver § Desviaciones), `EXPLAIN (FORMAT JSON)` sobre `buildStoreSearchSql`, ambos índices nombrados, cero `Seq Scan` en `StoreProduct`     | 14     |
| `src/app/[slug]/buscar/page.tsx` (nuevo)                                      | Resolver → 404 selector/cerrada/vacío → `searchStoreProducts` (deduplicado con `React.cache`) + tasas en paralelo → render → `after()` con `recordStoreSearchQuery`                             | 15     |
| `src/components/store/StoreSearchBox.tsx` / `StoreSearchResults.tsx` (nuevos) | La caja (los tres montajes) y los dos bloques de DP1 + paginación                                                                                                                               | 15     |
| `src/app/[slug]/page.tsx`, `src/app/[slug]/p/[productSlug]/page.tsx`          | `StoreSearchBox` insertada                                                                                                                                                                      | 15     |
| `.agent/specs/F-021/visual.mjs` (nuevo)                                       | V1–V21, con tres sustituciones de fixture — ver § Desviaciones                                                                                                                                  | 16     |
| `docs/adr/0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md` (nuevo)    | La tercera categoría de propiedad de columna                                                                                                                                                    | 17     |

**`src/app/[slug]/buscar/loading.tsx` NO existe** — el plan lo pedía; se
construyó y se **retiró** por un defecto real de Next que rompía E13. Ver §
Desviaciones, punto 1.

## Desviaciones (todas descubiertas ejecutando algo, ninguna por diseño)

1. **`loading.tsx` se quitó del segmento `/[slug]/buscar/`.** Un `loading.tsx`
   hace que Next empiece a transmitir la respuesta (status 200 ya
   comprometido) antes de que la página resuelva; cuando la página llama a
   `notFound()` (E13, el selector), el HTML final muestra el 404 pero el
   **código de estado sigue siendo 200** — un defecto de streaming de
   Next, no de esta implementación. Confirmado con `curl -v`:
   `/el-trebol/p/algo` (sin `loading.tsx` en su segmento) da 404 real;
   `/el-trebol/buscar` (con `loading.tsx`) daba 200 con el cuerpo del 404.
   Quitar `loading.tsx` lo arregla; E13 es un `acceptance_criteria` literal
   y pesa más que la transición "Buscando…" de la paginación, que era
   opcional (design.md § Coste de cliente lo describe como compensación de
   que la paginación usa `next/link`, no como criterio). Sin `loading.tsx`,
   el comportamiento por defecto de Next (contenido anterior visible hasta
   que la navegación completa) sigue siendo correcto y no viola R14/E18.
   Ficha nueva: `.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md`.
2. **`searchIndex.ts` gana una tercera función, `reindexStoreProductsOfStore`,
   que el plan no nombraba.** `createFillerOffers` (paso 12/14) necesita
   insertar `n` filas en UNA tienda, y `StoreProduct.@@unique([storeId,
canonicalProductId])` impide que compartan un solo canónico — así que
   cada fila lleva su PROPIO canónico, y `reindexStoreProductsOfCanonical`
   (que reindexa por canónico) no sirve para reindexarlas todas en una
   sola llamada. `reindexStoreProductsOfStore` (selector `storeId`) sí. Es
   la misma función `reindex()` interna con un tercer selector, no una
   escritura nueva — no cambia G1/G2.
3. **`buildStoreSearchSql` (Q1) se reestructuró de `count(*) OVER ()` a
   `totals LEFT JOIN page`.** Encontrado buscando manualmente
   `?q=coca&p=2` (1 resultado real, página 2): la ventana `count(*) OVER
()` solo existe sobre filas que el `LIMIT`/`OFFSET` devuelve, así que una
   página más allá de la última colapsaba `totalCount` a 0 —
   indistinguible de "cero resultados" (E5), rompiendo el estado "página
   fuera de rango" que el criterio 15/E15 y design.md piden. Arreglado
   separando el total (`totals`, una CTE sobre `hits` antes de paginar,
   siempre una fila) de la página (`page`, con el `LIMIT`/`OFFSET`), unidas
   con `totals LEFT JOIN page ON TRUE`. Prueba nueva en `search.db.test.ts`
   ("a page beyond the last one keeps the real totalCount"). Ficha nueva:
   `.agent/playbook/conteo-total-paginado-se-pierde-en-pagina-vacia.md`.
4. **El volumen del criterio 8 subió de 2 000 (el punto de partida que
   sugiere SP4) a 20 000 (10 000 + 10 000).** Medido con `EXPLAIN (ANALYZE,
FORMAT JSON)`: a 8 030 filas la capa léxica ya usaba el GIN, pero la
   capa difusa (`StoreProduct_searchDocument_trgm_idx`) seguía con `Seq
Scan`. A 20 030, las dos capas usan sus índices. `enable_seqscan` nunca se
   tocó — exactamente lo que SP4 pidió: "subir el volumen si no basta".
5. **Tres fixtures de `.agent/specs/F-021/visual.mjs` se sustituyeron por
   otras, con la misma propiedad que se quería probar.** La base de
   desarrollo está compartida entre worktrees y su estado cambia con lo que
   OTROS features ya corrieron ahí:
   - **V13** usa `el-trebol` en vez del `bodega-central` que nombra
     design.md: hoy `bodega-central` resuelve como una sucursal normal en
     esta base (otra sesión la dejó así), y `el-trebol` es un selector
     **sembrado ya agrupado por `prisma/seed.ts` mismo** (3 sucursales),
     así que no depende de que otro `smoke.sh` haya corrido antes.
   - **V19** usa `tienda-dos` + `Coca-Cola 1.5L` en vez de `bodega-uno`: en
     esta base, `bodega-uno` también quedó agrupado (por el mismo motivo de
     arriba) y ahora es un selector, no una sucursal de una bebida sola.
     `tienda-dos` es un fixture base, no sujeto a que otro feature lo
     agrupe.
   - **V7, V16, V17** dejan de usar `q=a`: `"a"` es preposición en español y
     `plainto_tsquery('spanish', 'a')` la trata como stopword — da CERO
     resultados siempre, así que no sirve para probar columnas ni
     paginación. V7 usa la rejilla del catálogo (mismas clases CSS que
     `StoreSearchResults`); V16/V17 usan `q=coca` (1 resultado real).
     Las tres decisiones están comentadas en el propio `visual.mjs`.
6. **`document.querySelector("main")?.firstElementChild`... para V1 no
   servía** (la caja está anidada dentro de `Container`, no es literalmente
   el primer hijo de `<main>`). Cambiado a comparar posición vertical
   (`boundingBox().y`) contra el `<h1>` — «primero» en sentido de lectura,
   no de anidamiento DOM. Descartado en la bitácora de `verify.sh`, no dio
   lección (error mío en el guion visual, no del repo).
7. **`role="alert"` de V6 excluye `__next-route-announcer__`.** Next
   inyecta ese elemento (sr-only) en TODA página para lectores de pantalla;
   no es de esta vista.
8. **`p` del paragraph "No encontramos ningún producto..." (estado sin
   resultados) le faltaba `break-words`.** Con un término de 5 000 "a"
   (truncado a 120), esa línea desbordaba 753px de ancho a 360px — el
   `<h1>` ya llevaba `break-words`, ese párrafo no. Encontrado con V14,
   arreglado con la misma clase.
9. **`src/features/sync/server/handlers/product.db.test.ts` — un `count()`
   global se volvió flaky al correr junto con `search.db.test.ts`.** El
   test "C1 (E10)" contaba `prisma.canonicalBarcode.count()` SIN filtro
   antes/después de un POST rechazado; con `search.db.test.ts` insertando
   canónicos con `ean` en paralelo (proyecto `db`, archivos en paralelo por
   defecto), el conteo global cambiaba por una fila que no tenía nada que
   ver con el test. Arreglado acotando el conteo al `ean` literal
   (`"7501031311309"`) del payload de ese test — no es una trampa nueva del
   repo, es un test preexistente cuya aserción nunca antes tuvo compañía de
   tanto volumen escribiendo en paralelo en esa tabla. Confirmado estable
   en 3 corridas seguidas de `--project db` tras el arreglo.
10. **`.agent/specs/F-021/plan.md` se reformateó con Prettier** (tablas
    anchas). No es mío — es el artefacto firmado del orquestador — pero
    `npm run format:check` (etapa `format` de `verify.sh --full`) lo exigía
    y ya estaba sin formatear antes de que yo tocara nada. Solo espaciado
    de tabla; verificado con `tail` que la sección `## Aprobación` y su
    firma literal quedaron intactas.
11. **Nada más se desvió.** Los tipos de `search.ts`
    (`StoreSearchInput`/`StoreSearchResult`/`StoreSearchItem`) son
    literalmente los de architecture.md § Contratos; el SQL de W3 y Q1 es
    el mismo salvo la reestructuración del punto 3 de arriba.

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-021` → `0`.
- `npx prisma migrate dev --create-only --name store_product_search`, editado
  a mano, `npx prisma migrate dev` (aplicado) → confirmado con
  `pg_indexes`: los 5 índices no declarados (3 viejos + 2 nuevos) siguen
  ahí; `SELECT count(*) FROM "StoreProduct" WHERE "searchVector" IS NULL` =
  `0` tras el relleno.
- `npm run seed && npm run seed` → mismos conteos las dos veces
  (`canonical: 19, products: 28`, idempotente).
- `npx vitest run --project db` (repetido, incluyendo 3 corridas seguidas
  tras el arreglo del punto 9) → 5 archivos, 66 pruebas, verde estable.
- `npm test` (las tres proyectos) → 62 archivos, 611 pruebas, verde.
- `bash .agent/verify.sh F-021 --visual` → `PASA`, sin pendientes tras dos
  `dismiss` de fallos propios del guion visual (ver § Desviaciones 6).
- `bash .agent/verify.sh F-021 --full` → **`PASA`**, las 9 etapas verdes
  (harness · typecheck · lint · format · test · prisma · build · theme ·
  bundle), sin pendientes en la bitácora.

## Qué necesita quien pruebe (sdd-tester)

- **Los 9 `acceptance_criteria` + los 3 `[nuevo]`** están cubiertos por
  pruebas ejecutables: 1–8, 10, 12 en `search.db.test.ts`/`product.db.test.ts`
  contra Postgres real; 9 es el propio `verify.sh --full`; 11 es
  `check:bundle` (ya en 0, sin subir `BUDGET_KB`) + las pruebas de la
  página. **No escribí `tests.md`** — eso es tuyo, con el veredicto final.
- **El EXPLAIN del criterio 8 tarda ~13s** en su propio `describe` (crea y
  limpia 20 030 filas). Es el test más lento del proyecto `db`; no lo
  bajes de volumen sin volver a medir con `EXPLAIN (ANALYZE, FORMAT JSON)`
  — a menos de 20 000 la capa difusa vuelve a `Seq Scan`.
- **`docs/adr/0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md` está
  escrita pero no promovida a ningún otro documento** — architecture.md ya la
  proponía, el paso 17 la cerró.
- **Las dos fichas de playbook nuevas** (`nextjs-loading-tsx-rompe-status-code-de-notfound`,
  `conteo-total-paginado-se-pierde-en-pagina-vacia`) no tienen
  `visto_en` más que F-021 — si algún otro feature las dispara, añade el
  id ahí en vez de duplicar la ficha.
- **`.agent/specs/F-021/visual.mjs` depende del estado compartido de la
  base de desarrollo** para V13/V19 (qué slug es selector hoy). Si otro
  feature vuelve a agrupar `el-trebol` (no debería — está sembrado así por
  `prisma/seed.ts`, no por ningún `smoke.sh`), esos dos pasos dejarían de
  ser válidos y habría que releer qué slug es selector con la query SQL
  que dejo aquí: `SELECT sf.slug, count(s.id) FROM "Storefront" sf JOIN
"Store" s ON s."storefrontId"=sf.id WHERE s.status != 'DRAFT' GROUP BY
sf.slug HAVING count(s.id) >= 2;`.
- **No toqué `docs/sync-contract.md`**: el contrato con cuadrecaja no
  cambió, confirmado (ningún campo nuevo entra ni sale por
  `/api/internal/*`).

## Preguntas al humano

Ninguna. PP1 (migrar sobre la base compartida) ya la aprobó el humano al
firmar el plan; ninguna decisión de este ciclo necesitó una nueva pregunta.
Las tres sustituciones de fixture en `visual.mjs` (§ Desviaciones, punto 5)
son correcciones de un dato que cambió por el estado de OTRAS sesiones en
la base compartida, no una decisión de producto — no requerían subir.
