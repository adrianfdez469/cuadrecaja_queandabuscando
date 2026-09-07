---
feature: F-035
agente: sdd-implementer
actualizado: 2026-09-07T02:30:00Z
estado: listo
---

> Pasos 1-5 de `plan.md`, los de `sdd-implementer`. Los pasos 6-8 (la fixture
> del criterio 5, el smoke, y el cierre con `impl.md`/`tests.md` finales) son
> de `sdd-tester` y no se tocan aquí.

## Qué se construyó

| Archivo                                                                     | Qué hace                                                                                                                                                                                                                                                                                             | Paso del plan |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `src/features/sync/server/businessBranches.ts` (nuevo)                      | La consulta con raíz en `Storefront` y `where` anidado (`status: { not: "DRAFT" }`), delegando los canónicos en `expandBrandRevalidation()`; y `createRenderableBranchLookup()`, la fábrica del memo por lote (`Map` en clausura, promesa memoizada, entrada borrada si se rechaza)                  | 1             |
| `src/features/sync/server/businessBranches.test.ts` (nuevo, 7 tests)        | Los dos fixtures de AD3 (`el-trebol` para R6, `bodega-central` para R4), "cero marcas → `[]`", "un `findMany` por lote" (memoización), la entrada borrada tras un rechazo, y que dos negocios nunca comparten entrada                                                                                | 2             |
| `src/features/sync/server/handlers/misc.ts`                                 | `handleCurrency` gana `businessId` y el tercer parámetro `renderableBranches`; `handleExchangeRate` gana el tercero. Los dos cambian `return PROCESSED` por `outcomeOf(await renderableBranches(businessId))`, después de escribir y (en `handleExchangeRate`) después del `return SKIPPED` de `CUP` | 3             |
| `src/features/sync/server/handlers/misc.test.ts` (+11 tests)                | `handleCurrency`/`handleExchangeRate`: el conjunto que devuelve la clausura vuelve como `touchedStoreSlugs`; conjunto vacío → sin el campo (E5); orden escritura-antes-que-lookup (R1); `CUP` no escribe ni llama a la clausura (E8)                                                                 | 3             |
| `src/features/sync/server/processBatch.ts`                                  | `processCatalogBatch` crea `const renderableBranches = createRenderableBranchLookup()` una vez, antes del bucle; `applyEvent` gana el tercer parámetro y lo pasa a los dos `case` que lo necesitan. La invalidación del final no se tocó                                                             | 4             |
| `src/features/sync/server/processBatch.test.ts` (+2 tests)                  | `CURRENCY` y `EXCHANGE_RATE` del mismo lote reciben la MISMA función como tercer argumento; un lote sin ninguno de los dos nunca la invoca                                                                                                                                                           | 4             |
| `src/features/sync/server/handlers/types.ts`                                | Comentario de `touchedStoreSlugs` corregido (I4): ya no dice "Only `handleCategory` sets this today", explica por qué tres handlers lo ponen                                                                                                                                                         | 5             |
| `src/features/storefront/server/registry.ts`                                | Comentario de `expandBrandRevalidation()` anota su segundo llamador (`businessBranches.ts`) y por qué ignora `.brandSlugs`                                                                                                                                                                           | 5             |
| `.agent/playbook/cache-de-react-es-un-no-op-en-un-route-handler.md` (nuevo) | Ficha pedida por el arquitecto: la evidencia (conteo de `getCacheForType` por runtime, verificado de nuevo por mí) y la alternativa correcta                                                                                                                                                         | —             |

Ningún tipo de `HandlerOutcome` cambió, ninguna respuesta HTTP cambió, no hay
esquema Zod nuevo, no hay migración. Cero importaciones de `src/lib/cache.ts`
en `misc.ts` (R8): lo comprobé con
`grep -n "lib/cache" src/features/sync/server/handlers/misc.ts` → sin
resultado.

## Desviaciones de lo firmado

Ninguna. Los cinco pasos son exactamente los que `plan.md` describe, con la
forma exacta del `select` y de la clausura que `architecture.md` § AD1/AD3
ya dejó escritas. Dos decisiones de detalle que la arquitectura dejaba
implícitas, sin cambiar nada de lo firmado:

