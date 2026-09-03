---
feature: F-033
agente: orquestador
actualizado: 2026-09-02T18:32:20Z
estado: listo
aprobado: sí
---

## Qué se va a construir

El POS de cuadrecaja va a poder **releer pedidos que ya pulleó**, que hoy le son
invisibles: `?status=AWAITING_CUSTOMER` le devuelve todos los que estén en un
estado, y `?ids=42,57` relee un conjunto concreto. Las dos ignoran el cursor,
ninguna lo mueve, y con ellas el encargado por fin se entera de que el comprador
aceptó o rechazó una propuesta.

Lo que **no** cambia: el pull incremental de siempre responde exactamente lo
mismo que en la v7, con el mismo cuerpo y la misma firma, y un POS que no
implemente nada de esto sigue siendo un consumidor correcto. No se toca la base
de datos, no hay migración, y el navegador no recibe un byte más de JavaScript.

## Pasos

Los pasos 1 a 3 son un refactor sin cambio de comportamiento: existen para que
un pedido servido lateralmente sea el **mismo** objeto que sirve el pull, en vez
de una copia del `select` de 50 líneas. Su verificación es la más dura del plan
—los tests de hoy en verde **sin editarlos**— y por eso van primero.

| Nº  | Qué se hace                                                                                                                                                           | Archivos                                                                                                                                                   | Criterio que acerca | Cómo se verifica                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Extraer a un módulo propio la forma del payload del POS: el `select`, el mapeo a `PulledOrder` y sus tipos. `pull.ts` los importa en vez de definirlos.               | crear src/features/orders/server/pulledOrder.ts · `src/features/orders/server/pull.ts`                                                                     | prepara R2          | `npx vitest run src/features/orders/server/pull.test.ts` en verde **y `git diff --stat` sin cambios en ese test**. Refactor: cero comportamiento nuevo. |
| 2   | Añadir al final del archivo de constantes los cinco literales de validación y los cuatro topes (100 ids, techo de `int8`, límites del `limit`).                       | `src/constants/orders.ts`                                                                                                                                  | 6, 7, 8             | `npm run typecheck` y `npm run lint`. Nada existente cambia: `git diff` solo añade.                                                                     |
| 3   | Añadir el compositor que mete los dos barridos de vencimiento y una lectura en la misma transacción, y hacer que el pull lo use.                                      | `src/features/orders/server/expiry.ts` · `src/features/orders/server/pull.ts`                                                                              | prepara R8          | `npx vitest run src/features/orders/server/pull.test.ts src/features/orders/server/pull.db.test.ts`, otra vez **sin editarlos**.                        |
| 4   | Escribir el parser puro de la query: presencia primero (los tres parámetros con `getAll().join(",")`), luego el modo, luego el Zod de ese modo.                       | crear src/features/orders/internalOrdersQuery.ts                                                                                                           | 6, 7, 8             | `npm run typecheck`. Es una función pura sin `Request` ni Prisma; su prueba entra en el paso 9.                                                         |
| 5   | Escribir las dos lecturas laterales. Sin `updateMany` en su grafo de imports, y con el `where`/`orderBy` que encaja en el índice que ya existe.                       | crear src/features/orders/server/lateralRead.ts                                                                                                            | 1, 3, 5, 9          | `npm run typecheck` y `grep -rn 'updateMany' src/features/orders/server/lateralRead.ts` **sin resultados**.                                             |
| 6   | En la ruta: sustituir el schema de dos campos por el parser y despachar los tres modos. La respuesta lateral lleva `nextCursor: null` y `nextAfter`.                  | `src/app/api/internal/orders/route.ts`                                                                                                                     | 1–9                 | `npx vitest run src/app/api/internal/orders/route.test.ts src/app/api/internal/boundaries.test.ts` en verde y sin editar.                               |
| 7   | Subir el contrato a **v8**: la línea 3, «Cambios respecto a la v7», la fila del endpoint, § ③④ Pedidos, la fila de `400 INVALID_QUERY` y la nota del pull.            | `docs/sync-contract.md`                                                                                                                                    | 13                  | El hook `.claude/hooks/sync-contract-version.sh` no avisa, y `head -3` dice v8. Los ocho puntos que debe decir están en `spec.md`.                      |
| 8   | Añadir al guion de humo el modo `--lateral`, que hace las dos lecturas contra el servidor levantado y las distingue del pull en su salida.                            | `scripts/pull-orders.mjs`                                                                                                                                  | 12                  | `node scripts/pull-orders.mjs --lateral` sale 0 con la app levantada, y su salida nombra las dos lecturas laterales aparte del pull.                    |
| 9   | Pruebas unitarias nuevas: el parser sin mocks, la ruta con los dos módulos mockeados, y las lecturas laterales (incluido que no marcan `PULLED`).                     | crear src/features/orders/internalOrdersQuery.test.ts · src/app/api/internal/orders/route.lateral.test.ts · src/features/orders/server/lateralRead.test.ts | 5, 6, 7, 8          | `npm run test` en verde, y cada criterio con su caso nombrado. Los escribe `sdd-tester`.                                                                |
| 10  | Pruebas contra Postgres real: el pedido por debajo del cursor, el cursor que no se mueve, el aislamiento entre negocios, la paginación con `limit=1`, y el `EXPLAIN`. | crear src/features/orders/server/lateralRead.db.test.ts                                                                                                    | 1, 2, 4, 9, 11      | `npx vitest run src/features/orders/server/lateralRead.db.test.ts` en verde, con el `EXPLAIN` afirmando el índice `(businessId, status, id)`.           |
| 11  | Verificación de cierre: resolver una propuesta **de verdad** desde la página del pedido y comprobar que desaparece de la lectura por estado.                          | ninguno (solo se ejecuta)                                                                                                                                  | 10, 14              | `bash .agent/verify.sh F-033 --full` en 0, `... --smoke` en 0, y el criterio 10 aprobando o rechazando desde la página, sin tocar columnas.             |

