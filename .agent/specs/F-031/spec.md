---
feature: F-031
agente: sdd-spec
actualizado: 2026-09-01T15:51:23Z
estado: listo
---

## Problema

Hay negocios que solo saben cuánto cuesta el envío **cuando alguien mira el
pedido**: depende de la dirección, del mensajero libre y de la hora. F-019
construyó la vuelta de ese escenario —la tienda propone importes, el comprador
aprueba o rechaza, un reloj lo vence— y su spec declara ese costo de envío como
el disparador **dominante** del bucle (`.agent/specs/F-019/spec.md:10-14`). La
ida lo hace imposible: el domicilio solo se ofrece si ya hay una tarifa fija
guardada (`src/features/orders/server/createOrder.ts:174`,
`src/features/cart/components/CheckoutForm.tsx:420`), y `Order.deliveryFee` es
obligatoria con `@default(0)` (`prisma/schema.prisma:606`), así que un pedido a
la espera de cotización se guarda **como si el envío fuera gratis**.

Hoy esa tienda tiene dos salidas y las dos son malas: inventar una tarifa —el
comprador ve un total que no es el suyo y hay que renegociar **todos** los
pedidos— o dejar la tarifa en `null` y no ofrecer domicilio. Lo único que avisa
de la incertidumbre es una frase de copia (`CheckoutForm.tsx:779-782`): texto,
no dato. En ninguna capa —base, contrato, API, pantalla— existe la forma de
decir «falta un importe»: `grep -rn "por confirmar\|por calcular" src/` no
devuelve nada.

## Alcance

### Dentro

- Un **modo de envío por tienda**: tarifa fija (lo de hoy) o **cotizado al
  gestionar**. Aquí se fija la semántica y el comportamiento; la forma en el
  schema la cierra `sdd-architect`.
- Representar «envío sin cotizar» de forma distinguible de «envío 0.00» en la
  fila del pedido, en el payload del pull y en las **seis** superficies donde
  hoy se imprime un importe de envío o un total (§ Reglas, R2).
- Checkout en modo cotizado: domicilio ofrecido **sin importe**, dirección
  obligatoria como ahora, fila de envío «por confirmar» y total nombrado como
  parcial (decisión SP4).
- `expectedTotal` en modo cotizado: se comprueba contra la parte que sí es
  comprobable —subtotal menos descuento—, nunca contra un envío inexistente.
- Página del pedido, mensaje de WhatsApp y tarjeta de propuesta con el mismo
  lenguaje mientras el envío no esté cotizado.
- Vencimiento del pedido **sin cotizar**, contado desde su creación (SP1).
- `409` al intentar despachar un pedido con el envío sin cotizar (SP2).
- La **v6** de `docs/sync-contract.md`, publicada por este feature solo (OD1),
  y la nota de traspaso para cuadrecaja (OD4).

### Fuera (explícito)

- **Calcular la tarifa.** Ni zonas, ni distancia, ni mapas, ni tabla por
  municipio. El importe lo pone una persona en cuadrecaja.
- **Tocar el bucle de F-019.** Cotizar **es** proponer: se reutiliza
  `POST /api/internal/orders/proposal` tal cual, con su reloj, su idempotencia
  y su atribución de desenlace. `src/features/orders/server/respond.ts` no se
  toca (OD3). Si este feature acaba necesitando un segundo camino para «poner
  el envío», está mal planteado.
- **Cómo se configura el modo (SP3).** No hay pantalla de panel, y el `UPDATE`
  a mano no es el estado final: la configuración de compra tiene que llegar
  desde cuadrecaja por el sync. Eso es **F-032** y su **v7**. Aquí el modo se
  define, se **lee** y se activa por SQL para verificar, igual que hoy se
  activan las otras cuatro columnas (`docs/flujos-cc-qab.html:1203-1213`).
- **Cambiar de dueño `Store.orderExpiryHours`.** La v6 mantiene lo que dice
  hoy `docs/sync-contract.md:766-768` —es de queandabuscando y un evento
  `STORE` no la pisa— y solo documenta que el campo pasa a tener **dos**
  significados. La inversión de propiedad es de F-032 (v7), no de aquí.
- **Reserva de stock**, **pagos en línea** y **notificación automática al
  comprador**: fuera en F-019 (su decisión SP3) y siguen fuera. Solo enlaces
  `wa.me` que abre una persona.
- **Pantalla de panel de pedidos** en queandabuscando: no existe y este
  feature no la crea.

## Actores y precondiciones

El **comprador**, invitado, en `/[slug]/checkout` de una tienda con envío
cotizado (`src/app/[slug]/checkout/page.tsx`). El **encargado**, en cuadrecaja,
que ve el pedido por el pull, decide el importe y lo propone por el API interno.

Precondiciones: la tienda existe, está `PUBLISHED` y toma pedidos (F-010);
tiene envío habilitado en modo cotizado; el pull del negocio funciona (F-007) y
el bucle de renegociación está en pie (F-019, `passes: true`). El comprador dio
nombre, teléfono y dirección.

## Comportamiento esperado

- **E1** — Dada una tienda con envío **cotizado**, cuando el comprador abre el
  checkout, entonces la opción «Envío a domicilio» se ofrece **sin importe**
  (hoy el radio imprime `+ 500,00` desde `CheckoutForm.tsx:742-746`), la fila
  de envío del resumen dice que está por confirmar en vez de una cifra, el
  total se nombra parcial, y el botón de confirmar funciona igual que hoy.
