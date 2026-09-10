---
feature: F-044
agente: sdd-spec
actualizado: 2026-09-10T05:44:51Z
estado: listo
---

## Problema

El hash de reconciliación de § ⑤ cubre el catálogo publicado —`externalId`,
precio, moneda, disponibilidad— y **deja fuera el tarifario de envío**, que es
lo único del cable que es un precio y no tiene espejo. Si un `ZONE_TARIFF`
agota sus seis intentos de outbox, cuadrecaja cree que lo mandó, el encargado
ve su tabla, y aquí se cobra otro importe **para siempre y sin ruido**: en
productos eso es un catálogo viejo; aquí es dinero del comprador.

F-044 le da al tarifario **su propio hash por sucursal**, en la misma respuesta
que el de productos, con su pseudocódigo, su SQL espejo y su vector de prueba
publicados en `docs/sync-contract.md`, para que la divergencia la detecte una
comparación automática y no alguien que se acuerde de mirar.

## Alcance

### Dentro

1. **Dos campos aditivos en la misma respuesta** (D2):
   `GET /api/internal/reconciliation?storeId=` pasa de `{products, hash}` a
   `{products, hash, tariffs, tariffHash}`. Un endpoint, un cron, el mismo
   `404 UNKNOWN_STORE` y el mismo `400 MISSING_STORE_ID`.
2. **El cálculo del hash del tarifario** de una sucursal: qué filas entran, qué
   campos de cada una, cómo se serializa el importe, cómo se serializa la
   ausencia de importe y en qué orden se concatenan (R3-R10).
3. **El § ⑤ del contrato**, ampliado con el pseudocódigo del hash del
   tarifario, su SQL espejo con las decisiones que no se deducen del
   pseudocódigo, y el aviso de qué prueba y qué no prueba la implementación de
   este lado — con la misma estructura que ya tiene el de productos.
4. **El SQL espejo con los nombres del cable** (D1): sobre una tabla con
   `storeId`, `zoneCode`, `rule`, `deliveryFee`, con la nota explícita de que
   cuadrecaja ajuste los nombres de sus columnas, porque su tabla **todavía no
   existe**. Lo que fija la semántica es el vector, igual que en productos.
5. **El vector de prueba del hash del tarifario** en el contrato, en un bloque
   JSON con su `sha256` publicado, calculado **ejecutando**, y el test que lo
   lee **del propio documento** (R12, criterio 5).
6. **Que la divergencia solo alerte** (D3), y que el agujero de la fila que
   sobra de este lado —solo la corrige un `ZONE_TARIFF` con `rule: "INHERIT"` y
   `updatedAt` posterior— quede **documentado explícitamente** en el contrato.
7. **Las tres frases del contrato que dejan de ser ciertas** al construir esto
   (I1, I3) y la versión **v13.4** con su línea de cambios (R17, criterio 6).
8. **Las pruebas contra Postgres real** que verifican los criterios 2, 3 y 4
   ejecutando, y la prueba del espejo SQL contra `ZoneTariff` (E13, E14).

### Fuera (explícito)

1. **Cualquier acción automática de recuperación del tarifario.** D3: se
   alerta, y la recuperación la hace cuadrecaja reenviando. No se pone ninguna
   columna a `NULL`, no se borra ninguna fila, no se pide nada por otro canal.
2. **Apagar el domicilio de la sucursal mientras diverge.** Descartado en D3:
   una divergencia dejaría sin domicilio a un negocio que funciona.
3. **Tocar el hash de productos.** Ni su entrada, ni su orden, ni su SQL, ni su
   vector, ni el valor que devuelve para ninguna sucursal (R14). Los cambios de
   `src/features/sync/server/reconciliation.ts` son **aditivos**.
4. **Una query convergente para el tarifario**, análoga a la de § ② para la
   disponibilidad. No existe y D3 dice que no se inventa aquí.
5. **Un endpoint aparte o un objeto anidado** (`tariff: {rows, hash}`).
   Descartados en D2.
6. **Un hash de la configuración de la sucursal** (`Store.zoneCode`,
   `deliveryFeeMode`, `deliveryFee` de la columna, calendario). Este feature
   solo añade el tarifario; la configuración sigue sin espejo.
7. **Cambiar la entidad `ZONE_TARIFF`**: ni su payload, ni sus reglas, ni sus
   códigos de error, ni la guarda anti-rancio, ni que `DELETE` se rechace, ni
   que `INHERIT` sea la única retracción.
8. **Cambiar el cron, la autenticación o la periodicidad** de la
   reconciliación. La regla «alertar si no hubo una corrida exitosa en 30
   minutos» no se toca.
9. **La pantalla del tarifario y cualquier UI.** No hay nada visible para
   ningún usuario en este feature.
10. **Editar el documento de cuadrecaja.** El traslado del borrador lo hace el
    humano.

## Actores y precondiciones

Lo dispara **cuadrecaja** con su bearer token contra
`GET /api/internal/reconciliation?storeId=<externalId>`
(`src/app/api/internal/reconciliation/route.ts`), desde su cron de
reconciliación. Nadie más lo llama y no hay UI.

Lo que ya es cierto hoy, leído en el código, y de lo que dependen los
escenarios:

- **La identidad la da el token.** `withInternalAuth` resuelve
  `caller.businessId` y todo `where` va por él
  (`src/app/api/internal/reconciliation/route.ts`).
- **`storeId` es el `externalId` de la sucursal**, no el uuid interno, y una
  sucursal de otro negocio es indistinguible de una inexistente: las dos dan
  `404 UNKNOWN_STORE` (`storeReconciliationHash` hace
  `findFirst({ where: { externalId, businessId } })` y devuelve `null`).
