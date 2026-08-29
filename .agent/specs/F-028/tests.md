---
feature: F-028
agente: sdd-tester
actualizado: 2026-08-29T23:45:00Z
estado: listo
veredicto: listo
---

## Estrategia

Todo lo de este documento se ejecutó, ninguno se dedujo leyendo código
(regla 1 del backlog, R13 de `spec.md`). Tres niveles:

1. **El sensor**, dos veces: `bash .agent/verify.sh F-028 --full` (con y sin
   `auth`/`auth-db`/`mailpit` arriba) y `bash .agent/verify.sh F-028 --smoke`
   (`.agent/specs/F-028/smoke.sh`, ya existía, sin ampliar — cubre exactamente
   los criterios 1, 2, 3 y 8, que es lo que `architecture.md` § Contratos le
   encarga).
2. **Los cuatro ataques que pidió el humano**: repliegue silencioso de la
   plantilla (riesgo 1), la opcionalidad de criterios 4/5, la trampa del
   renombrado del gateway (criterio 1) + criterio 10, y el aviso del
   contenedor viejo (E16/R11). Los cuatro se rompieron a propósito, se
   comprobó la reacción, y se dejó el entorno como estaba.
3. **Los criterios que no pasan por `smoke.sh`** (4, 5, 6, 7, 9, 10, 11):
   `curl`, `docker compose config`, `git grep`, `npx prisma migrate diff` y la
   lectura del job de CI, uno por uno.

Nada de esto tocó `src/`, `prisma/` ni `package.json`. `docker-compose.yml` se
editó dos veces de forma temporal y deliberada para el ataque 1 (romper la
plantilla), restaurado byte a byte cada vez (`md5` idéntico antes/después,
verificado).

## Mapa criterio → prueba

| #   | Criterio de aceptación (literal, resumido)                                                               | Prueba                                                                                                                                                                                                                                                                                 | Resultado |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `docker compose up -d` → un origen, dos APIs                                                             | `curl -fsS http://localhost:54321/auth/v1/health` (200, `GoTrue`) + `curl .../storage/v1/bucket -H "Authorization: Bearer $SERVICE_KEY"` → `store-media`                                                                                                                               | **LISTO** |
| 2   | El guion de correo termina en 0 sin humano                                                               | `node scripts/auth-otp.mjs --email prueba+<ts>@local.test` → exit 0, `user_id` UUID                                                                                                                                                                                                    | **LISTO** |
| 3   | El acceso por correo funciona por las rutas de F-012                                                     | `smoke.sh`: `POST /api/account/otp` → `POST /api/account/otp/verify` → `GET /cuenta` 200 + `select count(*) from "Customer"` antes/después, diff = 1                                                                                                                                   | **LISTO** |
| 4   | Con el emulador parado, `init.sh` → ENTORNO LISTO + `/tienda-demo`/`/cuenta/entrar` 200                  | `docker stop auth auth-db mailpit`; `bash .agent/init.sh` → 0, `ENTORNO LISTO`, `warn` con el comando exacto; `next dev` propio (puerto 3105) → ambas rutas 200                                                                                                                        | **LISTO** |
| 5   | Criterio 6 de F-012 sigue en pie                                                                         | `NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build` → 0; `npm run start -p 3106` con las mismas vacías → `/tienda-demo` 200                                                                                                                                   | **LISTO** |
| 6   | `prisma migrate diff` no menciona `auth`/`storage`                                                       | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (con el emulador arriba) → salida solo con `DROP INDEX` de GIN ya conocidos (ficha `prisma-migrate-dev-borra-indices-gin-no-declarados`, ajena); `grep -ci 'auth\|storage'` → **0**       | **LISTO** |
| 7   | Nada con forma de clave en git; `docker compose config` falla nombrando el generador si falta el secreto | `git grep -nE 'eyJ[A-Za-z0-9_-]{20,}' -- ':(exclude)package-lock.json'` → sin salida, exit **1** (PP1); `STORAGE_JWT_SECRET= docker compose config` → exit **1**, mensaje nombra `scripts/storage-dev-keys.mjs`                                                                        | **LISTO** |
| 8   | `authorize` de Google y Facebook → 302 con `redirect_uri`/`state`                                        | `smoke.sh`: Facebook 302 a `facebook.com`; Google 302 a `accounts.google.com` (la red de este entorno sí llegó al descubrimiento OIDC esta vez — riesgo (d) no se materializó, ver nota abajo); Apple observado 302 a `appleid.apple.com`, sin aserto (E9)                             | **LISTO** |
| 9   | Se levanta y se ejecuta en CI sin secretos de repositorio                                                | Lectura de `.github/workflows/ci.yml` job `auth`: genera claves con `node scripts/storage-dev-keys.mjs --write`, corre `bash .agent/verify.sh F-028 --only smoke` (criterios 1,2,3,8 — PP2); `grep -c '\${{[[:space:]]*secrets\.'` sobre el job → **0** (ver nota sobre el I7 literal) | **LISTO** |
| 10  | `docker compose up -d` dos veces seguidas, 0 las dos                                                     | Ejecutado dos veces seguidas tras el ataque del contenedor viejo → **0** y **0**                                                                                                                                                                                                       | **LISTO** |
| 11  | `verify.sh F-028 --full` → 0                                                                             | `bash .agent/verify.sh F-028 --full` → **0**, con el emulador arriba y también parado                                                                                                                                                                                                  | **LISTO** |

