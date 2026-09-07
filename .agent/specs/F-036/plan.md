---
feature: F-036
agente: orquestador
actualizado: 2026-09-07T12:34:54Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Hoy la tasa «vigente» de un negocio es literalmente **la última fila que
llegó**. Si el evento de 440 falla, entra el de 480 y luego el de 440 se
reintenta y pasa, la tienda vuelve a cobrar a 440 — sin error, sin alerta y sin
que ninguno de los dos lados lo detecte. La tasa no está caducada: está
resucitada. Después de esto, la vigente será la de `updatedAt` mayor, así que un
evento que llega tarde ya no puede resucitar un importe viejo.

Lo que **no** cambia: nada de lo que el POS envía ni recibe. `updatedAt` ya
viaja y ya se valida; lo único que cambia es que deja de tirarse. Un evento
rancio sigue respondiendo `processed` y viajando en `ok`, **nunca** en `failed`:
no es un fallo y no debe gastar ninguno de los 6 intentos del outbox. El
histórico sigue siendo append-only y sigue sin haber forma de borrar una fila.

Lo que sigue sin poder hacerse: avisar a nadie de que llegó una tasa rancia. Ni
al comprador ni al encargado. Eso sería una pantalla, y de cuadrecaja.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                                      | Archivos                                                                                                                                 | Criterio que acerca | Cómo se verifica                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| 1   | El schema, dos cosas a la vez: columna `sourceUpdatedAt DateTime?` (**nullable**, sin `@default`) más el índice cubridor de AD1 con `map:`; y **declarar los cuatro índices GIN** de búsqueda que hoy existen en la base y no están en el schema | `prisma/schema.prisma`                                                                                                                   | 1, 5, 7             | `npx prisma validate` y `bash .agent/verify.sh F-036`                  |
| 2   | La migración, **generada por Prisma y no editada por nadie**. Comprobado por el orquestador sobre una base de usar y tirar: hecho el paso 1, la salida son exactamente tres sentencias y **ningún** `DROP INDEX` de búsqueda                     | prisma/migrations/&lt;timestamp&gt;\_exchange_rate_source_updated_at/migration.sql (por crear)                                           | 5, 7                | `migrate deploy` en una base de usar y tirar, y el guion del paso 7    |
| 3   | El escritor: el `create` de `handleExchangeRate` gana `sourceUpdatedAt` del payload. Ninguna rama nueva, ningún `STALE`, y el `return SKIPPED` de `CUP` sigue siendo lo primero                                                                  | `src/features/sync/server/handlers/misc.ts`, `src/features/sync/server/handlers/misc.test.ts`                                            | 2, 3                | `bash .agent/verify.sh F-036`                                          |
| 4   | La lectura única: módulo nuevo con `buildCurrentRatesSql` (exportado para poder explicarlo), `loadCurrentRates` y `CurrentRateRow`, con el `DISTINCT ON (currencyCode)` y el `ORDER BY` de AD1, **con `NULLS LAST` en la primera clave**         | src/features/catalog/server/rates.ts (por crear), src/features/catalog/server/rates.test.ts (por crear)                                  | 1, 4, 6, 7          | `bash .agent/verify.sh F-036`                                          |
| 5   | Los dos lectores pasan a usarla: `loadRates` y `loadFreshRates` **se borran**, `getStoreRates` cambia de loader y de argumento, y `BranchResolution`/`SelectorResolution` ganan `businessId` del `select` que ya corre                           | `src/features/catalog/server/queries.ts`, `src/features/orders/server/quote.ts`, `src/features/storefront/server/resolve.ts` y sus tests | 1, 6                | `bash .agent/verify.sh F-036`                                          |
| 6   | El seed: `RATES` gana marca **explícita y determinista** por entrada, con literal ISO y nunca `new Date()`. Ya no lo fuerza el compilador —la columna es nullable—, lo fuerza que una fixture sin marca ordenaría al final y nadie lo notaría    | `prisma/seed.ts`                                                                                                                         | 5                   | `npm run seed` dos veces (idempotente) y `bash .agent/verify.sh F-036` |
| 7   | El guion ordenado del criterio 5: comprobar que la columna no existe → sembrar la fila vieja por SQL → migrar → comprobar que la vieja quedó con la marca a **`NULL`** → escenario en que la nueva gana → limpiar. De una pasada                 | .agent/specs/F-036/migracion-fila-vieja.sh (por crear)                                                                                   | 5                   | Ejecutarlo y pegar la salida en `tests.md`                             |
| 8   | El `EXPLAIN` del criterio 7 con volumen medido (~2 000 filas de relleno y `VACUUM ANALYZE`), con la aserción sobre el **nodo** del `Relation Name` correcto y nunca sobre `Heap Fetches`; más la invariante permanente de la migración           | src/features/catalog/server/rates.db.test.ts (por crear)                                                                                 | 7                   | `npx vitest run --project db` sobre ese archivo                        |
| 9   | El smoke de lo que solo se ve por HTTP: los dos lectores comparados **entre sí** en la misma corrida, con `price: 1` para que el importe sea la tasa                                                                                             | .agent/specs/F-036/smoke.sh (por crear)                                                                                                  | 1, 6                | `bash .agent/verify.sh F-036 --smoke`                                  |
| 10  | La documentación: la ADR 0030 (ya en borrador) y la frase de I7 en `AGENTS.md`, que hoy describe la guarda anti-rancia solo con el mecanismo de **rechazo** y deja fuera el de orden                                                             | `docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`, `AGENTS.md`                                                                     | 8                   | `npm run check:harness` y la lectura del humano                        |
| 11  | Cierre: `impl.md`, `tests.md` con una casilla por criterio, y el sensor completo                                                                                                                                                                 | `.agent/specs/F-036/impl.md`, `.agent/specs/F-036/tests.md`, `.agent/progress/F-036.md`                                                  | 8, 9                | `bash .agent/verify.sh F-036 --full` sale 0                            |

