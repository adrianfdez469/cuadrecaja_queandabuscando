---
feature: F-042
agente: sdd-tester
actualizado: 2026-09-09T22:20:26Z
estado: listo
veredicto: listo
---

## Estrategia

Los ocho ficheros que `architecture.md` § Componentes reserva a `sdd-tester`,
en el proyecto de Vitest que ella misma fija (`AGENTS.md` § Cosas que
muerden: `*.test.ts` → `server`, `*.test.tsx` → `ui`, `*.db.test.ts` → `db`,
automático por extensión):

| Fichero                                                  | Proyecto | Qué cierra                                                                |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `src/features/zones/coverage.test.ts`                    | `server` | R1 (invariante), R5, R6, R7 — las cuatro funciones puras de `coverage.ts` |
| `src/features/zones/server/coverage.db.test.ts`          | `db`     | C1, C9 — la única consulta real, contra Postgres real                     |
| `src/features/zones/geometry.test.ts`                    | `server` | Caso límite 16 — el manifiesto committeado, exacto, contra el índice      |
| `src/features/zones/tiles.test.ts`                       | `server` | R18/D2 — las tres combinaciones del par                                   |
| `src/app/api/zones/geometry/[slug]/route.test.ts`        | `server` | Composición de la ruta: 404, `no-store`, cobertura vacía, `missing`       |
| `src/features/zones/components/ZonePicker.test.tsx`      | `ui`     | E2, E3, E6, R7 sobre el DOM                                               |
| `src/features/orders/server/createOrder.zone.db.test.ts` | `db`     | C3, C10, C13, C14 — contra Postgres real, con `createOrder()` de verdad   |
| `src/features/orders/server/pulledOrder.zone.db.test.ts` | `db`     | C4, E22, E23 — contra Postgres real, con el `select`/mapeo real del POS   |

Más un ajuste a un noveno fichero que ya existía y que la nueva prueba de
geometría legitima como importador: `src/features/zones/boundaries.test.ts`
crece a 10 entradas (`geometry.test.ts`, servidor, nunca un árbol de
cliente) — es la lista blanca que C15 exige que se mantenga en verde.

Las etapas `smoke` (`.agent/specs/F-042/smoke.sh`) y `visual`
(`.agent/specs/F-042/visual.mjs`) las dejó escritas y en verde
`sdd-implementer` (paso 19 del plan, asignado a él, no a mí); las ejecuté
tal cual, sin tocarlas, porque cierran C1/C6/C7/C9 (smoke) y C2/C5/C7/C8
(visual) con la app real levantada — lo que ningún test unitario o de `db`
puede demostrar por sí solo (una petición de red real, un contexto sin
JavaScript real).

**C11** no tiene fichero de test: es una medición. La regla 2 del método
("prueba el comportamiento, no la implementación") no aplica a un número, así
que se repitió con mi propia ejecución en vez de copiar la de
`sdd-implementer` — ver § Ejecuciones.

**C12** tampoco tiene fichero propio: es `bash .agent/verify.sh F-042 --full`
en `0`, ejecutado por mí varias veces a lo largo del ciclo.

## Mapa criterio → prueba

Los doce son los literales de `.agent/features.json`, en su orden. C13, C14 y
C15 se prueban (D8, `.agent/progress/F-042.md`) pero no cuentan casilla —
van al final, marcados `[D8]`.

