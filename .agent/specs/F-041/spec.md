---
feature: F-041
agente: sdd-spec
actualizado: 2026-09-08T19:00:09Z
estado: listo
---

> **SUPERADO EN PARTE POR F-043 (2026-09-10).** El **criterio 6** de este
> feature —una zona desconocida es `400 INVALID_BATCH` de **lote**— ya **no
> describe lo que existe**, y con él R17, E9, la fila
> `ZONE_TARIFF_ZONE_UNKNOWN` de la tabla de códigos, los casos límite 4 y 5, y
> la incongruencia **I6**, que F-043 cerró en vez de conservar. Hoy ese
> `zoneCode` —ausente del catálogo **o** sin la forma del DPA, que el sobre ya
> no distingue— falla **solo su evento**, en `failed[]` del `207`. El porqué,
> medido en el código de cuadrecaja y no supuesto: un `400` les sube el
> contador de intentos de **todas** las filas del lote, no de la culpable. La
> especificación viva de este camino es `.agent/specs/F-043/`. No se edita el
> criterio 6 (regla 3): se anota que quedó superado, que es para lo que existió
> F-043.
>
> Nace de la **S-007** de cuadrecaja (`.agent/solicitudes.md` § «Abiertas»),
> **cerrada de diseño el 2026-09-06 entre los dos arneses** y todavía **sin
> publicar**: el contrato va por la v12.2 y esto es la **v13**. El análisis
> completo —problema, 11 reglas, 7 escenarios, y las secciones fechadas que
> cerraron SP1, SP2, SP3 y SP-H— está en
> `.agent/specs/propuestas/zonas-de-envio.md`, que esta spec **sustituye** como
> documento de referencia de este lado.
>
> **Es la mitad que no ve nadie.** La mitad visible —selector, mapa,
> `contact.zoneCode`, `contact.zoneName` y el pedido— es **F-042**, que depende
> de este. El corte lo decidió el orquestador al resolver la SP4 de la
> propuesta: «lo que no ve nadie» contra «lo que ven el comprador y el POS de un
> pedido concreto».
>
> **Cuatro decisiones del humano del 2026-09-08** que esta spec da por firmes y
> no vuelve a preguntar (`.agent/progress/F-041.md` § «Decisiones tomadas»):
> (1) el alcance del catálogo aquí es **solo el índice** código → nombre; la
> geometría es de F-042 y aquí no se genera ningún polígono ni se instala ninguna
> herramienta de simplificación; (2) los nueve municipios de Santiago de Cuba se
> siembran como `34.01`–`34.09`, con la errata de la fuente **citada**; (3) el
> borrador de la v13 sale hacia cuadrecaja **al firmar el plan**, y publicar la
> versión espera su visto bueno; (4) se implementan los **diez** casos del
> vector, no siete (ver I2).

## Problema

Los comercios cubanos cobran el envío **por municipio** y el contrato solo sabe
dos modos: `FLAT_RATE`, donde el comprador del municipio de al lado paga lo mismo
que el del otro extremo de la provincia, y `QUOTED_PER_ORDER`, donde **confirma
sin ver el costo del envío** y espera un ciclo de propuesta y aprobación que
nadie necesita cuando el comercio ya sabe su tarifario («Playa 300, Habana Vieja
250, Boyeros 500»).

Que el precio del envío dependa de **dónde** se entrega hoy no tiene forma de
existir de este lado, y no por falta de pantalla: falta el vocabulario entero.
`DeliveryFeeMode` tiene dos valores (`prisma/schema.prisma:44-47`), el sobre del
sync acepta seis entidades y ninguna habla de tarifas por zona
(`src/features/sync/schemas.ts:149-192`), no hay ninguna tabla de zonas, y la
dirección del comprador es texto libre: **ningún dato de la dirección es
computable**.

Este feature construye **solo la mitad de escritura y de vocabulario**: el enum
gana su tercer valor, el sobre su séptima entidad, la base su catálogo de zonas
sembrado con su versión, y la precedencia existe como función pura con su vector
publicado en el contrato. **Nadie lo lee todavía en una pantalla** — el único
lector nuevo es la propia resolución, y el comprador no ve nada distinto hasta
F-042.

## Alcance

### Dentro

1. **`ZONE_BASED`** como tercer valor de `DeliveryFeeMode`
   (`prisma/schema.prisma:44-47`), su migración aditiva, y su entrada en
   `deliveryFeeMode` del payload de `STORE` (`src/features/sync/schemas.ts:59`),
   que sale del enum generado y no de un literal (ADR 0028 § Consecuencias).
2. **El índice del catálogo de zonas** como artefacto commiteado con su
   procedencia: 16 divisiones de primer nivel y 168 municipios, con `code` DPA,
   nombre, **nivel declarado**, provincia a la que pertenece, id de relación de
   OSM, nombre que la zona tenía en OSM al generarse y marca de retirado (R1-R8).
3. **El informe de la unión** DPA ⋈ OSM, commiteado junto a los bytes, con las
   filas que necesitaron emparejamiento manual y la errata de Santiago de Cuba
   citada (R6, SP-H de la propuesta).
4. **El modelo `Zone`** (o el nombre que decida el arquitecto) y su **siembra
   idempotente**, con la versión del catálogo anotada y legible con una consulta
   (R9, criterio 11).
5. **La entidad `ZONE_TARIFF`** del outbox: séptima rama de la unión
   discriminada de `src/features/sync/schemas.ts:149-192`, el valor en el enum
   `SyncEntity` de la base (`prisma/schema.prisma:89`, sin el cual `recordBatch`
   no puede ni registrar el evento — `src/features/sync/server/inbox.ts:52`), su
   handler, su rama en el `switch` de `applyEvent`
   (`src/features/sync/server/processBatch.ts:160-179`) y su rama en
   `dependencyRoleOf` (`src/features/sync/dependencies.ts:51`).
6. **El modelo del tarifario**, una fila por `(storeId, zoneCode)` con su `rule`,
   su importe opcional y su marca de origen, con clave ajena a la sucursal.
7. **`Store.zoneCode`**: columna nueva, opcional, validada contra el catálogo,
   con su fila en la tabla de propiedad de campos del contrato (R29, criterio 9).
8. **La resolución de la tarifa por precedencia** como **función pura** con su
   test, y el **vector de diez casos con camino completo** publicado en JSON
   dentro de `docs/sync-contract.md`, calculado ejecutando (R26-R28).
9. **Un lector mínimo** que carga de la base las (como máximo dos) filas
   relevantes de un `(store, zoneCode)` y se las pasa a la función pura, para que
   el criterio 7 se verifique contra filas reales y no solo contra un fixture.
10. **Los códigos de error nuevos** en `src/constants/sync.ts`, en la misma forma
    que las cinco que ya viven ahí.
11. **La invalidación de caché** de la sucursal al aplicar un `ZONE_TARIFF`,
    apoyada en la maquinaria de F-035 y sin reimplementar nada (criterio 12).
12. **Lo que el tercer modo rompe al aparecer**: `DeliveryFeeModeName`
    (`src/features/orders/deliveryOffer.ts:15`) es una unión escrita a mano de
    dos literales y no compila con un tercer valor en el enum (I4). Entra en
    alcance dejar el sistema coherente y **sin cobrar de más** en la ventana
    entre este feature y F-042 (R11-R13).
13. **La v13 de `docs/sync-contract.md`**: borrador a cuadrecaja al firmar el
    plan, publicación con su visto bueno, y la línea fechada en
    `.agent/solicitudes.md` (criterio 13).
14. **Un paso operativo nuevo** en `docs/despliegue.md`: cómo entra el catálogo
    en un entorno nuevo (I8, AGENTS.md § Documentación).

### Fuera (explícito)

1. **Toda la geometría.** Polígonos, GeoJSON, simplificación topológica,
   proyección, tolerancia, redondeo de coordenadas y las dos comprobaciones de
   la unión de polígonos: **de F-042**, por decisión del humano del 2026-09-08.
   Aquí no se instala ninguna herramienta ni se genera ningún polígono. El
   artefacto de geometría ya tenía versión propia por diseño; esto solo decide en
   qué feature nace.
2. **El selector del checkout, el mapa, `contact.zoneCode`, `contact.zoneName`,
   las coordenadas del contacto y las columnas de `Order`.** Todo F-042.
3. **PostGIS y la búsqueda por cercanía.** La ADR 0011 **no se reabre**: su
   disparador escrito es «una consulta de tipo tiendas a menos de N km» y aquí
   las coordenadas no deciden el precio ni ordenan nada (I10).
4. **Geocodificar direcciones o confiar en el GPS.** La zona la elige la persona
   (F-042).
5. **Que los polígonos viajen por el sync.** Por el cable va el `code` y nada
   más.
6. **La pantalla del tarifario del encargado**, que es de cuadrecaja. De este
   lado solo se consume.
7. **Búsqueda o informes por zona.** No existen y nadie los ha pedido
   (§ «El costo asumido» de la propuesta).
8. **Cambiar la forma de la guarda anti-rancio de ninguna otra entidad**, ni el
   orden de `recordBatch` (`src/features/sync/server/inbox.ts:64`), ni la
   semántica de `skipped_not_published`.
9. **Cerrar el agujero de la resurrección en `CATEGORY`.** Está verificado como
   cosmético y se decidió no gastar una versión en él
   (`.agent/solicitudes.md`); aquí se cierra **de raíz** en `ZONE_TARIFF`, que es
   donde habría sido un importe cobrado.
10. **Editar el documento de cuadrecaja** (`.agents/solicitudes-qab.md`, en su
    repo). El traslado lo hace el humano.

## Actores y precondiciones

Lo dispara **cuadrecaja** contra `POST /api/internal/sync/catalog`
(`src/app/api/internal/sync/catalog/route.ts:23`) con su bearer token. Lo que el
sistema ya garantiza, verificado leyendo el código, y de lo que dependen los
escenarios:

- **La identidad la da el token, no el payload**
  (`src/features/sync/server/caller.ts`): `caller.businessId` es el uuid interno,
  `caller.externalId` el `Negocio.id` del POS. Todo `where` va por el primero.
- **Un `businessId` del payload que no case aborta el lote entero con `403`
  antes de escribir nada** (`src/features/sync/identity.ts`,
  `src/app/api/internal/sync/catalog/route.ts:39-41`), y por tanto **antes** de
  `recordBatch`: no queda fila de `SyncEvent` que un reintento pueda ver como
  `duplicate`.
- **Un `400` del schema mata el lote entero y tampoco escribe `SyncEvent`**
  (`src/app/api/internal/sync/catalog/route.ts:31-37`). Esto es lo que hace
  posible —y caro— el criterio 6 (I6, I7).
