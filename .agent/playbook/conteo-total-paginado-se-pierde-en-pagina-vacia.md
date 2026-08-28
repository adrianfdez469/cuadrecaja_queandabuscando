---
slug: conteo-total-paginado-se-pierde-en-pagina-vacia
sintoma: "una consulta paginada con count(*) OVER () reporta totalCount = 0 cuando se pide una página más allá de la última — indistinguible de 'cero resultados', aunque existan filas reales"
firma: totalCount.*toBe\(0\)|página fuera de rango
etapa: test
visto_en: F-021
creado: 2026-08-28T14:25:00Z
promovido_a_agents: no
arreglo: separa el total (una CTE sobre el conjunto ANTES del LIMIT/OFFSET) de la página (el propio LIMIT/OFFSET), y une la página al total con un LEFT JOIN — nunca `count(*) OVER ()` sobre las filas ya paginadas
---

## Qué pasa de verdad

`count(*) OVER ()` es una función de ventana: se calcula **sobre las filas
que la consulta efectivamente devuelve**, después de aplicar `LIMIT`/
`OFFSET`. Si la página pedida cae más allá de la última fila real (offset
demasiado grande), el `LIMIT`/`OFFSET` no devuelve ninguna fila — y sin
filas no hay dónde adjuntar el valor de la ventana. El resultado es un
`result set` vacío del que el código de aplicación no puede distinguir "no
hay ninguna coincidencia" (el caso real de cero resultados) de "hay
coincidencias, pero esta página en concreto no tiene ninguna" (el caso de
paginar más allá del final). Los dos colapsan al mismo `totalCount = 0`.

Reproducido en `src/features/catalog/server/search.ts`: buscar un término
con exactamente 1 resultado y pedir la página 2 devolvía `{ items: [],
totalCount: 0 }`, indistinguible en el tipo de la respuesta de una búsqueda
sin ningún resultado — rompiendo la pantalla de "esta página no tiene
resultados" (design.md), que necesita saber que SÍ hay resultados en
alguna otra página.

## Cómo se arregla

Reestructura la consulta en dos CTE separadas: una que cuenta sobre el
conjunto completo de coincidencias ANTES de paginar (`totals AS (SELECT
count(*) FROM hits)`, que siempre da exactamente una fila, incluso con
`hits` vacío — el valor sería 0, correcto), y otra que aplica el
`LIMIT`/`OFFSET` (`page AS (... LIMIT $n OFFSET $m)`). La consulta final
hace `SELECT page.*, totals."totalCount" FROM totals LEFT JOIN page ON
TRUE`: como `totals` siempre tiene su una fila, el `LEFT JOIN` la conserva
aunque `page` no aporte ninguna, con todas las columnas de `page` en NULL.
El código de aplicación distingue las dos formas comprobando si la columna
identificadora de `page` (por ejemplo `page."id"`) es NULL: si lo es, es la
fila-placeholder de "sin filas en esta página", y se descarta de la lista
de items sin perder el total que trajo consigo.

## Cuándo NO es esto

Si la página pedida SIEMPRE incluye al menos una fila cuando `totalCount >
0` (por ejemplo, si el llamador ya acota `page` al rango real antes de
consultar), `count(*) OVER ()` funciona bien y no hace falta esta
reestructuración — el problema es específicamente pedir una página que el
propio total ya no alcanza a cubrir.

## Cómo se evita

Cualquier lectura paginada con SQL crudo que use `count(*) OVER ()` para
el total tiene que probarse explícitamente con una página más allá del
final (no solo con la página 1 y una página 2 dentro de rango): es
exactamente el caso que expone el defecto, y las pruebas de página 1/2
"normales" nunca lo tocan.
