---
feature: F-019
agente: sdd-spec
actualizado: 2026-08-30T14:29:52Z
estado: listo
---

## Problema

Hoy un pedido solo puede avanzar o morir: no existe ningún estado para «la
tienda propone un cambio y espera al comprador», ni reloj que lo venza. El
disparador más frecuente no es la falta de stock: es el **costo de envío, que se
fija al gestionar el pedido** y por diseño ocurre en todos los pedidos de esa
modalidad. Como el comprador es invitado, pudo cerrar la pestaña y no hay canal
de push, el encargado se queda con medio pedido colgado indefinidamente.

Falta además la mitad visible del transporte: `OrderStatus` salta de `READY` a
`DELIVERED` (`prisma/schema.prisma:41`), así que un pedido que va en camino se
le muestra al comprador como «listo para recoger».

## Alcance

### Dentro

- Tres valores nuevos en `OrderStatus`: `AWAITING_CUSTOMER`, `REJECTED_BY_STORE`
  e `IN_TRANSIT`.
- La propuesta de modificación: qué importes propone la tienda, contra qué
  importes vigentes, con qué mensaje y hasta cuándo.
- Respuesta del comprador —aprobar o rechazar— desde la página de su pedido.
- Vencimiento por reloj absoluto con un cron, y el desenlace fijo al vencer.
- Atribución del desenlace: quién canceló (comprador, vencimiento o tienda).
- Enlace `wa.me` **hacia el comprador**, devuelto al proponer, que abre el
  encargado con un clic.
- Flujo `READY → IN_TRANSIT → DELIVERED` con su copia en la página del pedido.
- Reporte de todos estos estados hacia cuadrecaja por el pull y por
  `POST /api/internal/orders/status`, y la versión nueva del contrato que lo
  documenta.

### Fuera (explícito)

- **Reserva de stock.** Dos compradores pueden pedir la última unidad; lo
  resuelve la confirmación manual. Reservar exigiría escribir en el camino de
  venta del POS, que es justo lo que evita
  [ADR 0003](../../../docs/adr/0003-disponibilidad-por-query-convergente.md).
- **Proveedor de WhatsApp Business API.** Decisión SP3 del humano: nada de
  mensajería automática, ni credenciales nuevas, ni infraestructura nueva. Solo
  enlaces `wa.me` que abre una persona.
- **`Store.orderExpiryPolicy`.** Decisión SP1: la política al vencer es **fija**.
  No se configura, y no existe «despachar lo disponible».
- **Horarios y zona horaria de la tienda.** Decisión SP2: F-022 sigue en
  `passes: false` y aquí no se inventa el dato. El reloj es absoluto.
- **Pagos en línea.** v1 es contra entrega.
- **Cancelación parcial por línea como mecanismo propio.** Se expresa como una
  propuesta que quita líneas (R21); no hay un segundo camino.
- **Notificar al comprador por email.** No hay canal de correo saliente y este
  feature no lo abre.
- **Panel de administración de pedidos en queandabuscando.** No existe hoy
  (`src/app/admin/` no tiene ruta de pedidos) y este feature no lo crea: quien
  propone es el encargado desde cuadrecaja, por el API interno.

## Actores y precondiciones

| Actor                        | Dónde está              | Qué hace aquí                                                    |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Encargado / POS (cuadrecaja) | fuera de este repo      | Propone la modificación, rechaza el pedido, reporta `IN_TRANSIT` |
| Comprador                    | `/[slug]/pedido/[code]` | Aprueba o rechaza la propuesta                                   |
| Cron de vencimiento          | este repo               | Cancela las propuestas vencidas sin que intervenga nadie         |

Precondiciones:

1. El pedido existe (F-010) y tiene `contactPhone`, que el checkout ya exige.
2. El POS ya lo tiene: lo pulleó (F-007), así que su estado es `PULLED` o
   posterior.
3. El llamante interno se autentica con el token de **su** negocio (F-018) y el
   pedido pertenece a ese negocio; si no, la respuesta es la misma que para un
   pedido inexistente (`docs/sync-contract.md` § Vocabulario de errores).
4. El comprador conoce el `code`, que es la única credencial de su página
   ([ADR 0016](../../../docs/adr/0016-escritura-publica-sin-sesion.md)).

## Comportamiento esperado

### La propuesta

- **E1** — Dado un pedido en `PULLED` o `CONFIRMED`, cuando la tienda propone una
  modificación con importes nuevos, entonces el pedido pasa a
  `AWAITING_CUSTOMER`, se guardan los importes anteriores y los propuestos, se
  fija `expiresAt`, y la respuesta incluye un enlace `wa.me` hacia el teléfono
  del comprador con la URL de su pedido.
- **E2** — Dado un pedido en `AWAITING_CUSTOMER`, cuando el comprador abre
  `GET /[slug]/pedido/[code]`, entonces la página muestra el **total anterior**,
  el **total nuevo**, el mensaje de la tienda, el plazo que le queda y dos
  acciones: aprobar y rechazar.
- **E3** — Dado un pedido en `AWAITING_CUSTOMER` cuya propuesta cambia líneas,
  cuando el comprador abre su página, entonces ve la lista de líneas
  **propuesta**, no la vigente, claramente marcada como propuesta.
