# Contrato de integración cuadrecaja ↔ queandabuscando

**Versión 10.1** · 4 de septiembre de 2026

Este documento es lo que el equipo de cuadrecaja implementa. El lado receptor ya
existe y está verificado contra los casos de abajo, **con una excepción marcada
a propósito**: lo que la v6 introduce (§ «Cambios respecto a la v5.1») está
acordado y publicado **antes** de estar implementado en queandabuscando, para
que cuadrecaja pueda empezar en paralelo. Mientras eso dure, un pedido nunca
llega con `deliveryFeePending`, `POST /orders/status` no devuelve todavía el
`409` y los importes siguen saliendo sin los ceros de relleno. Se avisa cuando
el lado receptor esté en pie; si algo de la v6 os hace falta antes para
probar, pedidlo y se prioriza.

## Versionado de este documento

**Toda edición de este fichero mueve la versión de la primera línea**, y queda
anotada en la sección «Cambios respecto a la vN» que le corresponde. No hay
cambios silenciosos: el otro equipo lee la versión para saber si lo que tiene
delante es lo que implementó.

- **Mayor** (`5` → `6`): cambia lo que el POS envía o recibe —un endpoint, un
  campo, un enum, un código de error, una regla de validación—, sea aditivo o
  no. Se coordina con el equipo de cuadrecaja **antes** de publicarla.
- **Menor** (`5` → `5.1`): aclara lo ya acordado sin cambiar el contrato —una
  redacción ambigua, un ejemplo, el SQL exacto de algo descrito en
  pseudocódigo, un mecanismo opcional que quien no lo implemente sigue siendo
  un lector correcto de la mayor vigente—. No requiere que el otro equipo
  cambie nada, pero sí que sepa que hay texto nuevo.

Una corrección de tipografía o de un enlace roto es una menor: cuesta un dígito
y evita la pregunta «¿es este el documento que leí?».

## Cambios respecto a la v10

Sube como **menor**: no cambia ninguna ruta, ningún campo, ningún enum ni
ninguna regla de validación. **Quien implementó la v10 sigue siendo un lector
correcto y no tiene que tocar nada.**

Lo que hace es cerrar un agujero de este documento. El enum de § Formato lista
cinco entidades desde la v2 —`STORE`, `CATEGORY`, `PRODUCT`, `CURRENCY`,
`EXCHANGE_RATE`— y solo dos tenían su `payload` escrito: `PRODUCT` desde el
principio y `STORE` desde la v3, que ya lo documentó tarde y por el mismo
motivo. Las otras tres se validan y se aplican en queandabuscando desde
entonces, pero su forma solo existía en nuestro código: para emitirlas había
que leerlo o preguntar. **Quedan documentadas abajo, con las reglas que ya se
aplican hoy** — § «`payload` de `CATEGORY`», § «`payload` de `CURRENCY`» y
§ «`payload` de `EXCHANGE_RATE`».

Nada de lo que sigue es un cambio: es lo que el código ya hace. Se destaca
aquí porque quien asumiera que las cinco entidades se comportan igual que
`STORE` y `PRODUCT` se equivocaría en las cinco cosas:

- **`CURRENCY` no lleva `businessId`** y su tabla es **global a la
  plataforma**: lo que un negocio escribe ahí lo ven todos los demás.
- **`CURRENCY` y `EXCHANGE_RATE` ignoran `operation`.** Un `DELETE` no borra
  nada: en `CURRENCY` hace el mismo upsert que un `UPDATE` (para retirar una
  moneda, `active: false`), y en `EXCHANGE_RATE` inserta una tasa más.
- **`EXCHANGE_RATE` es append-only**, y la tasa vigente es la última que
  **llegó**, no la de `updatedAt` más reciente. Corregir una tasa es enviar
  otra.
- **`updatedAt` solo es guarda anti-rancio en `STORE`, `PRODUCT` y
  `CATEGORY`.** En `CURRENCY` y `EXCHANGE_RATE` se valida el formato y no se
  compara con nada.
- **El orden de emisión importa en dos sitios**, y los dos fallan en silencio:
  `CATEGORY` antes que los `PRODUCT` que la referencian (si no, el producto se
  publica sin categoría y se queda así), y `CURRENCY` antes que la primera
  `EXCHANGE_RATE` de esa moneda (si no, queda una moneda provisional con el
  código por nombre y por símbolo).

Si alguna de esas reglas no es la que cuadrecaja necesita, la conversación es
una v11 y no una corrección de redacción: decidlo y se coordina.

## Cambios respecto a la v9

Sube como **mayor** por un endpoint nuevo — § Versionado lo llama mayor «sea
aditivo o no» — y esta lo es de verdad: **ninguna de las siete rutas de
arriba cambia de forma ni de significado**, y un token de negocio acuñado
antes de esta versión sigue valiendo exactamente igual.

**El alta de un negocio deja de exigir un acto manual del lado de
queandabuscando.** Hasta la v9, la única forma de que un negocio existiera y
tuviera token era `npm run mint:token -- <externalId>`, ejecutado desde una
terminal con acceso a la base de producción de queandabuscando — un paso
fuera de este contrato, y una cita entre los dos equipos por cada comercio
nuevo. La v10 abre una octava ruta, **`POST /api/provisioning/credential`**,
que cuadrecaja puede llamar sola: dado un `externalId` (el `Negocio.id`),
crea el `Business` si no existe y acuña su token, devolviéndolo en claro
**una sola vez**. Ver § «Aprovisionamiento de negocios» para el cuerpo, las
dos respuestas y su propia tabla de códigos — deliberadamente **fuera** de
la tabla de § Endpoints y del alcance de § Vocabulario de errores: tiene
otra autenticación (un secreto de integrador, no un token de negocio) y otro
vocabulario.

**Lo que esto NO cambia:**

- El guion sigue existiendo, sin cambios de comportamiento, como vía de
  rescate y como la **única** forma de rotar un token — la ruta nueva nunca
  rota, solo acuña una vez (ver § «Aprovisionamiento de negocios»).
- Un negocio que **ya** tiene token no puede pedir otro por esta vía. Si
  cuadrecaja pierde el valor, la recuperación sigue siendo rotar con corte
  (§ Modos de falla).
- El secreto de aprovisionamiento **no** autentica ninguna de las siete
  rutas de sync, y ningún token de negocio autentica la ruta de
  aprovisionamiento. Son dos credenciales con sujetos distintos —ver
  [ADR 0029](adr/0029-alta-de-negocio-por-api.md)— y ninguna sirve en el
  sitio de la otra.

**Dos correcciones a frases de este documento que ya eran falsas antes de
esta versión**, aprovechando que hay que tocar § Autenticación de todos
modos:

- **«No hay ninguna variable de entorno compartida entre los dos
  proyectos»** (§ Autenticación) ya era inexacta desde que existe
  `SSO_JWT_SECRET`, que tiene que valer lo mismo en los dos lados
  (`docs/despliegue.md` § 5). La v10 la corrige y de paso documenta el
  reparto del secreto de aprovisionamiento, que es la segunda variable
  compartida entre los dos proyectos, con una salvedad: lo que viaja igual
  a los dos lados es el secreto en claro (`SSO_JWT_SECRET`) o el
  aprovisionamiento (`QAB_PROVISIONING_SECRET` en cuadrecaja); el token de
  **negocio** sigue sin tener ninguna variable compartida — cada negocio
  guarda el suyo, en su propia configuración.
- **«Válido para las siete rutas de arriba»** (§ Vocabulario de errores) se
  queda corta desde que hay una octava ruta. La v10 la acota explícitamente
  a las siete rutas de sync — la de aprovisionamiento tiene su propio
  vocabulario, en su propia sección.

## Cambios respecto a la v8

Sube como **mayor** por dos motivos independientes, y el segundo solo por su
propio peso ya lo sería: `openingHours` gana una regla de validación real
(«cambia lo que el POS envía o recibe [...] una regla de validación», más
arriba), y el cable gana **dos códigos de error nuevos**, que la propia
§ Versionado también llama mayor. La tabla de propiedad de campos, sola,
habría sido una **menor**: no cambia nada de lo que el POS envía o recibe,
documenta campo a campo una propiedad que ya está en efecto en el código de
hoy — un POS que implementó la v8 sigue siendo un lector correcto de la v9
sin tocar una línea si nunca manda `openingHours`.

**Antes de que mandéis un calendario, la frase incómoda, completa:** un
evento `STORE` cuyo `openingHours` no cumple el formato de abajo **rechaza
ese evento entero** con `STORE_OPENING_HOURS_INVALID` — y eso significa que
**ninguno de sus otros campos se aplica tampoco**, ni siquiera un `name` o un
`phone` corregidos que viajaran en el mismo evento. El resto del lote sí se
aplica: es un rechazo por evento, nunca un `400` que tire el lote entero. El
evento vuelve en `failed[]` para que lo reintentéis en cuanto el calendario
sea válido.

1. **La forma completa de `openingHours`.** Antes era `unknown`: cualquier
   JSON entraba y se guardaba tal cual. Ahora es un objeto con versión y las
   siete claves del día, cada una con sus tramos horarios:

   ```jsonc
   {
     "version": 1,
     "days": {
       "mon": [{ "from": "09:00", "to": "18:00" }],
       "tue": [
         { "from": "09:00", "to": "13:00" },
         { "from": "15:00", "to": "18:00" },
       ],
       "wed": [], // cerrado todo el día
       "thu": [{ "from": "09:00", "to": "18:00" }],
       "fri": [{ "from": "22:00", "to": "02:00" }], // cruza la medianoche
       "sat": [{ "from": "00:00", "to": "24:00" }], // abierto todo el día
       "sun": [],
     },
   }
   ```

   Reglas del formato: `version` es siempre `1` hoy; `days` tiene
   **exactamente** las siete claves `mon`…`sun`, ni una menos ni una más;
   cada día es un array de 0 a 4 ventanas, y `[]` significa «cerrado todo el
   día»; `from`/`to` son `"HH:MM"` en 24 horas, y `to` admite además el valor
   exacto `"24:00"` para decir «hasta el final del día»; una ventana con
   `from` igual a `to` se rechaza, por ambigua; las ventanas de un mismo día
   van estrictamente ordenadas por `from` y sin solaparse; y **como máximo
   una ventana por día puede cruzar la medianoche** (`to < from`, como
   `fri` arriba) — y tiene que ser la última del día. Una clave desconocida
   en cualquier nivel (un `"tz"` o un `"timezone"` dentro de `openingHours`,
   por ejemplo) se rechaza: la zona horaria **no** viaja aquí, ver el punto 4.
   Serializado, el JSON no puede pasar de 2 KB.

2. **El rechazo, con su nombre y su alcance.** `STORE_OPENING_HOURS_INVALID`
   entra en el `207 failed[]` de siempre — nunca en un `400` de lote — y
   significa lo que el párrafo de arriba dice con todas las letras.

3. **La semántica de omisión no cambia.** `openingHours` ausente o `null`
   deja la columna exactamente como estaba, igual que en la v7. Validar no es
   lo mismo que exigir: un POS que nunca mande el campo sigue siendo un
   lector correcto de la v9.

4. **`Store` gana una columna `timezone`, y es del panel — el POS no la
   manda.** Es un identificador IANA (`"America/Havana"`, nunca un
   desplazamiento como `"-04:00"` ni un alias como `"Cuba"` o `"UTC"`), y
   sirve para leer `openingHours` en la hora local del negocio en vez de en
   la del servidor. No es un campo del `payload` de `STORE`: si llega una
   clave `timezone` de todos modos, se descarta sin error y sin afectar al
   resto del evento. `STORE_TIMEZONE_INVALID` es el segundo código nuevo,
   visible en el `207 failed[]` cuando una tienda con una zona que
   queandabuscando no reconoce intenta publicarse o republicarse — no lo
   dispara nada que el POS envíe hoy, porque el POS no escribe esta columna.

5. **El umbral de stock bajo se queda en cuadrecaja.** Sigue sin viajar en el
   cable ni guardarse en queandabuscando: lo único que cruza la frontera es
   el enum `Availability` de tres valores (ya desde antes de esta versión).

**La tabla de propiedad de campos** (más abajo, en «`payload` de `STORE`»)
deja de tener cinco filas y pasa a tener **las 31 columnas de `Store` y las
23 de `StoreProduct`**, cada una con su dueño exacto y qué hace un evento que
la toca — incluida `timezone`, del punto 4. Las cinco filas de la v7 se
conservan con su texto tal cual («cuadrecaja (desde v7)»); esto no es una
reescritura, es completar lo que la v7 dejó pendiente por escrito.

## Cambios respecto a la v7

Aditivo (F-033): un POS que implemente la v7 y no envíe ninguno de los tres
parámetros de abajo sigue siendo un lector correcto de `GET
/api/internal/orders` sin tocar una línea — mismo cuerpo, mismo cursor, mismo
`updateMany`. Sube como **mayor** porque añade parámetros a lo que el POS
puede enviar («cambia lo que el POS envía o recibe [...] sea aditivo o no»,
más arriba), no porque rompa nada de la v7.

**`GET /api/internal/orders` gana dos formas de lectura lateral: `?status=` y
`?ids=`**, más un tercer parámetro de paginación propio de la primera,
`?after=`. Las dos ignoran el cursor del pull incremental y no lo mueven — ver
§ ③④ Pedidos, «Las lecturas laterales», para la forma completa, los topes y
los rechazos. `Un pedido devuelto pasa de PENDING a PULLED` (§ ③④) queda
acotado al pull incremental: ninguna lectura lateral marca nada (R7 de
`.agent/specs/F-033/spec.md`). El vocabulario de errores gana la fila de `400
INVALID_QUERY`, que la ruta ya emitía desde su primera versión (F-007) sin que
este documento la recogiera (§ Vocabulario de errores).

## Cambios respecto a la v6

Aditivo (F-032): un POS que implemente la v6 y no envíe ninguna de las cinco
claves de abajo sigue siendo un emisor correcto y no tiene que tocar una
línea. La única salvedad es de propiedad, no de forma del cable: un campo que
antes era de queandabuscando pasa a ser de cuadrecaja.

**Las cinco columnas que deciden cómo se compra en una tienda viajan ahora en
el `payload` de `STORE`, planas y las cinco opcionales** —ver el `payload`
completo y la tabla de propiedad en «`payload` de `STORE`», más abajo:

| Campo              | Tipo           | Obligatoriedad | Rango                                       |
| ------------------ | -------------- | -------------- | ------------------------------------------- |
| `checkoutMode`     | string         | opcional       | `"WHATSAPP"` \| `"ONSITE"`                  |
| `deliveryEnabled`  | boolean        | opcional       | `true` \| `false`                           |
| `deliveryFee`      | number \| null | opcional       | `>= 0`, ≤ 2 decimales, `<= 999999999999.99` |
| `deliveryFeeMode`  | string         | opcional       | `"FLAT_RATE"` \| `"QUOTED_PER_ORDER"`       |
| `orderExpiryHours` | entero         | opcional       | `1..8760`                                   |

**Regla que manda: ausente deja la columna intacta; `null` solo tiene
significado en `deliveryFee`.** En las otras cuatro, `null` es un error de
tipo y produce `400 INVALID_BATCH` — la columna no es anulable, así que
traducir `null` a "el default" o a "como si no viniera" inventaría una
semántica que el POS no puede pedir.

| Campo              | Ausente         | `null`              | Valor   |
| ------------------ | --------------- | ------------------- | ------- |
| `checkoutMode`     | columna intacta | `400 INVALID_BATCH` | escribe |
| `deliveryEnabled`  | columna intacta | `400 INVALID_BATCH` | escribe |
| `deliveryFee`      | columna intacta | escribe `NULL`      | escribe |
| `deliveryFeeMode`  | columna intacta | `400 INVALID_BATCH` | escribe |
| `orderExpiryHours` | columna intacta | `400 INVALID_BATCH` | escribe |

**`Store.orderExpiryHours` cambia de dueño.** Pasa a ser de cuadrecaja, junto
con el resto de la configuración de compra. Tres líneas anteriores de este
mismo documento dejan de ser ciertas, dicho con esas palabras, como la v6 ya
hizo con la línea de las guardas de transición: la de § «Cambios respecto a la
v4» —«`Store.orderExpiryHours` es de queandabuscando: el POS no lo envía y un
evento `STORE` no lo pisa»—, y la de § «La renegociación»/③④ —«`Store.orderExpiryHours`
es de queandabuscando (24 por defecto): el POS no lo envía y un evento `STORE`
no lo pisa. Sigue siendo así en la v6 — cambia en la v7»—. Lo que ese número
_significa_ no cambia: cuánto dura una propuesta y cuánto vive un pedido sin
cotizar (v6). Cambia únicamente quién lo escribe. Ver
[ADR 0028](adr/0028-configuracion-de-compra-del-pos.md).

