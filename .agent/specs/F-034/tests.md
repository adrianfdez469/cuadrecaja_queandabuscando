---
feature: F-034
agente: sdd-tester
actualizado: 2026-09-03T06:32:24Z
estado: listo
veredicto: listo
---

## Estrategia

Los 14 `acceptance_criteria` de `.agent/features.json` son la única lista que
decide el veredicto. Cada uno se verificó **ejecutando algo real** — nunca
leyendo el código y concluyendo que debería funcionar — con al menos dos
fuentes independientes cuando fue posible: el smoke (`.agent/specs/F-034/smoke.sh`,
HTTP real contra `next dev`) más una repetición manual propia, con `curl` y SQL
por `node -e` + `pg`, sobre negocios desechables con prefijo `f034-tester-*` /
`f034-smoke-*`, nunca sobre `seed-negocio-1` ni `seed-negocio-2`.

Los cuatro que la tarea señaló como «un verde puede ser falso» se verificaron
con rigor extra:

- **Criterio 2** — inspeccioné el **cuerpo** de la respuesta 207 (no solo el
  código), confirmé que trae `ok`/`failed`/`results` reales (no un 403
  `BUSINESS_MISMATCH`) y que el `externalId` autenticado es el negocio nuevo
  (`f034-tester-c2-…`), consultado por SQL, nunca `seed-negocio-1`.
- **Criterio 4** — comparé el `syncTokenHash` de la base con el SHA-256
  calculado a mano del token de la primera llamada (idénticos) y volví a
  llamar a `send-catalog-batch.mjs` con ese mismo token tras la repetición:
  207 real, con cuerpo.
- **Criterio 10** — lancé las dos llamadas concurrentes de verdad
  (`&` + `wait`), y conté con `SELECT count(*)` directo a Postgres, no con la
  respuesta HTTP.
- **Criterio 11** — `curl` real con el secreto de aprovisionamiento como
  `Authorization: Bearer` contra `/api/internal/orders`: 401
  `{"error":"UNAUTHORIZED"}`.

Además, guardé el `syncTokenHash` de `seed-negocio-1` y `seed-negocio-2` por
SQL **antes** de empezar y los comparé al terminar: **idénticos, byte a
byte** (ver § Integridad del seed).

## Mapa criterio → prueba