- **E4** — Dado un pedido que **no** está en `PULLED`, `CONFIRMED` ni
  `AWAITING_CUSTOMER`, cuando la tienda intenta proponer, entonces responde `409`
  con el estado actual y no escribe nada.

### La respuesta del comprador

- **E5** — Dado un pedido en `AWAITING_CUSTOMER` sin vencer, cuando el comprador
  aprueba, entonces el pedido pasa a `CONFIRMED` con los importes y las líneas
  propuestos, `rateSnapshot` **intacto**, y `GET /api/internal/orders` devuelve
  los importes nuevos.
- **E6** — Igual, pero rechazando: el pedido pasa a `CANCELLED` con la
  cancelación atribuida al **comprador** y el motivo guardado en `cancelReason`.
- **E7** — Dado un pedido que ya respondió, cuando llega **la misma** decisión
  otra vez (el comprador insiste, o el navegador reintenta), entonces responde
  `200` sin cambiar nada; con la decisión **contraria**, responde `409` con el
  estado actual.
- **E8** — Dado un pedido que la tienda ya canceló o rechazó, cuando el comprador
  aprueba, entonces responde `409`, el pedido sigue cancelado, y al recargar la
  página lee «Cancelado» sin las dos acciones.
- **E9** — Dado un navegador sin JavaScript, cuando el comprador aprueba o
  rechaza, entonces funciona igual: la página del pedido no exige un módulo de
  cliente para responder.

### El reloj

- **E10** — Dado un pedido en `AWAITING_CUSTOMER` cuyo `expiresAt` ya pasó,
  cuando corre el cron de vencimiento, entonces el pedido pasa a `CANCELLED` con
  la cancelación atribuida al **vencimiento** y el motivo «La propuesta venció
  sin respuesta», sin que intervenga ninguna persona.
- **E11** — Dado un pedido cuyo `expiresAt` ya pasó pero al que el cron todavía
  no llegó, cuando el comprador aprueba, entonces responde `409` y el pedido
  **no** se confirma: el plazo manda aunque el cron vaya tarde.
- **E12** — Dado el mismo pedido, cuando el comprador abre su página, entonces la
  lee como propuesta vencida y sin las dos acciones, aunque la fila siga en
  `AWAITING_CUSTOMER`.
- **E13** — Dado un pedido en `AWAITING_CUSTOMER`, cuando la tienda propone otra
  vez, entonces la segunda propuesta reemplaza a la primera, el reloj vuelve a
  empezar desde ese momento y el «total anterior» sigue siendo el total vigente
  del pedido, no el de la propuesta descartada.
- **E14** — Dado que el comprador aprueba en el mismo instante en que el cron
  vence la propuesta, entonces exactamente uno de los dos gana: el pedido queda
  `CONFIRMED` **o** `CANCELLED`/vencimiento, nunca a medio camino, y el perdedor
  no escribe nada.
- **E15** — Dado un cambio en `Store.orderExpiryHours`, cuando ya hay una
  propuesta viva, entonces su `expiresAt` **no** se mueve: el plazo se congeló al
  proponer.

### El rechazo de la tienda y el pull

- **E16** — Dado un pedido que la tienda no puede atender, cuando lo reporta,
  entonces queda en `REJECTED_BY_STORE`, y en la respuesta del pull se distingue
  de un `CANCELLED`.
- **E17** — Dados tres pedidos terminados de las tres formas posibles —cancelado
  por el comprador, vencido, rechazado por la tienda—, cuando el POS los pullea,
  entonces los tres se distinguen entre sí sin ambigüedad.
- **E18** — Dado un pedido en `AWAITING_CUSTOMER`, cuando el POS lo pullea,
  entonces sale con ese estado y el pull **no** lo pisa (solo `PENDING → PULLED`,
  F-007 R3).
- **E19** — Dado `POST /api/internal/orders/status` con
  `status: "AWAITING_CUSTOMER"`, entonces responde `400`: ese estado solo lo pone
  la acción de proponer, que es la única que fija un `expiresAt`.

### El transporte

- **E20** — Dado un pedido en `READY`, cuando el POS reporta `IN_TRANSIT`,
  entonces la fila queda en `IN_TRANSIT` y la página del pedido lo dice con su
  propia copia, distinta de «listo para recoger».
- **E21** — Dado un pedido en `IN_TRANSIT`, cuando el POS reporta `DELIVERED`,
  entonces queda entregado y la página lo dice.
- **E22** — Dado un pedido de **retiro** (`PICKUP`) que el POS pone en
  `IN_TRANSIT`, entonces la página no rompe ni miente: tiene copia propia para
  ese caso.

### El enlace al crear

- **E23** — Dado un pedido recién creado en una tienda con
  `checkoutMode = WHATSAPP`, entonces tanto la respuesta del checkout como la
  página del pedido ofrecen un enlace `wa.me` cuyo mensaje contiene la URL de
  `/[slug]/pedido/[code]`, y el comprador se queda con ese enlace en su propio
  historial de WhatsApp al enviarlo.
