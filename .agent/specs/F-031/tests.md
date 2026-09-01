---
feature: F-031
agente: sdd-tester
actualizado: 2026-09-01T19:30:39Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno en el entorno que le toca por extensión
(`AGENTS.md` § Cosas que muerden):

- **`jsdom`** (`*.test.tsx`, proyecto `ui`): el DOM renderizado del checkout —
  es la única forma correcta de verificar el criterio 1, porque
  `GET /[slug]/checkout` no manda ningún importe (I10b de spec.md): los pide
  la isla de cliente a `POST /api/orders/quote`. Un `curl | grep` sobre esa
  ruta no vería nada.
- **`node`** (`*.test.ts`, proyectos `server` y `db`): la lógica de servidor
  ya escrita por `sdd-implementer` en las etapas 1-5 — `pull.ts`, `status.ts`,
  `expiry.ts`, `whatsapp.ts` — con Postgres real para el proyecto `db`.
- **Guion de punta a punta contra la app real**: scripts/quote-delivery-order.mjs
  (nuevo, esta etapa), misma forma que `scripts/renegotiate-order.mjs` —
  acuña su propio bearer, activa el modo cotizado **por SQL** sobre
  `tienda-demo` (única tienda `WHATSAPP` + envío verificable, I8 de spec.md),
  siembra sus propios pedidos por el checkout público, y **restaura la fila
  de la tienda en un `finally`** aunque una aserción falle. Cinco banderas:
  `--create` (criterios 2, 3, 10), `--pull` (criterio 4), `--quote`
  (criterios 5, 6), `--dispatch` (criterio 8), `--expire` (criterio 7a). Sin
  argumentos corre las cinco en orden, compartiendo la misma tienda sin que
  se pisen (cada aserción ancla a los pedidos que la propia corrida creó).

Corrida contra `next dev -p 3103` de este worktree — puerto propio,
comprobado con `lsof -a -p <PID> -d cwd -Fn` antes de usarlo (ficha
`next-dev-uno-por-directorio.md`): el `cwd` del proceso es
`/Users/adrian/orca/workspaces/queandabuscando/snapper`, no otro checkout.

**DP1, documentado aquí porque gobierna media docena de asertos.** Los
criterios 3 y 10 citan literalmente la cadena `'0,00'`. Medido con el `Intl`
del propio runtime: `formatMoney` usa el locale `es-CU`, que pone **punto**
decimal y **coma** de millares (`"$0.00"`, nunca `"0,00"`). Consecuencia
verificada: un `grep -c '0,00'` sobre cualquier pantalla de este feature
**siempre** da 0, la tienda cotice bien o mal — no protege nada. Y el
sustituto obvio, `grep -c '0.00'`, da **falso positivo** contra cualquier
total con millares (`"$1,000.00"` lo contiene). El humano decidió (bitácora,
2026-09-01T16:14:12Z) no tocar `features.json`: los doce criterios se
verifican **literales**, y lo que de verdad los protege son dos cosas que
este guion añade encima de la letra:

1. **Importes de prueba con centavos distintos de `"00"`.**
   `pickCentsProduct()` busca en vivo, entre los productos orderable de la
   tienda, el primero cuya conversión a la moneda del pedido no termina en
   `.00` — no asume que seguirá siendo "Leche en polvo 400 g" (MLC 3,50 →
   $736.75) si el seed cambia. Con esos importes, cualquier aserto que
   comparase cadenas contra `'0.00'` fallaría de verdad si el código
   imprimiera el cero.
2. **Asertos sobre las cinco cadenas exactas de `design.md` § El léxico**:
   `"Por confirmar"`, `"por confirmar"` (WhatsApp, minúscula), `"Total
parcial"`, `"más el envío por confirmar"` y la ausencia literal de
   `"$0.00"` en cualquier pantalla de un pedido sin cotizar. Estos SÍ dan
   falso si el código regresara a imprimir un cero disfrazado de "por
   confirmar".

## Mapa criterio → prueba

