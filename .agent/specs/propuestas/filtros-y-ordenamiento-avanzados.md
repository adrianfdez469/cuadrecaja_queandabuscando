---
propuesta: filtros-y-ordenamiento-avanzados
agente: sdd-spec
actualizado: 2026-08-29T04:00:00Z
estado: promovida
---

> **PROMOVIDA a F-027 el 2026-08-29.** El contenido completo, con las preguntas ya resueltas por el humano, vive ahora en `.agent/specs/F-027/spec.md`. Este archivo se conserva como historial de la propuesta original, sin editar.

> Una de las cuatro propuestas en que se dividió el pedido del humano del
> 2026-08-29 («botón de atrás, breadcrumb, selector de categorías y
> subcategorías, filtros avanzados, ordenamientos avanzados, reseñas y
> calificaciones»). Las otras tres son `navegacion-atras-y-breadcrumb`,
> `categorias-y-subcategorias` y `resenas-y-calificaciones`, y se están
> escribiendo en paralelo. Aquí solo van **filtros** y **ordenamientos**.
>
> Todavía **no es un feature**: el backlog lo escribe el humano (regla 4 de
> `.agent/features.json`). Por eso todos los criterios de aceptación van
> marcados `[nuevo]`.

## Problema

Quien entra a una tienda ve **todo el catálogo de golpe**, en una sola lista
sin cortes: `loadCatalog` hace un `findMany` sin `take` y lo ordena por
`featured` y `localName`
(`src/features/catalog/server/queries.ts:193-199`). No hay ningún parámetro que
la página lea: `/[slug]` no recibe `searchParams` en absoluto
(`src/app/[slug]/page.tsx`). Es decir, hoy el comprador tiene exactamente **dos**
maneras de llegar a un producto: bajar con el dedo, o escribir su nombre en el
buscador que dejó F-021.

Falta la tercera, que es la que usa quien **no sabe cómo se llama lo que
busca**: acotar («solo lo que hay», «entre 200 y 500 pesos», «solo bebidas») y
reordenar («lo más barato primero»). En un catálogo de cuarenta productos esto
es un lujo; en uno de cuatrocientos es la diferencia entre comprar y cerrar la
pestaña — el mismo argumento con el que se justificó F-021
(`.agent/specs/F-021/spec.md` § Problema).

Y esto no es un hueco descubierto ahora: **F-021 lo dejó fuera a propósito y
por escrito**. Su § Alcance › Fuera (explícito) dice, literalmente:

> «**Facetas, filtros y ordenaciones** (por precio, por categoría, por
> disponibilidad). Otro feature.»
> — `.agent/specs/F-021/spec.md:84-85`

Esta propuesta **es** ese otro feature.

## Alcance

### Dentro

1. **Un vocabulario de querystring único** para acotar y ordenar el catálogo de
   una tienda, servido enteramente desde el servidor. El mismo vocabulario lo
   entienden la superficie de catálogo filtrado y la página de resultados de
   búsqueda de F-021, para que un filtro no signifique una cosa en una pantalla
   y otra en la otra (R17).

2. **Los filtros que hoy tienen dato de verdad**, y solo esos:

   | Filtro                | De dónde sale el dato                                                                          |
   | --------------------- | ---------------------------------------------------------------------------------------------- |
   | Disponibilidad        | `StoreProduct.availability` (`prisma/schema.prisma:378`), enum de tres valores                 |
   | Categoría             | `StoreProduct.localCategoryId` y, en cascada, `CanonicalProduct.globalCategoryId` (R15)        |
   | Rango de precio       | El precio **mostrado**, compuesto por `resolvePrice` (`src/lib/pricing.ts:65`) (R4)            |
   | Con promoción vigente | `Promotion` + `indexPromotions`, que la lectura del catálogo ya trae (`src/lib/promotions.ts`) |
   | Destacados            | `StoreProduct.featured` (`prisma/schema.prisma:392`), propiedad del panel                      |

3. **Los ordenamientos que hoy tienen dato de verdad**: relevancia (solo cuando
   hay término de búsqueda; es el orden por capas que ya define F-021), precio
   ascendente, precio descendente, nombre A-Z, más reciente
   (`StoreProduct.createdAt`, con la salvedad de I9) y el orden por defecto de
   hoy (destacados primero, después nombre).

4. **Una superficie propia y dinámica** para el catálogo filtrado, distinta de
   `/[slug]`, que sigue siendo `●` (SSG) y no se toca (R13, I1, SP4).

5. **Cero JavaScript de cliente**: el panel de filtros es un
   `<form method="get">` y el selector de orden y los chips de «quitar filtro»
   son enlaces de servidor, exactamente como la caja de búsqueda de F-021
   (`src/components/store/StoreSearchBox.tsx`). Es la prohibición de `AGENTS.md`
   § Prohibiciones para todo lo que renderice catálogo (R12).

6. **Los estados vacíos, separados**: «esta tienda no tiene productos», «no hay
   resultados para tu búsqueda» y «con estos filtros no queda nada» son tres
   pantallas distintas, y la tercera ofrece quitar filtros (E16).

7. **Paginación** del catálogo filtrado, con orden total, para que ninguna
   página repita ni se salte filas (R8, R16) — la misma propiedad que R10 de
   F-021.

8. **Higiene de indexación**: las URL con filtros u orden son `noindex` y
   declaran su canónica a `/[slug]` (R14). Un panel de facetas sin esto genera
   un espacio de URL combinatorio que el rastreador recorre entero.

### Fuera (explícito)

- **Filtrar por marca, talla, color o cualquier atributo del producto.** No
  existe el dato: ni `StoreProduct` ni `CanonicalProduct` tienen ningún campo de
  marca o de atributos (`prisma/schema.prisma:300-419`), y el `payload` de
  `PRODUCT` de la v4 del contrato tampoco lo trae
  (`docs/sync-contract.md:216-239`). Construirlo exige una v5 del contrato con
  el equipo de cuadrecaja (I4).
- **Ordenar por «más vendido».** No hay fuente pública: el contrato prohíbe
  explícitamente enviar `Venta` y `MovimientoStock`
  (`docs/sync-contract.md:249`) y ADR 0003 mantiene el entero de existencias
  fuera de esta base. Lo único parecido son los `OrderItem` de los pedidos
  nacidos aquí (F-010), que es otra cosa (I3, SP1).
