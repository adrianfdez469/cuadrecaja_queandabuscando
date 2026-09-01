# Desplegar e integrar queandabuscando

El orden de este documento **es** el procedimiento: cada paso supone que los
anteriores están hechos. Cada uno dice qué pasa si se salta, porque la mitad de
los fallos de despliegue no se ven —el sistema arranca, responde 200 y hace algo
distinto de lo que crees.

Tres marcas se repiten y significan cosas distintas:

- **⚠ Nadie lo comprueba.** Ni el CI, ni `verify.sh`, ni un test. Si se olvida,
  te enteras en producción o no te enteras.
- **↔ Hay otro equipo al otro lado.** Toca coordinar con cuadrecaja.
- **⟳ Se repite.** No es solo del primer despliegue: vuelve cada vez que se
  añade un negocio, se rota un secreto o se publica una versión del contrato.

## Cómo se mantiene este documento

Cuando un feature añade un paso operativo —un secreto, un cron, un bucket, una
regla de plataforma, una migración que necesita mirarse— **ese paso se escribe
aquí en el mismo ciclo**, no cuando alguien lo eche de menos. La prueba de que
hace falta es F-019: dejó una regla de firewall que ningún guion puede
comprobar, y sin este documento habría vivido solo en una ADR que nadie lee el
día del despliegue.

Lo que **no** va aquí: cómo se levanta el entorno de desarrollo local, que está
en `.env.example` y en `bash .agent/init.sh`.

---

## 1. La base de datos

**Un proyecto de Supabase propio de queandabuscando, NO el de cuadrecaja.** Son
dos bases separadas a propósito: toda la integración pasa por HTTP
([ADR 0001](adr/0001-sync-por-http-con-outbox.md)) y nada lee directamente la
base del otro.

1. Crear el proyecto y anotar sus dos cadenas de conexión.
2. `DATABASE_URL` — la **agrupada** (Supavisor, puerto 6543), con
   `?pgbouncer=true&connection_limit=2`. Es la que usa la app en marcha.
3. `DIRECT_URL` — la **directa** (puerto 5432). Solo la usan las migraciones y
   la introspección: el DDL no pasa por el pooler.
4. Aplicar las migraciones: **`npm run db:deploy`**.

**Por qué importa la distinción de las dos URLs.** El pooler corre en **modo
transacción**: ninguna query puede usar el cliente global dentro de un
`$transaction`, o hace deadlock contra la conexión del pool. Es una restricción
del entorno, no una preferencia — el código ya está escrito para respetarla, y
apuntar `DATABASE_URL` a la conexión directa la esconde en desarrollo para que
aparezca en producción.

**Prohibido**, y no es un consejo: `prisma migrate reset` destruye datos y
`prisma db push` desincroniza el schema de las migraciones versionadas. Si una
migración parece necesitar cualquiera de los dos, se pregunta.

**Extensiones.** `unaccent` y `pg_trgm` las crea la migración inicial con
`CREATE EXTENSION IF NOT EXISTS`. Si el rol de la conexión no tiene permiso para
crearlas, `db:deploy` falla ahí — créalas a mano desde el panel de Supabase y
vuelve a lanzarlo.

**⚠ Al revisar cualquier migración generada con `prisma migrate dev`:** Prisma
propone `DROP INDEX` de cinco índices GIN y parciales de búsqueda que no están
declarados en `prisma/schema.prisma`, **en cualquier diff, tenga que ver o no**.
Quítalos del `migration.sql` antes de aplicarlo. Aplicarlo sin mirar no rompe
ningún test: solo deja la búsqueda haciendo scans secuenciales en producción.

**F-026 — `20260831033437_local_category_slug_unique` lleva un backfill que
puede fallar ruidosamente.** Aditiva (columna `sourceUpdatedAt` y
`@@unique([businessId, slug])` en `LocalCategory`) y ya viaja en
`prisma/migrations/`, así que `npm run db:deploy` la aplica sola como
cualquier otra — no hace falta repetir a mano el procedimiento de
`--create-only` que la generó. Lo que sí necesita mirarse: si el entorno tiene
dos categorías del mismo negocio cuyo nombre slugifica igual (algo que en
desarrollo, al cerrar F-026, no ocurría — 0 colisiones verificadas), el
backfill de desambiguación del propio `migration.sql` las reordena solo; si
no converge en diez pasadas, la migración aborta con
`LocalCategory slug backfill did not converge in 10 passes` en vez de dejar la
base sin el unique. Ese error se resuelve consultando las colisiones a mano
(`SELECT "businessId", "slug", count(*) FROM "LocalCategory" GROUP BY 1, 2
HAVING count(*) > 1`) y no reintentando `db:deploy` sin más — la causa es un
dato real, no un fallo transitorio.

