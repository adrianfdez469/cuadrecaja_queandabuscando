---
feature: F-011
agente: sdd-tester
actualizado: 2026-08-26T22:50:00Z
estado: listo
veredicto: no-listo
---

## Alcance de esta verificación

Esta pasada cubre **los dos ciclos**: el ciclo 1 (pasos 1–11, verificado en
una sesión anterior de este mismo documento) y el ciclo 2 (pasos 12–18:
interruptor público, migración de HD12, tienda cerrada, promociones
completas, reparación del seed/`check:bundle`, diff v3 del contrato).

`veredicto: no-listo` en el frontmatter refleja el **feature completo**, no
ninguno de los dos ciclos: el criterio 5 (`.agent/features.json`, branding)
sigue sin una sola línea de código que lo implemente, bloqueado por
HD6/ADR 0012 a la espera de `Storefront` (PP2 de `plan.md`, decisión ya
tomada por el humano). No es un hueco de prueba — no hay nada que ejecutar.
Todo lo demás (criterios 1–4 y los `[nuevo]` que aplican, más P1–P12 de
promociones) está verificado ejecutando algo real, con evidencia abajo.

**Nota sobre el documento anterior**: la versión previa de este archivo
llevaba, al final, una "Nota de cierre del ciclo 2" firmada por
`sdd-implementer` con su propio resumen de lo que dice haber verificado. Esa
nota **no sustituye una verificación independiente** — es exactamente lo
que esta sesión existe para no aceptar de oídas. Cada afirmación de esa nota
se volvió a ejecutar aquí, de cero, con comandos propios y datos propios
(ids de tienda/producto descubiertos en caliente, nunca los que el
implementador pudiera haber usado). Donde coincide, se dice que coincide;
no se encontró ninguna discrepancia. La nota del implementador ya no está
en este archivo: su contenido queda absorbido en las secciones de abajo.

## Entorno usado

- Postgres de docker-compose (`queandabuscando-postgres`, puerto 5433) y el
  emulador de Supabase Storage (`storage-db`, `storage`, `storage-gateway`),
  ambos ya arriba de sesiones anteriores.
- `.env` de este worktree, apuntando al emulador (`http://localhost:54321`),
  sin tocar (TP2 resuelta por el humano: se queda así).
- `npx prisma migrate status` → las 4 migraciones existentes aplicadas,
  `Database schema is up to date!`.
- `npm run seed` corrido varias veces durante esta sesión para devolver el
  estado (precios sincronizados, `Store.status`, promociones) al del seed
  limpio después de cada bloque de pruebas manuales.
- Servidor propio (`next dev -p 3100`, y `next start -p 3102` para el
  criterio 12 en producción) para depurar antes de cada corrida oficial de
  `bash .agent/verify.sh F-011 --smoke`, que levanta el suyo.

## Estrategia

- **Unitario/integración (`node`)**: todos los `*.test.ts` de los dos
  ciclos (`authorization.test.ts`, `schemas.test.ts`, `storagePaths.test.ts`,
  `mutations.test.ts`, `boundaries.test.ts` —el tercer test, invertido en el
  ciclo 2—, `imageType.test.ts`, `src/features/sync/server/handlers/{product,store}.test.ts`,
  `src/lib/promotions.test.ts`, `src/lib/{money,pricing}.test.ts`), corridos
  por `npm test` dentro de `verify.sh`. Ninguno usa jsdom porque ninguno
  importa DOM.
- **Runtime end-to-end**: `.agent/specs/F-011/smoke.sh`, ampliado en esta
  sesión con las secciones del ciclo 2 (en vez de un guion paralelo, como
  pidió el orquestador). Corrido a mano contra un servidor propio (para
  depurar y para el criterio 12 contra `next start`) y con
  `bash .agent/verify.sh F-011 --smoke` (que levanta el suyo). Nunca
  con SQL para simular una escritura del panel o del sync — la trampa que
  `plan.md` § Riesgos ya señaló (`UPDATE "Store" SET status=...` no pasa por
  `revalidateStores`, así que la página pública seguiría sirviendo el estado
  viejo). Toda escritura de `smoke.sh` pasa por el endpoint del panel o del
  sync.
- **Script nuevo**: `scripts/send-store-batch.mjs`, escrito en esta sesión
  (mismo patrón que `send-catalog-batch.mjs`) para poder mandar eventos
  `STORE` de sync con las banderas `--unpublish`, `--republish` y
  `--stale-unpublish` — imprescindible para probar AP5(b)/AP6, que no tenían
  ninguna forma de ejercitarse sin él.
