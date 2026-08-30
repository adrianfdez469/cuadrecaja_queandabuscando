---
propuesta: env-example-secretos-vacios
agente: sdd-spec
actualizado: 2026-08-29T17:53:19Z
estado: propuesta
---

## Problema

Un `.env` recién copiado de `.env.example` **rompe `serverEnv()` en silencio**, y
el síntoma que se ve no menciona el entorno por ninguna parte.

`.env.example` deja `SSO_JWT_SECRET=""`, `ADMIN_SESSION_SECRET=""` y
`CRON_SECRET=""`. `src/lib/env.ts:9-12` los declara con `.min(32)`, `.min(32)` y
`.min(16).optional()`. `.optional()` en Zod permite que la clave esté **ausente**,
no que valga `""`, así que `serverSchema.safeParse(process.env)` falla por los
tres y `serverEnv()` lanza `Invalid server environment — …` la primera vez que
cualquier ruta la llama.

Lo que lo hace caro no es el fallo, es dónde cae: `getAdminSession()`
(`src/lib/auth/adminSession.ts:52-62`) llama a `secret()` —que llama a
`serverEnv()`— **dentro** de un `try { … } catch { return null; }`. El `throw` se
traga entero y la función devuelve `null`, exactamente igual que si la cookie no
existiera. Desde fuera, `/admin` redirige con una cookie perfectamente firmada y
válida. No hay ningún error en pantalla, ningún 500, ninguna pista.

Le costó **una hora** a `sdd-tester` mientras verificaba el criterio 5 de F-012
(`.agent/specs/F-012/tests.md` § Entorno; ficha
`.agent/playbook/env-optional-secreto-vacio-rompe-serverenv.md`). El problema es
**anterior a F-012 y no depende de él**: solo salió a la luz cuando alguien
necesitó una sesión de admin de verdad.

Dos detalles que agrandan el problema y que conviene ver juntos:

- **No es solo `/admin`.** `src/lib/supabase/storage.ts` entra por `serverEnv()`
  en todas sus funciones, así que el mismo `.env` a medias también rompe la
  subida de imágenes del panel, y por el mismo camino opaco.
- **CI ya lo resolvió, el entorno local no.** `.github/workflows/ci.yml` fija
  `SSO_JWT_SECRET` y `ADMIN_SESSION_SECRET` a mano en su bloque `env:`, con el
  comentario «Dummy values: enough to satisfy validation». Es decir: alguien ya
  se topó con esto, lo arregló donde le dolía y el arreglo nunca bajó a la
  máquina de quien desarrolla.

## Alcance

### Dentro

- Que un `.env` recién copiado de `.env.example` llegue a un `serverEnv()` que
  **parsea**, sin que nada con forma de clave real viva en git.
- Un generador de secretos locales, scripts/dev-secrets.mjs (por crear), calcado
  del precedente `scripts/storage-dev-keys.mjs`: valores aleatorios por máquina,
  escritos solo en `.env`, que está en `.gitignore`.
- Que el fallo, cuando ocurra igualmente, **se vea**: distinguir «falta
  configuración» de «no hay sesión» en el único sitio donde hoy son
  indistinguibles.
- Coherencia en `.env.example` entre lo que una clave promete (`.optional()`) y
  cómo se entrega (`""`).
- Que `bash .agent/init.sh` diga el comando exacto, no «sin valor en .env:».

### Fuera (explícito)

- **Meter secretos de verdad en git.** `.env.example` ya explica por qué —
  «anything key-shaped committed here teaches the next person to paste a real
  key in the same slot» — y esa razón no se toca. Ni siquiera valores de mentira
  con forma de clave.
- **Gestores de secretos** (1Password, Doppler, Vault, `vercel env pull`).
- **Cambiar la configuración de producción** ni las variables de Vercel.
- **Rotación de secretos**, caducidad ni auditoría.
- **Cambiar la firma pública de `serverEnv()`** ni su tipo `ServerEnv`.
- **Tocar `src/lib/supabase/storage.ts`** ni ninguna otra ruta consumidora: el
  cambio de código es de dos archivos como mucho.

