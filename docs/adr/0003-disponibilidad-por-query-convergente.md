# 0003 — Disponibilidad por query convergente, no por cursor temporal

**Aceptada** · 2026-08-25

## Contexto

Hay que propagar cambios de stock sin tocar el camino de venta, que en
cuadrecaja ya hace 18–19 queries y ya tuvo timeouts.

## Decisión

Dos cosas. Primero, lo que viaja es un enum de tres valores
(`OUT_OF_STOCK` / `LOW_STOCK` / `AVAILABLE`), nunca el entero. Segundo, el POS
encuentra el trabajo pendiente con una consulta de divergencia contra una
columna `dispPublicada`, apoyada en un índice parcial.

## Por qué no un cursor `updatedAt > ultimaSincronizacion`

**Pierde datos.** Una transacción fija `updatedAt = T1` y se confirma en
`T2 > T1`. Si el cron corre entre T1 y T2 no ve la fila; después el cursor
avanza más allá de T1 y esa fila no se sincroniza **nunca**. Es silencioso y
aparece semanas más tarde como «figura disponible y está agotado».

La consulta convergente no tiene esa ventana: si una fila divergió, sigue
divergente hasta que se confirma. El sistema converge por construcción, se
auto-repara tras cualquier caída, y es O(cambios) en vez de O(catálogo).

## Por qué el enum y no el número

Los negocios no exponen su inventario a la competencia; vender 3 unidades de 40
no genera ninguna escritura porque el enum no cambió; y el volumen cae uno o dos
órdenes de magnitud.

## Consecuencia

El umbral de «pocas unidades» se configura **en el POS**, no en el panel de
queandabuscando, porque calcular el enum requiere el stock, que nunca viaja.
