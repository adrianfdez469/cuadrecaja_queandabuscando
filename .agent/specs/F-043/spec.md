---
feature: F-043
agente: sdd-spec
actualizado: 2026-09-10T01:35:09Z
estado: listo
---

> **Corrige el criterio 6 de F-041, no lo reemplaza.** Todo lo demás de F-041
> —la entidad `ZONE_TARIFF`, la precedencia, el catálogo, la cascada
> `STORE → ZONE_TARIFF`, los otros dos códigos de error— sigue en pie tal
> cual. Lo único que cambia es **dónde se decide** que un `zoneCode` no vale y
> **a quién se lleva por delante** esa decisión.

## Problema

Hoy, un `zoneCode` que este lado no reconoce mata el **lote entero** con
`400 INVALID_BATCH`: lo decide el schema del sobre
(`src/features/sync/schemas.ts:170-173`, `.refine(isKnownZoneCode)`), que corre
en `src/app/api/internal/sync/catalog/route.ts:31-37` **antes** de que ningún
evento llegue a su handler y antes de `recordBatch`. Medido en el código de
cuadrecaja y no supuesto (`notes` de F-043): un `400` les llega como
`outcome.kind === "error"` y su `planOutboxAck` (src/lib/qab/outboxAck.ts en
**su** repositorio) le suma un intento a **todas** las filas del lote, no a la
culpable; con `QAB_OUTBOX_MAX_ATTEMPTS = 6`, una sola divergencia de un
municipio quema los seis intentos de cada `PRODUCT` y cada `STORE` que viajara
con ella, y después el drenaje **no los vuelve a reclamar nunca**. La
divergencia de catálogos no es un caso raro: es la razón de existir de ese
código.

El mismo defecto tiene el `regex(ZONE_CODE_PATTERN)` de `STORE.zoneCode`
(`src/features/sync/schemas.ts:58`), que es un `400` de lote por un campo cuyo
valor **desconocido** ya falla solo su evento
(`STORE_ZONE_UNKNOWN`): la misma clase de dato malo responde de dos formas
distintas según cómo esté mal escrito. Es la incongruencia I6 que el arquitecto
de F-041 marcó y aceptó a propósito (`.agent/specs/F-041/spec.md` § I6); este
feature la cierra.

## Alcance

### Dentro

- Que **ningún valor** de `zoneCode` produzca un `400` de lote, ni en
  `ZONE_TARIFF` ni en `STORE`.
- Que la validez del `zoneCode` se decida **en el aplicador** —el handler— y
  que el fallo sea de **ese evento**, en `failed[]` del `207` de siempre.
- Que las **dos causas** —código ausente del catálogo y código sin la forma del
  DPA— den exactamente la misma respuesta, con el código de error que ya
  existe por entidad.
- El orden exacto de las comprobaciones dentro de `handleZoneTariff` cuando el
  `zoneCode` inválido coincide con un `DELETE`, con una tienda que no existe o
  es de otro negocio, con un evento rancio o con una dependencia fallida del
  mismo lote (R7).
- La subida de `docs/sync-contract.md` a **v13.2** con los siete sitios que
  hablan del `400` (§ Datos y contrato).

### Fuera (explícito)

- **El camino del comprador.** `src/features/orders/schemas.ts:109` valida
  `zoneCode` con `.trim().min(1).max(ZONE_CODE_MAX_LENGTH)` y **sin**
  `isKnownZoneCode`: retirar el `refine` del schema del sync no toca
  `POST /api/orders`. Comprobado por el orquestador el 2026-09-09; no se
  re-verifica.
- **Los otros valores del sobre.** Un `rule` inválido, un `deliveryFee` donde
  `rule` lo prohíbe (`ZONE_TARIFF_FEE_NOT_ALLOWED`), un `updatedAt` que no es
  ISO, un `deliveryFeeMode` que no está en el enum: **siguen siendo `400` de
  lote**. Este feature mueve `zoneCode` y nada más.
- **La precedencia, el catálogo y sus artefactos.** El vector JSON del contrato
  y su `sha256` no se tocan, así que `src/features/zones/precedence.test.ts`
  sigue verde sin cambiar una línea.
- **`ZONE_TARIFF_DELETE_NOT_SUPPORTED`** y su orden (R20 de F-041): intactos.
- **Crear un código de error nuevo.** No hay `ZONE_CODE_MALFORMED` (decisión
  del humano, 2026-09-09), y no se retira ningún código ya escrito en el
  borrador.
- **Publicar la v13.** Sigue en borrador; este feature la deja en v13.2 y la
  publicación espera al visto bueno de cuadrecaja.
- **La reconciliación de tarifarios** (`F-044`, citada en el contrato) y
  cualquier pantalla.

## Actores y precondiciones

Quien dispara esto es el **outbox de cuadrecaja** contra
`POST /api/internal/sync/catalog` con su bearer token. Lo que el sistema ya
garantiza y de lo que dependen los escenarios, verificado leyendo el código:

