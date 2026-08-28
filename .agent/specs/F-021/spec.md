---
feature: F-021
agente: sdd-spec
actualizado: 2026-08-28T05:56:56Z
estado: listo
---

> Punto de partida: `.agent/specs/propuestas/busqueda-en-tienda.md`, escrita por
> un `sdd-spec` anterior. Este documento la formaliza, la contrasta contra el
> schema y el código de hoy, y **cierra sus dos preguntas abiertas** con lo que
> respondió el humano el 2026-08-28.
>
> **SP1, SP2, SP3 y SP4 están resueltas por el humano el 2026-08-28 y no se
> reabren** (§ Huecos y preguntas, con la respuesta literal de cada una). SP1:
> «No, sin embeddings (Recomendado)». SP2: «Página propia server-rendered
> (Recomendado)». SP3: «Sembrar taxonomía mínima + caer a LocalCategory
> (Recomendado)». SP4: «Fixture con volumen suficiente (Recomendado)».
>
> `estado: listo`: no queda ninguna pregunta abierta. Como SP2 da interfaz al
> feature, después de este ciclo hacen falta `sdd-architect` **y**
> `sdd-designer`. Las dos decisiones que este documento deja **a propósito** en
> manos de `sdd-architect` —I4, el único escritor de `to_tsvector` que permite la
> guarda G2, e I7, el diccionario y los topes bautizados «marketplace»— son
> decisiones de arquitectura, no preguntas al humano.

## Problema

Quien entra a una tienda no puede buscar: `/[slug]` pinta el catálogo completo
ordenado por `featured` y nombre (`src/features/catalog/server/queries.ts:199`) y
no hay ninguna otra puerta. Con cuarenta productos se baja con el dedo; con
cuatrocientos, se abandona.

Buscar aquí **no es** el buscador del marketplace. F-015 ya existe, pasa, y
consulta `CanonicalProduct` para todas las tiendas a la vez
(`src/features/marketplace/server/search.ts`). Lo que falta es lo diario:
buscar dentro de **un** `storeId`, sobre lo que esa tienda de verdad vende, con
el nombre y la descripción que el comerciante escribió.

Y el resultado esperado no es coincidencia exacta. Para «Refresco coca-cola
1.5 LT» se quiere ese producto primero, después otros formatos de coca-cola,
después otros refrescos, y muy al final «Cola-loca». Eso son **tres capas**
—léxica ponderada, difusa y expansión por categoría—, no una técnica.

## Alcance

### Dentro

1. **Un documento de búsqueda por `StoreProduct`**, con el texto que hoy no está
   indexado en ninguna parte: `StoreProduct.localName` (del sync) y
   `StoreProduct.description` (del panel), más los alias que ese negocio
   registró para el canónico. Hoy `StoreProduct` no tiene ni documento ni
   vector ni índice de búsqueda (I1).
2. **Su índice y su invariante de frescura**: ninguna escritura de una fuente
   del documento puede dejar el índice viejo, venga del panel o del sync (R3,
   I3).
3. **Ranking en tres capas**: léxica ponderada (`tsvector` español +
   `unaccent`), difusa (`pg_trgm`) y expansión por categoría (R1), donde la
   categoría es la **global** del canónico y, cuando no la tiene, la **local**
   de la tienda (R17, SP3 resuelta).
4. **Una taxonomía mínima sembrada** en `prisma/seed.ts`, con
   `globalCategoryId` asignado a los canónicos que ese archivo ya siembra, para
   que la capa 3 y el criterio 2 tengan datos en desarrollo (SP3 resuelta). No
   entra ningún camino de clasificación en producción: eso sigue siendo un
   feature que abrirá el humano.
5. **Registro de consultas**: una fila por consulta que llega a la base, con
   `storeId`, el término normalizado y el número de resultados. Nada más
   (decisión del humano, § Huecos).
6. **Una página de resultados propia dentro de la tienda**, renderizada en
   servidor, en /[slug]/buscar (por crear), con su caja de búsqueda —un
   `<form method="get">`— accesible desde el catálogo. Cero JavaScript de
   cliente nuevo (R14).
7. **Paginación mínima**: un tope de resultados por página y un enlace de
   servidor a la siguiente, con orden total para que no repita ni se salte
   filas (R10).

### Fuera (explícito)

- **pgvector / embeddings**. SP1 lo cierra: no ahora, y se reabre con datos.
- **El buscador del marketplace**: es F-015, ya cerrado. F-021 no toca
  `src/features/marketplace/server/search.ts` ni cambia lo que devuelve.
- **Búsqueda por cercanía**: sigue en `docs/adr/0011-sin-postgis-por-ahora.md`.
- **Buscar por código de barras**: prohibido explícitamente por F-024 (R9 de
  `.agent/specs/F-024/spec.md`), en el marketplace y aquí.
- **Facetas, filtros y ordenaciones** (por precio, por categoría, por
  disponibilidad). Otro feature.