## Actores y precondiciones

**Actor: quien clona el repo o crea un worktree nuevo** —persona o agente— y
copia `.env.example` a `.env`. No hay actor de producto: esto no se ve desde la
tienda.

Precondición única: `.env` existe. Es el estado por omisión de cualquier worktree
recién creado, que es exactamente el escenario que muerde.

## Comportamiento esperado

- **E1 — Worktree nuevo.** Dado un `.env` recién copiado de `.env.example`,
  cuando se ejecuta `bash .agent/init.sh`, entonces el aviso nombra las tres
  claves **y el comando que las genera**, y el script sigue terminando en
  `ENTORNO LISTO` con código 0. Nadie que no toque admin queda bloqueado, igual
  que hoy pasa con Storage.
- **E2 — Generarlas.** Cuando se ejecuta el generador con `--write`, entonces las
  tres claves quedan en `.env` con valores aleatorios que cumplen los mínimos de
  `src/lib/env.ts`, el resto de `.env` queda intacto, y ninguna línea se duplica
  si ya existía (mismo reemplazo en sitio que hace `scripts/storage-dev-keys.mjs`).
- **E3 — Sin `--write`.** Cuando se ejecuta sin bandera, entonces imprime las
  líneas por salida estándar y **no escribe nada**, mismo contrato que el
  generador de Storage.
- **E4 — La sesión de admin funciona.** Dadas las claves generadas, cuando se
  monta un JWT de admin firmado con `ADMIN_SESSION_SECRET` y se pide `/admin`,
  entonces responde 200. Es el paso que hoy obliga a rellenar `.env` a mano en
  medio de una verificación y a revertirlo al terminar.
- **E5 — El fallo deja de ser mudo.** Dado un `.env` con
  `ADMIN_SESSION_SECRET=""`, cuando algo llama a `getAdminSession()`, entonces
  sigue devolviendo `null` —el comportamiento no cambia— pero el servidor escribe
  una línea que contiene `Invalid server environment` y **nombra la variable**.
  Una hora de depuración pasa a ser una línea de log.
- **E6 — Lo opcional es opcional de verdad.** Dado que `CRON_SECRET` está
  declarado `.optional()`, cuando la clave está **ausente** de `.env`, entonces
  `serverEnv()` parsea sin error. Hoy `.env.example` la entrega como `""`, que
  es la única forma de que `.optional()` no sirva de nada.

## Reglas de negocio

- **R1 — Nada con forma de clave en git.** Ni real, ni de mentira. Los valores
  los genera cada máquina y viven solo en `.env`.
- **R2 — El generador es idempotente** y no destruye el resto de `.env`.
- **R3 — Nada se vuelve obligatorio que no lo fuera.** `bash .agent/init.sh`
  sigue avisando con `warn`, nunca con `bad`; `ENTORNO LISTO` no depende de esto.
- **R4 — El comportamiento observable de `getAdminSession()` no cambia.** Sigue
  devolviendo `null` ante cualquier fallo; lo que cambia es que un fallo de
  configuración deja rastro. Una excepción propagada rompería rutas que hoy
  funcionan.
- **R5 — `.env.example` sigue siendo la lista completa** de todas las variables
  que la app lee. Comentar una clave no puede significar esconderla.

## Casos límite y errores

- **`.env` sin la clave** (no `""`, ausente): para `CRON_SECRET` debe pasar; para
  las dos obligatorias debe seguir fallando, pero con un mensaje que llegue.
- **Clave con espacios o comillas** al copiar y pegar: `.min()` la acepta si es
  larga. No se va a resolver, pero conviene que el generador escriba el formato
  correcto para que nadie la escriba a mano.
- **Ejecutar el generador dos veces**: reemplaza en sitio, no duplica líneas.
- **Ejecutarlo sin `.env`**: falla diciendo que copie `.env.example` primero,
  igual que hace hoy `scripts/storage-dev-keys.mjs`.