- **E2** — Dado ese checkout con domicilio elegido, cuando el comprador
  confirma, entonces `POST /api/orders` responde `201` y la fila creada queda
  con el envío **sin cotizar** —no con `0`— y con `total` = subtotal menos
  descuento, marcado como parcial. La respuesta no depende de que el cliente
  adivinara ningún envío.
- **E3** — Dado ese pedido, cuando el comprador abre `/[slug]/pedido/[code]`
  antes de que la tienda cotice, entonces ve el envío por confirmar y el total
  parcial, con el mismo lenguaje del checkout, y **ninguna** cifra en firme que
  luego cambie.
- **E4** — Dado ese pedido en el pull, cuando cuadrecaja lo lee, entonces
  distingue «envío sin cotizar» de «envío 0.00» por un campo explícito, **sin
  heurística** (sin mirar `contact.address`, sin comparar `total` con
  `subtotal`).
- **E5** — Dado ese pedido, cuando la tienda propone por
  `POST /api/internal/orders/proposal` con `deliveryFee` concreto y **las
  mismas líneas del pedido** (OD3), entonces pasa a `AWAITING_CUSTOMER` y el
  comprador ve en su página que el envío pasa de «sin cotizar» a la cifra
  propuesta, con el total completo al lado y el total anterior nombrado como
  parcial.
- **E6** — Dado ese `AWAITING_CUSTOMER`, cuando el comprador aprueba, entonces
  el pedido queda `CONFIRMED` con `deliveryFee` y `total` completos y **ya no**
  con el envío pendiente; cuando rechaza, `CANCELLED` con `cancelledBy`
  `CUSTOMER`. Es el bucle de F-019 sin código nuevo.
- **E7** — Dada una tienda con envío de **tarifa fija**, cuando se recorre
  checkout, creación, página, WhatsApp y pull, entonces todo se comporta como
  hoy: mismos importes, misma comprobación de `expectedTotal`, mismas cadenas
  en pantalla. No-regresión.
- **E8** — Dada una tienda con envío cotizado, cuando el comprador elige
  **recoger en la tienda**, entonces el total es firme desde el primer momento
  y el envío vale `0.00` cotizado, no pendiente: lo incierto es el envío, no el
  pedido.
- **E9** — Dado un pedido con el envío sin cotizar que nadie mira, cuando pasan
  `Store.orderExpiryHours` **desde su creación**, entonces el barrido lo deja
  `CANCELLED` con `cancelledBy = EXPIRY` y un `cancelReason` propio —distinto
  del literal de la propuesta vencida
  (`src/constants/orders.ts:79`)— sin que intervenga nadie. Alcanza a los
  estados abiertos `PENDING`, `PULLED` y `CONFIRMED`, y **nunca** a
  `AWAITING_CUSTOMER`, que tiene el reloj de F-019 (R15).
- **E10** — Dado un pedido con el envío sin cotizar, cuando el POS reporta
  `READY`, `IN_TRANSIT` o `DELIVERED` por `POST /api/internal/orders/status`,
  entonces responde `409` con el error nuevo y **no escribe nada**; cuando lo
  reporta después de que el comprador aprobó la cotización, responde `200`.
  `CONFIRMED`, `CANCELLED` y `REJECTED_BY_STORE` siguen aceptándose con el
  envío pendiente.
- **E11** — Dada una tienda que decide **regalar** el envío, cuando cotiza
  `0.00` y el comprador aprueba, entonces el pedido queda con envío `0.00`
  cotizado, distinguible de «sin cotizar» en la base, en el pull y en pantalla,
  y en ninguna superficie vuelve a decir «por confirmar».
- **E12** — Dada una propuesta que **solo** toca el envío, cuando el POS la
  manda reenviando las mismas líneas del pedido, entonces responde `200`:
  `proposeOrderChangeSchema` sigue exigiendo `items` con `min(1)`
  (`src/features/orders/schemas.ts:150`) y aprobar borra e inserta líneas
  idénticas. No se relaja el schema ni se toca `respond.ts` (OD3).
- **E13** — Dado un pedido con envío sin cotizar en una tienda
  `checkoutMode = WHATSAPP`, cuando el comprador abre el enlace `wa.me`,
  entonces el mensaje dice el envío por confirmar y el total parcial, y **no**
  imprime `0,00` ni en la línea de envío ni en el total
  (`src/features/orders/whatsapp.ts:53-54,70`).
- **E14** — Dada una tienda que cambia de modo con pedidos vivos, cuando se
  leen esos pedidos, entonces conservan lo que tenían: el modo se aplica **al
  crear**, nunca al leer. Un pedido creado antes de este feature se lee como
  cotizado, con su `deliveryFee` valiendo cero de verdad.

## Reglas de negocio

- **R1** — «Sin cotizar» y «cero» **nunca** se confunden: ni en la base, ni en
  el pull, ni en pantalla, ni en el mensaje de WhatsApp. Un envío regalado es
  `0.00`; uno sin cotizar es ausencia de importe. Hoy los dos son `0`.
- **R2** — Un total con el envío sin cotizar es **parcial** y se nombra como
  tal en **las seis** superficies donde hoy aparece un importe de envío o un
  total: el resumen del checkout
  (`src/features/cart/components/OrderSummary.tsx:45-60`), la tabla del pedido
  (`src/features/orders/components/OrderLinesTable.tsx:55-68`), el mensaje de
  WhatsApp (`src/features/orders/whatsapp.ts:53-54,70`), el payload del pull
  (`src/features/orders/server/pull.ts:213-216`), el diff de la propuesta
  (`src/features/orders/proposalDiff.ts:81-86`, que hoy diría «Envío: antes sin
  costo») y la tarjeta de la propuesta
  (`src/features/orders/components/OrderProposalCard.tsx:121`, que hoy diría
  «Total actual» de un total que es parcial). La propuesta original solo
  contaba cuatro (§ Incongruencias, I3).
