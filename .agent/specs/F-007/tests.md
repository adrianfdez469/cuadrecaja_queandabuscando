---
feature: F-007
agente: sdd-tester
actualizado: 2026-08-26T13:00:00Z
estado: listo
veredicto: listo
---

## Estrategia

Dos niveles, porque prueban cosas distintas y ninguno vale por el otro:

| Nivel                                                       | Entorno               | Qué prueba                                                                | Corre en CI |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- | ----------- |
| `*.test.ts` con Prisma mockeado                             | proyecto `node`       | El cursor y los handlers: qué `where` sale, qué código de estado responde | sí          |
| `scripts/pull-orders.mjs` vía `.agent/specs/F-007/smoke.sh` | app y Postgres reales | Que un pedido de verdad viaja: se crea, se recoge, cambia de estado       | no¹         |

¹ Necesita Postgres y un servidor levantado, que es justo lo que el CI no tiene
(`AGENTS.md` § Comandos). Es la misma frontera que F-005 y F-006.

Todo lo nuevo es `*.test.ts` → proyecto **`node`**, nunca jsdom. Es la regla de
`AGENTS.md` § Cosas que muerden, y aquí importa de verdad: estas pruebas
construyen `Request` y leen `Response`, y jsdom instala su propio `Uint8Array`.

Por qué las dos capas y no solo una: con Prisma mockeado, `PENDING → PULLED` se
verifica contra un `vi.fn()`, no contra una fila — y el criterio 2 **es** una
transición en la base. Al revés, un script que solo corre a mano deja el cursor
sin red en el CI, que es el hueco con el que F-007 llevaba abierto desde que se
escribió.

## Mapa criterio → prueba

| Criterio de aceptación                                                                                    | Prueba                                                                                                                                                                                                             | Archivo                                                     | Resultado |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------- |
| **C1** `GET /api/internal/orders?since=&limit=` responde `{ orders, nextCursor }` y respeta el cursor     | `--paginate`: 17 aserciones — forma, `id > since`, string no número, página llena/a-medias/vacía, recorrido de 3 con `limit=1`, los cuatro 400 y el 401                                                            | `scripts/pull-orders.mjs`                                   | **PASA**  |
| **C1** (regresión en CI)                                                                                  | 5 pruebas del cursor + 8 del handler del pull                                                                                                                                                                      | `pull.test.ts`, `src/app/api/internal/orders/route.test.ts` | **PASA**  |
| **C2** Un pedido devuelto pasa de `PENDING` a `PULLED`                                                    | `--transition`: 11 aserciones — `PENDING` y `pulledAt` nulo antes; `PULLED` y `pulledAt` con hora después; el payload dice `PENDING` (R8); la página del pedido sigue en 200; segundo pull no reescribe `pulledAt` | `scripts/pull-orders.mjs`                                   | **PASA**  |
| **C2** (regresión en CI)                                                                                  | «marks PENDING rows as PULLED and leaves other statuses alone»                                                                                                                                                     | `pull.test.ts`                                              | **PASA**  |
| **C3** `POST /api/internal/orders/status` actualiza el estado y responde `404` para un pedido inexistente | `--status`: 14 aserciones — `CONFIRMED` y `CANCELLED` con motivo comprobados en la base, `404 UNKNOWN_ORDER`, los tres 400, dos 401                                                                                | `scripts/pull-orders.mjs`                                   | **PASA**  |
| **C3** (regresión en CI)                                                                                  | 10 pruebas del handler: 200, 404, `INVALID_JSON`, `INVALID_BODY`, `INVALID_ORDER_ID`, 401, 503                                                                                                                     | `src/app/api/internal/orders/status/route.test.ts`          | **PASA**  |
| **C4** No existe ninguna llamada saliente: `grep -rn CUADRECAJA_API_URL src/` no devuelve nada            | `--no-outbound`: ejecuta ese grep y exige salida ≠ 0 y stdout vacío                                                                                                                                                | `scripts/pull-orders.mjs`                                   | **PASA**  |

