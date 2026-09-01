---
feature: F-032
agente: sdd-architect
actualizado: 2026-09-01T21:04:10Z
estado: listo
---

## Estado actual relevante

La semántica está cerrada en `.agent/specs/F-032/spec.md` (R1–R22) y no se
reabre aquí. Este documento decide **forma**: dónde vive cada pieza, con qué
tipo, y qué se reutiliza en vez de escribirse otra vez.

Lo que se reutiliza **sin tocarlo**:

- **El camino de entrada entero.** `src/app/api/internal/sync/catalog/route.ts`
  hace `safeParse` → `400 INVALID_BATCH` con `serializableIssues` antes de
  llamar a `processCatalogBatch`; ahí es donde SP1 obliga a poner toda la
  validación de valor (R4).
- **El bucle de `src/features/sync/server/processBatch.ts`**: su `try/catch` ya
  llena `failed`, `results[].error` y `markFailed` con el `message` de lo que se
  lance. No hace falta tocarlo (§ Decisión DA4).
- **La guarda anti-rancio y el `siblingTouch`/`expandBrandTouch` de
  `src/features/sync/server/handlers/store.ts`.** La revalidación del evento
  `STORE` no cambia ni una línea (§ La comprobación de R22).
- **`isDeliveryOffered` de `src/features/orders/deliveryOffer.ts`**, que desde
  F-031 es el único sitio donde se decide si se ofrece domicilio. El invariante
  de R8 es literalmente su caso degenerado.
- **El vocabulario**: `CheckoutMode` y `DeliveryFeeMode` de
  `src/generated/prisma/enums.ts` (R19). Comprobado que Zod 4 los acepta tal
  cual con `z.enum(CheckoutMode)` — son objetos `as const`, no enums de
  TypeScript.
- **La lista negra del panel**, `src/features/admin/server/boundaries.test.ts`,
  con su `FORBIDDEN_WRITE_COLUMNS` de seis columnas y su `extractDataBlocks`.
- **`prisma/seed.ts`**, intacto (R16), y el `common` de `src/features/sync/server/handlers/store.ts`,
  intacto: I1 es una corrección de **prosa del contrato**, no un cambio de
  comportamiento. Cambiar el `?? null` de los campos de contacto en este ciclo
  sería alcance que nadie pidió y rompería el sentido de la v7 recién escrita.

Lo que ya existe y **contradice** lo que se va a construir, y por eso se
corrige en el mismo ciclo: el comentario `///` de `orderExpiryHours`
(`prisma/schema.prisma`), las tres afirmaciones equivalentes de
`docs/sync-contract.md` y el `UPDATE` a mano de `docs/despliegue.md` § 9.5.

Un hecho descubierto leyendo el código y que la spec no registra:
**`scripts/send-store-batch.mjs` ya envía eventos `STORE` hoy**, y su payload
solo lleva `name`, `phone`, `businessName` y `baseCurrency`. Como el `common`
del handler escribe `?? null`, cada ejecución de ese guion **borra**
`description`, `address`, `city` y `whatsapp` de `tienda-demo`. Es la trampa de
R21, ya pisada, y está a un `import` de arreglarse (§ DA5, AP1).

## Decisión

Siete decisiones de forma. Ninguna cambia lo que la spec decidió.

### DA1 — El invariante vive en `deliveryOffer.ts`; la mezcla con la fila, en el sync

La mitad payload-only de R10 es un `refine` sobre `storePayloadSchema`. La mitad
que necesita la fila se parte en dos piezas que van a sitios distintos:

- **El predicado del invariante** va a `src/features/orders/deliveryOffer.ts`,
  como una función pura nueva definida **en términos de la que ya está**:

  ```ts
  /** F-032 R8: el estado que el sync nunca debe escribir — domicilio
   *  encendido sin nada con qué cobrarlo. Es el caso degenerado de
   *  `isDeliveryOffered`, escrito con ella para que no puedan divergir. */
  export function isDeliveryConfigInconsistent(config: DeliveryConfig): boolean {
    return config.deliveryEnabled && !isDeliveryOffered(config);
  }
  ```

- **La mezcla payload + fila** (el «valor efectivo» de R7) va a
  src/features/sync/server/storeConfig.ts (etapa 1, por crear), porque «ausente
  significa no toques» es una regla del cable, no del dominio de pedidos.

**Por qué ahí y no todo en `src/features/sync/`.** Si el sync se escribe su
propia versión de «cuándo hay con qué cobrar el domicilio», el día que aparezca
un tercer `DeliveryFeeMode` habrá dos sitios que actualizar y uno se olvidará:
es exactamente cómo nacieron las I3/I4 de F-031, que ese feature cerró creando
este módulo. Definir el predicado sobre `isDeliveryOffered` hace la divergencia
imposible por construcción.

**Por qué no al revés, la mezcla también en `deliveryOffer.ts`.** Ese archivo lo
importa `src/features/cart/components/CheckoutForm.tsx`, que es una isla de
cliente: todo lo que se le añada viaja al navegador. El predicado son dos
términos y ningún `import` nuevo (~80 bytes); meter ahí las claves del payload,
la tabla de defaults y el tipo `StorePayload` metería el vocabulario del sync en
el bundle del checkout. **La dirección del import es sync → orders y nunca al
revés**, y hay precedente: `src/features/sync/server/handlers/misc.ts` ya
importa de `@/features/orders/server/prismaErrors`. `deliveryOffer.ts` es puro
(sin Prisma, sin React, sin Zod), así que no rompe ninguna capa de AGENTS.md.

