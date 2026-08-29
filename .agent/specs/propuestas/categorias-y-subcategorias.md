---
propuesta: categorias-y-subcategorias
agente: sdd-spec
actualizado: 2026-08-29T04:00:00Z
estado: promovida
---

> **PROMOVIDA a F-026 el 2026-08-29.** El contenido completo, con las preguntas ya resueltas por el humano, vive ahora en `.agent/specs/F-026/spec.md`. Este archivo se conserva como historial de la propuesta original, sin editar.

> Origen: el humano pidió, en un mismo mensaje, botón de atrás, breadcrumb,
> **selector de categorías y subcategorías**, filtros avanzados, ordenamientos
> avanzados y reseñas. El orquestador lo partió en cuatro propuestas
> independientes; esta es la del selector de categorías.
>
> **Aviso de entrada, y es el motivo por el que este documento existe:** la
> palabra «subcategorías» no tiene hoy ningún dato detrás en este sistema. Está
> verificado contra el schema, contra el código y contra la base de desarrollo
> (I1, I2). No se decide aquí: es **SP1**, la pregunta central al humano.

## Problema

Quien entra a `/[slug]` recibe **una sola lista plana** con todo el catálogo de
la sucursal, ordenada por `featured` y nombre
(`src/features/catalog/server/queries.ts:199`). No hay ninguna otra puerta de
entrada al catálogo: ni agrupación, ni selector, ni forma de decir «enséñame
solo las bebidas». Con 28 productos —los que hay hoy en la base de desarrollo—
se baja con el dedo; con cuatrocientos, se abandona.

F-021 añadió una segunda puerta, `/[slug]/buscar`, pero **buscar exige saber qué
escribir**. El comprador que entra a mirar qué hay no tiene término que teclear:
necesita **navegar**, no consultar. Y lo irónico es que el dato ya está: los 28
`StoreProduct` de la base de desarrollo tienen los 28 su `localCategoryId`, la
consulta del catálogo ya trae el nombre de la categoría
(`src/features/catalog/server/queries.ts:212-213`) y ya lo expone como
`categoryName` (`:264`) — y lo único que hace con él la tienda pública es
imprimirlo en la ficha de un producto
(`src/app/[slug]/p/[productSlug]/page.tsx:190`). Ni la tarjeta del catálogo lo
enseña, ni nada permite filtrar por él.

## Alcance

### Dentro

1. **Un selector de categorías en el catálogo de una sucursal**: la lista de
   categorías que esa tienda de verdad tiene en stock, cada una enlazada a su
   propia vista. Server-rendered, cero JavaScript de cliente (R9).
2. **Una vista de catálogo por categoría**: los productos visibles de esa
   sucursal que pertenecen a esa categoría, con el mismo filtro de visibilidad y
   la misma tarjeta que el catálogo completo (R3, R4).
3. **La derivación de la lista de categorías desde el stock real de la
   sucursal**, no desde la lista del negocio: `LocalCategory` está acotada por
   `businessId` y dos sucursales de una marca comparten catálogo de categorías
   pero no de existencias (I10).
4. **La invalidación de la vista por categoría en el mismo embudo que el
   catálogo**: un cambio de precio, de visibilidad o de categoría no puede dejar
   la vista de la categoría rancia mientras `/[slug]` se actualiza (R7).
5. **Un camino de vuelta al catálogo completo** siempre presente desde la vista
   de categoría, para que ningún producto quede inalcanzable (R6).
6. **El segundo nivel (subcategorías)**: dentro **solo si el humano responde
   SP1 con la opción (b) o la (c)**. Con la opción (a) queda explícitamente
   fuera de este ciclo y vuelve como feature propio cuando exista el dato.

### Fuera (explícito)

- **Filtros por precio, por disponibilidad y ordenamientos.** Son la propuesta
  hermana `filtros-y-ordenamiento-avanzados`. El límite exacto entre las dos
  **no está decidido** y es SP4: F-021 metió «por categoría» en el mismo
  renglón que precio y disponibilidad (`.agent/specs/F-021/spec.md:84`).
- **Botón de atrás y breadcrumb.** Son la propuesta hermana
  `navegacion-atras-y-breadcrumb`. Esta propuesta **crea el nivel intermedio**
  que ese breadcrumb va a querer nombrar (tienda › categoría › producto), así
  que le entrega el dato y no la pieza visual.
- **Reseñas y calificaciones.** Propuesta hermana `resenas-y-calificaciones`.
- **Crear, renombrar, ordenar o borrar categorías desde el panel.** Las
  categorías las posee cuadrecaja: llegan por el evento `CATEGORY` del sync
  (`src/features/sync/server/handlers/misc.ts`) y ADR 0007 no le da al panel
  ningún campo de categoría. Si el comerciante quiere otra categoría, la crea en
  su POS.
- **Poblar `GlobalCategory` en producción**, o sea, un camino de clasificación
  (manual o automático) que asigne taxonomía global a los canónicos. Hoy no
  existe (I2) y F-021 ya dejó dicho que eso «sigue siendo un feature que abrirá
  el humano» (`.agent/specs/F-021/spec.md:62-64`). Aquí solo se **consume** lo
  que haya.
- **Tocar la consulta de F-021.** Su tercera capa usa la misma cascada de
  categoría (`src/features/catalog/server/search.ts:167-191`) y no se modifica:
  filtrar los resultados de búsqueda por categoría es otra cosa y no entra.
