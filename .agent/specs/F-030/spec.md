---
feature: F-030
agente: sdd-spec
actualizado: 2026-09-02T00:01:33Z
estado: listo
---

## Problema

Cuando `resolveOrderCustomerId()` (`src/features/account/server/orderIdentity.ts`)
pierde la carrera contra su techo de 600 ms, el pedido se crea igual, responde
201 y deja `Order.customerId` en `NULL`: **indistinguible de un pedido de
invitado**, sin línea, sin métrica y sin fila. Ese desenlace es el correcto
—resolver la identidad nunca puede impedir un pedido— pero **agotar el techo es
hoy invisible**, así que un Supabase Auth lento degradaría el enlace de pedidos
en silencio hasta que alguien reclamara un historial vacío.

Dejó de ser teórico el 2026-08-30: con HS256 —lo que firma este montaje—
`getClaims()` no verifica en local, cae a `getUser(token)` y paga un
`GET /auth/v1/user` por llamada y sin caché (ficha
`.agent/playbook/getclaims-hs256-sale-a-la-red.md`;
`.agent/specs/F-012/architecture.md` § Escalabilidad y límites, ya corregida).
Con un viaje de red dentro del presupuesto, la carrera es real. Este feature es
para **verla**, no para cambiarla.

## Alcance

### Dentro

- **Una observación por intento de enlace, y solo cuando había cookie de
  cliente**: qué pasó (`outcome`) y cuánto tardó (`elapsedMs`).
- **La separación de los tres `NULL` que hoy son el mismo**: no había sesión
  (nada), la sesión no se pudo verificar (`unverified`), la sesión existía y no
  llegó a tiempo (`timeout`).
- **Un aviso temprano** (`slow`) a partir de `ORDER_CUSTOMER_LINK_SLOW_MS` =
  **300 ms**, la mitad del techo. Decisión del humano del 2026-09-01, cerrada.
- **La llegada tardía** (`late`) con `lateMs`: cuánto tardó de más sobre el
  techo la resolución que perdió la carrera.
- **El mecanismo que el repo ya usa**: `console.warn` con prefijo `[scope]` y un
  objeto estructurado detrás. Cero dependencias, cero tablas, cero migraciones.
- **La demostración de que el detector se dispara**, provocando el fallo con
  Auth de verdad retrasado, y la demostración simétrica de que **no** se dispara
  cuando no debe: una etapa nueva del sensor, invocada como
  `bash .agent/verify.sh F-030 --probe`, al estilo de la etapa `--visual` de
  F-010 y **sin job propio** en `.github/workflows/ci.yml`. Decisión del humano
  del 2026-09-01, cerrada.
- **La mitad determinista**, en `src/features/account/server/orderIdentity.test.ts`,
  que sí corre en CI dentro de `npm test`.
- Una línea de convención en `AGENTS.md` y una ficha en `.agent/playbook/` sobre
  cómo se registra en este repo (hoy es costumbre y no está escrita). No la
  exige ningún criterio; se entrega igual porque `AGENTS.md` § Documentación lo
  pide para una convención que ya se repite.

### Fuera (explícito)

Lo que las `notes` del feature marcan FUERA, más lo que ya fijaba la propuesta:

- **Cambiar el techo de 600 ms o el mecanismo de DA2.** `ORDER_CUSTOMER_LINK_TIMEOUT_MS`
  no se toca, el `Promise.race` no se sustituye y `createOrder` sigue recibiendo
  un `Promise<string | null>`.
- **Dependencias de observabilidad**: APM, SDK de métricas, drenaje de logs.
- **Persistir en Postgres.** Ninguna tabla, ninguna migración, ningún campo
  nuevo en `Order`. Es el escalón siguiente si el número deja de ser cero.
- **Alertar a alguien.** El fallo pasa a ser contable **cuando alguien mira**,
  no avisable. Nadie vigila logs en este proyecto hoy.
- **Instrumentar los otros tres caminos que pagan viaje a Auth** (`/cuenta`,
  `PUT /api/account/profile`, el autocompletado del checkout). Ninguno tiene
  presupuesto **y** consecuencia silenciosa a la vez.
- **Correlacionar cada línea con su pedido.** La resolución empieza antes de
  leer el cuerpo (DA2, paso 1): cuando la línea se emite no existe todavía ni el
  código del pedido ni el slug. Las líneas se **cuentan**, no se cruzan.
- **El token caducado en el checkout** (SP4, resuelta por el humano): dos viajes
  a Auth dentro del techo porque el proxy solo refresca en `/cuenta*` y
  `/auth*`. Primero medir, luego decidir. Nadie toca el `matcher` de
  `src/proxy.ts` en este feature.
- **Tocar `scripts/place-order.mjs`.** No manda cabecera `Cookie` a propósito y
  eso **es** la prueba del criterio 4 de F-010.
