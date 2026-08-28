# 0013 — La identidad del llamante sale del token, nunca del payload

**Aceptada** · 2026-08-25

## Contexto

`/api/internal/*` se autentica con un `SYNC_TOKEN` global comparado en tiempo
constante ([ADR 0008](0008-bearer-token-baseline.md)). Autenticar y **autorizar**
no son lo mismo, y hoy solo se hace lo primero:

- `src/features/orders/server/pull.ts` consulta `where: { id: { gt: since } }`.
  Sin filtro por negocio: devuelve los pedidos de **todos** los negocios.
- Los handlers de `src/features/sync/server/handlers/` toman `businessId` **del
  payload** (`where: { externalId: payload.businessId }`), no de quién llamó.

Con un único token y un único llamante —el cron de cuadrecaja como SaaS— eso es
coherente y no filtra nada. El problema es que el modelo ya promete otra cosa:
`Business.syncTokenHash` existe en el schema y `lib/syncAuth.ts` exporta
`hashSyncToken` documentado como «para que un token por negocio se pueda rotar».
Quien cablee esos dos cabos va a asumir que el scoping existe. No existe.

## Decisión

**Un token por negocio**, y tres consecuencias que no se pueden separar:

1. El guard resuelve el `Business` a partir del hash del token presentado y lo
   devuelve. Deja de ser un booleano.
2. `businessId` se deriva **siempre** de ahí. Un `businessId` que llegue en el
   payload y no coincida con el autenticado es un `403`, no un dato.
3. `pullOrders` filtra por ese negocio, y `Order` lleva `businessId`
   denormalizado con índice `(businessId, status, id)`.

## Por qué el token por negocio

Porque el modelo ya lo asumía a medias, y una promesa a medias en el código de
autenticación es peor que no hacerla. Rotar el token de un negocio comprometido
sin cortarle el sync a los demás es además lo mínimo que se le pide a un sistema
multi-inquilino.

La alternativa —un solo token de plataforma, con cuadrecaja como único
integrador— también es defendible, pero entonces `Business.syncTokenHash` y
`hashSyncToken` sobran y hay que **borrarlos**, no dejarlos como trampa.

## Por qué el `businessId` denormalizado

Sin él, paginar por negocio es
`WHERE store.businessId = $1 AND status = 'PENDING' AND id > $2`: un join que el
índice `(status, id)` no cubre. Es barato ahora y caro cuando haya volumen.

## Consecuencia

El cursor del pull deja de ser global y pasa a ser **por negocio**. Cuadrecaja
tiene que guardar un `ultimoPedidoVisto` por cada uno, no uno solo.

Esta ADR sustituye el mecanismo de [ADR 0008](0008-bearer-token-baseline.md) —
un secreto único de plataforma pasa a ser un token por negocio, resuelto
contra `Business.syncTokenHash`— sin tocar su camino a HMAC ni sus
disparadores: siguen siendo la siguiente etapa de autenticación, encima de
esta identidad, no un sustituto de ella.
