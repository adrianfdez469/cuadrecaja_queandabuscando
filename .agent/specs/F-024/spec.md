---
feature: F-024
agente: sdd-spec
actualizado: 2026-08-28T04:22:42Z
estado: listo
---

> Punto de partida: `.agent/specs/propuestas/canonico-fusionado-por-ean-sucio.md`,
> § «El hallazgo que ordena todo lo demás» y § «Diseño propuesto» puntos 1 y 2.
> La respuesta del humano a **P4** (2026-08-27) —«Si seria bueno recibir
> barcode[] en vez de un solo barcode»— es el origen del feature y no se
> reabre. Lo que ese documento deja abierto (P2 el corte de concentrador, P5 el
> tope de grado) **no** entra aquí: ver § Fuera.
>
> `estado: listo` con dos preguntas abiertas a propósito: **SP1 y SP2 no
> bloquean construir**, bloquean el veredicto final (`sdd.sh done`). El
> orquestador las lleva al humano con `plan.md`; el arquitecto puede empezar.

## Problema

El contrato recibe **un** código de barras por producto (`barcode`, singular,
`docs/sync-contract.md:200`) y lo mapea contra `CodigoProducto.codigo`
(`docs/sync-contract.md:184`), que en cuadrecaja es una **tabla**: un producto
puede tener varios códigos. De N códigos llega uno, **nadie elige cuál**, y los
demás se pierden sin registro. No es una mejora pendiente: es una pérdida de
datos que ya está ocurriendo, y hace **invisible** el escenario real que trajo
el humano (un negocio que asocia cod1/cod2/cod3 a un genérico «Refresco de
Pomo» mientras otros usan cod1 para «Coca cola 1.5Lt» y cod2 para «Sprite
1.5Lt»).

Se arregla ahora porque es casi gratis: HD5 de F-018 — en cuadrecaja **no hay
nada desarrollado** de esta integración, así que romper la forma del payload no
rompe a ningún consumidor vivo. Con un cron en producción dejaría de ser gratis.

## Alcance

### Dentro

1. **Contrato v4.** El `payload` de `PRODUCT` lleva `barcodes` (lista de
   `string`) y **ya no** `barcode`. La clave singular no se ignora: se rechaza.
2. **`CanonicalBarcode`**: modelo nuevo en `prisma/schema.prisma`
   —`(canonicalProductId, ean)`, único por pareja, índice por `ean`— y su
   migración, que además hace **backfill** desde `CanonicalProduct.ean`.
3. **La resolución de identidad recibe la lista** (`src/lib/canonical.ts`):
   normaliza, deduplica, ordena, y resuelve por **un solo** código, el menor.
4. **El handler guarda todos los códigos válidos** del producto contra el
   canónico que resolvió (`src/features/sync/server/handlers/product.ts`), en
   las tres estrategias (explícita, por EAN, huérfano — en el huérfano no hay
   ninguno que guardar).
5. **El seed** (`prisma/seed.ts`) escribe la fila de `CanonicalBarcode` del
   `ean` que ya siembra, y **un** producto de demostración pasa a tener tres
   códigos, para que la consulta del punto 7 tenga algo que contar en
   desarrollo. El número de canónicos y de `StoreProduct` **no cambia**.
6. **`docs/sync-contract.md` sube a v4**: `barcodes` documentado como lista, el
   mapeo de nombres corregido, y dicho explícitamente que la fusión sigue
   usando un solo código.
7. **La medición del criterio 6**: un ejecutable nuevo,
   scripts/count-canonical-barcodes.ts (por crear), que imprime cuántos
   canónicos tienen más de un código y cuántos tienen códigos de más de un
   negocio, y cuya salida se anota en `.agent/specs/F-024/tests.md`.
8. **La cola que deja el corte de contrato**: todo lo que hoy escribe la clave
   singular — `src/features/sync/schemas.ts:64`,
   `src/features/sync/server/handlers/product.ts:152`,
   `src/lib/canonical.ts:22,31`, `src/features/sync/server/handlers/product.test.ts:63`,
   `src/features/sync/server/handlers/product.db.test.ts` (nueve fixtures),
   `src/lib/canonical.test.ts`, `scripts/send-catalog-batch.mjs:55` y
   `src/features/marketplace/server/dbFixtures.ts` (`deriveEan`, si el fixture
   pasa a necesitar varias).

### Fuera (explícito)

- **Los nodos concentradores, las aristas entre canónicos y la búsqueda en tres
  anillos.** Es el resto de
  `.agent/specs/propuestas/canonico-fusionado-por-ean-sucio.md` (§ Diseño
  propuesto, puntos 3 y 4) y se decide **después**, con el número del criterio 6
  en la mano. F-024 «solo abre la puerta y empieza a guardar lo que hoy se
  pierde» (`.agent/features.json`, notas de F-024).
