---
feature: F-032
agente: sdd-tester
actualizado: 2026-09-01T22:05:00Z
estado: listo
veredicto: listo
---

## Estrategia

Paso 14 del plan firmado: los criterios 1–6 y 10 **no** los prueba ningún test
unitario — piden columnas de Postgres tras un lote HTTP real contra el
servidor de desarrollo. Los 7–9, 11 y 14 son de prosa/estructura y se
verifican leyendo/grepeando el artefacto exacto que citan. Los 12, 13 y 15 son
comandos ya escritos por el plan/spec.

Entorno usado:

- Postgres del `docker-compose.yml` de este worktree (`queandabuscando-postgres`,
  puerto 5433). Sin `psql` instalado en el host: todas las consultas van por
  `docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc "…"`.
- `next dev` levantado por mí en este ciclo (no había ninguno corriendo:
  `ps aux | grep "next dev"` vacío antes de empezar), en el puerto 3000 de
  este worktree — comprobado con `ps aux`/`lsof -iTCP:3000` que el proceso
  (`PID 11001/11002`) vive en
  `/Users/adrian/orca/workspaces/queandabuscando/snapper` (ficha
  `next-dev-uno-por-directorio`).
- `QAB_BEARER_TOKEN` estaba vacío en `.env` (lo confirma el plan/impl.md).
  Acuñado con `npm run mint:token -- seed-negocio-1` (autorizado explícitamente
  por el orquestador: ningún otro worktree sostenía un token) y añadido a
  `.env` (que está en `.gitignore`, confirmado con `git check-ignore -v .env`
  antes de tocarlo) para que `dotenv/config` lo recoja en los guiones.

**Hallazgo de montaje, no de producto — la consulta `$CINCO` de `spec.md` no
encuentra fila.** `spec.md` propone `SELECT … FROM "Store" WHERE
slug='tienda-demo'`. Desde la migración de F-017, `Store.slug` es `NULL` para
cualquier tienda sin `ownSlug` propio — es exactamente la ficha
`pull-orders-mjs-store-slug-nulo-tras-f017.md`, pero esa ficha solo advertía
de `scripts/pull-orders.mjs`, no de la consulta que trae la propia `spec.md`
para este ciclo. Comprobado: `SELECT slug,"externalId" FROM "Store" WHERE
"externalId"='seed-tienda-1'` devuelve `slug` vacío. El público `tienda-demo`
vive en `"Slug".value='tienda-demo'` (`kind='STOREFRONT'`), no en la columna.
Sustituí `$CINCO` por
`SELECT "checkoutMode","deliveryEnabled","deliveryFee","deliveryFeeMode","orderExpiryHours" FROM "Store" WHERE "externalId"='seed-tienda-1'`
en todos los criterios de abajo — es el mismo filtro que usa el propio handler
(`where: { externalId: payload.storeId }`, `src/features/sync/server/handlers/store.ts`).
Anotado en § Fallos encontrados, no bloquea nada.

## Mapa criterio → prueba

