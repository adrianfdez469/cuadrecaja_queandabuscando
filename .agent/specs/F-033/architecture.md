---
feature: F-033
agente: sdd-architect
actualizado: 2026-09-02T04:52:00Z
estado: listo
---

## Estado actual relevante

La semántica está cerrada en `.agent/specs/F-033/spec.md` (E1–E18, R1–R15) y no
se reabre aquí. Este documento decide **forma**: qué archivo se toca, qué se
crea, con qué firma exacta, y qué se reutiliza en vez de copiarse.

Lo que ya existe y se reutiliza **sin tocarlo**:

- **El sobre de autenticación entero.** `withInternalAuth`
  (`src/app/api/internal/_lib/guard.ts`) resuelve el negocio antes de que el
  handler vea la query y se lo entrega como parámetro; `resolveCaller`
  (`src/features/sync/server/caller.ts`) es el único módulo que hace esa
  consulta. Las tres precondiciones de la spec (`503`/`401`/`403`) salen de ahí
  y **no** se tocan. El test de frontera
  (`src/app/api/internal/boundaries.test.ts`) exige que toda ruta interna se
  exporte a través del guard: la ruta de este feature ya lo hace y sigue
  haciéndolo.
- **`serializableIssues`** (`src/lib/httpJson.ts`, reexportado por
  `src/app/api/internal/_lib/issues.ts`): la única forma de un issue en el
  cable, `{ path, message }` y nada más. Es lo que impide que un `bigint` de un
  issue de Zod llegue a `JSON.stringify` — la regresión que fija
  `src/app/api/internal/orders/route.test.ts`.
- **Los dos barridos de vencimiento** (`src/features/orders/server/expiry.ts`):
  devuelven la `PrismaPromise` sin `await` justo para que se entreguen en la
  forma de array de `$transaction([...])` (ficha
  `.agent/playbook/pooler-transaccion-deadlock.md`). Idempotentes por
  construcción y acotados por `businessId`. Se reutilizan tal cual; lo único que
  cambia es **quién los compone** (DA2).
- **El mapeo a `PulledOrder`** (`src/features/orders/server/pull.ts`): el
  `select` explícito de 25 columnas + relaciones y las ~90 líneas de mapeo con
  `money(...)`, `canonicalSlug`, `routingWhatsappNumber` y la construcción
  condicional de `proposal`. R2 exige que la lectura lateral use **este código**,
  no una copia (DA1).
- **El índice `@@index([businessId, status, id])`** de `prisma/schema.prisma`,
  que existe desde F-018 (ADR 0013). Ninguna migración (§ Modelo de datos).
- **El vocabulario de estados**: `OrderStatus` de `src/generated/prisma/enums.ts`,
  que Zod 4 acepta tal cual con `z.enum(OrderStatus)` — es un objeto `as const`,
  no un enum de TypeScript. Precedente comprobado en F-032
  (`z.enum(CheckoutMode)` en `src/features/sync/schemas.ts`). Los nueve literales
  **no** se vuelven a escribir a mano.

Lo que hay hoy en la ruta y hay que mirar de cerca, porque condiciona el diseño:

1. `src/app/api/internal/orders/route.ts` es un `querySchema` de dos campos y una
   única rama de 400. Con tres modos y cinco combinaciones prohibidas ese archivo
   deja de ser «rutea y compone» si la validación se queda dentro (AGENTS.md
   § Arquitectura). De ahí DA3.
2. `src/app/api/internal/orders/route.test.ts` afirma **hoy y en verde**
   `expect(pullOrders).toHaveBeenCalledWith("business-a", 42n, 7)`. Eso fija dos
   cosas: `pullOrders` conserva su firma posicional de tres argumentos y la ruta
   sigue llamándola con **exactamente tres** — un cuarto parámetro, aunque fuese
   `undefined`, pondría en rojo un guardián que ahora mismo está verde, y editar
   el aserto para que acomode código nuevo es debilitar la regresión que ese
   archivo existe para proteger (la del `500` con el cuerpo vacío, documentada en
   su propia cabecera). Es la razón dura por la que la lectura lateral no entra
   como parámetro de `pullOrders`. **Corrección de atribución:** una versión
   anterior de este documento colgaba esto del criterio 13, y el criterio 13 no
   habla de tests — es el del contrato («`docs/sync-contract.md` sube de versión
   … el cambio es aditivo»). Lo que prohíbe editar ese aserto no es un criterio,
   es que está verde.
3. Ese mismo archivo hace `vi.mock("@/features/orders/server/pull", () => ({ pullOrders }))`.
   Todo lo que la ruta importe **de ese módulo** y no esté en la factoría es un
   acceso que Vitest convierte en error en cuanto alguien lo toca. La lectura
   lateral en un módulo propio elimina el riesgo de raíz (DA1).
4. `src/features/orders/server/pull.test.ts` afirma sobre el `findMany` con
   `expect.objectContaining({ where, orderBy, take })`: **no** mira el `select`,
   así que extraerlo a una constante compartida es invisible para ese test.
5. El `console.error` de `src/app/api/internal/orders/route.ts` contradice
   AGENTS.md § «Cosas que muerden» (ficha
   `.agent/playbook/console-error-dispara-guardian-servidor.md`). Es preexistente
   y la spec lo deja fuera (I7): **no se reescribe**, ni siquiera para ajustarle
   el texto ahora que también cubrirá los fallos laterales.

Un hecho que sale de leer el código y que la spec no registra: `z.coerce.bigint()`
sobre la cadena vacía **no falla**, porque `BigInt("")` es `0n`. Hoy `?since=` se
comporta como `since=0` y con el diseño de abajo `?status=X&after=` se comportará
como `after=0`. Es consistente con lo que ya hay y con la tabla de la spec (que
lista `?after=-1` y `?after=x` como 400, no el vacío), y queda escrito para que
nadie lo descubra depurando.

## Decisión

Ocho decisiones de forma. Ninguna cambia lo que la spec decidió.

### DA1 — La consulta lateral vive en un módulo propio, y el payload se extrae a un tercero

Tres módulos donde hoy hay uno:

1. src/features/orders/server/pulledOrder.ts (etapa 1, por crear) — **la forma
   del payload, una sola vez**. Se lleva de `src/features/orders/server/pull.ts`,
   sin cambiarles una línea: los tipos `RateSnapshot`, `PulledOrderProposal` y
   `PulledOrder`, el objeto `select` completo y todo el cuerpo del `.map(...)`
   convertido en una función. Nada más.
2. src/features/orders/server/lateralRead.ts (etapa 2, por crear) — **las dos
   lecturas laterales**. Importa el `select` y el mapeo de (1) y el compositor de
   barridos de DA2. **No importa `pull.ts`**, así que no tiene forma de llamar al
   `updateMany` de `PULLED` ni por descuido.
3. `src/features/orders/server/pull.ts` — el pull incremental de siempre, ahora
   importando el `select` y el mapeo de (1). Conserva su firma, su cuerpo de
   respuesta y su `updateMany`.

**Por qué el mapeo sale a un módulo y no se exporta desde `pull.ts`.** Tres
motivos, en orden de peso:

- **La trampa del mock.** `src/app/api/internal/orders/route.test.ts` mockea el
  módulo `pull` entero con una factoría de un solo export. Si el `select` y el
  mapeo viven ahí, cualquier módulo que los importe recibe el mock en ese test —
  y el día que alguien añada un caso lateral a ese archivo (o que la ruta toque
  el camino lateral por otro motivo) el fallo es un «No export is defined on the
  mock» que no dice nada del feature. Con el mapeo en un módulo propio, mockear
  `pull` no alcanza a la lectura lateral y viceversa.
- **La dirección de la dependencia.** `lateralRead.ts` importando `pull.ts` haría
  que el módulo que **no debe** marcar `PULLED` dependa del que sí: la garantía
  de R7 pasaría a ser «acuérdate de no llamar a esa función». Con la extracción,
  R7 se sostiene por construcción — la función que marca no está en el grafo de
  imports de la lectura lateral.
