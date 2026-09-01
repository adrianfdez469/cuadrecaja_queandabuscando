---
feature: F-031
agente: sdd-designer
actualizado: 2026-09-01T16:10:43Z
estado: listo
---

## Qué se miró antes de diseñar

`.agent/specs/F-031/spec.md` completa (E1, E3, E5, E8, E11, E13, R1, R2, R19,
R20 y § «No decidido a propósito»), la entrada de F-031 en
`.agent/features.json` con sus doce criterios, `AGENTS.md` (§ Prohibiciones,
§ «El presupuesto de JavaScript no es un muro», § «Cosas que muerden»),
`.agent/specs/F-019/design.md` § 4.4 y § Textos —de donde sale el lenguaje que
el comprador ya ve en la renegociación— y las seis superficies en el código, más
`src/app/[slug]/pedido/[code]/page.tsx`,
`src/features/orders/components/OrderStatusBadge.tsx`,
`src/features/orders/components/WhatsappOrderLink.tsx`,
`src/components/ui/RadioCard.tsx`, `src/components/ui/Badge.tsx` y
`src/features/cart/components/CartView.tsx:312`.

**No se levantó `next dev`.** AGENTS.md § «Cosas que muerden» avisa de que el
puerto puede estar ocupado por otro checkout y de que verificar contra otra copia
del repo es peor que no verificar; y lo que este ciclo decide es copia sobre
maquetación que ya existe, no maquetación nueva. Todo lo que se afirma aquí sobre
la pantalla actual se leyó del JSX y de sus tests
(`src/features/cart/components/CheckoutForm.test.tsx`,
`src/features/orders/components/OrderProposalCard.test.tsx`,
`src/features/orders/whatsapp.test.ts`,
`src/features/orders/proposalDiff.test.ts`). La comprobación en navegador queda
para § Verificación visual y para `sdd-tester`.

**`.agent/specs/F-031/architecture.md` no se leyó a propósito**: lo escribe
`sdd-architect` en paralelo. Toda la copia de este documento se decide sobre una
sola condición booleana —«el envío de este pedido está sin cotizar» / «está
cotizado»— que llegue como llegue: columna anulable, marca junto al `0.00`, campo
derivado. En el resto del documento se la nombra **el booleano de «sin
cotizar»**, y cuando hace falta un nombre de prop se usa `deliveryPending` como
_placeholder_; el nombre real es del arquitecto y del implementador.

## El léxico: cinco cadenas y ni una sexta

Antes del flujo, la decisión que gobierna las seis superficies. Un feature de
copia se rompe por sinónimos: si el checkout dice «por confirmar», la tabla «a
determinar» y WhatsApp «pendiente», el comprador cree que son tres cosas.

| Concepto                                             | Cadena canónica                | Dónde aparece                                                          |
| ---------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| El importe del envío todavía no existe (celda/valor) | **Por confirmar**              | resumen del checkout, tabla del pedido                                 |
| Lo mismo, en texto plano después de dos puntos       | **por confirmar**              | mensaje de WhatsApp                                                    |
| El total no está cerrado (etiqueta)                  | **Total parcial**              | resumen del checkout, tabla del pedido, mensaje de WhatsApp            |
| La coletilla obligatoria de SP4                      | **más el envío por confirmar** | las tres superficies de arriba, **siempre** junto a la cifra parcial   |
| El envío existe y vale cero                          | **sin costo**                  | solo en prosa de propuesta (diff y tarjeta), donde esa palabra ya vive |

Cuatro reglas sobre ese léxico, y las cuatro son verificables:

1. **«Por confirmar» nunca viaja sola en una superficie donde haya un total.**
   Si en la pantalla hay una cifra de total, esa cifra lleva su etiqueta «Total
   parcial» y su coletilla. Es SP4 al pie de la letra: nunca una cifra sola.
2. **La palabra «cotizar» no aparece en ninguna pantalla del comprador.** Es
   jerga nuestra y del POS. El comprador lee «confirmar» y «calcular». Sí aparece
   —en su forma verbal— en el `cancelReason` que viaja al pull, que lo lee
   cuadrecaja y no el comprador (§ Textos, la tabla de motivos).
3. **Ni un importe inventado, ni un rango, ni un «desde».** R3, y es la forma que
   SP4 descartó explícitamente.
4. **Un envío cotizado en `0.00` no vuelve a decir «por confirmar» en ninguna
   superficie** (E11). Se imprime como el importe formateado que es (`$0.00`),
   salvo en la prosa de la propuesta, donde `proposalDiff.ts:83` ya dice «sin
   costo» y se reutiliza esa palabra en vez de inventar una segunda.

**Aviso de formato, porque cambia lo que hay que _grepear_.** `formatMoney`
(`src/lib/money.ts:198`) usa `es-CU`, y ese locale imprime **coma de millares y
punto decimal**: `formatMoney(money("1234.56","CUP"))` es `"$1,234.56"`, y el
cero es `"$0.00"`. Los ejemplos de este documento usan esa forma —igual que
`.agent/specs/F-019/design.md` § 4.4— y de ahí sale **DP1**.

## Flujo de usuario

Una tienda con envío en modo cotizado. Entre corchetes, el estado del booleano.

1. **Carrito** (`src/features/cart/components/CartView.tsx`). Sin cambios. Su
   línea 312 ya dice «El envío se calcula en el siguiente paso.», que en modo
   cotizado sigue siendo cierta —el paso siguiente es donde se dice que lo
   confirma la tienda— y no se toca. Cambiarla obligaría a que el carrito supiera
   el modo, y el carrito hoy no pide la tienda entera.
2. **Checkout, antes de elegir modalidad** [sin cotizar aún no aplica]. Resumen
   con Subtotal, Descuento si hay, **sin fila de envío** y total nombrado
   `Total`. Es lo de hoy: la fila de envío solo aparece cuando hay modalidad
   elegida y el envío se ofrece. `fulfillment` arranca en `PICKUP`
   (`CheckoutForm.tsx`), así que en la práctica el comprador entra en el estado
   de retiro, que es firme.
3. **Checkout, retiro en la tienda** [envío = 0, en firme]. Idéntico a hoy, byte
   a byte: radio «Recoger en la tienda / Sin costo de envío», fila `Envío $0.00`,
   `Total` en firme. Lo incierto es el envío, no el pedido (E8).
