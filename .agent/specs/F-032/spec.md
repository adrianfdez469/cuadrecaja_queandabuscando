---
feature: F-032
agente: sdd-spec
actualizado: 2026-09-01T20:47:59Z
estado: listo
---

## Problema

Cinco columnas de `Store` deciden cómo se compra en una tienda —`checkoutMode`,
`deliveryEnabled`, `deliveryFee`, `deliveryFeeMode` y `orderExpiryHours`
(`prisma/schema.prisma`, bloque de `Store`)— y hoy **no las escribe nadie salvo
el seed**. No viajan por el sync (`storePayloadSchema` no las declara, y el
objeto `common` de `src/features/sync/server/handlers/store.ts` es una lista
explícita de columnas que no las incluye) y no hay pantalla que las exponga
(`grep` en `src/features/admin/` no devuelve ninguna). Poner una tienda en envío
cotizado exige hoy un `UPDATE` a mano contra la base, escrito paso a paso en
`docs/despliegue.md` § 9.5.

Consecuencia práctica: F-031 construyó el envío cotizado y **nadie puede
activarlo sin acceso a Postgres**. El negocio configura su tienda en cuadrecaja;
que una parte de esa configuración solo exista aquí y solo se cambie con SQL es
un estado de tránsito, no el diseño.

## Alcance

### Dentro

- Llevar las cinco columnas al `payload` de `STORE` del sync, **planas**
  (al mismo nivel que `name`/`address`/`phone`) y las cinco **opcionales**.
- La regla que manda: **omitir no es apagar**. Un evento que no trae un campo
  deja esa columna exactamente como estaba.
- La validación que produce `400` sobre el lote entero, en el schema Zod, porque
  es lo único que corre antes de `processCatalogBatch`.
- La guarda de consistencia del criterio 5 (domicilio con tarifa fija y sin
  importe), en sus dos mitades: la que se ve en el payload y la que solo se ve
  contra la fila.
- La v7 de `docs/sync-contract.md`: payload, tabla de propiedad de campos,
  vocabulario de errores y «Cambios requeridos en cuadrecaja».
- El cambio de dueño de `orderExpiryHours`, con su ADR y con la corrección del
  comentario de `prisma/schema.prisma` que hoy dice lo contrario.
- Las banderas nuevas de `scripts/send-catalog-batch.mjs`, que es el
  instrumento con el que se verifican casi todos los criterios.
- Reescribir `docs/despliegue.md` § 9.5, que documenta el `UPDATE` a mano.

### Fuera (explícito)

Copiado de las `notes` del feature, sin ampliarlo:

- **`Store.timezone` y el resto de F-022.** La tabla de propiedad exhaustiva de
  _cada_ campo de `Store` y `StoreProduct` es su criterio 4; aquí se escriben
  **las filas de estas cinco**, no la tabla entera.
- **Pantalla de panel.** La decisión SP3 de F-031 se mantiene: no hay editor, y
  el panel sigue sin tocar ninguna de las cinco (ADR 0017 (a) se cumple, no se
  contradice).
- **Tocar el bucle de renegociación de F-019.** `orderExpiryHours` cambia de
  dueño; lo que hace con ese número (`src/features/orders/server/expiry.ts`,
  `src/features/orders/server/proposal.ts`) no se toca.
- **Sincronizar el umbral de stock bajo.** Por ADR 0003 se queda en cuadrecaja.
- **Reparar filas ya inconsistentes.** Nada de lo que este feature hace corrige
  hacia atrás una tienda que hoy tenga `deliveryEnabled = true`, `FLAT_RATE` y
  `deliveryFee` nula (R18); el criterio 10 exige justamente que ninguna fila
  existente cambie.
- **Que cuadrecaja lo emita.** Es una dependencia fuera de este repo. Mientras
  no lo haga, aquí no cambia nada —esa es toda la gracia de R1— y la
  verificación se hace con lotes simulados, como en F-005.

## Actores y precondiciones

| Actor                            | Qué hace                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| cuadrecaja (POS)                 | Emite eventos `STORE` con `POST /api/internal/sync/catalog`, autenticado con el token de su negocio |
| `scripts/send-catalog-batch.mjs` | Sustituye al POS mientras no exista: es el actor real de casi toda la verificación                  |
| El comprador                     | Ve el efecto en el checkout (`POST /api/orders/quote`) sin reiniciar nada                           |
| El panel                         | **No participa**: no lee ni escribe estas columnas                                                  |

Precondiciones: el negocio tiene token acuñado (F-018); la tienda existe o la
crea el mismo evento; F-031 está en `passes: true`, así que `DeliveryFeeMode`
existe en el schema y `isDeliveryOffered` ya es el único lugar donde se decide
si se ofrece domicilio (`src/features/orders/deliveryOffer.ts`).

## Comportamiento esperado

**E1 — Omitir no es apagar.**
Dado que `tienda-demo` tiene `checkoutMode = ONSITE`, `deliveryEnabled = true`,
`deliveryFee = 500.00`, `deliveryFeeMode = QUOTED_PER_ORDER` y
`orderExpiryHours = 6` (valores distintos de los defaults),
cuando llega un evento `STORE` válido que **no trae ninguna** de las cinco
claves,
entonces la respuesta es `207` con `status: "processed"` para ese evento y las
cinco columnas quedan **byte a byte** como estaban.

