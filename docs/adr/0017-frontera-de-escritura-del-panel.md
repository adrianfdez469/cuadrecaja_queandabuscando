# 0017 — La frontera de escritura del panel, el estado compartido de la tienda, y el descuento dentro de `unitPrice`

**Propuesta** · 26 de agosto de 2026 · F-011

Tres decisiones que se toman juntas porque las tres definen lo mismo: **quién es
dueño de qué columna** cuando hay tres escritores —el sync, el panel y el
checkout— sobre las mismas tablas.

## Contexto

`Store` y `StoreProduct` son espejos de cuadrecaja y el sync escribe casi toda la
fila. `src/features/sync/server/handlers/store.ts:44-58` pone `name`,
`description`, `address`, `phone`, `whatsapp` y `email` en **todo** evento
`STORE`, y en las líneas 78-88 fija además `status: "PUBLISHED"` y `publishedAt`.
A diferencia del handler de producto, el de tienda **no tiene guarda
anti-rancio**: no existe `Store.sourceUpdatedAt` contra el que comparar, así que
no hay «la última escritura gana» posible. Lo que el panel escribiera en una
columna del sync desaparece en el siguiente evento del POS, sin error y sin
rastro.

Al mismo tiempo, F-011 tiene que dejar que el negocio vista su vitrina, y las
promociones tienen que llegar hasta el importe cobrado sin romper lo que el POS
ya lee por el pull de pedidos.

## Decisión (a) — el panel escribe una lista blanca de columnas, y nada más

**El panel nunca comparte columna con el sync.** En `StoreProduct` la frontera ya
está declarada en el schema (`prisma/schema.prisma:257-272`, bloques «owned by
the sync» y «owned by the admin panel») y el handler la respeta
(`handlers/product.ts:83-86`). Esta ADR la convierte en algo que no depende de
recordarla:

- Todas las escrituras del panel viven en **un solo módulo**
  (`src/features/admin/server/mutations.ts`).
- El `data` de cada `UPDATE` está tipado con una lista blanca:

  ```ts
  type PanelProductColumn =
    | "description"
    | "imageUrls"
    | "priceOverride"
    | "priceOverrideCurrency"
    | "visible"
    | "featured";
  type PanelProductWrite = Pick<Prisma.StoreProductUpdateInput, PanelProductColumn>;
  ```

  Poner `syncedPrice`, `localName`, `availability`, `sourceUpdatedAt` o
  `deletedAt` en una escritura del panel es un **error de compilación**, no un
  descuido que se descubre en producción. La lista de `Store` es su propia lista
  —`status` y las tres columnas de motivo, y nada más— por la decisión (c).

**Sobre `publishedAt` manda el sync**, y el panel no lo escribe nunca: significa
«cuándo este negocio se dio de alta en la vitrina», no «cuándo abrió hoy».

**Sobre `status` mandaban los dos, y eso es la decisión (c).** Una versión
anterior de esta ADR decía que `status` era del sync y que el panel no lo tocaba
jamás; el argumento era bueno —el handler lo reescribe en cada evento, así que un
cambio del panel se perdía— pero el producto pedía otra cosa. Se reemplaza por
(c), que resuelve el argumento en vez de esquivarlo.

**El precio sigue el patrón de [ADR 0007](0007-price-override.md)**, que ya lo
decidió: `priceOverride ?? syncedPrice`, encapsulado en `lib/pricing.ts`, y
mientras exista un override el sync no lo pisa. Con una regla que ADR 0007 no
podía anticipar: al guardar un override, el panel escribe **siempre** un
`priceOverrideCurrency` explícito, igual al `syncedPriceCurrency` del producto en
ese momento. `lib/pricing.ts:35` deja que un override sin moneda herede la
sincronizada, y eso convertiría un cambio de moneda en el POS en un cambio
silencioso del importe cobrado. Quitar el override pone las dos columnas a `null`.

### Lo que esta decisión NO hace, y por qué

**El panel no edita hoy branding ni contacto de la tienda.** El diseño existía
—cuatro columnas de override en `Store` (`descriptionOverride`, `phoneOverride`,
`whatsappOverride`, `emailOverride`) y la precedencia encapsulada en un módulo
gemelo de `lib/pricing.ts`— y se **detuvo** por decisión del humano, por dos
motivos distintos que conviene no confundir:

- El contacto y la descripción quedan en modo lectura por alcance: se prefirió
  una entrega más corta.
- El branding (`Store.themeTokens`) espera a
  [ADR 0012](0012-storefront-sobre-store.md), donde la marca (`Storefront`) pasa
  a poseer slug, branding y contacto. Construir el editor sobre `Store` habría
  significado moverlo de tabla poco después.