- **Renegociar nada de F-010, F-012 ni F-028**, cerrados.

## Actores y precondiciones

**Actor**: quien opera o depura este producto —persona o agente— leyendo la
salida del servidor. **No hay actor de producto**: el comprador no ve nada
nuevo, no aprende nada nuevo y su pedido responde exactamente igual.

Precondiciones para poder verificar:

1. F-012 cerrado (`passes: true`), que es el caso.
2. F-028 cerrado: el emulador local de Auth y `scripts/auth-otp.mjs` son lo que
   permite obtener una sesión **de verdad** sin proyecto en la nube. Sin eso los
   criterios 1 a 5 no serían ejecutables.
3. Postgres local en pie y `npm run seed` aplicado, para leer `Order.customerId`
   después de cada pedido y para tener `tienda-demo` con producto visible.
4. Ningún otro `next dev` corriendo desde este directorio cuando se pide la
   etapa `--probe` (ver § Casos límite, «El servidor del probe no se puede
   reutilizar»).

## Comportamiento esperado

Todos los escenarios ocurren en `POST /api/orders`. **«Una línea»** significa
exactamente una línea en la salida del servidor cuyo texto empieza por el
literal `[orders] customer link`. «Cero líneas» significa que el instrumento no
llama a `console.*` ni una vez.

- **E1 — Invitado.** Dado un pedido sin ninguna cookie `qab-shopper-auth`,
  cuando se crea, entonces responde 201, `Order.customerId` queda `NULL` y se
  emiten **cero** líneas. El camino de invitado no paga ni un log.
- **E2 — Enlace normal.** Dada una sesión válida y una resolución que termina
  por debajo de `ORDER_CUSTOMER_LINK_SLOW_MS`, cuando se crea el pedido,
  entonces responde 201, `Order.customerId` es el `Customer.id` de la sesión y
  se emiten **cero** líneas. La fila enlazada **es** el registro del caso bueno.
- **E3 — Enlace lento (aviso temprano).** Dada una sesión válida y una
  resolución que termina **con identidad** en un tiempo mayor o igual a
  `ORDER_CUSTOMER_LINK_SLOW_MS` y menor que `ORDER_CUSTOMER_LINK_TIMEOUT_MS`,
  cuando se crea el pedido, entonces responde 201, **se enlaza igual** y se
  emite una línea con `outcome: "slow"` y su `elapsedMs`.
- **E4 — El temporizador gana.** Dada una sesión válida y una resolución que
  supera el techo, cuando se crea el pedido, entonces responde **201**,
  `Order.customerId` queda `NULL` —lo prometido por la R14 de F-012, que no
  cambia— y se emite una línea con `outcome: "timeout"`, `ceilingMs: 600` y
  `elapsedMs` mayor o igual a `ceilingMs`.
- **E5 — Llegada tardía.** Dado E4, cuando la resolución que perdió la carrera
  termina —siempre después de que la respuesta ya salió—, entonces se emite una
  **segunda** línea con `outcome: "late"`, `elapsedMs` total de esa rama,
  `lateMs` mayor que 0 (lo que tardó de más sobre el techo) y `resolved` (si al
  final traía identidad o no). Nunca antes de la respuesta, nunca retrasándola.
- **E6 — Había sesión, pero no se pudo verificar.** Dada Supabase Auth
  configurada y una cookie `qab-shopper-auth` ilegible, caducada sin refresco
  posible, o un Auth que responde error, cuando se crea el pedido, entonces 201,
  `customerId` `NULL` y **una** línea con `outcome: "unverified"`. **Esta es la
  línea que separa el «no había sesión» del «había sesión y falló»**, que hoy
  acaban los dos en el mismo `null`.
- **E7 — Sesión verificada sin `Customer`.** Dado un token válido cuyo
  `supabaseUserId` no tiene fila en `Customer`, entonces 201, `NULL` y una línea
  con `outcome: "no_customer"`. No debería ocurrir nunca —el primer login crea
  la fila (`ensureCustomerForUser`)— y por eso merece valor propio: si aparece,
  hay un agujero en otro sitio.
- **E8 — Excepción inesperada.** Dado un fallo que hoy captura el `catch` de
  `resolveOrderCustomerId()` **después** de que la comprobación de cookie dijera
  que sí (en la práctica: `findCustomerIdByUserId` rechaza porque Prisma o el
  pooler fallan), entonces 201, `NULL` y una línea con `outcome: "error"`,
  **sin el mensaje ni la clase de la excepción** (R2).
- **E9 — Auth sin configurar.** Dado el entorno del criterio 6 de F-012
  (`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` vacíos, o sea
  `isSupabaseAuthConfigured()` en `false`), cuando llega un pedido con cualquier
  cookie de cliente, entonces 201, `NULL` y **cero** líneas: un despliegue sin
  Auth no es un fallo y no debe generar ruido en cada pedido.