**E2 — Traerlas las aplica, en caliente.**
Dado ese mismo evento pero con las cinco claves presentes y distintas,
cuando el lote responde `207 processed`,
entonces la fila tiene los cinco valores nuevos y
`POST /api/orders/quote` con `{ "storeSlug": "tienda-demo", "items": [...] }`
devuelve en `store` los `deliveryEnabled`, `deliveryFee`, `deliveryFeeMode` y
`checkoutMode` nuevos, **sin reiniciar el servidor** (la ruta es
`dynamic = "force-dynamic"` y `quoteCart` no cachea nada).

**E3 — Subconjunto.**
Cuando el evento trae solo `deliveryFee`,
entonces cambia solo `deliveryFee`; las otras cuatro quedan intactas.

**E4 — `null` explícito en `deliveryFee` escribe NULL.**
Dado `deliveryFee = 500.00` en la fila,
cuando llega `"deliveryFee": null` (junto a `"deliveryFeeMode":
"QUOTED_PER_ORDER"` o sobre una fila que ya está en ese modo),
entonces la columna queda `NULL`. Es la única forma que tiene el POS de vaciar
el importe al pasar a cotizado.

**E5 — `null` en cualquiera de las otras cuatro es un error de tipo.**
Cuando el evento trae `"checkoutMode": null`, `"deliveryEnabled": null`,
`"deliveryFeeMode": null` u `"orderExpiryHours": null`,
entonces la respuesta es `400 INVALID_BATCH` con su `issues`, el lote entero se
rechaza y no se escribe ninguna fila ni ninguna `SyncEvent`.

**E6 — Valor inválido: `400` y el lote entero cae.**
Cuando el evento trae cualquiera de estos,
`"deliveryFee": 12.345` · `"deliveryFee": -1` · `"deliveryFee": 1e13` ·
`"orderExpiryHours": 0` · `"orderExpiryHours": -3` ·
`"orderExpiryHours": 2.5` · `"orderExpiryHours": 9000` ·
`"deliveryFeeMode": "PER_KM"` · `"checkoutMode": "TELEGRAM"`,
entonces la respuesta es `400 INVALID_BATCH`, ninguna fila de `Store` se toca y
ninguna `SyncEvent` queda escrita — ni la del evento malo ni la de los demás
eventos válidos del mismo lote.

**E7 — Contradicción que el payload determina solo.**
Cuando el evento trae a la vez `"deliveryEnabled": true`,
`"deliveryFeeMode": "FLAT_RATE"` y `"deliveryFee": null`,
entonces la respuesta es `400 INVALID_BATCH`: es contradictorio en sí mismo, sin
mirar la base.

**E8 — Contradicción que solo se ve contra la fila.**
Dado que la fila tiene `deliveryFeeMode = FLAT_RATE` y `deliveryFee = NULL`,
cuando llega un evento con **solo** `"deliveryEnabled": true`,
entonces ese evento responde `status: "failed"` dentro del `207`, con el error
`STORE_DELIVERY_CONFIG_INCONSISTENT`; **ninguna** de las cinco columnas cambia,
`sourceUpdatedAt` **no** avanza, y los demás eventos del lote se procesan
normalmente.

**E9 — Rancio.**
Cuando llega un evento `STORE` con `updatedAt` anterior o igual al
`sourceUpdatedAt` guardado y con las cinco claves cargadas de valores nuevos,
entonces responde `status: "stale"` y **ninguna** de las cinco se escribe. La
guarda anti-rancio es el único árbitro también para la configuración: no existe
marca de «configurada a mano» ni forma de liberarla (decisión SP3 del humano).

**E10 — Un evento que despublica también configura.**
Cuando llega `"publishToStore": false` con alguna de las cinco claves,
entonces la tienda queda `SUSPENDED` (si el opt-in cambió) **y** las claves
presentes se aplican. La configuración es dato de la tienda, no de su
publicación.

**E11 — Un `DELETE` no configura.**
Cuando llega `operation: "DELETE"`,
entonces se comporta como hoy (unpublish) y **no escribe ninguna** de las cinco,
aunque el payload las traiga.

**E12 — Tienda que no existe y que no se publica.**
Cuando llega `publishToStore: false` para un `storeId` sin fila,
entonces sigue respondiendo `skipped_not_published` y no se escribe nada,
igual que hoy.

**E13 — Tienda nueva.**
Cuando el primer evento de un `storeId` desconocido llega con
`publishToStore: true`,
entonces se crea la tienda con las claves presentes y con **los defaults de la
columna** para las ausentes (`WHATSAPP`, `false`, `NULL`, `FLAT_RATE`, `24`), y
la guarda de E7/E8 se evalúa contra esos defaults.

**E14 — Compatibilidad hacia atrás.**
Cuando llega un lote con la forma exacta de la v6 (ninguna de las cinco claves
en ningún evento `STORE`),
entonces responde `207` con `status: "processed"` por evento, sin `issues` y sin
avisos: el cambio es aditivo en el cable.

