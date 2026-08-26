---
feature: F-007
agente: orquestador
actualizado: 2026-08-26T15:14:38Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Nada nuevo de producto: los dos endpoints por los que cuadrecaja recoge los
pedidos y reporta qué hizo con ellos ya existen y funcionan. Lo que no existe es
la **prueba** de que funcionan, y sin eso F-007 no puede cerrar.

Cuando esto exista, `node scripts/pull-orders.mjs` recorrerá el ciclo completo
—crear un pedido por el checkout, recogerlo paginando de uno en uno, verlo pasar
a `PULLED` en la base, reportar su estado, y recibir un `404` por uno que no
existe— y saldrá `0` o dirá exactamente qué criterio falló. Además el cursor y la
ruta de status quedarán cubiertos por pruebas que corren en el CI, que hoy no
tienen ninguna.

No cambia nada de lo que ya funciona: ni el contrato con cuadrecaja, ni el
modelo de datos, ni una línea de la lógica del pull.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                                           | Archivos                                                                                 | Criterio que acerca | Cómo se verifica                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Pruebas del **cursor** de `pullOrders()`: `since` se traslada al `where`, `take` = `limit`, `nextCursor` = último `id` con página llena, `null` con página a medias, `null` con página vacía                                                          | `src/features/orders/server/pull.test.ts`                                                | C1                  | `bash .agent/verify.sh F-007 --only test` → `0`; las pruebas nuevas fallan si se invierte la condición de `R2` |
| 2   | Pruebas del **handler de status**: `200` + `where` por `id`, `404` cuando `count === 0`, `400` por JSON malo, enum inválido y `orderId` no-`BigInt`                                                                                                   | `src/app/api/internal/orders/status/route.test.ts`                                       | C3                  | `bash .agent/verify.sh F-007 --only test` → `0`                                                                |
| 3   | Corregir el **comentario equivocado** de `pull.ts:118` («keeps calling until it gets an empty page»), que describe un protocolo que el código no implementa. Solo el comentario                                                                       | `src/features/orders/server/pull.ts`                                                     | —                   | `bash .agent/verify.sh F-007` → `0` (no cambia comportamiento: ninguna prueba se mueve)                        |
| 4   | `scripts/pull-orders.mjs` con cuatro modos: `--paginate`, `--transition`, `--status`, `--no-outbound`. Siembra vía `place-order.mjs`, lee Postgres con `pg`, sale `0`/`1` como `place-order.mjs`                                                      | `scripts/pull-orders.mjs`                                                                | C1 C2 C3 C4         | `node scripts/pull-orders.mjs` → `0` con el servidor levantado                                                 |
| 5   | `smoke.sh` de F-007: corre los cuatro modos contra la app levantada, con el prefijo `SMOKE FAIL` que el sensor sabe leer                                                                                                                              | `.agent/specs/F-007/smoke.sh`                                                            | C1 C2 C3 C4         | `bash .agent/verify.sh F-007 --smoke` → `0`                                                                    |
| 6   | Ejecutar la verificación completa y anotar el resultado por criterio, con el comando exacto de cada uno                                                                                                                                               | `.agent/specs/F-007/tests.md`, `.agent/progress/F-007.md`                                | C1 C2 C3 C4         | `bash .agent/verify.sh F-007 --full` → `0` y `--smoke` → `0`                                                   |
| 7   | Fichar en el playbook el fallo sin explicar de este ciclo: el test de `CheckoutForm` que solo cae bajo carga (`findByRole` con el timeout de 1 s por defecto)                                                                                         | `.agent/playbook/<slug>.md`                                                              | —                   | `bash .agent/verify.sh pending F-007` sale vacío                                                               |
| 8   | **Añadido tras la verificación (§ Desviación).** Mapear los `issues` de Zod a `{ path, message }` en las cuatro rutas de `/api/internal/*`, con la convención que ya usa `zodIssuesToInvalidBody`, para que un `since` negativo responda 400 y no 500 | `src/app/api/internal/_lib/issues.ts`, las 4 rutas de `/api/internal/*`, `route.test.ts` | C1                  | `node scripts/pull-orders.mjs --paginate` → la aserción «since negativo responde 400» en verde                 |
| 9   | **Añadido tras la verificación (§ Desviación 2).** Subir el techo de espera de Testing Library a 5 s en el arranque de las pruebas, para que el flaky ajeno deje de tumbar el gate de este feature y de los siguientes                                | `vitest.setup.ts`                                                                        | —                   | 5 vueltas de `npx vitest run` con `node_modules/.vite` borrado: 229/229 las cinco                              |

## De dónde sale cada paso

