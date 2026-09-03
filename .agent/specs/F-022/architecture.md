---
feature: F-022
agente: sdd-architect
actualizado: 2026-09-02T21:49:12Z
estado: listo
---

## Estado actual relevante

Lo que ya existe y se reutiliza **tal cual**, medido en el código de hoy:

| Pieza                                                                                                   | Qué aporta a F-022                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sync/server/handlers/store.ts:296` (`assertDeliveryConsistent`)                           | El **patrón exacto** del rechazo por evento: una guarda pura, llamada justo antes de la escritura que protege, que lanza `SyncEventFailure` |
| `src/features/sync/server/handlers/types.ts:66` (`SyncEventFailure`)                                    | Convierte una excepción en `failed[].error` + `SyncEvent.status = "FAILED"` sin tocar `src/features/sync/server/processBatch.ts`            |
| `src/features/sync/server/storeConfig.ts`                                                               | El precedente de «un módulo que traduce parte del `payload` a un `data` tipado», con su propio test                                         |
| `src/lib/cache.ts:69` (`cached`) y `src/features/catalog/server/queries.ts:169`                         | La lectura cacheada por tag de la tienda. `timezone` y `openingHours` entran **en el mismo `select`**: cero queries nuevas                  |
| `src/lib/storeClosure.ts:15`                                                                            | El aviso de cierre del interruptor. **No se toca**: R8 le da precedencia y los dos carteles nunca coexisten                                 |
| `src/features/admin/server/boundaries.test.ts:128` (`extractDataBlocks`) y `src/lib/boundaries.test.ts` | La técnica de guarda por patrón de texto, y el archivo repo-wide donde vive la de este feature                                              |
| `src/app/api/admin/_lib/respond.ts:55` (`writeResultToResponse`)                                        | El único sitio donde un `AdminWriteResult` se vuelve HTTP: ahí nace el `409 INVALID_TIMEZONE` de E5                                         |
| `src/features/sync/server/handlers/product.test.ts:117` (`PANEL_COLUMNS`)                               | La lista de los seis campos del panel, hoy duplicada como literal en un test                                                                |

Y lo que **no** existe: ninguna librería de fechas, ninguna aparición de
`Intl.DateTimeFormat`, ningún `TZ` fijado en `vitest.config.mts`, y ningún test
que lea `docs/sync-contract.md`.

### Tres hechos medidos en este ciclo que condicionan el diseño

1. **`process.env.TZ` sí se puede mutar en caliente** en Node 24.13.1:
   asignarlo cambia `new Date(...).getHours()` y
   `Intl.DateTimeFormat().resolvedOptions().timeZone` en la misma ejecución
   (comprobado con `UTC`, `Pacific/Kiritimati` y `America/Los_Angeles`). O sea
   que la opción (a) del criterio 2 —recorrer husos dentro del test— funciona y
   no hace falta el script de npm de la opción (b).
2. **Las ocho filas de la tabla del criterio 2 son correctas** contra este
   runtime: `formatToParts` con `en-US` y `hourCycle: "h23"` devuelve
   `Wed 10:00`, `Wed 00:30`, `Sun 00:30` (para los **dos** instantes del
   2026-11-01), `Sat 23:59` y `Sun 01:01`. `Intl.supportedValuesOf("timeZone")`
   da 418 valores e incluye `America/Havana`. ICU 78.2.
3. **No hay hueco dinámico posible en una página ISR con esta configuración de
   Next.** Es el hallazgo que abrió `AP1` y está medido abajo, en § «El cartel en
   la página».

## Decisión

Seis piezas, las seis cerradas: `AP1` y `AP2` están respondidas (§ «Preguntas
al humano, resueltas»).

1. **Un validador de zona IANA puro**, en src/lib/timezone.ts (por crear), con
   los tres pasos de R1 y **sin normalizar nada**. Es la puerta de publicación
   (R12) y el schema que reutilizará el editor de F-011 (AC9).
2. **Un solo módulo para el calendario**, src/lib/openingHours.ts (por crear),
   con **un solo schema de Zod** y **dos modos de uso**: `parse` estricto en el
   escritor, `safeParse` tolerante en el lector (R9). El evaluador vive en el
   mismo archivo y recibe su instante.
3. **El rechazo del calendario malformado va en el handler, no en el schema del
   `payload`** — con `SyncEventFailure(STORE_OPENING_HOURS_INVALID)`. Es lo
   único que produce lo que E10 y AC1 exigen verificar (evento en `failed`,
   `SyncEvent.status = "FAILED"`, ninguna columna cambiada); el schema produciría
   un `400 INVALID_BATCH` que **rechaza el lote entero y no escribe ninguna
   `SyncEvent`**. Ver § «El rechazo del calendario: por qué el handler y no el
   schema».
4. **La puerta de `PUBLISHED` es un predicado compartido** (`isCanonicalTimeZone`),
   llamado desde los dos archivos que escriben ese `status`, más una guarda de
   texto en `src/lib/boundaries.test.ts` que pone rojo a un cuarto escritor
   futuro que la olvide.
5. **La exhaustividad del criterio 4 es un test del proyecto `server`** que cruza
   `prisma/schema.prisma` contra `docs/sync-contract.md` en los dos sentidos, con
   la guarda de superconjunto contra los `ScalarFieldEnum` del cliente generado.
6. **El cartel pinta el horario de la semana desde el HTML cacheado, y no
   afirma ningún estado en vivo** (`AP1` = (b), respondida por el humano: «HTML
   cacheado, y la línea dice el horario»). No se vuelve dinámica ninguna ruta, no
   hay hueco dentro de `<Suspense>`, `src/app/[slug]/layout.tsx:19` no se toca y
   [ADR 0006] se queda como está. El trilema que se midió **se deshace por
   arriba**: si la página no afirma un estado instantáneo, no hay instante que
   calcular en ella, y el camino del comprador no necesita ni el reloj ni la zona
   para decidir nada.
7. **El evaluador se construye igual y en este ciclo no lo llama la interfaz.**
   `evaluateStoreHours` y su tipo de retorno se implementan y se prueban —el
   criterio 2 exige exactamente eso— y su consumidor de producción llega con
   F-011. Es una función exportada sin llamador de producción durante un ciclo, a
   propósito y por escrito (§ «El evaluador»).

### Alternativas descartadas

- **Un schema para escribir y otro para leer.** Descartada: las dos mitades de R9
  divergirían en la primera corrección de una regla, y el bug sería un calendario
  que el POS puede escribir y la vitrina no puede leer.
- **Validar el calendario en `storePayloadSchema`** (lo que la spec sugiere al
  citar `src/features/sync/schemas.ts:73-75`). Descartada por medición: ese camino
  responde `400 INVALID_BATCH` y **tira el lote completo** sin escribir ninguna
  `SyncEvent` (`src/app/api/internal/sync/catalog/route.ts:31-37`), así que el
  outbox del POS se atasca entero por un calendario y E10 no se puede verificar
  como está escrito.
- **`CHECK` en la columna `timezone`.** Descartada por la spec y confirmada aquí:
  ninguna restricción de base puede expresar «es un IANA que este runtime
  conoce», y un `CHECK (timezone <> '')` haría inverificable el criterio 1.
- **Un `Intl.DateTimeFormat` nuevo por evaluación.** Descartada por medición:
  23,4 µs por operación creando el formateador contra 0,9 µs reutilizándolo, 26×.
  Se cachea por zona en un `Map` de módulo, acotado por los 418 valores posibles.
- **Sacar el día de la semana con `getUTCDay()` sobre una fecha civil
  sintetizada.** Más robusta frente al locale, pero indistinguible de
  `getDay()` en una revisión y en un grep, que es justo lo que R2 prohíbe. Se usa
  la parte `weekday` de `formatToParts` con `en-US`, como manda la spec.
- **Bajar el `revalidate` del layout.** Descartada por la spec y, además,
  inservible: con ISR el primer visitante después del vencimiento recibe el HTML
  **rancio** y la regeneración va detrás, así que en una tienda con poco tráfico
  el desfase es el intervalo entre visitas, no el `revalidate`.
- **Calcular el cartel en el navegador.** Descartada por R5, y por el motivo de
  fondo: `new Date()` en el cliente da la hora del comprador, que es el error que
  este feature existe para arreglar.
- **El hueco dinámico dentro de `<Suspense>` que la spec fijó en SP5 = (a).**
  Descartada porque **no existe** en este Next sin migrar el modelo de caché de
  toda la app: está medido con builds reales en § «El cartel en la página».
- **Volver dinámica solo la portada de la tienda** (lo que este documento
  recomendaba antes de que el humano respondiera `AP1`). Descartada por su
  respuesta y por un hecho que la refuerza y que apareció después:
  `scripts/check-bundle-budget.mjs:81-89` **exige** que el build prerenderice al
  menos una portada de tienda y sale con código 1 si no la hay, así que la etapa
  `bundle` —y con ella el criterio 7— se habría puesto roja.
- **Un cartel de «hoy atiende de…» en el HTML cacheado.** Descartada por decisión
  del humano, y con razón: _qué día es hoy_ también depende del instante, así que
  en HTML cacheado hasta una hora acabaría nombrando el día equivocado. Se pinta
  la semana entera, que es el único texto que no caduca.

## Componentes

| Componente                 | Capa                       | Responsabilidad                                                                                                                                   | Archivo                                                                                |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Constantes del horario     | `src/constants/`           | `DEFAULT_STORE_TIMEZONE`, las siete claves de día, los topes y `"24:00"` (R13, magic strings)                                                     | src/constants/storeHours.ts (por crear)                                                |
| Validador de zona          | `src/lib/`                 | Los tres pasos de R1, el `Set` de zonas del runtime y el schema de Zod que reutiliza F-011                                                        | src/lib/timezone.ts (por crear)                                                        |
| Calendario y evaluador     | `src/lib/`                 | El schema estricto, el lector tolerante y `evaluateStoreHours`. Puro, sin Prisma, sin React                                                       | src/lib/openingHours.ts (por crear)                                                    |
| Códigos de error del cable | `src/constants/`           | `STORE_OPENING_HOURS_INVALID` y `STORE_TIMEZONE_INVALID`, junto al que ya está                                                                    | `src/constants/sync.ts`                                                                |
| Guarda del calendario      | `features/sync/server/`    | Función privada del handler que lanza `SyncEventFailure` antes de escribir                                                                        | `src/features/sync/server/handlers/store.ts`                                           |
| Puerta de publicación      | `features/*/server/`       | Dos llamadas al **mismo** predicado, una por escritor de `status: "PUBLISHED"`                                                                    | `src/features/sync/server/handlers/store.ts`, `src/features/admin/server/mutations.ts` |
| Guarda de la puerta        | test                       | Todo archivo con una escritura de `PUBLISHED` menciona el predicado, o el test falla                                                              | `src/lib/boundaries.test.ts`                                                           |
| Guarda A5 del evaluador    | test                       | Ninguna vista (`src/app/`, `src/components/`) menciona `evaluateStoreHours`: el instante no vuelve a la vitrina por la puerta de atrás            | `src/lib/boundaries.test.ts`                                                           |
| Lectura cacheada           | `features/catalog/server/` | `timezone` y `openingHours` en el `select` de `loadStore` y en `StoreSummary`. Cero queries nuevas                                                | `src/features/catalog/server/queries.ts`                                               |
| Cartel (presentación)      | `components/store/`        | Pinta un `WeeklyScheduleDay[]`: las siete filas del horario. Server component, sin estado, sin eventos, sin instante. Redacción de `sdd-designer` | src/components/store/StoreHoursNotice.tsx (por crear)                                  |
| Cartel (composición)       | `src/app/`                 | Llama a `readWeeklySchedule` y pasa las siete filas al cartel. Ningún instante                                                                    | `src/app/[slug]/page.tsx`                                                              |
| Exhaustividad de la tabla  | test                       | Cruza el schema contra el contrato en los dos sentidos                                                                                            | src/features/sync/fieldOwnership.test.ts (por crear)                                   |
| Lista del panel            | `src/constants/`           | `PANEL_PRODUCT_COLUMNS`, una sola fuente para el tipo, el test del sync y el del contrato                                                         | `src/constants/admin.ts`                                                               |

## Contratos internos

### 1. La zona horaria — src/lib/timezone.ts (por crear)

```ts
/** Las 418 zonas que este runtime conoce, congeladas al cargar el módulo. */
export const SUPPORTED_TIME_ZONES: ReadonlySet<string>;

