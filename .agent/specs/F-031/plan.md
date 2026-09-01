---
feature: F-031
agente: orquestador
actualizado: 2026-09-01T16:44:22Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Una tienda podrá ofrecer envío a domicilio **sin saber todavía cuánto cuesta**:
el comprador pide con la dirección puesta, ve «Total parcial … más el envío por
confirmar» en vez de una cifra que luego cambia, y alguien en cuadrecaja pone el
importe al gestionar el pedido, con el bucle de renegociación que ya existe. Si
nadie lo cotiza, el pedido se cierra solo; mientras no esté cotizado, el POS no
puede despacharlo.

Lo que **no** cambia: una tienda con tarifa fija se comporta exactamente como
hoy, importe por importe. Ese es el criterio 9 y es la mitad del trabajo.

Hay una cosa **más** de lo que piden los doce criterios, y está autorizada
expresamente por el humano al responder AP1: todos los importes del payload del
pull pasan a emitirse con dos decimales. El pull nunca los emitió así —Prisma
suprime los ceros de relleno— y el ejemplo publicado del contrato era falso
desde la v2. Se arregla ahora porque cuadrecaja todavía no tiene nada
construido; después costaría otra versión mayor coordinada.

## Pasos

El paso 0 **ya está hecho**: lo pedía la decisión OD2 (la v6 antes de
implementar, para que cuadrecaja arranque en paralelo) y se hizo antes de traer
este plan a la firma. Los demás están en orden y cada uno se verifica solo.

| Nº  | Qué se hace                                                                                                                                                                                                                      | Archivos                                                                                                                                                                                                                                                                                                                          | Criterio que acerca | Cómo se verifica                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | **HECHO.** La v6 del contrato y la nota de traspaso para cuadrecaja                                                                                                                                                              | `docs/sync-contract.md`, `docs/traspaso-cuadrecaja-envio-cotizado.md`                                                                                                                                                                                                                                                             | 11 (a)              | `grep -c 'Versión 6'` = 1 y `grep -c 'v7'` = 4 · `npm run check:harness` ✓ · `npm run format:check` ✓                                                                                                                                                  |
| 1   | La base y el tipo: `enum DeliveryFeeMode`, `Store.deliveryFeeMode`, `Order.deliveryFee` a `Decimal?`, y los importes del pull normalizados a dos decimales. **Ninguna fila queda `NULL`, así que nada de comportamiento cambia** | `prisma/schema.prisma`, prisma/migrations/&lt;timestamp&gt;\_quoted_delivery_fee/migration.sql (por crear), `src/features/orders/server/pull.ts`, `src/features/orders/server/read.ts`, `src/features/orders/types.ts`                                                                                                            | 11 (b)              | `npx prisma validate` · `SELECT count(*) FROM "Order" WHERE "deliveryFee" IS NULL` = 0 · `npx vitest run --project server src/features/orders/server/pull.test.ts` con las claves de la v5 presentes · `verify.sh F-031`                               |
| 2   | Leer el modo y crear el pedido sin importe de envío: el módulo puro de la regla «cuándo se ofrece domicilio», hoy duplicada en dos sitios                                                                                        | src/features/orders/deliveryOffer.ts (por crear), `src/features/orders/server/quote.ts`, `src/features/orders/server/createOrder.ts`, `src/features/orders/types.ts`                                                                                                                                                              | 2                   | `npx vitest run --project server src/features/orders/server/createOrder.test.ts src/features/orders/server/quote.test.ts` · `POST /api/orders` real sobre la tienda con el modo activado por SQL, `201` y `deliveryFee IS NULL`                        |
| 3   | Las seis superficies del comprador, con la copia literal de `design.md`                                                                                                                                                          | `src/features/cart/components/CheckoutForm.tsx`, `src/features/cart/components/OrderSummary.tsx`, `src/features/orders/components/OrderLinesTable.tsx`, `src/features/orders/components/OrderProposalCard.tsx`, `src/features/orders/proposalDiff.ts`, `src/features/orders/whatsapp.ts`, `src/app/[slug]/pedido/[code]/page.tsx` | 1, 3, 10            | `npx vitest run --project ui src/features/cart/components/CheckoutForm.test.tsx` · `npx vitest run --project server src/features/orders/whatsapp.test.ts` · `curl` de la página exigiendo las cadenas exactas del diseño                               |
| 4   | El `409`: guarda al escribir el estado y clasificación de los cero filas, con el aislamiento por negocio comprobado **antes** que la cotización                                                                                  | `src/features/orders/server/status.ts`, `src/app/api/internal/orders/status/route.ts`, `src/constants/orders.ts`                                                                                                                                                                                                                  | 8                   | `npx vitest run --project server src/app/api/internal/orders/status/route.test.ts` con el `409` en los tres estados, el `200` tras aprobar y el `404` de un pedido de otro negocio                                                                     |
| 5   | El reloj del pedido sin cotizar: segundo barrido, contado desde `createdAt`, que **nunca** toca `AWAITING_CUSTOMER`                                                                                                              | `src/features/orders/server/expiry.ts`, `src/features/orders/server/pull.ts`, `src/app/api/crons/expire-proposals/route.ts`, `src/constants/orders.ts`                                                                                                                                                                            | 7                   | `npx vitest run --project db src/features/orders/server/expiry.db.test.ts` con los tres casos · el cron con la fecha forzada por SQL, sin esperar                                                                                                      |
| 6   | El guion de punta a punta y los casos que faltan, escritos por `sdd-tester`                                                                                                                                                      | scripts/quote-delivery-order.mjs (por crear), .agent/specs/F-031/visual.mjs (por crear, solo si hace falta), y los ocho tests que ganan casos                                                                                                                                                                                     | 2, 3, 4, 5, 6, 7, 8 | Las cinco banderas del guion (`--create`, `--pull`, `--quote`, `--dispatch`, `--expire`) terminando en 0                                                                                                                                               |
| 7   | Documentación operativa y la ADR                                                                                                                                                                                                 | `docs/despliegue.md`, `docs/flujos-cc-qab.html`, docs/adr/0027-ausencia-de-importe-en-la-base-cero-mas-bandera-en-el-cable.md (por crear)                                                                                                                                                                                         | —                   | `npm run check:harness` · `npm run format:check`                                                                                                                                                                                                       |
| 8   | No-regresión y cierre                                                                                                                                                                                                            | ninguno: solo se ejecuta                                                                                                                                                                                                                                                                                                          | 9, 12               | `bash .agent/verify.sh F-010 --visual` = 0 · `node scripts/place-order.mjs --store=tienda-dos --delivery` · `git diff --name-only main -- scripts/place-order.mjs .agent/specs/F-010/visual.mjs` sin salida · `bash .agent/verify.sh F-031 --full` = 0 |

