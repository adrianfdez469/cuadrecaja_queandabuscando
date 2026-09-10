---
feature: F-044
agente: sdd-tester
actualizado: 2026-09-10T14:05:00Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, y cada uno en el entorno que `AGENTS.md` § «Cosas que muerden»
obliga por extensión:

- **Puro, sin base** (`*.test.ts`, proyecto `server`):
  `src/features/sync/reconciliationHash.test.ts` — R3-R10, el golden de R14
  (esqueleto extraído contra el vector de productos ya publicado) y el vector
  del tarifario **leído del documento** (E15a, E16).
- **Contra Postgres real** (`*.db.test.ts`, proyecto `db`):
  `src/features/sync/server/reconciliationTariff.db.test.ts` (E2-E10, E13-E15b,
  E17, E18) y el guardián sin tocar `src/features/sync/server/reconciliation.db.test.ts`
  (R14, con las dos líneas de IP1).
- **HTTP contra la app levantada**: `scripts/check-reconciliation.mjs`, que
  `verify.sh` **no** corre — lo hice yo, a mano, contra `npm run dev` real,
  con `--all` y `--empty`.

Además de reejecutar lo anterior, verifiqué **independientemente** —fixtures
propios, SQL propio, un script de comparación propio contra `git show HEAD:`,
y una edición real del contrato que se revierte— todo lo que el encargo pidió
romper. El detalle de cada comando está en «Ejecuciones».

## Mapa criterio → prueba

| Criterio de aceptación                                                     | Prueba                                                                                                                                                                                                  | Archivo                                                                                                    | Resultado |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| 1. § publica hash del tarifario con pseudocódigo + SQL espejo, E13/E14     | Copié el bloque `sql` **literal** de `docs/sync-contract.md:3492` y lo corrí contra `ZoneTariff` con el uuid interno de `seed-tienda-1`; comparé con el endpoint; corrí las dos lecturas ingenuas (E14) | `docs/sync-contract.md` § «El hash del tarifario de envío (v13.4)» + verificación manual (ver Ejecuciones) | **LISTO** |
| 2. Dos sucursales distintas → hashes distintos; misma dos veces → igual    | `reconciliationTariff.db.test.ts` (E2/E3) + verificación manual con fixtures propios y HTTP real                                                                                                        | `src/features/sync/server/reconciliationTariff.db.test.ts`                                                 | **LISTO** |
| 3. Aplicar `ZONE_TARIFF` mueve el hash de esa sucursal y de ninguna otra   | `reconciliationTariff.db.test.ts` (E5-E8) + `POST /api/internal/sync/catalog` real contra dos sucursales + el borde de `INHERIT` sin fila previa (no-op)                                                | `src/features/sync/server/reconciliationTariff.db.test.ts` + verificación manual                           | **LISTO** |
| 4. Sucursal sin filas → hash definido y estable, leído                     | `reconciliationTariff.db.test.ts` (E9/E10) + `check-reconciliation.mjs --empty` contra servidor real                                                                                                    | `src/features/sync/server/reconciliationTariff.db.test.ts` + `scripts/check-reconciliation.mjs`            | **LISTO** |
| 5. Vector en el contrato, calculado ejecutando, y el test lee el documento | `reconciliationHash.test.ts` (E15a/E16) + edición real de un valor del bloque → rojo → revertido → verde                                                                                                | `src/features/sync/reconciliationHash.test.ts`                                                             | **LISTO** |
| 6. `docs/sync-contract.md` sube de versión                                 | `sed -n 3p`, grep de la entrada `v13.4` en § «Cambios respecto a la v12.2»                                                                                                                              | `docs/sync-contract.md`                                                                                    | **LISTO** |
| 7. `bash .agent/verify.sh F-044 --full` termina en 0                       | Ejecutado tres veces en esta sesión, siempre 0                                                                                                                                                          | —                                                                                                          | **LISTO** |

Los siete criterios tienen fila. Ninguno quedó sin cubrir.

## Ejecuciones

### Criterio 7 — el sensor

```
$ bash .agent/verify.sh F-044 --full
== Verificación F-044 · intento 12 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       5s
  ✓ format     11s
  ✓ test       34s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     1s
PASA
$ echo $?
0
```

Corrido al empezar, después de todas las manipulaciones manuales de esta
sesión sobre `ZoneTariff` y `docs/sync-contract.md` (todas revertidas), y una
tercera vez al final. Las tres veces, **0**.
`bash .agent/verify.sh pending F-044` → vacío, las tres veces.

### Criterio 1 — el SQL espejo, copiado literal, contra Postgres real