- **E24** — Dado un pedido recién creado en una tienda con
  `checkoutMode = ONSITE`, entonces el comprador no recibe ningún enlace por
  WhatsApp hoy (I3): el hueco se cubre entregándole al POS, en el pull, el mismo
  `wa.me` hacia el comprador que E1 devuelve al proponer, para que el encargado
  lo abra cuando recoge el pedido.

## Reglas de negocio

**R1** — `OrderStatus` pasa a tener nueve valores: `PENDING`, `PULLED`,
`AWAITING_CUSTOMER`, `CONFIRMED`, `READY`, `IN_TRANSIT`, `DELIVERED`,
`CANCELLED`, `REJECTED_BY_STORE`. Ningún valor existente cambia de nombre ni de
significado.

**R2** — Una propuesta **no** modifica los importes ni las líneas del pedido.
Solo los guarda como propuesta. El pedido se modifica cuando —y solo cuando— el
comprador aprueba.

**R3** — Toda propuesta guarda los importes vigentes (anteriores) y los
propuestos. El comprador ve los dos totales (criterio 1).

**R4** — Un pedido en `AWAITING_CUSTOMER` no avanza sin una de dos cosas: la
respuesta del comprador o el vencimiento. Nada más lo saca de ahí, salvo que la
tienda lo cancele o lo rechace explícitamente.

**R5 (decisión SP2 del humano)** — El reloj es **absoluto**:
`expiresAt = proposedAt + Store.orderExpiryHours`, con `Store.orderExpiryHours`
por defecto **24**. El cron compara contra `now()`. **Sin horarios y sin zona
horaria**: F-022 está en `passes: false` y aquí no se inventa el dato. Todo en
UTC, como el resto de los `DateTime` de esta base. Cuando F-022 exista, afinar
esto no cambia el modelo: solo cambia cómo se calcula `expiresAt`.

**R6 (decisión SP1 del humano)** — Al vencer, el desenlace es **fijo**: el pedido
pasa a `CANCELLED`, la cancelación se atribuye al **vencimiento** y el motivo es
exactamente «La propuesta venció sin respuesta». No hay `Store.orderExpiryPolicy`
ni variante de «despachar lo disponible». Despachar algo que el comprador no
aprobó explícitamente genera una reclamación peor que cancelar.

**R7** — `expiresAt` se congela al proponer. Cambiar `Store.orderExpiryHours`
afecta a las propuestas siguientes, nunca a las vivas (E15).

**R8** — El plazo manda aunque el cron vaya tarde: **toda** transición que salga
de `AWAITING_CUSTOMER` por decisión del comprador exige, en la misma condición de
escritura, `expiresAt > now()`. El cron hace la contabilidad; no es lo único que
defiende el plazo.

**R9 (decisión SP1)** — Se distinguen **tres** desenlaces terminales, y el pull
los distingue: `CANCELLED` por el comprador, `CANCELLED` por vencimiento y
`REJECTED_BY_STORE`. La atribución se guarda en un campo propio, porque
`cancelReason` es texto libre y no sirve para decidir nada.

**R10** — `rateSnapshot` es inmutable después de crear el pedido. Los importes de
la propuesta llegan **ya en `Order.currencyCode`**; aprobar no reconvierte, no
recalcula promociones y no vuelve a leer el catálogo (criterio 6, y R8/R9 de
F-010).

**R11** — Los tres disparadores —falta de stock, deriva de precio, costo de
envío— usan **el mismo** bucle. No hay tres caminos ni tres endpoints.

**R12 (decisión SP3 del humano)** — El enlace `wa.me` hacia el comprador lo
**abre una persona**, el encargado. queandabuscando solo lo construye y lo
devuelve. Cero proveedor de mensajería, cero credencial nueva, cero
infraestructura nueva. Se construye reutilizando `src/features/orders/whatsapp.ts`.

**R13** — Si el teléfono del comprador no da dígitos utilizables, el enlace sale
`null` con un motivo explícito y la propuesta **se crea igual**. El pedido no
queda inalcanzable: el reloj sigue corriendo y R6 lo cierra.

**R14** — Toda transición desde `AWAITING_CUSTOMER` es un `UPDATE` **condicional**
sobre el estado (y sobre `expiresAt` cuando la dispara el comprador). La carrera
la resuelve la base con «filas afectadas = 0», nunca un «lee y después escribe»,
que la pierde. Es la misma disciplina que ya usa la idempotencia del checkout
(ADR 0016, defensa 1).

**R15** — Proponer **no** es reportar estado. `POST /api/internal/orders/status`
no acepta `AWAITING_CUSTOMER` (E19): ese estado solo lo pone la acción de
proponer, que es la única que fija `expiresAt`; aceptarlo por la vía del reporte
dejaría pedidos esperando para siempre. Para los estados que sí acepta sigue
valiendo R7 de F-007: **el POS es la autoridad** y no se le ponen guardas de
transición.

**R16** — Responder no exige JavaScript. La página del pedido hoy no tiene
ningún módulo de cliente propio (F-010 DP2) y responder no es motivo para
dárselo.

