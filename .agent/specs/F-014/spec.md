---
feature: F-014
agente: sdd-spec
actualizado: 2026-08-31T22:08:22Z
estado: listo
---

## Problema

Cuando la sincronización con cuadrecaja se rompe, no falla nada: los precios y
la disponibilidad de la tienda pública simplemente se quedan viejos, y nadie se
entera hasta que un comprador reclama. `GET /api/internal/reconciliation` ya
existe para detectarlo —los dos lados calculan el mismo hash sobre los mismos
campos y comparan— pero **nadie lo ha ejecutado nunca** y el otro lado no tiene
cómo calcular ese hash: `docs/sync-contract.md` § ⑤ lo describe en
pseudocódigo, no en algo que el equipo de cuadrecaja pueda implementar.

Lo importante no es el endpoint, que ya está escrito: es la **forma canónica
exacta de la cadena que se hashea**. Un solo detalle de serialización distinto
—un cero de cola en el precio, un orden distinto, un `NULL` que se come una
fila— hace que los dos lados calculen hashes distintos sobre datos idénticos.
El resultado no es «no detecta la deriva»: es peor, es una alerta que salta
todas las noches sin que nada esté roto, hasta que alguien la silencia y
entonces sí deja de detectar la deriva.

## Alcance

### Dentro

- Fijar, con valores literales observados ejecutando, la **cadena canónica** que
  se hashea: separadores, serialización del precio, orden y caso vacío (R1–R8).
- Fijar el **conjunto de filas** que entra en el hash de cada lado (R9–R12).
- **Tres retoques en `docs/sync-contract.md`**, los tres aditivos y sin bump de
  versión ni § «Cambios respecto a la v5» (HD1, HD4 y HD5 — ver § Huecos):
  1. El **SQL espejo** contra el schema de cuadrecaja, listo para copiar, dentro
     de § ⑤ (R13).
  2. Una fila `400 {"error":"MISSING_STORE_ID"}` en § «Vocabulario de errores
     (v5)», marcada como aclaración de algo ya implementado (R18, HD4).
  3. La precondición de los **≤ 2 decimales** de `price`, en § ① junto a `price`
     y en § ⑤ como precondición de la reconciliación (R7, HD5).

  **La frontera de HD1 creció**: HD1 hablaba solo de «dentro de § ⑤», y el
  humano la amplió expresamente a la fila de la tabla de errores (HD4) y a la
  frase de § ① (HD5). Quien implemente no tiene que volver a preguntarlo.

- El contrato HTTP completo del endpoint: 200, 400, 401, 403, 404, 503 (E1–E9).
- La verificación, repartida en dos (HD3 y HD6): scripts/check-reconciliation.mjs
  (por crear), **HTTP puro y sin importar Prisma**, para el contrato del
  endpoint; y tests `*.db.test.ts` con fixtures aisladas por sesión para todo lo
  que necesite escribir o leer la base directamente. Ver § Criterios de
  aceptación propuestos.

### Fuera (explícito)

- **El cron nocturno del POS.** Lo dispara cuadrecaja; queandabuscando no
  conoce su URL ni inicia ninguna llamada (§ «El principio que ordena todo»).
- **La acción de recuperación** (`dispPublicada = NULL` en el local divergente)
  y **la alerta a los 30 minutos sin corrida exitosa**: las dos ocurren del
  lado del POS. Este feature define el oráculo, no lo que se hace con él.
- **Cambiar el algoritmo del hash.** md5 y el orden de los campos ya están en
  el contrato v5; ver R14 sobre por qué md5 está bien aquí.
- **Ejecutar el SQL espejo.** No hay una base de cuadrecaja contra la que
  correrlo (bitácora, § «Notas para quien retome»). Lo que sí se ejecuta es su
  traducción literal al schema de aquí; ver R15 y el límite honesto de esa
  prueba.
- **Reconciliar pedidos, aliases, canónicos o categorías.** Solo el catálogo
  publicado de una tienda.
- Interfaz de usuario. Este feature no tiene pantalla; `design.md` no aplica.

## Actores y precondiciones

Lo dispara el **cron de reconciliación de cuadrecaja**, una vez al día y por
tienda, con el `Bearer` del negocio dueño de esa tienda (§ Autenticación, v3).
No hay ningún otro llamante: `/api/internal/*` es máquina a máquina.

Precondiciones: el negocio existe, está `active`, tiene un `syncTokenHash`
acuñado, y el `storeId` de la query es el `Store.externalId` de una tienda
**de ese negocio** (que es `Tienda.id` del lado del POS, § Mapeo de nombres).

## Comportamiento esperado

**E1 — Tienda propia con catálogo.**
Dado un negocio A con token válido y una tienda suya con N filas de
`StoreProduct` con `deletedAt IS NULL`,
Cuando llama `GET /api/internal/reconciliation?storeId=<externalId>`,
Entonces responde `200` con `{ "products": N, "hash": "<32 hex minúsculas>" }`
y nada más en el cuerpo.

**E2 — El mismo estado da el mismo hash.**
Dado E1 sin ninguna escritura entre medias,
Cuando repite la llamada,
Entonces devuelve exactamente el mismo `products` y el mismo `hash`.

**E3 — El precio mueve el hash.**
Dado E1,
Cuando llega un `PRODUCT`/`UPDATE` por `POST /api/internal/sync/catalog` que
cambia `price` de un producto,
Entonces el `hash` cambia y `products` no.

**E4 — La disponibilidad mueve el hash.**
Dado E1,
Cuando `POST /api/internal/sync/availability` cambia el `availability` de un
producto (p. ej. `AVAILABLE` → `OUT_OF_STOCK`),
Entonces el `hash` cambia y `products` no.

**E5 — Los campos del panel NO mueven el hash.**
Dado E1,
Cuando se modifican en una fila `description`, `imageUrls`, `priceOverride`,
`priceOverrideCurrency`, `visible`, `featured`, `searchDocument` o
`searchVector`, y nada más,
Entonces `products` y `hash` son **byte a byte los mismos** que antes.

