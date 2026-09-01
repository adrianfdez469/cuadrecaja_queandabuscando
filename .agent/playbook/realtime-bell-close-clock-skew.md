---
slug: realtime-bell-close-clock-skew
sintoma: un timbre de cierre programado (F-020 first_defer) nunca suena; la fila de OrderBellWindow se queda con pendingSince fijo para siempre
firma: SMOKE FAIL.*(recibidos entre 1 y 2|segundo mensaje llega antes)
etapa: smoke
visto_en: —
creado: 2026-09-01T06:03:00Z
promovido_a_agents: no
arreglo: al programar el sleep que espera hasta el cierre, súmale un margen de seguridad (REALTIME_BELL_CLOSE_MARGIN_MS) al delay calculado con el reloj de Node, para que el wakeup caiga después de que now() de Postgres esté de acuerdo en que la ventana venció
---

## Qué pasa de verdad

`ringOrderBell()` calcula cuánto dormir con el reloj de Node
(`claim.closesAt.getTime() - Date.now()`), pero `closeBellWindow()` decide si
cierra de verdad con el reloj de POSTGRES: su condición SQL compara
`"windowStartedAt"` contra `now() menos el ancho de la ventana`, evaluado
del lado de la base. Los dos relojes no están perfectamente sincronizados —
unos pocos milisegundos de deriva, o la imprecisión normal de un
`setTimeout`, bastan para que el despertar caiga un pelo ANTES de que
Postgres esté de acuerdo en que la ventana venció. Esa sola sentencia
devuelve 0 filas y **nadie más lo reintenta**: a diferencia de «la instancia
murió» (el hueco que architecture.md ya acepta), aquí la instancia sigue
viva, solo que `closeBellWindow` le dijo que no. La fila queda con
`pendingSince` puesto para siempre, porque ningún evento posterior vuelve a
ver esa ventana como `first_defer` (ya está «viva»).

## Cómo se arregla

Añade un margen al delay del `sleep`, no a la condición SQL: el SQL sigue
decidiendo con el reloj de Postgres (es la fuente de verdad — I5), pero el
despertar del proceso llega con un colchón de por ejemplo 250 ms para
absorber la deriva. `src/constants/realtime.ts` ·
`REALTIME_BELL_CLOSE_MARGIN_MS`, sumado en
`src/features/orders/server/bell.ts` · `ringOrderBell()`.

## Cuándo NO es esto

Si `closeBellWindow` devuelve `false` una PRIMERA vez y luego `true` una
segunda (dos llamadas explícitas, como hace `bell.db.test.ts`), eso es
comportamiento correcto — la ventana todavía no había vencido. Esto solo
aplica al camino real de `ringOrderBell`, donde un `false` inesperado en el
ÚNICO intento programado dejaba la fila atascada sin que nada lo notara.

## Cómo se evita

Cualquier código que programe un `setTimeout`/`sleep` en el proceso para
disparar una condición que un SERVIDOR DE BASE DE DATOS distinto evaluará con
su propio reloj necesita ese margen — nunca asumas que dos relojes de dos
procesos están sincronizados al milisegundo. `bell.db.test.ts` no lo pesca
porque llama a `closeBellWindow` directamente con SQL que ya puso el reloj
bien atrás (6 s); solo un guion de runtime que deja que `ringOrderBell`
programe su propio despertar, como `scripts/realtime-bell.mjs`, lo encuentra.