/**
 * R1 en tres pasos, en este orden y sin normalizar nada:
 *   1. forma:  /^[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2}$/
 *   2. pertenencia a SUPPORTED_TIME_ZONES, SENSIBLE A MAYÚSCULAS
 *   3. usabilidad: new Intl.DateTimeFormat("en-US", { timeZone: value }) no lanza
 * Nada de toLowerCase() ni trim(): normalizar aceptaría "america/havana".
 */
export function isCanonicalTimeZone(value: unknown): value is string;

/** Para el editor de F-011 (AC9) y para cualquier body del panel. */
export const canonicalTimeZoneSchema: z.ZodType<string>;
```

`isCanonicalTimeZone` **es** la puerta de publicación de R12: no hay un segundo
nombre para lo mismo, y es el identificador que la guarda de texto busca.

El paso 3 es redundante con el 2 en este runtime y se queda igual: es lo que
convierte un ICU recortado en un `false` en vez de en una excepción en medio de
un `UPDATE`. Coste: 0,3 µs amortizado (una construcción de formateador solo en el
camino que ya pasó los pasos 1 y 2, que en producción se ejecuta una vez por
publicación).

### 2. El calendario — src/lib/openingHours.ts (por crear)

**Un solo schema, dos modos.** Es la respuesta a R9 sin duplicar reglas:

```ts
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type OpeningWindow = { from: string; to: string };
export type OpeningHours = { version: 1; days: Record<DayKey, OpeningWindow[]> };

/** ESTRICTO (`.strict()` en los dos niveles). Lo usa el escritor del sync. */
export const openingHoursSchema: z.ZodType<OpeningHours>;

/**
 * TOLERANTE (R9, E12): `safeParse` del mismo schema. `null` cuando el valor no
 * cumple —formato viejo, `version` desconocida, basura escrita a mano— y
 * entonces deja UN `console.warn("[hours] ...")` con el motivo, nunca el JSON
 * entero y nunca `console.error` (AGENTS.md § Cosas que muerden).
 * `value == null` devuelve `null` SIN avisar: es el estado normal de hoy (E8).
 */
export function parseOpeningHours(value: unknown): OpeningHours | null;
```

Reglas que el schema comprueba, cada una por separado y con su propio caso de
test:

| Regla                   | Cómo se expresa                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `version`               | `z.literal(OPENING_HOURS_VERSION)` — un valor distinto se rechaza al escribir y no se evalúa al leer                     |
| Siete días exactos      | `z.object({ mon: …, tue: …, … }).strict()`: las siete claves son requeridas y una clave extra es un `issue`              |
| 0–4 ventanas por día    | `z.array(windowSchema).max(OPENING_HOURS_MAX_WINDOWS_PER_DAY)`; `[]` es válido y significa cerrado                       |
| `from`                  | `/^([01]\d\|2[0-3]):[0-5]\d$/`                                                                                           |
| `to`                    | el mismo patrón **o** el literal `"24:00"` (`END_OF_DAY`)                                                                |
| `from != to`            | `refine` de la ventana: longitud cero es ambiguo y se rechaza                                                            |
| Orden y solape          | `superRefine` del array: `from` estrictamente creciente y `from[i] >= to[i-1]` en minutos                                |
| Un solo cruce, al final | `superRefine`: para todo `i` que no sea el último, `to[i] > from[i]`                                                     |
| Claves desconocidas     | `.strict()` en la ventana, en `days` y en la raíz: un `{"lunes": "9-6"}` o un `"tz"` dan error, no silencio              |
| Tamaño                  | `refine` de la raíz: `JSON.stringify(value).length <= OPENING_HOURS_MAX_CHARS` (2048). ASCII, así que caracteres = bytes |

**Qué pasa al leer una columna con basura antigua** (la pregunta 3 del ciclo):
`parseOpeningHours` devuelve `null`, y con él `readWeeklySchedule` —que es lo
único que la vitrina llama—, así que la página no pinta cartel y queda una línea
`[hours] ...` en el log del servidor. (`evaluateStoreHours`, que en este ciclo
solo llaman sus pruebas, devuelve `{ state: "unknown" }` por el mismo camino.) No hay migración de datos y no hace falta:
hoy **todas** las filas tienen `NULL` (el seed no escribe la columna y no existe
ningún fixture que la ponga), así que el camino tolerante existe para la fila
escrita a mano y para el `version: 2` de mañana, no para un parque de datos.

### 3. El evaluador — su firma, y por qué se construye sin llamador

**No es el contrato con `sdd-designer`** (ese es el punto 4): con `AP1` = (b)
nada del camino del comprador necesita el instante. El evaluador se construye
igual porque el criterio 2 lo exige —«con el reloj del proceso en otro huso
(TZ=UTC), el cálculo de abierto/cerrado coincide con la hora local de la
tienda»— y porque es lo que F-011 va a consumir cuando el panel muestre el
estado en vivo al negocio.

```ts
export type StoreHoursStatus =
  | { state: "unknown" }
  | { state: "open"; closesAt: string; closesNextDay: boolean }
  | { state: "closed"; next: { at: string; day: DayKey; inDays: number } | null };