- **El tamaño.** `pull.ts` son 306 líneas de las que ~200 son la forma del
  payload y ~60 el pull. Partirlo deja dos archivos que se leen enteros.

**Por qué no parámetros nuevos en `pullOrders`.** Además del aserto de tres
argumentos de la ruta (§ Estado actual, punto 2), la función quedaría con tres
modos, un `if` para el `where`, otro para el `updateMany` y otro para el cursor:
R7 y R1 pasarían a depender de tres condicionales en el mismo cuerpo. Descartado.

**Por qué no un `readOrders` único que englobe los tres modos.** Uniría en una
firma dos cosas con efectos distintos (una marca `PULLED`, la otra no) y
obligaría a la ruta a pasarle un discriminante para que la función vuelva a
abrirlo. Descartado: el discriminante ya lo resuelve el parser (DA3), y cada modo
tiene su `where` y su puntero.

**Por qué no `Prisma.OrderSelect` duplicado en cada función.** Es literalmente lo
que R2 prohíbe: dos sitios donde olvidar un campo. El `select` es **una
constante** compartida y el mapeo, **una función** compartida.

Firma exacta de lo que se crea:

```ts
// src/features/orders/server/pulledOrder.ts (etapa 1, por crear)
import { Prisma } from "@/generated/prisma/client";

export type RateSnapshot = { base: string; capturedAt: string; rates: Record<string, string> };
export type PulledOrderProposal = {/* idéntico al de pull.ts hoy */};
export type PulledOrder = {/* idéntico al de pull.ts hoy */};

/** R2: EL `select` del payload del POS. Una constante, un solo sitio.
 *  `as const` (no solo `satisfies`) para que `OrderGetPayload` conserve los
 *  literales `true` y el tipo de fila se derive del propio select. */
export const PULLED_ORDER_SELECT = {
  /* las 25 claves de pull.ts:141-191 */
} as const satisfies Prisma.OrderSelect;

export type PulledOrderRow = Prisma.OrderGetPayload<{ select: typeof PULLED_ORDER_SELECT }>;

/** R2: EL mapeo. El cuerpo actual de `rows.map(...)` (pull.ts:195-286), sin
 *  cambiar una línea de aritmética ni de formato. */
export function toPulledOrder(order: PulledOrderRow): PulledOrder;
```

Si `as const satisfies` no le basta a `OrderGetPayload` para inferir la fila (es
el único punto de tipos con riesgo real), la alternativa idiomática de Prisma es
`Prisma.validator<Prisma.OrderSelect>()({ ... })`, que preserva los literales por
construcción. No hay tercera opción aceptable: escribir el tipo de la fila a mano
es duplicar el `select` en otra forma.

```ts
// src/features/orders/server/lateralRead.ts (etapa 2, por crear)
import type { OrderStatus } from "@/generated/prisma/enums";
import type { PulledOrder } from "./pulledOrder";

/** El cuerpo que las DOS lecturas laterales producen. `nextCursor` no está
 *  aquí a propósito: es de la respuesta HTTP y vale `null` siempre (R1, DA7). */
export type LateralOrders = { orders: PulledOrder[]; nextAfter: string | null };

export function readOrdersByStatus(input: {
  businessId: string;
  status: OrderStatus;
  after: bigint;
  limit: number;
}): Promise<LateralOrders>;

/** `nextAfter` siempre `null`: esta lectura no pagina (SP7). */
export function readOrdersByIds(input: {
  businessId: string;
  ids: bigint[];
}): Promise<LateralOrders>;
```

Argumento por objeto y no posicional: es lo que ya hacen `setOrderStatus`
(`src/features/orders/server/status.ts`) y `proposeOrderChange`
(`src/features/orders/server/proposal.ts`) en cuanto pasan de dos campos.
`pullOrders` se queda posicional porque su firma está congelada por el test que
no se puede editar.

### DA2 — El barrido se extrae a un compositor en `expiry.ts`, y las tres lecturas lo llaman

R8 se cumple igual copiando el array de tres elementos en cada función. Se extrae
igualmente, a **una** función en `src/features/orders/server/expiry.ts`, junto a
los dos barridos que ya viven ahí:

```ts
// src/features/orders/server/expiry.ts (archivo existente, +1 export)
/** Toda lectura de pedidos del POS barre primero y lee después, en la MISMA
 *  `$transaction([...])` en forma de array (R8, DA5 de F-019, ficha
 *  `pooler-transaccion-deadlock`). `read` llega SIN `await`: una promesa ya
 *  resuelta no es una `PrismaPromise` y no se puede transaccionar — el
 *  compilador lo rechaza, que es justo el punto. */
export async function readAfterExpirySweeps<T>(
  businessId: string,
  read: Prisma.PrismaPromise<T>,
): Promise<T> {
  const [, , rows] = await prisma.$transaction([
    expireProposalsQuery(businessId),
    expireUnquotedDeliveryOrdersQuery(businessId),
    read,
  ]);
  return rows;
}
```

**El coste**, medido: tres líneas nuevas en un archivo existente y cuatro líneas
menos en `src/features/orders/server/pull.ts` (`prisma.$transaction([...])` pasa
a `readAfterExpirySweeps(businessId, prisma.order.findMany({...}))`). Cero
cambios en `src/features/orders/server/pull.test.ts`, que mockea `@/lib/prisma`
con `$transaction: (ops) => Promise.all(ops)` y `$executeRaw`: el compositor usa
exactamente esas dos cosas del mismo módulo mockeado. Cero cambios en
`src/features/orders/server/expiry.db.test.ts`, que prueba los barridos sueltos.

**Por qué merece la pena**, aunque R8 se cumpla sin ello:

1. **Ya pasó.** F-031 añadió un segundo barrido y tuvo que enhebrarlo a mano en
   el array del pull. Con este feature habría **tres** arrays que actualizar en
   el próximo; con el compositor, uno.
2. **Fija el orden de bloqueo ahora que R15 permite paralelismo.** Hasta hoy solo
   el pull barría, así que el orden de las dos sentencias dentro de la
   transacción no le importaba a nadie. Con la lateral corriendo en paralelo con
   el pull, dos transacciones del mismo negocio pueden coincidir; los dos
   `WHERE` son disjuntos por `status` (F-031 R15), así que no hay deadlock ni con
   órdenes distintos — pero eso es una propiedad que hay que **volver a
   demostrar** cada vez que alguien escriba el array a mano. El compositor la
   hace innecesaria: solo hay un orden posible.
3. **Hace visible el invariante en un sitio.** «Toda lectura de pedidos del POS
   corre los dos barridos» es una frase del contrato v8; con el compositor es
   también una función con nombre, y una lectura nueva que no la use se ve en el
   diff.

**El riesgo y su plan B:** que la inferencia del genérico contra la sobrecarga en
array de `$transaction` no cuadre en Prisma 7. Se ve en el primer `npm run
typecheck`, y el plan B es de dos minutos: dejar el array escrito en cada una de
las tres funciones (R8 se cumple igual) y anotarlo aquí. No bloquea nada.

**Descartado:** llamar a los barridos por separado antes del `findMany`. Serían
dos round-trips más y el `findMany` dejaría de ver su propia escritura, que es la
razón entera del DA5 de F-019 (`src/features/orders/server/pull.ts:34-40`).

### DA3 — La validación: presencia primero, tres schemas hermanos, y un parser puro fuera de la ruta

La query se parsea en un módulo propio, src/features/orders/internalOrdersQuery.ts
(etapa 1, por crear), **puro** (sin Prisma, sin React) y con Zod. Precedente
exacto de colocación: `src/features/catalog/catalogFilters.ts`, el módulo que
F-027 creó para ser el único que interpreta el vocabulario de querystring de un
camino. La ruta queda como manda AGENTS.md § Arquitectura: rutea y compone.

