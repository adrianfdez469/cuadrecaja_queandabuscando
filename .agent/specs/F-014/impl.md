---
feature: F-014
agente: sdd-implementer
actualizado: 2026-08-31T23:32:21Z
estado: listo
---

## Qué se construyó

Pasos 1–7 del plan firmado. Los pasos 8–10 (los tres `*.db.test.ts`/`route.test.ts`
y `tests.md`) son del probador y no se tocaron.

| Archivo                                                     | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                        | Criterio que cubre  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `src/lib/byteOrder.ts`                                      | `utf8SortKey(value)` (la clave `Buffer`) y `compareUtf8Keys(a, b)` (el comparador sobre esas claves) son las dos primitivas; `compareUtf8Bytes(a, b) = compareUtf8Keys(utf8SortKey(a), utf8SortKey(b))` se define en términos de ellas, en vez de tener su propia implementación paralela. Puro, sin Prisma                                                                                                     | C12 (mitad pura)    |
| `src/lib/byteOrder.test.ts`                                 | Aserción doble sobre el par astral `"�"` / `"\u{10000}"`: el comparador da `U+FFFD, U+10000`, `.sort()` da el contrario y produce un hash `md5` distinto                                                                                                                                                                                                                                                        | C12 entero          |
| `src/features/sync/server/reconciliation.ts`                | `orderBy` fuera del `findMany`; ordena en Node con clave precalculada por fila usando `utf8SortKey` e importando `compareUtf8Keys` de `src/lib/byteOrder.ts` (no una llamada a `Buffer.from`/`Buffer.compare` a pelo); extrae `reconciliationEntry(row)` y `ReconciliationRow` derivado del `select` `as const` vía `Prisma.StoreProductGetPayload`. Firma y retorno de `storeReconciliationHash()` sin cambios | R1, R8, base de C8  |
| `src/features/marketplace/server/dbFixtures.ts`             | Dos `overrides` opcionales nuevos en `createOffer`: `syncedPrice` y `syncedPriceCurrency`, texto decimal exacto, nunca `number`. `availability` ya existía                                                                                                                                                                                                                                                      | habilita 4 y 5      |
| `scripts/check-reconciliation.mjs`                          | Siete modos (`--store=`, `--price`, `--availability`, `--unknown-store`, `--other-business`, `--empty`, `--all`). HTTP puro, sin `import` de Prisma, estilo de `send-catalog-batch.mjs`                                                                                                                                                                                                                         | C1, C2, C5, C6, C10 |
| `docs/sync-contract.md` § ⑤                                 | SQL espejo completo de R13 con sus cuatro decisiones, el orden `COLLATE "C"`, el límite honesto de R15, y el vector de prueba de cuatro filas con su md5 verificado                                                                                                                                                                                                                                             | C7 (parte 1)        |
| `docs/sync-contract.md` § «Vocabulario de errores (v5)»     | Fila `400 {"error":"MISSING_STORE_ID"}`, marcada como aclaración de algo ya implementado                                                                                                                                                                                                                                                                                                                        | C7 (parte 2), R18   |
| `docs/sync-contract.md` § ① (`payload` de `PRODUCT`, tabla) | Precondición de los ≤2 decimales de `price`, con el dato medido (`2.675` → `"2.67"` aquí, `"2.68"` con `round` en Postgres)                                                                                                                                                                                                                                                                                     | C7 (parte 3), R7    |
| `docs/despliegue.md` § 7.5 (nueva)                          | El techo de catálogo: 100 000 filas vivas por tienda, aviso a 50 000                                                                                                                                                                                                                                                                                                                                            | ninguno (operación) |

Ningún archivo de la lista de "no tocar" se modificó: `route.ts`, `guard.ts`,
`prisma/schema.prisma`, la firma/retorno de `storeReconciliationHash()`, el
`select` de cuatro columnas, `md5`, `tenantScoping.db.test.ts`. Sin
migraciones, sin `prisma migrate reset`/`db push`.

## Desviaciones

