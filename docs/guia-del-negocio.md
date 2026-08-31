# Guía del negocio: de abrir la tienda a entregar un pedido

Esta guía es para las personas, no para el código. Explica **quién hace qué** y
**dónde lo hace** en cada momento: el dueño del negocio, quien atiende los
pedidos, y el comprador.

Hay dos programas y conviene no confundirlos nunca:

- **Cuadre de Caja** es el punto de venta. Ahí viven los productos, los precios,
  las existencias y los pedidos. **Es la fuente de la verdad.**
- **queandabuscando** es la tienda online. Muestra lo que Cuadre de Caja le
  manda y recoge los pedidos de los compradores.

Los dos se hablan solos cada dos minutos. Nadie tiene que copiar nada a mano.

> ## ⚠ Antes de seguir leyendo: qué existe hoy
>
> **La tienda online está construida y funciona. La parte de Cuadre de Caja
> todavía no.** Todo lo que en esta guía dice «en Cuadre de Caja, haz X» describe
> lo que ese equipo tiene que construir; hoy no hay ninguna pantalla donde
> hacerlo.
>
> Además, la **modificación de un pedido** (parte 3, § «Cuando hay que cambiar
> algo») está terminada pero aún no publicada.
>
> Se avisa aquí y no al final para que nadie intente seguir estos pasos hoy y
> crea que hace algo mal.

---

## Las personas de esta historia

| Quién                    | Dónde trabaja      | De qué se ocupa                                     |
| ------------------------ | ------------------ | --------------------------------------------------- |
| **Súper administrador**  | Cuadre de Caja     | Decide qué negocios pueden tener tienda online      |
| **Dueño del negocio**    | Cuadre de Caja     | Publica su tienda, mantiene productos y precios     |
| **Encargado de pedidos** | Cuadre de Caja     | Atiende cada pedido que entra                       |
| **Dueño, otra vez**      | Panel de la tienda | Viste la vitrina: fotos, descripciones, promociones |
| **Comprador**            | La tienda online   | Mira, arma su carrito y pide                        |
| **Equipo técnico**       | Detrás de todo     | Solo hace falta al principio, y para tres ajustes   |

El dueño aparece dos veces a propósito: usa **los dos** programas, y cada uno
sirve para cosas distintas. La tabla de la parte 2 dice cuál para qué.

---

# Parte 1 · Abrir la tienda

Se hace **una sola vez** por negocio. Después, todo es rutina.

### Paso 1 · El súper administrador da permiso

**Quién:** súper administrador · **Dónde:** Cuadre de Caja

Habilita la tienda online para ese negocio. Es una decisión comercial y se toma
entera dentro de Cuadre de Caja: la tienda online no aprueba ni rechaza a nadie,
confía en esta decisión.

### Paso 2 · El equipo técnico entrega la clave de conexión

**Quién:** equipo técnico · **Dónde:** fuera de las dos aplicaciones

Es la llave que permite a Cuadre de Caja hablar con la tienda online. Se genera
una vez por negocio y **se ve una sola vez**: si se pierde, no se recupera —hay
que generar otra.

Tres cosas que conviene saber:

- Es **de ese negocio y de nadie más**. Con ella no se puede tocar el negocio de
  otro.
- Se guarda en la configuración de **ese** negocio dentro de Cuadre de Caja.
- Si alguna vez se sospecha que se filtró, se genera otra. **Ojo:** la anterior
  deja de valer al instante, así que hasta que la nueva esté guardada en Cuadre
  de Caja ese negocio no sincroniza. No se pierde nada, pero la tienda se queda
  con precios viejos un rato.

> Hoy este paso lo hace una persona del equipo técnico a mano. Está propuesto
> que lo haga Cuadre de Caja solo, en el momento en que el dueño abre su tienda
> — `.agent/specs/propuestas/credenciales-de-integracion.md`.

### Paso 3 · El dueño publica su local

**Quién:** dueño del negocio · **Dónde:** Cuadre de Caja

Marca su local como **«publicar en tienda»**. Eso es todo. No hay que crear nada
del otro lado: la tienda se crea sola en cuanto llega el aviso.

### Paso 4 · Esperar dos minutos

**Quién:** nadie · **Dónde:** pasa solo

Cuadre de Caja manda los cambios cada dos minutos. Pasado ese rato, la tienda ya
existe y tiene su dirección web.

### Paso 5 · Comprobar la dirección web

**Quién:** dueño del negocio · **Dónde:** el navegador

La tienda vive en una dirección del tipo `queandabuscando.com/la-rampa`, sacada
del nombre del negocio. Si ese nombre ya lo tenía otro, el sistema elige el
siguiente libre (`la-rampa-2`) **sin avisar y sin fallar**.

**Míralo antes de imprimir nada.** Esa dirección tiene una regla dura:

> Una dirección web **no se recicla nunca**. Si un día ese negocio desaparece,
> su dirección no vuelve a estar libre para nadie más.

