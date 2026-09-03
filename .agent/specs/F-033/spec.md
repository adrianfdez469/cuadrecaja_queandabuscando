---
feature: F-033
agente: sdd-spec
actualizado: 2026-09-02T04:41:00Z
estado: listo
---

## Problema

El único endpoint de lectura de pedidos filtra `id > since`
(`src/features/orders/server/pull.ts:138`), así que un pedido que el POS ya
pulleó no vuelve a salir nunca. Pero la resolución de una propuesta ocurre
**siempre** sobre un pedido ya pulleado —el comprador aprueba o rechaza en
`src/app/[slug]/pedido/[code]/respuesta/route.ts:101`, y eso escribe el pedido
sin crear uno nuevo—, de modo que el encargado del POS no se entera nunca de que
el comprador contestó. Con el envío cotizado de F-031 cotizar **es** proponer,
así que ese camino se recorre en cada pedido a domicilio de una tienda en
`QUOTED_PER_ORDER`: no es un caso raro.

El contrato ya presupone la lectura que falta —`docs/sync-contract.md:1179-1185`
manda hacer **dos** lecturas al oír el timbre, el pull incremental y una
relectura de los `AWAITING_CUSTOMER`— y nunca dijo con qué parámetro se hace la
segunda. Este feature le pone el parámetro. El hueco no es del timbre de F-020:
con cron solo, el filtro del cursor es exactamente el mismo.

## Alcance

### Dentro

- Dos formas nuevas de leer el mismo endpoint `GET /api/internal/orders`:
  `?status=<UN estado>` (la pregunta del ciclo normal, el POS no lleva la lista)
  y `?ids=<a>,<b>` (relectura puntual de un conjunto ya conocido).
- Un tercer parámetro, `after=<id>`, que pagina **solo** la lectura por estado,
  con su propio puntero en la respuesta (`nextAfter`). Es keyset sobre el índice
  `(businessId, status, id)` que ya existe (`prisma/schema.prisma:673`).
- El rechazo con `400` de toda combinación ambigua, en vez de elegir en silencio
  cuál gana.
- La versión **8** de `docs/sync-contract.md` (mayor) documentando los tres
  parámetros, sus topes y sus rechazos.
- El modo de verificación en `scripts/pull-orders.mjs` que ejecuta las dos
  lecturas laterales contra el servidor levantado.

### Fuera (explícito)

Tomado del `notes` de F-033 en `.agent/features.json`, más lo que se deriva de
las decisiones ya firmadas:

- **Empujar cualquier cosa hacia cuadrecaja.** Seguimos sin llamar nunca al POS
  (`docs/adr/0002-el-pos-inicia-todas-las-llamadas.md`; el `notes` cita «ADR
  0003», ver § Incongruencias). El grep de
  `scripts/pull-orders.mjs:385` sigue teniendo que salir vacío.
- **El timbre de F-020.** No se toca ni su payload ni cuándo suena. La lectura
  lateral existe igual sin timbre.
- **El pull incremental y sus consumidores.** `?since=`/`?limit=` responden
  exactamente lo que responden hoy, con el mismo cuerpo y los mismos efectos.
  Un consumidor de la v7 no cambia una línea.
- **Paginar por cualquier cosa que no sea `limit` y `after`.** Sin `offset`, sin
  `page`, sin cursor opaco, sin filtro por fecha, sin `?code=`, sin `?storeId=`.
- **Ninguna migración.** El índice ya está; el enum ya está.
- **Ningún estado nuevo, ningún campo nuevo en el payload del pedido.** La
  lectura lateral devuelve el mismo `PulledOrder` que el pull
  (`src/features/orders/server/pull.ts:83-124`), campo por campo.
- **Mover la fila S-001 de `.agent/solicitudes.md` a «Cerradas» y avisar al otro
  equipo.** Es el cierre del feature, no parte de la implementación, y lo hace
  el humano/orquestador. Su documento (`.agents/solicitudes-qab.md`, en el repo
  de cuadrecaja) no se edita desde aquí.

## Actores y precondiciones

- **Quien llama:** el poller de cuadrecaja de UN negocio, con el bearer por
  negocio de F-018. La identidad la resuelve `withInternalAuth`
  (`src/app/api/internal/_lib/guard.ts:28-59`) y llega al handler como
  `caller.businessId`: no hay forma de servir esta ruta sin él.
- **Precondición de auth, sin cambios:** `503 SYNC_NOT_CONFIGURED` si ningún
  negocio tiene token acuñado, `401 UNAUTHORIZED` sin cabecera o con token que
  no resuelve, `403 BUSINESS_INACTIVE` si el negocio está de baja. Estos tres se
  evalúan **antes** de mirar la query, también en las lecturas laterales.
- **Precondición de datos:** el negocio tiene pedidos. Un pedido de otro negocio
  es invisible en las dos formas, igual que en el pull.
- **Quien resuelve una propuesta** es el comprador desde la página del pedido
  (`src/features/orders/server/respond.ts:45-62`), sin sesión y sin pasar por el
  POS.

## Comportamiento esperado

### Lectura lateral por estado

- **E1.** Dado un pedido del negocio A en `AWAITING_CUSTOMER` con `expiresAt` en
  el futuro, y dado que el POS ya avanzó su cursor más allá de ese `id` con un
  pull incremental, cuando llama `GET /api/internal/orders?status=AWAITING_CUSTOMER`,
  entonces responde `200` y `orders` contiene ese pedido, con `id` **menor** que
  el cursor que el POS tiene guardado.
- **E2.** Dado lo mismo, cuando lee lateralmente, entonces la respuesta trae
  **siempre** `nextCursor: null` (SP5, decidido) y un pull incremental posterior
  con el `since` que el POS ya tenía devuelve **exactamente el mismo cuerpo** que
  devolvía antes de la lectura lateral: la lectura lateral no consume, no marca y
  no adelanta nada del pull. Ese `null` no significa «no hay más pedidos»:
  significa «esta respuesta no lleva cursor, conserva el que ya tenías».