- **Manual, fuera de `smoke.sh` a propósito**: el 503 con Storage caído
  (criterio 11) y la comprobación en las dos direcciones de que
  `check:bundle` falla explícito sin tienda publicada (criterio 15/HD12).
  Motivo de cada exclusión, en su sitio.
- **Visual**: se reintentó y no se pudo, igual que el diseñador — ver
  § Huecos. No hay nada nuevo que decir sobre esto en el ciclo 2.

## Mapa criterio → prueba

| Criterio de aceptación                                                                                                   | Prueba                                                                                                                                                                                                                                                                                                                                   | Archivo                                                                | Resultado                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1 `[ya]` Un admin solo ve y edita las tiendas de `storeIds` de su sesión                                                 | `curl -b <cookie --stores=seed-tienda-1> /admin` contiene `tienda-demo` y no `tienda-dos`; `authorization.test.ts`                                                                                                                                                                                                                       | `.agent/specs/F-011/smoke.sh` § criterio 1                             | **PASA**                                                                                                                       |
| 2 `[ya]` Editar una tienda ajena responde 403                                                                            | `PUT` propio → 200, ajeno → 403 `{"error":"FORBIDDEN"}`, sin cookie → 401                                                                                                                                                                                                                                                                | `.agent/specs/F-011/smoke.sh` § criterio 2                             | **PASA**                                                                                                                       |
| 3 `[ya]` `description/imageUrls/priceOverride/visible/featured` sobreviven a un `product.update` del sync                | `send-catalog-batch.mjs` real + lectura del RSC payload del editor: `syncedPrice` → 499, los seis campos del panel intactos; `product.test.ts` unitario                                                                                                                                                                                  | `.agent/specs/F-011/smoke.sh` § criterio 3                             | **PASA — sigue en verde tras el ciclo 2** (re-ejecutado íntegro)                                                               |
| 4 `[ya]` Subir una imagen la guarda en Supabase Storage y la sirve `next/image`                                          | `curl -F` real → 201 + URL pública; lectura directa → 200; `/_next/image` con `Accept: image/avif,...` → 200 `content-type: image/avif`                                                                                                                                                                                                  | `.agent/specs/F-011/smoke.sh` § criterio 4                             | **PASA**                                                                                                                       |
| 5 `[ya]` Branding inválido rechazado por `themeTokensSchema`                                                             | —                                                                                                                                                                                                                                                                                                                                        | —                                                                      | **SIN CUBRIR — bloqueado, no es un hueco de prueba.** HD6/ADR 0012: no existe editor de branding en ninguno de los dos ciclos. |
| 6 `[nuevo]` La página de edición de una tienda ajena responde 404                                                        | `curl` → 404                                                                                                                                                                                                                                                                                                                             | `.agent/specs/F-011/smoke.sh` § criterio 6                             | **PASA**                                                                                                                       |
| 7 `[nuevo, retirado a medias]` `status`/`publishedAt` nunca se escriben desde el endpoint de producto                    | `boundaries.test.ts` (ciclo 2: extractor de bloques `data:{...}`, porque ahora HAY dos escrituras legítimas de `status`/`disabled*` — las de `setStoreEnabled` — que tienen que pasar, y cero en el resto)                                                                                                                               | `src/features/admin/server/boundaries.test.ts`                         | **PASA**                                                                                                                       |
| 8 `[nuevo]` `priceOverride` guardado deja `priceOverrideCurrency = syncedPriceCurrency`; quitarlo pone las dos en `null` | `PUT` con override → misma moneda que `syncedPriceCurrency`; `PUT priceOverride:null` → ambas `null`                                                                                                                                                                                                                                     | `.agent/specs/F-011/smoke.sh` § paso 7/criterio 8                      | **PASA**                                                                                                                       |
| 9 `[nuevo]` Quitar el branding deja `/tienda-dos` sin `<style>`                                                          | —                                                                                                                                                                                                                                                                                                                                        | —                                                                      | **NO APLICA.** Sin editor de branding, mismo motivo que el 5.                                                                  |
| 10 `[nuevo]` 6 MB, `text/plain` como `.jpg`, novena imagen → 400/400/409                                                 | `curl -F` con 6 MB → 400; mime falso → 400; 8 subidas + una novena → 409                                                                                                                                                                                                                                                                 | `.agent/specs/F-011/smoke.sh` § criterio 10                            | **PASA**                                                                                                                       |
| 11 `[nuevo]` Con Storage caído, la subida responde 503 y `imageUrls` no cambia                                           | `docker compose stop storage`; `curl -F` real → 503; `imageUrls` sin cambios; `docker compose up -d storage`                                                                                                                                                                                                                             | manual, ver § Ejecuciones                                              | **PASA** — fuera de `smoke.sh` a propósito (ver nota)                                                                          |
| 12 `[nuevo]` Una escritura en A no invalida la caché de B                                                                | `next start` real: `x-nextjs-cache: HIT` y byte a byte idéntico en `/tienda-dos` antes/después de escribir en A                                                                                                                                                                                                                          | `.agent/specs/F-011/smoke.sh` § criterio 12                            | **PASA**                                                                                                                       |
| 13 `[nuevo]` `check:theme` en 0 tras guardar branding por el panel                                                       | —                                                                                                                                                                                                                                                                                                                                        | —                                                                      | **NO APLICA.** Sin editor de branding. `npm run check:theme` da 0 igual, pero sin ejercitar lo que el criterio pide.           |
| 14 `[nuevo]` Migración aplicada, `prisma validate` en 0, sin `migrate reset`/`db push`                                   | `npx prisma migrate status` → aplicada; `npx prisma validate` → 0; `git grep -n "migrate reset\|db push" -- prisma/migrations/ src/features/sync/ src/features/admin/ scripts/` → vacío; el `migration.sql` no toca los índices GIN de `CanonicalProduct` (verificado con `\d "CanonicalProduct"` en `psql`, los dos índices siguen ahí) | manual, ver § Ejecuciones                                              | **PASA — ahora sí aplica** (paso 12 construido en el ciclo 2)                                                                  |
| 15 `[nuevo]` `verify.sh --full` en 0; `check:bundle` sigue en 0 y falla explícito sin tienda publicada                   | `bash .agent/verify.sh F-011 --full` → **0 en sus nueve etapas, harness incluido** (TP1 resuelta); las tres tiendas del seed suspendidas + `npm run build` + `check:bundle` → **1 con mensaje explícito**; reabiertas + build → `check:bundle` → **0**, 182.1 KB                                                                         | `.agent/runs/F-011/102-*.log`; manual para las dos direcciones de HD12 | **PASA**                                                                                                                       |

