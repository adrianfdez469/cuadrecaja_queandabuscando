---
feature: F-014
agente: sdd-tester
actualizado: 2026-08-31T23:50:09Z
estado: listo
veredicto: listo
---

## Estrategia

Cuatro archivos, tres entornos, como fija `architecture.md` D4 — nadie escribió
más de uno de los tres artefactos del probador en la misma mano que el código
que verifica (el implementador hizo 1–7, este agente 8–10):

| Archivo                                                             | Proyecto vitest | Toca la base  | Criterios           |
| ------------------------------------------------------------------- | --------------- | ------------- | ------------------- |
| `src/lib/byteOrder.test.ts` (paso 1, del implementador — no tocado) | `server`        | No            | C12                 |
| `src/features/sync/server/reconciliation.db.test.ts` (nuevo)        | `db`            | Sí            | C3, C4, C8, C9      |
| `src/app/api/internal/reconciliation/route.test.ts` (nuevo)         | `server`        | No (mocks)    | C11                 |
| `scripts/check-reconciliation.mjs` (paso 4, del implementador)      | —, HTTP puro    | Sí (por HTTP) | C1, C2, C5, C6, C10 |
| `docs/sync-contract.md` + `docs/despliegue.md` (documental)         | —               | —             | C7                  |

`*.test.ts` → proyecto `server` (node). `*.db.test.ts` → proyecto `db`, en
serie (`fileParallelism: false`). Ninguno de los dos nuevos es `.test.tsx`, así
que ninguno corre en jsdom (AGENTS.md § Cosas que muerden).

## Mapa criterio → prueba

| Criterio | Prueba                                                                                                                                                                      | Archivo                                                                       | Resultado                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C1       | `--store=seed-tienda-1` → `200`, exactamente `{products,hash}`, hash de 32 hex                                                                                              | `scripts/check-reconciliation.mjs`                                            | OK, ejecutado                                                                                |
| C2       | `--price` y `--availability`: hash antes/después, `products` sin cambiar                                                                                                    | `scripts/check-reconciliation.mjs`                                            | OK, ejecutado                                                                                |
| C3       | Escribir `description`/`imageUrls`/`priceOverride` (+5 más, C4) no mueve products/hash                                                                                      | `reconciliation.db.test.ts` → "panel/derived fields never move the hash"      | PASS (5 tests, 633ms)                                                                        |
| C4       | Igual, con las 8 columnas (no solo las 3 de `features.json`): `priceOverrideCurrency`, `visible`, `featured`, `searchDocument`, `searchVector`                              | mismo test que C3                                                             | PASS                                                                                         |
| C5       | `--unknown-store` → `404 UNKNOWN_STORE`                                                                                                                                     | `scripts/check-reconciliation.mjs`                                            | OK, ejecutado                                                                                |
| C6       | `--other-business` (`seed-tienda-7`) → mismo `404` byte a byte que C5                                                                                                       | `scripts/check-reconciliation.mjs`                                            | OK, ejecutado                                                                                |
| C7       | § ⑤ con SQL de R13 completo + 4 decisiones + límite honesto de R15; fila `400 MISSING_STORE_ID`; precondición ≤2 decimales en § ① y § ⑤; vector de prueba                   | `docs/sync-contract.md`, `docs/despliegue.md` § 7.5                           | Confirmado por inspección + `verify.sh --full` en 0 (incluye `check:harness`/`format:check`) |
| C8       | SQL de R15 (`$queryRaw`, `Prisma.sql`, `storeId` ligado) da mismo `products`/`hash` que la función; la variante sin normalizar (`"syncedPrice"::text`) da hash **distinto** | `reconciliation.db.test.ts` → "SQL mirror (R15) vs storeReconciliationHash()" | PASS (2 tests)                                                                               |
| C9       | `1990.00/1990.50/1990.10/0.00` entran como `1990/1990.5/1990.1/0`, comparado contra **literales**                                                                           | `reconciliation.db.test.ts` → "C9: … against literals"                        | PASS                                                                                         |
| C10      | `--empty` (`seed-tienda-8`) → `200 {"products":0,"hash":"d41d8cd98f00b204e9800998ecf8427e"}`, nunca `404`                                                                   | `scripts/check-reconciliation.mjs`                                            | OK, ejecutado                                                                                |
| C11      | `200`, `400` sin `storeId`/vacío, `404`, `401` sin cabecera (no `400`), `503` sin cabecera y sin token acuñado                                                              | `route.test.ts`                                                               | PASS (7 tests, 139ms)                                                                        |
| C12      | Comparador puro sobre el par astral U+FFFD/U+10000; `.sort()` da el orden y hash contrarios                                                                                 | `byteOrder.test.ts` (paso 1, no tocado)                                       | PASS (3 tests, 121ms)                                                                        |

