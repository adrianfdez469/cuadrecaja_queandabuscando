---
propuesta: store-escribe-el-negocio-antes-de-las-guardas
agente: sdd-spec
actualizado: 2026-09-10T03:34:09Z
estado: propuesta
---

> **Feature correctivo propuesto para I4.** Sale de
> `.agent/specs/F-043/spec.md` § I4 y de `.agent/specs/F-043/architecture.md`
> § AD4, donde el defecto quedó analizado y donde el humano respondió AP1=(a)
> el 2026-09-09: F-043 solo corregía la **promesa**, y el arreglo del **código**
> quedaba para «un feature correctivo suyo, aparte, cuando quiera». Esto es ese
> feature, todavía sin número. El backlog es del humano (regla 4).

## Problema

Lo **primero** que hace `handleStore`, antes de leer la sucursal y antes de
cualquier guarda, es escribir dos columnas del negocio
(`src/features/sync/server/handlers/store.ts:74-78`):

```ts
await prisma.business.update({
  where: { id: businessId },
  data: { name: payload.businessName, baseCurrencyCode: payload.baseCurrency },
  select: { id: true },
});
```

Nadie usa el resultado. A partir de ahí hay **trece** salidas nombradas —más
cualquier error de base— antes de que se escriba una sola columna de `Store`, y
en todas ellas esas dos columnas del negocio ya quedaron aplicadas: un evento
que el sistema reporta como `stale`, como `skipped_not_published` o como
`failed` **ya escribió**.

Lo grave no es el camino que la spec de F-043 miró —un evento rechazado— sino
el que no miró: **el rancio**. La guarda anti-rancio de `:116-121` existe
justamente para que un evento viejo reentregado no pise datos nuevos, y esas
dos columnas se la saltan por estar escritas tres líneas antes.

## Lo que de verdad pasa, medido

Cuatro mediciones contra el Postgres real de este worktree (`localhost:5433`,
el contenedor `queandabuscando-postgres` ya levantado), por la **ruta HTTP
real** (`src/app/api/internal/sync/catalog/route.ts`) con el arnés que
`src/features/sync/server/handlers/business.db.test.ts` ya usa
(`createFixtureSession`, `next/cache` stubeado por la ficha
`.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`).
Nada de esto se commiteó: se ejecutó desde un archivo de usar y tirar fuera del
repositorio, y los números de abajo son su salida literal.

**M1 — un evento RANCIO responde `stale` dentro de `ok` y aun así pisa las dos
columnas con los valores VIEJOS.** Es el peor de los cuatro: aquí los valores
escritos no son «los correctos aplicados antes de tiempo», son datos
retrocedidos.

```
M1 antes:    {"name":"Nombre NUEVO","baseCurrencyCode":"USD"}
M1 respuesta: 207 [{"status":"stale"}]  ok=["…-m1"]
M1 despues:  {"name":"Nombre VIEJO","baseCurrencyCode":"CUP"}
M1 fila Store: {"sourceUpdatedAt":"2026-02-01T00:00:00.000Z"}   ← intacta
```

**M2 — un evento RECHAZADO ENTERO que además omite `baseCurrency` deja la
moneda base en `CUP`.** El evento falla con `STORE_OPENING_HOURS_INVALID`, la
fila `Store` no se toca (`sourceUpdatedAt` sigue `null`, `openingHours` sigue
`null`)… y el negocio pasa de `USD` a `CUP`:

```
M2 antes:    {"name":"Nombre bueno","baseCurrencyCode":"USD"}
M2 respuesta: 207 [{"status":"failed","error":"STORE_OPENING_HOURS_INVALID"}]
M2 despues:  {"name":"Nombre de un evento rechazado","baseCurrencyCode":"CUP"}
```

El `CUP` no viene del payload: viene del `.default("CUP")` de
`src/features/sync/schemas.ts:42`. Es un defecto **distinto** de I4 (le pasa
igual a un evento que se aplica) pero I4 es lo que lo hace alcanzable desde un
evento que el sistema dijo rechazar. Ver SP5.

**M3 — un `skipped_not_published` también escribe.** Un `STORE` que despublica
una sucursal que aquí no existe sale por `return SKIPPED` (`:132`):

```
M3 antes:    {"name":"F-015 fixture …","baseCurrencyCode":"CUP"}
M3 respuesta: 207 [{"status":"skipped_not_published"}]
M3 despues:  {"name":"Nombre desde un SKIPPED","baseCurrencyCode":"USD"}
```

**M4 — `STORE_ZONE_UNKNOWN`, el caso que F-043 dejó anotado**, con una zona
bien formada y ausente del catálogo (`99.99`):

```
M4 respuesta: 207 [{"status":"failed","error":"STORE_ZONE_UNKNOWN"}]
M4 despues:  {"name":"Nombre desde STORE_ZONE_UNKNOWN","baseCurrencyCode":"USD"}
```

Y la prueba que ya vive en el repositorio afirma exactamente esto, en verde
hoy: `src/features/sync/server/handlers/business.db.test.ts:646` («…and
Business.name/baseCurrencyCode land anyway, because handleStore writes them
BEFORE any guard runs»), con los asertos de `:673-676`:

```ts
// I4: already applied — handleStore's very first statement, unguarded.
expect(after.name).toBe("Negocio F-043");
expect(after.baseCurrencyCode).toBe("CUP");
expect(after).not.toEqual(before);
```

