---
feature: F-022
agente: sdd-implementer
actualizado: 2026-09-03T02:00:00Z
estado: listo
---

## Qué se construyó

Los pasos 1-6, 8 y 9 del plan firmado. Los pasos 7 y 10 (pruebas nuevas y
verificación de cierre) son de `sdd-tester`.

| Archivo                                                         | Qué hace                                                                                                                                                                                                                  | Criterio que cubre |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `prisma/schema.prisma`                                          | `timezone String @default("America/Havana")` en `model Store`                                                                                                                                                             | 1, 3               |
| `prisma/migrations/20260903002233_store_timezone/migration.sql` | `ALTER TABLE "Store" ADD COLUMN "timezone" ...` — revisado a mano, sin los 5 `DROP INDEX` que `migrate dev` propuso                                                                                                       | 1, 3               |
| `src/constants/storeHours.ts` (nuevo)                           | `DEFAULT_STORE_TIMEZONE`, `OPENING_HOURS_VERSION`, `OPENING_HOURS_DAY_KEYS`, los dos topes y `END_OF_DAY`                                                                                                                 | 1, 4               |
| `src/constants/sync.ts`                                         | `STORE_OPENING_HOURS_INVALID`, `STORE_TIMEZONE_INVALID`                                                                                                                                                                   | 4                  |
| `src/constants/admin.ts`                                        | `PANEL_PRODUCT_COLUMNS`, promovida desde el literal de `product.test.ts`                                                                                                                                                  | 5                  |
| `src/lib/timezone.ts` (nuevo)                                   | `SUPPORTED_TIME_ZONES`, `isCanonicalTimeZone` (los 3 pasos de R1, sin normalizar), `canonicalTimeZoneSchema`                                                                                                              | 3                  |
| `src/lib/openingHours.ts` (nuevo)                               | `openingHoursSchema` (estricto en los dos niveles), `parseOpeningHours` (tolerante), `readWeeklySchedule` (7 días en orden `mon→sun`), `evaluateStoreHours`                                                               | 2                  |
| `src/features/sync/server/handlers/store.ts`                    | `timezone: true` en el `select`; `assertOpeningHoursValid` antes de las dos escrituras; la puerta `isCanonicalTimeZone` en crear (contra el default) y en republicar (contra `existing.timezone`, solo si `optInChanged`) | 1, 3               |
| `src/features/admin/server/mutations.ts`                        | `PanelProductColumn` derivado de `PANEL_PRODUCT_COLUMNS`; `setStoreEnabled` lee `timezone` y devuelve `invalid_timezone` en la rama `enabled: true` antes de escribir; `enabled: false` no cambia                         | 1, 3               |
| `src/features/admin/types.ts`                                   | `AdminWriteResult` gana `{ kind: "invalid_timezone" }`                                                                                                                                                                    | 1, 3               |
| `src/app/api/admin/_lib/respond.ts`                             | `invalid_timezone` → `409 {"error":"INVALID_TIMEZONE"}`                                                                                                                                                                   | 1, 3               |
| `src/features/catalog/server/queries.ts`                        | `timezone` y `openingHours` en `StoreSummary` y en el `select` de `loadStore` (mismo `findUnique`, cero queries nuevas)                                                                                                   | —                  |
| `src/components/store/StoreHoursNotice.tsx` (nuevo)             | El cartel del horario de la semana: compacta días consecutivos, redacta 12 horas con los 5 bordes, cruce de medianoche con «del día siguiente»                                                                            | —                  |
| `src/app/[slug]/page.tsx`                                       | En la rama `PUBLISHED`: `readWeeklySchedule(store.openingHours)` y, si no es `null`, `<StoreHoursNotice>` entre `StoreTrail` y `StoreSearchBox`                                                                           | —                  |
| `prisma/seed.ts`                                                | `tienda-demo` gana `openingHours` con el calendario del «Caso 3» de `design.md` (cruce de medianoche, 24 h, un día cerrado, dos ventanas)                                                                                 | —                  |
| `docs/sync-contract.md`                                         | v9: nueva `## Cambios respecto a la v8`, dos filas de `207 failed[]`, la forma completa de `openingHours` en el ejemplo, las dos tablas de 31+23 filas, `### De la v9 (F-022)`                                            | 4                  |
| `docs/despliegue.md`                                            | §7 punto 5: comprobar el ICU en un preview (`AP2`); §9 punto 6: el `UPDATE` a mano de la zona mientras F-011 no tenga editor                                                                                              | —                  |

## Desviaciones