- **Navegar por categoría a través de varias sucursales de una marca a la vez**,
  ni desde el slug en modo selector. Misma frontera que E13 de F-021.
- **Categorías en el marketplace** (F-015, sobre `CanonicalProduct`). Este
  feature vive dentro de un `storeId`.
- **El buscador de productos del panel.** Otra pantalla, otro actor.

## Actores y precondiciones

**El comprador, sin cuenta y sin sesión.** La misma frontera pública de
`docs/adr/0016-escritura-publica-sin-sesion.md`: nadie se identifica para
navegar un catálogo.

Precondiciones:

- El slug resuelve a una **sucursal** (`kind: "branch"` de
  `src/features/storefront/server/resolve.ts`) y su `Store.status` es
  `PUBLISHED`. `DRAFT` es 404, `SUSPENDED` es el aviso de cerrada (E11, E12), y
  `kind: "selector"` es 404 (E10) — exactamente como F-021.
- Los productos tienen categoría. Es cierto hoy: `localCategoryId` viaja en el
  `payload` de `PRODUCT` (`docs/sync-contract.md:226`) y en la base de
  desarrollo **28 de 28** `StoreProduct` lo tienen puesto. Pero es **nullable**
  (`prisma/schema.prisma:379`) y un `CATEGORY`/`DELETE` lo pone a `NULL` sin
  avisar (I4), así que «sin categoría» es un estado real que hay que dibujar
  (R6).
- **NO es precondición que exista taxonomía global.** `GlobalCategory` solo
  tiene las cuatro filas planas que siembra `prisma/seed.ts` para F-021, y
  ninguna con padre (I1, I2).

## Comportamiento esperado

**E1 — el catálogo ofrece las categorías que esa tienda tiene.**
Dada una sucursal publicada con productos visibles en tres categorías, cuando el
comprador pide `/[slug]`, entonces el HTML contiene un enlace por cada una de
esas tres categorías, con su nombre, y ninguno de una cuarta categoría del mismo
negocio que esa sucursal no tiene en stock.

**E2 — elegir una categoría enseña solo esa categoría.**
Dada la categoría «Bebidas» con siete productos visibles en esa sucursal, cuando
el comprador sigue su enlace, entonces la página responde 200 y su HTML contiene
los nombres de esos siete productos y **ningún** nombre de un producto de otra
categoría de la misma tienda.

**E3 — la visibilidad es exactamente la del catálogo.**
Dado un producto con `visible = false` o con `deletedAt` no nulo, cuando se pide
la vista de su categoría, entonces no aparece. Dado un producto
`OUT_OF_STOCK`, **sí aparece**, con su distintivo de agotado: es lo que ya hace
el catálogo, que filtra por `visible`/`deletedAt`/`status` y **no** por
`availability` (`src/features/catalog/server/queries.ts:194`).

**E4 — el precio de la vista por categoría es el mismo que el del catálogo.**
Dado un producto con `priceOverride`, cuando se ve en su categoría, entonces
muestra el precio del override y la misma conversión a la moneda base que la
tarjeta del catálogo. Ninguna regla de precio se reimplementa aquí.

**E5 — una categoría vacía no se ofrece.**
Dada una categoría del negocio sin ningún producto visible en **esta** sucursal,
cuando el comprador pide `/[slug]`, entonces esa categoría no aparece en el
selector, y pedir su vista directamente responde 404 (E9).

**E6 — un producto sin categoría sigue siendo alcanzable.**
Dado un producto con `localCategoryId` nulo, cuando el comprador navega, entonces
ese producto no aparece en ninguna vista de categoría **pero sí en el catálogo
completo**, y el enlace al catálogo completo está presente en todas las vistas de
categoría (R6).

**E7 — renombrar la categoría en el POS cambia lo que se lee, no dónde está.**
Dado un evento `CATEGORY`/`UPDATE` que renombra «Bebidas» a «Refrescos», cuando
se revalida, entonces el selector muestra «Refrescos» y **la URL de esa categoría
sigue respondiendo 200** (R8: el identificador de la URL no se mueve porque el
nombre cambie).

**E8 — borrar la categoría en el POS no rompe la tienda.**
Dado un evento `CATEGORY`/`DELETE`, cuando se revalida, entonces esa categoría
desaparece del selector, su vista responde 404, y **sus productos siguen
apareciendo en el catálogo completo** — porque la clave ajena los deja con
`localCategoryId` a `NULL`, no los borra (I4).

**E9 — una categoría que no es de esta tienda es 404.**
Dado el identificador de una categoría que existe en el negocio pero cuyos
productos están en **otra** sucursal, cuando se pide su vista bajo el slug de
esta, entonces responde 404 — igual que un identificador inexistente. Nunca una
lista vacía ni una página que confirme que esa categoría existe en algún sitio.

**E10 — el slug de una marca en modo selector no tiene categorías.**
Dado un slug que resuelve a `kind: "selector"`, cuando se pide una vista de
categoría bajo él, entonces responde 404, igual que ya hacen
`/[slug]/p/[productSlug]` y `/[slug]/buscar`.

**E11 — una tienda cerrada no filtra catálogo por aquí.**
Dada una tienda `SUSPENDED`, cuando se pide cualquier vista de categoría,
entonces se muestra el mismo aviso de cerrada que `/[slug]` y **no se ejecuta
ninguna consulta de catálogo**.