Ejecutada al escribir esta propuesta: `npx vitest run --project db
src/features/sync/server/handlers/business.db.test.ts -t "malformed zoneCode
never gets a 400"` → **1 passed**. Ese es el aserto que este feature invierte,
y es la mejor prueba de que el defecto existe.

### Cuánto daño es, columna por columna

Hay que separarlas, porque **no valen lo mismo**:

- **`Business.name` es cosmético hoy: no lo lee nadie.** Buscado en todo
  `src/` fuera del propio handler que lo escribe y de los tests: cero
  lectores. Los tres sitios que consultan `Business` seleccionan otra cosa
  (`src/app/admin/sso/route.ts` solo `id`, `src/features/sync/server/provisioning.ts`
  solo `active`/`syncTokenHash`, y las tres vistas de negocio solo
  `baseCurrencyCode`/`displayCurrencies`). Lo que el comprador ve como marca
  es `Storefront.name`, que sale de `payload.name` (la sucursal), no de
  `payload.businessName`. **Escribirlo de más no se ve en ninguna pantalla.**
- **`Business.baseCurrencyCode` sí lo ve el comprador, y además decide dinero.**
  Es la moneda en la que se pinta el catálogo
  (`src/features/catalog/server/queries.ts:144,183`), la frase «Cobramos en X»
  de `src/app/[slug]/layout.tsx:156`, y —lo que importa— la moneda en la que
  el checkout cotiza el pedido: `src/features/orders/server/quote.ts:132,142`
  la lee y `resolvePrice` **convierte** los importes a ella.

A eso se suma una consecuencia de segundo orden que la spec de F-043 no
recoge: **los caminos que escriben de más son exactamente los que no
revalidan.** Un `stale`/`skipped`/`failed` vuelve sin `touchedStoreSlug`
(`src/features/sync/server/handlers/types.ts:57-59`), así que
`src/features/sync/server/processBatch.ts:133` no invalida nada. La portada de
la tienda es ISR a 3600 s (`src/app/[slug]/layout.tsx:33`) mientras el catálogo
y el checkout son dinámicos (`revalidate = 0`), de modo que tras un cambio de
moneda por esta vía **la portada y el catálogo dicen monedas distintas** hasta
que caduque el piso de una hora o hasta que un evento no relacionado revalide.

### El veredicto, sin inflarlo

**Gravedad media-baja, con una esquina media-alta.** Desglosado:

1. **Media-alta, y es lo único que justifica el feature por sí solo**: la
   guarda anti-rancio se salta para dos columnas (M1). Un evento reentregado
   —y el outbox de cuadrecaja reentrega: seis intentos por fila— retrocede la
   moneda base y lo reporta en `ok`. Silencioso por construcción.
2. **Baja**: los caminos `failed`/`skipped` (M2, M3, M4). Los valores que se
   aplican son, casi siempre, los que el POS afirma **ahora** para su negocio;
   se aplican antes de tiempo, no equivocados. La excepción es el `CUP` por
   defecto de M2, que es de SP5.
3. **Cosmética**: todo lo que le pase a `Business.name`. Cero lectores.
4. **Y una cuenta que no es de corrección**: hoy **todo** `STORE` paga un
   `UPDATE` de más aunque no cambie nada. En este mismo entorno hay 54
   `SyncEvent` de entidad `STORE` de 895 totales; la proporción no es
   despreciable pero el coste tampoco es el argumento.

Si el humano decide que esto va detrás de F-044, es una decisión defendible con
lo de arriba: F-044 protege un importe cobrado, esto protege una moneda que
solo se mueve en un caso concreto. Lo que **no** es defendible es dejarlo sin
escribir, porque el arreglo es barato (ver § Opciones) y porque la v13 todavía
no se publicó: hoy se puede prometer lo fuerte, mañana hay que desdecirse.

## Por qué la escritura está donde está

El comentario de `:71-73` la justifica con «R8/E16», y conviene leer qué dicen
esas dos:

- **R8** (`.agent/specs/F-018/spec.md:312`): «El sync no crea negocios.
  `handleStore` deja de hacer `upsert` de `Business`: solo actualiza el negocio
  autenticado».
- **E16** (`.agent/specs/F-018/spec.md:217-221`): un `STORE` que llega antes de
  que exista ninguna tienda «actualiza `name` y `baseCurrencyCode` del negocio
  ya existente y crea la tienda; **no crea ningún `Business`**».

Ninguna de las dos dice **cuándo** corre la escritura. Las dos hablan de a
**quién** apunta y de que no crea filas. La posición es un residuo histórico, y
se ve en el diff que la dejó así: en el commit fundacional `613b254` esto era
un `prisma.business.upsert` cuyo **resultado** hacía falta más abajo
(`businessId: business.id` al crear la sucursal), así que tenía que ir primero.
El commit `12eacc8` (F-018, paso 3) lo convirtió en un `update` porque el
`businessId` pasó a llegar como parámetro… y lo dejó en el mismo sitio. Desde
entonces **nada de lo que hay debajo depende de esa llamada**: su `select: { id
: true }` es vestigial y su valor de retorno se descarta.

