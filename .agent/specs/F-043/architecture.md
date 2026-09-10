---
feature: F-043
agente: sdd-architect
actualizado: 2026-09-10T01:54:48Z
estado: listo
---

> **La spec fijó el ORDEN (R7) y el RESULTADO; esto fija la FORMA.** Cinco
> decisiones, `AD1`–`AD5`, y ninguna reabre lo que el humano ya cerró el
> 2026-09-09: el código de error reutilizado por entidad, la v13.2 como dígito
> menor, y las tres lecturas (a)/(b)/(c) de § Huecos.

## Estado actual relevante

Lo que existe hoy y se reutiliza **tal cual**, leído en el código y no deducido:

| Archivo                                              | Qué hay                                                                                                                           | Qué le pasa en F-043                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/features/sync/schemas.ts:8`                     | `import { isKnownZoneCode, ZONE_CODE_PATTERN }`                                                                                   | **Se va entera**: al caer las dos validaciones no queda ningún uso                        |
| `src/features/sync/schemas.ts:58`                    | `zoneCode: z.string().regex(ZONE_CODE_PATTERN).nullish()` en `storePayloadSchema`                                                 | Pasa a `z.string().nullish()` (R1)                                                        |
| `src/features/sync/schemas.ts:170-173`               | `zoneCodeSchema` = `string().regex(...).refine(isKnownZoneCode, { error: ZONE_TARIFF_ZONE_UNKNOWN })`, compartido por las 3 ramas | Pasa a `z.string()` a secas; con él se va el import de `ZONE_TARIFF_ZONE_UNKNOWN` de `:6` |
| `src/features/sync/server/handlers/zoneTariff.ts`    | Cuatro pasos: `DELETE` → sucursal → aviso de zona retirada → anti-rancio → `upsert`                                               | Gana el paso 4 de R7 entre `:84-86` y `:93`                                               |
| `src/features/sync/server/handlers/store.ts:367-372` | `assertZoneKnown(config)` privada, llamada en `:138`, `:214`, `:261`                                                              | **No se mueve** (R8). Solo cambia su docstring                                            |
| `src/features/sync/server/handlers/store.ts:74-78`   | `prisma.business.update` — la primera escritura, antes de toda guarda                                                             | No se toca. Es I4, y F-043 la **ensancha** (AD4)                                          |
| `src/features/sync/server/handlers/types.ts:86`      | `class SyncEventFailure extends Error`                                                                                            | Se reutiliza: cero maquinaria nueva                                                       |
| `src/features/sync/server/processBatch.ts:119-128`   | El `catch` que convierte un `SyncEventFailure` en `failed[]`, `results[]` y `markFailed`                                          | **Cero líneas**                                                                           |
| `src/features/zones/catalog.ts:71-73`                | `isKnownZoneCode(code)` — `Map.has` sobre el artefacto, cero consultas                                                            | Se reutiliza. Es la única pregunta (R2)                                                   |
| `src/features/zones/catalog.ts:22`                   | `export const ZONE_CODE_PATTERN`                                                                                                  | **Se retira** (AD2): sin importadores tras F-043                                          |
| `src/features/zones/boundaries.test.ts:97-114`       | Lista blanca de quién puede importar `@/features/zones/catalog`                                                                   | Pierde `src/features/sync/schemas.ts`. Es el **sensor** de AD1                            |
| `src/features/sync/server/inbox.ts:85-96`            | `markFailed`: un `updateMany` por fallo, «failures are rare by construction»                                                      | Esa premisa deja de ser cierta (AD5)                                                      |
| `src/constants/sync.ts:80-93`, `:123-134`            | Los dos códigos, con comentarios que dicen «schema» y «`400` de lote»                                                             | Cambian los **comentarios**; los valores no                                               |

No hay componente nuevo de producto, ni pantalla, ni migración, ni endpoint.
F-043 **quita** dos validaciones de una capa y **añade** tres líneas en otra.

## Decisión

### AD1 — La comprobación vive en `zoneTariff.ts` como gemela privada, y el guardián se sube a la prueba de fronteras

Una función privada, no exportada, en
`src/features/sync/server/handlers/zoneTariff.ts`, con el **mismo nombre** que
la de `store.ts` y distinta firma:

```ts
// privada; el schema garantiza `string`, así que no hay caso nulo que tolerar
function assertZoneKnown(zoneCode: string): void {
  if (!isKnownZoneCode(zoneCode)) throw new SyncEventFailure(ZONE_TARIFF_ZONE_UNKNOWN);
}
```

Llamada en **un** sitio: entre el `return STALE` (`zoneTariff.ts:84-86`) y el
`upsert` (`:93`), que es el paso 4 de R7.

**Por qué gemela y no helper compartido, con el criterio de corte escrito.**

1. **Lo común es una línea; lo que difiere es lo que lleva la semántica.** En
   `handleStore` la guarda recibe un `StoreConfigWrite` y **sale antes** cuando
   `config.zoneCode == null` (`store.ts:368`). Ese `return` **es** R9 —«omitir
   no es apagar», `null` borra la columna— y no tiene análogo en `ZONE_TARIFF`,
   donde el `zoneCode` es obligatorio y no nulo por el schema (R5). Un helper
   compartido tendría que aceptar `string | null | undefined` y recibir el
   código de error por parámetro: dos parámetros para una línea, y una firma que
   le regala a `ZONE_TARIFF` una tolerancia al nulo que su contrato no tiene y
   que nadie volvería a quitar.
2. **El criterio de corte, con la tercera y la cuarta entidad por delante.** El
   helper compartido se gana el sitio cuando la pregunta **deje de ser la
   misma**, no cuando haya un tercer llamador de la misma pregunta. Dos
   disparadores concretos, y el segundo es el probable: (a) una tercera entidad
   de **entrada** con `zoneCode` —hoy no existe ninguna en la cola: `F-044` es
   un hash y `contact.zoneCode` es de salida y se valida sin catálogo a propósito
   (`src/features/orders/schemas.ts:109`)—; o (b) el primer llamador que
   necesite algo más que «está en el índice». El candidato real es el **nivel**:
   `ZONE_TARIFF.zoneCode` admite provincia **y** municipio porque la precedencia
   lo exige, mientras `Store.zoneCode` describe dónde está una sucursal y una
   provincia ahí es casi seguro un error del POS. El día que uno de los dos
   valide el nivel, la firma que hará falta es
   `assertZoneKnown(code, { levels })` — y **esa** se escribe una vez, para los
   dos. Extraer hoy el `Map.has` no adelanta ni una línea de ese día: lo único
   que se compartiría es lo que nunca fue el problema.
3. **Lo que de verdad tiene que no volver a divergir es la CAPA, y ya tiene
   sensor.** La divergencia que F-043 cierra (I6 de F-041) no fue entre dos
   handlers: fue entre el **schema** y el **handler**. Un módulo compartido
   dentro de `handlers/` no impide que alguien vuelva a poner un `.refine` en
   `src/features/sync/schemas.ts`. Lo que sí lo impide es una prueba que se
   ponga roja, y ya existe: `src/features/zones/boundaries.test.ts:97-119`
   compara la lista de importadores reales del catálogo contra una lista blanca
   con `toEqual`. **Se le quita la línea `"src/features/sync/schemas.ts"` y se
   deja escrito en su comentario por qué salió.** Desde ese commit, devolver el
   `refine` al sobre no es un criterio olvidado: es un test rojo con nombre.
   Y esto descarta el helper compartido también por lo mecánico: si la
   comprobación se mudara a un módulo nuevo, `store.ts` dejaría de importar el
   catálogo y esa lista blanca cambiaría **tres** líneas en vez de una, diciendo
   algo que no es lo que este feature decidió.

**Descartadas.** Guarda en línea: pierde la simetría de nombre —un `grep
assertZoneKnown` deja de encontrar los dos sitios donde el catálogo protege una
escritura— y se queda sin sitio donde colgar el comentario que explica por qué
va en el paso 4 y no al principio, que es la mitad de la doctrina de F-041
(`store.ts:355-366`). Helper compartido hoy: punto 2.

**El aviso de zona retirada (`zoneTariff.ts:73-77`) no se mueve.** Una zona
desconocida nunca es retirada (`isRetiredZone` devuelve `false` para lo que no
está en el índice, `catalog.ts:78-80`), así que las dos comprobaciones no se
pisan; moverlo cambiaría cuándo se avisa en los eventos `stale`, que ninguna
spec autoriza.

### AD2 — `ZONE_CODE_PATTERN` se retira de `catalog.ts`, y la forma DPA gana por primera vez un guardián

Comprobado con `grep` sobre todo el repositorio: los **únicos** importadores son
`src/features/sync/schemas.ts:8`, `:58` y `:172` — las tres líneas que F-043
borra. Ningún test lo importa (`src/features/zones/catalog.test.ts` no lo usa),
ningún guion de `scripts/` lo usa, y `src/features/orders/schemas.ts` valida el
`zoneCode` del comprador con `min`/`max` y nunca con él.

**No se usa desde donde va la comprobación.** R2 dice que la única pregunta es
`isKnownZoneCode`, y un `regex` delante sería un segundo camino que solo puede
coincidir con el `Map` —un código mal formado nunca está en el índice— y que
reintroduce en el código la distinción que el humano borró del producto («no se
crea `ZONE_CODE_MALFORMED`»). Dejarlo exportado al lado de la única pregunta que
cubre las dos causas es una invitación a que el siguiente lo vuelva a enchufar.

**Pero borrarlo a secas deja la forma DPA solo en prosa**, y hoy **nada**
comprueba que los 184 códigos del artefacto la cumplan:
`src/features/zones/catalog.test.ts` verifica el recuento, los duplicados, la
consistencia de `provinceCode` y los `osmRelationId`, no la forma. Así que la
forma se muda a donde tiene un fallo posible: **una aserción de integridad más
en `src/features/zones/catalog.test.ts`**, con el patrón como constante local
del propio test. Es trabajo de `sdd-tester`, y el plan tiene que ordenarlo en el
mismo paso que retira el export, o la forma se pierde entre los dos.

Neto: la API de `src/features/zones/catalog.ts` pierde un export muerto, la
forma DPA pasa de comentario a aserción, y ningún camino de producción puede
volver a preguntar «¿está bien formado?» aparte de «¿lo conozco?».
`.agent/specs/F-041/impl.md` y `.agent/specs/F-042/architecture.md` lo siguen
listando como parte de la API del catálogo: **no se editan**, misma doctrina que
I1 —son artefactos de features cerrados y esta arquitectura es la viva para este
camino desde este ciclo.

### AD3 — I3 merece una ADR nueva, la 0034, más una línea en la cabecera de la 0028

El criterio es AGENTS.md § Documentación —«Decisión estructural nueva → una ADR
en `docs/adr/`»— y la regla que la propia
`docs/adr/0033-cobrar-el-domicilio-y-ofrecerlo-son-dos-preguntas.md:6-13` cita
al abrirse: contradecir una decisión publicada exige una ADR que la supere, «así
que no puede ser una nota dentro de ella». El precedente es literal y es sobre
**la misma ADR**: 0033 estrechó el invariante (e) de 0028 con ADR propia, y 0028
ganó **una línea** en su cabecera apuntando a ella
(`docs/adr/0028-configuracion-de-compra-del-pos.md:7-10`). F-043 hace exactamente
lo mismo con su tercera consecuencia (`:112-115`).

Y hay una razón que va más allá de `zoneCode`, y es la que impide que esto quepa
en una línea del plan: **la premisa de esa consecuencia está medida como
falsa**. Dice «el outbox del negocio se para hasta que alguien lo corrija
(decisión SP1 del humano)». Lo que hace de verdad `planOutboxAck` de cuadrecaja
es sumarle un intento a **todas** las filas del lote y, con
`QAB_OUTBOX_MAX_ATTEMPTS = 6`, abandonarlas para siempre (`notes` de F-043,
medido en su código). Eso no es «se para»: es pérdida silenciosa. Quien mañana
añada una sexta columna de configuración leerá SP1 y aplicará un `400` creyendo
que el peor caso es una parada. Ese es el daño que una ADR evita y una línea del
plan no.

**Qué tiene que decir la ADR** —la escribe quien implemente, con el plan
firmado; aquí va su contenido, no su texto—:

1. Archivo docs/adr/0034-lo-que-valida-el-sobre-y-lo-que-valida-el-aplicador.md
   (por crear), título «0034 — Lo que valida el sobre y lo que valida el
   aplicador».
2. Estado en la forma de 0028/0033: **Propuesta** · fecha · F-043 — pasa a
   **Aceptada** cuando F-043 esté construido, verificado y fusionado.
3. **Contexto**: los tres precedentes que ya decidieron esto de uno en uno sin
   regla escrita —`barcodes` en la v4 (`src/features/sync/schemas.ts:109-111`),
   `openingHours` en la v9 (`src/features/sync/server/handlers/store.ts:199-205`)
   y `displayCurrencies` en la v12 (`src/features/sync/schemas.ts:146-151`)—,
   la decisión contraria SP1 de la ADR 0028, y los dos números de cuadrecaja.
4. **Decisión**, el corte en una frase: _el sobre valida la **forma** —tipo
   JSON, claves obligatorias, discriminantes, pertenencia a un enum generado—;
   el aplicador valida el **valor** cuando ese valor pertenece a un vocabulario
   que los dos lados convergen por separado —un catálogo, una lista de monedas,
   un calendario—, y entonces el fallo es de ese evento, en `207 failed[]`, y es
   reintentable._
5. **Consecuencias**: (a) estrecha la tercera consecuencia de 0028 para
   `zoneCode`, que había entrado en esa familia por R29 de F-041; (b) las cinco
   columnas de 0028 **siguen** en `400` de lote, y hay que decir por qué con el
   criterio nuevo y no por inercia —su error es de **tipo**, y se corrige en el
   POS sin que nadie tenga que converger con nadie—; (c) corrige la premisa de
   SP1 con los dos números; (d) el sensor del criterio, para el catálogo de
   zonas, es la lista blanca de `src/features/zones/boundaries.test.ts` (AD1).
6. La línea nueva en la cabecera de
   `docs/adr/0028-configuracion-de-compra-del-pos.md`, al lado de la que ya
   apunta a 0033.

Observación de paso, **fuera del alcance de F-043**: 0028 sigue en «Propuesta ·
pasa a Aceptada cuando F-032 esté construido, verificado y fusionado»
(`docs/adr/0028-configuracion-de-compra-del-pos.md:3-5`) y F-032 tiene
`passes: true`. Es la misma cabecera que AD3 va a tocar → AP4.

### AD4 — En `handleStore` no se mueve nada, I4 se **ensancha**, y lo único gratis es dejar de prometerla en el contrato

**No se mueve nada** (R8): `assertZoneKnown` sigue en `:138`, `:214` y `:261`.
Al caer el `regex` del schema, «mal formado» cae en la **misma** guarda que
«desconocido», y por eso E3 y E4 son la misma respuesta sin una sola línea nueva
de lógica en `src/features/sync/server/handlers/store.ts`. El único cambio en
ese archivo es de **comentario**: el docstring de `:355-366` dice «never in
`storePayloadSchema` (I6: …)» y tiene que pasar a decir que el schema ya no
opina sobre **ninguna** forma del campo y que esta guarda es el único sitio donde
se decide.

**I4 empeora, y con el número exacto.** Hoy un `STORE` con `zoneCode: "2101"` no
llega al handler —el `400` del schema corta en
`src/app/api/internal/sync/catalog/route.ts:31-37`— y no escribe **nada**.
Después de F-043 llega, ejecuta `prisma.business.update` (`store.ts:74-78`) y
falla más abajo. Es una clase de entrada nueva —el código **mal formado**— que
pasa de «cero escrituras» a «`Business.name` y `Business.baseCurrencyCode`
aplicados». El caso «bien formado pero desconocido» ya estaba así desde F-041 y
`STORE_OPENING_HOURS_INVALID` desde la v9: F-043 no inventa el defecto, lo hace
alcanzable con una causa más.

**No sale gratis no empeorarlo en el código**, y las dos contenciones baratas
están prohibidas:

- Llamar a la guarda **al principio** de `handleStore` convierte `SKIPPED` y
  `STALE` en `failed[]`. Lo dicen los comentarios de `:133-136` y `:256-259`, lo
  exigen E9/E12 de F-041, y contradice R7 pasos 2 y 3 de esta spec y la lectura
  (b) que el humano confirmó el 2026-09-09.
- Mover `prisma.business.update` detrás de las guardas es mover una escritura en
  un handler que F-043 no necesita tocar, con tres caminos de retorno que hoy la
  dan por hecha y sin ninguna prueba de este feature que la cubra.

**No se arregla aquí.** Queda anotado, y es AP1.

**Lo que sí sale gratis, y por eso se hace**: la promesa del contrato.
`docs/sync-contract.md:214-219` dice «ninguno de sus otros campos se aplica»,
que es falso para `Business.name`/`baseCurrencyCode` desde la v9 y que F-043
vuelve falso para una causa más. Ese párrafo **ya** está en la lista de los siete
sitios (el 7 de la spec), así que corregirlo cuesta una frase: la v13.2 lo deja
diciendo «ninguno de sus otros campos **de la sucursal** se aplica y
`sourceUpdatedAt` no avanza», con la nota de que el nombre del negocio y su
moneda base sí pueden haberse aplicado. Lo mismo en el comentario de
`STORE_ZONE_UNKNOWN` (`src/constants/sync.ts:123-134`), que hoy promete «none of
its other fields apply». Llámese **sitio 7-bis**: es una **adición** de esta
arquitectura a la lista de siete de la spec, y el plan y el criterio C4 tienen
que contarla.

### AD5 — `markFailed` deja de costar una consulta por fallo

**Hallazgo que la spec no recoge.** `src/features/sync/server/inbox.ts:85-96`
hace un `updateMany` **por fallo** dentro de un `Promise.all`, con el comentario
«One update per failure, but failures are rare by construction». F-043 borra esa
premisa: el caso límite 10 de la spec es un lote de 500 `ZONE_TARIFF` **todos**
con zona desconocida, y E14 es el escenario que este feature existe para
soportar.

**Decisión: agrupar por mensaje de error.** Un `updateMany` por mensaje
**distinto**, no por evento:
`where: { eventId: { in: ids } }, data: { status: "FAILED", error }`. Mismas
filas, mismos estados, mismo `.slice(0, 500)`: cero cambio observable. En el
escenario que motiva el feature los 500 fallos comparten
`ZONE_TARIFF_ZONE_UNKNOWN`, así que 500 round-trips pasan a **1**; en el peor
caso realista —un lote mezclado— son tantos como códigos distintos, que en el
vocabulario entero del contrato son menos de veinte.

Es una ampliación del alcance que la spec no listó, así que va como **AP2** con
recomendación de hacerlo aquí: son cinco líneas en el archivo que este mismo
feature vuelve caliente, y dejarlo para después es dejar el coste en el commit
que lo crea. Cumple además la línea de AGENTS.md § Cosas que muerden sobre el
pooler: «Batchea en un solo round-trip».

## Componentes

| Componente                                         | Capa                                 | Responsabilidad                                                                                                                                                                                          | Archivo                                                                          |
| -------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Guarda de zona en `ZONE_TARIFF`                    | `src/features/sync/server/handlers/` | `assertZoneKnown(zoneCode: string)` privada; paso 4 de R7, entre el `STALE` (`:84-86`) y el `upsert` (`:93`)                                                                                             | `src/features/sync/server/handlers/zoneTariff.ts`                                |
| Séptima rama del sobre, sin opinión sobre el valor | `src/features/sync/`                 | Fuera `regex(ZONE_CODE_PATTERN)` de `:58` y `regex`+`refine` de `:170-173`; fuera los imports de `:6` y `:8` que se quedan sin uso                                                                       | `src/features/sync/schemas.ts`                                                   |
| Guarda de zona en `STORE`                          | `src/features/sync/server/handlers/` | **No se mueve** (R8, AD4). Solo el docstring de `:355-366`                                                                                                                                               | `src/features/sync/server/handlers/store.ts`                                     |
| Lector del índice                                  | `src/features/zones/`                | Pierde `ZONE_CODE_PATTERN` (`:22`); `isKnownZoneCode` intacto (AD2)                                                                                                                                      | `src/features/zones/catalog.ts`                                                  |
| Códigos de error                                   | `src/constants/`                     | Comentarios de `:80-93` y `:123-134`: nombran el handler y las **dos** causas, dejan de decir «schema»/«`400` de lote», y el de `STORE` deja de prometer lo que I4 desmiente. **Los valores no cambian** | `src/constants/sync.ts`                                                          |
| Marcado de fallos                                  | `src/features/sync/server/`          | `markFailed` agrupa por mensaje: un `updateMany` por error distinto (AD5)                                                                                                                                | `src/features/sync/server/inbox.ts`                                              |
| Sensor de la capa                                  | prueba, `src/features/zones/`        | La lista blanca pierde `src/features/sync/schemas.ts` y gana el porqué en su comentario (AD1)                                                                                                            | `src/features/zones/boundaries.test.ts`                                          |
| Guardián de la forma DPA                           | prueba, `src/features/zones/`        | Aserción nueva: los 184 códigos del artefacto cumplen `^\d{2}(\.\d{2})?$`, con el patrón como constante local (AD2)                                                                                      | `src/features/zones/catalog.test.ts`                                             |
| Contrato                                           | documentación                        | v13.2 con los siete sitios de la spec **más el 7-bis** de AD4                                                                                                                                            | `docs/sync-contract.md`                                                          |
| Decisión estructural                               | documentación                        | El criterio sobre/aplicador, con la premisa de SP1 corregida (AD3)                                                                                                                                       | docs/adr/0034-lo-que-valida-el-sobre-y-lo-que-valida-el-aplicador.md (por crear) |
| Puntero de la ADR superada                         | documentación                        | Una línea en la cabecera, al lado de la que ya apunta a 0033 (AD3)                                                                                                                                       | `docs/adr/0028-configuracion-de-compra-del-pos.md`                               |

Nada de `src/app/`, nada de `src/components/`, nada de `src/lib/`. Ningún
componente de cliente: F-043 es backend puro.

## Flujo de datos

**A. Un `ZONE_TARIFF` con un `zoneCode` que este lado no reconoce.**

1. `POST /api/internal/sync/catalog` → `withInternalAuth` resuelve el negocio.
2. `catalogBatchSchema.safeParse` (`route.ts:31-37`) **acepta**: el `zoneCode` es
   una cadena y eso es todo lo que el sobre exige a partir de la v13.2 (R1/R5).
3. `recordBatch` escribe la fila `SyncEvent` de **todos** los eventos del lote
   (antes: ninguna).
4. `processBatch.ts:86-94` — ¿dependencia fallida en este lote? Si sí,
   `DEPENDENCY_FAILED_IN_BATCH` y el handler no corre (R7 paso 0, E12).
5. `handleZoneTariff` paso 1: ¿`DELETE`? → `ZONE_TARIFF_DELETE_NOT_SUPPORTED`
   (R7 paso 1, E8). El `zoneCode` no se mira.
6. Paso 2: `store.findUnique` — ¿ausente o de otro negocio? → `SKIPPED`, viaja en
   `ok` (R7 paso 2, E9/E10, lectura (b) del humano).
7. Paso 3: guarda anti-rancio `>=` → `STALE`, viaja en `ok` (R7 paso 3, E11).
8. **Paso 4, nuevo**: `assertZoneKnown(payload.zoneCode)` → `Map.has`, cero
   consultas → lanza `SyncEventFailure(ZONE_TARIFF_ZONE_UNKNOWN)`.
9. `processBatch.ts:119-128` lo recoge: `failed[]`, `results[]`, `markFailed`.
   No hay slug canónico, no hay invalidación (R13). Los otros 499 eventos siguen
   su curso y la respuesta es `207`.
10. La fila `SyncEvent` queda en `FAILED`, así que el mismo `eventId` se
    **re-procesa** en la siguiente entrega (`inbox.ts:38-45`, R4/E15).

**B. Un `STORE` con un `zoneCode` mal formado.** Igual hasta el paso 3, y
después **sin cambios de código**: `storeConfigWrite` mete `zoneCode` en el
`config` (`src/features/sync/server/storeConfig.ts:19-22`), y la
`assertZoneKnown` de `store.ts` lanza `STORE_ZONE_UNKNOWN` justo antes de la
escritura que toque —`:138` despublicación, `:214` creación, `:261`
actualización—. Diferencia respecto de hoy: el evento **llega** al handler, así
que `prisma.business.update` (`:74-78`) ya corrió → AD4/I4.

**C. `null` y ausente.** `config.zoneCode == null` sale antes de preguntar
(`store.ts:368`): `null` borra la columna, ausente la deja intacta. R9 no se
toca y C6 lo protege.

## Contratos

### 1. La función nueva

```ts
// src/features/sync/server/handlers/zoneTariff.ts — privada, NO exportada
function assertZoneKnown(zoneCode: string): void;
```

Sin `null` en la firma **a propósito**: el schema garantiza `string` y
`ZONE_TARIFF` no tiene semántica de omisión (R5). La gemela de `store.ts`
conserva la suya (`StoreConfigWrite`), porque su `== null` es R9 y no un detalle
de conveniencia.

### 2. Lo que cambia en los esquemas Zod

```ts
// storePayloadSchema
zoneCode: z.string().nullish(),           // antes: .regex(ZONE_CODE_PATTERN)

