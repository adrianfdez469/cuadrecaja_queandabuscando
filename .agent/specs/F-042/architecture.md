---
feature: F-042
agente: sdd-architect
actualizado: 2026-09-09T05:19:18Z
estado: listo
---

> Sobre `.agent/specs/F-042/spec.md` (`estado: listo`, 26 escenarios, 27 reglas,
> 18 casos límite, 9 incongruencias) y sobre los tres artefactos de F-041, que
> cerró. Esta arquitectura **cierra las siete cosas que la spec le reservó** en
> su § «No decidido a propósito» y en su lista de incongruencias, **contesta la
> AP2 que F-041 dejó abierta** («una ruta pública que sirva geometría tiene
> sentido el día que F-042 lo necesite») y **no reabre** ninguna de las ocho
> decisiones del humano del 2026-09-09 (D1 a D8) ni la ADR 0011.
>
> Convención de este documento, la misma que usó F-041: un archivo que **ya
> existe** va entre comillas invertidas; uno que **se va a crear** va sin
> comillas y con «(por crear)» detrás, y siempre con su ruta completa desde la
> raíz del repositorio (AGENTS.md § Cosas que muerden, las dos mitades de la
> trampa de `check:harness`, que ya mordió en F-007, F-010, F-011 y F-017).
>
> Lo que **no** decide este documento y no hay que buscar aquí: la disposición
> de la pantalla, los estados del selector y del mapa, los textos y los
> breakpoints. Son de `sdd-designer`, que escribe `.agent/specs/F-042/design.md`
> en paralelo. Aquí están las capas, los contratos, los módulos y los datos.

## Estado actual relevante

Leído en el código, no supuesto. Lo que se reutiliza tal cual y lo que hay que
tocar:

| Pieza                                                                | Qué es hoy                                                                                                            | Qué hace F-042                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/features/zones/catalog.ts`                                      | `findZone`, `isKnownZoneCode`, `isRetiredZone`, `ZONE_INDEX_VERSION`, `ZONE_INDEX_COUNTS`, `ZONE_CODE_PATTERN`        | Se usa tal cual. Gana **un** importador nuevo, de servidor                           |
| `src/features/zones/zone-index.json`                                 | 184 filas, 39 166 bytes, `version: "1.0.0"`, 168 municipios y 16 de primer nivel                                      | No se toca. Es la fuente de `name`, `level` y `provinceCode` de la cobertura         |
| `src/features/zones/precedence.ts`                                   | `resolveZoneTariff(zone, rows)` pura: `served`, `deliveryFee` como cadena, `decidedBy`, camino                        | Se usa tal cual, **168 veces por render**, con dos filas por llamada                 |
| `src/features/zones/server/tariffs.ts`                               | `resolveStoreZoneTariff(db, storeId, zoneCode)`: 1 consulta, ≤2 filas, por la clave primaria                          | **No se usa en el camino caliente** (§ Decisión AD2, alternativa descartada)         |
| `src/features/zones/boundaries.test.ts`                              | Lista blanca de 8 importadores del índice, y ninguno en un árbol de cliente                                           | La lista crece a 9, todos de servidor (E25/C15)                                      |
| `eslint.config.mjs`                                                  | `no-restricted-imports` del índice para `src/components/**` y `src/app/**/*.tsx`                                      | **No se relaja** (D5). Ni una línea                                                  |
| `src/features/orders/deliveryOffer.ts`                               | `isDeliveryOffered` devuelve `false` en `ZONE_BASED`; `deliveryFeeForNewOrder` **lanza** en `ZONE_BASED` + `DELIVERY` | Las dos ramas se sustituyen (I3, I4). El módulo sigue puro y sin Prisma              |
| `src/features/cart/components/CheckoutForm.tsx`                      | 927 líneas, `"use client"` en la 1; lee `quote.store.deliveryFee` en **dos** sitios (`:331`, `:453`)                  | Gana la prop de cobertura, el selector y el importe por zona. Los dos sitios cambian |
| `src/app/[slug]/checkout/page.tsx`                                   | `force-dynamic`, `revalidate = 0`; pasa **solo** `storeId` y `storeSlug` al island                                    | Carga la cobertura en servidor y la pasa como tercera prop (D5)                      |
| `src/features/orders/server/quote.ts`                                | `loadStoreForOrder` + `quoteCart`; nada cacheado; `QuoteStore` viaja con `deliveryFeeMode`                            | **No se toca** (§ Decisión AD3, alternativa descartada)                              |
| `src/features/orders/server/createOrder.ts`                          | 7 pasos, sin `$transaction`; `deliveryAddress` solo si `isDelivery`; `rateSnapshot` como precedente de instantánea    | Dos pasos nuevos entre el 4 y el 5, y dos columnas en el `create`                    |
| `src/features/orders/schemas.ts`                                     | `createOrderRequestSchema` con un `superRefine` que exige `deliveryAddress` en `DELIVERY`                             | Dos claves opcionales más. La zona **no** se valida aquí (E18)                       |
| `src/features/orders/types.ts`                                       | Tipos del cable, **sin Zod**, importados por los islands                                                              | `CreateOrderBody`, `CreateOrderError` y el `409` crecen                              |
| `src/app/api/orders/route.ts`                                        | `switch` sobre `CreateOrderResult`, `NO_STORE` en cada respuesta                                                      | Dos `case` nuevos                                                                    |
| `src/features/orders/server/pulledOrder.ts`                          | `PULLED_ORDER_SELECT` + `toPulledOrder`; `contact` con cuatro claves; `deliveryFeePending = deliveryFee === null`     | `contact` pasa a **seis** claves, siempre presentes (R22)                            |
| `src/lib/cache.ts`, `src/features/sync/server/processBatch.ts`       | La invalidación por lote de F-035, y `revalidateStores` una vez por lote                                              | **Cero líneas** (§ Decisión AD8)                                                     |
| `src/lib/slug.ts`                                                    | `slugify` con `normalize("NFD")` + tira marcas combinantes                                                            | Ese paso se extrae a un módulo propio y se comparte (R6)                             |
| `src/lib/env.ts`                                                     | `publicEnv` con tres claves `NEXT_PUBLIC_*`                                                                           | Gana las dos del proveedor de teselas (D2)                                           |
| `scripts/check-bundle-budget.mjs`                                    | Recorre **solo** HTML prerenderizado de `.next/server/app`                                                            | **No mide el checkout** y no se toca (I1). `BUDGET_KB` se queda en 193               |
| `scripts/check-image-budget.mjs`                                     | Precedente literal de un guion que mide bytes contra la app levantada, llamado desde `smoke`                          | Se calca para la geometría (C6)                                                      |
| `next.config.ts`                                                     | `images.unoptimized`, `typescript.ignoreBuildErrors: false`                                                           | Gana `outputFileTracingIncludes` para la ruta de geometría                           |
| `docs/adr/0033-cobrar-el-domicilio-y-ofrecerlo-son-dos-preguntas.md` | En **Propuesta**; su § «Reabrir cuando» nombra este día con estas palabras                                            | Nota fechada + pasa a **Aceptada** (I3, § ¿Hace falta una ADR?)                      |

Y lo que **no** existe y hay que crear entero: el artefacto de geometría y su
procedencia, el guion que lo genera, la ruta que lo sirve, el conjunto ofrecible
de una sucursal, el selector, el mapa, las dos columnas de `Order` y las dos
claves del pull.

**Un hecho del índice que decide dos cosas de abajo**: la Isla de la Juventud
está en OSM en `admin_level=4` y **no** en 6, así que `40` y `40.01` comparten la
relación `1854614` (184 filas, 183 relaciones). La geometría de `40.01` **es** la
de la relación de primer nivel, y la comprobación «los municipios de una
provincia reconstruyen la provincia» es una tautología para `40` — va escrito
para que nadie lo lea como un fallo (R17, I9 de F-041).

## Decisión

**La forma general, en una frase: el conjunto ofrecible se calcula en servidor
de una sola consulta y viaja como datos hasta el island; la geometría son bytes
commiteados de grano municipio que una ruta compone por cobertura sin parsear
nada; y ninguna de las dos mitades vuelve a resolver la precedencia por su
cuenta.**

Nueve decisiones, cada una con lo que se descartó y por qué.

### AD1 — La geometría: fuente, herramienta, formato, dónde vive y cómo se sirve

Es la pieza más grande y la que más puede salir mal, así que va partida en cinco
respuestas.

**(a) La herramienta es `mapshaper`, fijada a una versión exacta como
`devDependency`, usada como librería (`applyCommands`) desde un guion `tsx`.**
Es la única de las candidatas que hace **topología compartida por construcción**:
al importar, construye un grafo de arcos comunes entre polígonos vecinos y
`-simplify` opera **sobre los arcos**, no sobre cada anillo, así que la frontera
entre Playa y Marianao se simplifica **una vez** y las dos vecinas heredan la
misma línea — que es exactamente lo que R15 exige y lo que ningún bucle
consigue. Descartadas, cada una por su motivo real:

- `ogr2ogr` (GDAL): instalación nativa, y su `-simplifypreservetopology`
  preserva la topología **de cada geometría por separado**, no la compartida
  entre features. Es literalmente el fallo que R15 describe, con un nombre de
  bandera que promete lo contrario.
- `topojson` (`geo2topo` + `toposimplify` + `topoquantize`): sí es topológico y
  sí serviría, pero son tres paquetes encadenados, no limpia la fuente y no sabe
  hacer las dos comprobaciones de R15; con mapshaper todo cabe en un proceso.
- `shapely` / `osmium`: la primera simplifica por geometría (mismo fallo) y el
  segundo no simplifica en absoluto, solo extrae.
- `ST_CoverageSimplify` de PostGIS: es la respuesta técnicamente más elegante y
  está **prohibida aquí**, porque meter PostGIS por la puerta de atrás reabre la
  ADR 0011 sin su disparador escrito. No se propone ni como plan B.

Con ella entra una segunda `devDependency`, `osmtogeojson`, que convierte la
respuesta de Overpass (`out geom;`) en polígonos, montando los anillos de una
relación multipolígono. Descartado hacerlo a mano: el ensamblado de anillos de
una relación de OSM es exactamente el tipo de código que se escribe mal una vez
y se descubre en la frontera de un municipio.

**(b) La fuente es OSM, por id de relación, y se descarga una vez.** El índice ya
trae `osmRelationId` para las 184 filas, que es para lo que existe (ADR 0032
(b)). La descarga se hace **por relación**, no por fila: 183 relaciones para 184
filas, y la asignación relación → códigos se hace con un mapa `code →
relationId` invertido, así que la Isla de la Juventud se descarga **una** vez y
alimenta a `40` y a `40.01` (R17). Se descargan **los dos niveles**: los 16 de
primer nivel hacen falta para la comprobación (1) de R15, no para servir.

**(c) El formato es GeoJSON de grano municipio, un fichero por zona, con un
manifiesto.** El directorio src/features/zones/geometry/ (por crear) contiene
`manifest.json` y 168 ficheros `<code>.json`, cada uno **un Feature completo** y
autosuficiente. La razón de fondo: **servir una cobertura es concatenar cadenas,
sin parsear ni un byte de geometría**, y el coste de la ruta es exactamente el de
los bytes que devuelve. Descartadas:

- **Un solo GeoJSON del país** (~2,4 MB estimados): importarlo estáticamente son
  ~40 MB de heap y ~30 ms de parseo por instancia, para una ruta que se pide unas
  pocas veces por hora; y filtrarlo en el navegador rompe E8.
- **TopoJSON servido entero**: comprime mucho mejor porque no duplica las
  fronteras compartidas, pero sus arcos son **globales**, así que recortar una
  cobertura obliga a re-arquear en cada petición, y además mete
  `topojson-client` (~3 KB gzip) en el trozo del mapa. La ventaja de la topología
  ya está cobrada en la **generación**: como las dos copias de una frontera
  compartida salen del mismo arco simplificado, en GeoJSON son **byte a byte
  iguales** y no hay ni huecos ni solapes. El precio es ~2× en coordenadas de
  frontera interior, acotado y medido.
- **Un fichero por provincia** (16): para servir cuatro municipios habría que
  parsear una provincia entera.
- **Un NDJSON con índice de desplazamientos**: el mismo beneficio, pero un editor
  que toque un byte corrompe **todos** los desplazamientos en silencio.
- **168 activos estáticos que el navegador pida uno a uno**: se cachearían en el
  CDN gratis, pero una cobertura de país serían 168 peticiones y C6 dejaría de
  poder contar «cuatro zonas en la respuesta».

**(d) La precisión y la tolerancia son dos pérdidas, no una, y van emparejadas.**
Simplificación **Visvalingam por área ponderada con `interval=100` metros**
—suficiente para un selector de municipios que se mira entre z9 y z12— y
redondeo a **4 decimales** (`precision=0.0001`, ≈11 m en esta latitud), que es
un orden de magnitud más fino que la tolerancia. Las dos se aplican **en la misma
tubería y sobre el conjunto entero**, y las dos comprobaciones corren **después
del redondeo**, sobre los bytes tal como se commitean: comprobar un intermedio
sería comprobar un fichero que nadie usa. Antes de simplificar, un `snap` de
importación (≈1 m) une los vértices casi coincidentes, porque dos relaciones
vecinas de OSM **no siempre comparten las mismas vías**, y sin ese paso el grafo
de arcos no encuentra la frontera común y la topología no se comparte aunque la
herramienta sea la correcta. Es el detalle que hace que (a) funcione de verdad.

**(e) Se sirve por una ruta propia que deriva la cobertura del slug, y esa es la
respuesta a la AP2 de F-041.** `GET /api/zones/geometry/{slug}` —
src/app/api/zones/geometry/[slug]/route.ts (por crear) — resuelve el slug con el
resolutor único, calcula el conjunto ofrecible con **una** consulta, y compone un
`FeatureCollection` concatenando los ficheros de esas zonas. F-041 escribió que
esa ruta «tiene sentido el día que F-042 la necesite»: ese día es hoy, y la
necesita por tres razones que ninguna alternativa cubre a la vez —la cobertura
depende del tarifario y por tanto de la base; el catálogo no puede entrar en el
bundle (D5); y nada se puede descargar antes de abrir el mapa (R14)—.
Descartadas: **los códigos en la URL** (`?codes=23.01,…`), que haría la respuesta
cacheable en el CDN sin tocar la base pero dejaría que el cliente pidiera
cualquier cobertura, con lo que R13 pasaría de invariante del servidor a
convención del llamador; y **un `s-maxage` corto**, que dejaría el mapa
enseñando durante un minuto una zona que la lista —que es dinámica— ya no ofrece.
La ruta va con `cache-control: no-store`.

### AD2 — I4: `isDeliveryOffered` recibe el hecho, no lo busca

`src/features/orders/deliveryOffer.ts` es puro y lo importa el island
(`src/features/cart/components/CheckoutForm.tsx:31`). La pregunta de verdad
necesita el tarifario, que está en Postgres. **La función gana un segundo
parámetro obligatorio** con el hecho ya resuelto:

```ts
isDeliveryOffered(config: DeliveryConfig, coverage: ZoneCoverageFact): boolean
```

`ZoneCoverageFact` es `{ hasResolvableZone: boolean }`, y **quien lo calcula es
siempre un `server/`**. Tres propiedades que esta forma da y las alternativas no:

1. **Obligatorio, no opcional con defecto.** Un segundo parámetro con
   `= { hasResolvableZone: false }` compilaría en las tres llamadas de hoy y
   contestaría «esta tienda no ofrece domicilio» en silencio. Obligatorio,
   `npm run typecheck` **nombra** los tres sitios que tienen que contestar.
2. **No entra en `DeliveryConfig`.** Ese tipo lo construye también el sync
   (`assertDeliveryConsistent` en
   `src/features/sync/server/handlers/store.ts`), que no conoce el tarifario y
   no debe conocerlo: es la separación entera de la ADR 0033. Un campo nuevo en
   `DeliveryConfig` obligaría al handler del sobre a inventarse un valor.
3. **`hasSomethingToChargeDeliveryWith` e `isDeliveryConfigInconsistent` no
   cambian de firma.** Cero churn en el sync.

Descartadas: **meter Prisma en `deliveryOffer.ts`** (lo prohíbe AGENTS.md
§ Prohibiciones y lo impone ESLint, y arrastraría el cliente al bundle);
**una función nueva `isZoneDeliveryOffered` solo para `ZONE_BASED`** (dos
funciones que contestan la misma pregunta según el modo es la divergencia que la
cabecera del propio módulo documenta); y **preguntarle a la base desde el
island por `fetch`** (una petición más, y la respuesta llegaría después del
primer pintado, con la opción de domicilio apareciendo tarde).

### AD3 — La cobertura se calcula una vez, en servidor, y viaja como datos

Un módulo nuevo con **dos mitades**: la pura, src/features/zones/coverage.ts (por
crear), que define `OfferableZone` y las funciones que el island y el servidor
comparten; y la de datos, src/features/zones/server/coverage.ts (por crear), con
`loadStoreZoneCoverage(db, storeId)`: **una** consulta que trae el modo de envío
de la sucursal y sus filas de tarifario, y devuelve `null` cuando la tienda no es
`ZONE_BASED` con domicilio. Sobre esas filas se aplica `resolveZoneTariff` a los
**168 municipios** del índice, con dos filas por llamada (la del municipio y la
de su provincia), que es la lectura literal de R2: el tarifario se lee **una vez**
y la resolución se aplica sobre él, sin una consulta por municipio.

`src/app/[slug]/checkout/page.tsx` lo llama y pasa el resultado a `CheckoutForm`
como prop. Eso es lo que hace que **los nombres estén en el HTML que manda el
servidor** (D5, C1: `curl` y contar) sin que ningún módulo del árbol de cliente
importe `src/features/zones/catalog.ts` (E25, C15).

Descartadas:

- **Meter la cobertura en `QuoteStore`** (`src/features/orders/server/quote.ts`):
  el island cotiza en cada cambio del carrito y con rebote, así que la consulta
  del tarifario se pagaría varias veces por checkout en vez de una; y los nombres
  llegarían **después** del primer pintado, por JSON, que es justo lo que D5 no
  quiere.
- **Añadir `deliveryFeeMode`/`deliveryEnabled` a `StoreSummary`**
  (`src/features/catalog/server/queries.ts`) para saber si hace falta la consulta:
  esa lectura está **cacheada** con `storeTag`, y una entrada cacheada de antes
  del despliegue devolvería los campos nuevos como `undefined` —el mismo caso que
  `CachedStore` ya parchea para `displayCurrencies`—, con el resultado de que una
  tienda `ZONE_BASED` apagaría su domicilio durante una hora sin que nada falle.
  Se prefiere pagar **una consulta fresca por render** de una página que ya es
  `force-dynamic`.
- **`resolveStoreZoneTariff`** (`src/features/zones/server/tariffs.ts`) zona a
  zona: son 168 consultas por render. Se conserva intacta y se usa **solo** en el
  camino de creación del pedido, donde la zona es una y ya se conoce… y ni
  siquiera ahí, porque `createOrder` necesita además saber si hay **alguna** zona
  resoluble (E20), y las dos preguntas salen de la misma lectura.

### AD4 — `deliveryFeeForNewOrder` deja de lanzar y devuelve un caso

Hoy lanza en `ZONE_BASED` + `DELIVERY` porque era inalcanzable. Este feature
alcanza esa rama, y sustituir el `throw` por «devuelve el importe de la zona»
dejaría sin respuesta el caso de E17 —domicilio sin zona— salvo con otro `throw`.
La función pasa a devolver un **resultado discriminado**:

```ts
type NewOrderDeliveryFee =
  | { kind: "charged"; amount: string } // "0.00" incluido: envío gratis
  | { kind: "not_quoted" } // QUOTED_PER_ORDER + DELIVERY
  | { kind: "zone_required" }; // ZONE_BASED + DELIVERY sin zona resuelta
