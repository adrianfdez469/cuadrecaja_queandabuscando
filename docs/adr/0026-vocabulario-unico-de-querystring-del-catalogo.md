# 0026 — Un solo vocabulario de querystring para acotar el catálogo, y toda superficie que lo lee es dinámica y noindex

**Aceptada** · 31 de agosto de 2026 · F-027

Complementa a [ADR 0025](0025-recortes-del-catalogo-como-proyeccion.md), que dice
_cómo_ se calcula un recorte del catálogo (proyectando la lectura cacheada), y a
[ADR 0006](0006-isr-con-revalidacion-por-tag.md), que dice qué páginas salen del
CDN. Esta dice **cómo se nombra** el recorte en la URL y **dónde puede vivir**.

## Contexto

Tres superficies distintas enseñan hoy subconjuntos del mismo catálogo de una
sucursal: `/[slug]` (todo), `/[slug]/c/[categorySlug]` (una categoría, F-026) y
`/[slug]/buscar` (un término, F-021). F-027 añade la cuarta —acotar por
disponibilidad, categoría, precio, promoción y destacados, y reordenar— y con
ella aparece la pregunta que ninguna de las tres tuvo que responder: qué nombre
tienen esos parámetros y en qué URL viven.

Sin una regla, cada superficie inventa la suya. El resultado conocido es doble:
un `precio_max` que significa una cosa en el buscador y otra en el catálogo
—«el bug que nadie ve hasta que un comprador compara las dos pantallas»
(R17 de `.agent/specs/F-027/spec.md`)—, y un espacio de URL combinatorio que un
rastreador recorre entero, multiplicando por las facetas las páginas indexadas
de cada tienda.

Y hay un tercer riesgo, más caro y ya fichado: leer `searchParams` en un
segmento convierte esa ruta en `ƒ` (Dynamic). Hacerlo sobre `/[slug]` rompe el
primer criterio de aceptación de F-004 y saca la tienda del CDN, que es el mismo
daño que causa tocar `/[slug]` desde el `matcher` de `src/proxy.ts`
(`.agent/playbook/proxy-matcher-anula-isr.md`).

## Decisión

**Hay un solo vocabulario de querystring para acotar y ordenar el catálogo
público, lo interpreta un solo módulo, y toda superficie que lo lee es una ruta
dinámica propia, `noindex`, con su canónica apuntando a `/[slug]`.**

Cuatro consecuencias, y las cuatro son el motivo:

**(a) Un nombre por concepto, en todo el storefront.** Un parámetro que ya
existe no se renombra al cruzar de superficie: el de categoría es el que definió
F-026 (`categorySlug`, con valores `LocalCategory.slug`) y el de página es el
que definió F-021 (`p`). Un concepto nuevo se bautiza una vez y vale para las
dos superficies.

**(b) Un solo intérprete.** Parsear, canonizar y aplicar el vocabulario es un
módulo puro, sin Prisma y sin React, que las páginas importan. Dos parsers del
mismo `precio_max` es la definición del defecto que (a) intenta evitar.

**(c) Nunca sobre una ruta pre-renderizada.** `/[slug]`,
`/[slug]/p/[productSlug]` y `/[slug]/c/[categorySlug]` **no leen
`searchParams`**. Quien quiera acotar navega a la superficie dinámica, que
declara `dynamic = "force-dynamic"` y `revalidate = 0` como literales
(`.agent/playbook/revalidate-no-literal.md`). El catálogo sigue saliendo del
CDN.

**(d) Un recorte no compite en el índice con su catálogo.** Toda respuesta de
una URL con filtro u orden lleva `robots: { index: false }` y
`<link rel="canonical">` a `/[slug]`. No se añade `Disallow` en
`src/app/robots.ts`: una URL bloqueada por robots.txt no llega a leer el
`noindex` y puede acabar indexada igual.

## Consecuencias

- El coste de añadir una faceta nueva es una entrada en el vocabulario y una
  línea en el módulo que lo interpreta, no una ruta nueva.
- Las URL con filtros se comparten por WhatsApp y las rastrean bots: por eso el
  módulo **ignora** lo que no entiende y responde 200, nunca 400 (R10 de la
  spec).
- La misma selección produce siempre la misma URL, porque el módulo es también
  quien las construye: parámetros en orden fijo, valores ordenados y sin
  repetir, y los que valen su valor por defecto omitidos.
- Una superficie dinámica no se pre-renderiza y no entra en `src/lib/cache.ts`;
  lo que sí está cacheado es la lectura de datos que hay debajo
  (`getStoreCatalog`), igual que en ADR 0025.

## Alternativas descartadas

- **Filtrar con `searchParams` sobre `/[slug]`.** Rompe el primer criterio de
  F-004 y saca la tienda del CDN. Cerrado también por SP4 de F-027 y por I6 de
  F-026.
- **Colgar los filtros de `/[slug]/c/[categorySlug]`** (lo que sugería F-026 al
  entregar). Volvería dinámica una ruta que hoy se pre-renderiza, y además una
  categoría en un segmento de ruta no puede expresar la unión de dos, que es
  un criterio de aceptación de F-027.
- **Un vocabulario por superficie.** Dos interpretaciones del mismo parámetro,
  y ninguna forma de compartir un enlace entre pantallas.
- **Valores separados por coma** (`categorySlug=a,b`) en vez de repetidos. Un
  `<form method="get">` sin JavaScript emite parámetros repetidos; la coma
  obligaría a construir la URL con JavaScript en algo que renderiza catálogo.
