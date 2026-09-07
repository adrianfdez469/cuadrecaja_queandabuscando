---
slug: code-ahead-of-shared-db-migration-rompe-db-tests
sintoma: "un *.db.test.ts que EXISTÍA antes de este feature (no uno que este ciclo escribió) falla contra el Postgres compartido del `docker-compose.yml`, con un `PrismaClientKnownRequestError`/`PrismaClientValidationError` cuyo mensaje dice que una columna no existe en la base actual — justo la columna que este ciclo acaba de añadir al schema"
firma: does not exist in the current database
etapa: test
visto_en: F-036
creado: 2026-09-07T12:50:50Z
promovido_a_agents: no
arreglo: no es un bug tuyo — es la migración compartida, todavía sin aplicar a propósito; documenta el fallo y el motivo en impl.md en vez de forzarlo a verde, y deja la aplicación de la migración a la base compartida como decisión explícita del humano (una sola vez, anunciada)
---

## Qué pasa de verdad

Un feature que añade una columna hace dos cosas en el mismo ciclo: cambia
`prisma/schema.prisma` (y genera, sin aplicar a la compartida, la migración) Y
cambia un `handler`/lector para que la use. El proyecto `db` de Vitest
(`vitest.config.mts`) corre contra el Postgres real de
`docker-compose.yml` — la misma base que comparten todos los worktrees
(ficha `docker-compose-container-name-fijo-choca-entre-worktrees.md`) — y esa
base sigue con el esquema VIEJO mientras la aplicación de la migración a la
compartida está deliberadamente diferida (una decisión operativa explícita,
no un olvido: ver `.agent/specs/<F-NNN>/plan.md` § Decisiones del humano). El
código nuevo, ejecutado contra ese esquema viejo, revienta con un error de
Prisma que nombra la columna que falta — y como el handler tocado lo usan
tests de OTRO feature más viejo (aquí, `exchangeRateAllDraft.db.test.ts`, de
F-035), el fallo aparece en un archivo que este ciclo ni siquiera tocó.

## Cómo se arregla

**No se arregla en este ciclo — se documenta.** El código está bien: hace
justo lo que el plan pide. Lo que falta es una migración aplicada a una base
que, por decisión explícita, no se debe tocar desde el ciclo del
implementador (`AGENTS.md` § Comandos prohibidos y la nota del feature sobre
la base compartida). Comprueba primero que es ESTE el motivo y no un bug de
verdad:

```
docker exec queandabuscando-postgres psql -U postgres -d queandabuscando \
  -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name='<Tabla>' AND column_name='<columna>'"
```

Si da `0`, es esto. Anota en `impl.md` el código de salida real de
`verify.sh` (no lo fuerces a 0), qué archivo falló y por qué, y dilo
explícitamente: la base compartida sigue sin migrar y aplicarla es una
decisión del humano, una sola vez y anunciada — no de quien implementa. El
guion ordenado de C5 (o el que toque) valida la migración de verdad en una
base de usar y tirar, no en la compartida.

## Cuándo NO es esto

Si la columna SÍ existe en `information_schema.columns` y el test sigue
fallando, el problema es otro (una migración a medio aplicar, un `migrate
dev` que quedó a mitad, o un bug real del handler) — no dismisses ni
documentes esto como si fuera la trampa conocida.

## Cómo se evita

No se evita del lado del agente: es la consecuencia directa y aceptada de
separar «escribir y validar la migración» (en una base de usar y tirar) de
«aplicarla a la compartida» (decisión del humano, una sola vez). El costo es
que el proyecto `db` de la suite queda rojo para CUALQUIER worktree que use
esa misma base compartida hasta que el humano migre — ruidoso, no
silencioso, que es la propiedad que este mismo patrón ya defiende en R7 de
`spec.md`. Si `visto_en` acumula un segundo feature con la misma forma,
vale la pena escribirlo en `AGENTS.md` § Cosas que muerden junto a la nota ya
existente sobre worktrees hermanos con checkout viejo.