| Paso | Lo justifica                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `spec.md` § Incongruencias (2): «el cursor —el corazón de `C1`— no tiene ninguna prueba». Reglas `R1`, `R2`                                    |
| 2    | `spec.md` § Incongruencias (2): «`POST /orders/status` no tiene ninguna en absoluto». Escenarios `E6`, `E7`                                    |
| 3    | `spec.md` § Incongruencias (1): el comentario de `pull.ts:118` contradice al código y al contrato                                              |
| 4    | `spec.md` § Criterios de aceptación, que nombra los cuatro modos. `architecture.md` § Decisión (2), § Flujo de datos                           |
| 5    | `architecture.md` § Componentes, fila `smoke.sh`. Es el molde de `.agent/specs/F-010/smoke.sh`                                                 |
| 6    | `.agent/README.md` § «Al completar un feature»: una casilla por criterio, con el comando que lo verifica                                       |
| 7    | `architecture.md` § Riesgos, última fila. Y `.agent/README.md` § «Lo que se aprendió no se pierde»                                             |
| 8    | `spec.md` § Casos límite: «`since` negativo → `400 INVALID_QUERY`». El código devuelve 500, así que el paso cierra esa distancia               |
| 9    | `.agent/playbook/testing-library-timeout-1s-bajo-carga.md`, escrita en el paso 7 de este mismo plan: el arreglo es el que ella misma prescribe |

Ningún paso toca la lógica de `pullOrders()` ni de las dos rutas. Si alguno lo
necesitara, sería alcance que el humano no firmó y volvería aquí.

## Desviación: por qué este plan se firma dos veces

El plan original decía, en § Riesgos: «si el paso 4 o 5 descubre un fallo real,
**no lo arreglo por mi cuenta**: el plan vuelve a borrador y a tu firma». Pasó.

`node scripts/pull-orders.mjs --paginate` encontró que
`GET /api/internal/orders?since=-1` responde **500 con el cuerpo vacío** donde
`spec.md` § Casos límite dice `400 INVALID_QUERY`. La validación funciona —Zod
rechaza el negativo correctamente—; lo que rompe es **contarlo**: el issue
`too_small` de un schema `bigint` lleva `minimum: 0n`, y `NextResponse.json`
hace `JSON.stringify` sobre `parsed.error.issues`, que lanza sobre un BigInt.
Es decir, la rama del 400 (`route.ts:25`) es la que revienta.

Por qué se arregla en vez de anotarse:

- `-1` es el centinela habitual de «todavía no tengo cursor». Quien llama es
  **otro equipo**, y lo que recibiría es un 500 sin cuerpo: ninguna forma de
  saber que su entrada estaba mal. Es exactamente el modo de fallo que
  `guard.ts` evita a propósito devolviendo un 503 distinto en vez de un 401 mudo.
- El arreglo **ya tiene precedente en el repo**: `zodIssuesToInvalidBody`
  (`src/app/api/orders/_lib/body.ts:44`) reduce los issues a `{ path, message }`
  para las rutas públicas. Las internas nunca adoptaron la convención. Aplicarla
  no inventa nada.
- **No es un cambio de contrato.** `issues` no aparece en
  `docs/sync-contract.md`: el contrato documenta las formas de éxito y los
  códigos de error, no el detalle del payload de validación. No hay que
  coordinar con cuadrecaja.

Alcance del paso 8, acotado: `since` es el **único** `coerce.bigint()` del repo
(`grep -rn "coerce.bigint" src/`), así que solo esa ruta está rota hoy. Las otras
tres de `/api/internal/*` pasan los issues en crudo igual, sin bigint en sus
schemas: el riesgo es latente, no activo, y se cierra de paso porque es la misma
línea de código.

## Desviación 2: el flaky ajeno que bloqueaba el cierre

El paso 7 fichó el test flaky de `CheckoutForm` **sin arreglarlo**, porque son
pruebas de F-010. Con la ficha escrita, el fallo volvió: tumbó
`verify.sh F-007 --full` por segunda vez en el mismo ciclo (1018 ms, misma
firma, 2 de 7 ejecuciones de la etapa `test`). Un tercero seguido con la misma
firma es `ESTANCADO` por contrato del sensor.

Eso lo convirtió en otra cosa: ya no era deuda anotada de otro feature, era lo
único que separaba a F-007 de un cierre limpio, y cerrar «reejecutando hasta que
salga verde» habría hecho que la verificación final dependiera de la suerte.
Se llevó al humano, que dijo «Aplica el arreglo global», y por eso este plan
lleva **tres** firmas.