Los **once** están cubiertos ejecutando algo. Ninguno se dio por bueno leyendo
código.

## Ejecuciones

### El sensor, dos veces

```
$ bash .agent/verify.sh F-028 --full
== Verificación F-028 · intento 27/28 ==
  ✓ harness 0-1s  ✓ typecheck 1s  ✓ lint 3-4s  ✓ format 4-5s  ✓ test 14-15s
  ✓ prisma 1s     ✓ build 3-4s   ✓ theme 0-1s  ✓ bundle 0s
PASA                                                   → exit 0
```

Corrido con `auth`/`auth-db`/`mailpit` arriba (intento 27/28) **y** con los
tres parados (intento 27, entre el ataque 2 y su reversión): las dos veces
**0**. R4 confirmado, no solo leído.

```
$ bash .agent/verify.sh F-028 --smoke
  ✓ typecheck  ✓ lint  ✓ format  ✓ test  ✓ smoke (5s)
PASA                                                   → exit 0
```

Log completo en `.agent/runs/F-028/029-smoke.log`:

```
  ok   criterio 1a — GET /auth/v1/health
  ok   criterio 1b — /storage/v1/bucket sigue devolviendo store-media
  ok   criterio 2 — scripts/auth-otp.mjs termina en 0 con un user_id UUID (017401e3-1800-4bbf-b930-5e5735b7b6c6)
  ok   criterio 3 — exactamente un Customer nuevo (E6)
  ok   criterio 3 — GET /cuenta con la cookie
  ok   criterio 3 — /cuenta trae el correo del perfil
  ok   criterio 8 — authorize?provider=facebook → 302 con redirect_uri y state
  ok   criterio 8 — authorize?provider=google → 302 con redirect_uri y state
  ..  apple: authorize respondió 302 → https://appleid.apple.com/... (observación E9, sin aserto)
0 aserciones fallidas
```

### Ataque 1 — el repliegue silencioso de la plantilla (riesgo 1), y **sí se detecta**

Esta es la pregunta que más importa de este ciclo, así que va con todo el
detalle. Objetivo: dejar `GOTRUE_MAILER_TEMPLATES_CONFIRMATION`/`_MAGIC_LINK`
inalcanzables y comprobar que el guion sale **4**, no 0, y dice por qué.

1. Backup exacto: `cp docker-compose.yml .agent/runs/_libre/docker-compose.yml.bak-tester`
   (md5 confirmado antes/después de restaurar).
2. Edité las dos líneas a una ruta que no existe:
   `GOTRUE_MAILER_TEMPLATES_CONFIRMATION/_MAGIC_LINK: http://supabase-gateway/dev-mail/otp-sdd-tester-riesgo1.html`.
3. `docker compose up -d --no-deps --force-recreate auth` → contenedor sano
   (`/auth/v1/health` 200 con la plantilla rota; GoTrue arranca igual, el
   fallo es en tiempo de envío, no de arranque).
