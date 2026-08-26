---
feature: F-010
agente: sdd-spec
actualizado: 2026-08-26T03:11:19Z
estado: listo
---

## Problema

Hoy `/[slug]` y `/[slug]/p/[productSlug]` muestran el catálogo y nada más: el
botón «Agregar al carrito» de `src/app/[slug]/p/[productSlug]/page.tsx:106` es
decorativo, no hay carrito, no hay forma de pedir y no existe ningún `Order` en
la base. El comprador que quiere algo tiene que salir de la web y escribir por su
cuenta. Del otro lado, F-007 (pull de pedidos desde el POS) está en
`passes: false` porque no hay pedidos que traer: sus endpoints solo se pueden
probar con filas insertadas a mano.

F-010 cierra el hueco: el comprador arma un pedido en el navegador, lo confirma
sin cuenta, y queda un `Order` en la base de la tienda que el POS recogerá en su
siguiente pull.

## Alcance

### Dentro

- Carrito de compra por tienda, persistido en `localStorage`, con alta, cambio de
  cantidad y baja de líneas.
- Rutas nuevas `/[slug]/carrito`, `/[slug]/checkout` y `/[slug]/pedido/[code]`.
  Las tres palabras ya están en `RESERVED` de `src/lib/slug.ts:12` — el nombre no
  se inventa aquí, ya estaba previsto.
- Formulario de checkout de invitado: contacto (nombre, teléfono, correo
  opcional), notas y, si la tienda lo permite, elección entre retiro y envío.
- Creación del `Order` + `OrderItem` con snapshot de contacto, de precios y de
  tasas (`rateSnapshot`), en **ambos** `checkoutMode`.
- Delivery plano: `deliveryFee` de la tienda sumado al total, `deliveryAddress`
  obligatoria cuando se elige envío.
- Pantalla de confirmación / estado del pedido, no cacheada, con enlace `wa.me`
  solo cuando `checkoutMode = WHATSAPP`.
- Revalidación del carrito contra el servidor en el momento de confirmar:
  disponibilidad, visibilidad y precio.
- **Idempotencia del envío** por `Order.idempotencyKey` (SP1 → c) y **tope de
  creación** por tienda + teléfono (SP3 → b).
- **Una migración aditiva**, que sí entra en F-010 (SP1 → c): columna
  `idempotencyKey String? @unique` en `Order` y el par
  `originalUnitPrice` / `originalCurrencyCode` en `OrderItem`. Solo añade columnas
  nullables y un índice único: no reescribe ninguna fila y no necesita
  `prisma migrate reset` ni `prisma db push`, que AGENTS.md prohíbe.
- **Ampliación estrictamente aditiva** del payload de `GET /api/internal/orders`
  con los importes en moneda original y `rateSnapshot` (SP2 → c), y la versión
  nueva de `docs/sync-contract.md` que la documenta junto con el formato de `code`.
- **Subir el presupuesto** de `scripts/check-bundle-budget.mjs` al número medido
  después del build (SP4 → c), con la bajada delegada en F-013.
- Fixture de verificación (I4): hace falta al menos una tienda publicada con
  `checkoutMode: ONSITE` y al menos una con `deliveryEnabled: true` y un
  `deliveryFee` no nulo — hoy no existe ninguna de las dos y sin ellas los
  criterios 11 y 12 no se pueden ejecutar. **Dónde vive** (ampliar `prisma/seed.ts`
  o un script de fixtures aparte) lo decide `sdd-architect`; lo que esta spec exige
  es que exista y que el seed siga siendo idempotente (criterio de F-002).

### Fuera (explícito)

- **Promociones y descuentos.** `discountTotal` se escribe `0`. Es F-011
  (decisión del humano del 2026-08-25).
- **Cuenta de cliente.** `customerId` queda `null` y no se lee ninguna cookie de
  sesión. Es F-012.
- **Pagos en línea.** El pedido es contra entrega; no hay pasarela, no hay estado
  de pago.
- **Notificaciones automáticas.** Nadie avisa a la tienda ni al comprador: el POS
  se entera por pull (ADR 0002) y el comprador manda el WhatsApp él mismo si
  quiere. El aviso automático y el timbre en tiempo real son las propuestas
  `pedido-renegociacion` y `timbre-realtime`.
- **Renegociación del pedido.** Ni modificación por la tienda, ni estados nuevos
  de `OrderStatus`, ni vencimiento. Propuesta `pedido-renegociacion`.
- **Reserva de stock.** Dos compradores pueden pedir la última unidad; lo resuelve
  la confirmación manual del encargado (ADR 0003 y ADR 0012 explican por qué no se
  escribe en el camino de venta del POS).
- **Zonas de envío, cálculo por distancia y horarios de la tienda.** El envío es
  una tarifa plana; los horarios son la propuesta `horarios-y-propiedad-de-campos`.
- **Multisucursal.** Se pide contra un `Store`. `Storefront` es ADR 0012 y su
  propuesta; aquí solo se respeta su consecuencia (ver R12 e I3).
- **Cantidades fraccionarias (venta por peso).** `OrderItem.quantity` es
  `Decimal(14,3)` y se seguirá escribiendo con enteros; nada en `StoreProduct`
  dice hoy si un producto se vende por peso.
- **Pedir sin JavaScript.** El catálogo se lee sin JS y eso no se toca, pero
  agregar al carrito y confirmar requieren JS. Un fallback con `<form>` POST puro
  se deja fuera a propósito.
- **Edición o cancelación del pedido por el comprador** una vez confirmado.

## Actores y precondiciones

**Comprador anónimo**, desde un teléfono, con conexión lenta y sin cuenta. Dispara
todo el flujo.

Precondiciones:

- `Store.status = PUBLISHED`. Cualquier otra cosa es 404, igual que hoy en
  `requireStore` (`src/features/catalog/server/queries.ts:75`).
- El producto está `visible = true`, `deletedAt = null` y su precio efectivo se
  puede expresar en la moneda del pedido (hay tasa, o ya está en esa moneda).
- El navegador permite `localStorage`. Si no, el carrito vive solo en memoria
  durante la visita (E21) y el flujo sigue funcionando.
- Para envío: `Store.deliveryEnabled = true` **y** `Store.deliveryFee` no nulo.

**El POS** es un actor secundario: no participa en la creación, pero lee el pedido
después por `GET /api/internal/orders` (F-007) y reporta estado por
`POST /api/internal/orders/status`.

