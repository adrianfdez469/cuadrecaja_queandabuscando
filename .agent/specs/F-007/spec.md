---
feature: F-007
agente: sdd-spec
actualizado: 2026-08-26T11:40:00Z
estado: listo
---

## Problema

Un pedido que alguien hace en la tienda tiene que llegar a cuadrecaja, y el POS
tiene que poder decir qué hizo con él. Los dos endpoints que lo permiten
—`GET /api/internal/orders` y `POST /api/internal/orders/status`— existen y
tipan desde F-007, pero **nadie los ha ejecutado nunca contra un pedido real**:
hasta que F-010 cerró no había forma de crear un pedido, así que el pull solo se
podía probar con filas insertadas a mano. El feature quedó `passes: false` con la
nota «los endpoints existen y tipan; falta la verificación ejecutada».

Importa porque es el único camino por el que un pedido sale de esta base de
datos. Si el cursor se salta un pedido, o si `PENDING → PULLED` no ocurre, el
negocio pierde una venta y nada falla de forma visible: el cliente ve su pedido
confirmado y el POS nunca lo ve.

## Alcance

### Dentro

- Verificar **ejecutando** los cuatro `acceptance_criteria` de F-007 contra un
  servidor real y una base real, con pedidos nacidos del checkout de F-010.
- Un script de verificación reproducible para estos dos endpoints, al nivel de
  los que ya existen para F-005 (`scripts/send-catalog-batch.mjs`) y F-006
  (`scripts/send-availability-batch.mjs`).
- Cerrar los dos huecos de regresión automática: el cursor de `pullOrders()` y la
  ruta `POST /orders/status`, hoy sin ninguna prueba.

### Fuera (explícito)

- **Cambiar la lógica de `pullOrders()`.** Se toca solo si la verificación
  revela un fallo real, no por lectura del código (decisión del humano, § 1 del
  alcance).
- **El claim atómico de pedidos.** Ver `R6` y § «Casos límite»: es un riesgo
  conocido, y con un único poller secuencial no se materializa. Queda anotado,
  no arreglado.
- **Guardas de transición en `POST /orders/status`.** El POS es la autoridad del
  estado del pedido (decisión del humano). Ver `R7`.
- **El aviso al equipo de cuadrecaja** de que el contrato pasó a v2. Es una
  acción del humano, pendiente desde F-010, y no la puede cerrar un agente.
- Cualquier llamada saliente hacia cuadrecaja. Lo prohíbe la ADR 0002 y `C4` lo
  comprueba.

## Actores y precondiciones

Lo dispara **cuadrecaja** (el POS), no una persona. Un único proceso suyo
—cron o worker— llama a los dos endpoints con el `SYNC_TOKEN` en
`Authorization: Bearer`. Precondiciones: `SYNC_TOKEN` configurado en el
servidor, y al menos un `Order` en la base, que hoy solo puede nacer del
checkout de F-010 o del seed.

Ninguna sesión de navegador alcanza estas rutas: son máquina a máquina
(`src/app/api/internal/_lib/guard.ts`).

## Comportamiento esperado

**E1 — pull de un lote.** Dado un `since` y un `limit`, cuando el POS hace
`GET /api/internal/orders?since=<id>&limit=<n>`, entonces responde `200` con
`{ orders, nextCursor }`, `orders` ordenado por `id` ascendente, y solo pedidos
con `id > since`.

**E2 — el cursor avanza y no se salta nada.** Dados tres pedidos con ids
consecutivos, cuando el POS pagina con `limit=1` empezando en `since=0` y sigue
el `nextCursor` que le devuelven, entonces recibe los tres pedidos, cada uno
exactamente una vez, y en orden.

**E3 — al día.** Dado que no quedan pedidos con `id > since`, cuando el POS
hace pull, entonces responde `{ orders: [], nextCursor: null }`. `null` significa
«al día» (`docs/sync-contract.md` § ③④).

**E4 — el pedido devuelto queda marcado.** Dado un pedido en `PENDING`, cuando
el pull lo devuelve, entonces su fila pasa a `PULLED` y `pulledAt` queda con la
hora. El pedido **no se borra**: `/[slug]/pedido/[code]` sigue respondiendo.

**E5 — un estado que no es PENDING no se pisa.** Dado un pedido en `CONFIRMED`,
cuando el pull lo vuelve a devolver, entonces sigue en `CONFIRMED`.

