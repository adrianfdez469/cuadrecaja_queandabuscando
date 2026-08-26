---
feature: F-007
agente: sdd-architect
actualizado: 2026-08-26T11:45:00Z
estado: listo
---

## Estado actual relevante

Todo el código de producto de F-007 **ya existe** y no se va a reescribir. Lo
que falta es el arnés que lo ejercite.

| Archivo                                       | Qué hace hoy                                                      | Se reutiliza |
| --------------------------------------------- | ----------------------------------------------------------------- | ------------ |
| `src/app/api/internal/orders/route.ts`        | `GET` del pull. Zod sobre `since`/`limit`, `force-dynamic`        | tal cual     |
| `src/app/api/internal/orders/status/route.ts` | `POST` del reporte de estado. `updateMany` + `404` si `count===0` | tal cual     |
| `src/features/orders/server/pull.ts`          | `pullOrders()`: la consulta, el mapeo v2 y el marcado a `PULLED`  | tal cual¹    |
| `src/app/api/internal/_lib/guard.ts`          | Bearer compartido de `/api/internal/*`: `401` / `503`             | tal cual     |
| `src/features/orders/server/pull.test.ts`     | 4 pruebas, todas de compatibilidad v2 (F-010)                     | se amplía    |
| `scripts/place-order.mjs`                     | Crea un pedido por el checkout público de F-010                   | tal cual     |
| `scripts/send-catalog-batch.mjs`              | El patrón de script de verificación de F-005                      | como molde   |
| `.agent/specs/F-010/smoke.sh`                 | Levanta la app y la ejerce de verdad                              | como molde   |

¹ Salvo un comentario equivocado en `pull.ts:118` — ver § Decisión.

Lo que **no** existe: ningún script que ejerza estos dos endpoints, ninguna
prueba del cursor, ninguna prueba de la ruta de status.

## Decisión

Construir el arnés en dos niveles, porque prueban cosas distintas y ninguno
sustituye al otro:

1. **Pruebas unitarias con Prisma mockeado** (`vitest`, proyecto `node`) para la
   lógica del cursor y para el handler del status. Rápidas, corren en el CI, y
   son la red de regresión permanente. Es el patrón que ya usa
   `pull.test.ts`: `vi.mock("@/lib/prisma")`.
2. **Un script de verificación ejecutable** (`scripts/pull-orders.mjs`) contra un
   servidor y una base reales, con pedidos nacidos del checkout. Es lo que
   satisface la regla del proyecto de que nadie declara que algo funciona sin
   haberlo ejecutado. No corre en el CI: necesita Postgres y un servidor
   levantado.

**Alternativas descartadas:**

- _Solo el script, sin pruebas unitarias._ Deja F-007 sin regresión en el CI: el
  cursor podría romperse y nada avisaría. Es exactamente el hueco que este
  feature viene a cerrar.
- _Solo pruebas unitarias, sin script._ Con Prisma mockeado, `PENDING → PULLED`
  se verifica contra un `vi.fn()`, no contra una fila. La regla del proyecto pide
  ejecutar, y `C2` es una transición en la base.
- _Un test de integración en vitest que hable con Postgres._ Ninguna otra feature
  lo hace; el repo verifica lo end-to-end con scripts `.mjs` (F-005, F-006,
  F-008). Introducir un tercer estilo de prueba es coste sin beneficio.
- _Extender `send-catalog-batch.mjs`._ Ese script sincroniza catálogo; los
  pedidos van al revés. Mezclarlos hace ambos peores.

## Componentes

| Componente                    | Capa                    | Responsabilidad                                                              | Archivo                                            |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `pullOrders()`                | `features/*/server/`    | **Sin cambios.** Consulta, mapeo v2, marcado a `PULLED`                      | `src/features/orders/server/pull.ts`               |
| Pruebas del cursor            | prueba (`node`)         | `nextCursor` lleno/a-medias/vacío, `since` respetado, `take` = `limit`       | `src/features/orders/server/pull.test.ts`          |
| Pruebas del handler de status | prueba (`node`)         | `200`/`404`/`400`, y que el `where` va por `id`                              | `src/app/api/internal/orders/status/route.test.ts` |
| `scripts/pull-orders.mjs`     | arnés (fuera de `src/`) | Ejerce los dos endpoints contra un servidor real y comprueba los 4 criterios | `scripts/pull-orders.mjs`                          |
| `.agent/specs/F-007/smoke.sh` | arnés                   | Levanta la app, siembra pedidos, corre el script, apaga                      | `.agent/specs/F-007/smoke.sh`                      |

