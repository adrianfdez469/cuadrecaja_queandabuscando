---
slug: revalidate-no-literal
sintoma: "el build falla por el 'revalidate' de un segmento y no dice en qué archivo"
firma: Invalid revalidate value|revalidate.*must be
etapa: build
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: sí
arreglo: escribe el número literal en `export const revalidate`, sin importarlo de una constante
---

## Qué pasa de verdad

Next analiza los _segment config exports_ **estáticamente**. Una constante
importada —aunque sea `as const`— no se puede evaluar en ese análisis, y el
mensaje de error no nombra el archivo culpable. Es de los fallos más caros de
localizar del repo porque parece un problema de tipos.

## Cómo se arregla

```ts
export const revalidate = 300; // no: REVALIDATE_STORE
```

Si el valor tiene que estar en un solo sitio conceptualmente, documenta la
constante en `src/constants/` y repite el literal con un comentario que apunte
a ella.

## Cuándo NO es esto

La misma restricción vale para `dynamic`, `runtime` y `fetchCache`. Si el
error habla de uno de esos, la causa es la misma pero el archivo es otro.

## Cómo se evita

Ninguna regla de ESLint lo cubre hoy. Cuando toques caché de un segmento,
compruébalo con `npm run build`, que es la única etapa que lo ve.