- **Ordenar por calificación o filtrar por estrellas.** No hay modelo de
  reseñas; es la propuesta hermana `.agent/specs/propuestas/resenas-y-calificaciones.md`.
  Si ambas se construyen, este feature aporta el parámetro y aquella el dato.
- **El árbol de categorías, sus URL propias, las migas y el selector
  jerárquico.** Es la propuesta hermana
  `.agent/specs/propuestas/categorias-y-subcategorias.md` (SP2). Aquí la
  categoría es **un filtro más**, plano, sobre la taxonomía que exista.
- **Convertir `/[slug]` en ruta dinámica.** Rompería dos criterios ya cerrados
  (I1).
- **Filtros y facetas en el buscador del marketplace** (F-015,
  `src/features/marketplace/server/search.ts`): otra consulta, otro actor, otra
  frontera.
- **Filtrar por código de barras**, prohibido por R9 de
  `.agent/specs/F-024/spec.md`.
- **Recordar las preferencias del comprador** entre visitas (cookie, sesión o
  `localStorage`). Exigiría estado de cliente y una decisión de privacidad que
  nadie ha pedido (R19).
- **Autocompletado de facetas, sliders de precio arrastrables y cualquier
  actualización en vivo del resultado al marcar una casilla.** Los tres
  necesitan JavaScript de cliente en algo que renderiza catálogo (R12).
- **Guardar el uso de los filtros en el registro de consultas de F-021.** Ese
  modelo guarda tres cosas y ninguna más por decisión del humano (R5 de
  `.agent/specs/F-021/spec.md`); ampliarlo es otra decisión suya.

## Actores y precondiciones

**El comprador, sin cuenta y sin sesión.** La misma frontera pública de
`docs/adr/0016-escritura-publica-sin-sesion.md`: nadie se identifica para
filtrar.

Precondiciones:

- El slug resuelve a una **sucursal** (`kind: "branch"` de
  `src/features/storefront/server/resolve.ts`) y su `Store.status` es
  `PUBLISHED`. `DRAFT` es 404; `SUSPENDED` es el aviso de cerrada (E18, E19).
- La tienda tiene productos visibles. Un catálogo vacío no ofrece filtros: un
  panel de facetas sobre cero productos es ruido (E17).
- Para el filtro de categoría hace falta que los productos tengan alguna:
  `LocalCategory` llega del POS con cada producto y `GlobalCategory` solo está
  poblada por el seed (I5, R15).
- Para el filtro y el orden por precio hace falta una tasa vigente de la moneda
  del producto: sin ella, `resolvePrice` lanza y la ficha muestra «Consultar»
  (`src/components/store/ProductCard.tsx:86-106`). Ese producto tiene un
  tratamiento propio y explícito (R5, E7).
- F-004, F-011 y F-021 cerrados (`passes: true` los tres). Este feature lee lo
  que los tres dejaron.

## Comportamiento esperado

**E1 — el catálogo sin filtros no cambia.**
Dado un comprador que entra a `/[slug]` sin ningún parámetro, cuando se carga la
página, entonces ve **exactamente** lo de hoy: todos los productos visibles,
destacados primero y después por nombre, sin panel de filtros que altere el
orden ni el conjunto. Ningún criterio ya verificado de F-004, F-006 o F-021
cambia de resultado (R1).

**E2 — filtrar por disponibilidad deja fuera los agotados.**
Dada una tienda con un producto `OUT_OF_STOCK` y otro `AVAILABLE`, cuando el
comprador marca «solo lo que hay», entonces el resultado contiene el segundo y
no el primero. Y cuando **no** lo marca, aparecen los dos, con el agotado
llevando su distintivo — que es lo que hace hoy el catálogo, que a propósito no
filtra por `availability` (`src/features/catalog/server/queries.ts:193-198`,
R7/E6 de `.agent/specs/F-021/spec.md`).

**E3 — filtrar por categoría local.**
Dado un producto con `localCategoryId` de «Bebidas» y otro de «Aseo», cuando el
comprador elige «Bebidas», entonces solo aparece el primero, y el nombre que se
muestra en el chip es el de `LocalCategory.name`, el que escribió el negocio.

**E3b — la categoría cae a la global cuando la hay.**
Dado un producto cuyo canónico tiene `globalCategoryId`, cuando el comprador
filtra por esa categoría, entonces aparece aunque su `localCategoryId` sea nulo.
La cascada es la misma que fijó R17 de F-021: global si el canónico la tiene,
local en cualquier otro caso (R15).

**E4 — dos valores de la misma faceta se suman.**
Dado que el comprador elige «Bebidas» **y** «Panadería», cuando se aplica,
entonces el resultado contiene los productos de cualquiera de las dos, no la
intersección (que sería vacía siempre) (R2).

**E5 — dos facetas distintas se cortan.**
Dado que el comprador elige «Bebidas» y además «solo lo que hay», cuando se
aplica, entonces el resultado contiene solo las bebidas disponibles (R2).

**E6 — el rango de precio se mide sobre el precio que se ve.**
Dado un producto con `syncedPrice` 900 y `priceOverride` 300, cuando el
comprador pide «hasta 500», entonces el producto **aparece**: el precio vigente
es el del override (`docs/adr/0007-price-override.md`, `src/lib/pricing.ts:25`).
Ordenar o filtrar por `syncedPrice` daría lo contrario (I2, R4).

**E6b — una promoción vigente mueve al producto de tramo.**
Dado un producto de 600 con una promoción vigente del 50 %, cuando el comprador
pide «hasta 500», entonces aparece, porque el precio que se le cobra y el que se
le muestra son 300 — el mismo que compone `resolvePrice` con las promociones ya
filtradas por vigencia (`src/lib/promotions.ts`, R4).

**E7 — un producto sin precio resoluble no se cuela ni se pierde.**
Dado un producto en una moneda sin tasa vigente —el caso que hoy pinta
«Consultar»—, cuando el comprador aplica un rango de precio, entonces **no
aparece** (no se puede demostrar que esté dentro). Y cuando ordena por precio,
en cualquiera de las dos direcciones, entonces **aparece al final**, nunca
intercalado ni en orden aleatorio (R5).

