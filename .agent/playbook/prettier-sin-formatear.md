---
slug: prettier-sin-formatear
sintoma: "format:check falla con: Code style issues found in the above file(s)"
firma: Code style issues found
etapa: format
visto_en: F-010, F-007, F-011, F-017, PR #7, F-015, F-018, F-021, F-023, F-012, F-028, F-019, F-026, F-025, F-014, F-020, F-031, F-032, F-030, F-033, F-022, F-034
creado: 2026-08-25T19:11:02Z
promovido_a_agents: sí
arreglo: npm run format
---

## Qué pasa de verdad

Nada conceptual: el CI corre `prettier --check` y el hook de pre-commit solo
formatea lo que está en `stage`. Un archivo escrito por un agente y no
commiteado se salta el hook y llega crudo al CI.

## Cómo se arregla

```bash
npm run format
```

Y vuelve a verificar. No formatees a mano: `prettier-plugin-tailwindcss`
además reordena las clases, y hacerlo a ojo produce diffs que no convergen.

## Cuándo NO es esto

Si el archivo está en `.prettierignore` y aun así se queja, el problema es el
ignore, no el archivo.

## Cómo se evita

Ejecuta el sensor (`bash .agent/verify.sh`) antes de dar nada por terminado:
`format` es su tercera etapa justamente porque es la más barata de arreglar.

## Por qué NO sube a AGENTS.md, aunque el contador diga que es candidata

Decidido el 2026-08-27, después de la quinta vez. `bash .agent/sdd.sh playbook`
la marca en amarillo y seguirá marcándola: el umbral es mecánico —dos features o
más— y esta va por cinco. La decisión de no promoverla es a propósito, así que si
llegas aquí por el amarillo, no hace falta volver a pensarlo.

El motivo es lo que dice la primera línea de esta ficha: nada conceptual. Un
párrafo en § «Cosas que muerden» sirve para lo que un agente no puede deducir del
mensaje de error; `Code style issues found` ya dice qué pasa, y el arreglo es una
orden de una línea. Ninguna de las cinco veces se perdió por ignorancia — se
perdieron por declarar algo terminado sin correr el sensor, que es una regla que
el protocolo ya tiene («nadie declara que algo funciona sin que `verify.sh` haya
salido `0`»). Y esa sección se lee **completa** en cada arranque de sesión: cada
párrafo que se añade diluye los que sí enseñan algo.

Cinco repeticiones con arreglo trivial no piden documentación, piden que la
herramienta lo haga. Eso está propuesto aparte, en
`.agent/specs/propuestas/format-sin-stage-se-cuela-al-ci.md`: que la etapa
`format` del sensor se auto-repare en voz alta en vez de solo quejarse. Si eso se
implementa, esta ficha se queda por su rama E2 —lo que `prettier --write` no
puede arreglar, como un `.prettierignore` mal puesto— y no por esta.
