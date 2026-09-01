---
feature: F-020
agente: orquestador
actualizado: 2026-09-01T05:08:53Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cuando entre un pedido, el navegador del encargado que tenga cuadrecaja abierto
lo sabrá en menos de dos segundos en vez de en el siguiente ciclo de dos
minutos — y lo mismo cuando un comprador apruebe o rechace una modificación que
el negocio le propuso. Lo que suena es un **timbre sin datos**: un mensaje
constante que solo dice «mira tus pedidos», y que hace que el POS lea por el
mismo `GET /api/internal/orders` de siempre.

Lo que **no** cambia: el pedido sigue viajando solo por el pull, el cron de dos
minutos se queda tal cual, y si Realtime se cae el pedido llega igual, solo más
tarde. Nada de la ruta crítica depende de que el timbre suene.

Para que el POS pueda suscribirse hará falta que pida una credencial acotada a
su canal, presentando el mismo bearer por negocio que ya usa. Eso es trabajo
nuevo para el equipo de cuadrecaja, y es la única parte de este feature que se
lo pide.

## Pasos

Diez pasos. El orden no es negociable en los dos extremos: el emulador va
**primero** porque su forma solo se conoce ejecutándola (riesgo 1 de
`architecture.md`), y la documentación va **última** porque describe lo que los
ocho pasos anteriores dejaron construido.

| Nº  | Qué se hace                                                                                                                                                                                                                               | Archivos                                                                                                                                                               | Criterio que acerca  | Cómo se verifica                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | El emulador de Realtime en local: servicios `realtime-db`, `realtime` y `realtime-init`, sus roles y la política RLS del canal, más el tercer `location` del gateway (con `Host` fijo y `Upgrade`, que es de lo que depende que funcione) | `docker-compose.yml`, `docker/realtime-roles.sql`, `docker/realtime-policies.sql`, `docker/supabase-gateway.conf`                                                      | 12, 6 (mitad RLS)    | `docker compose up -d` **dos veces seguidas**, ambas en 0; `curl` al health del inquilino responde; `pg_policies` sobre `realtime.messages` devuelve ≥1 fila                                  |
| 2   | `SUPABASE_JWT_SECRET` como variable nueva (server-only, opcional en Zod), generada en local por el guion de claves; y el bloque `== Realtime ==` de `.agent/init.sh`, que avisa **sin poner `bad`**                                       | `src/lib/env.ts`, `.env.example`, `scripts/storage-dev-keys.mjs`, `.agent/init.sh`                                                                                     | 12                   | Con el servicio parado, `bash .agent/init.sh` sigue diciendo **ENTORNO LISTO** e imprime el comando para levantarlo; `/tienda-demo` responde 200                                              |
| 3   | La tabla de la ventana de coalescencia: modelo `OrderBellWindow` (una fila por negocio) y su migración aditiva                                                                                                                            | `prisma/schema.prisma`, prisma/migrations/<sello>\_order_bell_window/migration.sql (por crear)                                                                         | 4, 9                 | `npx prisma validate` en 0 y `npm run db:deploy` aplica sin pendientes. **Antes de aplicar: quitar del `migration.sql` los cinco `DROP INDEX` que Prisma propone**                            |
| 4   | La lógica pura: el emisor por `fetch` contra el endpoint REST de Broadcast (nunca lanza), el acuñador del JWT de suscripción, y las constantes (canal, evento, payload, ventana de 5 s, TTL)                                              | `src/lib/realtime/broadcast.ts`, `src/lib/realtime/subscriptionToken.ts`, `src/constants/realtime.ts`                                                                  | 1, 11, 13, 14        | Tests unitarios en el proyecto `server`; `npm run check:bundle` no sube su presupuesto                                                                                                        |
| 5   | La coalescencia en Postgres: reclamo de ventana y cierre, **una sentencia cada uno**, sin `$transaction` (pooler en modo transacción), y el orquestador que nunca rechaza                                                                 | `src/features/orders/server/bell.ts`                                                                                                                                   | 4, 9                 | Un `*.db.test.ts` que **abre la ventana con SQL desde fuera del proceso** y exige que el proceso no timbre — un `Map` de módulo lo pondría rojo; más concurrencia real con dos `PrismaClient` |
| 6   | Los dos disparadores: `after(...)` en las dos rutas, y el `businessId` en los resultados de creación y de resolución de propuesta                                                                                                         | `src/app/api/orders/route.ts`, `src/app/[slug]/pedido/[code]/respuesta/route.ts`, `src/features/orders/server/createOrder.ts`, `src/features/orders/server/respond.ts` | 1, 8, 10, 11         | Tests de las dos rutas; el timbre corre **después** de la respuesta, así que el retraso medido es 0                                                                                           |
| 7   | El endpoint de credencial, envuelto en el `withInternalAuth` que ya existe: el `businessId` sale del bearer y **nunca** del cuerpo                                                                                                        | `src/app/api/internal/realtime/credential/route.ts`                                                                                                                    | 13, 2                | Test de ruta: el bearer de B nunca produce un token para el canal de A; con bearer inválido, 401                                                                                              |
| 8   | El suscriptor de pruebas reutilizable y el guion de runtime del feature, más su enganche en el sensor                                                                                                                                     | `scripts/realtime-bell.mjs`, `.agent/specs/F-020/smoke.sh`                                                                                                             | 1,2,3,4,8,9,10,11,13 | `bash .agent/verify.sh F-020 --full --smoke` en 0                                                                                                                                             |
| 9   | CI: el job `auth` levanta también Realtime y corre el smoke de F-020; y su `grep -vx storage-bucket-init` pasa a excluir **también** `realtime-init`, o el job se pone rojo por un contenedor que terminó bien                            | `.github/workflows/ci.yml`                                                                                                                                             | 16                   | El job en verde en un PR real                                                                                                                                                                 |
| 10  | La documentación: la sección del canal en el contrato (**aditiva, sin bump**), las cinco líneas de despliegue y el `impl.md`                                                                                                              | `docs/sync-contract.md`, `docs/despliegue.md`, `.agent/specs/F-020/impl.md`                                                                                            | 6 (mitad doc), 15    | `grep -n "negocio:" docs/sync-contract.md` y `grep -n "Realtime" docs/despliegue.md` devuelven líneas; `npm run check:harness` en 0                                                           |

