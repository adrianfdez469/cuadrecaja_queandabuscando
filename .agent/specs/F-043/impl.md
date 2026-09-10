---
feature: F-043
agente: sdd-implementer
actualizado: 2026-09-10T03:40:00Z
estado: listo
---

## Qué se construyó

Los pasos **1, 3, 4, 5, 9, 11, 12, 13, 14 y 15** del plan firmado. Los pasos
**2, 6, 7, 8, 10 y 18** son de `sdd-tester` y no se tocaron (única excepción:
los dos asertos de `schemas.test.ts:392-402` que el paso 4 exige invertir, más
el nuevo).

| Archivo                                                                                    | Qué hace                                                                                                                                               | Criterio que cubre |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `src/features/sync/server/handlers/zoneTariff.ts`                                          | Paso 1: `assertZoneKnown(zoneCode: string)` privada, llamada entre el `STALE` y el `upsert` (R7 paso 4)                                                | prepara C1, C2, C7 |
| `src/features/sync/schemas.ts`                                                             | Paso 3: fuera `ZONE_CODE_PATTERN`/`isKnownZoneCode`/`zoneCodeSchema`; `zoneCode` pasa a `z.string().nullish()` (STORE) y `z.string()` (ZONE_TARIFF ×3) | C3                 |
| `src/features/zones/boundaries.test.ts`                                                    | Paso 3: se quita `src/features/sync/schemas.ts` de `ALLOWED`, con el comentario de por qué (sensor de AD1)                                             | C3                 |
| `src/features/sync/schemas.test.ts:392-402`                                                | Paso 4: los dos asertos invertidos a `success === true`, más el nuevo `zoneCode: 2101` numérico → `success === false`                                  | C3 (lectura (a))   |
| `src/features/zones/catalog.ts`                                                            | Paso 5: se retira el export `ZONE_CODE_PATTERN`                                                                                                        | — (AD2)            |
| `src/features/sync/server/inbox.ts`                                                        | Paso 9: `markFailed` agrupa por mensaje distinto, un `updateMany` por grupo en vez de por evento                                                       | — (AD5, AP2=(a))   |
| `docs/sync-contract.md`                                                                    | Paso 11: v13.2, los siete sitios de `spec.md` + el 7-bis de AD4 (STORE ownership table también corregida)                                              | C4                 |
| `src/constants/sync.ts:93,134` (offsets originales; el archivo creció con los comentarios) | Paso 12: los dos comentarios nombran el handler, las dos causas y el `failed[]`; `STORE_ZONE_UNKNOWN` gana la nota de I4                               | C4                 |
| `src/features/sync/server/handlers/store.ts:355-372` (docstring)                           | Paso 13: deja de decir «never in storePayloadSchema (I6)», dice que el schema ya no opina sobre ninguna forma del campo                                | — (AD4)            |
| `docs/adr/0034-lo-que-valida-el-sobre-y-lo-que-valida-el-aplicador.md`                     | Paso 14: ADR nueva, los seis puntos de AD3, estado **Aceptada** (construida y fusionada en el mismo ciclo)                                             | — (AD3, AP3=(a))   |
| `docs/adr/0028-configuracion-de-compra-del-pos.md:1-15`                                    | Paso 15: línea nueva apuntando a la 0034, cabecera pasa de «Propuesta» a «Aceptada» (F-032 ya `passes: true`)                                          | — (AP4=(a))        |

## Desviaciones

Ninguna respecto a los diez pasos asignados. Una precisión sobre el paso 11: al
corregir el sitio 7 (`docs/sync-contract.md`, el párrafo de `zoneCode` en el
`payload` de `STORE`), también se corrigió la fila de `STORE_ZONE_UNKNOWN` en
§ «Vocabulario de errores» y la fila `zoneCode` de la tabla de propiedad de
campos (`Store`) con la misma nota de I4 — no es un sitio nuevo, es la doctrina
del 7-bis (AD4) aplicada donde el mismo dato se repite dentro de los sites que
`spec.md` ya localizó.

`npx prettier --write docs/sync-contract.md` se ejecutó sobre el documento
entero (no solo sobre lo escrito en este ciclo), siguiendo AGENTS.md § Cosas
que muerden: el diff resultante se revisó línea a línea (155 líneas, ninguna
con `+`/`-`/`*` al principio de una continuación) y solo reindenta tablas
anchas y colapsa un bloque JSON de comentario a una línea — ningún cambio de
sentido.