**E15 — Colisión de negocio.**
Cuando el `externalId` de la tienda pertenece a otro negocio,
entonces sigue devolviendo `skipped`, sin evaluar ni escribir configuración.

**E16 — El panel sigue fuera.**
Cuando se busca cualquiera de las cinco en `src/features/admin/`,
entonces no aparece ninguna escritura, y una futura sí rompe el test de
fronteras (`src/features/admin/server/boundaries.test.ts`), no la revisión.

## Reglas de negocio

**R1 — Las cinco son opcionales y ausente significa «no toques esa columna».**
Es la regla que domina todas las demás: hoy el POS que existe no conoce ninguna
de las cinco, y cualquier otra semántica devolvería a los defaults la
configuración de cada tienda en el primer evento rutinario.

**R2 — Viajan planas** en el `payload` de `STORE`, con estos nombres exactos y
sin objeto anidado: `checkoutMode`, `deliveryEnabled`, `deliveryFee`,
`deliveryFeeMode`, `orderExpiryHours`.

**R3 — `null` solo tiene significado en `deliveryFee`.** `deliveryFee: null`
escribe `NULL`. En las otras cuatro, `null` es un **error de tipo** y produce
`400` (E5): la columna no es anulable, así que traducir `null` a «el default» o
a «como si no viniera» sería inventar una semántica que nadie pidió y que el POS
no puede distinguir de un bug suyo. En Zod: las cuatro son `.optional()`, nunca
`.nullish()`; `deliveryFee` es `.nullish()`.

**R4 — Toda la validación de valor vive en el schema Zod, no en el handler.**
`src/app/api/internal/sync/catalog/route.ts` hace `safeParse` y devuelve `400
INVALID_BATCH` **antes** de llamar a `processCatalogBatch`; cualquier
comprobación puesta en el handler produciría un `failed` dentro de un `207`, que
es lo contrario de lo que decidió el humano en SP1. Esto es un requisito, no una
sugerencia (cierra SP4).

**R5 — Rangos y vocabularios, exactos:**

