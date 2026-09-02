---
feature: F-030
agente: sdd-architect
actualizado: 2026-09-02T00:17:29Z
estado: listo
---

## Estado actual relevante

Lo que ya existe y **se reutiliza tal cual**, leído en el código, no deducido:

- `src/features/account/server/orderIdentity.ts` (36 líneas). Comprueba la
  cookie, arranca la rama de resolución, la corre contra un `setTimeout` de
  `ORDER_CUSTOMER_LINK_TIMEOUT_MS` con `Promise.race` y devuelve
  `Promise<string | null>`. Un `try/catch` exterior garantiza que nunca rechaza.
  **Esta es la única función que conoce los tres desenlaces que hoy colapsan en
  el mismo `null`**, y por eso la observación tiene que nacer aquí dentro.
- `src/app/api/orders/route.ts`. Llama a `resolveOrderCustomerId()` sin `await`
  en la línea 24 y pasa la promesa a `createOrder`. Ya usa `after()` de
  `next/server` para `ringOrderBell`. **No cambia en este feature.**
- `src/features/orders/server/createOrder.ts:285`. Hace el único `await` de esa
  promesa, justo antes del `INSERT`. **No cambia.**
- `src/constants/account.ts`. `ORDER_CUSTOMER_LINK_TIMEOUT_MS = 600` y el estilo
  de comentario que se copia para la constante nueva.
- `src/lib/supabase/config.ts`. `isSupabaseAuthConfigured()`: dos lecturas de
  `process.env.NEXT_PUBLIC_*`, sin red, sin Zod, sin `@/lib/env`.
- `src/lib/auth/customerSession.ts`. `hasCustomerSessionCookie()` y
  `getCustomerUser()`. **No se toca ni uno de los dos**: el instrumento observa
  desde fuera lo que ya devuelven. El comentario de `getCustomerUser()` que
  documenta como virtud la indistinguibilidad de los fallos sigue siendo cierto
  (I4) y es justo lo que obliga a R12.
- `src/features/account/server/orderIdentity.test.ts`. Seis casos, con
  `hasCustomerSessionCookie`, `getCustomerUser` y `findCustomerIdByUserId` ya
  mockeados y con el caso de la resolución colgada ya escrito. Los nueve casos
  del criterio 6 se añaden **aquí**, no en un archivo nuevo.
- `src/features/account/boundaries.test.ts`. Cuatro guardas de texto. Ninguna
  pieza de este feature las cruza: nada nuevo importa `@supabase/*`, nada nuevo
  lleva `"use client"`, nada nuevo entra en `src/features/orders/` ni en
  `src/app/[slug]/`, y el `matcher` de `src/proxy.ts` no se toca (R6).
- **Precedentes que se copian, no se inventan**:
  - `src/features/orders/server/status.ts:103` —
    `console.warn("[orders] …", { … })` con objeto estructurado detrás: la forma
    exacta de la línea.
  - `src/features/orders/server/bell.ts` § comentario de `ringOrderBell` — dice
    literalmente que un callback de `after()` que lanza hace que Next imprima la
    excepción, «que es exactamente lo que vigila el guardián de errores de
    servidor de `.agent/verify.sh`», y que `after()` mantiene viva la invocación
    **solo mientras la promesa que se le dio siga pendiente**. Las dos frases
    gobiernan la decisión DA2.
  - `src/features/catalog/server/searchLog.ts` + `src/app/[slug]/buscar/page.tsx`
    — el patrón `after()` para trabajo posterior a la respuesta.
  - `src/constants/orders.ts:47-67` — `ORDER_PROPOSAL_DECISION` /
    `ORDER_RESPONSE_OUTCOME`: objeto `as const` más tipo derivado. En `src/` no
    hay **ni un** `enum` de TypeScript.
  - `.agent/verify.sh` `correr_smoke` / `correr_visual`, `puerto_libre`,
    `servidor_propio`, `guardian_servidor`, `extract_signature`: la etapa nueva
    se monta con estas mismas piezas.
  - `scripts/auth-otp.mjs` — `--mode app --cookie-jar <f> --json` deja la cookie
    de sesión lista para un `Cookie:`; `scripts/place-order.mjs` — la forma de
    cotizar, pedir y leer la fila con `pg`.

Y lo que **no** existe y hay que crear: el módulo que emite, el guion del probe,
la etapa `probe` del sensor, y los tres valores que faltan en `src/constants/`.

## Decisión

Se añade **un instrumento pasivo** que vive junto a la única función que conoce
el desenlace, y **cero** cambios en el camino del pedido.

1. Los seis desenlaces y el umbral se declaran en `src/constants/account.ts`.
2. Un módulo hermano nuevo, src/features/account/server/orderLinkObserver.ts
   (por crear), es **el único sitio del repo que llama a `console.warn` con el
   prefijo `[orders] customer link`**. Tiene el reloj, la regla de qué desenlace
   es cuál, y la programación de la línea `late`.
3. `src/features/account/server/orderIdentity.ts` conserva su firma, su techo,
   su `Promise.race` y su `try/catch`, y gana **tres llamadas** al observador.
   La rama perdedora se neutraliza en el momento de crearla, de modo que un
   rechazo tardío es imposible por construcción (R13).
4. `src/app/api/orders/route.ts`, `src/features/orders/server/createOrder.ts`,
   `prisma/schema.prisma`, `docs/sync-contract.md` y `package.json`: **sin
   tocar**.
5. La verificación tiene dos mitades: nueve casos en
   `src/features/account/server/orderIdentity.test.ts` (CI, `npm test`) y una
   etapa nueva `probe` en `.agent/verify.sh` que ejecuta
   scripts/order-link-probe.mjs (por crear) contra el Auth real de F-028
   retrasado a propósito.

Alternativas descartadas, una línea cada una:

- **Emitir desde `src/app/api/orders/route.ts` con `after()`**: la ruta no
  conoce el desenlace, y para conocerlo habría que cambiar lo que
  `resolveOrderCustomerId()` devuelve — exactamente lo que R11 protege.
- **Emitir dentro de `resolveOrderCustomerId()`, sin módulo aparte**: menos
  archivos, pero mezcla la carrera con el formato de la línea en una función que
  hoy cabe en una pantalla y cuyo contrato («nunca rechaza, nunca pasa del
  techo») es lo que más caro sale de romper.
- **Una fila en Postgres al estilo de `src/features/catalog/server/searchLog.ts`**:
  cerrada por las `notes` del feature y por SP3 — es el escalón siguiente, no
  este.