- **El hash de productos es md5 en hexadecimal** sobre
  `<externalId>:<precio>:<moneda>:<disponibilidad>|` por fila, ordenadas por
  **bytes** de `externalId` con `utf8SortKey`/`compareUtf8Keys`
  (`src/lib/byteOrder.ts`), nunca por `ORDER BY`
  (`src/features/sync/server/reconciliation.ts`).
- **El precio se serializa con `syncedPrice.toString()`** —el `Decimal` de
  Prisma, que quita los ceros de relleno— y **nunca** con `Money.amount` de
  `src/lib/money.ts`, que siempre pone dos decimales. Está escrito en el
  comentario de `reconciliationEntry`.
- **Cero filas da `d41d8cd98f00b204e9800998ecf8427e`**, el md5 de la cadena
  vacía, y del lado SQL lo salva el `coalesce(..., '')` de fuera
  (`docs/sync-contract.md:3351-3360`, punto 3).
- **`ZoneTariff` existe desde F-041** con clave `(storeId, zoneCode)`, `rule`
  del enum `ZoneTariffRule { FEE, NOT_SERVED, INHERIT }`, `deliveryFee`
  **nullable** `Decimal(14,2)` y `sourceUpdatedAt`
  (`prisma/schema.prisma:419-438`).
- **`NOT_SERVED` e `INHERIT` escriben `deliveryFee = null` y la fila se
  queda**: el handler hace `upsert`, nunca `delete`
  (`src/features/sync/server/handlers/zoneTariff.ts`). `INHERIT` es la única
  retracción que existe.
- **`INHERIT` y «no hay fila» son el MISMO veredicto** para la resolución:
  `verdictOf` devuelve `decides: false` para los dos
  (`src/features/zones/precedence.ts`). Ninguna de las dos aporta importe ni
  cobertura a ninguna zona.
- **Las filas mueren con la sucursal**: la clave ajena es `onDelete: Cascade`
  y un `STORE` con `operation: "DELETE"` **aplicado** borra el tarifario de esa
  sucursal (R22 de `.agent/specs/F-041/spec.md`). Un `publishToStore: false`
  —vacaciones— no borra nada.
- **El importe del cable ya es múltiplo de `0.01`** y no negativo
  (`src/features/sync/schemas.ts:188`), y la columna es `Decimal(14,2)`: de
  este lado no puede existir un importe con tres decimales.
