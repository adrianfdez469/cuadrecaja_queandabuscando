---
slug: prisma-migrate-dev-borra-indices-gin-no-declarados
sintoma: "prisma migrate dev propone DROP INDEX de índices GIN/parciales no declarados (CanonicalProduct_searchVector_idx, CanonicalProduct_name_trgm_idx, StoreProduct_visible_catalog_idx, StoreProduct_searchVector_idx, StoreProduct_searchDocument_trgm_idx) en un diff que no tiene nada que ver con esos índices"
firma: DROP INDEX "(CanonicalProduct_(searchVector|name_trgm)_idx|StoreProduct_(visible_catalog|searchVector|searchDocument_trgm)_idx)"
etapa: review
visto_en: F-010, F-021
creado: 2026-08-26T03:57:58Z
promovido_a_agents: no
arreglo: quita las líneas `DROP INDEX` del migration.sql generado; estos cinco índices no se representan en schema.prisma y no deben tocarse desde una migración de Prisma
---

## Qué pasa de verdad

`CanonicalProduct.searchVector` y (desde F-021) `StoreProduct.searchVector`
son `Unsupported("tsvector")`, y sus índices GIN se crearon a mano en SQL,
fuera de lo que `schema.prisma` puede declarar. `StoreProduct_visible_catalog_idx`
es además un índice **parcial** (`WHERE "deletedAt" IS NULL AND visible = true`),
que Prisma tampoco puede expresar. Prisma no sabe que ninguno de los cinco
existe: cualquier `prisma migrate dev` posterior —para cualquier cambio, ni
siquiera relacionado— diffea la base real contra el modelo declarativo, ve
índices "no declarados" y propone borrarlos. Es reproducible con
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
en cualquier momento, no solo al migrar.

Los cinco, y dónde se crearon a mano:

- `CanonicalProduct_searchVector_idx`, `CanonicalProduct_name_trgm_idx` —
  `prisma/migrations/20260825000000_init/migration.sql` (F-010/F-015).
- `StoreProduct_visible_catalog_idx` — el mismo archivo, índice parcial del
  catálogo.
- `StoreProduct_searchVector_idx`, `StoreProduct_searchDocument_trgm_idx` —
  `prisma/migrations/20260828132737_store_product_search/migration.sql`
  (F-021).

## Cómo se arregla

Antes de aplicar cualquier migración generada por `migrate dev`, revisa el
`migration.sql` recién creado y quita cualquier `DROP INDEX` de estos cinco
nombres (o de cualquier índice sobre una columna `Unsupported`, o cualquier
índice parcial no declarable). Si la migración ya se aplicó con el drop
incluido, recréalos a mano contra la base:

```sql
CREATE INDEX "CanonicalProduct_searchVector_idx" ON "CanonicalProduct" USING GIN ("searchVector");
CREATE INDEX "CanonicalProduct_name_trgm_idx" ON "CanonicalProduct" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "StoreProduct_visible_catalog_idx" ON "StoreProduct" ("storeId", featured DESC, "localName") WHERE "deletedAt" IS NULL AND visible = true;
CREATE INDEX "StoreProduct_searchVector_idx" ON "StoreProduct" USING GIN ("searchVector");
CREATE INDEX "StoreProduct_searchDocument_trgm_idx" ON "StoreProduct" USING GIN ("searchDocument" gin_trgm_ops);
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
o excluir las tablas afectadas del diff automático— no se hizo aquí: no era
alcance de F-010 ni de F-021, y cada uno tocaba su propia parte de la
búsqueda. Mientras tanto, todo `prisma migrate dev` en este repo debe
revisarse a mano antes de confirmar el `y` a la pregunta de "Are you sure", y
la lista de cinco nombres de arriba debe ampliarse de nuevo si un futuro
feature añade otro índice que `schema.prisma` no pueda declarar.
