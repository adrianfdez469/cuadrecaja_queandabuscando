---
slug: prisma-en-componente
sintoma: "eslint: Components and pages must not touch Prisma"
firma: must not touch Prisma|no-restricted-imports
etapa: lint
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: sí
arreglo: mueve la consulta a `src/features/<dominio>/server/` y que el componente reciba el resultado ya tipado
---

## Qué pasa de verdad

La regla de capas de `AGENTS.md` está **impuesta**, no solo documentada:
`eslint.config.mjs` prohíbe importar `@/lib/prisma`, `@prisma/client` y el
cliente generado desde `src/components/**` y `src/app/**/*.tsx`. No es
estilo: un componente que importa Prisma arrastra el cliente al grafo de
módulos y rompe la frontera servidor/cliente.

## Cómo se arregla

La consulta vive en `src/features/<dominio>/server/`, devuelve un tipo propio
—no el tipo de Prisma— y la página la llama y pasa datos hacia abajo.

## Cuándo NO es esto

`src/app/**/route.ts` y `**/*.ts` no están en el `files` de la regla: un
route handler puede usar la capa `server/`, y debe hacerlo igualmente, pero el
error no vendrá de aquí.

## Cómo se evita

Antes de escribir una consulta, mira si `features/*/server/` ya la tiene.
Duplicar la consulta es una regresión aunque el lint la deje pasar.
