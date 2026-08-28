---
feature: F-018
agente: sdd-spec
actualizado: 2026-08-27T19:56:26Z
estado: listo
---

> Punto de partida: `.agent/specs/propuestas/identidad-integracion.md` (E1–E5,
> R1–R4). Decisión de fondo: [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md),
> **aceptada** — token por negocio, no de plataforma; esa elección no se reabre.
> Las cinco decisiones del humano (HD1–HD5) están en `.agent/progress/F-018.md`
> § «Decisiones tomadas» y esta spec las da por cerradas.

> **Corrección post-implementación (IP1, 2026-08-27)**: donde esta spec decía
> `QAB_SYNC_TOKEN` ahora dice `QAB_BEARER_TOKEN`. Motivo: el nombre viejo
> **contiene** la subcadena `SYNC_TOKEN`, y el criterio C16 —añadido por el
> humano al firmar el plan— exige que `grep -rn "SYNC_TOKEN" src/ scripts/
.env.example` no devuelva nada. Con el nombre viejo, C16 era imposible de
> cumplir. Lo detectó `sdd-implementer` y lo escaló en vez de tocar la spec
> por su cuenta; la corrección la aplica el orquestador.

## Problema

`/api/internal/*` autentica pero **no autoriza**. Un solo `SYNC_TOKEN` global
abre las seis rutas, y la identidad del negocio sale del payload o de ningún
sitio:

- `src/features/orders/server/pull.ts:62` consulta `where: { id: { gt: since } }`.
  Sin filtro por negocio: devuelve los pedidos —con nombre, teléfono, dirección
  y correo del comprador— de **todos** los negocios de la base.
- `src/app/api/internal/orders/status/route.ts:42` hace
  `updateMany({ where: { id: orderId } })`: cualquier token puede cancelar el
  pedido de cualquier negocio.
- `src/features/sync/server/handlers/store.ts:53` hace `upsert` de `Business`
  por `payload.businessId`, y `src/features/sync/server/handlers/misc.ts:11,64`
  resuelven el negocio igual: quien llama escribe **como quien diga ser**.
- `src/features/sync/server/availability.ts:28` resuelve tiendas por
  `externalId` sin mirar de quién son.
- `src/app/api/internal/reconciliation/route.ts:17` acepta un `storeId` por
  query y no comprueba de quién es esa tienda.

Hoy no filtra nada porque hay un único llamante, pero el modelo ya promete lo
contrario: `Business.syncTokenHash` está en `prisma/schema.prisma:110` y
`hashSyncToken` en `src/lib/syncAuth.ts:56`, documentado como «para que un token
por negocio se pueda rotar», y **no lo llama nadie**. Esa promesa a medias es la
trampa que este feature cierra.

## Alcance

### Dentro

1. **El guard deja de ser un booleano.** `src/app/api/internal/_lib/guard.ts`
   resuelve el `Business` a partir del SHA-256 del token presentado y devuelve
   su identidad (`businessId` interno + `externalId`) o una respuesta de error.
2. **Corte limpio del token global (HD1).** `SYNC_TOKEN` desaparece de
   `src/lib/env.ts`, de `src/app/api/internal/_lib/guard.ts`, de `.env.example`
   y de `.github/workflows/ci.yml`. No hay respaldo ni variable de apagado. El
   **503 cambia de significado**: ya no es «no hay `SYNC_TOKEN`», es «ningún
   `Business` tiene `syncTokenHash`».
3. **Las cinco rutas del alcance (HD3)**: `/api/internal/orders`,
   `/api/internal/orders/status`, `/api/internal/sync/catalog`,
   `/api/internal/sync/availability` y `/api/internal/reconciliation`. Cada una
   deriva el negocio del token y acota sus lecturas y escrituras a él.
4. **`/api/internal/slug-availability` entra también**, con alcance acotado
   (ver E21, E22 y la justificación en «Alcance § slug-availability»).
5. **`businessId` derivado del llamante en todos los handlers del sync.** El
   `businessId` del payload solo se usa para comprobar coherencia, antes de
   escribir nada.
6. **`Order.businessId` denormalizado**, NOT NULL, con FK a `Business` e índice
   `(businessId, status, id)`, más el **backfill** de los pedidos existentes.
7. **Acuñación y rotación del token (HD4)**: un script nuevo,
   scripts/mint-sync-token.mjs (F-018, por crear), y el uso del mismo mecanismo
   desde `prisma/seed.ts` para los negocios de desarrollo.
8. **El contrato (HD5)**: `docs/sync-contract.md` sube a **v3** con la
   autenticación por negocio y el cursor por negocio.
9. **La cola que deja el corte**: los scripts y smokes que hoy leen `SYNC_TOKEN`
   (`scripts/pull-orders.mjs`, `scripts/send-catalog-batch.mjs`,
   `scripts/send-availability-batch.mjs`, `scripts/send-store-batch.mjs`,
   `.agent/specs/F-007/smoke.sh`, `.agent/specs/F-010/smoke.sh`,
   `.agent/specs/F-011/smoke.sh`, `.agent/specs/F-017/smoke.sh`) y los tests que
   la inyectan (`src/app/api/internal/orders/route.test.ts`,
   `src/app/api/internal/orders/status/route.test.ts`,
   `src/app/api/internal/slug-availability/route.test.ts`,
   `src/lib/syncAuth.test.ts`, `src/features/admin/schemas.test.ts`).

