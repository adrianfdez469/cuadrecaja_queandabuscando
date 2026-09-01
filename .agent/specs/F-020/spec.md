---
feature: F-020
agente: sdd-spec
actualizado: 2026-09-01T04:33:47Z
estado: listo
---

## Problema

Hoy el encargado se entera de un pedido en el siguiente ciclo de pull (cada dos
minutos), y para entonces el comprador ya no está atento a la conversación que
tiene que confirmar. [ADR 0014](../../../docs/adr/0014-timbre-de-realtime.md)
decide la salida: queandabuscando emite un **timbre sin datos** en un canal de
Supabase Realtime, el navegador del encargado lo oye y dispara el pull de
inmediato. El pedido sigue viajando por `GET /api/internal/orders`, y el cron
sigue corriendo: el timbre adelanta la lectura, no la sustituye.

## Alcance

### Dentro

- Emisión de un **Broadcast** en el canal `negocio:{businessId}` en dos momentos,
  y solo en esos dos: al crear un pedido y al resolver el comprador una propuesta
  de renegociación de F-019 (aprobarla o rechazarla).
- **Coalescencia** por negocio con ventana de 5 segundos: una ráfaga es un
  timbre, no uno por pedido.
- **Autorización del canal** con RLS sobre `realtime.messages`, de forma que un
  suscriptor del negocio B no oiga el timbre del negocio A.
- **La credencial de suscripción**: el POS obtiene, con el bearer por negocio que
  ya tiene, un token acotado a su canal. Sin esto el criterio 2 no es verificable
  contra un suscriptor real y el timbre no es usable en producción (ver I9).
- **El servicio de Realtime en `docker-compose.yml`**, para verificar los
  criterios 1, 2 y 4 contra un suscriptor de verdad y no leyendo código.
- La **aclaración aditiva** en `docs/sync-contract.md`, sin bump de versión.

### Fuera (explícito)

- **El pedido no viaja por el canal.** Cero datos, cero PII: el payload es una
  constante. La entrega sigue siendo `GET /api/internal/orders`.
- **El cliente que escucha**, que vive en el repositorio de cuadrecaja.
- **El cron de pull no se quita, ni se alarga su período.**
- **Postgres Changes**: descartado en la ADR, no se evalúa.
- **Los demás cambios de estado no timbran**: ni el vencimiento de una propuesta
  por reloj, ni una cancelación del comprador que no sea la respuesta a una
  propuesta, ni un carrito convertido, ni nada que reporte el propio POS por
  `POST /api/internal/orders/status` (lo hizo él, ya lo sabe).
- **Notificaciones al comprador** por cualquier vía.
- **El panel de administración de queandabuscando** no escucha este canal.
- **Postgres Changes, replicación lógica y el `wal_level` que exija el servicio**
  son detalle de despliegue, no comportamiento: se decide en arquitectura.

## Actores y precondiciones

| Actor                      | Papel                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| Comprador                  | Crea el pedido, o responde a una propuesta. Nunca ve el timbre           |
| queandabuscando (servidor) | **Emite** el timbre después de escribir en su propia base                |
| Navegador del encargado    | **Escucha** el canal de su negocio y dispara el pull. Vive en cuadrecaja |
| Supabase Realtime          | Transporta el Broadcast y evalúa la RLS del canal                        |
| Cron del POS               | Sigue pulleando cada 2 minutos, timbre o no timbre                       |

Precondiciones: proyecto Supabase con Realtime habilitado (y, en local, el
servicio levantado con `docker compose up -d`); el negocio existe y tiene su
bearer acuñado (`npm run mint:token -- seed-negocio-1`); el pedido lleva su
`businessId` denormalizado, que es lo que ya usa el pull
(`prisma/schema.prisma:570`, `src/features/orders/server/pull.ts:100`).

Ninguna de esas precondiciones es necesaria para **crear** un pedido: si
cualquiera falta, el sistema se comporta como hoy (R2, R9).