**E6 — Alta y baja mueven las dos cifras.**
Dado E1,
Cuando un `PRODUCT` publica un producto nuevo (o un `DELETE` /
`publishToStore: false` da de baja uno),
Entonces `products` cambia en ±1 y el `hash` cambia.

**E7 — Tienda publicada y vacía.**
Dado un negocio A con una tienda suya sin ninguna fila `StoreProduct` viva
(en la base local: `seed-tienda-8`, `PUBLISHED`, cero productos),
Cuando llama al endpoint con su `storeId`,
Entonces responde `200` con
`{ "products": 0, "hash": "d41d8cd98f00b204e9800998ecf8427e" }` —el md5 de la
cadena vacía— y **nunca** un `404`. Cero productos no es «no existe».

**E8 — Tienda inexistente y tienda ajena, indistinguibles.**
Dado un negocio A con token válido,
Cuando llama con un `storeId` que no existe, o con el `storeId` de una tienda
del negocio B (en la base local, `seed-tienda-7`),
Entonces responde en los dos casos `404` con cuerpo exactamente
`{"error":"UNKNOWN_STORE"}`, sin ningún campo que permita distinguirlos.

**E9 — Sin `storeId`.**
Dado un negocio A con token válido,
Cuando llama a `GET /api/internal/reconciliation` sin el parámetro `storeId`
(o con él vacío),
Entonces responde `400` con cuerpo `{"error":"MISSING_STORE_ID"}`. El
comportamiento no cambia; lo que cambia es que deja de estar sin documentar
(I2, R18, HD4).

**E10 — El guard va primero.**
Dado una petición sin cabecera `Authorization` (o con un token que no resuelve
ningún negocio, o de un negocio `active: false`), **aunque además le falte
`storeId`**,
Entonces responde `401` / `403 BUSINESS_INACTIVE` / `503 SYNC_NOT_CONFIGURED`
según § Vocabulario de errores (v5), **nunca** `400 MISSING_STORE_ID`: el
código del `400` no se alcanza antes de autenticar.

**E11 — Estado de publicación de la tienda: irrelevante para el 404.**
Dado una tienda del negocio A con `Store.status` `DRAFT` o `SUSPENDED` (en la
base local, `seed-tienda-10` y `seed-tienda-3`),
Cuando llama con su `storeId`,
Entonces responde `200` con su hash, no `404`: la tienda existe y el POS tiene
derecho a reconciliarla. `status` no filtra ninguna fila (ver R12).

**E12 — Los dos lados coinciden sobre los mismos datos.**
Dado el catálogo de una tienda cualquiera de la base local,
Cuando se calcula el hash con el SQL de R15 (la traducción literal del SQL
espejo de R13 al schema de aquí) y se compara con el `hash` que devolvió el
endpoint,
Entonces son idénticos, para las cuatro formas de precio de R4 y para el caso
vacío de E7.

## Reglas de negocio

### La cadena canónica

**R1 — Una entrada por fila, sin separador entre entradas.** Para cada fila del
conjunto de R9, se concatena, sin ningún separador adicional entre filas:

```
<externalId> ":" <precio> ":" <moneda> ":" <disponibilidad> "|"
```

Los cuatro separadores son literales ASCII `:` y el terminador es `|`. Es lo
que hace hoy `src/features/sync/server/reconciliation.ts:35-37` y lo que dice
§ ⑤ del contrato.

**R2 — El hash es `md5` de esa cadena, en hexadecimal minúsculo de 32
caracteres**, calculado sobre su codificación **UTF-8**.

**R3 — `<disponibilidad>` es la etiqueta del enum `Availability`**, literal y
en mayúsculas: `OUT_OF_STOCK`, `LOW_STOCK` o `AVAILABLE`
(`prisma/schema.prisma:30-34`). `<moneda>` es `syncedPriceCurrency` tal cual,
tres letras (§ ① `payload` de `PRODUCT`: `currency`). `<externalId>` es
`StoreProduct.externalId`, que es `ProductoTienda.id` del otro lado.

**R4 — `<precio>` es el valor decimal de `syncedPrice` SIN ceros de cola y sin
punto huérfano.** Este es el corazón del feature. La columna es
`Decimal @db.Decimal(14, 2)` (`prisma/schema.prisma:409`), Postgres la devuelve
como `numeric(14,2)` con dos decimales siempre, y el `Decimal` de Prisma
normaliza al hacer `.toString()`. Valores **observados ejecutando** contra la
base local (Postgres 16.15, `numeric(14,2)`, cliente Prisma 7.9.1):

| Valor en la columna | `::text` de Postgres | `.toString()` de Prisma | Entra en la cadena |
| ------------------- | -------------------- | ----------------------- | ------------------ |
| `1990.00`           | `1990.00`            | `1990`                  | `1990`             |
| `1990.50`           | `1990.50`            | `1990.5`                | `1990.5`           |
| `1990.10`           | `1990.10`            | `1990.1`                | `1990.1`           |
| `0.00`              | `0.00`               | `0`                     | `0`                |
| `0.05`              | `0.05`               | `0.05`                  | `0.05`             |
| `12345678901.99`    | `12345678901.99`     | `12345678901.99`        | `12345678901.99`   |

Sin separador de miles, sin signo `+`, sin notación exponencial (el máximo de
`numeric(14,2)` son 12 dígitos enteros, muy por debajo del umbral de decimal.js
para exponenciales, y el mínimo no nulo es `0.01`). Un `1990.00` que entrase en
la cadena como `1990.00` en vez de `1990` da un md5 distinto: comprobado, sobre
las mismas filas de `seed-tienda-1` el hash sin normalizar es
`c9ef1f1688b5c31abf4ac103318a25ad` y el correcto `e894ce15e77dfc0f8ba94d10cb2d8eed`.

**R5 — En SQL, esa normalización se reproduce así**, y solo así:

```sql
trim(trailing '.' from trim(trailing '0' from round(<precio>::numeric, 2)::text))
```