| Campo              | Tipo en el cable | Rango válido                                    | Por qué ese límite                                                                                                                                                                                                                                                      |
| ------------------ | ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkoutMode`     | string           | `"WHATSAPP"` \| `"ONSITE"`                      | El vocabulario **es** el enum `CheckoutMode` de Prisma; un valor fuera de él rompería la escritura                                                                                                                                                                      |
| `deliveryEnabled`  | boolean          | `true` \| `false`                               | Sin coerción: `"true"`, `1` y `"1"` son `400`                                                                                                                                                                                                                           |
| `deliveryFee`      | number \| null   | `>= 0`, **≤ 2 decimales**, `<= 999999999999.99` | La columna es `Decimal(14,2)`: más decimales se redondearían en silencio y un importe mayor da `numeric field overflow` (Postgres 22003), que sería un `500`                                                                                                            |
| `deliveryFeeMode`  | string           | `"FLAT_RATE"` \| `"QUOTED_PER_ORDER"`           | El enum `DeliveryFeeMode` que introdujo F-031                                                                                                                                                                                                                           |
| `orderExpiryHours` | number entero    | `>= 1` y `<= 8760`                              | `0` o negativo vencería todo pedido al crearlo. El techo son 365 días: `expiry.ts` y `proposal.ts` hacen `now() ± make_interval(hours => …)` y un valor cerca de `INT_MAX` saca el timestamp de rango y **rompe el barrido de vencimientos entero**, no solo esa tienda |

`deliveryFee: 0` es **válido y no contradictorio**: significa envío gratis. Lo
que falta en el criterio 5 es `NULL`, no el cero.

**R6 — El tipo del importe es `number`, no string.** Es lo que ya hace el otro
importe que entra por este endpoint (`price` en `productPayloadSchema`). Los dos
decimales del cable de la v6 son del **pull** de pedidos, la dirección
contraria; mezclarlos aquí obligaría al POS a serializar distinto según el
endpoint.

**R7 — La guarda de consistencia se evalúa sobre el _valor efectivo_.**
`efectivo(campo)` = el valor del payload si la clave está presente; si no, el de
la fila existente; si la fila no existe, el default de la columna.

**R8 — El invariante que se protege es uno solo:** una fila escrita por el sync
nunca queda con
`deliveryEnabled = true` **y** `deliveryFeeMode = FLAT_RATE` **y**
`deliveryFee IS NULL`. Es exactamente el caso en que `isDeliveryOffered`
devuelve `false` teniendo el domicilio encendido: una tienda que dice ofrecer
domicilio y no tiene con qué cobrarlo.

**R9 — La guarda solo se evalúa si el evento _toca_ la terna.** Si el payload no
trae ninguna de `deliveryEnabled`, `deliveryFeeMode` ni `deliveryFee`, no se
comprueba nada. Sin esta regla, una tienda que ya esté en violación (por un
`UPDATE` a mano anterior) haría fallar cualquier evento `STORE` posterior aunque
no hablara de envío, y «omitir no es apagar» se convertiría en «omitir hace
fallar».

**R10 — La guarda tiene dos mitades, y la partición no es negociable.**

1. Lo que el payload determina **solo** —`deliveryEnabled: true` ∧
   `deliveryFeeMode: "FLAT_RATE"` ∧ `deliveryFee: null` explícito— es un
   `refine` de Zod: `400`, lote entero (E7).
2. Lo que **necesita la fila** —cualquier otra combinación de claves presentes
   que produzca el estado de R8 al mezclarse con lo guardado— se comprueba en el
   handler, después de leer `existing` y **antes de cualquier escritura sobre
   `Store`**: el evento se reporta `failed` dentro del `207` (E8).

Un `refine` de Zod no ve la base de datos, y las dos formas realistas del error
—«enciendo el domicilio y olvido la tarifa», «paso a tarifa fija y no pongo
importe»— son precisamente las que dependen de la fila. Una guarda solo-payload
no cubriría el criterio 5; una guarda solo-handler no puede dar `400`. Van las
dos.

**R11 — Un evento rechazado por R10.2 no escribe nada, `sourceUpdatedAt`
incluido.** Si avanzara, el reenvío corregido con el mismo `updatedAt` leería
`stale` y la corrección se perdería en silencio.

**R12 — Un evento `failed` no es un duplicado.** Vale aquí lo que ya dice
`src/features/sync/server/inbox.ts`: el POS lo reintentará. La consecuencia
asumida es que un payload contradictorio se reintenta indefinidamente hasta que
alguien lo corrija en el POS; es un error de configuración, no transitorio, y va
documentado como riesgo operativo.

**R13 — Idempotencia y orden de entrega intactos.** El mismo evento aplicado dos
veces deja la misma fila; la guarda anti-rancio sigue siendo la única razón por
la que el orden no importa (AGENTS.md § «Cosas que muerden»).

**R14 — Un evento que despublica sí configura; un `DELETE` no** (E10, E11). El
`DELETE` no tiene `publishToStore` propio y su payload de configuración no
significa nada.

**R15 — El dueño de las cinco pasa a ser cuadrecaja, y el panel sigue sin
tocarlas.** Esto **cumple** ADR 0017 (a) —«el panel nunca comparte columna con
el sync»— en vez de contradecirlo. Lo que sí invierte es F-019 R20 y la línea
del contrato que lo publicó: `orderExpiryHours` deja de ser de queandabuscando.

**R16 — El seed sigue siendo escritor de las cinco, a propósito.** `prisma/seed.ts`
las escribe en `create` **y** en `update` (son sus fixtures de F-010/F-031). No
se cambia: el seed es un actor de desarrollo, no un tercer dueño en producción.
Consecuencia operativa que la verificación tiene que respetar: **`npm run seed`
entre la lectura «antes» y la «después» invalida el criterio 1**, porque
reescribe las cinco y adelanta `sourceUpdatedAt`.

**R17 — Ningún cambio de estructura en la base.** Las cinco columnas ya existen
y el enum también. El único cambio en `prisma/schema.prisma` es el **comentario**
de `orderExpiryHours` (criterio 8), que no produce SQL. **Este feature no crea
ninguna migración**; el criterio 10 se verifica igual (conteo por columna antes y
después del despliegue del código), pero no hay `migration.sql` que revisar y no
hay que acercarse a `prisma migrate dev`, que en este repo propone borrar cinco
índices que el schema no representa.

**R18 — No se repara nada hacia atrás.** Las filas que hoy violen R8 se quedan
como están hasta que un evento las toque.

**R19 — El vocabulario no se copia a mano.** `CheckoutMode` y `DeliveryFeeMode`
salen de `src/generated/prisma/enums.ts`; una lista de literales duplicada en
`schemas.ts` es una magic string de las que prohíbe AGENTS.md y se desincroniza
en el primer valor nuevo.

**R20 — El instrumento de verificación crece con el feature.**
`scripts/send-catalog-batch.mjs` hoy envía **solo** un evento `PRODUCT`; sin
tocarlo, ninguno de los criterios 1, 2, 4, 5 y 6 se puede ejecutar. Tiene que
ganar un evento `STORE` y banderas para cada caso (§ Datos y contrato).

**R22 — El criterio 2 no pide invalidación de caché nueva, y hay que decirlo
para no inventarla.** La configuración llega al checkout por
`POST /api/orders/quote`, que es `dynamic = "force-dynamic"` y cuyo `quoteCart`
no cachea nada («Nothing here is cached: every read is fresh, on purpose»), así
que el efecto es inmediato sin tocar ningún tag. Ninguna página ISR imprime
estas cinco columnas: la página del pedido lee `checkoutMode` en caliente y los
importes que pinta son del `Order`, no del `Store`. El evento `STORE` procesado
ya revalida el slug de la tienda y los de sus hermanas como hasta hoy, y si algo
hubiera que revalidar de más se llama a `expandBrandTouch()`, nunca se arma el
array a mano (ficha
`revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado`).

**R21 — El evento `STORE` del guion tiene que llevar los campos de contacto de
la tienda sembrada.** El objeto `common` del handler escribe `payload.x ?? null`
para `description`, `address`, `city`, `province`, `phone`, `whatsapp` y
`email`: un `STORE` que los omita **borra** esos datos de `tienda-demo` y deja
rojas las pruebas visuales y de checkout que dependen de ellos. Es la trampa más
fácil de pisar de este feature.

## Casos límite y errores

| Caso                                                            | Resultado                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Lote de 500 eventos y **uno** con `deliveryFee: 12.345`         | `400` para los 500. Nada entra al inbox; el POS reintenta el lote completo (decisión SP1)    |
| El mismo lote reintentado sin corregir                          | `400` otra vez, indefinidamente: el outbox del negocio se para. Riesgo operativo documentado |
| `deliveryFee: 0` con `deliveryEnabled: true` y `FLAT_RATE`      | Válido: envío gratis                                                                         |
| `deliveryFee: 500` con `QUOTED_PER_ORDER`                       | Válido: manda el modo y el importe residual se ignora (F-031, § «Casos límite»)              |
| `deliveryEnabled: false` con `FLAT_RATE` y `deliveryFee: null`  | Válido: no ofrece domicilio, no hay nada que cobrar                                          |
| Fila ya inconsistente + evento que no toca la terna             | `processed`, columnas intactas (R9)                                                          |
| Fila ya inconsistente + evento que toca la terna sin arreglarla | `failed` (R10.2)                                                                             |
| Dos eventos `STORE` de la misma tienda en el mismo lote         | Se aplican en orden; el segundo puede resultar `stale` si su `updatedAt` no avanza           |
| Evento con las cinco claves y `updatedAt` igual al guardado     | `stale` (la comparación es `>=`), configuración intacta                                      |
| Clave desconocida en el payload (`deliveryZone`, p. ej.)        | Se ignora en silencio, como cualquier clave desconocida hoy: Zod no es `strict` aquí         |
| `orderExpiryHours` cambiado con propuestas vivas                | No se recalcula ningún `expiresAt` ya escrito: el plazo se fija al proponer (F-019)          |
| Batch con un `STORE` `failed` y `PRODUCT`s válidos              | `207`: los productos entran, el `STORE` va en `failed`                                       |

## Datos y contrato

### El payload de `STORE` en la v7

Las cinco claves nuevas, todas opcionales, al mismo nivel que las de hoy:

```jsonc
{
  "storeId": "uuid",
  "name": "La Rampa · Vedado",
  // ... el resto de la v6, sin cambios ...
  "checkoutMode": "ONSITE", // "WHATSAPP" | "ONSITE" — opcional
  "deliveryEnabled": true, // boolean — opcional
  "deliveryFee": 500.0, // number ≥ 0, ≤ 2 decimales, o null — opcional
  "deliveryFeeMode": "FLAT_RATE", // "FLAT_RATE" | "QUOTED_PER_ORDER" — opcional
  "orderExpiryHours": 24, // entero 1..8760 — opcional
  "publishToStore": true,
  "updatedAt": "2026-09-01T14:03:00.000Z",
}
```

| Campo              | Ausente         | `null`              | Valor   |
| ------------------ | --------------- | ------------------- | ------- |
| `checkoutMode`     | columna intacta | `400 INVALID_BATCH` | escribe |
| `deliveryEnabled`  | columna intacta | `400 INVALID_BATCH` | escribe |
| `deliveryFee`      | columna intacta | escribe `NULL`      | escribe |
| `deliveryFeeMode`  | columna intacta | `400 INVALID_BATCH` | escribe |
| `orderExpiryHours` | columna intacta | `400 INVALID_BATCH` | escribe |

**Dos semánticas de omisión conviven en el mismo payload, y hay que decirlo con
todas las letras en el contrato.** Los campos de contacto de la v2
(`description`, `address`, `phone`, …) se escriben con `?? null`: omitirlos
**borra** la columna. `openingHours` y estas cinco, no: omitirlas la deja
intacta. La frase de la v6 —«Los campos vacíos con `null` omiten esa columna en
la fila (o la dejan como está en un `UPDATE`)»— no describe lo que hace el
código para el primer grupo (ver § Incongruencias, I1).

### Lo que tiene que decir la v7 de `docs/sync-contract.md`

Sube a **7** (mayor: cambia lo que el POS envía) y su § «Cambios respecto a la
v6» dice, como mínimo:

1. Las cinco claves nuevas del `payload` de `STORE`, con tipo, obligatoriedad
   (ninguna), rango y la tabla ausente/`null`/valor de arriba.
2. **`Store.orderExpiryHours` cambia de dueño.** Las líneas de la v4 —«el POS no
   lo envía y un evento `STORE` no lo pisa»— y la de § ③④ —«sigue siendo así en
   la v6»— **dejan de ser ciertas**, dicho con esas palabras, como la v6 hizo
   con la línea de las guardas de transición.
3. Una **tabla de propiedad de campos** con, al menos, las filas de estas cinco:
   campo, dueño, qué pasa si llega un evento que lo toca. Es la semilla de la
   tabla exhaustiva que pide el criterio 4 de F-022, no la tabla entera.
4. En § «Cambios requeridos en cuadrecaja»: las cinco columnas nuevas de
   `Tienda` (nombres propuestos, el POS manda en su propio schema:
   `modoCheckout`, `envioHabilitado`, `costoEnvio`, `modoEnvio`,
   `horasVencimientoPedido`), su exposición en la interfaz y su emisión en el
   outbox.
5. **El riesgo operativo de SP1, con ejemplo.** Un solo valor mal formado tumba
   el lote entero con `400` y el reintento vuelve a fallar: el outbox se para
   hasta que se corrija en el POS. Ejemplo literal del payload que lo provoca
   (`"deliveryFee": 12.345`) y del cuerpo `INVALID_BATCH` que devuelve.
6. **El fallo por evento del criterio 5**, con su código
   `STORE_DELIVERY_CONFIG_INCONSISTENT`, en el vocabulario de errores: no es un
   `400`, es un `status: "failed"` dentro del `207`, y reintentarlo tampoco lo
   arregla.
7. Que el cambio es **aditivo**: un POS que implemente la v6 y no envíe ninguna
   de las cinco sigue siendo un emisor correcto y no tiene que tocar una línea.

### Las banderas de `scripts/send-catalog-batch.mjs`

El guion pasa a componer un evento `STORE` además del `PRODUCT` que ya envía.
Requisitos: el `STORE` **no** se envía con `--unknown-store` (crearía una tienda
basura y rompería el `skipped_not_published` que verifica F-005), y su payload
repite los campos de contacto sembrados (R21).

| Bandera                                 | Qué manda                                                              | Qué se espera           |
| --------------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| _(ninguna)_                             | `STORE` **sin** ninguna de las cinco                                   | `207 processed`, E1/E14 |
| `--store-config`                        | `STORE` con las cinco, distintas de los defaults                       | `207 processed`, E2     |
| `--store-config=partial`                | Solo `deliveryFee`                                                     | `207 processed`, E3     |
| `--store-config=null-fee`               | `deliveryFee: null` + `QUOTED_PER_ORDER`                               | `207 processed`, E4     |
| `--store-config=null-mode`              | `deliveryFeeMode: null`                                                | `400`, E5               |
| `--store-config=decimals`               | `deliveryFee: 12.345`                                                  | `400`, E6               |
| `--store-config=negative`               | `deliveryFee: -1`                                                      | `400`, E6               |
| `--store-config=hours-zero`             | `orderExpiryHours: 0`                                                  | `400`, E6               |
| `--store-config=hours-max`              | `orderExpiryHours: 9000`                                               | `400`, E6               |
| `--store-config=bad-mode`               | `deliveryFeeMode: "PER_KM"`                                            | `400`, E6               |
| `--store-config=bad-checkout`           | `checkoutMode: "TELEGRAM"`                                             | `400`, E6               |
| `--store-config=contradictory`          | `deliveryEnabled: true` + `FLAT_RATE` + `deliveryFee: null`            | `400`, E7               |
| `--store-config=enable-only`            | Solo `deliveryEnabled: true` (contra una fila `FLAT_RATE` sin importe) | `207` con `failed`, E8  |
| `--stale` (compuesta con las de arriba) | El mismo `STORE`, con `updatedAt` de 2000                              | `207 stale`, E9         |

### Base de datos

Ninguna migración (R17). El único cambio en `prisma/schema.prisma` es el
comentario `///` de `orderExpiryHours`, que hoy afirma lo contrario de lo que
este feature decide.