**E12 — una tienda en `DRAFT` es 404**, en el selector y en la vista de
categoría, sin excepción.

**E13 — un cambio de precio se ve también dentro de la categoría.**
Dado un `PRODUCT`/`UPDATE` del sync que cambia el precio de un producto, cuando
se completa la revalidación, entonces `GET` de la vista de su categoría muestra
el precio nuevo. **No basta con que lo muestre `/[slug]`**: es el fallo que ya
apareció tres veces en F-017 y tiene ficha propia
(`.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`).

**E14 — un producto que cambia de categoría desaparece de la vieja y aparece en
la nueva.**
Dado un `PRODUCT`/`UPDATE` que cambia `localCategoryId`, cuando se revalida,
entonces el producto ya no está en la vista de la categoría anterior y sí en la
de la nueva, y **las dos** vistas están al día (corolario de R7: hay que
invalidar dos, no una).

**E15 — se lee sin JavaScript.**
Dada la página con el JavaScript deshabilitado, cuando se carga, entonces el
selector navega igual —son enlaces— y los nombres y precios de los productos
están en el HTML.

**E16 — dos niveles.** _Solo si SP1 se resuelve con (b) o (c)._
Dada una categoría con subcategorías, cuando el comprador la elige, entonces ve
las subcategorías **y** los productos que cuelgan directamente de la categoría
padre; y cuando elige una subcategoría, ve solo los de ella. Un producto nunca
aparece dos veces en la misma pantalla.

## Reglas de negocio

**R1 — la lista de categorías se deriva del stock visible de la sucursal**, no
de `LocalCategory` del negocio ni de una lista configurada. Una categoría existe
para el comprador si y solo si tiene al menos un producto que el catálogo de esa
sucursal mostraría (R3). Comprobable: E1, E5.

**R2 — la categoría es la `LocalCategory` de la oferta**
(`StoreProduct.localCategoryId`, `prisma/schema.prisma:379`), que es lo único
que el POS manda con cada producto (`docs/sync-contract.md:226`). **No** es la
`GlobalCategory` del canónico, que hoy solo tiene datos en el seed (I2). Si SP1
se resuelve con (c), la global pasa a ser el **primer** nivel y la local el
segundo; hasta entonces, no participa.

**R3 — el filtro de visibilidad es gemelo del catálogo**: `deletedAt IS NULL`,
`visible = TRUE`, `Store.status = PUBLISHED`, y **nada** sobre `availability`.
Es la misma R7 de F-021 y por el mismo motivo: si uno de los dos cambia, el otro
cambia también. Comprobable por separado (E3).

**R4 — la vista por categoría no reimplementa el catálogo.** Precio, override,
conversión de moneda, promociones, imágenes y tarjeta salen del mismo camino que
`/[slug]` (`src/features/catalog/server/queries.ts`, `ProductCard`). Una segunda
implementación de la regla de precio es un bug de F-004 esperando (E4).

**R5 — el `storeId` es un parámetro obligatorio de la lectura**, no un filtro
que quien llama pueda olvidar. Misma R6 de F-021: sin él, no compila.

**R6 — ninguna navegación puede volver un producto inalcanzable.** El enlace al
catálogo completo está presente en toda vista de categoría, y un producto sin
categoría se sigue viendo ahí (E6). **No se inventa una categoría «Sin
categoría»**: el comerciante no la creó y el catálogo completo ya es su puerta.
Reversible sin coste si el humano prefiere lo contrario.

**R7 — la vista por categoría se invalida por el mismo tag que el catálogo**
(`storeCatalogTag`, `src/lib/cache.ts:29`), y toda escritura que hoy revalida el
catálogo revalida también estas vistas. Nadie arma a mano la lista de lo que hay
que revalidar: es la prohibición de `AGENTS.md` § Prohibiciones y el defecto que
F-017 encontró tres veces. Comprobable: E13, E14.

**R8 — el identificador de una categoría en la URL es estable y no cambia al
renombrarla** (E7). Una URL publicada no se mueve porque el comerciante corrigió
una tilde: es el mismo criterio que ADR 0018 (a) fija para los slugs de tienda
(«un valor no se reasigna nunca»). Qué identificador concreto es SP3.

**R9 — nada de esto añade JavaScript de cliente al catálogo.** Ni el selector ni
la vista llevan `"use client"`: es la prohibición literal de `AGENTS.md`
§ Prohibiciones para todo lo que renderice catálogo, y la misma R14 de F-021.
El selector es una lista de enlaces `<a href>`.

**R10 — `/[slug]` sigue marcándose ● (SSG) en el build.** Es el primer
`acceptance_criteria` de F-004, que la regla 3 prohíbe tocar, y en Next 16
leer `searchParams` en esa página la volvería ƒ (Dynamic). Consecuencia directa:
el filtro por categoría **no puede ser un query param de `/[slug]`** (I6, SP2).

**R11 — el espacio de nombres de los slugs de categoría es la tienda, no el
registro global.** La tabla `Slug` de ADR 0018 gobierna el primer nivel (marcas,
sucursales y palabras reservadas); una categoría vive **debajo** del slug de la
tienda y no entra en ese registro ni consume ninguno de sus valores.

**R12 — la vista por categoría es indexable; la de búsqueda no.** `/[slug]/buscar`
se emite `noindex` a propósito (`src/app/[slug]/buscar/page.tsx`), porque una
consulta no es contenido. Una categoría **sí** lo es: es un recorte estable del
catálogo, con nombre propio y enlace compartible, y por eso conviene que se
cachee y se indexe.

