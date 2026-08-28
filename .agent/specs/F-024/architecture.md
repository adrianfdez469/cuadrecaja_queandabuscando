---
feature: F-024
agente: sdd-architect
actualizado: 2026-08-28T04:39:36Z
estado: listo
---

> Diseño sobre `.agent/specs/F-024/spec.md` en `estado: listo`. Sus 18
> escenarios, 13 reglas y el contrato v4 son la entrada de este documento y **no
> se reabren**; SP1 y SP2 están resueltas por el humano (2026-08-28) y tampoco.
> Lo que sigue es solo la **forma técnica**: firmas, SQL exacto, dónde vive cada
> pieza y qué se rompe primero.
>
> Una sola cosa nueva para el humano, y no bloquea construir: **AP1**
> (§ Preguntas al humano), que pregunta si la ADR borrador de este ciclo se
> acepta o se descarta.

## Estado actual relevante

Lo que existe hoy, y se reutiliza tal cual salvo donde se diga:

| Pieza                         | Archivo                                                                                  | Qué hace hoy                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Validación del lote           | `src/app/api/internal/sync/catalog/route.ts:31-37`                                       | `catalogBatchSchema.safeParse` **antes** de todo; `400 INVALID_BATCH` con `issues`. Es el único punto donde muere la clave singular      |
| Esquema del payload           | `src/features/sync/schemas.ts:56-73`                                                     | `barcode: z.string().nullish()` (línea 64). Zod descarta claves desconocidas en silencio                                                 |
| Decisión de identidad, pura   | `src/lib/canonical.ts:15-37`                                                             | `resolveCanonicalIdentity({ canonicalProductId, barcode })` → unión de tres ramas. Sin Prisma, sin SQL                                   |
| Normalización de un código    | `src/lib/canonical.ts:44-50`                                                             | `normalizeBarcode`: quita espacios y guiones, exige solo dígitos y longitud 8/12/13/14                                                   |
| Ingesta del producto          | `src/features/sync/server/handlers/product.ts:31-141`                                    | Guarda anti-rancio → identidad → `StoreProduct` → alias. **Sin `$transaction`**, cada paso su round trip, todo idempotente               |
| Resolución con base de datos  | `src/features/sync/server/handlers/product.ts:149-223`                                   | `resolveCanonical`: explícita / por EAN / huérfano (con reuso por `(storeId, externalId)`)                                               |
| Único escritor de la búsqueda | `src/features/marketplace/server/searchVector.ts`                                        | `writeSearchDocument(db, id, doc)` escribe `searchDocument` **y** `searchVector` en un solo `UPDATE`. Recibe el cliente por parámetro    |
| Fixtures de Postgres real     | `src/features/marketplace/server/dbFixtures.ts`                                          | Sesión aislada por token, `deriveEan(token, salt)`, `createCanonical`, `cleanup()` en orden explícito                                    |
| Guardas por lectura de disco  | `src/app/api/internal/boundaries.test.ts`                                                | Cuatro asertos F-018, uno de ellos («la variable global no vuelve») es **exactamente** la forma de C11, con el truco de partir la cadena |
| Seed                          | `prisma/seed.ts:856-904`                                                                 | `upsertCanonical` busca por `ean` único o por nombre+huérfano; escribe alias y llama a `writeSearchDocument`                             |
| Migraciones a mano            | `prisma/migrations/20260827221348_order_business_id_and_sync_token_unique/migration.sql` | El patrón exacto de una migración escrita a mano que **omite a propósito** los dos `DROP INDEX` de los GIN                               |

Tres hechos del entorno que condicionan el diseño y no son negociables:

1. **El pooler de Supabase corre en modo transacción** (`AGENTS.md` § Cosas que
   muerden, `.agent/playbook/pooler-transaccion-deadlock.md`): nada de
   `$transaction` alrededor de la escritura nueva.
2. **`prisma migrate dev` propone `DROP INDEX` de los dos GIN de
   `CanonicalProduct`** (`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`)
   y **la base local está compartida entre worktrees**, así que además da
   checksum drift (`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`).
3. **`processCatalogBatch` aplica los eventos en serie**
   (`src/features/sync/server/processBatch.ts:58`): cada round trip que se añade
   a `handleProduct` se multiplica por el tamaño del lote (hasta 500).

## Decisión

**Una tabla nueva, una función pura con firma nueva, un escritor único de una
sola sentencia, y una migración escrita a mano con su backfill dentro.** Cinco
piezas, ninguna capa nueva:

1. `CanonicalBarcode` en `prisma/schema.prisma`, con
   `@@unique([canonicalProductId, ean])` + `@@index([ean])` y sin `businessId`.
2. `resolveCanonicalIdentity` (en `src/lib/canonical.ts`, capa `lib/`, sigue sin
   Prisma) pasa a recibir `barcodes: string[]` y a devolver **dos** cosas: la
   identidad (las mismas tres ramas de ADR 0004) **y** la lista normalizada,
   deduplicada y ordenada. Quien escribe no vuelve a normalizar.
3. Un módulo nuevo en `features/sync/server/` que es el **único** sitio del repo
   que toca la tabla `CanonicalBarcode`: la escritura idempotente
   (`createMany` + `skipDuplicates`, un round trip) y la consulta de medición
   (`Prisma.sql`, nunca `Unsafe`). Mismo patrón que
   `src/features/marketplace/server/searchVector.ts`: recibe el cliente por
   parámetro, así lo usan igual el cliente global, `prisma/seed.ts` y un script.
4. La migración se escribe a mano —`migrate diff` para el DDL, carpeta creada a
   mano, `migrate deploy` para aplicar— y lleva su backfill
   (`INSERT … SELECT … ON CONFLICT DO NOTHING`) **en el mismo archivo**. Ni
   `migrate reset` ni `db push`.
5. Un ejecutable delgado en `scripts/`, hermano de
   `scripts/backfill-search-vector.ts`: construye su `PrismaClient`, llama a la
   función del punto 3 e imprime.

Alternativas descartadas, una línea cada una:

- _Meter la escritura de códigos dentro de `resolveCanonical`_ → esa función
  devuelve un id y se llama antes de que exista el `StoreProduct`; R10 exige que
  los códigos vayan **después**. Además mezclaría decidir con escribir.
- _Un `upsert` por código_ → k round trips por evento en vez de 1, y el pooler ya
  es el cuello de botella del lote.
- _Acumular todos los códigos del lote y escribirlos una vez al final de
  `processCatalogBatch`_ → 1 round trip por lote en vez de por evento, pero
  rompe la propiedad que hace seguro el reintento: un evento que falla dejaría
  escritos sus códigos, y `HandlerOutcome` tendría que crecer un campo. No vale
  el ahorro.
- _`z.strictObject` en `productPayloadSchema`_ para rechazar la clave singular →
  rechazaría **cualquier** clave nueva del POS, convirtiendo cada adición futura
  del contrato en un `400` del lote entero. Se prohíbe solo `barcode`.
