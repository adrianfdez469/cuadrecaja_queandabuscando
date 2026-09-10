---
feature: F-044
agente: sdd-implementer
actualizado: 2026-09-10T12:40:00Z
estado: listo
---

## Qué se construyó

Los 12 pasos de `plan.md`, en su orden, completos y verificados uno a uno,
incluido el paso 12 (`verify.sh --full`, ver «Comandos ejecutados»).

| Archivo                                                    | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Criterio que cubre |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/features/sync/reconciliationHash.ts`                  | Módulo puro (paso 1): `byteOrderedEntries`, `md5OfEntries` (esqueleto compartido), `tariffEntry`, `tariffReconciliation`. Filtra `INHERIT` aquí (R3, D3)                                                                                                                                                                                                                                                                                                                                                                                                                      | 1, 2, 4            |
| `src/features/sync/reconciliationHash.test.ts`             | Pruebas puras R3-R10 (paso 2), golden de R14 contra el vector de productos publicado, y el test del vector del tarifario leído del documento (paso 8)                                                                                                                                                                                                                                                                                                                                                                                                                         | 2, 4, 5            |
| `src/features/sync/contractVector.ts`                      | Lector único del bloque del contrato (paso 6): `readContract`, `extractVectorBlock`, `extractPublishedSha256` — copiado de `precedence.test.ts`, no lo refactoriza                                                                                                                                                                                                                                                                                                                                                                                                            | 5                  |
| `src/features/sync/server/reconciliation.ts`               | `storeReconciliationHash` devuelve `{products, hash, tariffs, tariffHash}` (paso 3): una resolución de sucursal, `Promise.all` de dos `findMany`, cero `$transaction`. `reconciliationEntry` intacta                                                                                                                                                                                                                                                                                                                                                                          | 1, 2, 3, 4         |
| `src/app/api/internal/reconciliation/route.test.ts`        | Actualizado a los cuatro campos con `toEqual` (I5, paso 4) + aserto del ORDEN de las claves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                  |
| `scripts/compute-tariff-vector.ts`                         | Guion nuevo (paso 5): imprime el vector **ejecutando** `tariffReconciliation` sobre las cinco filas de R12 (con `21`/`21.05` por PP1)                                                                                                                                                                                                                                                                                                                                                                                                                                         | 5                  |
| `package.json`                                             | `"vector:tariff": "tsx scripts/compute-tariff-vector.ts"` (paso 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 5                  |
| `docs/sync-contract.md`                                    | Las ocho ediciones del paso 7, en el orden de `architecture.md` § «El plan del contrato»: v13.4, párrafo de cambios, párrafo de publicación de la v13 (nombra `tariffs`/`tariffHash`), fila de § Endpoints, sección nueva de § ⑤ «El hash del tarifario de envío (v13.4)» con pseudocódigo/SQL espejo/5 decisiones/orden/precondición/qué prueba y qué no, `#### Vector del hash del tarifario (v13.4)` + su sha256 (calculado DESPUÉS de `npm run format`, orden (a)-(e)), la recuperación partida en dos («La divergencia del tarifario»), y la frase de la línea ~233 (I3) | 1, 5, 6            |
| `src/features/sync/server/reconciliationTariff.db.test.ts` | Archivo NUEVO (paso 9): dos `describe` — uno con `prisma.zoneTariff.create` directo (E2-E4, E9, E10, E13-E15b, E18) y otro con el `POST` real (E5-E8, E17)                                                                                                                                                                                                                                                                                                                                                                                                                    | 1, 2, 3, 4         |
| `scripts/check-reconciliation.mjs`                         | H1 (paso 10): `checkStore` valida las 4 claves y los dos hashes; `checkEmpty` compara clave a clave, no con `JSON.stringify`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                  |
| `src/lib/byteOrder.ts`                                     | Cabecera actualizada (paso 11): nombra las DOS ordenaciones de producción (productos y tarifario), ambas servidas hoy por `byteOrderedEntries()`                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| `.agent/progress/F-044.md`                                 | Criterios marcados con su comando (paso 12), los 7 completos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 7                  |
| `src/features/sync/server/reconciliation.db.test.ts`       | **Desviación autorizada del plan firmado (IP1 — ver abajo).** Dos líneas, no una: su literal de `toEqual` crece a las cuatro claves que `storeReconciliationHash()` ahora devuelve, y el espejo SQL de productos se compara explícitamente contra la mitad de productos, porque no calcula el tarifario                                                                                                                                                                                                                                                                       | 7                  |