- **Un `400` del schema mata el lote entero y no escribe ninguna
  `SyncEvent`** (`src/app/api/internal/sync/catalog/route.ts:31-37`). Es lo que
  este feature quita de en medio para `zoneCode`.
- **Un fallo por evento se expresa lanzando `SyncEventFailure`**
  (`src/features/sync/server/handlers/types.ts`); el `catch` del bucle
  (`src/features/sync/server/processBatch.ts:119-128`) ya lo convierte en
  `failed[].error`, en `results[].error` y en `markFailed`, sin tocar una línea
  allí. **No hace falta maquinaria nueva**: el camino de `failed[]` ya existe y
  ya lo usan `STORE_ZONE_UNKNOWN` y `ZONE_TARIFF_DELETE_NOT_SUPPORTED`.
- **Un evento fallido NO es un duplicado**
  (`src/features/sync/server/inbox.ts:38-45`): solo `PROCESSED` y `SKIPPED`
  cuentan como asentados, así que una fila `FAILED` se **vuelve a procesar** en
  la siguiente entrega del mismo `eventId`. Esto es lo que hace real la clase
  «reintentable» (R4): sin ello, el evento volvería en `ok` como `duplicate` y
  la tarifa se perdería en silencio (AGENTS.md § Cosas que muerden).
- **La dependencia intra-lote se comprueba ANTES del handler**
  (`src/features/sync/server/processBatch.ts:80-94`): un `ZONE_TARIFF` cuyo
  `STORE` falló antes en el mismo lote nunca llega a `handleZoneTariff`.
- **`ZONE_TARIFF` no provee ninguna clave de dependencia**
  (`src/features/sync/dependencies.ts:82-83`): un tarifario que falla no
  arrastra a nadie.
- **`handleStore` tiene tres escrituras y las tres están guardadas** por
  `assertZoneKnown` (`src/features/sync/server/handlers/store.ts:138`, `:214`,
  `:261`), llamada justo antes de cada una y nunca al principio de la función.
  Ninguna escritura de `Store.zoneCode` ocurre sin pasar por el catálogo.
- **`Store.zoneCode` y `ZoneTariff.zoneCode` tienen clave ajena al catálogo**
  (`prisma/schema.prisma:357`, `:435`), así que la comprobación contra el índice
  no es cosmética: es lo que evita un error de clave ajena.

## Comportamiento esperado

**E1 — un `ZONE_TARIFF` de una zona que no está en el catálogo falla solo su
evento.**
Dado un negocio autenticado con una sucursal publicada y un lote de tres
eventos —un `ZONE_TARIFF` con `zoneCode: "99.99"`, un `PRODUCT` válido y un
`ZONE_TARIFF` con `zoneCode: "21.01"` válido—, cuando se envía, entonces la
respuesta es **`207`**, el primer `ZONE_TARIFF` está en `failed[]` con
`error: "ZONE_TARIFF_ZONE_UNKNOWN"` y **no** en `ok`, los otros dos están en
`ok` como `processed`, contando en la base hay **una** fila de tarifario
(`"21.01"`) y **cero** para `"99.99"`, y el producto existe.

**E2 — un `zoneCode` mal formado responde exactamente igual.**
Ídem E1 con `zoneCode: "2101"` (sin punto), y otra vez con `"21.1"`, con
`"abc"`, con `""` y con `" 21.01"` (espacio delante). En los cinco: `207`, ese
evento en `failed[]` con `ZONE_TARIFF_ZONE_UNKNOWN`, los otros dos aplicados.
**Nunca `400`.**

**E3 — un `STORE` con un `zoneCode` mal formado falla ese evento entero.**
Dado un `STORE` de una sucursal ya existente con `zoneCode: "2101"` y además un
`phone` corregido, y un `PRODUCT` válido detrás en el mismo lote, cuando se
envía, entonces la respuesta es `207`, ese evento está en `failed[]` con
`error: "STORE_ZONE_UNKNOWN"`, **ninguno** de sus campos se aplica —tampoco el
teléfono—, su `sourceUpdatedAt` **no** avanza, y el `PRODUCT` sí se aplica.

**E4 — desconocido y mal formado son indistinguibles en el `STORE`.**
Dado el mismo lote de E3 pero con `zoneCode: "99.99"` (bien formado, ausente
del catálogo), entonces la respuesta es **la misma byte a byte**: `207`, mismo
`failed[].error`, mismos campos sin aplicar, misma marca sin mover. Los dos
caminos acaban igual porque los dos preguntan lo mismo: si el código está en el
índice (R2).

**E5 — las tres escrituras de `handleStore` están cubiertas.**
Dado un `zoneCode: "2101"`, entonces falla igual (a) en un `STORE` de una
sucursal que **no existe** con `publishToStore: true` —el camino de creación—,
sin que se cree ni la sucursal ni su marca; (b) en un `STORE` de una sucursal
existente con `publishToStore: true` —el camino de actualización—; y (c) en un
`STORE` de una sucursal existente con `publishToStore: false` y
`operation: "UPDATE"` —el camino de despublicación—, que **tampoco** despublica.
En los tres, `failed[]` con `STORE_ZONE_UNKNOWN` y nada escrito.