| #   | Criterio de aceptación (literal, `features.json`)                                                                   | Prueba                                                                                                                                                                                    | Archivo                                                                                                                                                                                                     | Resultado                                       |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | El HTML del checkout ofrece domicilio sin importe de envío ni total en firme                                        | DOM renderizado, radio sin dígitos, envío no es cifra, total parcial                                                                                                                      | `npx vitest run --project ui src/features/cart/components/CheckoutForm.test.tsx`                                                                                                                            | 4 passed                                        |
| 2   | `POST /api/orders` sin importe de envío; SQL distingue pendiente de `0.00`                                          | `--create`: `201`, `deliveryFee` `NULL` en la fila vs `0.00` real en el par de retiro                                                                                                     | `scripts/quote-delivery-order.mjs --create`                                                                                                                                                                 | 0 aserciones fallidas                           |
| 3   | La página del pedido muestra envío por confirmar y total parcial, ninguna cadena es `0,00`                          | mismo `--create`: cadenas exactas + nunca `$0.00` (DP1)                                                                                                                                   | `scripts/quote-delivery-order.mjs --create`                                                                                                                                                                 | 0 aserciones fallidas                           |
| 4   | El pull trae, en la MISMA respuesta, un pendiente y uno en `0.00`, distinguibles sin heurística                     | `--pull`: los dos en la misma respuesta, `deliveryFee` idéntico (`"0.00"`), solo `deliveryFeePending` distinto                                                                            | `scripts/quote-delivery-order.mjs --pull`                                                                                                                                                                   | 0 aserciones fallidas                           |
| 5   | Proponer con el envío cotizado deja `AWAITING_CUSTOMER`; aprobar deja `CONFIRMED` con el total completo             | `--quote`: `200`/`AWAITING_CUSTOMER`, luego `200`/`CONFIRMED` con `deliveryFee`/`total` completos, leídos de la base y del pull                                                           | `scripts/quote-delivery-order.mjs --quote`                                                                                                                                                                  | 0 aserciones fallidas                           |
| 6   | `rateSnapshot` no cambia entre crear y aprobar la cotización                                                        | mismo `--quote`: JSON canónico byte a byte antes/después                                                                                                                                  | `scripts/quote-delivery-order.mjs --quote`                                                                                                                                                                  | 0 aserciones fallidas                           |
| 7   | Un pedido con envío pendiente vence a las `orderExpiryHours` desde su CREACIÓN, forzando la fecha                   | (a) `--expire`: `UPDATE createdAt`, cron, `CANCELLED`/`EXPIRY`/motivo propio + R15 (no toca `AWAITING_CUSTOMER`) + idempotencia; (b) los tres casos contra Postgres real                  | `scripts/quote-delivery-order.mjs --expire` · `npx vitest run --project db src/features/orders/server/expiry.db.test.ts`                                                                                    | 0 aserciones fallidas · 12 passed               |
| 8   | `POST /orders/status` responde `409` sin cotizar en READY/IN_TRANSIT/DELIVERED, `200` una vez cotizado y aprobado   | `--dispatch`: los tres `409` sin escribir nada, `CONFIRMED`/`CANCELLED` siguen en `200`, `404` de negocio ajeno antes que la guarda de cotización (R17), luego `200` tras cotizar+aprobar | `scripts/quote-delivery-order.mjs --dispatch` · `npx vitest run --project server src/app/api/internal/orders/status/route.test.ts`                                                                          | 0 aserciones fallidas · 15 passed               |
| 9   | Una tienda de tarifa fija recorre checkout/creación/pull con los mismos importes; ninguno de los dos guiones tocado | `bash .agent/verify.sh F-010 --visual`; `scripts/place-order.mjs --store=tienda-dos --delivery`; diff vacío contra `main`                                                                 | `.agent/specs/F-010/visual.mjs` · `scripts/place-order.mjs`                                                                                                                                                 | 0 · 0 aserciones fallidas · sin salida          |
| 10  | El WhatsApp de un pedido sin cotizar no imprime `0,00` en envío ni en total                                         | unitario con `"$1,234.56"` (centavos ≠ `00`) + `--create` decodificando el `wa.me` real de `tienda-demo`                                                                                  | `npx vitest run --project server src/features/orders/whatsapp.test.ts` · `scripts/quote-delivery-order.mjs --create`                                                                                        | 11 passed · 0 aserciones fallidas               |
| 11  | `docs/sync-contract.md` documenta la v6, aditiva: un consumidor de la anterior sigue leyendo el pull                | (a) versión movida + aviso v7; (b) las claves de la v5 siguen presentes, `deliveryFee` sigue siendo string; (c) el consumidor viejo sigue funcionando                                     | `grep -n 'Versión 6' / grep -c 'v7' docs/sync-contract.md` · `npx vitest run --project server src/features/orders/server/pull.test.ts` · `scripts/pull-orders.mjs --paginate --store=bodega-central-vedado` | línea 3 / 4 · 18 passed · 0 aserciones fallidas |
| 12  | `bash .agent/verify.sh F-031 --full` termina en `0`                                                                 | las nueve etapas de `--full` (harness, typecheck, lint, format, test, prisma, build, theme y bundle)                                                                                      | `.agent/verify.sh`                                                                                                                                                                                          | código 0, 1092 tests                            |