Nada nuevo en `src/app/`, `src/lib/` ni `src/components/`. El único archivo de
`src/` que se toca es un archivo de prueba, más el comentario de `pull.ts`.

## Flujo de datos

Lo que el script recorre, que es el ciclo completo del pedido:

```mermaid
sequenceDiagram
    participant S as scripts/place-order.mjs
    participant Q as queandabuscando
    participant DB as Postgres
    participant P as scripts/pull-orders.mjs (hace de POS)

    S->>Q: POST /api/orders (checkout público, F-010)
    Q->>DB: INSERT Order status=PENDING
    P->>Q: GET /api/internal/orders?since=0&limit=1
    Q->>DB: SELECT WHERE id > 0 ORDER BY id ASC LIMIT 1
    DB-->>Q: [pedido]
    Q->>DB: UPDATE status=PULLED, pulledAt=now WHERE id IN (…)
    Q-->>P: { orders: [ {status:"PENDING"} ], nextCursor: "N" }
    Note over P: el payload dice PENDING (R8);<br/>la fila ya dice PULLED (R3)
    P->>Q: GET …?since=N&limit=1   (sigue el cursor)
    Q-->>P: { orders: [], nextCursor: null }   ← al día (E3)
    P->>Q: POST /api/internal/orders/status {orderId:N, status:"CONFIRMED"}
    Q->>DB: UPDATE status=CONFIRMED
    Q-->>P: 200 { ok: true }
    P->>Q: POST …/status {orderId: 999999999}
    Q-->>P: 404 UNKNOWN_ORDER   (E7)
```

El paso que solo se ve ejecutando es el par marcado con la nota: `status` en el
payload y `status` en la fila **difieren a propósito** en el primer pull, y
ninguna prueba con Prisma mockeado lo demuestra sobre datos reales.

## Contratos

Ninguno nuevo. `docs/sync-contract.md` § ③④ ya describe los dos endpoints en v2 y
**este feature no lo modifica** — lo cual es deliberado: cambiarlo obligaría a
coordinar con el equipo de cuadrecaja (`AGENTS.md` § Documentación).

Tabla de errores, ya implementada, que el script comprueba:

| Código | Cuerpo                   | Cuándo                             |
| ------ | ------------------------ | ---------------------------------- |
| `200`  | `{ orders, nextCursor }` | pull correcto                      |
| `200`  | `{ ok: true }`           | status aplicado                    |
| `400`  | `INVALID_QUERY`          | `since`/`limit` fuera de rango     |
| `400`  | `INVALID_JSON`           | body no parseable                  |
| `400`  | `INVALID_BODY`           | `status` fuera del enum            |
| `400`  | `INVALID_ORDER_ID`       | `orderId` no es `BigInt`           |
| `401`  | `UNAUTHORIZED`           | Bearer ausente o incorrecto        |
| `404`  | `UNKNOWN_ORDER`          | el `orderId` no existe             |
| `503`  | `SYNC_NOT_CONFIGURED`    | `SYNC_TOKEN` sin poner en servidor |
| `500`  | `PULL_FAILED`            | la consulta falló                  |

El contrato del script consigo mismo: **código de salida `0`** si los cuatro
criterios pasan, `1` si alguno falla, e imprime qué criterio y qué esperaba.
Eso es lo que lo hace utilizable desde `verify.sh --smoke` y desde el CI el día
que haya Postgres allí.

## Modelo de datos y migraciones

**Ninguna migración.** El modelo `Order` ya tiene todo lo que hace falta:
`status` con el enum de seis valores, `pulledAt`, y el índice `@@index([status, id])`
que sirve exactamente a la consulta del pull (`id > since ORDER BY id ASC`).

Ni `prisma migrate reset` ni `prisma db push` aparecen en ningún paso — son los
dos comandos prohibidos de `AGENTS.md`. El script siembra por HTTP, a través del
checkout público, no escribiendo en la base.

## Escalabilidad y límites

- **Coste por petición:** una `SELECT` con `LIMIT` sobre el índice
  `[status, id]`, más una `UPDATE ... WHERE id IN (...)`. Dos round-trips,
  ambos acotados por `limit` (máximo 500). No hay N+1: `include` trae store e
  items en la misma consulta.