**R13 — el selector se muestra entero y ordenado por nombre.** La lista de
categorías de un negocio en el POS es de decenas como mucho; no se pagina, no se
trunca y no se ordena por popularidad (no hay dato de popularidad). Si algún día
un negocio trae doscientas, se decide entonces con el número delante.

**R14 — el contrato con cuadrecaja no cambia**, salvo que SP1 se resuelva con la
opción (b). Con (a) o (c) no entra ni sale ningún campo por `/api/internal/*` y
`docs/sync-contract.md` no sube de versión.

## Casos límite y errores

| Caso                                                            | Qué tiene que pasar                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tienda sin ningún producto                                      | Sin selector; el mensaje de catálogo vacío que ya existe                                                                                                     |
| Tienda con productos pero **ninguno** con categoría             | Sin selector, catálogo completo intacto. No se dibuja un selector con cero entradas                                                                          |
| Categoría del negocio sin producto en **esta** sucursal         | No aparece en el selector; su vista es 404 (E5, E9)                                                                                                          |
| Categoría con todos sus productos `visible = false`             | Idéntico al anterior: para el comprador esa categoría no existe (R1, R3)                                                                                     |
| Categoría con todos sus productos `OUT_OF_STOCK`                | **Sí** aparece, y su vista los lista agotados (R3)                                                                                                           |
| Producto con `localCategoryId` nulo                             | Solo en el catálogo completo (E6). Nunca una categoría inventada                                                                                             |
| `CATEGORY`/`DELETE` del POS                                     | La clave ajena es `ON DELETE SET NULL` (`prisma/migrations/20260825000000_init/migration.sql:472`): sus productos quedan sin categoría, no borrados (E8, I4) |
| `CATEGORY`/`UPDATE` que renombra                                | Cambia el nombre visible; la URL no se mueve (E7, R8)                                                                                                        |
| Dos categorías del mismo negocio cuyos nombres slugifican igual | Dos URLs distintas, cada una con sus productos. Hoy nada lo impide (I3)                                                                                      |
| Entrega desordenada de dos eventos `CATEGORY`                   | Puede quedar el nombre viejo: `handleCategory` no tiene guarda anti-rancia (I8). Decidir si se arregla aquí o se acepta escrito                              |
| Identificador de categoría inexistente o mal formado            | 404, nunca 500 ni lista vacía                                                                                                                                |
| Slug en modo selector                                           | 404 (E10)                                                                                                                                                    |
| Tienda `SUSPENDED` / `DRAFT`                                    | Aviso de cerrada sin consulta / 404 (E11, E12)                                                                                                               |
| Alias de sucursal (dos URLs, misma tienda)                      | Las dos responden 200 y comparten entrada de caché y tags, vía `canonicalSlug` (ADR 0018 (c))                                                                |
| Base caída                                                      | Fallo visible; nunca un catálogo vacío disfrazado de «esta categoría no tiene nada»                                                                          |
| Producto que cambia de categoría                                | Las **dos** vistas quedan al día (E14, R7)                                                                                                                   |

## Datos y contrato

**Lo que hay hoy, verificado leyendo el schema y consultando la base de
desarrollo, no la nota de nadie:**

| Modelo                                                      | Jerarquía                       | Quién lo escribe                                                         | Filas en la base de desarrollo                   |
| ----------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `GlobalCategory` (`prisma/schema.prisma:263-276`)           | **Sí**: `parentId` + `children` | **Nadie en producción.** Solo `prisma/seed.ts` (F-021, SP3), y plano     | 4 filas, **0 con `parentId`**                    |
| `LocalCategory` (`prisma/schema.prisma:279-294`)            | **No.** No hay campo de padre   | El sync, evento `CATEGORY` (`src/features/sync/server/handlers/misc.ts`) | 5 filas, 4 con `globalCategoryId` (las del seed) |
| `StoreProduct.localCategoryId` (`prisma/schema.prisma:379`) | —                               | El sync, `payload` de `PRODUCT` (`docs/sync-contract.md:226`)            | 28 de 28 `StoreProduct` la tienen                |

`grep -rn "parentId"` sobre `src/`, `prisma/seed.ts`, `docs/` y `scripts/`,
excluyendo `src/generated/`, devuelve **tres líneas y las tres son la
declaración del propio schema**. No hay un solo escritor ni un solo lector de la
jerarquía en todo el repositorio.

**El `payload` de `CATEGORY`**, que `docs/sync-contract.md` **no documenta**
(I7) y que hay que leer en `src/features/sync/schemas.ts:48-54`:

```jsonc
{
  "categoryId": "string", // Categoria.id del POS → LocalCategory.externalId
  "businessId": "string", // comprobado contra el token desde la v3
  "name": "string",
  "color": "string | null",
  "updatedAt": "2026-08-25T14:03:00.000Z",
}
```

No lleva padre, no lleva orden, no lleva visibilidad. **Si el humano elige la
opción (b) de SP1, este payload gana un `parentCategoryId` y el contrato sube a
v5**, coordinado con el equipo de cuadrecaja — que ya tiene la v3 y la v4 sin
anunciar (notas de F-017 y F-024 en `.agent/features.json`).

Deltas de datos según la respuesta a SP1 y SP3:

| Dónde                                       | Qué                                                                        | Cuándo                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `LocalCategory`                             | `@@unique([businessId, slug])` y desambiguación al crear                   | Si SP3 = (a), slug en la URL                                   |
| `src/features/sync/server/handlers/misc.ts` | Generar el slug sin colisión y no moverlo al renombrar (R8)                | Si SP3 = (a)                                                   |
| `LocalCategory`                             | `parentId` + relación a sí misma, y `sourceUpdatedAt` si se cierra I8      | Si SP1 = (b)                                                   |
| `docs/sync-contract.md`                     | Documentar el `payload` de `CATEGORY` (hoy no está) y, con (b), subir a v5 | (b) obliga; con (a) o (c) es deuda que F-022 ya promete cerrar |
| `prisma/seed.ts`                            | Nada obligatorio: ya siembra cuatro categorías locales con productos       | —                                                              |

Nada de esto toca la fusión canónica, ni `searchDocument`, ni
`searchVector`: este feature **lee** categorías, no reescribe el índice de
búsqueda.

## Criterios de aceptación propuestos

**Todos son `[nuevo]`**: esta propuesta no tiene entrada en
`.agent/features.json` y la regla 4 dice que el backlog lo abre el humano.
Están escritos contra la forma que recomienda SP2 (una ruta propia por
categoría); si el humano elige otra, cambian las URLs, no el fondo.

1. `[nuevo]` `GET /tienda-demo` responde 200 y su HTML contiene un enlace por
   cada categoría con al menos un producto visible en esa tienda —cuatro hoy en
   la base de desarrollo: Bebidas, Alimentos, Aseo y Panadería— y ninguno de una
   categoría del mismo negocio sin producto ahí (E1, E5).
2. `[nuevo]` `GET` de la vista de «Bebidas» de `tienda-demo` responde 200, su
   HTML contiene los nombres de los siete productos visibles de esa categoría, y
   `grep` de un nombre de producto de «Aseo» sobre ese mismo HTML no devuelve
   nada (E2).
3. `[nuevo]` Poniendo `visible = false` a un producto de la categoría y
   revalidando, su nombre desaparece de esa vista; poniéndole `OUT_OF_STOCK`,
   sigue apareciendo con su distintivo (E3, R3).
4. `[nuevo]` Un producto con `priceOverride` muestra en la vista de categoría el
   **mismo** precio que en `/[slug]`, comparado carácter a carácter sobre los dos
   HTML (E4, R4).
5. `[nuevo]` `GET` de la vista de una categoría del mismo negocio cuyos productos
   están en otra sucursal responde **404**, idéntico a un identificador
   inexistente (E9).
6. `[nuevo]` `GET` de una vista de categoría bajo un slug en modo selector
   responde 404 (E10), y bajo una tienda `SUSPENDED` devuelve el aviso de cerrada
   sin ejecutar consulta de catálogo (E11).
7. `[nuevo]` Tras un `PRODUCT`/`UPDATE` del sync que cambia el precio, la vista
   de la categoría del producto muestra el precio nuevo —no solo `/[slug]`—
   (E13). Enviado con `scripts/send-catalog-batch.mjs`, no simulado.
8. `[nuevo]` Tras un `PRODUCT`/`UPDATE` que cambia `localCategoryId`, el producto
   no aparece en la vista de la categoría anterior y sí en la de la nueva, en la
   misma comprobación (E14).
9. `[nuevo]` Tras un `CATEGORY`/`DELETE`, la categoría desaparece del selector, su
   vista responde 404 y **los nombres de sus productos siguen apareciendo en
   `/[slug]`** (E8, I4).
10. `[nuevo]` Tras un `CATEGORY`/`UPDATE` que renombra la categoría, el selector
    muestra el nombre nuevo y la URL de la categoría sigue respondiendo 200 (E7,
    R8).
11. `[nuevo]` Dos categorías del mismo negocio cuyos nombres slugifican igual
    producen dos URLs distintas, y cada una lista solo sus propios productos
    (I3).
12. `[nuevo]` `npm run build` sigue marcando `/[slug]` como ● (SSG), no como ƒ
    (Dynamic) — el primer `acceptance_criteria` de F-004 sigue cierto (R10).
13. `[nuevo]` `node scripts/check-bundle-budget.mjs` termina con código 0, y
    `grep -rn "use client"` sobre los archivos nuevos de este feature no devuelve
    nada (R9).
14. `[nuevo]` Con el JavaScript deshabilitado, seguir un enlace del selector
    carga la vista de la categoría con sus productos en el HTML (E15).
15. `[nuevo]` `bash .agent/verify.sh <ID> --full` termina con código 0.
16. `[nuevo]` _Solo si SP1 = (b) o (c):_ una categoría con subcategorías muestra
    las subcategorías y los productos que cuelgan del padre, sin repetir ningún
    producto en la misma pantalla (E16).

## Incongruencias detectadas