- **Un contador en memoria** con volcado periódico: R10; en serverless cada
  instancia tendría el suyo y la suma no existiría en ninguna parte.
- **Bajar el techo para provocar el fallo en la verificación**: prohibido por
  R11; lo que se retrasa es Auth, no el reloj.

## Componentes

| Componente                                                              | Capa                     | Responsabilidad                                                                                                   | Archivo                                                               |
| ----------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `ORDER_CUSTOMER_LINK_SLOW_MS`, `ORDER_LINK_OUTCOME`, `OrderLinkOutcome` | `src/constants/`         | El umbral de 300 ms y los seis desenlaces, nunca literales sueltos                                                | `src/constants/account.ts` (se amplía)                                |
| `startOrderLinkWatch()` y su tipo `OrderLinkWatch`                      | `src/features/*/server/` | Reloj monótono, regla de desenlace, la única llamada a `console.warn` con el prefijo, y la programación de `late` | src/features/account/server/orderLinkObserver.ts (por crear)          |
| `resolveOrderCustomerId()`                                              | `src/features/*/server/` | Lo mismo que hoy, más tres llamadas al observador. Misma firma, mismo techo, mismo `Promise.race`                 | `src/features/account/server/orderIdentity.ts`                        |
| Nueve casos unitarios (criterio 6)                                      | test (proyecto `node`)   | Un caso por desenlace más los dos «cero líneas», espiando `console.warn`                                          | `src/features/account/server/orderIdentity.test.ts`                   |
| Etapa `probe`                                                           | arnés                    | Precondiciones (servidor ajeno, puerto), captura de la salida del servidor, guardián y firma `PROBE FAIL`         | `.agent/verify.sh`                                                    |
| Guion del probe                                                         | `scripts/`               | Proxy lento, su propio `next dev`, las corridas A–G y la limpieza                                                 | scripts/order-link-probe.mjs (por crear)                              |
| `etapa:` con `visual` y `probe` (I6)                                    | arnés                    | Que una ficha nacida de un fallo del probe tenga valor legal que poner                                            | `.agent/playbook/TEMPLATE.md`                                         |
| Línea de convención de registro                                         | documentación            | Cómo se registra en este repo (hoy es costumbre y no está escrita)                                                | `AGENTS.md` § Cosas que muerden                                       |
| Ficha del playbook                                                      | arnés                    | La misma lección, con su firma, para que el sensor la saque solo                                                  | una ficha nueva en `.agent/playbook/`, con `bash .agent/sdd.sh learn` |

**Sin componente**: `src/app/api/orders/route.ts` no cambia,
`src/features/orders/**` no cambia, no hay componente de cliente, no hay ruta
nueva, no hay esquema Zod nuevo.

## Flujo de datos

`POST /api/orders`, camino **con** cookie de cliente y Auth configurado:

1. La ruta llama a `resolveOrderCustomerId()` **sin `await`** (igual que hoy).
2. `hasCustomerSessionCookie()`. Si es `false` → `return null` **antes de crear
   nada**: cero relojes, cero llamadas, cero líneas (R4, E1). Si lanza → el
   `try/catch` exterior devuelve `null` y **tampoco** se emite nada: nunca se
   estableció que hubiera sesión.
3. `isSupabaseAuthConfigured()`. Si es `false`, no se crea el observador y el
   resto sigue **exactamente igual que hoy** (E9, R12). Es una lectura de
   `process.env` que Next reemplaza por un literal al compilar: sin red, sin
   Zod, sin coste medible.
4. `startOrderLinkWatch()` toma `t0 = performance.now()`.
5. Se crea la rama de resolución y **se neutraliza en el acto**: su rechazo se
   convierte en `{ kind: "error" }` con un `.catch` adjuntado en la misma
   expresión que la crea. A partir de aquí la rama **no puede rechazar**, gane o
   pierda la carrera (R13).
6. `Promise.race([attempt, timeout])`, con el mismo `setTimeout` y la misma
   `ORDER_CUSTOMER_LINK_TIMEOUT_MS` de DA2 de F-012.
7. Según quién gane:
   - **Gana la resolución** → `watch.settled(resolution)`, que emite `slow`,
     `unverified`, `no_customer`, `error` o **nada** (enlace por debajo del
     umbral, E2). `resolveOrderCustomerId()` devuelve el `customerId` o `null`,
     igual que hoy.
   - **Gana el temporizador** → `watch.timedOut(attempt)`, que emite `timeout`
     **ya** (mientras la petición sigue viva) y deja programada la línea `late`
     sobre `attempt`. Devuelve `null`, igual que hoy.
8. `createOrder` hace su `await` (línea 285), escribe la fila y la ruta responde.
9. Con la respuesta ya fuera, la rama perdedora termina y emite `late` con
   `lateMs` y `resolved`. Si el runtime congela la invocación antes, se pierde
   `late` —nunca el `timeout`, que ya se emitió en el paso 7—.

Qué línea sale en cada caso, exhaustivo:

| Situación                                          | Líneas | Cuándo se emiten                          |
| -------------------------------------------------- | ------ | ----------------------------------------- |
| Invitado (sin cookie)                              | 0      | —                                         |
| Auth sin configurar, con cookie                    | 0      | —                                         |
| `hasCustomerSessionCookie()` lanza                 | 0      | —                                         |
| Enlace por debajo de 300 ms                        | 0      | —                                         |
| Enlace entre 300 ms y el techo                     | 1      | `slow`, antes de la respuesta             |
| Sesión no verificable / sin `Customer` / excepción | 1      | `unverified`/`no_customer`/`error`, antes |
| Gana el temporizador                               | 1 + 1  | `timeout` antes; `late` después, si llega |

## Contratos

### La línea (R1, R3)

```ts
console.warn("[orders] customer link", {
  outcome, // OrderLinkOutcome
  elapsedMs, // Math.round(performance.now() - t0)
  ceilingMs, // ORDER_CUSTOMER_LINK_TIMEOUT_MS
  // lateMs y resolved SOLO en "late"
});
```

Nada más. Ni `storeSlug`, ni `Customer.id`, ni `user.id`, ni el mensaje de la
excepción, ni el código del pedido (R3, R2). El prefijo se escribe **literal**,
ver DA9.

### Constantes nuevas, en `src/constants/account.ts`

