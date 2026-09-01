---
feature: F-031
agente: sdd-architect
actualizado: 2026-09-01T16:12:15Z
estado: listo
---

## Estado actual relevante

Lo que ya existe y se reutiliza **sin tocarlo** es casi todo el camino:

- **El bucle de renegociación de F-019 entero.** `src/features/orders/server/proposal.ts`
  (una sentencia `UPDATE … FROM "Store" … RETURNING`, sin leer antes de escribir),
  `src/features/orders/server/respond.ts` (aprobar con CTE `won → cleared → inserted`,
  rechazar con un `UPDATE`), `src/features/orders/schemas.ts:117-198`
  (`proposeOrderChangeSchema`, con `items.min(1)`), el reloj de
  `src/features/orders/server/expiry.ts` y su entrega en forma de array desde
  `src/features/orders/server/pull.ts:104-106`. Cotizar **es** proponer (R4): aquí no
  nace ninguna ruta de escritura nueva.
- **El único sitio que decide un precio**, `quoteCart` en
  `src/features/orders/server/quote.ts:262`, y su carga de tienda
  `loadStoreForOrder` (`quote.ts:96-140`), que ya trae `checkoutMode`,
  `deliveryEnabled` y `deliveryFee`.
- **La lectura del pedido persistido**, `getOrderByCode` en
  `src/features/orders/server/read.ts`, compartida por la página del pedido y por
  `createOrder.ts` para armar el `wa.me` desde lo que se guardó, nunca desde la
  cotización en memoria.
- **El aislamiento por negocio** de `src/features/orders/server/status.ts`: un
  `updateMany` acotado por `businessId` cuyo `count === 0` cubre «no existe» y «no es
  tuyo» con el mismo 404 (R17).

Lo que **no** existe en ninguna capa es la forma de decir «falta un importe»:
`prisma/schema.prisma:606` declara `deliveryFee Decimal @default(0)` no anulable, y
las dos únicas lecturas de esa columna —`pull.ts:216` y `read.ts:177`— hacen
`.toString()` sobre un valor que siempre está. De ahí que hoy un pedido a la espera
de cotización se guarde **como si el envío fuera gratis**.

**Un hallazgo del camino que cambia el contrato y que la spec no podía saber.** El
pull **no** emite hoy los importes con dos decimales: `Decimal.toString()` de Prisma
suprime los ceros de relleno. Verificado contra la base real de este worktree y
contra la clase `Decimal` del runtime instalado:

```
0.00  → "0"      880.00 → "880"      500.00 → "500"
SELECT sobre "Order": {"subtotal":"1150","deliveryFee":"0","total":"1150"}
```

Es decir: el único ejemplo completo del pull en la v5.1
(`docs/sync-contract.md:621`, `"deliveryFee": "0.00"`, `"subtotal": "880.00"`) **nunca
fue cierto**, y los fixtures de `src/features/orders/server/pull.test.ts:36-45`
mockean `toString()` devolviendo `"0.00"`, así que la suite tampoco lo detecta. Esto
importa aquí porque el criterio 4 exige que el pedido sin cotizar y el pedido con
envío `0.00` cotizado sean **indistinguibles en `deliveryFee`** — y eso obliga a
fijar el formato de ese campo, no a heredarlo. Ver DA3 y **AP1**.

## Decisión

Seis decisiones, con su alternativa descartada. Las dos primeras son las que la spec
dejó abiertas a propósito y las que destraban la v6 y la `SP2` de F-032.

### DA1 — «Sin cotizar» es `Order.deliveryFee` **anulable**: `NULL` significa que el importe no existe

```prisma
model Order {
  // …
  deliveryFee Decimal? @default(0) @db.Decimal(14, 2)  // NULL = sin cotizar
}
```

`@default(0)` **se conserva**: un escritor que omita la columna sigue obteniendo el
comportamiento de hoy (envío cero, cotizado). Escribir `NULL` es explícito y solo lo
hace `createOrder.ts`.

Por qué esta forma y no la marca explícita junto al `0.00`:

1. **Aprobar la cotización cierra el estado pendiente sin una línea de código nuevo.**
   `respond.ts:78-84` ya hace `SET "deliveryFee" = "proposedDeliveryFee"`, y
   `proposedDeliveryFee` nunca es nulo cuando existe una propuesta (el schema lo exige,
   `schemas.ts:147`). Con la columna anulable, el pedido pasa de «sin importe» a
   «importe acordado» como **efecto** de lo que aprobar ya escribe. Con una marca
   aparte habría que añadir `"deliveryFeePending" = false` al CTE de aprobar, es decir
   **tocar `respond.ts`**, que la spec pone Fuera dos veces (OD3, § Alcance/Fuera) y que
   E6 describe literalmente como «el bucle de F-019 **sin código nuevo**». Una decisión
   ya cerrada por el humano no se reabre por comodidad de schema.
2. **El compilador enumera las superficies en vez de un humano.** Al volverse
   `Decimal | null`, el tipo generado rompe `pull.ts:216` y `read.ts:177`; propagando la
   nulabilidad al modelo de vista (`OrderSnapshot.deliveryFee: string | null`) rompe
   además las cinco superficies de R2 que consumen ese campo —`page.tsx:123,283,294`,
   `orderWhatsappUrl` (`read.ts:216`), `ProposalDiffInput.currentDeliveryFee`—. Con una
   marca aparte **nada** se rompe: I4 (`OrderLinesTable.tsx:32-33` esconde la fila
   cuando el envío vale cero) se quedaría exactamente como está, en silencio, y el
   pedido sin cotizar se renderizaría como un retiro en tienda. `tsc` es el único
   sensor que recorre las seis superficies gratis; renunciar a él para ahorrar dos
   expresiones es un mal cambio.
3. **R1 pide esto con sus palabras: «uno sin cotizar es ausencia de importe».** Guardar
   `0.00` en la columna que significa «el envío» cuando no hay envío es guardar un dato
   falso, y R1 prohíbe la confusión «ni en la base». La base **no tiene** ningún
   consumidor heredado que proteger: son dos lecturas y dos escrituras, todas en este
   repo y todas contadas arriba. El cable sí lo tiene, y por eso paga el `0.00` con una
   bandera al lado (R18). La asimetría es deliberada, no un descuido.
4. **El SQL de verificación del criterio 2 se lee solo**: `"deliveryFee" IS NULL` frente
   a `0.00`. No hay que interpretar una pareja de columnas.
5. **Dos columnas pueden contradecirse; una, no.** Con marca explícita nada impide la
   fila `(deliveryFeePending = true, deliveryFee = 180.00)`, y Prisma no puede declarar
   un `CHECK` que lo prohíba (habría que escribirlo en SQL crudo y pasaría a ser el
   sexto objeto no declarado que `migrate dev` propone borrar).

Coste aceptado, dicho entero: **el cable necesita un `??`**. `pull.ts` y `read.ts`
—las dos únicas funciones que leen la columna, y las dos dueñas de una
representación— emiten `money(row.deliveryFee ?? 0, currencyCode).amount`. Es una
expresión por función, y encierra el `null` en el punto exacto donde el contrato exige
que desaparezca. Riesgo residual: la lógica de tres valores de SQL (un futuro
`SUM("deliveryFee")` o `WHERE "deliveryFee" > 0` ignoraría los pendientes). Hoy
**ninguna** sentencia hace aritmética sobre esa columna —comprobado: `proposal.ts` y
`respond.ts` solo escriben, el barrido no la toca— y cuando exista un informe tendrá
que decidir a propósito qué hace con los pendientes, que es justo la pregunta que un
`0.00` esconde.

**Alternativas descartadas.** (a) Marca explícita `deliveryFeePending Boolean` junto al
`0.00`: obliga a tocar `respond.ts` (OD3), pierde la barrida del compilador y admite
filas contradictorias. (b) `deliveryFeeQuotedAt DateTime?` como marca temporal: la
polaridad queda al revés —toda fila existente saldría como pendiente— y arreglarlo
exige un `UPDATE` de backfill sobre `Order`, la tabla caliente, lo que el ciclo
prohíbe. (c) Un estado nuevo en `OrderStatus`: rompería el enum del contrato por
segunda vez en dos versiones y confundiría «en qué punto va el pedido» con «tenemos o
no el importe del envío», que son ejes independientes (un pedido `CONFIRMED` puede
seguir sin cotizar, § Casos límite).

### DA2 — El modo de envío en `Store` es un **enum**, no un `Boolean`