- **Un test puede leer el contrato**: `src/features/zones/precedence.test.ts`
  ya recorta la sección de un encabezado, extrae su único bloque ` ```json `
  con `/```json\n([\s\S]*?)\n```/`, lo ejecuta y **recalcula el `sha256`
  publicado** sobre esos mismos bytes. `src/features/zones/catalog.test.ts` y
  `src/features/sync/fieldOwnership.test.ts` usan el mismo recorte de sección.
- **El pooler corre en modo transacción**: nada de queries del cliente global
  dentro de un `$transaction` (AGENTS.md § Cosas que muerden).

## Comportamiento esperado

**E1 — la respuesta gana dos campos y no pierde ninguno.**
Dado un negocio autenticado con una sucursal suya que tiene tarifario, cuando
llega `GET /api/internal/reconciliation?storeId=<externalId>`, entonces la
respuesta es `200` con exactamente cuatro claves —`products`, `hash`,
`tariffs`, `tariffHash`—, `products` y `hash` valen **lo mismo, byte a byte**,
que antes de este feature, `tariffs` es un entero y `tariffHash` es md5 en
hexadecimal de 32 caracteres.

**E2 — la misma sucursal leída dos veces sin cambios da el mismo hash.**
Dado que entre las dos lecturas no se aplica ningún evento, cuando se llama dos
veces seguidas al endpoint, entonces las cuatro claves son idénticas
(criterio 2, segunda mitad).

**E3 — dos sucursales con tarifarios distintos dan hashes distintos.**
Dadas dos sucursales del mismo negocio cuyos conjuntos de filas difieren en al
menos una —el `zoneCode`, el `rule` o el importe—, cuando se lee cada una,
entonces sus `tariffHash` son distintos (criterio 2, primera mitad).

**E4 — el orden de inserción no cambia el hash.**
Dadas dos sucursales con el **mismo** conjunto de filas, insertadas en órdenes
opuestos, cuando se lee cada una, entonces sus `tariffs` y `tariffHash` son
iguales.

**E5 — aplicar un `ZONE_TARIFF` mueve el hash de esa sucursal y de ninguna
otra.**
Dadas dos sucursales `A` y `B` del mismo negocio y los cuatro campos de las dos
leídos antes, cuando llega un lote a `POST /api/internal/sync/catalog` con un
`ZONE_TARIFF` `FEE` de una zona nueva de `A` que responde `processed`, entonces
`tariffHash` de `A` cambia y su `tariffs` sube en uno, y `tariffs`/`tariffHash`
de `B` son idénticos a los de antes (criterio 3).

**E6 — un `ZONE_TARIFF` que no se aplica no mueve nada.**
Dado un `ZONE_TARIFF` que responde `stale`, `failed` o
`skipped_not_published`, cuando se releen los cuatro campos, entonces valen
exactamente lo mismo que antes del lote.

**E7 — la retracción converge.**
Dada una sucursal con una fila `FEE` de la zona `Z`, cuando se aplica un
`ZONE_TARIFF` de `Z` con `rule: "INHERIT"` y `updatedAt` posterior, entonces
`tariffs` **baja en uno** y `tariffHash` cambia — y si esa era su única fila
que publica algo, los dos campos valen `0` y `d41d8cd98f00b204e9800998ecf8427e`.
Es el camino de recuperación de D3, y esta es la prueba de que converge.

**E8 — `NOT_SERVED` sobre `FEE` cambia el hash sin cambiar la cuenta.**
Dada una fila `FEE` de la zona `Z`, cuando se aplica un `NOT_SERVED` de `Z`,
entonces `tariffs` no cambia y `tariffHash` sí.

**E9 — una sucursal sin ninguna fila de tarifario.**
Dada una sucursal del negocio sin ninguna fila en `ZoneTariff`, cuando se lee,
entonces la respuesta es `200` con `tariffs: 0` y
`tariffHash: "d41d8cd98f00b204e9800998ecf8427e"` — ni error, ni `null`, ni
cadena vacía (criterio 4).

**E10 — una sucursal cuyas únicas filas son `INHERIT` da el hash vacío.**
Dada una sucursal con una o más filas y todas con `rule: "INHERIT"`, cuando se
lee, entonces la respuesta es la misma de E9. Es deliberado: `INHERIT` y «no
hay fila» son el mismo veredicto (R3).

**E11 — sucursal ajena o inexistente.**
Dado un `storeId` de otro negocio o que no existe, cuando se llama al endpoint,
entonces la respuesta es `404` con `{"error":"UNKNOWN_STORE"}` y **ningún**
campo de tarifario en el cuerpo, igual que hoy.

**E12 — sin `storeId`.**
Dado un token válido y una petición sin `storeId` o con `storeId=`, entonces la
respuesta es `400 MISSING_STORE_ID` y no se consulta ni el catálogo ni el
tarifario.

**E13 — el espejo SQL publicado reproduce el hash.**
Dado el SQL del § ⑤ copiado del contrato y ejecutado contra `ZoneTariff` con el
uuid interno de la sucursal, cuando se compara con la respuesta del endpoint,
entonces `tariffs` y `tariffHash` coinciden — también sobre la sucursal vacía
de E9.

**E14 — dos lecturas ingenuas del espejo tienen que diferir.**
Dado el mismo fixture de E13, cuando se ejecuta el espejo (a) sin normalizar el
importe (`"deliveryFee"::text` a secas, sin `round`/`trim`) o (b) sin excluir
las filas `INHERIT`, entonces el hash resultante es **distinto** del del
endpoint. El fixture tiene que garantizar las dos: al menos un importe con
ceros de relleno y al menos una fila `INHERIT`.

**E15 — el vector del contrato se reproduce ejecutando, y contra la base.**
Dado el bloque JSON del vector leído de `docs/sync-contract.md`, cuando se pasa
cada caso por la **misma** función de producción que usa el endpoint, entonces
las entradas serializadas, la cuenta y el hash coinciden con los publicados; y
cuando las filas del caso `T1` se insertan en una sucursal real y se lee el
endpoint, entonces `tariffs` y `tariffHash` son exactamente los del vector.

**E16 — el `sha256` publicado del bloque coincide con sus bytes.**
Dado el mismo bloque, cuando el test recalcula su `sha256` sobre los bytes
capturados, entonces coincide con la línea publicada en el contrato; un vector
editado sin mover ese número pone la prueba en rojo **aquí**, antes que en
cuadrecaja.

**E17 — los dos hashes son independientes.**
Dado un lote que solo trae `ZONE_TARIFF`, entonces `products` y `hash` no
cambian; dado un lote que solo trae `PRODUCT`, entonces `tariffs` y
`tariffHash` no cambian.

**E18 — el hash no depende del modo de envío.**
Dada una sucursal con `deliveryFeeMode: "FLAT_RATE"` o con
`deliveryEnabled: false` que tiene filas de tarifario, cuando se lee, entonces
sus filas entran en el hash igual que las de una `ZONE_BASED`.

## Reglas de negocio

**R1 — un solo endpoint y campos aditivos (D2).** La respuesta `200` pasa a ser
`{products, hash, tariffs, tariffHash}`. Los dos campos viejos **no cambian de
nombre, de tipo ni de valor**. Un lector de la v12.1 que ignore los dos campos
nuevos sigue siendo un lector correcto. `404 UNKNOWN_STORE` y
`400 MISSING_STORE_ID` se conservan tal cual, con el mismo cuerpo.

**R2 — una sola resolución de la sucursal por petición.** El mismo `Store`
—resuelto por `(externalId, businessId)`— decide el `404` y acota las dos
consultas. No existe ningún camino en el que `products`/`hash` describan una
sucursal y `tariffs`/`tariffHash` otra, ni uno en el que el tarifario responda
`200` sobre una sucursal para la que el catálogo respondería `404`.

**R3 — qué filas entran: `FEE` y `NOT_SERVED`; `INHERIT` NO.** El hash se
calcula sobre las filas de `ZoneTariff` de esa sucursal cuyo `rule` es `FEE` o
`NOT_SERVED`. Las de `rule = "INHERIT"` **no entran ni en `tariffs` ni en
`tariffHash`**. Las tres razones, porque es la decisión que más fácil se
falsea:

1. **`INHERIT` no publica nada.** Para la resolución de la tarifa, `INHERIT` y
   «no hay fila» son el **mismo** veredicto: `verdictOf` devuelve
   `decides: false` para los dos (`src/features/zones/precedence.ts`). El
   importe que se le cobra a un comprador de cualquier zona es una función
   **solo** de las filas `FEE` y `NOT_SERVED`; por tanto **dos lados con el
   mismo conjunto de filas `FEE`/`NOT_SERVED` cobran lo mismo en todas las
   zonas**, que es exactamente —ni más ni menos— lo que este hash tiene que
   afirmar. Es el mismo principio del punto 1 del SQL de productos: se compara
   lo que los dos lados creen haber **publicado**, no su contabilidad interna.
2. **La retracción tiene que converger sin depender de la tabla de
   cuadrecaja.** `INHERIT` es la única retracción que existe, y su tabla **no
   existe todavía** (D1): no sabemos si guardarán una fila `INHERIT` o
   borrarán la suya. Con `INHERIT` fuera del hash, los dos lados convergen en
   las dos formas. Con `INHERIT` dentro, un POS que borre al retractarse
   divergiría **para siempre** contra nuestra fila `INHERIT`, que es
   justamente el modo de falla que el punto 5 del SQL de productos describe:
   alerta y recuperación, una y otra vez, sobre datos correctos.
3. **No pierde detección.** Un `INHERIT` que se pierde por el camino deja aquí
   la fila `FEE` vieja: nosotros aportamos una entrada que ellos no aportan
   —cobrando de más—, y el hash **y** la cuenta difieren. Se detecta igual.

   El costo aceptado, escrito para que nadie lo descubra depurando: el hash
   **no distingue** «hay una fila `INHERIT`» de «no hay fila». Es una
   diferencia sin consecuencia sobre el importe, y se acepta a cambio de las
   razones 1 y 2.

**R4 — qué campos de cada fila, y en qué forma.** La entrada canónica de una
fila es exactamente:

```
<zoneCode>:<rule>:<importe>|
```

y nada más. **No entra `storeId`**: es el filtro de la consulta, y además los
dos lados lo identifican distinto (aquí el uuid interno, allí su `Tienda.id`),
así que incluirlo garantizaría la divergencia. **No entran** `sourceUpdatedAt`,
`createdAt` ni `updatedAt`: el hash compara el estado publicado, no cuándo se
escribió, y una marca de tiempo haría diferir dos lados que ya cobran lo mismo.

**R5 — el importe se serializa como el precio de productos, sin ceros de
relleno.** De este lado, `deliveryFee.toString()` sobre el `Decimal` de Prisma
—la misma primitiva que `reconciliationEntry` usa con `syncedPrice`—; del lado
del espejo, la misma expresión ya publicada:
`trim(trailing '.' from trim(trailing '0' from round(<importe>::numeric, 2)::text))`.
Así `300.00` entra como `300`, `250.50` como `250.5` y `0.00` como `0`.

Tres razones para no inventar una segunda serialización: es la **misma columna
`Decimal(14,2)`** con la misma precondición de dos decimales; cuadrecaja ya
tiene esa expresión escrita y cruzada para productos, y **una sola regla por
endpoint** es lo que evita que la segunda se copie mal; y el propio comentario
de `reconciliationEntry` ya deja escrito que la forma de dos decimales es
«exactamente el hash equivocado» para una entrada de reconciliación.

**Y el aviso que va con ella:** `toDecimalString` de `src/lib/money.ts` —que
siempre da dos decimales— es lo que usa la **resolución** de la tarifa y lo que
publica `expected.deliveryFee` del vector de precedencia. Son dos
serializaciones distintas a propósito, para dos propósitos distintos, y no se
«armonizan»: reutilizar `toDecimalString` aquí rompe el hash.

**R6 — el hueco del importe es la cadena vacía, y se pone con un `coalesce`
explícito.** Una fila que no publica importe —`rule` distinto de `FEE`, o la
columna nula— entra con el hueco **vacío**: `03.05:NOT_SERVED:|`. Las razones:

1. **Ninguna cantidad válida serializa a la cadena vacía.** `0.00` da `0`, no
   `""`, así que el hueco vacío significa «sin importe» sin ambigüedad y no
   colisiona con el envío gratis.
2. **La condición se escribe sobre `rule`, no sobre la nulidad de la
   columna**, porque su tabla no existe (D1) y podría tener la columna
   `NOT NULL DEFAULT 0`: el espejo publica
   `case when rule = 'FEE' then <importe serializado> end` envuelto en
   `coalesce(..., '')`, que cubre las dos causas —regla que no es `FEE`, y
   columna nula— con una sola expresión, y hace que un `0` guardado bajo un
   `NOT_SERVED` no cambie el hash de nadie.
3. **El `coalesce` es obligatorio, no cosmético.** Es el punto 2 del SQL de
   productos otra vez: sin él, `NULL || ':'` es `NULL`, `string_agg` se salta
   la fila **entera** y el hash cambia mientras `count(*)` no — dos cifras que
   dejarían de describir el mismo conjunto.

Del lado de Node, la misma condición:
`row.rule === "FEE" && row.deliveryFee !== null ? row.deliveryFee.toString() : ""`.

**R7 — `rule` viaja verbatim.** Los tres literales del cable —`FEE`,
`NOT_SERVED`, `INHERIT`— tal cual, sin abreviar, sin traducir y sin mapear a un
número. En el espejo se castea a texto (`rule::text` si su columna es un enum;
si ya es texto, el cast sobra) y en Node se usa el valor del enum de Prisma,
que es esa misma cadena.

**R8 — el orden es de bytes de `zoneCode`, calculado en Node.** Con
`utf8SortKey`/`compareUtf8Keys` de `src/lib/byteOrder.ts`, precomputando la
clave una vez por fila, **nunca** delegado a un `ORDER BY` ni a `.sort()` ni a
`.localeCompare()`; el espejo publica `ORDER BY "zoneCode" COLLATE "C"`. Es la
misma regla que ya obedece el hash de productos y por el mismo motivo: dos
colaciones sobre los mismos datos dan hashes distintos, y las dos bases son de
dos organizaciones distintas. Que hoy los `zoneCode` sean ASCII (`^\d{2}$` y
`^\d{2}\.\d{2}$`) y las dos ordenaciones coincidan **no es una razón para
relajarlo**: un hash cuyo orden dependa de la colación del despliegue no es
verificable, y la regla no cuesta nada.

**R9 — cero filas da un hash definido y estable.** Una sucursal sin ninguna
fila que entre en el hash responde `{ "tariffs": 0, "tariffHash":
"d41d8cd98f00b204e9800998ecf8427e" }` — el md5 de la cadena vacía, el mismo
valor que ya devuelve el catálogo vacío. Del lado del espejo lo salva el
`coalesce(..., '')` **de fuera**, sin el cual `string_agg` sobre cero filas da
`NULL` y `md5(NULL)` es `NULL`, que no es un hash (es el fallo ya fichado para
productos, punto 3 de su SQL, y la nota del propio feature).

**R10 — md5 en hexadecimal minúsculo, como el hermano.** Ni sha256 ni ninguna
otra función: el valor no protege de un adversario, describe un conjunto, y la
coherencia con el hash de al lado vale más que el tamaño del digest. (El
`sha256` de R12 es otra cosa: cubre los **bytes del documento**, no los datos.)

**R11 — el SQL espejo se publica con los nombres del cable, con su aviso y con
sus decisiones numeradas (D1).** Sobre una tabla con `storeId`, `zoneCode`,
`rule` y `deliveryFee`, con la nota explícita «ajustad los nombres de vuestras
columnas», y con la frase que ya lleva el de productos: **lo que fija la
semántica es el vector de prueba**. Las decisiones que el pseudocódigo no
deduce y que el contrato tiene que numerar, como hace el de productos, son al
menos estas cinco:

1. `INHERIT` excluido (R3), con la razón, no como un filtro sin explicar.
2. El hueco vacío del importe y su `coalesce` interior (R6).
3. El `coalesce(..., '')` de fuera, para la sucursal sin filas (R9).
4. La serialización del importe sin ceros de relleno (R5), con la precondición
   de los dos decimales heredada de § ①: el importe del cable es múltiplo de
   `0.01`, y con tres decimales los dos lados divergirían en el redondeo de
   forma permanente, igual que `2.675` en productos.
5. **Las filas de una sucursal dada de baja se excluyen del lado que tiene la
   marca.** Aquí un `STORE` con `operation: "DELETE"` aplicado **borra** el
   tarifario de esa sucursal (R22 de `.agent/specs/F-041/spec.md`), así que un
   espejo que siga contando las filas de una sucursal que ellos dieron de baja
   divergiría y **no volvería a converger nunca**. Es la misma clase de
   decisión que el punto 5 del espejo de productos (S-002). Un
   `publishToStore: false` —vacaciones— **no** borra nada aquí y **no** debe
   excluir nada allí.

La forma que el contrato tiene que publicar, en su redacción final, es esta:

```sql
SELECT count(*) AS tariffs,
       md5(coalesce(string_agg(
              t."zoneCode" || ':' ||
              t."rule"::text || ':' ||
              coalesce(case when t."rule" = 'FEE'
                            then trim(trailing '.' from
                                 trim(trailing '0' from round(t."deliveryFee"::numeric, 2)::text))
                       end, '') || '|',
              '' ORDER BY t."zoneCode" COLLATE "C"
            ), '')) AS "tariffHash"
