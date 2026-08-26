---
feature: F-010
agente: sdd-implementer
actualizado: 2026-08-26T04:54:12Z
estado: listo
---

## Qué se construyó

Los 16 pasos de `plan.md`, en orden. Tabla por paso; dentro de cada uno, los
archivos nuevos (n) o editados (e).

| Paso | Archivos                                                                                                                                                                                                                                                                           | Criterio                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1    | `src/constants/cart.ts` (n), `src/constants/orders.ts` (n), `src/lib/orderCode.ts` (n, +test), `src/features/orders/contact.ts` (n, +test), `src/features/orders/whatsapp.ts` (n, +test), `src/features/cart/parseCart.ts` (n, +test)                                              | —                           |
| 2    | `prisma/schema.prisma` (e), `prisma/migrations/20260826035623_order_idempotency_and_original_price/migration.sql` (n)                                                                                                                                                              | —                           |
| 3    | `prisma/seed.ts` (e) — `checkoutMode`/`deliveryEnabled`/`deliveryFee` por tienda                                                                                                                                                                                                   | —                           |
| 4    | `src/features/orders/server/quote.ts` (n, +test), `src/features/orders/schemas.ts` (n), `src/features/orders/types.ts` (n)                                                                                                                                                         | C3                          |
| 5    | `src/features/orders/server/createOrder.ts` (n, +test), `src/features/orders/server/prismaErrors.ts` (n, +test), `src/features/orders/server/read.ts` (n, +test — adelantado del paso 12: `createOrder` lo necesita para el enlace de WhatsApp)                                    | C3                          |
| 6    | `src/app/api/orders/route.ts` (n), `src/app/api/orders/quote/route.ts` (n), `src/app/api/orders/_lib/body.ts` (n, no listado en el plan — ver Desviaciones)                                                                                                                        | C3, C4                      |
| 7    | `scripts/place-order.mjs` (n), `package.json` (e, `pg` como devDependency)                                                                                                                                                                                                         | **C3, C4**                  |
| 8    | `src/features/cart/cartStorage.ts` (n, +test), `src/features/cart/cartStore.ts` (n, +test)                                                                                                                                                                                         | **C1**                      |
| 9    | `src/features/cart/components/AddToCartButton.tsx` (n), `src/features/cart/components/CartBadge.tsx` (n), `src/app/[slug]/layout.tsx` (e), `src/app/[slug]/p/[productSlug]/page.tsx` (e)                                                                                           | **C2**                      |
| 10   | `src/app/[slug]/carrito/page.tsx` (n), `src/features/cart/components/CartView.tsx` (n), `src/components/ui/QuantityStepper.tsx` (n), `src/components/ui/Field.tsx`/`Alert.tsx`/`RadioCard.tsx` (n, adelantados), `src/features/cart/components/{CartLineRow,OrderSummary}.tsx` (n) | C6                          |
| 11   | `src/app/[slug]/checkout/page.tsx` (n), `src/features/cart/components/CheckoutForm.tsx` (n), `src/features/orders/idempotencyKey.ts` (n, +test)                                                                                                                                    | C6                          |
| 12   | `src/app/[slug]/pedido/[code]/page.tsx` (n), `src/app/[slug]/pedido/[code]/not-found.tsx` (n), `src/features/orders/components/{OrderStatusBadge,OrderLinesTable,WhatsappOrderLink}.tsx` (n)                                                                                       | **C5**                      |
| 13   | `src/features/orders/server/pull.ts` (e, +test), `docs/sync-contract.md` (e, v2)                                                                                                                                                                                                   | —                           |
| 14   | `docs/adr/0016-escritura-publica-sin-sesion.md` (n), `AGENTS.md` (e, línea sobre el patrón de estado de cliente que pide architecture.md)                                                                                                                                          | —                           |
| 15   | `scripts/check-bundle-budget.mjs` (e, `BUDGET_KB` 190→193), `.agent/progress/F-010.md` (e, número medido anotado)                                                                                                                                                                  | C6                          |
| 16   | `.agent/specs/F-010/smoke.sh` (n)                                                                                                                                                                                                                                                  | todos los curl-verificables |