**E6 — el POS reporta estado.** Dado un pedido existente, cuando el POS hace
`POST /api/internal/orders/status` con `{ orderId, status }`, entonces responde
`200 { ok: true }` y la fila queda en ese estado.

**E7 — pedido inexistente.** Dado un `orderId` que no existe, cuando el POS
reporta estado, entonces responde `404` y no modifica ninguna fila.

**E8 — sin credencial.** Dado un `Authorization` ausente o inválido, cuando se
llama a cualquiera de los dos endpoints, entonces responde `401` y nunca ejecuta
la consulta.

## Reglas de negocio

- **R1** — El cursor es el `id` (`BigInt` autoincremental), no una fecha. Es
  monotónico y por eso no se salta pedidos ni los repite.
- **R2** — `nextCursor` es el `id` del último pedido devuelto **solo** cuando la
  página vino llena (`rows.length === limit`); si vino a medias, es `null`. Una
  página a medias ya prueba que no queda nada detrás.
- **R3** — El pull marca `PENDING → PULLED`. Cualquier otro estado se deja
  intacto: el POS ya opinó sobre él.
- **R4** — El pull **nunca borra** un pedido. La página de estado del cliente es
  pública y tiene que seguir funcionando (`docs/sync-contract.md` § ③④).
- **R5** — queandabuscando no hace ninguna llamada saliente hacia cuadrecaja.
  Es la ADR 0002 y se comprueba por grep, no por revisión.
- **R6** — El pull asume **un único poller secuencial**. `pullOrders()` hace
  `findMany` y luego `updateMany` en dos round-trips sin nada atómico entre
  ellos, así que dos pollers concurrentes se llevarían el mismo pedido y el POS
  lo duplicaría. Con un solo proceso no ocurre. Decisión del humano: se
  documenta como invariante que cuadrecaja debe respetar, no se arregla.
- **R7** — En `POST /orders/status` el POS es la autoridad: se acepta cualquier
  `status` del enum sobre cualquier pedido, incluido retroceder desde
  `DELIVERED`. Decisión del humano: añadir guardas podría romper un reintento
  legítimo del POS, y ningún criterio las pide.
- **R8** — El `status` que viaja en el payload del pull es el que la fila tenía
  **antes** de marcarla: un pedido que se pullea por primera vez sale como
  `PENDING`. Es correcto —describe el pedido en el momento en que el POS lo
  ve— y el contrato ya lo dice.

## Casos límite y errores

| Caso                                    | Respuesta esperada                                     |
| --------------------------------------- | ------------------------------------------------------ |
| `since` no numérico                     | `400 INVALID_QUERY`                                    |
| `since` negativo                        | `400 INVALID_QUERY` (`nonnegative()`)                  |
| `limit` `0` o `> 500`                   | `400 INVALID_QUERY`                                    |
| `since`/`limit` ausentes                | `200`, con los defaults `0` y `100`                    |
| `orderId` no convertible a `BigInt`     | `400 INVALID_ORDER_ID`                                 |
| body no-JSON en `status`                | `400 INVALID_JSON`                                     |
| `status` fuera del enum                 | `400 INVALID_BODY`                                     |
| `SYNC_TOKEN` sin configurar en servidor | `503 SYNC_NOT_CONFIGURED`, nunca `200` ni `401`        |
| Token inválido                          | `401 UNAUTHORIZED`                                     |
| Base caída                              | `500 PULL_FAILED`, con el error en el log del servidor |
| Dos pollers concurrentes                | **Riesgo conocido, no cubierto** — ver `R6`            |

Reintentos: el pull es seguro de repetir (el segundo pull con el mismo `since`
devuelve lo mismo, ya en `PULLED`, y `R3` impide que se pise). `POST /status` es
idempotente para el mismo valor.

## Datos y contrato

Ambos endpoints están ya especificados en `docs/sync-contract.md` § ③④, en la
versión v2 que dejó F-010, y este feature **no los cambia**. Lo relevante:

- `id` y `nextCursor` viajan como **string**, no como número: son `BIGINT` y no
  caben en un `Number` de JavaScript sin perder precisión.
- Todos los importes (`unitPrice`, `lineTotal`, `subtotal`, `discountTotal`,
  `deliveryFee`, `total`) van en la moneda del pedido (`Order.currencyCode`), y
  `Σ lineTotal = subtotal` se sostiene siempre.
- Los tres campos `original*` por línea son **informativos y nunca sumables**
  (R5b de F-010). Ningún total se deriva de ellos.
