---
feature: F-043
agente: sdd-tester
actualizado: 2026-09-10T03:10:00Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno en el proyecto de Vitest que le corresponde por
extensión (AGENTS.md § Cosas que muerden):

- **Unitario, Prisma mockeado** (`*.test.ts`, proyecto `server`):
  `src/features/sync/server/handlers/zoneTariff.test.ts` fija el ORDEN
  interno de `handleZoneTariff` — que `assertZoneKnown` corre DESPUÉS del
  `STALE` y ANTES del `upsert` (R7 paso 4), sin tocar Postgres.
- **Integridad de artefacto** (`*.test.ts`, proyecto `server`):
  `src/features/zones/catalog.test.ts` — la forma DPA de los 184 códigos
  committeados, ejecutando una regex sobre los bytes del artefacto en disco.
- **Extremo a extremo contra Postgres real** (`*.db.test.ts`, proyecto `db`):
  `zoneTariff.db.test.ts`, `business.db.test.ts` y
  `dependencyCascade.db.test.ts` — a través del `POST` real de
  `/api/internal/sync/catalog`, lo único que prueba las dos capas juntas (el
  sobre que ya no `400` por VALOR, y el handler que sí falla el evento) y lo
  que de verdad queda en la fila.

Los seis pasos que me tocaban (2, 6, 7, 8, 10, 18) están hechos. Los pasos 1,
3, 4, 5, 9, 11-15 son de `sdd-implementer` y ya estaban verdes antes de
empezar (`.agent/specs/F-043/impl.md`); no los re-verifiqué por lectura, los
re-corrí con el sensor (§ Ejecuciones).

## Mapa criterio → prueba

### Los cinco `acceptance_criteria` de `.agent/features.json`

| #   | Criterio (`features.json`)                                                                                                                                   | Prueba                                                                                                                                                                                                                                         | Archivo                                                       | Resultado |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------- |
| 1   | Un `ZONE_TARIFF` con `zoneCode` fuera del catálogo responde `207` con ESE evento en `failed[]`, y los demás del lote se aplican, contando y leyendo después. | `"C1 (F-043, supersedes F-041's criterion 6): …"` — reescritura de la vieja "C6 (E9)" que afirmaba `400`.                                                                                                                                      | `src/features/sync/server/handlers/zoneTariff.db.test.ts`     | **LISTO** |
| 2   | Un `zoneCode` que no cumple la forma DPA responde igual: `failed[]` de ese evento, no `400` de lote, con un código mal formado en un lote de tres.           | `it.each(["2101", "", " 21.01"])("C2 (E2): a malformed zoneCode …")`, 3 ejecuciones.                                                                                                                                                           | `src/features/sync/server/handlers/zoneTariff.db.test.ts`     | **LISTO** |
| 3   | Ningún lote responde `400` por causa de un `zoneCode`, ni en `ZONE_TARIFF` ni en `STORE`, ejecutando los dos casos.                                          | C2 (arriba, `ZONE_TARIFF`) + `"F-043 (C3, E3/E4): a malformed zoneCode … fails THAT event exactly like an unknown one"` (`STORE`) + `"F-043 (C3, I4): a STORE with a malformed zoneCode never gets a 400 of the lote …"` (`STORE`, ángulo I4). | `zoneTariff.db.test.ts` (C9 describe) y `business.db.test.ts` | **LISTO** |
| 4   | `docs/sync-contract.md` sube de versión retirando el `400` de lote, código declarado reintentable, ejemplo de los 499 eliminado, coordinada con cuadrecaja.  | Tres comandos de lectura ejecutados (§ Ejecuciones) + `npm test` verde (incluye el hash del vector sin mover, R15) + fila S-007 (orquestador, ya anotada).                                                                                     | `docs/sync-contract.md`, `.agent/solicitudes.md`              | **LISTO** |
| 5   | `bash .agent/verify.sh F-043 --full` termina en `0`.                                                                                                         | Ejecutado (§ Ejecuciones).                                                                                                                                                                                                                     | —                                                             | **LISTO** |

### Los siete `C1-C7` de `spec.md`

