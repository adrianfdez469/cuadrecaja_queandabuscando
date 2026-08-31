---
slug: compose-wait-cuenta-el-one-shot-como-fallo
sintoma: "el job auth muere en `docker compose up --wait` con TODOS los contenedores Healthy y `storage-bucket-init exited (0)` justo antes"
firma: storage-bucket-init exited \(0\)
etapa: harness
visto_en: F-028
creado: 2026-08-31T02:40:00Z
promovido_a_agents: no
arreglo: no dejes que `--wait` vigile un servicio de un solo uso — espera solo a los que se quedan arriba (`docker compose config --services` menos el one-shot) y comprueba el one-shot aparte con `docker wait`
---

## Qué pasa de verdad

El log parece decir que los emuladores no arrancaron. Dicen justo lo contrario:
los siete contenedores llegan a `Healthy` y el que "falla" salió con **0**.

`docker compose up --wait` espera a que cada servicio quede **running o
healthy**. Un servicio que **termina** no llega a ninguno de los dos estados, y
compose lo cuenta como espera fallida — **aunque haya salido con 0**.
`storage-bucket-init` es exactamente eso: siembra el bucket `store-media` y se
va. Es el único servicio del fichero con `restart: "no"`; los otros siete son
`unless-stopped`.

Reproducido en aislado, fuera de este repo, con dos servicios —uno que se queda
y otro que hace `exit 0`—:

```
docker compose up -d --wait                          -> exit 1
docker compose up -d                                 -> exit 0
docker compose up -d --wait <solo los que se quedan> -> exit 0
```

**Lo que más despista:** es intermitente y no correlaciona con nada del árbol.
Apareció por primera vez en un diff que solo tocaba `docs/`, después de semanas
en verde y con los pasos 1-6 del job idénticos al run anterior que sí pasó.
Se pierde tiempo buscando qué se rompió en el commit. No se rompió nada: la
trampa llevaba latente desde que F-028 añadió los emuladores.

## Cómo se arregla

Ya está arreglado en `.github/workflows/ci.yml` (job `auth`). Si vuelve a
aparecer —por ejemplo al añadir otro servicio de un solo uso—, el patrón es:

```yaml
run: |
  docker compose up -d
  docker compose up -d --wait --wait-timeout 180 \
    $(docker compose config --services | grep -vx <el-one-shot>)
```

y el one-shot se comprueba aparte, que además es una aserción de verdad y no
un efecto colateral de la espera:

```yaml
run: |
  code=$(docker wait <container_name-del-one-shot>)
  [ "$code" = "0" ] || { docker compose logs <el-one-shot>; exit 1; }
```

La lista sale de `docker compose config --services`, **no escrita a mano**: un
servicio nuevo queda cubierto sin tocar el workflow.

## Cuándo NO es esto

La `firma` pesca cualquier línea donde el sembrador termine, incluida la del
caso en que **de verdad falló**. Míralo antes de aplicar nada:

- Si el número entre paréntesis **no es 0** (`exited (1)`), el bucket no se
  creó y esta ficha no aplica: lee `docker compose logs storage-bucket-init`.
  El entrypoint reintenta 20 veces el `psql` y 20 el `POST /storage/v1/bucket`,
  así que un fallo ahí es real.
- Si algún contenedor **no** llegó a `Healthy`, tampoco es esto: es un
  emulador que no levanta, y el `--wait` está haciendo su trabajo.

Dicho corto: esta ficha solo aplica cuando **todo está sano y aun así el paso
sale 1**.

## Cómo se evita

Al añadir a `docker-compose.yml` cualquier servicio que **termine** —una
siembra, una migración, un `init`—, acuérdate de que queda fuera de lo que
`--wait` puede vigilar. Son fáciles de reconocer: llevan `restart: "no"`.

No se resolvió con `profiles:`, que sería lo idiomático, a propósito:
`docker compose up -d` está documentado tal cual en el README, en
`.agent/init.sh` y en los mensajes de error de `scripts/storage-dev-keys.mjs` y
`scripts/auth-otp.mjs`. Meter el sembrador en un perfil haría que todas esas
instrucciones se saltaran la creación del bucket **en silencio**, que es
bastante peor que un CI en rojo.
