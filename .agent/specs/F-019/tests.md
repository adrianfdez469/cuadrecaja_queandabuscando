---
feature: F-019
agente: sdd-tester
actualizado: 2026-08-30T20:10:00Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno donde le toca por AGENTS.md § «Cosas que muerden» (la
extensión decide el entorno, es automático):

- **Unitario/mockeado** (`*.test.ts` → proyecto `node`, `*.test.tsx` → jsdom):
  ya existía casi todo — `deadline.test.ts`, `proposal.test.ts`,
  `respond.test.ts`, `status.test.ts`, `pull.test.ts`, `schemas.test.ts`,
  `whatsapp.test.ts`, `OrderStatusBadge.test.tsx`, `OrderProposalCard.test.tsx`,
  `proposalDiff.test.ts`, `createOrder.test.ts`. Cubre las ramas de decisión
  (200/409/404, E7/E8/E11/E4) sin Postgres.
- **Contra Postgres real** (`*.db.test.ts` → proyecto `db`): `expiry.db.test.ts`
  y `pull.db.test.ts`. Es el único nivel que puede demostrar el criterio 4(b)
  — que Postgres deja de emparejar una fila en cuanto cambia de `status`, y que
  el barrido está acotado por `businessId`. Un mock no lo puede mostrar.
- **Guion de humo contra la app en pie** (`scripts/renegotiate-order.mjs`,
  siete modos, envuelto por `.agent/specs/F-019/smoke.sh`): el único nivel que
  puede demostrar «el HTML dice X» y «`POST /api/orders` devuelve un
  `whatsappUrl` de verdad», que es exactamente donde F-010 se equivocó
  mockeando. Corre con `bash .agent/verify.sh F-019 --smoke`.

Además, para este ciclo, verifiqué **por mi cuenta** — sin apoyarme solo en el
guion de humo — con un `next dev` propio en el puerto 3200 (el 3000 lo ocupa
`.orca-worktree-trash/wt-1787975564239-8d7709e1`, confirmado con
`lsof -p <pid>` antes de tocarlo) y `curl`/consultas SQL directas contra
Postgres: los criterios 4, 5, 7, 8 y 10, más el flujo sin JavaScript y el
vencimiento sin cron, que ningún criterio nombra por su nombre pero el feature
promete.

- **Navegador real** (`.agent/specs/F-019/visual.mjs`, Playwright headless,
  corre con `bash .agent/verify.sh F-019 --visual`): traduce los pasos
  `V7`-`V16` de `design.md` § «Verificación visual», los únicos que
  `sdd-designer` dejó sin ejecutar («las capturas no seguían al
  redimensionado»). Es el único nivel que puede medir contraste real
  (canvas 1×1 componiendo contra el fondo, porque Tailwind v4 resuelve
  `bg-warning/15` con `color-mix()` y Chromium nunca devuelve `rgb()`), leer
  el árbol de accesibilidad que un lector de pantalla consume
  (`locator.ariaSnapshot()`) y —el hallazgo que importa de este ciclo—
  reproducir la cabecera `Origin` que un navegador real manda en un `POST`
  de formulario y que ni `curl` ni `fetch()` desde un script mandan nunca.
  `V1`-`V6` no necesitan navegador y ya estaban cubiertos por el guion de
  humo de arriba.

## Mapa criterio → prueba

| Criterio de aceptación                                                                                                                    | Prueba                                                                                                             | Archivo                                                                                                            | Resultado |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------- |
| 1. Proponer deja AWAITING_CUSTOMER y GET /[slug]/pedido/[code] muestra el total anterior y el nuevo.                                      | `node scripts/renegotiate-order.mjs --propose` (real, vía smoke) + lectura de fila con SQL                         | `scripts/renegotiate-order.mjs`, `.agent/specs/F-019/smoke.sh`                                                     | LISTO     |
| 2. Aprobar pasa a CONFIRMED con los importes nuevos y GET /api/internal/orders lo refleja.                                                | `--approve` (smoke) + repetido a mano con `curl --data-urlencode "decision=aprobar"` y pull                        | `scripts/renegotiate-order.mjs`                                                                                    | LISTO     |
| 3. Rechazarla pasa a CANCELLED con el motivo atribuido al comprador.                                                                      | `--reject` (smoke) + repetido a mano con `curl --data-urlencode "decision=rechazar"`                               | `scripts/renegotiate-order.mjs`                                                                                    | LISTO     |
| 4. Un AWAITING_CUSTOMER vencido cambia de estado sin intervención de nadie, forzando la fecha y no esperando.                             | (a) `--expire` (smoke, `UPDATE … now() - interval` + `curl` al cron); (b) `expiry.db.test.ts` contra Postgres real | `scripts/renegotiate-order.mjs`, `src/features/orders/server/expiry.db.test.ts`                                    | LISTO     |
| 5. REJECTED_BY_STORE y CANCELLED se distinguen en la respuesta del pull.                                                                  | `--outcomes` (smoke) + reproducido a mano (tres pedidos, tres desenlaces, un `curl` de pull)                       | `scripts/renegotiate-order.mjs`                                                                                    | LISTO     |
| 6. rateSnapshot no cambia entre la creación del pedido y la aprobación.                                                                   | dentro de `--approve`: `canonicalJSON` antes/después, byte a byte, incluido `capturedAt`                           | `scripts/renegotiate-order.mjs`                                                                                    | LISTO     |
| 7. El comprador recibe un enlace a la página de su pedido por WhatsApp al crearlo.                                                        | `--link-on-create` (smoke) + `POST /api/orders` a mano con `curl` (WHATSAPP y ONSITE) + pull                       | `scripts/renegotiate-order.mjs`, `src/features/orders/whatsapp.test.ts`, `src/features/orders/server/read.test.ts` | LISTO     |
| 8. El enum de estados ampliado está documentado en docs/sync-contract.md.                                                                 | `grep -c -E 'AWAITING_CUSTOMER\|IN_TRANSIT\|REJECTED_BY_STORE'` y `grep -n 'Versión 5'`                            | `docs/sync-contract.md`                                                                                            | LISTO     |
| 9. Reportar IN_TRANSIT sobre READY deja la fila en IN_TRANSIT y GET /[slug]/pedido/[code] lo muestra con copia propia, distinta de READY. | `--transit` (smoke, compara HTML antes/después, envío y retiro) + `OrderStatusBadge.test.tsx`                      | `scripts/renegotiate-order.mjs`, `src/features/orders/components/OrderStatusBadge.test.tsx`                        | LISTO     |
| 10. `bash .agent/verify.sh F-019 --full` termina con código 0.                                                                            | ese mismo comando                                                                                                  | `.agent/verify.sh`                                                                                                 | LISTO     |

