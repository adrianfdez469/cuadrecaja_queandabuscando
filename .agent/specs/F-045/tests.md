---
feature: F-045
agente: sdd-tester
actualizado: 2026-09-10T06:00:00Z
estado: listo
veredicto: listo
---

## Estrategia

Los pasos 1-3, 6 y 7 del plan ya los cerró `sdd-implementer` (commits `c4590ac`
y `1e00779`), incluida la inversión del aserto de I4 y el recuento de
escrituras del criterio 6 (mock de `store.test.ts`, proyecto `server`, sin `it`
nuevo). Este documento cubre los pasos 4 y 5 (`sdd-tester`): los ocho `it` que
faltaban, todos ejecutados contra Postgres real por la ruta HTTP verdadera
(`POST /api/internal/sync/catalog`), nunca leyendo código.

Todos los escenarios de `STORE` sobre `Business.name`/`baseCurrencyCode` viven
en `src/features/sync/server/handlers/business.db.test.ts` (proyecto `db`), en
un `describe` nuevo y propio de F-045, con sesión fresca por test
(`beforeEach`/`afterEach`), salvo `STORE_TIMEZONE_INVALID`, que reutiliza la
receta de `$executeRaw` de `storePublishGate.db.test.ts` y necesita un `it`
propio con un único evento en el lote (el `it` existente de ese archivo manda
en el mismo lote un segundo `STORE` sano que sí aplica).

Anti-vacuidad (architecture.md § AD5.3): todo evento que NO debe escribir
viaja con `baseCurrency: "USD"` y un `businessName` con `RECHAZADO`/`VIEJO` y
el `token` de la sesión — la fixture ya deja `baseCurrencyCode: "CUP"`, que es
el mismo valor por defecto de `storeEvent`, así que un evento que mandara ese
mismo par no probaría nada. Verificado además con dos mutaciones manuales
transitorias sobre `store.ts` (revertidas con `git checkout`, sin dejar
huella): quitar las tres llamadas a `applyBusinessFields` tumba exactamente
los cuatro `it` que SÍ deben escribir (criterio 3, 5(a), 5(b) × 2), y mover una
copia de la llamada al principio del handler (reintroduciendo I4 en miniatura)
tumba exactamente el criterio 1 (F-043 invertido) y los criterios 2(a), 2(b),
2(c), 4(a), 4(b) y una de las dos permutaciones del criterio 5(b) — la otra
permutación sobrevive a esa mutación concreta porque el evento bueno llega
después y su escritura correcta pisa la prematura, que es justo la razón por
la que el criterio exige **las dos** permutaciones (CL2): una sola habría
dejado pasar esta mutación con un verde falso.

## Mapa criterio → prueba

| Criterio de aceptación                                                 | Prueba                                                                                                                 | Archivo                                | Resultado |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------- |
| 1 — `STORE_ZONE_UNKNOWN` deja las dos columnas intactas                | `it` "F-043 (C3), corregido por F-045 (I4): …" (inversión de I4, ya cerrada por `sdd-implementer`, paso 3 del plan)    | `business.db.test.ts:665-706`          | PASA      |
| 2 — `STORE_OPENING_HOURS_INVALID`                                      | `it` "criterio 2(a): STORE_OPENING_HOURS_INVALID …"                                                                    | `business.db.test.ts` (describe F-045) | PASA      |
| 2 — `STORE_DELIVERY_CONFIG_INCONSISTENT` (forma 207)                   | `it` "criterio 2(b): STORE_DELIVERY_CONFIG_INCONSISTENT …"                                                             | `business.db.test.ts` (describe F-045) | PASA      |
| 2 — `STORE_TIMEZONE_INVALID`                                           | `it` "F-045 criterio 2(c): republishing over an unreadable timezone …"                                                 | `storePublishGate.db.test.ts`          | PASA      |
| 3 — rancio: `stale` dentro de `ok`, las columnas conservan lo NUEVO    | `it` "criterio 3: a stale STORE responds stale inside ok …"                                                            | `business.db.test.ts` (describe F-045) | PASA      |
| 4 — sucursal de otro negocio → `skipped_not_published`                 | `it` "criterio 4(a): a STORE for another business's branch …"                                                          | `business.db.test.ts` (describe F-045) | PASA      |
| 4 — despublicar una sucursal inexistente → `skipped_not_published`     | `it` "criterio 4(b): unpublishing a branch that does not exist …"                                                      | `business.db.test.ts` (describe F-045) | PASA      |
| 5 — los tres caminos que aplican (alta, actualización, despublicación) | `it` "criterio 5(a): a STORE that DOES apply keeps writing …"                                                          | `business.db.test.ts` (describe F-045) | PASA      |
| 5 — lote mixto, las dos permutaciones                                  | `it` × 2 "criterio 5(b): a mixed batch, BUENO first…" / "…MALO first…"                                                 | `business.db.test.ts` (describe F-045) | PASA      |
| 6 — el número de escrituras no sube (mock de `store.test.ts`)          | cuatro `toHaveBeenCalledOnce()` + siete `not.toHaveBeenCalled()` sobre tests ya existentes (paso 2, `sdd-implementer`) | `store.test.ts`, proyecto `server`     | PASA      |
| 7 — `docs/sync-contract.md` en v13.3, sin `Business.name` ni `I4`      | tres `grep` + el hook `sync-contract-version.sh` (paso 7, `sdd-implementer`)                                           | `docs/sync-contract.md`                | PASA      |
| 8 — `bash .agent/verify.sh F-045 --full` → `0`                         | sensor completo (nueve etapas)                                                                                         | —                                      | PASA      |