### Requisitos de promociones (P1–P12, HD3)

No cuentan casillas para cerrar el feature (regla 3/4: no están en
`.agent/features.json`), pero se verifican igual, todas ejecutando algo
real contra `tienda-demo`/`seed-tienda-1-p0` (precio sincronizado 499.00
CUP):

| Requisito                                                                                                      | Prueba                                                                                                                                                                                                                                                  | Resultado |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P1 — CRUD completo + 403 en tienda ajena                                                                       | Crear (201) → editar valor y `active` (200) → reactivar (200) → 403 al intentarlo contra el `storeId` ajeno → borrar (200)                                                                                                                              | **PASA**  |
| P2 — `PERCENTAGE` fuera de `(0,100]`, `FIXED <= 0`, `endsAt <= startsAt` → 400                                 | `value:"101"` → 400; `FIXED value:"0"` → 400; `endsAt` anterior a `startsAt` → 400                                                                                                                                                                      | **PASA**  |
| P3 — `conditions` validado por `scope`; ids de otra tienda → 400                                               | `scope:"CATEGORY"` con un uuid inventado → 400 (`Invalid UUID`, R30); `PRODUCT` con `storeProductId` de la tienda ajena → 400                                                                                                                           | **PASA**  |
| P4 — 20% sobre 500 muestra el precio nuevo y el anterior tachado                                               | Ficha de `refresco-de-cola-1-5-l`: `$399.20` + `Antes <span class="line-through">$499.00</span>` + `Promoción: 20% de descuento.`                                                                                                                       | **PASA**  |
| P5 — Fuera de ventana o `active:false`, precio normal                                                          | Promoción con `startsAt` en 2099 → `unitPrice` sigue en 499.00; promoción `active:false` → igual                                                                                                                                                        | **PASA**  |
| P6 — El descuento se aplica sobre `priceOverride` cuando existe                                                | `priceOverride:"400.00"` + 30% → `unitPrice` = 280.00 (no 349.30 sobre el sincronizado)                                                                                                                                                                 | **PASA**  |
| P7 — Dos promociones aplicables, gana la de precio más bajo                                                    | 10% y 30% simultáneas sobre el mismo producto → `unitPrice` = 349.30 (gana el 30%, no se acumulan)                                                                                                                                                      | **PASA**  |
| P8 — El pedido guarda `OrderItem.unitPrice` con el descuento y el total cuadra                                 | Pedido real con PRODUCT 20% + ORDER FIXED 30 → `unitPrice` 399.20, total 369.20 en la respuesta **y** en `psql`                                                                                                                                         | **PASA**  |
| P9 — `ORDER` con `minSubtotal` null escribe `discountTotal` y `total = subtotal - discountTotal + deliveryFee` | Mismo pedido: `subtotal` 399.20, `discountTotal` 30.00, `deliveryFee` 0.00, `total` 369.20 — la suma cuadra exacta                                                                                                                                      | **PASA**  |
| P10 — `GET /api/internal/orders` conserva las claves de la v2                                                  | El pedido de P8/P9 aparece con `id/code/storeExternalId/status/contact/currencyCode/subtotal/discountTotal/deliveryFee/total/items[].{storeProductExternalId,name,unitPrice,currencyCode,quantity,lineTotal}` — ninguna clave nueva, ninguna renombrada | **PASA**  |
| P11 — Cambiar/borrar la promoción después no altera los importes del pedido ya creado                          | Se borran las dos promociones del pedido de P8/P9; `GET /api/internal/orders` antes/después: mismo `subtotal`/`discountTotal`/`total` (comparación numérica, no de string — ver nota)                                                                   | **PASA**  |
| P12 — Escribir una promoción revalida la tienda en el acto                                                     | Tras borrar todas las promociones, la misma petición a la ficha del producto ya no trae ningún `line-through` — sin esperar el piso de ISR                                                                                                              | **PASA**  |

