# Protocolo de trabajo para agentes

El trabajo lo dirige un **orquestador** (la sesión principal, con el skill
`/sdd`) que reparte a cinco especialistas. Ninguno habla con el humano ni con
otro agente: se coordinan por estos archivos.

| Archivo / carpeta  | Qué es                                                             | Quién lo escribe       |
| ------------------ | ------------------------------------------------------------------ | ---------------------- |
| `features.json`    | Qué hay que construir y **cómo se verifica**                       | El humano              |
| `specs/<id>/`      | La especificación viva del feature                                 | Un agente por archivo  |
| `progress/<id>.md` | Estado del feature en curso + bitácora                             | El orquestador y todos |
| `playbook/`        | Problemas ya resueltos, con su arreglo                             | Quien los resuelve     |
| `templates/`       | Las plantillas de los artefactos                                   | Nadie, se copian       |
| `sdd.sh`           | Crea, inspecciona y anota el trabajo                               | Nadie, se ejecuta      |
| `verify.sh`        | **El sensor**: ejecuta, captura el fallo y lo busca en `playbook/` | Nadie, se ejecuta      |
| `init.sh`          | Comprueba que el entorno sirve                                     | Nadie, se ejecuta      |
| `runs/`            | Logs crudos de cada verificación (no se commitea)                  | `verify.sh`            |

Son tres memorias con tres destinos distintos al cerrar un feature:
`progress/<id>.md` **se borra** —llevaba el estado de un trabajo que ya terminó—,
`specs/<id>/` se conserva como la especificación de lo que existe, y `playbook/`
se conserva y se commitea porque es lo que el proyecto aprendió y no quiere
volver a aprender.

## Los agentes

| Agente            | Escribe             |
| ----------------- | ------------------- |
| `sdd-spec`        | `spec.md`           |
| `sdd-architect`   | `architecture.md`   |
| `sdd-designer`    | `design.md`         |
| `sdd-implementer` | código, `impl.md`   |
| `sdd-tester`      | pruebas, `tests.md` |

Cuándo entra cada uno no se decide aquí: se decide al repartir.
Sus instrucciones están en [`.claude/agents/`](../.claude/agents/). El criterio
con el que el orquestador los elige y los encadena, en
[`.claude/skills/sdd/SKILL.md`](../.claude/skills/sdd/SKILL.md) — este documento
describe **dónde vive el trabajo**, ese otro describe **cómo se reparte**.

## Al empezar una sesión

1. `bash .agent/sdd.sh start` — comprueba el entorno (debe terminar en
   `ENTORNO LISTO`) y muestra cómo va cada feature en curso: artefactos, ciclos
   de prueba, próximo paso concreto y última entrada de bitácora. Con un id
   (`start F-007`) muestra solo ese.
2. Leer `AGENTS.md` (convenciones) y `features.json` (backlog) completos.
3. Elegir un feature con `passes: false` cuyos `depends_on` estén todos en
   `true`. Si está sin empezar, `bash .agent/sdd.sh new F-007`.
4. `/sdd F-007` para que el orquestador tome el mando.

Una idea que todavía no es feature no se cuela en el backlog:
`bash .agent/sdd.sh propose <slug>` le da un sitio en `specs/propuestas/` hasta
que el humano decida.

## Durante el trabajo

Cada agente, al terminar, escribe su artefacto y anota la bitácora:

```bash
bash .agent/sdd.sh log F-007 sdd-architect <<'ENTRADA'
- Hizo: ...
- Escribió: .agent/specs/F-007/architecture.md (estado: listo)
- Deja pendiente: ...
- Siguiente agente sugerido: sdd-designer (motivo)
ENTRADA
```

La bitácora es append-only y es lo que permite que el siguiente agente —o la
siguiente sesión— continúe sin releer el hilo. El estado de los artefactos no se
anota a mano en ningún sitio: lo deriva `sdd.sh status` del frontmatter.

## Cuando algo falla

No hay una fase de «probar a ver»: hay un sensor. Después de **cada** intento de
cambio, quien lo hizo ejecuta:

```bash
bash .agent/verify.sh F-007          # typecheck · lint · format · test
bash .agent/verify.sh F-007 --full   # + harness · prisma · build · theme · bundle
bash .agent/verify.sh F-007 --smoke  # + la app levantada de verdad
bash .agent/verify.sh F-007 --only test   # una sola etapa, cuando ya sabes cuál
```