- **Pooler en modo transacción:** `pullOrders()` **no** usa `$transaction`, así
  que no puede hacer deadlock contra la conexión del pool
  (`AGENTS.md` § «Cosas que muerden»). Ese es justamente el motivo por el que el
  claim atómico no es un cambio trivial y se deja fuera.
- **Qué se rompe primero al multiplicar por 100:** nada del pull. Con 100× los
  pedidos, el POS pagina más veces sobre el mismo índice. Lo que se rompe antes
  es el crecimiento sin límite de `Order` y `OrderItem` —nadie purga los pedidos
  ya entregados—, que la spec deja explícitamente sin decidir.
- **Sin coste de JavaScript de cliente.** No hay interfaz: ni un byte más en el
  bundle, así que `check:bundle` no se mueve.

## Patrones a seguir / antipatrones a evitar

**A seguir:**

- Prisma **solo** en `features/orders/server/` (`AGENTS.md` § Arquitectura). Las
  rutas llaman a `pullOrders()`; la de status usa `prisma` directamente, que es
  una desviación que ya existe y que este feature no arregla (ver § Riesgos).
- `*.test.ts` → proyecto `node`, nunca jsdom: `jose` y las librerías de bytes
  fallan el `instanceof` bajo el `Uint8Array` de jsdom (`AGENTS.md`).
- Mockear con `vi.mock("@/lib/prisma")` e importar el módulo con `await import()`
  **después** del mock, como ya hace `pull.test.ts`.
- Los scripts `.mjs` de arnés van en `scripts/`, en inglés, con `--modo` por
  escenario, como `send-catalog-batch.mjs`.

**A evitar:**

- `any` — es error de ESLint (`AGENTS.md` § Prohibiciones).
- Strings y números mágicos: los límites viven en `src/constants/orders.ts`.
- Que Tailwind escanee `scripts/` y genere utilidades fantasma: es la trampa que
  encontró F-016 y por eso `globals.css` tiene `@source not`. Un script nuevo en
  `scripts/` no la reabre, pero conviene no meter clases en él.
- Loguear el `code` completo de un pedido: es la única credencial de una página
  con datos personales (spec § Datos y contrato). El script imprime `id`, no
  `code` entero.

## Riesgos y plan B

| Riesgo                                                                                                                               | Cómo se notaría                           | Plan B                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| La verificación descubre un fallo real en `pullOrders()`                                                                             | El script sale `1` en `--paginate`        | Vuelve el plan al humano: arreglar código estaba fuera del alcance firmado (spec § Fuera)  |
| El pooler o el servidor local no arrancan y no se puede ejecutar nada                                                                | `smoke.sh` no llega a responder           | Es bloqueante: no se declara verificado. Se anota y se para, como pide la regla del sensor |
| **Riesgo conocido y aceptado:** dos pollers concurrentes duplican pedidos (`R6`)                                                     | Un pedido aparecería dos veces en el POS  | Documentado en spec `R6`. Se arregla con `UPDATE … RETURNING` si cuadrecaja añade pollers  |
| La ruta de status usa `prisma` directamente en `app/`, saltándose `features/*/server/`                                               | Ninguna comprobación lo detecta hoy       | Se anota como deuda. Moverlo es refactor, y el alcance firmado no incluye tocar producción |
| El test flaky de `CheckoutForm` (fallo de este ciclo, `findByRole` a 1 s) vuelve a caer en el CI y se confunde con un fallo de F-007 | `test:Error: Unable to find role="alert"` | Ficha en el playbook, que es lo que el sensor pide antes de cerrar                         |

## ¿Hace falta una ADR?

**No.** La decisión estructural que gobierna este feature ya está escrita: la
ADR 0002 («Todas las llamadas las inicia el POS; los pedidos se leen por pull»).
Este ciclo no decide nada nuevo, la verifica.

Las dos cosas que podrían haber merecido una —el claim atómico y las guardas de
transición— quedan **fuera** por decisión del humano, así que no hay decisión
que registrar. Si algún día entra el claim atómico, esa sí es una ADR.

## Preguntas al humano

Ninguna abierta. Las tres del ciclo (`SP1`–`SP3` en `spec.md`) están resueltas y
son las que fijan este alcance: verificar y cerrar huecos de prueba, un poller
secuencial, y el POS como autoridad del estado.