4. **La prueba del riesgo, con curl puro** (sin el guion, para que quede claro
   que no es el guion inventando el fallo):
   ```
   $ curl -si http://localhost:54321/auth/v1/otp -H "apikey: $ANON_KEY" \
       -H "Content-Type: application/json" -d '{"email":"prueba+riesgo1-http-...@local.test"}'
   HTTP/1.1 200 OK
   ```
   **200, exactamente como predice `architecture.md` § Riesgos: la respuesta
   HTTP no dice nada.** El correo capturado, revisado en el log del gateway,
   trae la plantilla por omisión de GoTrue en inglés («Confirm your email
   address»), sin token.
5. **El guion**:
   ```
   $ node scripts/auth-otp.mjs --email prueba+riesgo1-...@local.test
   > pidiendo el código para prueba+riesgo1-...@local.test (modo gotrue)
   > esperando el correo ... en http://localhost:54324 (hasta 15s)
   Ni el asunto ni el cuerpo traen un código de 6 dígitos.
   Revisa GOTRUE_MAILER_SUBJECTS_* y GOTRUE_MAILER_TEMPLATES_*.
   Asunto: Confirm your email address
   Cuerpo (200 chars): --------------------------
   Confirm your email address
   --------------------------
   Follow the link below to confirm this email address and finish signing up.
   Confirm email address ( http://localhost:5
   EXIT: 4
   ```
   **Código de salida 4, no 0.** El mensaje dice exactamente qué mirar
   (`GOTRUE_MAILER_SUBJECTS_*`/`GOTRUE_MAILER_TEMPLATES_*`) y muestra el
   asunto y el cuerpo literales — justo el contrato de la tabla de
   `architecture.md` § El guion.
6. Restauré `docker-compose.yml` desde el backup (`md5` idéntico confirmado),
   `docker compose up -d --no-deps --force-recreate auth`, y confirmé el
   camino feliz de nuevo: `node scripts/auth-otp.mjs --email
prueba+restore-check-...@local.test` → **exit 0**, `token=000658`,
   `user_id` UUID.

**Un matiz sobre el asunto, para `architecture.md`**: el documento dice que
«el asunto lleva el token por una vía que no usa la red, así que el fallo
siempre es diagnosticable» dando a entender que el asunto se mantiene
personalizado aunque el cuerpo falle. En esta prueba, cuando el fetch del
**cuerpo** falló, GoTrue también repliega el **asunto** a su valor por
defecto en inglés (no al `GOTRUE_MAILER_SUBJECTS_CONFIRMATION` configurado).
No cambia la conclusión — el guion **igual** detecta el fallo y sale 4,
mirando ambos campos, tal como la tabla de códigos de salida ya contempla
(«ni el asunto ni el cuerpo») — pero la premisa de que el asunto es un canal
de diagnóstico _independiente_ del cuerpo no se sostuvo en este entorno. Es
una nota para `sdd-architect`, no un fallo de F-028: el criterio 2 sigue
verificado y el código 4 sigue siendo el resultado correcto.

**Efecto secundario encontrado y fichado, no un fallo de criterio**: tras la
segunda recreación aislada de `auth` (`--no-deps --force-recreate`, paso 6),
el gateway quedó apuntando a la IP vieja del contenedor (nginx cachea la
resolución DNS de `proxy_pass http://auth:9999/`) y `/auth/v1/health` dio
**502** durante unos minutos hasta que reinicié el gateway
(`docker restart queandabuscando-supabase-gateway`). No ocurre en el flujo
documentado (`scripts/storage-dev-keys.mjs` ya recomienda recrear
`storage supabase-gateway auth` juntos); ocurre solo si alguien recrea `auth`
o `storage` **en aislamiento**, como hice yo para no perturbar el resto del
stack durante el ataque. Fichado:
`.agent/playbook/nginx-proxy-pass-cachea-ip-de-servicio-recreado.md`.

### Ataque 2 — la opcionalidad de los criterios 4 y 5

```
$ docker stop queandabuscando-auth queandabuscando-auth-db queandabuscando-mailpit
$ bash .agent/init.sh
== Auth ==
  ! emulador de Auth no responde — ejecuta: docker compose up -d
  ! Mailpit no responde en http://localhost:54324 — comprueba el puerto y ejecuta: docker compose up -d
ENTORNO LISTO                                          → exit 0
```

