---
slug: trampa-corta-en-kebab
sintoma: la línea que verás en el log, no la causa
firma: —
etapa: typecheck | lint | format | test | build | theme | bundle | smoke | review
visto_en: —
creado: 1970-01-01T00:00:00Z
promovido_a_agents: no
arreglo: una línea imperativa; es lo que verify.sh imprime cuando reconoce el fallo
---

## Qué pasa de verdad

Por qué el mensaje del log no es la causa. Dos o tres frases.

## Cómo se arregla

El comando exacto o el cambio exacto, con `archivo:línea` si aplica. Si el
arreglo es «depende», esta ficha todavía no sirve: acábala.

## Cuándo NO es esto

La `firma` es un ERE y puede pescar de más. Aquí va cómo descartar el falso
positivo, para que nadie aplique el arreglo equivocado con confianza.

## Cómo se evita

Qué habría que hacer para no volver a tropezar. Si la respuesta es «saberlo»,
la ficha es candidata a subir a `AGENTS.md` § Cosas que muerden.