## Comportamiento esperado

**E1 — Un pedido nuevo timbra.** Dado un pedido del negocio A creado por
`POST /api/orders`, cuando la fila ya está escrita, entonces se emite un
Broadcast en el canal `negocio:{A}` con el payload constante de § Datos y
contrato, y ese payload no contiene `code`, `total`, importes, `id`, teléfono,
nombre, dirección ni correo.

**E2 — El timbre nunca se adelanta a la fila.** Dado que el timbre acaba de
sonar, cuando el POS pullea inmediatamente después, entonces el pedido que causó
el timbre está en la respuesta. Un timbre emitido antes de que la escritura sea
visible haría que el POS leyera vacío y no volviera a enterarse hasta el cron: no
se admite.

**E3 — Aislamiento por negocio.** Dado un suscriptor autenticado como negocio B,
cuando el negocio A recibe un pedido, entonces B no recibe absolutamente nada en
ningún canal.

**E4 — Un suscriptor sin credencial no oye nada.** Dado un cliente que se
suscribe a `negocio:{A}` con la clave anónima y sin credencial de negocio, cuando
A recibe un pedido, entonces la suscripción no se autoriza y el cliente no recibe
ningún mensaje.

**E5 — Realtime caído no rompe nada.** Dado que Realtime es inalcanzable (el
servicio parado, o la URL apuntando a una dirección que no responde), cuando se
crea un pedido, entonces `POST /api/orders` responde `201` igual que siempre, el
pedido aparece en el siguiente `GET /api/internal/orders` y en el registro del
servidor queda constancia del fallo de emisión.

**E6 — Realtime colgado tampoco retrasa.** Dado que la dirección de Realtime no
responde (se traga la conexión en vez de rechazarla), cuando se crea un pedido,
entonces la respuesta de `POST /api/orders` llega dentro del margen de R3 medido
contra la misma petición con Realtime sano.

**E7 — El primer evento timbra ya.** Dado un negocio que no ha timbrado en los
últimos 5 segundos, cuando llega un evento, entonces el timbre se emite sin
esperar a nada: el suscriptor lo recibe dentro de los 2 segundos siguientes a que
`POST /api/orders` haya respondido.

**E8 — La ventana es fija, con timbre de entrada y timbre de cierre.** Dado el
evento del E7, que abrió una ventana `[t0, t0+5 s)` para ese negocio, cuando
llegan más eventos del mismo negocio dentro de esa ventana, entonces **ninguno**
timbra en el momento; y al cerrarse la ventana se emite **un** timbre de cierre
si hubo al menos uno, que a su vez abre la ventana siguiente `[t0+5 s, t0+10 s)`.
Si no hubo ninguno, no se emite nada y el negocio queda sin ventana abierta.

**E9 — El pedido del segundo 4,9 no se pierde.** Dado un evento que llega a 4,9 s
de abierta la ventana, entonces no timbra en el momento y **sí** queda cubierto
por el timbre de cierre, que llega como mucho 0,1 s después. Enunciado como
propiedad: entre un evento y el timbre que lo cubre nunca pasan más de 5
segundos, y ningún evento se queda sin timbre.

**E10 — La ráfaga es un timbre, o dos.** Dados 10 pedidos del negocio A creados
en menos de 5 segundos, entonces el suscriptor recibe **como mucho 2** mensajes
(el de entrada y el de cierre), nunca 10.

**E11 — Techo por negocio.** Dado cualquier tráfico, entonces un negocio no
recibe más de un timbre cada 5 segundos: como mucho 13 en un minuto, pase lo que
pase. El ritmo del canal no depende del ritmo de los pedidos.

**E12 — Aprobar una propuesta timbra.** Dado un pedido en `AWAITING_CUSTOMER`,
cuando el comprador aprueba desde `POST /[slug]/pedido/[code]/respuesta` y la
escritura se aplica de verdad (`applied`), entonces se emite un timbre en el
canal del negocio de ese pedido, con el mismo payload que el de E1.