El orden importa en tres sitios. El **1 antes del 2**, y las dos mitades del
paso 1 en el mismo commit: si se genera la migración antes de declarar los
cuatro índices GIN, Prisma vuelve a proponer borrarlos y el archivo generado
deja de ser aplicable tal cual — que es exactamente lo que esta versión del plan
evita. El **2 antes del 6**, porque el seed no puede escribir una columna que no
existe. Y el **7 es el único paso que no se puede repetir sobre una base ya
migrada**: si se ejecuta en el orden equivocado, su paso 0 aborta en rojo en vez
de dar un falso verde.

Los pasos 1-6 y 10 son de `sdd-implementer`; los 7, 8, 9 y 11, de `sdd-tester`.

## De dónde sale cada paso

| Paso | Lo justifica                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Modelo de datos (el bloque Prisma completo) y AD1 (el índice cubridor, medido) · `spec.md` R6, R7, R8                                                                                                                                  |
| 2    | `architecture.md` § Modelo de datos · la decisión del humano de 2026-09-07 («las migraciones las genera Prisma, no se editan») · y la medición del orquestador que la hace posible: declarar los cuatro GIN deja la salida en tres sentencias limpias      |
| 3    | `spec.md` R1, R2, R3, R11, R12 · `architecture.md` § Componentes (fila de `handleExchangeRate`)                                                                                                                                                            |
| 4    | `architecture.md` AD1 y AD3 (`DISTINCT ON`, con el volumen que hoy viaja medido) · `spec.md` R4, R5                                                                                                                                                        |
| 5    | `architecture.md` AD4 (`BranchResolution` gana `businessId`) y § Componentes · `spec.md` R4 (orden idéntico en los dos lectores), I2                                                                                                                       |
| 6    | `spec.md` R15 · `architecture.md` § Archivos que toca cada cambio (fila de `prisma/seed.ts`). I4 deja de aplicar: con la columna nullable el seed compilaría sin marca, y por eso la marca pasa a ser una decisión de fixture y no una obligación del tipo |
| 7    | `spec.md` C5 e I3 (el criterio no puede vivir en la suite: `npm test` corre contra un esquema ya migrado)                                                                                                                                                  |
| 8    | `spec.md` C7 e I2 · `architecture.md` AD1 (el umbral medido: el plan salta entre 121 y 321 filas) y su aviso sobre `Heap Fetches`                                                                                                                          |
| 9    | `spec.md` C6 (los dos lectores comparados entre sí, no contra un número escrito a mano)                                                                                                                                                                    |
| 10   | `architecture.md` AD5 y `AP3` · `spec.md` I7 · `AGENTS.md` § Documentación                                                                                                                                                                                 |
| 11   | `.agent/README.md` § Al completar un feature · `spec.md` C8, C9                                                                                                                                                                                            |

## Qué queda fuera

- **Rechazar el evento rancio.** Se escribe y responde `processed`. Es la mitad
  de la postura firmada en la S-005: la guarda sí, el rechazo no.
