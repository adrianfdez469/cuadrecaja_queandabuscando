---
feature: F-036
agente: sdd-spec
actualizado: 2026-09-07T04:08:51Z
estado: listo
---

> Nace de la **S-005** de cuadrecaja (`.agent/solicitudes.md` § «S-004, S-005 y
> S-006 · Las tres reglas que cambió la v11»), aceptada **en su variante de
> orden y no en la de rechazo** («la guarda, sí; el rechazo, no») y **ya
> publicada** en la regla ② de `docs/sync-contract.md` § «Cambios respecto a la
> v10.1». La regla está escrita; lo que falta es cumplirla. Precedente de forma
> más cercano: `.agent/specs/F-035/spec.md`, hermano de la misma v11, del que
> este feature depende **por verificabilidad y no por código**.

## Problema

«Vigente» es literalmente la última fila que llegó: los dos únicos lectores de
tasas —`loadRates` (`src/features/catalog/server/queries.ts:389`, la vitrina) y
`loadFreshRates` (`src/features/orders/server/quote.ts:151`, el checkout)—
piden `orderBy: { createdAt: "desc" }` y se quedan con la **primera** fila de
cada moneda (`queries.ts:396-400`, `quote.ts:158-160`). El outbox del POS no
tiene backoff y corta a los 6 intentos (su ADR 0011), así que el desorden no es
hipotético: si el evento de 440 falla, entra el de 480, y luego el de 440 se
reintenta y pasa, la tienda vuelve a cotizar a 440 **sin error, sin alerta y sin
que ninguno de los dos lados lo detecte**. La tasa no está caducada: está
**resucitada**.

Y el checkout **no se salva por leer fresco**: lee lo mismo, con el mismo
`orderBy`, solo sin caché. Por eso tampoco salta el `409 PRICE_CHANGED`
(`src/app/api/orders/route.ts`): los dos lectores están de acuerdo, y los dos
están de acuerdo en el importe equivocado.

## Alcance

### Dentro

1. Una marca de origen en `ExchangeRate` —`sourceUpdatedAt`, el mismo nombre y
   la misma semántica que las otras tres entidades con guarda
   (`prisma/schema.prisma:295`, `:356`, `:453`)— y un índice que sirva el orden
   nuevo. Hoy el modelo (`prisma/schema.prisma:524-535`) no tiene **ninguna**
   marca de origen.
2. Una migración que **rellena** esa marca con `createdAt` en las filas que ya
   existen. Es la mitad del feature que puede producir el fallo que viene a
   arreglar (R6, R7).
3. Que los dos lectores ordenen por ella, con un orden **total e idéntico** en
   los dos (R4, R5).
4. Que `handleExchangeRate` (`src/features/sync/server/handlers/misc.ts:199`)
   escriba la marca desde `payload.updatedAt`, que ya viaja y ya se valida.
5. Que `prisma/seed.ts:341` suministre la marca, porque con la columna
   `NOT NULL` su `create` de hoy deja de compilar y de correr (I4, R15).
6. Las pruebas: unidad de los dos lectores y del handler, el guion ordenado de
   C5, el `EXPLAIN` de C7 y el smoke que compara los dos lectores en la misma
   corrida (C6).

### Fuera (explícito)

1. **Rechazar eventos rancios.** No hay `STALE`, no hay `failed[]`, no hay
   vocabulario nuevo en la respuesta. La postura está firmada en
   `.agent/solicitudes.md` § S-005 y publicada en la regla ② del contrato: «una
   tasa rancia se inserta igual y responde `processed`, como siempre:
   simplemente no gana». No se reabre (R2, R3).
2. **Borrar filas o deduplicar por valor.** El append-only queda intacto: sigue
   sin haber forma de borrar una fila de `ExchangeRate` desde `src/`, y este
   feature no la añade (R14).
3. **Tocar `CURRENCY`.** Su tercera asimetría —gana el último que llegue— sigue
   en pie **a propósito** (contrato § `payload` de `CURRENCY` ③). `handleCurrency`
   (`src/features/sync/server/handlers/misc.ts:173`) no se toca.
4. **La mitigación del lado de ellos** (cancelar los `EXCHANGE_RATE` pendientes
   de la misma clave al encolar uno nuevo). Es suya, es complementaria y no la
   sustituye esta guarda.
5. **Mover la versión de `docs/sync-contract.md`.** Criterio 8: la regla ② ya
   está publicada. Si se cree que hay que tocar ese archivo, **sube al humano y
   no se edita** — toda edición mueve la versión de su primera línea (AGENTS.md
   § Documentación, hook `.claude/hooks/sync-contract-version.sh`). R17.
6. **Cualquier cambio en lo que el POS envía.** `exchangeRatePayloadSchema`
   (`src/features/sync/schemas.ts:120`) queda intacto: `updatedAt` ya está ahí y
   ya se valida. Lo único que cambia es que **deja de tirarse** (R10).
7. **La invalidación de caché de F-035.** Ya está en pie y este feature la usa
   como precondición, no la modifica: un evento rancio sigue invalidando, e
   invalidar de más es barato (`.agent/specs/F-035/spec.md` § Casos límite,
   última fila).
8. **La semántica de rechazo de las otras tres marcas** (`Store`,
   `LocalCategory`, `StoreProduct`). Siguen devolviendo `STALE`; aquí el
   mecanismo es otro y eso es deliberado (I7).

## Actores y precondiciones

Lo dispara **cuadrecaja**, con `POST /api/internal/sync/catalog` y su bearer
token (`src/app/api/internal/sync/catalog/route.ts`). Nadie más escribe tasas:
la única escritura de `ExchangeRate` en `src/` es el `create` de
`src/features/sync/server/handlers/misc.ts:212`, y fuera de `src/` solo
`prisma/seed.ts:341`. El panel no las toca (ADR 0017).

Precondiciones que el sistema ya garantiza:

- **`payload.updatedAt` viaja y se valida** como `isoDate`
  (`src/features/sync/schemas.ts:120-126`). No hay campo nuevo que pedir.
- **El negocio del evento es el del token.** `findCatalogMismatch`
  (`src/app/api/internal/sync/catalog/route.ts:39`) aborta el lote entero con
  `403 BUSINESS_MISMATCH` antes de `processCatalogBatch`, así que
  `caller.businessId` es la fuente legítima del `businessId` de la fila.
- **F-035 está en pie** (`passes: true` en `.agent/features.json`): aplicar una
  tasa expira `storeTag`/`storeCatalogTag` de las sucursales renderizables del
  negocio, así que la vitrina refleja el resultado **en la primera visita
  posterior**. Sin eso, C1 y C6 solo se podrían verificar reiniciando el
  servidor o saltándose la caché, que es exactamente lo que un criterio
  ejecutable no debe pedir (`.agent/features.json`, `notes` de F-036).
- **Idempotencia por `eventId`.** `recordBatch`
  (`src/features/sync/server/processBatch.ts:39`) reporta `duplicate` sin llamar
  al handler, así que el mismo evento reentregado no escribe una segunda fila.
