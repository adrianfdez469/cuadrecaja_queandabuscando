---
feature: F-042
agente: sdd-spec
actualizado: 2026-09-09T04:41:30Z
estado: listo
---

> **La mitad visible de la S-007.** F-041 construyó el vocabulario y el lado que
> no ve nadie —el índice de 184 zonas, la precedencia, el tarifario, la v13 en
> borrador— y dejó una negativa escrita: **hoy una tienda `ZONE_BASED` no ofrece
> domicilio en absoluto** (R13 de `.agent/specs/F-041/spec.md`,
> `src/features/orders/deliveryOffer.ts`). Este feature sustituye esa negativa
> por la pregunta de verdad: ¿tiene esta tienda alguna zona con tarifa
> resoluble, y cuál eligió el comprador?
>
> **Cinco decisiones del humano del 2026-09-09 que esta spec da por firmes y no
> vuelve a preguntar** (`.agent/progress/F-042.md` § «Decisiones tomadas»):
> **D1** el criterio 8 se reescribió a propósito y el checkout **sí** lleva
> JavaScript; **D2** el mapa es Leaflet 1.9.4 + react-leaflet 5.0.0 con teselas
> de OpenStreetMap, atribución visible y obligatoria, y proveedor alternativo
> por un **par** de variables de entorno; **D3** `contact.zoneCode` y
> `contact.zoneName` son opcionales en el schema y obligatorios de hecho en un
> pedido a domicilio de una tienda `ZONE_BASED`, y `contact.zoneCode` es
> **siempre** un municipio; **D4** la v13 **no se publica** aquí —F-043 entra
> antes—, pero su borrador se edita y su versión se mueve; **D5** los nombres
> del catálogo **no entran en el bundle de cliente**.

## Problema

Un comercio cubano que cobra el envío por municipio ya puede cargar su tarifario
—F-041 lo trajo entero— y aun así **su tienda no ofrece domicilio**: no hay
pantalla donde el comprador diga dónde vive, así que no hay zona que resolver y
el pedido a domicilio degrada a recogida en silencio. El comerciante que cambia
de `FLAT_RATE` a `ZONE_BASED` apaga su domicilio sin querer, y el comprador de
Playa sigue sin poder pedir a domicilio aunque la tienda tenga «Playa 300»
escrito en su tarifario desde hace una semana.

Y la mitad de usabilidad que ninguna lista resuelve sola: en La Habana mucha
gente **no sabe** si su calle es de Playa o de Marianao. Un selector que solo
sea una lista de nombres deja a esa persona adivinando el precio de su propio
envío.

## Alcance

### Dentro

1. **El selector de zona en el checkout** de una tienda `ZONE_BASED` con
   domicilio: lista con **escritura predictiva** como camino primario, con las
   zonas **renderizadas en servidor** (D5).
2. **El mapa como desempate**, cargado **solo al pedirlo**, con la geometría
   servida **por cobertura declarada de la tienda** y confirmación **en texto**
   del municipio antes de aceptar.
3. **El artefacto de geometría** y su procedencia —el segundo de los dos que la
   ADR 0032 (e) separó—, con simplificación **topológica en una sola operación**
   sobre todo el conjunto y sus dos comprobaciones de generación.
4. **El importe del envío antes de confirmar**: la resolución por zona alimenta
   lo que la pantalla muestra y lo que el servidor cobra, y las dos salen del
   mismo sitio.
5. **La pregunta de verdad de `isDeliveryOffered` para `ZONE_BASED`**, que
   sustituye el `return false` que la ADR 0033 dejó anotado como provisional, y
   la rama de `deliveryFeeForNewOrder` que hoy **lanza**.
6. **Dos columnas nuevas en `Order`** —el código de zona y el **nombre como
   instantánea**— y su escritura en el camino de creación del pedido.
7. **`contact.zoneCode` y `contact.zoneName` en el pull**, con
   `deliveryFeePending: false`.
8. **La edición del borrador de la v13** de `docs/sync-contract.md` que contesta
   las dos preguntas que ese documento reservó a este feature, con su versión
   movida (D4, SP1).
9. **Los pasos operativos nuevos** en `docs/despliegue.md`: el par de variables
   de entorno del proveedor de teselas y lo que haga falta para que la geometría
   llegue a un entorno nuevo.
10. **La medición del JavaScript** que este feature añade al checkout, anotada
    en `.agent/progress/F-042.md` (criterio 11), y el movimiento explícito de
    `BUDGET_KB` si hiciera falta (`scripts/check-bundle-budget.mjs`).

### Fuera (explícito)

1. **Cotizar a mano en una tienda `ZONE_BASED`.** `ZONE_BASED` y
   `QUOTED_PER_ORDER` son excluyentes (criterio 10). El ciclo de propuesta y
   aprobación de F-019/F-031 **no se toca**: un pedido `ZONE_BASED` nunca nace
   sin importe de envío, y lo que el POS haga después con
   `POST /api/internal/orders/proposal` sobre un pedido ya creado sigue siendo de
   F-019 y no es «cotizar el envío».
2. **Geocodificar direcciones y confiar en el GPS.** No hay pin, no hay
   «usar mi ubicación», no hay búsqueda de calles. La zona **la elige la
   persona**; el mapa solo le enseña dónde están las fronteras.
3. **`contact.lat`/`lng` y cualquier columna de coordenadas del pedido.** La
   propuesta las nombraba y F-041 las empujó aquí, pero **ningún criterio de
   F-042 las pide** y este feature no construye nada que las produzca — ver
   I5 y SP2.
4. **La búsqueda por cercanía y PostGIS.** La ADR 0011 no se reabre: aquí
   ninguna coordenada decide un precio ni ordena nada.
5. **Que los polígonos viajen por el sync.** Por el cable va el `code` y nada
   más.
6. **La pantalla del tarifario del encargado**, que es de cuadrecaja.
7. **Publicar la v13** (D4) y **editar el documento de solicitudes de
   cuadrecaja**, que está en su repositorio.
8. **F-043** —que un `zoneCode` desconocido falle solo su evento— y **F-044**
   —el tarifario en la reconciliación—. Son features propios
   (`.agent/solicitudes.md`, fila S-007).
9. **La página de estado del pedido, el mensaje de WhatsApp y el panel.**
   Ninguno de los tres cambia: el criterio 3 se comprueba en la base y en el
   pull, no en una pantalla nueva.
10. **Reconstruir el checkout para que funcione sin JavaScript** (D1). El
    `<noscript>` que ya existe declara lo que hace falta.

## Actores y precondiciones

**El comprador**, en `src/app/[slug]/checkout/page.tsx` de una tienda con
`deliveryFeeMode: "ZONE_BASED"` y `deliveryEnabled: true`. Es quien elige la
zona, y es el único que la elige.

**El encargado**, en cuadrecaja, que carga el tarifario. No toca nada de aquí y
no ve ninguna pantalla de este feature.

**El POS**, que pullea el pedido con `GET /api/internal/orders` y recibe la zona
ya elegida.

Lo que el sistema ya garantiza, **verificado leyendo el código**, y de lo que
dependen los escenarios de abajo:

- **El catálogo existe y es bytes commiteados**: 184 zonas en
  `src/features/zones/zone-index.json`, leídas por
  `src/features/zones/catalog.ts` (`findZone`, `isKnownZoneCode`,
  `isRetiredZone`, `ZONE_INDEX_VERSION`). Ninguna consulta.
- **La precedencia ya está resuelta y es pura**: `resolveZoneTariff(zone, rows)`
  en `src/features/zones/precedence.ts` devuelve si la zona se sirve, el
  importe como cadena de dos decimales, la fila que decidió y el camino
  completo.