```ts
/** F-030 R1/E3: mitad del techo. Por encima de esto, un enlace que SÍ ocurre
 *  ya avisa; por encima del techo, deja de ocurrir. Decisión del humano. */
export const ORDER_CUSTOMER_LINK_SLOW_MS = 300;

/** F-030 R1: los seis desenlaces observables de un intento de enlace. */
export const ORDER_LINK_OUTCOME = {
  SLOW: "slow",
  TIMEOUT: "timeout",
  LATE: "late",
  UNVERIFIED: "unverified",
  NO_CUSTOMER: "no_customer",
  ERROR: "error",
} as const;
export type OrderLinkOutcome = (typeof ORDER_LINK_OUTCOME)[keyof typeof ORDER_LINK_OUTCOME];
```

`ORDER_CUSTOMER_LINK_TIMEOUT_MS` **no se toca**.

### El observador, src/features/account/server/orderLinkObserver.ts (por crear)

```ts
export type OrderLinkResolution =
  | { kind: "linked"; customerId: string }
  | { kind: "unverified" }
  | { kind: "no_customer" }
  | { kind: "error" };

export type OrderLinkWatch = {
  /** La resolución ganó la carrera. Emite slow | unverified | no_customer |
   *  error, o NADA si enlazó por debajo del umbral. NUNCA lanza. */
  settled(resolution: OrderLinkResolution): void;
  /** Ganó el temporizador. Emite `timeout` ahora y programa `late` sobre la
   *  rama perdedora, que ya no puede rechazar. NUNCA lanza. */
  timedOut(attempt: Promise<OrderLinkResolution>): void;
};

/** Un reloj por intento. Sin estado de módulo (R10, E11). */
export function startOrderLinkWatch(): OrderLinkWatch;
```

Reglas que el módulo implementa, y que son el contrato de verdad:

| Entrada de `settled` | `elapsedMs` | Sale                          |
| -------------------- | ----------- | ----------------------------- |
| `linked`             | `< 300`     | nada                          |
| `linked`             | `>= 300`    | `slow`                        |
| `unverified`         | cualquiera  | `unverified`                  |
| `no_customer`        | cualquiera  | `no_customer`                 |
| `error`              | cualquiera  | `error`, sin mensaje ni clase |

`slow` es **exclusivo del enlace que sí ocurrió**: una resolución que acaba en
`unverified` a los 400 ms emite **su** línea con `elapsedMs: 400`, no una
segunda `slow` (R1, y la spec lo fija).

`lateMs = Math.max(1, Math.round(elapsed - ceilingMs))`. El `max(1)` existe
porque el contrato promete `lateMs > 0` y un adelanto de fracción de
milisegundo del temporizador imprimiría `0`, que se leería como «llegó a
tiempo». `resolved` es `resolution.kind === "linked"`.

El desenlace lo decide **quién ganó la carrera, no el reloj**: si la resolución
gana por microsegundos y `elapsedMs` redondea a 600, la línea sigue siendo
`slow`, porque el pedido **sí** quedó enlazado. Decir `timeout` ahí sería mentir
sobre lo único que el criterio 3 tiene que distinguir.

### `resolveOrderCustomerId()` — la forma, no el código

```ts
export async function resolveOrderCustomerId(): Promise<string | null> {
  try {
    if (!(await hasCustomerSessionCookie())) return null; // R4: el invitado no paga nada
    const watch = isSupabaseAuthConfigured() ? startOrderLinkWatch() : null; // R12/E9

    // El .catch va adjunto a la creación: la rama YA NO PUEDE rechazar,
    // gane o pierda la carrera (R13).
    const attempt: Promise<OrderLinkResolution> = resolveOnce().catch(
      () => ({ kind: "error" }) as const,
    );
    const timeout = new Promise<null>((resolvePromise) => {
      setTimeout(() => resolvePromise(null), ORDER_CUSTOMER_LINK_TIMEOUT_MS);
    });

    const winner = await Promise.race([attempt, timeout]);
    if (winner === null) {
      watch?.timedOut(attempt);
      return null;
    }
    watch?.settled(winner);
    return winner.kind === "linked" ? winner.customerId : null;
  } catch {
    return null; // incluye que la comprobación de cookie lance: 0 líneas
  }
}
```

La firma no cambia, `createOrder` sigue recibiendo `Promise<string | null>` con
su valor por omisión, y el `Promise.race` contra el mismo `setTimeout` sigue
siendo el mecanismo (R11).

### La etapa `probe` de `.agent/verify.sh`

Contrato entre el sensor y el guion, para que cada uno haga solo lo suyo:

| Dirección      | Nombre             | Significado                                                              |
| -------------- | ------------------ | ------------------------------------------------------------------------ |
| sensor → guion | `PROBE_PORT`       | Puerto **ya comprobado libre** donde el guion levantará su `next dev`    |
| sensor → guion | `PROBE_SERVER_LOG` | Archivo donde el guion vuelca la salida de su servidor, en modo `append` |
| guion → sensor | código de salida   | 0 todo bien; distinto de 0, algo falló                                   |
| guion → sensor | `PROBE FAIL …`     | Una línea por fallo, al principio de la línea, para `extract_signature`  |

Puntos de edición en `.agent/verify.sh`, todos calcados de `visual`:

1. `PROBE_PORT="${PROBE_PORT:-3102}"` junto a `SMOKE_PORT` y `VISUAL_PORT`, con
   la misma nota de por qué es distinto de los otros dos.
2. `stage_cmd`: `probe)` con una descripción entre paréntesis, como `smoke` y
   `visual`.
3. `extract_signature`: `probe) line="$(grep -aoE 'PROBE FAIL.*' "$log" | head -1)" ;;`.
4. `correr_etapa`: una rama más que llama a `correr_probe`.
5. `cmd_verify`: `--probe) probe=1 ;;`, el `die_uso` que exige `F-NNN` y el
   añadido de la etapa. `probe` **no** entra en `STAGES_COMPLETO` ni en
   `STAGES_RAPIDO`.
6. `correr_probe`, que es donde está la única diferencia real con las otras dos
   etapas (I5):

