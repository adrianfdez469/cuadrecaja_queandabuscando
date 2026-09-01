---
feature: F-032
agente: sdd-implementer
actualizado: 2026-09-01T22:00:00Z
estado: listo
---

## Qué se construyó

Pasos 1–13 del plan firmado. Ninguna migración, `processBatch.ts` intacto.

| Archivo                                                | Qué hace                                                                                                                                                              | Criterio que cubre |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/features/sync/schemas.ts`                         | Las cinco claves opcionales en `storePayloadSchema` (rangos y vocabulario del enum generado) + el `refine` de R10.1 → `STORE_DELIVERY_CONFIG_INCONSISTENT`            | 3, 4, 5            |
| `src/features/sync/schemas.test.ts` (nuevo)            | `safeParse` de los payloads de § DA5 y del payload v6 exacto (E1–E7, E14)                                                                                             | 3, 4, 5            |
| `src/constants/sync.ts`                                | `STORE_DELIVERY_CONFIG_INCONSISTENT`, el token único de error                                                                                                         | 5                  |
| `src/features/sync/server/storeConfig.ts` (nuevo)      | `STORE_CONFIG_KEYS`, `pickDefined`, `storeConfigWrite`, `effectiveDeliveryConfig`, `NEW_STORE_DELIVERY_BASELINE`                                                      | 1, 5               |
| `src/features/sync/server/storeConfig.test.ts` (nuevo) | ausente fuera / `null` dentro, mezcla con fila y sin fila, deriva de defaults contra `prisma/schema.prisma` en disco                                                  | 1, 10              |
| `src/features/orders/deliveryOffer.ts`                 | `isDeliveryConfigInconsistent`, escrita sobre `isDeliveryOffered`                                                                                                     | 5                  |
| `src/features/orders/deliveryOffer.test.ts`            | Tabla de verdad del invariante, con `deliveryFee: 0` válido                                                                                                           | 5                  |
| `src/features/sync/server/handlers/types.ts`           | `SyncEventFailure extends Error`                                                                                                                                      | 5                  |
| `src/features/sync/server/handlers/store.ts`           | +3 columnas en el `select`, `config` tras la guarda anti-rancio, `assertDeliveryConsistent` ×3 (cada una justo antes de su escritura), `...config` en los tres `data` | 1, 2, 5, 6, 15     |
| `src/features/sync/server/handlers/store.test.ts`      | E1, E3, E8, E9, E10, E11, E13 (criterio 15)                                                                                                                           | 15                 |
| `scripts/store-event.mjs` (nuevo)                      | `SEED_STORE_CONTACT`, `STORE_CONFIG_CASES` (13 presets), `buildStorePayload`/`buildStoreEvent`                                                                        | 1–6                |
| `scripts/send-catalog-batch.mjs`                       | `--store-config[=caso]`; STORE no se envía con `--unknown-store`                                                                                                      | 1, 2, 4, 5, 6      |
| `scripts/send-store-batch.mjs`                         | Importa `SEED_STORE_CONTACT` — deja de borrar contacto en cada ejecución (AP1)                                                                                        | —                  |
| `src/features/admin/server/boundaries.test.ts`         | Las cinco en `FORBIDDEN_WRITE_COLUMNS`                                                                                                                                | 7                  |
| `src/app/api/internal/boundaries.test.ts`              | `SEED_STORE_CONTACT` del fixture sigue en `prisma/seed.ts`, literal (R21)                                                                                             | —                  |
| `src/app/api/internal/sync/catalog/route.test.ts`      | El `400` es del lote entero (con un PRODUCT válido en el mismo lote); un STORE `failed` convive con un PRODUCT `processed` en el mismo `207`                          | 3, 4, 5            |
| `prisma/schema.prisma`                                 | Comentario `///` de `orderExpiryHours` — cita cuadrecaja y ADR 0028, ya no dice lo contrario                                                                          | 8                  |
| `docs/sync-contract.md`                                | v7: § «Cambios respecto a la v6», tabla ausente/`null`/valor, tabla de propiedad, ejemplo del riesgo 400, error por evento, § «Cambios requeridos en cuadrecaja»      | 9                  |
| `docs/despliegue.md`                                   | § 9.5 deja de mandar `UPDATE "Store"` a mano                                                                                                                          | 14                 |

## Desviaciones

1. **`StoreConfigWrite` no es `Partial<Pick<Prisma.StoreUpdateInput, StoreConfigColumn>>`
   como escribe architecture.md § DA3, sino `Partial<Pick<StorePayload, StoreConfigColumn>>`.**
   Comprobado con `npx tsc --noEmit` sobre un archivo de prueba (creado y
   borrado, mismo método que usó el arquitecto): la versión basada en
   `Prisma.StoreUpdateInput` **no compila** al esparcirse dentro del `store:`
   de `createStorefrontWithStore` — `StoreCreateData` rechaza la mitad
   `…FieldUpdateOperationsInput` de la unión que trae `StoreUpdateInput`
   (`Type 'EnumCheckoutModeFieldUpdateOperationsInput | CheckoutMode' is not
assignable to type 'CheckoutMode | undefined'`). La versión basada en
   `StorePayload` sí compila contra los dos destinos, sin `as` ni `any`, y es
   la que queda en `src/features/sync/server/storeConfig.ts`. El resto de la
   forma de DA3 (`pickDefined` genérico, `...config` de cuatro caracteres,
   `undefined` cae / `null` sobrevive) es exactamente lo que dice la
   arquitectura.