- **Leer la tarifa de una zona concreta ya existe**: `resolveStoreZoneTariff` en
  `src/features/zones/server/tariffs.ts`, una consulta, ≤2 filas.
- **Hoy `isDeliveryOffered` devuelve `false` para `ZONE_BASED`**
  (`src/features/orders/deliveryOffer.ts`), así que el bloque «¿Cómo lo quieres
  recibir?» de `src/features/cart/components/CheckoutForm.tsx` **no se pinta**:
  el comprador de una tienda `ZONE_BASED` no ve ni la opción de domicilio.
- **`deliveryFeeForNewOrder` LANZA** en la rama `ZONE_BASED` + `"DELIVERY"`, a
  propósito (ADR 0033 § Consecuencias): es inalcanzable mientras
  `isDeliveryOffered` diga que no.
- **El checkout entero es una isla de cliente**
  (`src/features/cart/components/CheckoutForm.tsx`, `"use client"` en la línea
  1), el carrito vive en `localStorage` (`src/features/cart/cartStore.ts`) y el
  pedido sale por `fetch` desde un `onClick`. **No hay ni un Server Action en el
  repositorio.** Es la premisa entera de D1.
- **La página del checkout es `force-dynamic` con `revalidate = 0`**
  (`src/app/[slug]/checkout/page.tsx`), y la cotización
  (`src/features/orders/server/quote.ts`) no pasa por `cached`: **el checkout
  nunca lee un tarifario cacheado**, y una tarifa nueva se ve en la primera
  visita posterior sin depender de `STOREFRONT_REVALIDATE`
  (`src/lib/cache.ts`).
- **El total autoritativo lo calcula el servidor** y se compara contra
  `expectedTotal` (`src/features/orders/server/createOrder.ts`); un desajuste es
  `409 PRICE_CHANGED` con el total nuevo, y la pantalla ya tiene el camino
  «Confirmar con el total nuevo».
- **El contacto que persiste el pedido son cuatro campos planos**
  (`contactName`, `contactPhone`, `contactEmail`, `deliveryAddress`) y el pull
  los devuelve como las **cuatro** claves de `contact`
  (`src/features/orders/server/pulledOrder.ts`).
- **`deliveryFeePending` es exactamente `order.deliveryFee === null`**
  (`src/features/orders/server/pulledOrder.ts`), y el `0.00` de envío gratis
  viaja idéntico al `0.00` de relleno: es la trampa central de la v6 del
  contrato.
- **El índice no puede entrar en el árbol de cliente**: `eslint.config.mjs`
  prohíbe importarlo desde `src/components/**` y `src/app/**/*.tsx`, y
  `src/features/zones/boundaries.test.ts` mantiene una **lista blanca fija** de
  importadores que también cubre `*/components/**` —donde vive el checkout—.
  Añadir un importador es editar esa lista a conciencia.
- **No hay ninguna herramienta geo instalada** (`.agent/progress/F-042.md`
  § «Notas para quien retome»): ni `mapshaper`, ni `ogr2ogr`, ni `osmium`, ni
  `topojson`, ni `shapely`.

## Comportamiento esperado

### El selector

**E1 — una tienda `ZONE_BASED` con al menos una zona resoluble ofrece
domicilio.**
Dado una sucursal publicada con `deliveryEnabled: true`,
`deliveryFeeMode: "ZONE_BASED"` y una fila de tarifario que hace resoluble al
menos un municipio, cuando el comprador abre el checkout, entonces ve la opción
«Envío a domicilio» junto a la de recoger, y con ella el selector de zona.
Es la sustitución literal del `return false` de R13 de F-041.

**E2 — solo se ofrecen las zonas con tarifa resoluble.**
Dado una tienda cuyo tarifario tiene la provincia `23` con `rule: "FEE"` y el
municipio `23.05` con `rule: "NOT_SERVED"`, cuando el comprador abre el
selector, entonces aparecen los demás municipios de `23` y **`23.05` no
aparece** — ni deshabilitado, ni con una nota, ni al escribir su nombre
completo. No existe para esta tienda.

**E3 — se encuentra escribiendo, sin red y sin geometría.**
Dado el selector abierto, cuando el comprador escribe `pla`, entonces la lista
se reduce a las zonas ofrecibles cuyo nombre contiene esa secuencia, **sin una
sola petición de red** por lo que teclea y **sin descargar ningún polígono**.
Escribir `hab` encuentra «Habana Vieja» y escribir `holguin`, sin tilde,
encuentra «Holguín» (R6).

**E4 — elegir la zona muestra el importe antes de confirmar.**
Dado un tarifario con `23.01` a `300.00`, cuando el comprador elige «Playa»,
entonces la pantalla muestra `+ $300.00` como costo de envío y el total pasa a
`subtotal − descuento + 300.00`, **antes** de tocar «Confirmar pedido».

**E5 — un envío de `0.00` se muestra como envío gratis.**
Dado una fila `FEE` con importe `0`, cuando el comprador elige esa zona,
entonces la pantalla dice que el envío es gratis y el total **no** cambia, y en
ningún momento aparece «por confirmar» ni se cae a la tarifa de la provincia.
La comprobación que lo sostiene es contra `null`, **nunca** contra un valor
falsy.

**E6 — el paso de provincia aparece solo si la cobertura la cruza.**
Dado una tienda cuyas zonas ofrecibles están todas en la provincia `23`, cuando
el comprador abre el selector, entonces **no hay paso de provincia**: elige el
municipio directamente. Dado otra cuya cobertura toca `23` y `22`, entonces
**sí** aparece, y elegir provincia acota la lista de municipios.

### El mapa

**E7 — el mapa no se descarga hasta que alguien lo pide.**
Dado el checkout recién cargado de una tienda `ZONE_BASED`, cuando se listan las
peticiones que hace la página, entonces **ninguna** es de geometría, de teselas
ni del JavaScript del mapa. Solo al pulsar el control que lo abre aparecen esas
peticiones.

**E8 — el mapa sirve exactamente la cobertura declarada.**
Dado una tienda con cuatro municipios ofrecibles, cuando se abre el mapa,
entonces la geometría que llega trae **cuatro** zonas —contadas, no estimadas— y
ninguna más: ni la provincia entera, ni los municipios vecinos, ni el país.

**E9 — una fila de provincia con `FEE` es una cobertura de provincia, y eso no
es una regresión.**
Dado una tienda cuyo tarifario tiene una sola fila, la provincia `23` con
`rule: "FEE"`, cuando se abre el mapa, entonces llegan **los polígonos de todos
los municipios de `23`** —menos los que una fila de municipio deje no
servidos—, cada uno como su propia zona seleccionable. Descargar «una
provincia» aquí es exactamente lo pedido: la cobertura **es** la provincia.

**E10 — tocar el mapa confirma en texto antes de aceptar.**
Dado el mapa abierto, cuando el comprador toca dentro de una zona de la
cobertura, entonces la pantalla **escribe el nombre del municipio** y pide
confirmación explícita; hasta que confirma, la zona elegida del pedido no
cambia y el total no se mueve.

**E11 — tocar fuera de la cobertura no elige nada y lo dice.**
Dado el mapa abierto, cuando el comprador toca un punto que no cae en ninguna
zona servida, entonces **no se selecciona nada**, la pantalla dice que esta
tienda no llega ahí, y no se ofrece ningún camino para pedir a esa zona.

