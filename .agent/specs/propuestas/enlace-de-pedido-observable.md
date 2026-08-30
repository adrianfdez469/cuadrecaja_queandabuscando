---
propuesta: enlace-de-pedido-observable
agente: sdd-spec
actualizado: 2026-08-30T04:24:35Z
estado: propuesta
---

## Problema

Cuando `resolveOrderCustomerId()` pierde la carrera contra su temporizador de
600 ms, el pedido se crea igual con `customerId` en `null` y responde 201:
**indistinguible de un pedido de invitado**, sin log, sin métrica y sin nada
que contar. Ese comportamiento es el correcto —resolver la identidad nunca
puede impedir un pedido— pero **agotar el techo es hoy invisible**, así que un
Supabase Auth lento degradaría el enlace de pedidos en silencio y nadie se
enteraría hasta que alguien reclamara un historial vacío.

Dejó de ser teórico el 2026-08-30. La arquitectura de F-012 daba por hecho que
resolver la sesión costaba «microsegundos» porque `getClaims()` verificaba el
JWT en local; con HS256 —lo que firma este montaje— `@supabase/auth-js` cae a
`getUser(token)`, que es un `GET /auth/v1/user` **por llamada y sin caché**
(ficha `.agent/playbook/getclaims-hs256-sale-a-la-red.md`, y
`.agent/specs/F-012/architecture.md` § Escalabilidad, ya corregida). Con un
viaje de red dentro del presupuesto, la carrera es real. Esta propuesta es
sobre **verla**, no sobre cambiarla.

## Alcance

### Dentro

- **Una observación por intento de enlace**, y solo cuando había cookie de
  cliente: qué pasó (`outcome`) y cuánto tardó (`elapsedMs`). Distingue «no
  había sesión» —que no produce nada— de «había sesión y no llegué a tiempo»,
  que es el corazón del asunto.
- **Un aviso temprano**: cuando el enlace **sí** ocurre pero consume la mitad
  del techo o más, queda constancia. Un instrumento que solo habla cuando ya se
  perdió el pedido no da margen para reaccionar.
- **La llegada tardía**: cuando el temporizador gana, cuánto habría faltado.
  Es la diferencia entre «el techo se quedó corto por 40 ms» y «Auth está
  roto», y sin ella `elapsedMs` de un `timeout` siempre vale ≈600 y no informa
  de nada.
- **El mecanismo que el repo ya usa**: `console.warn` con prefijo `[scope]` y
  un objeto estructurado detrás. Ninguna dependencia nueva, ningún servicio
  externo, ninguna tabla nueva (ver § El registro que ya existe aquí).
- **La demostración de que el detector se dispara**, provocando el fallo con
  Auth de verdad retrasado, y la demostración simétrica de que **no** se
  dispara cuando no debe.
- Una ficha en `.agent/playbook/` y una línea de convención en `AGENTS.md`
  sobre cómo se registra en este repo, que hoy es costumbre y no está escrita.

### Fuera (explícito)

- **Cambiar el techo de 600 ms o el mecanismo de DA2.** El arquitecto ya lo
  revisó con el coste real y lo mantuvo
  (`.agent/specs/F-012/architecture.md` § Escalabilidad). Esta propuesta mide;
  quien decida moverlo lo hará con el dato delante, no antes.
- **Cualquier dependencia de observabilidad, SDK de métricas, APM o drenaje de
  logs.** Ver SP3.
- **Persistir las observaciones en Postgres.** Ninguna tabla, ninguna
  migración, ningún campo nuevo en `Order`. Es el escalón siguiente si el
  registro llegara a contar algo distinto de cero, y va en SP3.
- **Alertar a alguien.** Nadie vigila logs en este proyecto hoy y esta
  propuesta no finge lo contrario: hace el fallo **contable cuando alguien
  mira**, no avisable.
- **Instrumentar los otros tres caminos que también pagan el viaje a Auth**
  (`/cuenta`, `PUT /api/account/profile`, el autocompletado del checkout).
  Ninguno tiene presupuesto ni consecuencia silenciosa; el único con las dos
  cosas es `POST /api/orders`.
- **Tocar `scripts/place-order.mjs`.** No manda cabecera `Cookie` a propósito,
  y eso **es** la prueba del criterio 4 de F-010: se deja como está.