Los doce tienen fila y comando ejecutado. Ninguno se verificó leyendo código.

## Ejecuciones

```
$ bash .agent/verify.sh F-031 --full; echo $?
✓ harness ✓ typecheck ✓ lint ✓ format ✓ test (1092 passed, 115 files) ✓ prisma ✓ build ✓ theme ✓ bundle
PASA
0
```

```
$ bash .agent/verify.sh F-010 --visual; echo $?
✓ typecheck ✓ lint ✓ format ✓ test ✓ visual
PASA
0
```

```
$ node scripts/place-order.mjs --store=tienda-dos --delivery
== Pedido con envío en tienda-dos ==
  ok   el pedido con envío responde 201
0 aserciones fallidas

$ git diff --name-only main -- scripts/place-order.mjs .agent/specs/F-010/visual.mjs
(sin salida)
```

```
$ node scripts/quote-delivery-order.mjs        # las cinco banderas, en orden, sobre la MISMA corrida
== Criterio 2 …  6 ok
== Criterio 3 …  5 ok  (incluye el aserto real de DP1: nunca "$0.00")
== E8 de paso … 2 ok  (retiro en tienda cotizada sigue firme)
== Criterio 10 … 5 ok
== Criterio 4 …  6 ok
== Criterio 5 …  6 ok
== Criterio 6 …  1 ok
== Criterio 8 … 14 ok  (incluye R17: orderId ajeno → 404, nunca 409)
== Criterio 7(a) … 4 ok
== R15 de paso …  3 ok  (AWAITING_CUSTOMER no lo toca el barrido nuevo; segundo barrido idempotente)
0 aserciones fallidas
$ echo $?
0
```

Corrida también cada bandera por separado (`--create`, `--pull`, `--quote`,
`--dispatch`, `--expire`), cada una con `0 aserciones fallidas` de forma
aislada, antes de la corrida conjunta de arriba — así queda comprobado que
comparten la tienda sin pisarse.

```
$ npx vitest run --project ui src/features/cart/components/CheckoutForm.test.tsx
Test Files  1 passed (1) · Tests  4 passed (4)

$ npx vitest run --project server src/features/orders/whatsapp.test.ts
Test Files  1 passed (1) · Tests  11 passed (11)

$ npx vitest run --project server src/features/orders/server/pull.test.ts
Test Files  1 passed (1) · Tests  18 passed (18)

$ npx vitest run --project server src/app/api/internal/orders/status/route.test.ts
Test Files  1 passed (1) · Tests  15 passed (15)

$ npx vitest run --project db src/features/orders/server/expiry.db.test.ts
Test Files  1 passed (1) · Tests  12 passed (12)

$ grep -n 'Versión 6' docs/sync-contract.md
3:**Versión 6** · 1 de septiembre de 2026
$ grep -c 'v7' docs/sync-contract.md
4

$ node scripts/pull-orders.mjs --paginate --store=bodega-central-vedado
== Criterio 1 · GET /api/internal/orders … ==
  ok   responde 200
  ... (17 aserciones, todas ok)
0 aserciones fallidas
```