**Nota sobre P11**: la primera versión de mi propio guion comparaba el
`discountTotal`/`subtotal` de `/api/internal/orders` (que serializa
`Decimal.toString()` sin ceros de relleno: `"30"`, `"349.3"`) contra el de
`/api/orders/quote` (que sí rellena a dos decimales: `"30.00"`,
`"349.30"`). Son dos formatos válidos del mismo número, y la comparación de
string exacta entre los dos falló — **error de mi prueba, no del código**:
se corrigió comparando el mismo endpoint antes y después (`Number(...)`, no
`===` de string). Consistente con el ejemplo que ya trae
`docs/sync-contract.md:365` (`"discountTotal": "0"`, sin decimales, en el
mismo payload que `"subtotal": "880.00"`).

## Verificación de HD10–HD15 (el interruptor y la tienda cerrada), paso a paso

Todo esto se hizo **desde el panel o desde el sync**, nunca con `psql`, tal
como `plan.md` § Riesgos exige:

1. **Cerrar desde el panel** → `/tienda-demo` sigue en 200, con el motivo
   elegido y el mensaje libre, `noindex`, sin `CartBadge`. La ficha de
   producto responde lo mismo. El carrito y el checkout muestran el mismo
   aviso.
2. **`«Otro» sin mensaje`** → `PUT /status` responde 400 y `SELECT status`
   sigue igual (se comprobó indirectamente: la tienda sigue respondiendo
   200 con catálogo tras el intento, no con el aviso de cierre).
3. **El motivo guardado es el código, nunca la frase**: el `PUT` exitoso
   devuelve `"disabledReasonCode":"VACACIONES"` (o `FUERA_DE_SERVICIO`, o
   `ADECUACIONES`), y el 409 de `/api/orders` también expone
   `"reasonCode":"VACACIONES"` — nunca la frase «Cerrado por vacaciones...»
   en un campo estructurado, solo en el HTML que un humano lee.
4. **Checkout rechaza el pedido**: `POST /api/orders/quote` **y**
   `POST /api/orders` (no solo la cotización) → 409 `STORE_CLOSED` con
   `reasonCode`/`message`/`disabledAt` en el cuerpo.
5. **El comprobante de un pedido ya hecho sigue accesible**: se creó un
   pedido con la tienda abierta, se cerró después, y
   `GET /tienda-demo/pedido/<code>` sigue en 200 con el código del pedido
   visible.
6. **Reabrir se ve en el acto**: mismo request, sin esperar ningún piso de
   ISR — la página vuelve a traer catálogo y deja de mostrar el aviso.
