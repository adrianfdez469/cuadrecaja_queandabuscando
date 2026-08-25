---
feature: F-XXX
actualizado: 1970-01-01T00:00:00Z
branch: feature/descripcion-corta
ciclo: 0
---

## Estado actual

Dos o tres frases: qué funciona hoy y qué no.

## Criterios cubiertos

Los `acceptance_criteria` del feature —**todos**, en el mismo orden que
`features.json`— con lo que se ejecutó para verificar cada uno. Un criterio sin
comando ejecutado no está cubierto, y `sdd.sh done` cuenta las casillas marcadas
contra las del feature: no cuadra, no cierra.

<!-- Ejemplos del formato; bórralos al escribir los criterios de verdad:
- [x] "'npm test' pasa" → `npm test`, 96 passed
- [ ] "POST /api/... responde 207" ← EN CURSO
-->

## Decisiones tomadas

Las que no se deducen del código, incluidas las que resolvió el humano. Las
estructurales se promueven a `docs/adr/`.

## Problemas resueltos en este ciclo

Qué falló en la verificación y cómo se arregló. Uno por línea, con la firma que
imprimió `verify.sh` y —si dio lección— la ficha de `.agent/playbook/` donde
quedó escrita. `sdd.sh done` no cierra el feature mientras quede un fallo que no
esté ni fichado ni descartado.

<!-- Ejemplo del formato; bórralo al escribir los de verdad:
- `test:TypeError Cannot read properties of undefined` → el fixture no traía el
  campo. Descuido, descartado: no daba lección a nadie.
- `build:Invalid revalidate value` → constante importada en un segment config.
  Ficha: .agent/playbook/revalidate-no-literal.md. Ya estaba: la leí y la apliqué.
-->

## Bloqueado por

Nada, o el qué y el quién.

## Próximo paso concreto

UNA acción, ejecutable sin releer todo el hilo. Con archivo y línea si aplica.

## Notas para quien retome

Trampas, callejones sin salida ya explorados, contexto que no está en el código.

## Bitácora

Append-only, en orden cronológico. Una entrada por agente que trabaja, escrita
por él mismo al terminar con `bash .agent/sdd.sh log <id> <agente>`.

El estado de los artefactos no se anota aquí: lo deriva `sdd.sh status` del
frontmatter de cada uno.
