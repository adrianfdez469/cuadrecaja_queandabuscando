# Contrato de integración cuadrecaja ↔ queandabuscando

**Versión 4** · 28 de agosto de 2026

Este documento es lo que el equipo de cuadrecaja implementa. El lado receptor ya
existe y está verificado contra los casos de abajo.

## Cambios respecto a la v3

**Esta versión NO es aditiva en el `payload` de `PRODUCT`** (F-024, mismo
motivo que la v3 no lo fue en autenticación: HD5, en cuadrecaja no hay nada
desarrollado de esta integración todavía, así que no hay consumidor vivo al
que migrar sin cortar). Lo que cambia:

- **`barcodes` (lista) reemplaza a `barcode` (uno solo).** El producto llega
  con **todos** sus códigos de barras, no con uno elegido a ciegas. `[]` es
  válido cuando el producto no tiene ninguno.
- **La clave `barcode` (singular) queda prohibida, no solo ausente.** Un
  evento `PRODUCT` cuyo `payload` la incluya —con cualquier valor, incluido
  `null`— hace que el **lote entero** responda `400 INVALID_BATCH` y no
  escriba nada, ni siquiera los demás eventos del mismo lote (§ Vocabulario
  de errores). Un POS que siga enviando la v3 no sincroniza catálogo en
  absoluto hasta migrar (§ Modos de falla).
- **La fusión de productos entre negocios sigue usando un solo código: el
  menor de los válidos, en orden lexicográfico de cadenas.** Guardar todos
  los códigos y decidir la identidad canónica por uno solo son decisiones
  separadas a propósito ([ADR 0020](adr/0020-todos-los-codigos-una-sola-fusion.md)):
  el resto del comportamiento de "Resolver identidad canónica" (§
  Transformación en queandabuscando) no cambia.

## Cambios respecto a la v2

**Esta versión NO es aditiva en autenticación.** Todo lo demás (formato de los
`payload`, los cuatro campos de pedidos que F-010 añadió) sigue siendo lo que
la v2 ya describía. Lo que cambia:

- **El token deja de ser único y global.** Cada negocio tiene el suyo, emitido
  por queandabuscando; ver § Autenticación. HD5: **en cuadrecaja no hay nada
  desarrollado de esta integración todavía**, así que este cambio se
  documenta y no se negocia con nadie — no hay ningún consumidor vivo al que
  avisar ni migrar sin cortar.
- **El cursor del pull pasa a ser por negocio** (§ ③④ Pedidos): cuadrecaja
  tiene que guardar un `ultimoPedidoVisto` por cada uno, no uno solo.
- **Tres códigos de error nuevos** que el POS no había visto nunca: negocio
  inactivo, `businessId` que no corresponde al token, y recurso de otro
  negocio (§ Vocabulario de errores).
- Recoge además, en un solo anuncio, dos cosas que ya estaban implementadas y
  nunca se habían comunicado: `unpublishReason` en el `payload` de `STORE` y
  el endpoint ⑥ de disponibilidad de slug (ambos de la propuesta v3 anterior).

---

## El principio que ordena todo

> Ninguna de las dos aplicaciones tiene credenciales de base de datos de la otra.
> Cada una escribe únicamente en la suya. **Todas las llamadas las inicia el POS.**

queandabuscando no conoce la URL de cuadrecaja ni ningún secreto suyo. Un SSRF,
una dependencia npm comprometida o una fuga de variables de entorno en la tienda
pública **no alcanza la base con las ventas**, porque la credencial no está en
ese runtime. No depende de que nadie recuerde una convención.

```
┌──────────────────────┐                        ┌──────────────────────┐
│  cuadrecaja (POS)    │                        │  queandabuscando     │
│                      │                        │                      │
│  cron */2 ───────────┼── ① POST sync/catalog ──▶  escribe en SU base │
│               ───────┼── ② POST sync/availability▶                    │
│               ◀──────┼── ③ GET  orders ─────────  lee de SU base     │
│               ───────┼── ④ POST orders/status ──▶                    │
│               ───────┼── ⑤ GET  reconciliation ─▶                    │
└──────────────────────┘                        └──────────────────────┘
   tiene: DB_POS + su token por negocio            tiene: DB_TIENDA
   NO tiene DB_TIENDA                             NO tiene DB_POS
```

## Autenticación

**El token es por negocio, no un secreto único de plataforma (v3).**
queandabuscando lo acuña, entrega el valor en claro **una sola vez** y guarda
solo su SHA-256. Bearer largo y aleatorio en `Authorization`:

```
Authorization: Bearer <token del negocio>
```

Rotarlo (re-acuñarlo) invalida al instante el valor viejo de ESE negocio y no
afecta a ningún otro. No hay ninguna variable de entorno compartida entre los
dos proyectos: cada negocio guarda su propio token en su propia
configuración, del lado de cuadrecaja.