```prisma
/// F-031. Cómo se decide el importe del envío de esta tienda. Se lee al CREAR el
/// pedido (E14) y nunca al leerlo. La escribe cuadrecaja por el sync desde F-032.
enum DeliveryFeeMode {
  FLAT_RATE
  QUOTED_PER_ORDER
}

model Store {
  // …
  deliveryFeeMode DeliveryFeeMode @default(FLAT_RATE)
}
```

Por qué enum:

1. **Los `acceptance_criteria` de F-032 ya presuponen un vocabulario.** Su criterio 4
   exige `400` para «modo de envio **fuera del vocabulario**». Un `Boolean` no tiene
   vocabulario del que salirse: la validación se reduciría a «no es booleano», y el
   criterio quedaría cumplido por accidente del tipo. Los criterios son intocables
   (regla 3), así que el modelo se acomoda a ellos y no al revés.
2. **Crecer un enum que el POS emite es aditivo; crecer un booleano no lo es.** Aquí
   hay un principio que conviene dejar escrito porque decide las dos decisiones de este
   ciclo en direcciones opuestas: **un valor que el POS _emite_ se modela como enum
   (añadir `BY_ZONE` mañana no rompe a un POS que manda `FLAT_RATE`), y un valor que el
   POS _consume_ se modela como booleano** (crecer un enum consumido es exactamente lo
   que ya nos costó una fila de § Modos de falla cuando `status` pasó de 6 a 9 valores,
   `docs/sync-contract.md:1053`). El modo lo emite cuadrecaja; el «sin cotizar» del
   pedido lo consume. De ahí enum arriba y booleano en el cable del pedido (DA3).
3. **Convertir un booleano del cable en enum es un cambio mayor** del contrato (v8);
   añadirle un valor a un enum emitido, no. Como el otro equipo tiene que declarar el
   campo en su `Tienda` y emitirlo en su outbox, la elección de hoy le fija el coste de
   mañana. El producto ya tiene modos previsibles fuera de alcance —zonas, distancia,
   gratis sobre un importe (§ Alcance/Fuera)— y ninguno de ellos cabe en un booleano.
4. En la base cuesta lo mismo: `ADD COLUMN … NOT NULL DEFAULT 'FLAT_RATE'` no reescribe
   la tabla, y `Store` tiene decenas de filas, no millones.

**Alternativas descartadas.** (a) `deliveryQuotedOnDemand Boolean @default(false)`: más
barato hoy, contradice el criterio 4 de F-032 y cualquier modo futuro pide un cambio
mayor del contrato. (b) Derivar el modo de `deliveryFee IS NULL` en `Store` (sin
columna nueva): haría invisible la diferencia entre «no cobro envío» y «cotizo al
gestionar», y deja a `deliveryEnabled` sin forma de decir «ofrezco domicilio»; además
convierte la configuración en una inferencia, que es lo que R19 prohíbe en el pedido y
no hay razón para permitir en la tienda.

**Esto responde la `SP2` de F-032**: la forma en el cable es
`"deliveryFeeMode": "FLAT_RATE" | "QUOTED_PER_ORDER"`, opcional en el `payload` de
`STORE`, y omitirlo **no** apaga nada (la regla «omitir no es apagar» de F-032).

### DA3 — Los nombres, en la base y en el cable

| Concepto                               | En la base                                                       | En el cable                                                      |
| -------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Modo de envío de la tienda             | `Store.deliveryFeeMode` (`DeliveryFeeMode`, default `FLAT_RATE`) | `deliveryFeeMode` en el `payload` de `STORE` (v7, F-032)         |
| El importe del envío del pedido        | `Order.deliveryFee` `Decimal?` — `NULL` = sin cotizar            | `deliveryFee`, string decimal **de dos decimales, siempre**      |
| «Este pedido no tiene importe todavía» | ausencia (`NULL`) en la columna de arriba                        | `deliveryFeePending: boolean` — **campo nuevo de la v6**         |
| El error al despachar sin cotizar      | —                                                                | `409 {"error":"ORDER_DELIVERY_NOT_QUOTED"}` (fijado por la spec) |
| El motivo del vencimiento propio       | `Order.cancelReason`, literal de `src/constants/orders.ts`       | `cancelReason`, literal                                          |

Tres notas sobre por qué estos y no otros:

- **`deliveryFeeMode`** y no `deliveryMode`: el modo no decide **si** hay envío —eso es
  `deliveryEnabled`— sino cómo se decide su **importe**. Queda junto a `deliveryFee` en
  el schema y se lee sin ambigüedad al lado de `checkoutMode`.
- **`QUOTED_PER_ORDER`** y no `QUOTED_AT_FULFILLMENT`: en este código `fulfillment`
  significa ya `PICKUP | DELIVERY` (`src/features/orders/types.ts:106`), y reusar la
  palabra para «al gestionar» produce exactamente la confusión que R5 evita (el modo es
  de la tienda, no de la modalidad). «Por pedido» dice el hecho: el importe se decide
  una vez por pedido en vez de una vez por tienda.
- **`deliveryFeePending`** en el cable y no `deliveryQuote: "PENDING" | "QUOTED"`: es un
  valor que el POS **consume**, y un enum consumido puede crecer y romper un `switch`
  exhaustivo (§ Modos de falla ya tiene esa fila). Un booleano no puede crecer, y el
  campo no tiene un tercer estado posible: R3 cierra el espacio («no es 0, no es un
  estimado, no es un rango»).
- **El formato de `deliveryFee` en el cable se fija aquí**: `money(…).amount`, es decir
  **siempre dos decimales**. No es un capricho: el criterio 4 exige que el pedido sin
  cotizar y el pedido con envío `0.00` cotizado traigan el **mismo** `deliveryFee`, para
  que la distinción sea imposible por heurística y obligatoria por campo. Hoy un cero
  cotizado sale como `"0"` (§ Estado actual), así que el pendiente tiene que salir
  igual… o los dos tienen que salir normalizados. Se elige normalizar **este campo**
  porque tres artefactos independientes ya lo dan por hecho: R18 («vale `"0.00"`»), el
  ejemplo publicado de la v5.1 (`:621`) y los fixtures de `pull.test.ts:38,102`. Los
  demás importes del payload **no se tocan en este feature** (criterio 9 fija la
  no-regresión del camino de tarifa fija) y por eso siguen saliendo sin ceros de
  relleno: eso es AP1, y bloquea la redacción de la v6.

### DA4 — El barrido nuevo vive en `expiry.ts`, como **segundo export**, y entra en el mismo `$transaction([…])` del pull

