---
feature: F-029
agente: orquestador
actualizado: 2026-09-01T01:56:52Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Un comando, `node scripts/dev-secrets.mjs --write`, que genera de una vez los tres
secretos que hoy hay que rellenar a mano en `.env` — el del SSO, el de la sesión de
admin y el del cron — y que los deja solo en `.env`, que está en `.gitignore`. A
partir de ahí, montar un worktree nuevo y entrar al panel de administración deja de
ser una hora de depuración a ciegas.

Y cuando aun así falte alguno, se verá. Hoy `serverEnv()` lanza, `getAdminSession()`
se traga el error en su `catch` y `/admin` te redirige exactamente igual que si no
hubieras iniciado sesión: sin error, sin 500, sin pista. Pasará a escribirse una
línea en el servidor —una sola, no una por petición— que nombra la variable culpable
y el comando que la genera.

Lo que **no** cambia: nada de esto se ve desde la tienda, ninguna ruta cambia de
comportamiento, no hay migración, no hay dependencia nueva y no se toca el contrato
con cuadrecaja. `getAdminSession()` sigue devolviendo `null` ante cualquier fallo;
lo único que gana es rastro.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                               | Archivos                                                        | Criterio que acerca | Cómo se verifica                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | El generador, con sus cuatro modos: sin banderas imprime, `--write` escribe conservando lo que ya sirve, `--write --force` regenera, `--check` solo responde sí/no sin escribir nada.     | scripts/dev-secrets.mjs (por crear)                             | 1, 2                | Sin banderas imprime tres líneas y el `stat` de `.env` no cambia (c2). `--write` sobre un `.env` sin las claves las escribe y `git status --porcelain` queda vacío (c1). Repetirlo deja `grep -c` en 1 por clave. Sin `.env`, sale 1; `--force` solo, sale 2. |
| 2   | El registro en `serverEnv()`: un `warned` hermano de `cached`, y una línea por `console.warn` antes del `throw`. La firma y el tipo `ServerEnv` no cambian. Más sus seis casos de prueba. | `src/lib/env.ts` · src/lib/env.test.ts (por crear)              | 3                   | `npx vitest run src/lib/env.test.ts` en 0 y `npm run typecheck` en 0.                                                                                                                                                                                         |
| 3   | La prueba del camino opaco: con las claves vacías, `getAdminSession()` devuelve `null` **y** dejó línea; con claves buenas y cookie ilegible, `null` y silencio.                          | src/lib/auth/adminSession.test.ts (por crear)                   | 4                   | `npx vitest run src/lib/auth/adminSession.test.ts` en 0, y `git diff --stat src/lib/auth/adminSession.ts` **vacío**.                                                                                                                                          |
| 4   | Las tres claves dejan de ser asignaciones en `.env.example` y pasan a un bloque de comentarios que dice para qué sirve cada una y con qué comando se generan.                             | `.env.example`                                                  | 5                   | `grep -nE '^(SSO_JWT_SECRET\|ADMIN_SESSION_SECRET\|CRON_SECRET)=' .env.example` sin coincidencias, y los tres nombres presentes dentro de comentarios.                                                                                                        |
| 5   | El bloque `== Secretos de desarrollo ==` en el arnés, que delega el predicado en `--check` y avisa con `warn` y el comando literal. Tres ramas, incluida «no se pudo comprobar».          | `.agent/init.sh`                                                | 6                   | Sobre una copia de `.env` sin las tres claves: `bash .agent/init.sh` sale 0, imprime `ENTORNO LISTO` y el nombre del generador. Con las tres generadas, la línea pasa a `ok`.                                                                                 |
| 6   | El humo del feature: guardián que no escribe, testigo `sha256` de `.env`, el 307 sin cookie, acuñar y canjear el token SSO, el 200 con cookie, el 307 con cookie basura, y limpieza.      | .agent/specs/F-029/smoke.sh (por crear)                         | 7                   | `bash .agent/verify.sh F-029 --smoke` en 0, y el `sha256` de `.env` idéntico antes y después.                                                                                                                                                                 |
| 7   | El salto de F-012 pasa a fallo duro: el guardián sube al principio del guion y ABORTA la corrida entera (PP2); las cuatro aserciones del criterio 5 quedan sin condición.                 | `.agent/specs/F-012/smoke.sh`                                   | 9                   | `bash .agent/verify.sh F-012 --smoke` en 0 y su salida sin `SALTADO` para el criterio 5. La mitad negativa, según PP2.                                                                                                                                        |
| 8   | El sensor completo, al final y solo al final.                                                                                                                                             | —                                                               | 8                   | `bash .agent/verify.sh F-029 --full` en 0.                                                                                                                                                                                                                    |
| 9   | Cierre: la ficha del playbook deja de mandar rellenar `.env` a mano y pasa a nombrar el comando.                                                                                          | `.agent/playbook/env-optional-secreto-vacio-rompe-serverenv.md` | —                   | `npm run check:harness` en 0.                                                                                                                                                                                                                                 |

