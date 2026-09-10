---
feature: F-041
agente: sdd-architect
actualizado: 2026-09-08T21:30:02Z
estado: listo
---

> **SUPERADO EN PARTE POR F-043 (2026-09-10).** Todo lo que este documento dice
> sobre el `400` de lote por una zona desconocida —el diagrama de secuencia, la
> fila `ZONE_TARIFF_ZONE_UNKNOWN` de la tabla de códigos y la asimetría que
> **I6** decidió conservar a propósito— ya **no describe lo que existe**. F-043
> movió esa comprobación del **sobre** al **aplicador**: hoy es `failed[]` de
> ese evento, y la asimetría de I6 quedó cerrada, no conservada. La
> arquitectura viva de este camino es `.agent/specs/F-043/architecture.md`, y
> el sensor que impide que el `.refine` vuelva al sobre es la lista blanca de
> `src/features/zones/boundaries.test.ts`. El resto de este documento —la
> entidad, la precedencia, el catálogo, la cascada `STORE → ZONE_TARIFF`— sigue
> vigente tal cual.
>
> Sobre `.agent/specs/F-041/spec.md` (`estado: listo`, 22 escenarios, 29 reglas,
> 16 casos límite, 12 incongruencias). Esta arquitectura **cierra las tres cosas
> que la spec le reservó** en su § «No decidido a propósito» —los nombres, dónde
> viven los bytes del índice y cómo se normaliza el importe— y **no reabre**
> ninguna de las ocho decisiones del humano del 2026-09-08.
>
> Convención de este documento: un archivo que **ya existe** va entre comillas
> invertidas; uno que **se va a crear** va sin comillas y con «(por crear)»
> detrás (AGENTS.md § Cosas que muerden, la trampa de `check:harness` que ya
> mordió en F-011 y F-017).

## Estado actual relevante

Leído en el código, no supuesto. Lo que se reutiliza tal cual y lo que hay que
tocar:

| Pieza                                                                        | Qué es hoy                                                                                         | Qué hace F-041                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `prisma/schema.prisma:44-47`                                                 | `enum DeliveryFeeMode { FLAT_RATE, QUOTED_PER_ORDER }`                                             | Gana `ZONE_BASED` (`ALTER TYPE … ADD VALUE`)                |
| `prisma/schema.prisma:89-96`                                                 | `enum SyncEntity`, seis valores                                                                    | Gana `ZONE_TARIFF` (sin él `recordBatch` no registra)       |
| `prisma/schema.prisma:241-332`                                               | `model Store`, **31** columnas contadas                                                            | Gana `zoneCode` → 32                                        |
| `src/features/sync/schemas.ts:149-192`                                       | `syncEventSchema`, unión discriminada de seis ramas                                                | Séptima rama, `zoneTariffPayloadSchema`                     |
| `src/features/sync/schemas.ts:24-76`                                         | `storePayloadSchema` con el `refine` de F-032                                                      | Gana `zoneCode` opcional (`nullish`)                        |
| `src/features/sync/server/processBatch.ts:160-179`                           | `applyEvent`, `switch` **sin `default`** sobre seis entidades                                      | Séptimo `case`                                              |
| `src/features/sync/dependencies.ts:51-79`                                    | `dependencyRoleOf` con `never` que **nombra** la entidad; `STORE` no provee clave                  | `STORE` **provee**, `ZONE_TARIFF` **requiere** (SP3)        |
| `src/features/sync/server/handlers/business.ts:63-68`                        | El precedente exacto del `DELETE` rechazado **antes** de la guarda anti-rancio                     | Se calca para `ZONE_TARIFF` (R20)                           |
| `src/features/sync/server/handlers/product.ts:75`                            | `if (!store \|\| store.businessId !== businessId) return SKIPPED`                                  | Se calca (R24)                                              |
| `src/features/sync/server/handlers/store.ts:135,200,246`                     | `assertDeliveryConsistent` llamado **tres veces**, cada una justo antes de su escritura            | El mismo patrón para `assertZoneKnown` (R18)                |
| `src/features/sync/server/handlers/store.ts:124-127`                         | Un `STORE` `DELETE` **suspende**, no borra (I1)                                                    | En ese camino se borran las filas del tarifario (R22 b)     |
| `src/features/sync/server/storeConfig.ts:13-53`                              | `STORE_CONFIG_KEYS` + `pickDefined`: «omitir no es apagar» escrito **una** vez                     | `zoneCode` entra en la lista y hereda la semántica (R29)    |
| `src/features/orders/deliveryOffer.ts:15`                                    | `DeliveryFeeModeName`, unión de **dos literales escrita a mano**                                   | Sale del enum generado, con `import type` (I4)              |
| `src/features/orders/deliveryOffer.ts:31-44`                                 | `isDeliveryConfigInconsistent = enabled && !isDeliveryOffered`                                     | Se **desacopla** en dos preguntas (R12/R13)                 |
| `src/lib/money.ts:35-62`                                                     | `parseToMinor`/`minorToString`: la aritmética de BigInt, **privada**                               | Se expone un normalizador que la reutiliza                  |
| `src/lib/cache.ts:79-91`, `processBatch.ts:132-143`                          | La invalidación, una vez por lote, con el slug **canónico**                                        | Cero líneas nuevas: el handler solo **reporta** (R25)       |
| `src/features/sync/fieldOwnership.test.ts:141-145`                           | `Store 31` y las filas del contrato, clavados a mano                                               | 32 en los cinco sitios (I5)                                 |
| `src/features/sync/server/processBatch.test.ts:33-44`                        | Un `vi.mock` por módulo de handler                                                                 | Uno más (I12)                                               |
| `src/features/sync/server/canonicalBarcodes.ts:18`                           | `Pick<PrismaClient, "canonicalBarcode">`: el cliente que sirve al app **y** al de `prisma/seed.ts` | El sembrador del catálogo usa el mismo truco (I8)           |
| `src/lib/publicSlug.ts:31-38`                                                | `canonicalSlug`, que **lanza** si una sucursal de marca multi-sucursal no tiene slug               | Se llama **solo** en el camino que escribe (caso límite 11) |
| `prisma/migrations/20260908013319_business_display_currencies/migration.sql` | El precedente literal de `ALTER TYPE … ADD VALUE` junto a un `ALTER TABLE`                         | La migración de F-041 tiene esa forma                       |

Y lo que **no** existe y hay que crear entero: cualquier tabla de zonas, el
artefacto del índice, la entidad del sobre, la resolución por precedencia y su
vector.

## Decisión

**Un dominio nuevo, `src/features/zones/`, con tres piezas de vidas separadas
—el índice (bytes), la precedencia (función pura) y la base (espejo + escritura)—
y el sync tocado en los cinco sitios que ya son costura**: `schemas.ts`,
`dependencies.ts`, `applyEvent`, un handler nuevo y
`src/features/sync/server/handlers/store.ts`.

Las tres cosas que la spec reservó, cerradas:

**(1) Los nombres.** Modelos `Zone`, `ZoneTariff` y `ZoneCatalogVersion`; enums
`ZoneLevel { FIRST_LEVEL, MUNICIPALITY }` y
`ZoneTariffRule { FEE, NOT_SERVED, INHERIT }`; columna `Store.zoneCode`; valores
nuevos `DeliveryFeeMode.ZONE_BASED` y `SyncEntity.ZONE_TARIFF`. Descartados:
`GeoZone` (no hay geometría aquí y la habrá en F-042 sin cambiar de tabla),
`StoreZoneFee` (el nombre del cable es `ZONE_TARIFF` y el modelo no debe
divergir de él) y `ZoneTariffRule.SERVED` (dos banderas que pueden
contradecirse, lo que el acuerdo mató).

**(2) Dónde viven los bytes.** Un único fichero JSON commiteado,
src/features/zones/zone-index.json (por crear), importado **estáticamente** por
src/features/zones/catalog.ts (por crear), que no toca `fs`, no toca Prisma y
expone un `Map` de 184 entradas. El schema del sobre lo importa como módulo, sin
base de datos —que es lo que hace alcanzable el `400` del criterio 6 (I7)— y
**nada del árbol de cliente lo importa**, garantizado por una regla de ESLint y
un test de importadores, no por el presupuesto de bundle (§ Escalabilidad, punto
6). Descartados: una carpeta `data/` en la raíz (rompe la tabla de capas de
AGENTS.md y obliga a un import relativo fuera de `src/`), un `src/data/` nuevo
(misma objeción), leer el fichero con `readFileSync` en tiempo de petición (no
sobrevive al empaquetado de una ruta serverless y añade E/S a cada lote) y
guardar el índice **solo** en Postgres (mata el criterio 6, I7).

**(3) Cómo se normaliza el importe.** `src/lib/money.ts` **no** gana una segunda
aritmética: gana **una** exportación, `toDecimalString(value: MoneyInput):
string`, que llama a las `parseToMinor`/`minorToString` que ya están escritas
—las mismas que produce `money().amount`— sin inventar una moneda para un importe
que, por R16, no lleva ninguna. Es la respuesta al bug fichado en la propia spec:
`String(300)` da `"300"`, `toDecimalString(300)` da `"300.00"`
(`src/features/sync/server/storeConfig.ts:68-77` documenta ese mismo error).
Descartados: `money(fee, ANCHOR_CURRENCY).amount` (inventa `CUP` en un dominio
que no habla de monedas), `toFixed(2)` (coma flotante, el fallo que
`src/lib/money.ts:1-13` existe para no repetir) y una función nueva en el módulo
de zonas (la segunda aritmética que se prohíbe explícitamente).