Comprobado tras cada corrida del guion nuevo: la fila de `tienda-demo` volvió
a `deliveryEnabled: false, deliveryFeeMode: 'FLAT_RATE', deliveryFee: NULL`
(lo que dejó la etapa 3) y `SELECT count(*) FROM "Order" WHERE
"contactName" = 'Script F-031'` = 0 — nada quedó sembrado.

No hay `.agent/specs/F-031/smoke.sh` propio: el guion de punta a punta hace
ese trabajo con más precisión (ancla cada aserción al pedido que él mismo
creó, en vez de a "el último pedido"), y las cinco banderas ya corren contra
la app real.

### Verificación visual — `.agent/specs/F-031/visual.mjs`

**Corrección sobre una decisión de este mismo ciclo.** La primera versión de
este documento decía que no hacía falta `visual.mjs` porque el criterio 1 ya
lo cubre `CheckoutForm.test.tsx` en `jsdom` y el resto con `curl`. Eso sigue
siendo cierto **para los doce criterios**, pero no alcanza para **cerrar el
feature**: `bash .agent/sdd.sh done F-031` se niega mientras `design.md` esté
en `listo` (tiene interfaz) y no exista `.agent/specs/F-031/visual.mjs` — la
regla del arnés, no una preferencia, y la cumplen los diez features hermanos
que ya tienen el suyo (F-010, F-011, F-012, F-017, F-019, F-021, F-023,
F-025, F-026, F-027). `curl` ve el HTML que manda el servidor; no ve lo que
compone el navegador, y F-031 cambió precisamente lo que se lee en pantalla
en seis superficies. Escrito a partir de `.agent/templates/visual.mjs`,
mirando el guion hermano `.agent/specs/F-019/visual.mjs` (mismo bucle de
propuesta, misma página de pedido).

Cinco pasos, los que `curl` no puede afirmar:

- **V1** — checkout en modo cotizado (360px): el radio de domicilio existe,
  su descripción (`"Costo por confirmar"`) no contiene ningún dígito; al
  elegir domicilio, la fila de envío del resumen dice `"Por confirmar"`, el
  total se nombra `"Total parcial"` y la coletilla `"más el envío por
confirmar"` lleva las clases de texto normal (`text-fg text-sm`), nunca
  las de la letra chica que SP4 rechazó (`text-fg-muted text-xs`).
- **V2** — la página de un pedido sin cotizar: la fila de envío está
  **presente** (I4: antes de F-031 se ocultaba al valer cero) con `"Por
confirmar"` y `"Total parcial"`.
- **V3** — retiro en la misma tienda cotizada: la fila de envío está
  **ausente** y el total es `"Total"` en firme desde el primer momento (E8);
  la página entera no dice `"por confirmar"` en ningún sitio.
- **V4** — la transición: con la propuesta viva, el titular pasa a `"La
tienda ya calculó el envío"`, los tres `<dt>` pasan a `"Total sin el
envío"`/`"Total con el envío"`/`"El envío"` (nunca `"Total actual"`/`"Total
propuesto"`/`"Diferencia"`), la tabla nueva (`"Tu pedido con el envío
incluido"`) ya muestra una cifra y la tabla plegada (`"Ver tu pedido sin el
envío"`) sigue diciendo `"Por confirmar"`.
- **V5** — 320px: checkout con domicilio elegido y la página del pedido sin
  cotizar, los dos sin scroll horizontal.

Producto de prueba elegido con el mismo `pickCentsProduct()` de
`scripts/quote-delivery-order.mjs` (DP1: centavos ≠ `"00"`). Bearer
**reutilizado** de la corrida anterior vía `QAB_BEARER_TOKEN` — el guion NO
acuña uno nuevo (falla con un mensaje claro si no está exportado, en vez de
acuñar en silencio), para no rotar el de `seed-negocio-1` una segunda vez en
la misma sesión. Modo cotizado activado por SQL sobre `tienda-demo` y
restaurado en un `finally`, igual que `quote-delivery-order.mjs`.