**E6 — `zoneCode: null` en un `STORE` sigue siendo legítimo.**
Dado una sucursal con `zoneCode = "21.01"` guardado, cuando llega un `STORE`
con `zoneCode: null` y `updatedAt` posterior, entonces `processed`, en `ok`, y
la columna queda **vacía**. Un `null` no se busca en el catálogo: no hay nada
que buscar (R9).

**E7 — un `STORE` sin la clave `zoneCode` no la toca.**
Dado la misma sucursal con `zoneCode = "21.01"`, cuando llega un `STORE` que
**no trae** la clave, entonces `processed` y la columna sigue con `"21.01"`.
«Omitir no es apagar» (R29 de F-041) no cambia.

**E8 — un `DELETE` gana sobre la zona inválida.**
Dado un `ZONE_TARIFF` con `operation: "DELETE"`, `zoneCode: "99.99"` (o
`"2101"`) y cualquier `updatedAt`, entonces `failed[]` con
`error: "ZONE_TARIFF_DELETE_NOT_SUPPORTED"`, **nunca** `ZONE_TARIFF_ZONE_UNKNOWN`,
sin ninguna consulta a la base y sin tocar ninguna fila.

**E9 — una sucursal que aquí no existe gana sobre la zona inválida.**
Dado un `ZONE_TARIFF` con `zoneCode: "99.99"` y un `storeId` que no
corresponde a ninguna fila `Store`, entonces `status: "skipped_not_published"`,
**en `ok`**, y cero filas escritas.

**E10 — una sucursal de otro negocio responde lo mismo que una inexistente.**
Dado el negocio B enviando un `ZONE_TARIFF` con `zoneCode: "99.99"` sobre el
`storeId` de una tienda del negocio A, entonces `skipped_not_published` en `ok`,
byte a byte igual que E9, y cero filas nuevas en el tarifario de A. La
propiedad que el contrato afirma —un recurso de otro negocio es indistinguible
de uno inexistente— se conserva.

**E11 — un evento rancio gana sobre la zona inválida.**
Dado el caso degenerado en que la base espejo tiene una zona que el artefacto
ya no tiene y existe una fila de tarifario para ella, cuando llega un
`ZONE_TARIFF` de esa pareja con `updatedAt` **menor o igual** al guardado,
entonces `stale`, en `ok`, y la fila no se mueve. Con `updatedAt` **mayor**,
`failed[]` con `ZONE_TARIFF_ZONE_UNKNOWN`.

**E12 — una dependencia fallida del mismo lote gana sobre todo lo anterior.**
Dado un lote donde el `STORE` de una sucursal falla (por ejemplo con
`STORE_ZONE_UNKNOWN`) y detrás viajan dos `ZONE_TARIFF` de esa misma sucursal,
uno con zona válida y otro con `"99.99"`, entonces los **dos** vuelven en
`failed[]` con `error: "DEPENDENCY_FAILED_IN_BATCH"`, no con
`ZONE_TARIFF_ZONE_UNKNOWN`, y ninguno escribe nada.

**E13 — un `STORE` con `DELETE` y un `zoneCode` inválido se aplica igual.**
Dado una sucursal con tres filas de tarifario, cuando llega un `STORE` con
`operation: "DELETE"`, `updatedAt` posterior y `zoneCode: "2101"`, entonces
`processed`: un `DELETE` **nunca configura** (R14/E11 de F-041,
`src/features/sync/server/handlers/store.ts:125`), así que el `zoneCode` ni se
mira, la sucursal queda suspendida y sus filas de tarifario contadas después
son **cero**.

**E14 — un lote grande sobrevive a una tarifa divergente.**
Dado un lote de 500 eventos con **uno** solo con `zoneCode: "99.99"`, entonces
`207`, `ok.length === 499`, `failed.length === 1`, y los 499 verificados en la
base. Es el escenario que hoy tira el outbox entero de un negocio.

**E15 — el evento fallido deja rastro y se puede reintentar.**
Dado E1 aplicado, entonces existe una fila `SyncEvent` con ese `eventId`,
`status = "FAILED"` y `error = "ZONE_TARIFF_ZONE_UNKNOWN"`; y cuando el mismo
`eventId`, **sin cambiar un byte**, se reenvía después de que el catálogo
converja, entonces se aplica: sale `processed`, **no** `duplicate`.

**E16 — un tarifario fallido no arrastra a nadie.**
Dado un lote con un `ZONE_TARIFF` de zona desconocida y, detrás, otro
`ZONE_TARIFF` de la **misma** sucursal con zona válida, entonces el segundo
sale `processed`: `ZONE_TARIFF` no provee ninguna clave de dependencia.

## Reglas de negocio