## De dónde sale cada paso

| Paso | Sale de                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | `spec.md` R11/R12/R14 (OD1, OD2, OD4) y `architecture.md` § «Contrato en el cable»                                                               |
| 1    | `architecture.md` DA1 (`deliveryFee` anulable), DA2 (el modo como enum), DA3 (los nombres) y § «La migración»; la normalización, de AP1 resuelta |
| 2    | `architecture.md` DA6 (la regla centralizada) y `spec.md` E2, R7, R20                                                                            |
| 3    | `design.md` entero —el léxico de cinco cadenas— y `spec.md` R2 con sus seis superficies, E1, E3, E5, E8, E11, E13                                |
| 4    | `architecture.md` DA5 y `spec.md` E10, R17 (decisión SP2 del humano)                                                                             |
| 5    | `architecture.md` DA4 y `spec.md` E9, R15, R16 (decisión SP1 del humano)                                                                         |
| 6    | `spec.md` § «Criterios de aceptación», que ya nombra el guion y sus banderas                                                                     |
| 7    | `architecture.md` § «¿Hace falta una ADR?» y § «Impacto archivo por archivo» (I9 de `spec.md` para el HTML)                                      |
| 8    | Criterios 9 y 12 de `features.json`, literales                                                                                                   |

## Qué queda fuera

- **Calcular la tarifa.** Ni zonas, ni distancia, ni mapas. El importe lo pone
  una persona en cuadrecaja; este feature abre el hueco.
- **Configurar el modo desde cuadrecaja.** El modo se **lee** aquí y se activa
  por SQL para verificar. Traerlo por el sync, con las otras cuatro columnas de
  configuración de compra, es **F-032** y su v7. Sin F-032, esto queda operable
  pero no configurable por el comerciante: es la consecuencia conocida de tu
  decisión SP3 y de la opción 2 de empaquetado.
- **Cambiar de dueño `Store.orderExpiryHours`.** En la v6 sigue siendo de
  queandabuscando y su comentario en el schema se queda como está, porque hoy
  sigue siendo cierto. La inversión es de F-032.
- **Tocar el bucle de F-019.** `respond.ts` y `proposeOrderChangeSchema` no se
  abren: cotizar es proponer, y aprobar ya cierra el estado pendiente por cómo
  quedó la columna. Cero líneas nuevas ahí.
- **Pantalla de panel** para configurar esto, aquí o en F-032 (tu SP3).
- **Reserva de stock, pagos en línea y notificación automática al comprador.**
  Fuera desde F-019 y siguen fuera: solo enlaces `wa.me` que abre una persona.
- **Normalizar los importes de § ① y § ⑤ del contrato.** Comprobado: el hash de
  reconciliación **quita** los ceros de relleno a propósito, y tocarlo rompería
  la convergencia. La v6 lo dice explícitamente para que nadie lo extienda.
- **El enlace para preguntarle a la tienda** en un pedido sin cotizar de una
  tienda `ONSITE` (DP2 de `sdd-designer`). Queda escrito como propuesta.

## Riesgos y plan B