4. **Checkout, envío a domicilio** [sin cotizar]. El radio pierde el `+ $500.00`
   y gana «Costo por confirmar»; aparece la dirección obligatoria, como hoy;
   debajo, el párrafo que explica cuándo se sabrá el importe; en el resumen,
   `Envío — Por confirmar` y `Total parcial` con su coletilla. Botón «Confirmar
   pedido», sin cambios.
5. **Vuelta atrás.** Cambiar de domicilio a retiro devuelve el resumen al estado
   firme y **se pierde** lo escrito en la dirección solo si el implementador lo
   borra: hoy `deliveryAddress` se conserva en el estado de la isla y volver a
   `DELIVERY` lo repinta. Se mantiene así. Volver al carrito no pierde nada.
6. **Confirmado** [sin cotizar]. Página del pedido: «¡Pedido recibido!», código,
   insignia `Pendiente de confirmación`, tabla con `Envío — Por confirmar` y
   `Total parcial`, y en una tienda `WHATSAPP` el botón de WhatsApp con el
   mensaje que tampoco imprime un cero.
7. **La tienda cotiza** → `AWAITING_CUSTOMER` [sin cotizar, con propuesta]. La
   misma página cambia de cara: tira superior «La tienda ya calculó el envío de
   tu pedido», insignia `Esperando tu respuesta`, tarjeta de propuesta con los
   dos totales renombrados, tabla «Tu pedido con el envío incluido» y, plegado,
   «Ver tu pedido sin el envío» —que sigue diciendo `Por confirmar` y sigue
   nombrando su total como parcial, porque ese pedido todavía es ese—. El enlace
   de WhatsApp se sigue ocultando mientras hay propuesta viva (DP1 de F-019).
8. **Aprueba** → `CONFIRMED` [cotizado]. Banner verde de F-019 sin tocar, tabla
   con `Envío $180.00` y `Total`. Ninguna superficie vuelve a decir «por
   confirmar». Si la tienda regaló el envío, `Envío $0.00` y `Total` (E11).
9. **Rechaza** → `CANCELLED`/`CUSTOMER`. Copia de F-019 sin tocar.
10. **Nadie cotiza y vence** → `CANCELLED`/`EXPIRY` [sin cotizar]. Insignia
    propia, distinta de la de la propuesta vencida: al comprador no se le puede
    decir que venció una propuesta que nunca vio (I7).

## Inventario de pantallas y estados

### 1 · Resumen del checkout — `src/features/cart/components/OrderSummary.tsx`

La regla documentada en sus líneas 6-8 se respeta y no se reinterpreta:
`undefined` oculta la fila, `null` es «Calculando…», una cadena se imprime.
«Por confirmar» **es una cadena**, así que la fila de envío no necesita ningún
cambio de contrato: entra por `deliveryFeeLabel`.

Lo único que este componente gana es **el booleano** para el bloque del total,
porque hay que renombrar la etiqueta y añadir una segunda línea.

| Estado                                              | Fila de envío       | Bloque del total                                                                   |
| --------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| Cargando la cotización (`quoteState === "loading"`) | `Calculando…`       | `Total` · `Calculando…` — sin tocar                                                |
| Tarifa fija, domicilio                              | `$500.00`           | `Total` · `$1,734.56` — sin tocar                                                  |
| Tarifa fija o cotizado, retiro en la tienda         | `$0.00`             | `Total` · `$1,234.56` — sin tocar                                                  |
| Cotizado, domicilio                                 | **`Por confirmar`** | **`Total parcial`** · `$1,234.56` + segunda línea **`más el envío por confirmar`** |
| Sin envío en la tienda                              | fila oculta         | `Total` — sin tocar                                                                |

**La segunda línea va dentro del bloque del total, no en `note`.** `note` se
pinta como `text-fg-muted text-xs` (línea 62): letra chica, y la letra chica es
exactamente el fallo por el que SP4 descartó «Desde $1,000.00» —la palabra se
lee rápido y se olvida, y queda la cifra—. La coletilla se pinta
`text-fg text-sm` y **pegada** a la cifra (`mt-0.5`), alineada a la derecha
debajo del importe, dentro del mismo contenedor que el `flex justify-between`
del total. Si `note` ya venía con algo, sigue funcionando: son dos cosas
distintas.

**El cero del retiro no se toca** (`CheckoutForm.tsx:815-821` sigue pasando
`formatMoney(money("0"))`). La spec lo señala en I4 como «Envío 0,00 con el
sentido de gratis», y en modo cotizado con retiro **ese sentido es el correcto**:
el envío vale cero de verdad (E8). Cambiarlo a «Sin costo» tocaría la cadena que
hoy ve toda tienda de tarifa fija y pondría en riesgo E7 y el criterio 9, que
exige `bash .agent/verify.sh F-010 --visual` en 0 con el guion sin tocar. Se
descarta a propósito.

### 2 · El fieldset de modalidad — `src/features/cart/components/CheckoutForm.tsx`

| Zona                                         | Tarifa fija (hoy, no se toca)                           | Cotizado                                                   |
| -------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `legend`                                     | `¿Cómo lo quieres recibir?`                             | igual                                                      |
| Radio de retiro (`label` / `description`)    | `Recoger en la tienda` / `Sin costo de envío`           | igual                                                      |
| Radio de domicilio (`label` / `description`) | `Envío a domicilio` / `+ $500.00` (líneas 742-746)      | `Envío a domicilio` / **`Costo por confirmar`**            |
| Campo de dirección                           | obligatorio, `Calle, número, entre calles y municipio.` | igual, sin un carácter de diferencia                       |
| Párrafo bajo la dirección                    | no existe                                               | **nuevo**, solo con `DELIVERY` elegido — texto en § Textos |
| Párrafo general de las líneas 779-782        | se queda                                                | se queda, literal                                          |
| Botón primario                               | `Confirmar pedido`                                      | `Confirmar pedido` — sin cambio                            |

**Qué reemplaza al `+ $500.00`: «Costo por confirmar».** Tres razones. (a) El
criterio 1 exige que la descripción del radio **no contenga ningún dígito**, y
esta no lo contiene. (b) `RadioCard` mete `label` y `description` dentro del
`<label>`, así que las dos cadenas forman el nombre accesible del radio: un
lector de pantalla anuncia «Envío a domicilio, costo por confirmar» sin que haya
que cablear ningún `aria-describedby`. (c) Cabe en la tarjeta de media columna a
768 px y en la de ancho completo a 320 sin partirse.

