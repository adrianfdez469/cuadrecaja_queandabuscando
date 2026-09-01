---
feature: F-029
agente: sdd-spec
actualizado: 2026-09-01T01:22:16Z
estado: listo
---

## Problema

Un `.env` recién copiado de `.env.example` **rompe `serverEnv()` en silencio**.
`.env.example` entrega `SSO_JWT_SECRET=""` (línea 69), `ADMIN_SESSION_SECRET=""`
(73) y `CRON_SECRET=""` (77); `src/lib/env.ts:10-12` las declara con `.min(32)`,
`.min(32)` y `.min(16).optional()`. En Zod, `.optional()` permite que la clave
esté **ausente**, no que valga `""`, así que `safeParse(process.env)` falla por
las tres y `serverEnv()` lanza `Invalid server environment — …` la primera vez
que alguien la llama.

Lo caro no es el fallo: es dónde cae. `getAdminSession()`
(`src/lib/auth/adminSession.ts:52-65`) llama a `secret()` —y este a
`serverEnv()`— dentro de un `try { … } catch { return null; }`. El `throw` se
traga entero y `/admin` redirige con una cookie perfectamente firmada, igual que
si no hubiera sesión. Sin error en pantalla, sin 500, sin pista. Le costó una
hora a `sdd-tester` verificando el criterio 5 de F-012, que acabó saltándose
cuatro aserciones (`.agent/specs/F-012/smoke.sh:405`). El mismo camino opaco
afecta a `src/lib/supabase/storage.ts`, que entra por `serverEnv()` en todas sus
funciones.

Y el repo ya sabía la respuesta sin escribirla donde se necesita:
`.github/workflows/ci.yml:181-183` fija las tres a mano «enough to satisfy
validation». CI se arregló; el entorno local, que es donde se depura, no.

## Alcance

### Dentro

1. Un generador de secretos de desarrollo, scripts/dev-secrets.mjs (por crear),
   calcado de `scripts/storage-dev-keys.mjs`: valores aleatorios por máquina,
   escritos solo en `.env`, que está en `.gitignore` (líneas 45-48).
2. `.env.example`: ninguna de las tres claves queda asignada a `""`.
3. `src/lib/env.ts`: el fallo de configuración deja rastro **una vez, en el
   sitio donde nace**, antes de lanzar. La firma de `serverEnv()` y su tipo
   `ServerEnv` no cambian.
4. `.agent/init.sh`: el aviso nombra el generador, no solo «sin valor en .env».
5. Dos pruebas nuevas: src/lib/env.test.ts (por crear) y
   src/lib/auth/adminSession.test.ts (por crear).
6. `.agent/specs/F-012/smoke.sh`: el salto de las cuatro aserciones del criterio
   5 pasa a **fallo duro**. Con las claves generables por un comando, un `.env`
   sin ellas es un entorno mal montado, y el smoke tiene que decirlo.
7. Un guion de humo propio, .agent/specs/F-029/smoke.sh (por crear), que prueba
   por HTTP que una sesión de admin real funciona con las claves generadas.

### Fuera (explícito)

- **Meter secretos reales, ni con forma de clave, en git.** `.env.example` ya
  argumenta por qué (líneas 24-26) y esa razón no se toca.
- **Tocar `src/lib/auth/adminSession.ts`.** Es de F-008, cerrado. El registro va
  en `serverEnv()` (decisión del humano, 2026-08-31).
- **Arreglar que `SSO_JWT_SECRET` no se lea por `serverEnv()`** (I1) ni que
  `CRON_SECRET` tampoco (I2). Quedan fichadas, no arregladas.
- **Cambiar `src/lib/supabase/storage.ts`** ni ninguna otra ruta consumidora.
- **`QAB_BEARER_TOKEN`**, que también está vacío en `.env`: se acuña con
  `npm run mint:token` y no pasa por `serverEnv()`.
- **`.github/workflows/ci.yml`.** Sus tres valores de relleno son frases legibles
  en inglés, no material con forma de clave, y CI ya funciona.
- **`docs/despliegue.md`.** No hay paso operativo nuevo: en producción las tres
  variables se siguen fijando en el entorno del despliegue, tal y como describe
  su § 4. El generador es de desarrollo local.
- **Gestores de secretos, rotación, caducidad y auditoría.**
- **La prosa fechada de `.agent/specs/F-012/tests.md:40`**, que cita F-029 «sin
  arreglar»: es el registro de un ciclo pasado. Solo cambia su `smoke.sh`.

## Actores y precondiciones