## Criterios de aceptación propuestos

Los trece de `features.json`, traducidos a algo ejecutable. `<T>` es el token del
negocio (`npm run mint:token -- seed-negocio-1`) y `SQL` abrevia
`psql "$DATABASE_URL" -Atc`. La consulta que se repite:

```bash
# Corregido tras la verificación (tests.md § Fallos encontrados 1): `Store.slug`
# es NULL para esta tienda desde F-017 — el slug público vive en Slug/Storefront,
# así que filtrar por él devuelve CERO filas y el criterio pasaría en vacío.
CINCO='SELECT "checkoutMode","deliveryEnabled","deliveryFee","deliveryFeeMode","orderExpiryHours" FROM "Store" WHERE "externalId"='"'"'seed-tienda-1'"'"';'
```

1. `[ya]` **Omitir no es apagar.** Con la tienda puesta a valores no-default,
   el antes y el después son la misma línea, y sin `npm run seed` entre medias
   (R16):

   ```bash
   psql "$DATABASE_URL" -Atc "$CINCO"                  # antes
   node scripts/send-catalog-batch.mjs                 # HTTP 207, processed
   psql "$DATABASE_URL" -Atc "$CINCO"                  # idéntico
   ```

2. `[ya]` **Aplicarlas se ve en el checkout sin reiniciar.** El
   `deliveryEnabled`/`deliveryFeeMode` de esta respuesta es exactamente lo que
   decide si el checkout ofrece domicilio (`isDeliveryOffered`, que usa
   `CheckoutForm`):

   ```bash
   node scripts/send-catalog-batch.mjs --store-config   # HTTP 207, processed
   curl -s -X POST localhost:3000/api/orders/quote -H 'content-type: application/json' \
     -d '{"storeSlug":"tienda-demo","items":[{"storeProductId":"<id>","qty":1}]}' | jq .store
   ```