- **Un `.env` con las claves ya rellenas a mano**: el generador las pisa. Debe
  decirlo antes de hacerlo, o alguien perderá el secreto que compartía con
  cuadrecaja.
- **`SSO_JWT_SECRET` no es un secreto libre**: tiene que coincidir **exactamente**
  con el de cuadrecaja para que el SSO real funcione. Generar uno aleatorio sirve
  para arrancar y para probar en local contra tokens acuñados aquí, pero
  **rompería** un SSO real contra cuadrecaja. Es el caso límite que más importa y
  el generador tiene que avisarlo en su salida.

## Datos y contrato

Ningún dato nuevo, ninguna migración, ningún endpoint. Las tres variables ya
existen. Lo único que cambia de forma observable es cómo se entregan en
`.env.example` y de dónde salen sus valores locales.

Mínimos declarados hoy en `src/lib/env.ts`, que el generador debe respetar:
`SSO_JWT_SECRET` ≥ 32 caracteres, `ADMIN_SESSION_SECRET` ≥ 32,
`CRON_SECRET` ≥ 16 y opcional.

## Criterios de aceptación propuestos

Todos `[nuevo]`. Escritos para copiarse tal cual a `.agent/features.json`.

1. `[nuevo]` El generador de secretos locales —scripts/dev-secrets.mjs (por
   crear)— invocado con `--write` escribe las tres claves en `.env` con valores
   que cumplen los mínimos de `src/lib/env.ts`, sin duplicar líneas si ya
   existían, y `git status --porcelain` sale **vacío** después: nada con forma de
   clave llega a un archivo versionado.
2. `[nuevo]` Sin `--write`, el guion imprime las tres líneas por salida estándar
   y no modifica ningún archivo (comprobado con la marca de tiempo de `.env`).
3. `[nuevo]` `npx vitest run src/lib/env.test.ts` sale 0 con dos casos: con las
   tres claves en `""` —el estado literal de `.env.example`— `serverEnv()` lanza
   un error cuyo mensaje **nombra las tres**; con valores generados, parsea sin
   lanzar.
4. `[nuevo]` `npx vitest run src/lib/auth/adminSession.test.ts` sale 0 con un
   caso que, con `ADMIN_SESSION_SECRET=""` y una cookie válida, comprueba que
   `getAdminSession()` devuelve `null` **y** que se escribió una línea que
   contiene `Invalid server environment`.
5. `[nuevo]` `grep -nE '^(SSO_JWT_SECRET|ADMIN_SESSION_SECRET|CRON_SECRET)=""$' .env.example`
   no encuentra nada: ninguna clave con forma de secreto queda fijada a la cadena
   vacía. Las obligatorias apuntan al generador; `CRON_SECRET`, que es
   `.optional()`, queda comentada.
6. `[nuevo]` Con las tres claves sin valor, `bash .agent/init.sh` termina en
   `ENTORNO LISTO` con código 0 e imprime un aviso que contiene el nombre del
   generador —scripts/dev-secrets.mjs (por crear)— y no solo «sin valor en .env».
7. `[nuevo]` Tras generar las claves, una sesión de admin real funciona por HTTP:
   un JWT firmado con `ADMIN_SESSION_SECRET` en la cookie `qab-admin-session`
   obtiene **200** en `/admin`, sin tocar `.env` a mano ni revertir nada después.
8. `[nuevo]` `bash .agent/verify.sh --full` sale 0.

## Incongruencias detectadas

- **I5** — `CRON_SECRET` está declarado en `serverSchema`
  (`src/lib/env.ts:12`) pero su **único consumidor lo lee de `process.env`
  directamente** (`src/app/api/crons/purge-sso-tokens/route.ts:12`). Hoy, por
  tanto, su presencia en el schema no aporta validación a nadie y su único efecto
  observable es hacer que `serverEnv()` **lance** cuando `.env.example` la
  entrega como `""`. Es una variable que solo hace daño. Ver SP5.