**El riesgo operativo: un solo valor mal formado tumba el LOTE ENTERO con
`400`, y el reintento vuelve a fallar tal cual.** Ejemplo literal — un evento
`STORE` con `"deliveryFee": 12.345` (más de dos decimales) en un lote que por
lo demás es válido:

```jsonc
// petición: POST /api/internal/sync/catalog
{
  "businessId": "seed-negocio-1",
  "events": [
    /* ...eventos válidos... */
    {
      "eventId": "evt-store-1",
      "entity": "STORE",
      "operation": "UPDATE",
      "occurredAt": "2026-09-01T14:03:00.000Z",
      "payload": { "storeId": "uuid", /* ... */ "deliveryFee": 12.345 },
    },
  ],
}
```

```jsonc
// respuesta: 400
{
  "error": "INVALID_BATCH",
  "issues": [{ "path": ["events", 1, "payload", "deliveryFee"], "message": "..." }],
}
```

Ningún `SyncEvent` queda escrito — ni el del evento malo ni el de los demás
eventos del mismo lote que sí eran válidos. El outbox del negocio se para
hasta que el POS corrija el valor y reenvíe.

**El fallo por evento cuando la contradicción solo se ve contra la fila
guardada** (criterio 5): responde `207`, no `400` — un `refine` de Zod no
puede ver la base, así que esta mitad de la guarda corre en el handler,
después de leer la fila y antes de escribir nada:

```jsonc
{
  "ok": ["evt-product-1"],
  "failed": [{ "id": "evt-store-1", "error": "STORE_DELIVERY_CONFIG_INCONSISTENT" }],
  "results": [
    { "eventId": "evt-product-1", "status": "processed" },
    { "eventId": "evt-store-1", "status": "failed", "error": "STORE_DELIVERY_CONFIG_INCONSISTENT" },
  ],
}
```

`STORE_DELIVERY_CONFIG_INCONSISTENT` protege un único invariante: una fila
nunca queda con `deliveryEnabled: true` **y** `deliveryFeeMode: "FLAT_RATE"`
**y** `deliveryFee` sin importe — una tienda que dice ofrecer domicilio sin
nada con que cobrarlo. `failed` no es un duplicado (§ «Idempotencia, en dos
capas»): el POS lo reintenta, y reintentarlo sin corregir el POS falla otra
vez, indefinidamente.

## Cambios respecto a la v5.1

**Esta versión NO es aditiva en dos cosas** (F-031), y las dos piden trabajo del
lado de cuadrecaja antes de recibir tráfico real:

- **`POST /orders/status` gana la primera guarda de transición del contrato.**
  Responde `409 ORDER_DELIVERY_NOT_QUOTED` al llevar a `READY`, `IN_TRANSIT` o
  `DELIVERED` un pedido cuyo envío todavía no está cotizado. La línea de la v5
  —«Sin guardas de transición: el POS es la autoridad y puede reportar
  cualquiera de los seis valores sobre cualquier pedido que le pertenezca»—
  **deja de ser cierta**.
- **Todos los importes del payload del pull traen ahora dos decimales.** Hasta
  la v5.1 se emitían con supresión de ceros de relleno —`880,00` salía como
  `"880"` y cero como `"0"`—, así que **el ejemplo completo publicado en este
  documento nunca fue cierto**. Se corrige el código, no solo el ejemplo. Un
  lector que parsee a número no nota nada; uno que compare cadenas, sí.

Lo demás es aditivo:

- **El envío sin cotizar existe** (§ «El envío sin cotizar»): un pedido puede
  llegar con el importe del envío todavía por decidir. Lo dice un campo nuevo,
  `deliveryFeePending`, y `deliveryFee` sigue presente valiendo `"0.00"` — que
  **no** significa envío gratis.
- **`total` es parcial mientras el envío no esté cotizado**, y vale
  `subtotal - discountTotal`. La igualdad de siempre vuelve a cerrarse en cuanto
  hay cotización.
- **Cotizar es proponer**: no hay endpoint nuevo. Se usa
  `POST /orders/proposal`, y como su `items` es obligatorio, para cotizar
  **solo** el envío se reenvían las mismas líneas que el pull acaba de entregar.
- **`Store.orderExpiryHours` gana un segundo significado**: además de cuánto
  dura una propuesta, ahora es cuánto vive un pedido cuyo envío nadie cotizó,
  contado desde su creación. Sigue siendo de queandabuscando en esta versión.
- **Un `cancelReason` nuevo y literal** para el pedido que vence sin cotizar.

**Aviso de la v7, para que no sean dos sorpresas.** La versión siguiente
(F-032) lleva al `payload` de `STORE` las cinco columnas de configuración de
compra —`checkoutMode`, `deliveryEnabled`, `deliveryFee`, `orderExpiryHours` y
el modo de envío que introduce esta v6—, y con ellas `orderExpiryHours`
**cambia de dueño**: pasa a escribirla cuadrecaja. Hoy ninguna viaja. Se
anuncia aquí porque el trabajo de cuadrecaja para esta v6 (pedidos) y para la
v7 (configuración de la tienda) es separable, y la v6 no espera a la v7.

## Cambios respecto a la v5

Ninguno de estos cambia el contrato: la v5 sigue siendo la mayor vigente y un
lector que la implemente no tiene que tocar nada.

- **El SQL espejo de la reconciliación** (§ «El SQL espejo»): el pseudocódigo
  del hash admitía más de una lectura del `precio` —`1990` y `1990.00` dan
  hashes distintos sobre los mismos datos—, así que se publica la consulta
  exacta, lista para copiar contra el schema de cuadrecaja.
- **El timbre del canal `negocio:`** (§ «El timbre del canal `negocio:`»,
  F-020): un Broadcast sin datos que adelanta el pull. Quien no lo implemente
  se queda con su cron de 2 minutos y sigue siendo un lector correcto de la v5.

## Cambios respecto a la v4

**Esta versión NO es aditiva en el enum de estados de pedido** (F-019, mismo
motivo que la v3 no lo fue en autenticación y la v4 no lo fue en el `payload`
de `PRODUCT`: HD5/AP2, en cuadrecaja no hay nada desarrollado de esta
integración todavía, así que no hay consumidor vivo al que migrar sin cortar).
Un lector con un `switch` exhaustivo sobre `status` —el mismo patrón que usa la
insignia de estado de queandabuscando— se rompe con los tres valores nuevos si
no se actualiza antes de recibirlos. Lo que cambia:

- **El enum de `status` en el pull pasa de 6 a 9 valores.** Se agregan
  `AWAITING_CUSTOMER`, `IN_TRANSIT` y `REJECTED_BY_STORE` — ver § ③④ para
  cuándo aparece cada uno.
- **`POST /orders/status` amplía su enum** a `IN_TRANSIT` y
  `REJECTED_BY_STORE`, y **rechaza `AWAITING_CUSTOMER` con `400`**: ese estado
  solo lo pone la acción de proponer un cambio, la única que fija un plazo. La
  línea de la v2 — «`status` ∈ `CONFIRMED` · `READY` · `DELIVERED` ·
  `CANCELLED`. Sin cambios en la v2» — deja de ser cierta.
- **Endpoint nuevo: `POST /api/internal/orders/proposal`.** La tienda propone
  un cambio de importes y/o líneas sobre un pedido que todavía no está
  cerrado; ver § ③④ para el cuerpo, la respuesta y las dos reglas que hay que
  respetar.
- **Cómo se distinguen los tres desenlaces de un pedido cerrado**: el campo
  `cancelledBy` en el payload del pull, nuevo y aditivo — ver § ③④.
- **Dos códigos de error nuevos**: `409 ORDER_NOT_PROPOSABLE` y
  `400 CURRENCY_MISMATCH` (§ Vocabulario de errores).
- **`Store.orderExpiryHours` es de queandabuscando**: el POS no lo envía y un
  evento `STORE` no lo pisa (§ ③④).

## Cambios respecto a la v3

**Esta versión NO es aditiva en el `payload` de `PRODUCT`** (F-024, mismo
motivo que la v3 no lo fue en autenticación: HD5, en cuadrecaja no hay nada
desarrollado de esta integración todavía, así que no hay consumidor vivo al
que migrar sin cortar). Lo que cambia:

- **`barcodes` (lista) reemplaza a `barcode` (uno solo).** El producto llega
  con **todos** sus códigos de barras, no con uno elegido a ciegas. `[]` es
  válido cuando el producto no tiene ninguno.
- **La clave `barcode` (singular) queda prohibida, no solo ausente.** Un
  evento `PRODUCT` cuyo `payload` la incluya —con cualquier valor, incluido
  `null`— hace que el **lote entero** responda `400 INVALID_BATCH` y no
  escriba nada, ni siquiera los demás eventos del mismo lote (§ Vocabulario
  de errores). Un POS que siga enviando la v3 no sincroniza catálogo en
  absoluto hasta migrar (§ Modos de falla).
- **La fusión de productos entre negocios sigue usando un solo código: el
  menor de los válidos, en orden lexicográfico de cadenas.** Guardar todos
  los códigos y decidir la identidad canónica por uno solo son decisiones
  separadas a propósito ([ADR 0020](adr/0020-todos-los-codigos-una-sola-fusion.md)):
  el resto del comportamiento de "Resolver identidad canónica" (§
  Transformación en queandabuscando) no cambia.

## Cambios respecto a la v2

**Esta versión NO es aditiva en autenticación.** Todo lo demás (formato de los
`payload`, los cuatro campos de pedidos que F-010 añadió) sigue siendo lo que
la v2 ya describía. Lo que cambia:

- **El token deja de ser único y global.** Cada negocio tiene el suyo, emitido
  por queandabuscando; ver § Autenticación. HD5: **en cuadrecaja no hay nada
  desarrollado de esta integración todavía**, así que este cambio se
  documenta y no se negocia con nadie — no hay ningún consumidor vivo al que
  avisar ni migrar sin cortar.
- **El cursor del pull pasa a ser por negocio** (§ ③④ Pedidos): cuadrecaja
  tiene que guardar un `ultimoPedidoVisto` por cada uno, no uno solo.
- **Tres códigos de error nuevos** que el POS no había visto nunca: negocio
  inactivo, `businessId` que no corresponde al token, y recurso de otro
  negocio (§ Vocabulario de errores).
- Recoge además, en un solo anuncio, dos cosas que ya estaban implementadas y
  nunca se habían comunicado: `unpublishReason` en el `payload` de `STORE` y
  el endpoint ⑥ de disponibilidad de slug (ambos de la propuesta v3 anterior).

---

## El principio que ordena todo

> Ninguna de las dos aplicaciones tiene credenciales de base de datos de la otra.
> Cada una escribe únicamente en la suya. **Todas las llamadas las inicia el POS.**

queandabuscando no conoce la URL de cuadrecaja ni ningún secreto suyo. Un SSRF,
una dependencia npm comprometida o una fuga de variables de entorno en la tienda
pública **no alcanza la base con las ventas**, porque la credencial no está en
ese runtime. No depende de que nadie recuerde una convención.

```
┌──────────────────────┐                        ┌──────────────────────┐
│  cuadrecaja (POS)    │                        │  queandabuscando     │
│                      │                        │                      │
│  cron */2 ───────────┼── ① POST sync/catalog ──▶  escribe en SU base │
│               ───────┼── ② POST sync/availability▶                    │
│               ◀──────┼── ③ GET  orders ─────────  lee de SU base     │
│               ───────┼── ④ POST orders/status ──▶                    │
│               ───────┼── ⑤ GET  reconciliation ─▶                    │
└──────────────────────┘                        └──────────────────────┘
   tiene: DB_POS + su token por negocio            tiene: DB_TIENDA
   NO tiene DB_TIENDA                             NO tiene DB_POS
```

## Autenticación

**El token es por negocio, no un secreto único de plataforma (v3).**
queandabuscando lo acuña, entrega el valor en claro **una sola vez** y guarda
solo su SHA-256. Bearer largo y aleatorio en `Authorization`:

```
Authorization: Bearer <token del negocio>
```

**Por dónde se acuña (v10).** Dos vías, no una:

1. **`POST /api/provisioning/credential`** (§ «Aprovisionamiento de
   negocios»), autenticada con un secreto de integrador propio —no el token
   de ningún negocio—, que cuadrecaja llama sola para dar de alta un negocio
   nuevo o acuñar el token de uno que ya existe sin token. Es el camino
   normal desde la v10.
2. **`npm run mint:token -- <externalId>`**, ejecutado por un desarrollador
   de queandabuscando desde una terminal con acceso a su base. Sigue
   existiendo sin cambios, como vía de rescate y como la **única** forma de
   **rotar** un token que ya existe — la vía 1 nunca rota (§
   «Aprovisionamiento de negocios»).

Rotarlo (re-acuñarlo, siempre por la vía 2) invalida al instante el valor
viejo de ESE negocio y no afecta a ningún otro. **No hay ninguna variable de
entorno compartida entre los dos proyectos para el token de negocio**: cada
negocio guarda el suyo en su propia configuración, del lado de cuadrecaja —
la frase de las versiones anteriores decía esto sin la acotación final, y ya
era inexacta: `SSO_JWT_SECRET` (`docs/despliegue.md` § 5) tiene que valer lo
mismo en los dos proyectos, y desde la v10 también el secreto de
aprovisionamiento viaja en claro a cuadrecaja (queandabuscando solo guarda su
SHA-256, `PROVISIONING_SECRET_SHA256`) — dos variables compartidas que no
tienen nada que ver con el token de ningún negocio en particular.

`/api/internal/*` queda fuera del rate limiting público y excluido de
`robots.txt`. Si **ningún** negocio tiene un token acuñado todavía, el
servidor responde **503**, nunca 200: un token ausente jamás significa «deja
pasar todo» — es la misma invariante que la v2 ya tenía, con un sujeto
distinto (antes «no hay ninguna variable global configurada», ahora «ningún
negocio tiene token»).

El siguiente paso es firma HMAC-SHA256 sobre `timestamp + "." + body`, con
rechazo si la deriva supera 5 minutos. Ver [ADR 0008](adr/0008-bearer-token-baseline.md)
para el disparador — el paso a HMAC no se adelanta ni se retrasa por este
cambio. La verificación está aislada en `src/lib/syncAuth.ts` y la resolución
del negocio en `src/features/sync/server/caller.ts`, así que el cambio no
toca ninguna ruta.

---

## Endpoints

| Método | Ruta                                                   | Cuerpo / query                     | Devuelve                                                                         |
| ------ | ------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `POST` | `/api/internal/sync/catalog`                           | `{ businessId, events[] }` (≤500)  | 207 `{ ok, failed, results }`                                                    |
| `POST` | `/api/internal/sync/availability`                      | `{ businessId, items[] }` (≤2000)  | 200 `{ applied, confirmed }`                                                     |
| `GET`  | `/api/internal/orders?since=&limit=` (pull)            | —                                  | 200 `{ orders, nextCursor }`                                                     |
| `GET`  | `/api/internal/orders?status=&limit=&after=` (lateral) | —                                  | 200 `{ orders, nextCursor: null, nextAfter }`                                    |
| `GET`  | `/api/internal/orders?ids=a,b` (lateral)               | —                                  | 200 `{ orders, nextCursor: null, nextAfter: null }`                              |
| `POST` | `/api/internal/orders/status`                          | `{ orderId, status, reason? }`     | 200 `{ ok: true }`                                                               |
| `POST` | `/api/internal/orders/proposal`                        | ver § ③④ «Proponer un cambio» (v5) | 200 ver § ③④                                                                     |
| `GET`  | `/api/internal/reconciliation?storeId=`                | —                                  | 200 `{ products, hash }`                                                         |
| `GET`  | `/api/internal/slug-availability?slug=&name=&storeId=` | —                                  | 200 `{ candidate, available, reason, resolvedSlug, url, storeKnown, reserving }` |