- **`processed` viaja en `ok`.** `summarize`
  (`src/features/sync/schemas.ts:250-257`) mete en `ok` todo lo que no sea
  `failed`.

## Comportamiento esperado

**E1 — el rancio no gana, y los dos lectores lo dicen igual.**
Dado un negocio con una sucursal publicada y un producto en una moneda no base
con `price: 1`; cuando llega un `EXCHANGE_RATE` de esa moneda con `rate: 480` y
`updatedAt: T2`, y **después** otro con `rate: 440` y `updatedAt: T1 < T2`;
entonces la página de catálogo muestra el importe de 480 en la primera visita
posterior al **segundo** evento, y `POST /api/orders/quote` del mismo producto
devuelve `unitPrice` de 480 en la misma corrida.

**E2 — el rancio responde `processed` y viaja en `ok`.**
Dado el segundo evento de E1; cuando se procesa; entonces su
`results[].status` es exactamente `"processed"` (no `"stale"`, no `"failed"`,
no `"skipped_not_published"`), su `eventId` está en `ok[]`, `failed[]` está
vacío y su fila de `SyncEvent` queda en el estado que escribe `markProcessed`.
No gasta ningún reintento del outbox.

**E3 — el histórico no pierde nada.**
Dado el escenario de E1; cuando termina; entonces
`SELECT count(*) FROM "ExchangeRate" WHERE "businessId"=… AND "currencyCode"=…`
vale exactamente 2 (más las que ya hubiera), las dos con su `rate` original y su
`sourceUpdatedAt` original, y no existe ninguna ruta en `src/` que borre o
actualice una fila de esa tabla.

**E4 — empate exacto: gana el que llegó el último.**
Dados dos `EXCHANGE_RATE` de la misma moneda con el **mismo** `updatedAt` y
`rate` distinta (500 primero, 600 después); cuando los dos se aplican; entonces
la vigente es 600, en los dos lectores. El desempate es `createdAt` mayor, y
`id` mayor como último recurso para que el resultado sea **determinista** y por
tanto igual en las dos consultas (R5, I1).

**E5 — una fila anterior a la migración no se convierte en la vigente.**
Dada una fila sembrada **antes** de aplicar la migración (sin marca de origen,
`createdAt` de enero) y una fila nueva escrita por un evento con `updatedAt` de
hoy; cuando se lee después de migrar; entonces la vigente es la nueva. Y un
tercer evento con `updatedAt` **anterior** a esa fila vieja tampoco la
resucita: sigue ganando la nueva.

**E6 — los dos lectores coinciden.**
Dado cualquiera de los escenarios E1, E4, E5 y E7; cuando se observan la vitrina
y la cotización **sin ningún evento de sync entre las dos observaciones**;
entonces el importe de la tarjeta y el `unitPrice` de la línea son el mismo
número. La comparación es entre los dos lectores, no de cada uno contra una
constante (C6).

**E7 — el orden natural sigue funcionando (no-regresión).**
Dados dos eventos en orden creciente de `updatedAt` (440 y luego 480); cuando se
aplican; entonces la vigente es 480. Es lo que ya pasa hoy y lo que este feature
no puede romper: el 90 % de las entregas son en orden.

**E8 — los dos eventos en el MISMO lote.**
Dado un lote con el `EXCHANGE_RATE` de 480 (`updatedAt: T2`) y a continuación el
de 440 (`updatedAt: T1 < T2`); cuando se procesa; entonces los dos responden
`processed`, se escriben las dos filas y, tras la única `revalidateStores` del
final del lote (`processBatch.ts:100`), la vitrina muestra 480.

**E9 — `CUP` sigue saliendo por `skipped_not_published`.**
Dado un `EXCHANGE_RATE` con `currency: "CUP"`; cuando se procesa; entonces el
`return SKIPPED` de `misc.ts:204` ocurre **antes** de cualquier escritura: no se
escribe fila, no se escribe marca, no se toca `Currency` y el evento no aporta
ningún slug (F-035 R1/E8). CUP nunca tiene fila y por tanto nunca tiene marca.

**E10 — una moneda con una sola fila.**
Dada una moneda con exactamente una fila; cuando se lee; entonces esa es la
vigente, cualquiera que sea su `sourceUpdatedAt` —incluida una marca en el
pasado remoto o rellenada por la migración—. No hay mínimo, no hay caducidad:
la comparación es **entre filas del mismo par**, nunca contra `now()`.

**E11 — un negocio sin ninguna fila de tasas.**
Dado un negocio sin ninguna fila en `ExchangeRate`; cuando se leen las tasas;
entonces los dos lectores devuelven `{}` —igual que hoy— y nada se cae: los
productos en la moneda base se muestran con su importe, y los que están en otra
moneda salen sin importe en la vitrina (`resolveProductPrice` atrapa el
`MoneyError` de `src/lib/money.ts:148`,
`src/features/catalog/catalogFilters.ts:255-266`) y como línea
`orderable: false` con `reason: "NO_PRICE"` en la cotización
(`src/features/orders/server/quote.ts:262-271`). Este feature no cambia ese
camino: ordenar cero filas da cero filas.

**E12 — `updatedAt` en el futuro.**
Dado un `EXCHANGE_RATE` con `updatedAt` un año en el futuro; cuando se aplica;
entonces esa tasa **gana** y sigue ganando hasta que llegue otra con una marca
todavía mayor. Un evento posterior legítimo con `updatedAt` de hoy responde
`processed` (nunca `failed`) y **no** gana. Es la consecuencia declarada de
confiar en el reloj del origen, la misma que ya tienen las otras tres entidades
con guarda; ni el contrato ni este feature acotan la marca a `now()`, y
recortarla sería un cambio de contrato (I5, § Casos límite).

**E13 — el rancio de una moneda no toca a las demás.**
Dado un negocio con `USD` y `MLC`; cuando llega un `EXCHANGE_RATE` rancio de
`USD`; entonces la vigente de `MLC` no cambia. El par es `(negocio, moneda)`, no
el negocio.

**E14 — el rancio de un negocio no toca al de al lado.**
Dados dos negocios con la misma moneda; cuando uno recibe un evento rancio;
entonces la vigente del otro no cambia. Lo garantiza el `businessId` de la
consulta, y `403 BUSINESS_MISMATCH` hace imposible el lote mezclado.

**E15 — el mismo evento reentregado.**
Dado el mismo `eventId` entregado dos veces; cuando llega el segundo; entonces
`duplicate` sin llamar al handler: no se escribe una segunda fila y la vigente no
cambia.

## Reglas de negocio

**R1 — la marca se llama `sourceUpdatedAt`, es `DateTime` y sale de
`payload.updatedAt` sin transformar.** `new Date(payload.updatedAt)`, igual que
`src/features/sync/server/handlers/product.ts:88` y
`src/features/sync/server/handlers/misc.ts:119`. **No** es `occurredAt` del
sobre, **no** es `now()` al aplicar y **no** es `createdAt`. Comprobable: un
evento con `updatedAt: "2026-05-01T10:00:00.000Z"` deja esa fila con
`sourceUpdatedAt = 2026-05-01 10:00:00.000` exacto, leído por SQL.

