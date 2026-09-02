---
feature: F-030
agente: sdd-tester
actualizado: 2026-09-02T02:16:21Z
estado: listo
veredicto: listo
---

## Estrategia

Dos mitades, como fija `spec.md` § «Cómo se provoca el fallo y se demuestra la
detección»:

- **Determinista, proyecto `node` de Vitest** (`*.test.ts`, `AGENTS.md`
  § Cosas que muerden): `src/features/account/server/orderIdentity.test.ts`.
  Sin Docker, sin red, sin Postgres. Cubre los criterios 6, 7 y 9.
- **De verdad, contra el Auth real de F-028**: `bash .agent/verify.sh F-030
--probe`, que ejecuta `scripts/order-link-probe.mjs` con un proxy lento
  delante de Supabase Auth y su propio `next dev`. Cubre los criterios 1, 2, 3,
  4, 5, 9 y 10.
- **De frontera con otros features**: `git grep` sobre `cookies()`,
  `boundaries.test.ts` y `bash .agent/verify.sh F-012 --smoke` (criterio 8).
- **De cierre**: `npm run check:bundle` + `git diff` del presupuesto
  (criterio 11) y `bash .agent/verify.sh F-030 --full` (criterio 12).

Todo lo de abajo se ejecutó de verdad, en este equipo, el 2026-09-02, con el
worktree limpio salvo lo que ya estaba (`.agent/solicitudes.*`,
`.agent/README.md`, `.agent/init.sh`, `scripts/check-harness.mjs`, `.gitignore`,
`.claude/skills/sdd/SKILL.md`, F-033 nuevo en `features.json`), que no toqué.
Ningún otro `next dev` de este worktree apareció durante la sesión (sí uno
ajeno, de `cuadrecaja/seadragon`, en el puerto 3000 — `servidor_propio()`
lo ignora porque compara el `cwd` del proceso, y lo comprobé leyéndolo con
`lsof -a -p <pid> -d cwd`).

## Mapa criterio → prueba

| #   | Criterio de aceptación (resumen)                                                           | Prueba                                                                                | Archivo                           | Resultado                                                                                 |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Auth retrasado sobre el techo → 201, `customerId` NULL, línea `timeout` con el techo en ms | Corrida D del probe                                                                   | `scripts/order-link-probe.mjs`    | **LISTO** — ver § Ejecuciones                                                             |
| 2   | Sin retraso, queda enlazado y sin línea                                                    | Corrida B del probe                                                                   | ídem                              | **LISTO**                                                                                 |
| 3   | Los tres `NULL` (nada / `unverified` / `timeout`) son distinguibles                        | Corridas E y D                                                                        | ídem                              | **LISTO**                                                                                 |
| 4   | Aviso temprano (`slow`) al pasar el umbral sin agotar el techo                             | Corrida C + caso unitario `slow`                                                      | ídem + `orderIdentity.test.ts`    | **LISTO**                                                                                 |
| 5   | `late` con `lateMs > 0`, después de la respuesta                                           | Corrida D (línea `late`) + caso unitario `late`                                       | ídem                              | **LISTO**                                                                                 |
| 6   | Pruebas unitarias, sin Docker, un caso por desenlace                                       | `npx vitest run .../orderIdentity.test.ts`                                            | ídem                              | **LISTO** — 15 passed (6 preexistentes + 9 nuevos, uno por fila de la tabla de `spec.md`) |
| 7   | Medir no retrasa el pedido; invitado sin llamadas                                          | Casos unitarios «resolución colgada» y «guest, 0 llamadas» + corrida D (delta vs. B)  | ídem                              | **LISTO**                                                                                 |
| 8   | F-010 y F-012 intactos                                                                     | `git grep`, `boundaries.test.ts`, `verify.sh F-012 --smoke`                           | —                                 | **LISTO**                                                                                 |
| 9   | Auth sin configurar → cero líneas                                                          | Corrida F (con precondición `signin-disabled-aviso`) + caso unitario «sin configurar» | ídem                              | **LISTO**                                                                                 |
| 10  | Cero PII/credenciales en toda línea                                                        | Corrida G del probe (los cuatro valores: correo, `user.id`, `Customer.id`, cookie)    | ídem                              | **LISTO** — ver § Ejecuciones y § Fallos encontrados (F1, resuelto)                       |
| 11  | `check:bundle` en 0 sin subir `BUDGET_KB`                                                  | `npm run check:bundle` + `git diff --stat`                                            | `scripts/check-bundle-budget.mjs` | **LISTO**                                                                                 |
| 12  | `verify.sh F-030 --full` en 0                                                              | `bash .agent/verify.sh F-030 --full`                                                  | —                                 | **LISTO**                                                                                 |

