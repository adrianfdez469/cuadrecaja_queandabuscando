# Traspaso a cuadrecaja — envío cotizado al gestionar (contrato v6)

**Para el equipo de cuadrecaja** · 1 de septiembre de 2026 · corresponde a la
**v6** de [`sync-contract.md`](sync-contract.md)

Este documento es la lista de trabajo, no la especificación. La especificación
es el contrato; aquí está lo que hay que tocar de vuestro lado y por qué, para
que podáis empezar sin leer mil líneas. Cada punto enlaza a la sección del
contrato que manda.

---

## El escenario, en tres frases

Hay negocios que solo saben cuánto cuesta el envío **cuando alguien mira el
pedido**: depende de la dirección, del mensajero libre y de la hora. Hasta ahora
la tienda de ese negocio tenía que inventarse una tarifa fija o no ofrecer
domicilio, porque el comprador no podía pedir sin ver el total. Desde la v6 el
comprador **pide a domicilio sin que el importe del envío exista todavía**, y
alguien en cuadrecaja lo cotiza al gestionar el pedido.

La vuelta ya la teníais implementada o especificada desde la v5: es el bucle de
renegociación —la tienda propone, el comprador aprueba o rechaza, un reloj lo
vence—. **Cotizar el envío es exactamente ese bucle**, sin endpoint nuevo.

---

## Lo que hay que implementar

### 1. Leer `deliveryFeePending` antes de usar `deliveryFee`

Cada pedido del pull trae un campo nuevo, booleano. Con `true`, el importe del
envío **no existe todavía** y `deliveryFee` viene valiendo `"0.00"` como
relleno.

**La trampa, y es la importante de esta versión:** un pedido sin cotizar y un
pedido cuyo envío la tienda regaló traen **exactamente el mismo**
`deliveryFee: "0.00"`. Lo único que los distingue es `deliveryFeePending`.
Cualquier atajo —tratar el `0.00` como gratis, mirar si hay `contact.address`,
comparar `total` con `subtotal`— funciona hoy y **cobra de menos** con el primer
envío regalado.

Y `total`, con `deliveryFeePending: true`, es **parcial**: vale
`subtotal - discountTotal`, sin envío. La igualdad
`total = subtotal - discountTotal + deliveryFee` vuelve a cerrarse en cuanto se
cotiza.

→ contrato, § ③④ «El envío sin cotizar»

### 2. Cotizar por el endpoint que ya existe

`POST /api/internal/orders/proposal`, con el `deliveryFee` concreto. El pedido
pasa a `AWAITING_CUSTOMER` y el comprador aprueba o rechaza desde su página. No
hay ruta nueva.

**Un detalle que os ahorra un `400`:** el `items` de esa llamada es
**obligatorio y con al menos una línea**, también cuando lo único que cambia es
el envío. Para cotizar solo el envío, **reenviad las mismas líneas que el pull
os acaba de entregar**, con los mismos importes. Aprobar las reescribe
idénticas y nada se pierde. Lo dejamos así a propósito: relajar el schema
habría abierto código nuevo en el bucle de aprobación, que es la parte que ya
funciona y no queremos tocar.

Cotizar `0.00` es legítimo: es el envío regalado. Queda cotizado, no pendiente.

→ contrato, § ③④ «La renegociación»

### 3. Manejar el `409 ORDER_DELIVERY_NOT_QUOTED`

Es **la primera guarda de transición del contrato**, y por eso esta versión no
es aditiva. Sobre un pedido con el envío sin cotizar:

| Destino de `POST /orders/status`                | Respuesta                       |
| ----------------------------------------------- | ------------------------------- |
| `READY` · `IN_TRANSIT` · `DELIVERED`            | `409 ORDER_DELIVERY_NOT_QUOTED` |
| `CONFIRMED` · `CANCELLED` · `REJECTED_BY_STORE` | `200`, como siempre             |

Tratadlo como **«falta cotizar»**, no como un fallo transitorio que se
reintenta: reintentar no lo arregla nunca. Aceptar el pedido sin haber cotizado
sí se puede —es lo normal: se acepta y se cotiza después— y cancelarlo también.

La línea de la v5 que decía «Sin guardas de transición: el POS es la autoridad
y puede reportar cualquiera de los seis valores» **ya no es cierta**.

→ contrato, § ③④ y § Vocabulario de errores

### 4. Revisar el parseo de importes: ahora traen dos decimales