- **E10 — Reintento idempotente.** Dados dos `POST` con el mismo
  `idempotencyKey` y la misma sesión, entonces el segundo responde 200
  `idempotent` y **también** observa su intento con las mismas reglas. Las
  líneas cuentan **intentos de resolución**, no pedidos distintos; quien divida
  por pedidos tiene que saberlo.
- **E11 — Concurrencia.** Dados N pedidos simultáneos con sesión, entonces se
  emiten N observaciones independientes, una por intento, sin contador
  compartido y sin que el desenlace de una afecte a otra.

## Reglas de negocio

Ojo con la numeración: la **R14 que citan `orderIdentity.ts` y `createOrder.ts`
es de F-012**, no de aquí. Las reglas de este feature son R1–R13.

- **R1 — Una sola cadena que buscar, una sola línea por intento.** Todas las
  líneas empiezan por el literal `[orders] customer link`, se emiten con
  `console.warn` y se distinguen por el campo `outcome`. Un intento de enlace
  produce **como máximo una** línea de desenlace, más —solo tras `timeout`— la
  línea `late`. Un `grep` del prefijo da el total; el prefijo más el valor de
  `outcome` da cada causa.
- **R2 — Nunca el mensaje ni la clase de la excepción en la línea.** El
  guardián de `.agent/verify.sh` (`SERVIDOR_ERROR_RE`, línea 40) pone roja la
  etapa `smoke` de cualquier feature cuando una línea de la salida del servidor
  empieza por algo acabado en `Error`, que es como Node imprime una excepción
  volcada. Se registra **que** hubo un error, no cuál. Y `console.warn`, nunca
  `console.error`, por el mismo motivo.
- **R3 — Cero PII y cero credenciales.** Ni correo, ni `user.id`, ni
  `Customer.id`, ni teléfono, ni valor de cookie, ni IP, ni `storeSlug`, ni
  código de pedido. Solo `outcome`, milisegundos y booleanos.
- **R4 — El invitado no paga nada.** Sin cookie de cliente no hay medición, no
  hay línea y no hay ninguna llamada nueva: `hasCustomerSessionCookie()` sigue
  siendo lo primero que ocurre y sigue cortando antes de tocar red o base.
- **R5 — Medir no retrasa el pedido.** Ni un `await` nuevo en el camino de la
  respuesta. `resolveOrderCustomerId()` sigue resolviendo en un tiempo menor o
  igual al techo y sigue sin rechazar nunca. Lo único que se añade en línea es
  leer un reloj monótono y escribir una línea.
- **R6 — La frontera de F-010 no se toca.** `cookies()` sigue sin aparecer en
  `src/features/orders/` ni en `src/app/[slug]/`, y
  `src/features/account/boundaries.test.ts` sigue en verde. La identidad se
  sigue resolviendo donde ya se resolvía.
- **R7 — La respuesta HTTP no cambia.** Ni cabecera nueva, ni campo nuevo, ni
  código distinto, ni en 201 ni en 200 `idempotent` ni en los 4xx. El POS recibe
  el mismo pedido byte a byte y `docs/sync-contract.md` no se toca.
- **R8 — Nada de migración, dependencia ni bundle.** Cero cambios en
  `prisma/schema.prisma`, cero en las dependencias de `package.json`, cero
  JavaScript de cliente nuevo: todo esto vive en el servidor.
- **R9 — Volumen acotado.** Como mucho dos líneas por intento de pedido **con
  cookie de cliente**. El tráfico de catálogo, que es casi todo, no produce ni
  una.
- **R10 — Ningún contador en memoria.** En serverless cada instancia tendría el
  suyo y la suma no existiría en ninguna parte. Cada observación es una línea
  independiente y el agregado se hace al leer.
- **R11 — El techo y el mecanismo de DA2 no cambian.** 600 ms sigue siendo
  600 ms, el `Promise.race` sigue siendo el mismo y `createOrder` sigue
  recibiendo un `Promise<string | null>` con su valor por omisión, que es lo que
  mantiene intacta la suite de F-010.
- **R12 — «Auth sin configurar» se decide con `isSupabaseAuthConfigured()`, no
  con el `null` de `getCustomerUser()`.** `getCustomerUser()`
  (`src/lib/auth/customerSession.ts`) devuelve `null` tanto cuando
  `createSupabaseServerClient()` no pudo construirse por falta de configuración
  como cuando la verificación falló: su propio comentario dice que las dos
  situaciones «look identical from the outside». Los criterios 3 y 9 exigen que
  dejen de serlo **para quien observa**, así que el instrumento consulta
  `isSupabaseAuthConfigured()` (`src/lib/supabase/config.ts`, lectura directa de
  `process.env`, sin red y sin Zod) y, si devuelve `false`, no emite nada. El
  comportamiento del pedido no cambia en ningún caso.