```

Así **el compilador** obliga a los dos llamadores a contestar los tres casos, en
vez de un `null` que hay que recordar comparar contra `null` y un `throw` que
solo se ve en producción. Es la misma lección de R10 aplicada al tipo: el `0.00`
de envío gratis viaja **dentro** de `charged`, donde ningún `if (!fee)` lo puede
convertir en «no hay importe». Descartadas: **devolver `string | null` con la
zona resuelta por dentro** (`null` volvería a significar dos cosas: sin cotizar y
sin zona); y **dejar el `throw`** (un `500` en el único endpoint público de
escritura, en el camino feliz de una configuración legal).

### AD5 — La lista se renderiza en servidor; el mapa se carga al pedirlo

El selector (src/features/zones/components/ZonePicker.tsx, por crear) es un
componente de cliente que **recibe** las zonas ya resueltas y no pide nada a la
red: filtrar es un `includes` sobre ≤168 cadenas ya plegadas en memoria (E3, C5).
El mapa vive detrás de un `next/dynamic` con `ssr: false` **dentro** del
selector, apuntando a src/features/zones/components/ZoneMap.tsx (por crear), que
es el **único** módulo que importa `leaflet`, `react-leaflet` y
la hoja de estilos que Leaflet publica en su propio paquete. El trozo, con su CSS, solo se pide cuando ese
componente se **renderiza** por primera vez, y la petición de geometría la hace
él mismo: por construcción, nada de esto existe en la carga inicial (R14, E7).

`ssr: false` no es una preferencia: Leaflet toca `window` al importarse.

Descartadas: **un `import()` a mano dentro de un `onClick`** (funciona, pero deja
el estado de carga y el de error escritos a mano en un island de 900 líneas);
**cargar Leaflet siempre y ocultar el mapa con CSS** (mata E7 y el criterio 5);
y **dibujar los polígonos en un `<svg>` propio sin Leaflet** (ahorraría ~45 KB
gzip, y a cambio habría que escribir proyección, zoom, arrastre y el
punto-en-polígono a mano; con D2 tomada, no se propone).

### AD6 — `Order` gana dos columnas de texto, anulables, **sin clave ajena**

`deliveryZoneCode` y `deliveryZoneName`. El prefijo `delivery` no es adorno: en
`Store` ya existe un `zoneCode` que significa **la zona de la tienda**, y en
`Order` la zona es la del **destino**, junto a `deliveryAddress` y
`deliveryFee`. Sin clave ajena a `Zone`, a diferencia de `ZoneTariff.zoneCode` y
`Store.zoneCode`, por dos razones que solo valen aquí:

1. **Un pedido es un documento histórico y no puede depender del estado presente
   de una tabla de referencia.** El nombre ya está congelado (R19): la fila no
   necesita al catálogo para explicarse nunca más.
2. **El precio de equivocarse es distinto.** Un `ZONE_TARIFF` que falla la clave
   ajena en un entorno sin sembrar vuelve en `failed[]` y se reintenta; un
   `INSERT` de `Order` que la falla es una **venta perdida** con un `500` en el
   único endpoint público de escritura (ADR 0016). Y la validación que de verdad
   protege ya está antes y es más fuerte: el código tiene que estar en el
   **conjunto ofrecible**, que sale del índice y del tarifario, no de la tabla.

No lleva índice: no existe —ni en el backlog— ninguna consulta «pedidos por
zona». Escrito para que no parezca un olvido. Y **no** se congela la versión del
catálogo junto al nombre: el criterio 3 no lo pide, el nombre ya basta para leer
un pedido viejo, y una tercera columna que nadie lee es la que I5 llama peor que
no tenerla.

### AD7 — Dos errores nuevos, distinguibles entre sí y de `PRICE_CHANGED`

`DELIVERY_ZONE_REQUIRED` (`400`) y `DELIVERY_ZONE_NOT_SERVED` (`409`), con la
tabla entera en § Contratos 5. La zona **no** se valida contra el catálogo en el
schema Zod: E18 exige que un código inventado y uno real pero no ofrecible sean
**el mismo hecho** para el comprador, y validarlo en el schema lo convertiría en
un `INVALID_BODY` distinguible. Además evita meter
`src/features/zones/catalog.ts` en `src/features/orders/schemas.ts`, que sería un
importador más de la lista blanca sin ganar nada.

### AD8 — La invalidación: cero líneas nuevas

La página del checkout es `force-dynamic` con `revalidate = 0` y la cobertura se
lee **fresca** en cada render (AD3), así que un `ZONE_TARIFF` aplicado se ve en la
primera visita posterior sin depender de ningún tag ni del suelo de
`STOREFRONT_REVALIDATE`. La ruta de geometría es `no-store` y deriva la cobertura
en cada petición. Lo que se apoya en F-035 **sin reimplementarlo**: la
invalidación una vez por lote y por sucursal que ya vive en
`src/features/sync/server/processBatch.ts` con `revalidateStores`
(`src/lib/cache.ts`), que F-041 ya dispara desde el handler de `ZONE_TARIFF`
reportando el slug canónico. Sigue haciendo falta —expira las páginas de catálogo
de la sucursal— y F-042 **no la toca**: ni una línea en `src/lib/cache.ts`, ni un
`revalidateTag` nuevo, ni un tag nuevo. Su prueba es la que ya existe,
`src/features/sync/server/processBatch.invalidationCount.test.ts`.

### AD9 — Las teselas entran por `publicEnv`, y la regla del par vive en una función pura

`src/lib/env.ts` gana `NEXT_PUBLIC_MAP_TILE_URL_TEMPLATE` y
`NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` en `publicEnv`, que es el patrón que el
repositorio ya tiene para lo que el navegador puede leer. La **regla del par**
—las dos o ninguna— se decide en una sola función pura,
src/features/zones/tiles.ts (por crear), con tres tests: las dos puestas → el
proveedor alternativo; una sola → OSM con el crédito de OSM; ninguna → OSM. Los
valores por defecto de OSM son constantes en src/constants/zones.ts (por crear),
no cadenas sueltas (AGENTS.md § Prohibiciones). Consecuencia que va a
`docs/despliegue.md`: `NEXT_PUBLIC_*` se **inlinea en el build**, así que cambiar
de proveedor exige volver a desplegar, no solo reiniciar. Descartado pasarlas
como props desde el servidor: se evitaría el rebuild, a cambio de enhebrar dos
cadenas por un componente que no las usa y de tener la regla del par evaluada en
dos sitios.

## Componentes

Las capas son las de AGENTS.md § Arquitectura. Ninguna pieza la rompe: lo único
que toca Prisma vive en un `server/`, y ningún componente importa el índice.

| Componente                  | Capa                             | Responsabilidad                                                                                                                                                                                     | Archivo                                                               |
| --------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Artefacto de geometría      | artefacto (datos)                | 168 ficheros `<code>.json`, cada uno un `Feature` con `properties: { code }` y nada más, más el manifiesto con la procedencia                                                                       | src/features/zones/geometry/ (por crear)                              |
| Procedencia de la geometría | documentación                    | Volcado de OSM con fecha, `admin_level`, proyección, snap, tolerancia, **que fue topológica**, herramienta y versión, precisión decimal, hashes, recuentos y el resultado de las dos comprobaciones | src/features/zones/geometry.provenance.md (por crear)                 |
| Generador                   | `scripts/`                       | Descarga por relación (183), convierte, snap, simplifica **en una operación**, redondea, corre las **dos** comprobaciones y escribe los 169 ficheros                                                | scripts/build-zone-geometry.ts (por crear)                            |
| Lector de la geometría      | `src/features/zones/server/`     | Lee el manifiesto una vez, sirve `<code>.json` **como cadena**, memoiza y **nunca parsea** la geometría                                                                                             | src/features/zones/server/geometry.ts (por crear)                     |
| Ruta pública de geometría   | `src/app/`                       | Resuelve el slug, pide la cobertura, concatena y responde `no-store`. Cero lógica de negocio                                                                                                        | src/app/api/zones/geometry/[slug]/route.ts (por crear)                |
| Cobertura (pura)            | `src/features/zones/`            | `OfferableZone`, `distinctProvinces`, `findZoneInCoverage`, `matchesZoneQuery`. Sin catálogo, sin Prisma, sin React                                                                                 | src/features/zones/coverage.ts (por crear)                            |
| Cobertura (datos)           | `src/features/zones/server/`     | `loadStoreZoneCoverage(db, storeId)`: **una** consulta, 168 resoluciones puras, `null` si la tienda no es `ZONE_BASED`                                                                              | src/features/zones/server/coverage.ts (por crear)                     |
| Plegado de texto            | `src/lib/`                       | `stripDiacritics` y `foldForSearch`, extraídos de `slugify` para no escribir el truco Unicode dos veces (R6)                                                                                        | src/lib/text.ts (por crear)                                           |
| Teselas                     | `src/features/zones/`            | `resolveTileLayer(env)`: la regla del par, pura                                                                                                                                                     | src/features/zones/tiles.ts (por crear)                               |
| Constantes de zona          | `src/constants/`                 | URL y atribución de OSM, tope de longitud del código en el cuerpo, id del trozo del mapa                                                                                                            | src/constants/zones.ts (por crear)                                    |
| Selector                    | `src/features/zones/components/` | Escritura predictiva, paso de provincia si procede, desambiguación por provincia, y el control que abre el mapa                                                                                     | src/features/zones/components/ZonePicker.tsx (por crear)              |
| Mapa                        | `src/features/zones/components/` | El **único** importador de Leaflet y de su CSS; pide la geometría, pinta, confirma en texto y emite un `code`                                                                                       | src/features/zones/components/ZoneMap.tsx (por crear)                 |
| Checkout                    | `src/features/cart/components/`  | Compone el selector, calcula el importe con la función compartida y envía `zoneCode`                                                                                                                | `src/features/cart/components/CheckoutForm.tsx`                       |
| Página del checkout         | `src/app/`                       | Carga la cobertura en servidor y la pasa como prop (D5)                                                                                                                                             | `src/app/[slug]/checkout/page.tsx`                                    |
| Vocabulario del envío       | `src/features/orders/`           | `isDeliveryOffered` con el hecho; `deliveryFeeForNewOrder` con resultado discriminado                                                                                                               | `src/features/orders/deliveryOffer.ts`                                |
| Creación del pedido         | `src/features/orders/server/`    | Resuelve la zona contra la base **en ese instante**, escribe las dos columnas y devuelve los dos errores nuevos                                                                                     | `src/features/orders/server/createOrder.ts`                           |
| Cuerpo y errores del cable  | `src/features/orders/`           | `zoneCode` y `expectedDeliveryFee` en el cuerpo; los dos errores; el `409` con el envío nombrado                                                                                                    | `src/features/orders/types.ts`, `src/features/orders/schemas.ts`      |
| Mapeo HTTP                  | `src/app/`                       | Dos `case` nuevos del `switch`                                                                                                                                                                      | `src/app/api/orders/route.ts`                                         |
| Pull                        | `src/features/orders/server/`    | Dos claves más en `contact`, **siempre presentes** (R22)                                                                                                                                            | `src/features/orders/server/pulledOrder.ts`                           |
| Migración                   | `prisma/migrations/`             | Dos `ADD COLUMN`, sin enum, sin clave ajena, sin índice                                                                                                                                             | prisma/migrations/<ts>\_order_delivery_zone/migration.sql (por crear) |
| Medidor de la geometría     | `scripts/`                       | Mide bytes y **cuenta polígonos** contra la app levantada (C6), calcado de `scripts/check-image-budget.mjs`                                                                                         | scripts/check-geometry-budget.mjs (por crear)                         |

Y los tests, que son de `sdd-tester` pero cuyo **sitio** decide esta
arquitectura, porque de él depende en qué proyecto de Vitest corren
(`vitest.config.mts`: `*.test.ts` → `server`, `*.test.tsx` → `ui`,
`*.db.test.ts` → `db`):

| Test                                                               | Proyecto | Qué cierra                                                                                                                        |
| ------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| src/features/zones/coverage.test.ts (por crear)                    | server   | R1, R5, R6, R7: ofrecible, provincias distintas, plegado sin tildes                                                               |
| src/features/zones/server/coverage.db.test.ts (por crear)          | db       | C1, C9: filas reales, `NOT_SERVED` bajo `FEE`, tarifario vacío, solo `INHERIT`                                                    |
| src/features/zones/geometry.test.ts (por crear)                    | server   | Caso límite 16: el manifiesto tiene **exactamente** los 168 municipios del índice, cada hash cuadra, cada fichero es un `Feature` |
| src/features/zones/tiles.test.ts (por crear)                       | server   | R18: las tres combinaciones del par                                                                                               |
| `src/features/zones/boundaries.test.ts`                            | server   | C15/E25: la lista blanca crece a 9 y ninguno es de cliente                                                                        |
| `src/features/orders/deliveryOffer.test.ts`                        | server   | I3/I4/C10: el segundo parámetro, y que `ZONE_BASED` **no puede** dar `not_quoted`                                                 |
| src/features/orders/server/createOrder.zone.db.test.ts (por crear) | db       | C3, C10, C13, C14: instantánea del nombre, importe del servidor, `409`, zona retirada                                             |
| src/features/orders/server/pulledOrder.zone.db.test.ts (por crear) | db       | C4, E22, E23                                                                                                                      |
| src/app/api/zones/geometry/[slug]/route.test.ts (por crear)        | server   | Cobertura exacta, `no-store`, código desconocido, cobertura vacía                                                                 |
| src/features/zones/components/ZonePicker.test.tsx (por crear)      | ui       | E2, E3, E6, R7 sobre el DOM                                                                                                       |
| .agent/specs/F-042/smoke.sh (por crear)                            | —        | C6 vía scripts/check-geometry-budget.mjs (por crear)                                                                              |
| .agent/specs/F-042/visual.mjs (por crear)                          | —        | C2, C5, C7, C8: peticiones de la página, y el contexto sin JavaScript                                                             |

## Flujo de datos

### A. Se abre el checkout de una tienda `ZONE_BASED`

```mermaid
sequenceDiagram
  participant B as Navegador
  participant P as app/[slug]/checkout/page.tsx
  participant C as zones/server/coverage
  participant DB as Postgres
  participant I as zones/catalog (bytes)
  participant F as CheckoutForm (island)
  B->>P: GET /tienda/checkout (force-dynamic)
  P->>C: loadStoreZoneCoverage(prisma, store.id)
  C->>DB: findUnique(Store) + zoneTariffs anidados — UNA consulta
  C->>I: los 168 municipios: name, level, provinceCode — CERO consultas
  C->>C: resolveZoneTariff(zona, [su fila, la de su provincia]) x168 — PURO
  C-->>P: OfferableZone[] ordenado, o null si no es ZONE_BASED
  P-->>B: HTML con los nombres YA dentro (D5, C1)
  F->>F: hidrata; cotiza aparte (quote), sin tarifario
