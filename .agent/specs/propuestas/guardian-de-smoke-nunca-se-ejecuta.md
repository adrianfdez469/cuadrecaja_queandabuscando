---
propuesta: guardian-de-smoke-nunca-se-ejecuta
agente: sdd-spec
actualizado: 2026-09-01T02:49:28Z
estado: resuelta
---

> **RESUELTA el 2026-09-01, sin pasar por el backlog.** El humano eligió
> arreglarla con `/fix` en vez de abrir feature. Lo hecho: en `.agent/verify.sh`
> el `grep` pasó a ejecutarse antes del `rm` en las dos rutas, el patrón vive
> ahora en la constante `SERVIDOR_ERROR_RE` y exige que la línea empiece por algo
> acabado en `Error` con mayúscula (ERE POSIX puro, no el `\b` que proponía este
> documento: aquí corre BSD grep — ficha `playbook-firma-grep-bsd-no-gnu`), el
> guardián imprime siempre su `SMOKE FAIL`/`VISUAL FAIL` para que la firma sea
> estable, y con el servidor reutilizado el informe dice que NO se aplicó en vez
> de enseñar una sección vacía. La única excepción, documentada en el propio
> archivo, es el `AuthApiError: Refresh token is not valid` que registra
> `@supabase/auth-js` ante un token de refresco revocado. La lección quedó en
> `.agent/playbook/guardian-de-servidor-grep-tras-rm.md`. Este documento se
> conserva por su medición del radio, que no está en ningún otro sitio.

## Problema

`.agent/verify.sh` promete, en su propio comentario, que «un error en el
servidor cuenta como fallo aunque las peticiones respondan». Ese guardián
**nunca se ha ejecutado contra nada**. Borra el archivo antes de mirarlo:

```
.agent/verify.sh:293:  rm -f "$srvlog"
.agent/verify.sh:294:  # Un error en el servidor cuenta como fallo aunque las peticiones respondan.
.agent/verify.sh:295:  grep -aqE '(⨯|Unhandled|Error:)' "$srvlog" 2>/dev/null && code=1
```

El `grep` de la 295 busca en el archivo que la 293 acaba de borrar. `grep` sale
con **2** (no pudo abrirlo), el `2>/dev/null` se traga el «No such file or
directory», el `&&` no se cumple y `code=1` no se asigna jamás. El mismo par
está copiado literalmente en la etapa `--visual`: `.agent/verify.sh:379` borra y
`.agent/verify.sh:380` busca.

Comprobado ejecutando el patrón aislado, no leyéndolo:

```
$ srvlog="$(mktemp)"; printf '⨯ TypeError: ...\n' >"$srvlog"; code=0
$ grep -aqE '(⨯|Unhandled|Error:)' "$srvlog" 2>/dev/null && echo "grep CASA (salida $?)"
grep CASA (salida 0)
$ rm -f "$srvlog"
$ grep -aqE '(⨯|Unhandled|Error:)' "$srvlog" 2>/dev/null && code=1
$ echo "code=$code"; grep -aqE '(⨯|Unhandled|Error:)' "$srvlog" 2>/dev/null; echo "salida del grep: $?"
code=0
salida del grep: 2
```

**Nació roto y nunca funcionó un solo día.** `git log -S` sobre esa línea da dos
commits y ninguno la arregla:

- `87d8ce2` (2026-08-25, «chore: version the SDD harness and fix what blocked
  its loop») la introduce ya con el `rm -f` delante, en `correr_smoke`.
- `b7dafab` (2026-08-26, «feat(harness): verify screens with a headless
  browser») copia el bloque tal cual a `correr_visual`, con el defecto incluido.

Comprobado con `git show 87d8ce2:.agent/verify.sh` y
`git show b7dafab:.agent/verify.sh`.

Hoy hay **13** features con `.agent/specs/<ID>/smoke.sh` y **10** con
`.agent/specs/<ID>/visual.mjs`. En los 23 casos la protección está muerta.

La prueba empírica de que muerde de verdad está en
`.agent/specs/F-029/tests.md` § Fallos encontrados: un `⨯ TypeError` real del
servidor quedó en el log adjunto de `.agent/runs/F-029/006-smoke.log` y
`bash .agent/verify.sh F-029 --smoke` salió con código **0**.

### Lo que sí funciona, para no exagerar el diagnóstico

