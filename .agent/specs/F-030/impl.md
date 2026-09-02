---
feature: F-030
agente: sdd-implementer
actualizado: 2026-09-02T01:20:00Z
estado: listo
---

## Qué se construyó

### Ciclo 1 — pasos 1–4 de `plan.md`

Los pasos 1–4 de `plan.md` (el ciclo de implementación completo; los pasos
5–8, el guion del probe y su etapa en `.agent/verify.sh`, quedan para el
siguiente ciclo, sin tocar).

| Archivo                                                    | Qué hace                                                                                                                                                                                                                                                                                         | Criterio que cubre |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `src/constants/account.ts`                                 | `ORDER_CUSTOMER_LINK_SLOW_MS = 300` y `ORDER_LINK_OUTCOME` (objeto `as const`, seis valores) más su tipo derivado `OrderLinkOutcome`. `ORDER_CUSTOMER_LINK_TIMEOUT_MS` intacto.                                                                                                                  | 4, 6               |
| `src/features/account/server/orderLinkObserver.ts` (nuevo) | `startOrderLinkWatch()`: reloj monótono con `performance.now()`, la regla de desenlace de `settled()`/`timedOut()`, `lateMs = Math.max(1, …)`, y la única llamada del repo a `console.warn("[orders] customer link", …)`. Cuerpos de `settled()`/`timedOut()` en `try/catch` vacío (DA4).        | 1–5, 10            |
| `src/features/account/server/orderIdentity.ts`             | Enganchado del observador: corte por cookie primero, `isSupabaseAuthConfigured()` después (R4/DA5); `.catch` pegado a la creación de `attempt` (R13); `after(() => attempt)` envuelto en `try/catch` en el mismo punto donde gana el temporizador (DA2). Firma, techo y `Promise.race` intactos. | 1–5, 7, 9          |
| `src/features/account/server/orderIdentity.test.ts`        | Nueve casos nuevos en un `describe` aparte, espiando `console.warn`: invitado, enlace normal, `slow`, `timeout`, `late`, `unverified`, `no_customer`, `error`, Auth sin configurar. Los seis casos preexistentes no se tocaron.                                                                  | 6, 7, 9            |

### Ciclo 2 — pasos 5–7 de `plan.md`

Los pasos 5, 6 y 7 (el paso 8 — cierre `--full`, `F-012 --smoke`,
`check:bundle` — sigue siendo alcance de `sdd-tester`). Los pasos 1–4 no se
tocaron.