```

Dos cosas que ese diagrama fija y que son fáciles de romper: el nivel y la
provincia salen **del índice** y no de la tabla `Zone` —igual que en el § Flujo C
de F-041—, y `resolveZoneTariff` recibe **como mucho dos filas** por llamada, no
las 184, porque las filas se indexan por `zoneCode` **una** vez antes del bucle.

### B. El comprador abre el mapa

```
[click en «no sé mi municipio»]
  └─ next/dynamic(ssr:false) descarga el trozo del mapa (Leaflet + CSS + ZoneMap)
       └─ GET /api/zones/geometry/{slug}
            ├─ resolvePublicSlug(slug) → storeId canónico
            ├─ loadStoreZoneCoverage(...)   ← UNA consulta, la misma función que A
            ├─ readZoneGeometry(code) por cada zona ofrecible   ← cadenas, sin parsear
            └─ 200 { "type":"FeatureCollection", "version":…, "features":[…] }
       └─ <GeoJSON> + <TileLayer> + atribución SIEMPRE visible
            ├─ click en un polígono → onEachFeature → code tentativo
            ├─ click fuera de todo   → el evento del mapa → «no llegamos ahí» (E11)
            └─ confirmar en texto → onConfirm(code) → sube al selector (E10)
```

**No hay punto-en-polígono escrito por nosotros**, ni en servidor ni en cliente:
Leaflet dispara el `click` de la capa del polígono tocado y, si no hay ninguno, el
del mapa. Es lo que hace que ninguna coordenada llegue nunca al servidor y lo que
mantiene la ADR 0011 cerrada sin discusión.

### C. Se confirma el pedido

Los pasos de `src/features/orders/server/createOrder.ts` **no se reordenan**: los
dos nuevos entran entre el 4 (cotizar) y el 5 (comparar el total), que es donde
tienen que estar para que un pedido con la zona mal **no gaste una ranura del
límite de abuso** —el mismo argumento escrito que ya justifica el orden actual—.

- **Pasos 1 a 4** (sucursal, tienda cerrada, fusión de líneas, carrito vacío,
  cotización y disponibilidad): igual que hoy, sin tocar una línea.
- **Paso 4.1, nuevo** — si `store.deliveryFeeMode === "ZONE_BASED"`, una
  consulta: `loadStoreZoneCoverage`. Para cualquier otro modo **no se consulta
  nada**.
- **Paso 4.2, nuevo** — se decide `isDelivery` con `isDeliveryOffered` pasándole
  `hasResolvableZone`, y solo si es `true` se mira la zona. Tres desenlaces:
  - `body.zoneCode` ausente → `400` `DELIVERY_ZONE_REQUIRED` (E17, E20).
  - Presente y **no** en el conjunto ofrecible —inventado, retirado, de primer
    nivel, `NOT_SERVED` o de otra tienda: los cinco son el mismo hecho— → `409`
    `DELIVERY_ZONE_NOT_SERVED` (E16, E18, caso límite 14).
  - Presente y ofrecible → `deliveryFeeForNewOrder` con esa zona devuelve
    `charged`, **siempre**, incluido el `"0.00"` de envío gratis.
- **Paso 5** — la comparación de totales, con el importe de la zona ya dentro. Un
  desajuste sigue siendo `409 PRICE_CHANGED`, ahora con el envío nombrado si el
  cliente mandó `expectedDeliveryFee` (E15, C13).
- **Pasos 6 y 7** — igual que hoy, con dos campos más en el `create`:
  `deliveryZoneCode` y `deliveryZoneName` valen la zona elegida cuando el pedido
  se cierra como `DELIVERY` en una tienda `ZONE_BASED`, y `null` en cualquier
  otro caso (R21). El **nombre lo pone el servidor desde el índice**, nunca el
  cuerpo de la petición (R19, R20).

Un reintento con la misma `idempotencyKey` devuelve el pedido ya creado **antes**
de llegar aquí (paso 6 de hoy): no se vuelve a resolver la zona (caso límite 13).

### D. El pull

`toPulledOrder` añade dos claves dentro de `contact`, leídas de las dos columnas
y **sin consultar el catálogo** (E23, caso límite 5). `deliveryFeePending` no
cambia de fórmula: sigue siendo `order.deliveryFee === null`, y en este camino
`deliveryFee` es `NOT NULL` por construcción, así que vale `false` siempre (R11,
C4, C10).

### E. Se genera el artefacto (una vez, no en cada despliegue)

```
scripts/build-zone-geometry.ts
  1. lee el índice → 184 filas → 183 osmRelationId distintos
  2. Overpass: relation(id:…); out geom;  → una respuesta, con su timestamp_osm_base
  3. osmtogeojson → 183 features, etiquetados con SU relación
  4. asigna relación → código(es): 1854614 sirve a `40` y a `40.01` (R17)
  5. mapshaper.applyCommands, UN pipeline sobre TODO el conjunto:
       -i snap snap-interval=0.00001  → fronteras vecinas comparten arcos
       -clean                         → cierra huecos y solapes de la fuente
       -simplify interval=100 keep-shapes weighted
       -o precision=0.0001
  6. COMPROBACIÓN 1 — la unión de los municipios de cada provincia reconstruye
     la provincia: -dissolve2 por provinceCode, -erase en las dos direcciones,
     y el área residual tiene que quedar bajo el umbral. `40` es una tautología
     y se anota como tal.
  7. COMPROBACIÓN 2 — exactamente una zona por punto: rejilla determinista sobre
     el bbox de cada provincia, más sondas a ambos lados de cada vértice de
     frontera, que es donde vive el fallo. Cero puntos en 0 zonas y cero en 2+.
  8. escribe 168 <code>.json + manifest.json + la procedencia con los números
     de 6 y 7. Si 6 o 7 fallan, NO escribe nada.