**Esto es un arreglo nuestro, y es la parte incómoda de este traspaso.** Hasta
la v5.1, los importes del pull se emitían suprimiendo los ceros de relleno:
`880,00` salía como `"880"`, `180,50` como `"180.5"` y cero como `"0"` —
mientras el ejemplo publicado en el contrato mostraba dos decimales. **El
ejemplo estaba mal, no el código.** En la v6 arreglamos los dos: todos los
importes del payload del pull traen dos decimales, cero incluido.

Si parseáis a número, no notaréis nada. Si en algún sitio comparáis cadenas, ahí
sí. Lo cambiamos ahora, y no más adelante, precisamente porque todavía no hay
nada construido de este lado del pull: después habría costado otra versión
mayor coordinada.

**No extendáis la regla al resto del contrato**, y esto importa:

- **§ ⑤ Reconciliación no cambia.** Su hash quita los ceros de relleno **a
  propósito**, y las dos partes tenemos que hacer exactamente lo mismo o el
  hash difiere siempre. El SQL espejo publicado en la v5.1 sigue siendo el
  bueno.
- **§ ① sigue con su regla**: `price` viaja con dos decimales **como máximo**.

`quantity` no es dinero y no cambia: sigue con tres decimales.

→ contrato, § ③④ «El formato de los importes»

### 5. Saber qué le pasa al pedido que nadie cotiza

Vive `Store.orderExpiryHours` contadas **desde su creación** y después el reloj
lo cierra solo: `CANCELLED` con `cancelledBy: "EXPIRY"` y un `cancelReason`
propio y literal, «El pedido venció sin que la tienda cotizara el envío» —
distinto del de la propuesta vencida, porque el comprador nunca vio ninguna
propuesta. Si vuestro código distingue motivos por ese texto, hay **dos**
literales desde la v6.

Ese campo pasa a significar **dos** cosas con el mismo número: cuánto dura una
propuesta y cuánto vive un pedido sin cotizar. Los dos plazos son independientes
y **se suman**: un pedido puede vivir sin cotizar hasta `orderExpiryHours` y,
si se cotiza justo antes del límite, otras tantas esperando la respuesta del
comprador.

→ contrato, § ③④ «El envío sin cotizar»

---

## Lo que NO cambia

- El pull, su cursor, su paginación y la regla de un solo poller por negocio.
- El enum de `status`: sigue con los nueve valores de la v5.
- El cuerpo y la respuesta de `POST /orders/proposal`, y el hecho de que
  `rateSnapshot` no se toca jamás: un pedido aprobado tiene el mismo
  `rateSnapshot`, byte a byte, que tenía al crearse.
- La autenticación, el aislamiento por negocio y el `404` de un recurso de otro
  negocio. El `409` nuevo **no** sirve para averiguar si un pedido existe en
  otro negocio: el aislamiento se comprueba antes que la cotización.
- Que queandabuscando nunca envía el mensaje de WhatsApp: lo abre una persona
  con un clic.
- La reconciliación (§ ⑤) y el catálogo (§ ①), enteros.

---

## Cómo se activa una tienda con envío cotizado

**Hoy, no se activa desde cuadrecaja: es una columna que se escribe a mano en
la base de queandabuscando.** No es el estado final y lo sabemos.

La configuración de compra de cada tienda —`checkoutMode`, `deliveryEnabled`,
`deliveryFee`, `orderExpiryHours` y el modo de envío que introduce esta v6— hoy
**no viaja por el sync**: ningún evento `STORE` la trae y solo la escribe
nuestro seed. Eso es lo que arregla la **v7**.

## Lo que viene en la v7, para que no sea una sorpresa

Las cinco columnas de arriba pasan al `payload` de `STORE`, **opcionales**: un
evento que no las trae deja la configuración intacta —omitir no es apagar—, y un
evento que sí las trae la aplica. Con ellas, `orderExpiryHours` **cambia de
dueño**: pasa a escribirla cuadrecaja, y este documento y el contrato dejarán de
decir que es nuestra.

Vuestro trabajo para la v7 será añadir esos campos a `Tienda`, exponerlos en la
interfaz del comerciante y emitirlos en el outbox. Es separable del trabajo de
esta v6, que es todo de pedidos, y por eso publicamos las dos versiones por
separado en vez de haceros esperar.

---

## Preguntas

Al equipo de queandabuscando. Si algo de aquí no cuadra con lo que tenéis
delante, comprobad primero la primera línea de
[`sync-contract.md`](sync-contract.md): si no dice «Versión 6», el documento que
leísteis no es este.
