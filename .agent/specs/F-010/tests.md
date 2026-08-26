---
feature: F-010
agente: sdd-tester
actualizado: 2026-08-26T13:47:44Z
estado: listo
veredicto: listo
---

> **Ciclo de revisión visual (segunda pasada de `sdd-tester`).** El feature ya
> estaba cerrado con los 21 `acceptance_criteria` verificados. Este ciclo
> ejecuta `V7`–`V22` de `design.md` — la parte que dos ciclos anteriores no
> pudieron correr por falta de navegador. **Nota de herramientas:** el encargo
> de este ciclo daba por hecho `mcp__claude-in-chrome__*` con un `deviceId` ya
> elegido por el humano, pero esa herramienta no apareció en mi caja de
> herramientas real (Read/Write/Edit/Bash únicamente) — no lo intenté invocar
> por no fabricar una llamada a una función que no existe. En su lugar usé
> **Playwright** (`^1.62.1`, ya en `devDependencies`, con su Chromium
> instalado), invocado vía `Bash`/`node`, contra el servidor real de
> `:3057`. Es un navegador de verdad, con CDP para throttling de red, modo
> offline, `prefers-color-scheme`, y captura de pantalla — cumple la regla de
> "ejecutar algo y ver su resultado", pero **no es literalmente Chrome con la
> extensión pedida** y no puedo correr VoiceOver de verdad (ver V19). Capturas
> en `/private/tmp/.../scratchpad/shots/` (ruta de sesión, no versionada).
> Encontré **dos fallos reales** en esta pasada — ver § Fallos de la revisión
> visual. Ninguno de los dos toca los 21 `acceptance_criteria` ya verificados
> en el ciclo anterior, así que el veredicto de arriba se mantiene, pero **lo
> digo alto**: uno de los dos es un fallo de accesibilidad en la pantalla que
> el propio encargo señaló como "la más delicada del feature".

## Estrategia

Tres capas, en el entorno que le corresponde por extensión (`AGENTS.md` §
Cosas que muerden):

- **`*.test.tsx` → proyecto `ui` (jsdom).** `cartStorage.test.tsx`,
  `cartStore.test.tsx` y el nuevo `AddToCartButton.test.tsx` — todo lo que
  toca `localStorage`, `window` o renderiza un componente de cliente.
- **`*.test.ts` → proyecto `node`.** `pull.test.ts`, `createOrder.test.ts`,
  `quote.test.ts`, `idempotencyKey.test.ts`, `orderCode.test.ts`, etc. — lo
  que corre contra Prisma mockeado o lógica pura de servidor.
- **`curl`/`node scripts/place-order.mjs` contra un servidor real** para lo
  que ningún test unitario puede probar: el contrato HTTP completo, la base
  de datos real, y la interacción entre `quoteCart`/`createOrder`/el pull.
  Levanté `npm run build && npm run start -- -p 3057` (el dev server que ya
  escuchaba en :3000 resultó ser una instancia vieja de 14h47m, de **antes**
  de que existieran las rutas de F-010 — devolvía 404 en `/api/orders`; lo
  dejé intacto por si pertenece a otra sesión, y usé :3057 para todo lo de
  abajo).

`V1`–`V6` de `design.md` (los que no necesitan navegador) se ejecutan también
por `.agent/specs/F-010/smoke.sh`, vía `bash .agent/verify.sh F-010 --smoke`.
`V7`–`V22` necesitan Chrome. **No tengo herramienta de navegador en este
ciclo** (mi caja de herramientas es Read/Write/Edit/Bash, sin extensión de
Chrome ni MCP de navegador) — confirmo lo que ya dijeron `sdd-designer` e
`sdd-implementer`: siguen sin ejecutarse. No los doy por buenos leyendo el
JSX; van marcados como no verificados abajo.

## Mapa criterio → prueba

### Los seis `acceptance_criteria` literales de `features.json` (en su orden)