- **Cambiar el comportamiento de fusión.** `CanonicalProduct.ean` sigue siendo
  `@unique` y sigue siendo la clave de fusión (`prisma/schema.prisma:301`).
  Nada de quitar ese `@unique`, nada de fusionar por «comparte cualquier
  código», nada de decidir por el número de códigos. F-002 y F-015 verificaron
  ese comportamiento y aquí no se toca.
- **El corte de concentrador (P2) y el tope de grado (P5)** de la propuesta.
- **Atribuir cada código a un negocio.** `CanonicalBarcode` **no** lleva
  `businessId`: ver § Datos y contrato, decisión del orquestador.
- **Borrar códigos** que el POS deja de enviar. El almacenamiento es aditivo
  (R6) y nada limpia códigos rancios en este feature.
- **Buscar por código de barras**, y meter los códigos en `searchDocument` o
  `searchVector`. La búsqueda del marketplace (F-015) y la de dentro de una
  tienda (F-021) no cambian.
- **UI.** Ni el panel ni la tienda pública muestran, editan o filtran códigos.
- **El lado de cuadrecaja.** Este feature documenta y recibe; implementar el
  envío es del POS.
- **Los otros payloads** (`STORE`, `CATEGORY`, `CURRENCY`, `EXCHANGE_RATE`) y
  los lotes de disponibilidad y pedidos.

## Actores y precondiciones

**Quién dispara.** El cron de cuadrecaja, autenticado con el token de **su**
negocio (`docs/sync-contract.md` § Autenticación, F-018), contra
`POST /api/internal/sync/catalog`
(`src/app/api/internal/sync/catalog/route.ts`). Nadie más: no hay UI ni ruta
pública que escriba códigos.

**Qué tiene que ser cierto antes.**

- El `Business` del token existe y está activo; el `businessId` de la raíz y de
  cada payload coincide con él, o el lote entero es `403 BUSINESS_MISMATCH`
  antes de escribir nada.
- La `Store` de `payload.storeId` existe **y es de ese negocio**; si no,
  `skipped_not_published` (F-018 R1, `src/features/sync/server/handlers/product.ts:55`).
- Postgres con la migración de este feature aplicada (`npx prisma migrate deploy`).
- Para las pruebas del proyecto `db`: `docker compose up -d postgres`
  (ADR 0019 (c); `.agent/init.sh` falla sin él).

## Comportamiento esperado

Notación: `cod1 < cod2 < cod3` son GTIN válidos (8/12/13/14 dígitos) en orden
lexicográfico ascendente; `mal` es un código que `normalizeBarcode` rechaza.

**E1 — tres códigos, canónico nuevo.**
Dado que ningún canónico tiene `ean` igual a cod1, cod2 ni cod3,
cuando llega un `PRODUCT` con `barcodes: [cod2, cod3, cod1]` y sin
`canonicalProductId`,
entonces se crea **un** `CanonicalProduct` con `ean = cod1` (el menor),
`isExclusive = false`, y `CanonicalBarcode` queda con **exactamente tres**
filas para ese canónico: cod1, cod2, cod3.

**E2 — reenvío del mismo evento (idempotencia).**
Dado E1 aplicado,
cuando el mismo `eventId` se reenvía, o cuando llega el mismo payload con otro
`eventId` y el mismo `updatedAt`,
entonces el resultado es `duplicate` o `stale`, y `CanonicalBarcode` sigue con
tres filas: ni una cuarta, ni un error.

**E3 — la misma lista en otro orden.**
Dado E1 aplicado,
cuando llega el mismo producto con `barcodes: [cod3, cod1, cod2]` y un
`updatedAt` posterior,
entonces se resuelve **el mismo** canónico (`ean = cod1`): no se crea uno
nuevo y las filas siguen siendo tres.

**E4 — la fusión de hoy, intacta.**
Dado un canónico con `ean = cod1` creado por el negocio A,
cuando el negocio B envía un producto con `barcodes: [cod1]`,
entonces su `StoreProduct` apunta a **ese** canónico (fusión, como hoy), se
registra su `ProductAlias`, se recalcula el `searchDocument`, y
`CanonicalBarcode` no gana ninguna fila (cod1 ya estaba).

**E5 — código conocido que no es el `ean` del canónico (consecuencia asumida).**
Dado E1 aplicado (canónico X con `ean = cod1` y filas cod1, cod2, cod3),
cuando el negocio B envía un producto con `barcodes: [cod2]`,
entonces se crea un canónico **nuevo** Y con `ean = cod2`, y `CanonicalBarcode`
queda con cod2 en **dos** canónicos (X e Y). Es deliberado: la identidad se
resuelve por un solo código (criterio 5) y relacionar X con Y es el grafo, que
está fuera. Esta situación es exactamente lo que el criterio 6 mide.