// zoneTariffPayloadSchema, las tres ramas
zoneCode: z.string(),                     // antes: zoneCodeSchema (regex + refine)
```

El `const zoneCodeSchema` de `:170-173` desaparece: sin `regex` ni `refine` no
queda nada que compartir entre las tres ramas más que `z.string()`.

### 3. Tabla de errores, con las dos filas que se mueven

| Código                                                         | Dónde se decide                                                    | Respuesta           | Qué NO ocurre                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZONE_TARIFF_ZONE_UNKNOWN` **(se mueve)**                      | handler, paso 4 de R7 — tras `SKIPPED`/`STALE`, antes del `upsert` | `207 failed[]`      | Cero filas de tarifario; los demás eventos del lote se aplican; cero invalidaciones de caché (R13)                                            |
| `STORE_ZONE_UNKNOWN` **(gana una causa)**                      | `store.ts:138`/`:214`/`:261`, sin mover                            | `207 failed[]`      | Ningún campo **de la sucursal**; `sourceUpdatedAt` no avanza. **`Business.name`/`baseCurrencyCode` sí pueden haberse escrito** (I4, `:74-78`) |
| `ZONE_TARIFF_DELETE_NOT_SUPPORTED`                             | handler, lo primero, antes de cualquier consulta                   | `207 failed[]`      | Sin cambios (R20 de F-041)                                                                                                                    |
| `ZONE_TARIFF_FEE_NOT_ALLOWED`                                  | schema (`z.never`)                                                 | `400` de lote       | Sin cambios: es **forma**, no valor                                                                                                           |
| Tipo del `zoneCode` (número, `null`, ausente en `ZONE_TARIFF`) | schema                                                             | `400 INVALID_BATCH` | R5 y la lectura (a) del humano: la **única** puerta que queda abierta al `400` por este campo                                                 |
| `DEPENDENCY_FAILED_IN_BATCH`                                   | `processBatch.ts:86-94`, ya escrito                                | `207 failed[]`      | Sin código nuevo (R23 de F-041)                                                                                                               |