**Actor único: quien monta un worktree o clona el repo** —persona o agente— y
copia `.env.example` a `.env`. No hay actor de producto: nada de esto se ve desde
la tienda.

Precondición: `.env` existe. Es el estado por omisión de cualquier worktree
nuevo, y el de este mismo (`SSO_JWT_SECRET`, `ADMIN_SESSION_SECRET` y
`CRON_SECRET` valen `""`, comprobado el 2026-08-31).

Para E4 y E10 hace falta además Postgres arriba y el seed aplicado, que es lo que
`bash .agent/init.sh` ya exige con `bad` para la base de datos.

## Comportamiento esperado

**E1 — Worktree nuevo.** Dado un `.env` recién copiado de `.env.example`, cuando
se ejecuta `bash .agent/init.sh`, entonces la salida contiene un aviso que
nombra las claves que faltan **y el comando del generador**, el aviso es `warn`
(nunca `bad`), y el guion termina en `ENTORNO LISTO` con código 0.

**E2 — Generar con `--write`.** Dado un `.env` sin las tres claves o con ellas
por debajo del mínimo, cuando se ejecuta el generador con `--write`, entonces
las tres quedan en `.env` con valores aleatorios independientes que cumplen los
mínimos de `src/lib/env.ts`, cada una reemplazada **en sitio** si su línea ya
existía, el resto del archivo intacto, y la salida dice cuántas escribió.

**E2b — Ejecutarlo dos veces.** Cuando se vuelve a ejecutar con `--write` sobre
un `.env` cuyas tres claves ya cumplen el mínimo, entonces **no las regenera**:
las conserva, lo dice por salida estándar y no duplica ninguna línea. Con
`--force` sí las regenera, avisando de las dos consecuencias (E11).

**E3 — Sin `--write`.** Cuando se ejecuta sin bandera, entonces imprime las tres
líneas por salida estándar, sale 0 y **no modifica ningún archivo**: la marca de
tiempo de `.env` no cambia.

**E4 — La sesión de admin funciona de verdad.** Dadas las tres claves generadas
y la app levantada, cuando se acuña un token SSO con
`node scripts/mint-sso-token.mjs`, se sigue la URL que imprime y se guarda la
cookie `qab-admin-session` que devuelve `/admin/sso`, entonces `GET /admin` con
esa cookie responde **200**, sin haber editado `.env` a mano ni tener nada que
revertir después.

**E5 — El fallo deja de ser mudo.** Dado un `.env` con las claves vacías, cuando
cualquier código llama a `serverEnv()`, entonces **antes de lanzar** se escribe
por `console.warn` una línea que contiene `Invalid server environment` y los
nombres de las variables culpables, y `serverEnv()` sigue lanzando el mismo error
que hoy. `getAdminSession()` sigue devolviendo `null` (R4): lo único que cambia
es que ahora hay rastro.

**E6 — Las tres vacías nombran a las tres.** Dado `SSO_JWT_SECRET=""`,
`ADMIN_SESSION_SECRET=""` y `CRON_SECRET=""` en `process.env` con
`DATABASE_URL` puesta, cuando se llama a `serverEnv()`, entonces lanza un error
cuyo mensaje contiene los tres nombres de variable.

**E7 — Con valores generados, parsea.** Dadas las tres claves con valores que
cumplen los mínimos, cuando se llama a `serverEnv()`, entonces devuelve el objeto
sin lanzar. Y dado `CRON_SECRET` **ausente** (no `""`), también parsea: eso es lo
que `.optional()` promete y hoy `.env.example` impide.

**E8 — `.env.example` coherente.** Cuando se busca
`^(SSO_JWT_SECRET|ADMIN_SESSION_SECRET|CRON_SECRET)=` en `.env.example`, entonces
no hay ninguna coincidencia: las tres quedan documentadas en comentarios que
dicen para qué sirve cada una, cuál es obligatoria en producción y con qué
comando se generan en local. El archivo sigue listando **todas** las variables
que la app lee (R5).

**E9 — El sensor en verde.** Cuando se ejecuta el sensor completo del feature,
entonces termina con código 0.

**E10 — El smoke de F-012 deja de saltar.** Dado un `.env` con las tres claves
generadas, cuando se corre el smoke de F-012, entonces ejecuta las cuatro
aserciones del criterio 5 y su salida **no** contiene `SALTADO` para ese
criterio. Dado un `.env` sin `ADMIN_SESSION_SECRET`, entonces la corrida termina
distinta de 0 con una línea `SMOKE FAIL` que nombra el generador.