Y, fuera de la tabla de los diez porque ningún criterio los nombra pero el
feature los promete:

| Comportamiento prometido                                                       | Prueba                                                                                                                                                           | Resultado                                    |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Aprobar/rechazar funcionan sin JavaScript (formulario real)                    | `curl -X POST … -H "Accept: text/html" --data-urlencode "decision=aprobar\|rechazar"` contra `/[slug]/pedido/[code]/respuesta`, mirando el `303` y su `Location` | LISTO                                        |
| Una propuesta vencida no se puede aprobar aunque el cron no haya corrido (E11) | `UPDATE "Order" SET "expiresAt" = now() - interval '1 hour'` sin llamar al cron, después `curl --data-urlencode "decision=aprobar"`                              | LISTO — `409 PROPOSAL_EXPIRED`, fila intacta |
| `POST /api/internal/orders/status` rechaza `AWAITING_CUSTOMER` (E19)           | `curl -X POST …/status -d '{"status":"AWAITING_CUSTOMER"}'`                                                                                                      | LISTO — `400`                                |

Un criterio sin fila es un criterio sin cubrir. No hay ninguno: los diez tienen
fila y los diez están LISTO.

### Verificación visual — design.md V7-V16

`design.md` § «Verificación visual» dice, literal: «`V7`–`V16` sí [necesitan
navegador], y **no se ejecutaron en este ciclo**». Este ciclo los ejecutó los
diez, con `.agent/specs/F-019/visual.mjs` (nuevo) vía
`bash .agent/verify.sh F-019 --visual`. Dos desviaciones frente a la letra del
documento, ya conocidas y sin relación con lo que sigue (impl.md § Desviaciones):
el formulario de rechazo no pide motivo (un solo campo `decision`, no las
cuatro `RadioCard` de DP3), y la redirección usa `?r=` con seis valores, no
`?respuesta=` con ocho.

| Paso                    | Qué comprueba                                                                                                                                                                                     | Resultado                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| V7                      | 360px: sin scroll horizontal, el enlace de salto llega al panel, los dos `<summary>` ≥44px                                                                                                        | LISTO                                                                                 |
| V8 (adaptado)           | 360px: `Rechazar el cambio` alcanzable y operable por teclado, el botón de confirmar no flota encima                                                                                              | LISTO                                                                                 |
| V9                      | 768/1280px: el `<dl>` de totales pasa a 2 columnas, las acciones siguen apiladas                                                                                                                  | LISTO                                                                                 |
| **V10**                 | Sin JavaScript: aprobar y rechazar de punta a punta, con banner                                                                                                                                   | **LISTO — reverificado tras el arreglo de `isCrossOrigin()`, ver «Ejecuciones»**      |
| V11                     | Recargar tras responder no reabre el formulario                                                                                                                                                   | LISTO — ya no se omite: V10 llega al `303` y V11 corre de verdad                      |
| V12                     | El foco tras responder está en el banner; un `Tab` no vuelve a la cabecera                                                                                                                        | LISTO                                                                                 |
| **V13**                 | Contraste ≥4.5:1 (o ≥3:1 en texto corto/negrita) en claro y oscuro                                                                                                                                | **LISTO — reverificado tras oscurecer `--color-warning` en claro, ver «Ejecuciones»** |
| V14                     | Branding de tienda-dos: botón verde, radios redondeados, totales legibles                                                                                                                         | LISTO                                                                                 |
| V15                     | Oscuro: la tira `warning`, la insignia `Cancelado: no respondiste a tiempo`                                                                                                                       | LISTO                                                                                 |
| V16                     | Lector de pantalla (árbol de accesibilidad real vía `ariaSnapshot()`): landmark, orden de lectura de los totales, estado expandido del `<details>`, importe dentro del nombre accesible del botón | LISTO                                                                                 |
| Criterio 9, en pantalla | `IN_TRANSIT` sobre `READY`, envío y retiro: capturas antes/después, copia presente/ausente/distinta                                                                                               | LISTO (refuerza el criterio 9, ya LISTO por el guion de humo)                         |