| #   | Criterio (resumen)                               | Comando                                                                                                                          | Resultado                                                                                                                                                                              | Veredicto        |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | Omitir no es apagar                              | `UPDATE` a valores no-default → `psql` antes → `send-catalog-batch.mjs` → `psql` después                                         | `207 processed`; fila idéntica antes/después (`ONSITE\|t\|500.00\|QUOTED_PER_ORDER\|6`)                                                                                                | LISTO            |
| 2   | Aplicarlas se ve en el checkout sin reiniciar    | `--store-config` → `POST /api/orders/quote` → `jq .store`; y navegador en `/tienda-demo/checkout`                                | `store.checkoutMode/deliveryEnabled/deliveryFee/deliveryFeeMode` = los nuevos, sin reiniciar; checkout muestra "Envío a domicilio · Costo por confirmar"                               | LISTO            |
| 3   | Opcionalidad (forma v6 exacta)                   | `node scripts/send-catalog-batch.mjs` (sin banderas)                                                                             | `207`, `status: "processed"` en los dos eventos, sin `issues`                                                                                                                          | LISTO            |
| 4   | Valor inválido → `400` y nada escrito            | `--store-config=<decimals\|negative\|hours-zero\|hours-max\|bad-mode\|bad-checkout>`, fila y conteo de `SyncEvent` antes/después | `400 INVALID_BATCH` en los seis; fila y conteo de `SyncEvent` idénticos en los seis                                                                                                    | LISTO            |
| 5   | Combinación contradictoria                       | `--store-config=contradictory`; fila fabricada `FLAT_RATE`+`NULL` + `--store-config=enable-only`; invariante R8                  | `contradictory` → `400`; `enable-only` → `207` con `status:"failed"`, `error:"STORE_DELIVERY_CONFIG_INCONSISTENT"`, fila y `sourceUpdatedAt` intactos; `count(*)` del invariante = `0` | LISTO            |
| 6   | Rancio                                           | `--stale --store-config`                                                                                                         | `207`, `status:"stale"` en el evento `STORE`; fila idéntica antes/después                                                                                                              | LISTO            |
| 7   | El panel no las escribe                          | `grep -rn` de las cinco en `src/features/admin/`; `npx vitest run boundaries`                                                    | Único hallazgo: la lista `FORBIDDEN_WRITE_COLUMNS` de `boundaries.test.ts` (no una escritura); 6 archivos, 27 tests en verde                                                           | LISTO            |
| 8   | Comentario del schema                            | `grep -n -A4 orderExpiryHours prisma/schema.prisma`                                                                              | Cita a cuadrecaja y a la ADR 0028; no dice "queandabuscando-owned" ni "the sync never sends it"                                                                                        | LISTO            |
| 9   | El contrato (v7)                                 | `head -3 docs/sync-contract.md`; grep de las cinco/tabla de propiedad/§ cuadrecaja; hook                                         | `**Versión 7**`; las cinco en el payload; `Tabla de propiedad de campos` existe; `Cambios requeridos en cuadrecaja` existe; hook no protesta (simulado con `tool_input.file_path`)     | LISTO            |
| 10  | Aditivo                                          | `prisma migrate diff` (flags adaptados a Prisma 7); `ls`/`git diff` de `prisma/migrations`; `GROUP BY` de columnas               | Ninguna migración nueva (`git diff main --stat -- prisma/migrations` vacío); `git diff main -- prisma/schema.prisma` es solo el comentario `///`; ver nota de Prisma 7 en § Fallos     | LISTO (con nota) |
| 11  | ADR                                              | `ls docs/adr/0028-…`; `grep 0028` en el contrato y el schema                                                                     | Existe; citada en `sync-contract.md` (2 veces) y en `prisma/schema.prisma`                                                                                                             | LISTO            |
| 12  | `verify.sh F-019 --full` → 0                     | `bash .agent/verify.sh F-019 --full`                                                                                             | `PASA`, 9/9 etapas, código `0` (dos corridas)                                                                                                                                          | LISTO            |
| 13  | `verify.sh F-032 --full` → 0                     | `bash .agent/verify.sh F-032 --full`                                                                                             | `PASA`, 9/9 etapas, código `0`                                                                                                                                                         | LISTO            |
| 14  | `docs/despliegue.md` sin `UPDATE "Store"` a mano | `grep -n 'UPDATE "Store"' docs/despliegue.md`                                                                                    | Sin resultado; § 9.5 explica que la config llega por el sync (ADR 0028 citada)                                                                                                         | LISTO            |
| 15  | Test de handler cubre E1, E10, E11               | `npx vitest run src/features/sync/server/handlers/store.test.ts`                                                                 | Bloque «criterio 15» con E1/E3/E8/E9/E10/E11/E13, los tres pedidos presentes; 22/22 en verde                                                                                           | LISTO            |

**Extra pedida, sin número propio**: `node scripts/send-store-batch.mjs` no
borra `description`/`address`/`city`/`whatsapp` de `tienda-demo` — comprobado
con `psql` antes y después, idénticos. LISTO.