**La octava ruta, `POST /api/provisioning/credential` (v10), vive fuera de
esta tabla a propósito**: da de alta negocios, no sincroniza los que ya
existen, se autentica con un secreto de integrador distinto del token de
negocio, y su vocabulario de errores es el suyo — nunca el de la tabla de
abajo. Ver § «Aprovisionamiento de negocios».

### Vocabulario de errores (v9)

Válido para las siete rutas de arriba — **no** para
`POST /api/provisioning/credential` (v10), que tiene su propio vocabulario
en § «Aprovisionamiento de negocios». Los tres primeros de `503`/`401` ya
existían con otro nombre de variable; los siguientes son de la v3; la fila de
`400 INVALID_BATCH` es de la v4 (F-024); `409 ORDER_NOT_PROPOSABLE` y
`400 CURRENCY_MISMATCH` son de la v5 (F-019), propias de
`POST /api/internal/orders/proposal`; `409 ORDER_DELIVERY_NOT_QUOTED` es de la
v6 (F-031), propia de `POST /api/internal/orders/status`; `400
INVALID_QUERY` es de `GET /api/internal/orders` — la ruta lo emite desde su
primera versión (F-007), pero esta tabla nunca lo había documentado hasta la
v8 (F-033)—; y `STORE_OPENING_HOURS_INVALID`/`STORE_TIMEZONE_INVALID` son de
la v9 (F-022), las dos como `207 failed[]`, nunca como `400` de lote.

| Código | Cuerpo                                                                                  | Cuándo                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503`  | `{"error":"SYNC_NOT_CONFIGURED"}`                                                       | Ningún negocio tiene un token acuñado todavía                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `401`  | `{"error":"UNAUTHORIZED"}`                                                              | Sin cabecera, esquema distinto de `Bearer`, token vacío/corto, o token que no resuelve ningún negocio                                                                                                                                                                                                                                                                                                                                                                           |
| `400`  | `{"error":"INVALID_BATCH","issues":[...]}`                                              | **Nuevo (v4).** El cuerpo no cumple el schema — incluida la clave `barcode` (singular) en cualquier `payload` de `PRODUCT`. Rechaza el **lote entero**, ninguna `SyncEvent` queda escrita, ni siquiera la de los demás eventos del mismo lote que sí eran válidos                                                                                                                                                                                                               |
| `403`  | `{"error":"BUSINESS_INACTIVE"}`                                                         | El token es válido pero ese negocio está dado de baja                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `403`  | `{"error":"BUSINESS_MISMATCH"}`                                                         | El `businessId` del cuerpo (① o ②) no es el del negocio autenticado — el lote entero se rechaza, no se aplica nada                                                                                                                                                                                                                                                                                                                                                              |
| `404`  | `{"error":"UNKNOWN_ORDER"}`                                                             | El `orderId` no existe **o pertenece a otro negocio** — el mismo código en los dos casos, a propósito                                                                                                                                                                                                                                                                                                                                                                           |
| `404`  | `{"error":"UNKNOWN_STORE"}`                                                             | El `storeId` de ⑤ no existe **o pertenece a otro negocio**                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `409`  | `{"error":"ORDER_NOT_PROPOSABLE","status"}`                                             | **Nuevo (v5).** `POST /orders/proposal` sobre un pedido que no está en `PULLED`, `CONFIRMED` ni `AWAITING_CUSTOMER`. Nada se escribe; `status` trae el estado actual                                                                                                                                                                                                                                                                                                            |
| `400`  | `{"error":"CURRENCY_MISMATCH"}`                                                         | **Nuevo (v5).** La propuesta llega en una moneda distinta de `Order.currencyCode`                                                                                                                                                                                                                                                                                                                                                                                               |
| `409`  | `{"error":"ORDER_DELIVERY_NOT_QUOTED"}`                                                 | **Nuevo (v6).** `POST /orders/status` llevando a `READY`, `IN_TRANSIT` o `DELIVERED` un pedido con `deliveryFeePending: true`. Nada se escribe. Cotiza primero por `POST /orders/proposal` y espera que el comprador apruebe                                                                                                                                                                                                                                                    |
| `400`  | `{"error":"MISSING_STORE_ID"}`                                                          | **Aclaración, no cambio (F-014).** Falta el parámetro `storeId` en ⑤, o llega vacío. Ya lo devuelve el endpoint hoy; esta fila lo documenta                                                                                                                                                                                                                                                                                                                                     |
| `400`  | `{"error":"INVALID_BATCH","issues":[{"message":"STORE_DELIVERY_CONFIG_INCONSISTENT"}]}` | **Nuevo (v7, F-032).** Un `payload` de `STORE` que por sí solo ya es contradictorio: `deliveryEnabled: true` + `deliveryFeeMode: "FLAT_RATE"` + `deliveryFee: null`. Rechaza el lote entero, igual que cualquier otro `INVALID_BATCH`                                                                                                                                                                                                                                           |
| `207`  | `"failed":[{"id":"...","error":"STORE_DELIVERY_CONFIG_INCONSISTENT"}]`                  | **Nuevo (v7, F-032).** El mismo invariante, pero solo visible al mezclar el `payload` con la fila ya guardada — no es un `400`, es el evento reportado `failed` dentro del `207` de siempre. No escribe nada; reintentarlo sin corregir el POS falla otra vez                                                                                                                                                                                                                   |
| `400`  | `{"error":"INVALID_QUERY","issues":[{"path":[...],"message":"..."}]}`                   | **Documentado en v8 (F-033), la ruta lo emite desde F-007.** Propia de `GET /api/internal/orders`. `path` nombra el parámetro con forma inválida (`status`, `ids`, `after`, `limit`, `since`); `path: []` cuando el problema es la COMBINACIÓN de parámetros, con `message` uno de `SINCE_WITH_LATERAL_READ`, `STATUS_WITH_IDS`, `AFTER_WITHOUT_STATUS`, `LIMIT_WITH_IDS` o `IDS_LIMIT_EXCEEDED` (este último con `path: ["ids"]`) — ver § ③④ Pedidos, «Las lecturas laterales» |
| `207`  | `"failed":[{"id":"...","error":"STORE_OPENING_HOURS_INVALID"}]`                         | **Nuevo (v9, F-022).** Un `payload` de `STORE` cuyo `openingHours` no cumple el formato de § «`payload` de `STORE`». Rechaza **ese evento**, nunca el lote: `SyncEvent.status = "FAILED"`, ninguno de sus campos se aplica —tampoco un `name` o un `phone` que viajaran con él— y el resto del lote sí se aplica. Reintentadlo cuando el calendario sea válido                                                                                                                  |
| `207`  | `"failed":[{"id":"...","error":"STORE_TIMEZONE_INVALID"}]`                              | **Nuevo (v9, F-022).** Al publicar o republicar una tienda (`publishToStore: true` cuando el opt-in cambia), su `timezone` no es un identificador IANA que queandabuscando reconozca. `timezone` es del panel — no lo dispara nada que el `payload` del POS envíe hoy —, y se corrige a mano en queandabuscando, nunca desde el POS                                                                                                                                             |

Un recurso de otro negocio nunca responde distinto de uno inexistente: ni
`/orders/status`, ni `/reconciliation`, ni `/slug-availability` (que además
responde `storeKnown: false`, nunca un error) sirven para averiguar si un
`Tienda.id` o un pedido existen en OTRO negocio.

---

## Aprovisionamiento de negocios (v10)

**`POST /api/provisioning/credential`.** Da de alta un negocio y acuña su
token de sync — el reemplazo de la sesión manual de terminal que las
versiones anteriores de este documento no describían (§ «Cambios respecto a
la v9»). Quien la dispara es el **superadministrador de cuadrecaja**, una
vez **por negocio**, nunca por sucursal.

**Autenticación, distinta de la del resto del contrato.** No es un token de
negocio: es un secreto de integrador, compartido una sola vez entre los dos
equipos, que identifica a **cuadrecaja**, no a ningún `Business` en
particular.

```
Authorization: Bearer <secreto de aprovisionamiento, en claro>
Content-Type: application/json
```

Ninguna de las siete rutas de sync acepta este secreto, y esta ruta no
acepta ningún token de negocio — son credenciales de sujetos distintos
([ADR 0029](adr/0029-alta-de-negocio-por-api.md)).

**Cuerpo de la petición.**

| Campo        | Tipo     | Obligatorio | Límites                                                                   |
| ------------ | -------- | ----------- | ------------------------------------------------------------------------- |
| `externalId` | `string` | **sí**      | no vacío tras recortar espacios, ≤ 128 caracteres                         |
| `name`       | `string` | no          | no vacío tras recortar espacios, ≤ 200; se ignora si el negocio ya existe |

```jsonc
{
  "externalId": "neg-000123", // el Negocio.id de cuadrecaja
  "name": "Bodega La Rampa", // opcional; si falta, se usa el propio externalId
}
```

Cuerpo completo ≤ 4 KB. Claves que este documento no lista se descartan en
silencio — el típo `external_id` en vez de `externalId` sigue dando `400`,
porque `externalId` falta.

**Respuesta 201 — se acuñó un token (negocio nuevo o negocio existente sin
token todavía):**

```jsonc
{
  "externalId": "neg-000123",
  "created": true, // false si el Business ya existía y solo se le acuñó el token
  "minted": true,
  "token": "<48 caracteres, la única vez que se ve>",
}
```

**Respuesta 200 — el negocio ya tenía un token, y esta llamada no lo
toca:**

```jsonc
{
  "externalId": "neg-000123",
  "created": false,
  "minted": false,
  "token": null,
}
```

**Es idempotente y no rota jamás.** Repetir la misma llamada con el mismo
`externalId` no cambia nada de la fila y no devuelve ningún token — la
respuesta pasa a ser la `200` de arriba. Si cuadrecaja pierde el token que
esta ruta le entregó, la única recuperación es rotar con corte desde
`npm run mint:token -- <externalId>` (§ Modos de falla); esta ruta **no**
tiene forma de volver a mostrar un token que ya se entregó.

**Códigos de error.**

| Código | Cuerpo                                    | Cuándo                                                                                                                               |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | `{"error":"INVALID_BODY","issues":[...]}` | El cuerpo no es JSON, no llega con `content-type: application/json`, pesa más de 4 KB, o no cumple la forma de arriba                |
| `401`  | `{"error":"UNAUTHORIZED"}`                | Cabecera `Authorization` ausente, con otro esquema, o con un valor que no es el secreto — el mismo cuerpo en los tres casos          |
| `403`  | `{"error":"BUSINESS_INACTIVE"}`           | El negocio existe pero está dado de baja (`Business.active = false`). No se acuña y no se reactiva                                   |
| `405`  | (el del framework)                        | Cualquier método distinto de `POST`                                                                                                  |
| `503`  | `{"error":"PROVISIONING_NOT_CONFIGURED"}` | queandabuscando no tiene configurado el secreto de aprovisionamiento. Nunca `401`: un secreto ausente no significa «deja pasar todo» |
| `503`  | `{"error":"TOKEN_COLLISION"}`             | Colisión interna al acuñar el token (extraordinariamente improbable). Nada queda escrito; reintentar                                 |

**Lo que esta ruta no hace.** No revoca, no lista y no borra negocios; no
hay `DELETE` ni `GET` de inventario. Un `externalId` mal escrito deja una
fila que solo se limpia por SQL del lado de queandabuscando. Y no es la vía
para reactivar un negocio dado de baja: `Business.active` se cambia por
otro camino, ajeno a este contrato.

---

## ① Catálogo y precios (outbox)

### En cuadrecaja

El `INSERT` a `OutboxEvento` va **dentro de la transacción que ya existe** al
mutar el producto. Si hay rollback, el evento desaparece con ella: no existe una
forma de divergir.

```ts
await prisma.$transaction(async (tx) => {
  const p = await tx.producto.update({ where: { id }, data });
  await tx.outboxEvento.create({ data: { entidad: "PRODUCTO", entidadId: p.id, ... } });
});
```

El cron toma el lote con `FOR UPDATE SKIP LOCKED` — los crons de Vercel pueden
solaparse si una corrida tarda más que el intervalo, y así dos corridas toman
lotes disjuntos:

```sql
SELECT * FROM "OutboxEvento"
WHERE "procesadoAt" IS NULL AND intentos < 6
ORDER BY id LIMIT 500
FOR UPDATE SKIP LOCKED;
```

`intentos < 6` es lo que impide el bloqueo de cabeza de línea: un payload
corrupto se queda quieto después de 6 intentos y los siguientes siguen fluyendo.
El acuse es **por id**, nunca por lote.

### Formato

Los nombres van en **inglés** aunque el schema del POS esté en español, para que
ninguno de los dos lados traduzca al leer.

**`businessId` en la raíz (v3): redundante y comprobado, ya no autoritativo.**
La identidad del negocio sale del token (§ Autenticación); este campo se
sigue enviando en el mismo formato de siempre, pero ahora solo se usa para
comprobar que coincide con el del token autenticado. Si no coincide —en la
raíz o en el `payload` de cualquier evento que lleve `businessId`
(`STORE`, `CATEGORY`, `PRODUCT`, `EXCHANGE_RATE`; `CURRENCY` no lo lleva)—
el lote entero se rechaza con `403 BUSINESS_MISMATCH` y no se escribe nada.

```jsonc
{
  "businessId": "<Negocio.id>",
  "events": [
    {
      "eventId": "<OutboxEvento.id>",
      "entity": "PRODUCT", // STORE | CATEGORY | PRODUCT | CURRENCY | EXCHANGE_RATE
      "operation": "UPDATE", // CREATE | UPDATE | DELETE
      "occurredAt": "2026-08-25T14:03:00.000Z",
      "payload": {},
    },
  ],
}
```

#### Mapeo de nombres

| Wire (inglés)        | cuadrecaja (español)                                        |
| -------------------- | ----------------------------------------------------------- |
| `storeProductId`     | `ProductoTienda.id`                                         |
| `productId`          | `Producto.id`                                               |
| `storeId`            | `Tienda.id`                                                 |
| `businessId`         | `Negocio.id`                                                |
| `localName`          | `Producto.nombre`                                           |
| `barcodes`           | `CodigoProducto.codigo` de **todas** las filas del producto |
| `price` / `currency` | `ProductoTienda.precio` / `monedaPrecioCode`                |
| `canonicalProductId` | `Producto.productoCanonicoId`                               |
| `publishToStore`     | `Producto.publicarEnTienda` / `Tienda.publicarEnTienda`     |
| `availability`       | derivado de `existencia` y `umbralBajo`                     |
| `updatedAt`          | `updatedAt` de la fila de origen                            |

#### `payload` de `PRODUCT` (v4)

```jsonc
{
  "storeProductId": "uuid",
  "productId": "uuid",
  "businessId": "uuid",
  "storeId": "uuid",
  "localName": "Refresco de cola 1.5 L",
  "barcodes": ["7501031311309", "7501031311316"], // v4: lista, obligatoria, [] si no tiene ninguno
  "localCategoryId": "uuid", // null
  "price": 450, // ≤ 2 decimales — ver la fila de abajo y § ⑤ Reconciliación
  "currency": "CUP",
  "canonicalProductId": null,
  "imageUrl": null,
  "publishToStore": true,
  "updatedAt": "2026-08-25T14:03:00.000Z", // guarda anti-rancio
}
```

| Campo      | Tipo       | Obligatorio   | Notas                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `barcodes` | `string[]` | **sí**        | `[]` es válido. Cada elemento es texto — un GTIN con cero inicial no sobrevive a un número. Los que no son un GTIN válido (8/12/13/14 dígitos) se descartan en silencio, sin fallar el evento                                                                                                                                                       |
| `barcode`  | —          | **prohibido** | Su sola presencia en el `payload` — con cualquier valor, incluido `null` — responde `400 INVALID_BATCH` del lote entero (v3 → v4, ver § Cambios respecto a la v3)                                                                                                                                                                                   |
| `price`    | `number`   | **sí**        | **Aclaración aditiva (F-014): como máximo 2 decimales.** Con más, los dos lados redondean distinto de forma permanente: `2.675` se serializa aquí `"2.67"` (`toFixed(2)` de JavaScript sobre el doble IEEE-754 más cercano, `2.67499…`) y `round(2.675, 2)` en Postgres da `2.68` — comprobado ejecutando. Es la precondición de § ⑤ Reconciliación |

**La fusión sigue usando un solo código: el menor de los válidos**, en orden
lexicográfico de cadenas — nunca por orden numérico ni por cuál llegó
primero en la lista. Enviar los mismos códigos en otro orden no crea un
producto canónico nuevo. Todos los códigos válidos se guardan (no solo el que
decide la fusión); el resto del diseño de esa tabla y por qué el mismo código
puede terminar en dos canónicos distintos está en
[ADR 0020](adr/0020-todos-los-codigos-una-sola-fusion.md).

**Nunca se envía** `costo`, `margen`, el entero de `existencia`, `Venta`,
`MovimientoStock`, `CierrePeriodo`, `Usuario`, `Rol`, credenciales ni
`Proveedor`. El DTO es la frontera de seguridad: no se puede filtrar lo que
nunca se serializó.

#### `payload` de `STORE`

**Documentado aquí por primera vez.** La v2 ya lo implementa —
`entity: "STORE"` es una de las cinco que el mapeo de arriba lista— pero su
forma nunca se escribió en este documento ni se avisó al equipo de cuadrecaja
(F-011 lo encontró leyendo el código, no leyendo el contrato). Va completo,
con el único campo nuevo de la v3 marcado aparte.

```jsonc
{
  "storeId": "uuid",
  "businessId": "uuid",
  "businessName": "La Rampa",
  "name": "La Rampa · Vedado",
  "description": "Todo para la casa, a dos cuadras de 23 y L.", // null BORRA
  "slug": "tienda-demo", // null — solo se usa al CREAR, para el slug único
  "address": "Calle 23 esq. L, Vedado", // null BORRA
  "city": "La Habana", // null BORRA
  "province": null,
  "latitude": null,
  "longitude": null,
  "phone": null,
  "whatsapp": "+5350000001", // null BORRA
  "email": null,
  // F-022 (v9): objeto con versión y las siete claves del día, o AUSENTE/null
  // para dejar la columna intacta. Ver la forma completa y sus reglas en
  // «Cambios respecto a la v8», arriba. Un valor que no cumple el formato
  // rechaza ESTE evento entero con STORE_OPENING_HOURS_INVALID.
  "openingHours": {
    "version": 1,
    "days": {
      "mon": [{ "from": "09:00", "to": "18:00" }],
      "tue": [{ "from": "09:00", "to": "18:00" }],
      "wed": [{ "from": "09:00", "to": "18:00" }],
      "thu": [{ "from": "09:00", "to": "18:00" }],
      "fri": [{ "from": "22:00", "to": "02:00" }], // cruza la medianoche
      "sat": [{ "from": "00:00", "to": "24:00" }], // abierto todo el día
      "sun": [],
    },
  },
  "baseCurrency": "CUP", // por defecto CUP si se omite
  // F-032 (v7): las cinco de la configuración de compra. Las cinco son
  // OPCIONALES y las cinco dejan la columna INTACTA si se omiten — ver la
  // tabla ausente/`null`/valor de § «Cambios respecto a la v6» y la tabla de
  // propiedad de campos, justo abajo.
  "checkoutMode": "ONSITE",
  "deliveryEnabled": true,
  "deliveryFee": 500.0,
  "deliveryFeeMode": "FLAT_RATE",
  "orderExpiryHours": 24,
  "publishToStore": true, // el opt-in del negocio para ESTA tienda
  "unpublishReason": null, // string?, ≤ 160 caracteres — v3, ver abajo
  "updatedAt": "2026-08-25T14:03:00.000Z", // guarda anti-rancio (HD10/AP6)
}
```

`publishToStore: false` suspende la tienda (`Store.status = "SUSPENDED"`);
`true` la publica o la reabre.

**Dos semánticas de omisión conviven en este mismo `payload`, y hay que
decirlo con todas las letras** (corregido en la v7 — I1 de F-032, la versión
anterior de este párrafo describía un comportamiento que el código nunca tuvo):

- **Los campos de contacto** —`description`, `address`, `city`, `province`,
  `latitude`, `longitude`, `phone`, `whatsapp`, `email`— se escriben con
  `payload.x ?? null`: **omitirlos BORRA la columna**, igual que enviar
  `null` explícito. No hay forma de "no tocar" uno de estos nueve campos en
  un `UPDATE`: si no viaja con su valor actual, se pierde.
- **`openingHours` y las cinco de la configuración de compra** (`checkoutMode`,
  `deliveryEnabled`, `deliveryFee`, `deliveryFeeMode`, `orderExpiryHours`) se
  comportan al revés: **ausente deja la columna exactamente como estaba**.
  Solo `deliveryFee` acepta además un `null` explícito, que sí borra el
  importe (tabla de arriba).

##### Tabla de propiedad de campos (F-022, criterio 4)

Quién es dueño de cada columna de `Store` y de `StoreProduct` y qué hace un
evento que la toca — las **31** de `Store` (30 de siempre más `timezone`) y
las **23** de `StoreProduct`, 54 filas en total. Hasta la v8 esta tabla solo
traía los cinco campos de configuración de compra de F-032, con una nota
diciendo que el resto quedaba pendiente para esta versión; esas cinco filas
se conservan con su texto tal cual («cuadrecaja (desde v7)»).

**`Store`** — 31 columnas:

| Campo                | Dueño                                         | Un evento `STORE` que lo trae                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | plataforma                                    | Nada: la fila se localiza por `storeId` (el `externalId` interno), el `id` no viaja                                                                                                                                                                                              |
| `businessId`         | plataforma                                    | Nada. El negocio sale del token autenticado, no del `payload`; una tienda cuyo `storeId` es de otro negocio se ignora                                                                                                                                                            |
| `storefrontId`       | plataforma (registro de marcas)               | Se fija al crear y no se mueve. Solo lo mueve el panel cuando el negocio agrupa dos tiendas en una marca                                                                                                                                                                         |
| `externalId`         | cuadrecaja                                    | Se escribe al crear, desde `payload.storeId`. Es la identidad de la `Tienda` en el POS y la clave de búsqueda                                                                                                                                                                    |
| `slug`               | plataforma (registro de slugs)                | Nada. `payload.slug` es **semilla de derivación** al crear y nada más — si el valor está tomado o es reservado, queandabuscando deriva el siguiente libre en silencio (nunca falla)                                                                                              |
| `name`               | cuadrecaja                                    | Escribe el nuevo valor. Viaja siempre                                                                                                                                                                                                                                            |
| `description`        | cuadrecaja                                    | Escribe el valor; **ausente o `null` BORRA** la columna                                                                                                                                                                                                                          |
| `status`             | compartida, árbitro escrito                   | El sync la toca **solo** si `publishToStore` difiere del valor ya guardado; el panel de administración la escribe cuando el negocio cierra o reabre a mano. Desde F-022, pasar a `PUBLISHED` exige una `timezone` que queandabuscando reconozca (`STORE_TIMEZONE_INVALID` si no) |
| `phone`              | cuadrecaja                                    | Escribe el valor; ausente o `null` BORRA                                                                                                                                                                                                                                         |
| `whatsapp`           | cuadrecaja                                    | Ídem                                                                                                                                                                                                                                                                             |
| `email`              | cuadrecaja                                    | Ídem                                                                                                                                                                                                                                                                             |
| `address`            | cuadrecaja                                    | Ídem                                                                                                                                                                                                                                                                             |
| `city`               | cuadrecaja                                    | Ídem                                                                                                                                                                                                                                                                             |
| `province`           | cuadrecaja                                    | Ídem                                                                                                                                                                                                                                                                             |
| `latitude`           | cuadrecaja                                    | Ídem                                                                                                                                                                                                                                                                             |
| `longitude`          | cuadrecaja                                    | Ídem                                                                                                                                                                                                                                                                             |
| `openingHours`       | cuadrecaja                                    | Escribe el calendario **completo**, por reemplazo. Ausente o `null` deja la columna intacta. Desde la v9, un valor que no cumple el formato **no se guarda** — rechaza el evento (`STORE_OPENING_HOURS_INVALID`)                                                                 |
| `timezone`           | **panel**                                     | **Nada.** No es un campo del `payload`; si llega una clave `timezone` de todos modos, se descarta sin error. Se corrige a mano en queandabuscando mientras el panel no tenga editor                                                                                              |
| `checkoutMode`       | cuadrecaja (desde v7)                         | Escribe el nuevo valor; ausente la deja intacta                                                                                                                                                                                                                                  |
| `deliveryEnabled`    | cuadrecaja (desde v7)                         | Ídem                                                                                                                                                                                                                                                                             |
| `deliveryFee`        | cuadrecaja (desde v7)                         | Escribe el nuevo valor, o `NULL` si llega `null` explícito                                                                                                                                                                                                                       |
| `deliveryFeeMode`    | cuadrecaja (desde v7)                         | Escribe el nuevo valor; ausente la deja intacta                                                                                                                                                                                                                                  |
| `orderExpiryHours`   | cuadrecaja (desde v7; antes, queandabuscando) | Ídem                                                                                                                                                                                                                                                                             |
| `publishedAt`        | sync                                          | Se pone al publicar o republicar, y se borra al suspender, siempre junto a `status` y con la misma puerta. El panel no la toca ni al reabrir                                                                                                                                     |
| `disabledReasonCode` | panel (vocabulario propio)                    | El sync solo la pone a `null`: al suspender por un cambio de `publishToStore`, y al republicar                                                                                                                                                                                   |
| `disabledMessage`    | compartida, árbitro escrito                   | El sync escribe `unpublishReason ?? null` al suspender por un cambio de opt-in; el panel escribe su propio texto libre al cerrar desde la interfaz. Gana el último que actúe                                                                                                     |
| `disabledAt`         | compartida, árbitro escrito                   | El sync la pone al suspender y la borra al republicar; el panel, al cerrar y al abrir                                                                                                                                                                                            |
| `sourceUpdatedAt`    | cuadrecaja                                    | Escribe `payload.updatedAt` en todo evento aplicado. Un evento con `updatedAt` menor o igual al guardado no escribe nada (guarda anti-rancio)                                                                                                                                    |
| `sourceOptIn`        | cuadrecaja                                    | Escribe `payload.publishToStore` (y `false` en un `DELETE`)                                                                                                                                                                                                                      |
| `createdAt`          | plataforma                                    | Nada: default de la base                                                                                                                                                                                                                                                         |
| `updatedAt`          | plataforma                                    | Se mueve sola en cualquier evento aplicado                                                                                                                                                                                                                                       |

**`StoreProduct`** — 23 columnas:

| Campo                   | Dueño                            | Un evento `PRODUCT` que lo trae                                                                                 |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                    | plataforma                       | Nada                                                                                                            |
| `storeId`               | plataforma                       | Se fija al crear, desde la tienda que resuelve el evento                                                        |
| `canonicalProductId`    | plataforma (fusión canónica)     | Se recalcula en cada evento, por identidad de código de barras — nunca lo decide el `payload` directamente      |
| `externalId`            | cuadrecaja                       | Se escribe al crear. Identidad del `ProductoTienda`                                                             |
| `slug`                  | plataforma                       | Se deriva **solo al crear** y se congela: renombrar en el POS cambia `localName`, nunca esto                    |
| `localName`             | cuadrecaja                       | Escribe el nuevo valor                                                                                          |
| `syncedPrice`           | cuadrecaja                       | Escribe el nuevo valor. El precio efectivo es `priceOverride ?? syncedPrice`                                    |
| `syncedPriceCurrency`   | cuadrecaja                       | Escribe el nuevo valor                                                                                          |
| `availability`          | cuadrecaja                       | Escribe el enum de tres valores. El entero de existencias y su umbral **nunca cruzan la frontera** (§ de abajo) |
| `localCategoryId`       | cuadrecaja                       | Se resuelve desde la categoría del `payload`                                                                    |
| `sourceUpdatedAt`       | cuadrecaja                       | Guarda anti-rancio: un evento más viejo que el guardado no escribe nada                                         |
| `syncedAt`              | plataforma                       | Instante de la escritura local, no del `payload`                                                                |
| `deletedAt`             | cuadrecaja                       | Un `DELETE` la pone; un producto que reaparece la vuelve a `null`                                               |
| `description`           | **panel**                        | **Nada: sobrevive.** Un evento `PRODUCT` nunca la toca                                                          |
| `imageUrls`             | **panel**                        | Nada: sobrevive                                                                                                 |
| `priceOverride`         | **panel**                        | Nada: sobrevive. Un override de cero es un precio real, no un valor ausente                                     |
| `priceOverrideCurrency` | **panel**                        | Nada: sobrevive                                                                                                 |
| `visible`               | **panel**                        | Nada: sobrevive                                                                                                 |
| `featured`              | **panel**                        | Nada: sobrevive                                                                                                 |
| `searchDocument`        | de ninguno de los dos (derivado) | Se **recalcula** desde el estado de la fila, nunca se copia del `payload`                                       |
| `searchVector`          | de ninguno de los dos (derivado) | Ídem, calculado por queandabuscando                                                                             |
| `createdAt`             | plataforma                       | Nada                                                                                                            |
| `updatedAt`             | plataforma                       | Se mueve sola                                                                                                   |

**El umbral de stock bajo no existe en ninguna columna de `Store` ni de
`StoreProduct`, aquí ni en el cable.** Se configura y se queda en cuadrecaja:
calcular el enum `Availability` requiere el conteo de existencias, que nunca
viaja hacia queandabuscando.

##### Novedades de esta versión — `unpublishReason` y disponibilidad de slug

Un solo campo nuevo, opcional, aditivo. **No hace falta ningún cambio en
cuadrecaja**: omitirlo deja el comportamiento de hoy exactamente igual, y un
lector que solo conoce la v2 sigue funcionando sin tocar una línea.

| Campo             | Tipo    | Notas                                                                                                                                                                              |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishToStore`  | boolean | El opt-in del negocio para esta tienda. (ya en la v2)                                                                                                                              |
| `unpublishReason` | string? | **v3, opcional.** Motivo visible al comprador cuando `publishToStore` es `false`. Texto plano, ≤ 160 caracteres, se pinta como texto. Se ignora cuando `publishToStore` es `true`. |
| `updatedAt`       | string  | ISO 8601 con desplazamiento. Guarda anti-rancio. (ya en la v2)                                                                                                                     |

