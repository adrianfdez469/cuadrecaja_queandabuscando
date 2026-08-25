---
feature: F-XXX
agente: sdd-spec
actualizado: 1970-01-01T00:00:00Z
estado: borrador
---

## Problema

Una o dos frases: qué le pasa hoy a quien usa el producto y por qué importa.

## Alcance

### Dentro

### Fuera (explícito)

## Actores y precondiciones

Quién dispara esto y qué tiene que ser cierto antes.

## Comportamiento esperado

Escenarios numerados `E1..En`, en Dado / Cuando / Entonces. Sin ambigüedad:
nada de «rápido», «amigable» o «si corresponde».

## Reglas de negocio

`R1..Rn`. Cada una comprobable por separado.

## Casos límite y errores

Qué pasa con datos vacíos, duplicados, concurrencia, reintentos, permisos.

## Datos y contrato

Campos, tipos, obligatoriedad, unidades, moneda, zona horaria, límites de
tamaño. Si toca el contrato con cuadrecaja, citar `docs/sync-contract.md`.

## Criterios de aceptación propuestos

Cada uno verificable **ejecutando algo** (comando + código de salida, o petición
HTTP + respuesta). Marcar `[ya]` los que ya están en `features.json` y `[nuevo]`
los que se proponen al humano.

## Incongruencias detectadas

Contradicciones con `features.json`, `AGENTS.md`, ADRs o el código actual.
Con cita de archivo y línea.

## Huecos y preguntas al humano

`SP1..SPn`. Cada una: qué falta, por qué bloquea, opciones y recomendación.

## No decidido a propósito

Lo que se deja abierto y quién lo cerrará después.