- **E3.** Dado un negocio sin ningún pedido en el estado pedido, cuando lee
  `?status=<ese estado>`, entonces responde `200` con la lista vacía,
  `nextCursor: null` (SP5) y `nextAfter: null` (SP7, decidido: el puntero se
  llama así y viaja en las dos respuestas laterales). Nunca `404`.
- **E4.** Dados dos pedidos del negocio en el mismo estado, cuando lee
  `?status=<estado>&limit=1`, entonces responde el de `id` menor y el puntero
  `nextAfter` (SP7, decidido) con ese `id`; cuando repite con
  `?status=<estado>&limit=1&after=<ese id>`,
  entonces responde el segundo; cuando repite una vez más con el `id` del
  segundo, entonces responde `{ "orders": [] }` y `nextAfter: null`. Ninguna de
  las tres llamadas cambia lo que devuelve el pull incremental.
- **E5.** Los resultados salen ordenados por `id` ascendente, siempre, en las
  dos formas laterales.

### Lectura lateral por ids

- **E6.** Dados los pedidos `a` y `b` del negocio llamante, cuando llama
  `?ids=<a>,<b>`, entonces `orders` trae exactamente esos dos y ninguno más, sin
  importar si sus `id` están por debajo o por encima del cursor del POS.
- **E7.** Dado un `id` que pertenece a otro negocio, cuando lo pide con `?ids=`,
  entonces no aparece en la respuesta y el cuerpo es **idéntico** al de pedir un
  `id` que no existe en ninguna parte: mismo `200`, misma lista, sin campo que
  distinga «existe en otro sitio» de «no existe». Es la misma invariante que
  `docs/sync-contract.md:293-297` ya impone al resto de las rutas.
- **E8.** Dado un `?ids=` en el que ningún id es del negocio, entonces `200` con
  `orders: []`.
- **E9.** Un `id` repetido en la lista se sirve **una sola vez**: la respuesta
  nunca trae dos entradas con el mismo `id`.

### Rechazos

- **E10.** Cuando `?status=` trae un valor que no es uno de los nueve del enum
  `OrderStatus` (`prisma/schema.prisma:49-59`) —incluido el vacío, el mismo
  valor en minúsculas y dos estados separados por coma—, entonces responde `400`
  `INVALID_QUERY` y no devuelve ningún pedido.
- **E11.** Cuando `?ids=` no es una lista de enteros decimales —`abc`, `1,,2`,
  `1.5`, `-1`, cadena vacía, un id con espacios—, entonces responde `400`
  `INVALID_QUERY` y no devuelve ningún pedido.
- **E12.** Cuando `?ids=` trae más de **100** elementos, entonces responde `400`
  `INVALID_QUERY`, nunca `200` con la lista recortada.
- **E13.** Cuando la petición trae `since` **y** `status`, o `since` **y**
  `ids`, entonces responde `400` `INVALID_QUERY`. Cuenta la **presencia** del
  parámetro en la URL, no su valor: `?since=0&status=PULLED` también es `400`
  (R6).
- **E14.** Cuando la petición trae `status` **y** `ids` a la vez, o `after` sin
  `status`, o `limit` junto a `ids`, entonces responde `400` `INVALID_QUERY` y no
  devuelve ningún pedido (SP6, decidido: las tres se rechazan, por el mismo
  motivo del criterio 8 — no elegir en silencio cuál gana). En particular
  `limit`+`ids`: servir 1 de los 2 ids pedidos sería exactamente «la lista
  recortada en silencio» que el criterio 7 prohíbe.
- **E15.** Cuando la petición no trae ni `status` ni `ids`, entonces es el pull
  incremental de siempre y se comporta exactamente como en la v7, incluido
  `since` ausente = `0` y `limit` ausente = `100`.

### Efectos sobre el estado

- **E16.** Dado un pedido en `PENDING`, cuando se lee lateralmente por `?status=PENDING`
  o por `?ids=`, entonces **sigue en `PENDING`** y su `pulledAt` sigue nulo: la
  lectura lateral no marca `PULLED` (R7).
- **E17.** Dado un pedido en `AWAITING_CUSTOMER` cuyo `expiresAt` ya pasó,
  cuando se hace cualquier lectura lateral, entonces ese pedido **no** sale como
  `AWAITING_CUSTOMER`: el barrido de vencimiento corre en la misma llamada, igual
  que en el pull (R8).
- **E18.** Dado un pedido en `AWAITING_CUSTOMER` que el comprador aprueba (o
  rechaza) desde la página del pedido, cuando el POS repite
  `?status=AWAITING_CUSTOMER`, entonces ese pedido ya no está, y aparece en
  `?ids=<su id>` con `status` `CONFIRMED` (o `CANCELLED`) — sin que nadie haya
  tocado una columna a mano.

## Reglas de negocio

- **R1 — una lectura lateral no es un avance.** No devuelve cursor y no
  consume nada: `nextCursor` es **siempre** `null` en toda respuesta lateral, sin
  excepción y sin mirar cuántos resultados salieron, y el POS conserva el cursor
  que ya tenía (SP5, decidido). Es la única semántica satisfacible por un
  endpoint sin estado, y es la que hace verdadero el criterio 2 en el escenario
  del criterio 1, donde el último pull incremental dejó al POS al día y por tanto
  también devolvió `null`. Lo que de verdad afirma ese criterio —«no mueve el
  cursor»— se prueba con el aserto fuerte: repetir el pull con el `since`
  guardado devuelve el mismo cuerpo que antes de la lectura lateral.