3. `[ya]` **Opcionalidad.** `node scripts/send-catalog-batch.mjs` (payload con
   la forma exacta de la v6) responde `207` con `status: "processed"` en todos
   los eventos y sin `issues`.

4. `[ya]` **Valor inválido: `400` y nada escrito.** Para cada uno de
   `decimals`, `negative`, `hours-zero`, `hours-max`, `bad-mode`,
   `bad-checkout`:

   ```bash
   psql "$DATABASE_URL" -Atc "$CINCO"
   psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM "SyncEvent";'
   node scripts/send-catalog-batch.mjs --store-config=<caso>   # HTTP 400 INVALID_BATCH
   psql "$DATABASE_URL" -Atc "$CINCO"                          # idéntico
   psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM "SyncEvent";'  # idéntico
   ```

5. `[ya]` **Combinación contradictoria.** `--store-config=contradictory`
   responde `HTTP 400`; `--store-config=enable-only` sobre una fila `FLAT_RATE`
   sin importe responde `207` con `status: "failed"` y
   `error: "STORE_DELIVERY_CONFIG_INCONSISTENT"`. Y el invariante de R8, sobre
   lo que el sync acaba de escribir, da cero:

   ```bash
   psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM "Store"
     WHERE "deliveryEnabled" AND "deliveryFeeMode"='"'"'FLAT_RATE'"'"'
       AND "deliveryFee" IS NULL
       AND "sourceUpdatedAt" > now() - interval '"'"'5 minutes'"'"';'
   ```