- **I6** — `.github/workflows/ci.yml` fija `SSO_JWT_SECRET` y
  `ADMIN_SESSION_SECRET` con valores de relleno y el comentario «enough to
  satisfy validation». CI resolvió el problema hace tiempo y el arreglo nunca
  llegó al entorno local, que es donde se depura. La incongruencia no es de
  código: es que el repo ya sabía la respuesta y no la escribió donde se
  necesita.
- **I7** — La ficha del playbook dice, en § Cómo se evita, que «si una clave es
  verdaderamente opcional, `.env.example` no debería fijarla en `""`». Eso está
  escrito desde el 2026-08-29 y `.env.example` sigue haciéndolo. Esta propuesta
  es, sobre todo, ejecutar lo que esa ficha ya concluyó.

## Huecos y preguntas al humano

**SP4 — ¿Se puede tocar `src/lib/auth/adminSession.ts` para que el fallo de
configuración deje de ser mudo?**
Qué falta: permiso para cambiar tres líneas de código de un feature ya cerrado.
Por qué importa: sin eso, la propuesta arregla el **entorno** pero no la
**trampa**. El próximo `.env` a medias —el de otro worktree, el de otra persona,
el de un agente— vuelve a costar una hora, porque el síntoma seguirá siendo
indistinguible de «no hay sesión».
Opciones: (a) sí, distinguiendo en el `catch` el error de configuración y
escribiendo una línea de log, sin cambiar el valor devuelto (R4); (b) no tocar
código y quedarse solo con el generador y `.env.example`; (c) resolverlo en
`serverEnv()`, cacheando y logueando el fallo una sola vez.
**Recomiendo (a)**: es el cambio más pequeño que ataca la causa del coste real, y
no altera ni un comportamiento observable.

**SP5 — ¿`CRON_SECRET` es obligatoria, opcional o sobra?**
Qué falta: decidir qué es, porque hoy es las tres cosas a la vez (I5).
Por qué importa: si se queda `.optional()` y `.env.example` la deja comentada,
el problema desaparece sin código. Si se quiere que valide de verdad, hay que
hacer que la ruta de cron la lea por `serverEnv()`, y entonces pasa a ser
obligatoria en cualquier entorno con crons.
Opciones: (a) opcional de verdad: comentada en `.env.example`, generada por el
guion si alguien la quiere; (b) obligatoria, con la ruta de cron leyéndola por
`serverEnv()`; (c) fuera del schema, ya que su consumidor no lo usa.
**Recomiendo (a)**: es lo que la declaración ya promete y lo que menos código
mueve. (b) endurece la validación de una ruta que hoy no la tiene, pero convierte
un `.env` incompleto en un fallo de cron en producción, que es peor sitio para
descubrirlo.

## Coste estimado, honesto

**Pequeño: media sesión.** Un guion nuevo calcado de uno que ya existe, dos
tests, comentarios en `.env.example`, un aviso en `.agent/init.sh` y —si SP4 sale
que sí— tres líneas en `src/lib/auth/adminSession.ts`. Ningún riesgo técnico
identificado: no hay servicio nuevo, no hay migración, no hay dependencia nueva.

**Lo que ahorra**, medido y no estimado: la hora que ya costó una vez, más el
tiempo del ciclo entero en el que un agente rellena `.env` a mano en medio de una
verificación y tiene que acordarse de revertirlo al terminar —lo que
`.agent/specs/F-012/tests.md` deja documentado que ocurrió.

## No decidido a propósito

- **El nombre del guion.** Se propone scripts/dev-secrets.mjs (por crear), en
  paralelo a `scripts/storage-dev-keys.mjs`. Si `sdd-architect` prefiere unificar
  los dos generadores en uno, es una decisión suya; los criterios de aceptación
  se reescribirían con el nombre elegido.
- **Si el guion se llama solo** desde `bash .agent/init.sh` cuando faltan las
  claves. Tentador y peligroso: escribir en `.env` sin que nadie lo pida es
  justo el tipo de magia que después nadie encuentra. Por omisión, no.
- **Qué pasa con `SSO_JWT_SECRET` cuando el SSO real de cuadrecaja entre en
  juego** más allá del aviso que exige el caso límite: lo cerrará quien conecte
  los dos entornos.