**Cambio en `docs/sync-contract.md`: sí, y es una versión mayor.** La v6 ya está
escrita. No es aditiva en dos cosas —el `409` y el formato de los importes— y
las dos exigen trabajo de cuadrecaja antes de que reciban tráfico real. Riesgo
que aceptaste con OD2: si la implementación descubre que la forma no aguanta, se
corrige con una v6.1 y se avisa otra vez. Mitigación ya aplicada: la tercera
línea del contrato avisa, marcada a propósito, de que lo de la v6 está publicado
**antes** de estar implementado aquí, y dice qué no responde todavía.

**Migración de datos: sí, y no puede perder nada.** `ALTER COLUMN "deliveryFee"
DROP NOT NULL` sobre `Order` —relajar una restricción, sin backfill y sin
reescribir la tabla— más un `CREATE TYPE` y un `ADD COLUMN … DEFAULT 'FLAT_RATE'`
en `Store`. Ninguna fila existente cambia de valor ni de comportamiento. **Hay
que quitar del `migration.sql` generado los cinco `DROP INDEX` que Prisma
propone** de índices que no están en el schema (AGENTS.md § «Cosas que
muerden»): aplicarlos no rompe ningún test y deja la búsqueda haciendo scans
secuenciales en producción. Marcha atrás: la migración inversa vuelve a poner
`NOT NULL`, y solo falla si ya hay pedidos sin cotizar —hay que decidirlo antes,
no a mitad.

**Comandos prohibidos: ninguno.** No hace falta `prisma migrate reset` ni
`db push`.

**Lo que puede romperse sin que nadie lo note:** los tests de `pull` mockean
`toString()` de los importes (`pull.test.ts:36-45`), que es justo lo que escondió
el formato equivocado durante cuatro versiones. Si los casos nuevos siguen
mockeando, la normalización del paso 1 queda sin verificar de verdad. Se
comprueba contra base real, no con el mock.

**Riesgo de escala, con umbral escrito:** el conjunto que barre el reloj nuevo
—`PENDING`, `PULLED`, `CONFIRMED`— **se acumula** (~90.000 filas al año a 100
pedidos/día), a diferencia de `AWAITING_CUSTOMER`, que se vacía. Se reabre si se
pasa de ~1 M de pedidos abiertos o si el cron tarda más de 1 s, y entonces la
respuesta es un índice declarado en el schema, no un índice parcial invisible.

## Coste

Seis o siete ciclos de agente: `sdd-implementer` por etapas (1-2, 3, 4-5, 7) y
`sdd-tester` en el 6 y el 8, con un ciclo de holgura para lo que devuelva el
sensor. Se toca código que ya funciona en **19 archivos**, y los dos que más
duelen son `createOrder.ts` y `pull.ts`, que son el camino de todos los pedidos,
no solo de los cotizados — por eso el criterio 9 exige que la tienda de tarifa
fija recorra todo con los mismos importes y que ni `scripts/place-order.mjs` ni
el guion visual de F-010 se toquen.

Marcha atrás a mitad: los pasos 1 y 2 son reversibles con la migración inversa
mientras no exista ningún pedido sin cotizar. Del paso 3 en adelante, lo que hay
que deshacer es código, no datos. **La v6 del contrato no se deshace en
silencio**: si se abandona el feature después de publicarla, hay que decírselo a
cuadrecaja explícitamente, porque ya la habrán leído.

## Preguntas antes de aprobar

**Ninguna sin responder.** SP1-SP5 las cerraste antes de abrir el feature;
OD1-OD4, AP1, AP2 y DP1, hoy. Lo que sigue son **cuatro decisiones que tomaron
los agentes** y que tu firma confirma. Si discrepas de alguna, cada una es una
línea:

1. **El pedido que la tienda ya confirmó, pero no cotizó, también vence**
   (`sdd-spec`). El `409` le impide avanzar, así que sin barrido quedaría vivo
   para siempre — que es lo que tu SP1 vino a evitar. Consecuencia visible: un
   encargado que acepta el pedido y se olvida de cotizarlo ve cancelarse un
   pedido que él había aceptado. La alternativa era barrer solo `PENDING` y
   `PULLED`.
2. **Con el modo cotizado activo, una `Store.deliveryFee` residual se ignora**
   (`sdd-spec`). Manda el modo. La alternativa volvería invisible el modo recién
   activado.
3. **El error se llama `ORDER_DELIVERY_NOT_QUOTED`** (`sdd-spec`), ya escrito en
   la v6.
4. **La ADR de este feature es la 0027** (orquestador). F-014 y F-020 propusieron
   ese número y nunca la escribieron; si alguna se escribe algún día, renumera.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-031 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-01T16:44:22Z — aprobado por el humano: «Apruebo tal cual: los 8 pasos y las cuatro decisiones de los agentes confirmadas (el pedido CONFIRMED sin cotizar vence, el modo manda sobre una deliveryFee residual, el error se llama ORDER_DELIVERY_NOT_QUOTED y la ADR es la 0027)»
