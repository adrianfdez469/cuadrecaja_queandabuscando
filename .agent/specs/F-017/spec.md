---
feature: F-017
agente: sdd-spec
actualizado: 2026-08-27T00:49:45Z
estado: listo
---

> Origen: `.agent/specs/propuestas/storefront-multisucursal.md` (E1–E5, R1–R5) y
> [ADR 0012](../../../docs/adr/0012-storefront-sobre-store.md), **aceptada**.
> Esta spec es el **alcance recortado** que el humano aprobó (HS1–HS4): la
> propuesta se cierra con ella, no se duplica.
>
> Qué se leyó antes de escribir: `AGENTS.md` completo, `.agent/features.json`
> (F-017 y sus `rules`, F-004/F-005/F-006/F-010/F-011/F-016), ADR 0012 y
> [ADR 0017](../../../docs/adr/0017-frontera-de-escritura-del-panel.md),
> `docs/sync-contract.md` § `STORE`, `prisma/schema.prisma`, `prisma/seed.ts`,
> `src/lib/slug.ts`, `src/lib/cache.ts`, `src/features/catalog/server/queries.ts`,
> `src/features/sync/server/handlers/store.ts`,
> `src/features/sync/server/{processBatch,availability}.ts`,
> `src/features/orders/server/{quote,read,createOrder}.ts`,
> `src/features/admin/server/{stores,mutations}.ts`,
> `src/features/theming/storeTheme.ts`, `src/app/[slug]/**`, `src/proxy.ts`,
> `src/app/{sitemap,robots}.ts`, `.agent/specs/F-011/` (spec, design § Congelado,
> architecture) y `.agent/playbook/`.

## Problema

Hoy `/[slug]` resuelve un `Store`, que es el espejo de **un local físico**. El
negocio con dos sucursales recibe dos URL, dos QR y una marca partida, y el
branding vive en la fila de la sucursal, así que el panel no tiene dónde
editarlo sin pelearse con el sync (`handlers/store.ts:96-104` reescribe
`description`, `phone`, `whatsapp` y `email` en **todo** evento).

Importa ahora por un motivo físico: **los QR se imprimen en papel**. Emitir hoy
`/lacasa-vedado` y querer mañana `/lacasa` obliga a reimprimir. Es lo único de
ADR 0012 que no se arregla después con una migración. Y por un motivo de
calendario: el criterio 5 de F-011 (editor de branding) está detenido por HD6
esperando exactamente esta tabla.

## Alcance

### Dentro

- Modelo `Storefront` (la marca) por encima de `Store`, con
  `Store.storefrontId` **NOT NULL**.
- La marca pasa a poseer el **slug**, el **branding** (`themeTokens`, `logoUrl`,
  `coverUrl`) y el **contacto propio del panel**.
- Tabla `Slug`: registro único de marcas, sucursales y palabras reservadas, con
  la unicidad garantizada **por restricción de base**.
- Resolución de `/[slug]`: **primero `Storefront`, después `Store`** (ADR 0012),
  en **un solo** resolvedor que usan la vitrina, el carrito, el checkout, la
  cotización y la página del pedido.
- Render directo de la única sucursal de una marca, **sin selector**.
- El sync crea la marca junto con su primera sucursal, en la misma entrega
  (HS2).
- Migración de las tiendas existentes sin perder ninguna URL viva (HS4).
- Los tags de ISR y la cadena `sync → revalidateTag → ISR` que F-005, F-006 y
  F-011 ya verificaron, intactos.

### Fuera (explícito)

> **CORRECCIÓN DEL ORQUESTADOR, 2026-08-27.** Las dos primeras exclusiones de
> esta lista **ya no valen**, y no por un error de este documento: se escribió
> contra una entrada de F-017 que redactó el orquestador con el alcance
> recortado (HS1), y el humano tenía su propia entrada en `main` con **ocho**
> criterios. Manda la suya (regla 4). Sus criterios **2 y 6 exigen el selector
> de sucursal y el aviso del carrito al cambiar de sucursal**, así que ambos
> están DENTRO y la regla 3 impide recortarlos. HS3 queda superada y **SP2
> volvió a estar viva**: la resolvió el humano como **HS5** —el carrito no se
> borra nunca al cambiar de sucursal; cada tienda conserva el suyo y el criterio
> 6 se cumple informando, no modificando—. Ver `.agent/progress/F-017.md`
> § «Decisiones tomadas» y `architecture.md`, que sí está escrito contra los
> ocho criterios y separa etapa 1 de etapa 2. **El resto de esta lista sigue
> vigente entero.**

- ~~**Selector de sucursal** y las rutas `/[slug]/[sucursal]`~~ → DENTRO, por el
  criterio 2. La forma de la URL la decide AP1.
- ~~**Carrito namespaced por sucursal** y el aviso al cambiar de sucursal~~ → el
  aviso está DENTRO por el criterio 6. El namespacing por tienda **ya existe**
  desde F-010 (`src/constants/cart.ts`: la clave es `qab.cart.v1.` + `Store.id`,
  «Never by slug»), así que mover el slug a la marca no lo toca.
- **Agrupar varias sucursales bajo una marca ya existente.** Es una acción
  posterior del panel.
- **Geolocalización y búsqueda por cercanía.** Siguen en F-015 / ADR 0011.
- **Inventario distribuido, catálogo unión, pedidos partidos y almacenes.**
  Descartados en ADR 0012, no pospuestos.