## Comportamiento esperado

**Carrito**

- **E1** — Dado un producto con `availability != OUT_OF_STOCK` en
  `/tienda-demo/p/<slug>`, cuando el comprador pulsa «Agregar al carrito»,
  entonces la línea queda en el carrito con cantidad 1, el contador de la
  cabecera pasa a 1 y **no hay navegación ni recarga**.
- **E2** — Dado ese producto ya en el carrito, cuando se agrega otra vez, entonces
  hay **una** línea con cantidad 2, no dos líneas.
- **E3** — Dado un carrito con líneas, cuando se recarga la página, entonces las
  líneas siguen ahí con las mismas cantidades.
- **E4** — Dado un carrito en `tienda-demo`, cuando el comprador abre
  `tienda-dos`, entonces su carrito está vacío; y al volver a `tienda-demo` el
  primero sigue intacto.
- **E5** — Dado un producto con `availability = OUT_OF_STOCK`, entonces el botón
  de agregar llega **deshabilitado en el HTML servido** (sin esperar al JS) y, si
  se invoca la acción de agregar de todos modos, el carrito no cambia.
- **E6** — Dado `/[slug]/carrito` con líneas, entonces se muestran nombre, precio
  unitario **leído del servidor en esa petición**, cantidad, total de línea y
  subtotal, con controles para subir, bajar y quitar. Con el carrito vacío se
  muestra un mensaje y un enlace al catálogo, y no hay botón de continuar.
- **E7** — Dado `/[slug]/carrito`, cuando una línea ya no es pedible (agotada,
  oculta, borrada o sin precio resoluble), entonces esa línea se marca como no
  disponible, no cuenta para el subtotal y el botón de continuar exige quitarla.

**Checkout**

- **E8** — Dada una tienda con `deliveryEnabled = false`, entonces el checkout
  pide solo nombre, teléfono, correo opcional y notas opcionales; no hay selector
  de entrega y el pedido se guarda con `deliveryFee = 0` y
  `deliveryAddress = null`.
- **E9** — Dada una tienda con `deliveryEnabled = true` y `deliveryFee` no nulo,
  entonces aparece la elección retiro/envío; con **envío** la dirección es
  obligatoria (no se puede confirmar sin ella) y el total es
  `subtotal + deliveryFee`; con **retiro** el total es `subtotal` y
  `deliveryAddress` queda `null`.
- **E10** — Dado un formulario válido y un carrito pedible, cuando se confirma,
  entonces se crea **un** `Order` en `PENDING` con sus `OrderItem`, el carrito de
  esa tienda se vacía y el navegador termina en `/[slug]/pedido/[code]`.
- **E11** — Igual que E10 pero **sin ninguna cookie de sesión**: el resultado es el
  mismo. En ningún punto se pide iniciar sesión.
- **E12** — Dado que entre agregar y confirmar el producto pasó a
  `OUT_OF_STOCK` (o a `visible = false`, o a `deletedAt != null`), cuando se
  confirma, entonces **no se crea nada**, se responde el conflicto con la lista de
  líneas afectadas y la pantalla pide corregir el carrito.
- **E13** — Dado que entre agregar y confirmar cambió el precio efectivo (sync o
  `priceOverride`) o la tasa de cambio, cuando se confirma, entonces **no se crea
  nada**: se muestra por línea el importe anterior y el nuevo, y el total nuevo. Al
  confirmar por segunda vez —ya con el total nuevo a la vista— sí se crea el
  pedido, con los importes nuevos.
- **E14** — Dado un producto con `priceOverride`, cuando se crea el pedido,
  entonces `OrderItem.unitPrice` es el override convertido, **nunca**
  `syncedPrice` (ADR 0007).
- **E15** — Dado un producto en USD y una tienda con base CUP, cuando se crea el
  pedido, entonces `OrderItem.unitPrice` está en CUP y `rateSnapshot` contiene la
  tasa USD usada.

**Pedido**

- **E16** — Dado un pedido creado, cuando se hace
  `GET /[slug]/pedido/[code]`, entonces responde 200 con el código, el estado en
  español, el contacto, las líneas con sus importes, subtotal, envío y total.
- **E17** — Dado un `code` inexistente, o el de un pedido de **otra** tienda,
  entonces la misma ruta responde 404.
- **E18** — Dada una tienda con `checkoutMode = WHATSAPP`, entonces la página del
  pedido ofrece un enlace `wa.me` con el resumen y el código; con
  `checkoutMode = ONSITE` ese enlace **no aparece** y todo lo demás es idéntico.
- **E19** — Dado un pedido y un `POST /api/internal/orders/status` que lo pone en
  `CONFIRMED`, cuando se vuelve a pedir la página, entonces muestra «Confirmado».
  (Es la prueba de que no está cacheada.)
- **E20** — Dado un pedido creado, cuando después cambia el precio del producto y
  la tasa de cambio, entonces la página del pedido y la respuesta del pull siguen
  mostrando **exactamente** los mismos importes.

**Bordes del navegador**

- **E21** — Dado un navegador que rechaza `localStorage` (modo privado, cuota
  llena), entonces el carrito funciona en memoria durante la visita y ninguna
  página lanza error.
- **E22** — Dado un contenido corrupto o de versión desconocida en la clave del
  carrito, entonces se descarta, el carrito arranca vacío y la página no rompe.
- **E23** — Dadas dos pestañas de la misma tienda, la última escritura gana; una
  pestaña desactualizada no puede producir un total incorrecto porque el servidor
  re-precia al confirmar (R7).

**Reintentos y abuso**

- **E24** — Dado un intento de checkout con `idempotencyKey` K, cuando la
  confirmación se envía dos veces (el comprador insiste, o el navegador reintenta
  al perderse la respuesta), entonces existe **un** pedido: la primera responde 201
  y la segunda 200 con el mismo `code` y `idempotent: true`.
- **E25** — Dada una confirmación **sin** `idempotencyKey`, cuando se envía dos
  veces, entonces se crean dos pedidos y ambas responden 201. Es el
  comportamiento acordado para no romper a un cliente que no manda clave, no un
  descuido.
- **E26** — Dada una tienda con 5 pedidos `PENDING` del mismo teléfono en los
  últimos 10 minutos, cuando llega el sexto, entonces responde 429 y no se crea
  nada; con otro teléfono, o pasados los 10 minutos, o si los anteriores ya
  pasaron a `PULLED`, vuelve a responder 201.