Eso matiza —no contradice— lo que `.agent/specs/F-043/architecture.md:226-228`
dice al descartar la opción (b): «mover una escritura … con tres caminos de
retorno que hoy la dan por hecha». Comprobado leyendo el archivo entero: los
caminos de retorno **ocurren después** de la escritura, pero ninguno la
**necesita**. AD4 acertó al no meterlo en F-043 (era alcance ajeno, sin ninguna
prueba de ese feature que lo cubriera); lo que esta propuesta aporta es que el
acoplamiento real es cero, y con ello el coste de moverla.

La otra contención que AD4 prohíbe —llamar las guardas al principio— **sigue
prohibida y esta propuesta no la toca**: convertiría `SKIPPED` y `STALE` en
`failed[]`, contra E9/E12 de F-041 y contra los comentarios de `:133-136` y
`:256-259`. Aquí no se mueve ninguna guarda: se mueve la escritura hasta
**donde ya están** las guardas.

## Alcance

### Dentro

- Que `Business.name` y `Business.baseCurrencyCode` se escriban **solo** cuando
  el evento `STORE` va a aplicarse, en los tres caminos que escriben:
  despublicación de una sucursal existente (`:140`), alta de sucursal nueva
  (`:226`) y actualización de una existente (`:271`).
- Que **ninguna respuesta HTTP cambie**: mismos códigos, mismos `status`,
  mismos `error`, mismo `ok`/`failed` byte a byte.
- Que R8/E16 de F-018 sigan valiéndose: la escritura sigue apuntando a
  `businessId` (la identidad autenticada), sigue siendo un `update` y sigue sin
  poder crear un `Business`.
- Invertir el aserto de I4 de
  `src/features/sync/server/handlers/business.db.test.ts:673-676` y el
  comentario que lo acompaña (SP3).
- Los dos comentarios que hoy documentan el defecto y dejarán de ser ciertos:
  el de `:71-73` en el handler y la nota de I4 en `src/constants/sync.ts:137-139`.
- Subir `docs/sync-contract.md` y devolverle la promesa fuerte (§ Datos y
  contrato).

### Fuera (explícito)

- **Mover, adelantar o retrasar cualquier guarda.** `assertZoneKnown`,
  `assertDeliveryConsistent`, `assertOpeningHoursValid` y la de `timezone` se
  quedan exactamente donde están, por AD4 y por E9/E12 de F-041.
- **El `.default("CUP")` de `baseCurrency`** (`src/features/sync/schemas.ts:42`).
  Es un defecto real y distinto —omitir la moneda la reinicia a `CUP` también
  en un evento que se aplica— y cambiarlo es una **mayor** del contrato, que
  hoy promete «por defecto CUP si se omite» (`docs/sync-contract.md:2146`). SP5.
- **Una marca anti-rancio propia para el negocio.** Sin una columna nueva
  (migración), dos sucursales del mismo negocio entregadas fuera de orden
  siguen resolviéndose por «gana el último que llegue» — que es la propiedad
  que el propio contrato ya declara asumida en `docs/sync-contract.md:1286`
  («N sucursales repiten la lista y la escribe la que llegue la última»). El
  arreglo de esta propuesta **no** la cambia; solo saca de esa carrera a los
  eventos que ni siquiera se aplican.
- **Envolver `handleStore` en `$transaction`.** Ver § Opciones, opción (d):
  choca de frente con AGENTS.md § Cosas que muerden.
- **Dejar de escribir `Business.name` desde `STORE`** aunque no lo lea nadie.
  Es una decisión de propiedad de campos, no de posición de una escritura, y
  el contrato la tiene documentada en su tabla de propiedad.
- **`handleBusiness`** (`src/features/sync/server/handlers/business.ts`): sigue
  siendo dueño de `displayCurrencies` y sigue sin tocar `name`/
  `baseCurrencyCode` (su R10, `:41-42`).
- **F-044**, la reconciliación del tarifario. Sin relación.

## Actores y precondiciones

Lo dispara el POS de cuadrecaja enviando un evento `STORE` a
`POST /api/internal/sync/catalog` con el token del negocio. Precondición: el
`Business` existe (nace al acuñarle el token, R8) y el lote ya pasó
autenticación y la comprobación de coherencia de `businessId`, que son
anteriores al handler.

Nadie más escribe estas dos columnas: `handleStore` es su único escritor en
todo `src/`, aparte del alta en `src/features/sync/server/provisioning.ts:47`.

## Comportamiento esperado

Numerados desde el estado de hoy; **E1-E6 cambian**, E7-E9 no.

- **E1** — Dado un negocio con `name: "N"` y `baseCurrencyCode: "USD"`, y un
  evento `STORE` cuyo `updatedAt` es **anterior o igual** al `sourceUpdatedAt`
  de su sucursal, cuando se procesa, entonces la respuesta sigue siendo `207`
  con ese evento en `ok` con `status: "stale"` **y** las dos columnas siguen en
  `"N"` / `"USD"`.
- **E2** — Dado un evento `STORE` que falla con `STORE_ZONE_UNKNOWN` (zona
  desconocida o mal formada, las dos causas desde la v13.2), cuando se procesa,
  entonces responde `207` con ese evento en `failed[]` y las dos columnas del
  negocio quedan **idénticas** a como estaban.