Ningún criterio sin fila.

## Anti-vacuidad: cada aserción cruzada se hizo fallar a propósito

Antes de dar por bueno cualquiera de los tres criterios que ya mordieron una
vez en este feature (C8, C9, C12 — ver `impl.md` § Desviaciones), rompí el
código bajo prueba y comprobé que el test correspondiente se pone en rojo, y
luego lo restauré byte a byte (`diff` contra `git show HEAD:<archivo>` → vacío,
`bash .agent/verify.sh F-014 --full` → 0 después de restaurar):

- **C9/C8** — cambié `reconciliationEntry` para usar `syncedPrice.toFixed(2)`
  en vez de `.toString()` (reintroduce el cero de cola que R4 prohíbe).
  Resultado: C9 falla comparando `"…:1990.00:…"` recibido contra
  `"…:1990:…"` esperado; C8 falla porque el hash de la función ya no coincide
  con el SQL normalizado. Los dos cayeron, como tenían que.
- **C3/C4** — añadí `visible` al `select`/a `reconciliationEntry` (justo el
  campo que la spec señala como "el que un administrador cambia a diario").
  Resultado: el test de C3/C4 falla (`before` y `after` dejan de ser iguales
  byte a byte), y de rebote C8 y C9 también caen (el hash de la función ya no
  es el que produce el SQL espejo, que no tiene `visible`) — confirma que las
  tres pruebas están atadas al mismo código real, no a una copia.
- **C11** — cambié el cuerpo del `400` de `route.ts` a `MISSING_STORE_ID_X`.
  Las dos aserciones que comparan el cuerpo literal (sin `storeId` y con
  `storeId` vacío) fallaron; las demás (`200`, `404`, `401`, `503`) siguieron
  en verde, que es lo esperado — no es un test que falle en bloque por
  cualquier cosa.

Ninguno de los tres cambios de prueba de fallo se dejó en el árbol: cada
restauración se verificó con `diff` contra el árbol de git, no solo releyendo
el archivo.

## Ejecuciones

**`bash .agent/verify.sh F-014 --full` → 0** (harness · typecheck · lint ·
format · test · prisma · build · theme · bundle), última corrida limpia tras
restaurar los tres archivos de la sección anterior:

```
== Verificación F-014 · intento 29 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       6s
  ✓ format     6s
  ✓ test       23s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s

PASA
```

**`npx vitest run --project db src/features/sync/server/reconciliation.db.test.ts`**
(C3, C4, C8, C9), archivo nuevo del paso 8:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  633ms (transform 88ms, setup 136ms, import 12ms, tests 409ms, environment 0ms)
```

Presupuesto del plan: ~2s. Real: 633ms, muy por debajo. La suite `db` completa
con este archivo añadido: **8 archivos, 82 pruebas, 17,60s** — dentro del
mismo orden de magnitud que los 7 archivos/77 pruebas/19,42s que
`architecture.md` medía antes de este ciclo (la variación es ruido de
máquina, no una regresión: el archivo nuevo por sí solo tarda 633ms). No hizo
falta el plan B de R-B (fundir C3/C4 en `tenantScoping.db.test.ts`).

**`npx vitest run --project server src/app/api/internal/reconciliation/route.test.ts`**
(C11), archivo nuevo del paso 9:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  139ms
```

**`npx vitest run --project server src/lib/byteOrder.test.ts`** (C12, paso 1,
no tocado — confirmado en verde, no reescrito):

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  121ms
```

**El script del paso 4, con la app levantada de verdad** (no lo cubre
`verify.sh`): `npm run mint:token -- seed-negocio-1` acuñó un token nuevo,
`npm run dev` en segundo plano (confirmado con `lsof`/`ps` que el proceso en
:3000 es el `next-server` de **este** checkout, no otro worktree — AGENTS.md §
Cosas que muerden), y:

```
$ QAB_BEARER_TOKEN=<token acuñado arriba> node scripts/check-reconciliation.mjs --all
OK   --store=seed-tienda-1 -> 200 { products: 15, hash: 5971e78181f5e243b1005dabae33bc79 }
OK   --price: price=376.53 -> hash 5971e78181f5e243b1005dabae33bc79 != 678adb04b29b65d9d8d152c4420f01c7, products sin cambiar
OK   --availability: AVAILABLE -> OUT_OF_STOCK, hash 678adb04b29b65d9d8d152c4420f01c7 != 1084d2e7e621e03e4e90d5c96fe38503, products sin cambiar, restaurado a AVAILABLE
OK   --unknown-store -> 404 {"error":"UNKNOWN_STORE"}
OK   --unknown-store -> 404 {"error":"UNKNOWN_STORE"}
OK   --other-business (seed-tienda-7) -> 404 {"error":"UNKNOWN_STORE"}, igual que --unknown-store
OK   --empty (seed-tienda-8) -> 200 {"products":0,"hash":"d41d8cd98f00b204e9800998ecf8427e"}

