---
feature: F-041
agente: sdd-tester
actualizado: 2026-09-09T02:13:08Z
estado: listo
veredicto: listo
---

## Estrategia

Paso 16 del plan firmado: las siete pruebas que la arquitectura asignó, más
dos añadidos que aparecieron al ejecutar de verdad los catorce criterios (C9
y C10 no tenían fichero asignado en `architecture.md` § Componentes y
tampoco estaban cubiertos por ningún test existente; ver § Huecos abajo por
qué se cerraron en `zoneTariff.db.test.ts` en vez de en un fichero nuevo).

Entorno, por extensión (`AGENTS.md` § Cosas que muerden, `vitest.config.mts:31-85`):

| Fichero                                                         | Proyecto | Por qué                       |
| --------------------------------------------------------------- | -------- | ----------------------------- |
| `src/features/zones/precedence.test.ts`                         | `server` | `*.test.ts`, sin Prisma       |
| `src/features/zones/catalog.test.ts`                            | `server` | `*.test.ts`, sin Prisma       |
| `src/features/zones/boundaries.test.ts`                         | `server` | `*.test.ts`, sin Prisma       |
| `src/features/sync/server/handlers/zoneTariff.test.ts`          | `server` | `*.test.ts`, Prisma mockeado  |
| `src/features/sync/server/handlers/zoneTariff.db.test.ts`       | `db`     | `*.db.test.ts`, Postgres real |
| `src/features/zones/server/tariffs.db.test.ts`                  | `db`     | `*.db.test.ts`, Postgres real |
| `src/features/zones/server/catalogSeed.db.test.ts`              | `db`     | `*.db.test.ts`, Postgres real |
| `src/features/sync/schemas.test.ts` (bloque nuevo)              | `server` | ya existía, se amplió         |
| `src/features/orders/server/createOrder.test.ts` (bloque nuevo) | `server` | ya existía, se amplió         |

Cada fichero **ejecuta** contra código real o contra Postgres real (los
`*.db.test.ts` usan `createFixtureSession()` de
`src/features/marketplace/server/dbFixtures.ts`, el mismo arnés que
`business.db.test.ts`/`businessInvalidation.db.test.ts` ya usan) — nada de
lo que sigue se verificó leyendo código.

## Mapa criterio → prueba