- _`CanonicalBarcode.ean` con `@unique` global_ → destruiría el dato que el
  criterio 6 mide (E5, R7).
- _Una tabla `CanonicalBarcode` con `businessId`_ → decisión del orquestador ya
  tomada (spec.md § Datos y contrato) y § No decidido a propósito.
- _Escribir los códigos con `$executeRaw` y `ON CONFLICT` desde el principio_ →
  es el plan B (§ Riesgos), no el plan A: `createMany` tipado no necesita SQL
  crudo y da el mismo `INSERT … ON CONFLICT DO NOTHING`.

## Componentes

| Componente                           | Capa                    | Responsabilidad                                                                                        | Archivo                                                                 |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `CanonicalBarcode`                   | datos                   | Todos los códigos válidos de un canónico. Aditiva, sin atribución                                      | `prisma/schema.prisma`                                                  |
| DDL + backfill                       | datos                   | Crea la tabla, sus dos índices y la FK en cascada; siembra una fila por `CanonicalProduct.ean` no nulo | prisma/migrations/TIMESTAMP_canonical_barcode/migration.sql (por crear) |
| `normalizeBarcodes`                  | `src/lib/`              | Lista → normalizada + deduplicada + ordenada ascendente. Pura                                          | `src/lib/canonical.ts`                                                  |
| `resolveCanonicalIdentity`           | `src/lib/`              | Decide la rama **y** devuelve la lista normalizada. Pura                                               | `src/lib/canonical.ts`                                                  |
| `recordCanonicalBarcodes`            | `features/sync/server/` | La escritura idempotente: una sentencia, sin `$transaction`, conflictos ignorados                      | src/features/sync/server/canonicalBarcodes.ts (por crear)               |
| `countCanonicalBarcodeStats`         | `features/sync/server/` | Las cinco cifras + el histograma del criterio 6, con `Prisma.sql`                                      | src/features/sync/server/canonicalBarcodes.ts (por crear)               |
| `formatCanonicalBarcodeStats`        | `features/sync/server/` | El texto exacto que imprime el criterio 6 (probable sin Postgres)                                      | src/features/sync/server/canonicalBarcodes.ts (por crear)               |
| `CANONICAL_BARCODE_INSERT_CHUNK`     | `src/constants/`        | Filas por sentencia del `INSERT` (sin magic numbers)                                                   | src/constants/sync.ts (por crear)                                       |
| `productPayloadSchema`               | `features/*/schemas.ts` | `barcodes` obligatorio; `barcode` prohibido con mensaje                                                | `src/features/sync/schemas.ts`                                          |
| `handleProduct` / `resolveCanonical` | `features/sync/server/` | Llama a la identidad con la lista y escribe los códigos entre `StoreProduct` y el alias                | `src/features/sync/server/handlers/product.ts`                          |
| Medición ejecutable                  | `scripts/`              | `PrismaClient` propio, imprime, sale 0                                                                 | scripts/count-canonical-barcodes.ts (por crear)                         |
| Seed                                 | `prisma/`               | Escribe la fila del `ean` que ya siembra + un producto con tres códigos                                | `prisma/seed.ts`                                                        |
| Fixtures `db`                        | `features/*/server/`    | `createCanonical` escribe también su fila, por el mismo escritor                                       | `src/features/marketplace/server/dbFixtures.ts`                         |
| Smoke por HTTP                       | `scripts/`              | `barcodes` en el payload y un flag que provoca el `400` a mano                                         | `scripts/send-catalog-batch.mjs`                                        |
| Guardas nuevas (G6, G7)              | pruebas                 | La clave singular no vuelve; solo un archivo toca la tabla                                             | `src/app/api/internal/boundaries.test.ts`                               |
| Contrato v4                          | docs                    | `barcodes` lista, `400` del lote, la fusión sigue por un código                                        | `docs/sync-contract.md`                                                 |
| ADR                                  | docs                    | La decisión estructural, para el feature del grafo                                                     | `docs/adr/0020-todos-los-codigos-una-sola-fusion.md`                    |

**Ningún componente de UI, ninguna ruta nueva, ningún componente de cliente.**
0 KB de JavaScript de cliente añadidos, `check:bundle` intacto.

Por qué la escritura y la medición van en **el mismo** módulo: es el patrón que
ADR 0019 (b) ya fijó para `searchVector.ts` —la expresión que escribe y la que
consulta viven juntas porque son gemelas— y da una guarda barata: **un solo
archivo de producción nombra el delegado `canonicalBarcode` o la tabla
`"CanonicalBarcode"`** (G7). El día que el grafo necesite otra consulta, el
sitio ya está.

## Flujo de datos

```
POST /api/internal/sync/catalog
  │
  ├─ withInternalAuth        → 401/403/503                (F-018, sin cambios)
  ├─ catalogBatchSchema      → 400 INVALID_BATCH ← aquí muere `barcode` (E10-E12)
  ├─ findCatalogMismatch     → 403 BUSINESS_MISMATCH      (F-018, sin cambios)
  └─ processCatalogBatch (en serie, evento por evento)
       └─ handleProduct(payload, operation, businessId)
            1. store.findUnique                → SKIPPED si no es de este negocio
            2. storeProduct.findUnique         → sourceUpdatedAt
            3. guarda anti-rancio              → STALE, sin tocar códigos (E15)
            4. DELETE / !publishToStore        → borrado suave y FIN (E14)
            5. resolveCanonicalIdentity({ canonicalProductId, barcodes })
                 → { identity, barcodes: normalizados, ordenados, únicos }
            6. resolveCanonical(identity, …)   → canonicalId  (3 ramas de ADR 0004)
            7. storeProduct.create|update
            8. recordCanonicalBarcodes(prisma, canonicalId, barcodes)   ← NUEVO
            9. recordAlias(…)                  → y writeSearchDocument si es nuevo
```

El paso 8 va **entre** 7 y 9, exactamente donde R10 lo pide, y por tres razones
concretas: detrás de la guarda anti-rancio (3) y del camino de baja (4) para que
un evento rancio o una despublicación no escriban nada; detrás de 6 porque
necesita el `canonicalProductId`; y detrás de 7 para que un fallo del
`StoreProduct` —el choque de `@unique` que la spec ya contempla— no deje
códigos de una oferta que no existe.

Con `barcodes` vacía o con todos los códigos inválidos, el paso 8 **no hace
round trip**: `recordCanonicalBarcodes` devuelve 0 antes de tocar la base (E7,
E9). El coste del camino huérfano no cambia en absoluto.

## Contratos

### `src/lib/canonical.ts` — firmas nuevas