```bash
correr_probe() { # <log>
  # 1. El guion existe (si no: PROBE FAIL, como smoke y visual).
  # 2. servidor_propio → si devuelve un puerto, NO se reutiliza: se FALLA.
  #    "PROBE FAIL ya hay un next dev de este worktree en el puerto N.
  #     Esta etapa no puede reutilizarlo: necesita arrancar el suyo con
  #     NEXT_PUBLIC_SUPABASE_URL apuntando a su proxy lento y necesita
  #     capturar su salida en un archivo propio. Ciérralo y repite."
  # 3. puerto_libre "$PROBE_PORT" "PROBE FAIL" "$log" || return 1
  # 4. srvlog="$(mktemp)"; PROBE_PORT=… PROBE_SERVER_LOG="$srvlog" \
  #      node scripts/order-link-probe.mjs >>"$log" 2>&1 ; code=$?
  # 5. Volcar `tail -120 "$srvlog"` al log de la etapa, con su cabecera
  #    "--- salida del servidor (runtime feedback) ---" (aquí SIEMPRE se
  #    captura: no existe el caso "servidor reutilizado").
  # 6. guardian_servidor "$srvlog" "PROBE FAIL" "$log" || code=1   ANTES del rm.
  # 7. Comprobar que el puerto volvió a quedar libre (hasta ~5 s de espera): si
  #    no, PROBE FAIL — un next dev huérfano rompe la etapa smoke de CUALQUIER
  #    otro feature (AGENTS.md § "Un solo next dev por directorio").
  # 8. rm -f "$srvlog"; return $code
}
```

El guardián se **reutiliza tal cual**: `SERVIDOR_ERROR_RE` sigue siendo la única
definición de «el servidor petó», y el guion no la reimplementa en JavaScript.
Las líneas del instrumento no lo disparan: empiezan por `[orders]`, no llevan
`⨯` ni `Unhandled`, y `outcome: 'error'` va en minúscula y a mitad de línea
(I2 — el patrón exige **principio** de línea y `Error` con mayúscula).

### El guion, scripts/order-link-probe.mjs (por crear)

Node ESM, sin dependencias nuevas: `node:http`, `node:child_process`,
`node:timers/promises`, `fetch` global, `pg` y `dotenv` (ya en el repo, los usa
`scripts/place-order.mjs`).

**Piezas**

1. **Proxy lento**, `http.createServer` escuchando en **puerto 0** (efímero, lo
   elige el sistema: así no hay un segundo puerto que comprobar ni que negociar
   con `verify.sh`). Reenvía cada petición a `SUPABASE_UPSTREAM`
   (`http://localhost:54321` por omisión, o `NEXT_PUBLIC_SUPABASE_URL` del
   `.env`) **después de esperar el retraso vigente**, y copia estado, cabeceras
   y cuerpo de vuelta. El retraso es una variable del propio proceso
   (`state.delayMs`), así que cambiarlo entre corridas es una asignación: **una
   sola arrancada del servidor cubre A–E**.
2. **Servidor propio**: `npx next dev -p $PROBE_PORT`, con
   `NEXT_PUBLIC_SUPABASE_URL=http://localhost:<puerto del proxy>` y el resto del
   entorno heredado, `stdio` redirigido a `PROBE_SERVER_LOG` en modo append.
   Espera a que `GET /` responda (hasta 90 s; `next dev` compila).
3. **Sesión**: `scripts/auth-otp.mjs` invocado con `node`, en modo `app`, contra
   el puerto del probe y con `--cookie-jar`, `--json` y un `--email` único por
   corrida; con el retraso a 0. La cookie sale del frasco del `--cookie-jar` y
   el `Customer.id` esperado se lee de Postgres por `email`.
4. **Pedido**: cotiza con `POST /api/orders/quote` y pide con
   `POST /api/orders`, con y sin `Cookie:`. Las dos consultas SQL que hacen
   falta —elegir un `StoreProduct` vendible de `tienda-demo` y leer el `Order`
   por `code`— se **duplican** aquí a propósito: `scripts/place-order.mjs` está
   FUERA por decisión de la spec (no manda `Cookie` y eso **es** la prueba del
   criterio 4 de F-010), así que no se refactoriza para compartirlas.
5. **Lector de líneas**: lee `PROBE_SERVER_LOG` desde el desplazamiento en bytes
   anotado antes de cada corrida, quita códigos ANSI, busca el prefijo literal
   `[orders] customer link` y, sobre el trozo que sigue a cada aparición,
   extrae con patrones tolerantes `outcome:\s*'([a-z_]+)'`, `elapsedMs:\s*(\d+)`
   y los demás. **Nunca** compara contra JSON: `console.warn` imprime con la
   inspección de Node, con comillas simples y **partiendo el objeto en varias
   líneas si se pasa de ancho**. Para `late`, espera activa con margen (el
   retraso vigente más unos segundos) antes de dar la línea por ausente.
6. **Limpieza**, en `finally` y también en `SIGINT`/`SIGTERM`: borra los `Order`
   creados **por su `code`** (los `OrderItem` caen por `onDelete: Cascade`) y
   **después** el `Customer` por `email` —en ese orden, porque
   `Order.customerId` es una clave foránea sin cascada—, cierra el `next dev`
   (matando su grupo de procesos) y cierra el proxy. Como F-028, el usuario del
   emulador de Auth se queda: borrarlo no es asunto de este guion.

**Las siete corridas**, con el retraso vigente en cada una:

| Corrida | Retraso  | Qué hace                                                                    | Qué exige                                                                                                                                                                      |
| ------- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A       | 0 ms     | Sesión con `scripts/auth-otp.mjs --mode app`; lee su `Customer` en Postgres | Cookie y `Customer.id`; si falla, `PROBE FAIL` con el código de salida de `auth-otp`                                                                                           |
| B       | 0 ms     | Pedido con la cookie. **Calienta la ruta** y mide su duración como control  | 201, `Order.customerId` = el `Customer.id` de A, **cero** líneas                                                                                                               |
| C       | ~400 ms  | Mismo pedido                                                                | 201, **enlazado**, una línea `slow` con `300 <= elapsedMs` y `ceilingMs` 600                                                                                                   |
| D       | ~1500 ms | Mismo pedido                                                                | 201, `customerId` `NULL`, una `timeout` (`elapsedMs >= 600`), después una `late` con `lateMs > 0` y `resolved: true`; y el `POST` por debajo de (duración de B + 600 + 100) ms |
| E       | 0 ms     | Un `POST` sin cookie y otro con `qab-shopper-auth=probe-garbage-session`    | Cero líneas el primero; **una** `unverified` el segundo                                                                                                                        |
| F       | —        | Rearranca el `next dev` con las dos `NEXT_PUBLIC_SUPABASE_*` vacías         | Precondición: `/cuenta/entrar` trae `signin-disabled-aviso`. Luego 201 y **cero** líneas                                                                                       |
| G       | —        | `grep` sobre **toda** la salida capturada                                   | Ninguna línea del prefijo contiene el correo, el `user.id`, el `Customer.id` ni el valor de la cookie                                                                          |

