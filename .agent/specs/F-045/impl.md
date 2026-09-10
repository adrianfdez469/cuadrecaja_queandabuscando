---
feature: F-045
agente: sdd-implementer
actualizado: 2026-09-10T05:00:00Z
estado: listo
---

## Qué se construyó

| Archivo                                                 | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Criterio que cubre        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `src/features/sync/server/handlers/store.ts`            | `applyBusinessFields(businessId, payload)` privada, definida antes de `siblingTouch`, con el docstring de AD1. El `prisma.business.update` de la primera línea del handler se retira junto con su comentario `R8/E16`; se añaden tres llamadas, cada una la última sentencia antes de su escritura: despublicación (entre `optInChanged` y `prisma.store.update`), alta (entre el `if` del timezone por defecto y `createStorefrontWithStore`) y actualización (entre el `if` del timezone existente y el segundo `prisma.store.update`) | base de 1-6 (R1, R2, AD2) |
| `src/features/sync/server/handlers/store.test.ts`       | Cuatro `expect(businessUpdate).toHaveBeenCalledOnce()` (en los tests que aplican: actualización, `R8/E16`, despublicación, alta) y siete `expect(businessUpdate).not.toHaveBeenCalled()` (stale, otro negocio, `STORE_TIMEZONE_INVALID`, `openingHours` inválido, DELETE sin fila, `STORE_DELIVERY_CONFIG_INCONSISTENT`, alta que viola R8). Ni un `it` nuevo                                                                                                                                                                            | 6                         |
| `src/features/sync/server/handlers/business.db.test.ts` | El aserto de I4 de F-043 (`:646-684`) invertido: ahora afirma que `applyBusinessFields` no corre cuando `STORE_ZONE_UNKNOWN` rechaza el evento (`expect(after).toEqual(before)`), con anti-vacuidad (`businessName`/`baseCurrency` distintos de los de la fixture). `storeEvent` gana `businessName?`, `baseCurrency?` y `extra?` conservando sus valores por defecto de hoy. Nace `readBusinessIdentity(businessId)`. Se reescriben los docstrings de `storeEvent` y el título/comentario del `it` de I4                                | 1 (arnés listo para 2-5)  |
| `src/constants/sync.ts:135-140`                         | El docstring de `STORE_ZONE_UNKNOWN` deja de prometer con salvedad: dice que, desde F-045, un fallo no escribe nada, tampoco `Business.name`/`baseCurrencyCode`. Se retira la referencia a `store.ts:74-78`, que ya no existe                                                                                                                                                                                                                                                                                                            | —                         |
| `docs/sync-contract.md`                                 | v13.3: línea 3, § `zoneCode` (`:230-236`, retirada la salvedad de I4 y el "de la sucursal"), fila `STORE_ZONE_UNKNOWN` (retirado el inciso de I4), y entrada nueva en «Cambios respecto a la v12.2» que confiesa que `STORE_OPENING_HOURS_INVALID`/`STORE_DELIVERY_CONFIG_INCONSISTENT` también prometían de más desde la v9 (PP1). Las filas `:1894`/`:1896` (antes `:1883`/`:1885`) no se tocaron                                                                                                                                      | 7                         |

## Desviaciones