| #   | Criterio                                                                                                  | Prueba                                                                                                                                                                                                                                          | Archivo / comando                                                                                                                                                                                                                                                           | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | El carrito persiste en localStorage con clave namespaced por tienda                                       | Test `ui`: escribir en tienda A no toca la clave de tienda B; releer recupera las líneas                                                                                                                                                        | `npx vitest run --project ui src/features/cart/cartStorage.test.tsx src/features/cart/cartStore.test.tsx`                                                                                                                                                                   | **PASA** — 20/20. `qab.cart.v1.store-a` y `qab.cart.v1.store-b` verificados como claves distintas y no cruzadas.                                                                                                                                                                                                                                                                                                                |
| 2   | Un producto OUT_OF_STOCK no se puede agregar                                                              | (a) `curl` sobre HTML servido con `disabled=""` (no `disabled`, que es un falso positivo — ver trampa abajo); (b) test jsdom de que el click en el botón deshabilitado no agrega la línea; (c) confirmar un carrito con una línea agotada → 409 | (a) `curl -s :3057/tienda-demo/p/jugo-de-mango-1-l \| grep -c 'disabled=""'`; (b) `npx vitest run --project ui src/features/cart/components/AddToCartButton.test.tsx` (**escrito en este ciclo**, ver abajo); (c) `POST /api/orders` con `jugo-de-mango-1-l` (OUT_OF_STOCK) | **PASA** los tres. (a) = 1; producto disponible con el mismo grep = 0, y con el grep-trampa (`grep -c 'disabled'` a secas) = 1 en AMBOS casos — confirmado que el comando de la spec es un falso positivo real, tal como fichó el diseñador. (b) 3/3 tests nuevos, incluido uno positivo (producto disponible sí se agrega). (c) → `HTTP 409 {"error":"ITEMS_UNAVAILABLE",...}`, `SELECT count(*) FROM "Order"` no subió (3→3). |
| 3   | El checkout crea un Order con snapshot de contacto y de precios, y rateSnapshot con las tasas del momento | `scripts/place-order.mjs` sin navegador (R25), comprobando en la base                                                                                                                                                                           | `QAB_BASE_URL=http://localhost:3057 node scripts/place-order.mjs`                                                                                                                                                                                                           | **PASA** — 0 aserciones fallidas: fila existe, `contactName`/`contactPhone` coinciden, `unitPrice` coincide con el precio efectivo, `rateSnapshot.rates` presente.                                                                                                                                                                                                                                                              |
| 4   | Se puede completar un pedido sin iniciar sesión                                                           | La misma petición de arriba, nunca manda `Cookie`; y `cookies()` no aparece en el camino del pedido                                                                                                                                             | El mismo comando de arriba + `git grep -rn "cookies()" src/features/orders/ "src/app/[slug]/"`                                                                                                                                                                              | **PASA** — 201 sin cabecera `Cookie`; el `git grep` no devuelve nada (exit 1 = sin resultados).                                                                                                                                                                                                                                                                                                                                 |
| 5   | `/[slug]/pedido/[code]` muestra el pedido y no está cacheada                                              | `curl` antes y después de un `POST /api/internal/orders/status`, mismo `curl`, sin esperar revalidación; `curl -sI` sin `s-maxage`                                                                                                              | `curl -s :3057/tienda-demo/pedido/<code>`, `POST /api/internal/orders/status` a CONFIRMED, mismo `curl`, `curl -sI`                                                                                                                                                         | **PASA** — antes: "Pendiente"; después del POST, el MISMO curl (sin rebuild ni espera) muestra "Confirmado"; `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` — sin `s-maxage`.                                                                                                                                                                                                                         |
| 6   | Las rutas de carrito/checkout se marcan `ƒ`, nunca SSG                                                    | `npm run build` y su tabla; `export const dynamic` literal; `matcher` de `proxy.ts` sin `/[slug]`                                                                                                                                               | `npm run build` (dentro de `verify.sh --full`, log `.agent/runs/F-010/049-build.log`); `grep -n "export const dynamic" src/app/[slug]/{carrito,checkout,pedido/[code]}/page.tsx`; `sed -n '/export const config/,/^};/p' src/proxy.ts \| grep -n slug`                      | **PASA** — tabla: `/[slug]` y `/[slug]/p/[productSlug]` siguen `●`; `/[slug]/carrito`, `/[slug]/checkout`, `/[slug]/pedido/[code]` salen `ƒ`. Los tres `dynamic` son el literal `"force-dynamic"`. `git status --short src/proxy.ts` está limpio (sin diff respecto al commit de bootstrap) y el `matcher` no contiene `slug` en ninguna parte (solo aparece en un comentario fuera del bloque `config`).                       |

### Los criterios `[nuevo]` propuestos por `spec.md` (7 a 21 — son 15, no 13; ver nota)

> **Nota de discrepancia**: el encargo de este ciclo habla de «13 criterios
> nuevos (7–19)», pero `spec.md` § Criterios de aceptación propuestos numera
> del 7 al **21** (15 criterios `[nuevo]`), y son justamente los que cubren lo
> que los seis literales dejan fuera (I5, idempotencia SP1, tope SP3,
> compatibilidad del pull SP2, presupuesto SP4). Verifiqué los 15, no solo 13,
> porque `spec.md` es el documento que manda sobre el encargo de la sesión.

