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

## 4. El timbre de Realtime (F-020)

Opcional para cuadrecaja — quien no lo implemente sigue funcionando con su
cron de 2 minutos (ver [`sync-contract.md`](sync-contract.md) § «El timbre
del canal `negocio:`»). Pero si se quiere, cinco pasos:

1. Habilitar Realtime en el proyecto de Supabase (viene activado por defecto
   en uno nuevo; comprobar en el panel si es uno antiguo).
2. Pegar `docker/realtime-policies.sql` una vez en el editor SQL del
   proyecto — el mismo archivo, palabra por palabra, que `realtime-init`
   aplica en local (architecture.md DA4, riesgo 2: «el archivo de política
   es el mismo en los dos sitios; lo que se verifica en local es exactamente
   lo que se pega en el panel»).
3. **⚠ Desactivar «Allow public access» en Realtime Settings.** Sin este
   paso, la documentación de Supabase advierte que un canal privado no es
   privado de verdad — es lo que hace que la política del paso 2 sea la
   única puerta.
4. `SUPABASE_JWT_SECRET` en el entorno (§5, tabla) — el _JWT Secret_ del
   proyecto, copiado del panel. Sin él, el endpoint de credencial
   (`POST /api/internal/realtime/credential`) responde
   `503 REALTIME_NOT_CONFIGURED` y el POS sigue funcionando con su cron; no
   bloquea ningún pedido.
5. Vigilar el pico de conexiones concurrentes: ~$10 por cada 1.000
   ([ADR 0014](adr/0014-timbre-de-realtime.md)). Con dos pestañas por
   negocio, el plan Free aguanta ~100 negocios y el Pro ~250 antes de que la
   factura empiece a crecer.

**⚠ Modo de falla si el paso 2 o el 3 se saltan.** Sin la política aplicada,
RLS deniega a todo el mundo — falla **cerrado**, no abierto: nadie oye el
timbre, y el sistema entero degrada a solo cron, exactamente el
comportamiento de antes de F-020. Es ruidosamente inofensivo, y por eso
nadie se entera hasta que alguien pregunta por qué el POS tarda dos minutos
en enterarse de un pedido en vez de segundos.

**Rotar `SUPABASE_JWT_SECRET` invalida la anon key y la service key a la
vez** (son las tres firmadas con el mismo secreto): coordínalo como una
ventana de mantenimiento, no como un cambio de una línea.

---

## 5. Los secretos, y qué rompe cada uno

Todos van en el entorno del despliegue. `.env.example` los lista con su formato.

| Variable                     | Para qué                                                                | Si falta o está mal                                                                      |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | La app en marcha                                                        | No arranca                                                                               |
| `DIRECT_URL`                 | Migraciones                                                             | `db:deploy` falla                                                                        |
| `SSO_JWT_SECRET`             | ↔ Verifica el token de entrada del admin                                | El admin no puede entrar; se registra el motivo en el log                                |
| `ADMIN_SESSION_SECRET`       | Firma la sesión local del admin                                         | La sesión no se puede crear                                                              |
| `CRON_SECRET`                | Autoriza los crons                                                      | Los crons responden 401 y **nada avisa**: el reloj deja de correr                        |
| `SUPABASE_*`                 | Imágenes y cuenta del comprador                                         | Ver §2 y §3                                                                              |
| `SUPABASE_JWT_SECRET`        | Firma la credencial de suscripción al timbre                            | El endpoint responde `503 REALTIME_NOT_CONFIGURED`; ver §4                               |
| `PROVISIONING_SECRET_SHA256` | ↔ Verifica el secreto con el que cuadrecaja da de alta negocios (F-034) | `POST /api/provisioning/credential` responde `503 PROVISIONING_NOT_CONFIGURED`; ver §8.1 |
| `NEXT_PUBLIC_SITE_URL`       | **Ver abajo — es el más fácil de dejar mal**                            |                                                                                          |

**`NEXT_PUBLIC_SITE_URL` merece su propio párrafo.** No es cosmético: de él
salen el `sitemap.xml`, la URL canónica de cada tienda y —lo que más duele— **el
enlace al pedido que el comprador recibe por WhatsApp**. Si apunta al dominio
equivocado, el sistema funciona, los tests pasan, y cada comprador recibe un
enlace a un sitio que no es el tuyo. Compruébalo mirando un enlace real, no la
variable.