- **E3** — Lo mismo que E2 para `STORE_OPENING_HOURS_INVALID`.
- **E4** — Lo mismo que E2 para `STORE_DELIVERY_CONFIG_INCONSISTENT` en su
  forma de `207` (la que solo se ve al mezclar el `payload` con la fila
  guardada; la forma `400` del sobre no llega al handler).
- **E5** — Lo mismo que E2 para `STORE_TIMEZONE_INVALID`, en el camino de
  republicación (`:268-270`).
- **E6** — Dado un evento `STORE` cuya sucursal pertenece a **otro** negocio
  (colisión de `externalId`, `:112`) o que despublica una sucursal que aquí no
  existe (`:132`), cuando se procesa, entonces responde
  `skipped_not_published` **y** no mueve ninguna de las dos columnas.
- **E7** — Dado un evento `STORE` válido sobre una sucursal ya publicada,
  cuando se procesa, entonces responde `processed` y las dos columnas quedan
  con los valores del payload. **Sin cambio.**
- **E8** — Dado el primer `STORE` de una sucursal (alta: marca y sucursal se
  crean en el mismo evento), cuando se procesa, entonces responde `processed`,
  se crea la marca y las dos columnas quedan con los valores del payload.
  **Sin cambio** — es literalmente E16 de F-018.
- **E9** — Dado un `STORE` que despublica una sucursal existente
  (`publishToStore: false`) o un `operation: "DELETE"`, cuando se aplica,
  entonces responde `processed` y las dos columnas quedan con los valores del
  payload. **Sin cambio**: un evento que despublica sigue configurando (E10 de
  F-022), y el nombre del negocio es información del negocio, no de la
  publicación.

## Reglas de negocio

- **R1 — Las dos columnas se escriben si y solo si el evento escribe algo.**
  Ni antes de una guarda, ni en un camino que devuelve sin escribir.
- **R2 — Ninguna respuesta cambia.** Códigos HTTP, `ok`, `failed`, `results` y
  `SyncEvent.status` son idénticos antes y después del arreglo, en los nueve
  escenarios.
- **R3 — R8/E16 de F-018 se conservan literalmente.** Se apunta a `businessId`
  (identidad autenticada), nunca a `payload.businessId`; es un `update`, nunca
  un `upsert`; el sync no crea negocios.
- **R4 — Ninguna guarda se mueve.** Ni al principio ni a ningún otro sitio.
- **R5 — Cero consultas nuevas en el camino que se aplica.** Un `STORE` que se
  aplica hace el mismo número de escrituras que hoy; uno que se descarta hace
  **una menos**.
- **R6 — Idempotencia intacta.** Reenviar el mismo evento sigue dando el mismo
  estado final; es lo que exige AGENTS.md § Cosas que muerden para todo lo que
  escribe el sync.

## Casos límite y errores

1. **`operation: "DELETE"`** — sale por la rama de despublicación (`:167-169`),
   que sí escribe; las dos columnas se aplican con ella. Sin cambio (E9).
2. **Un lote con dos `STORE` del mismo negocio, uno bueno y uno malo** — el
   bueno escribe, el malo no. Hoy escriben los dos y **gana el orden de
   llegada**, así que un malo detrás de un bueno puede dejar el valor del malo.
   Después del arreglo, el bueno manda siempre. Es una mejora observable y
   merece un criterio propio (criterio 5).
3. **Un lote de 500 `STORE` todos fallidos** — hoy son 500 `UPDATE` inútiles;
   después, cero. Nada que probar aparte de R5.
4. **Reintento del mismo evento fallido** (el outbox reintenta seis veces) —
   hoy seis escrituras, después ninguna. `SyncEvent` sigue re-procesándose
   igual (R4/E15 de F-043).
5. **`DEPENDENCY_FAILED_IN_BATCH`** — se lanza en
   `src/features/sync/server/processBatch.ts:93`, **antes** de entrar al
   handler, así que hoy tampoco escribe. Sin cambio, pero conviene que un
   criterio lo fije para que nadie lo mueva luego.
6. **El `throw new Error("handleStore: unexpected slug rejection…")` de
   `:244-248`** — es la decimotercera salida, la que el análisis de F-043 no
   listó. No es un `SyncEventFailure`, así que su mensaje interno viaja tal
   cual al `failed[].error` del POS
   (`src/features/sync/server/processBatch.ts:124-127`). Es inalcanzable en la
   práctica (`proposedSlug: null` nunca se rechaza, E14 de F-017), pero si
   alguna vez se alcanza, después del arreglo tampoco escribirá.
7. **Concurrencia** — dos lotes del mismo negocio a la vez siguen resolviendo
   por «gana el último», igual que hoy. Fuera de alcance.
8. **Un negocio cuya moneda base ya es incorrecta por este defecto** — el
   arreglo no la repara. No hay backfill: el siguiente `STORE` que se aplique
   la deja bien. Anotado en § No decidido.

## Datos y contrato

**Sin migración, sin endpoint nuevo, sin campo nuevo.** Ni una línea de
`prisma/schema.prisma`: `Business.name` (`:153`) y `Business.baseCurrencyCode`
(`:160`) se quedan como están.