### Fuera (explícito)

- **El paso a HMAC.** Sigue siendo lo que dice
  [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md), con sus
  disparadores intactos. F-018 no los adelanta ni los retrasa.
- **La sesión del panel** (`qab-admin-session`) y el SSO de cuadrecaja: otro
  sistema, ADR 0005. Ningún cambio.
- **Los crons propios** (`CRON_SECRET`): no son `/api/internal/*`.
- **El hueco de concurrencia del pull heredado de F-007** (dos pollers
  simultáneos duplican pedidos porque `findMany` + `updateMany` no son
  atómicos). Sigue abierto y sigue sin estar escrito en el contrato —es TP1 de
  `.agent/specs/F-007/tests.md`—. F-018 lo reduce en la práctica (cada negocio
  tiene su propio poller) pero **no lo cierra**: no toca esas dos queries.
- **Cambiar `SyncEvent.businessId` a id interno con FK.** Sigue guardando el
  `externalId` del POS; lo único que cambia es de dónde sale ese valor (R7).
- **Rate limiting, cuotas o auditoría de uso del token.** Nada de eso existe hoy
  y F-018 no lo introduce.

### Alcance § slug-availability

HD3 lo dejó por comprobar. Comprobado: `previewSlug`
(`src/features/storefront/server/registry.ts:150`) **sí filtra algo ajeno**, en
dos puntos.

- `storeKnown` es `count({ where: { externalId } })` global
  (`registry.ts:154`): dice si el `Tienda.id` de **otro** negocio ya existe
  publicado aquí. Es un oráculo de existencia entre inquilinos.
- `reason: "own"` (`registry.ts:188-195`) confirma que un slug público
  pertenece a la tienda cuyo `externalId` se pasó: liga el id interno del POS de
  otro negocio con una marca pública concreta.

Lo que **no** es ajeno: `candidate`, `available`, `resolvedSlug`, `url` y los
motivos `free`/`taken`/`reserved`/`retired`/`invalid`. El espacio de slugs es
global **y público** —cada valor tomado se sirve en `/[slug]`—, así que ahí no
hay nada que aislar y no se aísla (si se aislara, el endpoint mentiría, que es
justo lo que su comentario de cabecera prohíbe).

Decisión: entra en el alcance con **una sola regla** (R10), la de acotar
`storeExternalId` al negocio del llamante.

## Actores y precondiciones

**Actor único:** el cron de cuadrecaja, uno por negocio, con el token de ese
negocio en `Authorization: Bearer`. HD5 fija el dato que ordena el riesgo:
**en cuadrecaja no hay nada desarrollado de esta integración**, y el sistema
solo corre en el entorno local del humano. No hay consumidor vivo, ni despliegue,
ni `Business` en producción cuyo hash haya que poblar sin cortar nada. El
contrato se documenta; no se negocia una migración con nadie.

**Precondiciones:**

- Cada `Business` que deba sincronizar tiene `syncTokenHash` poblado por
  scripts/mint-sync-token.mjs (F-018, por crear) o por `prisma/seed.ts`. Sin eso
  **no sincroniza**: es lo que compra el corte limpio.
- La base tiene aplicada la migración que añade `Order.businessId` con su
  backfill.

## Comportamiento esperado

Salvo que se diga otra cosa, «las seis rutas» son las cinco de HD3 más
`/api/internal/slug-availability`, y el orden de comprobación del guard es
siempre: **configuración → formato de cabecera → resolución del negocio →
`active` → coherencia del payload → alcance del recurso**.

### Credencial e identidad (las seis rutas)

- **E1** — Dado un `Business` A activo con `syncTokenHash = sha256(tokenA)`,
  cuando llega una petición con `Authorization: Bearer <tokenA>` a cualquiera de
  las seis rutas, entonces el guard devuelve la identidad de A (`businessId`
  interno y `externalId`) y la ruta continúa con **esa** identidad, sin leer
  ninguna del payload ni de la query.
- **E2** — Dado que hay al menos un `Business` con `syncTokenHash`, cuando la
  petición no trae cabecera `Authorization`, entonces `401 {"error":"UNAUTHORIZED"}`
  y ninguna consulta de negocio se ejecuta.
- **E3** — Igual que E2 cuando la cabecera no empieza por `Bearer `, cuando el
  valor tras `Bearer ` está vacío o solo tiene espacios, o cuando mide menos de
  32 caracteres: `401`, sin consultar la base.
- **E4** — Dado un token bien formado cuyo SHA-256 no coincide con el
  `syncTokenHash` de ningún negocio, entonces `401 {"error":"UNAUTHORIZED"}`,
  **idéntico** a E2/E3: no hay forma de distinguir «token inexistente» de
  «cabecera mal puesta».
- **E5** — Dado un token válido de un `Business` con `active: false`, entonces
  `403 {"error":"BUSINESS_INACTIVE"}` — ni 401 ni 200 (HD2). La petición no lee
  ni escribe nada más.
