# 0010 — Prisma 7 con driver adapter

**Aceptada** · 2026-08-25

## Contexto

El plan asumía Prisma 6, como cuadrecaja. Se instaló **7.9.1**, que cambia cosas
sustanciales.

## Lo que cambia

- **El driver adapter es obligatorio.** `datasourceUrl` ya no existe; hay que
  pasar `adapter: new PrismaPg({ connectionString })`. Requiere el paquete
  `@prisma/adapter-pg`.
- **`directUrl` desapareció del datasource.** La URL de migraciones vive ahora en
  `prisma.config.ts`, en `datasource.url`. Aquí apunta a `DIRECT_URL` (puerto
  5432, DDL no puede pasar por el pooler) mientras el runtime usa `DATABASE_URL`
  (pooler, 6543). Es más claro que el `directUrl` de Prisma 6.
- **El generador por defecto es `prisma-client`**, que emite TypeScript en una
  ruta que hay que declarar, en lugar de escribir en `node_modules`. Sale a
  `src/generated/prisma` y está en `.gitignore`, excluido de ESLint y Prettier.
- **`prisma migrate diff --to-schema-datamodel` se renombró** a `--to-schema`.

## Decisión adicional: el cliente se construye perezosamente

`next build` importa todos los módulos de ruta para recolectar metadatos. Si
construir el cliente lanzara al importar, un build sin `DATABASE_URL` fallaría
sin necesidad. `src/lib/prisma.ts` exporta un `Proxy` que construye el cliente en
el primer acceso a una propiedad.

En la misma línea, `getPublishedStoreSlugs()` devuelve una lista vacía si la base
no responde: el pre-render es una optimización de arranque en caliente, no un
requisito, y lo no pre-renderizado se genera en la primera petición.

## Consecuencia

`prisma` es `devDependency` (es la CLI) y `@prisma/client` es dependencia normal.
`postinstall` corre solo `prisma generate`, **no** `migrate deploy`: cuadrecaja
lo hace y con eso acopla cada build a una base alcanzable.