Extraje el bloque exacto de `docs/sync-contract.md:3492-3503` (el que empieza
`SELECT count(*) AS tariffs, ...`) con `sed`, sin transcribirlo a mano.
Levanté un fixture propio en `seed-tienda-1`
(uuid `5f7d4d71-4d6a-42b4-838a-d134844b142f`) — deliberadamente **distinto**
del vector del contrato, para que la verificación no fuera circular — con un
importe con ceros de relleno (`1200.00`) y una fila `INHERIT`:

```sql
23.05 FEE 1200.00 · 23.01 NOT_SERVED · 21 INHERIT · 21.05 FEE 75.30
```

```
$ curl -s ".../reconciliation?storeId=seed-tienda-1" -H "Authorization: Bearer ..."
{"products":15,"hash":"5ac8fdab9036c8a32946f742939d4601","tariffs":3,"tariffHash":"1b1122ef2238ca8750f0308bd7a55749"}

$ docker exec queandabuscando-postgres psql ... -c "<SQL copiado literal, $1 sustituido>"
 tariffs |            tariffHash
---------+----------------------------------
       3 | 1b1122ef2238ca8750f0308bd7a55749
```

**Coinciden.** Después, las dos lecturas ingenuas de E14 contra el mismo
fixture:

```
(a) sin trim/round del importe:  tariffs=3  tariffHash=d9f1a27a75fb9021478e2a6b09edb66d  (≠ 1b1122ef…)
(b) sin excluir INHERIT:         tariffs=4  tariffHash=51e1c8eb3b0918bbdcdd90d7f5e45ac2  (≠ 1b1122ef…)
```

Las dos difieren del hash real, como exige E14. Fixture limpiado después
(`DELETE FROM "ZoneTariff" WHERE "storeId"='5f7d…'`).

### Criterio 2 — E2/E3 contra Postgres real, con fixture propio

Ya cubierto arriba: `seed-tienda-1` con 3 filas (`tariffHash`
`1b1122ef…`) y `seed-tienda-2` sin filas (`tariffHash` = md5 vacío) son
distintos entre sí (E3), y releer la misma sucursal sin cambios de por medio
—repetí la lectura de `seed-tienda-1` tras el no-op de `INHERIT` (ver
criterio 3)— dio el mismo `tariffHash` byte a byte (E2).

### Criterio 3 — `POST /api/internal/sync/catalog` real, antes/después, dos sucursales

```
antes  A=seed-tienda-1: tariffs=0 tariffHash=d41d8c…   B=seed-tienda-2: tariffs=0 tariffHash=d41d8c…

POST ZONE_TARIFF { zoneCode: "22", rule: "FEE", deliveryFee: 150.00 } sobre A → "processed"

después A: tariffs=1 tariffHash=a23851c9c0e1fccc857125972d6f4e62  (cambió)
        B: tariffs=0 tariffHash=d41d8c…  (idéntico byte a byte)
```

**El borde que señaló el orquestador — `INHERIT` sobre una zona SIN fila
previa, no-op semántico:**

```
POST ZONE_TARIFF { zoneCode: "24", rule: "INHERIT" } sobre A (A no tenía fila en "24")
después: A tariffs=1 tariffHash=a23851c9... (IDÉNTICO al de antes de este POST)
fila escrita de verdad: SELECT ... → 24 | INHERIT | (null)   ← el evento SÍ se aplicó y escribió
```

**Confirmado: el `ZONE_TARIFF INHERIT` sobre una zona sin fila previa se
aplica (`processed`, la fila queda escrita) pero no mueve `tariffs` ni
`tariffHash`** — es exactamente R3, «`INHERIT` no publica nada», y es el
costo aceptado y escrito en el contrato, no un fallo. Verificado ejecutando,
no supuesto.

E7 (la retracción converge) y E6 (`stale` no mueve nada), también contra el
servidor real:

```
POST ZONE_TARIFF { zoneCode: "22", rule: "INHERIT", updatedAt más nuevo } → tariffs 1→0, tariffHash → d41d8c… (EMPTY_HASH)
POST ZONE_TARIFF { zoneCode: "22", rule: "FEE", deliveryFee: 999, updatedAt VIEJO } → {"status":"stale"}; releído: sin cambios
```

E17, ambas mitades, contra Postgres real con datos no triviales (no el caso
trivial de `tariffs: 0` de antes):

```
Fixture: A con una fila ZoneTariff (tariffs=1, tariffHash=0cb1e552…)
POST PRODUCT price=777.77 sobre A → 207 processed
después: hash de productos cambió (5ac8fda…→92fafff…); tariffs=1 y tariffHash=0cb1e552… IDÉNTICOS
```

Fixture limpiado después de cada bloque.

### Criterio 4 — sucursal sin filas, leída del endpoint real

```
$ node scripts/check-reconciliation.mjs --empty
OK   --empty (seed-tienda-8) -> 200 {"products":0,"hash":"d41d8cd98f00b204e9800998ecf8427e","tariffs":0,"tariffHash":"d41d8cd98f00b204e9800998ecf8427e"}
```