```ts
// src/features/orders/internalOrdersQuery.ts (etapa 1, por crear)
import type { OrderStatus } from "@/generated/prisma/enums";
import type { SerializableIssue } from "@/lib/httpJson";

export type InternalOrdersQuery =
  | { mode: "pull"; since: bigint; limit: number }
  | { mode: "status"; status: OrderStatus; after: bigint; limit: number }
  | { mode: "ids"; ids: bigint[] };

export type InternalOrdersQueryResult =
  { ok: true; query: InternalOrdersQuery } | { ok: false; issues: SerializableIssue[] };

/** Pura y testeable sin `Request`: recibe los `searchParams` y devuelve o el
 *  modo ya validado, o los issues tal y como viajan en el 400. */
export function parseInternalOrdersQuery(params: URLSearchParams): InternalOrdersQueryResult;
```

Devuelve `SerializableIssue[]` y **no** un `ZodError`: así la ruta no vuelve a
tener en las manos un objeto con `bigint` dentro, y la regresión de
`src/app/api/internal/orders/route.test.ts` no puede volver por un camino nuevo.
La conversión la hace este módulo llamando a `serializableIssues`
(`src/lib/httpJson.ts`); los issues de combinación los construye a mano, con
strings.

**Orden de evaluación, fijo y documentado:**

```
1. Presencia (R6) — `params.has(...)`, cinco nombres, sin mirar ningún valor:
     a. has(since) && (has(status) || has(ids))   -> SINCE_WITH_LATERAL_READ
     b. has(status) && has(ids)                    -> STATUS_WITH_IDS
     c. has(after)  && !has(status)                -> AFTER_WITHOUT_STATUS
     d. has(limit)  && has(ids)                    -> LIMIT_WITH_IDS
   Se evalúan las cuatro y se emiten TODAS las violadas, en este orden, cada
   una como un issue con `path: []`. Si hay alguna, se devuelve `ok: false`
   sin ejecutar ningún `safeParse`.
2. Modo, por presencia: has(status) -> "status"; has(ids) -> "ids"; si no, "pull".
3. `safeParse` del schema de ESE modo, y solo de ese.
```

**Por qué la presencia va primero y sola.** Es R6 literal: `since` tiene
`default(0n)`, así que después de parsear `?since=0&status=PULLED` es
indistinguible de `?status=PULLED`. Comprobarlo sobre `searchParams` antes de que
Zod toque nada es la única forma de que los dos casos con `since=0` del criterio
8 den 400. Escribirlo como un `refine` sobre un schema que ya tiene defaults es
exactamente el error que el criterio existe para pescar.

**Por qué tres schemas hermanos y no una unión.**
`z.discriminatedUnion` necesita un discriminante que esté **en los datos**, y el
nuestro es la presencia de una clave, no un valor: habría que fabricar un campo
`mode` sintético antes de parsear, es decir, hacer el paso 2 de todas formas y
además pagar la ceremonia. `z.union` es peor: agrega los issues de todas las
ramas, de modo que `?status=NOPE` devolvería también issues sobre `since` o `ids`
—parámetros que el llamante nunca envió— y el `path: ["status"]` que la tabla de
la spec exige dejaría de ser fiable. Con tres schemas hermanos, cada 400 de valor
nombra su propio parámetro y ninguno más.

**Por qué el schema del pull se mueve tal cual, sin reescribir.**
`src/app/api/internal/orders/route.test.ts` afirma
`message: expect.stringContaining("Too small")` sobre `?since=-1`: ese texto lo
genera Zod a partir de `z.coerce.bigint().nonnegative()`. El schema del modo
`pull` es **el mismo objeto de hoy**, copiado carácter por carácter salvo los
literales `1`, `500` y `100` de `limit`, que pasan a constantes del mismo valor
(DA4) y no cambian ningún mensaje.

Los tres schemas:

```ts
const limitSchema = z.coerce
  .number()
  .int()
  .min(ORDER_PULL_LIMIT_MIN)
  .max(ORDER_PULL_LIMIT_MAX)
  .default(ORDER_PULL_LIMIT_DEFAULT);

// modo pull — idéntico al de hoy (R12); el aserto de "Too small" sigue verde
const pullSchema = z.object({
  since: z.coerce.bigint().nonnegative().default(0n), // SIN tope: AP2, decidido
  limit: limitSchema,
});

// modo status
const statusSchema = z.object({
  status: z.enum(OrderStatus), // los 9, exactos y sensibles a mayúsculas
  after: z.coerce.bigint().nonnegative().max(ORDER_ID_MAX).default(0n),
  limit: limitSchema, // R12: el MISMO rango, no uno nuevo
});

// modo ids
const idsSchema = z.object({
  ids: z
    .string()
    .regex(/^\d+(,\d+)*$/) // "" , "abc", "1,,2", "1.5", "-1", " 1" -> 400
    .transform((raw) => raw.split(",").map((part) => BigInt(part)))
    .refine((ids) => ids.length <= ORDER_LATERAL_IDS_MAX, ORDER_QUERY_ISSUE.IDS_LIMIT_EXCEEDED)
    .refine((ids) => ids.every((id) => id >= 1n && id <= ORDER_ID_MAX)),
});
```

Dos detalles que no son adorno:

- **`.max(ORDER_ID_MAX)`** en `after` (y en `ids`, vía el `refine`). Un valor por
  encima de 2^63−1 es un `\d+` perfecto y un `BigInt` perfecto, pero Postgres no
  lo puede convertir a `int8`: sin el tope, `?status=PULLED&after=99999999999999999999`
  termina en el `catch` de la ruta como un **500**, no como un 400. Con el tope,
  es un `400 INVALID_QUERY` con `path: ["after"]`. **`since` se queda sin tope**
  (AP2, decidido): el pull incremental está fuera del alcance de F-033, así que
  su `500` por encima de 2^63−1 queda anotado y no arreglado, y la v8 documenta
  la asimetría — los parámetros nuevos llevan tope, `since` no.
- **El orden `.regex` → `.transform` → `.refine`** hace que el tope de 100 se
  evalúe sobre la lista ya partida y que su issue conserve `path: ["ids"]`, que
  es lo que la tabla de la spec pide para `IDS_LIMIT_EXCEEDED`.

**De dónde sale el valor crudo de cada parámetro** (AP1, decidido): los tres
laterales se leen con `params.getAll(nombre).join(",")` y `since`/`limit` siguen
con `params.get(nombre)`, como hoy. Consecuencias, todas ya cubiertas por reglas
que la spec escribió y **sin vocabulario nuevo en la v8**: `?ids=1&ids=2` se
comporta exactamente igual que `?ids=1,2` —se honra todo lo que el llamante pidió
y no se descarta nada en silencio, que es lo que el criterio 7 prohíbe—;
`?status=A&status=B` se convierte en `"A,B"`, es decir una coma en `status`, y cae
en el `400` con `path: ["status"]` de R5; `?after=7&after=8` se convierte en
`"7,8"`, que `BigInt` rechaza, y da `400` con `path: ["after"]`. El pull no cambia
de comportamiento porque sus dos parámetros se siguen leyendo con `get()`.

**El `path` de los cuatro issues de combinación es `[]`**, no un nombre de
parámetro: el problema es la query entera, no un campo. Es lo que produciría un
`refine` a nivel de objeto en Zod y lo que ya hace `readJsonBody`
(`src/lib/httpJson.ts`) para un cuerpo que no cumple como un todo. La forma sigue
siendo `{ path, message }` y nada más, que es lo único que el criterio 6 afirma.

### DA4 — Los cinco literales y los cuatro números, en `src/constants/orders.ts`

Sección nueva al final de `src/constants/orders.ts`, con el encabezado
`F-033 — lectura lateral` que ese archivo ya usa para F-019 y F-031:

```ts
/**
 * F-033: el vocabulario legible por máquina que viaja DENTRO de
 * `issues[].message` del `400 INVALID_QUERY` de `GET /api/internal/orders`.
 * Precedente: `STORE_DELIVERY_CONFIG_INCONSISTENT` (src/constants/sync.ts),
 * la v7 del contrato. Un objeto y no cinco constantes sueltas porque los
 * cinco viajan juntos: son UNA fila del vocabulario de errores de la v8, y
 * `Object.values(...)` es lo que un test compara contra el contrato.
 */
export const ORDER_QUERY_ISSUE = {
  IDS_LIMIT_EXCEEDED: "IDS_LIMIT_EXCEEDED",
  SINCE_WITH_LATERAL_READ: "SINCE_WITH_LATERAL_READ",
  STATUS_WITH_IDS: "STATUS_WITH_IDS",
  AFTER_WITHOUT_STATUS: "AFTER_WITHOUT_STATUS",
  LIMIT_WITH_IDS: "LIMIT_WITH_IDS",
} as const;
export type OrderQueryIssue = (typeof ORDER_QUERY_ISSUE)[keyof typeof ORDER_QUERY_ISSUE];

/** R9 (SP2): el tope de `?ids=`. 100 ids de ~7 cifras son ~700 caracteres de
 *  URL, muy por debajo del límite seguro de proxies (~2.000). */
export const ORDER_LATERAL_IDS_MAX = 100;

/** El techo de `Order.id`: `BIGINT` de Postgres es `int8` con signo. Un id
 *  por encima no es un 200 vacío, es un error de conversión — se rechaza
 *  como query inválida antes de llegar a la base (DA3). */
export const ORDER_ID_MAX = 9223372036854775807n;

/** R12: el rango de `limit` es UNO, compartido por el pull y por la lectura
 *  por estado. Dos constantes con el mismo valor serían dos sitios donde
 *  divergir. Los valores son los que la ruta trae desde F-007. */
export const ORDER_PULL_LIMIT_MIN = 1;
export const ORDER_PULL_LIMIT_MAX = 500;
export const ORDER_PULL_LIMIT_DEFAULT = 100;
```

**Nombres.** `ORDER_QUERY_ISSUE` y no `ORDER_LATERAL_READ_ISSUE` porque dos de
los cinco (`SINCE_WITH_LATERAL_READ`, `LIMIT_WITH_IDS`) hablan de la query
completa, y porque el nombre hace eco del código de error que los envuelve,
`INVALID_QUERY`. La forma —objeto `as const` + tipo derivado— es la de
`ORDER_PROPOSAL_DECISION` y `ORDER_RESPONSE_OUTCOME`, en ese mismo archivo.

**Por qué `src/constants/orders.ts` y no `src/constants/sync.ts`**, que es donde
vive el precedente: `sync.ts` es el vocabulario de lo que el POS **escribe** (la
ingesta de catálogo y tiendas); esto es el vocabulario de lo que el POS **lee**
de sus pedidos, y la constante hermana más cercana —`ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY`,
que gobierna otra ruta interna de pedidos— ya está en `orders.ts`. Los valores no
llevan prefijo `ORDER_` **dentro** del literal a propósito: lo que viaja por el
cable es lo que la spec fijó, palabra por palabra.

### DA5 — El plan de consulta: la lectura por estado copia el `EXPLAIN` del criterio 11; la de ids no lo necesita

**Por estado** — la forma exacta del `where`/`orderBy`, y ninguna otra:

```ts
prisma.order.findMany({
  where: { businessId, status, id: { gt: after } }, // igualdad, igualdad, rango
  orderBy: { id: "asc" },
  take: limit,
  select: PULLED_ORDER_SELECT,
});
```

Produce `WHERE "businessId" = $1 AND "status" = $2 AND "id" > $3 ORDER BY "id" ASC LIMIT $4`,
que es **literalmente** el SQL que el criterio 11 pone bajo el `EXPLAIN`. Encaja
en `(businessId, status, id)` como igualdad + igualdad + rango, con el `ORDER BY`
servido por el propio orden del índice: sin nodo `Sort`, sin `Seq Scan` y sin
migración. Tres cosas que lo romperían y que por eso van escritas:

- `status: { in: [status] }` en vez de la igualdad — el planificador puede
  resolverlo con un `BitmapOr` y el plan deja de ser el del criterio.
- `orderBy: { createdAt: "asc" }` o cualquier otro orden — mete un `Sort`.
- Un segundo filtro en el `where` (por fecha, por tienda) — no lo cubre el
  índice. Está fuera de alcance por la spec, y también por aquí.

`after` con su default `0n` deja `id > 0`, que es el inicio del rango: no estorba
al plan y evita una segunda forma del `where`.

**Por ids** — la otra forma, que no usa ese índice y no lo necesita:

```ts
prisma.order.findMany({
  where: { businessId, id: { in: dedupedIds } }, // sin `status`: el índice no aplica
  orderBy: { id: "asc" }, // E5
  select: PULLED_ORDER_SELECT,
});
```

Sin `take`: el tope **es** la longitud de la lista, ya validada en ≤ 100 (DA3).
`dedupedIds` es `Array.from(new Set(ids))`, hecho **aquí** y no en el parser,
porque el tope de 100 se cuenta sobre lo que el POS envió (E12) y la
deduplicación es una propiedad de la consulta (E9 la cumple igual sin ella: un
`IN` con el id repetido devuelve la fila una vez; deduplicar solo ahorra
parámetros).

**Qué plan usa y por qué no pido índice.** `status` es la columna del **medio**
de `(businessId, status, id)`, así que sin filtro por estado ese índice no sirve
para el rango de ids. Postgres resolverá los ≤ 100 ids por la clave primaria
(`Order_pkey`, un `Index Scan`/`Bitmap Index Scan` sobre `id = ANY($1)`) y
filtrará `businessId` sobre las ≤ 100 filas recuperadas. Eso son como mucho 100
búsquedas de índice + 100 accesos al heap por petición: coste acotado por el tope
de la lista, **independiente del tamaño de la tabla**. Un índice
`(businessId, id)` no lo mejoraría de forma medible y sí añadiría una migración,
que el criterio 11 prohíbe. **No pido índice nuevo.** La única forma de que esto
se degrade sería subir el tope de 100, y ese tope está firmado.

Un aviso para quien escriba el test: el `EXPLAIN` del criterio 11 se hace sobre
SQL escrito a mano que **imita** al `findMany` (limitación heredada del test que
ya existe en `src/features/orders/server/pull.db.test.ts`), así que la cadena del
test tiene que copiar el `where` de arriba tal cual. Y la siembra tiene que
llamar `VACUUM ANALYZE "Order"`, no solo `ANALYZE` — ficha
`.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`. El `describe`
puede vivir en un lateralRead.db.test.ts (etapa 4, por crear) junto al resto de
lo lateral en lugar de en `src/features/orders/server/pull.db.test.ts`, que es
donde la spec lo sugirió: el criterio 11 no nombra archivo, y el `EXPLAIN` es de
la consulta lateral. Lo decide sdd-tester.

### DA6 — `bigint` de punta a punta: entra con `BigInt(...)`, sale con `.toString()`, nunca pasa por `Number`

- **Entrada, `ids`:** cadena → `regex(/^\d+(,\d+)*$/)` → `split(",")` →
  `BigInt(part)`. Nunca `Number(...)`, `parseInt(...)` ni `z.coerce.number()`:
  por encima de 2^53 perderían precisión en silencio y el POS recibiría el pedido
  equivocado. El regex es lo que garantiza que `BigInt(part)` no lanza.
- **Entrada, `after`:** `z.coerce.bigint()`, exactamente como `since` desde F-007
  — `z.coerce.bigint()` llama a `BigInt(value)`, que es exacto. Acotado por
  `ORDER_ID_MAX` (DA3).
- **Salida, `nextAfter`:** `rows.at(-1)!.id.toString()` cuando la página vino
  llena (`rows.length === limit`), `null` en cualquier otro caso — la misma regla
  y el mismo código que `nextCursor` (R11,
  `src/features/orders/server/pull.ts:297-305`). Es una **cadena**, nunca un
  número: un `id` de 19 cifras no cabe en un `Number` de JSON y el propio guion
  ya lo afirma (`scripts/pull-orders.mjs:194-197`).
- **Salida, `orders[].id`:** sigue saliendo del mapeo compartido, que ya hace
  `order.id.toString()`. No se toca.