Se descartó `undefined` —que es lo que hoy sale cuando la tarifa es `null`—
porque un radio sin descripción al lado de otro que dice «Sin costo de envío» se
lee como «este no dice nada», que es peor que decir la verdad.

**Cómo se nombra el total antes y después de elegir modalidad.** Antes: no hay
fila de envío y el total es `Total`, como hoy —no es mentira, es que todavía no
hay modalidad—. Con retiro: `Total`. Con domicilio en modo cotizado: `Total
parcial` + coletilla. El cambio ocurre dentro de un bloque que ya es
`aria-live="polite"` (`OrderSummary.tsx:31`), así que se anuncia solo; ver
§ Accesibilidad para por qué **no** se pasa `announcement`.

**El botón no cambia.** No imprime importes, así que no puede mentir. La única
variante que roza el problema es `Confirmar con el total nuevo`
(`CheckoutForm.tsx:455-456`), que sale cuando `POST /api/orders` devuelve `409`
por precio movido: en modo cotizado ese «total» es el parcial que el resumen
acaba de etiquetar como parcial dos filas más arriba, y el `Alert` de la línea
557 explica qué pasó. Se deja igual; una segunda cadena para un caso de
concurrencia sería copia nueva sin lector.

### 3 · Tabla de importes del pedido — `src/features/orders/components/OrderLinesTable.tsx`

Aquí está el cambio de comportamiento, no solo de palabras. Hoy la línea 33
calcula `hasDeliveryFee = !isZero(deliveryFeeMoney)` y **oculta la fila** cuando
el envío vale cero (I4): un pedido sin cotizar se renderizaría sin línea de
envío, indistinguible de un retiro en tienda. Y R2 exige que la fila esté.

**Regla nueva de visibilidad: la fila de envío aparece en todo pedido a
domicilio, y solo en ellos.** Es decir, se decide por la **modalidad**, no por el
importe. La página ya tiene el dato (`page.tsx:99`, `hasDelivery`) y lo pasa; el
componente gana dos entradas y ninguna directiva.

| Pedido                                          | ¿Fila de envío? | Valor                | Etiqueta del total  | Coletilla                        |
| ----------------------------------------------- | --------------- | -------------------- | ------------------- | -------------------------------- |
| Domicilio, **sin cotizar**                      | **sí**          | **`Por confirmar`**  | **`Total parcial`** | **`más el envío por confirmar`** |
| Domicilio, cotizado con importe                 | sí              | `$180.00`            | `Total`             | —                                |
| Domicilio, cotizado en cero (envío regalado)    | **sí**          | `$0.00`              | `Total`             | —                                |
| **Retiro en la tienda**                         | **no**          | —                    | `Total`             | —                                |
| Tabla de la propuesta (`Tu pedido si aceptas…`) | según modalidad | el importe propuesto | `Total`             | —                                |

**Qué pasa con el retiro en tienda, explícito.** La fila **sigue oculta**, en los
dos modos. En un retiro no hay envío del que hablar: el cero no es un importe que
el comprador pagó, es la ausencia del concepto. Es además la única forma de no
tocar lo que hoy ve el comprador de una tienda de tarifa fija que recoge en
tienda (E7). El asimétrico —el checkout sí imprime `Envío $0.00` en retiro—
queda como está y se asume: son dos pantallas distintas y ya divergían antes de
este feature; unificarlas es cambiar copia de F-010 sin que ningún criterio lo
pida.

**El envío regalado gana fila** aunque hoy no la tenga. Sin eso, la transición de
E11 borraría de la pantalla la fila que el comprador estaba mirando: pasaría de
`Envío — Por confirmar` a **nada**, que se lee como «se perdió mi envío», no como
«me lo regalaron». El riesgo de E7 es nulo en la práctica: para que una tienda de
tarifa fija entre en este caso su `Store.deliveryFee` tendría que ser
exactamente `0.00`, y ni `tienda-demo` ni `tienda-dos` lo son
(`prisma/seed.ts:369-371,395-397`), así que ni el guion de F-010 ni
`scripts/place-order.mjs` pasan por ahí.

**La tabla de la propuesta nunca dice «Por confirmar».** Recibe
`order.proposal.deliveryFee`, que es concreto por construcción (E5), así que su
booleano es siempre falso. La tabla plegada de «tu pedido tal como está ahora»
recibe el del pedido, que sigue en `true` mientras está `AWAITING_CUSTOMER`: es
justo la que tiene que seguir diciendo `Por confirmar`.

**Dependencia que este diseño impone al dato** (y que sale de E5/E6, no de un
gusto): el booleano tiene que seguir en `true` mientras el pedido está en
`AWAITING_CUSTOMER` y ponerse en `false` **al aprobar**. Si se apagara al
proponer, la tabla plegada mentiría y la tarjeta de propuesta perdería la
información de que el total anterior era parcial.

### 4 · Mensaje de WhatsApp — `src/features/orders/whatsapp.ts`

Es plano y no hay maquetación que ayude, así que va completo y en los dos
estados. Lo que cambia son **dos líneas** de la lista de las líneas 61-76:
`deliveryLine` (54) y la del total (70).

**Pedido a domicilio, envío sin cotizar** (el caso del criterio 10):

```
Hola Tienda Demo, acabo de hacer un pedido en su tienda.

Código: ABC-123

2 x Café Cubita 500 g — $900.16
1 x Agua mineral 1.5 L — $334.40

Subtotal: $1,234.56
Envío: por confirmar
Total parcial: $1,234.56 más el envío por confirmar

Entrega: Envío a Calle 23 esq. L, Vedado
A nombre de: Ana Pérez (+53 55555555)

Ver el pedido: https://qab.example/tienda-demo/pedido/ABC123
```

**El mismo pedido una vez cotizado y aprobado** (y también cualquier pedido de
tarifa fija, que es la forma de hoy, sin un carácter de diferencia):

```
Subtotal: $1,234.56
Envío: $180.00
Total: $1,414.56
```

**Retiro en la tienda, en cualquier modo**: exactamente lo de hoy — no hay línea
de envío (la 53-54 ya la omite para `PICKUP`) y el total es `Total: $1,234.56`.