**E12 — la atribución de OpenStreetMap está siempre visible.**
Dado el mapa abierto con las teselas por defecto, entonces el crédito de
OpenStreetMap se ve sobre el mapa **sin desplegar nada**, y no hay ningún
control que lo oculte. Con el par de variables de entorno del proveedor
alternativo puestas, el crédito visible es el de esa variable; con **una sola**
de las dos puesta, se sirven las teselas de OSM con el crédito de OSM.

### El pedido

**E13 — el pedido guarda el código y el nombre, y el nombre es una
instantánea.**
Dado un pedido a domicilio confirmado con la zona `23.01` («Playa»), cuando se
lee la fila del pedido, entonces guarda `23.01` **y** «Playa»; y cuando el
nombre de `23.01` cambia en una versión posterior del catálogo, el pedido
**sigue diciendo «Playa»**. Precedente literal: `rateSnapshot`
(`src/features/orders/server/createOrder.ts`), que congela las tasas por la
misma razón.

**E14 — el importe que se cobra lo decide el servidor.**
Dado un pedido a domicilio en una tienda `ZONE_BASED`, cuando se crea, entonces
`Order.deliveryFee` es el importe que `resolveZoneTariff` devuelve para esa zona
leyendo las filas de la base **en ese instante**, nunca el que mandó el cliente
y nunca el `Store.deliveryFee` residual de la columna (R11 de F-041).

**E15 — el tarifario cambia entre cargar el checkout y confirmar.**
Dado un comprador con «Playa 300» en pantalla, cuando la tienda sube esa tarifa
a `350` y el comprador confirma, entonces el pedido **no** se crea con `300`: la
respuesta es `409` con el total nuevo y con el importe de envío nuevo nombrado,
y confirmar otra vez crea el pedido con `350.00`. El comprador nunca paga un
importe que la tienda ya no cobra, y la tienda nunca recibe un pedido con un
envío que no fijó.

**E16 — la zona deja de servirse entre cargar el checkout y confirmar.**
Dado un comprador que eligió «Playa» y una tienda que pasa esa fila a
`NOT_SERVED` antes de que confirme, cuando confirma, entonces la respuesta es un
error **propio y distinguible** («esta tienda dejó de llegar a esa zona»), el
pedido **no** se crea, y **nunca** se degrada a recogida en silencio: degradar
convertiría un pedido a domicilio en uno de mostrador sin decírselo a nadie.

**E17 — domicilio sin zona en una tienda `ZONE_BASED`.**
Dado un `POST /api/orders` con `fulfillment: "DELIVERY"` y sin zona sobre una
tienda `ZONE_BASED`, cuando se procesa, entonces responde un error propio, no
crea el pedido, y **no** cobra `0.00` de envío. La pantalla no puede llegar ahí
—su propia validación lo impide—, pero la ruta es pública (ADR 0016) y contesta
la verdad.

**E18 — una zona que la tienda no ofrece, mandada a mano.**
Dado un `POST /api/orders` con un código que **existe en el catálogo** pero no
es ofrecible por esta tienda —no servido, retirado, o de primer nivel—, entonces
la respuesta es el mismo error propio de E16 y no se crea nada. Un código que no
existe en el catálogo se rechaza igual, sin distinguirlo: para el comprador son
el mismo hecho.

**E19 — la zona se ignora donde no significa nada.**
Dado un pedido de recogida, o un pedido a domicilio de una tienda `FLAT_RATE` o
`QUOTED_PER_ORDER`, que trae zona en el cuerpo, entonces el pedido se crea
normal y **no** guarda ninguna zona — el mismo trato que ya recibe
`deliveryAddress` cuando el pedido no es a domicilio
(`src/features/orders/server/createOrder.ts`).

**E20 — una tienda `ZONE_BASED` sin ninguna zona resoluble no ofrece
domicilio.**
Dado una sucursal con `deliveryEnabled: true`, `deliveryFeeMode: "ZONE_BASED"` y
un tarifario vacío —o con filas que no hacen resoluble ningún municipio: solo
`INHERIT`, solo `NOT_SERVED`, solo zonas retiradas—, cuando el comprador abre el
checkout, entonces **no ve la opción de domicilio en absoluto** ni el selector,
igual que hoy en una tienda que no ofrece domicilio; y un `POST /api/orders` con
`fulfillment: "DELIVERY"` responde el error de E17 en vez de crear un pedido de
recogida en silencio.

### El pull

**E21 — el pull entrega la zona y el envío ya resuelto.**
Dado el pedido de E13 en estado `PENDING`, cuando el POS hace
`GET /api/internal/orders?since=…`, entonces ese pedido trae
`contact.zoneCode: "23.01"`, `contact.zoneName: "Playa"`,
`deliveryFee: "300.00"` y `deliveryFeePending: false`.

**E22 — un pedido sin zona sigue teniendo las dos claves.**
Dado un pedido de recogida, o uno anterior a este feature, cuando el POS lo
pullea, entonces `contact.zoneCode` y `contact.zoneName` están **presentes** y
valen `null`, igual que `email` y `address` cuando no hay (R22).

**E23 — un pedido viejo de una zona retirada se sigue leyendo.**
Dado un pedido creado con `23.05` y un catálogo posterior que marca `23.05` como
retirada, cuando el POS lo pullea, entonces recibe `23.05` y el nombre que se
guardó: el pedido **no** consulta el catálogo para responder, y una zona
retirada que ya no se ofrece sigue explicando un pedido existente (R4 de F-041,
ADR 0032 (d)).

### El peso y la ausencia de JavaScript

**E24 — sin JavaScript, la página lo dice y no ofrece un camino que falle al
final.**
Dado el checkout cargado con el JavaScript deshabilitado, entonces se ve el
`<noscript>` que dice que hace falta activarlo, y **no** hay un formulario de
zona que parezca funcionar y muera al confirmar. Es el criterio 8 tal como el
humano lo reescribió (D1).

**E25 — ningún nombre del catálogo entra en el bundle de cliente.**
Dado el árbol de `src/` después de este feature, cuando corre
`src/features/zones/boundaries.test.ts`, entonces la lista de importadores de
`src/features/zones/catalog.ts` y de `src/features/zones/zone-index.json` sigue
siendo la lista blanca —crecida solo con ficheros de servidor— y **ninguno** de
ellos vive en `src/components/`, en un `.tsx` de `src/app/` ni en un directorio
`components` anidado.

**E26 — el peso está medido.**
Dado el feature terminado, entonces `.agent/progress/F-042.md` anota, con la
cifra y el comando que la produjo: el JavaScript de primera carga del checkout
antes y después, y el peso del trozo del mapa que solo se descarga al abrirlo.

## Reglas de negocio

### Qué zona se puede elegir

**R1 — «zona con tarifa resoluble» tiene una definición ejecutable, y es la
única.** Una zona `z` es **ofrecible** por una sucursal `s` cuando se cumplen
las tres:

1. `z.level === "MUNICIPALITY"` en `src/features/zones/zone-index.json` — nunca
   una zona de primer nivel (D3, R3);
2. `z.retiredAt === null` — una zona retirada se lee, no se ofrece (R4 de F-041,
   ADR 0032 (d));
3. `resolveZoneTariff(z, filas de s)` devuelve `served: true`.

Nada más entra en la definición, y `served: true` implica siempre un
`deliveryFee` que no es `null` (`src/features/zones/precedence.ts`: solo una
fila `FEE` con importe decide a favor). **La lista ofrecible de la tienda es
exactamente el conjunto de las 168 zonas de municipio que cumplen las tres.**