/**
 * R6: puro. No llama a Date.now(); el instante entra por parámetro.
 * `timezone` y `hours` entran CRUDOS, tal como salen de la fila: el evaluador
 * es el único que sabe interpretarlos, y ninguna vista rehace el cálculo.
 */
export function evaluateStoreHours(input: {
  hours: unknown;
  timezone: string | null;
  now: Date;
}): StoreHoursStatus;
```

Semántica de cada campo, para que la redacción no tenga que inferir nada:

- `state: "unknown"` — no hay horario, o no se puede interpretar, o la zona no la
  conoce este runtime. **La página no pinta cartel** (E8, E12).
- `state: "open"` — `closesAt` es hora de pared de la tienda (`"18:00"`, y
  `"24:00"` cuando la ventana llega al final del día). `closesNextDay` es `true`
  solo cuando la ventana abierta cruza la medianoche y todavía no ha pasado
  («cierra a las 02:00», pero mañana).
- `state: "closed"` con `next` — `at` es la hora de pared de la próxima
  apertura, `day` la clave del día en que abre, e `inDays` cuántos días de
  calendario faltan: **`0` es hoy, `1` es mañana, `2..6` es ese día de la semana
  que viene, `7` es el mismo día de la semana la semana próxima**. Se busca 7
  días hacia delante, así que `inDays` nunca pasa de 7.
- `state: "closed"` con `next: null` — el calendario nunca abre (los siete días
  en `[]`, que es un calendario válido).

Nada de instantes absolutos, nada de desplazamientos y nada de duraciones: es
R10, y es lo que hace que el horario de verano deje de ser aritmética.

**Algoritmo**, con las dos trampas que la spec midió escritas donde se ejecutan:

1. Hora de pared: un `Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })`
   **cacheado por zona** en un `Map` de módulo, y `formatToParts`. La clave del
   día sale de la parte `weekday` en minúsculas (`Wed` → `wed`), que con el
   locale fijado es estable. `hourCycle: "h23"` y no `hour12: false`: con el
   segundo, según la versión de ICU, la medianoche puede salir `24:00`.
2. Ventana de hoy que no cruza (`to > from`): abierto si `from <= m < to`.
3. Ventana de hoy que cruza (`to < from`): abierto si `m >= from`, con
   `closesNextDay: true`.
4. **Ventana de ayer que cruza**: abierto si `m < to` de la última ventana del día
   anterior —índice `(hoy + 6) % 7`—, con `closesNextDay: false`. Sin este paso,
   las 00:30 de un miércoles con el martes cerrando a las 02:00 dan cerrado, que
   es el bug de E6.
5. Si no hay ventana activa, la próxima apertura: `d = 0..7`, día
   `(hoy + d) % 7`, primera ventana con `d > 0` o `from > m`.

`"24:00"` se normaliza a 1440 minutos solo dentro del evaluador; nunca se
reescribe en la columna.

**La incomodidad, escrita**: en este ciclo `evaluateStoreHours` es una función
exportada **sin llamador de producción**. Sus únicos consumidores son sus
pruebas. Eso está decidido por el humano y no se disimula con un uso inventado
en la vitrina, que es la tentación obvia y la que reintroduciría el instante en
una página cacheada.

Qué dicen el `lint` y el arnés sobre eso, comprobado y no supuesto:

- `@typescript-eslint/no-unused-vars` (`eslint.config.mjs:25-32`) cubre
  variables, argumentos y `catch`, **no exports sin consumir**: no hay regla que
  se dispare.
- No hay `knip`, `ts-prune`, `depcheck` ni nada equivalente en `package.json`, y
  ninguna de las nueve etapas de `verify.sh` busca código muerto: son `harness`,
  `typecheck`, `lint`, `format`, `test`, `prisma`, `build`, `theme` y `bundle`.
- La cobertura no queda hueca: `vitest.config.mts:28` incluye `src/lib/**` y el
  test de tabla del criterio 2 ejercita el módulo entero.
- Lo que **no** se hace: marcarla `@internal`, moverla a un archivo de test, ni
  dejarla sin exportar. Tiene que ser importable desde `src/lib/` para que F-011
  no escriba un segundo evaluador, que es justo lo que R6 prohíbe.

**Y una guarda, porque «sin llamador» no es lo mismo que «a salvo»** (A5 de
`sdd-designer`, incorporada): `evaluateStoreHours` es exactamente la función que
alguien va a enchufar el día que quiera «resaltar el día de hoy» o «poner un
puntito verde», y hacerlo desde una vista significa meter el instante en
`/[slug]` —que la vuelve dinámica y tira por tierra `AP1` sin que ningún test
unitario proteste—. Un `it` nuevo en `src/lib/boundaries.test.ts`, con la misma
técnica de patrón de texto que los tres que ya viven ahí: **ningún archivo bajo
`src/app/` ni bajo `src/components/` menciona el identificador
`evaluateStoreHours`** (excluidos `src/generated/` y los `*.test.*`, como en el
resto del archivo). Es barata, se lee sola y falla en `npm test`, o sea mucho
antes que la etapa `bundle`, que solo lo pescaría en un `--full`.

Cuando F-011 traiga su consumidor, ese consumidor vivirá en el panel
(`src/features/admin/`), que **no** está en el ámbito de la guarda: el `it` no
hay que relajarlo para que F-011 avance. Y el día que el producto quiera de
verdad el estado en vivo en la vitrina, el que quiera hacerlo se encontrará
primero este test y detrás la resolución de `AP1`, que es exactamente el orden en
que hay que leerlo.

### 4. Lo que la interfaz recibe: el horario de la semana

Este **sí** es el contrato con `sdd-designer`, y es el único dato que el cartel
recibe:

```ts
export type WeeklyScheduleDay = { day: DayKey; windows: OpeningWindow[] };

/**
 * Lo que la página pasa al cartel. Tolerante (R9): `null` cuando no hay horario
 * o no se puede interpretar, y entonces NO se pinta nada (E8, E12). Cuando
 * devuelve valor, son SIEMPRE siete entradas en orden mon→sun, tomado de
 * OPENING_HOURS_DAY_KEYS: `windows: []` es «cerrado ese día».
 */
