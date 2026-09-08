---
feature: F-038
agente: orquestador
actualizado: 2026-09-08T01:30:30Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cuadrecaja va a poder decirnos **qué monedas quiere enseñar cada negocio en su
escaparate**, con un evento `BUSINESS` en el mismo lote del sync que ya envía.
Hoy ese evento responde `400 INVALID_BATCH` y se lleva por delante el lote
entero; después de esto se guarda contra el negocio autenticado, con su guarda
anti-rancio y con dos errores propios que fallan **solo ese evento** en vez del
lote.

Lo que **no** cambia: nada de lo que ve un comprador. Las páginas de la tienda
muestran exactamente lo que muestran hoy, con el mismo catálogo. La lista se
guarda y **nadie la lee todavía** — eso es F-039.

## Pasos

El orden no es negociable en dos sitios y está justificado abajo: el schema de
Prisma va **antes** que el schema del sobre (paso 3 antes del 5), y la migración
se aplica antes de que corra ningún `*.db.test.ts`.

| Nº  | Qué se hace                                                                                                                                                                                     | Archivos                                                                                                       | Criterio que acerca | Cómo se verifica                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Las dos constantes de error que el contrato publicó en la v12 y el código no tiene                                                                                                              | `src/constants/sync.ts`                                                                                        | 3, 4                | `bash .agent/verify.sh F-038 --only typecheck`                                                       |
| 2   | El módulo puro: `findInvalidDisplayCurrency` (R3, `/^[A-Z]{3}$/`) y `dedupeDisplayCurrencies` (R4, primera aparición, orden estable), con su test parametrizado                                 | src/features/sync/displayCurrencies.ts y src/features/sync/displayCurrencies.test.ts (por crear)               | 3, 6                | `bash .agent/verify.sh F-038 --only test`                                                            |
| 3   | El enum `SyncEntity` gana `BUSINESS` y `Business` gana `displayCurrencies String[] @default([])` y `displayCurrenciesSourceUpdatedAt DateTime?`; se genera la migración **sin aplicar**         | `prisma/schema.prisma`, prisma/migrations/\<timestamp\>\_business_display_currencies/migration.sql (por crear) | 1, 5                | `npx prisma migrate dev --create-only`, revisar el SQL, `npx prisma generate`                        |
| 4   | Validar la migración en una base **de usar y tirar** y solo entonces aplicarla a la compartida                                                                                                  | ninguno                                                                                                        | 1, 5                | `migrate deploy` + `migrate diff` vacío en `f038_check`; luego `migrate deploy` en `queandabuscando` |
| 5   | La sexta rama del sobre: `businessPayloadSchema` laxo (`z.array(z.string())`, D5) y su rama en `syncEventSchema`; se extiende el test de la frontera                                            | `src/features/sync/schemas.ts`, `src/features/sync/schemas.test.ts`                                            | 1, 2, 10            | `bash .agent/verify.sh F-038 --only test`                                                            |
| 6   | `dependencyRoleOf` gana `case "BUSINESS": { provides: null, requires: null }` — no añade dependencia de orden, pero hay que tocarlo: su `default` exhaustivo pone el typecheck en rojo si no    | `src/features/sync/dependencies.ts`, `src/features/sync/dependencies.test.ts`                                  | 2                   | `bash .agent/verify.sh F-038 --only typecheck` y `--only test`                                       |
| 7   | El handler: DELETE → miembros → guarda `>=` → escritura, con **un solo** `updateMany` condicional (`count === 0` es `stale`), sin `$transaction` y sin invalidar nada                           | src/features/sync/server/handlers/business.ts y src/features/sync/server/handlers/business.test.ts (por crear) | 1, 3, 4, 5, 6, 7, 8 | `bash .agent/verify.sh F-038 --only test`                                                            |
| 8   | El enrutado: la rama `BUSINESS` del `switch` de `applyEvent`, y el mock de `./handlers/business` en el test de lote (sin él, sus doce casos actuales cargan Prisma de verdad)                   | `src/features/sync/server/processBatch.ts`, `src/features/sync/server/processBatch.test.ts`                    | 1                   | `bash .agent/verify.sh F-038 --only test`                                                            |
| 9   | La prueba del `403 BUSINESS_MISMATCH`, que sale gratis: `findCatalogMismatch` ya funciona con `BUSINESS` porque su condición es `"businessId" in event.payload`. **No se toca `identity.ts`**   | `src/features/sync/identity.test.ts`                                                                           | 9                   | `bash .agent/verify.sh F-038 --only test`                                                            |
| 10  | Los trece escenarios contra el `POST` real y leyendo la fila: los diez criterios de comportamiento, la retirada de una moneda (R7) y la primera entrega sobre marca `NULL`                      | src/features/sync/server/handlers/business.db.test.ts (por crear)                                              | 1-10                | `bash .agent/verify.sh F-038 --only test`                                                            |
| 11  | La bandera `--business[=caso]` del guion de humo, componiendo con las que ya hay: `ok`, `invalid`, `delete`, `empty`, `dup`, `forty`                                                            | `scripts/send-catalog-batch.mjs`                                                                               | 12                  | los cuatro desenlaces a mano con `next dev` levantado                                                |
| 12  | El guion de humo del feature, con el control de determinismo de C11(b) antes del escenario y la limpieza de los dos `eventId` fijos de `--repeat`                                               | .agent/specs/F-038/smoke.sh (por crear)                                                                        | 11, 12              | `bash .agent/verify.sh F-038 --smoke`                                                                |
| 13  | La prosa, al cerrar: contrato a **v12.2** retirando el aviso de los **tres** sitios donde vive, `docs/despliegue.md` § 8.3, la línea fechada en `.agent/solicitudes.md` y la línea de AGENTS.md | `docs/sync-contract.md`, `docs/despliegue.md`, `.agent/solicitudes.md`, `AGENTS.md`                            | 13                  | `npm run format` + diffear la prosa, y `npm run check:harness`                                       |
| 14  | El sensor completo                                                                                                                                                                              | ninguno                                                                                                        | 14                  | `bash .agent/verify.sh F-038 --full` termina en `0`                                                  |

