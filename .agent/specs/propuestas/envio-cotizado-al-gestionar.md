---
propuesta: envio-cotizado-al-gestionar
agente: sdd-spec
actualizado: 2026-09-01T00:00:00Z
estado: propuesta
---

> Origen: pregunta del humano del 2026-09-01 — «el comprador hace el pedido y no
> sabe el total porque el domicilio tiene un costo que se decide al gestionarlo;
> ¿el diseño actual está pensado para ese escenario?». La vuelta sí (F-019); la
> ida no.
>
> **Aceptada el 2026-09-01**: es **F-031** en `.agent/features.json`. Las cinco
> decisiones del humano están al pie, en «Decisiones del humano», y una de ellas
> (SP3) cambió el fondo de la propuesta: la configuración no la pone el panel ni
> un `UPDATE` a mano, tiene que llegar **desde cuadrecaja**.

## Problema

F-019 construyó la mitad de atrás de ese escenario y funciona: la tienda propone
importes nuevos, el pedido queda en `AWAITING_CUSTOMER` con el total anterior y
el propuesto, el comprador aprueba o rechaza, y un reloj lo vence. Su propia
spec dice que el disparador dominante **no** es la falta de stock sino «el costo
de envío, que se fija al gestionar el pedido»
(`.agent/specs/F-019/spec.md:10-14`).

La mitad de adelante contradice eso. El checkout exige que el importe del envío
se conozca **antes** de que exista el pedido:

- `Store.deliveryFee` es una tarifa fija única por tienda
  (`prisma/schema.prisma:254`), sin dependencia de la dirección.
- La opción de domicilio solo se ofrece si `deliveryEnabled && deliveryFee !==
null` (`src/features/orders/server/createOrder.ts:174`,
  `src/features/cart/components/CheckoutForm.tsx:420`). Con la tarifa en `null`,
  pedir `DELIVERY` se degrada en silencio a retiro en tienda
  (`createOrder.ts:174-179`) y el comprador **no puede pedir a domicilio**.
- `Order.deliveryFee` es obligatoria con default `0` (`prisma/schema.prisma:606`)
  y `total = subtotal - discountTotal + deliveryFee`. Un pedido a la espera de
  cotización se guarda como si el envío fuera **gratis**.
- El resumen enseña un «Total» en firme (`OrderSummary.tsx`), y la comprobación
  `expectedTotal` rechaza el pedido si el cliente no lo calculó igual
  (`createOrder.ts:189`).

Resultado: hoy la tienda que cotiza al gestionar tiene dos salidas y las dos son
malas. Poner una tarifa inventada —el comprador ve un total que no es el suyo, y
se corrige por renegociación en **todos** los pedidos— o dejarla en `null` y no
ofrecer domicilio. Lo único que avisa de la incertidumbre es una frase de copia
(«La tienda va a revisar tu pedido…», `CheckoutForm.tsx:780-783`): texto, no dato.

No existe en ninguna capa —base, contrato, API ni pantalla— la forma de decir
**«falta un importe»**. `grep -rn "por confirmar\|por calcular" src/` no devuelve
nada.

## Alcance

### Dentro

- Un **modo de envío por tienda**: tarifa fija (lo de hoy) o cotizado al
  gestionar. La forma exacta —columna nueva, enum, `deliveryFee` anulable con
  significado— la cierra `sdd-architect`; esta propuesta fija la semántica.
- Representar «envío pendiente» de forma distinguible de «envío 0» en el pedido
  guardado, en el pull hacia cuadrecaja y en las cuatro superficies donde hoy se
  imprime un total: checkout, página del pedido, mensaje de WhatsApp
  (`src/features/orders/whatsapp.ts:54`) y payload del pull
  (`src/features/orders/server/pull.ts:216`).
- Checkout en modo cotizado: la opción de domicilio se ofrece **sin importe**,
  con dirección obligatoria como ahora, fila «Envío: por confirmar» y total
  nombrado como parcial.
- `expectedTotal` en modo cotizado: se comprueba sobre la parte que sí es
  comprobable (subtotal menos descuento), nunca contra un envío inexistente.
- Página del pedido mientras no hay propuesta: mismo lenguaje que el checkout.
- Versión nueva y **aditiva** de `docs/sync-contract.md` § ③④ que diga cómo viaja
  un envío sin cotizar.

### Fuera (explícito)

- **Calcular la tarifa.** Ni zonas, ni distancia, ni mapas, ni tabla de precios
  por municipio. El importe lo pone una persona en cuadrecaja. Esta propuesta
  abre el hueco; llenarlo automáticamente es otro feature.
- **Tocar el bucle de F-019.** Cotizar **es** proponer: se reutiliza
  `POST /api/internal/orders/proposal` tal cual, con su reloj, su idempotencia y
  su atribución de desenlace. Si esta propuesta acaba necesitando un segundo
  camino, está mal planteada.