**E13 — Rechazar también timbra.** Igual que E12 con `decision=rechazar`.

**E14 — Repetir la misma decisión no timbra.** Dado un pedido cuya propuesta ya
fue aprobada (o rechazada), cuando llega otra vez la misma respuesta y el
servidor contesta el 200 idempotente sin escribir nada, entonces **no** se emite
ningún timbre. Sin cambio de estado no hay novedad que leer.

**E15 — El reloj no timbra.** Dada una propuesta que vence sin respuesta y la
cancela el barrido (el cron o el propio pull), entonces **no** se emite ningún
timbre: lo resolvió el reloj, no el comprador. El POS se entera en su siguiente
ciclo, que es exactamente lo que ADR 0014 llama degradar con gracia.

**E16 — Un pedido que no se crea no timbra.** Dado un `POST /api/orders` que
termina en `200` idempotente (misma `idempotencyKey`), o en `400`, `404`, `409` o
`429`, entonces no se emite ningún timbre: no hay fila nueva que pullear.

**E17 — Timbrar sin oyentes es normal, no un error.** Dado que ninguna pestaña
está suscrita al canal del negocio, cuando se crea un pedido, entonces el timbre
se emite igual, se pierde, y nada falla ni se reintenta. El pedido llega por el
cron.

**E18 — El POS obtiene su credencial pidiéndola.** Dado el bearer por negocio que
el POS ya usa en `/api/internal/*`, cuando lo presenta en el endpoint de
credencial de suscripción, entonces recibe un token acotado a **su** canal y un
instante de expiración explícito; con el bearer del negocio B ese token nunca
autoriza `negocio:{A}`. queandabuscando no llama a nadie para entregarlo: lo pide
el POS, como todo lo demás ([ADR 0002](../../../docs/adr/0002-el-pos-inicia-todas-las-llamadas.md)).

**E19 — Qué hace el POS al oír el timbre.** Dado un timbre recibido, entonces el
lector hace dos lecturas y no una: (a) su pull incremental con su cursor, que le
trae los pedidos nuevos, y (b) una relectura de los pedidos que tenga en
`AWAITING_CUSTOMER`, porque el pull filtra por `id > since`
(`src/features/orders/server/pull.ts:108`) y la resolución de una propuesta
ocurre sobre un pedido que ya pulleó. Sin (b), el timbre del E12/E13 dispara un
pull que responde `{ orders: [], nextCursor: null }` (ver I6).

**E20 — Varias pestañas, un solo pull.** Dadas N pestañas de cuadrecaja suscritas
al mismo negocio, entonces las N reciben el timbre, y el POS mantiene **un solo
pull en vuelo por negocio**: la regla de `docs/sync-contract.md` § ③④ («este
endpoint asume un único poller por negocio, secuencial») sigue siendo suya y el
timbre la vuelve mucho más fácil de violar (ver I7).

**E21 — El timbre no es una llamada al POS.** Dado cualquier estado del sistema,
entonces `grep -rn "CUADRECAJA_API_URL" src/` sigue sin devolver nada y no
aparece ninguna variable de entorno con la URL ni con un secreto de cuadrecaja:
el timbre entra en Supabase, no sale hacia el POS.

## Reglas de negocio

- **R1 — Payload constante y sin datos.** Un solo campo, valor fijo. Nada
  derivado del pedido: ni identificadores, ni importes, ni contacto, ni cuántos
  pedidos hay. Quien lea el payload no aprende más que «hay algo que leer».
- **R2 — Emitir nunca falla la escritura.** Ningún fallo de Realtime —caída,
  cuota agotada, credencial inválida, timeout— cambia el código de respuesta de
  `POST /api/orders` ni el de la ruta de respuesta a la propuesta, ni deja el
  pedido a medias.