- **Borrar filas.** El histórico es append-only y sigue sin tener camino de
  borrado. El criterio 3 lo fija como requisito, no como efecto secundario.
- **Tocar `CURRENCY`.** Su tercera asimetría sigue en pie a propósito.
- **La mitigación del lado de cuadrecaja** (cancelar los pendientes de la misma
  clave). Es suya y es complementaria, no un sustituto de esto.
- **Una clave monótona** (columna `seq`, o `createdAt` a `TIMESTAMP(6)`) para
  que el criterio 4 sea literal en vez de determinista. El desempate queda por
  `id`: determinista, pero **no cronológico**. Se aprueba así porque el empate de
  milisegundo no se ha observado nunca en la base real, y una columna nueva en
  una tabla que crece sin techo cuesta más que el caso que evita.
- **Que la columna sea `NOT NULL`**, y con ella el relleno de las filas
  existentes. Lo descarta PD1: Prisma no puede generar un relleno, y su propio
  flujo para ese caso pasa por editar el archivo generado. Una fila sin marca
  ordena al final y nunca gana, que es lo que el criterio 5 pide.
- **Avisar de una tasa rancia** a alguien, en cualquier pantalla.
- **`docs/sync-contract.md`.** La regla ② de la v11 ya está publicada.

## Riesgos y plan B

| Riesgo                                                                                                                         | Cómo se notaría                                                                                             | Plan B                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **La migración rompe los worktrees hermanos.** Un checkout sin esta migración se encuentra una columna que su schema no conoce | Otra sesión ve rojo sin haber tocado nada                                                                   | Muy reducido al ser la columna **nullable**: `npm run seed` y los `*.db.test.ts` de un checkout viejo siguen funcionando, porque nada les obliga a escribirla. Aun así, todo el trabajo va en bases de usar y tirar y la aplicación a la compartida es **una sola y anunciada** (decisión del humano) |
| Aplicar un `ADD COLUMN … NOT NULL`                                                                                             | `ERROR: column "sourceUpdatedAt" … contains null values`, y acto seguido la herramienta ofrece **resetear** | No puede pasar: la columna es nullable por decisión, así que no hay relleno ni endurecimiento. `migrate reset` sigue prohibido y no aparece en ningún paso                                                                                                                                            |
| La migración se lleva por delante los índices de búsqueda                                                                      | Ningún test se pone rojo y la búsqueda del catálogo hace seq scan en producción                             | **Resuelto de raíz en el paso 1**, no vigilado a mano: declarados los cuatro GIN, `migrate diff` deja de proponer su borrado. Medido por el orquestador — la salida son tres sentencias y ninguna toca un índice de búsqueda, ni el parcial, que Prisma ignora por completo                           |
| Alguien vuelve a dejar la columna sin `NULLS LAST` en el `ORDER BY`                                                            | Una fila sin marca gana **para siempre** y el feature produce el fallo que venía a arreglar                 | Hay **un solo** sitio que ordena por esta columna (`buildCurrentRatesSql`), y su test de unidad afirma el `ORDER BY` completo, `NULLS LAST` incluido. Era la objeción de la spec a esta variante, y se sostenía cuando había dos lectores; con uno, no                                                |
| El `EXPLAIN` del criterio 7 sale `Seq Scan` con datos de juguete                                                               | El criterio falla sin que el índice esté mal                                                                | Postgres elige por **coste**: el plan salta entre 121 y 321 filas, medido. Se rellena a ~2 000 y se hace `VACUUM ANALYZE`                                                                                                                                                                             |
| El criterio 5 se «verifica» sobre una base ya migrada                                                                          | Pasa en verde sin haber probado nada                                                                        | El paso 0 del guion comprueba que la columna **no** existe y aborta en rojo si existe. Es lo que impide el falso verde                                                                                                                                                                                |

**Esto sí toca lo delicado, y no se aprueba de pasada:** hay una **migración**.
No borra ni una columna, no endurece nada y no pierde ningún dato — añade una
columna nullable, retira un índice que ningún lector usaba y crea el nuevo. Se
aplica a una base que comparten todos los worktrees y `git revert` no la
deshace. **La genera Prisma y nadie la edita**, que es la condición que puso el
humano; el paso 1 es lo que la hace cumplible. No hay `prisma migrate reset` ni
`db push` en ningún paso, y no hay cambio en `docs/sync-contract.md`.

## Coste

Tres ciclos de agente: uno de `sdd-implementer` (pasos 1-6 y 10), uno de
`sdd-tester` (7-9 y 11) y margen para una vuelta. Es más grande que F-035: dos
archivos nuevos de producción, dos lectores que se funden en uno, un tipo
compartido que gana un campo, el seed, el schema y una migración.