**E6 — ruido y duplicados en la lista.**
Cuando llega `barcodes: ["  750-1031311309 ", "7501031311309", "7501031311309"]`,
entonces queda **una** fila con `7501031311309` y el canónico tiene ese `ean`.

**E7 — todos los códigos inválidos.**
Cuando llega `barcodes: [mal, "", "abc"]` sin `canonicalProductId`,
entonces el producto **se publica igual** como canónico huérfano con
`isExclusive = true` (o reutiliza el huérfano de `(storeId, storeProductId)`,
`src/features/sync/server/handlers/product.ts:207`), y `CanonicalBarcode` no gana ninguna fila.

**E8 — mezcla de válidos e inválidos.**
Cuando llega `barcodes: [mal, cod2, cod1]`,
entonces el canónico se resuelve por cod1 y hay **dos** filas (cod1, cod2): el
inválido no se guarda en ningún sitio.

**E9 — lista vacía.**
Cuando llega `barcodes: []`,
entonces se comporta igual que el `barcode: null` de hoy: huérfano,
`isExclusive = true`, cero filas.

**E10 — la clave singular se rechaza.**
Cuando llega un lote con un evento `PRODUCT` cuyo payload trae `barcode` (con
cualquier valor, incluido `null`),
entonces la respuesta es `400 { "error": "INVALID_BATCH", "issues": [...] }`,
**no se escribe nada**: ni `SyncEvent`, ni `CanonicalProduct`, ni
`StoreProduct`, ni `CanonicalBarcode` — la validación ocurre antes de
`processCatalogBatch` (`src/app/api/internal/sync/catalog/route.ts:33-38`).

**E11 — `barcodes` ausente.**
Cuando un payload `PRODUCT` no trae `barcodes`,
entonces `400 INVALID_BATCH` con el issue de campo requerido. Un producto sin
códigos se declara con `barcodes: []` (E9), no omitiendo la clave.

**E12 — `barcodes` con algo que no es texto.**
Cuando llega `barcodes: [7501031311309]` (número) o `barcodes: "7501…"`
(cadena en vez de lista),
entonces `400 INVALID_BATCH`. Los códigos viajan como texto: un GTIN con cero
inicial no sobrevive a un número.

**E13 — `canonicalProductId` explícito con códigos.**
Cuando llega un payload con `canonicalProductId` y `barcodes: [cod1, cod2]`,
entonces gana la identidad explícita (como hoy, `src/lib/canonical.ts:26-29`), el
canónico **no** cambia su `ean`, y las dos filas de `CanonicalBarcode` se
guardan contra **ese** canónico.

**E14 — baja y despublicación.**
Cuando llega `operation: DELETE` o `publishToStore: false`,
entonces borrado suave del `StoreProduct` y **fin**: no se toca
`CanonicalBarcode` ni siquiera si el payload trae códigos.

**E15 — evento rancio.**
Cuando llega un payload cuyo `updatedAt` no es posterior al
`sourceUpdatedAt` guardado,
entonces `stale` y **ninguna** escritura de códigos: la guarda anti-rancio
(`src/features/sync/server/handlers/product.ts:72`) sigue delante de todo.

**E16 — orden de entrega irrelevante.**
Dado dos eventos del mismo producto, uno con `barcodes: [cod1, cod2]` y otro
—posterior— con `barcodes: [cod1, cod3]`,
cuando se aplican en cualquiera de los dos órdenes (el rancio se descarta),
entonces `CanonicalBarcode` acaba con el **mismo** conjunto en ambos casos, por
ser aditivo (R6).

**E17 — el seed, dos veces.**
Cuando se ejecuta `npm run seed && npm run seed`,
entonces las dos ejecuciones imprimen los mismos `canonical` y `products`, y
`CanonicalBarcode` no tiene filas duplicadas.

**E18 — la medición.**
Cuando se ejecuta la consulta del criterio 6 sobre una base sembrada,
entonces imprime, con nombres explícitos: total de canónicos, cuántos tienen al
menos un código, cuántos tienen **más de uno**, cuántos tienen códigos y
ofertas de **más de un negocio**, y el histograma de códigos por canónico. Con
solo datos del seed el cuarto número es `0` y eso **no** es un fallo (SP2).

## Reglas de negocio

- **R1 — `barcodes` es obligatorio y es una lista de texto.**
  `z.array(z.string())` en `productPayloadSchema`, sin `nullish` y sin valor por
  defecto. Vacía es válida (E9); ausente es `400` (E11).