Los dos `trim` van en ese orden y el `trailing '.'` es imprescindible: sin él
`1990.00` daría `1990.` en vez de `1990`. El `.` bloquea al primer `trim`, así
que `1000.00` da `1000` y no `1`. Comprobado ejecutando sobre `1000.00`,
`100.00`, `10.00`, `0.00`, `0.10`, `0.01`, `1990.10`, `-1990.00`, `-0.50` y
`99999999999.99`.

**R6 — El `round(..., 2)` de R5 no es decorativo.** El lado de queandabuscando
escribe `payload.price.toFixed(2)`
(`src/features/sync/server/handlers/product.ts:136`), o sea que
**siempre** hay exactamente dos decimales aquí, vengan los que vengan en el
JSON. Si `ProductoTienda.precio` del POS tuviera más escala, sin el `round` los
dos lados diferirían siempre. Con el `round` diferirían solo en el empate de
medio céntimo: `2.675` da `"2.67"` con `toFixed(2)` de JavaScript (porque el
doble IEEE-754 más cercano es `2.67499…`) y `2.68` con `round(2.675, 2)` de
Postgres — comprobado ejecutando. Por eso R7.

**R7 — `price` viaja con dos decimales como máximo.** Es una precondición del
contrato, no una recomendación: un `price` con tres o más decimales hace
divergir los dos lados en un céntimo, de forma permanente y sin que nada esté
roto. **Va escrita en dos sitios** (HD5): en § ① junto a `price`, que es donde
la lee quien **construye** el payload y el único que puede evitar el problema, y
en § ⑤ como precondición de la reconciliación. Y va con el dato medido al lado,
porque es lo que la justifica ante el otro equipo: `2.675` se serializa aquí
como `"2.67"` —`toFixed(2)` sobre el doble IEEE-754 más cercano, que es
`2.67499…`— y `round(2.675, 2)` en Postgres da `2.68`.

**R8 — El orden es el orden de bytes de `externalId`, ascendente.** No «el
orden de `ORDER BY`»: el de bytes. Dos colaciones distintas sobre los mismos
datos dan hashes distintos, y las dos bases son de dos organizaciones
diferentes. En SQL se escribe `ORDER BY "…" COLLATE "C"`. Del lado de
queandabuscando, `orderBy: { externalId: "asc" }`
(`src/features/sync/server/reconciliation.ts:24`)
delega en la colación de la base, que **hoy no es equivalente por diseño sino
por accidente**: la base local es `PostgreSQL 16.15 on aarch64-unknown-linux-musl`,
donde el `en_US.utf8` declarado se comporta como `C` (comprobado: `A-1`, `Z-9`,
`_x`, `a-1`, `a1`, `a_1` sale idéntico con y sin `COLLATE "C"`), mientras que
producción es Supabase sobre glibc, donde **no** lo es. La consecuencia
práctica: un test local jamás distinguiría los dos órdenes. Para
`externalId` con forma de UUID canónico —minúsculas, dígitos y guiones en
posiciones fijas— ambos órdenes coinciden igualmente, así que la regla no
cambia ningún hash de hoy; existe para que no dependa del `datcollate` de nadie.

**Y «orden de bytes» tampoco es lo mismo que `.sort()` de JavaScript.** El
`.sort()` por defecto compara **unidades de código UTF-16**, no bytes UTF-8, y
para un carácter fuera del BMP —un par suplente— da el orden **contrario**.
Medido: sobre `{ "\u{10000}", "\uFFFD" }`, `.sort()` devuelve
`U+10000, U+FFFD` (porque su primera unidad es `D800`, menor que `FFFD`) y
`Buffer.compare` sobre UTF-8 devuelve `U+FFFD, U+10000` (`EF BF BD` antes que
`F0 90 80 80`), que es también el orden por punto de código y el de Postgres con
`COLLATE "C"`. O sea que hay **dos** implementaciones ingenuas que R8 descarta,
no una: ordenar por colación de la base y ordenar con `.sort()`. Solo un par
astral distingue la segunda; ver C12.

### Qué filas entran

**R9 — Del lado de queandabuscando: todas las filas `StoreProduct` de esa
tienda con `deletedAt IS NULL`. Ningún filtro más.** En particular **no** se
filtra por `visible`, que es del panel (§ E5): un producto que el administrador
ocultó sigue estando publicado desde el punto de vista del sync y tiene que
seguir contando. Tampoco por `featured`, ni por `Store.status` (R12). Es lo que
hace hoy `src/features/sync/server/reconciliation.ts:22-31`, y aquí queda como
requisito, no como
accidente.

**R10 — Del lado del POS: las filas `ProductoTienda` de esa `Tienda` cuyo
`Producto.publicarEnTienda` es `true`.** Es el conjunto que el POS _habría
enviado_ con `publishToStore: true`, que es exactamente lo que produce una fila
viva aquí (§ Transformación en queandabuscando, paso 1: `publishToStore: false`
→ borrado suave). Una fila borrada en el POS no está en su tabla y aquí llegó
como `DELETE`: simétrico.

**R11 — El `Tienda.publicarEnTienda` del POS NO filtra.** Aunque `publishToStore`
del payload mapea a los dos flags (§ Mapeo de nombres), un
`Tienda.publicarEnTienda: false` aquí **suspende la tienda pero no borra sus
productos**: `src/features/sync/server/handlers/store.ts:101-122` pone
`Store.status = "SUSPENDED"` y no
toca ninguna fila `StoreProduct`. Si el SQL espejo filtrase por él, una tienda
suspendida daría `products: 0` en el POS contra `products: N` aquí y alertaría
todas las noches. El SQL de R13 filtra por `Producto.publicarEnTienda` y por
nada más.

**R12 — `Store.status` no interviene.** Ni para filtrar filas ni para decidir
el `404` (E11). Una tienda `DRAFT` o `SUSPENDED` tiene un hash bien definido.

**R13 — El SQL espejo, contra el schema de cuadrecaja.** Esto es lo que entra
en § ⑤ de `docs/sync-contract.md` como aclaración aditiva (HD1), acompañado en
esa misma sección por la precondición de R7 (HD5):