- **`src/constants/sync.ts`: la nota reescrita empieza en `:135`, no en `:136` como decía el plan.** El plan citaba `:136-139`; al releer el archivo antes de editar, la frase realmente empieza en la `:135` (`event fails, none of the STORE's other fields apply, and`) y el bloque completo ocupa `:135-140` tras la edición (creció una línea porque la promesa nueva es más explícita que la vieja salvedad). Sin impacto: es la misma nota, en el mismo sitio relativo al resto del docstring.
- **El docstring de `applyBusinessFields` tuvo que reformularse para no contener el texto literal `payload.businessId`.** El texto de AD1 dice «never `payload.businessId`» — ese literal hace que `src/app/api/internal/boundaries.test.ts` (criterio C6, un guardián de texto crudo que vigila que ningún handler de sync lea el `businessId` del payload como fuente de identidad) marque `store.ts` como infractor, aunque la mención es en un comentario que EXPLICA la regla, no una violación de ella. Ficha `.agent/playbook/boundaries-guard-cruzado-por-patron-de-texto.md`: el arreglo es cambiar la FORMA del texto sin cambiar la intención. Se reescribió a «never the payload's own business identifier», que dice lo mismo y no coincide con el patrón vigilado. Anotado en la bitácora de la ficha (`visto_en` ganó F-045).
- **La entrada de la v13.3 en el contrato menciona explícitamente el nombre de los dos códigos** (`STORE_OPENING_HOURS_INVALID`, `STORE_DELIVERY_CONFIG_INCONSISTENT`) en vez de solo decir «las otras dos filas», por legibilidad para quien lea el changelog sin el contexto de esta sesión — mismo contenido que PP1 pedía, redactado con los nombres en vez de con una referencia indirecta.
- **`.agent/features.json` ya llegó modificado (criterio 7, PP2) antes de que este agente tocara nada** — confirmado con `git log`/`git diff HEAD` al empezar: no es un cambio hecho por `sdd-implementer`, es la edición del humano previa a la aprobación del plan, ya presente en el árbol de trabajo. Se dejó tal cual, sin tocarla más.
- **`.agent/specs/F-045/plan.md` se formateó con `npm run format`** porque `format:check` lo señaló (columnas de tabla sin alinear). Diffeado antes de aceptar: el único cambio es el relleno de espacios de las tablas, ninguna palabra cambió (ficha `prettier-write-reescribe-prosa-ajena`, procedimiento seguido al pie de la letra).

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-045` → `0`, plan firmado.
- `npm run typecheck` → verde en cada paso.
- `npx vitest run --project server src/features/sync/server/handlers/store.test.ts` → 28 passed (paso 1 y paso 2).
- `npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts` → tras el paso 1 (antes del paso 3), **falló exactamente en `:674-676`** y en ningún otro sitio — la prueba de que `applyBusinessFields` funciona; tras el paso 3, 18 passed.
- `npm run lint` → 0 errores (1 warning preexistente, no relacionado).
- `grep -n 'Versión 13.3' docs/sync-contract.md` → línea 3. `grep -c 'Business.name' docs/sync-contract.md` → `0`. `grep -c 'I4' docs/sync-contract.md` → `0`. `grep -c 'baseCurrencyCode' docs/sync-contract.md` → `0`.
- `bash .agent/verify.sh F-045 --full; echo $?` → **`0`**, todos verdes: harness · typecheck · lint · format · test · prisma · build · theme · bundle
- `bash .agent/verify.sh pending F-045` → vacío, `0`.

## Deuda dejada

Ninguna de este ciclo. Los pasos 4 y 5 (los siete `it` nuevos del `describe` de F-045 en `business.db.test.ts` y el `it` de `STORE_TIMEZONE_INVALID` en `storePublishGate.db.test.ts`) quedan explícitamente para `sdd-tester`, tal como pedía el encargo: el arnés (`storeEvent` con parámetros opcionales, `readBusinessIdentity`, anti-vacuidad) está listo para que los escriba sin rehacerlo.

## Qué necesita quien pruebe

- El arnés de `business.db.test.ts` ya tiene `storeEvent({ ..., businessName?, baseCurrency?, extra? })` y `readBusinessIdentity(businessId)`. Los defaults de hoy (`businessName: "Negocio F-043"`, `baseCurrency: "CUP"`) se conservaron para no tocar el test de F-043 más de lo que R10 pedía — los tests nuevos deben pasar sus propios valores, **distintos** de los que la fixture ya deja (`CUP` es el default de la columna), o la anti-vacuidad de AD5.3 no se cumple.
- El `describe` nuevo de F-045 va con sesión fresca por test (`beforeEach`/`afterEach` propios), no colgado del `describe` de `BUSINESS`.
- El test del criterio 5(a) (alta) necesita borrar el `Slug` huérfano que deja `createStorefrontWithStore` antes de `session.cleanup()`, con `prisma.slug.deleteMany({ where: { value: { startsWith: session.token } } })` — AD5 punto 4.
- El `it` de `STORE_TIMEZONE_INVALID` en `storePublishGate.db.test.ts` tiene que ser **propio**, con un solo evento en el lote — el `it` existente (`:57-140`) manda también un `STORE` sano en el mismo lote, así que añadirle un aserto mediría otra cosa.

## Preguntas al humano

Ninguna. `PP1` y `PP2` ya estaban contestadas en la aprobación del plan y se aplicaron literalmente (v13.3 menciona a las otras dos filas; el criterio 7 en `features.json` ya pedía los dos `grep`).