- **E6** — Dado que **ningún** `Business` tiene `syncTokenHash` (`NULL` en
  todas las filas), cuando llega cualquier petición a cualquiera de las seis
  rutas, con cabecera o sin ella, entonces `503 {"error":"SYNC_NOT_CONFIGURED"}`
  y un `console.error` que dice que ningún negocio tiene token configurado.
  Nunca 200 y nunca 401 (R2, invariante de ADR 0008 con su significado nuevo).
- **E7** — Dado un entorno donde alguien define `SYNC_TOKEN`, cuando lo presenta
  como Bearer, entonces la respuesta es la de E4 (401) o la de E6 (503) según
  haya o no algún hash: la variable ya no autentica nada y su presencia no
  cambia ninguna respuesta.
- **E8** — Dado un `Business` con `syncTokenHash = NULL`, entonces ninguna
  petición se autentica como ese negocio, incluidas las que presentan un token
  vacío, la cadena `"null"` o el hash de la cadena vacía.

### `/api/internal/orders` — el pull (corrige F-007)

- **E9** — Dados dos negocios A y B con tiendas y pedidos propios, cuando se
  hace `GET /api/internal/orders?since=0&limit=100` con el token de A, entonces
  el `orders[]` contiene **exactamente** los pedidos cuyo `Order.businessId` es
  A, ninguno de B, y `nextCursor` se calcula solo sobre esa página.
- **E10** — En el mismo escenario, tras esa llamada los pedidos `PENDING` **de
  A** pasan a `PULLED` con `pulledAt`; los `PENDING` de B siguen `PENDING` y con
  `pulledAt` nulo.
- **E11** — Dado que A ya está al día (`since` = su último id), cuando pide de
  nuevo, entonces `200 {"orders":[],"nextCursor":null}`, aunque B haya creado
  pedidos con ids posteriores.

### `/api/internal/orders/status`

- **E12** — Dado un pedido de B, cuando A hace `POST /api/internal/orders/status`
  con ese `orderId`, entonces `404 {"error":"UNKNOWN_ORDER"}`, **el mismo cuerpo
  y el mismo código** que para un `orderId` inexistente, y el pedido de B no
  cambia de `status` ni de `cancelReason`.
- **E13** — Dado un pedido propio de A, el comportamiento de F-007 no cambia:
  `200 {"ok":true}` y el estado queda escrito.

### `/api/internal/sync/catalog`

- **E14** — Dado el token de A y un cuerpo con `businessId` de B —en el campo
  raíz o en el `payload` de cualquier evento que lo lleve—, entonces
  `403 {"error":"BUSINESS_MISMATCH"}` y **no se escribe nada**: ni filas en
  `SyncEvent`, ni `Business`, ni `Store`, ni `StoreProduct`, ni revalidación de
  caché. La comprobación ocurre antes de `recordBatch`
  (`src/features/sync/server/inbox.ts:19`).
- **E15** — Dado el token de A y un cuerpo coherente con A, entonces el
  comportamiento de F-005 se mantiene íntegro (207, `processed`/`duplicate`/
  `stale`/`skipped_not_published`/`failed`), y todos los handlers usan el
  `businessId` **interno** resuelto del token.
- **E16** — Dado el token de A y un evento `STORE` cuyo `businessId` es el de A
  pero que llega **antes** de que exista ninguna tienda, entonces el handler
  actualiza `name` y `baseCurrencyCode` del negocio ya existente y crea la
  tienda; **no crea ningún `Business`**. Un negocio nace solo al acuñarle el
  token (E21), nunca por un payload.

### `/api/internal/sync/availability`

- **E17** — Dado el token de A y un lote con `items[]` que incluye una tienda de
  B, entonces `200`, ese item **no** aparece en `confirmed`, no cuenta en
  `applied`, y la `availability` de los productos de B no cambia. Es
  indistinguible de una tienda no publicada aquí, que ya era el caso de hoy.
- **E18** — En el mismo lote, los items de tiendas de A se aplican y confirman
  como hasta ahora.

### `/api/internal/reconciliation`

- **E19** — Dado el token de A y `?storeId=<externalId de una tienda de B>`,
  entonces `404 {"error":"UNKNOWN_STORE"}`, idéntico a un `storeId` inexistente,
  y no se devuelve ni `products` ni `hash`.
- **E20** — Con una tienda propia de A, la respuesta sigue siendo
  `200 { products, hash }` con el mismo hash que hoy.

### `/api/internal/slug-availability`

- **E21** — Dado el token de A y `?storeId=<externalId de una tienda de B>`,
  entonces `storeKnown: false` y `reason` nunca es `"own"`: el `storeId` ajeno
  se trata como desconocido. `candidate`, `available`, `resolvedSlug` y `url` no
  cambian, porque el espacio de slugs es global y público.
- **E22** — Dado el token de A y una tienda propia, la respuesta es exactamente
  la de hoy, incluidos `reason: "own"` y `reserving: false`.

### Acuñación, rotación y siembra

- **E23** — Cuando se ejecuta `npx tsx scripts/mint-sync-token.ts <externalId>`
  (F-018, por crear — PP2: `.ts` corrido con `tsx`, no `.mjs`) sobre un
  `externalId` que no existe, entonces se crea el
  `Business` con ese `externalId`, se acuña un token aleatorio de ≥ 48
  caracteres, se guarda **solo** su SHA-256 en `syncTokenHash`, y el token se
  imprime **una vez** por stdout. El token en claro no queda en ninguna columna
  ni en ningún log del servidor.
