---
feature: F-044
agente: orquestador
actualizado: 2026-09-10T06:12:25Z
estado: listo
aprobado: sí
---

## Qué se va a construir

El cron de reconciliación de cuadrecaja, que hoy pregunta por una sucursal y
recibe cuántos productos publicados tiene y un hash de sus precios, va a recibir
además cuántas tarifas de envío tiene y un hash de ellas. Con eso, un
`ZONE_TARIFF` que se perdió por el camino deja de ser invisible: los dos lados
comparan dos números y la divergencia salta sola, sin que nadie se acuerde de
mirar. No cambia nada de lo que ya funciona —ni el hash de productos, ni la
entidad `ZONE_TARIFF`, ni el checkout, ni ninguna pantalla— y no hay nada
visible para ningún comprador ni para ningún comerciante.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                            | Archivos                                                                     | Criterio que acerca | Cómo se verifica                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Módulo puro con el esqueleto compartido (`byteOrderedEntries`, `md5OfEntries`) y el hash del tarifario (`tariffEntry`, `tariffReconciliation`): filtra `INHERIT`, ordena por bytes de `zoneCode`, serializa `<zoneCode>:<rule>:<importe>\|`                                                            | src/features/sync/reconciliationHash.ts (paso 1, por crear)                  | 1, 2, 4             | `npm run typecheck`; lo prueba el paso 2                                                                             |
| 2   | Test puro del módulo: R3-R10, y **el golden de R14** — las cuatro filas del vector de productos que el § ⑤ ya publica tienen que seguir dando `62e399684e3a8eafadaae58391537955`                                                                                                                       | src/features/sync/reconciliationHash.test.ts (paso 2, por crear)             | 2, 4                | `npm test -- reconciliationHash`                                                                                     |
| 3   | `storeReconciliationHash` pasa a devolver los cuatro campos: **una** resolución de sucursal, dos `findMany` acotados por ese `store.id` con `Promise.all`, sin `$transaction`. `reconciliationEntry` no se toca                                                                                        | `src/features/sync/server/reconciliation.ts`                                 | 1, 2, 3, 4          | `npm run typecheck`; `npm test -- reconciliation.db` sigue verde (guardián de productos, no se toca)                 |
| 4   | El test de la ruta pasa a los cuatro campos **sin** relajar el `toEqual` a `toMatchObject` (I5)                                                                                                                                                                                                        | `src/app/api/internal/reconciliation/route.test.ts`                          | —                   | `npm test -- route.test` del endpoint                                                                                |
| 5   | Guion que imprime el bloque del vector **ejecutando** `tariffReconciliation`, más su `vector:tariff` en `package.json`                                                                                                                                                                                 | scripts/compute-tariff-vector.ts (paso 5, por crear), `package.json`         | 5                   | `npm run vector:tariff` imprime un JSON válido                                                                       |
| 6   | Lector único del bloque publicado (recorte de sección, un solo bloque `json`, `sha256` publicado), copiando el mecanismo de `src/features/zones/precedence.test.ts`                                                                                                                                    | src/features/sync/contractVector.ts (paso 6, por crear)                      | 5                   | Lo prueba el paso 8                                                                                                  |
| 7   | Las ocho ediciones de `docs/sync-contract.md` en el orden de § «El plan del contrato»: v13.4, párrafo de cambios, los dos campos nombrados en el párrafo de publicación de la v13, fila de endpoints, § ⑤ nuevo, vector + `sha256`, la recuperación partida en dos (I4), la frase de la línea 212 (I3) | `docs/sync-contract.md`                                                      | 1, 5, 6             | `sed -n 3p` dice v13.4; el hook `.claude/hooks/sync-contract-version.sh` calla; `npm run format` y `git diff` limpio |
| 8   | Test que lee el vector **del documento**, ejecuta sus dos casos por la función de producción y recalcula el `sha256` de sus bytes (E15a, E16)                                                                                                                                                          | src/features/sync/reconciliationHash.test.ts (paso 2)                        | 5                   | `npm test -- reconciliationHash`                                                                                     |
| 9   | Pruebas contra Postgres real, archivo nuevo: E2-E10 (dos sucursales, misma dos veces, orden de inserción, aplicar un `ZONE_TARIFF` antes/después, `stale`/`failed`, retracción, cero filas, solo `INHERIT`), E13/E14 (el espejo SQL copiado del contrato y sus dos lecturas ingenuas), E15b, E17, E18  | src/features/sync/server/reconciliationTariff.db.test.ts (paso 9, por crear) | 1, 2, 3, 4          | `npm test -- reconciliationTariff.db`                                                                                |
| 10  | H1: las dos afirmaciones de forma del verificador HTTP pasan a cuatro claves (línea 90 y línea 277), comparando clave a clave y no por `JSON.stringify`                                                                                                                                                | `scripts/check-reconciliation.mjs`                                           | —                   | `node scripts/check-reconciliation.mjs --empty` contra el servidor de desarrollo                                     |
| 11  | La cabecera de `byteOrder.ts` nombra las **dos** ordenaciones de producción, no solo la de productos                                                                                                                                                                                                   | `src/lib/byteOrder.ts`                                                       | —                   | `npm run format:check`                                                                                               |
| 12  | Progreso al día: criterios marcados con el comando que los verificó, y `bash .agent/verify.sh F-044 --full`                                                                                                                                                                                            | `.agent/progress/F-044.md`                                                   | 7                   | `bash .agent/verify.sh F-044 --full` → 0                                                                             |

