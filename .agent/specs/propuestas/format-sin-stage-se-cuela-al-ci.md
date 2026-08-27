---
propuesta: format-sin-stage-se-cuela-al-ci
agente: sdd-spec
actualizado: 2026-08-27T00:00:00Z
estado: propuesta
---

## Problema

`prettier-sin-formatear` es una de las dos fichas que más han mordido del
playbook —cinco ciclos: F-010, F-007, F-011, F-017 y PR #7— y la que menos
enseña de todas: su arreglo es
`npm run format`, una línea, cero contenido conceptual. Se repite porque el
arnés la detecta y no la resuelve, no porque nadie sepa la lección.

El hueco es concreto. `.lintstagedrc.json` pasa `prettier --write` sobre lo que
está en `stage`, así que el hook de pre-commit solo formatea lo que alguien ya
decidió commitear. Un archivo que un agente acaba de escribir y todavía no ha
añadido al índice no pasa por el hook, y la etapa `format` del sensor
(`npm run format:check`, `.agent/verify.sh:36`) lo único que hace es decir que
está crudo y salir con `1`. El agente lee la ficha, ejecuta `npm run format`,
vuelve a lanzar el sensor y gasta un ciclo entero en un cambio que ninguna
persona iba a revisar.

Por eso esta ficha **no** sube a `AGENTS.md` § «Cosas que muerden» aunque el
contador diga que es candidata: cinco repeticiones con arreglo trivial no piden
documentación, piden que la herramienta lo haga. Un párrafo más en la sección que
se lee completa en cada arranque de sesión no habría evitado ninguna de las
cinco.

## Alcance

### Dentro

- La etapa `format` de `.agent/verify.sh`: que se auto-repare en vez de solo
  quejarse, y que diga en voz alta qué reescribió.
- Actualizar la ficha `.agent/playbook/prettier-sin-formatear.md` cuando deje de
  poder morder.

### Fuera (explícito)

- `.lintstagedrc.json` y `.husky/pre-commit`: el hook hace bien lo que hace, y
  ampliarlo a archivos sin `stage` formatearía cosas que quien commitea no eligió
  tocar.
- El CI. Sigue corriendo `format:check` y sigue siendo el árbitro: esta propuesta
  quita el rojo antes de llegar allí, no relaja la puerta.
- Las demás etapas del sensor. `lint --fix` es tentador por simetría y es otra
  discusión: ESLint sí puede cambiar el significado del código.

## Actores y precondiciones

Lo dispara cualquier agente que ejecute `bash .agent/verify.sh <ID>` después de
escribir un archivo. Precondición: repo en git con una rama base con la que
comparar (`main`), que es lo que ya se cumple en cada worktree.

## Comportamiento esperado

- **E1.** Dado un archivo escrito por un agente y sin formatear, cuando corre la
  etapa `format`, entonces el sensor lo formatea, imprime la lista de archivos
  que reescribió y **continúa** a la etapa siguiente sin salir con `1`.
- **E2.** Dado que después de formatear `format:check` sigue fallando, entonces
  la etapa falla como hoy, con el log crudo. Es el caso de `.prettierignore`
  que la ficha ya distingue en su «Cuándo NO es esto», y no se puede auto-reparar.
- **E3.** Dado un archivo sin formatear que **no** cambió respecto a la rama
  base, entonces el sensor no lo toca: reformatear medio repo dentro de un
  feature ajeno convierte el diff en ilegible.
- **E4.** Dado que no hay nada que formatear, entonces la etapa se comporta
  exactamente como hoy y no imprime ruido.

## Reglas de negocio

- **R1.** El sensor puede reescribir un archivo solo si `prettier --write` es la
  única transformación aplicada, y solo sobre archivos que difieren de la rama
  base.
- **R2.** Toda escritura del sensor se imprime. Un sensor que muta el árbol en
  silencio rompe su propio contrato —«el agente arregla sobre el error real»— y
  deja al humano un diff que nadie anunció.
- **R3.** Auto-repararse no puede convertir un fallo real en verde. Si el
  `format:check` posterior falla, la etapa falla.