- **E27** — Dado un consumidor del pull que solo conoce los campos de hoy, cuando
  lee un pedido creado por F-010, entonces sigue funcionando sin cambios: los
  campos viejos conservan nombre, tipo y significado, y los nuevos —importes
  originales y `rateSnapshot`— se le suman sin estorbarle.

## Reglas de negocio

**Decisiones del humano ya cerradas**

- **R1** — El `Order` se crea **siempre**, en los dos `checkoutMode`. `checkoutMode`
  solo decide si la pantalla de confirmación ofrece el enlace `wa.me`. Una sola
  ruta de código, sin ramas en la creación.
- **R2** — `discountTotal = 0` y `total = subtotal + deliveryFee`. Las promociones
  son F-011.
- **R3** — Delivery plano. Se ofrece envío **solo** si `deliveryEnabled = true` y
  `deliveryFee != null`. Con envío: `deliveryAddress` obligatoria y
  `deliveryFee = Store.deliveryFee`. Con retiro: `deliveryFee = 0`,
  `deliveryAddress = null`. Sin zonas ni distancia.

**Dinero**

- **R4** — El precio de una línea sale de `effectivePrice()` de `src/lib/pricing.ts`
  (el override gana) convertido con `convert()` de `src/lib/money.ts`. Ni el
  checkout ni la vista del carrito reimplementan la precedencia ni la conversión
  (ADR 0007).
- **R5** — `Order.currencyCode` es el `Business.baseCurrencyCode` leído al
  confirmar. `OrderItem.unitPrice`, `OrderItem.lineTotal` y `OrderItem.currencyCode`
  se guardan **en esa misma moneda**, que es lo único que hace que
  `Σ lineTotal = subtotal` se sostenga. Además, y solo como información
  (SP2 → c), cada línea guarda su importe **original** en
  `originalUnitPrice` / `originalCurrencyCode`: el precio efectivo antes de
  convertir. Cuando el producto ya está en la moneda del pedido, los dos pares
  coinciden; no se escribe `null` en ese caso.
- **R5b** — Los importes originales **no son sumables**: con líneas en monedas
  distintas su suma no significa nada. Ningún total, ni de la app ni del POS, se
  calcula con ellos. La única aritmética válida es la de los importes convertidos.
- **R6** — Todos los importes que se persisten los calcula el **servidor**, a partir
  de una lectura única y consistente de precios y tasas hecha en el momento de
  confirmar. Los importes que manda el cliente no se persisten nunca: solo se usan
  para comparar (R7).
- **R7** — Si el total que calcula el servidor difiere en un céntimo del que el
  cliente dice estar mostrando, no se crea nada y se devuelve la diferencia por
  línea. **El total no cambia jamás en silencio**, ni hacia arriba ni hacia abajo
  (ADR 0012 § Consecuencia: «resolverlo en silencio cambiaría el total sin
  avisar»). Una sola regla para las dos direcciones, para no tener dos caminos.
- **R8** — Lo que se congela al crear el pedido, y que **nada** recalcula después:
  `contactName`, `contactPhone`, `contactEmail`, `deliveryAddress`, `currencyCode`,
  `subtotal`, `discountTotal`, `deliveryFee`, `total`, `rateSnapshot`, y por línea
  `name`, `unitPrice`, `currencyCode`, `quantity`, `lineTotal`,
  `originalUnitPrice` y `originalCurrencyCode`. La página del
  pedido y `pullOrders` leen estos valores, nunca los derivan del catálogo actual.
- **R9** — `rateSnapshot` guarda las tasas **usadas en ese cálculo**, no todas las
  de la historia, con la forma de «Datos y contrato». Se escribe aunque no haya
  hecho falta convertir nada (queda `rates: {}` con su `capturedAt`).
- **R10** — `OrderItem.storeProductId` es una referencia de conveniencia y puede
  quedar nula si el producto se borra después. El nombre y el precio del snapshot
  son la fuente de verdad de lo que se pidió.
- **R11** — Es pedible un producto con `availability != OUT_OF_STOCK`
  (`isOrderable()` de `src/lib/availability.ts`), `visible = true`,
  `deletedAt = null`, de esa tienda, y con precio resoluble. Se comprueba en la UI
  al agregar **y otra vez en el servidor al confirmar**; la del servidor es la que
  manda.

**Carrito**

- **R12** — La clave de `localStorage` es `qab.cart.v1.<Store.id>`: namespaced por
  **sucursal** y por el **id**, nunca por el slug. Por sucursal porque lo exige
  ADR 0012 («el carrito se namespacea por sucursal, no por marca»). Por id porque
  el slug se muda a `Storefront` en cuanto se implemente esa ADR, y una clave por
  slug convertiría esa migración en carritos huérfanos en el teléfono de cada
  comprador — un dato que no se puede migrar desde el servidor, porque no está en
  el servidor. **No se simplifique a slug** aunque el slug esté a mano en la URL y
  el id haya que pasarlo: el ahorro es de una prop y el coste es irreversible.
- **R13** — El carrito guarda identidad y cantidad. **Nunca** guarda datos de
  contacto ni dirección: es un dispositivo que puede ser compartido, y guardar el
  teléfono de alguien sin cuenta no lo pidió nadie. (Autocompletar contacto es
  F-012, y desde la cuenta.)
- **R14** — Cantidades enteras de 1 a 99 por línea; máximo 50 líneas por carrito.
  Cantidad 0 elimina la línea.
- **R15** — Un carrito con más de 30 días sin modificarse se descarta al leerlo:
  sus precios ya no significan nada.
- **R16** — Un contenido de la clave que no valide contra el esquema esperado —o
  cuya versión no sea la conocida— se descarta en silencio. Nunca rompe la página.

**Rutas y frontera cliente/servidor**

- **R17** — `Order.code` se genera en el servidor: 10 caracteres del alfabeto
  Crockford base32 sin `I`, `L`, `O`, `U`, en mayúsculas, con aleatoriedad
  criptográfica. Es la única credencial de la página del pedido, así que tiene que
  ser **inadivinable**: nada de secuencias ni de derivarlo del `id`.
- **R18** — `/[slug]/pedido/[code]` no se cachea y va con `noindex`: muestra
  nombre, teléfono y dirección de una persona.