Corre las comprobaciones del CI —salvo las que necesitan Postgres, que solo se
ven allí— en orden de coste creciente, y se para en la primera que falla. Lo que hace entonces es el ciclo entero:

1. **Captura.** Guarda la salida cruda en `runs/<id>/` —traza del compilador,
   fallo de vitest, y con `--smoke` también lo que escribió el servidor— y la
   imprime sin resumir. El agente arregla sobre el error real, no sobre su
   recuerdo del error.
2. **Firma.** Extrae del log una firma estable (`lint:@typescript-eslint/no-explicit-any`,
   `build:Invalid revalidate value`). Dos fallos iguales dan la misma firma.
3. **Consulta.** Cruza esa salida contra el campo `firma` de cada ficha de
   [`playbook/`](playbook/README.md) e imprime las que la reconocen, **con su
   arreglo**. Media hora de depuración se convierte en leer cuatro líneas.
4. **Reintenta.** Sale con `1`: arregla y vuelve a ejecutar. Sin pedir permiso,
   sin preguntar al humano — el bucle es del agente.
5. **Corta.** A la tercera vez seguida con la **misma** firma sale con `2`:
   `ESTANCADO`. Insistir una cuarta no es diligencia. Vuelve el arquitecto, o el
   especificador, o se pregunta al humano.

Códigos de salida, que son el contrato del bucle: `0` pasa · `1` falla, sigue ·
`2` estancado, escala · `3` uso incorrecto.

### Lo que se aprendió no se pierde

Al pasar, el sensor comprueba si algún fallo de este ciclo se quedó sin explicar
y lo dice. Por cada uno, una de dos:

```bash
bash .agent/sdd.sh learn <slug>                        # volverá a pasar → ficha
bash .agent/verify.sh dismiss F-007 '<firma>' '<motivo>'  # fue un descuido
```

`sdd.sh done` **no cierra** el feature mientras quede alguno sin fichar ni
descartar, y anota lo resuelto en «Problemas resueltos en este ciclo» del
progreso. No es burocracia: `progress/<id>.md` se borra al cerrar, así que el
momento de escribir la lección es antes, mientras se recuerda.

Cuando una ficha aparece en dos features distintos, `bash .agent/sdd.sh playbook`
la marca como candidata a subir a `AGENTS.md` § «Cosas que muerden» — que es la
misma bitácora, leída **antes** de fallar en vez de después.

## Al cerrar una sesión

Obligatorio, **aunque el trabajo quede a medias**: actualizar `progress/<id>.md`,
con «Próximo paso concreto» relleno. Un progreso que dice «avanzando en el
handler» no sirve a nadie; uno que dice «implementar el caso 2(c) en
`src/features/sync/server/inbox.ts:47`, el test que lo cubre ya está escrito y
falla» permite que otra sesión continúe sin releer el hilo.

## Al completar un feature

En este orden, que importa:

1. El probador deja `veredicto: listo` en `tests.md`, y `progress/<id>.md` tiene
   una casilla marcada por **cada** `acceptance_criteria`, con el comando que lo
   verifica. No queda ningún fallo sin ficha ni descarte
   (`bash .agent/verify.sh pending <id>` vacío).
2. El humano pone `"passes": true` en `features.json`. Ese archivo es suyo y esa
   firma es el único punto donde alguien afirma que el feature existe.
3. `bash .agent/sdd.sh done <id>` comprueba las cuatro cosas y borra
   `progress/<id>.md`. `specs/<id>/` se conserva: es la especificación de lo que
   existe.

Al revés no: borrar el progreso con `passes: false` deja el feature indistinguible
de uno sin empezar (regla 6) y la sesión siguiente lo reempezaría encima de una
spec completa. El script se niega.

## Las reglas

Las del proyecto están donde siempre, en `rules` de
[`features.json`](features.json) — ahí se leen, ahí se cambian. Este sistema de
agentes solo añade tres:

- **Cada agente escribe únicamente su artefacto.** Ni el del vecino, ni
  `features.json`.
- **Un agente no habla con el humano.** Numera sus preguntas, las devuelve al
  orquestador y es él quien decide qué sube y dónde se anota la respuesta.
- **Nadie declara que algo funciona sin que `verify.sh` haya salido `0`.** Leer
  el código y concluir que debería funcionar no cuenta, ni siquiera cuando es
  evidente.
