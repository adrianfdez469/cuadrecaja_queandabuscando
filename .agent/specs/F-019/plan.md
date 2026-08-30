---
feature: F-019
agente: orquestador
actualizado: 2026-08-30T17:04:37Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cuando la tienda necesite cambiar un pedido antes de confirmarlo —casi siempre
porque el costo de envío se fija al gestionarlo—, podrá proponerle el cambio al
comprador desde cuadrecaja. El comprador verá en su página el total de antes y
el de ahora, con una frase que dice qué cambió, y podrá aceptar o rechazar sin
cuenta y sin JavaScript. Si no responde en 24 horas, el pedido se cancela solo y
el encargado deja de tener medio pedido colgado.

No cambia nada de cómo se hace un pedido hoy, ni cómo se paga, ni qué ve quien
no tiene ninguna propuesta encima de la mesa. No se reserva stock: dos
compradores pueden seguir pidiendo la última unidad, y lo resuelve la
confirmación manual como hasta ahora.

## Pasos

Nueve etapas. Cada una se verifica sola, y las etapas 2 a 6 dejan el árbol en
verde por su cuenta: `bash .agent/verify.sh F-019` al terminar cada una.

| Nº  | Qué se hace                                                                                                                                                                                                     | Archivos                                                                                                                                                                                                                                                                                        | Criterio que acerca | Cómo se verifica                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | **El bug de F-010, primero y solo.** `store.slug` → `store.id`, más dos asertos: uno que comprueba **con qué argumentos** se llama la función mockeada, y otro en el guion de la etapa 8                        | `src/features/orders/server/createOrder.ts`, `src/features/orders/server/createOrder.test.ts`                                                                                                                                                                                                   | 7                   | `npx vitest run --project server src/features/orders/server/createOrder.test.ts`; el aserto nuevo falla antes del arreglo |
| 2   | **Schema y migración.** Tres valores en `OrderStatus`, dos enums nuevos, doce columnas nullable en `Order`, `Store.orderExpiryHours` con `@default(24)`. Ningún índice nuevo                                    | `prisma/schema.prisma`, prisma/migrations/&lt;ts&gt;\_order_renegotiation/migration.sql (por crear)                                                                                                                                                                                             | 1, 3, 5, 9          | `npm run db:migrate`, revisando el SQL **antes** de aplicarlo; luego `bash .agent/verify.sh F-019`                        |
| 3   | **La insignia deja de mentir.** Los tres casos nuevos del `switch` exhaustivo, y `READY` con envío deja de decir «Va en camino.», que es lo que va a significar `IN_TRANSIT`                                    | `src/features/orders/components/OrderStatusBadge.tsx`                                                                                                                                                                                                                                           | 9                   | El typecheck, que está en rojo desde la etapa 2 hasta que esto exista, y `npx vitest run --project ui`                    |
| 4   | **Lógica pura, sin Prisma ni HTTP.** Estado de la propuesta, plazo relativo en cuatro tramos y los dos mensajes de WhatsApp tienda → comprador. **Sin límite de tasa en código** (PP1)                          | src/features/orders/deadline.ts (por crear), `src/features/orders/whatsapp.ts`, `src/constants/orders.ts`, `src/features/orders/types.ts`                                                                                                                                                       | 7                   | Tests unitarios de cada módulo, `npx vitest run --project server`                                                         |
| 5   | **Las tres sentencias que tocan Prisma.** Proponer, responder y el `UPDATE` del vencimiento. Una sentencia cada una, sin `$transaction` envolvente                                                              | src/features/orders/server/proposal.ts (por crear), src/features/orders/server/respond.ts (por crear), src/features/orders/server/expiry.ts (por crear), `src/features/orders/schemas.ts`                                                                                                       | 1, 2, 3, 6          | `npx vitest run --project server` y src/features/orders/server/expiry.db.test.ts (por crear) contra Postgres real         |
| 6   | **Las rutas.** Proponer (interno), responder (público, `formData` + `303`), `IN_TRANSIT` y `REJECTED_BY_STORE` en la ruta de reporte que ya existe, el barrido dentro del pull, y el cron con su guard extraído | src/app/api/internal/orders/proposal/route.ts, src/app/[slug]/pedido/[code]/respuesta/route.ts, src/app/api/crons/expire-proposals/route.ts, src/app/api/crons/\_lib/guard.ts (por crear); `src/app/api/internal/orders/status/route.ts`, `src/app/api/internal/orders/route.ts`, `vercel.json` | 2, 4, 5, 9          | Tests de ruta, `npx vitest run --project server`                                                                          |
| 7   | **La pantalla.** El bloque de propuesta con los dos totales, la frase de qué cambió, el plazo, y los dos formularios dentro de `<details>`. Cero `"use client"`, cero bytes de JavaScript                       | src/features/orders/components/OrderProposalCard.tsx (por crear), `src/app/[slug]/pedido/[code]/page.tsx`                                                                                                                                                                                       | 1, 9                | `npx vitest run --project ui` y `npm run check:bundle`, que debe pasar **sin** subir `BUDGET_KB` de 193                   |
| 8   | **El guion de modos y su envoltorio**, que es lo que verifica de verdad siete de los diez criterios                                                                                                             | scripts/renegotiate-order.mjs (por crear), .agent/specs/F-019/smoke.sh (por crear)                                                                                                                                                                                                              | 1–7, 9              | `bash .agent/verify.sh F-019 --smoke`                                                                                     |
| 9   | **El contrato.** Los siete puntos de la v5 en `docs/sync-contract.md`, diciendo en la primera frase que **no es aditiva**, y la ADR 0024 de Propuesta a Aceptada                                                | `docs/sync-contract.md`, `docs/adr/0024-segunda-ruta-publica-de-escritura.md`                                                                                                                                                                                                                   | 8                   | `bash .agent/verify.sh F-019 --full` = 0, que es el criterio 10                                                           |

