---
feature: F-024
agente: sdd-tester
actualizado: 2026-08-28T06:00:00Z
estado: listo
veredicto: listo
---

## Estrategia

Los 11 criterios de `spec.md` § Criterios de aceptación propuestos (8 `[ya]`
literales de `.agent/features.json` + C9/C10/C11 `[nuevo]`) se verifican
**ejecutando**, no leyendo: unitaria pura (`src/lib/canonical.test.ts`, proyecto
`node`), ruta con mocks (`src/app/api/internal/sync/catalog/route.test.ts`,
proyecto `server`), Postgres real (`src/features/sync/server/handlers/product.db.test.ts`
y `src/app/api/internal/boundaries.test.ts`, proyecto `db`, contra
`queandabuscando-postgres` ya sano), un ejecutable de consola
(`scripts/count-canonical-barcodes.ts`), dos consultas SQL ad-hoc para C9/C10
que yo mismo escribí y corrí (borradas después, no quedan en el repo), y una
petición HTTP real contra `npm run dev` con un token acuñado con `npm run
mint:token -- seed-negocio-1`, para C1. Todo lo que sigue es una repetición
mía de lo que `sdd-implementer` ya corrió, no una lectura de su `tests.md`
anterior: donde el número coincide lo digo; donde no aplica (el "antes" del
seed, capturado antes de que existiera código mío para repetirlo) lo dejo
igual pero confirmo el "después" con mis propias corridas.

Precondición confirmada antes de cualquier prueba:

```
$ npx prisma migrate status
8 migrations found in prisma/migrations
Database schema is up to date!
```

La migración `20260828045433_canonical_barcode` ya está aplicada. No hizo
falta `docker compose up -d postgres`: `queandabuscando-postgres` ya estaba
arriba (`Up 16 hours (healthy)`).

## C9 — invariancia del seed (forma verificable de C4, SP1 ya resuelta)

### Antes de tocar `prisma/seed.ts` (capturado por sdd-implementer, no repetible por mí — es histórico)

```
Done: { stores: 15, storefronts: 10, canonical: 19, aliases: 22, products: 28 }
Done: { stores: 15, storefronts: 10, canonical: 19, aliases: 22, products: 28 }
```

### Después — reejecutado por mí, dos veces seguidas

```
$ npm run seed
Done: { stores: 15, storefronts: 10, canonical: 19, aliases: 22, products: 28, barcodes: 11 }

$ npm run seed
Done: { stores: 15, storefronts: 10, canonical: 19, aliases: 22, products: 28, barcodes: 11 }
```

`canonical: 19` y `products: 28` — idénticos al "antes" e idénticos entre mis
dos corridas (E17, idempotencia confirmada de nuevo por mí). La fusión no
cambió de comportamiento.

Los tres EAN que el seed comparte a propósito, reconsultados por mí con mi
propia conexión (`Prisma.sql`, sin `Unsafe`):

```sql
SELECT cp.ean, count(DISTINCT sp.id) AS store_products, count(DISTINCT cp.id) AS canonicals
FROM "CanonicalProduct" cp
JOIN "StoreProduct" sp ON sp."canonicalProductId" = cp.id
WHERE cp.ean IN ('7501031311309','7501000110018','7501000220017')
GROUP BY cp.ean;
```

```
7501000110018 store_products: 3 canonicals: 1
7501000220017 store_products: 2 canonicals: 1
7501031311309 store_products: 4 canonicals: 1
```

Confirmado: **un canónico cada uno** (`canonicals = 1` en las tres filas) —
la parte de C9/C4 que importa (la fusión no cambió). La cifra de
`store_products` ya no es "dos" para ninguno (da 3/2/4): confirmo lo que
`impl.md` § Deuda dejada ya documentó — es la misma caducidad que I1 fichó
para "17 canónicos de 20 productos", causada por fixtures de F-017/F-018
(`seedBrandWithBranches`, `OTHER_BUSINESS_PRODUCTS`) que añadieron tiendas
que comparten estos EAN, **ajena a F-024** (este ciclo no tocó ninguna
asociación tienda↔producto, solo `extraEans` y la escritura de
`CanonicalBarcode`). No lo reporto como regresión ni reabro SP1/el número
17/20, según instrucción explícita.