- **El editor de branding del panel** (tarjeta 2b congelada de
  `.agent/specs/F-011/design.md`) y su endpoint. F-017 le deja el sitio; el
  criterio 5 de F-011 se cierra con el editor, no aquí (ver § Qué desbloquea).
- **Descripción y contacto editables de la sucursal.** Siguen canceladas por
  HD5/DP1: `Store.description` es de lectura y del sync.
- **Renombrar la marca desde el panel** y elegirle el slug a mano.

## Actores y precondiciones

| Actor        | Qué hace en este feature                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| El sync      | Entrega un evento `STORE`; crea marca + sucursal cuando la sucursal no existía |
| El comprador | Pide `/[slug]` por el slug de la marca o por un slug de sucursal ya emitido    |
| El panel     | **No escribe nada nuevo aquí.** Solo cambia de qué fila lee lo que ya muestra  |
| La migración | Da marca a cada `Store` existente y mueve su slug                              |

Precondiciones: Postgres en el 5433 con las migraciones de F-011 aplicadas;
`npm run seed` corrido; `SYNC_TOKEN` en el entorno para
`scripts/send-store-batch.mjs`.

## Comportamiento esperado

### Resolución de la URL

- **E1** — Dado un `Storefront` con slug `s` y **una** sucursal `PUBLISHED`,
  cuando se pide `GET /s`, entonces responde **200** con el catálogo de esa
  sucursal, sin redirección y **sin ningún selector de sucursal en el HTML**.
- **E2** — Dado un `Store` que conserva su slug `t` de antes del cambio (kind
  `STORE` en el registro), cuando se pide `GET /t`, entonces responde **200** con
  esa sucursal: **ni 404, ni 301, ni 302, ni `Location`** (HS4).
- **E3** — Dado un slug que no existe en el registro, cuando se pide `GET /x`,
  entonces responde **404**, igual que hoy (criterio 4 de F-004).
- **E4** — Dado un `Storefront` cuya única sucursal está `SUSPENDED`, cuando se
  pide `GET /s`, entonces responde **200** con la página de cierre de HD11 —
  nombre, marca y motivo, sin catálogo y sin carrito—, no un 404.
- **E5** — Dado un `Storefront` cuya única sucursal está `DRAFT`, cuando se pide
  `GET /s`, entonces responde **404** (HD11: nunca fue pública, no hay URL que
  honrar).
- **E6** — Dado un `Storefront` con **cero** sucursales no-`DRAFT`, cuando se
  pide `GET /s`, entonces responde **404**, nunca una página vacía ni un selector
  sin opciones.
- **E7** — Dado el slug de la marca `s`, cuando se piden `GET /s/carrito`,
  `GET /s/checkout`, `GET /s/p/<producto>` y `GET /s/pedido/<code>`, entonces
  todas responden lo mismo que respondían por el slug de la sucursal antes del
  cambio (F-004, F-010, F-007 sin regresión).
- **E8** — Dado el slug de la marca `s`, cuando se hace
  `POST /api/orders` con `storeSlug: "s"`, entonces el pedido se crea contra la
  **única** sucursal de esa marca y el `orderUrl` devuelto empieza por `/s/`.

### El sync

- **E9** — Dado un evento `STORE` con `publishToStore: true` y un `storeId` que
  no existe en esta base, cuando se procesa, entonces se crean **en la misma
  entrega** un `Slug`, un `Storefront` y un `Store` enlazados
  (`Store.storefrontId` apunta a la marca nueva), el evento se reporta
  `processed`, y `GET /<slug de la marca>` responde 200.
- **E10** — Dado el mismo evento reentregado, cuando se procesa, entonces se
  reporta `duplicate` por `eventId` y **no** se crea una segunda marca (F-005,
  criterio 4).
- **E11** — Dado un evento `STORE` de una sucursal que ya existe, cuando se
  procesa, entonces **no** se toca ninguna columna de la marca: ni el slug, ni
  `themeTokens`, ni `logoUrl`, ni `coverUrl`, ni el contacto de la marca.
- **E12** — Dado un evento `STORE` con `updatedAt` anterior al
  `Store.sourceUpdatedAt` almacenado, cuando se procesa, entonces se reporta
  `stale` y no se crea marca ni slug (AP6 de F-011 intacta).
- **E13** — Dado un evento `STORE` con `publishToStore: false` para una sucursal
  que **no existe**, cuando se procesa, entonces se reporta `skipped` y **no** se
  crea marca ni slug: una tienda que nunca se publicó no reserva un slug.
- **E14** — Dado un evento `STORE` de una sucursal nueva cuyo slug derivado ya
  está tomado en el registro, cuando se procesa, entonces se crea con el
  siguiente candidato libre (`-2`, `-3`, …) y el evento sale `processed`, no
  fallido.

### Registro de slugs

- **E15** — Dado el valor `v` ya presente en el registro como marca, cuando se
  intenta insertar `v` como sucursal (o al revés), entonces la escritura falla
  con **error de integridad de Postgres**, no con una comprobación previa en
  código (criterio 7).
- **E16** — Dado un slug candidato `admin`, `api` o `buscar`, cuando se intenta
  crear una marca con él, entonces se rechaza **en validación**, antes de
  cualquier escritura, y con un error tipado; nunca se llega a un 404 en tiempo
  de ejecución (criterio 8).