Y la forma general, que es lo que sostiene todo lo demás: **el artefacto es la
autoridad y la base es su espejo.** El schema valida contra los bytes; las tablas
existen para la integridad referencial (`ZoneTariff.zoneCode`, `Store.zoneCode`)
y para que una persona pueda consultar el catálogo con SQL. Cuando los dos
difieren —alguien migró sin sembrar— gana el artefacto en la validación y la
clave ajena falla el evento en `failed[]`, nunca en `400` (caso límite 15). La
alternativa —validar contra la base— cuesta una consulta por evento y **no puede
producir el `400` de lote** que el criterio 6 exige.

## Componentes

Las capas son las de AGENTS.md § Arquitectura. Ninguna pieza rompe la tabla: lo
único que toca Prisma vive en un `server/`.

| Componente                     | Capa                                 | Responsabilidad                                                                                                                                 | Archivo                                                         |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Índice del catálogo            | artefacto (datos)                    | 184 filas `code → nombre, nivel, provincia, id y nombre de OSM, retirado`, con su versión y su recuento. **Bytes commiteados** (R8)             | src/features/zones/zone-index.json (por crear)                  |
| Procedencia                    | documentación                        | Edición del DPA con su URL del Archive, recuentos, consulta de OSM, filas dudosas, hash y fecha, y la frase «este artefacto no lleva geometría» | src/features/zones/zone-index.provenance.md (por crear)         |
| Informe de la unión            | documentación                        | Cada código sin relación y cada relación sin código, y la errata de Santiago de Cuba citada (R6, C17)                                           | src/features/zones/zone-index.join-report.md (por crear)        |
| Lector del índice              | `src/features/zones/`                | `findZone`, `isKnownZoneCode`, `isRetiredZone`, `ZONE_INDEX_VERSION`, `ZONE_INDEX_COUNTS`. Sin `fs`, sin Prisma, sin React                      | src/features/zones/catalog.ts (por crear)                       |
| Precedencia                    | `src/features/zones/`                | `resolveZoneTariff(zone, rows)`: importe, fila decisoria y **camino completo**. Pura, sin catálogo y sin base (R26, R27)                        | src/features/zones/precedence.ts (por crear)                    |
| Normalizador de importe        | `src/lib/`                           | `toDecimalString`, reutilizando la aritmética de BigInt que ya existe                                                                           | `src/lib/money.ts`                                              |
| Siembra del catálogo           | `src/features/zones/server/`         | `seedZoneCatalog(db)` idempotente en **un** statement + `readAppliedZoneCatalogVersion(db)` (una consulta)                                      | src/features/zones/server/catalogSeed.ts (por crear)            |
| Lector mínimo del tarifario    | `src/features/zones/server/`         | Carga las ≤2 filas de un `(store, zoneCode)` y llama a la función pura (alcance 9)                                                              | src/features/zones/server/tariffs.ts (por crear)                |
| Handler de `ZONE_TARIFF`       | `src/features/sync/server/handlers/` | Rechaza el `DELETE`, resuelve la sucursal, guarda con guarda anti-rancio y **reporta** el slug canónico                                         | src/features/sync/server/handlers/zoneTariff.ts (por crear)     |
| Séptima rama del sobre         | `src/features/sync/`                 | `zoneTariffPayloadSchema` (unión discriminada por `rule`) + la rama de `syncEventSchema` + `zoneCode` en `storePayloadSchema`                   | `src/features/sync/schemas.ts`                                  |
| Cascada intra-lote             | `src/features/sync/`                 | `STORE` **provee** `STORE:<storeId>`, `ZONE_TARIFF` lo **requiere** (SP3/R23)                                                                   | `src/features/sync/dependencies.ts`                             |
| Despachador                    | `src/features/sync/server/`          | El séptimo `case` de `applyEvent`                                                                                                               | `src/features/sync/server/processBatch.ts`                      |
| Guarda de zona en `STORE`      | `src/features/sync/server/handlers/` | `assertZoneKnown`, en las **tres** llamadas que ya usa `assertDeliveryConsistent`; y el borrado del tarifario en el `DELETE` aplicado           | `src/features/sync/server/handlers/store.ts`                    |
| Códigos de error               | `src/constants/`                     | Los cuatro nuevos, con su comentario, en la forma de los que ya viven ahí                                                                       | `src/constants/sync.ts`                                         |
| Vocabulario del envío          | `src/features/orders/`               | `DeliveryFeeModeName` desde el enum; `hasSomethingToChargeDeliveryWith` y `isDeliveryOffered` como **dos** funciones con `switch` exhaustivo    | `src/features/orders/deliveryOffer.ts`                          |
| Punto de entrada de producción | `scripts/`                           | Siembra el catálogo sin arrastrar el seed de desarrollo (I8), con su línea en `docs/despliegue.md` § 1                                          | scripts/seed-zone-catalog.ts (por crear)                        |
| Calculadora del vector         | `scripts/`                           | Ejecuta la función pura sobre el fixture y emite el bloque JSON que se pega en el contrato (C13: calculado ejecutando, no transcrito)           | scripts/compute-zone-vector.ts (por crear)                      |
| Migración                      | `prisma/migrations/`                 | Dos `ALTER TYPE … ADD VALUE`, dos `CREATE TYPE`, tres `CREATE TABLE`, una columna y sus claves ajenas                                           | prisma/migrations/<ts>\_zone_shipping/migration.sql (por crear) |

Y los tests, que son de `sdd-tester` pero cuyo sitio decide esta arquitectura
porque de él depende en qué proyecto de Vitest corren
(`vitest.config.mts`: `*.test.ts` → `server`, `*.db.test.ts` → `db`):

| Test                                                                | Proyecto | Qué cierra                                                        |
| ------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| src/features/zones/precedence.test.ts (por crear)                   | server   | C1/E20: lee el bloque JSON de `docs/sync-contract.md` y ejecuta   |
| src/features/zones/catalog.test.ts (por crear)                      | server   | C16/E22: 184/16/168, sin duplicados, 183 ids, sha256 vs. contrato |
| src/features/zones/boundaries.test.ts (por crear)                   | server   | Que nadie del árbol de cliente importe el índice                  |
| src/features/sync/server/handlers/zoneTariff.test.ts (por crear)    | server   | El orden de las comprobaciones del handler, con Prisma mockeado   |
| src/features/sync/server/handlers/zoneTariff.db.test.ts (por crear) | db       | C2, C4, C5, C6, C12 a través del `POST` real                      |
| src/features/zones/server/tariffs.db.test.ts (por crear)            | db       | C7: filas reales de la base entrando en la función pura           |
| src/features/zones/server/catalogSeed.db.test.ts (por crear)        | db       | C11: sembrar dos veces, 184 filas y la misma versión              |

## Flujo de datos

### A. Un `ZONE_TARIFF` entra por el sobre

```mermaid
sequenceDiagram
  participant POS as cuadrecaja
  participant R as route.ts
  participant S as schemas.ts
  participant P as processBatch
  participant H as handlers/zoneTariff
  participant DB as Postgres
  POS->>R: POST /api/internal/sync/catalog (bearer)
  R->>S: catalogBatchSchema.safeParse
  S->>S: rule discrimina; zoneCode contra el ÍNDICE (cero consultas)
  S-->>R: 400 INVALID_BATCH si falla (sin SyncEvent)
  R->>P: processCatalogBatch(caller, events)
  P->>DB: recordBatch (SyncEntity.ZONE_TARIFF)
  P->>P: blockedBy: ¿falló su STORE en este lote?
  P->>H: handleZoneTariff(payload, operation, businessId)
  H->>H: 1. operation === DELETE → SyncEventFailure (cero consultas)
  H->>DB: 2. store.findUnique(externalId) + su fila de (storeId, zoneCode)
  H-->>P: SKIPPED si la sucursal no es de este negocio
  H->>H: 3. guarda anti-rancio (>=) → STALE
  H->>DB: 4. upsert de la fila + sourceUpdatedAt
  H-->>P: processed + touchedStoreSlug (canónico)
  P->>P: revalidateStores(set) — UNA vez por lote
```

Los cuatro pasos del handler van **en ese orden y no en otro**, y cada uno tiene
su razón escrita:

1. **`DELETE` primero, antes de cualquier ida a la base** (R20). Es el orden de
   `src/features/sync/server/handlers/business.ts:63-68` y el **opuesto** al de
   `handleCategory` (`src/features/sync/server/handlers/misc.ts:115-140`): un
   error de forma no puede depender de una marca de tiempo (E5). Y cierra de raíz
   el agujero de la resurrección: si nunca se borra una fila, nunca falta la
   marca contra la que comparar.
2. **La sucursal, en una sola consulta**, con su fila del tarifario anidada
   (`select: { …, zoneTariffs: { where: { zoneCode } } }`). `SKIPPED` cuando no
   existe o es de otro negocio, calcado de
   `src/features/sync/server/handlers/product.ts:75`; viaja en `ok` porque es
   terminal (R24).
3. **La guarda que RECHAZA** (`>=` → `STALE`), no la de orden de
   `EXCHANGE_RATE`: esta tabla no es append-only y su histórico no es el producto
   (R21, `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`).
4. **El upsert**, y solo entonces el slug canónico. En los caminos `SKIPPED`,
   `STALE` y de fallo **no se llama a `canonicalSlug`**: además de no invalidar
   nada (R25), esa función **lanza** si una sucursal de marca multi-sucursal no
   tiene slug propio (`src/lib/publicSlug.ts:33-37`), y un evento descartado no
   puede convertirse en un `failed` por eso (caso límite 11).

El aviso de zona retirada (R19/E10) se emite **en el paso 2**, con
`console.warn("[sync] …")` y nunca `console.error`
(AGENTS.md § Cosas que muerden, ficha
`.agent/playbook/console-error-dispara-guardian-servidor.md`), leyendo `retiredAt`
del **índice** y no de la base: cero consultas.

### B. Un `STORE` trae `zoneCode`