- **`StoreHoursNotice` recibe solo `{ schedule }`, sin `timezone`, y por
  tanto el texto no dice nunca «hora de la tienda» (DP4).** `design.md` pide,
  en su `A6`, que `timezone` y `DEFAULT_STORE_TIMEZONE` «lleguen a la vista»
  para que el rótulo lleve el sufijo «(hora de la tienda)» cuando la zona de
  la tienda no sea la del producto (DP4 = (a), tal como el plan lo cerró:
  «no se dice "hora de la tienda" salvo que haga falta»). Pero
  `architecture.md`, que es el documento `listo` y el que fija el contrato
  del componente, dice dos veces y sin matices que **la única prop es
  `{ schedule: WeeklyScheduleDay[] }`** (§ Componentes y § «Lo que se pinta»)
  y **nunca** menciona `timezone` llegando al componente ni a la página —
  grep confirmado: `DP4` no aparece en `architecture.md`. Los dos documentos
  no se conciliaron en ese punto concreto (el arquitecto sí concilió A1 y A5
  explícitamente en su segunda pasada, pero no A6). Ante el conflicto, seguí
  la letra de `architecture.md` (el contrato fijado, `listo`) en vez de
  inventar una segunda prop que ese documento no autoriza. Efecto práctico:
  hoy es invisible, porque las diez tiendas sembradas están en el default
  (`America/Havana`); solo se notaría el día en que una tienda tenga otra
  zona. Ver `IP1`.
- **La compactación y el copy (`formatClockTime`, `formatWindow`,
  `compactSchedule`, `segmentLabel`) viven dentro de
  `src/components/store/StoreHoursNotice.tsx`**, como funciones puras
  exportables junto al componente, en vez de en un archivo separado
  src/lib/openingHoursCopy.ts (no creado) que `design.md` (no
  `architecture.md`) sugiere crear. `architecture.md` § «Archivos: qué se
  crea y qué se toca» —la tabla que fija qué archivos se tocan y con qué
  contenido— **no** incluye ese archivo, y mi instrucción es no crear «ni
  uno más» de los
  archivos que esa tabla nombra. `design.md` mismo dice que «la ubicación
  final la fija el plan con el arquitecto»; el plan no la fijó como archivo
  aparte. El requisito de fondo de `design.md` —que la redacción sea una
  función pura, verificable sin React ni DOM— se cumple igual: las funciones
  son exports nombrados de nivel de módulo, sin JSX, importables y probables
  sin renderizar nada.
- **No se implementó ningún test.** Es el paso 7, asignado a `sdd-tester`.

## Comandos ejecutados

- `npx prisma migrate dev --name store_timezone --create-only` → migración
  creada; revisada a mano (quitados 5 `DROP INDEX` de índices GIN/parciales
  no declarados, ficha `prisma-migrate-dev-borra-indices-gin-no-declarados`);
  aplicada con `npx prisma migrate dev` (hubo que matar el proceso en el
  prompt final de "Enter a name for the new migration" — la migración ya
  había aplicado correctamente antes de ese prompt, y no se creó ninguna
  migración adicional). `npx prisma migrate status` → "Database schema is up
  to date!", 14 migraciones.
- `npm run db:generate` → cliente generado.
- `npm run typecheck` → 0, limpio, en cada paso.
- `npm run lint` → 0 errores (1 warning preexistente y ajeno en
  `ProfileForm.tsx`).
- `npm run format` / `npm run format:check` → limpio. Verificado con
  copia-formatea-diffea sobre `docs/sync-contract.md` (154 líneas de diff,
  las tres "sospechosas" de un diff automatizado eran solo realineado de
  ancho de columna de tabla, cero prosa reescrita).
- `npm test` (`npx vitest run`) → **1221 pasan, 2 fallan** (ver
  «Qué necesita quien pruebe»).
- `npm run build` → éxito. `/[slug]` sigue prerenderizada (● SSG) para
  `tienda-demo`, `bodega-central`, etc.
- `npm run check:bundle` → 0. `177.6 KB` gzip de JS de cliente en la página
  más pesada (una ficha de producto, no la portada), presupuesto 193 KB sin
  tocar.
- `npm run check:theme` → 0.
- `npm run check:harness` → 0, 242 documentos.
- Verificado a mano contra el HTML servido (`.next/server/app/tienda-demo.html`
  tras `rm -rf .next && npm run build`, con la base re-sembrada): el `<dl>`
  con los siete días, sus tramos, «no abre», «abierto las 24 horas» y «de
  10:00 p.m. a 2:00 a.m. del día siguiente» aparecen **en el HTML servido por
  el servidor**, sin JavaScript — confirma R5 y R14. `bodega-central.html`
  (sin `openingHours`) no contiene la palabra «horario» en ningún caso — E8.
- Verificado con un script de scratch que cruza `prisma/schema.prisma` contra
  las dos tablas nuevas de `docs/sync-contract.md`: **31/31 columnas de
  `Store`** y **23/23 de `StoreProduct`** coinciden en los dos sentidos (cero
  de más, cero de menos) — adelanta lo que el test de exhaustividad del
  paso 7 tiene que confirmar de forma automática.
- Verificado con un script de scratch la tabla de 8 filas del criterio 2
  (`evaluateStoreHours`) con `TZ` en `UTC`, `Pacific/Kiritimati` y
  `America/Los_Angeles`: las tres dan **la misma salida, byte a byte**.
- `bash .agent/verify.sh F-022 --full` → **código 2 (ESTANCADO)**, por la
  misma firma tres veces seguidas. Ver «Qué necesita quien pruebe» — es un
  fallo esperado de dos tests preexistentes que no son míos de tocar, no un
  bloqueo real de mi alcance.