- **R3** — Nadie calcula la tarifa. La pone una persona y, hasta que la pone,
  el importe **no existe**: no es 0, no es un estimado, no es un rango.
- **R4** — Cotizar es proponer: un solo bucle, el de F-019, un solo endpoint.
  No hay ruta nueva para «poner el envío» ni un segundo camino de escritura.
- **R5** — El modo lo decide la **tienda**, no el comprador ni la dirección ni
  la modalidad de entrega (decisión SP5).
- **R6** — El modo de tarifa fija se comporta como hoy, bit a bit, y es el
  **default** de toda tienda ya publicada: la migración no cambia el
  comportamiento de ninguna.
- **R7** — La comprobación de precio no se elimina. `expectedTotal` sigue
  siendo obligatorio en el cuerpo (`src/features/orders/schemas.ts:103`) y en
  modo cotizado se compara contra `subtotal - discountTotal`, que sí son
  conocidos. Quitarla reabriría lo que cierra `createOrder.ts:189`.
- **R8** — El modo se **lee** aquí y se **escribe** en F-032, desde cuadrecaja
  por el sync (decisión SP3). Para verificar F-031 se activa por SQL, como se
  activan hoy las otras cuatro columnas de compra.
- **R9** — La invariante `total = subtotal - discountTotal + deliveryFee` sigue
  siendo cierta **en cuanto hay cotización**. Mientras no la haya,
  `total = subtotal - discountTotal` y es parcial; el contrato tiene que
  decirlo con esas palabras (§ Datos y contrato).
- **R10** — `rateSnapshot` se congela al crear el pedido y no se recalcula al
  cotizar ni al aprobar. Es criterio 6 de este feature y ya lo era de F-019
  (`.agent/specs/F-019/spec.md:226`); aquí no se relaja.
- **R11 (OD1)** — La **v6** de `docs/sync-contract.md` la publica F-031 sola,
  sin esperar a F-032, y dentro del mismo documento le anuncia a cuadrecaja que
  viene una **v7** con las cinco columnas de configuración de compra. Se
  descartó a propósito una v6 única que cubriera los dos features: retrasaba el
  arranque de cuadrecaja en la parte de pedidos, que es la que más código le
  cambia. Es cambio **mayor** (`5.1` → `6`), coordinado antes con el otro
  equipo, con su § «Cambios respecto a la v5.1» y con la primera línea movida
  (AGENTS.md § Documentación).
- **R12 (OD2)** — La v6 se escribe **en cuanto cierre la arquitectura**:
  `sdd-architect` fija la forma en el cable y el documento se redacta acto
  seguido, **antes de implementar nada**, para que cuadrecaja arranque con
  ventaja. Riesgo aceptado por el humano: si la implementación descubre que la
  forma no aguanta, se corrige con una v6.1 y se avisa otra vez.
- **R13 (OD3)** — `proposeOrderChangeSchema` no se toca: `items` sigue con
  `min(1)`. Cuadrecaja **reenvía las mismas líneas del pedido** para cotizar
  solo el envío, y la v6 lo dice **explícitamente**, para que no lo descubran
  por un `400`. Ni `respond.ts` ni el bucle de F-019 cambian.
- **R14 (OD4)** — Además de la v6 hay una **nota de traspaso** corta y
  autocontenida para cuadrecaja: docs/traspaso-cuadrecaja-envio-cotizado.md
  (por crear). Contiene lo que el otro equipo tiene que implementar de F-031
  —leer el envío sin cotizar, manejar el `409` nuevo al despachar, cotizar por
  el endpoint de propuesta reenviando las líneas— y el aviso de la v7. Vive en
  `docs/` porque es donde están los documentos que cruzan los dos equipos, se
  nombra por el feature y no por el ID (cuadrecaja no lleva nuestros ID), y la
  v6 la enlaza desde su § «Cambios requeridos en cuadrecaja». Se escribe junto
  con la v6 (R12), no en este ciclo.
- **R15** — Los **dos relojes no se pisan**. El de F-019 sigue con su condición
  exacta (`status = 'AWAITING_CUSTOMER' AND "expiresAt" < now()`,
  `src/features/orders/server/expiry.ts:31-33`); el nuevo cuenta desde
  `createdAt` y **excluye** `AWAITING_CUSTOMER`. Un pedido cotizado y a la
  espera de respuesta puede llegar a vivir hasta ~2 × `orderExpiryHours` entre
  los dos plazos: es correcto y va documentado en la v6, porque es la
  consecuencia del doble significado del campo.
- **R16** — El barrido nuevo es **una** sentencia `UPDATE` idempotente por
  construcción, sin `$transaction` interactivo: el pooler de Supabase corre en
  modo transacción (AGENTS.md § «Cosas que muerden») y `pull.ts` necesita poder
  entregarlo en forma de array como ya hace con el de F-019
  (`src/features/orders/server/pull.ts:104-106`).
- **R17** — El `409` nuevo no convierte a `/orders/status` en un oráculo de
  existencia entre negocios: un `orderId` de otro negocio sigue respondiendo
  `404 UNKNOWN_ORDER`, igual que hoy (`docs/sync-contract.md:597-602`).
  Primero el aislamiento por negocio, después la guarda de cotización.