Los cuatro criterios tienen fila, y **los cuatro se verificaron ejecutando**.
Ninguno se dio por bueno leyendo el código.

## Ejecuciones

```
$ bash .agent/verify.sh F-007 --full          → 0
  ✓ harness 0s · ✓ typecheck 1s · ✓ lint 2s · ✓ format 1s · ✓ test 2s
  ✓ prisma 1s · ✓ build 7s · ✓ theme 0s · ✓ bundle 0s
  PASA

$ bash .agent/verify.sh F-007 --smoke         → 0
  ✓ typecheck · ✓ lint · ✓ format · ✓ test · ✓ smoke 3s
  PASA
  (log: .agent/runs/F-007/004-smoke.log)

$ node scripts/pull-orders.mjs                → 0
  == Criterio 1 · GET /api/internal/orders responde { orders, nextCursor } y respeta el cursor ==
    (sembrados los pedidos 67, 68, 69 sobre since=66)
    ok   responde 200
    ok   el cuerpo trae `orders` como array
    ok   el cuerpo trae la clave `nextCursor`
    ok   todos los pedidos devueltos tienen id > since
    ok   el id y el cursor viajan como string, no como número (BIGINT no cabe en un Number)
    ok   la página llena devuelve el id del último como nextCursor (R2)
    ok   paginando con limit=1 aparecen los tres pedidos, una vez cada uno y en orden
    ok   ningún pedido se devolvió dos veces en el recorrido
    ok   el recorrido terminó solo, sin agotar el tope
    ok   al día: `orders` vacío
    ok   al día: `nextCursor` es null
    ok   since no numérico responde 400
    ok   since negativo responde 400
    ok   limit=0 responde 400
    ok   limit>500 responde 400
    ok   sin since ni limit responde 200 (defaults 0 y 100)
    ok   sin token responde 401 (E8)
  == Criterio 2 · un pedido devuelto pasa de PENDING a PULLED ==
    ok   recién creado, el pedido está en PENDING
    ok   recién creado, pulledAt está vacío
    ok   el pull lo devuelve
    ok   el payload lo describe como PENDING: es el estado que tenía cuando el POS lo vio (R8)
    ok   la fila quedó en PULLED
    ok   pulledAt quedó con la hora
    ok   el pedido NO se borró: la fila sigue ahí (R4)
    ok   y su página pública sigue respondiendo 200 tras el pull (R4)
    ok   un segundo pull lo sigue devolviendo
    ok   sigue en PULLED tras el segundo pull
    ok   y pulledAt NO se reescribió: un estado que no es PENDING no se toca (R3, E5)
  == Criterio 3 · POST /api/internal/orders/status actualiza y responde 404 si no existe ==
    ok   CONFIRMED responde 200
    ok   el cuerpo es { ok: true }
    ok   la fila quedó en CONFIRMED
    ok   CANCELLED con motivo responde 200
    ok   la fila quedó en CANCELLED
    ok   y guardó el motivo
    ok   un pedido inexistente responde 404
    ok   con error UNKNOWN_ORDER
    ok   un status fuera del enum responde 400
    ok   PENDING y PULLED los pone esta base, no el POS: responden 400
    ok   un orderId no convertible a BigInt responde 400
    ok   un cuerpo que no es JSON responde 400 INVALID_JSON
    ok   sin token responde 401 (E8)
    ok   con un token equivocado responde 401
  == Criterio 4 · ninguna llamada saliente hacia cuadrecaja ==
    ok   grep -rn CUADRECAJA_API_URL src/ no devuelve nada

  0 aserciones fallidas

$ npx vitest run                              → 0
  Test Files  26 passed (26)
       Tests  229 passed (229)      # eran 206 al empezar: +23
```