**R2 — la lista se calcula del tarifario, no zona a zona contra la base.** Las
filas del tarifario de la sucursal se leen **una vez** y la resolución se aplica
sobre ellas con la función pura; ninguna implementación puede hacer una consulta
por municipio. Un tarifario tiene como mucho 184 filas y el índice está en
memoria, así que el conjunto ofrecible se calcula sin tocar la base más de una
vez por render.

**R3 — el comprador nunca elige una provincia.** `contact.zoneCode` es siempre
un municipio (D3). El paso de provincia del selector, cuando existe (R5), es un
**filtro** de la lista de municipios: no es una zona que se pueda enviar, y
elegir provincia sin municipio no es una zona elegida.

**R4 — nada de lo que el comprador ve resuelve por nombre.** El valor que sale
del selector, del mapa y del formulario es el **`code`**. El nombre es para las
personas: no se compara, no se parsea, no se normaliza para buscar una zona y no
viaja como identidad (R10 de la propuesta). Un nombre tecleado que no case
exactamente con una zona ofrecible **no** elige nada.

**R5 — el paso de provincia existe si y solo si la cobertura cruza más de una.**
Se decide contando los `provinceCode` **distintos** del conjunto ofrecible: uno,
no hay paso; dos o más, lo hay. La Isla de la Juventud cuenta como su propia
provincia (`40.01` declara `provinceCode: "40"`), que es justo el caso que hace
que el nivel y el padre sean campos declarados y no deducciones (ADR 0032 (c)).

**R6 — buscar ignora tildes y mayúsculas.** «holguin» encuentra «Holguín» y
«CIENFUEGOS» encuentra «Cienfuegos». No es un adorno: en Cuba se teclea sin
tildes, y el catálogo público de este mismo repositorio ya es insensible a
tildes por decisión de producto (`unaccent`, F-025/F-026). Un filtro nativo de
navegador sobre una lista de opciones **no** cumple esto por sí solo; cumplirlo
es requisito, cómo se cumple es de arquitectura.

**R7 — dos zonas ofrecibles pueden llamarse igual, y la pantalla tiene que
distinguirlas.** En el índice hay **13** casos posibles: «San Luis» es `21.09`
(Pinar del Río) y `34.03` (Santiago de Cuba), y hay **12** municipios cabecera
homónimos de su provincia (`21.08` Pinar del Río, `25.01` Matanzas, `34.06`
Santiago de Cuba, `40.01` Isla de la Juventud…). Cuando dos zonas **ofrecibles
por la misma tienda** comparten nombre, la lista tiene que desambiguar; el
`code` sigue siendo lo que se envía.

### El importe

**R8 — el importe que se muestra y el que se cobra salen de la misma
resolución.** La pantalla no calcula tarifas: muestra el importe que el servidor
resolvió para esa zona. Escribir la precedencia una segunda vez en el cliente es
exactamente el error que `src/features/orders/deliveryOffer.ts` documenta en su
cabecera (I3/I4 de F-031: dos copias que se separan).

**R9 — en `ZONE_BASED` el `deliveryFee` de la fila `Store` no se cobra jamás.**
Es residuo inerte (R11 de F-041, ADR 0033). Hoy
`src/features/cart/components/CheckoutForm.tsx` lo lee en dos sitios —el importe
que pinta y el `expectedTotal` que envía—; los dos tienen que dejar de mirarlo
cuando el modo es `ZONE_BASED`. **Sería el fallo silencioso más caro que este
feature puede introducir**: cobrarle a todo el mundo un importe que nadie fijó
para su zona.

**R10 — `0.00` es envío gratis y se comprueba contra `null`.** Ni la pantalla ni
el servidor pueden escribir `if (!fee)`: un envío gratis se convertiría en «no
hay importe» y de ahí en el importe de la provincia o en un total sin envío. La
forma correcta ya está escrita dos veces en el repositorio
(`src/features/orders/deliveryOffer.ts`, `src/features/zones/precedence.ts`).

**R11 — un pedido a domicilio de una tienda `ZONE_BASED` nunca queda con el
envío sin cotizar.** `Order.deliveryFee` es `NOT NULL` en ese camino, y por
tanto `deliveryFeePending` es `false` en el pull
(`src/features/orders/server/pulledOrder.ts`). `ZONE_BASED` y
`QUOTED_PER_ORDER` son valores **excluyentes** del mismo enum: no hay
configuración que active los dos, y la rama `QUOTED_PER_ORDER` de
`deliveryFeeForNewOrder` —la única que devuelve `null`— no es alcanzable desde
una tienda `ZONE_BASED` (criterio 10).

**R12 — la moneda es la base del negocio, y no hay campo de moneda.** El importe
de la zona se compone con el resto del pedido en `store.currencyCode`, como el
`deliveryFee` de `FLAT_RATE` (R16 de F-041).

### El mapa y la geometría

**R13 — la cobertura declarada, para la geometría, es el conjunto ofrecible de
R1.** Ni más ni menos: se sirven los polígonos de esas zonas, una zona un
polígono lógico. Con cuatro municipios son cuatro; con una fila de provincia con
`FEE` son todos los municipios de esa provincia menos los que una fila de
municipio deje fuera, y eso **es** la cobertura, no una regresión (E9). La
geometría es **siempre de grano municipio**, aunque la fila que decide sea de
provincia, porque lo que se elige es un municipio (R3).

**R14 — el mapa se carga solo al pedirlo, y eso incluye su JavaScript.** Ni la
geometría, ni las teselas, ni el código de Leaflet se descargan en la carga
inicial del checkout. Es lo que hace que el criterio 5 —«sin descargar ninguna
geometría»— se pueda comprobar mirando las peticiones de la página.

**R15 — la simplificación es topológica y en una sola operación sobre todo el
conjunto.** Si cada polígono se simplifica por separado, la frontera entre dos
municipios se simplifica de dos maneras y quedan **huecos y solapes** justo
donde el comprador toca: el punto no cae en ninguna zona, o cae en dos. Se
comprueba al generar, con **dos** comprobaciones y no una: que la unión de los
municipios de una provincia reconstruya la provincia sin huecos ni solapes, y
que cualquier punto de una provincia caiga en **exactamente una** de sus zonas.
La primera puede pasar por poco; la segunda no.

**R16 — la geometría es un artefacto con su propia versión y su propia
procedencia.** Es el segundo artefacto de la ADR 0032 (e), y su versión se mueve
**por separado** de la del índice: un polígono y un nombre no cambian por lo
mismo ni con la misma frecuencia. La procedencia lleva, como mínimo, lo que
R5 de F-041 exige y lo que el índice **no** pudo escribir: proyección
(WGS84/EPSG:4326), tolerancia, **que la simplificación fue topológica**, la
herramienta que la aplicó y su versión, la precisión decimal a la que se
redondean las coordenadas —que es una **segunda** pérdida y suele olvidarse—, el
volcado de OSM con su fecha, y el hash del artefacto.

**R17 — la unión con el índice se hace por id de relación de OSM, y la Isla de
la Juventud sale una sola vez.** `40` y `40.01` comparten el
`osmRelationId 1854614`: son 184 filas y **183** relaciones. Un bucle ingenuo la
duplicaría (I9 de F-041). Para la geometría, la que existe es `40.01`, que es la
única de las dos que se puede elegir (R3).

**R18 — el crédito del proveedor de teselas es obligatorio y no se esconde.**
La atribución de OpenStreetMap se ve siempre que el mapa esté abierto, nunca
detrás de un toggle (D2). El proveedor alternativo entra por un **par** de
variables de entorno —plantilla de URL **y** atribución— y si falta cualquiera
de las dos se cae a OSM con la atribución de OSM: nunca se sirven teselas de un
tercero bajo el crédito de otro.