`/api/internal/*` queda fuera del rate limiting público y excluido de
`robots.txt`. Si **ningún** negocio tiene un token acuñado todavía, el
servidor responde **503**, nunca 200: un token ausente jamás significa «deja
pasar todo» — es la misma invariante que la v2 ya tenía, con un sujeto
distinto (antes «no hay ninguna variable global configurada», ahora «ningún
negocio tiene token»).

El siguiente paso es firma HMAC-SHA256 sobre `timestamp + "." + body`, con
rechazo si la deriva supera 5 minutos. Ver [ADR 0008](adr/0008-bearer-token-baseline.md)
para el disparador — el paso a HMAC no se adelanta ni se retrasa por este
cambio. La verificación está aislada en `src/lib/syncAuth.ts` y la resolución
del negocio en `src/features/sync/server/caller.ts`, así que el cambio no
toca ninguna ruta.

---

## Endpoints

| Método | Ruta                                                   | Cuerpo / query                    | Devuelve                                                                         |
| ------ | ------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------- |
| `POST` | `/api/internal/sync/catalog`                           | `{ businessId, events[] }` (≤500) | 207 `{ ok, failed, results }`                                                    |
| `POST` | `/api/internal/sync/availability`                      | `{ businessId, items[] }` (≤2000) | 200 `{ applied, confirmed }`                                                     |
| `GET`  | `/api/internal/orders?since=&limit=`                   | —                                 | 200 `{ orders, nextCursor }`                                                     |
| `POST` | `/api/internal/orders/status`                          | `{ orderId, status, reason? }`    | 200 `{ ok: true }`                                                               |
| `GET`  | `/api/internal/reconciliation?storeId=`                | —                                 | 200 `{ products, hash }`                                                         |
| `GET`  | `/api/internal/slug-availability?slug=&name=&storeId=` | —                                 | 200 `{ candidate, available, reason, resolvedSlug, url, storeKnown, reserving }` |

### Vocabulario de errores (v4)

Válido para las seis rutas de arriba. Los tres primeros de `503`/`401` ya
existían con otro nombre de variable; los siguientes son de la v3; la fila de
`400 INVALID_BATCH` es de la v4 (F-024).