**El verde del smoke se comprobó contra el log del servidor, no contra el propio
guion.** 3 s parecía poco para levantar la app y correr 44 aserciones, así que se
leyó `.agent/runs/F-007/004-smoke.log`: están las peticiones una por una en el
3100, `✓ Ready in 196ms` de Turbopack, los tres `POST /api/orders 201`, la
paginación `since=71→72→73→74`, el `since=-1 … 400` y los dos `401`. La app que
respondió era la que el sensor acababa de levantar en este directorio, no un
`next dev` de otro checkout — que es el modo de fallo de la ficha
`next-dev-uno-por-directorio` y el único verde peor que un rojo.

## Fallos encontrados

**1 · `since` negativo devolvía 500 en vez de 400 · severidad media · era real**

- **Reproducir:** `curl -i -H "authorization: Bearer $SYNC_TOKEN" "localhost:3000/api/internal/orders?since=-1&limit=10"` → `500`, cuerpo vacío.
- **Sospechoso, y confirmado:** `src/app/api/internal/orders/route.ts:25`, la rama del **400**. Zod rechazaba bien el negativo; el issue `too_small` de un schema `bigint` lleva `minimum: 0n`, y `NextResponse.json` hace `JSON.stringify`, que lanza sobre un BigInt. La rama del error era la que reventaba.
- **A qué agente volvía:** al humano primero, porque tocar producción estaba fuera del plan firmado. Con su «Arréglalo dentro de F-007» se re-firmó el plan con un paso 8 y lo tomó el implementador.
- **Por qué importaba:** `-1` es el centinela habitual de «todavía no tengo cursor», quien llama es otro equipo, y lo que recibía era un 500 sin cuerpo. Es el modo de fallo que `guard.ts` evita a propósito devolviendo un 503 distinto en vez de un 401 mudo.
- **Lección:** no da ficha de playbook — no es una trampa del repo, es un bug corriente. Queda como comentario en `src/app/api/internal/_lib/issues.ts`, donde lo lee quien vaya a añadir el siguiente schema, y fijado por 2 pruebas que fallan con el error exacto si se revierte.

**2 · `CheckoutForm.test.tsx` falla ~1 vez de cada 3 · severidad baja para F-007, alta para el CI · no era de F-007**

- **Reproducir:** `rm -rf node_modules/.vite && npx vitest run`, varias veces. Medido: verde, **rojo a 1013 ms**, verde. Solo, 2/2 en 86 ms.
- **Causa, medida y no supuesta:** el timeout de 1000 ms por defecto de `findBy*`/`waitFor`, agotado con la caché fría y la suite en paralelo. La señal es el reloj: ~1000-1100 ms, no 5 ms ni un cuelgue. En la vuelta roja cayó el **segundo** test, no el primero — cuál de los dos se lleva el fallo es azar, lo que descarta un defecto de uno concreto.
- **Descartado que fuera aislamiento entre archivos**, que era la hipótesis obvia: pasa solo y falla en grupo, pero el reloj lo explica sin necesidad de estado compartido.
- **A qué agente vuelve:** volvió a caer y pasó a bloquear el cierre de F-007 (2 de 7 ejecuciones de la etapa `test`; a la tercera seguida el sensor corta con `ESTANCADO`). El humano autorizó el arreglo global y entró como paso 9: `configure({ asyncUtilTimeout: 5000 })` en `vitest.setup.ts`. **Verificado repitiendo, que es como se verifica un flaky:** 5 vueltas de la suite completa borrando `node_modules/.vite` cada vez, 229/229 las cinco. Antes daba verde-rojo-verde.
- **Lección:** ficha `.agent/playbook/testing-library-timeout-1s-bajo-carga.md`, con la causa, el arreglo y —lo que más vale— cómo distinguirlo de un fallo real, porque subir el timeout de un rojo legítimo solo lo hace tardar 5 s en dar el mismo rojo.