- **R3 — Emitir nunca retrasa la escritura más de un tope explícito.** El tope
  vive en `src/constants/` como constante nombrada, igual que
  `ORDER_CUSTOMER_LINK_TIMEOUT_MS` (`src/constants/account.ts:48`), y se mide
  contra una dirección que no responde, no contra una que rechaza.
- **R4 — Broadcast, no Postgres Changes.** Decisión de ADR 0014; no se reabre.
- **R5 — Un negocio solo puede suscribirse a su canal**, y quien lo impide es una
  política RLS sobre `realtime.messages`, no una convención del cliente.
- **R6 — El timbre va después del commit**, nunca antes (E2).
- **R7 — Solo dos disparadores**: pedido creado y propuesta resuelta por el
  comprador. Cualquier otro cambio de estado no timbra (E15, E16).
- **R8 — Solo timbra el cambio efectivo.** Una respuesta idempotente que no
  escribe nada no timbra (E14).
- **R9 — El timbre está fuera de la ruta crítica.** Ningún componente depende de
  que suene: el cron de pull se queda, y con Realtime apagado el sistema entero
  se comporta como antes de F-020, solo que más lento en avisar.
- **R10 — Coalescencia por negocio, ventana fija de 5 s, con timbre de entrada y
  de cierre** (E7–E11). Es un requisito del sistema completo, medido desde el
  suscriptor: no vale que se cumpla solo cuando todas las peticiones caen en el
  mismo proceso (ver I5).
- **R11 — El canal no es una vía de entrega.** El POS nunca deriva estado del
  timbre: cuenta pedidos, importes y estados solo desde el pull. Un timbre
  perdido, duplicado o desordenado no cambia ningún dato.
- **R12 — Sin credencial de salida hacia el POS** (E21), que es la invariante de
  ADR 0002 y el criterio 5 del feature.
- **R13 — Nada de `@supabase/*` en el árbol de cliente.** La emisión es de
  servidor; el guardián de `src/features/account/boundaries.test.ts:37` sigue en
  verde y el presupuesto de `npm run check:bundle` no se mueve por este feature.
- **R14 — El timbre no dice cuál de los dos disparadores fue.** Mismo payload
  para los dos, a propósito (R1): por eso el lector hace las dos lecturas de E19.
- **R15 — La credencial de suscripción caduca y se renueva pidiéndola otra vez.**
  Que caduque, o que el POS no la renueve, degrada a «solo cron» (R9); nunca
  bloquea un pedido.
- **R16 — El contrato no sube de versión.** El canal entra en
  `docs/sync-contract.md` como aclaración aditiva, al estilo del «SQL espejo»
  (§ ⑤): un lector de la v5 que no implemente nada de esto sigue siendo correcto,
  porque el timbre solo adelanta una lectura que ya hacía.
- **R17 — Levantar Realtime en local es opcional.** Con el servicio parado,
  `bash .agent/init.sh` sigue terminando en ENTORNO LISTO (avisa, no falla) y la
  tienda y el checkout responden igual, como ya ocurre con Storage y Auth.

## Casos límite y errores

