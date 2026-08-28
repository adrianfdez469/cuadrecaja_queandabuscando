---
slug: smoke-asume-since-0-devuelve-el-ultimo-pedido
sintoma: "SMOKE FAIL criterio 11 — WHATSAPP trae wa.me en la página del pedido — esperaba >= 1, obtuve 0"
firma: SMOKE FAIL criterio 11 — WHATSAPP trae wa.me en la página del pedido
etapa: smoke
visto_en: F-010 (F-018, sdd-tester, al correr la regresión)
creado: 2026-08-27T23:09:58Z
promovido_a_agents: no
arreglo: >-
  El smoke tiene que capturar el código del pedido que ÉL MISMO acaba de crear
  (scripts/place-order.mjs ya lo imprime), nunca inferirlo con
  GET /api/internal/orders?since=0&limit=1. Con `since=0` el pull devuelve
  el pedido de MENOR id de ese negocio — en una base compartida y reutilizada
  entre sesiones, ese es casi seguro un pedido viejo de OTRA tienda del mismo
  negocio (p.ej. tienda-dos), no el que el smoke acaba de crear en tienda-demo.
---

## Qué pasa de verdad

`.agent/specs/F-010/smoke.sh` (criterio 11 / V5) asume que
`GET /api/internal/orders?since=0&limit=1` devuelve el pedido que el propio
guion acaba de crear con `scripts/place-order.mjs`. Eso solo es cierto en una
base **recién sembrada, sin pedidos previos**: `since=0&limit=1` no pide "el
último", pide "el de menor id" (`ORDER BY id ASC`), y en Postgres compartido
entre worktrees y sesiones de prueba, el pedido de menor id de un negocio
lleva ahí desde la primera vez que alguien corrió un smoke o un script de
pedidos contra esa base — casi nunca es el que se acaba de crear.

Comprobado en vivo (2026-08-27): el pedido `id=1` (`67WS9EZZFN`) del negocio
sembrado pertenece a `seed-tienda-2` (`tienda-dos`, modo `ONSITE`, sin
WhatsApp), de una sesión de pruebas de horas antes. El smoke pide
`/tienda-demo/pedido/67WS9EZZFN` —con el slug de OTRA tienda— y la página
devuelve 404: por eso `wa.me` aparece 0 veces y el conteo de chunks de
cliente no coincide (compara el store real contra una página de error).

**No es un fallo de F-018.** F-018 solo acotó el pull por `businessId`; antes
de F-018 el mismo `since=0&limit=1` ya devolvía el pedido de menor id **de
toda la base** (un único negocio), con el mismo problema de fondo. Lo que
cambió es que ahora hay una base con miles de pedidos acumulados de sesiones
de prueba repetidas, y el supuesto "la base está vacía cuando corro el smoke"
dejó de sostenerse.

## Cómo se arregla

`scripts/place-order.mjs` ya imprime o puede devolver el `code` del pedido que
crea (comprobar su salida / valor de retorno). El smoke debe capturar ESE
valor directamente en vez de re-consultarlo por `/api/internal/orders`. Si
hace falta pasar por el pull (para ejercitar esa ruta a propósito), hay que
filtrar por el `code` conocido, no confiar en `since=0&limit=1` para
identificarlo.

## Cuándo NO es esto

Si el pedido en `since=0&limit=1` SÍ es el recién creado (base vacía antes del
smoke, p.ej. justo tras `prisma migrate reset` en un entorno que no comparte
Postgres con nadie más), el criterio pasa por casualidad y esta ficha no
aplica todavía — pero el guion sigue frágil para la próxima vez que la base
crezca.

## Cómo se evita

Ningún smoke debe inferir "el pedido que acabo de crear" a partir de una
consulta que no lo identifica de forma única (ni por _id_ mínimo ni máximo)
en una base compartida que solo crece. Identificar siempre por el valor que
el propio paso de creación devolvió.