export function readWeeklySchedule(value: unknown): WeeklyScheduleDay[] | null;
```

Por qué existe esta función en vez de que el componente recorra `hours.days`
directamente: el orden de las claves de un objeto que ha pasado por
`JSON.stringify`/`parse` —y `openingHours` pasa por ahí dos veces, en la columna
`Json` y en el `unstable_cache`— es el de inserción del POS, que puede empezar en
domingo. El orden de los días de la semana se decide **una vez**, en la
constante, y no en siete sitios de la vista.

Lo que llega al componente y lo que no:

- Llega `"24:00"` tal cual en un `to`; cómo se redacta «hasta el final del día»
  es de `sdd-designer`.
- Llega la ventana `22:00 → 02:00` tal cual, en el día en que **abre**; la
  redacción del cruce de medianoche también es suya.
- **No** llega la hora actual, ni el día actual, ni ningún estado
  abierto/cerrado: el HTML es cacheado y no puede afirmar nada de eso (`AP1`).
- **No** hay `fallback` que diseñar: sin hueco dinámico no hay `<Suspense>` ni
  estado de carga.
- R11 sigue en pie y es más fácil de cumplir que antes: sin «abierto/cerrado» en
  el texto, no hay forma de chocar con el «Abierta»/«Cerrada ahora» que
  `src/components/store/BranchCard.tsx:20-25` ya usa para `status`.

**Si la redacción pide 12 horas, eso es aritmética sobre la cadena declarada, no
`Intl`.** Importa decirlo aquí porque el módulo cachea un `Intl.DateTimeFormat`
por zona y la tentación de reutilizarlo es inmediata: **ese formateador existe
para una sola cosa, sacar la hora de pared de un instante, y en este ciclo solo
lo usan las pruebas del evaluador**. Un `from`/`to` **no es un instante**: es una
cadena `HH:MM` que el negocio declaró, sin fecha y sin zona. Pasarla por `Intl`
obligaría a inventar un día y un huso para volver a sacar la misma cadena —y a
meter un instante en el camino del comprador, justo lo que `AP1` quita—. Se parte
por `:`, se convierten dos enteros y se compone el texto. Los cinco bordes que
`sdd-designer` enumeró y que una división ingenua entre 12 se come, para que
quien lo implemente los tenga a mano: `00:00` → `12:00 a.m.`, `12:00` →
`12:00 p.m.`, `12:30` → `12:30 p.m.`, `00:30` → `12:30 a.m.`, y `"24:00"`, que
**nunca se imprime como hora** sino con la palabra que el diseño haya elegido
para el final del día. La forma exacta del texto es de `sdd-designer`; lo que
este documento fija es de dónde **no** puede salir.

### 5. La puerta de `PUBLISHED`

Se **centraliza en el predicado** y se **repite la llamada**, una por escritor.
No hay un helper que envuelva la escritura porque los dos escritores fallan de
formas incompatibles: uno lanza para que el lote lo reporte `failed`, el otro
devuelve un `AdminWriteResult` que `writeResultToResponse` vuelve un 409.

**En `src/features/sync/server/handlers/store.ts`**, dos sitios y un `select` que
crece sin costar nada:

- `existing` (líneas 71-96) gana `timezone: true`. Cero queries nuevas: ya lee la
  fila.
- Camino de crear (`:187-202`): la fila todavía no existe, así que el valor que se
  va a publicar es el default de la columna. Se valida `DEFAULT_STORE_TIMEZONE`.
  Es una comprobación de constante, y el test del caso límite 1 —el default está
  en `Intl.supportedValuesOf("timeZone")`— es lo que la mantiene honesta.
- Camino de republicar (`:222-244`): se valida `existing.timezone` **solo cuando
  `optInChanged`**, o sea solo cuando el `data` va a llevar
  `status: "PUBLISHED"`. Un evento rutinario (un teléfono nuevo) sobre una tienda
  ya publicada con una zona ilegible **no falla**: no toca `status`, igual que
  `assertDeliveryConsistent` no falla cuando el `payload` no toca la tríada.
- Falla con `throw new SyncEventFailure(STORE_TIMEZONE_INVALID)`, **antes** de la
  escritura y **después** de los `SKIPPED`/`STALE`, en el mismo sitio donde ya se
  llama a `assertDeliveryConsistent`.

**En `src/features/admin/server/mutations.ts`** (`setStoreEnabled`, `:394`):

- La rama `body.enabled` gana **una** lectura previa
  (`prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } })`)
  y devuelve `{ kind: "invalid_timezone" }` si el predicado dice `false`. La rama
  de cerrar **no lee nada** y sigue igual: una zona ilegible nunca puede impedir
  cerrar una tienda (E5).
- `PanelStoreWrite` (`:61-62`) **no cambia**: el panel sigue sin escribir
  `timezone`, así que la lista blanca de [ADR 0017] (a) se queda tal cual.
- `src/features/admin/types.ts` gana `| { kind: "invalid_timezone" }` y
  `src/app/api/admin/_lib/respond.ts` la fila
  `409 {"error":"INVALID_TIMEZONE"}`. Con eso E5 sale exacto, y el `switch` de
  `writeResultToResponse` deja de compilar hasta que se añada el caso.

**Cómo se evita el cuarto escritor** que la olvide: un `it` nuevo en
`src/lib/boundaries.test.ts` recorre `src/` (sin `src/generated/`, sin tests) y
exige que **todo archivo con una línea que case `/status:\s*"PUBLISHED"/` y que no
contenga `|` en esa misma línea** mencione también `isCanonicalTimeZone`. Medido
hoy: seis archivos no-test contienen el literal; el filtro del `|` descarta los
cuatro que lo declaran como **tipo**
(`src/features/storefront/server/resolve.ts:28`,
`src/features/admin/server/branding.ts:34`,
`src/features/admin/components/StoreBrandCard.tsx:21` y `:27`), y queda una
excepción explícita y comentada: `src/features/catalog/server/queries.ts:222`, que
lo usa como **filtro de lectura** (`where`), no como escritura. Los otros dos son
los dos escritores. Un quinto archivo que escriba `PUBLISHED` se pone rojo con un
mensaje que dice qué hacer, que es la mitad del valor de la ficha
`boundaries-guard-cruzado-por-patron-de-texto`.

### 6. El rechazo del calendario: por qué el handler y no el schema

La spec dice «en el mismo sitio y con la misma forma que el
`STORE_DELIVERY_CONFIG_INCONSISTENT` de hoy (`src/features/sync/schemas.ts:73-75`)»
y, dos párrafos después, que se verifica comprobando que **el evento vuelve
fallido, nunca en `ok`**. Las dos cosas no pueden ser verdad a la vez, y el
código dice por qué: `src/app/api/internal/sync/catalog/route.ts:31-37` corre
`catalogBatchSchema.safeParse(body)` **antes** de `processCatalogBatch`, así que
cualquier `issue` del schema responde `400 INVALID_BATCH`, **tira los otros 499
eventos del lote** y no deja escrita ni una `SyncEvent` —el contrato lo dice con
esas palabras en su § Vocabulario de errores—. No hay evento fallido que
reportar porque no hay evento.

Resolución: el calendario se valida **en el handler**, con la misma forma que la
otra mitad del precedente —la del `207 failed[]`, que ya existe para el mismo
invariante de envío—:

```ts
// src/features/sync/server/handlers/store.ts, privada, junto a assertDeliveryConsistent
function assertOpeningHoursValid(value: unknown): void {
  if (value == null) return; // ausente o null: la columna queda intacta (caso 9)
  if (!openingHoursSchema.safeParse(value).success) {
    throw new SyncEventFailure(STORE_OPENING_HOURS_INVALID);
  }
}
```

Se llama **una vez**, justo después de construir `common` (`:160-174`) y antes de
las dos escrituras que lo aplican. Consecuencias, todas deliberadas:

- El evento vuelve en `failed[]` con el nombre de la constante,
  `SyncEvent.status = "FAILED"`, y **ninguna** columna cambia: ni `openingHours`,
  ni el `name`, ni el `phone` que viajaban con él (E10, caso 11, la consecuencia
  que el humano aceptó).
- Los demás eventos del lote **sí** se aplican. Eso es estrictamente mejor que lo
  que la spec describía y no contradice ninguna de sus reglas.
- El camino de despublicar (`publishToStore: false`, `:119-158`) **no** valida: no
  escribe `common`, así que no escribe el calendario. Misma doctrina que
  `assertDeliveryConsistent`, que no falla cuando el `config` no toca la tríada.
  Queda escrito en el contrato para que el POS no se sorprenda.
- `storePayloadSchema.openingHours` **se queda en `z.unknown().nullish()`** y
  `src/features/sync/server/handlers/store.ts:173` **no cambia una línea**: el
  valor que se escribe ya pasó por el schema estricto.

## Flujo de datos

**Camino A — el POS publica un calendario.** `POST /api/internal/sync/catalog`
→ `catalogBatchSchema` (el calendario pasa como `unknown`) → `recordBatch` →
`handleStore` → guardas `sourceUpdatedAt`/opt-in → `assertOpeningHoursValid` →
`isCanonicalTimeZone` si el `data` va a llevar `PUBLISHED` → un solo `UPDATE`
→ `processBatch` revalida `store:<slug>` con los tags que ya usa. Round-trips
contra Postgres: **los mismos que hoy**.

**Camino B — el POS manda un calendario roto.** Igual hasta
`assertOpeningHoursValid`, que lanza. `processBatch.ts:84-88` lo convierte en
`failed[]` + `markFailed`. Escrituras: cero. Revalidaciones: cero.

**Camino C — el administrador reabre.** `PATCH /api/admin/stores/{id}/status`
con `{"enabled": true}` → `setStoreEnabled` → lectura de `timezone` →
`isCanonicalTimeZone` → 409 `INVALID_TIMEZONE` y `status` intacto, o el `UPDATE`
de siempre. Con `{"enabled": false}`: exactamente el camino de hoy, sin lectura
nueva.

**Camino D — el comprador abre la tienda.** `requireResolution(slug)` (cacheado)
→ `requireStore` (cacheado, ahora con `openingHours` y `timezone` en el mismo
`select`) → si `status !== "PUBLISHED"`, el aviso del interruptor y **nada de
horario** (R8, E9) → si hay horario, `readWeeklySchedule(store.openingHours)` →
el cartel con las siete filas. **Ningún instante entra en este camino**: la
página sigue siendo la misma para todo visitante y para toda hora, que es lo que
la deja prerenderizable (`AP1` = (b)). Round-trips contra Postgres: **los mismos
que hoy**; JavaScript de cliente: **0 bytes nuevos**.

## Contratos externos: la v9 del contrato

**Confirmo v9, mayor**, y con un argumento más fuerte del que la spec tenía: la
§ Versionado del propio documento llama mayor a «un endpoint, un campo, un enum,
**un código de error**, una regla de validación». Este feature trae **una regla de
validación nueva y dos códigos de error nuevos**, así que sería mayor incluso sin
la regla. La tabla de propiedad, sola, seguiría siendo menor.

Secciones exactas que se tocan en `docs/sync-contract.md`:

| Sección                                                   | Qué se hace                                                                                                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Línea 3                                                   | `**Versión 9** · <fecha>`. El hook `.claude/hooks/sync-contract-version.sh` avisa si no se mueve                                                                                                                        |
| Nueva `## Cambios respecto a la v8`, antes de la de la v7 | Los cinco puntos que la spec enumera, en ese orden. El documento va en orden descendente: la nueva entra justo después de § Versionado                                                                                  |
| `### Vocabulario de errores`                              | Pasa a `(v9)` y gana **dos** filas de `207 failed[]`: `STORE_OPENING_HOURS_INVALID` y `STORE_TIMEZONE_INVALID`. **Ninguna fila de `400`**: el rechazo es por evento, no por lote                                        |
| `#### payload de STORE`                                   | La línea `openingHours` del ejemplo pasa a llevar el objeto real, y debajo un bloque con la forma completa, las siete claves, `[]`, `24:00` y el cruce `22:00 → 02:00`                                                  |
| `##### Tabla de propiedad de campos`                      | Se retitula (deja de ser «semilla») y las cinco filas se sustituyen por **dos tablas de 31 y 23 filas**, conservando literal el texto «cuadrecaja (desde v7)» de las cinco de F-032, más la línea de R4 sobre el umbral |
| `## Cambios requeridos en cuadrecaja`                     | Subsección nueva `### De la v9 (F-022)`: si mandas calendario, mándalo con esta forma; si no lo mandas, no cambies nada                                                                                                 |