| #          | Criterio (resumen)                                                                                                    | Prueba                                                                                                                                                                                                                                                                                                                                                            | Archivo                                                                                                                                                                                  | Resultado                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| C1         | Solo zonas con tarifa resoluble; `NOT_SERVED` bajo `FEE` no aparece, ni como código ni como nombre                    | `loadStoreZoneCoverage()` contra Postgres real, `23` `FEE 300` + `23.05` `NOT_SERVED` → 14 de 15, `23.05`/"Regla" ausentes; y el HTML REAL de `curl /el-faro/checkout` (smoke) sin `23.05` ni "Regla" en ninguna forma                                                                                                                                            | `src/features/zones/server/coverage.db.test.ts`, `.agent/specs/F-042/smoke.sh` § criterio 1                                                                                              | ✅ 9/9 + smoke ok                       |
| C2         | El importe se ve ANTES de confirmar y el total lo suma; `0` es envío gratis, comprobado contra `null`                 | `page.on("request")`+DOM real: elegir "Playa" muestra `+$250.00`/importe y el total suma `890+250=1140.00` **sin enviar nada**; con `FEE 0` dice "gratis" y el total vuelve al subtotal (visual V2); `deliveryFeeForNewOrder` con `deliveryFee: "0.00"` da `{kind:"charged", amount:"0.00"}`, nunca `zone_required` (unitario)                                    | `.agent/specs/F-042/visual.mjs` § V2, `src/features/orders/deliveryOffer.test.ts` (existente, ampliado por `sdd-implementer`), `src/features/zones/components/ZonePicker.test.tsx` § D11 | ✅ visual ok + 17/17 + 14/14            |
| C3         | El pedido guarda `zoneCode`/`zoneName`; `zoneName` es el que vio el comprador, inmune a un renombrado posterior       | Crea el pedido real vía `createOrder()` contra Postgres real con `23.01`; renombra `Zone.name` de `23.01` DESPUÉS; relee la fila del pedido y su pull (`toPulledOrder`): las dos siguen diciendo "Playa"                                                                                                                                                          | `src/features/orders/server/createOrder.zone.db.test.ts` § "C3 —…"                                                                                                                       | ✅ 5/5                                  |
| C4         | El pull entrega `contact.zoneCode`/`zoneName` y `deliveryFee` resuelto, `deliveryFeePending: false`                   | `toPulledOrder()` sobre una fila REAL con `deliveryZoneCode: "23.01"` → las dos claves con sus valores y `deliveryFeePending: false`; una fila sin zona → las dos claves presentes y `null`                                                                                                                                                                       | `src/features/orders/server/pulledOrder.zone.db.test.ts`, `src/features/orders/server/createOrder.zone.db.test.ts` § "C10 —…" (repite la comprobación desde la fila real recién creada)  | ✅ 5/5 + 5/5                            |
| C5         | Escritura predictiva SIN ninguna petición de geometría/teselas, comprobado en las peticiones de la página             | `page.on("request")` real: cargar, teclear tres letras y elegir una zona → **cero** peticiones de mapa en toda la sesión (visual V1)                                                                                                                                                                                                                              | `.agent/specs/F-042/visual.mjs` § V1                                                                                                                                                     | ✅ visual ok                            |
| C6         | El mapa se carga solo al pedirlo y sirve exactamente la cobertura declarada, en bytes y en número de polígonos        | `check-geometry-budget.mjs` contra la app real: 4 municipios → **4** zonas, 47 647 B; provincia entera (15 menos `NOT_SERVED`) → **14** zonas, 20 032 B; 2 provincias → **5** zonas, 51 806 B (smoke); más la composición de la ruta (mock) y la integridad del artefacto committeado (168 ficheros, hashes)                                                      | `.agent/specs/F-042/smoke.sh` § criterio 6, `src/app/api/zones/geometry/[slug]/route.test.ts`, `src/features/zones/geometry.test.ts`                                                     | ✅ smoke ok + 8/8 + 8/8                 |
| C7         | El paso de provincia existe si y solo si la cobertura cruza más de una                                                | `curl` real: con `23` sola, sin `>Provincia<`; con `23`+`22`, con él y con las dos provincias listadas (smoke); a nivel de DOM: `ZonePicker` no renderiza el `<select>` con una provincia y sí con dos, y acota la lista (unitario); `distinctProvinces()` puro con el caso de la Isla de la Juventud                                                             | `.agent/specs/F-042/smoke.sh` § criterio 7, `src/features/zones/components/ZonePicker.test.tsx` § E6, `src/features/zones/coverage.test.ts`                                              | ✅ smoke ok + 14/14 + 15/15             |
| C8         | El checkout requiere JavaScript; con JS deshabilitado se ve el `<noscript>` y ningún control de envío es operable     | Contexto Playwright `javaScriptEnabled: false` real sobre `/el-faro/checkout`: el `<noscript>` es visible y menciona JavaScript, y el botón de confirmar no es operable (visual V4)                                                                                                                                                                               | `.agent/specs/F-042/visual.mjs` § V4                                                                                                                                                     | ✅ visual ok                            |
| C9         | Sin ninguna zona resoluble, cero domicilio; `POST` con `DELIVERY` responde el error propio, cero pedidos nuevos       | Tres fixtures reales (vacío, solo `INHERIT`, solo `NOT_SERVED`) → `loadStoreZoneCoverage` da `[]` en los tres (db); `createOrder()` real con tarifario vacío → `delivery_zone_required`, contado antes/después de la tabla (db); tarifario retractado del todo + `curl`: HTML sin "¿Cómo lo quieres recibir?", `POST` real → `400 DELIVERY_ZONE_REQUIRED` (smoke) | `src/features/zones/server/coverage.db.test.ts` (fixtures 1/3-3/3), `src/features/orders/server/createOrder.zone.db.test.ts` § "E20/E17 —…", `.agent/specs/F-042/smoke.sh` § criterio 9  | ✅ 9/9 + 5/5 + smoke ok                 |
| C10        | `Order.deliveryFee IS NOT NULL` con el importe resuelto; la función no puede devolver "sin cotizar" para `ZONE_BASED` | `createOrder()` real → `Order.deliveryFee` = `"300.00"` (nunca `null`, nunca el residual de `Store`), pull con `deliveryFeePending: false` (db); `deliveryFeeForNewOrder` unitario: `ZONE_BASED` nunca da `{kind:"not_quoted"}`, y sin zona da `{kind:"zone_required"}` — nunca confundido con "sin cotizar"                                                      | `src/features/orders/server/createOrder.zone.db.test.ts` § "C10 —…", `src/features/orders/deliveryOffer.test.ts` (existente)                                                             | ✅ 5/5 + 17/17                          |
| C11        | El peso del JavaScript que este feature añade al checkout está medido y anotado                                       | Medición PROPIA, independiente de la del implementador: `git worktree` a `60e8edb` (antes de F-042), `npm install && npm run build` en las dos copias, `next start` en dos puertos, `<script src>` reales de `/tienda-demo/checkout` descargados y medidos con `zlib.gzipSync` — ver § Ejecuciones                                                                | (medición, sin fichero de test)                                                                                                                                                          | ✅ corroborada, con matices — ver abajo |
| C12        | `bash .agent/verify.sh F-042 --full` termina en `0`                                                                   | Ejecutado, no leído — ver § Ejecuciones                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                        | ✅ código `0`                           |
| C13 `[D8]` | El tarifario cambia entre cargar y confirmar: nadie paga de más ni de menos                                           | `createOrder()` real: sube la tarifa de `300` a `350` ANTES del `POST` con `expectedDeliveryFee: "300.00"` → `409 price_changed` con `delivery: {was:"300.00", now:"350.00"}`, **cero** pedidos nuevos; re-confirmar con `450.00` crea el pedido con `350.00`                                                                                                     | `src/features/orders/server/createOrder.zone.db.test.ts` § "C13 —…"                                                                                                                      | ✅ (no cuenta casilla)                  |
| C14 `[D8]` | La zona deja de servirse en esa misma ventana: no se crea un pedido de recogida en silencio                           | `createOrder()` real: `23.01` pasa a `NOT_SERVED` ANTES del `POST` → `{kind:"delivery_zone_not_served", zoneCode:"23.01"}`, **cero** pedidos nuevos, **cero** pedidos de recogida colados en su lugar                                                                                                                                                             | `src/features/orders/server/createOrder.zone.db.test.ts` § "C14 —…"                                                                                                                      | ✅ (no cuenta casilla)                  |
| C15 `[D8]` | El catálogo no llega al navegador                                                                                     | `npm test` mantiene verde `boundaries.test.ts` con su lista blanca creciada a 10 (el nuevo `geometry.test.ts`, servidor), y ninguno de los 10 vive en `src/components/`, un `.tsx` de `src/app/` ni un `*/components/**`                                                                                                                                          | `src/features/zones/boundaries.test.ts` (editado: +1 entrada)                                                                                                                            | ✅ 2/2 (no cuenta casilla)              |