```ts
// src/features/orders/server/expiry.ts — junto a expireProposalsQuery
export function expireUnquotedDeliveryOrdersQuery(businessId?: string) {
  const scope = businessId ? Prisma.sql`AND o."businessId" = ${businessId}` : Prisma.empty;
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "Order" o
       SET status        = 'CANCELLED'::"OrderStatus",
           "cancelledBy" = 'EXPIRY'::"OrderCancelledBy",
           "cancelReason" = ${ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON},
           "updatedAt"   = now()
      FROM "Store" s
     WHERE o."storeId" = s.id
       AND o."deliveryFee" IS NULL
       AND o.status IN ('PENDING', 'PULLED', 'CONFIRMED')
       AND o."createdAt" < now() - make_interval(hours => s."orderExpiryHours")
       ${scope}
  `);
}
```

```ts
// src/features/orders/server/pull.ts:104-106 pasa de dos elementos a tres
const [, , rows] = await prisma.$transaction([
  expireProposalsQuery(businessId),
  expireUnquotedDeliveryOrdersQuery(businessId),
  prisma.order.findMany({ … }),
]);
```

Por qué el mismo archivo y no un módulo propio: los dos barridos comparten **cuatro
invariantes** que solo se pueden auditar leyéndolos juntos —una sola sentencia, sin
`$transaction` interactivo (R16, el pooler corre en modo transacción), devolver la
`PrismaPromise` sin `await` para que el llamador la meta en la forma de array, e
idempotencia por construcción— y sobre todo porque **R15 se demuestra comparando sus
dos `WHERE`**: el de F-019 escribe solo sobre `AWAITING_CUSTOMER`, el nuevo lo excluye
por **lista blanca** (`IN ('PENDING','PULLED','CONFIRMED')`), no por un `!=`. Con lista
blanca, un estado que se añada mañana al enum no se cuela en el barrido por descuido.
Separarlos en dos módulos esconde justo la adyacencia que hace verificable «los dos
relojes no se pisan». El archivo pasa de 37 a ~90 líneas y su test de base ya existe,
`src/features/orders/server/expiry.db.test.ts`, que es además el que nombra el
criterio 7(b).

Por qué en el mismo `$transaction` que el `findMany` y **antes** de él: por lo mismo que
DA5 de F-019 (`.agent/specs/F-019/architecture.md:294-340`) —un round-trip, y el
`findMany` ve su propia escritura, así que el POS recibe `CANCELLED`/`EXPIRY` en la
**primera** entrega en vez de un pedido que acabamos de cancelar—. Los dos barridos
escriben sobre conjuntos **disjuntos por `status`**, así que compartir transacción no
crea ni orden significativo entre ellos ni riesgo de que uno pise el `cancelReason` del
otro: un pedido que el primero deja `CANCELLED` ya no está en la lista blanca del
segundo.

Qué columnas toca y qué **no**: `status`, `cancelledBy`, `cancelReason`, `updatedAt`.
**No** toca `proposalOutcome` ni `proposalDecidedAt` —a diferencia del barrido de
F-019—, porque un pedido que este barrido alcanza nunca tuvo propuesta viva ni
resuelta: aprobar deja `deliveryFee` no nulo (sale del barrido), y rechazar o vencer
una propuesta deja `CANCELLED` (sale de la lista blanca).

Idempotencia por construcción (R16), en una frase: `status` está en la condición y el
propio barrido saca de la lista blanca a las filas que toca, así que **una segunda
pasada afecta 0 filas** porque no queda nada que cumpla el `WHERE`, no porque alguien
lleve la cuenta.

El cron `src/app/api/crons/expire-proposals/route.ts` corre **los dos** sin
`businessId`, en un `prisma.$transaction([…])` de dos elementos (un round-trip en vez
de dos) y responde `{ "expired": n, "expiredUnquotedDelivery": m }` — la clave que ya
existía **no cambia de significado**. Ni `vercel.json` ni el horario se tocan: es el
mismo cron diario, con una red de seguridad más.

**Alternativas descartadas.** (a) Módulo propio `expiryUnquoted.ts`: nada que ganar y
las dos condiciones dejan de leerse juntas. (b) Barrido solo en el cron: un pedido
cancelado por reloj tardaría hasta 24 h en aparecerle al POS, cuando el pull puede
entregarlo al instante y gratis. (c) Un `$transaction` interactivo para leer las horas
de cada tienda y luego actualizar: prohibido de hecho por el pooler y además innecesario
—`make_interval(hours => s."orderExpiryHours")` con el `now()` de la base es el mismo
patrón que `proposal.ts:70` ya usa, y evita comparar relojes de dos procesos—.

### DA5 — El `409` se implementa escribiendo con guarda y **clasificando los cero filas**, no leyendo antes

`setOrderStatus` (`src/features/orders/server/status.ts`) pasa a devolver tres
desenlaces y mantiene el orden que exige R17 —primero el aislamiento por negocio,
después la guarda de cotización—:

```ts
export type SetOrderStatusResult =
  | { kind: "ok" }
  | { kind: "unknown_order" } // 404: no existe o es de otro negocio
  | { kind: "delivery_not_quoted" }; // 409: ORDER_DELIVERY_NOT_QUOTED
```

El `updateMany` sigue siendo uno, con la guarda añadida **solo** para los tres estados
de despacho (`ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY`, constante nueva):
`where: { id, businessId, ...(requiresQuote ? { deliveryFee: { not: null } } : {}) }`.
Con `count === 0` se hace **una** lectura clasificadora —el mismo patrón que
`classifyZeroRows` en `proposal.ts:130-152`— que comprueba `businessId` **antes** que
la cotización: un pedido de otro negocio da `404 UNKNOWN_ORDER` sin llegar a mirar el
envío, así que el `409` nunca puede confirmar la existencia de un pedido ajeno (R17).
Si la fila existe, es del negocio y el envío está cotizado, la escritura perdió una
carrera contra otro escritor: se registra con `console.error` y se devuelve el 404 que
esa misma situación devuelve hoy, sin inventar un desenlace nuevo.

`CONFIRMED`, `CANCELLED` y `REJECTED_BY_STORE` **no** llevan guarda (E10, § Casos
límite): aceptar el pedido y cotizar después es el flujo normal, y cancelar no cobra
nada.

**Alternativa descartada.** Leer y después escribir: dos round-trips en el camino
feliz y una ventana TOCTOU entre la lectura y la escritura que hoy no existe.

### DA6 — La regla «cuándo se ofrece domicilio» se centraliza en un módulo puro

R20 convierte una condición de dos términos en una de tres, y hoy está escrita **dos
veces**: `createOrder.ts:174` y `CheckoutForm.tsx:420`. Escribirla dos veces más es
cómo nacieron I3 e I4. Se extrae a src/features/orders/deliveryOffer.ts (etapa 2, por
crear), módulo **puro** de la capa `features/*/` —sin Prisma, sin React, sin Zod, así
que la isla de cliente puede importarlo y pesa unos cientos de bytes—:

```ts
export type DeliveryFeeModeName = "FLAT_RATE" | "QUOTED_PER_ORDER";

export type DeliveryConfig = {
  deliveryEnabled: boolean;
  deliveryFeeMode: DeliveryFeeModeName;
  /** Tarifa fija de la tienda. `null` = no hay tarifa guardada. */
  deliveryFee: string | null;
};

/** R20: domicilio con qué cerrarlo — tarifa fija con importe, o cotizado. */
export function isDeliveryOffered(config: DeliveryConfig): boolean;