- `code` es la **única credencial** de `/[slug]/pedido/[code]`, una página que
  muestra nombre, teléfono y dirección de una persona. No se loguea entero.
- `status` en el POST ∈ `CONFIRMED` · `READY` · `DELIVERED` · `CANCELLED`.
  `PENDING` y `PULLED` los pone esta base, no el POS.

## Criterios de aceptación propuestos

Los cuatro de `features.json`, sin cambios (regla 3). Cómo se verifica cada uno
ejecutando:

- **C1 `[ya]`** — `GET /api/internal/orders?since=<id>&limit=<n>` responde
  `{ orders, nextCursor }` y respeta el cursor.
  → `node scripts/pull-orders.mjs --paginate`, que pagina con `limit=1` sobre
  tres pedidos y exige recibirlos los tres, una vez cada uno, en orden (E1, E2,
  E3).
- **C2 `[ya]`** — Un pedido devuelto pasa de `PENDING` a `PULLED`.
  → `node scripts/pull-orders.mjs --transition`: consulta el estado en la base
  antes y después del pull (E4, E5).
- **C3 `[ya]`** — `POST /api/internal/orders/status` actualiza el estado y
  responde `404` para un pedido inexistente.
  → `node scripts/pull-orders.mjs --status` (E6, E7).
- **C4 `[ya]`** — `grep -rn CUADRECAJA_API_URL src/` no devuelve nada.
  → el propio grep, código de salida `1` (R5).

## Incongruencias detectadas

1. **`nextCursor` describe un protocolo que el código no implementa.**
   `src/features/orders/server/pull.ts:118` comenta «the POS keeps calling until
   it gets an empty page», pero la línea de al lado devuelve `null` en cuanto una
   página viene a medias, así que el POS **para antes** de ver la página vacía.
   El comportamiento es correcto y es el que documenta el contrato
   (`nextCursor: null` = «al día»); lo que está mal es el comentario. Se corrige
   el comentario, no el código.

2. **`pull.test.ts` no cubre nada de F-007.** Sus cuatro pruebas se escribieron
   durante F-010 y verifican la compatibilidad v2 de los campos. El cursor —el
   corazón de `C1`— no tiene ninguna prueba, y `POST /orders/status` no tiene
   ninguna en absoluto.

3. **F-010 ya vio pasar `PENDING → PULLED`** («el pedido creado por checkout SÍ
   lo recoge el pull de F-007 y pasa a PULLED»). Eso cubre `C2` de pasada, pero
   se hizo desde el feature vecino y no quedó como verificación reproducible de
   F-007. Se rehace aquí con script.

4. **Sin incongruencia en el contrato.** `docs/sync-contract.md` § ③④ describe
   exactamente lo que el código hace, cursor incluido. No hay que tocarlo, lo
   que evita coordinar con el otro equipo.

## Huecos y preguntas al humano

Ninguna abierta. Las tres que había las resolvió el humano antes del plan:

- **SP1 — Alcance.** ¿Verificar y ya, o también cerrar los huecos de prueba?
  → **«Verificar + cerrar huecos de prueba»**: script de verificación, tests del
  cursor y de la ruta de status, y los cuatro criterios ejecutados. La lógica de
  pull no se toca salvo que la verificación revele un fallo real.
- **SP2 — Concurrencia.** ¿Cuántos procesos del POS hacen pull a la vez?
  → **«Uno solo, secuencial»**. El hueco de `R6` queda documentado como riesgo
  conocido y no se arregla ahora.
- **SP3 — Transiciones de estado.** ¿Se guarda el retroceso desde `DELIVERED`?
  → **«Se deja: el POS es la autoridad»**. Ver `R7`.

## No decidido a propósito

- **El claim atómico** (`R6`). Se decidirá si cuadrecaja alguna vez corre más de
  un poller. Quien lo retome: `UPDATE ... RETURNING` en una sola sentencia, con
  el cuidado que exige el pooler en modo transacción (`AGENTS.md` § «Cosas que
  muerden»).
- **Purga o archivado de pedidos ya pulleados.** Hoy crecen sin límite. No es de
  este feature y nadie ha dicho cuánto tiempo deben vivir.
- **Notificar al POS de que hay pedidos** en vez de que pregunte. Existe la
  propuesta `.agent/specs/propuestas/timbre-realtime.md`; sigue siendo propuesta.
