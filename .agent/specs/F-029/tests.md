---
feature: F-029
agente: sdd-tester
actualizado: 2026-09-01T02:18:41Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno en el proyecto que le toca por extensión
(AGENTS.md § Cosas que muerden):

- **Unitario, proyecto `server` (node):** `src/lib/env.test.ts` y
  `src/lib/auth/adminSession.test.ts`, ya escritos por `sdd-implementer` y
  ejecutados aquí de nuevo tal cual, sin tocarlos.
- **Arnés:** `bash .agent/verify.sh F-029 --full` (harness · typecheck · lint ·
  format · test · prisma · build · theme · bundle).
- **Runtime, con la app levantada:** `.agent/specs/F-029/smoke.sh` (nuevo, este
  ciclo) y `.agent/specs/F-012/smoke.sh` (modificado este ciclo), los dos vía
  `bash .agent/verify.sh <ID> --smoke`.

Para el criterio 1 (`git status --porcelain` vacío tras `--write`) el árbol de
este worktree **no** parte limpio: trae cambios sin commitear de este mismo
ciclo (ver `git status --porcelain` en la sección Ejecuciones). El criterio no
exige un árbol limpio en términos absolutos — exige que el generador **no
ensucie nada versionado** — así que se verificó comparando `git status
--porcelain` **antes** y **después** de correr `--write`: si `.env` fuera
visible para git, `--write` lo añadiría a esa lista y el diff dejaría de ser
vacío. Se comprobó además con `git check-ignore .env` (sale 0) que `.env` está
fuera del árbol versionado por diseño, no por casualidad.

Para el criterio 6, la copia de `.env` sin las tres claves se hizo **en el
propio `.env` del worktree**, con las tres reemplazadas a `=""` mediante un
script de Node, ejecutando `bash .agent/init.sh` sobre ese estado y
restaurando el archivo original inmediatamente después (diff vacío,
confirmado).

Para la mitad negativa del criterio 9, se siguió al pie de la letra la
autorización del humano (PP3): copia de `.env` antes de tocarlo, `trap` que lo
restaura pase lo que pase (incluida una interrupción), y
`node scripts/dev-secrets.mjs --check` en 0 al terminar, ejecutado, como
prueba de que quedó como estaba.

## Mapa criterio → prueba

| #   | Criterio de aceptación (resumen)                                                                        | Prueba                                                                                                                                              | Archivo                                    | Resultado                                                |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| 1   | `--write` escribe las tres claves, sin duplicar, y `git status --porcelain` vacío después               | `--write` sobre el `.env` real; diff de `git status --porcelain` antes/después; `git check-ignore .env`; `grep -c` por clave tras repetir `--write` | `scripts/dev-secrets.mjs`                  | PASA                                                     |
| 2   | Sin `--write`, imprime por stdout y no toca ningún archivo                                              | `stat -f "%m %z" .env` antes/después de correr sin banderas                                                                                         | `scripts/dev-secrets.mjs`                  | PASA                                                     |
| 3   | `npx vitest run src/lib/env.test.ts` en 0, con los dos casos exigidos                                   | Ejecutado tal cual                                                                                                                                  | `src/lib/env.test.ts`                      | PASA (6/6)                                               |
| 4   | `npx vitest run src/lib/auth/adminSession.test.ts` en 0, con el caso exigido                            | Ejecutado tal cual                                                                                                                                  | `src/lib/auth/adminSession.test.ts`        | PASA (2/2)                                               |
| 5   | Ninguna de las tres claves asignada a `""` en `.env.example`                                            | `grep -nE '^(SSO_JWT_SECRET\|ADMIN_SESSION_SECRET\|CRON_SECRET)=' .env.example`; `grep -n` de los tres nombres en comentarios                       | `.env.example`                             | PASA (sin coincidencias; 2+1+1 menciones en comentarios) |
| 6   | Con las tres sin valor, `init.sh` sigue en `ENTORNO LISTO` y nombra el generador                        | `.env` con las tres a `""`, `bash .agent/init.sh`, restaurado después                                                                               | `.agent/init.sh`                           | PASA                                                     |
| 7   | Sesión de admin real → 200 en `/admin`, sin tocar `.env` a mano ni revertir nada                        | `bash .agent/verify.sh F-029 --smoke`                                                                                                               | `.agent/specs/F-029/smoke.sh` (nuevo)      | PASA                                                     |
| 8   | `bash .agent/verify.sh F-029 --full` en 0                                                               | Ejecutado tal cual                                                                                                                                  | —                                          | PASA (código 0)                                          |
| 9   | F-012 deja de saltar el criterio 5; con `ADMIN_SESSION_SECRET` vacío, falla duro nombrando el generador | `bash .agent/verify.sh F-012 --smoke` (positivo) y con `ADMIN_SESSION_SECRET=""` + trap (negativo)                                                  | `.agent/specs/F-012/smoke.sh` (modificado) | PASA (las dos mitades)                                   |