- **Cómo se configura el modo (decisión SP3).** No hay pantalla en el panel, y
  el `UPDATE` a mano tampoco es el estado final: la configuración tiene que
  llegar **desde cuadrecaja por el sync**, junto con las otras cuatro columnas de
  compra que hoy solo escribe el seed —`checkoutMode`, `deliveryEnabled`,
  `deliveryFee`, `orderExpiryHours` (`docs/flujos-cc-qab.html:1204-1235`)—. Ese
  traslado es trabajo del sync y de la tabla de propiedad de campos (F-022), y es
  un feature que abre el humano. Aquí se define el modo, se lee la columna y se
  verifica activándola por SQL.
- **Reserva de stock** y **pagos en línea**: fuera en F-019 y siguen fuera.
- **Notificación automática al comprador.** Sigue la decisión SP3 de F-019:
  enlaces `wa.me` que abre una persona.

## Actores y precondiciones

El **comprador**, invitado, en `/[slug]/carrito` de una tienda con envío
cotizado. El **encargado**, en cuadrecaja, que ve el pedido por el pull, decide
el importe del envío y lo propone por el API interno.

Precondiciones: la tienda existe y toma pedidos (F-010), tiene envío habilitado
en modo cotizado, y el pull del negocio funciona (F-007). El comprador dio
dirección y teléfono.

## Comportamiento esperado

- **E1** — Dada una tienda con envío **cotizado**, cuando el comprador abre el
  checkout, entonces la opción «Envío a domicilio» se ofrece sin importe, la fila
  «Envío» dice que está por confirmar y el botón de confirmar el pedido funciona.
- **E2** — Dado ese checkout, cuando el comprador confirma, entonces el pedido se
  guarda con el envío **pendiente** —no con `0`— y con un total marcado como
  parcial, y la respuesta no depende de que el cliente adivinara ningún envío.
- **E3** — Dado ese pedido, cuando el comprador abre `/[slug]/pedido/[code]`
  antes de que la tienda cotice, entonces ve el mismo lenguaje: envío por
  confirmar y total parcial. Nunca un total en firme que luego cambie.
- **E4** — Dado ese pedido en el pull, cuando cuadrecaja lo lee, entonces
  distingue «envío sin cotizar» de «envío 0.00» sin heurística.
- **E5** — Dado ese pedido, cuando la tienda propone con `deliveryFee` concreto
  por `POST /api/internal/orders/proposal`, entonces pasa a `AWAITING_CUSTOMER` y
  el comprador ve «envío: por confirmar → 180,00» con el total completo al lado.
- **E6** — Dado ese `AWAITING_CUSTOMER`, cuando el comprador aprueba, entonces
  `CONFIRMED` con el total completo; cuando rechaza, `CANCELLED` atribuida al
  comprador. Es exactamente el bucle de F-019, sin código nuevo.
- **E7** — Dada una tienda con envío de **tarifa fija**, cuando se recorre el
  checkout completo, entonces todo se comporta como hoy: mismo total, misma
  comprobación de `expectedTotal`, mismos importes guardados. No-regresión.
- **E8** — Dada una tienda con envío cotizado, cuando el comprador elige
  **recoger en tienda**, entonces el total es firme desde el primer momento: lo
  pendiente es el envío, no el pedido.

## Reglas de negocio

- **R1** — «Pendiente» y «cero» **nunca** se confunden, en ninguna capa. Un envío
  regalado es `0.00`; uno sin cotizar es ausencia de valor. Hoy los dos son `0`.
- **R2** — Un total con envío pendiente es **parcial** y se nombra como tal en
  todas las superficies donde aparece. Un total parcial presentado como final es
  el bug que esta propuesta existe para evitar.
- **R3** — Nadie calcula la tarifa. La pone una persona, y hasta que la pone el
  importe no existe.
- **R4** — Cotizar es proponer: un solo bucle, el de F-019. No hay endpoint nuevo
  para «poner el envío».
- **R5** — El modo lo decide la tienda, no el comprador ni la dirección.
- **R6** — Modo fijo = comportamiento actual, bit a bit. El default de una tienda
  ya publicada es el modo fijo.
- **R7** — La comprobación de precio no se elimina: en modo cotizado se aplica a
  subtotal y descuento, que sí son conocidos. Quitarla del todo reabriría lo que
  cierra `createOrder.ts:189`.
- **R8 (decisión SP3)** — El modo lo configura el comerciante **en cuadrecaja** y
  viaja por el sync, como el resto de la configuración de compra. Esto **invierte
  una propiedad ya escrita**: `prisma/schema.prisma:255-258` y el contrato dicen
  que `orderExpiryHours` es de queandabuscando y que un evento `STORE` nunca la
  pisa (R5/R20 de F-019). La decisión la devuelve al POS, así que ese campo y sus
  vecinos cambian de dueño en el contrato — trabajo del feature del sync, no de
  este. F-031 solo **lee** la columna.