- **El orden de aplicación es el de `occurredAt`**, no el del array
  (`src/features/sync/server/inbox.ts:62-64`), con `sort` estable.
- **Un duplicado no entra en el bucle** (`processBatch.ts:57-60`).
- **Todo lo que no sea `failed` viaja en `ok`** (`src/features/sync/schemas.ts:271-279`).
  `stale` y `skipped_not_published` viajan en `ok`: son terminales.
- **Un fallo por evento se expresa lanzando `SyncEventFailure`**
  (`src/features/sync/server/handlers/types.ts:86`); el `catch` del bucle
  (`processBatch.ts:118-127`) ya lo convierte en `failed[].error`,
  `results[].error` y `markFailed`, sin tocar una línea allí.
- **La respuesta es `207`** mientras `processCatalogBatch` no lance
  (`src/app/api/internal/sync/catalog/route.ts:45`).
- **La invalidación se dispara una vez por lote**, no por evento
  (`processBatch.ts:132-143`), y el handler solo **reporta** lo tocado
  (`src/features/sync/server/handlers/types.ts:6-55`).
- **Un `STORE` con `operation: "DELETE"` NO borra la fila `Store`**: la suspende
  (`src/features/sync/server/handlers/store.ts:124-127`). Nada en el repositorio
  borra un `Store`. Es la premisa que el criterio 8 da por cierta y no lo es
  (I1).
- **El pooler corre en modo transacción**: ninguna query del cliente global
  dentro de un `$transaction` (AGENTS.md § Cosas que muerden). Precedente de cómo
  se escribe una guarda sin transacción:
  `src/features/sync/server/handlers/business.ts:83-95`.

## Comportamiento esperado

**E1 — un `ZONE_TARIFF` válido se guarda.**
Dado un negocio autenticado con una sucursal publicada y el catálogo sembrado,
cuando llega un lote con `entity: "ZONE_TARIFF"`, `operation: "UPDATE"` y
`payload: { storeId, zoneCode: "23.05", rule: "FEE", deliveryFee: 300, updatedAt: T }`,
entonces la respuesta es `207`, ese `eventId` está en `ok` con
`status: "processed"`, y existe **una** fila del tarifario para
`(esa sucursal, "23.05")` con `rule = FEE`, importe `300.00` y marca de origen
`T`, leída de la base.

**E2 — el mismo evento repetido no duplica.**
Dado E1 aplicado, cuando llega otro `ZONE_TARIFF` de la misma pareja con
`updatedAt` **mayor** y `deliveryFee: 350`, entonces `processed`, sigue habiendo
**una** fila y su importe es `350.00`.

**E3 — un `ZONE_TARIFF` rancio no pisa el importe vigente.**
Dado E2, cuando llega un `ZONE_TARIFF` de la misma pareja con `updatedAt` **menor
o igual** al guardado y `deliveryFee: 100`, entonces la respuesta es `207`, ese
evento sale `stale` —y por tanto **en `ok`**—, y la fila sigue con `350.00` y con
su marca anterior sin mover.

**E4 — `DELETE` se rechaza y no borra nada.**
Dado un tarifario con tres filas para una sucursal, cuando llega un
`ZONE_TARIFF` con `operation: "DELETE"` sobre una de ellas y un `updatedAt`
posterior, entonces ese evento sale en `failed[]` con
`error: "ZONE_TARIFF_DELETE_NOT_SUPPORTED"`, **no** está en `ok`, siguen habiendo
**tres** filas contadas antes y después, y la marca de origen de la fila apuntada
no se mueve.

**E5 — el rechazo del `DELETE` no depende de la marca de tiempo.**
Dado el mismo tarifario, cuando llega un `ZONE_TARIFF` con
`operation: "DELETE"` y un `updatedAt` **anterior** al guardado, entonces la
respuesta sigue siendo `failed[]` con `ZONE_TARIFF_DELETE_NOT_SUPPORTED` y
**nunca** `stale`: es entrada malformada, no una escritura vieja (precedente
literal de `src/features/sync/server/handlers/business.ts:61-68`, que es el
orden **opuesto** al de `handleCategory`).

**E6 — `FEE` sin importe es `400`.**
Dado un lote con un `ZONE_TARIFF` `rule: "FEE"` **sin** `deliveryFee` y un
`PRODUCT` válido detrás, cuando se envía, entonces la respuesta es `400` con
`{"error":"INVALID_BATCH","issues":[…]}`, ninguna fila de `SyncEvent` queda
escrita, el `PRODUCT` **no** se aplica y no se guarda ninguna tarifa.

**E7 — `NOT_SERVED` o `INHERIT` con importe es `400`.**
Ídem E6 con `rule: "NOT_SERVED"` y `deliveryFee: 0`, y otra vez con
`rule: "INHERIT"` y `deliveryFee: 300`. Presente es `400`, **nunca** un descarte
silencioso (precedente de `barcode`, `src/features/sync/schemas.ts:99-101`). Un
`deliveryFee: null` explícito en esas dos reglas también es `400`.

**E8 — un importe negativo es `400`.**
Dado un `ZONE_TARIFF` `rule: "FEE"` con `deliveryFee: -1`, entonces `400`, por el
mismo `nonnegative()` que ya protege a `STORE`
(`src/features/sync/schemas.ts:58`).

**E9 — una zona que no está en el catálogo es `400` con nombre propio.**
Dado un lote con un `ZONE_TARIFF` de `zoneCode: "99.99"` y un `PRODUCT` válido
detrás, cuando se envía, entonces la respuesta es `400` con
`issues[].message === "ZONE_TARIFF_ZONE_UNKNOWN"`, no se guarda ninguna tarifa,
no queda fila de `SyncEvent` y el `PRODUCT` no se aplica. La comprobación es
contra el **artefacto commiteado**, sin tocar la base (I7).

**E10 — una zona retirada no es una zona desconocida.**
Dado un catálogo donde `23.05` está marcada como retirada, cuando llega un
`ZONE_TARIFF` de esa zona, entonces la respuesta es `207 processed`, la fila se
guarda y se emite un `console.warn` con prefijo de dominio (nunca
`console.error`, AGENTS.md § Cosas que muerden). Una fila de una zona retirada
**sigue resolviendo**; que no se ofrezca es cosa del selector (F-042).

**E11 — un `ZONE_TARIFF` de una sucursal que aquí no existe se descarta limpio.**
Dado un `ZONE_TARIFF` con un `storeId` que no corresponde a ninguna fila `Store`
del negocio autenticado, entonces `status: "skipped_not_published"`, en `ok`, y
cero filas escritas (precedente literal de
`src/features/sync/server/handlers/product.ts:75`).

**E12 — una fila de provincia con `INHERIT` se acepta.**
Dado un tarifario donde la provincia `23` tenía `rule: "FEE"` con `400`, cuando
llega un `ZONE_TARIFF` de `zoneCode: "23"` con `rule: "INHERIT"` y `updatedAt`
posterior, entonces `processed` y la fila queda con `rule = INHERIT` y **sin**
importe. Es el único mecanismo de retracción que existe, en todos los niveles
(R20).

**E13 — y su consecuencia: la zona resuelve como no servida.**
Dado E12 y un municipio `23.07` **sin fila**, cuando se resuelve
`(esa sucursal, "23.07")` leyendo las filas de la base, entonces el resultado es
**no servida**, con `decidedBy: null` y un camino que dice: municipio ausente →
provincia `INHERIT` declina → no hay escalón encima.

**E14 — el `DELETE` de la sucursal se lleva su tarifario.**
Dado una sucursal con tres filas de tarifario, cuando llega un `STORE` con
`operation: "DELETE"` y un `updatedAt` posterior al guardado, entonces ese evento
sale `processed`, la sucursal queda suspendida como hasta ahora, y las filas de
tarifario de esa sucursal contadas después son **cero** (R22). Y por separado:
borrar la fila `Store` directamente arrastra sus filas por clave ajena.

**E15 — `deliveryFeeMode: "ZONE_BASED"` se guarda y se lee.**
Dado un `STORE` con `deliveryEnabled: true`, `deliveryFeeMode: "ZONE_BASED"` y
**sin** `deliveryFee`, cuando se envía contra la base real migrada, entonces
`processed` y la columna de esa sucursal lee `ZONE_BASED`. **No** responde
`STORE_DELIVERY_CONFIG_INCONSISTENT`: en `ZONE_BASED` lo que cierra el domicilio
es el tarifario, que puede llegar después y cambiar sin un evento `STORE` (R12,
I4).

**E16 — un `zoneCode` desconocido en un `STORE` falla ese evento entero.**
Dado un `STORE` con `zoneCode: "99.99"` y además un `phone` corregido, cuando se
envía, entonces ese evento sale en `failed[]` con
`error: "STORE_ZONE_UNKNOWN"`, **ninguno** de sus campos se aplica —ni el
teléfono—, su `sourceUpdatedAt` no avanza, y el resto del lote sí se aplica. Con
un `zoneCode` del catálogo, `processed` y la columna queda escrita (precedente
literal de `assertOpeningHoursValid`,
`src/features/sync/server/handlers/store.ts:192`).

**E17 — una tienda `ZONE_BASED` no cobra el importe residual.**
Dado una sucursal con `deliveryFeeMode: "ZONE_BASED"`, `deliveryEnabled: true` y
un `deliveryFee` residual de `500.00` en su columna, cuando un comprador crea un
pedido pidiendo `fulfillment: "DELIVERY"` **antes de que exista F-042**, entonces
el pedido **no** se cobra a `500.00` ni a `0.00` como envío: se cierra como
`PICKUP` con `0.00`, que es la degradación silenciosa que ya existe cuando el
domicilio no se ofrece, y **nunca** entra en el ciclo de cotización de F-019/F-031
(R11, R13).

**E18 — aplicar un `ZONE_TARIFF` expira las páginas de esa sucursal.**
Dado una sucursal publicada, cuando se aplica un `ZONE_TARIFF` suyo, entonces el
lote invalida las etiquetas de **esa** sucursal por su slug **canónico** —una
sola vez por lote, aunque el lote traiga veinte tarifas de la misma tienda— y
ninguna de otra (`src/lib/cache.ts:86`, `processBatch.ts:132-143`). Un evento
`stale`, `failed` o `skipped` **no invalida nada**.

**E19 — un `ZONE_TARIFF` cuyo `STORE` falló en el mismo lote no se aplica a
medias.**
Dado un lote con un `STORE` de una sucursal nueva que **falla** (calendario
malformado, por ejemplo) y detrás dos `ZONE_TARIFF` de esa misma sucursal, cuando
se envía, entonces los dos tarifarios vuelven en `failed[]` con
`DEPENDENCY_FAILED_IN_BATCH` y **no** como `skipped_not_published`, que viajaría
en `ok` y haría que el POS diera esas tarifas por entregadas para siempre
(R23, SP3).

