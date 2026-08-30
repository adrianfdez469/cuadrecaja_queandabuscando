---
feature: F-019
agente: sdd-implementer
actualizado: 2026-08-30T20:30:00Z
estado: listo
---

## Qué se construyó

Las nueve etapas del plan, en orden. `bash .agent/verify.sh F-019 --full
--smoke` sale **0**.

| Etapa | Archivo                                                                                   | Qué hace                                                                                                                            | Criterio(s)    |
| ----- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1     | `src/features/orders/server/createOrder.ts`                                               | `getOrderByCode(store.slug, code)` → `getOrderByCode(store.id, code)` (bug I2/SP6 de F-010)                                         | 7              |
| 1     | `src/features/orders/server/createOrder.test.ts`                                          | El aserto nuevo comprueba **con qué argumentos** se llama `getOrderByCode`; falla en rojo antes del arreglo                         | 7              |
| 2     | `prisma/schema.prisma`                                                                    | `OrderStatus` +3 valores; `OrderCancelledBy`, `ProposalOutcome` nuevos; doce columnas nullable en `Order`; `Store.orderExpiryHours` | 1, 3, 5, 9     |
| 2     | `prisma/migrations/20260830170714_order_renegotiation/migration.sql`                      | Los cuatro `DROP INDEX` que Prisma propuso, quitados a mano; el resto, aplicado                                                     | 1, 3, 5, 9     |
| 3     | `src/features/orders/components/OrderStatusBadge.tsx`                                     | +3 casos del `switch` exhaustivo (sin `default`); `READY` con envío ya no dice "Va en camino."; `CANCELLED` distingue R9            | 9              |
| 3     | `src/features/orders/components/OrderStatusBadge.test.tsx` (nuevo)                        | Los diez casos, incluida la copia literal de F-010 intacta (PP4)                                                                    | 9              |
| 4     | `src/features/orders/deadline.ts` (nuevo)                                                 | `isProposalExpired()`, `remainingTime()` — puras                                                                                    | 1              |
| 4     | `src/features/orders/whatsapp.ts`                                                         | +`buildProposalWhatsappUrl()` (genérico, no "propuesta"), +`buildCustomerContactUrl()`                                              | 1, 7           |
| 4     | `src/constants/orders.ts`                                                                 | Valores de `decision`/`?r=`, los dos motivos fijos de cancelación, tope de cuerpo. Sin rate limit (PP1)                             | —              |
| 4     | `src/features/orders/types.ts`                                                            | `ProposalPayload`, `ProposalResponse`, `ProposalDecision`                                                                           | —              |
| 5     | `src/features/orders/server/proposal.ts` (nuevo)                                          | `proposeOrderChange()` — un `UPDATE … FROM "Store" … RETURNING`, sin lectura previa (DA2)                                           | 1, 2           |
| 5     | `src/features/orders/server/respond.ts` (nuevo)                                           | `respondToProposal()` — aprobar (CTE) y rechazar, la regla 200/409 de DA4                                                           | 2, 3           |
| 5     | `src/features/orders/server/expiry.ts` (nuevo)                                            | `expireProposalsQuery()` — un `UPDATE` condicional, `PrismaPromise` sin `await`                                                     | 4              |
| 5     | `src/features/orders/server/expiry.db.test.ts` (nuevo)                                    | Contra Postgres real: no toca lo vivo, cancela lo vencido, 0 filas en el segundo barrido, aislado por `businessId`                  | 4(b)           |
| 5     | `src/features/orders/schemas.ts`                                                          | `proposeOrderChangeSchema` — Σ lineTotal = subtotal, total = subtotal − discount + delivery, con `lib/money.ts`                     | 1, 2           |
| 6     | `src/app/api/internal/orders/proposal/route.ts` (nuevo)                                   | HTTP ↔ `proposeOrderChange()`, bajo `withInternalAuth`                                                                              | 1, 2           |
| 6     | `src/app/[slug]/pedido/[code]/respuesta/route.ts` (nuevo)                                 | HTTP ↔ `respondToProposal()`; negocia por `Accept`, `303` PRG o JSON                                                                | 2, 3           |
| 6     | `src/app/api/crons/expire-proposals/route.ts`, `src/app/api/crons/_lib/guard.ts` (nuevos) | El cron diario; guard compartido con `purge-sso-tokens`                                                                             | 4              |
| 6     | `vercel.json`                                                                             | Segundo cron, `0 5 * * *`                                                                                                           | 4              |
| 6     | `src/app/api/internal/orders/status/route.ts`                                             | Enum a seis valores; `AWAITING_CUSTOMER` → 400 (E19)                                                                                | 5, 9           |
| 7     | `src/features/orders/proposalDiff.ts` (nuevo)                                             | `buildProposalDiff()` — el "Qué cambia" línea a línea, emparejado por `storeProductId`                                              | 1              |
| 7     | `src/features/orders/components/OrderProposalCard.tsx` (nuevo)                            | El panel: plazo, mensaje, diff, los dos totales, los dos `<details>`/`<form>`                                                       | 1              |
| 7     | `src/app/[slug]/pedido/[code]/page.tsx`                                                   | El bloque, la insignia con `cancelledBy`/`proposalExpired`, el banner `?r=`, DP1, PP4                                               | 1, 9           |
| 8     | `scripts/renegotiate-order.mjs` (nuevo)                                                   | Siete modos, uno por criterio: `--propose --approve --reject --expire --outcomes --transit --link-on-create`                        | 1,2,3,4a,5,7,9 |
| 8     | `.agent/specs/F-019/smoke.sh` (nuevo)                                                     | Traduce `FAIL` a `SMOKE FAIL` para el sensor                                                                                        | 1,2,3,4a,5,7,9 |
| 9     | `docs/sync-contract.md`                                                                   | Versión 5, no aditiva en el enum; los siete puntos de architecture.md                                                               | 8              |
| 9     | `docs/adr/0024-segunda-ruta-publica-de-escritura.md`                                      | De Propuesta a Aceptada; defensa 9 reescrita como regla de plataforma no verificable (PP1)                                          | —              |

