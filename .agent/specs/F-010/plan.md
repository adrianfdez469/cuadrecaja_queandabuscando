---
feature: F-010
agente: orquestador
actualizado: 2026-08-26T03:51:00Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Un comprador entra a `/tienda-demo` desde el teléfono, agrega productos sin salir
de la ficha, revisa lo que lleva, escribe su nombre y su teléfono, elige si lo
recoge o se lo llevan, y confirma. Le queda un código de pedido y una página donde
verlo; a la tienda le queda una fila que su POS recogerá en el siguiente pull. No
hace falta cuenta, no se cobra nada y no se reserva stock.

Lo que **no** cambia: el catálogo se sigue leyendo sin esperar el JavaScript, y
`/[slug]` y las fichas de producto siguen siendo páginas estáticas.

## Pasos

Dieciséis pasos. Los cinco primeros no tienen interfaz y se verifican con
`verify.sh`; a partir del 6 empieza lo que se puede ejercitar con `curl`; del 9 al
12 es la interfaz. `C1`–`C6` son los seis `acceptance_criteria` de
`features.json`, en su orden.

| Nº  | Qué se hace                                                                                                                      | Archivos                                                                                                                                          | Criterio que acerca | Cómo se verifica                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Constantes y lógica pura: `code` de pedido, normalización de contacto, enlace `wa.me`, guarda del carrito sin Zod                | `src/constants/cart.ts`, `src/constants/orders.ts`, `src/lib/orderCode.ts`, `features/orders/{contact,whatsapp}.ts`, `features/cart/parseCart.ts` | —                   | `bash .agent/verify.sh F-010` = 0, con tests unitarios de cada módulo                                   |
| 2   | Migración aditiva: `Order.idempotencyKey` (nullable, único), `OrderItem.originalUnitPrice`, `OrderItem.originalCurrencyCode`     | `prisma/migrations/<ts>_order_idempotency_and_original_price/`, `prisma/schema.prisma`                                                            | —                   | `npx prisma migrate status` la reporta aplicada y `npx prisma validate` = 0                             |
| 3   | Fixture: `tienda-demo` queda `WHATSAPP` sin envío y `tienda-dos` `ONSITE` con `deliveryFee`, sin romper la idempotencia del seed | `prisma/seed.ts`                                                                                                                                  | —                   | `npm run seed` dos veces seguidas da el mismo conteo, y las dos tiendas salen con los ajustes esperados |
| 4   | Cotización en servidor: `loadStoreForOrder`, `quoteCart`, `quoteBySlug`. Único sitio del sistema que decide un precio            | `src/features/orders/server/quote.ts`, `features/orders/schemas.ts`, `features/orders/types.ts`                                                   | C3                  | Tests de nodo: `priceOverride` gana, USD se convierte, línea agotada sale `orderable: false`            |
| 5   | Creación en servidor: idempotencia y tope en **una** consulta, `create` anidado, captura de `P2002`, reintento del `code`        | `features/orders/server/createOrder.ts`, `features/orders/server/prismaErrors.ts`                                                                 | C3                  | Tests de nodo del mapeo de resultados; sin `$transaction` en el diff                                    |
| 6   | Los dos endpoints públicos: `POST /api/orders/quote` y `POST /api/orders`                                                        | `src/app/api/orders/route.ts`, `src/app/api/orders/quote/route.ts`                                                                                | C3, C4              | `curl` contra `next start`: 201, y 409/429 en sus casos                                                 |
| 7   | Ejercitador sin navegador — el que hace verificables C3 y C4                                                                     | `scripts/place-order.mjs`                                                                                                                         | **C3, C4**          | `node scripts/place-order.mjs` crea el pedido **sin cabecera `Cookie`** y lo comprueba en la base       |
| 8   | Carrito de cliente: adaptador de `localStorage` con caducidad y degradación a memoria, y store con `useSyncExternalStore`        | `features/cart/cartStorage.ts`, `features/cart/cartStore.ts`                                                                                      | **C1**              | Test `*.test.tsx` (proyecto `ui`): la tienda A escribe `qab.cart.v1.<idA>` y no toca la de B            |
| 9   | Las dos islas del catálogo: botón de agregar y contador de cabecera                                                              | `features/cart/components/{AddToCartButton,CartBadge}.tsx`, `app/[slug]/layout.tsx`, `app/[slug]/p/[productSlug]/page.tsx`                        | **C2**              | `curl … \| grep 'disabled=""'` sobre un producto agotado — **el atributo, no la clase**                 |
| 10  | Página del carrito: cascarón servidor + `CartView`, con el estado de carga de la cotización                                      | `app/[slug]/carrito/page.tsx`, `features/cart/components/CartView.tsx`, `components/ui/QuantityStepper.tsx`                                       | C6                  | `npm run build` la marca `ƒ`; V11–V14 en navegador                                                      |
| 11  | Página de checkout: formulario de contacto y entrega, `idempotencyKey`, manejo de 409 y 429                                      | `app/[slug]/checkout/page.tsx`, `features/cart/components/CheckoutForm.tsx`                                                                       | C6                  | `npm run build` la marca `ƒ`; V15 y los estados de error en navegador                                   |
| 12  | Página del pedido, 100 % servidor y sin un solo módulo de cliente                                                                | `app/[slug]/pedido/[code]/page.tsx`, `features/orders/server/read.ts`                                                                             | **C5**              | `curl` muestra código y total; `curl -sI` sin `s-maxage`; V5 cuenta 0 chunks de cliente                 |
| 13  | Contrato v2 con cuadrecaja: el pull emite además los importes originales y el `rateSnapshot`, de forma **aditiva**               | `features/orders/server/pull.ts`, `docs/sync-contract.md`                                                                                         | —                   | Test de forma de la respuesta; los campos que el POS ya lee no cambian                                  |
| 14  | La ADR de la primera escritura pública sin sesión del sistema                                                                    | `docs/adr/0016-escritura-publica-sin-sesion.md`                                                                                                   | —                   | Existe y su contenido es el que dejó escrito `architecture.md`                                          |
| 15  | Medir el bundle real tras el build y fijar el presupuesto en ese número                                                          | `scripts/check-bundle-budget.mjs`, `.agent/progress/F-010.md`                                                                                     | C6                  | `npm run check:bundle` = 0, y **el número medido queda anotado en el progreso para F-013**              |
| 16  | Smoke ejecutable de punta a punta                                                                                                | `.agent/specs/F-010/smoke.sh`                                                                                                                     | todos               | `bash .agent/verify.sh F-010 --smoke` = 0                                                               |