**E20 — el vector del contrato pasa entero.**
Dado el bloque JSON del vector de precedencia de `docs/sync-contract.md`, cuando
se ejecuta la función pura sobre cada caso, entonces para **todos** coinciden el
importe, la fila decisoria **y el camino completo**; y el número de casos que el
test ejecuta es exactamente el número de casos que el bloque declara, de modo que
un caso borrado del contrato **pone el test en rojo** en vez de reducirlo en
silencio.

**E21 — el catálogo se siembra dos veces y no cambia.**
Dado una base migrada y vacía de zonas, cuando se siembra el catálogo dos veces
seguidas, entonces las dos veces termina con código 0, el número de filas es el
mismo (184) y la versión anotada es la misma. Es lo que ya comprueba el CI
corriendo `npm run seed` dos veces (`.github/workflows/ci.yml`).

**E22 — el artefacto y el contrato dicen lo mismo.**
Dado el índice commiteado, cuando se comprueba su integridad, entonces: hay 16
filas de primer nivel y 168 de municipio; ningún `code` está duplicado; el
`provinceCode` declarado de cada municipio existe como fila de primer nivel; hay
183 ids de relación de OSM distintos y el único repetido es el par de la Isla de
la Juventud (`40` y `40.01`, I9); ninguna fila retirada aparece también como
activa; y el sha256 del fichero coincide con el publicado en
`docs/sync-contract.md` y en su procedencia.

## Reglas de negocio

### El catálogo (el índice, y solo el índice)

**R1 — el catálogo son dos artefactos con vidas separadas, y aquí nace uno.** El
**índice** `code → nombre` (184 filas, hace falta en cada pantalla y es lo que
resuelve un nombre de zona) es de F-041. La **geometría** es de F-042. Sus
versiones se mueven por separado: el nombre de un municipio y su polígono no
cambian por lo mismo ni con la misma frecuencia.

**R2 — cada fila del índice lleva siete datos**, y ninguno es opcional salvo el
que se dice:

| Dato            | Para qué                                              | Viaja por el cable |
| --------------- | ----------------------------------------------------- | ------------------ |
| `code` DPA      | Decide el precio y empareja las dos bases             | Sí, y solo él      |
| nombre          | Para las personas (el selector, el nombre del pedido) | Solo como copia    |
| nivel declarado | Cuántos escalones tiene la precedencia (R3)           | No                 |
| provincia       | El escalón de encima de un municipio (R26)            | No                 |
| id de OSM       | Unir en cada regeneración, sin nombres                | Nunca              |
| nombre en OSM   | Distinguir «id vivo que cambió de nombre» en el diff  | Nunca              |
| retirado        | Se lee, no se ofrece (R4)                             | No                 |

**R3 — el nivel es un campo declarado y NO se deduce nunca de la longitud ni del
prefijo del código.** Dos valores: primer nivel y municipio. El fallo que esto
evita es concreto y silencioso: una zona de primer nivel con un código de cuatro
dígitos cuyos dos primeros coincidan con una provincia real **heredaría la tarifa
de esa provincia**, sin error y sin rastro. El caso real es la **Isla de la
Juventud**, un municipio especial al nivel de una provincia: primer nivel `40`,
municipio `40.01`. Ninguna función de este feature mira la forma del código para
decidir nada.

**R4 — un código retirado se lee, no se ofrece y no se reutiliza nunca.** Se
queda en el índice con su marca. Una fila de tarifario que apunte a él **sigue
resolviendo**, para que un pedido viejo se pueda explicar siempre; que no se
ofrezca es cosa del selector (F-042). La mitad que de verdad importa es la
segunda: un código reutilizado dejaría una fila de tarifario vieja resolviendo
**con otro significado**, el comercio cobrando la tarifa de Playa a un municipio
que nunca configuró.

**R5 — la procedencia va escrita junto a los bytes.** Sin esto, dentro de un año
nadie sabe regenerar el mismo fichero. Contenido mínimo, todo comprobable
leyéndolo: la **edición de la lista DPA** usada (Codificador de la División
Político-Administrativa, República de Cuba, **Edición Enero 2011**, ONEI) con su
**URL del Internet Archive**; el **recuento esperado** (16 divisiones de primer
nivel y 168 municipios); la consulta de OSM con su fecha y los `admin_level`
usados (4 y 6); las **filas que necesitaron emparejamiento manual**; y el
**hash** del artefacto con su fecha de generación. Y una frase que este feature
obliga a escribir: **este artefacto no lleva geometría**, que llega con F-042 y
con su propia procedencia.

**R6 — la errata de la fuente va citada, no corregida en silencio.** El PDF de
ONEI imprime los nueve municipios del bloque «PROVINCIA: 34 SANTIAGO DE CUBA»
como `32.01`–`32.09`, repitiendo el prefijo de Holguín, que en la misma página
gasta `32.01`–`32.14`. Se siembran como **`34.01`–`34.09`** (decisión del humano)
y la errata aparece **en la procedencia y en el informe de la unión**. Sin la
cita, el catálogo tendría nueve códigos que ninguna fuente respalda y serían
indistinguibles de inventados.

**R7 — los recuentos son parte del artefacto y se comprueban.** 16 filas de
primer nivel, 168 de municipio, 184 en total. Del lado de OSM, **183 relaciones
distintas**: la Isla de la Juventud aparece **dos veces** en el índice (`40` y
`40.01`) apuntando a la **misma** relación, así que el id de relación **no es
único** y un test que lo asuma falla (I9). Ese es el único repetido, y está
nombrado en la procedencia.

**R8 — el índice se genera UNA vez y son bytes commiteados**, nunca un guion que
cada lado ejecuta: OSM cambia a diario, y dos ejecuciones del mismo comando en
días distintos darían dos catálogos «de la misma fuente» que no coinciden. Una
extracción, los mismos bytes a los dos lados, y el hash lo demuestra. La
autoridad está repartida y **el `code` no sale de OSM**: ONEI manda en códigos y
nombres, OSM en la identidad de la relación y en nada más. La unión **es** el
artefacto, y su informe deja **a la vista** cada código sin relación y cada
relación sin código: ninguno se descarta en silencio.

**R9 — la siembra es idempotente y la versión queda anotada en la base.**
Sembrar dos veces deja el mismo número de filas y la misma versión (precedente:
`createMany` con `skipDuplicates` de `prisma/seed.ts:338-341`; una versión nueva
del índice tiene que poder **actualizar** nombre, nivel, provincia, nombre en OSM
y marca de retirado de una fila que ya existe, así que `skipDuplicates` solo basta
para el caso de la primera siembra). La versión aplicada, su hash y su fecha se
leen con **una** consulta, y la misma cadena de versión aparece en el artefacto y
en `docs/sync-contract.md`.

### El modo y lo que el tercer valor rompe

**R10 — `ZONE_BASED` es el tercer valor del enum, no un literal.** Migración
aditiva con `ALTER TYPE … ADD VALUE` (precedente:
`prisma/migrations/20260908013319_business_display_currencies/migration.sql` y
`prisma/migrations/20260830170714_order_renegotiation/migration.sql`), y el
vocabulario del cable sigue saliendo del enum generado
(`src/features/sync/schemas.ts:59`), que es lo que la ADR 0028 exige y lo que
hace de esto una versión mayor del contrato.

**R11 — `ZONE_BASED` nunca cobra el `deliveryFee` de la columna.** El importe de
la fila `Store` es el de `FLAT_RATE`; en `ZONE_BASED` decide el tarifario. Un
`deliveryFee` residual que quede en la columna se **ignora**, exactamente como ya
se ignora en `QUOTED_PER_ORDER` (`src/features/orders/deliveryOffer.ts:57-63`, §
«manda el modo»). El sync **no** lo borra por su cuenta: «omitir no es apagar»
(ADR 0028 (d)), y si el POS quiere vaciarlo manda `null` explícito.

**R12 — `deliveryEnabled: true` con `ZONE_BASED` NO es una configuración
inconsistente.** El invariante de F-032 protege «una tienda que dice ofrecer
domicilio sin nada con qué cobrarlo»; en `ZONE_BASED` eso con lo que se cobra es
**el tarifario**, que llega por otra entidad, puede llegar después y puede
cambiar sin ningún evento `STORE`. Rechazar la configuración obligaría al POS a
ordenar sus eventos para no fallar, y el contrato promete lo contrario. Con esto,
`isDeliveryConfigInconsistent` deja de poder escribirse como
`!isDeliveryOffered` (`src/features/orders/deliveryOffer.ts:42-44`): son **dos
preguntas distintas** —«¿esta configuración tiene con qué cobrar?» y «¿se le
puede ofrecer domicilio a este comprador ahora mismo?»— y cada una necesita **una
sola** función que la conteste, con un `switch` exhaustivo sobre el enum para que
un cuarto modo no compile en vez de caer en una rama por defecto (I4).

**R13 — en la ventana entre F-041 y F-042, una tienda `ZONE_BASED` no ofrece
domicilio.** No hay selector de zona, así que no hay zona que resolver: la
respuesta honesta es «hoy no se puede cobrar este envío». El pedido degrada a
`PICKUP` en silencio, que es el comportamiento que ya existe cuando el domicilio
no se ofrece (R3 de F-010, `src/features/orders/server/createOrder.ts:182`), y
**nunca** entra en el ciclo de cotización: `ZONE_BASED` y `QUOTED_PER_ORDER` son
excluyentes (R2 de la propuesta, criterio 10 de F-042). F-042 sustituye ese «no»
por la pregunta de verdad —¿tiene esta tienda alguna zona con tarifa
resoluble?—, que es su criterio 9.

### La entidad `ZONE_TARIFF`

**R14 — es una entidad del sobre, no un array en el payload de `STORE`.** Dos
razones, y las dos están en el acuerdo: 168 municipios no caben en un payload
cuyo precedente de tamaño (`openingHours`) son 2 KB, y ese payload es un upsert
de la fila entera con guarda anti-rancio, así que cambiar una tarifa reenviaría
la configuración del local y **competiría con la guarda** por quién escribió el
último.

**R15 — `rule` es un discriminante de tres valores y el importe es obligatorio o
prohibido, nunca opcional.** `FEE` exige `deliveryFee`; `NOT_SERVED` e `INHERIT`
lo **prohíben**, y prohibido significa que su presencia es `400` —incluido un
`null` explícito—, nunca un descarte silencioso (precedente de `barcode`,
`src/features/sync/schemas.ts:99-101`). Un discriminante no puede contradecirse
consigo mismo: es lo que mata el `served: true` sin importe que habría necesitado
su propio `refine`.