Descartado: dejar el predicado dentro de `src/features/sync/server/handlers/store.ts` — no se puede
probar sin montar el mock de Prisma y repite la regla de F-031.

### DA2 — Los defaults de columna salen del schema, y solo hacen falta dos

R7 pide el «valor efectivo» con tres fuentes. Se reduce mucho al mirarlo:

1. **Solo la terna de R8 participa.** `checkoutMode` y `orderExpiryHours` no
   entran en ninguna guarda, así que sus defaults (`WHATSAPP`, `24`) **no se
   escriben en TypeScript en ninguna parte**: en el camino de creación los
   aplica Postgres, y nadie los lee antes de escribir.
2. **`deliveryFee` no tiene default**: la columna es anulable, así que «no hay
   fila» y «no hay importe» son el mismo `null`. Tampoco es un literal.
3. **Quedan dos**: `deliveryEnabled @default(false)` y
   `deliveryFeeMode @default(FLAT_RATE)`. Van juntos en una sola constante del
   módulo nuevo, tipada como `DeliveryConfig` (el tipo de F-031, no una
   interfaz duplicada) y con el modo tomado de `DeliveryFeeMode.FLAT_RATE` del
   enum generado — no de un literal (R19):

   ```ts
   /** El estado de una tienda que todavía no existe, según los `@default`
    *  del bloque `Store` de `prisma/schema.prisma`. La única copia en TS, y
    *  `storeConfig.test.ts` la compara contra el schema en disco. */
   export const NEW_STORE_DELIVERY_BASELINE: DeliveryConfig = {
     deliveryEnabled: false,
     deliveryFeeMode: DeliveryFeeMode.FLAT_RATE,
     deliveryFee: null,
   };
   ```

**Cómo se impide la deriva sin duplicar el schema.** Un test unitario lee
`prisma/schema.prisma` del disco, extrae el bloque `Store` y afirma que
`deliveryEnabled` sigue siendo `@default(false)` y `deliveryFeeMode`
`@default(FLAT_RATE)`. Es la misma técnica de
`src/features/admin/server/boundaries.test.ts` y de `scripts/check-harness.mjs`:
prosa —aquí, una constante— comparada contra su fuente de verdad, en rojo si se
separan. Coste: un `readFileSync` por ejecución de la suite.

**Por qué no leerlos en caliente del DMMF de Prisma.** No se puede:
`grep -n "dmmf" src/generated/prisma/internal/prismaNamespace.ts` devuelve una
sola línea, `export type DMMF = typeof runtime.DMMF` — un **tipo**, sin valor
en tiempo de ejecución. Y aunque lo hubiera, sería trabajo por evento para
resolver algo que solo cambia cuando cambia el schema.

### DA3 — «Omitir no es apagar» se escribe con un `pickDefined` tipado, no con spreads

El `data` de las tres escrituras incluye una clave **solo si el payload la
trajo**. La forma exacta, ya comprobada con `npx tsc --noEmit` (§ Contratos
internos):

```ts
export const STORE_CONFIG_KEYS = [
  "checkoutMode",
  "deliveryEnabled",
  "deliveryFee",
  "deliveryFeeMode",
  "orderExpiryHours",
] as const;

export type StoreConfigColumn = (typeof STORE_CONFIG_KEYS)[number];
/** Compatible a la vez con el `data` de un `update` y con el `store:` de
 *  `createStorefrontWithStore` (`StoreCreateData`). */
export type StoreConfigWrite = Partial<Pick<Prisma.StoreUpdateInput, StoreConfigColumn>>;

function pickDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value; // `null` SÍ pasa: borra
  }
  return out;
}

export function storeConfigWrite(payload: StorePayload): StoreConfigWrite {
  return pickDefined(payload, STORE_CONFIG_KEYS);
}
```

`undefined` (ausente) desaparece; `null` (solo posible en `deliveryFee`, R3)
sobrevive y escribe `NULL`. En el handler son **cuatro caracteres por sitio**:
`...config`. Nada de `?? null`, que es justo lo que hace el `common` de al lado
y lo que este feature no debe imitar.

Descartado: una cascada de `...(payload.x !== undefined ? { x: payload.x } : {})`
—cinco por cada una de las tres escrituras, quince ocasiones de equivocarse—; y
un `JSON.parse(JSON.stringify(...))`, que además borraría el `null` que sí
significa algo.

`pickDefined` vive en el módulo nuevo del sync y no en `src/lib/`: la regla que
implementa es del contrato («presente = escribe, ausente = silencio»), y F-022,
que amplía el payload de `STORE`, va a querer exactamente este módulo. Si
apareciera un segundo consumidor fuera del sync, sube a `src/lib/` sin cambiar
de firma.

### DA4 — El código de error viaja por excepción, y el `HandlerOutcome` no se toca

- **La constante** va a `src/constants/sync.ts`, el módulo que ya existe para
  esto (AGENTS.md § Prohibiciones: magic strings a `src/constants/`). Su
  cabecera dice hoy «Numbers…»; se amplía a «Numbers and error codes…».

  ```ts
  export const STORE_DELIVERY_CONFIG_INCONSISTENT = "STORE_DELIVERY_CONFIG_INCONSISTENT";
  ```

