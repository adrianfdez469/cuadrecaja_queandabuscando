---
feature: F-007
agente: sdd-implementer
actualizado: 2026-08-26T13:00:00Z
estado: listo
---

## Qué se construyó

| Archivo                                            | Qué hace                                                                                                                                    | Criterio que cubre |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `scripts/pull-orders.mjs`                          | **Nuevo.** Hace de POS: siembra pedidos por el checkout público y ejerce los dos endpoints. 44 aserciones en 4 modos                        | C1 C2 C3 C4        |
| `.agent/specs/F-007/smoke.sh`                      | **Nuevo.** Engancha los 4 modos con el sensor y comprueba antes que la app responde y que hay `SYNC_TOKEN`                                  | C1 C2 C3 C4        |
| `src/app/api/internal/_lib/issues.ts`              | **Nuevo.** `serializableIssues()`: reduce los issues de Zod a `{ path, message }` para que ningún BigInt llegue a JSON                      | C1 (paso 8)        |
| `src/app/api/internal/orders/route.test.ts`        | **Nuevo.** 8 pruebas del handler del pull, incluida la regresión del `since` negativo                                                       | C1                 |
| `src/app/api/internal/orders/status/route.test.ts` | **Nuevo.** 10 pruebas del handler del status: 200, 404, los tres 400, 401 y 503                                                             | C3                 |
| `src/features/orders/server/pull.test.ts`          | **Ampliado.** +5 pruebas del cursor (`since`→`where`, `take`, lleno/a-medias/vacío, recorrido completo). De 4 a 9                           | C1                 |
| `src/app/api/internal/orders/route.ts`             | `issues: serializableIssues(parsed.error)`. Una línea                                                                                       | C1 (paso 8)        |
| `src/app/api/internal/orders/status/route.ts`      | Lo mismo. Una línea                                                                                                                         | C3 (paso 8)        |
| `src/app/api/internal/sync/catalog/route.ts`       | Lo mismo. Preventivo: sin bigint en su schema hoy                                                                                           | — (paso 8)         |
| `src/app/api/internal/sync/availability/route.ts`  | Lo mismo. Preventivo                                                                                                                        | — (paso 8)         |
| `src/features/orders/server/pull.ts`               | **Solo un comentario.** El de `nextCursor` describía un protocolo que el código no implementa                                               | —                  |
| `vitest.setup.ts`                                  | **Modificado (paso 9).** `configure({ asyncUtilTimeout: 5000 })`: el techo de espera de Testing Library, que era 1 s y hacía la suite flaky | — (paso 9)         |
| `.agent/playbook/testing-library-timeout-1s-...`   | **Nuevo.** El fallo sin explicar de este ciclo, con la causa medida                                                                         | —                  |

La lógica de `pullOrders()` **no se tocó**: ni una línea ejecutable. Es lo que
el plan firmado decía.

## Desviaciones

**Una, y se re-firmó antes de aplicarla.** El plan original tenía siete pasos y
excluía tocar producción. `pull-orders.mjs --paginate` encontró que
`GET /api/internal/orders?since=-1` respondía **500 con el cuerpo vacío** donde
`spec.md` § Casos límite dice `400 INVALID_QUERY`. Como el plan mandaba
—«no lo arreglo por mi cuenta: el plan vuelve a borrador y a tu firma»— se paró,
se le llevó al humano con el diagnóstico, y con su «Arréglalo dentro de F-007»
el plan pasó a `borrador`, se le añadió el paso 8 con su § Desviación y se
volvió a firmar. `sdd.sh approve` se niega a firmar dos veces sin ese paso, que
es exactamente para lo que sirve.

El arreglo se mantuvo dentro de lo acordado: `serializableIssues()` copia la
convención que ya usaba `zodIssuesToInvalidBody`
(`src/app/api/orders/_lib/body.ts:44`) y devuelve el mismo tipo
`InvalidBodyIssue`, así que las dos mitades de la API reportan un error de
validación igual. No inventa una convención nueva.

**Y una segunda desviación, también re-firmada.** El flaky de `CheckoutForm`
—fichado en el paso 7 y deliberadamente no arreglado— volvió a tumbar `--full`
(1018 ms, misma firma, 2 de 7 ejecuciones de la etapa `test`). Dejó de ser
deuda ajena para ser lo único que impedía cerrar F-007, y un tercer fallo
seguido con la misma firma es `ESTANCADO`. El humano dijo «Aplica el arreglo
global» y entró el paso 9. Detalle en `plan.md` § Desviación 2.

**Dos cosas que NO se desviaron, aunque se detectaron:**

- El claim no atómico del pull (`spec.md` R6) sigue igual. Decisión del humano:
  un solo poller secuencial.
- La ruta de status sigue usando `prisma` directamente en `app/`, saltándose
  `features/*/server/`. Es deuda real —y ESLint no la pesca, porque su regla
  cubre `src/app/**/*.tsx` y esto es `.ts`— pero mover código de producción no
  estaba en el alcance.