## Casos límite y errores

- Archivo en `.prettierignore` que aun así se queja: E2, no se toca.
- Archivo con conflicto de merge a medias: `prettier` falla al parsear; la etapa
  debe reportar ese fallo tal cual, no tragárselo.
- Repo sin rama base disponible (worktree recién creado sin `main` local): que
  degrade al comportamiento de hoy, `format:check` a secas.
- `prettier-plugin-tailwindcss` reordena clases, así que la reescritura puede
  tocar líneas que el agente no escribió dentro de un archivo que sí escribió.
  Es aceptable y es justamente por lo que la ficha prohíbe formatear a mano.

## Datos y contrato

Ninguno. No toca el contrato con cuadrecaja ni el schema. Lo único que cambia de
contrato es el de la etapa: `format` pasa de «comprueba» a «comprueba, arregla lo
que sabe arreglar, y vuelve a comprobar», manteniendo los códigos de salida del
bucle (`0` pasa · `1` falla · `2` estancado · `3` uso incorrecto).

## Criterios de aceptación propuestos

- `[nuevo]` Escribir un `.ts` crudo dentro del alcance de un feature y ejecutar
  `bash .agent/verify.sh <ID> --only format` sale `0`, imprime el archivo que
  reescribió, y `npm run format:check` inmediatamente después también sale `0`.
- `[nuevo]` Con un archivo crudo que el sensor no puede arreglar (metido en
  `.prettierignore`), la misma orden sale `1` e imprime el log crudo.
- `[nuevo]` Con el árbol ya formateado, la salida de la etapa es idéntica a la de
  hoy: `git status --porcelain` vacío después de correrla.
- `[nuevo]` Un archivo sin formatear que no difiere de la rama base sigue sin
  formatear después de la etapa.

## Incongruencias detectadas

- `.agent/playbook/README.md` § «Qué entra y qué no» define la bitácora como lo
  que **volverá a pasar**. Si esta propuesta se implementa, la ficha deja de
  poder volver a pasar por la vía que la generó y hay que decidir si se queda
  como registro histórico o se retira. Recomendación: se queda, con su firma
  intacta, porque E2 sigue siendo un fallo real que la ficha explica.
- El contador de `bash .agent/sdd.sh playbook` (`.agent/sdd.sh:196-200`) seguirá
  marcando la ficha en amarillo mientras `promovido_a_agents: no`, y esa decisión
  ya está tomada a propósito. El aviso amarillo hoy no distingue «todavía no se
  ha decidido» de «se decidió que no sube». Puede que merezca un tercer valor
  (`promovido_a_agents: no-a-propósito`) o que el motivo escrito en la propia
  ficha baste; queda fuera del alcance de arriba.

## Huecos y preguntas al humano

- **SP1.** ¿El sensor puede escribir en el árbol de trabajo? Es la decisión de
  fondo y no es técnica: hoy `verify.sh` solo observa. Opciones: (a) formatea los
  archivos que difieren de la rama base e imprime lo que tocó; (b) no escribe
  nada y solo imprime el comando exacto a ejecutar, con lo que el ciclo perdido
  sigue perdiéndose; (c) escribe solo con un flag explícito (`--fix`), que en la
  práctica nadie recordará pasar. **Recomendación: (a)**, acotada por R1/R2/R3 —
  `prettier --write` es idempotente y determinista, y es literalmente el arreglo
  que la ficha ya manda ejecutar a mano.
- **SP2.** ¿Cuenta como fallo «resuelto sin ficha» para `sdd.sh done`? Si el
  sensor lo arregla y sigue, el fallo nunca llega al pendiente. Recomendación:
  no cuenta, no hay lección que escribir; pero conviene que la línea impresa
  quede en el log de `runs/` para que el humano vea que pasó.

## No decidido a propósito

Si `lint` debería auto-repararse igual con `eslint --fix`. La simetría es obvia y
el riesgo no es el mismo: una regla de ESLint puede reescribir lógica, no solo
espacios. Se decide después de ver esto funcionando, y no en esta propuesta.