- **Correlacionar cada observación con su pedido.** La identidad se empieza a
  resolver antes de leer el cuerpo (DA2, paso 1), así que cuando la línea se
  emite todavía no existe ni el código del pedido ni el slug de la tienda. Las
  líneas se **cuentan**, no se cruzan. Ver § No decidido a propósito.
- **Renegociar nada de F-012 ni de F-028**, que están cerrados.

## El registro que ya existe aquí

Lo busqué antes de proponer nada, porque parte del encargo era no inventar un
sistema donde ya hay una costumbre.

| Mecanismo                     | Dónde                                                                                           | Qué es                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `console.error("[scope] …")`  | 30 sitios, de `src/app/api/orders/route.ts` a `src/lib/supabase/storage.ts`                     | Fallo real: algo que no se pudo hacer. A veces con un objeto estructurado detrás |
| `console.warn("[scope] …")`   | `src/features/catalog/server/queries.ts`, `src/lib/promotions.ts`                               | Degradación tolerada: se sigue, pero conviene saberlo                            |
| Fila en Postgres              | `src/features/catalog/server/searchLog.ts` (F-021), `src/features/sync/server/inbox.ts` (F-007) | Observación que hay que poder consultar **días después**, con su tabla           |
| Logger, SDK, servicio externo | **no existe**                                                                                   | Y no hace falta uno para esto                                                    |

Dos precedentes que importan y que se siguen tal cual:
`src/features/catalog/server/searchLog.ts` **nunca lanza** y lo programa el
llamador con `after()`, después de que la respuesta ya salió; y todo el repo
escribe el mensaje en inglés con prefijo `[scope]`, como manda `AGENTS.md`
§ Idioma.

**Se elige `console.warn` con prefijo, no fila en Postgres.** Motivos, en
orden: (a) el volumen está acotado por pedidos con sesión, no por tráfico, así
que no hay nada que agregar ni que purgar; (b) escribir una fila desde el
camino del pedido añadiría un viaje a la base al único camino con presupuesto,
que es justo lo que R14 evita; (c) 30 líneas de código contra una migración,
una tabla y su retención. Lo que esa elección **no** compra está dicho sin
adornos en § Qué se hace con el dato.

**Y `warn`, nunca `error`, por una razón mecánica**: `.agent/verify.sh` línea
295 pone roja la etapa `smoke` si la salida del servidor casa con
`(⨯|Unhandled|Error:)`. Un instrumento que tiñera de rojo el sensor cada vez
que Auth va lento duraría hasta el primer agente que lo borrara para poner
verde su feature.

## Actores y precondiciones

**Actor**: quien opera o depura este producto —persona o agente— leyendo la
salida del servidor. No hay actor de producto: el comprador no ve nada nuevo,
no aprende nada nuevo y su pedido responde exactamente igual.

Precondiciones:

1. F-012 cerrado y funcionando, que es el caso (`passes: true`).
2. F-028 cerrado, que también lo es: el emulador local de Auth y
   `scripts/auth-otp.mjs` son lo que permite obtener una sesión **de verdad**
   sin proyecto en la nube, y sin eso los criterios 1 a 5 de aquí no serían
   ejecutables.
3. Postgres local en pie, para leer `Order.customerId` después de cada pedido.

## Comportamiento esperado

Todos los escenarios ocurren en `POST /api/orders`. «Una línea» significa
exactamente una línea en la salida del servidor con el prefijo literal
`[orders] customer link`.

- **E1 — Invitado.** Dado un pedido sin ninguna cookie `qab-shopper-auth`,
  cuando se crea, entonces responde 201, `Order.customerId` queda `NULL` y se
  emiten **cero** líneas. El camino de invitado no paga ni un log.
- **E2 — Enlace normal.** Dada una sesión válida y un Auth que responde por
  debajo del umbral de aviso, cuando se crea el pedido, entonces responde 201,
  `Order.customerId` es el `Customer.id` de la sesión y se emiten **cero**
  líneas. La fila enlazada **es** el registro del caso bueno; no se duplica en
  el log.
- **E3 — Enlace lento (aviso temprano).** Dada una sesión válida y una
  resolución que tarda entre `ORDER_CUSTOMER_LINK_SLOW_MS` y el techo, cuando
  se crea el pedido, entonces se enlaza igual **y** se emite una línea con
  `outcome: "slow"` y su `elapsedMs`.
