---
feature: F-011
agente: sdd-spec
actualizado: 2026-08-28T01:44:00Z
estado: listo
---

> **Aviso de lectura (2026-08-28).** Todo lo que hay hasta el final de «No
> decidido a propósito» es el documento del ciclo 1, escrito cuando `themeTokens`
> vivía en `Store`. **No se ha tocado ni una línea**: los criterios 1–4 están
> verificados y en `main` (PR #6) y la regla 3 los reserva. Lo que este ciclo
> añade está en el capítulo final, **«Tanda 3 — el criterio 5 sobre
> `Storefront`»**, y es lo único que hay que leer para construirlo. El resto sirve
> de historia y de contexto; donde el capítulo final contradiga al ciclo 1, manda
> el capítulo final y lo dice explícitamente.

## Problema

Hoy `/admin` es un cascarón: entra con la sesión de F-008 y dice que no hay
funcionalidad. Todo lo que distingue una tienda online de un volcado del POS
—colores, fotos, textos propios, precio online, qué se muestra y qué no,
promociones— vive en columnas que existen en la base y que **ningún código
escribe**. El negocio no tiene forma de vestir su vitrina.

## Alcance

### Dentro

**Tanda 1 — tiendas** (HD4). Firma su propio plan y se entrega antes que la 2.

- Listado de las tiendas que el admin puede gestionar, filtrado por
  `storeIds` de la sesión.
- Editor de branding: los cinco tokens de `themeTokensSchema`
  (`src/features/theming/storeTheme.ts`) → columna `Store.themeTokens`.
- Autorización por tienda en toda escritura, con 403 verificable.
- Revalidación de la tienda pública tras cada escritura del panel.
- **Tanda 1b** — texto y contacto de la tienda (descripción, teléfono,
  WhatsApp, correo). Va en la tanda 1 porque HD4 y HD2 lo piden, pero es la
  única parte de la tanda que **ningún** `acceptance_criteria` cubre y la que
  exige migración: si el humano quiere una tanda 1 más corta, la línea de corte
  se dibuja aquí y no en otro sitio. Ver I1.

**Tanda 2 — productos, imágenes y promociones** (HD4).

- Editor de producto: `description`, `imageUrls`, `priceOverride`
  (+ `priceOverrideCurrency`), `visible`, `featured`.
- Subida de imágenes a Supabase Storage real, verificada contra un emulador en
  docker (HD1), y servidas por `next/image`.
- `Store.logoUrl` y `Store.coverUrl`: se editan aquí, no en la tanda 1, porque
  su valor sale del mismo cargador de imágenes.
- Promociones completas (HD3): CRUD en el panel y aplicación real en el precio
  mostrado y en el snapshot del pedido. **No cuentan casillas para cerrar el
  feature**: ningún criterio las nombra y la regla 3 prohíbe añadir criterios a
  F-011. Sus requisitos están numerados `P1..P12` aparte.

### Fuera (explícito)

- **Publicar y despublicar la tienda.** HD2: sobre `Store.status` y
  `Store.publishedAt` manda el sync. El panel no los escribe nunca, ni en un
  formulario, ni en un endpoint, ni "solo para DRAFT". Se hace desde Cuadre de
  Caja. Esto contradice la palabra «publicar» de la descripción del feature en
  `.agent/features.json`; ver I2.
- **`Store.slug`.** Cambiarlo rompe URLs vivas, `generateStaticParams` y los
  tags de ISR. Lo genera el sync al crear la tienda y ahí se queda.
- **`Store.name`, `address`, `city`, `province`, `latitude`, `longitude`.**
  Identidad y ubicación son del POS; el panel las muestra en modo lectura.
- **`Store.openingHours` y la zona horaria.** Sin `Store.timezone` no se puede
  evaluar un horario sin usar el reloj del servidor. Es la propuesta
  `.agent/specs/propuestas/horarios-y-propiedad-de-campos.md`, no F-011.
- **`Store.checkoutMode`, `deliveryEnabled`, `deliveryFee`.** Son de panel por
  omisión (el sync no los toca) pero cambian el comportamiento del checkout de
  F-010, verificado con `checkoutMode` fijado por seed. Editarlos es un feature
  con sus propios criterios, no un campo más de este formulario.
- **Selector de moneda del override.** El override se guarda en la moneda
  sincronizada del producto en ese momento (R14). Cotizar online en otra moneda
  es otro feature.
- **Alta y baja de productos, categorías y precios sincronizados.** El panel
  nunca crea un `StoreProduct` ni escribe `syncedPrice`.
- **Gestión de usuarios y de accesos.** Llegan firmados en el token de SSO
  (`src/app/admin/sso/route.ts`).
- **Recorte, rotación o reordenamiento fino de imágenes**, y borrado del objeto
  en Storage al quitar una URL (R22 deja el objeto huérfano a propósito).
- **Cron de revalidación en los bordes de una promoción.** R28 acepta un retardo
  de visualización acotado por el piso de ISR.
- **Pedidos, estados de pedido y métricas.** No hay ninguna pantalla de pedidos
  en este feature.

## Actores y precondiciones

**El administrador de un negocio.** Entra por `/admin/sso` con el token de un
solo uso que emite cuadrecaja, y sale con la cookie `qab-admin-session`
(`src/lib/auth/adminSession.ts`). Precondiciones:

- La sesión existe y no expiró (12 h). Sin ella, `src/app/admin/layout.tsx`
  redirige y ninguna pantalla del panel se renderiza.
- `session.storeIds` son **ids internos** de `Store`, no `externalId`: los mapea
  `src/app/admin/sso/route.ts:47-51` antes de firmar. Toda comparación de
  autorización usa ese id.
- Las tiendas y los productos ya existen porque el sync los creó. El panel no
  da de alta nada.

No hay segundo actor. El comprador no ve el panel; el sync no lo llama.

## Comportamiento esperado

### Tanda 1 — tiendas

- **E1** — Dado un admin cuya sesión trae `storeIds = [A]`, cuando abre el
  listado del panel, entonces aparece la tienda A y **no** aparece ninguna otra
  tienda de la base, ni siquiera otra del mismo `Business`.
- **E2** — Dado ese mismo admin, cuando abre la pantalla de edición de la tienda
  A, entonces responde 200 y muestra los valores actuales de `themeTokens`,
  y en modo lectura `name`, `address`, `city`, `status` con la nota de que
  publicar se hace en Cuadre de Caja.
- **E3** — Dado ese admin, cuando pide la pantalla de edición de la tienda B
  (que existe pero no está en su sesión), entonces responde **404**: que B
  exista no es asunto suyo (R7).
- **E4** — Dado ese admin, cuando envía una escritura sobre la tienda B al
  endpoint de escritura, entonces responde **403** con cuerpo
  `{"error":"FORBIDDEN"}` y ninguna columna de B cambia.
- **E5** — Dada una petición de escritura **sin** cookie de sesión, entonces
  responde **401** `{"error":"UNAUTHORIZED"}`. Un endpoint no redirige.
- **E6** — Dado un branding válido (`{"brand":"#0f62fe","radius":"soft"}`),
  cuando el admin lo guarda, entonces responde 200, `Store.themeTokens` queda
  con exactamente esas claves, y la siguiente petición pública a `/<slug>`
  trae el `<style>` con `--color-brand:#0f62fe` sin esperar el piso de ISR.
- **E7** — Dado un branding inválido —color que no pasa el regex, `radius`
  fuera del enum, o una clave desconocida como `background`— entonces responde
  **400** con la lista de problemas de Zod y `Store.themeTokens` queda
  **idéntica** a como estaba.
- **E8** — Dado un branding que el admin quiere quitar, cuando guarda el
  formulario vacío, entonces se escribe `{}` (no `null`, R11) y la tienda pública
  vuelve a la paleta por defecto sin `<style>`.
- **E9** — Dado un guardado correcto, entonces el panel muestra los valores
  nuevos al recargar **sin** retardo: sus lecturas no pasan por la caché de
  datos (R9).

### Tanda 1b — texto y contacto de la tienda

- **E10** — Dado un admin con acceso a la tienda A, cuando guarda una
  descripción propia, entonces la tienda pública muestra esa descripción y no la
  que envió el POS.
- **E11** — Dado ese estado, cuando llega un evento `STORE` del sync con otra
  `description`, entonces la columna sincronizada cambia, la del panel no, y la
  tienda pública sigue mostrando la del panel.
- **E12** — Dado un WhatsApp propio guardado en el panel, cuando un comprador
  confirma un pedido, entonces el enlace `wa.me` usa el número del panel
  (`src/features/orders/server/read.ts:92` y
  `src/features/orders/server/quote.ts:92` aplican la misma precedencia).
- **E13** — Dado un campo de contacto que el admin borra, entonces la
  precedencia vuelve al valor del sync (cadena vacía se guarda como `null`, R13).

### Tanda 2 — productos

- **E14** — Dado un admin con acceso a la tienda A, cuando abre el listado de
  productos de A, entonces ve todos los `StoreProduct` no borrados, incluidos
  los `visible: false`, con su precio sincronizado y su override si lo hay.
- **E15** — Dado un producto de A, cuando guarda `description`, `visible`,
  `featured` y `priceOverride`, entonces responde 200, las cuatro columnas
  quedan escritas y la tienda pública refleja el cambio en la siguiente
  petición.
- **E16** — Dado un producto con `priceOverride` puesto, cuando llega un evento
  `PRODUCT` de `UPDATE` con otro `price`, entonces `syncedPrice` cambia y
  `description`, `imageUrls`, `priceOverride`, `priceOverrideCurrency`,
  `visible` y `featured` quedan **exactamente** como estaban.
- **E17** — Dado un producto con `priceOverride = 0`, entonces la tienda pública
  muestra 0 y no el precio sincronizado: cero es un precio real (ADR 0007).
- **E18** — Dado un producto con `visible: false`, entonces `/<slug>` no lo
  lista, `/<slug>/p/<productSlug>` responde 404 y añadirlo al carrito por su id
  responde no-pedible (`src/features/orders/server/quote.ts` ya lo trata como
  `REMOVED`).
- **E19** — Dado un producto de la tienda B, cuando el admin de A intenta
  escribirlo, entonces responde 403 y nada cambia. La comprobación es sobre el
  `storeId` **del producto**, no sobre un `storeId` que venga en el cuerpo.

### Tanda 2 — imágenes

- **E20** — Dado un JPEG de 400 KB, cuando el admin lo sube a un producto de su
  tienda, entonces responde 201 con la URL pública, el objeto existe en el
  bucket bajo `stores/<storeId>/products/<storeProductId>/<uuid>.jpg`, y la URL
  queda añadida al final de `StoreProduct.imageUrls`.
- **E21** — Dada esa URL, cuando la tienda pública renderiza el producto,
  entonces el HTML trae un `<img>` con `src` que empieza por `/_next/image?url=`
  y esa petición responde 200 con `content-type: image/avif` o `image/webp`.
- **E22** — Dado un archivo que no es imagen, o mayor que el límite, o de un
  mime fuera de la lista, entonces responde 400 con el motivo, no se sube nada y
  `imageUrls` no cambia.
- **E23** — Dado un producto que ya tiene el máximo de imágenes, entonces subir
  otra responde 409 y no se sube nada.
- **E24** — Dada una subida para un producto de otra tienda, entonces responde
  403 antes de leer el cuerpo del archivo.
- **E25** — Dado Storage caído o sin credencial de servicio, entonces responde
  503 con un motivo, se registra en el log del servidor y `imageUrls` no cambia:
  nunca queda una URL apuntando a un objeto que no existe.
- **E26** — Dado un `imageUrls` con dos entradas, cuando el admin quita la
  primera, entonces la tienda pública usa la que queda como imagen principal.

### Tanda 2 — promociones (HD3)

- **E27** — Dado un admin con acceso a la tienda A, cuando crea una promoción
  `PERCENTAGE`/`PRODUCT` del 20 % sobre un producto, con `startsAt` en el pasado
  y sin `endsAt`, entonces responde 201 y `/<slug>` muestra el precio con el
  20 % descontado y el precio anterior tachado.
- **E28** — Dado ese estado, cuando el comprador confirma el pedido, entonces
  `OrderItem.unitPrice` es el precio con descuento y el total del pedido cuadra
  con lo que vio en pantalla.
- **E29** — Dada una promoción `active: false`, o con `startsAt` futuro, o con
  `endsAt` pasado, entonces no afecta a ningún precio ni en la vitrina ni en el
  pedido.
- **E30** — Dado un producto con `priceOverride` y una promoción que le aplica,
  entonces el descuento se calcula **sobre el override**, nunca sobre
  `syncedPrice`.
- **E31** — Dadas dos promociones que aplican al mismo producto, entonces gana
  una sola: la que deja el precio más bajo (R26). No se acumulan.
- **E32** — Dada una promoción `ORDER` de importe fijo con
  `conditions.minSubtotal`, cuando el subtotal no alcanza el mínimo, entonces
  `discountTotal` es 0; cuando lo alcanza, `discountTotal` es el importe y
  `total = subtotal - discountTotal + deliveryFee`.
- **E33** — Dada una promoción de otra tienda, entonces editarla o borrarla
  responde 403.
- **E34** — Dado un pedido ya creado, cuando se cambia o se borra la promoción,
  entonces los importes del pedido no se recalculan (`rateSnapshot` y el
  snapshot de precios de F-010 mandan).

## Reglas de negocio

**Autorización**

- **R1** — Toda lectura y toda escritura del panel referida a una tienda
  comprueba `canManageStore(session, storeId)` de
  `src/lib/auth/adminSession.ts`. No hay un segundo camino.
- **R2** — La fuente de la autorización es la **sesión**, no
  `AdminStoreAccess`. Esa tabla es espejo para auditoría; F-008 ya aceptó que
  revocar en el POS surte efecto al siguiente inicio de sesión.
- **R3** — El `storeId` que se autoriza sale de la URL o de la fila que se va a
  escribir, nunca de un campo del cuerpo de la petición.
- **R4** — Para un producto, una promoción o una imagen, se autoriza el
  `storeId` **de la fila**, resuelto con una lectura previa.
- **R5** — Toda escritura del panel es un route handler bajo `/api/admin/`.
  Es lo que permite responder un 403 real: hoy no existe ninguna server action
  en el repo (`grep -rn "use server" src/` no devuelve nada) y una server action
  que lanza no produce un código HTTP verificable. Si más adelante se añade
  una, cumple R1–R4 igual, pero el 403 del criterio 2 se comprueba contra el
  route handler.
- **R6** — Sin sesión: 401 en `/api/admin/`, redirección en las páginas (lo que
  ya hace `src/app/admin/layout.tsx`).
- **R7** — Página de una tienda, producto o promoción que el admin no gestiona: 404. Endpoint de escritura: 403. La página no usa 403 para no filtrar la
  existencia de la tienda ajena, y para no habilitar
  `experimental.authInterrupts`, que es lo que pide `forbidden()` de Next 16.

**Propiedad de campos**

- **R8** — El panel **solo** escribe: `Store.themeTokens`, `Store.logoUrl`,
  `Store.coverUrl`, las cuatro columnas de override de la tanda 1b,
  `StoreProduct.description`, `imageUrls`, `priceOverride`,
  `priceOverrideCurrency`, `visible`, `featured`, y las filas de `Promotion`.
  Cualquier otra columna de `Store` o de `StoreProduct` es del sync o de la
  plataforma. La lista completa está en «Datos y contrato».
- **R9** — Las lecturas del panel **no** pasan por `cached()` de
  `src/lib/cache.ts`, y sus rutas siguen con `dynamic = "force-dynamic"`. El
  admin tiene que ver lo que acaba de guardar.
- **R10** — Tras cada escritura del panel se llama a `revalidateStores([slug])`
  de `src/lib/cache.ts`, con el slug de la tienda afectada. **No** basta
  `revalidateProducts`: ver I3.

**Branding**

- **R11** — `Store.themeTokens` se valida siempre con `themeTokensSchema`
  (`.strict()`), y lo que se guarda es `parsed.data`, no el cuerpo recibido.
  Quitar el branding escribe `{}`, nunca `null`: Prisma rechaza un `null` plano
  en una columna `Json?` (el mismo motivo que explica
  `src/features/sync/server/handlers/store.ts:55-57`).
- **R12** — El panel no ofrece CSS libre ni claves fuera del esquema. Los cinco
  tokens son los que hay.

**Contenido y precio**

- **R13** — En todo campo de texto del panel, cadena vacía o solo espacios se
  guarda como `null`, que es lo que hace que la precedencia vuelva al valor del
  sync (o al del canónico, en el caso de la descripción del producto:
  `src/features/catalog/server/queries.ts:111`).
- **R14** — Al guardar un `priceOverride` se escribe **siempre** un
  `priceOverrideCurrency` explícito, igual al `syncedPriceCurrency` del producto
  en ese momento. `src/lib/pricing.ts:35` deja que un override sin moneda herede
  la sincronizada: eso convertiría un cambio de moneda en el POS en un cambio
  silencioso del importe del override. Quitar el override pone las dos columnas
  a `null`.
- **R15** — `priceOverride` es `>= 0` con dos decimales. Cero es un precio
  real (ADR 0007); solo `null` significa «sin override».
- **R16** — La precedencia se sigue leyendo por `src/lib/pricing.ts`. Ninguna
  pantalla del panel reimplementa `priceOverride ?? syncedPrice`.

**Imágenes**

- **R17** — El destino es Supabase Storage por su API, en el bucket de
  `SUPABASE_STORAGE_BUCKET` (`src/lib/env.ts:15`, por defecto `store-media`),
  con lectura pública. No hay driver de disco ni abstracción que evite la API
  (HD1).
- **R18** — La subida ocurre en el servidor con
  `SUPABASE_SERVICE_ROLE_KEY`. Si falta, el endpoint responde 503 y lo escribe
  en el log, igual que `src/app/admin/sso/route.ts:20-24` hace con su secreto.
  La clave de servicio no llega nunca al navegador.
- **R19** — La ruta del objeto es
  `stores/<storeId>/products/<storeProductId>/<uuid>.<ext>`. Lleva el `storeId`
  para que una ruta de otra tienda sea imposible de construir, y un `uuid` para
  que dos subidas no se pisen.
- **R20** — Límites, a `src/constants/` porque AGENTS.md prohíbe números
  mágicos: mime en `image/jpeg`, `image/png`, `image/webp`, `image/avif`; 5 MB
  por archivo; 8 imágenes por producto. El mime se decide por el contenido, no
  por la extensión del nombre que envía el navegador.
- **R21** — En `imageUrls` se guarda la **URL pública absoluta**, que es lo que
  hoy consumen `src/components/store/ProductCard.tsx:38` y el `openGraph` de
  `src/app/[slug]/p/[productSlug]/page.tsx`. Consecuencia aceptada: si el
  proyecto de Storage cambia de host, las filas hay que reescribirlas.
- **R22** — Quitar una URL de `imageUrls` no borra el objeto del bucket. Un
  borrado inmediato dejaría roto cualquier pedido o caché que ya la sirviera; la
  recolección de huérfanos es otro feature.
- **R23** — `next/image` sirve toda imagen de producto. `next.config.ts:12-14`
  solo admite `protocol: "https"` con el host de `NEXT_PUBLIC_SUPABASE_URL` y
  `pathname: "/storage/v1/object/public/**"`; con el emulador local (http, en
  `localhost`) el optimizador responde 400. El `remotePatterns` tiene que
  derivar el protocolo de la URL configurada y conservar la restricción de
  `pathname`. Es una condición del cuarto criterio, no una mejora.

**Promociones**

- **R24** — Una promoción pertenece a una tienda y se aplica solo a ella.
- **R25** — Una promoción está vigente cuando `active` y
  `startsAt <= ahora` y (`endsAt` es `null` o `endsAt > ahora`).
- **R26** — Varias promociones de alcance `PRODUCT` o `CATEGORY` sobre el mismo
  producto **no se acumulan**: gana la que deja el precio más bajo; empate por
  `startsAt` más antiguo y luego por `id` ascendente, para que el resultado sea
  determinista. Una de alcance `ORDER` se aplica una sola vez al subtotal y sí
  se combina con el descuento de línea.
- **R27** — `PERCENTAGE`: `0 < value <= 100`. `FIXED`: `value > 0`, expresada en
  `Business.baseCurrencyCode` y convertida con las tasas por
  `src/lib/money.ts`, porque `Promotion.value` no tiene columna de moneda
  (I4). Un descuento nunca deja el precio por debajo de 0.
- **R28** — El precio con promoción se calcula dentro de la lectura cacheada del
  catálogo. Un `startsAt` o un `endsAt` que cae dentro de una ventana de caché
  se ve con un retardo de hasta `STOREFRONT_REVALIDATE` (3600 s,
  `src/lib/cache.ts:32`). Es seguro y no es un bug: el checkout recalcula en
  caliente y el desajuste de precio ya responde 409 (F-010). Escribir una
  promoción revalida la tienda en el acto (R10).
- **R29** — En el pedido, el descuento va **dentro** del `unitPrice` cobrado.
  `Order.subtotal` sigue siendo la suma de los `lineTotal`, y
  `Order.discountTotal` lleva solo el descuento de alcance `ORDER`. Así
  `total = subtotal - discountTotal + deliveryFee` se mantiene y **no hay
  cambio en `docs/sync-contract.md`**, que ya publica las dos claves
  (`docs/sync-contract.md:280`). Ver I5 por lo que esto le cuesta al POS.
- **R30** — `Promotion.conditions` se valida con Zod, discriminado por `scope`:
  `PRODUCT` → `{ storeProductIds: string[] }` no vacío y todos de la tienda;
  `CATEGORY` → `{ localCategoryIds: string[] }`, ídem; `ORDER` →
  `{ minSubtotal?: string }` decimal `>= 0`. Un `conditions` que no valida es
  400, no una promoción que aplica a todo.

## Casos límite y errores

- **Sesión sin tiendas** (`storeIds: []`, que el SSO permite si el negocio no
  tiene locales publicados): el listado sale vacío con un texto que lo explica,
  no un error. Ninguna escritura pasa.
- **Sesión vencida a mitad de un formulario**: la escritura responde 401 y la
  pantalla lleva a volver a entrar. Nada a medias en la base.
- **Tienda del token que ya no existe en la base** (borrada entre dos inicios de
  sesión): el listado la omite; su página responde 404.
- **Dos pestañas guardando la misma tienda**: gana la última escritura, campo a
  campo. No hay bloqueo optimista y no se finge que lo haya.
- **Escritura del panel simultánea a un evento del sync sobre la misma fila**:
  no hay `$transaction` (el pooler corre en modo transacción, AGENTS.md), y los
  conjuntos de columnas son disjuntos (R8), así que el orden no importa. Lo que
  **sí** importa es que el `UPDATE` del panel enumere solo sus columnas: un
  `data` con una columna del sync la pisaría con un valor viejo leído antes.
- **`Store` no tiene guarda anti-rancio.** A diferencia del handler de producto,
  `src/features/sync/server/handlers/store.ts` aplica todo evento `STORE` sin
  comparar `updatedAt` contra nada, porque no existe `Store.sourceUpdatedAt`.
  Es la razón por la que el texto y el contacto del panel necesitan columnas
  propias y no «la última escritura gana» (I1).
- **Reintento de una subida de imagen**: el `uuid` de la ruta hace que el
  segundo intento cree otro objeto. Si la primera llamada subió el objeto y
  falló al escribir `imageUrls`, queda un huérfano en el bucket y ninguna URL
  rota: es el orden correcto de los dos pasos (subir, luego escribir).
- **`imageUrls` con una URL que no es del bucket** (fila vieja o manipulada):
  `next/image` responde 400 por `remotePatterns` y la tarjeta debe seguir
  mostrando el producto sin imagen, no romper la página.
- **Producto borrado suave** (`deletedAt` no nulo): el panel lo muestra marcado
  y no permite editarlo; el sync lo puede resucitar.
- **Promoción sobre un producto que después se borra suave**: la promoción
  sigue existiendo y simplemente no aplica a nada.
- **`endsAt <= startsAt`**: 400 al crear.
- **Promoción que descuenta más que el precio**: el precio efectivo se corta en
  0, nunca negativo (R27).
- **Emulador de Storage apagado**: el endpoint de subida responde 503 (E25) y el
  resto del panel funciona. El sensor no puede confundir «emulador apagado» con
  «criterio 4 fallido»: el mensaje del 503 lo dice.

## Datos y contrato

### Propiedad de campos de `Store`

De `prisma/schema.prisma:111-160` cruzado con
`src/features/sync/server/handlers/store.ts:44-88`.

| Campo                                                          | Dueño           | Qué pasa si el panel lo escribe                            |
| -------------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `name`, `address`, `city`, `province`, `latitude`, `longitude` | sync            | Se pierde en el siguiente evento `STORE`. Fuera de alcance |
| `description`, `phone`, `whatsapp`, `email`                    | sync            | Ídem. El panel escribe una columna de override (tanda 1b)  |
| `openingHours`                                                 | sync (si viene) | La clave se omite cuando el payload trae `null`. Fuera     |
| `status`, `publishedAt`                                        | sync            | Se pierde. HD2 lo prohíbe explícitamente                   |
| `slug`                                                         | sync (al crear) | Rompe URLs e ISR. Fuera                                    |
| `themeTokens`, `logoUrl`, `coverUrl`                           | **panel**       | El handler no las menciona: sobreviven                     |
| `checkoutMode`, `deliveryEnabled`, `deliveryFee`               | panel           | Sobreviven, pero editarlas está fuera de alcance           |
| `businessId`, `externalId`, `createdAt`, `updatedAt`           | plataforma      | —                                                          |

### Propiedad de campos de `StoreProduct`

`prisma/schema.prisma:258-276` ya separa los dos bloques y
`src/features/sync/server/handlers/product.ts:83-86` lo respeta.

| Campo                                                                                                                            | Dueño      |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `localName`, `syncedPrice`, `syncedPriceCurrency`, `availability`, `localCategoryId`, `sourceUpdatedAt`, `syncedAt`, `deletedAt` | sync       |
| `description`, `imageUrls`, `priceOverride`, `priceOverrideCurrency`, `visible`, `featured`                                      | **panel**  |
| `id`, `storeId`, `canonicalProductId`, `externalId`, `slug`                                                                      | plataforma |

### Migración de la tanda 1b

Aditiva, cuatro columnas nullables en `Store`, sin reescribir filas y sin
ninguno de los dos comandos prohibidos por AGENTS.md:
`descriptionOverride`, `phoneOverride`, `whatsappOverride` y `emailOverride`,
las cuatro `String?`. La precedencia (`override ?? sincronizado`)
se implementa **una sola vez** y la usan los tres sitios que hoy leen esas
columnas: `src/features/catalog/server/queries.ts:43-65`,
`src/features/orders/server/quote.ts:92` y
`src/features/orders/server/read.ts:92`. `StoreSummary` no cambia de forma, para
no duplicar interfaces entre la capa de datos y la vista (AGENTS.md).

### Formatos

- Dinero: `Decimal(14,2)`, en cadena, nunca `Float`. Moneda explícita siempre.
- Porcentaje de promoción: `Decimal(14,2)`, 0 exclusive – 100 inclusive.
- Fechas: ISO 8601 con desplazamiento, en UTC en la base. El panel no evalúa
  horarios locales (no hay `Store.timezone`).
- Imágenes: mime detectado por contenido, 5 MB, 8 por producto (R20).
- URL pública de Storage:
  `<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/<bucket>/<ruta>`.

### Contrato con cuadrecaja

Nada de este feature cambia `docs/sync-contract.md`. La invariante del panel ya
está escrita allí (`docs/sync-contract.md:211`) y R29 evita tocar el formato del
pull de pedidos. Si el humano prefiere que el POS vea el descuento desglosado,
eso sí es una versión nueva del contrato y se coordina con el otro equipo
(I5).

## Criterios de aceptación propuestos

Los cinco `[ya]` son los de `.agent/features.json` **literales** (regla 3).
Debajo de cada uno, la tanda y con qué se comprueba. El entorno base para todos:
`docker compose up -d`, `npm run db:migrate`, `npm run seed`, `npm run build`,
`npx next start`, y una cookie de sesión obtenida con
`node scripts/mint-sso-token.mjs`.

1. `[ya]` **«Un admin solo ve y edita las tiendas presentes en storeIds de su
   sesión.»** → **tanda 1**. `scripts/mint-sso-token.mjs` firma hoy las dos
   tiendas del seed (`scripts/mint-sso-token.mjs:27`), así que no existe una
   «tienda ajena» contra la que probar: el script necesita una bandera para
   firmar un subconjunto (por ejemplo una sola tienda). Con ella: abrir la URL
   del token guardando la cookie, y `curl -s -b <cookie> <listado del panel>`
   contiene `tienda-demo` y **no** contiene `tienda-dos`. Más un test del
   proyecto `node` sobre la consulta del listado: con `storeIds = [A]` devuelve
   una fila, con `storeIds = []` devuelve cero, y nunca filtra por `businessId`
   en lugar de por la sesión.
2. `[ya]` **«Intentar editar una tienda ajena responde 403.»** → **tanda 1**.
   `curl -s -o /dev/null -w '%{http_code}'` con la cookie del token de una sola
   tienda, `PATCH` del branding de la otra tienda del seed → `403`, y el cuerpo
   es `{"error":"FORBIDDEN"}`. Después, un `SELECT` de `themeTokens` sobre la fila
   de `tienda-dos` devuelve lo que ya tenía. La misma petición **sin**
   cookie → `401`. La misma petición sobre la tienda propia → `200`, para que el
   403 no sea un falso positivo por otro motivo (ruta mal escrita, cuerpo
   inválido).
3. `[ya]` **«Editar description, imageUrls, priceOverride, visible o featured no
   se pierde tras un product.update del sync.»** → **tanda 2**. Fijar los cinco
   campos por el endpoint del panel; `node scripts/send-catalog-batch.mjs`
   (manda `price: 499` sobre `seed-tienda-1-p0`); comprobar en la base que
   `syncedPrice` cambió a `499.00` y que los seis campos del panel
   —los cinco del criterio más `priceOverrideCurrency`— quedaron intactos. Más
   un test del proyecto `node` sobre `handleProduct` que lo fije: hoy la
   invariante solo está escrita en un comentario
   (`src/features/sync/server/handlers/product.ts:83-86`) y **no** tiene ninguna
   prueba (`find src/features/sync -name "*.test.ts"` solo lista
   `src/features/sync/server/inbox.test.ts`).
4. `[ya]` **«Subir una imagen la almacena en Supabase Storage y la sirve por
   next/image.»** → **tanda 2**. Con el emulador de HD1 levantado por
   `docker compose up -d`: `curl -F` de un JPEG al endpoint de subida → `201` y
   una URL `.../storage/v1/object/public/store-media/stores/...`; `curl -sI` de
   esa URL directa al emulador → `200`; `SELECT "imageUrls"` la contiene;
   `curl -s http://localhost:3000/tienda-demo` trae un `src` con
   `/_next/image?url=`, y `curl -sI` de esa URL de `/_next/image` responde `200`
   con `content-type: image/avif` o `image/webp` — que es lo que demuestra que
   `next.config.ts` acepta el host del emulador (R23) y no un 400 de
   `remotePatterns`.
5. `[ya]` **«Guardar branding inválido es rechazado por themeTokensSchema y no
   llega a la base.»** → **tanda 1**. Tres cuerpos: `{"brand":"no-es-un-color
#"}`, `{"radius":"gigante"}` y `{"background":"#fff"}` (clave desconocida,
   que `.strict()` rechaza) → los tres `400` con los problemas de Zod, y
   un `SELECT` de `themeTokens` sobre la fila de `tienda-demo` sigue igual después
   de los tres. Luego `{"brand":"#0f62fe","radius":"soft"}` → `200`, y
   `curl -s http://localhost:3000/tienda-demo | grep -c -- "--color-brand:#0f62fe"`
   ≥ 1 **sin** esperar el piso de ISR, lo que además comprueba R10. Más un test
   del proyecto `node` sobre el esquema de la petición.

Propuestos al humano, porque cubren lo que los cinco dejan fuera:

6. `[nuevo]` La página de edición de una tienda ajena responde 404 y su nombre
   no aparece en el cuerpo de la respuesta (R7).
7. `[nuevo]` Un grep de `status` y `publishedAt` sobre el módulo de escritura del
   panel no encuentra ninguna de las dos columnas dentro de un `data` de Prisma
   (HD2). Y tras un guardado del panel, `SELECT status, "publishedAt"` de esa
   tienda no cambió.
8. `[nuevo]` Un `priceOverride` guardado desde el panel deja
   `priceOverrideCurrency` igual al `syncedPriceCurrency` del producto, no
   `null` (R14); quitarlo pone las dos a `null` y la vitrina vuelve al precio
   sincronizado.
9. `[nuevo]` Quitar el branding escribe `{}` y la respuesta pública de
   `/tienda-dos` deja de traer la etiqueta `<style>` (R11).
10. `[nuevo]` Una subida de 6 MB, una de `text/plain` renombrado a `.jpg` y una
    novena imagen responden `400`, `400` y `409`, y en los tres casos
    `SELECT "imageUrls"` no cambió (E22, E23).
11. `[nuevo]` Con el contenedor de Storage detenido, la subida responde `503` y
    `imageUrls` no cambia (E25).
12. `[nuevo]` Una escritura del panel sobre la tienda A no invalida la caché de
    la tienda B: tras guardar en A, la respuesta de `/tienda-dos` conserva su
    cabecera de caché y su contenido.
13. `[nuevo]` `npm run check:theme` termina en 0 después de guardar branding por
    el panel: el editor no puede reintroducir los dos fallos que arregló F-016.
14. `[nuevo]` `npx prisma migrate status` reporta la migración de la tanda 1b
    como aplicada, `npx prisma validate` termina en 0 y
    `git grep -n "migrate reset\|db push"` no encuentra ninguno en lo añadido.
15. `[nuevo]` `bash .agent/verify.sh F-011 --full` termina en 0 en cada tanda,
    y `npm run check:bundle` sigue en 0: el panel es contenido autenticado y no
    debe empujar el presupuesto de JavaScript de la tienda pública.

### Requisitos de promociones (HD3)

No son criterios de aceptación y **no cuentan casillas para cerrar F-011**: la
regla 3 impide añadirlos a `.agent/features.json`. Se verifican igual y se
documentan en `tests.md`. Si el humano quiere que cuenten, es un feature nuevo
en el backlog (regla 4), que este documento no crea.

- **P1** — Crear, editar, activar, desactivar y borrar promociones de una tienda
  desde el panel; la de otra tienda responde 403 (E33).
- **P2** — `PERCENTAGE` con `value` fuera de `(0, 100]` → 400. `FIXED` con
  `value <= 0` → 400. `endsAt <= startsAt` → 400 (R27).
- **P3** — `conditions` validado por `scope` (R30); ids de otra tienda → 400.
- **P4** — Una promoción vigente del 20 % sobre un producto de `500` hace que
  `/tienda-demo` muestre `400` y el precio anterior tachado (E27).
- **P5** — Fuera de ventana o `active: false`, el precio mostrado es el de
  siempre (E29).
- **P6** — El descuento se aplica sobre `priceOverride` cuando existe (E30).
- **P7** — Dos promociones aplicables dejan un solo descuento, el mayor, con
  desempate determinista (E31, R26).
- **P8** — Confirmar el pedido guarda `OrderItem.unitPrice` con el descuento
  aplicado y el total cuadra con la pantalla (E28, R29).
- **P9** — Una promoción `ORDER` con `minSubtotal` escribe `discountTotal` y
  mantiene `total = subtotal - discountTotal + deliveryFee` (E32).
- **P10** — `GET /api/internal/orders` sigue devolviendo las mismas claves con
  el mismo significado que la v2 del contrato: R29 no cambia el formato.
- **P11** — Cambiar o borrar la promoción después no altera los importes de un
  pedido ya creado (E34).
- **P12** — Escribir una promoción revalida la tienda (R10); un borde de ventana
  se ve con hasta 3600 s de retardo y eso queda anotado, no arreglado (R28).

## Incongruencias detectadas

- **I1 — HD4 pone «contacto y descripción» en la tanda 1 y el sync es dueño de
  esas cuatro columnas. Resuelta aquí sin preguntar.**
  `src/features/sync/server/handlers/store.ts:44-58` escribe `description`,
  `phone`, `whatsapp` y `email` en **todo** evento `STORE`, y a diferencia del
  handler de producto no tiene guarda anti-rancio porque `Store` no tiene
  `sourceUpdatedAt`: una edición del panel sobre esas columnas se pierde al
  siguiente evento del POS, que es exactamente el argumento con el que HD2 sacó
  `status` del panel. Pero HD2 también dice, literalmente, «El panel edita
  branding, contacto y contenido», y HD2 dice que el sync se queda como está.
  El único mecanismo que satisface las tres cosas es el de ADR 0007 aplicado a
  la tienda: columnas de override propiedad del panel, precedencia
  `override ?? sincronizado` encapsulada en un solo módulo, handler intacto.
  Eso es la tanda 1b, con migración aditiva y una ADR nueva (I6). **Es la única
  parte de la tanda 1 que ningún criterio cubre**: si el humano prefiere dejar
  contacto y descripción en modo lectura, se cae la tanda 1b entera —las cuatro
  columnas, E10–E13, R13 en su parte de tienda y la migración— y el resto de la
  tanda 1 no se toca. El plan de la tanda 1 es el punto donde se firma o se
  recorta.
- **I2 — La descripción del feature promete «publicar tienda» y el panel no lo
  hará.** `.agent/features.json`, F-011: «Panel de administración: publicar
  tienda, branding, …». HD2 lo prohíbe. No hay contradicción con ningún
  `acceptance_criteria` (ninguno de los cinco menciona publicar), así que no
  hace falta tocar nada del backlog; queda escrito para que nadie lo lea como
  alcance olvidado. Quien retome esto: la publicación se hace en Cuadre de Caja
  con `publishToStore`.
- **I3 — `productTag` está muerto: revalidar un producto no invalida ninguna
  lectura.** `src/lib/cache.ts:22` lo define y
  `src/lib/cache.ts:72-78` lo dispara, pero ninguna lectura lo declara: la
  ficha de producto lee `getStoreCatalog`, cuyo tag es
  `storeCatalogTag` (`src/features/catalog/server/queries.ts:128-133`, y
  `src/app/[slug]/p/[productSlug]/page.tsx` lo consume). Por eso R10 exige
  `revalidateStores` en toda escritura del panel: un panel que solo llamara a
  `revalidateProducts` dejaría la vitrina vieja hasta una hora, y es el fallo
  más difícil de notar de este repo. Arreglar el tag muerto no es de F-011,
  pero confiar en él sí sería un fallo de F-011.
- **I4 — `Promotion.value` no tiene moneda.**
  `prisma/schema.prisma:327` es `Decimal(14,2)` a secas, y una tienda puede
  tener productos en varias monedas (es la razón de existir de
  `displayPrice`). Resuelto por convención en R27 —`FIXED` se interpreta en
  `Business.baseCurrencyCode`— sin columna nueva. Si el arquitecto prefiere una
  columna, la migración es aditiva y R27 se cae; lo que no se acepta es dejarlo
  implícito.
- **I5 — Con promociones, el POS ve un precio más bajo y ninguna explicación.**
  R29 mete el descuento en `unitPrice` para no cambiar el contrato, que ya
  publica `subtotal` y `discountTotal` (`docs/sync-contract.md:280`) y cuya v2
  todavía no le fue avisada al equipo de cuadrecaja (nota de F-010 en
  `.agent/features.json`). La alternativa —`subtotal` sin descontar más un
  desglose por línea— es una v3 del contrato coordinada con el otro equipo, que
  AGENTS.md § Documentación no deja tomar de pasada. Se elige no cambiarlo; si
  el POS necesita el desglose, es un feature de contrato, no un ajuste de este.
- **I6 — Dos decisiones estructurales piden ADR.** AGENTS.md § Documentación:
  (a) los overrides de tienda de la tanda 1b, que extienden ADR 0007 de
  producto a tienda; (b) la propiedad de `status` del sync frente al panel
  (HD2), que hoy solo vive en el progreso del feature. La numera y la escribe
  `sdd-architect`; el siguiente número libre en `docs/adr/` es el 0017.
- **I7 — El seed no tiene ninguna tienda ajena al token, así que los criterios 1
  y 2 no se pueden verificar hoy.** `prisma/seed.ts:268-303` crea dos tiendas y
  `scripts/mint-sso-token.mjs:27` firma las dos. Sin una bandera que firme un
  subconjunto, el 403 del criterio 2 no se puede provocar. Es fixture, no
  producto: lo resuelve quien implemente, y sale en los criterios 1 y 2.
- **I8 — `SUPABASE_SERVICE_ROLE_KEY` es opcional en el entorno.**
  `src/lib/env.ts:14` la declara `optional()`, y con el `.env` de este worktree
  apuntando a `https://placeholder.supabase.co` una subida fallaría con un error
  de red sin explicación. R18 lo convierte en un 503 con motivo, en lugar de
  volver la variable obligatoria: hacerla obligatoria rompería `serverEnv()`
  para todo el resto de la aplicación, que no necesita Storage.

## No decidido a propósito

- **Qué imagen de docker sirve el emulador de Storage y cómo se siembra el
  bucket.** Lo cierra `sdd-architect` en `docker-compose.yml` y en el arranque
  del entorno. Lo que la spec exige es observable: bucket público, URL con la
  forma de R21 y `next/image` sirviéndola (criterio 4).
- **Si la URL del panel identifica la tienda por `id` o por `slug`.** Da igual
  para el comportamiento: la autorización compara siempre el `id` interno (R3).
  Decide `sdd-architect`.
- **El transporte del formulario** (POST de formulario contra el route handler,
  o isla de cliente con `fetch`). R5 solo exige que la escritura sea un route
  handler y que el 403 sea comprobable con `curl`. Decide `sdd-designer` con
  `sdd-architect`.
- **La forma exacta de las pantallas**, el microcopy y qué primitivos de
  `src/components/ui/` alcanzan: `src/components/ui/Field.tsx`,
  `src/components/ui/Button.tsx` y `src/components/ui/Alert.tsx` ya existen.
  Es `design.md`.
- **Recolección de objetos huérfanos en el bucket** (R22) y **cron de
  revalidación en bordes de promoción** (R28): quedan anotados como deuda
  conocida, para el humano y el backlog, no para este ciclo.

---

# Tanda 3 — el criterio 5 sobre `Storefront`

**Capítulo añadido el 2026-08-28.** Cubre **un solo** `acceptance_criteria`, el
quinto:

> «Guardar branding inválido es rechazado por themeTokensSchema y no llega a la
> base.»

**Qué no toca este capítulo.** Los criterios 1–4 están verificados ejecutando y
fusionados a `main`; la regla 3 los reserva y la regla 4 reserva el backlog. No
se reescribe ni se reinterpreta nada de arriba, ni se cambia `passes` en
`.agent/features.json`: eso lo decide el humano al cerrar el ciclo.

**Numeración.** Continúa la del ciclo 1 para que dos números iguales no
signifiquen dos cosas: escenarios **E35+**, reglas **R31+**, criterios propuestos
**16+**, incongruencias **I9+**. Las decisiones del humano de este ciclo son
**HD16–HD19** y siguen la serie HD1–HD15 del progreso.

**Estado: sin preguntas abiertas.** Las cuatro que bloqueaban el plan —quién puede
editar el branding de una marca con varias sucursales, si entraba el contacto, cómo
se consigue la fixture de dos sucursales y si entraban logo y portada— las contestó
el humano el 2026-08-28 y están incorporadas abajo, en § Respuestas del humano y en
cada regla y escenario que cambian.

## Por qué se reabre, en una frase

HD6 congeló el editor de branding porque la ADR 0012 iba a mover `themeTokens` de
`Store` a `Storefront` y construirlo antes habría sido trabajo tirado. `Storefront`
ya existe: F-017 está en `passes: true`, y la migración de ADR 0018 **borró**
`Store.themeTokens`. El bloqueo desapareció y con él la excusa; lo que queda es
que el dato cambió de dueño y el diseño congelado no lo sabe.

## Lo que hoy es verdad en el código (leído, no supuesto)

| Hecho                                                                                             | Dónde se comprueba                                                                                 |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Store.themeTokens` **ya no existe**; la columna es `Storefront.themeTokens Json?`                | `prisma/schema.prisma:142`; ADR 0018 § Consecuencias («Tres columnas de `Store` se borran»)        |
| `themeTokensSchema` **no cambió**: cinco claves, todas opcionales, `.strict()`                    | `src/features/theming/storeTheme.ts:17-25`                                                         |
| `themeTokens` se lee en **dos** funciones cacheadas distintas, con **dos** tags                   | `src/features/catalog/server/queries.ts:129` (`storeTag`) y `:171` (`storefrontTag`)               |
| El `<style>` lo emite el layout en dos ramas: selector de marca y página de sucursal              | `src/app/[slug]/layout.tsx:29` y `:58`                                                             |
| El embudo de escritura y su `commit()` revalidan **un solo** `PublicSlug`                         | `src/features/admin/server/mutations.ts:67-71`                                                     |
| Hay lista blanca de columnas para `StoreProduct`, `Store` y `Promotion`, **no** para `Storefront` | `src/features/admin/server/mutations.ts:42-54`                                                     |
| La sesión del panel solo sabe autorizar **tiendas** (`storeIds`), nunca marcas                    | `src/features/admin/authorization.ts:27-31`, `src/app/api/admin/_lib/guard.ts:15-23`               |
| Ya hay precedente de una escritura de sucursal que revalida más de lo que escribe                 | `src/features/admin/server/mutations.ts:249-255` (`setStoreEnabled`)                               |
| El panel ya enseña las hermanas de la marca, con nombre y ciudad y **sin** `storeId`              | `src/features/admin/server/stores.ts:230-255`, `src/features/admin/components/StoreBrandCard.tsx`  |
| `Storefront.contactPhone/Whatsapp/Email` se **leen** y no las escribe nadie                       | `src/features/catalog/server/queries.ts:103-119`, `src/lib/storeContact.ts`; `grep` sin escritores |
| El seed guarda hoy valores `oklch(...)` en una marca                                              | `prisma/seed.ts:331` (`tienda-dos`)                                                                |
| **Ninguna marca del seed tiene dos sucursales**; solo agrupar las crea, y no tiene vuelta         | `prisma/seed.ts:361-417`; ADR 0018 § decisión (f)                                                  |

## Alcance de la tanda 3

### Dentro

- Un editor de branding del panel que escribe **`Storefront.themeTokens`** y solo
  esa columna: los cinco tokens de `themeTokensSchema`.
- Su endpoint de escritura bajo `/api/admin/`, dentro del embudo único que ya
  existe (`src/features/admin/server/mutations.ts`), con su propia lista blanca.
- **La autorización por cobertura total de la marca** (HD16, R42): solo escribe
  quien administra **todas** las sucursales renderizables; a quien le falte una, 403.
- El rechazo del branding inválido con el **mismo** `themeTokensSchema` que
  renderiza el tema, y la garantía observable de que nada inválido se persiste.
- La revalidación completa de lo que un guardado de marca cambia de significado:
  **cada** sucursal renderizable de la marca **más** la marca.
- **Una fixture de marca ya agrupada** en `prisma/seed.ts` (HD18), sin la cual R36
  y R42 no se pueden verificar dos veces seguidas.
- La sección de branding en `.agent/specs/F-011/smoke.sh`, para que el criterio 5
  entre en el sensor repetible y no en una comprobación manual.

### Fuera (explícito)

- **`Storefront.slug`.** Lo gobierna el registro de slugs (ADR 0018 (a)) y
  cambiarlo es proponer un valor, con su rechazo tipado (ADR 0018 (d)). Es su
  propio feature.
- **`Storefront.name`.** Nace del sync al crear la marca; renombrarla no lo pide
  ningún criterio.
- **El contacto de la marca** (`contactPhone`, `contactWhatsapp`,
  `contactEmail`). **HD17**: fuera de esta tanda, anotado como deuda para otro
  ciclo. Ver I15.
- **`Storefront.logoUrl` y `coverUrl`.** **HD19**: fuera de esta tanda; F-023 va a
  cambiar cómo se almacenan y se sirven las imágenes. Ver I15.
- **Agrupar sucursales desde el panel para conseguir la cobertura de R42.** Ya
  existe (F-017) y no es de esta tanda; lo único que esta tanda añade a `prisma/`
  es la fixture de HD18.
- **Agrupar y desagrupar sucursales.** Agrupar ya está construido (F-017);
  desagrupar no existe a propósito (ADR 0018 (f)).
- **Validación de contraste.** HD8 y DP4(a) ya la descartaron: un branding
  ilegible se puede guardar, con aviso en la maqueta. Sigue siendo deuda.
- **Publicar, cerrar y abrir al público.** Es de la sucursal y ya está construido
  (HD10–HD15). `Storefront` no tiene `status` a propósito (ADR 0018 (e)).
- **Los criterios 1–4 y sus escenarios.** Verificados y cerrados.

## Actores y precondiciones

El mismo actor del ciclo 1 —el administrador de un negocio, con la cookie de
F-008— y una precondición nueva que no existía:

- La tienda que el admin abre en el panel pertenece a una **marca**
  (`Store.storefrontId` es obligatorio, `prisma/schema.prisma:184`), y esa marca
  puede tener sucursales que **no** están en `session.storeIds`. El panel ya
  sabe enseñarlas sin dar acceso a ellas.
- **Precondición nueva de HD16**: para escribir el branding, `session.storeIds`
  tiene que contener **todas** las sucursales renderizables de esa marca
  (`status != DRAFT`). Con una sola sucursal —el caso de casi todo el seed y de
  casi todos los negocios— la precondición se cumple sola y el admin no nota que
  existe.
- No hay actor nuevo: el sync no escribe ninguna columna de `Storefront` salvo al
  crear la fila la primera vez (ADR 0018 (e)), así que en esta tabla **no hay
  columna compartida** y no existe el conflicto «gana el último» que obligó a las
  columnas de override del ciclo 1.

## Comportamiento esperado

- **E35** — Dado un admin que gestiona la única sucursal de una marca, cuando
  guarda `{"brand":"#0f62fe","radius":"soft"}`, entonces responde 200,
  `Storefront.themeTokens` queda con **exactamente** esas dos claves, y la
  siguiente petición pública a `/<slug de la marca>` trae
  `--color-brand:#0f62fe` **sin** esperar el piso de ISR.
- **E36** — Dado un branding inválido —un color que no pasa el regex, un `radius`
  fuera del enum, o una clave desconocida como `background`—, entonces responde
  **400** con los problemas de Zod y `Storefront.themeTokens` queda **idéntica** a
  como estaba. _Este es el criterio 5._
- **E37** — Dada una clave desconocida, el rechazo lo produce el `.strict()` del
  esquema y **no** un guardado que la ignora en silencio: guardar y descartar
  claves sería un 200 que incumple el criterio.
- **E38** — Dado un branding que el admin quita, entonces se escribe `{}` y no
  `null`, y la página pública deja de traer la etiqueta `<style>`.
- **E39** — Dada una marca con **dos** sucursales renderizables, cuando se guarda
  el branding, entonces en la siguiente petición cambian **las dos** páginas de
  sucursal **y** la página del selector de la marca, sin esperar el piso de ISR.
  Es el escenario que el ciclo 1 no podía ni escribir.
- **E40** — Dada esa misma marca, y un admin cuya sesión solo trae **una** de las
  dos sucursales, cuando intenta guardar el branding, entonces responde **403**
  `{"error":"FORBIDDEN"}` y `Storefront.themeTokens` queda **exactamente** como
  estaba: ni una escritura parcial, ni un guardado con aviso, ni un 200 que
  cambie solo lo suyo (HD16). El branding no se puede repartir por sucursal: es
  una columna de la marca, así que o se autoriza entera o no se autoriza.
- **E40b** — Dado ese mismo admin, cuando abre el panel de la sucursal que sí
  administra, entonces la pantalla del branding **se ve y explica por qué no
  puede editarla**, nombrando las sucursales que le faltan —el panel ya sabe
  listarlas con nombre y ciudad y sin `storeId`
  (`src/features/admin/server/stores.ts:230-255`)—. No es un 404 ni una tarjeta
  que desaparece: la tienda sí es suya, lo que no cubre es la marca entera.
- **E41** — Dada una petición de escritura sin cookie, entonces **401**; dada una
  sobre una tienda fuera de la sesión, entonces **403** y ninguna columna cambia.
  El 403 sale del mismo mapeo que el criterio 2 ya verificado, y es el **mismo**
  cuerpo que devuelve el 403 de cobertura de E40: dos motivos distintos, una sola
  respuesta, para no filtrar por HTTP cuántas sucursales tiene una marca ajena.
- **E42** — Dadas dos pestañas guardando el branding de la misma marca, gana la
  última escritura completa (semántica de reemplazo, R33). No hay bloqueo
  optimista y no se finge que lo haya. Contra el sync no hay carrera posible: no
  comparten ninguna columna de esta tabla.
- **E43** — Dado un valor `oklch(0.62 0.17 145)` guardado, entonces se conserva
  tal cual y no se normaliza a `#rrggbb`: es lo que hay hoy en la base
  (`prisma/seed.ts:331`) y convertirlo cambiaría el color de una tienda viva.
- **E44** — Dado un guardado correcto desde el panel, entonces `npm run check:theme`
  sigue terminando en 0: el editor no puede reintroducir los dos fallos que
  arregló F-016 (`@theme inline` y `rounded-[--radius-lg]`).
- **E45** — Dado un `themeTokens` inválido que ya estuviera en la base,
  `renderStoreTheme` lo descarta en silencio y devuelve cadena vacía
  (`src/features/theming/storeTheme.ts:49-50`): la tienda se queda sin tema y
  nadie se entera. Por eso «no llega a la base» es la **única** defensa
  observable, y no una comprobación redundante con el render.

## Reglas de negocio

**Propiedad y forma del dato**

- **R31** — El branding es de la **marca**. La única columna que esta tanda
  escribe es `Storefront.themeTokens`. `Store` no tiene esa columna y no vuelve a
  tenerla.
- **R32** — El cuerpo de la petición **es** el objeto de tokens, sin envoltorio, y
  se valida con el `themeTokensSchema` **importado** de
  `src/features/theming/storeTheme.ts`. Dos motivos, y los dos son el criterio
  literal: una copia del esquema en el panel dejaría de ser «rechazado por
  themeTokensSchema» el día que una de las dos cambie, y un envoltorio
  (`{"themeTokens":{…}}`) haría que `{"background":"#fff"}` se rechazara por
  clave desconocida **del envoltorio** y no por el `.strict()` del esquema.
- **R33** — Se guarda `parsed.data`, nunca el cuerpo recibido, y la semántica es
  de **reemplazo**: lo que no viene, desaparece.
- **R34** — Quitar el branding escribe `{}`, nunca `null`. Prisma rechaza un
  `null` plano en una columna `Json?`; es la misma trampa que ya documenta
  `src/features/sync/server/handlers/store.ts`.
- **R35** — La escritura entra por `src/features/admin/server/mutations.ts` con su
  propia lista blanca de columnas —`themeTokens` y nada más— y se expone como un
  route handler bajo `/api/admin/`. No una server action (R5 sigue vigente: el
  403 tiene que ser un código HTTP que `curl` vea).

**Revalidación**

- **R36** — Un guardado de branding revalida el tag de **cada** sucursal
  renderizable de la marca (`storeTag` de su slug canónico) **y** el de la marca
  (`storefrontTag`). Revalidar solo la sucursal desde la que se entró deja las
  hermanas y el selector con el color viejo hasta el piso de ISR de 3600 s.
- **R37** — El conjunto de slugs a revalidar **no se arma a mano**. AGENTS.md §
  Prohibiciones lo prohíbe literalmente y la ficha
  `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
  ya fichó el mismo defecto tres veces. Dónde vive exactamente esa proyección lo
  decide `sdd-architect`; ver I12.
- **R38** — Las lecturas del panel siguen sin pasar por `cached()` (R9): el admin
  tiene que ver lo que acaba de guardar.

**Producto**

- **R39** — No se valida contraste (HD8, DP4(a)). La maqueta avisa; el guardado no
  bloquea.
- **R40** — El panel **no** se viste con la marca de la tienda. Los tokens de una
  marca solo se aplican dentro del contenedor de la maqueta.
- **R41** — El editor no ofrece CSS libre ni claves fuera del esquema (R12 sigue).
  Los cinco tokens son los que hay.

**Autorización (HD16)**

- **R42** — Escribir el branding de una marca exige que `session.storeIds`
  contenga **todas** sus sucursales renderizables (`status != DRAFT`). Si falta
  una sola, **403**, sin escritura y sin escritura parcial. R1–R4 del ciclo 1
  siguen vigentes tal cual: esto las estrecha para esta columna, no las sustituye.
- **R43** — Esa comprobación **no la puede hacer la sesión sola**. El guard de hoy
  decide con 0 queries (`src/app/api/admin/_lib/guard.ts:15-23`) porque el
  `storeId` viene en la URL; la cobertura de una marca exige leer su lista de
  sucursales. Consecuencia que `sdd-architect` tiene que resolver a propósito: el
  camino del branding lleva **una lectura antes de autorizar**, y es la misma que
  R36 necesita después para saber qué revalidar. Una consulta sirve para las dos
  cosas; dos serían dos verdades que pueden divergir.
- **R44** — El 403 de cobertura y el 403 de tienda ajena tienen el **mismo**
  cuerpo, `{"error":"FORBIDDEN"}`. Un código o un motivo distinto le contaría a
  quien no debe cuántas sucursales tiene una marca que no administra.
- **R45** — La pantalla sí distingue los dos casos, porque quien la ve ya
  administra esa tienda: con cobertura incompleta el editor aparece **bloqueado y
  con el motivo**, nombrando las sucursales que faltan (E40b). Un formulario que
  se rellena para acabar en 403 es peor que un formulario que no se puede
  rellenar.
- **R46** — La cobertura se evalúa **en el momento de la escritura**. Si entre el
  render de la pantalla y el guardado la marca gana una sucursal que el admin no
  administra, el guardado responde 403; si la pierde, responde 200. No hay bloqueo
  optimista, igual que en el resto del panel (E42).

## Casos límite y errores

- **Marca con una sola sucursal**: el slug canónico de la sucursal **es** el de la
  marca (`src/lib/publicSlug.ts`), así que revalidar «todas las sucursales más la
  marca» produce el mismo string dos veces. Es correcto y `revalidateStores`
  deduplica (`src/lib/cache.ts:87`).
- **Marca con una sucursal que además conserva un alias vivo** (`bodega-central`
  y `bodega-central-vedado` en el seed): las dos URL comparten entrada de caché
  por el slug canónico (ADR 0018 (c)), así que no hay una segunda entrada que
  revalidar. Si el árbol de tags cambia, esto se cae: es un caso a probar, no a
  suponer.
- **Sucursal en `DRAFT`**: no renderiza en público, así que **ni cuenta para la
  cobertura de R42 ni entra en el conjunto a revalidar de R36**. Es el mismo
  filtro `status: { not: "DRAFT" }` que ya usan todas las lecturas del repo
  (`src/features/admin/server/stores.ts:24`), y usar dos definiciones distintas de
  «sucursal de la marca» en las dos mitades del mismo endpoint sería el bug más
  difícil de ver de esta tanda.
- **Sucursal `SUSPENDED`** (cerrada al público desde el panel o por el POS):
  **sí** cuenta para las dos cosas. Sigue teniendo página —200 con el aviso de
  cierre, HD11— y esa página lleva el tema de la marca.
- **Cobertura incompleta con la sucursal que falta en `DRAFT`**: la cobertura se
  cumple, porque esa sucursal no renderiza. Es coherente con la regla y hay que
  probarlo, no suponerlo.
- **Marca sin ninguna sucursal renderizable**: el guardado tiene que responder 200
  igual —el branding es del dato, no de la vitrina— y no fallar al no encontrar
  ningún slug que revalidar.
- **Guardar el mismo branding dos veces**: idempotente, mismo 200, misma fila.
- **Cuerpo vacío `{}`**: es válido y significa «sin branding» (E38). No es un 400.
- **Cuerpo que no es un objeto** (`[]`, `"azul"`, `null`): 400, no un 500.
- **Sesión vencida a mitad del formulario**: 401 y nada a medias en la base.
- **La marca desaparece entre el guard y la escritura**: 404, como ya hace
  `setStoreEnabled` con `P2025` (`src/features/admin/server/mutations.ts:267-270`).
- **Un `themeTokens` inválido ya persistido** (no lo puede crear este endpoint,
  pero sí una escritura anterior o manual): la tienda se sirve sin tema y sin
  error (E45). No se arregla en esta tanda; se anota.

## Datos y contrato

**Columna.** `Storefront.themeTokens`, `Json?` (`prisma/schema.prisma:142`).
Valores: los cinco de `themeTokensSchema` —`brand`, `brandContrast`, `accent`,
`accentContrast` como color CSS de hasta 64 caracteres, y `radius` en
`sharp|soft|round`—, todos opcionales, sin claves adicionales.

**Sin migración.** La columna ya existe y la creó F-017. Esta tanda **no toca
`prisma/schema.prisma` ni añade ninguna migración**, y ninguno de los dos comandos
prohibidos por AGENTS.md entra en el horizonte. Lo único que toca de `prisma/` es
`prisma/seed.ts`, por la fixture de HD18.

**Sin cambio de contrato.** `Storefront` es propio de queandabuscando y el POS no
lo conoce (ADR 0018 § Consecuencias). `docs/sync-contract.md` no cambia y no hay
v4. La v3 sigue escrita y **sin enviar**, que es deuda del humano y no de esta
tanda.

**Fixtures que hacen falta antes de verificar nada:**

1. Una cookie acotada a una sola tienda:
   `node scripts/mint-sso-token.mjs --stores=seed-tienda-1`
   (`scripts/mint-sso-token.mjs:18-22`).
2. **Una marca con dos sucursales, sembrada ya agrupada** (HD18), para E39, E40 y
   R42. No se consigue agrupando dentro del sensor: agrupar no tiene vuelta (ADR
   0018 (f)), así que un `smoke.sh` que agrupara solo funcionaría la primera vez
   después de cada `npm run seed`. La fixture se escribe en `prisma/seed.ts` con
   el mismo patrón con que el ciclo 2 añadió `tienda-cerrada`: **de un solo uso,
   sin que ningún otro feature la lea**, para no romper F-004, F-006, F-010 ni
   `check:bundle`. Las dos fixtures de agrupar que ya existen (`bodega-uno` y
   `bodega-dos`, `prisma/seed.ts:385-417`) son de F-017 y **no se tocan**: siguen
   sirviendo para verificar la acción de agrupar, que es otra cosa.
3. **Dos cookies sobre esa marca nueva**: una con las dos sucursales (camino
   feliz, E39) y otra con una sola (el 403 de E40), las dos con la bandera
   `--stores=` de `scripts/mint-sso-token.mjs`.
4. `tienda-dos` como fixture de E43: ya guarda `oklch(...)` (`prisma/seed.ts:331`).

## El criterio 5, traducido a algo que se ejecuta

**Tanda 3.** Entorno base, el mismo del ciclo 1: `docker compose up -d`,
`npm run db:migrate`, `npm run seed`, `npm run build`, `npx next start`, y la
cookie del punto 1 de arriba.

La **ruta exacta** del endpoint la fija `sdd-architect` (ver «No decidido a
propósito»); lo que esta spec fija y no es negociable es el verbo, los tres
cuerpos, los tres códigos, la tabla que se consulta y el orden:

```bash
# 1. Los tres rechazos. Los tres tienen que responder 400 con `issues`.
for BODY in '{"brand":"no-es-un-color#"}' '{"radius":"gigante"}' '{"background":"#fff"}'; do
  curl -s -o /tmp/out -w '%{http_code}\n' -b "$COOKIE" \
    -X PUT -H 'content-type: application/json' -d "$BODY" "$BRANDING_URL"
done
# esperado: 400, 400, 400 — y `.issues[].path` no vacío en los tres

# 2. La base NO cambió después de los tres.
psql "$DATABASE_URL" -Atc \
  'SELECT "themeTokens" FROM "Storefront" WHERE slug = '"'"'tienda-demo'"'"';'
# esperado: exactamente el mismo valor que antes del paso 1

# 3. El camino feliz, para que el 400 no sea un falso positivo por otra causa.
curl -s -o /dev/null -w '%{http_code}\n' -b "$COOKIE" \
  -X PUT -H 'content-type: application/json' \
  -d '{"brand":"#0f62fe","radius":"soft"}' "$BRANDING_URL"
# esperado: 200

# 4. Y se ve en la vitrina sin esperar el piso de ISR (R36).
curl -s http://localhost:3000/tienda-demo | grep -c -- '--color-brand:#0f62fe'
# esperado: >= 1
```

Más un test del proyecto `node` sobre el esquema de la petición: los tres cuerpos
de arriba fallan, `{}` pasa, `{"brand":"oklch(0.62 0.17 145)"}` pasa, y una clave
desconocida falla por `.strict()`.

**Y donde vive de verdad:** todo esto entra como sección nueva de
`.agent/specs/F-011/smoke.sh`, para que `bash .agent/verify.sh F-011 --smoke`
vuelva a cubrir los cinco criterios y no cuatro. Un criterio que solo se comprueba
a mano es un criterio que se cae la próxima vez.

## Criterios de aceptación propuestos (siguen del ciclo 1)

Los cinco `[ya]` no se tocan. Del ciclo 1 quedan vivos y **ahora sí ejecutables**
el **13** (`check:theme` en 0 después de guardar branding por el panel) y el
**15** (`verify.sh --full` en 0), que se escribieron para un editor que no llegó a
existir. A ellos se suman:

16. `[nuevo]` El esquema es **el mismo objeto**, no una copia: un test del
    proyecto `node` importa `themeTokensSchema` de
    `src/features/theming/storeTheme.ts` y comprueba que el esquema del endpoint
    lo referencia; o un test de fronteras que falle si las cinco claves se
    redefinen en `src/features/admin/schemas.ts`.
17. `[nuevo]` Con la marca de dos sucursales sembrada por HD18 y una cookie que
    trae **las dos**, un guardado de branding deja las dos páginas de sucursal
    **y** la del selector con el color nuevo en la petición inmediatamente
    siguiente (E39, R36).
18. `[nuevo]` `git grep -n 'themeTokens' src/features/admin` solo encuentra
    escrituras contra `storefront`, nunca contra `store`; y `npx prisma validate`
    termina en 0 sin migración nueva.
19. `[nuevo]` Quitar el branding escribe `{}` —comprobado con un `SELECT`, no con
    la respuesta del endpoint— y la respuesta pública deja de traer `<style>`
    (E38).
20. `[nuevo]` Un valor `oklch(...)` guardado desde el panel vuelve del `SELECT`
    idéntico, carácter a carácter (E43).
21. `[nuevo]` El editor se juzga a 360 y 1280 px con el mecanismo que F-017
    construyó —chromium headless, la etapa `--visual` de `.agent/verify.sh`—, con
    un guion visual propio de F-011 en .agent/specs/F-011/visual.mjs (por crear).
    Tres agentes distintos documentaron en el ciclo 1 que no podían juzgar 360 ni
    768 px; ese hueco ya tiene herramienta y no hay motivo para heredarlo.
22. `[nuevo]` **El 403 de cobertura** (HD16, R42): con una cookie que trae **una
    sola** de las dos sucursales de la marca sembrada por HD18, el guardado del
    branding responde `403 {"error":"FORBIDDEN"}` y un `SELECT` de
    `Storefront.themeTokens` devuelve exactamente lo que había antes (E40). Con la
    cookie que trae las dos, la misma petición responde 200 — para que el 403 no
    sea un falso positivo por una ruta mal escrita o un cuerpo inválido, que es la
    misma cautela con la que se verificó el criterio 2.
23. `[nuevo]` `npm run seed && npm run seed` sigue terminando en 0 con la fixture
    de HD18, y la marca sembrada conserva sus dos sucursales tras la segunda
    pasada. El CI siembra dos veces y una fixture de agrupación no idempotente lo
    rompería en un sitio donde nadie la está mirando (ficha
    `.agent/playbook/seed-storefront-colisiona-con-slug-ya-agrupado.md`).

## Incongruencias detectadas

- **I9 — El criterio 5 dice «no llega a la base» y la tabla que nombraba
  desapareció.** El ciclo 1 lo iba a verificar con un `SELECT` sobre
  `Store.themeTokens`; esa columna la borró la migración de F-017 (ADR 0018 §
  Consecuencias: «Tres columnas de `Store` se borran»). **Resuelta aquí sin
  preguntar y sin tocar el criterio** (regla 3): la base es
  `Storefront.themeTokens` y el `SELECT` va contra `Storefront`. El criterio
  literal sigue siendo cierto y verificable; lo que cambió es dónde se mira.
- **I10 — El permiso es por tienda y el dato es de la marca. RESUELTA por HD16.**
  La sesión trae `storeIds` (`src/features/admin/authorization.ts:27-31`) y no hay
  ningún concepto de «marca autorizada» en el repo. ADR 0018 (e) sube el branding
  a `Storefront` y **no dice quién puede escribirlo**; ADR 0018 (f) solo resuelve
  el caso de agrupar, exigiendo permiso sobre **las dos** tiendas. El humano
  eligió la lectura estricta y coherente con esa (f): **cobertura total o 403**
  (R42–R46, E40). La incongruencia se cierra, pero **deja trabajo estructural**:
  el guard del panel decide hoy con cero consultas y este camino necesita una
  (R43), así que `sdd-architect` tiene que decidir dónde vive esa lectura sin
  abrir un segundo camino de autorización. La ADR 0018 no cubre este punto: es
  material para actualizarla o para un párrafo nuevo.
- **I11 — `commit()` revalida un slug y un branding cambia N+1 tags.** El embudo
  (`src/features/admin/server/mutations.ts:67-71`) fue diseñado cuando toda
  escritura del panel era de una sucursal. `themeTokens` se lee bajo **dos** tags
  distintos —`storeTag(canonicalSlug)` por sucursal
  (`src/features/catalog/server/queries.ts:143-148`) y `storefrontTag(brandSlug)`
  para el selector (`:181-188`)—, así que un guardado que solo llame a `commit()`
  deja rancias todas las hermanas y el selector **hasta 3600 s**. Es exactamente
  la firma de la ficha
  `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`,
  fichada ya tres veces en este repo. El propio `setStoreEnabled` tuvo que
  saltarse `commit()` para resolverlo (`mutations.ts:236-255`): la cuarta
  instancia del mismo defecto entra por aquí si nadie lo mira.
- **I12 — El helper obligatorio no devuelve lo que esta escritura necesita.**
  AGENTS.md § Prohibiciones prohíbe armar a mano el array de slugs de una marca y
  manda llamar a `expandBrandTouch()`. Pero `expandBrandTouch` devuelve un
  `SlugTouchSet` de **valores del registro** para `revalidateSlugs`
  (`src/features/storefront/server/registry.ts:269-277`), y lo que un branding
  necesita son **slugs canónicos** para `revalidateStores`, que exige
  `PublicSlug[]`. Hoy el único sitio autorizado a hacer ese salto con un cast es
  `regroupStoreIntoBrand` (`registry.ts:457-471`), con un comentario que dice que
  es «the one place in the whole codebase allowed to make that claim». Decidir
  dónde vive la proyección para el branding —extender `expandBrandTouch`, un
  gemelo suyo en `registry.ts`, o un cast que rompe esa exclusividad— es
  **decisión de `sdd-architect`**, no de esta spec; lo que la spec exige es R36 y
  R37.
- **I13 — El diseño congelado está escrito sobre `Store` y sobre una forma de URL
  que la ADR 0018 superó.** `.agent/specs/F-011/design.md` § «Congelado» dice, en
  su punto 2, que la maqueta necesita el selector de sucursal de ADR 0012 y que
  las páginas viven en `/[slug]/[sucursal]`. ADR 0018 (b) **supera esa línea**: el
  selector vive en `/[slug]` de la marca y cada sucursal en su **propio slug de
  primer nivel**. Y su punto 1 propone mover el editor a `/admin/marcas/…`, lo que
  choca con I10. El detalle de qué sobrevive y qué se repiensa está en la tabla
  del final de este capítulo.
- **I14 — La ADR 0017 está rancia en tres puntos y su § «Reabrir cuando» manda un
  mecanismo que ya no aplica.** Sigue marcada **Propuesta** aunque lo que decide
  está construido y fusionado; su § (c) presenta AP5 y AP6 como abiertas aunque el
  ciclo 2 las implementó (`Store.sourceOptIn` y `Store.sourceUpdatedAt`,
  `prisma/schema.prisma:230-239`); y su § «Reabrir cuando» dice que al llegar
  `Storefront` el editor se construye «con el mecanismo de override descrito
  arriba» —columnas de override y precedencia en un módulo—, que es justo lo que
  ADR 0018 (e) hizo **innecesario**: en `Storefront` no hay ninguna columna
  compartida con el sync, así que no hay nada que precedenciar. El propio
  documento pide que se actualice y no se interprete. **Corregirla es de
  `sdd-architect`**, no mía.
- **I15 — Tres columnas de contacto y dos de imagen se leen y no las escribe
  nadie.** `Storefront.contactPhone`, `contactWhatsapp` y `contactEmail` tienen su
  precedencia implementada y probada (`src/lib/storeContact.ts`) y su lectura
  viva (`src/features/catalog/server/queries.ts:112-119`), pero ningún camino del
  repo las escribe: ni el panel, ni el sync, ni el seed. `logoUrl` se lee y no se
  pinta en ningún sitio, y `coverUrl` solo alimenta el `openGraph`
  (`src/app/[slug]/page.tsx:64`). Es funcionalidad a medio construir, no un
  descuido de F-017: su editor era exactamente lo que HD5 canceló. Ningún
  `acceptance_criteria` las cubre, así que la regla 3 impide meterlas como
  criterio. **Cerrada por HD17 y HD19: las cinco quedan fuera de esta tanda**, el
  contacto como deuda para otro ciclo y las dos de imagen esperando a F-023. La
  incongruencia no desaparece —siguen siendo columnas leídas que nadie escribe—,
  pero deja de ser una pregunta abierta.
- **I16 — `depends_on` de F-011 no menciona lo que de verdad lo bloqueó.** Dice
  `["F-008"]`, y lo que tuvo parado el criterio 5 durante dos ciclos fue F-017.
  Como el backlog es del humano (regla 4), queda escrito aquí y no se toca.
- **I17 — La nota de F-011 en `.agent/features.json` empieza con «Sin empezar».**
  Hay cuatro criterios verificados ejecutando, fusionados a `main` en el PR #6, 18
  pasos de plan construidos y dos ciclos de `sdd-tester` en verde. La nota es del
  humano y solo él la corrige; se señala para que nadie lea el backlog y concluya
  que este feature no tiene código.
- **I18 — El caso que hace falta probar no existe en el seed, y crearlo no tiene
  vuelta. RESUELTA por HD18.** E39, E40 y los criterios 17 y 22 `[nuevo]`
  necesitan una marca con dos sucursales. El seed no tiene ninguna
  (`prisma/seed.ts:361-417`: cada tienda es su propia marca) y la única forma de
  crearla en caliente es la acción de agrupar, que ADR 0018 (f) define **sin
  desagrupar**; un sensor repetible no puede depender de una operación
  irreversible sobre una fixture. Se siembra ya agrupada, con el precedente de
  `tienda-cerrada`, y con la advertencia de idempotencia del criterio 23
  `[nuevo]`: el CI siembra dos veces.

## Respuestas del humano (HD16–HD19)

Las cuatro preguntas que este capítulo dejó abiertas el 2026-08-28 las contestó el
humano ese mismo día. Se anotan aquí con su consecuencia, en el mismo formato con
que HD1–HD15 viven en `.agent/progress/F-011.md`, y **no queda ninguna pregunta
abierta que bloquee el plan**.

- **HD16 — El branding de una marca lo edita quien administra TODAS sus
  sucursales.** Si a la sesión le falta una sola sucursal renderizable de esa
  marca, la escritura responde **403** y no se guarda nada: ni parcialmente, ni
  con un aviso, ni «solo lo suyo». Fue la opción estricta, contra la
  recomendación de esta spec, y es coherente con ADR 0018 (f), que ya exige
  permiso sobre **las dos** tiendas para agrupar. Consecuencias escritas en R42–R46
  y E40/E40b, y una estructural que hereda `sdd-architect`: la autorización de
  este camino ya no se decide con cero consultas (R43).

- **HD17 — El contacto de la marca no entra en esta tanda.** `contactPhone`,
  `contactWhatsapp` y `contactEmail` siguen siendo columnas leídas que nadie
  escribe (I15). Queda como deuda anotada para otro ciclo, no como olvido.

- **HD18 — La marca de dos sucursales se siembra ya agrupada en `prisma/seed.ts`.**
  Nada de agrupar dentro de `.agent/specs/F-011/smoke.sh`: agrupar no tiene vuelta
  y el sensor tiene que poder correr dos veces seguidas. Mismo precedente que
  `tienda-cerrada` en el ciclo 2. Es lo único que esta tanda toca de `prisma/`.

- **HD19 — El logo y la portada de la marca no entran.** `Storefront.logoUrl` y
  `coverUrl` esperan a F-023, que va a cambiar cómo se almacenan y se sirven las
  imágenes.

## Qué sobrevive del diseño congelado y qué hay que repensar

Lectura obligatoria antes de tocar `.agent/specs/F-011/design.md`: la forma de las
pantallas se sostiene casi entera; lo que cambió es de qué fila salen los valores,
a cuántas páginas afectan y qué promete el microcopy.

| Pieza congelada (design.md § 2b y su microcopy)                                           | Veredicto                                  | Por qué                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Las seis paletas como chips `type="button"` **sin `name`**                                | **Sirve tal cual**                         | Nada del cambio de tabla la toca. DP3 (los seis nombres) ya está contestada                                                                                                                                                                                            |
| `ColorTokenField`: texto **con** `name` + `<input type="color">` **sin** `name`           | **Sirve, y sigue siendo obligatorio**      | `prisma/seed.ts:331` guarda `oklch(...)` hoy; VE6 no ha caducado y E43 lo convierte en criterio                                                                                                                                                                        |
| Los cuatro `RadioCard` de `radius`, incluida «Las de siempre»                             | **Sirve tal cual**                         | `RADIUS_SCALE` no cambió (`src/features/theming/storeTheme.ts:29-33`)                                                                                                                                                                                                  |
| Extraer `themeCustomProperties()` de `storeTheme.ts` para la maqueta                      | **Sirve tal cual, sigue sin existir**      | El módulo exporta hoy solo `themeTokensSchema`, `ThemeTokens` y `renderStoreTheme`                                                                                                                                                                                     |
| La maqueta aplica propiedades personalizadas en su `style`, sin `<style>` ni `data-store` | **Sirve tal cual**                         | Es lo que impide que la maqueta pelee con la regla real y lo que respeta F-016                                                                                                                                                                                         |
| La maqueta enseña la cabecera de la vitrina                                               | **Repensar**                               | Hoy hay **dos** cabeceras públicas distintas: la del selector de marca (`src/app/[slug]/layout.tsx:35-41`, sin carrito y sin enlace) y la de sucursal (`:71-90`). Con varias sucursales hay que decidir cuál se previsualiza, o el admin ve una pantalla que no existe |
| La nota «al descongelar, la maqueta necesita el selector de ADR 0012»                     | **Superada**                               | ADR 0018 (b) cambió la forma: no hay `/[slug]/[sucursal]`; el selector vive en `/[slug]` de la marca y cada sucursal en su propio slug de primer nivel                                                                                                                 |
| La nota «el editor pasa a `/admin/marcas/<storefront>`»                                   | **Repensar, con HD16 encima**              | La sesión sigue autorizando tiendas y ahora además exige cubrir la marca entera (R42). Entrar por el hub que ya existe conserva el guard, el 403 del criterio 2 y la tarjeta «Tu marca» de F-017                                                                       |
| Microcopy «Tu tienda usa la paleta por defecto…», «Tus clientes ya lo ven en tu tienda»   | **Repensar**                               | Con varias sucursales, «tu tienda» es falso: el guardado afecta a todas. El texto tiene que nombrar la **marca** y decir a cuántas sucursales alcanza                                                                                                                  |
| El estado «Guardado en tienda no publicada»                                               | **Repensar**                               | HD10–HD15 cambiaron qué significa: hoy hay `DRAFT` (nunca fue pública, 404) y `SUSPENDED` (cerrada por el panel o por el POS, 200 con aviso)                                                                                                                           |
| `PalettePreview` (la tira de color en la tarjeta del listado)                             | **Repensar dónde vive**                    | El listado es de **tiendas** y la paleta es de la **marca**: dos hermanas mostrarían la misma tira sin explicar por qué                                                                                                                                                |
| La tarjeta 2a «Datos de Cuadre de Caja»                                                   | **Ya construida**                          | Vive en el hub desde el ciclo 1                                                                                                                                                                                                                                        |
| La tarjeta 2c «Texto y contacto» y sus cuatro columnas de override                        | **Cancelada, y su mecanismo ya no aplica** | ADR 0018 (e) puso el contacto en `Storefront`, donde el sync no escribe: no hace falta ninguna columna de override ni módulo de precedencia nuevo (`src/lib/storeContact.ts` ya lo resuelve). HD17 la deja fuera de esta tanda                                         |
| HD8 / DP4(a): se puede guardar un branding ilegible, avisa la maqueta                     | **Sigue en pie**                           | Ninguna ADR posterior lo tocó                                                                                                                                                                                                                                          |
| El aviso «HD2: publicar y despublicar se hace en Cuadre de Caja»                          | **Falso a medias, ya señalado**            | HD10: abrir y cerrar al público es del panel; solo publicar por primera vez sigue siendo del POS                                                                                                                                                                       |
| «No pude juzgar 360 ni 768 px» (VE18, repetido por tres agentes)                          | **Ya tiene herramienta**                   | F-017 construyó la etapa `--visual` con chromium headless. Ver criterio 21 `[nuevo]`                                                                                                                                                                                   |

## No decidido a propósito (tanda 3)

- **La ruta exacta del endpoint de branding y la URL de la pantalla.** Es de
  `sdd-architect` con `sdd-designer`. Lo que la spec fija: verbo de reemplazo,
  cuerpo = objeto de tokens (R32), 400/401/403/404 con los cuerpos que ya usa
  `src/app/api/admin/_lib/respond.ts`, ni una server action (R35), y el 403 de
  cobertura con el mismo cuerpo que el de tienda ajena (R44).
- **Dónde se comprueba la cobertura de HD16 y de dónde sale su consulta** (R43):
  extender el guard, una función nueva del feature del panel, o un tipo marcado
  gemelo de `AuthorizedStoreId`. Lo único que la spec exige es que **no haya un
  segundo camino de autorización** y que la lectura que decide el 403 sea la misma
  que alimenta la revalidación de R36.
- **Dónde vive la proyección «marca → slugs a revalidar»** (I12): extender
  `expandBrandTouch`, un gemelo suyo en `src/features/storefront/server/registry.ts`,
  o algo mejor. Lo decide `sdd-architect`; la spec solo exige R36 y R37.
- **Si el editor es una tarjeta más del hub o una pantalla propia**, y **cómo se
  ve bloqueado** cuando la cobertura es incompleta (E40b, R45). Es `design.md`.
- **Si la maqueta previsualiza la cabecera de sucursal, la del selector, o las
  dos.** Es `design.md`.
- **El nombre, los slugs y los `externalId` de la fixture de HD18.** Es
  `sdd-architect` en `architecture.md` § Fixtures. Lo que la spec exige: dos
  sucursales renderizables bajo una marca, de un solo uso, que ningún otro feature
  lea, e idempotente ante un segundo `npm run seed` (criterio 23 `[nuevo]`).
- **Actualizar la ADR 0017** (I14), añadir a la ADR 0018 el punto que HD16 decide
  y que ninguna ADR cubría (I10), y decidir si esta tanda merece ADR propia. Es
  `sdd-architect`. Mi lectura: no hace falta una ADR nueva —ADR 0018 (e) ya decidió
  la propiedad del dato—, pero la 0017 hay que ponerla al día o mandará a quien la
  lea a construir un mecanismo de override que nadie necesita, y la cobertura de
  HD16 tiene que quedar escrita donde vive el resto de la frontera de escritura.
- **El editor de contacto e imágenes de la marca** (HD17, HD19) y la validación de
  contraste (HD8): deuda conocida, anotada para el humano y el backlog.
- **Si F-011 pasa a `passes: true` al cerrar este criterio**, dado que la nota del
  feature dice que F-023 sustituye parcialmente el cuarto. No lo decide esta spec
  ni ningún agente: es del humano al cerrar el ciclo, con `.agent/features.json`
  delante.