Tres decisiones sobre este mensaje:

- **«por confirmar» en minúscula** aquí y **«Por confirmar» en mayúscula** en las
  celdas de las tablas. En texto plano va detrás de dos puntos y en medio de una
  frase; en una tabla es el contenido de una celda. Misma cadena semántica, dos
  capitalizaciones, y conviene que quien implemente lo sepa antes de escribir el
  test.
- **La coletilla se repite en el mismo mensaje** («Envío: por confirmar» y luego
  «más el envío por confirmar»). En pantalla sería redundante; aquí es lo que
  pidió el enunciado del ciclo, porque un mensaje de WhatsApp se lee de un tirón,
  a veces reenviado y sin la fila de arriba delante.
- **No se añade ninguna frase nueva** del tipo «quedo pendiente del envío». El
  mensaje es del comprador hacia la tienda, y la tienda no se entera de que tiene
  que cotizar por WhatsApp: se entera por el pull. Una frase más es una frase que
  puede contradecir al contrato.

### 5 · Diff de la propuesta — `src/features/orders/proposalDiff.ts`

Hoy, líneas 81-87: si los dos importes difieren, `antes` es `"sin costo"` cuando
el actual es cero. Con un envío sin cotizar eso es **falso**, no solo pobre (I3).
Y hay un segundo agujero: si la tienda cotiza `0.00`, `currentDeliveryFee` y
`proposedDeliveryFee` son la **misma cadena**, la condición de la línea 81 no se
cumple y el diff **no dice nada** sobre el envío justo en el caso que E11
protege.

| Situación                                    | Frase                                                |
| -------------------------------------------- | ---------------------------------------------------- |
| Sin cotizar → importe                        | **`Envío: estaba por confirmar, ahora $180.00.`**    |
| Sin cotizar → `0.00` (regalado)              | **`Envío: estaba por confirmar, ahora sin costo.`**  |
| Cotizado `0.00` → importe (tarifa fija, hoy) | `Envío: antes sin costo, ahora $180.00.` — sin tocar |
| Importe → otro importe (tarifa fija, hoy)    | `Envío: antes $500.00, ahora $180.00.` — sin tocar   |
| Cotizado, mismo importe                      | ninguna frase — sin tocar                            |

La condición de emisión pasa a ser «los importes difieren **o** el pedido estaba
sin cotizar». `estaba` en vez de `antes` no es adorno: `antes X` presupone que
había un X, y aquí no había nada. Se mantiene lo que F-019 fijó para todas las
demás frases —«antes» y «ahora» como palabras, sin tachados, sin flechas, sin
rojo/verde— y el orden de la lista (productos primero, dinero después) no cambia.

Las frases de líneas y de subtotal **no se tocan**.

### 6 · Tarjeta de la propuesta — `src/features/orders/components/OrderProposalCard.tsx`

Es la superficie donde una copia equivocada miente más caro, porque el bloque
compara dos totales y uno de los dos es parcial.

**Titular.** Hoy `La tienda propone un cambio` (línea 87). Cuando el pedido
estaba sin cotizar, nada «cambió»: apareció lo que faltaba.
→ **`La tienda ya calculó el envío`**. Si esa misma propuesta además tocó líneas,
el bloque «Qué cambia» las nombra una por una, que es donde el comprador las
busca; el titular no tiene que enumerarlas. La variante de tarifa fija conserva
su titular actual.

**El bloque «Lo que pagarías»** (líneas 113-131) mantiene su forma —un `<dl>` de
tres pares, apilado a 360 y en dos columnas desde `sm`— y cambia los tres `dt`,
más el caso de los totales iguales:

| Caso                                         | Hoy                                                  | Sin cotizar                                                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Totales distintos, `dt` 1                    | `Total actual`                                       | **`Total sin el envío`**                                                                                                                                                                             |
| `dt` 2 (el grande, `text-2xl`)               | `Total propuesto`                                    | **`Total con el envío`**                                                                                                                                                                             |
| `dt` 3                                       | `Diferencia` · `$180.00 más`                         | **`El envío`** · **`$180.00`** (sin «más»: no es una diferencia, es el concepto)                                                                                                                     |
| Totales iguales (envío regalado)             | `El total no cambia: sigue siendo $1,234.56.`        | **`Ya está el total completo: la tienda no te cobra el envío, así que sigue siendo $1,234.56.`**                                                                                                     |
| Párrafo de «Aprobar el cambio»               | `Vas a aceptar el cambio: pagarías X en vez de Y. …` | **`Vas a aceptar el envío que puso la tienda: pagarías $1,414.56, que es tu pedido ($1,234.56) más el envío ($180.00). La tienda prepara tu pedido con estos importes y te contacta por teléfono.`** |
| Botón de aprobar                             | `Sí, acepto pagar $1,414.56`                         | igual — es exacto en cuanto hay cotización                                                                                                                                                           |
| Todo el bloque de rechazar                   | —                                                    | igual, sin tocar una palabra                                                                                                                                                                         |
| `Escribirle a la tienda`, plazo, vencimiento | —                                                    | igual                                                                                                                                                                                                |

`Total actual` era la mentira que señala I3: con un pedido sin cotizar, «actual»
suena a total vigente y en firme. `Total sin el envío` / `Total con el envío`
dice qué es cada cifra sin que el comprador tenga que restar, y la palabra
«Diferencia» desaparece porque en el caso dominante la diferencia **es** el
envío: nombrarlo por su nombre ahorra la resta que el comprador iba a hacer para
comprobar que no le colaron nada.

El summary del `<details>` sigue siendo `Aprobar el cambio` / `Rechazar el
cambio`: son las dos acciones del bucle de F-019 y renombrarlas por un modo de
envío partiría en dos un vocabulario que el comprador ya puede haber visto.

### 7 · Las dos superficies que la spec no cuenta entre las seis y hay que tocar igual

No contradicen a R2: son la insignia y el motivo, no un importe ni un total. Pero
si se dejan como están, la pantalla se contradice consigo misma.