- **Autocompletado, sugerencias en vivo y «quizás quisiste decir»**: los tres
  necesitan JavaScript de cliente o una segunda consulta por pulsación.
- **Buscar en varias sucursales de una marca a la vez**, y buscar desde el slug
  de una marca en modo selector (E13).
- **Política de retención o anonimizado del registro de consultas**: el humano
  la dejó fuera de este ciclo a propósito.
- **El buscador de productos del panel** (`src/app/admin/tiendas/[storeId]/productos/page.tsx`):
  es otra pantalla, con otro actor y otras reglas de visibilidad.

## Actores y precondiciones

**El comprador, sin cuenta y sin sesión.** Es la misma frontera pública que ya
describe `docs/adr/0016-escritura-publica-sin-sesion.md`: nadie se identifica
para buscar.

Precondiciones:

- El slug resuelve a una **sucursal** (`kind: "branch"` de
  `src/features/storefront/server/resolve.ts`) y su `Store.status` es
  `PUBLISHED`. `DRAFT` es 404 y `SUSPENDED` es el aviso de cerrada (E13, E14).
- `unaccent` y `pg_trgm` instalados: lo están desde F-002
  (`prisma/migrations/20260825000000_init/migration.sql:13`).
- Los `StoreProduct` de la tienda tienen su documento de búsqueda al día (R3).
- Para que la tercera capa aporte algo, los productos necesitan **categoría**.
  `GlobalCategory` está vacía y nadie la escribe (I5), así que la precondición
  real es la de R17: categoría global si el canónico la tiene —en desarrollo la
  siembra este feature—, y `LocalCategory` en cualquier otro caso, que es lo que
  el POS sí manda con cada producto. Una tienda sin ninguna de las dos pierde la
  capa 3 y conserva las otras dos.

## Comportamiento esperado

**E1 — la coincidencia exacta va primera.**
Dado un producto de la tienda llamado «Refresco coca-cola 1.5 LT», cuando el
comprador busca ese nombre completo, entonces ese producto es el resultado de la
posición 1.

**E2 — la misma consulta arrastra la categoría.**
Dada esa misma consulta, cuando hay en la tienda otro producto de la **misma
categoría** que no casa por texto, entonces aparece en los resultados —después
de los que casaron por texto—, no ausente. La categoría es la **global** del
canónico cuando la tiene, y la **local** de la tienda cuando no (R17).

**E2b — el producto sin categoría global entra por la local.**
Dado un producto cuyo canónico tiene `globalCategoryId` nulo —el caso de todo lo
que hoy llega del POS (I5)— pero que sí tiene `localCategoryId`, cuando otro
producto de esa misma categoría local casa por texto, entonces este aparece
igualmente en la capa 3.

**E3 — los acentos no cambian el conjunto.**
Dadas las consultas «refresco» y «refrescó», cuando se ejecutan sobre la misma
tienda, entonces devuelven **el mismo conjunto y el mismo orden**. Y en la otra
dirección: «cafe» encuentra «Café».

**E4 — un carácter de menos sigue encontrando.**
Dado el producto «Coca-Cola 1.5 L», cuando el comprador busca «cocacola»,
entonces el producto aparece en los resultados (capa difusa).

**E5 — cero resultados es una respuesta, y se registra.**
Dada una consulta sin ninguna coincidencia en las tres capas, cuando se
ejecuta, entonces la página responde 200 con un vacío explicado —nunca 404, ni
una lista en blanco sin texto— y queda **una fila** en el registro con
`resultCount = 0`.

**E6 — la visibilidad es exactamente la del catálogo.**
Dado un producto con `visible = false`, o con `deletedAt` no nulo, cuando el
comprador busca su nombre exacto, entonces no aparece. Dado un producto
`OUT_OF_STOCK`, **sí aparece**, con su distintivo de agotado: es lo que ya hace
el catálogo, que filtra por `visible`/`deletedAt`/`status` y **no** por
`availability` (`src/features/catalog/server/queries.ts:194`).

**E7 — nunca cruza tiendas.**
Dado un producto que solo existe en la tienda B, cuando se busca su nombre
exacto desde la tienda A, entonces no aparece, ni siquiera en la capa difusa ni
en la de categoría.

**E8 — editar la descripción cambia lo que se encuentra.**
Dado un producto cuya descripción no contiene «artesanal», cuando un admin
guarda una descripción que sí la contiene (`updateProduct`,
`src/features/admin/server/mutations.ts:203`), entonces buscar «artesanal» en
esa tienda lo devuelve, sin ningún reproceso manual.

**E9 — renombrar en el POS también cambia lo que se encuentra.**
Dado un producto sincronizado como «Refresco cola», cuando llega un
`PRODUCT`/`UPDATE` que cambia su `localName` a «Refresco de pomo», entonces
buscar «pomo» lo devuelve y el documento ya no ofrece el nombre viejo como
única entrada. (Este escenario no está en la propuesta: ver I3.)