```sql
SELECT count(*) AS products,
       md5(coalesce(string_agg(
              pt."id" || ':' ||
              trim(trailing '.' from
                   trim(trailing '0' from round(pt."precio"::numeric, 2)::text)) || ':' ||
              pt."monedaPrecioCode" || ':' ||
              coalesce(pt."dispPublicada", 'AVAILABLE') || '|',
              '' ORDER BY pt."id" COLLATE "C"
            ), '')) AS hash
FROM "ProductoTienda" pt
JOIN "Producto" p ON p.id = pt."productoId"
WHERE pt."tiendaId" = $1
  AND p."publicarEnTienda" = true
  AND pt."precio" IS NOT NULL
  AND pt."monedaPrecioCode" IS NOT NULL;
```

Cuatro decisiones que el SQL tiene que llevar escritas y que no se deducen del
pseudocódigo de hoy:

1. **`dispPublicada`, no el enum calculado desde `existencia`/`umbralBajo`**
   (HD2, decisión del humano). El hash compara lo que ambos lados creen haber
   _publicado_; la divergencia en vuelo la resuelve la query convergente de
   § ②. Si el hash la contara, cualquier venta normal haría diferir los hashes
   hasta la corrida siguiente y la alerta dejaría de significar nada.
2. **`coalesce("dispPublicada", 'AVAILABLE')`.** `dispPublicada` es
   `String?`: es `NULL` mientras ② no haya confirmado nada, y la propia acción
   de recuperación de § ⑤ lo vuelve a poner a `NULL`. Aquí la columna
   equivalente es `availability Availability @default(AVAILABLE)`
   (`prisma/schema.prisma:411`), o sea que una fila nunca confirmada vale
   `AVAILABLE` de este lado. `AVAILABLE` es por tanto el único valor con el que
   los dos lados pueden coincidir. Sin el `coalesce` pasa algo peor que
   discrepar: `NULL || ':'` es `NULL`, `string_agg` se salta esa entrada y el
   `hash` cambia mientras `count(*)` no — dos cifras que se contradicen.
3. **El `coalesce(..., '')` de fuera.** `string_agg` sobre cero filas devuelve
   `NULL` y `md5(NULL)` es `NULL`. Con él, una tienda vacía da
   `d41d8cd98f00b204e9800998ecf8427e`, que es el md5 de la cadena vacía y lo
   mismo que devuelve este lado (E7). Comprobado ejecutando.
4. **`precio`/`monedaPrecioCode` no nulos.** Un producto sin moneda no puede
   producir un `payload` de `PRODUCT` válido (`currency` es
   `z.string().length(3)` obligatorio, `src/features/sync/schemas.ts:75`), así
   que nunca existió aquí; contarlo allí sería una diferencia permanente. El
   `IS NOT NULL` es además lo que impide el mismo `NULL || ':'` del punto 2.

**R14 — md5 se queda, y aquí está por qué.** Es un uso **no criptográfico**: un
checksum de detección de deriva sobre datos que ambos lados ya poseen. No firma
nada, no protege un secreto y no hay adversario con nada que ganar —falsificar
una colisión solo le serviría al POS para ocultarse a sí mismo su propia
deriva—. Cambiarlo rompe el contrato con un equipo externo por cero beneficio.
Si alguien lo «arregla» a sha256, la reconciliación deja de funcionar hasta que
cuadrecaja despliegue el cambio. Única salvedad operativa: `createHash("md5")`
falla en un Node arrancado en modo FIPS; no es el caso de Vercel ni del entorno
local, y no se prevé que lo sea.

**R15 — La prueba local se hace contra `StoreProduct`, y hay que decir qué NO
prueba.** El SQL de R13 no se puede ejecutar aquí: no hay base de cuadrecaja.
Lo que sí se ejecuta —desde un test `*.db.test.ts` con `$queryRaw`, no desde el
script, que es HTTP puro (HD6)— es su traducción columna a columna al schema de
aquí:

```sql
SELECT count(*) AS products,
       md5(coalesce(string_agg(
              "externalId" || ':' ||
              trim(trailing '.' from
                   trim(trailing '0' from round("syncedPrice"::numeric, 2)::text)) || ':' ||
              "syncedPriceCurrency" || ':' || "availability"::text || '|',
              '' ORDER BY "externalId" COLLATE "C"
            ), '')) AS hash
FROM "StoreProduct"
WHERE "storeId" = $1 AND "deletedAt" IS NULL;
```

Eso valida **el orden, los separadores y la serialización del precio**, que es
donde están los errores. **No valida** los nombres de las columnas del otro
lado, ni el `JOIN` con `Producto`, ni el `coalesce` de `dispPublicada`: eso solo
lo puede verificar cuadrecaja. El documento tiene que decirlo así y no
sobrevender la prueba.

El puente hasta el HTTP se cierra por composición, no con una prueba que haga
las dos cosas a la vez: este test ata el SQL a `storeReconciliationHash()`, y
C11 ata `storeReconciliationHash()` a la ruta. Ninguna de las dos necesita
levantar el servidor y ejecutar SQL en el mismo proceso.

### El endpoint

**R16 — Contrato de respuesta.** `200` → `{ products: number, hash: string }`,
y nada más. `products` es un entero ≥ 0, `hash` son 32 caracteres `[0-9a-f]`.
Los errores son los de § Vocabulario de errores (v5), con el cuerpo literal de
esa tabla; el `404` es `{"error":"UNKNOWN_STORE"}` y no lleva ningún dato del
recurso.

**R17 — Solo lectura.** Ninguna llamada al endpoint escribe nada, ni siquiera
una traza por tienda. Es idempotente y se puede repetir sin efecto.