### El pedido y el contrato

**R19 — el nombre de la zona en el pedido es una instantánea, no una lectura.**
Se copia del índice en el momento de crear el pedido y **nunca** se vuelve a
derivar del `code`. El precedente es `rateSnapshot`, y la razón es la misma que
lo justificó: los dos catálogos pueden desincronizarse una versión, y el
encargado y el mensajero tienen que leer lo que el comprador vio.

**R20 — el nombre guardado es el nombre del índice, verbatim.** Si la pantalla
añade la provincia para desambiguar (R7), esa desambiguación es presentación y
no entra en la instantánea: lo que desambigua al POS es el `code`, que viaja al
lado. Guardar un nombre compuesto haría que dos pedidos de la misma zona
tuvieran nombres distintos según lo que la pantalla decidiera ese día.

**R21 — la zona solo se guarda cuando significa algo.** Se persiste si y solo si
el pedido se cierra como `DELIVERY` **y** la tienda es `ZONE_BASED`. En
cualquier otro caso las dos columnas quedan en `null`, igual que
`deliveryAddress` (`src/features/orders/server/createOrder.ts`).

**R22 — en el pull, las dos claves están SIEMPRE presentes y valen `null` cuando
no hay zona.** Es la forma que ya tienen `email` y `address` dentro de
`contact`, y es lo que hace que «opcional» (D3) no se lea nunca como «la clave
desaparece»: un lector que espere la clave no se rompe con un pedido de
recogida. El contrato lo tiene que decir con esas palabras.

**R23 — `contact.zoneName` no resuelve nada, en ningún lado.** No se compara, no
se parsea y no empareja: el precio, la cobertura y el emparejamiento salen
siempre del `zoneCode` (R10 de la propuesta). Es el mismo aviso que el contrato
ya le da al POS sobre `deliveryFeePending`: el atajo que funciona hoy es el que
falla con el primer caso raro.

**R24 — toda edición de `docs/sync-contract.md` mueve la versión de su primera
línea**, aunque el documento esté en borrador y aunque este feature no lo
publique (D4, AGENTS.md § Documentación, § «Versionado de este documento» del
propio contrato). Qué dígito se mueve es SP1.

### El peso

**R25 — los nombres del catálogo no entran en el bundle de cliente, y lo que
llega al navegador es la cobertura de esa tienda, no el país.** Las 184 filas
del índice son ~7 KB gzip que la etapa `bundle` no cazaría (nota 6 de
`.agent/specs/F-041/architecture.md`). Lo que el navegador recibe son las zonas
**ofrecibles de esa sucursal** —código, nombre y su importe—, que en el caso
cubano común son unas pocas. La lista blanca de
`src/features/zones/boundaries.test.ts` no se relaja para hacer sitio a un
importador de cliente.

**R26 — el presupuesto de JavaScript no es un muro, y subirlo no es
silencioso.** El mapa lleva JavaScript y eso está aceptado (D2). Si el número
tiene que subir, se cambia `BUDGET_KB` en `scripts/check-bundle-budget.mjs`
dejando quién, por qué y **la medición** (AGENTS.md § «El presupuesto de
JavaScript no es un muro»). Lo que **no** se hace es recortar el mapa o el
selector para salvar kilobytes.

**R27 — el objetivo de peso del mapa es sobre lo que descarga UN comprador.**
Menos de 1 MB para la cobertura de una tienda, y si hace falta más, se ocupa
—decisión del humano del 2026-09-06—. Es un objetivo holgado para el caso común,
no un techo que rechace nada.

## Casos límite y errores

1. **Tienda `ZONE_BASED` con tarifario vacío.** Es una configuración **legal**
   (R12 de F-041, y el contrato se lo prometió a cuadrecaja por escrito, § «P7 de
   S-007»). No ofrece domicilio (E20). No es un error, no se registra como fallo
   y no rechaza ningún evento del sync.
2. **Tarifario con filas pero sin ninguna zona resoluble** —solo `INHERIT`, solo
   `NOT_SERVED`, o `FEE` sin importe—. Idéntico al caso 1: la definición de R1 no
   distingue «no hay filas» de «ninguna decide».
3. **Zona retirada con fila de tarifario.** No se ofrece (R1), su polígono no se
   sirve, y **sigue resolviendo** para explicar un pedido viejo (E23). Retirarla
   no rompe ningún pedido existente porque el nombre está congelado en la fila
   del pedido (R19).
4. **El tarifario cambia entre que el comprador carga el checkout y confirma.**
   Tres desenlaces y ninguno silencioso: el importe **subió o bajó** → `409` con
   el total nuevo y el envío nombrado, y re-confirmar crea el pedido con el
   importe nuevo (E15); la zona **dejó de servirse** → error propio, sin pedido
   (E16); la tienda **se quedó sin ninguna zona resoluble** → el mismo error
   propio, y una recarga ya no ofrece domicilio.
5. **El catálogo cambia de versión entre el pedido y el pull.** El pull no
   consulta el catálogo: devuelve las dos columnas de la fila del pedido. Un
   renombrado posterior no toca ningún pedido (E13, criterio 3).
6. **El importe `0` en todas sus formas.** Fila `FEE 0` → envío gratis, total sin
   cambio, `deliveryFeePending: false`. Es indistinguible en el cable del `0.00`
   de relleno de un pedido sin cotizar salvo por esa bandera, que es la trampa
   central de la v6 y que aquí **siempre** vale `false`.
7. **Dos zonas ofrecibles con el mismo nombre** (R7). Ocurre con «San Luis» y con
   los 12 municipios cabecera homónimos de su provincia. La pantalla desambigua;
   el código no cambia.
8. **Cobertura de una sola zona.** No hay paso de provincia (R5) y la lista tiene
   un elemento. El mapa sigue teniendo sentido —enseña dónde está esa zona— pero
   nada obliga a abrirlo.
9. **Cobertura muy grande** (varias provincias enteras). La lista puede pasar de
   cien municipios y la geometría pesa lo que pese (R27). No se recorta la
   cobertura para ahorrar bytes: se sirve lo que la tienda declaró.
10. **El comprador cambia de zona después de haber elegido.** El importe y el
    total se recalculan con la zona nueva antes de confirmar; el `expectedTotal`
    que se envía es el de la última zona elegida.
11. **El comprador cambia de recogida a domicilio y vuelve.** La zona elegida
    puede conservarse en la pantalla, pero un pedido que se cierra como
    `PICKUP` **no** guarda zona (R21).
12. **La dirección de texto libre sigue siendo obligatoria en un pedido a
    domicilio.** La zona no la sustituye: el mensajero necesita calle y número, y
    `deliveryAddress` conserva su mínimo de longitud
    (`src/features/orders/schemas.ts`).
13. **Reintento con la misma `idempotencyKey`.** Devuelve el pedido ya creado sin
    volver a resolver la zona ni recalcular el envío
    (`src/features/orders/server/createOrder.ts`): la zona del pedido es la del
    primer intento, que es la correcta.
14. **`POST /api/orders` con una zona inventada, de primer nivel, retirada o de
    otra tienda.** Todos el mismo error de E18. La ruta es pública (ADR 0016) y
    no se puede confiar en la pantalla.
15. **El mapa abierto en un navegador sin conexión a las teselas** (el proveedor
    caído o bloqueado). Los polígonos son nuestros y se siguen pudiendo tocar; el
    fondo se queda vacío. Elegir zona **no** depende de que las teselas carguen.