```

Las dos comprobaciones corren **después** del paso 5 completo, redondeo incluido:
la precisión decimal es una segunda pérdida y comprobar el intermedio sería
comprobar un fichero que nadie va a usar (R16).

## Contratos

### 1. El vocabulario del envío (`src/features/orders/deliveryOffer.ts`)

```ts
/** El hecho que la fila `Store` no puede contestar: lo resuelve SIEMPRE un
 *  `server/` (AD2, I4). Un objeto y no un `boolean` suelto para que la
 *  llamada se lea sola y para que un tercer hecho, si llega, no cambie la
 *  aridad otra vez. */
export type ZoneCoverageFact = { hasResolvableZone: boolean };

/** La zona ya RESUELTA: su importe salió de `resolveZoneTariff` sobre filas
 *  reales, nunca del cliente (R8, E14). */
export type ChosenZone = { code: string; deliveryFee: string };

export type NewOrderDeliveryFee =
  { kind: "charged"; amount: string } | { kind: "not_quoted" } | { kind: "zone_required" };

export function isDeliveryOffered(config: DeliveryConfig, coverage: ZoneCoverageFact): boolean {
  if (!config.deliveryEnabled) return false;
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return config.deliveryFee !== null;
    case "QUOTED_PER_ORDER":
      return true;
    case "ZONE_BASED":
      return coverage.hasResolvableZone; // F-042 — la pregunta de verdad (R1)
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`isDeliveryOffered: unhandled mode ${String(exhaustive)}`);
    }
  }
}

export function deliveryFeeForNewOrder(
  config: DeliveryConfig,
  fulfillment: "PICKUP" | "DELIVERY",
  zone: ChosenZone | null,
): NewOrderDeliveryFee {
  if (fulfillment === "PICKUP") return { kind: "charged", amount: "0.00" };
  switch (config.deliveryFeeMode) {
    case "FLAT_RATE":
      return { kind: "charged", amount: config.deliveryFee ?? "0.00" };
    case "QUOTED_PER_ORDER":
      return { kind: "not_quoted" };
    case "ZONE_BASED":
      // R9: JAMÁS `config.deliveryFee` aquí. Es residuo inerte, y cobrarlo
      // sería el fallo silencioso más caro que este feature puede introducir.
      // R10: la comprobación es contra `null`, no contra un falsy — un
      // `zone.deliveryFee` de "0.00" es envío gratis y entra en `charged`.
      return zone === null
        ? { kind: "zone_required" }
        : { kind: "charged", amount: zone.deliveryFee };
    default: {
      const exhaustive: never = config.deliveryFeeMode;
      throw new Error(`deliveryFeeForNewOrder: unhandled mode ${String(exhaustive)}`);
    }
  }
}
```

`hasSomethingToChargeDeliveryWith` e `isDeliveryConfigInconsistent` **no cambian**:
son la pregunta de la configuración, la del sync, y siguen con un solo argumento.
Ese es el desacoplamiento entero de la ADR 0033 y este feature lo confirma en vez
de deshacerlo.

El island llama a `deliveryFeeForNewOrder` con la zona elegida de sus props, y el
servidor con la que acaba de resolver contra la base: **la misma función, dos
entradas**, y el `409` es lo que las reconcilia. Es la lectura ejecutable de R8, y
lo que impide que la pantalla escriba una segunda copia de la precedencia.

### 2. La cobertura

```ts
// src/features/zones/coverage.ts (por crear) — PURO. Sin catálogo, sin Prisma,
// sin React: lo importan el `server/` que lo construye y el island que lo pinta.
export type OfferableZone = {
  /** Siempre un MUNICIPIO (D3, R3). Es lo único que viaja e identifica. */
  code: string;
  /** El nombre del índice, VERBATIM (R20). La desambiguación de R7 es
   *  presentación y se compone en la pantalla, nunca aquí. */
  name: string;
  provinceCode: string;
  /** Para desambiguar en la lista (R7) y para el paso de provincia (R5). */
  provinceName: string;
  /** Cadena de dos decimales, ya resuelta por `resolveZoneTariff`. `"0.00"`
   *  es envío gratis y es un valor legítimo (R10). Nunca `number`. */
  deliveryFee: string;
};

export function distinctProvinces(
  zones: readonly OfferableZone[],
): readonly { code: string; name: string }[];

/** R5 se decide con esto y con nada más: uno, no hay paso; dos o más, lo hay. */
export function findZoneInCoverage(
  zones: readonly OfferableZone[],
  code: string,
): OfferableZone | null;

/** R6: `query` ya plegado por `foldForSearch`; el nombre se pliega una vez y
 *  se memoiza en la pantalla, no en cada pulsación. */
export function matchesZoneQuery(zone: OfferableZone, foldedQuery: string): boolean;
```

```ts
// src/features/zones/server/coverage.ts (por crear) — lo único que toca Prisma.
export type ZoneCoverageReader = Pick<PrismaClient, "store">;

/** `null` cuando la sucursal no es `ZONE_BASED` o no tiene domicilio: el
 *  llamador no necesita ninguna otra lectura para saberlo. UNA consulta. */
export async function loadStoreZoneCoverage(
  db: ZoneCoverageReader,
  storeId: string,
): Promise<readonly OfferableZone[] | null>;
```

`distinctProvinces` **no viaja** en el payload: la calcula la pantalla con la
misma función pura que usaría el servidor, así que R5 no puede contestarse de dos
maneras. Descartado normalizar `provinceName` fuera de la fila para ahorrar
bytes: gzip ya colapsa la repetición y sería una segunda estructura que mantener.

### 3. El cuerpo de `POST /api/orders` y el `409`

```ts
// src/features/orders/types.ts — sin Zod, lo importan los islands
export type CreateOrderBody = {
  // …lo de hoy…
  /** El MUNICIPIO elegido. Opcional en el tipo y en el schema porque la
   *  mayoría de los pedidos no lleva zona (D3); obligatorio DE HECHO cuando
   *  el pedido se cierra como DELIVERY en una tienda ZONE_BASED, y eso lo
   *  comprueba el servidor, que es el único que conoce el modo. */
  zoneCode?: string;
  /** Lo que el cliente está MOSTRANDO como envío. Se compara solo para
   *  afinar el mensaje del 409 y no se persiste jamás. Precedente literal:
   *  `expectedUnitPrice`. */
  expectedDeliveryFee?: string;
};

export type PriceChangedDelivery = { was: string | null; now: string };

export type CreateOrderError =
  // …lo de hoy…
  | {
      error: "PRICE_CHANGED";
      lines: PriceChangedLine[];
      total: string;
      delivery?: PriceChangedDelivery;
    }
  | { error: "DELIVERY_ZONE_REQUIRED" }
  | { error: "DELIVERY_ZONE_NOT_SERVED"; zoneCode: string };
