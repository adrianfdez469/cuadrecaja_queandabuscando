---
propuesta: etapa-visual-del-ci-clavada-a-un-feature
agente: orquestador
actualizado: 2026-08-31T06:30:00Z
estado: propuesta
---

> Encontrada el 2026-08-31 cerrando F-026, y por el peor camino posible: el
> check `visual` del PR #24 salió **verde** mientras el guion visual de ese
> mismo feature fallaba de forma estable en local. El orquestador estuvo a un
> paso de leer ese verde como «V5 pasa en CI» y hacer el merge.
>
> Ficha del síntoma, para quien lo vuelva a leer mal:
> `.agent/playbook/verde-visual-que-no-mira-tu-feature.md`.

## Problema

`.github/workflows/ci.yml` tiene **una** línea que ejecuta verificación visual:

```yaml
- name: Visual verification (F-010 — carrito y checkout)
  run: bash .agent/verify.sh F-010 --visual
```

Está clavada a F-010. Hoy hay **ocho** features con guion visual —F-010, F-011,
F-012, F-017, F-019, F-021, F-023 y F-026— y el CI ejecuta **uno**. Los otros
siete tienen, al lado de cada PR, un check llamado `visual` en verde que no ha
abierto su carpeta.

Lo que hace esto peor que no tener la etapa: **el verde miente activamente**. Un
check ausente se nota; un check verde que no comprueba nada se lee como
garantía, y es exactamente así como se leyó en el PR #24. Y la etapa visual es
justo la que encuentra lo que ninguna otra puede: `--full` no ve un anillo de
foco recortado, ni una fila que echa la rejilla fuera de pantalla, ni un
contraste de 2,2:1 — que es lo que el guion visual de F-019 encontró en un token
que usaban 22 archivos y que llevaba meses así.

Nadie hizo nada mal al escribirlo: cuando esa línea se escribió, F-010 era el
único feature con guion. El defecto es que **no crece con el repositorio**, y que
nada avisa cuando se queda atrás.

## Alcance

### Dentro

1. Que la etapa `visual` del CI ejecute **todos** los guiones visuales que
   existan, o un subconjunto que se elija con un criterio escrito — no una lista
   que alguien tiene que acordarse de ampliar.
2. Decidir qué se hace con los **siete guiones que hoy nadie ejecuta en CI**.
   Es la parte incómoda: es probable que varios estén rojos desde hace meses, y
   ese número hay que mirarlo antes de decidir la forma del arreglo.
3. Que el fallo de un guion diga **de qué feature** es, en el nombre del check o
   en su salida. Con ocho guiones, «visual failed» no basta.
4. Los artefactos (capturas y trazas), que hoy están clavados a
   `.agent/runs/F-010/` en dos pasos del workflow y tienen el mismo problema.
5. Arreglar la referencia muerta del comentario de `ci.yml`: cita
   `.agent/specs/propuestas/verificacion-visual-en-el-arnes.md`, que **ya no
   existe en el disco**.

### Fuera (explícito)

- **Arreglar los guiones que resulten estar rojos.** Esta propuesta los
  destapa y los cuenta; arreglar cada uno es del feature que lo tenga, y puede
  que alguno revele un defecto real de producto en vez de un guion caduco.
- **Meter la etapa visual en `--full`.** El comentario de `ci.yml` explica por
  qué está aparte y el argumento sigue en pie: instalar Chromium añade 1-2
  minutos que no vale la pena pagar en el bucle que los agentes corren decenas
  de veces por sesión.
- **Reescribir `verify.sh`.** Su contrato de códigos de salida funciona; esto es
  sobre a qué se le llama, no sobre cómo.

## Actores y precondiciones

**Quien abre un PR** —agente o humano— y lee los checks para decidir si mergear.
Y quien construye un feature con interfaz y cree que su guion visual lo protege.

Precondición: que el feature tenga `.agent/specs/<ID>/visual.mjs`. Ocho lo
tienen; el noveno lo escribirá el próximo feature con pantalla.