FROM "ZoneTariff" t
WHERE t."storeId" = $1
  AND t."rule" <> 'INHERIT';
```

**R12 — el vector va en el contrato y el test lo lee del propio documento.** En
un bloque ` ```json ` bajo un encabezado propio, con `version`, y con **dos**
casos: uno de varias filas y uno de cero filas. Cada caso publica sus `rows`
—en la forma de la tabla, con el importe como cadena de dos decimales o `null`,
y **en un orden distinto del orden por bytes**, para que una implementación que
concatene «según le llegan» falle—, y su `expected` con `tariffs`, la lista
ordenada de `entries` serializadas y `tariffHash`. Publicar las entradas —que
el vector de productos no publica porque es prosa— es lo que permite decir si
la diferencia está en el **orden** o en la **serialización**, que es la frase
con la que se cierra el vector de productos.

El contenido mínimo, con las entradas que fijan la semántica de R3-R8:

| `zoneCode` | `rule`       | `deliveryFee` | Entrada               |
| ---------- | ------------ | ------------- | --------------------- |
| `23.05`    | `FEE`        | `300.00`      | `23.05:FEE:300\|`     |
| `23.01`    | `FEE`        | `250.50`      | `23.01:FEE:250.5\|`   |
| `03`       | `FEE`        | `0.00`        | `03:FEE:0\|`          |
| `03.05`    | `NOT_SERVED` | `null`        | `03.05:NOT_SERVED:\|` |
| `40.01`    | `INHERIT`    | `null`        | **ninguna** (R3)      |