| Código | Cuerpo                                     | Cuándo                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503`  | `{"error":"SYNC_NOT_CONFIGURED"}`          | Ningún negocio tiene un token acuñado todavía                                                                                                                                                                                                                     |
| `401`  | `{"error":"UNAUTHORIZED"}`                 | Sin cabecera, esquema distinto de `Bearer`, token vacío/corto, o token que no resuelve ningún negocio                                                                                                                                                             |
| `400`  | `{"error":"INVALID_BATCH","issues":[...]}` | **Nuevo (v4).** El cuerpo no cumple el schema — incluida la clave `barcode` (singular) en cualquier `payload` de `PRODUCT`. Rechaza el **lote entero**, ninguna `SyncEvent` queda escrita, ni siquiera la de los demás eventos del mismo lote que sí eran válidos |
| `403`  | `{"error":"BUSINESS_INACTIVE"}`            | El token es válido pero ese negocio está dado de baja                                                                                                                                                                                                             |
| `403`  | `{"error":"BUSINESS_MISMATCH"}`            | El `businessId` del cuerpo (① o ②) no es el del negocio autenticado — el lote entero se rechaza, no se aplica nada                                                                                                                                                |
| `404`  | `{"error":"UNKNOWN_ORDER"}`                | El `orderId` no existe **o pertenece a otro negocio** — el mismo código en los dos casos, a propósito                                                                                                                                                             |
| `404`  | `{"error":"UNKNOWN_STORE"}`                | El `storeId` de ⑤ no existe **o pertenece a otro negocio**                                                                                                                                                                                                        |

Un recurso de otro negocio nunca responde distinto de uno inexistente: ni
`/orders/status`, ni `/reconciliation`, ni `/slug-availability` (que además
responde `storeKnown: false`, nunca un error) sirven para averiguar si un
`Tienda.id` o un pedido existen en OTRO negocio.

---

## ① Catálogo y precios (outbox)

### En cuadrecaja

El `INSERT` a `OutboxEvento` va **dentro de la transacción que ya existe** al
mutar el producto. Si hay rollback, el evento desaparece con ella: no existe una
forma de divergir.

```ts
await prisma.$transaction(async (tx) => {
  const p = await tx.producto.update({ where: { id }, data });
  await tx.outboxEvento.create({ data: { entidad: "PRODUCTO", entidadId: p.id, ... } });
});
```

El cron toma el lote con `FOR UPDATE SKIP LOCKED` — los crons de Vercel pueden
solaparse si una corrida tarda más que el intervalo, y así dos corridas toman
lotes disjuntos:

```sql
SELECT * FROM "OutboxEvento"
WHERE "procesadoAt" IS NULL AND intentos < 6
ORDER BY id LIMIT 500
FOR UPDATE SKIP LOCKED;
```

`intentos < 6` es lo que impide el bloqueo de cabeza de línea: un payload
corrupto se queda quieto después de 6 intentos y los siguientes siguen fluyendo.
El acuse es **por id**, nunca por lote.

### Formato

Los nombres van en **inglés** aunque el schema del POS esté en español, para que
ninguno de los dos lados traduzca al leer.

**`businessId` en la raíz (v3): redundante y comprobado, ya no autoritativo.**
La identidad del negocio sale del token (§ Autenticación); este campo se
sigue enviando en el mismo formato de siempre, pero ahora solo se usa para
comprobar que coincide con el del token autenticado. Si no coincide —en la
raíz o en el `payload` de cualquier evento que lleve `businessId`
(`STORE`, `CATEGORY`, `PRODUCT`, `EXCHANGE_RATE`; `CURRENCY` no lo lleva)—
el lote entero se rechaza con `403 BUSINESS_MISMATCH` y no se escribe nada.

```jsonc
{
  "businessId": "<Negocio.id>",
  "events": [
    {
      "eventId": "<OutboxEvento.id>",
      "entity": "PRODUCT", // STORE | CATEGORY | PRODUCT | CURRENCY | EXCHANGE_RATE
      "operation": "UPDATE", // CREATE | UPDATE | DELETE
      "occurredAt": "2026-08-25T14:03:00.000Z",
      "payload": {},
    },
  ],
}
```

#### Mapeo de nombres

| Wire (inglés)        | cuadrecaja (español)                                        |
| -------------------- | ----------------------------------------------------------- |
| `storeProductId`     | `ProductoTienda.id`                                         |
| `productId`          | `Producto.id`                                               |
| `storeId`            | `Tienda.id`                                                 |
| `businessId`         | `Negocio.id`                                                |
| `localName`          | `Producto.nombre`                                           |
| `barcodes`           | `CodigoProducto.codigo` de **todas** las filas del producto |
| `price` / `currency` | `ProductoTienda.precio` / `monedaPrecioCode`                |
| `canonicalProductId` | `Producto.productoCanonicoId`                               |
| `publishToStore`     | `Producto.publicarEnTienda` / `Tienda.publicarEnTienda`     |
| `availability`       | derivado de `existencia` y `umbralBajo`                     |
| `updatedAt`          | `updatedAt` de la fila de origen                            |

#### `payload` de `PRODUCT` (v4)

```jsonc
{
  "storeProductId": "uuid",
  "productId": "uuid",
  "businessId": "uuid",
  "storeId": "uuid",
  "localName": "Refresco de cola 1.5 L",
  "barcodes": ["7501031311309", "7501031311316"], // v4: lista, obligatoria, [] si no tiene ninguno
  "localCategoryId": "uuid", // null
  "price": 450,
  "currency": "CUP",
  "canonicalProductId": null,
  "imageUrl": null,
  "publishToStore": true,
  "updatedAt": "2026-08-25T14:03:00.000Z", // guarda anti-rancio
}
```

| Campo      | Tipo       | Obligatorio   | Notas                                                                                                                                                                                         |
| ---------- | ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `barcodes` | `string[]` | **sí**        | `[]` es válido. Cada elemento es texto — un GTIN con cero inicial no sobrevive a un número. Los que no son un GTIN válido (8/12/13/14 dígitos) se descartan en silencio, sin fallar el evento |
| `barcode`  | —          | **prohibido** | Su sola presencia en el `payload` — con cualquier valor, incluido `null` — responde `400 INVALID_BATCH` del lote entero (v3 → v4, ver § Cambios respecto a la v3)                             |

**La fusión sigue usando un solo código: el menor de los válidos**, en orden
lexicográfico de cadenas — nunca por orden numérico ni por cuál llegó
primero en la lista. Enviar los mismos códigos en otro orden no crea un
producto canónico nuevo. Todos los códigos válidos se guardan (no solo el que
decide la fusión); el resto del diseño de esa tabla y por qué el mismo código
puede terminar en dos canónicos distintos está en
[ADR 0020](adr/0020-todos-los-codigos-una-sola-fusion.md).

**Nunca se envía** `costo`, `margen`, el entero de `existencia`, `Venta`,
`MovimientoStock`, `CierrePeriodo`, `Usuario`, `Rol`, credenciales ni
`Proveedor`. El DTO es la frontera de seguridad: no se puede filtrar lo que
nunca se serializó.

#### `payload` de `STORE`

**Documentado aquí por primera vez.** La v2 ya lo implementa —
`entity: "STORE"` es una de las cinco que el mapeo de arriba lista— pero su
forma nunca se escribió en este documento ni se avisó al equipo de cuadrecaja
(F-011 lo encontró leyendo el código, no leyendo el contrato). Va completo,
con el único campo nuevo de la v3 marcado aparte.

```jsonc
{
  "storeId": "uuid",
  "businessId": "uuid",
  "businessName": "La Rampa",
  "name": "La Rampa · Vedado",
  "description": "Todo para la casa, a dos cuadras de 23 y L.", // null
  "slug": "tienda-demo", // null — solo se usa al CREAR, para el slug único
  "address": "Calle 23 esq. L, Vedado", // null
  "city": "La Habana", // null
  "province": null,
  "latitude": null,
  "longitude": null,
  "phone": null,
  "whatsapp": "+5350000001", // null
  "email": null,
  "openingHours": null,
  "baseCurrency": "CUP", // por defecto CUP si se omite
  "publishToStore": true, // el opt-in del negocio para ESTA tienda
  "unpublishReason": null, // string?, ≤ 160 caracteres — v3, ver abajo
  "updatedAt": "2026-08-25T14:03:00.000Z", // guarda anti-rancio (HD10/AP6)
}
```

`publishToStore: false` suspende la tienda (`Store.status = "SUSPENDED"`);
`true` la publica o la reabre. Los campos vacíos con `null` omiten esa
columna en la fila (o la dejan como está en un `UPDATE`), igual que en
`PRODUCT`.

##### Novedades de esta versión — `unpublishReason` y disponibilidad de slug

Un solo campo nuevo, opcional, aditivo. **No hace falta ningún cambio en
cuadrecaja**: omitirlo deja el comportamiento de hoy exactamente igual, y un
lector que solo conoce la v2 sigue funcionando sin tocar una línea.

| Campo             | Tipo    | Notas                                                                                                                                                                              |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishToStore`  | boolean | El opt-in del negocio para esta tienda. (ya en la v2)                                                                                                                              |
| `unpublishReason` | string? | **v3, opcional.** Motivo visible al comprador cuando `publishToStore` es `false`. Texto plano, ≤ 160 caracteres, se pinta como texto. Se ignora cuando `publishToStore` es `true`. |
| `updatedAt`       | string  | ISO 8601 con desplazamiento. Guarda anti-rancio. (ya en la v2)                                                                                                                     |