- **E17** — Dado un slug ya emitido cuya sucursal se borrase algún día, cuando se
  intenta reutilizar ese valor para otro dueño, entonces se rechaza: el valor
  queda **retirado**, no vuelve al pool. Un QR impreso no puede acabar apuntando
  al negocio de otro.

### Branding, contacto e ISR

- **E18** — Dado un `Storefront` con `themeTokens`, cuando se renderiza
  cualquier página de su vitrina, entonces el `<style>` emitido y el atributo
  `data-store` son **idénticos byte a byte** a los que emitía la misma
  configuración sobre `Store` (F-016 sin regresión).
- **E19** — Dado un `Storefront` sin contacto propio (columnas a `null`), cuando
  se muestra el contacto al comprador, entonces se muestra el de la sucursal que
  envió el POS: exactamente lo que se ve hoy.
- **E20** — Dado un `Storefront` con contacto propio, cuando se muestra el
  contacto al comprador, entonces gana el de la marca; pero el número al que
  **viaja un pedido** por WhatsApp sigue siendo el de la sucursal (R15).
- **E21** — Dada una sucursal alcanzable por dos URL vivas (slug de marca y slug
  de sucursal, E2), cuando el sync o el panel escriben algo suyo, entonces
  **las dos URL** sirven el dato nuevo tras la revalidación: no hay una URL que
  quede rancia.
- **E22** — Dado `npm run build`, cuando termina, entonces `/[slug]` y
  `/[slug]/p/[productSlug]` siguen marcadas **● (SSG)** y las páginas
  pre-renderizadas incluyen los slugs de marca (criterio 9).

## Reglas de negocio

**Modelo y propiedad**

- **R1** — Un `Store` pertenece a exactamente un `Storefront`
  (`Store.storefrontId` NOT NULL). Un `Storefront` tiene 1..N sucursales; en
  esta etapa siempre 1.
- **R2** — Un `Storefront` pertenece a un `Business`. Un `Business` puede tener
  varios `Storefront` (consecuencia directa de HS2: una marca por sucursal
  publicada, agrupar es posterior).
- **R3** — Todas las sucursales de un `Storefront` pertenecen al mismo
  `Business`. En esta etapa se cumple trivialmente; la acción de agrupar
  (fuera de alcance) es quien tendrá que hacerla cumplir.
- **R4** — La marca posee: `slug`, `themeTokens`, `logoUrl`, `coverUrl` y su
  contacto propio. La sucursal posee: precios, stock, pedidos, `status` y todo
  lo que escribe el sync.
- **R5** — **El sync nunca escribe una columna de la marca**, salvo crearla
  entera la primera vez (E9). No hay columna compartida entre el sync y el
  panel en `Storefront`: la frontera de ADR 0017 (a) se cumple por construcción,
  no por lista blanca.
- **R6** — `Storefront` **no tiene** `status` ni columnas de cierre. Abrir y
  cerrar al público sigue siendo de la **sucursal** (`Store.status` +
  `disabled*`, HD10–HD15). Motivo: el opt-in del POS (`sourceOptIn`) es por
  `Tienda`, y subir el interruptor a la marca haría que un flip del POS en un
  local abriera o cerrara los demás. Con una sola sucursal hay **un** solo
  interruptor: no hay dos que se contradigan.
- **R7** — `Storefront.name` se puebla (migración: el `Store.name`; creación: el
  `payload.name`), pero **no se renderiza en público en esta etapa**. El nombre
  que ve el comprador sigue siendo `Store.name`, sincronizado, para que ninguna
  cabecera ni `<title>` cambie de texto con este feature.
- **R8** — `Storefront` **no** recibe columna de descripción. `Store.description`
  sigue siendo del sync y de lectura (HD5/DP1 siguen vigentes en esa mitad).

**Slug**

- **R9** — Existe **un** registro de slugs (`Slug`) cuya clave primaria es el
  valor del slug. Ahí conviven los slugs de marca, los de sucursal y las
  palabras reservadas. Un valor tiene **como máximo un dueño**, y eso lo
  garantizan la clave primaria y una restricción de base (`CHECK` o clave ajena
  compuesta), **nunca** un `SELECT` previo en código.
- **R10** — El slug de una marca se deriva igual que se derivaba el de la
  sucursal —`payload.slug || payload.name` por `uniqueSlug`— para que la forma
  de la URL no cambie para nadie. La derivación desde `businessName` queda
  descartada: dos locales del mismo negocio producirían `la-rampa` y
  `la-rampa-2`, que es justo el reparto de slugs que ADR 0012 quiere evitar.
- **R11** — La lista de palabras reservadas (`src/lib/slug.ts`) tiene que
  contener, como mínimo, **todos** los primeros segmentos que existen de verdad
  en `src/app/` y los que ya están diseñados: `admin` y `api` (reales hoy),
  `_next`, `public`, `static`, y `sesion-cerrada`, que `.agent/specs/F-011/design.md`
  § 10 define como página **de primer nivel** y hoy **no** está reservada (I3).
  Ninguna palabra reservada se elimina de la lista existente.
- **R12** — Ningún slug se valida solo por la lista: además de la validación
  (`isValidSlug`), cada palabra reservada tiene su fila en `Slug` con
  `kind = RESERVED`, así que una escritura que se salte la validación choca con
  la clave primaria.