- **Los issues nunca llevan un `bigint`:** el parser devuelve
  `SerializableIssue[]` (DA3), que por definición son `path` y `message`. El
  issue `too_big` que produce `.max(ORDER_ID_MAX)` lleva un `maximum: bigint`
  dentro, y es precisamente el que `serializableIssues` descarta. La ruta nunca
  ve un `ZodError`.
- **`NextResponse.json` no recibe ningún `bigint`** en ninguno de los tres
  modos: `orders`, `nextCursor` y `nextAfter` son cadenas o `null`.

### DA7 — La respuesta la compone la ruta, y `nextCursor: null` se escribe una sola vez

Las dos funciones laterales devuelven `{ orders, nextAfter }`. El `nextCursor:
null` de R1 lo pone **la ruta**, en un único sitio, para los dos modos laterales.
Así ninguna de las dos funciones puede «acordarse» de emitir un cursor, y el pull
sigue devolviendo sus dos claves y nada más (criterio 13: un consumidor de la v7
no ve un campo que no espera).

```ts
export const GET = withInternalAuth(async (request, caller) => {
  const parsed = parseInternalOrdersQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: "INVALID_QUERY", issues: parsed.issues }, { status: 400 });
  }

  try {
    const query = parsed.query;
    if (query.mode === "pull") {
      // EXACTAMENTE tres argumentos: route.test.ts lo afirma y no se edita.
      return NextResponse.json(await pullOrders(caller.businessId, query.since, query.limit));
    }

    const lateral =
      query.mode === "status"
        ? await readOrdersByStatus({ businessId: caller.businessId, ...query })
        : await readOrdersByIds({ businessId: caller.businessId, ids: query.ids });

    // R1: la lectura lateral no lleva cursor. Un solo sitio, los dos modos.
    return NextResponse.json({
      orders: lateral.orders,
      nextCursor: null,
      nextAfter: lateral.nextAfter,
    });
  } catch (error) {
    console.error("[internal/orders] pull failed", error); // preexistente (I7): NO se toca
    return NextResponse.json({ error: "PULL_FAILED" }, { status: 500 });
  }
});
```

**El 500 se queda en `PULL_FAILED` también para los fallos laterales.** Un código
por endpoint, y el contrato no tiene que estrenar vocabulario para un caso que
solo ocurre si Postgres se cae. El `console.error` de esa rama es el preexistente
que la spec deja fuera (I7): no se reescribe ni para ajustarle el texto. Si el
implementador necesitase un log nuevo, va con `console.warn` y prefijo `[scope]`
(R14, ficha `.agent/playbook/console-error-dispara-guardian-servidor.md`); este
diseño no necesita ninguno.

### DA8 — Dónde van las pruebas nuevas y el modo del guion

No es alcance de sdd-tester decidirlo todo, pero dos colocaciones son
consecuencia directa del diseño y se fijan aquí:

- **Los tests de la ruta lateral van a un archivo nuevo**,
  route.lateral.test.ts (etapa 5, por crear), junto a
  `src/app/api/internal/orders/route.test.ts` y **sin tocarlo**. Motivo: los
  asertos de ese archivo están verdes hoy y su valor entero es seguir verdes sin
  que nadie los ajuste (§ Estado actual, punto 2); un archivo aparte lo hace
  trivialmente cierto y además evita la trampa del `vi.mock` (punto 3). Ese
  archivo mockea los dos módulos
  de lectura por separado, que es lo que hace verificable «la función de lectura
  **no** fue llamada» de los criterios 6 y 8.
- **El parser tiene su propio test unitario**, internalOrdersQuery.test.ts
  (etapa 5, por crear), sin `Request` y sin mocks: es una función pura de
  `URLSearchParams` a un resultado. Ahí es donde salen baratos los nueve casos
  del criterio 6 y los cuatro del 8.
- **El modo `--lateral` de `scripts/pull-orders.mjs`** (criterio 12) es una
  quinta función `verifyLateralRead()` con su propio encabezado
  `== Criterio 12 · lectura lateral (?status= y ?ids=) — no mueve el cursor ==`,
  añadida a la lista `only`/`run` del final del archivo **y a la lista por
  defecto**, para que una corrida sin banderas muestre las secciones del pull y
  la lateral como bloques distintos, que es lo que el criterio comprueba. Reusa
  `check()`, `seedOrder()`, `maxOrderId()` y `pull()`, que ya están; le falta un
  `propose()` local — un `POST` a `/api/internal/orders/proposal` con el bearer,
  copiado de `scripts/renegotiate-order.mjs:211-218`. Anclaje obligatorio: todo
  se afirma sobre ids que el propio guion creó (ficha
  `.agent/playbook/smoke-asume-since-0-devuelve-el-ultimo-pedido.md` — la base es
  compartida y `since=0` no identifica nada).

## Componentes