Queda escrito para que nadie lo lea como un olvido: cuando `Storefront` llegue,
el mecanismo a usar es el de ADR 0007 aplicado a la tienda —columnas de override
propiedad del panel, precedencia en un solo módulo, handler del sync intacto—,
que es la única forma de satisfacer a la vez «el panel edita contacto» y «el sync
se queda como está».

## Decisión (b) — el descuento va dentro de `unitPrice`; `originalUnitPrice` no cambia de significado

Una promoción baja el precio de una línea. Hay dos formas de contarlo y solo una
no rompe nada.

**Lo que se hace**: el descuento se aplica **sobre el precio efectivo y antes de
convertir a la moneda del pedido**, y el resultado es lo que se cobra:

```
effectivePrice(product)          → moneda del producto   (priceOverride ?? syncedPrice)
applyPromotion(...)              → moneda del producto   (el descuento entra aquí)
convert(..., orderCurrency)      → moneda del pedido     (lo que se persiste en unitPrice)
```

- `OrderItem.unitPrice` lleva el descuento dentro (nunca un desglose por línea).
- `OrderItem.originalUnitPrice` sigue significando **exactamente** lo que dice
  `prisma/schema.prisma:432`: el precio efectivo _antes de convertir_. Con
  promoción, el precio efectivo es el descontado.
- `Order.subtotal` sigue siendo `Σ lineTotal`, `Order.discountTotal` lleva **solo**
  el descuento de alcance `ORDER`, y `total = subtotal - discountTotal + deliveryFee`.

**Por qué el orden importa tanto.** `docs/sync-contract.md:331` publica al POS la
fórmula

```
unitPrice = convert(originalUnitPrice, currencyCode, rateSnapshot.rates)
```

Descontar _después_ de convertir haría que esa fórmula dejara de dar el mismo
céntimo, y eso es una **v3 del contrato**, coordinada con el equipo de
cuadrecaja. No se toma de pasada. Con este orden, el contrato no cambia de
versión: las dos claves que el desglose necesitaría —`subtotal` y
`discountTotal`— ya están publicadas y `Order.discountTotal` ya viaja en el pull
(`src/features/orders/server/pull.ts:84`).

**Consecuencia asumida**: el POS ve un precio más bajo y **ninguna explicación de
por qué**. Se acepta a cambio de no versionar el contrato. Si el POS necesita el
desglose por línea, es un feature de contrato con su coordinación, no un ajuste
de este.

**El precio de lista no se persiste.** No hay columna para él,
`originalUnitPrice` está ocupada con otro significado que el POS lee, y ningún
criterio pide auditar el precio anterior de un pedido ya cerrado. El tachado que
ve el comprador es un dato de presentación, calculado en el momento. Si algún día
hace falta auditarlo, la migración es aditiva (`OrderItem.listUnitPrice` y
`promotionId`).

**La moneda de `Promotion.value`, por convención y sin columna nueva.**
`prisma/schema.prisma:327` es `Decimal(14,2)` a secas y una tienda puede tener
productos en varias monedas. Convención: `PERCENTAGE` es adimensional; `FIXED` se
interpreta en `Business.baseCurrencyCode` y se convierte a la moneda de la línea
con `lib/money.ts` y las mismas tasas que el resto del cálculo. Si falta la tasa,
**la promoción se ignora y se registra**: nunca lanza y nunca cobra de más sin
avisar. Añadir `Promotion.valueCurrency` seguiría siendo una migración aditiva si
más adelante se prefiere explícito.

## Decisión (c) — `Store.status` es un estado compartido, y el panel lo escribe

El negocio necesita cerrar su vitrina al público —vacaciones, inventario, una
reforma— y verlo reflejado en el acto, con un motivo que el comprador entienda.

**Un solo estado, el que ya existe.** Se reutiliza `Store.status`
(`DRAFT`/`PUBLISHED`/`SUSPENDED`) y lo escriben **los dos**: el panel por el
interruptor, y el sync cuando el negocio retira su opt-in en el POS. No se añade
un cuarto valor de enum para distinguir «cerrada por el negocio» de «retirada por
el POS»: renderizan igual, y lo que las distingue es el motivo, que tiene sus
propias columnas (`disabledReasonCode`, `disabledMessage`, `disabledAt`).

**Cerrada no es inexistente.** `SUSPENDED` responde **200** con el nombre del
negocio, su marca y el motivo; sin catálogo, sin carrito, y el checkout rechaza
con `409 STORE_CLOSED`. La página de un pedido ya hecho **sigue accesible**: quien
tiene un pedido en curso no puede perder su comprobante porque la tienda cerró.
`DRAFT` sí es 404: nunca fue pública y no hay URL que honrar.

**El motivo se pinta como texto, nunca como HTML.** Lista fija de códigos en
`src/constants/` (no un enum de Prisma: la lista es copy de producto y el POS
puede mandar un motivo que no esté en ella, y un valor desconocido llegando a un
enum de base rompería la escritura del sync) más un texto corto opcional del
negocio, validado en longitud.