**E8 — ordenar por precio ordena por el precio mostrado.**
Dados tres productos que se ven a 100, 250 y 900 en la moneda de exhibición de
la tienda, cuando el comprador pide «más barato primero», entonces salen en ese
orden, aunque sus `syncedPriceCurrency` sean distintas entre sí (R4, R6).

**E9 — el orden alfabético ignora acentos y mayúsculas.**
Dados «ácido», «Agua» y «azúcar», cuando el comprador pide nombre A-Z, entonces
salen en ese orden, no con los acentuados al final ni las mayúsculas primero.

**E10 — «más reciente» es un orden total.**
Dados diez productos dados de alta en el mismo lote de sync, y por tanto con
`createdAt` idéntico o casi, cuando el comprador pide «más reciente», entonces
la primera y la segunda página no repiten ni se saltan ninguno: el desempate es
`localName` y después `id` (R8).

**E11 — «relevancia» solo existe cuando hay algo con qué medirla.**
Dado un catálogo filtrado sin término de búsqueda, cuando se pintan las opciones
de orden, entonces «relevancia» **no** está entre ellas. Dada la página de
resultados de una búsqueda, entonces **sí** está y es la opción marcada por
defecto.

**E12 — un orden elegido sustituye el orden por capas; no elegir nada no lo
toca.**
Dada una búsqueda con resultados en las tres capas de F-021, cuando el comprador
pide «más barato primero», entonces el resultado se ordena por precio de punta a
punta, mezclando capas. Y cuando **no** pide ningún orden, entonces el resultado
es idéntico al de F-021 hoy: capa, puntuación, nombre, id (R1 de
`.agent/specs/F-021/spec.md`). Los criterios 1 y 2 de F-021 se verifican en este
segundo camino y siguen verdes (I8).

**E13 — cambiar un filtro vuelve a la primera página.**
Dado un comprador en la página 3 de un resultado, cuando marca un filtro nuevo,
entonces ve la página 1 del resultado nuevo, no una página 3 vacía (R9).

**E14 — se usa sin JavaScript.**
Dado el navegador con JavaScript deshabilitado, cuando el comprador marca dos
casillas y pulsa «Aplicar», entonces la página se recarga con el resultado
filtrado; y cuando pulsa la ✕ de un chip, entonces ese filtro desaparece. Los
nombres y precios están en el HTML, no tras hidratar.

**E15 — una URL manipulada no rompe nada.**
Dada una URL con un parámetro desconocido, con una categoría que no existe en
esa tienda, con `precio_min` mayor que `precio_max`, con letras donde va un
número o con cuarenta valores repetidos de la misma faceta, cuando se carga,
entonces la página responde **200**, aplica lo que sí era válido, ignora el
resto en silencio y los chips muestran solo lo que de verdad se aplicó
(R10, R18).

**E16 — «no queda nada» no es «no hay nada».**
Dada una combinación de filtros sin ningún producto, cuando se carga, entonces
la página responde 200 con un vacío que dice **qué filtros están puestos** y
ofrece quitarlos uno a uno o todos a la vez; nunca un 404 y nunca la misma
pantalla que una tienda sin productos publicados.

**E17 — una tienda sin catálogo no ofrece filtros.**
Dada una tienda publicada sin ningún `StoreProduct` visible, cuando se carga la
superficie filtrable, entonces se muestra el mismo mensaje que hoy da `/[slug]`
(«Esta tienda todavía no tiene productos publicados») y **no** se pinta el panel.

**E18 — una tienda cerrada no filtra nada.**
Dada una tienda `SUSPENDED`, cuando se pide la superficie filtrable con
cualquier combinación de parámetros, entonces se muestra el aviso de cerrada y
**no se ejecuta ninguna consulta de catálogo** — gemelo exacto de E14 de F-021.

**E19 — el slug de una marca en modo selector no tiene filtros.**
Dado un slug que resuelve a `kind: "selector"`, cuando se pide la superficie
filtrable, entonces responde 404, igual que ya hacen `/[slug]/buscar` y
`/[slug]/p/[productSlug]`.

**E20 — el catálogo sigue saliendo del CDN.**
Dado el build del proyecto, cuando termina, entonces `/[slug]` y
`/[slug]/p/[productSlug]` siguen marcados `●` (SSG) y solo la superficie
filtrable nueva aparece como `ƒ` (Dynamic) (R13, I1).

**E21 — un filtro nunca ensancha la visibilidad.**
Dado un producto con `visible = false`, con `deletedAt` no nulo, o de una tienda
que no es esta, cuando el comprador prueba cualquier combinación de filtros y
órdenes, entonces no aparece en ninguna (R7, R20).

**E22 — «con descuento» significa vigente ahora.**
Dado un producto con una promoción cuyo `endsAt` ya pasó, cuando el comprador
filtra por «con descuento», entonces no aparece; y dado otro cuya promoción
empieza mañana, tampoco. La vigencia es la que ya calcula `indexPromotions`, no
una regla nueva.

## Reglas de negocio

**R1 — el orden por defecto no cambia nunca.** Sin parámetro de orden, `/[slug]`
devuelve destacados-y-nombre y `/[slug]/buscar` devuelve capa-puntuación-nombre-id.
Comprobable ejecutando los criterios ya verificados de F-004 y F-021 después del
cambio.

**R2 — dentro de una faceta, unión; entre facetas, intersección.** Dos
categorías se suman (E4); una categoría y una disponibilidad se cortan (E5).

**R3 — ningún filtro se aplica por defecto.** En particular, «solo lo que hay»
es **opt-in**. Ponerlo por defecto escondería los `OUT_OF_STOCK` que el catálogo
muestra a propósito y contradiría el quinto criterio de F-006 («Cambiar
disponibilidad se refleja en /[slug]»), que se verificó viendo el producto
agotado en la página (I10).

**R4 — el precio por el que se filtra y se ordena es el que el comprador ve.**
Sale de `resolvePrice` (`src/lib/pricing.ts:65`), que encadena override →
promoción → conversión y es «el compositor único» del repo. Ningún módulo nuevo
reimplementa esa precedencia ni ordena por `syncedPrice` (I2).