Los 15 tienen comando ejecutado y salida real. Ninguno se verificó solo
leyendo código, salvo 8, 9, 11 y 14 (que son literalmente de prosa, como
autoriza la carta del ciclo).

## Ejecuciones

### Montaje — valores no-default para el criterio 1

```
$ docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
  "UPDATE \"Store\" SET \"checkoutMode\"='ONSITE', \"deliveryEnabled\"=true, \"deliveryFee\"=500.00, \"deliveryFeeMode\"='QUOTED_PER_ORDER', \"orderExpiryHours\"=6 WHERE \"externalId\"='seed-tienda-1';"
UPDATE 1
```

### Criterio 1

```
$ psql … "SELECT … FROM \"Store\" WHERE \"externalId\"='seed-tienda-1';"   # antes
ONSITE|t|500.00|QUOTED_PER_ORDER|6

$ node scripts/send-catalog-batch.mjs
HTTP 207
{ "ok": ["evt-product-…","evt-store-…"], "failed": [],
  "results": [{"eventId":"evt-product-…","status":"processed"},
              {"eventId":"evt-store-…","status":"processed"}] }

$ psql … "SELECT … FROM \"Store\" WHERE \"externalId\"='seed-tienda-1';"   # después
ONSITE|t|500.00|QUOTED_PER_ORDER|6
```

Idénticas, byte a byte. `npm run seed` no se ejecutó en ningún momento del
ciclo.

### Criterio 3

Mismo lote de arriba: forma exacta de la v6 salvo el `STORE` que el propio
guion añade (R20) — ninguno de los dos eventos trae ninguna de las cinco
claves, `207` con `status: "processed"` en los dos, sin `issues`.

### Criterio 2

```
$ node scripts/send-catalog-batch.mjs --store-config
HTTP 207
{ "ok": [...], "failed": [],
  "results": [{"eventId":"evt-store-…","status":"processed"},
              {"eventId":"evt-product-…","status":"processed"}] }

$ psql … "SELECT … WHERE \"externalId\"='seed-tienda-1';"
ONSITE|t|750.50|QUOTED_PER_ORDER|6

$ curl -s -X POST localhost:3000/api/orders/quote -H 'content-type: application/json' \
  -d '{"storeSlug":"tienda-demo","items":[{"storeProductId":"f92622e8-4d15-48a8-8287-8ebef09fc7a7","qty":1}]}' | jq .store
{
  "slug": "tienda-demo",
  "name": "La Rampa · Vedado",
  "currencyCode": "CUP",
  "checkoutMode": "ONSITE",
  "deliveryEnabled": true,
  "deliveryFee": "750.5",
  "deliveryFeeMode": "QUOTED_PER_ORDER"
}
```

Sin reiniciar `next dev` en ningún momento entre el lote y el `curl`.
Verificación adicional en navegador (Chrome, pestaña MCP), sobre la MISMA
corrida del servidor: `/tienda-demo` → producto → `Agregar al carrito` →
`/tienda-demo/checkout` muestra **"Envío a domicilio · Costo por confirmar"**
como opción, junto a "Recoger en la tienda", exactamente lo que predicen
`deliveryEnabled: true` + `QUOTED_PER_ORDER`. No se confirmó el pedido (solo
se navegó); `SELECT count(*) FROM "Order" WHERE "storeId"='5f7d4d71-…'` no
cambió por esta visita.

### Criterio 4 (los seis casos, formato `before → 400 → after`)