- **E24** — Cuando se ejecuta sobre un `externalId` que ya existe, entonces
  rota: el hash anterior se reemplaza, se imprime el token nuevo, y ningún otro
  negocio se toca.
- **E25** — Dado que A rota su token, entonces el token viejo de A responde 401,
  el nuevo responde 200, y el token de B sigue respondiendo 200 sin cambios.
- **E26** — Cuando `npm run seed` corre sobre una base limpia, entonces siembra
  **dos** negocios (`seed-negocio-1` y un segundo negocio con su tienda y sus
  productos), acuña un token para cada uno e imprime ambos por stdout una vez.
- **E27** — Cuando `npm run seed` corre por segunda vez, entonces **no** cambia
  ningún `syncTokenHash` ya poblado y no imprime ningún token nuevo: el seed
  sigue siendo idempotente y el token impreso en la primera corrida sigue
  sirviendo (el CI siembra dos veces).

### Datos: `Order.businessId`

- **E28** — Cuando se aplica la migración sobre la base local, que tiene pedidos
  reales de antes, entonces cada `Order` queda con el `businessId` de la
  `Store` a la que apunta, `SELECT count(*) FROM "Order" WHERE "businessId" IS NULL`
  devuelve `0`, y no se ejecuta `prisma migrate reset` ni `prisma db push` (los
  dos comandos prohibidos de `AGENTS.md`).
- **E29** — Cuando un comprador termina un checkout, entonces el `Order` nace ya
  con `businessId` = el del `Store` (el valor ya está a mano en
  `src/features/orders/server/quote.ts:128`), sin una consulta extra.
- **E30** — Cuando se pide el plan de la consulta del pull con el índice
  disponible, entonces el plan usa `Order_businessId_status_id_idx` y no un
  `Seq Scan` (cómo se comprueba: criterio C7 más abajo).

## Reglas de negocio

- **R1 — La identidad sale del token.** Ningún `businessId`, `storeId` u
  `orderId` de payload o de query fija de qué negocio es una petición. Solo
  selecciona **dentro** del negocio ya autenticado.
- **R2 — Un token ausente jamás significa «deja pasar todo».** Sin ningún hash
  configurado, 503; con hashes configurados y token que no resuelve, 401. Nunca 200. (ADR 0008, con el significado nuevo que le da HD1.)
- **R3 — El cursor del pull es por negocio.** `since` se interpreta contra los
  pedidos de ese negocio. Los ids siguen siendo un `BIGINT` global y creciente,
  así que cada negocio ve una subsecuencia con huecos: eso es correcto y el POS
  no debe asumir continuidad.
- **R4 — La comparación del token no filtra por tiempo.** Lo que viaja a la base
  es el SHA-256 del token presentado, comparado por igualdad en un índice
  `UNIQUE`: una sola consulta, nunca un `findMany` de todos los negocios
  comparando fila a fila. `timingSafeEqual` sigue siendo la única forma de
  comparar dos secretos en memoria (`src/lib/syncAuth.ts:23`), y ningún camino
  de error revela la longitud ni la existencia del token (E2=E3=E4).
- **R5 — El payload solo comprueba coherencia.** Un `businessId` de payload que
  no sea el del negocio autenticado es un `403`, no un dato, y el 403 ocurre
  **antes** de cualquier escritura, incluida la del inbox.
- **R6 — Un recurso ajeno se comporta como inexistente.** Un pedido, una tienda
  o un `storeId` de otro negocio devuelven el mismo código y el mismo cuerpo que
  uno que no existe (404 / `storeKnown: false` / item no confirmado). Nada en
  `/api/internal/*` puede usarse como oráculo de existencia entre inquilinos.
- **R7 — `SyncEvent.businessId` sigue siendo el `externalId` del POS**, sin FK
  (`prisma/schema.prisma:593`), y ahora lo escribe el llamante autenticado, no
  el cuerpo. El valor observable no cambia; su origen sí.
- **R8 — El sync no crea negocios.** `handleStore` deja de hacer `upsert` de
  `Business`: solo actualiza el negocio autenticado. Un `Business` nace al
  acuñarle su token (script o seed).
- **R9 — La consulta que resuelve el negocio vive en `features/*/server/`**, no
  en `src/app/`. `AGENTS.md` § Arquitectura: `src/app/` rutea y compone,
  `src/features/*/server/` es lo único que toca Prisma, y `src/lib/` no importa
  Prisma —así que `src/lib/syncAuth.ts` sigue siendo puro (hash y comparación) y
  `src/app/api/internal/_lib/guard.ts` compone, no consulta.
- **R10 — `slug-availability` acota solo el `storeId`.** Un `storeExternalId`
  que no pertenece al negocio autenticado se trata como si no se hubiera
  enviado. Lo demás de la respuesta no se acota, porque el espacio de slugs es
  público por definición.
- **R11 — El token en claro se ve una vez.** Solo lo imprime quien lo acuña, por
  stdout. Nunca se guarda en una columna, nunca se escribe en un log del
  servidor, y ningún endpoint lo devuelve.
