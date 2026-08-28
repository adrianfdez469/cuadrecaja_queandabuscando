---
feature: F-018
agente: sdd-architect
actualizado: 2026-08-27T20:14:03Z
estado: listo
---

> Entrada: `.agent/specs/F-018/spec.md` (`estado: listo`), E1–E30, R1–R12,
> C1–C16, I1–I9. Decisión de fondo cerrada por
> [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md) y por HD1–HD5
> (`.agent/progress/F-018.md`). Aquí no se reabre ninguna: se decide **la forma**.
>
> Todo lo medido en este documento se midió de verdad, contra el Postgres local
> (puerto 5433) y contra clones desechables de esa misma base. Los tres bloques
> con números —el plan del pull, el SQL de la migración y el diff de Prisma— se
> ejecutaron; no son estimaciones.

## Estado actual relevante

| Pieza                                                        | Hoy                                                                                                       | Qué se hace con ella                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/app/api/internal/_lib/guard.ts`                         | `guardInternalRequest(request): NextResponse \| null` — booleano disfrazado, lee `process.env.SYNC_TOKEN` | **Se reescribe** como envoltorio (§ Decisión)                 |
| `src/lib/syncAuth.ts`                                        | `verifySyncToken` (compara dos secretos en memoria) + `hashSyncToken` (sin llamador)                      | Se poda y gana `readBearerToken`/`mintSyncToken`              |
| `src/lib/env.ts`                                             | `SYNC_TOKEN` obligatorio en el esquema Zod                                                                | Se borra esa línea (HD1)                                      |
| Las seis `route.ts` de `src/app/api/internal/`               | `const denied = guardInternalRequest(request); if (denied) return denied;`                                | Pasan al envoltorio                                           |
| `src/features/orders/server/pull.ts`                         | `pullOrders(since, limit)`, `where: { id: { gt: since } }`                                                | Gana `businessId` como primer parámetro                       |
| `src/app/api/internal/orders/status/route.ts`                | Llama a `prisma.order.updateMany` **desde `src/app/`**                                                    | Se muda a `features/orders/server/`                           |
| `src/features/sync/server/processBatch.ts`                   | `processCatalogBatch(businessId: string, events)` con el `businessId` **del cuerpo**                      | Recibe la identidad del guard                                 |
| `src/features/sync/server/inbox.ts`                          | Escribe `SyncEvent.businessId` con lo que le pasen                                                        | Sin cambios de forma; le llega el `externalId` del token (R7) |
| `src/features/sync/server/handlers/store.ts`                 | `prisma.business.upsert({ where: { externalId: payload.businessId } })`                                   | Deja de crear negocios (R8, I9)                               |
| `src/features/sync/server/handlers/misc.ts`                  | Dos `findUnique` de `Business` por `externalId` del payload                                               | Desaparecen: la identidad ya viene resuelta                   |
| `src/features/sync/server/handlers/product.ts`               | Resuelve `Store` por `externalId` global; el reuso de canónico huérfano (línea 193) también es global     | Ambos se acotan al negocio                                    |
| `src/features/sync/server/availability.ts`                   | `findMany({ where: { externalId: { in } } })` global                                                      | Gana `businessId` en el `where`                               |
| `src/features/sync/server/reconciliation.ts`                 | `findUnique({ where: { externalId } })` global                                                            | Comprueba el dueño                                            |
| `src/features/storefront/server/registry.ts` (`previewSlug`) | `storeKnown` global (línea 154) y `reason: "own"` global (líneas 188-195)                                 | Acota **solo** el `storeExternalId` (R10)                     |
| `prisma/schema.prisma`                                       | `syncTokenHash String?` sin `@unique` (I4); `Order` sin `businessId`                                      | Migración escrita a mano (§ Modelo de datos)                  |
| `prisma/seed.ts`                                             | **Un** negocio (`seed-negocio-1`), seis tiendas                                                           | Gana un segundo negocio y la acuñación                        |
| `vitest.config.mts` + `vitest.setup.db.ts`                   | Tres proyectos; el `db` con techo declarado de 6 archivos `*.db.test.ts` (hoy 2)                          | Se reutiliza tal cual; F-018 sube a 4                         |
| `src/features/marketplace/server/dbFixtures.ts`              | `createFixtureSession()` — un negocio aislado por ejecución, limpieza propia                              | **La pieza clave de AP-c**: se extiende                       |

Se reutiliza tal cual, sin tocar: `src/lib/prisma.ts`, `src/lib/httpJson.ts`
(vía `src/app/api/internal/_lib/issues.ts`), `src/features/sync/schemas.ts`
(los esquemas Zod no cambian: el `businessId` del cuerpo **sigue viajando**,
solo cambia lo que se hace con él), `src/lib/cache.ts`, `expandBrandTouch`
y todo el mecanismo de revalidación por tag.

Estado real de la base local, consultado hoy: **1 negocio** (`seed-negocio-1`,
`active`), **0 con `syncTokenHash`**, **1 pedido** (`PENDING`), cuya `Store`
apunta a ese negocio. `Store.businessId` es `NOT NULL` y `Order.storeId` es
`NOT NULL` con FK — de ahí sale la demostración de que el backfill no puede
dejar huérfanos.

## Decisión

**La identidad viaja como parámetro de la función, no como variable de entorno
ni como campo del cuerpo.** Tres piezas, una por capa, y ninguna ruta puede
saltárselas porque el tipo no la deja compilar:

1. **`src/lib/syncAuth.ts` (capa `lib/`, pura)** lee y valida la **forma** de la
   cabecera y calcula el SHA-256. Nunca toca Prisma ni sabe qué es un negocio.
2. **src/features/sync/server/caller.ts (etapa 2, por crear)** (capa
   `features/*/server/`) es **la única** consulta que resuelve el negocio desde
   el hash. Devuelve un resultado discriminado de cuatro estados.
3. **`src/app/api/internal/_lib/guard.ts` (capa `app/`)** compone las dos:
   exporta `withInternalAuth(handler)`, un envoltorio que autentica y **le
   entrega la identidad al handler como segundo argumento**.

Las seis rutas quedan así, sin el bloque de tres líneas repetido seis veces:

```ts
export const dynamic = "force-dynamic"; // literal, en el archivo de ruta

export const GET = withInternalAuth(async (request, caller) => {
  // caller.businessId / caller.externalId ya están resueltos
});
```

**Por qué el envoltorio y no un resultado que la ruta comprueba.** La spec pide
que «el compilador lo impida, no la disciplina». Con un `GuardResult`
discriminado que la ruta narrowea (`if (!auth.ok) return auth.response;`) el
compilador impide **usar** la identidad sin comprobar, pero no impide _no pedirla_:
una ruta nueva que no llame al guard compila igual de bien. Con el envoltorio, la
identidad es un **parámetro**: no hay forma de escribir el cuerpo del handler sin
tenerla, y no hay forma de exportar el handler sin pasar por el envoltorio. Es la
misma jugada nominal que ya usa este repo con `SlugTouchSet`
(`src/features/storefront/server/registry.ts`), llevada a la frontera HTTP.

Que Next acepta `export const GET = …` está comprobado en el propio tipo del
framework: `node_modules/next/dist/server/route-modules/app-route/module.d.ts`
declara los métodos como `[method in HTTP_METHOD]?: AppRouteHandlerFn`, es decir
comprueba el **tipo** del export, no su sintaxis.

**Alternativas descartadas**, una línea cada una:

- _El guard sigue devolviendo `NextResponse | null` y la ruta consulta el negocio
  aparte_ → dos fuentes de identidad, que es exactamente el bug que F-018 cierra.
- _`GuardResult` discriminado, comprobado a mano en cada ruta_ → protege el uso,
  no el olvido; y repite el bloque seis veces (ver arriba).
- _Resolver el negocio en `src/proxy.ts`_ → **prohibido**: el `matcher` no puede
  crecer hacia rutas que el CDN sirve, y ampliarlo es el error más caro del repo
  (`AGENTS.md` § Cosas que muerden, ficha `proxy-matcher-anula-isr.md`).
- _Cachear el mapa token→negocio en memoria_ → una rotación (E25) o una baja
  (E5) tardarían el TTL en surtir efecto; ahorra ~1 ms de una petición que ya
  cuesta decenas.
- _`src/lib/syncAuth.ts` recibe un `PrismaClient` inyectado_ → metería Prisma en
  `lib/` por la puerta de atrás (R9, `AGENTS.md` § Arquitectura).
- _Un `businessId` de plataforma con lista de negocios permitidos_ → ADR 0013 ya
  lo descartó; reabrirlo exige una ADR que la supere.

**Consecuencia de forma, no menor:** al desaparecer la comparación de dos
secretos en memoria, `timingSafeEqual` se queda sin uso en este camino. La
comparación pasa a ser una igualdad sobre un índice `UNIQUE` de hashes
(R4). `timingSafeEqual` y su envoltorio `safeEqual` se borran junto con
`verifySyncToken`; R4 sigue vigente como regla («es la única forma de comparar
dos secretos **en memoria**»), simplemente ya no hay ninguna comparación así.
El riesgo residual —el tiempo de un `findUnique` sobre un btree no es constante—
se acepta explícitamente: lo que se busca es el SHA-256 del token presentado, no
el token, y ADR 0008 mantiene intacto su camino a HMAC.

## Componentes

| Componente                                         | Capa                 | Responsabilidad                                                                           | Archivo                                                                     |
| -------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `readBearerToken`                                  | `lib/`               | Valida la forma de `Authorization` (esquema, no vacío, ≥ 32 caracteres). Sin base         | `src/lib/syncAuth.ts` (modificado)                                          |
| `hashSyncToken`                                    | `lib/`               | SHA-256 hex. Ya existe; gana su primer llamador                                           | `src/lib/syncAuth.ts`                                                       |
| `mintSyncToken`                                    | `lib/`               | Acuña `{ token, hash }` con `randomBytes(36).toString("base64url")` (48 caracteres, E23)  | `src/lib/syncAuth.ts` (nuevo en él)                                         |
| `resolveCaller` / `syncConfigured`                 | `features/*/server/` | **La única** consulta que resuelve el negocio desde el hash (R9)                          | src/features/sync/server/caller.ts (por crear)                              |
| `withInternalAuth`                                 | `app/`               | Compone las dos anteriores y produce la tabla de errores. No consulta nada por su cuenta  | `src/app/api/internal/_lib/guard.ts` (reescrito)                            |
| `findCatalogMismatch` / `findAvailabilityMismatch` | `features/*/` (puro) | Coherencia del `businessId` del cuerpo contra el del token, **antes** del inbox (R5, E14) | src/features/sync/identity.ts (por crear)                                   |
| `setOrderStatus`                                   | `features/*/server/` | El `updateMany` acotado que hoy vive en la ruta — arregla de paso la violación de capa    | src/features/orders/server/status.ts (por crear)                            |
| `pullOrders`                                       | `features/*/server/` | Gana `businessId` como primer parámetro y lo mete en los dos `where`                      | `src/features/orders/server/pull.ts` (modificado)                           |
| `processCatalogBatch`                              | `features/*/server/` | Recibe la identidad ya resuelta y la reparte a los handlers                               | `src/features/sync/server/processBatch.ts` (modificado)                     |
| Handlers del sync                                  | `features/*/server/` | Reciben `businessId` interno; ninguno vuelve a resolver un negocio                        | `store.ts`, `misc.ts`, `product.ts` de `src/features/sync/server/handlers/` |
| `applyAvailability`                                | `features/*/server/` | `where` con `businessId`; un item ajeno no se confirma (E17)                              | `src/features/sync/server/availability.ts` (modificado)                     |
| `storeReconciliationHash`                          | `features/*/server/` | Comprueba el dueño antes de hashear (E19)                                                 | `src/features/sync/server/reconciliation.ts` (modificado)                   |
| `previewSlug`                                      | `features/*/server/` | Acota **solo** `storeExternalId` (R10, E21)                                               | `src/features/storefront/server/registry.ts` (modificado)                   |
| Acuñación por CLI                                  | `scripts/`           | Crea o rota el token de un negocio e imprime el claro una vez (E23, E24)                  | scripts/mint-sync-token.ts (por crear — ver **AP2**)                        |
| Siembra de dos negocios                            | `prisma/`            | Dos negocios con token acuñado, idempotente (E26, E27)                                    | `prisma/seed.ts` (modificado)                                               |
| Fixtures de dos inquilinos                         | `features/*/server/` | Dos sesiones aisladas con token real, pedidos y limpieza                                  | `src/features/marketplace/server/dbFixtures.ts` (modificado)                |
| Guarda de frontera                                 | `app/` (prueba)      | Que ninguna ruta interna futura se salte el envoltorio ni toque Prisma                    | src/app/api/internal/boundaries.test.ts (por crear)                         |

## Contratos

### La identidad

```ts
// src/features/sync/server/caller.ts
export type InternalCaller = {
  /** Business.id interno (uuid). Es lo que va a todo `where`. */
  businessId: string;
  /** Business.externalId — el Negocio.id del POS. Lo único que se compara
   *  contra el payload y lo único que se escribe en SyncEvent.businessId (R7). */
  externalId: string;
};