```
decimals:     before ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4
              HTTP 400 INVALID_BATCH — deliveryFee "must be a multiple of 0.01"
              after  ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4   UNCHANGED
negative:     before ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4
              HTTP 400 INVALID_BATCH — deliveryFee "expected number to be >=0"
              after  ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4   UNCHANGED
hours-zero:   before ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4
              HTTP 400 INVALID_BATCH — orderExpiryHours "expected number to be >=1"
              after  ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4   UNCHANGED
hours-max:    before ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4
              HTTP 400 INVALID_BATCH — orderExpiryHours "expected number to be <=8760"
              after  ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4   UNCHANGED
bad-mode:     before ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4
              HTTP 400 INVALID_BATCH — deliveryFeeMode "expected one of FLAT_RATE|QUOTED_PER_ORDER"
              after  ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4   UNCHANGED
bad-checkout: before ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4
              HTTP 400 INVALID_BATCH — checkoutMode "expected one of WHATSAPP|ONSITE"
              after  ONSITE|t|750.50|QUOTED_PER_ORDER|6 cnt=4   UNCHANGED
```

`cnt` = `SELECT count(*) FROM "SyncEvent"`; los seis quedan en `4` antes y
después: ningún `SyncEvent` se escribió para ninguno de los eventos del lote,
del bueno tampoco (el `400` es del lote entero, no de un evento suelto).

### Criterio 5

```
$ node scripts/send-catalog-batch.mjs --store-config=contradictory
HTTP 400
{ "error": "INVALID_BATCH",
  "issues": [{"path":["events",1,"payload","deliveryFee"],
              "message":"STORE_DELIVERY_CONFIG_INCONSISTENT"}] }
```

Fila fabricada a mano (única `UPDATE` manual de montaje del caso E8, tal como
autoriza el ciclo):

```
$ psql … "UPDATE \"Store\" SET \"deliveryFeeMode\"='FLAT_RATE', \"deliveryFee\"=NULL, \"deliveryEnabled\"=false WHERE \"externalId\"='seed-tienda-1';"
UPDATE 1
```

```
before: ONSITE|f||FLAT_RATE|6|2026-09-01 21:50:21.939   cnt=4

$ node scripts/send-catalog-batch.mjs --store-config=enable-only
HTTP 207
{ "ok": ["evt-product-…"],
  "failed": [{"id":"evt-store-…","error":"STORE_DELIVERY_CONFIG_INCONSISTENT"}],
  "results": [{"eventId":"evt-product-…","status":"processed"},
              {"eventId":"evt-store-…","status":"failed",
               "error":"STORE_DELIVERY_CONFIG_INCONSISTENT"}] }

after:  ONSITE|f||FLAT_RATE|6|2026-09-01 21:50:21.939   cnt=6
```

Fila y `sourceUpdatedAt` **idénticos** (R11, comprobado explícitamente: la
marca de tiempo no avanzó ni un milisegundo). `cnt` sube de `4` a `6` porque
el `PRODUCT` del mismo lote sí se procesa y queda registrado — es el `207`
mixto que exige la spec, no una escritura de `Store`.

```
$ psql … "SELECT count(*) FROM \"Store\" WHERE \"deliveryEnabled\" AND \"deliveryFeeMode\"='FLAT_RATE' AND \"deliveryFee\" IS NULL AND \"sourceUpdatedAt\" > now() - interval '5 minutes';"
0
```

### Criterio 6

```
before: ONSITE|f||FLAT_RATE|6

$ node scripts/send-catalog-batch.mjs --stale --store-config
HTTP 207
{ "ok": ["evt-store-…","evt-product-…"], "failed": [],
  "results": [{"eventId":"evt-store-…","status":"stale"},
              {"eventId":"evt-product-…","status":"stale"}] }

after:  ONSITE|f||FLAT_RATE|6
```

### Criterio 7

```
$ grep -rn -E "checkoutMode|deliveryEnabled|deliveryFeeMode|orderExpiryHours|deliveryFee" src/features/admin/
src/features/admin/server/boundaries.test.ts:50:  "checkoutMode",
src/features/admin/server/boundaries.test.ts:51:  "deliveryEnabled",
src/features/admin/server/boundaries.test.ts:52:  "deliveryFee",
src/features/admin/server/boundaries.test.ts:53:  "deliveryFeeMode",
src/features/admin/server/boundaries.test.ts:54:  "orderExpiryHours",

$ npx vitest run boundaries
Test Files  6 passed (6)
     Tests  27 passed (27)
```