- **E4 — El temporizador gana.** Dada una sesión válida y una resolución que
  supera el techo, cuando se crea el pedido, entonces responde **201**,
  `Order.customerId` queda `NULL` —lo prometido por R14, que no cambia— y se
  emite una línea con `outcome: "timeout"`, `elapsedMs` ≈ `ceilingMs` y
  `ceilingMs: 600`.
- **E5 — Llegada tardía.** Dado el escenario E4, cuando la resolución que
  perdió la carrera termina —después de que la respuesta ya salió—, entonces
  se emite una segunda línea con `outcome: "late"`, `lateMs` (cuánto tardó de
  más sobre el techo) y `resolved` (si al final había identidad o no). Nunca
  antes de la respuesta, nunca retrasándola.
- **E6 — Había sesión, pero no se pudo verificar.** Dada una cookie
  `qab-shopper-auth` ilegible, caducada sin refresco posible, o un Auth que
  responde error, cuando se crea el pedido, entonces 201, `customerId` `NULL`
  y una línea con `outcome: "unverified"`. **Esta es la línea que separa el
  «no había sesión» del «había sesión y falló»**, que hoy acaban los dos en el
  mismo `null`.
- **E7 — Sesión verificada sin `Customer`.** Dado un token válido cuyo
  `supabaseUserId` no tiene fila en `Customer`, entonces 201, `NULL` y una
  línea con `outcome: "no_customer"`. No debería ocurrir nunca —el primer
  login lo crea— y por eso merece un valor propio: si aparece, hay un agujero
  en otro sitio.
- **E8 — Excepción inesperada.** Dado cualquier fallo que hoy captura el
  `catch` de `resolveOrderCustomerId`, entonces 201, `NULL` y una línea con
  `outcome: "error"`, **sin el mensaje de la excepción** (R2).
- **E9 — Auth sin configurar.** Dado el entorno del criterio 6 de F-012
  (`NEXT_PUBLIC_SUPABASE_URL` vacío), cuando llega un pedido con cualquier
  cookie de cliente, entonces 201, `NULL` y **cero** líneas: un despliegue sin
  Auth no es un fallo y no debe generar ruido en cada pedido.
- **E10 — Reintento idempotente.** Dados dos `POST` con el mismo
  `idempotencyKey` y la misma sesión, entonces el segundo responde 200
  `idempotent` y **también** observa su intento. Las líneas cuentan
  **intentos de resolución**, no pedidos distintos; quien divida por pedidos
  tiene que saberlo.
- **E11 — Concurrencia.** Dados N pedidos simultáneos con sesión, entonces se
  emiten N observaciones independientes. No hay contador en memoria del
  proceso que sumar (R10).

## Reglas de negocio

- **R1 — Una sola cadena que buscar.** Todas las líneas empiezan por el
  literal `[orders] customer link`, en `console.warn`, y se distinguen por el
  campo `outcome`. Un solo `grep` da el total; un `grep` más el valor da cada
  causa.
- **R2 — Nunca el mensaje de la excepción en la línea.** Contendría `Error:` y
  pondría roja la etapa `smoke` de cualquier feature (`.agent/verify.sh`, la
  línea 295). Se registra que hubo un error, no cuál.
- **R3 — Cero PII y cero credenciales.** Ni correo, ni `user.id`, ni
  `Customer.id`, ni teléfono, ni valor de cookie, ni IP. Solo `outcome`,
  milisegundos y el techo.
- **R4 — El invitado no paga nada.** Sin cookie de cliente no hay medición, no
  hay línea y no hay ninguna llamada nueva: el corte de
  `hasCustomerSessionCookie()` sigue siendo lo primero que ocurre.
- **R5 — Medir no retrasa el pedido.** Ni un `await` nuevo en el camino de la
  respuesta. `resolveOrderCustomerId()` sigue resolviendo en ≤ el techo y
  sigue sin rechazar nunca. Lo único que se añade en línea es leer un reloj y
  escribir una línea.
- **R6 — La frontera de F-010 no se toca.** `cookies()` sigue sin aparecer en
  `src/features/orders/` ni en `src/app/[slug]/`, y
  `src/features/account/boundaries.test.ts` sigue en verde. La identidad se
  sigue resolviendo donde ya se resolvía.