```ts
/** Las tres ramas de ADR 0004. Antes se llamaba `CanonicalResolution`. */
export type CanonicalIdentity =
  | { strategy: "explicit"; canonicalProductId: string }
  | { strategy: "by-ean"; ean: string }
  | { strategy: "orphan"; isExclusive: true };

/** La identidad Y lo que hay que guardar. Se devuelven juntas porque salen del
 *  mismo cómputo: normalizar la lista es lo que elige el código de la fusión. */
export type CanonicalResolution = {
  identity: CanonicalIdentity;
  /** Normalizada, deduplicada y ordenada ascendente. `[]` si nada era usable.
   *  Invariante: `identity.strategy === "orphan"` ⇒ `barcodes.length === 0`. */
  barcodes: readonly string[];
};

export type CanonicalInput = {
  canonicalProductId?: string | null;
  /** v4: la lista completa. Los elementos que `normalizeBarcode` rechaza se
   *  descartan aquí, no en el llamador. */
  barcodes?: readonly (string | null | undefined)[] | null;
};

export function resolveCanonicalIdentity(input: CanonicalInput): CanonicalResolution;

/** R3: `normalizeBarcode` elemento a elemento, descarta los `null`, deduplica y
 *  ordena con `Array.prototype.sort()` **sin comparador** — comparación por
 *  unidades de código, nunca numérica, nunca `localeCompare`. */
export function normalizeBarcodes(
  raw: readonly (string | null | undefined)[] | null | undefined,
): string[];
```

Cuerpo de `resolveCanonicalIdentity`, en cuatro líneas de decisión:

```ts
const barcodes = normalizeBarcodes(input.barcodes);
const explicit = input.canonicalProductId?.trim();
if (explicit) return { identity: { strategy: "explicit", canonicalProductId: explicit }, barcodes };
if (barcodes.length > 0) return { identity: { strategy: "by-ean", ean: barcodes[0] }, barcodes };
return { identity: { strategy: "orphan", isExclusive: true }, barcodes };
```

Tres consecuencias que hay que leer despacio:

- `barcodes[0]` **es** el menor, porque la lista viene ordenada: R4 y el criterio
  5 quedan garantizados por construcción, no por disciplina del llamador. Tres
  permutaciones de la misma lista producen el mismo `ean` (E3).
- En la rama explícita la lista **también** se devuelve, y el handler la escribe
  contra el canónico explícito (E13).
- `normalizeBarcode` se queda **exactamente como está**: no cambia una línea. Es
  la unidad que `src/lib/canonical.test.ts` ya verifica y la que `deriveEan` de
  `src/features/marketplace/server/dbFixtures.ts` respeta.

_Por qué la anidación (`{ identity, barcodes }`) y no un plano
`{ strategy, …, barcodes }`_: con la unión aplanada, cada `case` del handler
tendría que arrastrar `barcodes` y TypeScript no impediría olvidarlo en una
rama. Anidado, `resolution.barcodes` es un solo lugar. El precio es renombrar la
unión a `CanonicalIdentity`, que toca dos archivos que ya cambian de todos modos.

### `src/features/sync/schemas.ts` — el corte de contrato

```ts
export const productPayloadSchema = z.object({
  // …sin cambios…
  /** v4 (R1): obligatoria, lista de texto, `[]` válido. Sin `.max()` (R11):
   *  un tope sería un 400 permanente sobre un dato que el POS no puede cambiar. */
  barcodes: z.array(z.string()),
  /** v4 (R2): la clave singular está PROHIBIDA, no ignorada. Zod descarta las
   *  claves desconocidas en silencio, así que quitarla del objeto no cumpliría
   *  el criterio 1. `.optional()` es lo que deja pasar su ausencia. */
  barcode: z
    .never({ error: "`barcode` was removed in contract v4 — send `barcodes: string[]` instead" })
    .optional(),
  // …sin cambios…
});
```

Dos efectos buscados:

- El tipo inferido `ProductPayload` gana `barcode?: never`, así que **cualquier
  fixture del repo que siga poniendo la clave singular deja de compilar**. C11
  pasa de ser un grep a ser el compilador; la guarda G6 solo cubre lo que el
  compilador no ve (`.mjs`, prosa, JSON).
- El mensaje viaja en `issues` del `400`, que es lo único que el POS va a leer
  cuando su primer lote v3 rebote.

Si el `{ error }` de `z.never()` no lo acepta Zod 4.4 (verificable con
`npm run typecheck`), la alternativa mínima es `z.never().optional()` a secas y
el mensaje se documenta en el contrato; si `z.never()` diera problemas de tipo,
`z.undefined().optional()` produce el mismo rechazo. No se usa
`z.undefined()` sin `.optional()`: haría la clave **obligatoria** en el tipo y
todos los fixtures tendrían que escribir `barcode: undefined`.

### El escritor — src/features/sync/server/canonicalBarcodes.ts (por crear)

```ts
/** Lo que el escritor necesita, para que valgan igual el cliente global de
 *  `src/lib/prisma.ts` y el `PrismaClient` que construyen `prisma/seed.ts` y el
 *  script de medición. Mismo truco que `SearchIndexWriter`. */
export type CanonicalBarcodeWriter = Pick<PrismaClient, "canonicalBarcode">;

/**
 * R6 + R8: aditiva, idempotente, **una sentencia** y sin `$transaction`.
 * Devuelve cuántas filas se insertaron de verdad: 0 significa «ya estaban
 * todas», que es lo que hace que un reenvío no duplique (E2) y que el conjunto
 * final no dependa del orden de entrega (E16).
 */
export async function recordCanonicalBarcodes(
  db: CanonicalBarcodeWriter,
  canonicalProductId: string,
  eans: readonly string[],
): Promise<number>;
```

Cuerpo:

```ts
if (eans.length === 0) return 0; // E7/E9: ni un round trip
let inserted = 0;
for (let i = 0; i < eans.length; i += CANONICAL_BARCODE_INSERT_CHUNK) {
  const { count } = await db.canonicalBarcode.createMany({
    data: eans
      .slice(i, i + CANONICAL_BARCODE_INSERT_CHUNK)
      .map((ean) => ({ canonicalProductId, ean })),
    skipDuplicates: true, // INSERT … ON CONFLICT DO NOTHING
  });
  inserted += count;
}
return inserted;
```

El bucle **no** contradice R8: con `CANONICAL_BARCODE_INSERT_CHUNK = 1000` y una
lista realista (k ≤ 10 códigos por producto) hay **exactamente una** sentencia y
un round trip. El bucle existe para el caso absurdo que R11 permite: Postgres
acota una sentencia a 65 535 parámetros ligados y `createMany` gasta 2 por fila
(`canonicalProductId`, `ean`), así que sin trocear una lista de ~32 000 códigos
haría fallar el evento para siempre. Tres líneas compran ese borde.

Nada de `upsert` (k round trips), nada de leer antes para saber qué falta (un
`findMany` extra y una condición de carrera): `ON CONFLICT DO NOTHING` es la
idempotencia.

### La medición — la misma unidad, y su ejecutable