```

En `src/features/orders/schemas.ts`, **forma y nada más**:

```ts
zoneCode: z.string().trim().min(1).max(ZONE_CODE_MAX_LENGTH).optional(),
expectedDeliveryFee: decimalStringSchema.optional(),
```

Sin `regex` del patrón de zona y **sin** `isKnownZoneCode`: E18 exige que un
código inventado y uno real pero no ofrecible sean indistinguibles para el
comprador, y cualquiera de los dos aquí los separaría en `INVALID_BODY` contra
`DELIVERY_ZONE_NOT_SERVED`. `ZONE_CODE_MAX_LENGTH` vive en src/constants/zones.ts
(por crear). El `superRefine` que ya exige `deliveryAddress` en `DELIVERY` **no
se toca**: la zona no sustituye a la dirección (caso límite 12).

### 4. La ruta de geometría

`GET /api/zones/geometry/{slug}` — src/app/api/zones/geometry/[slug]/route.ts
(por crear). `export const dynamic = "force-dynamic"`, literal (la trampa de
`revalidate`, ficha `.agent/playbook/revalidate-no-literal.md`).

```jsonc
// 200, application/geo+json, cache-control: no-store
{
  "type": "FeatureCollection",
  "geometryVersion": "1.0.0",
  "features": [
    {
      "type": "Feature",
      "properties": { "code": "23.01" },
      "geometry": { "type": "MultiPolygon", "coordinates": [] },
    },
  ],
}
```

Cuatro decisiones sobre esa forma:

- **`properties` lleva `code` y nada más.** El nombre ya está en las props del
  island, que salieron del índice; duplicarlo aquí lo pondría en dos sitios y
  ataría la versión de la geometría a la del índice — y R16 dice que se mueven
  por separado. Un renombrado del catálogo **no** obliga a regenerar polígonos.
- **`FeatureCollection` de verdad**, con `geometryVersion` como miembro
  extranjero: `react-leaflet` lo come tal cual, sin adaptador.
- **Cero zonas es `200` con `features: []`**, no `404`: la tienda existe y su
  cobertura está vacía. Un `404` haría que el mapa dijera «error» donde la verdad
  es «esta tienda no llega a ningún sitio».
- **Una zona ofrecible sin fichero de geometría no se descarta en silencio**
  (caso límite 16): sale en un array `missing` de la respuesta y en un
  `console.warn("[zones] …")` —nunca `console.error`, ficha
  `.agent/playbook/console-error-dispara-guardian-servidor.md`—, y el mapa pinta
  las demás. Que eso no pueda llegar a producción lo garantiza
  src/features/zones/geometry.test.ts (por crear), que exige que el manifiesto
  tenga **exactamente** los 168 códigos de municipio del índice.

### 5. Tabla de errores

| Código                     | Dónde se decide                              | HTTP  | Qué NO ocurre                                                       |
| -------------------------- | -------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `DELIVERY_ZONE_REQUIRED`   | `createOrder`, paso 4.2, sin tocar la base   | `400` | No se crea el pedido y **no** se cobra `0.00` de envío (E17, E20)   |
| `DELIVERY_ZONE_NOT_SERVED` | `createOrder`, paso 4.2, contra la cobertura | `409` | No se crea nada y **nunca** se degrada a recogida en silencio (E16) |
| `PRICE_CHANGED`            | `createOrder`, paso 5 — **ya existe**        | `409` | Gana `delivery` opcional; la pantalla ya sabe reconfirmar (E15)     |
| `INVALID_BODY`             | schema Zod — **ya existe**                   | `400` | La zona **no** llega aquí por ser desconocida, solo por forma (E18) |

Los dos códigos nuevos van a la unión de `src/features/orders/types.ts` y al
`switch` de `src/app/api/orders/route.ts`. `409` para el segundo porque es un
conflicto con el estado actual de la tienda, de la misma familia que
`PRICE_CHANGED` y `STORE_CLOSED`, y reintentable después de cambiar la elección;
`400` para el primero porque es una petición mal formada para esta tienda y la
pantalla nunca debería producirla.

### 6. El artefacto de geometría

```jsonc
// src/features/zones/geometry/manifest.json (por crear)
{
  "version": "1.0.0",
  "generatedAt": "2026-…",
  "indexVersion": "1.0.0", // CON QUÉ índice se cortó — procedencia, NO un aserto
  "projection": "EPSG:4326",
  "snapInterval": 0.00001,
  "simplify": { "method": "visvalingam-weighted", "interval": 100, "topological": true },
  "precision": 0.0001,
  "tool": "mapshaper@X.Y.Z",
  "zones": {
    "23.01": { "sha256": "…", "bytes": 14231, "rings": 3, "vertices": 812 },
  },
  "sha256": "…", // del propio bloque `zones` serializado
}
```

Regla de movimiento de la versión, escrita ahora para no improvisarla: cualquier
regeneración que cambie un polígono mueve la **menor**; un cambio de tolerancia,
de precisión o de método mueve la **mayor**, porque el fichero deja de ser
comparable con el anterior. Se mueve **independientemente** de la del índice
(R16): `indexVersion` se anota como procedencia y **no** se asierta contra
`ZONE_INDEX_VERSION`, porque un renombrado del catálogo no invalida un polígono.
Lo que **sí** se asierta es que los **códigos** coincidan.

El directorio entra en `.prettierignore` en el mismo commit que nace, por el
mismo motivo que `src/features/zones/zone-index.json`: Prettier le cambiaría los
bytes y con ellos los hashes.

### 7. Las teselas

```ts
// src/features/zones/tiles.ts (por crear)
export type TileLayerConfig = { urlTemplate: string; attribution: string };

/** R18/D2 — el par completo o nada. Con una sola de las dos variables se
 *  sirven las teselas de OSM CON el crédito de OSM: nunca las de un tercero
 *  bajo el crédito de otro. La atribución se pinta siempre visible; no hay
 *  bandera para ocultarla y no se acepta una que la esconda. */