/** `null` = sin cotizar (no hay importe). El string ya viene normalizado. */
export function deliveryFeeForNewOrder(
  config: DeliveryConfig,
  fulfillment: "PICKUP" | "DELIVERY",
): string | null;
```

`deliveryFeeForNewOrder` es también donde vive la decisión de § Casos límite «manda el
modo»: en `QUOTED_PER_ORDER` devuelve `null` para `DELIVERY` **ignorando** cualquier
`deliveryFee` residual de la fila de la tienda, y `"0.00"` para `PICKUP` (E8: lo
incierto es el envío, no el pedido). Un solo sitio decide, y el checkout y la creación
no pueden divergir — que es la misma razón por la que `quoteCart` es el único que
decide un precio.

Nota honesta: `scripts/place-order.mjs:192` tiene una tercera copia de la regla en JS.
El criterio 9 prohíbe tocar ese guion y no hace falta: solo ejercita tiendas de tarifa
fija, donde su copia sigue siendo correcta. El caso cotizado lo cubre el guion nuevo,
scripts/quote-delivery-order.mjs (por crear).

## Componentes

| Componente                                     | Capa                      | Responsabilidad                                                                              | Archivo                                                   |
| ---------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `DeliveryFeeMode` + `Store.deliveryFeeMode`    | datos                     | El modo por tienda (DA2). Se lee al crear; se escribirá desde el sync en F-032               | `prisma/schema.prisma`                                    |
| `Order.deliveryFee` anulable                   | datos                     | `NULL` = sin cotizar (DA1)                                                                   | `prisma/schema.prisma`                                    |
| `isDeliveryOffered` / `deliveryFeeForNewOrder` | `features/orders/` (puro) | R20 y «manda el modo», en un solo sitio (DA6)                                                | src/features/orders/deliveryOffer.ts (etapa 2, por crear) |
| `loadStoreForOrder` (ampliado)                 | `features/orders/server/` | Trae `deliveryFeeMode` en el mismo `select`                                                  | `src/features/orders/server/quote.ts`                     |
| `toQuoteResponse` (ampliado)                   | `features/orders/server/` | El modo viaja **explícito** al checkout (R20)                                                | `src/features/orders/server/quote.ts`                     |
| `createOrder` (ampliado)                       | `features/orders/server/` | Escribe `deliveryFee = null` y el total parcial (E2, R7, R9)                                 | `src/features/orders/server/createOrder.ts`               |
| `getOrderByCode` (ampliado)                    | `features/orders/server/` | `OrderSnapshot.deliveryFee: string \| null` — la ausencia llega al modelo de vista           | `src/features/orders/server/read.ts`                      |
| `pullOrders` (ampliado)                        | `features/orders/server/` | `deliveryFee` normalizado + `deliveryFeePending` (R18); tercer elemento en el `$transaction` | `src/features/orders/server/pull.ts`                      |
| `expireUnquotedDeliveryOrdersQuery`            | `features/orders/server/` | El reloj del pedido sin cotizar (R15, R16, DA4)                                              | `src/features/orders/server/expiry.ts`                    |
| `setOrderStatus` (ampliado)                    | `features/orders/server/` | La primera guarda de transición del contrato (DA5)                                           | `src/features/orders/server/status.ts`                    |
| `POST /api/internal/orders/status`             | `app/`                    | Traduce `delivery_not_quoted` a `409` con su cuerpo                                          | `src/app/api/internal/orders/status/route.ts`             |
| `GET /api/crons/expire-proposals`              | `app/`                    | Corre los **dos** barridos sin `businessId`                                                  | `src/app/api/crons/expire-proposals/route.ts`             |
| `OrderSummary` (ampliado)                      | `features/cart/`          | Fila de envío sin cifra y total nombrado parcial (R2)                                        | `src/features/cart/components/OrderSummary.tsx`           |
| `CheckoutForm` (ampliado)                      | `features/cart/`          | Radio sin importe, `expectedTotal` parcial (E1, R7)                                          | `src/features/cart/components/CheckoutForm.tsx`           |
| `OrderLinesTable` (ampliado)                   | `features/orders/`        | La fila de envío ya no se esconde por valer cero (I4)                                        | `src/features/orders/components/OrderLinesTable.tsx`      |
| `buildProposalDiff` (ampliado)                 | `features/orders/`        | Deja de afirmar «antes sin costo» sobre un envío que no existía (I3)                         | `src/features/orders/proposalDiff.ts`                     |
| `OrderProposalCard` (ampliado)                 | `features/orders/`        | «Total actual» pasa a nombrarse parcial cuando lo es (I3)                                    | `src/features/orders/components/OrderProposalCard.tsx`    |
| `buildWhatsappUrl` (ampliado)                  | `features/orders/`        | Ni la línea de envío ni el total imprimen `0,00` (E13, criterio 10)                          | `src/features/orders/whatsapp.ts`                         |
| Constantes nuevas                              | `constants/`              | El literal del vencimiento y la lista de estados con guarda                                  | `src/constants/orders.ts`                                 |

Ningún componente de UI nuevo: las seis superficies de R2 son ampliaciones de
componentes que ya existen, y la copia exacta la cierra `sdd-designer`.

## Flujo de datos

1. **Checkout.** `POST /api/orders/quote` → `quoteBySlug` → `toQuoteResponse` devuelve
   `store.deliveryFeeMode` junto a `deliveryEnabled`/`deliveryFee`. La isla llama a
   `isDeliveryOffered` y, en `QUOTED_PER_ORDER`, ofrece el radio de domicilio **sin
   importe**, pinta la fila de envío como pendiente y nombra el total como parcial. La
   dirección sigue siendo obligatoria (`schemas.ts:104-111`, sin cambios).
2. **`expectedTotal`.** La isla calcula `subtotal − discountTotal` (sin sumar envío)
   usando el mismo `deliveryFeeForNewOrder`; `createOrder` calcula lo mismo del lado
   servidor y compara. La comprobación de precio **no** se relaja (R7, I10a).
3. **Creación.** `createOrder` escribe `deliveryFee: null` cuando el modo es cotizado y
   la modalidad es `DELIVERY`; `total = subtotal − discountTotal`. `rateSnapshot` se
   congela como siempre (R10).
4. **Página del pedido.** `getOrderByCode` devuelve `deliveryFee: null`; la página y sus
   tres `OrderLinesTable` reciben la ausencia y muestran el envío por confirmar y el
   total parcial. El `wa.me` se construye del snapshot persistido, así que dice lo
   mismo (E13).
5. **Pull.** El barrido de F-019, el barrido nuevo y el `findMany` viajan en un solo
   `$transaction([…])`. Cada pedido sale con `deliveryFee` de dos decimales y
   `deliveryFeePending`.
6. **Cotizar = proponer.** El POS manda `POST /api/internal/orders/proposal` con
   `deliveryFee` concreto y **las mismas líneas** que acaba de recibir (R13). Nada
   cambia en ese endpoint. El pedido queda `AWAITING_CUSTOMER` y sigue con
   `deliveryFeePending: true`: aún no hay importe acordado, y por eso el `409` de
   despacho sigue vigente hasta que el comprador aprueba.
7. **Aprobar.** `respond.ts` copia `proposedDeliveryFee` a `deliveryFee` → deja de ser
   `NULL` → `deliveryFeePending: false` y `total` completo, sin una línea nueva (DA1).
8. **Nadie cotiza.** El barrido de DA4 lo deja `CANCELLED`/`EXPIRY` con su motivo propio.
9. **Despachar sin cotizar.** `409 ORDER_DELIVERY_NOT_QUOTED`, sin escribir nada (DA5).

## Contrato en el cable

**Este bloque es lo que el orquestador traduce a la v6 sin volver a preguntar.** Todo
lo de aquí es aditivo en el sentido del criterio 11: un consumidor de la v5 que hace
`parseFloat(order.deliveryFee)` sigue leyendo un número y no ve ninguna clave menos.

### `GET /api/internal/orders` — pedido **sin cotizar** (nuevo en la v6)

```jsonc
{
  "id": "43",
  "code": "B8N4P2QRS5",
  "storeExternalId": "uuid",
  "status": "PULLED",
  "contact": {
    "name": "Ana Pérez",
    "phone": "+5355555555",
    "email": null,
    "address": "Calle 23 esq. L, Vedado",
  },
  "currencyCode": "CUP",
  "subtotal": "880", // ver la nota de formato más abajo
  "discountTotal": "0",
  "deliveryFee": "0.00", // presente SIEMPRE. NO significa "envío gratis"
  "deliveryFeePending": true, // NUEVO en v6: el importe del envío no existe todavía
  "total": "880", // PARCIAL: subtotal - discountTotal, sin envío
  "notes": null,
  "createdAt": "2026-09-01T14:00:00.000Z",
  "rateSnapshot": { "base": "CUP", "capturedAt": "2026-09-01T14:00:00.000Z", "rates": {} },
  "cancelledBy": null,
  "customerWhatsappUrl": "https://wa.me/5355555555?text=...",
  "proposal": null,
  "items": [
    {
      "storeProductExternalId": "uuid",
      "name": "Café Cubita 500 g",
      "unitPrice": "440.00",
      "currencyCode": "CUP",
      "quantity": "2.000",
      "lineTotal": "880.00",
      "originalUnitPrice": "440.00",
      "originalCurrencyCode": "CUP",
      "originalLineTotal": "880.00",
    },
  ],
}
```

### `GET /api/internal/orders` — pedido con envío `0.00` **cotizado** (la tienda lo regaló)

```jsonc
{
  "id": "44",
  "code": "C9Q5R3STU6",
  "storeExternalId": "uuid",
  "status": "CONFIRMED",
  "contact": {
    "name": "Luis Mena",
    "phone": "+5355555556",
    "email": null,
    "address": "Ave. 31 e/ 42 y 44, Playa",
  },
  "currencyCode": "CUP",
  "subtotal": "880",
  "discountTotal": "0",
  "deliveryFee": "0.00", // el MISMO string que el pedido de arriba, a propósito
  "deliveryFeePending": false, // NUEVO en v6: aquí el cero es un importe acordado
  "total": "880", // COMPLETO: subtotal - discountTotal + deliveryFee
  "notes": null,
  "createdAt": "2026-09-01T14:05:00.000Z",
  "rateSnapshot": { "base": "CUP", "capturedAt": "2026-09-01T14:05:00.000Z", "rates": {} },
  "cancelledBy": null,
  "customerWhatsappUrl": "https://wa.me/5355555556?text=...",
  "proposal": null,
  "items": [
    {
      "storeProductExternalId": "uuid",
      "name": "Café Cubita 500 g",
      "unitPrice": "440.00",
      "currencyCode": "CUP",
      "quantity": "2.000",
      "lineTotal": "880.00",
      "originalUnitPrice": "440.00",
      "originalCurrencyCode": "CUP",
      "originalLineTotal": "880.00",
    },
  ],
}
```

**Los dos pedidos caben en la misma respuesta y `deliveryFee` es idéntico en ambos**
(criterio 4). La única forma de distinguirlos es `deliveryFeePending`. Cualquier
heurística —mirar `contact.address`, comparar `total` con `subtotal`, tratar el `0.00`
como gratis— acierta hoy y falla con el primer envío regalado (R19, I6).

**Nota de formato, obligatoria en la v6.** `deliveryFee` se emite siempre con dos
decimales. Los demás importes (`subtotal`, `discountTotal`, `total`, y los de cada
línea que salen de la misma conversión) se emiten con `Decimal.toString()`, que
**suprime los ceros de relleno**: 880,00 sale como `"880"` y cero como `"0"`. El
ejemplo de la v5.1 los muestra con dos decimales y eso nunca fue cierto. La v6 tiene
que decirlo y añadir la regla operativa: **compara los importes como números, nunca
como cadenas.** Si el humano responde AP1(b), los ejemplos de arriba pasan a llevar
`"880.00"` y `"0.00"` en todos los campos y esta nota se sustituye por «todos los
importes traen dos decimales».

### `total`, en una frase por caso

- `deliveryFeePending: true` → `total = subtotal − discountTotal`. Es **parcial** y va a
  crecer cuando la tienda cotice y el comprador apruebe. La igualdad
  `total = subtotal − discountTotal + deliveryFee` **no** se sostiene aquí, porque el
  `deliveryFee` del payload es un relleno, no un importe.
- `deliveryFeePending: false` → `total = subtotal − discountTotal + deliveryFee`, igual
  que en la v5. Vuelve a cerrar en cuanto hay cotización (R9).
- No hay un campo `totalIsPartial`: `deliveryFeePending` **es** esa afirmación. Dos
  banderas para un hecho es cómo nacen las contradicciones.

### `POST /api/internal/orders/status` — la primera guarda de transición del contrato

```jsonc
// Cuerpo — sin cambios respecto a la v5
{ "orderId": "43", "status": "READY", "reason": null }
```

```jsonc
// 409 — NUEVO en v6. No escribe nada.
{ "error": "ORDER_DELIVERY_NOT_QUOTED" }
```

- Se devuelve **solo** cuando el destino es `READY`, `IN_TRANSIT` o `DELIVERED` y el
  pedido sigue con `deliveryFeePending: true`.
- `CONFIRMED`, `CANCELLED` y `REJECTED_BY_STORE` **se siguen aceptando** con el envío
  pendiente: aceptar el pedido y cotizar después es el flujo normal, y cerrar no cobra.
- Un `orderId` de otro negocio sigue respondiendo `404 UNKNOWN_ORDER`, **antes** de
  mirar el envío (R17). El `409` nunca confirma la existencia de un pedido ajeno.
- `AWAITING_CUSTOMER` sigue fuera del enum de este endpoint (`400 INVALID_BODY`), sin
  cambios.
- **La v6 tiene que retractar `docs/sync-contract.md:789-791`** —«Sin guardas de
  transición: el POS es la autoridad y puede reportar cualquiera de los seis valores»—
  con el mismo estilo con que la v5 retractó la línea de los cuatro estados (I5).

### Cotizar: el endpoint que ya existe

`POST /api/internal/orders/proposal`, sin campos nuevos y sin cambios de schema.
`deliveryFee` ya viaja ahí. Lo que la v6 añade es la nota de OD3, explícita: `items`
es obligatorio con **al menos una línea**, así que para cotizar **solo** el envío se
reenvían **las mismas líneas que el pull acaba de entregar**; una propuesta sin líneas
responde `400 INVALID_BODY`. Aprobar borra e inserta líneas idénticas y `rateSnapshot`
no se recalcula (R10).

Mientras el pedido está en `AWAITING_CUSTOMER` con una propuesta viva,
`deliveryFeePending` **sigue en `true`**: hay un importe _propuesto_
(`proposal.deliveryFee`), no un importe _acordado_. Pasa a `false` cuando el comprador
aprueba. Consecuencia práctica que la v6 debe decir: el `409` de despacho sigue
aplicando durante la espera.

### El vencimiento del pedido sin cotizar

- `Store.orderExpiryHours` gana un **segundo significado**: además de cuánto dura una
  propuesta, es cuántas horas vive un pedido cuyo envío nadie cotizó, contadas **desde
  su creación** (SP1). Los dos plazos son independientes y **se suman**: un pedido
  cotizado en el último minuto puede llegar a vivir ~2 × `orderExpiryHours` (R15).
- El campo **sigue siendo de queandabuscando** en la v6 (`:766-768` no cambia de dueño;
  eso es F-032 y su v7).
- Desenlace: `status: "CANCELLED"`, `cancelledBy: "EXPIRY"` y un `cancelReason`
  **propio**, distinto del literal de la propuesta vencida. Literal propuesto:
  `"El pedido venció sin que la tienda cotizara el envío"`. La v6 lo documenta como
  literal, igual que ya documenta el otro (`:708-709` deja de ser el único) — ver AP2.
- Alcanza a `PENDING`, `PULLED` y `CONFIRMED`. **Nunca** a `AWAITING_CUSTOMER`, que
  tiene su propio reloj.

### El aviso de la v7 (OD1) y la nota de traspaso (OD4)

La v6 anuncia que la v7 traerá las **cinco** columnas de configuración de compra en el
`payload` de `STORE` —`checkoutMode`, `deliveryEnabled`, `deliveryFee`,
`orderExpiryHours` y el modo de envío— y que con ellas `orderExpiryHours` cambia de
dueño. La forma del quinto campo queda fijada aquí para que F-032 no tenga que volver:

```jsonc
// payload de STORE, v7 (F-032) — se anuncia en la v6, no se implementa aquí
{
  "deliveryFeeMode": "QUOTED_PER_ORDER", // "FLAT_RATE" | "QUOTED_PER_ORDER"; opcional
}
```

Omitirlo deja la columna como estaba («omitir no es apagar»); un valor fuera de esas
dos etiquetas es `400` (criterio 4 de F-032). Y § «Cambios requeridos en cuadrecaja»
enlaza docs/traspaso-cuadrecaja-envio-cotizado.md (por crear) con las tres cosas que el
otro equipo implementa: leer el envío sin cotizar, manejar el `409` al despachar, y
cotizar por el endpoint de propuesta reenviando las líneas.

### § Modos de falla — dos filas nuevas

| Falla                                                            | Qué le pasa al usuario                                                                                                     | Recuperación                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Un POS ignora el `409` y no cotiza                               | Sus pedidos a domicilio se quedan atascados sin error visible en su lado, y a las `orderExpiryHours` **se cancelan solos** | Cotizar por `POST /orders/proposal`; el `409` desaparece al aprobar el comprador        |
| Un POS lee el `0.00` de un envío sin cotizar como «envío gratis» | Cobra de menos y entrega un pedido cuyo total nunca se cerró                                                               | Leer `deliveryFeePending` antes que `deliveryFee`; es la trampa central de esta versión |

## Contratos internos

### Tipos de hilo (`src/features/orders/types.ts`)

```ts
export type QuoteStore = {
  // …lo de hoy
  deliveryFee: string | null;
  /** F-031 R20: el modo viaja EXPLÍCITO; la isla no deduce nada de deliveryFee. */
  deliveryFeeMode: "FLAT_RATE" | "QUOTED_PER_ORDER";
};
```

### Modelo de vista del pedido (`src/features/orders/server/read.ts`)

```ts
export type OrderSnapshot = {
  // …lo de hoy
  /** F-031 DA1: `null` = sin cotizar. Nunca se sustituye por "0.00" aquí. */
  deliveryFee: string | null;
};
```

Y los cuatro consumidores dejan de aceptar un `string` a secas, para que `tsc` los
enumere: `OrderLinesTable` (`deliveryFee: string | null`), `WhatsappOrderInput`
(`deliveryFee: Money | null`), `ProposalDiffInput` (`currentDeliveryFee: string | null`)
y `OrderProposalCard`, que gana una prop **requerida** `previousTotalPartial: boolean`
—requerida a propósito: es lo que fuerza el error de compilación en su única llamada
(`src/app/[slug]/pedido/[code]/page.tsx`) y evita que siga llamando «Total actual» a un
total parcial (I3)—.

`OrderSummary` gana dos props **opcionales** (`totalCaption`, y la reutilización de
`note`) para no romper a `CartView`, que comparte el componente; la copia es de
`sdd-designer`. Ahí la exhaustividad no la da el tipo sino el criterio 1, que lee el
DOM renderizado.

**Nada de esto es Zod**: `types.ts` lo importan islas de cliente y AGENTS.md prohíbe
Zod en el árbol de cliente. `schemas.ts` sigue comprobándose contra estos tipos con
`satisfies`.

### Tabla de errores

| Código | Cuerpo                                    | Cuándo                                                                                        |
| ------ | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `409`  | `{"error":"ORDER_DELIVERY_NOT_QUOTED"}`   | `POST /orders/status` a `READY`/`IN_TRANSIT`/`DELIVERED` con el envío sin cotizar. No escribe |
| `404`  | `{"error":"UNKNOWN_ORDER"}`               | Sin cambios, y **antes** que el `409` (R17)                                                   |
| `400`  | `{"error":"INVALID_BODY","issues":[...]}` | Sin cambios. Sigue cubriendo `AWAITING_CUSTOMER` en este endpoint                             |

El nombre `ORDER_DELIVERY_NOT_QUOTED` se mantiene tal cual: no colisiona con nada
(`grep -rn "ORDER_DELIVERY_NOT_QUOTED" src/ docs/` no devuelve nada hoy).

### Constantes nuevas (`src/constants/orders.ts`)

```ts
/** F-031 R15/I7: motivo propio, distinto de ORDER_EXPIRED_PROPOSAL_REASON.
 *  Literal: la v6 lo documenta y el criterio 7 lo greppea. */