Dos avisos de comportamiento que no cambian el cable pero sí lo que el POS
puede observar (HD10-HD15, el interruptor del panel de administración):

1. **El panel de administración puede cerrar y abrir la tienda por su
   cuenta.** Un `GET` del POS puede encontrar una tienda cerrada que él nunca
   cerró — el negocio la cerró desde queandabuscando, con un motivo de una
   lista fija (vacaciones, adecuaciones, etc.) que el POS nunca ve.
2. **Un evento `STORE` con `publishToStore: true` puede reabrir una tienda
   que el negocio cerró desde el panel.** queandabuscando solo reescribe el
   estado cuando el `publishToStore` del evento difiere del que ya tenía
   registrado — una edición rutinaria (cambiar el teléfono, por ejemplo) que
   repite el mismo valor no reabre nada — pero un evento que sí cambia el
   opt-in siempre gana, sea cual sea su origen.

**Qué tiene que hacer el otro equipo: nada**, salvo decidir si quiere mandar
`unpublishReason` cuando desactive una tienda desde el propio POS. Y, aparte
de esta propuesta: la sección `payload de STORE` de arriba documenta también
lo que la v2 ya envía y nunca se comunicó — conviene que este anuncio lleve
los dos avisos juntos, no solo el campo nuevo.

**F-017 (Storefront), sumado al mismo anuncio.** `slug` en el `payload` de
`STORE` sigue siendo «solo se usa al CREAR» —ahora para el slug de la
**marca**, no de la sucursal— y sigue sin poder fallar el evento nunca: si el
valor está tomado o es una palabra reservada, queandabuscando lo convierte en
el siguiente libre en silencio. El endpoint ⑥ de abajo es la forma de saber,
antes de publicar, en qué se va a convertir.

##### ⑥ Disponibilidad de slug (aditiva)

```
GET /api/internal/slug-availability?slug=<candidato>&name=<nombre>&storeId=<Tienda.id>
Authorization: Bearer <token del negocio>
```

Un pronóstico de qué slug quedaría **si se publicara ahora**, nunca una
reserva: **no reserva** nada (no aparta el valor) y **no garantiza** nada
(entre la consulta y la publicación otro puede quedarse el valor). Al menos
uno de `slug`/`name`; `storeId` es opcional (el `Tienda.id` de esta tienda,
si ya se conoce) y solo decide `own` frente a `taken`.