**R17** — La página del pedido no se cachea (ya en F-010 R18: `dynamic` y
`revalidate = 0` en `src/app/[slug]/pedido/[code]/page.tsx`). El plazo que ve el
comprador se recalcula en cada petición.

**R18** — El plazo se muestra **relativo** («te quedan unas N horas»), nunca como
una hora local: no hay zona horaria de la tienda y no se inventa (R5).

**R19** — `IN_TRANSIT` va entre `READY` y `DELIVERED` y lo reporta el POS por
`/orders/status`, sin guardas nuevas (R15). La insignia de estado tiene copia
propia para retiro y para envío, como ya la tiene `READY`
(`src/features/orders/components/OrderStatusBadge.tsx`).

**R20** — `Store.orderExpiryHours` es un campo **de queandabuscando**: no lo
sincroniza el POS ni lo pisa un evento `STORE`. Es una fila para la tabla de
propiedad de campos de F-022.

**R21** — La cancelación parcial por línea no tiene mecanismo propio: es una
propuesta que quita líneas y baja el total. Un camino, no dos.

**R22** — El `code` sigue siendo la **única** credencial de la página y ahora
también de la respuesta. La ruta que responde se busca por `(storeId, code)` en
la misma consulta, y un código de otra tienda responde exactamente igual que uno
inexistente (F-010 E17). Sus defensas **no se heredan** de las seis del checkout:
un POST de formulario viaja como `x-www-form-urlencoded`, así que esta ruta no
tiene el _preflight_ CORS que era la defensa 4 de la ADR 0016. Están enumeradas
una por una en
[ADR 0024](../../../docs/adr/0024-segunda-ruta-publica-de-escritura.md).

## Casos límite y errores

| Caso                                                                                 | Respuesta esperada                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El comprador aprueba y el cron vence a la vez                                        | Gana quien escriba primero; el otro afecta 0 filas y responde `409`/no-op (E14, R14)                                                                   |
| Dos modificaciones seguidas                                                          | La segunda reemplaza a la primera y reinicia el reloj (E13)                                                                                            |
| Aprobar un pedido que la tienda ya canceló                                           | `409` con el estado actual; nada se escribe (E8)                                                                                                       |
| Teléfono inválido o sin dígitos                                                      | `wa.me` `null` con motivo; la propuesta se crea igual y vence normal (R13, E1)                                                                         |
| El reloj es absoluto y la tienda está cerrada                                        | El plazo corre igual. Con el default de 24 h una propuesta nocturna sobrevive a la apertura; con un valor corto no, y eso es aceptado hasta F-022 (R5) |
| Cron caído o retrasado                                                               | La propuesta no se puede aprobar pasado `expiresAt` (E11) y la página la muestra vencida (E12)                                                         |
| Propuesta con el mismo total que el vigente                                          | Se acepta: cambiar líneas sin cambiar el total es legítimo. La página lo dice sin fingir un cambio de importe                                          |
| Propuesta con total negativo, cero líneas, o moneda distinta de `Order.currencyCode` | `400`, nada escrito                                                                                                                                    |
| Propuesta con más líneas de las que admite el checkout                               | `400`, con el mismo tope que F-010 (50 líneas)                                                                                                         |
| Proponer sobre un pedido de otro negocio                                             | `404`, idéntico a inexistente (`docs/sync-contract.md` § Vocabulario de errores)                                                                       |
| Responder con un `code` de otra tienda                                               | `404`, idéntico a inexistente (R22)                                                                                                                    |
| Responder dos veces la misma decisión                                                | `200`, sin cambios (E7)                                                                                                                                |
| Responder la decisión contraria a la ya registrada                                   | `409` con el estado actual (E7)                                                                                                                        |
| El pedido se aprueba y después el POS lo cancela                                     | Permitido: es el POS reportando, R7 de F-007. La página muestra «Cancelado»                                                                            |
| `IN_TRANSIT` sobre un pedido `PICKUP`                                                | Se acepta (R15/R19) y la insignia tiene copia propia (E22)                                                                                             |
| Un consumidor del pull que solo conoce los 6 estados viejos                          | Ve tres valores que no reconoce. **No es aditivo para un `switch` exhaustivo**: hay que anunciarlo en el contrato (criterio 8, I5)                     |
| Dos crons de vencimiento solapados                                                   | El segundo afecta 0 filas: el `UPDATE` es condicional (R14)                                                                                            |
| El comprador ya tiene cuenta (F-012)                                                 | Nada cambia: el `code` sigue siendo la credencial y `customerId` no participa en la decisión                                                           |

## Datos y contrato

### Modelo

Todo aditivo y nullable salvo el default de horas, así que la migración no
reescribe filas. Se aplica con `npm run db:migrate`, nunca con los dos comandos
prohibidos de AGENTS.md, y hay que **quitar del `migration.sql` generado los
cinco `DROP INDEX` de índices GIN/parciales** que Prisma propone sin motivo
(AGENTS.md § «Cosas que muerden»).