- **R9** — La invariante `total = subtotal - discountTotal + deliveryFee` sigue
  siendo cierta **en cuanto hay cotización**. Mientras no la haya, el contrato
  tiene que decir explícitamente qué significa `total` en ese pedido.
- **R10** — `rateSnapshot` se congela al crear el pedido y no se recalcula al
  cotizar. Ya es criterio de F-019 y aquí no se relaja.

## Casos límite y errores

- **Envío regalado.** La tienda cotiza `0.00`. Tiene que quedar distinguible de
  «sigue pendiente» (R1) y cerrar el pedido igual que cualquier otra propuesta.
- **Propuesta que solo toca el envío.** `proposeOrderChangeSchema` exige `items`
  con `min(1)` (`src/features/orders/schemas.ts:150`): el POS reenvía las mismas
  líneas y el `approve` las borra e inserta idénticas
  (`src/features/orders/server/respond.ts:88-104`). Funciona, pero conviene
  decidir si se deja así o se admite una propuesta sin líneas.
- **Nadie cotiza nunca.** El reloj de F-019 solo corre en `AWAITING_CUSTOMER`
  (`proposal.ts:73`, `expiry.ts`). Un pedido con envío pendiente en `PENDING` o
  `PULLED` no vence jamás y se queda colgado con un total que nunca se completa.
  **Decisión SP1: sí vence**, con `orderExpiryHours` contado desde la creación.
- **La tienda salta la cotización.** `POST /api/internal/orders/status` puede
  llevar el pedido a `READY` o `DELIVERED` con el envío todavía pendiente, y el
  comprador se queda sin saber cuánto paga. **Decisión SP2: se rechaza con 409.**
- **Cambio de modo con pedidos vivos.** La tienda pasa de cotizado a fijo (o al
  revés) con pedidos abiertos: los ya creados conservan lo que tenían; el modo se
  lee al crear, nunca al leer.
- **Modo cotizado con `deliveryFee` puesta.** Estado contradictorio en la base
  hasta que exista pantalla: hay que decidir cuál manda (recomendación: el modo,
  y la tarifa se ignora).
- **`DELIVERY` pedido a una tienda sin envío.** Se sigue degradando a retiro
  (R3 de F-010, `createOrder.ts:172-179`); esta propuesta no cambia esa regla.
- **Concurrencia y reintentos.** Sin cambios: `idempotencyKey`
  (`prisma/schema.prisma:581`) y el techo de pedidos por teléfono siguen igual.

## Datos y contrato

En la base: un campo de modo en `Store` —propiedad de queandabuscando (R8)— y la
forma de expresar «sin cotizar» en `Order`. `Order.deliveryFee` es hoy
`Decimal @default(0)` no anulable (`prisma/schema.prisma:606`); volverla anulable
es una migración aditiva pero cambia el tipo que ya consumen `pull.ts:52,66` y
`whatsapp.ts:27`. La alternativa —una marca booleana junto al `0.00`— no rompe
consumidores. Lo cierra `sdd-architect`; **R1 es innegociable de las dos formas**.

En el contrato (`docs/sync-contract.md` § ③④): `deliveryFee` es hoy un string
obligatorio en el payload de pedidos (líneas 572, 667, 694) y `total` se
documenta como `subtotal - discountTotal + deliveryFee` (línea 695). Un envío sin
cotizar rompe esa lectura literal, así que exige versión nueva del contrato y
avisar al equipo de cuadrecaja. Recomendación: **campo explícito, no `null`** —
un consumidor que hoy hace `parseFloat(order.deliveryFee)` no revienta.

Importes en `Decimal(14,2)` y moneda del pedido, como siempre. Sin campos nuevos
en el endpoint de propuesta: `deliveryFee` ya viaja ahí
(`src/app/api/internal/orders/proposal/route.ts:44`).

## Criterios de aceptación propuestos

Todos `[nuevo]`. Los definitivos son los de **F-031** en `.agent/features.json`, que añaden dos más salidos de SP1 y SP2 (el vencimiento del pedido sin cotizar y el 409 al despachar) y, por la regla 3, ya no se tocan.

1. Con una tienda en modo cotizado, `GET` del checkout renderiza la opción de
   domicilio y la fila de envío **sin importe**, y el HTML no contiene ningún
   total en firme para esa modalidad.
2. `POST /api/orders` con `fulfillment: DELIVERY` contra esa tienda responde con
   éxito **sin** que el cliente mande un envío, y la fila creada distingue en la
   base «pendiente» de `0.00` (consulta SQL directa).
3. `GET /[slug]/pedido/[code]` de ese pedido muestra el envío por confirmar y el
   total parcial; ninguna de las dos cadenas es «0,00».
