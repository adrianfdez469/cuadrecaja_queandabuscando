---
slug: docker-compose-container-name-fijo-choca-entre-worktrees
sintoma: 'docker compose up -d falla con "Conflict. The container name ... is already in use by container ..." — o el gateway falla con "port is already allocated" — aunque `docker-compose.yml` de ESTE worktree no cambió'
firma: Conflict\. The container name
etapa: review
visto_en: F-028
creado: 2026-08-29T23:22:00Z
promovido_a_agents: no
arreglo: 'docker inspect <nombre> --format "{{index .Config.Labels \"com.docker.compose.project\"}}" para ver de qué worktree es; si es un worktree hermano (no el tuyo), docker stop/rm esos contenedores por nombre y vuelve a levantar `docker compose up -d` desde TU worktree — los volúmenes de cada proyecto son independientes, no se pierden datos ajenos'
---

## Qué pasa de verdad

`docker-compose.yml` fija `container_name` en cada servicio (a propósito,
para que healthchecks/`depends_on` y `curl` internos tengan un nombre
predecible). Eso es GLOBAL al daemon de Docker, no por-worktree: si dos
worktrees del mismo repo (dos checkouts, por ejemplo bajo Orca) corren
`docker compose up -d` en momentos distintos, el segundo choca con los
nombres del primero, aunque cada uno tenga su PROPIO `docker compose
project` (derivado del nombre del directorio) y por tanto sus PROPIOS
volúmenes con nombre `<proyecto>_<volumen>`. `docker volume ls` puede
mostrar media docena de prefijos de proyecto distintos para el mismo
volumen lógico — cada worktree que alguna vez corrió `up` dejó el suyo.

## Cómo se arregla

1. `docker ps -a --format '{{.Names}}'` para ver qué contenedores ya existen
   con los nombres que tu compose quiere usar.
2. `docker inspect <nombre> --format '{{index .Config.Labels
"com.docker.compose.project"}}'` y `...working_dir` para confirmar que
   son de OTRO worktree (no el tuyo).
3. `docker stop <nombres...> && docker rm <nombres...>` — esto NO borra los
   volúmenes de datos del otro proyecto (son independientes, con su propio
   prefijo), así que ese worktree puede recrear los suyos con
   `docker compose up -d` cuando vuelva a usarlos.
4. `docker compose up -d --remove-orphans` desde tu propio worktree.

## Cuándo NO es esto

Si el conflicto es contra un contenedor de TU MISMO proyecto (mismo
`com.docker.compose.project`), no es esto — es un contenedor a medio
recrear o un `docker compose down` interrumpido; ahí sí importa no perder
sus datos porque son tuyos.

## Cómo se evita

No hay arreglo estructural sin tocar `docker-compose.yml` (quitarle
`container_name` rompería los `curl http://<servicio>/...` internos y los
`depends_on` con nombre literal que ya existen). Mientras el repo use
nombres fijos, solo un worktree a la vez puede tener el stack de Docker
arriba bajo esos nombres — el resto lo usa vía los puertos publicados
(5433, 54321, 54324) sin volver a correr `docker compose up -d` desde el
suyo, o acepta este mismo procedimiento de "tomar prestado" el stack.
