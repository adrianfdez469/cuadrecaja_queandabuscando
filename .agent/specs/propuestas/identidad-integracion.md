---
propuesta: identidad-integracion
agente: sdd-spec
actualizado: 2026-08-26T01:59:58Z
estado: propuesta
---

> Origen: revisión de arquitectura del 2026-08-25.
> Decisión de fondo en [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md).

## Problema

`/api/internal/*` autentica pero no autoriza. Dos consecuencias concretas:

- `src/features/orders/server/pull.ts` consulta `where: { id: { gt: since } }`.
  **Sin filtro por negocio**: devuelve los pedidos de todos los negocios a quien
  presente el token.
- Los handlers de `src/features/sync/server/handlers/` derivan `businessId` del
  **payload**, no del llamante.

Con un solo token global y un solo llamante no filtra nada hoy. Pero el modelo ya
promete lo contrario: `Business.syncTokenHash` está en el schema y
`src/lib/syncAuth.ts` exporta `hashSyncToken` documentado como «para que un token
por negocio se pueda rotar». Quien conecte esos dos cabos hereda una fuga entre
inquilinos sin saberlo.

## Alcance

### Dentro

- El guard resuelve el `Business` desde el hash del token y lo devuelve.
- `businessId` derivado del llamante en todos los handlers; el del payload solo
  se usa para comprobar coherencia.
- `pullOrders` filtrado por negocio.
- `Order.businessId` denormalizado con índice `(businessId, status, id)`.
- Rotación de token por negocio.

### Fuera (explícito)

- El paso a HMAC. Sigue siendo lo que dice [ADR 0008], con sus disparadores.
- La sesión del panel (`qab-admin-session`) y el SSO: son otro sistema (ADR 0005).

## Actores y precondiciones

El llamante es el cron de cuadrecaja. Precondición: cada `Business` tiene su
`syncTokenHash` poblado antes de activar la comprobación, o el sync se corta.

## Comportamiento esperado

- **E1** — Dado un token válido del negocio A, cuando se pide
  `GET /api/internal/orders`, entonces solo vuelven pedidos de tiendas de A.
- **E2** — Dado un token del negocio A y un payload con `businessId` de B,
  cuando se hace `POST .../sync/catalog`, entonces responde 403 y no escribe nada.
- **E3** — Dado un token que no corresponde a ningún negocio, entonces 401.
- **E4** — Dado que no hay `SYNC_TOKEN` ni ningún hash configurado, entonces 503,
  nunca 200 (invariante de ADR 0008 que no se debe perder).
- **E5** — Dado que se rota el token del negocio A, entonces el de B sigue
  funcionando.

## Reglas de negocio

- **R1** — La identidad sale del token. Un `businessId` de payload nunca la fija.
- **R2** — Un token ausente jamás significa «deja pasar todo».
- **R3** — El cursor del pull es **por negocio**.
- **R4** — La comparación del token sigue siendo en tiempo constante.

## Casos límite y errores

- Dos negocios con el mismo hash (no debería poder ocurrir: `@unique`).
- Token válido de un negocio `active: false`.
- Migración: qué pasa con el `SYNC_TOKEN` global mientras se puebla el resto.
- `Order` existentes sin `businessId` al aplicar la migración (backfill).

## Datos y contrato

Cambia el contrato con cuadrecaja: **el cursor deja de ser global**. Cuadrecaja
tiene que guardar un `ultimoPedidoVisto` por negocio, no uno solo. Hay que
reflejarlo en `docs/sync-contract.md` § ③④ Pedidos y § Autenticación.

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. Con el token de A, `GET /api/internal/orders` no devuelve ningún pedido cuya
   tienda pertenezca a B (verificado con dos negocios sembrados).
2. `POST .../sync/catalog` con token de A y `businessId` de B responde 403.
3. Token desconocido → 401. Sin configuración → 503.
4. Rotar el token de A no afecta a B.
5. `grep -n "payload.businessId" src/features/sync/server/handlers/` no aparece
   como origen de identidad en ningún `where` de resolución de negocio.
6. `EXPLAIN` del pull usa el índice `(businessId, status, id)`.
7. `bash .agent/verify.sh <id> --full` termina en 0.

## Incongruencias detectadas

- `src/features/orders/server/pull.ts`: `where: { id: { gt: since } }` sin
  `businessId`.
- `src/app/api/internal/_lib/guard.ts`: devuelve `NextResponse | null`, es decir
  un booleano disfrazado; no puede transportar identidad.
- `prisma/schema.prisma`: `Business.syncTokenHash` existe y no lo usa nadie.
- `src/lib/syncAuth.ts`: `hashSyncToken` exportado y sin llamantes.
- `Order` no tiene `businessId`; el índice `(status, id)` no cubre el filtro.

## Huecos y preguntas al humano

- **SP1** — ¿Token **por negocio** o un único token de plataforma? El ADR 0013
  elige por negocio porque el modelo ya lo insinuaba. Si prefieres plataforma, la
  decisión es igual de válida **pero hay que borrar** `syncTokenHash` y
  `hashSyncToken`, no dejarlos como trampa. Es la única decisión de esta tanda que
  tomé por ti: dilo y se cambia.
- **SP2** — ¿La migración puede hacerse con corte de sync o tiene que convivir?
  Recomendación: aceptar los dos esquemas durante una ventana, con el token global
  como respaldo, y retirarlo cuando todos los negocios tengan el suyo.

## No decidido a propósito

El mecanismo de entrega del token a cada negocio. Es operativa de cuadrecaja.