`SSO_JWT_SECRET` tiene que valer **lo mismo** aquí y en cuadrecaja: es lo que
firma la aserción de identidad. `ADMIN_SESSION_SECRET` es solo de este lado y no
se comparte con nadie.

`PROVISIONING_SECRET_SHA256` es distinto de los dos anteriores: lo que
cuadrecaja guarda **no** es lo mismo que queandabuscando guarda. cuadrecaja
guarda el secreto **en claro**; queandabuscando guarda solo su **SHA-256**
(R9 de `.agent/specs/F-034/spec.md`) — un volcado de esta configuración no
permite llamar a la ruta de aprovisionamiento. El par de comandos para
generar los dos valores está en §8.1.

---

## 6. Los crons

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

## 7. ⚠ Lo que ningún guion comprueba

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
4. **Aplicar la política RLS de Realtime en el editor SQL del proyecto** (§4,
   paso 2). Sin ella, RLS deniega a todo el mundo — falla **cerrado**, no
   abierto: nadie oye el timbre, y el sistema entero degrada a solo cron.
5. **Comprobar una vez, en un preview, que el ICU del runtime trae el juego
   completo de zonas horarias** (F-022, `AP2`). `Store.timezone` se valida
   contra `Intl.supportedValuesOf("timeZone")`, y una lista recortada
   rechazaría zonas legítimas en vez de mentir en silencio. El CI ya cubre la
   mitad que puede — un test afirma que el default (`America/Havana`) está en
   la lista y que la lista pasa de 300 entradas —, pero corre en la máquina
   del runner, que no es la que sirve las peticiones. Medido aquí para tener
   contra qué comparar: en este repo, Node 24.13.1 con ICU 78.2 devuelve
   **418** zonas e incluye `America/Havana`. Si el runtime de despliegue trae
   menos, es una pregunta nueva para el humano, no un ajuste silencioso.
6. **Una regla de firewall de Vercel por IP sobre `/api/provisioning/*`**
   (F-034, `.agent/specs/F-034/architecture.md` § Escalabilidad y límites).
   No hay límite de tasa en el código —el rechazo del guard ya cuesta cero
   sentencias contra la base, y el secreto son 256 bits, así que la fuerza
   bruta no está en el modelo de amenaza— y esta regla es la mitigación
   recomendada en su lugar, con el mismo precedente que la del punto 1: una
   defensa que no se despliega con el código y que ningún sensor puede
   afirmar.

---

## 8. ↔ Integrar con cuadrecaja

El principio que ordena todo: **el POS inicia todas las llamadas**
([ADR 0002](adr/0002-el-pos-inicia-todas-las-llamadas.md)). queandabuscando
nunca llama a cuadrecaja.

### 8.1 Acuñar el token de cada negocio ⟳

**El token es por negocio, no un secreto de plataforma.** Desde F-034 hay dos
vías para conseguirlo — la primera es la normal, la segunda es de rescate.

#### Vía normal: `POST /api/provisioning/credential`

El superadministrador de cuadrecaja la llama, una vez por negocio, sin que
ningún desarrollador de queandabuscando tenga que abrir una terminal. Antes
de que puedan usarla, este lado necesita el secreto de aprovisionamiento
configurado (§5, tabla de secretos):

```bash
# 1. El secreto en claro — se reparte a cuadrecaja UNA sola vez, por un canal
#    que no sea este repositorio.
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"

# 2. Su SHA-256 hex — lo que va aquí, en PROVISIONING_SECRET_SHA256.
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1], 'utf8').digest('hex'))" '<pega aquí el secreto del paso 1>'
```

queandabuscando guarda solo el hash del paso 2 (R9 de `.agent/specs/F-034/spec.md`
— un volcado de esta configuración no permite llamar a la ruta); cuadrecaja
guarda el valor en claro del paso 1. Con eso configurado, cuadrecaja hace:

```bash
curl -X POST https://<dominio>/api/provisioning/credential \
  -H "authorization: Bearer <secreto del paso 1>" \
  -H 'content-type: application/json' \
  -d '{"externalId":"<Negocio.id>","name":"<nombre, opcional>"}'
```