- **R18** — El cambio en el cable es **aditivo** (criterio 11): `deliveryFee`
  sigue siendo un **string decimal presente siempre** en cada pedido del pull,
  también en uno sin cotizar, donde vale `"0.00"`; lo que dice «sin cotizar» es
  un campo **nuevo**. Un consumidor de la v5 que hace
  `parseFloat(order.deliveryFee)` no revienta y ve exactamente lo que ve hoy.
  La forma **en la base** sigue siendo libre (`sdd-architect`): esta regla ata
  el cable, no la columna.
- **R19** — «Sin cotizar» se lee del dato persistido, **nunca** se infiere.
  `read.ts:171` deriva `fulfillment` de `deliveryAddress`, y `pull.ts` no envía
  la modalidad: un lector que dedujera «pendiente» de «tiene dirección y el
  envío es 0» acertaría hoy y fallaría con el primer envío regalado.
- **R20** — El domicilio se ofrece cuando `deliveryEnabled` es cierto **y** el
  modo tiene con qué cerrarlo: tarifa fija con importe, o cotizado. Con
  `deliveryEnabled` falso no se ofrece, y pedir `DELIVERY` se sigue degradando
  a retiro en silencio (R3 de F-010, `createOrder.ts:172-179`). El modo viaja
  **explícito** en la respuesta de `POST /api/orders/quote`
  (`src/features/orders/types.ts:17-24`): la isla de checkout no vuelve a
  deducir nada de `deliveryFee === null`, que hoy significa «no hay envío».

## Casos límite y errores

- **Envío regalado.** La tienda cotiza `0.00`, el comprador aprueba: el pedido
  queda con envío cero **cotizado** (E11). Es el caso que rompe cualquier
  heurística y por eso es el par de prueba del criterio 4.
- **Propuesta que solo toca el envío.** Resuelto por OD3: se reenvían las
  líneas, `200`, sin cambio de schema (E12, R13).
- **Nadie cotiza nunca.** Resuelto por SP1: vence contado desde la creación
  (E9). Incluye el pedido que el POS **confirmó** sin cotizar: el `409` de E10
  ya le impide despacharlo, así que sin este barrido quedaría vivo para siempre
  con un total que nunca se cierra. Decidido aquí, no preguntado: el reloj
  vigila **el envío sin cotizar**, no el estado.
- **La tienda salta la cotización.** Resuelto por SP2: `409` (E10). Lo que
  **sí** sigue permitido con el envío pendiente es `CONFIRMED` —aceptar el
  pedido y cotizar después— y los dos cierres, `CANCELLED` y
  `REJECTED_BY_STORE`: cancelar no cobra nada.
- **Cambio de modo con pedidos vivos.** Los ya creados conservan lo que tenían
  (E14). El modo se lee al crear.
- **Modo cotizado con una `deliveryFee` residual en la fila de la tienda.**
  Manda el **modo** y la tarifa se ignora. Decidido aquí; F-032 (su criterio 5)
  rechazará la combinación contradictoria en la puerta del sync, pero mientras
  se active por SQL puede existir y no puede quedar sin respuesta definida.
- **`DELIVERY` pedido a una tienda sin envío.** Se sigue degradando a retiro,
  sin error nuevo (R20).
- **Pedido anterior a este feature.** La migración es aditiva y su default deja
  toda fila existente como **cotizada**: `deliveryFee = 0.00` en un pedido
  viejo significa cero de verdad. Ninguna tienda publicada cambia de
  comportamiento (R6).
- **Concurrencia y reintentos.** Sin cambios: `idempotencyKey`
  (`prisma/schema.prisma:581`) y el techo de pedidos `PENDING` por teléfono
  siguen igual. Un reintento del mismo checkout devuelve `200` idempotente con
  el **mismo** pedido sin cotizar, no uno nuevo.
- **Segunda propuesta sobre un pedido sin cotizar.** Reemplaza a la primera y
  reinicia el plazo (E13 de F-019). El reloj de la creación no se reinicia con
  ella, y no hace falta: mientras el pedido está en `AWAITING_CUSTOMER` el
  barrido nuevo no lo mira (R15).
- **El pull vuelve a entregar el mismo pedido.** La marca de «sin cotizar» es
  estable entre pulls: se deriva de la fila, no del momento de la lectura.
- **Rechazo de la cotización.** El pedido muere `CANCELLED`/`CUSTOMER` con el
  envío nunca cotizado. Es un desenlace legítimo, no un estado a medias: el
  `409` de E10 garantiza que nadie lo despachó antes.
- **Teléfono sin dígitos utilizables.** Igual que en F-019: el `wa.me` sale
  `null` con su razón y el reloj sigue corriendo (R13 de F-019).

## Datos y contrato

### En la base

Dos cosas nuevas, las dos de `sdd-architect`: un **modo de envío** en `Store`
—junto a `checkoutMode` (`prisma/schema.prisma:252`), `deliveryEnabled` (253),
`deliveryFee` (254, `Decimal?`) y `orderExpiryHours` (255-258)— y la forma de
decir «sin cotizar» en `Order`, donde `deliveryFee` es hoy
`Decimal @default(0)` no anulable (`prisma/schema.prisma:606`).

Volverla anulable cambia el tipo que ya consumen `pull.ts:52,66` y
`read.ts:177`; una marca explícita junto al `0.00` no toca a ningún consumidor.
Las dos formas satisfacen R1 en la base; solo una satisface R18 **en el cable
sin trabajo extra**, y el cable es lo que mide el criterio 11. Importes en
`Decimal(14, 2)` y en la moneda del pedido, como siempre. Sin campos nuevos en
el endpoint de propuesta: `deliveryFee` ya viaja ahí
(`src/app/api/internal/orders/proposal/route.ts`).

