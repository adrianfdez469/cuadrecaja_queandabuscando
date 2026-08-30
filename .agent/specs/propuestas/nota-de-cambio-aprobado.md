---
propuesta: nota-de-cambio-aprobado
agente: orquestador
actualizado: 2026-08-30T18:30:00Z
estado: propuesta
---

> Origen: IP2 de F-019. El humano decidió ficharla en vez de construirla, para
> no meter en el cierre alcance que ningún criterio verificaba.

## Problema

Cuando un comprador aprueba una modificación, su página pasa a mostrar los
importes nuevos y deja de mencionar el cambio. Pero él tiene en su WhatsApp el
comprobante del pedido original, con los importes viejos: la diferencia entre
los dos documentos no tiene explicación en ninguna parte, y se lee como un cobro
de más.

El caso es frecuente por diseño, no excepcional: el disparador dominante de una
modificación es el costo de envío, que se fija al gestionar el pedido y ocurre en
todos los pedidos de esa modalidad.

## Alcance

### Dentro

- Una nota discreta bajo la tabla de líneas, en los pedidos que tuvieron una
  propuesta aprobada, diciendo que el pedido incluye un cambio que el comprador
  aceptó.
- La diferencia entre lo anterior y lo aprobado, plegada, para quien quiera
  verla.

### Fuera (explícito)

- Cambios en el modelo de datos. **No hacen falta**: la propuesta aprobada
  sobrevive en la fila `Order` por la decisión PP3 de F-019, y
  `OrderSnapshot.proposal` ya la expone.
- Historial de propuestas descartadas, que PP3 dejó fuera a propósito.
- Cualquier aviso al comprador fuera de su página.

## Actores y precondiciones

El comprador, entrando a `/[slug]/pedido/[code]` después de haber aprobado.
Precondición: el pedido tuvo una propuesta y su `proposalOutcome` es `APPROVED`.

## Comportamiento esperado

- **E1** — Dado un pedido con una propuesta aprobada, cuando el comprador abre
  su página, entonces ve que el pedido incluye un cambio que él aceptó.
- **E2** — Dado ese mismo pedido, cuando despliega la nota, entonces ve el total
  anterior y el vigente.
- **E3** — Dado un pedido que nunca tuvo propuesta, entonces no ve ninguna nota.

## Datos y contrato

Ninguno nuevo. Es UI sobre datos que F-019 ya persiste y ya expone.

## Criterios de aceptación propuestos

Los escribe el humano si decide que esto entra al backlog. Como punto de partida:

1. Un pedido con `proposalOutcome = APPROVED` muestra la nota en
   `GET /[slug]/pedido/[code]`; uno sin propuesta, no.
2. La nota desplegada muestra el total anterior y el vigente, distintos.

## Huecos y preguntas al humano

- ¿La nota caduca? Un pedido entregado hace tres meses probablemente ya no
  necesita explicar el cambio.
- El diseño de la nota está escrito en `.agent/specs/F-019/design.md`
  (estado 12): si esto entra, se parte de ahí y no de cero.