## De dónde sale cada paso

| Paso | Sale de                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § D1 (tabla de los cuatro exports) y § D2; `spec.md` R3-R10                         |
| 2    | `architecture.md` § D1, «cómo se garantiza R14», puntos 1-2; `spec.md` R14                            |
| 3    | `architecture.md` § D3; `spec.md` R1, R2, R16                                                         |
| 4    | `spec.md` I5; `architecture.md` § D4, última fila de la tabla                                         |
| 5    | `architecture.md` § Componentes («Calculadora del vector») y § «El orden que evita perder un ciclo»   |
| 6    | `architecture.md` § D4, «El vector se lee del documento en los dos proyectos con UN solo mecanismo»   |
| 7    | `architecture.md` § «El plan del contrato», puntos 1-8; `spec.md` R11, R17, R18, I1, I3, I4           |
| 8    | `spec.md` R12, R13, E15a, E16; criterio 5 de `features.json`                                          |
| 9    | `architecture.md` § D4 (tabla de archivos y los dos `describe`); `spec.md` E2-E10, E13-E15b, E17, E18 |
| 10   | `architecture.md` § Riesgos, hallazgo H1                                                              |
| 11   | `architecture.md` § Componentes, última fila                                                          |
| 12   | Regla 8 de `.agent/features.json`; criterio 7                                                         |

## Qué queda fuera

1. **Cualquier acción automática de recuperación del tarifario** (D3). Se
   alerta y ya: no se pone ninguna columna a `NULL`, no se borra ninguna fila.
   La recuperación la hace cuadrecaja reenviando.
2. **Apagar el domicilio de una sucursal mientras su tarifario diverge** (D3).
   Una divergencia dejaría sin domicilio a un negocio que funciona.
3. **Tocar el hash de productos**: ni su entrada, ni su orden, ni su SQL, ni su
   vector, ni el valor que devuelve para ninguna sucursal.
4. **Distinguir «hay una fila `INHERIT`» de «no hay fila».** Es el costo
   aceptado y escrito de R3: no cambia el importe que se le cobra a nadie.
5. **Una query convergente para el tarifario**, análoga a la de § ② para la
   disponibilidad. No existe, y si el agujero documentado sale caro en
   producción es un feature nuevo tuyo.
6. **Un hash de la configuración de la sucursal** (`Store.zoneCode`,
   `deliveryFeeMode`, el calendario). Este feature solo añade el tarifario.
7. **Un endpoint aparte o un objeto anidado** (D2), y **una ADR**: la forma del
   hash es contrato, y su sitio es `docs/sync-contract.md`, como ya pasó con el
   hash de productos en F-014.