## Comportamiento esperado

**E1 — un guion visual roto pone el PR en rojo.**
Dado un feature con `visual.mjs` cuyas aserciones no pasan, cuando se abre un
PR que toca ese código, entonces el check `visual` **falla**, y su salida dice
qué feature y qué aserción.

**E2 — un guion nuevo entra en el CI sin tocar el CI.**
Dado un feature que añade su `visual.mjs`, cuando se abre su PR, entonces ese
guion se ejecuta **sin** haber editado `.github/workflows/ci.yml`. Que el
arreglo dependa de acordarse es el defecto que esta propuesta cierra, no la
solución.

**E3 — las capturas y trazas se recuperan por feature.**
Dado un fallo visual, cuando se descargan los artefactos del run, entonces están
las capturas del feature que falló, no solo las de F-010.

**E4 — el estado de partida es un número, no una impresión.**
Dado el conjunto de los ocho guiones, cuando se ejecutan todos por primera vez,
entonces queda escrito cuántos pasan y cuántos no, con la firma de cada fallo.

## Reglas de negocio

**R1 — un check verde tiene que significar que se comprobó algo.** Es la regla
de fondo y la única que importa: más vale una etapa ausente que una que
tranquiliza sin mirar.

**R2 — la lista de lo que se verifica se deriva, no se mantiene a mano.** Del
disco (`.agent/specs/*/visual.mjs`), o del diff, o de `features.json` — pero no
de una línea que alguien tiene que ampliar. Es la misma prohibición que
`AGENTS.md` ya tiene para el array de slugs a revalidar, y por el mismo motivo.

**R3 — el coste no puede volver el CI inusable.** Ocho guiones que levantan la
app cada uno es tiempo real. Si hace falta acotar, se acota con un criterio
escrito (los features que el diff toca, por ejemplo), no recortando a uno.

**R4 — esto no puede volver a pasar en silencio.** Si al final se decide
verificar un subconjunto, algo tiene que avisar cuando existe un `visual.mjs`
que nadie ejecuta — igual que `check:harness` avisa de una ruta inventada.

## Casos límite y errores

| Caso                                                           | Qué tiene que pasar                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Un `visual.mjs` de un feature ya cerrado y borrado del backlog | Se sigue ejecutando: `specs/` se conserva a propósito, y su pantalla sigue en producción                           |
| Un guion que tarda mucho                                       | Se mide y se dice; no se calla ni se salta                                                                         |
| Un guion que necesita datos que otro guion borra               | Cada uno deja la base como la encontró, que ya es la convención — y falla ruidosamente si no                       |
| Dos guiones que quieren el mismo puerto                        | Un solo `next dev` por corrida, reutilizado, como ya hace `verify.sh`                                              |
| Un guion inestable (pasa y falla sin cambiar nada)             | Es un defecto del guion y se trata como tal; no se marca «permitido fallar», que es reinventar el verde que miente |

## Datos y contrato

**Ninguno.** No toca la base, ni el contrato con cuadrecaja, ni el código de
producto. Es infraestructura de verificación.

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. `[nuevo]` `grep -c -- '--visual' .github/workflows/ci.yml` no depende del
   número de features: añadir un `visual.mjs` nuevo no exige editar el workflow.
2. `[nuevo]` Con un guion visual deliberadamente roto en un feature **distinto**
   de F-010, el check del PR **falla**, y su salida nombra ese feature.
3. `[nuevo]` Los ocho guiones actuales se ejecutan y queda escrito, en la
   propuesta o en el progreso del feature, cuántos pasan y la firma de cada
   fallo.
4. `[nuevo]` Al fallar, los artefactos del run traen las capturas y la traza del
   feature que falló.
5. `[nuevo]` Existe algo que avise si un `visual.mjs` del disco no se ejecuta en
   ninguna corrida (R4), y ese aviso falla si se rompe a propósito.
6. `[nuevo]` El comentario de `ci.yml` no cita ningún archivo inexistente.
7. `[nuevo]` El tiempo total del CI queda medido antes y después, y escrito.

