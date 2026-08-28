---
feature: F-018
agente: orquestador
actualizado: 2026-08-27T22:12:24Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Hoy cualquiera que tenga el token de sincronización puede leer los pedidos de
todos los negocios —con el nombre, el teléfono, el correo y la dirección de cada
comprador—, cancelar el pedido de cualquiera, y escribir en el catálogo diciendo
ser quien no es. Después de esto, **cada negocio tendrá su propio token**, y de
ese token saldrá la identidad: un negocio solo verá y tocará lo suyo, y el token
de uno se podrá rotar sin cortarle el sync a los demás.

Lo que **no** cambia: el comprador no nota nada, la tienda pública se sirve
igual, el panel de administración y su SSO no se tocan, y el formato de los
pedidos que lee el POS sigue siendo el mismo. Lo único que cambia para
cuadrecaja es que tendrá que guardar **un token y un cursor por negocio**, en
vez de uno global — y como allí no hay nada desarrollado todavía (HD5), no rompe
a nadie.

## Pasos

Seis etapas, en orden. Tres precedencias no son negociables y van marcadas:
**1 antes que 3** (el pull filtra por una columna que tiene que existir),
**2 antes que 3** (las rutas importan el envoltorio), **4 antes que 6** (sin
tokens acuñados los smokes solo pueden comprobar el 503).

| Nº    | Qué se hace                                                                                                                                                                                                                                                                                                                                                                                                                       | Archivos                                                                                                                                                                                                                                                                   | Criterio que acerca | Cómo se verifica                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **La base.** `Order.businessId` NOT NULL con FK e índice `(businessId, status, id)`; `Business.syncTokenHash` pasa a `UNIQUE`. La migración se escribe **a mano**: columna nullable → backfill `UPDATE … FROM "Store"` → `SET NOT NULL`.                                                                                                                                                                                          | `prisma/schema.prisma`, `prisma/migrations/<ts>_order_business_id_and_sync_token_unique/migration.sql` (nuevo)                                                                                                                                                             | C14                 | `SELECT count(*) FROM "Order" WHERE "businessId" IS NULL` = 0; `npx prisma migrate status` sin deriva; los dos índices GIN del marketplace siguen vivos       |
| **2** | **Las tres piezas de identidad, sin tocar ninguna ruta.** `syncAuth.ts` se queda puro (`readBearerToken`, `mintSyncToken`; se borran `verifySyncToken` y `safeEqual`); `caller.ts` es la única consulta que resuelve el negocio desde el hash; `guard.ts` pasa a exportar `withInternalAuth(handler)`, que entrega la identidad como **parámetro**. `SYNC_TOKEN` sale de `env.ts`.                                                | `src/lib/syncAuth.ts`, src/features/sync/server/caller.ts (nuevo), src/features/sync/identity.ts (nuevo), `src/app/api/internal/_lib/guard.ts`, `src/lib/env.ts`                                                                                                           | C3, C4              | Pruebas de unidad mockeadas: E1–E8 y E14 (la matriz 401 / 403 / 503)                                                                                          |
| **3** | **Las seis rutas y las diez firmas de dominio.** Cada ruta deriva el negocio del token; `pullOrders` gana `businessId` en sus dos `where`; el `updateMany` de `orders/status` sale de la ruta a features/orders/server/status.ts, nuevo (arregla de paso una violación de capa); los handlers del sync reciben la identidad ya resuelta y dejan de leerla del payload. Y el reuso de canónico huérfano se acota por tienda (PP6). | los seis `route.ts` de `src/app/api/internal/`, features/orders/server/pull.ts y status.ts (nuevo), `features/sync/server/{processBatch,inbox,availability,reconciliation}.ts`, `handlers/{store,misc,product}.ts`, `features/storefront/server/registry.ts`               | C2, C6              | `npm run typecheck` (es lo que caza los olvidos); `grep -rn "payload.businessId" src/features/sync/server/handlers/` vacío; E9–E22 con mocks                  |
| **4** | **Acuñar y sembrar.** Un script de CLI crea o rota el token de un negocio e imprime el claro **una sola vez**; el seed acuña para dos negocios de desarrollo, solo si no tienen hash (para seguir siendo idempotente).                                                                                                                                                                                                            | scripts/mint-sync-token.* (nuevo — ver **PP2**), `prisma/seed.ts`, `package.json`                                                                                                                                                                                          | C5, C15             | `npm run seed && npm run seed` sale 0 las dos veces y deja el mismo hash; rotar el token de A: el viejo da 401, el nuevo 200, y el de B sigue en 200          |
| **5** | **Las pruebas con dos negocios de verdad.** Fixtures de dos inquilinos aislados con token real y pedidos propios, en el proyecto `db` de vitest (Postgres real). Más una guarda de frontera que impide que una ruta interna futura se salte el envoltorio o toque Prisma.                                                                                                                                                         | `src/features/marketplace/server/dbFixtures.ts`, dos `*.db.test.ts` nuevos, src/app/api/internal/boundaries.test.ts (nuevo)                                                                                                                                                | C1, C7, C16         | La prueba de dos inquilinos: el `orders[]` con el token de A no contiene ningún id de B. El `EXPLAIN` de C7 según **PP1**                                     |
| **6** | **La cola del corte limpio.** Los cuatro scripts y los cuatro smokes pasan de `SYNC_TOKEN` a `QAB_SYNC_TOKEN` (+ bandera `--token`); se borra la variable de `.env.example` y del CI; `docs/sync-contract.md` sube a **v3**; las dos notas de ADR de I5; y el smoke propio de F-018.                                                                                                                                              | `scripts/{pull-orders,send-catalog-batch,send-availability-batch,send-store-batch}.mjs`, `.agent/specs/F-{007,010,011,017}/smoke.sh`, `.env.example`, `.github/workflows/ci.yml`, `docs/sync-contract.md`, `docs/adr/0008` y `0013`, `.agent/specs/F-018/smoke.sh` (nuevo) | C8, C9, C10–C13     | `bash .agent/verify.sh F-018 --full` en 0 y `--smoke` en 0; `grep -n "por negocio" docs/sync-contract.md` con resultados en § Autenticación y en § ③④ Pedidos |