| Archivo                                                              | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Criterio que cubre |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `scripts/order-link-probe.mjs` (nuevo)                               | Las seis piezas de architecture.md § «El guion»: proxy lento (`node:http`, puerto 0, `state.delayMs` mutable) delante de `NEXT_PUBLIC_SUPABASE_URL`/`http://localhost:54321`; su propio `next dev` en `PROBE_PORT` con `stdio` en `PROBE_SERVER_LOG` (append); sesión con `scripts/auth-otp.mjs --mode app` ANTES de encender el retraso; las corridas A–G; el lector tolerante de líneas (nunca `JSON.parse`, ventana de texto tras el prefijo literal, tolera el objeto partido en varias líneas); limpieza (`Order` por `code` antes que `Customer` por `email`) en `finally` y en `SIGINT`/`SIGTERM`. Un teléfono distinto por pedido (B–F, seis en total, `+53<sufijo>`). | 1–5, 9, 10         |
| `.agent/verify.sh`                                                   | `PROBE_PORT` (3102), `stage_cmd probe)`, `extract_signature probe)` (`PROBE FAIL.*`), la rama `probe` de `correr_etapa`, `cmd_verify` con `--probe` (exige `F-NNN`, no entra en `STAGES_COMPLETO`/`STAGES_RAPIDO`), y `correr_probe()`: si `servidor_propio` devuelve un puerto, **falla** explicándolo (no reutiliza); si no, `puerto_libre`, pasa `PROBE_PORT`/`PROBE_SERVER_LOG` al guion, vuelca la salida del servidor, aplica `guardian_servidor` y comprueba (hasta ~5 s) que el puerto vuelve a quedar libre.                                                                                                                                                          | 1–5, 9, 10         |
| `.agent/playbook/TEMPLATE.md`                                        | `etapa:` gana `visual` y `probe` (I6, DA10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                  |
| `AGENTS.md` § Cosas que muerden                                      | Línea nueva: instrumentación de servidor usa `console.warn` con prefijo `[scope]`, nunca `console.error` — por qué (`SERVIDOR_ERROR_RE`/`guardian_servidor`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                  |
| `.agent/playbook/console-error-dispara-guardian-servidor.md` (nueva) | La misma lección, con `firma: registró un error, aunque las peticiones respondieran`, `etapa: smoke \| visual \| probe`, `promovido_a_agents: sí` desde que se escribe (la convención ya la seguían cuatro piezas del repo antes de esta ficha).                                                                                                                                                                                                                                                                                                                                                                                                                               | —                  |

### Ciclo 3 — arreglo del probador: corrida G solo comprobaba tres de los cuatro valores prohibidos (F1)

El probador dio `no listo` por F1: `spec.md` R3 y `architecture.md` § «El
guion» prometen que la corrida G comprueba cuatro valores prohibidos —correo,
`user.id` de Supabase, `Customer.id` y cookie— pero el `forbidden` de la
corrida G solo llevaba tres (faltaba el `user.id`). El probador confirmó a
mano que hoy no se filtra (decodificó el JWT de la corrida A y no encontró
coincidencias): es un hueco del verificador, no del instrumento.

| Archivo                        | Qué cambió                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/order-link-probe.mjs` | `extractSupabaseUserId(cookieHeaderValue)` (nueva): junta los trozos de la cookie `qab-shopper-auth`/`qab-shopper-auth.N` (el chunker de `@supabase/ssr`), quita el prefijo `base64-`, decodifica el JSON de sesión, toma `access_token` (un JWT) y decodifica el `sub` de su payload con `Buffer.from(parte, "base64url")` — sin dependencias nuevas. Corrida G llama a esto sobre la cookie de la corrida A **antes** de construir `forbidden`; si devuelve `null`, la corrida entera `fail()`-ea con `PROBE FAIL` y código 6, sin seguir con tres valores en silencio (la exigencia explícita del arreglo). Si lo extrae, entra como cuarto elemento de `forbidden` junto a `email`, `customerId` y `cookieHeader`. |

No se tocó nada más: ni `src/`, ni `.agent/specs/F-030/tests.md` (del
probador), ni `.agent/features.json`, ni los archivos de la sesión que
trabaja en paralelo en este mismo worktree (`.agent/solicitudes.*`,
`.agent/README.md`, `.agent/init.sh`, `scripts/check-harness.mjs`,
`.gitignore`, `.claude/skills/sdd/SKILL.md`).

Verificado con la cookie real de una corrida A (formato confirmado a mano:
`qab-shopper-auth=base64-<JSON con access_token y user.id>`, sin chunking
porque cabe en una sola cookie): `extractSupabaseUserId()` devuelve el mismo
UUID que el campo `user.id` embebido en el JSON de sesión y que el `sub` del
JWT.

**Bloqueador ajeno encontrado durante la verificación, sin tocarlo**:
`bash .agent/verify.sh F-030 --full` falla hoy en la etapa `harness` porque
`.agent/specs/F-030/tests.md` cita, entre comillas invertidas, un guion en
scripts/ que empieza por `_tmp-` y todavía no existe en disco — un archivo
del probador, en edición activa en este mismo worktree mientras yo trabajaba
(confirmado por su `mtime`), no algo que este ciclo tocara. No es un efecto
de este arreglo: `bash .agent/verify.sh F-030 --only probe` (que sí ejercita
el cambio de este ciclo) pasa limpio, dos veces seguidas. `--full` se deja
para que el probador lo repita cuando su propio archivo esté listo.

## Desviaciones

Ninguna respecto a `plan.md` pasos 1–4. Dos decisiones de implementación que
`architecture.md` dejó como "forma, no código" y que aquí se concretan,
consistentes con DA1–DA5, DA9:

- **`after()` se llama con `() => attempt`, no con una función que reconstruya
  la emisión.** El "forma, no el código" de `architecture.md` § Contratos no
  muestra la llamada a `after()` en absoluto (el bloque de código de esa
  sección omite explícitamente esa parte). DA2 exige que "lo que se le pasa a
  `after()` no puede rechazar" y que sea "la continuación sobre `attempt`, con
  la emisión envuelta". Como `OrderLinkWatch.timedOut(attempt): void` ya
  adjunta su propio `.then()` sobre `attempt` en el momento en que se llama
  —antes de que `after()` se invoque siquiera—, pasarle a `after()` el propio
  `attempt` (que nunca rechaza, por R13) es suficiente para que Next mantenga
  viva la invocación hasta que esa continuación ya adjuntada corra. Es
  exactamente el comportamiento que DA2 describe: "como la continuación ya
  está adjuntada por su cuenta, tragarse esa excepción no pierde la línea".
  Verificado en el caso unitario `late`, que pasa sin mockear `next/server`.
- **`resolveOnce()` construye el `OrderLinkResolution` en línea dentro de
  `orderIdentity.ts`** (`unverified` si no hay `user`, `no_customer` si
  `findCustomerIdByUserId` devuelve `null`, `linked` en otro caso), en vez de
  ser una función importada como sugiere el nombre en el bloque ilustrativo de
  `architecture.md`. Es la misma lógica que ya existía en el archivo antes de
  este feature, solo reescrita para devolver el tipo nuevo; no hay otro sitio
  del repo que la necesite.

### Desviaciones — ciclo 2

Ninguna respecto al plan ni a la arquitectura en lo que el guion hace; una
precisión de entorno que no estaba en ningún documento porque no era
previsible desde ahí:

- **El emulador de F-028 estaba arriba pero mal configurado antes de este
  ciclo, por una causa ajena al código de F-030.** El contenedor
  `queandabuscando-supabase-gateway` (nginx, el mismo que sirve
  `/dev-mail/otp.html` a GoTrue) tenía sus bind mounts apuntando al
  `docker/` de un worktree distinto (`escolar`) que ya no existe en disco —
  Docker, cuando el origen de un bind mount no existe, crea un directorio
  vacío en vez de fallar, así que el gateway servía 404 en esa ruta y GoTrue
  caía al asunto/plantilla por omisión de habla inglesa
  («Confirm your email address», sin el código de 6 dígitos). Esto es el
  mismo problema que `AGENTS.md` § «Un solo `next dev` por directorio» ya
  documenta para el servidor de desarrollo, pero para la infraestructura de
  Docker compartida entre worktrees del mismo repo: los `container_name`
  literales de `docker-compose.yml` son globales a la máquina, así que solo
  el worktree que ejecutó `docker compose up -d` por última vez controla los
  bind mounts. Arreglado recreando `supabase-gateway` desde este worktree y
  reconectándolo a la red del stack ya en pie con
  `docker network connect --alias supabase-gateway <red> queandabuscando-supabase-gateway`
  (el `docker network connect` sin `--alias` no basta: el hostname
  `supabase-gateway` que `GOTRUE_MAILER_TEMPLATES_*` usa es un alias de red,
  no el nombre del contenedor), y reiniciando `queandabuscando-auth` para
  vaciar su caché de plantilla de 10 minutos (architecture.md de F-028 ya
  documenta esa caché). No toca ningún archivo del repo — es estado de
  Docker en esta máquina, no algo que `git diff` vaya a mostrar nunca. No
  se abrió ficha de playbook para esto: no es una trampa del código de este
  repo, es infraestructura de desarrollo compartida entre worktrees que
  cualquier otro agente en esta misma máquina puede volver a encontrarse, y
  el arreglo (recrear el contenedor huérfano, reconectar con el alias
  correcto, reiniciar `auth`) no tiene ni una línea de código que fichar.

## Comandos ejecutados

Ciclo 1:

- `bash .agent/verify.sh F-030` → intento 3, **PASA**, salida 0
  (typecheck 3s, lint 8s, format 14s, test 44s).
- `npx vitest run src/features/account/server/orderIdentity.test.ts` → **15
  passed** (6 preexistentes + 9 nuevos), salida 0.
- `npx vitest run src/features/account/boundaries.test.ts` → **4 passed**,
  salida 0 (R6 intacto: nada nuevo importa `@supabase/*`, nada lleva
  `"use client"`, nada entra en `src/features/orders/` ni en
  `src/app/[slug]/`).

Ciclo 2:

- `node scripts/order-link-probe.mjs` (ejecución directa, sin `verify.sh`) →
  **salida 0**, las siete corridas A–G en verde, tras el arreglo de entorno
  de § Desviaciones. Confirmado además: `PROBE FAIL` real con salida 5 cuando
  el emulador servía la plantilla equivocada (así se descubrió el problema de
  Docker, no se asumió).
- `bash .agent/verify.sh F-030 --probe` → **PASA, salida 0** (typecheck 3s,
  lint 9s, format 14s, test 32–44s, `probe` 11–16s). Repetido tres veces para
  confirmar que no es intermitente.
- Precondición de `correr_probe` verificada de propósito: con un `next dev`
  manual vivo en el puerto 3000 de este worktree, `bash .agent/verify.sh
F-030 --probe` **FALLA con salida 1** y el mensaje
  `PROBE FAIL ya hay un next dev de este worktree en el puerto 3000` — no
  reutiliza. Descartado con `bash .agent/verify.sh dismiss F-030 '<firma>'
'…'`: lo provoqué yo a propósito, no es un fallo del repo.
- Tras cada corrida del probe: `pgrep -f 'next-server|next dev'` y `lsof
-tiTCP:3102 -sTCP:LISTEN` vacíos, y una consulta a Postgres confirma cero
  filas de `Order`/`Customer` de prueba — la limpieza del guion funciona.
- `bash .agent/verify.sh F-030` (sin `--probe`) → **PASA, salida 0**.
- `bash .agent/verify.sh F-030 --full` → **PASA, salida 0** (harness,
  typecheck, lint, format, test, prisma, build, theme, bundle).
- `npm run check:harness` → 0 (230 documentos, 9 etapas, 14 scripts).
- `npm run format:check` → 0.
- `npx eslint scripts/order-link-probe.mjs` → 0 problemas.

Ciclo 3 (arreglo de F1):

- `npx eslint scripts/order-link-probe.mjs` y `npx prettier --check
scripts/order-link-probe.mjs` → 0 en los dos, sin cambios de formato.
- `bash .agent/verify.sh F-030 --only probe` → **PASA, salida 0**, dos veces
  seguidas (sin `next dev` propio vivo ni antes ni después de cada corrida;
  Postgres sin filas de prueba tras cada una). Aislado con `--only probe` en
  vez del `--probe` por defecto porque `format`/`harness` están hoy en rojo
  por `.agent/specs/F-030/tests.md`, del probador y en edición activa — no
  algo que este arreglo haya tocado ni pueda arreglar.
- `bash .agent/verify.sh F-030 --full` → **FALLA, salida 1**, en la etapa
  `harness`, por el mismo guion sin crear que cita
  `.agent/specs/F-030/tests.md` (ver arriba). Confirmado que es ajeno a este
  ciclo: el archivo es del probador, no lo escribí ni lo edité, y `git
status`/`mtime` lo muestran en edición en el momento de correr esto. Detalle
  en § Ciclo 3 de arriba.
- Log de la corrida donde se confirmó el arreglo:
  `ok   corrida G — ninguna línea lleva correo, user.id, Customer.id o
cookie` (antes: "…correo, Customer.id o cookie", sin `user.id`).

## Deuda dejada

Ninguna dentro del alcance de los pasos 5–7 ni del arreglo de F1. Lo que
sigue es alcance de `sdd-tester` (paso 8 del plan, ya firmado): el cierre con
`--full` sobre el feature entero, `bash .agent/verify.sh F-012 --smoke` (para
confirmar que la línea `unverified` nueva no lo pone en rojo) y `npm run
check:bundle`.

`--full` está en rojo AHORA MISMO por `.agent/specs/F-030/tests.md` (el
probador cita, entre comillas invertidas, un guion sin crear en scripts/) —
no por nada de este ciclo. En cuanto ese archivo quede en el estado que
`check:harness`/`format:check` esperan, `--full` debería volver a pasar sin
que nadie toque nada de lo que este ciclo escribió: `--only probe` ya lo
confirma en verde de forma aislada.

## Qué necesita quien pruebe

- `npx vitest run src/features/account/server/orderIdentity.test.ts` no
  necesita Docker, red ni Postgres — todo mockeado.
- `bash .agent/verify.sh F-030 --probe` SÍ necesita Postgres sembrado
  (`npm run seed`) y los emuladores de F-028 (Auth, Mailpit) arriba y
  **con la plantilla de correo sirviendo de verdad** — no basta con que
  `/auth/v1/health` responda; hace falta que
  `curl http://localhost:54321/dev-mail/otp.html` devuelva el HTML con
  `{{ .Token }}`, no un 404. Si el emulador lleva mucho tiempo arriba y
  viene de otro worktree o de un `docker compose up -d` viejo, comprueba
  primero eso — es justo lo que rompió la primera corrida de este ciclo (ver
  § Desviaciones — ciclo 2) y no tiene ficha de playbook porque no es una
  trampa del código, es infraestructura de Docker compartida entre
  worktrees.
- Antes de correr `--probe`: sin ningún `next dev` propio en pie
  (`pgrep -fl 'next-server|next dev'` vacío) y sin nada en el puerto 3102
  (`lsof -tiTCP:3102 -sTCP:LISTEN` vacío). La propia etapa lo comprueba y
  falla si no, pero verificarlo antes ahorra un ciclo.
- El caso `late` del test unitario depende de un `setTimeout` real de ~650 ms
  más el margen de `vi.waitFor` (hasta 1 s); es el único test de la suite con
  ese costo, igual que el `timeout`/resolución colgada ya existente. El
  probe tiene un costo mayor y deliberado: dos arrancadas de `next dev`
  (~10–60 s cada una según el estado de `.next`), seis pedidos reales y unos
  4 s de retrasos — del orden de 15 s a 2 min, tal como
  `architecture.md` § Escalabilidad lo anticipa.

## Preguntas al humano

Ninguna.