**a) `src/features/orders/components/OrderStatusBadge.tsx`, caso
`CANCELLED` + `cancelledBy = "EXPIRY"`** (líneas 100-106). Hoy explica «La
propuesta de la tienda venció sin respuesta y el pedido se canceló». Al comprador
cuyo pedido venció **sin que nadie lo cotizara** eso le habla de una propuesta
que nunca vio (I7). El caso se bifurca con el mismo booleano, igual que
`AWAITING_CUSTOMER` ya se bifurca por `proposalExpired`:

| Sub-caso                       | Etiqueta                             | Explicación                                                                                                                                    |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Venció con propuesta (hoy)     | `Cancelado: no respondiste a tiempo` | sin tocar                                                                                                                                      |
| Venció **sin cotizar** (nuevo) | **`Cancelado: se venció el plazo`**  | **`La tienda no llegó a confirmar el costo del envío y el plazo del pedido se acabó. No se te cobró nada; si todavía lo quieres, escríbele.`** |

El `switch` sin `default` sigue siendo el guardarraíl que F-019 dejó puesto y no
se apaga.

**b) `AWAITING_CUSTOMER` y la tira superior de
`src/app/[slug]/pedido/[code]/page.tsx`** (líneas 159-168), por el mismo motivo
que el titular de la tarjeta:

| Elemento                               | Hoy                                                                           | Sin cotizar                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tira, titular                          | `La tienda propone un cambio en tu pedido`                                    | **`La tienda ya calculó el envío de tu pedido`**                              |
| Tira, segunda línea                    | `Revísalo y responde. Si no respondes a tiempo, el pedido se cancela.`        | igual                                                                         |
| Tira, enlace de salto                  | `Ver el cambio y responder`                                                   | **`Ver el envío y responder`**                                                |
| Insignia `AWAITING_CUSTOMER`, etiqueta | `Esperando tu respuesta`                                                      | igual                                                                         |
| Insignia, explicación                  | `La tienda propuso un cambio en tu pedido. Apruébalo o recházalo aquí abajo.` | **`La tienda ya puso el costo del envío. Apruébalo o recházalo aquí abajo.`** |
| Título de la tabla de la propuesta     | `Tu pedido si aceptas el cambio`                                              | **`Tu pedido con el envío incluido`**                                         |
| `summary` de la tabla plegada          | `Ver tu pedido tal como está ahora`                                           | **`Ver tu pedido sin el envío`**                                              |
| `Badge` de la tabla                    | `Propuesta`                                                                   | igual                                                                         |

### 8 · Los estados aburridos, que son los que se olvidan

| Estado                                                               | Qué se ve                                                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Checkout cargando la cotización                                      | `Cargando las opciones de entrega…` y el resumen en `Calculando…`, sin tocar. Ni «Por confirmar» ni «Total parcial» antes de tiempo |
| Checkout con `quoteState === "error"`                                | El `Alert` de hoy, `No pudimos calcular el total.` Nada nuevo: ese error es de la cotización del carrito, no del envío              |
| Conexión lenta (`slow`)                                              | `Estamos calculando el total. En una conexión lenta puede tardar un poco.` — sin tocar                                              |
| Tienda cerrada / no encontrada                                       | Los `Alert` de hoy, con prioridad sobre cualquier copia de envío                                                                    |
| Modo cotizado con `deliveryEnabled = false`                          | No se ofrece domicilio (R20) y la fila de envío no existe. Ni una palabra sobre cotizaciones                                        |
| Modo cotizado con una `deliveryFee` residual en la fila de la tienda | Manda el modo (§ Casos límite de la spec): la pantalla dice `Por confirmar` y **nunca** imprime esa tarifa                          |
| Pedido anterior a este feature                                       | Se lee como cotizado (E14): copia de hoy, íntegra                                                                                   |
| Pedido sin cotizar en tienda `ONSITE`                                | La página no ofrece enlace a WhatsApp (es lo de hoy) → **DP2**                                                                      |
| Teléfono sin dígitos utilizables                                     | El `wa.me` sale `null` y `WhatsappOrderLink` pinta su aviso de hoy, sin tocar                                                       |

## Estructura por breakpoint

Se añade la columna de **320 px** porque el enunciado del ciclo la pide y porque
es donde una fila de importes con texto en vez de cifra puede partirse. Ninguna
de las cinco zonas cambia de estructura: cambian palabras dentro de filas que ya
existen.

| Zona                                  | 320px                                                                                                                                                                                                             | 360px                  | 768px                                                              | 1280px                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Fila `Envío` del resumen del checkout | `flex justify-between` con `text-sm`: `Envío` a la izquierda, `Por confirmar` a la derecha. Con 288 px útiles caben las dos sin envolver; si envuelve, el valor baja completo, nunca partido en «Por / confirmar» | igual                  | igual                                                              | igual                                                       |
| Bloque del total del checkout         | Dos líneas: fila `Total parcial` + importe, y debajo la coletilla alineada a la derecha, envolviendo en dos líneas si hace falta                                                                                  | coletilla en una línea | igual                                                              | igual, dentro de la tarjeta `lg:sticky` de 22rem            |
| `RadioCard` de domicilio              | Tarjeta a ancho completo, `min-h-14`; `Envío a domicilio` en negrita y `Costo por confirmar` debajo en `text-sm`                                                                                                  | igual                  | Dos tarjetas en `sm:grid-cols-2`; la descripción cabe en una línea | igual                                                       |
| Párrafo nuevo bajo la dirección       | Tres líneas de `text-sm`, después del campo y antes del cierre del `fieldset`                                                                                                                                     | dos o tres líneas      | dos líneas                                                         | dos líneas                                                  |
| Fila `Envío` de la tabla del pedido   | Igual que la del checkout. La tabla vive dentro de `Card p-4`, así que hay ~256 px útiles: sigue entrando                                                                                                         | igual                  | igual                                                              | Columna derecha de la rejilla `lg:grid-cols-2`, sin cambios |
| `dl` de «Lo que pagarías»             | Apilado: `dt` en `text-sm text-fg-muted`, importe debajo; el grande en `text-2xl`. Las tres etiquetas nuevas son más cortas que `Total propuesto`                                                                 | igual                  | Dos columnas `sm:grid-cols-[1fr_auto]`                             | igual que 768                                               |
| Insignia de vencimiento sin cotizar   | `Cancelado: se venció el plazo` cabe en dos líneas dentro del `Badge`, sin truncar ni abreviar                                                                                                                    | dos líneas             | una línea                                                          | una línea                                                   |