export type CallerResolution =
  | { status: "ok"; caller: InternalCaller }
  | { status: "inactive" } // hash resuelve, Business.active = false  -> 403
  | { status: "unknown" } // hash no resuelve, pero hay hashes puestos -> 401
  | { status: "unconfigured" }; // ningún Business tiene syncTokenHash       -> 503

export async function resolveCaller(tokenHash: string): Promise<CallerResolution>;
export async function syncConfigured(): Promise<boolean>;
```

`resolveCaller`, exactamente:

```ts
const row = await prisma.business.findUnique({
  where: { syncTokenHash: tokenHash }, // exige el @unique de la migración
  select: { id: true, externalId: true, active: true },
});
if (!row) return (await syncConfigured()) ? { status: "unknown" } : { status: "unconfigured" };
if (!row.active) return { status: "inactive" };
return { status: "ok", caller: { businessId: row.id, externalId: row.externalId } };
```

`syncConfigured` es
`(await prisma.business.findFirst({ where: { syncTokenHash: { not: null } }, select: { id: true } })) !== null`
— un `LIMIT 1`, y **solo se ejecuta en el camino de fallo**.

Prohibido, y conviene escribirlo porque es el error natural: `findFirst` sobre
un valor que pueda ser `undefined`. `tokenHash` siempre es una cadena hex de 64
caracteres porque `readBearerToken` ya validó la forma; si algún día alguien
llamara con `undefined`, Prisma devolvería **la primera fila** y autenticaría a
un negocio cualquiera. Por eso la firma es `string` y la consulta es
`findUnique`, no `findFirst` (E8).

### La forma de la cabecera

```ts
// src/lib/syncAuth.ts
export const SYNC_AUTH_SCHEME = "Bearer";
export const MIN_SYNC_TOKEN_LENGTH = 32;