**Ciclo 2 (este): 61 aserciones en verde, 0 en rojo.** Corrido por mí de forma
independiente con `bash .agent/verify.sh F-019 --visual` (intento 78,
`.agent/runs/F-019/078-visual.log`) — leído el log entero, no el resumen. Los
+4 respecto al ciclo 1 (57 aserciones) son V11 (2, antes omitido porque
dependía de que V10 llegara al `303`) y los dos `ok` de V10 que antes eran
`VISUAL FAIL`; V13 pasó de 6 fallos a 0 sin ganar ni perder ninguna aserción
(las mismas 13+13 mediciones, ahora todas en verde).

## Ejecuciones

### El sensor, tal como lo entregó sdd-implementer

```
$ bash .agent/verify.sh F-019 --full
== Verificación F-019 · intento 42 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     4s
  ✓ test       20s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s
PASA
$ echo $?
0
```

```
$ bash .agent/verify.sh F-019 --smoke
== Verificación F-019 · intento 43 ==
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     4s
  ✓ test       14s
  ✓ smoke      4s
PASA
```

El log del `smoke` (`.agent/runs/F-019/043-smoke.log`) trae las 32 aserciones
del guion, una por una, todas `ok`, y termina con «0 aserciones fallidas» — lo
leí entero, no solo el resumen verde. Extracto (completo en el archivo citado):

```
== Criterio 1 · proponer deja AWAITING_CUSTOMER y los dos totales en la página ==
  ok   (a) la fila queda en AWAITING_CUSTOMER
  ok   (b) el HTML trae el total anterior
  ok   (b) el HTML trae el total propuesto, distinto del anterior
== Criterios 2 y 6 · aprobar … rateSnapshot intacto ==
  ok   criterio 6 — rateSnapshot idéntico byte a byte antes y después de aprobar
== Criterio 4(a) · un AWAITING_CUSTOMER vencido cambia solo, forzando la fecha ==
  ok   la fila queda CANCELLED sin intervención de nadie
  ok   el motivo es literalmente 'La propuesta venció sin respuesta'
== Criterio 5 · REJECTED_BY_STORE y CANCELLED se distinguen en el pull ==
  ok   REJECTED_BY_STORE ≠ CANCELLED por status
  ok   los dos CANCELLED se distinguen entre sí por cancelledBy (R9)
== Criterio 9 · IN_TRANSIT sobre READY, copia propia y distinta de READY ==
  ok   envío (tienda-dos): (c) esa copia NO estaba en el HTML de antes
  ok   retiro (tienda-demo): (c) esa copia NO estaba en el HTML de antes
== Criterio 7 · los dos huecos reales del enlace de WhatsApp ==
  ok   POST /api/orders (WHATSAPP) devuelve whatsappUrl con la URL del pedido (bug I2/SP6)
  ok   el pull SÍ trae customerWhatsappUrl hacia el comprador, incluso para ONSITE (E24)
0 aserciones fallidas
```

### Criterio 4(b), aparte y contra Postgres real

```
$ npx vitest run --project db src/features/orders/server/expiry.db.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Los cinco casos: no toca un `AWAITING_CUSTOMER` sin vencer, cancela el vencido
con `cancelledBy = EXPIRY` y el motivo literal, un segundo barrido afecta **0**
filas, acotado por `businessId` (no toca el de otro negocio), y sin
`businessId` (el cron) barre cualquier negocio.

### Criterio 8, con `grep`

```
$ grep -c -E 'AWAITING_CUSTOMER|IN_TRANSIT|REJECTED_BY_STORE' docs/sync-contract.md
19
$ grep -n 'Versión 5' docs/sync-contract.md
3:**Versión 5** · 30 de agosto de 2026
```

### Verificación propia, con la app levantada en un puerto mío (3200)

Antes de tocar nada: `lsof -i :3000 -sTCP:LISTEN` → PID de otro checkout
(`.orca-worktree-trash/wt-1787975564239-8d7709e1`, confirmado con
`lsof -p <pid> | grep cwd`). No lo usé; levanté `npx next dev -p 3200` propio.

**Criterio 7 — `POST /api/orders` con `curl`, no con un test que mockea:**

```
$ curl -s -X POST http://localhost:3200/api/orders -H "content-type: application/json" -d '{...tienda-demo, WHATSAPP...}'
{"code":"0JQVAYA7QX","orderUrl":"/tienda-demo/pedido/0JQVAYA7QX",
 "whatsappUrl":"https://wa.me/5350000001?text=...Ver%20el%20pedido%3A%20http%3A%2F%2Flocalhost%3A3000%2Ftienda-demo%2Fpedido%2F0JQVAYA7QX"}
```

`whatsappUrl` no es `null` y, decodificado, contiene
`/tienda-demo/pedido/0JQVAYA7QX`. Confirmado en `createOrder.ts:87`:
`getOrderByCode(store.id, code)` (antes pasaba `store.slug`, el bug I2/SP6).

Para `ONSITE` (tienda-dos): `whatsappUrl` sale `null` en la respuesta del
checkout (esperado, I3) y el pull trae `customerWhatsappUrl` hacia el
comprador igual (E24):

```
$ curl -s -X POST http://localhost:3200/api/orders … tienda-dos, ONSITE
{"code":"XG1G3VBPZV","orderUrl":"/tienda-dos/pedido/XG1G3VBPZV","whatsappUrl":null}

$ curl -s ".../api/internal/orders?since=...&limit=500" -H "Authorization: Bearer $TOKEN"
{ "code":"XG1G3VBPZV", ...,
  "customerWhatsappUrl":"https://wa.me/53178811327302?text=...http%3A%2F%2Flocalhost%3A3000%2Ftienda-dos%2Fpedido%2FXG1G3VBPZV" }