- **R19** — `/[slug]/carrito`, `/[slug]/checkout` y `/[slug]/pedido/[code]` son
  dinámicas. `/[slug]` y `/[slug]/p/[productSlug]` **siguen ● (SSG)**: F-010 no
  puede degradar lo que F-004 dejó verificado.
- **R20** — El `matcher` de `src/proxy.ts` no se toca. Ninguna de las rutas nuevas
  entra ahí, ni `/[slug]` ni nada bajo él. Ficha
  `.agent/playbook/proxy-matcher-anula-isr.md`: el sensor no lo detecta, se pesca
  leyendo el diff.
- **R21** — Ningún componente que renderice catálogo lleva `"use client"`. Los
  únicos módulos de cliente son hojas: el botón de agregar, el contador de la
  cabecera, la vista del carrito y el formulario de checkout. `ProductCard` y las
  páginas de catálogo siguen siendo server components.
- **R22** — A un componente de cliente solo se le pasan datos planos y ya
  serializados (cadenas y números). Ni `Decimal` de Prisma ni `BigInt` cruzan esa
  frontera, ni aparecen en ninguna respuesta JSON.
- **R23** — El pedido nace en `PENDING`. F-010 no ejecuta ninguna otra transición
  de `OrderStatus`: `PULLED` lo pone el pull (F-007) y el resto el POS.
- **R24** — El checkout no lee cookies de sesión. (`AGENTS.md` § Prohibiciones ya
  reserva esa lectura a `lib/auth/*`, y aquí simplemente no hace falta.)
- **R25** — La creación del pedido tiene que poder ejercitarse **sin navegador**,
  o el criterio 3 no es verificable ejecutando algo (regla 1 del proyecto). Vale
  un route handler público o una función de `features/orders/server/` invocable
  desde un script `tsx` al estilo de `scripts/send-catalog-batch.mjs`. La forma la
  elige `sdd-architect`; la obligación es de esta spec.

**Idempotencia y abuso** (SP1 → c, SP3 → b)

- **R26** — El cliente genera un `idempotencyKey` (UUID v4) **por intento de
  checkout**, no por petición: si la confirmación falla con 409 y el comprador
  corrige y vuelve a confirmar, la clave es **la misma**. Se genera una nueva solo
  después de un pedido creado con éxito, o cuando se empieza un checkout distinto.
- **R27** — Con una clave que ya tiene pedido, no se crea nada: se responde 200 con
  **ese** pedido, `idempotent: true`. No es un error, es la respuesta que el
  reintento perdió. Si el contenido enviado difiere del pedido ya creado, se
  devuelve igualmente el pedido existente y **no** se aplica el contenido nuevo:
  cambiar un pedido ya hecho es renegociación, y está fuera de alcance.
- **R28** — La clave **ausente** se acepta: 201 y sin protección. Es lo que permite
  que un cliente viejo, o uno con JS parcialmente roto, siga pudiendo pedir. En
  Postgres un índice único no cuenta los `NULL`, así que la columna nullable basta
  y no hace falta ningún valor centinela.
- **R29** — La unicidad la impone **la base**, no una comprobación previa: el
  camino es intentar el `INSERT` y capturar la violación del índice único, porque
  un «mira si existe y si no inserta» pierde la carrera entre dos reintentos
  simultáneos. Al capturarla se relee el pedido por su clave y se responde como en
  R27.
- **R30** — Tope de creación: si la tienda ya tiene **5** pedidos en `PENDING` con
  el mismo `contactPhone` normalizado creados en los últimos **10 minutos**, se
  responde 429 y no se crea nada. Solo cuentan los `PENDING`: en cuanto el POS los
  recoge dejan de contar, porque ya hay un humano mirándolos.
- **R31** — La comprobación de R27 y la de R30 son **una sola consulta** (un
  `OR` entre la clave y la ventana de tienda + teléfono): el pooler de Supabase
  corre en modo transacción y AGENTS.md exige batchear en un solo round-trip. Y el
  orden entre ambas está fijado: **la idempotencia gana**. Un reintento legítimo
  nunca puede recibir un 429.

## Casos límite y errores

| Caso                                                          | Comportamiento exigido                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Carrito vacío al confirmar                                    | 400 `EMPTY_CART`, no se crea nada, la pantalla lleva al catálogo                    |
| Línea con cantidad 0 o negativa                               | Rechazada por el esquema (400); en la UI, 0 elimina la línea                        |
| Línea repetida del mismo `storeProductId` en el payload       | Se fusionan sumando cantidades antes de validar el tope de 99                       |
| `storeProductId` de otra tienda                               | 409, tratado como línea no disponible. No se filtra el catálogo ajeno               |
| Producto agotado / oculto / borrado entre agregar y confirmar | 409 con las líneas afectadas. **No** se crea el pedido con lo que quede             |
| Precio o tasa cambiados entre agregar y confirmar             | 409 con el desglose anterior/nuevo. Segunda confirmación con el total nuevo lo crea |
| Producto sin tasa para su moneda                              | No es pedible: `convert()` lanza y la línea se marca como sin precio. Nunca un 500  |
| Tienda no `PUBLISHED` (o slug inexistente)                    | 404 en todas las rutas nuevas; no se crea nada                                      |
| `deliveryEnabled = true` pero `deliveryFee = null`            | No se ofrece envío (R3). No se inventa «gratis» ni «a coordinar»                    |
| Envío elegido sin dirección                                   | 400 con el error en el campo; no se crea nada                                       |
| `checkoutMode = WHATSAPP` sin `whatsapp` ni `phone`           | El pedido se crea igual; la página no muestra enlace y explica que no hay número    |
| Doble envío del formulario / reintento de red                 | Misma `idempotencyKey`: 200 con el pedido ya creado, una sola fila (R27)            |
| Dos peticiones simultáneas con la misma clave                 | Una inserta, la otra captura la violación del índice único y relee (R29)            |
| Confirmación sin `idempotencyKey`                             | Se acepta con 201, sin protección contra duplicados (R28)                           |
| Misma clave con contenido distinto                            | Se devuelve el pedido existente sin aplicar el contenido nuevo (R27)                |
| Colisión de `code` (`@unique`)                                | Reintento con un código nuevo, hasta 5 veces; después 500 y log                     |
| `localStorage` no disponible o lleno                          | Carrito en memoria durante la visita; ninguna página rompe (E21)                    |
| Contenido corrupto o de versión desconocida en la clave       | Se descarta; carrito vacío (E22)                                                    |
| Dos pestañas escribiendo el carrito                           | Última escritura gana; el servidor re-precia al confirmar (E23)                     |
| Dos compradores por la última unidad                          | Ambos pedidos se crean. Lo resuelve el encargado; no hay reserva de stock           |
| Petición enorme (miles de líneas, cuerpo gigante)             | Rechazada por los topes de R14 y por el tope de cuerpo de «Datos y contrato»        |
| Sexto pedido `PENDING` del mismo teléfono y tienda en 10 min  | 429 `TOO_MANY_ORDERS` con `Retry-After`; nada se crea (R30)                         |
| Reintento idempotente cuando el tope ya está alcanzado        | 200 con su pedido: la idempotencia gana al tope (R31)                               |
| `code` escrito a mano en minúsculas o con guion               | Se normaliza antes de buscar; 404 solo si de verdad no existe                       |