**R1 — el schema del sobre deja de opinar sobre el VALOR de un `zoneCode`.** Ni
`regex` ni `refine`, ni en `ZONE_TARIFF` (`src/features/sync/schemas.ts:170-173`)
ni en `STORE` (`src/features/sync/schemas.ts:58`). Es el mismo camino que abrió
`openingHours` en la v9 y que repitió `displayCurrencies` en la v12
(`src/features/sync/schemas.ts:146-150`, «LAX on purpose»): lo que no es la
**forma del sobre** se valida en el **aplicador**, porque declararlo estricto
ahí convierte un dato malo en un `400` que se lleva los otros 499 eventos.

**R2 — «válido» significa «está en el índice», y eso cubre las dos causas.** La
única pregunta es `isKnownZoneCode(code)`
(`src/features/zones/catalog.ts:71-73`), una búsqueda exacta en el `Map` del
artefacto commiteado: un código mal formado **nunca** está en el índice, así que
las dos causas colapsan en una sola comprobación y no hace falta distinguirlas.
La comparación es **byte a byte**: sin `trim`, sin normalizar, sin plegar
mayúsculas — igual que el resto del vocabulario del cable.

**R3 — un código de error por entidad, que cubre las dos causas.**
`ZONE_TARIFF_ZONE_UNKNOWN` para el tarifario, `STORE_ZONE_UNKNOWN` para la
tienda (`src/constants/sync.ts:93`, `:134`). No se crea `ZONE_CODE_MALFORMED` y
no se retira ninguno de los tres códigos que el borrador de la v13 ya escribió
(decisión del humano, 2026-09-09, anotada en `.agent/progress/F-043.md`). Los
comentarios de esas dos constantes tienen que dejar de decir «schema» y «`400`
de lote» y pasar a nombrar el handler y las dos causas.

**R4 — los dos códigos son «reintentables», también cuando la causa es un
código mal formado.** Consecuencia aceptada explícitamente por el humano: un
código mal formado nunca converge, así que quema los seis intentos de **ese**
evento —y solo de ese—, que es justo lo que este feature persigue. Es real
porque una fila `SyncEvent` en `FAILED` se vuelve a procesar
(`src/features/sync/server/inbox.ts:38-45`), no vuelve como `duplicate`.

**R5 — el TIPO del campo lo sigue decidiendo el schema, y sigue siendo un `400`
de lote.** `zoneCode` sigue siendo `z.string()` en `ZONE_TARIFF` (obligatorio) y
`z.string().nullish()` en `STORE`. Un `zoneCode` que llega como número, como
objeto, como `null` en `ZONE_TARIFF`, o **ausente** en `ZONE_TARIFF`, es un
error de forma del sobre como cualquier otro campo obligatorio, y responde
`400 INVALID_BATCH`. Lo que el criterio 3 prohíbe es un `400` por el **valor**
de un `zoneCode`, que es la lectura que fijan las `notes` del feature
(«cualquier `zoneCode` no válido va a `failed[]`, sin distinguir si está mal
formado»: las dos alternativas que el humano comparó eran dos cadenas).
Precedente exacto: `barcodes: z.array(z.string())` y
`displayCurrencies: z.array(z.string())` mantienen el tipo en el schema y
mueven **solo el formato del miembro** al aplicador.

**R6 — sin `min`, sin `max` y sin patrón.** Un tope de longitud o un `min(1)`
volverían a ser un `400` por un valor, que es lo que R1 quita; y un tope
convierte un dato que el POS no puede cambiar en un `400` permanente
(precedente de `barcodes` en la v4, escrito en `src/features/sync/schemas.ts:109-111`).
La cadena vacía y una cadena absurdamente larga son simplemente **códigos que
no están en el índice**, y salen en `failed[]` sin tocar la base.

**R7 — el orden dentro de `handleZoneTariff`, entero y sin huecos.** Cinco
pasos; la comprobación nueva es la penúltima:

| Orden | Comprobación                                | Resultado                          | Por qué va ahí                                                                                                                                                                                                        |
| ----- | ------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Dependencia fallida del mismo lote          | `DEPENDENCY_FAILED_IN_BATCH`       | Vive en `src/features/sync/server/processBatch.ts:80-94`, **fuera** del handler: el evento ni siquiera entra. No se toca (R23 de F-041)                                                                               |
| 1     | `operation === "DELETE"`                    | `ZONE_TARIFF_DELETE_NOT_SUPPORTED` | R20 de F-041, literal: lo primero, antes de cualquier consulta. Además es **permanente** contra un `zoneCode` **reintentable**: informar del reintentable escondería un defecto que el POS tiene que corregir sí o sí |
| 2     | Tienda inexistente o de otro negocio        | `SKIPPED` (viaja en `ok`)          | R24 de F-041. Una tarifa de una sucursal que aquí no existe ya se descarta hoy sea cual sea su zona; convertirla en `failed[]` reintentable añadiría seis reintentos que **acabarían igual en `SKIPPED`**             |
| 3     | Guarda anti-rancio (`>=`)                   | `STALE` (viaja en `ok`)            | R21 de F-041. Simetría con `STORE`, donde `assertZoneKnown` se llama **después** de los `SKIPPED`/`STALE` a propósito (`src/features/sync/server/handlers/store.ts:355-372`): un descarte no se convierte en un fallo |
| 4     | **`zoneCode` no está en el índice** (nuevo) | `ZONE_TARIFF_ZONE_UNKNOWN`         | Justo antes del `upsert` que protege, igual que `assertZoneKnown` en `handleStore`. Es lo que evita el error de clave ajena contra el catálogo                                                                        |
| 5     | `upsert` y slug canónico                    | `processed`                        | Sin cambios                                                                                                                                                                                                           |