| #   | Criterio                                                                                                                                                               | Prueba ejecutada                                                                                                                                                                                           | Resultado                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | Producto que pasa a OUT_OF_STOCK YA en el carrito → 409, sin fila nueva                                                                                                | `UPDATE StoreProduct SET availability='OUT_OF_STOCK'` sobre un producto disponible, luego `POST /api/orders` con ese `storeProductId`; conteo de `Order` antes/después                                     | **PASA** — `409 ITEMS_UNAVAILABLE {reason:"OUT_OF_STOCK"}`; conteo de `Order` sin cambios (1→1). Producto restaurado a `AVAILABLE` tras la prueba.                                                                                                                                                                                                                                  |
| 8   | Cambio de precio entre agregar y confirmar → 409 con importe anterior/nuevo; repetir con el total nuevo crea el pedido                                                 | Cotizar (230.00), `UPDATE StoreProduct SET "syncedPrice"=300.00`, confirmar con `expectedTotal=230.00` → 409; reintentar con `300.00` → 201                                                                | **PASA** — `409 PRICE_CHANGED {"was":"230.00","now":"300.00","total":"300.00"}`; el reintento con el total nuevo → `201`, `OrderItem.unitPrice = 300.00` en la base.                                                                                                                                                                                                                |
| 9   | Cambiar `ExchangeRate` y `syncedPrice` tras crear el pedido no mueve los importes ya mostrados                                                                         | Pedido con un producto en USD (`cerveza-cristal`, 1.20 USD → 528.00 CUP con tasa 440), luego inserté una fila `ExchangeRate` nueva (USD=999.9999) y cambié `syncedPrice` a 5.00, recargué `/pedido/[code]` | **PASA** — la página siguió mostrando `$528.00` (el `rateSnapshot` congelado, no la tasa/precio vigentes). Datos restaurados tras la prueba.                                                                                                                                                                                                                                        |
| 10  | Producto con `priceOverride` → `OrderItem.unitPrice` = override, nunca `syncedPrice`                                                                                   | `aceite-de-girasol-900-ml`: `priceOverride=1150.00`, `syncedPrice=1250.00`; `POST /api/orders`                                                                                                             | **PASA** — `OrderItem.unitPrice = 1150.00` en la base, nunca 1250.00.                                                                                                                                                                                                                                                                                                               |
| 11  | `ONSITE` crea el pedido igual, sin `wa.me`; `WHATSAPP` sí                                                                                                              | Pedido en `tienda-dos` (`ONSITE`) → `whatsappUrl: null` y `curl .../pedido/<code> \| grep -c wa.me` = 0; pedido en `tienda-demo` (`WHATSAPP`) → `wa.me` presente                                           | **PASA** — `tienda-dos`: `whatsappUrl: null`, 0 ocurrencias de `wa.me` en la página; `tienda-demo`: `whatsappUrl` con `https://wa.me/...`, ≥1 ocurrencia en la página.                                                                                                                                                                                                              |
| 12  | `deliveryEnabled=true`, `deliveryFee=500`: envío → `total=subtotal+500` + dirección obligatoria; retiro → `total=subtotal`, `deliveryAddress=null`                     | Dos pedidos en `tienda-dos`: uno `DELIVERY` con dirección, otro `PICKUP`                                                                                                                                   | **PASA** — envío: `subtotal=940.00, deliveryFee=500.00, total=1440.00, deliveryAddress` presente; retiro: `subtotal=600.00, deliveryFee=0.00, total=600.00, deliveryAddress` vacío.                                                                                                                                                                                                 |
| 13  | Tras checkout, `GET /api/internal/orders?since=0&limit=10` lo devuelve y lo deja en `PULLED`                                                                           | Crear 5 pedidos nuevos (todos `PENDING`), `GET /api/internal/orders?since=0&limit=10` con `Bearer $SYNC_TOKEN`, releer `Order.status`                                                                      | **PASA** — el pull devolvió los 6 pedidos existentes (`nextCursor: null`); los 5 que estaban `PENDING` pasaron a `PULLED` con `pulledAt` seteado; el que ya estaba `CONFIRMED` (de una prueba anterior) se quedó en `CONFIRMED`, sin bajar a `PULLED` — la transición solo aplica a `PENDING`, como pide F-007. **Esto es justo lo que F-007 tenía bloqueado sin poder verificar.** |
| 14  | `npm run check:bundle` = 0 tras el build con el presupuesto ajustado, y `verify.sh --full` = 0                                                                         | `npm run check:bundle`; `bash .agent/verify.sh F-010 --full`                                                                                                                                               | **PASA** — `check:bundle`: "Heaviest page... client JS: 182.1 KB gzipped (budget 193 KB)" → 0. `verify.sh --full` → intento 53, las 9 etapas en verde, `PASA`.                                                                                                                                                                                                                      |
| 15  | `/[slug]/pedido/[code]` con `code` inexistente o de otra tienda → 404                                                                                                  | `curl :3057/tienda-demo/pedido/ZZZZZZZZZZ`; `curl :3057/tienda-dos/pedido/<code de tienda-demo>`                                                                                                           | **PASA** — 404 en ambos casos.                                                                                                                                                                                                                                                                                                                                                      |
| 16  | Dos confirmaciones con el MISMO `idempotencyKey`: 201 luego 200 con `idempotent:true` y mismo `code`; `Order` sube solo 1                                              | `node scripts/place-order.mjs --idempotent`                                                                                                                                                                | **PASA** — 0 aserciones fallidas: 201 → 200, `idempotent:true`, mismo `code`, `SELECT count(*) WHERE idempotencyKey=...` = 1.                                                                                                                                                                                                                                                       |
| 17  | Dos confirmaciones SIN `idempotencyKey`: las dos 201, dos pedidos distintos                                                                                            | Dos `POST /api/orders` idénticos, sin el campo `idempotencyKey`, mismo teléfono                                                                                                                            | **PASA** — `201` y `201`, dos `code` distintos (`HSNKVWT9QJ`, `4H6Z04TYP7`), `SELECT count(*) WHERE contactPhone=...` = 2.                                                                                                                                                                                                                                                          |
| 18  | 6 confirmaciones mismo teléfono+tienda en <10 min: 5×201, 6ª 429 `TOO_MANY_ORDERS` con `Retry-After`; otro teléfono 201; reintento con clave ya usada 200 pese al tope | `node scripts/place-order.mjs --rate-limit` + verificación manual adicional de `Retry-After`, otro teléfono y el reintento (R31)                                                                           | **PASA** — 5×201, 6ª → `HTTP 429`, header `retry-after: 600`, body `{"error":"TOO_MANY_ORDERS","retryAfterSeconds":600}`; con otro teléfono → `201` (no comparte el tope); reintento con la clave del pedido #1 (ya usada, tope ya alcanzado) → `200` con `idempotent:true`.                                                                                                        |
| 19  | Compatibilidad hacia atrás del pull: conserva TODAS las claves de v1 con mismo tipo/significado, suma las 4 nuevas                                                     | Test que fija la forma de la respuesta (no lee el diff) + verificación en vivo                                                                                                                             | `npx vitest run --project server src/features/orders/server/pull.test.ts`; más el `GET /api/internal/orders` en vivo de arriba                                                                                                                                                                                                                                                      | **PASA** — 4/4 tests: conserva `id/code/storeExternalId/status/contact/currencyCode/subtotal/discountTotal/deliveryFee/total/notes` y por línea `storeProductExternalId/name/unitPrice/currencyCode/quantity/lineTotal`; suma `rateSnapshot` (pedido) y `originalUnitPrice/originalCurrencyCode/originalLineTotal` (línea); fallback a los valores convertidos para pedidos "legacy" sin original guardado. `docs/sync-contract.md` documenta la v2 como aditiva. |
| 20  | `prisma migrate status` aplicada, `prisma validate` = 0, sin `migrate reset`/`db push` en lo añadido                                                                   | `npx prisma migrate status`; `npx prisma validate`; `git grep -n "migrate reset\|db push"`                                                                                                                 | **PASA** — "Database schema is up to date!"; "valid 🚀"; el `git grep` no devuelve nada.                                                                                                                                                                                                                                                                                            |
| 21  | Tras el build, el número medido queda como `BUDGET_KB` por defecto con el mismo margen, y anotado en el progress para F-013                                            | Lectura de `scripts/check-bundle-budget.mjs` + `.agent/progress/F-010.md`                                                                                                                                  | **PASA** — `BUDGET_KB` por defecto = 193 (182.1 medido + ~10 KB de margen, el mismo que usaba F-004); `.agent/progress/F-010.md` § «número medido del presupuesto de bundle (SP4, paso 15)» anota 182.1 KB y el criterio 4 de F-013 al que apunta.                                                                                                                                  |