### Lo que tiene que decir la v6 de `docs/sync-contract.md`

Esta es la lista completa y el único sitio donde vive. `sdd-architect` decide la
forma —nombres de campo, tipos, si el modo es `Boolean` o enum—; esto fija la
**semántica** y qué frases de la v5.1 dejan de ser ciertas.

En **§ ③④ Pedidos**:

1. **El envío sin cotizar existe.** Un pedido puede llegar con el importe del
   envío todavía por decidir. Se distingue con un campo explícito; `deliveryFee`
   sigue presente y vale `"0.00"` en ese caso (R18). El POS **no** puede tratar
   ese `0.00` como «envío gratis»: es la trampa central de esta versión y va
   dicha con esas palabras.
2. **`total` es parcial mientras el envío no esté cotizado**, y vale
   `subtotal - discountTotal` (R9). La igualdad
   `total = subtotal - discountTotal + deliveryFee` vuelve a cerrarse en cuanto
   hay cotización.
3. **Cotizar es proponer.** El camino es `POST /api/internal/orders/proposal`,
   el que ya existe, con `deliveryFee` concreto. Y **explícito** (OD3): `items`
   es obligatorio con al menos una línea, así que para cotizar **solo** el
   envío se reenvían **las mismas líneas del pedido** —las que el pull acaba de
   entregar—; una propuesta sin líneas responde `400`.
4. **El doble significado de `Store.orderExpiryHours`** (SP1): además de
   cuántas horas dura una propuesta, ahora es cuántas horas vive un pedido cuyo
   envío nadie cotizó, contadas **desde su creación**. Los dos plazos son
   independientes y pueden sumarse (R15). El campo **sigue siendo de
   queandabuscando** en la v6.
5. **Qué le pasa al pedido que nadie cotiza**: `CANCELLED` con
   `cancelledBy = "EXPIRY"` y un `cancelReason` propio, distinto del literal de
   la propuesta vencida.
6. **El aviso de la v7** (OD1): vienen las cinco columnas de configuración de
   compra —`checkoutMode`, `deliveryEnabled`, `deliveryFee`,
   `orderExpiryHours` y el modo de envío— en el `payload` de `STORE`, y con
   ellas `orderExpiryHours` cambia de dueño. Se anuncia aquí para que no sean
   dos sorpresas.
7. **El enlace a la nota de traspaso** (R14), desde § «Cambios requeridos en
   cuadrecaja», que además lista las tres cosas que el otro equipo implementa.

En **§ Vocabulario de errores**: una fila nueva, `409`, para
`POST /api/internal/orders/status` cuando el destino es `READY`, `IN_TRANSIT` o
`DELIVERED` y el envío sigue sin cotizar. Nombre propuesto y fijado aquí porque
es vocabulario de contrato: `ORDER_DELIVERY_NOT_QUOTED`, cuerpo
`{"error":"ORDER_DELIVERY_NOT_QUOTED"}`, nada escrito. `sdd-architect` solo lo
renombra si colisiona con algo, no por gusto. La fila dice también qué **no**
cambia: `CONFIRMED`, `CANCELLED` y `REJECTED_BY_STORE` siguen aceptándose, y un
pedido de otro negocio sigue dando `404` (R17).

En **§ Modos de falla**: un POS que ignore el `409` deja sus pedidos atascados
sin ningún error visible en su lado hasta que cotice; un POS que lea el `0.00`
de un envío sin cotizar como «gratis» cobra de menos. Las dos filas nombran la
recuperación.

En **§ Verificación**: los comandos del guion nuevo de este feature
(§ Criterios de aceptación).

### Las frases de la v5.1 que dejan de ser ciertas

Verificadas hoy sobre `docs/sync-contract.md` en **v5.1**, línea a línea (la
propuesta citaba otras y ya no valen: § Incongruencias, I2):

| Línea     | Lo que dice hoy                                                                                     | Qué le pasa                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `604-606` | `deliveryFee` y `total` «siguen siendo exactamente lo que eran», importes en la moneda del pedido   | Sigue siendo cierto para el tipo, deja de serlo para el significado: un `0.00` puede querer decir «sin cotizar»                              |
| `621`     | `"deliveryFee": "0.00"` en el único ejemplo completo del pull                                       | Es exactamente el cero ambiguo. La v6 necesita un segundo ejemplo con el envío sin cotizar                                                   |
| `661-662` | `subtotal`/`total` «siguen siendo la suma de los `lineTotal` ya convertidos»                        | Con el envío sin cotizar, `total` es parcial y hay que decirlo donde se dice esto                                                            |
| `708-709` | para `cancelledBy = "EXPIRY"`, `cancelReason` trae «literal» un solo texto                          | Deja de ser el único: el pedido sin cotizar vence con su propio motivo                                                                       |
| `726-727` | el cuerpo de la propuesta, con `deliveryFee` y la suma cerrada                                      | Sigue vigente. Le falta la nota de OD3 sobre reenviar las líneas                                                                             |
| `766-768` | `orderExpiryHours` es «cuántas horas dura una propuesta», de queandabuscando                        | La propiedad no cambia en la v6; el significado se duplica                                                                                   |
| `789-791` | «Sin guardas de transición: el POS es la autoridad y puede reportar cualquiera de los seis valores» | **Deja de ser cierta.** El `409` es la primera guarda, y la v6 tiene que retractarla igual que la v5 retractó la línea de los cuatro estados |

## Criterios de aceptación propuestos