16. **La geometría y el índice desalineados** —un artefacto regenerado sin el
    otro—. Una zona ofrecible sin polígono no se puede tocar en el mapa, y un
    polígono sin zona ofrecible no debería llegar al navegador. La generación
    tiene que fallar a la vista en los dos casos, nunca descartar en silencio: es
    la misma regla que la unión DPA ⋈ OSM del índice (R8 de F-041).
17. **Sin JavaScript.** El `<noscript>` que ya existe en
    `src/features/cart/components/CheckoutForm.tsx` (D1, E24). No se añade un
    formulario de zona que parezca funcionar.
18. **Un pedido creado antes de este feature.** Sus dos columnas son `null` y el
    pull las devuelve como `null` (E22). No hay backfill: no hay nada con qué
    rellenarlas.

## Datos y contrato

### `Order`, dos columnas nuevas

| Columna              | Tipo  | Nulo | Qué es                                                                  |
| -------------------- | ----- | ---- | ----------------------------------------------------------------------- |
| el código de la zona | texto | sí   | El `code` DPA del **municipio** elegido. `null` salvo en el caso de R21 |
| el nombre de la zona | texto | sí   | **Instantánea** del nombre del índice al crear el pedido (R19, R20)     |

Nombres exactos, y si el código lleva clave ajena a `Zone`, los decide el
arquitecto. Lo que esta spec fija: las dos son **anulables** —un pedido de
recogida no lleva zona—, el nombre **no** es derivado ni se recalcula, y leer un
pedido viejo no puede depender de que el catálogo siga teniendo esa fila.

### El cuerpo de `POST /api/orders`

- Una clave nueva para el **código de zona**, opcional en el schema
  (`src/features/orders/schemas.ts`), porque la mayoría de los pedidos no la
  llevan; obligatoria **de hecho** cuando el pedido se cierra como `DELIVERY` en
  una tienda `ZONE_BASED`, y esa comprobación es de servidor porque el schema no
  puede saber el modo de la tienda sin consultarla.
- Una clave nueva opcional para el **importe de envío que el cliente está
  mostrando**, comparada **solo** para afinar el mensaje del `409` y **nunca**
  persistida. Es el precedente literal de `expectedUnitPrice`
  (`src/features/orders/types.ts`), y es lo que permite decir «el envío pasó de
  300 a 350» en vez de «los precios cambiaron».
- **Errores nuevos de esta ruta pública**, en la unión de
  `src/features/orders/types.ts` y en el `switch` de
  `src/app/api/orders/route.ts`: uno para «falta la zona» y otro para «esa zona
  no está servida por esta tienda». Los códigos concretos y su HTTP los fija el
  arquitecto; lo que esta spec exige es que sean **distinguibles entre sí y de
  `PRICE_CHANGED`**, para que la pantalla pueda decir la verdad en vez de
  «revisa los datos».

### La cotización

`QuoteStore` (`src/features/orders/types.ts`) ya viaja con `deliveryFeeMode`, y
`isDeliveryOffered` deja de poder contestar sola para `ZONE_BASED`: la respuesta
depende del tarifario, que está en la base. Quien haga la pregunta tiene que
aportar ese hecho —resuelto en servidor—, y la regla sigue viviendo en **una
sola** función que la pantalla y `createOrder` comparten. Escribirla dos veces
es el error que `src/features/orders/deliveryOffer.ts` documenta en su cabecera.
La forma exacta (un campo más en `DeliveryConfig`, un parámetro, otra función)
es de arquitectura.

### La edición de `docs/sync-contract.md`

La v13 está **en borrador y sin publicar**, y su § «Lo que la v13 reserva para
F-042» dice, literalmente, que las dos preguntas sobre `contact` **no** están
contestadas por esa versión. Este feature las contesta, así que esa sección se
reescribe y el documento gana:

1. Las **dos claves nuevas de `contact`** en § ③④ Pedidos, con su forma: siempre
   presentes, `string | null`, `zoneCode` siempre de municipio, `zoneName` de
   lectura humana que **no resuelve nada** (R22, R23).
2. La frase que cierra la trampa: en un pedido a domicilio de una tienda
   `ZONE_BASED`, `deliveryFeePending` es **siempre** `false` y el importe está
   resuelto — `ZONE_BASED` y `QUOTED_PER_ORDER` son excluyentes.
3. La **retirada de la advertencia** de § «Cambios respecto a la v12.2» que dice
   que «entre la v13 y F-042 una tienda `ZONE_BASED` no ofrece domicilio»: deja
   de ser cierta el día que esto se despliegue, y dejarla puesta haría que el
   primer negocio que la lea crea que sigue apagado.
4. **La versión de la primera línea, movida** (R24, SP1), con su entrada en la
   sección de cambios.

Lo que **no** cambia: el vector de precedencia, la entidad `ZONE_TARIFF`,
`STORE.zoneCode` y los tres códigos de error de la v13. Y la publicación sigue
esperando a F-043 y al visto bueno de cuadrecaja (D4).

### Los pasos operativos

`docs/despliegue.md` gana, en el mismo ciclo (AGENTS.md § Documentación):

- El **par de variables de entorno** del proveedor de teselas, con la regla de
  que las dos van juntas o no va ninguna (R18).
- Cómo llega la **geometría** a un entorno nuevo, si resulta no ser un activo
  estático servido con el propio despliegue.
- La **herramienta de simplificación** que haya que instalar para regenerar el
  artefacto, con su versión, porque hoy no hay ninguna en la máquina y sin ella
  la regeneración no es reproducible (R16).

## Criterios de aceptación propuestos

Los doce `[ya]` son los de `.agent/features.json`, en su orden y con su letra
literal; ninguno se toca (regla 3). Cada uno con **lo que hay que ejecutar**.
Las etapas `smoke` y `visual` son las de `.agent/verify.sh`, que corren
respectivamente .agent/specs/F-042/smoke.sh (por crear) y
.agent/specs/F-042/visual.mjs (por crear) contra la app levantada; Playwright ya
es dependencia de desarrollo, así que las peticiones de una página y un contexto
**sin JavaScript** son observables desde ahí.

**C1 `[ya]`** — «En una tienda ZONE_BASED con domicilio, el checkout ofrece SOLO
las zonas con tarifa resoluble, verificado con una zona NOT_SERVED bajo una
provincia con FEE: esa zona no aparece.»
E2, R1. Fixture: sucursal `ZONE_BASED` con `23` `FEE 300` y `23.05`
`NOT_SERVED`. `curl` al checkout y contar en el HTML: aparecen los demás
municipios de `23`, el código `23.05` **no** aparece en ninguna forma (ni como
valor, ni como nombre «Regla»). Y en la etapa `visual`, escribir «Regla» en el
selector no ofrece nada.

**C2 `[ya]`** — «Elegir la zona muestra el importe del envio ANTES de confirmar,
y el total del pedido lo incluye.»
E4, E5. Etapa `visual`: elegir «Playa» y afirmar que el importe `300.00` está en
pantalla y que el total mostrado es `subtotal − descuento + 300.00`, **sin haber
enviado nada**. Y un caso con `FEE 0`: la pantalla dice gratis y el total no
cambia.

**C3 `[ya]`** — «El pedido guarda zoneCode y zoneName, y el zoneName es el que
vio el comprador: cambiar el nombre en el catalogo despues del pedido no cambia
el del pedido.»
E13, R19. Test contra Postgres real: crear el pedido con `23.01`, leer la fila
—`23.01` y «Playa»—, cambiar el nombre de `23.01` en la tabla `Zone` (que es el
espejo, ADR 0032 (a)) y volver a leer la fila del pedido y su pull: sigue
diciendo «Playa».