La regla de los cuatro tamaños, heredada de F-010 y F-019 y no renegociada: una
columna, ninguna acción flotante, nada que se abra por encima de lo que el
comprador está leyendo, y **ningún importe partido por un salto de línea**. Es
por eso que la coletilla es una línea aparte y no un sufijo de la cifra: `$1,234.56
más el envío por confirmar` como un solo nodo de texto se parte por donde el
navegador quiera, y puede dejar «$1,234.56 más» al final de una línea, que se lee
como otra cifra.

## Componentes de UI

**Ninguno nuevo en `src/components/ui/`.** Lo que hace falta —una fila de
importes, una tarjeta de radio, una insignia, un `<dl>`— existe y se usa tal
cual: `src/components/ui/RadioCard.tsx`, `src/components/ui/Badge.tsx`,
`src/components/ui/Card.tsx`, `src/components/ui/Alert.tsx`,
`src/components/ui/Button.tsx`, `src/components/ui/Field.tsx`.

| Archivo                                                | Qué gana                                                                                                                     | `"use client"`                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/features/cart/components/OrderSummary.tsx`        | Un booleano para renombrar el total y pintar la coletilla. La fila de envío entra por `deliveryFeeLabel`, sin contrato nuevo | **No.** Sigue siendo presentacional; su cabecera ya lo dice y no cambia         |
| `src/features/cart/components/CheckoutForm.tsx`        | La descripción del radio, el párrafo nuevo, y pasar el booleano y la etiqueta al resumen                                     | Ya la tiene (isla de F-010). **No se añade estado nuevo**                       |
| `src/features/orders/components/OrderLinesTable.tsx`   | Modalidad + booleano, la regla de visibilidad nueva y la etiqueta del total con su coletilla                                 | **No** — server component, y la página entera sigue con cero módulos de cliente |
| `src/features/orders/components/OrderProposalCard.tsx` | El booleano del pedido, los tres `dt` nuevos, el titular y los dos párrafos                                                  | **No**                                                                          |
| `src/features/orders/components/OrderStatusBadge.tsx`  | El booleano, para bifurcar `CANCELLED`/`EXPIRY` y la explicación de `AWAITING_CUSTOMER`                                      | **No**                                                                          |
| `src/app/[slug]/pedido/[code]/page.tsx`                | Pasa el booleano y la modalidad a los tres de arriba; tira y títulos en dos variantes                                        | **No**                                                                          |
| `src/features/orders/whatsapp.ts`                      | El booleano en `WhatsappOrderInput`, y las dos líneas del mensaje                                                            | No aplica: es servidor puro                                                     |
| `src/features/orders/proposalDiff.ts`                  | El booleano del pedido actual, la condición de emisión y las dos frases                                                      | No aplica                                                                       |

**Lo que no se toca:** `src/features/cart/components/CartView.tsx`,
`src/features/orders/components/WhatsappOrderLink.tsx`,
`src/features/cart/components/CartLineRow.tsx` y el bloque de rechazo de la
tarjeta de propuesta.

## Tokens y tema

**Ni un token nuevo, ni un valor hardcodeado.** `scripts/check-theme-tokens.mjs`
no tiene por qué enterarse de este feature.

| Uso                                    | Token / utilidad                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Por confirmar` en la celda de envío   | `text-fg` — el mismo que ya reciben las cadenas no nulas en `OrderSummary.tsx:49`        |
| Etiqueta `Total parcial`               | La fila del total ya es `font-semibold` con `border-t border-border`: sin cambios        |
| Coletilla `más el envío por confirmar` | `text-fg text-sm mt-0.5 text-right` — **no** `text-fg-muted`, **no** `text-xs`           |
| `Costo por confirmar` en el radio      | `text-fg-muted text-sm`, que es lo que `RadioCard` ya aplica a `description`             |
| Párrafo nuevo del checkout             | `text-fg-muted text-sm`, igual que el párrafo de las líneas 779-782                      |
| Insignia de vencimiento sin cotizar    | `Badge tone="danger"` → `bg-danger/12 text-danger`, el mismo tono que el `EXPIRY` de hoy |
| Tarjeta de propuesta                   | `border-warning/30 bg-surface`, sin tocar                                                |

**Branding por tienda.** Nada de esta copia se pinta con `--color-brand` ni con
`--color-accent`, así que una tienda con marca chillona no puede volver ilegible
la palabra «Por confirmar»: vive sobre `--color-surface` con `--color-fg`, que es
el par de contraste que el tema garantiza en claro y en oscuro. Y como el estado
no se comunica con color, un tema oscuro con `--color-warning` desvaído tampoco
lo pierde.

## Accesibilidad

- **«Por confirmar» no depende del color, ni de un icono, ni de una insignia.**
  Es la palabra la que lo dice. Se evaluó y se descartó envolverla en
  `Badge tone="warning"`: dentro de una columna de importes, una pastilla de
  color pesa más que la fila del total, y el estado se perdería para quien no
  distinga el tono. Sin icono, por la misma razón y porque un `aria-label` en un
  `<span>` decorativo se lo salta la mitad de los lectores.
- **Orden de lectura, que es el que hace el trabajo.** En cada fila el DOM va
  etiqueta → valor, y en el bloque del total etiqueta → importe → coletilla. Un
  lector de pantalla lee «Total parcial, $1,234.56, más el envío por confirmar»
  en ese orden, que es la frase completa de SP4. **No hace falta ningún
  `aria-describedby`** y no se añade: cablearlo duplicaría la coletilla en los
  lectores que anuncian descripción y contenido.
- **No se pasa `announcement` a `OrderSummary`.** El bloque ya es
  `aria-live="polite" aria-busy` (línea 31) y la coletilla es texto visible
  **dentro** de la región: al cambiar de retiro a domicilio se anuncia una vez.
  Pasar además el `sr-only` de la línea 63 la anunciaría dos veces.
- **El radio lo dice al enfocarse.** `RadioCard` mete `label` y `description`
  dentro del `<label>`, así que «Envío a domicilio, costo por confirmar» es el
  nombre accesible del `<input type="radio">`: el estado viaja con el control, no
  solo en el resumen que está a un `Tab` de distancia. Área de toque `min-h-14`,
  sin cambios.