- **R13** — Un valor de slug no se reasigna nunca a otro dueño. Al liberarse,
  su fila sobrevive marcada como retirada.

**Contacto**

- **R14** — **Contacto de presentación** (lo que el comprador ve y pulsa:
  cabecera/pie de la vitrina, `StoreClosedNotice`, página del pedido) =
  `storefront.contactX ?? store.<columna sincronizada>`. La precedencia vive en
  **un solo módulo**, gemelo de `src/lib/pricing.ts`, tal como
  ADR 0017 § «Reabrir cuando» prescribe. Ningún componente compone la
  precedencia por su cuenta.
- **R15** — **Contacto de enrutado de pedidos** (`buildWhatsappUrl` para un
  pedido, `quote.ts:115`, `read.ts:92`) = **siempre** la sucursal
  (`Store.whatsapp ?? Store.phone`), sin mirar la marca. Un pedido lo atiende un
  local concreto (ADR 0012: pedidos son de la sucursal) y cambiar esto tocaría
  el pull del POS y `docs/sync-contract.md`.
- **R16** — Las columnas de contacto de la marca nacen a `null`: el sync **no**
  las siembra. Con R14 no se pierde nada, y así R5 se puede comprobar con un
  `grep`.

**Caché e ISR**

- **R17** — El slug de caché es **canónico**: dos URL vivas que sirven la misma
  sucursal comparten entrada de caché y tags. Los tags siguen siendo los de
  `src/lib/cache.ts` (`store:<slug>`, `store:<slug>:catalog`,
  `product:<id>`) con el **slug público canónico de la sucursal** —el de su
  marca en esta etapa—, así que `revalidateStores()` y sus llamantes
  (`processBatch.ts:57`, `availability.ts:65`, `mutations.ts::commit`) siguen
  funcionando sin cambiar de forma.
- **R18** — La resolución `slug → sucursal` se cachea con su propio tag y se
  invalida cuando se crea o cambia una fila de `Slug`.
- **R19** — Una escritura de la marca (cuando exista el editor) invalida los
  tags de **todas** sus sucursales, resueltos en una sola query.
- **R20** — `src/proxy.ts` **no se toca**: su `matcher` sigue sin cubrir
  `/[slug]`. Es la línea más importante del archivo (`AGENTS.md` § Cosas que
  muerden, ficha `proxy-matcher-anula-isr`).
- **R21** — `export const revalidate = 3600` de `src/app/[slug]/layout.tsx:17`
  sigue siendo un **literal**. Ficha `revalidate-no-literal`.
- **R22** — El `sitemap` publica **una** URL por sucursal, la del slug de la
  marca. Una URL de sucursal que sigue viva por HS4 lleva
  `alternates.canonical` a la de la marca: sin redirección (prohibida por HS4) y
  sin competir consigo misma en el buscador.

## Casos límite y errores

| Caso                                                                 | Qué tiene que pasar                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Marca sin sucursales renderizables                                   | 404 (E6)                                                                                                                                                     |
| Sucursal única `SUSPENDED`                                           | 200 con la página de cierre de HD11 (E4)                                                                                                                     |
| Sucursal única `DRAFT`                                               | 404 (E5)                                                                                                                                                     |
| Slug de marca y slug de sucursal iguales                             | Imposible: choca con la clave primaria de `Slug` (E15)                                                                                                       |
| Slug derivado que colisiona                                          | `uniqueSlug` sigue buscando `-2`, `-3`…; el evento sale `processed` (E14)                                                                                    |
| Palabra reservada como slug                                          | Rechazada en validación **y** por la fila `RESERVED` (E16, R12)                                                                                              |
| Dos eventos `STORE` de la misma tienda nueva en el mismo lote        | Una sola marca: la creación es idempotente por `Store.externalId` (`@unique`)                                                                                |
| Dos eventos de tiendas distintas que derivan el mismo slug, a la vez | El segundo choca con la clave primaria y **reintenta** con el siguiente candidato; nunca queda un evento fallido por una carrera de slug                     |
| Evento reentregado tras crear la marca                               | `duplicate` por `eventId`; ninguna marca nueva (E10)                                                                                                         |
| Evento rancio                                                        | `stale`; ninguna marca nueva (E12). **Un evento fallido no es un duplicado**: la propiedad de `inbox.ts` no se toca                                          |
| Tienda con `publishToStore: false` que nunca existió                 | `skipped`, sin marca ni slug (E13)                                                                                                                           |
| `npm run seed` corrido dos veces                                     | Idempotente: mismas marcas, mismos slugs, `storefrontId IS NULL` sigue en 0                                                                                  |
| Carrito abierto en el navegador de un comprador antes del cambio     | Sigue válido: la clave del carrito de F-010 se compone con `storeId` y con el mismo string de slug que antes (la migración **mueve** el valor, no lo cambia) |
| URL de un pedido ya emitida (`/<slug>/pedido/<code>`)                | Sigue resolviendo 200 por el mismo string                                                                                                                    |
| Marca borrada                                                        | `Store` en cascada como hoy con `Business`; la fila de `Slug` **no** se libera (R13)                                                                         |
| Panel: enlace «ver tu tienda» del hub                                | Apunta al slug público canónico, no a un valor que ya no resuelve                                                                                            |