- **R2 — la clave singular se rechaza de forma explícita.** Zod descarta claves
  desconocidas en silencio, así que la ausencia de `barcode` en el schema **no**
  basta para el criterio 1: el schema declara la clave singular como prohibida
  (p. ej. `barcode: z.never().optional()`) para que su presencia produzca un
  `issue` y con él el `400`, incluso si el payload trae también `barcodes`.
- **R3 — normalizar, deduplicar, ordenar.** Cada elemento pasa por
  `normalizeBarcode` (`src/lib/canonical.ts:44`); los `null` se descartan; el
  resultado se deduplica y se ordena en **orden lexicográfico ascendente de
  cadenas** (comparación por unidades de código, la de `Array.sort()` sin
  comparador). Nunca comparación numérica ni `localeCompare`.
- **R4 — la identidad se resuelve por un solo código: el menor.** Se busca
  `CanonicalProduct` por `ean = codigos[0]` y **solo** por ese. No se busca por
  los demás, ni por `CanonicalBarcode`. Es la regla que hace que reordenar la
  lista no cree un canónico nuevo (criterio 5) y la que deja la fusión donde
  estaba (criterio 4).
- **R5 — `CanonicalProduct.ean` no cambia de papel.** Sigue `String? @unique` y
  sigue siendo lo que fusiona. En un canónico nuevo se escribe con
  `codigos[0]`; en uno que ya existe **no se reescribe nunca**.
- **R6 — `CanonicalBarcode` es aditivo.** Se insertan los códigos válidos que
  falten y no se borra ninguno, tampoco los que el POS deja de enviar. Motivo:
  el canónico es compartido entre negocios y las filas no dicen de quién es cada
  código (§ Datos y contrato), así que borrar por cuenta de un negocio borraría
  el aporte de otro. Consecuencia buscada: el conjunto es independiente del
  orden de entrega (E16).
- **R7 — `CanonicalBarcode.ean` es único por canónico, no globalmente.**
  `@@unique([canonicalProductId, ean])` e `@@index([ean])`. Un mismo `ean` puede
  aparecer en varios canónicos (E5): eso **es** el dato que el criterio 6 mide,
  y un `@unique` global lo destruiría.
- **R8 — una sola ida y vuelta, idempotente, sin `$transaction`.** Los códigos
  se escriben en una única sentencia que ignora los que ya están (`createMany`
  con `skipDuplicates`, o `ON CONFLICT DO NOTHING`). El pooler de Supabase corre
  en modo transacción y una query del cliente global dentro de `$transaction`
  hace deadlock (`AGENTS.md` § Cosas que muerden;
  `.agent/playbook/pooler-transaccion-deadlock.md`).
- **R9 — los códigos no entran en la búsqueda.** Ni en `searchDocument` ni en
  `searchVector`; `writeSearchDocument` sigue siendo el único escritor de esas
  dos columnas (F-015) y `buildSearchDocument` sigue recibiendo nombre + alias.
- **R10 — la escritura de códigos va detrás de la guarda anti-rancio y nunca en
  el camino de baja.** Orden: guarda anti-rancio → resolución de identidad →
  `StoreProduct` → códigos → alias. Un `DELETE` o `publishToStore: false` sale
  antes (E14).
- **R11 — sin tope al tamaño de la lista en la v4.** Un tope convertiría un dato
  que el POS no puede cambiar en un `400` permanente del lote entero (§ Casos
  límite, «el 400 es del lote»). Dónde está el tope de grado es P5 de la
  propuesta y pertenece al grafo.
- **R12 — la migración se revisa a mano antes de aplicarla.** `npm run db:migrate`
  (que es `prisma migrate dev`) propone `DROP INDEX` de los dos índices GIN de
  `CanonicalProduct`, que no están declarados en
  `prisma/schema.prisma`; esas líneas se quitan del `migration.sql`
  generado
  (`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`), y
  se cuenta con el drift de checksum de la base local compartida
  (`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`).
  `prisma migrate reset` y `prisma db push` siguen prohibidos.
- **R13 — el backfill es parte de la migración y es idempotente.** Toda fila de
  `CanonicalProduct` con `ean` no nulo acaba con su fila en `CanonicalBarcode`;
  aplicar la migración sobre una base ya migrada inserta 0 filas.

## Casos límite y errores