Dos avisos de comportamiento que no cambian el cable pero sí lo que el POS
puede observar (HD10-HD15, el interruptor del panel de administración):

1. **El panel de administración puede cerrar y abrir la tienda por su
   cuenta.** Un `GET` del POS puede encontrar una tienda cerrada que él nunca
   cerró — el negocio la cerró desde queandabuscando, con un motivo de una
   lista fija (vacaciones, adecuaciones, etc.) que el POS nunca ve.
2. **Un evento `STORE` con `publishToStore: true` puede reabrir una tienda
   que el negocio cerró desde el panel.** queandabuscando solo reescribe el
   estado cuando el `publishToStore` del evento difiere del que ya tenía
   registrado — una edición rutinaria (cambiar el teléfono, por ejemplo) que
   repite el mismo valor no reabre nada — pero un evento que sí cambia el
   opt-in siempre gana, sea cual sea su origen.

**Qué tiene que hacer el otro equipo: nada**, salvo decidir si quiere mandar
`unpublishReason` cuando desactive una tienda desde el propio POS. Y, aparte
de esta propuesta: la sección `payload de STORE` de arriba documenta también
lo que la v2 ya envía y nunca se comunicó — conviene que este anuncio lleve
los dos avisos juntos, no solo el campo nuevo.

**F-017 (Storefront), sumado al mismo anuncio.** `slug` en el `payload` de
`STORE` sigue siendo «solo se usa al CREAR» —ahora para el slug de la
**marca**, no de la sucursal— y sigue sin poder fallar el evento nunca: si el
valor está tomado o es una palabra reservada, queandabuscando lo convierte en
el siguiente libre en silencio. El endpoint ⑥ de abajo es la forma de saber,
antes de publicar, en qué se va a convertir.

##### ⑥ Disponibilidad de slug (aditiva)

```
GET /api/internal/slug-availability?slug=<candidato>&name=<nombre>&storeId=<Tienda.id>
Authorization: Bearer <token del negocio>
```

Un pronóstico de qué slug quedaría **si se publicara ahora**, nunca una
reserva: **no reserva** nada (no aparta el valor) y **no garantiza** nada
(entre la consulta y la publicación otro puede quedarse el valor). Al menos
uno de `slug`/`name`; `storeId` es opcional (el `Tienda.id` de esta tienda,
si ya se conoce) y solo decide `own` frente a `taken`.

