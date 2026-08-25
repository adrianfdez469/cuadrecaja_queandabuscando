---
slug: test-en-entorno-equivocado
sintoma: "un test falla por 'document is not defined', o por un instanceof imposible dentro de jose"
firma: document is not defined|window is not defined|jose|Uint8Array
etapa: test
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: sí
arreglo: renombra el archivo — `*.test.ts` corre en node, `*.test.tsx` en jsdom
---

## Qué pasa de verdad

`vitest.config.mts` define dos proyectos y la **extensión** decide en cuál
corre cada archivo. Un test de servidor guardado como `.test.tsx` acaba en
jsdom, que instala su propio `Uint8Array`; librerías como `jose` comprueban
`instanceof` y fallan con un error que no menciona jsdom por ningún lado. Al
revés, un test de componente como `.test.ts` corre en node y no hay `document`.

## Cómo se arregla

Renombra el archivo. No añadas `// @vitest-environment`: rompe la regla que
hace que el entorno sea deducible de un vistazo.

## Cuándo NO es esto

`document is not defined` también sale si un componente se importa desde un
test de servidor por error de dependencias. Mira **qué** archivo dispara el
error antes de renombrar el que falló.

## Cómo se evita

Al crear el primer archivo de prueba de un feature, elige la extensión mirando
qué se prueba, no qué se está importando.