**Veredicto C9/C4: LISTO.**

## C6 — script de medición

```
$ npx tsx scripts/count-canonical-barcodes.ts
canonicalTotal: 19
canonicalsWithBarcodes: 9
canonicalsWithMultipleBarcodes: 1
canonicalsWithBarcodesAcrossBusinesses: 0
canonicalsWithMultipleBarcodesAcrossBusinesses: 0
histogram[1]: 8
histogram[3]: 1
```

Exit code `0`. Salida idéntica a la que `impl.md`/`tests.md` anterior ya
tenían pegada — reconfirmada, no solo releída. El cuarto y quinto número en
`0` es lo esperado (SP2, ya resuelta): ningún negocio del seed comparte EAN
con otro. No se reabre SP2.

**Veredicto C6: LISTO.**

## C10 — backfill completo de la migración

Consulta ejecutada por mí (script temporal scripts/tmp-c10check.ts,
borrado tras correrlo — no queda en el repo):

```sql
SELECT count(*) FROM "CanonicalProduct" cp
 WHERE cp."ean" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "CanonicalBarcode" b
                    WHERE b."canonicalProductId" = cp."id" AND b."ean" = cp."ean");
```

```
C10 backfill-missing count: 0
```

Exit code `0`.

**Veredicto C10: LISTO.**

## C1 — contrato v4: `barcodes` obligatorio, `barcode` prohibido con 400, nada se escribe

Tres niveles, los tres reejecutados por mí:

1. **Unitaria/ruta con mocks:**

```
$ npx vitest run src/app/api/internal/sync/catalog/route.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

Incluye "F-024 C1: contrato v4 de PRODUCT (E10-E12)": `barcode` presente
(incluso junto a `barcodes`), `barcode: null`, `barcodes` ausente,
`barcodes` con elemento numérico, `barcodes` como cadena, y `barcodes: []`
válido (E9).

2. **Postgres real, a través del `POST` real de la ruta** (no un mock):

```
$ npx vitest run --project db src/features/sync/server/handlers/product.db.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

El test "C1 (E10), through the real POST: a batch with the singular
`barcode` key writes NOTHING" (línea 687) captura `prisma.syncEvent.count()`
y `prisma.canonicalBarcode.count()` **antes**, llama al `POST` real con
`barcode` en el payload, aserta `400 INVALID_BATCH`, y confirma que ambos
conteos **no cambiaron**.

3. **HTTP real, contra el servidor levantado** — lo que el método exige
   ejecutar de verdad, no simular:

```
$ npm run mint:token -- seed-negocio-1
Business seed-negocio-1 (1da63cc8-0c42-4233-aa03-acacb702589f)
Token: dfZX9WrUOK3W7UO5GguPrrTDUAxKeGXlekaREtF4b-lrfc2N

$ npm run dev   # en background, esperado a "Ready"

$ QAB_BEARER_TOKEN=<token> node scripts/send-catalog-batch.mjs --singular-barcode
HTTP 400
{
  "error": "INVALID_BATCH",
  "issues": [
    { "path": ["events",0,"payload","barcodes"], "message": "Invalid input: expected array, received undefined" },
    { "path": ["events",0,"payload","barcode"], "message": "`barcode` was removed in contract v4 — send `barcodes: string[]` instead" }
  ]
}

$ QAB_BEARER_TOKEN=<token> node scripts/send-catalog-batch.mjs
HTTP 207
{ "ok": ["evt-product-mtci3xn7"], "failed": [], "results": [{ "eventId": "evt-product-mtci3xn7", "status": "processed" }] }
```

