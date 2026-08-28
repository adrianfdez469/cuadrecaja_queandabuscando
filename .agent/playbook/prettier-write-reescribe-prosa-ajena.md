---
slug: prettier-write-reescribe-prosa-ajena
sintoma: "format:check señala un .md de .agent/ que no escribiste tú, y `npm run format` lo arregla cambiando lo que dice"
firma: \[warn\] \.agent/(progress|specs)/
etapa: format
visto_en: F-015, F-018, F-011
creado: 2026-08-27T14:44:00Z
promovido_a_agents: no
arreglo: no formatees a ciegas un documento ajeno — copia, formatea, diffea, y si prettier cambió el sentido de una línea reescribe esa línea a mano (normalmente un `+` o un `-` que quedó al principio de una línea de continuación) y vuelve a formatear
---

## Qué pasa de verdad

`prettier-sin-formatear` dice, con razón, que el arreglo es `npm run format`. Lo
que no dice es que en `.agent/` la etapa `format` recorre documentos que
**escribieron otros agentes o el humano**, y que prettier no reformatea sin
interpretar: reconstruye el markdown desde su AST.

El caso concreto de F-015: la sección «Decisiones tomadas» de
`.agent/progress/F-015.md` —texto del humano, explícitamente marcado como no
reescribible— tenía una viñeta cuya línea de continuación empezaba por `+`,
porque la frase enumeraba «poblar `searchVector` + una función de búsqueda +
pruebas». Para prettier ese `+` al principio de línea es un marcador de lista:
lo normalizó a `-`, lo indentó y lo convirtió en una **sub-viñeta**. El archivo
quedó formateado y la decisión del humano quedó diciendo otra cosa.

Nadie lo habría notado: `format:check` sale verde y el diff parece cosmético.

## Cómo se arregla

```bash
cp <archivo> /tmp/antes.md
npx prettier --write <archivo>
diff /tmp/antes.md <archivo>
```

Si el diff solo mueve espacios o normaliza énfasis (`*x*` → `_x_`), listo. Si
convirtió una línea de continuación en una viñeta, reescribe **esa** línea para
que ningún renglón empiece por `+`, `-` o `*` sin ser una viñeta de verdad —
basta re-partir el párrafo— y vuelve a formatear. Es un cambio de espacios sobre
prosa ajena: se puede hacer, y se avisa en el informe.

## Cuándo NO es esto

Si el `[warn]` es sobre un `.md` o `.ts` que acabas de escribir tú, es la ficha
`prettier-sin-formatear` y el arreglo es directamente `npm run format`: no hay
prosa de nadie que proteger.

## Cómo se evita

Al escribir en `.agent/`, ninguna línea de continuación empieza por `+`, `-` o
`*`. Si una frase enumera con `+`, se escribe `y` o se re-parte el párrafo para
que el signo caiga en medio de la línea. Y quien redacta la plantilla de un
documento que otro va a rellenar gana lo mismo: el arreglo trivial de la etapa
`format` deja de poder cambiar lo que el documento decía.