| #   | Criterio (`.agent/features.json`, literal)                                                                                                                                                         | Prueba                                                                                                                                                              | Comando / archivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Resultado |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | «POST a la ruta de aprovisionamiento con el secreto correcto y un externalId que no existe responde 201 con un token no vacio, y queda exactamente una fila nueva de Business con ese externalId.» | smoke.sh (3 asserts) + repetición manual sobre `f034-tester-c2-…` y `f034-tester-c5-…`, con `count(*)` real antes/después                                           | `bash .agent/verify.sh F-034 --smoke` → `ok criterio 1 — POST con externalId nuevo → 201`, `ok … el token no viene vacío`, `ok … queda exactamente una fila`; manual: `curl -X POST http://localhost:3101/api/provisioning/credential -H "authorization: Bearer $SECRET" -d '{"externalId":"f034-tester-c2-…"}'` → `201 {"created":true,"minted":true,"token":"…48…"}`, `count(*)=1`                                                                                                                                                                                                | **LISTO** |
| 2   | «Ese token autentica de verdad: node scripts/send-catalog-batch.mjs --token=<el devuelto> responde 207.»                                                                                           | smoke.sh (I8, con `QAB_BUSINESS_ID`) + repetición manual con inspección del **cuerpo** de la respuesta y del `externalId` autenticado                               | `QAB_BASE_URL=http://localhost:3101 QAB_BUSINESS_ID=f034-tester-c2-1788416926 node scripts/send-catalog-batch.mjs --token=$TOKEN` → `HTTP 207 {"ok":["evt-product-…","evt-store-…"],"failed":[],"results":[…"skipped_not_published"…]}` — cuerpo real de lote, no un 403 disfrazado; `SELECT id FROM "Business" WHERE "externalId"='f034-tester-c2-…'` confirma que es el negocio nuevo, no `seed-negocio-1`                                                                                                                                                                        | **LISTO** |
| 3   | «Repetir la MISMA llamada responde 200 con token null, y el syncTokenHash de la base es identico antes y despues.»                                                                                 | smoke.sh (3 asserts) + repetición manual con SHA-256 calculado a mano                                                                                               | manual: repetir el POST → `200 {"created":false,"minted":false,"token":null}`; `SELECT "syncTokenHash" …` en la base = `aecbe1b5…` = `sha256(token original)` calculado con `node -e "…createHash('sha256')…"` — **idénticos**                                                                                                                                                                                                                                                                                                                                                      | **LISTO** |
| 4   | «Tras esa repeticion, el token de la primera llamada sigue respondiendo 207: registrar no rota nunca.»                                                                                             | smoke.sh + repetición manual, tras el criterio 3, con el mismo token                                                                                                | `node scripts/send-catalog-batch.mjs --token=$TOKEN` (el de la 1ª llamada, tras repetir el alta) → `HTTP 207` con cuerpo real                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **LISTO** |
| 5   | «Sobre un negocio que ya existe pero no tiene syncTokenHash, la llamada responde 201 con token y no crea ningun Business nuevo.»                                                                   | smoke.sh (E3, `business_create` + POST) + repetición manual con `INSERT` directo por SQL y `count(*)` antes/después + `provisioning.db.test.ts` (E3, Postgres real) | manual: `INSERT INTO "Business"(…, "syncTokenHash" default NULL)`, luego POST → `201 {"created":false,"minted":true,"token":"…"}`, `count(*)` antes=1, después=1; `npx vitest run --project db provisioning.db.test.ts` → 9/9 (incluye E3)                                                                                                                                                                                                                                                                                                                                          | **LISTO** |
| 6   | «Sin el secreto configurado en el servidor la ruta responde 503 y no escribe nada, y las rutas de /api/internal/* con un token valido siguen respondiendo lo suyo.»                                | `route.test.ts` (1ª mitad, automatizado) + **servidor real levantado sin el secreto** (2ª mitad, manual, no solo la interpretación de `architecture.md` AP3)        | `npx vitest run src/app/api/provisioning/credential/route.test.ts` → 16/16 (`criterio 6, primera mitad: 503 sin el secreto configurado, y provisionCredential nunca se llama`); manual: `PROVISIONING_SECRET_SHA256="" npm run dev -- -p 3101`, luego `POST /api/provisioning/credential` → `503 {"error":"PROVISIONING_NOT_CONFIGURED"}`, `count(*)`=0 para ese `externalId`, y `GET /api/internal/orders` con un token de negocio válido (acuñado antes, sobre otro negocio) → `200 {"orders":[],"nextCursor":null}` en el **mismo** servidor sin el secreto de aprovisionamiento | **LISTO** |
| 7   | «Con el secreto configurado, una cabecera ausente, con otro esquema y con un valor equivocado dan 401 con el mismo cuerpo en los tres casos, y no se escribe nada.»                                | smoke.sh (5 asserts) + repetición manual con las tres formas + `guard.test.ts`                                                                                      | `bash .agent/verify.sh F-034 --smoke` → 5 `ok` de criterio 7; manual: sin cabecera / `Token …` / `Bearer valor-erroneo` → los tres `401 {"error":"UNAUTHORIZED"}`, cuerpo idéntico; `npx vitest run guard.test.ts` → 53/53 (con `boundaries.test.ts` y `schemas.test.ts`)                                                                                                                                                                                                                                                                                                           | **LISTO** |
| 8   | «Un cuerpo sin externalId, con externalId vacio, o que no es JSON, responde 400 y no crea ningun Business.»                                                                                        | smoke.sh (5 asserts) + repetición manual de las tres formas                                                                                                         | manual: `{}` → `400 {"error":"INVALID_BODY","issues":[{"path":["externalId"],"message":"Invalid input: expected string, received undefined"}]}`; `{"externalId":""}` → `400` (`Too small`); `esto no es json` → `400` (`Body is not valid JSON`); smoke confirma `count(*)`=0 para el `externalId` que nunca debió crearse                                                                                                                                                                                                                                                          | **LISTO** |
| 9   | «Sobre un Business con active false la ruta responde 403 y no acuña: su syncTokenHash queda como estaba.»                                                                                          | smoke.sh (variante `syncTokenHash` nulo) + `provisioning.db.test.ts` (E9, **las dos variantes**: nulo y poblado) + repetición manual                                | `npx vitest run --project db provisioning.db.test.ts` → incluye `inactive y NO acuña, con syncTokenHash nulo intacto` e `inactive con un token YA poblado: el hash queda exactamente como estaba` (9/9 total); manual: `INSERT … active=false`, POST → `403 {"error":"BUSINESS_INACTIVE"}`, `syncTokenHash` sigue `NULL`                                                                                                                                                                                                                                                            | **LISTO** |
| 10  | «Dos llamadas concurrentes con el mismo externalId desconocido dejan UN solo Business, ninguna responde 500, y el token devuelto autentica.»                                                       | smoke.sh (E10) + repetición manual con `&`/`wait` real y `count(*)` por SQL + verificación de que el token ganador autentica (207)                                  | manual: dos `curl` en paralelo sobre el mismo `externalId` → una `200 {"token":null}`, otra `201 {"token":"…"}`, ninguna 500; `SELECT count(*)` = **1**; `send-catalog-batch.mjs --token=<el del 201>` → `HTTP 207`                                                                                                                                                                                                                                                                                                                                                                 | **LISTO** |
| 11  | «El secreto de aprovisionamiento no autentica ninguna ruta de /api/internal/*: enviarlo como Bearer a GET /api/internal/orders responde 401.»                                                      | smoke.sh + repetición manual con `curl` directo                                                                                                                     | `curl "$BASE/api/internal/orders?since=0" -H "authorization: Bearer $QAB_PROVISIONING_SECRET"` → `401 {"error":"UNAUTHORIZED"}`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **LISTO** |
| 12  | «La comparacion del secreto es en tiempo constante: grep de timingSafeEqual sobre el guard de la ruta no sale vacio.»                                                                              | `grep` ejecutado a mano                                                                                                                                             | `grep -n "timingSafeEqual" src/app/api/provisioning/_lib/guard.ts` → 3 líneas (import, comentario, uso real en el `if`), no vacío                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **LISTO** |
| 13  | «La ruta, su cuerpo, sus codigos y el procedimiento de alta estan en docs/sync-contract.md con la version movida, y el secreto nuevo esta en docs/despliegue.md.»                                  | Lectura directa de los documentos, confirmando cada elemento                                                                                                        | `docs/sync-contract.md` línea 3: `**Versión 10**`; § «Aprovisionamiento de negocios (v10)» (líneas 560-646) con cabecera, cuerpo, las dos respuestas y la tabla de 6 códigos; `docs/despliegue.md` línea 183 (`PROVISIONING_SECRET_SHA256` en la tabla de §5) y línea 286 (comando de generación en §8.1)                                                                                                                                                                                                                                                                           | **LISTO** |
| 14  | «bash .agent/verify.sh F-034 --full termina con codigo 0.»                                                                                                                                         | Ejecutado dos veces en este ciclo                                                                                                                                   | `bash .agent/verify.sh F-034 --full` → intento 18, las nueve etapas de `--full` en verde (ver bloque de abajo), `PASA`, código de salida 0                                                                                                                                                                                                                                                                                                                                                                                                                                          | **LISTO** |

**14/14 LISTO.** Ningún criterio sin cubrir.

## Ejecuciones

### El sensor

```
$ bash .agent/verify.sh F-034 --full
== Verificación F-034 · intento 18 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       30s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s
PASA
```

```
$ bash .agent/verify.sh F-034 --smoke
== Verificación F-034 · intento 19/20 ==
  ✓ typecheck  1-2s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       30s
  ✓ smoke      4-5s
PASA
```

Salida completa en `.agent/runs/F-034/019-smoke.log` y `020-smoke.log`: **33
aserciones, 0 fallidas** las dos veces, con la salida de `next dev` pegada al
final — sin ninguna línea que empiece por algo acabado en `Error` ni contenga
`⨯`/`Unhandled` (las líneas `prisma:error … Unique constraint failed` del
criterio 10 son minúsculas y no encajan en `SERVIDOR_ERROR_RE`; corresponden
al `P2002` esperado de la carrera del compare-and-set, capturado por el
código, no un fallo del servidor).

```
$ bash .agent/verify.sh pending F-034
(vacío)
```

```
$ npm test
Test Files  129 passed (129)
     Tests  1366 passed (1366)
```

```
$ npx vitest run --project db src/features/sync/server/provisioning.db.test.ts
Test Files  1 passed (1)
     Tests  9 passed (9)
```

```
$ npx vitest run src/app/api/provisioning/_lib/guard.test.ts \
    src/app/api/provisioning/boundaries.test.ts src/features/sync/schemas.test.ts
Test Files  3 passed (3)
     Tests  53 passed (53)
```

### Servidor real, sin el secreto configurado (criterio 6, 2ª mitad, manual)

```
$ PROVISIONING_SECRET_SHA256="" npm run dev -- -p 3101
...
$ curl -X POST http://localhost:3101/api/provisioning/credential \
    -H "authorization: Bearer $QAB_PROVISIONING_SECRET" -d '{"externalId":"…otro…"}'
{"error":"PROVISIONING_NOT_CONFIGURED"}
HTTP 503

$ curl "http://localhost:3101/api/internal/orders?since=0" -H "authorization: Bearer $TOKEN"
{"orders":[],"nextCursor":null}
HTTP 200
```

`count(*)` del `externalId` intentado durante el 503 = **0**: no se escribió
nada.

## Integridad del seed

`syncTokenHash` de `seed-negocio-1` y `seed-negocio-2`, leído por SQL antes de
empezar la tanda de pruebas y otra vez al terminar:

| Negocio          | Antes                                                              | Después                                                            | ¿Igual? |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------- |
| `seed-negocio-1` | `1b1300b7dc3ab51a173d2132db00d78e4ff4e1e7c71e99762d24ea81490650cc` | `1b1300b7dc3ab51a173d2132db00d78e4ff4e1e7c71e99762d24ea81490650cc` | **sí**  |
| `seed-negocio-2` | `5272e7a90439d57cbb62f6292383b1846f8b2e7d1651db5396e7f4792501bbb6` | `5272e7a90439d57cbb62f6292383b1846f8b2e7d1651db5396e7f4792501bbb6` | **sí**  |

`npm run mint:token` **no** se ejecutó en ningún momento de este ciclo.

## Limpieza

Todo negocio desechable creado durante este ciclo (`f034-tester-*` de las
pruebas manuales, `f034-smoke-*` del propio smoke) se borró al terminar:

```
$ SELECT count(*) FROM "Business" WHERE "externalId" LIKE 'f034%';
0
```

## Criterios propuestos (15-20), fuera del veredicto pero ejecutados de paso

No cambian el veredicto (solo los 14 de `features.json` lo hacen), pero
quedan verificados como parte de la misma tanda:

- **15 (E11, concurrencia sobre negocio sin token)** y **18 (E12, colisión de
  hash)**: `provisioning.db.test.ts`, 9/9.
- **16 (E14, token de negocio contra la ruta de aprovisionamiento)** y **17
  (R10, `cache-control: no-store`)**: smoke.sh, `ok` en ambos.
- **19 (503 con el secreto en claro pegado por error)**: `guard.test.ts`
  (no ejecutable por HTTP sin reiniciar el proceso de `next dev` a media
  corrida — documentado en `impl.md` § Desviaciones).
- **20 (E17, `name`)**: smoke.sh, `ok` en ambos casos (con y sin `name`).

## Fallos encontrados

Ninguno. Los 14 criterios de `features.json` se verificaron ejecutando y
todos dieron el resultado esperado por `spec.md`. No hay nada que devolver a
`sdd-implementer`, `sdd-architect` ni `sdd-spec`.

## Qué queda sin cubrir y por qué

- **El criterio 19 propuesto** (secreto en claro pegado en
  `PROVISIONING_SECRET_SHA256`) no se ejecuta por HTTP: exigiría reconfigurar
  la variable de un proceso de `next dev` ya levantado y que la releyera sin
  reiniciar, que no es posible desde un script externo (misma clase de
  problema que AP3 resolvió para la 2ª mitad del criterio 6). Cubierto,
  determinista y sin servidor, en `guard.test.ts`. No es uno de los 14 y no
  afecta al veredicto.
- **La rotación con solape, la tabla `BusinessCredential` y el HMAC de ADR
  0008** siguen fuera de alcance por diseño (`plan.md` § Qué queda fuera):
  no hay nada que verificar aquí porque no se construyó aquí.
- **CI en verde sobre un PR real** no se comprobó: fuera del alcance de este
  ciclo, igual que en F-009.