Tres detalles que deciden si esto pasa a la primera:

- **Un teléfono distinto por pedido.** `createOrder` corta con 429 al sexto
  `PENDING` del mismo teléfono en la misma tienda en 10 minutos
  (`ORDER_RATE_LIMIT_MAX_PENDING`), y las corridas B–F hacen seis pedidos. Si
  todas usaran el mismo teléfono, la última fallaría con un 429 que parecería un
  fallo del instrumento.
- **La sesión es recién emitida** (A va antes de encender el retraso): un token
  a punto de caducar paga **dos** viajes dentro del techo y convertiría la
  corrida C en un `timeout`.
- **La corrida F comprueba primero que Auth está de verdad apagado.** Las
  `NEXT_PUBLIC_*` se fijan por proceso y Next las incrusta al compilar; si el
  arranque nuevo reutilizara un módulo compilado con el valor viejo, «cero
  líneas» pasaría por casualidad o fallaría sin decir por qué. Se afirma antes
  la precondición contra el HTML de `/cuenta/entrar`, que trae el aviso con
  `id="signin-disabled-aviso"` cuando `isSupabaseAuthConfigured()` es `false`.

**Códigos de salida**, al estilo de `scripts/auth-otp.mjs` (una causa cada uno,
y **siempre** con su línea `PROBE FAIL` delante):

| Código | Causa                                                                     |
| ------ | ------------------------------------------------------------------------- |
| 0      | Las siete corridas pasaron                                                |
| 1      | Falta configuración (`.env`, `DATABASE_URL`)                              |
| 2      | El emulador de Auth o Postgres no responden (F-028 / `npm run seed`)      |
| 3      | El `next dev` del probe no llegó a levantar                               |
| 4      | No hay tienda o producto vendible en `tienda-demo` (falta `npm run seed`) |
| 5      | No se pudo obtener la sesión (código de salida de `scripts/auth-otp.mjs`) |
| 6      | Al menos un aserto de las corridas A–G falló                              |

## Modelo de datos y migraciones

**Ninguna.** Cero tablas, cero columnas, cero índices, cero migraciones, cero
cambios en `prisma/schema.prisma` (R8). No se ejecuta ni se planifica ninguno de
los dos comandos que `AGENTS.md` marca como prohibidos.

Lo único que toca la base es el guion del probe, y solo para **leer**
`Order.customerId` y **borrar lo que él mismo creó**, con `pg` y por clave
(`code`, `email`), nunca con un `DELETE` amplio.

## Decisiones de arquitectura

### DA1 — La emisión vive en un módulo hermano, no en la ruta ni suelta en `orderIdentity.ts`

El desenlace solo se conoce dentro de `resolveOrderCustomerId()`: es la única
función que ve la cookie, el usuario, el `Customer` y quién ganó la carrera. La
ruta, para saberlo, tendría que recibir algo distinto de `string | null`, que es
justo lo que R11 congela. Así que la observación **nace ahí dentro** y se
delega a src/features/account/server/orderLinkObserver.ts (por crear), en la
misma capa `src/features/*/server/` y en la misma carpeta que su único
llamador.

Con eso, R4, R5 y R6 se cumplen por construcción: `hasCustomerSessionCookie()`
sigue siendo lo primero y sigue cortando antes de crear el reloj (R4); no se
añade ni un `await` al camino de la respuesta, solo dos lecturas de
`performance.now()` y un `console.warn` (R5); y ni `cookies()` ni nada nuevo
entra en `src/features/orders/` o `src/app/[slug]/`, así que
`src/features/account/boundaries.test.ts` no se entera (R6).

- Alternativa descartada: **la ruta observa con `after()`**. Necesitaría que la
  función le devolviera el desenlace — rompe R11 — o un canal mutable pasado por
  argumento, que es la misma dependencia con más piezas.
- Alternativa descartada: **todo dentro de `orderIdentity.ts`**. Un archivo de
  36 líneas cuyo contrato es «nunca rechaza, nunca pasa del techo» pasaría a
  tener también el formato de la línea y la regla del umbral; el día que alguien
  toque el formato, tocará el archivo del que depende que el pedido no se caiga.

### DA2 — `late` se emite sobre una rama que ya no puede rechazar, y `after()` la acompaña

Dos mecanismos, y cada uno resuelve una mitad distinta:

**La mitad de R13** la resuelve la forma de crear la rama, no el `after()`. Hoy
`Promise.race` adjunta manejadores a las dos ramas y por eso un rechazo tardío
no imprime nada. Si `late` se colgara de un `attempt` crudo, el rechazo seguiría
vivo por un lado y aparecería `Unhandled` en la salida del servidor, que
dispara `SERVIDOR_ERROR_RE` y pone roja la etapa `smoke` de **otros** features.
La solución es que el `.catch` vaya **pegado a la creación** de la rama y la
convierta en `{ kind: "error" }`: desde ese instante `attempt` no puede
rechazar, así que ni la carrera ni la continuación de `late` pueden dejar nada
sin manejar. Es un invariante de tipos, no una disciplina: `attempt` es
`Promise<OrderLinkResolution>`, y `OrderLinkResolution` incluye el fallo.

**La mitad del runtime** la resuelve `after()`. Sin él, en un despliegue
serverless la invocación se congela en cuanto sale la respuesta y la
continuación no llega a ejecutarse nunca: `late` no existiría en producción.
Con él —y `after` está documentado como «mantiene viva la invocación mientras la
promesa que se le dio siga pendiente», que es lo que ya aprovecha
`src/features/orders/server/bell.ts`— la continuación se ejecuta. Se llama en el
paso 7 del flujo, cuando el temporizador gana: la petición sigue viva, así que
el `AsyncLocalStorage` de Next todavía tiene su store y `after()` no protesta.

La llamada va **envuelta en `try/catch`**: fuera de una petición `after()` lanza
`` `after` was called outside a request scope `` (comprobado en
`node_modules/next/dist/server/after/after.js`), y eso ocurre en los tests
unitarios, donde la función se invoca directamente. Como la continuación ya está
adjunta por su cuenta, tragarse esa excepción **no pierde la línea**: el caso
`late` del criterio 6 se verifica sin mockear `next/server`, y de paso demuestra
que el mecanismo funciona también fuera de Next.