Es deliberado: así un cartel, un QR o una tarjeta impresa nunca acaban llevando
al negocio de otra persona. Pero significa que conviene mirar la dirección antes
de que se imprima en algo.

### Paso 6 · Elegir qué productos se publican

**Quién:** dueño del negocio · **Dónde:** Cuadre de Caja

Producto por producto, marcar cuáles salen en la tienda online. Los que no se
marquen no existen para el comprador.

A los dos minutos aparecen en la tienda con su nombre, su precio y si hay
existencias.

**La tienda nunca dice cuántas unidades quedan.** Solo muestra tres estados:
disponible, quedan pocas, o agotado. Las cifras de inventario no salen de Cuadre
de Caja: la competencia no tiene por qué verlas.

---

# Parte 2 · Vestir la tienda y mantenerla

### Cómo se entra al panel de la tienda

**Sin contraseña nueva.** Se entra desde Cuadre de Caja, con un enlace que abre
la sesión ya iniciada. La contraseña de Cuadre de Caja no viaja a la tienda
online en ningún momento.

Tres detalles prácticos:

- El enlace **sirve una sola vez**. Guardarlo en favoritos no funciona: hay que
  volver a entrar desde Cuadre de Caja.
- La sesión dura **12 horas**.
- Cada persona ve solo las sucursales que gestiona en Cuadre de Caja. Si se le
  quita el acceso a una allí, deja de verla aquí **la próxima vez que entre**.

### ¿Dónde cambio cada cosa?

Esta es la tabla que evita el 90 % de las confusiones. Cambiar algo en el sitio
equivocado no da error: simplemente no pasa nada, o se deshace solo al rato.

| Lo que quieres cambiar                     | Dónde se cambia        |
| ------------------------------------------ | ---------------------- |
| Nombre del producto                        | **Cuadre de Caja**     |
| Precio                                     | **Cuadre de Caja**     |
| Existencias / disponibilidad               | **Cuadre de Caja**     |
| Categoría del producto                     | **Cuadre de Caja**     |
| Códigos de barras                          | **Cuadre de Caja**     |
| Si el producto sale o no en la tienda      | **Cuadre de Caja**     |
| Nombre, dirección, teléfono, WhatsApp      | **Cuadre de Caja**     |
| Descripción larga del producto             | **Panel de la tienda** |
| Fotos del producto                         | **Panel de la tienda** |
| Precio especial solo para la tienda online | **Panel de la tienda** |
| Ocultar un producto solo en la tienda      | **Panel de la tienda** |
| Destacar un producto                       | **Panel de la tienda** |
| Promociones y descuentos                   | **Panel de la tienda** |
| Colores y aspecto de la marca              | **Panel de la tienda** |
| Cerrar la tienda temporalmente             | **Panel de la tienda** |

**La regla, en una frase:** lo que ya existe en tu punto de venta se cambia en tu
punto de venta; lo que solo tiene sentido en una vitrina se cambia en la vitrina.

### El precio especial de la tienda online

Se puede poner un precio distinto del de mostrador. Mientras ese precio exista,
**Cuadre de Caja no lo pisa**: cambiar el precio allí no cambia el de la tienda.

Es la causa número uno de «cambié el precio y no se ve». Para volver a seguir el
precio del punto de venta, hay que **quitar** el precio especial, no igualarlo.

### Cerrar la tienda por unos días

Vacaciones, inventario, una reforma. Se cierra desde el panel con un motivo de
una lista, y el comprador ve un aviso claro.

Qué pasa cuando está cerrada:

- La página **sigue existiendo** con el nombre, la marca y el motivo. No es un
  error 404.
- No se puede comprar ni añadir al carrito.
- **Los pedidos que ya estaban hechos siguen consultándose.** Nadie pierde su
  comprobante porque la tienda cerró.

**Un aviso importante:** si alguien en Cuadre de Caja cambia el interruptor de
«publicar en tienda» de ese local, **manda Cuadre de Caja**. Puede reabrir una
tienda que se había cerrado desde el panel. Cambiar cualquier otra cosa allí (un
teléfono, una dirección) no la reabre — solo tocar ese interruptor.

### Tres ajustes que hoy no se pueden cambiar solo

Hay que pedírselos al equipo técnico:

1. **Si al confirmar aparece un botón de WhatsApp** hacia la tienda.
2. **Si se ofrece entrega a domicilio y cuánto cuesta.** Si no está configurado,
   todo pedido se trata como recogida en el local.
3. **Cuántas horas dura una propuesta de cambio** antes de vencer (por defecto,
   un día).

No hay pantalla para ninguno de los tres todavía.

---

# Parte 3 · Una compra, de principio a fin

### Lo que hace el comprador

1. Entra a la tienda y mira el catálogo.
2. Añade productos al carrito. **No necesita cuenta.**
3. En el carrito, el sistema vuelve a comprobar precios y existencias de verdad,
   por si algo cambió mientras miraba.
4. Escribe su nombre, su teléfono y —si hay entrega— su dirección.
5. Confirma.

Y recibe:

- Una **página de su pedido** con todo el detalle, que puede volver a abrir
  cuando quiera.