| Caso                                                   | Comportamiento esperado                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Cuota de Realtime agotada                              | Igual que caído (E5): se registra y se sigue. Ningún reintento en la ruta de la petición                         |
| Credencial de emisión inválida o ausente               | Igual que caído. La configuración incompleta no es un error del comprador                                        |
| Nadie escuchando                                       | Se emite y se pierde (E17)                                                                                       |
| Varias pestañas del mismo negocio                      | Todas reciben; el POS serializa su pull (E20, I7)                                                                |
| Reconexión del suscriptor tras perder la red           | El timbre perdido no se recupera: el pull de arranque cubre el hueco                                             |
| Ráfaga repartida entre varias instancias del servidor  | Sigue valiendo R10, medido desde el suscriptor (I5)                                                              |
| Dos respuestas simultáneas a la misma propuesta        | Una escribe y timbra; la otra es idempotente y no timbra (E14)                                                   |
| Pedido de un negocio inactivo o tienda despublicada    | El checkout ya lo rechaza antes de escribir; sin fila no hay timbre (E16)                                        |
| Vencimiento masivo del barrido (N propuestas de golpe) | Cero timbres (E15). El POS se entera en su ciclo                                                                 |
| Reintento del emisor tras un fallo                     | No hay reintento: el timbre es best-effort por definición (R9). Reintentar solo añadiría latencia a la escritura |
| Timbre duplicado por cualquier causa                   | Inocuo: el POS hace un pull de más, que es idempotente por el cursor (R11)                                       |
| Realtime lento pero vivo                               | El tope de R3 corta; el pedido responde igual                                                                    |

## Datos y contrato

**Canal.** `negocio:{businessId}`, donde `businessId` es el `Business.id` que ya
identifica al negocio en el bearer del pull y en `Order.businessId`
(`prisma/schema.prisma:570`). Privado: la suscripción exige credencial.

**Evento y payload.** Un solo evento y un solo payload, constante:

```jsonc
// canal: negocio:seed-negocio-1   ·   evento: "pedidos"
{ "t": "pedidos" }
```

La propuesta previa (`.agent/specs/propuestas/timbre-realtime.md`) sugería
`{ "t": "pedidos-pendientes" }`. Se cambia a `"pedidos"` porque SP2 amplió el
disparador: un timbre puede venir de una propuesta resuelta sobre un pedido ya
pulleado, y llamarlo «pendientes» invitaría al lector a hacer solo el pull
incremental —justo el error de I6—. No hay consumidor vivo al que migrar: el
cliente que escucha todavía no existe en cuadrecaja.

**Credencial de suscripción.** El POS la pide presentando su bearer por negocio,
y recibe un token acotado a su canal con un instante de expiración explícito, de
forma que pueda renovarlo sin adivinar (R15, E18). Es aditivo para el POS: quien
no lo use se queda como está.

**Documentación.** Entra en `docs/sync-contract.md` como sección nueva y
**aclaración aditiva sin bump de versión**, con la misma forma que «El SQL espejo
(aclaración aditiva, sin bump de versión)» de § ⑤. Tiene que decir, como mínimo:
que el canal no transporta datos y no es una vía de entrega (R11); los dos
disparadores (R7); que un timbre puede perderse y el cron sigue siendo la
garantía (R9); las **dos** lecturas que hace el lector al oírlo (E19); y que un
solo pull por negocio sigue en vuelo aunque timbren N pestañas (E20).

**Despliegue.** El paso operativo —habilitar Realtime en el proyecto, aplicar la
política RLS, y vigilar el techo de conexiones concurrentes que ADR 0014 cifra en
~$10 por cada 1.000— se escribe en `docs/despliegue.md` en este mismo ciclo, que
es lo que pide AGENTS.md § Documentación.

## Criterios de aceptación propuestos

Los siete de `features.json`, sin tocar su texto (regla 3), traducidos a algo
ejecutable; y los que faltan, marcados `[nuevo]`. Los que hablan de un suscriptor
real los ejecuta el guion de runtime del feature, .agent/specs/F-020/smoke.sh
(por crear), apoyado en un guion de suscripción reutilizable,
scripts/realtime-bell.mjs (por crear), al estilo de `scripts/renegotiate-order.mjs`.

1. `[existente]` **Broadcast sin datos al crear.** Con `docker compose up -d` y
   la app levantada, el guion se suscribe a `negocio:seed-negocio-1`, hace
   `POST /api/orders` y recibe exactamente un mensaje en 10 s; el mensaje
   serializado no contiene el `code` que devolvió el `201`, ni el `total`, ni el
   teléfono, nombre, correo o dirección enviados, y es igual, campo por campo, al
   payload de § Datos y contrato. Sale 0.