- **El transporte** es una excepción tipada, declarada junto a los outcomes en
  `src/features/sync/server/handlers/types.ts`:

  ```ts
  /** Un fallo POR EVENTO, no del lote: `processBatch` lo convierte en
   *  `status: "failed"` con este `message` como `error`. */
  export class SyncEventFailure extends Error {}
  ```

  El `catch` de `processBatch.ts` ya hace `error.message → failed[].error`,
  `results[].error` y `markFailed`, y `summarize` ya excluye `failed` de `ok`.
  **Cero líneas nuevas en `processBatch.ts`.**

- **El mismo token es el `error` del `refine`** de Zod, así que el `400` lo
  devuelve en `issues[].message` y el `207` en `failed[].error`: un solo
  vocabulario para las dos mitades de la guarda.

**Por qué no ampliar `HandlerOutcome` con `status: "failed"`.** Es la opción que
parece más limpia y es la peligrosa: `processBatch.ts` decide con
`if (outcome.status === "processed") processed.push(...) else skipped.push(...)`,
y un miembro nuevo de la unión **cae en el `else` sin que TypeScript diga nada**.
Ese evento acabaría reportado en `ok`, el POS marcaría su outbox como procesado y
la corrección se perdería en silencio — exactamente el fallo que AGENTS.md
ficha como «Un evento fallido NO es un duplicado». La excepción usa la única
tubería que ya está bien conectada.

**Residuo asumido, y hay que decirlo:** `handleStore` hace
`prisma.business.update` (nombre y moneda del negocio) **antes** de leer
`existing`, así que un evento rechazado por R10.2 sí deja escrito ese `update`.
No es ninguna de las cinco columnas, no toca `sourceUpdatedAt` y es idempotente:
R11 se cumple sobre `Store`, que es de lo que habla. Mover ese `update` detrás de
la guarda cambiaría el comportamiento de todos los caminos de fallo del handler,
no solo del nuevo, y no lo pide ningún criterio.

### DA5 — El guion: presets en tabla, y los datos de contacto en un fixture compartido

Los criterios 1, 4, 5 y 6 nombran `scripts/send-catalog-batch.mjs` con
`--store-config=<caso>`, así que **la bandera se queda como la propone la spec**.
Lo que cambia es cómo se implementa: no trece ramas, sino **una tabla de presets
y un solo sitio donde se mezcla**.

```js
// scripts/store-event.mjs (etapa 3, por crear)
export const STORE_CONFIG_CASES = {
  all: {
    checkoutMode: "ONSITE",
    deliveryEnabled: true,
    deliveryFee: 750.5,
    deliveryFeeMode: "QUOTED_PER_ORDER",
    orderExpiryHours: 6,
  },
  partial: { deliveryFee: 300 },
  "null-fee": { deliveryFee: null, deliveryFeeMode: "QUOTED_PER_ORDER" },
  "null-mode": { deliveryFeeMode: null },
  decimals: { deliveryFee: 12.345 },
  // … negative, hours-zero, hours-max, bad-mode, bad-checkout,
  //   contradictory, enable-only
};
```

`--store-config` sin `=` usa `all`; un caso desconocido sale con código 2 y
lista los válidos, en vez de mandar un lote silenciosamente vacío de
configuración. Trece casos siguen siendo trece líneas —son trece **datos**, no
trece caminos de código— y añadir el catorceavo no toca lógica.

**R21, que es la parte que muerde.** Los campos de contacto **se repiten como
literales** en ese mismo módulo, en un objeto `SEED_STORE_CONTACT` que copia lo
que `prisma/seed.ts` siembra para `seed-tienda-1` (`description`, `city`,
`address`, `whatsapp`), y **no** se leen de la base:

- Leerlos de Postgres obligaría al guion a tener `DATABASE_URL` y un cliente
  Prisma. Hoy solo necesita `QAB_BASE_URL` y un token, y eso es lo que le
  permite apuntar a **otro host**; un guion que simula al POS y consulta
  nuestra base para componer su payload deja de simular al POS.
- Importarlos de `prisma/seed.ts` no se puede: es TypeScript y el guion es
  `.mjs` plano, sin `tsx`.
- La deriva se cubre donde se puede cubrir: un aserto de disco en
  `src/app/api/internal/boundaries.test.ts` —que ya lee `scripts/` y `prisma/`
  para sus checks G6/G7— comprobando que cada valor de `SEED_STORE_CONTACT`
  aparece literalmente en `prisma/seed.ts`. Si alguien cambia el seed, el test
  se pone rojo antes que las pruebas visuales.

Otras dos reglas del guion: con `--unknown-store` **no se envía evento `STORE`**
(crearía una tienda basura y rompería el `skipped_not_published` de F-005), y
`--stale` se compone con `--store-config` poniendo el `updatedAt` de 2000 en los
dos eventos, que es lo que verifica el criterio 6.

El mismo módulo lo debería importar `scripts/send-store-batch.mjs`, que hoy
borra cuatro columnas de contacto en cada ejecución (§ Estado actual). Es un
`import` y un spread; queda como **AP1** porque es alcance que la spec no pidió.

### DA6 — ADR 0028, escrita