```ts
export type CanonicalBarcodeStats = {
  canonicalTotal: number;
  canonicalsWithBarcodes: number;
  canonicalsWithMultipleBarcodes: number;
  /** ≥ 1 código y ofertas VIVAS de ≥ 2 negocios. */
  canonicalsWithBarcodesAcrossBusinesses: number;
  /** ≥ 2 códigos y ofertas vivas de ≥ 2 negocios — el número que de verdad
   *  describe el escenario del humano; ver § Notas, N1. */
  canonicalsWithMultipleBarcodesAcrossBusinesses: number;
  /** Cuántos canónicos tienen 1, 2, 3… códigos. Orden ascendente por `barcodes`. */
  histogram: { barcodes: number; canonicals: number }[];
};

export async function countCanonicalBarcodeStats(
  db: Pick<PrismaClient, "$queryRaw">,
): Promise<CanonicalBarcodeStats>;

/** El texto exacto que imprime el criterio 6. Pura, así que su formato tiene
 *  prueba sin Postgres. */
export function formatCanonicalBarcodeStats(stats: CanonicalBarcodeStats): string;
```

Las dos consultas, compuestas **solo** con `Prisma.sql` (ADR 0019 (a); no llevan
ni un valor interpolado, y aun así no se usa `Unsafe`):

```sql
-- (1) las cinco cifras, un round trip
WITH per_canonical AS (
  SELECT "canonicalProductId" AS id, count(*) AS n
    FROM "CanonicalBarcode"
   GROUP BY "canonicalProductId"
),
per_business AS (
  SELECT sp."canonicalProductId" AS id, count(DISTINCT s."businessId") AS b
    FROM "StoreProduct" sp
    JOIN "Store" s ON s."id" = sp."storeId"
   WHERE sp."deletedAt" IS NULL
   GROUP BY sp."canonicalProductId"
)
SELECT (SELECT count(*) FROM "CanonicalProduct")                       AS "canonicalTotal",
       (SELECT count(*) FROM per_canonical)                            AS "canonicalsWithBarcodes",
       (SELECT count(*) FROM per_canonical WHERE n >= 2)               AS "canonicalsWithMultipleBarcodes",
       (SELECT count(*) FROM per_canonical c
          JOIN per_business b ON b.id = c.id WHERE b.b >= 2)           AS "canonicalsWithBarcodesAcrossBusinesses",
       (SELECT count(*) FROM per_canonical c
          JOIN per_business b ON b.id = c.id
         WHERE c.n >= 2 AND b.b >= 2)                                  AS "canonicalsWithMultipleBarcodesAcrossBusinesses";

-- (2) el histograma, otro round trip
SELECT n AS "barcodes", count(*) AS "canonicals"
  FROM (SELECT "canonicalProductId", count(*) AS n
          FROM "CanonicalBarcode" GROUP BY "canonicalProductId") t
 GROUP BY n
 ORDER BY n;
```

Dos consultas y no una porque un histograma no cabe en la misma fila que cinco
escalares, y **no** van en un `$transaction`: es una medición, no un invariante
transaccional, y el pooler prohíbe la transacción de todos modos (R8). `count(*)`
llega como `BigInt`; se convierte con `Number(...)`, igual que
`scripts/backfill-search-vector.ts` ya hace con sus dos conteos.

`deletedAt IS NULL` es la mitad que decide el número: un negocio que borró su
oferta ya no afirma nada (spec.md § Datos y contrato). No se filtra por
`visible` ni por `Store.status`: la oferta existe aunque el panel la esconda, y
meter la publicación del local en la medición mezclaría dos preguntas.

Salida exacta del ejecutable, una línea por cifra y una por hueco del
histograma, en `clave: valor` para que sea greppable y pegable en
`.agent/specs/F-024/tests.md`:

```
canonicalTotal: 19
canonicalsWithBarcodes: 9
canonicalsWithMultipleBarcodes: 1
canonicalsWithBarcodesAcrossBusinesses: 0
canonicalsWithMultipleBarcodesAcrossBusinesses: 0
histogram[1]: 8
histogram[3]: 1
```

(Las cifras del ejemplo **no** son un aserto: son el orden de magnitud que se
deduce de leer `prisma/seed.ts` sin Postgres levantado — spec.md I1 avisa de lo
mismo. Lo que se pega en `tests.md` es la salida real.)

El ejecutable, calcado de `scripts/backfill-search-vector.ts`: carga explícita
de dotenv, `PrismaClient` propio con `PrismaPg` (no el cliente de
`src/lib/prisma.ts`, que asume runtime de Next), `--json` opcional para volcar el
objeto tal cual, `process.exit(1)` solo si la consulta explota, y
`$disconnect()` en el `finally`. Se añade el alias `count:barcodes` a
`package.json` por descubribilidad; el comando del criterio 6
(`npx tsx scripts/count-canonical-barcodes.ts`) sigue funcionando igual.

### Tabla de errores

Ninguno nuevo en el handler. Lo que cambia es **cuándo** aparece el primero:

| Código / estado                 | Cuerpo o `status`                        | Cuándo, después de la v4                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`                           | `{"error":"INVALID_BATCH","issues":[…]}` | `barcodes` ausente, no lista, o con un elemento que no es texto; **o** la clave singular presente. Lote entero                                                                                                                                          |
| `403`                           | `{"error":"BUSINESS_MISMATCH"}`          | Sin cambios (F-018), antes de resolver identidad                                                                                                                                                                                                        |
| `207` + `skipped_not_published` | —                                        | Tienda de otro negocio o inexistente. Sin cambios                                                                                                                                                                                                       |
| `207` + `stale`                 | —                                        | `updatedAt` no posterior. **Ningún código escrito** (E15)                                                                                                                                                                                               |
| `207` + `duplicate`             | —                                        | `eventId` ya visto. Ningún código escrito (E2)                                                                                                                                                                                                          |
| `207` + `failed`                | mensaje del error                        | Choque de `CanonicalProduct.ean @unique` entre dos negocios simultáneos (como hoy), o FK violada si alguien borró el canónico entre el paso 6 y el 8. La escritura de códigos **no añade modos de fallo nuevos**: sus conflictos de unicidad se ignoran |
| `500`                           | `{"error":"BATCH_FAILED"}`               | Sin cambios                                                                                                                                                                                                                                             |

## Modelo de datos y migraciones

### `prisma/schema.prisma`

```prisma
/// Every valid barcode of a canonical product (F-024). ADDITIVE: rows are
/// inserted and never deleted, not even when the POS stops sending a code —
/// no `businessId` here means a row does not say WHO contributed it, so
/// deleting on one business's behalf would delete another's (R6, ADR 0020).
/// `ean` is unique PER canonical, never globally: the same code living in two
/// canonicals is the fact the F-024 measurement exists to count (R7).
model CanonicalBarcode {
  id                 String   @id @default(uuid())
  canonicalProductId String
  /// Already normalized: digits only, length 8/12/13/14.
  ean                String
  createdAt          DateTime @default(now())

  canonicalProduct CanonicalProduct @relation(fields: [canonicalProductId], references: [id], onDelete: Cascade)

  @@unique([canonicalProductId, ean])
  @@index([ean])
}
```

Y en `CanonicalProduct`, una sola línea nueva junto a `aliases`:

```prisma
  barcodes CanonicalBarcode[]