**El `storeId`, si se envía, tiene que ser de una tienda del negocio
autenticado (v3).** Uno de otro negocio se trata como si no se hubiera
enviado: `storeKnown: false` y `reason` nunca `"own"` — nunca un error, y
nunca la forma de averiguar si un `Tienda.id` ajeno existe en otro negocio.
El resto de la respuesta (`candidate`/`available`/`resolvedSlug`/`url`) no se
acota: el espacio de slugs es global y público.

```jsonc
{
  "candidate": "la-rampa", // lo evaluado, ya normalizado
  "available": false, // ¿queda tal cual?
  "reason": "taken", // free | own | taken | reserved | retired | invalid
  "resolvedSlug": "la-rampa-2", // el slug que quedaría si se publicara AHORA
  "url": "https://queandabuscando.com/la-rampa-2",
  "storeKnown": true, // ¿existe ya la tienda de storeId en esta base?
  "reserving": false, // SIEMPRE false
}
```

| `reason`   | Cuándo                                                         |
| ---------- | -------------------------------------------------------------- |
| `free`     | Nadie lo tiene                                                 |
| `own`      | Lo tiene la marca de `storeId`: publicar no lo cambia          |
| `taken`    | Lo tiene otra marca u otra sucursal                            |
| `reserved` | Es una palabra reservada (`admin`, `api`, `sesion-cerrada`, …) |
| `retired`  | Existió y su dueño desapareció: **no vuelve al pool**          |
| `invalid`  | Nada convertible en slug, o pasa de 80 caracteres              |

Errores: `400 { "error": "MISSING_QUERY" }` sin `slug` ni `name`; `401`/`503`
del mismo guard que el resto de `/api/internal/*`. Un `storeId` desconocido
**no** es error: es el caso normal antes de publicar (`"storeKnown": false`).

**Qué tiene que hacer el otro equipo: nada obligatorio.** `Tienda.slug` ya
está en la lista de cambios de abajo desde la v1. Lo único opcional es
llamar a este endpoint desde la pantalla donde el POS edita el slug de una
tienda, para mostrarle al comerciante qué dirección va a quedar antes de que
la publique.

### Transformación en queandabuscando

1. `publishToStore: false` → borrado suave del `StoreProduct`. Fin.
2. Resolver identidad canónica, a partir de `barcodes` normalizados
   (espacios/guiones fuera, solo los GTIN de 8/12/13/14 dígitos válidos),
   deduplicados y ordenados ascendente por cadena:
   - `canonicalProductId` presente → usarlo (los códigos igual se guardan
     contra ese canónico, paso 4)
   - ausente pero con al menos un código válido → buscar o crear el canónico
     por el **menor** de ellos
   - ninguno de los dos → crear canónico **huérfano** con `isExclusive: true`
3. Crear o actualizar `StoreProduct` por `(storeId, canonicalProductId)`
4. **(v4, F-024)** Guardar cada código válido de `barcodes` contra el
   canónico resuelto en el paso 2, en `CanonicalBarcode`. Aditivo: se
   insertan los que falten y no se borra ninguno, ni siquiera si un envío
   posterior deja de mencionarlo. No aplica en la rama huérfana (no hay
   ningún código válido que guardar) ni en el paso 1 (borrado suave: fin
   antes de llegar aquí).
5. Crear o actualizar `ProductAlias`, `useCount++`
6. Si el alias es **nuevo** → recalcular el `searchDocument` del canónico

El paso 2 es la degradación elegante del diseño: **nunca hay un producto que no
se pueda publicar**. Un producto sin identidad resuelta se publica igual en su
propia tienda, con su nombre local, y solo queda fuera del marketplace.

El paso 4 es deliberadamente independiente del paso 2: guardar todos los
códigos y decidir la identidad por uno solo son decisiones separadas
([ADR 0020](adr/0020-todos-los-codigos-una-sola-fusion.md)). Un código que ya
es el `ean` de OTRO canónico no fusiona nada — puede terminar viviendo en dos
canónicos a la vez, a propósito: relacionarlos es un feature futuro, no este.

El paso 6 es el fácil de olvidar y degrada la búsqueda en silencio. Está
implementado como efecto explícito del handler, no como responsabilidad de quien
llama. `CanonicalBarcode` nunca entra en el `searchDocument` ni en el
`searchVector`: buscar por código de barras no es parte de este contrato.

### Respuesta

```jsonc
{
  "ok": ["evt-1", "evt-2"], // marca el outbox como hecho
  "failed": [{ "id": "evt-3", "error": "..." }], // reintenta solo esto
  "results": [
    // detalle, para logs
    { "eventId": "evt-1", "status": "processed" },
    { "eventId": "evt-2", "status": "duplicate" },
  ],
}
```