Crea el `Business` si no existía y acuña su token, devolviéndolo en claro
**una sola vez** (`docs/sync-contract.md` § «Aprovisionamiento de negocios»
tiene el cuerpo, las dos respuestas y la tabla de códigos completa). Es
**idempotente y nunca rota**: repetir la llamada sobre un negocio que ya
tiene token no cambia nada y no devuelve ningún token — si cuadrecaja pierde
el valor, la vía de rescate de abajo es la única salida.

**⚠ El secreto tiene que tener 32 caracteres o más.** La ruta reutiliza el
mismo lector de cabecera `Bearer` que el sync (`readBearerToken`,
`src/lib/syncAuth.ts`), que impone ese mínimo. Un secreto **correcto pero más
corto de 32 caracteres** responde `401 UNAUTHORIZED`, no `503` — el mismo
código que un secreto simplemente equivocado, así que si acabas de configurar
uno y ves `401` en vez del `503` de «no configurado», mide su longitud antes
de sospechar de otra cosa. Los 36 bytes aleatorios del paso 1 de arriba dan
48 caracteres, muy por encima del mínimo.

#### Vía de rescate: `npm run mint:token`

```bash
npm run mint:token -- <externalId>
```

- Si ese `externalId` no existe, crea el negocio.
- Si existe, **rota** su token: el viejo deja de valer al instante y ningún otro
  negocio se ve afectado. Es la **única** forma de rotar — la ruta de arriba
  nunca lo hace.
- **El valor en claro se imprime una sola vez y no se guarda en ningún sitio**:
  solo su SHA-256 va a la base. Si se pierde, se vuelve a acuñar; no se puede
  recuperar.

Necesita `DATABASE_URL` de producción en la terminal de quien lo ejecuta, así
que sigue siendo el camino más lento — pero es el único que puede **rotar**,
y por eso no desaparece (R18 de `.agent/specs/F-034/spec.md`).

Cualquiera de las dos vías: el valor en claro se entrega al equipo de
cuadrecaja, que lo guarda en la configuración **de ese negocio**, no en una
variable global.

**Mientras ningún negocio tenga token acuñado, `/api/internal/*` responde 503**,
nunca 200. Un token ausente jamás significa «deja pasar todo». Si al integrar
ves 503 en todo, es esto.

### 8.2 Lo que cuadrecaja tiene que construir

No lo repito aquí porque viviría desactualizado: está en
[`sync-contract.md`](sync-contract.md) § «Cambios requeridos en cuadrecaja» —
las columnas nuevas, las dos tablas nuevas (`OutboxEvento`, `PedidoEntrante`),
el índice parcial de divergencia con `CREATE INDEX CONCURRENTLY`, el cron de
sincronización **cada 2 minutos** y el de reconciliación diario.

### 8.3 ⟳ Publicar una versión del contrato

Cada cambio en `sync-contract.md` se coordina con el otro equipo y **mueve la
versión de su primera línea**, aunque sea una menor (§ «Versionado de este
documento» del contrato): mayor si cambia lo que el POS envía o recibe, menor si
solo aclara lo ya acordado. La versión vigente es la **v10** (F-034): abre una
octava ruta, `POST /api/provisioning/credential`, y por eso es mayor — pero es
**aditiva**, ninguna de las siete rutas de sync cambia de forma ni de
significado, y un token acuñado antes de la v10 sigue valiendo igual.

No todas las mayores anteriores lo fueron. La v6 (F-031) **no fue aditiva en
dos cosas**: `POST /orders/status` responde `409` al despachar un pedido con
el envío sin cotizar —la primera guarda de transición del contrato, y
retracta la línea de la v5 que decía que no había ninguna—, y todos los
importes del payload del pull pasan a traer dos decimales, que es un arreglo
de un formato que el documento llevaba mal desde la v2. La v5 tampoco fue
aditiva, en el enum de estados de pedido: pasó de 6 a 9 valores.

Las tres se publicaron sin periodo de convivencia porque no hay consumidor vivo
todavía. **Cuando lo haya, esa vía se cierra**: una versión no aditiva pasará a
necesitar bandera por negocio y ventana de migración.

La v6 se publicó además **antes** de estar implementada aquí, a propósito, para
que cuadrecaja empezara en paralelo; su tercera línea lo dice y enumera qué no
responde todavía. Si publicas otra así, mantén ese aviso al día: es lo único que
impide que el otro equipo depure contra un endpoint que no existe. La lista corta
de lo que les toca implementar está en
[`traspaso-cuadrecaja-envio-cotizado.md`](traspaso-cuadrecaja-envio-cotizado.md).

