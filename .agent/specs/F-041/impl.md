---
feature: F-041
agente: sdd-implementer
actualizado: 2026-09-09T05:00:00Z
estado: listo
---

## Qué se construyó

Pasos 1-15 del plan firmado, en ese orden. El paso 16 (los siete ficheros de
test nuevos) es de `sdd-tester` y no se escribió aquí — sí se tocaron los
tests existentes que los pasos 7 y 14 nombran, más un puñado de tests
existentes que las decisiones del propio plan (I4, R22(b), SP3) dejaban en
rojo por razones reales, no accidentales (ver § Desviaciones).

| Archivo                                                                      | Qué hace                                                                                                                                                                       | Paso / criterio          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `src/features/zones/zone-index.json`                                         | El artefacto: 184 filas (16 primer nivel + 168 municipio), extraído del PDF del Codificador (zlib + `Tm`/`Td`) y unido contra Overpass (183 relaciones)                        | 1 / C11, C16, C17        |
| `src/features/zones/zone-index.provenance.md`                                | Procedencia: URL del Archive, sha256 del PDF, recuentos, consulta de Overpass, la errata de Santiago de Cuba citada                                                            | 1 / C17                  |
| `src/features/zones/zone-index.join-report.md`                               | Informe de la unión: las 9 filas `34.01`-`34.09` con su código impreso, las 4 filas que necesitaron emparejamiento manual                                                      | 1 / C17                  |
| `.prettierignore`                                                            | `zone-index.json` excluido, con el motivo (Prettier le cambiaría el sha256)                                                                                                    | 1                        |
| `src/lib/money.ts`                                                           | `toDecimalString(value: MoneyInput): string`, reutilizando `parseToMinor`/`minorToString`                                                                                      | 2 / C2, C5               |
| `src/features/zones/catalog.ts`                                              | `findZone`, `isKnownZoneCode`, `isRetiredZone`, `ZONE_INDEX_VERSION`, `ZONE_INDEX_COUNTS`, `ZONE_CODE_PATTERN` — sin `fs`, sin Prisma                                          | 3 / C6, C9, C16          |
| `eslint.config.mjs`                                                          | `no-restricted-imports` para `src/components/**`/`src/app/**/*.tsx` contra `@/features/zones/catalog` y el JSON                                                                | 3                        |
| `src/features/zones/precedence.ts`                                           | `resolveZoneTariff(zone, rows)`: importe, `decidedBy`, camino completo, las tres guardas de R27                                                                                | 4 / C1, C7               |
| `scripts/compute-zone-vector.ts`                                             | Los 13 casos (V1-V10, G1-G3), ejecutando la función pura — nunca transcritos                                                                                                   | 5 / C1, C13              |
| `package.json`                                                               | `seed:zones`, `vector:zones`                                                                                                                                                   | 5, 8                     |
| `prisma/schema.prisma`                                                       | `DeliveryFeeMode.ZONE_BASED`, `SyncEntity.ZONE_TARIFF`, enums `ZoneLevel`/`ZoneTariffRule`, modelos `Zone`/`ZoneCatalogVersion`/`ZoneTariff`, `Store.zoneCode`                 | 6 / C10                  |
| `prisma/migrations/20260909012319_zone_shipping/migration.sql`               | La migración medida por `architecture.md`: sin `DROP INDEX` (no aplica, diff limpio), aplicada con `migrate deploy`                                                            | 6 / C10                  |
| `src/features/sync/fieldOwnership.test.ts`                                   | `Store 31`→`32` en los dos asertos, «54 rows»→«55»                                                                                                                             | 7 / C10                  |
| `docs/sync-contract.md`                                                      | Los tres sitios (`:517`, `:1198`, `:1203`→ahora reubicados) `31`→`32`, `54`→`55`, y la fila `zoneCode` en la tabla de propiedad                                                | 7 / C10                  |
| `src/features/zones/server/catalogSeed.ts`                                   | `seedZoneCatalog(db)` — un `INSERT … ON CONFLICT DO UPDATE` (`$executeRaw`+`Prisma.sql`/`Prisma.join`), `readAppliedZoneCatalogVersion(db)`                                    | 8 / C11                  |
| `scripts/seed-zone-catalog.ts`                                               | El punto de entrada de producción                                                                                                                                              | 8 / C11                  |
| `prisma/seed.ts`                                                             | Llama a `seedZoneCatalog(prisma)` primero, incondicional                                                                                                                       | 8 / C11                  |
| `docs/despliegue.md`                                                         | § 1: el paso `npm run seed:zones`, a mano, una vez por entorno                                                                                                                 | 8 / C11                  |
| `src/features/orders/deliveryOffer.ts`                                       | `DeliveryFeeModeName` del enum generado; `hasSomethingToChargeDeliveryWith`/`isDeliveryOffered` separadas; `deliveryFeeForNewOrder` con rama `ZONE_BASED` que lanza            | 9 / C10, SP2             |
| `src/features/orders/types.ts`                                               | `QuoteStore.deliveryFeeMode: DeliveryFeeModeName` (desviación, ver abajo)                                                                                                      | 9 (extra)                |
| `src/features/orders/server/createOrder.test.ts`                             | Fixture del `store` gana `deliveryFeeMode: "FLAT_RATE"` explícito (desviación, ver abajo)                                                                                      | 9 (extra)                |
| `src/constants/sync.ts`                                                      | `ZONE_TARIFF_ZONE_UNKNOWN`, `ZONE_TARIFF_FEE_NOT_ALLOWED`, `ZONE_TARIFF_DELETE_NOT_SUPPORTED`, `STORE_ZONE_UNKNOWN`                                                            | 10 / C3, C6, C9          |
| `src/features/sync/schemas.ts`                                               | `zoneTariffPayloadSchema` (`discriminatedUnion` por `rule`), séptima rama de `syncEventSchema`, `zoneCode` en `storePayloadSchema`                                             | 10 / C3, C6, C9          |
| `src/features/sync/server/handlers/zoneTariff.ts`                            | El handler: DELETE primero, sucursal en una consulta, guarda `>=`, upsert, `touchedStoreSlug`                                                                                  | 11 / C2, C4, C5, C7, C12 |
| `src/features/sync/server/processBatch.ts`                                   | Séptimo `case` de `applyEvent`                                                                                                                                                 | 11                       |
| `src/features/sync/dependencies.ts`                                          | `STORE` pasa a proveer `STORE:<storeId>`; `ZONE_TARIFF` lo requiere                                                                                                            | 11 / SP3                 |
| `src/features/sync/dependencies.test.ts`                                     | El test de `STORE` reescrito para su nuevo rol (desviación, ver abajo)                                                                                                         | 11 (extra)               |
| `src/features/sync/server/storeConfig.ts`                                    | `zoneCode` entra en `STORE_CONFIG_KEYS`                                                                                                                                        | 12 / C9                  |
| `src/features/sync/server/handlers/store.ts`                                 | `assertZoneKnown` en las tres posiciones; `zoneTariff.deleteMany` en el `DELETE` aplicado                                                                                      | 12 / C8, C9              |
| `src/features/sync/server/handlers/store.test.ts`                            | Mock de `prisma.zoneTariff.deleteMany` (desviación, ver abajo)                                                                                                                 | 12 (extra)               |
| `src/features/zones/server/tariffs.ts`                                       | `resolveStoreZoneTariff(db, storeId, zoneCode)`: `findZone` + ≤2 filas + `resolveZoneTariff`                                                                                   | 13 / C7                  |
| `src/features/sync/schemas.test.ts`                                          | El test de «entidad que el contrato no define» reapuntado a `ORDER` (I13)                                                                                                      | 14 / I13                 |
| `src/features/sync/server/handlers/business.db.test.ts`                      | Ídem, su C2 reapuntado a `ORDER`                                                                                                                                               | 14 / I13                 |
| `src/features/admin/server/boundaries.test.ts`                               | `zoneCode` en `FORBIDDEN_WRITE_COLUMNS`                                                                                                                                        | 14                       |
| `docs/sync-contract.md`                                                      | v13 completa: cabecera, § «Cambios respecto a la v12.2» (entidad, precedencia con letra, vector JSON, cascada, versión del catálogo), tabla de errores, § «Cambios requeridos» | 15 / C13                 |
| `docs/adr/0032-catalogo-de-zonas-bytes-commiteados-y-la-base-como-espejo.md` | ADR nueva                                                                                                                                                                      | 15                       |
| `docs/adr/0033-cobrar-el-domicilio-y-ofrecerlo-son-dos-preguntas.md`         | ADR nueva, estrecha 0028 (e)                                                                                                                                                   | 15                       |
| `docs/adr/0028-configuracion-de-compra-del-pos.md`                           | Línea «superada en (e) por la 0033»                                                                                                                                            | 15                       |
| `AGENTS.md`                                                                  | La guarda que rechaza pasa de 4 a 5 entidades; línea sobre la cascada `STORE`→`ZONE_TARIFF`                                                                                    | 15 / I11                 |
| `.agent/solicitudes.md`                                                      | Línea fechada 2026-09-09 en S-007: el borrador salió                                                                                                                           | 15                       |