Los 9 tienen fila. Ninguno se disimuló.

## Ejecuciones

### Criterio 1 — generador `--write`

```
$ git status --porcelain > /tmp/gs_before.txt
$ node scripts/dev-secrets.mjs --write
Wrote 0 secret(s), kept 3 already meeting the minimum.
$ git status --porcelain > /tmp/gs_after.txt
$ diff /tmp/gs_before.txt /tmp/gs_after.txt
(sin diferencias)
$ git check-ignore .env; echo "exit=$?"
.env
exit=0
$ for k in SSO_JWT_SECRET ADMIN_SESSION_SECRET CRON_SECRET; do echo "$k: $(grep -c "^${k}=" .env)"; done
SSO_JWT_SECRET: 1
ADMIN_SESSION_SECRET: 1
CRON_SECRET: 1
```

`git status --porcelain` es exactamente el mismo antes y después de `--write`
(el árbol traía cambios de este ciclo, y siguen siendo los mismos: ninguno
nuevo, ninguno menos). `.env` está fuera del árbol versionado
(`git check-ignore` sale 0). Cada clave aparece una sola vez tras la corrida
— no duplicó líneas. Ya lo había verificado `sdd-implementer` regenerando con
`--force` y repitiendo `--write`; se repitió aquí sin desviarse.

### Criterio 2 — sin `--write`

```
$ STAT_BEFORE=$(stat -f "%m %z" .env)
$ node scripts/dev-secrets.mjs
SSO_JWT_SECRET="<64 caracteres base64url, redactado — R1: nada con forma de clave en un archivo versionado>"
ADMIN_SESSION_SECRET="<ídem, valor distinto>"
CRON_SECRET="<ídem, valor distinto>"
$ STAT_AFTER=$(stat -f "%m %z" .env)
$ [ "$STAT_BEFORE" = "$STAT_AFTER" ] && echo "sin cambios"
sin cambios
```

Código de salida 0, tres líneas por stdout, `.env` con el mismo `mtime` y
tamaño exactos.

### Criterio 3

```
$ npx vitest run src/lib/env.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Código de salida 0.

### Criterio 4

```
$ npx vitest run src/lib/auth/adminSession.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Código de salida 0.

### Criterio 5

```
$ grep -nE '^(SSO_JWT_SECRET|ADMIN_SESSION_SECRET|CRON_SECRET)=' .env.example; echo "exit=$?"
exit=1
$ grep -n "SSO_JWT_SECRET\|ADMIN_SESSION_SECRET\|CRON_SECRET" .env.example
75:# SSO_JWT_SECRET   — shared secret cuadrecaja uses to sign one-time admin SSO
77:#                    own SSO_JWT_SECRET exactly — the generator above KEEPS a
81:# ADMIN_SESSION_SECRET — secret this app uses to sign its own admin session
84:# CRON_SECRET      — checked by Vercel cron routes. Optional: genuinely
```