`docs/adr/0028-configuracion-de-compra-del-pos.md`, titulada **«La configuración
de compra de una tienda la escribe cuadrecaja, y omitir no es apagar»**. Registra
las cinco cosas que tenían que quedar registradas: la propiedad de las cinco
columnas pasa al sync con `sourceUpdatedAt` como único árbitro; `orderExpiryHours`
**invierte** lo que fijaron F-019 R5/R20, el comentario del schema y el contrato;
esto **cumple** ADR 0017 (a) porque el panel sigue sin tocarlas y la lista negra
lo vuelve un test rojo; «omitir no es apagar» como forma general de transferir la
propiedad de una columna a un sistema que aún no sabe que la tiene; y la
partición `400` / `failed` de la guarda. La cita el contrato (criterio 9), el
comentario del schema (criterio 8) y `docs/despliegue.md` (criterio 14).

### DA7 — Qué prueba qué, y dónde vive

Sin escribir los tests: eso es de `sdd-tester`. La partición es la que hace que
cada regla se rompa en el sitio más barato.

| Nivel                           | Archivo                                                           | Cubre                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit, schema                    | src/features/sync/schemas.test.ts (etapa 1, por crear)            | E5, E6, E7, E14: `safeParse` de los trece payloads de § DA5 y del payload v6 exacto. Es la única prueba del `400` que no necesita servidor                                                                               |
| Unit, módulo de configuración   | src/features/sync/server/storeConfig.test.ts (etapa 1, por crear) | R1/R3 (`pickDefined`: ausente fuera, `null` dentro), R7 (mezcla con fila y sin fila), R9 (no toca la terna → no evalúa), y la deriva de defaults contra el schema                                                        |
| Unit, invariante                | `src/features/orders/deliveryOffer.test.ts`                       | La tabla de verdad de `isDeliveryConfigInconsistent`, incluidos `deliveryFee: 0` (válido) y `QUOTED_PER_ORDER` sin importe (válido)                                                                                      |
| Unit, handler (Prisma mockeado) | `src/features/sync/server/handlers/store.test.ts`                 | **Criterio 15**: E1 (el `data` del `update` no lleva ninguna de las cinco), E10 (despublicar sí configura), E11 (`DELETE` no), E8 (lanza y no llama a `update`), E9 (rancio antes que guarda), E13 (create con baseline) |
| Unit, fronteras                 | `src/features/admin/server/boundaries.test.ts`                    | **Criterio 7**: las cinco columnas en `FORBIDDEN_WRITE_COLUMNS`                                                                                                                                                          |
| Unit, fronteras del sync        | `src/app/api/internal/boundaries.test.ts`                         | R21: los contactos del fixture del guion siguen coincidiendo con `prisma/seed.ts`                                                                                                                                        |
| Integración HTTP                | `src/app/api/internal/sync/catalog/route.test.ts`                 | Que el `400` es del lote entero (ningún `SyncEvent` escrito) y que un `STORE` `failed` convive con `PRODUCT`s `processed` en el mismo `207`                                                                              |
| Manual, contra Postgres         | `scripts/send-catalog-batch.mjs` + `psql`                         | Los criterios 1–6 y 10 tal como están escritos en la spec                                                                                                                                                                |

No hace falta ningún `*.db.test.ts` nuevo: lo único que exige Postgres real
—que un `failed` no deje escritas las columnas— se verifica con el guion y `psql`
en el criterio 5, y el mock del handler ya prueba que no se llama a `update`.

## Componentes

| Componente                                                                   | Capa                        | Responsabilidad                                                                      | Archivo                                                      |
| ---------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Cinco claves + `refine` de R10.1                                             | `features/*/schemas.ts`     | Tipos, rangos, vocabulario y la contradicción visible solo en el payload → `400`     | `src/features/sync/schemas.ts`                               |
| `storeConfigWrite`, `effectiveDeliveryConfig`, `NEW_STORE_DELIVERY_BASELINE` | `features/*/server/` (puro) | «Omitir no es apagar» y el valor efectivo de R7                                      | src/features/sync/server/storeConfig.ts (etapa 1, por crear) |
| `isDeliveryConfigInconsistent`                                               | `features/orders/`          | El invariante de R8, escrito sobre `isDeliveryOffered`                               | `src/features/orders/deliveryOffer.ts`                       |
| `SyncEventFailure`                                                           | `features/*/server/`        | Fallo por evento que `processBatch` ya sabe convertir en `failed`                    | `src/features/sync/server/handlers/types.ts`                 |
| `STORE_DELIVERY_CONFIG_INCONSISTENT`                                         | `src/constants/`            | El token único de error, para el `400` y para el `207`                               | `src/constants/sync.ts`                                      |
| Guarda R10.2 + escritura de las cinco                                        | `features/*/server/`        | Tres llamadas de una línea antes de cada escritura, y `...config` en los tres `data` | `src/features/sync/server/handlers/store.ts`                 |
| Fixture y presets del evento `STORE`                                         | `scripts/`                  | R20/R21: contacto sembrado + trece casos                                             | scripts/store-event.mjs (etapa 3, por crear)                 |
| Banderas `--store-config[=caso]`                                             | `scripts/`                  | El instrumento de verificación de los criterios 1–6                                  | `scripts/send-catalog-batch.mjs`                             |