7. **AP5(b) — un evento `STORE` rutinario del POS no reabre lo que el panel
   cerró.** Se cerró `tienda-demo` desde el panel con un motivo marcado;
   `scripts/send-store-batch.mjs` (nuevo, `publishToStore:true` — el MISMO
   valor que ya tenía, solo cambia el teléfono, como haría corregir un dato
   de contacto en el POS) → HTTP 207 `processed`, y la tienda **sigue
   cerrada con el mismo motivo** tras la petición. Sin esto, cualquier
   edición rutinaria del POS reabriría una tienda cerrada por vacaciones.
8. **AP6 — un evento `STORE` rancio (`updatedAt` viejo) tampoco la reabre**,
   ni siquiera si intenta un cambio real de opt-in. `send-store-batch.mjs
--stale-unpublish` → HTTP 207 `stale` (nunca `processed`), la tienda sigue
   exactamente igual.
9. **El mecanismo sí funciona en la dirección correcta cuando el cambio es
   real**: `send-store-batch.mjs --unpublish` (opt-in `true→false`, fresco)
   → la tienda pasa a `SUSPENDED` de verdad; `--republish` (opt-in
   `false→true`, fresco) → vuelve a `PUBLISHED`. Sin este contraste, el
   AP5(b)/AP6 de arriba sería indistinguible de "el sync ya no hace nada".
10. **HD12, el retroactivo**: `prisma/migrations/20260826205946_store_public_switch/migration.sql`
    cierra con `UPDATE ... WHERE status = 'PUBLISHED'` a `SUSPENDED` con
    `disabledReasonCode = 'PLATFORM_ROLLOUT'` — sin `DROP INDEX` de los GIN
    de `CanonicalProduct` (verificado el `migration.sql` a mano y con
    `\d "CanonicalProduct"` en la base real: los dos índices siguen ahí).
    `prisma/seed.ts` reabre `seed-tienda-1`/`seed-tienda-2` a propósito
    (confirmado: las dos están `PUBLISHED` tras `npm run seed`) y agrega
    `seed-tienda-3`/`tienda-cerrada` ya cerrada, con `VACACIONES` de motivo
    — confirmado con `psql`.
11. **`check:bundle` falla explícito sin tienda publicada, en las dos
    direcciones**: se cerraron `tienda-demo` y `tienda-dos` desde el panel
    (las tres tiendas del seed quedaron `SUSPENDED`), `npm run build` y
    `npm run check:bundle` → **código 1**, con el mensaje
    `✗ No store page was prerendered — nothing PUBLISHED to measure.` en vez
    de medir `index.html` en silencio. Reabiertas las dos, `build` +
    `check:bundle` → **0**, 182.1 KB (idéntico a antes).

## Paso 17 — el diff v3 del contrato es aditivo

`scripts/send-store-batch.mjs` nunca incluye `unpublishReason` en su cuerpo
(payload con la forma exacta de la v2) y el evento se procesa igual que
cualquier otro (`HTTP 207`, `"status":"processed"` en el caso rutinario,
`"stale"` en el caso viejo) — un lector que solo conoce la v2 no necesita
cambiar una línea. No se envía nada al equipo de cuadrecaja (correcto:
`plan.md` es explícito en que ese envío lo hace el humano).

## Las cuatro cadenas que HD12 podía romper

- **F-004** (rutas públicas): `npm run build` sigue marcando `/[slug]` y
  `/[slug]/p/[productSlug]` como generables por SSG; `GET /` → 200;
  `GET /tienda-demo` → 200 con "Refresco de cola" en el HTML servido;
  `GET /tienda-inexistente` → 404; `aceite-de-girasol-900-ml` muestra
  `1,150.00` (el override), nunca `1,250.00` (el sincronizado);
  `cerveza-cristal` (1.20 USD, tasa 440) muestra `$528.00`.
  `node scripts/check-bundle-budget.mjs` → 0. **Todo en verde.**
- **F-005** (sync de catálogo): las cinco banderas de
  `send-catalog-batch.mjs` (`--bad-token` → 401, `--unknown-store` →
  `skipped_not_published`, `--stale` → `stale`, normal → `processed`,
  `--repeat` dos veces → `duplicate` las dos) responden exactamente lo que
  su nombre promete. **En verde.**