Guardar la salida del servidor en el log **sí** funciona. Es lo único que
prometen los documentos que leen los agentes: `.agent/README.md` («con `--smoke`
también lo que escribió el servidor») y `.agent/agents/sdd-tester.md` («guarda
también lo que escribió el servidor»). Ninguno de los dos promete que un error
en el log ponga la etapa roja — esa promesa vive **solo** en el comentario de la
línea 294. Es decir: lo que está roto es un guardián que nadie más documentó, y
por eso nadie ha echado de menos.

### Un segundo agujero, independiente, en `--visual`

Mover el `rm` no basta para `--visual`. Cuando `correr_visual` **reutiliza** el
`next dev` de este worktree (`.agent/verify.sh:337-341`), hace
`srvlog="$(mktemp)"` y `pid=""`: el archivo temporal nace vacío y nadie escribe
en él nunca, porque el servidor reutilizado escribe en la terminal de quien lo
levantó. El `tail -80` del log y el `grep` del guardián operan sobre un archivo
vacío.

Comprobado ejecutando: levanté un `next dev` en el puerto 3000 de este worktree,
le ensucié el log a propósito con `curl -H 'Cookie: qab-admin-session=no-es-un-jwt'
http://localhost:3000/admin` (1 línea `TypeError` confirmada con `grep -ac` sobre
la salida real del servidor), y a continuación:

```
$ bash .agent/verify.sh F-012 --visual --only visual
...
--- salida del servidor (runtime feedback) ---
--- fin del feedback ---
log completo: .agent/runs/F-012/004-visual.log
```

La sección de salida del servidor llegó **vacía** al log, con el error a la
vista en el servidor reutilizado. Así que en `--visual` el guardián tiene dos
defectos encadenados, y el segundo sobrevive al arreglo obvio.

## El radio de la explosión, medido

Ejecuté los `--smoke` de los 13 features que tienen guion, con el
`.agent/verify.sh` real y sin tocarlo, y conté en cada uno cuántas líneas de la
sección «salida del servidor» del log de `.agent/runs/<ID>/` casan con
`(⨯|Unhandled|Error:)` — que es exactamente lo que el guardián evaluaría si
mirase el archivo antes de borrarlo.

| Feature | Etapa `smoke` hoy | Líneas que casan | Con el guardián arreglado |
| ------- | ----------------- | ---------------- | ------------------------- |
| F-007   | roja              | 0                | roja igual                |
| F-010   | verde             | 0                | verde                     |
| F-011   | roja              | 0                | roja igual                |
| F-012   | **verde**         | **2**            | **roja**                  |
| F-017   | verde             | 0                | verde                     |
| F-018   | verde             | 0                | verde                     |
| F-019   | verde             | 0                | verde                     |
| F-023   | verde             | 0                | verde                     |
| F-025   | verde             | 0                | verde                     |
| F-026   | roja              | 0                | roja igual                |
| F-027   | verde             | 0                | verde                     |
| F-028   | verde             | 0                | verde                     |
| F-029   | **verde**         | **1**            | **roja**                  |

**El número que decide: de los 10 features cuya etapa `smoke` termina hoy en
verde, 2 se pondrían rojos. Ese es el coste de arreglarlo.** Los otros 3 (F-007,
F-011, F-026) ya están rojos por aserciones propias que fallan contra los datos
de este entorno, y el guardián no cambia nada para ellos.

### Los dos que se caen, con nombre

- **F-029** — `⨯ TypeError: Cannot read properties of null (reading 'storeIds')`
  al pedir `/admin` con una cookie ilegible, que su guion de humo pide a
  propósito. **Es el hallazgo 2**, y está escrito con su reproducción en
  `.agent/specs/propuestas/admin-page-asume-el-redirect-del-layout.md`. Es un
  fallo de código de F-011, no del guion ni de F-029.
- **F-012** — dos veces `Error [AuthApiError]: Refresh token is not valid` del
  cliente de Supabase Auth durante la corrida. Es un error real que hoy nadie
  mira, y hay que decidir si es un defecto de la sesión de cliente o ruido
  esperable del emulador cuando se cierra sesión.

### Lo que el radio medido NO cubre — dicho a propósito

1. **Es una cota inferior.** El guardián mira el `$srvlog` **entero**; el log de
   `.agent/runs/` solo guarda `tail -80` (`.agent/verify.sh:292`). Un error en
   el minuto uno de una corrida larga no está en mi medición y sí lo vería el
   guardián arreglado. Los verdes de la tabla son «no hay error en los últimos
   80 renglones», no «no hay error».