**C4 `[ya]`** — «El pull entrega contact.zoneCode y contact.zoneName y el
deliveryFee ya resuelto, con deliveryFeePending en false.»
E21, E22. `GET /api/internal/orders?since=0` con el token del negocio: el JSON
del pedido trae las dos claves con sus valores, `deliveryFee: "300.00"` y
`deliveryFeePending: false`. Y un pedido de recogida en la misma respuesta trae
las dos claves en `null`.

**C5 `[ya]`** — «La zona se puede elegir de una lista con escritura predictiva
SIN descargar ninguna geometria, comprobado en las peticiones que hace la
pagina.»
E3, E7. Etapa `visual` con `page.on("request")`: cargar el checkout, teclear
tres letras, elegir una zona y confirmar que **ninguna** petición de la sesión
es de geometría, de teselas ni del trozo del mapa — y que teclear no produjo
ninguna petición.

**C6 `[ya]`** — «El mapa se carga solo al pedirlo y sirve unicamente los
poligonos de la cobertura declarada de esa tienda, medido en bytes y en numero
de poligonos: una tienda con cuatro zonas no descarga una provincia.»
E8, E9, R13. Un guion de medición invocado desde smoke —precedente literal:
`scripts/check-image-budget.mjs`, que mide bytes contra un servidor levantado y
se llama desde la etapa `smoke` de su feature— que para una tienda con cuatro
municipios afirme **cuatro** zonas en la respuesta y su tamaño en bytes, y que
para una tienda con la provincia entera afirme el número de municipios de esa
provincia. Las dos cifras se anotan.

**C7 `[ya]`** — «Con la cobertura en una sola provincia no aparece el paso de
provincia; con cobertura en dos provincias, si aparece.»
E6, R5. Dos fixtures y dos afirmaciones sobre el HTML del checkout: con
cobertura en `23`, el paso de provincia no está en el DOM; con cobertura en `23`
y `22`, está, y elegir `22` deja solo municipios de `22`.

**C8 `[ya]`** — «El checkout de una tienda ZONE_BASED requiere JavaScript —el
selector de zona y el mapa son de cliente— y la pagina lo declara con su
<noscript> en vez de ofrecer un camino que falle al final, verificado cargando
el checkout con el JavaScript deshabilitado.»
E24, D1. Etapa `visual` con un contexto `javaScriptEnabled: false`: el texto del
`<noscript>` es visible, y no hay ningún control de envío del pedido operable.
Ver I2 sobre la tensión entre la letra de este criterio y D5.

**C9 `[ya]`** — «Una tienda ZONE_BASED que no tiene ninguna zona con tarifa no
ofrece domicilio en absoluto, en vez de ofrecerlo y fallar al final.»
E20, casos límite 1 y 2. Tres fixtures —tarifario vacío, solo `INHERIT`, solo
`NOT_SERVED`—: en los tres, el HTML del checkout no trae la opción de domicilio,
y `POST /api/orders` con `fulfillment: "DELIVERY"` responde el error propio y
deja cero pedidos nuevos en la tabla.

**C10 `[ya]`** — «Un pedido a domicilio en una tienda ZONE_BASED nunca queda con
el envio sin cotizar: ZONE_BASED y QUOTED_PER_ORDER son excluyentes.»
E14, R11. Test contra Postgres real: crear el pedido a domicilio y afirmar
`Order.deliveryFee IS NOT NULL` con el importe resuelto, y en el pull
`deliveryFeePending: false`. Más un test unitario de que la función que decide
el importe de un pedido nuevo **no puede** devolver `null` para `ZONE_BASED`.

**C11 `[ya]`** — «El peso del JavaScript que este feature anade a la pagina de
checkout esta medido y anotado en el progress.»
E26. `npm run build` y la tabla de rutas que imprime, para
`/[slug]/checkout`, antes y después; más el tamaño gzip del trozo que solo se
descarga al abrir el mapa. Las tres cifras y los comandos, en
`.agent/progress/F-042.md`. **Ojo: `npm run check:bundle` no mide esta página**
— ver I1.

**C12 `[ya]`** — «bash .agent/verify.sh F-042 --full termina con codigo 0.»
`bash .agent/verify.sh F-042 --full` → `echo $?` es `0`. Incluye `harness`,
`typecheck`, `lint`, `format`, `test`, `prisma`, `build`, `theme` y `bundle`.

Y tres que esta spec propone **al humano**, porque cubren agujeros que ningún
criterio de arriba toca:

**C13 `[nuevo]`** — el tarifario cambia entre cargar el checkout y confirmar y
**nadie paga de menos ni de más**: subiendo la tarifa entre el `GET` y el
`POST`, la respuesta es `409` con el total nuevo, no se crea pedido, y
re-confirmar lo crea con el importe nuevo (E15). Bajándola, lo mismo.

**C14 `[nuevo]`** — la zona deja de servirse entre cargar y confirmar: el pedido
**no** se crea, la respuesta es un error distinguible, y en la tabla no queda
ningún pedido de recogida creado en silencio (E16).

**C15 `[nuevo]`** — el catálogo no llega al navegador: `npm test` mantiene verde
`src/features/zones/boundaries.test.ts` con su lista blanca, y ningún importador
nuevo vive en un árbol de cliente (E25).

## Incongruencias detectadas

**I1 — el criterio 11 pide medir el JavaScript del checkout, y
`npm run check:bundle` no puede medirlo.** `scripts/check-bundle-budget.mjs`
recorre **solo el HTML prerenderizado** de `.next/server/app` y suma los
`<script src>` que esas páginas referencian; `src/app/[slug]/checkout/page.tsx`
es `force-dynamic` con `revalidate = 0`, así que **no prerenderiza nada** y su
JavaScript no entra en la medición. Dos consecuencias, y las dos importan: la
cifra del criterio 11 hay que sacarla de otro sitio (la tabla de rutas de
`npm run build`), y **el presupuesto de 193 KB no es el guardián de este
feature** — Leaflet podría entrar entero en el checkout con la etapa `bundle` en
verde. Lo que esa etapa sí protege es que el trozo del mapa **no** acabe
referenciado por las páginas de catálogo, que son las que sí se miden. No se
toca el criterio (regla 3): se cumple midiendo y anotando, que es lo que pide.

**I2 — el criterio 8 dice «el selector de zona y el mapa son de cliente» y D5
dice que la lista se renderiza en servidor.** Las dos cosas son ciertas y no se
contradicen, pero la frase invita a leerlas como que la lista tiene que ser una
isla de cliente: **no lo es**. Las opciones se pintan en el HTML que manda el
servidor (D5, y la lista blanca de `src/features/zones/boundaries.test.ts` está
puesta para que esa decisión se tome mirándola); lo que necesita JavaScript es
lo que hace el checkout **con** la zona elegida —recalcular el total y enviar el
pedido—, porque el checkout entero ya era cliente desde F-010. Lo comprobable
del criterio 8 es lo que su segunda mitad dice: cargar sin JavaScript enseña el
`<noscript>` y no ofrece un camino que falle al final.

**I3 — `deliveryFeeForNewOrder` LANZA hoy en la rama que este feature necesita.**
`src/features/orders/deliveryOffer.ts` tiene, para `ZONE_BASED` + `"DELIVERY"`,
un `throw` documentado como inalcanzable «por construcción». Este feature lo
alcanza. Sustituirlo es alcance (§ Dentro 5) y no es un descuido de F-041: es la
señal que ADR 0033 § «Reabrir cuando» dejó puesta a propósito —«F-042 exista y
`isDeliveryOffered` necesite su pregunta de verdad»—. **La ADR 0033 se reabre**,
y decidir si eso es una nota fechada o una ADR nueva es del arquitecto; lo que no
puede pasar es que se cambien las dos funciones dejando la ADR diciendo lo
contrario.