```

**Aprobar/rechazar sin JavaScript, con un `POST` de formulario real:**

```
$ curl -si -X POST "http://localhost:3200/tienda-demo/pedido/ZXB47H1PK0/respuesta" \
    -H "Accept: text/html" --data-urlencode "decision=aprobar"
HTTP/1.1 303 See Other
location: http://localhost:3200/tienda-demo/pedido/ZXB47H1PK0?r=aprobada

$ (SQL) SELECT status FROM "Order" WHERE code='ZXB47H1PK0'; → CONFIRMED
$ curl -s ".../tienda-demo/pedido/ZXB47H1PK0?r=aprobada" | grep -o "Confirmado\|1,150\|1,350"
Confirmado
1,150
1,350
```

Y con `decision=rechazar` sobre otro pedido: `303` con
`?r=rechazada`, fila `CANCELLED`, `cancelledBy: CUSTOMER`,
`cancelReason: "El comprador rechazó el cambio propuesto."`.

**Una propuesta vencida no se aprueba aunque el cron no haya corrido (E11),
sin llamar al cron:**

```
$ (SQL) UPDATE "Order" SET "expiresAt" = now() - interval '1 hour' WHERE code='6TR6VAJWCF';
$ curl -si -X POST ".../6TR6VAJWCF/respuesta" -H "Accept: application/json" --data-urlencode "decision=aprobar"
HTTP/1.1 409 Conflict
{"error":"PROPOSAL_EXPIRED","status":"AWAITING_CUSTOMER"}
$ (SQL) SELECT status FROM "Order" WHERE code='6TR6VAJWCF'; → AWAITING_CUSTOMER (intacta)
$ curl -s ".../tienda-demo/pedido/6TR6VAJWCF" | grep -o "venci"
venci
```

E12 también verificado: la página lee la propuesta vencida y no ofrece los dos
formularios (no aparecieron "Aprobar" ni "Rechazar" en el HTML).

**Criterio 5, reproducido a mano con tres pedidos reales (no solo el guion):**

```
código S1CPZHAC0Q → rechazado por el comprador  → { status: CANCELLED,          cancelledBy: CUSTOMER }
código MQJ3AH717C → vencido + cron               → { status: CANCELLED,          cancelledBy: EXPIRY   }
código TGKGDGJQ9J → rechazado por la tienda       → { status: REJECTED_BY_STORE,  cancelledBy: STORE    }
```

Los tres se distinguen de a pares tal como pide el criterio: `status`
distingue `REJECTED_BY_STORE` de los dos `CANCELLED`, y `cancelledBy`
distingue los dos `CANCELLED` entre sí.

**E19, con `curl`:**

```
$ curl -si -X POST http://localhost:3200/api/internal/orders/status -d '{"orderId":"48260","status":"AWAITING_CUSTOMER"}'
HTTP/1.1 400 Bad Request
```

Servidor propio cerrado (`pkill -f "next dev -p 3200"`) y puerto liberado tras
cada tanda, confirmado con `lsof -i :3200`.

### Verificación visual — `bash .agent/verify.sh F-019 --visual`

```
$ bash .agent/verify.sh F-019 --visual
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     4s
  ✓ test       20s
  ✗ visual     30s  (salida 1)
FALLA en visual.
```

Extracto real del log (`.agent/runs/F-019/056-visual.log`), 49 `ok` y 9
`VISUAL FAIL`:

```
  ok   V7 — sin scroll horizontal a 360px
  ok   V7 — los dos <summary> miden ≥44px de alto
  ok   V8 — Enter sobre el <summary> abre el <details> (nativo, sin JS)
  ok   V9 @768 — el <dl> de totales tiene 2 columnas
  ok   V9 @1280 — los dos <summary> siguen apilados
VISUAL FAIL V10 (aprobar) — el POST sin JS a .../respuesta dio 403, NO el 303
  que R16 promete (cuerpo: {"error":"FORBIDDEN_ORIGIN"})
VISUAL FAIL V10 (rechazar) — el POST sin JS a .../respuesta dio 403, NO el 303
  que R16 promete (cuerpo: {"error":"FORBIDDEN_ORIGIN"})
  nota V11 — omitido: depende de que V10 (rechazar) haya llegado al 303
  ok   V12 — al llegar por el ancla, el foco ya está en #respuesta
  ok   V12 — tras un Tab, el foco NO volvió a la cabecera (Carrito/Cuenta)
  ok   V13 (light) — título del panel contrasta ≥4.5:1
VISUAL FAIL V13 (light) — banner ?r=aprobada (tone=positive) contrasta ≥4.5:1
  ok   V13 (light) — banner ?r=rechazada (tone=muted) contrasta ≥4.5:1
