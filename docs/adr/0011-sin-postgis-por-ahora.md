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

Se implemente F-015 o cualquier consulta de tipo «tiendas a menos de N km».