- **R2 — el mismo payload.** Un pedido servido lateralmente es byte a byte el
  mismo objeto `PulledOrder` que sirve el pull, con los mismos importes de dos
  decimales, el mismo `deliveryFeePending` y el mismo `proposal` presente solo en
  `AWAITING_CUSTOMER`. El POS reutiliza su parser sin ramificar por endpoint.
- **R3 — aislamiento por negocio.** El `businessId` del `caller` entra en el
  `WHERE` de las dos formas. Nunca se lee del cuerpo ni de la query.
- **R4 — indistinguibilidad.** Un id de otro negocio y un id inexistente
  producen el mismo cuerpo. No hay `404` en la lectura por ids ni lista de
  «no encontrados».
- **R5 — un solo estado por petición** (SP1, decidido). Una coma en `?status=`
  es `400`. Ampliar a lista después es aditivo justamente porque hoy es `400`.
- **R6 — la exclusión de `since` se detecta por presencia.** `since` tiene
  `default(0n)` en el schema de la ruta (`src/app/api/internal/orders/route.ts:10`),
  así que después de parsear no se distingue de ausente: la comprobación mira
  `searchParams.has("since")` antes de validar. Si se implementa mirando el valor
  parseado, el criterio 8 queda verde y la regla, muerta.
- **R7 — la lectura lateral NO marca `PENDING → PULLED`.** El `updateMany` de
  `src/features/orders/server/pull.ts:289-295` es del pull y solo del pull.
  Motivos, en orden de peso: (a) esa marca significa «el POS ya lo recibió por su
  canal de entrega», y una relectura no es una entrega; (b) marcar haría la
  lectura no idempotente —`?status=PENDING` devolvería el pedido la primera vez y
  nada la segunda—, lo que rompe la propia utilidad de una relectura y convierte
  el criterio 5 en algo que depende de cuántas veces se llamó; (c) `?ids=` de un
  pedido `PENDING` se «consumiría» sin que nadie lo pullara, dejando al POS con
  un pedido que su cursor todavía no alcanzó y que el panel ya muestra como
  visto. Consecuencia para el contrato: la frase «Un pedido devuelto pasa de
  `PENDING` a `PULLED`» (`docs/sync-contract.md:770`) hoy está escrita sin sujeto
  y la v8 tiene que acotarla al pull incremental.
- **R8 — la lectura lateral SÍ corre los dos barridos de vencimiento**,
  `expireProposalsQuery` y `expireUnquotedDeliveryOrdersQuery`, en la MISMA
  `$transaction([...])` en forma de array que ya usa el pull
  (`src/features/orders/server/pull.ts:134-136`), y antes del `findMany`.
  Motivos: (a) el vencimiento lo causa **el reloj**, no la lectura — a diferencia
  de `PULLED`, que lo causa la entrega—, así que arrastrarlo no le atribuye a la
  relectura ningún efecto propio; (b) sin barrido, `?status=AWAITING_CUSTOMER`
  —que es literalmente la lectura que el contrato manda hacer al oír el timbre—
  devolvería propuestas ya caducadas con un `proposal.expiresAt` en el pasado, y
  el encargado vería como viva una propuesta que la base cancelará en el
  siguiente pull: es exactamente el fallo que el comentario DA5 de
  `src/features/orders/server/pull.ts:34-40` dice que existe para evitar; (c) los
  dos barridos son idempotentes por construcción y están acotados por
  `businessId` (`src/features/orders/server/expiry.ts:25-39` y `:78-95`), así que
  ejecutarlos en una lectura frecuente no acumula efecto ni cuesta un
  round-trip extra; (d) el criterio 10 se sostiene por sí solo con
  aprobar/rechazar, pero el tercer desenlace de una propuesta —vencer— solo
  existe si alguien corre el barrido, y el `EXPIRY` es el único de los tres que
  no tiene actor humano. **Contrapartida asumida y documentada:** una lectura
  lateral escribe (cancela lo vencido), y de ahí sale R15.
- **R9 — el tope de `?ids=` es 100** (SP2, decidido). Motivo técnico: 500 ids de
  ~7 cifras son ~3.500 caracteres de URL, por encima del límite seguro de
  proxies (~2.000); con 100 se queda en ~700. El tope es un constante de
  `src/constants/`, no un número suelto (AGENTS.md § Prohibiciones).
- **R10 — `after` es un parámetro propio** (SP3, decidido), no un alias de
  `since`. Keyset: `id > after` combinado con `businessId` y `status` sobre
  `(businessId, status, id)`. Solo tiene sentido con `status` (E14).
- **R11 — el puntero lateral sigue la misma convención que `nextCursor`:** solo
  se emite no nulo cuando la página salió **llena** (`rows.length === limit`),
  porque una página a medias ya prueba que no queda nada detrás
  (`src/features/orders/server/pull.ts:297-305`). `null` significa «no hay más».
- **R12 — el `limit` de la lectura por estado es el mismo rango que el del
  pull:** entero, 1..500, default 100. No se inventa un rango nuevo.
- **R13 — nada de esto llama al POS.** ADR 0002. La lectura lateral es una
  respuesta a una petición del POS, como todo lo demás en `/api/internal/`.
- **R14 — instrumentación con `console.warn` y prefijo `[scope]`**, nunca
  `console.error`, si el implementador añade algún log
  (AGENTS.md § «Cosas que muerden»; ficha
  `.agent/playbook/console-error-dispara-guardian-servidor.md`).