**R2 — se escribe siempre; el rancio también.** `handleExchangeRate` no gana
ninguna rama nueva: sigue siendo un `create` incondicional
(`misc.ts:212`) y **nunca** devuelve `STALE`. Comprobable: el módulo de
handlers no introduce ninguna comparación de marcas en el camino de
`EXCHANGE_RATE`, y E3 cuenta las dos filas.

**R3 — el estado devuelto es exactamente `processed`.** No `stale`, aunque
`stale` también viaje en `ok`: el contrato promete `processed`
(§ ② de la v11) y `stale` significaría para el POS que su evento no se aplicó,
cuando sí insertó su fila. Tres puntos de medición, y los tres tienen que
coincidir: `results[].status`, la pertenencia a `ok[]`, y el estado de la fila de
`SyncEvent`.

**R4 — «vigente» es la de `sourceUpdatedAt` mayor, y el orden es TOTAL e
IDÉNTICO en los dos lectores.** El criterio de orden completo —misma lista de
claves, mismas direcciones— es el mismo `ORDER BY` en
`src/features/catalog/server/queries.ts:392` y en
`src/features/orders/server/quote.ts:154`. Ninguno de los dos puede quedarse
ordenando solo por `createdAt`, y ninguno de los dos puede tener una clave que
el otro no tenga: son dos consultas con `WHERE` distinto (I2), y Postgres no
promete ningún orden para las filas que empatan en todas las claves declaradas.
Un orden parcial haría que C6 dependiera del plan, no del código.

**R5 — el empate exacto lo gana la última llegada, con un desempate final
determinista.** Orden: `sourceUpdatedAt DESC`, luego `createdAt DESC` («la
última que llegó», contrato § ②), luego `id DESC` como último recurso. El
tercero no es decorativo: `createdAt` es `TIMESTAMP(3)` con
`CURRENT_TIMESTAMP` (`prisma/migrations/20260825000000_init/migration.sql:188`),
así que dos inserciones en el mismo milisegundo empatan también ahí y sin
tercera clave el resultado sería el que quisiera el plan —distinto entre los dos
lectores, que es justo lo que C6 prohíbe— (I1). Comprobable en unidad con dos
filas de `createdAt` idéntico: los dos lectores devuelven la misma.

**R6 — la migración RELLENA la marca con `createdAt`, y esto es lo más fácil de
equivocar de todo el feature.** Postgres pone los `NULL` **primero** en un
`ORDER BY … DESC`, así que una fila vieja sin marca ganaría **para siempre** y el
arreglo produciría exactamente el fallo que viene a arreglar. La migración
ejecuta, en este orden y en la misma migración:

```sql
ALTER TABLE "ExchangeRate" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
UPDATE "ExchangeRate" SET "sourceUpdatedAt" = "createdAt" WHERE "sourceUpdatedAt" IS NULL;
ALTER TABLE "ExchangeRate" ALTER COLUMN "sourceUpdatedAt" SET NOT NULL;
```

Se mide con dos consultas, después de migrar:
`SELECT count(*) FROM "ExchangeRate" WHERE "sourceUpdatedAt" IS NULL` → `0`, y
`SELECT count(*) FROM "ExchangeRate" WHERE "sourceUpdatedAt" <> "createdAt"` →
`0` **para las filas anteriores a la migración**. Lo que **no** vale:
`ADD COLUMN … NOT NULL DEFAULT now()`, que rellena con la hora de la migración y
no con la de la fila, y falla la segunda medición.

**R7 — la columna acaba `NOT NULL` y sin `@default`.** Es una decisión, no un
descuido, y esto es lo que compra cada opción:

| Opción                                  | Qué compra                                                                                                                                               | Qué cuesta                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`NOT NULL` + relleno (elegida)**      | La trampa **deja de existir**: no hay `NULL` que pueda ganar, hoy ni en la consulta que alguien escriba dentro de un año, y el compilador exige la marca | Hay que tocar `prisma/seed.ts:341` (I4), y en la base compartida hace fallar —ruidosamente— al worktree que aún no tiene este código (SP1)                      |
| Nullable + relleno                      | No obliga a tocar el seed ni ningún otro escritor                                                                                                        | La trampa sigue viva para el **siguiente** escritor: un `INSERT` que omita la columna vuelve a poner un `NULL` que gana, en silencio                            |
| Nullable + `NULLS LAST` en los lectores | Nada que las otras dos no den                                                                                                                            | Deja la trampa viva para la siguiente consulta que alguien escriba sin acordarse de la cláusula. Es la variante que `.agent/solicitudes.md` § S-005 ya descartó |
| `NOT NULL` con `@default(now())`        | El seed no se toca                                                                                                                                       | Un escritor que la olvide obtiene una marca **falsa** (la hora de la escritura) que gana. Es la misma trampa, disfrazada de sensata                             |

Las otras tres marcas del repo son nullable (`prisma/schema.prisma:295`, `:356`)
o `NOT NULL` (`:453`) por un motivo que aquí no aplica: allí no había con qué
rellenar. Aquí sí: `createdAt` es, para una tabla append-only, exactamente
«cuándo entró esta tasa».

**R8 — ningún lector usa `NULLS LAST`.** Con R7 no hace falta, y como mecanismo
único es la variante descartada. Comprobable: la cadena `NULLS` no aparece en
ninguno de los dos lectores.