**El orden no es negociable en dos sitios.** La etapa 1 va primero y sola,
porque es el arreglo de un feature ajeno y tiene que poder señalarse en la
bitácora sin mezclarse con lo nuevo. Y la etapa 3 va inmediatamente después de
la 2 porque el `switch` sin `default` de la insignia deja el typecheck en rojo
desde que el enum crece: ese rojo es un guardarraíl deliberado, no un estorbo, y
no se apaga con un `default`.

## De dónde sale cada paso

| Paso | Sale de                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | spec.md I2 (el bug, con línea y causa) + decisión SP6 del humano, «dentro de F-019» + architecture.md § «Lo que NO se hace» |
| 2    | architecture.md § «Modelo de datos y migraciones», DA1; spec.md I1 e I4                                                     |
| 3    | spec.md I1 (el `switch` sin `default` como guardarraíl); design.md § «Textos» y su hallazgo sobre `READY` con envío         |
| 4    | architecture.md § «Componentes», filas 4-6; spec.md R12, R13, R18; ADR 0024 defensa 9                                       |
| 5    | architecture.md DA2, DA3 y DA5; spec.md R1, R2, R8, R14 y criterio 6                                                        |
| 6    | architecture.md DA2, DA4, DA5, DA6 y § «El reloj»; decisión SP5 del humano, «diario + barrido en el pull»                   |
| 7    | design.md § «Inventario de pantallas y estados», § «Coste de cliente» y § «Textos»; spec.md R16 y criterio 1                |
| 8    | spec.md § «Criterios de aceptación», que nombra cada modo del guion junto al criterio que verifica                          |
| 9    | architecture.md § «Los siete puntos del contrato»; spec.md I5 y criterio 8; decisión PP1, que reescribe la defensa 9        |

Ningún paso sale de una idea del orquestador: los nueve tienen documento y
línea. Lo que sí decidió el orquestador es el **orden**, que está justificado
arriba.

## Qué queda fuera

- **Reserva de stock.** Dos compradores pueden pedir la última unidad. Reservar
  exigiría escribir en el camino de venta del POS, que es justo lo que evita la
  ADR 0003.