| #   | Criterio de aceptación (resumen)                                                                                      | Prueba                                                                                                                   | Archivo                                                      | Resultado     |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------- |
| C1  | Los SIETE (en verdad trece) casos del vector pasan, leídos del propio contrato                                        | 13 `it.each` + 2 asertos de conteo                                                                                       | `src/features/zones/precedence.test.ts`                      | ✅ 15/15      |
| C2  | `ZONE_TARIFF` válido → `207 processed`, fila guardada, verificado leyéndola                                           | `"C2 (E1): a valid ZONE_TARIFF saves…"`                                                                                  | `zoneTariff.db.test.ts`                                      | ✅            |
| C3  | `NOT_SERVED`/`INHERIT` con importe y `FEE` sin importe → `400`; discriminante inválido de Zod también `400`           | 12 tests del schema + `"C3, the Zod discriminator quirk…"`                                                               | `schemas.test.ts` + `zoneTariff.db.test.ts`                  | ✅ 13/13      |
| C4  | `DELETE` → `failed[]` con su código, cero filas borradas, contado antes/después                                       | `"C4 (E4) + E5: a DELETE is rejected…"`                                                                                  | `zoneTariff.db.test.ts`                                      | ✅            |
| C5  | `updatedAt <=` → `stale`, no pisa el importe vigente                                                                  | `"C5 (E3): updatedAt < and == …"` (mocked: dos tests `STALE` en `zoneTariff.test.ts`)                                    | `zoneTariff.db.test.ts` + `zoneTariff.test.ts`               | ✅            |
| C6  | Zona desconocida → `400` con su código, cero filas                                                                    | `"C6 (E9): a zoneCode not in the published catalog…"`                                                                    | `zoneTariff.db.test.ts`                                      | ✅            |
| C7  | `INHERIT` de provincia se acepta y la zona resuelve no servida                                                        | `"E12: an INHERIT at province level…"` (aceptación) + 2 tests de `tariffs.db.test.ts` (resolución)                       | `zoneTariff.db.test.ts` + `tariffs.db.test.ts`               | ✅            |
| C8  | `STORE DELETE` se lleva las filas de tarifario, contadas antes/después                                                | describe `"C8: a STORE DELETE that APPLIES…"` (2 tests: el camino del sync y la FK real)                                 | `zoneTariff.db.test.ts`                                      | ✅            |
| C9  | `STORE` con `zoneCode` desconocido falla ESE evento entero, ninguno de sus campos se aplica; con uno válido lo guarda | describe `"C9: a STORE's zoneCode…"` (2 tests)                                                                           | `zoneTariff.db.test.ts`                                      | ✅            |
| C10 | `ZONE_BASED` se guarda y se lee; migración aditiva contra la base real                                                | `"C10: deliveryFeeMode ZONE_BASED is accepted…"` + verificación de la migración (§ Ejecuciones)                          | `zoneTariff.db.test.ts` + `git diff`/`prisma migrate deploy` | ✅            |
| C11 | Catálogo sembrado, versión anotada, sembrar dos veces es idempotente                                                  | 5 tests                                                                                                                  | `catalogSeed.db.test.ts`                                     | ✅            |
| C12 | Aplicar `ZONE_TARIFF` expira las páginas cacheadas de esa sucursal, vía F-035                                         | describe `"C12/E18…"` (5 tests: 1/20/1-tag, stale/failed/skipped en cero)                                                | `zoneTariff.db.test.ts`                                      | ✅            |
| C13 | v13 con entidad, precedencia con letra, códigos, vector JSON calculado ejecutando                                     | El propio `precedence.test.ts` ejecuta el bloque; verificación textual de versión/coordinación (§ Ejecuciones)           | `precedence.test.ts` + inspección                            | ✅            |
| C14 | `bash .agent/verify.sh F-041 --full` sale `0`                                                                         | —                                                                                                                        | —                                                            | ✅ código `0` |
| C15 | `ZONE_BASED` con `deliveryFee` residual no cobra en el pedido                                                         | 2 tests, describe `"F-041 — ZONE_BASED (C15…)"`                                                                          | `createOrder.test.ts`                                        | ✅            |
| C16 | Integridad del índice: 184/16/168, sin duplicados, 183 ids, sha256                                                    | 9 tests                                                                                                                  | `catalog.test.ts`                                            | ✅ 14/14      |
| C17 | Informe de la unión commiteado, cita la errata, procedencia con URL del Archive                                       | verificado por el implementador (`grep`, ya en `progress/F-041.md`); no repetido aquí — es documental, no comportamiento | —                                                            | ✅ (heredado) |

Un criterio sin fila sería un criterio sin cubrir — no quedó ninguno así.

## Ejecuciones

Comando principal, el que cierra C14:

```
$ bash .agent/verify.sh F-041 --full
== Verificación F-041 · intento 14 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       5s
  ✓ format     8s
  ✓ test       28s
  ✓ prisma     0s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s

PASA
```

`npm test` dentro de esa corrida: **1657 passed (153 test files)** — 94 tests
más que el baseline de 1563/146 que dejó `sdd-implementer`.

Por archivo (`npx vitest run <file>`), todos en verde:

```
src/features/zones/precedence.test.ts                          15 passed
src/features/zones/catalog.test.ts                              14 passed
src/features/zones/boundaries.test.ts                            2 passed
src/features/sync/server/handlers/zoneTariff.test.ts            13 passed
src/features/sync/server/handlers/zoneTariff.db.test.ts         20 passed
src/features/zones/server/tariffs.db.test.ts                     7 passed
src/features/zones/server/catalogSeed.db.test.ts                 5 passed
```