- **R12 — `Store.businessId` no se mueve.** `regroupStoreIntoBrand` rechaza
  reagrupar entre negocios distintos (`src/features/storefront/server/registry.ts:352`),
  así que el `businessId` denormalizado en `Order` no puede quedar rancio. Si
  algún día apareciera un camino que mueva una tienda de negocio, tendría que
  actualizar también los pedidos: escrito aquí para que no se descubra tarde.

## Casos límite y errores

| Caso                                                  | Comportamiento exigido                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dos negocios con el mismo `syncTokenHash`             | Imposible por construcción: la columna pasa a ser `UNIQUE`. Hoy **no lo es** (`prisma/schema.prisma:110`), así que la migración la añade. Nullable + `UNIQUE` en Postgres permite muchos `NULL`, que es justo lo que hace falta.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Acuñar un token que colisiona                         | El `INSERT`/`UPDATE` falla con violación de unicidad (P2002); el script aborta con un mensaje claro y **no** deja el negocio sin hash. Reintentar acuña otro token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Business.syncTokenHash = NULL`                       | Nunca autentica (E8). La búsqueda es por igualdad de hash; `NULL` no iguala a nada. Prohibido resolver con `findFirst` sobre un valor que pueda ser `undefined`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Token válido de un negocio inactivo                   | 403 `BUSINESS_INACTIVE` (E5, HD2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Todos los negocios sin hash                           | 503 en las seis rutas (E6). Es el estado de la base **justo después** de aplicar la migración y antes de acuñar: el corte es visible y ruidoso, no silencioso.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Order` existentes sin `businessId` al migrar         | Backfill en la misma migración, con `UPDATE ... FROM "Store"` antes del `SET NOT NULL`. La base local tiene pedidos reales: la migración se escribe a mano en el archivo generado. Hay `NOT NULL` + FK en `Order.storeId`, así que el backfill no puede dejar filas huérfanas. Verificación en E28.                                                                                                                                                                                                                                                                                                                                                                            |
| Lote de catálogo con eventos de varios negocios       | 403 `BUSINESS_MISMATCH` para todo el lote (E14). No se aplica parcialmente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Lote de disponibilidad con tiendas mezcladas          | 200; los items ajenos no se confirman y el POS los reintenta para siempre (E17). Es el mismo comportamiento que ya tenía una tienda no publicada; el contrato lo dice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Reintento del mismo lote tras un 403                  | Idempotente por vacío: como el 403 ocurre antes del inbox, no queda ninguna fila `SyncEvent` que luego se reporte como `duplicate` (la trampa de `AGENTS.md` § «Un evento fallido NO es un duplicado»).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dos pollers del **mismo** negocio a la vez            | Sigue duplicando pedidos, como en F-007. Fuera de alcance, escrito arriba.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Dos pollers de **negocios distintos** a la vez        | Correcto: sus conjuntos de pedidos son disjuntos y sus `updateMany` no se pisan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SYNC_TOKEN` definido en el entorno tras el corte     | No hace nada (E7). Se borra de `.env.example` y de `.github/workflows/ci.yml` para que nadie crea que sigue vivo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Scripts y smokes que lo leían                         | Pasan a leer `QAB_BEARER_TOKEN`, que es **el token de un negocio concreto** para pruebas locales, y admiten `--token`. El nombre cambia a propósito: reutilizar `SYNC_TOKEN` resucitaría, en el `.env` del desarrollador, exactamente el concepto de «un token global» que este feature borra. Afecta a `scripts/pull-orders.mjs`, `scripts/send-catalog-batch.mjs`, `scripts/send-availability-batch.mjs`, `scripts/send-store-batch.mjs`, `.agent/specs/F-007/smoke.sh`, `.agent/specs/F-010/smoke.sh`, `.agent/specs/F-011/smoke.sh` y `.agent/specs/F-017/smoke.sh`. Un smoke sin la variable falla con el mensaje de qué ejecutar para acuñarla, nunca se salta en verde. |
| Tests de ruta que inyectaban `process.env.SYNC_TOKEN` | Dejan de hacerlo: el guard resuelve contra la base, así que los tests unitarios de ruta mockean la resolución del llamante y los de dos negocios de verdad viven en el proyecto `db` de `vitest.config.mts`, con Postgres real, como `src/features/sync/server/handlers/product.db.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                   |

## Datos y contrato

### Identidad que el guard entrega a la ruta

| Campo        | Tipo            | Notas                                                                                                                                       |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `businessId` | `string` (uuid) | `Business.id` interno. Es lo que va a todo `where`.                                                                                         |
| `externalId` | `string`        | `Business.externalId`, el `Negocio.id` del POS. Es lo único que se compara contra el payload y lo que se escribe en `SyncEvent.businessId`. |

### Vocabulario de errores de `/api/internal/*`