**Por qué el paso 3 va antes del 5.** `recordBatch`
(`src/features/sync/server/inbox.ts`) pasa `entity: event.entity` al `createMany`
de `SyncEvent`, tipado `$Enums.SyncEntity`. Si el sobre acepta `"BUSINESS"` antes
de que el enum de Prisma lo tenga **y se haya corrido `prisma generate`**,
`npm run typecheck` sale rojo por un motivo que no es el trabajo de nadie.

**Por qué el paso 6 existe aunque no haga nada.** El `default` exhaustivo de
`src/features/sync/dependencies.ts` (`const exhaustive: never`) deja de compilar
en cuanto el union crece, **nombrando la entidad**. Es la señal que su comentario
anuncia; va como paso para que nadie la diagnostique como sorpresa.

## De dónde sale cada paso

| Paso | Sale de                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 1    | `spec.md` R14 · `architecture.md` § Contratos · criterio 13 del contrato (v12)      |
| 2    | `spec.md` R3, R4 (D3 del humano) · `architecture.md` AD4                            |
| 3    | `spec.md` R8, R16 · `architecture.md` AD1, AD2 y § El SQL exacto, medido            |
| 4    | `architecture.md` § Cómo se genera, y qué NO se ejecuta · D6 del humano             |
| 5    | `spec.md` R1, R2, R17 (D5 del humano) · `architecture.md` § Contratos               |
| 6    | `spec.md` R12 · `architecture.md` AD8, sitio 1                                      |
| 7    | `spec.md` R5, R6, R9, R10, R11, R13, R21 · `architecture.md` AD3, AD5               |
| 8    | `spec.md` R15 · `architecture.md` AD8, sitios 2 y 4                                 |
| 9    | `spec.md` R18, I6 · `architecture.md` AD6                                           |
| 10   | `spec.md` R7 y sus escenarios · `architecture.md` AD6                               |
| 11   | `spec.md` R22 · criterio 12 de `.agent/features.json`                               |
| 12   | `architecture.md` AD7                                                               |
| 13   | `spec.md` R19, R20, I8, I9 (D1 y D2 del humano) · `architecture.md` § despliegue.md |
| 14   | criterio 14 de `.agent/features.json`                                               |