**R9 — hay un índice que sirve el orden nuevo, y el `EXPLAIN` lo nombra.** Un
índice cuya columna inicial es `businessId` y que contiene `sourceUpdatedAt`
—`ExchangeRate_businessId_currencyCode_sourceUpdatedAt_idx` si se sigue la
convención de nombres de Prisma—. El de hoy,
`@@index([businessId, currencyCode, createdAt])` (`prisma/schema.prisma:534`),
deja de servir el criterio de orden; retirarlo o conservarlo es del arquitecto
(§ No decidido, punto 2) y, a diferencia de los cinco índices de la ficha
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`, ese sí
lo administra Prisma: su `DROP INDEX` sería una migración legítima.

**R10 — no hay cambio de cable.** `exchangeRatePayloadSchema`
(`src/features/sync/schemas.ts:120`) no cambia ni un campo; el `payload` de
`EXCHANGE_RATE` del contrato ya dice «v11: decide cuál es la vigente». Lo único
que cambia es que ese dato **deja de tirarse**. Comprobable:
`git diff` de `src/features/sync/schemas.ts` vacío al cerrar.

**R11 — la guarda de `CUP` sigue siendo lo primero.** El `return SKIPPED` de
`misc.ts:204` va antes del `upsert` de `Currency` y del `create` de
`ExchangeRate`, y sigue ahí (E9).

**R12 — `CURRENCY` no cambia.** Ni marca, ni orden, ni respuesta. Su asimetría
sigue publicada (contrato § `payload` de `CURRENCY` ③) y quitarla sería otra
versión.

**R13 — la idempotencia se conserva.** Dos entregas del mismo `eventId` siguen
dando una sola fila (`duplicate` en `processBatch.ts:47`), y aplicar el mismo
lote dos veces deja la misma vigente. Es la propiedad que AGENTS.md § Cosas que
muerden exige a todo lo que el sync escribe.

**R14 — el append-only queda intacto.** Ninguna ruta nueva borra ni actualiza
filas de `ExchangeRate`. Comprobable por grep: las únicas escrituras siguen
siendo el `create` de `misc.ts:212` y el del seed.

**R15 — `prisma/seed.ts` suministra la marca y sigue siendo idempotente.** Su
guarda `findFirst` (`prisma/seed.ts:337-339`) ya evita duplicar; lo que se añade
es un `sourceUpdatedAt` explícito y **determinista** (un literal, no `new
Date()`), para que dos corridas del seed sobre bases distintas produzcan la misma
fixture y ningún test dependa de la hora de la siembra. Comprobable: `npm run
seed` dos veces seguidas sale 0 y no crea filas nuevas — es lo que ya comprueba
el CI.

**R16 — la migración generada se revisa a mano antes de aplicarla.** Se le
quitan los `DROP INDEX` de los cinco índices GIN y parciales que
`prisma/schema.prisma` no representa (AGENTS.md § Cosas que muerden, ficha
`.agent/playbook/prisma-migrate-dev-borra-indices-gin-no-declarados.md`):
`CanonicalProduct_searchVector_idx`, `CanonicalProduct_name_trgm_idx`,
`StoreProduct_visible_catalog_idx`, `StoreProduct_searchVector_idx` y
`StoreProduct_searchDocument_trgm_idx`. Aplicarlos sin mirar no rompe ningún
test: solo deja la búsqueda haciendo scans secuenciales en producción.
Comprobable **después** de aplicar:
`SELECT count(*) FROM pg_indexes WHERE indexname IN (…los cinco…)` → `5`.

**R17 — el contrato no se mueve.** Criterio 8. Solo se mueve la versión si al
implementar se descubre que lo escrito **no es implementable**, y entonces se
dice qué cambió; y esa decisión **sube al humano**, no la toma el implementador.
Comprobable: `git diff --stat main -- docs/sync-contract.md` vacío al cerrar.

**R18 — ningún comando prohibido.** `prisma migrate reset` y `prisma db push` no
se usan (AGENTS.md § Comandos prohibidos). Si una migración parece necesitarlos,
**se pregunta**. El rodeo legítimo cuando `migrate dev` ofrece resetear por
checksum drift de otro worktree está fichado:
`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`
(`migrate diff` → carpeta a mano → `migrate deploy`).

## Casos límite y errores

| Caso                                                 | Qué tiene que pasar                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dos eventos de `updatedAt` idéntico, tasas distintas | Gana el de `createdAt` mayor; si también empata, el de `id` mayor. Determinista y **el mismo** en los dos lectores (E4, R5, I1)                                                                                  |
| `updatedAt` en el futuro                             | Gana, y sigue ganando hasta que llegue una marca mayor. El evento legítimo posterior responde `processed` y no gana. Declarado, no recortado (E12)                                                               |
| Una moneda con una sola fila                         | Esa es la vigente, con marca rellenada o con marca del payload. No hay comparación contra `now()` (E10)                                                                                                          |
| Negocio sin ninguna fila de tasas                    | `{}` en los dos lectores; vitrina sin importe para lo que esté en otra moneda, `orderable: false` / `NO_PRICE` en la cotización. Sin cambio respecto de hoy (E11)                                                |
| `CUP`                                                | `skipped_not_published` antes de cualquier escritura: ni fila, ni marca, ni `Currency` (E9)                                                                                                                      |
| Fila anterior a la migración                         | Marca rellenada con su `createdAt`; **no** gana a una fila nueva. Cero `NULL` en la tabla después de migrar (E5, R6)                                                                                             |
| Evento duplicado (mismo `eventId`)                   | `duplicate`, sin handler, sin segunda fila (E15)                                                                                                                                                                 |
| Los dos eventos en el mismo lote                     | Los dos `processed`, dos filas, una sola invalidación al final del lote y la vigente es la del `updatedAt` mayor (E8)                                                                                            |
| Dos monedas del mismo negocio                        | El rancio de una no mueve la otra: el par es `(negocio, moneda)` (E13)                                                                                                                                           |
| Dos negocios con la misma moneda                     | Aislados por `businessId`; el lote mezclado es imposible (`403 BUSINESS_MISMATCH`) (E14)                                                                                                                         |
| Moneda que nunca se declaró                          | Sin cambio: `handleExchangeRate` crea la fila provisional de `Currency` con `name`/`symbol` iguales al código (`misc.ts:206-210`) y la tasa entra como cualquier otra                                            |
| Un `EXCHANGE_RATE` que falla (base caída a mitad)    | El `catch` de `processBatch.ts:91` lo reporta en `failed[]`. Un evento fallido **no** es un duplicado (AGENTS.md § Cosas que muerden) y este feature no lo convierte en uno: no hay camino nuevo que lo silencie |
| Tasa `rate: 0` o negativa                            | Imposible por el schema (`z.number().positive()`, `schemas.ts:124`) y, si llegara, `convert()` lanza `Non-positive rate` (`src/lib/money.ts:151`). Sin cambio                                                    |
| La tabla vacía al hacer el `EXPLAIN`                 | Con pocas filas Postgres elige `Seq Scan` **por coste** y tiene razón. C7 no se puede verificar sin volumen: ver C7 y la ficha `.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`               |

## Datos y contrato

El `payload` no cambia. Lo que cambia es de nuestro lado:

| Pieza                                                     | Hoy                                                     | Después                                                         |
| --------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `prisma/schema.prisma:524-535` (`model ExchangeRate`)     | `id`, `businessId`, `currencyCode`, `rate`, `createdAt` | + `sourceUpdatedAt DateTime` (`NOT NULL`, sin `@default`)       |
| `prisma/schema.prisma:534` (índice)                       | `@@index([businessId, currencyCode, createdAt])`        | un índice que contiene `sourceUpdatedAt` (R9)                   |
| `src/features/sync/server/handlers/misc.ts:212`           | `create` con `businessId`, `currencyCode`, `rate`       | + `sourceUpdatedAt: new Date(payload.updatedAt)`                |
| `src/features/catalog/server/queries.ts:392`              | `orderBy: { createdAt: "desc" }`                        | el orden total de R4/R5                                         |
| `src/features/orders/server/quote.ts:154`                 | `orderBy: { createdAt: "desc" }`                        | **el mismo** orden total, carácter por carácter                 |
| `src/features/catalog/server/queries.ts:396` (comentario) | «the first row per currency is the current rate»        | deja de ser cierto tal cual; se corrige en el mismo commit (I6) |
| `prisma/seed.ts:341`                                      | `create` sin marca                                      | marca explícita y determinista (R15)                            |

Unidades y precisión: `rate` sigue siendo `Decimal(18,6)`, CUP por 1 unidad, y
CUP nunca tiene fila. `sourceUpdatedAt` es un instante UTC con precisión de
milisegundo (`TIMESTAMP(3)`), que es la del ISO-8601 que valida `isoDate`.

## Criterios de aceptación propuestos

Los nueve son los de `.agent/features.json`, sin tocar ni una palabra (regla 3).
Aquí van con **qué se envía, qué se observa y con qué se mide**.

**C1 `[ya]`** — «Con dos EXCHANGE_RATE de la misma moneda y negocio, aplicar
primero el de updatedAt MAYOR y despues el de updatedAt menor deja como vigente
el de updatedAt mayor, verificado leyendo el catalogo publico Y cotizando en el
checkout despues del segundo evento.»
Con la app levantada, en un smoke .agent/specs/F-036/smoke.sh (por crear)
calcado de `.agent/specs/F-035/smoke.sh` (que ya trae `sync_catalog`, `quote`,
`price_of`, `psql_val`, `sync_token` y `now`). Guion: (1) `POST` un
`EXCHANGE_RATE` de una moneda sintética **propia de este feature** con
`rate: 480` y `updatedAt: T2`; (2) `POST` un `PRODUCT` sintético en
`seed-tienda-1` con esa moneda y `price: 1`, de modo que el importe convertido
**sea** la tasa; (3) `GET /tienda-demo` para calentar y afirmar `$480.00`;
(4) `POST` el `EXCHANGE_RATE` de `rate: 440` con `updatedAt: T1 < T2`;
(5) `GET /tienda-demo` y afirmar que **sigue** `$480.00`; (6) `POST
/api/orders/quote` y afirmar `unitPrice` `480.00`.
El paso 5 es el que prueba el feature y solo prueba algo porque F-035 existe: el
evento rancio **sí** invalida, así que la página se rehace y podría haber
mostrado 440.
**Dos trampas que van al plan.** La primera, heredada de F-035: no se mueve la
tasa de `USD` ni de `MLC` — el seed solo inserta una fila si esa moneda no tiene
ya una (`prisma/seed.ts:337`), así que un `npm run seed` posterior no restaura
los 440, y `Cerveza Cristal` (1.20 USD → 528 CUP) es fixture de lectura de otros
features. La segunda es nueva y es de este feature: la moneda sintética tampoco
puede ser `QAB` (la usa `.agent/specs/F-035/smoke.sh`) ni `ZZZ` (la reserva
`.agent/specs/F-027/smoke.sh` para su caso «sin tasa»), y **ningún** evento de
este guion puede dejar en una moneda compartida una marca en el futuro: con el
orden nuevo, una marca de 2099 en `QAB` dejaría el smoke de F-035 fallando para
siempre, porque sus tasas `now()` ya no ganarían nunca.

**C2 `[ya]`** — «En ese escenario el evento rancio responde processed y viaja en
ok, nunca en failed: no gasta ningun reintento del outbox del POS.»
Del cuerpo del `POST` del paso 4 de C1: `results[0].status === "processed"`,
`ok` contiene su `eventId`, `failed` es `[]`. En unidad, el `HandlerOutcome` de
`handleExchangeRate` con un payload rancio es `PROCESSED` y nunca `STALE` —
comprobable con `prisma` mockeado, sin base. Y en la base, la fila de
`SyncEvent` de ese `eventId` queda en el estado de `markProcessed`.

**C3 `[ya]`** — «Las dos filas siguen en ExchangeRate despues del escenario 1:
el historico no pierde ninguna, y sigue sin haber forma de borrar una.»
`psql_val "SELECT count(*) FROM \"ExchangeRate\" WHERE \"currencyCode\"='<la
sintética>'"` → `2` al final del escenario (antes de la limpieza del guion), con
las dos tasas presentes:
`SELECT rate, "sourceUpdatedAt" FROM … ORDER BY "sourceUpdatedAt"`. La segunda
mitad («sigue sin haber forma de borrar una») se mide con un grep que no
encuentra ningún `exchangeRate.delete`/`deleteMany`/`update` en `src/`.