Ningún criterio quedó sin fila.

## Ejecuciones

### Determinista

```
$ npx vitest run src/features/account/server/orderIdentity.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

15 = 6 preexistentes (D6/R14 de F-012, sin tocar) + 9 nuevos: guest 0-líneas,
enlace normal 0-líneas, `slow`, `timeout`, `late`, `unverified`, `no_customer`,
`error` (sin mensaje ni clase de la excepción — comprobado con
`Object.keys(fields).sort()` y `JSON.stringify(fields)).not.toMatch(/boom|abc123/)`),
y «Auth sin configurar» (0 líneas). Corresponde exactamente a la tabla de 9
filas de `spec.md` § «Mitad determinista».

### Probe (corridas A–G), dos corridas independientes vía el sensor

```
$ bash .agent/verify.sh F-030 --probe      # intento 19
  ✓ typecheck  3s
  ✓ lint       9s
  ✓ format     14s
  ✓ test       45s
  ✓ probe      12s
PASA

$ bash .agent/verify.sh F-030 --probe      # intento 20, repetido para intermitencia
  ✓ typecheck  3s
  ✓ lint       10s
  ✓ format     14s
  ✓ test       44s
  ✓ probe      12s
PASA
```

Las dos corridas dieron `0 aserciones fallidas de A-G` y cero `PROBE FAIL`
(`.agent/runs/F-030/019-probe.log`, `.../020-probe.log`). No es intermitente:
además de estas dos corridas oficiales corrí el guion dos veces más a mano (ver
§ Fallos encontrados, la variante instrumentada) — cuatro corridas completas en
total, las cuatro verdes, mismos resultados.

Leí **yo** la salida cruda del servidor capturada en `019-probe.log`
(`--- salida del servidor (runtime feedback) ---`), no solo el resumen del
guion:

- **Corrida B (criterio 2), mirado con lupa**: entre la línea `POST
/api/orders/quote` de A y la siguiente de C no aparece ninguna línea
  `[orders] customer link` para el pedido de B (línea 61 del log:
  `POST /api/orders 201 in 286ms`, sin nada de `[orders]` antes ni después). El
  detector de verdad se queda callado en el caso bueno, no solo porque el guion
  lo diga.
- **Corrida D / criterio 5, mirado con lupa**: el orden real en el log es
  `timeout` (línea 66) → `POST /api/orders 201` (línea 67) → `late` (líneas
  68–74, `lateMs: 949`, `resolved: true`). La línea tardía sale **después** de
  la respuesta, no antes, exactamente lo que el criterio exige.
- **Corrida F / criterio 9, mirado con lupa**: la precondición
  `signin-disabled-aviso` se comprobó contra el HTML real de
  `/cuenta/entrar` tras el rearranque con las `NEXT_PUBLIC_SUPABASE_*` vacías
  (línea 89: `GET /cuenta/entrar 200`), y entre esa línea y la siguiente
  (`POST /api/orders 201` en la línea 91) no hay ninguna línea `[orders]`. La
  única línea que aparece después es `[realtime] bell not emitted { reason:
'missing_supabase_url' }` — un `console.warn` de otro feature, no dispara el
  guardián (no empieza por algo acabado en `Error`) y no es del prefijo que se
  busca.

### Frontera con F-010 y F-012 (criterio 8)

```
$ git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"
(sin salida, exit 1 — sin coincidencias)

$ npx vitest run src/features/account/boundaries.test.ts
 Tests  4 passed (4)

$ bash .agent/verify.sh F-012 --smoke
  ✓ typecheck  3s
  ✓ lint       10s
  ✓ format     14s
  ✓ test       49s
  ✓ smoke      11s
PASA
```

Leí `.agent/runs/F-012/001-smoke.log`: aparecen **dos** líneas nuevas,

```
[orders] customer link { outcome: 'unverified', elapsedMs: 4, ceilingMs: 600 }
[orders] customer link { outcome: 'unverified', elapsedMs: 30, ceilingMs: 600 }
```

de la cookie basura que `.agent/specs/F-012/smoke.sh` ya mandaba, y la etapa
`smoke` sigue en verde: la consecuencia buscada por `spec.md` § Casos límite
(«Cookie basura») ocurre de verdad y no rompe nada.

### Cierre (criterios 11 y 12)

```
$ git diff --stat scripts/check-bundle-budget.mjs
(vacío)

$ npm run check:bundle
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 177.6 KB gzipped (budget 193 KB)