| Situación                                                                     | Código | Cuerpo                                                    |
| ----------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| Ningún negocio con `syncTokenHash`                                            | `503`  | `{"error":"SYNC_NOT_CONFIGURED"}`                         |
| Sin cabecera, esquema distinto de Bearer, valor vacío o token < 32 caracteres | `401`  | `{"error":"UNAUTHORIZED"}`                                |
| Token que no resuelve ningún negocio                                          | `401`  | `{"error":"UNAUTHORIZED"}`                                |
| Negocio con `active: false`                                                   | `403`  | `{"error":"BUSINESS_INACTIVE"}`                           |
| `businessId` del payload ≠ negocio autenticado                                | `403`  | `{"error":"BUSINESS_MISMATCH"}`                           |
| Pedido o tienda de otro negocio                                               | `404`  | `{"error":"UNKNOWN_ORDER"}` / `{"error":"UNKNOWN_STORE"}` |

Los códigos `400` de validación (`INVALID_QUERY`, `INVALID_BODY`,
`INVALID_JSON`, `INVALID_BATCH`, `INVALID_ORDER_ID`) no cambian, y siguen
llegando **después** del guard, no antes.

### Esquema

| Cambio                   | Detalle                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `Business.syncTokenHash` | Pasa a `@unique`. Sigue siendo nullable.                                     |
| `Order.businessId`       | Nuevo, `String`, **NOT NULL**, FK a `Business`, con backfill.                |
| `Order` índice           | Nuevo `@@index([businessId, status, id])`. Los tres existentes se conservan. |
| `Business.orders`        | Relación inversa nueva.                                                      |

### Contrato con cuadrecaja (`docs/sync-contract.md`)

Sube a **v3**. HD5: no hay nada implementado del otro lado, así que esto se
documenta, no se negocia, y la v3 **no es aditiva** en autenticación —hay que
decirlo con esas palabras en § «Cambios respecto a la v2»—.

1. **§ Autenticación**, reescrita: el Bearer es **por negocio**, lo entrega
   queandabuscando al acuñarlo, se guarda solo su hash y se rota reacuñándolo
   sin afectar a los demás. Desaparece la frase «la misma variable (`SYNC_TOKEN`)
   en los dos proyectos». El 503 se explica con su significado nuevo: ningún
   negocio tiene token configurado.
2. **El diagrama** de § «El principio que ordena todo»: `SYNC_TOKEN` deja de
   aparecer a los dos lados; cada negocio lleva su token.
3. **Tabla de errores nueva**, la de arriba, con los tres códigos que el POS no
   había visto nunca: 403 por negocio inactivo, 403 por `businessId` que no
   corresponde, y 404 por recurso de otro negocio.
4. **§ ③④ Pedidos**: `since` es **por negocio**; cuadrecaja guarda un
   `ultimoPedidoVisto` por cada uno. Los ids son globales, así que la secuencia
   que ve un negocio tiene huecos y eso no indica pérdida.
5. **§ ⑤ Reconciliación** y **§ ⑥ Disponibilidad de slug**: el `storeId` de la
   query tiene que ser del negocio del token; si no, 404 y `storeKnown: false`
   respectivamente.
6. **§ ① y ②**: el `businessId` del cuerpo se mantiene en el formato, pero pasa
   a ser **redundante y comprobado**: si no coincide con el del token, 403.
7. La v3 recoge además lo que ya estaba escrito y sin anunciar (`unpublishReason`
   y el endpoint ⑥, § «Propuesta v3»): un solo anuncio, no dos.

## Criterios de aceptación propuestos

Los nueve `[ya]` son los de `.agent/features.json`, **en su orden y con su
literal** (regla 3). Debajo, cómo se verifica cada uno ejecutando algo y qué
escenario lo cubre.