- **R13 — La rama perdedora nunca deja una promesa rechazada sin manejar.**
  Hoy `Promise.race` adjunta manejadores a las dos ramas, así que un
  `findCustomerIdByUserId` que rechace **después** del techo no produce nada. Si
  la emisión de `late` reestructura esa rama, tiene que seguir capturando su
  rechazo: un `Unhandled` en la salida del servidor dispara el mismo guardián de
  R2 y pondría roja la etapa `smoke` de otros features.

## Casos límite y errores

- **Cookie basura.** `.agent/specs/F-012/smoke.sh` línea 223 hace un
  `POST /api/orders` con `Cookie: qab-shopper-auth=smoke-garbage-session`: a
  partir de este feature ese smoke ajeno imprimirá una línea `unverified` por
  corrida. Es consecuencia buscada y comprobable, y como son `warn` **no** puede
  volverse rojo por ellas (criterio 8).
- **Token caducado.** El proxy solo refresca en `/cuenta*` y `/auth*`, así que
  quien vuelve a la tienda una hora después llega al checkout con el token
  vencido y paga **dos** viajes dentro del techo. Es el caso con más
  probabilidad de agotar los 600 ms y este feature lo hará visible por primera
  vez; arreglarlo está FUERA (SP4).
- **Auth caído del todo.** Cada pedido con sesión emite una línea. Acotado por
  R9: ruido proporcional a los pedidos, no al tráfico, y exactamente el ruido
  que uno quiere en ese momento.
- **Claims sin `sub`.** `toCustomerUser()` deja `id: ""` cuando los claims no
  traen ni `id` ni `sub`; `findCustomerIdByUserId("")` devuelve `null` y el
  desenlace es `no_customer`, no `unverified`. Es correcto —la sesión se
  verificó— y queda escrito para que nadie lo lea como un fallo del
  instrumento.
- **La comprobación de cookie falla.** Si `hasCustomerSessionCookie()` lanza (el
  test «NEVER rejects, even if hasCustomerSessionCookie itself throws» ya cubre
  ese camino), **no se emite ninguna línea**: nunca se estableció que hubiera
  sesión, y emitir aquí rompería R4 y produciría una línea por petición si
  `cookies()` se rompiera. `error` cubre solo lo que falla después.
- **La línea tardía puede no llegar a emitirse** si el runtime congela la
  invocación en cuanto responde. Lo que se pierde entonces es `lateMs`, no la
  detección: el `timeout` ya quedó registrado antes. Si la resolución perdedora
  no termina nunca (Auth colgado), tampoco hay `late`, y eso también es
  información.
- **Dos líneas para un mismo pedido** (`timeout` y después `late`): quien cuente
  fallos filtra por `outcome`, no por líneas totales.
- **Reloj.** `elapsedMs` se mide con un reloj monótono (`performance.now()`), no
  con la hora del sistema: un ajuste de NTP en medio de la carrera no puede
  producir un negativo.
- **El servidor del probe no se puede reutilizar.** Next 16 admite **un solo**
  `next dev` por directorio, sea cual sea el puerto, y las etapas `smoke` y
  `visual` de `.agent/verify.sh` resuelven eso reutilizando el que encuentren
  (`servidor_propio`). La etapa `--probe` **no puede**: necesita arrancar el
  servidor con `NEXT_PUBLIC_SUPABASE_URL` apuntando a su proxy lento y necesita
  la salida del servidor en un archivo que ella controle, y ninguna de las dos
  cosas se consigue sobre un servidor ajeno. Si hay un `next dev` de este
  directorio corriendo, la etapa **falla con un mensaje que lo diga** («cierra
  el `next dev` de este worktree»), nunca reutiliza y nunca sale verde sin
  haber mirado.

## Datos y contrato

Nada de esto toca `docs/sync-contract.md`, ni el payload de
`/api/internal/orders`, ni `prisma/schema.prisma`, ni las dependencias de
`package.json`. La única superficie nueva es la línea.

### La línea

```
console.warn("[orders] customer link", {
  outcome,      // "slow" | "timeout" | "late" | "unverified" | "no_customer" | "error"
  elapsedMs,    // entero, reloj monótono
  ceilingMs,    // ORDER_CUSTOMER_LINK_TIMEOUT_MS, para que la línea se lea sola
  // lateMs y resolved, solo en "late"
})
```

**Prefijo literal**: `[orders] customer link`. En inglés y con `[scope]`, como
manda `AGENTS.md` § Idioma y como hace el resto del repo.