export type BearerRead =
  { ok: true; token: string } | { ok: false; reason: "missing" | "malformed" };

export function readBearerToken(header: string | null | undefined): BearerRead;
export function hashSyncToken(token: string): string;
export function mintSyncToken(): { token: string; hash: string };
```

`reason` es para el log y para que las pruebas de unidad distingan casos; el
guard **mapea los dos al mismo 401** (E2 = E3 = E4, R4).

### El envoltorio

```ts
// src/app/api/internal/_lib/guard.ts
import type { InternalCaller } from "@/features/sync/server/caller";

export type InternalRouteHandler = (request: Request, caller: InternalCaller) => Promise<Response>;

export function withInternalAuth(
  handler: InternalRouteHandler,
): (request: Request) => Promise<Response>;
```

Orden de comprobación dentro del envoltorio, que es el de la spec
(configuración → formato → resolución → `active`):

1. `readBearerToken(request.headers.get("authorization"))`.
2. Si **no** es válida la forma → `syncConfigured()`: `false` → 503, `true` → 401.
3. Si lo es → `resolveCaller(hashSyncToken(token))` y se traduce el estado.
4. `ok` → `handler(request, caller)`.

Ver **AP3**: este orden hace que una petición **sin cabecera** ejecute una
consulta (la de configuración), cosa que E2/E3 describen como «sin consultar la
base». Se resuelve a favor de E6 y de R2, que son la invariante de seguridad.

### Tabla de errores de `/api/internal/*`

Es la de la spec, sin añadir ni quitar nada, con dónde se produce cada una:

| Situación                                            | Código | Cuerpo                            | Quién responde                                                  |
| ---------------------------------------------------- | ------ | --------------------------------- | --------------------------------------------------------------- |
| Ningún negocio con `syncTokenHash`                   | `503`  | `{"error":"SYNC_NOT_CONFIGURED"}` | `withInternalAuth` + un `console.error` con el comando a correr |
| Sin cabecera / esquema ≠ Bearer / vacío / < 32 chars | `401`  | `{"error":"UNAUTHORIZED"}`        | `withInternalAuth`                                              |
| Token que no resuelve ningún negocio                 | `401`  | `{"error":"UNAUTHORIZED"}`        | `withInternalAuth`                                              |
| Negocio con `active: false`                          | `403`  | `{"error":"BUSINESS_INACTIVE"}`   | `withInternalAuth`                                              |
| `businessId` del cuerpo ≠ negocio autenticado        | `403`  | `{"error":"BUSINESS_MISMATCH"}`   | La ruta, con src/features/sync/identity.ts (por crear)          |
| Pedido de otro negocio                               | `404`  | `{"error":"UNKNOWN_ORDER"}`       | src/features/orders/server/status.ts (por crear) → la ruta      |
| Tienda de otro negocio (reconciliación)              | `404`  | `{"error":"UNKNOWN_STORE"}`       | `src/features/sync/server/reconciliation.ts` devuelve `null`    |

Los `400` (`INVALID_QUERY`, `INVALID_BODY`, `INVALID_JSON`, `INVALID_BATCH`,
`INVALID_ORDER_ID`, `MISSING_STORE_ID`, `MISSING_QUERY`) siguen **dentro** del
handler, es decir después del guard. No cambian.

### La coherencia del cuerpo (R5, E14)

```ts
// src/features/sync/identity.ts  — puro, sin Prisma, sin React
/** Devuelve la ruta del campo que no cuadra, o null. El valor recibido NO
 *  se devuelve al llamante: el cuerpo del 403 es fijo. */
export function findCatalogMismatch(
  callerExternalId: string,
  batch: { businessId: string; events: SyncEventInput[] },
): string | null;