`zoneCode` entra en `STORE_CONFIG_KEYS` (`src/features/sync/server/storeConfig.ts:13-19`),
así que hereda `pickDefined` sin escribir un `if` nuevo: ausente no entra en el
objeto de escritura, `null` sí pasa y borra (R29, ADR 0028 (d)). `assertZoneKnown`
se llama en las **tres** posiciones exactas en que ya se llama
`assertDeliveryConsistent` —`src/features/sync/server/handlers/store.ts:135`
(despublicar, que **sí** configura), `:200` (crear) y `:246` (actualizar)—, nunca
una vez al principio de la función: hacerlo arriba convertiría los `SKIPPED` y
`STALE` de más arriba en fallos, que es exactamente lo que el comentario de
`:242-245` explica. El evento falla entero, con `STORE_ZONE_UNKNOWN`, y
`sourceUpdatedAt` no avanza (R18, E16): hereda la trampa de `openingHours` y se
acepta por la misma razón.

En el mismo archivo, la mitad (b) de R22: en la rama `!optIn` y **solo cuando
`operation === "DELETE"`**, después del `store.update` que ya se hace,
`prisma.zoneTariff.deleteMany({ where: { storeId: existing.id } })`. Un
`publishToStore: false` con `UPDATE` —vacaciones— **no** borra nada: es
reversible y el tarifario tiene que estar ahí al reabrir. Un `DELETE` que sale
`STALE` o `SKIPPED` tampoco, porque el borrado vive en el camino que escribe
(caso límite 13).

### C. La resolución (el lector mínimo)

```
resolveStoreZoneTariff(storeId, zoneCode)
  ├─ findZone(zoneCode)                 ← ÍNDICE, cero consultas: level y provinceCode
  │    └─ null → la zona no existe en el catálogo publicado (el llamador decide)
  ├─ prisma.zoneTariff.findMany({ where: { storeId, zoneCode: { in: [code, provinceCode] } } })
  │    └─ UNA consulta, como máximo DOS filas, por la clave primaria
  └─ resolveZoneTariff(zone, rows)      ← función PURA, sin base y sin catálogo
       └─ { served, deliveryFee: "300.00" | null, decidedBy, path }
```

El nivel y la provincia salen del **índice**, no de la tabla `Zone`: es lo que
hace que la resolución cueste **una** consulta en vez de dos y lo que mantiene la
función pura alineada con el vector, cuyo `zone` va **declarado en el fixture**
(§ El vector). La tabla `Zone` no participa en ninguna lectura del camino
caliente.

Los escalones, con el nivel **declarado** decidiendo cuántos hay (R3, R26):

- `MUNICIPALITY`: su fila → la fila de su `provinceCode` → no servida. Si
  `provinceCode` es `null`, un solo escalón (caso límite 7).
- `FIRST_LEVEL`: su fila → no servida. **Ni mira `provinceCode`**, aunque lo
  traiga: es el caso V10 y el patrón de la Isla de la Juventud. Ninguna función de
  este feature mira la **forma** del código para decidir nada.

Las tres guardas de R27, todas dentro de la función pura y todas en el mismo
sitio, para que no puedan divergir:

1. `FEE` sin importe (`null`/`undefined`) → **no decide**, `FEE_WITHOUT_AMOUNT`
   en el camino, y cae al escalón de arriba.
2. `FEE` con `0` → **decide**, `"0.00"`, envío gratis. La comprobación es
   `fee === null || fee === undefined`, **jamás** `!fee`; las dos formas correctas
   ya están al lado en `src/features/orders/deliveryOffer.ts:34,63`.
3. `FEE` negativo → **no decide**, `FEE_NEGATIVE`. Se detecta sobre la cadena ya
   normalizada (`toDecimalString(fee).startsWith("-")`), que es una sola lectura
   numérica y ninguna comparación en coma flotante.

### D. La siembra

`seedZoneCatalog(db)` hace **una** lectura del fichero con `fs` (en el sembrador,
nunca en `catalog.ts`) y **hashea y parsea los mismos bytes**, así que el sha256
anotado en `ZoneCatalogVersion` es siempre el del contenido que se sembró.
Escribe en **un** statement (§ Modelo de datos) y anota la versión con un
`upsert` por `version`. Se llama desde dos sitios (I8): `prisma/seed.ts` —para
que la doble ejecución del CI (`.github/workflows/ci.yml:63-66`) sea la
comprobación de idempotencia que pide el criterio 11— y scripts/seed-zone-catalog.ts
(por crear), que es el camino de producción y lleva su línea en
`docs/despliegue.md` § 1.

## Contratos

### 1. El vocabulario del envío, partido en dos (I4, R12, R13)

`src/features/orders/deliveryOffer.ts` es un módulo **puro que el checkout de
cliente importa** (`src/features/cart/components/CheckoutForm.tsx:31`), así que
todo lo que se le añada pesa en el bundle. Lo que cambia:

```ts
// Antes: una unión de dos literales escrita a mano (I4).
// Ahora: el enum generado, con `import type` — se borra al compilar, así que
// añade CERO bytes al árbol de cliente y no puede quedarse corta otra vez.
import type { DeliveryFeeMode } from "@/generated/prisma/enums";
export type DeliveryFeeModeName = DeliveryFeeMode;

/** R12 — «¿esta configuración tiene con qué cobrar el domicilio?».
 *  La pregunta del SYNC. En ZONE_BASED la respuesta es SÍ y no está en la
 *  fila: está en el tarifario, que llega por otra entidad y puede cambiar sin
 *  ningún evento STORE. */
export function hasSomethingToChargeDeliveryWith(config: DeliveryConfig): boolean {
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return config.deliveryFee !== null;
    case "QUOTED_PER_ORDER":
      return true;
    case "ZONE_BASED":
      return true;
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`hasSomethingToChargeDeliveryWith: unhandled mode ${String(exhaustive)}`);
    }
  }
}

/** R13 — «¿se le puede ofrecer domicilio a este comprador AHORA MISMO?».
 *  La pregunta del COMPRADOR. En ZONE_BASED, hasta F-042, la respuesta honesta
 *  es NO: no hay selector, así que no hay zona que resolver. F-042 sustituye
 *  esta línea por su criterio 9 («¿tiene esta tienda alguna zona con tarifa
 *  resoluble?»). */
export function isDeliveryOffered(config: DeliveryConfig): boolean {
  if (!config.deliveryEnabled) return false;
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return config.deliveryFee !== null;
    case "QUOTED_PER_ORDER":
      return true;
    case "ZONE_BASED":
      return false; // R13 — F-042 lo cambia por la pregunta de verdad
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`isDeliveryOffered: unhandled mode ${String(exhaustive)}`);
    }
  }
}

/** F-032 R8: el estado que el sync no debe escribir nunca. Ahora en términos
 *  de la pregunta de la CONFIGURACIÓN, no de la del comprador — que es el
 *  desacoplamiento entero de I4. */
export function isDeliveryConfigInconsistent(config: DeliveryConfig): boolean {
  return config.deliveryEnabled && !hasSomethingToChargeDeliveryWith(config);
}
```

Los dos `switch` **repiten** las ramas `FLAT_RATE` y `QUOTED_PER_ORDER` a
propósito: son dos preguntas distintas que hoy coinciden en dos de los tres
modos, y escribir una en términos de la otra es exactamente el atajo que hizo
imposible este feature (la DA1 de F-031 lo anticipó y se equivocó en la
dirección). El `default` con `never` es lo que pone en rojo `npm run typecheck`
—nombrando el modo— el día que aparezca un cuarto, en vez de caer en una rama por
defecto.

`deliveryFeeForNewOrder` gana un `switch` con la misma forma, y su rama
`ZONE_BASED` con `fulfillment: "DELIVERY"` **lanza**: es inalcanzable por
construcción —`createOrder` decide `isDelivery` con `isDeliveryOffered`, que en
`ZONE_BASED` devuelve `false`, y pasa `"PICKUP"`
(`src/features/orders/server/createOrder.ts:181-186`)—, y si alguna vez se
alcanzara, un 500 visible es preferible a cobrar `0.00` de envío en silencio, que
es lo que E17 prohíbe. Alternativa descartada: devolver `"0.00"`, que es
literalmente el importe que la spec dice que no se puede cobrar.

### 2. El payload de `ZONE_TARIFF` (Zod)

```ts
// src/features/zones/catalog.ts (por crear) — sin base de datos (I7)
export const ZONE_CODE_PATTERN = /^\d{2}(\.\d{2})?$/;

// src/features/sync/schemas.ts
const zoneCodeSchema = z
  .string()
  .regex(ZONE_CODE_PATTERN)
  .refine(isKnownZoneCode, { error: ZONE_TARIFF_ZONE_UNKNOWN });

export const zoneTariffPayloadSchema = z.discriminatedUnion("rule", [
  z.object({
    storeId: z.string().min(1),
    zoneCode: zoneCodeSchema,
    rule: z.literal("FEE"),
    // R16: mismo dominio y misma forma que el de STORE (schemas.ts:58).
    // OBLIGATORIO aquí, y `nonnegative()` es la mitad de la guarda 3 de R27.
    deliveryFee: z.number().nonnegative().multipleOf(0.01).max(999999999999.99),
    updatedAt: isoDate,
  }),
  z.object({
    storeId: z.string().min(1),
    zoneCode: zoneCodeSchema,
    rule: z.literal("NOT_SERVED"),
    // PROHIBIDO, no ignorado: presente —incluido `null` explícito— es 400.
    // Precedente literal: `barcode` (schemas.ts:99-101).
    deliveryFee: z.never({ error: ZONE_TARIFF_FEE_NOT_ALLOWED }).optional(),
    updatedAt: isoDate,
  }),
  z.object({
    storeId: z.string().min(1),
    zoneCode: zoneCodeSchema,
    rule: z.literal("INHERIT"),
    deliveryFee: z.never({ error: ZONE_TARIFF_FEE_NOT_ALLOWED }).optional(),
    updatedAt: isoDate,
  }),
]);

export type ZoneTariffPayload = z.infer<typeof zoneTariffPayloadSchema>;
```