export const ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON =
  "El pedido venció sin que la tienda cotizara el envío";

/** F-031 E10: los tres destinos que exigen el envío ya cotizado. */
export const ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY = [
  "READY",
  "IN_TRANSIT",
  "DELIVERED",
] as const;
```

Sin magic strings sueltos (AGENTS.md § Prohibiciones). Las etiquetas de estado dentro
del SQL crudo del barrido se quedan inline, igual que en `expiry.ts:31` hoy.

## Modelo de datos y migraciones

### El diff del schema, entero

```prisma
enum DeliveryFeeMode {
  FLAT_RATE
  QUOTED_PER_ORDER
}

model Store {
  deliveryFeeMode DeliveryFeeMode @default(FLAT_RATE)
}

model Order {
  deliveryFee Decimal? @default(0) @db.Decimal(14, 2)
}
```

Nada más: ni tablas nuevas, ni columnas en `Order` además del cambio de nulabilidad, ni
campos nuevos en el endpoint de propuesta.

### La migración

Un solo archivo, prisma/migrations/&lt;timestamp&gt;\_quoted_delivery_fee/migration.sql
(etapa 1, por crear), generado con `npm run db:migrate` y **revisado antes de
aplicarlo**. El SQL que tiene que quedar, exactamente:

```sql
-- CreateEnum
CREATE TYPE "DeliveryFeeMode" AS ENUM ('FLAT_RATE', 'QUOTED_PER_ORDER');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "deliveryFeeMode" "DeliveryFeeMode" NOT NULL DEFAULT 'FLAT_RATE';

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "deliveryFee" DROP NOT NULL;
```

Cuatro cosas que hay que comprobar en el archivo generado:

1. **Quitar los cinco `DROP INDEX`.** `CanonicalProduct_searchVector_idx`,
   `CanonicalProduct_name_trgm_idx`, `StoreProduct_visible_catalog_idx`,
   `StoreProduct_searchVector_idx` y `StoreProduct_searchDocument_trgm_idx` no se
   representan en `prisma/schema.prisma`, así que Prisma los propone borrar **en
   cualquier diff**. Aplicarlo sin mirar no rompe ningún test y deja la búsqueda
   haciendo scans secuenciales en producción (AGENTS.md § «Cosas que muerden», ficha
   `.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`).
2. **Que no aparezca ningún `UPDATE` ni `ALTER TABLE … USING`.** No hay backfill: toda
   fila existente de `Order` conserva su `0.00` **no nulo** y por tanto se lee como
   cotizada (R6, E14), y toda tienda existente queda en `FLAT_RATE`, que es el
   comportamiento de hoy bit a bit.
3. **Que el `DEFAULT 0` de `Order.deliveryFee` siga ahí.** Solo cae el `NOT NULL`. Si
   Prisma propone `DROP DEFAULT`, se quita esa línea: el default es la red que deja a
   cualquier escritor distraído en el comportamiento viejo en vez de marcar un pedido
   como pendiente sin querer.
4. **Ninguna de las dos sentencias reescribe `Order`.** `DROP NOT NULL` es un cambio de
   catálogo, y `ADD COLUMN … NOT NULL DEFAULT` no reescribe la tabla desde Postgres 11
   —además `Store` tiene decenas de filas—. `Order` es de las calientes y no se toca
   fila por fila.

Sobre la trampa de los enums que F-019 dejó anotada: aquí **no** aplica. La restricción
de Postgres es para una etiqueta añadida con `ALTER TYPE … ADD VALUE` y usada en la
misma transacción; `CREATE TYPE` seguido de un `DEFAULT` que usa una de sus etiquetas
es legal y es lo que ya hace `prisma/migrations/20260825000000_init/migration.sql` con
`OrderStatus`. Un solo archivo basta.

### Índices: **ninguno nuevo**, con el umbral escrito

Las dos consultas nuevas son:

- barrido del pull → `WHERE o."businessId" = … AND o.status IN ('PENDING','PULLED','CONFIRMED') AND o."deliveryFee" IS NULL AND o."createdAt" < …`,
  que entra por el prefijo `(businessId, status)` del índice existente
  `Order(businessId, status, id)`;
- barrido del cron → lo mismo sin `businessId`, por el prefijo `(status)` de
  `Order(status, id)`.

La diferencia con F-019 hay que decirla, porque invierte su argumento: `AWAITING_CUSTOMER`
era un estado **transitorio** y su conjunto no crece; `PENDING`/`PULLED`/`CONFIRMED`
**sí se acumulan** —un pedido que el POS nunca reporta se queda ahí para siempre—. El
predicado `IS NULL` no lo cubre ningún índice actual, así que el barrido filtra en
memoria sobre el conjunto de pedidos abiertos.

Con los números de F-019 (5.000 pedidos/día en la plataforma a 100×) y suponiendo que un
5 % se queda abierto para siempre, el conjunto crece del orden de **90.000 filas al
año**. El cron diario recorre ese conjunto una vez: centenares de milisegundos, una vez
cada 24 h. El barrido del pull recorre solo el subconjunto del negocio que llama —del
orden de **cientos a pocos miles** de filas— dentro del mismo round-trip que ya paga el
`findMany` de hasta 500 pedidos con sus líneas, que sigue siendo el coste dominante.

**Umbral para reabrirlo**: si el conjunto de pedidos abiertos de la plataforma pasa de
~1 M de filas, o si el cron tarda más de ~1 s, se añade `@@index([status, createdAt])`
—declarado en el schema, no en SQL crudo, para que Prisma lo vea y para no crear un
sexto índice invisible como los cinco de la ficha—. La tentación de un índice **parcial**
sobre `WHERE "deliveryFee" IS NULL` se descarta por eso mismo: Prisma no puede
declararlo y volvería a proponer borrarlo en cada diff.

## Escalabilidad y límites

- **Round-trips por petición**: el pull sigue siendo **uno** para el lote
  `[barrido F-019, barrido nuevo, findMany]` más el `updateMany` de `PENDING → PULLED`
  que ya existía. El checkout no gana ninguno: el modo viaja en el `select` que
  `loadStoreForOrder` ya hacía. El `409` cuesta **una** lectura extra **solo** en el
  camino de error.
- **Tamaño del payload del pull**: `"deliveryFeePending":false,` son ~27 bytes por
  pedido; en la página máxima de 500 pedidos, ~13 KB sobre un payload que ya carga
  líneas y `rateSnapshot`. Menos del 3 %.
- **JavaScript de cliente**: el único añadido es src/features/orders/deliveryOffer.ts
  (etapa 2, por crear), puro y de unos cientos de bytes, más un par de etiquetas. No se
  toca `BUDGET_KB` de `scripts/check-bundle-budget.mjs`; si `check:bundle` se queja, se
  mide antes de subir nada (AGENTS.md § «El presupuesto de JavaScript no es un muro»).
- **Caché e ISR**: nada que invalidar. `/[slug]/pedido/[code]` no se cachea (R17 de
  F-019) y el checkout es una isla que pide su cotización fresca. `src/proxy.ts` no se
  toca, así que la estrategia ISR de `/[slug]` sigue intacta.
- **Qué se rompe primero al multiplicar por 100**: el barrido del cron, por el conjunto
  de pedidos abiertos que crece linealmente (umbral y arreglo arriba). Después, y ya
  fuera de este feature, el `findMany` de 500 pedidos con sus líneas.

## Impacto archivo por archivo

**Se modifican** (existen hoy):

| Archivo                                                | Qué cambia                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                 | `enum DeliveryFeeMode`; `Store.deliveryFeeMode`; `Order.deliveryFee` pasa a `Decimal?`. Comentarios `///` de cada uno |
| `src/features/orders/types.ts`                         | `QuoteStore.deliveryFeeMode`; `PulledOrder` gana `deliveryFeePending` vía `pull.ts`                                   |
| `src/features/orders/server/quote.ts`                  | `select` + `OrderStore.deliveryFeeMode` + `toQuoteResponse` lo emite                                                  |
| `src/features/orders/server/createOrder.ts`            | usa `isDeliveryOffered`/`deliveryFeeForNewOrder`; escribe `deliveryFee: null`; total parcial                          |
| `src/features/orders/server/read.ts`                   | `OrderSnapshot.deliveryFee: string \| null`; `orderWhatsappUrl` pasa la ausencia                                      |
| `src/features/orders/server/pull.ts`                   | tercer elemento en el `$transaction`; `deliveryFee` normalizado; `deliveryFeePending`                                 |
| `src/features/orders/server/expiry.ts`                 | segundo export, `expireUnquotedDeliveryOrdersQuery`                                                                   |
| `src/features/orders/server/status.ts`                 | `SetOrderStatusResult` de tres desenlaces; guarda + lectura clasificadora                                             |
| `src/app/api/internal/orders/status/route.ts`          | traduce el desenlace nuevo a `409` con su cuerpo                                                                      |
| `src/app/api/crons/expire-proposals/route.ts`          | corre los dos barridos en un `$transaction([…])`; añade `expiredUnquotedDelivery` a la respuesta                      |
| `src/constants/orders.ts`                              | las dos constantes nuevas                                                                                             |
| `src/features/cart/components/CheckoutForm.tsx`        | radio sin importe, fila de envío pendiente, `expectedTotal` parcial                                                   |
| `src/features/cart/components/OrderSummary.tsx`        | `totalCaption?` y el uso de `note` (copia de `sdd-designer`)                                                          |
| `src/features/orders/components/OrderLinesTable.tsx`   | `deliveryFee: string \| null`; la fila ya no se esconde por valer cero (I4)                                           |
| `src/features/orders/components/OrderProposalCard.tsx` | prop requerida `previousTotalPartial`                                                                                 |
| `src/features/orders/proposalDiff.ts`                  | `currentDeliveryFee: string \| null`; deja de decir «antes sin costo» (I3)                                            |
| `src/features/orders/whatsapp.ts`                      | `deliveryFee: Money \| null`; ni la línea ni el total imprimen `0,00` (E13)                                           |
| `src/app/[slug]/pedido/[code]/page.tsx`                | pasa la ausencia a los tres `OrderLinesTable`, al diff y a la tarjeta                                                 |
| `docs/despliegue.md`                                   | un renglón: activar el modo cotizado de una tienda por SQL hasta que F-032 lo traiga del POS                          |
| `docs/flujos-cc-qab.html`                              | § «Lo que hoy no edita nadie» pasa de **cuatro** columnas a cinco (I9)                                                |