**R18 — El `400 MISSING_STORE_ID` se documenta, no se cambia.** El código que
devuelve hoy `src/app/api/internal/reconciliation/route.ts:15-17` se queda tal
cual —mismo código, mismo cuerpo— y lo que se añade es una fila en
§ «Vocabulario de errores (v5)» de `docs/sync-contract.md` (HD4):
`400` · `{"error":"MISSING_STORE_ID"}` · «falta el parámetro `storeId` en ⑤»,
marcada como aclaración de algo ya implementado, igual que la v3 hizo con
`unpublishReason`. Motivo: esa tabla dice «válido para las siete rutas de
arriba», así que hoy está incompleta, y no cambia ninguna respuesta. Renombrarlo
a `INVALID_QUERY` sí sería un cambio de contrato y no se hace.

## Casos límite y errores

| Caso                                                                 | Resultado                                                                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tienda publicada con cero productos                                  | `200 { products: 0, hash: "d41d8cd98f00b204e9800998ecf8427e" }`. **No** `404` (E7)                                                                                               |
| Tienda `DRAFT` o `SUSPENDED`                                         | `200` con su hash (E11)                                                                                                                                                          |
| Todos los productos con `deletedAt` puesto                           | Igual que la tienda vacía: `products: 0` y el md5 de la cadena vacía                                                                                                             |
| Todos los productos con `visible: false`                             | Entran igual: `products` y `hash` no cambian respecto a tenerlos visibles (R9, E5)                                                                                               |
| Producto con `priceOverride` puesto                                  | El hash usa `syncedPrice`, nunca el override (E5). El precio que ve el comprador y el que se reconcilia son cosas distintas                                                      |
| `storeId` de otro negocio                                            | `404 UNKNOWN_STORE`, indistinguible de inexistente (E8)                                                                                                                          |
| `storeId` ausente o vacío                                            | `400 MISSING_STORE_ID` (E9, I2, R18)                                                                                                                                             |
| `storeId` repetido en la query (`?storeId=a&storeId=b`)              | Se usa el primero (`URLSearchParams.get`). No se especifica más: no es un caso legítimo                                                                                          |
| Sin cabecera, token inválido, negocio inactivo, ningún token acuñado | `401` / `401` / `403 BUSINESS_INACTIVE` / `503 SYNC_NOT_CONFIGURED`, antes de mirar la query (E10)                                                                               |
| Escritura del sync concurrente con la lectura                        | El hash es una foto de un instante; una lectura sin repeatable read puede caer entre dos escrituras. Aceptable: la próxima corrida converge (misma auto-reparación que § ②)      |
| Un `PRODUCT` que fue a la DLQ tras 6 intentos                        | El POS cuenta ese producto y aquí no existe → `products` y `hash` difieren. **Es exactamente lo que este feature detecta**, no un falso positivo                                 |
| Catálogo grande (20 000 filas)                                       | Una sola query, una vez al día y por tienda. Sin paginar: partirlo cambiaría la cadena. El techo lo fija el arquitecto                                                           |
| `externalId` que contuviera `:` o `\|`                               | La cadena es ambigua en teoría. En la práctica `externalId` es el UUID de `ProductoTienda`; se asume y se deja escrito, sin escapado, porque md5 aquí no defiende de nadie (R14) |

## Datos y contrato

`GET /api/internal/reconciliation?storeId=<Tienda.id>`, `Authorization: Bearer
<token del negocio>`. Ya está en § Endpoints de `docs/sync-contract.md`
devolviendo `200 { products, hash }`.

Campos que entran en el hash, con su equivalente del otro lado (§ Mapeo de
nombres):

| queandabuscando                    | cuadrecaja                        | Tipo             | En el hash                     |
| ---------------------------------- | --------------------------------- | ---------------- | ------------------------------ |
| `StoreProduct.externalId`          | `ProductoTienda.id`               | UUID (texto)     | tal cual                       |
| `StoreProduct.syncedPrice`         | `ProductoTienda.precio`           | `numeric(14,2)`  | normalizado según R4/R5        |
| `StoreProduct.syncedPriceCurrency` | `ProductoTienda.monedaPrecioCode` | texto de 3       | tal cual                       |
| `StoreProduct.availability`        | `ProductoTienda.dispPublicada`    | enum / `String?` | etiqueta; `NULL` → `AVAILABLE` |
| `StoreProduct.deletedAt IS NULL`   | `Producto.publicarEnTienda`       | filtro           | decide qué filas               |

Campos que **no** entran, y por qué: `localName`, `localCategoryId`,
`sourceUpdatedAt`, `syncedAt` y `slug` son del sync pero no viajan en el hash
—el contrato v5 fija cuatro campos y ampliarlo es un cambio de versión, no una
aclaración—; `description`, `imageUrls`, `priceOverride`,
`priceOverrideCurrency`, `visible` y `featured` son del panel y difieren
legítimamente entre los dos sistemas (`prisma/schema.prisma:419-425`);
`searchDocument` y `searchVector` no son de ninguno de los dos lados, son
derivados (ADR 0007/0021), y el POS ni siquiera los tiene.

Todo el vocabulario de errores está en § «Vocabulario de errores (v5)». Este
endpoint no añade ningún código nuevo, pero **sí añade una fila a esa tabla**:
el `400 MISSING_STORE_ID` que ya devuelve sin estar documentado (I2), que se
documenta sin tocar el comportamiento (R18, HD4).

## Criterios de aceptación propuestos

Cada uno con lo que hay que ejecutar, en las dos mitades que fija HD6:

- **scripts/check-reconciliation.mjs (por crear)** verifica el **contrato HTTP**.
  Sigue el estilo de `scripts/send-catalog-batch.mjs`: un modo por caso,
  `QAB_BEARER_TOKEN` o `--token=`, salida legible, código de salida distinto de
  0 cuando algo no cuadra. **HTTP puro: no importa Prisma y no escribe en la
  base** salvo a través de `POST /api/internal/sync/catalog` y
  `POST /api/internal/sync/availability`, que son parte del contrato. Es lo que
  impide que el documento mienta sobre el contrato.