Tres decisiones de forma en esas veinte líneas:

- **`discriminatedUnion` sobre `rule`, no un `object` con un `refine`.** Un
  `refine` produce un solo mensaje para dos errores distintos y deja
  `deliveryFee` opcional en el tipo inferido, con lo que el handler tendría que
  volver a comprobar lo que el schema ya sabía. Con la unión, `rule: "FEE"`
  **implica** `deliveryFee: number` en TypeScript, y ese es el sentido entero de
  R15: un discriminante que no puede contradecirse consigo mismo.
- **`z.never().optional()` para prohibir la clave**, no omitirla: Zod descarta en
  silencio las claves desconocidas, así que omitirla no produciría el `issue` que
  el criterio 3 exige (es el mismo razonamiento que el comentario de
  `src/features/sync/schemas.ts:96-98`). `deliveryFee: null` tampoco es
  `undefined`, así que también falla — que es lo que E7 pide con esas palabras.
- **`ZONE_TARIFF_FEE_NOT_ALLOWED` es un mensaje de `issue`, no un código del
  vocabulario del contrato.** Los tres códigos que el POS compara byte a byte
  siguen siendo los de la tabla de abajo; este texto viaja dentro de
  `issues[].message` del `400` y existe para que el otro equipo lea en el cuerpo
  cuál de las dos mitades de R15 rompió, en vez de un `invalid_type` de Zod.
  Nombrarlo en `src/constants/sync.ts` junto a los otros es lo que impide que se
  escriba dos veces distinto.

La rama del sobre, séptima de `syncEventSchema`, es idéntica en forma a las seis
existentes (`eventId`, `entity: z.literal("ZONE_TARIFF")`, `operation`,
`occurredAt`, `payload`). **Sin `businessId`**: la identidad la da el token, y por
eso este payload no entra en el recorrido de `findCatalogMismatch`
(`src/features/sync/identity.ts:26-32`, que solo mira los payloads que llevan la
clave) — el handler valida la pertenencia igual, como `handleProduct`.

Y en `storePayloadSchema`, una línea:

```ts
/** F-041 R29: «omitir no es apagar» (ADR 0028 (d)) — ausente deja la columna
 *  intacta, `null` explícito la borra. NO entra en la familia de los nueve
 *  campos de contacto, donde ausente borra. Validado contra el catálogo en el
 *  HANDLER (STORE_ZONE_UNKNOWN, failed[] de ESE evento), no aquí: un 400 de
 *  lote por la zona de una tienda se llevaría los otros 499 eventos (I6). */
zoneCode: z.string().regex(ZONE_CODE_PATTERN).nullish(),
```

### 3. La resolución (tipos de la función pura)

```ts
// src/features/zones/precedence.ts (por crear)
import type { ZoneLevel, ZoneTariffRule } from "@/generated/prisma/enums";

/** Lo que la resolución necesita saber de la zona consultada: DECLARADO,
 *  nunca deducido del código (R3). En el vector viaja en el fixture; en
 *  producción lo da el índice. */
export type ZoneRef = { code: string; level: ZoneLevel; provinceCode: string | null };

/** Una fila del tarifario, en la forma del payload (importe como número) o de
 *  la base (Decimal): `MoneyInput` acepta las dos sin convertir en el llamador. */
export type TariffRow = { zoneCode: string; rule: ZoneTariffRule; deliveryFee?: MoneyInput | null };

export type PathVerdict =
  "FEE" | "FEE_WITHOUT_AMOUNT" | "FEE_NEGATIVE" | "NOT_SERVED" | "INHERIT" | "ABSENT";

/** Un escalón CONSULTADO. Uno que no se consultó no aparece (R28). */
export type PathStep = { code: string; level: ZoneLevel; verdict: PathVerdict; decides: boolean };

export type ZoneTariffResolution = {
  served: boolean;
  /** Cadena de dos decimales producida por `toDecimalString` (`src/lib/money.ts`),
   *  nunca un número en coma flotante y nunca `String(300)`. */
  deliveryFee: string | null;
  /** El `code` de la fila que decidió, o `null` cuando NADA decidió — lo que
   *  distingue «hay una fila que dice que no sirvo» de «no hay nada en ningún
   *  nivel» (R28, E13). */
  decidedBy: string | null;
  path: readonly PathStep[];
};

export function resolveZoneTariff(zone: ZoneRef, rows: readonly TariffRow[]): ZoneTariffResolution;
```

`ZoneLevel` y `ZoneTariffRule` entran con `import type` del enum generado: cero
bytes en cliente, un solo vocabulario y la lección de I4 aplicada de antemano —en
este módulo **no** se escribe a mano ninguna unión de literales.

### 4. Tabla de errores

| Código                             | Dónde se decide                                                       | Respuesta        | Qué NO ocurre                                                              |
| ---------------------------------- | --------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `ZONE_TARIFF_ZONE_UNKNOWN`         | schema del sobre, contra el índice (cero consultas)                   | `400` de lote    | No se escribe `SyncEvent`, no se aplica ningún otro evento del lote        |
| `ZONE_TARIFF_FEE_NOT_ALLOWED`      | schema del sobre (`z.never`)                                          | `400` de lote    | Ídem. Viaja en `issues[].message`, no en el vocabulario del contrato       |
| `ZONE_TARIFF_DELETE_NOT_SUPPORTED` | handler, **lo primero**, antes de la guarda                           | `207` `failed[]` | Cero consultas, cero filas tocadas, la marca de origen no se mueve         |
| `STORE_ZONE_UNKNOWN`               | `src/features/sync/server/handlers/store.ts`, antes de cada escritura | `207` `failed[]` | Ninguno de los campos de ese evento se aplica; `sourceUpdatedAt` no avanza |
| `DEPENDENCY_FAILED_IN_BATCH`       | `processBatch.ts:84-93`, ya escrito                                   | `207` `failed[]` | **No hay código nuevo**: se reutiliza tal cual (R23)                       |

Los **cuatro** códigos nuevos van a `src/constants/sync.ts` con su comentario,
en la misma forma que los que ya viven ahí. Pero al **vocabulario de errores del
contrato** solo suben **tres** —`ZONE_TARIFF_ZONE_UNKNOWN`,
`ZONE_TARIFF_DELETE_NOT_SUPPORTED` y `STORE_ZONE_UNKNOWN`—, que son los que la
spec enumera y los que el POS compara byte a byte contra § «Vocabulario de
errores»; `ZONE_TARIFF_FEE_NOT_ALLOWED` vive dentro de `issues[].message` de un
`400` y se documenta con el ejemplo del cuerpo, no como código propio.

### 5. La cascada intra-lote (SP3/R23)

```ts
// src/features/sync/dependencies.ts
export type DependencySource = Extract<SyncEventInput["entity"], "CATEGORY" | "CURRENCY" | "STORE">;

case "STORE":
  // F-041 SP3/R23: pasa a PROVEER. Su clave es el `storeId` del payload — el
  // externalId del POS, que es lo que el ZONE_TARIFF trae también, así que la
  // comparación es byte a byte sin resolver nada contra la base (R7 de F-037).
  return { provides: `STORE:${event.payload.storeId}`, requires: null };
case "ZONE_TARIFF":
  return { provides: null, requires: `STORE:${event.payload.storeId}` };
```

Tres propiedades que esto conserva y que hay que no romper:

- **Sigue sin haber cadenas** (R11 de F-037): `ZONE_TARIFF` requiere y no provee;
  `STORE` provee y no requiere. Ninguna fila de la tabla tiene las dos columnas
  llenas.
- **La clave es compuesta con la entidad** (`STORE:` + valor), así que un
  `storeId` que coincida con un `categoryId` no colisiona nunca — la propiedad
  que `src/features/sync/dependencies.ts:15-21` documenta.
- **La excepción de `CATEGORY` + `DELETE` no se toca** y `STORE` no la necesita:
  un `STORE` `DELETE` aplicado **no borra la fila** (I1), la suspende, así que
  después de cualquier `STORE` `processed` la fila existe de verdad y limpiar la
  clave es correcto. Un `STORE` que sale `SKIPPED` no prueba nada y no limpia
  (el defecto conservador que ya está escrito), con lo que el `ZONE_TARIFF` de
  detrás hace su propio camino y sale `SKIPPED` por su cuenta.

### 6. El vector, y el encabezado del que el test lo lee

Un **único** bloque vallado ` ```json ` —sin comentarios, para que `JSON.parse`
lo lea sin preprocesar— bajo un encabezado propio y estable de
`docs/sync-contract.md`: **`#### Vector de precedencia de ZONE_TARIFF (v13)`**.
El test localiza ese encabezado, recorta hasta el siguiente de nivel 2-4 y exige
**exactamente un** bloque `json`: cero, dos o JSON inválido son un fallo ruidoso
con un mensaje que dice cuál de las tres cosas pasó (caso límite 16), nunca un
`describe` vacío que pase con cero asertos. El precedente de un test que ya
parsea el contrato es `src/features/sync/fieldOwnership.test.ts:19,81`.

Forma del documento:

```
{
  "version": "1",
  "fixture": { "zones": [...], "rows": [...] },
  "cases": [
    {
      "id": "V2",
      "zone": { "code": "03.03", "level": "MUNICIPALITY", "provinceCode": "03" },
      "rows": [
        { "zoneCode": "03.03", "rule": "INHERIT" },
        { "zoneCode": "03", "rule": "FEE", "deliveryFee": 300 }
      ],
      "expected": {
        "served": true,
        "deliveryFee": "300.00",
        "decidedBy": "03",
        "path": [
          { "code": "03.03", "level": "MUNICIPALITY", "verdict": "INHERIT", "decides": false },
          { "code": "03", "level": "FIRST_LEVEL", "verdict": "FEE", "decides": true }
        ]
      }
    }
  ]
}
```