## Desviaciones

Ninguna del **plan firmado** en sí — los 15 pasos se implementaron tal como
están escritos. Lo que sigue son archivos que el plan no nombraba
explícitamente y que hubo que tocar para que el propio cambio que el plan
**sí** pedía no dejara el árbol roto:

1. **`src/features/orders/types.ts`** (paso 9). `QuoteStore.deliveryFeeMode`
   era una tercera unión escrita a mano (`"FLAT_RATE" | "QUOTED_PER_ORDER"`),
   además de la de `deliveryOffer.ts` que I4 ya nombraba. `npm run typecheck`
   la señaló en cuanto `DeliveryFeeMode` ganó `ZONE_BASED`: se cambió a
   `DeliveryFeeModeName` (`import type`), la misma solución que I4 aplica en
   `deliveryOffer.ts`, cero bytes nuevos en cliente.
2. **`src/features/orders/server/createOrder.test.ts`** (paso 9). El fixture
   compartido `store` nunca declaraba `deliveryFeeMode` (confiaba en que el
   `if (mode === "QUOTED_PER_ORDER")` de la versión vieja de
   `isDeliveryOffered` cayera en el `else` con cualquier valor, incluido
   `undefined`). El `switch` exhaustivo de la nueva versión lanza sobre
   `undefined` — correctamente: es el mismo guardián que detectaría un modo
   real sin case. Se añadió `deliveryFeeMode: "FLAT_RATE" as const` al
   fixture, que es el valor implícito que el comportamiento viejo ya asumía.