**I1 — «subcategorías» no tiene ningún dato detrás, y la jerarquía que existe
está muerta.** `GlobalCategory` declara `parentId`, `parent` y `children`
(`prisma/schema.prisma:267-270`) y tiene su índice
(`prisma/migrations/20260825000000_init/migration.sql:352` y la clave ajena a sí
misma). Pero `grep -rn "parentId"` en `src/`, `prisma/seed.ts`, `docs/` y
`scripts/`, quitando `src/generated/`, devuelve **solo las tres líneas del
schema**: nadie escribe un padre y nadie lo lee. Y `LocalCategory`
(`prisma/schema.prisma:279-294`) —lo que el POS de verdad manda— **no tiene
ningún campo de padre en absoluto**. Contrastado con la base de desarrollo:
`SELECT count(*), count("parentId") FROM "GlobalCategory"` devuelve `4 | 0`. Es
decir: **hoy no existe ni una sola subcategoría en el sistema**, ni en
desarrollo ni en producción. Lo que el humano pidió no es construible tal cual;
qué se hace es SP1.

**I2 — la taxonomía global que sembró F-021 es un fixture de desarrollo, no una
taxonomía.** La nota de F-021 en `.agent/features.json` dice «taxonomia minima
sembrada con cascada a LocalCategory», y es verdad, pero conviene leer qué
siembra: `prisma/seed.ts:73-80` declara `GLOBAL_CATEGORIES = CATEGORIES`, o sea
un espejo **uno a uno y plano** de las cuatro categorías locales («Bebidas»,
«Alimentos», «Aseo», «Panadería»), y rellena `LocalCategory.globalCategoryId`
desde esa misma lista. El comentario del propio seed lo dice sin adornos: ese
relleno «no lo lee la consulta de F-021 (R17 solo mira el canónico)». Y en
producción no ocurre ni eso: `handleCategory`
(`src/features/sync/server/handlers/misc.ts`) escribe `businessId`,
`externalId`, `name`, `slug` y `color`, y **nunca** `globalCategoryId`. Base de
desarrollo: 5 `LocalCategory`, 4 con global —las del seed— y la del segundo
negocio sin ninguna. La I5 de `.agent/specs/F-021/spec.md:465` sigue siendo
cierta en producción palabra por palabra.

**I3 — `LocalCategory.slug` no es único ni se mantiene al día.** La migración
inicial solo declara `LocalCategory_businessId_externalId_key` y
`LocalCategory_globalCategoryId_idx`
(`prisma/migrations/20260825000000_init/migration.sql:352-355`): **no hay unique
sobre `slug`**. Y el handler lo calcula `slugify(payload.name) || "categoria"`
únicamente en la rama `create`; la rama `update` escribe `{ name, color }`
(`src/features/sync/server/handlers/misc.ts`), así que renombrar «Bebidas» a
«Refrescos» deja el slug `bebidas` para siempre. Dos categorías llamadas
«Bebidas» y «bebidas » colisionarían en silencio. Cualquier URL basada en el
slug de categoría hereda los dos problemas: SP3.

**I4 — borrar una categoría en el POS descategoriza productos en silencio.** El
handler hace `deleteMany` sobre `LocalCategory` en el `DELETE`, y la clave ajena
es `ON DELETE SET NULL`
(`prisma/migrations/20260825000000_init/migration.sql:472`): todos los
`StoreProduct` de esa categoría quedan con `localCategoryId` a `NULL`. El
comentario del handler lo asume («products keep their categoryId pointing at
nothing»), pero la consecuencia para este feature es concreta y hay que
dibujarla (E8, R6). De paso: las promociones de scope `CATEGORY`
(`src/features/admin/types.ts:147`) pierden su objetivo por el mismo camino.
Preexistente, no lo causa este feature.

**I5 — el catálogo ya carga la categoría y la tira.** `loadCatalog` selecciona
`localCategoryId` y `localCategory: { select: { name: true } }`
(`src/features/catalog/server/queries.ts:212-213`) y lo expone como
`categoryName` (`:63`, `:264`), pero el único sitio de la tienda pública que lo
imprime es la ficha del producto (`src/app/[slug]/p/[productSlug]/page.tsx:190`)
— `src/components/store/ProductCard.tsx` no lo menciona. Buena noticia: el
selector no necesita inventar una consulta nueva sobre la lectura cacheada del
catálogo. Mala: hay un dato cargado en cada render que hoy no sirve para nada.

**I6 — el filtro por categoría NO puede ser un query param de `/[slug]`.**
`src/app/[slug]/page.tsx` tiene `generateStaticParams` y su catálogo pasa por
`cached()` con `storeCatalogTag`
(`src/features/catalog/server/queries.ts:266-271`); el primer
`acceptance_criteria` de F-004 exige que `npm run build` marque `/[slug]` como ●
(SSG). En Next 16, leer `searchParams` en una página la vuelve dinámica: un
`/[slug]?categoria=bebidas` rompería un criterio de un feature cerrado que la
regla 3 prohíbe tocar. F-021 chocó con lo mismo y lo resolvió con una ruta
aparte (su R15). Es la restricción que da forma al feature: SP2.

**I7 — `docs/sync-contract.md` nunca documenta el `payload` de `CATEGORY`.** El
documento tiene § «Mapeo de nombres» y secciones de `payload` para `PRODUCT` y
`STORE`, pero `CATEGORY` solo aparece en la enumeración de entidades
(`docs/sync-contract.md:182` y `:191`). Su forma real está únicamente en
`src/features/sync/schemas.ts:48-54`. Muerde dos veces: cualquier subcategoría
por contrato empieza por documentar lo que ya se manda, y el cuarto
`acceptance_criteria` de F-022 promete una tabla de propiedad exhaustiva que
tendrá que incluirlo.