export function resolveTileLayer(env: {
  mapTileUrlTemplate: string;
  mapTileAttribution: string;
}): TileLayerConfig;
```

## Modelo de datos y migraciones

```prisma
model Order {
  // …
  /// F-042 R21 — el MUNICIPIO al que se entrega. `null` salvo en un pedido
  /// que se cierra como DELIVERY en una tienda ZONE_BASED, igual que
  /// `deliveryAddress`. SIN clave ajena a `Zone` a propósito
  /// (architecture.md AD6): un pedido es un documento histórico y no puede
  /// depender del estado presente de una tabla de referencia, y una FK
  /// fallida aquí es una venta perdida con un 500 en la única escritura
  /// pública. Lo que valida el código es el conjunto ofrecible, antes.
  deliveryZoneCode String?
  /// F-042 R19/R20 — INSTANTÁNEA del nombre del índice al crear el pedido.
  /// Nunca derivado del código, nunca recalculado al leer: el precedente es
  /// `rateSnapshot`, y la razón es la misma. Es el nombre VERBATIM del
  /// índice, sin la provincia que la pantalla añada para desambiguar (R7).
  deliveryZoneName String?
}
```

DDL, en un solo fichero:

```sql
ALTER TABLE "Order" ADD COLUMN "deliveryZoneCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryZoneName" TEXT;
```

Sin enum nuevo, sin clave ajena, sin índice y **sin backfill**: no hay nada con
qué rellenar los pedidos anteriores (caso límite 18, E22).

Procedimiento, el mismo que F-041 dejó verificado y por los mismos motivos
—`prisma migrate dev` y `prisma migrate reset` no se usan; el segundo está
prohibido en AGENTS.md y el primero, en esta base compartida, lleva al segundo—:

1. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   (ficha `.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`).
2. **Quitar del SQL los cinco `DROP INDEX`** de los índices GIN y parciales que
   no están declarados en el schema, si el diff los propone
   (`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`).
   Aplicarlo sin mirar no pone rojo ningún test: solo deja la búsqueda haciendo
   scans secuenciales en producción.
3. Carpeta a mano, prisma/migrations/<ts>\_order_delivery_zone/migration.sql
   (por crear), y `npx prisma migrate deploy`.
4. La aditividad **no** se comprueba con `migrate diff --exit-code`, que nunca da
   cero en este repositorio por esos mismos índices
   (`.agent/playbook/prisma-migrate-diff-nunca-da-cero-por-indices-no-declarados.md`):
   se comprueba con `git diff main --stat -- prisma/migrations`, que tiene que
   mostrar **solo ficheros nuevos**.

Y lo que **no** cambia y conviene dejar escrito para que nadie lo añada:
`src/features/admin/server/boundaries.test.ts` no crece. Su
`FORBIDDEN_WRITE_COLUMNS` es sobre columnas de `Store` que el panel no comparte
con el sync; estas dos son de `Order` y las escribe la ruta pública de pedidos,
que es su dueña legítima.

## Escalabilidad y límites

Números, no adjetivos. Los de round-trips salen de contar llamadas de Prisma en
los caminos de arriba; los de bytes, de medir lo que hay (39 166 B el índice) y
de estimar lo que se va a generar con el método escrito al lado.

1. **Render del checkout: +1 consulta y ~0,2 ms de CPU.** Un `findUnique` por
   clave primaria con las filas del tarifario anidadas (≤184, techo duro por
   sucursal), 2-4 ms; después, 168 llamadas a `resolveZoneTariff` con **dos**
   filas cada una sobre un `Map` construido una sola vez, que es del orden de
   30 000 operaciones de mapa: bajo 0,5 ms. Con 100× tiendas no cambia: es coste
   por petición, no por catálogo.
2. **Lo que viaja en el HTML: 0,4 KB con cuatro zonas, ~17 KB en claro con las 168.** A ~100 B por zona en JSON (`code`, `name`, `provinceCode`,
   `provinceName`, `deliveryFee`). Comprimido, el peor caso ronda **3 KB** por la
   repetición de `provinceName`. **Cero bytes de bundle**: el catálogo no entra,
   y lo que crece del árbol de cliente es código, no datos.
3. **JavaScript de primera carga: el selector y nada más.** Estimación ~3-4 KB
   gzip (`ZonePicker`, el plegado de texto, y las ramas nuevas de
   `deliveryOffer.ts`). El **trozo del mapa**, ~50 KB gzip (leaflet ≈42,
   react-leaflet ≈5, nuestro componente ≈2) más su CSS ≈4 KB, y **solo al
   abrirlo**. Los tres números se miden con la tabla de rutas de `npm run build`
   y se anotan (C11, E26). `scripts/check-bundle-budget.mjs` **no** mide esta
   página (I1) y `BUDGET_KB` se queda en 193: lo que esa etapa sí protege es que
   el trozo del mapa no acabe referenciado por las páginas de catálogo, que son
   las que sí prerenderizan, y eso hay que mirarlo cuando el número salga.
4. **La geometría: ~2,4 MB en claro estimados para el país, ~14 KB por
   municipio.** Método de la estimación: unos 25 000 km de frontera total
   (costa más límites interiores), un vértice cada ~300 m a `interval=100`,
   duplicando las fronteras interiores por servir GeoJSON y no TopoJSON, y ~19 B
   por par de coordenadas a 4 decimales. **Lo que descarga un comprador**: cuatro
   municipios ≈ **56 KB** en claro, ~17 KB con gzip del servidor; una provincia
   entera (La Habana, 15 municipios) ≈ 210 KB; el país entero ≈ 2,4 MB, que es el
   único caso que roza el objetivo holgado de 1 MB del humano y que **no se
   recorta** (caso límite 9, I9). Palanca si la medición real se dispara, en este
   orden: subir `interval` a 200 m, y solo después bajar a 3 decimales —que a
   ≈110 m dejaría de ser diez veces más fino que la tolerancia y habría que
   subirla con ella—.
5. **La ruta de geometría: 1 consulta + N lecturas de fichero, sin un solo
   `JSON.parse` de geometría.** N es el tamaño de la cobertura. Un `Map` en
   ámbito de módulo memoiza las cadenas ya leídas, así que la segunda petición de
   la misma cobertura es memoria pura; el techo de esa caché es el artefacto
   entero, ~2,4 MB de cadenas por instancia, y solo lo pagan las instancias que
   sirven esta ruta. **Es lo que se rompe primero**: una tienda con cobertura de
   país en una instancia fría son 168 lecturas de fichero (~20-40 ms) y 2,4 MB de
   respuesta. Mitigación identificada y **no** implementada a propósito: pregenerar
   una respuesta por provincia. No se hace porque el caso cubano común son unos
   pocos municipios, y una caché de algo que casi nadie pide es complejidad sin
   dueño.
6. **Creación del pedido: de 5 a 6 round-trips, y solo en `ZONE_BASED`.** La
   consulta extra no se hace para `FLAT_RATE` ni para `QUOTED_PER_ORDER`. Sin
   `$transaction` en ningún punto: el pooler corre en modo transacción (AGENTS.md
   § Cosas que muerden, ficha `.agent/playbook/pooler-transaccion-deadlock.md`).
7. **Filas nuevas: cero tablas y dos columnas de texto anulables.** A 100×
   pedidos, dos `TEXT` cortos por fila; el `ZoneTariff` sigue con el techo de 184
   filas por sucursal que F-041 ya calculó.
8. **La lista del selector con 168 elementos.** Filtrar es `includes` sobre 168
   cadenas ya plegadas y memoizadas: bajo 0,1 ms por pulsación, sin red (E3, C5).
   Repintar 168 nodos está por debajo de 2 ms; no hace falta virtualizar y no se
   virtualiza.
9. **Lo que no escala y no hace falta que escale**: el generador de la geometría
   y sus dos comprobaciones corren fuera de cualquier camino de petición, una vez
   al año a lo sumo.

## Patrones a seguir / antipatrones a evitar

| Hacer                                                                                             | Porque lo impone                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| El importe de envío sale **siempre** de `deliveryFeeForNewOrder`, en pantalla y en servidor       | R8; la cabecera de `src/features/orders/deliveryOffer.ts` documenta las dos copias que ya divergieron |
| La comprobación de importe es contra `null`/`undefined`, **nunca** contra un falsy                | R10, y las dos formas correctas ya escritas en `src/features/zones/precedence.ts`                     |
| Los nombres salen del índice y solo desde un `server/`                                            | D5, `eslint.config.mjs` y la lista blanca de `src/features/zones/boundaries.test.ts`                  |
| `console.warn("[zones] …")`, jamás `console.error`                                                | AGENTS.md § Cosas que muerden, ficha `.agent/playbook/console-error-dispara-guardian-servidor.md`     |
| `export const dynamic` y `export const revalidate` con **literales**                              | `.agent/playbook/revalidate-no-literal.md`                                                            |
| Ninguna consulta del cliente global dentro de un `$transaction`                                   | `.agent/playbook/pooler-transaccion-deadlock.md`                                                      |
| Una intención de una sola vez que necesita el DOM va en un `useRef` y se **consume** en el efecto | AGENTS.md § Prohibiciones, ficha `.agent/playbook/set-state-en-efecto-prohibido.md`                   |
| `npm run format` sobre **lo que tú escribiste** en `.agent/`, nunca a ciegas sobre prosa ajena    | AGENTS.md § Cosas que muerden, ficha `.agent/playbook/prettier-write-reescribe-prosa-ajena.md`        |
| Un archivo que se va a crear se cita **sin** comillas invertidas y con su ruta completa           | AGENTS.md § Cosas que muerden, las dos mitades de `check:harness`                                     |

Antipatrones, cada uno con el daño concreto:

- **Simplificar polígono a polígono.** La frontera entre dos municipios se
  simplifica dos veces distintas y el toque del comprador cae en cero zonas o en
  dos, exactamente donde el mapa existe para ayudar (R15).
- **Iterar las 184 filas del índice para descargar geometría.** La Isla de la
  Juventud se descarga dos veces y aparece duplicada (R17). Se itera por
  `osmRelationId` distinto: 183.
- **Leer `quote.store.deliveryFee` cuando el modo es `ZONE_BASED`.** Le cobra a
  todo el mundo un importe que nadie fijó para su zona; hoy se lee en dos sitios
  de `src/features/cart/components/CheckoutForm.tsx` y los dos tienen que dejar
  de mirarlo (R9).
- **Resolver por nombre.** Un nombre tecleado no elige nada; el `code` es la
  identidad, y hay 13 colisiones de nombre en el índice esperando (R4, R7, I7).
- **Guardar el nombre compuesto «Playa · La Habana».** Dos pedidos de la misma
  zona acabarían con nombres distintos según lo que la pantalla decidiera ese día
  (R20).
- **Degradar a recogida cuando la zona deja de servirse.** Convierte un pedido a
  domicilio en uno de mostrador sin decírselo a nadie (E16).
- **Importar el índice, `leaflet` o `react-leaflet` fuera de sus dos módulos.**
  Lo primero mete ~7 KB gzip de nombres en el bundle sin que la etapa `bundle` lo
  cace; lo segundo mete ~50 KB en la carga inicial y mata E7.
- **Parsear la geometría en el servidor para «validarla» al servirla.** Convierte
  una ruta de coste lineal en bytes en una de coste lineal en vértices, por una
  garantía que ya da el test del manifiesto.
- **Un marcador de Leaflet.** Arrastra el parche del icono por defecto y sus
  peticiones de imagen. Aquí no hay pin, por decisión de producto (D7, § Fuera 2).
- **`prisma migrate dev`, `prisma migrate reset`, `prisma db push`.** Los dos
  últimos están prohibidos en AGENTS.md; el primero, en esta base compartida,
  lleva al segundo.

## Las nueve incongruencias de la spec, y qué hace este diseño con cada una

| #   | Qué dice                                                           | Qué hace el diseño                                                                                                                                |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | `check:bundle` no mide el checkout                                 | No se toca `BUDGET_KB` ni el guion. El criterio 11 se mide con la tabla de rutas de `npm run build` (§ Escalabilidad 3) y se anota en el progress |
| I2  | El criterio 8 y D5 parecen contradecirse                           | No se contradicen y el diseño lo hace visible: la lista es un **prop** del servidor y el island solo la pinta y filtra (AD3, AD5)                 |
| I3  | `deliveryFeeForNewOrder` lanza en la rama que este feature alcanza | AD4: resultado discriminado, sin `throw`. Y la ADR 0033 se cierra con una **nota fechada**, no con una ADR nueva (§ ¿Hace falta una ADR?)         |
| I4  | `isDeliveryOffered` es pura y la pregunta de verdad no lo es       | AD2: segundo parámetro obligatorio con el hecho ya resuelto. Cero Prisma en el árbol de cliente, cero churn en el sync                            |
| I5  | La propuesta y F-041 empujaban `contact.lat`/`lng` aquí            | Fuera, por D7. Ninguna columna, ninguna clave del pull, y ninguna coordenada llega jamás al servidor (§ Flujo B)                                  |
| I6  | La advertencia de la v13 sobre F-042 caduca y hay que retirarla    | Paso propio de la edición del contrato, junto a las dos claves de `contact` (§ Los ficheros de fuera de `src/`)                                   |
| I7  | 13 colisiones de nombre en el índice                               | `OfferableZone` lleva `provinceName` **siempre**; desambiguar es presentación (del diseñador) y el `code` sigue siendo lo que se envía (R7, R20)  |
| I8  | El `<noscript>` de hoy ya basta                                    | No se toca. El criterio 8 se comprueba en la etapa `visual` con `javaScriptEnabled: false`                                                        |
| I9  | «Menos de 1 MB» y el criterio 6 miden cosas distintas              | Las dos cifras se miden y se anotan; ninguna se convierte en una etapa que falle (§ Escalabilidad 4)                                              |

## Los ficheros de fuera de `src/` que hay que tocar

Además del código, este feature toca siete ficheros que el plan tiene que
ordenar como pasos propios:

1. `package.json` — `mapshaper` y `osmtogeojson` como `devDependencies` con
   versión exacta, y un guion `geometry:zones` que invoca al generador.
2. `.prettierignore` — el directorio de geometría, con el motivo al lado:
   Prettier le cambiaría los bytes y con ellos los hashes del manifiesto.
3. `next.config.ts` — `outputFileTracingIncludes` para la ruta de geometría: las
   168 lecturas son dinámicas y el trazado de Next no las descubre solo.
4. `prisma/schema.prisma` — las dos columnas de `Order`.
5. `docs/sync-contract.md` — las dos claves de `contact` en § ③④ Pedidos con su
   forma (siempre presentes, `string | null`, `zoneCode` siempre de municipio,
   `zoneName` que **no resuelve nada**), la frase de que en un pedido a domicilio
   de una tienda `ZONE_BASED` `deliveryFeePending` es **siempre** `false`, la
   **retirada** de la advertencia de § «Cambios respecto a la v12.2» (I6), la
   reescritura de § «Lo que la v13 reserva para F-042», y la primera línea a
   **v13.1** (D6, R24) con su entrada en la sección de cambios. El hook
   `.claude/hooks/sync-contract-version.sh` avisa si el fichero cambia sin que la
   línea de la versión se mueva.
6. `docs/despliegue.md` — el **par** de variables del proveedor de teselas en § 5
   con la regla de que van juntas o no va ninguna y con el aviso de que son de
   build; cómo llega la geometría a un entorno nuevo (va **con el código**, no
   hay paso manual, y eso es justo lo que hay que escribir para que nadie lo
   busque); y la herramienta de simplificación con su versión, sin la cual la
   regeneración no es reproducible.
7. `docs/adr/0033-cobrar-el-domicilio-y-ofrecerlo-son-dos-preguntas.md` y
   `docs/adr/0032-catalogo-de-zonas-bytes-commiteados-y-la-base-como-espejo.md` —
   una nota fechada en cada una, y las dos pasan de **Propuesta** a **Aceptada**,
   que es lo que su propia cabecera dice que ocurre cuando F-041 esté fusionado
   y que quedó sin hacer.

## Riesgos y plan B

1. **La geometría no existe y todo el mapa se apoya en ella.** Generarla necesita
   Overpass vivo el día de la implementación. Si no responde, **no se genera a
   medias**: se para la etapa y se dice. Plan B si Overpass se cae de forma
   prolongada: la lista con escritura predictiva es el camino **primario** y
   funciona sola, así que el feature puede entregarse por etapas con el mapa
   detrás; lo que no se puede es entregar un mapa con polígonos aproximados.
2. **La estimación de 2,4 MB puede quedarse corta.** Es una estimación, no una
   medición, y la costa cubana es la parte cara. Si el artefacto real se dispara,
   la palanca está escrita (§ Escalabilidad 4) y la decisión de qué número
   aceptar en el repositorio es AP2.
3. **El `snap` de importación puede unir de más.** Un intervalo demasiado grande
   fusiona islotes reales; demasiado pequeño no encuentra la frontera común y la
   topología no se comparte. El guion **imprime cuántos puntos snapeó** y las dos
   comprobaciones de R15 son las que dicen si acertó. Si la comprobación 2 falla,
   se sube el snap antes que bajar la tolerancia.
4. **El CSS de Leaflet puede colarse en la hoja de la página.** Next mete el CSS
   de un componente dinámico en su propio trozo, pero eso depende del empaquetado
   y hay que **comprobarlo mirando las peticiones** en la etapa `visual` (E7), no
   suponerlo. Plan B: inyectar el `<link>` al abrir el mapa. Lo que **no** se hace
   es copiar el CSS de Leaflet al repositorio.
5. **`outputFileTracingIncludes` es un paso invisible.** Si falla, la ruta
   responde `500` en producción y **verde en local**, que es la peor forma de
   fallar. Se cubre en `docs/despliegue.md` § 7 («lo que ningún guion comprueba»)
   y con una comprobación en el smoke contra la app levantada. Plan B: mover el
   directorio a `public/` y leerlo desde ahí, aceptando que cada municipio quede
   además descargable suelto —que no es un problema de secreto, porque es dato
   de referencia público, sino de que E8 dejaría de estar garantizado por el
   servidor.
6. **El island crece.** `src/features/cart/components/CheckoutForm.tsx` ya tiene
   927 líneas y este feature le añade un bloque. El selector vive en su **propio**
   componente y el checkout solo lo compone: si el fichero sigue creciendo, lo que
   se parte es el bloque de entrega entero, no el selector.
7. **Dos fuentes para el mismo hecho durante 300 ms.** La lista viene del render
   del servidor y el modo de envío de la cotización, que llega después. Si el
   tarifario cambia en esa ventana, el comprador ve una lista de hace un instante:
   es exactamente el caso límite 4 y lo cierra el `409`/`DELIVERY_ZONE_NOT_SERVED`
   al confirmar. Se acepta y se escribe; la alternativa —mover la lista a la
   cotización— cuesta el D5 entero.

## ¿Hace falta una ADR?

**No, ninguna nueva. Dos notas fechadas**, y esta arquitectura **no las escribe**
—el ciclo le prohíbe tocar `docs/`—: van al plan como pasos propios con su
contenido decidido aquí.

**Nota de F-042 en la ADR 0033**, más el paso de **Propuesta** a **Aceptada**.
AGENTS.md exige una ADR nueva cuando se **contradice** una decisión publicada, y
aquí no se contradice ninguna: la 0033 decidió que son dos preguntas distintas
—y este feature lo **confirma**, porque `hasSomethingToChargeDeliveryWith` no se
toca—, dejó explícitamente sin decidir «qué contesta `isDeliveryOffered` para
`ZONE_BASED` después de F-042», y su § «Reabrir cuando» nombra este día con estas
palabras. Escribir una ADR que supere a la que expresamente delegó la respuesta
dejaría dos documentos donde el segundo solo rellena el hueco del primero. La
nota dice tres cosas: que la rama `ZONE_BASED` contesta ahora «¿tiene esta tienda
alguna zona con tarifa resoluble?» y que el hecho entra **como segundo argumento**
para que la función siga siendo pura (AD2); que la consecuencia del `throw` de
`deliveryFeeForNewOrder` queda superada por un resultado discriminado (AD4); y
que el `deliveryFee` residual de la columna **sigue sin cobrarse nunca** en
`ZONE_BASED`, que es la parte de la 0033 que este feature más podría romper por
descuido. Alternativa descartada: **ADR 0034 nueva**, por lo anterior; y descartada
también **no escribir nada**, que es lo que I3 prohíbe con esas palabras («lo que
no puede pasar es que se cambien las dos funciones dejando la ADR diciendo lo
contrario»).

**Nota de F-042 en la ADR 0032**, más el paso a **Aceptada**. Su punto (e) dice
que la geometría es el segundo artefacto y que «F-042 trae el segundo, con su
propia procedencia y su propio mecanismo de versión»: la nota lo materializa
—directorio, grano municipio, un fichero por zona, manifiesto con hashes,
simplificación topológica en una operación, precisión decimal, y que se sirve por
cobertura desde una ruta que **concatena bytes y nunca consulta una base
espacial**—. Esa última frase es también la que deja la **ADR 0011 cerrada sin
discusión**: aquí ninguna coordenada decide un precio ni ordena nada, y el único
punto-en-polígono del sistema lo hace Leaflet en el navegador, sobre datos que ese
navegador ya tiene. La 0011 **no se reabre** y esta arquitectura no la necesita
para nada.

## Preguntas al humano

Dos. Ninguna bloquea escribir código, **las dos bloquean la firma del plan**: la
primera es legal y de producto, la segunda es de coste del repositorio.

**AP1 — con el proveedor alternativo de teselas puesto, ¿el crédito de
OpenStreetMap sigue visible?**
Qué falta: D2 dice que «con el par de variables puestas, el crédito visible es el
de esa variable». Pero los **polígonos son nuestros y son derivados de OSM** —se
generan de relaciones de OpenStreetMap (ADR 0032 (b), y es lo que hace este
feature), así que están bajo ODbL y **exigen atribución con independencia de
quién sirva las teselas**. Con la letra de D2 aplicada tal cual, una tienda con
proveedor alternativo pintaría datos de OSM sin acreditar a OSM. Opciones: **(a)**
la atribución se compone de **dos** piezas siempre —el crédito del proveedor de
teselas, que es el de la variable o el de OSM, **más** una línea fija de «Límites
municipales © colaboradores de OpenStreetMap (ODbL)» que no depende de ninguna
variable—; **(b)** solo el crédito del proveedor de teselas, tal como D2 dice
literalmente; **(c)** el crédito de los límites solo en la procedencia y en una
página de créditos, no sobre el mapa. **Recomendación: (a)**, que es la única que
cumple la licencia de la que salieron los polígonos y cuesta una línea de texto;
(b) incumple ODbL en el único caso en que alguien configure otro proveedor, y (c)
es lo que la licencia pide para un dato que no se muestra, no para uno que sí.
No reabre D2: la atribución de las **teselas** sigue siendo exactamente lo que él
decidió.

**AP2 — el artefacto de geometría son ~2,4 MB commiteados (estimados) en 169
ficheros. ¿Se aceptan en el repositorio?**
Qué falta: el humano fijó el objetivo de peso sobre **lo que descarga un
comprador** (menos de 1 MB, y si hace falta más, que se ocupe), y eso está
resuelto: la cobertura común son decenas de KB. Lo que nadie ha decidido todavía
es el peso **en el repositorio**, que es una cifra nueva y que se paga otra vez
entera en cada regeneración. Opciones: **(a)** aceptar ~2,4 MB con la tolerancia
de 100 m y 4 decimales, midiendo de verdad al generar y avisando si se pasa de
3 MB; **(b)** apretar a `interval=200` y 3 decimales, que bajaría a la mitad
larga a costa de una frontera visiblemente más tosca al acercar el mapa;
**(c)** sacar el artefacto del repositorio a un bucket versionado, con lo que se
perdería la propiedad que la ADR 0032 eligió a propósito —los mismos bytes a los
dos lados, y el hash como árbitro— y aparecería un paso operativo nuevo por
entorno. **Recomendación: (a)**. La cifra real se mide al generar y se anota en
la procedencia y en `.agent/progress/F-042.md`; si se dispara por encima de 3 MB
se aplica la palanca de (b) antes de plantear (c).