```

`CanonicalProduct.ean` **no se toca**: sigue `String? @unique` y sigue siendo la
clave de fusión (R5, spec.md § Fuera).

Nada más cambia en el schema. Los dos índices GIN siguen sin estar declarados,
igual que antes: F-024 no los declara ni los borra.

### La migración: prisma/migrations/TIMESTAMP_canonical_barcode/migration.sql (por crear)

**Cómo se genera** (R12, y las dos fichas del playbook que la spec cita):

1. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   — compara contra la base configurada, no contra la shadow DB, así que no
   revalida checksums viejos.
2. Del resultado se conserva **solo** el DDL de `CanonicalBarcode`. Se borran:
   los dos `DROP INDEX` de `CanonicalProduct_searchVector_idx` y
   `CanonicalProduct_name_trgm_idx` —que el diff propone siempre porque no están
   en `prisma/schema.prisma`— y cualquier otra sentencia que sea drift de otro
   worktree, no de este feature.
3. Se crea la carpeta a mano y se le añade el backfill.
4. Se aplica con `npx prisma migrate deploy`. **No** `npm run db:migrate`
   (`prisma migrate dev`): sobre la base local compartida ofrece resetear el
   esquema `public`, y `migrate reset` está prohibido.

**Contenido**, con el backfill dentro y en este orden:

```sql
-- F-024: CanonicalBarcode — every valid barcode of a canonical product.
--
-- Hand-written, NOT the raw `prisma migrate diff` output. Two `DROP INDEX` on
-- CanonicalProduct_searchVector_idx / CanonicalProduct_name_trgm_idx that the
-- diff proposes here are intentionally OMITTED: those GIN indexes are
-- hand-created (F-015) and not represented in schema.prisma. See
-- .agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md.

CREATE TABLE "CanonicalBarcode" (
    "id" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "ean" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalBarcode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CanonicalBarcode_ean_idx" ON "CanonicalBarcode"("ean");

CREATE UNIQUE INDEX "CanonicalBarcode_canonicalProductId_ean_key"
    ON "CanonicalBarcode"("canonicalProductId", "ean");

ALTER TABLE "CanonicalBarcode"
    ADD CONSTRAINT "CanonicalBarcode_canonicalProductId_fkey"
    FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (R13). Idempotent by the unique index created above: applying this
-- against an already-migrated database inserts 0 rows, and so does a second
-- run. `id` has NO database default — Prisma generates uuids client-side — so
-- the INSERT must supply one; gen_random_uuid() is built in from Postgres 13.
INSERT INTO "CanonicalBarcode" ("id", "canonicalProductId", "ean")
SELECT gen_random_uuid()::text, cp."id", cp."ean"
  FROM "CanonicalProduct" cp
 WHERE cp."ean" IS NOT NULL
    ON CONFLICT ("canonicalProductId", "ean") DO NOTHING;
```

Dos trampas señaladas a propósito, porque las dos rompen la migración en su
primer intento:

- **`id` no tiene `DEFAULT`.** `@default(uuid())` de Prisma se genera en el
  cliente; la columna en Postgres no lleva default (mira cualquier tabla de
  `prisma/migrations/20260825000000_init/migration.sql`). Un
  `INSERT … SELECT` sin la columna `id` falla por `NOT NULL`.
- **El `ON CONFLICT` necesita el índice único creado antes**, y lo está: las
  cuatro sentencias van en ese orden y Postgres corre cada migración en una
  transacción, así que o entra todo o no entra nada.

A diferencia del backfill de F-015 (que se dejó fuera de la base local
compartida a propósito), este **sí** se aplica en local: la tabla tiene que
existir para que el proyecto `db` de vitest corra, y el backfill es barato
(un `INSERT` por canónico con `ean`, ~9 filas en el seed) e idempotente.

C10 se comprueba con una consulta, no leyendo el archivo:

```sql
SELECT count(*) FROM "CanonicalProduct" cp
 WHERE cp."ean" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "CanonicalBarcode" b
                    WHERE b."canonicalProductId" = cp."id" AND b."ean" = cp."ean");