| Caso                                                | Comportamiento                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lista vacía                                         | Huérfano, `isExclusive = true`, cero filas (E9)                                                                                                                                                                                                                                                   |
| Todos inválidos                                     | Igual que vacía (E7). Nunca hay un producto que no se pueda publicar                                                                                                                                                                                                                              |
| Duplicados en la lista                              | Deduplicados antes de escribir (E6)                                                                                                                                                                                                                                                               |
| Mismo código en dos canónicos                       | Permitido y esperado (E5, R7)                                                                                                                                                                                                                                                                     |
| **El 400 es del lote, no del evento**               | La validación es del `catalogBatchSchema` completo (`src/app/api/internal/sync/catalog/route.ts:33`): un solo payload con la clave singular tumba el lote entero, y el POS lo reintentará indefinidamente hasta que envíe la v4. Es el corte de la v4, aceptado y documentado en el contrato (I6) |
| Reintento del mismo lote                            | `SyncEvent` lo marca `duplicate` y nada se reescribe; con `400` no hay ni fila de `SyncEvent` que reintentar                                                                                                                                                                                      |
| Dos negocios creando a la vez el canónico de cod1   | Choque de `CanonicalProduct.ean @unique` → el evento perdedor sale `failed` y se reintenta, como hoy. La escritura de códigos **no** añade un modo de fallo nuevo: sus conflictos se ignoran (R8)                                                                                                 |
| El POS deja de enviar un código                     | La fila se queda (R6). Limpiar códigos rancios está fuera                                                                                                                                                                                                                                         |
| El producto pierde todos sus códigos en un `UPDATE` | Pasa a huérfano y cambia de canónico, exactamente como hoy con `barcode: null`. El canónico anterior conserva sus filas                                                                                                                                                                           |
| Un código válido en un payload de un negocio ajeno  | No llega tan lejos: `403 BUSINESS_MISMATCH` o `skipped_not_published` antes de resolver identidad (F-018)                                                                                                                                                                                         |
| Lista enorme (miles de códigos)                     | Se acepta y se escribe (R11). El riesgo es de relevancia en el grafo futuro, no aquí                                                                                                                                                                                                              |
| Base local compartida entre worktrees               | Las pruebas del proyecto `db` se aíslan por token por ejecución, nunca truncando (ADR 0019 (d), `src/features/marketplace/server/dbFixtures.ts`)                                                                                                                                                  |

## Datos y contrato

### `payload` de `PRODUCT` — v4

```jsonc
{
  "storeProductId": "uuid",
  "productId": "uuid",
  "businessId": "uuid",
  "storeId": "uuid",
  "localName": "Refresco de cola 1.5 L",
  "barcodes": ["7501031311309", "7501031311316"], // v4: lista, obligatoria, [] si no tiene
  "localCategoryId": "uuid", // null
  "price": 450,
  "currency": "CUP",
  "canonicalProductId": null,
  "imageUrl": null,
  "publishToStore": true,
  "updatedAt": "2026-08-25T14:03:00.000Z", // guarda anti-rancio
}
```

| Campo      | Tipo       | Obligatorio | Notas                                                                      |
| ---------- | ---------- | ----------- | -------------------------------------------------------------------------- |
| `barcodes` | `string[]` | **sí**      | `[]` válido. Cada elemento es texto; los que no son GTIN se descartan (R3) |
| `barcode`  | —          | prohibido   | Su presencia es `400 INVALID_BATCH` (R2, E10)                              |

Mapeo de nombres (sustituye la fila de `docs/sync-contract.md:184`):

| Wire (inglés) | cuadrecaja (español)                                        |
| ------------- | ----------------------------------------------------------- |
| `barcodes`    | `CodigoProducto.codigo` de **todas** las filas del producto |

La v4 **no es aditiva** en este campo, igual que la v3 no lo fue en
autenticación, y por el mismo motivo (HD5: no hay consumidor vivo). El
documento tiene que decir, en su § de cambios, las tres cosas: que `barcodes`
es una lista, que la clave singular se rechaza con `400`, y que **la fusión
sigue usando un solo código** — el menor de los válidos.

### `CanonicalBarcode`

| Columna              | Tipo       | Notas                                             |
| -------------------- | ---------- | ------------------------------------------------- |
| `id`                 | `String`   | PK                                                |
| `canonicalProductId` | `String`   | FK a `CanonicalProduct`, `onDelete: Cascade`      |
| `ean`                | `String`   | Ya normalizado: solo dígitos, longitud 8/12/13/14 |
| `createdAt`          | `DateTime` | `@default(now())`                                 |

`@@unique([canonicalProductId, ean])` + `@@index([ean])`. **Sin `businessId`**
(ver abajo). `CanonicalProduct.ean` se queda como está
(`prisma/schema.prisma:301`).

### Por qué `CanonicalBarcode` no lleva `businessId`

**Decisión del orquestador, ya tomada; aquí solo se documenta.** El criterio 6
—«cuántos canónicos tienen códigos de más de un negocio»— se responde con un
JOIN que ya es posible: `CanonicalProduct` → `StoreProduct` → `Store.businessId`
(`prisma/schema.prisma:345-387`). No hace falta guardar el negocio en la tabla
de códigos, y la propuesta tampoco lo pide: dice
`CanonicalBarcode(canonicalProductId, ean)` y nada más.

