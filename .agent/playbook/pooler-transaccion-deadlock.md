---
slug: pooler-transaccion-deadlock
sintoma: "una consulta se queda colgada o expira esperando conexión del pool"
firma: Timed out fetching a new connection|connection pool|too many connections
etapa: test
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: sí
arreglo: dentro de `$transaction` usa SOLO el cliente de la transacción, y batchea en un round-trip
---

## Qué pasa de verdad

El pooler de Supabase corre en **modo transacción**. Si dentro de un
`$transaction` se usa el cliente global, esa consulta pide una conexión nueva
al pool mientras la transacción retiene la suya: se bloquean entre ellas. No es
un problema de rendimiento ni de datos; es un abrazo mortal contra el pool.

## Cómo se arregla

Todo lo de dentro pasa por el cliente que recibe el callback (`tx`). Si hacen
falta varias escrituras, agrúpalas en un solo round-trip en vez de encadenar
llamadas.

## Cuándo NO es esto

Un `Timed out` en el CI también sale si el servicio de Postgres del workflow
todavía no está sano. Si el mismo test pasa en local contra la misma consulta,
mira el health check antes de reescribir la transacción.

## Cómo se evita

Es la misma restricción que arrastra cuadrecaja. Ante cualquier
`$transaction` nueva, la pregunta es «¿algo de aquí dentro usa el cliente de
fuera?» antes de ejecutarla.