Las 54 filas de la tabla se copian de la spec § «La tabla de propiedad de
campos», que ya las trae escritas y verificadas contra el schema. Dos números
medidos otra vez aquí con el parser del test: `Store` 30 columnas (31 con
`timezone`), `StoreProduct` 23, `Storefront` 12.

**Antes de publicar la v9 hay que avisar al equipo de cuadrecaja**
(AGENTS.md § Documentación), y lo que necesitan leer primero es la frase
incómoda: un evento `STORE` con calendario malformado no aplica **ninguno** de
sus campos.

## Modelo de datos y migraciones

En `prisma/schema.prisma`, `model Store`, junto a `openingHours` (`:258`) porque
se leen juntas:

```prisma
/// F-022 R1: IANA canónico, del PANEL. El POS no la manda y una clave
/// `timezone` en el payload de STORE se descarta sin error (E11).
timezone String @default("America/Havana")
```

SQL exacto de la migración —el nombre lo pone `migrate dev`, la forma es esta:

```sql
-- prisma/migrations/<timestamp>_store_timezone/migration.sql
ALTER TABLE "Store" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Havana';
```

- **Backfill: ninguno, el default lo es.** En Postgres 11+ un `ADD COLUMN` con
  `NOT NULL` y un default **constante** no reescribe la tabla: el valor se guarda
  en el catálogo (`attmissingval`) y las filas existentes lo materializan al
  escribirse. Es una operación de metadatos, con un `ACCESS EXCLUSIVE` de
  milisegundos, independiente del número de filas. La base de este stack es
  Postgres 14+.
- **¿Puede perder datos? No.** Es puramente aditiva: no borra columnas, no borra
  filas, no reescribe valores, y no necesita ninguno de los dos comandos que
  `AGENTS.md` prohíbe (`migrate reset`, `db push`). Esto es lo que hay que
  llevarle al humano con esa respuesta.
- **Reversible: sí, a mano.** Prisma no genera migraciones de bajada; la vuelta
  atrás es `ALTER TABLE "Store" DROP COLUMN "timezone";`. **Hoy** eso no pierde
  nada, porque todas las filas llevan el default. En cuanto exista el editor de
  F-011 sí perdería la zona de cada negocio, así que la reversibilidad tiene
  fecha de caducidad y conviene que quede escrita.
- **Antes de aplicar: leer el `migration.sql` generado y quitar los `DROP INDEX`
  de los cinco índices GIN y parciales no declarados** (ficha
  `prisma-migrate-dev-borra-indices-gin-no-declarados`,
  AGENTS.md § Cosas que muerden). `npx prisma validate` no los ve.
- **Ningún índice nuevo.** `timezone` no se filtra ni se ordena por ella: se lee
  siempre por la clave primaria o por `externalId`, en queries que ya existen.
- **R13, el default en tres sitios que no pueden divergir**: un test compara
  `DEFAULT_STORE_TIMEZONE` contra lo que dice `prisma/schema.prisma` (regex sobre
  la línea del campo) y contra lo que dice el `migration.sql` de esta migración
  (glob `prisma/migrations/*_store_timezone/migration.sql`), y además afirma que
  el valor está en `Intl.supportedValuesOf("timeZone")` y que esa lista tiene más
  de 300 entradas (caso límite 1: un ICU recortado pone rojo el CI en vez de
  mentir en producción).
- **`prisma/seed.ts`**: la tienda de demostración gana un `openingHours` con una
  ventana que cruza la medianoche, para que la etapa visual tenga qué mirar (caso
  límite 5). Va dentro del `upsert` que ya existe (`:754`), así que sigue siendo
  idempotente. No se escribe `timezone`: el default ya es el correcto.

Y el paso operativo que ningún sensor puede comprobar, a `docs/despliegue.md`
**en este mismo ciclo** (AGENTS.md § Documentación): mientras F-011 no tenga
editor, la zona de un negocio que no esté en el huso de La Habana **se cambia a
mano en la base** al darlo de alta, con un `UPDATE "Store" SET timezone = …`.

## El cartel en la página

### Lo que se midió, y por qué la respuesta fue (b)

La spec fijó SP5 = (a): «un hueco dinámico dentro de `<Suspense>`; el resto de
`/[slug]` sigue prerenderizado y cacheado, con su `revalidate` literal sin
tocar». **Eso no existe en este Next con esta configuración**, y está medido con
cuatro builds reales de Next 16.3.2 en un proyecto aislado:

| Prueba                                                                                            | Resultado                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Página con `export const revalidate = 3600` y un `<Suspense>` cuyo hijo hace `await connection()` | La ruta entera pasa a `ƒ (Dynamic)` y **desaparece su columna `Revalidate`**                                     |
| Lo mismo en un `layout`                                                                           | **Todas** las rutas hijas pasan a `ƒ`                                                                            |
| Lo mismo con `generateStaticParams`                                                               | Sigue `ƒ`: no se prerenderiza ningún parámetro                                                                   |
| `cacheComponents: true` (el PPR real de Next 16)                                                  | El build **falla**: «Route segment config "revalidate" is not compatible», y lo mismo con `export const dynamic` |

Sin `cacheComponents` no hay prerenderizado parcial: `<Suspense>` ordena el
streaming, no parte la caché. Y `cacheComponents` es incompatible con las **9**
apariciones de `export const revalidate` y las **45** de
`export const dynamic = "force-dynamic"` que hay hoy en `src/app/`, además de
contradecir a [ADR 0006], que decidió expresamente no adoptarlo. O sea: el
mecanismo que la spec da por hecho cuesta una migración de ~55 archivos y una ADR
que supere la 0006. No es F-022.

Con eso, quedaba un trilema del que solo se podían tener dos esquinas:

1. el cartel dice la verdad **en el instante de la petición**;
2. el HTML de la tienda sigue **cacheado** (CDN + ISR);
3. **cero JavaScript de cliente**.

