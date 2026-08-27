---
slug: prisma-p2037-too-many-connections-build-static-params
sintoma: "npm run build falla exportando una página de producto con PrismaClientKnownRequestError P2037 — Too many database connections opened: sorry, too many clients already"
firma: Too many database connections opened
etapa: build
visto_en: F-017
creado: 2026-08-27T03:12:26Z
promovido_a_agents: no
arreglo: en generateStaticParams, resuelve y consulta el catálogo UNA vez por sucursal (no por slug), y limita el pool de pg con `max` en src/lib/prisma.ts
---

## Qué pasa de verdad

`generateStaticParams` de una página dinámica corre en varios workers de
Next en paralelo durante `npm run build`, y cada worker abre su propio pool
de conexiones de Prisma. Si el código itera sobre una lista de **slugs**
(canónico y su alias vivo, F-017 § El slug canónico) y por cada slug vuelve
a resolver la sucursal (`resolvePublicSlug`) y a pedir su catálogo
(`getStoreCatalog`), una sola sucursal con alias dispara el doble de
consultas de las que hace falta — y con el número de páginas de producto de
un catálogo real, el build agota el `max_connections` de Postgres antes de
terminar. El mensaje de Prisma (`P2037`) apunta a la query que estaba en
vuelo cuando se acabaron las conexiones, no a la causa real (el fan-out
duplicado).

## Cómo se arregla

`src/features/catalog/server/queries.ts::getPublishedBranchesForParams()`
agrupa por **sucursal**, no por slug: devuelve `{ storeId, canonicalSlug,
slugs: PublicSlug[] }[]`, con `slugs` conteniendo el canónico y su alias (si
lo tiene). `generateStaticParams` (`src/app/[slug]/p/[productSlug]/page.tsx`)
pide el catálogo **una vez por sucursal** con ese objeto y luego expande
`branch.slugs.flatMap(slug => catalog.map(...))` en memoria, sin volver a
tocar la base por cada variante de slug.

**Segunda mitad, y la que de verdad lo hizo estable**: reducir el fan-out a
uno por sucursal ayuda pero no basta — cada página pre-renderizada sigue
haciendo sus propias consultas (`generateMetadata` + el componente),
multiplicadas por cuantos workers de build corran en paralelo, cada uno con
SU PROPIO `pg.Pool` sin límite (el valor por defecto de `node-postgres` es
10). `src/lib/prisma.ts` pasa ahora `max: 5` al `PrismaPg({ connectionString,
max: 5 })` — un techo explícito, más bajo que el implícito, que hizo el
build estable en 3 corridas seguidas donde antes fallaba de forma
intermitente (dependía de cuántos workers coincidieran generando páginas a
la vez).

## Cuándo NO es esto

Si el mensaje señala una query fuera de `generateStaticParams` (por ejemplo
un `getServerSideProps`/ruta dinámica en producción con tráfico real), es un
problema real de tamaño de pool contra carga, no este bug de fan-out del
build — revisa `DATABASE_URL` y el tamaño del pool del adaptador antes de
aplicar este arreglo.

## Cómo se evita

Cuando una función de listado (`getPublishedStoreSlugs`, `getCanonicalStoreSlugs`,
`getPublishedBranchesForParams`) puede devolver más de una URL por el mismo
recurso (un alias vivo, HS4), que quien pre-renderiza pida los datos por
recurso y expanda las URLs en memoria — nunca al revés.
