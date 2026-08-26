---
feature: F-XXX
agente: orquestador
actualizado: 1970-01-01T00:00:00Z
estado: borrador
aprobado: no
---

## Qué se va a construir

Tres frases, en el idioma del humano y no en el del código: qué va a poder hacer
alguien cuando esto exista y qué no cambia.

## Pasos

En el orden en que se van a ejecutar. Un paso es una unidad que se puede
verificar sola; si no sabes cómo verificarlo, todavía no es un paso.

| Nº  | Qué se hace | Archivos | Criterio que acerca | Cómo se verifica |
| --- | ----------- | -------- | ------------------- | ---------------- |

## De dónde sale cada paso

La línea de `spec.md`, `architecture.md` o `design.md` que lo justifica. Un paso
que no sale de ningún documento previo es alcance inventado: quítalo o vuelve al
agente que debía haberlo escrito.

## Qué queda fuera

Lo que alguien podría esperar de este feature y **no** se va a construir en este
ciclo, con el motivo. Es la mitad del plan que evita la discusión de después.

## Riesgos y plan B

Qué puede salir mal, cómo se notaría y qué se haría entonces. Incluye
explícitamente si hay migración de datos, cambio en `docs/sync-contract.md` o
algo que `AGENTS.md` marque como prohibido: eso no se aprueba de pasada.

## Coste

Cuántos ciclos de agente, qué se toca de lo que ya funciona, y qué habría que
deshacer si se decide dar marcha atrás a mitad.

## Preguntas antes de aprobar

`PP1..PPn`, con opciones y recomendación. Si hay alguna sin responder, el plan no
se puede aprobar: primero se resuelven, luego se firma.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-XXX '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->