6. `[ya]` **Rancio.** `node scripts/send-catalog-batch.mjs --stale --store-config`
   responde `207` con `status: "stale"` para el evento `STORE`, y `$CINCO`
   devuelve lo mismo que antes del envío.

7. `[ya]` **El panel no las escribe.** Un `grep -rn` de las cinco sobre
   `src/features/admin/` no devuelve nada, y `npm test -- boundaries` pasa con
   las cinco añadidas a `FORBIDDEN_WRITE_COLUMNS` de
   `src/features/admin/server/boundaries.test.ts` — que es lo que impide que el
   criterio siga siendo cierto solo por casualidad.

8. `[ya]` **El comentario del schema.**
   `grep -n -A4 "orderExpiryHours" prisma/schema.prisma` nombra a cuadrecaja
   como dueño y ya no contiene «queandabuscando-owned» ni «the sync never sends
   it».

9. `[ya]` **El contrato.** `head -3 docs/sync-contract.md` dice **Versión 7**;
   las cinco claves aparecen en el `payload` de `STORE` con tipo y
   obligatoriedad; existe la sección de la tabla de propiedad con sus cinco
   filas; § «Cambios requeridos en cuadrecaja» las lista; y el hook
   `.claude/hooks/sync-contract-version.sh` no protesta.

10. `[ya]` **Aditivo.** No hay migración (R17): `ls prisma/migrations` no tiene
    entrada nueva y el diff del schema contra la base está vacío. El conteo por
    columna antes y después del despliegue del código es idéntico:

    ```bash
    # Corregido tras la verificación (tests.md § Fallos encontrados 2 y 3):
    # Prisma 7.9.1 retiró `--from-schema-datasource`/`--to-schema-datamodel`, y
    # aun con los flags buenos este comando NO da 0 en este repo por el desajuste
    # de índices GIN que AGENTS.md ya ficha, ajeno a F-032. Lo que el criterio
    # protege de verdad se comprueba con las dos líneas de abajo.
    git diff main --stat -- prisma/migrations        # vacío: ninguna migración nueva
    git diff main -- prisma/schema.prisma            # solo el comentario /// del criterio 8
    psql "$DATABASE_URL" -Atc 'SELECT "checkoutMode","deliveryEnabled","deliveryFeeMode",
      "orderExpiryHours", "deliveryFee" IS NULL AS sin_tarifa, count(*)
      FROM "Store" GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5;'
    ```

11. `[ya]` **ADR.** Existe docs/adr/0028-configuracion-de-compra-del-pos.md
    (por crear), citada desde el contrato y desde el comentario del schema, que
    dice qué invierte de F-019 R5/R20 y por qué **no** contradice ADR 0017 (a).

12. `[ya]` `bash .agent/verify.sh F-019 --full` termina en `0`.

13. `[ya]` `bash .agent/verify.sh F-032 --full` termina en `0`.

14. `[nuevo]` **`docs/despliegue.md` § 9.5 deja de mandar un `UPDATE` a mano**:
    `grep -n 'UPDATE "Store"' docs/despliegue.md` no devuelve nada y el paso
    explica que la configuración llega por el sync (AGENTS.md § Documentación:
    un paso operativo se anota en el mismo ciclo que lo cambia).

15. `[nuevo]` **Un test de handler cubre E1 y E10/E11**: que un payload sin las
    cinco no las incluya en el `data` del `update`, y que el camino de
    unpublish/`DELETE` haga lo que dice R14. Es la única forma de que la regla
    que da nombre al feature no se rompa en una refactorización posterior.

## Incongruencias detectadas