### 8.4 SSO del administrador

El administrador entra desde cuadrecaja; su contraseña nunca llega aquí. El POS
firma una aserción corta con `SSO_JWT_SECRET` y enlaza a:

```
https://<dominio>/admin/sso?token=<jwt>
```

El `jti` se consume, así que el enlace no se puede reusar desde el historial ni
compartiéndolo. Son dos sistemas de autenticación distintos a propósito
([ADR 0005](adr/0005-dos-sistemas-de-auth.md)): el del admin y el del comprador
no se mezclan.

### 8.5 El techo de catálogo por tienda (F-014)

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

## 9. Poner una tienda en el aire ⟳

1. El negocio existe (lo creó `POST /api/provisioning/credential` o, como
   vía de rescate, `mint:token` — §8.1).
2. Las tiendas y el catálogo llegan **por el sync**, no se cargan a mano.
3. La tienda tiene que estar publicada: es un opt-in del local
   (`publicarEnTienda` del lado de cuadrecaja) más el estado en este lado.
4. El slug se resuelve por el registro de slugs
   ([ADR 0018](adr/0018-registro-de-slugs-y-slug-canonico.md)). Para comprobar
   uno antes de fijarlo: `GET /api/internal/slug-availability`.
5. **La configuración de compra llega por el sync, la escribe cuadrecaja.**
   Las cinco columnas que deciden cómo se compra —`checkoutMode`,
   `deliveryEnabled`, `deliveryFee`, `deliveryFeeMode` y `orderExpiryHours`—
   viajan planas y opcionales en el `payload` de `STORE` desde la v7 del
   contrato (F-032, [ADR 0028](adr/0028-configuracion-de-compra-del-pos.md)).
   No hay pantalla que las exponga: el panel sigue sin tocarlas, a propósito
   (ADR 0017 (a)). Un evento que omite una de las cinco deja esa columna
   **exactamente como estaba** — "omitir no es apagar" —, y la guarda
   anti-rancio (`Store.sourceUpdatedAt`) es el único árbitro cuando llegan
   dos versiones: sin marca de "configurada a mano" ni forma de liberarla, el
   primer envío del POS que traiga un campo pisa lo que hubiera antes, por
   ese motivo escribirla a mano por SQL ya no es el camino — mientras
   cuadrecaja no la emita para un negocio, esa tienda simplemente se comporta
   con los valores por defecto de la columna hasta que el POS la alcance.
6. **⚠ La zona horaria de la tienda se cambia a mano mientras el panel no
   tenga editor (F-022; el editor es F-011).** `Store.timezone` es un
   identificador IANA (`America/Havana`, `America/New_York`,
   `Europe/Madrid`…), es del panel de administración —el POS nunca la
   manda— y por defecto **todas** las tiendas nacen en `America/Havana`. Un
   negocio en otro huso hay que corregirlo al darlo de alta:

   ```sql
   UPDATE "Store" SET timezone = 'America/New_York' WHERE id = '<storeId>';
   ```

   Tiene que ser un valor que `Intl.supportedValuesOf("timeZone")` reconozca
   tal cual, sensible a mayúsculas (`america/new_york` o `EST5EDT` no
   sirven, aunque `Intl` los acepte para otros usos) — si no, la tienda deja
   de poder publicarse o republicarse (`STORE_TIMEZONE_INVALID`) hasta que se
   corrija. El horario de apertura (`openingHours`, del sync) se lee **en
   esta zona**, así que cambiarla cambia cómo se interpreta el calendario
   desde ese momento, nunca hacia atrás.

---

## 10. Comprobar que quedó bien

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
  WhatsApp que llega apunta a tu dominio (§5).

---

## 11. Rotar y mantener ⟳

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
  guardarlo, y comprueba después con el `curl` autenticado de §10. Si es un
  incidente, rota primero y avisa mientras: la ventana es el precio de cerrar la
  fuga.

- **`SSO_JWT_SECRET`**: se cambia **a la vez** en los dos lados o el admin deja
  de poder entrar.
- **`CRON_SECRET`**: al cambiarlo, los crons empiezan a dar 401 y **nada avisa**.
  Compruébalos a mano después de rotarlo.
- **`ADMIN_SESSION_SECRET`**: cerrar sesión a todos los administradores es el
  efecto esperado, no un fallo.