**I8 — `handleCategory` no tiene guarda anti-rancia.** Hace `upsert`
incondicional; a diferencia de `PRODUCT`, no compara `payload.updatedAt` contra
ningún `sourceUpdatedAt` almacenado — `LocalCategory` ni siquiera tiene esa
columna (`prisma/schema.prisma:279-294`). `AGENTS.md` § Cosas que muerden exige
que «todo lo que el sync escribe … va guardado contra escrituras rancias
(`sourceUpdatedAt`)». Dos eventos `CATEGORY` entregados al revés dejan el nombre
viejo. Hoy da igual porque el nombre solo se pinta en una ficha; **deja de dar
igual en cuanto el nombre es un elemento de navegación**. Preexistente; se
decide si se cierra aquí o se acepta por escrito.

**I9 — F-021 ya nombró este feature, y lo metió en el mismo renglón que los
filtros.** `.agent/specs/F-021/spec.md:84` dice literalmente: «**Facetas,
filtros y ordenaciones** (por precio, por categoría, por disponibilidad). Otro
feature.» O sea: el documento cerrado que más cerca está de este puso «por
categoría» **junto a** precio y disponibilidad, que es exactamente lo que el
humano acaba de partir en dos propuestas paralelas. La frontera hay que
dibujarla a mano: SP4.

**I10 — las categorías son del negocio, no de la tienda.**
`LocalCategory.businessId` (`prisma/schema.prisma:281`): dos sucursales de una
marca comparten la lista de categorías y no las existencias. El panel ya resolvió
exactamente esto con `listStoreCategories`
(`src/features/admin/server/products.ts:146`), que filtra
`where: { products: { some: { storeId } } }` — pero **sin** `deletedAt`,
`visible` ni `Store.status`, así que **no es reutilizable tal cual** para el lado
público: violaría R3. Es un buen molde, no una función a reusar.

## Huecos y preguntas al humano

**SP1 — ¿De dónde salen las «subcategorías» que pediste, si hoy no existe
ninguna?**
_Qué falta:_ decidir si este feature entrega un nivel o dos, y de dónde saldría
el segundo.
_Por qué bloquea:_ es la mitad del pedido literal. Y no es un detalle de
implementación: (b) cambia el contrato con cuadrecaja y depende de otro equipo,
(c) abre un feature de clasificación que hoy no existe, y (a) recorta el pedido.
Cambia el schema, el contrato y la pantalla; bloquea a `sdd-architect` entero,
no solo al veredicto.
_Opciones:_
(a) **Un solo nivel, ahora.** El selector lista las `LocalCategory` que la tienda
tiene en stock, tal cual las manda el POS. Cero cambios de contrato, cero espera,
y cubre el **100 %** de los datos reales de hoy (28 de 28 productos tienen
`localCategoryId`). La palabra «subcategoría» sale de este ciclo y vuelve como
feature propio cuando haya dato.
(b) **Pedirle el padre a cuadrecaja.** `parentCategoryId` en el `payload` de
`CATEGORY`, `parentId` en `LocalCategory`, contrato a v5. Es lo correcto en el
origen —el comerciante ya organizó su árbol en su POS, si es que su `Categoria`
tiene padre— pero **no sabemos si lo tiene**: el contrato nunca documentó ese
payload (I7). Depende de otro equipo, y la cola de avisos pendientes ya lleva la
v3 y la v4 sin enviar.
(c) **`GlobalCategory` como primer nivel y `LocalCategory` como segundo.** La
relación ya existe (`LocalCategory.globalCategoryId`) y el seed ya la rellena:
«Bebidas» (global) › «Refrescos de pomo» (local del negocio). Sin tocar el
contrato ni esperar a nadie. Pero **en producción nadie clasifica** (I2), así que
exige un camino de clasificación —a mano en el panel, o automático— que es un
feature que tienes que abrir tú (regla 4).
_Recomendación:_ **(a) ahora, y (c) como feature siguiente.** (a) se puede
construir esta semana, es verdad sobre todos los datos reales, y no compromete
nada: cuando exista clasificación, el mismo selector gana un nivel por encima sin
tirar nada. Antes de descartar (b), **una pregunta de un minuto al equipo de
cuadrecaja** («¿vuestra `Categoria` tiene categoría padre?») cambia la
recomendación: si la respuesta es sí, (b) gana a (c), porque el árbol del
comerciante ya está hecho y clasificar a mano aquí sería trabajo duplicado.

**SP2 — ¿Dónde vive la vista por categoría, si `/[slug]` no puede leer
`searchParams` sin dejar de ser SSG (I6)?**
_Qué falta:_ la forma de la navegación: ruta, URL y estrategia de caché.
_Por qué bloquea:_ decide si hay migración de datos (SP3 depende de esta), si hay
ruta nueva, y si el catálogo por categoría se sirve del CDN o se renderiza en cada
visita. Bloquea a `sdd-architect` y a `sdd-designer`.
_Opciones:_
(a) **Ruta propia por categoría**, del estilo /[slug]/c/[categorySlug] (por
crear), estática y revalidada por `storeCatalogTag`. Se lee sin JavaScript, se
cachea en el CDN, se comparte por enlace, se indexa (R12) y `/[slug]` sigue ●
(SSG). Exige un identificador de categoría estable y único por tienda, o sea
tocar el dato (SP3).
(b) **Ruta dinámica con query param**, del estilo /[slug]/categoria (por crear),
calcada de la página de búsqueda de F-021 (ƒ Dynamic, su R15). Cero cambios de
datos —se puede filtrar por `id`— pero cada visita es un render de servidor sin
caché de CDN, justo lo que ADR 0006 evita para el catálogo, y el público objetivo
tiene conexión limitada.
(c) **Anclas en la misma página.** `/[slug]` sigue mostrando todo el catálogo,
agrupado por categoría con encabezados, y el selector son enlaces a `#bebidas`.
Cero rutas, cero JavaScript, `/[slug]` sigue SSG, y se puede hacer en un día.
Pero el HTML sigue trayendo los cuatrocientos productos: alivia la vista, no el
peso, que es medio problema.
_Recomendación:_ **(a).** Es la única que escala, se cachea y da una URL con
sentido propio. (c) es un buen paso intermedio si quieres algo ya y aceptas
rehacerlo. (b) es la peor de las tres: paga el coste de lo dinámico sin ganar
nada que (a) no dé.