**R5 — un producto sin precio resoluble tiene un lugar fijo.** Fuera de todo
rango, y al final de cualquier orden por precio en las dos direcciones. Nunca se
le inventa un precio ni se le esconde del catálogo sin filtrar (E7).

**R6 — el rango se expresa en la moneda de exhibición de la tienda**
(`Store.business.baseCurrencyCode`, ya presente en `StoreSummary`), no en la
moneda de cada producto. Los límites son enteros no negativos en esa moneda.

**R7 — los filtros no deciden la visibilidad.** `deletedAt IS NULL`,
`visible = TRUE` y `Store.status = PUBLISHED` siguen siendo condición previa a
cualquier filtro, exactamente como en R7 de `.agent/specs/F-021/spec.md`. Un
filtro solo puede **quitar** productos de ese conjunto, nunca añadir.

**R8 — todo orden es total.** Criterio elegido, después `localName`, después
`id`. Sin esto, paginar repite y se salta filas cuando hay empates, que es el
caso normal en «más reciente» y en «con descuento» (E10).

**R9 — cambiar cualquier filtro u orden reinicia la paginación a la página 1**
(E13).

**R10 — un parámetro que no se entiende se ignora, no se rechaza.** Desconocido,
repetido de más, fuera de rango, no numérico o con un valor que no existe en
esta tienda: se descarta y la página responde 200. Nunca 400, nunca 500 (E15).
El motivo es concreto: estas URL se comparten por WhatsApp y las rastrean bots.

**R11 — la misma selección produce siempre la misma URL.** Parámetros en orden
fijo y valores ordenados, para que un conjunto de filtros no genere seis
direcciones distintas en la caché, en el CDN y en cualquier medición futura.

**R12 — cero JavaScript de cliente.** Ni el panel, ni los chips, ni el selector
de orden llevan `"use client"`. Es la prohibición de `AGENTS.md` § Prohibiciones
para cualquier cosa que renderice catálogo, y la misma razón por la que SP2 de
F-021 se resolvió como página de servidor.

**R13 — `/[slug]` sigue siendo `●` (SSG).** Es criterio cerrado de F-004 (el
primero) y de F-017 (el séptimo), y está verificado en
`.agent/specs/F-021/tests.md:153`. La superficie filtrable es otra ruta (I1).

**R14 — toda URL con filtro u orden es `noindex` y declara su canónica a
`/[slug]`.** La página de búsqueda de F-021 ya hace lo primero
(`robots: { index: false }`); aquí hace falta además lo segundo, porque el
contenido filtrado **sí** es un subconjunto del catálogo indexable.

**R15 — la categoría es la misma cascada de dos escalones que fijó R17 de
F-021**: `GlobalCategory` del canónico si la tiene, `LocalCategory` de la oferta
si no. Nunca las dos a la vez para el mismo producto y nunca ninguna otra cosa.

**R16 — el catálogo filtrado pagina**, con el mismo tope por página que la
búsqueda (`STORE_SEARCH_PAGE_SIZE` = 24, `src/constants/storeSearch.ts`) o una
constante propia, nunca un número suelto (`AGENTS.md` § Prohibiciones).

**R17 — hay un solo vocabulario de parámetros y un solo módulo que lo
interpreta.** Catálogo filtrado y búsqueda lo comparten. Dos interpretaciones
del mismo `precio_max` es el bug que nadie ve hasta que un comprador compara las
dos pantallas.

**R18 — los chips muestran lo que se aplicó, no lo que se pidió.** Un valor
descartado por R10 no genera chip. Enseñar un chip de un filtro que no se aplicó
es peor que no enseñar ninguno.

**R19 — no se guarda ninguna preferencia del comprador.** El estado vive entero
en la URL. Sin cookie, sin `localStorage`, sin fila en la base.

**R20 — ningún filtro cruza tiendas.** El `storeId` es parámetro obligatorio de
la lectura, no un filtro que quien llama pueda olvidar (gemelo de R6 de F-021).

## Casos límite y errores

| Caso                                                         | Qué tiene que pasar                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Ningún parámetro                                             | El catálogo de hoy, byte a byte (E1, R1)                                                                 |
| Parámetro desconocido, o valor que no existe en esta tienda  | Se ignora, 200, sin chip (R10, R18)                                                                      |
| `precio_min` > `precio_max`                                  | Se ignora el rango entero, 200. Nunca un resultado vacío silencioso                                      |
| `precio_min` negativo, decimal o no numérico                 | Se ignora ese límite; el otro sigue valiendo                                                             |
| Cuarenta valores repetidos de la misma faceta                | Se acota a un máximo por faceta antes de tocar los datos; nunca llegan crudos                            |
| Filtro de categoría con un id de **otra** tienda             | Cero resultados con el vacío explicado, nunca un producto ajeno (R20, E21)                               |
| Producto sin categoría ni local ni global                    | No aparece bajo ningún filtro de categoría; **sí** aparece sin filtrar                                   |
| Producto sin tasa vigente («Consultar»)                      | Fuera del rango; último en el orden por precio en ambas direcciones (R5, E7)                             |
| Todos los productos de la tienda en la misma categoría       | La faceta se ofrece igual; filtrar por ella no cambia nada y eso no es un error                          |
| Tienda sin ningún producto visible                           | Sin panel de filtros; el mensaje de hoy (E17)                                                            |
| Combinación válida sin resultados                            | 200, vacío con los filtros nombrados y con «quitar» (E16)                                                |
| Página más allá de la última                                 | Mismo tratamiento que ya da la búsqueda: aviso y enlace a la primera, nunca el vacío de «sin resultados» |
| Cambio de filtro estando en la página 3                      | Página 1 del resultado nuevo (E13, R9)                                                                   |
| Empate total en el criterio de orden                         | Desempata `localName` y después `id`; nunca aleatorio (R8)                                               |
| Búsqueda con `sort` explícito                                | El orden elegido sustituye las capas (E12, I8)                                                           |
| Búsqueda sin `sort`                                          | El orden de F-021, intacto (R1)                                                                          |
| Tienda `SUSPENDED`                                           | Aviso de cerrada, sin consulta de catálogo (E18)                                                         |
| Slug en modo selector                                        | 404 (E19)                                                                                                |
| Slug retirado o inexistente                                  | 404, por el resolvedor de siempre                                                                        |
| Promoción que vence entre dos peticiones                     | La segunda no la aplica; nada queda inconsistente porque la vigencia se evalúa en cada lectura           |
| El sync cambia la disponibilidad mientras se navega filtrado | La página siguiente refleja el valor nuevo; la caché la invalida el tag de catálogo de siempre           |
| JavaScript deshabilitado                                     | Todo funciona: `<form method="get">` y enlaces (E14, R12)                                                |
| Base caída                                                   | Fallo visible, nunca una lista vacía disfrazada de «no hay resultados» (misma regla que R16 de F-021)    |