| #   | Criterio (`[ya]`)                                                                                                                                     | Cómo se ejecuta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Escenario          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| C1  | «Con el token del negocio A, `GET /api/internal/orders` no devuelve ningun pedido cuya tienda pertenezca a B, verificado con dos negocios sembrados.» | `npm run seed` (dos negocios, E26) y una prueba del proyecto `db` con pedidos de A y de B: el `orders[]` con el token de A no contiene ningún id de B. Y en runtime: `bash .agent/verify.sh F-018 --smoke` con el smoke de F-018 (por crear) haciendo las dos llamadas con los dos tokens.                                                                                                                                                                                                                        | E9, E10, E11       |
| C2  | «`POST /api/internal/sync/catalog` con token de A y `businessId` de B en el payload responde 403 y no escribe nada.»                                  | Petición con el token de A y `businessId` de B: `403` + `{"error":"BUSINESS_MISMATCH"}`; a continuación `SELECT count(*) FROM "SyncEvent" WHERE "eventId" = ...` devuelve `0`.                                                                                                                                                                                                                                                                                                                                    | E14                |
| C3  | «Un token que no corresponde a ningun negocio responde 401.»                                                                                          | Petición con un token aleatorio de 48 caracteres habiendo hashes configurados: `401` `{"error":"UNAUTHORIZED"}`, con el mismo cuerpo que sin cabecera.                                                                                                                                                                                                                                                                                                                                                            | E2, E3, E4         |
| C4  | «Sin `SYNC_TOKEN` ni ningun hash configurado responde 503, nunca 200.»                                                                                | Con `UPDATE "Business" SET "syncTokenHash" = NULL` en una base de prueba (o el fixture equivalente del proyecto `db`): las seis rutas responden `503`. La mitad «sin `SYNC_TOKEN`» es cierta por construcción tras HD1 —la variable ya no existe— y se comprueba con `grep -rn "SYNC_TOKEN" src/` sin resultados. Ver la incongruencia I1.                                                                                                                                                                        | E6, E7             |
| C5  | «Rotar el token del negocio A no afecta al sync del negocio B.»                                                                                       | `npx tsx scripts/mint-sync-token.ts seed-negocio-1` (por crear; PP2 cambia el literal de `.mjs` a `.ts`, corrido con `tsx`) y después: token viejo de A → 401, token nuevo de A → 200, token de B → 200.                                                                                                                                                                                                                                                                                                          | E24, E25           |
| C6  | «`grep -n "payload.businessId" src/features/sync/server/handlers/` no aparece como origen de identidad en ningun `where` de resolucion de negocio.»   | Ejecutado como `grep -rn "payload.businessId" src/features/sync/server/handlers/`: **sin resultados** (salida vacía, código 1). Los handlers reciben la identidad ya resuelta. Ver I2 sobre el `-n` sin `-r` del literal.                                                                                                                                                                                                                                                                                         | E15, E16           |
| C7  | «`EXPLAIN` de la consulta del pull usa el indice `(businessId, status, id)`.»                                                                         | Dos comprobaciones, las dos ejecutables: (a) `SELECT indexdef FROM pg_indexes WHERE tablename = 'Order'` contiene `(businessId, status, id)`; (b) con un cliente `pg` propio: `SET enable_seqscan = off;` y luego `EXPLAIN SELECT ... FROM "Order" WHERE "businessId" = $1 AND id > $2 ORDER BY id ASC LIMIT 100`, cuyo plan nombra `Order_businessId_status_id_idx`. El `SET` es necesario porque con seis pedidos en la base local el planificador elige `Seq Scan` por tamaño, no por falta de índice. Ver I3. | E30                |
| C8  | «El cursor por negocio esta documentado en `docs/sync-contract.md`, en Autenticacion y en la seccion de Pedidos.»                                     | `grep -n "por negocio" docs/sync-contract.md` da resultados en § Autenticación y en § ③④ Pedidos; `grep -n "SYNC_TOKEN" docs/sync-contract.md` no da ninguno.                                                                                                                                                                                                                                                                                                                                                     | § Datos y contrato |
| C9  | «`bash .agent/verify.sh F-018 --full` termina con codigo 0.»                                                                                          | Tal cual, con Postgres levantado (el proyecto `db` de vitest exige base real).                                                                                                                                                                                                                                                                                                                                                                                                                                    | Todos              |

Criterios `[nuevo]`, propuestos al humano porque cubren decisiones HD1–HD4 que
los nueve de arriba no nombran. No sustituyen a ninguno (regla 3):

- **C10 `[nuevo]`** — Un token válido de un `Business` con `active: false`
  responde `403` `{"error":"BUSINESS_INACTIVE"}` en las seis rutas, nunca 401 ni 200. (HD2 / E5.)
- **C11 `[nuevo]`** — `GET /api/internal/reconciliation?storeId=<tienda de B>`
  con el token de A responde `404` `{"error":"UNKNOWN_STORE"}`, idéntico a un
  `storeId` inexistente. (HD3 / E19.)
- **C12 `[nuevo]`** — `POST /api/internal/sync/availability` con el token de A y
  un item de una tienda de B responde 200 sin ese item en `confirmed` y sin
  cambiar la disponibilidad de B. (HD3 / E17.)
- **C13 `[nuevo]`** — `GET /api/internal/slug-availability?storeId=<tienda de B>`
  con el token de A responde `storeKnown: false` y `reason ≠ "own"`. (HD3 / E21.)
- **C14 `[nuevo]`** — Tras aplicar la migración sobre la base local con pedidos
  reales, `SELECT count(*) FROM "Order" WHERE "businessId" IS NULL` devuelve `0`
  y `npx prisma migrate status` no reporta drift, sin haber ejecutado ninguno de
  los dos comandos prohibidos. (E28.)
- **C15 `[nuevo]`** — `npm run seed` dos veces seguidas deja el mismo
  `syncTokenHash` en los dos negocios sembrados y sale 0 las dos veces. (E26,
  E27.)
- **C16 `[nuevo]`** — `grep -rn "SYNC_TOKEN" src/ scripts/ .env.example` no
  devuelve nada. (HD1 / E7.)

## Incongruencias detectadas

- **I1 — El criterio 4 de `.agent/features.json` nombra una variable que este
  feature borra.** Dice «Sin `SYNC_TOKEN` ni ningun hash configurado responde
  503», y tras HD1 `SYNC_TOKEN` deja de existir
  (`src/lib/env.ts:10`, `src/app/api/internal/_lib/guard.ts:11`). Su primera
  mitad queda trivialmente cierta para siempre. No se toca (regla 3): se
  verifica como está escrito, con la nota de C4. Redacción `[nuevo]` sugerida
  para el humano: «Sin ningún `Business` con `syncTokenHash` configurado, las
  seis rutas de `/api/internal/*` responden 503, nunca 200».
- **I2 — El criterio 6 no es ejecutable tal cual.** `grep -n "..." src/features/sync/server/handlers/`
  sobre un **directorio** y sin `-r` imprime «Is a directory» y sale 2: no
  verifica nada. Se ejecuta con `-rn` (C6). El literal no se toca.