| Tabla   | Cambio                                                                    | Nota                                                                                  |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| enum    | `OrderStatus` + `AWAITING_CUSTOMER`, `IN_TRANSIT`, `REJECTED_BY_STORE`    | R1                                                                                    |
| enum    | Nuevo, para la atribución: comprador · vencimiento · tienda               | R9. Enum, no texto libre: `cancelReason` sigue siendo el mensaje humano               |
| `Order` | Atribución de la cancelación, nullable                                    | R9. `null` mientras el pedido no esté cancelado ni rechazado                          |
| `Order` | `expiresAt DateTime?`                                                     | R5, R7. `null` fuera de `AWAITING_CUSTOMER`                                           |
| `Order` | Los importes y las líneas propuestos, y el instante en que se propusieron | R2, R3. La **forma** (filas nuevas contra versión del pedido) la cierra sdd-architect |
| `Store` | `orderExpiryHours Int @default(24)`                                       | R5, R20. Propiedad de queandabuscando, no del sync                                    |

Todos los importes siguen en `Decimal(14,2)` y en `Order.currencyCode` (R10).
`rateSnapshot` no se toca nunca después de crear (criterio 6).

### Contrato con cuadrecaja

`docs/sync-contract.md` necesita una **versión nueva** (§ ③④), que este
documento **especifica pero no escribe**: hay otro equipo al otro lado y ese
cambio lo aprueba el humano. Lo que tiene que decir:

1. **El enum de estados del pull pasa de 6 a 9 valores**, con los tres nuevos y
   cuándo aparece cada uno. Es el criterio 8, y **no es aditivo** para un lector
   con un `switch` exhaustivo: eso hay que decirlo con las mismas palabras con
   que la v4 dijo que no era aditiva.
2. **`POST /orders/status` amplía su enum** a `IN_TRANSIT` y
   `REJECTED_BY_STORE`, y **rechaza `AWAITING_CUSTOMER` con `400`** (R15, E19).
   El texto vigente dice «`status` ∈ `CONFIRMED` · `READY` · `DELIVERED` ·
   `CANCELLED`. Sin cambios en la v2»: esa línea deja de ser cierta.
3. **Un endpoint nuevo para proponer**, con su cuerpo (importes y líneas
   propuestos, mensaje) y su respuesta, que incluye `expiresAt` y el `wa.me`
   hacia el comprador —o `null` con motivo, R13—. La ruta y la forma exacta las
   cierra sdd-architect; el contrato las publica.
4. **Cómo se distinguen los tres desenlaces** en el payload del pull: el campo de
   atribución, sus valores y qué significa cada uno (R9, criterio 5).
5. **Códigos de error nuevos** para la § Vocabulario de errores: pedido en un
   estado que no admite propuesta (`409`) y propuesta mal formada (`400`).
6. **`Store.orderExpiryHours` es de queandabuscando** (R20): el POS no lo envía y
   un evento `STORE` no lo pisa.
7. Sigue valiendo todo lo demás: el cursor por negocio, el 404 idéntico para un
   recurso de otro negocio, y que el pull nunca borra un pedido.

### El cron

Ruta nueva bajo `src/app/api/crons/`, con el mismo patrón que
`src/app/api/crons/purge-sso-tokens/route.ts`: `GET`, `dynamic = "force-dynamic"`,
`Authorization: Bearer $CRON_SECRET` y `401` si falta o no coincide, respuesta
JSON con el conteo de lo que hizo. Y su entrada en `vercel.json`, que hoy tiene
un solo cron.

## Criterios de aceptación propuestos

Los **diez** son los de `.agent/features.json`, **literales y en orden**, y
ninguno se toca (regla 3). Aquí `[ya]` y `[nuevo]` **no** significan lo que en la
plantilla: significan si el comportamiento **existe ya en el código de hoy**
(`[ya]`) o **hay que construirlo** (`[nuevo]`). Lo que se propone al humano está
en «Huecos y preguntas», no aquí.

El grueso lo verifica un guion de modos, scripts/renegotiate-order.mjs
(por crear), al estilo de `scripts/pull-orders.mjs`, envuelto por
.agent/specs/F-019/smoke.sh (por crear) para que el sensor lo pesque por el
prefijo `SMOKE FAIL`. Se ejecuta con `bash .agent/verify.sh F-019 --smoke`.

1. **`[nuevo]`** — «Proponer una modificacion deja el pedido en AWAITING_CUSTOMER
   y GET /[slug]/pedido/[code] muestra el total anterior y el nuevo.»
   → `node scripts/renegotiate-order.mjs --propose`: siembra un pedido por el
   checkout público, lo pullea, propone, y comprueba (a) el `status` de la fila
   en `AWAITING_CUSTOMER` y `expiresAt` no nulo, leídos con `SELECT`; (b)
   `curl -s "$BASE/tienda-demo/pedido/$CODE"` trae en el HTML el total anterior
   **y** el nuevo, los dos importes distintos y los dos presentes. Los dos
   asertos en el mismo modo: la fila sin la pantalla no es el criterio.

2. **`[nuevo]`** — «Aprobar la modificacion pasa el pedido a CONFIRMED con los
   importes nuevos y GET /api/internal/orders lo refleja.»
   → `node scripts/renegotiate-order.mjs --approve`: aprueba por la ruta pública
   y después pullea con el bearer del negocio; exige `status: "CONFIRMED"` y que
   `total`, `subtotal`, `deliveryFee` y las líneas del payload sean **los
   propuestos**, no los originales.