2. **`--visual` no está medido.** Son otros 10 guiones y, por el segundo agujero,
   el radio real depende de si el arreglo cubre también la ruta de reutilización.
   Es la parte del coste que sigo sin poder poner en un número, y lo digo en vez
   de estimarlo.
3. **Tres features (F-007, F-011, F-026) ya están rojos**, así que su radio no se
   pudo medir: no sé si además tienen errores en el log. Cuando se arreglen,
   pueden sumar.
4. Para llegar a medir hubo que acuñar `QAB_BEARER_TOKEN` en `.env`
   (`.agent/playbook/smoke-sin-token-de-sync.md`): sin él, 8 de los 13 abortaban
   en la primera aserción. `.env` quedó restaurado tal cual estaba.

### El patrón `(⨯|Unhandled|Error:)` está mal por los dos lados, y también está medido

F-012 no casa por lo que uno creería. Su log real dice:

```
Error [AuthApiError]: Refresh token is not valid
    at ignore-listed frames {
  __isAuthError: true,
  status: 400,
  code: 'validation_failed'
}
```

y los dos aciertos del patrón actual son las líneas `__isAuthError: true,`. La
línea que de verdad describe el error **no casa**. Comprobado ejecutando las dos
cadenas contra el `grep`:

```
$ printf '__isAuthError: true,\n' | grep -aqE '(⨯|Unhandled|Error:)' && echo CASA
CASA
$ printf 'Error [AuthApiError]: Refresh token is not valid\n' | grep -aqE '(⨯|Unhandled|Error:)' || echo "NO casa"
NO casa
```

O sea: `Error:` es una subcadena, y casa con **nombres de campo**
(`__isAuthError:`, `hasError:`, `onError:` …) mientras se le escapa la forma en
que Node imprime de verdad un error con nombre de clase. Un guardián que
resucite con este patrón dará falsos positivos por un identificador y falsos
negativos por el error que buscaba.

Probé un patrón alternativo sobre los mismos 13 logs, anclando el nombre de la
clase al principio de línea y quitando la subcadena suelta:

```
(⨯|Unhandled|^[[:space:]]*[A-Za-z]*Error\b)
```

Mismo veredicto por feature (2 rojos: F-012 y F-029, el resto igual), pero en
F-012 casa por las **dos líneas `Error [AuthApiError]:`** en vez de por los dos
`__isAuthError:`. Verificado ejecutando las dos cadenas de control: la del campo
deja de casar, la del error empieza a casar. No es la respuesta definitiva —solo
está medido contra estos 13 logs— pero muestra que la mejora es barata y que
esta discusión no se puede aplazar al arreglar el `rm`.

## Alcance

### Dentro

- Que el guardián de `correr_smoke` y el de `correr_visual` de
  `.agent/verify.sh` se ejecuten de verdad contra el log del servidor.
- Que cuando el guardián sea lo único que falla, **lo diga**: una línea
  `SMOKE FAIL` / `VISUAL FAIL` con lo que encontró (ver § Casos límite: sin ella
  el bucle del arnés se degrada).
- Que la ruta de reutilización de `--visual` capture la salida del servidor
  reutilizado, o que declare por escrito que no puede y no finja un archivo
  vacío.
- Revisar el patrón, con la medición de arriba encima de la mesa.
- Decidir qué se hace con los 2 features que el guardián pondría rojos.

### Fuera (explícito)

- **Arreglar `src/app/admin/page.tsx`.** Es la otra propuesta
  (`.agent/specs/propuestas/admin-page-asume-el-redirect-del-layout.md`) y se
  decide por separado, aunque haya que hacerla para que F-029 vuelva a verde.
- **Las demás etapas del sensor.** `typecheck`, `lint`, `format`, `test`,
  `prisma`, `build`, `theme`, `bundle` no tienen guardián de log y no lo
  necesitan.
- **Los códigos de salida del bucle** (`0` pasa · `1` falla · `2` estancado ·
  `3` uso incorrecto). El guardián sigue devolviendo `1`, como el resto.
- **Cambiar los guiones de humo de los features** para que dejen de provocar
  errores. Si un guion provoca un error a propósito, la conversación es sobre el
  guardián, no sobre el guion.