## Datos y contrato

**El contrato con cuadrecaja no cambia.** No entra ni sale ningún campo por
`/api/internal/*` y `docs/sync-contract.md` no sube de versión: todos los
filtros y órdenes del § Alcance se calculan con datos que ya están en la base.
Esto es lo que hace la propuesta barata, y también lo que fija su techo: lo que
el contrato no manda —marca, atributos, ventas— no se puede filtrar (I3, I4).

Campos que este feature **lee** y que ya existen:

| Campo                                                                                       | Para qué                                     |
| ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `StoreProduct.availability`                                                                 | Filtro de disponibilidad                     |
| `StoreProduct.localCategoryId` → `LocalCategory.name`                                       | Filtro de categoría (escalón 2)              |
| `CanonicalProduct.globalCategoryId` → `GlobalCategory.name`                                 | Filtro de categoría (escalón 1)              |
| `StoreProduct.syncedPrice`, `syncedPriceCurrency`, `priceOverride`, `priceOverrideCurrency` | Entrada de `resolvePrice`                    |
| `Promotion` (vigentes) + `ExchangeRate`                                                     | El resto de la entrada de `resolvePrice`     |
| `StoreProduct.featured`                                                                     | Filtro «destacados» y orden por defecto      |
| `StoreProduct.createdAt` (`prisma/schema.prisma:405`)                                       | Orden «más reciente» (con la salvedad de I9) |

Campos que **no existen** y que por tanto acotan el alcance: marca, atributos,
unidades vendidas, calificación media, número de reseñas.

**Deltas de datos posibles, según cómo se resuelva SP3:**