Y E10 (solo filas `INHERIT`, contra Postgres real, un fixture propio en
`seed-tienda-2` con dos filas `INHERIT` y ninguna otra):

```
{"products":5,"hash":"a9b316e...","tariffs":0,"tariffHash":"d41d8cd98f00b204e9800998ecf8427e"}
```

Ninguna es `null`, ninguna es cadena vacía, ninguna es `500`.

### Criterio 5 — el vector se lee del documento, prueba definitiva

```
$ npx vitest run reconciliationHash --project server   # antes de tocar nada
Tests  20 passed (20)

# edité a mano docs/sync-contract.md:3594, un dígito del tariffHash publicado
# (...cadee7 → ...cadee8), sin tocar ningún otro byte

$ npx vitest run reconciliationHash --project server
FAIL  ... T1: tariffReconciliation() matches the contract's own published entries...
  Expected: "a67d37235e3dc5c803b469bfe9cadee8"
  Received: "a67d37235e3dc5c803b469bfe9cadee7"
FAIL  ... E16: the contract's published sha256 matches this block's actual bytes
  Expected: "461437dd951bcd6436237cf95c0ab0c75deb664a8ce221ebce9909d2414ed01e"
  Received: "8ca6bfdbf30382ee3b98c45f43d1eb1c86fdbc2d52115ebbef023a8a372982ca"
Tests  2 failed | 18 passed (20)

# revertido con cp del backup tomado antes de la edición
$ npx vitest run reconciliationHash --project server
Tests  20 passed (20)
$ git diff --stat docs/sync-contract.md   # comparado contra el backup, 0 diferencias
```

Prueba definitiva confirmada: el test lee el documento de verdad, no una
copia transcrita — tocar un byte del bloque lo pone en rojo, y en **dos**
lugares (el valor comparado y el `sha256` recalculado). Revertido, el repo
queda exactamente como lo dejó `sdd-implementer`.

### Criterio 6 — versión del contrato

```
$ sed -n '3p' docs/sync-contract.md
**Versión 13.4** · 10 de septiembre de 2026 — **BORRADOR, sin publicar.** Sale...

$ grep -n "v13.4 (F-044" docs/sync-contract.md
51:**v13.4 (F-044, 10 de septiembre de 2026).** ⑤ Reconciliación gana el hash del...
```

`bash .claude/hooks/sync-contract-version.sh` no protesta (parte del
`format` de `verify.sh --full`, en verde).

### R14, byte a byte — no solo el golden del implementador

Además de correr `reconciliation.db.test.ts` (el guardián, verde, 5 passed),
escribí mi propio script de comparación: copié la función
`storeReconciliationHash` tal como estaba en `HEAD` (antes de F-044, con
`git show HEAD:src/features/sync/server/reconciliation.ts`) a un archivo
temporal, y comparé sus `{products, hash}` contra la función actual, para
cuatro sucursales reales, incluida una con catálogo real (`seed-tienda-1`, 15
productos):

```
seed-tienda-1  old={"products":15,"hash":"5ac8fdab9036c8a32946f742939d4601"}  new={products:15,hash:"5ac8fdab9036c8a32946f742939d4601"}  MATCH=true
seed-tienda-2  old={"products":5, "hash":"a9b316e03672b99a41d928d93347a198"}  new={products:5, hash:"a9b316e03672b99a41d928d93347a198"}  MATCH=true
seed-tienda-3  old={"products":0, "hash":"d41d8c…"}                          new={products:0, hash:"d41d8c…"}                          MATCH=true
seed-tienda-8  old={"products":0, "hash":"d41d8c…"}                          new={products:0, hash:"d41d8c…"}                          MATCH=true
```

Byte a byte, iguales, sobre una sucursal con catálogo real y no solo sobre el
golden literal del vector de productos. El archivo temporal
(`__oldReconciliation.ts`, en el mismo directorio que `reconciliation.ts`,
por crear-y-borrar durante esta verificación) se borró antes de terminar; no
quedó en el árbol.

### E15b, independiente — el vector T1 insertado tal cual en una sucursal real

Inserté las cinco filas literales de `T1` en `seed-tienda-1` y llamé a
`storeReconciliationHash` directamente:

```
{"products":15,"hash":"92fafff5ff0d5e9807463f882dad9b3a","tariffs":4,"tariffHash":"a67d37235e3dc5c803b469bfe9cadee7"}
```

`tariffs` y `tariffHash` coinciden exactamente con lo publicado en el
contrato para `T1`. Fixture limpiado después.

### `scripts/check-reconciliation.mjs` — el paso que `verify.sh` no corre