- **I3 — El criterio 7 pide un índice que la consulta del pull no usa de forma
  natural.** El pull filtra `businessId` e `id > since` y ordena por `id`
  (`src/features/orders/server/pull.ts:61-69`); no filtra por `status`. Un
  btree `(businessId, status, id)` sirve para la igualdad de `businessId`, pero
  el rango de `id` queda detrás de una columna sin restringir, así que el plan
  añade un `Sort`. El índice que cubre exactamente esta consulta es
  `(businessId, id)`. ADR 0013 fija `(businessId, status, id)` y el criterio lo
  repite, así que **se crea ese** y se verifica como dice C7; queda dicho que si
  alguien mide un problema de latencia en el pull, el arreglo es añadir
  `(businessId, id)`, no cambiar el criterio.
- **I4 — La propuesta daba por hecho un `@unique` que no existe.**
  `.agent/specs/propuestas/identidad-integracion.md:70` dice «no debería poder
  ocurrir: `@unique`», pero `prisma/schema.prisma:110` declara
  `syncTokenHash String?` sin `@unique`, y la migración inicial tampoco lo crea.
  Sin él no hay ni `findUnique` ni garantía de unicidad. La migración de F-018
  lo añade.
- **I5 — La invariante 503 de ADR 0008 cambia de sujeto.**
  `docs/adr/0008-bearer-token-baseline.md:23` dice «Sin `SYNC_TOKEN` configurado
  el servidor responde 503». Tras HD1 la frase es literalmente falsa aunque la
  invariante siga viva. Como ADR 0013 ya sustituye el mecanismo, lo que falta es
  dejarlo escrito: una nota de «modificada en parte por ADR 0013 / F-018» en la
  0008, o una línea en la 0013. **No es archivo de esta spec**; queda señalado
  para `sdd-architect`.
- **I6 — F-005 tiene un criterio con `passes: true` que este feature invalida en
  su literal.** «`POST /api/internal/sync/catalog` sin `SYNC_TOKEN` configurado
  en el servidor responde 503, nunca 200» (`.agent/features.json`, F-005). El
  comportamiento sobrevive; la variable no. Regla 3: no se toca. Cuando F-018
  cierre, conviene que el humano lo anote en las `notes` de F-005 igual que ya
  hizo en las de F-007.
- **I7 — `SyncEvent.businessId` se llama como el id interno pero guarda el
  externo.** `prisma/schema.prisma:593` es un `String` sin FK y
  `src/features/sync/server/inbox.ts:53` escribe ahí el `businessId` del cuerpo,
  que es el `Negocio.id` del POS. F-018 no lo cambia (R7, fuera de alcance) pero
  la ambigüedad queda anotada aquí para que nadie la resuelva por sorpresa
  mientras toca el módulo.
- **I8 — El contrato ya prometía el token por negocio antes de existir.**
  `docs/sync-contract.md` § ⑥ escribe `Authorization: Bearer <token del negocio>`
  mientras § Autenticación dice «la misma variable (`SYNC_TOKEN`) en los dos
  proyectos». La v3 resuelve la contradicción a favor del token por negocio.
- **I9 — `handleStore` crea negocios desde el payload.**
  `src/features/sync/server/handlers/store.ts:53` hace `upsert` de `Business`.
  Con el token por negocio eso deja de tener sentido y además es el
  único camino de alta de un negocio hoy: R8 lo cierra y E23 lo sustituye, así
  que **el alta de un negocio pasa a ser un acto operativo explícito**. Es un
  cambio de proceso, no solo de código, y conviene que el humano lo sepa.

## Huecos y preguntas al humano

Ninguna pregunta bloqueante: HD1–HD5 cerraron SP1 y SP2 de la propuesta y el
resto se decidió con criterio (ver abajo). Por eso esta spec va en
`estado: listo`.

Tres decisiones tomadas aquí que el humano puede revertir con una frase, y que
se anotan por si prefiere lo contrario —ninguna cambia la forma del feature—:

1. **slug-availability entra** en el alcance, con la regla R10 y nada más
   (HD3 dejaba la comprobación a esta spec; el motivo está en «Alcance §
   slug-availability»).
2. **Los scripts y smokes locales pasan a `QAB_BEARER_TOKEN`**, no reutilizan el
   nombre `SYNC_TOKEN`, para no dejar viva en el `.env` la palabra que este
   feature borra.
3. **El seed acuña solo si el negocio no tiene hash**, e imprime el token únicamente
   cuando lo acuña. Es lo que mantiene idempotente un `npm run seed` que el CI
   corre dos veces sin invalidar el token que el desarrollador ya guardó.

## No decidido a propósito

- **Qué hace cuadrecaja con el token que se le entrega** (dónde lo guarda, cómo
  lo rota su equipo): operativa del POS, y HD5 dice que allí no hay nada
  desarrollado todavía.
- **Cuándo se pasa a HMAC**: ADR 0008 y sus disparadores mandan.
- **Si el pull debe llevar además el índice `(businessId, id)`**: se decide
  midiendo, no ahora (I3).
- **Cómo se aprovisiona un negocio en un despliegue real** (hoy no hay
  despliegue): el script cubre el entorno local, que es el único que existe.