I4 (`prisma.business.update` antes de toda guarda en `handleStore`) **no se
arregló**, tal como fija AP1=(a): queda anotada en el contrato (sitio 7) y en
el comentario de `STORE_ZONE_UNKNOWN`, no en el código.

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-043` → 0, firma confirmada.
- `bash .agent/verify.sh F-043` → intento 1: rojo en `test`, un solo fallo:
  `src/features/sync/server/handlers/zoneTariff.db.test.ts` "C6 (E9)" (F-041),
  que afirma `status === 400`. Es exactamente la prueba que `architecture.md`
  § «Pruebas que quedan falsas» punto 1 anticipa que se pone roja SOLA en
  cuanto el paso 3 corre, y que el plan asigna al paso **7** (`sdd-tester`, no
  yo). `npm test`: 1741 passed, 1 failed (162 archivos, 161 verdes).
  typecheck/lint/format: verdes los tres.
- `bash .agent/verify.sh F-043` (intentos 2, 3, 4) → misma firma
  `test:AssertionError: expected 207 to be 400 Object.is equality` las cuatro
  veces (161/162 archivos verdes, 1741/1742 tests). Salida **2 (ESTANCADO)** en
  el cuarto intento: tres repeticiones seguidas de la misma firma. No hay nada
  más que corregir sobre este fallo desde mi alcance: reescribirlo es el paso 7
  del plan, explícitamente asignado a `sdd-tester` y explícitamente prohibido
  para mí («No escribas esas pruebas ni las toques»).
- `npx prettier --check` sobre cada archivo tocado de `.agent/`, `docs/` y
  `src/` → verde.

**`bash .agent/verify.sh F-043 --full` no se ejecutó hasta 0.** No puede
llegarlo estando pendiente el paso 7 (y 2, 6, 8, 10, 18) — la etapa `test`
para el sensor antes de llegar a `prisma`/`build`/`theme`/`bundle`. Es el
estado esperado de este punto del ciclo, descrito en `architecture.md` § «Pruebas
que quedan falsas» y repartido en `plan.md` entre `sdd-implementer` y
`sdd-tester` a propósito («Nunca hay dos escribiendo en `src/` a la vez»).

## Deuda dejada

Ninguna deuda nueva. Lo que queda pendiente es exactamente lo que el plan
reserva a `sdd-tester`:

- Paso 2: el caso unitario de orden en `zoneTariff.test.ts` (zona desconocida
  después de `STALE`, antes de `upsert`).
- Paso 6: la aserción de integridad de la forma DPA en `catalog.test.ts`
  (AD2 — el patrón `ZONE_CODE_PATTERN` retirado en el paso 5 necesita este
  guardián en el mismo ciclo o la forma se pierde entre los dos).
- Paso 7: reescribir `zoneTariff.db.test.ts:400-441` (el único rojo hoy).
- Paso 8: los casos de extremo a extremo nuevos (mal formado, `STORE`
  `.not.toBe(400)`, `null`/ausente, `DELETE`, sucursal ajena).
- Paso 10: el caso de dos mensajes distintos en el mismo lote para `markFailed`
  (AD5, `dependencyCascade.db.test.ts`).
- Paso 18: la puerta, `verify.sh F-043 --full` en 0.

## Qué necesita quien pruebe

Postgres arriba (`bash .agent/sdd.sh start` lo confirma). `npm test` en este
worktree SÍ corre los `*.db.test.ts`. Los emuladores de Auth y Realtime no
responden en este worktree y ningún paso de F-043 los necesita.

El fallo que verá `sdd-tester` al empezar es el esperado: `zoneTariff.db.test.ts`
"C6 (E9)" afirmando `400`, con el `AssertionError: expected 207 to be 400`. Es
la señal de que el paso 3 corrió correctamente, no un defecto — reescribirlo
(paso 7) es literalmente el siguiente paso del plan.

## Preguntas al humano

Ninguna. Los cuatro AP1-AP4 ya estaban respondidos por el humano antes de este
ciclo (`.agent/progress/F-043.md`), y ninguno de los diez pasos asignados
encontró un hueco que el plan no cubriera.