| Componente                                                                         | Capa                      | Responsabilidad                                                                               | Archivo                                                         |
| ---------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ORDER_QUERY_ISSUE`, `ORDER_LATERAL_IDS_MAX`, `ORDER_ID_MAX`, `ORDER_PULL_LIMIT_*` | `constants/`              | El vocabulario y los topes, sin literales sueltos (AGENTS.md § Prohibiciones)                 | `src/constants/orders.ts` (existe, sección nueva)               |
| `parseInternalOrdersQuery`                                                         | `features/orders/` (puro) | Presencia → modo → Zod del modo. Devuelve el modo validado o los issues del 400               | src/features/orders/internalOrdersQuery.ts (etapa 1, por crear) |
| `PULLED_ORDER_SELECT`, `toPulledOrder`, `PulledOrder`                              | `features/orders/server/` | LA forma del payload del POS: un `select`, un mapeo, un tipo (R2)                             | src/features/orders/server/pulledOrder.ts (etapa 1, por crear)  |
| `readAfterExpirySweeps`                                                            | `features/orders/server/` | Compone los dos barridos + la lectura en una `$transaction([...])` (R8)                       | `src/features/orders/server/expiry.ts` (existe, +1 export)      |
| `readOrdersByStatus`, `readOrdersByIds`                                            | `features/orders/server/` | Las dos lecturas laterales. Sin `updateMany` en su grafo de imports (R7)                      | src/features/orders/server/lateralRead.ts (etapa 2, por crear)  |
| `pullOrders`                                                                       | `features/orders/server/` | El pull incremental, con la misma firma, el mismo cuerpo de respuesta y el mismo `updateMany` | `src/features/orders/server/pull.ts` (existe, se aligera)       |
| `GET /api/internal/orders`                                                         | `app/`                    | Parsea con (2), despacha a (5) o (6), compone el cuerpo y pone `nextCursor: null` (R1)        | `src/app/api/internal/orders/route.ts` (existe)                 |
| `withInternalAuth` / `resolveCaller`                                               | `app/api/internal/_lib/`  | Identidad por token, antes de mirar la query (ADR 0013). **Sin cambios**                      | `src/app/api/internal/_lib/guard.ts`                            |
| Contrato v8                                                                        | `docs/`                   | Los tres parámetros, los topes, los rechazos y los ocho puntos de la spec                     | `docs/sync-contract.md` (existe, sube a v8)                     |
| `--lateral`                                                                        | `scripts/`                | Las dos lecturas laterales contra el servidor levantado (criterio 12)                         | `scripts/pull-orders.mjs` (existe, +1 modo)                     |

Ninguna pieza vive en `src/lib/`: nada de esto es lógica reutilizable fuera del
dominio de pedidos. Ninguna pieza es de cliente: el feature no añade un solo byte
de JavaScript al navegador.

## Flujo de datos

**Modo pull — `?since=41&limit=100` (sin cambios observables).**

1. `withInternalAuth` resuelve el negocio → `caller.businessId`.
2. `parseInternalOrdersQuery`: ninguna de las cuatro combinaciones prohibidas
   aplica; `has("status")` y `has("ids")` son falsos → modo `pull` → `pullSchema`.
3. `pullOrders(businessId, 41n, 100)`, tres argumentos.
4. Dentro: `readAfterExpirySweeps` corre los dos barridos y el `findMany`
   (`id > 41`) en una transacción; `toPulledOrder` mapea; el `updateMany` marca
   `PULLED` los `PENDING` devueltos; `nextCursor` sale si la página vino llena.
5. `200 { orders, nextCursor }` — dos claves, como en la v7.

**Modo por estado — `?status=AWAITING_CUSTOMER&limit=1&after=118`.**

1. Igual que arriba: la identidad primero.
2. Presencia: `since` ausente, `ids` ausente, `after` con `status` presente,
   `limit` sin `ids` → ninguna violación → modo `status` → `statusSchema`
   (`status` contra los nueve del enum, `after` a `118n`, `limit` a `1`).
3. `readOrdersByStatus({ businessId, status, after: 118n, limit: 1 })`.
4. Dentro: `readAfterExpirySweeps(businessId, prisma.order.findMany({ where: { businessId, status, id: { gt: 118n } }, orderBy: { id: "asc" }, take: 1, select: PULLED_ORDER_SELECT }))`.
   Los barridos van **antes** en el array, así que el `findMany` ve su propia
   escritura y una propuesta ya vencida no sale como `AWAITING_CUSTOMER` (E17,
   R8). **No hay `updateMany`**: un `PENDING` leído así sigue en `PENDING` (E16,
   R7).
5. `toPulledOrder` por fila — el mismo mapeo del pull, campo por campo (R2).
6. `nextAfter` = `id` de la última fila si `rows.length === 1`, si no `null`.
7. La ruta compone `200 { orders, nextCursor: null, nextAfter }`.

**Modo por ids — `?ids=118,140,118`.**

1. Identidad primero.
2. Presencia: sin `since`, sin `status`, sin `limit` → modo `ids` → `idsSchema`:
   el regex pasa, se parte en `[118n, 140n, 118n]`, tres ≤ 100, todos ≥ 1.
3. `readOrdersByIds({ businessId, ids })` → deduplica a `[118n, 140n]` y consulta
   `where: { businessId, id: { in: [...] } }`, ordenado por `id` ascendente,
   dentro del mismo `readAfterExpirySweeps`.
4. `businessId` en el `WHERE` (R3) hace que un id de otro negocio y uno
   inexistente produzcan el mismo cuerpo, sin ninguna clave que los distinga
   (R4/E7).
5. `200 { orders, nextCursor: null, nextAfter: null }` — una sola entrada por id
   (E9).

**Modo rechazado — `?since=0&status=PULLED&ids=1,2&limit=5`.**

Paso 2 emite tres issues, en el orden fijo: `SINCE_WITH_LATERAL_READ`,
`STATUS_WITH_IDS`, `LIMIT_WITH_IDS`. Ningún `safeParse` corre, ninguna función de
lectura se llama, ninguna consulta toca Postgres:
`400 { error: "INVALID_QUERY", issues: [...] }`.

## Contratos

### Los tres modos en el cable

```
GET /api/internal/orders?since=&limit=          -> 200 { orders, nextCursor }                 (v7, intacto)
GET /api/internal/orders?status=&limit=&after=  -> 200 { orders, nextCursor: null, nextAfter }
GET /api/internal/orders?ids=a,b                -> 200 { orders, nextCursor: null, nextAfter: null }
```

`orders[]` es el mismo `PulledOrder` en los tres, byte a byte, porque lo produce
la misma función (R2).

### Tabla de errores

| Código | Cuerpo                                                                                 | Cuándo                                                                                     |
| ------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `503`  | `{"error":"SYNC_NOT_CONFIGURED"}`                                                      | Ningún negocio tiene token acuñado. Antes de mirar la query. **Sin cambios**               |
| `401`  | `{"error":"UNAUTHORIZED"}`                                                             | Sin cabecera o token que no resuelve. Antes de mirar la query. **Sin cambios**             |
| `403`  | `{"error":"BUSINESS_INACTIVE"}`                                                        | Negocio de baja. Antes de mirar la query. **Sin cambios**                                  |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":["status"],"message":…}]}`                 | `status` fuera del enum, vacío, en minúsculas o con coma (R5)                              |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":["ids"],"message":…}]}`                    | `ids` que no es lista de enteros decimales, o con un id `0`/fuera de `int8`                |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":["ids"],"message":"IDS_LIMIT_EXCEEDED"}]}` | Más de 100 ids (R9). Nunca la lista recortada                                              |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":["after"],"message":…}]}`                  | `after` negativo, no numérico o fuera de `int8`                                            |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":["limit"],"message":…}]}`                  | `limit` fuera de 1..500. Igual que hoy en el pull (R12)                                    |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":[],"message":"SINCE_WITH_LATERAL_READ"}]}` | `since` presente junto a `status` o a `ids`, **por presencia** (R6). `?since=0&…` incluido |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":[],"message":"STATUS_WITH_IDS"}]}`         | `status` e `ids` a la vez                                                                  |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":[],"message":"AFTER_WITHOUT_STATUS"}]}`    | `after` sin `status`                                                                       |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":[],"message":"LIMIT_WITH_IDS"}]}`          | `limit` junto a `ids` — servir 1 de 2 ids es la lista recortada en silencio                |
| `500`  | `{"error":"PULL_FAILED"}`                                                              | Fallo de base en cualquiera de los tres modos. Un solo código por endpoint (DA7)           |

Cuando se violan varias combinaciones, `issues` las trae **todas**, en el orden
`SINCE_WITH_LATERAL_READ`, `STATUS_WITH_IDS`, `AFTER_WITHOUT_STATUS`,
`LIMIT_WITH_IDS`, así que `issues[0].message` también es determinista. Todo issue
tiene exactamente las claves `message` y `path` (`src/lib/httpJson.ts`).

### Lo que la v8 tiene que añadir al vocabulario de errores del contrato

La spec ya lista los ocho puntos de la v8 y no se repiten aquí. Lo único que este
documento le añade es la forma exacta de la fila nueva de § Vocabulario de
errores, que hoy no documenta `400 INVALID_QUERY` (I1 de la spec):
`400 {"error":"INVALID_QUERY","issues":[{"path":[…],"message":"…"}]}`, propia de
`GET /api/internal/orders`, con los cinco literales de `ORDER_QUERY_ISSUE` como
valores posibles de `message` en las combinaciones prohibidas — mismo patrón que
la fila `STORE_DELIVERY_CONFIG_INCONSISTENT` de la v7.

Y una frase más, de AP2: **`after` e `ids` están acotados por arriba al techo de
un `BIGINT` con signo y `since` no**. Un `since` por encima de 2^63−1 sigue
respondiendo `500` como hasta hoy, porque el pull incremental está fuera del
alcance de este feature. La asimetría va escrita para que el otro equipo no la
descubra probando.

## Modelo de datos y migraciones

**No cambia nada. Cero migraciones.** Ni tabla, ni columna, ni índice, ni valor
de enum.

- Los nueve estados que `?status=` acepta son los del enum `OrderStatus` de
  `prisma/schema.prisma`, leídos del cliente generado.
- La lectura por estado encaja en `@@index([businessId, status, id])`, que existe
  desde F-018 (DA5).
- La lectura por ids se resuelve por la clave primaria con el tope de 100 como
  cota dura; no pide índice (DA5).
- Las dos escrituras que ocurren en el camino lateral son los barridos, que ya
  existen y no cambian de forma.

Verificación, con los comandos que sí distinguen tu cambio del ruido de fondo del
repo (ficha `.agent/playbook/prisma-migrate-diff-nunca-da-cero-por-indices-no-declarados.md`:
`prisma migrate diff --exit-code` devuelve 2 siempre por los cinco índices GIN no
declarados, con o sin cambio):

```bash
git diff main --stat -- prisma/migrations   # vacío
ls prisma/migrations | wc -l                # el mismo número antes y después
npx prisma validate
```

Ninguno de los dos comandos prohibidos por AGENTS.md (`prisma migrate reset`,
`prisma db push`) aparece en este plan, ni hace falta.

## Escalabilidad y límites

Números, no adjetivos.

**Coste de una lectura lateral.** Un round-trip de aplicación: la
`$transaction([...])` lleva 2 `UPDATE` (los barridos) + 1 `SELECT`; Prisma añade
las cargas de las relaciones `store` e `items` como sentencias con `IN`, no una
por fila — **3 a 5 sentencias por petición, sin N+1, independientemente de
`limit`**. Escrituras propias: **cero** (R7). Es, de hecho, **más barata que un
pull**, que además paga un `updateMany` en un round-trip aparte cuando hay
`PENDING`.

**Tamaño de respuesta.** Un `PulledOrder` con ~10 líneas ronda los 3 KB de JSON.
Con el default `limit=100`, ~300 KB; con el máximo `limit=500`, ~1,5 MB. Un
`?ids=` de 100 pedidos, ~300 KB, y su cota dura es el tope de ids. La
recomendación para el contrato es `limit=100`: el máximo existe para el que sabe
lo que hace.

**Frecuencia.** Al oír el timbre, el POS pasa de 1 petición a 2 por ciclo y por
negocio. Con la ventana de coalescencia de 5 s de F-020, el peor caso realista es
~12 lecturas laterales por minuto y negocio. Con 100 negocios leyendo cada 30 s:
~6,7 peticiones/s en este endpoint, ~30 sentencias/s en Postgres. No es el cuello
de nada.

**Qué se rompe primero, con su umbral:**

1. **`?status=<estado terminal>` con historial grande.** Es la § «No decidido a
   propósito» de la spec: `?status=DELIVERED` paginado con `after` es un export
   del histórico del propio negocio. El keyset lo mantiene lineal (cada página
   cuesta lo mismo que la primera, a diferencia de un `OFFSET`), pero 100.000
   pedidos son 200 peticiones de 500. **Umbral: ~10.000 pedidos por negocio en un
   estado terminal.** Cota disponible sin código nuevo: el token solo ve su
   negocio y `limit ≤ 500`. Si molesta, es un feature del humano.
2. **La carga de `items` en una página llena.** 500 pedidos × ~10 líneas = ~5.000
   filas en la sentencia de `items`: es la sentencia que crece, no la de
   `Order`. **Umbral: `limit=500` con pedidos de muchas líneas**, ~2 MB de JSON.
   Se acota bajando `limit`.
3. **Los barridos, ahora en cada lectura.** Doblan la frecuencia con la que se
   ejecutan (pull + lateral). Los dos están acotados por `businessId` y por
   `status` y afectan 0 filas en la inmensa mayoría de las llamadas — un `UPDATE`
   que no encuentra filas no bloquea nada. Si mañana aparece un tercer barrido,
   el coste sube para las dos lecturas a la vez: el compositor de DA2 es el único
   sitio donde eso se ve.
4. **Concurrencia (R15).** Dos barridos concurrentes del mismo tipo y negocio se
   esperan por fila (lock wait de milisegundos) y el segundo encuentra 0 filas
   porque el `status` está en su propio `WHERE`. Los dos barridos entre sí tienen
   `WHERE` disjuntos por `status` (F-031 R15), así que **no hay deadlock posible**
   aunque el orden variara; con el compositor de DA2 ni siquiera puede variar.
   El `findMany` no toma bloqueos.
5. **La URL de `?ids=`.** 100 ids de 7 cifras ≈ 700 caracteres; el límite seguro
   de proxies ronda los 2.000. **Umbral: ~250 ids**, y el tope firmado es 100
   (R9).

**Cliente, caché e ISR:** nada. La ruta es `force-dynamic`, no se cachea, no toca
`src/proxy.ts` ni ninguna etiqueta de revalidación, y no añade un byte al bundle
(`npm run check:bundle` no se mueve).

## Patrones a seguir / antipatrones a evitar

- **`$transaction` en forma de array, nunca el callback interactivo.** El pooler
  de Supabase corre en modo transacción (AGENTS.md § Cosas que muerden, ficha
  `.agent/playbook/pooler-transaccion-deadlock.md`). El compositor de DA2 lo
  encapsula; una lectura lateral que abra su propia transacción interactiva es un
  deadlock contra el pool.
- **Prisma solo en `features/*/server/`.** La ruta no importa Prisma y el parser
  tampoco (es puro). `src/app/api/internal/boundaries.test.ts` lo verifica leyendo
  el disco.
- **Nada de literales sueltos**: el tope, el rango de `limit` y los cinco
  mensajes son constantes (AGENTS.md § Prohibiciones), y los nueve estados salen
  del enum generado, no de un array escrito a mano.
- **Ningún `console.error` nuevo.** Este diseño no necesita logs; si hiciera
  falta uno, `console.warn` con prefijo `[internal/orders]` (R14).
- **Nunca `Number(...)` sobre un id.** DA6.
- **Nada llama al POS.** ADR 0002; el grep de `scripts/pull-orders.mjs:385`
  (`CUADRECAJA_API_URL`) tiene que seguir saliendo vacío. Este diseño no añade
  ningún `fetch` de salida en `src/`.
- **La identidad sale del token.** ADR 0013: `businessId` entra en los tres
  `where` desde `caller`, jamás desde la query ni del cuerpo.
- **Prosa del arnés:** los archivos que aún no existen se citan **sin comillas
  invertidas** y con `(etapa N, por crear)`, o `npm run check:harness` se pone
  rojo (AGENTS.md § Cosas que muerden; ficha
  `.agent/playbook/check-harness-falso-positivo-ruta-abreviada.md`). Y se pasa
  `npm run format` sobre lo que uno mismo escribe, nunca a ciegas sobre prosa
  ajena (ficha `.agent/playbook/prettier-write-reescribe-prosa-ajena.md`).

## Riesgos y plan B

| Riesgo                                                                                                          | Señal                                                                                          | Plan B                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La extracción del `select`/mapeo cambia sin querer el payload del pull                                          | `src/features/orders/server/pull.test.ts` o `pull.db.test.ts` en rojo **sin haberlos editado** | Revertir a un `select` y un mapeo dentro de `pull.ts` exportados desde ahí; la extracción es mecánica, el diff tiene que ser un corta y pega                                                                            |
| `as const satisfies Prisma.OrderSelect` no infiere el tipo de fila                                              | `npm run typecheck`                                                                            | `Prisma.validator<Prisma.OrderSelect>()({...})` (DA1)                                                                                                                                                                   |
| El genérico de `readAfterExpirySweeps` no cuadra con la sobrecarga de `$transaction`                            | `npm run typecheck`                                                                            | Array inline en las tres funciones; R8 se cumple igual (DA2)                                                                                                                                                            |
| Añadir un import a la ruta hace que `src/app/api/internal/orders/route.test.ts` cargue módulos que hoy no carga | Ese archivo en rojo o mucho más lento                                                          | `@/lib/prisma` construye el cliente de forma **perezosa** (documentado en su cabecera), así que importarlo no abre conexiones; si aun así molesta, el archivo nuevo de tests mockea los dos módulos y este no toca nada |
| El `EXPLAIN` del criterio 11 sale intermitente                                                                  | `Seq Scan` en una corrida y no en otra                                                         | `VACUUM ANALYZE "Order"`, no solo `ANALYZE` (ficha `.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`)                                                                                                 |
| El modo `--lateral` del guion se ancla a un pedido que no creó él                                               | Fallos que dependen de qué haya en la base compartida                                          | Anclar todo a los ids que el propio guion sembró (ficha `.agent/playbook/smoke-asume-since-0-devuelve-el-ultimo-pedido.md`)                                                                                             |
| Levantar la app para el criterio 12 con otro `next dev` en el puerto                                            | «el servidor de desarrollo no llegó a levantar»                                                | Un solo `next dev` por directorio, y comprobar de qué checkout es (ficha `.agent/playbook/next-dev-uno-por-directorio.md`)                                                                                              |
| La v8 se escribe y la línea 3 no se mueve                                                                       | El hook `.claude/hooks/sync-contract-version.sh` avisa                                         | Subir la versión en la primera edición, no al final                                                                                                                                                                     |

## ¿Hace falta una ADR?

**No.** Las tres decisiones con vocación estructural de este feature —el endpoint
tiene tres modos, la lectura lateral no consume y no marca, y no cuenta para «un
solo pull en vuelo»— son **contrato con cuadrecaja**, y su sitio es la v8 de
`docs/sync-contract.md`, que este feature ya escribe con los ocho puntos que la
spec fija. Ninguna contradice una ADR existente: ADR 0002 se respeta (el POS
sigue iniciando todas las llamadas; la lectura lateral es una petición suya más)
y ADR 0013 se respeta (el `businessId` sale del token y entra en los tres
`where`).

Si el humano prefiere fijarlo también como decisión interna, el número siguiente
es el 0029 y el título propuesto, «la lectura lateral no consume» (docs/adr/,
sin escribir) — pero sería una ADR que solo repite lo que el contrato ya obliga,
y este repo tiene 28 ADR precisamente porque no las escribe para eso.

## Preguntas al humano

Las dos se preguntaron y **las dos están contestadas** (2026-09-02, por la
recomendación de este documento). No se borran: son la memoria de por qué el
cable es así.

**AP1 — ¿Qué hace un parámetro repetido, `?ids=1&ids=2` o `?status=A&status=B`?**
La spec no lo cubría y la ruta usa hoy `searchParams.get(...)`, que devuelve **el
primero y descarta el resto en silencio** — justo lo que el criterio 7 prohíbe
para `?ids=` (servir menos de lo que se pidió sin decirlo). Un POS que construya
la URL en un bucle cae ahí sin enterarse.

_Decidido:_ opción **(a)**. Los tres parámetros laterales se leen con
`params.getAll(nombre).join(",")`; `since` y `limit` siguen con `get()`.
`?ids=1&ids=2` se comporta exactamente igual que `?ids=1,2`; `?status=A&status=B`
se convierte en `"A,B"` y cae en el `400` de R5 con `path: ["status"]`;
`?after=7&after=8` da `400` con `path: ["after"]`. **Cero vocabulario nuevo en la
v8.**
_Por qué:_ (b) —un sexto literal `REPEATED_PARAM`— añadiría una fila al contrato
para un caso que las reglas ya escritas cubren, y (c) —gana el primero— es
exactamente el silencio que el criterio 7 rechaza.
_Dónde vive:_ DA3, § «De dónde sale el valor crudo de cada parámetro».

**AP2 — ¿Se le pone también a `since` el tope de `int8` (`ORDER_ID_MAX`)?**
Un `?since=99999999999999999999` es un entero válido para el schema de hoy pero
no cabe en un `BIGINT` de Postgres: la consulta falla y la ruta responde **500
`PULL_FAILED`** en vez de un 400. Es preexistente —no lo introduce este feature—
y `after`/`ids` sí llevan el tope en este diseño.

_Decidido:_ **`since` NO recibe tope**. El pull incremental está fuera del
alcance de F-033, así que el `500` preexistente queda **anotado y no arreglado**,
y la v8 documenta la asimetría: los parámetros nuevos llevan tope, `since` no.
Es la recomendación de este documento, que quedó escrita como opción (b) en la
tanda de preguntas; el mensaje que la contestó la citó como «(a)», pero su
contenido es literalmente esta —«`since` no recibe tope, el pull está fuera de
alcance, la v8 documenta la asimetría»—, así que se cierra por el contenido y la
letra se ignora a propósito.
_Por qué:_ ponerle el tope sería la única línea del feature que cambia una
respuesta del pull incremental (500 → 400), y la spec lo deja explícitamente
fuera («responde exactamente lo que responde hoy»). Si molesta, es un feature del
humano.
_Dónde vive:_ DA3 (el `pullSchema` queda sin `.max(...)`), § Contratos y § Lo que
la v8 tiene que añadir.

**No queda ninguna pregunta abierta.** Este documento no bloquea la firma del
plan.

## Archivos: qué se crea y qué se toca

Ninguna etapa toca `prisma/`. La numeración de etapas es orientativa —el orden
verificable lo fija `plan.md`— y está aquí para que ningún paso invente rutas.

**Se crean (5 de producto + 4 de prueba).** Se escriben sin comillas invertidas
hasta que existan (AGENTS.md § Cosas que muerden):

| Archivo                                           | Etapa | Qué lleva                                                                         |
| ------------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| src/features/orders/internalOrdersQuery.ts        | 1     | `parseInternalOrdersQuery`, los tres schemas, la comprobación de presencia (DA3)  |
| src/features/orders/server/pulledOrder.ts         | 1     | `PULLED_ORDER_SELECT`, `PulledOrderRow`, `toPulledOrder` y los tres tipos (DA1)   |
| src/features/orders/server/lateralRead.ts         | 2     | `readOrdersByStatus`, `readOrdersByIds`, `LateralOrders` (DA1/DA5)                |
| src/features/orders/internalOrdersQuery.test.ts   | 5     | El parser, sin `Request` y sin mocks: criterios 6, 7, 8 (DA8) — sdd-tester        |
| src/app/api/internal/orders/route.lateral.test.ts | 5     | La ruta con los dos módulos mockeados: 200/400 y «no se llamó» (DA8) — sdd-tester |
| src/features/orders/server/lateralRead.test.ts    | 5     | `where`/`orderBy`/`take`, `nextAfter` y que no hay `updateMany` — sdd-tester      |
| src/features/orders/server/lateralRead.db.test.ts | 4     | Criterios 1, 2, 4, 9 y el `EXPLAIN` del 11 contra Postgres real — sdd-tester      |

src/features/orders/server/pulledOrder.ts (etapa 1, por crear) no estrena test
propio: lo que hace
ya está cubierto por `src/features/orders/server/pull.test.ts`, que pasa a
ejercitarlo a través de `pullOrders` sin editarse.

**Se modifican (6).**

| Archivo                                | Qué parte se toca                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/constants/orders.ts`              | Solo se **añade**, al final: la sección `F-033 — lectura lateral` con `ORDER_QUERY_ISSUE`, `ORDER_LATERAL_IDS_MAX`, `ORDER_ID_MAX` y `ORDER_PULL_LIMIT_MIN/MAX/DEFAULT` (DA4). Nada existente cambia.                                             |
| `src/features/orders/server/expiry.ts` | Solo se **añade** `readAfterExpirySweeps<T>` (DA2). Los dos barridos no se tocan.                                                                                                                                                                 |
| `src/features/orders/server/pull.ts`   | Se **quitan** los tipos, el `select` y el cuerpo del `.map(...)` (van a `pulledOrder.ts`) y la `$transaction([...])` pasa a `readAfterExpirySweeps`. La firma, el `updateMany` y el `nextCursor` intactos.                                        |
| `src/app/api/internal/orders/route.ts` | Se **sustituye** el `querySchema` y su rama de 400 por `parseInternalOrdersQuery`, y se añade el despacho de los tres modos (DA7). El `catch`/`console.error` y el `dynamic` se quedan como están.                                                |
| `docs/sync-contract.md`                | Sube a **v8** (línea 3), § «Cambios respecto a la v7», la fila del endpoint en § Endpoints, § ③④ Pedidos, la fila de `400 INVALID_QUERY` en § Vocabulario de errores y la nota junto a «un solo pull en vuelo». Los ocho puntos los fija la spec. |
| `scripts/pull-orders.mjs`              | Se **añade** el modo `--lateral`: `verifyLateralRead()`, un `propose()` local, la bandera en el bloque de documentación de la cabecera y en las listas `only`/`run` del final, incluida la de por defecto (DA8, criterio 12).                     |

Lo que **no** se toca, y conviene que el plan lo diga en voz alta:
`src/app/api/internal/orders/route.test.ts`,
`src/features/orders/server/pull.test.ts`,
`src/features/orders/server/pull.db.test.ts`,
`src/app/api/internal/_lib/guard.ts`, `prisma/schema.prisma`,
`prisma/migrations/`, `src/features/orders/schemas.ts` y
`.agent/features.json`.