VISUAL FAIL V13 (light) — banner ?r=conflicto (tone=warning) contrasta ≥4.5:1
VISUAL FAIL V13 (light) — banner ?r=vencida (tone=danger) contrasta ≥4.5:1
VISUAL FAIL V13 (light) — banner ?r=no-disponible (tone=danger) contrasta ≥4.5:1
VISUAL FAIL V13 (light) — banner ?r=demasiados-intentos (tone=warning) contrasta ≥4.5:1
VISUAL FAIL V13 (light) — plazo en text-warning contrasta ≥4.5:1
VISUAL FAIL V13 (light) — insignia "Esperando tu respuesta" (tone=warning) contrasta ≥4.5:1
  ok   V13 (dark) — [las 13 mediciones equivalentes, todas ≥4.5:1]
  ok   V14 — el botón de aprobar se pinta con la marca verde de tienda-dos
  ok   V15 — la insignia "Cancelado: no respondiste a tiempo" aparece en oscuro
  ok   V16 — el orden de lectura es "Total actual" → "Total propuesto" → "Diferencia"
  ok   V16 — abierto, el botón se anuncia CON el importe dentro de su nombre accesible
  ok   criterio 9 (envío) — 'En camino' SÍ está después
  ok   criterio 9 (retiro) — 'lo puso en camino' SÍ está después
  ok   criterio 9 — las dos copias (envío/retiro) son DISTINTAS entre sí

9 aserciones fallidas
```

El sensor reconoció los dos hallazgos por su firma y los cruzó contra las
fichas nuevas de este ciclo (ver «Fallos encontrados»):

```
Firma: visual:VISUAL FAIL V10 (aprobar) — el POST sin JS a .../respuesta dio 403…

YA NOS PASÓ — la bitácora reconoce este fallo:
  alert-tone-hereda-color-en-body-de-texto-largo — …
     ficha: .agent/playbook/alert-tone-hereda-color-en-body-de-texto-largo.md
  origin-header-contra-env-estatico-no-el-real — …
     ficha: .agent/playbook/origin-header-contra-env-estatico-no-el-real.md
```

Repetido tres veces con la MISMA firma (intentos 054-056: los dos primeros
además tuvieron bugs míos de fixture, ya descartados — ver `pending` abajo).
`verify.sh` avisó «ESTANCADO» a la tercera. No hice una cuarta vuelta: la
causa ya está identificada con `archivo:línea` exactos y no es una hipótesis
que valga la pena seguir variando — es momento de devolver, no de reintentar
(regla del propio arnés, `.agent/README.md` § «Cuando algo falla»).

Durante la depuración usé un `next dev` propio en el puerto 3201/3202 (nunca
el 3000) para aislar la causa con Playwright a mano antes de escribirla en el
guion — el repro de `isCrossOrigin()` está confirmado en DOS puertos distintos
además del `VISUAL_PORT` (3101) que `verify.sh` usa de verdad.

### Ciclo 2 — reverificación tras los dos arreglos, `bash .agent/verify.sh F-019 --visual`

`sdd-implementer` arregló los dos hallazgos (severidad alta y media del
ciclo 1). Antes de creer que quedaron resueltos, los reproduje **yo mismo**,
no solo corriendo el guion:

**El arreglo del `Origin`, en el mismo sitio exacto donde se rompió.** Levanté
otro `next dev` propio (`npx next dev -p 3203`, confirmado libre con
`lsof` antes de usarlo — nunca el 3000), sembré un pedido, propuse un cambio
por el API interno, y repetí el MISMO repro de Playwright del ciclo 1 —
`javaScriptEnabled: false`, clic real en `Aprobar el cambio`, sin una sola
línea de JS:

```
$ node -e '… chromium.launch() … context({ javaScriptEnabled: false }) …
  page.goto("http://localhost:3203/tienda-demo/pedido/EYYEBVNWJ7")
  page.click("summary >> text=Aprobar el cambio")
  page.click('button:has-text("acepto pagar")')  …'
REQUEST POST http://localhost:3203/tienda-demo/pedido/EYYEBVNWJ7/respuesta Origin: http://localhost:3203
RESPONSE 303 http://localhost:3203/tienda-demo/pedido/EYYEBVNWJ7/respuesta
FINAL URL: http://localhost:3203/tienda-demo/pedido/EYYEBVNWJ7?r=aprobada
BODY SNIPPET: … Aprobaste el cambio. La tienda ya lo sabe y prepara tu pedido con los importes nuevos. …
```

`303`, no `403`: el mismo puerto que antes daba `FORBIDDEN_ORIGIN` ahora
completa el flujo entero sin JavaScript. Confirmado también en el código
(`isCrossOrigin()` ahora compara `new URL(origin).host` contra
`request.headers.get("host")`, no contra `publicEnv.siteUrl`) y con el test
de regresión que dejó escrito
(`src/app/[slug]/pedido/[code]/respuesta/route.test.ts` § «Origin cruzado»):

```
$ npx vitest run --project server "src/app/[slug]/pedido/[code]/respuesta/route.test.ts"
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

**El token compartido, medido en los cinco sitios que lo usan como texto o
fondo translúcido, no solo en los dos de F-019.** `--color-warning` en claro
pasó de `oklch(0.72 0.15 75)` a `oklch(0.5 0.15 75)` (`src/theme/tokens.css:40`);
oscuro no se tocó (`oklch(0.8 0.14 75)`, línea 69). Con la misma técnica de
canvas 1×1 del ciclo 1, medido en vivo contra `http://localhost:3203`:

| Dónde                                                                                                            | Antes (ciclo 1) | Ahora (claro)                               | Ahora (oscuro)                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Plazo apretado `text-warning` (`OrderProposalCard.tsx`)                                                          | 2.53:1          | **5.92:1**                                  | 9.26:1 (sin cambio)                                                                 |
| Insignia `Badge tone="warning"` ("Esperando tu respuesta")                                                       | 2.17:1          | **4.61-4.77:1**                             | 7.68:1 (sin cambio)                                                                 |
| Banners `Alert tone="warning"` (`conflicto`, `demasiados-intentos`)                                              | 2.17:1          | LISTO (medido por `visual.mjs`, ver arriba) | sin cambio                                                                          |
| `text-warning` plano fuera de F-019 (`AddToCartButton.tsx:101`, `ImageUploader.tsx:251`)                         | no medido antes | **5.92:1** (sonda inyectada, misma clase)   | 9.996:1                                                                             |
| `bg-warning/15 text-warning` fuera de F-019 (`CartView.tsx:183`, aviso de que el navegador no guarda el carrito) | no medido antes | **4.77:1** (sonda inyectada)                | 7.68:1 (idéntico al medido para el mismo par de clases dentro de F-019 — coherente) |

Los cinco pasan ≥4.5:1 en claro ahora (el plazo y la insignia, que antes
fallaban incluso el 3:1 relajado, pasan también el 3:1 estándar con margen).
Oscuro no se movió en ninguno, confirmando que el cambio fue exclusivo del
tema claro. Las dos rutas de `bg-warning/15`/`border-warning/30` que
`OrderProposalCard.tsx`/`Alert.tsx` usan como fondo/borde (no como texto) no
necesitan 4.5:1 —no llevan texto encima directamente— y siguen visualmente
intactas en las capturas de `visual.mjs` (`V07-propuesta-360.png`,
`V13-panel-light.png`).

```
$ bash .agent/verify.sh F-019 --visual
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     6s
  ✓ test       20s
  ✓ visual     31s
PASA
```

Log completo en `.agent/runs/F-019/078-visual.log`, leído entero: **61 `ok`,
0 `VISUAL FAIL`**, «0 aserciones fallidas» al final. Repetido con
`bash .agent/verify.sh F-019 --full` → también `PASA` (intento 79,
harness·typecheck·lint·format·test·prisma·build·theme·bundle en verde).

### La suite completa

### La suite completa

```
$ npm test
 Test Files  98 passed (98)
      Tests  886 passed (886)
```

### Pendientes vacíos

```
$ bash .agent/verify.sh pending F-019
(vacío)
```

Las dos trampas de format/next-dev que este ciclo tocó ya estaban fichadas
antes de que las pisara — `prettier-sin-formatear` y
`prettier-write-reescribe-prosa-ajena` (ambas con F-019 en su columna «VISTO
EN» desde el ciclo de `sdd-implementer`) — y `next-dev-uno-por-directorio`,
que confirmé de nuevo con `lsof -p <pid>` antes de creerme que el 3000 servía
este checkout: no lo hacía.

Dos entradas de `pending` del ciclo 1 eran bugs de mi propio guion
(`visual.mjs` en construcción: una columna SQL inexistente, y un producto en
USD elegido dentro de una tienda en CUP) — **descartadas**, no fichadas,
porque no enseñan nada del repo:
`bash .agent/verify.sh dismiss F-019 'visual:Error.captureStackTrace(err)' '…'`
y el equivalente para el segundo. Las dos entradas de los hallazgos reales
del ciclo 1 quedaron **fichadas**, no descartadas — y siguen fichadas: una
lección no se borra porque el bug ya se haya arreglado, es lo que evita que
alguien vuelva a tropezar con la misma forma de escribirlo.
`bash .agent/verify.sh pending F-019` en el ciclo 2 (post-arreglo) también
está **vacío**: no hay ningún fallo nuevo de este ciclo sin explicar.

## Fallos encontrados

**Ciclo 1 — los dos de abajo, encontrados por mí.** **Ciclo 2 — ninguno
nuevo; los dos del ciclo 1 se reverificaron arreglados** (ver «Ciclo 2 —
reverificación tras los dos arreglos» arriba, con repro independiente en un
puerto propio para el primero y medición directa para el segundo, en cinco
sitios que usan el token, no solo los dos de F-019).

Los diez criterios y los tres comportamientos de la tabla extra (sin JS por
`curl`, vencimiento sin cron, `E19`) se verificaron ejecutando algo real y el
resultado coincidió con lo que exigen — de ahí que sigan LISTO en el mapa de
arriba. La verificación visual más profunda que el ciclo 1 añadió (V10 y
V13, con un navegador real en vez de `curl`) encontró **dos fallos reales,
reproducibles, en código de producto**, ninguno de los cuales tocaba yo
antes de tener un navegador de verdad. Quedan documentados aquí, ya
**arreglados y reverificados**, porque la sección los describe con el
`archivo:línea` que un lector futuro necesita si algo similar reaparece:

### Hallazgo 1 (ARREGLADO en el ciclo 2) — `isCrossOrigin()` rompía R16 con un navegador real (severidad: alta)

**Qué pasa.** `src/app/[slug]/pedido/[code]/respuesta/route.ts:37-42`
compara la cabecera `Origin` de la petición contra `publicEnv.siteUrl`
(`NEXT_PUBLIC_SITE_URL`, fija en `.env` a `http://localhost:3000`) en vez de
contra el origen real que sirvió la página. Un navegador real —con o **sin**
JavaScript, es indiferente— manda `Origin` en cualquier `POST`, también en
uno perfectamente same-origin; `curl`/`fetch()` desde un script **nunca** la
mandan por su cuenta, así que ni `scripts/renegotiate-order.mjs` ni mis
propias pruebas manuales con `curl` (tests.md, sección anterior) lo vieron.
En cuanto la app corre en cualquier puerto que no sea exactamente `:3000`
—el propio `$VISUAL_PORT` (3101) que `verify.sh --visual` usa por
defecto, cualquier `next dev` de desarrollo, o un deploy de preview con URL
distinta al dominio canónico— aprobar o rechazar **sin una sola línea de
JavaScript** devuelve `403 {"error":"FORBIDDEN_ORIGIN"}` en vez del `303` que
R16 promete. Reproducido con Playwright (`javaScriptEnabled: false`, clic
real en el botón) en tres puertos distintos: 3201, 3202 y el propio 3101 de
`verify.sh`.