**E10 — una consulta que no es una consulta no toca la base.**
Dada una `q` vacía, solo espacios, o solo signos de puntuación, cuando se pide
la página, entonces no se ejecuta ninguna búsqueda, **no se registra ninguna
fila** y la página muestra la caja de búsqueda con su ayuda. Un único carácter
alfanumérico **sí** es una consulta y se ejecuta.

**E11 — una consulta larguísima se recorta, no se rechaza.**
Dado un término de 5 000 caracteres, cuando se busca, entonces se trunca al
máximo definido y se busca con lo truncado; la respuesta es 200.

**E12 — el texto de una persona nunca rompe la consulta.**
Dada una consulta con `&`, `|`, `!`, `:*`, comillas o paréntesis sin cerrar,
cuando se ejecuta, entonces devuelve resultados o vacío, y **nunca** un error de
Postgres ni un 500 (R8).

**E13 — el slug de una marca en modo selector no tiene buscador.**
Dado un slug que resuelve a `kind: "selector"` (una marca con dos o más
sucursales), cuando se pide /[slug]/buscar, entonces responde 404, igual que ya
hace `/[slug]/p/[productSlug]` (`src/app/[slug]/p/[productSlug]/page.tsx:49`).

**E14 — una tienda cerrada no filtra catálogo por el buscador.**
Dada una tienda `SUSPENDED`, cuando se pide su página de búsqueda con cualquier
`q`, entonces se muestra el mismo aviso de cerrada que `/[slug]` (HD11) y **no
se ejecuta ninguna consulta de catálogo**.

**E15 — la segunda página no repite ni se salta filas.**
Dada una consulta con más resultados que el tope de página, cuando el comprador
sigue el enlace a la siguiente, entonces ve los siguientes resultados sin
repetir ninguno de la primera ni perder ninguno entre las dos.

**E16 — registrar no puede romper buscar.**
Dado un fallo al escribir la fila del registro, cuando ocurre, entonces la
respuesta de búsqueda sigue siendo 200 con sus resultados.

**E17 — la base caída no se disfraza de «sin resultados».**
Dado que la base no responde, cuando se busca, entonces la página falla de forma
visible; nunca devuelve una lista vacía como si no hubiera coincidencias.

**E18 — se lee sin JavaScript.**
Dada la página de resultados con el JavaScript deshabilitado, cuando se carga,
entonces los nombres y precios de los resultados están en el HTML y la caja de
búsqueda sigue funcionando (es un `<form method="get">`).

## Reglas de negocio

**R1 — el orden es por capas, y las capas no se mezclan.** Un resultado que casó
en la capa léxica va siempre por encima de uno que solo casó en la difusa, y
este por encima de uno que solo entró por categoría. Dentro de cada capa manda
la puntuación de esa capa. Comprobable: para un conjunto fijo, el orden por
capa es el mismo aunque la puntuación interna cambie.

**R2 — el documento de una oferta incluye, al menos:** `StoreProduct.localName`,
`StoreProduct.description` y los `ProductAlias` de ese negocio para el canónico.
No incluye códigos de barras (F-024 R9) ni el nombre de la tienda.

**R3 — ninguna escritura de una fuente del documento lo deja viejo.** Vale para
el panel (`description`) **y para el sync** (`localName`, alias nuevos). Es la
trampa que nombra `docs/adr/0004-identidad-canonica-en-el-sync.md` § Trampa, y
que `docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md`
convirtió en propiedad de construcción para el canónico: aquí tiene que serlo
igual. Comprobable por separado en E8 y E9.

**R4 — toda consulta que llega a la base deja una fila**, con `storeId`, término
normalizado y número de resultados. Una consulta que no llega a la base (E10) no
deja nada. Una fila por ejecución, no un contador agregado: agregar es una
consulta, no un modelo.

**R5 — el registro guarda tres cosas y ninguna más**: consulta, `storeId` y
número de resultados (más el instante en que ocurrió, sin el cual el registro no
sirve para nada). Sin IP, sin user-agent, sin identificador de persona.

**R6 — la búsqueda nunca cruza tiendas.** El `storeId` es un parámetro
obligatorio de la lectura, no un filtro que quien llama pueda olvidar: sin él,
no compila.

**R7 — el filtro de visibilidad es gemelo del catálogo.** `deletedAt IS NULL`,
`visible = TRUE`, `Store.status = PUBLISHED`, y **nada** sobre `availability`.
Si uno de los dos cambia, el otro tiene que cambiar también.

**R8 — la consulta no lanza nunca con texto de una persona.** Se usa
`plainto_tsquery`, que es lo que ya eligió F-015 por este mismo motivo
(`src/features/marketplace/server/searchVector.ts:32`), no `to_tsquery` ni
`websearch_to_tsquery` (I6).

**R9 — el término se normaliza antes de tocar la base**: recorte, colapso de
espacios, truncado a un máximo, y `null` cuando no queda ninguna letra ni dígito
(la semántica que ya implementa `src/lib/searchTerm.ts`).

**R10 — el orden es total.** Capa, puntuación, nombre e identificador: con eso,
paginar nunca repite ni salta (E15).

