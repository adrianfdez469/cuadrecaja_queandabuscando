---
feature: F-024
agente: sdd-implementer
actualizado: 2026-08-28T05:30:00Z
estado: listo
---

## Qué se construyó

| Archivo                                                            | Qué hace                                                                                                                                                                                     | Criterio que cubre |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `prisma/schema.prisma`                                             | Modelo `CanonicalBarcode` (`@@unique([canonicalProductId, ean])`, `@@index([ean])`, FK cascade, sin `businessId`); `barcodes CanonicalBarcode[]` en `CanonicalProduct`                       | C10                |
| `prisma/migrations/20260828045433_canonical_barcode/migration.sql` | DDL a mano (sin los `DROP INDEX` de los GIN que `migrate diff` propone) + backfill idempotente en el mismo archivo                                                                           | C10                |
| `src/lib/canonical.ts`                                             | `CanonicalIdentity` (antes `CanonicalResolution`), `CanonicalResolution` nuevo (`{ identity, barcodes }`), `normalizeBarcodes` nueva; `resolveCanonicalIdentity` recibe `barcodes: string[]` | C3, C5             |
| `src/lib/canonical.test.ts`                                        | E3/E6/E7/E8/E9/E13 unitarios, tres permutaciones → mismo `ean` (C5)                                                                                                                          | C3, C5             |
| `src/features/sync/schemas.ts`                                     | `barcodes: z.array(z.string())` obligatorio; `barcode: z.never({ error }).optional()` prohibido                                                                                              | C1                 |
| `src/app/api/internal/sync/catalog/route.test.ts`                  | E10 (`barcode` presente, incluso `null`), E11 (`barcodes` ausente), E12 (no-lista/no-texto), E9 (`[]` válido)                                                                                | C1                 |
| `src/constants/sync.ts`                                            | `CANONICAL_BARCODE_INSERT_CHUNK`                                                                                                                                                             | —                  |
| `src/features/sync/server/canonicalBarcodes.ts`                    | `recordCanonicalBarcodes` (createMany + skipDuplicates, sin `$transaction`), `countCanonicalBarcodeStats`, `formatCanonicalBarcodeStats`, `countCanonicalBarcodes` (nuevo, ver Desviaciones) | C2, C3, C6         |
| `src/features/sync/server/canonicalBarcodes.test.ts`               | `recordCanonicalBarcodes([])` no hace round trip; formato exacto de `formatCanonicalBarcodeStats`                                                                                            | —                  |
| `src/features/sync/server/handlers/product.ts`                     | `resolveCanonical` devuelve `{ canonicalId, barcodes }`; `recordCanonicalBarcodes` entre el `StoreProduct` y el alias (R10)                                                                  | C2, C3             |
| `src/features/sync/server/handlers/product.test.ts`                | Mock `canonicalBarcode.createMany`; orden storeProduct→barcode→alias; DELETE/stale/publishToStore:false/`[]` nunca llaman al writer                                                          | E14, E15           |
| `src/features/sync/server/handlers/product.db.test.ts`             | E1, E2, E3, E5, E7, E8, E13, E16 contra Postgres real; C1 "nada se escribe" vía `POST` real de la ruta                                                                                       | C1, C2, C3, C5     |
| `prisma/seed.ts`                                                   | `SeedProduct.extraEans`; `DEMO_PRODUCTS[0]` gana 2 códigos extra; `upsertCanonical` llama a `recordCanonicalBarcodes`; conteo `barcodes` en `Done:` vía `countCanonicalBarcodes`             | C9, E17            |
| `src/features/marketplace/server/dbFixtures.ts`                    | `createCanonical` acepta `extraEans` y llama a `recordCanonicalBarcodes`; comentario de `deriveEan` actualizado (I6)                                                                         | —                  |
| `scripts/send-catalog-batch.mjs`                                   | `barcodes: [...]` por defecto; `--singular-barcode` para demostrar el 400 a mano                                                                                                             | —                  |
| `src/app/api/internal/boundaries.test.ts`                          | G6 (la clave singular no vuelve fuera de un test/la declaración del schema) y G7 (un solo archivo toca `CanonicalBarcode`)                                                                   | C11                |
| `scripts/count-canonical-barcodes.ts`                              | Ejecutable de medición, calcado de `backfill-search-vector.ts`                                                                                                                               | C6                 |
| `package.json`                                                     | Alias `count:barcodes`                                                                                                                                                                       | C6                 |
| `docs/sync-contract.md`                                            | Sube a v4: § Cambios respecto a la v3, mapeo, `payload` de `PRODUCT`, transformación (paso 4 nuevo entre 3 y 5), tabla de errores, Modos de falla, Verificación                              | C7                 |