3. **`[nuevo]`** — «Rechazarla pasa el pedido a CANCELLED con el motivo atribuido
   al comprador.»
   → `node scripts/renegotiate-order.mjs --reject`: exige `status = CANCELLED`,
   el campo de atribución en «comprador» y `cancelReason` no nulo, leídos de la
   base y también del payload del pull.

4. **`[nuevo]`** — «Un pedido AWAITING_CUSTOMER vencido cambia de estado sin
   intervencion de nadie, verificado forzando la fecha y no esperando.»
   → dos comprobaciones, ninguna con espera:
   (a) `node scripts/renegotiate-order.mjs --expire`, que hace
   `UPDATE "Order" SET "expiresAt" = now() - interval '1 hour'` sobre el pedido
   que acaba de crear, llama al cron con
   `curl -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/crons/<ruta>"` y
   exige `CANCELLED` + atribución «vencimiento» + el motivo literal «La
   propuesta venció sin respuesta»;
   (b) `npx vitest run --project db` sobre el test del barrido (por crear), que
   contra Postgres real comprueba que un pedido sin vencer **no** se toca y que
   un segundo barrido afecta 0 filas (R14).

5. **`[nuevo]`** — «REJECTED_BY_STORE y CANCELLED se distinguen en la respuesta
   del pull.»
   → `node scripts/renegotiate-order.mjs --outcomes`: crea tres pedidos, los
   lleva a los tres desenlaces (cancelado por el comprador, vencido, rechazado
   por la tienda) y exige que el pull los devuelva distinguibles **de a pares**:
   `REJECTED_BY_STORE` ≠ `CANCELLED` por `status`, y los dos `CANCELLED` entre sí
   por el campo de atribución (R9).

6. **`[nuevo]`** — «rateSnapshot no cambia entre la creacion del pedido y la
   aprobacion de la modificacion.»
   → dentro de `--approve`: `SELECT "rateSnapshot" FROM "Order"` antes de
   proponer y después de aprobar, comparados como JSON canónico; tienen que ser
   **idénticos byte a byte**, incluido `capturedAt`.

7. **`[ya]` para `checkoutMode = WHATSAPP`, con dos huecos reales** — «El
   comprador recibe un enlace a la pagina de su pedido por WhatsApp al crearlo.»

   Lo que **ya** está y solo hay que volver a ejecutar:
   - `npx vitest run --project server src/features/orders/whatsapp.test.ts` —
     `src/features/orders/whatsapp.ts` arma el mensaje con la línea
     `Ver el pedido: ${orderUrl}` y `whatsapp.test.ts:34` ya asegura que la URL
     del pedido va dentro del mensaje.
   - `npx vitest run --project server src/features/orders/server/read.test.ts` —
     `orderWhatsappUrl()` (`src/features/orders/server/read.ts:141`) lo expone
     desde el snapshot persistido.
   - `curl -s "$BASE/tienda-demo/pedido/$CODE" | grep -c 'wa.me'` ≥ 1 sobre una
     tienda `WHATSAPP`: la página lo ofrece (F-010 E18).

   Los dos huecos, que sí son trabajo de este feature:
   - **La respuesta del checkout devuelve `whatsappUrl: null` siempre**, por el
     bug I2 de abajo. `node scripts/renegotiate-order.mjs --link-on-create` tiene
     que exigir que `POST /api/orders` devuelva un `whatsappUrl` que contenga la
     URL del pedido, no solo que la página lo muestre.
   - **`ONSITE` se queda sin enlace** (I3): ahí el comprador no recibe nada por
     WhatsApp. El mismo modo tiene que exigir que el payload del pull traiga el
     `wa.me` **hacia el comprador** también para esos pedidos, para que el
     encargado se lo abra.

8. **`[nuevo]`** — «El enum de estados ampliado esta documentado en
   docs/sync-contract.md.»
   → `grep -c -E 'AWAITING_CUSTOMER|IN_TRANSIT|REJECTED_BY_STORE' docs/sync-contract.md`
   ≥ 3 **y** `grep -n 'Versión 5' docs/sync-contract.md` con salida no vacía: los
   tres valores nombrados y la versión subida, porque un cambio no aditivo sin
   número de versión no lo ve nadie al otro lado. Los siete puntos de § «Datos y
   contrato» son el contenido; el humano aprueba el texto antes de fusionar.

9. **`[nuevo]`** — «Reportar IN_TRANSIT sobre un pedido READY deja la fila en
   IN_TRANSIT y GET /[slug]/pedido/[code] lo muestra con copia propia, distinta
   de READY.»
   → `node scripts/renegotiate-order.mjs --transit`: lleva un pedido con envío
   hasta `READY`, guarda el HTML de su página, reporta `IN_TRANSIT` por
   `POST /api/internal/orders/status`, y exige tres cosas: (a) la fila queda en
   `IN_TRANSIT`; (b) el HTML de después trae la insignia y la explicación de
   `IN_TRANSIT`; (c) ese texto **no** aparece en el HTML de antes. «Copia propia,
   distinta de READY» se comprueba comparando las dos capturas, no leyendo el
   componente. El mismo modo repite el ciclo con un pedido de retiro (E22), donde
   la copia es otra y tampoco puede coincidir con la de envío. Ojo con (c): hoy
   `READY` con envío se explica con «Va en camino.», que es exactamente lo que
   pasa a significar `IN_TRANSIT`; mientras esa línea de
   `src/features/orders/components/OrderStatusBadge.tsx` no cambie, (c) falla con
   razón y el criterio no se cumple de verdad.