Único sitio donde aparecen las cinco: la lista `FORBIDDEN_WRITE_COLUMNS`, no
una escritura.

### Criterio 8

```
$ grep -n -A4 "orderExpiryHours" prisma/schema.prisma
267:  /// F-019 R5/R20 first assigned `orderExpiryHours` to queandabuscando.
268-  /// F-032 REVERSES that: owned by cuadrecaja from the v7 contract on. It
269-  /// arrives OPTIONAL in the STORE payload's purchase configuration, and a
270-  /// STORE event that omits it leaves the column exactly as it was ("omitir
271-  /// no es apagar" — docs/adr/0028-configuracion-de-compra-del-pos.md). What
```

### Criterio 9

```
$ head -3 docs/sync-contract.md
# Contrato de integración cuadrecaja ↔ queandabuscando

**Versión 7** · 1 de septiembre de 2026

$ grep -n -i "propiedad" docs/sync-contract.md
536:##### Tabla de propiedad de campos (F-032, semilla del criterio 4 de F-022)
…

$ grep -n "Cambios requeridos en cuadrecaja" docs/sync-contract.md
1358:## Cambios requeridos en cuadrecaja
```

Hook, simulado con el `stdin` que espera un `PostToolUse` real (`jq` sobre
`tool_input.file_path`), contra el estado real del árbol (línea 3 en
`Versión 7`, `HEAD` todavía en `Versión 6` porque el ciclo del implementador
no ha comiteado):

```
$ echo '{"tool_input":{"file_path":"docs/sync-contract.md"}}' | bash .claude/hooks/sync-contract-version.sh
$ echo $?
0
```

Sin salida y código `0`: no protesta, porque la línea 3 sí se movió.

### Criterio 10

`spec.md` propone `--from-schema-datasource`/`--to-schema-datamodel`; Prisma
**7.9.1** (la versión de este repo) los quitó — ver § Fallos encontrados. Con
los flags vigentes:

```
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
[*] Changed the `CanonicalProduct` table
  [-] Removed index on columns (name)
  [-] Removed index on columns (searchVector)
[*] Changed the `StoreProduct` table
  [-] Removed index on columns (searchDocument)
  [-] Removed index on columns (searchVector)
$ echo $?
2
```

No es `0` literal, pero **no es F-032**: es la quinta trampa fichada en
`AGENTS.md` § Cosas que muerden («`prisma migrate dev` propone `DROP INDEX`
de índices que no están en el schema» — los mismos cuatro/cinco índices GIN).
Confirmado que F-032 no la causa:

```
$ git diff main -- prisma/schema.prisma
… solo el comentario /// de orderExpiryHours (11 líneas, ninguna genera SQL) …

$ git diff main --stat -- prisma/migrations
(sin salida)

$ ls prisma/migrations | tail -3
20260901052204_order_bell_window
20260901165226_quoted_delivery_fee
migration_lock.toml
```

Ninguna migración nueva, y el único cambio del schema es un comentario. El
`GROUP BY` de columnas (una sola foto, no hay "antes del despliegue" que
comparar en un entorno de desarrollo que nunca desplegó sin el código):

```
$ psql … "SELECT \"checkoutMode\",\"deliveryEnabled\",\"deliveryFeeMode\",\"orderExpiryHours\",
  \"deliveryFee\" IS NULL AS sin_tarifa, count(*) FROM \"Store\" GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5;"
WHATSAPP|f|FLAT_RATE|24|t|8
ONSITE|f|FLAT_RATE|6|t|1
ONSITE|t|FLAT_RATE|24|f|1
```

Ocho tiendas en los defaults exactos de columna, ninguna en un estado que
antes de F-032 fuera imposible de alcanzar (la de `ONSITE|f|FLAT_RATE|6|t`
es `tienda-demo` a mitad de esta sesión de pruebas). Marcado LISTO con nota:
el criterio 10, **tal como está escrito literalmente**, nunca puede dar `0`
en este repo — va a TP1.

### Criterio 11