- **Los tests `*.db.test.ts`** verifican el **álgebra del hash** contra Postgres
  real, con fixtures aisladas por sesión
  (`src/features/marketplace/server/dbFixtures.ts`). Ahí va todo lo que necesita
  escribir filas o ejecutar SQL: los campos del panel, las formas del precio y
  la comparación con el SQL espejo. Motivo de la separación (HD6): la base local
  la comparten cuatro worktrees y un script que siembra deja basura en ella.
- **Un test unitario sin base** para lo que es una función pura: el orden de
  bytes de R8 (C12). Que no toque Postgres no es un descuido — es lo que permite
  probarlo con un par suplente que ningún `externalId` real va a tener nunca.

- `[ya]` **C1** — `GET /api/internal/reconciliation?storeId=<id>` responde
  `{ products, hash }`:
  `node scripts/check-reconciliation.mjs --store=seed-tienda-1` → `200`, cuerpo
  con exactamente esas dos claves, `hash` de 32 hex. Sale 0.
- `[ya]` **C2** — El hash cambia con el precio o la disponibilidad:
  `node scripts/check-reconciliation.mjs --price` (manda un `PRODUCT`/`UPDATE`
  por `POST /api/internal/sync/catalog` con un `price` nuevo) y `--availability`
  (manda un lote por `POST /api/internal/sync/availability`). Los dos imprimen
  el hash antes y después y fallan si son iguales o si `products` cambió.
- `[ya]` **C3** — El hash NO cambia con `description`, `imageUrls` ni
  `priceOverride`: un `*.db.test.ts` que escribe esos campos con Prisma sobre
  una fila de fixture y comprueba que `storeReconciliationHash()` devuelve el
  mismo `hash` byte a byte.
- `[nuevo]` **C4** — Tampoco cambia con `priceOverrideCurrency`, `visible`,
  `featured`, `searchDocument` ni `searchVector`: el mismo test de C3, con las
  ocho columnas del panel/derivadas, no con tres. Se propone aparte porque el
  criterio 3 de `features.json` solo nombra tres y no se toca (regla 3).
- `[ya]` **C5** — Tienda inexistente responde `404`:
  `node scripts/check-reconciliation.mjs --unknown-store` → `404` con cuerpo
  `{"error":"UNKNOWN_STORE"}`.
- `[nuevo]` **C6** — Tienda de otro negocio responde el **mismo** `404`:
  `node scripts/check-reconciliation.mjs --other-business` (usa
  `seed-tienda-7`) compara cuerpo y código con los de C5 y falla si difieren en
  un byte. Cierra § ⑤ del contrato, que el criterio 4 no cubre.
- `[ya]` **C7** — El algoritmo está documentado en `docs/sync-contract.md` con
  el SQL equivalente para cuadrecaja. Se cumple con **tres** cosas escritas, no
  con una (HD1 ampliada por HD4 y HD5):
  1. § ⑤ contiene el SQL de R13 completo, con sus cuatro puntos y el límite
     honesto de R15 («esto no valida los nombres de las columnas del otro
     lado»).
  2. § «Vocabulario de errores (v5)» contiene la fila de R18.
  3. § ① junto a `price`, y § ⑤ otra vez, contienen la precondición de R7 con
     el dato del `2.675` medido.

  Y `bash .agent/verify.sh F-014 --full` termina en 0 (incluye
  `npm run check:harness` y `format:check`, que es lo que valida el CI sobre un
  `.md`). Ninguna de las tres lleva bump de versión ni entrada en § «Cambios
  respecto a la v5».

- `[nuevo]` **C8** — El SQL y el código dan el mismo hash: un `*.db.test.ts`
  ejecuta el SQL de R15 con `$queryRaw` sobre su propia fixture —la de C9, que
  ya trae las cuatro formas del precio, más una tienda vacía— y comprueba que
  `products` y `hash` coinciden con lo que devuelve `storeReconciliationHash()`.
  El mismo test comprueba que la variante **sin** normalizar el precio
  (`"syncedPrice"::text` a secas) da un hash **distinto**, para que la
  aserción no pueda pasar por casualidad. Medido al escribir esta spec sobre las
  11 tiendas sembradas: coincide en las 11, y en `seed-tienda-1` la variante sin
  normalizar da `c9ef1f1688b5c31abf4ac103318a25ad` frente al correcto
  `e894ce15e77dfc0f8ba94d10cb2d8eed`.
- `[nuevo]` **C9** — Las cuatro formas del precio: un `*.db.test.ts` deja en una
  tienda de fixture productos a `1990.00`, `1990.50`, `1990.10` y `0.00`, y
  comprueba que sus cuatro entradas en la cadena canónica son `…:1990:…`,
  `…:1990.5:…`, `…:1990.1:…` y `…:0:…`, con los literales escritos en el test.
  Es el criterio que impide que el documento mienta sobre el precio.
- `[nuevo]` **C10** — Tienda publicada y vacía:
  `node scripts/check-reconciliation.mjs --empty` (usa `seed-tienda-8`) →
  `200 { "products": 0, "hash": "d41d8cd98f00b204e9800998ecf8427e" }`, y falla
  si la respuesta es `404`.
- `[nuevo]` **C11** — El endpoint tiene tests propios: existe
  src/app/api/internal/reconciliation/route.test.ts (por crear) —hoy es la
  única ruta de `/api/internal/*` sin uno— cubriendo `200`, `400` sin
  `storeId`, `404`, y que sin cabecera responde `401` y no `400` (E10).