`status` ∈ `processed` · `duplicate` · `skipped_not_published` · `stale` ·
`failed`. **Todo lo que no sea `failed` aparece en `ok`**: son estados
terminales, reenviarlos no cambiaría nada.

`skipped_not_published` **no es un error**: es lo que hace funcionar el opt-in
por local sin que los dos sistemas tengan que coordinarse. Un evento de una
tienda que aquí no existe se descarta limpiamente.

Un `PRODUCT` con `operation: UPDATE` **nunca** toca `priceOverride`,
`description`, `imageUrls`, `visible` ni `featured`: son del panel.

---

## ② Disponibilidad

**Nada de esto toca el camino de venta**, que en cuadrecaja ya hace 18–19
queries y ya tuvo timeouts.

El lote también lleva `businessId` en la raíz (`{ businessId, items[] }`), con
la misma regla de ① (v3): redundante y comprobado contra el token, nunca
autoritativo — un `businessId` que no coincide responde `403 BUSINESS_MISMATCH`
sin aplicar nada del lote. `items[]` se identifica por `storeId`, no por
negocio: un item de una tienda ajena simplemente no se confirma (§ Query
convergente).

### Lo que viaja es un enum, no el entero

```
existencia <= 0            → OUT_OF_STOCK
existencia <= umbralBajo   → LOW_STOCK
resto                      → AVAILABLE
```

Tres consecuencias: los negocios no exponen su inventario a la competencia;
vender 3 unidades de 40 **no genera ninguna escritura** porque el enum no
cambió; y el volumen cae uno o dos órdenes de magnitud.

### Query convergente, no cursor de tiempo

El instinto es `WHERE updatedAt > ultimaSincronizacion`. **Tiene un bug de
pérdida de datos**: una transacción fija `updatedAt = T1` y se confirma en
`T2 > T1`; si el cron corre entre ambos no ve la fila, el cursor avanza más allá
de T1, y esa fila no se sincroniza nunca. Aparece semanas después como «un
producto figura disponible y está agotado».

En su lugar, una consulta declarativa de divergencia contra `dispPublicada`:

```sql
-- índice PARCIAL: solo indexa las filas divergentes, así que es diminuto
CREATE INDEX CONCURRENTLY idx_disp_divergente ON "ProductoTienda" (id)
WHERE (CASE WHEN existencia <= 0             THEN 'OUT_OF_STOCK'
            WHEN existencia <= "umbralBajo"  THEN 'LOW_STOCK'
            ELSE                                  'AVAILABLE' END)
      IS DISTINCT FROM "dispPublicada";
```

No hay ventana de pérdida, se auto-repara (si el cron no corrió tres horas, la
próxima corrida ve exactamente lo pendiente) y es O(cambios), no O(catálogo).

Tras el POST, se confirma **solo lo que la respuesta devolvió** en `confirmed`:

```sql
UPDATE "ProductoTienda" SET "dispPublicada" = $3
WHERE "productoId" = $1 AND "tiendaId" = $2;
```

Un producto que esta base no pudo resolver **no aparece en `confirmed`**, sigue
divergente en el POS y se reintenta. Esa es la propiedad de auto-reparación.

---

## ③④ Pedidos

El POS los **lee**; queandabuscando nunca escribe en el POS.

```
GET /api/internal/orders?since=<último id visto>&limit=100
→ { orders: [...], nextCursor: "42" | null }
```

`nextCursor: null` significa «al día». El id es un `BIGINT` autoincremental, así
que el cursor es monotónico. Un pedido devuelto pasa de `PENDING` a `PULLED`,
y **no se borra**: la página de estado del cliente sigue funcionando.

**Este endpoint asume un único poller por negocio, secuencial.** La lectura
(`findMany`) y la marca como `PULLED` (`updateMany`) no son atómicas entre sí.
Dos pollers del mismo negocio corriendo a la vez pueden leer el mismo pedido
antes de que el primero lo marque, y ambos lo entregarían: el POS lo vería
duplicado. Es responsabilidad de cuadrecaja no correr dos instancias del
poller de un mismo negocio en paralelo.

**El cursor es por negocio (v3).** `since` se interpreta solo contra los
pedidos del negocio autenticado por el token — cuadrecaja tiene que guardar
un `ultimoPedidoVisto` **por negocio**, no uno solo. Los ids siguen siendo un
`BIGINT` global y creciente compartido por todos los negocios, así que la
secuencia que ve un negocio concreto tiene huecos (los ids de otros negocios
intercalados): eso es correcto y **no** indica que se perdió ningún pedido —
el POS no debe asumir continuidad en los ids que recibe.