- **Desviación real, detectada y cerrada en este mismo ciclo: el paso 2 del
  plan dice «ordena en Node con el comparador del paso 1», y la primera
  versión que escribí no lo hacía.** `storeReconciliationHash()` llamaba a
  `Buffer.from`/`Buffer.compare` directamente sobre la clave precalculada, y
  `src/lib/byteOrder.ts` solo exportaba `compareUtf8Bytes` — una función que
  nada en `src/` ni en `scripts/` importaba (buscando `byteOrder` y
  `compareUtf8Bytes` fuera de `byteOrder.ts`/`byteOrder.test.ts` no aparecía
  nada). Las dos implementaciones eran semánticamente
  idénticas ese día, pero el acoplamiento entre lo probado y lo ejecutado era
  un comentario, no algo que el compilador o el test pudieran hacer fallar:
  si `reconciliation.ts:77` hubiera derivado mañana hacia `.sort()` a secas o
  `localeCompare`, `byteOrder.test.ts` habría seguido en verde y C12 habría
  seguido "pasando" sin proteger nada — el mismo tipo de criterio vacuo que
  ya se corrigió una vez en `spec.md` (los seis `externalId` hostiles) y en
  `architecture.md` (el riesgo de que C8 comparase el SQL consigo mismo). El
  orquestador lo señaló al revisar y quedó cerrado así: `src/lib/byteOrder.ts`
  ahora exporta también `utf8SortKey(value): Buffer` y
  `compareUtf8Keys(a, b): number` —las dos primitivas que la producción
  necesita— y `compareUtf8Bytes` pasa a definirse como
  `compareUtf8Keys(utf8SortKey(a), utf8SortKey(b))` en vez de tener su propia
  implementación paralela. `reconciliation.ts` importa y llama
  `utf8SortKey`/`compareUtf8Keys` directamente (confirmado con el mismo
  `grep`, que ahora sí muestra el uso desde `reconciliation.ts`), así que
  `byteOrder.test.ts` vuelve a cubrir la ruta real por composición, y una
  regresión futura del `sort()` de producción deja de compilar (import sin
  usar) en vez de fallar en silencio. La medición de 132 ms/312 ms no se
  perdió: sigue siendo una clave por fila, cero re-codificación dentro del
  comparador.
- **`docs/despliegue.md` § 7.5 es una subsección nueva**, no una fila en una
  tabla existente: no había ningún lugar natural en el §7 actual para un
  límite de catálogo por tienda, y crear una subsección propia (en vez de
  forzarla dentro de §7.2 o §7.4, que hablan de otra cosa) mantiene cada
  bloque enfocado en una sola idea. No cambia el contrato con cuadrecaja ni
  ninguna otra sección.

## Comandos ejecutados

- `bash .agent/verify.sh F-014` → **0** después de cada uno de los pasos 1–4
  (typecheck · lint · format · test).
- `bash .agent/verify.sh F-014 --full` → **0** tras los pasos 5–7 (harness ·
  typecheck · lint · format · test · prisma · build · theme · bundle), última
  corrida:

  ```
  == Verificación F-014 · intento 18 ==
    ✓ harness    0s
    ✓ typecheck  1s
    ✓ lint       5s
    ✓ format     6s
    ✓ test       15s
    ✓ prisma     1s
    ✓ build      4s
    ✓ theme      0s
    ✓ bundle     1s

  PASA
  ```

  Repetido tras cerrar la desviación de § Desviaciones (`utf8SortKey`/
  `compareUtf8Keys`), intento 24: mismas nueve etapas, **0** otra vez.

- El md5 del vector de prueba de § ⑤ se calculó ejecutando, no a mano:
  `docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando`
  sobre un `VALUES` de cuatro filas literales (`id` ∈ `{a,b,c,d}`, precios
  `1990.00`/`1990.50`/`1990.10`/`0.00`) con la traducción exacta del SQL de
  R13/R15, y verificado por segunda vez calculando el md5 de la misma cadena
  concatenada con `node -e 'crypto.createHash("md5")...'`. Los dos caminos
  dieron `62e399684e3a8eafadaae58391537955`.