**Se crean** (no existen todavía):

- src/features/orders/deliveryOffer.ts (etapa 2, por crear) — el módulo puro de DA6.
- prisma/migrations/&lt;timestamp&gt;\_quoted_delivery_fee/migration.sql (etapa 1, por crear).
- scripts/quote-delivery-order.mjs (por crear) — el guion de punta a punta, de `sdd-tester`.
- .agent/specs/F-031/visual.mjs (por crear) — solo si `sdd-tester` decide que hace falta.
- docs/traspaso-cuadrecaja-envio-cotizado.md (por crear) — la nota de OD4, junto con la v6.
- docs/adr/0027-ausencia-de-importe-en-la-base-cero-mas-bandera-en-el-cable.md (por
  crear) — **propuesta, no escrita**; ver § ¿Hace falta una ADR?

**Tests que ganan casos** (existen): `src/features/orders/server/expiry.db.test.ts`
(criterio 7b), `src/app/api/internal/orders/status/route.test.ts` (criterio 8),
`src/features/orders/server/pull.test.ts` (criterio 11b),
`src/features/orders/whatsapp.test.ts` (criterio 10),
`src/features/cart/components/CheckoutForm.test.tsx` (criterio 1),
`src/features/orders/server/createOrder.test.ts`,
`src/features/orders/server/quote.test.ts`, `src/features/orders/server/read.test.ts`.
Qué asserts lleva cada uno lo decide `sdd-tester`.