**R16 — el importe tiene el mismo dominio que el de `STORE`, y su misma
moneda.** No negativo, múltiplo de `0.01`, tope `999999999999.99`, guardado como
`Decimal(14,2)` (`src/features/sync/schemas.ts:58`, `prisma/schema.prisma:278-292`).
**No lleva campo de moneda**: es la moneda base del negocio, la misma con la que
se cierra el pedido (`src/features/orders/server/createOrder.ts:190`). El
contrato lo dice con esas palabras, porque es justo lo que un implementador
supone al revés.

**R17 — una zona que no está en el catálogo es `400` de lote con nombre
propio.** `ZONE_TARIFF_ZONE_UNKNOWN`, emitido por el schema del sobre, que puede
comprobarlo porque el índice es **bytes en el repositorio** y no una consulta
(I7). Es el precio aceptado a propósito: un `zoneCode` sale de un selector sobre
un catálogo compartido, así que **solo puede estar mal si los catálogos
divergen**, y esa alarma no se quiere oír bajito (I6).

**R18 — un `zoneCode` desconocido en un `STORE` falla ese evento y nada más.**
`STORE_ZONE_UNKNOWN`, lanzado en el handler **antes** de la escritura que
protege, como ya hace `assertOpeningHoursValid`
(`src/features/sync/server/handlers/store.ts:346-352`). El evento falla entero:
ninguno de sus campos se aplica, ni los que viajaran bien, y `sourceUpdatedAt` no
avanza. Hereda la trampa del `openingHours` —un teléfono que viajara en el mismo
evento se queda sin corregir— y se acepta por la misma razón que R17.

**R19 — retirada no es desconocida.** Una zona presente y marcada como retirada
**se acepta** (se guarda la tarifa, se guarda el `zoneCode` de la tienda) y se
avisa con `console.warn` y prefijo de dominio, nunca `console.error`
(AGENTS.md § Cosas que muerden). Rechazarla rompería una fila histórica legítima
y confundiría «tu catálogo es más viejo que el mío» con «nuestros catálogos no
son el mismo».

**R20 — `ZONE_TARIFF` no acepta `DELETE`, y el rechazo es lo primero que
ocurre.** `ZONE_TARIFF_DELETE_NOT_SUPPORTED`, comprobado **antes** de la guarda
anti-rancio y antes de cualquier ida a la base, como
`src/features/sync/server/handlers/business.ts:61-68` —el orden **opuesto** al de
`handleCategory` (`src/features/sync/server/handlers/misc.ts:115-140`), y a
propósito: un `DELETE` que no es una operación de esta entidad es entrada
malformada, y **un error de forma no puede depender de una marca de tiempo**. El
agujero que esto cierra es el que `CATEGORY` tiene abierto: la guarda corre antes
de la rama del `DELETE`, pero una vez aplicado el borrado **no queda marca contra
la que comparar** y un `UPDATE` rancio **resucita la fila**. En `CATEGORY` eso es
cosmético; en un tarifario habría sido un importe cobrado. Y como una fila nunca
desaparece por un evento de zona, `INHERIT` es el **único** mecanismo de
retracción que existe, en todos los niveles, incluida una fila de provincia
(E12).

**R21 — la guarda anti-rancio es la que RECHAZA, por `(storeId, zoneCode)`.**
`updatedAt` menor o igual al guardado devuelve `stale` y no escribe nada. **No**
es la forma de orden de `EXCHANGE_RATE`, que escribe siempre y decide al leer:
esa solo tiene sentido sobre una tabla append-only cuyo histórico es el producto
(F-036, `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`). Copiar una
esperando la otra es el error que AGENTS.md § Cosas que muerden ficha.

**R22 — las filas mueren con la sucursal, por dos caminos y no por uno.** (a) La
clave ajena se declara `onDelete: Cascade`, para el día que una fila `Store`
desaparezca de verdad; (b) un evento `STORE` con `operation: "DELETE"` **que se
aplica** borra las filas de tarifario de esa sucursal en el mismo camino, porque
hoy ese evento **no borra la fila `Store`** —la suspende— y sin (b) el criterio 8
sería inalcanzable (I1). Un `publishToStore: false` con `operation: "UPDATE"`
—vacaciones— **no** borra nada: es reversible y el tarifario tiene que seguir ahí
al reabrir.

**R23 — dentro de un lote, un `ZONE_TARIFF` depende de su `STORE`.** Si un evento
`STORE` de esa sucursal **falló antes en el mismo lote**, sus `ZONE_TARIFF`
vuelven en `failed[]` con `DEPENDENCY_FAILED_IN_BATCH` en vez de aplicarse a
medias o —peor— salir `skipped_not_published` **en `ok`**, con lo que el POS
marcaría su outbox como hecho y la tarifa se perdería en silencio. Se implementa
con la maquinaria que ya existe (`src/features/sync/dependencies.ts:51-79`):
`STORE` pasa a **proveer** su clave y `ZONE_TARIFF` a **requerirla**. Ningún
evento provee y requiere a la vez, así que sigue sin haber cadenas (R11 de
F-037). Es visible en el cable y va en la v13 (SP3).

**R24 — un `ZONE_TARIFF` de una sucursal que aquí no existe es
`skipped_not_published`.** Es el opt-in por local funcionando, idéntico a
`PRODUCT` (`src/features/sync/server/handlers/product.ts:75`), y viaja en `ok`
porque es terminal.

**R25 — la invalidación se reporta, no se ejecuta.** El handler devuelve el slug
**canónico** de la sucursal (`src/lib/publicSlug.ts:31`) en `touchedStoreSlug` y
nada más: ni el slug de la marca ni los de las hermanas, porque una tarifa no
cambia lo que resuelve ningún slug ni lo que muestra el selector de sucursales
(R18 de F-035: se revalida lo que se escribe). `processBatch.ts:132-143` hace el
resto, una vez por lote. Un `stale`, un `failed` o un `skipped` **no** invalidan
nada, así que el handler ni calcula el slug en esos caminos.

### La precedencia

**R26 — tres escalones, y el número de escalones lo decide el nivel declarado.**
Para una zona de **municipio**: su fila → la fila de **su provincia declarada**
→ no servida. Para una zona de **primer nivel**: su fila → no servida. Gana
siempre lo más específico, y **nada** significa no servida. Ninguna otra fila del
tarifario participa: una fila de otra provincia jamás entra en la resolución de
esta zona.

**R27 — las tres guardas, que el vector no cubría y que van al contrato con
él.** (1) Una fila `FEE` **sin importe** no es envío gratis: **no decide** y cae
al escalón de arriba. (2) Una tarifa de **`0` sí es envío gratis**, y no «no
servida»; la comprobación es contra `null`/`undefined` y **nunca contra un valor
falsy** —un `if (!fila.deliveryFee)` convierte el envío gratis en el importe de
la provincia por una línea que parece correcta— y el repositorio ya tiene las dos
formas correctas al lado (`src/features/orders/deliveryOffer.ts:34,63`). (3) Un
importe **negativo** se rechaza en el schema **y además** la fila se trata como
que no decide: lo segundo no es defensivo, es lo que hace que las dos
implementaciones coincidan incluso en el caso corrupto que el schema no debería
dejar pasar. Las tres son representables en la base aunque el schema las rechace
en el cable: la columna del importe es anulable porque `NOT_SERVED` e `INHERIT`
no lo llevan.

**R28 — el vector se publica en JSON dentro del contrato, con el camino completo,
y el test lo lee del propio documento.** Por caso: los escalones **consultados**
y qué dijo cada uno, no solo la fila que decidió — sin eso, dos casos que dan el
mismo importe por caminos distintos son indistinguibles, y los dos lados
habrían publicado un vector ciego a esa diferencia. El test lo lee de
`docs/sync-contract.md` y **no de una copia transcrita**, que es exactamente
donde dos implementaciones se separan (precedente de un test que ya parsea el
contrato: `src/features/sync/fieldOwnership.test.ts:19,81`). Y la instrucción que
los dos lados escribieron para el futuro: **si algún día las dos funciones
divergen, no se ajusta ninguna para que cuadre — se averigua cuál de las dos
lecturas es la del contrato.**

### El campo nuevo de `STORE`

**R29 — `zoneCode` entra en la familia «omitir no es apagar».** Ausente deja la
columna **intacta**; `null` explícito la **borra**. No entra en la familia de los
nueve campos de contacto, donde ausente borra
(`docs/sync-contract.md:1180-1192`): es configuración que el POS todavía no
emite, y con la semántica de contacto un despliegue que dejara de mandarla la
borraría en silencio, que es el motivo entero de la ADR 0028 (d). `zoneCode` es
lo **computable**; `city`/`province` siguen siendo texto de **presentación**, no
se derivan uno del otro y contradecirse **no** es un error.

## Casos límite y errores

1. **Un lote con dos `ZONE_TARIFF` de la misma pareja `(storeId, zoneCode)`.** Se
   aplican en orden de `occurredAt` (`src/features/sync/server/inbox.ts:64`) y la
   guarda de R21 hace que gane el de `updatedAt` mayor; el otro sale `stale`. Dos
   marcas **iguales**: el segundo es `stale` (la comparación es `>=`, como en
   `STORE` y `CATEGORY`).
2. **Dos lotes idénticos a la vez.** El `@@unique(storeId, zoneCode)` es lo que
   impide dos filas. El perdedor de la carrera puede volver como `failed` con el
   error de la violación de unicidad; se reintenta y aplica como `UPDATE`. Lo que
   **no** puede pasar es que queden dos filas ni que el lote entero muera con
   `500`.
3. **Un `ZONE_TARIFF` con el mismo `eventId` reenviado.** Sale `duplicate` sin
   llamar al handler (`processBatch.ts:57-60`), y `duplicate` viaja en `ok`.
4. **Un `400` no deja rastro para el reintento.** Los `400` de R17, E6, E7 y E8
   ocurren en el route, antes de `recordBatch`
   (`src/app/api/internal/sync/catalog/route.ts:31-37`), así que **no** se escribe
   `SyncEvent` y el mismo `eventId` reenviado corregido no vuelve como
   `duplicate`. Es el mismo comportamiento que ya tiene el `403`.
5. **Un lote de 500 eventos con una sola tarifa de zona desconocida muere
   entero** (R17, I6). El outbox del negocio se para hasta que alguien lo corrija,
   que es la consecuencia que la ADR 0028 § Consecuencias ya aceptó para un valor
   mal formado. Va escrito en el contrato con ejemplo, para que el otro equipo lo
   sepa antes de implementarlo y no al depurar.
6. **Una tarifa de una zona retirada** se guarda y se avisa (R19). El selector no
   la ofrece (F-042) y un pedido viejo que la use sigue resolviendo.
7. **Una fila de municipio cuya provincia declarada no tiene fila** resuelve por
   su propia fila si decide, y por «no servida» si no (R26). Nunca busca un tercer
   escalón.