### `V1`–`V6` de `design.md` (sin navegador)

| #   | Verificación                                                                       | Resultado                                                         |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| V1  | `disabled=""` ≥ 1 en la ficha de un producto agotado                               | **PASA** — 1 (vía `smoke.sh` y curl directo).                     |
| V2  | `/carrito` trae "Cargando tu carrito…" y `<noscript>` en el HTML servido           | **PASA** (vía `smoke.sh`).                                        |
| V3  | `/checkout` trae "Nombre y apellidos" en el HTML servido                           | **PASA** (vía `smoke.sh`).                                        |
| V4  | `wa.me` ≥1 en tienda WHATSAPP, 0 en tienda ONSITE                                  | **PASA** — verificado también manualmente (criterio 11 arriba).   |
| V5  | `/pedido/[code]` no añade chunks de cliente respecto a la tienda                   | **PASA** (vía `smoke.sh`: mismo conteo de `_next/static/chunks`). |
| V6  | La cabecera trae "Carrito" en toda página de tienda, sin burbuja antes de hidratar | **PASA** (vía `smoke.sh`).                                        |

### `V7`–`V22` de `design.md` — ejecutados en este ciclo con Playwright

Todos se ejecutaron contra `http://localhost:3057` (confirmado antes de
empezar: `curl -s -o /dev/null -w '%{http_code}' .../tienda-demo/carrito` →
`200`), con pedidos reales creados vía `POST /api/orders` para tener un
`code` en cada `checkoutMode` (`KZ6DDEYG9E` en `tienda-demo`/`WHATSAPP`,
`7J1WQ772GW` en `tienda-dos`/`ONSITE`). Nota de contexto: el servidor de
`:3057` está corriendo `next dev` (Turbopack), no una build de producción —
no cambia ningún resultado funcional, pero sí explica los nombres de chunk
con hash de dev-mode que aparecen en V5.