(la barra invertida de la última columna es solo el escape de la tubería
**dentro de la tabla**: la entrada real acaba en el separador de R4.)

con `tariffs = 4`, las entradas concatenadas en orden de bytes —`03`, `03.05`,
`23.01`, `23.05`— y `tariffHash` **calculado ejecutando** la implementación
sobre esas cinco filas literales, nunca a mano. El segundo caso es
`rows: []` con `tariffs: 0`, `entries: []` y
`tariffHash: "d41d8cd98f00b204e9800998ecf8427e"`, que es como el criterio 4 se
verifica **leyéndolo**.

**El mecanismo del test es el que ya existe, no uno nuevo:** recortar la
sección de su encabezado hasta el siguiente de nivel 2-4, capturar su **único**
bloque con `/```json\n([\s\S]*?)\n```/` —fallando ruidosamente con cero, con
dos o con JSON inválido—, ejecutar cada caso y afirmar que se ejecutaron
exactamente tantos como declara el documento, más el recálculo del `sha256`
sobre **esos mismos bytes capturados** contra la línea publicada. Es, línea por
línea, lo que hace `src/features/zones/precedence.test.ts`; el recorte de
sección lo comparten `src/features/zones/catalog.test.ts` y
`src/features/sync/fieldOwnership.test.ts`.