**El contrato** `docs/sync-contract.md` lo escribe el **orquestador** en cuanto cierre
esta arquitectura (OD2/R12), con el bloque § Contrato en el cable de arriba. Este
documento no lo toca.

## Lo que NO cambia, y por qué

- **`src/features/orders/server/respond.ts`**: aprobar ya escribe
  `deliveryFee = proposedDeliveryFee`, y con DA1 eso **es** cerrar el estado pendiente.
  Cero líneas nuevas, que es lo que OD3 y E6 exigen.
- **`proposeOrderChangeSchema`** (`src/features/orders/schemas.ts:117-198`): `items`
  sigue con `min(1)` (R13/OD3). Cuadrecaja reenvía las líneas del pedido y la v6 lo dice
  explícitamente para que no lo descubran por un `400`.
- **`src/features/orders/server/proposal.ts`** y el resto del bucle de F-019: el
  `UPDATE … FROM "Store"`, el reloj con `make_interval`, la idempotencia y la
  atribución de desenlace se reutilizan tal cual.
- **La propiedad de `Store.orderExpiryHours`**: sigue siendo de queandabuscando en la
  v6. Solo se **duplica su significado** (R15). La inversión de dueño es F-032 y su v7,
  con su propia ADR — y el comentario `///` de `prisma/schema.prisma:255-258` se queda
  como está en este ciclo, porque hoy sigue siendo cierto.
- **`src/features/sync/server/handlers/store.ts`**: su lista explícita de columnas
  (`common`, `:136-150`) no incluye ninguna de las cinco de configuración y aquí no
  gana la sexta. F-031 **lee** el modo; F-032 lo escribe.
- **`src/features/orders/server/read.ts:171`** deriva `fulfillment` de
  `deliveryAddress` y sigue así (I6). Lo que R19 prohíbe es inferir «sin cotizar», no
  inferir la modalidad.
- **`Store.deliveryFee`** sigue siendo `Decimal?` y en modo cotizado se **ignora**
  (§ Casos límite: manda el modo). No se limpia ni se valida aquí: F-032 rechazará la
  combinación contradictoria en la puerta del sync.
- **`src/features/orders/server/bell.ts`** y el timbre de F-020: los disparadores siguen
  siendo dos, y el vencimiento por reloj **no** timbra (v5.1 § El timbre).
- **`vercel.json`**: mismo cron, mismo horario.
- **`scripts/place-order.mjs`** y **`.agent/specs/F-010/visual.mjs`**: intocados, y el
  criterio 9 lo comprueba con `git diff --name-only`.
- **`src/proxy.ts`**: no se acerca a `/[slug]` (AGENTS.md § «Cosas que muerden»).

## Orden de implementación en etapas

Cada etapa se verifica sola. Los comandos son los que existen hoy; los del guion nuevo
son de `sdd-tester`.

1. **La base y el tipo.** Schema + migración revisada + `deliveryFee` normalizado y
   `deliveryFeePending` en `pull.ts`, `OrderSnapshot.deliveryFee: string | null` en
   `read.ts`, y los tipos de los cuatro consumidores. Ninguna fila queda `NULL` todavía,
   así que **no cambia ningún comportamiento**.
   → `npx prisma validate`, `bash .agent/verify.sh F-031` en verde, y
   `SELECT count(*) FROM "Order" WHERE "deliveryFee" IS NULL` = 0.
2. **Leer el modo y crear el pedido.** src/features/orders/deliveryOffer.ts (etapa 2,
   por crear), `quote.ts`, `types.ts`, `createOrder.ts`.
   → `npx vitest run --project server src/features/orders/server/createOrder.test.ts src/features/orders/server/quote.test.ts`
   con casos de modo cotizado; activación por SQL sobre `tienda-demo` y un `POST` manual
   que exige `201` y la fila con `deliveryFee IS NULL` (criterio 2).
3. **Las seis superficies del comprador.** `OrderSummary`, `CheckoutForm`,
   `OrderLinesTable`, `page.tsx`, `whatsapp.ts`, `proposalDiff.ts`,
   `OrderProposalCard`. La copia, de `sdd-designer`.
   → `npx vitest run --project ui src/features/cart/components/CheckoutForm.test.tsx`
   (criterio 1), `npx vitest run --project server src/features/orders/whatsapp.test.ts`
   (criterio 10), y `curl` de la página exigiendo `grep -c '0,00'` = 0 (criterio 3).
4. **El `409`.** `status.ts`, la ruta y las constantes.
   → `npx vitest run --project server src/app/api/internal/orders/status/route.test.ts`
   con el caso del `409` y el del `404` de otro negocio (criterio 8, R17).
5. **El reloj del pedido sin cotizar.** El segundo export de `expiry.ts`, el tercer
   elemento del `$transaction` de `pull.ts`, y el cron.
   → `npx vitest run --project db src/features/orders/server/expiry.db.test.ts` con los
   tres casos de R15 (dentro de plazo no se toca, `AWAITING_CUSTOMER` no lo toca este
   barrido, segunda pasada 0 filas) y el cron con la fecha forzada (criterio 7).