## Deuda dejada

Ninguna intencional dentro del alcance de los pasos 1-6, 8 y 9. Lo que falta
para que `verify.sh --full` dé `0` es el paso 7 (las pruebas nuevas, y
actualizar los fixtures de los dos tests preexistentes — ver abajo) y el
paso 10, ambos de `sdd-tester`.

## Qué necesita quien pruebe

- **Dos tests preexistentes están en rojo y hay que actualizar sus fixtures
  (no es un bug de este ciclo, es la consecuencia esperada de ampliar el
  `select`/lectura de `timezone` en los dos escritores de `PUBLISHED`):**
  - `src/features/sync/server/handlers/store.test.ts` →
    `"a real opt-in flip to publish clears the disabled columns"`. El mock de
    `existing` que usa ese test no incluye `timezone`, así que
    `isCanonicalTimeZone(undefined)` da `false` y la puerta nueva lanza
    `STORE_TIMEZONE_INVALID`. Arreglo: añadir `timezone: "America/Havana"`
    (o `DEFAULT_STORE_TIMEZONE`) al mock de esa fila.
  - `src/features/admin/server/mutations.test.ts` →
    `"publishes and clears the disabled columns, then revalidates (HD10)"`.
    El mock `storeFindUnique` no tiene una resolución por defecto en ese
    test, así que la nueva lectura de `setStoreEnabled` (rama `enabled: true`)
    recibe `undefined` y el código devuelve `not_found` antes de llegar al
    `update`. Arreglo: `storeFindUnique.mockResolvedValueOnce({ timezone: "America/Havana" })`
    (o equivalente) antes de esa llamada.
  - Confirmado con `dismiss` en el arnés (`bash .agent/verify.sh dismiss F-022 ...`)
    y con `bash .agent/verify.sh pending F-022` vacío: no son un fallo sin
    diagnosticar, son trabajo del paso 7 que aún no se ha hecho.
- **Cómo ver el cartel de verdad**: `npm run seed` (ya corrido en este
  ciclo — la base de este worktree tiene `tienda-demo` con el calendario del
  Caso 3), luego `npm run dev` y abrir `/tienda-demo`. El bloque aparece
  entre la ruta y el buscador. `tienda-dos` y el resto de tiendas siguen sin
  `openingHours`, así que no muestran nada (E8) — es el estado real de
  producción hoy.
- **La tabla de 8 filas del criterio 2** ya está verificada a mano (ver
  arriba); el test que la automatice tiene que mutar `process.env.TZ` en
  caliente — confirmado que funciona en este runtime (Node 24.13.1).
- **El test de exhaustividad del criterio 4** puede reusar directamente el
  parser de scratch que usé para verificar 31/23: lee `prisma/schema.prisma`
  con la regex de `architecture.md`, extrae los identificadores entre
  comillas invertidas de las dos tablas nuevas de `docs/sync-contract.md`, y
  compara conjuntos en los dos sentidos.
- **AC1** (publicar sin timezone falla) se prueba forzando la columna por SQL
  directo, tal como plan.md § Riesgos ya advierte — no hay camino normal que
  lo alcance.

## Preguntas al humano

**IP1** — `design.md` (A6) pide que `timezone`/`DEFAULT_STORE_TIMEZONE`
lleguen a la vista para que el rótulo diga «(hora de la tienda)» cuando la
zona no sea la del producto (DP4 = (a), como el plan lo cerró). Pero
`architecture.md`, el documento `listo` que fija el contrato del componente,
dice explícitamente y dos veces que la única prop de `StoreHoursNotice` es
`{ schedule }`, sin mencionar `timezone` en ningún punto — los dos documentos
no se conciliaron en este punto concreto. Implementé la letra de
`architecture.md` (una sola prop, sin el sufijo de zona) porque es el
contrato fijado y firmado; el efecto es invisible hoy porque todas las
tiendas sembradas están en el default. ¿Se amplía la prop del componente para
cumplir DP4 al pie de la letra, o se deja así hasta que exista una tienda con
otra zona (F-011)? No bloquea ningún criterio de aceptación de `features.json`.

**IP2** — El plan (paso 5, columna «Cómo se verifica») pide
`npx vitest run src/features/sync src/features/admin` **en verde**, pero la
misma frontera del ciclo prohíbe tocar `store.test.ts` y `mutations.test.ts`
—asignados al paso 7—, y son exactamente los dos archivos cuyos fixtures hay
que actualizar para que esa verificación dé verde (ver «Qué necesita quien
pruebe»). No es un conflicto que pueda resolver yo sin violar una de las dos
instrucciones; dejé el código correcto (verificado con el resto de la suite,
1221/1223, y con los scripts de scratch de la tabla del criterio 2 y del
cruce de 54 columnas) y dejé `bash .agent/verify.sh pending F-022` vacío con
un `dismiss` explicando el porqué. ¿Confirmas que esto se resuelve en el
paso 7, tal como leo el plan, o hay algo que se me escapa?