Sin coincidencias de asignación (el `grep` de la aserción sale 1 — no hay
matches), las tres nombradas en comentarios.

### Criterio 6

```
$ node -e '... reemplaza las tres a "" en .env ...'
$ grep -nE '^(SSO_JWT_SECRET|ADMIN_SESSION_SECRET|CRON_SECRET)=' .env
69:SSO_JWT_SECRET=""
73:ADMIN_SESSION_SECRET=""
77:CRON_SECRET=""
$ bash .agent/init.sh
...
== Secretos de desarrollo ==
  ! sin generar o por debajo del mínimo: SSO_JWT_SECRET ADMIN_SESSION_SECRET CRON_SECRET — ejecuta: node scripts/dev-secrets.mjs --write
...
ENTORNO LISTO
$ echo $?
0
$ cp "$WORKDIR/.env.orig" .env && diff "$WORKDIR/.env.orig" .env && echo "RESTORED OK"
RESTORED OK
```

`ENTORNO LISTO`, código 0, la línea nombra el generador con el comando
completo (`node scripts/dev-secrets.mjs --write`), no solo «sin valor en
.env». `.env` quedó restaurado byte a byte.

### Criterio 7 y sesgo del smoke de F-029

```
$ bash .agent/verify.sh F-029 --smoke
== Verificación F-029 · intento 6 ==
  ✓ typecheck  ...
  ✓ smoke      2s
PASA
```

Log completo (`.agent/runs/F-029/006-smoke.log`):

```
  ok   GET /admin sin cookie redirige (307, src/proxy.ts)
  ok   GET /admin/sso?token=... canjea el token (307 a /admin)
  ok   GET /admin con la cookie de sesión responde 200
  ok   GET /admin con cookie basura vuelve a redirigir (307)
  ok   sha256(.env) idéntico al empezar y al terminar

0 aserciones fallidas
```

Verificado también, por separado, que la fila de `SsoTokenUse` que este humo
crea desaparece al terminar (consulta directa a la base antes/después de la
corrida: 1 fila preexistente de una sesión anterior, 0 filas nuevas tras la
limpieza).

