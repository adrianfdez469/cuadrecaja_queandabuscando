---
feature: F-027
agente: sdd-architect
actualizado: 1970-01-01T00:00:00Z
estado: borrador
---

## Estado actual relevante

Qué existe hoy, en qué archivos, y qué se reutiliza tal cual.

## Decisión

Qué se va a construir y por qué esta forma y no otra. Alternativas descartadas
en una línea cada una.

## Componentes

| Componente | Capa | Responsabilidad | Archivo |
| ---------- | ---- | --------------- | ------- |

Las capas son las de `AGENTS.md` (`app/`, `features/*/server/`, `lib/`, …).

## Flujo de datos

Paso a paso, o un diagrama mermaid si aclara más que el texto.

## Contratos

Tipos y esquemas Zod, endpoints, tabla de errores con código y significado.

## Modelo de datos y migraciones

Tablas, índices, y si hace falta migración. Los comandos que `AGENTS.md` marca
como prohibidos no se planifican: si parecen necesarios, es una pregunta.

## Escalabilidad y límites

Volumen esperado, coste por petición, N+1, uso del pooler, caché e ISR por tag,
presupuesto de JavaScript de cliente. Qué se rompe primero al multiplicar por 100.

## Patrones a seguir / antipatrones a evitar

Con referencia a la sección de `AGENTS.md` que lo impone.

## Riesgos y plan B

## ¿Hace falta una ADR?

Sí/no. Si sí, número siguiente en `docs/adr/` y título propuesto.

## Preguntas al humano

`AP1..APn`, con opciones y recomendación.