- **R15 — la lectura lateral NO cuenta para «un solo pull en vuelo por negocio»**
  (SP4, decidido). Cuadrecaja puede lanzarla **en paralelo** con su pull
  incremental y con otra lateral. El motivo por el que existe la regla original
  —`findMany` y `updateMany` no son atómicos entre sí, así que dos pollers
  entregan el mismo pedido dos veces (`docs/sync-contract.md:772-779`)— no aplica
  a una lectura que no marca nada (R7): sin `updateMany` no hay entrega que
  duplicar ni que perder. **Con la aclaración que va escrita en el contrato:**
  dos lecturas laterales simultáneas **pueden ver estados distintos del mismo
  pedido**, porque cada una corre los barridos de vencimiento (R8) y el pedido
  cuyo reloj expira justo entre las dos sale `AWAITING_CUSTOMER` en una y
  `CANCELLED` en la otra. No es una carrera que haya que evitar: es el reloj, y
  la respuesta más reciente es siempre la buena.

## Casos límite y errores

Todos los rechazos usan el vocabulario que la ruta ya emite:
`400 { "error": "INVALID_QUERY", "issues": [{ "path": [...], "message": "..." }] }`
(`src/app/api/internal/orders/route.ts:22-27`, con `serializableIssues` — ningún
issue puede llevar un `BigInt`, que es la regresión que fija
`src/app/api/internal/orders/route.test.ts:78-92`).

| Petición                                            | Respuesta                                                     |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `?status=AWAITING_CUSTOMER` sin pedidos así         | `200 { "orders": [], "nextCursor": null, "nextAfter": null }` |
| `?status=NOPE`, `?status=`, `?status=pulled`        | `400 INVALID_QUERY`, `path: ["status"]`                       |
| `?status=PULLED,CONFIRMED`                          | `400 INVALID_QUERY` (R5)                                      |
| `?ids=` vacío, `?ids=abc`, `?ids=1,,2`, `?ids=-1`   | `400 INVALID_QUERY`, `path: ["ids"]`                          |
| `?ids=` con 101 elementos                           | `400 INVALID_QUERY`, mensaje `IDS_LIMIT_EXCEEDED` (tope 100)  |
| `?ids=<a>,<a>` (duplicado)                          | `200`, una sola entrada (E9)                                  |
| `?ids=<id de otro negocio>`                         | `200 { "orders": [] }`, idéntico a un id inexistente (R4)     |
| `?since=5&status=PULLED` / `?since=0&status=PULLED` | `400 INVALID_QUERY`, mensaje `SINCE_WITH_LATERAL_READ` (R6)   |
| `?since=5&ids=1,2`                                  | `400 INVALID_QUERY`, mismo mensaje                            |
| `?status=PULLED&ids=1,2`                            | `400 INVALID_QUERY`, mensaje `STATUS_WITH_IDS` (E14)          |
| `?after=7` sin `status`                             | `400 INVALID_QUERY`, mensaje `AFTER_WITHOUT_STATUS` (E14)     |
| `?ids=1,2&limit=1`                                  | `400 INVALID_QUERY`, mensaje `LIMIT_WITH_IDS` (E14)           |
| `?status=PULLED&after=-1` / `after=x`               | `400 INVALID_QUERY`, `path: ["after"]`                        |
| `?status=PULLED&limit=0` / `limit=501`              | `400 INVALID_QUERY`, igual que hoy en el pull                 |
| Cualquiera de las anteriores sin bearer             | `401 UNAUTHORIZED` — la auth se evalúa antes que la query     |
| Cualquiera con negocio de baja                      | `403 BUSINESS_INACTIVE`                                       |

Concurrencia y reintentos:

- Dos lecturas laterales simultáneas del mismo negocio devuelven lo mismo y no
  se pisan: no hay escritura dependiente de la lectura (R7). Lo único que
  escriben son los barridos, idempotentes (R8).
- Una lectura lateral concurrente con un pull incremental **no** duplica ni se
  come pedidos, porque no toca la marca `PULLED`, y por eso se puede lanzar en
  paralelo con él (R15). Lo que sí puede pasar es que el barrido de la lateral
  cancele un pedido que el pull en vuelo ya había leído; es el mismo entrelazado
  que hoy existe entre el cron de vencimiento y el pull, y no es nuevo.
- Dos lecturas laterales simultáneas pueden devolver estados distintos del mismo
  pedido si su vencimiento cae entre las dos (R15). Va escrito en el contrato.
- Reintentar una lectura lateral tal cual es seguro por definición: misma URL,
  mismo cuerpo (salvo lo que el reloj haya vencido entretanto).

## Datos y contrato

### Los tres parámetros

| Parámetro | Tipo en el cable                              | Rango                          | Default     | Con qué convive               |
| --------- | --------------------------------------------- | ------------------------------ | ----------- | ----------------------------- |
| `since`   | entero decimal (`BIGINT`)                     | ≥ 0                            | `0`         | `limit`. Nunca `status`/`ids` |
| `limit`   | entero                                        | 1..500                         | `100`       | `since`, `status`, `after`    |
| `status`  | uno de los 9 valores de `OrderStatus`, exacto | —                              | sin default | `limit`, `after`              |
| `ids`     | enteros decimales separados por `,`           | 1..100 elementos, cada uno ≥ 1 | sin default | nada más                      |
| `after`   | entero decimal (`BIGINT`)                     | ≥ 0                            | `0`         | solo con `status`             |

Los nueve estados válidos son los de `prisma/schema.prisma:49-59`: `PENDING`,
`PULLED`, `AWAITING_CUSTOMER`, `CONFIRMED`, `READY`, `IN_TRANSIT`, `DELIVERED`,
`CANCELLED`, `REJECTED_BY_STORE`. Comparación exacta y sensible a mayúsculas.

### Las respuestas

```
GET /api/internal/orders?since=&limit=              → { orders, nextCursor }            (sin cambios)
GET /api/internal/orders?status=&limit=&after=      → { orders, nextCursor: null, nextAfter }
GET /api/internal/orders?ids=a,b                    → { orders, nextCursor: null, nextAfter: null }
```