```
$ ls docs/adr/0028-configuracion-de-compra-del-pos.md
docs/adr/0028-configuracion-de-compra-del-pos.md

$ grep -n "0028" docs/sync-contract.md
77:[ADR 0028](adr/0028-configuracion-de-compra-del-pos.md).
1408:   ver «omitir no es apagar» en [ADR 0028](adr/0028-configuracion-de-compra-del-pos.md).

$ grep -n "0028" prisma/schema.prisma
271:  /// no es apagar" — docs/adr/0028-configuracion-de-compra-del-pos.md). What
```

### Criterios 12 y 13

```
$ bash .agent/verify.sh F-019 --full
✓ harness ✓ typecheck ✓ lint ✓ format ✓ test ✓ prisma ✓ build ✓ theme ✓ bundle
PASA
$ echo $?
0
(repetido una segunda vez, mismo resultado)

$ bash .agent/verify.sh F-032 --full
✓ harness ✓ typecheck ✓ lint ✓ format ✓ test ✓ prisma ✓ build ✓ theme ✓ bundle
PASA
$ echo $?
0
```

### Criterio 14

```
$ grep -n 'UPDATE "Store"' docs/despliegue.md
$ echo $?
1
```

Sin resultado. § 9 punto 5 de `docs/despliegue.md` dice explícitamente: «La
configuración de compra llega por el sync, la escribe cuadrecaja […] escribirla
a mano por SQL ya no es el camino», citando ADR 0028.

### Criterio 15

```
$ npx vitest run src/features/sync/server/handlers/store.test.ts
Test Files  1 passed (1)
     Tests  22 passed (22)
```

El bloque `"handleStore() — F-032: la configuración de compra viaja con la
fila (criterio 15)"` trae, entre otros, `E1` (`data` sin ninguna de las
cinco), `E10` (`deliveryEnabled`/`deliveryFeeMode` sí viajan en el `data` de
la suspensión) y `E11` (`data` sin `deliveryEnabled`/`deliveryFeeMode` en el
camino `DELETE`), leídos directamente del archivo.

### Extra — `send-store-batch.mjs` no borra el contacto

```
$ psql … "SELECT description, address, city, whatsapp FROM \"Store\" WHERE \"externalId\"='seed-tienda-1';"   # antes
Todo para la casa, a dos cuadras de 23 y L.|Calle 23 esq. L, Vedado|La Habana|+5350000001

$ node scripts/send-store-batch.mjs
HTTP 207 { "results": [{"status":"processed"}] }

$ psql … "SELECT description, address, city, whatsapp …"   # después
Todo para la casa, a dos cuadras de 23 y L.|Calle 23 esq. L, Vedado|La Habana|+5350000001
```

Idénticos.

### Suite completa

```
$ npx vitest run
Test Files  117 passed (117)
     Tests  1141 passed (1141)
```

Corrida al final del ciclo, con la fila de `tienda-demo` ya restaurada (ver §
Estado en que queda el entorno) — nada del montaje manual rompió ningún test.

## Fallos encontrados

Tres, ninguno de código de producto — los tres son de **prosa/herramienta**,
no de lo que hace `handleStore` ni el schema:

1. **La consulta `$CINCO` de `spec.md` no encuentra la fila de `tienda-demo`.**
   Severidad: menor. `spec.md` § «Criterios de aceptación propuestos» escribe
   `WHERE slug='tienda-demo'` sobre `"Store"`; desde F-017 esa columna es
   `NULL` para cualquier tienda sin `ownSlug` propio (`tienda-demo` incluida
   — el slug público vive en `"Slug"`/`"Storefront"`). El propio handler
   resuelve por `externalId` (`seed-tienda-1`), no por `slug`. Sustituí la
   consulta en todo este documento; no bloqueó nada porque se detectó antes
   de medir. **Vuelve a `sdd-spec`**: corregir el `$CINCO` de `spec.md` (y
   cualquier otro literal que asuma `Store.slug`) a
   `WHERE "externalId"='seed-tienda-1'`, para que el próximo que copie/pegue
   el guion de la spec no se encuentre con cero filas. Relacionado con —pero
   no cubierto por— la ficha `pull-orders-mjs-store-slug-nulo-tras-f017.md`,
   que solo hablaba de `scripts/pull-orders.mjs`.

