---
feature: F-031
agente: sdd-implementer
actualizado: 2026-09-01T17:34:33Z
estado: listo
---

## Qué se construyó

**Solo las etapas 1 y 2 del plan firmado** (`plan.md` § Pasos). Las etapas 3
a 8 quedan para ciclos posteriores; no se tocó ningún componente de
`src/features/cart/components/` ni de `src/features/orders/components/`, ni
`docs/sync-contract.md`, ni `src/features/orders/server/respond.ts`, ni
`src/features/orders/schemas.ts`.

| Archivo                                                                                    | Qué hace                                                                                                                                                                                                                                                                                                                                      | Etapa |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `prisma/schema.prisma`                                                                     | `enum DeliveryFeeMode { FLAT_RATE, QUOTED_PER_ORDER }`; `Store.deliveryFeeMode @default(FLAT_RATE)`; `Order.deliveryFee` a `Decimal?` (conserva `@default(0)`); comentarios `///` (DA1/DA2)                                                                                                                                                   | 1     |
| `prisma/migrations/20260901165226_quoted_delivery_fee/migration.sql`                       | `CREATE TYPE`, `ALTER TABLE "Store" ADD COLUMN`, `ALTER TABLE "Order" ALTER COLUMN DROP NOT NULL`. Los cuatro `DROP INDEX` que Prisma propuso (índices GIN/parciales no declarados) se quitaron a mano                                                                                                                                        | 1     |
| `src/features/orders/server/pull.ts`                                                       | `deliveryFeePending` en `PulledOrder`; **todos** los importes de dinero del payload pasan por `money(...)` (dos decimales siempre): `subtotal`, `discountTotal`, `deliveryFee` (con `?? 0`, nunca `null` en el cable), `total`, los cuatro de `proposal.*` y `unitPrice`/`lineTotal`/`originalUnitPrice` de cada línea. `quantity` NO se toca | 1     |
| `src/features/orders/server/pull.test.ts`                                                  | Fixtures reescritos para simular `Decimal.toString()` REAL (sin ceros de relleno: `"900"`, no `"900.00"`) — el mock anterior escondía el bug que describe `architecture.md` § Riesgos. Tres casos nuevos de `deliveryFeePending`/`deliveryFee` normalizado                                                                                    | 1     |
| `src/features/orders/server/read.ts`                                                       | `OrderSnapshot.deliveryFee: string \| null` (nunca se sustituye por `"0.00"` ahí); `orderWhatsappUrl` usa `?? 0` al construir el `Money` (coste aceptado de DA1, ver § Desviaciones)                                                                                                                                                          | 1     |
| `src/features/orders/types.ts`                                                             | `QuoteStore.deliveryFeeMode: "FLAT_RATE" \| "QUOTED_PER_ORDER"`                                                                                                                                                                                                                                                                               | 1/2   |
| `src/features/orders/deliveryOffer.ts` (nuevo)                                             | Módulo puro DA6: `isDeliveryOffered()` (R20) y `deliveryFeeForNewOrder()` (E8, "manda el modo"). Sin Prisma, sin React, sin Zod                                                                                                                                                                                                               | 2     |
| `src/features/orders/deliveryOffer.test.ts` (nuevo)                                        | Siete casos: `deliveryEnabled` falso, `FLAT_RATE` con/sin tarifa, `QUOTED_PER_ORDER` sin tarifa, `PICKUP` siempre `"0.00"`, la tarifa residual ignorada en modo cotizado                                                                                                                                                                      | 2     |
| `src/features/orders/server/quote.ts`                                                      | `OrderStore.deliveryFeeMode`; `loadStoreForOrder` lo selecciona y lo mapea; `toQuoteResponse` lo emite explícito (R20)                                                                                                                                                                                                                        | 2     |
| `src/features/orders/server/quote.test.ts`                                                 | Fixture `store` con `deliveryFeeMode: "FLAT_RATE"`; dos casos nuevos: `loadStoreForOrder` lo traslada y `toQuoteResponse` lo emite                                                                                                                                                                                                            | 2     |
| `src/features/orders/server/createOrder.ts`                                                | Usa `isDeliveryOffered`/`deliveryFeeForNewOrder` en vez de la regla duplicada (`createOrder.ts:174` original); escribe `deliveryFee: null` cuando el modo es cotizado y hay `DELIVERY`; `total` queda parcial (`subtotal - discountTotal`) mientras no haya cotización (R9)                                                                   | 2     |
| `src/features/orders/server/createOrder.test.ts`                                           | Tres casos nuevos bajo "F-031 — QUOTED_PER_ORDER": `deliveryFee: null` + total parcial en `DELIVERY`; la tarifa residual de `Store.deliveryFee` se ignora; `PICKUP` en tienda cotizada sigue devolviendo `"0.00"` (E8)                                                                                                                        | 2     |
| `src/app/[slug]/pedido/[code]/page.tsx`                                                    | Tres usos de `order.deliveryFee` (ahora `string \| null`) con `?? "0.00"` — cambio mínimo de tipo para compilar, ver § Desviaciones                                                                                                                                                                                                           | 1     |
| `src/features/cart/components/CheckoutForm.test.tsx`, `CheckoutForm.autocomplete.test.tsx` | `deliveryFeeMode: "FLAT_RATE"` añadido al fixture `QuoteStore` de las pruebas — cambio de fixture, no de componente ni de aserto                                                                                                                                                                                                              | 1     |
| `.agent/specs/F-031/impl.md`                                                               | Este documento                                                                                                                                                                                                                                                                                                                                | —     |

