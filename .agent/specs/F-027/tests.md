---
feature: F-027
agente: sdd-tester
actualizado: 1970-01-01T00:00:00Z
estado: borrador
veredicto: no-listo
---

## Estrategia

Qué nivel cubre qué, y en qué entorno corre cada archivo según la regla de
`AGENTS.md` § Cosas que muerden.

## Mapa criterio → prueba

| Criterio de aceptación | Prueba | Archivo | Resultado |
| ---------------------- | ------ | ------- | --------- |

Un criterio sin fila es un criterio sin cubrir. Dilo, no lo escondas.

## Ejecuciones

Comando, código de salida, conteo de pruebas. Pegar la salida real. Como mínimo
`bash .agent/verify.sh <ID> --full` y su código de salida.

Lo que solo se ve con la app en pie va a `.agent/specs/<ID>/smoke.sh` —copia
`.agent/templates/smoke.sh`— y lo ejecuta `bash .agent/verify.sh <ID> --smoke`,
que además guarda lo que escribió el servidor. Una verificación manual que no
quedó en ese archivo es una que nadie va a repetir.

## Fallos encontrados

Por fallo: severidad, cómo reproducirlo, `archivo:línea` sospechoso, y a qué
agente vuelve (spec si el requisito estaba mal, architect si el diseño no
aguanta, implementer si es el código).

Y, por cada uno, dónde quedó la lección: la ficha de `.agent/playbook/` que se
escribió o que ya lo explicaba, o el motivo por el que se descartó.
`bash .agent/verify.sh pending <ID>` tiene que quedar vacío.

## Huecos de cobertura

Lo que no se probó y el riesgo de no probarlo.

## Veredicto

`LISTO` solo si **todos** los criterios de aceptación se verificaron ejecutando
algo. Leer el código y concluir que debería funcionar no cuenta.

## Preguntas al humano

`TP1..TPn`, con opciones y recomendación. Un criterio que no se puede verificar
tal como está escrito, o un fallo cuya gravedad es decisión de producto.