**R11 — el SQL crudo se compone solo con `Prisma.sql`**, nunca
`$queryRawUnsafe`/`$executeRawUnsafe`, nunca interpolando el texto de una
persona, y vive en `src/features/*/server/`
(`docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md`,
decisión (a)).

**R12 — se consulta contra la columna almacenada**, no contra una expresión
recalculada en la consulta: `"searchVector" @@ …`, jamás `to_tsvector(…) @@ …`.
Lo segundo da el mismo resultado y deja el índice GIN sin usar, que es
exactamente lo que el criterio 8 existe para pescar.

**R13 — registrar no bloquea ni rompe responder** (E16).

**R14 — la búsqueda no añade JavaScript de cliente al catálogo.** Ni la caja ni
la página de resultados llevan `"use client"`: es la prohibición de `AGENTS.md`
§ Prohibiciones para todo lo que renderice catálogo, y la razón por la que SP2 se
resolvió como página propia de servidor.

**R15 — la página de búsqueda no entra en la caché de tags ni en el `matcher`
del proxy.** Depende de `searchParams`, así que es dinámica: no pasa por
`src/lib/cache.ts` (misma regla que F-015) y `src/proxy.ts` sigue sin tocar
`/[slug]` (`AGENTS.md` § Cosas que muerden).

**R16 — un fallo de la base es un fallo**, no un resultado vacío (E17).

**R17 — la categoría de la capa 3 es una cascada de dos escalones, en este
orden: la `GlobalCategory` del canónico, y si el canónico no tiene ninguna, la
`LocalCategory` de la oferta.** Nunca las dos a la vez para el mismo producto, y
nunca ninguna otra cosa. Es la respuesta del humano a SP3 y lo que hace que la
capa 3 funcione en producción desde el primer día: hoy `GlobalCategory` está
vacía (I5) y `LocalCategory` llega del POS con cada producto
(`prisma/schema.prisma:378`). Comprobable por separado: E2 con categoría global
sembrada, E2b con solo la local.

## Casos límite y errores

| Caso                                                | Qué tiene que pasar                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `q` ausente, vacía, solo espacios o solo puntuación | Página 200 con la caja y su ayuda. Sin consulta y sin fila de registro (E10)                             |
| `q` de un solo carácter alfanumérico                | Es una consulta: se ejecuta y se registra                                                                |
| `q` de miles de caracteres                          | Truncada al máximo, 200 (E11)                                                                            |
| `q` con `&`, `\|`, `!`, `:*`, comillas sueltas      | Sin error: `plainto_tsquery` (E12, R8)                                                                   |
| Producto sin descripción y sin alias                | Su documento es solo el `localName`; sigue encontrándose por él                                          |
| Tienda sin ningún producto                          | Cero resultados, fila registrada con 0                                                                   |
| Tienda sin productos categorizados                  | Ni global ni local: la tercera capa queda vacía y **no altera** el orden de las dos primeras (R17)       |
| Canónico sin categoría global, oferta con local     | La capa 3 usa la local (E2b, R17) — el caso normal en producción                                         |
| Producto recién creado por el sync                  | Encontrable en cuanto su fila existe: el documento se escribe en el mismo camino que la crea (R3)        |
| Dos productos con el mismo nombre en la tienda      | Ambos aparecen; el desempate es el orden total de R10, nunca aleatorio                                   |
| Entrega repetida de un evento del sync              | El recálculo del documento es idempotente: repetirlo no cambia la fila (`AGENTS.md` § Cosas que muerden) |
| Escritura rancia del sync                           | Si el handler descarta el evento por `sourceUpdatedAt`, **tampoco** recalcula el documento               |
| Búsqueda mientras el panel edita esa descripción    | Lecturas no bloqueantes; el resultado es el de antes o el de después, nunca un documento a medias        |
| `offset` fuera de rango o no numérico               | Se acota a un entero ≥ 0; nunca llega crudo al SQL                                                       |
| Slug retirado o inexistente                         | 404, por el resolvedor de siempre                                                                        |
| Slug en modo selector                               | 404 (E13)                                                                                                |
| Tienda `SUSPENDED`                                  | Aviso de cerrada, sin consulta de catálogo (E14)                                                         |
| Base caída al registrar                             | Se responde igual (E16)                                                                                  |
| Base caída al buscar                                | Falla visible (E17)                                                                                      |

## Datos y contrato

**El contrato con cuadrecaja no cambia.** No entra ni sale ningún campo nuevo
por `/api/internal/*` y `docs/sync-contract.md` no sube de versión: el documento
de búsqueda se construye con datos que ya están en la base.

Lo que sí cambia es **quién dispara el recálculo**, y aquí la propuesta se
quedaba corta (I3): son **dos** caminos, no uno.

- **El panel** posee `description` (`docs/adr/0007-price-override.md` § Alcance)
  y su escritura ya está aislada en `updateProduct`
  (`src/features/admin/server/mutations.ts:203`).