- Un **código de 10 caracteres** que identifica ese pedido.
- Si la tienda lo tiene activado, un botón para escribirle por WhatsApp. **Es
  opcional**: el pedido ya está hecho aunque no lo use.

> **Sobre el código del pedido, dilo a tus compradores si hace falta:** ese
> enlace es la única llave de esa página, y la página muestra nombre, teléfono y
> dirección. Quien tenga el enlace, ve los datos. No conviene publicarlo ni
> pegarlo en un grupo.
>
> Está hecho de letras y números que no se confunden al dictarlos por teléfono:
> no lleva `I`, `L`, `O` ni `U`.

**La cuenta es opcional, siempre.** Quien se registre solo gana no volver a
teclear su nombre y su teléfono en cada pedido. Quien no, compra igual.

### Lo que hace el encargado

1. **Espera.** El pedido aparece solo en Cuadre de Caja, en menos de dos minutos.
   No hay que refrescar nada ni entrar a ninguna otra parte.
2. Lo revisa y marca cómo va: **confirmado**, **listo**, **en camino**,
   **entregado**. También puede **cancelarlo** o **rechazarlo** si no puede
   atenderlo.
3. Cada cambio se ve en la página del comprador, sin que nadie le avise a mano.

**Los pedidos se gestionan en Cuadre de Caja, no en el panel de la tienda.** El
panel es para la vitrina; los pedidos son del punto de venta.

### Cuando hay que cambiar algo del pedido

El caso típico: el pedido entra sin costo de envío, y al gestionarlo resulta que
llevarlo a ese barrio cuesta 180.

**El encargado** propone el cambio desde Cuadre de Caja: los importes nuevos, las
líneas nuevas si hace falta, y un mensaje corto explicando por qué.

Entonces:

1. El pedido queda **esperando respuesta del comprador**, con un plazo (un día,
   por defecto).
2. Cuadre de Caja le da al encargado **un enlace de WhatsApp ya escrito** hacia
   ese comprador.
3. **El encargado hace clic y lo manda.** Esto importa: **el sistema no le
   escribe a nadie por su cuenta, nunca.** Siempre hay una persona que decide
   enviar.
4. El comprador abre la página de su pedido y ve, lado a lado, **lo que costaba
   antes y lo que costaría ahora**, con el detalle y el plazo.
5. Acepta o rechaza, con un botón.

Tres finales posibles:

| Qué pasa                 | Cómo queda el pedido                               |
| ------------------------ | -------------------------------------------------- |
| El comprador **acepta**  | Confirmado, con los importes nuevos                |
| El comprador **rechaza** | Cancelado, y consta que fue decisión del comprador |
| **No contesta** a tiempo | Cancelado solo, y consta que venció el plazo       |

El encargado ve cuál de los tres fue, sin tener que preguntar.

**Una segunda propuesta reemplaza a la primera** y reinicia el plazo. Y si el
comprador tarda demasiado, ya no puede aceptar aunque le llegue el mensaje
tarde.

---

# Parte 4 · Lo que suele confundir

**«Cambié el precio en Cuadre de Caja y la tienda muestra el viejo.»**
Dale dos minutos. Si sigue igual, casi seguro ese producto tiene un **precio
especial** puesto en el panel de la tienda, y ese manda. Quítalo.

**«Puse un producto nuevo y no aparece.»**
Comprueba que esté marcado como publicado en la tienda, en Cuadre de Caja. Y
recuerda los dos minutos.

**«Escribí una descripción bonita en Cuadre de Caja y la tienda no la muestra.»**
La descripción de la vitrina se escribe en el panel de la tienda. Son textos
distintos a propósito: uno es para tu equipo, otro para quien compra.

**«Cerré la tienda y volvió a abrirse sola.»**
Alguien tocó el interruptor de «publicar en tienda» de ese local en Cuadre de
Caja. Ese interruptor manda sobre el del panel.

**«Un pedido no me llegó al punto de venta.»**
Se recogen cada dos minutos. Si pasa mucho más, avisa al equipo técnico: el
pedido **no se pierde**, se queda esperando a que la conexión vuelva.

**«El comprador dice que le llegó un enlace raro.»**
Comprueba con el equipo técnico que la dirección del sitio esté bien
configurada. Es el fallo más silencioso que existe: todo funciona, y los enlaces
apuntan a otro sitio.

**«¿Puedo borrar un pedido?»**
No. Se cancela, y queda el registro. La página del comprador tiene que seguir
funcionando: es su comprobante.

---

## Si algo de esta guía no coincide con lo que ves

Gana lo que ves. Avísale al equipo técnico y que se corrija aquí — este
documento se mantiene junto con el resto de la documentación, y una guía que
miente es peor que no tenerla.

Documentos hermanos, más técnicos:
[`sync-contract.md`](sync-contract.md) (lo que construye Cuadre de Caja),
[`despliegue.md`](despliegue.md) (poner el sistema en producción) y
[`adr/`](adr/) (por qué cada decisión es como es).