## De dónde sale cada paso

| Paso | De dónde sale                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § «El archivo de migración, en su orden exacto» (verificado sobre un clon real de la base) · `spec.md` § Casos límite, fila del backfill · ADR 0013 § «Por qué el `businessId` denormalizado» |
| 2    | `architecture.md` § Decisión (las tres piezas, una por capa) y § Componentes · `spec.md` R9 (la consulta vive en `features/*/server/`), R4, R11 · HD1                                                           |
| 3    | `spec.md` E9–E22 (una sección por ruta), R1, R5, R6, R8, R10 · `architecture.md` § «Firmas que cambian en `features/*/server/`» y § Patrones                                                                    |
| 4    | HD4, literal · `spec.md` § «Acuñación, rotación y siembra» (E23–E27) · `architecture.md` § Componentes, filas de acuñación y siembra                                                                            |
| 5    | `architecture.md` § «Pruebas: el corte entre mock y Postgres real» (AP-c) y § «Lo que dice el `EXPLAIN` de verdad» · `spec.md` C1, C7, C16                                                                      |
| 6    | HD1 y HD5 · `spec.md` § Casos límite, filas de scripts y smokes · `architecture.md` § «Qué se rompe de lo existente» y § I5                                                                                     |

Ningún paso sale de mi cabeza: los seis son las seis etapas que
`architecture.md` § «Etapas de implementación» ya numeró.

## Qué queda fuera

- **El paso a HMAC.** Sigue siendo lo que dice ADR 0008, con sus disparadores
  intactos. F-018 no los adelanta ni los retrasa.
- **El hueco de concurrencia del pull que heredamos de F-007**: dos pollers
  simultáneos del **mismo** negocio siguen duplicando pedidos, porque `findMany`
  y `updateMany` no son atómicos. F-018 lo reduce en la práctica (cada negocio
  tiene su propio poller) pero **no lo cierra**, y sigue sin estar escrito en el
  contrato.
- **La sesión del panel y el SSO** (`qab-admin-session`, ADR 0005): otro sistema,
  ni una línea.
- **Rate limiting, cuotas o auditoría de uso del token.** Nada de eso existe hoy
  y este feature no lo introduce.
- **Cambiar `SyncEvent.businessId` a id interno con FK.** Sigue guardando el
  `externalId` del POS; lo único que cambia es de dónde sale ese valor.
- **El índice `(businessId, id)`**, que sería el que cubre exactamente la
  consulta del pull. Ver **PP4**.
- **Tocar el repositorio de cuadrecaja.** Es otro repo y otro stack; lo que le
  toca hacer se documenta en `docs/sync-contract.md` v3 y ahí se queda (HD5).
