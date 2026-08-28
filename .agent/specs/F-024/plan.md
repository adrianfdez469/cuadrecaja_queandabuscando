---
feature: F-024
agente: orquestador
actualizado: 2026-08-28T04:51:53Z
estado: listo
aprobado: sí
---

## Qué se va a construir

El sincronizador de cuadrecaja va a poder enviar **todos** los códigos de
barras de un producto (`barcodes: string[]`), no solo uno: hoy, de tres
códigos que un negocio le pone a un producto, dos se pierden sin que nadie lo
note. Cada código válido que llegue se guarda contra el producto canónico del
marketplace, y queda una consulta que dice cuántos productos comparten códigos
entre distintos negocios — el número que decidirá, en otro feature futuro, si
hace falta construir el grafo de "productos emparentados" que motivó todo
esto. **La forma de fusionar productos duplicados entre negocios no cambia en
absoluto**: sigue siendo la de hoy, solo que ahora se decide mirando todos los
códigos y no uno al azar.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                                                        | Archivos                                                                                                                                                                          | Criterio que acerca     | Cómo se verifica                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modelo `CanonicalBarcode` en el schema, migración escrita a mano (con el `DROP INDEX` de los GIN quitado) y su backfill idempotente en el mismo archivo. `npx prisma generate` + `npx prisma migrate deploy` (nunca `migrate dev`, `migrate reset` ni `db push`)   | `prisma/schema.prisma`; `prisma/migrations/TIMESTAMP_canonical_barcode/migration.sql` (nuevo)                                                                                     | C10                     | La consulta de C10 (canónicos con `ean` sin fila en `CanonicalBarcode`) da `0`; `npx prisma migrate status` sin deriva                                   |
| 2   | `resolveCanonicalIdentity` recibe `barcodes: string[]` y devuelve `{ identity, barcodes }` normalizados/deduplicados/ordenados; `normalizeBarcodes` nuevo, puro                                                                                                    | `src/lib/canonical.ts`; `src/lib/canonical.test.ts`                                                                                                                               | C3, C5 (mitad unitaria) | `npx vitest run src/lib/canonical.test.ts`                                                                                                               |
| 3   | Contrato v4 en el schema Zod: `barcodes` obligatorio, `barcode` prohibido (`z.never().optional()` o equivalente, ver Riesgos)                                                                                                                                      | `src/features/sync/schemas.ts`; `src/app/api/internal/sync/catalog/route.test.ts`                                                                                                 | C1                      | `npx vitest run src/app/api/internal/sync/catalog/route.test.ts`; un lote con `barcode` responde `400 INVALID_BATCH` y no se llama `processCatalogBatch` |
| 4   | Escritor único `recordCanonicalBarcodes` (una sentencia, `createMany` + `skipDuplicates`, sin `$transaction`) enchufado en `handleProduct` entre el `StoreProduct` y el alias                                                                                      | `src/constants/sync.ts` (nuevo); `src/features/sync/server/canonicalBarcodes.ts` (nuevo); `src/features/sync/server/handlers/product.ts`; `product.test.ts`; `product.db.test.ts` | C2, C3 (mitad `db`)     | `npx vitest run --project db src/features/sync/server/handlers/product.db.test.ts` cubre E1, E2, E3, E5, E7, E8, E13, E16                                |
| 5   | La cola del corte de contrato: seed, fixtures de Postgres real y el script de smoke dejan de usar `barcode` singular; guardas G6/G7 nuevas. **Antes de tocar el seed, se anota la salida actual de `npm run seed` (conteos `canonical`/`products`) en `tests.md`** | `prisma/seed.ts`; `src/features/marketplace/server/dbFixtures.ts`; `scripts/send-catalog-batch.mjs`; `src/app/api/internal/boundaries.test.ts`                                    | C9, C11                 | `npm run seed && npm run seed` da los mismos conteos antes/después; `bash .agent/verify.sh F-024` (harness) en verde                                     |
| 6   | Ejecutable de medición del criterio 6, con sus dos consultas `Prisma.sql`                                                                                                                                                                                          | `scripts/count-canonical-barcodes.ts` (nuevo); `package.json` (alias `count:barcodes`)                                                                                            | C6                      | `npx tsx scripts/count-canonical-barcodes.ts` sale `0` e imprime las cinco cifras + histograma; salida pegada en `tests.md`                              |
| 7   | `docs/sync-contract.md` sube a v4 (mapeo, payload, transformación, tabla de errores, modos de falla); ADR 0020 ya aceptada                                                                                                                                         | `docs/sync-contract.md`                                                                                                                                                           | C7, C8                  | `bash .agent/verify.sh F-024 --full` en `0` (nueve etapas)                                                                                               |

## De dónde sale cada paso

- Paso 1 — `architecture.md` § Modelo de datos y migraciones, y § Etapas propuestas (etapa 1). R12/R13 de `spec.md`.
- Paso 2 — `architecture.md` § Contratos, `src/lib/canonical.ts` — firmas nuevas. R3/R4 de `spec.md`.
- Paso 3 — `architecture.md` § Contratos, `productPayloadSchema`. R1/R2 de `spec.md`; E10-E12.
- Paso 4 — `architecture.md` § El escritor, § Flujo de datos (paso 8 entre `StoreProduct` y alias). R6/R8/R10 de `spec.md`.
- Paso 5 — `architecture.md` § Qué cambia en los datos sembrados, y nota "el orden importa: C9 se mide antes de la etapa 5". SP1 resuelta por el humano (C9 es la forma verificable de C4).
- Paso 6 — `architecture.md` § La medición. SP2 resuelta por el humano (script + salida de desarrollo, sin preguntar a cuadrecaja).
- Paso 7 — `architecture.md` § Lo que hay que escribir en `docs/sync-contract.md`. AP1 resuelta por el humano (ADR 0020 aceptada).