## Qué queda fuera

- **Pintar las monedas en la tienda.** Es **F-039**, que depende de este. Aquí no
  se toca `resolvePrice`, ni las tasas, ni ninguna página de `src/app/`. El
  criterio 11 lo comprueba al revés: las páginas del seed tienen que mostrar
  **exactamente** lo que mostraban antes.
- **Invalidar caché** (D4). Ningún `revalidate*` nuevo, porque no hay lector al
  que la caché pueda quedarle vieja. **Deuda con nombre**: el día que exista el
  lector, la invalidación tiene que llegar **con él**, o una página cacheada
  servirá la lista anterior hasta 3600 s. Está anotado como I7 en `spec.md` y
  F-039 lo hereda.
- **Mover `businessName` o `baseCurrency` fuera de `STORE`.** Los sigue
  escribiendo `handleStore` y este handler no los toca.
- **Tocar la tabla global `Currency` o `ExchangeRate`.** Una moneda declarada que
  todavía no tiene su fila es un estado **normal**, no un error: el handler no
  crea ninguna moneda provisional. El criterio 7 lo comprueba contando filas.
- **Las zonas (S-007 / v13).** `ZONE_TARIFF` aparece solo como ejemplo de
  vocabulario que hay que **seguir rechazando**; ese test es la guarda de que no
  entra antes de F-041.
- **Sembrar la lista.** `prisma/seed.ts` no cambia.
- **Editar `.agents/solicitudes-qab.md`**, que es del repo de cuadrecaja. El
  traslado al otro equipo lo hace el humano (D2).

## Riesgos y plan B

**Hay migración, y toca una base compartida.** Es el riesgo principal y la
condición que el humano puso al aprobarla: _«solo si no rompe con la
sincronización que debe tener la BD con el esquema de prisma y sus migrations»_.
Comprobado antes de escribir este plan, el 2026-09-07, y las tres salidas fueron
limpias: `npx prisma migrate status` da «Database schema is up to date!» (15
migraciones); `migrate diff` contra la compartida sale vacío; y `migrate diff`
sobre una base de usar y tirar con las 15 migraciones reproducidas desde cero
**también** sale vacío. Bajo Prisma 7.9.1 el diff **no** propone los cinco
`DROP INDEX` de índices GIN y parciales que describen las fichas de F-010/F-021 y
F-032 — las dos son de la era de Prisma 6.

Aun así, el paso 3 **abre el `migration.sql` generado y busca `DROP INDEX`**, y
borra toda línea que nombre uno de esos cinco. Que la lista salga vacía esta vez
no convierte el paso en opcional. Y el paso 4 valida en una base de usar y tirar
**antes** de tocar la compartida. `prisma migrate reset` y `prisma db push` no
aparecen y no hacen falta: el cambio es aditivo y no hay nada que rellenar.
Marcha atrás: la migración es aditiva, así que deshacerla es un `ALTER TABLE …
DROP COLUMN` de dos columnas que nadie lee; el valor del enum se queda (Postgres
no retira valores de un enum sin recrearlo) y no molesta a nadie.

**El `ALTER TYPE … ADD VALUE` no hay que partirlo.** Comprobado ejecutando en
Postgres 16.15: sí corre dentro de la transacción de la migración. Lo prohibido
es **usar** el valor nuevo en esa misma transacción, y la migración no inserta
filas.

**El guion de humo borra filas.** El paso 12 borra por SQL, justo antes del par
`--repeat`, las dos filas de `SyncEvent` cuyo `eventId` es uno de los dos ids
fijos del guion. Sin eso, el aserto «processed → duplicate» solo vale la primera
corrida contra una base dada. Es acotado a esos dos ids, es lo que ya hacen los
guiones de F-035 y F-036, y no toca ninguna otra tabla.