El aviso de zona retirada (R19/E10 de F-041) es indiferente a este orden: una
zona retirada **está** en el índice, así que nunca es «desconocida».

**R8 — en `STORE` no se mueve nada de sitio.** `assertZoneKnown` se queda donde
está, llamada antes de cada una de las tres escrituras
(`src/features/sync/server/handlers/store.ts:138`, `:214`, `:261`). Al
desaparecer el `regex` del schema, el camino «mal formado» **cae en el mismo
sitio** que el camino «desconocido», y por eso E3 y E4 son la misma respuesta.
Ninguna escritura de `Store.zoneCode` queda sin guardar.

**R9 — `null` y ausente no cambian de significado.** `zoneCode: null` borra la
columna y **no** se comprueba contra el catálogo (`config.zoneCode == null`
sale antes, `src/features/sync/server/handlers/store.ts:368`); ausente deja la
columna intacta. R29 de F-041 sigue vigente palabra por palabra.

**R10 — un `STORE` con `operation: "DELETE"` no mira su `zoneCode`.** El
handler construye `config = {}` en ese caso
(`src/features/sync/server/handlers/store.ts:125`, R14/E11 de F-041), así que
`assertZoneKnown` no hace nada. Fallar un cierre de sucursal por un campo que
ese evento ignora sería inventar un error nuevo, y hoy —con el `regex` en el
schema— ni siquiera es distinguible de un `400` del lote.

**R11 — un `ZONE_TARIFF` fallido no arrastra a nadie.** `ZONE_TARIFF` provee
`null` en `src/features/sync/dependencies.ts:82-83`, y esa tabla no cambia.

**R12 — un `STORE` fallido por su zona sigue arrastrando a sus `ZONE_TARIFF` del
mismo lote.** `DEPENDENCY_FAILED_IN_BATCH`, sin tocar nada (R23 de F-041). Lo
nuevo es que **ahora es alcanzable con un código mal formado**: antes ese caso
mataba el lote y no llegaba a la cascada.

**R13 — el fallo no invalida caché.** Ni el `ZONE_TARIFF` ni el `STORE` que
fallan calculan slug canónico ni reportan nada tocado (R25 de F-041); el camino
del `catch` de `processBatch.ts` no añade nada a los conjuntos de
revalidación.

**R14 — `docs/sync-contract.md` sube a v13.2, dígito MENOR.** Ya está escrito en
su § «Cambios respecto a la v12.2» que F-043 la deja en v13.2: el borrador de la
v13 sigue sin publicarse y cada edición es una revisión del mismo borrador. No
se decide aquí. Los siete sitios que hay que mover están en § Datos y contrato.

**R15 — el catálogo, la precedencia y el vector no se tocan.** El bloque JSON del
vector y su `sha256` quedan idénticos, y con ellos
`src/features/zones/precedence.test.ts`.

## Casos límite y errores

1. **`zoneCode: ""`** — no está en el índice: `failed[]` con el código de su
   entidad. No es «borrar» (solo `null` borra, R9) ni un `400`.
2. **`zoneCode: " 21.01"` o `"21.01 "`** — no está en el índice, byte a byte:
   `failed[]`. No se recorta (R2).
3. **`zoneCode` de 10 000 caracteres** — `failed[]`, cero consultas nuevas: la
   búsqueda es un `Map.has` sobre el artefacto. El tamaño del cuerpo lo acota
   la plataforma, no este campo (R6).
4. **`zoneCode: 2101` (número) o `null` en un `ZONE_TARIFF`** — responde
   `400 INVALID_BATCH`, como cualquier campo obligatorio con el tipo cambiado
   (R5). Es la única puerta que sigue abierta al `400`, y es de **forma**, no
   de valor.
5. **Zona retirada** — está en el índice: se acepta y se avisa con
   `console.warn` con prefijo de dominio (R19 de F-041, y AGENTS.md § Cosas que
   muerden: nunca `console.error`).
6. **Zona presente en el artefacto y ausente en la base espejo** — sigue siendo
   un error de clave ajena que sale en `failed[]` con el mensaje crudo de
   Prisma (caso límite 15 de F-041). Este feature no lo mejora ni lo empeora; lo
   que lo evita sigue siendo el paso de siembra de `docs/despliegue.md`.