## Desviaciones

**Ninguna respecto al ALCANCE del plan.** Dos desviaciones de implementación,
las dos anotadas; la primera ya venía decidida, la segunda la autorizó el
orquestador tras pararme en IP1 (ver más abajo, ya resuelta):

- **PP1 (ya decidida por el orquestador, ejecutada literalmente):** el vector
  del tarifario usa `21`/`21.05` en vez de `03`/`03.05`. Confirmado contra
  `src/features/zones/zone-index.json` antes de escribir el guion: `21`
  (Pinar del Río, `FIRST_LEVEL`) y `21.05` (La Palma, `MUNICIPALITY`,
  `provinceCode: "21"`) existen; el resto de la tabla de R12 (`23.01`,
  `23.05`, `40.01`) se dejó intacta.
- **IP1 (autorizada por el orquestador, 2026-09-10) — dos líneas de
  `src/features/sync/server/reconciliation.db.test.ts`, archivo que el plan
  marcaba «no tocar».** `storeReconciliationHash()` pasó a devolver cuatro
  claves (D3) y el test «C8: the SQL mirror agrees with
  storeReconciliationHash() on an empty store too» comparaba contra un
  literal de dos y, en la línea siguiente, contra el espejo SQL de productos
  (que solo calcula `products`/`hash`, nunca el tarifario). Las dos líneas
  se ajustaron al nuevo tamaño del objeto — sin relajar ningún `toEqual` a
  `toMatchObject` y sin tocar ninguna otra línea del archivo (`runMirrorSql`,
  el `describe` de C8/C9, los literales de `expectedEntry` y la comprobación
  de cordura de `EMPTY_HASH` quedan intactos: R14 sigue exactamente tan
  vigilada como antes). Motivo completo y las dos líneas exactas, en
  «Preguntas al humano» más abajo.

## Comandos ejecutados

- `npx tsc --noEmit -p .` → limpio, sin salida.
- `npm run lint` → 0 errores (1 warning preexistente y ajeno en
  `ProfileForm.tsx`, no tocado por este feature).
- `npm run format:check` → `All matched files use Prettier code style!`
  (tras `npx prettier --write` sobre los ocho archivos que este feature
  escribió/tocó; `docs/sync-contract.md` se formateó con el procedimiento
  copia-formatea-diffea — el único cambio fue el bloque JSON del vector
  colapsando el array `entries` a una línea, sin cambiar el valor parseado).
- `npx vitest run reconciliationHash --project server` → **20 passed**
  (incluye el golden de R14 y el vector leído del contrato, E15a/E16).
- `npx vitest run src/app/api/internal/reconciliation/route.test.ts --project server`
  → **7 passed** (I5, orden de claves incluido).
- `npm run vector:tariff` → imprime el JSON válido del vector (paso 5).
- `npx vitest run src/features/sync/server/reconciliationTariff.db.test.ts --project db`
  → **15 passed** (E2-E10, E13/E14, E15b, E17, E18).
- `bash .claude/hooks/sync-contract-version.sh` → exit 0.
- `npm test` (`vitest run`, los tres proyectos) → **1798 passed, 1 failed**.
  El único fallo: `src/features/sync/server/reconciliation.db.test.ts` línea
  193 (detalle en IP1). Ningún otro archivo del repo —incluidos
  `precedence.test.ts` y `zoneTariff.db.test.ts`, que no se tocaron— se movió.
- `bash .agent/verify.sh F-044` (antes de IP1) → salida 1 en la etapa `test`,
  firma `test:AssertionError: expected { products: +0, …(3) } to deeply equal { products: +0, …(1) }`.
  No fichada: no es una trampa del repo (ver el motivo del `dismiss` abajo).
- Aplicada la opción A de IP1: `npx vitest run
src/features/sync/server/reconciliation.db.test.ts --project db` →
  **5 passed** (las cinco, incluida C8).
- `npm test` (`vitest run`, los tres proyectos) tras IP1 → **1799 passed, 0
  failed**.