**C4 `[ya]`** — «Con dos eventos de updatedAt identico y tasas distintas, gana
el que llego el ultimo.»
Dos `EXCHANGE_RATE` con el **mismo** `updatedAt` literal, `rate: 500` y luego
`rate: 600`. Se observan los dos lectores: 600. En unidad se fija además el
desempate completo de R5, que es lo que hace el resultado determinista y no una
propiedad del plan (I1).

**C5 `[ya]`** — «Una fila sembrada ANTES de la migracion no se convierte en la
vigente por no tener marca de origen: tras migrar, un escenario con una fila
vieja y una nueva devuelve la nueva. Verificado sembrando la fila vieja antes de
migrar, no simulandolo.»
**Esto no es un test de la suite y no puede serlo** (I3): exige un estado del
esquema —sin la columna— al que no se vuelve, y `npm test` corre siempre contra
un esquema ya migrado. Es un **guion con orden**, de una sola pasada, cuya
salida se pega en `tests.md`:

- **Paso 0 — comprobar que la columna todavía no existe** en la base a la que
  apunta `.env`:
  `docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name='ExchangeRate' AND column_name='sourceUpdatedAt'"`
  → `0`. Si ya dice `1`, otra sesión migró esa base y el paso 1 **ya no se
  puede hacer ahí**: se va a la variante repetible de abajo.
- **Paso 1 — sembrar la fila vieja, por SQL, ANTES de migrar.** Una moneda
  sintética propia de la corrida (nunca CUP/USD/MLC, nunca `QAB`, nunca `ZZZ`),
  con `createdAt` explícito y viejo: un `INSERT` en `Currency` con
  `ON CONFLICT DO NOTHING` y un `INSERT` en `ExchangeRate` con
  `gen_random_uuid()`, el `id` del negocio del seed y
  `'2026-01-01T00:00:00Z'`.
- **Paso 2 — aplicar la migración**, con la revisión de R16 y, si aparece
  checksum drift de otro worktree, el rodeo de la ficha
  `.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md`. Nunca
  `migrate reset` ni `db push` (R18).
- **Paso 3 — verificar el relleno, no simularlo**: comprobar que
  `sourceUpdatedAt` de la fila sembrada es igual a su `createdAt`, y las dos
  consultas de R6 (`IS NULL` → 0; `<> "createdAt"` → 0).
- **Paso 4 — el escenario**: un `EXCHANGE_RATE` de esa moneda con `rate: 222` y
  `updatedAt` de hoy; los dos lectores dan 222. Y después uno con `rate: 333` y
  `updatedAt` **anterior** a enero: los dos lectores **siguen** dando 222. Si el
  relleno hubiera faltado, la fila vieja (111) sería la vigente desde el paso 2 y
  este paso daría 111 — y con `NULLS LAST` en vez de relleno daría 222
  igualmente, que es por qué el paso 3 se mide aparte.