## Datos y contrato

**Lo que se guarda en `localStorage`** — clave `qab.cart.v1.<Store.id>`:

```jsonc
{
  "v": 1,
  "storeId": "uuid",
  "updatedAt": "2026-08-26T02:00:00.000Z", // ISO-8601 UTC, para R15
  "items": [
    {
      "storeProductId": "uuid",
      "slug": "cafe-cubita", // para enlazar sin consultar
      "qty": 2, // entero 1..99
      // Solo para pintar al instante. NUNCA se usa para calcular un total
      // ni se persiste en el Order.
      "display": { "name": "Café Cubita", "unitPrice": "450.00", "currency": "CUP" },
    },
  ],
}
```

**Lo que se manda al confirmar** (la forma; el transporte lo decide el arquitecto,
R25):

| Campo                    | Tipo                     | Obligatorio   | Límite                              |
| ------------------------ | ------------------------ | ------------- | ----------------------------------- |
| `storeSlug`              | string                   | sí            | el de la URL                        |
| `items[].storeProductId` | string uuid              | sí            | 1..50 líneas                        |
| `items[].qty`            | int                      | sí            | 1..99                               |
| `contact.name`           | string                   | sí            | 2..80, sin quedar vacío al trim     |
| `contact.phone`          | string                   | sí            | 8..15 dígitos, `+` inicial opcional |
| `contact.email`          | string                   | no            | correo válido, ≤ 120                |
| `fulfillment`            | `"PICKUP" \| "DELIVERY"` | sí            | `DELIVERY` solo si R3 lo permite    |
| `deliveryAddress`        | string                   | si `DELIVERY` | 5..300                              |
| `notes`                  | string                   | no            | ≤ 500 → `Order.notes`               |
| `expectedTotal`          | string decimal           | sí            | se compara, no se guarda (R7)       |
| `idempotencyKey`         | string uuid v4           | no            | uno por intento de checkout (R26)   |

Cuerpo máximo 32 KB. Todo se valida con Zod en `features/orders/schemas.ts`.

**Respuestas**

| Situación                         | Código | Cuerpo                                                                                                                 |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Creado                            | 201    | `{ code, orderUrl, whatsappUrl }` (`whatsappUrl: null` en ONSITE)                                                      |
| Reintento con la misma clave      | 200    | `{ code, orderUrl, whatsappUrl, idempotent: true }` — el pedido ya creado (R27)                                        |
| Payload inválido                  | 400    | `{ error: "INVALID_BODY", issues }`                                                                                    |
| Carrito vacío                     | 400    | `{ error: "EMPTY_CART" }`                                                                                              |
| Tienda inexistente o no publicada | 404    | `{ error: "STORE_NOT_FOUND" }`                                                                                         |
| Líneas no pedibles                | 409    | `{ error: "ITEMS_UNAVAILABLE", lines: [{ storeProductId, reason }] }` con `reason ∈ OUT_OF_STOCK · REMOVED · NO_PRICE` |
| Total desactualizado              | 409    | `{ error: "PRICE_CHANGED", lines: [{ storeProductId, was, now }], total }`                                             |
| Tope de pedidos alcanzado         | 429    | `{ error: "TOO_MANY_ORDERS", retryAfterSeconds }` + cabecera `Retry-After` (R30)                                       |
| Fallo al persistir                | 500    | `{ error: "ORDER_CREATE_FAILED" }`                                                                                     |

**Cómo se llenan `Order` y `OrderItem`**

| Columna                          | Valor en F-010                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `code`                           | R17                                                                                |
| `storeId`                        | la tienda de la URL                                                                |
| `customerId`                     | `null` (F-012)                                                                     |
| `contactName/Phone/Email`        | del formulario, normalizados y recortados                                          |
| `deliveryAddress`                | del formulario si `DELIVERY`; si no, `null`                                        |
| `status`                         | `PENDING`                                                                          |
| `currencyCode`                   | `Business.baseCurrencyCode` al confirmar                                           |
| `subtotal`                       | Σ `lineTotal`                                                                      |
| `discountTotal`                  | `0` (R2)                                                                           |
| `deliveryFee`                    | `Store.deliveryFee` si `DELIVERY`; si no, `0`                                      |
| `total`                          | `subtotal - discountTotal + deliveryFee`                                           |
| `rateSnapshot`                   | ver abajo                                                                          |
| `notes`                          | del formulario o `null`                                                            |
| `pulledAt`                       | `null` — lo pone F-007                                                             |
| `idempotencyKey`                 | el del payload, o `null` si no vino (R28)                                          |
| `OrderItem.name`                 | `StoreProduct.localName` en ese instante                                           |
| `OrderItem.unitPrice`            | precio efectivo convertido (R4, R5), `Decimal(14,2)`                               |
| `OrderItem.quantity`             | entero, escrito en `Decimal(14,3)`                                                 |
| `OrderItem.lineTotal`            | `multiply(unitPrice, quantity)` de `lib/money.ts`, redondeo medio-arriba por línea |
| `OrderItem.originalUnitPrice`    | precio efectivo **sin convertir** (R5)                                             |
| `OrderItem.originalCurrencyCode` | la moneda de ese precio efectivo (R5)                                              |

Aritmética: siempre por `src/lib/money.ts` (unidades menores en `BigInt`). Se
redondea **por línea** y luego se suma; nunca al revés.

**`rateSnapshot`**