- **Orden de foco en el checkout, sin cambios.** El párrafo nuevo es texto, no es
  focalizable y va **después** del campo de dirección, así que no se cuela entre
  el campo y el botón.
- **Contraste.** `text-fg` sobre `text-surface` y `Badge tone="danger"` son pares
  ya usados en las mismas superficies; no se introduce ninguna combinación nueva
  que haya que medir.
- **Teclado.** Cero controles nuevos: ni un `<details>` más, ni un botón más, ni
  un `tabindex`. El `id="respuesta"` con `tabIndex={-1}` de la página y los dos
  `<details>` de la tarjeta siguen exactamente como los dejó F-019.
- **La insignia larga no se trunca.** `Cancelado: se venció el plazo` envuelve
  dentro del `Badge`; nada de `truncate` ni de puntos suspensivos, que es la
  regla que F-019 ya fijó para sus dos etiquetas largas.

## Coste de cliente

**Cero `"use client"` nuevos.** Las siete superficies se reparten así:

- **Server components, sin directiva y sin ganarla:**
  `src/features/orders/components/OrderLinesTable.tsx`,
  `src/features/orders/components/OrderProposalCard.tsx`,
  `src/features/orders/components/OrderStatusBadge.tsx` y
  `src/app/[slug]/pedido/[code]/page.tsx`. La página del pedido sigue con **cero
  módulos de cliente propios**, que es lo que F-019 dejó y lo que hace que el
  criterio 3 se pueda verificar con `curl`.
- **Módulos de servidor puros:** `src/features/orders/whatsapp.ts` y
  `src/features/orders/proposalDiff.ts`. Nada que empaquetar.
- **Isla que ya existe:** `src/features/cart/components/CheckoutForm.tsx`, que es
  cliente por necesidad desde F-010 (el carrito vive en el navegador y la
  cotización se pide con `fetch`).
  `src/features/cart/components/OrderSummary.tsx` **no** lleva directiva y no la
  gana: es presentacional y lo dicen sus líneas 1-9.
- **Nada de esto renderiza catálogo**, así que la prohibición dura de AGENTS.md
  no se roza.

**Presupuesto.** Lo que entra en el bundle de cliente es texto y una rama: cinco
cadenas cortas en `CheckoutForm`/`OrderSummary` («Por confirmar», «Total
parcial», «más el envío por confirmar», «Costo por confirmar» y el párrafo de
unas 190 letras), más el `if` del booleano. Del orden de **0,3 KB sin comprimir**
y menos de 0,2 KB después de gzip, contra los 193 KB de
`scripts/check-bundle-budget.mjs:26` (F-010 midió 182,1 KB, así que hay ~11 KB de
margen). **No hay que subir `BUDGET_KB`** y quien implemente no debería tocarlo:
si `npm run check:bundle` se pone rojo por este feature, el problema es otro y
hay que mirarlo, no subir el número.

No se descartó nada de este diseño para ahorrar kilobytes, que es la mitad que
AGENTS.md pide no olvidar: la coletilla de SP4 se pinta siempre, aunque sean
bytes de texto en la isla más cargada del repo.

## Textos

Todo lo anterior, junto, listo para pegar. **Cadenas nuevas: doce.** Cadenas
modificadas: cinco. Cadenas de tarifa fija tocadas: **cero**.

### Checkout

| Sitio                                                 | Texto                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RadioCard` de domicilio, `description`               | `Costo por confirmar`                                                                                                                                        |
| Párrafo bajo la dirección (modo cotizado, `DELIVERY`) | `Cuando la tienda revise tu pedido va a poner el costo del envío y te va a contactar para que lo apruebes o lo rechaces. Hasta entonces no se prepara nada.` |
| Fila de envío del resumen                             | `Envío` · `Por confirmar`                                                                                                                                    |
| Bloque del total                                      | `Total parcial` · `$1,234.56` · `más el envío por confirmar`                                                                                                 |
| Botón primario                                        | `Confirmar pedido` — sin cambio                                                                                                                              |

### Página del pedido

| Sitio                                           | Texto                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabla, fila de envío sin cotizar                | `Envío` · `Por confirmar`                                                                                                                                                    |
| Tabla, total sin cotizar                        | `Total parcial` · `$1,234.56` · `más el envío por confirmar`                                                                                                                 |
| Tira, con propuesta sobre un pedido sin cotizar | `La tienda ya calculó el envío de tu pedido`                                                                                                                                 |
| Tira, enlace                                    | `Ver el envío y responder`                                                                                                                                                   |
| Insignia `AWAITING_CUSTOMER`, explicación       | `La tienda ya puso el costo del envío. Apruébalo o recházalo aquí abajo.`                                                                                                    |
| Insignia `CANCELLED`/`EXPIRY` sin cotizar       | `Cancelado: se venció el plazo` + `La tienda no llegó a confirmar el costo del envío y el plazo del pedido se acabó. No se te cobró nada; si todavía lo quieres, escríbele.` |
| Título de la tabla propuesta                    | `Tu pedido con el envío incluido`                                                                                                                                            |
| `summary` de la tabla plegada                   | `Ver tu pedido sin el envío`                                                                                                                                                 |

### Tarjeta de la propuesta

| Sitio                           | Texto                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Titular                         | `La tienda ya calculó el envío`                                                                                                                                                                  |
| `dl`, tres pares                | `Total sin el envío` · `$1,234.56` — `Total con el envío` · `$1,414.56` — `El envío` · `$180.00`                                                                                                 |
| Envío regalado (cifras iguales) | `Ya está el total completo: la tienda no te cobra el envío, así que sigue siendo $1,234.56.`                                                                                                     |
| Párrafo de aprobar              | `Vas a aceptar el envío que puso la tienda: pagarías $1,414.56, que es tu pedido ($1,234.56) más el envío ($180.00). La tienda prepara tu pedido con estos importes y te contacta por teléfono.` |
| Botón de aprobar                | `Sí, acepto pagar $1,414.56` — sin cambio                                                                                                                                                        |
| Bloque de rechazar              | sin cambio                                                                                                                                                                                       |

### Diff

`Envío: estaba por confirmar, ahora $180.00.` ·
`Envío: estaba por confirmar, ahora sin costo.`

### WhatsApp

Las dos líneas que cambian: `Envío: por confirmar` y
`Total parcial: $1,234.56 más el envío por confirmar`. El mensaje completo está
en § Inventario, superficie 4.

### Motivos que viajan al POS, no al comprador

| Constante                                                      | Literal                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ORDER_EXPIRED_PROPOSAL_REASON` (`src/constants/orders.ts:79`) | `La propuesta venció sin respuesta` — **no se toca** (R6 de F-019) |
| Motivo del pedido sin cotizar que vence (nueva)                | `El pedido venció sin que se confirmara el costo del envío`        |

