# Especificaciones vivas

Una carpeta por feature: `.agent/specs/F-NNN/`, creada con
`bash .agent/sdd.sh new F-NNN`.

| Archivo           | Lo escribe        | Qué contesta                                         |
| ----------------- | ----------------- | ---------------------------------------------------- |
| `spec.md`         | `sdd-spec`        | Qué hay que construir y cómo se verifica             |
| `architecture.md` | `sdd-architect`   | Con qué piezas, en qué capas, y qué pasa al escalar  |
| `design.md`       | `sdd-designer`    | Qué ve y toca la persona, en cada tamaño de pantalla |
| `impl.md`         | `sdd-implementer` | Qué se construyó y dónde se desvió del plan          |
| `tests.md`        | `sdd-tester`      | Qué se ejecutó, qué falló y si está listo            |
| `smoke.sh`        | `sdd-tester`      | Qué se comprueba con la app levantada (opcional)     |

Cada agente escribe **solo su archivo** y lee los de los demás. Las plantillas
están en [`../templates/`](../templates/).

`smoke.sh` no lo crea `sdd.sh new` porque no todo feature lo necesita: se copia
de `../templates/smoke.sh` cuando hay algo que solo se ve en runtime, y lo
ejecuta `bash .agent/verify.sh F-NNN --smoke`.

Esta carpeta **se conserva** cuando el feature cierra: es la especificación de
lo que existe. Lo que se borra al cerrar es `.agent/progress/F-NNN.md`, que era
el andamio.

## El frontmatter

`sdd.sh status` lo lee para saber cómo va todo, y marca en rojo cualquier valor
que no esté en esta lista. No hay más valores para los artefactos de un feature;
si hace falta uno, se añade aquí y en `ESTADOS` de `sdd.sh`.

| Campo         | Dónde              | Valores                                      |
| ------------- | ------------------ | -------------------------------------------- |
| `feature`     | todos              | `F-NNN`                                      |
| `agente`      | todos              | el que lo escribe                            |
| `actualizado` | todos              | ISO-8601 UTC (`date -u +%Y-%m-%dT%H:%M:%SZ`) |
| `estado`      | todos              | `borrador` · `listo` · `obsoleto`            |
| `veredicto`   | solo en `tests.md` | `listo` · `no-listo`                         |

`estado: borrador` significa que quedan preguntas abiertas o trabajo por hacer;
`listo`, que el siguiente agente puede construir encima sin preguntar; `obsoleto`,
que el documento describe algo que ya no es cierto y hay que rehacerlo.

Hay un cuarto valor, `propuesta`, que vive **solo** en `propuestas/<slug>.md` y no
lo escribe ningún agente: lo pone `sdd.sh propose`. `sdd.sh status` no mira esa
carpeta, así que no lo verás nunca en el estado de un feature.

**El cierre lo gobierna `veredicto`, no `estado`.** Un `tests.md` puede quedar en
`estado: listo` con `veredicto: no-listo`: el trabajo de probar está terminado y
el resultado es que el feature no pasa.

## Propuestas

`propuestas/<slug>.md`, creado con `bash .agent/sdd.sh propose <slug>`, es donde
va una idea que **todavía no es un feature**. El backlog lo escribe el humano
(regla 4): mientras no la acepte, la propuesta vive aquí con `estado: propuesta`
y sin `feature:`. Cuando entre en `features.json`, se empieza de verdad con
`sdd.sh new`.