**I4 — `isDeliveryOffered` es pura y la pregunta de verdad no lo es.** La
función vive en `src/features/orders/deliveryOffer.ts` **fuera** de un `server/`
justo para que la isla de cliente pueda importarla, y su firma solo recibe la
configuración de la fila `Store`. La pregunta «¿tiene esta tienda alguna zona con
tarifa resoluble?» necesita el tarifario, que está en la base. O la función
recibe ese hecho ya resuelto, o deja de ser pura y se rompe la capa. La primera
es la única compatible con AGENTS.md § Arquitectura; queda anotada aquí porque es
la trampa donde un implementador con prisa mete Prisma en un módulo que la isla
de cliente importa.

**I5 — la propuesta y F-041 asignan a este feature unas coordenadas de contacto
que ningún criterio suyo pide y que su propio diseño excluye.**
`.agent/specs/propuestas/zonas-de-envio.md` § «Datos y contrato» dice que `Order`
gana «tres columnas nuevas anulables (`zoneCode`, `zoneName`, y el par de
coordenadas)», y § «Fuera (explícito)» de `.agent/specs/F-041/spec.md` empuja
«las coordenadas del contacto» a F-042. Pero **ninguno de los doce criterios las
nombra**, y las `notes` del propio feature dicen que no se geocodifica y que no
se confía en el GPS: no hay nada en esta pantalla que produzca una coordenada.
Una columna anulable que nadie escribe es peor que no tenerla. Se dejan **fuera**
(§ Fuera 3) y la pregunta va al humano en SP2.

**I6 — la advertencia de la v13 sobre F-042 caduca con este feature y hay que
retirarla a mano.** `docs/sync-contract.md` § «Cambios respecto a la v12.2» dice
que «entre la v13 y F-042 una tienda `ZONE_BASED` no ofrece domicilio». Es cierta
hoy y falsa el día del despliegue. Nada la caduca sola, y dejarla puesta le dice
al primer negocio que la lea que su domicilio sigue apagado. Va en la misma
edición que las dos claves de `contact` (§ Datos y contrato).

**I7 — el índice tiene 13 colisiones de nombre y ninguna pantalla del
repositorio ha tenido que resolverlas todavía.** Verificado ejecutando sobre
`src/features/zones/zone-index.json`: «San Luis» es `21.09` y `34.03`, y hay 12
municipios cabecera con el nombre exacto de su provincia. Ninguna rompe nada por
sí sola —el `code` es la identidad— pero una lista que enseñe solo nombres puede
ofrecerle al comprador dos filas idénticas. R7 lo cierra.

**I8 — el `<noscript>` de hoy habla del carrito, no de la zona, y con D1 eso
basta.** `src/features/cart/components/CheckoutForm.tsx` ya dice «Para armar un
pedido necesitas activar JavaScript». El criterio 8 pide que la página lo
declare; no pide un texto nuevo. Cambiarlo es opcional y de diseño, no de esta
spec — se anota para que nadie lo dé por trabajo pendiente.

**I9 — el objetivo de «menos de 1 MB» y el criterio 6 miden cosas distintas, y
las dos son correctas.** El humano fijó el objetivo sobre **lo que descarga un
comprador** (la cobertura de una tienda); el criterio 6 mide **bytes y número de
polígonos** de la respuesta de geometría. La segunda es la comprobación
ejecutable de la primera. Queda escrito para que nadie intente convertir el
millón de bytes en una etapa que falle.

## Huecos y preguntas al humano

**Ninguna de las dos bloquea diseñar ni implementar la pantalla.** Bloquean, en
cambio, dos pasos concretos: la edición del contrato y la forma del modelo. Por
eso esta spec queda en `listo` con las dos abiertas y con la recomendación
escrita.

**SP1 — el borrador de la v13 se edita: ¿la primera línea pasa a v13.1 o a
v14?**
Qué falta: qué dígito mueve una edición de un contrato que está **en borrador y
sin publicar**. Por qué importa: AGENTS.md y el propio § «Versionado de este
documento» dicen que toda edición mueve la versión, y que **mayor** es «cambia lo
que el POS envía o recibe». Añadir dos claves a `contact` es exactamente eso…
salvo que la v13 todavía no se publicó, la reserva de esas dos preguntas está
**dentro** de la propia v13, y F-043 —que el humano puso antes de publicarla—
volverá a editarla. Opciones: **(a) v13.1**, tratando el borrador como un
documento vivo cuya mayor es la que se publicará (y F-043 lo llevaría a v13.2);
**(b) v14**, aplicando la letra de la regla, con lo que S-007 acabaría repartida
entre dos mayores que nadie implementó por separado; **(c)** mantener «13» y
anotar la fecha, que es la única que la regla prohíbe explícitamente.
**Recomendación: (a)**, porque el otro equipo usa la versión para saber si tiene
delante lo que leyó, y un `13` → `13.1` en un borrador se lo dice sin partir en
dos una negociación única.

**SP2 — `contact.lat`/`lng`: ¿entran aquí, se aparcan, o desaparecen del
plan?**
Qué falta: quién es el dueño de las coordenadas del contacto. La propuesta y
F-041 las empujaron a este feature (I5), pero ningún criterio las pide y este
diseño **no produce ninguna**: no hay pin, no hay GPS y no hay geocodificación,
por decisión escrita. Por qué importa: son una columna, una clave del contrato y
una versión más del documento. Opciones: **(a) fuera de F-042** y, si algún día
se quieren, un feature propio que diga **quién las produce** (un «marcar el punto
para el mensajero» es una pantalla, no un campo); **(b) dentro**, con las
columnas creadas y sin nadie que las escriba; **(c) dentro**, añadiendo un pin
opcional en el mapa solo para el mensajero, con el aviso de que **nunca** decide
el precio. **Recomendación: (a)** — es lo que esta spec ha escrito en § Fuera 3.
(b) deja dos columnas muertas y una clave del contrato que siempre vale `null`,
que es peor que no tenerla; (c) es un feature nuevo y el backlog es del humano
(regla 4).

## No decidido a propósito

- **Cómo se sirve la geometría** —activo estático, ruta propia, GeoJSON o
  TopoJSON, con qué se genera y con qué se simplifica topológicamente—, y **cómo
  se versiona**: es de `sdd-architect`. Lo que esta spec fija es **qué** tiene
  que llegar (R13-R17) y cómo se mide (C6).
- **La disposición de la pantalla**, los estados del selector y del mapa, los
  textos exactos y los breakpoints: es de `sdd-designer`. Esta spec fija qué
  tiene que ser posible y qué no puede pasar, no dónde va cada cosa.
- **Si la reapertura de la ADR 0033 es una nota fechada o una ADR nueva** (I3), y
  si `Order` lleva clave ajena al catálogo. Del arquitecto.
- **Si el pedido congela además la versión del catálogo** junto al nombre. El
  criterio 3 no lo pide y el nombre ya basta para leer un pedido viejo; si el
  arquitecto ve valor en poder decir «este pedido se hizo con el índice 1.0.0»,
  es una columna más y una decisión suya.
- **El nombre de las dos variables de entorno del proveedor de teselas** y el de
  las columnas nuevas. Del arquitecto.
- **Si el mapa aparece también cuando la cobertura es de una sola zona.** Del
  diseñador (caso límite 8).
