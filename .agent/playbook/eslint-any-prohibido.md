---
slug: eslint-any-prohibido
sintoma: "eslint falla con: Unexpected any. Specify a different type"
firma: "@typescript-eslint/no-explicit-any"
etapa: lint
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: sí
arreglo: tipa el valor; si de verdad no se conoce, usa `unknown` y estrecha con un schema de Zod
---

## Qué pasa de verdad

`any` no es un aviso en este repo, es un error de ESLint (`eslint.config.mjs`),
y `AGENTS.md` lo lista entre las prohibiciones. Aparece casi siempre al tocar
un payload que llega de fuera: del POS, de una respuesta HTTP, de `JSON.parse`.

## Cómo se arregla

Si el dato viene de fuera del proceso, el tipo no se inventa: se valida.

```ts
const parsed = syncEventSchema.parse(body); // src/features/sync/schemas.ts
```

Si es interno y solo faltaba escribirlo, escríbelo. `unknown` + estrechamiento
es aceptable; `// eslint-disable-next-line` no lo es sin una línea que explique
por qué, y no la hay casi nunca.

## Cuándo NO es esto

Si el archivo está bajo `src/generated/`, no lo toques: está en
`globalIgnores`. Que aparezca ahí significa que alguien cambió los ignores.

## Cómo se evita

Todo lo que cruza el borde del proceso entra por un schema de Zod. Es la misma
regla que hace que el sync sea seguro de reintentar.
