---
propuesta: timbre-realtime
agente: sdd-spec
actualizado: 2026-08-26T02:01:01Z
estado: propuesta
---

> Origen: revisión de arquitectura del 2026-08-25.
> Decisión de fondo en [ADR 0014](../../../docs/adr/0014-timbre-de-realtime.md).

## Problema

[ADR 0002] fija que el POS lee los pedidos por pull. Su consecuencia declarada
—«el pedido aparece en el siguiente ciclo»— resulta más cara de lo que parecía:
el encargado tiene que confirmar disponibilidad mientras el comprador todavía
está atento. Un ciclo de dos minutos convierte una confirmación inmediata en una
conversación fría.

## Alcance

### Dentro

- Emisión de un **Broadcast** en el canal `negocio:{id}` al crear un pedido.
- Autorización del canal con RLS sobre `realtime.messages`.
- Coalescencia: varios pedidos seguidos no producen un timbre por cada uno.

### Fuera (explícito)

- **El pedido no viaja por el canal.** Cero datos, cero PII. Sigue por
  `GET /api/internal/orders`.
- **No se quita el cron de pull.** El timbre lo adelanta, no lo sustituye.
- El cliente que escucha (vive en cuadrecaja, no en este repo).
- Notificaciones al comprador. Eso es la propuesta `pedido-renegociacion`.

## Actores y precondiciones

Emite queandabuscando al crear un pedido; escucha el navegador del encargado con
cuadrecaja abierto. Precondición: proyecto Supabase con Realtime habilitado.

## Comportamiento esperado

- **E1** — Dado un pedido nuevo del negocio A, cuando se crea, entonces se emite
  un Broadcast en `negocio:{A}` cuyo payload no contiene datos del pedido.
- **E2** — Dado un suscriptor autenticado como negocio B, cuando A recibe un
  pedido, entonces B no recibe nada.
- **E3** — Dado que Realtime está caído, cuando se crea un pedido, entonces la
  creación **igual tiene éxito** y el pedido se entrega en el siguiente pull.
- **E4** — Dados N pedidos en una ventana corta, entonces no se emiten N timbres.

## Reglas de negocio

- **R1** — El payload no lleva identificadores de pedido, importes ni contacto.
- **R2** — Un fallo al emitir **nunca** falla la creación del pedido.
- **R3** — Broadcast, no Postgres Changes.
- **R4** — Un negocio solo puede suscribirse a su canal.

## Casos límite y errores

- Cuota de Realtime agotada.
- Encargado con varias pestañas abiertas (conexiones duplicadas).
- Reconexión tras perder la red: el pull de arranque cubre el hueco.
- Pedido creado mientras nadie escucha.

## Datos y contrato

Payload sugerido: `{ "t": "pedidos-pendientes" }`. Nada más. Se documenta en
`docs/sync-contract.md` como canal auxiliar, dejando explícito que **no** es una
vía de entrega de datos y que no forma parte de la ruta crítica.

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. Crear un pedido emite un Broadcast en `negocio:{id}`; el payload capturado no
   contiene `code`, `total` ni contacto.
2. Un suscriptor del negocio B no recibe el timbre de A.
3. Con Realtime inalcanzable (credencial inválida a propósito), crear un pedido
   sigue respondiendo con éxito y el pedido aparece en el pull.
4. Diez pedidos en un minuto producen menos de diez timbres.
5. `grep -rn "CUADRECAJA_API_URL" src/` sigue sin devolver nada — el timbre no es
   una llamada saliente hacia el POS (invariante de F-007).
6. `bash .agent/verify.sh <id> --full` termina en 0.

## Incongruencias detectadas

- Ninguna con el código actual: no existe todavía.
- Con ADR 0002 **no** hay incongruencia y conviene que quede escrito: el timbre no
  es una llamada de queandabuscando a cuadrecaja, y por eso no rompe la invariante
  de que el runtime público no tiene credencial de salida hacia el POS.

## Huecos y preguntas al humano

- **SP1** — ¿La ventana de coalescencia? Recomendación: 5 s. Suficiente para que
  una ráfaga sea un timbre, imperceptible para el encargado.
- **SP2** — ¿El timbre suena también en cambios que no son pedidos nuevos
  (aprobación del comprador tras una modificación)? Recomendación: sí, mismo canal
  y mismo payload — el encargado igual va a hacer pull.

## No decidido a propósito

Cómo suena en la interfaz de cuadrecaja. Es de aquel repo.