Lo que esa elección implica, escrito para que nadie lo descubra midiendo: el
número que sale es **«canónicos con más de un código cuyas ofertas vivas
pertenecen a más de un negocio»**, no «canónicos con códigos aportados por más
de un negocio». Sirve para decidir lo que hay que decidir —si el escenario del
humano ocurre en datos reales— y es lo único medible sin atribución. Si el día
que se construya el grafo hace falta saber **quién** aportó cada código, eso es
una columna nueva de otro feature (§ No decidido a propósito).

Definición exacta de la medición, para que dos personas obtengan el mismo
número:

- `canonicalsWithBarcodes`: canónicos con al menos una fila en `CanonicalBarcode`.
- `canonicalsWithMultipleBarcodes`: canónicos con **≥ 2** filas.
- `canonicalsWithBarcodesAcrossBusinesses`: canónicos con **≥ 1** fila y con
  `COUNT(DISTINCT Store.businessId) >= 2` sobre sus `StoreProduct` **no
  borrados** (`deletedAt IS NULL`) — un negocio que borró la oferta ya no
  afirma nada.
- `histogram`: cuántos canónicos hay con 1, 2, 3… códigos. No lo pide ningún
  criterio; se incluye porque es el dato que P5 de la propuesta necesitará (el
  abanico crece con k²) y cuesta una línea de SQL.

El SQL crudo se compone **solo** con `Prisma.sql`, nunca `Unsafe` (ADR 0019 (a)).

## Criterios de aceptación propuestos

Los ocho `[ya]` son literales de `.agent/features.json` (regla 3: no se tocan).

- **C1 `[ya]`** — «El payload de PRODUCT lleva 'barcodes' (lista) y ya no
  'barcode': un evento con la clave singular responde 400 y no escribe nada.»
  → prueba de ruta sobre `src/app/api/internal/sync/catalog/route.test.ts`: un
  lote con `barcode` responde `400` con `error: "INVALID_BATCH"` y
  `processCatalogBatch` no se llama; y prueba del proyecto `db` que, tras ese
  `400`, `SyncEvent.count()` y `CanonicalBarcode.count()` no han cambiado.
  `npx vitest run src/app/api/internal/sync/catalog/route.test.ts` → 0.
- **C2 `[ya]`** — «Un product.upsert con tres codigos deja exactamente tres
  filas en CanonicalBarcode para ese canonico, y reenviar el mismo evento no las
  duplica.» → prueba `db` nueva en
  `src/features/sync/server/handlers/product.db.test.ts` (E1, E2, E3) con EAN
  derivados del token de la ejecución. `npx vitest run --project db` → 0.
- **C3 `[ya]`** — «Los codigos que normalizeBarcode rechaza no se guardan, y un
  producto cuyos codigos son todos invalidos se sigue publicando como canonico
  huerfano con isExclusive = true.» → pruebas de `src/lib/canonical.test.ts`
  (unitaria, E6/E8) y `db` (E7: `isExclusive === true`, cero filas).
- **C4 `[ya]`** — «La fusion NO cambia de comportamiento: tras 'npm run seed'
  siguen saliendo 17 canonicos de 20 productos, el numero que F-002 verifico.»
  → **el número ya no es el de hoy**: ver I1 y SP1. Verificable en su intención
  con C9.
- **C5 `[ya]`** — «La identidad canonica se resuelve por UN solo codigo, el
  menor en orden lexicografico de los validos, de modo que reenviar la misma
  lista en otro orden no crea un canonico nuevo.» → unitaria de
  `resolveCanonicalIdentity` (tres permutaciones → mismo `ean`) y prueba `db`
  E3: `CanonicalProduct.count()` con ese `ean` sigue siendo 1.
- **C6 `[ya]`** — «Existe una consulta o script que responde cuantos canonicos
  tienen mas de un codigo y cuantos tienen codigos de mas de un negocio, y su
  salida queda anotada.» → `npx tsx scripts/count-canonical-barcodes.ts`
  termina en 0 e imprime los cuatro números y el histograma; la salida literal
  se pega en `.agent/specs/F-024/tests.md`. Ver SP2 sobre qué datos.
- **C7 `[ya]`** — «docs/sync-contract.md sube a v4, documenta 'barcodes' como
  lista y dice explicitamente que la fusion sigue usando un solo codigo.» →
  `grep -n "Versión 4" docs/sync-contract.md` da una línea,
  `grep -c '"barcodes"' docs/sync-contract.md` ≥ 1, y
  `grep -n '"barcode"' docs/sync-contract.md` no da nada.
