---
slug: prettier-sin-formatear
sintoma: "format:check falla con: Code style issues found in the above file(s)"
firma: Code style issues found
etapa: format
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: no
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