**Sí sube `docs/sync-contract.md`.** El arreglo permite volver a prometer lo
fuerte, y eso es una edición: **v13.2 → v13.3**, **menor**. Menor porque no
cambia nada de lo que el POS envía ni recibe —ni un campo, ni un código, ni una
regla de validación— y porque el POS **no puede observar** la diferencia: no
hay ninguna lectura de vuelta de `Business.name`/`baseCurrencyCode`, y el hash
de reconciliación del § ⑤ cubre productos (y, con F-044, el tarifario), nunca
el negocio. Lo que cambia es que un párrafo que hoy pide perdón deja de tener
que pedirlo. La v13 sigue **sin publicar** (`docs/sync-contract.md:3-5`), así
que si esto entra antes, cuadrecaja no llega a leer nunca la versión débil —
ver SP4.

Lo que la v13.3 tocaría, todo en la dirección de **quitar** salvedades:

1. `docs/sync-contract.md:228-239`, § «`zoneCode` en el `payload` de `STORE`»:
   se va la frase «**El nombre del negocio y su moneda base sí pueden haberse
   escrito**…» y el «**de la sucursal**» de `:233` vuelve a ser un simple
   «ninguno de sus otros campos se aplica».
2. La fila de `STORE_ZONE_UNKNOWN` de la tabla de respuestas
   (`docs/sync-contract.md:1892`): fuera el inciso «`Business.name`/
   `baseCurrencyCode` sí pueden haberse escrito (I4…)».
3. Una entrada nueva en § «Cambios respecto a la v12.2»
   (`docs/sync-contract.md:49`), que es donde ya viven las de la v13, v13.1 y
   v13.2.

Y dos filas que **no hay que tocar porque el arreglo las vuelve verdad**: la de
`STORE_OPENING_HOURS_INVALID` (`docs/sync-contract.md:1885`), que promete
«ninguno de sus campos se aplica —tampoco un `name` o un `phone` que viajaran
con él—», y la de `STORE_DELIVERY_CONFIG_INCONSISTENT`
(`docs/sync-contract.md:1883`), que promete «No escribe nada». Hoy las dos
mienten; después del arreglo son exactas. Ver I2.

## Opciones de arreglo, con su coste

**(a) Mover la escritura detrás de las guardas, a los tres sitios que
escriben.** Una función privada `applyBusinessFields(businessId, payload)` en
el mismo archivo, llamada justo antes de cada una de las tres escrituras:
después de `:138`, después de `:221` y después de `:270`. Es **exactamente** la
colocación que el archivo ya usa para `assertZoneKnown` (`:138`, `:214`, `:261`)
y `assertDeliveryConsistent` (`:137`, `:213`, `:260`), y que sus docstrings
declaran doctrina: «Called HERE, right before the write it guards, never once
at the top». Coste: ~12 líneas en un archivo, cero migración, cero API nueva.
Riesgo: que alguien añada un cuarto camino de escritura y olvide la llamada —
el mismo riesgo que ya se acepta para las dos guardas gemelas.

**(b) Plegarla dentro de la escritura de la sucursal, como `nested write`.**
`prisma.store.update({ data: { …, business: { update: { name,
baseCurrencyCode } } } })` en los dos caminos de `update`. Ventaja real:
atómica con la escritura de la sucursal y **un round-trip menos** en cada
evento aplicado, que es justo lo que pide AGENTS.md § Cosas que muerden
(«Batchea en un solo round-trip»). Inconveniente: el camino de **alta** no
tiene un `store.update` donde plegarla — pasa por
`createStorefrontWithStore` (`src/features/storefront/server/registry.ts:70`),
que es componente compartido y habría que ampliarle la entrada. Queda un
arreglo mitad (b) mitad (a), menos legible que (a) entera. **Buena idea para
después**, si alguien mide que el round-trip importa.

**(c) Dejarla donde está y hacerla condicional.** No se puede: saber si el
evento se va a aplicar exige haber corrido las guardas, que es (a) con pasos de
más. La variante barata —dejarla primero pero darle su propia marca
anti-rancio— arregla M1 y **no** arregla M2/M3/M4, y además cuesta una columna
nueva y una migración. Peor relación coste/resultado que (a).

**(d) Envolver el handler en una transacción.** Es la opción que AGENTS.md
desaconseja explícitamente: «El pooler de Supabase corre en modo transacción.
Ninguna query puede usar el cliente global dentro de un `$transaction`: hace
deadlock contra la conexión del pool». `handleStore` usa el cliente global de
punta a punta y además llama al registro, que también lo usa; haría falta hilar
un cliente transaccional por toda esa cadena. Es el arreglo más caro, el más
arriesgado y resuelve un problema —atomicidad de todo el handler— que nadie ha
pedido. **No recomendada.**

**(e) No arreglarlo y documentarlo mejor.** Ya está documentado en cuatro
sitios (`spec.md` § I4, `architecture.md` § AD4, `src/constants/sync.ts:137-139`
y el contrato). Lo que falta no es documentación.

**Recomendada: (a).** Es la más pequeña, la única que reusa una doctrina que el
archivo ya tiene escrita tres veces, no toca ninguna guarda, no toca el
registro, no toca el schema y deja (b) disponible como optimización posterior
sin haber cerrado ninguna puerta.