```
$ bash .agent/verify.sh F-028 --full
PASA                                                   → exit 0   (con Auth parado)
```

```
$ npm run dev -- -p 3105   # servidor propio, no el 3000 de otro worktree
$ curl -o /dev/null -w '%{http_code}' http://localhost:3105/tienda-demo     → 200
$ curl -o /dev/null -w '%{http_code}' http://localhost:3105/cuenta/entrar   → 200
```

```
$ NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run build
...
BUILD_EXIT: 0
$ NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_ANON_KEY="" npm run start -- -p 3106
$ curl -o /dev/null -w '%{http_code}' http://localhost:3106/tienda-demo     → 200
```

Contenedores restaurados: `docker start queandabuscando-auth-db
queandabuscando-auth queandabuscando-mailpit`, healthy en 5s.

### Ataque 3 — la trampa del renombrado (criterio 1) y criterio 10

```
$ curl -fsS http://localhost:54321/auth/v1/health                                    → 200 GoTrue
$ curl -fsS http://localhost:54321/storage/v1/bucket -H "Authorization: Bearer $SERVICE_KEY" | grep -o store-media   → store-media
$ docker compose up -d --remove-orphans   (ya arriba)                                → exit 0
$ docker compose up -d --remove-orphans   (segunda vez)                              → exit 0
```

Storage no se rompió por el renombrado, y el segundo `up -d` fue idempotente
(criterio 10). El `storage-bucket-init` corrió (`Started`) en el primer `up`
y no se re-ejecutó destructivamente en el segundo.

### Ataque 4 — el aviso del contenedor viejo (E16/R11)

```
$ docker run -d --name queandabuscando-storage-gateway alpine:3.20 sleep 3600
$ bash .agent/init.sh
== Auth ==
  ! el contenedor viejo queandabuscando-storage-gateway sigue vivo — ejecuta: docker compose up -d --remove-orphans
```

Detectado y nombrado el comando literal, exactamente como pide E16/R11.
`.env.example` también lo dice (línea 40: `docker compose up -d
--remove-orphans`). Limpieza: `docker rm -f queandabuscando-storage-gateway`;
`init.sh` vuelve a `ENTORNO LISTO` sin el aviso.

### Criterios sueltos (6, 7, 9)

```
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- DropIndex ... (4 índices GIN/trgm, ajenos, ficha ya existente)
$ grep -ci 'auth\|storage' <salida>                                                  → 0
```

```
$ git grep -nE 'eyJ[A-Za-z0-9_-]{20,}' -- ':(exclude)package-lock.json'              → sin salida, exit 1
$ git grep -nE 'eyJ[A-Za-z0-9_-]{20,}' -- .                                          → package-lock.json:7975 (integrity, ajeno; confirma I6)
$ STORAGE_JWT_SECRET= docker compose config
error while interpolating services.auth.environment.GOTRUE_JWT_SECRET: required
variable STORAGE_JWT_SECRET is missing a value: missing, run node scripts/storage-dev-keys.mjs --write
                                                                                       → exit 1
```

**Nota sobre I7 (criterio 9), no un fallo de criterio**: `spec.md` I7 propone
verificar «sin secreto de repositorio» con `grep -c 'secrets\.'` sobre el job.
Ejecutado literal sobre el job `auth` de `.github/workflows/ci.yml`, da **1**,
no 0 — por un comentario del propio job que dice «Cero `secrets.` (criterio
9): …», que contiene la subcadena literal `secrets.` en prosa. Es el mismo
patrón que I6 (falso positivo por texto ajeno al significado que el criterio
persigue). Restringiendo el grep a uso real de la sintaxis de GitHub Actions
(`grep -c '\${{[[:space:]]*secrets\.'`) da **0**, que es lo que el criterio 9
pide de verdad: cero secretos de repositorio usados. El criterio 9 se
verifica **LISTO** por esta vía; el hallazgo es que el comando literal de I7
necesita el mismo tipo de ajuste que PP1 le dio al criterio 7, y se lo señalo
a `sdd-spec` para que lo repare en I7 si quiere que el comando literal sirva
tal cual (severidad baja, cosmético, no bloquea el veredicto).

## Fallos encontrados

Ninguno que impida el veredicto `listo`. Dos observaciones, ninguna con
severidad de bloqueo:

1. **`nginx-proxy-pass-cachea-ip-de-servicio-recreado`** (severidad baja,
   operativa) — descrito arriba, fichado, no reproducible por el flujo
   documentado del feature (solo por recrear `auth`/`storage` en aislamiento,
   fuera del comando que `scripts/storage-dev-keys.mjs` ya recomienda). No
   vuelve a ningún agente: es una trampa de Docker/nginx para quien depure a
   mano, ya fichada para la próxima vez.
2. **I7 (`spec.md`) usa un `grep` que un comentario propio hace fallar**
   (severidad baja, cosmético) — descrito arriba. Vuelve a **`sdd-spec`**
   si quiere que el comando literal de I7 sirva sin ajuste; no bloquea el
   criterio 9, que se verificó por sustancia (cero uso real de
   `secrets.` de GitHub Actions en el job).

`bash .agent/verify.sh pending F-028` → vacío (confirmado antes y después de
las cuatro pruebas de ataque).

## Huecos de cobertura

- **El repliegue silencioso (riesgo 1) no está automatizado en `smoke.sh`.**
  Se verificó a mano este ciclo, con reproducción completa arriba, pero no
  hay un test que lo ejercite en cada corrida: automatizarlo exigiría que el
  smoke reconfigure y recree `docker-compose.yml`/el contenedor `auth` en
  mitad de una suite que otros criterios (1, 2, 3, 8) necesitan sana al mismo
  tiempo — invasivo y frágil para un smoke que corre también en CI. Riesgo de
  no probarlo en cada corrida: si alguien cambia `GOTRUE_MAILER_TEMPLATES_*` o
  el `location /dev-mail/` del gateway sin querer, nadie lo notará hasta que
  alguien repita este procedimiento manual. Mitigado en parte: el criterio 2
  y el criterio 3 SÍ fallarían (el correo no traería 6 dígitos) si la
  plantilla se rompiera de verdad en un `docker compose up -d` normal, así
  que el smoke actual detectaría el síntoma, aunque no distinguiría la
  causa exacta (repliegue silencioso vs. otro fallo de correo) sin correr el
  guion a mano como se hizo aquí.
- **Los otros cinco códigos de salida del guion** (1, 2, 3, 5, 6) no se
  ejercitaron este ciclo — solo 0 y 4. No son criterio de F-028, pero
  quedan sin ejercitar de punta a punta; quien retome debería, al menos,
  provocar el 6 (dos correos para el mismo destinatario) antes de confiar en
  el mensaje que imprime.
- **El caso de código caducado** (`otp_expired`) que `spec.md` § Casos límite
  anota como observación posible con correo real: no se ejecutó este ciclo
  (`MAILER_OTP_EXP=300`, 5 minutos, hace la espera cara). No es criterio de
  F-028; queda para quien reabra F-012 y quiera cerrar ese hueco de
  `.agent/specs/F-012/impl.md`.
- **La concurrencia de dos canjes simultáneos** (E8 de F-012, posibilidad que
  `spec.md` menciona sin exigirla): no se ejecutó. Tampoco es criterio de
  F-028.

## Veredicto

**LISTO.** Los once `acceptance_criteria` de F-028 se verificaron ejecutando
algo, con su comando y su salida real documentados arriba. Los cuatro ataques
pedidos —repliegue silencioso de la plantilla, opcionalidad de 4/5, trampa del
renombrado + idempotencia (1/10), y aviso del contenedor viejo (E16/R11)— se
reprodujeron y el feature reaccionó como el diseño promete en los cuatro
casos. El entorno quedó como al empezar: `auth`, `auth-db`, `mailpit`,
`storage`, `storage-db`, `supabase-gateway` y `postgres` arriba y healthy,
`docker-compose.yml` restaurado byte a byte (md5 verificado), sin
contenedores huérfanos.

`bash .agent/verify.sh F-028 --full` → **0**. `bash .agent/verify.sh F-028
--smoke` → **0**. `bash .agent/verify.sh pending F-028` → vacío.

## Preguntas al humano

Ninguna. Los dos hallazgos de este ciclo (la caché de IP de nginx, y el I7 de
`spec.md`) tienen severidad y destinatario claros arriba; ninguno exige una
decisión de producto ni deja un criterio sin verificar tal como está escrito.