- **El CI.** `.github/workflows/ci.yml` no corre `--smoke` ni `--visual`; esto
  se juega entero en la máquina de quien desarrolla.
- **Silenciar errores del servidor en desarrollo** o cambiar el nivel de log de
  Next.

## Actores y precondiciones

**Actor**: cualquier agente que ejecute `bash .agent/verify.sh <ID> --smoke` o
`--visual` — es decir, `sdd-implementer` en cada intento y `sdd-tester` en cada
verificación. No hay actor de producto.

**Precondición**: el feature tiene su `smoke.sh` o su `visual.mjs`, y la app
levanta. Si no levanta, el camino es otro y ya funciona
(`SMOKE FAIL el servidor de desarrollo no llegó a levantar`).

## Comportamiento esperado

- **E1 — Error en el log, aserciones verdes.** Dado un `smoke.sh` cuyas
  aserciones pasan todas y un servidor que escribió `⨯ TypeError: …`, cuando
  corre `bash .agent/verify.sh <ID> --smoke`, entonces la etapa termina con
  código **1** y el log contiene una línea `SMOKE FAIL` que nombra lo que
  encontró.
- **E2 — Log limpio.** Dado el mismo guion con un servidor sin errores, entonces
  la etapa termina con **0** y el guardián no imprime nada. Ni una línea de
  ruido cuando no hay nada que decir.
- **E3 — Aserción caída y log sucio a la vez.** Dado un guion cuya aserción
  falla **y** un servidor con errores, entonces la etapa termina con 1 y la
  firma extraída es la del `SMOKE FAIL` de la **aserción**, no la del guardián:
  el fallo más específico manda, que es el orden que ya usa
  `extract_signature` (`.agent/verify.sh:67-80`).
- **E4 — Lo mismo en `--visual`.** Dado un `visual.mjs` cuyos pasos pasan y un
  servidor con errores, entonces la etapa termina en 1 con una línea
  `VISUAL FAIL`.
- **E5 — `--visual` reutilizando el servidor del worktree.** Dado un `next dev`
  ya levantado en este worktree y un error en su salida, entonces o el guardián
  lo ve, o el log dice explícitamente que no puede verlo en esta ruta. Lo que no
  vale es la situación de hoy: una sección «salida del servidor» vacía que
  parece limpia.
- **E6 — El guardián no cambia ninguna etapa que ya fuera roja.** Dado un
  feature cuya etapa `smoke` ya falla por una aserción, entonces sigue fallando
  igual y con la misma firma. Medido: F-007, F-011 y F-026 no tienen ninguna
  línea que case.

## Reglas de negocio

- **R1 — Ningún guardián se evalúa sobre un archivo que ya se borró.** Es el
  defecto literal y la regla que lo cierra.
- **R2 — Un fallo del sensor que no imprime su motivo no es un fallo, es un
  misterio.** Todo camino que ponga `code=1` escribe una línea con el prefijo
  que `extract_signature` reconoce (`SMOKE FAIL` / `VISUAL FAIL`).
- **R3 — La firma tiene que ser estable.** Dos corridas con el mismo error del
  servidor dan la misma firma, o el contador de `ESTANCADO`
  (`.agent/README.md` § Cuando algo falla, paso 5) deja de cortar a la tercera.
- **R4 — Un guardián verde por no haber mirado es peor que no tener guardián.**
  Es la misma razón por la que `correr_smoke` falla cuando falta el guion
  (`.agent/verify.sh:262-266`, «Verde sin ejecutar nada es peor que rojo»). El
  arnés ya tiene escrita esta regla; lo que falta es aplicársela a sí mismo.
- **R5 — Arreglar el sensor no puede dejar el repo en rojo sin plan.** Los 2
  features que se caen se arreglan, se descartan con
  `bash .agent/verify.sh dismiss <ID> <firma> <motivo>` o se decide que el
  patrón no debe cogerlos. Lo que no se hace es fusionarlo y ver qué pasa.

## Casos límite y errores

- **El guardián dispara solo, sin `SMOKE FAIL`** — es el caso de hoy si alguien
  se limita a mover el `rm`. `extract_signature` (`.agent/verify.sh:74`) busca
  `SMOKE FAIL.*`, no lo encuentra, y cae en `primera_linea_de_error`
  (`.agent/verify.sh:60-62`), que devuelve la primera línea del log que contenga
  `error|fail|✗|✘|not ok|Cannot|Unexpected`. En un log de humo eso puede ser
  cualquier cosa y **cambia entre corridas**: firma inestable, la bitácora de
  `.agent/playbook/` no reconoce nada, y `ESTANCADO` no llega a contar tres
  iguales. Por eso R2 no es cosmética.
