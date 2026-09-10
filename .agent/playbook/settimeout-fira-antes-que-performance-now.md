---
slug: settimeout-fira-antes-que-performance-now
sintoma: "un test de tiempo falla por un milisegundo: el reloj dice 599 donde el aserto exige 600, y a la siguiente corrida pasa"
firma: expected 599 to be greater than or equal to 600
etapa: test
visto_en: F-045, F-044
creado: 2026-09-10T05:35:00Z
actualizado: 2026-09-10T05:35:00Z
promovido_a_agents: no
arreglo: no es tuyo ni del feature que estés cerrando — vuelve a correr la suite; el aserto de `orderIdentity.test.ts` compara un `setTimeout` con `performance.now()`, que son dos relojes distintos y pueden discrepar un milisegundo bajo carga
---

## Qué pasa de verdad

`src/features/account/server/orderIdentity.test.ts` › «`timeout`: the lookup
never resolves, so the ceiling wins the race» (F-030) falla con:

```
AssertionError: expected 599 to be greater than or equal to 600
```

y pasa en la corrida siguiente sin tocar nada. Visto dos veces el mismo día al
cerrar **F-045**, un feature que no toca ni `account`, ni pedidos, ni nada que
ese test ejercite.

**No es un misterio de carrera: son dos relojes.** El aserto
(`orderIdentity.test.ts:153`) exige que el `elapsedMs` que emite el observador
sea `>= 600`, o sea `>=` el techo `ORDER_CUSTOMER_LINK_TIMEOUT_MS`. Pero los dos
números salen de fuentes distintas:

- el techo lo cuenta un `setTimeout(…, 600)`
  (`src/features/account/server/orderIdentity.ts:51`), que dispara cuando el
  reloj **cacheado del bucle de libuv** (`uv_now`) llega a 600;
- el transcurrido lo mide
  `Math.round(performance.now() - t0)`
  (`src/features/account/server/orderLinkObserver.ts:84`), otro reloj, con otro
  origen.

Los dos pueden discrepar en menos de un milisegundo, y bajo carga discrepan más
a menudo. El `Math.round` remata: `599.4` se convierte en `599` y tumba el
aserto, aunque el temporizador hiciera exactamente su trabajo. Que `t0` se tome
**antes** de programar el temporizador (`:35` frente a `:51`) hace el fallo
raro, no imposible.

## Cómo se reconoce en un segundo

Es este flake, y no una regresión tuya, si se cumplen las tres:

1. El número de la izquierda es **exactamente uno menos** que el de la derecha
   (`599` / `600`). Una diferencia mayor es otra cosa: ahí sí mira qué rompiste.
2. El archivo es `orderIdentity.test.ts` y el `it` es el del `timeout`.
3. Vuelve a pasar al reejecutar.

## Cómo se arregla

1. **Vuelve a correr la suite antes de tocar nada.** Si pasa, no es tuyo: sigue.
   Si estás cerrando un feature ajeno a `account`, descártalo con
   `bash .agent/verify.sh dismiss <F-NNN> '<firma>' 'flake de reloj ajeno, ficha
settimeout-fira-antes-que-performance-now'` y sigue.
2. **El arreglo de verdad es del test, y no es subir el techo** —AGENTS.md
   § «Cosas que muerden» ya avisa de que eso no arregla esta clase de fallo, y
   aquí además cambiaría lo que el test afirma—. Las dos salidas honestas:
   - comparar contra el mismo reloj que cuenta el temporizador, o
   - aflojar el aserto en el milisegundo del redondeo (`>= 599`, o
     `>= ceilingMs - 1`) **con el motivo escrito al lado**: lo que el test
     quiere afirmar es «ganó el techo, no la búsqueda», y eso ya lo afirman el
     `outcome: "timeout"` y el `id` nulo de las dos líneas anteriores. El
     milisegundo exacto no es parte del requisito.
3. Cuando alguien lo arregle, **reescribe esta ficha** o bórrala.

## Parientes

`db-test-cross-process-clock-skew` y `realtime-bell-close-clock-skew` son la
misma familia —dos relojes que se dan por iguales— y conviene leerlas juntas si
aparece un tercer caso: tres fichas de reloj serían señal de que esto sube a
`AGENTS.md` § «Cosas que muerden» en vez de repetirse.