$ bash .agent/verify.sh F-030 --full     # intento 29, tras el arreglo de F1
  # (el 28 falló en harness: una cita entre comillas invertidas que yo mismo
  #  dejé en este archivo al escribir la re-verificación de F1, corregida y
  #  descartada — ver el párrafo siguiente)
  ✓ harness    0s
  ✓ typecheck  3s
  ✓ lint       9s
  ✓ format     14s
  ✓ test       44s
  ✓ prisma     2s
  ✓ build      7s
  ✓ theme      0s
  ✓ bundle     0s
PASA
```

**El intento 28, autoinfligido, y no aquí.** Al anotar la bitácora de este
ciclo con `bash .agent/sdd.sh log F-030 sdd-tester` cité entre comillas
invertidas, dentro de `.agent/progress/F-030.md`, la ruta del mismo guion de
usar y tirar que ya había borrado — la trampa exacta que ya había arreglado en
`tests.md` minutos antes, repetida en el archivo hermano. `npm run
check:harness` volvió a poner roja la primera etapa de `--full`. La corregí
igual: reescribí esa entrada de la bitácora sin citar la ruta como archivo,
confirmé `npm run check:harness` en 0, formateé solo el bloque que había
tocado (`npx prettier --write` sobre `.agent/progress/F-030.md`, diff revisado
— sin cambios fuera de mi propia entrada) y descarté la entrada de
`bash .agent/verify.sh pending F-030` con el mismo motivo. No es un fallo de
F-030 ni de este documento; fue mío, en el archivo de al lado, y queda anotado
para no esconderlo.

### Re-verificación de F1 (criterio 10), tras el arreglo del implementador

El implementador añadió `extractSupabaseUserId()` a
`scripts/order-link-probe.mjs`: reensambla los trozos de la cookie
`qab-shopper-auth`/`.N`, quita el prefijo `base64-`, decodifica el JSON de
sesión, coge el `access_token` y saca el `sub` de su payload con
`Buffer.from(part, "base64url")`. La corrida G lo llama sobre la cookie de la
corrida A antes de construir `forbidden`, y si devuelve `null` la corrida
**falla** con `PROBE FAIL` y salida 6 en vez de seguir en silencio con tres
valores.

**Primero corregí mi propia rotura del sensor.** Antes de tocar nada de F1
tuve que arreglar `tests.md`: citaba entre comillas invertidas la ruta de un
guion de usar y tirar que usé para comprobar F1, con prefijo `_tmp-` dentro de
scripts/, y que borré al terminar sin añadirlo nunca al árbol de git — así que
`npm run check:harness` —la primera etapa de `--full`— fallaba con exactamente
el fallo que `AGENTS.md` § Cosas que muerden documenta para eso: una ruta entre
comillas invertidas que ya no existe en disco. Reescribí esa prosa sin la cita
entre comillas invertidas (la describo en texto corrido, sin citarla como
archivo), pasé `npx prettier --check` sobre lo que yo escribí, confirmé
`npm run check:harness` en 0, y descarté la entrada de
`bash .agent/verify.sh pending F-030` con `bash .agent/verify.sh dismiss F-030
'harness:✗ The harness documents something its scripts do not do:' 'cita entre
comillas invertidas de un guion temporal en tests.md, corregida'` — descuido de
redacción mío, no una lección para nadie.

**Después verifiqué el arreglo de F1, ejecutando, en dos partes:**

1. **Que ahora son de verdad los cuatro valores.**
   `bash .agent/verify.sh F-030 --probe` (intento 26) → PASA, `0 aserciones
fallidas de A-G`, y `.agent/runs/F-030/026-probe.log` línea 45 dice
   literalmente `ok   corrida G — ninguna línea lleva correo, user.id,
Customer.id o cookie` — el mensaje cambió respecto a antes (que decía
   «correo, Customer.id o cookie», sin `user.id`), lo que confirma que la
   corrida ahora arma el `forbidden` con los cuatro valores, no con tres.
2. **Que el fallo duro funciona de verdad**, no solo que exista el `if`. Copié
   el guion (de nuevo un archivo temporal dentro de `scripts/`, borrado al
   terminar y nunca en el árbol — el `git status --short scripts/` de después
   solo mostraba el `order-link-probe.mjs` sin tocar), forcé
   `extractSupabaseUserId()` a devolver siempre `null`, y corrí las siete
   corridas de punta a punta contra Auth real:

   ```
   == Corrida G — sin PII en las líneas [orders] customer link ==
   PROBE FAIL corrida G — no se pudo extraer el user.id de Supabase (sub del
     JWT) de la cookie de la corrida A
     el chequeo de PII no puede correr con menos de los cuatro valores que
     promete spec.md R3 — revisa el formato de la cookie de @supabase/ssr o
     el access_token que lleva dentro
   $ echo $?
   6
   ```

   Salida 6 (`EXIT.ASSERTION_FAILED`), con su línea `PROBE FAIL` delante, tal
   como `architecture.md` § «El guion» documenta para ese código. Confirmado
   que el proceso limpió su `next dev`, su proxy y no dejó filas de prueba
   (mismo `Customer`/`Order` que la corrida real de A, verificado por
   `email LIKE 'order-link-probe%'` en Postgres tras terminar).