- **Paso 5 — limpieza**: borrar las filas de la moneda sintética y su fila de
  `Currency`, y después forzar un evento de sync inocuo, porque un `DELETE` por
  SQL no dispara `revalidateTag` y la vitrina seguiría sirviendo el HTML con la
  moneda sintética hasta los 3600 s (la trampa que `.agent/specs/F-035/smoke.sh`
  ya documenta al final).

**La base de desarrollo es un Postgres compartido por todos los worktrees**
(`docker-compose.yml` fija `container_name`, ficha
`.agent/playbook/docker-compose-container-name-fijo-choca-entre-worktrees.md`), y
ahora mismo tiene 23 filas de `ExchangeRate` de dos negocios, 19 de ellas
basura de `QAB` que dejaron varias corridas del smoke de F-035 (I5). Con eso:

- **Se puede**: `INSERT`/`DELETE` de filas de una moneda sintética propia;
  aplicar la migración, que es **aditiva** (`ADD COLUMN`, `UPDATE`,
  `SET NOT NULL`, `CREATE INDEX`) y no le quita a ningún worktree ninguna
  columna que estuviera leyendo; y crear una base de usar y tirar en el **mismo**
  contenedor.
- **No se puede, y si parece necesario se pregunta**: `prisma migrate reset`,
  `prisma db push` (AGENTS.md § Comandos prohibidos), `TRUNCATE`/`DELETE` de
  `ExchangeRate` entero —hay filas de otras sesiones y de otros features— y
  `docker compose down -v`, que se lleva el volumen de todos.
- **Y hay que decir en voz alta lo que sí le rompe la sesión a otro**: con la
  columna `NOT NULL`, un worktree cuyo checkout todavía no tenga este código
  falla su `npm run seed` y sus `*.db.test.ts` que escriban tasas, porque su
  `INSERT` no la rellena. Es un fallo ruidoso y no una corrupción silenciosa —es
  el argumento de R7—, pero es un fallo, y por eso va en SP1. Y aplicar la
  migración deja en `_prisma_migrations` una fila que las otras carpetas
  `prisma/migrations/` no tienen: la próxima vez que cualquiera de ellas corra
  `migrate dev` ahí puede ver drift causado **de verdad** por esto, que es el
  riesgo abierto que la propia ficha manda escalar.

**La variante repetible, y por qué hace falta una**: en la base compartida el
paso 1 existe **una sola vez** —después de migrar no hay forma de volver a
sembrar una fila sin columna—, así que si el guion se equivoca en el paso 4 no
hay segundo intento. La forma de tener las dos cosas es una base de usar y tirar
en el mismo contenedor: `CREATE DATABASE queandabuscando_f036`, `DATABASE_URL` y
`DIRECT_URL` apuntando a ella, `npx prisma migrate deploy` **antes** de crear la
carpeta de la migración nueva (aplica el juego actual y nada más), sembrar la
fila vieja, crear y aplicar la migración, correr los pasos 3 y 4, y
`DROP DATABASE` al terminar. No usa ningún comando prohibido, no toca la base de
nadie y se puede repetir tantas veces como haga falta. Lo que **no** sustituye:
la migración hay que aplicarla también a la base compartida para que la suite
corra, y eso sigue siendo el paso que SP1 pregunta.

Lo que **sí** queda permanente en la suite, y no es lo mismo que el criterio:
la invariante que la migración dejó (`IS NULL` → 0, y la columna `NOT NULL` en
`information_schema`), afirmada en un `*.db.test.ts`, para que una migración
futura no pueda reintroducir la trampa sin ponerse en rojo.

**C6 `[ya]`** — «Los dos lectores dan la misma respuesta: la tasa que muestra la
vitrina y la que usa el checkout coinciden en todos los escenarios de arriba,
comprobado en la misma corrida.»
Dónde se observa cada uno:

- **La vitrina**: `GET /tienda-demo`, y el precio de la tarjeta del producto
  sintético extraído con el helper `price_of` que
  `.agent/specs/F-035/smoke.sh:97` ya tiene. Pasa por `getStoreRates` →
  `loadRates`, **con** caché de datos y tag `storeTag`
  (`src/features/catalog/server/queries.ts:404-408`). Por eso este criterio
  necesita F-035: sin su invalidación, la comparación mediría la edad de la
  caché y no el criterio de orden.
- **El checkout**: `POST /api/orders/quote` con
  `{"storeSlug":"tienda-demo","items":[{"storeProductId":"…","qty":1}]}`, y
  `lines[].unitPrice` de la respuesta (`src/app/api/orders/quote/route.ts`,
  `toQuoteResponse` en `src/features/orders/server/quote.ts`). Pasa por
  `loadFreshRates`, sin caché.
- **Cómo se comparan**: el producto sintético lleva `price: 1` en la moneda
  sintética, así que el importe convertido **es** la tasa: la vitrina da
  `$480.00` y la cotización `480.00`. La aserción compara **los dos lectores
  entre sí** —`"$" + unitPrice` contra el texto de la tarjeta—, que es lo que el
  criterio pide, y **además** cada uno contra el valor esperado, para que un
  fallo simétrico (los dos mal) no pase por bueno.
- **«En la misma corrida»**: las dos observaciones sin ningún evento de sync
  entre medias, en la misma invocación del guion y contra el mismo `next dev`
  —`verify.sh --smoke` levanta uno y solo uno, y si el puerto lo ocupa otro
  checkout podrías estar verificando contra otra copia del repo sin notarlo
  (ficha `.agent/playbook/next-dev-uno-por-directorio.md`)—.
- **En cuántos escenarios**: los cuatro de arriba (E1, E4, E7 y el paso 4 de
  C5), como un bucle sobre una función `both_readers <esperado>` del guion, no
  cuatro copias del mismo bloque.

**C7 `[ya]`** — «La lectura de tasas no hace seq scan sobre ExchangeRate:
EXPLAIN muestra que usa un indice con el criterio de orden nuevo.»
Se explican **dos** consultas, no una (I2): la de la vitrina, cuyo `WHERE` es un
filtro por relación (`business: { stores: { some: { id: storeId } } }`,
`queries.ts:391`), y la del checkout, cuyo `WHERE` es `businessId` plano
(`quote.ts:153`). Son dos planes distintos y el criterio se cumple o no se
cumple por separado en cada uno.

- **Con qué datos.** Con las 23 filas de hoy, Postgres elige `Seq Scan` **por
  coste y con razón**, así que sin volumen este criterio no mide nada. El
  patrón es el de `src/features/orders/server/pull.db.test.ts:98-142`: sembrar
  filas de relleno de **otro** negocio —que es lo que hace selectivo el
  `businessId`— más unas pocas del propio, `ANALYZE "ExchangeRate"`, y `EXPLAIN`.
  El número exacto **se mide**, no se supone, y se deja escrito en el comentario
  del test con la medición que lo justifica, como hizo
  `src/features/catalog/server/search.db.test.ts:415-423`.