10. **`[nuevo]`** — «'bash .agent/verify.sh F-019 --full' termina con codigo 0.»
    → ese mismo comando, `echo $?` = `0`. Ojo con la etapa `harness`: los archivos
    que este feature todavía no ha creado se citan **sin** comillas invertidas y
    con «(por crear)» detrás (AGENTS.md § «Cosas que muerden»), y hay que pasar
    `npm run format` sobre cada `.md` que se escriba.

## Incongruencias detectadas

**I1 — `OrderStatus` no tiene ninguno de los tres estados.**
`prisma/schema.prisma:41` lista seis valores. Consecuencia útil que conviene no
romper: `describe()` en
`src/features/orders/components/OrderStatusBadge.tsx:12` es un `switch`
exhaustivo **sin `default`**, así que añadir valores al enum pone el typecheck en
rojo hasta que la insignia tenga copia para los tres. Eso es un guardarraíl, no
un estorbo: no se apaga con un `default`.

**I2 — `createOrder` pasa un slug donde `getOrderByCode` espera un id de tienda,
así que la respuesta del checkout devuelve `whatsappUrl: null` siempre.**
`src/features/orders/server/createOrder.ts:87` llama
`getOrderByCode(store.slug, code)`, pero la firma es
`getOrderByCode(storeId, rawCode)` y la consulta filtra por `where: { code,
storeId }` (`src/features/orders/server/read.ts:54`). `OrderStore.slug` es el
slug público, nunca el uuid de `Store.id` — la página lo hace bien
(`src/app/[slug]/pedido/[code]/page.tsx:30` pasa `resolution.storeId`), el
checkout no. No lo pesca ningún test porque `createOrder.test.ts` mockea
`getOrderByCode` y `scripts/place-order.mjs` no asierta nada sobre
`whatsappUrl`. Es un defecto de F-010, que ya está en `passes: true`; el criterio
7 de este feature es lo que lo cubre. Ver SP6.

**I3 — El criterio 7 no se cumple para `checkoutMode = ONSITE`.**
`orderWhatsappUrl()` devuelve `null` en cuanto el modo no es `WHATSAPP`
(`src/features/orders/server/read.ts:141`, y el atajo de
`createOrder.ts:85`), y la página solo pinta el bloque en ese modo. Además, el
enlace que existe hoy va **del comprador hacia la tienda**: el comprador no
«recibe» nada, se queda con la URL en su propio hilo si decide enviarla. Con la
decisión SP3 —nadie manda mensajes automáticos— la única forma de cerrarlo es la
de E24: darle al POS el `wa.me` hacia el comprador para que lo abra el encargado.

**I4 — `cancelReason` no dice quién canceló.** `prisma/schema.prisma:546` es un
`String?` libre. La decisión SP1 exige distinguir tres desenlaces de forma
programática (R9): hace falta un campo de atribución con enum, no una convención
sobre un texto.

**I5 — Ampliar el enum de estados NO es aditivo para el POS, aunque lo parezca.**
`docs/sync-contract.md` § ③④ publica un ejemplo con `"status": "PENDING"` y fija
para `/orders/status` que «`status` ∈ `CONFIRMED` · `READY` · `DELIVERED` ·
`CANCELLED`. Sin cambios en la v2». Un lector con un `switch` exhaustivo —el
mismo patrón que este repo usa en su insignia— se rompe con los tres valores
nuevos. La v4 ya sentó el precedente de decir en voz alta que una versión no es
aditiva; esta necesita lo mismo.

**I6 — RESUELTA el 2026-08-30: el criterio 9 la cierra.** Cuando se escribió esta
spec, los nueve criterios de entonces no mencionaban `IN_TRANSIT` pese a que el
humano lo había metido en el alcance «con su pantalla y sus pruebas»: ese trabajo
se habría construido sin nada que lo verificara al cerrar el feature. Como
`acceptance_criteria` los escribe él (reglas 3 y 4), fue a SP4, y él añadió el
criterio 9. Queda anotada porque explica de dónde salió ese criterio y por qué la
lista tiene diez y no nueve.

**I7 — La respuesta del comprador es una ruta pública de escritura, y
[ADR 0016](../../../docs/adr/0016-escritura-publica-sin-sesion.md) dice que solo
hay una.** Literalmente: «Existe **una** ruta pública de escritura,
`POST /api/orders` […] No hay ninguna más y añadir otra es una decisión de este
mismo peso». Aprobar y rechazar son escritura pública sin sesión. Hace falta una
ADR nueva —o una enmienda fechada de la 0016— que enumere las defensas de esta
ruta igual que la 0016 enumeró las seis del checkout. Es trabajo de
sdd-architect, no un descuido a tapar con un comentario.