- **El test de "un `findMany` por lote"** llama dos veces con
  `Promise.all` (concurrente), no dos `await` seguidos, porque es el caso
  real que importa: dos eventos del mismo lote que llegan al `await
renderableBranches(businessId)` casi a la vez tienen que compartir la
  MISMA promesa en curso, no solo el mismo resultado ya resuelto.
- Añadí dos tests que el plan no pedía por su nombre pero que
  `architecture.md` § AD1 exige como propiedad de corrección, no solo de
  rendimiento: que la entrada se borra tras un rechazo (para que el evento
  siguiente reintente en vez de heredar la promesa rechazada) y que dos
  negocios distintos nunca comparten entrada. Los cuatro tests que el plan sí
  nombra (`el-trebol`, `bodega-central`, "un `findMany` por lote", "cero
  marcas → `[]`") están, exactamente como se pidieron.

## Qué queda para `sdd-tester`

- Paso 6: la fixture de Postgres para el criterio 5 (negocio con todas sus
  sucursales en `DRAFT`), decidida por `sdd-tester` según § No decidido a
  propósito, punto 3 de `spec.md`.
- Paso 7: `.agent/specs/F-035/smoke.sh`, calcado de `F-026/smoke.sh`, con la
  moneda sintética de tres letras (nunca `USD`) y el guion de cinco pasos de
  C1.
- Paso 8: `impl.md` final (puede incorporar o reemplazar este archivo),
  `tests.md`, la bitácora, y `bash .agent/verify.sh F-035 --full`.

## Verificación

- `bash .agent/verify.sh F-035` → **0** — harness · typecheck · lint · format · test.
  Primer intento del ciclo, sin fallos que registrar.
- `bash .agent/verify.sh pending F-035` → **0**, sin lecciones pendientes.
- `npm run check:harness` → verde (260 documentos, sin drift).

No corrí `--full` (prisma · build · theme · bundle): el plan asigna esa
verificación al cierre de `sdd-tester` (paso 8, criterio 9), y este ciclo no
tocó `prisma/schema.prisma` ni nada de cliente.

## Añadido por `sdd-tester` (pasos 6, 7 y 8)

- `src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts` (paso
  6, criterio 5, C5/E5): contra Postgres real, un negocio con dos sucursales
  `DRAFT` acepta el `EXCHANGE_RATE` de verdad por el `POST` del route
  handler, responde `processed`, escribe la fila y dispara **cero**
  `revalidateTag` — mockeando `next/cache` con un spy contador, no un
  passthrough (ficha
  `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`).
- `.agent/specs/F-035/smoke.sh` (paso 7, criterios 1, 3 y 7): el guion de
  cinco pasos de C1 con la moneda sintética `QAB` (nunca `ZZZ`, ya reservada
  por F-027, ni `USD`/`MLC`/`CUP`); C3 con el `UPDATE` directo por `psql` del
  `localName` de "Miel de abeja 250 g" en `el-faro` (restaurado al final) y
  el `EXCHANGE_RATE` de `seed-negocio-1`; C7 cotizando por
  `POST /api/orders/quote` justo después del evento. Todo lo sintético se
  limpia al final (`StoreProduct`/`CanonicalProduct` del producto de prueba,
  más un evento de sync inocuo para forzar la revalidación que el `DELETE`
  por SQL no dispara — misma trampa que F-026 fichó en su día).
- `.agent/specs/F-035/tests.md`: veredicto por criterio, uno por uno.

## Nota sobre la ficha de playbook

`cache-de-react-es-un-no-op-en-un-route-handler` no la pidió el sensor —no
hay ningún fallo que la dispare, `etapa: review`— así que la escribí porque
el arquitecto la dejó pedida explícitamente en `architecture.md` § ¿Hace
falta una ADR? y en su encargo a este ciclo. Repetí la comprobación empírica
por mi cuenta (`grep -o getCacheForType <runtime> | wc -l`) antes de
escribirla: 3 en `app-page.runtime.prod.js`, 0 en las cuatro variantes de
`app-route*`.
