---
slug: stage-list-pegado-a-puntuacion
sintoma: "stage list is missing X, Y — verify.sh runs ..."
firma: stage list is missing
etapa: harness
visto_en: F-032, F-033
creado: 2026-09-01T21:42:35Z
promovido_a_agents: no
arreglo: pon la lista de etapas en UNA sola línea que contenga `verify.sh` y `·`, sin paréntesis ni puntuación pegada a la primera o la última etapa
---

## Qué pasa de verdad

`scripts/check-harness.mjs` § 3 compara cada línea que contiene a la vez
`verify.sh` y `·` contra `STAGES_RAPIDO`/`STAGES_COMPLETO` de
`.agent/verify.sh`. Extrae cada etapa con
`text.split("·").map(s => s.trim().split(/\s+/).pop()).filter(s => /^[a-z]+$/.test(s))`
— es decir, el ÚLTIMO token separado por espacio de cada segmento, y lo
descarta si no son solo letras minúsculas. Dos formas de romperlo, ninguna
relacionada con la etapa que falta de verdad:

1. **Envolver la lista en un paréntesis o comilla que toca la primera o la
   última palabra sin espacio** — `(harness · ... · bundle).` deja
   `bundle).` como token final (con el paréntesis y el punto pegados), que
   no matchea `/^[a-z]+$/` y desaparece de la lista extraída, aunque esté
   escrito correctamente para un humano.
2. **Partir la lista en dos líneas** (el wrap habitual a 100 columnas) — el
   checker solo lee UNA línea a la vez; la segunda línea del wrap no
   contiene `verify.sh` literal, así que sus etapas nunca se cuentan.

El mensaje resultante («stage list is missing theme, bundle», o «missing
harness, bundle») apunta a las etapas que el split rompió, no a que falten
de verdad — las nueve etapas de `STAGES_COMPLETO` seguían ahí, en prosa.

## Cómo se arregla

Escribe la lista en una sola línea, sin envolver, y sin que ningún signo de
puntuación toque directamente la primera o la última palabra de la lista:

```
- `bash .agent/verify.sh F-NNN --full` → `PASA` — + harness · prisma · build · theme · bundle
```

(el `+` inicial activa el modo delta del checker: solo exige las cinco
etapas que `--full` añade sobre las cuatro de siempre, no las nueve
completas). Si prefieres listar las nueve, quítale el `+` y escribe las
nueve sin nada pegado al final:

```
- `bash .agent/verify.sh F-NNN --full` → `PASA` — harness · typecheck · lint · format · test · prisma · build · theme · bundle
```

## Cuándo NO es esto

Si el mensaje nombra una etapa que de verdad no aparece en NINGUNA parte de
la línea (ni siquiera pegada a puntuación), es un olvido real: añádela.
Comprueba con `grep -aEi -- 'stage list is missing' .agent/runs/<F-NNN>/*.log`
y mira la línea exacta que señala — si la etapa que falta SÍ está escrita en
el documento pero tocando un paréntesis, una coma o un salto de línea, es
esta ficha.

## Cómo se evita

Copia el patrón de una línea que ya pase el checker (`grep -rn "verify.sh.*--full.*·" .agent .claude`
tiene varias) en vez de improvisar el envoltorio. `bash .agent/verify.sh
F-NNN --full` (o `npm run check:harness` solo) antes de dar el paso por
cerrado detecta esto en segundos.