Y lo que se le pasa a `after()` **no puede rechazar** —es la continuación sobre
`attempt`, con la emisión envuelta—, porque un callback de `after()` que lanza
hace que Next imprima la excepción y vuelva a disparar el guardián. Es
literalmente la nota que `bell.ts` dejó escrita.

Qué pasa si el runtime congela igualmente la invocación (o si la rama perdedora
no termina nunca porque Auth está colgado): se pierde `late`, es decir `lateMs`.
**No se pierde la detección**: `timeout` ya se emitió antes de la respuesta. La
spec lo acepta explícitamente y el diseño no intenta más.

- Alternativa descartada: **solo `after()`**, moviendo la emisión al callback.
  Deja la promesa cruda esperando a que alguien la maneje entre el techo y el
  momento en que `after` corre, y en los tests unitarios no habría línea
  ninguna.
- Alternativa descartada: **solo la continuación**. Correcta en `next dev` —el
  probe pasaría— y muda en producción, que es donde el número importa.
- Alternativa descartada: **un segundo temporizador que acote cuánto espera
  `after()`**. Añade un número que la spec no autoriza y que además tumbaría la
  corrida D, cuyo retraso de 1500 ms supera cualquier tope razonable que se le
  ponga.

### DA3 — `outcome` es un objeto `as const` con su tipo derivado, no un `enum` ni una unión suelta

`ORDER_LINK_OUTCOME` en `src/constants/account.ts`, exactamente como
`ORDER_PROPOSAL_DECISION` y `ORDER_RESPONSE_OUTCOME` en `src/constants/orders.ts`.
El código de producto escribe `ORDER_LINK_OUTCOME.TIMEOUT`, nunca `"timeout"`
(`AGENTS.md` § Prohibiciones). El tipo `OrderLinkOutcome` se deriva del objeto,
así que valores y tipo no pueden divergir.

- Alternativa descartada: **`enum` de TypeScript**. No hay ni uno en `src/`,
  emite código en tiempo de ejecución y con `isolatedModules` es la forma que
  más fricción da; el repo ya eligió su patrón dos veces.
- Alternativa descartada: **solo el tipo unión de literales**, sin objeto. Tipa
  bien, pero deja los seis literales escritos a mano en cada `console.warn`, que
  es exactamente la magic string que la prohibición ataca.

### DA4 — El instrumento es total: nunca lanza y nunca cambia el desenlace del pedido

`settled()` y `timedOut()` envuelven **todo** su cuerpo en `try/catch` vacío. El
motivo no es cosmético: `watch?.settled(winner)` se llama **dentro** del
`try/catch` de `resolveOrderCustomerId()`, así que un `console.warn` que lanzara
—stdout cerrado, un `EPIPE`— caería en el `catch` exterior y devolvería `null`
**perdiendo un enlace que ya se había resuelto correctamente**. Medir no puede
cambiar lo medido. La misma regla que `searchLog.ts` aplica a su escritura.

- Alternativa descartada: **llamar al observador después de calcular el valor de
  retorno** para que el fallo no lo afecte. Depende del orden de dos líneas;
  el `try/catch` dentro del observador no depende de nada.

### DA5 — E9 se decide con `isSupabaseAuthConfigured()`, y se consulta **después** de la cookie

Primero la cookie (R4: el invitado no paga **nada**, ni siquiera dos lecturas de
`process.env`), después la configuración. Si Auth no está configurado no se crea
el observador y **la resolución sigue corriendo igual que hoy**: el
comportamiento del pedido es idéntico, lo único que desaparece es la línea (E9).

Esto es I4 escrito en código: `getCustomerUser()` devuelve `null` tanto por
falta de configuración como por fallo de verificación y su comentario dice que
las dos «look identical from the outside». Deducir E9 de ese `null` daría una
línea `unverified` en **cada** pedido de un despliegue sin Auth.

- Alternativa descartada: **una variable de entorno propia** para apagar el
  instrumento. Otro interruptor que mantener y otra forma de que producción y
  desarrollo difieran sin que nadie lo sepa.

### DA6 — La etapa `probe` pone las precondiciones; el guion pone los servidores

`smoke` y `visual` levantan el `next dev` desde `verify.sh`. `probe` **no puede**:
necesita arrancarlo con `NEXT_PUBLIC_SUPABASE_URL` apuntando a un proxy que aún
no existe cuando `verify.sh` empieza, y necesita **rearrancarlo** a mitad de
camino con las dos variables vacías (corrida F). Un servidor gobernado desde
Bash no permite ninguna de las dos cosas.

El reparto: `verify.sh` comprueba que **no** hay un `next dev` de este worktree
(`servidor_propio` → si lo hay, **falla** diciéndolo, no reutiliza), comprueba
que el puerto está libre (`puerto_libre`, la misma función y el mismo mensaje),
le pasa al guion el puerto y el archivo donde volcar la salida, y al terminar
aplica sobre ese archivo el **mismo** `guardian_servidor` con prefijo
`PROBE FAIL`. El guion arranca, para y vuelve a arrancar lo que necesite.

Que `--probe` exija `F-NNN` aunque su guion viva en `scripts/` es a propósito:
lo que necesita el ID es el **diario** del sensor (`.agent/runs/<ID>/`), del que
salen la firma, el conteo de repeticiones y el corte por ESTANCADO.

- Alternativa descartada: **que `verify.sh` levante el servidor** y el guion solo
  haga peticiones, como `smoke`. Imposible: el proxy elige su puerto al
  arrancar, y la corrida F exige un rearranque con otro entorno.
- Alternativa descartada: **reutilizar un `next dev` existente si lo hay**.
  Sería verde sin haber mirado nada: ese servidor apunta al Auth real, sin
  retraso, y su salida va a la terminal de quien lo lanzó, no a un archivo que
  la etapa pueda leer (es la misma advertencia que `correr_smoke` ya imprime
  cuando reutiliza).
- Alternativa descartada: **que el guion reimplemente el guardián de errores**.
  Duplicaría `SERVIDOR_ERROR_RE` en JavaScript, y ese patrón ya cambió una vez
  por un fallo real (I2).

### DA7 — El proxy lento vive en el propio proceso del guion y escucha en puerto efímero

Un `http.createServer` en el mismo proceso, escuchando en el puerto `0`. Dos
consecuencias buenas: el retraso es una variable que se asigna entre corridas
(una sola arrancada del servidor cubre A–E, y calentar la ruta en B vale para
todas), y no hay un segundo puerto fijo que comprobar, negociar con `verify.sh`
o chocar con otro checkout.

