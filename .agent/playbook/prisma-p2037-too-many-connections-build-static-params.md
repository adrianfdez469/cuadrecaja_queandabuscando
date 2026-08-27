---
slug: prisma-p2037-too-many-connections-build-static-params
sintoma: "npm run build falla exportando una página de producto con PrismaClientKnownRequestError P2037 — Too many database connections opened: sorry, too many clients already"
firma: Too many database connections opened
etapa: build
visto_en: F-017, PR #7
creado: 2026-08-27T03:12:26Z
promovido_a_agents: no
arreglo: cachea el cliente de Prisma en ámbito de MÓDULO en src/lib/prisma.ts — con NODE_ENV=production, devolverlo sin cachear construye un cliente (y un pool) por cada acceso a propiedad; lo demás (una consulta por sucursal en generateStaticParams, `max` en el pool) solo baja la cuenta
---

## Qué pasa de verdad

Esta ficha se escribió dos veces, y la primera versión culpaba a la mitad
equivocada. Lo que hay debajo, en orden: la causa real y las dos
mitigaciones que la disimulaban.

### La causa: un cliente de Prisma por cada acceso a propiedad

`src/lib/prisma.ts` exporta un Proxy que construye el cliente en el primer
acceso a propiedad, para no exigir `DATABASE_URL` en tiempo de import. La
versión que fallaba cacheaba ese cliente **solo** en `globalThis`, y solo
fuera de producción:

```ts
function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const created = createClient();
    if (process.env.NODE_ENV === "production") return created; // ← nunca se cachea
    globalForPrisma.prisma = created;
  }
  return globalForPrisma.prisma;
}
```

Con `NODE_ENV=production` —que es exactamente lo que corre `next build`—
cada `prisma.algo` construía un `PrismaClient` nuevo, con su propio
`pg.Pool`, que abre una conexión en la primera consulta y **no la cierra
nunca**. Una conexión filtrada por consulta. Medido contra la base local
con `pg_stat_activity`, 10 consultas seguidas:

| `NODE_ENV`    | antes           | después |
| ------------- | --------------- | ------- |
| `development` | 1 backend       | 1       |
| `production`  | **13 backends** | 1       |

En una petición que hace media docena de consultas eso es invisible: el
proceso vive, nadie mira el contador. En `next build` es letal, porque los
workers pre-renderizan cientos de páginas y cada una consulta.

El arreglo es cachear en ámbito de módulo, y aparcar en `globalThis`
**además**, no en su lugar (que era lo único que hacía sobrevivir al hot
reload):

```ts
let cached: PrismaClient | undefined;

function client(): PrismaClient {
  cached ??= globalForPrisma.prisma ?? createClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = cached;
  return cached;
}
```

Prueba de que esta es la causa y no una correlación: el mismo `npm run
build`, misma base y misma semilla, 189 páginas con 9 workers — **18
errores `Too many database connections` con el código viejo, 0 con el
cacheado**.

### Las dos mitigaciones, y por qué engañan

Ninguna de las dos es incorrecta; las dos siguen en el código. Lo que hay
que saber es que **bajan la cuenta de consultas, no la fuga por consulta**,
así que mueven el umbral en el que el build empieza a caer sin quitar la
causa. Eso es lo que hizo que el fallo pareciera intermitente y dependiente
del tamaño del catálogo, y lo que llevó a fichar el síntoma como un
problema de fan-out:

1. **Una consulta de catálogo por sucursal, no por slug.**
   `src/features/catalog/server/queries.ts::getPublishedBranchesForParams()`
   agrupa por **sucursal**: devuelve `{ storeId, canonicalSlug, slugs:
PublicSlug[] }[]`, con `slugs` conteniendo el canónico y su alias (si lo
   tiene). `generateStaticParams`
   (`src/app/[slug]/p/[productSlug]/page.tsx`) pide el catálogo una vez por
   sucursal y luego expande `branch.slugs.flatMap(slug =>
catalog.map(...))` en memoria. Antes, iterar sobre **slugs** y volver a
   resolver la sucursal (`resolvePublicSlug`) y su catálogo
   (`getStoreCatalog`) por cada uno duplicaba las consultas de toda
   sucursal con alias.

2. **Un techo explícito al pool.** `PrismaPg({ connectionString, max: 5 })`,
   por debajo del implícito de `node-postgres` (10). Sigue siendo lo
   correcto: cada worker de build tiene su propio pool, y el techo acota lo
   que uno puede retener. Con la fuga presente solo retrasaba el fallo —
   con la fuga cerrada, el build de 189 páginas con 9 workers se queda muy
   por debajo de las 100 conexiones de Postgres.

Y de ahí la trampa de lectura que costó el ciclo entero: el mensaje de
Prisma (`P2037`) señala la query que estaba en vuelo cuando se acabaron las
conexiones —en el PR #7, `prisma.store.findUnique` desde `generateMetadata`—
y no tiene nada que ver con quién las estaba filtrando.

## Cuándo NO es esto

Si el `P2037` aparece **fuera** de un build —una ruta dinámica en producción
con tráfico real— es un problema de tamaño de pool contra carga, no esto:
revisa `DATABASE_URL` y el pooler antes de tocar `src/lib/prisma.ts`.

Y antes de dar por bueno cualquier arreglo, cuenta las conexiones en vez de
deducirlas. Diez consultas seguidas contra la base, con `NODE_ENV` puesto a
mano, bastan:

```ts
await prisma.$queryRaw`select count(*) from pg_stat_activity
  where datname = current_database()`;
```

Si el número sube consulta a consulta, la fuga está en el ciclo de vida del
cliente, no en cuántas veces lo llamas.

## Cómo se evita

- Un cliente por proceso, cacheado en ámbito de módulo. `globalThis` es un
  extra para el hot reload, nunca el único sitio donde vive la instancia — y
  cualquier rama que devuelva un cliente recién construido sin guardarlo es
  una fuga, por muy corto que parezca el camino. `src/lib/prisma.test.ts` lo
  fija: cuenta construcciones, no conexiones, que es lo barato de aserir.
- Cuando una función de listado (`getPublishedStoreSlugs`,
  `getCanonicalStoreSlugs`, `getPublishedBranchesForParams`) puede devolver
  más de una URL por el mismo recurso (un alias vivo, HS4), que quien
  pre-renderiza pida los datos por recurso y expanda las URLs en memoria —
  nunca al revés.