- **C8 `[ya]`** — «'bash .agent/verify.sh F-024 --full' termina con codigo 0.»
  → las nueve etapas en verde (harness, typecheck, lint, format, test, prisma,
  build, theme, bundle), con Postgres arriba para el proyecto `db`.
- **C9 `[nuevo]`** — **invariancia de la fusión en el seed**, que es lo que C4
  quiso decir: se anotan los `canonical` y `products` que imprime
  `npm run seed` **antes** del cambio y se comprueba que **después** son los
  mismos; y los tres EAN que el seed comparte a propósito
  (`7501031311309`, `7501000110018`, `7501000220017`,
  `prisma/seed.ts:57,91,131,182,191,199`) siguen dando **un** canónico cada uno
  con **dos** `StoreProduct`. Consulta ejecutable, no lectura de código.
- **C10 `[nuevo]`** — **el backfill de la migración es completo**: la consulta
  «canónicos con `ean` no nulo sin su fila en `CanonicalBarcode`» devuelve `0`
  tras `npx prisma migrate deploy`. Ninguno de los ocho criterios cubre el
  backfill, y una migración que se olvida de él deja el criterio 6 midiendo un
  universo incompleto sin que nada se ponga rojo.
- **C11 `[nuevo]`** — **la clave singular no queda en ningún fixture del repo**:
  `grep -rn "barcode:" src scripts prisma` no devuelve ninguna línea que sea una
  clave de payload (solo la firma de `normalizeBarcode` y prosa). Es el mismo
  tipo de guarda que C16 de F-018: sin ella, un fixture olvidado sigue
  compilando y pasando porque Zod ya rechazó… nada, porque el fixture no llega
  al schema.

## Incongruencias detectadas

- **I1 — el número de C4 está caducado, y lo estaba antes de F-024.** F-002
  verificó «20 productos → 17 canónicos» (`.agent/features.json`, notas de
  F-002), pero el seed de hoy siembra **28** `StoreProduct` (15 de
  `DEMO_PRODUCTS` + 5 de `SECOND_STORE_PRODUCTS` + 2+2+2 en las tiendas
  `seed-tienda-4/5/6` de F-017 + 2 de `OTHER_BUSINESS_PRODUCTS` de F-018,
  `prisma/seed.ts:317,337,375,398,415,503`) y **19** canónicos (9 EAN
  distintos + 10 huérfanos deduplicados por nombre,
  `prisma/seed.ts:856-870`). Además `npm run seed` imprime **conteos globales
  de tabla** (`prisma/seed.ts:513-519`), no del seed, y la base local está
  compartida entre worktrees y sembrada con fixtures de pruebas: el 17 no
  volvería ni arreglando el seed. Regla 3: el criterio no se toca; se propone
  C9 y se pregunta SP1. Cifras obtenidas leyendo `prisma/seed.ts` sin Postgres
  levantado: confírmalas ejecutando antes de anotarlas.
- **I2 — la propuesta y `features.json` no piden lo mismo sobre
  `CanonicalProduct.ean`.** La propuesta dice que `ean @unique` «deja de ser la
  clave de fusión»
  (`.agent/specs/propuestas/canonico-fusionado-por-ean-sucio.md`, § Diseño
  propuesto punto 2), mientras los criterios 4 y 5 de F-024 exigen que la fusión
  **no** cambie. Se resuelve a favor de `features.json`: en F-024 `ean` se queda
  (R5). Quitarlo es del feature del grafo.
- **I3 — el `400` de C1 tumba el lote entero, no el evento.** `src/app/api/internal/sync/catalog/route.ts:33-38`
  valida `catalogBatchSchema` completo antes de procesar; no hay forma de
  responder `207` con un solo evento `failed` por schema inválido sin cambiar el
  contrato de la ruta, que está fuera. El criterio dice «responde 400 y no
  escribe nada» y así se cumple, pero la consecuencia —un POS en v3 se queda sin
  sincronizar **nada** hasta que migre— tiene que estar escrita en el contrato,
  no descubrirse en producción.
- **I4 — `AGENTS.md` pide coordinar el cambio de contrato con cuadrecaja**
  (§ Documentación) y HD5 dice que allí no hay nada desarrollado. No hay
  contradicción real: es un **aviso**, no una negociación (la v3 hizo lo mismo).
  Queda como acción del humano, fuera del código.
- **I5 — la spec de F-015 describe el `barcode` singular**
  (`.agent/specs/F-015/spec.md:83,89`, `.agent/specs/F-015/tests.md:42`). Son el
  registro histórico de un feature cerrado y **no se editan**: `specs/<id>/` se
  conserva como la especificación de lo que existía cuando se construyó. El
  criterio 7 habla de `docs/sync-contract.md`, no de esos archivos.
