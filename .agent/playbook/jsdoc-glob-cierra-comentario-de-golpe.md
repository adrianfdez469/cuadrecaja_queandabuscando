---
slug: jsdoc-glob-cierra-comentario-de-golpe
sintoma: "typecheck falla con TS1005/TS1443/TS1160 en cascada, todos después de una línea que parecía normal, y ninguno menciona comentarios"
firma: Module declaration names may only use|Unterminated template literal
etapa: typecheck
visto_en: F-012
creado: 2026-08-29T15:23:34Z
promovido_a_agents: no
arreglo: busca un glob tipo `algo/*/algo` dentro de un comentario /** */ cerca de la primera línea que falla, y reescríbelo sin el `*/` literal
---

## Qué pasa de verdad

Un comentario JSDoc como `/** ... features/*/server/ ... */` contiene, sin que
salte a la vista, la subcadena `*/` — la que cierra un bloque de comentario —
escondida dentro de un patrón de ruta con comodín (`algo/*/algo`). El parser
cierra el comentario ahí mismo, a mitad de frase, y todo lo que sigue en el
archivo se interpreta como código. El primer síntoma real aparece varias
líneas después, en una comilla invertida (`` ` ``) de un comentario posterior
que el parser ahora lee como el inicio de un template literal — de ahí errores
que no se parecen en nada a "cerraste un comentario de más": `Module
declaration names may only use ' or " quoted strings`, `';' expected`,
`Unterminated template literal` al final del archivo. `tsc` y el `oxc` de
Vitest lo reportan igual.

Pasó en F-012, en `src/features/account/server/customers.ts`, con un comentario
que decía `` `features/*/server/` `` — el asterisco entre las dos barras es
justo `*/`.

## Cómo se arregla

Busca hacia atrás desde la primera línea que falla el `/** ... */` más cercano
y mira si contiene `*/` en medio de su texto (casi siempre un glob de ruta con
`*` entre dos `/`). Reescribe esa frase sin el patrón literal — por ejemplo
"a feature's own server/ directory" en vez de `` `features/*/server/` `` — en
vez de tocar el código que el parser marcó como culpable, que suele estar
perfectamente bien.

## Cuándo NO es esto

Si el error apunta a un archivo `.md` o a un string real de código (no un
comentario), es un fallo distinto: aquí el comentario SIEMPRE está a pocas
líneas por encima del primer error, y esa línea contiene un glob con `*/`
dentro de una ruta.

## Cómo se evita

Al documentar un patrón de ruta con comodín dentro de un comentario de bloque
(`/** */`), usa `<algo>` en vez de `*`, o pon el patrón en un comentario de
línea (`//`) donde `*/` no cierra nada.