8. **Una zona de primer nivel consultada directamente** (una provincia como
   destino) tiene **un** escalón. Si no tiene fila, no servida. Y si su código
   tiene la forma de un municipio de otra zona —el patrón de la Isla de la
   Juventud— **no hereda nada de ella**: el nivel declarado es lo que decide
   (R3, caso V10 del vector).
9. **`ZONE_BASED` sin ninguna fila de tarifario.** La configuración es válida
   (R12) y el domicilio no se ofrece (R13, y luego el criterio 9 de F-042). No es
   un error del sync y no rechaza ningún evento.
10. **Una sucursal en `DRAFT` con tarifas.** Se guardan; la invalidación de su
    etiqueta es inofensiva. No se inventa un filtro nuevo por `status`.
11. **Una sucursal de una marca con varias sucursales.** El slug canónico exige
    que la sucursal tenga `slug` propio (`src/lib/publicSlug.ts:31-38`, que lanza
    si no); es la misma exposición que ya tiene `handleStore` y no se cambia aquí.
12. **Una tarifa que llega antes que su `STORE`, en lotes distintos.** Sale
    `skipped_not_published` (R24) y viaja en `ok`: el POS la da por entregada. Es
    la semántica que `PRODUCT` ya tiene desde la v2 y no se cambia; lo que R23
    cierra es el caso peor, el del **mismo lote**, donde el fallo es visible y
    atribuible.
13. **Un `STORE` con `operation: "DELETE"` que sale `stale` o
    `skipped_not_published`.** No borra ninguna tarifa: R22(b) solo actúa en el
    camino que **se aplica**.
14. **Una tarifa que llega después de un `DELETE` de su sucursal.** La sucursal
    sigue existiendo (suspendida), así que la fila se crea de nuevo. Se acepta:
    una sucursal suspendida no muestra nada al comprador, y si el negocio
    republica, su POS reenvía el tarifario. Queda escrito porque es el residuo
    del agujero que R20 cierra en el otro nivel.
15. **El artefacto y la base desalineados** (alguien migró sin sembrar): un
    `ZONE_TARIFF` de un código presente en el artefacto pero ausente en la base
    fallaría en la clave ajena, en `failed[]`, no en `400`. El paso operativo de
    `docs/despliegue.md` (I8) existe para que eso no ocurra, y el criterio 11 lo
    comprueba en CI.
16. **El bloque JSON del vector no aparece, aparece dos veces o no es JSON
    válido.** El test **falla ruidosamente** con un mensaje que dice cuál de las
    tres cosas pasó; nunca cae en un `describe` vacío que pase con cero asertos.

## Datos y contrato

### El payload de `ZONE_TARIFF`

```jsonc
{
  "storeId": "uuid-de-la-Tienda-en-el-POS", // el mismo externalId que STORE
  "zoneCode": "23.05", // tiene que existir en el catálogo publicado
  "rule": "FEE", // FEE | NOT_SERVED | INHERIT
  "deliveryFee": 300.0, // obligatorio con FEE, PROHIBIDO en las otras dos
  "updatedAt": "2026-09-08T14:03:00.000Z", // guarda anti-rancio, instante real de la edición
}
```

- **Sin `businessId`**: la identidad la da el token
  (`src/features/sync/server/caller.ts`), y `storeId` ya ata la fila al negocio.
  Consecuencia menor y deliberada: este payload **no** entra en la comprobación de
  `findCatalogMismatch` (`src/features/sync/identity.ts`), que solo recorre los
  payloads que llevan `businessId`; el handler valida la pertenencia igual, como
  hace `handleProduct`.
- **`operation`**: `CREATE` y `UPDATE` son el mismo upsert; `DELETE` es un error
  con nombre propio (R20).
- **`zoneCode`**: forma DPA, `^\d{2}$` para primer nivel y `^\d{2}\.\d{2}$` para
  municipio, **verbatim de la fuente** (SP4). La forma no implica el nivel: el
  nivel lo declara el catálogo (R3).
- **`updatedAt`**: el instante real de la edición del encargado, con la misma
  exigencia que la v11 ② puso a las tasas.

### Los modelos nuevos

Nombres a decidir por el arquitecto (§ No decidido, 1); lo que fija esta spec es
la forma:

- **El catálogo**: `code` como clave primaria (texto), nombre, nivel (enum de dos
  valores), código de la provincia (anulable, y **presente en toda fila de
  municipio**), id de relación de OSM, nombre en OSM, marca de retirado. Las
  filas **no se borran nunca** (R4), así que ninguna clave ajena que apunte aquí
  puede quedar colgando.
- **El tarifario**: `(storeId, zoneCode)` único, `rule` (enum de tres valores),
  importe `Decimal(14,2)` **anulable**, marca de origen, clave ajena a `Store`
  con `onDelete: Cascade` y clave ajena al catálogo.
- **`Store.zoneCode`**: texto anulable con clave ajena al catálogo.
- **Los enums**: `DeliveryFeeMode` gana `ZONE_BASED`; `SyncEntity`
  (`prisma/schema.prisma:89`) gana `ZONE_TARIFF`. Los dos `ALTER TYPE … ADD
VALUE` van en la misma migración que crea las tablas, y el valor nuevo **no se
  usa dentro de la misma transacción** que lo añade.
- **La migración no se genera con `prisma migrate dev`** en esta máquina, y el
  procedimiento exacto está en `.agent/progress/F-041.md` § «Notas para quien
  retome» con sus dos fichas del playbook.

### Los códigos de error nuevos

Van en `src/constants/sync.ts` con su comentario, como las cinco que ya viven
ahí, y viajan **tal cual**, sin adorno, porque el POS los compara byte a byte
contra § «Vocabulario de errores» del contrato:

| Código                             | Dónde se decide  | Respuesta        |
| ---------------------------------- | ---------------- | ---------------- |
| `ZONE_TARIFF_ZONE_UNKNOWN`         | schema del sobre | `400` de lote    |
| `ZONE_TARIFF_DELETE_NOT_SUPPORTED` | handler, primero | `207` `failed[]` |
| `STORE_ZONE_UNKNOWN`               | handler de STORE | `207` `failed[]` |

`DEPENDENCY_FAILED_IN_BATCH` se reutiliza tal cual para R23; no hay código nuevo
para eso.

### El vector de precedencia

Un solo bloque vallado marcado como `json` —no como `jsonc`, y **sin
comentarios**, para que `JSON.parse` lo lea sin preprocesarlo— bajo un encabezado propio y estable del
contrato. Forma de cada caso:

- `id`: `V1`…`V10` para la precedencia, `G1`…`G3` para las guardas de R27.
- `zone`: `{ code, level, provinceCode }` — **declarado en el fixture**, nunca
  buscado en el catálogo, para que el vector no envejezca con una versión nueva
  del índice y para que los códigos puedan ser sintéticos.
- `rows`: las filas del tarifario relevantes, en la **forma del payload**
  (importe como número), para que cualquiera de los dos lados pueda alimentarlas
  con su propio aplicador.
- `expected`: `{ served, deliveryFee, decidedBy, path }`, con `deliveryFee` como
  **cadena de dos decimales** (`"300.00"`, `"0.00"`) o `null` — nunca un número
  en coma flotante, y nunca `String(300)`, que da `"300"`
  (`src/features/sync/server/storeConfig.ts:68-77`); se produce con
  `src/lib/money.ts`. `decidedBy` es el `code` de la fila que decidió, o `null`
  cuando **nada** decidió: eso distingue «hay una fila que dice que no sirvo» de
  «no hay nada en ningún nivel», que es justo la diferencia a la que las dos
  implementaciones estaban ciegas.
- `path`: los escalones **consultados**, en orden, cada uno con su `code`, su
  `level`, lo que dijo (`FEE`, `FEE_SIN_IMPORTE`, `FEE_NEGATIVO`, `NOT_SERVED`,
  `INHERIT`, `AUSENTE`) y si `decide` o `declina`. Un escalón que no se consultó
  **no aparece**.

Los diez casos, con el fixture de una sola tienda (códigos sintéticos a
propósito, y elegidos para que una deducción por longitud o por prefijo **falle
de forma visible**): primer nivel `03` `FEE 300`, `04` `NOT_SERVED`, `05`
`INHERIT`, y `03.40` **declarada de primer nivel y sin fila**, cuyo código
tiene la FORMA de un municipio de `03` (el patrón de la Isla de la Juventud al
revés: aquí lo que engaña es la forma, no la longitud);
municipios `03.03` `INHERIT`, `03.05` `NOT_SERVED`, `03.07` `FEE 150`, `04.02`
`FEE 200`, y sin fila `03.04`, `04.05`, `05.04`, `06.01`.

| id  | Zona consultada               | Camino esperado                                             | Resultado  |
| --- | ----------------------------- | ----------------------------------------------------------- | ---------- |
| V1  | `03.05` (mun)                 | mun `NOT_SERVED` decide                                     | no servida |
| V2  | `03.03` (mun)                 | mun `INHERIT` declina → prov `03` `FEE` decide              | `300.00`   |
| V3  | `03.04` (mun)                 | mun ausente → prov `03` `FEE` decide                        | `300.00`   |
| V4  | `03.07` (mun)                 | mun `FEE` decide                                            | `150.00`   |
| V5  | `04.02` (mun)                 | mun `FEE` decide                                            | `200.00`   |
| V6  | `04.05` (mun)                 | mun ausente → prov `04` `NOT_SERVED` decide                 | no servida |
| V7  | `05.03`… ver nota             | mun `FEE` decide, con la provincia en `INHERIT`             | `250.00`   |
| V8  | `05.04` (mun)                 | mun ausente → prov `05` `INHERIT` declina → no hay escalón  | no servida |
| V9  | `06.01` (mun)                 | mun ausente → prov `06` ausente                             | no servida |
| V10 | `03.40` (primer nivel)        | un solo escalón, ausente — **no** mira `03` pese a la forma | no servida |
| G1  | `03.09` con `FEE` sin importe | mun `FEE_SIN_IMPORTE` declina → prov `03` decide            | `300.00`   |
| G2  | `03.10` con `FEE 0`           | mun `FEE` decide con importe cero                           | `0.00`     |
| G3  | `03.11` con `FEE -50`         | mun `FEE_NEGATIVO` declina → prov `03` decide               | `300.00`   |

Nota de V7: el fixture necesita además el municipio `05.03` con `FEE 250` bajo la
provincia `05` en `INHERIT`. V2 y V3 son el par que **justifica el camino**: el
mismo importe y la misma fila decisoria, por dos caminos distintos.

