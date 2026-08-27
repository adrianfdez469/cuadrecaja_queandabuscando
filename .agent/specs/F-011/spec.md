---
feature: F-011
agente: sdd-spec
actualizado: 2026-08-26T16:36:46Z
estado: listo
---

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