**Repro mínimo:**

```
$ curl -si -X POST http://localhost:3201/tienda-demo/pedido/<code>/respuesta \
  # (esto NO reproduce el bug: curl no manda Origin)

# con un navegador real (Playwright, JS deshabilitado), clic real en el botón:
REQUEST POST http://localhost:3201/tienda-demo/pedido/<code>/respuesta Origin: http://localhost:3201
RESPONSE 403 http://localhost:3201/tienda-demo/pedido/<code>/respuesta
BODY: {"error":"FORBIDDEN_ORIGIN"}
```

**Por qué es real y no un artefacto de mi entorno de prueba.** `NEXT_PUBLIC_SITE_URL`
es una constante de proceso, no algo que se deriva de la petición; cualquier
origen que no coincida carácter a carácter la dispara. `ADR 0024` defensa 8
describe la intención («cuando la cabecera viene y no es la del sitio»), no
esta implementación concreta.

**Volvió a:** `sdd-implementer`, que lo arregló comparando contra
`request.headers.get("host")` en vez de `publicEnv.siteUrl`
(`respuesta/route.ts:43-53`) y dejó un test de regresión
(`src/app/[slug]/pedido/[code]/respuesta/route.test.ts` § «Origin cruzado», 17 passed). Reverificado por
mí de forma independiente, con el mismo repro de Playwright, en un CUARTO
puerto que ni el implementador ni mi ciclo 1 habían usado (3203) — ver
«Ciclo 2» arriba. Ficha, sin cerrar (documenta la lección, no el estado del
bug):
`.agent/playbook/origin-header-contra-env-estatico-no-el-real.md`.

### Hallazgo 2 (ARREGLADO en el ciclo 2) — los banners de resultado no cumplían 4.5:1 en tema claro (severidad: media)

**Qué pasa.** `design.md` § «Tokens y tema» dice, literal: «los banners de
§ 4.5 llevan el texto largo en un `<p class="text-fg">` dentro del `Alert`»
—precisamente para evitar que el cuerpo herede `text-warning`/`text-danger`/
`text-positive`, que el propio documento admite que no llegan a 4.5:1 sobre
`--color-bg` en claro. `src/app/[slug]/pedido/[code]/page.tsx` escribe
`<Alert tone={banner.tone}>{banner.text}</Alert>` — el texto como hijo
**directo**, sin esa envoltura. Medido de verdad (canvas 1×1, componiendo
contra el fondo real, no contra un `rgb()` supuesto): 5 de los 6 banners de
resultado caen entre **2.17:1 y 3.86:1** en tema claro (`aprobada`,
`conflicto`, `vencida`, `no-disponible`, `demasiados-intentos`; solo
`rechazada`, tono `muted`, pasa). En tema oscuro los seis pasan — por eso
`sdd-designer` no lo vio con una inspección visual normal, que casi siempre
se hace en claro contra una captura, no midiendo.

Un segundo hallazgo relacionado pero de causa distinta: el plazo apretado
(`text-warning`, tramo 15-59 min) y la insignia `Badge tone="warning"`
("Esperando tu respuesta") miden **2.17-2.53:1** en claro — por debajo
incluso del 3:1 que `design.md` da por «admisible por tamaño y peso» para
ese caso. Esto no es un descuido de implementación: el propio documento de
diseño no llegó a medir el valor real compuesto contra el fondo translúcido
(`bg-warning/15` sobre `bg-surface`), que resulta más claro que lo que
probablemente se estimó a ojo. El `Badge` en concreto es un componente
**compartido y anterior a F-019** (ya en uso en F-011, `ProductTable`/
`StorePublicSwitch`), así que ese fragmento del hallazgo es de sistema de
diseño, no de este feature — lo anoto para que se vea, no como bloqueante de
F-019.

**Volvió a:** `sdd-implementer`, que arregló las dos partes con dos técnicas
distintas, y no exactamente la que yo había sugerido en la ficha — igual de
válida, y la verifiqué en vez de asumir que "el arreglo escrito" es el que se
aplicó:

1. **Los banners**, con `className="!text-fg"` directo en el `<Alert
tone={banner.tone}>` de `page.tsx:147` (no con un `<p className="text-fg">`
   hijo como proponía la ficha) — mismo resultado práctico: el `!important`
   de Tailwind gana sobre el `text-warning`/`text-danger`/`text-positive` que
   `TONE_CLASSES` pone en el contenedor.