- **R7 — La respuesta HTTP no cambia.** Ni cabecera nueva, ni campo nuevo, ni
  código distinto. El comprador no aprende nada que no supiera y el POS recibe
  el mismo pedido byte a byte (`docs/sync-contract.md` intacto).
- **R8 — Nada de migración, dependencia ni bundle.** Cero cambios en
  `prisma/schema.prisma`, cero en `package.json`, cero JavaScript de cliente
  nuevo: todo esto vive en el servidor.
- **R9 — Volumen acotado.** Como mucho dos líneas por intento de pedido **con
  cookie de cliente**. El tráfico de catálogo, que es casi todo, no produce ni
  una.
- **R10 — Ningún contador en memoria.** En serverless cada instancia tendría
  el suyo y la suma no existiría en ninguna parte. Cada observación es una
  línea independiente y el agregado se hace al leer.
- **R11 — El techo y el mecanismo de DA2 no cambian.** 600 ms sigue siendo
  600 ms, el `Promise.race` sigue siendo el mismo y `createOrder` sigue
  recibiendo un `Promise<string | null>` con su valor por omisión, que es lo
  que mantiene intacta la suite de F-010.

## Casos límite y errores

- **Cookie basura** (`qab-shopper-auth=smoke-garbage-session`, que es
  literalmente lo que manda `.agent/specs/F-012/smoke.sh`): produce
  `unverified`. Consecuencia buscada y comprobable: ese smoke ajeno empezará a
  imprimir líneas nuevas, y como son `warn` **no** puede volverse rojo por
  ellas. Es el criterio 8.
- **Token caducado.** El proxy solo refresca en `/cuenta*` y `/auth*`
  (`src/proxy.ts`), así que quien vuelve a la tienda una hora después llega al
  checkout con el token vencido y paga **dos** viajes dentro del techo, según
  la tabla de § Escalabilidad de F-012. Es el caso con más probabilidad de
  agotar los 600 ms, y esta propuesta lo hará visible por primera vez. Ver
  SP4.
- **Auth caído del todo.** Cada pedido con sesión emite una línea. Acotado por
  R9: es ruido proporcional a los pedidos, no al tráfico, y es exactamente el
  ruido que uno quiere en ese momento.
- **La línea tardía puede no llegar a emitirse** si el runtime congela la
  invocación en cuanto responde. Se programa con `after()`, que es la API que
  Next da justo para esto y que este repo ya usa en
  `src/app/[slug]/buscar/page.tsx` para registrar búsquedas. Si aun así se
  perdiera, lo que se
  pierde es `lateMs`, no la detección: el `timeout` ya quedó registrado.
- **Dos observaciones para un mismo pedido** (`timeout` y luego `late`): quien
  cuente fallos filtra por `outcome`, no por líneas totales. Está en el
  contrato de abajo.
- **Reloj.** `elapsedMs` se mide con un reloj monótono, no con la hora del
  sistema: un ajuste de NTP en medio de la carrera no puede producir un
  negativo.

## Datos y contrato

Nada de esto toca `docs/sync-contract.md`, ni el payload de
`/api/internal/orders`, ni `prisma/schema.prisma`, ni `package.json`.

La única superficie nueva es la línea, y su forma es el contrato:

```
console.warn("[orders] customer link", {
  outcome,      // "slow" | "timeout" | "late" | "unverified" | "no_customer" | "error"
  elapsedMs,    // entero, reloj monótono; en "late" se acompaña de lateMs
  ceilingMs,    // ORDER_CUSTOMER_LINK_TIMEOUT_MS, para que la línea se lea sola
})
```

| Campo       | Tipo              | Obligatorio    | Nota                                                               |
| ----------- | ----------------- | -------------- | ------------------------------------------------------------------ |
| `outcome`   | enum de 6 valores | sí             | En `src/constants/account.ts`, no como literal suelto              |
| `elapsedMs` | entero ≥ 0, ms    | sí             | Desde que empieza la resolución hasta que se resuelve la carrera   |
| `lateMs`    | entero ≥ 0, ms    | solo en `late` | Cuánto tardó **de más** sobre el techo                             |
| `resolved`  | booleano          | solo en `late` | Si la resolución tardía traía identidad o no                       |
| `ceilingMs` | entero, ms        | sí             | 600 hoy; se imprime para que la línea no dependa de leer el código |