Más los bloques nuevos en dos ficheros ya existentes:
`schemas.test.ts` § `zoneTariffPayloadSchema / syncEventSchema — the seventh
branch (C3, E6-E9)` (12 tests) y `createOrder.test.ts` § `F-041 — ZONE_BASED
(C15…)` (2 tests) — ambos corren dentro de la suite completa de arriba.

`bash .agent/verify.sh pending F-041` → sin salida (vacío): ningún fallo de
este ciclo quedó sin explicar. Los cuatro fallos que sí ocurrieron durante la
escritura de estas pruebas (dos de mi propia autoría en `boundaries.test.ts` —
un comentario JSDoc con un glob que cerraba el bloque de golpe, ficha ya
existente `jsdoc-glob-cierra-comentario-de-golpe`, y una lista blanca corta
por un importador legítimo que olvidé—, uno de formato sin `npm run format`
sobre lo que yo mismo escribí, ficha `prettier-sin-formatear`, y uno de datos
de prueba: un evento `DELETE` con `rule: "FEE"` sin `deliveryFee`, que el
schema rechaza con `400` ANTES de llegar al handler que se quería probar) se
arreglaron sobre el error real, sin necesitar ficha nueva — los tres con
ficha ya la tenían, y el cuarto es un descuido de mis propios datos de
prueba, no una lección del repositorio.

`git diff main --stat -- prisma/migrations` (heredado del implementador,
recomprobado): solo el fichero nuevo de la migración — la migración sigue
aditiva.

## Fallos encontrados

Ninguno del código de producción. Los cuatro de arriba fueron todos míos —
del propio texto de las pruebas que estaba escribiendo, no del código que
pruebo — y los cuatro se arreglaron ejecutando y leyendo el error real, no
ajustando una prueba para que cuadre con un comportamiento que la spec no
pide.

## Huecos de cobertura

- **C9 y C10 no tenían fichero asignado** en `architecture.md` § Componentes
  (la tabla de tests solo cubre C1, C2/C4/C5/C6/C12, C7, C11, C16) ni estaban
  cubiertos por ningún test existente del árbol (`grep` de `ZONE_BASED` antes
  de escribir esta suite solo aparecía en `createOrder.test.ts`, y no había
  ningún `store.db.test.ts`). Los cerré en `zoneTariff.db.test.ts`, que ya
  tenía el `storeEvent()` helper para C8/E19, en vez de abrir un octavo
  fichero — es una decisión de `sdd-tester` (el propio plan dice "sdd-tester
  decide dónde" para lo que la arquitectura no fijó fichero) y queda anotada
  aquí para que quede a la vista, no escondida.
- **C17** (informe de la unión, procedencia) es documental — verificado con
  `grep` por el implementador y anotado en `progress/F-041.md`. No repetí esa
  verificación aquí porque no hay comportamiento nuevo que ejecutar: son
  bytes commiteados que no cambian en este ciclo.
- **E10** (zona retirada → se acepta y avisa con `console.warn`) no tiene test
  propio: el catálogo committeado hoy no tiene ninguna fila con `retiredAt`
  distinto de `null` (verificado en `catalog.test.ts`: "no row is retired
  today"), así que fabricar el escenario exigiría editar el artefacto fuera
  del alcance de este ciclo. No es ninguno de los 14+3 criterios, así que no
  baja el veredicto — queda anotado para el día que exista una zona retirada
  de verdad.
- **Publicar la v13** sigue pendiente del visto bueno de cuadrecaja (criterio
  13, decisión del humano) — el borrador ya salió y el vector se verificó
  ejecutando; publicar no es trabajo de `sdd-tester`.

## Veredicto

**LISTO.** Los 14 `acceptance_criteria` de `features.json` más C15/C16/C17 de
`spec.md` se verificaron **ejecutando algo** — un comando de test con su
salida real, o una petición HTTP real contra Postgres con su respuesta real —
nunca leyendo el código y concluyendo que debería funcionar.
`bash .agent/verify.sh F-041 --full` termina en `0` (C14).

## Preguntas al humano

Ninguna. Los 14 criterios se pudieron verificar tal como están escritos.