| Criterio                                                                                                                              | Prueba                                                                                                                                                                                                    | Archivo                                               | Resultado |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------- |
| **C1** — `ZONE_TARIFF` desconocido: `207`, ese evento en `failed[]`, los demás se aplican, contado y leído.                           | `"C1 (F-043, supersedes F-041's criterion 6): …"`                                                                                                                                                         | `zoneTariff.db.test.ts`                               | **LISTO** |
| **C2** — mal formado responde igual, en un lote de tres.                                                                              | `it.each(["2101", "", " 21.01"])("C2 (E2): …")`                                                                                                                                                           | `zoneTariff.db.test.ts`                               | **LISTO** |
| **C3** — ningún lote `400` por `zoneCode`, ni `ZONE_TARIFF` ni `STORE` (acotado al VALOR, no al tipo — lectura (a)).                  | C2 + `"F-043 (C3, E3/E4): …"` (STORE malformado, `.not.toBe(400)`) + `schemas.test.ts` ya invertidos por el implementador (paso 4), incluido el aserto que sigue en `400` para `zoneCode: 2101` NUMÉRICO. | `zoneTariff.db.test.ts`, `schemas.test.ts` (ya listo) | **LISTO** |
| **C4** — el contrato sube a v13.2 con los siete sitios + el 7-bis.                                                                    | Comandos de § Ejecuciones (`sed -n 3p`, `grep -c`, `grep -n`).                                                                                                                                            | `docs/sync-contract.md`                               | **LISTO** |
| **C5** — `verify.sh F-043 --full` en `0`.                                                                                             | § Ejecuciones.                                                                                                                                                                                            | —                                                     | **LISTO** |
| **C6** — `STORE` con `zoneCode: null` → `processed`, columna vacía; sin la clave → `processed`, columna intacta.                      | `"F-043 (C6): zoneCode: null clears…"` + `"F-043 (C6): a STORE event WITHOUT the zoneCode key…"`                                                                                                          | `zoneTariff.db.test.ts` (C9 describe)                 | **LISTO** |
| **C7** — `DELETE` con zona inválida → `ZONE_TARIFF_DELETE_NOT_SUPPORTED`; sucursal ausente o ajena → `skipped_not_published` en `ok`. | `"C7 (E8): a DELETE with an INVALID zoneCode…"`, `"C7 (E9): … storeId that does not exist…"`, `"C7 (E10): … ANOTHER business's store…"`                                                                   | `zoneTariff.db.test.ts`                               | **LISTO** |

### Los seis pasos del plan que me correspondían

| Paso | Qué prueba                                                                                                                                                         | Archivo                                                   | Resultado |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------- |
| 2    | El gemelo unitario: zona desconocida DESPUÉS del `STALE`, ANTES del `upsert`; `zoneTariffUpsert` no se llamó.                                                      | `src/features/sync/server/handlers/zoneTariff.test.ts`    | **LISTO** |
| 6    | La forma DPA gana su primera aserción: los 184 códigos cumplen `^\d{2}(\.\d{2})?$`, patrón como constante LOCAL del test (`ZONE_CODE_PATTERN` ya no se exporta).   | `src/features/zones/catalog.test.ts`                      | **LISTO** |
| 7    | La reescritura de "C6 (E9)" → "C1": `207`/`failed[0]`/PRODUCT en `ok`/`syncEvent.count()===2`/cero tarifas/uno de producto.                                        | `src/features/sync/server/handlers/zoneTariff.db.test.ts` | **LISTO** |
| 8    | Los casos nuevos e2e: mal formado (3 variantes), STORE `.not.toBe(400)`, `null`/ausente, `DELETE` con zona inválida, sucursal ajena/inexistente con zona inválida. | `zoneTariff.db.test.ts`, `business.db.test.ts`            | **LISTO** |
| 10   | Dos mensajes de error DISTINTOS en el mismo lote — cada fila queda con el suyo (AD5, la agrupación de `markFailed`).                                               | `src/features/sync/server/dependencyCascade.db.test.ts`   | **LISTO** |
| 18   | La puerta.                                                                                                                                                         | —                                                         | **LISTO** |

Un criterio sin fila sería un criterio sin cubrir — no lo hay: los cinco de
`features.json` y los siete de `spec.md` tienen fila y comando.

## Ejecuciones

```
$ bash .agent/verify.sh F-043 --full
[…]
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       5s
  ✓ format     10s
  ✓ test       31s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s

PASA
$ echo $?
0
```

```
$ bash .agent/verify.sh pending F-043
$ echo $?
0
```

(La única firma pendiente — `test:AssertionError: expected 207 to be 400
Object.is equality`, del intento del implementador contra la vieja aserción
"C6 (E9)" que este ciclo reescribió — se descartó con
`bash .agent/verify.sh dismiss F-043 '<firma>' '<motivo>'`: es la señal
esperada de que el paso 3 quitó el `400`, documentada en `plan.md` y
`architecture.md` desde antes de escribir código, no una trampa del repo.)

```
$ npx vitest run src/features/sync/server/handlers/zoneTariff.db.test.ts \
    src/features/sync/server/handlers/zoneTariff.test.ts \
    src/features/sync/server/handlers/business.db.test.ts \
    src/features/sync/server/dependencyCascade.db.test.ts \
    src/features/zones/catalog.test.ts

 Test Files  5 passed (5)
      Tests  81 passed (81)
```