**R13 — un `sha256` propio para el bloque nuevo, y que no colisione con el que
ya hay.** El contrato publica el `sha256` del bloque del vector del tarifario
con su propia frase, porque cuadrecaja no puede leer este documento desde su CI
(`QAB_DOCS_PATH` no está puesta allí) y fija su copia contra el número. La
frase nueva **no puede contener** la cadena `sha256 del bloque JSON del vector
(v13):`, que es lo que ancla la expresión regular de
`src/features/zones/precedence.test.ts`: si la contuviera, ese test empezaría a
comparar el hash equivocado.

**R14 — el hash de productos no se toca.** Ni la entrada, ni el orden, ni el
SQL, ni el vector, ni el valor devuelto para ninguna sucursal. Se verifica
ejecutando (E17): un lote de solo `ZONE_TARIFF` deja `products` y `hash`
idénticos.

**R15 — el hash no depende de la configuración de la sucursal.** Ni de
`deliveryFeeMode`, ni de `deliveryEnabled`, ni de `Store.zoneCode`, ni de si la
zona sigue en el catálogo publicado: el hash es una función **solo** de las
filas de `ZoneTariff` de esa sucursal. Una zona retirada del catálogo sigue
aceptando tarifa (§ «La entidad `ZONE_TARIFF`») y su fila entra en el hash como
cualquier otra.

**R16 — el costo es una consulta más por petición.** Como máximo 184 filas por
sucursal (16 de primer nivel + 168 municipios), tres columnas. No se toca el
número de consultas del hash de productos ni se mete ninguna de las dos en un
`$transaction` (el pooler corre en modo transacción).

**R17 — la versión del contrato queda en v13.4.** El contrato es **borrador sin
publicar** desde la v13 y su propia entrada de la v13.1 dice que mientras no
salga cada edición mueve un dígito **menor** —v13.1 (F-042), v13.2 (F-043),
v13.3 (F-045)—, así que F-044 lo deja en **v13.4**, con su párrafo en § «Cambios
respecto a la v12.2». Los dos campos nuevos de la respuesta son vocabulario
nuevo del cable y viajan dentro de la **mayor v13**, que es la que se coordina
con cuadrecaja antes de publicarse (criterio 6); el día que la v13 salga, su
párrafo de cambios tiene que **nombrar los dos campos**, para que un lector de
la v12.2 sepa que la respuesta de ⑤ creció.

**R18 — la divergencia solo alerta, y el agujero se documenta (D3).** El
contrato tiene que decir, con letra y no entre líneas: (a) que para el
tarifario **no hay query convergente** ni acción de recuperación de este lado;
(b) que una fila que sobre aquí **no se puede borrar desde aquí**, porque
`DELETE` está rechazado y `INHERIT` es la única retracción, y que solo la
corrige un `ZONE_TARIFF` con `rule: "INHERIT"` y `updatedAt` posterior; (c) que
mientras diverge el domicilio de la sucursal **sigue funcionando**, con el
importe que este lado tiene. Y tiene que dejar claro —hoy la frase de § ⑤ es
una sola para un solo hash— que la recuperación que sí existe
(`dispPublicada = NULL` y la query convergente) es **solo** la de productos: un
tarifario divergente no se arregla resincronizando el catálogo.

**R19 — sin instrumentación nueva.** Este feature no añade logs. Si la
implementación decidiera añadir alguno, `console.warn` con el prefijo
`[scope]` al principio de la línea, nunca `console.error`
(AGENTS.md § Cosas que muerden).

## Casos límite y errores

1. **Sucursal sin filas** → R9/E9: `200`, `0`, el md5 de la vacía. Nunca un
   `null`, una cadena vacía ni un `500`.
2. **Sucursal solo con filas `INHERIT`** → el mismo resultado que la vacía
   (E10). Es el costo aceptado de R3, escrito para que no se descubra
   depurando.
3. **Fila `FEE` con importe nulo.** Es representable en el schema
   (`prisma/schema.prisma:427`) e **inalcanzable por el cable** (la unión
   discriminada exige el importe con `FEE`). Si existiera —una escritura
   manual—, entra con el hueco vacío (R6) y ni rompe ni desaparece del
   conjunto. Es coherente con la resolución, que trata esa fila como que **no
   decide**.
4. **Envío gratis contra zona no servida.** `03:FEE:0|` y `03:NOT_SERVED:|` son
   entradas distintas: el hash no puede confundir «gratis» con «no la sirvo»,
   que es una diferencia de dinero.
5. **Importe con más de dos decimales.** Imposible de este lado —columna
   `Decimal(14,2)` y `multipleOf(0.01)` en el sobre—, pero la precondición se
   publica igual, porque su columna es desconocida (D1) y ahí es donde el
   redondeo divergiría para siempre.