**Estos diez no son los diez del cruce del 2026-09-06**: ese cruce está
**descrito** en la propuesta pero su composición exacta **no está escrita en
ningún fichero de este repositorio** (I3, SP1). Los de arriba son la
reconstrucción de esta spec, y la regla al recruzarlos es: **se publica la unión,
nunca la intersección**, y ningún caso se quita para que la cuenta salga a diez.

### La v13 de `docs/sync-contract.md`

Mayor: cambia el enum, añade una entidad, tres códigos de error, un campo de
`STORE` y una regla de validación. Lo que la edición tiene que llevar, y todo
sale de las secciones de arriba:

1. Cabecera a **v13** y su § «Cambios respecto a la v12.2».
2. El bloque § «Lo que NO entra en la v11, y está en conversación»
   (`docs/sync-contract.md:273-333`) **baja a la v13** en su mitad de S-007: deja
   de ser conversación y pasa a ser contrato. La mitad de S-008 ya está publicada.
3. `ZONE_BASED` en la lista de valores de `deliveryFeeMode`, con R11 escrita: en
   `ZONE_BASED` el `deliveryFee` de la tienda **no se cobra**.
4. `zoneCode` en el payload de `STORE` (`docs/sync-contract.md:1120-1192`), con
   su semántica de omisión (R29) escrita en el párrafo de «dos semánticas de
   omisión», y **su fila en la tabla de propiedad de campos**, que pasa de 31 a
   **32** columnas de `Store` en los tres sitios donde ese número aparece (I5).
5. La entidad `ZONE_TARIFF` con su payload, su `rule`, su precedencia **con
   letra**, sus tres guardas y el vector en JSON.
6. Los tres códigos nuevos en § «Vocabulario de errores», y la cascada
   `STORE → ZONE_TARIFF` donde ya se documenta `DEPENDENCY_FAILED_IN_BATCH`
   (R23).
7. La **versión del catálogo** publicada aquí —cadena de versión y hash del
   índice—, que es cómo cada lado sabe que comparten el mismo (SP2 de la
   propuesta, cerrada).
8. Una entrada en § «Cambios requeridos en cuadrecaja» que diga, sin rodeos: no
   emitáis `ZONE_TARIFF` ni `deliveryFeeMode: "ZONE_BASED"` hasta el aviso,
   porque hasta entonces `entity` no admite el valor y el lote entero responde
   `400 INVALID_BATCH` — el mismo aviso que la v12 llevó y que la v12.2 retiró.
9. Y la advertencia que solo se puede dar aquí: **el mapa y el selector llegan con
   F-042**, así que entre la v13 y F-042 una tienda `ZONE_BASED` **no ofrece
   domicilio** (R13). Publicar la v13 sin decir esto haría que el primer negocio
   que la use crea que apagó el domicilio.

## Criterios de aceptación propuestos

Los catorce `[ya]` son los de `.agent/features.json`, en su orden y con su letra
literal; ninguno se toca (regla 3). Cada uno con lo que hay que **ejecutar**.

**C1 `[ya]`** — «Los SIETE casos del vector de precedencia pasan, y el test lee
el JSON del propio docs/sync-contract.md y no una copia: si el bloque del
contrato cambia, el test cambia con el.»
E20. `npm test` con el test nuevo de la función pura: lee
`docs/sync-contract.md` con `readFileSync` (precedente
`src/features/sync/fieldOwnership.test.ts:19`), extrae **el** bloque del vector,
`JSON.parse`, y hace un `it` por caso comparando importe, `decidedBy` y `path`
completo. Dos asertos más que hacen el criterio infalsificable: el número de
casos ejecutados es igual al declarado, y **es ≥ 10**. Se cumple **de sobra**: se
publican trece casos (diez de precedencia y tres guardas) donde el criterio pide
siete (I2).

**C2 `[ya]`** — «Un lote con un ZONE_TARIFF valido responde 207 con ese evento
processed y la fila queda guardada, verificado leyendola.»
E1, en un `*.db.test.ts` nuevo contra Postgres real y a través del `POST` de
verdad (precedente `src/features/sync/server/handlers/business.db.test.ts`):
`res.status === 207`, el `eventId` en `ok`, y un `findUnique` de la pareja que
devuelve `rule = FEE` e importe `"300.00"` con `.toString()`.

**C3 `[ya]`** — «rule NOT_SERVED o INHERIT con deliveryFee presente responde 400,
y rule FEE sin deliveryFee tambien: ninguna de las dos se descarta en silencio.»
E6 y E7, en dos capas: unidad del sobre en `src/features/sync/schemas.test.ts`
(las cuatro variantes, incluida `deliveryFee: null`), y contra el `POST`:
`400`, `body.error === "INVALID_BATCH"`, `prisma.syncEvent.count({ where: {
eventId } })` → `0`, y cero filas de tarifario.

**C4 `[ya]`** — «Un ZONE_TARIFF con operation DELETE responde failed[] con su
propio codigo y no borra ninguna fila, comprobado contandolas antes y despues.»
E4 y E5. `count()` del tarifario de la sucursal antes y después: igual;
`failed[0].error === "ZONE_TARIFF_DELETE_NOT_SUPPORTED"`; el `eventId` **no** en
`ok`. Y el caso con `updatedAt` anterior, que sigue siendo `failed` y no `stale`.

**C5 `[ya]`** — «Un ZONE_TARIFF con updatedAt menor o igual al guardado para la
misma pareja de tienda y zona responde stale y no pisa el importe vigente.»
E3, con las dos formas: `updatedAt` estrictamente menor e **igual**. La fila
sigue con el importe anterior y con su marca sin mover.

**C6 `[ya]`** — «Un ZONE_TARIFF de una zona que no esta en el catalogo sembrado
responde 400 con su propio codigo y no guarda ninguna fila.»
E9. `400`, `issues` con `ZONE_TARIFF_ZONE_UNKNOWN`, cero filas, cero
`SyncEvent`, y el `PRODUCT` que viajaba detrás **no** aplicado. Nota para el
tester: el criterio dice «del catálogo **sembrado**» y la comprobación es contra
el artefacto commiteado (I7); el criterio 11 es el que garantiza que los dos
dicen lo mismo.

**C7 `[ya]`** — «Una fila de nivel provincia con rule INHERIT se acepta —es la
unica forma de retirar una regla de provincia— y su zona resuelve como no servida
cuando el municipio no tiene fila.»
E12 y E13, contra la base: se aplica la fila de provincia, y después el lector
mínimo (§ Alcance 9) carga las filas reales de la pareja y la función pura
devuelve no servida con `decidedBy: null` y el camino de dos escalones.

**C8 `[ya]`** — «Borrar la sucursal con un STORE de operation DELETE se lleva sus
filas de tarifario, verificado contandolas despues.»
E14, en dos mitades por I1: (a) a través del `POST`, un `STORE` con
`operation: "DELETE"` aplicado deja el `count()` del tarifario en `0`; (b) un
`prisma.store.delete` directo también, que es lo que prueba la clave ajena. Sin
(a) el criterio no se puede cumplir tal como está escrito, porque ese evento
**no borra la fila `Store`**.

**C9 `[ya]`** — «Un STORE con un zoneCode que no esta en el catalogo responde
failed[] de ESE evento con su propio codigo y no aplica ninguno de sus campos, ni
siquiera los que viajaran bien; con un zoneCode valido lo guarda.»
E16. El `STORE` malo lleva además un `phone` distinto: después del `207`, el
teléfono guardado es **el de antes**, `sourceUpdatedAt` no avanzó,
`failed[0].error === "STORE_ZONE_UNKNOWN"`, y otro evento con un `zoneCode` del
catálogo deja la columna escrita.

**C10 `[ya]`** — «deliveryFeeMode acepta ZONE_BASED y la migracion del enum corre
contra la base real: una tienda con ese modo se guarda y se lee.»
E15, en un `*.db.test.ts`: `npm run db:deploy` aplicado, un `STORE` con
`deliveryFeeMode: "ZONE_BASED"` y `deliveryEnabled: true` **sin** `deliveryFee`
responde `processed` —**no** `STORE_DELIVERY_CONFIG_INCONSISTENT`, que es lo que
haría hoy (I4)— y la columna lee `ZONE_BASED`. Más el aserto de aditividad de la
migración: `git diff main --stat -- prisma/migrations` muestra **solo** ficheros
nuevos (`--exit-code` de `prisma migrate diff` **no** sirve en este repo, ficha
`.agent/playbook/prisma-migrate-diff-nunca-da-cero-por-indices-no-declarados.md`).

**C11 `[ya]`** — «El catalogo geografico esta sembrado con provincias y
municipios, su version esta anotada, y volver a sembrarlo es idempotente:
correrlo dos veces deja el mismo numero de filas.»
E21 y E22. `npm run seed` dos veces seguidas (lo mismo que hace el CI en
`.github/workflows/ci.yml`), y entre medias y después: `count()` del catálogo
`= 184`, `16` de primer nivel, `168` de municipio, y **una** consulta que
devuelve la versión aplicada. Más el test de integridad del artefacto (E22),
que corre sin base.

**C12 `[ya]`** — «Aplicar un ZONE_TARIFF expira las paginas cacheadas de esa
sucursal, apoyado en F-035 y sin reimplementar la invalidacion.»
E18, con el precedente exacto de F-035/F-039:
`src/features/sync/server/handlers/businessInvalidation.db.test.ts` y
`src/features/sync/server/processBatch.invalidationCount.test.ts`. Dos asertos:
el `HandlerOutcome` trae el slug **canónico** en `touchedStoreSlug`, y un lote con
veinte tarifas de la misma tienda dispara **una** ronda de invalidación, no
veinte. Y el negativo: un `stale` no invalida nada. Cero líneas nuevas en
`src/lib/cache.ts`.

**C13 `[ya]`** — «docs/sync-contract.md sube a v13 con la entidad, la precedencia
con letra, los codigos de error nuevos y el vector en JSON calculado EJECUTANDO,
coordinada con cuadrecaja antes de publicarla.»
§ «La v13» de arriba, en dos tiempos por decisión del humano: **al firmar el
plan** sale el borrador hacia cuadrecaja; **al cerrar** se publica con su visto
bueno. Verificable: `head -3 docs/sync-contract.md | grep -c '13'` → `1`; el
vector del documento es el que produce el guion que lo calcula (no transcrito a
mano); C1 en verde sobre ese mismo bloque; y una línea fechada en
`.agent/solicitudes.md` en la fila de S-007.

