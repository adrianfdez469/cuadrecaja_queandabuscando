# 0002 — Todas las llamadas las inicia el POS; los pedidos se leen por pull

**Aceptada** · 2026-08-25

## Contexto

Un pedido creado en la tienda tiene que llegar a cuadrecaja. Lo natural es que
queandabuscando haga POST a un endpoint del POS, con reintentos y un cron para
los fallos.

## Decisión

Al revés: el POS hace `GET /api/internal/orders?since=<id>`. queandabuscando
nunca llama a cuadrecaja.

## Por qué

Con push, el runtime público necesita la URL del POS y un secreto para hablarle.
Con pull, no necesita **nada**: no hay `CUADRECAJA_API_URL` ni credencial de
salida en las variables de entorno de la tienda. El tráfico público nunca escribe
en la base transaccional, ni directa ni indirectamente.

Como efecto secundario desaparecen un cron, un secreto, una tabla de estado de
despacho y toda la lógica de reintento con backoff.

Y el modo de falla mejora: si el POS está caído, el pedido simplemente espera en
la base de la tienda. El cliente no ve ningún error, porque desde su punto de
vista el pedido se hizo.

## Consecuencia

El pedido no aparece en el POS de inmediato, sino en el siguiente ciclo de pull.
Para un flujo donde el negocio confirma manualmente, es irrelevante.
