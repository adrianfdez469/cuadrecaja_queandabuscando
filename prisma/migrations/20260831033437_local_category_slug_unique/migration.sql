/*
  Warnings:

  - A unique constraint covering the columns `[businessId,slug]` on the table `LocalCategory` will be added. If there are existing duplicate values, this will fail.

  F-026: the five `DROP INDEX` statements Prisma proposed here for
  `CanonicalProduct_searchVector_idx`, `CanonicalProduct_name_trgm_idx`,
  `StoreProduct_visible_catalog_idx`, `StoreProduct_searchVector_idx` and
  `StoreProduct_searchDocument_trgm_idx` were removed by hand. Those five
  indexes are not declarable in `schema.prisma` (two `Unsupported("tsvector")`
  GIN indexes plus one partial index), so `prisma migrate dev` always proposes
  dropping them in any unrelated diff. See
  `.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`.
*/

-- 1. Columna nueva, aditiva y nullable: ni reescribe la tabla ni necesita
--    default. Misma forma que `Store."sourceUpdatedAt"`.
ALTER TABLE "LocalCategory" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);

-- 2. Higiene previa al backfill: un slug vacío no es desambiguable con sufijo
--    ('' || '-2' daría '-2', que no es un slug bien formado). Se le aplica el
--    mismo fallback que ya usa el handler del sync.
UPDATE "LocalCategory" SET "slug" = 'categoria' WHERE "slug" = '';

-- 3. Backfill de desambiguación. En la base de desarrollo NO hay ninguna
--    colisión (verificado hoy: 0 filas con (businessId, slug) repetido y 0
--    slugs vacíos), así que aquí es un no-op — pero en producción puede
--    haberlas, porque hasta hoy nadie garantizaba la unicidad (I3) y
--    `slugify(name) || 'categoria'` colapsa a un mismo valor cualquier par de
--    nombres que difieran solo en acentos, mayúsculas o puntuación.
--    Orden estable por "externalId" (no por "id", que es un uuid aleatorio):
--    la primera fila conserva el slug pelado, las demás reciben -2, -3, …
--    El bucle repite la pasada porque un sufijo puede chocar a su vez con un
--    valor preexistente ('bebidas' x2 conviviendo con un 'bebidas-2'); cada
--    vuelta alarga el sufijo, así que termina.
DO $$
DECLARE
  moved integer;
  guard integer := 0;
BEGIN
  LOOP
    WITH ranked AS (
      SELECT "id",
             "slug",
             row_number() OVER (PARTITION BY "businessId", "slug"
                                ORDER BY "externalId") AS n
        FROM "LocalCategory"
    ), fixed AS (
      UPDATE "LocalCategory" c
         SET "slug" = r."slug" || '-' || r.n
        FROM ranked r
       WHERE c."id" = r."id" AND r.n > 1
      RETURNING 1
    )
    SELECT count(*) INTO moved FROM fixed;
    guard := guard + 1;
    EXIT WHEN moved = 0 OR guard >= 10;
  END LOOP;
  IF moved > 0 THEN
    RAISE EXCEPTION 'LocalCategory slug backfill did not converge in 10 passes';
  END IF;
END $$;

-- 4. Recién ahora, el unique que SP3 exige. Si el paso 3 no hubiera corrido,
--    esta línea sería la que hace fallar la migración en producción.
CREATE UNIQUE INDEX "LocalCategory_businessId_slug_key"
  ON "LocalCategory"("businessId", "slug");