## Datos y contrato

### El contrato con cuadrecaja **no cambia**

`Storefront` es propio de queandabuscando: el POS no lo conoce. El payload
`STORE` (`docs/sync-contract.md:178-199`) se queda como está, `payload.slug`
sigue siendo «solo se usa al CREAR, para el slug único» —ahora el de la marca— y
la v3 propuesta (`unpublishReason`) no se toca. **No hay v4.**

### Deltas de `prisma/schema.prisma`

Sujeto al detalle de `sdd-architect`; lo que esta spec fija es el contenido, no
la sintaxis.

- **`Storefront`** (nuevo): `id`, `businessId` → `Business` (cascade),
  `name`, `slug` (única, en el registro), `themeTokens Json?`, `logoUrl String?`,
  `coverUrl String?`, `contactPhone String?`, `contactWhatsapp String?`,
  `contactEmail String?`, `createdAt`, `updatedAt`. **Sin `status`** (R6),
  **sin descripción** (R8).
- **`Slug`** (nuevo): `value` clave primaria, `kind`
  (`STOREFRONT`/`STORE`/`RESERVED`/retirado), puntero al dueño, `createdAt`, y la
  restricción de exclusividad de R9.
- **`Store`**: `+ storefrontId` NOT NULL; `slug` pasa a **nullable** (solo la
  conservan las sucursales con URL propia ya emitida y, en la etapa 2, las
  sucursales de una marca con varias); `- themeTokens`, `- logoUrl`,
  `- coverUrl`. **Se quedan** `description`, `phone`, `whatsapp` y `email`,
  sincronizadas, porque son la fuente de R14 y el enrutado de R15.
- **`Business.slug`**: pasa a nullable y **deja de generarse**. Hoy solo lo
  escribe `src/features/sync/server/handlers/store.ts:38` y **nadie lo lee** (verificado con `grep`: no
  hay ni un lector en `src/`). No entra en el registro de slugs, a propósito: un
  negocio llamado «La Rampa» reservaría `la-rampa` para una fila que no resuelve
  ninguna URL y se lo quitaría a la marca que sí la resuelve.

### La migración de lo que ya existe

Un solo `migration.sql`, en este orden, y **sin `prisma migrate reset` ni
`prisma db push`** (prohibidos en `AGENTS.md`):

1. Crear `Slug` y `Storefront`; sembrar las filas `RESERVED`.
2. Añadir `Store.storefrontId` nullable.
3. Por cada `Store` existente: crear su `Slug` (kind `STOREFRONT`, valor =
   `Store.slug`), su `Storefront` (con `name` = `Store.name` y el branding
   copiado de la sucursal) y enlazar `Store.storefrontId`.
4. `Store.slug` → `NULL` en las filas migradas: **el mismo string pasa a ser el
   slug de la marca**, así que la URL impresa responde 200 sin redirección
   (HS4) y el espacio de slugs queda con una fila por sucursal en vez de dos.
5. `Store.storefrontId` a NOT NULL; borrar `Store.themeTokens`, `logoUrl`,
   `coverUrl`.

**Por qué mover el slug en vez de dar a la marca un slug nuevo y conservar el de
la sucursal**: conservar los dos deja dos URL públicas por sucursal (contenido
duplicado, dos entradas de caché) y, peor, obliga a la marca a coger
`tienda-demo-2` porque `tienda-demo` ya está ocupado por su propia sucursal. La
rama «después `Store`» de ADR 0012 **no desaparece**: se conserva, la necesita la
etapa 2, y el seed le deja una fixture viva para que no sea código muerto (ver
abajo).

**Trampas de esta migración, ya fichadas**: `prisma migrate dev` propondrá
`DROP INDEX` de los dos índices GIN de `CanonicalProduct` — hay que quitar esas
líneas del `migration.sql` generado (ficha
`prisma-migrate-dev-borra-indices-gin-no-declarados`). Y el checksum puede
derivar si la base está compartida (ficha
`prisma-migrate-dev-checksum-drift-bd-compartida`).

### `prisma/seed.ts`

- Cada tienda del seed nace con su marca. Los slugs `tienda-demo`, `tienda-dos`
  y `tienda-cerrada` pasan a ser **slugs de marca**, con lo que todas las
  fixtures de F-004, F-005, F-006, F-010, F-011 y F-016 siguen apuntando al
  mismo sitio. `themeTokens` de `tienda-dos` se siembra en su **marca**
  (F-016 criterio 4 sigue verde: verde con esquinas redondeadas).
- **Fixture nueva y necesaria**: una marca con slug propio cuya **sucursal
  conserva un slug de sucursal vivo** (kind `STORE`). Es lo que hace que E2/E21 y
  el criterio 5 prueben la rama de resolución por `Store` de verdad, en vez de
  una rama que ninguna fila ejercita, y lo que prueba que las dos URL comparten
  tags de caché.
- El seed sigue reabriendo a propósito lo que cierra la migración de HD12
  (`seed.ts:388-395`): eso no cambia.

## Criterios de aceptación

Los diez `[ya]` son literales de `.agent/features.json` y **no se tocan** (regla
3). Cada uno con lo que hay que **ejecutar**. Los comandos asumen el servidor en
`http://localhost:3000` y `DATABASE_URL` apuntando al 5433.