| Campo       | Tipo              | Obligatorio    | Nota                                                              |
| ----------- | ----------------- | -------------- | ----------------------------------------------------------------- |
| `outcome`   | enum de 6 valores | sí             | Definido en `src/constants/account.ts`, nunca como literal suelto |
| `elapsedMs` | entero ≥ 0, ms    | sí             | Desde que arranca la resolución hasta que ese desenlace se conoce |
| `ceilingMs` | entero, ms        | sí             | `ORDER_CUSTOMER_LINK_TIMEOUT_MS`; 600 hoy                         |
| `lateMs`    | entero > 0, ms    | solo en `late` | `elapsedMs - ceilingMs`: cuánto tardó **de más** sobre el techo   |
| `resolved`  | booleano          | solo en `late` | Si la resolución tardía traía identidad (`true`) o no (`false`)   |

### Qué campos lleva cada `outcome`

| `outcome`     | Cuándo                                                      | Campos                                                    | ¿Enlaza? |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------- | -------- |
| `slow`        | Resolvió **con** identidad, `SLOW_MS` ≤ `elapsedMs` < techo | `outcome`, `elapsedMs`, `ceilingMs`                       | sí       |
| `timeout`     | Ganó el temporizador                                        | `outcome`, `elapsedMs`, `ceilingMs`                       | no       |
| `late`        | La rama perdedora terminó, ya con la respuesta fuera        | `outcome`, `elapsedMs`, `ceilingMs`, `lateMs`, `resolved` | no       |
| `unverified`  | Había cookie y Auth configurado, y no hubo identidad        | `outcome`, `elapsedMs`, `ceilingMs`                       | no       |
| `no_customer` | Identidad verificada sin fila en `Customer`                 | `outcome`, `elapsedMs`, `ceilingMs`                       | no       |
| `error`       | Excepción después de la comprobación de cookie              | `outcome`, `elapsedMs`, `ceilingMs`                       | no       |

Casos **sin** línea, exhaustivos: invitado (E1), enlace por debajo del umbral
(E2), Auth sin configurar (E9) y fallo de la propia comprobación de cookie.

`slow` es un desenlace, no un adjetivo: describe **solo** la resolución que
terminó con identidad pasado el umbral. Una resolución que acaba en
`unverified`, `no_customer` o `error` a los 400 ms emite **su** línea con
`elapsedMs: 400`, no una segunda línea `slow`. Así se sostiene la R1.

### Constantes

- **Nueva**: `ORDER_CUSTOMER_LINK_SLOW_MS = 300` en `src/constants/account.ts`,
  junto a `ORDER_CUSTOMER_LINK_TIMEOUT_MS` y con el mismo estilo de comentario.
  Es la mitad del techo, por decisión del humano.
- **Intacta**: `ORDER_CUSTOMER_LINK_TIMEOUT_MS = 600`. No se toca, no se hace
  configurable y no se baja para verificar (retrasar Auth es lo que se retrasa).
- Los seis valores de `outcome` viven también en `src/constants/account.ts`
  —unión de literales o enum, lo decide `sdd-architect`—, nunca sueltos en el
  código (`AGENTS.md` § Prohibiciones: magic strings).

### Cómo se lee la línea desde un guion

`console.warn("[orders] customer link", obj)` imprime el objeto con la
inspección de Node: `{ outcome: 'timeout', elapsedMs: 601, ceilingMs: 600 }`,
con **comillas simples**. Quien parsee la salida en scripts/order-link-probe.mjs
(por crear) usa un patrón tolerante sobre `outcome:` y sobre cada número, no una
comparación con JSON. Las pruebas unitarias no parsean nada: espían
`console.warn` y afirman sobre sus **argumentos**.

## Cómo se provoca el fallo y se demuestra la detección

Un instrumento que nadie ha visto dispararse no está verificado. La verificación
tiene dos mitades y las dos se ejecutan.

### Mitad determinista, en CI

`src/features/account/server/orderIdentity.test.ts` —que ya existe, ya tiene sus
mocks y ya tiene el caso de la resolución colgada— gana un caso por cada
desenlace, espiando `console.warn`:

| Caso           | Montaje                                                            | Aserto                                                      |
| -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| invitado       | `hasCustomerSessionCookie` → `false`                               | `null`, **0** llamadas a `console.*`, 0 a Auth y 0 a Prisma |
| enlace normal  | resuelve al instante con `Customer`                                | id devuelto, **0** llamadas a `console.*`                   |
| `slow`         | `getCustomerUser` resuelve pasado el umbral y por debajo del techo | id devuelto y una línea `slow` con `elapsedMs ≥ 300`        |
| `timeout`      | `getCustomerUser` no resuelve nunca                                | `null` y una línea `timeout` con `ceilingMs: 600`           |
| `late`         | `getCustomerUser` resuelve pasado el techo                         | segunda línea `late`, `lateMs > 0`, emitida después         |
| `unverified`   | `getCustomerUser` → `null`, Auth configurado                       | una línea `unverified`                                      |
| `no_customer`  | usuario válido, `findCustomerIdByUserId` → `null`                  | una línea `no_customer`                                     |
| `error`        | `findCustomerIdByUserId` rechaza                                   | una línea `error` sin el mensaje de la excepción            |
| sin configurar | `isSupabaseAuthConfigured` → `false`, con cookie                   | `null` y **0** llamadas a `console.*`                       |