- **Historial de propuestas.** Una segunda propuesta sobrescribe a la primera.
  La aprobada **sí** se conserva —la página necesita poder decir «este pedido
  incluye un cambio que aprobaste»—, pero las descartadas no dejan rastro.
- **Panel para proponer en queandabuscando.** Quien propone es el encargado
  desde cuadrecaja, por el API interno. Aquí no se construye ninguna pantalla de
  administración.
- **Envío automático de mensajes.** No hay proveedor de WhatsApp Business API,
  ni credenciales, ni coste por mensaje. Se construyen enlaces `wa.me` y los
  abre una persona.
- **Horarios y zona horaria.** El reloj es absoluto: 24 horas corridas, también
  de madrugada y con la tienda cerrada. F-022 sigue en `passes: false` y no se
  inventa el dato.
- **Dónde cambiar `orderExpiryHours`.** Se queda en 24 h para todas las tiendas.
  No hay panel donde tocarlo; el día que alguien pida otro valor, se cambia por
  SQL.
- **Cancelación parcial por línea.** El comprador acepta o rechaza la propuesta
  entera.
- **Brandear `StoreId` para que el compilador pesque bugs como el de la etapa 1.** Costaría tocar el resolver de F-017 y media docena de llamadores.

## Riesgos y plan B

**Hay migración, y hay cambio de contrato. Ninguno de los dos se aprueba de
pasada.**

- **La migración.** Todo aditivo y nullable salvo `Store.orderExpiryHours`, que
  trae `DEFAULT 24` y no reescribe ninguna fila de `Order`. Sin backfill: los
  pedidos ya cancelados se quedan con `cancelledBy` en `NULL`, que en el
  contrato significa exactamente «no consta». `prisma migrate reset` y
  `prisma db push` están prohibidos por `AGENTS.md` y aquí no hacen falta.
  **Lo que hay que mirar en el SQL generado antes de aplicarlo**: quitar los
  cinco `DROP INDEX` de índices GIN y parciales que Prisma propone borrar en
  cualquier diff, tengan que ver o no. Aplicarlo sin mirar no rompe ningún test
  y deja la búsqueda haciendo scans secuenciales en producción.
- **El contrato pasa a v5 y NO es aditivo.** El enum de estados va de 6 a 9
  valores, y un lector con un `switch` exhaustivo —el mismo patrón que este repo
  usa en su insignia— se rompe. Depende de que en cuadrecaja siga sin haber nada
  desarrollado de esta integración: es la pregunta PP2. Si ya lo hay, esto deja
  de ser una nota y pasa a ser trabajo, y el plan se reescribe.
- **Segunda ruta pública de escritura.** La ADR 0016 decía que solo había una y
  que añadir otra era una decisión del mismo peso; tú la tomaste. La ADR 0024
  enumera sus defensas y **dos límites aceptados a sabiendas**: un formulario no
  puede exigir `content-type: application/json`, así que esta ruta pierde el
  preflight CORS que era la defensa 4 de la 0016; y quien tenga el enlace del
  pedido puede decidir por el comprador, que es el alcance que la 0016 ya aceptó
  para la lectura.
- **El límite de tasa vive fuera del repositorio** (PP1), como regla del firewall
  de Vercel. Es lo único de este plan que **el sensor no puede comprobar**: no
  hay test que se ponga rojo si la regla no existe, no se despliega con el
  código, no viaja a un entorno nuevo y nadie se entera si alguien la borra del
  panel. La etapa 9 lo escribe en la ADR 0024 con esas palabras —defensa de
  plataforma, no verificable— para que quede como deuda visible y no como una
  defensa que el documento afirma y el sistema no tiene. Las ocho defensas
  restantes sí están en el código, y la que de verdad protege esta ruta es que el
  código de pedido no se adivina. **Queda una tarea manual tuya**: crear esa
  regla en el panel de Vercel el día del despliegue. Plan B si molesta que no sea
  verificable: el contador en memoria de la recomendación original, media hora de
  trabajo, sin migración ni dato personal.