Con las dos partes verificadas, el criterio 10 pasa a **LISTO** sin matices:
el comportamiento en runtime ya era correcto (verificado en el ciclo
anterior) y ahora la prueba que lo demuestra permanentemente también lo es.

## Fallos encontrados

### F1 (RESUELTO) — Severidad media. La corrida G no comprobaba el `user.id` de Supabase, pese a que `spec.md` y `architecture.md` lo exigían explícitamente

**Qué dicen los documentos que se firmaron.** `spec.md` R3: «Cero PII y cero
credenciales. Ni correo, ni `user.id`, ni `Customer.id`, ni teléfono, ni valor
de cookie...». `spec.md` criterio 10 (forma ejecutable): «corrida G: un `grep`
por cada uno de los **cuatro** valores, cero coincidencias». La tabla de
corridas de `spec.md` y de `architecture.md` § «El guion» dice, palabra por
palabra: «Ninguna línea del prefijo contiene el correo, el `user.id`, el
`Customer.id` ni el valor de la cookie».

**Qué hacía el código en el momento en que encontré esto** (corrida G de
`scripts/order-link-probe.mjs`, antes del arreglo — el archivo ya cambió, ver
más abajo «A qué agente volvió»):

```js
const forbidden = [email, customerId, cookieHeader].filter(Boolean);
```

Tres valores, no cuatro. Falta el `user.id` de Supabase (el `sub` del JWT, el
mismo que `getCustomerUser()` expone como `user.id` y que
`findCustomerIdByUserId(user.id)` recibe en `orderIdentity.ts`). El guion nunca
lo captura: `runAuthOtp()` invoca `scripts/auth-otp.mjs --mode app --json`, y en
modo `app` ese guion **no** incluye `user_id` en su salida JSON (`userId` solo
se rellena en la rama `mode === "gotrue"`, `scripts/auth-otp.mjs:270-273`) —
solo trae `email`, `token`, `mode`, `message_id`, `profile` y `cookie`.

**Cómo lo comprobé, ejecutando, no leyendo.** Copié el guion a un archivo
temporal de usar y tirar dentro de scripts/ (nombre con prefijo `_tmp-`,
borrado al terminar la comprobación y nunca añadido al árbol de git — el
diff de `scripts/` quedó limpio salvo el propio `order-link-probe.mjs` sin
tocar, así que hoy no existe ninguna ruta con ese nombre y no se cita entre
comillas invertidas por eso), le añadí que decodificara el JWT de la cookie
de sesión para extraer el `sub` real y lo metiera en el `forbidden` de la
corrida G. Lo corrí dos veces contra Auth real (F-028), de punta a punta:

```
PII-CHECK raw stdout: {"email":"...","token":"...","mode":"app",
  "message_id":"...","profile":{...},
  "cookie":"qab-shopper-auth=base64-eyJhY2Nlc3NfdG9rZW4i..."}
PII-CHECK capturedUserId=null   ← porque --mode app no lo expone
```

Decodifiqué a mano el JWT del `access_token` dentro de esa cookie (Python,
`base64.b64decode` + `json.loads`) y obtuve el `user.id` real de la corrida:
`ad630429-3ce0-4a8f-9e2b-0d275a3791d0`. Busqué esa cadena en el
`PROBE_SERVER_LOG` completo de esa corrida:

```
$ grep -n "ad630429-3ce0-4a8f-9e2b-0d275a3791d0" pii-server2.log
(sin coincidencias, exit 1)
```

**Conclusión.** El comportamiento de **hoy** es correcto: el `user.id` no
aparece en ninguna línea `[orders] customer link`, porque
`orderLinkObserver.ts`'s `emit()` solo esparce
`{ outcome, elapsedMs, ceilingMs, lateMs?, resolved? }` — no hay forma de que
el `user.id` se cuele con el código actual. Pero **la prueba que debía
demostrarlo, no lo demuestra**: la corrida G del guion entregado solo
comprueba 3 de los 4 valores que su propia arquitectura promete comprobar, y
`impl.md` § Desviaciones no menciona este recorte en ningún sitio (silencioso,
no una decisión documentada). Si mañana alguien añade `userId` a la línea
`unverified` o `no_customer` por error, **nada lo detecta**: ni los tests
unitarios (usan `toMatchObject`, que permite propiedades extra, salvo en el
caso `error`, el único que comprueba `Object.keys` exacto) ni la corrida G del
probe (no busca esa cadena). Es exactamente el patrón que se pidió vigilar: «un
`grep` que busca mal pasa siempre».