Cuatro decisiones sobre esa forma:

- **`rows` por caso**, no una sola tabla global: cada caso es autosuficiente y
  cualquiera de los dos lados puede alimentarlo con su propio aplicador sin
  reconstruir el fixture. `fixture` se conserva **además**, porque es lo que hace
  legible el conjunto para una persona y lo que el otro arnés cruzó.
- **`deliveryFee` de entrada es número** (la forma del payload) y **de salida es
  cadena de dos decimales** (`"300.00"`, `"0.00"`) o `null`. Es la asimetría del
  contrato y va escrita, porque es donde dos implementaciones se separan.
- **Los seis veredictos del camino en inglés** (`FEE`, `FEE_WITHOUT_AMOUNT`,
  `FEE_NEGATIVE`, `NOT_SERVED`, `INHERIT`, `ABSENT`) y `decides: true|false` en
  vez de `decide`/`declina`. La spec los escribió en castellano
  (`FEE_SIN_IMPORTE`, `FEE_NEGATIVO`, `AUSENTE`); AGENTS.md § Idioma dice que el
  formato de intercambio con cuadrecaja es **inglés**, y estos tokens son a la
  vez identificadores de código y datos del cable. **Es AP1**: la traducción es
  1:1 y se recruza con ellos al enviar el borrador, pero el nombre lo firma el
  humano porque es contrato.
- **Trece casos** (`V1`…`V10`, `G1`…`G3`), y el test afirma que el número
  ejecutado es igual al declarado **y ≥ 10**, para que la cifra no pueda
  encogerse en silencio (C1, I2). El bloque lo produce scripts/compute-zone-vector.ts
  (por crear) con `JSON.stringify(vector, null, 2)`, que es **exactamente** el
  formato que Prettier deja en un bloque `json` dentro de un `.md`: si se emite de
  otra forma, `npm run format:check` lo reescribe y el fichero deja de ser el que
  imprimió el guion.

## Modelo de datos y migraciones

### Los enums

```prisma
/// F-041. El nivel de una zona es un campo DECLARADO y no se deduce nunca de
/// la longitud ni del prefijo del código (R3). El caso real es la Isla de la
/// Juventud: primer nivel `40`, municipio `40.01`.
enum ZoneLevel {
  FIRST_LEVEL
  MUNICIPALITY
}

/// F-041 R15. Discriminante de TRES valores, no dos banderas: `FEE` exige
/// importe, `NOT_SERVED` e `INHERIT` lo prohíben, e `INHERIT` es el ÚNICO
/// mecanismo de retracción que existe (R20), en todos los niveles.
enum ZoneTariffRule {
  FEE
  NOT_SERVED
  INHERIT
}
```

Y los dos valores nuevos: `DeliveryFeeMode` gana `ZONE_BASED`, `SyncEntity` gana
`ZONE_TARIFF`.

### Las tres tablas

```prisma
/// F-041 — el ÍNDICE del catálogo de zonas, espejo del artefacto commiteado
/// (src/features/zones/zone-index.json). La AUTORIDAD son los bytes: esta tabla
/// existe para la integridad referencial de `ZoneTariff`/`Store.zoneCode` y
/// para poder consultar el catálogo con SQL. Las filas NO se borran nunca
/// (R4): un código retirado se marca con `retiredAt` —el mismo patrón que
/// `Slug.retiredAt`— y no se reutiliza jamás, porque un código reutilizado
/// dejaría una fila de tarifario vieja resolviendo con otro significado.
model Zone {
  code          String    @id
  name          String
  level         ZoneLevel
  /// Presente en TODA fila de municipio y `null` en toda fila de primer nivel.
  /// Es el escalón de encima en la precedencia (R26) — y quien lo lee es la
  /// función pura a través del índice, no una consulta.
  provinceCode  String?
  /// Id de la relación de OSM. NO es único: la Isla de la Juventud aparece dos
  /// veces (`40` y `40.01`) apuntando a la misma relación — 184 filas, 183
  /// relaciones (I9). Nunca viaja por el cable.
  osmRelationId String
  /// El nombre que la zona tenía en OSM al generarse, para que una
  /// regeneración distinga «id vivo que cambió de nombre» de «id nuevo».
  osmName       String
  retiredAt     DateTime?

  province      Zone?        @relation("ZoneProvince", fields: [provinceCode], references: [code])
  municipalities Zone[]      @relation("ZoneProvince")
  tariffs       ZoneTariff[]
  stores        Store[]

  @@index([provinceCode])
}

/// F-041 — la versión del índice aplicada a ESTA base. Una fila por versión
/// sembrada; la vigente se lee con UNA consulta
/// (`orderBy: { appliedAt: "desc" }`, criterio 11). El `sha256` es el del
/// fichero que se sembró, hasheado sobre los mismos bytes que se parsearon.
model ZoneCatalogVersion {
  version     String   @id
  sha256      String
  generatedAt DateTime
  zoneCount   Int
  appliedAt   DateTime @default(now())
}

/// F-041 — el tarifario de una sucursal. Una fila por `(storeId, zoneCode)`.
/// NO acepta `DELETE` por el cable (R20): `INHERIT` es la retracción. Muere
/// con la sucursal por dos caminos (R22): la cascada de aquí para el día que
/// una fila `Store` desaparezca de verdad, y el borrado explícito del camino
/// aplicado de un `STORE` con `operation: "DELETE"`, que hoy SUSPENDE la fila
/// en vez de borrarla (`handlers/store.ts:124-127`, I1).
model ZoneTariff {
  storeId         String
  zoneCode        String
  rule            ZoneTariffRule
  /// ANULABLE porque `NOT_SERVED` e `INHERIT` no llevan importe (R27): las
  /// tres guardas son representables aquí aunque el schema del cable las
  /// rechace. Mismo dominio y misma moneda que `Store.deliveryFee` — la base
  /// del negocio, sin campo de moneda propio (R16).
  deliveryFee     Decimal?       @db.Decimal(14, 2)
  /// `payload.updatedAt`. NOT NULL: esta tabla nace con el feature y toda fila
  /// la escribe el sync, así que no hay backfill que evitar — al contrario que
  /// `Store.sourceUpdatedAt`. Es el mismo caso que `StoreProduct.sourceUpdatedAt`.
  sourceUpdatedAt DateTime
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)
  zone  Zone  @relation(fields: [zoneCode], references: [code])

  @@id([storeId, zoneCode])
}
```

Y en `Store`, una columna y dos campos de relación:

```prisma
  /// F-041 R29 — la zona COMPUTABLE de la sucursal, validada contra el
  /// catálogo. «Omitir no es apagar» (ADR 0028 (d)): ausente deja la columna
  /// intacta, `null` explícito la borra. `city`/`province` siguen siendo texto
  /// de PRESENTACIÓN; no se derivan uno del otro y contradecirse no es error.
  zoneCode String?

  zone        Zone?        @relation(fields: [zoneCode], references: [code])
  zoneTariffs ZoneTariff[]
```

Cinco decisiones del modelo, con su alternativa descartada en una línea:

1. **Clave primaria compuesta `@@id([storeId, zoneCode])`**, no un `uuid` con un
   `@@unique` al lado. Nada referencia una fila del tarifario, la pareja **es** la
   identidad, y el `findUnique`/`upsert` del handler viaja por la clave primaria
   sin un índice secundario que mantener. Descartado el `uuid`: una columna y un
   índice más para nada.
2. **Sin `@@index([zoneCode])`.** Ninguna consulta de este feature ni de F-042
   filtra por zona sola (el selector filtra por tienda), un `Zone` no se borra
   nunca (R4) y su `code` no se actualiza jamás, así que no hay comprobación de
   clave ajena que barra la tabla hija. Se añade el día que exista una consulta
   «qué tiendas sirven esta zona», que hoy no está ni en el backlog. Escrito para
   que no parezca un olvido.
3. **`retiredAt DateTime?` en vez de `retired Boolean`**, calcado de
   `Slug.retiredAt` (`prisma/schema.prisma:227-239`, el registro que ya resuelve
   «un valor no se reasigna nunca»): la fecha responde además «desde cuándo», que
   es lo que hace explicable un pedido viejo.
4. **`provinceCode` con clave ajena a `Zone.code`** (auto-relación). Garantiza en
   la base lo que C16 comprueba en el artefacto. Consecuencia para la siembra: las
   filas de primer nivel tienen que entrar antes que sus municipios, y salen
   ordenadas solas porque `34` ordena antes que `34.01`.
5. **Clave ajena de `ZoneTariff.zoneCode` y de `Store.zoneCode` al catálogo**, tal
   como fija la spec. El precio, escrito: en una base migrada y **sin sembrar**, un
   `ZONE_TARIFF` de un código que sí está en el artefacto falla la clave ajena y
   vuelve en `failed[]`, no en `400` (caso límite 15). Lo que evita eso es el paso
   operativo de `docs/despliegue.md`, y lo que lo detecta es el criterio 11 en CI.
   La alternativa —texto sin relación, como `Business.displayCurrencies` (R9 de
   F-038)— dejaría el tarifario apuntando a códigos que nadie garantiza que
   existan, y aquí sí hay una tabla que los garantiza.

### La migración

**No se genera con `prisma migrate dev`**: esta base Postgres se comparte entre
worktrees y `migrate dev` se niega a avanzar por checksum drift, ofreciendo
resetear el esquema —uno de los dos comandos que AGENTS.md prohíbe. El camino,
con sus tres fichas:

1. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   (`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`).
2. **Quitar del SQL los cinco `DROP INDEX`** de los índices GIN y parciales no
   declarados (`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`).
   Sin esto, la búsqueda queda haciendo scans secuenciales en producción y
   **ningún test se pone rojo**.
3. Carpeta a mano, `prisma/migrations/<timestamp>_zone_shipping/migration.sql`, y
   `npx prisma migrate deploy`.