- **`tail -80` frente al log entero**: el guardián y el log adjunto miran cosas
  distintas. Si el guardián falla por una línea que el `tail` recortó, el agente
  ve una etapa roja y un log adjunto limpio, que es la peor combinación posible.
  Quien lo arregle tiene que decidir esto (SP12).
- **Errores provocados a propósito por el guion.** El de F-029 pide `/admin` con
  una cookie basura porque su `architecture.md` § Pruebas se lo exige. Un
  guardián sano lo pondrá rojo mientras el bug de producto exista, y eso es
  correcto; pero la vía de escape tiene que existir y estar escrita.
- **El emulador de Supabase Auth escribe errores propios** durante un logout
  (`Error [AuthApiError]: Refresh token is not valid`, medido en F-012). Si eso
  resulta ser ruido esperable, el guardián necesita una lista de excepciones o
  el patrón necesita ser más estrecho. Decidirlo es parte del trabajo, no un
  detalle posterior.
- **Log binario o con secuencias ANSI**: el `-a` de `grep` ya lo contempla y no
  se toca.
- **Log vacío** (ruta de reutilización de `--visual`): con el `rm` movido, `grep`
  sobre un archivo vacío sale 1 y no asigna `code=1`. Sigue verde por no haber
  mirado — es exactamente R4, y por eso E5 está en el alcance.
- **`kill` del servidor a mitad**: el `wait` de `.agent/verify.sh:286` ya
  garantiza que el proceso terminó de escribir antes de leer el log. Con el `rm`
  movido, ese orden sigue siendo correcto.

## Datos y contrato

Ninguno. No toca el schema, ni `docs/sync-contract.md`, ni ninguna ruta HTTP. El
único contrato afectado es el del propio sensor: sus códigos de salida (`0`/`1`/
`2`/`3`) no cambian, y el prefijo de las líneas de fallo (`SMOKE FAIL`,
`VISUAL FAIL`) es el que ya consumen `extract_signature` y `match_playbook`.

## Criterios de aceptación propuestos

Todos `[nuevo]`. Escritos para copiarse tal cual a `.agent/features.json`.

1. `[nuevo]` `grep -n 'rm -f "$srvlog"' .agent/verify.sh` y
   `grep -n 'grep -aqE' .agent/verify.sh` muestran, en las dos funciones
   (`correr_smoke` y `correr_visual`), el `grep` **antes** del `rm`: ningún
   guardián se evalúa sobre un archivo borrado.
2. `[nuevo]` Con un `smoke.sh` de prueba cuyas aserciones pasan todas y una ruta
   que hace que el servidor escriba `⨯`, `bash .agent/verify.sh <ID> --smoke`
   sale con código **1** e imprime una línea que empieza por `SMOKE FAIL`.
3. `[nuevo]` Con el mismo guion y sin errores en el servidor, la misma orden sale
   **0** y `grep -c 'SMOKE FAIL' <log>` da 0.
4. `[nuevo]` Ejecutar dos veces seguidas el caso del criterio 2 produce la
   **misma** firma en las dos corridas —comprobable porque
   `bash .agent/verify.sh <ID> --smoke` a la tercera sale con código **2**
   (`ESTANCADO`), que es el contrato del bucle.
5. `[nuevo]` El equivalente de los criterios 2 y 3 para `--visual` con un
   `visual.mjs` cuyos pasos pasan: sale 1 con `VISUAL FAIL` si el servidor
   escribió `⨯`, y 0 si no.
6. `[nuevo]` Con un `next dev` ya levantado en el worktree y un `⨯` en su
   salida, `bash .agent/verify.sh <ID> --visual` **o** lo detecta (sale 1), **o**
   imprime en el log una línea que dice que en esta ruta no puede ver la salida
   del servidor. La sección «salida del servidor» no puede llegar vacía sin
   explicación.
7. `[nuevo]` Para los 13 features con `smoke.sh`, la etapa `smoke` de
   `bash .agent/verify.sh <ID> --smoke` termina con el mismo código que antes
   del cambio salvo en los dos que la medición de esta propuesta identificó
   (F-012 y F-029), y esos dos quedan resueltos: arreglados hasta verde, o
   descartados con `bash .agent/verify.sh dismiss <ID> …` y motivo escrito.