Ningún criterio quedó sin fila.

## Ejecuciones

**Criterio 1** (ya cerrado por `sdd-implementer`, re-ejecutado aquí como parte
del sensor):

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "corregido por F-045"
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

**Criterio 2(a)**:

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "criterio 2\(a\)"
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

**Criterio 2(b)**:

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "criterio 2\(b\)"
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

**Criterio 2(c)**:

```
$ npx vitest run --project db src/features/sync/server/handlers/storePublishGate.db.test.ts -t "F-045"
 Test Files  1 passed (1)
      Tests  1 passed | 2 skipped (3)
```

**Criterio 3**:

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "criterio 3:"
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

**Criterio 4(a)**:

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "criterio 4\(a\)"
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

**Criterio 4(b)**:

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "criterio 4\(b\)"
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

**Criterio 5(a)**:

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "criterio 5\(a\)"
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

**Criterio 5(b), las dos permutaciones**:

```
$ npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts -t "criterio 5\(b\)"
 Test Files  1 passed (1)
      Tests  2 passed | 24 skipped (26)
```

**Criterio 6** (mock, proyecto `server`):

```
$ npx vitest run --project server src/features/sync/server/handlers/store.test.ts
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

**Criterio 7**:

```
$ grep -n 'Versión 13.3' docs/sync-contract.md
3:**Versión 13.3** · 10 de septiembre de 2026 — **BORRADOR, sin publicar.** Sale
$ grep -c 'Business.name' docs/sync-contract.md
0
$ grep -c 'I4' docs/sync-contract.md
0
```

El hook `.claude/hooks/sync-contract-version.sh` no protestó en ningún commit
del ciclo (`git log` no muestra ninguna alerta ni revert sobre el archivo).

**Criterio 8**, y las dos comprobaciones finales del ciclo:

```
$ bash .agent/verify.sh F-045 --full; echo $?
== Verificación F-045 · intento 21 ==
  ✓ harness    1s
  ✓ typecheck  1s
  ✓ lint       6s
  ✓ format     10s
  ✓ test       37s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s

PASA
0

$ bash .agent/verify.sh pending F-045; echo $?
0

$ npm test
 Test Files  162 passed (162)
      Tests  1764 passed (1764)