**Dónde viven las pruebas.** Recomendación: **no crear un
`store.db.test.ts` nuevo**. Ya hay 23 archivos `*.db.test.ts` y corren en
serie a propósito (`vitest.config.mts:76-82`); un archivo más cuesta tiempo de
`verify.sh` en cada ejecución. Los dos hogares naturales ya existen:
`src/features/sync/server/handlers/business.db.test.ts` (donde vive el aserto a
invertir y el helper `storeEvent`) y
`src/features/sync/server/handlers/storePublishGate.db.test.ts` (que ya
ejercita `STORE` por la ruta real contra Postgres). Lo de R5 —el recuento de
escrituras— va en `src/features/sync/server/handlers/store.test.ts`, que ya
tiene el mock `businessUpdate` (`:23`, `:144-147`). Decisión final del
arquitecto.

## Criterios de aceptación propuestos

Todos `[nuevo]`: este feature no existe todavía en `.agent/features.json`.
Escritos para copiarse tal cual. Cada uno se comprueba **ejecutando** una
petición y **leyendo la columna**, nunca leyendo código.

1. `[nuevo]` Un `STORE` rechazado con `STORE_ZONE_UNKNOWN` deja
   `Business.name` y `Business.baseCurrencyCode` **exactamente** como estaban:
   leídas antes y después de la petición son iguales, y la respuesta sigue
   siendo `207` con ese evento en `failed[]` con ese código.
2. `[nuevo]` Lo mismo, con su propia petición y sus dos lecturas, para
   `STORE_OPENING_HOURS_INVALID`, para `STORE_DELIVERY_CONFIG_INCONSISTENT` en
   su forma de `207` y para `STORE_TIMEZONE_INVALID`: los cuatro códigos de
   error de `STORE` dejan las dos columnas intactas.
3. `[nuevo]` Un `STORE` rancio responde `stale` dentro de `ok` y las dos
   columnas conservan los valores **nuevos**: partiendo de
   `name = "Nombre NUEVO"` / `baseCurrencyCode = "USD"` y enviando un evento
   viejo que trae `"Nombre VIEJO"` / `"CUP"`, la lectura posterior sigue
   diciendo `"Nombre NUEVO"` / `"USD"`.
4. `[nuevo]` Un `STORE` de una sucursal de otro negocio y un `STORE` que
   despublica una sucursal inexistente responden `skipped_not_published` y no
   mueven ninguna de las dos columnas, verificado leyéndolas después.
5. `[nuevo]` Un `STORE` que **sí** se aplica las sigue escribiendo en los tres
   caminos —alta de sucursal nueva, actualización de una publicada y
   despublicación de una existente—, verificado leyendo las dos columnas tras
   cada uno; y en un lote con un `STORE` bueno y otro que falla, el valor final
   es el del bueno, sea cual sea el orden de los dos eventos en el lote.
6. `[nuevo]` El número de escrituras no sube: contadas con el mock de
   `src/features/sync/server/handlers/store.test.ts`, un `STORE` que se aplica
   llama a `business.update` **una** vez, y uno que devuelve `stale`,
   `skipped_not_published` o `failed` lo llama **cero** veces.
7. `[nuevo]` `docs/sync-contract.md` sube a **v13.3** retirando la salvedad de
   I4 de § «`zoneCode` en el `payload` de `STORE`» y de la fila de
   `STORE_ZONE_UNKNOWN`, con su entrada en «Cambios respecto a la v12.2»;
   `grep -c 'Business.name' docs/sync-contract.md` da **0** y el hook
   `.claude/hooks/sync-contract-version.sh` no protesta.
8. `[nuevo]` `bash .agent/verify.sh F-045 --full` termina con código 0.

## Incongruencias detectadas

- **I1 — El comentario de `src/features/sync/server/handlers/store.ts:71-73`
  justifica con R8/E16 algo que R8 y E16 no dicen.** Las dos reglas de F-018
  (`.agent/specs/F-018/spec.md:312` y `:217-221`) hablan de a qué fila apunta la
  escritura y de que no crea negocios; ninguna habla de su posición. La
  posición viene de que en `613b254` esto era un `upsert` cuyo resultado hacía
  falta abajo, y `12eacc8` quitó esa dependencia sin mover la llamada. Un
  comentario que justifica una posición con una regla que no la exige es lo que
  hace que el siguiente lector no vuelva a mirar.
- **I2 — El contrato solo se corrigió en uno de los cuatro sitios donde miente.**
  La v13.2 debilitó la promesa en § `zoneCode` (`docs/sync-contract.md:233`) y
  en la fila de `STORE_ZONE_UNKNOWN` (`:1892`), pero la fila de
  `STORE_OPENING_HOURS_INVALID` (`:1885`) sigue prometiendo «ninguno de sus
  campos se aplica —tampoco un `name` o un `phone`—» y la de
  `STORE_DELIVERY_CONFIG_INCONSISTENT` (`:1883`) sigue diciendo «No escribe
  nada». Las dos son falsas hoy, y por la misma causa. **No se arreglan
  debilitándolas**: el arreglo de este feature las vuelve verdad sin tocarlas.
  Lo mismo, palabra por palabra, en `src/constants/sync.ts:29-32`.