## Desviaciones

Ninguna respecto al plan firmado en las 7 etapas ni en su orden. Decisiones
tomadas dentro del margen que `architecture.md` dejó abierto:

- **`z.never({ error })` compiló sin problema en Zod 4.4.3** (`npm run
typecheck` limpio tras la etapa 3): se usó el plan A, no hizo falta el
  plan B (`z.never().optional()` a secas) que `architecture.md` § Riesgos
  dejó preparado.
- **`createMany({ skipDuplicates: true })` funcionó tal cual** con el driver
  adapter de Prisma 7 (`product.db.test.ts` E2/E3/E16 lo prueban contra
  Postgres real): no hizo falta el plan B de `$executeRaw` con
  `Prisma.sql`/`ON CONFLICT`.
- **Importar la ruta real (`POST` de `src/app/api/internal/sync/catalog/route.ts`)
  en el proyecto `db` funcionó sin problemas de contexto de Next**
  (`product.db.test.ts`, test "C1 (E10), through the real POST"): no hizo
  falta el plan B que `architecture.md` § Pruebas dejó anotado (afirmar solo
  sobre `catalogBatchSchema.safeParse`).
- **`countCanonicalBarcodes` (export nuevo, no descrito en `architecture.md`).**
  El diseño no anticipó que `prisma/seed.ts` necesitaría un conteo simple de
  la tabla para su línea `Done:`. Escribir `prisma.canonicalBarcode.count()`
  directamente en `seed.ts` habría hecho que dos archivos de producción
  tocaran el delegado, rompiendo la garantía de "un solo escritor" que
  `architecture.md` § Componentes exige (y que G7 verifica). Se añadió un
  export mínimo de una línea en `canonicalBarcodes.ts` en vez de eso — mismo
  patrón, ningún archivo nuevo, la garantía de G7 se sostiene tal cual está
  escrita.
- **Renombrado el parámetro `barcode` del helper interno `payload()` de
  `product.db.test.ts` a `ean`.** No estaba en el plan ni hacía falta para
  que los tests pasaran (el archivo es `.test.ts`, excluido del escaneo de
  G6), pero dejar un parámetro llamado `barcode: string` al lado de la
  prohibición de contrato que este mismo feature introduce era una fuente de
  confusión gratuita para quien lea el archivo después. Cambio mecánico, sin
  efecto en el comportamiento probado.
- **G6/G7 (`src/app/api/internal/boundaries.test.ts`) tuvieron que excluir
  `src/generated/**`.** El cliente de Prisma generado nombra el delegado
  `canonicalBarcode` como parte de su propia API tipada, así que un escaneo
  sin esa exclusión marcaba archivos generados como "ofensores" falsos. Se
  copió la misma exclusión que
  `src/features/marketplace/server/boundaries.test.ts` ya usa para G1/G2.
  También se excluyó `scripts/send-catalog-batch.mjs` de G6 (su
  `--singular-barcode` es deliberado, documentado en el propio script y en
  `docs/sync-contract.md` § Verificación) y `src/features/sync/schemas.ts`
  (la línea que declara la prohibición necesariamente nombra la clave).

## Comandos ejecutados

- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  → confirmó que el DDL de `CanonicalBarcode` es exactamente el de
  `architecture.md` y que el diff sigue proponiendo los dos `DROP INDEX` de
  los GIN no declarados (se omitieron a mano, como manda R12).
- `npx prisma migrate deploy` → aplicó `20260828045433_canonical_barcode`
  sin drift ni conflicto sobre la base local compartida.
- `npx prisma migrate status` → "Database schema is up to date!" tras
  terminar las 7 etapas.
- `npm run typecheck` → limpio en cada etapa desde la 3 en adelante (0
  errores al terminar; la lista de errores de la etapa 3 fue exactamente
  N3: `product.db.test.ts`, `product.test.ts`, `product.ts`).