-- tiene que dar 0
```

### Qué cambia en los datos sembrados

`prisma/seed.ts`, con el mínimo movimiento que preserva C9:

- `SeedProduct` gana `extraEans?: readonly string[]`. **No** se convierte `ean`
  en `eans: string[]`: `ean` es la clave de fusión y la que `upsertCanonical`
  busca con `findUnique`; renombrarla obligaría a elegir cuál de la lista es la
  clave en veinte fixtures y podría cambiar los canónicos que C9 exige
  invariantes.
- `upsertCanonical` pasa a llamar al escritor nuevo con el `ean` y los extra ya
  normalizados:

  ```ts
  await recordCanonicalBarcodes(
    prisma,
    canonical.id,
    normalizeBarcodes([product.ean, ...(product.extraEans ?? [])]),
  );
  ```

  Por el mismo escritor que el sync, nunca un `createMany` propio. Es la misma
  regla que F-015 impuso con `writeSearchDocument` (ADR 0019 (b), guarda G1).

- El producto con tres códigos es `DEMO_PRODUCTS[0]` («Refresco de cola 1.5 L»,
  `ean` `7501031311309`, `prisma/seed.ts:57`): su canónico es uno de los tres
  que el seed comparte a propósito, así que el histograma tiene un hueco en 3
  **sin** tocar el número de canónicos ni de `StoreProduct` (C4/C9). Los dos
  códigos extra tienen que ser GTIN válidos y no coincidir con ningún `ean` de
  otro fixture, para que el número de canónicos no se mueva ni por casualidad.
- El objeto de conteos (`prisma/seed.ts:513-519`) gana una clave `barcodes` con
  el `count()` de la tabla nueva. Ninguna prueba afirma sobre la forma de ese
  objeto (`grep -rn "Done:"` da solo la línea del propio seed), y es lo que hace
  visible E17 en la salida que C9 compara.

`src/features/marketplace/server/dbFixtures.ts`:

- `createCanonical` escribe también la fila del `ean` que ya deriva, por
  `recordCanonicalBarcodes`, y acepta `extraEans?: readonly string[]` para el
  fixture que necesite varias (los EAN siguen saliendo de `deriveEan`, que ya
  garantiza que no chocan con el seed).
- `cleanup()` **no cambia**: la FK es `onDelete: Cascade`, así que borrar el
  `CanonicalProduct` se lleva sus códigos. Un `delete` explícito nuevo sería
  ruido.
- El comentario de `deriveEan` (`src/features/marketplace/server/dbFixtures.ts:37`)
  gana una línea: `CanonicalProduct.ean` sigue siendo único, pero un canónico
  puede tener ahora varios códigos en `CanonicalBarcode` (spec.md I6).

## Escalabilidad y límites

**Escrituras.** +1 round trip por evento `PRODUCT` con al menos un código
válido; 0 en los demás caminos. Hoy `handleProduct` gasta 8–11 round trips por
evento (tienda, oferta, canónico, `writeSearchDocument`, categoría, slug único,
alias, y el recálculo del documento si el alias es nuevo), así que el sobrecoste
es del **~10 %**. En el peor lote —500 eventos, todos productos con códigos, en
serie— son +500 round trips: a ~5 ms de latencia contra el pooler, **+2,5 s**
sobre los 20–27 s que ese lote ya cuesta. El lote ya está limitado por latencia,
no por CPU ni por filas, y este cambio no cambia su forma. Si algún día hay que
bajarlo, la palanca está identificada y descartada arriba (acumular por lote).

**Filas.** `CanonicalBarcode` crece como (canónicos × códigos distintos por
canónico). Hoy: 9 canónicos con `ean` → 9 filas, 11 con el fixture de tres. A
100× —10 000 canónicos con una media de 1,5 códigos— son 15 000 filas: nada. El
techo realista lo pone el catálogo, no la tabla: 1 000 negocios × 5 000
productos con 1,5 códigos ≈ **7,5 M de filas**, ~450 MB con sus dos índices.
Sigue siendo una tabla pequeña para Postgres, y ninguna consulta del camino de
lectura la toca.

**Lecturas del camino caliente: ninguna.** La tienda pública y el marketplace
**no** leen `CanonicalBarcode`. El único riesgo real es que la relación nueva
invite a un `include: { barcodes: true }` en `src/features/marketplace/server/search.ts`
o en las lecturas del storefront: sería un N+1 —o un join que multiplica filas—
en la consulta que más se ejecuta del repo, a cambio de un dato que nadie
muestra. Está prohibido en § Antipatrones.

**La medición.** Dos escaneos completos: `CanonicalBarcode` agrupado, y
`StoreProduct ⋈ Store` agrupado. Con 7,5 M de códigos y 5 M de ofertas el
segundo `GROUP BY` es de decenas de segundos. Es un ejecutable de consola sin
timeout ni HTTP delante, corrido a mano y a lo sumo una vez por decisión: se
acepta. Lo que **no** se hace nunca es exponerlo en una ruta ni llamarlo desde
un render; si el día del grafo hace falta seguirlo, será una vista materializada
de ese feature.

**Índices y por qué esos dos.** `@@unique([canonicalProductId, ean])` sirve dos
cosas a la vez: la idempotencia del `ON CONFLICT` y la consulta «los códigos de
este canónico» (prefijo del índice). `@@index([ean])` es el que el feature del
grafo necesitará para «qué canónicos comparten este código» y el que hace la
pregunta del criterio 6 barata; sin él, esa búsqueda es un `Seq Scan`. No se
añade ningún otro: un índice que nadie consulta se paga en cada `INSERT`.

**Caché, ISR, bundle.** Sin cambios. Los tags que `processCatalogBatch`
invalida son los mismos —los códigos no se renderizan, así que no hay nada que
revalidar de más— y no se añade un byte de JavaScript de cliente.

**Techo del proyecto `db`.** Sigue en 3 archivos `*.db.test.ts` de los 6 que
`vitest.config.mts` declara como techo: los casos nuevos de F-024 van a
`src/features/sync/server/handlers/product.db.test.ts`, que ya existe, y no se
crea un archivo `db` nuevo.

## Patrones a seguir / antipatrones a evitar

**A seguir:**

- **Cliente por parámetro, no importado**, en el módulo nuevo
  (`CanonicalBarcodeWriter = Pick<PrismaClient, "canonicalBarcode">`). Es lo que
  permite que `prisma/seed.ts` y un script con su propio `PrismaClient` usen el
  mismo escritor. Copiado de `src/features/marketplace/server/searchVector.ts`.
- **Un solo escritor por tabla.** Como `writeSearchDocument` con
  `searchDocument`/`searchVector` (ADR 0019 (b)): seed, fixtures y handler pasan
  todos por `recordCanonicalBarcodes`.
- **`Prisma.sql` siempre, `Unsafe` nunca** (ADR 0019 (a)), aunque la consulta no
  lleve parámetros.
- **Idempotencia por construcción, no por lectura previa**:
  `ON CONFLICT DO NOTHING`, igual que el `WHERE` de `writeSearchDocument` hace que un reenvío
  sea un `UPDATE` de 0 filas.
- **Prosa del arnés con rutas completas** desde la raíz del repo, y los archivos
  que aún no existen **sin** comillas invertidas y con «(por crear)»
  (`AGENTS.md` § Cosas que muerden, las dos entradas de `check:harness`).
- **Código en inglés** en todo lo nuevo, incluidos los nombres de las cifras que
  el script imprime; español en el contrato, la ADR y esta prosa.

**A evitar:**

- **`$transaction` alrededor de la escritura de códigos.** El pooler corre en
  modo transacción (`AGENTS.md`, `.agent/playbook/pooler-transaccion-deadlock.md`).
- **Escribir códigos antes de la guarda anti-rancio o en el camino de baja.** R10,
  E14, E15. El orden del § Flujo de datos no es sugerencia.
- **Reescribir `CanonicalProduct.ean`.** Ni en un canónico existente (R5) ni al
  crear uno por la rama explícita: ponerle `ean = barcodes[0]` puede chocar con
  el `@unique` de otro canónico y dejar el evento en `failed` **para siempre**,
  porque el reintento choca igual. La rama explícita sigue creando el canónico
  sin `ean`, exactamente como hoy (`src/features/sync/server/handlers/product.ts:163-170`),
  y sus códigos se guardan igual (E13).
- **Buscar el canónico por `CanonicalBarcode`.** R4: solo por
  `CanonicalProduct.ean` y solo con `barcodes[0]`. Buscar por la tabla nueva
  sería cambiar la fusión, que es justo lo que F-024 promete no hacer.
- **`include: { barcodes: … }`** en cualquier lectura de catálogo, búsqueda o
  panel. § Escalabilidad dice qué cuesta.
- **Meter los códigos en `searchDocument`/`searchVector`** (R9): rompería la
  guarda G1 de `src/features/marketplace/server/boundaries.test.ts` y ensuciaría
  el ranking.
- **`.max()` en `barcodes`** (R11) y **`@unique` global en
  `CanonicalBarcode.ean`** (R7).
- **`npm run db:migrate`, `prisma migrate reset`, `prisma db push`** en este
  feature. La ruta es `migrate diff` + carpeta a mano + `migrate deploy`.
- **Escribir `"barcode"` entre comillas dobles en `docs/sync-contract.md`.** C7
  lo verifica con `grep -n '"barcode"'` y espera cero líneas: la clave singular
  se menciona en el contrato entre comillas invertidas o sin comillas, nunca
  entre dobles. Es la trampa más fácil de pisar al escribir la v4, porque lo
  natural es citarla como aparecía en el JSON.

## Pruebas: qué se prueba dónde

| Nivel                        | Archivo                                                        | Qué cubre                                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unitaria pura                | `src/lib/canonical.test.ts`                                    | `normalizeBarcodes` (E6, E8), las tres permutaciones → mismo `ean` (C5), lista vacía y todos inválidos → huérfano (E7, E9), explícita con códigos (E13)                                                                  |
| Unitaria del formato         | src/features/sync/server/canonicalBarcodes.test.ts (por crear) | `formatCanonicalBarcodeStats` imprime las cinco claves y el histograma (E18) sin Postgres; `recordCanonicalBarcodes` con `[]` no llama al cliente                                                                        |
| Unitaria del handler (mocks) | `src/features/sync/server/handlers/product.test.ts`            | El mock de `@/lib/prisma` gana `canonicalBarcode: { createMany }`; asertos de **orden** (códigos entre oferta y alias) y de que `DELETE`/`stale` no lo llaman                                                            |
| Ruta                         | `src/app/api/internal/sync/catalog/route.test.ts`              | `400 INVALID_BATCH` con la clave singular, con `barcodes` ausente, con `barcodes` no lista y con un elemento numérico; `processCatalogBatch` nunca llamado (C1, E10–E12)                                                 |
| Postgres real                | `src/features/sync/server/handlers/product.db.test.ts`         | E1, E2, E3, E5, E7, E8, E13, E16 con EAN de `deriveEan`; y el medio C1 «no se escribió nada» llamando al `POST` real con `session.syncToken`                                                                             |
| Guardas por disco            | `src/app/api/internal/boundaries.test.ts`                      | **G6**: ninguna línea de `src/`, `scripts/` ni `prisma/` usa la clave singular como clave de payload (C11). **G7**: exactamente un archivo de producción nombra el delegado `canonicalBarcode` o la tabla entre comillas |
| Ejecutable                   | scripts/count-canonical-barcodes.ts (por crear)                | C6: sale 0 e imprime; la salida literal se pega en `.agent/specs/F-024/tests.md`                                                                                                                                         |

Dos precisiones para quien escriba las pruebas:

- **G6 necesita una regex, no un `includes`.** `/\bbarcode\s*:/` no captura
  `barcodes:` (después de `barcode` viene una `s`) pero sí `barcode :`. El
  archivo de la guarda tiene que construir el literal partido en dos —como ya
  hace con `PAYLOAD_BUSINESS_ID` y con la variable retirada de F-018— para no
  dispararse contra su propio código fuente.
- **El medio `db` de C1 no es una tautología si pasa por el `POST`.** Importar
  la ruta y mandarle un `Request` con `Authorization: Bearer session.syncToken`
  prueba lo que de verdad importa: que el `safeParse` va **delante** de
  `recordBatch`, y por tanto que un lote v3 no deja ni fila de `SyncEvent` que
  un reintento pueda reportar como `duplicate`. Si importar la ruta en el
  proyecto `db` diera problemas de contexto de Next, el plan B es afirmar sobre
  `catalogBatchSchema.safeParse` más el aserto de ruta que ya existe, y anotar
  en `tests.md` por qué.

## Etapas propuestas para `plan.md`

| Etapa | Qué                                                                                                                                                                | Verificable con                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1     | `prisma/schema.prisma` + la migración (por crear) + `npx prisma generate` + `npx prisma migrate deploy`                                                            | C10 (la consulta del backfill da 0), `bash .agent/verify.sh F-024` en verde        |
| 2     | `src/lib/canonical.ts` (`normalizeBarcodes`, firma nueva) + `src/lib/canonical.test.ts`                                                                            | C3 y C5 en su mitad unitaria                                                       |
| 3     | `src/features/sync/schemas.ts` (v4) + `src/app/api/internal/sync/catalog/route.test.ts`                                                                            | C1; el typecheck señala **solo** los fixtures que quedan por migrar                |
| 4     | src/constants/sync.ts + src/features/sync/server/canonicalBarcodes.ts (por crear) + `src/features/sync/server/handlers/product.ts` + sus dos pruebas               | C2, C3 en su mitad `db`                                                            |
| 5     | La cola: `prisma/seed.ts`, `src/features/marketplace/server/dbFixtures.ts`, `scripts/send-catalog-batch.mjs`, G6 y G7 en `src/app/api/internal/boundaries.test.ts` | C9 (invariancia del seed antes/después), C11, E17 (`npm run seed && npm run seed`) |
| 6     | scripts/count-canonical-barcodes.ts (por crear) + `package.json` + la salida anotada en `.agent/specs/F-024/tests.md`                                              | C6                                                                                 |
| 7     | `docs/sync-contract.md` v4 + `docs/adr/0020-todos-los-codigos-una-sola-fusion.md` (aceptar o borrar, AP1)                                                          | C7, C8 (`bash .agent/verify.sh F-024 --full` en 0)                                 |

El orden importa en un punto: **C9 se mide antes de la etapa 5**. La salida de
`npm run seed` de hoy —`canonical` y `products`— hay que anotarla en
`.agent/specs/F-024/tests.md` **antes** de tocar el seed; después ya no hay
«antes» con el que comparar.

### Lo que hay que escribir en `docs/sync-contract.md`

Para que el orquestador pueda planificarlo sin releer el contrato: sube el
encabezado a «Versión 4», añade una sección «Cambios respecto a la v3» con las
tres frases que la spec exige (lista, `400` de la clave singular, la fusión
sigue usando un código: el menor de los válidos), cambia la fila del mapeo de
nombres (`docs/sync-contract.md:184`) por `barcodes` → «`CodigoProducto.codigo`
de **todas** las filas del producto», cambia el `payload` de `PRODUCT`
(`docs/sync-contract.md:200`), reescribe el punto 2 de «Transformación en
queandabuscando» (`docs/sync-contract.md:346-350`) y añade el paso de los
códigos entre el 3 y el 4, añade la fila `400 INVALID_BATCH` a la tabla de
errores (`docs/sync-contract.md:101`) diciendo que se rechaza el lote entero y
no queda `SyncEvent`, añade a «Modos de falla» que un POS que siga en v3 **no
sincroniza nada** hasta migrar (I3), y añade a § Verificación la línea del flag
nuevo de `scripts/send-catalog-batch.mjs` que provoca el `400` a mano.

## Riesgos y plan B

| Riesgo                                                                                       | Probabilidad | Plan B                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createMany({ skipDuplicates: true })` no hace lo esperado con el driver adapter de Prisma 7 | Baja         | `$executeRaw` con `Prisma.sql`/`Prisma.join`: `INSERT INTO "CanonicalBarcode" ("id","canonicalProductId","ean") VALUES (gen_random_uuid()::text, $1, $2), … ON CONFLICT ("canonicalProductId","ean") DO NOTHING`. Mismo round trip, misma idempotencia, y `createdAt` lo pone el `DEFAULT` |
| `z.never({ error })` no compila en Zod 4.4                                                   | Media        | `z.never().optional()` a secas; el mensaje se documenta en el contrato. Si el tipo inferido dejara la clave obligatoria, `z.undefined().optional()`                                                                                                                                        |
| `prisma migrate diff` arrastra drift de otro worktree a la migración                         | Alta         | Es lo que la ficha del checksum avisa: se conservan **solo** las cuatro sentencias de `CanonicalBarcode` más el backfill, y se revisa el archivo línea por línea antes de aplicar                                                                                                          |
| Aplicar con `migrate deploy` desde este worktree deja a los demás con drift                  | Alta         | Ya está fichado como riesgo abierto y **se escala al humano**, no se resuelve en silencio (`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md` § Cómo se evita)                                                                                                           |
| El typecheck de la etapa 3 tumba media suite de golpe                                        | Alta         | Es el efecto **buscado**: la lista de errores del compilador **es** la cola del punto 8 del alcance. Se recorre entera antes de pasar a la 4, no se silencia con `as`                                                                                                                      |
| Alguien «mejora» la fusión buscando por `CanonicalBarcode`                                   | Media        | R4 y § Antipatrones; el aserto de C5 en `product.db.test.ts` (E5: cod2 en dos canónicos) se pondría rojo                                                                                                                                                                                   |
| El número de canónicos del seed se mueve al añadir los códigos extra                         | Baja         | Los códigos extra viven en `CanonicalBarcode`, no en `CanonicalProduct.ean`, así que no pueden mover la fusión. C9 lo comprueba de todos modos                                                                                                                                             |
| La consulta de medición se vuelve lenta y alguien la mete en una ruta                        | Baja         | § Escalabilidad lo prohíbe explícitamente; hoy no existe ninguna ruta que la llame                                                                                                                                                                                                         |