2. `[existente]` **Aislamiento.** El guion abre dos suscriptores, uno con la
   credencial del negocio de `seed-negocio-1` y otro con la de un segundo
   negocio; crea un pedido en el primero; el segundo recibe 0 mensajes en 10 s y
   el primero recibe 1. Sale 0.
3. `[existente]` **Realtime inalcanzable.** Con la URL de Realtime apuntada a una
   dirección de prueba que no responde (`203.0.113.1`, TEST-NET-3),
   `POST /api/orders` responde `201` y `GET /api/internal/orders` con el bearer
   del negocio devuelve ese pedido. Sale 0.
4. `[existente]` **Menos timbres que pedidos.** El guion crea 10 pedidos del
   mismo negocio en menos de 5 s y cuenta los mensajes recibidos en los 60 s
   siguientes: `1 <= recibidos <= 2`. Ver I1: leído al pie de la letra («diez
   pedidos en un minuto»), el criterio es falso contra una implementación
   correcta, así que se verifica la ráfaga, que es lo que quiere decir.
5. `[existente]` **Sin salida hacia el POS.** `grep -rn "CUADRECAJA_API_URL" src/`
   termina en 1 y no imprime nada.
6. `[existente]` **RLS y documentación.** Dos comprobaciones. Una: sobre la base
   a la que apunta Realtime, una consulta a `pg_policies` acotada a
   `schemaname = 'realtime'` y `tablename = 'messages'` devuelve al menos una
   fila. Otra: `grep -n "negocio:" docs/sync-contract.md` encuentra la sección
   del canal. El lado negativo de la RLS lo ejercitan el criterio 2 y el E4.
7. `[existente]` **El sensor.** `bash .agent/verify.sh F-020 --full` termina en 0.
   Ver I2: esa invocación **no** corre el guion de runtime, así que por sí sola
   no verifica 1, 2 ni 4.
8. `[nuevo]` **El timbre llega a tiempo.** Tras un silencio de más de 5 s, el
   suscriptor recibe el timbre dentro de los 2 s siguientes a la respuesta de
   `POST /api/orders`. Es la razón de ser del feature y ningún criterio la mide.
9. `[nuevo]` **Ningún evento se queda sin timbre.** El guion crea un pedido,
   espera 4,9 s, crea otro, y recibe un segundo mensaje antes del segundo 6,0
   contado desde el primero.
10. `[nuevo]` **Los dos disparadores, y solo esos.** En una sola corrida:
    aprobar una propuesta produce un timbre; rechazar otra produce un timbre;
    repetir la misma decisión sobre la ya resuelta responde 200 y produce 0
    timbres; y un vencimiento forzado (`POST /api/crons/expire-proposals` con la
    fecha adelantada, como hace `scripts/renegotiate-order.mjs`) produce 0
    timbres.
11. `[nuevo]` **Emitir no retrasa.** Con la URL apuntada a `203.0.113.1`, la
    mediana de 5 `POST /api/orders` no supera la mediana con Realtime sano más el
    tope de R3.
12. `[nuevo]` **El emulador se levanta y es opcional.** `docker compose up -d`
    dos veces seguidas termina en 0 las dos veces con el servicio de Realtime
    sano; y con ese servicio parado, `bash .agent/init.sh` termina en ENTORNO
    LISTO e imprime el comando para levantarlo, y `/tienda-demo` responde 200.
13. `[nuevo]` **La credencial es del negocio que la pide.** El token obtenido con
    el bearer del negocio B no autoriza la suscripción a `negocio:{A}`: el
    intento no recibe ningún mensaje del pedido de A.
14. `[nuevo]` **Frontera de cliente intacta.** `npm test` sigue en verde con el
    guardián de `src/features/account/boundaries.test.ts` incluyendo el módulo
    emisor en su lista blanca, y `npm run check:bundle` no sube su presupuesto
    por este feature.