- `npm run lint` → limpio.
- `npm run format:check` → limpio (tras `prettier --write` puntual sobre los
  archivos `.ts`/`.md` tocados, nunca `prettier --write .` completo).
- `npx vitest run --project server --project db` → 540 passed (53 archivos),
  0 fallos, tras terminar la etapa 5.
- `npm run seed` (×2, antes y ×2 después) → idempotente en las cuatro
  corridas; `canonical`/`products` invariantes entre antes y después (C9,
  E17); ver `.agent/specs/F-024/tests.md` para la salida literal.
- `npx tsx scripts/count-canonical-barcodes.ts` (y `npm run count:barcodes`)
  → exit 0, cinco cifras + histograma (C6); salida literal en `tests.md`.
- `bash .agent/verify.sh F-024` → PASA (typecheck·lint·format·test).
- `bash .agent/verify.sh F-024 --full` → PASA, nueve etapas en verde
  (harness·typecheck·lint·format·test·prisma·build·theme·bundle), exit 0.
- `npm run check:harness` → verde en cada punto de control.

## Deuda dejada

Ninguna deliberada. Todo lo del § Alcance/Dentro de `spec.md` está
implementado, incluida la "cola" del punto 8 (los nueve sitios que citaba
`spec.md` para migrar del `barcode` singular quedaron todos migrados; C11 lo
verifica con G6 + el propio compilador).

Una observación, no una deuda: la parte de C9 que pedía "los tres EAN
compartidos siguen dando un canónico cada uno **con dos** `StoreProduct`"
ya no da exactamente dos `StoreProduct` (da 3/2/4 según el EAN) —pero el
"un canónico cada uno" sí se sostiene, y la causa es la misma que I1 ya
documentó para el "17 de 20": F-017/F-018 añadieron más tiendas/fixtures que
comparten esos EAN, sin que este ciclo tocara ninguna asociación
tienda↔producto. Queda anotado con el detalle completo (consulta ejecutada
incluida) en `.agent/specs/F-024/tests.md` § C9 — DESPUÉS, para que
`sdd-tester` no lo redescubra como una regresión de F-024.

## Qué necesita quien pruebe

- **Entorno:** `docker exec queandabuscando-postgres` está arriba y sano
  (contenedor compartido entre worktrees, healthcheck OK); la migración
  `20260828045433_canonical_barcode` ya está aplicada
  (`npx prisma migrate status` → up to date). No hace falta `docker compose
up -d postgres`: ya estaba corriendo al empezar este ciclo.
- **Para C1 vía HTTP real:** `npm run dev` + token de `seed-negocio-1`
  acuñado (`npm run mint:token -- seed-negocio-1`), y
  `node scripts/send-catalog-batch.mjs --singular-barcode` debe responder
  `400 { "error": "INVALID_BATCH", "issues": [...] }`.
- **Para C6:** `npx tsx scripts/count-canonical-barcodes.ts` (o
  `npm run count:barcodes`) sobre la base ya sembrada. Las cifras 4 y 5
  (`...AcrossBusinesses`) van a dar `0` con los datos de desarrollo — es lo
  esperado (SP2), no un fallo.
- **Frágil, a tener en cuenta:** la base de Postgres local es compartida
  entre worktrees de este repo (`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`).
  La migración de este feature ya se aplicó desde este worktree; si otro
  worktree corre `prisma migrate dev` sobre la misma base y no tiene esta
  carpeta de migración en su propio `prisma/migrations/`, puede reportar
  drift — es el riesgo que `architecture.md` § Riesgos ya fichó como "se
  escala al humano si aparece", no algo que este ciclo pueda resolver desde
  aquí.
- **Los tres EAN compartidos del seed** (`7501031311309`, `7501000110018`,
  `7501000220017`) dan hoy 4/3/2 `StoreProduct` respectivamente, no 2 — ver
  § Deuda dejada arriba antes de marcar esto como hallazgo nuevo.

## Preguntas al humano

Ninguna. Las tres preguntas del ciclo (SP1, SP2, AP1) ya las resolvió el
humano antes de que empezara la implementación, y el plan firmado no dejó
ninguna decisión de alcance pendiente para esta etapa.