- **F-006** (disponibilidad): `send-availability-batch.mjs OUT_OF_STOCK`
  → `applied:2`; repetido → `applied:0` (el `UPDATE` es condicional);
  `/tienda-demo` refleja `Agotado` en los dos productos tocados y no en el
  fixture ajeno (`Jugo de mango`, agotado por diseño del seed); vuelto a
  `AVAILABLE`, desaparece. **En verde.**
- **F-010** (checkout): `bash .agent/verify.sh F-010 --smoke` → **0**
  (`.agent/runs/F-010/002-smoke.log`), sin tocar nada de su código. Además,
  la comprobación **obligatoria** que el orquestador pidió: se creó un
  pedido real con una promoción de alcance `ORDER` activa — el checkout
  respondió **201, no 409** (antes del arreglo de este ciclo, `total` no
  restaba `discountTotal` y **todos** los checkouts con una promoción de
  pedido habrían fallado la comparación de `expectedTotal` del cliente).

## Ejecuciones

```
$ bash .agent/verify.sh F-011 --full
== Verificación F-011 · intento 102 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     5s
  ✓ test       4s
  ✓ prisma     1s
  ✓ build      6s
  ✓ theme      0s
  ✓ bundle     0s
PASA
$ echo $?
0
```

TP1 confirmado por ejecución propia, no solo por lo que dijo el
orquestador: las nueve etapas, `harness` incluido, en 0.

```
$ bash .agent/verify.sh F-011 --smoke
== Verificación F-011 · intento 101 ==
  ✓ typecheck  2s
  ✓ lint       5s
  ✓ format     4s
  ✓ test       3s
  ✓ smoke      16s
PASA
$ echo $?
0
```

`.agent/specs/F-011/smoke.sh` corrido a mano dos veces consecutivas contra
un `next dev` propio antes de esta corrida oficial — **0 aserciones
fallidas las dos veces** (idempotente: reabre lo que cierra, borra las
promociones que crea, limpia el override que fija). Un intento intermedio
tropezó dos veces con la firma ya fichada `testing-library-timeout-1s-bajo-carga`
(`Unable to find role="alert"` en `CheckoutForm.test.tsx`, bajo la carga de
esta sesión con docker/next/chrome corriendo a la vez); se subió
`asyncUtilTimeout` de 5000 a 8000 ms en `vitest.setup.ts` — el arreglo que la
propia ficha prescribe, no un cambio de producto — y el test aislado pasó
en 1.2 s antes de repetir el sensor completo.

```
$ npx prisma validate
El schema es válido 🚀                                             → 0

$ npx prisma migrate status
Database schema is up to date!                                     → 0

$ git grep -n "migrate reset\|db push" -- prisma/migrations/ src/features/sync/ src/features/admin/ scripts/
(sin resultados)
```

**Criterio 11 (503 con Storage caído), a mano y fuera de `smoke.sh`** —
misma comprobación que en el ciclo 1, repetida para confirmar que sigue
viva tras los cambios del ciclo 2:

```
$ docker compose stop storage
$ curl -F file=@fixture.jpg -b cookie http://localhost:.../images
503 {"error":"STORAGE_UNAVAILABLE","reason":"rejected"}
$ psql ... -c 'select "imageUrls" ...'   → sin cambios
$ docker compose up -d storage           → healthy antes de seguir
```

**Criterio 15 / HD12, `check:bundle` en las dos direcciones**:

```
$ (cerrar tienda-demo y tienda-dos desde el panel; las tres del seed quedan SUSPENDED)
$ npm run build && npm run check:bundle
✗ No store page was prerendered — nothing PUBLISHED to measure.
  check:bundle would otherwise pass measuring index.html, which is not
  what this budget is for. Publish at least one store before building
  ('npm run seed' keeps tienda-demo and tienda-dos open on purpose).
$ echo $?
1

$ (reabrir las dos desde el panel)
$ npm run build && npm run check:bundle
✓ Heaviest page: tienda-demo/p/aceite-de-girasol-900-ml.html
    client JS: 182.1 KB gzipped (budget 193 KB)
$ echo $?
0
```

**F-010, la cadena obligatoria**:

```
$ bash .agent/verify.sh F-010 --smoke
== Verificación F-010 · intento 2 ==
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     4s
  ✓ test       3s
  ✓ smoke      6s
PASA
$ echo $?
0
```