Los doce son los de `.agent/features.json`, **literales**: `[ya]` todos, y por
la regla 3 no se reescriben ni se renumeran. Lo que añade esta sección es con
qué se verifica cada uno.

El guion de punta a punta es scripts/quote-delivery-order.mjs (por crear), misma
forma que `scripts/renegotiate-order.mjs`: acuña su propio token para
`seed-negocio-1`, activa el modo cotizado por SQL sobre `tienda-demo` —que es
`WHATSAPP` y hoy no ofrece envío (`prisma/seed.ts:369-371`), así que sirve para
los criterios 1-8 y para el 10—, siembra sus propios pedidos por el checkout
público y restaura la fila de la tienda al terminar.

1. **`[ya]`** — «En una tienda con envio cotizado, el HTML del checkout ofrece
   la opcion de domicilio sin ningun importe de envio y sin ningun total en
   firme para esa modalidad.»
   → `npx vitest run --project ui src/features/cart/components/CheckoutForm.test.tsx`
   con casos nuevos sobre un `quote` en modo cotizado: existe el radio de
   domicilio, su descripción **no** contiene ningún dígito, la fila de envío
   del resumen no es una cifra, y el total aparece nombrado como parcial. El
   checkout es una isla de cliente (`src/app/[slug]/checkout/page.tsx` no
   manda importes, `CheckoutForm.tsx` los pide a `POST /api/orders/quote`), así
   que «el HTML» se lee en el **DOM renderizado** y no con `curl | grep`
   (§ Incongruencias, I10b). Un paso equivalente en .agent/specs/F-031/visual.mjs
   (por crear) lo repite sobre el navegador real si `sdd-tester` decide que hace
   falta.
2. **`[ya]`** — «POST /api/orders con fulfillment DELIVERY contra esa tienda
   responde con exito sin que el cliente mande importe de envio, y una consulta
   SQL a la fila creada distingue 'envio pendiente' de '0.00'.»
   → `node scripts/quote-delivery-order.mjs --create`: postea con
   `expectedTotal = subtotal - discountTotal` y sin ningún importe de envío,
   exige `201` con `code`, y después `SELECT` de las columnas de envío de esa
   fila **y** de la de un pedido con envío `0.00` del mismo negocio, exigiendo
   que se distingan por un valor, no por interpretación.
3. **`[ya]`** — «GET /[slug]/pedido/[code] de ese pedido muestra el envio por
   confirmar y un total parcial, y ninguna de las dos cadenas es '0,00'.»
   → la página es un componente de servidor, así que basta
   `curl -s "$BASE/tienda-demo/pedido/$CODE"`: exige la etiqueta de envío por
   confirmar, exige la palabra del total parcial y exige
   `grep -c '0,00'` **igual a 0** sobre la respuesta. Va dentro de `--create`.
4. **`[ya]`** — «GET /api/internal/orders devuelve en la MISMA respuesta un
   pedido con envio pendiente y otro con envio 0.00, distinguibles sin
   heuristica.»
   → `node scripts/quote-delivery-order.mjs --pull`: crea **dos** pedidos a
   domicilio en la misma tienda, cotiza uno en `"0.00"` y lo aprueba, deja el
   otro sin cotizar, pullea con el bearer del negocio y exige que los dos
   vengan en la misma respuesta, que el campo explícito los separe y que
   `deliveryFee` sea `"0.00"` en **los dos** —que es lo que hace la
   distinción imposible por heurística y obligatoria por campo.
5. **`[ya]`** — «POST /api/internal/orders/proposal con el envio ya cotizado
   deja el pedido en AWAITING_CUSTOMER, y aprobar desde la pagina lo deja en
   CONFIRMED con el total completo.»
   → `node scripts/quote-delivery-order.mjs --quote`: propone reenviando las
   líneas del pedido (R13) con `deliveryFee` concreto, exige `200` y
   `status: "AWAITING_CUSTOMER"`; después `POST` a
   `/[slug]/pedido/[code]/respuesta` con `decision=approve` y exige `CONFIRMED`
   con `deliveryFee` y `total` completos, leídos de la base **y** del pull, y
   con el pedido ya sin marca de pendiente.
6. **`[ya]`** — «rateSnapshot no cambia entre la creacion del pedido y la
   aprobacion de la cotizacion.»
   → dentro de `--quote`: `SELECT "rateSnapshot" FROM "Order"` antes de
   proponer y después de aprobar, comparados como JSON canónico; idénticos byte
   a byte, incluido `capturedAt`. Es el mismo aserto que el criterio 6 de
   F-019.
7. **`[ya]`** — «Un pedido con envio pendiente que supera orderExpiryHours
   contados desde su CREACION cambia de estado sin intervencion de nadie,
   verificado forzando la fecha y no esperando.»
   → dos comprobaciones, ninguna con espera:
   (a) `node scripts/quote-delivery-order.mjs --expire`, que hace
   `UPDATE "Order" SET "createdAt" = now() - interval '48 hours'` sobre el
   pedido que acaba de crear, llama al cron con
   `curl -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/crons/expire-proposals"`
   y exige `CANCELLED`, `cancelledBy = EXPIRY` y el motivo propio del pedido sin
   cotizar;
   (b) `npx vitest run --project db src/features/orders/server/expiry.db.test.ts`
   con casos nuevos contra Postgres real: un pedido sin cotizar **dentro** del
   plazo no se toca, uno en `AWAITING_CUSTOMER` **no** lo toca este barrido
   (R15), y un segundo barrido afecta 0 filas.