## Incongruencias detectadas

**I1 — el comentario de `ci.yml` cita un archivo que no existe.** Las líneas
78-81 remiten a `.agent/specs/propuestas/verificacion-visual-en-el-arnes.md`,
que no está en el disco. Es exactamente la clase de referencia muerta que
`npm run check:harness` existe para impedir, viviendo en su punto ciego:
ese check audita la prosa del arnés y `ci.yml` no es prosa del arnés.

**I2 — la etapa visual es la única del sensor que el CI no aplica al feature en
curso.** `verify.sh --full` corre lo del feature que se le pasa; el CI corre
`--visual` de otro feature. Un agente que lee `AGENTS.md` § Comandos concluye
razonablemente que el CI comprueba lo mismo que él corre en local, y en esta
etapa no es cierto.

**I3 — F-009 declara este terreno como suyo y no lo cubre.** Su criterio 3 pide
que exista un `ci.yml` que corra typecheck, lint, format:check, prisma validate,
test y build — y no menciona la etapa visual, que se añadió después. F-009 sigue
en `passes: false`, así que hay una decisión previa: ¿esto es parte de F-009 o un
feature aparte? La regla 3 impide cambiar sus criterios ya escritos.

**I4 — nadie sabe si los otros siete pasan.** No es una sospecha con mala
intención: es que **nunca se ha ejecutado el conjunto**. El de F-026 se escribió
hoy y encontró un fallo real a la primera (V5); el de F-019 encontró un token con
2,2:1 usado por 22 archivos. La tasa de hallazgos de esta etapa, cuando se
ejecuta, es alta — lo que hace más caro que siete no se ejecuten.

## Huecos y preguntas al humano

**SP1 — ¿Todos los guiones en cada PR, o solo los de los features que el diff
toca?**

- **(a) Todos, siempre.** Simple, sin criterio que discutir, y detecta la
  regresión cruzada — que es la que de verdad muerde: un cambio en `ProductCard`
  rompe la pantalla de F-021 y de F-026 a la vez. Coste: ocho arranques de la
  app por corrida.
- **(b) Solo los de los features tocados por el diff.** Más rápido, pero exige
  un mapa fiable de archivo → feature que hoy no existe, y **se le escapa
  precisamente la regresión cruzada**.
- **(c) Todos, pero en un job aparte que no bloquea el merge.** Es el verde que
  miente otra vez, con más pasos.
  **Recomendación: (a)**, y si el tiempo se vuelve un problema, medirlo y
  entonces decidir con el número delante — no antes.

**SP2 — ¿Qué se hace si al ejecutar los siete resulta que varios están rojos?**

- **(a) Se arreglan antes de activar la etapa.** Correcto y potencialmente
  lento: cada uno vuelve a su feature.
- **(b) Se activa la etapa ya, y los rojos se arreglan con el CI en rojo
  delante.** Honesto y muy incómodo: nadie puede mergear nada hasta que se
  limpien.
- **(c) Se activa para los que pasan y se anota, con fecha y firma, cada uno que
  se deja fuera.** Deuda explícita en vez de deuda invisible.
  **Recomendación: primero el número (criterio 3), y decidir entonces.** Con
  cero rojos sobra la pregunta; con siete es otra conversación.

**SP3 — ¿Esto es parte de F-009 (pipeline de calidad, `passes: false`) o un
feature aparte?** Ver I3.
**Recomendación: aparte.** F-009 tiene sus criterios escritos y la regla 3 los
protege; meter esto dentro obligaría a interpretarlos de más.

## No decidido a propósito

- **La forma técnica** —matriz de jobs, un bucle en un paso, un guion que
  descubra los `visual.mjs`—. `sdd-architect`, cuando esto sea un feature.
- **Si la etapa visual debería correr también en `main` tras el merge**, y no
  solo en los PR.
- **Si el aviso de R4 vive en `check:harness`** (que ya recorre el arnés y ya
  sabe qué archivos existen) o en un guion propio.