**E11 — `SSO_JWT_SECRET` no es un secreto libre.** Cuando el generador escribe o
regenera esa clave, entonces su salida avisa de que un valor aleatorio sirve para
local pero **rompe** el SSO real contra cuadrecaja, que exige el mismo valor a
los dos lados (`docs/despliegue.md:151`). Al regenerar `ADMIN_SESSION_SECRET`
avisa además de que invalida las sesiones de admin ya abiertas.

## Reglas de negocio

- **R1 — Nada con forma de clave en git.** Ni real ni de mentira. Los valores los
  genera cada máquina y viven solo en `.env`.
- **R2 — El generador es idempotente** y no destruye el resto de `.env`.
- **R3 — Nada se vuelve obligatorio que no lo fuera.** `bash .agent/init.sh`
  avisa con `warn`; `ENTORNO LISTO` no depende de estas tres claves.
- **R4 — El comportamiento observable de `getAdminSession()` no cambia.** Sigue
  devolviendo `null` ante cualquier fallo. Una excepción propagada rompería
  rutas que hoy funcionan.
- **R5 — `.env.example` sigue siendo la lista completa** de todo lo que la app
  lee. Comentar una clave documenta; no puede esconderla.
- **R6 — El registro es de `serverEnv()`, no de sus llamadores.** Una sola línea,
  en `src/lib/env.ts`, que cubre a todos los consumidores —incluido
  `src/lib/supabase/storage.ts`— sin tocar código de features cerrados.
- **R7 — Se registra como mucho una vez por instancia del módulo.** Una segunda
  llamada a `serverEnv()` con el mismo entorno roto no imprime una segunda línea.
  Una ruta que la llame en cada petición no puede inundar el log.
- **R8 — La línea de registro no puede poner en rojo al sensor.** Va por
  `console.warn`, con el prefijo `[env]`, como texto plano: **nunca** un objeto
  `Error`. `.agent/verify.sh:295` y `.agent/verify.sh:380` marcan la etapa como
  fallida si la salida del servidor casa con `⨯`, `Unhandled` o `Error:`, así que
  el mensaje tampoco puede contener esa última subcadena.
- **R9 — `CRON_SECRET` sigue `.optional()`** en `src/lib/env.ts` y su consumidor
  (`src/app/api/crons/_lib/guard.ts:11`) la sigue leyendo de `process.env`.
- **R10 — Ningún guion de humo escribe `.env`.** Si faltan las claves, falla
  diciendo qué ejecutar. Un smoke que rellena el entorno que está probando
  esconde justo el fallo que este feature persigue.

## Casos límite y errores

- **`.env` no existe**: el generador sale distinto de 0 diciendo que copie
  `.env.example` primero, como hace `scripts/storage-dev-keys.mjs:56-59`.
- **Clave presente pero corta** (alguien tecleó doce caracteres): cuenta como no
  configurada tanto para el generador como para el aviso de `bash .agent/init.sh`.
- **Clave ausente frente a clave vacía**: para `CRON_SECRET` ausente debe
  parsear; vacía debe fallar. Para las dos obligatorias fallan las dos formas,
  pero ahora con rastro (E5).
- **`SSO_JWT_SECRET` compartida con cuadrecaja**: por eso `--write` conserva por
  omisión lo que ya cumple el mínimo (E2b). Pisarla en silencio dejaría al
  siguiente sin el valor acordado con el otro sistema.
- **Comillas y espacios al copiar y pegar**: `.min()` acepta cualquier cosa
  larga. No se resuelve; el generador escribe `NOMBRE="valor"` en base64url para
  que nadie tenga que teclearlas.
- **Comentar una variable la saca del chequeo genérico de `bash .agent/init.sh`**:
  su bucle recorre `grep -oE '^[A-Z_]+=' .env.example` (línea 53), así que las
  tres desaparecen de esa lista al comentarlas. Sin un chequeo dedicado, E1 se
  vuelve **silencio**, que es peor que el aviso de hoy. Es el riesgo principal
  de este feature.
- **`serverEnv()` cachea en módulo** (`src/lib/env.ts:19`) y el registro de R7
  también: toda prueba que manipule el entorno necesita `vi.resetModules()` y un
  `await import()` dinámico, como ya hace `src/lib/prisma.test.ts:29-38`.
- **Las pruebas no pueden depender del `.env` de la máquina**: el proyecto
  `server` de Vitest no carga `dotenv/config` (`vitest.config.mts`, comentario de
  cabecera), así que fijan el entorno con `vi.stubEnv` y lo restauran con
  `vi.unstubAllEnvs()`.

## Datos y contrato