---

## 2. Almacenamiento de imágenes

1. Crear el bucket. Por defecto se llama `store-media`
   (`SUPABASE_STORAGE_BUCKET`).
2. `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno. Son
   las dos —y las únicas dos— que comprueba `storageAvailability()`, en ese
   orden.

**`STORAGE_JWT_SECRET` no va aquí.** Aparece en `.env.example` y en
`docker-compose.yml`, pero **la aplicación no lo lee nunca**: es de los
emuladores locales de Storage y Auth, y lo genera
`node scripts/storage-dev-keys.mjs --write`. Ponerlo en producción no hace nada,
y buscarlo cuando fallan las imágenes hace perder el tiempo — el motivo real
será uno de los dos de arriba.

Si falta cualquiera de las dos, subir una imagen devuelve **503 con un motivo**
(`missing_supabase_url` o `missing_service_role_key`), no un 500 — está diseñado
así en `src/lib/supabase/storage.ts`. El resto de la app sigue funcionando, así
que **este fallo es silencioso hasta que alguien intenta subir una foto**.

`NEXT_PUBLIC_SUPABASE_URL` la comparte con §3: es el mismo proyecto de Supabase
para las imágenes y para la cuenta del comprador.

Las imágenes se derivan **al subir**, no por petición
([ADR 0022](adr/0022-imagenes-derivadas-al-subir.md)), y se sirven desde el CDN.

---

## 3. Acceso del comprador (opcional para él, obligatorio configurarlo)

La cuenta del comprador es opcional: el checkout de invitado funciona sin ella
([ADR 0023](adr/0023-cuenta-del-comprador.md)). Pero si se habilita mal, la
pantalla de acceso existe y no lleva a ningún sitio.

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **⚠ Los proveedores sociales (Google, Facebook, Apple) se configuran en el
  panel de Supabase, no en `.env`.** Sus credenciales no están —ni deben estar—
  en este repositorio. Localmente solo el acceso por correo se verifica de
  extremo a extremo; los sociales solo hasta la redirección de salida, y Apple
  ni eso (`.agent/specs/F-028/spec.md` § «Hasta dónde llega esto»).
- Cada proveedor necesita su URL de retorno apuntando al dominio real. Una URL
  de retorno con el dominio de desarrollo deja el acceso roto en producción
  **sin ningún error visible en el arranque**.

---

## 4. Los secretos, y qué rompe cada uno

Todos van en el entorno del despliegue. `.env.example` los lista con su formato.

| Variable               | Para qué                                     | Si falta o está mal                                               |
| ---------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`         | La app en marcha                             | No arranca                                                        |
| `DIRECT_URL`           | Migraciones                                  | `db:deploy` falla                                                 |
| `SSO_JWT_SECRET`       | ↔ Verifica el token de entrada del admin     | El admin no puede entrar; se registra el motivo en el log         |
| `ADMIN_SESSION_SECRET` | Firma la sesión local del admin              | La sesión no se puede crear                                       |
| `CRON_SECRET`          | Autoriza los crons                           | Los crons responden 401 y **nada avisa**: el reloj deja de correr |
| `SUPABASE_*`           | Imágenes y cuenta del comprador              | Ver §2 y §3                                                       |
| `NEXT_PUBLIC_SITE_URL` | **Ver abajo — es el más fácil de dejar mal** |                                                                   |

**`NEXT_PUBLIC_SITE_URL` merece su propio párrafo.** No es cosmético: de él
salen el `sitemap.xml`, la URL canónica de cada tienda y —lo que más duele— **el
enlace al pedido que el comprador recibe por WhatsApp**. Si apunta al dominio
equivocado, el sistema funciona, los tests pasan, y cada comprador recibe un
enlace a un sitio que no es el tuyo. Compruébalo mirando un enlace real, no la
variable.