```
$ bash .agent/verify.sh F-031 --visual; echo $?
✓ typecheck ✓ lint ✓ format ✓ test ✓ visual
PASA
0
```

Un fallo real encontrado y arreglado en el propio guion, no en el producto:
`page.getByText("Por confirmar")` sin `{ exact: true }` hace substring **e
insensible a mayúsculas** por defecto, y con tres cadenas emparentadas en la
misma pantalla (`"Por confirmar"`, `"Costo por confirmar"`, `"más el envío
por confirmar"`) resolvía a 3 elementos y Playwright paraba en «strict mode
violation». Ficha nueva:
`.agent/playbook/playwright-gettext-substring-insensible-a-mayusculas.md`.
Arreglado con `{ exact: true }`; comprobado tras arreglarlo que la fila de
`tienda-demo` volvió a `FLAT_RATE`/`deliveryEnabled: false` y que
`SELECT count(*) FROM "Order" WHERE "contactName" = 'Visual F-031'` = 0.

## Fallos encontrados

Tres — dos ya fichados de antes, uno nuevo fichado en este ciclo. Ninguno
tocó código de producto:

1. **`format:check` sobre `scripts/quote-delivery-order.mjs` recién creado.**
   Severidad: trivial. Reproducción: `npm run format:check` tras crear el
   archivo. Ficha: `.agent/playbook/prettier-sin-formatear.md`. Arreglo:
   `npx prettier --write scripts/quote-delivery-order.mjs`; `--full` volvió
   a 0. No vuelve a ningún agente: es el propio guion de esta etapa.
2. **`scripts/pull-orders.mjs --paginate` (F-007, sin `--store=`) revienta
   con `No orderable product found for store "tienda-demo"`.** Severidad:
   ninguna para F-031 — es un bug **preexistente y ajeno**: la migración de
   F-017 dejó `Store.slug` en `NULL` para `tienda-demo`, y ese script
   consulta esa columna directo en vez de resolver por `Storefront` como
   hace la app real. `archivo:línea` sospechoso:
   `scripts/pull-orders.mjs:101-114` (`pickOrderableProduct`). Ficha ya
   escrita: `.agent/playbook/pull-orders-mjs-store-slug-nulo-tras-f017.md`
   (creada en F-007/F-018, no en este ciclo), cuya propia § «Cuándo NO es
   esto» documenta que una tienda con `ownSlug`
   (`bodega-central-vedado`) no lo sufre. No vuelve a ningún agente de
   F-031: no es su código y arreglarlo es fuera de alcance de este feature
   (`scripts/pull-orders.mjs` no está en la lista de archivos de ningún paso
   de `plan.md`). Se verificó el criterio 11(c) con
   `--store=bodega-central-vedado` en el mismo negocio, que ejercita
   exactamente el mismo consumidor v5 contra el mismo payload del pull.

3. **`getByText("Por confirmar")` sin `{ exact: true }` resolvía a 3
   elementos** en `.agent/specs/F-031/visual.mjs` (paso V1). Severidad:
   trivial, del guion, no del producto. Ficha nueva:
   `.agent/playbook/playwright-gettext-substring-insensible-a-mayusculas.md`.
   Arreglado con `{ exact: true }`; `bash .agent/verify.sh F-031 --visual`
   volvió a 0. Descartado con
   `bash .agent/verify.sh dismiss F-031 '<firma>' '<motivo>'` apuntando a la
   ficha, antes de cerrar el feature.

`bash .agent/verify.sh pending F-031` → vacío: no queda ningún fallo sin
fichar ni descartar.

## Huecos de cobertura

- **El literal `'0,00'` de los criterios 3 y 10 no protege nada por sí
  mismo** (DP1, arriba). Ya resuelto por decisión del humano: se cumplen
  literales y además se aseguran con las cadenas exactas de `design.md` y
  centavos de prueba ≠ `00`. Documentado, no oculto.