| #   | Verificación                                                                                                                                                       | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V7  | 360px, `/tienda-demo/carrito` con 3+ líneas: sin scroll horizontal, barra fija no tapa la última línea, targets ≥44px                                              | **PASA.** `scrollWidth === clientWidth` (360=360). Los nueve controles medidos (`−`/`+`/`Quitar` × 3 líneas) dan `44×44` (o `64×44` en `Quitar`). Con 8 líneas forzando scroll, la barra `.fixed.bottom-0` (top=595) no se solapa con la última fila `Quitar` (bottom=367). Capturas: `v7-cart-360.png`, `v7-cart-360-scrolled-fixed.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V8  | 360px, `/tienda-demo/checkout`: `Confirmar` no queda `fixed`/`sticky` (para no taparse con el teclado)                                                             | **PASA.** El botón y sus 4 ancestros más cercanos son todos `position: static`. Consistente con design.md: "**No** se hace `sticky`". No pude simular la apertura real del teclado virtual (Playwright no la modela), así que esto verifica la propiedad CSS que la garantiza, no el teclado en sí.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| V9  | 768px: resumen del checkout **desplegado**; nombre y teléfono en la misma fila                                                                                     | **PARCIAL — un fallo real.** Nombre/teléfono: **PASA** (mismo `top`, 250px). Resumen desplegado: **FALLA.** El `<details>` de `CheckoutForm.tsx:371` no lleva el atributo `open` en ningún breakpoint — se ve colapsado (`▶ Tu pedido · 2 productos · $710.00`) igual a 360 que a 768. Ver § Fallos de la revisión visual. Captura: `v9-checkout-768.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V10 | 1280px: carrito y checkout a dos columnas, resumen `sticky`                                                                                                        | **PASA.** `grid-template-columns: 752px 320px` en el carrito (contenido + resumen). Capturas: `v10-cart-1280.png`, `v10-checkout-1280.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| V11 | La lista no salta entre F1 (provisional) y F2 (cotizado)                                                                                                           | **PASA** para la propiedad que design.md exige. Con la cotización retrasada artificialmente (interceptando `/api/orders/quote` +1.2s) medí `getBoundingClientRect()` de las 3 filas en F1 y en F2: **idénticas** (`top`/`height` byte a byte). Nota aparte: un `PerformanceObserver` de `layout-shift` sobre la carga completa de la página sí registró un CLS de 0.138, pero sus `sources` son `FOOTER`/`A` (el pie de página, probablemente por intercambio de fuente web) — no las filas del carrito. Fuera del alcance de V11 tal como lo define design.md; lo anoto, no lo cuento como fallo de este paso.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| V12 | Cotización lenta (interceptada a +3.5s, imitando Slow 4G real): precio provisional + `Calculando…`, `Continuar` deshabilitado, mensaje de conexión lenta a los ~3s | **PASA.** Secuencia medida con muestreo cada 150ms: `quote REQUEST` en t=121ms; `Calculando…` visible entre t≈565ms y t≈3095ms; el texto "conexión lenta" aparece entre t=3095ms y t=3601ms (el timer usa `CART_QUOTE_SLOW_MS=3000` en `src/constants/cart.ts`, medido correcto); `quote RESPONSE` en t=4150ms; tras eso desaparecen `Calculando…` y el aviso y sale `Subtotal actualizado`. `Continuar` estuvo `disabled` todo el tramo. (El throttling de red real de CDP —1.6Mbps/750kbps/150ms, el perfil "Slow 4G" de Lighthouse— no alcanzó a retrasar la cotización más de ~150ms porque el payload es minúsculo; até el timer directamente interceptando la petición, que es lo que de verdad ejercita la lógica del cliente.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| V13 | Cotización caída: banner, lista con precios provisionales, `Reintentar`, y solo tras un reintento fallido aparece `Continuar de todos modos`                       | **PASA la conducta real; el enunciado del paso no se puede seguir literalmente.** Interpretación (a) literal — "Offline + recargar" con `context.setOffline(true)` **antes** de navegar: la navegación entera falla (`net::ERR_INTERNET_DISCONNECTED`, página en blanco) porque las rutas `ƒ` son `force-dynamic` sin caché — no hay HTML que el navegador pueda mostrar sin red, y esto no es arreglable sin un service worker (fuera de alcance). Interpretación (b) funcional — la que design.md realmente describe en su tabla de estados ("la lista sigue en pantalla con los precios provisionales"): cargué el carrito **online**, y luego até la red antes de disparar una recotización (subir cantidad). Aquí sí: banner `danger` con el texto exacto, la lista con los 2 productos y sus precios provisionales sigue visible, `Reintentar` presente, `Continuar` deshabilitado (con el texto `sr-only` "No se pudo calcular el total." enlazado por `aria-describedby`, tal como pide § Accesibilidad), y `Continuar de todos modos` **no** aparece hasta después de pulsar `Reintentar` y que ese reintento también falle. Capturas: `v13-scenarioB-offline-error.png`, `v13-scenarioB-after-retry.png`. Ver `TP1`. |
| V14 | Recotización: 3 clics en `+` seguidos → cantidad sube al instante, **una** petición tras el rebote                                                                 | **PASA.** `input[inputmode=numeric]` pasó a `4` (de 1) inmediatamente tras los 3 clics, antes de esperar nada. Contador de peticiones `POST /api/orders/quote` tras el rebote de 400ms: exactamente **1**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V15 | Checkout con la cotización caída desde el arranque: campos tecleables, `Confirmar` nunca se habilita                                                               | **PASA.** Con `/api/orders/quote` abortada desde el primer intento: el campo `Nombre y apellidos` acepta texto igual (`fill` + `inputValue` confirmado), aparece el banner "No pudimos calcular el total." con "Reintentar", `Confirmar pedido` queda `disabled` antes **y después** de un reintento fallido, y a diferencia del carrito **no** se ofrece "Continuar de todos modos" en ningún momento (confirmado ausente). `tienda-demo` no tiene delivery, así que no hay bloque de entrega que mostrar "cargando" — coherente con la fila de design.md para esa combinación.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V16 | Branding: tienda-demo vs tienda-dos se ven distintas, importes igual de legibles                                                                                   | **PASA.** `tienda-demo`: cabecera y botón `lab(46.1 7.9 -65.4)` (azul), `border-radius: 10px`. `tienda-dos`: `oklch(0.62 0.17 145)` (verde), `border-radius: 20px`. Capturas: `v16-tienda-demo-product.png`, `v16-tienda-dos-product.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V17 | Modo oscuro en carrito, carrito-con-error y checkout-con-error                                                                                                     | **PASA.** `colorScheme: "dark"` de Playwright activa el CSS de `prefers-color-scheme: dark`. Inspección visual de las 3 capturas (`v17-cart-dark.png`, `v17-cart-dark-error.png`, `v17-checkout-dark.png`): el banner `danger` mantiene texto rojo legible sobre fondo oscuro rojizo translúcido, el resto del texto en blanco/gris claro sobre fondo casi negro, sin bloques blancos perdidos.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| V18 | Teclado solo: primer tab en el catálogo, y en un envío inválido el foco cae en el resumen de errores y el enlace de un campo lleva al campo                        | **PARCIAL — un fallo real.** Enlaces del resumen de errores: **PASA** (`<a href="#field-phone">` presente, clicarlo mueve el foco a `#field-phone`). `aria-invalid`/`aria-describedby` del campo: **PASA** (`aria-invalid="true"`, `aria-describedby="field-phone-help field-phone-error"`). Primer tab del catálogo: **PASA** (cae en el nombre de la tienda, orden esperado). **Pero el foco automático al `role="alert"` en el PRIMER envío fallido NO ocurre**: tras pulsar `Confirmar pedido` con el formulario vacío, `document.activeElement` sigue siendo el botón, no el `<div role="alert" tabindex="-1">`. En un SEGUNDO clic sí funciona (el `<div>` ya existe en el DOM de un render anterior). Ver § Fallos de la revisión visual — `CheckoutForm.tsx:218`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| V19 | Lector de pantalla (VoiceOver): anuncios de cantidad, `Subtotal actualizado` una vez, error de teléfono, código deletreado                                         | **NO EJECUTADO como tal — sin VoiceOver disponible.** Playwright no controla un lector de pantalla real. Verifiqué en su lugar, por inspección de la propia accesibilidad subyacente (no es lo mismo que oírlo): el contenedor del subtotal lleva `aria-live="polite"` + `aria-busy`, y el texto `sr-only` `"Subtotal actualizado: $X."` aparece una vez que `status` deja de ser `loading` (confirmado en el `innerText` scrapeado durante V12/V13). No verifiqué el deletreo del código del pedido ni el anuncio real por audio. Hueco de cobertura genuino — ver `TP2`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V20 | `localStorage` bloqueado: agrega en memoria, aviso `warning`, llega a confirmar sin errores de consola                                                             | **PASA.** Con `localStorage` reemplazado por un objeto que lanza `SecurityError` en cada método: agregar funciona, aparece "Tu navegador no está guardando el carrito..."; **cero** entradas en `console.error`/`pageerror` en toda la sesión. El carrito sobrevive a una navegación **de cliente** (clic en `Ver carrito`, luego clic en `Continuar`) hasta el checkout, donde el resumen muestra correctamente "1 producto · $620.00". Una recarga dura (`page.reload()`) sí lo pierde y muestra "Tu carrito está vacío" — es la conducta documentada por el propio texto de aviso ("no cierres esta pestaña"), no un fallo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| V21 | Sin JavaScript: catálogo y ficha completos; `/carrito` con `noscript`, no "Cargando…" eterno                                                                       | **PASA con una nota menor.** Catálogo y ficha de producto: HTML completo y legible con `javaScriptEnabled: false`, precio y botón "Agregar al carrito" presentes. `/carrito`: el `<noscript>` ("Para armar un pedido necesitas activar JavaScript...Ver el catálogo") se renderiza y el enlace funciona — pero **el texto "Cargando tu carrito…" queda visible permanentemente al lado**, porque nada lo oculta cuando no hay JS. No es un callejón sin salida (el enlace útil está ahí), pero es redundante/confuso: "Cargando…" implica que algo va a terminar de cargar, y sin JS nunca lo hará. Severidad menor. Ver § Fallos de la revisión visual.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V22 | Ficha con red lenta: precio y botón visibles antes de hidratar, el botón responde en cuanto hidrata                                                                | **PASA.** A ~50ms tras `domcontentloaded` (con throttling CDP 1.6Mbps/750kbps/150ms), el precio (`$620.00`) y el botón "Agregar al carrito" ya están en el HTML servido. Tras la hidratación, el clic funciona: pasa a "✓ Agregado" y aparece "En tu carrito: 1 · Ver carrito".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**V4 y V5, reconfirmados con navegador** (ya estaban `PASA` por `curl` en el
ciclo anterior): en `tienda-demo/pedido/KZ6DDEYG9E` (WHATSAPP) hay 1 enlace
`a[href*="wa.me"]`; en `tienda-dos/pedido/7J1WQ772GW` (ONSITE) hay 0. El
conjunto de chunks de cliente servidos en el HTML de `/pedido/[code]` (15,
vía `curl | grep -oE 'src="..."' | sort -u`) es casi idéntico al de
`/tienda-demo` (15, difiere en 1 nombre hasheado por dev-mode): la única
diferencia real esperada es el chunk compartido de `CartBadge`, que **sí**
debe estar en ambas páginas por DP3 — la página del pedido en sí sigue sin
aportar ningún módulo de cliente propio.