## Flujo de datos

```
POST /api/internal/sync/catalog
  └─ withInternalAuth ─ 401/403
  └─ catalogBatchSchema.safeParse
       ├─ tipo/rango/vocabulario de las cinco  ──▶ 400 INVALID_BATCH (lote entero)
       └─ refine R10.1 (enabled+FLAT_RATE+fee null) ─▶ 400 INVALID_BATCH
  └─ processCatalogBatch
       └─ recordBatch (inbox)  →  handleStore(payload, operation, businessId)
            1. business.update                     (como hoy)
            2. store.findUnique  ← + deliveryEnabled, deliveryFeeMode, deliveryFee
            3. colisión de negocio                 → SKIPPED            (E15)
            4. guarda anti-rancio                  → STALE              (E9)
            5. config = operation === "DELETE" ? {} : storeConfigWrite(payload)   (R14)
            6. camino:
               a. !optIn  → si no hay fila: SKIPPED (E12)
                            assertDeliveryConsistent(config, fila)
                            update { sourceOptIn:false, …suspensión, ...config }  (E10)
               b. !existing → assertDeliveryConsistent(config, BASELINE)          (E13)
                            createStorefrontWithStore({ store: { ...common, ...config } })
               c. existing  → assertDeliveryConsistent(config, fila)
                            update { ...common, sourceOptIn:true, ...config }
            7. outcome con touchedStoreSlug/BrandSlug/SlugValues — SIN CAMBIOS
       └─ catch(SyncEventFailure) → failed[] + results[].error + markFailed  → 207
```

`assertDeliveryConsistent` es un ayudante local de `src/features/sync/server/handlers/store.ts`, de cinco
líneas: sale sin hacer nada si `config` no toca la terna (R9), y si no, lanza
`SyncEventFailure` cuando el valor efectivo cumple `isDeliveryConfigInconsistent`.
Está llamado **tres veces, cada una inmediatamente antes de su escritura**, y no
una sola vez arriba: colocado antes del `return SKIPPED` de E12 o del de E15
convertiría en `failed` dos casos que la spec exige que sigan siendo `skipped`.

## Contratos

### El payload (`src/features/sync/schemas.ts`)

Cinco claves añadidas a `storePayloadSchema`, planas (R2), y un `refine` al
objeto. Verificado en ejecución con Zod 4.4.3 (salidas en § Comprobaciones):

```ts
checkoutMode: z.enum(CheckoutMode).optional(),
deliveryEnabled: z.boolean().optional(),
deliveryFee: z.number().nonnegative().multipleOf(0.01).max(999999999999.99).nullish(),
deliveryFeeMode: z.enum(DeliveryFeeMode).optional(),
orderExpiryHours: z.int().min(1).max(8760).optional(),
```

y, sobre el objeto entero:

```ts
.refine(
  (p) => !(p.deliveryEnabled === true && p.deliveryFeeMode === "FLAT_RATE" && p.deliveryFee === null),
  { error: STORE_DELIVERY_CONFIG_INCONSISTENT, path: ["deliveryFee"] },
)
```

Tres detalles que evitan un rodeo al implementarlo:

- `z.enum(CheckoutMode)` funciona con los objetos `as const` de
  `src/generated/prisma/enums.ts`: en Zod 4 `z.enum` sustituyó a `nativeEnum` y
  acepta objetos. Así el vocabulario no se copia (R19).
- `multipleOf(0.01)` es **decimal-safe** en Zod 4 (usa resto escalado, no `%`
  sobre flotantes): comprobado con `12.345` → falso y `999999999999.99`,
  `0.07`, `8.2` → verdadero.
- `storePayloadSchema` no lo usa nadie más
  (`grep -rn "storePayloadSchema" src scripts` fuera de su propio archivo: cero
  resultados), así que envolverlo en un `refine` —que deja de ser `ZodObject`—
  no rompe ningún `.extend()`/`.shape` en otro sitio. Dentro del
  `discriminatedUnion` viaja como valor de la clave `payload`, no como miembro,
  así que el discriminante sigue siendo `entity`.

### Tabla de errores

| Código                               | Dónde aparece                                  | HTTP  | Cuándo                                                                                |
| ------------------------------------ | ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------- |
| `INVALID_BATCH`                      | `body.error`, con `issues`                     | `400` | Cualquier fallo de Zod en cualquier evento: tipo, rango, `null` en las cuatro, refine |
| `STORE_DELIVERY_CONFIG_INCONSISTENT` | `issues[].message` del `400`                   | `400` | R10.1: el payload solo ya es contradictorio (E7)                                      |
| `STORE_DELIVERY_CONFIG_INCONSISTENT` | `failed[].error` y `results[].error` del `207` | `207` | R10.2: contradictorio al mezclarse con la fila (E8). No escribe nada                  |
| `BUSINESS_MISMATCH`                  | `body.error`                                   | `403` | Sin cambios                                                                           |

Nada de esto añade un código nuevo al `EVENT_STATUS` del contrato: `failed` ya
existe desde la v1.

### Contratos internos (comprobados con el compilador)

`npx tsc --noEmit` sobre un archivo de prueba —creado, comprobado y **borrado**—
confirma tres cosas que no son obvias y que, si fueran falsas, cambiarían el
diseño:

1. `pickDefined` compila con clave genérica (`out[key] = value` sobre
   `Partial<Pick<T, K>>`), sin `as` y sin `any`.
2. Su resultado es asignable **a la vez** a
   `Partial<Pick<Prisma.StoreUpdateInput, …>>` y a
   `Partial<Pick<StoreCreateData, …>>`, y se puede esparcir dentro del `data` de
   un `update` y del `store:` de `createStorefrontWithStore`. Un `number` para
   una columna `Decimal(14,2)` lo acepta Prisma sin conversión (R6).
3. `isDeliveryConfigInconsistent` sobre `DeliveryConfig` no obliga a tocar el
   tipo de F-031: el importe de la fila entra como
   `row.deliveryFee?.toString() ?? null` y el del payload como
   `String(payload.deliveryFee)`. Ese string **solo se usa para saber si hay
   importe**; no se pinta en ningún sitio (queda dicho en el docblock del
   módulo, porque `String(500)` no es `"500.00"`).

## Modelo de datos y migraciones

**Ninguna migración** (R17). Las cinco columnas y los dos enums existen desde
F-031. El único cambio en `prisma/schema.prisma` es el comentario `///` de
`orderExpiryHours`, que no genera SQL:

- fuera: «A queandabuscando-owned field: the sync never sends it and a STORE
  event never overwrites it».
- dentro: que es de cuadrecaja desde la v7 del contrato, que llega opcional y
  que omitirla no la cambia, con el enlace a la ADR 0028 (criterio 8).

Consecuencias operativas: no se ejecuta `npm run db:migrate`, y por tanto no se
pisa la ficha `prisma-migrate-dev-borra-indices-gin-no-declarados`. El criterio
10 se verifica con `npx prisma migrate diff … --exit-code` (debe dar 0) y con el
conteo por columna antes y después del **despliegue del código**.

## La comprobación de R22 — qué comprobé y con qué salida

El orquestador pidió no dar por buena la afirmación de R22. Lo comprobado, con
los comandos y sus salidas:

1. **La ruta que lleva la configuración al checkout no cachea.**
   `src/app/api/orders/quote/route.ts:6` es `export const dynamic = "force-dynamic"`,
   responde con `NO_STORE` en las cabeceras, y el docblock de `quoteCart`
   (`src/features/orders/server/quote.ts`) dice «Nothing here is cached: every
   read is fresh, on purpose». `CheckoutForm.tsx:422-433` lee `deliveryEnabled`
   y `deliveryFeeMode` **de esa respuesta**, no de props del servidor.

2. **Ninguna página cacheada imprime ninguna de las cinco.**

   ```
   grep -rn "checkoutMode\|deliveryEnabled\|deliveryFeeMode\|orderExpiryHours\|deliveryFee" \
     src/app src/components src/features/catalog src/features/storefront
   ```

   15 resultados, **todos** sobre `Order`, no sobre `Store`: catorce en
   `src/app/[slug]/pedido/[code]/page.tsx` (`order.deliveryFee`,
   `order.checkoutMode`, `order.proposal.deliveryFee`) y uno en
   `src/app/api/internal/orders/proposal/route.ts`. `src/components/`,
   `src/features/catalog/` y `src/features/storefront/` dan **cero**: la consulta
   del catálogo ni siquiera las selecciona.

3. **La única página del segmento que sí es ISR no las toca.**
   `grep -rn "export const revalidate\|export const dynamic" src/app` deja un
   solo `revalidate` distinto de `0` en toda la app: `src/app/[slug]/layout.tsx`
   con `3600`. `src/app/[slug]/page.tsx` no declara segment config y se
   pre-renderiza con `generateStaticParams`, así que hereda ese piso — y por (2)
   no imprime ninguna de las cinco. `src/app/[slug]/pedido/[code]/page.tsx`, que
   sí lee `checkoutMode`, es `force-dynamic` + `revalidate = 0`.

**Conclusión: R22 se confirma. El diseño no añade ninguna invalidación de
caché.** El handler sigue devolviendo `touchedStoreSlug`, `touchedBrandSlug` y
`touchedSlugValues` exactamente como hoy, y `touchedSlugValues` lo sigue
calculando `siblingTouch` a través de `expandBrandTouch`.

Lo que esto deja escrito para el futuro, que es la mitad útil de la ficha
`revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado`: **el día que
una página cacheada imprima cualquiera de las cinco** —un distintivo «hacemos
entregas» en la ficha de tienda, por ejemplo— este evento pasa a cambiar el
significado de páginas que no escribe, y entonces se llama a `expandBrandTouch()`
desde `src/features/sync/server/handlers/store.ts`. Nunca se arma el array de slugs a mano: el
`SlugTouchSet` que devuelve es el único tipo que `HandlerOutcome` acepta, así que
un array escrito a mano **no compila** — esa es la defensa, no la revisión.

## Escalabilidad y límites

Números, no adjetivos:

- **Round-trips por evento `STORE`: los mismos de hoy** (3 en el peor caso:
  `business.update`, `store.findUnique`, `store.update`). Las tres columnas de la
  terna entran en el `select` que ya se hace; la guarda es pura y no consulta
  nada. Un lote de 500 eventos `STORE` sigue costando ≤1500 consultas y **una**
  invalidación por familia de tag.