`nextAfter` —el nombre está decidido, SP7— es una cadena con el `id` del último
pedido de una página llena, o `null` (R11). Aparece en las **dos** respuestas
laterales, con `null` fijo en la de `?ids=`, que no pagina, y **nunca** en el
pull incremental: este sigue devolviendo dos claves y nada más, para que un
consumidor de la v7 no vea un campo que no espera (criterio 13). `nextCursor`
viaja en las tres respuestas y es `null` fijo en las dos laterales (R1).

### Qué tiene que decir la v8 de `docs/sync-contract.md`

La escribe el implementador; esta spec solo fija el contenido. Sube a **8**,
mayor, porque «cambia lo que el POS envía o recibe [...] sea aditivo o no»
(`docs/sync-contract.md:22-24`).

1. Primera línea: `**Versión 8**` con su fecha, y una sección «Cambios respecto
   a la v7» que diga, en una frase, que un POS en v7 sigue siendo un lector
   correcto sin tocar nada.
2. La fila de `GET /api/internal/orders` de la tabla de § Endpoints
   (`docs/sync-contract.md:325`) con los tres parámetros nuevos y las dos formas
   de respuesta.
3. En § ③④ Pedidos: qué es una lectura lateral, que **ignora el cursor**, que
   **no mueve `nextCursor`** (siempre `null`), el tope de 100 de `?ids=`, el
   `400` de mezclar con `since`, la paginación por `after`/`nextAfter`, y que un
   id de otro negocio responde igual que uno inexistente.
4. Acotar al pull incremental la frase «Un pedido devuelto pasa de `PENDING` a
   `PULLED`» (`docs/sync-contract.md:770`) — R7.
5. Decir que la lectura lateral **sí** aplica los dos vencimientos, así que
   nunca entrega una propuesta caducada (R8).
6. Filas nuevas en § Vocabulario de errores para `400 INVALID_QUERY`, que hoy la
   ruta emite y el contrato **no documenta** (ver § Incongruencias), con los
   cuatro mensajes de combinación prohibida. Precedente de mensaje legible por
   máquina dentro de `issues[].message`: la fila
   `STORE_DELIVERY_CONFIG_INCONSISTENT` de la v7.
7. Enlazar la relectura de `docs/sync-contract.md:1179-1185` («el lector hace
   DOS lecturas») al parámetro concreto, que es lo que hoy falta.
8. Junto a la regla de un solo pull en vuelo
   (`docs/sync-contract.md:1186-1194`): que la lectura lateral **no** cuenta para
   esa regla —se puede lanzar en paralelo con el pull y con otra lateral, porque
   no marca `PULLED` y por tanto no hay entrega que duplicar—, y la aclaración de
   que dos laterales simultáneas pueden ver estados distintos del mismo pedido
   cuando su vencimiento cae entre las dos, sin que eso sea un fallo (R15). Más
   una fila en la tabla de riesgos.

## Criterios de aceptación propuestos

Los 14 son los de `.agent/features.json`, **literales**, marcados `[ya]`. Nada
se verifica leyendo código. `TOKEN` es el bearer del negocio sembrado
(`npm run mint:token -- seed-negocio-1`), `BASE` es `http://localhost:3000`.

1. `[ya]` «GET /api/internal/orders?status=AWAITING_CUSTOMER devuelve un pedido
   cuyo id es MENOR que el ultimo cursor entregado, verificado creando el pedido,
   avanzando el cursor mas alla de su id con un pull incremental y volviendo a
   leer.»
   **Cómo:** `node scripts/pull-orders.mjs --lateral` (modo nuevo) hace, contra
   el servidor levantado: `node scripts/place-order.mjs` o el POST público para
   crear el pedido → `GET ?since=<max previo>&limit=100` (el pedido sale, queda
   `PULLED`) → `POST /api/internal/orders/proposal` (el pedido pasa a
   `AWAITING_CUSTOMER` con `expiresAt` futuro) → `GET ?since=<id del pedido>`
   → `{ "orders": [] }` → `GET ?status=AWAITING_CUSTOMER`.
   **Se espera:** `200`, `orders[].id === <id>` y `BigInt(id) < BigInt(cursor)`
   comprobado por el propio guion. Además un test de integración de la ruta y un
   `*.db.test.ts` con `createFixtureSession` que afirme lo mismo contra Postgres.
2. `[ya]` «Esa lectura no mueve el cursor: el nextCursor que devuelve es
   identico al del ultimo pull incremental, comprobado en la misma sesion y sin
   reiniciar el servidor.»
   **Cómo:** en la misma corrida del guion, sin reiniciar: guardar el
   `nextCursor` del pull del paso anterior (`null`, porque quedó al día), leer
   lateralmente y comparar; después repetir el pull con el mismo `since` y
   comparar el cuerpo completo con el de antes de la lectura lateral.
   **Se espera:** los dos `nextCursor` iguales (`null === null`) y los dos
   cuerpos del pull idénticos. La lectura del criterio está decidida (SP5): la
   lateral devuelve **siempre** `nextCursor: null`, y la igualdad se comprueba en
   este escenario —el del criterio 1—, donde el último pull incremental también
   devolvió `null` por haber quedado al día. El aserto que no depende del
   escenario, y que hay que escribir sí o sí, es el de los dos cuerpos del pull
   idénticos.
3. `[ya]` «GET /api/internal/orders?ids=<a>,<b> devuelve exactamente esos dos
   pedidos del negocio llamante y ningun otro, sin importar donde queden respecto
   del cursor.»
   **Cómo:** `curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/internal/orders?ids=$A,$B" | jq '[.orders[].id]'`
   con `A` por debajo del cursor y `B` por encima, más un tercer pedido no
   pedido.
   **Se espera:** `["<A>","<B>"]` exactamente, en orden ascendente, y
   `nextCursor: null`.