```
$ npm run dev &            # servidor real, puerto 3000
$ node scripts/check-reconciliation.mjs --all
OK   --store=seed-tienda-1 -> 200 { products: 15, hash: ..., tariffs: 0, tariffHash: d41d8c... }
OK   --price: ... hash cambió, products sin cambiar
OK   --availability: ... hash cambió, products sin cambiar, restaurado a AVAILABLE
OK   --unknown-store -> 404 {"error":"UNKNOWN_STORE"}
OK   --other-business (seed-tienda-7) -> 404 {"error":"UNKNOWN_STORE"}, igual que --unknown-store
OK   --empty (seed-tienda-8) -> 200 {"products":0,"hash":"d41d8c…","tariffs":0,"tariffHash":"d41d8c…"}
Todas las comprobaciones pasaron.
$ echo $?
0
```

Cubre H1 (las dos afirmaciones de forma de cuatro claves) y `--empty` (paso
10 del plan), el único que ninguna etapa de `verify.sh` vigila.

### El orden de las claves de la respuesta

```
$ curl -s ".../reconciliation?storeId=seed-tienda-1" ... | grep -o '"[a-zA-Z]*":'
"products": "hash": "tariffs": "tariffHash":
```

Exactamente el orden que `scripts/check-reconciliation.mjs` da por sentado
(`H1`) y que `route.test.ts` fija con `toEqual` sin relajar (I5).

### La colisión de la expresión regular

```
$ npx vitest run src/features/zones/precedence.test.ts --project server
Tests  16 passed (16)

$ grep -n "sha256 del bloque JSON del vector" docs/sync-contract.md
920:**sha256 del bloque JSON del vector (v13):**
3628:**sha256 del bloque JSON del vector del tarifario (v13.4):**
```

Sigue verde y sigue comparando **su** hash: la cadena que ancla su regex
(`sha256 del bloque JSON del vector (v13):`) aparece **una sola vez** en todo
el documento, en la línea 920, y la frase nueva de F-044 (línea 3628) no la
contiene como substring (lleva ` del tarifario` en medio) — confirmado con
`grep`, no leído de la prosa.

### Comandos de reejecución directa

```
$ npx vitest run src/features/sync/reconciliationHash.test.ts --project server      → 20 passed
$ npx vitest run src/features/sync/server/reconciliationTariff.db.test.ts --project db → 15 passed
$ npx vitest run src/features/sync/server/reconciliation.db.test.ts --project db       → 5 passed
$ npx vitest run src/app/api/internal/reconciliation/route.test.ts --project server    → 7 passed
```

## Fallos encontrados

Ninguno. Los 12 pasos del plan están construidos y se comportan como la spec
exige, verificado ejecutando contra Postgres real y contra el servidor de
desarrollo real, con fixtures propios además de los del implementador.

## Huecos de cobertura

- **El agujero documentado en D3/R18** —que una fila que sobra de este lado
  no se puede borrar y solo la corrige un `ZONE_TARIFF` con `INHERIT`
  posterior— es correcto **como diseño**, pero esta sesión no tiene forma de
  probar el lado de cuadrecaja (su tabla no existe, D1): eso lo dice el
  propio contrato y no es un hueco de este feature.
- **`scripts/check-reconciliation.mjs`** no tiene un modo dedicado que
  ejercite `tariffs`/`tariffHash` moviéndose (solo `--store` los lee, sin
  moverlos) — lo hice yo a mano con `curl`/`POST` directos, pero el script en
  sí no lo automatiza. No es un criterio de F-044 (el plan no lo pedía, según
  `impl.md` § «Qué necesita quien pruebe»), lo dejo anotado para quien
  retome: un `--tariff` análogo a `--price`/`--availability` sería barato y
  cerraría este hueco de una vez.
- **Colisión de md5** (caso límite 10 de spec.md): teórico, no se probó ni
  hacía falta — la spec ya lo acepta explícitamente.

## Veredicto

**LISTO.** Los siete criterios de `.agent/features.json` se verificaron
ejecutando: contra Postgres real con fixtures propios (no solo los del
implementador), contra el servidor de desarrollo real vía HTTP, con una
comparación byte a byte contra la versión pre-F-044 del código
(`git show HEAD:`), y con una edición real y revertida del contrato para
probar que el test del vector lee el documento y no una copia.
`bash .agent/verify.sh F-044 --full` → **código de salida 0**, corrido tres
veces en esta sesión. `bash .agent/verify.sh pending F-044` → vacío.

El borde que el orquestador señaló —`ZONE_TARIFF INHERIT` sobre una zona sin
fila previa— es un no-op semántico confirmado ejecutando: el evento se aplica
y la fila queda escrita, pero `tariffs`/`tariffHash` no se mueven. Es el
costo aceptado de R3, escrito en el contrato, no un fallo.

## Preguntas al humano

Ninguna. Los siete criterios se verificaron tal como están escritos, sin
ambigüedad de interpretación.
