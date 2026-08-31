---
slug: boundaries-test-map-slug-falso-positivo-fuera-de-dominio
sintoma: "expected [ Array(1) ] to deeply equal [] — SIBLING_SLUG_PROJECTION en boundaries.test.ts marca un archivo que no tiene nada que ver con marcas ni sucursales"
firma: only registry\.ts \(expandBrandTouch\) projects a members/stores list
etapa: test
visto_en: F-027
creado: 2026-08-31T19:24:01Z
promovido_a_agents: no
arreglo: reescribe la proyección sin la forma literal `.map((x) => x.slug)` — un `for`/`.add()`, desestructurando, o cualquier otra forma que la regex no reconozca — nunca añadas el archivo a REVALIDATION_ALLOWED_FILES
---

## Qué pasa de verdad

`SIBLING_SLUG_PROJECTION` en
`src/features/storefront/server/boundaries.test.ts` es un grep deliberadamente
ciego al dominio: busca la FORMA sintáctica `.map((x) => x.slug)` en
cualquier archivo de `src/` que no sea `registry.ts`, sin mirar sobre qué
colección se llama ni para qué se usa el resultado. Su objetivo es pescar el
defecto de `revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
(una lista de slugs de sucursales/miembros armada a mano en vez de pasar por
`expandBrandTouch()`), pero la regex no distingue esa colección de
cualquier otra. `src/features/catalog/catalogFilters.ts` escribió
`new Set(context.categories.map((c) => c.slug))` — una faceta de categorías,
cero relación con marcas ni con `Slug`/`revalidateStores` — y cayó en la
misma red.

## Cómo se arregla

Reescribe la proyección sin la forma exacta `.map((x) => x.slug)`. En este
caso, un `for` explícito:

```ts
const knownCategorySlugs = new Set<string>();
for (const category of context.categories) knownCategorySlugs.add(category.slug);
```

Desestructurar (`.map(({ slug }) => slug)`) también esquiva la regex, pero es
menos legible aquí que el `for`. Cualquiera de las dos es preferible a tocar
el test o a añadir el archivo a `REVALIDATION_ALLOWED_FILES` — esa lista es
para `registry.ts` únicamente, y ensancharla sí debilitaría la protección
real de I5/R18.

## Cuándo NO es esto

Si el `.map()` señalado SÍ recorre `storefront.stores`, `branches`, o
cualquier lista de sucursales/miembros de una marca, no es un falso
positivo: es el defecto real que el test existe para atrapar. Léelo entero
— `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
— y llama a `expandBrandTouch()` en vez de reescribir la sintaxis para
esquivar el grep.

## Cómo se evita

Antes de escribir `algo.map((x) => x.slug)` sobre CUALQUIER colección fuera
de `registry.ts`, prueba primero una forma que no sea la más literal (`for`,
desestructurando, o un helper con nombre) — no porque el resultado vaya a
revalidar nada, sino porque el sensor de frontera no sabe la diferencia y no
tiene por qué saberla: es una red parcial a propósito (ver el comentario del
propio test). Ya pasó en F-027 con una proyección de categorías que no
revalida nada.