`POST /api/internal/orders/status` y `GET /api/internal/reconciliation` (⑤,
más abajo) siguen la misma regla: un `orderId`/`storeId` de otro negocio
responde exactamente igual que uno inexistente (`404`, § Vocabulario de
errores) — nunca un error distinto que confirme que el recurso existe en otro
lado.

Los campos que ya conocías siguen siendo exactamente lo que eran: `unitPrice`,
`currencyCode`, `lineTotal`, `subtotal`, `discountTotal`, `deliveryFee` y
`total` están **todos en la moneda del pedido** (`Order.currencyCode`), y
`Σ lineTotal = subtotal` se sigue sosteniendo siempre. Un ejemplo completo de
la v2, con un pedido de una línea priceada originalmente en USD:

```jsonc
{
  "orders": [
    {
      "id": "42",
      "code": "A7K3M9PQR2", // ver «Formato de Order.code» más abajo
      "storeExternalId": "uuid",
      "status": "PENDING",
      "contact": { "name": "Ana Pérez", "phone": "+5355555555", "email": null, "address": null },
      "currencyCode": "CUP",
      "subtotal": "880.00",
      "discountTotal": "0",
      "deliveryFee": "0.00",
      "total": "880.00",
      "notes": null,
      "createdAt": "2026-08-26T02:00:00.000Z",
      // NUEVO en v2 — las tasas congeladas al confirmar (R9). `{}` cuando el
      // pedido no necesitó convertir nada.
      "rateSnapshot": {
        "base": "CUP",
        "capturedAt": "2026-08-26T02:00:00.000Z",
        "rates": { "USD": "440.000000" },
      },
      "items": [
        {
          "storeProductExternalId": "uuid",
          "name": "Cerveza Cristal",
          "unitPrice": "880.00", // ya convertido — lo de siempre
          "currencyCode": "CUP", // la moneda del pedido — lo de siempre
          "quantity": "2.000",
          "lineTotal": "880.00", // lo de siempre; sigue siendo lo que suma subtotal
          // NUEVOS en v2 — el precio efectivo ANTES de convertir
          "originalUnitPrice": "2.00",
          "originalCurrencyCode": "USD",
          "originalLineTotal": "4.00",
        },
      ],
    },
  ],
  "nextCursor": null,
}
```

Cómo se relacionan los campos nuevos con los de siempre, como fórmula:

```
unitPrice = convert(originalUnitPrice, currencyCode, rateSnapshot.rates)
```

—la misma función que usa queandabuscando internamente (`src/lib/money.ts`),
así que recomputarlo con las tasas del `rateSnapshot` da el mismo céntimo.
**Los importes originales no son sumables** (R5b): con varias líneas en
monedas distintas su suma no significa nada, y `subtotal`/`total` **siguen
siendo** la suma de los `lineTotal` ya convertidos — nunca la de los
originales. Un pedido creado antes de esta versión no tiene los originales
guardados; en ese caso **se emiten los valores ya convertidos como respaldo**,
así que un lector que espera un número ahí nunca se encuentra con `null`.

### Formato de `Order.code`

Diez caracteres del alfabeto Crockford base32 en mayúsculas, sin separador:
`0123456789ABCDEFGHJKMNPQRSTVWXYZ` (sin `I`, `L`, `O`, `U` — se confunden al
dictarlos por teléfono). Regex: `^[0-9A-HJKMNP-TV-Z]{10}$`. Es la **única**
credencial de `https://<tienda>/pedido/<code>`, una página pública que muestra
nombre, teléfono y dirección de una persona — trátalo como un secreto de
lectura, no como un identificador cualquiera para loguear o mostrar sin
cuidado.

```
POST /api/internal/orders/status
{ "orderId": "42", "status": "CONFIRMED", "reason": null }
```

`status` ∈ `CONFIRMED` · `READY` · `DELIVERED` · `CANCELLED`. Sin cambios en
la v2.

---

## ⑤ Reconciliación

Sin esto no hay forma de saber que la sincronización se rompió: los datos
simplemente se van quedando viejos sin que nada falle.

**El `storeId` de la query tiene que ser de una tienda del negocio autenticado
(v3).** Uno de otro negocio responde `404 UNKNOWN_STORE`, igual que uno
inexistente (§ Vocabulario de errores) — este endpoint no sirve para
averiguar si un `Tienda.id` ajeno existe en otro negocio.

Ambos lados calculan el mismo hash sobre los mismos campos —los que el sync
posee, excluyendo los del panel, que legítimamente difieren:

```
md5( concat( externalId ":" precio ":" moneda ":" disponibilidad "|" )
     ordenado por externalId )
```

Si los hashes difieren: poner `dispPublicada = NULL` en las filas de ese local
(lo que hace que la query convergente las levante todas) y alertar.

**Alertar también si no hubo una corrida exitosa en 30 minutos.**

---

## Idempotencia, en dos capas