**A qué agente volvió**: `sdd-implementer`. Arregló exactamente lo que hacía
falta: `extractSupabaseUserId()` en `scripts/order-link-probe.mjs` reensambla
los trozos de la cookie `qab-shopper-auth`/`.N`, quita el prefijo `base64-`,
decodifica el JSON de sesión, coge el `access_token` y saca el `sub` de su
payload con `Buffer.from(part, "base64url")` — sin depender de que
`auth-otp.mjs --mode app` lo exponga y sin tocar ese guion ni su contrato con
`scripts/place-order.mjs`. La corrida G llama a esa función sobre la cookie de
la corrida A **antes** de construir `forbidden`, y si devuelve `null` la
corrida falla con `PROBE FAIL` y salida 6 en vez de seguir en silencio con tres
valores — la condición exacta que pedí.

**Verificado por mí, ejecutando, en § Ejecuciones → «Re-verificación de F1»**:
la corrida G real ahora arma `forbidden` con los cuatro valores (confirmado
leyendo el mensaje de éxito, que cambió de texto para nombrar `user.id`), y el
camino de fallo duro de verdad corta con salida 6 y su línea `PROBE FAIL`
cuando se le fuerza a no poder extraerlo (lo comprobé con una copia
instrumentada del guion, de usar y tirar, corrida de punta a punta contra Auth
real).

**Severidad al momento de encontrarlo: media, no bloqueante para el
comportamiento de producción** (el runtime ya era correcto entonces), **pero
bloqueante para el veredicto** porque el criterio 10, leído en la forma
ejecutable que la propia `spec.md` fijó («un `grep` por cada uno de los cuatro
valores»), no estaba implementado tal cual. Con el arreglo verificado, deja de
bloquear.

## Huecos de cobertura

- **`toMatchObject` en los casos `slow`, `timeout`, `late`, `unverified` y
  `no_customer` del test unitario no descarta propiedades extra.** Solo el
  caso `error` comprueba `Object.keys(fields).sort()` exacto. Si alguien
  añadiera `userId` a una de esas líneas por error, ese test no lo pescaría —
  la corrida G del probe sí lo pescaría ahora, tras el arreglo de F1, porque ya
  compara contra los cuatro valores. No es un criterio incumplido hoy —los
  campos de hoy son exactamente los de la tabla de `spec.md`, lo comprobé
  leyendo `orderLinkObserver.ts`— y no bloquea el veredicto: queda anotado como
  mejora de defensa en profundidad, no como hueco de cobertura de un criterio.
- **El criterio 7 sobre HTTP, literal, no se probó** (I3 de `spec.md`, cerrado
  por el humano el 2026-09-01, opción (a)): se mide donde la spec fijó — la
  resolución de identidad, no el `POST` completo. No es un hueco de este
  ciclo, es una decisión ya tomada; se anota para que nadie la persiga.

## Veredicto

**LISTO.**

Los doce criterios están verificados de punta a punta, ejecutando comandos
reales contra Auth de verdad (F-028), con evidencia capturada y releída por mí,
no solo por el informe del implementador. F1 (criterio 10: la corrida G del
probe solo comprobaba 3 de los 4 valores de PII que `spec.md`/`architecture.md`
prometen) quedó arreglado por `sdd-implementer` con `extractSupabaseUserId()` y
lo verifiqué yo mismo en dos partes: que la corrida real ahora arma los cuatro
valores, y que el camino de fallo duro corta de verdad con `PROBE FAIL` y
salida 6 cuando la extracción falla (forzándolo con una copia instrumentada,
de usar y tirar, del guion). `bash .agent/verify.sh F-030 --full` termina en 0
(intento 29, tras corregir en el camino una segunda rotura del sensor —esta
vez en la propia bitácora, `.agent/progress/F-030.md`— que yo mismo causé al
citar entre comillas invertidas un guion temporal ya borrado; ver § Cierre
más arriba). Repetido una vez más sin tocar nada (intento 30) para confirmar
que quedó estable: PASA otra vez, exit 0. `bash .agent/verify.sh pending
F-030` está vacío.

## Preguntas al humano

Ninguna. F1 fue un defecto de implementación con arreglo claro, ya corregido y
verificado — no generó ningún `TP`.