Corre con `npx vitest run src/features/account/server/orderIdentity.test.ts` y
dentro de `npm test`, sin Docker, sin red y sin Postgres. El proyecto es `node`
por la extensión `.test.ts` (`AGENTS.md` § Cosas que muerden).

### Mitad de verdad, contra el Auth real de F-028

Una etapa nueva del sensor: `bash .agent/verify.sh F-030 --probe`, que ejecuta
el guion nuevo scripts/order-link-probe.mjs (por crear) y termina en 0 o en un
código distinto. Se modela sobre la etapa `--visual` de F-010 —bandera propia,
exige un `F-NNN`, no entra en `--full`— con tres diferencias que la spec fija:

1. El guion vive en scripts/order-link-probe.mjs (por crear), no bajo
   `.agent/specs/F-030/`, por decisión del humano.
2. La etapa **no** reutiliza un `next dev` ajeno: arranca el suyo, en un puerto
   libre, con la salida redirigida a un archivo que ella controla y con
   `NEXT_PUBLIC_SUPABASE_URL` apuntando a un **proxy lento** que el propio guion
   levanta y que reenvía a `http://localhost:54321` tras esperar el retraso
   vigente. Si ya hay un `next dev` de este directorio, falla con un mensaje que
   lo explica.
3. Cada fallo del guion imprime una línea que empieza por `PROBE FAIL`, para que
   `extract_signature` de `.agent/verify.sh` pueda pescar la firma como ya hace
   con `SMOKE FAIL` y `VISUAL FAIL`.

Retrasar Auth de verdad, en vez de bajar el techo, es lo que ejercita la carrera
como ocurriría en producción y no obliga a hacer configurable un número que este
feature se ha prohibido discutir. El retraso del proxy es **ajustable por
corrida**, para que una sola arrancada del servidor cubra todas:

| Corrida | Retraso  | Qué hace                                                                                               | Qué exige                                                                                              |
| ------- | -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| A       | 0 ms     | Sesión real con `scripts/auth-otp.mjs --mode app` y su `--cookie-jar`                                  | Cookie de sesión y `Customer` creado                                                                   |
| B       | 0 ms     | Cotiza y hace `POST /api/orders` con la cookie                                                         | 201, `Order.customerId` = `Customer.id` de la sesión, **cero** líneas                                  |
| C       | ~400 ms  | Mismo `POST`                                                                                           | 201, **enlazado**, una línea `slow` con `300 ≤ elapsedMs < 600`                                        |
| D       | ~1500 ms | Mismo `POST`                                                                                           | 201, `customerId` `NULL`, una línea `timeout` con `ceilingMs` 600; después una `late` con `lateMs > 0` |
| E       | 0 ms     | `POST` sin cookie, y `POST` con cookie basura                                                          | cero líneas la primera; una línea `unverified` la segunda                                              |
| F       | —        | Rearranca el servidor con las dos `NEXT_PUBLIC_SUPABASE_*` vacías y repite el `POST` con cookie basura | 201 y **cero** líneas                                                                                  |
| G       | —        | `grep` sobre toda la salida capturada                                                                  | ninguna línea del prefijo contiene el correo, el `user.id`, el `Customer.id` ni el valor de la cookie  |

La corrida B es tan importante como la D: un detector que se dispara siempre es
tan inútil como uno que no se dispara nunca. Al terminar, el guion **limpia lo
que creó** (las filas de `Order` y el `Customer` de la corrida), con el mismo
criterio con el que F-028 limpia las suyas, y cierra su servidor y su proxy
pase lo que pase.

Dos detalles que deciden si esto funciona a la primera:

- La sesión se obtiene **antes** de encender el retraso y es **recién emitida**,
  así que no toca refresco: la corrida C paga un solo viaje a Auth y su
  `elapsedMs` cae donde tiene que caer. Con un token a punto de caducar serían
  dos viajes y C se convertiría en un `timeout`.
- La ruta se **calienta** con la corrida B antes de medir tiempos: en `next dev`
  la primera petición compila, y ese coste no es del instrumento.

## Criterios de aceptación

Los doce son los de `.agent/features.json`, literales y en su orden; todos
`[ya]`. Aquí va la forma **ejecutable** de cada uno.

1. `[ya]` Con una sesión real y Auth retrasado por encima del techo,
   `POST /api/orders` responde 201, `Order.customerId` queda `NULL` y se
   registra una línea `timeout` con el techo en milisegundos → corrida D de
   `bash .agent/verify.sh F-030 --probe`, salida 0.
2. `[ya]` El mismo pedido sin el retraso queda enlazado y no registra ninguna
   línea → corrida B, salida 0.