- Alternativa descartada: **un puerto fijo** (`PROXY_PORT`). Una comprobación más
  que mantener y una colisión más que diagnosticar.
- Alternativa descartada: **un proceso aparte con un endpoint de control** para
  cambiar el retraso. Más piezas, más limpieza, y nada que no haga una variable.
- Alternativa descartada: **retrasar con `tc`/`pfctl` o con una regla de red**.
  Necesita privilegios, no viaja entre máquinas y F-019 ya dejó escrito lo caro
  que sale una regla de red que no se despliega con el código.

### DA8 — La línea no lleva el código del pedido, y no se puede arreglar

La pregunta era si la observación podía ganar correlación sin romper R11. La
respuesta es **no**, y por dos motivos independientes:

1. **R3 lo prohíbe explícitamente**: la lista de lo que no puede aparecer en la
   línea termina en «ni código de pedido». Aunque fuera técnicamente posible,
   está fuera del contrato que la spec fijó.
2. **La cronología no da**. El desenlace se conoce dentro de
   `resolveOrderCustomerId()`, que empieza **antes** de leer el cuerpo; el
   `code` se genera después, dentro del bucle de reintentos de `createOrder`, y
   en los caminos 4xx —tienda cerrada, carrito vacío, 429— **no llega a
   existir**. Aplazar la línea hasta después de `createOrder` para poder
   cruzarla dejaría sin observar precisamente esos caminos y rompería R1 («una
   línea por intento»).

Queda cerrado: **las líneas se cuentan, no se cruzan**. Quien quiera
correlación, el escalón siguiente es la fila en Postgres que SP3 dejó fuera.

### DA9 — El prefijo se escribe literal en el emisor y en el test, a propósito

`console.warn("[orders] customer link", …)` con la cadena escrita a mano, igual
que `[catalog]`, `[realtime]` y el `[orders]` que ya hay en
`src/features/orders/server/status.ts`. El test unitario también la escribe a
mano. Es duplicación **deliberada**: el prefijo es un contrato con quien lee la
salida (R1: «una sola cadena que buscar»), y si emisor y test compartieran la
constante, renombrarlo pasaría los tests y rompería el `grep` de todo el mundo,
incluido el del probe.

- Alternativa descartada: **una constante `ORDER_LINK_LOG_PREFIX` compartida**.
  Es lo que pediría la lectura literal de la prohibición de magic strings, pero
  esa prohibición apunta a valores de dominio que se comparan en el código, no a
  un prefijo de log; y aquí convertiría al test en cómplice del renombrado.

### DA10 — `visual` y `probe` entran en el `etapa:` de `.agent/playbook/TEMPLATE.md`

La lista pasa a ser
`harness | typecheck | lint | format | test | prisma | build | theme | bundle | smoke | visual | probe | review`:
las dos nuevas después de `smoke`, en el orden en que corren, y `review` al
final. Es una línea, cierra I6 y no rompe `npm run check:harness`, que solo
exige que la lista **cubra** las etapas de `STAGES_COMPLETO` (comprobación 4 de
`scripts/check-harness.mjs`) y no que no tenga otras.

- Alternativa descartada: **dejarlo como está y que la ficha ponga `smoke`**.
  Una ficha con la etapa equivocada no la encuentra quien la necesita.

## Escalabilidad y límites

**Coste por petición.** El único camino que cambia es `POST /api/orders` con
cookie de cliente:

| Camino                        | Trabajo añadido                                                                                | Coste                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Catálogo `/[slug]` y el resto | ninguno                                                                                        | **0**                                                            |
| Pedido de invitado            | ninguno: se corta en `hasCustomerSessionCookie()`                                              | **0** (R4, y el criterio 7 lo afirma)                            |
| Pedido con sesión, rápido     | 2 lecturas de `process.env` (incrustadas al compilar), 2 `performance.now()`, 1 objeto pequeño | **< 1 ms**, sin `await` nuevo                                    |
| Pedido con sesión, observado  | lo anterior más 1 `console.warn`                                                               | 1 escritura a stdout, decenas de µs                              |
| Pedido con `timeout`          | lo anterior más un `after()` y una continuación                                                | 0 antes de la respuesta; después, lo que tarde la rama perdedora |

Viajes a Postgres: **los mismos**. Viajes a Auth: **los mismos**. Consultas
nuevas: **cero**. N+1: no hay consulta que multiplicar.

**Volumen de líneas.** Como mucho 2 por pedido **con cookie de cliente** (R9).
Con 100 tiendas a 10 pedidos diarios y, digamos, un 20 % con sesión, el techo
absoluto son 400 líneas al día **en el peor caso imaginable**, que es que todos
los enlaces se degraden a la vez. El caso normal —Auth sano— son **cero**
líneas al día: por eso el número tiene valor. El tráfico de catálogo, que es
casi todo, no produce ni una.

**Qué se rompe primero, con su umbral.** No es el volumen de logs: es el tiempo
de invocación durante una caída de Auth. Con `after()` sujetando la rama
perdedora, cada pedido con sesión mantiene viva su invocación hasta que la
llamada a Auth termine o el `fetch` de `undici` se rinda; `after` corre «hasta
la duración máxima configurada de la ruta», y `/api/orders` **no exporta
`maxDuration`** hoy. En una caída con conexiones que se quedan colgadas en vez
de fallar, eso convierte invocaciones de ~1 s en invocaciones de decenas de
segundos, y la concurrencia se paga en GB-s. El umbral no es de tráfico: basta
**una** caída de Auth con time-outs de red mudos. Plan B escrito abajo (riesgo
1), y hay dos salidas de una línea cada una.

**JavaScript de cliente.** 0 KB. Todo esto es servidor: el observador vive en
`src/features/*/server/`, no lo importa ningún módulo con `"use client"`, y
`npm run check:bundle` no se mueve del número de hoy (criterio 11, y
`scripts/check-bundle-budget.mjs` no se toca).

**Caché e ISR.** Nada nuevo se cachea y nada se invalida: `/api/orders` ya es
`force-dynamic`, y el `matcher` de `src/proxy.ts` sigue sin tocar `/[slug]`
(`AGENTS.md` § Cosas que muerden).

**Pooler de Supabase.** No se abre ni una consulta nueva, así que no hay nada
que batchear y ningún `$transaction` en el que colarse.

**El probe.** Es un ciclo manual y no entra en `--full` ni en el CI: dos
arrancadas de `next dev` (~30–60 s cada una en frío), seis pedidos, unos 4 s de
retrasos deliberados. Del orden de dos a tres minutos, todos ellos pagados por
quien lo pide a mano.