```
$ sed -n '3p' docs/sync-contract.md
**Versión 13.2** · 9 de septiembre de 2026 — **BORRADOR, sin publicar.** Sale

$ grep -c 'que se lleva 499 eventos' docs/sync-contract.md
0

$ grep -n 'ZONE_TARIFF_ZONE_UNKNOWN' docs/sync-contract.md
# (7 líneas, ninguna afirma "400 de lote" hoy — todas dicen "nunca un 400 de
# lote" o "ya no es un 400 de lote"; revisadas una a una a mano)
```

`npm test` completo (163 archivos, incluidos los cinco de arriba): verde,
ejecutado dentro de `verify.sh F-043 --full` § etapa `test`.

## Fallos encontrados

Ninguno de severidad bloqueante. Un hallazgo, ya conocido y aceptado por el
humano (AP1=(a), I4 de `spec.md`), que mis nuevas pruebas hacen EXPLÍCITO en
vez de dejarlo en prosa:

- **I4, confirmado por ejecución, no solo por lectura**: `handleStore`
  escribe `Business.name`/`baseCurrencyCode` antes de cualquier guarda
  (`src/features/sync/server/handlers/store.ts:74-78`), así que un `STORE`
  que falla por `STORE_ZONE_UNKNOWN` —incluso por un `zoneCode` MAL FORMADO,
  que antes de F-043 ni llegaba al handler— deja ese rastro. Verificado en
  `"F-043 (C3, I4): a STORE with a malformed zoneCode never gets a 400…"`
  (`business.db.test.ts`): `Business.name` pasa de
  `F-015 fixture <token>` a `Negocio F-043` aunque el evento STORE completo
  falle. **No es un defecto nuevo de este ciclo** (preexistente desde la v9,
  `spec.md` § I4) y el humano decidió el 2026-09-09 no arreglarlo aquí
  (AP1=(a)): solo corregir la promesa del contrato, que el implementador ya
  hizo (paso 11, sitio 7-bis). No vuelve a ningún agente — está anotado donde
  `spec.md`/`architecture.md`/el contrato ya lo documentan, y ahora también
  ejecutado.

Nada más: no hay ningún `expect` que se ablandara para pasar, y ninguna
prueba mía reveló un comportamiento distinto del que `spec.md`/
`architecture.md` predicen.

`bash .agent/verify.sh pending F-043` → vacío (la única entrada, la firma
esperada del test reescrito, quedó descartada con motivo — ver § Ejecuciones).

## Huecos de cobertura

- **E13/R10** (`STORE` con `operation: "DELETE"` ignora su `zoneCode`) no
  tiene un test NUEVO de este ciclo: no está citado por ninguno de los C1-C7
  ni por ninguno de los seis pasos que me tocaban, y ya está fijado en R10 de
  `spec.md` con doctrina de F-041 (un `DELETE` nunca configura,
  `store.ts:125`). Riesgo de no probarlo aquí: bajo — es el mismo camino que
  ya cubre `business.db.test.ts`/`store.test.ts` para cualquier otro campo de
  configuración en un `DELETE`, y `spec.md` no lo asigna a ningún criterio de
  aceptación de F-043.
- **E5 (b)/(c)** — los caminos de creación/despublicación de `handleStore`
  con `zoneCode` inválido (las tres escrituras de `assertZoneKnown` en
  `store.ts:138/214/261`) no ganaron un test nuevo por cada una: C9 y las dos
  pruebas nuevas de este ciclo ejercitan el camino de ACTUALIZACIÓN
  (`:214`/`:261`, `publishToStore: true`/`false`); el de CREACIÓN (`:138`)
  quedó cubierto por F-041, sin cambios de comportamiento que F-043 le
  introduzca (la guarda no se movió, R8). Riesgo: bajo — ya tenía cobertura
  de F-041 para el camino "desconocido"; lo único nuevo es que "mal formado"
  cae en la MISMA guarda, y eso sí está probado en la rama de actualización.

Ninguno de los dos huecos bloquea ningún criterio de aceptación de F-043.

## Veredicto

**LISTO.** Los cinco `acceptance_criteria` de `.agent/features.json` y los
siete `C1-C7` de `spec.md` están verificados EJECUTANDO —comando y resultado
real, nunca por lectura—, `bash .agent/verify.sh F-043 --full` termina en
`0`, y `bash .agent/verify.sh pending F-043` queda vacío.

## Preguntas al humano

Ninguna. Los tres huecos de comportamiento que spec.md dejaba vetables
(lecturas (a)/(b)/(c)) ya estaban confirmados por el humano antes de este
ciclo, y ninguna de mis pruebas encontró un criterio imposible de verificar
tal como está escrito.