## ¿Hace falta una ADR?

**Sí, y está escrita en borrador:**
`docs/adr/0020-todos-los-codigos-una-sola-fusion.md`.

Motivo: [ADR 0004](../../../docs/adr/0004-identidad-canonica-en-el-sync.md)
describe las tres ramas de la identidad y **no dice nada** de qué pasa con los
códigos que no la resolvieron, porque hasta ahora se tiraban. F-024 añade tres
hechos estructurales que van a leerse desde fuera del feature: que se guardan
todos, que la fusión sigue usando uno solo (el menor), y que **el mismo código
puede vivir en dos canónicos a propósito**. Sin ADR, el primero que vea ese
duplicado lo va a tratar como un bug de integridad y lo va a «arreglar» con un
`@unique` global, que es exactamente lo que destruye la medición. La ADR extiende
la 0004, no la supera, y deja anotado qué reabre el número del criterio 6.

Está marcada **Propuesta**; pasa a **Aceptada** cuando el humano firme
`plan.md` (AP1). Si la descarta, se borra el archivo y su cita de la etapa 7:
nada del código depende de ella.

## Notas para el orquestador

- **N1 — la spec se contradice a sí misma, en pequeño, sobre la cuarta cifra.**
  El párrafo en prosa de spec.md § Datos y contrato la llama «canónicos con
  **más de un código** cuyas ofertas vivas pertenecen a más de un negocio»,
  mientras la definición exacta de la lista de abajo dice «canónicos con **≥ 1**
  fila y `COUNT(DISTINCT Store.businessId) >= 2`». No son el mismo número. Gana
  la definición exacta (es la que existe «para que dos personas obtengan el
  mismo número»), y el diseño **imprime las dos**: la cuarta cifra tal como la
  define la lista, y una quinta,
  `canonicalsWithMultipleBarcodesAcrossBusinesses`, que es la de la prosa y la
  que de verdad describe el escenario del humano. Cuesta un `AND` y quita la
  ambigüedad para siempre. No es una pregunta: es un superconjunto de lo que E18
  pide.