## Patrones a seguir / antipatrones a evitar

**A seguir**

- `console.warn` con prefijo `[scope]` y un objeto estructurado detrás, en
  inglés (`AGENTS.md` § Idioma), como `src/features/orders/server/status.ts`.
- Valores de dominio en `src/constants/` como objeto `as const` más tipo
  derivado (`AGENTS.md` § Prohibiciones: magic strings).
- Trabajo posterior a la respuesta con `after()`, sobre una promesa que **no
  puede rechazar** (`src/features/orders/server/bell.ts`,
  `src/features/catalog/server/searchLog.ts`).
- Todo lo que se añade a `.agent/verify.sh` reutiliza `puerto_libre`,
  `servidor_propio` y `guardian_servidor`: el sensor tiene una sola definición
  de cada cosa.
- Rutas completas desde la raíz del repo en toda la prosa, y sin comillas
  invertidas mientras el archivo no exista (`AGENTS.md` § Cosas que muerden, las
  dos mitades de `check:harness`).

**A evitar**

- `console.error` en cualquier pieza de este feature, y **cualquier** línea que
  empiece por algo acabado en `Error`: dispara `SERVIDOR_ERROR_RE` y pone roja
  la etapa `smoke` de otros features (R2, I2).
- Volcar la excepción, su mensaje o su clase en la línea `error` (R2, R3).
- Adjuntar la emisión de `late` a una promesa que todavía puede rechazar (R13).
- Tocar `ORDER_CUSTOMER_LINK_TIMEOUT_MS`, el `Promise.race` o la firma que
  recibe `createOrder` (R11).
- Meter `cookies()` —o cualquier lectura de sesión— en `src/features/orders/` o
  `src/app/[slug]/` (R6, F-010 fila 4).
- Un contador o cualquier estado de módulo en el observador (R10, E11).
- Reutilizar un `next dev` ajeno en la etapa `probe` (I5), o dejar vivo el suyo
  al terminar.
- Formatear a ciegas documentos ajenos con Prettier (`AGENTS.md` § Cosas que
  muerden, la segunda mitad).

## Riesgos y plan B

1. **`after()` alarga la invocación durante una caída de Auth.** Es el riesgo
   real de este diseño y está cuantificado arriba. Plan B, por orden de coste:
   (a) exportar `maxDuration` en `src/app/api/orders/route.ts` —la salida que el
   propio `bell.ts` ya documenta para su caso—; (b) quitar el `after()` y
   quedarse con la continuación sola, que sigue emitiendo `late` en servidores
   de vida larga y lo pierde en serverless, que es exactamente lo que la spec ya
   acepta como pérdida tolerable. Ninguna de las dos toca el instrumento.
2. **La corrida F sale verde sin haber apagado nada.** Las `NEXT_PUBLIC_*` se
   incrustan al compilar; si el rearranque reutilizara módulos compilados con el
   valor viejo, «cero líneas» no probaría nada. Mitigado con la precondición
   sobre `signin-disabled-aviso` en `/cuenta/entrar`. Si esa precondición falla,
   el arreglo manual es borrar `.next` y repetir; el guion **no** lo hace solo,
   porque tirar la caché de desarrollo de quien está trabajando no es decisión
   suya.
3. **El probe deja un `next dev` huérfano.** Sería peor que un fallo: rompería
   la etapa `smoke` de cualquier otro feature con el mensaje que no dice la
   causa (`AGENTS.md` § «Un solo `next dev` por directorio»). Mitigado por
   partida doble: limpieza en `finally` y en `SIGINT`/`SIGTERM` dentro del
   guion, y comprobación en `verify.sh` de que el puerto volvió a quedar libre,
   con `PROBE FAIL` si no.
4. **El smoke de F-012 empieza a imprimir una línea `unverified` por corrida.**
   Es consecuencia buscada (su cookie basura), y no lo pone rojo porque
   `console.warn` con este prefijo no casa con `SERVIDOR_ERROR_RE`. El criterio 8
   lo comprueba ejecutando `bash .agent/verify.sh F-012 --smoke`. Se vuelve un
   problema **solo** si alguien mete una palabra acabada en `Error` al principio
   de la línea; de ahí el antipatrón de arriba.
5. **El parser del probe se rompe si Node parte el objeto en varias líneas.**
   `console.warn` usa `util.inspect`, que hace saltos de línea cuando el objeto
   no cabe. Mitigado con el lector tolerante de DA7/§ Contratos: se busca el
   prefijo y se escanea el trozo siguiente, campo a campo, nunca `JSON.parse`.
6. **Empate entre el reloj y la carrera.** Un `slow` con `elapsedMs` de 600, o
   un `late` con `lateMs` que redondearía a 0. Resuelto en el contrato: manda
   quién ganó la carrera, y `lateMs` tiene suelo 1.
7. **El probe depende de tres cosas de fuera** (Postgres sembrado, el emulador
   de F-028, Mailpit). Mitigado con códigos de salida por causa y una línea
   `PROBE FAIL` que nombra la que falta, en vez de un fallo genérico de aserto.
8. **El criterio 7 leído literal sobre HTTP** sigue sin ser medible en
   `next dev` (I3). Este documento no lo reabre: se mide donde la spec fijó —el
   caso unitario de la resolución colgada y el delta contra la corrida B ya
   calentada—. Si el humano quisiera el aserto literal sobre HTTP, sería un
   criterio nuevo con su entorno de medida, no un cambio aquí.

## ¿Hace falta una ADR?

**No.** Esto no crea una capa, no cambia un contrato con cuadrecaja, no toca el
modelo de datos y no supera ninguna decisión anterior: es instrumentación dentro
de una decisión ya tomada (DA2 de `.agent/specs/F-012/architecture.md`), que
además se conserva intacta a propósito. Lo que sí deja poso —cómo se registra en
este repo— va a `AGENTS.md` y a una ficha de `.agent/playbook/`, que es lo que
`AGENTS.md` § Documentación pide para una convención que ya se repite.

## Preguntas al humano

**Ninguna.** La spec salió en `estado: listo` con SP1–SP4 cerradas, y las cuatro
decisiones que dejó abiertas a propósito —dónde vive la emisión, con qué
mecanismo se emite `late`, cómo se modela `outcome` y si la línea puede llevar
el código del pedido— están resueltas en DA1, DA2, DA3 y DA8, todas dentro de
las restricciones que las `notes` del feature fijan.