Servidor detenido tras la prueba (`pkill -f "next dev"`), sin dejar procesos
colgados.

**Veredicto C1: LISTO.**

## C2 — tres códigos → tres filas, reenvío no duplica

```
$ npx vitest run --project db src/features/sync/server/handlers/product.db.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Incluye E1 ("three codes in any order create ONE canonical whose ean is the
smallest, with exactly three CanonicalBarcode rows"), E2 ("resending the same
event... does not duplicate rows") y E3 (mismo canónico con otro orden).

**Veredicto C2: LISTO.**

## C3 — códigos inválidos no se guardan; todos inválidos → huérfano `isExclusive`

```
$ npx vitest run src/lib/canonical.test.ts
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

Cubre E6 (ruido/duplicados en la lista → una fila), E8 (mezcla de
inválidos/válidos → solo los válidos), E9 (lista vacía → huérfano), E7
(todos inválidos → huérfano) a nivel unitario; y en
`product.db.test.ts` (misma corrida que C2) los E7/E8 contra Postgres real
con `isExclusive === true` y cero filas.

**Veredicto C3: LISTO.**

## C4 — la fusión no cambia de comportamiento

Ver § C9 arriba: es su forma verificable, según SP1 ya resuelta por el
humano. No se reabre el número literal "17 de 20".

**Veredicto C4: LISTO (vía C9).**

## C5 — identidad por el código menor, orden irrelevante

```
$ npx vitest run src/lib/canonical.test.ts   # mismo run que C3
      Tests  18 passed (18)
```

Tres permutaciones de la misma lista → mismo `ean` (unitario), y en
`product.db.test.ts` el escenario E3 confirma `CanonicalProduct.count()` con
ese `ean` sigue siendo 1 tras reenviar la lista en otro orden.

**Veredicto C5: LISTO.**

## C6 — ver arriba. LISTO.

## C7 — `docs/sync-contract.md` en v4

```
$ grep -n "Versión 4" docs/sync-contract.md
3:**Versión 4** · 28 de agosto de 2026

$ grep -c '"barcodes"' docs/sync-contract.md
1

$ grep -n '"barcode"' docs/sync-contract.md
(sin salida — exit 1)
```

Los tres greps exactos que `spec.md` C7 propone dan el resultado esperado.
`docs/adr/0020-todos-los-codigos-una-sola-fusion.md` está en estado
**Aceptada · 28 de agosto de 2026 · F-024** (confirmado leyendo el archivo
completo: contexto, decisión (a)-(d), consecuencia aceptada, qué reabre esto).

**Veredicto C7: LISTO.**

## C8 — `bash .agent/verify.sh F-024 --full` sale 0

```
$ bash .agent/verify.sh F-024 --full
== Verificación F-024 · intento 6 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       3s
  ✓ prisma     0s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s

PASA
EXIT_CODE=0
```

Reejecutado por mí (no solo releído del `tests.md` del implementador), nueve
etapas en verde, exit code confirmado con `echo $?`.

**Veredicto C8: LISTO.**

## C9 — ver arriba. LISTO.

## C10 — ver arriba. LISTO.

## C11 — la clave singular no queda en ningún fixture del repo

```
$ grep -rn "barcode:" src scripts prisma | grep -v "/generated/"
src/app/api/internal/boundaries.test.ts:64:  *  for documentation — never satisfies the literal `grep -rn "barcode:"`
src/app/api/internal/sync/catalog/route.test.ts:188:  events: [productEvent("evt-barcode", { barcode: "7501031311309" })],
src/app/api/internal/sync/catalog/route.test.ts:198:  it("E10: `barcode: null` también responde 400 — la clave prohibida no se ignora por su valor", async () => {
src/app/api/internal/sync/catalog/route.test.ts:201:  events: [productEvent("evt-barcode-null", { barcode: null })],
src/features/sync/schemas.ts:70:  barcode: z
src/features/sync/server/handlers/product.db.test.ts:713:  barcode: "7501031311309",
scripts/send-catalog-batch.mjs:55:    ? { barcode: "7501031311309" }
```