8. **`[ya]`** — «POST /api/internal/orders/status responde 409 al llevar a
   READY, IN_TRANSIT o DELIVERED un pedido con el envio todavia pendiente, y
   responde 200 sobre ese mismo pedido una vez cotizado y aprobado.»
   → `node scripts/quote-delivery-order.mjs --dispatch`: los tres estados
   contra el pedido sin cotizar, `409` con
   `{"error":"ORDER_DELIVERY_NOT_QUOTED"}` en los tres y la fila **sin tocar**
   después de cada uno; luego cotiza, aprueba y repite `READY`, exigiendo
   `200`. Más `npx vitest run --project server src/app/api/internal/orders/status/route.test.ts`
   con el caso del `409` y el de que un pedido de otro negocio sigue dando
   `404` (R17).
9. **`[ya]`** — «Una tienda con tarifa fija recorre checkout, creacion y pull
   con los mismos importes que hoy: 'bash .agent/verify.sh F-010 --visual'
   termina en 0 y scripts/place-order.mjs sigue pasando, ninguno de los dos
   tocado.»
   → `bash .agent/verify.sh F-010 --visual` (código de salida 0),
   `node scripts/place-order.mjs --store=tienda-dos --delivery` (la tienda de
   tarifa fija del seed, `prisma/seed.ts:395-397`), y
   `git diff --name-only main -- scripts/place-order.mjs .agent/specs/F-010/visual.mjs`
   **sin salida**, que es lo que prueba el «ninguno de los dos tocado».
10. **`[ya]`** — «El mensaje de WhatsApp de un pedido con envio pendiente no
    imprime '0,00' ni en la linea de envio ni en el total.»
    → `npx vitest run --project server src/features/orders/whatsapp.test.ts`
    con un caso de envío sin cotizar: la línea de envío y la del total no
    contienen `0,00`. Y en `--create`, sobre `tienda-demo` que es `WHATSAPP`:
    extraer el `href` de `wa.me` del HTML de la página, decodificar el `text` y
    exigir `grep -c '0,00'` igual a 0 más la presencia de la etiqueta de
    pendiente. Sin la activación por SQL este criterio no se puede verificar
    con el seed tal cual (§ Incongruencias, I9).
11. **`[ya]`** — «docs/sync-contract.md documenta el envio sin cotizar en una
    version nueva, y el cambio es aditivo: un consumidor de la version anterior
    sigue leyendo el payload del pull sin romperse.»
    → tres comprobaciones:
    (a) `grep -n 'Versión 6' docs/sync-contract.md` con salida no vacía y
    `grep -c 'v7' docs/sync-contract.md` ≥ 1 (el aviso de OD1);
    (b) `npx vitest run --project server src/features/orders/server/pull.test.ts`
    con un caso que exige, sobre un pedido sin cotizar, que **todas** las claves
    de la v5 sigan presentes y que `deliveryFee` siga siendo un string decimal
    (R18);
    (c) `node scripts/pull-orders.mjs --paginate` terminando bien: el consumidor
    que ya existía sigue leyendo el payload.
12. **`[ya]`** — «'bash .agent/verify.sh F-031 --full' termina con codigo 0.»
    → `bash .agent/verify.sh F-031 --full; echo $?` → `0`. Cubre
    `check:harness`, typecheck, lint, `format:check`, `npm test` (los tres
    proyectos, incluido `db`), `prisma validate`, build, tema y bundle. Ojo:
    `--full` **no** incluye `smoke` ni `visual` (`.agent/verify.sh`), así que
    el criterio 9 se ejecuta aparte.

## Incongruencias detectadas

- **I1** — `.agent/specs/F-019/spec.md:10-14` declara el costo de envío fijado
  al gestionar como el disparador **dominante** del bucle, pero
  `createOrder.ts:174` y `CheckoutForm.tsx:420` hacen imposible pedir a
  domicilio sin una tarifa fija previa. La spec de F-019 y el checkout de F-010
  se contradicen desde el día en que se escribieron; F-031 existe para cerrar
  esa grieta, no para tapar ninguna de las dos.
- **I2** — Las citas al contrato de la propuesta **ya no apuntan a nada**:
  `docs/sync-contract.md:572` es una línea en blanco, `:667` es el encabezado
  «### La renegociación (v5, F-019)» y `:694-695` son el `proposedAt`/
  `expiresAt` del ejemplo de propuesta. El documento se movió al publicar la
  v5.1, que añadió dos aclaraciones aditivas (§ 793 y § 901). Las líneas de
  verdad son las de la tabla de § Datos y contrato. Las `notes` de F-031 en
  `.agent/features.json` arrastran las mismas citas viejas; son del humano y no
  se tocan (regla 3), queda anotado aquí.
- **I3** — La propuesta cuenta **cuatro** superficies donde se imprime un
  total; hay **seis**. Le faltan `src/features/orders/proposalDiff.ts:81-86`,
  que con un envío sin cotizar diría «Envío: antes **sin costo**, ahora
  180,00» —una afirmación falsa, no solo pobre—, y
  `src/features/orders/components/OrderProposalCard.tsx:121`, que llama «Total
  actual» a un total que es parcial.
- **I4** — `src/features/orders/components/OrderLinesTable.tsx:32-33` calcula
  `hasDeliveryFee = !isZero(...)` y **oculta la fila** cuando el envío vale
  cero: un pedido sin cotizar se renderizaría sin línea de envío, indistinguible
  de un retiro en tienda. Su simétrico está en el checkout:
  `CheckoutForm.tsx:815-821` pasa `formatMoney(money("0"))` cuando la tienda
  ofrece envío y el comprador eligió retiro, así que hoy la pantalla ya imprime
  «Envío 0,00» con el sentido de «gratis». Ninguno de los dos sirve para «sin
  cotizar» y los dos tienen que cambiar.