## De dónde sale cada paso

| Paso | Sale de                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` DA1 y R2 de `spec.md` («el mapeo es el mismo código, no una copia»)                                                     |
| 2    | `architecture.md` DA4; los cinco literales los nombra `spec.md` § «No decidido a propósito», los topes son SP2 y AP2                      |
| 3    | `architecture.md` DA2 y R8 de `spec.md` (el barrido corre también en la lectura lateral)                                                  |
| 4    | `architecture.md` DA3; R6 de `spec.md` (la exclusión se detecta por presencia) y AP1 (`getAll().join(",")`)                               |
| 5    | `architecture.md` DA1 y DA5; R7 de `spec.md` (no marca `PULLED`)                                                                          |
| 6    | `architecture.md` DA7; R1 de `spec.md` (`nextCursor` siempre `null`) y SP7 (`nextAfter`)                                                  |
| 7    | Criterio 13 del feature, los ocho puntos de `spec.md` § «Qué tiene que decir la v8», y la fila nueva de errores de `architecture.md` § v8 |
| 8    | Criterio 12 del feature y `architecture.md` DA8                                                                                           |
| 9    | `architecture.md` DA8 § «Se crean»; los casos salen de E10–E15 de `spec.md`                                                               |
| 10   | `architecture.md` DA5 y DA8; los escenarios son E1, E2, E4 y E7 de `spec.md`                                                              |
| 11   | Criterios 10 y 14 del feature; E18 de `spec.md`                                                                                           |

Ningún paso añade alcance que no esté en esos dos documentos.

## Qué queda fuera

- **Empujar nada hacia cuadrecaja.** Seguimos sin llamar nunca al POS (ADR
  **0002** — el `notes` del feature la cita como 0003 y está mal; queda anotado,
  `features.json` no se toca).
- **El timbre de F-020.** No se toca. El agujero del cursor existe igual con el
  cron solo, así que arreglarlo no pasa por el timbre.
- **El pull incremental y sus consumidores.** Misma firma, mismo cuerpo, mismo
  `updateMany`, mismo `nextCursor`. Los pasos 1 y 3 lo tocan por dentro y su
  verificación es justamente que no cambió nada.
- **El tope de `since`** (AP2). Hoy un `since` por encima de 2^63−1 responde
  `500` en vez de `400`; es preexistente, el pull está fuera de alcance, y la v8
  documenta la asimetría en vez de arreglarla a escondidas.
- **Los `console.error` de la ruta y del guard**, que contradicen `AGENTS.md`.
  Preexistentes y no cubiertos por ningún criterio; todo log nuevo va con
  `console.warn`.
- **Una lista de estados en `?status=`** (SP1) y **cualquier migración o índice
  nuevo** (criterio 11). Si `?ids=` resultara necesitar un índice, es un feature
  nuevo tuyo, no un añadido de aquí.
- **Restringir qué estados son legibles.** Los nueve del enum lo son, incluidos
  los terminales: es la lectura literal del criterio 6.

## Riesgos y plan B

**Sí hay cambio en `docs/sync-contract.md`, y es MAYOR: v7 → v8.** No se aprueba
de pasada. La regla del propio contrato dice que tocar lo que el POS envía es
mayor «sea aditivo o no», y añadir tres parámetros lo es. Decidiste escribirla
ahora y avisar al otro equipo al cerrar el feature. **No hay migración de datos
ni ningún comando de los que `AGENTS.md` prohíbe.**

| Riesgo                                                                 | Cómo se notaría                                                     | Qué se hace                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| La extracción de los pasos 1 y 3 cambia sin querer el payload del pull | `pull.test.ts` o `pull.db.test.ts` en rojo **sin haberlos editado** | Revertir a un `select` y un mapeo dentro de `pull.ts`, exportados desde ahí. El diff tiene que ser un corta y pega. |
| El `EXPLAIN` del criterio 11 sale intermitente                         | `Seq Scan` en una corrida y no en otra                              | `VACUUM ANALYZE "Order"`, no solo `ANALYZE` — hay ficha en el playbook para esto.                                   |
| El modo `--lateral` se ancla a un pedido que no sembró él              | Fallos que dependen de qué haya en la base compartida               | Anclar todo a los ids que el propio guion crea — hay ficha en el playbook.                                          |
| La v8 se escribe y la línea 3 no se mueve                              | El hook `sync-contract-version.sh` avisa                            | Subir la versión en la **primera** edición del archivo, no al final.                                                |
| El genérico del compositor no cuadra con `$transaction`                | `npm run typecheck`                                                 | Array inline en las tres lecturas; R8 se cumple igual.                                                              |
| Un agente se estanca (3 intentos, misma firma)                         | `verify.sh` sale con código 2                                       | Vuelve a mí, no al mismo agente. Según qué falle: arquitectura, spec, o pregunta para ti.                           |

## Coste

Dos ciclos de agente: **`sdd-implementer`** hace los pasos 1 a 8 y
**`sdd-tester`** los 9 a 11. De lo que ya funciona se toca por dentro el pull
incremental (pasos 1, 3 y 6) y la ruta que lo sirve; todo lo demás es añadir.

Marcha atrás a mitad: los pasos 4, 5, 9 y 10 son archivos nuevos y se borran sin
rastro. Los pasos 1, 2 y 3 son un refactor que **se puede quedar** aunque el
feature se abandone: mejora el repo por su cuenta y sus tests no cambiaron. Los
que sí habría que deshacer a mano son el paso 6 (la ruta) y, sobre todo, el paso
7: si la v8 ya se publicó y el feature se abandona, hay que retirarla y avisar al
otro equipo, que es el único paso con coste externo.

## Preguntas antes de aprobar

Ninguna abierta. La única que había quedó resuelta antes de la firma:

- **PP1 — ¿quieres además una ADR, o basta con la v8 del contrato?**
  _Decidido (2026-09-02, humano):_ **(a) sin ADR. La v8 del contrato es el
  sitio.** No se escribe la 0029.
  _Por qué:_ las tres decisiones con vocación estructural —el endpoint tiene tres
  modos, la lectura lateral no consume ni marca, y no cuenta para «un solo pull en
  vuelo»— son contrato con cuadrecaja, y ese contrato es donde obligan. Ninguna
  contradice a la ADR 0002 ni a la 0013. `AGENTS.md` pide ADR para una decisión
  estructural nueva, y esta lo es hacia fuera y no hacia dentro: una ADR que solo
  repita lo que el contrato ya obliga es la clase de documento que envejece sin
  que nadie lo lea.
  _Dónde vive:_ los ocho puntos de la v8 están en `spec.md` § «Qué tiene que
  decir la v8» y la fila nueva de errores en `architecture.md`; el paso 7 de este
  plan los escribe.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-033 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-02T18:32:20Z — aprobado por el humano: «Sí, adelante — y PP1: sin ADR, la v8 del contrato es el sitio»