- **I6 — `src/features/marketplace/server/dbFixtures.ts:37` documenta
  `deriveEan` diciendo que `CanonicalProduct.ean` es único.** Sigue siendo
  cierto después de F-024 (R5), pero si algún fixture pasa a sembrar varios
  códigos por canónico, ese comentario necesita una línea más para no engañar
  al siguiente que lo lea.

## Huecos y preguntas al humano

**SP1 — ¿Cómo se cierra el criterio 4, cuyo número ya no existe? RESUELTA (2026-08-28).**
El humano eligió la opción (a): C9 (invariancia antes/después) es la forma
verificable de C4; se anota en la bitácora que el número literal caducó por
F-017/F-018, no por F-024. No se abre feature nuevo para la nota de F-002 (b) ni
se revierte el seed (c).
_Qué falta:_ C4 exige «17 canónicos de 20 productos» y el seed de hoy da otras
cifras (I1), por razones que no tienen nada que ver con F-024 (F-017 y F-018
añadieron fixtures).
_Por qué bloquea:_ solo el veredicto. `sdd.sh done` cuenta criterios marcados y
la regla 1 exige verificar ejecutando algo; nadie puede marcar C4 con verdad.
_Opciones:_ (a) aceptar C9 como la forma verificable de C4 —invariancia
antes/después más los tres EAN compartidos— y anotar en la bitácora que el
número literal caducó en F-017/F-018; (b) añadir al backlog un feature que
corrija el número de la nota de F-002 (regla 3: el criterio de F-002 no se
edita); (c) devolver el seed a 20 productos, lo que rompería fixtures que
F-017 y F-018 verificaron.
_Recomendación:_ **(a)**, y (b) después si molesta que la nota de F-002 mienta.
(c) no: cambiar fixtures verificados para salvar un número es la cola que
muerde.

**SP2 — ¿Con qué datos se cierra el criterio 6, si el POS todavía no envía nada? RESUELTA (2026-08-28).**
El humano eligió la opción (a): C6 se cumple con la consulta escrita y su
salida de desarrollo (seed/fixtures) anotada en `tests.md`. No se le pregunta a
cuadrecaja la medición 1 de la propuesta (c queda descartada) ni se deja F-024
abierto esperando datos reales (b).
_Qué falta:_ el criterio 6 produce «el número que decide si el grafo se
construye». Sin integración viva (HD5), la consulta solo puede correr sobre el
seed y sobre fixtures, donde el número es artificial: el
`canonicalsWithBarcodesAcrossBusinesses` saldrá `0` porque ningún negocio del
seed comparte EAN con otro, y forzarlo cambiaría los canónicos del seed y con
ellos C4/C9.
_Por qué bloquea:_ solo el veredicto, otra vez: decide si C6 se marca con la
salida de desarrollo o si F-024 se queda abierto esperando datos reales.
_Opciones:_ (a) C6 se cumple con **la consulta escrita y su salida de
desarrollo anotada** —prueba de que mide lo que dice— y la decisión del grafo
espera una corrida posterior sobre datos reales, que no es de este feature;
(b) F-024 no cierra hasta tener datos de producción; (c) además de (a),
preguntar al equipo de cuadrecaja la medición 1 de la propuesta —cuántos
`Producto` tienen más de un `CodigoProducto`— y anotar la respuesta al lado, que
es la que de verdad decide y **no necesita código**.
_Recomendación:_ **(a) + (c)**. (b) deja el feature abierto meses por un dato que
no depende de nosotros.

No hay ninguna otra pregunta: P1–P5 de la propuesta están respondidas o
explícitamente fuera, y todo lo demás que aparecía dudoso se decidió y está en
las reglas o en § No decidido a propósito.

## No decidido a propósito

- **El corte de concentrador (P2) y el tope de grado (P5).** Los cierra el
  humano cuando el número del criterio 6 exista, en el feature del grafo.
- **Atribuir cada código a un negocio** (`businessId` en `CanonicalBarcode`).
  Hoy no hace falta (§ Datos y contrato) y añadirlo sin necesidad sería
  inventar el modelo del grafo antes de tiempo. Lo decidirá quien construya el
  grafo, si el número lo justifica.
- **Limpiar códigos que el POS dejó de enviar.** Nadie los limpia (R6). Hará
  falta cuando exista atribución; hasta entonces no se puede hacer bien.
- **Buscar por código de barras.** Ni en el marketplace (F-015) ni dentro de una
  tienda (F-021). Quien lo pida abrirá su feature.
- **Quién corre la medición contra datos reales, y cuándo.** Depende de que
  cuadrecaja implemente el envío; queda en manos del humano (SP2).
- **El tamaño máximo de la lista** (R11): sin tope en la v4. Se revisará con el
  tope de grado, no antes.