**C14 `[ya]`** — «bash .agent/verify.sh F-041 --full termina con codigo 0.»
Etapas `harness typecheck lint format test prisma build theme bundle`
(`.agent/verify.sh`). Cinco recordatorios que ya costaron ciclos en este repo:
(a) la etapa `harness` se pone roja por citar **entre comillas invertidas** un
archivo que aún no existe —los módulos nuevos, la migración, los tests nuevos: se
escriben sin comillas y con «(por crear)» detrás— y también por citar
**abreviada** la ruta de uno que sí existe; (b) `npm run format` sobre lo que se
escriba en `.agent/`, y **sin formatear a ciegas documentos ajenos**; (c)
`npm test` incluye el proyecto `db` (`vitest.config.mts`), que necesita el
Postgres de `docker-compose.yml` levantado y **migrado con la migración nueva**;
(d) la migración **no** se genera con `prisma migrate dev` en esta base
compartida, y el procedimiento está en `.agent/progress/F-041.md`; (e) el
artefacto del índice **no debe entrar en el bundle de cliente** en este feature
—no hay lector de cliente hasta F-042—, o la etapa `bundle` lo dirá.

### Propuestos al humano

**C15 `[nuevo]`** — «Una tienda `ZONE_BASED` con un `deliveryFee` residual en su
columna no cobra ese importe ni `0.00` como envío: el pedido a domicilio se cierra
como `PICKUP` y nunca queda pendiente de cotizar.» E17, contra la base y por el
`POST /api/orders`. Es el criterio que impide que la ventana entre F-041 y F-042
cobre de menos o de más sin que nada falle (R11, R13); ningún criterio de los
catorce lo cubre y es la única consecuencia **cobrable** de este feature.

**C16 `[nuevo]`** — «El índice pasa su test de integridad: 184 filas, 16 y 168,
ningún `code` duplicado, la provincia declarada de cada municipio existe, 183 ids
de relación distintos con el único repetido siendo el par de la Isla de la
Juventud, ninguna fila retirada también activa, y el sha256 del fichero coincide
con el publicado en el contrato.» E22. Convierte «la cifra que una persona mira y
dice falta uno» en algo que falla solo, que es lo que la propuesta pedía y lo que
detecta una regeneración mal hecha.

**C17 `[nuevo]`** — «El informe de la unión está commiteado y cita la errata de
Santiago de Cuba, y la procedencia nombra la edición del DPA con su URL del
Internet Archive.» Verificable con `grep`: el informe contiene las nueve filas
`34.01`–`34.09` con la cita de la errata, y la procedencia contiene la cadena
`web.archive.org/web/20110125204824id_`. Es la decisión 2 del humano hecha
comprobable en vez de confiada a la buena voluntad de quien genere el fichero.

## Incongruencias detectadas

**I1 — el criterio 8 (y la R7 de la propuesta) dan por hecho que un `STORE` con
`operation: "DELETE"` borra la fila `Store`. No la borra: la suspende.**
`src/features/sync/server/handlers/store.ts:124-127` trata el `DELETE`
«exactamente como un despublicado explícito», escribe `sourceOptIn: false` y
`status: "SUSPENDED"`, y **nada en todo el repositorio ejecuta un
`prisma.store.delete`** (comprobado con `grep`, no supuesto). Consecuencia: una
clave ajena `onDelete: Cascade` **nunca se dispararía en producción**, y el
criterio 8 —«verificado contándolas después»— daría el mismo número antes y
después. No se toca el criterio (regla 3): R22 lo cumple con las dos mitades, un
borrado explícito de las filas en el camino aplicado del `DELETE` **más** la
cascada declarada. La alternativa —dejar solo la cascada y probar el criterio
borrando la fila `Store` a mano— cumpliría la letra por un camino que el sync
nunca recorre, y eso es exactamente lo que este apartado existe para no dejar
pasar.

**I2 — el criterio 1 dice «los SIETE casos» y el acuerdo son diez.** El vector se
cruzó con cuadrecaja el 2026-09-06 con **diez** casos y camino completo, después
de que se escribieran los criterios. El humano lo resolvió el 2026-09-08:
**se implementan los diez, el criterio no se toca y no se abre feature
correctivo**, porque diez en verde cumple «los siete» de sobra. Esta spec publica
trece (diez más las tres guardas de R27) y C1 exige `≥ 10` para que la cifra no
pueda encogerse en silencio.

**I3 — la composición exacta de esos diez casos no está escrita en ningún fichero
de este repositorio.** La propuesta los **describe** —el par `0303`/`0304`, «de
los tres no servida, en uno hay una fila de provincia que declina»— pero no los
enumera ni publica el fixture. Los diez de § «El vector de precedencia» son la
**reconstrucción** de esta spec, y su recuento de «no servidas» no coincide con
esa frase, lo que confirma que no son literalmente los mismos. No es un fallo del
acuerdo: es trabajo cruzado que se quedó en la conversación. Se resuelve
recomputando **ejecutando** (que es lo que el criterio 13 pide de todas formas) y
recruzando con cuadrecaja cuando salga el borrador de la v13 (SP1), con la regla
de publicar la **unión** y no quitar ningún caso.

**I4 — añadir el tercer valor al enum pone `npm run typecheck` en rojo y, si no
se hace nada más, hace imposible configurar una tienda `ZONE_BASED`.** Dos hechos
del código de hoy: (a) `DeliveryFeeModeName`
(`src/features/orders/deliveryOffer.ts:15`) es una unión **escrita a mano** de dos
literales, y `src/features/orders/server/quote.ts:147` le asigna el valor que
viene de Prisma, así que un tercer valor en el enum **no compila**; (b)
`isDeliveryConfigInconsistent` está escrito como `enabled && !isDeliveryOffered`
(`src/features/orders/deliveryOffer.ts:42-44`), y `isDeliveryOffered` solo conoce
dos modos, así que un `STORE` con `ZONE_BASED` y `deliveryEnabled: true` fallaría
con `STORE_DELIVERY_CONFIG_INCONSISTENT` **para siempre**, matando el criterio 10
en su caso realista. La DA1 de F-031 anticipó este día con estas palabras: «el día
que aparezca un tercer `DeliveryFeeMode` hay exactamente un sitio que decide si
hay con qué cerrar el domicilio». Lo que el tercer modo revela es que ese sitio
contestaba **dos preguntas a la vez** —la de la configuración y la del comprador—
y que con `ZONE_BASED` las dos respuestas difieren. R12 y R13 las separan, cada
una con una sola función y un `switch` exhaustivo. Ver SP2.

**I5 — `Store.zoneCode` rompe tres números clavados a mano.**
`src/features/sync/fieldOwnership.test.ts:141-145` afirma que `Store` tiene
**31** columnas y que la tabla del contrato tiene **31** filas, y el propio
contrato escribe el número en su prosa (`docs/sync-contract.md:1194-1235`). Con
`zoneCode` son **32** en los tres sitios, y hay que moverlos en el mismo commit o
`npm test` se pone rojo por algo que no es un fallo. El test es, de paso, el que
garantiza que la columna nueva **no** se quede sin fila de propiedad.

**I6 — la misma clase de dato desconocido responde de dos formas distintas, y es
deliberado.** Criterio 6: un `zoneCode` desconocido en un `ZONE_TARIFF` es `400`
**de lote** (se lleva los otros 499 eventos). Criterio 9: un `zoneCode`
desconocido en un `STORE` es `failed[]` **de ese evento**. La asimetría está
razonada en la propuesta y se conserva, pero su precio hay que escribirlo: **una
tarifa mal formada para el outbox entero de un negocio**, como ya aceptó la ADR
0028 § Consecuencias para un valor mal formado. Va al contrato con ejemplo.

**I7 — el criterio 6 solo es alcanzable si el catálogo se puede consultar sin
tocar la base.** Un `400` lo emite el schema del sobre
(`src/app/api/internal/sync/catalog/route.ts:31-37`), que corre **antes** de
cualquier query y no puede hacer ninguna. Si el índice viviera solo en Postgres,
lo máximo posible sería un `failed[]` por evento, y el criterio estaría mal
escrito. Es alcanzable porque el acuerdo ya dice que el índice son **bytes
commiteados** (R8): el schema lo importa como módulo. Queda escrito porque es la
razón por la que ese acuerdo no es un detalle de gusto.

**I8 — el criterio 11 dice «sembrado» y `npm run seed` es el seed de
desarrollo.** `prisma/seed.ts` crea dos tiendas de demostración y **no se ejecuta
en producción**; el catálogo, en cambio, es dato de referencia sin el que el
tarifario no funciona en ningún entorno. Hace falta un camino que sirva a los dos:
una función de siembra idempotente llamada **desde** `prisma/seed.ts` —para que la
doble ejecución del CI (`.github/workflows/ci.yml`) sea la comprobación de
idempotencia que el criterio pide— y **también** desde un punto de entrada propio
para producción, con su línea en `docs/despliegue.md` § 1 (AGENTS.md
§ Documentación: un paso operativo nuevo se anota en el mismo ciclo). Sin esa
línea, el primer entorno nuevo arranca con el enum migrado, la tabla vacía y todos
los `ZONE_TARIFF` fallando por clave ajena.

**I9 — la Isla de la Juventud obliga a que el id de relación de OSM NO sea
único.** El índice tiene 184 filas y OSM da **183** relaciones: la relación
`1854614` es a la vez la división de primer nivel `40` y el municipio `40.01`. Un
test de integridad escrito con la intuición razonable («cada zona, una relación
distinta») **falla** contra un artefacto correcto. C16 lo fija al revés: 183 ids
distintos y el único repetido tiene que ser ese par.

**I10 — las dos ADR, y solo una se reabre.** La **0028** se reabre por su propia
letra: su § «Reabrir cuando» dice «aparezca un tercer modo de checkout o de
envío… porque el vocabulario sale del enum». La **0011** no: su disparador es
«cualquier consulta de tipo tiendas a menos de N km», y aquí las coordenadas no
deciden el precio ni ordenan nada —el precedente es su propia nota de F-015, donde
un feature disparó la ADR y no la necesitó—. Lo que la 0028 gana es una decisión
nueva que su texto de hoy no contempla: **el invariante (e) no aplica a
`ZONE_BASED`** (R12), porque «con qué cobrar» dejó de ser una propiedad de la fila
`Store`.

**I11 — AGENTS.md enumera las entidades de la guarda que rechaza y la lista se
queda corta.** § Cosas que muerden: «la que **rechaza** y devuelve `STALE`
(`STORE`, `CATEGORY`, `PRODUCT`, `BUSINESS`)». Con `ZONE_TARIFF` son cinco. Es una
línea, en el mismo commit que el código, como hizo F-036 al añadir la forma de
orden.

**I12 — `processBatch.test.ts` mockea cada módulo de handler por su ruta.**
`src/features/sync/server/processBatch.test.ts:33-44` tiene un `vi.mock` por
handler; el handler nuevo necesita el suyo o ese test tocará Prisma de verdad y
fallará por una razón que no dice nada. Lo mismo vale para el `switch` sin
`default` de `applyEvent` (`processBatch.ts:165-178`) y para el `never` de
`dependencyRoleOf` (`src/features/sync/dependencies.ts:74-77`): los dos son la
red que avisa, en `typecheck`, de que falta una rama — y el segundo **nombra** la
entidad, que es por lo que existe.