8. `[nuevo]` `bash .agent/verify.sh pending` no deja ningún fallo de este cambio
   sin ficha ni descarte.
9. `[nuevo]` `bash .agent/verify.sh --full` sale 0.

## Incongruencias detectadas

- **I1 — `.agent/verify.sh:262-266` ya escribió la regla que su propio guardián
  incumple**: «Verde sin ejecutar nada es peor que rojo» es el comentario que
  justifica fallar cuando falta el guion de humo. Treinta líneas más abajo, el
  guardián está verde por no ejecutar nada.
- **I2 — El comentario de la línea 294 describe una conducta que el guion no
  tiene.** Un comentario que afirma una garantía inexistente es lo que hace que
  seis días de features pasaran por encima sin que nadie mirase.
- **I3 — El patrón `Error:` no reconoce cómo Node imprime los errores con nombre
  de clase**, y sí reconoce nombres de campo. Medido arriba con las dos cadenas
  de control ejecutadas. Aunque se decida no arreglar el guardián, esta línea es
  incorrecta tal como está escrita.
- **I4 — `correr_visual` finge un archivo de log que nadie escribe.** En la ruta
  de reutilización, `srvlog="$(mktemp)"` con `pid=""` produce una sección
  «salida del servidor» vacía que se lee como «el servidor no dijo nada», cuando
  significa «nadie miró». Comprobado ejecutando (F-012, arriba).
- **I5 — Que este defecto durase seis días es en sí un dato sobre el arnés**: el
  sensor no tiene ninguna prueba de sí mismo. `.agent/verify.sh` verifica el
  repo entero y nada verifica a `.agent/verify.sh`. Ver SP13.

## Opciones, con recomendación

**Opción A — Arreglarlo y arreglar lo que destape.** Mover los dos `grep` antes
de los dos `rm`, añadir la línea `SMOKE FAIL`/`VISUAL FAIL` que exige R2, y
resolver los 2 features que se caen: F-029 vía la propuesta del `!` de
`/admin`, y F-012 decidiendo qué es el `AuthApiError`.
_Coste medido_: 2 features rojos que hay que arreglar, uno de ellos con arreglo
ya escrito y de dos líneas. Más lo que aparezca en `--visual`, que no está
medido.
_Lo que se gana_: el guardián empieza a hacer su trabajo, y el trabajo que hace
es el que ningún otro sensor cubre — un `⨯` en el servidor con las peticiones
respondiendo bien es invisible para `typecheck`, `lint`, `test` y `build`.

**Opción B — Arreglarlo y aflojar el patrón** hasta que los 13 vuelvan a verde
sin tocar ningún feature (por ejemplo, solo `⨯` y `Unhandled`; medido: con ese
patrón F-012 vuelve a verde y F-029 sigue rojo).
_Coste_: 1 feature rojo en vez de 2.
_Lo que se pierde_: el `AuthApiError` de F-012 vuelve a ser invisible sin que
nadie haya decidido que es aceptable. Es exactamente la forma de que dentro de
seis días haya que escribir otra propuesta como esta.

**Opción C — Dejarlo documentado y no arreglarlo**: borrar las dos líneas
muertas y su comentario, y anotar en `AGENTS.md` que un error en el servidor no
lo pesca nadie.
_Coste_: cero.
_Lo que se pierde_: todo. Es la única opción que empeora, porque hoy al menos el
comentario deja pista de la intención; sin él nadie vuelve a intentarlo.

**Recomiendo A, con el ajuste de patrón de B dentro del mismo cambio**: el
guardián se arregla, se estrecha el patrón al de la medición
(`(⨯|Unhandled|^[[:space:]]*[A-Za-z]*Error\b)`, que da el mismo veredicto por
feature y casa por la línea correcta), y los 2 rojos se resuelven con nombre y
apellido en vez de aflojando el umbral hasta que desaparezcan. El motivo es que
el radio salió **pequeño y conocido**: 2 de 10 verdes, uno de ellos con la
propuesta de arreglo ya escrita. Un radio de 2 es asumible; si hubieran salido
8, mi recomendación sería B con una lista de excepciones y un plan por feature.