Las dos clases para el outbox de cuadrecaja no cambian: los dos códigos de zona
siguen siendo **reintentables**, también cuando la causa es un código mal
formado (R4, decisión del humano).

## Modelo de datos y migraciones

**Ninguna.** `prisma/schema.prisma` no se toca: `Store.zoneCode` (`:344`, con su
clave ajena en `:357`) y `ZoneTariff.zoneCode` (`:421`, `:435`) mantienen la
referencia a `Zone.code`, que es exactamente lo que la comprobación del paso 4
evita convertir en un error crudo de Prisma en `failed[]` (caso límite 6 de la
spec). Cero índices nuevos, cero `ALTER`, y ninguno de los dos comandos que
AGENTS.md prohíbe entra en el plan.

## Escalabilidad y límites

1. **La comprobación en sí es gratis.** `Map.has` sobre el artefacto ya cargado:
   O(1), cero consultas, cero bytes de cliente. 500 comprobaciones no se miden.
   Y F-043 **no añade importadores** del artefacto (AD1), así que la memoria del
   proceso y el arranque no se mueven.
2. **El coste real del feature es que un lote divergente ahora se procesa.** Un
   lote de 500 `ZONE_TARIFF` todos con zona desconocida costaba **0** consultas
   (el `400` cortaba en `route.ts:31-37`). Ahora cuesta: 1 `findMany` + 1
   `createMany` de `recordBatch`, **500** `store.findUnique` del handler, y —sin
   AD5— **500** `updateMany` de `markFailed`. Total ≈ **1002 round-trips**, la
   mitad de ellos en marcar los fallos, contra un pool de `max: 5`
   (`src/lib/prisma.ts:41`): 100 tandas secuenciales, ~0,2-0,4 s solo en
   `markFailed` con RTT de 2-4 ms contra Supavisor, y ese pool es el mismo que
   sirve las peticiones de la tienda pública. **Con AD5**, `markFailed` baja a
   **1** round-trip y el total a ≈ 502. Es el número que justifica AD5.