15. `[nuevo]` **El paso operativo queda escrito.**
    `grep -n "Realtime" docs/despliegue.md` devuelve al menos una línea.
16. `[nuevo]` **El sensor completo, con runtime.**
    `bash .agent/verify.sh F-020 --full --smoke` termina en 0. Es el criterio 7
    hecho verificable de verdad (I2).
17. `[nuevo]` **Redacción propuesta para el criterio 4**, que el humano puede
    adoptar o no (regla 3): «Diez pedidos del mismo negocio creados en menos de
    cinco segundos producen como mucho dos timbres».

## Incongruencias detectadas

- **I1 — El criterio 4 es falso leído literalmente.** «Diez pedidos en un minuto
  producen menos de diez timbres»: con la ventana de 5 s que decidió el humano
  (SP1), diez pedidos repartidos uniformemente en un minuto caen uno cada 6 s,
  cada uno en silencio, y producen **diez** timbres — correctamente. Lo que el
  criterio quiere decir es la ráfaga. No se toca el texto; se propone el 17.
- **I2 — El criterio 7 no verifica lo que el humano decidió verificar.**
  `verify.sh --full` corre `harness typecheck lint format test prisma build theme
bundle` (`.agent/verify.sh:59`): ni levanta la app, ni corre
  `.agent/specs/<ID>/smoke.sh`, ni sabe de `docker compose`. Los criterios 1, 2 y
  4 solo se verifican con `--smoke`. De ahí el criterio 16.
- **I3 — El criterio 6 revierte una propiedad que F-028 consiguió por
  construcción.** Hoy **ninguna** migración de `prisma/migrations/` menciona
  `realtime.`, `auth.` ni `storage.`, y no hay una sola política RLS versionada;
  el criterio 6 de F-028 —«`npx prisma migrate diff …` no menciona los esquemas
  auth ni storage»— es cierto porque esos esquemas viven en **otras** bases y
  otros contenedores (`.agent/specs/F-028/architecture.md:481`). La autorización
  de un canal privado se evalúa contra `realtime.messages` **en la base del
  inquilino**, es decir en la misma Postgres de la app: F-020 mete el primer
  objeto de esquema Supabase dentro de nuestra base. Súmale que esa tabla la crea
  el propio servicio de Realtime con sus migraciones, así que una migración de
  Prisma que le cuelgue una política depende de que un contenedor haya corrido
  antes. No lo resuelvo aquí —es de `sdd-architect`—, pero la spec exige que la
  decisión quede escrita y que el criterio 12 la ejercite en frío (dos
  `docker compose up -d` seguidos).
- **I4 — La lista blanca de importadores de `@supabase/*` es de otro feature.**
  `src/features/account/boundaries.test.ts:37` enumera cuatro archivos; el módulo
  emisor será el quinto y el test se pone rojo hasta que se añada. No es un
  `acceptance_criteria` (regla 3 no aplica), pero sí es un archivo ajeno que este
  feature tiene que tocar, y conviene que el implementador lo sepa antes de que
  `npm test` se lo diga.
- **I5 — La coalescencia no se puede cumplir con memoria de proceso.** En
  producción hay N instancias efímeras: diez `POST /api/orders` pueden caer en
  diez procesos y emitir diez timbres, mientras en local —un solo `next dev`— el
  criterio 4 sale verde. Es el peor modo de fallo del sensor: verde contra algo
  que en producción es falso. Y [ADR 0015](../../../docs/adr/0015-sin-broker-todavia.md)
  cierra la puerta a un broker, así que el estado compartido tiene que salir de
  lo que ya hay. R10 lo enuncia como requisito del sistema, no del proceso, a
  propósito.