`SSO_JWT_SECRET` tiene que valer **lo mismo** aquí y en cuadrecaja: es lo que
firma la aserción de identidad. `ADMIN_SESSION_SECRET` es solo de este lado y no
se comparte con nadie.

---

## 5. Los crons

`vercel.json` declara dos, y ambos exigen `Authorization: Bearer $CRON_SECRET`:

| Ruta                          | Cuándo      | Qué hace                                       |
| ----------------------------- | ----------- | ---------------------------------------------- |
| `/api/crons/purge-sso-tokens` | `0 4 * * *` | Limpia los tokens de un solo uso ya consumidos |
| `/api/crons/expire-proposals` | `0 5 * * *` | Red de seguridad del vencimiento de propuestas |

**El segundo es una red, no el mecanismo.** El vencimiento de una propuesta lo
garantiza la condición de escritura (`expiresAt > now()`) y lo mantiene fresco
el barrido que corre dentro de cada pull del POS. El cron diario solo cubre a
las tiendas que no pullean. Si el cron falla, nadie puede aprobar una propuesta
vencida igualmente — pero el POS verá el estado rancio hasta un día.

---

## 6. ⚠ Lo que ningún guion comprueba

**Esta sección es la razón de ser del documento.** Todo lo de aquí vive fuera del
repositorio: no se despliega con el código, no viaja a un entorno nuevo, y nadie
se entera si alguien lo borra de un panel.

1. **La regla de límite de tasa en el firewall de Vercel**, para
   `POST /[slug]/pedido/[code]/respuesta`. Es la defensa 9 de
   [ADR 0024](adr/0024-segunda-ruta-publica-de-escritura.md), y se eligió a
   sabiendas de que ninguna prueba puede afirmarla. Las otras ocho sí están en
   el código; la que de verdad protege esa ruta es que el código de pedido no se
   adivina.
2. **Excluir `/api/internal/*` del rate limiting público**, si el despliegue
   tiene uno. Es tráfico máquina a máquina y un límite pensado para humanos lo
   estrangula. `robots.ts` ya lo excluye de los rastreadores.
3. **Las URL de retorno de los proveedores de acceso** (§3).

---

## 7. ↔ Integrar con cuadrecaja

El principio que ordena todo: **el POS inicia todas las llamadas**
([ADR 0002](adr/0002-el-pos-inicia-todas-las-llamadas.md)). queandabuscando
nunca llama a cuadrecaja.

### 7.1 Acuñar el token de cada negocio ⟳

**El token es por negocio, no un secreto de plataforma.**

```bash
npm run mint:token -- <externalId>
```

- Si ese `externalId` no existe, crea el negocio.
- Si existe, **rota** su token: el viejo deja de valer al instante y ningún otro
  negocio se ve afectado.
- **El valor en claro se imprime una sola vez y no se guarda en ningún sitio**:
  solo su SHA-256 va a la base. Si se pierde, se vuelve a acuñar; no se puede
  recuperar.

Ese valor se entrega al equipo de cuadrecaja, que lo guarda en la configuración
**de ese negocio**, no en una variable global.

**Mientras ningún negocio tenga token acuñado, `/api/internal/*` responde 503**,
nunca 200. Un token ausente jamás significa «deja pasar todo». Si al integrar
ves 503 en todo, es esto.

### 7.2 Lo que cuadrecaja tiene que construir

No lo repito aquí porque viviría desactualizado: está en
[`sync-contract.md`](sync-contract.md) § «Cambios requeridos en cuadrecaja» —
las columnas nuevas, las dos tablas nuevas (`OutboxEvento`, `PedidoEntrante`),
el índice parcial de divergencia con `CREATE INDEX CONCURRENTLY`, el cron de
sincronización **cada 2 minutos** y el de reconciliación diario.

### 7.3 ⟳ Publicar una versión del contrato

Cada cambio en `sync-contract.md` se coordina con el otro equipo. La versión
vigente es la **v5**, y su primera frase dice que **no es aditiva** en el enum de
estados de pedido: pasa de 6 a 9 valores y rompe a cualquier lector con un
`switch` exhaustivo. Se publicó sin periodo de convivencia porque no hay
consumidor vivo todavía. **Cuando lo haya, esa vía se cierra**: una versión no
aditiva pasará a necesitar bandera por negocio y ventana de migración.

### 7.4 SSO del administrador