**El `storeId`, si se envía, tiene que ser de una tienda del negocio
autenticado (v3).** Uno de otro negocio se trata como si no se hubiera
enviado: `storeKnown: false` y `reason` nunca `"own"` — nunca un error, y
nunca la forma de averiguar si un `Tienda.id` ajeno existe en otro negocio.
El resto de la respuesta (`candidate`/`available`/`resolvedSlug`/`url`) no se
acota: el espacio de slugs es global y público.

```jsonc
{
  "candidate": "la-rampa", // lo evaluado, ya normalizado
  "available": false, // ¿queda tal cual?
  "reason": "taken", // free | own | taken | reserved | retired | invalid
  "resolvedSlug": "la-rampa-2", // el slug que quedaría si se publicara AHORA
  "url": "https://queandabuscando.com/la-rampa-2",
  "storeKnown": true, // ¿existe ya la tienda de storeId en esta base?
  "reserving": false, // SIEMPRE false
}
```

| `reason`   | Cuándo                                                         |
| ---------- | -------------------------------------------------------------- |
| `free`     | Nadie lo tiene                                                 |
| `own`      | Lo tiene la marca de `storeId`: publicar no lo cambia          |
| `taken`    | Lo tiene otra marca u otra sucursal                            |
| `reserved` | Es una palabra reservada (`admin`, `api`, `sesion-cerrada`, …) |
| `retired`  | Existió y su dueño desapareció: **no vuelve al pool**          |
| `invalid`  | Nada convertible en slug, o pasa de 80 caracteres              |

Errores: `400 { "error": "MISSING_QUERY" }` sin `slug` ni `name`; `401`/`503`
del mismo guard que el resto de `/api/internal/*`. Un `storeId` desconocido
**no** es error: es el caso normal antes de publicar (`"storeKnown": false`).

**Qué tiene que hacer el otro equipo: nada obligatorio.** `Tienda.slug` ya
está en la lista de cambios de abajo desde la v1. Lo único opcional es
llamar a este endpoint desde la pantalla donde el POS edita el slug de una
tienda, para mostrarle al comerciante qué dirección va a quedar antes de que
la publique.

#### `payload` de `CATEGORY`

**Documentado aquí por primera vez** (v10.1). La forma es la que el lado
receptor valida y aplica desde la v2: no cambia nada de lo implementado, solo
deja de estar únicamente en nuestro código.

```jsonc
{
  "categoryId": "uuid", // Categoria.id — la identidad, junto al negocio del token
  "businessId": "uuid", // redundante y comprobado (§ Formato)
  "name": "Bebidas",
  "color": "#1E88E5", // null — y omitirlo TAMBIÉN borra, ver abajo
  "updatedAt": "2026-09-04T14:03:00.000Z", // guarda anti-rancio
}
```

| Campo        | Tipo     | Obligatorio | Notas                                                                                                                                                                                                            |
| ------------ | -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categoryId` | `string` | **sí**      | `Categoria.id`. La identidad es el par `(negocio del token, categoryId)`, nunca el nombre                                                                                                                        |
| `businessId` | `string` | **sí**      | Tiene que coincidir con el del token; si no, `403 BUSINESS_MISMATCH` del lote entero (§ Formato)                                                                                                                 |
| `name`       | `string` | **sí**      | No vacío. Renombrar aquí **no** cambia la URL pública de la categoría                                                                                                                                            |
| `color`      | `string` | no          | Sin validar como color: se guarda tal cual. **Omitirlo borra la columna**, igual que enviar `null` — misma semántica que los campos de contacto de `STORE`, no la de sus cinco campos de configuración de compra |
| `updatedAt`  | ISO 8601 | **sí**      | Guarda anti-rancio: un evento con `updatedAt` **menor o igual** al guardado no escribe nada y responde `stale`                                                                                                   |

**`LocalCategory`** — 8 columnas:

| Campo              | Dueño      | Un evento `CATEGORY` que lo trae                                                                                                                                 |
| ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | plataforma | Nada                                                                                                                                                             |
| `businessId`       | plataforma | Se fija al crear, desde el negocio del token                                                                                                                     |
| `externalId`       | cuadrecaja | Se escribe al crear, con `categoryId`                                                                                                                            |
| `name`             | cuadrecaja | Escribe el nuevo valor                                                                                                                                           |
| `slug`             | plataforma | Se deriva **solo al crear**, del `name`, y se congela. No es un campo del `payload`: el POS no puede elegirlo ni cambiarlo, y renombrar la categoría no lo mueve |
| `color`            | cuadrecaja | Escribe `color ?? null` — omitirlo borra                                                                                                                         |
| `globalCategoryId` | **panel**  | **Nada: sobrevive.** La taxonomía del marketplace es nuestra                                                                                                     |
| `sourceUpdatedAt`  | cuadrecaja | Escribe `payload.updatedAt` en todo evento aplicado                                                                                                              |

`slug` es el identificador público en `/[slug]/c/[categorySlug]`, único por
negocio. Congelarlo es deliberado: una categoría renombrada no rompe el enlace
que alguien compartió. Un `DELETE` sí devuelve ese valor al pool del negocio —
a diferencia de los slugs de primer nivel, que no vuelven nunca (§ ⑥).

**Un `DELETE` borra la fila y deja sus productos publicados y sin categoría.**
`StoreProduct.localCategoryId` pasa a `NULL` por la propia clave ajena; los
productos no se reasignan ni se despublican. Un `DELETE` de una categoría que
aquí no existe responde `processed`: no hay nada que hacer.

**El orden importa, y su fallo es silencioso.** Un `PRODUCT` cuyo
`localCategoryId` apunta a una categoría que todavía no llegó **no falla**: se
guarda sin categoría, con `localCategoryId` a `NULL`, y se queda así hasta el
siguiente evento de ese producto — el evento de la categoría, cuando llegue, no
va a buscar quién la esperaba. Fallar el evento sería peor (bloquearía el
producto por un dato accesorio), pero la consecuencia es la que es: **emitid la
categoría antes que sus productos**, y si el orden ya se invirtió, reenviad los
productos afectados.

Las páginas de las sucursales que tengan productos en esa categoría se
invalidan solas, sin que el POS pida nada.

#### `payload` de `CURRENCY`

**Documentado aquí por primera vez** (v10.1). Es la más asimétrica de las
cinco: tiene tres particularidades, y las tres importan.

```jsonc
{
  "code": "USD", // exactamente 3 caracteres — es la identidad
  "name": "Dólar estadounidense",
  "symbol": "$",
  "active": true, // por defecto true si se omite
  "updatedAt": "2026-09-04T14:03:00.000Z", // se valida, NO se usa
}
```

| Campo       | Tipo      | Obligatorio | Notas                                                                                                        |
| ----------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `code`      | `string`  | **sí**      | Longitud exacta 3. Es la clave primaria, y es **global** — ver abajo                                         |
| `name`      | `string`  | **sí**      | No vacío                                                                                                     |
| `symbol`    | `string`  | **sí**      | No vacío                                                                                                     |
| `active`    | `boolean` | no          | `true` si se omite                                                                                           |
| `updatedAt` | ISO 8601  | **sí**      | Se valida el formato y **no se compara con nada**: aquí no hay guarda anti-rancio (ver la tercera asimetría) |

**① No lleva `businessId`, y no es un olvido: la tabla es global a la
plataforma.** Hay una fila por `code`, compartida por todos los negocios. Un
evento `CURRENCY` de un negocio reescribe el `name` y el `symbol` que ven los
demás. Por eso es el único `payload` que la comprobación de identidad se salta
(§ Formato): no hay campo que comprobar. En la práctica: **enviad el nombre y
el símbolo internacionales de la moneda, nunca una denominación interna del
comercio.**

**② `operation` se ignora por completo.** `CREATE`, `UPDATE` y `DELETE` hacen
exactamente el mismo upsert. **Un `DELETE` no borra ninguna moneda**; para
retirar una, enviad `active: false`.

**③ No hay guarda anti-rancio.** Gana el último evento que llegue, no el de
`updatedAt` más reciente. Con reintentos, dos eventos del mismo `code` pueden
aplicarse al revés y dejar el nombre viejo. Se convive con ello a propósito —
el nombre de una moneda no cambia casi nunca—, pero conviene saberlo antes de
que pase.

Hoy ninguna página pública lee esta tabla: los importes se muestran con el
código (`CUP`, `USD`), no con `symbol`. La fila existe para que la clave ajena
de `ExchangeRate` resuelva y para el día que el marketplace formatee con
símbolo. Enviar `CURRENCY` no cambia nada visible por sí solo.

#### `payload` de `EXCHANGE_RATE`

**Documentado aquí por primera vez** (v10.1). Es la única entidad de las cinco
que **no** actualiza una fila: la añade.

```jsonc
{
  "businessId": "uuid",
  "currency": "USD", // exactamente 3 — "CUP" se descarta, ver abajo
  "rate": 420, // > 0. CUP por 1 unidad de `currency`
  "updatedAt": "2026-09-04T14:03:00.000Z", // se valida, NO se usa
}
```

| Campo        | Tipo     | Obligatorio | Notas                                                                                                                  |
| ------------ | -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `businessId` | `string` | **sí**      | Tiene que coincidir con el del token; si no, `403 BUSINESS_MISMATCH` del lote entero. Las tasas **sí** son por negocio |
| `currency`   | `string` | **sí**      | Longitud exacta 3. `"CUP"` responde `skipped_not_published` — ver abajo                                                |
| `rate`       | `number` | **sí**      | Estrictamente mayor que cero. Se guarda como `Decimal(18,6)`: **6 decimales**, y a partir del séptimo se redondea      |
| `updatedAt`  | ISO 8601 | **sí**      | Se valida el formato y no se compara con nada: al ser append-only no hay fila anterior con la que comparar             |

**`rate` es «CUP por 1 unidad de `currency`», y CUP nunca viaja.** Es el ancla:
una tasa de CUP contra sí mismo dejaría el ancla ambigua. Un evento con
`currency: "CUP"` no es un error — responde `skipped_not_published`, que va en
`ok` y no se reintenta (§ Respuesta).

**Cada evento inserta una fila; no hay actualización ni deduplicación por
valor.** La tabla es el histórico. Reenviar el **mismo** evento no duplica
nada: lo para la idempotencia por `eventId` del inbox, que responde `duplicate`
(§ Idempotencia). Dos eventos distintos con la misma tasa sí dejan dos filas, y
está bien.

**La tasa vigente es la última que LLEGÓ, no la de `updatedAt` más reciente.**
Quien lee toma la fila más nueva por su instante de escritura. Un reenvío
desordenado de una tasa vieja la convierte en la vigente. **Para corregir una
tasa, enviad la correcta otra vez**: otro evento, otra fila, y esa pasa a ser
la vigente. No hay forma de borrar una fila de tasas por este contrato — y
`operation` también se ignora aquí, así que un `DELETE` inserta igual. No lo
enviéis.

**Si la moneda no existe todavía, se crea al vuelo con `name` y `symbol`
iguales al código** (`USD` / `USD`). No falla, pero deja una fila provisional
en la tabla global de monedas hasta que un evento `CURRENCY` la corrija:
**enviad `CURRENCY` antes que su primera `EXCHANGE_RATE`.**

**Ni `CURRENCY` ni `EXCHANGE_RATE` invalidan ninguna caché.** Una tasa nueva
puede tardar hasta una hora en verse en el catálogo público —el suelo de
revalidación de la vitrina, 3600 s—. El checkout, en cambio, las lee frescas
en cada pedido: **un pedido nunca se cotiza con una tasa caducada**, aunque la
vitrina todavía muestre la anterior.

### Transformación en queandabuscando

1. `publishToStore: false` → borrado suave del `StoreProduct`. Fin.
2. Resolver identidad canónica, a partir de `barcodes` normalizados
   (espacios/guiones fuera, solo los GTIN de 8/12/13/14 dígitos válidos),
   deduplicados y ordenados ascendente por cadena:
   - `canonicalProductId` presente → usarlo (los códigos igual se guardan
     contra ese canónico, paso 4)
   - ausente pero con al menos un código válido → buscar o crear el canónico
     por el **menor** de ellos
   - ninguno de los dos → crear canónico **huérfano** con `isExclusive: true`
3. Crear o actualizar `StoreProduct` por `(storeId, canonicalProductId)`
4. **(v4, F-024)** Guardar cada código válido de `barcodes` contra el
   canónico resuelto en el paso 2, en `CanonicalBarcode`. Aditivo: se
   insertan los que falten y no se borra ninguno, ni siquiera si un envío
   posterior deja de mencionarlo. No aplica en la rama huérfana (no hay
   ningún código válido que guardar) ni en el paso 1 (borrado suave: fin
   antes de llegar aquí).
5. Crear o actualizar `ProductAlias`, `useCount++`
6. Si el alias es **nuevo** → recalcular el `searchDocument` del canónico

El paso 2 es la degradación elegante del diseño: **nunca hay un producto que no
se pueda publicar**. Un producto sin identidad resuelta se publica igual en su
propia tienda, con su nombre local, y solo queda fuera del marketplace.

El paso 4 es deliberadamente independiente del paso 2: guardar todos los
códigos y decidir la identidad por uno solo son decisiones separadas
([ADR 0020](adr/0020-todos-los-codigos-una-sola-fusion.md)). Un código que ya
es el `ean` de OTRO canónico no fusiona nada — puede terminar viviendo en dos
canónicos a la vez, a propósito: relacionarlos es un feature futuro, no este.

El paso 6 es el fácil de olvidar y degrada la búsqueda en silencio. Está
implementado como efecto explícito del handler, no como responsabilidad de quien
llama. `CanonicalBarcode` nunca entra en el `searchDocument` ni en el
`searchVector`: buscar por código de barras no es parte de este contrato.

### Respuesta

```jsonc
{
  "ok": ["evt-1", "evt-2"], // marca el outbox como hecho
  "failed": [{ "id": "evt-3", "error": "..." }], // reintenta solo esto
  "results": [
    // detalle, para logs
    { "eventId": "evt-1", "status": "processed" },
    { "eventId": "evt-2", "status": "duplicate" },
  ],
}
```

`status` ∈ `processed` · `duplicate` · `skipped_not_published` · `stale` ·
`failed`. **Todo lo que no sea `failed` aparece en `ok`**: son estados
terminales, reenviarlos no cambiaría nada.

`skipped_not_published` **no es un error**: es lo que hace funcionar el opt-in
por local sin que los dos sistemas tengan que coordinarse. Un evento de una
tienda que aquí no existe se descarta limpiamente.

Un `PRODUCT` con `operation: UPDATE` **nunca** toca `priceOverride`,
`description`, `imageUrls`, `visible` ni `featured`: son del panel.

---

## ② Disponibilidad

**Nada de esto toca el camino de venta**, que en cuadrecaja ya hace 18–19
queries y ya tuvo timeouts.

El lote también lleva `businessId` en la raíz (`{ businessId, items[] }`), con
la misma regla de ① (v3): redundante y comprobado contra el token, nunca
autoritativo — un `businessId` que no coincide responde `403 BUSINESS_MISMATCH`
sin aplicar nada del lote. `items[]` se identifica por `storeId`, no por
negocio: un item de una tienda ajena simplemente no se confirma (§ Query
convergente).

### Lo que viaja es un enum, no el entero

```
existencia <= 0            → OUT_OF_STOCK
existencia <= umbralBajo   → LOW_STOCK
resto                      → AVAILABLE
```

Tres consecuencias: los negocios no exponen su inventario a la competencia;
vender 3 unidades de 40 **no genera ninguna escritura** porque el enum no
cambió; y el volumen cae uno o dos órdenes de magnitud.

### Query convergente, no cursor de tiempo

El instinto es `WHERE updatedAt > ultimaSincronizacion`. **Tiene un bug de
pérdida de datos**: una transacción fija `updatedAt = T1` y se confirma en
`T2 > T1`; si el cron corre entre ambos no ve la fila, el cursor avanza más allá
de T1, y esa fila no se sincroniza nunca. Aparece semanas después como «un
producto figura disponible y está agotado».

En su lugar, una consulta declarativa de divergencia contra `dispPublicada`:

```sql
-- índice PARCIAL: solo indexa las filas divergentes, así que es diminuto
CREATE INDEX CONCURRENTLY idx_disp_divergente ON "ProductoTienda" (id)
WHERE (CASE WHEN existencia <= 0             THEN 'OUT_OF_STOCK'
            WHEN existencia <= "umbralBajo"  THEN 'LOW_STOCK'
            ELSE                                  'AVAILABLE' END)
      IS DISTINCT FROM "dispPublicada";