## Desviaciones

Los archivos que toqué sin que la tabla de la etapa correspondiente los
nombrara — el "Qué se hace" de la etapa sí describía el trabajo, la columna
"Archivos" del plan simplemente no lo listaba:

- **Etapa 6**: `src/features/orders/server/pull.ts` (el barrido de DA5 + los
  tres campos nuevos del payload) y `src/features/orders/server/status.ts`
  (`cancelledBy = STORE`, DA6). `src/app/api/crons/purge-sso-tokens/route.ts`
  perdió su guard inline por el compartido, tal como architecture.md dice
  literalmente ("se le extrae el guard compartido").
- **Etapa 7**: `src/features/orders/server/read.ts` (la propuesta y
  `cancelledBy` en el `select` y en el tipo — architecture.md § "Estado
  actual relevante" lo dice explícito) y
  `src/features/orders/components/OrderLinesTable.tsx` (`title`/`badge`
  opcionales, default = comportamiento de hoy, para poder decir "Tu pedido
  si aceptas el cambio" + `Badge Propuesta` sin duplicar el componente).

Conflicto real entre artefactos, resuelto a favor del contrato de cable:
**design.md DP3** (motivos con radios + texto libre opcional para el
rechazo) contradice **architecture.md DA4** y **ADR 0024 defensa 6**, que
dicen explícitamente que el cuerpo de `POST …/respuesta` es "un solo campo
útil: `decision`" y que "el comprador no aporta texto". La bitácora de
sdd-architect no menciona haber leído design.md, así que probablemente
escribió DA4 sin verlo. Implementé según architecture.md/ADR (single field,
`cancelReason` = constante del servidor): el criterio 3 solo exige
`cancelReason` no nulo, no que sea texto del comprador, así que ningún
criterio se ve afectado. El formulario de rechazo **no** lleva motivo.
**IP1 para el humano**: si quieres el selector de motivo de DP3, el contrato
de la ruta cambia (un campo más) y eso es una revisión de plan, no algo que
yo debiera decidir solo.

Recorte de alcance frente a design.md, ninguno de los 10 criterios lo exige:

- **Sin la "nota de cambio ya aprobado"** de design.md (estado 12: un aviso
  bajo la tabla de líneas en cualquier pedido posterior a una aprobación).
  Los datos para construirla ya están (`OrderSnapshot.proposal` sobrevive a
  la aprobación, por PP3), pero no hay UI para ella todavía.
- **Sin `OrderResponseBanner.tsx` separado**: el banner de `?r=` vive
  inline en `page.tsx` (el plan solo lista `OrderProposalCard.tsx` para la
  etapa 7).
- **`buildProposalWhatsappUrl()` con copia genérica**, no "hay una
  propuesta de cambio": architecture.md dice que el pull (E24) reutiliza la
  MISMA función para todo pedido, tenga o no propuesta viva; con el texto
  original mentiría en un pedido recién creado sin propuesta.

Infraestructura de pruebas:

- **`vitest.config.mts`**: `expiry.db.test.ts` es el séptimo archivo
  `*.db.test.ts`, un archivo más allá del techo declarado de 6
  (F-015 architecture.md § Escalabilidad). Añadí `fileParallelism: false`
  al proyecto `db`, que es la acción que ese mismo documento prescribe al
  cruzar el techo.

Bugs reales que `scripts/renegotiate-order.mjs` encontró al ejercitarlo
contra la app corriendo, no contra un mock:

1. El `.env` de este worktree trae `QAB_BEARER_TOKEN` con un valor
   placeholder no vacío, nunca acuñado de verdad. El guion no cae en ese
   fallback como sí hace `pull-orders.mjs`: siempre acuña un token fresco
   para `seed-negocio-1` salvo `--token=` explícito.
2. Comparar importes del pull por igualdad de string es un error: Prisma
   `Decimal.toString()` quita los ceros de cola ("1150" en vez de
   "1150.00"), una propiedad que **ya tenía** el pull de F-010, no algo que
   este feature cambió. El guion compara con `Number()`.
3. La URL del pedido dentro de un `wa.me` va URL-encodeada dentro de
   `?text=` (los `/` se vuelven `%2F`): hay que `decodeURIComponent()` el
   mensaje antes de buscar la ruta como subcadena.

## Preguntas para el humano

- **IP1** — ver "Conflicto real entre artefactos" arriba: ¿el rechazo debe
  pedir un motivo (design.md DP3) aunque eso cambie el contrato de
  `POST …/respuesta` que architecture.md y la ADR 0024 fijaron con un solo
  campo?
- **IP2** — ¿vale la pena construir la "nota de cambio ya aprobado" de
  design.md (estado 12)? Los datos ya están; es una etapa de UI aparte, no
  bloquea ningún criterio de los diez.

## Lecciones para el playbook

Ninguna ficha nueva: los tres bugs de `scripts/renegotiate-order.mjs`
(arriba) son específicos de este guion, no trampas del repo que vayan a
repetirse en otro feature. La ficha `prisma-migrate-dev-borra-indices-gin-no-declarados`
y `pooler-transaccion-deadlock` ya cubrían, sin cambios, lo que este feature
volvió a pisar (la migración y el barrido del pull).

## Ciclo 2026-08-30 (tarde) — los dos defectos de `sdd-tester` (--visual)

`sdd-tester` verificó los diez `acceptance_criteria` (LISTO) pero encontró dos
defectos reales con Playwright que `--smoke`/`curl` no pescan (`tests.md`
§ «Fallos encontrados»). Este ciclo los cierra. Alcance: **solo** estos dos
defectos — nada de spec.md/architecture.md/design.md/plan.md/tests.md/
visual.mjs tocado, `.agent/features.json` intacto.

### Hallazgo 1 — `isCrossOrigin()` (R16), arreglado

`src/app/[slug]/pedido/[code]/respuesta/route.ts`: `isCrossOrigin()` comparaba
`Origin` contra `publicEnv.siteUrl` (constante de `.env`), no contra el origen
REAL de la petición. Cambiado a comparar contra `request.headers.get("host")`,
tal como prescribe la ficha `origin-header-contra-env-estatico-no-el-real.md`.
Ya no importa `publicEnv` en este archivo.

Test de regresión añadido en `route.test.ts`: un `Origin` con host:puerto
DISTINTO de `NEXT_PUBLIC_SITE_URL` pero IGUAL al `Host` real de la petición
(simulando el puerto 3101 de `verify.sh --visual`) ya NO se rechaza; el caso
cross-origin de verdad (`evil.example.com`) sigue dando `403`, sin cambios. El
helper `postForm()` ahora manda también un header `Host` (por defecto
`"localhost"`, igual que `URL`), porque `new Request()` no lo pone solo —
antes el test pasaba por casualidad con `host: null`, no porque el código
comparara nada real.

No toqué `docs/adr/0024-segunda-ruta-publica-de-escritura.md`: su defensa 8 ya
describe la regla en términos genéricos ("cuando la cabecera viene y no es la
del sitio"), sin nombrar `NEXT_PUBLIC_SITE_URL` ni ninguna implementación
concreta — sigue siendo exacta con el arreglo.

### Hallazgo 2 — banners de resultado sin 4.5:1, arreglado (solo la parte mía)

`design.md` § «Tokens y tema» pide envolver el cuerpo largo del banner en
`<p class="text-fg">`. Lo añadí en `page.tsx`, pero **eso solo no bastaba**:
medido con Playwright, el elemento que `visual.mjs` mide (`#respuesta [role]`,
el `<div>` que `Alert` pinta con `role` y con `text-{tono}` DIRECTAMENTE sobre
sí mismo, no sobre un descendiente) seguía dando el color del tono, porque
`color` es una propiedad que un hijo puede _heredar_ pero que no cambia el
valor computado del PADRE. Confirmado empíricamente (`getComputedStyle` en un
`next dev` propio, puerto 3300, antes/después) antes de escribir una segunda
línea de código.

Arreglo real: además del `<p className="text-fg">`, el propio `<Alert
tone={banner.tone}>` de esta única llamada lleva `className="!text-fg"` —
el `!` de Tailwind (`!important`) es necesario porque en el CSS generado
`.text-fg` se declara ANTES que `.text-positive`/`.text-warning` (orden
alfabético de Tailwind), así que sin `!` un `className` normal habría perdido
el empate de cascada para exactamente los tonos que fallaban. Esto **no**
toca `src/components/ui/Alert.tsx` (el componente compartido, usado en más de
40 sitios del repo) ni cambia nada para ninguna otra pantalla — es un
`className` puesto en el único punto de uso de `page.tsx`, con el comentario
que explica por qué hace falta. Medido de nuevo con Playwright tras el
cambio: las 5 banners que fallaban ahora dan `lab(9.47…)` (`--color-fg`) como
color del contenedor — contraste correcto.

`bash .agent/verify.sh F-019 --visual` bajó de **9** aserciones rojas a **2**:
V10 (Origin) y las 5 del banner, arregladas. Quedan rojas exactamente las dos
que `tests.md` ya atribuye a **Causa 2** (el propio `design.md`, no la
implementación) y que la ficha del playbook asigna explícitamente a otro
agente, no a mí:

- **El plazo apretado** (`text-warning` en `OrderProposalCard.tsx`, tramo
  15-59 min): mide 2.17-2.53:1. El diseño asume "3:1 admisible por tamaño y
  peso" sin haberlo medido nunca contra el fondo translúcido real. Arreglarlo
  significa o subir peso/tamaño o cambiar a `text-fg` — **una decisión de
  diseño**, no algo que yo deba decidir por mi cuenta (la ficha lo asigna
  literalmente a `sdd-designer`, y `design.md` — protegido, no lo toco — es
  quien fija hoy que `text-warning` es el patrón correcto aquí).
- **La insignia `Badge tone="warning"` ("Esperando tu respuesta")**: mide
  2.17-2.53:1. El PATRÓN (`Badge.tsx` TONES.warning) es pre-existente de
  F-011 (ya en uso en `ProductTable`/`StorePublicSwitch` antes de F-019),
  aunque esta ETIQUETA concreta ("Esperando tu respuesta") sea nueva. Es
  exactamente el caso que el humano me pidió parar y preguntar antes de
  tocar: un arreglo scoped (igual que hice con `Alert`, solo en
  `OrderStatusBadge.tsx`, sin tocar `Badge.tsx`) es técnicamente posible, pero
  también se saldría de lo que `design.md` § «Tokens y tema» dice hoy
  ("Insignia por estado: los cuatro tonos que Badge ya tiene, según §
  Textos" — sin excepción ni override). No lo hice sin permiso.

`bash .agent/verify.sh F-019 --full` sale **0**. `--visual` sale **1**, con
exactamente esas 2 aserciones (de 51 en total) en rojo — ninguna de las dos es
un criterio de `features.json` (`tests.md` ya lo señala), y las dos están
fuera de lo que un `sdd-implementer` puede decidir solo.

### Debris no relacionado que sí toqué

`docs/flujos-cc-qab.html` — un archivo HTML sin trackear en git, ajeno a
F-019, que rompía la etapa `format` de TODO el `verify.sh` (corre `prettier
--check .` sobre el árbol entero). Lo formateé con `npm run format`: el diff
es puramente cosmético (indentación, `/>` de auto-cierre), verificado línea a
línea — no es prosa de nadie, es marcado. No es un artefacto de F-019 ni de
ningún feature que yo conozca; lo señalo por si el humano quiere investigar
de dónde salió.

## Preguntas para el humano (ciclo 2)

- **IP3** — El plazo apretado (`OrderProposalCard.tsx`, `text-warning`) mide
  2.17-2.53:1, por debajo incluso del 3:1 que `design.md` da por admisible.
  La ficha `alert-tone-hereda-color-en-body-de-texto-largo.md` asigna esta
  decisión a `sdd-designer` (subir peso/tamaño, o pasar a `text-fg`). No lo
  toqué: es una revisión de `design.md`, no mía.
- **IP4** — La insignia `Badge tone="warning"` ("Esperando tu respuesta")
  también mide por debajo de 3:1. El patrón es de F-011 y `design.md` dice
  hoy usar los tonos de `Badge` "tal como están". ¿Se autoriza un arreglo
  scoped en `OrderStatusBadge.tsx` (sin tocar `Badge.tsx` ni ninguna otra
  pantalla), o se trata como deuda de sistema de diseño a resolver aparte?
- Con estas dos preguntas sin resolver, `bash .agent/verify.sh F-019 --visual`
  se queda en **2** aserciones rojas (de 51), ninguna de las diez
  `acceptance_criteria`. No fuerzo un arreglo sin ese permiso.

IP1 e IP2 (arriba, ciclo 1) siguen abiertas y sin relación con lo anterior.

## Ciclo 3 — oscurecer `--color-warning` (autorizado por el humano)

El humano recibió las tres opciones (subir peso/tamaño del plazo, exceptuar el
`Badge`, u oscurecer el token) y eligió la tercera, sabiendo que
`--color-warning` lo usan 22 archivos. Alcance de este ciclo: **solo**
`src/theme/tokens.css` (tema claro) y la ficha del playbook que este arreglo
deja desactualizada — nada de `spec.md`/`architecture.md`/`design.md`/
`plan.md`/`tests.md`/`visual.mjs`/`Badge.tsx`/`Alert.tsx`, y
`.agent/features.json` sigue en `passes: false` a propósito.

**Medición, no estimación.** Con un `next dev` propio (puerto 3300) y la misma
técnica de `visual.mjs` (canvas 1×1, componiendo contra todos los fondos
reales de los ancestros — `medirContraste()`), medí el plazo apretado
(`#propuesta time`, `text-warning`) y la insignia (`span.text-warning`) en
claro y en oscuro, antes de tocar nada:

- Claro (valor previo `oklch(0.72 0.15 75)`): plazo 2.53:1, insignia 2.17:1 —
  las dos por debajo de 4.5:1, tal como reportó `sdd-tester`.
- Oscuro (valor previo `oklch(0.8 0.14 75)`): plazo 9.26:1, insignia 7.68:1 —
  las dos ya sobre 4.5:1. **No toqué el oscuro**: bajarle la luminosidad sin
  que la medición lo pida habría sido el mismo error que esta tarea pedía
  evitar.

Bajé solo la luminosidad de claro en pasos (0.60 → 0.55 → 0.50 → 0.53 → 0.52
→ 0.51), remidiendo en cada paso contra el servidor vivo (mismo `next dev`,
Turbopack recompila el CSS al vuelo). `L=0.52` seguía dejando la insignia en
4.46:1 (por debajo); `L=0.51` la subía a 4.61:1 pero sin margen. Me quedé con
**`oklch(0.5 0.15 75)`**, que midió plazo 5.84-6.09:1 e insignia 4.61-4.77:1
según el pedido usado como fixture — las dos con margen sobre 4.5:1 en los
dos usos que fallaban, sin cambiar croma (`0.15`) ni tono (`75`).

**Qué más usa el token, y qué no se rompió.** De los 22 archivos que
mencionan "warning" en `src/`, solo 7 usan una clase real del token
(`bg|text|border-warning`): `Alert.tsx`, `Badge.tsx`, `ImageUploader.tsx`,
`AddToCartButton.tsx`, `CartView.tsx`, `OrderProposalCard.tsx` y este mismo
`page.tsx`. Los dos que lo usan como **fondo/borde** translúcido
(`bg-warning/15` en `Alert`/`Badge`/`CartView`, `border-warning/30` en
`Alert`/`OrderProposalCard`) solo se ven algo más oscuros/saturados al
15-30% de opacidad — comprobado con una captura de Playwright de la página
del pedido (`#propuesta`, que lleva `border-warning/30`, con la insignia en
la misma pantalla): ambos siguen leyéndose como "advertencia", sin banda
blanca ni contraste raro. No repetí la captura para `CartView.tsx`, pero usa
exactamente el mismo par de clases que la insignia (`bg-warning/15
text-warning`), así que el mismo arreglo también le sube el contraste, sin
que hubiera ninguna aserción visual que lo midiera antes (el humano ya avisó
que
esto pasaría: "arregla de paso todo el texto warning de la app... que nadie
había medido"). No encontré ningún caso peor que antes.

**`!text-fg` en `page.tsx` (línea ~147) — sigue haciendo falta, no lo quité.**
Ese `className="!text-fg"` cubre los 6 tonos de banner (`positive`, `muted`,
`warning`, `danger`), no solo `warning`; oscurecer únicamente el token de
warning no vuelve superfluo el override para `positive`/`danger`, que no se
tocaron. Es un arreglo estructural (el contenedor de `Alert` sigue llevando
`text-{tono}` sobre sí mismo) independiente de qué tan oscuro sea cada tono.
Añadí un comentario en `tokens.css` explicando el cambio y actualicé la ficha
`.agent/playbook/alert-tone-hereda-color-en-body-de-texto-largo.md` § «Cómo
se arregla» (Causa 2) con lo que de verdad se aplicó, para que no quede
prescribiendo dos arreglos (subir peso, o exceptuar `Badge`) que ya no son
los que se usaron.

**Efecto colateral fuera de alcance, arreglado igual porque bloqueaba
`--full`.** `.agent/specs/propuestas/contraste-de-tokens-de-tema.md` (un
documento de propuesta, no un artefacto de F-019) citaba un nombre de archivo
que no existe (le faltaba el sufijo "-tokens") — el script real es
`scripts/check-theme-tokens.mjs`. Corregido el nombre en la prosa (un typo
puntual de ese documento, no una trampa nueva del repo); dado de baja con
`bash .agent/verify.sh dismiss F-019 '<firma>' '<motivo>'` en vez de fichar,
porque no enseña nada que `check-harness-falso-positivo-ruta-abreviada.md`
no cubra ya en espíritu.

`bash .agent/verify.sh F-019 --visual` → **0** (51/51). `bash .agent/verify.sh
F-019 --full` → **0**. `bash .agent/verify.sh pending F-019` → vacío.

No hay preguntas nuevas para el humano en este ciclo: la decisión que
faltaba (oscurecer el token) ya vino resuelta en el encargo. IP1 e IP2 del
ciclo 1 siguen abiertas.