- **No se probó el caso "modo cotizado con una `deliveryFee` residual en la
  fila de la tienda"** (§ Casos límite de `spec.md`: "manda el modo"). No es
  ninguno de los doce criterios y `architecture.md`/`impl.md` ya lo cubren
  con `deliveryOffer.test.ts` (etapa 2); no se dupicó aquí a propósito, para
  no alargar el guion con un caso que ningún criterio pide.
- **No se ejercitó el `409` combinado con `--dispatch` sobre `PENDING` (sin
  pull previo).** El guion pulea siempre antes de reportar estado, como
  hacen los flujos reales; `status.test.ts` ya prueba `PENDING` por unidad.
  Riesgo residual: bajo — `setOrderStatus` no distingue `PENDING` de
  `PULLED` en su guarda (ambos aceptan `CONFIRMED`/`CANCELLED`, ambos
  bloquean READY/IN_TRANSIT/DELIVERED sin cotizar), así que probarlo desde
  `PULLED` ejercita el mismo camino de código.
- **`.agent/specs/F-031/visual.mjs` no cubre 768px ni 1280px**, solo 360 y 320. Ninguno de los doce criterios lo exige y `design.md` § Estructura por
  breakpoint dice que ninguna de las cinco zonas cambia de estructura entre
  anchos —cambian palabras dentro de filas que ya existen—, así que el
  riesgo real está concentrado en el ancho angosto (320-360), que es donde
  una etiqueta de texto en vez de una cifra corta puede partirse. Riesgo
  residual: bajo.
- **No se probó el modo oscuro ni el branding por tienda** sobre las
  cadenas nuevas. `design.md` § Tokens y tema dice explícitamente que nada
  de esta copia se pinta con `--color-brand`/`--color-accent` y que vive
  sobre el par `--color-surface`/`--color-fg` que el tema garantiza en claro
  y en oscuro — es una propiedad del sistema de temas ya probada por F-010,
  no algo que F-031 cambie. Riesgo residual: bajo.

## Veredicto

**LISTO.** Los doce `acceptance_criteria` de `.agent/features.json` se
verificaron ejecutando algo, con su comando y su salida real. `bash
.agent/verify.sh F-031 --full` termina en `0`. `bash .agent/verify.sh F-031
--visual` termina en `0` (con `.agent/specs/F-031/visual.mjs` ya escrito).
`bash .agent/verify.sh F-010 --visual` termina en `0` y ninguno de los dos
guiones intocables del criterio 9 se tocó. `bash .agent/verify.sh pending
F-031` está vacío. `bash .agent/sdd.sh done F-031` cerró el feature en esta
misma sesión, con el progreso archivado (regla del arnés) y esta
especificación conservada como viva.

**Aviso operativo, no de código:** para acuñar el bearer de `--pull`/
`--quote`/`--dispatch` que necesita este guion (no había ninguno exportado
ni encontrado en otro `.env.local` del sistema — se buscó antes de acuñar,
siguiendo la ficha) se ejecutó `npm run mint:token -- seed-negocio-1`. Eso
**rota** el token de ese negocio en la Postgres **compartida**
(`.agent/playbook/mint-token-rota-el-token-en-bd-compartida.md`, ya visto en
F-031 mismo): cualquier otra sesión —incluida `tuskfish` o el checkout
principal— con un `QAB_BEARER_TOKEN` viejo de `seed-negocio-1` exportado
necesita reacuñarlo. No se acuñó un segundo token (`scripts/quote-delivery-order.mjs`
y `scripts/pull-orders.mjs` reutilizaron el mismo, pasado con `--token=`),
para no rotarlo dos veces en la misma sesión.

## Preguntas al humano

Ninguna. DP1 y DP2 ya los cerró el humano y el orquestador antes de este
ciclo (`plan.md` § Preguntas antes de aprobar, bitácora
2026-09-01T16:14:12Z); no encontré un criterio inverificable tal como está
escrito ni un fallo cuya gravedad sea decisión de producto.
