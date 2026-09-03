---
feature: F-022
agente: orquestador
actualizado: 2026-09-03T00:20:50Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cada tienda pasa a tener **su propia zona horaria**, un identificador IANA de
verdad, y su calendario de apertura deja de ser un `Json` que nadie mira: pasa a
tener formato validado, y la página pública muestra **el horario de la semana**
para que el comprador decida él. Además el contrato con cuadrecaja gana la
**tabla exhaustiva de propiedad de campos**: los 54 campos de `Store` y
`StoreProduct`, cada uno con su dueño y qué pasa si llega un evento que lo toca.

Lo que **no** cambia: la página sigue cacheada exactamente igual que hoy, el
navegador no recibe un byte más de JavaScript, y comprar funciona igual dentro y
fuera de horario. El vencimiento de pedidos y la vigencia de promociones siguen
con el reloj de siempre — no entran en este feature.

## Pasos

| Nº  | Qué se hace                                                                                                                                   | Archivos                                                                                                                                                                                                                                                                                                                                                                                                | Criterio que acerca | Cómo se verifica                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | La columna: `timezone` en `Store`, `NOT NULL` con default `America/Havana`, y su migración                                                    | `prisma/schema.prisma` · crear prisma/migrations/<timestamp>\_store_timezone/migration.sql                                                                                                                                                                                                                                                                                                              | 1, 3                | `npx prisma migrate status` sin pendientes, `npm run db:generate`, `npm run typecheck`. Revisar a mano que el SQL **no** trae ningún `DROP` |
| 2   | Las constantes: topes y claves del horario, los dos códigos de error nuevos, y `PANEL_PRODUCT_COLUMNS` promovida desde un test a producción   | crear src/constants/storeHours.ts · `src/constants/sync.ts` · `src/constants/admin.ts`                                                                                                                                                                                                                                                                                                                  | 4, 5, 6, 7          | `npm run typecheck` y `npm run lint`                                                                                                        |
| 3   | La validación de la zona: pertenencia a la lista del runtime, sensible a mayúsculas, **sin `toLowerCase()` ni `trim()`**                      | crear src/lib/timezone.ts                                                                                                                                                                                                                                                                                                                                                                               | 3                   | `npm run typecheck`; su prueba entra en el paso 7                                                                                           |
| 4   | El calendario: schema en dos modos (estricto y tolerante), `readWeeklySchedule` con los siete días en orden, y `evaluateStoreHours`           | crear src/lib/openingHours.ts                                                                                                                                                                                                                                                                                                                                                                           | 2                   | `npm run typecheck`; sus pruebas entran en el paso 7                                                                                        |
| 5   | La puerta de `PUBLISHED` en los dos caminos del sync y en el del panel, más el rechazo del calendario malformado **en el handler**            | `src/features/sync/server/handlers/store.ts` · `src/features/admin/server/mutations.ts` · `src/features/admin/types.ts` · `src/app/api/admin/_lib/respond.ts`                                                                                                                                                                                                                                           | 1, 3                | `npm run typecheck`; `npx vitest run src/features/sync src/features/admin` en verde                                                         |
| 6   | La vista: el horario semanal en la página de la tienda, sin `<Suspense>` y sin `revalidate` propio, más la tienda de demostración con horario | crear src/components/store/StoreHoursNotice.tsx · `src/features/catalog/server/queries.ts` · `src/app/[slug]/page.tsx` · `prisma/seed.ts`                                                                                                                                                                                                                                                               | —                   | `npm run build` y `npm run check:bundle` en verde: si la página dejara de prerenderizarse, esa etapa sale 1 sola                            |
| 7   | Las pruebas nuevas y las de los caminos tocados, incluidas las dos guardas de frontera                                                        | crear src/lib/timezone.test.ts · src/lib/openingHours.test.ts · src/features/sync/fieldOwnership.test.ts · src/features/sync/server/handlers/storePublishGate.db.test.ts · `src/lib/boundaries.test.ts` · `src/features/sync/server/handlers/store.test.ts` · `src/features/sync/schemas.test.ts` · `src/features/sync/server/handlers/product.test.ts` · `src/features/admin/server/mutations.test.ts` | 1, 2, 3, 5          | `npm run test` en verde, y el evaluador probado **mutando `process.env.TZ`** (el criterio 2 exige `TZ=UTC`). Las escribe `sdd-tester`       |
| 8   | El contrato v9: la tabla de propiedad de **54 filas** (31 de `Store` + 23 de `StoreProduct`) y los dos códigos de error nuevos                | `docs/sync-contract.md`                                                                                                                                                                                                                                                                                                                                                                                 | 4                   | El hook de versión no avisa y `head -3` dice v9; el chequeo de exhaustividad del paso 7 cuadra la tabla contra `prisma/schema.prisma`       |
| 9   | Los dos pasos operativos: el `UPDATE` a mano de la zona mientras F-011 no tenga editor, y comprobar una vez el ICU en un preview              | `docs/despliegue.md`                                                                                                                                                                                                                                                                                                                                                                                    | —                   | Revisión: `AGENTS.md` § Documentación exige que el paso operativo se escriba en el mismo ciclo que lo introduce                             |
| 10  | Verificación de cierre                                                                                                                        | ninguno (solo se ejecuta)                                                                                                                                                                                                                                                                                                                                                                               | 6, 7                | `grep -ri "umbral\|threshold" src/ prisma/schema.prisma` sin ningún campo almacenado, y `bash .agent/verify.sh F-022 --full` en 0           |

## De dónde sale cada paso