4. La aditividad **no** se comprueba con `migrate diff --exit-code`, que nunca da
   cero en este repo por esos mismos índices
   (`.agent/playbook/prisma-migrate-diff-nunca-da-cero-por-indices-no-declarados.md`):
   se comprueba con `git diff main --stat -- prisma/migrations`, que tiene que
   mostrar **solo ficheros nuevos** (C10).

Forma esperada del DDL, en este orden:

```sql
ALTER TYPE "DeliveryFeeMode" ADD VALUE 'ZONE_BASED';
ALTER TYPE "SyncEntity" ADD VALUE 'ZONE_TARIFF';
CREATE TYPE "ZoneLevel" AS ENUM ('FIRST_LEVEL', 'MUNICIPALITY');
CREATE TYPE "ZoneTariffRule" AS ENUM ('FEE', 'NOT_SERVED', 'INHERIT');
CREATE TABLE "Zone" (...);
CREATE TABLE "ZoneCatalogVersion" (...);
CREATE TABLE "ZoneTariff" (...);
ALTER TABLE "Store" ADD COLUMN "zoneCode" TEXT;
-- claves ajenas e índices
```

**Ninguno de los dos valores nuevos de enum se usa dentro de la misma
transacción que lo añade** (Postgres lo prohíbe): las tablas nuevas usan tipos
que se crean en el mismo fichero —eso sí es legal—, y `ZONE_BASED`/`ZONE_TARIFF`
no aparecen en ningún `DEFAULT` ni en ningún `INSERT` de la migración. Es
exactamente la forma del precedente
`prisma/migrations/20260908013319_business_display_currencies/migration.sql`.

**Sin backfill y sin datos en la migración.** El catálogo lo siembra
`seedZoneCatalog`, no el DDL: una migración que insertara 184 filas obligaría a
editarla el día que salga una versión nueva del índice, y el criterio 11 pide
justamente lo contrario —una siembra idempotente que se pueda repetir.

### La siembra, en un statement

Prisma no tiene upsert masivo, y 184 `upsert` son 184 round-trips por siembra.
`seedZoneCatalog` escribe con **un** `INSERT … ON CONFLICT ("code") DO UPDATE
SET name, level, "provinceCode", "osmRelationId", "osmName", "retiredAt"` de 184
filas (`Prisma.join` sobre los valores, `$executeRaw`), que son 184 × 7 = **1288
parámetros** —muy por debajo del techo de 65 535 de Postgres— y **un** round-trip.
Precedente de SQL crudo cuando la API de Prisma no expresa la operación:
`docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md` y
`src/features/marketplace/server/searchVector.ts`. Sin `$transaction`: el pooler
corre en modo transacción (AGENTS.md § Cosas que muerden, ficha
`.agent/playbook/pooler-transaccion-deadlock.md`).

Tres propiedades que esa forma da gratis:

- **Idempotente y actualizadora a la vez** (R9): la segunda ejecución deja las
  mismas 184 filas, y una versión nueva del índice **actualiza** nombre, nivel,
  provincia, nombre de OSM y marca de retirado de las filas que ya existen —que es
  lo que `createMany({ skipDuplicates: true })` **no** hace, y por eso no basta
  (el precedente de `prisma/seed.ts:334-341` sirve para reservar slugs, no para
  esto).
- **Nunca borra**: una fila que esté en la base y no en el artefacto se queda
  (R4). Si el recuento de la base supera al del artefacto, `seedZoneCatalog` emite
  un `console.warn("[zones] …")` con la diferencia en vez de callar.
- **El tipo del cliente es `Pick<PrismaClient, …>`**, el truco de
  `src/features/sync/server/canonicalBarcodes.ts:18`, para que sirvan tanto el
  cliente global de `src/lib/prisma.ts` como el que construyen `prisma/seed.ts` y
  el guion de producción.

## Escalabilidad y límites

Números, no adjetivos. Los de round-trips salen de contar las llamadas de Prisma
en el camino descrito arriba; los de bytes, de medir el artefacto que se va a
generar (184 filas × ~130 B ≈ 24 KB en claro, ~7 KB gzip).

1. **El índice, en memoria.** 184 entradas, un `Map` construido una vez por
   proceso al cargar el módulo: ~50 KB de heap y una sola vez el coste de parsear
   el JSON (bajo 1 ms). Crece **solo** si ONEI reorganiza la DPA; el techo
   realista es «unas decenas de filas más en una década». Ningún camino de
   petición vuelve a leer el fichero, ningún camino lo consulta a la base.
2. **La validación de `zoneCode`, cero consultas.** Un lote de 500 eventos con
   500 `zoneCode` distintos cuesta 500 búsquedas en un `Map` (O(1)) dentro del
   `safeParse` que ya se hace. Es lo que hace posible el `400` de lote (I7) y lo
   que hace que su precio sea nulo.
3. **El handler: 2 llamadas de Prisma por evento.** Una `findUnique` de la
   sucursal —con su fila del tarifario anidada en el mismo `select`— y un
   `upsert`. Un lote lleno de tarifas (500 eventos, el techo de
   `MAX_CATALOG_EVENTS`) son **~1000 round-trips**, del mismo orden que los ~1500
   que ya hace hoy un lote de 500 `PRODUCT`
   (`src/features/sync/server/handlers/product.ts` hace ≥3 por evento). A 2-4 ms
   por round-trip son **2-4 s de lote**, y el caso realista es peor de lo que
   parece porque el tarifario completo de una tienda son 168 eventos que llegan
   juntos la primera vez.
   **Lo que se rompe primero es esto**, y su mitigación está identificada y
   **descartada a propósito**: un memo por lote de la sucursal por `externalId`
   —el gemelo de `createRenderableBranchLookup`
   (`src/features/sync/server/businessBranches.ts`)— bajaría 168 búsquedas a 1,
   pero cachear esa fila dentro del lote es inseguro hoy: su **slug canónico**
   depende de `brandBranchCount`, que cambia si una sucursal hermana publica en el
   mismo lote, y devolver el canónico viejo invalidaría la etiqueta equivocada —el
   fallo exacto que ficha
   `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`.
   Si algún día duele, la forma segura es memoizar **solo** `{ id, businessId }`
   (que no cambian) y seguir resolviendo el canónico por evento.
4. **La resolución: 1 consulta, ≤2 filas, por la clave primaria.** El nivel y la
   provincia salen del índice, así que no hay una segunda consulta para
   descubrirlos. Con 100× tiendas no cambia: es una búsqueda por
   `(storeId, zoneCode IN (…))` sobre la PK.
5. **Filas de `ZoneTariff`.** Techo duro por sucursal: **184**. Un negocio
   realista declara 10-20 zonas. Con 500 tiendas y 15 zonas de media son 7 500
   filas; con 500 tiendas declarando el país entero, 92 000; a 100× tiendas
   (50 000) con tarifario completo, 9,2 M de filas y ~600 MB de índice de PK. Como
   toda lectura va por la PK, el volumen no degrada la latencia; lo que hay que
   vigilar a esa escala es el tamaño del `Store`-scope de un `deleteMany` al
   suspender, que sigue siendo ≤184 filas.
6. **JavaScript de cliente: +0 KB de datos y <0,2 KB de código.** El artefacto
   **no entra**: nada del árbol de cliente importa
   src/features/zones/catalog.ts (por crear). Lo único que crece en cliente es
   `src/features/orders/deliveryOffer.ts`, que gana dos `switch` (~15 líneas,
   bajo 0,2 KB gzip) y cuyo `import type` del enum se borra al compilar. El techo
   de `scripts/check-bundle-budget.mjs` es 193 KB y la página peor medida va por
   182,1 KB, **así que no hace falta subirlo**.
   Y la advertencia que importa: **la etapa `bundle` no es la garantía**. Si el
   índice se colara en un chunk de cliente sumaría ~7 KB gzip y la etapa
   **seguiría pasando**, dejando el problema invisible hasta F-042. La garantía
   son dos cosas explícitas: una entrada en el `no-restricted-imports` de
   `eslint.config.mjs` para `src/components/**` y `src/app/**/*.tsx`, y
   src/features/zones/boundaries.test.ts (por crear), que fija la **lista blanca**
   de importadores del módulo del índice (el schema del sobre, los handlers, el
   sembrador, los guiones y los tests) y falla si aparece cualquier otro —incluidos
   los componentes de `src/features/*/components/`, que la regla de ESLint no
   cubre y donde vive precisamente el checkout
   (`src/features/cart/components/CheckoutForm.tsx`).
7. **Invalidación: una ronda por lote.** Veinte tarifas de la misma tienda son
   **una** entrada en el `Set` y **una** ronda de `revalidateStores`, no veinte
   (`src/features/sync/server/processBatch.ts:132-143`). El handler no llama a
   `revalidateTag` nunca: solo reporta el slug canónico (R25). Cero líneas nuevas
   en `src/lib/cache.ts`, y el precedente de la prueba es
   `src/features/sync/server/processBatch.invalidationCount.test.ts`.
8. **Siembra: 1 statement, 1288 parámetros, dos ejecuciones idénticas.** En CI son
   dos siembras seguidas (`.github/workflows/ci.yml:63-66`) y el coste total del
   catálogo es despreciable frente al seed de demostración que ya corre.
9. **Lo que no escala y no hace falta que escale**: el guion del vector y el test
   de integridad del artefacto corren fuera del camino de petición.

## Patrones a seguir / antipatrones a evitar