2. **El comando literal del criterio 10 no corre con Prisma 7.9.1.**
   Severidad: menor. `--from-schema-datasource` y `--to-schema-datamodel`
   fueron retirados de la CLI (el propio comando imprime el reemplazo:
   `--from-config-datasource`/`--to-schema`). `AGENTS.md` fija Prisma en
   `7.9.1` como versión real del stack, así que no es una versión futura:
   el comando de `spec.md` ya está desactualizado hoy. **Vuelve a
   `sdd-spec`**: actualizar el comando del criterio 10.

3. **El criterio 10, con los flags corregidos, nunca da `--exit-code 0` en
   este repo.** Severidad: a decidir por el humano (por eso TP1, no un
   arreglo mío). Los cinco índices GIN/parciales que `AGENTS.md` § Cosas que
   muerden ya ficha como "no representados en `prisma/schema.prisma`" hacen
   que **cualquier** `prisma migrate diff --exit-code` contra este schema
   informe diferencias, F-032 la toque o no — confirmado comparando contra
   `git diff main -- prisma/schema.prisma`, que muestra que F-032 solo cambió
   un comentario `///`. El criterio, tal como está redactado, describe una
   propiedad que el repo no puede demostrar con ese comando en su estado
   actual, no algo que este feature haya roto. No vuelve a ningún agente de
   código: es una pregunta de redacción, TP1.

`bash .agent/verify.sh pending F-032` → vacío, código `0`: no queda ningún
fallo de código sin fichar ni descartar (los tres de arriba son de
documentación de la propia spec de este ciclo, no del código que
`verify.sh` cubre).

## Huecos de cobertura

- **E5** (`null` explícito en las otras cuatro claves → `400` de tipo) no se
  ejecutó contra Postgres en este ciclo: no es ninguno de los 15 criterios, y
  ya lo cubre `src/features/sync/schemas.test.ts` por unidad (tabla DA7).
  Riesgo residual: bajo.
- **E12/E15** (tienda inexistente sin publicar; colisión de negocio) tampoco
  se ejercitaron con HTTP real — los cubre `store.test.ts` por unidad
  (mock de Prisma) y no forman parte de los 15 criterios de este ciclo.
- **No se probó un lote de 500 eventos** (el caso límite de la tabla de
  `spec.md`) — el de 2 eventos (`PRODUCT`+`STORE`) ya ejercita la misma ruta
  de código (`safeParse` sobre el array entero); el tamaño no cambia el
  comportamiento que los criterios piden comprobar.
- **No se dejó ningún `visual.mjs` nuevo.** No hay pantalla (F-032 no toca
  ninguna interfaz, `design.md` no existe para este feature — confirmado en
  `architecture.md`/`plan.md`, que no listan ningún paso de diseño), así que
  no aplica la regla que exige `visual.mjs` antes de `sdd.sh done` para un
  feature con interfaz. La comprobación manual en navegador de arriba (§
  Criterio 2) fue exploratoria, no un guion nuevo.

## Estado en que queda el entorno

Explícito, para quien retome:

- **`QAB_BEARER_TOKEN` de `seed-negocio-1` fue rotado** con
  `npm run mint:token -- seed-negocio-1` y queda en `.env` de este worktree
  (gitignored). Cualquier otra sesión con el token viejo de ese negocio
  necesita reacuñar (ficha `mint-token-rota-el-token-en-bd-compartida`).
- **La fila de `tienda-demo` (`externalId='seed-tienda-1'`) quedó
  restaurada a los defaults de columna** al cerrar el ciclo:
  `checkoutMode='WHATSAPP'`, `deliveryEnabled=false`, `deliveryFee=NULL`,
  `deliveryFeeMode='FLAT_RATE'`, `orderExpiryHours=24` — los mismos valores
  con los que se encontró al empezar. `sourceUpdatedAt` sí avanzó (queda en
  el momento del último evento real aplicado durante las pruebas): no es una
  de las cinco columnas de propiedad y ningún criterio exige conservarla.