- `bash .agent/verify.sh F-044 --full` → **salida 0, PASA** (harness,
  typecheck, lint, format, test, prisma, build, theme, bundle — las nueve
  etapas en verde). Última línea: `PASA`.
- `bash .agent/verify.sh dismiss F-044 'test:AssertionError: expected { products: +0, …(3) } to deeply equal { products: +0, …(1) }' '…'`
  → descartada la firma de antes de IP1, con el motivo: no es una trampa del
  repo que vaya a repetirse en otro feature, fue una asunción sin ejecutar del
  plan firmado (`architecture.md` § D1 punto 3) que el orquestador ya
  resolvió con la opción A.

## Deuda dejada

Ninguna. IP1 (abajo) quedó resuelta y aplicada; los 12 pasos del plan están
completos, probados y `verify.sh F-044 --full` corrió hasta el final (código
de salida en «Comandos ejecutados»).

## Preguntas al humano

**IP1 — RESUELTA (opción A, orquestador, 2026-09-10).**
`src/features/sync/server/reconciliation.db.test.ts` (marcado explícitamente
«no tocar» en el encargo) tenía una aserción que el cambio de firma de
`storeReconciliationHash()` —exigido por `architecture.md` § D3, sin
alternativa dentro del plan firmado— rompía:

```ts
// src/features/sync/server/reconciliation.db.test.ts:193 (antes)
expect(fromFunction).toEqual({ products: 0, hash: EMPTY_HASH });
```

Paré antes de tocar ese archivo y devolví el control con tres opciones. El
orquestador respondió: sí, opción A, pero señaló que la desviación real son
**dos** líneas, no una — la 193 tapaba el fallo de la 196
(`expect(fromSql).toEqual(fromFunction)`, que compara el espejo SQL de
**productos** contra un objeto que ya trae dos claves de tarifario que ese
espejo nunca calculó). Aplicado tal cual lo autorizó, con comentario en las
dos líneas:

```ts
// src/features/sync/server/reconciliation.db.test.ts (después)
expect(fromFunction).toEqual({
  products: 0,
  hash: EMPTY_HASH,
  tariffs: 0,
  tariffHash: EMPTY_HASH,
});
const fromSql = await runMirrorSql(emptyStore.id, true);
expect(fromSql).toEqual({ products: fromFunction!.products, hash: fromFunction!.hash });
```

Nada más del archivo se tocó: `runMirrorSql`, el resto del `describe` de
C8/C9, los literales de `expectedEntry` y la comprobación de cordura de
`EMPTY_HASH` quedan exactamente como estaban — el guardián de R14 sigue
siendo el mismo guardián, solo que su literal de forma ahora describe la
forma real del objeto que vigila.

## Qué necesita quien pruebe

- **Entorno:** el mismo de siempre (`bash .agent/init.sh`), más Postgres local
  levantado (`DATABASE_URL` en `.env`, puerto 5433 en este árbol) para el
  proyecto `db`.
- **Rutas de ejemplo:**
  `GET /api/internal/reconciliation?storeId=seed-tienda-1` con
  `Authorization: Bearer <token de seed-negocio-1>` — la respuesta ahora trae
  `tariffs`/`tariffHash` además de `products`/`hash`. `seed-tienda-1` no tiene
  filas de `ZoneTariff` en el seed (`prisma/seed.ts` no siembra ninguna), así
  que hoy responde `tariffs: 0, tariffHash: "d41d8cd98f00b204e9800998ecf8427e"`
  siempre — para ver el hash moverse hace falta aplicar un `ZONE_TARIFF`
  primero (ver `scripts/check-reconciliation.mjs`, que todavía no tiene un
  modo `--tariff` propio: no lo pedía el plan).
- **Datos de prueba:** `src/features/sync/server/reconciliationTariff.db.test.ts`
  es el sitio con más escenarios ejecutables sin servidor levantado
  (`npx vitest run … --project db`).
- **Qué es frágil:** el vector de `docs/sync-contract.md` § ⑤ tiene su
  `sha256` calculado sobre bytes exactos — cualquier edición manual del
  bloque JSON sin recalcularlo (`npm run vector:tariff`, pegar, `npm run
format`, y SOLO ENTONCES el sha256) pone
  `reconciliationHash.test.ts` en rojo, a propósito.
- **Lo que sigue en el aire:** IP1, arriba. Nada más del plan depende de su
  resolución.