**Ver § Fallos encontrados**: el `--check` del servidor (línea "GET /admin con
cookie basura") deja, además del 307 correcto, un `⨯ TypeError` real en el log
del servidor — no es un fallo de este feature ni de este guion, es un hallazgo
aparte, reportado abajo, y no afecta el veredicto de este criterio porque la
petición con la cookie **válida** (la que de verdad prueba el criterio 7) está
limpia, aislada y confirmada sin ningún error en el log (ver evidencia en
Fallos encontrados).

### Criterio 8

```
$ bash .agent/verify.sh F-029 --full
== Verificación F-029 · intento 7 ==
  ✓ harness    0s
  ✓ typecheck  3s
  ✓ lint       4s
  ✓ format     6s
  ✓ test       14s
  ✓ prisma     1s
  ✓ build      6s
  ✓ theme      0s
  ✓ bundle     0s
PASA
$ echo $?
0
```

### Criterio 9 — las dos mitades

**Mitad positiva** (las tres claves generadas):

```
$ bash .agent/verify.sh F-012 --smoke
== Verificación F-012 · intento 1 ==
  ✓ smoke      6s
PASA
$ grep -n "SALTADO\|criterio 5" .agent/runs/F-012/001-smoke.log
  ok   criterio 5 — logout de cliente no manda Set-Cookie para qab-admin-session
  ok   criterio 5 — logout de cliente SÍ borra qab-shopper-auth
  ok   criterio 5 — /admin en 200 con sesión de CLIENTE real presente a la vez
  ok   criterio 5 — /cuenta en 200 con sesión de ADMIN real presente a la vez
  ok   criterio 5 — /admin sigue en 200 tras cerrar la sesión de cliente
  ok   criterio 5 — /cuenta ahora exige entrar (307): la sesión de cliente SÍ se cerró
```

Las cuatro aserciones del criterio 5 corrieron incondicionalmente (ya no hay
rama `if`) y ninguna línea de la salida dice `SALTADO` para ese criterio.
Código de salida 0.

**Mitad negativa** (`ADMIN_SESSION_SECRET` vacío, PP3 — copia + `trap` +
verificación final):

```
$ cp .env "$BACKUP"
$ trap 'cp "$BACKUP" .env; echo "RESTORED via trap"' EXIT INT TERM
$ node -e '... ADMIN_SESSION_SECRET="" en .env ...'
$ bash .agent/verify.sh F-012 --smoke
== Verificación F-012 · intento 2 ==
  ✗ smoke      2s  (salida 1)
FALLA en smoke.
SMOKE FAIL node scripts/dev-secrets.mjs --check salió 1 (faltan o son cortas: ADMIN_SESSION_SECRET ) — genera los secretos con: node scripts/dev-secrets.mjs --write
$ echo $? # del verify.sh
1
RESTORED via trap
$ grep -n "^ADMIN_SESSION_SECRET=" .env
ADMIN_SESSION_SECRET="<64 caracteres base64url, redactado — el mismo valor de antes de vaciarlo>"
$ node scripts/dev-secrets.mjs --check; echo "check exit=$?"
check exit=0
```

Código de salida distinto de 0 (1), línea `SMOKE FAIL` que nombra el
generador (`node scripts/dev-secrets.mjs --check` / `--write`), el `.env`
restaurado por el `trap` incluso sin que el resto del guion llegara a correr
(el guardián abortó antes de la primera aserción, tal como pide PP2), y
`node scripts/dev-secrets.mjs --check` en 0 al final, ejecutado, como prueba
de que quedó exactamente como antes. Las tres condiciones de la autorización
del humano se cumplieron y se ejecutaron, no se leyeron.

El intento 2 de F-012 quedó registrado en su bitácora de fallos
(`bash .agent/verify.sh pending F-012`) y se descartó explícitamente por ser
la conducta exigida, no un defecto:

```
$ bash .agent/verify.sh dismiss F-012 'smoke:SMOKE FAIL node scripts/dev-secrets.mjs --check salió 1 (faltan o son cortas: ADMIN_SESSION_SECRET ) — genera ' \
  "Fallo intencional: verificación ejecutada de la mitad negativa del criterio 9 de F-029 (ADMIN_SESSION_SECRET vaciado a propósito, con copia+trap, autorizado por PP3). No es un defecto: es la conducta exigida por el criterio."
Descartado para F-012: ...
$ bash .agent/verify.sh pending F-012
(vacío)
```

### `bash .agent/verify.sh pending F-029`

```
$ bash .agent/verify.sh pending F-029
(vacío)
```

Ningún fallo de F-029 quedó sin ficha ni descarte.

## Fallos encontrados

### 1 — Bug de producto: `⨯ TypeError` real al pedir `/admin` con una cookie de sesión ilegible

**Severidad:** media. No cambia la respuesta HTTP que ve el navegador (sigue
siendo 307, correcto), pero deja una excepción no controlada en el log del
servidor en un camino que **cualquier** visita con una cookie
`qab-admin-session` corrupta o caducada dispara — no hace falta ningún ataque,
basta una cookie vieja de una versión anterior del secreto.

**Reproducción exacta**, aislada de cualquier otra petición:

```
$ curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: qab-admin-session=no-es-un-jwt' http://localhost:3100/admin
307
```

Log del servidor para esa única petición:

```
⨯ TypeError: Cannot read properties of null (reading 'storeIds')
    at listManagedStores (src/features/admin/server/stores.ts:33:15)
    at AdminHomePage (src/app/admin/page.tsx:12:41)
```

**Archivo:línea sospechoso:** `src/app/admin/page.tsx:11-12` —

```ts
// The layout already redirects when there is no session.
const session = (await getAdminSession())!;
```

El comentario asume que si `AdminHomePage` llega a ejecutarse, `AdminLayout`
(`src/app/admin/layout.tsx:10-11`) ya validó la sesión y, si no había,
redirigió. Con una cookie **presente pero inválida**, ambos componentes
llaman a `getAdminSession()` por separado; el layout obtiene `null` y llama a
`redirect()`, pero `AdminHomePage` también se evalúa (aparentemente en
paralelo, antes de que el `redirect()` del layout gane la carrera) con su
propia llamada a `getAdminSession()`, que también da `null`, y el `!` de la
línea 11 lo fuerza sin comprobar — de ahí el `TypeError` en
`listManagedStores` (`src/features/admin/server/stores.ts:33`), que recibe
`session === null` en vez de un objeto.

Confirmado **aislado** (sin ninguna otra petición antes ni después) y
**reproducible al 100%** en tres corridas distintas. La petición con una
cookie **válida** —la que de verdad ejercita el criterio 7 de este feature—
se confirmó limpia por separado, sin ningún error en el log:

```
$ curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: $ADMIN_COOKIE" http://localhost:3100/admin
200
(log del servidor: sin ninguna línea de error)
```

**No es de F-029.** `src/app/admin/page.tsx` y
`src/features/admin/server/stores.ts` son de F-011, ya cerrado, y F-029 no los
toca (tampoco están en su alcance). Lo que hizo visible el bug es el paso 6
del guion de humo de F-029 (la cookie basura, exigida por `architecture.md` §
Pruebas para separar «cookie presente» de «cookie válida») — el mismo tipo de
petición que ya hacía `.agent/specs/F-012/smoke.sh` con
`qab-shopper-auth=smoke-garbage-session` para el lado de cliente, pero nadie
lo había probado antes con `qab-admin-session`.

**A quién vuelve:** `sdd-implementer` (o quien retome el panel de
administración de F-011), para que `AdminHomePage` deje de asumir el trabajo
del layout — comprobar `session` explícitamente en la página, o encontrar por
qué el layout y la página no se serializan como el comentario asume bajo Next
16 / React 19.

**Lección:** no fichada por mí — es un fallo de código de producto ajeno a
este ciclo, no una trampa de este repo o de su arnés. Queda descrita aquí,
con `archivo:línea` y reproducción, para quien la reciba.

### 2 — El guardián de "error en el log" de `.agent/verify.sh` nunca se ejecuta contra nada

**Severidad:** alta, transversal a todo el repo — no es un fallo de F-029, es
un defecto en el sensor compartido que hace inútil la protección que
`AGENTS.md`, `architecture.md` § D3 y el propio `sdd-tester.md` dan por
garantizada.

En `correr_smoke()` (`.agent/verify.sh:259-296`) y su análogo de `--visual`
(`.agent/verify.sh:379-380`), el archivo temporal con la salida del servidor
se borra **antes** de comprobarlo:

```
.agent/verify.sh:293:  rm -f "$srvlog"
.agent/verify.sh:295:  grep -aqE '(⨯|Unhandled|Error:)' "$srvlog" 2>/dev/null && code=1
```

El `grep` de la línea 295 corre sobre un archivo que la línea 293 ya borró.
Como el `2>/dev/null` silencia el «No such file or directory», `grep` sale
por fallo (nada que buscar) y `code=1` **nunca** se asigna por esta vía: la
etapa `smoke`/`visual` puede terminar en verde aunque el servidor haya
escrito `⨯ TypeError` o `Unhandled` real durante la corrida — exactamente lo
que pasó en este ciclo con el Fallo 1 de arriba, que `bash .agent/verify.sh
F-029 --smoke` reportó como `PASA` pese al `TypeError` visible en el propio
log adjunto.

**Reproducción:** cualquier `--smoke` o `--visual` cuyo servidor escriba
`⨯`/`Unhandled`/`Error:` en algún punto de la corrida seguirá saliendo en
verde si las aserciones del guion en sí no lo detectan. Confirmado con este
mismo F-029: `.agent/runs/F-029/006-smoke.log` contiene el `TypeError` textual
y `bash .agent/verify.sh F-029 --smoke` salió con código 0.

**A quién vuelve:** no encaja en ninguno de los cuatro destinatarios de mi
guía (spec/architect/designer/implementer de un feature) porque es
infraestructura compartida, no código de ningún feature — se lo devuelvo al
orquestador para que decida quién lo arregla (mover el `rm -f` después del
`grep`, en las dos ocurrencias). No lo arreglo yo: `.agent/verify.sh` no está
en mi alcance de este ciclo y tocar el sensor compartido a mitad de la
verificación de un feature no es lo que se me pidió.

**Lección:** candidata a ficha de `.agent/playbook/`, pero no la escribo yo
—no es un fallo de F-029 ni algo que "vuelva a pasar" en el sentido de un
error que yo cometí y otro agente repetirá— sino un defecto latente del
sensor que el orquestador debe fichar o asignar. Lo dejo escrito aquí con la
reproducción completa para que quien lo reciba no tenga que redescubrirlo.

## Huecos de cobertura

- El aviso de `console.warn` de `src/lib/env.ts` en un `next dev` real, con
  las tres claves rotas, no se ejerció en el smoke de F-029: el guion aborta
  antes de levantar ninguna petición si el guardián falla (por diseño, R10).
  Queda cubierto por `src/lib/env.test.ts` (R7/R8) y por la mitad negativa del
  criterio 9 contra F-012, que sí levanta el servidor con `ADMIN_SESSION_SECRET`
  vacío — pero esa corrida aborta en el guardián de `--check` antes de tocar
  ninguna ruta, así que tampoco llega a ejercitar el `[env] Invalid server
environment` de una petición HTTP real. No es un hueco grave: el camino
  `serverEnv()` → `console.warn` → `throw` está probado de punta a punta por
  los dos archivos `*.test.ts`, con `vi.resetModules()` y `await import()`
  dentro de cada caso — ejecutando el código real, no una simulación.
- El Fallo 1 (`⨯ TypeError` en `/admin` con cookie ilegible) no se investigó
  más allá de aislar la petición y confirmar que es reproducible: no se
  determinó la causa exacta de la carrera entre `AdminLayout` y
  `AdminHomePage` bajo Next 16.3.2/React 19 (Turbopack), porque tocar o
  instrumentar ese código está fuera de mi alcance en este ciclo.

## Veredicto

**`listo`.** Los 9 criterios de `.agent/features.json` se verificaron
ejecutando algo real y observando su resultado — ningún criterio se dio por
bueno leyendo código. `bash .agent/verify.sh F-029 --full` termina en 0,
`bash .agent/verify.sh F-029 --smoke` termina en 0, y las dos mitades del
criterio 9 contra `.agent/specs/F-012/smoke.sh` se ejecutaron con su resultado
real (positivo: 0, sin `SALTADO`; negativo: distinto de 0, con `SMOKE FAIL`
nombrando el generador). `bash .agent/verify.sh pending F-029` queda vacío.

Los dos fallos de la sección anterior no bloquean este veredicto: ninguno de
los 9 criterios de F-029 depende de ellos para pasar, y los dos son ajenos al
código que este feature construyó (uno es de F-011, cerrado; el otro es del
propio sensor `.agent/verify.sh`, compartido por todo el repo). Se devuelven
con su destinatario en vez de esconderse o arreglarse aquí.

## Preguntas al humano

Ninguna que bloquee el veredicto de F-029. Los dos hallazgos de § Fallos
encontrados no son preguntas: son fallos con destinatario y evidencia
ejecutada, listos para que el orquestador los enrute.