3. **Lo que se rompe primero al multiplicar por 100.** No el catálogo (184 filas
   fijas) ni la comprobación: el `markFailed` sin agrupar. Umbral aproximado: a
   partir de ~50 fallos en un lote el marcado pasa a dominar el tiempo de
   respuesta, y `MAX_CATALOG_EVENTS = 500` pone el techo en 500. Un negocio con
   un catálogo desincronizado los alcanza en **un** lote, no en cien.
4. **Un valor que el schema rechazaba ahora llega a disco.** Sin `max()` (R6),
   un `zoneCode` de 10 000 caracteres se persiste en `SyncEvent.payload`
   (JSONB) aunque el evento falle, y la fila **se queda** en `FAILED` para que el
   reintento la recoja (`inbox.ts:38-45`); no hay poda de `SyncEvent` en el
   repositorio. Con 500 eventos así son ~5 MB de JSONB por lote. El límite real
   lo pone el tamaño del cuerpo de la plataforma, no este campo, así que hoy no
   es un riesgo — pero si alguna vez hiciera falta un tope, va en el **cuerpo**
   o en una poda de `SyncEvent`, **nunca** de vuelta en `zoneCode` (R6).
5. **Caché e ISR: cero movimiento.** Un evento fallido no reporta ningún slug
   (`src/features/sync/server/handlers/types.ts`), así que no entra en ninguno de los conjuntos de
   revalidación de `processBatch.ts:133-140` (R13).
   `src/features/sync/server/processBatch.invalidationCount.test.ts` sigue
   siendo cierto sin tocarlo.