3. `[ya]` Las tres situaciones que hoy acaban en el mismo `NULL` son
   distinguibles → corridas E (nada / `unverified`) y D (`timeout`), salida 0.
4. `[ya]` Aviso temprano al pasar del umbral sin agotar el techo → corrida C, y
   el caso `slow` de `npx vitest run src/features/account/server/orderIdentity.test.ts`.
5. `[ya]` Cuando la resolución termina después del techo, queda constancia de
   cuánto tardó de más → línea `late` con `lateMs > 0` en la corrida D, y su
   caso unitario.
6. `[ya]` Pruebas unitarias, sin Docker, con un caso por cada resultado posible
   → `npx vitest run src/features/account/server/orderIdentity.test.ts` sale 0 y
   contiene los nueve casos de la tabla de arriba.
7. `[ya]` Medir no retrasa el pedido → caso unitario con la resolución colgada:
   `resolveOrderCustomerId()` resuelve por debajo de
   `ORDER_CUSTOMER_LINK_TIMEOUT_MS + 100`; y caso de invitado con **cero**
   llamadas a `getCustomerUser` y a `findCustomerIdByUserId`. En la corrida D,
   además, el `POST` responde en menos de lo que tarda la corrida B más el
   techo más 100 ms (ver la incongruencia I3 sobre por qué se mide así).
8. `[ya]` F-010 y F-012 intactos →
   `git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"` sin
   resultados, `npx vitest run src/features/account/boundaries.test.ts` en 0 y
   `bash .agent/verify.sh F-012 --smoke` en 0 pese a las líneas `unverified`
   nuevas que ahora imprime su cookie basura.
9. `[ya]` Con Supabase Auth sin configurar no se registra ninguna línea →
   corrida F, y el caso unitario «sin configurar».
10. `[ya]` Ninguna línea contiene datos personales ni credenciales → corrida G:
    un `grep` por cada uno de los cuatro valores, cero coincidencias.
11. `[ya]` `npm run check:bundle` termina en 0 sin subir `BUDGET_KB` →
    `git diff --stat scripts/check-bundle-budget.mjs` vacío y el comando en 0.
12. `[ya]` `bash .agent/verify.sh F-030 --full` termina con código 0.

### Trazabilidad de cada criterio

| Criterio | Escenarios | Reglas          |
| -------- | ---------- | --------------- |
| 1        | E4         | R1, R2, R11     |
| 2        | E2         | R1              |
| 3        | E1, E6, E4 | R1, R12         |
| 4        | E3         | R1              |
| 5        | E5         | R1, R5, R13     |
| 6        | E1–E9      | R1, R2, R12     |
| 7        | E1, E2     | R4, R5, R11     |
| 8        | E6         | R2, R6, R7, R13 |
| 9        | E9         | R12             |
| 10       | todos      | R3              |
| 11       | —          | R8              |
| 12       | todos      | R1–R13          |

Ningún escenario queda huérfano: E7, E8, E10 y E11 entran por el criterio 6 (el
caso unitario de cada desenlace) y por el 12; E10 y E11 no tienen corrida propia
en el probe porque su desenlace es el mismo de E2/E4 y lo que afirman —una
observación por **intento**, sin estado compartido— se comprueba mejor en la
mitad determinista.

## Incongruencias detectadas

- **I1 — resuelta antes de empezar.** La propuesta señalaba que el comentario de
  `src/features/orders/server/createOrder.ts` sobre `await customerLink` seguía
  afirmando que la identidad «resolves instantly». Ya no: las líneas 279-284 lo
  corrigen con la redacción de DA2. No hay nada que arreglar ahí; se anota para
  que nadie lo persiga.
- **I2 — las `notes` de F-030 y la propuesta citan un guardián que ya cambió.**
  Las dos dicen que `.agent/verify.sh` pone roja la etapa `smoke` cuando la
  salida casa con `(⨯|Unhandled|Error:)`. El patrón vigente
  (`SERVIDOR_ERROR_RE`, línea 40) es
  `(⨯|Unhandled|^[[:space:]]*([A-Z][A-Za-z]*)?Error([^A-Za-z0-9_]|$))`: exige
  que la línea **empiece** por algo acabado en `Error`. La conclusión no cambia
  —`console.warn` con este prefijo nunca lo dispara, y volcar una excepción sí,
  porque Node la imprime empezando por `Error [X]:`— pero quien implemente esto
  debe mirar el patrón real y no la cita, sobre todo si se le ocurre meter una
  palabra acabada en `Error` al principio de la línea.