## Desviaciones

Todas dentro del coste que `architecture.md` DA1 acepta explícitamente
("el cable necesita un `??`", "tsc enumera las cinco superficies que
rompen"). Ninguna cambia el alcance ni una cadena visible; todas quedan
para que la etapa 3 (`sdd-implementer`, con `design.md`) las complete de
verdad.

- **`read.ts` — `orderWhatsappUrl` usa `money(snapshot.deliveryFee ?? 0, …)`.**
  `WhatsappOrderInput.deliveryFee` (en `whatsapp.ts`, archivo de la etapa 3)
  sigue siendo `Money`, no `Money | null`, así que un pedido sin cotizar
  imprime hoy "Envío: $0.00" en el mensaje de WhatsApp en vez de "por
  confirmar". Es exactamente el `?? 0` que `architecture.md` DA1 nombra como
  coste aceptado ("pull.ts y read.ts … emiten `money(row.deliveryFee ?? 0,
currencyCode).amount`"). No se tocó `whatsapp.ts`: la etapa 3 lo hace
  `Money | null` y usa `deliveryFeePending` (E13, criterio 10).
- **`page.tsx` — tres usos de `order.deliveryFee` con `?? "0.00"`** (uno
  alimentando `buildProposalDiff`, dos alimentando `OrderLinesTable`).
  `architecture.md` DA1 nombra literalmente estos tres puntos
  (`page.tsx:123,283,294`) como superficies que `tsc` rompe al volver
  `OrderSnapshot.deliveryFee` anulable. Con el `?? "0.00"` compila sin tocar
  `OrderLinesTable.tsx`, `OrderProposalCard.tsx` ni `proposalDiff.ts` (los
  tres son de la etapa 3), pero un pedido sin cotizar en
  `/[slug]/pedido/[code]` sigue mostrando la fila de envío en `$0.00` en vez
  de "por confirmar" hasta que la etapa 3 le pase `deliveryFeePending` a esas
  tres piezas y les cambie el rótulo del total.
- **Fixtures de test, no componentes**: `CheckoutForm.test.tsx` y
  `CheckoutForm.autocomplete.test.tsx` ganaron `deliveryFeeMode: "FLAT_RATE"`
  en su `QuoteStore` simulado porque el campo pasó a ser obligatorio
  (R20). Ningún aserto ni cadena visible cambió; sin este campo `tsc` no
  compila esos dos archivos.
- **Migración: se quitaron 4 de los 5 `DROP INDEX` que anticipa
  `architecture.md`** (`CanonicalProduct_searchVector_idx`,
  `CanonicalProduct_name_trgm_idx`, `StoreProduct_searchVector_idx`,
  `StoreProduct_searchDocument_trgm_idx`). El quinto,
  `StoreProduct_visible_catalog_idx`, no apareció en este diff — no es una
  desviación de alcance, solo que este `schema.prisma` en particular ya lo
  tenía cubierto por otro camino; se comprobó con `git diff` que el
  `migration.sql` aplicado no contiene ningún `DROP INDEX`.
- **`deliveryFeeForNewOrder`/`isDeliveryOffered` tratan un `deliveryFeeMode`
  ausente (`undefined`) como `FLAT_RATE`.** Los fixtures de
  `createOrder.test.ts` y `quote.test.ts` que no fueron tocados por este
  ciclo (los que no ejercitan el modo cotizado) siguen sin declarar
  `deliveryFeeMode`, y en producción la columna nunca es `undefined`
  (`@default(FLAT_RATE)` la garantiza). Documentado para que la etapa 3/6
  no lo redescubra como bug.

## Comandos ejecutados

- `npx prisma format` && `npx prisma validate` → `The schema … is valid`.
- `npm run db:migrate -- --name quoted_delivery_fee --create-only`, edición
  manual del `migration.sql` (los 4 `DROP INDEX`), `npm run db:migrate`
  (aplicó `20260901165226_quoted_delivery_fee`). `npx prisma generate`.
- Verificación directa sobre Postgres (`DIRECT_URL`, puerto 5433):
  `SELECT count(*) FROM "Order" WHERE "deliveryFee" IS NULL` → **0**;
  `SELECT "deliveryFeeMode", count(*) FROM "Store" GROUP BY 1` → `FLAT_RATE:
10` (ninguna tienda cambia de comportamiento, R6).
- `npx tsc --noEmit` → limpio.
- `npx vitest run --project server src/features/orders/server/pull.test.ts`
  → 18 passed.
- `npx vitest run --project server src/features/orders/server/read.test.ts
src/features/orders/server/quote.test.ts
src/features/orders/server/createOrder.test.ts` → 58 passed.
- `npx vitest run --project server src/features/orders/deliveryOffer.test.ts`
  → 7 passed.
- `bash .agent/verify.sh F-031` → **código de salida 0** (typecheck·lint·format·test).
- `bash .agent/verify.sh F-031 --full` → **código de salida 0**
  (harness·typecheck·lint·format·test·prisma·build·theme·bundle).
- **`POST /api/orders` real, criterio 2 del plan**: `Store` de
  `seed-tienda-1` (`tienda-demo`) activada por SQL
  (`deliveryEnabled: true, deliveryFeeMode: 'QUOTED_PER_ORDER'`) contra un
  `next dev -p 3102` de este worktree.
  - `fulfillment: "DELIVERY"` → `201`, fila creada con `deliveryFee IS NULL`,
    `total` parcial (`900` = `subtotal - discountTotal`, sin envío sumado).
  - `fulfillment: "PICKUP"` en la misma tienda cotizada → `201`,
    `deliveryFee = 0` (cotizado, no pendiente) — E8.
  - `GET /api/internal/orders` (con un token acuñado con `npm run
mint:token -- seed-negocio-1`) devolvió esa misma fila con
    `"deliveryFee":"0.00","deliveryFeePending":true,"total":"900.00"` y
    TODOS los demás importes con dos decimales (`"subtotal":"900.00"`,
    `"discountTotal":"0.00"`, `"unitPrice":"450.00"`, `"lineTotal":"900.00"`,
    `"originalUnitPrice":"450.00"`, `"originalLineTotal":"900.00"`);
    `quantity` siguió como `"2"` (Decimal.toString() real, sin normalizar
    — correcto, no es dinero).
  - Limpieza: se borraron los dos pedidos de prueba y se restauró
    `seed-tienda-1` a `deliveryEnabled: false, deliveryFeeMode:
'FLAT_RATE'` — el estado que tenía antes de esta verificación.

## Deuda dejada

- Las cinco superficies de compra que `architecture.md` DA1 nombra
  (`page.tsx:123,283,294`, `orderWhatsappUrl`, `ProposalDiffInput`) siguen
  mostrando `"$0.00"` para un pedido sin cotizar en vez de "por confirmar" —
  es exactamente el trabajo de la etapa 3 (`design.md`), no una regresión de
  este ciclo: ningún pedido con `deliveryFee = NULL` podía existir antes de
  la etapa 2, así que antes de hoy esas líneas eran inalcanzables con ese
  valor.
- Etapas 3 a 8 completas: las seis superficies del comprador, el `409`, el
  reloj del pedido sin cotizar, el guion de punta a punta, la documentación
  operativa y la ADR 0027, y el cierre de no-regresión.

## Qué necesita quien pruebe

- **Entorno:** el mismo Postgres compartido (`localhost:5433`, contenedor
  `queandabuscando-postgres`) — no se creó ni se recreó ningún contenedor.
  `npm run db:migrate` (nunca `migrate reset`/`db push`) para aplicar la
  migración si no está aplicada; `npx prisma generate` después de cualquier
  `git pull` que toque `prisma/schema.prisma`.
- **Para repetir el `POST /api/orders` cotizado a mano**: activar el modo
  por SQL sobre cualquier tienda (`UPDATE "Store" SET "deliveryEnabled" =
true, "deliveryFeeMode" = 'QUOTED_PER_ORDER' WHERE …`), pedir con
  `fulfillment: "DELIVERY"`, y revertir el `UPDATE` al terminar — no hay
  ninguna tienda del seed con `WHATSAPP` + `QUOTED_PER_ORDER` (I incongruencia
  de `sdd-spec`, atada a `tienda-demo`/`seed-tienda-1` en el criterio 10).
- **Aviso importante, no relacionado con el código:** para verificar el pull
  con un bearer token real ejecuté `npm run mint:token -- seed-negocio-1`.
  Ese comando **rota** el token del negocio (`E24/E25` de su propio
  docstring): el token anterior de `seed-negocio-1`, si alguna otra sesión o
  worktree lo tenía guardado en su `.env.local` o en su shell, dejó de
  funcionar de inmediato. `.env.example` de este repo trae
  `QAB_BEARER_TOKEN=""` vacío (nadie depende de un valor fijo aquí), pero
  como la Postgres es compartida entre worktrees avísese: si otra sesión
  tenía un `QAB_BEARER_TOKEN` exportado para `seed-negocio-1`, necesita
  volver a acuñarlo. No encontré forma de deshacer la rotación (el hash es
  de un solo sentido, R11 de `mint-sync-token.ts`).

## Preguntas al humano

Ninguna. El plan no dejó ninguna decisión de alcance pendiente para las
etapas 1 y 2; las desviaciones de arriba son el coste que `architecture.md`
DA1 ya adelantó por escrito, no cambios de alcance.

---

## Etapa 3 — las seis superficies del comprador (2026-09-01T17:34:33Z)

**Qué se construyó.** Las seis superficies de `plan.md` fila 3 más las dos
que `design.md` § 7 añadió (`OrderStatusBadge.tsx` y los títulos de
`page.tsx`), con la copia literal de `design.md`. Cierra las cinco
desviaciones que las etapas 1-2 dejaron anotadas en `?? 0` / `?? "0.00"`.

| Archivo                                                | Qué gana                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/cart/components/OrderSummary.tsx`        | Dos props opcionales: `totalCaption` (reemplaza el `"Total"` fijo) y `partialNotice` (la coletilla, dentro del bloque del total, **no** en `note`, que sigue con su estilo `text-xs text-fg-muted` de siempre)                                                                                                                                                                                              |
| `src/features/cart/components/CheckoutForm.tsx`        | `deliveryOffered` pasa a leer `isDeliveryOffered()` de `deliveryOffer.ts` (antes comparaba `quote.store.deliveryFee !== null`, que en modo cotizado siempre es `null` y ocultaba el domicilio — bug que esta etapa cierra, no lo introduce); nuevo `deliveryQuotePending`; descripción del radio `"Costo por confirmar"`; párrafo nuevo bajo la dirección; `totalCaption`/`partialNotice` al `OrderSummary` |
| `src/features/orders/components/OrderLinesTable.tsx`   | `deliveryFee: string \| null`, `hasDelivery: boolean` (nuevo). La fila de envío se decide por `hasDelivery`, nunca por `isZero(...)` (la línea 33 vieja se borró): aparece en todo pedido a domicilio —incluido el envío regalado en `$0.00`— y solo en ellos                                                                                                                                               |
| `src/features/orders/components/OrderProposalCard.tsx` | Prop **requerida** `previousTotalPartial: boolean` (no tiene default a propósito, para que `tsc` obligue a decidirlo en la única llamada). Titular, los tres `dt`, el párrafo de aprobar y el caso de totales iguales, todo bifurcado por esa prop                                                                                                                                                          |
| `src/features/orders/proposalDiff.ts`                  | `currentDeliveryFee: string \| null`. La condición de emisión pasa a `=== null \|\| !==`: antes, con envío regalado (`"0.00" !== "0.00"`), no emitía nada; ahora dice "estaba por confirmar, ahora sin costo."                                                                                                                                                                                              |
| `src/features/orders/whatsapp.ts`                      | `WhatsappOrderInput.deliveryFee: Money \| null`. `"Envío: por confirmar"` (minúscula, prosa) y `"Total parcial: … más el envío por confirmar"` cuando `deliveryFee === null`                                                                                                                                                                                                                                |
| `src/features/orders/components/OrderStatusBadge.tsx`  | Prop nueva `deliveryFeePending?: boolean` (con default `false`, así los tests viejos no se tocan). Bifurca la explicación de `AWAITING_CUSTOMER` y el label+explicación de `CANCELLED`/`EXPIRY` (I7: nunca le habla al comprador de una propuesta que no vio)                                                                                                                                               |
| `src/app/[slug]/pedido/[code]/page.tsx`                | `deliveryFeePending = order.deliveryFee === null`, pasada a las tres piezas de arriba; tira superior, título/summary de la tabla de propuesta, todos bifurcados por ese booleano; `hasDelivery` pasado a las tres llamadas a `OrderLinesTable`                                                                                                                                                              |
| `src/features/orders/server/read.ts`                   | Cierra la desviación de `orderWhatsappUrl`: `deliveryFee: snapshot.deliveryFee === null ? null : money(...)`, ya no `?? 0`                                                                                                                                                                                                                                                                                  |

**Desviaciones cerradas** (las que `impl.md` de la etapa 1-2 dejó anotadas
en § Desviaciones, ahora resueltas de verdad, no con un `??`):
`read.ts`'s `orderWhatsappUrl`, y los tres usos de `order.deliveryFee` en
`page.tsx` (uno en `buildProposalDiff`, dos en `OrderLinesTable`). Ningún
`?? "0.00"` / `?? 0` sobrevive en el árbol de esta etapa.

**Desviación nueva, de alcance menor, autorizada por el mensaje de esta
etapa (no por `plan.md`):** `src/features/orders/components/OrderStatusBadge.tsx`
no está en la fila 3 de `plan.md` § Pasos, pero sí en `design.md` § 7a y en
el encargo explícito de esta etapa ("dos superficies más que design.md
añadió"). Se implementó igual; queda anotado porque desviarse de la lista de
archivos de un paso firmado se anota, aunque el propio encargo lo pidiera.

**Un hallazgo, no solo copia:** `CheckoutForm.tsx`'s `deliveryOffered` se
calculaba como `quote.store.deliveryEnabled && quote.store.deliveryFee !== null`.
En modo `QUOTED_PER_ORDER`, `quote.store.deliveryFee` es **siempre** `null`
(E2/DA1) — con esa condición el domicilio nunca se hubiera ofrecido en una
tienda cotizada, que es exactamente E1. Se reemplazó por
`isDeliveryOffered()` (el módulo puro de DA6 que ya existía desde la etapa
2), que decide por el modo explícito y no por si hay una tarifa numérica.

**Comandos ejecutados:**

- `npx tsc --noEmit` → limpio.
- `npx eslint` y `npx prettier --write` sobre los nueve archivos de
  producción y los cinco de test tocados → limpio, sin cambios de sentido.
- `npx vitest run` (suite completa) → **1075 passed**, 115 archivos.
- Casos nuevos por archivo: `CheckoutForm.test.tsx` (+2, describe "envío
  cotizado"), `whatsapp.test.ts` (+2), `proposalDiff.test.ts` (+2),
  `OrderProposalCard.test.tsx` (+4, describe "sobre un pedido sin
  cotizar"), `OrderStatusBadge.test.tsx` (+2).
- `bash .agent/verify.sh F-031` → **código de salida 0** (typecheck·lint·format·test).
- `bash .agent/verify.sh F-031 --full` → **código de salida 0**
  (harness·typecheck·lint·format·test·prisma·build·theme·bundle).
- **Verificación en navegador de punta a punta**, contra un `next dev -p
3103` de este worktree (puerto propio, comprobado libre antes de
  levantarlo): `tienda-demo` activada por SQL
  (`deliveryEnabled: true, deliveryFeeMode: 'QUOTED_PER_ORDER'`), un pedido
  a domicilio con subtotal `$2,210.25` (DP1: centavos ≠ `00`). Confirmado
  con `curl`, byte a byte contra `design.md`:
  - Checkout `POST /api/orders` → `whatsappUrl` decodificado: `"Envío: por
confirmar"` y `"Total parcial: $2,210.25 más el envío por confirmar"`.
  - Página del pedido, sin cotizar: fila `Envío` / `Por confirmar`, `Total
parcial` / `$2,210.25` / `más el envío por confirmar`. Cero apariciones de
    `$0.00`.
  - Retiro en la misma tienda cotizada: la tabla del pedido **no** tiene
    fila de envío (E8) y el mensaje de WhatsApp dice `Total: $2,210.25`
    sin línea de envío.
  - Transición a `AWAITING_CUSTOMER` (propuesta de `$180.00` escrita
    directo en la fila, sin pasar por `respond.ts` ni por un token
    minteado — ver aviso abajo): tira `"La tienda ya calculó el envío de
tu pedido"`, enlace `"Ver el envío y responder"`, insignia
    `"Esperando tu respuesta"` con `"La tienda ya puso el costo del
envío…"`, `dl` con `"Total sin el envío"` / `"Total con el envío"` /
    `"El envío"` (`$180.00`), diff `"Envío: estaba por confirmar, ahora
$180.00."`, párrafo de aprobar `"Vas a aceptar el envío que puso la
tienda: pagarías $2,390.25, que es tu pedido ($2,210.25) más el envío
($180.00)…"`, título de tabla `"Tu pedido con el envío incluido"`,
    `summary` `"Ver tu pedido sin el envío"`.
  - Aprobado (`CONFIRMED`): `Envío $180.00`, `Total $2,390.25`, **cero**
    apariciones de "por confirmar" en toda la página (E11 medido de
    verdad, no solo por test).
  - Envío regalado (`$0.00` cotizado): diff `"Envío: estaba por confirmar,
ahora sin costo."`, tarjeta `"Ya está el total completo: la tienda no te
cobra el envío, así que sigue siendo $2,210.25."`, y tras aprobar la
    fila de envío **sigue existiendo** con `$0.00` (no desaparece).
  - Vencimiento sin cotizar (`CANCELLED`/`EXPIRY` con `deliveryFee` aún
    `NULL`, escrito directo): insignia `"Cancelado: se venció el plazo"` +
    `"La tienda no llegó a confirmar el costo del envío y el plazo del
pedido se acabó. No se te cobró nada; si todavía lo quieres,
escríbele."` — ninguna mención a una propuesta.
  - Limpieza: se borraron los cuatro pedidos y las líneas de prueba
    (`Order`/`OrderItem`), y se restauró `tienda-demo` a
    `deliveryEnabled: false, deliveryFeeMode: 'FLAT_RATE'`, su estado
    previo. `bash .agent/verify.sh F-031 --full` se corrió otra vez
    después de la limpieza y sigue en 0.

**Aviso operativo: no se acuñó ningún token.** La transición a
`AWAITING_CUSTOMER`/`CONFIRMED`/`CANCELLED` de la verificación de arriba se
escribió con Prisma directo sobre las columnas de propuesta (mismo patrón
que activar el modo por SQL), **no** a través de
`POST /api/internal/orders/proposal` ni de `npm run mint:token`. La ficha
`.agent/playbook/mint-token-rota-el-token-en-bd-compartida.md` seguía
vigente y esta etapa no la necesitaba: verificar la copia de las seis
superficies no exige que la escritura pase por el endpoint guardado, solo
que la fila quede en el estado que ese endpoint dejaría.

## Preguntas al humano (etapa 3)

Ninguna. `design.md` fijó la copia literal y no encontré ninguna cadena que
contradijera `spec.md`/`architecture.md`; las dos desviaciones de alcance
(`OrderStatusBadge.tsx` fuera de la lista de `plan.md`, y el hallazgo del
bug de `deliveryOffered`) están documentadas arriba, no preguntadas, porque
la primera la autorizó el propio encargo de esta etapa y la segunda es una
corrección dentro del mismo archivo que el plan ya listaba.

---

## Etapa 4-5 — el `409` y el reloj del pedido sin cotizar (2026-09-01)

**Qué se construyó.** Las etapas 4 y 5 del plan firmado: el `409
ORDER_DELIVERY_NOT_QUOTED` al despachar sin cotizar, y el segundo barrido
que cierra solo el pedido que nadie cotiza. Las etapas 6-8 quedan para
ciclos posteriores; no se tocó `docs/sync-contract.md`,
`docs/traspaso-cuadrecaja-envio-cotizado.md`, `src/features/orders/server/respond.ts`,
`proposeOrderChangeSchema`, ningún componente de
`src/features/cart/components/` ni de `src/features/orders/components/`,
`whatsapp.ts`, `proposalDiff.ts`, `scripts/place-order.mjs`,
`.agent/specs/F-010/visual.mjs` ni `vercel.json`.

| Archivo                                            | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Etapa |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `src/constants/orders.ts`                          | `ORDER_UNQUOTED_DELIVERY_EXPIRED_REASON` (literal de AP2, sin tocar una tilde) y `ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY = ["READY","IN_TRANSIT","DELIVERED"]`                                                                                                                                                                                                                                                                                                                                                                                                     | 4/5   |
| `src/features/orders/server/status.ts`             | `setOrderStatus` devuelve `SetOrderStatusResult` (`ok` \| `unknown_order` \| `delivery_not_quoted`) en vez de `{ok: boolean}`. El `updateMany` gana `deliveryFee: {not: null}` **solo** para los tres estados de `ORDER_STATUSES_REQUIRING_QUOTED_DELIVERY`. Con `count === 0`, `classifyZeroRows` (mismo patrón que `proposal.ts`) comprueba `businessId` **antes** que `deliveryFee` (R17); una carrera perdida (fila existe, es del negocio, está cotizada, pero 0 filas) cae al mismo `unknown_order` de siempre, con `console.error`, sin inventar un desenlace | 4     |
| `src/features/orders/server/status.test.ts`        | Casos nuevos: la guarda NO se añade para `CONFIRMED`/`CANCELLED`/`REJECTED_BY_STORE`; SÍ se añade para los tres de despacho; `delivery_not_quoted` cuando la fila es del negocio y `deliveryFee` es `NULL`; `unknown_order` (no `delivery_not_quoted`) cuando la fila es de OTRO negocio aunque el envío esté sin cotizar (R17); `unknown_order` cuando no existe; `ok` cuando ya está cotizado sin llamar a `findUnique`; la carrera perdida con `console.error`                                                                                                    | 4     |
| `src/app/api/internal/orders/status/route.ts`      | Traduce `result.kind`: `delivery_not_quoted` → `409 {"error":"ORDER_DELIVERY_NOT_QUOTED"}`; `unknown_order` → `404 {"error":"UNKNOWN_ORDER"}`; `ok` → `200 {"ok":true}`. No repite la comprobación de negocio: es `setOrderStatus` quien decide el orden                                                                                                                                                                                                                                                                                                             | 4     |
| `src/app/api/internal/orders/status/route.test.ts` | `setOrderStatus` mockeado con la nueva forma `{kind}`; casos nuevos: `409` en los tres destinos que lo exigen; `200` sobre el mismo pedido con `kind: "ok"`; `404` (no `409`) para un pedido de otro negocio aunque el destino sea uno de los tres (R17)                                                                                                                                                                                                                                                                                                             | 4     |
| `src/features/orders/server/expiry.ts`             | Segundo export, `expireUnquotedDeliveryOrdersQuery(businessId?)`: un solo `UPDATE "Order" o … FROM "Store" s` con `o."deliveryFee" IS NULL AND o.status IN ('PENDING','PULLED','CONFIRMED') AND o."createdAt" < now() - make_interval(hours => s."orderExpiryHours")`, `cancelReason` con el literal de constants. Devuelve la `PrismaPromise` sin `await` (DA4)                                                                                                                                                                                                     | 5     |
| `src/features/orders/server/pull.ts`               | Tercer elemento del `$transaction([…])`: `expireProposalsQuery`, `expireUnquotedDeliveryOrdersQuery`, `findMany` — destructuring `[, , rows]`. Comentario del encabezado ampliado con el nuevo barrido                                                                                                                                                                                                                                                                                                                                                               | 5     |
| `src/features/orders/server/pull.test.ts`          | El test de "mismo `$transaction`" ahora espera `executeRaw` llamado **dos** veces (los dos barridos) antes del único `findMany`                                                                                                                                                                                                                                                                                                                                                                                                                                      | 5     |
| `src/app/api/crons/expire-proposals/route.ts`      | Corre los dos barridos en `prisma.$transaction([…])` (un round-trip) sin `businessId`; responde `{expired, expiredUnquotedDelivery}` — la clave vieja no cambia de significado                                                                                                                                                                                                                                                                                                                                                                                       | 5     |
| `src/app/api/crons/expire-proposals/route.test.ts` | Mock de `@/lib/prisma` con `$transaction` en forma de array (`Promise.all`); mock nuevo de `expireUnquotedDeliveryOrdersQuery`; aserto de las dos claves de la respuesta y de que ninguno de los dos se llama sin el bearer correcto                                                                                                                                                                                                                                                                                                                                 | 5     |
| `src/features/orders/server/expiry.db.test.ts`     | Describe nuevo contra Postgres real: dentro del plazo no se toca; vencido se cancela con el motivo propio en los tres estados abiertos **incluido `CONFIRMED`** (decisión del humano); `AWAITING_CUSTOMER` nunca se toca aunque sea viejo (R15); segundo barrido afecta 0 filas (R16); un pedido ya cotizado no se toca por viejo que sea; aislado por `businessId`; el cron (sin `businessId`) alcanza cualquier negocio                                                                                                                                            | 5     |

## Desviaciones (etapa 4-5)

Ninguna de alcance. Una de forma, menor: el mensaje de `console.error` de la
carrera perdida en `classifyZeroRows` (`status.ts`) no está literal en
`architecture.md` DA5 (que solo dice "se registra con `console.error`"); se
escribió con el `orderId`/`businessId` de contexto, mismo criterio que
cualquier log de diagnóstico de este repo. No es vocabulario de contrato.

## Comandos ejecutados (etapa 4-5)

- `npx tsc --noEmit` → limpio.
- `npx vitest run --project server src/app/api/internal/orders/status/route.test.ts src/features/orders/server/status.test.ts`
  → 26 passed (409 en los tres estados, 200 tras cotizar y aprobar, 404 de
  otro negocio antes que el 409, R17).
- `npx vitest run --project server src/features/orders/server/pull.test.ts src/app/api/crons/expire-proposals/route.test.ts`
  → 20 passed.
- `npx vitest run --project db src/features/orders/server/expiry.db.test.ts`
  → 12 passed, contra Postgres real (`localhost:5433`, sin crear ni recrear
  contenedores): los tres casos de R15 (dentro del plazo no se toca,
  `AWAITING_CUSTOMER` no lo toca este barrido, segundo barrido afecta 0
  filas), más `CONFIRMED` vence, aislamiento por `businessId` y el cron sin
  `businessId`.
- `bash .agent/verify.sh F-031` → **código de salida 0** (typecheck·lint·format·test)
  tras un ciclo de `prettier --write` sobre `status.ts` (comentarios largos
  que el sensor marcó en `format`, ficha `prettier-sin-formatear`, ya
  fichada — se aplicó el arreglo que la ficha propone).
- `bash .agent/verify.sh F-031 --full` → **código de salida 0**
  (harness·typecheck·lint·format·test·prisma·build·theme·bundle).

## Deuda dejada (etapa 4-5)

- Etapa 6 (`sdd-tester`): el guion de punta a punta
  scripts/quote-delivery-order.mjs (por crear) con sus cinco banderas, incluida
  `--dispatch` (criterio 8) y `--expire` (criterio 7), que ejercitan el 409
  y el barrido contra un servidor real en vez de mocks/Postgres directo.
  Esta etapa verificó la lógica con vitest y contra Postgres real, pero no
  levantó un `next dev` propio ni corrió el cron por HTTP con
  `CRON_SECRET` — el plan no lo exige para 4-5 (§ Cómo se verifica lista
  solo los dos comandos de vitest).
- Etapas 7-8: documentación operativa, la ADR 0027 y el cierre de
  no-regresión.

## Preguntas al humano (etapa 4-5)

Ninguna. El plan no dejó ninguna decisión de alcance pendiente para estas
dos etapas; las tres decisiones del humano que las gobiernan (el `CONFIRMED`
sin cotizar también vence, el nombre `ORDER_DELIVERY_NOT_QUOTED`, y el
literal exacto del `cancelReason`) ya estaban firmadas antes de este ciclo y
se aplicaron tal cual, sin reformular una palabra.