**El humano soltó la primera** (`AP1` = (b)): «HTML cacheado, y la línea dice el
horario». Y con la decisión de pintar **la semana** en vez de «hoy», el trilema
no se resuelve: **desaparece**. Un texto que no afirma nada sobre el ahora —ni
siquiera qué día es hoy— no tiene instante que calcular, así que no necesita
salir de la caché para decir la verdad. La página se queda exactamente como
estaba.

Y un dato más, que apareció después de plantear la pregunta y que refuerza la
respuesta: **`scripts/check-bundle-budget.mjs:81-89` exige que el build
prerenderice al menos una portada de tienda** y sale con código 1 si no la
encuentra («No store page was prerendered»). O sea que volver dinámica
`src/app/[slug]/page.tsx` —la opción que este documento recomendaba— habría
puesto **roja la etapa `bundle`**, y con ella el criterio 7, que exige
`bash .agent/verify.sh F-022 --full` en 0. La opción costaba más de lo que
parecía, y ninguna de las dos mediciones por separado lo mostraba: hacía falta
mirar el guion del presupuesto, no solo el `build`.

Qué se prerenderiza hoy, para dejar el punto de partida escrito: `/[slug]` está
prerenderizada de verdad (`compute: "static"`, `initialRevalidateSeconds: 3600`,
18 KB de HTML por tienda, 9 URLs de tienda en el build actual), junto a las
páginas de categoría y de producto; `src/app/[slug]/catalogo/page.tsx`, `buscar`,
`carrito`, `checkout`, `sucursales` y `pedido/[code]` **ya llevaban
`export const revalidate = 0`** antes de este feature. Después de F-022 **eso no
cambia en ninguna ruta**.

### Lo que se pinta, y lo que ya no hace falta construir

- El componente es **src/components/store/StoreHoursNotice.tsx (por crear)**,
  server component sin estado ni eventos (AGENTS.md prohíbe `"use client"` en el
  camino del catálogo), y su única prop es `{ schedule: WeeklyScheduleDay[] }`
  (§ Contratos internos, punto 4). La redacción, el sitio, el orden visual y el
  tono son de `sdd-designer`; el tipo de entrada es de este documento.
- Sin horario, o con un horario ilegible, `readWeeklySchedule` devuelve `null` y
  **no se pinta nada** (E8, E12). Ese es el estado de **todas** las filas de hoy.
- Precedencia: la rama `store.status !== "PUBLISHED"` de
  `src/app/[slug]/page.tsx:114` sigue devolviendo `StoreClosedNotice` y ahí no
  entra el horario (R8, E9). El cartel solo aparece en la rama publicada.
- `src/components/store/BranchCard.tsx`, `src/components/store/BranchBar.tsx` y
  `src/features/admin/components/StoreList.tsx` **no se tocan**: sus «Abierta» y
  «Cerrada ahora» siguen significando `status` (I5). R11 se cumple casi por
  construcción, porque el cartel no habla de estados. Guarda barata y opcional:
  un `.test.tsx` que afirme que las cadenas del componente nuevo no contienen
  «Abierta» ni «Cerrada ahora».
- **Ya no hace falta**: ningún `<Suspense>`, ningún `fallback`, ningún
  `await connection()`, ningún `export const revalidate` nuevo, y ningún
  componente que calcule el instante. `src/app/[slug]/layout.tsx:19` no se toca y
  [ADR 0006] se queda como está.
- El cartel **no** entra en el selector de marca ni en `BranchCard` en este
  feature. Coste si algún día entra: `src/features/storefront/server/resolve.ts`
  tendría que traer `openingHours` de cada sucursal en su `select` (cero queries
  nuevas, la query ya existe) y siete filas más de HTML por sucursal.
- **0 bytes de JavaScript nuevo.** `npm run check:bundle` no debe moverse; lo
  único que crece es el HTML de la portada, y está medido abajo.

### Lo que este camino deja sin cumplir, dicho sin maquillar

E13 de la spec —«dos peticiones a las 17:59 y a las 18:01 dicen cosas distintas
sin que nadie haya revalidado»— **no se cumple y no se puede cumplir** con
`AP1` = (b): su primera mitad describe justo la propiedad que el humano soltó. Su
**segunda** mitad sí se cumple, y con margen: el HTML alrededor sigue siendo el
prerenderizado, el `revalidate` literal está intacto y el JavaScript del
navegador no crece. R14 queda en la misma situación: sus dos **prohibiciones**
—no hacer dinámica la página entera, no meter el resultado en algo cacheado con
el resto de la tienda— se cumplen porque ya no hay resultado instantáneo que
meter en ningún sitio. Quien retome esto tiene que leerlo así, no como un
descuido.

## La exhaustividad del criterio 4

Un test del proyecto `server`, src/features/sync/fieldOwnership.test.ts (por
crear) — sin etapa nueva del sensor, sin script suelto: corre con `npm test`, que
es lo que `verify.sh` ya ejecuta.

Qué hace, y por qué así:

1. **Lee `prisma/schema.prisma`** y saca el cuerpo de `model Store` y
   `model StoreProduct`. Una línea es columna si casa `/^(\w+)\s+(\S+)/`, no
   empieza por `//` o `///`, no empieza por `@@`, y su tipo —sin `?` ni `[]`— no
   es uno de los `model` declarados en el archivo. **Probado ya contra el schema
   real**: da 30 / 23 / 12, exactamente los números de la spec, y **sí** incluye
   `searchVector` (su tipo es `Unsupported("tsvector")`, que no es un modelo) y
   las claves ajenas.
2. **Lee `docs/sync-contract.md`** y extrae el primer identificador entre
   comillas invertidas de cada fila de las dos tablas de propiedad.
3. **Afirma igualdad de conjuntos en los dos sentidos**, que ningún nombre
   aparece dos veces (R3: exactamente un dueño) y que las tres celdas de cada
   una de las 54 filas están rellenas.
4. **Guarda contra el falso verde**: el conjunto que sale del schema tiene que ser
   **superconjunto** de `StoreScalarFieldEnum` (30 claves, medido) y de
   `StoreProductScalarFieldEnum` (22 claves, medido — `searchVector` **no** está).
   Si la expresión regular se rompe y devuelve vacío, esta afirmación lo caza; y
   un chequeo basado solo en el cliente generado dejaría escapar `searchVector`
   en silencio, que es por lo que la fuente de verdad es el schema.
5. **Cruza `PANEL_PRODUCT_COLUMNS`** contra la columna «Dueño» de la tabla de
   `StoreProduct`: los seis campos marcados `panel` en el documento son
   exactamente los seis de la constante. Eso es lo que AC5 pide cuando dice que
   la lista del test y la del documento no pueden divergir sin que algo se ponga
   rojo. Para que haya **una** lista y no tres, `PANEL_PRODUCT_COLUMNS` se
   promueve a `src/constants/admin.ts`, el tipo `PanelProductColumn` de
   `src/features/admin/server/mutations.ts:57-58` se deriva de ella
   (`(typeof PANEL_PRODUCT_COLUMNS)[number]`) y el `PANEL_COLUMNS` literal de
   `src/features/sync/server/handlers/product.test.ts:117-124` la importa.

**Qué pasa cuando alguien añada una columna mañana**: `npm test` se pone rojo
nombrando la columna que falta en el contrato, y con eso la obliga a declarar
dueño **antes** de fusionar. La consecuencia hay que aceptarla a ojos abiertos y
queda escrita: **desde este feature, añadir una columna a `Store` o a
`StoreProduct` obliga a editar `docs/sync-contract.md`, y toda edición de ese
fichero mueve su versión** (una menor basta si solo se documenta un dueño nuevo).
Es exactamente el acoplamiento que el criterio 4 pide; sin él, la tabla vuelve a
quedar rancia en el primer feature que añada un campo.

## Escalabilidad y límites

Números, no adjetivos:

- **Round-trips contra Postgres.** Camino del comprador: **los mismos que hoy**
  (`timezone` y `openingHours` viajan en el `select` que ya se hace). Camino del
  sync: **los mismos** (`timezone` entra en el `findUnique` que ya se hace).
  Camino del panel: **+1** lectura, solo en la rama de **reabrir**.
- **Coste del evaluador.** 0,9 µs por evaluación con el formateador cacheado por
  zona; 23,4 µs si se construye cada vez (26×, medido). El `Map` de formateadores
  está acotado por las zonas distintas en uso, con 418 posibles y 1 real en la
  práctica: unos pocos KB de heap por proceso. En este ciclo ese coste solo lo
  pagan las pruebas: la vitrina no evalúa nada.