- **Cerrar F-011**, que sigue con `passes: false` por un criterio bloqueado. No
  es de este feature, aunque lo roce.

## Riesgos y plan B

**Hay migración de datos, y toca una base compartida.** Eso no se aprueba de
pasada, así que va explícito:

- La migración **añade** una columna y la rellena desde `Store`; no borra nada,
  no reescribe nada. Está verificada de principio a fin sobre un **clon** de tu
  base local (`CREATE DATABASE … TEMPLATE`): `UPDATE 1`, cero nulos, índices y FK
  creados, y los dos índices GIN del marketplace intactos.
- **No se ejecuta ninguno de los dos comandos prohibidos.** Nada de
  `prisma migrate reset` ni `prisma db push`. La migración se genera con
  `migrate diff` y se aplica con `migrate deploy`, que es el camino que la ficha
  `prisma-migrate-dev-checksum-drift-bd-compartida.md` prescribe.
- Al `SQL` generado hay que borrarle a mano dos `DROP INDEX` que Prisma propone
  sobre los índices GIN que no conoce. Si se dejaran, **apagarían la búsqueda del
  marketplace en silencio** (ficha `prisma-migrate-dev-borra-indices-gin-no-declarados.md`).
- Si el backfill dejara alguna fila sin dueño, la migración **se para y revierte
  entera** (Postgres la ejecuta en una transacción). No hay negocio de respaldo
  ni fila cero: una migración que se inventa el dueño de un pedido es peor que
  una que se detiene.
- **Riesgo heredado que no arreglo aquí**: Postgres es el mismo para los cuatro
  worktrees de este repo, así que aplicar la migración deja `_prisma_migrations`
  por delante de los demás. Está fichado; se escala, no se tapa desde un feature.

**Sí cambia `docs/sync-contract.md`** — sube a v3 con la autenticación y el
cursor por negocio. Normalmente esto exigiría avisar al otro equipo; HD5 dice
que en cuadrecaja no hay nada desarrollado, así que se documenta y ya.

Otros riesgos, con su plan B:

| Riesgo                                                                                 | Se notaría en                           | Plan B                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| El aserto del `EXPLAIN` (C7) es frágil: depende del planificador y de las estadísticas | El paso 5, de forma intermitente        | Subir el relleno del fixture y `ANALYZE` antes del `EXPLAIN`. **Nunca** borrar el aserto. Ver **PP1** |
| Una ruta interna futura se salta el envoltorio                                         | Nunca, hasta que filtre                 | La guarda de frontera del paso 5 la caza en cada `npm test`                                           |
| El segundo negocio del seed choca con un fixture de F-004/F-010/F-011/F-017            | El paso 4, al sembrar                   | Ids y slug nuevos (`seed-negocio-2`, `seed-tienda-7`); los smokes viejos usan ids literales           |
| Un smoke se queda en verde sin token porque alguien lo hace opcional                   | En ningún sitio — es el fallo peligroso | Sin `QAB_SYNC_TOKEN` el smoke **falla** con el comando de acuñación. Es un aserto del tester          |
| Alguien reintroduce `SYNC_TOKEN` por comodidad                                         | Nunca, salvo en un grep manual          | El aserto de C16 vive en una prueba que corre en cada `npm test`, no en un grep                       |

## Coste

**Dos ciclos de agente**: `sdd-implementer` (pasos 1–6) y `sdd-tester`. Sin
diseñador — F-018 no tiene interfaz.

**Qué se toca de lo que ya funciona**, y es bastante: los seis endpoints
internos, la lógica de pull de F-007, los handlers del sync de F-005 y F-006, la
disponibilidad, la reconciliación, `previewSlug` de F-017, el seed, cuatro
scripts de verificación y los smokes de F-007, F-010, F-011 y F-017. Todo eso
tiene pruebas hoy y tiene que seguir en verde: es lo que verifica el paso 6 con
`--full`.

**Marcha atrás a mitad**: el código se revierte con `git`. La migración **no**:
una vez aplicada, dar marcha atrás exige una migración inversa escrita a mano
(`DROP` de la columna, del índice y de la FK, y el `UNIQUE` de vuelta a índice
normal). Por eso el paso 1 va solo y se verifica solo. Si se decide abortar
después del paso 1, lo barato es dejar la columna puesta —no molesta a nadie— y
revertir el resto.

## Preguntas antes de aprobar

Las seis las respondió el humano el 2026-08-27, antes de firmar. Quedan escritas
aquí con su respuesta porque el plan que se firma tiene que ser el plan que se
leyó.