## Comandos ejecutados

| Comando                               | Salida | Resultado                                                                             |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `bash .agent/verify.sh F-007 --full`  | `0`    | 9 etapas verdes: harness, typecheck, lint, format, test, prisma, build, theme, bundle |
| `bash .agent/verify.sh F-007 --smoke` | `0`    | 5 etapas + smoke; los 4 modos, `0 modos fallidos`                                     |
| `npx vitest run`                      | `0`    | 229 pruebas (eran 206: +23)                                                           |
| `node scripts/pull-orders.mjs`        | `0`    | `0 aserciones fallidas` de 44                                                         |
| `grep -rn CUADRECAJA_API_URL src/`    | `1`    | sin coincidencias — C4                                                                |

Dos intentos intermedios fallaron y se arreglaron en el bucle del sensor, sin
subir al humano: `format` (la bitácora lo reconoció: `npm run format`) y
`harness` (una ruta mal escrita en `spec.md`, que el propio check nombraba).

**Las dos regresiones se comprobaron rompiendo el código a propósito**, que es
lo único que distingue una prueba que protege de una que decora:

- Invertir `R2` en `pull.ts` (`nextCursor: last ? …`) → falla **solo** «devuelve
  null cuando la página vino a medias», 1 de 9. Restaurado.
- Devolver `parsed.error.issues` en crudo → fallan las 2 pruebas nuevas del
  `since` negativo con `TypeError: Do not know how to serialize a BigInt`.
  Restaurado.

## Deuda dejada

Sin `TODO` nuevo en el código. Lo que queda anotado y dónde:

1. **Claim no atómico del pull** — `spec.md` R6 y § No decidido. Se cierra con
   `UPDATE … RETURNING` en una sentencia, con el cuidado que pide el pooler en
   modo transacción. Solo hace falta si cuadrecaja añade un segundo poller.
2. **La ruta de status usa Prisma en `app/`** — `architecture.md` § Riesgos.
   Mover el acceso a `features/orders/server/`. ESLint no lo detecta: su regla
   cubre `src/app/**/*.tsx`, no `.ts`.
3. ~~El test flaky de `CheckoutForm`~~ — **resuelto en el paso 9**, tras volver
   a caer. Ficha: `.agent/playbook/testing-library-timeout-1s-bajo-carga.md`.
   Lo que queda de deuda es menor: las dos pruebas siguen dependiendo de un
   techo de tiempo en vez de esperar una señal explícita, pero eso es cierto
   de cualquier prueba asíncrona de UI.
4. **Avisar a cuadrecaja de la v2 del contrato** — pendiente desde F-010, y es
   del humano.

## Qué necesita quien pruebe

```bash
docker compose up -d          # Postgres en 5433 (ojo: el contenedor es compartido)
npm ci && npm run db:migrate && npm run seed
cp .env.example .env          # DATABASE_URL/DIRECT_URL al 5433; SYNC_TOKEN de 32+ chars
bash .agent/verify.sh F-007 --full && bash .agent/verify.sh F-007 --smoke
```

Datos que hacen falta: `tienda-demo` con al menos un producto visible y no
agotado. Los pone `npm run seed`. El script siembra sus propios pedidos, no
reutiliza los que encuentre.

**Qué es frágil, y conviene saberlo antes:**

- **El contenedor de Postgres es compartido** con la copia principal del repo
  (mismo puerto 5433, mismo volumen). `--transition` marca como `PULLED` los
  pedidos `PENDING` que encuentre, incluidos los de otra sesión. No borra nada.
- **Un solo `next dev` por directorio** (ficha `next-dev-uno-por-directorio`).
  Si iteras con un servidor propio, mátalo antes de `--smoke`, o el que levanta
  el sensor muere y el fallo que verás será «el servidor no llegó a levantar».
- **Comprueba que el servidor que responde es el tuyo.** `lsof -a -p <PID> -d cwd -Fn`.
  Verde contra el checkout de al lado es indistinguible de verde de verdad, y ya
  pasó en F-010.
- **`smoke` tarda ~3 s y eso es correcto**, no es que se lo salte: Turbopack
  arranca en ~200 ms y las peticiones son de milisegundos. Se confirma en el
  log del servidor, que `verify.sh` pega al final.

## Preguntas al humano

**IP1 — RESUELTA.** ¿Se arregla el test flaky de `CheckoutForm`? Bloquea nada de F-007,
pero caerá en CI ~1 vez de cada 3 y cada caída parecerá un fallo del feature que
esté en curso. El arreglo está medido y es de una línea por aserto
(`{ timeout: 5000 }`), o global con `configure({ asyncUtilTimeout: 5000 })` en
`vitest.setup.ts`. Son pruebas de F-010, así que no se tocaron.
**Respuesta del humano:** «Aplica el arreglo global». Hecho en el paso 9
(`vitest.setup.ts`), verificado con 5 vueltas de la suite con la caché
borrada: 229/229 las cinco.