## Huecos y preguntas al humano

Las cuatro se escribieron **no bloqueantes a propósito**, cada una con su
decisión por defecto ya escrita como regla, y por eso esta spec cerró en
`estado: listo` —el mismo criterio que `.agent/specs/F-036/spec.md`,
`.agent/specs/F-037/spec.md` y `.agent/specs/F-038/spec.md`.

**LAS CUATRO ESTÁN RESUELTAS. El humano las contestó el 2026-09-08, después de
leer esta spec, y en las cuatro eligió la opción recomendada.** Lo que decidió
está escrito al pie de cada una; el defecto y la recomendación se conservan
arriba para que se pueda releer por qué se eligió eso y no otra cosa. Ninguna
vuelve a preguntarse.

Las otras cuatro decisiones del humano, tomadas el mismo día **antes** de esta
spec —el alcance de solo el índice, la errata de Santiago de Cuba, el momento de
enviar el borrador de la v13 y los diez casos en vez de siete— están
incorporadas al cuerpo del documento y tampoco se vuelven a preguntar.

**SP1 — ¿los diez casos del vector son estos diez?**
Qué falta: la composición exacta del cruce del 2026-09-06, que no está escrita en
este repositorio (I3) y que **su** arnés puede tener anotada. Por qué importa: el
valor del vector es que las dos implementaciones prueben **los mismos** casos; si
cada lado publica los suyos, el cruce hay que repetirlo. Por qué no bloquea: los
diez de § «El vector de precedencia» cubren las siete situaciones del acuerdo más
el par que justifica el camino y el caso de la Isla, y el criterio 13 obliga a
recalcularlos ejecutando de todos modos. Opciones: (a) publicar estos diez más
las tres guardas y pedirles su lista al enviar el borrador de la v13, publicando
la **unión** si difieren —defecto, R28—; (b) esperar su lista antes de escribir el
test; (c) publicar la matriz completa de estados de municipio × provincia
(dieciséis casos más los de primer nivel), que contiene cualquier lista que
tuviera cualquiera de los dos. **Recomendación: (a)**, y si al recruzar aparecen
casos suyos que aquí no están, entran todos —nunca se quita uno para que la cuenta
dé diez—. (c) es tentador y más completo, pero les obliga a calcular ocho casos
más justo cuando el borrador llega para revisión, y el vector vale por lo que se
cruza, no por lo que se publica.

**RESUELTO el 2026-09-08 — opción (a): publicar y recruzar.** Palabras del
humano: «Publicar y recruzar». Los diez se **recomputan ejecutando**, se publican
en el borrador de la v13 junto con las tres guardas, y al enviarlo se les pide su
lista. Si difieren, **se publica la unión de las dos**: ningún caso se quita para
que la cuenta dé diez. Encaja con que el borrador ya sale al firmar el plan.

**SP2 — en la ventana entre este feature y F-042, ¿una tienda `ZONE_BASED` no
ofrece domicilio, o lo ofrece sin importe?**
Qué falta: elegir qué contesta `isDeliveryOffered` para el modo nuevo mientras no
existe el selector (I4). Por qué importa: es la única consecuencia **cobrable**
de F-041. Si se deja caer por el camino de `FLAT_RATE`, el comprador paga el
importe residual de la columna o `0.00` de envío, sin que nada falle; si se deja
caer por el de `QUOTED_PER_ORDER`, el pedido entra en el ciclo de propuesta y
aprobación que este feature viene a eliminar. Por qué no bloquea: R13 fija el
defecto y C15 lo comprueba. Opciones: (a) **no se ofrece domicilio** en
`ZONE_BASED` hasta F-042 —el pedido degrada a `PICKUP`, que es el camino que ya
existe—, con `isDeliveryConfigInconsistent` desacoplado para que la configuración
sí se acepte (defecto, R12/R13); (b) se ofrece y el envío queda sin cotizar
(`null`), reusando el ciclo de F-019; (c) se ofrece y se cobra el `deliveryFee`
de la columna. **Recomendación: (a).** Es la única que no cobra un importe que
nadie fijó para esa zona, y F-042 la sustituye por la pregunta de verdad
—«¿tiene esta tienda alguna zona con tarifa resoluble?»— que es literalmente su
criterio 9. (c) queda descartada por escrito: sería el fallo silencioso más caro
que este feature puede introducir.

**RESUELTO el 2026-09-08 — opción (a): no ofrece domicilio.** Palabras del
humano: «No ofrece domicilio». Una tienda `ZONE_BASED` degrada a recogida en
silencio en la ventana, como ya hace F-010 cuando no hay con qué cerrar el
domicilio, y **su configuración sí se acepta y se guarda** —de ahí que
`isDeliveryConfigInconsistent` haya que desacoplarlo (R12/R13, I4)—, para que el
POS pueda cargar su tarifario desde el primer día. El motivo escrito: es la única
opción que no cobra un importe que nadie fijó para esa zona. Cobrar el
`deliveryFee` residual queda descartado.

**SP3 — ¿un `ZONE_TARIFF` cuyo `STORE` falló en el mismo lote vuelve como
`DEPENDENCY_FAILED_IN_BATCH`?**
Qué falta: decidir si `STORE` pasa a **proveer** clave de dependencia
intra-lote, que hoy no la provee (`src/features/sync/dependencies.ts:65-66`). Por
qué importa: sin eso, un `STORE` de una sucursal nueva que falla deja a sus
tarifas saliendo `skipped_not_published` —que viaja en **`ok`**—, el POS marca su
outbox como hecho y **las tarifas se pierden en silencio**. Es el daño exacto que
F-037 existe para evitar. Por qué no bloquea: R23 fija el defecto y es la
maquinaria que ya está construida, dos líneas. Opciones: (a) añadir la cascada
`STORE → ZONE_TARIFF` y documentarla en la v13 (defecto, R23); (b) no añadirla, y
que la pérdida quede documentada como la que `PRODUCT` ya tiene desde la v2.
**Recomendación: (a)**, con un matiz honesto: (a) no cierra el caso de lotes
**distintos** (caso límite 12), que sigue siendo el comportamiento heredado de
`PRODUCT`; cierra el caso en que el fallo es visible, atribuible y reparable en el
mismo lote. Y añade una fila a la tabla de cascadas del contrato, así que va en la
v13 y no después.

**RESUELTO el 2026-09-08 — opción (a): sí, marcar la dependencia.** Palabras del
humano: «Sí, marcar dependencia». `STORE` pasa a proveer clave de dependencia
para `ZONE_TARIFF` en `src/features/sync/dependencies.ts`, el tarifario vuelve
como `DEPENDENCY_FAILED_IN_BATCH` dentro de `failed[]`, y el cambio entra en la
v13. El motivo escrito: sin ello sale `skipped_not_published`, que viaja dentro
de `ok`, y el POS cree guardada una tarifa que no se guardó.

**SP4 — el `code` que viaja por el cable, ¿con punto (`34.01`) o sin él
(`3401`)?**
Qué falta: fijar la forma exacta de la cadena. Por qué importa: es la clave que
empareja las dos bases de datos y **no admite normalización posterior** —un lado
que la escriba de la otra forma no falla, simplemente no encuentra nada y la zona
queda «desconocida»—, y aparece en tres sitios que tienen que coincidir byte a
byte: el artefacto, el payload y la fila guardada. Por qué no bloquea: el borrador
de la v13 sale para revisión y es exactamente la clase de detalle que esa revisión
caza. Opciones: (a) **con punto**, verbatim del Codificador de ONEI (defecto);
(b) sin punto, cuatro dígitos; (c) las dos, normalizando al leer.
**Recomendación: (a)**: es la forma de la fuente autoritativa, y una cadena
verbatim es la que se puede volver a comprobar contra el PDF dentro de un año.
(c) queda descartada: normalizar es lo que convierte «los catálogos divergen» en
«casi siempre funciona».

**RESUELTO el 2026-09-08 — opción (a): con punto, `34.01`.** Palabras del humano:
«Con punto: 34.01». Verbatim como lo imprime el Codificador de ONEI, que es la
autoridad, así que el código del cable es idéntico al que cualquiera puede buscar
en la fuente. Normalizar al leer queda descartado: dos formas del mismo código es
cómo dos bases dejan de emparejar.

## No decidido a propósito

1. **Los nombres de los dos modelos nuevos, de sus columnas y de los dos enums**
   (`Zone`/`ZoneTariff`, `ZoneLevel`/`ZoneTariffRule`, y si el nivel se llama
   `PROVINCE` o `FIRST_LEVEL` — con el matiz de que `PROVINCE` es una pequeña
   mentira para la Isla de la Juventud, que es un municipio especial a ese
   nivel). Del arquitecto. Lo que **no** se negocia: que el nivel sea un campo, que
   la provincia de un municipio sea un campo, y que el vocabulario que viaja
   (`FEE`/`NOT_SERVED`/`INHERIT`, `ZONE_BASED`, `ZONE_TARIFF`) salga de enums y no
   de literales.
2. **Dónde viven los bytes del artefacto y su procedencia**, y cómo se llama el
   punto de entrada de la siembra. Del arquitecto, con dos restricciones: el
   schema del sobre tiene que poder importar el índice **sin base de datos** (I7)
   y el índice **no puede entrar en el bundle de cliente** en este feature.
3. **Cómo se normaliza el importe a dos decimales** dentro de la función pura (si
   recibe una moneda, si `src/lib/money.ts` expone un normalizador sin moneda, o
   si el llamador envuelve el resultado). Lo que fija esta spec es lo observable:
   `"300.00"`, `"0.00"`, y nunca `String(number)`.
4. **El reparto de los tests entre ficheros** y cuáles van al proyecto `db`. Del
   arquitecto y del `sdd-tester`. Lo que sí es obligatorio: los criterios que
   dicen «verificado leyéndola/contándolas» van contra Postgres real y por el
   `POST` de verdad.
5. **Si `scripts/send-catalog-batch.mjs` gana una bandera `--zone-tariff`**, como
   ganó `--business` en F-038. Ningún criterio la pide; ayudaría a la verificación
   manual y al § Verificación del contrato.
6. **Si el handler emite `console.warn` de diagnóstico** en cada rechazo. R19 lo
   exige para la zona retirada; en los demás caminos, su forma está fijada
   (prefijo de dominio, nunca `console.error`) y que exista, no.
7. **Qué hace cuadrecaja con el índice** cuando lo consuma: su propio test de
   integridad, en su repositorio. Aquí solo se garantiza que los bytes y su hash
   son los mismos.