- **El N+1 que ya existe y este feature no empeora**: `business.update` corre una
  vez por evento. Con 500 eventos de un mismo negocio son 500 escrituras
  idénticas. Es preexistente (F-018) y sigue fuera de alcance; si algún día
  duele, se hace una sola vez por lote en `processBatch`.
- **Tamaño del payload**: +5 claves por evento `STORE`, ~110 bytes. Un lote
  máximo de 500 eventos `STORE` crece ~55 KB sobre los del contrato v6. El techo
  real del lote lo pone `MAX_CATALOG_EVENTS = 500`, no el tamaño.
- **JavaScript de cliente**: +1 función pura de dos términos en
  `deliveryOffer.ts`, sin imports nuevos (~80 bytes minificados). El resto del
  feature es servidor y guiones. `npm run check:bundle` no debería moverse.
- **Qué se rompe primero al multiplicar por 100.** No la configuración: son
  cinco columnas de una fila que se escribe con la fila. Lo que se rompe antes
  —y ya está roto— es el `business.update` por evento, visible a partir de
  ~10 000 eventos por lote, que hoy es imposible por el tope de 500.
- **Guarda de consistencia con 100× tiendas**: sigue siendo O(1) por evento,
  cero consultas. Lo único que crece linealmente es el número de tiendas que
  pueden quedar en el bucle de reintento de R12 si el POS emite configuración
  contradictoria de forma sistemática; eso se ve en `SyncEvent.status = FAILED`
  y es lo que hay que vigilar tras el despliegue del otro lado.

## Impacto archivo por archivo

| Archivo                                                      | Qué cambia                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sync/schemas.ts`                               | Cinco claves en `storePayloadSchema` + el `refine` de R10.1                                                                                                                                 |
| `src/constants/sync.ts`                                      | La constante del código de error; el docblock pasa a hablar de números **y** códigos                                                                                                        |
| src/features/sync/server/storeConfig.ts (etapa 1, por crear) | `STORE_CONFIG_KEYS`, `pickDefined`, `storeConfigWrite`, `effectiveDeliveryConfig`, `NEW_STORE_DELIVERY_BASELINE`                                                                            |
| `src/features/orders/deliveryOffer.ts`                       | `isDeliveryConfigInconsistent`, escrita sobre `isDeliveryOffered`                                                                                                                           |
| `src/features/sync/server/handlers/types.ts`                 | `SyncEventFailure`                                                                                                                                                                          |
| `src/features/sync/server/handlers/store.ts`                 | +3 columnas en el `select`, `config` tras la guarda anti-rancio, `assertDeliveryConsistent` ×3, `...config` ×3                                                                              |
| `src/features/sync/server/processBatch.ts`                   | **Nada.** Es la comprobación de que DA4 es la decisión correcta                                                                                                                             |
| `scripts/send-catalog-batch.mjs`                             | Evento `STORE` + `--store-config[=caso]`; no lo envía con `--unknown-store`                                                                                                                 |
| scripts/store-event.mjs (etapa 3, por crear)                 | `SEED_STORE_CONTACT`, `STORE_CONFIG_CASES`, `buildStoreEvent()`                                                                                                                             |
| `prisma/schema.prisma`                                       | Solo el comentario `///` de `orderExpiryHours`                                                                                                                                              |
| `docs/sync-contract.md`                                      | v7: las cinco claves, la tabla ausente/`null`/valor, la tabla de propiedad (I4), la corrección de I1, el riesgo de SP1 con ejemplo, el error por evento, «Cambios requeridos en cuadrecaja» |
| `docs/despliegue.md`                                         | § 9.5 deja de mandar un `UPDATE` (criterio 14)                                                                                                                                              |
| `docs/adr/0028-configuracion-de-compra-del-pos.md`           | **Ya escrita** en este ciclo                                                                                                                                                                |
| `src/features/admin/server/boundaries.test.ts`               | Las cinco columnas en `FORBIDDEN_WRITE_COLUMNS` (criterio 7)                                                                                                                                |
| `src/app/api/internal/boundaries.test.ts`                    | El aserto de deriva del fixture de contacto (R21)                                                                                                                                           |

## Orden de implementación en etapas

Cada etapa termina en verde por sí sola; ninguna deja el repo a medias.

1. **Contrato y piezas puras.** `schemas.ts`, `constants/sync.ts`,
   storeConfig.ts (por crear) y `deliveryOffer.ts`, con sus tests unitarios.
   Sensor: `bash .agent/verify.sh F-032`. Nada del handler ha cambiado todavía,
   así que el `400` ya funciona y el `207` sigue igual que en la v6.
2. **Handler.** `src/features/sync/server/handlers/types.ts` y `src/features/sync/server/handlers/store.ts`, con `store.test.ts`
   ampliado (criterio 15). Sensor: `npm test`.
3. **Instrumento y fronteras.** store-event.mjs (por crear),
   `send-catalog-batch.mjs`, las dos `boundaries.test.ts`. Sensor: `npm test` y
   el guion contra el servidor de desarrollo (criterios 1–6).
4. **Documentación.** v7 de `docs/sync-contract.md` (sube a **7**, no a 6.1 —
   I8), comentario del schema, `docs/despliegue.md` § 9.5. Sensor:
   `npm run format:check`, `npm run check:harness` y el hook
   `.claude/hooks/sync-contract-version.sh`.

