# 0015 — Sin broker de mensajería todavía: LavinMQ y RabbitMQ evaluados

**Aceptada** · 2026-08-25

## Contexto

[ADR 0001](0001-sync-por-http-con-outbox.md) descartó «una cola», pero el
argumento que dio era sobre **pgmq**: vive dentro de una sola base de datos y por
eso no resuelve el transporte entre dos. Un broker **alojado** sí cruza, así que
esa pregunta quedó sin responder de verdad. Se evaluó LavinMQ y RabbitMQ en
CloudAMQP.

## Los números, para no volver a buscarlos

|                    | LavinMQ _Loyal Lemming_ | RabbitMQ _Little Lemur_ |
| ------------------ | ----------------------- | ----------------------- |
| Mensajes/mes       | **2 M**                 | 1 M                     |
| Conexiones         | **40**                  | 20                      |
| Colas              | **200**                 | 100                     |
| Mensajes encolados | **20.000**              | 10.000                  |
| Colas ociosas      | —                       | se borran a los 28 días |

Los dos proyectos son serverless y **no pueden sostener un consumidor AMQP de
larga vida**: es el desajuste clásico entre FaaS y brokers. LavinMQ lo esquiva
con **shovel a HTTP** —hace `POST` a un endpoint cuando llega un mensaje, sin
consumidor—; el shovel de RabbitMQ va a AMQP, no a una URL arbitraria.

→ Si algún día hace falta un broker, es **LavinMQ**. RabbitMQ no es el plan B:
es peor en todos los ejes que importan aquí. Y si la cuota no alcanzara, el paso
es LavinMQ de pago (~$19/mes, 20 M mensajes), no cambiar de broker.

## Decisión

No se adopta ahora. Se mantiene outbox → cron → HTTP por lotes → inbox.

## Por qué

1. **No elimina ningún componente; añade uno.** La outbox se queda —la atomicidad
   entre el evento y el cambio viene de la transacción, no del transporte— y el
   inbox también, porque un shovel puede reentregar. Quedaría
   `outbox → cron → broker → shovel → HTTP → inbox`. Se suman proveedor,
   credencial, DLQ, panel y cuota; no se resta nada.
2. **Se pierde el acuse por evento, que ya está construido.** El endpoint de
   catálogo responde `207` con `processed` / `duplicate` / `stale` /
   `skipped_not_published` **por evento**. Con un shovel, la outbox solo sabría
   «publicado al broker»: si queandabuscando descarta un evento por una razón de
   negocio, el POS no se entera nunca. Habría que inventar un canal de vuelta
   para recuperar algo que hoy sale gratis.
3. **Convierte la economía de lotes en economía de mensajes.** Una actualización
   masiva de 5.000 productos viaja hoy en pocas peticiones HTTP. Con un broker
   son 5.000 mensajes, porque agrupar derrota su propósito. Los 2 M/mes se
   consumen de 5.000 en 5.000, y justo el caso que hoy sale gratis es el que allí
   cuesta.

Menor pero real: el plan compartido es multi-inquilino y su propio proveedor lo
describe como apto para desarrollo y pruebas. Poner el transporte entre la fuente
de verdad y la tienda sobre una instancia compartida gratuita es aceptar un punto
único de fallo que no es ninguno de los dos sistemas.

## Lo que este ADR **no** sostiene

Que un broker rompa la seguridad de
[ADR 0002](0002-el-pos-inicia-todas-las-llamadas.md). Con un shovel,
queandabuscando tendría credenciales de broker y no del POS; y un queandabuscando
comprometido ya puede fabricar pedidos en su propia tabla que el POS luego lee.
El riesgo incremental en la ruta de pedidos es pequeño. Lo que sí cambia es
**quién marca el ritmo**: con pull lo decide el POS; con push por shovel lo
decide el otro lado, y contra un camino de venta que ya tuvo timeouts
([ADR 0003](0003-disponibilidad-por-query-convergente.md)) eso es amplificación
hacia el mostrador.

## Cuándo reabrir

- Aparece un **segundo consumidor independiente** del mismo stream —analítica,
  reindexador, webhooks hacia los negocios—. El fan-out es donde un broker se
  paga solo; es el mismo disparador que ya nombraba ADR 0001.
- **cuadrecaja deja de ser un SaaS único** y pasa a instalarse por negocio. Ahí
  un broker como punto de encuentro gana a que cada instalación exponga un
  endpoint o sea sondeada.