6. **Presupuesto de JavaScript: sin cambio.** No hay código de cliente.
   `npm run check:bundle` no se mueve un byte.

## Pruebas que quedan falsas

Se **reescriben**, no se borran. Es trabajo de `sdd-tester`, pero el sitio y el
veredicto nuevo se deciden aquí porque el plan tiene que ordenarlos con ruta.

1. **`src/features/sync/server/handlers/zoneTariff.db.test.ts:400-441`** — el
   «C6 (E9)» de F-041. Afirma `status === 400`, `body.error === "INVALID_BATCH"`,
   un `issues[].message === ZONE_TARIFF_ZONE_UNKNOWN`, `syncEvent.count() === 0`,
   cero tarifas y `storeProduct.count() === 0`. Veredicto invertido, mismo lote:
   `207`, `failed[0].error === ZONE_TARIFF_ZONE_UNKNOWN`, el `PRODUCT` en `ok`,
   `syncEvent.count() === 2` con el culpable en `FAILED`, **cero** tarifas y
   **uno** de producto. El nombre pasa a citar C1 de F-043 y a decir que supera
   al criterio 6 de F-041.
2. **`src/features/sync/schemas.test.ts:392-397`** — «a zoneCode with the wrong
   shape … is rejected regardless of rule». Pasa a afirmar lo contrario:
   `success === true`, con el nombre diciendo que el **valor** lo juzga el
   handler (R1/R5). Es el aserto que impide que alguien devuelva el `regex`.
