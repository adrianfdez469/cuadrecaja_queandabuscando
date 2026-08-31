# 0025 — Un recorte del catálogo es una proyección de la lectura cacheada, no una consulta nueva

**Aceptada** · 31 de agosto de 2026 · F-026

Verificada por su primer caso real: `src/app/[slug]/c/[categorySlug]/page.tsx`
(el selector y la vista por categoría) implementan exactamente esta decisión —
cero consultas nuevas, cero tags nuevos, `getStoreCategories`/
`getStoreCategoryView` (`src/features/catalog/server/queries.ts`) son
envoltorios sobre `getStoreCatalog(branch)` más una función pura
(`src/features/catalog/storeCategories.ts`).

Complementa a [ADR 0006](0006-isr-con-revalidacion-por-tag.md) y delimita por
arriba a [ADR 0021](0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md),
que sigue siendo la excepción y no la regla.

## Contexto

`getStoreCatalog()` (`src/features/catalog/server/queries.ts`) es hoy la única
lectura del catálogo público de una sucursal. Va envuelta en `cached()` con el
tag `storeCatalogTag(canonicalSlug)` y devuelve, en dos round-trips paralelos,
los productos visibles **y** las promociones vigentes de esa tienda, para que la
precedencia de precio se resuelva sobre la **misma** foto de los datos (R28 de
F-004: nunca dos lecturas cacheadas por separado que puedan divergir).

A partir de F-026 empiezan a llegar features que quieren enseñar **un
subconjunto** de ese mismo catálogo: la vista por categoría (F-026), los filtros
por precio y disponibilidad y los ordenamientos (F-027), y el nivel intermedio
del breadcrumb (F-025). Cada uno puede resolverse de dos maneras, y la
diferencia no es de estilo:

1. Una consulta propia con su `WHERE` y su entrada de caché.
2. Una proyección en memoria sobre lo que `getStoreCatalog()` ya devolvió.

La primera parece la barata («traigo solo lo que necesito»), y es la cara: cada
`WHERE` nuevo es una **segunda copia** del filtro de visibilidad
—`deletedAt IS NULL`, `visible = TRUE`, `Store.status = PUBLISHED`, nada sobre
`availability`—, una entrada de caché más que invalidar, y, si el recorte
incluye precio, una segunda lectura de promociones que puede quedar desfasada
respecto de la de al lado. Con N categorías por tienda son N entradas de caché
donde hoy hay una, y N sitios donde ese filtro puede derivar sin que nada se
ponga rojo.

## Decisión

**Todo recorte del catálogo de una sucursal —por categoría, por precio, por
disponibilidad, por orden— se sirve proyectando el resultado de
`getStoreCatalog(branch)` en memoria. No abre una consulta propia, no crea una
entrada de caché propia y no define un tag propio.**

Tres consecuencias, y las tres son el motivo:

**(a) El filtro de visibilidad existe una sola vez.** R3 de F-026 («el filtro es
gemelo del catálogo») deja de ser una regla que alguien tiene que recordar en
dos sitios y pasa a ser una propiedad estructural: solo hay un `WHERE`, el de
`loadCatalog`. Un recorte no puede enseñar un producto que `/[slug]` esconde,
porque parte de la lista que `/[slug]` ya calculó.

**(b) Precio, override, moneda y promociones no se reimplementan.** El recorte
hereda los objetos `CatalogProduct` tal cual, con sus promociones ya indexadas
contra la misma foto. Comparar carácter a carácter el precio de `/[slug]` con el
de un recorte es cierto por construcción, no por disciplina.

**(c) La invalidación es la que ya existe.** Las dos vistas —el catálogo entero
y cualquier recorte— son la **misma entrada de caché**, así que un
`revalidateTag(storeCatalogTag(slug))` las deja al día a las dos. No hay una
segunda lista de tags que alguien pueda olvidar, que es exactamente el defecto
que `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
fichó tres veces en F-017.

### La excepción, y por qué lo es

**La búsqueda de F-021 (ADR 0021) no cae bajo esta regla y no se reescribe.** Un
término de búsqueda no es un recorte: es un ranking sobre un índice
(`searchVector`, `searchDocument`) que no se puede calcular en memoria sin
traerse el catálogo entero y reimplementar el diccionario de Postgres. Además
depende de `searchParams`, así que su página es dinámica y nunca entra en
`src/lib/cache.ts`. La regla de arriba se aplica a los recortes cuyo predicado
es una **columna que `CatalogProduct` ya lleva**; si un feature necesita un
predicado que no está en ese tipo, la pregunta correcta es si añadir la columna
al tipo (barato: la fila ya se lee) antes que abrir una consulta.

## Consecuencias

- Un recorte cuesta **cero** round-trips adicionales por petición. En caliente,
  cero; en frío, los mismos dos que `/[slug]` ya paga.
- El coste se paga en memoria: el proceso materializa el catálogo entero de una
  sucursal para enseñar una parte. Con las cifras de hoy (28 `StoreProduct` en
  la base de desarrollo, 15 como máximo en una sola sucursal) es irrelevante.
- Un `CatalogProduct` gana una columna cada vez que un recorte necesita un
  predicado nuevo. Es un cambio aditivo y **rompe la compilación** de los dos
  lectores del tipo —`loadCatalog` y `searchStoreProducts`—, que es justo lo que
  garantiza que no diverjan.

## Cuándo se reabre

Cuando `/[slug]` deje de servir el catálogo entero de una sucursal en una sola
página; es decir, **el día que se pagine el catálogo**. En cuanto la lectura
completa deje de ser algo que la tienda ya paga, proyectar sobre ella pasa de
gratis a caro y hay que volver aquí con el número delante. El umbral técnico que
lo fuerza es el tamaño de la entrada del incremental cache de Next: una
sucursal del orden de varios miles de productos deja de caber, y lo primero que
se rompe es `/[slug]`, no el recorte.

## Alternativas descartadas

- **Una consulta y una entrada de caché por recorte.** N entradas por tienda, N
  copias del filtro de visibilidad, y una segunda lectura de promociones que
  puede divergir de la del catálogo.
- **Una lectura cacheada intermedia por categoría** que reuse la de promociones.
  Sigue duplicando el filtro y añade un tag más que mantener.
- **Filtrar con `searchParams` sobre `/[slug]`.** Volvería esa página Dynamic y
  rompe el primer criterio de aceptación de F-004.