4. `[ya]` «Un id de otro negocio pedido con ?ids= no aparece en la respuesta, y
   esa respuesta es indistinguible de la de un id inexistente, verificado con dos
   negocios sembrados.»
   **Cómo:** `*.db.test.ts` con dos `createFixtureSession()` (dos negocios, dos
   tokens): pedir con el token de A el id de un pedido de B, y pedir un id
   inexistente (`999999999`), y comparar los dos cuerpos con
   `expect(bodyOtro).toEqual(bodyInexistente)`.
   **Se espera:** los dos `200 { "orders": [], "nextCursor": null, "nextAfter": null }`,
   iguales campo por campo.
5. `[ya]` «Una lectura por estado sin ningun pedido en ese estado responde 200
   con lista vacia, nunca 404.»
   **Cómo:** `curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" "$BASE/api/internal/orders?status=REJECTED_BY_STORE"`
   sobre un negocio sin ninguno, y el cuerpo con `jq`.
   **Se espera:** `200` y `{"orders":[],"nextCursor":null,"nextAfter":null}`.
6. `[ya]` «?status= con un valor fuera del enum de estados responde 400, y ?ids=
   con algo que no es una lista de enteros responde 400; en los dos casos no se
   devuelve ningun pedido.»
   **Cómo:** test de la ruta con `pullOrders` mockeado, en bucle sobre
   `?status=NOPE`, `?status=`, `?status=pulled`, `?status=PULLED,CONFIRMED`,
   `?ids=abc`, `?ids=`, `?ids=1,,2`, `?ids=1.5`, `?ids=-1`.
   **Se espera:** `400` en los nueve, `body.error === "INVALID_QUERY"`, ningún
   `orders` en el cuerpo, la función de lectura **no llamada**, y cada issue con
   exactamente las claves `["message","path"]` (el aserto que ya impone
   `src/app/api/internal/orders/route.test.ts:95-107`).
7. `[ya]` «?ids= con mas ids que el tope documentado responde 400, en vez de
   servir la lista recortada en silencio.»
   **Cómo:** `curl` con 101 ids generados (`seq 1 101 | paste -sd, -`) y con 100.
   **Se espera:** `400 INVALID_QUERY` con 101 (mensaje `IDS_LIMIT_EXCEEDED`) y
   `200` con 100.
8. `[ya]` «Mezclar since con status o con ids responde 400: una lectura lateral
   y un avance de cursor no se sirven en la misma peticion.»
   **Cómo:** test de la ruta sobre `?since=5&status=PULLED`,
   `?since=0&status=PULLED`, `?since=5&ids=1,2`, `?since=0&ids=1,2`.
   **Se espera:** `400 INVALID_QUERY` en los cuatro y la función de lectura no
   llamada. Los dos casos con `since=0` son los que prueban R6: son los que un
   implementador que mire el valor parseado deja pasar.
9. `[ya]` «Una lectura por estado con mas resultados que limit permite llegar al
   resto sin mover el cursor del pull incremental, verificado con limit=1 y dos
   pedidos en ese estado.»
   **Cómo:** `*.db.test.ts` con dos pedidos del negocio en `PULLED`: `?status=PULLED&limit=1`,
   luego `?status=PULLED&limit=1&after=<nextAfter>`, luego una tercera con el
   `nextAfter` de la segunda; antes y después, un `?since=<cursor>&limit=100`
   cuyo cuerpo tiene que ser el mismo.
   **Se espera:** primera página `[id1]` con `nextAfter: "<id1>"`, segunda
   `[id2]` con `nextAfter: "<id2>"`, tercera `[]` con `nextAfter: null`, y los
   dos pulls incrementales idénticos entre sí.
10. `[ya]` «Un pedido que estaba en AWAITING_CUSTOMER y se resuelve de verdad,
    aprobandolo o rechazandolo desde la pagina del pedido, desaparece de la
    lectura ?status=AWAITING_CUSTOMER siguiente, sin tocar ninguna columna a
    mano.»
    **Cómo:** con el servidor levantado, reusar el camino real de F-019:
    `POST $BASE/api/internal/orders/proposal` para proponer y
    `POST $BASE/<slug>/pedido/<code>/respuesta` con `decision=aprobar`
    —exactamente lo que hace `scripts/renegotiate-order.mjs:221` con
    `--approve`/`--reject`—, y entre medias
    `GET ?status=AWAITING_CUSTOMER`.
    **Se espera:** antes de responder, el pedido está en la lectura lateral;
    después, `orders` no contiene su `id`, y `?ids=<id>` lo devuelve con
    `status: "CONFIRMED"` (o `"CANCELLED"` con `--reject`). Ningún `UPDATE`
    manual en el guion: la única escritura la hace la ruta de respuesta.
11. `[ya]` «EXPLAIN de la consulta por estado usa el indice (businessId, status,
    id) que ya existe, y este feature no anade ninguna migracion.»
    **Cómo:** (a) un `describe` en `src/features/orders/server/pull.db.test.ts`
    con la misma receta que el que ya está en `:98-140` —~500 filas de relleno de
    otro tenant, `VACUUM ANALYZE "Order"` (ficha
    `.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`, que pide
    `VACUUM` y no solo `ANALYZE`), `SET enable_seqscan = off`— sobre
    `EXPLAIN SELECT "id" FROM "Order" WHERE "businessId" = $1 AND status = $2 AND "id" > $3 ORDER BY "id" ASC LIMIT 100`;
    (b) `git status --porcelain prisma/migrations` y
    `ls prisma/migrations | wc -l` antes y después del feature.
    **Se espera:** (a) el plan contiene `Order_businessId_status_id_idx` y no
    contiene `Seq Scan`; (b) ninguna migración nueva y `npx prisma validate` en
    verde. Limitación conocida y heredada del test que ya existe: el `EXPLAIN` se
    hace sobre un SQL escrito a mano que **imita** el `findMany`, no sobre el que
    Prisma emite.