```jsonc
{
  "base": "CUP", // la moneda del pedido
  "capturedAt": "2026-08-26T02:00:00.000Z",
  "rates": { "USD": "440.000000", "MLC": "210.500000" }, // CUP por 1 unidad
}
```

Es exactamente la `RateTable` que consume `convert()`, más su contexto. Solo las
tasas leídas en ese cálculo (las de `getStoreRates`), en el formato en que salen
de `ExchangeRate.rate` (`Decimal(18,6)` como cadena).

**`Order.code`**

- Alfabeto: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (Crockford base32, sin `I`, `L`,
  `O`, `U`, que se confunden al dictarlos por teléfono).
- Longitud 10 → 50 bits. Regex: `^[0-9A-HJKMNP-TV-Z]{10}$`.
- Se guarda y viaja **sin separador y en mayúsculas**; se **muestra** agrupado
  `XXXXX-XXXXX`. La ruta normaliza (mayúsculas, sin espacios ni guiones) antes de
  buscar, para que un código dictado y tecleado a mano funcione.
- 256 / 32 = 8, así que `byte % 32` sobre bytes aleatorios no introduce sesgo.
- Sin prefijo de tienda: no aporta y alarga lo que hay que dictar.

**Enlace `wa.me`** (solo `checkoutMode = WHATSAPP`): número =
`Store.whatsapp ?? Store.phone`, solo dígitos, sin `+`. Texto URL-encoded con el
nombre de la tienda, el código formateado, las líneas, el total, retiro/envío y la
URL de `/[slug]/pedido/[code]`. Sin número configurado, no hay enlace (E18).

**Migración** (aditiva, SP1 → c y SP2 → c)

| Tabla       | Cambio                                         | Nota                                         |
| ----------- | ---------------------------------------------- | -------------------------------------------- |
| `Order`     | `idempotencyKey String? @unique`               | nullable: los `NULL` no colisionan entre sí  |
| `OrderItem` | `originalUnitPrice Decimal? @db.Decimal(14,2)` | informativo, nunca sumable (R5b)             |
| `OrderItem` | `originalCurrencyCode String?`                 | par con el anterior; se llenan o no, los dos |

Solo añade columnas nullables y un índice único. No reescribe filas, no toca
ninguna existente y **no** necesita `prisma migrate reset` ni `prisma db push`
(prohibidos en AGENTS.md § Comandos prohibidos). Se aplica con
`npm run db:migrate` y se verifica con `npx prisma migrate status`.

**Ampliación del payload del pull — estrictamente aditiva** (SP2 → c)

Los campos que el POS ya lee no cambian de nombre, ni de tipo, ni de significado.
`unitPrice`, `currencyCode`, `lineTotal`, `subtotal`, `discountTotal`,
`deliveryFee` y `total` siguen siendo lo que son hoy en `pullOrders`
(`src/features/orders/server/pull.ts:43`): **todo en la moneda del pedido**, con
`Σ lineTotal = subtotal`. Un lector actual de cuadrecaja sigue funcionando sin
tocar una línea. Lo que se **añade**:

| Campo nuevo                    | Nivel  | Contenido                                                              |
| ------------------------------ | ------ | ---------------------------------------------------------------------- |
| `items[].originalUnitPrice`    | línea  | Precio unitario efectivo antes de convertir, como cadena decimal       |
| `items[].originalCurrencyCode` | línea  | Moneda de ese precio (p. ej. `"USD"`)                                  |
| `items[].originalLineTotal`    | línea  | `originalUnitPrice × quantity`, derivado de valores congelados (R8)    |
| `rateSnapshot`                 | pedido | El objeto congelado tal cual se guardó, para reconstruir la conversión |

Cómo se relacionan: `unitPrice = convert(originalUnitPrice, currencyCode, rateSnapshot.rates)`
—la misma función de `src/lib/money.ts`, con las tasas del `rateSnapshot`, así que
el POS puede recomputarlo y llegar al mismo céntimo—, mientras que `subtotal`
sigue siendo la suma de los `lineTotal` **convertidos** y nunca de los originales
(R5b). Si un pedido antiguo no tiene los campos originales guardados, se emiten
con los valores convertidos: un campo nuevo nunca sale `null` para un lector que
espere un número.

Esto obliga a una **versión nueva de `docs/sync-contract.md`** (§ ③④) que documente
los cuatro campos, el formato de `code` (I1) y la relación de arriba. Avisar al
equipo de cuadrecaja queda como pendiente del humano; no bloquea F-010, porque la
ampliación es compatible hacia atrás por construcción.

## Criterios de aceptación propuestos

Los seis `[ya]` son los de `features.json` **literales** (regla 3). Debajo de cada
uno, con qué se comprueba.

1. `[ya]` **«El carrito persiste en localStorage con una clave namespaced por
   tienda.»** → test del proyecto `ui`:
   `npx vitest run --project ui <archivo>` sobre el módulo del carrito: agregar en
   la tienda A crea `qab.cart.v1.<idA>`, no toca la de B, y releer recupera las
   líneas. **El archivo tiene que llamarse `*.test.tsx`**: por
   `vitest.config.mts:30` un `*.test.ts` corre en el proyecto `node`, donde no hay
   `localStorage` (ficha `.agent/playbook/test-en-entorno-equivocado.md`).
2. `[ya]` **«Un producto con availability OUT_OF_STOCK no se puede agregar.»** →
   tres comprobaciones: (a)
   `curl -s localhost:3000/tienda-demo/p/<agotado> | grep -c 'disabled'` ≥ 1 sobre
   el HTML servido; (b) test jsdom: `add()` de un producto agotado deja el carrito
   igual; (c) confirmar un carrito con una línea agotada responde 409
   `ITEMS_UNAVAILABLE` y `SELECT count(*) FROM "Order"` no sube.
3. `[ya]` **«El checkout crea un Order con snapshot de contacto y de precios, y
   rateSnapshot con las tasas del momento.»** → ejercitar la creación sin navegador
   (R25) y comprobar en la base: existe la fila, `contactName/contactPhone`
   coinciden con lo enviado, `OrderItem.unitPrice` coincide con el precio efectivo
   del momento y `rateSnapshot.rates` con lo que devuelve `getStoreRates`.
4. `[ya]` **«Se puede completar un pedido sin iniciar sesión.»** → la misma
   petición del criterio 3 sin cabecera `Cookie` responde 201, y
   `grep -rn "cookies()" src/features/orders/ src/app/\[slug\]/` no devuelve nada.
