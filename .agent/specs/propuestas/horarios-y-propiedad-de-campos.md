---
propuesta: horarios-y-propiedad-de-campos
agente: sdd-spec
actualizado: 2026-08-26T02:02:05Z
estado: propuesta
---

> Origen: revisión de arquitectura del 2026-08-25.

## Problema

Dos huecos pequeños con consecuencias desproporcionadas.

**No hay zona horaria.** `Store.openingHours` es un `Json?` sin `timezone`.
«Las compras de madrugada se entregan al día siguiente» es una regla sobre el
reloj **de la tienda**, y el comprador puede estar en otro huso. Sin el campo, la
regla se evalúa contra el reloj del servidor y da resultados distintos según dónde
se ejecute.

**No hay tabla de propiedad de campos.** [ADR 0007] fija el dueño de cinco campos
(`priceOverride`, `description`, `imageUrls`, `visible`, `featured`) y el handler
los excluye del `UPDATE`. Pero el corte acordado —cuadrecaja publica,
queandabuscando viste— alcanza a muchos más: promociones, horarios, costo de
envío, branding, slug. Cada campo sin dueño escrito es un bug de sync esperando.

Y un tercer punto que corrige el plan de producto: **el umbral de stock bajo no
debe viajar a queandabuscando.** Aquí nunca se ve el entero de existencias, solo
el enum de tres valores ([ADR 0003]). Un umbral sin stock contra el que
compararlo sería un campo muerto que además sugiere que este lado calcula algo.

## Alcance

### Dentro

- `Store.timezone` (IANA), obligatorio para publicar.
- Toda la lógica de horarios y vencimientos evaluada en hora de la tienda.
- `docs/sync-contract.md`: tabla exhaustiva de propiedad de campos.
- Dejar escrito que el umbral se configura y se queda en cuadrecaja.

### Fuera (explícito)

- El editor de horarios en el panel. Es F-011.
- La política de vencimiento en sí. Es `pedido-renegociacion`.

## Actores y precondiciones

El administrador al publicar. Precondición: ninguna.

## Comportamiento esperado

- **E1** — Dada una tienda con `timezone` y horario 09:00–18:00, cuando se consulta
  desde un cliente en otro huso, entonces abierto/cerrado se calcula en hora de la
  tienda.
- **E2** — Dado un pedido hecho a las 02:00 hora de la tienda, entonces la fecha de
  entrega propuesta es el día siguiente.
- **E3** — Dada una tienda sin `timezone`, entonces no se puede pasar a
  `PUBLISHED`.
- **E4** — Dado un `product.update` del sync, entonces ningún campo marcado como
  propiedad del panel cambia.

## Reglas de negocio

- **R1** — `timezone` es un identificador IANA válido (`America/Havana`), no un
  desplazamiento fijo: el horario de verano lo rompería.
- **R2** — Ninguna regla de horario usa la hora del servidor.
- **R3** — Cada campo del modelo tiene exactamente un dueño escrito en el contrato.
- **R4** — El umbral de stock bajo no se envía ni se almacena aquí.

## Casos límite y errores

- `timezone` inválido o desconocido para el runtime.
- Cambio de horario de verano justo en la ventana de entrega.
- Tienda que cambia de zona horaria con pedidos abiertos.
- Horario que cruza medianoche (22:00–02:00).

## Datos y contrato

`Store.timezone: String`. Y la tabla de propiedad va a `docs/sync-contract.md`,
con tres columnas: campo · dueño (`cuadrecaja` / `panel` / `plataforma`) · qué
pasa si llega un evento que lo toca.

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. Publicar una tienda sin `timezone` falla.
2. Con `timezone` puesta y el reloj del proceso en otro huso (`TZ=UTC`), el cálculo
   de abierto/cerrado coincide con la hora local de la tienda.
3. Un `timezone` inválido se rechaza al guardar.
4. `docs/sync-contract.md` contiene la tabla y **cada** campo de `Store` y
   `StoreProduct` aparece en ella.
5. Un `product.update` no altera ningún campo cuyo dueño sea `panel` (extiende la
   invariante ya probada en F-005).
6. `grep -ri "umbral\|threshold" src/ prisma/schema.prisma` no devuelve ningún
   campo almacenado.
7. `bash .agent/verify.sh <id> --full` termina en 0.

## Incongruencias detectadas

- `prisma/schema.prisma`: `Store.openingHours Json?` sin `timezone` acompañante.
- El plan de producto original decía que el umbral se sincroniza con el resto de
  los datos del producto; contradice [ADR 0003], que es de donde sale que solo
  viaja el enum.
- `docs/sync-contract.md` documenta el flujo pero no la propiedad campo a campo.

## Huecos y preguntas al humano

- **SP1** — ¿`timezone` se sincroniza desde cuadrecaja o se elige en el panel?
  Recomendación: **panel**, con un default por país. Es dato de vitrina y el POS no
  lo necesita.
- **SP2** — ¿Horarios de entrega distintos de los de apertura? El plan los nombra
  por separado. Recomendación: sí, dos calendarios; entregar y abrir no coinciden.

## No decidido a propósito

El formato interno de `openingHours`. Lo cierra `sdd-architect` junto con F-011.