12. `[ya]` «node scripts/pull-orders.mjs hace las dos lecturas laterales contra
    el servidor levantado y su salida las distingue del pull incremental.»
    **Cómo:** `npm run dev` en un solo directorio (ficha
    `.agent/playbook/next-dev-uno-por-directorio.md`) y
    `node scripts/pull-orders.mjs --lateral`, más una corrida sin flags.
    **Se espera:** salida con un encabezado propio del estilo que el guion ya usa
    (`scripts/pull-orders.mjs:174`), del tipo
    `== Criterio 12 · lectura lateral (?status= y ?ids=) — no mueve el cursor ==`,
    con líneas `ok` de `check()` (`scripts/pull-orders.mjs:69-76`) separadas de
    las del `== Criterio 1 · ... cursor ==`; `0 aserciones fallidas` y código de
    salida 0. Que las distinga se comprueba ejecutando:
    `node scripts/pull-orders.mjs --lateral | grep -c '^== '` ≥ 1 y
    `node scripts/pull-orders.mjs | grep '^== '` mostrando las secciones del
    pull incremental **y** la lateral como bloques distintos.
13. `[ya]` «docs/sync-contract.md sube de version y documenta los dos
    parametros: que ignoran el cursor, que no mueven nextCursor, el tope de ?ids=
    y el 400 de mezclarlos con since. El cambio es aditivo: un consumidor de la
    version anterior sigue leyendo el pull sin cambiar nada.»
    **Cómo:** `sed -n '3p' docs/sync-contract.md` y
    `grep -n 'status=\|ids=\|after=\|nextAfter\|IDS_LIMIT_EXCEEDED' docs/sync-contract.md`;
    la parte «aditivo» se verifica **ejecutando el lector de la v7**: los tests
    de `src/features/orders/server/pull.test.ts` y
    `src/app/api/internal/orders/route.test.ts` que existen hoy pasan **sin
    editarlos**, y `node scripts/pull-orders.mjs --paginate` sigue en verde.
    **Se espera:** línea 3 con `**Versión 8**`, las cuatro cosas documentadas,
    una sección «Cambios respecto a la v7», el hook
    `.claude/hooks/sync-contract-version.sh` sin avisar, y los tests viejos
    verdes tal cual. Nota: «aditivo» describe la compatibilidad del consumidor,
    no la clase de versión — la clase es **mayor** por decisión firmada y por
    `docs/sync-contract.md:22-24`.
14. `[ya]` «'bash .agent/verify.sh F-033 --full' termina con codigo 0.»
    **Cómo:** `bash .agent/verify.sh F-033 --full; echo $?`.
    **Se espera:** `0`. Cubre las nueve etapas de `STAGES_COMPLETO`
    (`.agent/verify.sh:62`): harness, typecheck, lint, format, test, prisma,
    build, theme y bundle. No incluye `smoke`: lo del criterio 12 es un comando
    aparte contra el servidor levantado, como en F-019.

## Incongruencias detectadas

1. **`400 INVALID_QUERY` no está en el vocabulario de errores del contrato.** La
   ruta lo devuelve desde F-007 (`src/app/api/internal/orders/route.ts:24`) y la
   tabla de `docs/sync-contract.md:334-357` no lo lista, aunque dice ser válida
   «para las siete rutas de arriba». La v8 tiene que añadir la fila: si no, el
   feature documenta cuatro mensajes nuevos colgando de un código que el contrato
   no reconoce.
2. **El `notes` de F-033 cita «ADR 0003» para «nunca llamamos al POS».** La ADR
   que dice eso es la 0002
   (`docs/adr/0002-el-pos-inicia-todas-las-llamadas.md`); la 0003 es
   `docs/adr/0003-disponibilidad-por-query-convergente.md`. El propio guion lo
   tiene bien: `scripts/pull-orders.mjs:382-383` habla de la ADR 0002.
   **Confirmada por el humano** el 2026-09-02. No se toca `features.json`
   (regla 4); queda anotado aquí.
3. **El `notes` pone FUERA «paginar por otra cosa que no sea limit», y la
   decisión SP3 añade `after`.** La decisión del humano es posterior y manda; el
   `notes` queda desactualizado a propósito (regla 3/4: no se edita). Esta spec
   escribe el alcance con `limit` **y** `after`.
4. **El criterio 13 llama «aditivo» al cambio y la versión sube como mayor.** No
   se contradicen —la regla del contrato manda mayor «sea aditivo o no»
   (`docs/sync-contract.md:22-24`)— pero la palabra invita a publicar una menor.
   Queda escrito: v8, mayor, y «aditivo» se refiere solo a que un consumidor de
   la v7 no cambia nada.
5. **El criterio 2 exige una igualdad que el endpoint no puede evaluar.** El
   endpoint es sin estado: no recuerda ningún `nextCursor` anterior, así que el
   criterio solo es satisfacible bajo una lectura concreta. Se preguntó en vez de
   reinterpretarlo en silencio y **el humano la fijó** (SP5): la lateral devuelve
   siempre `null`, y la igualdad se comprueba en el escenario del criterio 1.
   Vive en R1.
6. **La frase del contrato «Un pedido devuelto pasa de `PENDING` a `PULLED`»
   (`docs/sync-contract.md:770`) no tiene sujeto** y con este feature deja de ser
   cierta para toda respuesta del endpoint. R7 la acota; la v8 tiene que
   escribirlo.