De lo que ya funciona se toca el camino del **checkout** —que no tiene caché y
corre en cada cotización— y el de la vitrina. La red de seguridad son sus dos
suites, que ya existen.

Dar marcha atrás: el código es un `git revert`. La migración **no**, pero cuesta
poco: la columna nullable se queda y es inofensiva —nadie la lee si el código
volvió atrás—, y el único daño real sería el índice viejo, que hay que reponer a
mano si alguien lo echa en falta. Por eso el paso 2 va después del 1 y antes que
todo lo demás: para que la decisión de aplicarla llegue con el schema ya
revisado.

## Decisiones del humano antes de firmar

Las tres preguntas de la primera versión de este plan están **respondidas**, y
por eso el plan puede firmarse. Quedan escritas aquí porque dos de ellas
cambiaron el plan y una fue contra mi recomendación.

**PD1 — la migración la genera Prisma y no se edita.** Palabras del humano
(2026-09-07): «no se deben modificar los archivos migrations de prisma
directamente, prisma los debe generar a partir de los cambios que se hagan en su
esquema», y el dato que lo hace viable: «las BD existentes que pueden haber
actualmente de QAB estan en este localhost, no hay nada en pruebas o produccion
aun». Eso **cambió el plan**: la columna pasa a **nullable** con `NULLS LAST` en
el único `ORDER BY` que la usa, en vez de `NOT NULL` con relleno, porque Prisma
no puede generar un relleno a partir de un esquema y su propio flujo para ese
caso es editar el archivo. La objeción que la spec le hacía a esta variante
—«deja la trampa viva para la siguiente consulta que alguien escriba»— se cayó
cuando la arquitectura fundió los dos lectores en una sola sentencia: hay un
sitio que ordena por esta columna, no dos ni muchos. Y el criterio 5 se cumple
igual, porque una fila sin marca ordena al final y nunca gana.

**PD2 — los índices de búsqueda se declaran en el schema.** Decisión del humano
en la misma tanda. No es cosmética: es lo que hace que `migrate diff` deje de
proponer su borrado, y por tanto lo que permite cumplir PD1 sin editar nada.
Arregla la trampa que `AGENTS.md` § Cosas que muerden documenta, **para
siempre** y no solo en este feature. Comprobado ejecutando, no deducido: con los
cuatro GIN declarados, la salida de `migrate diff` son tres sentencias y ninguna
toca un índice de búsqueda. El quinto —`StoreProduct_visible_catalog_idx`, que es
parcial y Prisma no sabe expresar— **no hace falta declararlo**: Prisma no lo ve
y no lo propone.

**PD3 — la caché de tasas pasa a una entrada por negocio.** El humano eligió la
opción del arquitecto **contra mi recomendación**, y queda escrito con el riesgo
que yo veía, no sin él: la corrección de esa variante depende de que ninguna
sucursal renderizable pueda dejar de serlo, porque la entrada queda etiquetada
con el `storeTag` de la sucursal que la creó y F-035 expira el de todas las
renderizables. Hoy es inalcanzable —nada en el repo escribe `DRAFT`: el sync
despublica a `SUSPENDED` y el panel escribe `PUBLISHED`/`SUSPENDED`—, pero es un
invariante que no garantiza el schema. **Lo que este plan añade por eso:** el
comentario de `getStoreRates` tiene que decir de qué depende su frescura, con
esa frase y no con un «se invalida por tag», para que quien algún día escriba un
`DRAFT` tenga una pista en el sitio donde va a romperse.

**PD4 — las 19 filas `QAB` se borraron y el smoke de F-035 quedó arreglado.**
Ejecutado en esta sesión: la tabla quedó en 4 filas reales, y el smoke ahora
borra sus tasas y su moneda al terminar (verificado corriéndolo: `--smoke` en 0
y cero residuo). Ese arreglo viaja en la rama de F-036 por comodidad, y se dice
en el PR.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-036 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-07T12:34:54Z — aprobado por el humano: «Apruebo tal cual. Migracion: bases de usar y tirar, pero "no se deben modificar los archivos migrations de prisma directamente, prisma los debe generar a partir de los cambios que se hagan en su esquema" (no hay nada en pruebas o produccion aun, todo es localhost). Indices de busqueda: declararlos en el schema. Cache de tasas: una entrada por negocio. Filas QAB: borralas y arregla el smoke.»