Constante nueva: `ORDER_CUSTOMER_LINK_SLOW_MS`, en `src/constants/account.ts`,
junto a `ORDER_CUSTOMER_LINK_TIMEOUT_MS` y con el mismo estilo de comentario.
Valor propuesto **300** (la mitad del techo); ver SP2.

## Cómo se demuestra la detección provocando el fallo

Un instrumento que nadie ha visto dispararse no está verificado, así que la
verificación tiene dos mitades y las dos se ejecutan.

**Mitad determinista, sin Docker**, en `src/features/account/server/orderIdentity.test.ts`
(que ya existe y ya tiene el caso de la resolución colgada): se cuelga
`getCustomerUser`, gana el temporizador de verdad, y se comprueba que se emitió
la línea con `outcome: "timeout"`. Corre en `npm test` y en CI, en
milisegundos y sin red.

**Mitad de verdad, contra el Auth real de F-028**, con un guion nuevo,
scripts/order-link-probe.mjs (por crear), que hace todo esto y sale 0 o
distinto de 0:

1. Levanta **su propio** `next dev` en un puerto libre, con la salida
   redirigida a un archivo que él controla. Hace falta porque
   `.agent/verify.sh` guarda la salida del servidor en un temporal que el
   guion de smoke no puede leer: sin servidor propio no hay forma de afirmar
   nada sobre lo que el servidor escribió.
2. Lo arranca apuntando `NEXT_PUBLIC_SUPABASE_URL` a un **proxy lento** que el
   propio guion levanta: espera `--delay-ms` y reenvía a
   `http://localhost:54321`. Retrasar Auth de verdad, en vez de bajar el
   techo, es lo que ejercita la carrera tal como ocurriría en producción, y no
   obliga a hacer configurable un número que esta propuesta se ha prohibido
   discutir.
3. Consigue una sesión real llamando a `scripts/auth-otp.mjs` en su modo
   `app` y con su `--cookie-jar`, que es el camino que F-028 dejó
   automatizado.
4. **Corrida de control**, sin retraso: cotiza, hace el `POST /api/orders` con
   la cookie, y exige 201, `Order.customerId` igual al `Customer` de la sesión
   y **cero** líneas.
5. **Corrida provocada**, con el retraso por encima de 600 ms: mismo `POST`,
   y exige 201, `Order.customerId` `NULL` y **una** línea `timeout` con su
   `ceilingMs`. Después, la línea `late` con su `lateMs`.
6. **Corrida de contraste**, sin cookie y con cookie basura, para que quede
   demostrado que las tres situaciones que hoy son el mismo `null` producen
   tres registros distintos: nada, `unverified` y `timeout`.
7. Limpia lo que creó (las filas de `Order` y el `Customer` de la corrida), con
   el mismo criterio con el que F-028 limpia las suyas.

La corrida de control es tan importante como la provocada: un detector que se
dispara siempre es tan inútil como uno que no se dispara nunca.

## Criterios de aceptación propuestos

Todos `[nuevo]`: esto no es un feature del backlog todavía. Escritos para
copiarse tal cual a `.agent/features.json` si el humano los acepta.

1. `[nuevo]` Provocando el fallo: con Auth retrasado por encima del techo y una
   sesión real del emulador de F-028, `POST /api/orders` responde 201, la
   consulta a Postgres muestra `Order.customerId` `NULL`, y la salida del
   servidor tiene exactamente una línea `[orders] customer link` con
   `outcome` `timeout` y `ceilingMs` 600. Un solo comando
   (`node scripts/order-link-probe.mjs`) y código de salida 0.
2. `[nuevo]` El detector no se dispara cuando no debe: en la misma corrida, sin
   retraso, el mismo pedido queda enlazado al `Customer` de la sesión y produce
   cero líneas.
3. `[nuevo]` Las tres situaciones que hoy acaban en el mismo `customerId` `NULL`
   se distinguen en el registro: sin cookie, cero líneas; con cookie ilegible,
   una línea `unverified`; con el temporizador ganando, una línea `timeout`.