1. **Todo es upsert por clave natural** — `(storeId, canonicalProductId)`,
   `(ean)`, `(canonicalProductId, text, businessId)`. Reaplicar es inofensivo.
2. **Guarda anti-rancio** — cada `UPDATE` lleva `AND sourceUpdatedAt < $nuevo`.

Con la segunda guarda **el orden de entrega deja de importar**: aunque un
reintento llegue después de un cambio más nuevo, no lo pisa. Eso es lo que hace
seguro el filtro `intentos < 6` sin arriesgar corrupción.

Y del lado del inbox: la idempotencia es por `eventId`, pero **un evento que
falló no cuenta como duplicado**. Reportarlo en `ok` haría que el POS marque su
outbox como procesado y la actualización se perdería en silencio, sin que nada
en ningún lado registre un error.

---

## Cambios requeridos en cuadrecaja

Todos aditivos y nullable, así que la migración no reescribe tablas — importante
en `ProductoTienda`, la más caliente del sistema.

```prisma
model Producto {
  productoCanonicoId String?
  publicarEnTienda   Boolean @default(false)
}

model ProductoTienda {
  dispPublicada String?   // último enum confirmado
  umbralBajo    Int?      // umbral de POCAS_UNIDADES, por producto
}

model Tienda {
  publicarEnTienda Boolean @default(false)   // opt-in del local
  slug             String?
  direccion        String?
  latitud          Decimal? @db.Decimal(9, 6)
  longitud         Decimal? @db.Decimal(9, 6)
  horarios         Json?
}

model OutboxEvento { /* nueva */ }
model PedidoEntrante { /* nueva */ }
```

Más: el índice parcial de divergencia con `CREATE INDEX CONCURRENTLY`, el cron
`/api/cron/sync-tienda` cada 2 minutos, y el cron de reconciliación diario.

---

## Modos de falla

| Falla                                               | Qué le pasa al usuario                                                                                                                                                                        | Recuperación                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La tienda está caída                                | Nada: el POS sigue vendiendo                                                                                                                                                                  | La outbox no se drena, `intentos++`. Se recupera solo                                                                                                                   |
| El POS está caído                                   | La tienda sirve el último snapshot y **acepta pedidos igual**                                                                                                                                 | Los pedidos esperan a que el POS vuelva a hacer pull                                                                                                                    |
| El cron no corre                                    | Precios y disponibilidad se atrasan                                                                                                                                                           | La reconciliación lo detecta. Alerta a los 30 min                                                                                                                       |
| Evento con payload inválido                         | Ese producto queda viejo; el resto fluye                                                                                                                                                      | `intentos > 5` → DLQ + alerta                                                                                                                                           |
| Se perdió `dispPublicada`                           | Resincroniza todo el stock una vez                                                                                                                                                            | Idempotente, sin intervención                                                                                                                                           |
| El token de un negocio se filtró                    | Alguien podría escribir catálogo falso a nombre de ESE negocio, ninguno más                                                                                                                   | Re-acuñar el token de ese negocio (invalida el viejo al instante, no toca a los demás). Motivo para pasar a HMAC                                                        |
| **Un POS todavía en v3 envía `barcode` (singular)** | **No sincroniza catálogo en absoluto**: el lote entero responde `400 INVALID_BATCH` y ni siquiera queda una `SyncEvent` para reintentar — no es un producto el que falla, es el lote completo | Migrar el payload de `PRODUCT` a `barcodes: string[]` (v4). No hay periodo de gracia ni modo de compatibilidad: es el mismo corte que hizo la v3 en autenticación (HD5) |

---

## Verificación

Con el servidor local levantado y el token de `seed-negocio-1` acuñado
(`npm run mint:token -- seed-negocio-1`) exportado como `QAB_BEARER_TOKEN` — o
pasado con `--token=` en cada script:

```bash
node scripts/send-catalog-batch.mjs --repeat        # processed
node scripts/send-catalog-batch.mjs --repeat        # duplicate
node scripts/send-catalog-batch.mjs --bad-token     # 401
node scripts/send-catalog-batch.mjs --unknown-store # skipped_not_published
node scripts/send-catalog-batch.mjs --stale         # stale
node scripts/send-catalog-batch.mjs --singular-barcode  # 400 INVALID_BATCH (v4, F-024)
node scripts/send-availability-batch.mjs OUT_OF_STOCK
node scripts/send-catalog-batch.mjs --token=<otro-token-de-otro-negocio>  # 403 BUSINESS_MISMATCH
```

El criterio 6 de F-024 —cuántos productos canónicos comparten códigos entre
negocios distintos— se mide con `npm run count:barcodes`
(`scripts/count-canonical-barcodes.ts`), no con una petición HTTP: imprime
cinco cifras y un histograma sobre la base local.