7. **Zona presente en la base y ausente en el artefacto** — el artefacto manda
   (ADR 0032): el evento sale `failed[]` aunque la fila exista, salvo que la
   guarda anti-rancio lo declare `stale` antes (E11).
8. **Dos `ZONE_TARIFF` de la misma pareja en un lote, uno con la zona bien y
   otro mal** — se aplican en orden de `occurredAt`; el bueno escribe, el malo
   falla. Ninguno bloquea al otro (R11).
9. **El mismo `eventId` reenviado tras un fallo** — se re-procesa (R4/E15). Tras
   un `processed` o un `skipped`, vuelve como `duplicate` en `ok`, como
   siempre.
10. **Un lote de 500 `ZONE_TARIFF` todos con zona desconocida** — `207` con 500
    en `failed[]`. Coste: 500 búsquedas en un `Map` y 500 consultas de sucursal
    (una por evento, las que el handler ya hace hoy). No hay consulta nueva por
    la comprobación de zona.
11. **Una tarifa que llega antes que su `STORE` en lotes distintos** —
    `skipped_not_published`, como hoy (caso límite 12 de F-041). Que su zona sea
    inválida no lo cambia (R7, paso 2).
12. **Un `STORE` que falla por su zona deja aplicado el nombre del negocio.**
    `handleStore` actualiza `Business.name`/`baseCurrencyCode` en su primera
    línea (`src/features/sync/server/handlers/store.ts:74-78`), antes de
    cualquier guarda. Es un defecto **preexistente** que ya afecta a
    `STORE_OPENING_HOURS_INVALID` (v9) y a `STORE_ZONE_UNKNOWN` (v13); este
    feature lo hace alcanzable con una causa más y **no lo arregla** (I4).

## Datos y contrato

### Lo que cambia en el cable

Nada de la **forma** del payload: `zoneCode` sigue siendo una cadena
obligatoria en `ZONE_TARIFF` y opcional en `STORE`, con la misma semántica de
omisión. Lo que cambia es la **respuesta** ante un valor que este lado no
reconoce: de `400` de lote a `207` con ese evento en `failed[]`. Para
cuadrecaja es estrictamente mejor y no les obliga a cambiar nada que ya
funcione: un código que ya trataban como reintentable lo sigue siendo, y deja
de arrastrar al resto del lote.

### Los siete sitios de `docs/sync-contract.md`

Los edita quien implemente, con el plan firmado; esta spec fija **qué tiene que
decir cada uno** para que el criterio 4 sea verificable:

1. **Línea 3 (la versión)** → `**Versión 13.2**` con su fecha. Es el dígito
   menor y lo exige AGENTS.md § Documentación en toda edición del fichero.
2. **§ «Cambios respecto a la v12.2»** → una entrada nueva **v13.2 (F-043)**
   que diga, en una frase, que un `zoneCode` desconocido o mal formado pasa de
   `400` de lote a `207 failed[]` de ese evento, y por qué (su `planOutboxAck`
   sube el contador de todo el lote).
3. **Tabla del `payload` de `ZONE_TARIFF`, fila `zoneCode`** (hoy
   `docs/sync-contract.md:153`) → «si no está en el catálogo **o no tiene esta
   forma**, `207 failed[]` con `ZONE_TARIFF_ZONE_UNKNOWN` de **ese evento**».
4. **§ «Los tres códigos de error nuevos», fila
   `ZONE_TARIFF_ZONE_UNKNOWN`** (hoy `docs/sync-contract.md:893`) → columna
   «Dónde»: `207 failed[]` de ese evento; y la columna «Cuándo» tiene que
   nombrar **las dos causas**. La clase sigue siendo **reintentable**, con la
   nota de que un código mal formado agota los reintentos de ese evento y de
   ninguno más.
5. **El ejemplo del `400` que se lleva 499 eventos** (hoy
   `docs/sync-contract.md:897-920`, con su párrafo de justificación sobre la
   ADR 0028) → **eliminado**. En su lugar, el ejemplo del `207` con el evento en
   `failed[]` y los demás en `ok`. El criterio 4 lo pide con esas palabras.
6. **§ «Vocabulario de errores»**: el párrafo introductorio (hoy
   `docs/sync-contract.md:1844-1846`, «es de la v13 (F-041), como `400` de
   **lote**, no como `207`») y la fila de la tabla (hoy
   `docs/sync-contract.md:1869`) → las dos a `207 failed[]`. La fila de
   `STORE_ZONE_UNKNOWN` (hoy `docs/sync-contract.md:1871`) y la de propiedad de
   campos (hoy `docs/sync-contract.md:2202`) ganan la causa «mal formado».
7. **§ «Un `zoneCode` que no existe…» del `payload` de `STORE`** (hoy
   `docs/sync-contract.md:214-219`) y el párrafo del veredicto de cuadrecaja
   que anuncia este feature (hoy `docs/sync-contract.md:1251-1258`) → el
   segundo deja de decir «solo `ZONE_TARIFF.zoneCode` desconocido sigue siendo
   `400` de lote» y pasa a decir que F-043 lo cerró.