Las siete coincidencias son, todas, deliberadas y examinadas una a una: la
declaración de la prohibición en `schemas.ts:70`
(`barcode: z.never({...}).optional()`), tres usos en pruebas que existen
**para demostrar el rechazo** (E10 en `route.test.ts`, y el test "C1 (E10),
through the real POST" en `product.db.test.ts:713`, el mismo que confirmé en
§ C1), el flag deliberado `--singular-barcode` de
`send-catalog-batch.mjs:55` (documentado en el propio script y en el
contrato v4), y un comentario de documentación en `boundaries.test.ts:64`.
Ninguna es un fixture que trate `barcode` como una clave de payload válida.

```
$ npx vitest run src/app/api/internal/boundaries.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

G6 ("the removed singular `barcode` payload key never reappears outside a
test or the schema that forbids it") y G7 ("exactly one production file
touches CanonicalBarcode") pasan. `npm run typecheck` (dentro de
`verify.sh --full`, § C8) confirma 0 errores — el tipo `barcode?: never`
haría fallar la compilación de cualquier fixture olvidado (N3 de
`architecture.md`).

**Veredicto C11: LISTO.**

## Mapa criterio → prueba

| Criterio | Prueba                                                                    | Archivo                                                                                        | Resultado |
| -------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------- |
| C1       | ruta (mocks) + Postgres real (POST real) + HTTP real contra `npm run dev` | `route.test.ts`, `product.db.test.ts:687`, `scripts/send-catalog-batch.mjs --singular-barcode` | LISTO     |
| C2       | Postgres real E1/E2/E3                                                    | `product.db.test.ts`                                                                           | LISTO     |
| C3       | unitaria E6/E8/E9/E7 + Postgres real E7/E8                                | `canonical.test.ts`, `product.db.test.ts`                                                      | LISTO     |
| C4       | invariancia del seed (vía C9)                                             | `prisma/seed.ts`, consulta SQL ad-hoc                                                          | LISTO     |
| C5       | unitaria (permutaciones) + Postgres real E3                               | `canonical.test.ts`, `product.db.test.ts`                                                      | LISTO     |
| C6       | ejecutable de medición                                                    | `scripts/count-canonical-barcodes.ts`                                                          | LISTO     |
| C7       | tres greps sobre el contrato + estado de la ADR                           | `docs/sync-contract.md`, `docs/adr/0020-*.md`                                                  | LISTO     |
| C8       | sensor completo                                                           | `bash .agent/verify.sh F-024 --full`                                                           | LISTO     |
| C9       | `npm run seed` ×2 + consulta de los tres EAN compartidos                  | `prisma/seed.ts`, consulta SQL ad-hoc                                                          | LISTO     |
| C10      | consulta del backfill                                                     | consulta SQL ad-hoc                                                                            | LISTO     |
| C11      | grep + G6/G7 + typecheck                                                  | `boundaries.test.ts`, `verify.sh --full`                                                       | LISTO     |

Ningún criterio queda sin fila.

## Ejecuciones

- `npx prisma migrate status` → "Database schema is up to date!", 8 migraciones.
- `bash .agent/verify.sh F-024 --full` → PASA, exit 0, 9/9 etapas.
- `npx vitest run src/app/api/internal/sync/catalog/route.test.ts` → 14 passed.
- `npx vitest run --project db src/features/sync/server/handlers/product.db.test.ts` → 15 passed.
- `npx vitest run src/lib/canonical.test.ts` → 18 passed.
- `npx vitest run src/app/api/internal/boundaries.test.ts` → 6 passed.
- `npx vitest run --project server --project db` (suite completa server+db) → 544 passed (54 archivos), 0 fallos.
- `npx tsx scripts/count-canonical-barcodes.ts` → exit 0, cinco cifras + histograma (ver § C6).
- `npm run seed` ×2 → idempotente, `canonical: 19, products: 28, barcodes: 11` en ambas.
- Consulta ad-hoc de C10 (backfill) → `0`.
- Consulta ad-hoc de C9 (tres EAN compartidos) → `canonicals = 1` en las tres filas.
- `npm run mint:token -- seed-negocio-1` → token acuñado.
- `npm run dev` (background) + `node scripts/send-catalog-batch.mjs --singular-barcode` → `HTTP 400 INVALID_BATCH`.
- `node scripts/send-catalog-batch.mjs` (camino correcto, `barcodes`) → `HTTP 207`, `ok`.
- `grep -rn "barcode:" src scripts prisma` (excluyendo `/generated/`) → 7 líneas, todas examinadas y justificadas (§ C11).
- `grep -n "Versión 4" / -c '"barcodes"' / -n '"barcode"'` sobre `docs/sync-contract.md` → los tres resultados esperados (§ C7).
- `bash .agent/verify.sh pending F-024` → vacío (sin salida).
- `git status --short` tras terminar → limpio de residuos de scripts temporales (scripts/tmp-c9check.ts y scripts/tmp-c10check.ts se crearon para las consultas ad-hoc y se borraron inmediatamente después de correrlas).

## Fallos encontrados

Ninguno. No se encontró ningún bug de construcción, diseño, ni criterio mal
escrito. La única observación —los tres EAN compartidos del seed ya no dan
"dos" `StoreProduct` sino 3/2/4— **no es un fallo de F-024**: es la misma
caducidad que I1 de `spec.md` ya fichó para "17 canónicos de 20 productos",
causada por fixtures de F-017/F-018, confirmada de nuevo por mí en § C9. No
se reabre SP1 ni el número 17/20, según instrucción explícita del
orquestador.

`bash .agent/verify.sh pending F-024` está vacío: no queda ningún fallo sin
fichar ni descartar.

## Huecos de cobertura

- **Concurrencia real (dos negocios creando `CanonicalProduct.ean` a la
  vez)**: la spec la deja como caso límite esperado (`failed` +
  reintento, comportamiento de hoy, sin modo de fallo nuevo) y no pide una
  prueba de carrera real; no se construyó una. Riesgo bajo: es el mismo
  comportamiento que F-002/F-005 ya tienen y no cambia con F-024.
- **Lista de miles de códigos** (R11, el borde de 65 535 parámetros
  ligados de Postgres que justifica `CANONICAL_BARCODE_INSERT_CHUNK`): no
  se ejecutó una prueba con una lista de ese tamaño. `architecture.md` lo
  marca como "riesgo bajo" y R11 dice explícitamente que no hay tope; el
  troceo es defensivo para un caso que el seed/las pruebas actuales no
  alcanzan. Aceptable para este ciclo, no bloquea el veredicto.
- **Medición contra datos reales de cuadrecaja** (`canonicalsWithBarcodesAcrossBusinesses`
  con datos de producción): fuera de alcance por HD5, SP2 ya resuelta.

## Veredicto

**LISTO.** Los 11 criterios (8 `[ya]` + C9/C10/C11 `[nuevo]`) se verificaron
ejecutando algo real: comandos de vitest con su conteo de pruebas y código de
salida, dos consultas SQL corridas contra Postgres, un ejecutable de consola,
el sensor completo `verify.sh --full` en 0, y una petición HTTP real contra
el servidor de desarrollo con un token acuñado. `bash .agent/verify.sh
pending F-024` está vacío. No se encontró ningún bug ni desviación que
requiera volver a `sdd-implementer`, `sdd-architect` ni `sdd-spec`. No hay
preguntas nuevas para el humano: SP1, SP2 y AP1 siguen resueltas como las
dejó el ciclo anterior, y no se reabren.

## Preguntas al humano

Ninguna. `TP1..TPn`: no aplica.