4. `[nuevo]` Aviso temprano: con Auth retrasado por encima de
   `ORDER_CUSTOMER_LINK_SLOW_MS` pero por debajo del techo, el pedido **sí**
   queda enlazado y aparece una línea `slow` con su `elapsedMs`.
5. `[nuevo]` La llegada tardía queda registrada: tras la línea `timeout`
   aparece una línea `late` cuyo `lateMs` es mayor que 0, emitida **después**
   de que la respuesta ya salió.
6. `[nuevo]` Sin Docker y en CI: `npx vitest run src/features/account/server/orderIdentity.test.ts`
   sale 0 e incluye un caso por cada `outcome`, más uno que comprueba que el
   camino de invitado no llama a `console.*` ni una vez.
7. `[nuevo]` Medir no retrasa: con la resolución colgada, `resolveOrderCustomerId()`
   sigue resolviendo por debajo de `ORDER_CUSTOMER_LINK_TIMEOUT_MS + 100`, y el
   camino de invitado sigue sin hacer ninguna llamada a Supabase ni a Prisma
   (los asertos que ya existen en ese archivo siguen pasando sin tocarlos).
8. `[nuevo]` No se rompe nada de F-010 ni de F-012:
   `git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"` sigue sin
   devolver nada, `npx vitest run src/features/account/boundaries.test.ts` sale
   0, y `bash .agent/verify.sh F-012 --smoke` sigue saliendo 0 pese a las
   líneas nuevas que ahora imprime su cookie basura.
9. `[nuevo]` Con Auth sin configurar (criterio 6 de F-012):
   `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build`
   sale 0 y, sobre ese build, un pedido con cookie de cliente responde 201 y
   produce cero líneas.
10. `[nuevo]` Ni PII ni credenciales: en toda la salida capturada por el guion,
    ninguna línea `[orders] customer link` contiene el correo de la corrida, el
    `user.id`, el `Customer.id` ni el valor de la cookie. Se comprueba con un
    `grep` de cada uno de los cuatro.
11. `[nuevo]` El coste de cliente no cambia: `npm run check:bundle` sale 0 sin
    tocar `BUDGET_KB` en `scripts/check-bundle-budget.mjs`.
12. `[nuevo]` `bash .agent/verify.sh <ID> --full` termina con código 0.

## Qué se hace con el dato

Honestidad sobre hasta dónde llega esto, que era parte del encargo.

**Lo que sí compra.** El fallo pasa de invisible a **contable en cuanto alguien
mira**. En local y en CI la línea aparece en el bloque
`--- salida del servidor (runtime feedback) ---` que `.agent/verify.sh` vuelca
al final de cada etapa `smoke`. En producción aparece en el log de ejecución
del despliegue, buscable por el prefijo literal. Y da los tres números que hoy
no existen: cuántos enlaces se pierden por el techo, cuántos se pierden por
otra causa, y por cuánto se está fallando.

**Lo que no compra, dicho claro.** No hay alerta, no hay panel, no hay drenaje
de logs y nadie mira los logs por costumbre. Un `timeout` a las tres de la
madrugada queda escrito y, si el despliegue rota sus logs antes de que alguien
entre, se pierde. Eso es aceptable **como primer escalón** y deja de serlo en
cuanto el número sea distinto de cero: ahí es cuando se persiste (SP3).

**El umbral y la acción, escritos donde se lean.** Van en las `notes` del
feature y en la ficha del playbook, no en un panel que no existe: si aparece
alguna línea `timeout`, se mira su `late`/`lateMs` en las mismas horas. Si
`lateMs` es pequeño y estable, el techo se quedó corto y **el humano** decide
subirlo. Si es grande o disperso, el problema es Auth, y la salida buena es la
opción 2 de la ficha `.agent/playbook/getclaims-hs256-sale-a-la-red.md`
—migrar el proyecto a claves de firma asimétricas— que **elimina el viaje
entero** sin tocar ni una línea del código que llama.

## Coste estimado

- **Un feature pequeño, una sesión.** El grueso no es el instrumento, son las
  dos mitades de la verificación.
- **Código de producción: unas 40 líneas**, en `src/features/account/server/orderIdentity.ts`
  (la medición y la emisión), `src/constants/account.ts` (la constante del
  umbral y los seis valores de `outcome`) y, si la línea tardía se programa con
  `after()`, unas pocas en `src/app/api/orders/route.ts`.