Ningún dato nuevo, ninguna migración, ningún endpoint, ninguna dependencia. No
roza `docs/sync-contract.md`. Lo único que cambia de forma observable es cómo se
entregan tres variables ya existentes y de dónde salen sus valores locales.

Mínimos vigentes en `src/lib/env.ts:10-12`, que el generador debe respetar:

| Variable               | Mínimo | En el schema  | Quién la lee de verdad hoy                                                                        |
| ---------------------- | ------ | ------------- | ------------------------------------------------------------------------------------------------- |
| `SSO_JWT_SECRET`       | 32     | obligatoria   | `src/app/admin/sso/route.ts:20` y `scripts/mint-sso-token.mjs:24`, por `process.env` (I1)         |
| `ADMIN_SESSION_SECRET` | 32     | obligatoria   | `src/lib/auth/adminSession.ts:27`, por `serverEnv()`                                              |
| `CRON_SECRET`          | 16     | `.optional()` | `src/app/api/crons/_lib/guard.ts:11` y `scripts/renegotiate-order.mjs:67`, por `process.env` (I2) |

Formato escrito en `.env`: `NOMBRE="<base64url>"`, un valor distinto por clave,
de al menos 32 bytes de entropía — con el `randomBytes(48).toString("base64url")`
del precedente salen 64 caracteres, holgados para los tres mínimos. Idioma del
código, los comentarios y los mensajes: inglés (AGENTS.md § Idioma).

## Criterios de aceptación propuestos

Los ocho primeros son los de `.agent/features.json`, literales, con **cómo se
ejecuta cada uno** y a qué escenario responde. C9 es nuevo y va al humano.

1. `[ya]` Generador con `--write`: escribe las tres claves cumpliendo los
   mínimos, sin duplicar líneas, y `git status --porcelain` queda vacío después.
   → E2, E2b, R1, R2. Se ejecuta con el árbol limpio: `node` sobre el generador
   con `--write`, luego `git status --porcelain` sin salida y `git check-ignore .env`
   en 0. Repetirlo dos veces y comprobar con `grep -c` que cada clave aparece una
   sola vez en `.env`.
2. `[ya]` Sin `--write`, imprime por stdout y no modifica ningún archivo. → E3.
   Se compara la marca de tiempo de `.env` (`stat`) antes y después.
3. `[ya]` `npx vitest run` sobre src/lib/env.test.ts (por crear) termina en 0,
   con dos casos: las tres claves en cadena vacía hacen que `serverEnv()` lance
   un error que nombra las tres, y con valores generados parsea. → E6, E7. El
   archivo puede llevar un tercer caso, el de `CRON_SECRET` ausente.
4. `[ya]` `npx vitest run` sobre src/lib/auth/adminSession.test.ts (por crear)
   termina en 0, con un caso que comprueba que `getAdminSession()` devuelve
   `null` y que se registró una línea con `Invalid server environment`. → E5, R4,
   R6. El caso espía `console.warn`, simula `next/headers` para que haya cookie y
   usa `vi.resetModules()`.
5. `[ya]` Ninguna de las tres claves aparece asignada a cadena vacía en
   `.env.example`. → E8. `grep -nE '^(SSO_JWT_SECRET|ADMIN_SESSION_SECRET|CRON_SECRET)=' .env.example`
   sin coincidencias (más estricto que el criterio, que solo prohíbe `=""`).
6. `[ya]` Con las tres claves sin valor, `bash .agent/init.sh` sigue terminando
   en `ENTORNO LISTO` e imprime el nombre del generador, no solo el aviso de sin
   valor en `.env`. → E1, R3. Se verifica sobre una copia de `.env` sin las tres,
   comprobando código 0, la cadena `ENTORNO LISTO` y el nombre del generador en
   la salida.
7. `[ya]` Una sesión de admin real responde 200 en `/admin` sin tocar `.env` a
   mano ni revertir nada después. → E4, R10. Vive en .agent/specs/F-029/smoke.sh
   (por crear), que se corre con el servidor de desarrollo levantado.
8. `[ya]` `bash .agent/verify.sh F-029 --full` termina con código 0. → E9.
9. `[nuevo]` El smoke de F-012 deja de saltar el criterio 5: con las tres claves
   generadas, `bash .agent/verify.sh F-012 --smoke` termina en 0 y su salida no
   contiene `SALTADO` para ese criterio; con `ADMIN_SESSION_SECRET` vacío,
   termina distinto de 0 con una línea `SMOKE FAIL` que nombra el generador.
   → E10. Es el pago real del feature —lo decidió el humano el 2026-08-31— y hoy
   ningún criterio del 1 al 8 lo cubre. Cuesta una corrida completa del smoke de
   F-012, que necesita Postgres, el seed y los emuladores arriba.