6. **`STORE` con `operation: "DELETE"` aplicado** → el tarifario de esa
   sucursal desaparece aquí y el hash pasa a `0`/`d41d…`; el espejo tiene que
   excluir esas filas del lado que tiene la marca (R11, punto 5). Un
   `publishToStore: false` no borra nada y no cambia el hash.
7. **Lectura concurrente con un lote entrando.** La lectura no toma un
   instantáneo del lote: puede ver un estado intermedio y dar una divergencia
   **transitoria**, que la corrida siguiente resuelve. Es exactamente la misma
   propiedad que ya tiene el hash de productos y este feature **no la cambia**;
   no se añade ninguna regla nueva sobre cuántas corridas hacen falta para
   alertar.
8. **Reintento del `GET`.** Es de solo lectura e idempotente: no escribe nada,
   no invalida caché, no marca nada.
9. **Sucursal ajena o inexistente** → `404 UNKNOWN_STORE` (E11). La cuenta y el
   hash **nunca** se usan para distinguir esos dos casos: eso ya lo decide el
   código de estado, y el contrato dice que son indistinguibles a propósito.
10. **Colisión de md5.** Dos conjuntos distintos con el mismo hash es teórico y
    se acepta, igual que en productos: el hash describe un conjunto, no defiende
    de un adversario.
11. **Sucursal con las 184 filas.** Entra entera; no hay paginación ni tope, y
    ninguna fila se muestrea.

## Datos y contrato

**La respuesta de `GET /api/internal/reconciliation?storeId=`:**

| Campo        | Tipo     | Valor                                                              |
| ------------ | -------- | ------------------------------------------------------------------ |
| `products`   | entero   | Filas del catálogo publicado que entran en `hash`. **No cambia**   |
| `hash`       | `string` | md5 hex de 32. **No cambia** (R14)                                 |
| `tariffs`    | entero   | Filas de `ZoneTariff` de la sucursal con `rule` ≠ `INHERIT` (R3)   |
| `tariffHash` | `string` | md5 hex de 32 sobre la concatenación de R4-R8; `d41d…` si son cero |

**El pseudocódigo que el contrato tiene que publicar**, junto al de productos:

```
md5( concat( zoneCode ":" rule ":" importe "|" )
     sobre las filas con rule ∈ {FEE, NOT_SERVED}, ordenado por bytes de zoneCode )
```

donde `importe` es el importe sin ceros de relleno cuando `rule = FEE`, y la
cadena vacía en cualquier otro caso.

**Lo que el contrato tiene que decir de este lado, con la misma honestidad que
el de productos:** la traducción se verifica contra filas de `ZoneTariff`, no
contra la tabla de cuadrecaja — valida el orden, los separadores, la
serialización del importe, el hueco vacío y la exclusión de `INHERIT`. **No
valida** los nombres de sus columnas, ni que su tabla guarde una fila por
`(sucursal, zona)`, ni su exclusión de las sucursales dadas de baja: eso solo lo
puede comprobar cuadrecaja ejecutando el SQL contra su base.

**Secciones del contrato que este feature toca** (las edita la implementación,
no esta spec): § ⑤ Reconciliación —pseudocódigo, SQL espejo, orden,
precondición, qué prueba y qué no, vector—, la primera línea de versión, §
«Cambios respecto a la v12.2», y la frase de `docs/sync-contract.md:212` que
todavía dice que el `storeId` de ⑤ «no existe para `ZONE_TARIFF`».

## Criterios de aceptación propuestos

Los siete de `.agent/features.json` `[ya]`, cada uno con lo que hay que
ejecutar:

1. `[ya]` **El § de reconciliación publica el hash del tarifario con su
   pseudocódigo y su SQL espejo.** Verificable ejecutando: copiar el bloque
   `sql` del § ⑤ tal cual y correrlo contra `ZoneTariff` con el uuid interno de
   una sucursal de fixture da los mismos `tariffs`/`tariffHash` que el endpoint
   (E13), y las dos variantes ingenuas difieren (E14).
2. `[ya]` **Dos sucursales con tarifarios distintos dan hashes distintos, y la
   misma leída dos veces sin cambios da el mismo.** `*.db.test.ts` contra
   Postgres real: E2 y E3.
3. `[ya]` **Aplicar un `ZONE_TARIFF` cambia el hash de esa sucursal y no el de
   ninguna otra, verificado antes y después.** `*.db.test.ts` que hace el
   `POST /api/internal/sync/catalog` real y lee el endpoint antes y después:
   E5, con E6 y E7 al lado.
4. `[ya]` **Una sucursal sin ninguna fila tiene un hash definido y estable.**
   `expect(body).toEqual({ ..., tariffs: 0, tariffHash: "d41d8cd98f00b204e9800998ecf8427e" })`
   contra la base real, más el caso de cero filas **publicado en el vector** y
   leído del documento (E9, E15).
5. `[ya]` **El vector está en el contrato con su resultado calculado
   ejecutando, y el test lo lee del propio documento y no de una copia.** El
   test del proyecto `server` que lee el bloque, ejecuta los dos casos, afirma
   que ejecutó tantos como declara el documento y recalcula el `sha256`
   publicado (E15, E16, R12, R13).
6. `[ya]` **`docs/sync-contract.md` sube de versión.** `sed -n 3p` de la
   primera página dice **v13.4**, hay párrafo nuevo en § «Cambios respecto a la
   v12.2», y el hook `.claude/hooks/sync-contract-version.sh` no protesta. La
   coordinación con cuadrecaja es la de la **v13 entera**, que sigue sin
   publicarse (R17, I1).
