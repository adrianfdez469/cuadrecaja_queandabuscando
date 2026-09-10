---
slug: search-db-paginacion-intermitente-en-suite-completa
sintoma: "el test de paginación estable del buscador de marketplace falla en la suite completa y pasa al correrlo solo; el aserto compara dos listas de cuatro ids"
firma: pagination is stable and total order holds across repeated calls
etapa: test
visto_en: F-042
creado: 2026-09-09T23:20:00Z
actualizado: 2026-09-09T23:20:00Z
promovido_a_agents: no
arreglo: no es tuyo y no es del feature que estés cerrando — vuelve a correr la suite antes de tocar nada; si se repite, la causa está por diagnosticar y este es el sitio donde escribirla
---

## Qué pasa de verdad

`src/features/marketplace/server/search.db.test.ts` › «pagination is stable and
total order holds across repeated calls (E21, R8)» falló **una vez** dentro de
`npm test` completo y pasó en todas las corridas posteriores. Se vio al cerrar
F-042, en un ciclo que no tocó ni el buscador, ni el marketplace, ni nada de lo
que ese test ejercita.

El test crea cuatro productos canónicos con nombres `Pageword a…d` más un token
de sesión único, los pide en dos páginas de dos y luego en una de cuatro, y
exige que la unión de las dos páginas sea exactamente la página completa, en el
mismo orden. Su propio comentario dice de dónde sale el orden y es la pista
principal: los cuatro tienen **el mismo rank y el mismo `storeCount` (0)**, así
que quien desempata es `name ASC`, y el test se apoya en que ese orden
«happens to match» el de creación.

## Qué se descartó, para que nadie lo vuelva a hacer

Esto costó tiempo y no hace falta repetirlo:

1. **No lo causó el cambio que se estaba cerrando.** Lo primero que se pensó fue
   una regresión propia. Las ediciones de ese momento eran una ficha del
   playbook, `.agent/features.json` y unas rutas en un `impl.md`: ninguna puede
   tocar una consulta a Postgres.
2. **No es un test lento al que le falte tiempo.** Corrido solo: 18 pasados en
   600 ms. `AGENTS.md` § «Cosas que muerden» ya avisa de que subir un techo no
   arregla esta clase de fallo, y aquí no habría nada que subir.
3. **No se reproduce aislando el proyecto.** Tres corridas completas de
   `npx vitest run --project db`: 192 pasados, 192 pasados, 192 pasados.

## La hipótesis que queda por comprobar

La que no se pudo descartar sin reproducirlo: el proyecto `db` corre contra un
**Postgres compartido**, y en esta máquina lo comparten además varios worktrees
(ficha `docker-compose-container-name-fijo-choca-entre-worktrees`). Bajo la carga
de la suite entera —o de otra sesión escribiendo a la vez— el desempate podría
dejar de ser el que el test da por supuesto. El aserto que se apoya en que
`name ASC` «happens to match» el orden de creación es el eslabón declaradamente
frágil, y es por donde hay que empezar a mirar.

## Cómo se arregla

1. **Vuelve a correr la suite antes de tocar nada.** Si pasa, no es tuyo: sigue.
2. Si se repite, **no ajustes el aserto para que cuadre** — eso convertiría un
   orden total inestable en un test que miente. Reprodúcelo primero, con la
   suite entera y mirando si hay otra sesión escribiendo en el mismo Postgres.
3. Cuando se sepa la causa, **reescribe esta ficha**: hoy documenta lo
   descartado y una hipótesis, no un arreglo. Una ficha que finge saber más de
   lo que sabe cuesta más que ninguna.