| Hacer                                                                                                        | Porque lo impone                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Un fallo por evento se **lanza** con `SyncEventFailure`, nunca se añade un `status` nuevo a `HandlerOutcome` | `src/features/sync/server/handlers/types.ts:79-90`: un `"failed"` en la unión caería en el `else` de `processBatch` y viajaría en `ok` |
| El handler **reporta** el slug canónico; `processBatch` invalida                                             | R25 y `src/features/sync/server/handlers/types.ts:6-55`                                                                                |
| `console.warn("[zones] …")` / `console.warn("[sync] …")`, **nunca** `console.error`                          | AGENTS.md § Cosas que muerden, ficha `.agent/playbook/console-error-dispara-guardian-servidor.md`                                      |
| Ninguna consulta del cliente global dentro de un `$transaction`; se batchea en un statement                  | AGENTS.md § Cosas que muerden, `.agent/playbook/pooler-transaccion-deadlock.md`                                                        |
| El vocabulario del cable sale del **enum generado**, jamás de un literal copiado                             | ADR 0028 § Consecuencias, y es la causa de I4                                                                                          |
| La comprobación de importe es contra `null`/`undefined`, nunca contra un falsy                               | R27(2) y `src/features/orders/deliveryOffer.ts:34,63`                                                                                  |
| Los números clavados a mano (`Store 31`, `54 filas`) se mueven en el **mismo commit**                        | I5, `src/features/sync/fieldOwnership.test.ts:141-145`                                                                                 |
| Un `vi.mock` por handler nuevo en `processBatch.test.ts`                                                     | I12, `src/features/sync/server/processBatch.test.ts:41-44`                                                                             |
| `npm run format` sobre **lo que tú escribiste** en `.agent/`, sin formatear a ciegas documentos ajenos       | AGENTS.md § Cosas que muerden (once features acumulados en la primera mitad, siete en la segunda)                                      |

Antipatrones, cada uno con el daño concreto:

- **Deducir el nivel de la forma del código** (`length === 2` → provincia). Una
  zona de primer nivel con código de cuatro caracteres heredaría la tarifa de la
  provincia cuyos dos primeros dígitos coincidan, **sin error y sin rastro**
  (R3, caso V10).
- **Escribir `isDeliveryConfigInconsistent` en términos de `isDeliveryOffered`.**
  Es la forma de hoy y es lo que hace imposible configurar una tienda
  `ZONE_BASED` (I4). Son dos preguntas.
- **`if (!row.deliveryFee)`.** Convierte el envío gratis en el importe de la
  provincia con una línea que parece correcta (R27(2)).
- **Un `refine` en vez del discriminante de tres valores.** Reintroduce el
  `served: true` sin importe que el acuerdo mató (R15).
- **Aceptar `DELETE` en `ZONE_TARIFF`, o comprobarlo después de la guarda
  anti-rancio.** Un borrado deja la fila sin marca contra la que comparar y un
  `UPDATE` rancio la resucita: en `CATEGORY` es cosmético, aquí sería un importe
  cobrado (R20).
- **Armar a mano la lista de slugs a revalidar.** AGENTS.md § Prohibiciones; aquí
  no hace falta ninguna expansión de marca, porque una tarifa **no** cambia lo que
  muestra el selector de sucursales ni lo que resuelve ningún slug (§ «Cuándo NO
  es esto» de la ficha).
- **Importar el índice desde cualquier módulo de cliente.** Son ~7 KB gzip que
  la etapa `bundle` no cazaría (§ Escalabilidad, punto 6).
- **`prisma migrate dev`, `prisma migrate reset`, `prisma db push`.** Los dos
  últimos están prohibidos en AGENTS.md; el primero, en esta base compartida, lleva
  al segundo.
- **Formatear el artefacto con Prettier.** Le cambia los bytes y con ellos el
  sha256 publicado: src/features/zones/zone-index.json (por crear) entra en
  `.prettierignore` en el mismo commit que nace, con el motivo escrito al lado.

## Las doce incongruencias de la spec, y qué hace esta arquitectura con cada una

| #   | Qué dice                                                    | Qué hace el diseño                                                                                                                                                               |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Un `STORE` `DELETE` **no** borra la fila `Store`            | Las dos mitades de R22: `onDelete: Cascade` declarado **y** `deleteMany` explícito en el camino aplicado del `DELETE` (§ Flujo B). Sin la segunda, el criterio 8 es inalcanzable |
| I2  | El criterio 1 dice siete casos, el acuerdo son diez         | Se publican **trece**; el test exige «ejecutados = declarados» **y ≥ 10**. Ningún criterio se toca                                                                               |
| I3  | La composición de los diez no está en ningún fichero        | scripts/compute-zone-vector.ts (por crear) los **recomputa ejecutando**; se recruzan al enviar el borrador y se publica la **unión** (SP1)                                       |
| I4  | El tercer valor rompe `typecheck` y mata el criterio 10     | § Contratos 1: el tipo sale del enum con `import type`, y la pregunta se parte en dos funciones con `switch` exhaustivo                                                          |
| I5  | `Store.zoneCode` mueve tres números clavados                | **Cinco** sitios, no tres (§ Riesgos 4): dos asertos de `fieldOwnership.test.ts:141-145`, y `docs/sync-contract.md:517,1198,1203`. Además `54 filas` pasa a `55`                 |
| I6  | La misma clase de dato desconocido responde de dos formas   | Se conserva la asimetría (schema → `400` de lote; handler → `failed[]`) y va a la v13 **con ejemplo**, porque su precio es el outbox entero de un negocio                        |
| I7  | El criterio 6 solo es alcanzable sin base                   | Es la razón por la que los bytes viven en un módulo importable (§ Decisión 2). Sin eso el criterio estaría mal escrito                                                           |
| I8  | «Sembrado» y `prisma/seed.ts` no es producción              | `seedZoneCatalog` con dos llamadores: `prisma/seed.ts` y scripts/seed-zone-catalog.ts (por crear), más su línea en `docs/despliegue.md` § 1                                      |
| I9  | El id de OSM **no** es único                                | `osmRelationId` sin `@unique`, y C16 lo fija al revés: 183 distintos, el único repetido es el par `40`/`40.01`                                                                   |
| I10 | La 0028 se reabre, la 0011 no                               | § ¿Hace falta una ADR? — una ADR nueva que estreche el invariante (e) de la 0028; la 0011 no se menciona más que para decir que no se toca                                       |
| I11 | AGENTS.md enumera cuatro entidades de la guarda que rechaza | Pasan a cinco: la línea de AGENTS.md § Cosas que muerden se corrige en el mismo commit que el handler                                                                            |
| I12 | `processBatch.test.ts` mockea por ruta                      | Un `vi.mock` nuevo, y el `switch` sin `default` de `applyEvent` más el `never` de `dependencyRoleOf` siguen siendo la red que avisa en `typecheck`                               |

**Y una decimotercera que la spec no vio, encontrada leyendo los tests
(I13).** Dos tests usan hoy `ZONE_TARIFF` como ejemplo de **entidad que el
contrato no define**:

- `src/features/sync/schemas.test.ts:255-263` («rejects an entity the contract
  does not define (ZONE_TARIFF, v13 vocabulary — I3)»).
- `src/features/sync/server/handlers/business.db.test.ts:189-225` (C2: «an entity
  the contract does not define (ZONE_TARIFF) still kills the WHOLE batch»), con un
  payload de `{ zoneId, rule, deliveryFee, updatedAt }`.

Lo peligroso es que **los dos siguen pasando** cuando la entidad exista —el
primero porque `payload: {}` falla igualmente, el segundo porque su payload no
lleva `storeId` ni `zoneCode`—, así que el sensor no dirá nada y quedarán dos
tests **verdes cuyo nombre miente** y que han dejado de comprobar lo que dicen.
Los dos tienen que reapuntarse a una entidad que de verdad no exista (`ORDER`,
por ejemplo) en el mismo commit que añade la séptima rama. Es forma de test, no
de contrato, así que no necesita decisión del humano: va al plan como paso
propio.

## La versión del índice, y los ficheros de fuera de `src/` que hay que tocar

**La cadena de versión es `1.0.0`**, escrita en tres sitios que tienen que
coincidir byte a byte: el campo `version` del artefacto,
`ZONE_INDEX_VERSION` en src/features/zones/catalog.ts (por crear) —de donde la lee
el sembrador— y § «La versión del catálogo» de `docs/sync-contract.md`, junto al
sha256. Regla de movimiento, escrita ahora para no improvisarla luego: cualquier
cambio de cualquier fila mueve la **menor** (`1.0.0` → `1.1.0`); una **edición
distinta del DPA** mueve la **mayor**, porque los códigos no son estables entre
ediciones (la Isla de la Juventud fue `9901` en 2006 y es `40.01` en 2011). El
nombre del fichero **no** lleva la versión: la lleva dentro, el hash la delata y
git guarda la anterior. Así el `import` no cambia con cada versión y el sha256 del
contrato es lo único que hay que mirar para saber si los dos lados comparten
catálogo.

Además del código, este feature toca ocho ficheros que no están en `src/` y que
el plan tiene que ordenar como pasos propios:

1. `package.json` — dos guiones: `seed:zones` (producción, I8) y `vector:zones`
   (recomputar el vector, C13).
2. `.prettierignore` — el artefacto JSON, con el motivo al lado: **Prettier le
   cambiaría los bytes y con ellos el sha256 publicado**.
3. `eslint.config.mjs` — el módulo del índice en el `no-restricted-imports` de
   `src/components/**` y `src/app/**/*.tsx`.
4. `AGENTS.md` § Cosas que muerden — la lista de la guarda que rechaza pasa de
   cuatro entidades a cinco (I11).
5. `docs/despliegue.md` § 1 — cómo entra el catálogo en un entorno nuevo (I8).
6. `docs/sync-contract.md` — la v13 entera, con los nueve puntos que enumera la
   spec, y los tres números de la tabla de propiedad (I5).
7. `.agent/solicitudes.md` — la línea fechada en la fila de S-007 (C13).
8. `src/features/admin/server/boundaries.test.ts` — `zoneCode` entra en
   `FORBIDDEN_WRITE_COLUMNS`: el panel no comparte esta columna con el sync, igual
   que las cinco de F-032 (ADR 0017 (a), ADR 0028 (c)).

