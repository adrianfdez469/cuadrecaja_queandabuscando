---
slug: prisma-migrate-dev-borra-indices-gin-no-declarados
sintoma: "prisma migrate dev propone DROP INDEX de CanonicalProduct_searchVector_idx / CanonicalProduct_name_trgm_idx en un diff que no tiene nada que ver con esos índices"
firma: DROP INDEX "CanonicalProduct_(searchVector|name_trgm)_idx"
etapa: review
visto_en: F-010
creado: 2026-08-26T03:57:58Z
promovido_a_agents: no
arreglo: quita las líneas `DROP INDEX` del migration.sql generado; esos dos índices no se representan en schema.prisma y no deben tocarse desde una migración de Prisma
---

## Qué pasa de verdad

`CanonicalProduct.searchVector` es `Unsupported("tsvector")` y sus dos índices
GIN (`..._searchVector_idx` con `gin_trgm_ops` en `name`) se crearon a mano en
`prisma/migrations/20260825000000_init/migration.sql`, fuera de lo que
`schema.prisma` puede declarar. Prisma no sabe que existen: cualquier
`prisma migrate dev` posterior —para cualquier cambio, ni siquiera relacionado—
diffea la base real contra el modelo declarativo, ve dos índices "no
declarados" y propone borrarlos. Es reproducible con
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
en cualquier momento, no solo al migrar.

## Cómo se arregla

Antes de aplicar cualquier migración generada por `migrate dev`, revisa el
`migration.sql` recién creado y quita cualquier `DROP INDEX` de esos dos
nombres (o de cualquier índice sobre una columna `Unsupported`). Si la
migración ya se aplicó con el drop incluido, recréalos a mano contra la base:

```sql
CREATE INDEX "CanonicalProduct_searchVector_idx" ON "CanonicalProduct" USING GIN ("searchVector");
CREATE INDEX "CanonicalProduct_name_trgm_idx" ON "CanonicalProduct" USING GIN ("name" gin_trgm_ops);
```

y edita el `migration.sql` para que el archivo en disco quede igual a lo que
de verdad se quiere que la migración haga (solo los cambios propios de tu
feature). `prisma migrate status` no verifica el checksum del contenido contra
lo aplicado, así que editar el archivo después no rompe el estado "aplicada".

## Cuándo NO es esto

Si el `DROP INDEX` es de un índice que sí administra Prisma (uno declarado con
`@@index` o `@unique` en el modelo), el diff es correcto: no lo borres del
migration.sql, es una migración real.

## Cómo se evita

El arreglo de fondo —declarar esos índices de forma que Prisma los reconozca,
o excluir `CanonicalProduct` del diff automático— no se hizo aquí: no era
alcance de F-010 y tocar la búsqueda del catálogo es su propio cambio. Mientras
tanto, todo `prisma migrate dev` en este repo debe revisarse a mano antes de
confirmar el `y` a la pregunta de "Are you sure".