```

No hay ventana de pérdida, se auto-repara (si el cron no corrió tres horas, la
próxima corrida ve exactamente lo pendiente) y es O(cambios), no O(catálogo).

Tras el POST, se confirma **solo lo que la respuesta devolvió** en `confirmed`:

```sql
UPDATE "ProductoTienda" SET "dispPublicada" = $3
WHERE "productoId" = $1 AND "tiendaId" = $2;
```

Un producto que esta base no pudo resolver **no aparece en `confirmed`**, sigue
divergente en el POS y se reintenta. Esa es la propiedad de auto-reparación.

---

## ③④ Pedidos

El POS los **lee**; queandabuscando nunca escribe en el POS.

```
GET /api/internal/orders?since=<último id visto>&limit=100
→ { orders: [...], nextCursor: "42" | null }
```

`nextCursor: null` significa «al día». El id es un `BIGINT` autoincremental, así
que el cursor es monotónico. **Un pedido devuelto por el pull incremental**
pasa de `PENDING` a `PULLED` (v8, F-033: esta frase se acota al pull —
ninguna lectura lateral, más abajo, marca nada), y **no se borra**: la página
de estado del cliente sigue funcionando.

**Este endpoint asume un único poller por negocio, secuencial.** La lectura
(`findMany`) y la marca como `PULLED` (`updateMany`) no son atómicas entre sí.
Dos pollers del mismo negocio corriendo a la vez pueden leer el mismo pedido
antes de que el primero lo marque, y ambos lo entregarían: el POS lo vería
duplicado. Es responsabilidad de cuadrecaja no correr dos instancias del
poller de un mismo negocio en paralelo.

**El cursor es por negocio (v3).** `since` se interpreta solo contra los
pedidos del negocio autenticado por el token — cuadrecaja tiene que guardar
un `ultimoPedidoVisto` **por negocio**, no uno solo. Los ids siguen siendo un
`BIGINT` global y creciente compartido por todos los negocios, así que la
secuencia que ve un negocio concreto tiene huecos (los ids de otros negocios
intercalados): eso es correcto y **no** indica que se perdió ningún pedido —
el POS no debe asumir continuidad en los ids que recibe.

`POST /api/internal/orders/status` y `GET /api/internal/reconciliation` (⑤,
más abajo) siguen la misma regla: un `orderId`/`storeId` de otro negocio
responde exactamente igual que uno inexistente (`404`, § Vocabulario de
errores) — nunca un error distinto que confirme que el recurso existe en otro
lado.

### Las lecturas laterales (v8, F-033)

El pull incremental de arriba solo entrega un pedido **una vez**: `id > since`
lo excluye para siempre en cuanto el cursor lo supera. Pero la resolución de
una propuesta de renegociación ocurre sobre un pedido que el POS **ya
pulleó** — su `id` es menor que el cursor —, así que sin otra forma de leer,
el POS nunca se entera de que el comprador aprobó o rechazó. `GET
/api/internal/orders` gana dos formas de lectura lateral que resuelven eso,
**ignorando el cursor por completo**:

```
GET /api/internal/orders?status=<UN estado>&limit=&after=<id>
→ { orders: [...], nextCursor: null, nextAfter: "<id>" | null }

GET /api/internal/orders?ids=<a>,<b>
→ { orders: [...], nextCursor: null, nextAfter: null }
```

- **`?status=`** relee todos los pedidos del negocio en **un solo** estado de
  los nueve del enum (una coma, `?status=PULLED,CONFIRMED`, es `400`; ampliar
  a lista es aditivo el día que haga falta, precisamente porque hoy es un
  rechazo). Es la pregunta del ciclo normal: el POS no necesita llevar la
  lista de qué pedidos tiene en `AWAITING_CUSTOMER`, solo preguntar.
- **`?ids=`** relee un conjunto puntual y ya conocido, hasta **100** ids
  separados por coma. Más de 100 responde `400 INVALID_QUERY` —nunca la lista
  recortada en silencio—, y un id repetido se sirve una sola vez.
- **`?after=<id>`** pagina **solo** `?status=`, sobre su propio puntero,
  `nextAfter`: keyset (`id > after`) sobre el mismo orden ascendente que el
  pull. Solo tiene sentido junto a `?status=`; sin él es `400`.
- **`nextCursor` es SIEMPRE `null` en las dos** — nunca lo que devolvería el
  pull —, y ninguna lectura lateral avanza ni consume el cursor del pull
  incremental: repetir el pull con el `since` que ya tenías devuelve
  exactamente el mismo cuerpo que antes de leer lateralmente. `nextAfter`
  viaja en las dos respuestas laterales (`null` fijo en la de `?ids=`, que no
  pagina) y **nunca** en el pull incremental — un consumidor de la v7 no ve
  un campo que no esperaba.
- **Un id de otro negocio en `?ids=` responde igual que uno inexistente**:
  `200 { "orders": [] }`, sin ningún campo que distinga los dos casos — la
  misma invariante que ya rige `/orders/status` y `/reconciliation` más
  arriba en esta misma sección.
- **`?since=` no convive con `?status=` ni con `?ids=`**, ni `?status=` con
  `?ids=` entre sí, ni `?after=` sin `?status=`, ni `?limit=` con `?ids=`
  (servir 1 de 2 ids pedidos sería la misma lista recortada en silencio que
  el tope de 100 prohíbe): las cinco combinaciones responden
  `400 INVALID_QUERY` en vez de elegir en silencio cuál gana — ver
  § Vocabulario de errores para el mensaje de cada una.
- **Una lectura lateral SÍ aplica los dos vencimientos** (el de una propuesta
  sin respuesta y el del pedido cuyo envío nadie cotizó, § «El envío sin
  cotizar» más abajo) antes de leer, exactamente igual que el pull
  incremental: nunca entrega una propuesta ya caducada como si siguiera viva.
  Es la única escritura que una lectura lateral produce — cancela lo que el
  reloj ya venció —, y es idempotente: repetirla no tiene efecto adicional.
- **Los importes y el resto de campos son idénticos** a los del pull, byte a
  byte: mismo `PulledOrder`, mismo `deliveryFeePending`, mismo `proposal`
  presente solo en `AWAITING_CUSTOMER`. El POS reutiliza su parser sin
  ramificar por endpoint.

`?since=` no lleva el mismo tope que `?after=`/`?ids=`: un `since` por encima
de `2^63−1` sigue respondiendo `500` como hasta hoy —preexistente, fuera del
alcance de F-033—, mientras que `?after=` y cada elemento de `?ids=` por
encima de ese mismo techo responden `400 INVALID_QUERY` en vez de reventar
contra Postgres. Asimetría documentada, no un descuido.

Los campos que ya conocías siguen siendo exactamente lo que eran: `unitPrice`,
`currencyCode`, `lineTotal`, `subtotal`, `discountTotal`, `deliveryFee` y
`total` están **todos en la moneda del pedido** (`Order.currencyCode`), y
`Σ lineTotal = subtotal` se sigue sosteniendo siempre. Un ejemplo completo de
la v2, con un pedido de una línea priceada originalmente en USD:

```jsonc
{
  "orders": [
    {
      "id": "42",
      "code": "A7K3M9PQR2", // ver «Formato de Order.code» más abajo
      "storeExternalId": "uuid",
      "status": "PENDING",
      "contact": { "name": "Ana Pérez", "phone": "+5355555555", "email": null, "address": null },
      "currencyCode": "CUP",
      "subtotal": "880.00",
      "discountTotal": "0.00", // v6: dos decimales SIEMPRE, también el cero
      "deliveryFee": "0.00",
      "total": "880.00",
      "notes": null,
      "createdAt": "2026-08-26T02:00:00.000Z",
      // NUEVO en v2 — las tasas congeladas al confirmar (R9). `{}` cuando el
      // pedido no necesitó convertir nada.
      "rateSnapshot": {
        "base": "CUP",
        "capturedAt": "2026-08-26T02:00:00.000Z",
        "rates": { "USD": "440.000000" },
      },
      "items": [
        {
          "storeProductExternalId": "uuid",
          "name": "Cerveza Cristal",
          "unitPrice": "880.00", // ya convertido — lo de siempre
          "currencyCode": "CUP", // la moneda del pedido — lo de siempre
          "quantity": "2.000",
          "lineTotal": "880.00", // lo de siempre; sigue siendo lo que suma subtotal
          // NUEVOS en v2 — el precio efectivo ANTES de convertir
          "originalUnitPrice": "2.00",
          "originalCurrencyCode": "USD",
          "originalLineTotal": "4.00",
        },
      ],
    },
  ],
  "nextCursor": null,
}
```

Cómo se relacionan los campos nuevos con los de siempre, como fórmula:

```
unitPrice = convert(originalUnitPrice, currencyCode, rateSnapshot.rates)
```

—la misma función que usa queandabuscando internamente (`src/lib/money.ts`),
así que recomputarlo con las tasas del `rateSnapshot` da el mismo céntimo.
**Los importes originales no son sumables** (R5b): con varias líneas en
monedas distintas su suma no significa nada, y `subtotal`/`total` **siguen
siendo** la suma de los `lineTotal` ya convertidos — nunca la de los
originales. Un pedido creado antes de esta versión no tiene los originales
guardados; en ese caso **se emiten los valores ya convertidos como respaldo**,
así que un lector que espera un número ahí nunca se encuentra con `null`.

### El formato de los importes (v6)

**Todos los importes del payload de este endpoint traen dos decimales**, cero
incluido: `"880.00"`, `"0.00"`, `"180.50"`. Aplica a `subtotal`,
`discountTotal`, `deliveryFee`, `total`, a los cuatro importes de `proposal` y a
los de cada línea (`unitPrice`, `lineTotal`, `originalUnitPrice`,
`originalLineTotal`). **`quantity` no es dinero y no cambia**: sigue con sus tres
decimales (`"2.000"`).

Hasta la v5.1 no era así. Los importes se emitían suprimiendo los ceros de
relleno, así que `880,00` salía como `"880"`, `180,50` como `"180.5"` y cero como
`"0"`, mientras el ejemplo publicado aquí mostraba dos decimales. **El ejemplo
estaba mal, no el código**, y en la v6 se arreglan los dos: el ejemplo de arriba
es, por fin, exactamente lo que sale por el cable.

Dos avisos, porque esta regla **no** se extiende sola al resto del documento:

- **§ ⑤ Reconciliación no cambia.** Su hash quita los ceros de relleno **a
  propósito** (`trim(trailing '0' …)` en el SQL espejo) y las dos partes tienen
  que hacer exactamente lo mismo o el hash difiere siempre. No lo toques.
- **§ ① sigue con su propia regla**: `price` viaja con dos decimales **como
  máximo**, que es la precondición de la convergencia del hash.

Y la regla operativa que sobrevive a cualquier versión: **compara importes como
números, nunca como cadenas.**

### El envío sin cotizar (v6, F-031)

Hay negocios que solo saben cuánto cuesta el envío **cuando alguien mira el
pedido**: depende de la dirección, del mensajero libre y de la hora. Hasta la
v5.1, la tienda de ese negocio tenía que inventarse una tarifa fija o no ofrecer
domicilio. En la v6 el comprador puede pedir a domicilio **sin que el importe
del envío exista todavía**, y el pedido llega al POS diciéndolo.

**El campo nuevo es `deliveryFeePending`, y es la única forma de saberlo.**

```jsonc
// Pedido SIN COTIZAR — el importe del envío no existe todavía
{
  "id": "43",
  "status": "PULLED",
  "contact": {
    "name": "Ana Pérez",
    "phone": "+5355555555",
    "email": null,
    "address": "Calle 23 esq. L, Vedado",
  },
  "currencyCode": "CUP",
  "subtotal": "880.00",
  "discountTotal": "0.00",
  "deliveryFee": "0.00", // presente SIEMPRE. Aquí es relleno: NO significa "envío gratis"
  "deliveryFeePending": true, // NUEVO en v6
  "total": "880.00", // PARCIAL: subtotal - discountTotal, sin envío
  "cancelledBy": null,
  "proposal": null,
  // … el resto de los campos, igual que siempre
}
```

```jsonc
// Pedido con envío COTIZADO EN CERO — la tienda lo regaló
{
  "id": "44",
  "status": "CONFIRMED",
  "contact": {
    "name": "Luis Mena",
    "phone": "+5355555556",
    "email": null,
    "address": "Ave. 31 e/ 42 y 44, Playa",
  },
  "currencyCode": "CUP",
  "subtotal": "880.00",
  "discountTotal": "0.00",
  "deliveryFee": "0.00", // el MISMO string que el pedido de arriba, a propósito
  "deliveryFeePending": false, // NUEVO en v6: aquí el cero es un importe acordado
  "total": "880.00", // COMPLETO: subtotal - discountTotal + deliveryFee
  "cancelledBy": null,
  "proposal": null,
  // … el resto de los campos, igual que siempre
}
```

**Los dos pedidos caben en la misma respuesta y su `deliveryFee` es idéntico.**
Eso es deliberado: `deliveryFeePending` es lo único que los distingue.
Cualquier atajo —tratar el `0.00` como gratis, mirar si hay `contact.address`,
comparar `total` con `subtotal`— acierta hoy y falla con el primer envío
regalado. **Esta es la trampa central de esta versión.**

Qué significa `total`, en una frase por caso:

| `deliveryFeePending` | `total`                                  | Qué es                                                 |
| -------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `true`               | `subtotal - discountTotal`               | **Parcial.** Va a crecer cuando se cotice y se apruebe |
| `false`              | `subtotal - discountTotal + deliveryFee` | Completo, lo de siempre                                |

Con `deliveryFeePending: true` la igualdad
`total = subtotal - discountTotal + deliveryFee` **no se sostiene**, porque ese
`deliveryFee` es un relleno y no un importe. No hay un campo `totalIsPartial`:
`deliveryFeePending` **es** esa afirmación, y dos banderas para un mismo hecho
es como nacen las contradicciones.

**Cómo se cotiza: con el endpoint que ya existe.** Cotizar **es** proponer, así
que se usa `POST /api/internal/orders/proposal` (§ La renegociación) con el
`deliveryFee` concreto, y el pedido pasa a `AWAITING_CUSTOMER` para que el
comprador apruebe o rechace. No hay ruta nueva ni un segundo camino para «poner
el envío».

Un detalle práctico que conviene saber **antes** de recibir un `400`: el `items`
de esa llamada es **obligatorio y con al menos una línea**, también cuando lo
único que cambia es el envío. Para cotizar solo el envío se reenvían **las
mismas líneas que el pull acaba de entregar**, con los mismos importes;
aprobar las reescribe idénticas y nada se pierde.

**Qué le pasa al pedido que nadie cotiza.** Vive `Store.orderExpiryHours`
contadas **desde su creación** y después el reloj lo cierra solo: `CANCELLED`
con `cancelledBy: "EXPIRY"` y un `cancelReason` propio, literal: «El pedido
venció sin que la tienda cotizara el envío» — distinto del de la propuesta
vencida, porque el comprador no vio ninguna propuesta. El `409` de más abajo
garantiza que ningún pedido se despachó antes con el total sin cerrar.

Los dos plazos son **independientes y se suman**: un pedido puede vivir sin
cotizar hasta `orderExpiryHours` y, si la tienda cotiza justo antes del límite,
otras `orderExpiryHours` más esperando la respuesta del comprador. Es la
consecuencia de que el campo signifique dos cosas, y es correcto.

### La renegociación (v5, F-019)

**El enum de `status` pasa de 6 a 9 valores.** `PENDING`, `PULLED`,
`CONFIRMED`, `READY`, `DELIVERED`, `CANCELLED` siguen significando exactamente
lo mismo. Los tres nuevos:

| Valor               | Cuándo aparece                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AWAITING_CUSTOMER` | La tienda propuso un cambio (`POST /orders/proposal`, más abajo) y espera la respuesta del comprador           |
| `IN_TRANSIT`        | Entre `READY` y `DELIVERED`. Lo reporta el POS por `POST /orders/status`, igual que los demás                  |
| `REJECTED_BY_STORE` | La tienda no pudo atender el pedido. **No** es un `CANCELLED`: se distingue por `status`, no por `cancelledBy` |