4. `GET /api/internal/orders` devuelve ese pedido con el envío pendiente
   distinguible de un envío de `0.00`, comprobado con dos pedidos en la misma
   respuesta.
5. `POST /api/internal/orders/proposal` con el envío cotizado deja el pedido en
   `AWAITING_CUSTOMER`, y aprobar por la página lo deja en `CONFIRMED` con el
   total completo — sin código nuevo en `respond.ts`.
6. `rateSnapshot` no cambia entre la creación del pedido y la aprobación.
7. Una tienda en modo de tarifa fija recorre checkout, creación y pull con los
   mismos importes que hoy: el guion de F-010 (`.agent/specs/F-010/visual.mjs`)
   y `scripts/place-order.mjs` siguen pasando sin tocarlos.
8. El mensaje de WhatsApp de un pedido con envío pendiente no imprime `0,00` en
   la línea de envío ni en el total.
9. `docs/sync-contract.md` documenta el caso en su versión nueva, y el cambio es
   aditivo: un consumidor de la versión anterior sigue leyendo el payload.
10. `bash .agent/verify.sh <id> --full` termina con código 0.

## Incongruencias detectadas

- `.agent/specs/F-019/spec.md:10-14` declara el envío cotizado al gestionar como
  el disparador **dominante** del bucle, pero `createOrder.ts:174` y
  `CheckoutForm.tsx:420` hacen imposible pedir a domicilio sin una tarifa fija
  previa. La spec de F-019 y el checkout de F-010 se contradicen.
- F-010 tiene criterios ya escritos («El checkout crea un `Order` con snapshot de
  contacto y de precios») que por la regla 3 no se tocan. Esta propuesta los
  extiende: el snapshot sigue existiendo, con un importe explícitamente ausente.
- `docs/flujos-cc-qab.html:1204-1235` ya documenta que las cuatro columnas de
  compra solo las escribe el seed. Este feature añade una quinta, y la decisión
  SP3 manda que las cinco pasen a llegar desde cuadrecaja — lo que **invierte** lo
  que hoy dicen `prisma/schema.prisma:255-258` y el contrato sobre
  `orderExpiryHours`. Lo cierra el feature del sync, no este.
- `docs/sync-contract.md:695` documenta `total` como suma cerrada; con envío
  pendiente deja de serlo hasta la cotización.

## Decisiones del humano

Respondidas el 2026-09-01, antes de abrir F-031. Ninguna queda pendiente.

- **SP1 — ¿Vence un pedido que nadie cotiza? Sí.** El reloj de F-019 solo corre
  en `AWAITING_CUSTOMER`, así que un pedido con el envío pendiente que el
  encargado nunca mira se quedaría vivo para siempre. Se reusa
  `orderExpiryHours`, contado **desde la creación** del pedido. Consecuencia
  anotada: ese campo pasa a significar dos cosas —plazo para cotizar y plazo
  para responder una propuesta— y hay que documentarlo en el contrato.
- **SP2 — ¿Se puede despachar sin cotizar? No.**
  `POST /api/internal/orders/status` responde **409** al llevar a
  `READY`/`IN_TRANSIT`/`DELIVERED` un pedido con el envío pendiente. Entregar un
  pedido cuyo total nunca se cerró es una reclamación garantizada. Es un error
  nuevo del contrato: cuadrecaja tiene que manejarlo.
- **SP3 — ¿Pantalla de panel? No, y la configuración viene del POS.** No se añade
  pantalla, pero tampoco se acepta el `UPDATE` a mano como estado final: el modo
  —y con él las otras cuatro columnas de compra que faltan— tiene que llegar
  **desde cuadrecaja**. Eso invierte la propiedad hoy escrita de
  `orderExpiryHours` (R8) y es un feature aparte: **F-032**, abierto el mismo día.
  Sin él, F-031 queda operable pero no configurable por el comerciante.
- **SP4 — Total parcial, nunca una cifra sola.** El comprador ve «Envío: por
  confirmar» y «Total parcial: 1.000,00 + envío por confirmar». Se descartaron
  «Desde 1.000,00» —la palabra se lee rápido y se olvida, y queda la cifra— y no
  mostrar total —peor sensación al confirmar y rompe la costumbre de cualquier
  checkout—. `sdd-designer` afina la copia, no la decisión.
- **SP5 — El modo es por tienda.** No por modalidad de entrega. Se revisa si
  algún día conviven «envío propio cotizado» y «mensajería con tarifa».

## No decidido a propósito

La forma exacta en la base —`deliveryFee` anulable frente a una marca explícita—
y si el modo es un `Boolean` o un enum con sitio para modos futuros. Lo cierra
`sdd-architect`. La copia exacta de las cuatro superficies la cierra
`sdd-designer` dentro de la forma que fija SP4.