**1. `[ya]** 'npx prisma validate' termina con código 0 y 'npx prisma migrate
status' reporta la migración de Storefront como aplicada.*

```bash
npx prisma validate; echo "validate=$?"
npx prisma migrate status | grep -i storefront   # la migración, como aplicada
```

**2. `[ya]** Tras 'npm run seed', ninguna fila de Store queda sin marca.*

```bash
npm run seed
psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM "Store" WHERE "storefrontId" IS NULL'  # 0
psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM "Storefront"'                          # >= 4
npm run seed   # segunda pasada: los dos números no cambian
```

**3. `[ya]** Un evento STORE de una tienda que no existía crea la marca junto con
su primera sucursal, enlazadas, en una sola entrega de
scripts/send-store-batch.mjs.*

```bash
NEW="nueva-$(date +%s)"
node scripts/send-store-batch.mjs --store="$NEW"     # HTTP 207, status "processed"
psql "$DATABASE_URL" -Atc "SELECT sf.slug, s.\"storefrontId\" IS NOT NULL
  FROM \"Store\" s JOIN \"Storefront\" sf ON sf.id = s.\"storefrontId\"
  WHERE s.\"externalId\" = '$NEW'"                    # una fila, slug no vacío
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/<ese slug>"  # 200
```

**4. `[ya]** GET /[slug] de una marca con una sola sucursal responde 200, muestra
el catálogo de esa sucursal y el HTML NO contiene ningún selector de sucursal.*

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/tienda-demo   # 200
curl -s http://localhost:3000/tienda-demo | grep -c 'Café molido'            # >= 1
curl -s http://localhost:3000/tienda-demo \
  | grep -cE 'data-branch-picker|name="sucursal"|Elegir sucursal'            # 0
psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM "Store" s JOIN "Storefront" sf
  ON sf.id = s."storefrontId" WHERE sf.slug = '"'"'tienda-demo'"'"''         # 1
```

**5. `[ya]** GET /[slug] de un slug de Store emitido antes de este cambio
responde 200, ni 404 ni redirección: los QR ya impresos siguen funcionando.*

Se comprueba dos veces, porque hay dos formas de que una URL siga viva:

```bash
# (a) el slug que existía antes de la migración, ahora slug de su marca
curl -s -o /dev/null --max-redirs 0 -w '%{http_code} %{redirect_url}\n' \
  http://localhost:3000/tienda-demo            # "200 " — sin Location
# (b) la fixture con slug de SUCURSAL vivo: prueba la rama "después Store"
psql "$DATABASE_URL" -Atc $'SELECT slug FROM "Store" WHERE slug IS NOT NULL'
curl -s -o /dev/null --max-redirs 0 -w '%{http_code} %{redirect_url}\n' \
  http://localhost:3000/<ese slug>             # "200 "
```

**6. `[ya]** themeTokens, logoUrl, coverUrl y las columnas de contacto del panel
viven en Storefront, y 'grep -n' del handler del sync de tienda no menciona
ninguna de ellas.*

Las columnas del panel se llaman `contactPhone`, `contactWhatsapp` y
`contactEmail` **precisamente** para que este `grep` sea inequívoco: `Store`
conserva sus `phone`/`whatsapp`/`email` sincronizados (R15) y ningún nombre se
solapa.

```bash
grep -nE 'themeTokens|logoUrl|coverUrl|contactPhone|contactWhatsapp|contactEmail' \
  src/features/sync/server/handlers/store.ts   # sin salida, exit 1
psql "$DATABASE_URL" -c '\d "Storefront"'      # las seis columnas están aquí
psql "$DATABASE_URL" -c '\d "Store"'           # themeTokens/logoUrl/coverUrl ya no
```

**7. `[ya]** Crear una marca con un slug ya usado por una sucursal —o al revés—
falla por restricción única, no por comprobación en código.*

```bash
# valor ya tomado por una SUCURSAL (la fixture de (b) del criterio 5)
psql "$DATABASE_URL" -c "INSERT INTO \"Slug\"(value, kind) VALUES ('<slug-sucursal>','STOREFRONT')"
# ERROR: duplicate key value violates unique constraint "Slug_pkey"  → exit != 0
# y al revés
psql "$DATABASE_URL" -c "INSERT INTO \"Slug\"(value, kind) VALUES ('tienda-demo','STORE')"
# ERROR igual. Y la exclusividad de dueño:
psql "$DATABASE_URL" -c "UPDATE \"Slug\" SET \"storeId\" = (SELECT id FROM \"Store\" LIMIT 1)
  WHERE value = 'tienda-demo'"                 # ERROR: violates check constraint
```

**8. `[ya]** Crear una marca con slug 'admin', 'api' o 'buscar' es rechazado por
validación, no por un 404 en tiempo de ejecución.*

```bash
npm test -- storefront    # el test del creador: 'admin'|'api'|'buscar' → error
                          # tipado ANTES de tocar la base (0 queries)
node --input-type=module -e "import {isValidSlug} from './src/lib/slug.ts';" # o el test unitario
psql "$DATABASE_URL" -Atc $'SELECT value, kind FROM "Slug" WHERE value IN (\'admin\',\'api\',\'buscar\')'
# tres filas RESERVED: la red de seguridad de R12
psql "$DATABASE_URL" -c "INSERT INTO \"Slug\"(value, kind) VALUES ('admin','STOREFRONT')"  # ERROR
```

**9. `[ya]** 'npm run build' sigue marcando /[slug] y /[slug]/p/[productSlug]
como ● (SSG), no como ƒ (Dynamic).*