2. **El plazo apretado y la insignia**, con el humano autorizando tocar el
   token compartido `--color-warning` en claro (`oklch(0.72 0.15 75)` →
   `oklch(0.5 0.15 75)`, `src/theme/tokens.css:40`) — la opción que la ficha
   dejaba abierta ("subir peso/tamaño o pasar a `text-fg`… es una decisión de
   sistema de diseño"), resuelta por quien tiene esa decisión.

Medido en vivo, no dado por bueno: las 26 mediciones de `V13` (13 claro + 13
oscuro) pasan, y las tres fuera de F-019 (`AddToCartButton.tsx`,
`ImageUploader.tsx`, `CartView.tsx`) también, sin que oscuro se moviera un
solo dígito — ver «Ciclo 2» arriba. Ficha, sin cerrar (documenta la lección
para la próxima vez que un `Alert`/`Badge` lleve texto largo en un tono no
neutro):
`.agent/playbook/alert-tone-hereda-color-en-body-de-texto-largo.md`.

### Por qué esto no tocó nunca el veredicto de los diez criterios, y por qué sí bloqueaba el cierre (ya no)

Ningún texto de los diez `acceptance_criteria` de `features.json` menciona
«sin JavaScript» ni «contraste»: son promesas de `spec.md` (R16) y
`design.md` (§ Accesibilidad/Tokens), no de la lista literal que
`sdd-spec`/`sdd-architect` prometieron verificar por su nombre. Por eso el
mapa de arriba marcó los diez LISTO **desde el ciclo 1**, y sigue igual. Lo
que sí bloqueaba el cierre era que `.agent/verify.sh F-019 --visual` no
llegaba a `0` — `design.md` está en `estado: listo` (tiene interfaz) y el
propio `sdd.sh` exige un `PASA` de la etapa `visual` en la bitácora antes de
dejar cerrar (`.agent/sdd.sh:463-469`), no una opinión mía. Con los dos
hallazgos arreglados y reverificados de forma independiente (ciclo 2,
arriba), `--visual` sale en `0` y esa condición ya no aplica: ver
«Veredicto».

## Huecos de cobertura

- **E13 (segunda propuesta reemplaza a la primera y reinicia el reloj), E14
  (carrera aprobar/vencer) y E7 completo (reintentar la misma decisión → 200,
  la contraria → 409)** están cubiertos solo por tests **mockeados**
  (`respond.test.ts`), no por el guion de humo ni por mí a mano. Ninguno de los
  diez criterios los exige literalmente — el criterio 4 solo pide el
  vencimiento en sí, no la carrera — así que no bajan el veredicto, pero es la
  zona con menos evidencia de ejecución real de todo el feature. Riesgo bajo:
  la garantía real es un `UPDATE` condicional de Postgres (`WHERE status = …`),
  que `expiry.db.test.ts` sí prueba contra la base de verdad para el caso
  «segundo barrido afecta 0 filas» — la misma propiedad que resuelve la carrera.
- **El límite de tasa de la ruta `/respuesta`** (ADR 0024 defensa 9, PP1) es,
  por decisión ya tomada, una regla de firewall de Vercel que no viaja con el
  código: no hay nada que este ciclo pueda ejecutar para comprobarla, y la ADR
  ya lo dice en esos términos.
- **F-022 (horarios/zona horaria de la tienda) no existe** — el reloj es
  absoluto a propósito (R5) — así que no hay manera de probar «la tienda está
  cerrada» hasta que ese feature exista; no es un hueco de F-019, es una
  frontera ya documentada.
- **V6 de design.md** (propuesta vencida sin correr el cron, vista en el HTML)
  no tiene su propio paso en `visual.mjs` — está cubierto por el equivalente
  que sí escribí a mano en la sección de «Verificación propia» de más arriba
  (con `curl`, no con navegador), así que el comportamiento SÍ está
  verificado, solo que no quedó como paso repetible del guion de Playwright.
  Riesgo bajo: no depende de nada que solo un navegador pueda ver.

## Veredicto

**LISTO.** Los diez `acceptance_criteria` de `.agent/features.json` están
LISTO, cada uno verificado ejecutando algo — un comando, una petición HTTP
con su código de respuesta, o una consulta SQL contra la fila real — y no
leyendo el código para concluir que «debería funcionar». Y, ahora también,
la verificación visual (V7-V16 de `design.md`) que en el ciclo 1 encontró dos
fallos reales los tiene **arreglados y reverificados por mí de forma
independiente** en el ciclo 2, no solo confiando en el reporte de quien los
arregló (repro del `Origin` en un CUARTO puerto que nadie había usado antes;
medición directa del token en los cinco sitios reales que lo usan, no solo
los dos de F-019):

- `bash .agent/verify.sh F-019 --visual` → **0** (intento 78, corrido por mí;
  61 aserciones, el log entero leído, 0 `VISUAL FAIL`).
- `bash .agent/verify.sh F-019 --full` → **0** (intento 79, corrido por mí:
  harness·typecheck·lint·format·test·prisma·build·theme·bundle).
- `bash .agent/verify.sh pending F-019` → **vacío**.
- `npm run check:harness` → verde, 175 documentos.

No quedó ningún criterio sin cubrir, ningún fallo sin fichar y ningún sensor
en rojo. `sdd.sh done F-019` ya no tiene motivo para negarse por la etapa
`visual`.

## Preguntas al humano

Ninguna que bloquee el cierre. Quedan abiertas, sin relación con lo de este
ciclo — y no las cierro yo, porque cambiar un criterio o el contrato de una
ruta para que "pase" no es mi decisión — las que ya dejó `sdd-implementer`
en `.agent/specs/F-019/impl.md`: **IP1** (¿el rechazo debe pedir un motivo
al comprador, cambiando el contrato de un solo campo de `POST
…/respuesta`?) e **IP2** (¿construir la «nota de cambio ya aprobado» de
`design.md`, estado 12?). Ninguna de las dos bloquea ningún criterio de los
diez: son mejoras de alcance, no defectos.