Lo que **no** se toca: el bloque JSON del vector y su `sha256`, la tabla de la
cascada `STORE → ZONE_TARIFF`, la § «La versión del catálogo geográfico» y el
aviso de «no emitáis `ZONE_TARIFF` hasta el aviso», que sigue en pie porque la
v13 sigue en borrador.

### Los dos comentarios de `src/constants/sync.ts`

`ZONE_TARIFF_ZONE_UNKNOWN` (línea 93) dice hoy «Decided in the sobre's schema…
so it kills the whole `400 INVALID_BATCH` lote»: tiene que pasar a nombrar el
handler, las dos causas y el `failed[]`. `STORE_ZONE_UNKNOWN` (línea 134) gana
la causa «mal formado». Las constantes **no cambian de valor**: el POS las
compara byte a byte.

## Criterios de aceptación propuestos

**C1 `[ya]`** — «Un `ZONE_TARIFF` con un `zoneCode` que no está en el catálogo
responde `207` con ESE evento en `failed[]` con su propio código, y los demás
eventos del mismo lote se aplican, verificado contándolos y leyéndolos
después.»
E1. `POST /api/internal/sync/catalog` con tres eventos → `status === 207`,
`body.failed` de longitud 1 con `error === "ZONE_TARIFF_ZONE_UNKNOWN"`,
`body.ok` de longitud 2, `prisma.zoneTariff.count()` sobre esa sucursal = 1 y
la fila leída es la de `"21.01"`, el `StoreProduct` existe, y
`prisma.syncEvent.count()` de los tres = 3 con el culpable en `FAILED`. Vive
con los demás casos contra Postgres real de
`src/features/sync/server/handlers/zoneTariff.db.test.ts`.

**C2 `[ya]`** — «Un `ZONE_TARIFF` cuyo `zoneCode` no cumple la forma del DPA
responde igual: `failed[]` de ese evento y no un `400` de lote, verificado con
un código mal formado en un lote de tres eventos.»
E2. El mismo lote de C1 con `zoneCode: "2101"` → `status === 207` (el aserto
que importa es que **no** es `400`), mismo `failed[0].error`, mismos dos
eventos aplicados. Se ejecuta además con `""` y con `" 21.01"`.

**C3 `[ya]`** — «Ningún lote responde `400` por causa de un `zoneCode`, ni en
`ZONE_TARIFF` ni en `STORE`, verificado ejecutando los dos casos.»
E2 + E3/E4: dos peticiones, `expect(status).not.toBe(400)` y
`expect(status).toBe(207)` en las dos, con el `failed[].error` de la entidad
correspondiente. Se lee acotado al **valor** del campo, no a su tipo (R5).

**C4 `[ya]`** — «`docs/sync-contract.md` sube de versión retirando el `400` de
lote por zona desconocida, con el código declarado como reintentable y el
ejemplo del `400` que se llevaba 499 eventos eliminado, coordinada con
cuadrecaja.»
Verificable con tres comandos: `sed -n 3p docs/sync-contract.md` contiene
`13.2`; `grep -c 'que se lleva 499 eventos' docs/sync-contract.md` da `0`; y
`grep -n 'ZONE_TARIFF_ZONE_UNKNOWN' docs/sync-contract.md` no devuelve ninguna
línea que diga `400` de **lote**. Más `npm test` verde, que incluye el hash del
vector sin mover (R15). La coordinación con cuadrecaja es del orquestador, no
un comando.

**C5 `[ya]`** — `bash .agent/verify.sh F-043 --full` termina con código 0. Es
**la puerta**, no un requisito de producto: no se especifica aquí como
comportamiento.

**C6 `[nuevo]`** — Un `STORE` con `zoneCode: null` responde `processed` y deja
la columna vacía; sin la clave, `processed` y la columna intacta. Protege R9 de
la regresión más fácil al retirar el `regex`: convertir el `null` legítimo en un
fallo. Se verifica leyendo la columna después de cada uno de los dos eventos.

**C7 `[nuevo]`** — Con un `zoneCode` inválido, un `ZONE_TARIFF` con
`operation: "DELETE"` responde `ZONE_TARIFF_DELETE_NOT_SUPPORTED`, y uno sobre
una sucursal inexistente o de otro negocio responde `skipped_not_published` en
`ok`. Fija el orden de R7, que es lo que dos implementaciones distintas
resolverían de dos maneras.

## Incongruencias detectadas

**I1 — el criterio 6 de F-041 queda superado, y su spec y su arquitectura
siguen describiendo el `400`.** `.agent/specs/F-041/spec.md` § E9, § R17, § I6,
su tabla de códigos (§ «Los códigos de error nuevos») y sus casos límite 4 y 5,
más `.agent/specs/F-041/architecture.md` § «Tabla de errores» y su fila I6,
describen el comportamiento **anterior**. No se editan desde aquí (son de otro
feature y de otro agente): a partir de este ciclo, **esta spec es la viva** para
ese camino. Quién anota el reenvío en los documentos de F-041 queda en § No
decidido.