- **Pruebas: unas 60 líneas** en `src/features/account/server/orderIdentity.test.ts`,
  todas sobre un archivo que ya está montado con sus mocks.
- **Guion: unas 180 líneas**, scripts/order-link-probe.mjs (por crear), que es
  lo más caro de todo. Reutiliza el patrón de `scripts/place-order.mjs` para el
  pedido y la lectura de Postgres, y el de `scripts/auth-otp.mjs` para la
  sesión.
- **Cero migraciones, cero dependencias, cero KB de cliente.**
- **Riesgos, en orden de probabilidad**: (a) que la línea `late` no sobreviva
  al cierre de la invocación en producción, con lo que se pierde `lateMs` pero
  no la detección; (b) que el proxy lento del guion se coma alguna cabecera y
  la sesión no se acepte —repliegue: retrasar solo la ruta `/auth/v1/user`, que
  es la única que importa—; (c) que arrancar un segundo `next dev` desde el
  guion choque con el puerto de otro checkout, que es un fallo que
  `.agent/verify.sh` ya sabe diagnosticar y del que se copia el chequeo.
- **Criterio de abandono**: si demostrar la línea `late` cuesta más de un
  intento serio, se entrega sin ella y se anota. La detección del `timeout` no
  depende de ella.

## Incongruencias detectadas

- **I1** — `src/features/orders/server/createOrder.ts`, en el comentario justo
  encima de `const customerId = await customerLink;`, todavía afirma que «in
  the normal case this resolves instantly and the order is not delayed». Es
  **la misma frase que `.agent/specs/F-012/architecture.md` § DA2 corrigió el
  2026-08-30** por ser demasiado fuerte: con HS256 hay un viaje de red y la
  rama puede terminar después que el trabajo de Postgres. La corrección llegó a
  la arquitectura y no al comentario del código. No lo arreglo —esta propuesta
  no toca `src/`— pero quien implemente esto pasa justo por ahí y debería
  corregirlo en el mismo cambio.
- **I2** — El riesgo 7 de `.agent/specs/F-012/architecture.md` dice que «quien
  recoja el testigo debería poder contar cuántas veces gana el temporizador», y
  ese encargo vive **solo** dentro de la arquitectura de un feature cerrado:
  las `notes` de F-012 en `.agent/features.json` no lo mencionan. Es
  exactamente el patrón que la propuesta del emulador ya fichó como I2 —«un
  encargo escrito en la arquitectura de un feature cerrado no llega solo al
  siguiente»— repitiéndose por segunda vez en el mismo feature. Si el humano
  descarta esta propuesta, la línea debería ir igualmente a las `notes` de
  F-012, o se perderá.
- **I3** — `AGENTS.md` fija el idioma de los logs y nada más: no dice con qué
  nivel se registra qué, ni que el prefijo es `[scope]`, aunque los 35 sitios
  que registran algo lo cumplan sin excepción. Peor: no dice en ninguna parte
  que `console.error` en una ruta pone **roja** la etapa `smoke` por el `grep`
  de `.agent/verify.sh`. Es una convención que ya se repite y una trampa que ya
  existe: van una línea a `AGENTS.md` y una ficha al playbook, y están dentro
  del alcance.
- **I4** — `.agent/specs/F-012/spec.md` describe E17 («la sesión no se puede
  verificar») y el agotamiento del techo como el mismo desenlace, «se trata
  como invitado», sin distinguirlos. Es correcto **de cara al comprador** y es
  justo lo que esta propuesta separa **de cara a quien opera**. No hay
  contradicción que arreglar: hay un matiz que hasta hoy no tenía dónde
  escribirse.

## Huecos y preguntas al humano

**SP1 — ¿Entra la línea tardía (`late`), la que dice por cuánto se falló?**
Qué falta: decidir si el instrumento, además de registrar que el temporizador
ganó, sigue esperando a la resolución perdedora para anotar cuánto habría
faltado.
Por qué importa: sin ella, `elapsedMs` de un `timeout` siempre vale ≈600 y no
distingue «el techo se quedó corto por 40 ms» —donde la acción es subirlo— de
«Auth tardó 5 segundos», donde la acción es otra completamente distinta. Con
ella hay que usar `after()` y aceptar que en producción puede perderse.
Opciones: (a) sí, con `after()`, asumiendo que a veces no llegue; (b) no, solo
la línea del `timeout`; (c) sí, pero solo fuera de producción.
**Recomiendo (a)**: es el único campo que convierte el registro en una decisión,
y perderlo a veces no cuesta nada porque el `timeout` ya quedó escrito antes.