- **I5** — `docs/sync-contract.md:789-791` afirma que **no** hay guardas de
  transición en `/orders/status` y que el POS «puede reportar cualquiera de los
  seis valores». El criterio 8 introduce la primera guarda. La v6 tiene que
  retractar esa frase explícitamente, con el mismo estilo con que la v5
  retractó la línea de los cuatro estados.
- **I6** — `src/features/orders/server/read.ts:171` deriva `fulfillment` de
  `deliveryAddress`, y el payload del pull no lleva modalidad. No hay que
  cambiarlo, pero explica por qué R19 prohíbe inferir «sin cotizar»: la
  inferencia funcionaría hasta el primer envío regalado.
- **I7** — `src/constants/orders.ts:79` define un único motivo de vencimiento
  («La propuesta venció sin respuesta») y `docs/sync-contract.md:708-709` lo
  documenta como **literal**. El vencimiento del pedido sin cotizar necesita su
  propio motivo, o el comprador leería que venció una propuesta que nunca
  existió.
- **I8** — `prisma/seed.ts` no tiene **ninguna** tienda que combine
  `checkoutMode = WHATSAPP` con envío: `tienda-demo` es `WHATSAPP` sin envío
  (369-371) y `tienda-dos` es `ONSITE` con tarifa fija (395-397). El criterio
  10 no es verificable sobre el seed tal cual: hay que activar el modo por SQL
  sobre `tienda-demo`, que es justo la activación que prescriben las `notes`
  del feature.
- **I9** — `docs/flujos-cc-qab.html:1203-1213` ya documenta que las cuatro
  columnas de compra solo las escribe el seed y que cambiarlas exige un
  `UPDATE` a mano. Este feature añade la quinta, y la decisión SP3 manda que
  las cinco pasen a llegar de cuadrecaja: eso **invierte** lo que hoy dicen
  `prisma/schema.prisma:255-258` y `docs/sync-contract.md:766-768` sobre
  `orderExpiryHours`. Lo cierra F-032 con su ADR y su v7; la v6 de aquí **no**
  mueve la propiedad, solo el significado (R8, § Alcance/Fuera).
- **I10** — Dos lecturas literales de los criterios que conviene fijar antes de
  implementar, porque cada una se puede entender al revés:
  (a) «sin que el cliente mande importe de envio» (criterio 2) **no** significa
  quitar `expectedTotal`, que es obligatorio en
  `src/features/orders/schemas.ts:103`: significa que ese número deja de
  incluir un envío que no existe (R7);
  (b) «el HTML del checkout» (criterio 1) es el DOM renderizado, no la
  respuesta de `GET /[slug]/checkout`: esa ruta no manda ningún importe, los
  pide la isla a `POST /api/orders/quote`.

## Huecos y preguntas al humano

**Ninguna.** SP1-SP5 quedaron respondidas antes de abrir el feature y OD1-OD4
cerraron el empaquetado del contrato, su calendario, el caso solo-envío y el
entregable para cuadrecaja. Esto es información, no un hueco: no hay `SP6`.

Tres cosas que podrían haber sido `SP6`-`SP8` las decidí yo, con criterio y
escritas donde se aplican. Si el humano discrepa de alguna, cada una es una
línea:

- **El pedido `CONFIRMED` sin cotizar también vence** (§ Casos límite, E9). El
  `409` le impide avanzar, así que sin barrido quedaría vivo para siempre — que
  es exactamente lo que SP1 vino a evitar. La alternativa era barrer solo
  `PENDING` y `PULLED`.
- **Con modo cotizado y una `deliveryFee` residual, manda el modo** y la tarifa
  se ignora (§ Casos límite). La alternativa era que mandara la tarifa, lo que
  volvería invisible el modo recién activado.
- **El `409` se llama `ORDER_DELIVERY_NOT_QUOTED`** (§ Datos y contrato). Es
  vocabulario de contrato, así que dejarlo abierto retrasaría la v6, que por
  OD2 se escribe antes de implementar.

## No decidido a propósito

- **La forma de «sin cotizar» en el schema** —`Order.deliveryFee` anulable
  frente a una marca explícita junto al `0.00`— y **si el modo de envío es
  `Boolean` o enum** con sitio para modos futuros. Lo cierra `sdd-architect`,
  atado por R1 (en la base) y R18 (en el cable). Esa decisión destraba además
  la `SP2` de F-032.
- **Dónde vive el barrido nuevo**: una segunda consulta exportada desde
  `src/features/orders/server/expiry.ts` o un módulo propio, y si `pull.ts` la
  mete en el mismo `$transaction` de array que ya usa. `sdd-architect`, dentro
  de R15 y R16.
- **La copia exacta de las superficies** —las palabras de «por confirmar», de
  «total parcial», del mensaje de WhatsApp y del diff de la propuesta— la cierra
  `sdd-designer` dentro de la forma que fijó SP4: el comprador ve el total
  parcial **siempre** acompañado de «más envío por confirmar», nunca una cifra
  sola.
- **Si este feature necesita guion visual propio** (.agent/specs/F-031/visual.mjs,
  por crear) o le basta el test de la isla en `jsdom`. Lo decide `sdd-tester`:
  el criterio 12 no lo exige, el criterio 1 sí exige DOM renderizado.
- **Si el cambio merece una ADR.** No está entre los doce criterios y F-032 ya
  se lleva la ADR de la propiedad de la configuración; si `sdd-architect` ve una
  decisión estructural propia aquí, la propone en `architecture.md`.