**3 · `format` y `harness` · descuidos míos, arreglados en el bucle**

`format` lo reconoció la bitácora al instante (`prettier-sin-formatear` → `npm run format`). `harness` era una ruta mal escrita en `spec.md`, y el propio check nombraba el archivo y decía «arregla la prosa». **Descartado** con
`verify.sh dismiss`: el sensor ya enseña ahí lo que hay que saber.

`bash .agent/verify.sh pending F-007` → **vacío**.

## Huecos de cobertura

Lo que **no** se probó, y el riesgo de no haberlo probado:

1. **Dos pollers concurrentes** (`spec.md` R6). Es el hueco de verdad: `findMany`
   y `updateMany` van en dos round-trips sin nada atómico, así que dos pollers
   se llevarían el mismo pedido y el POS lo duplicaría. **No se probó a
   propósito** — el humano decidió que cuadrecaja corre un poller secuencial. El
   riesgo es que esa invariante vive en nuestra documentación y se cumple en el
   código de **otro equipo**: si algún día paralelizan su cron, nada aquí falla,
   nada avisa, y aparecen pedidos duplicados. Es lo primero que hay que
   verificar si eso cambia.
2. **Un lote grande de verdad.** Se paginó sobre 3 pedidos con `limit=1`, que
   ejerce el cursor pero no el volumen. Con `limit=500` y decenas de miles de
   filas el plan de la consulta es el mismo (índice `[status, id]`), así que el
   riesgo es bajo, pero medido no está.
3. **El `500 PULL_FAILED` con la base caída.** Está en la tabla de errores de
   `spec.md` y no se ejerció: haría falta tirar Postgres a mitad. Riesgo bajo —
   es un `try/catch` de cuatro líneas.
4. **`cancelReason` se borra en cada transición.** Cualquier `status` sin
   `reason` pone `cancelReason: null`, así que un `CANCELLED` con motivo seguido
   de un `DELIVERED` pierde el motivo. Se **observó** durante las pruebas y no se
   tocó: es consecuencia directa de `R7` (el POS es la autoridad) y ningún
   criterio habla de ello. Queda dicho aquí por si alguien lo esperaba distinto.
5. **Nada visual.** F-007 no tiene interfaz (`design.md`: `no aplica`). La única
   pantalla del camino, `/[slug]/pedido/[code]`, es de F-010; aquí solo se
   comprobó que sigue respondiendo 200 después del pull (R4).

## Veredicto

**LISTO.**

Los cuatro `acceptance_criteria` se verificaron **ejecutando**: 44 aserciones
contra un servidor y una base reales, sobre pedidos nacidos del checkout público,
más 23 pruebas nuevas que dejan el cursor y los dos handlers con red en el CI.
`verify.sh --full` y `--smoke` salen `0`, y `pending` está vacío.

Las dos regresiones que importan se comprobaron **rompiendo el código a
propósito** y viendo fallar exactamente la prueba que debía fallar. Sin eso, una
suite verde solo demuestra que nadie ha mirado.

Con esto se cierra lo que bloqueaba F-007 desde que se escribió: ya no es «los
endpoints existen y tipan», es un pedido que se crea, se recoge, se marca y se
reporta, comprobado paso a paso.

## Preguntas al humano

**TP1 — ¿El hueco de concurrencia queda como riesgo aceptado por escrito?** Hoy
la invariante «un solo poller» vive en `spec.md` R6 y en nada más. Al otro lado
hay otro equipo que no lee nuestro `spec.md`.
**Recomendación:** añadir una línea a `docs/sync-contract.md` § ③④ diciendo que
el pull no admite pollers concurrentes. Es aditivo y no cambia ningún campo,
pero **toca el contrato**, y `AGENTS.md` reserva eso para una decisión tuya
coordinada con cuadrecaja — por eso no se hizo aquí. Encaja bien con el aviso de
la v2 que ya les debes desde F-010.