| Paso | Sale de                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Modelo de datos; R1 y el criterio 1 del feature                                         |
| 2    | `architecture.md` DA4 y su tabla de archivos                                                                |
| 3    | `spec.md` R1 y el dato medido de que `Intl.DateTimeFormat` acepta `+05:00`, `Cuba` y `america/havana`       |
| 4    | `spec.md` § Datos y contrato (el formato) y el criterio 2                                                   |
| 5    | `spec.md` SP3 y E10, y el hallazgo de la arquitectura sobre la validación a nivel de lote                   |
| 6    | `design.md` entero, y la resolución de SP5/AP1 como HTML cacheado                                           |
| 7    | `architecture.md` § Archivos, y la guarda A5 de `design.md`                                                 |
| 8    | Criterio 4 del feature, y `docs/sync-contract.md:561-576`, que ya dice que el resto de la tabla es de F-022 |
| 9    | `AP2`, y `AGENTS.md` § Documentación                                                                        |
| 10   | Criterios 6 y 7 del feature                                                                                 |

## Qué queda fuera

- **El editor de horarios del panel: es F-011.** Consecuencia práctica que hay que
  asumir: en este ciclo la zona horaria **solo se puede cambiar con un `UPDATE` a
  mano**, y por eso el paso 9 lo escribe en `docs/despliegue.md`.
- **El estado en vivo «abierta / cerrada ahora».** La página dice el horario y el
  comprador decide. Nada afirma nada del ahora, ni siquiera qué día es hoy.
- **El hueco dinámico y bajar el `revalidate`.** Los dos descartados: el hueco no
  existe en Next 16.3.2 y volver dinámica la página tiraría el guardián del
  presupuesto de JavaScript.
- **Bloquear la compra fuera de horario.** El `409 STORE_CLOSED` conserva su
  significado actual. Bloquear sería un feature tuyo.
- **Promociones y vencimientos en hora de tienda.** R2 alcanza solo a
  abierto/cerrado; el resto sigue con el reloj del proceso y de Postgres.
- **Horarios de entrega separados** y **la línea en la ficha de producto**.

## Riesgos y plan B

**Hay migración y hay cambio de contrato, y ninguna de las dos se aprueba de
pasada.** La migración es `ALTER TABLE "Store" ADD COLUMN "timezone" TEXT NOT
NULL DEFAULT 'America/Havana'`: **no puede perder datos**, no necesita backfill
(en Postgres 11+ un default constante no reescribe la tabla) y se revierte con
`DROP COLUMN`. El contrato sube a **v9, mayor**, y con SP3 hay algo que avisarle
a cuadrecaja **antes** de publicarla, no solo al cerrar.

**Dos criterios se verifican forzando el estado, no por el camino normal. Quiero
que lo sepas antes de firmar, no después:**

- **Criterio 1** («publicar una tienda sin timezone falla»): con la columna `NOT
NULL` y default, «sin timezone» no es alcanzable por el panel ni por el sync.
  Se prueba poniendo la columna a un valor ilegible por SQL y comprobando que
  publicar falla. Lo que demuestra es que **la puerta existe**, no que la
  ausencia sea posible.
- **Criterio 3** («un timezone inválido se rechaza al guardar»): en este alcance
  **nada guarda la zona**, porque el editor es F-011. Se prueba contra la función
  de validación y contra la puerta de publicación.

| Riesgo                                                          | Cómo se notaría                                     | Qué se hace                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| La migración trae un `DROP INDEX` que `migrate dev` añade sola  | Revisión a mano del SQL antes de aplicarlo          | Se edita el archivo y se deja solo el `ALTER TABLE ... ADD COLUMN`                                     |
| Alguien enchufa el evaluador en una vista «para resaltar hoy»   | La guarda de frontera del paso 7, en `npm test`     | Es intencional que falle: volvería dinámica la página y tiraría tu decisión. Detrás está el porqué     |
| El ICU de producción trae menos zonas y R1 rechaza zonas buenas | Una tienda legítima que no se puede publicar        | Por eso el paso 9: comprobarlo una vez en un preview. Si trae menos, es una pregunta nueva para ti     |
| La tabla de 54 filas se queda obsoleta al añadir una columna    | El chequeo de exhaustividad del paso 7 se pone rojo | Está diseñado para eso; la fuente de verdad es `prisma/schema.prisma`, no el cliente generado          |
| El horario semanal alarga demasiado la página en móvil          | Medido: 24 px con un tramo, 160 px en el peor caso  | Incluso el peor deja la primera fila de tarjetas por encima de 600 px. Si molesta, es ajuste de diseño |
| Un agente se estanca (`verify.sh` sale 2)                       | Tres intentos con la misma firma                    | Vuelve a mí, no al mismo agente                                                                        |

## Coste

Dos ciclos: **`sdd-implementer`** hace los pasos 1–6, 8 y 9, y **`sdd-tester`**
los pasos 7 y 10. Se toca por dentro el handler del sync que publica tiendas y la
mutación del panel que las reabre — los dos caminos por los que una tienda llega
a estar publicada.

Marcha atrás: los archivos nuevos se borran sin rastro y la columna se quita con
un `DROP COLUMN` que **hoy** no pierde nada, porque nadie ha escrito todavía una
zona distinta del default. Deja de ser verdad en cuanto F-011 tenga editor. Lo
caro de deshacer es el paso 8: si la v9 ya se publicó, hay que retirarla y avisar
al otro equipo.

## Preguntas antes de aprobar

Ninguna abierta. Las once decisiones que este plan traduce están en
`.agent/progress/F-022.md`, y las tres preguntas que quedaron abiertas en los
documentos las cerré yo por no requerir criterio de producto: la línea no entra
en la ficha de producto (DP3), no se dice «hora de la tienda» salvo que haga
falta (DP4), y el horario no se repite en el pie de las demás rutas (DP5).

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-022 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-03T00:20:50Z — aprobado por el humano: «Sí, adelante»