**Tres campos nuevos y aditivos en cada pedido del pull:**

```jsonc
{
  "id": "42",
  "status": "AWAITING_CUSTOMER", // el enum de 9 valores — NO es aditivo, ver arriba
  // NUEVO en v5 — quién cerró el pedido. null mientras no esté cerrado, y en
  // toda fila de antes de esta versión (no hay forma de reconstruirlo).
  "cancelledBy": null, // "CUSTOMER" | "EXPIRY" | "STORE" | null
  // NUEVO en v5 — hacia el COMPRADOR, para que el encargado lo abra con un
  // clic (nadie en queandabuscando envía nada solo). null sin dígitos
  // utilizables en el teléfono guardado.
  "customerWhatsappUrl": "https://wa.me/5355555555?text=...",
  // NUEVO en v5 — presente SOLO mientras status = "AWAITING_CUSTOMER".
  "proposal": {
    "proposedAt": "2026-08-30T14:19:43.000Z",
    "expiresAt": "2026-08-31T14:19:43.000Z",
    "previousTotal": "880.00", // el total vigente antes de esta propuesta
    "subtotal": "1000.00", // los cuatro importes PROPUESTOS
    "discountTotal": "0.00",
    "deliveryFee": "180.00",
    "total": "1180.00",
    "message": "El envío a Playa cuesta 180.", // o null, la tienda no está obligada a escribir uno
  },
}
```

`cancelledBy` distingue los tres desenlaces terminales que antes eran
indistinguibles: `"CUSTOMER"` (el comprador rechazó la propuesta),
`"EXPIRY"` (venció sin respuesta — `cancelReason` trae uno de **dos**
literales desde la v6: «La propuesta venció sin respuesta» cuando lo que venció
fue una propuesta, y «El pedido venció sin que la tienda cotizara el envío»
cuando el pedido murió sin que nadie cotizara el envío, § «El envío sin
cotizar»), `"STORE"` (lo cerró la tienda, por
`CANCELLED` o por `REJECTED_BY_STORE`). `proposal.items` **no** viaja: las
líneas las compuso el propio POS al proponer y no hay ningún camino en el que
necesite leerlas de vuelta.

**`POST /api/internal/orders/proposal`** — la tienda propone un cambio sobre
un pedido en `PULLED`, `CONFIRMED` o (si ya había una propuesta viva)
`AWAITING_CUSTOMER`. Una segunda propuesta **reemplaza** a la primera y
reinicia el plazo; no se guarda historial de las descartadas.

```jsonc
// Cuerpo
{
  "orderId": "42",
  "currencyCode": "CUP", // tiene que ser Order.currencyCode — si no, 400 CURRENCY_MISMATCH
  "subtotal": "1000.00",
  "discountTotal": "0", // opcional, default "0"
  "deliveryFee": "180.00",
  "total": "1180.00", // total = subtotal - discountTotal + deliveryFee, y Σ lineTotal = subtotal
  "message": "El envío a Playa cuesta 180.", // opcional, ≤500 caracteres
  "items": [
    {
      "storeProductId": null, // el id del producto en queandabuscando si se conoce, o null
      "name": "Café Cubita 500 g",
      "unitPrice": "500.00",
      "currencyCode": "CUP",
      "quantity": "2",
      "lineTotal": "1000.00",
    },
  ],
}
```

```jsonc
// Respuesta 200
{
  "ok": true,
  "status": "AWAITING_CUSTOMER",
  "expiresAt": "2026-08-31T14:19:43.000Z",
  "currencyCode": "CUP",
  "previousTotal": "880.00",
  "proposedTotal": "1180.00",
  "orderUrl": "https://tienda-demo.example.com/tienda-demo/pedido/A7K3M9PQR2",
  "customerWhatsappUrl": "https://wa.me/5355555555?text=...", // hacia el comprador
  "customerWhatsappReason": null, // "NO_PHONE_DIGITS" cuando el enlace sale null
}
```

Dos reglas que hay que respetar: los importes llegan **ya en
`Order.currencyCode`** (aprobar no reconvierte nada, y `rateSnapshot` no se
toca jamás — un pedido aprobado tiene el mismo `rateSnapshot`, byte a byte,
que tenía al crearse); y **queandabuscando no envía el mensaje de WhatsApp**
— lo abre una persona, el encargado, con un clic sobre `customerWhatsappUrl`.
`409 ORDER_NOT_PROPOSABLE` (con el `status` actual) cuando el pedido no está
en un estado proponible; `400 CURRENCY_MISMATCH` cuando la moneda no
coincide; ninguno de los dos escribe nada.

**`Store.orderExpiryHours` es de queandabuscando** (24 por defecto): el POS
**no** lo envía y un evento `STORE` **no** lo pisa. **Sigue siendo así en la
v6 — cambia en la v7** (F-032), donde pasa a escribirla cuadrecaja junto con el
resto de la configuración de compra.

**Desde la v6 significa dos cosas**, y las dos usan el mismo número: cuántas
horas dura una propuesta antes de que el reloj la cancele sola, **y** cuántas
horas vive un pedido cuyo envío nadie cotizó, contadas desde su creación
(§ «El envío sin cotizar»). Los dos plazos son independientes y pueden sumarse.

### Formato de `Order.code`

Diez caracteres del alfabeto Crockford base32 en mayúsculas, sin separador:
`0123456789ABCDEFGHJKMNPQRSTVWXYZ` (sin `I`, `L`, `O`, `U` — se confunden al
dictarlos por teléfono). Regex: `^[0-9A-HJKMNP-TV-Z]{10}$`. Es la **única**
credencial de `https://<tienda>/pedido/<code>`, una página pública que muestra
nombre, teléfono y dirección de una persona — trátalo como un secreto de
lectura, no como un identificador cualquiera para loguear o mostrar sin
cuidado.

```
POST /api/internal/orders/status
{ "orderId": "42", "status": "CONFIRMED", "reason": null }
```

`status` ∈ `CONFIRMED` · `READY` · `IN_TRANSIT` · `DELIVERED` · `CANCELLED` ·
`REJECTED_BY_STORE` (v5 — **la línea de arriba, vigente hasta la v4, decía
solo cuatro valores y ya no es cierta**). `AWAITING_CUSTOMER` **no** entra en
este enum: responde `400 INVALID_BODY` — ese estado solo lo pone
`POST /orders/proposal`, la única acción que fija un plazo.

**Una guarda de transición, la primera del contrato (v6 — la línea que estaba
aquí, «Sin guardas de transición: el POS es la autoridad y puede reportar
cualquiera de los seis valores sobre cualquier pedido que le pertenezca», ya no
es cierta).** Sobre un pedido con el envío **sin cotizar**
(`deliveryFeePending: true`):

| Destino                                         | Respuesta                       |
| ----------------------------------------------- | ------------------------------- |
| `READY` · `IN_TRANSIT` · `DELIVERED`            | `409 ORDER_DELIVERY_NOT_QUOTED` |
| `CONFIRMED` · `CANCELLED` · `REJECTED_BY_STORE` | `200`, como siempre             |

El motivo es que entregar un pedido cuyo total nunca se cerró es una
reclamación garantizada: primero se cotiza y el comprador aprueba, después se
despacha. Aceptar el pedido (`CONFIRMED`) sin haber cotizado **sí** está
permitido —es lo normal: se acepta y se cotiza después—, y cancelarlo también,
porque cancelar no cobra nada. El `409` **no escribe nada**, y un `orderId` de
otro negocio sigue respondiendo `404 UNKNOWN_ORDER`: el aislamiento por negocio
se comprueba **antes** que la cotización, así que este error nuevo no sirve para
averiguar si un pedido existe en otro negocio.

En el resto de los casos el POS sigue siendo la autoridad y puede reportar
cualquiera de los seis valores sobre cualquier pedido que le pertenezca.

### El timbre del canal `negocio:` (aclaración aditiva, v5.1)

**F-020.** Lo de arriba —el pull cada 2 minutos— sigue siendo la única forma
en que el pedido llega: esto de aquí no cambia eso, solo lo adelanta.
queandabuscando emite un **Broadcast sin datos** en un canal de Supabase
Realtime cuando hay algo nuevo que leer, para que un lector que se suscriba
dispare su pull de inmediato en vez de esperar al siguiente ciclo. Es
aditivo para cuadrecaja: quien no lo implemente se queda exactamente como
está hoy, con su cron de 2 minutos, y sigue siendo un lector correcto de la
v5.

**El canal, el evento y el payload.**

```jsonc
// canal: negocio:{businessId}   ·   evento: pedidos   ·   private: true
{ "t": "pedidos" }
```

El payload es una constante: **no transporta datos y no es una vía de
entrega.** No lleva `code`, `id`, importes, ni nada derivado del pedido —
quien lo lee no aprende más que «hay algo que leer». El pedido en sí sigue
viajando exclusivamente por `GET /api/internal/orders`.

**Los dos disparadores, y solo esos: crear un pedido, y que el comprador
resuelva una propuesta de renegociación** (aprobarla o rechazarla, § ③④ más
arriba). Ningún otro cambio de estado timbra — ni el vencimiento de una
propuesta por reloj, ni un `POST /orders/status` del propio POS (lo hizo él,
ya lo sabe). El payload es el mismo para los dos disparadores, a propósito:
**el timbre no dice cuál de los dos fue.**

**Un timbre puede perderse, y el cron sigue siendo la garantía.** Si nadie
está suscrito, si Realtime está caído, o si la instancia que lo programó
muere a mitad de camino, el timbre simplemente no suena — nada se reintenta,
nada falla. El pedido llega igual en el siguiente ciclo de pull. Es
exactamente el comportamiento de antes de F-020, solo que sin el adelanto.

**Al oír el timbre, el lector hace DOS lecturas, no una:** su pull
incremental de siempre (`since=<cursor>`) **y** una relectura de los pedidos
que tenga en `AWAITING_CUSTOMER`. El motivo: el pull incremental filtra
`id > since`, y la resolución de una propuesta ocurre sobre un pedido que el
POS **ya pulleó** (su `id` es menor que el cursor). Sin la segunda lectura,
el timbre del segundo disparador dispara un pull que responde
`{ orders: [], nextCursor: null }` y el encargado no ve el cambio. **Esa
segunda lectura es, literalmente, `GET
/api/internal/orders?status=AWAITING_CUSTOMER`** (v8, F-033, § ③④ Pedidos,
«Las lecturas laterales» más arriba) — hasta esta versión el contrato pedía
la relectura sin decir con qué parámetro se hacía.

**Un solo pull en vuelo por negocio, aunque timbren N pestañas.** La regla ya
existía más arriba en esta misma sección («este endpoint asume un único
poller por negocio, secuencial») — el timbre no la cambia, pero la hace
mucho más fácil de violar: hoy hacen falta dos crons mal configurados para
tener dos pollers a la vez; con el timbre basta con que el encargado tenga
tres pestañas abiertas, cada una disparando su propio pull al oírlo. Sigue
siendo responsabilidad de cuadrecaja mantener un solo pull en vuelo por
negocio en todo momento, sin importar cuántas pestañas lo oigan.

**La lectura lateral NO cuenta para esa regla (v8, F-033).** Se puede lanzar
en paralelo con el pull incremental y con otra lectura lateral, del mismo
negocio, sin coordinarla con nada de lo anterior. El motivo por el que existe
la regla de «un solo pull en vuelo» —`findMany` y `updateMany` no son
atómicos entre sí, así que dos pollers pueden entregar el mismo pedido dos
veces— no aplica aquí: una lectura lateral nunca marca `PULLED`, así que no
hay entrega que duplicar ni que perder. **Lo que sí puede pasar:** dos
lecturas laterales simultáneas pueden ver **estados distintos del mismo
pedido**, porque cada una aplica los dos vencimientos por su cuenta y el
pedido cuyo reloj expira justo entre las dos sale `AWAITING_CUSTOMER` en una y
`CANCELLED` en la otra. No es una carrera que haya que evitar ni un bug que
reportar: es el reloj, y la respuesta más reciente es siempre la que vale.

**La credencial de suscripción.** El POS la pide presentando el mismo bearer
por negocio que ya usa en `/api/internal/*` — no hay autenticación nueva que
implementar:

```
POST /api/internal/realtime/credential
Authorization: Bearer <el mismo token por negocio de /api/internal/orders>
(sin cuerpo)
```

```jsonc
// 200
{
  "url": "https://<ref>.supabase.co",
  "apikey": "<anon key, pública>",
  "channel": "negocio:9f3c…", // SU canal, derivado del bearer — no se puede pedir el de otro
  "event": "pedidos",
  "token": "<JWT de suscripción>",
  "expiresAt": "2026-09-01T05:52:03.000Z",
  "expiresInSeconds": 3600,
}
```

`expiresAt` viaja explícito para que el POS pueda renovar sin adivinar:
**renovar es volver a pedirla**, no hay otra acción. `503
REALTIME_NOT_CONFIGURED` cuando el timbre no está disponible en este
despliegue — nunca bloquea un pedido, el POS sigue con su cron. Los mismos
errores del resto de `/api/internal/*` aplican por delante (`401`, `403`,
`503 SYNC_NOT_CONFIGURED`).

---

## ⑤ Reconciliación

Sin esto no hay forma de saber que la sincronización se rompió: los datos
simplemente se van quedando viejos sin que nada falle.

**El `storeId` de la query tiene que ser de una tienda del negocio autenticado
(v3).** Uno de otro negocio responde `404 UNKNOWN_STORE`, igual que uno
inexistente (§ Vocabulario de errores) — este endpoint no sirve para
averiguar si un `Tienda.id` ajeno existe en otro negocio.

Ambos lados calculan el mismo hash sobre los mismos campos —los que el sync
posee, excluyendo los del panel, que legítimamente difieren:

```
md5( concat( externalId ":" precio ":" moneda ":" disponibilidad "|" )
     ordenado por externalId )
```

Si los hashes difieren: poner `dispPublicada = NULL` en las filas de ese local
(lo que hace que la query convergente las levante todas) y alertar.

**Alertar también si no hubo una corrida exitosa en 30 minutos.**

### El SQL espejo (aclaración aditiva, v5.1)

Lo de arriba es pseudocódigo y admite más de una lectura del `precio` — la
diferencia entre `1990` y `1990.00` da hashes distintos sobre los mismos
datos. Esto de aquí es la lectura exacta, lista para copiar contra el schema
de cuadrecaja:

```sql
SELECT count(*) AS products,
       md5(coalesce(string_agg(
              pt."id" || ':' ||
              trim(trailing '.' from
                   trim(trailing '0' from round(pt."precio"::numeric, 2)::text)) || ':' ||
              pt."monedaPrecioCode" || ':' ||
              coalesce(pt."dispPublicada", 'AVAILABLE') || '|',
              '' ORDER BY pt."id" COLLATE "C"
            ), '')) AS hash
FROM "ProductoTienda" pt
JOIN "Producto" p ON p.id = pt."productoId"
WHERE pt."tiendaId" = $1
  AND p."publicarEnTienda" = true
  AND pt."precio" IS NOT NULL
  AND pt."monedaPrecioCode" IS NOT NULL;
```

Cuatro decisiones que este SQL lleva y que no se deducen del pseudocódigo:

1. **`dispPublicada`, no el enum calculado desde `existencia`/`umbralBajo`.**
   El hash compara lo que ambos lados creen haber _publicado_, no el estado
   de inventario en vuelo — eso ya lo resuelve la query convergente de § ②.
   Si el hash contara el enum calculado, cualquier venta normal haría
   diferir los hashes hasta la corrida siguiente y la alerta dejaría de
   significar nada.
2. **`coalesce(pt."dispPublicada", 'AVAILABLE')`.** `dispPublicada` es
   `String?`: es `NULL` mientras § ② no haya confirmado nada, y la acción de
   recuperación de arriba lo vuelve a poner a `NULL`. Sin el `coalesce`,
   `NULL || ':'` es `NULL`, `string_agg` se salta esa fila entera y el
   `hash` cambia mientras `count(*)` no — dos cifras que dejarían de
   describir el mismo conjunto.