5. `[ya]` **«La página /[slug]/pedido/[code] muestra el pedido y no está
   cacheada.»** → `curl -s .../pedido/<code>` contiene el código y el total; luego
   `POST /api/internal/orders/status` a `CONFIRMED` y el **mismo** curl muestra
   «Confirmado» sin esperar revalidación. Además `curl -sI` no trae `s-maxage`.
6. `[ya]` **«Las rutas de carrito y checkout se marcan ƒ (Dynamic) en el build,
   nunca SSG.»** → `npm run build` y en su tabla `/[slug]/carrito`,
   `/[slug]/checkout` y `/[slug]/pedido/[code]` salen con `ƒ`, mientras `/[slug]` y
   `/[slug]/p/[productSlug]` **siguen con `●`**. `export const dynamic` se escribe
   con literal, igual que `revalidate` (ficha
   `.agent/playbook/revalidate-no-literal.md`: la restricción vale también para
   `dynamic`). Y `grep -n "slug" src/proxy.ts` no devuelve nada en el `matcher`
   (ficha `proxy-matcher-anula-isr`, que ninguna etapa del sensor detecta).

Propuestos al humano, porque cubren lo que los seis dejan fuera:

7. `[nuevo]` Un producto que pasa a `OUT_OF_STOCK` **estando ya en el carrito** no
   se puede pedir: la confirmación responde 409 y no queda ninguna fila.
8. `[nuevo]` Cambiar el precio (o el `priceOverride`) entre agregar y confirmar
   responde 409 con el importe anterior y el nuevo; repetir la confirmación con el
   total nuevo crea el pedido con los importes nuevos.
9. `[nuevo]` Después de crear el pedido, cambiar `ExchangeRate` y `syncedPrice` y
   recargar `/[slug]/pedido/[code]` deja los importes **idénticos**.
10. `[nuevo]` Un producto con `priceOverride` produce `OrderItem.unitPrice` igual
    al override, nunca al `syncedPrice` (el equivalente en pedido del criterio 5 de
    F-004).
11. `[nuevo]` Una tienda con `checkoutMode = ONSITE` crea el pedido igual y su
    página **no** contiene `wa.me`; con `WHATSAPP` sí (decisión 1 del humano).
12. `[nuevo]` Con `deliveryEnabled = true` y `deliveryFee = 500`, elegir envío da
    `total = subtotal + 500` y exige dirección; elegir retiro da `total = subtotal`
    y `deliveryAddress = null`.
13. `[nuevo]` Tras crear un pedido por checkout,
    `GET /api/internal/orders?since=0&limit=10` lo devuelve y lo deja en `PULLED`
    — que es justo lo que F-007 no podía verificar.
14. `[nuevo]` `npm run check:bundle` termina en 0 tras `npm run build` con el
    presupuesto ya ajustado (criterio 21), y `bash .agent/verify.sh F-010 --full`
    termina en 0.
15. `[nuevo]` `/[slug]/pedido/[code]` con un `code` inexistente o de otra tienda
    responde 404.
16. `[nuevo]` Dos confirmaciones idénticas con el **mismo** `idempotencyKey`: la
    primera 201, la segunda 200 con el mismo `code` e `idempotent: true`, y
    `SELECT count(*) FROM "Order"` sube exactamente 1.
17. `[nuevo]` Dos confirmaciones **sin** `idempotencyKey` responden 201 las dos y
    crean dos pedidos: la falta de protección es deliberada (R28) y está verificada,
    no supuesta.
18. `[nuevo]` Seis confirmaciones del mismo teléfono y tienda en menos de 10
    minutos: las cinco primeras 201, la sexta 429 `TOO_MANY_ORDERS` con
    `Retry-After`; con otro teléfono, 201. Y un reintento con una clave ya usada
    responde 200 aunque el tope esté alcanzado (R31).
19. `[nuevo]` Compatibilidad hacia atrás del pull: la respuesta de
    `GET /api/internal/orders` conserva **todas** las claves que hoy emite
    `pullOrders` con el mismo tipo y significado, y añade las cuatro nuevas. Se
    comprueba con un test que fija la forma de la respuesta, no leyendo el diff.
20. `[nuevo]` `npx prisma migrate status` reporta la migración nueva como aplicada,
    `npx prisma validate` termina en 0, y `git grep -n "migrate reset\|db push"`
    no encuentra ninguno en lo añadido.
21. `[nuevo]` Tras `npm run build`, el número medido por
    `scripts/check-bundle-budget.mjs` queda escrito como `BUDGET_KB` por defecto
    con el mismo margen que hoy (≈10 KB por encima de lo medido, que es lo que
    significan los 190 actuales frente a los ~180 de F-004), y el número medido
    queda anotado en el progress para que F-013 lo baje.

## Incongruencias detectadas

- **I1 — Nadie definió el formato de `Order.code` y ya viaja al POS.**
  `prisma/schema.prisma:378` lo declara `String @unique` sin más, y
  `src/features/orders/server/pull.ts:54` ya lo envía. Además es la **única**
  protección de una página pública con nombre, teléfono y dirección. Cerrado en
  R17 y en «Datos y contrato»; queda pendiente escribirlo en
  `docs/sync-contract.md` § ③④, que hoy no lo menciona (AGENTS.md § Documentación:
  un cambio en el contrato se versiona allí).
- **I2 — El progreso da por hecho que no hay migración, y la hay. Cerrada.**
  `.agent/progress/F-010.md` dice «este feature no debería necesitar migración».
  Con SP1 → c y SP2 → c, F-010 **sí** trae migración: aditiva, tres columnas
  nullables y un índice único, sin reescribir filas y sin ninguno de los dos
  comandos prohibidos. La tabla está en «Datos y contrato» § Migración. Quien
  retome el feature no debe fiarse de esa frase del progress.
- **I3 — ADR 0012 está aceptada y su modelo no existe.** «El carrito se namespacea
  por sucursal, no por marca», pero no hay `Storefront` en el schema y `/[slug]`
  resuelve un `Store` (`src/features/catalog/server/queries.ts:45`). No bloquea
  F-010; sí obliga a R12 (clave por `Store.id`, no por slug), para que la
  migración multisucursal no deje carritos huérfanos.
