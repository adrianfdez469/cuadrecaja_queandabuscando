---
slug: prisma-migrate-dev-checksum-drift-bd-compartida
sintoma: "npx prisma migrate dev (con --create-only o sin él) se niega a avanzar con un mensaje sobre una migración que ya fue aplicada y fue modificada después, y ofrece resetear el esquema public — sobre una migración que esta sesión no tocó"
firma: (was modified after it was applied|drift detected|We need to reset)
etapa: prisma
visto_en: F-011
creado: 2026-08-26T22:14:07Z
promovido_a_agents: no
arreglo: no aceptes el reset; genera el DDL con `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, crea la carpeta de la migración a mano y aplícala con `prisma migrate deploy` (no revalida checksums viejos)
---

## Qué pasa de verdad

`prisma migrate dev` reconcilia contra una shadow database y, antes de eso,
compara el checksum de CADA migración ya aplicada contra el archivo
`migration.sql` que tiene en disco — de la migración que sea, no solo de la
que estás creando. En un Postgres de desarrollo **compartido entre varios
worktrees** de este repo, es fácil que otro worktree haya aplicado una
migración cuyo checksum en `_prisma_migrations` no coincide bit a bit con el
`migration.sql` que TU worktree tiene en `prisma/migrations/` para esa misma
carpeta (mismo nombre, mismo contenido humano-legible, pero el checksum
puede divergir por razones que no siempre se alcanzan a explicar — en este
caso, confirmado con `shasum` que el contenido era idéntico entre worktrees,
y el drift seguía apareciendo). `prisma migrate dev` no distingue «esto lo
tocaste tú» de «esto lo aplicó otro proceso hace tiempo»: ve cualquier
checksum que no cuadra y ofrece **resetear el esquema `public` entero**
(`migrate reset`), que es uno de los dos comandos que este repo prohíbe sin
preguntar primero.

## Cómo se arregla

**No aceptes el reset.** En vez de `prisma migrate dev`, que reconcilia
contra la shadow DB y por eso valida checksums viejos:

1. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   — compara el `schema.prisma` de verdad contra la base configurada (no
   contra la shadow DB) y escribe el DDL puro a stdout, sin tocar
   `_prisma_migrations` ni pedir ningún checksum.
2. Crea a mano la carpeta `prisma/migrations/<timestamp>_<nombre>/migration.sql`
   con ese DDL. Revísalo línea por línea antes de aplicar — este es también
   el punto donde se cazan los `DROP INDEX` no declarados de
   `prisma-migrate-dev-borra-indices-gin-no-declarados`.
3. Aplica con `npx prisma migrate deploy` — este comando **no revalida los
   checksums de migraciones previas**, solo aplica las que su carpeta local
   todavía no tiene registradas en `_prisma_migrations` de la base a la que
   apunta. Es el mismo comando que usa CI/producción, así que no es un
   atajo fuera del camino soportado.

Ninguno de los dos comandos prohibidos (`migrate reset`, `db push`) se
ejecuta en este camino.

## Cuándo NO es esto

Si el checksum no cuadra porque **tú** editaste un `migration.sql` ya
aplicado en tu propio worktree (el caso real que esta ficha hermana,
`prisma-migrate-dev-borra-indices-gin-no-declarados`, corrige durante la
creación), el reset que `migrate dev` ofrece sigue siendo la vía incorrecta,
pero el arreglo correcto ahí es deshacer tu edición o crear una migración
nueva que la corrija — no el rodeo de `migrate diff` de esta ficha, que es
para cuando el archivo en disco es idéntico y el drift no es tuyo.

## Cómo se evita

No se evita del lado del agente: es una consecuencia de compartir una sola
base de Postgres de desarrollo entre varios worktrees de este repo, cada uno
con su propia carpeta `prisma/migrations/`. **Riesgo que queda abierto y se
debe escalar al humano, no resolver en silencio**: aplicar una migración con
`migrate deploy` desde un worktree deja la tabla `_prisma_migrations` de esa
base apuntando a una migración que los OTROS worktrees no tienen en su
propia carpeta — la próxima vez que cualquiera de ellos corra `migrate dev`
o `migrate deploy` ahí, puede volver a encontrar drift, esta vez causado de
verdad por este rodeo. La solución de fondo (una base de desarrollo por
worktree, o una convención de quién migra) es una decisión de infraestructura
que no le toca decidir a quien solo estaba implementando un feature.