Son distintos, que es lo que pide E9, y ninguno se imprime en pantalla: la
página no lee `cancelReason` (`src/app/[slug]/pedido/[code]/page.tsx` no lo
usa), lo lee cuadrecaja por el pull. El nombre de la constante es del
implementador; el literal es este.

## Verificación visual

Qué mirar, con qué datos y en qué ancho. Los dos primeros puntos son
condiciones de los **datos**, no del diseño, y sin ellos dos criterios no se
pueden comprobar:

1. **Los importes de prueba tienen que llevar centavos distintos de `00`.**
   Con un subtotal de `$1,000.00`, la cadena `0.00` aparece dentro del total
   —«1,000.00» la contiene— y cualquier aserto de «no imprime el cero» da un
   falso positivo. El guion de punta a punta (scripts/quote-delivery-order.mjs,
   por crear) debería sembrar líneas cuyo subtotal acabe en algo como `$1,234.56`.
   Ver **DP1**, que es el mismo problema visto desde el criterio.
2. **La activación por SQL del modo sobre `tienda-demo`** es la única forma de
   ver esta pantalla (I8): es la única tienda `WHATSAPP` del seed y hoy no ofrece
   envío.
3. **Checkout a 320 y 360 px**, modo cotizado: elegir domicilio y comprobar que
   la descripción del radio no tiene ni un dígito, que `Por confirmar` no se
   parte y que la coletilla queda pegada a la cifra del total y **no** en letra
   chica gris. Después volver a retiro y comprobar que el resumen vuelve a
   `Total` y `Envío $0.00` sin residuos.
4. **Página del pedido sin cotizar**, `curl` incluido: la fila de envío **está**
   (es la corrección de I4), dice `Por confirmar`, el total dice `Total parcial`
   y la coletilla aparece. Y en el `href` de `wa.me`, decodificado, las dos
   líneas del § 4.
5. **La transición**: la misma URL antes y después de proponer. Antes, la
   etiqueta `Total parcial`; después, tira «La tienda ya calculó el envío de tu
   pedido», `dl` con `Total sin el envío` / `Total con el envío` / `El envío`,
   tabla «Tu pedido con el envío incluido» y, al desplegar «Ver tu pedido sin el
   envío», otra vez `Por confirmar`. Después de aprobar: `Envío $180.00`,
   `Total`, y cero apariciones de «por confirmar» en toda la página, que es E11
   medido.
6. **Envío regalado**: cotizar `0.00`, aprobar, y comprobar que la fila de envío
   **sigue existiendo** con `$0.00` y que el diff dijo «ahora sin costo».
7. **Retiro en tienda en modo cotizado**: la fila de envío de la tabla **no**
   aparece y el total es `Total` desde el primer momento (E8).
8. **Vencimiento sin cotizar**: forzando la fecha, la insignia dice
   `Cancelado: se venció el plazo` y **no** menciona ninguna propuesta.
9. **No-regresión de tarifa fija**, que es el criterio 9 y el que protege todo lo
   demás: `bash .agent/verify.sh F-010 --visual` en 0 con el guion sin tocar.

Si `sdd-tester` decide que hace falta guion propio, los puntos 3, 4, 5 y 7 son
los que valen la pena en navegador; el resto se ve con `curl` y con `jsdom`.

## Preguntas al humano

**DP1 — El `'0,00'` de los criterios 3 y 10 no es lo que la pantalla imprime.**
`formatMoney` usa el locale `es-CU`, que pone **coma de millares y punto
decimal**: un cero es `$0.00`, nunca `0,00`. Comprobado en el Node del repo. Dos
consecuencias: (a) `grep -c '0,00'` pasaría **siempre**, aunque la pantalla
imprimiera el cero, así que como está el criterio no protege nada; (b) si se
corrige a `'0.00'`, cualquier total con millares y centavos en `00` —`$1,000.00`—
lo contiene y el criterio falla por un falso positivo. Los criterios son
intocables (regla 3), así que la pregunta es cómo se verifica su **intención**:

- **(a) Recomendada.** Se dejan los doce criterios literales y el guion siembra
  importes con centavos distintos de `00` (p. ej. subtotal `$1,234.56`), más un
  aserto que sí muerde: la celda de envío es exactamente `Por confirmar` y la
  etiqueta del total es `Total parcial`. Coste: una línea en el guion.
- (b) Se reinterpreta el criterio como «ninguna de las dos **celdas** es un cero
  formateado», acotando el `grep` a esas dos líneas del HTML. Más fiel a la
  intención, pero exige leer el criterio distinto de como está escrito.
- (c) El humano corrige el literal de los criterios 3 y 10 en
  `.agent/features.json`. Es lo único que hace desaparecer la trampa, y es suyo.

**DP2 — Un pedido sin cotizar en una tienda `ONSITE` deja al comprador sin
manera de preguntar.** En una tienda `WHATSAPP` la página ofrece «Enviar el
pedido por WhatsApp». En una `ONSITE` no hay ningún enlace a la tienda hasta que
aparece la propuesta —`storeContactUrl` solo se pinta dentro de
`src/features/orders/components/OrderProposalCard.tsx`—, así que quien espera una
cotización que no llega solo tiene el aviso de vencimiento. Se puede añadir el
`Escribirle a la tienda` que ya existe (`buildCustomerContactUrl`, cero JS, cero
componentes nuevos) para los pedidos sin cotizar.

- **(a) Recomendada: no ahora.** No lo pide ningún criterio, y el pedido sin
  cotizar ya tiene su reloj (E9), que es la respuesta que SP1 dio a «nadie lo
  mira». Añadir superficie aquí es alcance que la spec no abrió.
- (b) Añadirlo en este feature: una línea en
  `src/app/[slug]/pedido/[code]/page.tsx` reutilizando el enlace que ya se
  construye. Barato, pero es copia nueva en una pantalla que este ciclo ya toca
  en siete sitios.