- **Qué se busca en la salida.** `EXPLAIN (FORMAT JSON)` y un recorrido del
  árbol buscando un nodo `"Node Type": "Seq Scan"` cuyo `"Relation Name"` sea
  `ExchangeRate` —**no** un `toContain("Seq Scan")` sobre el texto: en el plan
  de la vitrina un `Seq Scan` sobre `Business` (2 filas) o `Store` (una decena)
  es legítimo y no es lo que este criterio prohíbe—. El caminador ya existe
  como precedente: `hasSeqScanOnStoreProduct` en
  `src/features/catalog/server/search.db.test.ts:471-485`. Y una segunda
  aserción, que es la mitad literal del criterio: el texto del plan **nombra**
  un índice cuya definición contiene `sourceUpdatedAt`, comprobado antes con
  `SELECT indexdef FROM pg_indexes WHERE tablename='ExchangeRate'`.
- **De qué SQL exactamente.** Los dos lectores son `findMany` de Prisma, no SQL
  a mano, así que hay dos formas y las dos son aceptables: (a) capturar la
  sentencia real con un `PrismaClient` construido con
  `log: [{ level: "query", emit: "event" }]` y `$on("query")` —`QueryEvent` trae
  `query` y `params` (`src/generated/prisma/internal/prismaNamespace.ts:3078`)—
  y explicar **eso**, que es lo fiel; o (b) copiar la sentencia a mano en el
  test, como hace `pull.db.test.ts:134`, **más** una aserción anti-deriva: que
  la copia devuelve exactamente las mismas filas que el lector para la misma
  entrada. Sin (b) la copia se despega del código sin que nada avise. Si (a) no
  emite nada bajo el driver adapter, se va a (b): es una comprobación de cinco
  minutos al implementar y no cambia el criterio.
- **Y un aviso de ruido.** Este tipo de test es sensible al orden de la suite
  (`fileParallelism: false` en el proyecto `db`, `vitest.config.mts`): un
  `ANALYZE` sobre una tabla con tuplas muertas que dejó otro archivo puede
  volcar el plan a `Seq Scan` por coste. Ficha
  `.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`; su
  remedio —`VACUUM ANALYZE` en vez de `ANALYZE`— se aplica **desde el
  principio** aquí, que es una línea y ahorra un diagnóstico equivocado.
  `SET enable_seqscan = off` es admisible solo como cinturón además de las
  filas de relleno, con el motivo escrito, y sabiendo lo que compra: prueba que
  el índice **puede** servir el orden, no que el plan lo prefiera.

**C8 `[ya]`** — «La regla ya esta escrita en docs/sync-contract.md v11 (seccion
'Cambios respecto a la v10.1' ②): este feature NO vuelve a mover la version
salvo que al implementarlo se descubra que lo escrito no es implementable.»
`git diff --stat main -- docs/sync-contract.md` vacío al cerrar el feature. Si
no lo está, es que se descubrió algo no implementable: entonces **sube al
humano**, y solo con su decisión se mueve la versión de la primera línea y se
escribe qué cambió (R17). El hook `.claude/hooks/sync-contract-version.sh` avisa
si el fichero cambia sin que la versión se mueva; el hook no sustituye la
pregunta.

**C9 `[ya]`** — «bash .agent/verify.sh F-036 --full termina con codigo 0.»
Tal cual. Tres recordatorios para no perder un ciclo: `--full` incluye la etapa
`harness`, que falla si se cita entre comillas invertidas un archivo que todavía
no existe **y también** si se cita abreviada la ruta de uno que sí existe
(AGENTS.md § Cosas que muerden); la etapa `prisma` es solo
`npx prisma validate`, así que **el sensor no comprueba la migración** —eso lo
comprueba el CI con `migrate deploy` y el seed doble, y de este lado C5—; y
`npm test` incluye el proyecto `db`, que necesita el Postgres de
`docker-compose.yml` levantado y **ya migrado**.

## Incongruencias detectadas

**I1 — el criterio 4 no es decidible con la precisión que tiene `createdAt`.**
«Gana el que llegó el último» necesita saber quién llegó último, y lo único que
lo dice es `createdAt`, que es `TIMESTAMP(3)` con `CURRENT_TIMESTAMP`
(`prisma/migrations/20260825000000_init/migration.sql:188`): dos inserciones en
el mismo milisegundo empatan. En los datos reales de la base de desarrollo las
inserciones consecutivas de un lote van a 400-700 ms una de otra (las 19 filas
de `QAB` del smoke de F-035), así que el empate de milisegundo **no se ha
observado nunca**, pero nada lo impide. No se resuelve tocando el criterio
(regla 3): R5 lo cierra con un desempate final por `id`, que hace el resultado
**determinista** —y por tanto igual en los dos lectores, que es lo que C6
exige— aunque en ese empate improbable «determinista» no signifique «el último
de verdad». Si alguna vez hace falta la letra exacta, hace falta una columna
monótona: SP2.

**I2 — el criterio 7 dice «la lectura de tasas», en singular, y hay dos, con
`WHERE` distinto.** La vitrina filtra por relación (`queries.ts:391`) y el
checkout por `businessId` plano (`quote.ts:153`). Son dos sentencias, dos planes
y dos `EXPLAIN`; y en el de la vitrina un `Seq Scan` sobre `Business` o `Store`
es legítimo, así que la aserción tiene que estar **acotada al nodo cuyo
`Relation Name` es `ExchangeRate`**. No es un error del criterio —bien leído,
prohíbe el `Seq Scan` sobre `ExchangeRate`, que es exactamente lo que hay que
prohibir— pero se cumple dos veces, no una.

**I3 — el criterio 5 no puede vivir en la suite, y eso no es un defecto suyo.**
Pide sembrar la fila «ANTES de migrar… no simulandolo», y ese estado del esquema
no vuelve: `npm test` corre siempre contra un esquema ya migrado, y con la
columna `NOT NULL` ni siquiera se puede insertar una fila sin marca. Se verifica
con el guion ordenado de C5, de una sola pasada, y su salida es la prueba; lo
permanente en la suite es la invariante que la migración deja, no el escenario
que la produjo.

**I4 — `prisma/seed.ts:341` inserta `ExchangeRate` sin marca de origen.** Con la
columna `NOT NULL` eso deja de compilar (`npm run typecheck`) y de correr (el
seed doble del CI), así que el seed entra en el alcance de este feature aunque
las `notes` de `.agent/features.json` no lo mencionen. No contradice nada: es
alcance que la nota no nombra, y por eso está escrito aquí (R15).

**I5 — la base de desarrollo no está en el estado que uno supone.** Tiene 23
filas de `ExchangeRate` de **dos** negocios: las dos del seed
(`USD 440`, `MLC 210.5` de `seed-negocio-1`), 19 de `QAB` que dejaron varias
corridas del smoke de F-035, y dos de un negocio que no es ninguno de los del
seed (`EUR 24.123457`, `USD 400`), probablemente de una fixture de `*.db.test.ts`
que no se limpió. Ninguna estorba —la migración las rellena igual— pero conviene
saberlo antes de leer un `count(*)` o un `EXPLAIN`, y antes de escribir el
`updatedAt` de un evento de smoke sobre `QAB`: con el orden nuevo, dejar ahí una
marca en el futuro rompería el smoke de F-035 para siempre.