## Qué queda fuera

- **Nodos concentradores, aristas entre canónicos y búsqueda en tres anillos.** Es el resto de `.agent/specs/propuestas/canonico-fusionado-por-ean-sucio.md` (puntos 3 y 4); se decide después, con el número del criterio 6 en la mano.
- **Cambiar cómo se fusionan productos duplicados.** `CanonicalProduct.ean` sigue siendo la clave única de fusión; F-002 y F-015 verificaron ese comportamiento y no se toca.
- **Atribuir cada código a un negocio** (`businessId` en `CanonicalBarcode`). El criterio 6 se responde con un JOIN a `StoreProduct`/`Store`, sin guardar quién aportó cada código.
- **Borrar códigos que el POS deja de enviar.** El almacenamiento es aditivo; nada limpia códigos rancios en este feature.
- **Buscar por código de barras**, y meter los códigos en `searchDocument`/`searchVector`. F-015 y F-021 no cambian.
- **UI.** Ni el panel ni la tienda pública muestran, editan o filtran códigos.
- **El lado de cuadrecaja.** Este feature documenta y recibe; implementar el envío es del POS, y por HD5 hoy no hay nada construido ahí.
- **Un tope al tamaño de la lista de códigos.** Se revisará junto con el tope de grado del grafo, no antes.
- **Preguntarle a cuadrecaja cuántos productos tienen más de un código hoy.** El humano decidió cerrar el criterio 6 solo con la salida de desarrollo (SP2).

## Riesgos y plan B

- **Cambio de contrato, no aditivo.** `barcode` deja de aceptarse; un lote v3 completo rebota con `400` hasta que el POS migre a v4. Aceptado porque HD5 (F-018): en cuadrecaja no hay nada desarrollado de esta integración todavía. Se documenta en `docs/sync-contract.md` § Modos de falla (paso 7). **Requiere aviso al equipo de cuadrecaja** cuando se publique — acción del humano, fuera del código (AGENTS.md § Documentación).
- **Migración de datos** (backfill de `CanonicalBarcode` desde `CanonicalProduct.ean`). Escrita a mano, idempotente, dentro de una transacción de Postgres (todo o nada). Se aplica con `npx prisma migrate deploy`, nunca `migrate dev`/`reset`/`db push` (prohibidos por `AGENTS.md`).
- **Riesgo alto: aplicar la migración desde este worktree puede dejar a otros worktrees con drift de `_prisma_migrations`** sobre la base local compartida. Ya está fichado (`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`) y **se escala al humano si aparece**, no se resuelve en silencio.
- **`prisma migrate diff` puede arrastrar el `DROP INDEX` de los dos índices GIN no declarados** (`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`). Plan B: revisar el `migration.sql` generado línea por línea antes de aplicarlo, y quitar esas sentencias si aparecen.
- **`z.never({ error })` podría no compilar en Zod 4.4.** Plan B: `z.never().optional()` a secas, con el mensaje documentado solo en el contrato.
- **El typecheck de la etapa 3 puede tumbar buena parte de la suite de golpe** (todos los fixtures que aún usan `barcode` singular). Es el efecto buscado: la lista de errores del compilador es la cola del corte de contrato: se recorre entera, no se silencia con `as`.

## Coste

- **7 etapas**, ejecutadas por `sdd-implementer` en orden (el orden importa en la etapa 5: el seed se mide _antes_ de tocarlo). Estimado en 1-2 ciclos de implementación más `sdd-tester` para el veredicto final.
- **Toca código de cuatro features ya verificados** sin cambiar su comportamiento: F-002 (el seed), F-005 (la resolución de identidad), F-006 (mismo handler), F-015 (nada de `searchDocument`/`searchVector`, solo linda con el escritor). Ninguno de sus `acceptance_criteria` se modifica (regla 3); C9 es la prueba de que su comportamiento sigue intacto.
- **Migración aditiva** sobre la base compartida: una tabla nueva, cero columnas quitadas, cero datos reescritos. Revertir significaría un `DROP TABLE "CanonicalBarcode"` y deshacer los cinco puntos del código — no hay pérdida de datos existentes si se revierte, porque nada existente se modifica.
- **Cambio de contrato no reversible sin aviso**: si se necesitara volver a `barcode` singular, habría que otra vez coordinar con cuadrecaja (que hoy no tiene nada construido, así que el costo de revertir es bajo mientras siga así).

## Preguntas antes de aprobar

Ninguna. Las tres que existían (SP1, SP2 de `spec.md`; AP1 de `architecture.md`) ya las resolvió el humano:

- **SP1** → C4 se cierra con C9 (invariancia de la fusión antes/después del cambio en el seed), no con el número literal "17 de 20" que ya había caducado por F-017/F-018.
- **SP2** → C6 se cierra con el script de medición y su salida de desarrollo anotada en `tests.md`, sin preguntarle a cuadrecaja.
- **AP1** → ADR 0020 aceptada (`docs/adr/0020-todos-los-codigos-una-sola-fusion.md`, estado "Aceptada · 28 de agosto de 2026 · F-024").

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-XXX '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-28T04:51:53Z — aprobado por el humano: «Apruebo el plan»