**SP3 — Si SP2 = (a): ¿qué identifica a una categoría en la URL, dado que su
slug no es único ni estable (I3)?**
_Qué falta:_ elegir el identificador y, con él, si hay migración.
_Por qué bloquea:_ es una URL pública; equivocarse cuesta redirecciones para
siempre. Bloquea a `sdd-architect`.
_Opciones:_
(a) **Slug garantizado por este feature**: `@@unique([businessId, slug])`,
desambiguación con sufijo al crear, y el slug **congelado** en el primer
`CREATE`. URLs legibles (`/tienda-demo/c/bebidas`). Cambia el schema y el handler
del sync.
(b) **El `id` (uuid) de `LocalCategory`.** Cero cambios de datos, cero
ambigüedad, URLs ilegibles y peores para indexar.
(c) **El `externalId` del POS.** Ya es único por negocio, pero **expone un
identificador interno de cuadrecaja en una URL pública** — exactamente la fuga
que F-018 cerró cuando `reason: 'own'` de `slug-availability` ligaba un id del
POS con una marca pública.
_Recomendación:_ **(a) con el slug congelado**, y el nombre visible leído siempre
de `name`. Es el mismo criterio que ADR 0018 (a) ya fijó para el primer nivel
(«un valor no se reasigna nunca»), y el precio es una migración aditiva pequeña.
(c) queda descartada por lo que F-018 dejó escrito.

**SP4 — ¿Dónde está la frontera entre esta propuesta y
`filtros-y-ordenamiento-avanzados`?**
_Qué falta:_ decir cuál de las dos es dueña del filtro por categoría.
_Por qué bloquea:_ ahora mismo lo estamos especificando dos agentes en paralelo.
Si las dos lo construyen, una se tira; si ninguna lo hace, nadie lo construye.
F-021 las metió en el mismo renglón (I9), así que la ambigüedad es real y está
por escrito.
_Opciones:_
(a) **Esta propuesta es dueña de la categoría como NAVEGACIÓN** —una vista por
categoría, enlazable y cacheable— y la otra no toca categoría en absoluto: sus
filtros de precio, disponibilidad y orden se aplican **dentro** de una categoría,
reusando la lectura que se define aquí.
(b) **Esta propuesta solo aporta el dato y el selector visual**, y todo el
filtrado —categoría incluida— vive en la otra, con un único mecanismo de estado
en la URL para las cuatro dimensiones.
(c) **Se fusionan** en un solo feature de «navegar el catálogo».
_Recomendación:_ **(a).** La categoría no es un filtro más: es la única de las
cuatro dimensiones que merece una URL propia y cacheable —«Bebidas de Tienda X»
es una página; «de 100 a 200 CUP ordenado por precio» no lo es— y por eso encaja
con la arquitectura de ISR que ya existe, mientras que precio y orden empujan
hacia lo dinámico. Además (a) deja que esta salga sin esperar a la otra. Si
prefieres (b), **hay que decirlo antes de que arquitectura empiece**: esta
propuesta se reduciría a mostrar la categoría en la tarjeta y a la consulta que
lista las categorías de una tienda.

## No decidido a propósito

- **Si la tarjeta del catálogo muestra el nombre de la categoría.** El dato ya
  viaja (I5) y cuesta cero consultas, pero es densidad visual en una rejilla de
  dos columnas en móvil. Lo cierra `sdd-designer`.
- **La forma del selector** —fila de chips desplazable, lista lateral,
  `<details>` plegable— y su sitio exacto respecto de la caja de búsqueda de
  F-021. `sdd-designer`.
- **Si la vista por categoría se pre-renderiza en el build** (una entrada por
  tienda × categoría en `generateStaticParams`) o se renderiza en la primera
  petición y se cachea, como ya hace `/[slug]` con las tiendas nuevas.
  `sdd-architect`, con el número de combinaciones delante.
- **Si se cierra I8 aquí** (guarda anti-rancia para `CATEGORY`) o se acepta por
  escrito. Es un arreglo pequeño en un feature ajeno; lo decide `sdd-architect`
  y, si toca contrato, vuelve al humano.
- **Si la vista por categoría se pagina.** Depende del tope que fije la propuesta
  hermana para el catálogo completo; hoy no hay paginación en `/[slug]`.
- **Los nombres de la ruta, del componente y de la función de lectura.**
  `sdd-architect`.
- **Qué hace el breadcrumb con este nivel.** Esta propuesta le entrega el dato
  (tienda › categoría › producto); la forma la decide
  `navegacion-atras-y-breadcrumb`.