**Orden recomendado**: primero
`.agent/specs/propuestas/admin-page-asume-el-redirect-del-layout.md` (dos líneas
de una página), después este. Así el guardián nace con un solo rojo pendiente y
no con dos.

## Huecos y preguntas al humano

**SP10 — ¿Se arregla el guardián sabiendo que pone rojos a F-012 y F-029?**
Qué falta: la decisión de fondo, y es del humano porque el coste no es técnico
sino de trabajo pendiente.
Por qué bloquea: es la propuesta entera.
Opciones: A, B o C de arriba.
**Recomiendo A** con el ajuste de patrón, por el radio medido: 2 de 10.

**SP11 — ¿Qué es el `Error [AuthApiError]: Refresh token is not valid` de
F-012?**
Qué falta: saber si es un defecto de la sesión de cliente o ruido del emulador
de Supabase Auth al cerrar sesión.
Por qué importa: decide si F-012 se arregla (opción A pura), se descarta con
`dismiss` y motivo, o justifica una lista de excepciones en el guardián.
Opciones: (a) investigarlo antes de arreglar el guardián, y entonces el arreglo
llega con los dos rojos resueltos; (b) arreglar el guardián y descartar F-012
con motivo escrito mientras se investiga; (c) considerarlo ruido esperable del
emulador y excluirlo por patrón.
**Recomiendo (a)**. Aparece dos veces por corrida en un camino de logout, que es
funcionalidad de F-012 en producción; darlo por ruido sin mirarlo es la decisión
que esta propuesta existe para no repetir. Si en diez minutos resulta ser del
emulador, (c) con el motivo escrito.

**SP12 — ¿El guardián mira el log entero o solo el `tail -80` que se adjunta?**
Qué falta: elegir, porque hoy divergen.
Por qué importa: si mira el entero, habrá etapas rojas cuyo motivo no está en el
log adjunto, y el agente no puede arreglar lo que no ve — que es lo contrario
del principio del arnés («el agente arregla sobre el error real»).
Opciones: (a) mirar el log entero y, cuando el guardián dispare, adjuntar
además las líneas que casaron; (b) mirar solo el `tail -80`, coherente con lo
adjuntado pero ciego a lo que pasó al principio; (c) subir el `tail` y mirar
todo.
**Recomiendo (a)**: es la única que no pierde detecciones y no deja al agente a
ciegas. Cuesta una línea más de `grep` en la salida.

**SP13 — ¿El sensor necesita pruebas propias?**
Qué falta: decidir si `.agent/verify.sh` gana un guion que lo ejercite.
Por qué importa: este defecto sobrevivió seis días y 23 guiones porque nada
comprueba al que comprueba (I5). Arreglarlo sin esto deja la misma puerta
abierta para el próximo guardián.
Opciones: (a) un feature aparte, con un `smoke.sh` de laboratorio que verifique
E1..E6 contra un guion de prueba; (b) los criterios 2-6 de arriba, verificados a
mano una vez por `sdd-tester` y ya; (c) nada.
**Recomiendo (b) ahora y (a) como propuesta separada.** Meter un arnés de
pruebas del arnés dentro de este cambio lo multiplica de tamaño y retrasa el
arreglo de una línea que lleva seis días esperando.

## No decidido a propósito

- **El patrón definitivo.** Propongo
  `(⨯|Unhandled|^[[:space:]]*[A-Za-z]*Error\b)` porque está medido contra los 13
  logs, no porque sea correcto en general. Quien implemente puede mejorarlo; lo
  que no puede es dejar el actual sin haber mirado la medición de I3.
- **Cómo capturar la salida del servidor reutilizado en `--visual`** (E5). Hay al
  menos tres formas —no reutilizar y levantar uno propio, pedirle al humano que
  redirija su `next dev` a un archivo, o declarar la limitación en el log— y la
  elección es de `sdd-architect`. Lo que esta propuesta fija es que la sección
  vacía sin explicación no vale.
- **Si el guardián debería distinguir errores del servidor de errores del
  cliente** que Next reenvía a la terminal. Hoy no distingue nada; si aparece un
  caso real, se decide entonces.
- **Si `.agent/playbook/` gana una ficha por esto.** `sdd-tester` lo dejó como
  candidata en `.agent/specs/F-029/tests.md` sin escribirla, con el argumento de
  que es un defecto latente del sensor y no una trampa que un agente vaya a
  repetir. Comparto el argumento; lo decide quien cierre el feature.
