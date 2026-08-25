# 0001 — Sincronización por HTTP con outbox, no base compartida ni cola

**Aceptada** · 2026-08-25

## Contexto

queandabuscando necesita el catálogo, los precios y la disponibilidad que viven
en cuadrecaja. Tres opciones: compartir la base de datos, poner una cola de
mensajería entre ambos, o que cuadrecaja empuje eventos por HTTP.

## Decisión

Base de datos propia. cuadrecaja escribe eventos en una tabla `OutboxEvento`
dentro de la transacción que ya existe al mutar un producto, y un cron cada 2
minutos los envía por HTTP en lotes.

## Por qué

**Base compartida** da consistencia perfecta pero acopla dos repos con
migraciones independientes, y —lo decisivo— pondría la credencial de la base con
las ventas dentro del runtime público. Un SSRF o una dependencia npm
comprometida en la tienda alcanzaría los datos transaccionales.

**Una cola** (pgmq / Supabase Queues) vive dentro de una sola base de datos, así
que no resuelve el transporte entre las dos. Vía su API HTTP sí cruzaría, pero
se pierde el acuse sincrónico: el POS recibiría «encolado», no «aplicado», y
haría falta un segundo canal para enterarse de un fallo de transformación. El
buffering además sería redundante, porque la outbox ya amortigua.

**Outbox + HTTP** conserva la propiedad que importa: el evento y el cambio son
atómicos, así que no existe una forma de divergir. Y la respuesta por evento le
dice al POS exactamente qué aplicar y qué reintentar.

## Cuándo reabrir

Si aparece un **segundo consumidor independiente** del mismo stream —analítica,
un reindexador, webhooks hacia los negocios—. El fan-out a varios consumidores
es donde una cola justifica su costo. Con uno solo, no.

Dentro de esta base, para la cola de embeddings del marketplace, pgmq **sí**
encaja: es _bursty_, llama a una API con rate limits y se beneficia de varios
workers concurrentes.