3. **`src/features/sync/schemas.test.ts:398-402`** — «a zoneCode not in the
   published catalog is rejected». Ídem: `success === true`.
   Los dos anteriores tienen que quedar **acompañados** del aserto que sigue
   siendo cierto y que hoy no existe: un `zoneCode: 2101` **numérico** sí es
   `success === false` (R5, lectura (a) del humano). Sin él, los dos de arriba
   parecen decir que el schema dejó de mirar el campo.
4. **`src/features/zones/boundaries.test.ts:97-119`** — la lista `ALLOWED` y su
   `expect(IMPORTERS).toEqual(ALLOWED)`. **La spec no la localizó**: se pone roja
   sola en cuanto `src/features/sync/schemas.ts` deje de importar el catálogo, y
   lo hace con un diff de arrays que no dice por qué. Se le quita esa línea y se
   le añade el comentario de por qué salió. Es el sensor de AD1: **este es el
   paso del plan que convierte la decisión en una prueba.**
5. **`src/features/sync/server/handlers/zoneTariff.test.ts`** — no queda falsa
   (no mockea el catálogo y sus casos son `DELETE`/`SKIPPED`/`STALE`/`upsert`),
   pero le **falta** el gemelo unitario de C7: zona desconocida **después** del
   `STALE` y **antes** del `upsert`, comprobando que `zoneTariffUpsert` no se
   llamó.