- **El sync** posee `localName` (`prisma/schema.prisma:374`) y también los
  `ProductAlias`, que ya recalculan el `searchDocument` del canónico
  (`docs/sync-contract.md:400`).

Deltas de datos que el feature necesita:

| Dónde             | Qué                                                                                          | Por qué                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `StoreProduct`    | un documento de búsqueda (texto, por defecto vacío) y su vector `tsvector`                   | Hoy no existen (I1). El vector es `Unsupported`: Prisma no lo ve, se escribe con SQL crudo (ADR 0019) |
| `StoreProduct`    | índice GIN sobre el vector, e índice trigram para la capa difusa                             | Sin ellos, el criterio 8 no se cumple                                                                 |
| Modelo nuevo      | registro de consultas: `storeId`, término, número de resultados, instante                    | R4, R5. Criterio 7                                                                                    |
| `prisma/seed.ts`  | unas pocas filas de `GlobalCategory` y el `globalCategoryId` de los canónicos que ya siembra | SP3: sin ellas la capa 3 no tiene datos en desarrollo y el criterio 2 no se puede marcar              |
| Fixture de prueba | volumen suficiente de `StoreProduct` para que el planificador prefiera el índice             | SP4: con las filas del seed, `EXPLAIN` elige `Seq Scan` aunque los índices sean correctos             |

Sobre la taxonomía sembrada (SP3): la siembra tiene que seguir siendo
**idempotente** —dos ejecuciones seguidas dan el mismo conteo, criterio 6 de
F-002— y **no puede cambiar el número de canónicos ni de `StoreProduct`**, que
es lo que F-024 verificó (C4/C9 de `.agent/specs/F-024/spec.md`). Añadir filas
de `GlobalCategory` y rellenar un `globalCategoryId` que hoy es nulo no toca
ninguno de esos dos números.

Sobre el registro de consultas: el término se guarda **normalizado** (R9), no
como llegó; el número de resultados es el total de la consulta, no el de la
página. Sin IP, sin identificador de persona, sin política de retención en este
ciclo (decisión del humano).

Tamaños y unidades: el término se acota a un máximo (hoy
`MARKETPLACE_SEARCH_TERM_MAX_LENGTH` = 120 en `src/constants/marketplace.ts`;
ver I7 sobre el nombre) y el tope de resultados por página es una constante, no
un número suelto (`AGENTS.md` § Prohibiciones).

