# 0007 — El sync manda el precio; el override del panel gana

**Aceptada** · 2026-08-25

## Contexto

El precio viene de cuadrecaja, pero un negocio puede querer un precio online
distinto al del mostrador.

## Decisión

`syncedPrice` lo posee el sync. `priceOverride` lo posee el panel. Mientras
exista un override, el sync **nunca** lo pisa. El precio efectivo es
`priceOverride ?? syncedPrice`, encapsulado en `lib/pricing.ts`.

## Por qué encapsularlo

Para que ninguna vista reimplemente la precedencia y la entienda mal. Un
`?? syncedPrice` escrito a mano en dos sitios diverge tarde o temprano.

Un override de **cero** es un precio real (una promoción), no un valor ausente.
Solo `null`, `undefined` y la cadena vacía cuentan como «sin override».

## Alcance

La misma regla vale para `description`, `imageUrls`, `visible` y `featured`: el
handler de `PRODUCT` los excluye explícitamente del `UPDATE`. Es una invariante
que conviene mantener testeada, porque romperla borra el trabajo del negocio en
la siguiente sincronización.