- **I3 — `baseCurrency` tiene un `.default("CUP")` que convierte «omitir» en
  «reiniciar».** `src/features/sync/schemas.ts:42` es
  `z.string().length(3).default("CUP")`, así que un `STORE` sin ese campo pone
  la moneda base en `CUP` aunque el negocio fuera `USD` (medido en M2). Choca
  de frente con la doctrina «omitir no es apagar» que la ADR 0028 y el propio
  contrato aplican a las cinco columnas de compra y a `zoneCode`
  (`docs/sync-contract.md:221-228`), y con el contraste que ese mismo párrafo
  dibuja entre las dos semánticas de omisión. Está documentado en
  `docs/sync-contract.md:2146` («por defecto CUP si se omite»), así que hoy es
  contrato, no bug — pero es contrato para el campo del **negocio** que decide
  la moneda de un pedido. SP5.
- **I4bis — La lista de salidas de `handleStore` que circula en los documentos
  está incompleta.** Entre `:78` y el final hay **trece** salidas nombradas
  —más cualquier error de base—, no las ocho que se citan: los tres retornos
  tempranos (`:112`, `:120`, `:132`),
  **tres** llamadas a `assertDeliveryConsistent` (`:137`, `:213`, `:260`),
  **tres** a `assertZoneKnown` (`:138`, `:214`, `:261`), una a
  `assertOpeningHoursValid` (`:205`), **dos** comprobaciones de `timezone`
  (`:219-221` y `:268-270`), el `throw new Error` genérico de `:244-248`, y
  cualquier error de base en las tres escrituras. Lo que se cita casi siempre
  son los sitios donde el `throw` está **definido** (`:351`, `:374`, `:389`),
  no donde se **llama**, y son cosas distintas para quien tenga que mover algo.
- **I5 — Un `Error` genérico manda su mensaje interno al POS.**
  `src/features/sync/server/processBatch.ts:124-127` usa `error.message` como
  `failed[].error` para cualquier excepción, no solo para `SyncEventFailure`,
  así que el `"handleStore: unexpected slug rejection deriving from a name: …"`
  de `:246` viajaría al vocabulario de errores del contrato. Es inalcanzable
  hoy (E14 de F-017) y **no es de este feature**; queda anotado porque se
  encontró cartografiando las salidas.

## Huecos y preguntas al humano

**SP1 — ¿Entra al backlog como F-045, y en qué orden respecto a F-044?**
Qué falta: la decisión de backlog, que es suya (regla 4).
Por qué bloquea: sin ella esto es una propuesta y nada más.
Opciones: **(a)** entra ahora, **antes** de publicar la v13, para que
cuadrecaja lea la promesa fuerte y no la débil; **(b)** entra detrás de F-044,
que protege un importe cobrado y es más urgente para ellos; **(c)** no entra:
queda escrito aquí y el contrato sigue con la salvedad de I4.
**Recomiendo (a)**, con una salvedad honesta: por gravedad pura, (b) es
defendible —lo medido dice media-baja— y no discutiría si lo elige. Lo que
inclina la balanza es la **ventana**: el arreglo cuesta ~12 líneas y hoy evita
publicar una salvedad que mañana habría que retirar en otra versión. F-044 es
más grande y más largo; este puede entrar en el hueco.

**SP2 — ¿Qué opción de arreglo?**
Qué falta: elegir entre las cinco de § Opciones.
Por qué importa: cambia el tamaño del diff y qué componentes se tocan.
Opciones: **(a)** un helper privado llamado antes de cada una de las tres
escrituras, como ya se hace con las dos guardas gemelas; **(b)** `nested write`
dentro del `store.update`, con el camino de alta resuelto aparte; **(c)**
dejarla arriba con su propia marca anti-rancio (columna nueva + migración);
**(d)** transacción.
**Recomiendo (a)**. **(d) no la recomiendo en ningún caso**: choca con la
restricción del pooler que AGENTS.md § Cosas que muerden documenta, y ese
deadlock es la clase de fallo que aparece en producción y no en los tests.

**SP3 — ¿Se puede invertir el aserto de
`src/features/sync/server/handlers/business.db.test.ts:673-676`, que es
artefacto de F-043, cerrado y con `passes: true`?**
Qué falta: permiso para editar una prueba de otro feature.
Por qué bloquea: esa prueba afirma hoy lo contrario de lo que el criterio 1
exigirá. No pueden convivir; no hay forma de añadir el nuevo sin tocar el
viejo.
Opciones: **(a)** se invierte en el mismo commit, y su comentario pasa a decir
que F-045 corrigió I4, con la referencia; **(b)** se borra la prueba entera;
**(c)** no se toca y el criterio 1 se escribe contra otro código de error, lo
que deja una prueba verde afirmando un defecto ya arreglado.
**Recomiendo (a)**. La regla 3 protege los `acceptance_criteria` de F-043, no
su código ni sus pruebas; y las otras aserciones de esa misma prueba —que no
hay `400` de lote y que el evento vuelve en `failed[]` con
`STORE_ZONE_UNKNOWN`— son las que sostienen el criterio 3 de F-043 y **no se
tocan**. (c) es la peor: deja una mentira en verde.