El administrador entra desde cuadrecaja; su contraseña nunca llega aquí. El POS
firma una aserción corta con `SSO_JWT_SECRET` y enlaza a:

```
https://<dominio>/admin/sso?token=<jwt>
```

El `jti` se consume, así que el enlace no se puede reusar desde el historial ni
compartiéndolo. Son dos sistemas de autenticación distintos a propósito
([ADR 0005](adr/0005-dos-sistemas-de-auth.md)): el del admin y el del comprador
no se mezclan.

### 7.5 El techo de catálogo por tienda (F-014)

**100 000 filas `StoreProduct` vivas por tienda, con aviso a 50 000.** Por
encima de eso, `GET /api/internal/reconciliation` deja de tener el margen de
memoria medido para esa petición (`.agent/specs/F-014/architecture.md`
§ Escalabilidad y límites): a ~1,3 KB de heap por fila, 100 000 filas son
~130 MB de pico dentro de una función que en Vercel tiene un techo de memoria
fijo. Hoy la tienda más grande de la base local tiene 30 productos vivos, tres
órdenes de magnitud por debajo. Si algún negocio se acerca al aviso, el plan B
—sin cambiar el contrato— es mover el cómputo del hash a un `$queryRaw` dentro
de Postgres; no se implementa mientras el dato real siga tan lejos del techo.

---

## 8. Poner una tienda en el aire ⟳

1. El negocio existe (lo creó `mint:token`, §7.1).
2. Las tiendas y el catálogo llegan **por el sync**, no se cargan a mano.
3. La tienda tiene que estar publicada: es un opt-in del local
   (`publicarEnTienda` del lado de cuadrecaja) más el estado en este lado.
4. El slug se resuelve por el registro de slugs
   ([ADR 0018](adr/0018-registro-de-slugs-y-slug-canonico.md)). Para comprobar
   uno antes de fijarlo: `GET /api/internal/slug-availability`.

---

## 9. Comprobar que quedó bien

En este orden, porque cada uno descarta una capa:

```bash
curl -s https://<dominio>/api/internal/orders            # sin token → 401, nunca 200
curl -s -H "Authorization: Bearer <token>" \
     https://<dominio>/api/internal/orders               # → 200 con { orders, nextCursor }
curl -s https://<dominio>/sitemap.xml | head             # ¿el dominio es el correcto?
curl -s https://<dominio>/<slug> | grep -c 'producto'    # la tienda se lee sin JavaScript
```

Y las dos que no se ven con `curl`, que es justo la lección que dejó F-019:

- **Abrir una tienda en un navegador real.** `curl` no ejecuta JavaScript, no
  manda cabecera `Origin` y no pinta píxeles. Un feature puede tener sus diez
  criterios en verde y devolver 403 en cualquier navegador; ya pasó.
- **Hacer un pedido de prueba de punta a punta** y comprobar que el enlace de
  WhatsApp que llega apunta a tu dominio (§4).

---

## 10. Rotar y mantener ⟳

- **Token de un negocio**: `npm run mint:token -- <externalId>` otra vez. Efecto
  inmediato, aislado a ese negocio, y hay que entregar el valor nuevo.

  **⚠ Rotar corta el sync de ese negocio hasta que cuadrecaja guarde el valor
  nuevo.** `Business.syncTokenHash` es una columna, así que el token viejo deja
  de resolver **en el mismo instante** en que se escribe el nuevo: no hay
  solape posible. Durante la ventana, el outbox de ese negocio se acumula
  —`intentos++`, se recupera solo— y sus pedidos no se recogen. Nada se pierde,
  pero la tienda queda con precios y disponibilidad rancios mientras dure.

  Por eso, salvo que el token esté comprometido y haya que cortar **ya**: avisa
  primero al equipo de cuadrecaja, acuña con alguien al otro lado listo para
  guardarlo, y comprueba después con el `curl` autenticado de §9. Si es un
  incidente, rota primero y avisa mientras: la ventana es el precio de cerrar la
  fuga.

- **`SSO_JWT_SECRET`**: se cambia **a la vez** en los dos lados o el admin deja
  de poder entrar.
- **`CRON_SECRET`**: al cambiarlo, los crons empiezan a dar 401 y **nada avisa**.
  Compruébalos a mano después de rotarlo.
- **`ADMIN_SESSION_SECRET`**: cerrar sesión a todos los administradores es el
  efecto esperado, no un fallo.