**I1 — El contrato describe una semántica de omisión que el código no tiene.**
`docs/sync-contract.md:406-408` dice que los campos vacíos con `null` «omiten esa
columna en la fila (o la dejan como está en un `UPDATE`)». El objeto `common` de
`src/features/sync/server/handlers/store.ts` escribe `payload.description ??
null` (y lo mismo para `address`, `city`, `province`, `phone`, `whatsapp`,
`email`): ausente y `null` **borran** la columna. Solo `openingHours` se comporta
como dice el contrato. La v7 tiene que corregir esa frase además de añadir las
cinco, o el POS creerá que puede mandar payloads parciales de contacto.

**I2 — `prisma/schema.prisma` afirma hoy lo contrario de lo que decide este
feature.** El comentario de `orderExpiryHours` dice «A queandabuscando-owned
field: the sync never sends it and a STORE event never overwrites it». Es el
criterio 8 y ya está previsto; se anota porque el mismo texto está replicado en
otros **cuatro** sitios que también hay que mover: `docs/sync-contract.md:115-116`
(§ v4), `:63-65` (§ v5.1), `:946-949` (§ ③④), y
`.agent/specs/F-019/spec.md:272-274` (R20) más su tabla de datos (`:328`).
La spec de F-019 es un artefacto histórico y no se reescribe; la ADR nueva es lo
que registra la inversión (criterio 11).

**I3 — El criterio 10 está redactado como si hubiera migración, y no la hay.**
Las cinco columnas y el enum ya existen (F-031 los creó). El único cambio de
`prisma/schema.prisma` es un comentario `///`, que no genera SQL. El criterio se
verifica igual —conteo por columna antes y después— pero contra el despliegue del
código, no contra un `migration.sql`. Propuesta de redacción alternativa en el
criterio 10 de arriba; no se toca el original (regla 3).

**I4 — La «tabla de propiedad de campos» del criterio 9 no existe todavía en
`docs/sync-contract.md`.** No hay ninguna sección con ese nombre (`grep -i
"propiedad"` solo devuelve dos usos sin relación). El criterio dice «los añade a
la tabla», dando por hecho que está. F-032 la **crea** con las cinco filas y
F-022 (criterio 4) la completa.

**I5 — El criterio 5 no dice qué código de respuesta usa, y no puede ser `400`
en todos los casos.** El feature pide que la combinación contradictoria «se
rechace»; el enunciado del ciclo asume `400`. Un `refine` de Zod no ve la fila, y
las dos formas realistas del error dependen de ella (R10). Se resuelve con la
partición de R10: `400` cuando el payload basta, `failed` dentro del `207` cuando
hace falta la fila. Si el humano prefiere que el caso dependiente de la fila
**no** falle sino que se aplique degradado a `deliveryEnabled = false`, es un
cambio de una línea en el handler y lo dice ahora, no al probar.

**I6 — `scripts/send-catalog-batch.mjs` no envía eventos `STORE`.** Los
criterios 1, 2, 4, 5 y 6 lo nombran como el instrumento de verificación y hoy
solo compone un `PRODUCT`; `--stale` (criterio 6) tampoco cubre un `STORE`. Sin
R20 esos criterios no son ejecutables. Además, un `STORE` mal construido borra
los datos de contacto de `tienda-demo` (R21) y pone en rojo pruebas que no tienen
nada que ver con este feature.

**I7 — El seed es el sexto escritor y sobrevive.** `prisma/seed.ts` escribe las
cinco tanto en `create` como en `update`, y adelanta `sourceUpdatedAt` en cada
ejecución. No es una contradicción con el criterio 7 (habla del panel, no del
seed), pero sí un pie en el que tropieza la verificación del criterio 1 si
alguien resiembra entre las dos lecturas.

**I8 — El contrato ya prometió esta versión como «v7».**
`docs/sync-contract.md:68-74` anuncia la v7 con estas cinco columnas por su
nombre. El criterio 9 dice solo «sube de versión»: sube a **7**, no a 6.1, y la
promesa hecha al otro equipo fija el alcance.

## Huecos y preguntas al humano

Ninguna. SP1–SP4 quedaron cerradas antes de empezar (bitácora del orquestador,
2026-09-01) y todo lo demás se decidió aquí con criterio, en R3, R5, R6, R10,
R14, R16 y R17. La única decisión que un humano podría querer revisar sin que
bloquee nada está en I5, y va con su alternativa exacta.

## No decidido a propósito

- **Los nombres en español de las cinco columnas dentro de cuadrecaja.** Se
  proponen (`modoCheckout`, `envioHabilitado`, `costoEnvio`, `modoEnvio`,
  `horasVencimientoPedido`) pero el schema del POS es suyo; lo que ata el
  contrato son los nombres del cable.
- **El nombre y el número exacto de la ADR.** Lo fija sdd-architect al
  escribirla; aquí solo se exige que exista y qué tiene que registrar.
- **Si `checkoutMode` gana valores nuevos** (un tercer modo de contacto). El
  vocabulario sale del enum de Prisma (R19), así que ampliarlo es una v8 del
  contrato, no un cambio de esta spec.
- **Qué hace el POS cuando recibe el `400` del riesgo de SP1.** Se documenta el
  riesgo y el ejemplo; la política de reintento es del otro equipo.