3. **`src/features/sync/dependencies.test.ts`** (paso 11). El test
   `"a STORE neither provides nor requires anything"` afirmaba justo lo que
   SP3/R23 decide cambiar. Se reescribió para afirmar lo nuevo
   (`provides: "STORE:ext-store-1"`), con el motivo en el propio `it`.
4. **`src/features/sync/server/handlers/store.test.ts`** (paso 12). El mock
   de `@/lib/prisma` no incluía `zoneTariff`, así que el `deleteMany` nuevo
   del `DELETE` aplicado (R22(b)) fallaba con `Cannot read properties of
undefined`. Se añadió el mock y su reset en `beforeEach`.

Las cuatro son consecuencia directa y prevista de decisiones que el plan **sí**
pedía (I4, SP3, R22(b)) — ningún archivo de estos cambia de comportamiento por
una decisión mía; todos dejan de mentir sobre un comportamiento que el propio
plan ya había decidido cambiar. Ninguna toca un `acceptance_criteria` (regla 3) ni añade alcance.

**El paso 1 usa `34.01`-`34.09` (no `32.01`-`32.09`) para Santiago de Cuba**,
citando la errata — es la decisión del humano, no una desviación.

**El código del vector (Contratos 6, `architecture.md`) usa `"1"` como
`version` del bloque JSON**, tal como fija esa sección — no confundir con la
`ZONE_INDEX_VERSION` del artefacto (`"1.0.0"`), que es un número distinto con
un propósito distinto.

## Comandos ejecutados

- `npx tsc --noEmit` → limpio, cero errores.
- `npx eslint .` (vía `npm run lint`) → limpio.
- `npm run format:check` → limpio (formateado con `npm run format` solo lo
  escrito en este ciclo, diffeado antes de aceptar — ninguna línea cambió de
  sentido).
- `npm test` → **1563 passed** (146 test files), incluidos los proyectos
  `server` y `db` contra Postgres real.