8. **Refactorizar `precedence.test.ts`** para que use el lector común del paso 6. Es de F-041 y está verde.
9. **Publicar la v13.** Sigue siendo un borrador esperando el visto bueno de
   cuadrecaja; F-044 lo deja en v13.4.

## Riesgos y plan B

- **Cambia `docs/sync-contract.md`, y hay otro equipo al otro lado.** Es el
  riesgo que no se aprueba de pasada. Mitigación: la v13 **no está publicada**,
  así que esto es una revisión más del mismo borrador (v13.1 F-042, v13.2
  F-043, v13.3 F-045 → v13.4), no una mayor nueva. Lo que sí obliga: el párrafo
  de publicación de la v13 tiene que **nombrar** `tariffs` y `tariffHash`, o un
  lector de la v12.2 no se entera de que la respuesta de ⑤ creció (paso 7).
- **Que la refactorización del paso 1 mueva el hash de productos.** Se notaría
  en el golden del paso 2 (sin Postgres, en milisegundos), en
  `reconciliation.db.test.ts` —espejo SQL escrito a mano, que no se toca— y en
  E17. Plan B: revertir la extracción y duplicar las ocho líneas del esqueleto;
  el hash del tarifario no depende de esa decisión.
- **El `sha256` del bloque del vector publicado mal.** Se calcula **después** de
  `npm run format`, nunca antes; el orden está escrito en la arquitectura y el
  test lo recalcula.
- **La frase nueva del contrato no puede contener la cadena
  `sha256 del bloque JSON del vector (v13):`**, o el test de F-041 empezaría a
  comparar el hash equivocado.
- **`scripts/check-reconciliation.mjs` se rompe en silencio** (H1): `verify.sh`
  no lo corre. Por eso es el paso 10 y no una nota.
- **Sin migración de datos.** No se crea ni se altera ninguna tabla, no hay
  `prisma migrate`, y ninguno de los dos comandos prohibidos de `AGENTS.md`
  entra en juego.

## Coste

Un ciclo de `sdd-implementer` y uno de `sdd-tester`. Se toca de lo que ya
funciona: `src/features/sync/server/reconciliation.ts` (aditivo, con cuatro
guardas sobre el valor del hash de productos), el test de la ruta, el
verificador HTTP, un comentario de `src/lib/byteOrder.ts` y
`docs/sync-contract.md`. Dar marcha atrás a mitad es revertir el commit: no hay
migración, no hay dato escrito, no hay nada publicado a cuadrecaja hasta que la
v13 salga.

## Preguntas antes de aprobar

**PP1 — resuelta, no bloquea.** `AP1` del arquitecto: los `zoneCode` `03` y
`03.05` que la spec puso en el vector **no existen** en el catálogo publicado
—comprobado ejecutando contra `src/features/zones/zone-index.json`: el primer
nivel son `21`…`35` y `40`— y `ZoneTariff.zoneCode` tiene clave ajena contra
`Zone`, así que la mitad de base de E15 fallaría con violación de clave ajena.
**Decisión del orquestador: opción A** — `03` → `21` (Pinar del Río,
`FIRST_LEVEL`) y `03.05` → `21.05` (La Palma, `MUNICIPALITY`), el resto de la
tabla intacto. Conserva todo lo que el vector enseña (el importe `0.00` sobre
una zona de primer nivel, el `NOT_SERVED` sin importe, el orden por bytes con
el prefijo delante, la fila `INHERIT` que no entra) y además lo hace insertable
tal cual. Descartadas la B (renunciar a la mitad de base de E15, que es la
mitad cara del criterio 5) y la C (sembrar zonas sintéticas, que rompe el
`toBe(184)` de `catalogSeed.db.test.ts` y la ADR 0032). No es una disyuntiva de
producto: es elegir códigos que existen sobre códigos que no.

Ninguna otra. D1, D2 y D3 cerraron las tres decisiones de producto, y `sdd-spec`
volvió sin preguntas.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-044 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-10T06:12:25Z — aprobado por el humano: «autoaprueba el plan si creas uno»
