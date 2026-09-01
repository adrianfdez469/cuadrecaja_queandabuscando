# 0027 — La ausencia de un importe se modela como `NULL` en la base y como cero más bandera en el cable

**Aceptada** · 1 de septiembre de 2026 · F-031

Complementa a [ADR 0007](0007-price-override.md), que dice quién manda sobre un
precio, y al § «Versionado de este documento» de
[`sync-contract.md`](../sync-contract.md), que dice cuándo un cambio en el cable
es mayor. Esta dice **cómo se representa un importe que todavía no existe**, a
los dos lados de la frontera.

## Contexto

F-031 necesita distinguir «el envío no está cotizado todavía» de «el envío vale
`0.00`». Hasta entonces los dos eran el mismo valor: `Order.deliveryFee` era
`Decimal @default(0)` no anulable, así que un pedido a la espera de cotización se
guardaba **como si el envío fuera gratis**, y la pantalla, el mensaje de WhatsApp
y el payload del pull no tenían forma de decir otra cosa.

Las dos capas donde había que resolverlo tienen restricciones **opuestas**:

- **La base no tiene consumidor heredado que proteger.** Es nuestra, la migramos
  cuando queramos y el compilador nos acompaña.
- **El cable sí.** `docs/sync-contract.md` es lo que implementa otro equipo, y
  cambiar el tipo de un campo que ya está publicado rompe a quien lo lea. La
  aditividad no es una preferencia de estilo: es lo que decide si la versión
  nueva se puede publicar sin coordinar una migración con gente que no está en
  esta reunión.

La tentación era resolver las dos igual, y las dos formas de hacerlo eran malas:
un centinela en la base (`0.00` con una marca al lado) o un `null` en el cable.

## Decisión

**En la base, la ausencia se modela como ausencia:** `NULL`, nunca un valor
centinela con una bandera al lado. Un importe que no existe no tiene número.

**En el cable, el campo heredado conserva su tipo y su presencia** con un valor
de relleno, y **un campo nuevo dice que ese relleno no es un dato**. En F-031:
`deliveryFee` sigue siendo un string decimal presente siempre, valiendo
`"0.00"`, y `deliveryFeePending: boolean` es lo único que distingue el pedido sin
cotizar del que se cotizó en cero.

**La asimetría es deliberada y se documenta en el propio contrato**, con esas
palabras y con los dos ejemplos lado a lado: los dos pedidos traen el mismo
`deliveryFee` a propósito, para que sea imposible acertar por casualidad.

### Corolario, que aplica a todo el contrato

- **Un valor que el POS emite se modela como enum.** Crecerlo es aditivo para
  quien lo emite: nadie se rompe porque aparezca un valor que no manda. Por eso
  `Store.deliveryFeeMode` es `DeliveryFeeMode { FLAT_RATE, QUOTED_PER_ORDER }` y
  no un `Boolean`, y por eso F-032 puede transportarlo sin volver a discutir la
  forma.
- **Un valor que el POS consume se modela como booleano** cuando su espacio de
  estados está cerrado. Crecer un enum consumido rompe un `switch` exhaustivo del
  otro lado — que es exactamente la fila que § «Modos de falla» del contrato tuvo
  que escribir cuando `status` pasó de 6 a 9 valores en la v5.

## Consecuencias

- **Cualquier importe opcional futuro** —un recargo, una propina, un impuesto,
  un descuento que la tienda decide al gestionar— sigue esta forma sin volver a
  discutirla: `NULL` en la columna, cero más bandera en el payload.
- **Aprobar una propuesta cierra el estado pendiente sin código nuevo.**
  `respond.ts` ya hacía `SET "deliveryFee" = "proposedDeliveryFee"`; con la
  columna anulable, esa línea **es** la transición de «sin cotizar» a
  «cotizado». Un centinela con bandera habría obligado a añadir
  `"deliveryFeePending" = false` al mismo CTE, y a acordarse de hacerlo en cada
  camino futuro que escriba un importe.
- **El compilador enumera las superficies.** Cambiar el tipo a `string | null`
  hizo que `tsc` señalara una por una las seis pantallas que imprimían el
  importe. Con un centinela, `OrderLinesTable.tsx` —que ocultaba la fila de
  envío cuando valía cero— habría seguido compilando y mintiendo.
- **Un `SUM` sobre una columna de dinero anulable tiene que decidir a propósito
  qué hace con los pendientes**, en vez de sumar ceros que no lo son. Es trabajo
  extra en cada agregado nuevo, y es el precio que esta decisión acepta.
- **Dos representaciones del mismo hecho hay que mantenerlas coherentes.** El
  contrato lo dice explícitamente para que nadie «arregle» la asimetría creyendo
  que es un descuido.

## Alternativas descartadas

- **Marca explícita junto al `0.00` también en la base.** Admite filas
  contradictorias —`deliveryFeePending: true` con un importe puesto— que ninguna
  restricción de Postgres evita cómodamente; obliga a tocar el bucle de
  renegociación de F-019, que funcionaba; y pierde la barrida del compilador
  descrita arriba.
- **`NULL` también en el cable.** Es la forma honesta y rompería a un consumidor
  de la v5 que hace `parseFloat(order.deliveryFee)`. Se descartó por la
  aditividad, no por elegancia: si algún día el contrato admite un cambio no
  aditivo con ventana de migración, esta es la alternativa a reconsiderar.
- **Un campo `totalIsPartial` además de la bandera del envío.** Dos banderas
  para un mismo hecho es como nacen las contradicciones: `deliveryFeePending`
  **es** la afirmación de que el total es parcial.

## Lo que esta ADR no decide

**Quién es el dueño de la configuración de compra.** `Store.deliveryFeeMode`
nace escribiéndose a mano con SQL, y que pase a llegar desde cuadrecaja por el
sync —junto con las otras cuatro columnas, e invirtiendo la propiedad de
`Store.orderExpiryHours`— es F-032, con su propia ADR y la v7 del contrato. Esta
ADR habla de **cómo se representa** un importe ausente, no de quién lo escribe.