export function findAvailabilityMismatch(
  callerExternalId: string,
  batch: { businessId: string },
): string | null;
```

Qué mira, campo por campo:

| Entidad         | Campo con `businessId` | Se comprueba |
| --------------- | ---------------------- | ------------ |
| raíz del lote   | `businessId`           | sí           |
| `STORE`         | `payload.businessId`   | sí           |
| `CATEGORY`      | `payload.businessId`   | sí           |
| `PRODUCT`       | `payload.businessId`   | sí           |
| `EXCHANGE_RATE` | `payload.businessId`   | sí           |
| `CURRENCY`      | —                      | no lo lleva  |

Se escribe con `"businessId" in event.payload`, que TypeScript estrecha sobre la
unión discriminada sin un solo `any` (`AGENTS.md` § Prohibiciones). Un `403`
aborta **el lote entero** antes de `recordBatch`, así que no queda ninguna fila
`SyncEvent` que el reintento pueda reportar como `duplicate` — la trampa de
`AGENTS.md` § «Un evento fallido NO es un duplicado» queda del lado bueno por
construcción.

`availability` también lleva `businessId` en la raíz (`src/features/sync/schemas.ts`);
R5 no distingue endpoints, así que se comprueba igual. Eso **no** contradice E17:
E17 habla de los `items[]`, que se identifican por `storeId` y se ignoran en
silencio; la raíz sigue siendo un 403.

### Firmas que cambian en `features/*/server/`

| Antes                                          | Después                                                                             | Por qué                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pullOrders(since, limit)`                     | `pullOrders(businessId, since, limit)`                                              | E9–E11, R3                                                  |
| — (el `updateMany` vivía en la ruta)           | `setOrderStatus({ businessId, orderId, status, reason }): Promise<{ ok: boolean }>` | E12, y `src/app/` deja de tocar Prisma                      |
| `processCatalogBatch(businessId, events)`      | `processCatalogBatch(caller, events)`                                               | E15; el interno va a los handlers, el externo al inbox (R7) |
| `handleStore(payload, operation)`              | `handleStore(payload, operation, businessId)`                                       | R8, E16                                                     |
| `handleCategory(payload, operation)`           | `handleCategory(payload, operation, businessId)`                                    | Quita un `findUnique` por evento                            |
| `handleExchangeRate(payload)`                  | `handleExchangeRate(payload, businessId)`                                           | Ídem                                                        |
| `handleProduct(payload, operation)`            | `handleProduct(payload, operation, businessId)`                                     | Acota la tienda y el canónico huérfano                      |
| `applyAvailability(items)`                     | `applyAvailability(businessId, items)`                                              | E17                                                         |
| `storeReconciliationHash(storeExternalId)`     | `storeReconciliationHash(businessId, storeExternalId)`                              | E19                                                         |
| `previewSlug({ slug, name, storeExternalId })` | `previewSlug({ slug, name, storeExternalId, businessId })`                          | R10, E21                                                    |

El `businessId` viaja como **primitivo** (`string`), no como el tipo
`InternalCaller`, salvo en `processCatalogBatch`, que necesita los dos campos.
Así `features/orders/` no importa un tipo de `features/sync/` y no se crea una
dependencia entre dominios por un alias de dos campos.

## Flujo de datos

Una petición cualquiera, de punta a punta:

```
POS ──Authorization: Bearer <tokenA>──▶ route.ts
                                          │  export const GET = withInternalAuth(fn)
                                          ▼
                                   withInternalAuth            [app/]
                                     │ 1. readBearerToken()    [lib/, sin base]
                                     │      forma mal → syncConfigured() → 503 | 401
                                     │ 2. hashSyncToken()      [lib/, sin base]
                                     │ 3. resolveCaller(hash)  [features/sync/server/]
                                     │      unconfigured → 503 · unknown → 401 · inactive → 403
                                     ▼
                                   handler(request, caller)    [app/, compone]
                                     │ 4. Zod sobre query/cuerpo → 400
                                     │ 5. coherencia del businessId → 403   (solo sync/*)
                                     ▼
                                   features/*/server/*         [único sitio con Prisma]
                                        where: { businessId: caller.businessId, … }
```

Y las seis rutas, una por una:

| Ruta                                   | Qué le pasa al `caller`                                                                                         | Recurso ajeno                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/internal/orders`             | `pullOrders(caller.businessId, since, limit)`                                                                   | No existe: el `where` filtra (E9–E11)                           |
| `POST /api/internal/orders/status`     | `setOrderStatus({ businessId: caller.businessId, orderId, … })`                                                 | `updateMany` cuenta 0 → `404 UNKNOWN_ORDER` (E12, R6)           |
| `POST /api/internal/sync/catalog`      | `findCatalogMismatch(caller.externalId, body)` → 403; si no, `processCatalogBatch(caller, events)`              | 403 antes de escribir nada (E14)                                |
| `POST /api/internal/sync/availability` | `findAvailabilityMismatch(caller.externalId, body)` → 403; si no, `applyAvailability(caller.businessId, items)` | Item ajeno: fuera de `confirmed`, sin contar en `applied` (E17) |
| `GET /api/internal/reconciliation`     | `storeReconciliationHash(caller.businessId, storeId)`                                                           | `null` → `404 UNKNOWN_STORE` (E19)                              |
| `GET /api/internal/slug-availability`  | `previewSlug({ …, businessId: caller.businessId })`                                                             | `storeKnown: false`, `reason` nunca `"own"` (E21)               |

**Dentro de `processCatalogBatch`**, el reparto de los dos ids:

- `recordBatch(caller.externalId, events)` → `SyncEvent.businessId` sigue
  guardando el id del POS (R7, I7). Es el **único** sitio donde viaja el externo.
- `applyEvent(event, caller.businessId)` → todos los handlers reciben el
  **interno**, y ninguno vuelve a mirar `payload.businessId`. Eso es lo que hace
  que C6 (`grep -rn "payload.businessId" src/features/sync/server/handlers/`
  vacío) sea cierto **por construcción**, no por vigilancia.

**Dentro de los handlers**, cómo se vuelve invisible una tienda ajena sin gastar
una consulta más:

- `handleProduct` ya selecciona `businessId` en su `findUnique` de `Store`
  (`src/features/sync/server/handlers/product.ts:35-48`): basta comparar en
  memoria y devolver `SKIPPED`. Cero consultas nuevas.
- `handleStore` hace lo mismo añadiendo `businessId: true` a su `select` del
  `Store` existente. Cero consultas nuevas.
- `handleStore` sustituye el `upsert` de `Business` por
  `prisma.business.update({ where: { id: businessId }, data: { name, baseCurrencyCode } })`:
  mismo número de escrituras, y ya no puede nacer un negocio desde un payload
  (R8, E16, I9).
- El reuso de canónico huérfano
  (`src/features/sync/server/handlers/product.ts:193`) pasa de
  `findFirst({ where: { externalId } })` a
  `findFirst({ where: { storeId: store.id, externalId } })`. **Esto es una fuga
  real que la spec no nombra**: dos negocios cuyo POS emita el mismo
  `ProductoTienda.id` compartirían hoy el mismo `CanonicalProduct` huérfano.
  Entra porque es la misma regla R1 y porque el archivo se toca igual.

**Dentro de `previewSlug`**, la acotación mínima de R10:

```ts
const ownStoreExternalId =
  input.storeExternalId &&
  (await prisma.store.count({
    where: { externalId: input.storeExternalId, businessId: input.businessId },
  })) > 0
    ? input.storeExternalId
    : null;
const storeKnown = ownStoreExternalId !== null;
```

y el resto de la función usa `ownStoreExternalId` donde hoy usa
`input.storeExternalId`. Una sola consulta, la misma que ya hacía, con una
condición más. `candidate`, `available`, `resolvedSlug`, `url` y los motivos
`free`/`taken`/`reserved`/`retired`/`invalid` **no se tocan**: el espacio de
slugs es global y público, y acotarlo haría mentir al endpoint (E21, E22).

## Modelo de datos y migraciones

### Los cuatro cambios de `prisma/schema.prisma`

```prisma
model Business {
  syncTokenHash String? @unique     // (1) I4: hoy no lo es
  orders        Order[]             // (2) relación inversa
}

model Order {
  businessId String                 // (3) NOT NULL
  business   Business @relation(fields: [businessId], references: [id])
  @@index([businessId, status, id]) // (4) los tres existentes se conservan
}
```

### Cómo se genera sin que Prisma proponga un reset

`prisma migrate dev` **no** se usa: con una base de desarrollo compartida entre
worktrees vuelve a ofrecer el reset por deriva de checksum
(`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`), y el
reset es uno de los dos comandos prohibidos. El camino, que es el de esa ficha:

1. Editar `prisma/schema.prisma` con los cuatro cambios.
2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   — no toca `_prisma_migrations`, no valida checksums viejos, no propone nada.
3. Crear a mano `prisma/migrations/<timestamp>_order_business_id_and_sync_token_unique/migration.sql`
   (por crear) con el DDL **editado** (abajo).
4. `npm run db:deploy` (`prisma migrate deploy`).
5. Comprobar: `SELECT count(*) FROM "Order" WHERE "businessId" IS NULL` = 0 y
   `npx prisma migrate status` sin deriva (C14).

**Ejecutado hoy**, el paso 2 devuelve exactamente esto:

```sql
-- DropIndex
DROP INDEX "CanonicalProduct_name_trgm_idx";
-- DropIndex
DROP INDEX "CanonicalProduct_searchVector_idx";
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "businessId" TEXT NOT NULL;
-- CreateIndex
CREATE UNIQUE INDEX "Business_syncTokenHash_key" ON "Business"("syncTokenHash");
-- CreateIndex
CREATE INDEX "Order_businessId_status_id_idx" ON "Order"("businessId", "status", "id");
-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Dos cosas hay que arreglar a mano, y las dos están fichadas:

- **Los dos `DROP INDEX` se borran.** Son los índices GIN creados a mano en la
  migración inicial, que Prisma no sabe que existen
  (`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`).
  Dejarlos apagaría la búsqueda del marketplace en silencio.
- **`ADD COLUMN … NOT NULL` falla.** Comprobado sobre un clon de la base local:
  `ERROR: column "businessId" of relation "Order" contains null values`.

### El archivo de migración, en su orden exacto

Verificado de principio a fin contra un clon de la base local real
(`CREATE DATABASE … TEMPLATE queandabuscando`), con su único pedido:

```sql
-- 1. Nullable primero: la base local ya tiene pedidos reales.
ALTER TABLE "Order" ADD COLUMN "businessId" TEXT;

-- 2. Backfill desde la tienda que ya es dueña del pedido.
UPDATE "Order" o SET "businessId" = s."businessId" FROM "Store" s WHERE s.id = o."storeId";

-- 3. Y solo entonces se aprieta.
ALTER TABLE "Order" ALTER COLUMN "businessId" SET NOT NULL;

-- 4. El resto, tal cual lo generó Prisma.
CREATE UNIQUE INDEX "Business_syncTokenHash_key" ON "Business"("syncTokenHash");
CREATE INDEX "Order_businessId_status_id_idx" ON "Order"("businessId", "status", "id");
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Resultado en el clon: `UPDATE 1`, `still_null = 0`, los dos índices creados con
el nombre esperado, la FK puesta y **los dos índices GIN intactos**.

**Qué pasa si el backfill dejara huérfanos: nada, no puede.** `Order.storeId` es
`NOT NULL` con FK a `Store`, y `Store.businessId` es `NOT NULL` (consultado hoy
en `information_schema`), así que el `UPDATE … FROM` casa el 100 % de las filas.
Y si alguna vez no casara —un futuro que hiciera `storeId` nullable—, el paso 3
falla con el mensaje de arriba y `prisma migrate deploy` **revierte el archivo
entero** (Postgres ejecuta cada migración en una transacción). Eso es lo
correcto: **no** hay negocio de respaldo, ni `DEFAULT`, ni fila cero. Una
migración que se inventa el dueño de un pedido es peor que una migración que se
para.

`syncTokenHash` sigue siendo nullable con `UNIQUE`: Postgres no considera que
dos `NULL` colisionen, que es justo lo que hace falta mientras haya negocios sin
token. El único negocio de la base tiene `NULL` hoy, así que el índice se crea
sin conflicto.

**Riesgo heredado, ya escrito y no resuelto aquí:** aplicar `migrate deploy`
desde este worktree deja `_prisma_migrations` de la base compartida por delante
de los demás worktrees. Es el «riesgo que queda abierto» de la ficha de deriva;
se escala, no se arregla en un feature.

### E29 — el pedido nace con su negocio

`src/features/orders/server/createOrder.ts:244` añade una línea:
`businessId: store.businessId`. El valor ya está cargado: `loadStoreForCheckout`
(`src/features/orders/server/quote.ts:121-128`) selecciona
`business: { select: { id: true } }` y lo devuelve como `businessId`. Cero
consultas nuevas en el checkout.

## Lo que dice el `EXPLAIN` de verdad (I3, C7)

**Confirmo el análisis de I3, y lo corrijo en un punto que invalida la receta de
verificación de C7.** Medido sobre tablas reales con la forma de `Order`
(pkey en `id`, índice `(status, id)`, índice `(businessId, status, id)`) y la
consulta del pull tal cual la emite Prisma:

```sql
SELECT … FROM "Order" WHERE "businessId" = $1 AND id > $2 ORDER BY id ASC LIMIT 100
```

| Escenario                                                         | Plan real                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tabla de 6 filas (≈ la base local de hoy), `enable_seqscan = off` | **`Index Scan using Order_pkey`** + `Filter: businessId` — el índice **no** se usa |
| 200 filas ajenas + 5 propias, `enable_seqscan = off`              | `Sort` → `Index Only Scan using Order_businessId_status_id_idx`                    |
| 500 filas ajenas + 5 propias, **sin tocar nada**                  | `Sort` → `Bitmap Index Scan on Order_businessId_status_id_idx`                     |
| 200 000 filas, inquilino con el 0,1 %                             | `Sort` → `Index Only Scan using Order_businessId_status_id_idx`                    |
| 200 000 filas, inquilino con el 5 %                               | `Index Scan using Order_pkey` — ni con `enable_seqscan = off` cambia               |

Tres conclusiones, y las tres son accionables:

1. **La receta de C7 no funciona.** `SET enable_seqscan = off` no basta porque el
   plan rival no es un `Seq Scan`: es un `Index Scan` sobre la clave primaria,
   que con `ORDER BY id LIMIT n` es barato precisamente por venir ya ordenado.
   Con la base local tal cual está (1 pedido), C7 **falla** tal como está escrito.
   Ver **AP1**.
2. **I3 acierta en el fondo:** cuando el índice se usa, el plan lleva un `Sort`,
   porque `id` queda detrás de `status`, que la consulta no restringe. El índice
   que cubre exactamente esta consulta es `(businessId, id)`, y con él el plan es
   `Index Only Scan` sin `Sort` (medido: 18 páginas leídas frente a 29, sobre
   200 000 filas).
3. **Y hay una razón nueva para no añadirlo ahora**, que I3 no podía saber: si
   `(businessId, id)` existe, el planificador lo prefiere **siempre**, y entonces
   el `EXPLAIN` de C7 nombraría ese índice y no el que el criterio pide. El
   criterio 7 y el índice óptimo son, hoy, mutuamente excluyentes. Ver **AP4**.

Plan esperado, para que quede escrito antes de que nadie lo mida: con datos
suficientes para que el negocio sea selectivo, `Limit → Sort → Index (Only|Bitmap)
Scan using Order_businessId_status_id_idx`, con `Index Cond` sobre `businessId`
e `id`. Nunca `Seq Scan`.

Nota para quien escriba la verificación (a) de C7: `indexdef` se renderiza como
`… USING btree ("businessId", status, id)` —con comillas en `businessId` y sin
ellas en `status` e `id`—, así que un `LIKE '%(businessId, status, id)%'` literal
**no** casa. Se compara contra el nombre del índice o contra esa cadena exacta.

## Pruebas: el corte entre mock y Postgres real (AP-c)

Tres reglas y una tabla.

**Regla 1 — El proyecto `server` prueba comportamiento, no aislamiento.** Al
desaparecer `SYNC_TOKEN`, los tests de ruta dejan de inyectar una variable y
pasan a mockear **un solo módulo**: `@/features/sync/server/caller`. Eso es lo
que compra tener la consulta en un módulo propio (AP-a): el mock es un `vi.mock`
de dos funciones, no de `@/lib/prisma`.

**Regla 2 — El proyecto `db` prueba aislamiento, y solo lo que exige dos
negocios de verdad.** Nada que se pueda demostrar con un mock baja aquí: cada
archivo `*.db.test.ts` cuesta una `PrismaClient` propia y el techo declarado en
`vitest.config.mts` es de 6 archivos. Hoy hay 2; F-018 los deja en **4**.

**Regla 3 — Ningún test toca datos que no ha creado.** Ni `TRUNCATE`, ni
`UPDATE "Business" SET "syncTokenHash" = NULL` global (eso rompería el seed y
pisaría los otros worktrees, que comparten esta base). Aislamiento por sesión de
fixture, como F-015.

| Escenario                                           | Proyecto | Archivo                                                       | Por qué ahí                                                                 |
| --------------------------------------------------- | -------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| E1–E8: la matriz 401/403/503 del guard              | `server` | src/app/api/internal/\_lib/guard.test.ts (por crear)          | Es lógica de traducción de estados; el resolutor va mockeado                |
| C4/E6: 503 con **ningún** hash configurado          | `server` | el mismo                                                      | Nulear todos los hashes en la base compartida está prohibido por la regla 3 |
| Que cada ruta pase el `caller` a su función         | `server` | los tres `route.test.ts` existentes + los tres que faltan     | Aserto sobre el argumento del mock                                          |
| E14: mismatch del cuerpo                            | `server` | src/features/sync/identity.test.ts (por crear)                | Función pura, sin base                                                      |
| Handlers con identidad inyectada                    | `server` | `product.test.ts`, `store.test.ts` (existentes, ampliados)    | Prisma mockeado, como hoy                                                   |
| C1/E9–E11: el pull de A no ve pedidos de B          | `db`     | src/features/orders/server/pull.db.test.ts (por crear)        | Necesita dos negocios y filas reales                                        |
| C7/E30: el plan del pull                            | `db`     | el mismo, en su propio `describe` con su propio relleno       | `EXPLAIN` exige Postgres                                                    |
| E1/E5/E8/E24/E25: hash, `UNIQUE`, inactivo, rota    | `db`     | src/features/sync/server/tenantScoping.db.test.ts (por crear) | El `@unique` y el `findUnique` solo existen en la base                      |
| E17, E19, E21: disponibilidad, reconciliación, slug | `db`     | el mismo archivo, un `describe` cada uno                      | Reutiliza el mismo par de negocios: un fixture, cuatro escenarios           |
| C16 + frontera de capa                              | `server` | src/app/api/internal/boundaries.test.ts (por crear)           | Lee el disco; ni base ni mocks                                              |
| C1 en runtime, C3, C5, C10–C13 por HTTP             | smoke    | .agent/specs/F-018/smoke.sh (por crear)                       | La única capa donde se ve el código HTTP de verdad                          |

### Los dos negocios aislados

No se toca el seed para probar: **se abren dos sesiones de fixture**.
`createFixtureSession()` (`src/features/marketplace/server/dbFixtures.ts`) ya
crea un `Business` + `Storefront` aislados por token de ejecución y los limpia.
Llamarla dos veces da dos inquilinos independientes. Lo que hay que añadirle:

| Añadido                            | Detalle                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `syncToken` en la sesión           | La sesión acuña con `mintSyncToken()` y escribe `syncTokenHash` en su `Business`. Es lo que hace que el guard resuelva de verdad |
| `businessExternalId`               | Ya existe como `${token}-business`; se expone para las comprobaciones de coherencia del cuerpo                                   |
| `createOrder(storeId, { status })` | Pedidos reales para E9–E11; `code` e `idempotencyKey` llevan el token de la sesión, que es único                                 |
| `createFillerOrders(storeId, n)`   | Solo para el `describe` del `EXPLAIN`; ver el número en **AP1**                                                                  |
| Limpieza                           | `OrderItem` cae por `onDelete: Cascade`, pero `Order` hay que borrarlo **antes** que `Store` (FK `RESTRICT`)                     |
| `sweepStaleFixtures`               | Mismo orden nuevo: si no borra los `Order` rancios, el `deleteMany` de `Store` empieza a fallar y el barrido deja de servir      |

`dbFixtures.ts` es de `features/marketplace/` y su prefijo de token es
`qab_f015_`. F-018 lo **reutiliza tal cual**, sin renombrar: mover el módulo o
el prefijo es un refactor que no pide nadie y que tocaría dos features que ya
pasan. Queda anotado por si a alguien le pica.

### Lo que no se prueba con base real, a propósito

- **El 503.** Requiere que **ningún** negocio tenga hash; en una base compartida
  y sembrada eso solo se logra rompiéndola. Mock en `server`, y la mitad «sin
  `SYNC_TOKEN`» de C4 la cubre el aserto de C16 (la variable ya no existe).
- **La rotación (C5/E25) en el proyecto `db`**: se prueba a nivel de función
  (reacuñar cambia el hash y el viejo deja de resolver), y **por HTTP** en el
  smoke, que es donde se ve el 401/200 que pide el criterio.

## Escalabilidad y límites

Hoy: **dos negocios sembrados, un llamante por negocio**, sin despliegue. Los
números de abajo son por petición y por lote, y el «×100» es 200 negocios.

| Camino                           | Round-trips hoy                                         | Con F-018                                          | ×100                                                          |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Guard, camino feliz              | 0                                                       | **1** (`findUnique` por índice `UNIQUE`, O(log n)) | Igual: 200 filas es nada. ~1,7 consultas/s con crons de 2 min |
| Guard, camino de fallo           | 0                                                       | 1–2 (la sonda de configuración es `LIMIT 1`)       | Igual                                                         |
| Lote de catálogo de 500 eventos  | 1 por `CATEGORY`/`EXCHANGE_RATE` + 1 upsert por `STORE` | **0** resoluciones de negocio                      | **Mejora**: hasta 500 round-trips menos en el peor lote       |
| `applyAvailability` (2000 items) | 1 `findMany` + ≤ 3 `updateMany`                         | Igual, con una condición más en el `where`         | Igual                                                         |
| `pullOrders`                     | 3 consultas (pedidos, tiendas, ítems) + 1 `updateMany`  | Igual                                              | Ver el índice, arriba                                         |
| `previewSlug`                    | 1 `count` + 1 `findUnique` + posible `uniqueSlug`       | Igual                                              | Igual                                                         |
| Checkout                         | Sin cambio                                              | Sin cambio (`businessId` ya estaba en memoria)     | Igual                                                         |

Qué se rompe primero, con su umbral:

1. **El índice del pull, a partir de ~5 % de selectividad por negocio.** Medido:
   con un negocio que posee el 5 % de los pedidos, el planificador vuelve a
   `Order_pkey` y filtra. Eso no es un fallo mientras `LIMIT` sea 100 y los
   pedidos del negocio estén repartidos, pero con un negocio pequeño y un
   `since` viejo dentro de una tabla grande se degrada a leer muchas páginas.
   El arreglo, cuando se mida, es `(businessId, id)` (**AP4**), no cambiar nada
   más.
2. **La respuesta del pull, a partir de `limit` alto.** 500 pedidos × ~10 ítems
   ≈ 500 KB de JSON en una respuesta. Es de F-007 y no cambia; queda escrito
   porque ahora que el cursor es por negocio, un negocio parado mucho tiempo
   pide páginas llenas seguidas.
3. **El proyecto `db` de vitest, a partir de 6 archivos.** F-018 lo deja en 4.
   Cada archivo abre su `PrismaClient` con `max: 5`; 4 en paralelo son 20
   conexiones sobre las 100 por defecto de Postgres. El siguiente feature que
   añada dos archivos tiene que decidir `fileParallelism`.
4. **`Business` sin índice para la sonda de configuración.** `WHERE
syncTokenHash IS NOT NULL LIMIT 1` es un escaneo, pero con `LIMIT 1` y una
   tabla de decenas o cientos de filas se resuelve en la primera página. No
   lleva índice a propósito: sería un índice para el camino de error.

Nada de esto toca el cliente: **cero KB de JavaScript nuevo**. `/api/internal/*`
no renderiza. Y no toca la caché: ninguna de las seis rutas es ISR
(las cinco declaran `export const dynamic = "force-dynamic"` —
`slug-availability` responde con `cache-control: no-store` —), y el `matcher` de
`src/proxy.ts` sigue **sin tocarse**: sigue cubriendo solo `/admin`, que es lo
que mantiene viva la estrategia ISR de `/[slug]`.

## Qué se rompe de lo existente

| Archivo                                                                                                                                                 | Qué le pasa                                                                                                                                                                      | Feature             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `src/lib/env.ts:10`                                                                                                                                     | Se borra `SYNC_TOKEN` del esquema (HD1)                                                                                                                                          | —                   |
| `.env.example:44` y su comentario                                                                                                                       | Se sustituye por `QAB_BEARER_TOKEN` (token de `seed-negocio-1`, para scripts y smokes) con el comando de acuñación                                                               | —                   |
| `.github/workflows/ci.yml:33`                                                                                                                           | Se borra la variable                                                                                                                                                             | —                   |
| `src/features/admin/schemas.test.ts:8`                                                                                                                  | La línea `process.env.SYNC_TOKEN = …` deja de hacer falta                                                                                                                        | F-011               |
| `src/lib/syncAuth.test.ts`                                                                                                                              | Se reescribe: `verifySyncToken` ya no existe; el comentario de la línea 40 nombra la variable (C16)                                                                              | F-005               |
| `src/app/api/internal/orders/route.test.ts`, `src/app/api/internal/orders/status/route.test.ts`, `src/app/api/internal/slug-availability/route.test.ts` | Dejan de inyectar la variable; mockean el resolutor                                                                                                                              | F-007, F-017        |
| `scripts/pull-orders.mjs`, `scripts/send-catalog-batch.mjs`, `scripts/send-availability-batch.mjs`, `scripts/send-store-batch.mjs`                      | `QAB_BEARER_TOKEN` + bandera `--token`. Los tres últimos mandan `businessId: "seed-negocio-1"` en el cuerpo, así que **tienen que llevar el token de ese negocio** o reciben 403 | F-005, F-006, F-007 |
| `.agent/specs/F-007/smoke.sh`, `.agent/specs/F-010/smoke.sh`, `.agent/specs/F-011/smoke.sh`, `.agent/specs/F-017/smoke.sh`                              | Igual. Sin la variable, fallan con el comando exacto para acuñarla; **nunca se saltan en verde**                                                                                 | idem                |
| `docs/sync-contract.md`                                                                                                                                 | Sube a **v3** con los siete puntos que la spec enumera                                                                                                                           | —                   |
| `docs/adr/0008-bearer-token-baseline.md:23`                                                                                                             | Ver I5, abajo                                                                                                                                                                    | —                   |
| `docs/adr/0016-escritura-publica-sin-sesion.md:9`                                                                                                       | **No se toca**: solo cita la decisión de ADR 0008 en su contexto histórico                                                                                                       | —                   |
| `.agent/features.json` F-005, criterio con `passes: true`                                                                                               | Su literal nombra `SYNC_TOKEN` (I6). No se toca (regla 3); es una nota para el humano                                                                                            | F-005               |

### I5 — la frase falsa de ADR 0008

Decisión: **las dos anotaciones, porque son una línea cada una y el lector puede
llegar por cualquiera de los dos documentos.** No las escribe este agente.

1. En `docs/adr/0008-bearer-token-baseline.md`, bajo el encabezado, esta línea
   literal (nota del implementador: en un bloque de código para que Prettier
   no le borre los espacios entre los `code spans` anidados):

   ```
   > **Modificada en parte por [ADR 0013](0013-identidad-de-integracion.md) (F-018)**: la invariante del 503 sigue viva, pero su sujeto ya no es `SYNC_TOKEN` —que dejó de existir— sino «ningún `Business` tiene `syncTokenHash`».
   ```

2. En `docs/adr/0013-identidad-de-integracion.md`, una línea en § Consecuencia:
   que sustituye el mecanismo de ADR 0008 sin tocar su camino a HMAC ni sus
   disparadores.

Es un **paso del plan**, no una edición de este ciclo.

## Etapas de implementación

Sirven para que el orquestador las convierta en pasos verificables. El orden no
es negociable en tres puntos, marcados abajo.

| Etapa | Qué entra                                                                                                                                                                                     | Qué verifica al terminar                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1     | `prisma/schema.prisma` (4 cambios) + la carpeta de migración escrita a mano + `npm run db:deploy`                                                                                             | C14: 0 filas con `businessId` nulo, `migrate status` sin deriva, los dos índices GIN vivos   |
| 2     | `src/lib/syncAuth.ts` (poda + `readBearerToken` + `mintSyncToken`), src/features/sync/server/caller.ts, `src/app/api/internal/_lib/guard.ts`, `src/lib/env.ts`, src/features/sync/identity.ts | Unidad, mockeada: E1–E8 y E14. Todavía ninguna ruta cambiada                                 |
| 3     | Las seis `route.ts` + las diez firmas de `features/*/server/` + `createOrder.ts` + los `route.test.ts` y tests de handler actualizados                                                        | C2, C6 (`grep` vacío), E9–E22 con mocks; `npm run typecheck` es aquí el que caza los olvidos |
| 4     | scripts/mint-sync-token.ts + `prisma/seed.ts` (segundo negocio + acuñación idempotente) + `package.json`                                                                                      | E23, E24, E26, E27; `npm run seed && npm run seed` en 0 y con el mismo hash (C15)            |
| 5     | `src/features/marketplace/server/dbFixtures.ts` + los dos `*.db.test.ts` nuevos + src/app/api/internal/boundaries.test.ts                                                                     | C1, C7, C16, E9–E11, E17, E19, E21, E25                                                      |
| 6     | La cola: 4 scripts, 4 smokes, `.env.example`, `.github/workflows/ci.yml`, `docs/sync-contract.md` v3, las dos notas de ADR (I5), .agent/specs/F-018/smoke.sh                                  | C3, C5, C8, C10–C13 por HTTP y C9 (`--full` en 0)                                            |

No negociable: **1 antes que 3** (el pull filtra por una columna que tiene que
existir); **2 antes que 3** (las rutas importan el envoltorio); **4 antes que 6**
(sin tokens acuñados los smokes solo pueden comprobar el 503).

## Patrones a seguir / antipatrones a evitar

- **Prisma solo en `features/*/server/`** (`AGENTS.md` § Arquitectura). F-018
  cierra la excepción que quedaba: `src/app/api/internal/orders/status/route.ts`
  deja de importar `@/lib/prisma`. La guarda de frontera lo fija para siempre.
- **`export const dynamic = "force-dynamic"` se queda en cada archivo de ruta,
  como literal.** No se mueve al envoltorio ni se importa de una constante: Next
  analiza los segment config exports **estáticamente**, y es el mismo mecanismo
  que rompe el build con `export const revalidate` importado (`AGENTS.md`
  § Cosas que muerden, ficha `revalidate-no-literal.md`).
- **El `matcher` de `src/proxy.ts` no se toca.** Autenticar en el proxy parece
  elegante y anula el ISR de `/[slug]` entero.
- **Nada de `$transaction`** en ningún camino nuevo: el pooler corre en modo
  transacción. El guard es una consulta suelta; el mismatch del cuerpo no
  escribe.
- **Idempotencia y guarda de escritura rancia intactas.** F-018 no añade
  handlers, pero cambia sus firmas: `sourceUpdatedAt` y el reintento seguro
  siguen siendo la propiedad que hace irrelevante el orden de entrega
  (`AGENTS.md` § Cosas que muerden).
- **Un evento fallido no es un duplicado.** El 403 de coherencia ocurre **antes**
  de `recordBatch`, así que no deja fila que luego se reporte como `duplicate`.
- **Sin `any`, sin cadenas mágicas.** `MIN_SYNC_TOKEN_LENGTH` y el largo del
  token son constantes exportadas; los códigos de error, literales de un solo
  sitio (el envoltorio).
- **Un recurso ajeno responde como inexistente** (R6). Nunca un 403 en `status`,
  `reconciliation` ni `slug-availability`: eso convertiría el endpoint en un
  oráculo de existencia entre inquilinos.
- **El token en claro solo se imprime** (R11). Ni columna, ni log del servidor,
  ni cuerpo de respuesta. El `console.error` del 503 dice qué ejecutar, no qué
  token falta.

## Riesgos y plan B

| Riesgo                                                                                                 | Probabilidad | Plan B                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El aserto del `EXPLAIN` (C7) es intrínsecamente frágil: depende del planificador y de las estadísticas | Alta         | Subir el relleno del fixture y `ANALYZE "Order"` antes del `EXPLAIN`; **nunca** borrar el aserto. Ver AP1                                                                                                |
| `migrate deploy` desde este worktree deja la base compartida por delante de los demás                  | Media        | Ya fichado; se escala al humano, no se arregla desde el feature                                                                                                                                          |
| El segundo negocio del seed choca con un fixture de F-004/F-010/F-011/F-017                            | Media        | Ids nuevos (`seed-negocio-2`, `seed-tienda-7`) y slug nuevo; los smokes existentes referencian ids literales, así que no se cruzan. Ficha `seed-storefront-colisiona-con-slug-ya-agrupado.md` como aviso |
| `export const GET = withInternalAuth(…)` no le gusta al `next typegen`                                 | Baja         | El tipo del framework acepta cualquier `AppRouteHandlerFn`; si aun así fallara, el plan B es el `GuardResult` discriminado descartado arriba, con dos líneas repetidas por ruta                          |
| Un smoke se queda en verde sin token porque alguien lo hace opcional                                   | Media        | La spec ya lo prohíbe: sin `QAB_BEARER_TOKEN` el smoke **falla** con el comando de acuñación. Es un aserto del tester                                                                                    |
| Alguien reintroduce `SYNC_TOKEN` por comodidad                                                         | Baja         | El aserto de C16 vive en src/app/api/internal/boundaries.test.ts, que corre en cada `npm test`, no en un grep manual                                                                                     |

## ¿Hace falta una ADR?

**No.** Todo lo estructural de este feature ya está decidido y aceptado en
[ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md): token por
negocio, identidad desde el token, `businessId` denormalizado con su índice. Lo
que F-018 añade son **consecuencias de forma** (el envoltorio, el módulo que
resuelve, el corte limpio de la variable), no decisiones nuevas.

Lo único que faltaba escribir es la nota que I5 pide, y no es una ADR nueva:
son las dos líneas de § I5, que superan la frase de ADR 0008 sin invalidar su
decisión ni su camino a HMAC. Si el humano prefiere formalizarlo, el número
libre es `docs/adr/0020-…`; la recomendación es no gastarlo aquí.

## Incongruencias y notas para el orquestador

- **I3 confirmado y ampliado** (§ Lo que dice el `EXPLAIN`): el análisis de la
  spec es correcto y además hay una razón nueva para no añadir `(businessId, id)`
  todavía. Lo que **no** sobrevive es la receta de verificación de C7.
- **Fuga no recogida en la spec:** el reuso de canónico huérfano de
  `src/features/sync/server/handlers/product.ts:193` es global entre negocios.
  Entra en el alcance por R1; si el humano prefiere dejarlo fuera, es una línea.
- **Violación de capa preexistente:** `src/app/api/internal/orders/status/route.ts`
  importa `@/lib/prisma`. Se arregla aquí porque hay que tocar esa consulta de
  todos modos; el ESLint del repo no la caza (solo mira `components/` y
  `app/**/*.tsx`).
- **E2/E3 vs E6:** conflicto real dentro de la spec, resuelto a favor de E6 y R2
  (**AP3**).
- **C7 (b) y el `indexdef`:** la cadena literal `(businessId, status, id)` no
  aparece en `pg_indexes`; se compara contra `("businessId", status, id)` o
  contra el nombre del índice.

## Preguntas al humano

**AP1 — La verificación de C7 no funciona tal como está escrita.** Medido: con
la base local (1 pedido) el plan es `Index Scan using Order_pkey`, incluso con
`SET enable_seqscan = off`, porque el plan rival no es un `Seq Scan`. El
criterio literal no se toca (regla 3); lo que hay que decidir es **cómo se
verifica**:

- (a) La prueba del proyecto `db` siembra ~500 pedidos de relleno de un segundo
  negocio de fixture + 5 del negocio A, ejecuta `ANALYZE "Order"` y luego el
  `EXPLAIN`; el plan nombra el índice **sin** tocar el planificador. Medido: con
  500 de relleno funciona por defecto; con 50 hace falta `enable_seqscan = off`.
- (b) Solo la mitad (a) del criterio —que el índice existe con esas tres
  columnas en ese orden—, y el `EXPLAIN` se documenta a mano en la bitácora.
- (c) Se le pide al humano una redacción `[nuevo]` que sustituya la del criterio.

**Recomendación: (a)**, con 500 filas de relleno y `SET enable_seqscan = off`
como cinturón además del tirante. Cuesta un `createMany` de ~50 ms y es el único
camino que ejecuta de verdad lo que el criterio dice.

**AP2 — La extensión del script de acuñación.** E23 y C5 dicen
`node scripts/mint-sync-token.mjs`. El problema: la lógica de acuñación
(`randomBytes` + SHA-256) tiene que ser **la misma** que usa el guard, que vive
en `src/lib/syncAuth.ts` (TypeScript), y `prisma/seed.ts` (TypeScript, corre con
`tsx`) tiene que reutilizarla sin duplicarla.

- (a) scripts/mint-sync-token.ts, corrido con `tsx` (`npm run mint:token`), que
  importa `mintSyncToken` de `src/lib/syncAuth.ts`. Precedente en el repo:
  `scripts/backfill-search-vector.ts` con `npm run db:backfill-search`. Cambia el
  literal de E23/C5 de `.mjs` a `.ts`.
- (b) `.mjs` como dice la spec, reimplementando las tres líneas de cripto. Si
  divergen, los tokens acuñados dejan de autenticar —ruidoso, no silencioso—,
  pero es exactamente la duplicación que la spec pidió evitar.
- (c) `.mjs` que importa el `.ts` apoyándose en el type-stripping nativo de
  Node 24. Funciona hoy y ata `src/lib/syncAuth.ts` a no usar nada que Node no
  sepa despojar.

**Recomendación: (a)**, y que el humano acepte el cambio de extensión en E23/C5.

**AP3 — El 503 gana al 401 aunque no haya cabecera, y eso cuesta una consulta.**
E6 exige 503 «con cabecera o sin ella» cuando ningún negocio tiene hash; E2 y E3
dicen que sin cabecera o con cabecera mal formada no se consulta la base. No se
puede cumplir lo primero sin romper lo segundo.

- (a) Se cumple E6: una petición sin cabecera ejecuta la sonda de configuración
  (`LIMIT 1`, solo en el camino de fallo). E2/E3 se reinterpretan como «no se
  ejecuta ninguna consulta de **resolución de negocio**».
- (b) Se cumple E3 al pie de la letra: sin cabecera siempre 401, y el 503 solo se
  ve con un token bien formado. Rompe E6 y deja el corte limpio de HD1 mudo ante
  el error más probable (nadie acuñó ningún token).

**Recomendación: (a)**, porque R2 —«un token ausente jamás significa deja pasar
todo»— es la invariante que ADR 0008 protege, y porque el coste es una consulta
`LIMIT 1` en un camino que ya falló.

**AP4 — ¿Entra también el índice `(businessId, id)`?** Medido sobre 200 000
filas: con él, el pull es `Index Only Scan` sin `Sort` (18 páginas frente a 29);
sin él, el planificador usa `(businessId, status, id)` con `Sort` en inquilinos
pequeños y vuelve a la clave primaria en inquilinos grandes.

- (a) **No ahora.** Es lo que dice la spec en § No decidido a propósito, y hay una
  razón nueva: si existiera, el `EXPLAIN` de C7 nombraría ese índice y **no** el
  que el criterio pide.
- (b) Sí, en la misma migración, y se ajusta la verificación de C7 para aceptar
  cualquiera de los dos.

**Recomendación: (a)**. Con un pedido en la base, el índice de más es coste sin
beneficio, y choca con el criterio 7 tal como está redactado.

---

**Ninguna de las cuatro cambia la forma del feature.** AP1 y AP4 tocan cómo se
verifica el criterio 7; AP2 toca dos literales de la spec; AP3 elige entre dos
frases de la spec que no pueden ser ciertas a la vez.