## De dónde sale cada paso

| Paso | Línea que lo justifica                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `architecture.md` DA6 (las tres piezas y el `location` del gateway) y DA4 (Realtime corre contra su propia base); spec E4, R4  |
| 2    | `architecture.md` DA5 («hace falta variable nueva») y DA6 (el bloque de `init.sh`); spec R17; decisión AP1 del humano          |
| 3    | `architecture.md` DA3 y § Modelo de datos y migraciones; spec R10 e I5                                                         |
| 4    | `architecture.md` DA1 (emisor por `fetch`, no cliente de Supabase) y DA5 (acuñado del token); spec R1, R2, R11                 |
| 5    | `architecture.md` DA3, incluido su «cómo se verifica que no es memoria de proceso»; spec E7, E8, E9, R10                       |
| 6    | `architecture.md` DA2 (`after()` tras la respuesta); spec E1, E12, E13, E14, E15, E16, R2, R3, R7                              |
| 7    | `architecture.md` DA5; spec E18, R15, criterio 13; decisión del humano sobre I9 («entra en F-020»)                             |
| 8    | `spec.md` § Criterios (el encabezado remite al guion de runtime y al suscriptor reutilizable); `architecture.md` § Componentes |
| 9    | `architecture.md` DA6, último párrafo (la trampa del `grep -vx`); decisión AP3 del humano                                      |
| 10   | `architecture.md` DA7; spec R16 y § Datos y contrato; decisión del humano de que el contrato **no** sube de versión            |

Ningún paso sale de una idea mía: los diez tienen renglón arriba.

## Qué queda fuera

- **El cliente que escucha.** Vive en el repositorio de cuadrecaja. Aquí se
  emite y se documenta; nadie de este lado se suscribe en producción.
- **Que el pedido viaje por el canal.** El payload es una constante. Cero datos,
  cero PII, y no se deriva nada del timbre.
- **Quitar o alargar el cron de pull.** El timbre adelanta la lectura; no la
  sustituye. Es lo que hace que esto degrade con gracia.
- **Postgres Changes.** Descartado en ADR 0014 y no se evalúa.
- **Cualquier otro disparador.** Ni el vencimiento de una propuesta por reloj
  (lo resolvió el reloj, no el comprador), ni una cancelación del comprador que
  no responda a una propuesta, ni un carrito convertido, ni nada que reporte el
  propio POS por `POST /api/internal/orders/status` — lo hizo él, ya lo sabe.
- **Reintentos del emisor y cron de rescate del timbre de cierre.** Si la
  instancia muere, ese timbre se pierde y el pull de dos minutos lo cubre. Un
  timbre perdido es inocuo por diseño.
- **Tocar `pullOrders`.** El hueco de I6 —la propuesta resuelta no vuelve por el
  pull incremental, porque filtra `id > since` sobre un pedido ya pulleado— se
  resuelve **en el contrato**, pidiendo al lector dos lecturas. Cambiar el
  endpoint sería bump de versión, y decidiste que no lo hay.
- **RLS sobre nuestras tablas.** La única política vive en `realtime.messages`,
  que no es una tabla nuestra.
- **Notificaciones al comprador**, y que el panel de administración escuche el
  canal.
- **Una ADR nueva.** `sdd-architect` la declara innecesaria: ADR 0014 ya decide
  lo de fondo. Si quieres constancia escrita de DA4 («la RLS de Realtime se
  aplica fuera de las migraciones»), el número libre es `docs/adr/0027-*` — es
  una consecuencia de 0014, no una decisión que la supere. **Dilo al firmar si
  la quieres**, y la añado como paso 11.