**I6 — el comentario que documenta el mecanismo va a dejar de ser cierto.**
`src/features/catalog/server/queries.ts:396` dice «Append-only table: the first
row per currency is the current rate», que después de este feature es cierto
solo si se dice **con qué orden**; y el JSDoc de `loadFreshRates`
(`src/features/orders/server/quote.ts:150`) dice «the latest rate per currency»,
donde «latest» pasa a significar otra cosa. Los dos se corrigen en el mismo
commit: son los dos únicos sitios donde este mecanismo está documentado en el
código.

**I7 — AGENTS.md describe la guarda anti-rancia con un mecanismo que aquí no es
el que se usa.** § Cosas que muerden dice que todo lo que el sync escribe «va
guardado contra escrituras rancias (`sourceUpdatedAt`)» y que «gracias a eso el
orden de entrega no importa». La promesa se cumple después de F-036 —el orden de
entrega deja de importar—, pero el mecanismo no es el mismo: en `STORE`,
`CATEGORY` y `PRODUCT` la guarda **rechaza** la escritura y devuelve `STALE`
(`misc.ts:125-128`, `product.ts:92-93`); aquí se **escribe siempre** y se ordena
distinto al leer. Quien añada un handler copiando esta forma esperando un
`STALE` se equivocará. Propongo añadir a esa sección una frase del estilo «hay
dos formas de la guarda: la que rechaza (`STORE`, `CATEGORY`, `PRODUCT`) y la de
orden de `EXCHANGE_RATE`, que escribe igual y decide al leer porque su tabla es
append-only». No la escribo yo: AGENTS.md no es mi frontera, y va en el mismo
commit que el código o no se escribe nunca.

## Huecos y preguntas al humano

**SP1 — ¿quién aplica la migración a la base de desarrollo compartida, y con qué
aviso a los demás worktrees?**
Qué falta: una decisión operativa, no de producto. **No bloquea** ni la
arquitectura ni el diseño; bloquea el paso de la migración del implementador.
Por qué importa: la columna `NOT NULL` hace fallar el `npm run seed` y los
`*.db.test.ts` de cualquier worktree cuyo checkout no tenga aún este código, y
aplicar la migración deja `_prisma_migrations` con una fila que sus carpetas
`prisma/migrations/` no tienen —el riesgo abierto que la ficha
`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md` manda
escalar y no resolver en silencio—. Opciones: (a) el guion de C5 se hace en una
base de usar y tirar del mismo contenedor y la migración se aplica a la
compartida una sola vez, anunciándolo, cuando la rama esté lista; (b) se aplica
ya a la compartida y se asume que los worktrees hermanos actualicen su checkout;
(c) una base de desarrollo por worktree, que es la solución de fondo y una
decisión de infraestructura. **Recomendación: (a)**, y (c) como conversación
aparte: (a) hace C5 repetible, que es lo que la compartida no permite, y deja el
único momento disruptivo bajo control.

**SP2 — ¿hace falta una clave monótona para que el criterio 4 sea literal?**
Qué falta: decidir si el empate de milisegundo merece una columna. **No
bloquea**: R5 lo cierra de forma determinista y el caso no se ha observado nunca
en la base real. Opciones: (a) nada más que R5 —`sourceUpdatedAt DESC,
createdAt DESC, id DESC`—; (b) una columna `seq BigInt @default(autoincrement())`
en `ExchangeRate`, que da «el último que llegó» exacto siempre, a cambio de una
columna y un índice más en una tabla que ya crece sin borrarse nunca; (c) subir
`createdAt` a `TIMESTAMP(6)`, que hace el empate prácticamente imposible pero
reescribe la tabla y no lo elimina. **Recomendación: (a)**, y (b) solo si algún
día una corrida observa el empate — cosa que la prueba de C4 puede afirmar en
negativo (`createdAt` distintos) para que se sepa cuándo deja de ser cierto.

No hay ninguna otra pregunta abierta: todo lo demás se resolvió leyendo el
código y está citado con su ruta. Las dos de arriba están escritas como
**no bloqueantes a propósito** —la primera se responde antes del paso de la
migración, la segunda puede no responderse nunca— y por eso este documento
cierra en `estado: listo`, con el mismo criterio que
`.agent/specs/F-035/spec.md`.

## No decidido a propósito

1. **La lista exacta de claves del `ORDER BY` y si el índice declara
   `sort: Desc`.** Es de `sdd-architect`. R4 y R5 fijan lo que no se negocia
   (orden total, idéntico en los dos lectores, `sourceUpdatedAt` primero y el
   empate a la última llegada). Lo que queda abierto: si `currencyCode` va
   **antes** de `sourceUpdatedAt` —lo que permite que el índice sirva el orden
   sin un nodo `Sort`, si su tercera columna se declara descendente— o si se
   deja el orden global y se acepta el `Sort`. Las dos satisfacen el bucle que
   toma la primera fila de cada moneda; solo una evita el `Sort`.
2. **Si el índice viejo `(businessId, currencyCode, createdAt)` se retira.**
   También del arquitecto. Retirarlo es legítimo (Prisma lo administra, R9) y
   deja una tabla de escritura pura con un solo índice; conservarlo cuesta una
   escritura por fila y no sirve a ningún lector. Lo que **no** puede pasar es
   que la migración se lleve por delante los cinco índices de R16.
3. **Si los lectores pasan a `DISTINCT ON (currencyCode)`** en vez de traer
   todas las filas del negocio y quedarse con la primera de cada moneda en JS.
   Es del arquitecto: cambia el volumen que viaja (hoy, 19 filas de `QAB` para
   devolver una) y cambia el `EXPLAIN` de C7, pero no cambia ningún
   comportamiento de esta spec.
4. **Si `BranchResolution` gana un `businessId`** para que la consulta de la
   vitrina sea la misma que la del checkout en vez de un filtro por relación
   (I2). Lo unifica y simplifica C7; toca `src/features/storefront/server/resolve.ts`,
   que este feature no necesita tocar para nada más. Del arquitecto.
5. **Si la variante de orden merece una ADR.** AGENTS.md § Documentación pide
   una por decisión estructural nueva, y esta lo es —una tabla append-only cuya
   verdad la decide el criterio de lectura y no la última escritura—; pero está
   ya argumentada y firmada en `.agent/solicitudes.md` § S-005 y publicada en el
   contrato. Recomendación para quien decida: si se escribe, que sea corta y
   apunte a esas dos, no que las repita.
6. **El andamio de las pruebas de C5 y C7** —qué se mockea, qué se siembra, qué
   helper nuevo hace falta en `src/features/marketplace/server/dbFixtures.ts`
   para las filas de relleno de tasas—. Es de `sdd-tester`. Lo que esta spec
   exige es el comportamiento y el punto de observación, no el andamio.