La 4 puede ir en paralelo con la 3, pero no antes de la 1: el contrato tiene que
describir los rangos que el schema realmente impone.

## Patrones a seguir / antipatrones a evitar

- **El vocabulario sale del enum generado**, nunca de literales
  (AGENTS.md § Prohibiciones, R19).
- **Los magic strings a `src/constants/`**: el código de error se escribe una
  vez y se usa en el `refine` y en el `throw`.
- **No se duplican interfaces**: la configuración de envío se pasa como el
  `DeliveryConfig` de F-031, no como un tipo nuevo con los mismos tres campos
  (AGENTS.md § Prohibiciones).
- **Idempotencia y guarda anti-rancio intactas** (AGENTS.md § Cosas que
  muerden): la guarda de consistencia se evalúa **después** de la de rancio,
  para que un evento viejo y contradictorio siga siendo `stale` y no `failed`.
- **Un evento fallido no se reporta en `ok`**: por eso el fallo viaja por
  excepción y no por un miembro nuevo de `HandlerOutcome` (§ DA4).
- **Nunca un array de slugs a mano**: § La comprobación de R22.
- **Un archivo que aún no existe se cita sin comillas invertidas y con
  «(por crear)»** — regla de AGENTS.md que `npm run check:harness` impone sobre
  este mismo documento.
- **Prettier sobre lo escrito por uno mismo, nunca sobre prosa ajena**
  (ficha `prettier-write-reescribe-prosa-ajena`). Este documento y la ADR pasan
  `npx prettier --check`.

## Riesgos y plan B

- **`QAB_BEARER_TOKEN` está vacío en este worktree** (`sdd.sh start` lo dice) y
  los criterios 1–6 no se pueden ejecutar sin él; acuñarlo con
  `npm run mint:token` **rota el token en la base compartida** y deja en 401 a
  los demás worktrees (ficha `mint-token-rota-el-token-en-bd-compartida`). Es
  **AP2**: sin respuesta, la verificación se queda a medias y no es un problema
  que resuelva el diseño.
- **Resembrar entre las dos lecturas del criterio 1 lo invalida** (R16/I7):
  `prisma/seed.ts` reescribe tres de las cinco y adelanta `sourceUpdatedAt`. Va
  escrito en el plan como precondición, no como nota al pie.
- **El bucle de reintento de R12**: un POS que emita configuración contradictoria
  reintentará para siempre. Mitigación: está en el contrato, con su ejemplo, y se
  vigila con `SELECT count(*) FROM "SyncEvent" WHERE status = 'FAILED'`. Plan B
  si en producción resulta insoportable: aplicar el evento degradado
  (`deliveryEnabled = false`) en vez de fallar — es la alternativa de I5, un
  cambio de una línea en el handler, y la ADR 0028 la deja anotada.
- **El `refine` cambia el tipo de `storePayloadSchema`** de `ZodObject` a un
  esquema envuelto. Hoy no lo usa nadie más (comprobado), pero si un feature
  futuro necesita `.extend()`, la salida es declarar el `refine` sobre el
  **miembro** del `discriminatedUnion` en vez de sobre el payload; el mensaje de
  error y el `400` no cambian.
- **La deriva del fixture de contacto** (R21) es la que puede poner en rojo
  pruebas ajenas sin que nadie relacione la causa. Mitigada con el aserto de
  disco de § DA5; sin él, esto es lo primero que rompe.

## ¿Hace falta una ADR?

Sí, y **ya está escrita**: `docs/adr/0028-configuracion-de-compra-del-pos.md`,
en estado **Propuesta** (pasa a Aceptada al fusionar F-032, como hizo la 0017).
Contenido en § DA6.

## Preguntas al humano

**AP1 — ¿Se arregla en este ciclo el borrado silencioso de
`scripts/send-store-batch.mjs`?** Ese guion existe hoy, envía eventos `STORE`
sin los campos de contacto y por tanto borra `description`, `address`, `city` y
`whatsapp` de `tienda-demo` en cada ejecución. Opciones: **(a)** que importe el
mismo fixture compartido que va a usar `send-catalog-batch.mjs` —un `import` y
un spread, misma etapa 3—; **(b)** dejarlo como está y anotarlo como ficha del
playbook. _Recomiendo (a)_: es la misma trampa que R21 obliga a evitar en el
guion hermano, y dejar una de las dos armadas garantiza que alguien la pise.

**AP2 — ¿Con qué token se verifican los criterios 1–6?** `QAB_BEARER_TOKEN`
está sin valor en este worktree, y acuñar uno nuevo con `npm run mint:token`
**rota el token del negocio en la base compartida** y deja en 401 a los demás
checkouts (ficha `mint-token-rota-el-token-en-bd-compartida`). Opciones:
**(a)** el humano pega un token ya acuñado de `seed-negocio-1` en el `.env` de
este worktree; **(b)** se acuña uno nuevo asumiendo que rompe a los demás y
avisando antes; **(c)** se verifica contra una base local propia
(`DATABASE_URL` distinto). _Recomiendo (a)_, y (c) como plan B si nadie tiene el
valor a mano.

Nada más queda abierto: SP1–SP4 están cerradas y no se reabren; la alternativa
de I5 se registra en la ADR 0028 y en § Riesgos como plan B, sin bloquear la
firma.