## Incongruencias detectadas

- **I1 — `SSO_JWT_SECRET` está en `serverSchema` y nadie la lee por ahí.**
  `src/lib/env.ts:10` la declara obligatoria, pero `src/app/admin/sso/route.ts:20`
  y `scripts/mint-sso-token.mjs:24` la leen de `process.env`. Es el mismo defecto
  que la propuesta fichó como I5 para `CRON_SECRET`, pero en la clave
  _obligatoria_: `ADMIN_SESSION_SECRET` es la única de las tres que de verdad
  pasa por el schema. Se queda como está por decisión del humano (2026-08-31): el
  criterio 3 exige que las tres vacías se nombren en el error, y la regla 3
  impide tocar ese criterio. O sea: hoy esa entrada del schema existe, en la
  práctica, **para el mensaje de error**. Anotado, no arreglado.
- **I2 — `CRON_SECRET`, lo mismo, y con dos consumidores.**
  `src/app/api/crons/_lib/guard.ts:11` (que F-019 extrajo de la ruta que citaba
  la propuesta, hoy inexistente ahí) y `scripts/renegotiate-order.mjs:67`. SP5 ya
  la dejó `.optional()` de verdad, así que su único efecto dañino —lanzar por un
  `""` que venía de `.env.example`— desaparece con E8.
- **I3 — CI ya lo resolvió y el arreglo nunca bajó.**
  `.github/workflows/ci.yml:181-183` escribe las tres con valores de relleno.
  La incongruencia no es de código: el repo sabía la respuesta y no la escribió
  donde se depura.
- **I4 — El playbook lo concluyó hace dos días y `.env.example` sigue igual.**
  `.agent/playbook/env-optional-secreto-vacio-rompe-serverenv.md` § Cómo se
  evita: «si una clave es verdaderamente opcional, `.env.example` no debería
  fijarla en `""`». Este feature es, sobre todo, ejecutar eso.
- **I5 — Dos convenciones para lo mismo dentro de `.env.example`.** Las tres
  claves locales de Storage se entregan como `=""` y se excluyen a mano del
  chequeo de `.agent/init.sh:53`; estas tres pasan a estar comentadas. La
  diferencia tiene una razón real —`SUPABASE_SERVICE_ROLE_KEY` es `.optional()`
  sin `.min()`, así que `""` la parsea sin ruido— pero el archivo queda con dos
  formas de decir «genera esto tú». No se unifica en este ciclo: tocar las claves
  de Storage arrastraría a `docker-compose.yml` y a F-028.
- **I6 — La ficha del playbook queda desactualizada al cerrar.** Su § Cómo se
  arregla manda rellenar `.env` a mano; con el generador, el arreglo pasa a ser
  un comando. Actualizarla es trabajo de quien cierre el feature, no de la spec.

## Huecos y preguntas al humano

Ninguno abierto que bloquee la construcción. SP1-SP3 se cerraron en la propuesta;
SP4 y SP5 los resolvió el humano y están escritos arriba como R6, R9 y § Fuera.

Queda **C9** propuesto como criterio nuevo (regla 3: un agente no toca ni añade
criterios en `.agent/features.json`). No bloquea: el comportamiento E10 entra
igual en el alcance por decisión expresa del humano, y C9 solo lo hace contable
al cerrar.

## No decidido a propósito

- **El nombre exacto del generador.** Se propone scripts/dev-secrets.mjs (por
  crear), en paralelo a `scripts/storage-dev-keys.mjs`. Ningún criterio lo
  nombra, así que `sdd-architect` puede cambiarlo; si lo hace, `.env.example`,
  `.agent/init.sh`, los guiones de humo y esta spec se mueven a la vez.
- **Unificar los dos generadores en uno.** Se desaconseja: las claves de Storage
  obligan a recrear contenedores después y estas no, así que un solo comando
  imprimiría instrucciones que la mitad de las veces no aplican. Decisión de
  arquitectura.
- **El nombre de la bandera `--force`** de E2b. La conducta —conservar lo válido
  por omisión, regenerar solo si se pide— sí está decidida.
- **Que `bash .agent/init.sh` llame solo al generador** cuando faltan las claves.
  Por omisión, **no**: escribir en `.env` sin que nadie lo pida es la clase de
  magia que después nadie encuentra.
- **Qué pasa con `SSO_JWT_SECRET` cuando el SSO real de cuadrecaja entre en
  juego**, más allá del aviso de E11: lo cerrará quien conecte los dos entornos.