Todas las comprobaciones pasaron.
$ echo $?
0
```

El servidor de desarrollo se detuvo (`kill`/`pkill -f "next dev"`, confirmado
sin procesos residuos) al terminar. Cubre C1, C2, C5, C6, C10.

**C7, documental**, verificado leyendo (no solo confiando en `impl.md`):

- `docs/sync-contract.md:786-872` — § "El SQL espejo (aclaración aditiva, sin
  bump de versión)" tiene el SQL de R13 completo (`ProductoTienda pt JOIN
Producto p`), las cuatro decisiones numeradas, el párrafo "El orden es de
  bytes, no el de una colación", la precondición de los ≤2 decimales con el
  dato `2.675`, el límite honesto ("No valida los nombres de las columnas de
  cuadrecaja, ni el `JOIN` con `Producto`, ni el `coalesce` de
  `dispPublicada`") y el vector de prueba con `hash = 62e399684e3a8eafadaae58391537955`.
  Confirmado con `grep -n "MISSING_STORE_ID\|62e399684e3a8eafadaae58391537955"
docs/sync-contract.md`, sin tocar el valor (el humano ya lo verificó por dos
  caminos independientes; no lo recalculé).
- `docs/sync-contract.md:167` — fila `400` · `{"error":"MISSING_STORE_ID"}` en
  § «Vocabulario de errores (v5)».
- `docs/sync-contract.md:261` — `"price": 450, // ≤ 2 decimales …` en § ①.
- `docs/despliegue.md:252-257` — § 7.5, el techo de 100 000/50 000.
- `bash .agent/verify.sh F-014 --full` → 0, que ejecuta `npm run
check:harness` y `npm run format:check` sobre estos mismos `.md` (arriba).

**`bash .agent/verify.sh pending F-014` → vacío.** No quedó ningún fallo del
ciclo sin fichar o descartar.

## Fallos encontrados

Ninguno nuevo en el código de producción de los pasos 1–7. Los tres "fallos"
de esta sesión fueron deliberados —romper el código para comprobar que la
prueba correspondiente cae— y quedan documentados y revertidos en § Ejecuciones
y § Anti-vacuidad, no como deuda pendiente.

`bash .agent/verify.sh pending F-014` está vacío: no hubo ningún fallo real del
sensor en este ciclo que necesitara ficha (el único rojo que sí ocurrió, un
`format:check` sobre `reconciliation.db.test.ts` recién escrito, es la firma ya
fichada `prettier-sin-formatear` — `npm run format` lo resolvió en el primer
intento, sin necesitar una ficha nueva).

## Huecos de cobertura

- **`--price`/`--availability` del script escriben sobre `seed-tienda-1`, una
  tienda real de la base compartida**, no sobre una fixture de sesión (D7 lo
  autoriza expresamente: son parte del contrato HTTP y `npm run seed` los
  restaura). Si dos worktrees corrieran el script en paralelo sobre la misma
  tienda, podrían pisarse — riesgo aceptado por la arquitectura, no nuevo de
  este ciclo.
- **R15 no prueba el `JOIN` con `Producto` ni el `coalesce` de
  `dispPublicada`**, tal como el propio documento dice: eso solo lo puede
  verificar cuadrecaja con su propia base. No es un hueco de esta prueba sino
  un límite reconocido y escrito (R15, y repetido en `docs/sync-contract.md`).
- **Concurrencia real entre una escritura del sync y una lectura de
  reconciliación** no se probó (spec.md lo marca como aceptable: "la próxima
  corrida converge"). Ningún criterio lo exige.

## Veredicto

**LISTO.** Los 12 criterios de `spec.md` (C1–C12) y los 5
`acceptance_criteria` de `features.json` están verificados ejecutando algo:
comando, salida real, código de salida — no lectura de código. `bash
.agent/verify.sh F-014 --full` → 0 y `bash .agent/verify.sh pending F-014` →
vacío.

Ningún archivo de la lista de "no tocar" del encargo se modificó:
`byteOrder.ts`, `reconciliation.ts`, `dbFixtures.ts`,
`check-reconciliation.mjs`, `docs/sync-contract.md`, `docs/despliegue.md`,
`byteOrder.test.ts` y `tenantScoping.db.test.ts` quedaron exactamente como los
dejó el implementador (confirmado con `diff` contra `git show HEAD:<archivo>`
tras cada prueba de fallo deliberada de § Anti-vacuidad). No se encontró
ningún fallo real en ellos que reportar a otro agente.

## Preguntas al humano

Ninguna. Todos los criterios eran verificables tal como quedaron escritos en
`spec.md`, y no encontré ningún fallo cuya gravedad fuera una decisión de
producto.