- **N2 — un caso límite de la spec describe mal el código de hoy.** La fila «El
  producto pierde todos sus códigos en un `UPDATE`» dice «pasa a huérfano y
  **cambia de canónico**, exactamente como hoy con la clave singular a `null`».
  Hoy **no** cambia de canónico: la rama huérfana reutiliza el canónico que ese
  `(storeId, externalId)` ya tenía
  (`src/features/sync/server/handlers/product.ts:207-211`), que puede ser
  perfectamente un canónico compartido por EAN. El «exactamente como hoy» es lo
  que manda y el comportamiento **no se toca**; queda anotado para que el tester
  no escriba un aserto de «cambia de canónico» que sería rojo contra código
  correcto.
- **N3 — el `barcode?: never` del tipo hace la mitad del trabajo de C11.** En
  cuanto la etapa 3 aterrice, el typecheck señala cada fixture `.ts` que aún
  usa la clave singular. Lo que **no** ve el compilador —`scripts/*.mjs`, JSON,
  prosa— es lo que cubre la guarda G6. Conviene que el implementador no arregle
  los errores del compilador uno a uno a ciegas: la lista completa es
  `src/features/sync/server/handlers/product.db.test.ts` (nueve fixtures),
  `src/features/sync/server/handlers/product.test.ts:63`,
  `src/lib/canonical.test.ts` y `scripts/send-catalog-batch.mjs:55`.
- **N4 — SP1/SP2 no vuelven a este documento.** C4 se cierra por C9 y C6 con la
  salida de desarrollo, ambas resueltas por el humano el 2026-08-28. El diseño
  las asume: por eso la etapa 5 exige anotar la salida del seed **antes** de
  tocarlo, y por eso el ejecutable no depende de que exista integración viva.

## Preguntas al humano

**AP1 — ¿se acepta la ADR 0020, o se descarta y F-024 no deja ADR?**
_Qué está en juego:_ tres hechos estructurales (se guardan todos los códigos, la
fusión sigue por uno, el mismo código puede vivir en dos canónicos) quedan o no
en el registro que los features futuros leen. El borrador ya está escrito en
`docs/adr/0020-todos-los-codigos-una-sola-fusion.md`.
_Opciones:_ (a) aceptarla — el implementador solo cambia «Propuesta» por
«Aceptada · 28 de agosto de 2026 · F-024» en la etapa 7; (b) descartarla y
borrar el archivo, dejando la decisión solo en `docs/sync-contract.md` v4 y en
esta `architecture.md`; (c) aceptarla pero esperando al feature del grafo para
escribirla completa.
_Recomendación:_ **(a)**. La consecuencia asumida —un `ean` en dos canónicos— es
un invariante que **parece** un bug de integridad; sin ADR, el primero que lo
vea le pone un `@unique` global y destruye la medición del criterio 6 sin
enterarse. (c) es lo peor de las dos: la decisión se toma ahora y el registro
llega tarde. (b) es defendible si el humano prefiere no gastar el número 0020
en algo que el feature del grafo va a reescribir.

No hay ninguna otra: las dos decisiones que parecían abiertas al diseñar —qué
pasa con el `ean` de un canónico explícito recién creado (§ Antipatrones) y cuál
de las dos definiciones de la cuarta cifra vale (N1)— las resuelve la propia
spec en cuanto se leen sus dos textos juntos, y quedan documentadas arriba en
vez de rebotar al humano.