- **El barrido dentro del pull.** Va en el mismo lote que la lectura, en forma
  de array, porque el pooler de Supabase corre en modo transacción y ninguna
  query puede usar el cliente global dentro de un `$transaction`. Si el pull se
  nota más lento, el plan B es sacar el barrido del lote y dejarlo solo en el
  cron, aceptando el desfase.
- **La carrera entre aprobar y vencer** la resuelve Postgres con `READ
COMMITTED`, no el código: gana exactamente uno y el perdedor no escribe nada.
  Si apareciera un pedido a medio camino, el fallo estaría en que alguna
  sentencia perdió su condición, no en el diseño.

## Coste

Nueve etapas, previsiblemente dos ciclos de `sdd-implementer` y uno de
`sdd-tester`. Se toca de lo que ya funciona: el checkout (una línea, etapa 1),
la insignia de estado, la página del pedido, el pull y la ruta de reporte. Lo
que habría que deshacer si se para a mitad: la migración es aditiva, así que
revertir es un `git revert` más una migración que quita las columnas; nada de lo
existente cambia de forma, y ningún dato se pierde.

## Preguntas antes de aprobar

**Las cuatro están respondidas.** Quedan escritas aquí porque son las decisiones
que hacen que este plan sea este y no otro.

**PP1 — El límite de tasa de la ruta pública: ¿en memoria o persistido?**
→ **Ninguno de los dos: el firewall de Vercel.** No se escribe ningún contador y
no se crea ningún módulo. La defensa 9 de la ADR 0024 pasa a ser configuración de
plataforma, fuera del repositorio y fuera del alcance del sensor. Efecto en este
plan: la etapa 4 pierde un archivo, la etapa 9 reescribe esa defensa en la ADR
diciendo lo que es, y queda una tarea manual —crear la regla en el panel— que
nadie más va a recordar. Está en § «Riesgos» con su plan B.

**PP2 — La v5 no es aditiva. ¿Sigue sin haber consumidor vivo en cuadrecaja?**
→ **Sigue sin haberlo.** Se publica la v5 y se avisa, como con la v3 y la v4. El
enum del pull pasa de 6 a 9 valores y `POST /orders/status` de 4 a 6, con
`AWAITING_CUSTOMER` devolviendo `400`. La primera frase del documento tiene que
decir que la versión **no es aditiva**.

**PP3 — ¿Se guardan las propuestas descartadas?**
→ **No, por ahora.** La segunda propuesta pisa a la primera. Se conservan la
aprobada y `previousTotal`; las descartadas no dejan rastro. Añadir la tabla
append-only después no obliga a tocar nada de lo que este plan decide.

**PP4 — La copia que ya habías firmado en F-010.**
→ **Solo se sustituye donde miente.** El párrafo «La tienda va a revisar tu
pedido y te va a contactar por teléfono para confirmarlo» se sigue mostrando
igual y literal en `PENDING`, `PULLED`, `CONFIRMED`, `READY` y `DELIVERED`, y lo
sustituye copia propia de F-019 solo en `AWAITING_CUSTOMER`, `CANCELLED` y
`REJECTED_BY_STORE`. Ni una palabra de lo firmado cambia.

**Cinco decisiones menores ya aplicadas**, que no pregunté pero que puedes
revertir: se esconde el enlace «Enviar el pedido por WhatsApp» mientras hay una
propuesta viva, porque arma un mensaje con los importes viejos; el rechazo pide
motivo con cuatro opciones marcables y un texto libre opcional, en vez de un
campo obligatorio; la página deja una nota discreta del cambio ya aprobado, para
que la diferencia con el comprobante viejo no se lea como un cobro de más;
`IN_TRANSIT` sobre un pedido de retiro se explica con tono de aviso y no manda a
nadie a la tienda a buscar algo que va de camino a su casa; y
`orderExpiryHours` se queda en 24 h para todas las tiendas.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-019 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-30T17:04:37Z — aprobado por el humano: «ok»