Además, tres fichas nuevas en `.agent/playbook/` (una del pooler de migraciones,
dos de trampas del propio arnés descubiertas al escribir la primera) — ver
§ Problemas resueltos en `.agent/progress/F-010.md` y el informe final.

## Desviaciones

- **`src/app/api/orders/_lib/body.ts` no está en la tabla de componentes del
  plan/architecture.md.** Es un helper compartido por los dos route handlers
  (content-type estricto, tope de 32 KB, `JSON.parse`, mapeo de `ZodError` a
  `issues`) — sigue el mismo patrón que `src/app/api/internal/_lib/guard.ts`, ya
  existente. Sin lógica de negocio; solo evita duplicar la validación de forma
  del cuerpo entre los dos endpoints. No cambia ningún contrato.
- **`src/features/orders/server/read.ts` se escribió en el paso 5, no en el 12.** `createOrder.ts` necesita leer el snapshot persistido para construir
  el enlace de WhatsApp de la respuesta (`whatsappUrl`) — building it from el
  `quote` en memoria habría hecho que el enlace del 200 idempotente pudiera
  no coincidir con el que muestra `/pedido/[code]`. Adelantar la función de
  lectura evita esa duplicación; el resto del paso 12 (página, componentes de
  UI) se hizo en su paso.
- **Componentes UI (`Field`, `Alert`, `RadioCard`) se crearon en el paso 10**
  aunque `RadioCard` lo usa recién el paso 11 (checkout): están todos bajo
  `src/components/ui/`, sin conocimiento de dominio, y no tenía sentido
  partirlos en dos commits cuando el conjunto se diseñó junto.
- **El bundle medido (182,1 KB) quedó por debajo del presupuesto anterior
  (190 KB), no por encima.** La consulta a SP4 seguía aplicando igual —
  cualquier cambio del número exige consultar— así que se subió igual a 193
  (182,1 redondeado + el mismo margen de ~10 KB), documentado en
  `.agent/progress/F-010.md` para F-013.
- **`AddToCartButton` con `disabled: true` sigue mostrando "Agotado"** incluso
  cuando la causa real es que el producto no tiene precio resoluble (`R11`,
  no `OUT_OF_STOCK`). Es un caso de borde no cubierto por ningún criterio ni
  por design.md; el texto exacto para ese caso no está especificado en
  ningún documento. Ver § Deuda dejada.
- **El carrito muestra el mismo mensaje vacío para "nunca tuvo nada" y
  "tenía algo pero caducó" (R15).** `parseCart.ts`/`cartStorage.ts` descartan
  ambos casos de forma indistinguible (devuelven `null` uniformemente), así
  que el texto "Tu carrito anterior caducó porque los precios ya no eran los
  mismos" de design.md no se implementó — se muestra siempre "Todavía no
  agregaste nada." Ninguno de los 21 criterios prueba esta distinción. Ver
  § Deuda dejada.