**Hay cambio en `docs/sync-contract.md`, y hay otro equipo al otro lado.** Sube a
**v12.2, menor** (D1): retirar el aviso no cambia ninguna ruta, campo, enum ni
regla. La **v13 queda reservada para las zonas**. El aviso vive en **tres** sitios
del contrato, no en uno — cabecera, § «Cambios requeridos en cuadrecaja» punto 1
(el que lee el otro equipo) y § Verificación — y en un **cuarto** fuera de él,
`docs/despliegue.md` § 8.3, que el arquitecto encontró y la spec no tenía.
Retirarlo de uno solo deja el documento contradiciéndose.

**Prettier reescribe prosa ajena.** El paso 13 toca cuatro documentos que no
escribió este ciclo. El procedimiento es el de AGENTS.md: copia, formatea,
diffea, y si una línea de continuación que empezaba por `+`, `-` o `*` se
convirtió en viñeta, se reescribe a mano. Es la trampa con más reincidencias del
repo.

**Un archivo que todavía no existe no se cita entre comillas invertidas.**
`npm run check:harness` recorre la prosa del arnés y falla si una ruta entre
comillas invertidas no está en el disco. Este plan ya escribe sin ellas y con
«(por crear)» los seis archivos que no existen; el implementador tiene que
mantener esa forma en `impl.md` hasta que existan.

## Coste

Un ciclo de `sdd-implementer` (pasos 1-9, 11-13) y uno de `sdd-tester` (paso 10 y
el veredicto de los 14 criterios), más el `--full` del paso 14.

**De lo que ya funciona se tocan seis archivos**, y cinco de los seis son de una
línea o dos: `src/constants/sync.ts` (dos constantes), `src/features/sync/schemas.ts`
(una rama), `src/features/sync/dependencies.ts` (un `case`),
`src/features/sync/server/processBatch.ts` (un `case`),
`scripts/send-catalog-batch.mjs` (una bandera) y `prisma/schema.prisma` (un valor
de enum y dos columnas). Ningún handler existente cambia de forma, ningún estado
del 207 se añade, ninguna ruta se toca.

**Marcha atrás a mitad**: revertir la rama deja el árbol como estaba; lo único
que no se va con un `git revert` es la migración ya aplicada a la base
compartida, y son dos columnas que nadie lee más un valor de enum que nadie
emite.

## Preguntas antes de aprobar

Ninguna abierta. Las seis decisiones que hacían falta las tomó el humano el
2026-09-07 (D1-D6, en `.agent/progress/F-038.md` § Decisiones tomadas) y están
incorporadas a los pasos. Las tres que el arquitecto devolvió se resuelven así, y
si el humano no está de acuerdo con alguna, lo dice al firmar:

- **AP1** (cuándo se aplica la migración a la compartida) → ya es **D6**: la
  aplica el implementador en el paso 4, después de validarla en una base de usar
  y tirar y de revisar el SQL a mano. Con un matiz sobre lo que se dijo al
  decidirlo: se aplica con `prisma migrate deploy`, no con `npm run db:migrate`
  —que es `migrate dev` y aplica sin dejar revisar—, que es la forma que respeta
  la condición del humano.
- **AP2** (si `docs/despliegue.md` § 8.3 entra en este ciclo) → **sí**, paso 13.
  AGENTS.md § Documentación lo exige: un paso operativo se anota en el mismo
  ciclo que lo introduce, y ese párrafo pasa a describir un paso ya hecho.
- **AP3** (si el guion de humo puede borrar las dos filas de `SyncEvent` de los
  ids fijos) → **sí**, acotado a esos dos ids. Está en § Riesgos arriba.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-038 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-08T01:30:30Z — aprobado por el humano: «Aprobado tal cual: los 14 pasos, el «qué queda fuera» y las tres cosas señaladas — migración aplicada por el implementador con migrate deploy tras revisar el SQL, el guion de humo borrando sus dos filas, y los cuatro sitios del aviso.»