6. **Documentación operativa.** El renglón de `docs/despliegue.md` y la corrección de
   `docs/flujos-cc-qab.html` (cuatro columnas → cinco).
   → `npm run format:check` y `npm run check:harness` en verde.
7. **No-regresión y cierre.** → `bash .agent/verify.sh F-010 --visual` en 0,
   `node scripts/place-order.mjs --store=tienda-dos --delivery`,
   `git diff --name-only main -- scripts/place-order.mjs .agent/specs/F-010/visual.mjs`
   sin salida (criterio 9), `node scripts/pull-orders.mjs --paginate` (criterio 11c) y
   `bash .agent/verify.sh F-031 --full` con código 0 (criterio 12).

La v6 del contrato y la nota de traspaso **van antes de la etapa 1** (OD2), y las
escribe el orquestador.

## Patrones a seguir / antipatrones a evitar

- **Batchear en un round-trip, nunca `$transaction` interactivo** con el cliente global:
  el pooler corre en modo transacción (AGENTS.md § «Cosas que muerden», ficha
  `.agent/playbook/pooler-transaccion-deadlock.md`). Los dos barridos devuelven la
  promesa sin `await` justamente para eso.
- **Prisma solo en `features/*/server/`.** El módulo de DA6 es puro y por eso puede
  importarlo la isla; si alguien mete un `select` ahí, ESLint lo para.
- **Sin Zod en el árbol de cliente**: el modo viaja en `types.ts`, no en `schemas.ts`.
- **Sin magic strings**: el literal del vencimiento y la lista de estados con guarda van
  a `src/constants/orders.ts`.
- **No inferir «sin cotizar»** de la dirección ni de comparar `total` con `subtotal`
  (R19). Si un componente necesita saberlo, se le pasa; no lo deduce.
- **No añadir una segunda bandera** que diga lo que `deliveryFeePending` ya dice
  (`totalIsPartial`, `deliveryQuotedAt`…). Dos fuentes para un hecho es cómo aparece la
  fila contradictoria.
- **Un archivo que no existe se cita sin comillas invertidas y con `(por crear)`**
  (AGENTS.md § «Cosas que muerden»); y `npm run format` se pasa sobre lo que uno mismo
  escribió antes de dar una etapa por buena, comprobando que Prettier no convirtió una
  línea de continuación en viñeta.

## Riesgos y plan B

- **Un pedido `CONFIRMED` sin cotizar se cancela solo a las 24 h.** Es la decisión SP1 y
  el `409` la hace necesaria (si no, quedaría vivo para siempre con un total que nunca
  cierra), pero una tienda que cotiza el lunes por la mañana un pedido del domingo por
  la noche se lo encuentra cancelado. Plan B: `orderExpiryHours` es por tienda y F-032
  lo pone en manos del POS; la v6 documenta el doble significado para que nadie lo
  descubra en producción.
- **El plazo doble (~2 × `orderExpiryHours`)** puede parecer un error al otro equipo.
  Mitigación: va escrito en la v6 como consecuencia esperada, no como nota al pie.
- **El formato de los importes del pull** (AP1). Si el humano elige normalizarlos todos,
  la etapa 1 crece un poco y el criterio 9 hay que releerlo con cuidado («los mismos
  **importes**», no las mismas cadenas). Si elige no tocar nada, `deliveryFee` sale como
  `"0"` en los dos pedidos y la v6 lo dice así: el criterio 4 se cumple igual, porque lo
  que exige es que sean **indistinguibles**.
- **La copia del `cancelReason`** (AP2) viaja en el contrato como literal. Si
  `sdd-designer` la cambia después de publicar la v6, hace falta una v6.1 — barato, pero
  evitable si se fija ahora.
- **`prisma migrate dev` contra la base compartida.** Postgres 5433 lo comparten el
  checkout principal y otro worktree; hay ficha para el drift de checksum
  (`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`). La migración
  se genera y se revisa antes de aplicarla, y `migrate reset`/`db push` siguen
  prohibidos.

## ¿Hace falta una ADR?

**Sí, una: propuesta, no escrita.** El siguiente número libre es **0027** —con la
advertencia de que `.agent/specs/F-014/architecture.md:580` y
`.agent/specs/F-020/architecture.md:793` ya propusieron sendas ADR 0027 que nunca se
escribieron, así que el número lo asigna el humano al firmar el plan (AP3)—.

Título propuesto: **«La ausencia de un importe se modela como `NULL` en la base y como
cero más bandera en el cable»**. Borrador del contenido:

- **Contexto.** F-031 necesita distinguir «envío sin cotizar» de «envío 0.00» en la base
  y en un contrato que ya tiene consumidores declarados. Las dos capas tienen
  restricciones opuestas: la base no tiene consumidor heredado que proteger; el cable
  mide su cambio por aditividad (criterio 11).
- **Decisión.** En la base, la ausencia se modela como ausencia (`NULL`) y nunca como un
  valor centinela. En el cable, el campo heredado conserva su tipo y su presencia con un
  valor de relleno, y un **campo nuevo** dice que ese relleno no es un dato. La
  asimetría es deliberada y se documenta en el propio contrato.
- **Corolario, que aplica a todo el contrato.** Un valor que el POS **emite** se modela
  como enum, porque crecerlo es aditivo para quien lo emite; un valor que el POS
  **consume** se modela como booleano cuando su espacio de estados está cerrado, porque
  crecer un enum consumido rompe un `switch` exhaustivo del otro lado — que es
  exactamente la fila que `docs/sync-contract.md:1053` ya tuvo que escribir cuando
  `status` pasó de 6 a 9 valores.
- **Consecuencias.** Cualquier importe opcional futuro (recargo, propina, impuesto)
  sigue esta forma sin volver a discutirla; y un `SUM` sobre una columna de dinero
  anulable tiene que decidir a propósito qué hace con los pendientes, en vez de sumar
  ceros que no lo son.
- **Alternativas descartadas.** Marca explícita junto al `0.00` en la base (obliga a
  tocar `respond.ts`, admite filas contradictorias, pierde la barrida del compilador);
  `NULL` también en el cable (rompería al consumidor de la v5 que hace `parseFloat`).

No supera ninguna ADR existente. No contradice la 0017: las cinco columnas de
configuración siguen siendo del sync y el panel sigue sin tocarlas.

## Preguntas al humano

**AP1 — El formato de los importes en el payload del pull.** El pull emite hoy
`"subtotal":"1150"`, `"deliveryFee":"0"` (Prisma suprime los ceros de relleno), mientras
el ejemplo publicado de la v5.1 y los fixtures de la suite dicen `"880.00"`/`"0.00"`.
Como la v6 se escribe ahora, hay que elegir qué documenta:

- **(a) Recomendada.** F-031 normaliza a dos decimales **solo `deliveryFee`** —el campo
  cuyos dos casos tienen que ser indistinguibles (criterio 4)— y la v6 dice la verdad
  sobre los demás, con la regla «compara los importes como números, nunca como
  cadenas». Se abre un feature aparte para normalizar el resto.
- (b) F-031 normaliza **todos** los importes del pull. Payload coherente y ejemplo
  publicado por fin cierto, a cambio de un diff mayor y de releer el criterio 9 («los
  mismos importes que hoy») como importes y no como cadenas.
- (c) No se normaliza nada: `deliveryFee` sale `"0"` en los dos pedidos y la v6 lo
  documenta así. El criterio 4 se cumple igual; R18 pierde su `"0.00"` literal.

**AP2 — El literal del `cancelReason` del pedido sin cotizar.** La v6 lo documenta
literal (como ya hace con «La propuesta venció sin respuesta»), y `sdd-designer` está
escribiendo la copia en paralelo. Propuesta:
`"El pedido venció sin que la tienda cotizara el envío"`.

- **(a) Recomendada.** Se fija ahora, entra en la v6, y `sdd-designer` queda atado a él
  para esta cadena (es vocabulario de contrato, no copia de pantalla).
- (b) La v6 espera a `design.md`. Retrasa la publicación que OD2 quiere adelantada.

**AP3 — El número de la ADR.** ¿Se aprueba la ADR propuesta arriba y se le asigna el
**0027**, aun con dos propuestas anteriores no escritas apuntando al mismo número
(F-014, F-020)? Recomendación: sí, con 0027 para F-031 —es la única de las tres que un
feature en curso necesita para justificar una decisión ya tomada— y que F-014/F-020
renumeren si algún día se escriben.