7. **`console.error` en la ruta y en el guard contradice AGENTS.md.**
   `src/app/api/internal/orders/route.ts:31` y
   `src/app/api/internal/_lib/guard.ts:36`, `:48` usan `console.error`, que es
   justo lo que la sección «Cosas que muerden» prohíbe por el guardián de
   servidor. Es preexistente y **no** se arregla en este feature (no está en
   ningún criterio), pero cualquier log nuevo que añada el implementador va con
   `console.warn` y prefijo (R14).

## Huecos y preguntas al humano

Las cuatro se preguntaron y **las cuatro están contestadas** (2026-09-02, tanda
2, todas por la recomendación de esta spec). No se borran: son la memoria de por
qué el cable es así. SP1–SP3 venían resueltas de la tanda 1 y viven en R5, R9 y
R10.

- **SP4 — ¿la lectura lateral cuenta para la regla de «un solo pull en vuelo por
  negocio»?** (Venía abierta del `notes` de `.agent/features.json`.)
  _Decidido:_ **no cuenta**, opción (a) con la aclaración de (c). Cuadrecaja
  puede lanzarla en paralelo con su pull, y se documenta explícitamente que dos
  laterales simultáneas pueden ver estados distintos por el barrido de
  vencimiento.
  _Por qué:_ el motivo de la regla original —`findMany` y `updateMany` no son
  atómicos entre sí, así que dos pollers entregan el mismo pedido dos veces
  (`docs/sync-contract.md:772-779`)— no aplica a una lectura que no marca nada
  (R7). La única escritura que arrastra es idempotente (R8). Lo que sí había que
  decir en voz alta, y por eso va al contrato, es que el reloj puede correr entre
  dos laterales: eso no es una carrera, y la respuesta más reciente manda.
  _Dónde vive:_ R15, § Casos límite § Concurrencia, y el punto 8 de «Qué tiene
  que decir la v8».

- **SP5 — ¿cuál es la lectura del criterio 2 que hay que hacer verdadera?** El
  endpoint no recuerda ningún cursor, así que «idéntico al del último pull
  incremental» no es evaluable tal cual.
  _Decidido:_ opción (a). La lectura lateral devuelve **siempre**
  `nextCursor: null`, y el criterio 2 se verifica en el escenario del criterio 1
  —donde el último pull dejó al POS al día y por tanto también devolvió `null`—,
  más el aserto fuerte de que repetir el pull con el `since` guardado devuelve el
  mismo cuerpo.
  _Por qué:_ omitir la clave (b) rompería R2 y obligaría al POS a ramificar el
  parser; devolver `MAX(id)` (c) sería un cursor falso que el POS guardaría y con
  el que se saltaría pedidos. Con (a) la frase del criterio se cumple
  literalmente en el escenario que el propio criterio 1 describe, y lo que de
  verdad se quiere probar —«no mueve el cursor»— queda verificado por la igualdad
  de los dos pulls, que no depende del escenario.
  _Dónde vive:_ R1, E2, E3, y la verificación del criterio 2.

- **SP6 — ¿se rechazan con 400 las otras tres combinaciones ambiguas?** El
  criterio 8 solo nombra `since` + `status`/`ids`.
  _Decidido:_ opción (a). `400 INVALID_QUERY` también para `status`+`ids`,
  `after` sin `status` y `limit`+`ids`.
  _Por qué:_ el mismo motivo del criterio 8 —no elegir en silencio cuál gana— y,
  en `limit`+`ids`, el del criterio 7: servir 1 de los 2 ids pedidos es
  literalmente «la lista recortada en silencio». Documentar una precedencia (b)
  deja al POS creyendo que pidió una cosa y recibió otra.
  _Dónde vive:_ E14 y la tabla de § Casos límite y errores, con el mensaje de
  cada rechazo.

- **SP7 — ¿el puntero de la paginación lateral se llama `nextAfter`?** SP3 lo
  dejó como «nombre a fijar».
  _Decidido:_ opción (a). Se llama **`nextAfter`**, viaja en las dos respuestas
  laterales —`null` fijo en la de `?ids=`, que no pagina— y **no** aparece en el
  pull incremental.
  _Por qué:_ simetría de nombre con `after`, misma convención de `null` que
  `nextCursor` (R11), una sola forma de respuesta para las dos lecturas laterales
  y el pull intacto, que es lo que el criterio 13 exige.
  _Dónde vive:_ § Datos y contrato § Las respuestas, E3 y E4.

## No decidido a propósito

- **Los nueve estados son legibles**, incluidos los terminales
  (`DELIVERED`, `CANCELLED`): es la lectura literal del criterio 6, y una
  restricción a lista blanca lo contradiría. El coste de que `?status=DELIVERED`
  paginada sea, de hecho, un export del histórico del propio negocio se acota con
  `limit ≤ 500` y con que el token solo ve sus pedidos. Si algún día molesta, es
  un feature nuevo del humano, no un recorte de aquí.
- **El mensaje exacto de cada issue de validación** (`IDS_LIMIT_EXCEEDED`,
  `SINCE_WITH_LATERAL_READ`, `STATUS_WITH_IDS`, `AFTER_WITHOUT_STATUS`,
  `LIMIT_WITH_IDS`): la forma la fija esta spec (constante legible por máquina
  dentro de `issues[].message`, precedente de la v7); el literal lo cierra
  sdd-architect con el nombre de la constante de `src/constants/`.
- **Dónde vive la consulta lateral** —función nueva junto a `pullOrders` o
  parámetros nuevos en ella— es decisión de arquitectura. Lo que esta spec exige
  es que el mapeo a `PulledOrder` sea el mismo código, no una copia (R2), y que
  el `updateMany` de `PULLED` quede fuera de su camino (R7).
- **Si el barrido de vencimiento debería salir del pull a un solo sitio
  compartido** por las dos lecturas: es refactor, y lo decide sdd-architect
  mientras se cumpla R8.