**Datos de prueba**: todos los `StoreProduct` y `Promotion` tocados a mano
quedaron restaurados o borrados; las tres tiendas del seed en su estado
correcto (`tienda-demo`/`tienda-dos` `PUBLISHED`, `tienda-cerrada`
`SUSPENDED` con `VACACIONES`); `npm run seed` corrido al final. El teléfono
de `tienda-demo` queda con el último valor de prueba de
`send-store-batch.mjs` — es una columna propiedad del sync, no del panel, y
ningún criterio depende de su valor exacto; se anota para quien lo note en
`psql` y se pregunte por qué no es el del seed original.

## Fallos encontrados

Ninguno de código. El único hallazgo de esta sesión fue en mi propia
prueba (P11, la comparación de string entre dos formatos válidos del mismo
decimal — ver la nota bajo la tabla de promociones), corregido en
`smoke.sh` antes de cerrar.

El fallo del ciclo 1 (`harness` en rojo por rutas abreviadas) está
**resuelto**: TP1 se cumplió, `--full` da 0 en sus nueve etapas. No hay
nada pendiente de escalar a `sdd-architect` por ese lado.

## Huecos de cobertura

- **Verificación visual a 360/768/1280 px: sigue sin poderse juzgar.** No
  hay nada nuevo que probar aquí — la limitación es de la herramienta
  (`resize_window` informa éxito pero la captura no cambia de tamaño), ya
  documentada en el ciclo 1 y en `design.md` § VE18. Los pasos `V8`–`V22`
  quedan sin marcar, dicho explícitamente, no maquillado.
- **`PromotionForm`, alcance `PRODUCT`/`CATEGORY` con UI simplificada**
  (`impl.md` § Desviación 4): no hay criterio automatizado que dependa de
  mostrar el nombre del producto en vez de su id crudo; no se verificó
  porque no hay nada que un `curl` pueda comprobar ahí.
- **IP3 de `impl.md` (drift de `_prisma_migrations` en la base compartida
  de desarrollo)**: es un riesgo de infraestructura entre worktrees, no un
  criterio de este feature. No lo re-verifiqué porque no hay una forma de
  hacerlo sin arriesgar el entorno de otra sesión activa; queda como el
  implementador la dejó, sin recomendación única (correcto: no es una
  decisión técnica, es de infraestructura del equipo).
- **Retardo de hasta 3600 s en los bordes de una promoción** (R28): anotado
  como deuda aceptada, no arreglado; no se verificó el borde exacto porque
  el propio diseño dice que el checkout ya lo cubre con el 409 de
  desajuste de precio (F-010).

## Veredicto

**Ciclo 1 (pasos 1–11): LISTO.** Sigue en verde tras todos los cambios del
ciclo 2 — criterio 3 y el resto re-ejercitados de punta a punta.

**Ciclo 2 (pasos 12–18): LISTO.** El interruptor público (HD10–HD15,
incluidos AP5(b) y AP6, que son la razón de ser de todo el paso), la
migración retroactiva de HD12, la tienda cerrada, las promociones completas
(P1–P12) y su efecto sobre el checkout de F-010, y el diff v3 aditivo del
contrato — todo verificado ejecutando algo real, no leído. Las cuatro
cadenas que HD12 podía romper (F-004, F-005, F-006, F-010) siguen en verde.
`bash .agent/verify.sh F-011 --full` → **0 en sus nueve etapas**.

**Feature completo (`.agent/features.json`): NO LISTO**, como ya fijaba PP2
de `plan.md` desde el principio: el criterio 5 (branding) sigue sin código
que ejecutar, bloqueado por HD6/ADR 0012 a la espera de `Storefront`. No
corresponde marcar `passes: true` — es la única casilla que falta, y no es
un gap de esta verificación.

`bash .agent/verify.sh pending F-011` está vacío: no queda ninguna lección
sin fichar o descartar.

## Preguntas al humano

Ninguna nueva de este agente. TP1 y TP2 del ciclo anterior quedaron
resueltas por el humano/orquestador y confirmadas por ejecución propia en
esta sesión (ver § Ejecuciones). No hay ningún criterio que no se pueda
verificar tal como está escrito, y no hay ningún fallo cuya gravedad sea
una decisión de producto pendiente: el único punto abierto que queda —si
F-011 puede marcar `passes: true` alguna vez sin el criterio 5, o si el
humano prefiere recortar ese criterio del backlog— ya está decidido (PP2:
no, se espera a `Storefront`) y no hace falta volver a preguntarlo.