**SP4 — ¿Se publica la v13 antes o después de este arreglo, y basta con una
menor?**
Qué falta: la secuencia con cuadrecaja, que negocia usted.
Por qué importa: si la v13.2 sale tal cual, cuadrecaja implementa contra una
promesa que vamos a cambiar en la versión siguiente.
Opciones: **(a)** este feature primero, y la v13 sale ya en **v13.3** con la
promesa fuerte, sin que ellos vean nunca la salvedad de I4; **(b)** se publica
la v13.2 tal como está y la v13.3 va después, con su aviso; **(c)** se
considera **mayor** (v14) porque cambia el efecto observable de un evento
fallido.
**Recomiendo (a)**, y **menor**, no mayor: el POS no envía ni recibe nada
distinto, y no tiene ninguna forma de observar esas dos columnas (no hay
lectura de vuelta y el hash del § ⑤ no las cubre). Si usted lee que el efecto
en base es «lo que el POS recibe», entonces es (c) y lo digo sin discutir: es
su criterio de versionado.

**SP5 — ¿Qué hacemos con el `.default("CUP")` de `baseCurrency` (I3)?**
Qué falta: decidir si se toca, y dónde.
Por qué importa: sin tocarlo, un `STORE` que omita el campo sigue reiniciando a
`CUP` la moneda base de un negocio que no la tenga —solo que ya no lo hará
desde un evento rechazado, que es la mitad aguda del problema.
Opciones: **(a)** fuera de este feature, propuesta o feature propio; se
coordina con cuadrecaja porque quitar el default es una **mayor** del contrato
(`docs/sync-contract.md:2146` promete el default explícitamente); **(b)**
dentro, ampliando el alcance y la versión a mayor; **(c)** nada: se deja como
está, documentado.
**Recomiendo (a)**. Mezclar un arreglo de posición —invisible para el POS— con
un cambio de semántica de campo —que les obliga a enviar siempre `baseCurrency`
o a aceptar que omitirlo ya no reinicia— hace ilegible el diff y convierte una
menor en una mayor. Además, en la práctica casi todos los negocios son `CUP`,
así que el daño real es de los pocos que no lo son: merece su propia
conversación, no un renglón dentro de esta.

## Respuestas del humano (2026-09-10) — esta propuesta ya es F-045

Contestadas en la misma tanda, con la propuesta delante. Recogidas aquí porque
el hilo de la conversación se pierde y este archivo no.

- **SP1 → entra como `F-045`, y ANTES de F-044.** No por gravedad —F-044
  protege un importe cobrado— sino por la ventana: la v13 todavía no se ha
  publicado, y así se publica con la promesa fuerte en vez de con la salvedad
  de I4 y tener que desdecirse después.
- **SP2 → opción (a)**, el helper privado llamado justo antes de cada una de
  las tres escrituras. La transacción (d) queda descartada por el pooler; el
  `nested write` (b) queda disponible como optimización posterior.
- **SP3 → sí, se puede invertir el aserto de I4 de F-043**
  (`src/features/sync/server/handlers/business.db.test.ts:673-676`). Lo decidió
  el orquestador sin subirlo, con el motivo escrito: la regla 3 protege los
  `acceptance_criteria` ya escritos, no las pruebas, y el precedente es del
  mismo día —F-043 invirtió la de F-041 exactamente igual.
- **SP4 → v13.3, dígito menor, y publicar la v13 después del arreglo.** Menor
  por la misma lógica que la v13.2: el borrador sigue sin publicar y cada
  edición es una revisión del mismo borrador. El POS no puede observar esas dos
  columnas, así que no cambia nada de lo que emite o recibe.
- **SP5 → fuera de F-045, y con una vuelta.** El humano eligió primero meterlo
  dentro; se le devolvió el choque —quitar el `.default` cambia lo que el POS
  puede omitir, o sea versión **mayor**, y eso contradecía sus respuestas a SP1
  y SP4, que buscaban entrar antes de publicar la v13— y con eso delante
  eligió: «F-045 solo I4; el `.default` va como F-046». Vive ya en
  [`baseCurrency-omitido-cae-en-cup.md`](baseCurrency-omitido-cae-en-cup.md),
  con lo medido y sin recomendación: le faltan tres datos que se resuelven
  ejecutando.

Los ocho `acceptance_criteria` de § «Criterios de aceptación propuestos» se
copiaron a `.agent/features.json` tal cual, sin ablandar ninguno.

## No decidido a propósito

- **Dónde vive exactamente el helper y cómo se llama** —privado en
  `src/features/sync/server/handlers/store.ts`, o un módulo aparte—, y si se
  aprovecha (b) para el camino de actualización dejando (a) solo en el de alta.
  Es del **arquitecto**; lo que esta propuesta fija es el **momento** (R1) y el
  **resultado** (E1-E9), no la forma.
- **En qué archivo de prueba acaba cada criterio.** Hay recomendación (§
  Opciones, «Dónde viven las pruebas») pero la decide el arquitecto con el
  probador.
- **Si hay que reparar los negocios que ya tengan la moneda mal por este
  defecto.** No hay forma de saber cuáles son sin comparar contra el POS, y el
  siguiente `STORE` que se aplique los deja bien solos. Un backfill parece
  desproporcionado; lo decide el humano si aparece un caso real.
- **Si `Business.name` debería dejar de viajar en el `STORE`**, ya que no lo
  lee nadie. Es una decisión de propiedad de campos con el otro equipo, no de
  este arreglo, y hoy la tabla de propiedad del contrato se la asigna a
  cuadrecaja.
- **Si I5 (el mensaje interno de un `Error` genérico que llega al POS) merece
  algo.** Es inalcanzable hoy; si alguna vez se alcanza, lo descubrirá quien lo
  alcance.