```

`prisma.slug.findMany({ where: { value: { contains: "qab-f015" } } })`, tras la
corrida completa de la suite `db`, devuelve `0` filas: el `Slug` que deja el
camino de alta del criterio 5(a) se borra dentro del propio `it`
(`prisma.slug.deleteMany({ where: { value: slugify(altaSlug) } } )`, antes de
`session.cleanup()`).

## Fallos encontrados

Ninguno en el código bajo prueba. `applyBusinessFields` (`store.ts:321-330`) y
sus tres llamadas (`:131`, `:214`, `:264`) hacen exactamente lo que R1/R2/AD2
piden — confirmado ejecutando, no leyendo, con las dos mutaciones transitorias
descritas en § Estrategia (ambas revertidas con `git checkout` antes de dejar
el árbol; `git status --short src/features/sync/server/handlers/store.ts`
queda limpio).

## Huecos de cobertura

- **CL7/SI8** (una ventana de fallo de base entre las dos escrituras) queda
  aceptada por escrito en `architecture.md` y no tiene prueba: cerrarla exige
  `$transaction`, prohibida por el pooler. No es un hueco de este ciclo, es
  una decisión ya tomada por el humano (opción (a), sin transacción).
- **CL9** (negocios cuya moneda ya quedó mal por el defecto I4) no tiene
  backfill ni prueba: § No decidido de `spec.md` lo deja así a propósito.
- No se agregó ningún `it` de smoke con navegador: el feature no toca UI ni
  cliente (cero `"use client"`, cero componentes, cero JS), así que
  `.agent/specs/F-045/smoke.sh` no aplica y no se creó.

## Veredicto

**LISTO.** Los ocho criterios de `.agent/features.json` están verificados
ejecutando contra Postgres real y contra el mock de `store.test.ts`, no leídos
en el código. `bash .agent/verify.sh F-045 --full` sale `0` en sus nueve
etapas y `bash .agent/verify.sh pending F-045` queda vacío.

Ocho `it` nuevos, en dos archivos:

- `src/features/sync/server/handlers/business.db.test.ts` — siete `it`
  nuevos, en un `describe` propio de F-045: 2(a), 2(b), 3, 4(a), 4(b), 5(a) y
  una de las dos permutaciones de 5(b)…
- … más el octavo `it` (la segunda permutación de 5(b)), en el mismo archivo.
- `src/features/sync/server/handlers/storePublishGate.db.test.ts` — un `it`
  nuevo, `STORE_TIMEZONE_INVALID` (criterio 2(c)).

(El encargo hablaba de «siete `it`» en `business.db.test.ts` más «uno» en
`storePublishGate.db.test.ts» = ocho en total; la tabla de reparto de
`architecture.md`§ AD5 asigna explícitamente una fila de "it nuevo" a CADA
letra de los criterios 2(a) y 2(b) y dos filas a 5(b), lo que da ocho`it`en`business.db.test.ts`más el de`storePublishGate.db.test.ts`— nueve en
total. Se siguió AD5 al pie de la letra por ser el documento de reparto de
pruebas explícito y firmado; la aritmética de la nota de encargo no cuadra con
su propia tabla, y se prefirió no fusionar dos escenarios distintos en un
solo`it`para no perder la mutación específica que separa las dos
permutaciones del criterio 5(b), verificada en § Estrategia. Anotado como`TP1`, no bloquea el veredicto.)

## Preguntas al humano

**`TP1`** — el encargo dice "siete `it` nuevos" en `business.db.test.ts` +
"un `it`" en `storePublishGate.db.test.ts` (ocho en total), pero la propia
`architecture.md` § AD5 —el documento de reparto ya firmado— asigna una fila
de "it nuevo" a 2(a) y otra a 2(b), y dos filas a 5(b): eso da ocho `it` en
`business.db.test.ts` más uno en `storePublishGate.db.test.ts`, nueve en
total. Es lo que se escribió, porque separar 5(b) en dos `it` (uno por
permutación) es indispensable — verificado ejecutando una mutación que un
solo `it` combinado no habría detectado (§ Estrategia) — y separar 2(a) de
2(b) evita mezclar dos códigos de error distintos en un aserto. No hay
criterio ablandado ni fusionado de más: es una discrepancia aritmética entre
la nota de encargo y su propia tabla de reparto.

- **(a) Dejarlo así** (recomendada): la cobertura sigue AD5 al pie de la
  letra, cada `it` prueba una sola cosa, y la mutación de § Estrategia muestra
  que fusionar 5(b) en un solo `it` habría dejado pasar un defecto real.
- **(b) Fusionar** 2(a)+2(b) en un `it` con dos peticiones, para que el conteo
  cuadre con "siete". No se recomienda: no reduce trabajo, solo agrupa dos
  aserciones de códigos de error distintos bajo un mismo título, más difícil
  de leer cuando uno de los dos falla.