- **Coste del cartel en la vitrina.** Cero cómputo digno de mención:
  `readWeeklySchedule` es un `safeParse` de ≤ 2 KB más siete accesos a un objeto,
  y ocurre una vez por render de portada, o sea ~1 vez por tienda y por hora
  mientras el ISR aguante.
- **100× tiendas.** Nada de esto crece con el catálogo ni con las tiendas: el
  cartel se resuelve dentro del render que ya se hacía, con los datos que ya se
  leían. 100 tiendas siguen siendo ~100 renders de portada por hora en el peor
  caso, exactamente como antes de F-022.
- **Tamaño del calendario y del HTML.** ≤ 2 KB serializado por tienda, tope del
  schema. 100× tiendas son ≤ 200 KB en la columna `Json`; `openingHours` viaja
  dentro del `StoreSummary` cacheado (+2 KB por entrada) y el cartel añade siete
  filas al HTML de la portada —del orden de 0,3 KB antes de comprimir, sobre los
  18 KB gzip que mide hoy `scripts/check-bundle-budget.mjs`—. Es lo único que
  crece en el camino del comprador, y es lo que el guion mide como «HTML: … this
  is what decides first paint».
- **JavaScript de cliente: 0 bytes nuevos.**
- **Lo que se rompe primero.** No es el evaluador ni la caché —ninguno de los dos
  cambia—: es el **contrato**, el día que alguien añada una columna a `Store` o a
  `StoreProduct` y el test de exhaustividad se ponga rojo. Eso es deliberado
  (§ La exhaustividad del criterio 4).
- **El proyecto `db` de Vitest corre en serie** (`fileParallelism: false`,
  `vitest.config.mts:82`) y ya tiene 10 archivos: el `*.db.test.ts` nuevo de AC1
  suma su tiempo al total, no lo solapa.

## Patrones a seguir / antipatrones a evitar

- **`console.warn("[hours] …")`, nunca `console.error`** (AGENTS.md § Cosas que
  muerden, ficha `console-error-dispara-guardian-servidor`): cualquier etapa que
  lea la salida de `next dev` marcaría el servidor como caído.
- **`export const revalidate` es un literal** (ficha `revalidate-no-literal`,
  [ADR 0006]): este feature **no añade ni cambia ninguno**, y si alguien lo hace
  algún día, va como número y nunca como constante importada.
- **El `matcher` de `src/proxy.ts` no toca `/[slug]`** y este feature no lo roza.
  El `it` que ya lo vigila está en `src/features/account/boundaries.test.ts:105`.
- **Sin `any`, sin magic strings**: todo lo que se repita —el default, las siete
  claves, los topes, los dos códigos de error— sale de `src/constants/`.
- **Nada de `getHours()`, `getDay()`, `toLocaleString()` sin `timeZone`, ni
  sumar/restar desplazamientos** (R2). La única fuente de hora local es
  `formatToParts` con `timeZone`.
- **Nada de `toLowerCase()` ni `trim()` antes de comprobar la pertenencia de la
  zona** (R1). Va escrito como comentario en el código, no solo aquí.
- **Idempotencia y guarda anti-rancia intactas**: el calendario se escribe por
  reemplazo completo y `sourceUpdatedAt` sigue siendo el único árbitro
  (caso límite 8).
- **Un archivo que todavía no existe se cita sin comillas invertidas y con «(por
  crear)»** (ficha `check-harness-falso-positivo-ruta-abreviada`, cinco
  reincidencias, dos de ellas en este mismo feature).
- **`npm run format` sobre lo que uno escribió** antes de dar la etapa por buena
  (ficha `prettier-sin-formatear`).

## Riesgos y plan B

| Riesgo                                                                                                                   | Plan B                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El runtime de producción trae un ICU recortado y `supportedValuesOf` devuelve pocas zonas: R1 rechazaría zonas legítimas | El test del caso límite 1 (>300 entradas y el default dentro) convierte el problema en un CI rojo en vez de un fallo en producción, más la comprobación única en un preview (`AP2`)                                                                                                                                                                                                                                |
| Alguien «mejora» el cartel poniéndole el estado en vivo                                                                  | La guarda A5 (`src/lib/boundaries.test.ts`) lo caza en `npm test` en cuanto una vista mencione `evaluateStoreHours`. La red de atrás, más lenta, es la etapa `bundle` en cuanto la portada deje de prerenderizarse (`scripts/check-bundle-budget.mjs:81-89`), pero esa **solo salta en un `--full`**; en la revisión, la señal es cualquier `connection()`, `cookies()` o `headers()` nuevo bajo `src/app/[slug]/` |
| `evaluateStoreHours` se queda sin llamador y alguien la borra por «código muerto»                                        | Su test es su documentación y su guarda; el motivo de que exista sin consumidor está escrito en § Contratos internos, punto 3, y F-011 la reclama                                                                                                                                                                                                                                                                  |
| Alguien «arregla» el rechazo del calendario moviéndolo al schema del `payload`                                           | Un test de `src/features/sync/schemas.test.ts` que afirme que un `openingHours` malformado **no** hace fallar el `safeParse` del lote                                                                                                                                                                                                                                                                              |
| El cruce de medianoche se implementa mirando solo el día de hoy                                                          | E6 está en la tabla del criterio 2 con dos filas que solo difieren en de qué día es la ventana. Es el bug clásico y ya tiene su caso                                                                                                                                                                                                                                                                               |
| El `migration.sql` se aplica con los `DROP INDEX` dentro                                                                 | Se recrean con el SQL de la ficha `prisma-migrate-dev-borra-indices-gin-no-declarados`; no rompe ningún test, así que hay que mirarlo a mano                                                                                                                                                                                                                                                                       |
| Dos relojes en el `*.db.test.ts` de la puerta                                                                            | El evaluador recibe su `now`, así que el riesgo se limita a comparar instantes de la fila: los dos extremos se leen de la **misma** fuente (fichas `db-test-cross-process-clock-skew`, `realtime-bell-close-clock-skew`)                                                                                                                                                                                           |

## ¿Hace falta una ADR?

**No para lo que este feature decide.** La propiedad de campos la fijan
[ADR 0007], [ADR 0017] y [ADR 0028], y este feature las **documenta** campo a
campo en el contrato sin contradecir ninguna. `Store.timezone` es del panel y el
panel no comparte columna con el sync, así que [ADR 0017] (a) se cumple tal cual.
El roce que I6 anota —`openingHours` es del sync y su editor está planificado en
el panel— **no lo resuelve F-022 y no le hace falta**, porque aquí no escribe
nadie: quien construya F-011 necesitará una columna de override con su
precedencia, y esa sí será una ADR.

**Tampoco hace falta tocar [ADR 0006]**, y esa es una consecuencia directa de
`AP1` = (b): no se vuelve dinámica ninguna ruta, no se baja ningún `revalidate` y
el modelo de ISR con revalidación por tag se queda exactamente como esa ADR lo
dejó.

La ADR que sí haría falta algún día está identificada, con su coste medido, para
que quien la escriba no repita el trabajo: si en el futuro el producto quiere el
estado **en vivo** en la vitrina, la única forma es `cacheComponents: true`, y eso
es una ADR que supera a la 0006 y cambia el modelo de caché de toda la app (9
`export const revalidate`, 45 `export const dynamic`, 6 llamadas a `cached()`
detrás de un solo embudo en `src/lib/cache.ts`). Título propuesto para cuando
llegue: «Cache Components y prerenderizado parcial». No es de este ciclo y no se
deja borrador.

## Archivos: qué se crea y qué se toca

**Se crea** (sin comillas invertidas hasta que existan):