- **PP1 — Cómo se verifica el criterio 7 (`EXPLAIN` usa el índice).** No se puede
  ejecutar tal como está escrito: con un pedido en la base el plan es
  `Index Scan using Order_pkey` incluso forzando `enable_seqscan = off`.
  **Resuelto (a):** el fixture del proyecto `db` siembra ~500 pedidos de relleno
  de otro negocio, ejecuta `ANALYZE "Order"` y entonces el `EXPLAIN`; el plan
  nombra el índice sin tocar el planificador. El criterio literal no se toca
  (regla 3).

- **PP2 — En qué lenguaje va el script de acuñación.** **Resuelto (a):**
  scripts/mint-sync-token.ts (por crear), corrido con `tsx` vía
  `npm run mint:token`, importando `mintSyncToken` de `src/lib/syncAuth.ts` —
  la **misma** función que usa el guard, no una reimplementación. Precedente en
  el repo: `scripts/backfill-search-vector.ts`. **Cambia el literal `.mjs` de
  `spec.md` E23 y C5 a `.ts`**; el implementador actualiza esos dos literales al
  pasar.

- **PP3 — Sin cabecera `Authorization`, ¿401 o 503?** **Resuelto (a):** gana el
  503 cuando ningún negocio tiene hash, al coste de una sonda de configuración
  (`LIMIT 1`) en el camino de fallo. E2 y E3 de `spec.md` se reinterpretan como
  «no se ejecuta ninguna consulta de **resolución de negocio**». Motivo: «un
  token ausente jamás significa deja pasar todo» es la invariante que protege
  ADR 0008, y dejar mudo el error más probable —que nadie acuñó ningún token—
  sería peor.

- **PP4 — ¿Entra también el índice `(businessId, id)`?** **Resuelto (a): no
  ahora.** Con un pedido en la base es coste sin beneficio, y si existiera, el
  `EXPLAIN` de C7 nombraría **ese** índice y no el que el criterio pide. Si
  alguien mide latencia en el pull, el arreglo es añadirlo entonces.

- **PP5 — Los siete criterios nuevos.** **Resuelto: sí, se añaden a F-018.** El
  humano los incorpora a `.agent/features.json` como C10–C16 (regla 4), así que
  cuentan casilla para `sdd.sh done`. Sin ellos el feature podría cerrar sin
  haber probado nunca el 403 del negocio inactivo ni el backfill.

- **PP6 — El reuso de canónico huérfano.** Reformulada tras leer el código, y la
  primera versión de esta pregunta estaba mal planteada. Son **dos ramas
  distintas** de `resolveCanonicalIdentity` (`src/lib/canonical.ts:24`):

  - La rama **`by-ean`** fusiona canónicos entre negocios **a propósito**: es lo
    que F-015 construyó para el marketplace y lo que F-002 verificó (20
    productos → 17 canónicos). No se toca. El riesgo que el humano señaló —un
    negocio que pega el código de barras de un producto a otro que no lo es, y
    contamina el canónico compartido y su documento de búsqueda— es real pero es
    **un problema de producto, no de aislamiento**: acotarlo por negocio no lo
    arregla, lo desactiva. Queda como propuesta aparte, fuera de F-018.
  - La rama **huérfano** (`src/features/sync/server/handlers/product.ts:191`)
    hace `findFirst({ where: { externalId: payload.storeProductId } })` **sin
    acotar por tienda**. Como `StoreProduct.externalId` es único por tienda
    (`@@unique([storeId, externalId])`) y dos POS numeran sus productos desde 1,
    el mismo `externalId` en dos tiendas es lo normal: ese `findFirst` se lleva
    el canónico del primero que coincida.

  **Resuelto: se acota por `storeId`, y entra en F-018 (paso 3).** Por tienda y
  no por negocio, porque `(storeId, externalId)` es la clave real del producto:
  así arregla también el bug entre **dos sucursales del mismo negocio**, que
  existe hoy y no es una fuga entre inquilinos. No roza el marketplace: los
  huérfanos nacen con `isExclusive: true` y están excluidos de él por diseño.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-018 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-27T22:12:24Z — aprobado por el humano: «PP1 500 pedidos de relleno + ANALYZE. PP2 script .ts con tsx. PP3 gana el 503. PP4 no se anade (businessId, id) ahora. PP5 si, se anaden los siete criterios a F-018. PP6 acotar por tienda, entra en F-018; y lo del EAN sucio, propuesta aparte para decidir luego.»