El arreglo es el que prescribe la propia ficha, en su variante global: una
llamada a `configure({ asyncUtilTimeout: 5000 })` en `vitest.setup.ts`. Se eligió
sobre tocar los dos asertos de `CheckoutForm.test.tsx` porque `vitest.setup.ts`
es **infraestructura de pruebas compartida**, no la lógica de las pruebas de
F-010: no cambia lo que ninguna prueba afirma, solo cuánto se le permite tardar.

Verificado como se verifica un flaky, que es repitiendo: 5 vueltas de la suite
completa con `node_modules/.vite` borrado en cada una, 229/229 las cinco. Antes
del cambio, el mismo experimento daba verde-rojo-verde.

## Qué queda fuera

- **El claim atómico del pull** (`spec.md` R6). Hoy `findMany` y `updateMany` van
  en dos round-trips sin nada atómico entre ellos: dos pollers concurrentes se
  llevarían el mismo pedido y el POS lo duplicaría. Fuera **por decisión del
  humano**: cuadrecaja corre un único poller secuencial, así que no se
  materializa. Queda documentado como invariante que el POS debe respetar.
- **Guardas de transición en `POST /orders/status`**. Se puede mover un pedido de
  `DELIVERED` a `CONFIRMED`, o poner `CONFIRMED` en uno que nunca se pulleó.
  Fuera **por decisión del humano**: el POS es la autoridad del estado, y añadir
  guardas podría romper un reintento legítimo suyo.
- **Mover la ruta de status a `features/orders/server/`**. Usa `prisma`
  directamente en `app/`, saltándose la capa que `AGENTS.md` impone. Es deuda
  real, pero es un refactor de producción y el alcance firmado es verificar.
- **Cambiar `docs/sync-contract.md`**. No hace falta: ya describe lo que el
  código hace. Y cambiarlo obliga a coordinar con el otro equipo.
- **Avisar al equipo de cuadrecaja de la v2 del contrato**, pendiente desde
  F-010. Es una acción del humano; un agente no puede cerrarla.
- **Subir la cobertura de `src/lib/` al 80 %**. Es de F-009, no de aquí, aunque
  los pasos 1 y 2 la empujen un poco.
- **Purgar o archivar pedidos ya entregados**. Crecen sin límite; nadie ha dicho
  cuánto deben vivir (`spec.md` § No decidido).

## Riesgos y plan B

- **Sin migración.** El modelo `Order` ya tiene `status`, `pulledAt` y el índice
  `[status, id]`. Ninguno de los dos comandos prohibidos de `AGENTS.md` aparece
  en ningún paso: el script siembra por HTTP, a través del checkout público.
- **Sin cambio de contrato.** `docs/sync-contract.md` no se toca.
- **Si el paso 4 o 5 descubre un fallo real en `pullOrders()`**, se nota porque
  el script sale `1`. Entonces **no lo arreglo por mi cuenta**: el plan vuelve a
  `borrador` y a tu firma, porque tocar producción está fuera de lo acordado.
- **La base es compartida con el checkout principal.** Este worktree apunta al
  Postgres del contenedor que ya estaba levantado (`localhost:5433`), el mismo
  que usa la copia principal del repo. El script crea pedidos nuevos y marca
  como `PULLED` pedidos `PENDING` que encuentre — incluidos los que hubiera
  dejado otra sesión. No borra nada y no es destructivo, pero si estabas
  mirando un pedido en `PENDING` allí, aparecerá `PULLED`.
- **Marcha atrás:** todo lo nuevo son archivos nuevos (`pull-orders.mjs`,
  `route.test.ts`, `smoke.sh`, la ficha del playbook) más dos ediciones
  aditivas (`pull.test.ts`, el comentario de `pull.ts`). Borrarlos deja el repo
  exactamente como estaba; no hay estado que deshacer salvo los pedidos de
  prueba en la base local, que son los mismos que ya deja `place-order.mjs`.

## Coste

Un solo ciclo, sin subagentes (los llevo yo). Siete pasos, de los cuales solo el
3 toca un archivo de producción y es un comentario. Lo que se toca de lo que ya
funciona: `pull.test.ts` (se le añaden pruebas, no se le quitan) y ese
comentario. Todo lo demás son archivos nuevos.

## Preguntas antes de aprobar

Ninguna. Las tres decisiones que hacían falta ya las tomaste —alcance, un solo
poller, el POS como autoridad— y están escritas en `spec.md` § SP1–SP3, que es
donde viven.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-XXX '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-26T14:43:10Z — aprobado por el humano: «Aprobado, adelante»

- 2026-08-26T14:50:14Z — aprobado por el humano: «Arréglalo dentro de F-007»

- 2026-08-26T15:14:38Z — aprobado por el humano: «Aplica el arreglo global»