## De dónde sale cada paso

| Paso | Sale de                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § D1 y § Contratos → CLI del generador. Escenarios E2, E2b, E3, E11 de `spec.md`.                                                              |
| 2    | Decisión del humano del 2026-08-31 (SP4, opción c), recogida en `spec.md` § R6-R8 y en `architecture.md` § D3. Escenarios E5, E6, E7.                            |
| 3    | `spec.md` § E5 y R4; `architecture.md` § Pruebas → adminSession. El criterio 4 de `features.json` lo exige por su nombre.                                        |
| 4    | `spec.md` § E8 y R5; `architecture.md` § Contratos → `.env.example`. Ejecuta lo que la ficha del playbook ya concluyó (I4).                                      |
| 5    | `architecture.md` § D2. Es la respuesta al riesgo principal que `spec.md` § Casos límite identificó: comentar las claves las saca del bucle de `.agent/init.sh`. |
| 6    | `spec.md` § E4 y R10; `architecture.md` § Pruebas → smoke de F-029.                                                                                              |
| 7    | Decisión del humano del 2026-08-31; `spec.md` § E10; `architecture.md` § D4.                                                                                     |
| 8    | Criterio 8 de `features.json`.                                                                                                                                   |
| 9    | `spec.md` § I6; `architecture.md` § Orden de construcción, «tarea de cierre».                                                                                    |

Ningún paso sale de mi cabeza: los nueve están trazados arriba.

## Qué queda fuera

- **Arreglar que `SSO_JWT_SECRET` no se lea nunca por `serverEnv()`** (I1). Sigue
  declarada obligatoria en el schema mientras sus consumidores reales
  (`src/app/admin/sso/route.ts:20`, `scripts/mint-sso-token.mjs:24`) la leen de
  `process.env`. Decisión tuya del 2026-08-31: se ficha, no se arregla. Lo mismo con
  `CRON_SECRET` (I2). En la práctica, esas dos entradas del schema existen hoy **para
  el mensaje de error** — el criterio 3 las necesita ahí.
- **Tocar `src/lib/auth/adminSession.ts`.** Es de F-008, cerrado. El registro nace
  aguas arriba, en `serverEnv()`, y el criterio 4 se cumple igual.
- **Cambiar la firma de `serverEnv()` o el tipo `ServerEnv`**, o exportar cualquier
  utilidad que solo usen las pruebas.
- **Unificar los dos generadores** ni extraer un módulo común de «upsert en `.env`».
  Seis líneas compartidas no pagan editar `scripts/storage-dev-keys.mjs`, que hoy
  funciona y cuyo modo de fallo (401 opacos del emulador) es caro.
- **Unificar las dos convenciones de `.env.example`** (I5): las tres claves de Storage
  siguen entregándose como `=""`. Tocarlas arrastraría `docker-compose.yml` y F-028.
- **`QAB_BEARER_TOKEN`**, que también está vacío: se acuña con `npm run mint:token` y
  no pasa por `serverEnv()`.
- **`.github/workflows/ci.yml`**, `docs/despliegue.md` y `src/lib/supabase/storage.ts`.
  CI ya funciona y sus valores de relleno superan los mínimos; en producción las tres
  se siguen fijando en el entorno del despliegue; y `storage.ts` se beneficia del
  registro sin que haya que tocarlo.
- **Gestores de secretos, rotación, caducidad y auditoría.**
- **Que `.agent/init.sh` genere las claves solo**, sin que nadie se lo pida. Escribir
  en `.env` por sorpresa es la clase de magia que después nadie encuentra.

## Riesgos y plan B