**Quién gana cuando los dos escriben: el último.** Es la decisión del humano y se
respeta. Tiene dos consecuencias que esta ADR deja **explícitamente abiertas**,
porque no son del arquitecto:

1. Hoy el handler escribe `status: "PUBLISHED"` en **todo** evento con
   `publishToStore: true`, incluido el que llega porque alguien cambió el teléfono
   en el POS. Con «gana el último» tal cual, un cierre del panel se deshace con la
   siguiente edición rutinaria de la tienda en el POS. La alternativa es que el
   POS solo escriba el estado cuando **su** opt-in cambia, guardando el último
   valor visto en una columna. Está sin decidir (AP5 de
   `.agent/specs/F-011/architecture.md`).
2. `Store` no tiene marca de tiempo de origen, así que un evento reencolado del
   outbox puede resucitar una tienda recién cerrada. El payload de `STORE` **ya
   trae `updatedAt`** (`src/features/sync/schemas.ts:42`), así que el guarda
   anti-rancio no cuesta contrato: es una columna y la misma comparación que ya
   hace `handlers/product.ts:46`. Está sin decidir (AP6).

Quien lea esta ADR después: si esas dos preguntas ya se contestaron, la respuesta
está en el progreso de F-011 y **esta sección hay que actualizarla**, no
interpretarla.

**El interruptor entra por el mismo sitio que todo lo demás**: un route handler
bajo `/api/admin/`, el mismo guard, el mismo módulo de escritura y la misma
revalidación por tag, que es lo que hace que cerrar y abrir se vean sin esperar el
piso de ISR.

**Retroactivo.** La migración que introduce el interruptor deja deshabilitadas
también las tiendas que ya existían. En un entorno con tiendas vivas eso apaga
todas las vitrinas a la vez y cada negocio tiene que volver a abrir la suya: es el
efecto buscado, no un descuido, y por eso está escrito aquí.

## Cómo se hace cumplir

- Una sola lista blanca por tabla, en tipos, en un solo módulo de escritura. Con
  (c) esa lista incluye `status` y las tres columnas de motivo, y **excluye**
  `publishedAt`: el test de fronteras comprueba que `status` aparece solo en la
  mutación del interruptor.
- Un solo compositor de precio (`resolvePrice` en `src/lib/pricing.ts`) que usan
  la vitrina y el pedido: no hay dos implementaciones que puedan divergir.
- Un test que fija que sin promociones el precio es idéntico al de antes, y otro
  que fija la fórmula del contrato sobre `beforeConversion`.
- Un test de fronteras que comprueba que `status` y `publishedAt` no aparecen en
  el módulo de escritura del panel.

## Alternativas descartadas

- Que el panel escriba las columnas del sync **de contenido**: se pierde al
  siguiente evento. (Para `status`, ver (c): ahí el conflicto se resuelve, no se
  evita.)
- Un estado propio del panel además del del sync, con la vitrina abierta solo si
  los dos dicen sí: descartado por el humano, por no multiplicar estados que el
  negocio no puede ver por separado.
- Un valor de enum nuevo para «cerrada por el negocio»: dos estados que renderizan
  igual y una comprobación de dos valores en cada lectura.
- Añadir `Store.sourceUpdatedAt` y una guarda anti-rancio: convierte el conflicto
  en «gana el más reciente», que para un texto escrito a mano es otra forma de
  perderlo, y toca el handler del sync.
- Dejar de sincronizar esas columnas: rompe la tienda recién creada.
- Desglosar el descuento por línea hacia el POS: v3 del contrato.
- Descontar después de convertir: rompe la fórmula publicada.

## Consecuencias

- El panel y el sync pueden escribir la misma fila a la vez sin bloqueo y sin
  `$transaction` —lo que además evita el pooler en modo transacción.
- Los importes de un pedido creado no se recalculan nunca: cambiar o borrar una
  promoción después no los toca.
- Un borde de ventana de promoción se ve con hasta 3600 s de retardo en la
  vitrina cacheada; el checkout recalcula en caliente y el desajuste ya responde 409.
- Una tienda cerrada conserva su URL, su marca y sus pedidos: nada de lo que el
  comprador ya tenía se rompe, y el buscador encuentra una página real en vez de
  un 404. A cambio, mientras está cerrada va con `noindex` y sale del sitemap.

## Reabrir cuando

- Se contesten AP5 o AP6: la sección (c) se actualiza con la semántica elegida,
  y deja de ser una decisión con dos huecos.
- Llegue `Storefront` ([ADR 0012](0012-storefront-sobre-store.md)): branding y
  contacto suben de tabla y el editor del panel se construye allí, con el
  mecanismo de override descrito arriba.
- El POS pida el desglose del descuento: es una versión nueva de
  `docs/sync-contract.md`, coordinada con el otro equipo.
