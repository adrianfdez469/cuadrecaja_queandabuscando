---
propuesta: pedido-renegociacion
agente: sdd-spec
actualizado: 2026-08-26T02:00:35Z
estado: propuesta
---

> Origen: revisión de arquitectura del 2026-08-25.

## Problema

El flujo acordado permite que la tienda **modifique** un pedido antes de
confirmarlo —no hay stock suficiente, el precio derivó, o el costo de envío se
fija al gestionarlo— y que el comprador apruebe o rechace el cambio.

Faltan las dos mitades que lo hacen operable:

1. **No hay estado** para «hay una modificación esperando al cliente». Sin él no
   se puede ni mostrar en pantalla ni vencer por reloj.
2. **No hay reloj.** El comprador es invitado, pudo cerrar la pestaña y no hay
   canal de push: puede no volver nunca. Hoy el encargado se quedaría con medio
   pedido colgado indefinidamente.

El caso más frecuente no es la falta de stock: es el **costo de envío definido al
gestionar**, que por diseño ocurre en todos los pedidos de esa modalidad. Es el
camino normal, no la excepción.

## Alcance

### Dentro

- Estados nuevos en `OrderStatus`: `AWAITING_CUSTOMER`, `REJECTED_BY_STORE`,
  `IN_TRANSIT`.
- Modelo de la modificación propuesta (qué cambió, contra qué total).
- Vencimiento configurable por tienda, con política y default.
- Enlace al pedido enviado por WhatsApp al crearlo.
- Reporte de todos estos estados hacia cuadrecaja por `/orders/status`.

### Fuera (explícito)

- **Reserva de stock.** Dos compradores pueden pedir la última unidad; lo resuelve
  la confirmación manual. Reservar exigiría escribir en el camino de venta del POS,
  que es justo lo que evita [ADR 0003].
- Pagos en línea. v1 es contra entrega.
- Cancelación parcial por línea si complica el modelo; se decide al diseñar.

## Actores y precondiciones

El encargado en cuadrecaja propone; el comprador en queandabuscando responde.
Precondición: el pedido existe (F-010) y tiene teléfono de contacto.

## Comportamiento esperado

- **E1** — Dado un pedido `PULLED`, cuando la tienda propone una modificación,
  entonces pasa a `AWAITING_CUSTOMER` y el comprador puede verla en su página.
- **E2** — Dado un pedido `AWAITING_CUSTOMER`, cuando el comprador aprueba,
  entonces pasa a `CONFIRMED` con los importes nuevos y cuadrecaja lo ve en el
  siguiente pull.
- **E3** — Igual pero rechazando → `CANCELLED` con motivo del comprador.
- **E4** — Dado un pedido `AWAITING_CUSTOMER` que supera el vencimiento de su
  tienda, entonces se aplica la política configurada y el estado deja de ser
  `AWAITING_CUSTOMER` sin intervención de nadie.
- **E5** — Dado un pedido que la tienda no puede atender, entonces
  `REJECTED_BY_STORE`, distinguible de una cancelación del comprador.
- **E6** — Dado un pedido recién creado, entonces el comprador recibe un enlace a
  su página por WhatsApp.

## Reglas de negocio

- **R1** — Toda modificación guarda el total anterior y el nuevo. El comprador ve
  ambos.
- **R2** — Un pedido en `AWAITING_CUSTOMER` no avanza sin respuesta o vencimiento.
- **R3** — El vencimiento se configura por tienda; hay un default del sistema.
- **R4** — Quién canceló se conserva: cambia el mensaje al comprador y la métrica.
- **R5** — Los tres disparadores —stock, deriva de precio, envío— usan **el mismo**
  bucle. No hay tres caminos.
- **R6** — La página del pedido no se cachea (ya en F-010).

## Casos límite y errores

- El comprador aprueba y vence a la vez (carrera).
- Dos modificaciones seguidas sobre el mismo pedido.
- El comprador aprueba un pedido que la tienda ya canceló.
- Teléfono inválido: no se puede enviar el enlace → el pedido no debe quedar
  inalcanzable.
- Vencimiento con la tienda cerrada: ¿corre el reloj fuera del horario?

## Datos y contrato

Los estados nuevos viajan por `POST /api/internal/orders/status`, que ya existe
(F-007). Hay que ampliar el enum del contrato en `docs/sync-contract.md` § ③④.
Todos los importes en `Decimal(14,2)`; las tasas ya van congeladas en
`rateSnapshot` y **no se recalculan** al modificar.

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. Proponer una modificación deja el pedido en `AWAITING_CUSTOMER` y
   `GET /[slug]/pedido/[code]` muestra total anterior y nuevo.
2. Aprobar → `CONFIRMED` con los importes nuevos; `GET /api/internal/orders` lo
   refleja.
3. Rechazar → `CANCELLED` con motivo atribuido al comprador.
4. Con el vencimiento vencido, un pedido `AWAITING_CUSTOMER` cambia de estado sin
   intervención (verificado forzando la fecha, no esperando).
5. `REJECTED_BY_STORE` y `CANCELLED` se distinguen en la respuesta del pull.
6. `rateSnapshot` no cambia entre la creación y la aprobación de la modificación.
7. `bash .agent/verify.sh <id> --full` termina en 0.

## Incongruencias detectadas

- `prisma/schema.prisma`: `OrderStatus` no tiene `AWAITING_CUSTOMER`,
  `REJECTED_BY_STORE` ni `IN_TRANSIT`, y `cancelReason` no dice **quién** canceló.
- F-010 ya tiene criterios escritos y por la regla 3 no se tocan: este feature se
  apoya en ellos y los extiende.
- F-007 depende de F-010 y sigue en `passes: false`; este feature entra después.

## Huecos y preguntas al humano

- **SP1** — Al vencer, ¿se cancela el pedido o se despacha lo disponible?
  Recomendación: configurable por tienda, con **cancelar** como default: despachar
  algo que el comprador no aprobó explícitamente genera una reclamación peor.
- **SP2** — ¿El reloj corre con la tienda cerrada? Recomendación: no. Un pedido
  hecho a las 2 a.m. con vencimiento de 4 h moriría antes de que abran.
  Depende de `Store.timezone` (ver propuesta `horarios-y-propiedad-de-campos`).
- **SP3** — ¿El enlace por WhatsApp es automático o lo manda el encargado?
  Automático depende de un proveedor; manual es gratis y funciona desde el día uno.

## No decidido a propósito

Si la modificación se modela como filas nuevas o como versión del pedido. Lo
cierra `sdd-architect`.
