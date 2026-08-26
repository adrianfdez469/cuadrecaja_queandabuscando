# 0014 — Un timbre sin datos por Realtime, no un push del pedido

**Aceptada** · 2026-08-25

## Contexto

[ADR 0002](0002-el-pos-inicia-todas-las-llamadas.md) fija que el POS lee los
pedidos por pull y que queandabuscando nunca llama a cuadrecaja. La consecuencia
que ese ADR aceptó —«el pedido aparece en el siguiente ciclo de pull»— es peor de
lo que parecía: el encargado necesita enterarse **al instante**, porque el flujo
depende de que confirme disponibilidad mientras el cliente todavía está atento.

## Decisión

El evento de tiempo real lleva **cero datos**.

queandabuscando emite en un canal `negocio:{id}` de Supabase Realtime un mensaje
que solo dice «hay pedidos pendientes». El navegador del encargado, que ya tiene
cuadrecaja abierto, lo recibe y dispara el pull inmediato. El pedido sigue
viajando por `GET /api/internal/orders`.

Tres detalles que son parte de la decisión, no del cómo:

- **Broadcast, no Postgres Changes.** Postgres Changes evalúa cada cambio contra
  las políticas RLS de cada suscriptor; es la parte de Realtime que se degrada al
  crecer. Un timbre no necesita tocar la base.
- **Canal autorizado** con RLS sobre `realtime.messages`, para que el negocio A
  no escuche el timbre del negocio B.
- **El cron de pull no se quita.** El timbre lo adelanta, no lo sustituye.

## Por qué no un push del pedido

Porque devolvería a queandabuscando la URL del POS y un secreto de salida, que es
exactamente lo que [ADR 0002](0002-el-pos-inicia-todas-las-llamadas.md) eliminó.
El timbre no es una credencial hacia la base transaccional, es de entrada, y no
transporta PII: si se filtra el canal, lo que se aprende es que hubo un pedido.

## Por qué escala

Los mensajes no son la restricción: un timbre por pedido contra 100 mensajes/s
del plan gratuito exigiría 100 pedidos por segundo para saturar. La restricción
son las **conexiones concurrentes** —una por pestaña de cuadrecaja suscrita: 200
en Free, 500 en Pro, 10.000 en Pro sin tope de gasto— y crece a ~$10 por cada
1.000 conexiones pico. Es una curva lineal y previsible, no una sorpresa.

## Lo que decide la elección

**Degrada con gracia.** Si Realtime se cae o se pasa de cuota, el cron sigue
corriendo y el pedido llega igual, solo que más tarde. Ningún componente en la
ruta crítica depende de que el timbre suene.