**Hallazgo aparte, no un fallo de ningún `V`:** el enlace `wa.me` generado
incluye `Ver el pedido: http://localhost:3000/...` en vez de `:3057`. Viene
de `src/lib/env.ts:35` (`NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`) —
es el valor por defecto documentado del código, no un bug; simplemente esta
sesión no tenía `NEXT_PUBLIC_SITE_URL` apuntando a `:3057` en `.env`. Sin
acción — anotado por si alguien más se confunde con el enlace generado en
pruebas locales.

## Ejecuciones

```
$ bash .agent/verify.sh F-010 --full
== Verificación F-010 · intento 53 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       2s
  ✓ format     2s
  ✓ test       1s
  ✓ prisma     1s
  ✓ build      3s
  ✓ theme      0s
  ✓ bundle     0s
PASA
```

Nota: el primer intento de este ciclo (intento 47) SÍ falló en `harness`, con
la misma firma que la ficha `check-harness-falso-positivo-ruta-abreviada`,
pero en una instancia nueva: no en `architecture.md` (que el arquitecto ya
había arreglado, según su entrada de bitácora de las 05:00), sino en la
**propia entrada de bitácora del arquitecto** en `.agent/progress/F-010.md`,
que citó el ejemplo de ruta abreviada envuelto en backticks — exactamente la
advertencia que la misma ficha hace sobre sí misma ("los ejemplos... van SIN
backticks a propósito"). Se resolvió solo entre mi primera y mi segunda
corrida (edición concurrente del arquitecto, que sigue trabajando en
paralelo) — no toqué `architecture.md` ni `progress.md` para arreglarlo.
Repetido al final del ciclo (intento 53): `PASA` limpio.

```
$ bash .agent/verify.sh F-010 --smoke
== Verificación F-010 · intento 54 ==
  ✓ typecheck  1s
  ✓ lint       2s
  ✓ format     1s
  ✓ test       1s
  ✓ smoke      3s
PASA
```

Log completo con la salida del servidor real (no solo el resultado):
`.agent/runs/F-010/050-smoke.log` — 0 aserciones fallidas, incluidas las 8
líneas `GET`/`POST` del servidor de Next para cada paso.

```
$ npx vitest run
 Test Files  23 passed (23)
      Tests  204 passed (204)
```

(Incluye el archivo nuevo `AddToCartButton.test.tsx`, 3 tests, escrito en
este ciclo — ver § Fallos encontrados.)

```
$ npm run seed   (dos veces seguidas)
Done: { stores: 2, canonical: 17, aliases: 20, products: 20 }
Done: { stores: 2, canonical: 17, aliases: 20, products: 20 }
```

Idempotente — mismo conteo las dos veces, y `checkoutMode`/`deliveryEnabled`/
`deliveryFee` de las dos tiendas y los 6 `Order` de las pruebas anteriores
sobrevivieron al reseed sin duplicarse ni perderse.

```
$ bash .agent/verify.sh pending F-010
(sin salida — nada pendiente)
```

## Fallos encontrados

**Ninguno que bloquee.** Un hallazgo de cobertura, corregido en este mismo
ciclo (no es un fallo del feature, es una prueba que faltaba):

- **Severidad: menor.** El criterio 2(b) de `spec.md` («test jsdom: `add()` de
  un producto agotado deja el carrito igual») describe una prueba que no
  correspondía a la arquitectura real: `cartStore.ts` `add()` **no tiene
  conocimiento de disponibilidad** — es una decisión de arquitectura
  deliberada (el módulo de carrito es solo líneas, sin dominio). La única
  barrera contra agregar un producto agotado vive en
  `src/features/cart/components/AddToCartButton.tsx` (el `disabled` que
  calcula el servidor llega al `<button>` nativo y el `onClick` nunca llama a
  `cart.add()`), y no había ningún test que ejercitara esa barrera con un
  click real — solo se verificaba con `curl` que el HTML trae el atributo
  (V1), que no prueba que el click esté bloqueado si alguien lo fuerza.
  **Escribí `src/features/cart/components/AddToCartButton.test.tsx`** (3
  tests, con `@testing-library/react`, ya en `package.json`): confirma que el
  botón deshabilitado es un `<button disabled>` nativo, que un click sobre él
  NO agrega la línea (ni a memoria ni a `localStorage`), y —caso de control—
  que un producto disponible sí se agrega. `npx vitest run --project ui
src/features/cart/components/AddToCartButton.test.tsx` → 3/3, y
  `npx prettier --write` + `npx eslint` limpios. No toqué código de producto,
  solo agregué la prueba que faltaba. **Destinatario: ninguno** — no es un
  bug, es una prueba nueva que ya cierra el hueco; lo anoto para que quede
  constancia de por qué el comando literal de `spec.md` (b) no se pudo seguir
  al pie de la letra.
- **Servidor de desarrollo obsoleto en :3000.** Encontré un `next-server`
  corriendo desde hacía 14h47m que respondía 404 en `/api/orders` (de antes
  de F-010). No es un fallo del feature — es una instancia vieja de otra
  sesión — pero **si alguien prueba F-010 contra ese puerto sin darse cuenta,
  va a ver fallos falsos**. Lo dejé sin tocar (no sé si pertenece a otra
  sesión activa) y usé `:3057` (`npm run build && npm run start -- -p 3057`)
  para todo. Sin ficha nueva: no es un fallo reproducible del código, es un
  problema de higiene de puertos entre sesiones — anotado aquí para quien
  retome.

`bash .agent/verify.sh pending F-010` está vacío: no hay fallos de esta
sesión sin fichar.

## Fallos de la revisión visual (V7–V22, ciclo de Playwright)

Dos fallos reales. Ninguno de los dos rompe ningún comando de
`.agent/verify.sh` ni ningún `acceptance_criteria` de los 21 ya verificados
(por eso no toco el veredicto), pero ambos son conducta observable distinta
de lo que `design.md` promete, así que se reportan como fallos, no como
"hueco de cobertura".

- **Severidad: moderada — accesibilidad del checkout, `CheckoutForm.tsx:218`.**
  Al fallar la validación del formulario **por primera vez**, el foco no se
  mueve al resumen de errores (`<div role="alert" tabindex="-1">`), pese a que
  design.md § Accesibilidad lo exige explícitamente ("un `<div role="alert"
tabindex="-1">` arriba recibe el foco por programa"). Verificado con
  Playwright: tras pulsar `Confirmar pedido` con el formulario vacío,
  `document.activeElement` sigue siendo el botón, no el `<div>`. En un
  **segundo** intento fallido sí funciona. Causa: `submit()` llama a
  `summaryRef.current?.focus()` de forma síncrona, en la misma función que
  acaba de llamar a `setFieldErrors`/`setAttempted` — pero el `<div
role="alert">` solo se monta cuando `attempted && Object.keys(fieldErrors).length
  > 0`es verdadero, y ese render todavía no se ha confirmado cuando`.focus()`se ejecuta, así que`summaryRef.current`es`null`la primera
vez (el nodo ya existe de un render anterior a partir del segundo intento,
por eso "funciona" después). Para quien lo usa con teclado o lector de
pantalla, es exactamente el primer intento el que más importa: es el que
de verdad pierde la posición. **Destinatario:`sdd-implementer`.** Arreglo
típico: mover el `.focus()`a un`useEffect`con`attempted`/`fieldErrors`como dependencias (o`queueMicrotask`/`flushSync`), no dentro del manejador
  > síncrono del clic.
- **Severidad: menor — `<details>` del resumen del checkout no se abre en
  768px, `CheckoutForm.tsx:371`.** design.md § Estructura por breakpoint pide
  que a 768px el resumen salga `<details open>`; en la implementación el
  `<details>` no lleva el atributo `open` en ningún breakpoint (verificado:
  aparece colapsado igual a 360 que a 768, captura `v9-checkout-768.png`).
  Es coherente que así sea: `open` es un atributo HTML fijo, no se puede
  condicionar por media query sin JavaScript (`matchMedia` en el propio
  cliente, que ya es `"use client"`). No es un fallo funcional — el resumen
  se puede desplegar con un toque — pero es una desviación real y visible del
  diseño aprobado. **Destinatario: `sdd-designer` o `sdd-implementer`**, según
  decida el humano: o se acepta el colapso en todos los tamaños (ajustar
  design.md) o se agrega la lógica de `matchMedia` que el diseño exige
  (implementación).

## Huecos de cobertura

- **V19 (lector de pantalla), sin verificación real.** No hay VoiceOver ni
  ninguna otra herramienta de lectura de pantalla accesible desde esta sesión
  (Playwright controla el DOM/accesibilidad, no un lector real). Verifiqué
  por inspección la infraestructura que un lector usaría (`aria-live`,
  `aria-busy`, texto `sr-only` de "Subtotal actualizado", `aria-invalid` +
  `aria-describedby`), pero no oí ningún anuncio real ni confirmé el
  deletreo del código del pedido. Ver `TP2`.
- **V13, tal como está redactado en `design.md`, no es ejecutable literalmente.**
  "DevTools → Network → Offline, recargar `/carrito`" falla a nivel de
  navegador (`net::ERR_INTERNET_DISCONNECTED`, página en blanco) porque las
  rutas son `force-dynamic` sin caché — no hay HTML que mostrar sin red tras
  una recarga dura. La conducta que la tabla de estados de design.md describe
  sí se pudo verificar y pasa (ver V13 arriba), pero con una interpretación
  distinta del paso (conexión que cae **mientras la página ya está cargada**,
  no una recarga en frío). Ver `TP1`.
- **Herramienta de navegador pedida (`mcp__claude-in-chrome__*`) no estaba
  disponible en esta sesión**, pese a que el encargo la daba por conectada
  con un `deviceId` ya elegido. Usé Playwright como alternativa real (ver
  nota al principio del documento). Si el humano necesita específicamente la
  extensión de Chrome conectada a su navegador local (por ejemplo para mirar
  algo en vivo junto con el agente), este ciclo no lo cubre — cubre
  "ejecutar en un navegador real y ver el resultado", que es la regla que
  manda, pero no es literalmente lo que pedía el encargo.
- **Cuota de reintentos del `code` (5, ante colisión real)**: `impl.md` ya lo
  anota como deuda — probado con mock, no forzando una colisión real contra
  Postgres. No lo reproduje tampoco (forzar una colisión de 50 bits de
  aleatoriedad no es practicable en una sesión de prueba).
- **Deuda de copy** (dos casos, ya en `impl.md` § Deuda dejada, sin criterio
  que los cubra): el texto de "Agotado" se mantiene cuando la causa real es falta
  de precio resoluble (no stock), y la indistinción entre carrito vacío de
  siempre vs. carrito caducado (R15). Ningún `acceptance_criteria` los
  exige; los dejo anotados, no los fabrico como fallo.
- **I7 (`pullOrders` sin filtro por negocio)**: sigue sin arreglarse, a
  propósito (fuera del alcance de F-010, ver plan.md § Qué queda fuera).
  Desde este ciclo hay datos reales de nombre/teléfono/dirección que ese
  hueco expone — lo repito porque es lo que plan.md pidió que se viera
  escrito, no porque sea nuevo.

## Veredicto

**LISTO.** Los 6 `acceptance_criteria` literales de `features.json` y los 15
criterios `[nuevo]` de `spec.md` (7–21) se verificaron **ejecutando algo**:
comando, petición HTTP o test, con su salida real pegada arriba — ninguno se
dio por bueno leyendo código. `bash .agent/verify.sh F-010 --full` → `PASA`
(0). `bash .agent/verify.sh F-010 --smoke` → `PASA` (0), con la salida del
servidor guardada. `bash .agent/verify.sh pending F-010` → vacío.

**Actualización de este ciclo:** `V7`–`V22` de `design.md` ya se ejecutaron
(con Playwright, ver arriba — no la extensión de Chrome que pedía el
encargo, que no estaba disponible en esta caja de herramientas). 20 de los
22 pasos pasan. Encontré **dos fallos reales** (§ Fallos de la revisión
visual): uno moderado (foco no se mueve al resumen de errores en el primer
envío inválido del checkout, `CheckoutForm.tsx:218`) y uno menor (el resumen
del checkout no se abre solo en 768px, `CheckoutForm.tsx:371`). **Ninguno de
los dos toca los 21 `acceptance_criteria`** que sostienen el veredicto de
arriba — por eso se mantiene `LISTO` — pero el hallazgo moderado es en la
pantalla que el propio encargo señaló como la más delicada del feature, así
que **lo reporto en voz alta**: es motivo legítimo para que el humano decida
si reabre F-010 antes de darlo por visualmente terminado, o lo deja como
deuda registrada. Esa decisión no es mía (regla 3: cambiar el criterio o
reabrir el feature no me toca a mí).

Queda sin verificar de verdad solo **V19** (lector de pantalla — no hay
VoiceOver disponible en esta sesión) y la interpretación literal de **V13**
("recargar en offline" no es reproducible tal como está escrito el paso, ver
`TP1`). Ambos son huecos de cobertura conocidos, no fallos.

## Preguntas al humano

- **TP1** — `design.md` § Verificación, paso `V13`, dice "DevTools → Network
  → Offline, **recargar** `/carrito`". Ejecutado tal cual, eso falla a nivel
  de navegador (`net::ERR_INTERNET_DISCONNECTED`, página en blanco) porque
  las rutas son `force-dynamic` sin caché: no hay HTML que mostrar sin red
  tras una recarga dura, y no hay forma de arreglar eso sin un service
  worker (fuera de alcance de F-010). La conducta que la tabla de estados de
  design.md realmente describe ("la lista sigue en pantalla con los precios
  provisionales") sí ocurre y pasa, pero solo si la interpretación es "la
  página ya estaba cargada y la conexión cae después", no "recargar en
  frío". ¿Se corrige la redacción de `design.md` (yo no debo tocarlo), o se
  documenta como limitación conocida sin service worker?
- **TP2** — No tengo forma de correr un lector de pantalla real (VoiceOver)
  en esta sesión — ninguna herramienta disponible lo controla. Verifiqué la
  infraestructura de accesibilidad subyacente (`aria-live`, `sr-only`,
  `aria-describedby`) pero no el anuncio audible real ni el deletreo del
  código del pedido (V19). ¿Vale esa verificación indirecta como suficiente
  para cerrar V19, o se necesita a alguien con VoiceOver de verdad antes de
  darlo por hecho?