2. **`effectiveDeliveryConfig` no necesitó ningún `as`** gracias a la
   desviación 1: al ser `StoreConfigWrite` un `Partial<Pick<StorePayload,…>>`
   con tipos literales, comparar y asignar sus valores contra `DeliveryConfig`
   no exige ninguna aserción de tipo — más simple que lo que anticipaba
   architecture.md § Contratos internos, punto 3 (que sí preveía casts).
3. **La v7 de `docs/sync-contract.md` corrige también I1** (la frase que
   describía "omitir borra" para los campos de contacto y "omitir no toca"
   para el resto, sin distinguir cuáles son cuáles) en `§ payload de STORE`,
   tal como el plan lo deja señalado en § Riesgos ("esto corrige la prosa del
   contrato, no el comportamiento"). No es un paso nuevo: es parte del
   criterio 9/paso 12, y el plan lo anticipa explícitamente.
4. **`.agent/progress/F-032.md` recibió un `npx prettier --write`.** Antes de
   aplicarlo comprobé con `diff` contra una copia que el ÚNICO cambio era una
   línea en blanco insertada entre un párrafo y la lista que lo seguía sin
   separación (`Preguntas al humano, bloquean la firma del plan:` pegado a su
   `-`); ninguna palabra cambió de sentido. Es justo el procedimiento que pide
   la ficha `prettier-write-reescribe-prosa-ajena` («copia, formatea, diffea»),
   no una excepción a ella.

## Comandos ejecutados

- `bash .agent/verify.sh F-032` → `PASA` (typecheck · lint · format · test)
  en el último intento (intento 5 tras arreglar `format` dos veces: una vez
  por `schemas.ts` propio sin formatear, otra por la línea en blanco de
  `.agent/progress/F-032.md` — desviación 4).
- `bash .agent/verify.sh F-032 --full` → `PASA` — + harness · prisma · build · theme · bundle
- `bash .agent/verify.sh pending F-032` → vacío, código `0`.
- `npx vitest run` (repo completo) → **117 test files, 1141 tests, todos en
  verde**.
- `npx prisma validate` → schema válido.
- `npm run check:harness` → verde, 220 documentos.

## Deuda dejada

Ninguna. El paso 14 (verificación contra Postgres y el servidor de
desarrollo — criterios 1–6 y 10 con datos reales) es explícitamente de
`sdd-tester`, el siguiente ciclo, no de este.

## Qué necesita quien pruebe

- Servidor de desarrollo levantado (`npm run dev`) y un token acuñado para
  `seed-negocio-1` (ver AP2 del plan / la bitácora de F-032: este worktree
  tiene `QAB_BEARER_TOKEN` vacío; acuñar rota el token de la base
  **compartida** — ficha `mint-token-rota-el-token-en-bd-compartida`).
- **No ejecutar `npm run seed` entre el "antes" y el "después"** del
  criterio 1 (R16/I7): reescribe las cinco columnas y adelanta
  `sourceUpdatedAt`.
- El instrumento es `node scripts/send-catalog-batch.mjs` con
  `--store-config[=caso]`; los 13 presets (`all`, `partial`, `null-fee`,
  `null-mode`, `decimals`, `negative`, `hours-zero`, `hours-max`, `bad-mode`,
  `bad-checkout`, `contradictory`, `enable-only`, y el `none` implícito sin
  bandera) están en `scripts/store-event.mjs::STORE_CONFIG_CASES`.
- El caso E8 (criterio 5, `--store-config=enable-only`) exige una fila ya
  inconsistente a mano — `UPDATE "Store" SET "deliveryFeeMode" = 'FLAT_RATE',
"deliveryFee" = NULL WHERE slug = 'tienda-demo'` antes de enviar el evento —
  es montaje de prueba, no configuración de producto (§ Riesgos del plan lo
  señala explícitamente).
- `scripts/send-store-batch.mjs` ahora conserva `description`/`address`/
  `city`/`whatsapp` de `tienda-demo` en cada ejecución (antes los borraba,
  AP1) — si una prueba visual dependía de ese borrado por accidente, ya no
  ocurre.

## Preguntas al humano

Ninguna abierta. AP1 y AP2 del plan ya estaban resueltas antes de este
ciclo (AP1 en el paso 8, ejecutado; AP2 es del ciclo de `sdd-tester`).