- **`SyncEvent` tiene ahora 11 filas** (0 al empezar) — residuo esperado de
  correr `send-catalog-batch.mjs`/`send-store-batch.mjs` varias veces; ningún
  criterio ni test depende de que esa tabla esté vacía.
- **`next dev` en el puerto 3000 lo levanté yo en este ciclo** (no había
  ninguno antes) y lo dejo corriendo hasta el cierre de este documento; se
  detiene después de archivar este ciclo (ver bitácora).
- **No quedó ningún pedido sembrado por mí**: `SELECT count(*) FROM "Order"
WHERE "storeId"='5f7d4d71-4d6a-42b4-838a-d134844b142f'` no cambió respecto
  al inicio (la visita de navegador no llegó a "Confirmar pedido").

## Veredicto

**LISTO.** Los 15 criterios (los 13 de `features.json` + los 2 que añadió
`spec.md`) están verificados ejecutando algo real contra Postgres y el
servidor de desarrollo, con su comando y su salida — ninguno se dio por
bueno solo leyendo código, salvo los cuatro que son literalmente de prosa (8,
9, 11, 14). `bash .agent/verify.sh F-032 --full` y `bash .agent/verify.sh
F-019 --full` terminan los dos en `0`. `bash .agent/verify.sh pending F-032`
está vacío. La comprobación extra pedida (`send-store-batch.mjs` no borra el
contacto de `tienda-demo`) también quedó en verde.

Los tres fallos de § Fallos encontrados son de **prosa de `spec.md`**, no de
código: dos son arreglos triviales que ya dejo señalados con su corrección
exacta (vuelven a `sdd-spec`, sin bloquear el cierre), y el tercero es una
pregunta de redacción sobre un criterio que, tal como está escrito, no puede
satisfacerse literalmente en este repo por una razón ajena a F-032 (TP1).

## Preguntas al humano

**TP1.** El criterio 10 de `features.json` pide «un conteo por columna antes
y después […] es idéntico» y `spec.md` lo traduce a
`prisma migrate diff --exit-code` en `0`. Con los flags que exige la versión
real de Prisma de este repo (`7.9.1`), ese comando **nunca** da `0` aquí —
informa los cinco índices GIN/parciales que `AGENTS.md` ya ficha como "no
representados en el schema", con o sin F-032. Confirmé con `git diff main --
prisma/schema.prisma` que el único cambio de este feature es un comentario
`///` (no genera SQL) y que no hay ninguna migración nueva
(`git diff main --stat -- prisma/migrations` vacío), que es lo que el
criterio de verdad quiere proteger. ¿Prefieres que el criterio 10 se
verifique con esas dos comprobaciones (diff de schema + ausencia de
migración nueva) en vez del `--exit-code` literal, o que primero se arregle
el desajuste de los índices GIN (fuera de alcance de F-032, es un problema
del propio `schema.prisma` desde antes) para que el comando vuelva a ser
fiable? Ninguna de las dos bloquea el cierre de F-032 — el criterio está
LISTO por las dos comprobaciones alternativas, esta pregunta es sobre cómo
debería quedar escrito el criterio/spec para el próximo ciclo que lo herede
(F-022, criterio 4, va a citar el mismo mecanismo).

**TP2.** Los dos arreglos triviales de `spec.md` (§ Fallos encontrados 1 y 2:
la consulta `$CINCO` con `slug` en vez de `externalId`, y los flags
retirados de `prisma migrate diff`) — ¿los corrijo yo mismo en `spec.md`
ahora que `estado: listo` ya está firmado, o prefieres que los arrastre
`sdd-spec` en el próximo ciclo que toque ese documento? No los toqué porque
`spec.md` es de otro agente y ya está en `estado: listo`; no cambian ningún
veredicto de este ciclo.