Ningún criterio quedó sin fila.

## Ejecuciones

Todas ejecutadas por mí en este ciclo, contra Postgres real (`docker-compose.yml`,
puerto 5433, ya sembrado) y con la app levantada donde hacía falta.

### El sensor completo, tres veces (una al empezar, dos al terminar)

```
$ bash .agent/verify.sh F-042 --full
[intento 40, antes de escribir nada] PASA — harness·typecheck·lint·format·test·prisma·build·theme·bundle
$ bash .agent/verify.sh F-042 --full
[intento 43, tras los ocho ficheros y el ajuste a boundaries.test.ts] PASA
$ bash .agent/verify.sh F-042 --full
[intento 46, final] PASA
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     9s
  ✓ test       30s
  ✓ prisma     0s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s
```

Código de salida en los tres: **`0`**. Cierra **C12**.

`npm test` dentro de la corrida final: **1741 passed (162 test files)** —
+69 tests y +8 ficheros sobre el baseline de 1672/154 que dejó
`sdd-implementer`.

```
$ bash .agent/verify.sh F-042 --smoke
[intento 41 y 44] PASA — smoke 5-6s
$ bash .agent/verify.sh F-042 --visual
[intento 42 y 45] PASA — visual 13-14s
```

Salidas reales guardadas por el arnés en `.agent/runs/F-042/044-smoke.log` y
`.agent/runs/F-042/045-visual.log`, con lo que escribió el servidor. Cifras
citadas en la tabla de arriba (20 032 B/14 zonas, 47 647 B/4 zonas,
51 806 B/5 zonas para C6; "890 + 250 = 1,140.00" y "el total vuelve al
subtotal ($890.00)" para C2) están copiadas literalmente de esos logs, no
recalculadas.

### Por fichero, los ocho nuevos

```
$ npx vitest run src/features/zones/coverage.test.ts --project=server
  Tests  15 passed (15)
$ npx vitest run src/features/zones/tiles.test.ts --project=server
  Tests  6 passed (6)
$ npx vitest run src/features/zones/geometry.test.ts --project=server
  Tests  8 passed (8)
$ npx vitest run "src/app/api/zones/geometry/[slug]/route.test.ts" --project=server
  Tests  8 passed (8)
$ npx vitest run src/features/zones/components/ZonePicker.test.tsx --project=ui
  Tests  14 passed (14)
$ npx vitest run src/features/zones/server/coverage.db.test.ts --project=db
  Tests  9 passed (9)
$ npx vitest run src/features/orders/server/pulledOrder.zone.db.test.ts --project=db
  Tests  5 passed (5)
$ npx vitest run src/features/orders/server/createOrder.zone.db.test.ts --project=db
  Tests  5 passed (5)
$ npx vitest run src/features/zones/boundaries.test.ts --project=server
  Tests  2 passed (2)
```

Los tres ficheros `db` corren contra Postgres real (`createFixtureSession()`,
el mismo arnés que `tariffs.db.test.ts`/`zoneTariff.db.test.ts` de F-041):
filas reales de `ZoneTariff`, `Zone`, `Store`, `Order`, `Slug`, leídas y
escritas de verdad, nunca mockeadas.

### C11 — medición propia, no copiada

Método (paralelo al del implementador, ejecutado de cero por mí):

```
$ git worktree add --detach <scratch>/f042-baseline 60e8edb
$ cd <scratch>/f042-baseline && npm install && npm run db:generate && npm run build
$ cd <repo> && npm run build   # el árbol actual, con F-042 completo
$ PORT=3910 npm run start   # baseline, en el worktree
$ PORT=3911 npm run start   # F-042, en el árbol actual
$ curl .../tienda-demo/checkout   # las dos, comparando <script src>
# descarga cada script y mide con node:zlib (gzipSync nivel 9)
```

| Medición                                        | Antes (10 scripts) | Después (11 scripts) | Delta                    |
| ----------------------------------------------- | ------------------ | -------------------- | ------------------------ |
| JS de primera carga del checkout, sin comprimir | 611 245 B          | 625 782 B            | **+14 537 B (+14.2 KB)** |
| JS de primera carga del checkout, gzip (mío)    | 189 527 B          | 194 621 B            | **+5 094 B (+5.0 KB)**   |

El trozo del mapa, identificado buscando la cadena `"leaflet"` dentro de los
chunks servidos (nunca adivinado por tamaño):

| Pieza                                        | Sin comprimir | gzip (mío)             |
| -------------------------------------------- | ------------- | ---------------------- |
| JS (`leaflet`+`react-leaflet`+`ZoneMap.tsx`) | 152 963 B     | 44 219 B (43.2 KB)     |
| CSS (hoja de leaflet)                        | 10 572 B      | 2 640 B (2.6 KB)       |
| **Total**                                    | **163 535 B** | **46 859 B (45.8 KB)** |

Artefacto de geometría, contado directamente sobre los ficheros committeados:
**887 000 B = 0.85 MB** en 169 ficheros (168 + manifiesto).

**Comparación con `.agent/progress/F-042.md` (medición de `sdd-implementer`):**
el JS sin comprimir y el tamaño del artefacto de geometría **coinciden byte a
byte** (611 245→625 782/+14 531 vs mi +14 537, una diferencia de 6 B
achacable a un timestamp/hash distinto en algún chunk entre las dos corridas
de build; 152 963 B y 887 000 B, exactos). Los totales **gzip** difieren en
menos de 100 B (mi +5 094 vs su +5 104 en el delta del checkout; mi 46 859
frente a su 46 796 en el trozo del mapa) — la causa es el método: yo comprimí
cada fichero suelto con `zlib.gzipSync(nivel 9)`, mientras que el número del
implementador salió de la compresión real de `next start` sobre la red. Las
dos cifras redondean al **mismo** KB (+5.0 KB, 45.7-45.8 KB), así que mi
medición **corrobora** la suya y no la contradice — lo digo aquí explícitamente
porque la regla es "si no coincide, la mía manda", y en este caso sí coincide,
dentro del margen que explica el método.

## Fallos encontrados

Ninguno de severidad para el código de producto. Dos fricciones de mi propia
autoría al escribir las pruebas, resueltas con patrones que YA existían en el
repositorio (ninguna ficha nueva: la lección ya estaba escrita, solo se
aplicó):

1. **`Prisma.Decimal.toString()` no rellena los decimales** (`"300"`, no
   `"300.00"`) — ya lo documenta el propio código de `zoneTariff.db.test.ts`
   de F-041 con el mismo patrón (`.toString()` comparado contra `"300"`).
   Arreglado en mis dos assertions leyendo `Order.deliveryFee` con
   `money(x.toString(), "CUP").amount` en vez de comparar `.toString()`
   pelado. Descartado sin ficha: no es un hallazgo, es no haber mirado el
   precedente la primera vez.
2. **`resolvePublicSlug()` revienta con `Invariant: incrementalCache missing`
   fuera de un `next dev`/`next start` real** al llamar a `createOrder()`
   directamente desde un `.db.test.ts` — la misma clase de problema que
   `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`
   ya explica para `revalidateTag` (mismo mecanismo de `next/cache`, disparado
   por una lectura envuelta en `unstable_cache` en vez de por una escritura).
   Arreglado con el mismo `vi.mock("next/cache", ...)` que esa ficha y
   `storePublishGate.db.test.ts` (F-022) ya usan, aplicado tal cual al
   principio de `createOrder.zone.db.test.ts`. No fichado aparte: el síntoma
   textual difiere (`incrementalCache` vs `static generation store`) pero el
   mecanismo y el arreglo son EXACTAMENTE los mismos que la ficha ya cubre, y
   la propia ficha generaliza a "cualquier camino que llegue de verdad hasta
   [`next/cache`]" — no solo `revalidateTag`.

`bash .agent/verify.sh pending F-042` → **vacío**, confirmado ejecutando.
Ninguno de los dos puntos de arriba llegó a producir un fallo capturado por
el sensor (los descubrí iterando fichero a fichero con `npx vitest run`
directo, antes de correr `--full`), así que no hay nada que fichar o
descartar en ese registro.

## Huecos de cobertura

- **La fidelidad visual pixel a pixel frente a `design.md`** (microcopy exacto
  de cada estado, el ajuste de 44 px de los controles de zoom de Leaflet, el
  modo oscuro del marco del mapa) sigue sin verificarse uno por uno — es la
  misma deuda que `impl.md` ya declaró y que ningún criterio de
  `features.json` exige verificar exhaustivamente. `visual.mjs` cubre los
  estados que los criterios sí piden (V1-V5); no cubre el resto del inventario
  de `design.md` § «Inventario de pantallas y estados» (los ocho grupos), y
  eso queda fuera de mi frontera: ampliar `visual.mjs` a los 17 puntos de
  `design.md` § «Verificación visual» completa no es un criterio de
  `features.json` y el plan no lo pidió como paso propio.
- **El `aria-live` de "N municipios coinciden"** (deuda ya declarada en
  `impl.md`) no está implementado, así que tampoco hay nada que probar sobre
  él — lo confirmé leyendo `ZoneCombobox.tsx`: no hay ningún elemento
  `aria-live` en el árbol. No es un criterio.
- **IP1 (la sustitución del método de la comprobación 1 del generador de
  geometría) sigue pendiente de decisión del humano.** No es mío resolverlo
  (es una decisión de `sdd-implementer`/humano sobre el generador, no sobre
  las pruebas), y no bloquea ningún criterio de este ciclo: la geometría YA
  está generada, committeada, y `geometry.test.ts` prueba el artefacto que
  existe — no regenera nada ni vuelve a correr las comprobaciones 1/2. Si el
  humano pide una regeneración con otro método, `geometry.test.ts` sigue
  siendo la prueba correcta sin cambios (comprueba el resultado, no el
  método).

## Veredicto

**LISTO.** Los doce `acceptance_criteria` de `.agent/features.json` se
verificaron **ejecutando** — comando y salida real para cada uno, tabla de
arriba —, incluida una medición propia e independiente del criterio 11 que
corrobora la del implementador. `bash .agent/verify.sh F-042 --full` termina
en `0`, `bash .agent/verify.sh pending F-042` está vacío, y los tres
`[D8]` (C13, C14, C15) también se probaron, sin contar casilla, como pidió
la decisión del humano.

## Preguntas al humano

Ninguna nueva de este agente. **IP1** (arriba, § Huecos de cobertura) sigue
abierta desde `sdd-implementer` y `.agent/progress/F-042.md` — no la repito
como `TP` porque no es mía y no bloquea ningún criterio de este ciclo; queda
anotada aquí solo para que no se pierda de vista al cerrar el feature.