| Riesgo                                                                                                                                                                                             | Cómo se notaría                                                    | Plan B                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **El principal: el aviso se vuelve silencio.** Al comentar las tres claves salen del bucle de `.agent/init.sh:53`, que se alimenta de `grep '^[A-Z_]+=' .env.example`. Sin el paso 5, nadie avisa. | El criterio 6 falla: `bash .agent/init.sh` no nombra el generador. | El paso 5 existe justamente para esto, con tres ramas para que un generador roto no se lea como `ok`. Si fallara, se revierte el paso 4 y las claves vuelven a ser asignaciones. |
| La línea nueva pone roja la etapa smoke de otro feature (`.agent/verify.sh` graba `⨯\|Unhandled\|Error:`).                                                                                         | Cualquier `--smoke` del repo se pone rojo sin que nada esté roto.  | Verificado en el archivo, no de memoria, y fijado como aserción `not.toContain` en el test para que un cambio de redacción lo pesque `npm test`.                                 |
| La caché de módulo hace inobservable el «una sola línea».                                                                                                                                          | El test de R7 pasaría por la razón equivocada.                     | `vi.resetModules()` + `await import()` dentro de cada caso, y un caso que reimporta a propósito para volver a ver la línea.                                                      |
| Los mínimos (32/32/16) se desincronizan entre schema, generador e init.                                                                                                                            | El generador escribiría valores que `serverEnv()` rechaza.         | Un solo predicado (`--check`) para los tres consumidores del arnés, más un caso de deriva que fija los tres números.                                                             |
| El humo de F-012 aborta entero en una máquina sin claves.                                                                                                                                          | Una corrida de F-012 sale roja por entorno, no por código.         | Es la conducta que pediste; el radio se decide en PP2, con plan B de degradar a fallo del criterio 5 sin abortar.                                                                |

**Nada de lo prohibido.** No hay migración de datos, no se toca
`docs/sync-contract.md`, no hay ningún comando de los que `AGENTS.md` marca como
prohibidos (`prisma migrate reset`, `prisma db push`), no se instala ninguna
dependencia y no se toca el proxy. No hace falta ADR: ninguna capa cambia y todo es
reversible borrando un archivo y cuatro bloques.

## Coste

**Dos ciclos de agente**: uno de `sdd-implementer` (pasos 1-5 y 9) y uno de
`sdd-tester` (pasos 6-8, que son los que se ejecutan de verdad contra un servidor
levantado). Media sesión, como estimó la propuesta.

**Lo que se toca de lo que ya funciona**, y es poco: `src/lib/env.ts` gana un booleano
y un `console.warn` sin cambiar su firma; `.env.example` y `.agent/init.sh` cambian
prosa y un bloque; `.agent/specs/F-012/smoke.sh` pierde una condición. Cinco archivos
nuevos, todos aditivos.

**Marcha atrás a mitad**: se borran los cuatro archivos nuevos y se revierten cuatro
diffs pequeños. Nada queda a medias en la base de datos ni en el contrato, porque no
los toca. Lo único con memoria fuera de git es `.env`, que es de cada máquina — y el
generador conserva por omisión lo que ya sirve, así que ni siquiera pisa un
`SSO_JWT_SECRET` acordado con cuadrecaja.

## Preguntas antes de aprobar

Las tres se resolvieron el 2026-08-31, antes de firmar. Ninguna queda abierta.

**PP1 — El criterio 9 entra.** Respuesta: «Sí, añádelo». Ya está escrito en
`.agent/features.json` con el texto aprobado literal, y F-029 pasa de 8 a 9
`acceptance_criteria`. El paso 7 queda contable al cerrar. La provenencia queda
anotada en las `notes` del feature: la añadió el orquestador transcribiendo la
decisión, no por iniciativa propia (regla 4).

**PP2 — El guardián aborta la corrida entera de F-012.** Respuesta: «Aborta
entero». Va al principio del guion, junto al `cd`: `SMOKE FAIL` nombrando el
generador y salida 1, sin ejecutar ninguna aserción. Se pierde la cobertura del
resto de F-012 en esa corrida, y es a propósito: un informe con treinta `ok` y un
fallo enseña a convivir con el fallo. El paso 7 y `architecture.md` § D4 ya lo
describen así; AP1 del arquitecto queda cerrada por (a).

**PP3 — El probador puede vaciar `ADMIN_SESSION_SECRET` temporalmente.**
Respuesta: «Sí, con copia y trap». Condiciones, que son parte de la autorización:
copia de seguridad de `.env` antes de tocarlo, un `trap` que lo restaure pase lo
que pase —incluida una interrupción—, y `node scripts/dev-secrets.mjs --check` en
0 al terminar como prueba ejecutada de que quedó como estaba. Es la única forma
de **ejecutar** la mitad negativa del criterio 9 en vez de leerla, que es lo que
la regla 1 del proyecto prohíbe. AP2 del arquitecto queda cerrada por (a).

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-029 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-01T01:56:52Z — aprobado por el humano: «Apruebo, adelante»
