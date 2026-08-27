---
slug: boundaries-guard-cruzado-por-patron-de-texto
sintoma: expected [ Array(1) ] to deeply equal []
firma: expected \[ Array\(1\) \] to deeply equal \[\]
etapa: test
visto_en: F-015
creado: 2026-08-27T18:24:27Z
promovido_a_agents: no
arreglo: cambia la FORMA del texto (misma intención), no el guardián ajeno — ver § Cómo se arregla
---

## Qué pasa de verdad

Los `boundaries.test.ts` de este repo (admin, storefront, marketplace) leen
código fuente crudo con regex de texto — no analizan significado — para
vigilar la invariante de SU propio feature (p. ej. «solo `resolve.ts` puede
resolver un `Store` por `slug`»). Esos regex no saben de dónde viene el
archivo que están mirando: si un archivo de OTRO feature escribe una línea
que coincide por casualidad con el patrón vigilado, el guardián se dispara
igual, aunque la intención del código nuevo no tenga nada que ver con lo que
esa guarda protege.

Pasó en F-015: `src/features/marketplace/server/dbFixtures.ts` (barrido de
fixtures de prueba) tenía `prisma.storefront.findMany({ where: { slug: {
contains: TOKEN_PREFIX } ... } })` para encontrar fixtures viejas por su
prefijo — nada que ver con resolver una tienda por su slug público. Pero
`src/features/storefront/server/boundaries.test.ts` (I6, de F-017) vigila
exactamente el texto `storefront:\s*\{\s*slug:`/`where:\s*\{\s*slug\b` en
CUALQUIER archivo de `src/` fuera de su lista blanca, y ese `where: { slug`
coincidió letra por letra.

## Cómo se arregla

Reescribe la consulta para llegar al mismo resultado sin la forma de texto
vigilada — nunca toques el `boundaries.test.ts` ajeno para que deje pasar tu
archivo; eso debilita la guarda para todo el repo, no solo para ti. En este
caso: en vez de `storefront.findMany({ where: { slug: ... } })`, busca la
`Storefront` por `businessId` (ya tenías el id de la `Business` stale a
mano), que es semánticamente lo mismo — «encuentra el storefront de esta
fixture» — sin escribir `slug` dentro de un `where`.

## Cuándo NO es esto

Si el archivo que falla SÍ resuelve una tienda por su slug público (una
ruta, un componente, un `route.ts` nuevo), no es un cruce de patrón: es la
guarda haciendo su trabajo real. Antes de reescribir para esquivar el regex,
lee la cabecera del `boundaries.test.ts` que falló — dice explícitamente qué
invariante protege — y confirma que tu código no es, de hecho, un quinto
resolutor.

## Cómo se evita

Al escribir un archivo nuevo bajo `src/`, si necesitas filtrar por una
columna llamada `slug` por una razón que NO es "resolver una URL pública",
prefiere llegar a la misma fila por otra columna que ya tengas a mano (un id
de padre, un prefijo en otra columna) antes de escribir `where: { slug: ...
}` literal — el texto es lo que estos guardianes miran, no la intención.