**SP2 — ¿Entra el aviso temprano (`slow`) y con qué umbral?**
Qué falta: confirmar `ORDER_CUSTOMER_LINK_SLOW_MS` = 300 ms, la mitad del
techo.
Por qué importa: es la diferencia entre enterarse **antes** de perder pedidos y
enterarse **cuando** ya se están perdiendo. Cuesta una constante y una
comparación, y a cambio mete líneas en el log de despliegues que hoy no fallan
nada.
Opciones: (a) sí, a 300 ms; (b) sí, a 450 ms (75 % del techo), menos ruido y
menos margen; (c) no, solo se registra lo que ya falló.
**Recomiendo (a)**: 300 ms ya es más de lo que debería costar un viaje a Auth
en la misma región, así que una línea `slow` en producción es información real,
no ruido de fondo.

**SP3 — ¿Basta con que quede en el log, o hace falta que alguien se entere?**
Qué falta: el alcance del final del recorrido del dato.
Por qué bloquea: cambia el tamaño del feature de «una sesión» a «una sesión y
media más una tabla con su retención».
Opciones: (a) solo log, con el umbral y la acción documentados —lo que propone
este documento—; (b) además, una fila en Postgres por observación, siguiendo el
precedente exacto de `src/features/catalog/server/searchLog.ts`, que permite
contar semanas después y sobrevive a la rotación de logs; (c) drenaje de logs o
servicio externo, fuera del repo y con coste recurrente.
**Recomiendo (a) ahora y (b) en cuanto el número deje de ser cero**: hoy nadie
sabe si esto ocurre una vez al mes o cien veces al día, y montar la tabla antes
de saberlo es construir la segunda mitad de un puente sin haber medido el río.

**SP4 — El token caducado en el checkout: ¿se mira ahora o se espera al dato?**
Qué falta: el proxy solo refresca la sesión en `/cuenta*` y `/auth*`, así que
quien vuelve a la tienda pasada una hora llega al checkout con el token vencido
y paga **dos** viajes a Auth dentro del techo de 600 ms. Es el candidato número
uno a agotarlo.
Por qué lo pregunto en vez de proponerlo: cualquier arreglo toca DA4 de F-012 y
el `matcher` del proxy, que es territorio prohibido para esta propuesta —y
`/[slug]` no puede entrar en el `matcher` bajo ningún concepto, o se pierde el
ISR de la tienda entera.
Opciones: (a) no hacer nada ahora: el instrumento dirá si esta hipótesis es
cierta, porque ese caso aparecerá como `timeout` o como `slow`; (b) abrir ya
una propuesta aparte para refrescar antes del checkout; (c) meterlo aquí.
**Recomiendo (a)**: esta propuesta existe precisamente para dejar de decidir
sobre latencias sin medirlas. Si el dato confirma la hipótesis, (b) se escribe
sola y con evidencia.

## No decidido a propósito

- **Dónde vive exactamente la emisión** —dentro de `resolveOrderCustomerId()`,
  en un helper hermano, o repartida con `after()` desde
  `src/app/api/orders/route.ts`— lo decide `sdd-architect`. Lo que este
  documento fija es qué se observa, con qué forma y qué no puede costar.
- **Si la observación llega a llevar el código del pedido.** Hoy no puede: la
  resolución empieza antes de leer el cuerpo. Si el arquitecto encuentra una
  forma de devolver el `outcome` a la ruta y registrarlo tras `createOrder` sin
  cambiar la firma que R11 protege, gana correlación gratis; si no, se queda en
  contar.
- **El valor exacto de `ORDER_CUSTOMER_LINK_SLOW_MS`** más allá de la
  recomendación de SP2.
- **Si `outcome` se modela como unión de literales o como enum** en
  `src/constants/account.ts`. Lo que no admite discusión es que no sea un
  literal suelto (`AGENTS.md` § Prohibiciones).
- **Qué pasa con las observaciones el día que haya panel.** Fuera de aquí, y
  probablemente fuera de este año.