**I2 — el test C6 de F-041 afirma el `400` y va a ponerse rojo.**
`src/features/sync/server/handlers/zoneTariff.db.test.ts:400-441` espera
`status === 400`, `body.error === "INVALID_BATCH"` y `syncEvent.count() === 0`.
Hay que reescribirlo, no borrarlo: es el mismo escenario con el veredicto
invertido, y su nombre cita «C6 (E9)» de F-041. Es trabajo del probador, pero se
anota aquí porque un implementador que solo mire `src/` lo descubriría al
final.

**I3 — la ADR 0028 § Consecuencias dice lo contrario, para una familia de la que
`zoneCode` forma parte.** `docs/adr/0028-configuracion-de-compra-del-pos.md:112-115`:
«un valor mal formado tumba el **lote entero** con `400`, con lo que el outbox
del negocio se para hasta que alguien lo corrija (decisión SP1 del humano)».
`zoneCode` entró en esa familia por R29 de F-041 y ahora **sale** de esa
consecuencia; las cinco columnas originales (`checkoutMode`, `deliveryEnabled`,
`deliveryFee`, `deliveryFeeMode`, `orderExpiryHours`) siguen bajo ella, porque
son tipos y enums y este feature no los toca. Si eso merece una ADR nueva o una
línea, lo decide el arquitecto (§ No decidido).

**I4 — un `STORE` que falla por su zona ya ha escrito el nombre del negocio.**
`src/features/sync/server/handlers/store.ts:74-78` corre antes de toda guarda,
así que la promesa del contrato «ninguno de sus otros campos se aplica» es
cierta para las columnas de `Store` y **falsa** para `Business.name` y
`Business.baseCurrencyCode`. Preexistente desde la v9
(`STORE_OPENING_HOURS_INVALID`), no lo introduce este feature y no se arregla
aquí: arreglarlo es mover una escritura de sitio en un handler que este feature
no necesita tocar, y merece su propio feature del humano si le importa.

**I5 — `ZONE_CODE_PATTERN` se queda sin ningún importador.**
`src/features/zones/catalog.ts:22` lo exporta y, al retirar sus dos usos de
`src/features/sync/schemas.ts`, no queda ninguno en `src/`. No rompe nada —no
hay regla de lint contra un export sin usar—, pero `.agent/specs/F-041/impl.md`
y `.agent/specs/F-042/architecture.md` lo listan como parte de la API del
catálogo. Mantenerlo es defendible (documenta la forma del DPA que el contrato
cita); quitarlo también. Es del arquitecto (§ No decidido).

## Huecos y preguntas al humano

**Ninguna.** Las tres decisiones que este feature necesitaba —el código de error
reutilizado, la «variante simple» sin distinguir la causa, y la versión v13.2—
ya estaban tomadas y escritas antes de empezar (`notes` de F-043,
`.agent/progress/F-043.md`, `docs/sync-contract.md` § «Cambios respecto a la
v12.2»). Las cuatro combinaciones de orden que quedaban abiertas se resuelven
con doctrina **ya escrita** de F-041 —R20 (el `DELETE` primero), R24 (`SKIPPED`
terminal), R21 (`STALE`) y la colocación deliberada de `assertZoneKnown`
después de los descartes en `handleStore`— y quedan fijadas en R7 con su
motivo, no inventadas.

Tres lecturas que el humano puede vetar en una frase si no son las suyas, y que
no bloquean nada mientras tanto: **(a)** el criterio 3 se lee acotado al
**valor** del `zoneCode`, no a su tipo JSON (R5); **(b)** una tarifa con zona
inválida sobre una sucursal que aquí no existe sigue saliendo
`skipped_not_published` en `ok` en vez de `failed[]` (R7, paso 2); **(c)** un
`STORE` con `operation: "DELETE"` no mira su `zoneCode` y se aplica (R10).

## No decidido a propósito

1. **Dónde vive exactamente la comprobación nueva** —una función privada
   `assertZoneKnown` gemela de la de `handleStore`, una guarda en línea, o un
   helper compartido por los dos handlers— y si `ZONE_CODE_PATTERN` sigue
   exportado (I5). Es del **arquitecto**; lo que esta spec fija es el **orden**
   (R7) y el **resultado**, no la forma.
2. **Si I3 merece una ADR nueva o una línea en el plan.** Del **arquitecto**,
   con AGENTS.md § Documentación como criterio.
3. **Quién anota en `.agent/specs/F-041/spec.md` y
   `.agent/specs/F-041/architecture.md` que su criterio 6 quedó superado por
   F-043.** No lo hace el `sdd-spec` de F-043: son artefactos de otro feature.
   Del **orquestador**, al cerrar el ciclo.
4. **Cuándo se publica la v13 y con qué aviso a cuadrecaja.** Del **humano**:
   este feature deja el borrador en v13.2 y nada más.