Los dos índices GIN escritos a mano hoy —los de `CanonicalProduct`— no están en
`prisma/schema.prisma` y `prisma migrate dev` propone borrarlos en cualquier
migración (I8): la ficha
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md` dice qué
hacer, y esta vez sí hay que hacerlo, porque F-021 sí cambia el schema.

## Criterios de aceptación propuestos

Los nueve `[ya]` son literales de `.agent/features.json` (regla 3: no se tocan).
Debajo de cada uno, cómo se verifica **ejecutando algo**.

1. `[ya]` «Buscar el nombre exacto de un producto de la tienda lo devuelve en la
   posicion 1.» → prueba contra Postgres real (`*.db.test.ts`, ADR 0019 (c)):
   sembrar la tienda, llamar a la lectura con el nombre completo, afirmar
   `items[0].id === productoSembrado.id`.
2. `[ya]` «Esa misma busqueda devuelve ademas al menos un producto de la misma
   categoria global.» → misma prueba, sobre la taxonomía mínima que este feature
   siembra (SP3 resuelta): afirmar que existe otro resultado cuyo canónico
   comparte `globalCategoryId` con el de la posición 1 y que **no** casaba por
   texto. La mitad de la cascada que usa `LocalCategory` (R17, E2b) se verifica
   en su propia prueba, con el `globalCategoryId` a nulo.
3. `[ya]` «'refresco' y 'refresco' con acento dan el mismo conjunto de
   resultados.» → dos llamadas, `expect(a).toEqual(b)` sobre la lista completa
   de identificadores en orden.
4. `[ya]` «Una consulta con un caracter cambiado, como 'cocacola', devuelve el
   producto igual.» → una llamada, afirmar que el identificador está en la
   lista.
5. `[ya]` «Buscar desde la tienda A nunca devuelve un producto de la tienda B.»
   → sembrar dos tiendas con el mismo producto, buscar en A, afirmar que ningún
   identificador devuelto pertenece a B.
6. `[ya]` «Tras editar la descripcion de un producto en el panel, buscar por una
   palabra nueva de esa descripcion lo encuentra.» → buscar la palabra (0
   resultados), llamar a `updateProduct`, buscar otra vez (1 resultado), sin
   nada entre medias.
7. `[ya]` «Una consulta sin resultados deja una fila registrada con 0
   resultados.» → contar filas del registro antes y después de una búsqueda sin
   coincidencias: +1, con `resultCount = 0` y el `storeId` correcto.
8. `[ya]` «EXPLAIN de la consulta usa los indices y no hace seq scan del
   catalogo.» → `EXPLAIN (FORMAT JSON)` de la sentencia exacta que ejecuta el
   código, afirmando que el plan **no** contiene ningún nodo `Seq Scan` sobre
   `StoreProduct` y que sí aparecen los índices nuevos. **Sobre un fixture con
   volumen suficiente** para que el planificador prefiera el índice (SP4
   resuelta), en el espacio de nombres propio de la ejecución (ADR 0019 (d)), y
   con ese volumen anotado en la prueba: nunca `enable_seqscan = off`, que solo
   demostraría que el índice se **puede** usar.
9. `[ya]` «'bash .agent/verify.sh F-021 --full' termina con codigo 0.» → ese
   comando, y su código de salida.

Propuestos al humano:

10. `[nuevo]` Tras un `PRODUCT`/`UPDATE` del sync que cambia el `localName`,
    buscar por una palabra del nombre nuevo devuelve el producto (E9). El
    criterio 6 solo cubre la mitad del panel; esta es la mitad que la propuesta
    no vio (I3), y es la que se rompe en silencio.
11. `[nuevo]` `GET /[slug]/buscar?q=…` responde 200 y los nombres de los
    resultados aparecen en el HTML, no solo tras hidratar (mismo estilo que el
    tercer criterio de F-004), y `node scripts/check-bundle-budget.mjs` sigue en
    0 (R14).
12. `[nuevo]` Una consulta con `&|!:*` y comillas sin cerrar responde sin error
    (E12): sin este criterio, R8 no tiene quién la vigile.

## Incongruencias detectadas

**I1 — `StoreProduct` no tiene nada de búsqueda.** Confirmado leyendo el schema,
no la nota: `prisma/schema.prisma:365-407` no declara `searchDocument` ni
`searchVector`, y sus índices son `[storeId, deletedAt, visible]`,
`[canonicalProductId]` y `[localCategoryId]`
(`prisma/schema.prisma:404`). En SQL, los únicos índices de búsqueda del repo
están sobre `CanonicalProduct`
(`prisma/migrations/20260825000000_init/migration.sql:513` GIN sobre el vector y
:517 trigram sobre `name`); los de `StoreProduct` son :373, :376, :379 y el
parcial de catálogo :521. **La nota de `features.json` es correcta.**

**I2 — `CanonicalProduct.searchDocument` es «nombre + alias».**
`prisma/schema.prisma:310` y `docs/sync-contract.md:400`. Deja fuera
`StoreProduct.description` y `StoreProduct.localName`, que es justo el texto que
el comerciante escribe para que le encuentren. Confirmada.

**I3 — NUEVA. «Recalcular el documento es efecto del panel, no del sync» es
falso a medias.** La propuesta (§ Datos y contrato) y la nota de `features.json`
lo dan por cerrado apoyándose en ADR 0007, pero ADR 0007 § Alcance solo pone del
lado del panel `description`, `imageUrls`, `visible`, `featured` y el override de
precio. `localName` lo posee el **sync** (`prisma/schema.prisma:374`, bloque
«owned by the sync; never edited here»). Como `localName` es la fuente principal
del documento, **el sync también tiene que recalcularlo**, y con las dos
propiedades que exige `AGENTS.md` § Cosas que muerden: idempotente y guardado
contra escrituras rancias. De aquí salen E9, R3 y el criterio 10 `[nuevo]`.

**I4 — NUEVA. La guarda G2 de F-015 prohíbe un segundo escritor de
`to_tsvector`.** `src/features/marketplace/server/boundaries.test.ts:108-113`
afirma `expect(matches).toEqual([WRITER_FILE])`: **exactamente un** archivo bajo
`src/` puede componer `to_tsvector(`, y tiene que ser
`src/features/marketplace/server/searchVector.ts`. Un módulo nuevo que escriba el
vector de `StoreProduct` pone esa prueba en rojo y con ella el criterio 9. No es
un obstáculo, es una restricción de arquitectura: o se reutiliza ese módulo, o se
mueve la pareja de expresiones a un sitio compartido y se actualiza la guarda
(que es una prueba, no un `acceptance_criteria`: se puede editar). Lo decide
`sdd-architect`.

**I5 — NUEVA. `GlobalCategory` está vacía y nadie la escribe. RESUELTA por SP3.**
Buscando `globalCategory` en todo el repo solo aparecen la DDL y las claves
foráneas de `prisma/migrations/20260825000000_init/migration.sql`: ni el seed, ni
los handlers del sync, ni el panel escriben nunca
`CanonicalProduct.globalCategoryId` ni `LocalCategory.globalCategoryId`. Es
decir: **la tercera capa no tenía ninguna fila de donde salir**, y el criterio 2
no era verificable. La precondición que la propuesta escribió —«productos con
categoría global asignada»— no la cumple nadie. El humano la cerró el 2026-08-28
(SP3): taxonomía mínima sembrada para desarrollo, y cascada a `LocalCategory` en
producción (R17, E2b). La incongruencia con la propuesta queda escrita porque su
precondición sigue siendo falsa fuera del seed.

**I6 — NUEVA. La propuesta nombra `websearch_to_tsquery`; el repo usa
`plainto_tsquery`.** El caso límite «caracteres que rompen
`websearch_to_tsquery`» apunta a una función que este repo no usa: F-015 eligió
`plainto_tsquery` precisamente porque **no lanza nunca** con texto de una persona
(`src/features/marketplace/server/searchVector.ts:32` y su comentario).
Resuelta aquí sin preguntar: F-021 usa `plainto_tsquery` (R8); el caso límite
sigue existiendo (E12) pero ya no tiene error que manejar.

**I7 — NUEVA. Las piezas compartidas están bautizadas «marketplace».** El
diccionario `MARKETPLACE_SEARCH_TS_CONFIG`, los topes de término y de página
(`src/constants/marketplace.ts`) y los ayudantes puros de `src/lib/searchTerm.ts`
—que importa esas constantes— son exactamente lo que F-021 necesita reutilizar
para que las dos búsquedas normalicen igual. Reutilizarlos tal cual hace que una
feature de tienda dependa del vocabulario del marketplace; duplicarlos hace que
«cafe» encuentre «Café» en un buscador y no en el otro. Es la misma decisión de
I4 y la toma `sdd-architect`.

**I8 — NUEVA. Esta vez sí hay que esquivar el borrado de los índices GIN.**
F-015 pudo no ejecutar `prisma migrate dev` porque no tocó el schema
(`docs/adr/0019-…` § Consecuencias). F-021 añade columnas y un modelo, así que lo
ejecutará, y el comando propone `DROP INDEX` de
`CanonicalProduct_searchVector_idx` y `CanonicalProduct_name_trgm_idx` en
cualquier diff. La ficha
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md` ya tiene
el arreglo; los índices nuevos de `StoreProduct` heredan el mismo problema.

**I9 — F-015 no es esto.** `.agent/specs/F-015/spec.md:41` ya dejó fuera de su
alcance, con nombre y apellidos, «expansión por `GlobalCategory`, `storeId`
obligatorio», y su nota en `features.json` termina diciendo «La busqueda DENTRO
de una tienda sigue siendo F-021, no esto». Confirmada: son dos features y no se
mezclan.

## Huecos y preguntas al humano

**SP1 — ¿búsqueda vectorial con embeddings? RESUELTA (2026-08-28, el humano).**
Respuesta literal: **«No, sin embeddings (Recomendado)»**. Las tres capas son
léxica ponderada (`tsvector` español + `unaccent`), difusa (`pg_trgm`) y
expansión por `GlobalCategory`. Se reabre más adelante **solo** si el registro de
consultas muestra fallos semánticos, **con datos**. No se vuelve a preguntar.

**SP2 — ¿página propia o filtro sobre el catálogo actual? RESUELTA (2026-08-28,
el humano).** Respuesta literal: **«Página propia server-rendered
(Recomendado)»**, y no debe añadir JavaScript de cliente al catálogo existente
(F-013 y la prohibición de `"use client"` en el catálogo). Consecuencia: el
feature tiene interfaz, así que tras este ciclo hacen falta `sdd-architect` y
`sdd-designer`.

**SP2b — ¿qué guarda el registro de consultas? RESUELTA (2026-08-28, el
humano).** Respuesta literal: **«Solo consulta + storeId + count
(Recomendado)»** — sin IP y sin política de retención por ahora (R5).

**SP3 — La tercera capa no tiene datos: `GlobalCategory` está vacía y nadie la
llena. RESUELTA (2026-08-28, el humano).**
Respuesta literal: **«Sembrar taxonomía mínima + caer a LocalCategory
(Recomendado)»** — la opción (a). F-021 siembra una taxonomía mínima en
`prisma/seed.ts`, asigna `globalCategoryId` a los canónicos del seed, y la
consulta **cae a `LocalCategory`** cuando no hay categoría global asignada, que
es lo único que llega del POS hoy en producción. Queda escrito en R17, E2, E2b,
§ Alcance punto 4 y § Datos y contrato. No se vuelve a preguntar.
_Qué faltaba:_ decidir de dónde sale la categoría con la que se expande la
búsqueda, y con qué datos se verifica el criterio 2.
_Por qué bloqueaba:_ es una de las tres capas del feature y un
`acceptance_criteria` entero. Cambia el seed y la consulta, así que bloqueaba a
`sdd-architect`, no solo al veredicto.
_Opciones que se le ofrecieron:_
(a) **F-021 siembra una taxonomía mínima** en `prisma/seed.ts` y asigna
`globalCategoryId` a los canónicos que ya siembra, y la consulta usa
`GlobalCategory` cuando el canónico tiene una y **cae a `LocalCategory`** cuando
no —que es lo que va a pasar en producción, porque `LocalCategory` sí llega del
POS con cada producto—. El criterio 2 se verifica sobre el seed; en producción la
capa 3 funciona igual desde el primer día vía `LocalCategory`.
(b) **La capa 3 se apoya solo en `LocalCategory`** y `GlobalCategory` se ignora
hasta que exista un feature de taxonomía. Más simple y verdadero hoy, pero el
criterio 2 dice «categoria global» y nadie podría marcarlo con verdad (regla 1).
(c) **F-021 espera** a un feature nuevo de taxonomía, que abre el humano (regla
4: el backlog es suyo).
_Recomendación:_ **(a)**. Da la capa 3 real en producción desde el día uno, hace
verificable el criterio 2 sin inventarse un pipeline de clasificación, y deja el
sitio limpio para (c) cuando la taxonomía de verdad exista. (b) deja un criterio
imposible de marcar; (c) congela el feature por algo que no depende de él.

**SP4 — ¿Con qué volumen se comprueba el `EXPLAIN` del criterio 8? RESUELTA
(2026-08-28, el humano).**
Respuesta literal: **«Fixture con volumen suficiente (Recomendado)»** — la opción
(a). Un test de integración inserta filas suficientes para que el planificador
prefiera el índice, y ahí se corre el `EXPLAIN`. Queda escrito en el criterio 8 y
en § Datos y contrato. `enable_seqscan = off` queda descartado.
_Qué faltaba:_ sobre qué datos corre el `EXPLAIN`. Con las decenas de filas del
seed, Postgres elige `Seq Scan` **aunque los índices existan y sean correctos**,
porque leer la tabla entera es más barato: el criterio saldría rojo con un
índice perfecto, o verde por accidente.
_Por qué bloqueaba:_ solo al veredicto (`sdd-tester`). Arquitectura y diseño
podían avanzar igual.
_Opciones que se le ofrecieron:_
(a) La prueba de base real genera un volumen suficiente de `StoreProduct` en su
propio espacio de nombres (ADR 0019 (d): el token dentro del término) y afirma
sobre ese plan. Fiel, y paga segundos en cada ejecución de la suite.
(b) `SET LOCAL enable_seqscan = off` antes del `EXPLAIN`: instantáneo, pero solo
demuestra que el índice **se puede** usar, no que el planificador lo prefiera.
(c) Correr el `EXPLAIN` a mano contra la base de desarrollo sembrada y anotar la
salida en `.agent/specs/F-021/tests.md` (por crear), sin prueba automática.
_Recomendación:_ **(a)** con el volumen más pequeño que cambie el plan, medido y
anotado. (b) como red de seguridad si (a) se vuelve intolerable, dicho en el
documento y no en silencio; (c) no: una comprobación manual se pudre.

**No queda ninguna pregunta abierta.** SP1, SP2, SP2b, SP3 y SP4 están
respondidas por el humano; todo lo demás que aparecía dudoso está decidido en las
reglas o en § No decidido a propósito. Lo que sigue pendiente **no es una
pregunta al humano sino una decisión de `sdd-architect`**: I4 (quién compone
`to_tsvector`, dado que la guarda G2 admite un solo archivo) e I7 (si se
reutilizan o se rebautizan el diccionario y los topes de
`src/constants/marketplace.ts`).

## No decidido a propósito

- **Los pesos exactos de cada capa** y la ponderación dentro de la léxica
  (nombre por encima de descripción). Se afinan con el registro de consultas,
  no antes. Los cierra el humano con datos.
- **Cómo se mantiene el índice al día**: un vector propio de `StoreProduct` con
  recálculo en abanico cuando cambian los alias o el nombre canónico, o un
  vector propio solo para lo que vive en la fila (`localName` +
  `description`) apoyado en el vector del canónico que ya existe para el resto.
  Las dos cumplen R2 y R3. Lo decide `sdd-architect` (ver I4 e I7).
- **Los nombres del modelo de registro y de sus columnas**, y si vive en un
  feature propio o dentro del de la tienda. `sdd-architect`.
- **Qué taxonomía mínima se siembra** —cuántas categorías globales, cómo se
  llaman y qué canónico del seed cae en cada una— y si la cascada de R17 se
  resuelve en SQL o al construir la consulta. SP3 fijó el **qué**; el **cómo** lo
  decide `sdd-architect`, y el volumen exacto del fixture de SP4 también.
- **Quién compone `to_tsvector` y con qué constantes** (I4 e I7): reutilizar
  `src/features/marketplace/server/searchVector.ts` y `src/constants/marketplace.ts`,
  o mover la pareja de expresiones y el diccionario a un sitio compartido
  actualizando la guarda G2. `sdd-architect`. No es pregunta al humano.
- **El texto y la disposición de la caja de búsqueda, del vacío y del pie de
  resultados.** `sdd-designer`.
- **Retención y anonimizado del registro de consultas.** Fuera de este ciclo por
  decisión del humano; lo reabrirá él cuando el registro crezca.
- **Si el selector de marca acaba teniendo su propio buscador** (buscar en todas
  las sucursales a la vez). Hoy es 404 (E13); si se pide, es un feature nuevo y
  lo abre el humano (regla 4).