- `npx prisma migrate deploy` → aplicó `20260909012319_zone_shipping` limpio.
- `git diff main --stat -- prisma/migrations` → solo el fichero nuevo
  (untracked); `git diff main -- prisma/schema.prisma` → 106 inserciones, cero
  borrados (playbook `prisma-migrate-diff-nunca-da-cero-por-indices-no-declarados`).
- `npx tsx scripts/seed-zone-catalog.ts` × 2 → las dos veces `zoneCount: 184`,
  misma `version`/`sha256`; verificado con una consulta directa: `total: 184,
fl: 16, mu: 168`, una sola fila en `ZoneCatalogVersion`.
- `npx tsx scripts/compute-zone-vector.ts` → los 13 casos, cotejados a mano
  contra la tabla de `spec.md` § «El vector de precedencia»: los 13 coinciden.
- `bash .agent/verify.sh F-041 --full` → **PASA** (harness, typecheck, lint,
  format, test, prisma, build, theme, bundle).
- `npm run check:harness` → verde tras corregir una ruta abreviada en
  `.agent/progress/F-041.md` (decía handlers/store.ts, a secas, y pasó a
  `src/features/sync/server/handlers/store.ts`;
  ficha `check-harness-falso-positivo-ruta-abreviada`).

## Deuda dejada

- **`scripts/send-catalog-batch.mjs --zone-tariff`** no se añadió: ningún
  criterio lo exige (§ «No decidido a propósito», punto 5 de `spec.md`) y el
  paso 16 de `sdd-tester` no lo necesita para sus tests contra Postgres real.
- **El paso 16** (los siete ficheros de test) no está escrito — es
  explícitamente de `sdd-tester`.
- **Publicar la v13** espera el visto bueno de cuadrecaja (criterio 13,
  decisión del humano). Este ciclo solo escribió el borrador.

## Qué necesita quien pruebe

- Postgres local levantado (`docker-compose.yml`, puerto 5433) y migrado:
  `npx prisma migrate deploy` ya aplicó `20260909012319_zone_shipping` en la
  base compartida de este árbol.
- El catálogo ya está sembrado en esa base (184/16/168, versión `1.0.0`) por
  las ejecuciones de verificación de este ciclo — `npm run seed` (que ahora
  también siembra zonas primero) sigue siendo idempotente si hace falta
  repetirlo.
- El vector se recalcula con `npm run vector:zones`; el bloque que hay ahora
  en `docs/sync-contract.md` § «Vector de precedencia de ZONE_TARIFF (v13)» es
  exactamente su salida.
- `src/features/zones/precedence.ts`, `src/features/zones/catalog.ts` y
  `src/features/zones/server/tariffs.ts` son las piezas que el paso 16 va a
  testear; ninguna tiene test propio todavía.

## Preguntas al humano

Ninguna nueva: las ocho decisiones que el plan necesitaba ya estaban resueltas
antes de empezar a implementar (`spec.md` §§ SP1-SP4, `architecture.md` §§
AP1-AP4).

## Paso 17 — cerrar la coordinación con cuadrecaja (2026-09-09)

