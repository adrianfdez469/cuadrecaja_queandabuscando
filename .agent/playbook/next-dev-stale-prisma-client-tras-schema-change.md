---
slug: next-dev-stale-prisma-client-tras-schema-change
sintoma: "una etapa smoke/visual falla con un PrismaClientValidationError tipo `Unknown argument \`<columna>\`. Available options are marked with ?` sobre una columna que SÍ está en prisma/schema.prisma y SÍ existe en la base — el resto de la suite (test, prisma) pasa en verde"
firma: Unknown argument `[a-zA-Z]+`\. Available options are marked with \?
etapa: smoke | visual
visto_en: F-036
creado: 2026-09-07T13:17:20Z
promovido_a_agents: no
arreglo: mata el next-server de ESTE worktree (confirma antes con `lsof -a -p <pid> -d cwd -Fn` que el cwd es tu propio directorio, no otro checkout) y deja que la etapa levante uno nuevo — el nuevo hereda el `src/generated/prisma` que ya está regenerado en disco
---

## Qué pasa de verdad

`bash .agent/verify.sh <ID> --smoke`/`--visual` reutiliza el `next dev` que
ya esté corriendo en el directorio del worktree en vez de lanzar uno nuevo
(`servidor_propio()`, ficha `next-dev-uno-por-directorio.md`) — es lo
correcto la mayoría de las veces. Pero un proceso `next-server` de larga
vida arrancó **antes** de que este ciclo cambiara `prisma/schema.prisma` y
corriera `npx prisma generate`: el módulo `src/generated/prisma` que ese
proceso tiene cargado en memoria es el de ANTES del cambio, y Next 16 no
recarga en caliente el cliente de Prisma generado — a diferencia de una ruta
o un componente, que sí. El resultado es un `PrismaClientValidationError`
que nombra la columna nueva como "Unknown argument", **aunque la migración
ya esté aplicada, el schema ya la declare y el resto de la suite (que corre
en procesos nuevos: `vitest`, `tsc`) ya la vea bien**. Es indistinguible a
simple vista de un bug real del handler, porque el mensaje de Prisma es
literalmente el mismo que si la columna no existiera.

En F-036: el `next-server` de este worktree llevaba corriendo desde el
5 de septiembre (`ps -o lstart`), dos días antes de que
`sdd-implementer` regenerara el cliente el 7 de septiembre a las 09:39
(`stat src/generated/prisma`). `handleExchangeRate`'s
`prisma.exchangeRate.create({ data: { ..., sourceUpdatedAt } })` reventaba
en cada evento de `EXCHANGE_RATE`, y el smoke lo reportaba como que el
evento rancio caía en `failed` en vez de `processed` — un falso rojo del
criterio 2, no un bug del handler.

## Cómo se arregla

1. Confirma que el proceso que ocupa el puerto es de ESTE worktree, no de
   otro checkout (la distinción que `next-dev-uno-por-directorio.md` ya
   explica es la que importa aquí):
   ```
   PID="$(lsof -i TCP:<puerto> -sTCP:LISTEN -t)"
   ps -o pid,lstart,command -p "$PID"
   lsof -a -p "$PID" -d cwd -Fn
   ```
2. Si el `cwd` es tu propio directorio Y su `lstart` es anterior a la
   última vez que cambió `prisma/schema.prisma` o corrió
   `npx prisma generate` (compara con `stat -f '%Sm' src/generated/prisma`
   en macOS), es esto: `kill <PID>` y vuelve a correr
   `bash .agent/verify.sh <ID> --smoke` — la etapa lanza uno nuevo, que
   carga el cliente ya regenerado.
3. Si el humano está mirando ese servidor en el navegador, avísalo antes de
   matarlo — es la misma cortesía que `next-dev-uno-por-directorio.md` ya
   pide para el caso de reutilizarlo.

## Cuándo NO es esto

Si la columna que el error nombra **no** está en `prisma/schema.prisma`
todavía, o la migración no se aplicó (`information_schema.columns` la
confirma en `0`), no es esto — es un ciclo que corre código por delante de
su propia migración, ficha
`code-ahead-of-shared-db-migration-rompe-db-tests.md`, o un bug real de
quien implementó. Y si el `lstart` del proceso es POSTERIOR al último
`npx prisma generate`, tampoco es esto: busca el error donde de verdad
está.

## Cómo se evita

No hay arreglo estructural sin que Next reinicie el proceso de servidor en
cada cambio de `prisma/schema.prisma` — cambiaría el flujo normal de
`next dev`. Lo que sí ayuda: después de correr `npx prisma generate` en
mitad de una sesión larga, matar cualquier `next-server` de este worktree
que ya estuviera corriendo, aunque `verify.sh` no se haya quejado todavía —
la próxima etapa `smoke`/`visual` lo va a reutilizar tal cual está, sin
saber que su cliente quedó viejo.