- **El script del paso 4, contra la app real** (no lo cubre `verify.sh`):
  `npm run mint:token -- seed-negocio-1` para acuñar el token, `.env` con
  `QAB_BEARER_TOKEN` actualizado, `npm run dev` en segundo plano, y:

  ```
  $ node scripts/check-reconciliation.mjs --all
  OK   --store=seed-tienda-1 -> 200 { products: 15, hash: f136219fe3aedf6c4f77dc15c7f26d5f }
  OK   --price: price=59.2 -> hash f136219fe3aedf6c4f77dc15c7f26d5f != 5971e78181f5e243b1005dabae33bc79, products sin cambiar
  OK   --availability: AVAILABLE -> OUT_OF_STOCK, hash 5971e78181f5e243b1005dabae33bc79 != b675ab3dffb1f0288cd003b591abe2ca, products sin cambiar, restaurado a AVAILABLE
  OK   --unknown-store -> 404 {"error":"UNKNOWN_STORE"}
  OK   --unknown-store -> 404 {"error":"UNKNOWN_STORE"}
  OK   --other-business (seed-tienda-7) -> 404 {"error":"UNKNOWN_STORE"}, igual que --unknown-store
  OK   --empty (seed-tienda-8) -> 200 {"products":0,"hash":"d41d8cd98f00b204e9800998ecf8427e"}

  Todas las comprobaciones pasaron.
  $ echo $?
  0
  ```

  Los siete modos individuales (`--store=`, `--price`, `--availability`,
  `--unknown-store`, `--other-business`, `--empty`) se corrieron también por
  separado, cada uno con salida 0. Nota: en una corrida anterior, el hash de
  `seed-tienda-1` en reposo salió `e894ce15e77dfc0f8ba94d10cb2d8eed` — el
  mismo valor "correcto" que `spec.md` R4 midió sobre esa misma tienda antes
  de este ciclo, lo que confirma que el cambio de orden (D1) no movió el hash
  de un dato que ya era un UUID canónico (R8: "para `externalId` con forma de
  UUID… ambos órdenes coinciden igualmente"). El servidor de desarrollo se
  detuvo (`pkill -f "next dev"`) al terminar esta verificación.

## Deuda dejada

Ninguna. Los siete pasos del implementador están completos y verificados.

## Qué necesita quien pruebe

- Entorno: `bash .agent/init.sh`, Postgres local levantado (puerto 5433 vía
  Docker), `npm run seed` si la base no tiene los fixtures `seed-tienda-1`
  (15 productos, negocio `seed-negocio-1`), `seed-tienda-7` (negocio
  `seed-negocio-2`, ajeno) y `seed-tienda-8` (marca `el-trebol`, `PUBLISHED`,
  cero productos).
- Para el script HTTP: `npm run mint:token -- seed-negocio-1`, exportar el
  valor impreso como `QAB_BEARER_TOKEN` (o pasarlo con `--token=`), y
  `npm run dev` levantado. `node scripts/check-reconciliation.mjs --all` tiene
  que salir 0; cada modo individual también.
- `reconciliationEntry(row)` y `ReconciliationRow` son exports nuevos de
  `src/features/sync/server/reconciliation.ts` — es donde C8/C9 tienen que
  anclar la comparación con el SQL espejo (D3: el SQL de la prueba se escribe
  a mano, nunca componiéndolo desde este código, o C8 deja de comparar dos
  implementaciones independientes).
- `createOffer(storeId, canonicalProductId, { syncedPrice, syncedPriceCurrency })`
  en `src/features/marketplace/server/dbFixtures.ts` ya acepta las cuatro
  formas de precio de C9 (`"1990.00"`, `"1990.50"`, `"1990.10"`, `"0.00"`)
  como texto decimal exacto.
- El vector de prueba de § ⑤ de `docs/sync-contract.md` (`id` ∈ `{a,b,c,d}`,
  precios `1990.00`/`1990.50`/`1990.10`/`0.00`, `hash` esperado
  `62e399684e3a8eafadaae58391537955`) es una referencia externa al script y a
  los tests: no depende de ninguna fixture de sesión, así que sirve para
  contrastar el SQL espejo del test C8 con un número fijo si algo no cuadra.
- Frágil: la suite `db` corre en serie (`fileParallelism: false`) y tenía
  19,42 s sobre 7 archivos antes de este ciclo; el archivo nuevo
  (`reconciliation.db.test.ts`, del probador) tiene ~2 s de presupuesto
  (architecture.md § Escalabilidad, plan B en R-B si se agota).

## Preguntas al humano

Ninguna. El plan no dejó ningún paso 1–7 ambiguo ni bloqueado.