6. **Si entra AD5**, `markFailed` necesita un caso con **al menos dos mensajes
   distintos** en el mismo lote, que es lo único que la agrupación puede romper.
   El más cercano que ya existe es
   `src/features/sync/server/dependencyCascade.db.test.ts:319-326`, que lee la
   fila `FAILED` y su `error`; `src/features/sync/server/inbox.test.ts` solo
   cubre `recordBatch`, así que la función no tiene prueba propia hoy.
7. **Ninguna otra.** `src/features/orders/**` no cambia (fuera de alcance,
   comprobado por el orquestador el 2026-09-09);
   `src/features/zones/precedence.test.ts` y `src/features/sync/fieldOwnership.test.ts`
   no tocan este camino; `src/features/zones/catalog.test.ts` sigue verde y solo
   **gana** la aserción de AD2.

## Patrones a seguir / antipatrones a evitar

- **AGENTS.md § Cosas que muerden, «todo lo que el sync escribe es idempotente y
  va guardado contra escrituras rancias»**: las dos propiedades se conservan
  intactas. La comprobación nueva va **después** de la guarda anti-rancio y no
  escribe nada; la guarda de `ZONE_TARIFF` sigue siendo la que **rechaza** y
  devuelve `STALE`, nunca la de orden de `EXCHANGE_RATE` (ADR 0030).
- **«Un evento fallido NO es un duplicado»**: es lo que hace real la clase
  reintentable (R4/E15). `inbox.ts:38-45` no se toca; AD5 solo cambia **cuántos
  round-trips** cuesta marcarlos, no qué se marca.
- **El pooler en modo transacción, batchear en un round-trip**: es literalmente
  el motivo de AD5. Nada nuevo corre dentro de un `$transaction`.
- **`console.warn` con prefijo `[sync]`, nunca `console.error`**: si el
  implementador añade un aviso al fallar por zona —no hace falta: `failed[]` ya
  deja rastro en `SyncEvent`—, con esa forma y con el prefijo al principio de la
  línea. Ficha `.agent/playbook/console-error-dispara-guardian-servidor.md`.
- **Magic strings a `src/constants/`**: el código de error se importa de
  `src/constants/sync.ts`, nunca se escribe literal en el handler.
- **Un archivo que no existe no se cita entre comillas invertidas**: la ADR 0034
  se nombra sin ellas hasta que exista, con «(por crear)» detrás.
- **Prettier sobre lo que uno escribe en `.agent/`** antes de dar la etapa por
  buena, y **nunca a ciegas sobre un documento ajeno**: los artefactos de F-041 y
  F-042 no se formatean desde este ciclo.