| Ruta                                                          | Qué es                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/constants/storeHours.ts                                   | `DEFAULT_STORE_TIMEZONE`, `OPENING_HOURS_VERSION`, `OPENING_HOURS_DAY_KEYS`, `OPENING_HOURS_MAX_WINDOWS_PER_DAY`, `OPENING_HOURS_MAX_CHARS`, `END_OF_DAY`, `STORE_TIMEZONE_MAX_LENGTH` |
| src/lib/timezone.ts                                           | `SUPPORTED_TIME_ZONES`, `isCanonicalTimeZone`, `canonicalTimeZoneSchema`                                                                                                               |
| src/lib/timezone.test.ts                                      | AC3: la tabla de aceptados y rechazados, y el caso límite 1 (el default está en la lista y la lista pasa de 300)                                                                       |
| src/lib/openingHours.ts                                       | `openingHoursSchema`, `parseOpeningHours`, `readWeeklySchedule`, `evaluateStoreHours` y sus tipos (`OpeningHours`, `WeeklyScheduleDay`, `StoreHoursStatus`)                            |
| src/lib/openingHours.test.ts                                  | AC2: la tabla de 8 filas × 3 husos mutando `process.env.TZ`; las reglas del formato una por una; y el lector tolerante (`null` + un `[hours]`, nunca una excepción)                    |
| src/features/sync/fieldOwnership.test.ts                      | AC4: schema ↔ contrato en los dos sentidos, más `PANEL_PRODUCT_COLUMNS` y el cuadre de R13 (constante ↔ schema ↔ migración)                                                            |
| src/features/sync/server/handlers/storePublishGate.db.test.ts | AC1: forzar `timezone` por SQL, entregar el lote, comprobar `FAILED` y que la tienda sigue `SUSPENDED`; y el 409 del panel                                                             |
| src/components/store/StoreHoursNotice.tsx                     | El cartel del horario de la semana. Server component; prop única `{ schedule: WeeklyScheduleDay[] }`. Redacción y forma visual de `sdd-designer`                                       |
| prisma/migrations/<timestamp>_store_timezone/migration.sql    | El `ALTER TABLE` de § «Modelo de datos», revisado a mano por los `DROP INDEX`. El sello de tiempo lo pone `migrate dev`                                                                |

**Se toca**:

| Ruta                                                | Qué cambia                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                              | `timezone String @default("America/Havana")` en `model Store`, junto a `openingHours`, con su `///`                                           |
| `prisma/seed.ts`                                    | `openingHours` en la tienda de demostración, con una ventana que cruza la medianoche (caso 5), dentro del `upsert` que ya existe              |
| `src/constants/sync.ts`                             | `STORE_OPENING_HOURS_INVALID` y `STORE_TIMEZONE_INVALID`                                                                                      |
| `src/constants/admin.ts`                            | `PANEL_PRODUCT_COLUMNS`, promovida desde el literal que hoy vive en un test                                                                   |
| `src/features/sync/server/handlers/store.ts`        | `timezone: true` en el `select` de `existing`; `assertOpeningHoursValid`; la puerta en los dos caminos que escriben `PUBLISHED`               |
| `src/features/sync/server/handlers/store.test.ts`   | Calendario malformado → `SyncEventFailure`; zona ilegible → falla al republicar; evento rutinario sobre una tienda ya publicada → no falla    |
| `src/features/sync/schemas.test.ts`                 | Un `openingHours` malformado **no** hace fallar el `safeParse` del lote (guarda contra mover la validación al schema)                         |
| `src/features/sync/server/handlers/product.test.ts` | `PANEL_COLUMNS` pasa a importar `PANEL_PRODUCT_COLUMNS`                                                                                       |
| `src/features/admin/server/mutations.ts`            | Lectura de `timezone` y puerta en la rama `enabled: true` de `setStoreEnabled`; `PanelProductColumn` derivado de la constante                 |
| `src/features/admin/types.ts`                       | Un miembro más en `AdminWriteResult`: `kind` con valor `"invalid_timezone"`                                                                   |
| `src/app/api/admin/_lib/respond.ts`                 | El caso `invalid_timezone` → `409 {"error":"INVALID_TIMEZONE"}`                                                                               |
| `src/features/admin/server/mutations.test.ts`       | Reabrir con zona ilegible → `invalid_timezone`; cerrar → sigue funcionando siempre                                                            |
| `src/lib/boundaries.test.ts`                        | **Dos** `it` nuevos: la puerta de `PUBLISHED`, y la guarda A5 (ninguna vista menciona `evaluateStoreHours`)                                   |
| `src/features/catalog/server/queries.ts`            | `openingHours` y `timezone` en `StoreSummary` y en el `select` de `loadStore`. Cero queries nuevas: es el mismo `findUnique`                  |
| `src/app/[slug]/page.tsx`                           | En la rama publicada: `readWeeklySchedule(store.openingHours)` y, si no es `null`, el cartel. Sin `<Suspense>`, sin `revalidate` propio       |
| `docs/sync-contract.md`                             | La v9 completa, según la tabla de § «Contratos externos»                                                                                      |
| `docs/despliegue.md`                                | **Dos** pasos operativos: el `UPDATE` a mano de la zona mientras F-011 no tenga editor, y la comprobación única del ICU en un preview (`AP2`) |
| `src/features/orders/deadline.ts`                   | Opcional, no requerido: el comentario de `:5` dice que no hay zona de tienda. Ya la habrá; el comportamiento de ese módulo no cambia          |

Y lo que **no** aparece en ninguna de las dos tablas, a propósito:
`src/app/[slug]/layout.tsx`, `src/proxy.ts`, `next.config.ts`,
`src/lib/cache.ts`, `src/features/orders/`, `src/features/cart/`,
`src/lib/promotions.ts`, `src/lib/storeClosure.ts`,
`src/components/store/BranchCard.tsx`, `src/components/store/BranchBar.tsx` y
`src/features/admin/components/StoreList.tsx`.

## Preguntas al humano, resueltas

Las dos están contestadas; ninguna queda abierta y ninguna bloquea el plan.

### `AP1` — El hueco dinámico de SP5 no existe en este Next. ¿Qué se suelta?

**Decidido: (b), el HTML sigue cacheado y la línea dice el horario.** Palabras del
humano: «HTML cacheado, y la línea dice el horario». Y una decisión suya que va
con ella: **se muestra el horario de la semana, no el de hoy**, porque «qué día
es hoy» también depende del instante y en HTML cacheado acabaría nombrando el día
equivocado.

Qué faltaba: de dónde salía el instante del cartel. Por qué bloqueaba: era la
única pieza que no se podía decidir sin elegir qué se pierde, y toca la ruta más
delicada del repo. Las opciones que se le presentaron, con lo medido:

- **(a)** Volver dinámica solo `src/app/[slug]/page.tsx`: cumple E13 y el
  criterio 2 al pie de la letra, pierde el HTML cacheado de la portada.
- **(b)** El cartel en el HTML cacheado, sin afirmar el ahora. **La elegida.**
- **(c)** Un `export const revalidate = 60` propio de la portada: media solución,
  porque con ISR el primer visitante tras el vencimiento recibe el HTML rancio.
- **(d)** Migrar la app a `cacheComponents: true`: la única que da las tres cosas,
  y un feature propio con su ADR.

Motivo de la elegida, en los términos del humano y con lo que se midió después:
la vitrina se lee sin esperar nada y sigue saliendo del CDN; el negocio publica
su horario y el comprador lo lee; y no se paga con la caché de la portada, que es
la primera página de toda tienda. **Y hay un hecho que apareció después de
plantear la pregunta y que habría hundido a (a) igualmente**:
`scripts/check-bundle-budget.mjs:81-89` exige que el build prerenderice al menos
una portada de tienda y sale con código 1 si no la encuentra, así que la opción
recomendada habría puesto roja la etapa `bundle` y con ella el criterio 7. La
medición del build servía para descartar el hueco dinámico; hacía falta además
leer el guion del presupuesto para ver el precio real de (a).

Consecuencias, ya escritas donde viven: el trilema desaparece en vez de
resolverse (§ El cartel en la página); E13 queda sin cumplir en su primera mitad
y eso está dicho sin maquillar en esa misma sección; `evaluateStoreHours` se
construye igual y se queda un ciclo sin llamador de producción (§ Contratos
internos, punto 3); y `src/app/[slug]/layout.tsx`, [ADR 0006] y el `matcher` del
proxy no se tocan.

### `AP2` — ¿El runtime de producción trae el ICU completo?

**Decidido: la recomendación.** No se verifica desde aquí. Entra en el alcance
como **paso operativo** en `docs/despliegue.md` —comprobar una vez en un preview
que `Intl.supportedValuesOf("timeZone")` devuelve el juego completo— y se cubre
con el test del caso límite 1, que afirma que `DEFAULT_STORE_TIMEZONE` está en la
lista y que la lista pasa de 300 entradas.

Medido aquí, para que el preview tenga contra qué comparar: Node 24.13.1 con ICU
78.2 devuelve **418** zonas e incluye `America/Havana`. Lo que el test compra es
que un cambio de runtime se vea como un CI rojo en vez de como una zona legítima
rechazada en producción; lo que compra el paso de `docs/despliegue.md` es la
única mitad que el CI no puede cubrir, porque corre en otra máquina que la que
sirve las peticiones. AGENTS.md § Documentación pide que el paso operativo se
escriba **en el mismo ciclo** que lo introduce, y por eso está en la tabla de
archivos.