## Riesgos y plan B

**Sí hay cambio en `docs/sync-contract.md`, y hay otro equipo al otro lado.** Es
lo que menos se aprueba de pasada, así que va entero:

- Entra como **sección nueva dentro de § ③④ Pedidos**, aclaración aditiva **sin
  bump**: la versión sigue siendo la 5, igual que hizo «El SQL espejo».
- **Trabajo nuevo para cuadrecaja, si quiere el timbre:** suscribirse al canal,
  canjear su bearer por la credencial y renovarla, hacer **dos** lecturas al oír
  el timbre (el pull incremental **y** una relectura de los `AWAITING_CUSTOMER`),
  y mantener **un solo pull en vuelo por negocio** aunque tenga N pestañas.
- **Trabajo obligatorio para cuadrecaja: ninguno.** Quien no lo use se queda
  exactamente como está, con su cron de dos minutos. Un lector de la v5 sigue
  siendo correcto sin esta sección.
- El riesgo real del punto de las N pestañas: el contrato ya advierte que dos
  pollers en paralelo pueden entregar el mismo pedido dos veces. Hoy eso exige
  dos crons mal configurados; con el timbre basta con tres pestañas abiertas. Por
  eso la sección tiene que decirlo con todas las letras.

Lo demás:

| Riesgo                                                                                                             | Cómo se notaría                                     | Plan B                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| La configuración de Realtime autoalojado (inquilino por subdominio, roles) solo se prueba ejecutándola             | El paso 1 no pasa su puerta                         | Es el primer paso justamente por eso. Salida: `Host` explícito, o exponer el 4000 y apuntar solo el suscriptor de pruebas ahí       |
| El paso de producción (aplicar la política, desactivar «Allow public access») es manual y ningún sensor lo alcanza | Nadie oye nada en producción                        | Falla **cerrado**: sin política, RLS deniega a todos y el cron cubre. Queda escrito en `docs/despliegue.md`                         |
| `after()` recortado por el tope de invocación, perdiendo el timbre de cierre                                       | Un pedido de una ráfaga tarda hasta 2 min           | `maxDuration` literal en las dos rutas; y un timbre perdido es inocuo por diseño                                                    |
| La coalescencia sale verde en local siendo falsa en producción (I5)                                                | No se notaría — es el peor modo de fallo del sensor | Por eso el paso 5 exige el test que abre la ventana **desde fuera del proceso**, que es el único que lo pesca                       |
| Rotar `SUPABASE_JWT_SECRET` invalida anon key y service key a la vez                                               | Todo lo de Supabase deja de autenticar de golpe     | Queda anotado en `docs/despliegue.md`. Salida a futuro: JWKS propio (opción B de AP1), que cambia dónde vive la clave, no el diseño |

**Migración de datos:** ninguna que pueda perder nada. El paso 3 es un
`CREATE TABLE` aditivo sobre una base con datos. **No hace falta ninguno de los
dos comandos prohibidos** (`prisma migrate reset`, `prisma db push`); si el
implementador cree que sí, para y pregunta.

**Una trampa conocida en el paso 3:** `prisma migrate dev` va a proponer
`DROP INDEX` de cinco índices GIN y parciales que no están en el schema. Se
quitan esas líneas del `migration.sql` antes de aplicarlo. Aplicarlo sin mirar no
rompe ningún test: solo deja la búsqueda haciendo scans secuenciales en
producción.

## Coste

Un `sdd-implementer` (los diez pasos son secuenciales y comparten sensor: no se
paralelizan) y uno o dos ciclos de `sdd-tester`.

**De lo que ya funciona se tocan seis archivos:** las dos rutas que ganan el
disparador, los dos módulos de servidor que devuelven el `businessId`, el
`docker-compose.yml` y el job `auth` del CI. Los otros catorce archivos son
nuevos. La frontera de cliente **no** se toca: el emisor usa `fetch`, no
`@supabase/supabase-js`, así que la lista blanca de importadores se queda como
está y no entra ni un byte nuevo de JavaScript al navegador.

**Marcha atrás a mitad:** barata hasta el paso 9. Los pasos 1, 2 y 4 son
aditivos y nadie depende de ellos; el 3 deja una tabla vacía que no estorba; los
pasos 6 y 7 se revierten quitando dos `after(...)` y una carpeta de ruta. Lo
único que no se deshace solo es la sección del contrato del paso 10: si se
publica y luego se retira, cuadrecaja ya la leyó. Por eso va la última.

## Preguntas antes de aprobar

Ninguna. Las nueve que hubo —SP1, SP2, la forma de verificar, la versión del
contrato, I9, I1, AP1, AP2 y AP3— están respondidas y anotadas en
`.agent/progress/F-020.md`.

Lo único que puedes querer añadir al firmar es la ADR opcional de § Qué queda
fuera.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-020 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-01T05:08:53Z — aprobado por el humano: «aprobado»
