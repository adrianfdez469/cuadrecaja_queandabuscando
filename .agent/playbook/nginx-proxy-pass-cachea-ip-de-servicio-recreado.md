---
slug: nginx-proxy-pass-cachea-ip-de-servicio-recreado
sintoma: "curl a través del gateway (p. ej. `GET http://localhost:54321/auth/v1/health`) responde 502 Bad Gateway aunque el contenedor destino esté healthy y `docker compose up -d` haya salido 0"
firma: 'connect\(\) failed \(111: Connection refused\) while connecting to upstream'
etapa: smoke
visto_en: F-028
creado: 2026-08-29T23:40:34Z
promovido_a_agents: no
arreglo: "docker restart queandabuscando-supabase-gateway (o recrearlo junto al servicio que cambiaste, nunca solo — scripts/storage-dev-keys.mjs ya lo hace bien: `docker compose up -d --force-recreate storage supabase-gateway auth`)"
---

## Qué pasa de verdad

`docker/supabase-gateway.conf` usa `proxy_pass http://auth:9999/;` (y
`http://storage:5000/;`) con el nombre del servicio literal, sin `resolver` +
variable. nginx resuelve ese nombre a una IP de contenedor **una vez**, al
arrancar (o al recargar su config), y la mantiene en caché para toda la vida
del worker — no vuelve a preguntarle a Docker DNS en cada petición. Si el
contenedor `auth` (o `storage`) se recrea — `docker compose up -d
--force-recreate auth`, o cualquier reinicio que le cambie la IP en la red del
compose — el gateway sigue apuntando a la IP VIEJA. El síntoma no aparece al
levantar (`docker compose up -d` sale 0, el healthcheck de `auth` es interno a
ese contenedor y no pasa por el gateway) sino en la PRIMERA petición real que
cruza el gateway después de la recreación, con `connect() failed (111:
Connection refused)` en el log del gateway, no del servicio.

Se reprodujo haciendo justo lo que este ciclo pedía (romper la plantilla de
correo con `docker compose up -d --no-deps --force-recreate auth` para
probar el repliegue silencioso del riesgo 1, y luego revertir con el mismo
comando): la segunda recreación de `auth` — SIN recrear también el gateway —
dejó `/auth/v1/health` en 502 durante varios minutos aunque `auth` mismo
reportaba `healthy`.

## Cómo se arregla

`docker restart queandabuscando-supabase-gateway` (o cualquier acción que
recargue su config/arranque el proceso de nuevo, forzando una nueva
resolución DNS). Confirmado: tras el restart, `/auth/v1/health` volvió a 200
de inmediato.

## Cuándo NO es esto

Si el healthcheck del propio servicio (`docker ps`, columna `STATUS`) también
sale `unhealthy` o el contenedor no arrancó, no es esto — el problema está en
ese servicio, no en el gateway. Esto es específicamente "el servicio destino
está sano, pero el gateway no lo alcanza".

## Cómo se evita

Nunca recrear `auth` o `storage` de forma aislada (`--no-deps
--force-recreate <uno solo>`) fuera de una sesión de depuración deliberada;
en el flujo real de rotación de claves, `scripts/storage-dev-keys.mjs` ya
imprime el comando correcto que recrea el gateway A LA VEZ que los servicios
que sirve: `docker compose up -d --force-recreate storage supabase-gateway
auth`. Seguir ese mensaje al pie de la letra evita esta trampa; solo aparece
cuando alguien (como este ciclo de pruebas) recrea un servicio a mano sin su
gateway.