El plan se amplió con este paso el 2026-09-09, tras el veredicto de
cuadrecaja sobre el borrador de la v13 («OK a la forma, condicionado a nueve
puntos», en `.agents/solicitudes-qab.md` de su repositorio, § S-007). El
humano ya había triado los nueve puntos antes de este paso: los puntos 1 y 2
pasan a **F-043**/**F-044** (no tocados aquí), el núcleo del punto 4 y los
puntos 3 y 5 ya estaban resueltos por el borrador que sus revisores leyeron
antes de que existiera. Lo que quedaba para este paso eran los puntos 6, 7 y
9, más los cinco menores.

| Qué se hizo                                                                                                                                                                                                        | Archivo                                                                                                          | Punto de S-007        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| Publicado el sha256 del bloque JSON del vector, con el alcance exacto de qué bytes cubre (el mismo grupo 1 que ya captura `precedence.test.ts`)                                                                    | `docs/sync-contract.md` § «El hash del bloque JSON de arriba»                                                    | 6                     |
| Añadida la comprobación del hash al test que ya lee el bloque — recalcula sobre los mismos bytes y compara contra la línea publicada                                                                               | `src/features/zones/precedence.test.ts`                                                                          | 6                     |
| Clasificados los cuatro códigos de error nuevos como permanente/reintentable, en la tabla del vocabulario y en el comentario de cada constante                                                                     | `docs/sync-contract.md` §§ «Vocabulario de errores», «Los tres códigos de error nuevos»; `src/constants/sync.ts` | 9                     |
| Respuesta al P7: `ZONE_BASED` + `deliveryFee` puesto se acepta, se guarda y se ignora (leído de `deliveryOffer.ts`/`schemas.ts`, no supuesto); tarifario vacío es legal (SP2) con letra; pie de plomo de F-016     | `docs/sync-contract.md` § «Respuesta al P7 de S-007»                                                             | 7                     |
| Confirmado ejecutando que un `ZONE_TARIFF` con `storeId` de otro negocio es indistinguible de uno inexistente (`skipped_not_published`, cero filas)                                                                | `docs/sync-contract.md` § «La entidad `ZONE_TARIFF`»                                                             | menor 4               |
| `contact.zoneCode`/`zoneName` opcional-u-obligatorio, y provincia-o-municipio: dejados explícitamente reservados para F-042, no contestados aquí                                                                   | `docs/sync-contract.md` § «Lo que la v13 reserva para F-042»                                                     | menores 2 y 3         |
| Desranciado § «Lo que NO entra en la v11…»: el selector jerárquico/mapa diferido, el `400` indiferenciado y el «repetir el patrón» de `displayCurrencies` marcados `SUPERADO`, con lo que sí se decidió y su fecha | `docs/sync-contract.md` § «Lo que NO entra en la v11, y está en conversación»                                    | menor 5               |
| `ZONE_TARIFF.deliveryFee` «mismas reglas que `STORE.deliveryFee`» — verificado que ya estaba escrito desde el paso 15; ningún cambio hecho                                                                         | (sin cambio; ya en `docs/sync-contract.md` § «`payload` de `ZONE_TARIFF`»)                                       | menor 1 (ya resuelto) |

**Lo que NO se tocó, deliberadamente:** el `400` de `ZONE_TARIFF_ZONE_UNKNOWN`
(criterio 6, corrige F-043), la reconciliación del tarifario (F-044), la
generalización del punto 4 (`parentCode`, cadena de padres, tercer nivel), la
publicación de la v13 (sigue en «BORRADOR, sin publicar») y los siete tests
del paso 16.

**Cómo se verificó cada afirmación de letra, no se dio por sabida:**

- El comportamiento de `ZONE_BASED` + `deliveryFee` se confirmó leyendo
  `storePayloadSchema.refine` y `hasSomethingToChargeDeliveryWith`, y además
  ejecutando un evento real contra Postgres (`207 processed`, columna
  `deliveryFee: "500"` escrita, ningún camino de precio la lee) — el test
  ad hoc se borró tras confirmar, no es parte del árbol.
- El `storeId` de otro negocio en `ZONE_TARIFF` se confirmó ejecutando dos
  sesiones de fixture reales: `207` con `skipped_not_published`, cero filas
  en `ZoneTariff` de la tienda ajena — mismo resultado que E11 (inexistente).
  Test ad hoc también borrado tras confirmar.
- El hash sha256 se calculó con `node -e` usando el MISMO regex que
  `precedence.test.ts` ya usa para extraer el bloque, y se verificó con
  `shasum -a 256` de forma independiente — coinciden. Se probó además que
  mutar un valor del vector sin tocar el hash pone la prueba nueva en rojo
  (`Expected … Received …`), y se restauró el fichero después.

## Comandos ejecutados (paso 17)

- `bash .agent/verify.sh F-041` → **PASA** tras `npm run format` sobre
  `docs/sync-contract.md` y `.agent/features.json` (ficha
  `prettier-sin-formatear`; diff revisado línea a línea, solo relleno de
  columnas de tabla y colapso de un array de una línea en JSON — ningún
  sentido cambiado).
- `bash .agent/verify.sh F-041 --full` → **PASA** (harness, typecheck, lint,
  format, test, prisma, build, theme, bundle).
- `npm test` → **1658 passed** (153 test files) — el +1 sobre el recuento
  del paso 16 es exactamente la prueba nueva del hash.