| Dónde          | Qué                                                    | Cuándo hace falta                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StoreProduct` | Índice sobre `(storeId, availability)` o similar       | Solo si el filtro acaba traduciéndose a SQL                                                                                                                                                         |
| `StoreProduct` | Una columna derivada de precio efectivo en moneda base | Solo si SP3 se cierra por la vía (c); sería el segundo campo derivado del repo, con la misma disciplina de invalidación que fijó `docs/adr/0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md` |

Unidades y límites: el rango de precio va en enteros no negativos de la moneda
de exhibición (R6); el tope de valores por faceta, el tope de página y el tope
de profundidad de paginación son constantes en `src/constants/`, nunca números
sueltos.

Un aviso sobre la caché, porque decide el diseño: `getStoreCatalog` está
cacheado por tienda con un solo tag (`src/lib/cache.ts`) y `cached()` **añade
los argumentos a la clave**. Traducir cada combinación de filtros a una consulta
distinta multiplica las entradas de caché por el número de combinaciones
posibles (I7). Es el argumento central de SP3.

## Criterios de aceptación propuestos

Todos `[nuevo]`: esta propuesta todavía no es un feature de
`.agent/features.json`, así que no hay ningún `acceptance_criteria` escrito que
respetar (regla 3) ni que un agente pueda añadir por su cuenta (regla 4).

1. `[nuevo]` `GET /[slug]` sin parámetros devuelve el **mismo** conjunto y el
   mismo orden de productos que antes del cambio: capturar los `slug` en orden
   del HTML antes y después y compararlos elemento a elemento (E1, R1).
2. `[nuevo]` `npm run build` sigue marcando `/[slug]` y `/[slug]/p/[productSlug]`
   como `●` (SSG), y la superficie filtrable nueva aparece como `ƒ` (Dynamic)
   (E20, R13).
3. `[nuevo]` Con un producto `OUT_OF_STOCK` y otro `AVAILABLE` sembrados: la URL
   sin filtro contiene los dos nombres en el HTML y la URL con «solo lo que hay»
   contiene uno y no el otro (E2, R3).
4. `[nuevo]` Filtrar por dos categorías devuelve la **unión** y filtrar por
   categoría + disponibilidad devuelve la **intersección**, verificado sobre un
   fixture donde ambos conjuntos son distintos y no vacíos (E4, E5, R2).
5. `[nuevo]` Un producto con `syncedPrice` 900 y `priceOverride` 300 aparece
   bajo «hasta 500» y **no** bajo «desde 500»; y un producto de 600 con una
   promoción vigente del 50 % aparece bajo «hasta 500» (E6, E6b, R4). Es el
   criterio que hace imposible ordenar por la columna cruda.
6. `[nuevo]` Un producto en una moneda sin tasa vigente no aparece bajo ningún
   rango, y en `sort=precio_asc` y en `sort=precio_desc` ocupa la **última**
   posición en las dos (E7, R5).
7. `[nuevo]` `sort=nombre` sobre «ácido», «Agua», «azúcar» devuelve ese orden
   exacto (E9).
8. `[nuevo]` Con más productos que el tope de página y todos con el mismo
   `createdAt`, la unión de la página 1 y la página 2 de `sort=reciente` tiene
   tantos identificadores distintos como filas devueltas: ni repetidos ni
   ausentes (E10, R8).
9. `[nuevo]` En `/[slug]/buscar?q=…` **sin** `sort`, el producto de nombre exacto
   sigue en la posición 1 y sigue apareciendo al menos un producto de la misma
   categoría: los criterios 1 y 2 de F-021, re-ejecutados tal cual (R1, I8).
10. `[nuevo]` En esa misma búsqueda **con** `sort=precio_asc`, el orden es el de
    precio de punta a punta y el primero ya no es necesariamente el de la capa
    léxica (E12).
11. `[nuevo]` Una URL con un parámetro desconocido, una categoría inexistente,
    `precio_min` > `precio_max` y letras donde va un número responde **200** y su
    HTML no contiene ningún chip de esos valores (E15, R10, R18).
12. `[nuevo]` Una combinación válida sin resultados responde 200 y su HTML
    contiene el nombre de cada filtro aplicado y un enlace para quitarlo; una
    tienda sin productos responde 200 con el mensaje de siempre y **sin** panel
    (E16, E17).
13. `[nuevo]` `node scripts/check-bundle-budget.mjs` termina con código 0 y el
    número medido **no sube**, y `grep -rn "use client" src/components/store/`
    no devuelve ningún componente de filtro (E14, R12).
14. `[nuevo]` El HTML de una URL filtrada contiene `noindex` y un
    `<link rel="canonical">` a `/[slug]` (R14).
15. `[nuevo]` `EXPLAIN` de la consulta que sirve la superficie filtrable no hace
    `Seq Scan` sobre `StoreProduct`, sobre un fixture con volumen suficiente —
    la misma exigencia y la misma trampa que el criterio 8 de F-021 (SP4 de
    aquella: nunca `enable_seqscan = off`). Solo aplica si SP3 se cierra por una
    vía que llegue a SQL.
16. `[nuevo]` Un producto `visible = false` y otro con `deletedAt` no nulo no
    aparecen bajo **ninguna** combinación de filtros y órdenes, recorriendo el
    producto cartesiano de las opciones ofrecidas (E21, R7).
17. `[nuevo]` Una tienda `SUSPENDED` responde con el aviso de cerrada y sin
    ninguna consulta de catálogo, y un slug en modo selector responde 404
    (E18, E19).
18. `[nuevo]` `bash .agent/verify.sh <ID> --full` termina con código 0.

## Incongruencias detectadas

**I1 — `/[slug]` es `●` (SSG) y dos criterios ya cerrados lo exigen.** El
primero de F-004 dice «`npm run build` marca /[slug] y /[slug]/p/[productSlug]
como ● (SSG), no como ƒ (Dynamic)» y el séptimo de F-017 dice «`npm run build`
sigue marcando las rutas de tienda como (SSG), no como Dynamic»
(`.agent/features.json`, ambos con `passes: true`). Está verificado con la salida
real del build en `.agent/specs/F-021/tests.md:135-154`. Leer `searchParams` en
un segmento lo vuelve dinámico, así que **poner los filtros sobre `/[slug]`
rompería los dos criterios**, y por la regla 3 no se pueden reescribir. Es la
razón de SP4 y de R13. La tensión de fondo es la que ya discutieron F-004 y
F-013 (el HTML del CDN es lo que hace usable la tienda con conexión limitada), y
la salida es la que ya eligió F-021: **una ruta dinámica aparte, y el catálogo
sin filtrar sigue saliendo de la caché.**

**I2 — el precio que el comprador ve no está en ninguna columna.** `loadCatalog`
devuelve cuatro campos crudos más las promociones vigentes
(`src/features/catalog/server/queries.ts:249-269`) y quien compone el número es
`ProductCard` llamando a `resolvePrice`
(`src/components/store/ProductCard.tsx:97-102`), que encadena override →
promoción → conversión de moneda (`src/lib/pricing.ts:65-120`). Consecuencia
dura: **un `ORDER BY "syncedPrice"` ordenaría por un número que nadie ve**, y un
`WHERE "syncedPrice" BETWEEN …` dejaría fuera productos rebajados que sí están
en el tramo (E6, E6b). Reproducir esa cadena en SQL exigiría duplicar
`src/lib/promotions.ts` —incluida la validación de `conditions`, que es JSON— y
`AGENTS.md` § Prohibiciones prohíbe duplicar lógica entre la capa de datos y la
vista. De aquí sale R4 y sale SP3.

**I3 — «más vendido» no tiene fuente pública.** El contrato es explícito:
«**Nunca se envía** `costo`, `margen`, el entero de `existencia`, `Venta`,
`MovimientoStock`…» (`docs/sync-contract.md:249`), y
`docs/adr/0003-disponibilidad-por-query-convergente.md` mantiene fuera el stock
por diseño. Lo único que se le parece son los `OrderItem` de los pedidos nacidos
en este storefront (`prisma/schema.prisma:573-595`), que **no** son las ventas de
la tienda: son la fracción que pasó por aquí, hoy prácticamente cero, y su
`storeProductId` es anulable a propósito. Exponerlo públicamente además publica
volumen comercial. SP1.

**I4 — no hay marca ni atributos, ni el contrato los trae.** El pedido del
humano nombra «marca/atributos si existen»; no existen. `StoreProduct` tiene
nombre, precio, disponibilidad, categoría local, imágenes y descripción
(`prisma/schema.prisma:366-419`) y `CanonicalProduct` añade EAN, nombre,
descripción, imagen y categoría global (`prisma/schema.prisma:300-326`). El
`payload` de `PRODUCT` de la v4 tampoco lo manda
(`docs/sync-contract.md:216-239`). Un filtro por marca exigiría una v5 del
contrato coordinada con cuadrecaja, que es un feature aparte y lo abre el humano
(regla 4). Queda **fuera**, escrito.

**I5 — «subcategorías» no existen como dato hoy.** `GlobalCategory` tiene
`parentId` y una relación de árbol (`prisma/schema.prisma:263-276`), pero
**nadie escribe ese campo**: el seed crea cuatro categorías globales planas
—«Bebidas», «Alimentos», «Aseo», «Panadería»— espejo una a una de las locales
(`prisma/seed.ts:71`, `prisma/seed.ts:83`, `prisma/seed.ts:326-333`), y solo
asigna `globalCategoryId` a los canónicos que tienen `ean`
(`prisma/seed.ts:1054`). `LocalCategory` no tiene árbol en absoluto
(`prisma/schema.prisma:279-294`). Es decir: **un filtro «por categoría y
subcategoría» hoy filtraría un solo nivel**. Afecta sobre todo a la propuesta
hermana; aquí queda escrito para que nadie prometa jerarquía sin poblarla
primero (SP2).

**I6 — el catálogo no pagina hoy.** `loadCatalog` es un `findMany` sin `take` ni
`skip` (`src/features/catalog/server/queries.ts:192-216`) y `/[slug]` pinta
todas las tarjetas. No lo causa esta propuesta, pero sí lo hace visible: en
cuanto se ofrece ordenar, un catálogo grande deja de ser una lista larga y pasa
a ser una lista larga **que además hay que ordenar entera** en cada petición.
Cualquier tope que se ponga en la superficie filtrable convive con un `/[slug]`
que sigue sin ninguno.

**I7 — cada combinación de filtros sería una entrada de caché nueva.**
`cached()` construye la clave con `keyParts` **más los argumentos** de la función
envuelta (`src/lib/cache.ts`), y hoy `getStoreCatalog` pasa un solo argumento, el
`storeId`: una entrada por tienda, invalidada por un tag. Si los filtros viajan
como argumentos a una lectura cacheada, el número de entradas pasa a ser el
producto de las opciones de cada faceta, y todas ellas cuelgan del mismo tag, así
que un cambio de precio las invalida todas a la vez. Es un argumento fuerte a
favor de la opción (a) de SP3: **una sola lectura cacheada por tienda, y el
filtrado y el orden encima de ella.**

**I8 — el orden por capas de F-021 y un orden elegido por el comprador se
contradicen.** R1 de `.agent/specs/F-021/spec.md` dice que «un resultado que casó
en la capa léxica va **siempre** por encima de uno que solo casó en la difusa».
Un `sort=precio_asc` mezcla capas por definición. **Resuelto aquí sin
preguntar**: el orden por capas es el orden **por defecto** y no cambia; un
`sort` explícito lo sustituye entero (E12). Así los criterios 1 y 2 de F-021
—que se verifican sin `sort`— siguen verdes, y el criterio 9 de esta propuesta
existe justamente para demostrarlo.

**I9 — «más reciente» no significa «nuevo en la tienda».**
`StoreProduct.createdAt` (`prisma/schema.prisma:405`) es cuándo apareció la fila
**en esta base**, no cuándo el negocio empezó a vender el producto. En el alta
inicial de una tienda, los cuatrocientos productos comparten instante y el orden
lo deciden enteramente los desempates (E10, R8). El campo del POS que se le
parece es `sourceUpdatedAt`, que es una guarda anti-rancio y cambia en cada
edición: ordenar por él pondría primero «lo último que alguien tocó», que no es
lo que el comprador entiende por «novedades». La etiqueta que se le ponga en la
UI tiene que ser honesta con esto; lo decide `sdd-designer`.

**I10 — ofrecer «solo lo que hay» roza una decisión ya tomada.** El catálogo
**no** filtra por `availability` a propósito
(`src/features/catalog/server/queries.ts:193-198`, y R7/E6 de
`.agent/specs/F-021/spec.md` lo repiten para la búsqueda), y el quinto criterio
de F-006 se verificó viendo cómo un producto agotado cambia en `/[slug]`.
Ofrecerlo como filtro **opt-in** no contradice nada; ponerlo por defecto sí
contradiría las dos cosas y escondería inventario que el comerciante quiere
enseñar. De aquí sale R3, y es la clase de decisión que se toma en silencio y se
descubre tarde.

## Huecos y preguntas al humano

**SP1 — ¿«más vendido» ahora, con los pedidos de este storefront, o no todavía?**
_Qué falta:_ una fuente de «unidades vendidas» que sea pública y verdadera.
_Por qué bloquea:_ el humano lo pidió por nombre («más vendido si hay datos para
eso»). Cambia si hay o no una opción de orden, y si hace falta una consulta
agregada nueva. No bloquea al resto del feature.
_Opciones:_
(a) **No ofrecerlo ahora.** El contrato prohíbe `Venta` y `MovimientoStock`
(`docs/sync-contract.md:249`) y los `OrderItem` de aquí no son las ventas de la
tienda (I3). Se reabre cuando haya volumen real de pedidos.
(b) **Ofrecerlo a partir de `OrderItem`**, contando unidades de pedidos no
cancelados de esa tienda en una ventana (30 o 90 días), con un mínimo por debajo
del cual el producto no puntúa. Es dato real, pero mide **este canal**, no el
mostrador, y publica volumen comercial a cualquiera que mire.
(c) **Pedir el dato al POS** en una v5 del contrato. Es el único camino a un «más
vendido» verdadero, y es un feature aparte que abre el humano (regla 4).
_Recomendación:_ **(a)**. Hoy el número sería casi todo ceros y el orden se
decidiría por los desempates; peor aún, diría «más vendido» mostrando otra cosa.
(b) es defendible como «lo más pedido por aquí» **si se llama así en la
pantalla**, nunca «más vendido».

**SP2 — ¿dónde vive el filtro por categoría, aquí o en
`categorias-y-subcategorias`?**
_Qué falta:_ el reparto entre dos propuestas hermanas que se están escribiendo a
la vez y que se solapan en una pieza concreta.
_Por qué bloquea:_ si las dos definen su propia forma de nombrar una categoría en
la URL, la tienda acaba con dos maneras de decir lo mismo, y la que llegue
segunda tendrá que romper los enlaces de la primera.
_Opciones:_
(a) **Repartido por naturaleza**: la **navegación** por categoría —URL propia y
legible, jerarquía padre/hijo, migas, página indexable— vive en
`categorias-y-subcategorias`; el **filtro** por categoría vive aquí, como un
parámetro más del panel, reutilizando el vocabulario que aquella defina. Si esta
propuesta se construye primero, define el parámetro y la hermana lo hereda.
(b) **Todo aquí**: la categoría es un filtro y nada más; la propuesta hermana se
queda solo con el selector visual.
(c) **Todo allá**: este feature no ofrece filtro de categoría y se limita a
precio, disponibilidad y promoción.
_Recomendación:_ **(a)**, con una condición práctica: quien se construya primero
fija el nombre del parámetro y el otro lo consume sin renombrarlo. El motivo es
de producto, no de código: una categoría es una **sección de la tienda** por la
que se navega y que se quiere indexar, mientras que un filtro es un recorte
temporal que se descarta (y que va `noindex`, R14). Son dos cosas distintas
aunque compartan el dato. Ojo con I5: hoy no hay jerarquía que navegar.

**SP3 — ¿dónde se calculan el filtro y el orden por precio?**
_Qué falta:_ decidir si el precio se resuelve en SQL o en la capa de aplicación.
_Por qué bloquea:_ es la decisión que fija el techo de escala del feature, y
condiciona si hacen falta índices, una columna derivada o una migración. Bloquea
a `sdd-architect`, no solo al veredicto.
_Opciones:_
(a) **En la capa de aplicación, sobre la única lectura cacheada por tienda que ya
existe.** `getStoreCatalog` sigue devolviendo el catálogo entero, cacheado y
tagueado como hoy, y el filtrado y el orden se hacen encima con `resolvePrice`,
el mismo compositor que pinta las tarjetas. Cero consultas nuevas, cero
migraciones, cero riesgo de que el precio filtrado difiera del mostrado, y una
sola entrada de caché por tienda (I7). Cuesta recorrer el catálogo entero en cada
petición: irrelevante con cientos de productos, insostenible con decenas de
miles.
(b) **En SQL, sobre `COALESCE("priceOverride", "syncedPrice")` convertido.**
Escala sin techo y usa índices, pero **ignora las promociones** (reimplementarlas
en SQL es duplicar `src/lib/promotions.ts`, I2): un producto rebajado quedaría
fuera de su tramo real y el orden no coincidiría con los precios pintados.
(c) **Una columna derivada de precio efectivo en moneda base**, mantenida por un
reindexador al que llamen las mismas escrituras que ya llaman al de búsqueda —
exactamente el patrón que `docs/adr/0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md`
estableció para `searchDocument`. Es lo correcto a largo plazo y es caro: la
columna depende además de `Promotion` y de `ExchangeRate`, así que una tasa nueva
invalida la tienda entera.
_Recomendación:_ **(a) ahora, (c) cuando haga falta**, con el umbral medido y
anotado en vez de intuido. (b) no: entregaría un filtro de precio que miente
sobre los productos en promoción, que son justo los que el comprador busca.

**SP4 — ¿en qué URL vive el catálogo filtrado?**
_Qué falta:_ elegir la superficie, dado que `/[slug]` no puede volverse dinámica
(I1).
_Por qué bloquea:_ define la ruta, los enlaces internos, las migas de la
propuesta hermana y qué se indexa. Bloquea a `sdd-architect` y a `sdd-designer`.
_Opciones:_
(a) **Una ruta propia y dinámica** para el catálogo filtrado, hermana de la de
búsqueda. `/[slug]` mantiene su HTML del CDN y gana un enlace «Filtrar y
ordenar»; la ruta nueva reutiliza `ProductCard`, la paginación y el aviso de
tienda cerrada.
(b) **Reutilizar `/[slug]/buscar`**, que ya es `ƒ`, aceptando filtros sin `q`.
Cero rutas nuevas y un solo sitio que mantener, a cambio de una URL que dice
«buscar» cuando el comprador no buscó nada, y de una página que ya gestiona
cuatro estados y pasaría a gestionar seis.
(c) **Volver `/[slug]` dinámica.** Descartada: rompe dos criterios cerrados
(regla 3) y anula el ISR que sostiene la tienda en conexiones lentas.
_Recomendación:_ **(a)**. Es la misma forma que ya eligió SP2 de F-021 y por el
mismo motivo, y deja las tres superficies con un nombre honesto: `/[slug]`
catálogo, buscar, y catálogo filtrado. Los dos parsers y el motor de orden se
comparten (R17), así que (a) no duplica lógica, solo composición.

**SP5 — ¿las facetas muestran cuántos productos hay en cada opción?**
_Qué falta:_ decidir si junto a «Bebidas» va un «(12)».
_Por qué bloquea:_ cambia el diseño del panel y, sobre todo, la forma de la
consulta: un conteo por opción es una agregación más, o un recorrido más del
catálogo.
_Opciones:_
(a) **Sin conteos.** Lo más barato y lo menos útil: el comprador descubre que una
faceta está vacía al pulsarla.
(b) **Con conteos solo en el catálogo filtrado**, calculados en el mismo
recorrido que ya hace el filtrado si SP3 se cierra por (a): coste
prácticamente nulo. En la página de búsqueda no se ofrecen, porque allí exigirían
una segunda consulta.
(c) **Con conteos en las dos superficies**, aceptando la consulta extra en la
búsqueda.
_Recomendación:_ **(b)**. Un conteo evita el callejón sin salida —que es el
peor momento de un panel de facetas— y en la superficie donde es gratis. La
asimetría con la búsqueda es visible pero honesta; (c) se puede añadir después
sin cambiar ninguna URL.

## No decidido a propósito

- **Los nombres exactos de los parámetros de la URL** y su forma (repetidos vs.
  separados por coma). Lo decide `sdd-architect`, coordinado con
  `.agent/specs/propuestas/categorias-y-subcategorias.md` por SP2.
- **Dónde vive el módulo que interpreta y canoniza los parámetros** —
  src/lib/catalogFilters.ts (por crear) o dentro de `src/features/catalog/` — y si
  valida con Zod o a mano. Es servidor, así que Zod está permitido
  (`AGENTS.md` § Arquitectura prohíbe Zod solo en el árbol de cliente).
  `sdd-architect`.
- **Los índices nuevos, si los hay.** Dependen enteramente de cómo se cierre
  SP3. `sdd-architect`.
- **El número de productos a partir del cual filtrar en memoria deja de valer.**
  Medido, no supuesto, y anotado como hizo F-021 con el volumen de su fixture de
  `EXPLAIN`. `sdd-architect`.
- **La disposición del panel** —acordeón o lista, dónde va el selector de orden
  en 360 px, cuántas facetas se ven sin desplegar— y **las etiquetas en
  español**, incluida la de «más reciente», que tiene que ser honesta con I9.
  `sdd-designer`.
- **Si el panel se ofrece también en la ficha de producto** («otros de esta
  categoría»). Es navegación, no filtrado: cae del lado de la propuesta hermana
  o de un feature nuevo que abre el humano (regla 4).
- **Los tramos de precio sugeridos**, si los hay (por ejemplo «hasta 200», «200
  a 500», «más de 500») frente a dos campos abiertos. Depende de SP5 y del
  diseño. `sdd-designer`, con el dato de precios reales de la tienda.
- **Si en el futuro estos filtros se aplican también al selector de una marca**
  (buscar y filtrar en todas las sucursales a la vez). Hoy es 404 (E19), igual
  que en F-021; si se pide, es un feature nuevo y lo abre el humano.