## De dónde sale cada paso

| Paso | Sale de                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Componentes (filas 1–5) · `spec.md` R16, R17                                |
| 2    | Decisión del humano SP1 · `architecture.md` § Modelo de datos y migraciones                     |
| 3    | `spec.md` I4 · `architecture.md` § «Fixture de I4: en `prisma/seed.ts`, no en un script aparte» |
| 4    | `architecture.md` decisión 2 (`quoteCart` como única fuente de precio) · `spec.md` R5, R6       |
| 5    | `architecture.md` § «La consulta única de idempotencia y tope (R31)» · `spec.md` R26–R31        |
| 6    | `architecture.md` decisión 1 (route handler, no Server Action) · `spec.md` R25                  |
| 7    | `spec.md` R25 — sin esto, C3 y C4 no se pueden verificar y el feature no cierra                 |
| 8    | `spec.md` R12, R15, R16, E21, E22, E23 · `architecture.md` § Estado de cliente                  |
| 9    | `design.md` E1, E2, E5 · decisión del humano DP3 · `architecture.md` § Frontera de islands      |
| 10   | `design.md` E6, E7 y § estado de carga · `architecture.md` § `POST /api/orders/quote`           |
| 11   | `design.md` E8–E13 y el reorden a resumen → contacto → notas → entrega → total                  |
| 12   | `design.md` E16, E19 · decisión del humano DP2 · `spec.md` R18                                  |
| 13   | Decisión del humano SP2 · `architecture.md` § «`docs/sync-contract.md` — el contrato v2»        |
| 14   | `architecture.md` § «¿Hace falta una ADR?», que la deja escrita entera                          |
| 15   | Decisión del humano SP4 · ficha `.agent/playbook/bundle-fuera-de-presupuesto.md`                |
| 16   | `.agent/README.md` § «Cuando algo falla» · `design.md` V1–V22                                   |

Ningún paso sale de mi cabeza. El 7 es el único que podría parecerlo: no lo pide
ningún criterio, lo pide R25, y sin él dos criterios se quedan sin forma de
comprobarse.

## Qué queda fuera

Lo esperable que **no** se construye, con el motivo:

- **Promociones y descuentos.** `discountTotal` se escribe `0`. Es F-011 (tu
  decisión del 2026-08-25).
- **Cuenta de cliente.** `customerId` queda `null`, no se lee ninguna cookie. Es
  F-012.
- **Pagos.** No hay pasarela ni estado de pago: el pedido es contra entrega.
- **Notificaciones.** Nadie avisa a la tienda automáticamente. El POS se entera por
  pull (ADR 0002) y el comprador manda el WhatsApp si quiere (tu decisión DP1).
- **Reserva de stock.** Dos compradores pueden pedir la última unidad. Es la razón
  por la que el texto de confirmación lo advierte explícitamente.
- **Zonas de envío y cálculo por distancia.** Tarifa plana, y ya.
- **Que el abuso por rotación de teléfonos quede atajado.** El tope es por
  teléfono; quien invente uno nuevo en cada petición lo esquiva. Aceptado a
  sabiendas (AP2), escrito en la ADR 0016.