```bash
npm run build 2>&1 | grep -E '●|ƒ' | grep '\[slug\]'   # las dos con ●
```

**10. `[ya]** 'bash .agent/verify.sh F-017 --full' termina con código 0.*

```bash
bash .agent/verify.sh F-017 --full; echo $?   # 0, en sus nueve etapas
```

`--full` incluye `theme` y `bundle`: son la red contra los dos bugs reales de
F-016 (`@theme inline` compila el valor dentro de la utilidad;
`rounded-[--radius-lg]` es sintaxis de v3 inválida en v4). Mover columnas de
tabla no debe reintroducirlos, y `check:theme` es lo que lo dice.

### Propuestos al humano

- **11. `[nuevo]`** — `POST /api/orders` con `storeSlug` = slug de marca crea el
  pedido y devuelve `orderUrl` bajo ese slug:
  `node scripts/place-order.mjs` contra el slug de la marca → 201 y
  `GET <orderUrl>` → 200 (E8; sin esto, F-010 y F-007 quedarían sin cubrir).
- **12. `[nuevo]`** — Las dos URL vivas de una misma sucursal comparten caché:
  tras `node scripts/send-catalog-batch.mjs`, `curl` de **las dos** muestra el
  precio nuevo (E21). Es el criterio que protege la cadena que F-005 verificó.
- **13. `[nuevo]`** — Una marca con cero sucursales no-`DRAFT` responde 404
  (E6): `psql` deja su única sucursal en `DRAFT` y `curl` del slug de la marca
  da 404, no 200 con una página vacía.
- **14. `[nuevo]`** — Un test recorre los directorios de primer nivel de
  `src/app/` y comprueba que **cada uno** está en la lista de reservados
  (`npm test -- slug`): una ruta nueva que nadie reserve deja de ser un 404
  silencioso en producción (R11).
- **15. `[nuevo]`** — El HTML de un slug de sucursal vivo lleva
  `<link rel="canonical">` al slug de su marca y el `sitemap.xml` publica una
  sola URL por sucursal (R22).

## Incongruencias detectadas

- **I1 — `Business.slug` es un tercer espacio de nombres que no resuelve nada.**
  `prisma/schema.prisma:93` lo declara `@unique`, `src/features/sync/server/handlers/store.ts:38` lo
  genera en cada creación y **ningún módulo lo lee** (`grep -rn` sobre `src/`:
  cero lectores). ADR 0012 § «Por qué el registro de slugs» lo cita como parte
  del problema. Resuelto en esta spec: se retira (nullable, deja de generarse) y
  **no** entra en el registro, para que no le quite a la marca el slug que sí
  resuelve una URL.
- **I2 — El criterio 6 obliga a resucitar el mecanismo que HD5 canceló, y ahora
  sí corresponde.** F-011 diseñó cuatro columnas de override en `Store`
  (`descriptionOverride`, `phoneOverride`, `whatsappOverride`, `emailOverride`) y
  el humano las canceló (HD5, `ADR 0017` § «Lo que esta decisión NO hace»). La
  misma ADR dice, literal: «cuando `Storefront` llegue, el mecanismo a usar es el
  de ADR 0007 aplicado a la tienda —columnas de override propiedad del panel,
  precedencia en un solo módulo, handler del sync intacto—». Qué cambió: (a) los
  dos motivos de HD5 estaban en que las columnas vivían en `Store` —tabla que el
  sync reescribe— y en acortar la entrega; ahora viven en una tabla que el sync
  **no** escribe (R5), así que no hay columna compartida ni «gana el último»;
  (b) el criterio 6 lo pide explícitamente. Lo que **sigue** cancelado es la
  descripción editable de la sucursal (R8) y el editor en pantalla (fuera de
  alcance).
- **I3 — `sesion-cerrada` no está reservada.** `.agent/specs/F-011/design.md`
  § 10 la define como página **de primer nivel** («fuera de `/admin` para no
  chocar»), y `src/lib/slug.ts:12-27` no la incluye. Hoy una marca podría
  quedarse ese slug y romper la única salida de una sesión vencida. R11 lo
  arregla; el criterio propuesto 14 lo convierte en un test.
- **I4 — `uniqueSlug` no rechaza una palabra reservada: la disfraza.**
  `src/lib/slug.ts:66` hace `isReservedSlug(base) ? base + "-tienda" : base`. Es
  correcto para el sync (un evento nunca debe fallar por el nombre del local),
  pero **no** satisface el criterio 8, que pide un rechazo. Los dos caminos son
  distintos y esta spec los separa: el sync **deriva** (y disfraza si hace
  falta); un slug **propuesto** —el creador de marcas, y el día que el panel lo
  edite— **se valida y se rechaza** (E16).
- **I5 — Los tags de ISR se construyen con el slug y una sucursal puede tener
  dos.** `src/lib/cache.ts:19-23` y `queries.ts:84,178,197` mezclan «clave de
  caché» y «URL pedida». Con dos URL vivas por sucursal (HS4), invalidar por la
  URL pedida dejaría una de las dos rancia para siempre — el peor tipo de bug,
  el que nadie nota. R17/R18 lo cierran usando el **slug canónico** y una capa
  de resolución con su propio tag; el criterio propuesto 12 lo prueba.
- **I6 — Cuatro módulos resuelven la tienda por slug, cada uno con su query.**
  `src/features/catalog/server/queries.ts:53` (`findFirst({ where: { slug } })`),
  `src/features/orders/server/quote.ts:86`, `src/features/orders/server/read.ts:56`
  (`store: { slug: storeSlug }`) y `src/features/admin/server/stores.ts` (para el enlace
  público). Con la resolución en dos pasos de ADR 0012, cuatro
  implementaciones son cuatro sitios donde una URL puede empezar a dar 404 sin
  que nadie lo note. Esta spec exige **un** resolvedor compartido.
- **I7 — El criterio 4 («el HTML NO contiene ningún selector») es trivialmente
  cierto si nadie construye el selector.** No es un hueco del criterio, es una
  consecuencia de HS1; queda anotado para que el tester no lo tome por
  verificación fuerte y añada, como dice el comando de arriba, que el catálogo
  de **esa** sucursal sí aparece y que la marca tiene exactamente una sucursal.
- **I8 — F-004 está en `passes: true` con `/[slug]` resolviendo un `Store`.** Por
  la regla 3 sus criterios no se tocan: este feature los **extiende** y E2/E3/E22
  existen para probar que lo de F-004 sigue siendo cierto. Igual con el criterio
  4 de F-016 (capturas de dos tiendas con branding distinto), que sigue válido
  porque la migración mueve los tokens sin cambiar su valor ni el string del
  `data-store` (E18).

## Qué desbloquea, y qué falta después

**Desbloquea el criterio 5 de F-011**: «Guardar branding inválido es rechazado
por `themeTokensSchema` y no llega a la base». Estaba detenido por HD6 porque no
había dónde vivir el branding; `Storefront` lo es. Lo que **falta** para
cerrarlo, y que F-017 **no** entrega:

1. El endpoint de escritura del branding de la marca, por el mismo embudo de
   siempre (route handler bajo `/api/admin/`, el guard, `mutations.ts`, la
   revalidación de R19), validando con `themeTokensSchema`.
2. La tarjeta 2b entera —`BrandingForm`, `ColorTokenField`, `StorefrontPreview`,
   las seis paletas— tal como quedó **congelada y firmada** en
   `.agent/specs/F-011/design.md` § Congelado, incluidos VE6 (el
   `<input type="color">` **sin** `name`), DP3 y DP4, que ya están contestados.
3. La extracción de `themeCustomProperties(tokens)` desde
   `src/features/theming/storeTheme.ts`, que la maqueta necesita y que el diseño
   congelado ya especifica.
4. La URL y el dueño del editor: la marca, no la sucursal
   (`/admin/marcas/<id>` o equivalente), y el listado de `/admin` pasando de
   «tus tiendas» a «tu marca y tus sucursales». Eso **sí** es rediseño, y el
   propio bloque congelado lo avisa en su punto 1.

Y un aviso para quien descongele, que sale de HS1: el punto 2 de la lista
«qué hay que releer» dice que la maqueta debe llevar **selector de sucursal**.
En esta etapa **no lo lleva** —no existe el selector— y ponerlo enseñaría una
vitrina que no existe. Vuelve a aplicar en la etapa 2.

## No decidido a propósito

- **La forma exacta de la restricción de exclusividad de `Slug`** (`CHECK` sobre
  las columnas de dueño frente a clave ajena compuesta con `@@unique`). Lo cierra
  `sdd-architect`; lo que esta spec fija es que sea de **base**, no de código
  (R9, criterio 7).
- **Dónde vive el resolvedor** (`features/storefront/server/` frente a
  `features/catalog/server/`) y si `StoreSummary` gana un campo o cambia el
  significado del que tiene. `sdd-architect`.
- **Si el nombre de la marca llega a verse en el panel** cuando el editor exista.
  `sdd-designer`, en el ciclo que descongele F-011.
- **El valor de `kind` para un slug retirado** y si la retirada se representa con
  un valor de enum o con una columna. `sdd-architect` (R13).

## Huecos y preguntas al humano

**Ninguna.** HS1–HS4 cerraron SP1 y SP2 de la propuesta, y todo lo que quedaba
se pudo decidir leyendo el código; las decisiones que no son obvias van
argumentadas arriba (R6 el interruptor, R10 la derivación del slug, R14/R15 la
precedencia del contacto, I1 `Business.slug`, y el paso 4 de la migración).
Cuatro que conviene que el humano vea sin tener que buscarlas, por si alguna no
es lo que esperaba:

1. **La migración mueve el slug de la sucursal a la marca** (paso 4). La URL
   impresa responde 200 sin redirección, que es lo que exige HS4, pero el string
   pasa a ser de la marca. La alternativa —dar un slug nuevo a la marca y
   conservar el de la sucursal— deja dos URL por tienda y le quita a la marca el
   slug bueno.
2. **Cerrar al público sigue siendo de la sucursal** (R6). La marca no tiene
   interruptor, así que con una sola sucursal hay uno y no dos.
3. **El contacto tiene dos lecturas** (R14/R15): lo que se **muestra** puede ser
   de la marca; el número al que **viaja un pedido** es siempre de la sucursal.
4. **`Business.slug` se retira** (I1), en vez de entrar en el registro.