7. `[ya]` **`bash .agent/verify.sh F-044 --full` termina con código 0.**

Propuestos, **no** cuentan para `sdd.sh done`:

8. `[nuevo]` **Las filas `INHERIT` no entran y el hueco del importe es la
   cadena vacía, verificado ejecutando.** Una sucursal cuya única fila es
   `INHERIT` responde `0`/`d41d…` (E10), y el espejo que no las excluye da otro
   hash (E14b). Es la decisión de R3/R6 y la que más fácil se falsea.
9. `[nuevo]` **Los dos hashes son independientes.** Un lote de solo
   `ZONE_TARIFF` deja `products` y `hash` byte a byte iguales, y uno de solo
   `PRODUCT` deja `tariffs` y `tariffHash` iguales (E17).
10. `[nuevo]` **El orden no lo decide la inserción.** Dos sucursales con el
    mismo conjunto de filas insertadas al revés dan el mismo `tariffHash`
    (E4).

## Incongruencias detectadas

**I1 — el criterio 6 pide coordinar la versión con cuadrecaja «antes de
publicarla», y § «Versionado de este documento» llamaría _mayor_ a dos campos
nuevos en una respuesta.** `docs/sync-contract.md:36-38` dice que cambia lo que
el POS «envía o **recibe**» → mayor, coordinada antes. Pero el contrato es
**borrador sin publicar** desde la v13 y su propia entrada de la v13.1
(`docs/sync-contract.md:82-88`) fija que mientras no salga cada edición mueve un
dígito menor del mismo borrador. **No se reabre** (decisión del humano,
`.agent/progress/F-044.md` § «Notas para quien retome»): la mayor que lleva
estos dos campos es la **v13**, y la coordinación es la que ya está pendiente
para ella entera. Lo que sí exige esta spec es que el párrafo de publicación de
la v13 **nombre los dos campos nuevos** (R17), o un lector de la v12.2 no se
enteraría de que la respuesta de ⑤ creció.

**I2 — el criterio 1 pide el SQL espejo «como ya lo tiene el hash de
productos», y el de productos va contra tablas reales de cuadrecaja
(`ProductoTienda`, `Producto`), que aquí no existen.** Su F-013 declara el
tarifario «tabla nueva … su forma exacta es del arquitecto». Resuelto por D1 y
**no reabierto**: se publica con los nombres del cable, con la nota de que
ajusten sus columnas, y la semántica la fija el vector. Queda anotado porque el
criterio, leído literal, promete un espejo tan verificable como el de
productos y **no lo es**: la mitad de sus nombres no la puede probar nadie de
este lado (R11, § Datos y contrato).

**I3 — el contrato afirma hoy algo que este feature vuelve falso.**
`docs/sync-contract.md:212` dice: «El `storeId` de ⑤ Reconciliación —que
todavía no existe para `ZONE_TARIFF`, es F-044—». Cuando F-044 esté construido
esa frase miente; la edita el mismo cambio que sube a v13.4.

**I4 — § ⑤ tiene una sola acción de recuperación escrita para un solo hash.**
`docs/sync-contract.md:3319`: «Si los hashes difieren: poner
`dispPublicada = NULL` en las filas de ese local … y alertar». Con dos hashes
en la misma respuesta, un lector aplicaría esa resincronización completa del
catálogo cuando lo único que divergió fue el tarifario — y no arreglaría nada,
porque la fila del tarifario no se puede tocar desde aquí (D3). El párrafo tiene
que decir qué acción pertenece a qué hash (R18).

**I5 — el test de la ruta afirma el cuerpo entero con `toEqual`.**
`src/app/api/internal/reconciliation/route.test.ts:41-47` compara contra
`{ products, hash }` exactamente, así que añadir dos campos lo pone en rojo. Es
deliberado y está bien: es el guardián de la forma de la respuesta. Se
actualiza en el mismo cambio, con los cuatro campos y **sin** relajar el
`toEqual` a un `toMatchObject`, que dejaría pasar un campo de más para
siempre.

## Huecos y preguntas al humano

Ninguna. D1, D2 y D3 cierran las tres decisiones que estaban abiertas, y las
demás —qué filas entran, cómo se serializa el nulo y el importe, el orden, el
caso de cero filas, el mecanismo del vector y la versión— se contestan con el
contrato y el código, y están decididas arriba con su razón.

## No decidido a propósito

1. **En qué archivos vive el cálculo y en cuáles las pruebas.** Es de
   `sdd-architect`. Esta spec solo exige que el endpoint y el test del vector
   usen **la misma** función que serializa y ordena, no dos implementaciones
   que hoy coincidan.
2. **Si la lectura del tarifario y la del catálogo comparten la resolución de
   la sucursal en una consulta o en dos.** Es de arquitectura; la propiedad
   observable está fijada en R2 y R16.
3. **Cómo se llaman las columnas de la tabla de cuadrecaja.** No es nuestro
   (D1). Se publica con los nombres del cable y su nota.
4. **Cuántas corridas divergentes seguidas disparan la alerta de cuadrecaja y
   con qué canal.** Es de su lado, y § ⑤ ya fija lo único que nos toca: que la
   divergencia se pueda observar y que no haya corrida exitosa en 30 minutos
   también alerte.
5. **Si algún día el tarifario merece una query convergente.** Hoy no la tiene
   y D3 dice que la recuperación es de ellos; si el agujero documentado
   resultara caro en producción, es un feature nuevo del humano (regla 4).