- `[nuevo]` **C12** — El orden es de bytes, y el test lo tiene que poder
  demostrar: un test **unitario y sin base** del comparador puro que vive en
  src/lib/byteOrder.ts (por crear, decisión D1 de `architecture.md`), sobre un
  conjunto que **incluya el par astral** `{ "\u{10000}", "\uFFFD" }`. La
  aserción es doble, al estilo de C8:
  1. Ordenar ese conjunto con el comparador y comprobar que sale
     `U+FFFD, U+10000` —el orden de los bytes UTF-8, `EF BF BD` antes que
     `F0 90 80 80`—, y que el hash de la cadena canónica construida en ese orden
     es el esperado.
  2. Comprobar que la implementación ingenua, `.sort()` por defecto, da sobre
     ese mismo conjunto el orden contrario (`U+10000, U+FFFD`) y por tanto un
     hash **distinto**. Si los dos hashes coinciden, el test está mal montado y
     hay que arreglarlo, no relajarlo.

  El par astral es lo único que hace este criterio no-vacuo, y por eso es
  obligatorio: los seis `externalId` hostiles que esta spec proponía antes
  —`A-1`, `Z-9`, `_x`, `a-1`, `a1`, `a_1`— **no discriminan nada**. Medido: dan
  exactamente el mismo orden con `.sort()`, con `Buffer.compare` sobre UTF-8,
  con el `ORDER BY` por defecto de Postgres y con `COLLATE "C"`; un C12 escrito
  sobre ellos pasaría igual con una implementación por `.sort()`, que es justo
  el fallo que R8 existe para impedir. Se pueden conservar como caso de
  legibilidad —enseñan que `_` cae entre las mayúsculas y las minúsculas— pero
  no cuentan como verificación.

  **No hace falta escribir nada en la base para verificar esto**, y es mejor no
  hacerlo: el comparador es una función pura (D1), el `externalId` real es un
  UUID de `ProductoTienda` y sembrar un par suplente en Postgres solo dejaría
  basura en una base que comparten cuatro worktrees. La otra mitad —que la
  consulta real usa ese comparador y no la colación— la cubren C8 y C11.

## Incongruencias detectadas

- **I1 — El criterio 4 dice menos que el contrato.** «Una tienda inexistente
  responde 404» (`features.json`, F-014) frente a § ⑤ y § Vocabulario de
  errores: una tienda **de otro negocio** responde también `404 UNKNOWN_STORE`.
  El código **sí lo cumple**:
  `src/features/sync/server/reconciliation.ts:16-20` resuelve con
  `findFirst({ where: { externalId, businessId } })` y devuelve `null`, y
  `src/app/api/internal/reconciliation/route.ts:20-22` lo traduce a
  `404 {"error":"UNKNOWN_STORE"}`, que es
  exactamente el cuerpo de la tabla. Ya hay cobertura a nivel de función
  (`src/features/sync/server/tenantScoping.db.test.ts:157`, E19 de F-018) y a
  nivel HTTP en `.agent/specs/F-018/smoke.sh:89`. Lo que falta es que el
  criterio de **este** feature lo diga: propuesto como C6, sin tocar el 4
  (regla 3).
- **I2 — `400 MISSING_STORE_ID` no existe en el contrato.**
  `src/app/api/internal/reconciliation/route.ts:15-17` lo devuelve, y no aparece ni en § Endpoints ni en § «Vocabulario de errores
  (v5)» de `docs/sync-contract.md`, ni en ningún `acceptance_criteria`. No es un
  descuido nuevo: `.agent/specs/F-018/architecture.md:246-248` lo lista entre
  los `400` que «siguen dentro del handler… No cambian», o sea que se conocía y
  se decidió no documentarlo. Para cuadrecaja es un código que puede recibir y
  no está escrito en ningún sitio. **Resuelto por HD4**: se documenta con una
  fila en § «Vocabulario de errores (v5)» sin tocar el comportamiento (R18).
- **I3 — El criterio 3 enumera tres campos del panel y `StoreProduct` tiene
  seis, más dos derivados.** Faltan `priceOverrideCurrency`, `visible` y
  `featured` (`prisma/schema.prisma:419-425`), y `searchDocument`/`searchVector`,
  que no son de ninguno de los dos lados (ADR 0007/0021). Ninguno de los cinco
  entra hoy en el `select` de
  `src/features/sync/server/reconciliation.ts:25-30`, así que el
  comportamiento ya es el correcto; lo que falta es la prueba. Propuesto como
  C4, sin tocar el criterio 3 (regla 3). `visible` es el que más importa: es el
  único que un administrador cambia a diario y el único que un implementador
  podría creerse obligado a filtrar.
- **I4 — El pseudocódigo de § ⑤ no dice nada de la serialización del precio.**
  Lo que hay hoy es un `md5` sobre la concatenación de `externalId`, `precio`,
  `moneda` y `disponibilidad` separada por dos puntos y terminada en barra
  vertical, «ordenado por externalId». Ese `precio` admite al menos dos
  lecturas: `1990` y `1990.00`.
  Sobre los datos sembrados de `seed-tienda-1` las dos lecturas dan hashes
  distintos (`e894ce15…` frente a `c9ef1f16…`), medido. Un equipo que
  implemente la lectura natural en SQL —`precio::text`— alerta todas las noches.
  Lo cierra R4/R5.
- **I5 — «ordenado por externalId» tampoco es una especificación.** Depende de
  la colación de cada base y las dos bases son de dos organizaciones distintas.
  Lo cierra R8. Agravante: la base local es musl y colaciona como `C` aunque
  declare `en_US.utf8`, así que **ningún dato normal puede detectar el fallo**
  en local. Y hay una segunda lectura ingenua que no tiene nada que ver con la
  base: `.sort()` de JavaScript ordena por unidades de código UTF-16 y, sobre un
  par suplente, da el orden **contrario** al de los bytes UTF-8 (medido:
  `.sort()` da `U+10000, U+FFFD`; los bytes dan `U+FFFD, U+10000`). Las dos las
  cierra R8, y C12 es lo que impide que la segunda pase desapercibida.
- **I6 — `Tienda.publicarEnTienda` mapea a `publishToStore`, pero aquí no borra
  productos.** § Mapeo de nombres lo pone junto a `Producto.publicarEnTienda`,
  y § Transformación paso 1 dice que `publishToStore: false` es borrado suave
  del `StoreProduct`. Pero cuando el `false` viene de la **tienda**, el handler
  que corre es el de `STORE`, que solo pone `status: "SUSPENDED"`
  (`src/features/sync/server/handlers/store.ts:101-122`) y no toca ninguna fila
  de producto. Un SQL
  espejo que filtrase por `Tienda.publicarEnTienda` alertaría en falso sobre
  toda tienda suspendida. Lo cierra R11.