- **I4 — El seed no permite verificar dos de las tres decisiones del humano.**
  `prisma/seed.ts:271` y `:286` crean dos tiendas sin `checkoutMode`,
  `deliveryEnabled` ni `deliveryFee`, así que ambas quedan en los defaults del
  schema (`WHATSAPP`, `false`). Sin tocar el seed no hay forma de ejecutar los
  criterios 11 y 12. **Confirmado por el humano: entra en el alcance.** Qué hace
  falta está en «Alcance § Dentro»; dónde vive lo decide `sdd-architect`.
- **I5 — El criterio 2 no dice nada del caso que muerde.** «Un producto con
  availability OUT_OF_STOCK no se puede agregar» solo habla de **agregar**; el caso
  real es el producto que se agota **después**, estando ya en el carrito. Por la
  regla 3 el criterio no se toca: lo cubren E12, R11 y el criterio `[nuevo]` 7.
- **I6 — El presupuesto de bundle tiene ~10 KB de margen y F-010 introduce el
  primer `"use client"` del repo.** Las notas de F-004 en `features.json` miden
  «~180 KB gzip» y `scripts/check-bundle-budget.mjs:22` fija el tope en 190. El
  botón de agregar vive en una página **SSG** (la ficha de producto), así que su JS
  sí entra en la medida. **Cerrada con SP4 → c**: se implementa la island mínima
  (sin gestor de estado), se mide después del build y el presupuesto se fija en el
  número medido. La ficha `bundle-fuera-de-presupuesto.md` exige consultar toda
  subida: consultada y autorizada el 2026-08-26. El dueño de bajarlo es F-013,
  cuyo criterio 4 dice literalmente «el presupuesto de
  scripts/check-bundle-budget.mjs se bajó al número alcanzado».
- **I7 — `pullOrders` no filtra por negocio y a partir de F-010 eso mueve datos
  personales reales.** `src/features/orders/server/pull.ts:43` consulta
  `where: { id: { gt: since } }` sin filtro de tienda ni de negocio; el guard
  (`src/app/api/internal/_lib/guard.ts:10`) valida un `SYNC_TOKEN` global. Ya está
  levantado en `.agent/specs/propuestas/identidad-integracion.md` y en ADR 0013;
  se anota aquí porque F-010 es lo que convierte el hueco en una fuga de nombres,
  teléfonos y direcciones. **No** se arregla en F-010.
- **I8 — El criterio 6 exige `ƒ` para el carrito, que por contenido podría ser
  estático.** Lo que hay en el carrito vive en `localStorage`, no en el servidor.
  No es contradicción una vez que R6 obliga a re-preciar contra el servidor: la
  página lee precios y disponibilidad frescos en cada petición, y por eso es
  dinámica de verdad. Se anota para que nadie «optimice» volviéndola estática.
- **I9 — `OrderItem` tiene `currencyCode` por línea, pero `Order.subtotal` es de
  una sola moneda.** El schema admite líneas en monedas distintas
  (`prisma/schema.prisma:423`) y entonces `subtotal` no estaría bien definido.
  **Cerrada con SP2 → c**: `currencyCode` de la línea sigue siendo la moneda del
  pedido —y solo así `Σ lineTotal = subtotal`—, y la moneda original viaja en los
  campos nuevos `originalCurrencyCode` / `originalUnitPrice`, informativos y no
  sumables (R5, R5b).

## Huecos y preguntas al humano

**Ninguna abierta.** Las cuatro se respondieron el 2026-08-26 y están incorporadas
arriba; se conservan aquí con su número para que la trazabilidad no se pierda.

- **SP1 — Duplicados al confirmar → (c) columna `idempotencyKey @unique`.** El
  cliente genera una clave por intento de checkout y la base rechaza el duplicado.
  Obliga a migración, y es aditiva. Clave repetida con el mismo contenido: se
  devuelve el pedido ya creado, no un 409. Clave ausente: se acepta igual, sin
  protección, para no romper a un cliente viejo. → R26–R29, I2, criterios 16, 17
  y 20.
- **SP2 — Moneda de las líneas hacia cuadrecaja → (c) el pull lleva ambos
  importes**, con la condición de que la ampliación sea **estrictamente aditiva**:
  ningún campo que el POS ya lee cambia de nombre, de tipo ni de significado. Los
  nombres exactos, el contenido y la relación con `subtotal` y `rateSnapshot` están
  en «Datos y contrato» § Ampliación del payload del pull. → R5, R5b, I9,
  criterio 19. Pendiente **del humano**: avisar al equipo de cuadrecaja de la
  versión nueva de `docs/sync-contract.md`. No bloquea, porque es compatible hacia
  atrás por construcción.
- **SP3 — Defensa del endpoint público → (b) tope de 5 pedidos `PENDING` por
  tienda + teléfono en 10 minutos**, 429 al pasarse, compartiendo la consulta con
  la comprobación de SP1. → R30, R31, criterio 18.
- **SP4 — Presupuesto de bundle → (c) se sube ya, remitiendo a F-013.** No es
  esquivar la island: el botón de agregar se implementa como client component
  mínimo, sin `zustand` ni ningún gestor de estado, se mide el número real tras el
  build y `BUDGET_KB` se fija en ese número con el margen que ya usa el script.
  → I6, criterio 21.

## No decidido a propósito

- **Cómo se guarda el estado del carrito en el cliente**, dentro del límite que
  ya fijó SP4: hook propio, sin `zustand` ni ningún gestor de estado (`zustand`
  está en `package.json` y sin usar; que siga así hasta que alguien lo justifique
  midiendo). Y **qué transporte tiene la confirmación**: route handler público
  contra server action. Lo cierra `sdd-architect`; esta spec exige R21, R22 y R25.
- **La disposición de las pantallas**: carrito y checkout en dos pasos o en uno
  solo con el resumen arriba, y cómo se presenta el conflicto de precio de E13.
  Lo cierra `sdd-designer`.
- **Los textos exactos en español** de estados, errores y del mensaje de WhatsApp.
  `sdd-designer`.
- **El valor de los topes** (30 días de caducidad del carrito, 50 líneas, 99
  unidades, y los 5 pedidos / 10 minutos de R30): son constantes de
  `src/constants/`, revisables sin tocar la spec.
- **El número exacto del presupuesto de bundle**: sale de medir después del build
  (criterio 21). Bajarlo es F-013.
- **Nada sobre `Storefront`/multisucursal**: R12 deja el carrito preparado y el
  resto es ADR 0012 y su propuesta.
