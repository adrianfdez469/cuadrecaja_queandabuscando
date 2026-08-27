# 0011 — Coordenadas como columnas planas, sin PostGIS todavía

**Aceptada** · 2026-08-25

## Contexto

El plan adoptaba PostGIS para la búsqueda por cercanía del marketplace, con
`Store.location` como `geography(Point, 4326)`.

## Problema

`CREATE EXTENSION postgis` falla en un Postgres que no lo trae compilado. El
Postgres de desarrollo de esta máquina (14.0) tiene `unaccent` y `pg_trgm` pero
no PostGIS. Supabase sí lo ofrece, pero exigirlo significa que **cada base de
desarrollo** necesita una imagen con PostGIS: fricción en cada sesión de trabajo,
a cambio de una feature que todavía no existe.

Además, una columna `Unsupported()` en Prisma no se puede escribir por la API
normal: el handler del sync necesitaba un `$executeRaw` extra con
`ST_SetSRID(ST_MakePoint(...))` solo para guardar dos números.

## Decisión

`latitude` y `longitude` como `Decimal(9, 6)`. Los datos se capturan desde ahora.
La columna `geography`, su índice GiST y la extensión llegan en la migración que
**implemente** la búsqueda por cercanía, poblándose desde las columnas que ya
estarán llenas.

## Por qué es seguro posponerlo

Migrar después es una migración de una línea sobre datos ya presentes. El
acuerdo era anticipar el marketplace **solo en el modelo de datos**, y dos
columnas numéricas lo hacen igual de bien que una geometría para ese fin.

## Reabrir cuando

Cualquier consulta de tipo «tiendas a menos de N km».

## Nota de F-015 · 27 de agosto de 2026

El disparador original de esta ADR decía «se implemente F-015 o cualquier
consulta de tipo tiendas a menos de N km». **F-015 se implementó, y esta ADR no
se reabrió.** El humano lo decidió expresamente al abrir el feature: ninguno de
los cuatro `acceptance_criteria` de F-015 menciona distancia, así que la búsqueda
del marketplace se construyó sobre `tsvector` y el índice GIN, sin PostGIS, sin
`geography` y sin GiST.

Que un feature dispare una ADR no es lo mismo que que la necesite. Lo que
mantiene viva la decisión es la **segunda** mitad de la frase, que es la que
queda arriba: la primera consulta que ordene por distancia. `latitude` y
`longitude` siguen llenándose desde el sync mientras tanto, que es justo lo que
esta ADR quería asegurar.