- **I3 — el criterio 7, leído al pie de la letra sobre HTTP, no es medible en
  `next dev`.** Dice «el pedido responde por debajo del techo más 100 ms», y un
  `POST /api/orders` incluye la compilación de la primera petición, la búsqueda
  de tienda, la cotización y el `INSERT`: en desarrollo eso solo ya pasa de
  700 ms sin que nada vaya mal. El criterio no se toca (regla 3); lo que esta
  spec fija es **dónde se mide**: en `resolveOrderCustomerId()`, que es la única
  parte que este feature toca, con el aserto unitario de la resolución colgada,
  y en el probe como **delta** contra la corrida de control ya calentada. Si el
  humano quiere el aserto literal sobre el HTTP, hace falta un criterio nuevo
  `[nuevo]` que fije el entorno de medida (build de producción, ruta caliente).
- **I4 — `getCustomerUser()` documenta como virtud justo lo que el criterio 9
  necesita distinguir.** Su comentario dice que «a missing configuration, an
  expired token or Supabase being unreachable all look identical from the
  outside». Sigue siendo cierto y correcto para esa función; por eso el
  instrumento **no** puede deducir E9 de su valor de retorno y tiene que
  consultar `isSupabaseAuthConfigured()` (R12). Se anota porque es el hueco que
  más fácilmente se implementa mal: quien no lo lea emitirá `unverified` en cada
  pedido de un despliegue sin Auth, rompiendo el criterio 9.
- **I5 — la etapa nueva se sale del patrón de las otras dos etapas de runtime,
  a propósito.** `--smoke` y `--visual` toman su guion de `.agent/specs/<ID>/` y
  **reutilizan** un `next dev` existente; `--probe` toma el suyo de scripts/ (por
  decisión del humano) y **no puede** reutilizar servidor. Quien lo implemente
  tiene que copiar `puerto_libre` y el chequeo de `servidor_propio` de
  `.agent/verify.sh` para **fallar**, no para reutilizar.
- **I6 — el `etapa:` de `.agent/playbook/TEMPLATE.md` no contempla ni `visual`
  ni la etapa nueva.** Hoy admite
  `harness | typecheck | lint | format | test | prisma | build | theme | bundle | smoke | review`.
  `npm run check:harness` no lo detecta porque solo exige cubrir las etapas de
  `STAGES_COMPLETO`, así que una ficha nacida de un fallo del probe no tendría
  valor legal que poner en su frontmatter. Añadir `probe` (y `visual`) a esa
  lista es una línea y no la escribe `sdd-spec`.
- **I7 — el encargo del riesgo 7 de F-012 sigue viviendo solo en su
  arquitectura.** Este feature lo recoge; queda anotado porque es la segunda vez
  que el mismo patrón —un encargo escrito en la arquitectura de un feature
  cerrado— sobrevive por casualidad.

## Huecos y preguntas al humano

**Ninguna.** SP1 (¿entra la línea tardía?), SP2 (el umbral del aviso temprano),
SP3 (¿log o fila en Postgres?) y SP4 (el token caducado en el checkout) están
resueltas y escritas arriba; SP1 y SP3 las cierran los propios
`acceptance_criteria` y las `notes` del feature, SP2 y la forma de la
verificación las cerró el humano el 2026-09-01 (`.agent/progress/F-030.md`
§ Decisiones tomadas), y SP4 la cerraron las `notes`. Por eso esta spec sale en
`estado: listo`.

Lo único que podría reabrirse es el criterio 7 si el humano quiere el aserto
literal sobre HTTP (ver I3), y eso sería un criterio nuevo, no una pregunta.

## No decidido a propósito

- **Dónde vive exactamente la emisión** —dentro de `resolveOrderCustomerId()`,
  en un helper hermano, o repartida con `after()` desde
  `src/app/api/orders/route.ts`— lo decide `sdd-architect`. Esta spec fija qué
  se observa, con qué forma y qué no puede costar.
- **Con qué mecanismo se emite la línea `late`**: una continuación sobre la rama
  perdedora, `after()` como en `src/app/[slug]/buscar/page.tsx`, o las dos
  cosas. Lo que no es negociable es que no retrase la respuesta (R5) y que no
  deje un rechazo sin manejar (R13).
- **Si `outcome` se modela como unión de literales o como enum** en
  `src/constants/account.ts`. Lo que no admite discusión es que no sea un
  literal suelto.
- **Si la observación llega a llevar el código del pedido.** Hoy no puede: la
  resolución empieza antes de leer el cuerpo. Si el arquitecto encuentra cómo
  devolver el `outcome` a la ruta y registrarlo tras `createOrder` sin cambiar
  la firma que protege R11, gana correlación gratis; si no, se queda en contar.
- **El texto exacto de la línea de `AGENTS.md` y de la ficha del playbook** sobre
  cómo se registra en este repo. Las escribe quien implemente, no esta spec.
- **Qué se hace el día que el número deje de ser cero**: persistir al estilo de
  `src/features/catalog/server/searchLog.ts`, subir el techo, o migrar Auth a
  claves asimétricas (opción 2 de la ficha
  `.agent/playbook/getclaims-hs256-sale-a-la-red.md`, que elimina el viaje
  entero). Fuera de este feature, y con el dato delante.