- **Antipatrón que este diseño rechaza explícitamente**: un `regex` delante del
  `Map.has`. Dos caminos que solo pueden coincidir, y la puerta por la que
  volvería la distinción que el humano borró del producto (AD2).

## Riesgos y plan B

1. **El implementador quita el `refine` y no toca la lista blanca.**
   `src/features/zones/boundaries.test.ts` se pone roja con un diff de arrays que
   parece un fallo de fronteras y no de diseño, y la tentación es volver a meter
   `schemas.ts` en la lista «para que pase». Mitigación: el plan lo ordena como
   **paso propio**, con el comentario del porqué, y esta arquitectura lo declara
   el sensor de AD1.
2. **Imports huérfanos que rompen `lint` y no `test`.** Al caer las dos
   validaciones, `src/features/sync/schemas.ts` se queda sin usar
   `ZONE_TARIFF_ZONE_UNKNOWN` (`:6`), `isKnownZoneCode` y `ZONE_CODE_PATTERN`
   (`:8`). Hay que borrar las tres referencias en el mismo paso, o `verify.sh`
   se para en `lint`.
3. **AD2 sin su mitad.** Si se retira `ZONE_CODE_PATTERN` y no se añade la
   aserción de integridad, la forma DPA se queda solo en prosa del contrato. Los
   dos van en el mismo paso del plan.
4. **AD5 y el mensaje cruzado.** Agrupar mal —un `in` con los `eventId` de un
   mensaje y el `error` de otro— escribiría el código equivocado en filas que
   luego el POS lee. Es el único riesgo de corrección de AD5, y lo cubre el caso
   de dos mensajes distintos del punto 6 de § Pruebas.
5. **Plan B si el humano veta la ADR (AP3).** La línea de I3 baja al plan y a un
   comentario en `src/constants/sync.ts`; el feature **no se bloquea**. Lo que no
   tiene plan B es dejar la tercera consecuencia de 0028 sin tocar: el siguiente
   que lea SP1 aplicará un `400` creyendo una premisa medida falsa.
6. **Plan B si el humano veta AD5 (AP2).** El feature sale igual; el número del
   § Escalabilidad punto 2 queda escrito y F-044 —que también toca el tarifario—
   lo recoge.

## ¿Hace falta una ADR?

**Sí.** docs/adr/0034-lo-que-valida-el-sobre-y-lo-que-valida-el-aplicador.md
(por crear), «0034 — Lo que valida el sobre y lo que valida el aplicador».
Contenido completo en AD3, punto por punto. **No la escribo yo**: la escribe
quien implemente, con el plan ya firmado, y con la línea que le corresponde en
la cabecera de `docs/adr/0028-configuracion-de-compra-del-pos.md`.

## Preguntas al humano

**AP1 — I4: `handleStore` escribe `Business.name`/`baseCurrencyCode` antes de
toda guarda, y F-043 lo hace alcanzable con una causa más.**
Opciones: **(a)** queda anotado y F-043 solo corrige la **promesa** del contrato
y del comentario, que es lo único gratis (sitio 7-bis de AD4); **(b)** F-043
mueve `prisma.business.update` detrás de las guardas —sale del alcance: toca
tres caminos de retorno de un handler que este feature no necesita tocar—;
**(c)** feature correctivo suyo, aparte, cuando quiera.
**Recomiendo (a) ahora, y (c) cuando le apetezca.** No recomiendo (b).

**AP2 — AD5: `markFailed` hace hoy un `updateMany` por fallo, y F-043 convierte
«500 fallos en un lote» en un caso de diseño, no en un accidente.**
Opciones: **(a)** entra en F-043 —cinco líneas en
`src/features/sync/server/inbox.ts`, cero cambio observable, 500 round-trips → 1
en el escenario que motiva el feature—; **(b)** queda solo como riesgo escrito y
lo recoge F-044.
**Recomiendo (a)**: dejar el coste en el commit que lo crea es cómo se pierde.

**AP3 — La ADR 0034 dirá que las CINCO columnas de la ADR 0028 se quedan en
`400` de lote, aunque la premisa de SP1 («el outbox se para hasta que alguien lo
corrija») esté medida como falsa: lo que hace `planOutboxAck` es quemar los seis
intentos de todo el lote.**
Opciones: **(a)** se quedan en `400`, porque su error es de **tipo** y se corrige
en el POS sin que nadie tenga que converger —y la ADR lo dice con ese criterio,
no por inercia—; **(b)** se revisan también, en un feature suyo posterior;
**(c)** se revisan **aquí**, ampliando F-043 a las cinco.
**Recomiendo (a)**, con (b) abierto. No recomiendo (c): duplicaría el alcance de
un feature que cuadrecaja espera antes de publicar la v13.

**AP4 — La cabecera de `docs/adr/0028-configuracion-de-compra-del-pos.md:3-5`
sigue diciendo «Propuesta · pasa a Aceptada cuando F-032 esté construido,
verificado y fusionado», y F-032 tiene `passes: true`.** Es la misma línea que
AD3 va a tocar.
Opciones: **(a)** se pasa a «Aceptada» en el mismo commit; **(b)** se deja como
está y se anota aparte.
**Recomiendo (a)**: el propio documento define el disparador y ya se cumplió.
Es de usted porque es el estado de una ADR suya, no una edición de prosa.