- **I7 — `dispPublicada` es nullable y el pseudocódigo no lo contempla.** Es
  `NULL` antes de la primera confirmación de ② y **la propia acción de
  recuperación de § ⑤ lo vuelve a poner a `NULL`**. En SQL eso no da «un valor
  raro»: anula la concatenación entera de la fila y `string_agg` la omite, con
  lo que `hash` y `count(*)` dejan de describir el mismo conjunto. Lo cierra el
  punto 2 de R13.
- **I8 — La bitácora dice «no hay tests» y hay uno parcial.**
  `.agent/progress/F-014.md` § «Estado actual» afirma que «nadie lo ha ejecutado
  (no hay `route.test.ts` bajo `reconciliation/` ni script en `scripts/`)».
  Cierto para la ruta y el script, pero `storeReconciliationHash()` sí tiene una
  prueba contra Postgres real: `tenantScoping.db.test.ts:157`, que cubre el
  aislamiento entre negocios (parte de I1). No cambia el plan; evita que alguien
  la dé por inexistente y la duplique.

## Huecos y preguntas al humano

**Ninguna abierta.** Hubo tres —SP1, SP2 y SP3— y el humano las resolvió el
2026-08-31, las tres por la opción recomendada. Quedan aquí como HD4, HD5 y HD6,
con el razonamiento medido que las motivó, porque quien implemente va a leer
HD1 («aclaración aditiva **dentro de § ⑤**») y necesita saber que esa frontera
creció.

**HD4 (era SP1) — el `400 MISSING_STORE_ID` se documenta, con una fila en la
tabla de errores.** «Sí: fila nueva en la tabla de errores.» Motivo del humano:
§ «Vocabulario de errores (v5)» dice que vale «para las siete rutas de arriba»,
así que hoy está incompleta, y añadir la fila no cambia ninguna respuesta. Va
marcada como aclaración de algo ya implementado, sin bump de versión.
**La frontera de HD1 queda ampliada a esa fila.** El problema que cierra: el
endpoint devuelve desde `src/app/api/internal/reconciliation/route.ts:15-17` un
código que el contrato no menciona (I2), y no era un descuido nuevo —
`.agent/specs/F-018/architecture.md:246-248` ya lo listaba entre los `400` que
«siguen dentro del handler… No cambian»—, así que el otro equipo tenía un `400`
que no podía interpretar el día que su cron tuviera un bug de plantilla de URL.
Se descartó mencionarlo solo en prosa dentro de § ⑤, y se descartó no
documentarlo. Concretado en R18 y en el punto 2 de C7.

**HD5 (era SP2) — la precondición de los ≤ 2 decimales se escribe en § ① y en
§ ⑤.** «En § ⑤ y también en § ① junto a `price`.» Motivo del humano: § ① es
donde lo lee quien **construye** el payload, que es el único que puede evitar el
problema; § ⑤ lo repite como precondición de la reconciliación.
**La frontera de HD1 queda ampliada también a esa frase de § ①.** El dato que lo
justifica ante el otro equipo, y que tiene que ir escrito al lado de la
precondición: `2.675` se serializa aquí como `"2.67"` —`payload.price.toFixed(2)`
en `src/features/sync/server/handlers/product.ts:136`, sobre el doble IEEE-754
más cercano, que es `2.67499…`— y `round(2.675, 2)` en Postgres da `2.68`;
comprobado ejecutando. Un céntimo de diferencia es un hash distinto **para
siempre**, y el arreglo no está del lado de queandabuscando: ese producto no
converge nunca. Se descartó callarlo y confiar en que `ProductoTienda.precio`
fuese `numeric(_,2)`: es justo el modo de fallo —la alerta nocturna que nadie
sabe explicar— que este feature existe para evitar. Concretado en R6, R7 y en el
punto 3 de C7.

**HD6 (era SP3) — el script es HTTP puro; lo que necesite la base va a tests.**
«Script HTTP puro + tests para lo demás.» Motivo del humano: no dejar basura en
una base local que comparten cuatro worktrees.
scripts/check-reconciliation.mjs (por crear) no importa Prisma y solo escribe a
través de los endpoints del contrato, como `scripts/send-catalog-batch.mjs`, el
estilo que HD3 manda replicar. Todo lo que necesite escritura o lectura directa
—los campos del panel de C3 y C4, las cuatro formas del precio de C9 y la
comparación con el SQL espejo de C8— va a tests `*.db.test.ts` con fixtures
aisladas por sesión (`src/features/marketplace/server/dbFixtures.ts`). Se
descartó el otro estilo que existe en el repo, el de
`scripts/renegotiate-order.mjs`, que siembra sus propios datos con Prisma.
Concretado en R15, en la introducción de § Criterios de aceptación propuestos y
en C8 y C9. C12 no cae en ninguna de las dos mitades y no contradice HD6: prueba
una función pura y por eso no necesita ni HTTP ni base.

## No decidido a propósito

- **Cada cuánto corre la reconciliación y con qué ventana.** Es del cron de
  cuadrecaja. El contrato ya dice «diario» y «alertar si no hubo corrida
  exitosa en 30 minutos»; este feature no lo cambia.
- **Qué hace queandabuscando cuando los hashes difieren.** Nada: no se entera.
  La acción correctora (`dispPublicada = NULL`) es del POS. Si algún día hace
  falta un endpoint de «resincroniza esta tienda», es un feature nuevo del
  humano (regla 4), no una ampliación de este.
- **El techo de tamaño de catálogo y si la query necesita índice.** Es de
  `architecture.md`: hoy es un `findMany` sin paginar sobre
  `(storeId, deletedAt, visible)`, que existe (`prisma/schema.prisma:449`).
- **La forma exacta de la salida del script** (tabla, JSON, colores). Del
  implementador, mientras el código de salida sea 0/≠0 y se vea qué falló.