**I8 — La propuesta original pedía «vencimiento configurable por tienda, con
política y default» (R3 de la propuesta); la decisión SP1 lo recorta.** Lo
configurable es solo **cuántas horas** (`Store.orderExpiryHours`); la política es
fija. Esta spec sigue la decisión, no la propuesta.

**I9 — F-022 está en `passes: false` y F-019 no lo declara en `depends_on`, con
razón.** `.agent/features.json` da a F-019 `depends_on: ["F-007", "F-010"]`, los
dos en `passes: true` (regla 5 satisfecha). El reloj absoluto de R5 es
precisamente lo que evita que F-022 sea una dependencia. Se anota para que nadie
lo «arregle» añadiéndola.

## Huecos y preguntas al humano

**SP4 — RESUELTA el 2026-08-30: «Sí, añado el criterio».** El humano añadió a
`.agent/features.json` un criterio nuevo, literal: «Reportar IN_TRANSIT sobre un
pedido READY deja la fila en IN_TRANSIT y GET /[slug]/pedido/[code] lo muestra
con copia propia, distinta de READY.» Se insertó antes del criterio del sensor,
que siempre cierra la lista: son **10** criterios, no nueve, y ningún criterio
existente se tocó (regla 3). Lo verifica un modo `--transit` del mismo guion de
modos. Cierra I6.

**SP5 — RESUELTA el 2026-08-30: «Diario + barrido en el pull».** NO se sube la
cadencia del cron. El cron de vencimiento corre **una vez al día** como red de
seguridad para las tiendas que no pullean, y el barrido real ocurre **dentro de
`GET /api/internal/orders`**: un `UPDATE` condicional acotado al `businessId` que
llama, que cancela los `AWAITING_CUSTOMER` con `expiresAt < now()`. Como el pull
ya corre cada 2 minutos, el desfase real es de minutos y no de horas. El barrido
tiene que ser idempotente (R14) y no puede alargar el pull de forma perceptible;
dónde va exactamente —antes de leer, en el mismo round-trip— lo cierra
`.agent/specs/F-019/architecture.md` § DA5.

**SP6 — RESUELTA el 2026-08-30: «Dentro de F-019».** El bug I2 de F-010
(`src/features/orders/server/createOrder.ts:87` pasa `store.slug` donde
`getOrderByCode` espera `storeId`, así que `POST /api/orders` devuelve
`whatsappUrl: null` siempre) se arregla **dentro de este feature**, porque el
criterio 7 dice «al crearlo» y hoy no se cumple. Va con un aserto nuevo en el
guion de modos que lo pesque de verdad: el test actual no lo detecta porque
mockea `getOrderByCode` y nunca mira con qué argumentos se llama.

**I7 — RESUELTA el 2026-08-30: «Segunda ruta pública, con ADR nueva».** El
comprador responde **sin sesión**, por una segunda ruta pública de escritura.
La ADR nueva —no una enmienda de la 0016— es
[ADR 0024](../../../docs/adr/0024-segunda-ruta-publica-de-escritura.md), que
enumera sus defensas una por una como la 0016 hizo con las seis del checkout.

## No decidido a propósito

Los cinco quedaron cerrados el 2026-08-30 por los dos agentes a los que les
tocaba. Se dejan escritos con su respuesta para que nadie los reabra creyendo
que siguen sueltos.

- **Cómo se modela la propuesta** —filas nuevas, tabla propia o versión del
  pedido— y qué se hace con `OrderItem` al aprobar. **Cerrado** por
  `.agent/specs/F-019/architecture.md` § DA1: vive en la propia fila `Order`, y
  al aprobar se reemplazan las líneas.
- **La ruta y la forma exacta del endpoint de proponer**, y si la respuesta del
  comprador es una Server Action o un route handler. **Cerrado** por
  `.agent/specs/F-019/architecture.md` § DA2 y § DA4: route handler con
  `<form method="post">`, no Server Action, para que el guion de humo pueda
  responder con `curl`. El resultado observable de esta spec (E1–E9) y R16 se
  mantienen.
- **La ADR que legitima la segunda ruta pública de escritura** (I7). **Cerrado**:
  ADR nueva, no enmienda de la 0016 —
  [ADR 0024](../../../docs/adr/0024-segunda-ruta-publica-de-escritura.md).
- **Cómo se presenta la diferencia entre la propuesta y lo vigente**. **Cerrado**
  por `.agent/specs/F-019/design.md`: «Qué cambia» en frases, los dos totales y
  la lista propuesta completa, con la vigente plegada — no dos listas
  enfrentadas, que en el disparador dominante (el costo de envío) saldrían
  idénticas. El criterio 1 sigue exigiendo solo los dos totales.
- **La copia exacta** de la insignia para `IN_TRANSIT` en retiro y en envío, y la
  del bloque de propuesta. **Cerrado** por `.agent/specs/F-019/design.md`, que
  además obliga a cambiar la explicación de `READY` con envío: hoy dice «Va en
  camino.», que es justo lo que pasa a significar `IN_TRANSIT` (criterio 9).