- **I6 — El segundo disparador no llega al POS por el pull incremental.**
  `pullOrders` filtra `id: { gt: since }` (`src/features/orders/server/pull.ts:108`)
  y la resolución de una propuesta ocurre sobre un pedido que el POS ya pulleó
  (id menor que su cursor). Tal cual está, el timbre del E12/E13 dispara un pull
  que devuelve `{ orders: [], nextCursor: null }` y el encargado no ve nada. El
  diagrama de F-019 (`.agent/specs/F-019/architecture.md:403`) sugiere lo
  contrario sin decirlo. Por eso E19 obliga a la relectura de los
  `AWAITING_CUSTOMER` y la aclaración del contrato tiene que escribirlo: el
  payload sin datos no puede decir qué pedido cambió, y eso es deliberado.
- **I7 — El timbre amplifica un peligro ya documentado.**
  `docs/sync-contract.md` § ③④ advierte que dos pollers del mismo negocio en
  paralelo pueden entregar el mismo pedido dos veces, porque el `findMany` y el
  `updateMany` no son atómicos (`src/features/orders/server/pull.ts:255`). Hoy
  eso exige dos crons mal configurados; con el timbre, basta con que el encargado
  tenga tres pestañas abiertas. La aclaración del contrato tiene que exigir un
  solo pull en vuelo por negocio (E20).
- **I8 — `docker-compose.yml` no tiene servicio de Realtime, y añadirlo no es
  gratis.** Hoy levanta postgres, storage-db, storage, supabase-gateway, auth-db,
  auth y mailpit. Realtime necesita su propia configuración de inquilino y, a
  diferencia de Auth y Storage, tiene que ver la base de la app (I3). El humano
  eligió esta opción a sabiendas; R17 y el criterio 12 acotan el daño: opcional
  en local, idempotente al levantarlo.
- **I9 — Nadie ha dicho quién acuña la credencial del suscriptor, y sin ella el
  criterio 2 no existe.** «Un suscriptor autenticado como negocio B» presupone
  una autenticación que hoy no hay: el POS solo tiene un bearer cuyo SHA-256
  guardamos, que no sirve para hablar con Realtime. Como ADR 0002 prohíbe que
  nosotros llamemos al POS, la única forma es que el POS la pida (E18), y la
  incluyo en el alcance porque sin ella el feature no es usable en producción y
  el criterio 2 solo se podría verificar con un token que se acuña a sí mismo el
  guion. **Si el humano prefiere separarla en un feature propio** (regla 4), sale
  de aquí, el criterio 2 se verifica con el token acuñado por el guion y F-020 se
  entrega sin cliente posible en producción; lo digo, no lo decido por él.
- **I10 — La nota de `features.json` sigue diciendo «PREGUNTAS ABIERTAS: SP1 …;
  SP2 …».** Las dos están respondidas en `.agent/progress/F-020.md`. La nota es
  del humano y no la toco; queda anotado para que no confunda a quien lea el
  backlog.

## Huecos y preguntas al humano

Ninguna. Las cuatro que había —SP1 ventana, SP2 segundo disparador, verificación
y contrato— están respondidas y aplicadas. Lo que podría cambiar de opinión al
humano está en I9 (¿la credencial de suscripción entra en F-020 o es feature
aparte?) y en I1/I17 (redacción del criterio 4), y ninguna de las dos bloquea el
diseño: la spec dice qué se observa en ambos casos.

## No decidido a propósito

- **Cómo se emite** (qué cliente de Supabase, desde dónde, con qué clave), **cómo
  se comparte la ventana de 5 s entre instancias** y **dónde se aplica la política
  RLS** — de `sdd-architect`, condicionado por I3 y I5.
- **El TTL exacto de la credencial de suscripción**: la spec solo exige que
  expire, que el instante viaje explícito y que renovarla sea otra petición del
  POS (R15).
- **La configuración del servicio de Realtime en `docker-compose.yml`** (imagen,
  inquilino, `wal_level`, puertos, si cuelga del gateway que ya existe).
- **Cómo suena en la interfaz de cuadrecaja**: es de aquel repositorio.