- **Que el carrito y el checkout entren en el presupuesto de bundle.**
  `check-bundle-budget.mjs` solo mide páginas prerenderizadas, así que las rutas
  `ƒ` quedan fuera de su alcance. Dueño: F-013.
- **`pullOrders` filtrado por negocio (I7).** Desde F-010 el pull mueve teléfonos y
  direcciones reales, y sigue sin filtrar. No se arregla aquí; está en
  `specs/propuestas/identidad-integracion`. **Es lo que más peso tiene de esta
  lista** y quería que lo vieras escrito.
- **Pedir sin JavaScript.** El catálogo se lee sin JS y eso no se toca, pero
  agregar y confirmar sí lo necesitan.

## Riesgos y plan B

**Las tres cosas que `AGENTS.md` dice que no se aprueban de pasada, juntas y a la
vista:**

1. **Hay migración.** Tres columnas nullables y un índice único sobre `Order`. Es
   aditiva: no reescribe ninguna fila, no borra nada, y las filas existentes se
   quedan con `null` en los campos nuevos. Si `prisma migrate dev` propone un reset
   por _drift_, **se para y se pregunta** — `migrate reset` y `db push` están
   prohibidos y la salida natural del problema es justo uno de los dos.
2. **Hay cambio de contrato con cuadrecaja.** `docs/sync-contract.md` pasa a v2.
   Estrictamente aditivo: los campos que el POS ya lee conservan nombre, tipo y
   significado. Su lector actual sigue funcionando sin tocar nada. **Avisar a ese
   equipo sigue siendo tuyo** — no hay agente que pueda hacerlo.
3. **Sube el presupuesto de bundle.** De 190 KB a ~195 estimados, al número que se
   mida. La ficha `bundle-fuera-de-presupuesto` exige consultarlo: consultado y
   autorizado por ti (SP4). Si el salto fuera mucho mayor que los ~5 KB previstos,
   el plan B es buscar el `"use client"` de más **antes** de tocar el número.

Los demás riesgos, con lo que se haría:

| Riesgo                                                   | Cómo se nota                               | Plan B                                                                          |
| -------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `/[slug]` o la ficha dejan de ser `●` al meter la isla   | La tabla del build las marca `ƒ`           | El culpable casi seguro es `useSearchParams`; se quita, no se cede el criterio  |
| Una ruta nueva no sale `ƒ`                               | Igual, en la tabla del build               | `export const revalidate = 0` **literal** junto al `dynamic`                    |
| Un `Decimal` o un `BigInt` revienta `JSON.stringify`     | 500 en el endpoint                         | Todo sale de `features/*/server/` ya convertido a cadena; hay test de forma     |
| El estado de carga del carrito «salta» en conexión lenta | V11 y V12, en navegador                    | La regla del diseño es que la lista no se mueve: solo aparecen importes         |
| El diseño no se pudo ver en navegador en este ciclo      | Ya pasó: la extensión de Chrome no conecta | V7–V22 quedan para el probador; si tampoco puede, se dice, no se firma a ciegas |

## Coste

**Dos ciclos de agente**: `sdd-implementer` para los 16 pasos, `sdd-tester` para
los 19 criterios y los 22 pasos de verificación. Probablemente una vuelta más entre
ambos.

**Lo que ya funciona y se toca**: `prisma/seed.ts` (F-002), `app/[slug]/layout.tsx`
y la ficha de producto (F-004), `pull.ts` (F-007), `check-bundle-budget.mjs`
(F-009). Los cuatro tienen criterios verificados que no se pueden romper — en
particular que la ficha y `/[slug]` sigan siendo `●`, y que el seed siga siendo
idempotente.

**Marcha atrás a mitad**: el código nuevo se borra sin consecuencias porque nada
existente depende de él. Lo único que no se borra solo es la migración: habría que
escribir una migración inversa que quite las tres columnas, nunca revertir a mano.
Como son nullables y nadie las lee todavía, dejarlas puestas también es una salida
válida y más barata.

## Preguntas antes de aprobar

Ninguna pendiente: SP1–SP4, DP1–DP4, AP1 y AP2 están todas respondidas y anotadas
en `.agent/progress/F-010.md` § «Decisiones tomadas».

Dos cosas que decidió el diseñador por su cuenta y que puedes vetar al firmar, sin
que ninguna cambie el alcance:

- **El carrito no muestra miniaturas de los productos.** `quote` no devuelve
  `imageUrl`, y pedirlas serían N imágenes más en una conexión limitada.
- **Si la cotización se cae, tras un reintento fallido aparece un «Continuar de
  todos modos».** No puede persistir nada incorrecto: el checkout recotiza y el
  servidor vuelve a preciar al crear. En el checkout ese botón **no** existe.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-010 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-26T03:51:00Z — aprobado por el humano: «Aprobado, adelante»