## Riesgos y plan B

1. **El artefacto no existe todavía y esta arquitectura entera se apoya en él.**
   Generar el índice necesita el PDF del DPA (recuperado, y su URL del Archive
   está en `.agent/specs/propuestas/zonas-de-envio.md`) **y** una consulta a
   Overpass viva el día de la implementación, porque `osmRelationId` y `osmName` no
   son opcionales (R2). Si Overpass no responde: el índice **no se genera a medias
   con los campos de OSM vacíos** —eso rompería R2 y el diff de la próxima
   regeneración—; se para la etapa y se dice, que es lo que la procedencia existe
   para poder explicar. La comprobación del 2026-09-06 dejó verificado que la API
   responde y devuelve 183 relaciones sin instalar nada.
2. **Los bytes tienen que ser idénticos en los dos repositorios.** Tres cosas los
   pueden mover sin que nadie lo note: Prettier (mitigado con `.prettierignore`),
   un editor que reescriba el final de línea o quite el salto final (convención:
   LF y **un** `\n` final, y el test del sha256 lo delata al instante) y una
   regeneración accidental. El sha256 en el contrato es el árbitro.
3. **La cascada `STORE → ZONE_TARIFF` es visible en el cable y cambia lo que el
   POS puede esperar.** Hoy un `STORE` que falla no arrastra nada; desde la v13
   arrastra los tarifarios de esa sucursal en el mismo lote. No afecta a ninguna
   entidad existente —nadie más requiere `STORE:`—, pero va documentado en la tabla
   de cascadas de la v13 **antes** de que ellos lo implementen, no después
   (`dependencies.test.ts` y la tabla del contrato en el mismo commit).
4. **Los números clavados a mano son cinco, no tres.** `Store 31` y las filas de
   la tabla del contrato en `src/features/sync/fieldOwnership.test.ts:141-145`
   (dos asertos), y `docs/sync-contract.md:517`, `:1198` («54 filas en total» →
   **55**) y `:1203`. Y el título del propio test dice «all 54 rows»: queda verde
   pero mintiendo si no se mueve. Todos, en el mismo commit que la columna.
5. **La v13 se publica con el visto bueno de cuadrecaja, y el borrador sale al
   firmar el plan.** El riesgo es implementar contra un vector que ellos van a
   ampliar: se mitiga con la regla de la **unión** (SP1) y con que el test lea el
   documento en vez de una copia, así que ampliar el vector es editar el contrato y
   volver a correr `npm test`, no reescribir un fixture.
6. **F-042 va a necesitar los nombres de las zonas en el navegador, y esta
   arquitectura le cierra la puerta fácil a propósito.** Importar el índice en una
   isla de cliente son ~7 KB gzip que la etapa `bundle` no cazaría. Cuando F-042
   llegue, el camino es servirlos desde el servidor —`<option>`s renderizados o una
   ruta que devuelva solo la cobertura declarada de esa tienda—, y la lista blanca
   de importadores es lo que obliga a que esa decisión se tome mirándola.
7. **`z.discriminatedUnion` anidada dentro de la del sobre.** Si `rule` falta o no
   es uno de los tres, el `issue` que sale es el de discriminante inválido de Zod,
   no un mensaje nuestro: sigue siendo `400 INVALID_BATCH`, que es lo que el
   criterio 3 pide, pero el cuerpo dirá «invalid_union_discriminator». Se acepta y
   se documenta en la v13 con un ejemplo del cuerpo.

## ¿Hace falta una ADR?

**Sí, dos**, y esta arquitectura **no las escribe**: el ciclo le prohíbe tocar
`docs/`, así que van al plan como pasos propios con su número reservado. Los
borradores son cortos y su contenido está decidido arriba.

**ADR 0032 — «El catálogo de zonas son bytes commiteados y la base es su
espejo».** Estructural y nueva: no hay ninguna ADR que diga qué es un dato de
referencia compartido entre los dos sistemas. Lo que decide: (a) la autoridad son
los bytes del repositorio y la tabla es su espejo, sembrado e idempotente; (b) el
`code` es de ONEI y el id de OSM solo une regeneraciones, nunca viaja; (c) el
nivel es un campo declarado; (d) un código retirado se lee, no se ofrece y **no
se reutiliza nunca**; (e) el índice y la geometría son dos artefactos con
versiones separadas (F-042 trae la segunda); y (f) la consecuencia que ordena todo
lo demás: **el schema del sobre puede rechazar una zona desconocida con un `400`
porque el catálogo no es una consulta**. Reabrir cuando: el catálogo tenga un
segundo consumidor, o cuando mantener la versión sincronizada cueste más de lo que
ahorra (el precio que § «El costo asumido» de la propuesta ya dejó escrito).

**ADR 0033 — «Con qué cobrar el domicilio y ofrecerlo son dos preguntas
distintas».** Estrecha el invariante (e) de
`docs/adr/0028-configuracion-de-compra-del-pos.md`, así que **no puede ser una
nota**: 0028 (e) dice que una fila con `deliveryEnabled = true` y nada con qué
cobrar es el estado que el sync nunca escribe, y con `ZONE_BASED` «lo que hay con
qué cobrar» deja de ser una propiedad de la fila `Store`. Lo que decide: la
configuración se **acepta** (`hasSomethingToChargeDeliveryWith`) y la oferta al
comprador se **niega** hasta F-042 (`isDeliveryOffered`), cada una con una sola
función y un `switch` exhaustivo; el `deliveryFee` residual de la columna **no se
cobra nunca** en `ZONE_BASED` y el sync **no** lo borra por su cuenta («omitir no
es apagar»); y `ZONE_BASED` y `QUOTED_PER_ORDER` son excluyentes. Es también donde
queda escrito, con fecha, que la DA1 de F-031 acertó en el sitio y se equivocó en
la forma. Reabrir cuando: aparezca un cuarto modo de envío (y entonces el
`typecheck` avisará antes que nadie).

La **ADR 0011 no se reabre** y esta arquitectura no la necesita para nada: aquí
ninguna coordenada decide un precio ni ordena nada (I10). Se nombra solo para que
el siguiente que lea esto no vuelva a preguntárselo.

## Preguntas al humano

Cuatro, todas respondibles en una línea, ninguna bloquea escribir código pero
**las cuatro bloquean la firma del plan** porque tres tocan el contrato y una la
operación.

**AP1 — los seis veredictos del camino del vector: ¿en inglés o verbatim de la
spec?**
La spec los escribió `FEE`, `FEE_SIN_IMPORTE`, `FEE_NEGATIVO`, `NOT_SERVED`,
`INHERIT`, `AUSENTE`, y con `decide`/`declina`. Son a la vez identificadores de
código y datos que viajan en el contrato, y AGENTS.md § Idioma dice que el formato
de intercambio con cuadrecaja es **inglés**. Opciones: (a) inglés —`FEE`,
`FEE_WITHOUT_AMOUNT`, `FEE_NEGATIVE`, `NOT_SERVED`, `INHERIT`, `ABSENT`, con
`decides: true|false`—; (b) verbatim de la spec, aceptando el castellano en el
cable; (c) inglés en el código y castellano en el documento, mapeados. **(a)**, y
descartada (c) sin discusión: dos vocabularios para lo mismo es exactamente lo que
hace divergir dos implementaciones. La traducción es 1:1 y se recruza con
cuadrecaja al enviar el borrador de la v13.

**AP2 — ¿cómo recibe cuadrecaja los bytes del índice?**
El acuerdo dice «los mismos bytes a los dos lados y el hash lo demuestra», pero no
dice por dónde llegan. Opciones: (a) el contrato cita la **ruta del fichero en
este repositorio** y su sha256, y los bytes viajan con el borrador de la v13
—adjunto una vez, como el resto del material que ya se les manda—; (b) una ruta
pública nueva que sirva el índice (código nuevo, caché, versión en la URL); (c) un
repositorio compartido solo para los artefactos. **(a)**: 24 KB que cambian una
vez al año no justifican un endpoint, y el hash del contrato ya es el árbitro. (b)
tiene sentido el día que F-042 necesite servir la geometría por cobertura, y
entonces se decide con ese feature delante.

**AP3 — el catálogo en un entorno nuevo: ¿a mano una vez, o paso del
despliegue?**
Sin catálogo sembrado, todo `ZONE_TARIFF` falla por clave ajena (caso límite 15).
Opciones: (a) un guion propio (`npm run seed:zones`) documentado en
`docs/despliegue.md` § 1 y ejecutado **a mano** una vez por entorno, como el resto
de los pasos de esa sección; (b) engancharlo al `db:deploy`/al arranque, para que
no se pueda olvidar; (c) meterlo dentro de la migración. **(a)**, que es la forma
que ya tiene el resto de este documento y deja el paso visible; (b) esconde una
escritura de datos en un comando de esquema, y (c) obliga a editar una migración
aplicada cada vez que salga una versión nueva del índice. Si el humano prefiere
(b), es una línea y se anota en la ADR 0032.

**AP4 — la forma documental de estrechar la ADR 0028 (e): ¿ADR nueva o nota
fechada?**
La 0028 (e) dice, con esas palabras, cuál es el estado que el sync nunca escribe,
y F-041 lo estrecha. Opciones: (a) **ADR 0033** que la supere en ese punto, como
pide AGENTS.md § Documentación («contradecir una exige una ADR nueva que la
supere»); (b) una nota fechada dentro de la 0028, con el precedente de la § «Nota
de F-015» de la ADR 0011. **(a)**: la nota de la 0011 aclaraba un disparador que
**no** se cumplió; aquí se cambia el alcance de una decisión, y la 0028 seguirá
siendo cierta para los dos modos viejos. Con (a), la 0028 gana una línea de
«superada en (e) por la 0033» y nada más.