3. **El `coalesce(..., '')` de fuera.** `string_agg` sobre cero filas da
   `NULL`, y `md5(NULL)` es `NULL`, no un hash. Con este `coalesce`, una
   tienda publicada y vacía da `d41d8cd98f00b204e9800998ecf8427e` — el md5
   de la cadena vacía, y exactamente lo que responde este lado para el mismo
   caso.
4. **`precio`/`monedaPrecioCode` no nulos.** Un producto sin moneda no
   produce nunca un `payload` de `PRODUCT` válido en ①, así que nunca llegó
   a existir aquí; contarlo del lado de cuadrecaja sería una diferencia
   permanente. El `IS NOT NULL` es además lo que evita el mismo `NULL || ':'`
   del punto 2.

**El orden es de bytes, no el de una colación.** `ORDER BY pt."id" COLLATE
"C"` — no el `ORDER BY` que cada base use por defecto: dos colaciones
distintas sobre los mismos datos dan hashes distintos, y las dos bases son de
dos organizaciones diferentes.

**Precondición: `price` viaja con dos decimales como máximo (ver § ①).** Con
más de dos, los dos lados divergen en el redondeo de forma permanente:
`2.675` se serializa aquí como `"2.67"` (`toFixed(2)` de JavaScript sobre el
doble IEEE-754 más cercano, que es `2.67499…`) y `round(2.675, 2)` en
Postgres da `2.68` — comprobado ejecutando. Ese producto no converge nunca, y
el arreglo no está de este lado.

**Qué SÍ prueba la implementación de aquí, y qué NO.** Esta traducción se
verifica contra una fila `StoreProduct`, no contra `ProductoTienda`: valida
el orden, los separadores y la serialización del precio, que es donde están
los errores. **No valida** los nombres de las columnas de cuadrecaja, ni el
`JOIN` con `Producto`, ni el `coalesce` de `dispPublicada` — eso solo lo
puede verificar el equipo de cuadrecaja ejecutando el SQL de arriba contra su
propia base.

#### Vector de prueba, para autoverificarse sin nuestra base

Cuatro filas de una misma tienda, con `monedaPrecioCode = 'CUP'` y
`dispPublicada = 'AVAILABLE'` en las cuatro, y sus `precio` respectivos
`1990.00`, `1990.50`, `1990.10` y `0.00`. Con `id` ∈ `{a, b, c, d}` en ese
mismo orden, el SQL de arriba tiene que dar:

```
products = 4
hash     = 62e399684e3a8eafadaae58391537955
```

Calculado ejecutando la traducción de este SQL (sin el `JOIN` con
`Producto`, que no cambia el hash) sobre esas cuatro filas literales — no a
mano. Si el SQL implementado del lado de cuadrecaja no reproduce este hash
sobre estos mismos cuatro valores, la diferencia está en la serialización del
precio o en el orden, no en los datos reales.

---

## Idempotencia, en dos capas

1. **Todo es upsert por clave natural** — `(storeId, canonicalProductId)`,
   `(ean)`, `(canonicalProductId, text, businessId)`. Reaplicar es inofensivo.
2. **Guarda anti-rancio** — cada `UPDATE` lleva `AND sourceUpdatedAt < $nuevo`.

Con la segunda guarda **el orden de entrega deja de importar**: aunque un
reintento llegue después de un cambio más nuevo, no lo pisa. Eso es lo que hace
seguro el filtro `intentos < 6` sin arriesgar corrupción.

Y del lado del inbox: la idempotencia es por `eventId`, pero **un evento que
falló no cuenta como duplicado**. Reportarlo en `ok` haría que el POS marque su
outbox como procesado y la actualización se perdería en silencio, sin que nada
en ningún lado registre un error.

---

## Cambios requeridos en cuadrecaja

### De la v6 (F-031) — no hay migración, es código

Nada de esto es una columna: la v6 no pide ni un campo nuevo en el schema de
cuadrecaja. Son tres cosas de código y una de parseo, y están desarrolladas con
su porqué en
[`traspaso-cuadrecaja-envio-cotizado.md`](traspaso-cuadrecaja-envio-cotizado.md),
que es el documento corto para leer primero:

1. **Leer `deliveryFeePending` antes de usar `deliveryFee`.** Un pedido sin
   cotizar y uno con el envío regalado traen el **mismo** `"0.00"`; tratar ese
   cero como «gratis» cobra de menos, en silencio.
2. **Cotizar por `POST /orders/proposal`**, reenviando las mismas líneas que el
   pull entregó (su `items` es obligatorio).
3. **Manejar `409 ORDER_DELIVERY_NOT_QUOTED`** como «falta cotizar», no como un
   fallo transitorio: reintentar no lo arregla.
4. **Revisar el parseo de importes**: ahora todos los del pull traen dos
   decimales. Sin efecto si se parsean a número.

La única columna que la v6 **no** pide y conviene saber que falta:
`Tienda.modoEnvio` y sus cuatro vecinas de configuración de compra. Eso es la
v7, § «Cambios respecto a la v6».

### De la v7 (F-032) — cinco columnas nuevas en `Tienda`, y emitirlas

Los nombres son una **propuesta**: el schema de cuadrecaja es suyo, y lo que
ata este contrato son los nombres del cable (`checkoutMode`, `deliveryEnabled`,
`deliveryFee`, `deliveryFeeMode`, `orderExpiryHours`), no estos:

```prisma
model Tienda {
  modoCheckout            String  @default("WHATSAPP") // "WHATSAPP" | "ONSITE"
  envioHabilitado         Boolean @default(false)
  costoEnvio              Decimal? @db.Decimal(14, 2)
  modoEnvio               String  @default("FLAT_RATE") // "FLAT_RATE" | "QUOTED_PER_ORDER"
  horasVencimientoPedido  Int     @default(24)
}
```

Tres cosas más, aparte de la columna:

1. **Exponerlas en la interfaz** donde el negocio ya configura su tienda —
   checkout, domicilio y su tarifa, y cuántas horas dura una propuesta.
2. **Emitirlas en el outbox** del evento `STORE` cuando cualquiera de las
   cinco cambie, planas y opcionales, con la forma de arriba.
3. **Omitir una clave dejarla como estaba, nunca enviar el default.** Un
   evento `STORE` rutinario (corregir un teléfono, por ejemplo) que mande
   las cinco a sus valores por defecto APAGARÍA el domicilio de cualquier
   tienda que un humano configuró a mano por SQL antes de esta versión —
   ver «omitir no es apagar» en [ADR 0028](adr/0028-configuracion-de-compra-del-pos.md).

### De la v9 (F-022) — si mandáis calendario, con esta forma; si no, no cambia nada

No hay columna nueva que pedir en `Tienda`: `horario` (o como se llame ya en
vuestro schema) es vuestro y sigue siéndolo. Lo que cambia es lo que
queandabuscando acepta cuando lo mandéis.

1. **Si ya emitís `openingHours` con otra forma, tenéis que migrar a la de
   arriba** (§ «Cambios respecto a la v8»): objeto con `version: 1` y las
   siete claves de día, cada una con 0 a 4 ventanas `{from, to}` en `"HH:MM"`.
   Un valor que no cumpla el formato hace fallar **ese evento entero** —
   incluidos los demás campos que viajaran con él— con
   `STORE_OPENING_HOURS_INVALID` en el `207 failed[]`.
2. **Si nunca habéis mandado `openingHours`, no tenéis que hacer nada.**
   Omitirlo sigue dejando la columna intacta en queandabuscando, igual que
   siempre.
3. **No mandéis una clave `timezone` dentro de `openingHours` ni en el
   `payload` de `STORE`.** La zona horaria de la tienda es un dato del
   panel de administración de queandabuscando, no del POS; si la mandáis de
   todos modos, se descarta sin error.
4. **El umbral de stock bajo sigue sin viajar.** Nada que cambiar de este
   lado: seguid calculando el enum `Availability` con vuestro propio umbral,
   como hasta ahora.

### De las versiones anteriores

Todos aditivos y nullable, así que la migración no reescribe tablas — importante
en `ProductoTienda`, la más caliente del sistema.

```prisma
model Producto {
  productoCanonicoId String?
  publicarEnTienda   Boolean @default(false)
}

model ProductoTienda {
  dispPublicada String?   // último enum confirmado
  umbralBajo    Int?      // umbral de POCAS_UNIDADES, por producto
}

model Tienda {
  publicarEnTienda Boolean @default(false)   // opt-in del local
  slug             String?
  direccion        String?
  latitud          Decimal? @db.Decimal(9, 6)
  longitud         Decimal? @db.Decimal(9, 6)
  horarios         Json?
}

model OutboxEvento { /* nueva */ }
model PedidoEntrante { /* nueva */ }
```

Más: el índice parcial de divergencia con `CREATE INDEX CONCURRENTLY`, el cron
`/api/cron/sync-tienda` cada 2 minutos, y el cron de reconciliación diario.

---

## Modos de falla

| Falla                                                                                                            | Qué le pasa al usuario                                                                                                                                                                                                                           | Recuperación                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La tienda está caída                                                                                             | Nada: el POS sigue vendiendo                                                                                                                                                                                                                     | La outbox no se drena, `intentos++`. Se recupera solo                                                                                                                                                                                                                         |
| El POS está caído                                                                                                | La tienda sirve el último snapshot y **acepta pedidos igual**                                                                                                                                                                                    | Los pedidos esperan a que el POS vuelva a hacer pull                                                                                                                                                                                                                          |
| El cron no corre                                                                                                 | Precios y disponibilidad se atrasan                                                                                                                                                                                                              | La reconciliación lo detecta. Alerta a los 30 min                                                                                                                                                                                                                             |
| Evento con payload inválido                                                                                      | Ese producto queda viejo; el resto fluye                                                                                                                                                                                                         | `intentos > 5` → DLQ + alerta                                                                                                                                                                                                                                                 |
| Se perdió `dispPublicada`                                                                                        | Resincroniza todo el stock una vez                                                                                                                                                                                                               | Idempotente, sin intervención                                                                                                                                                                                                                                                 |
| El token de un negocio se filtró                                                                                 | Alguien podría escribir catálogo falso a nombre de ESE negocio, ninguno más                                                                                                                                                                      | Re-acuñar el token de ese negocio (invalida el viejo al instante, no toca a los demás). Motivo para pasar a HMAC                                                                                                                                                              |
| **Un POS todavía en v3 envía `barcode` (singular)**                                                              | **No sincroniza catálogo en absoluto**: el lote entero responde `400 INVALID_BATCH` y ni siquiera queda una `SyncEvent` para reintentar — no es un producto el que falla, es el lote completo                                                    | Migrar el payload de `PRODUCT` a `barcodes: string[]` (v4). No hay periodo de gracia ni modo de compatibilidad: es el mismo corte que hizo la v3 en autenticación (HD5)                                                                                                       |
| **Un POS todavía en v5 ignora el `409 ORDER_DELIVERY_NOT_QUOTED`**                                               | Sus pedidos con el envío sin cotizar **no avanzan**: cada intento de `READY`/`IN_TRANSIT`/`DELIVERED` se rechaza y, si el POS no mira el código de respuesta, el pedido se queda quieto sin ningún error visible en su lado hasta que vence solo | Cotizar por `POST /orders/proposal` antes de despachar, y tratar el `409` como «falta cotizar», no como un fallo transitorio que se reintenta                                                                                                                                 |
| **Un POS todavía en v5 lee el `deliveryFee: "0.00"` de un pedido sin cotizar como «envío gratis»**               | **Cobra de menos**, en silencio y en todos los pedidos de las tiendas con envío cotizado: el importe del envío nunca llega a la venta                                                                                                            | Leer `deliveryFeePending` antes de usar `deliveryFee`. No hay error HTTP que avise: es un fallo del lado del POS y solo se ve en la caja                                                                                                                                      |
| **Un POS todavía en v4 no reconoce `AWAITING_CUSTOMER`/`IN_TRANSIT`/`REJECTED_BY_STORE`**                        | Un `switch` exhaustivo sobre `status` se rompe al primer pedido en uno de los tres estados nuevos — no hay error HTTP que avise, es un fallo del lado del POS                                                                                    | Migrar el lector del enum antes de recibir tráfico real. No hay periodo de convivencia: mismo corte que la v3/v4 (F-019)                                                                                                                                                      |
| **Dos lecturas laterales simultáneas del mismo negocio (v8, F-033)**                                             | Pueden ver **estados distintos del mismo pedido** si su vencimiento cae justo entre las dos — `AWAITING_CUSTOMER` en una, `CANCELLED` en la otra                                                                                                 | No es un fallo ni hay nada que reintentar: cada lectura aplicó el reloj en su propio instante y la respuesta más reciente es la que vale                                                                                                                                      |
| **Cuadrecaja perdió el token de un negocio que `POST /api/provisioning/credential` ya le había entregado (v10)** | El sync de ese negocio queda parado: sin token no hay forma de autenticar ninguna de las siete rutas de arriba                                                                                                                                   | `POST /api/provisioning/credential` **no** lo recupera — es idempotente y no rota. La única salida sigue siendo rotar con corte desde `npm run mint:token -- <externalId>`, avisando antes al equipo de cuadrecaja para que guarde el valor nuevo (`docs/despliegue.md` § 11) |

---

## Verificación

Con el servidor local levantado y un token de negocio exportado como
`QAB_BEARER_TOKEN` — o pasado con `--token=` en cada script. Desde la v10 hay
dos formas de conseguirlo (§ Autenticación): acuñarlo con
`npm run mint:token -- seed-negocio-1` como hasta ahora, o pedirlo con
`POST /api/provisioning/credential` (§ «Aprovisionamiento de negocios») — el
guion sigue siendo el más rápido para el negocio de desarrollo ya
sembrado, y la ruta es el camino real para un negocio nuevo de cuadrecaja:

```bash
node scripts/send-catalog-batch.mjs --repeat        # processed
node scripts/send-catalog-batch.mjs --repeat        # duplicate
node scripts/send-catalog-batch.mjs --bad-token     # 401
node scripts/send-catalog-batch.mjs --unknown-store # skipped_not_published
node scripts/send-catalog-batch.mjs --stale         # stale
node scripts/send-catalog-batch.mjs --singular-barcode  # 400 INVALID_BATCH (v4, F-024)
node scripts/send-availability-batch.mjs OUT_OF_STOCK
node scripts/send-catalog-batch.mjs --token=<otro-token-de-otro-negocio>  # 403 BUSINESS_MISMATCH
```

La renegociación (v5, F-019) se verifica con `scripts/renegotiate-order.mjs`,
que acuña su propio token y siembra sus propios pedidos:

```bash
node scripts/renegotiate-order.mjs --propose         # AWAITING_CUSTOMER + los dos totales
node scripts/renegotiate-order.mjs --approve         # CONFIRMED con los importes propuestos; rateSnapshot intacto
node scripts/renegotiate-order.mjs --reject          # CANCELLED, cancelledBy CUSTOMER
node scripts/renegotiate-order.mjs --expire          # el reloj cancela solo, cancelledBy EXPIRY
node scripts/renegotiate-order.mjs --outcomes        # REJECTED_BY_STORE y los dos CANCELLED, distinguibles
node scripts/renegotiate-order.mjs --transit         # IN_TRANSIT sobre READY, envío y retiro
node scripts/renegotiate-order.mjs --link-on-create  # customerWhatsappUrl en el pull, también para ONSITE
```

El envío cotizado (v6, F-031) se verifica con scripts/quote-delivery-order.mjs
(por crear), que activa el modo por SQL sobre la tienda del seed, siembra sus
pedidos por el checkout público y los recorre entero:

```bash
node scripts/quote-delivery-order.mjs --create    # 201 sin importe de envío, y la fila con el envío sin cotizar
node scripts/quote-delivery-order.mjs --pull      # el pedido sin cotizar y el de 0.00 en la MISMA respuesta
node scripts/quote-delivery-order.mjs --quote     # cotizar reenviando las líneas → AWAITING_CUSTOMER → CONFIRMED
node scripts/quote-delivery-order.mjs --dispatch  # 409 ORDER_DELIVERY_NOT_QUOTED en READY, IN_TRANSIT y DELIVERED
node scripts/quote-delivery-order.mjs --expire    # vence contado desde la creación, con su cancelReason propio
```

El criterio 6 de F-024 —cuántos productos canónicos comparten códigos entre
negocios distintos— se mide con `npm run count:barcodes`
(`scripts/count-canonical-barcodes.ts`), no con una petición HTTP: imprime
cinco cifras y un histograma sobre la base local.