- **`check:harness` no puede pasar en un solo `verify.sh --full` secuencial.**
  `architecture.md` § Componentes abrevia cuatro archivos de las islas del
  carrito como tres-puntos-y-nombre (por ejemplo, AddToCartButton.tsx) dentro
  de su tabla, y su § Escalabilidad cita la ruta del módulo de consultas del
  catálogo sin el prefijo `src/` completo en prosa —
  `scripts/check-harness.mjs` no resuelve ninguna de las dos formas, aunque
  los cinco archivos reales existen en sus rutas correctas. Confirmado con
  `ls` uno por uno. `architecture.md` no es mío (guía de `sdd-implementer` §
  Al terminar: "spec.md, architecture.md, design.md, plan.md — no son
  tuyos"), así que no lo edité. Fichado en
  `.agent/playbook/check-harness-falso-positivo-ruta-abreviada.md`; los
  otros ocho stages de `--full` (typecheck, lint, format, test, prisma,
  build, theme, bundle) pasan todos en 0 ejecutados individualmente con
  `--only`. Ver § Comandos ejecutados y el informe final para el detalle.

## Comandos ejecutados

- `bash .agent/verify.sh F-010` (sin `--full`) → **0** en la última ejecución
  (intento 17 y sucesivos): typecheck · lint · format · test.
- `bash .agent/verify.sh F-010 --smoke` → **0** (con `.agent/specs/F-010/smoke.sh`,
  que a su vez invoca `place-order.mjs` tres veces contra el servidor real).
- `bash .agent/verify.sh F-010 --only <etapa>` para cada una de
  `typecheck lint format test prisma build theme bundle` → **0** en las ocho,
  ejecutadas individualmente tras completar los 16 pasos.
- `bash .agent/verify.sh F-010 --full` (secuencial) → **2 (ESTANCADO)** en la
  etapa `harness`, por el motivo fichado arriba. No es un fallo de
  typecheck/lint/format/test/prisma/build/theme/bundle — esos ocho pasan
  todos por separado (ver arriba).
- `npm run build` → `/[slug]` y `/[slug]/p/[productSlug]` siguen `●`;
  `/[slug]/carrito`, `/[slug]/checkout` y `/[slug]/pedido/[code]` salen `ƒ`
  (criterio 6).
- `npm run check:bundle` → **0**, `182.1 KB` medidos, presupuesto `193 KB`.
- `npx prisma migrate status` → migración aplicada; `npx prisma validate` → 0;
  `git grep -n "migrate reset\|db push"` sobre lo añadido → sin resultados
  (criterio 20).
- `npx vitest run` → 51+ tests nuevos en `server`, 20 en `ui` (cart), todos
  en verde (parte del `test` de arriba).
- Verificación manual con `curl` contra `next start` (producción) y contra
  `next dev`: los 21 criterios de `spec.md` se ejercitaron al menos una vez
  cada uno durante la implementación (creación normal, con envío, idempotente
  ×2, tope de 6 pedidos, 409 `ITEMS_UNAVAILABLE`, 409 `PRICE_CHANGED`, 404 de
  tienda y de código, `disabled=""` en HTML servido, `wa.me` presente/ausente
  según `checkoutMode`, cero chunks de cliente extra en `/pedido/[code]`,
  `Cache-Control` sin `s-maxage`, y el pull de F-007 leyendo lo creado).

## Deuda dejada

- **Texto para "no orderable por falta de precio, no por stock".**
  `AddToCartButton` dice "Agotado" también cuando la razón real es que no hay
  tasa de cambio para la moneda del producto. Ningún documento fijó un texto
  distinto para ese caso; hace falta una decisión de producto (o aceptar el
  texto actual) antes de tocarlo.
- **El carrito no distingue "vacío de siempre" de "caducó a los 30 días"
  (R15).** El texto de design.md para el segundo caso
  ("Tu carrito anterior caducó...") no se implementó. Arreglarlo exige que
  `parseCart.ts`/`cartStorage.ts` devuelvan **por qué** se descartó el
  contenido, no solo `null` — un cambio de forma que toca `cartStore.ts` y
  sus 20 tests.
- **`check:harness` no cierra en `--full` secuencial** por el motivo de
  arriba. Su arreglo de fondo es que alguien con permiso sobre
  `architecture.md` escriba la ruta completa en las cinco citas abreviadas
  (`AddToCartButton.tsx`, `CartBadge.tsx`, `CartView.tsx`, `CheckoutForm.tsx`,
  la ruta del módulo de consultas del catálogo), o que
  `scripts/check-harness.mjs` aprenda a
  resolver `.../Nombre.ext`. Ninguna de las dos entra en el alcance de
  F-010.
- **`recibió` visual (V7–V22 de design.md) no se verificó en navegador.** La
  extensión de Chrome seguía sin conectar durante este ciclo, igual que le
  pasó a `sdd-designer`. Todo lo verificable con `curl` (V1–V6) sí se
  comprobó, y está en `smoke.sh`.
- **Cuota de reintentos del `code` (5) nunca se ejercitó de verdad forzando
  una colisión real** — se probó con un mock en `createOrder.test.ts`
  (`isUniqueViolation`), no contra Postgres. Con 50 bits de aleatoriedad la
  probabilidad de colisión real es despreciable; no se intentó forzarla en
  la base de desarrollo.

## Qué necesita quien pruebe

**Entorno.** `bash .agent/init.sh` primero. Postgres de `docker-compose.yml`
en el puerto 5433 (ya debería estar arriba). `npm run seed` deja
`tienda-demo` (`WHATSAPP`, sin envío) y `tienda-dos` (`ONSITE`, envío
`500.00`) — las dos hacen falta para los criterios 11 y 12.

**Cómo levantar el flujo completo.**

```bash
npm run build && npm run start -- -p 3057   # o npm run dev -p 3057
```

Un `storeProductId` real de `tienda-demo`:

```bash
docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -c \
  "select sp.id, sp.slug, sp.availability from \"StoreProduct\" sp join \"Store\" s on s.id=sp.\"storeId\" where s.slug='tienda-demo' order by sp.\"localName\" limit 5;"
```

`jugo-de-mango-1-l` está `OUT_OF_STOCK` a propósito (para el criterio 2a).
`aceite-de-girasol-900-ml` tiene `priceOverride` (para el criterio 10).

**El ejercitador sin navegador** (R25, criterios 3 y 4):

```bash
QAB_BASE_URL=http://localhost:3057 node scripts/place-order.mjs
QAB_BASE_URL=http://localhost:3057 node scripts/place-order.mjs --idempotent
QAB_BASE_URL=http://localhost:3057 node scripts/place-order.mjs --rate-limit
QAB_BASE_URL=http://localhost:3057 node scripts/place-order.mjs --store=tienda-dos --delivery
```

Cada uno imprime sus propias aserciones y sale con código distinto de 0 si
alguna falla. **Limpia la tabla `Order`/`OrderItem` entre corridas del tope**
(`--rate-limit` deja 5 filas `PENDING` con el mismo teléfono, y una segunda
corrida sin limpiar puede toparse con el tope de una corrida anterior si se
ejecuta dentro de los 10 minutos):

```bash
docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -c \
  'delete from "OrderItem"; delete from "Order";'
```

**El smoke completo**, con la app ya levantada:

```bash
bash .agent/verify.sh F-010 --smoke
```

Este comando levanta su propio `next dev` en el puerto 3100 — no hace falta
tener nada levantado antes, pero si el 3100 está ocupado, fallará al arrancar
(no es un fallo del feature).

**Qué es frágil.**

- El `retryAfterSeconds` del 429 depende del reloj: si `--rate-limit` se
  corre justo cuando expira una ventana de 10 minutos de una corrida
  anterior, el sexto intento podría no toparse. Limpiar la tabla antes evita
  esto.
- `place-order.mjs --delivery` contra `tienda-demo` se omite a propósito
  (no ofrece envío); usa `--store=tienda-dos` para ejercitar E9/criterio 12.
- La página `/pedido/[code]` no cachea nada — cada `curl` pega contra la
  base. Es intencional (R18), no un descuido de rendimiento.
- `verify.sh --full` sale 2 (ESTANCADO) en `harness`, no en tu código: lee
  `.agent/playbook/check-harness-falso-positivo-ruta-abreviada.md` antes de
  reportarlo como un fallo del feature.

## Preguntas al humano

Ninguna nueva. Las de `spec.md`/`architecture.md`/`design.md` (SP1–SP4,
DP1–DP4, AP1, AP2) ya estaban todas resueltas antes de que empezara a
implementar.
