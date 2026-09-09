---
feature: F-041
agente: orquestador
actualizado: 2026-09-09T03:40:04Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Un comercio podrá declarar, desde su POS, **cuánto cuesta llevar un pedido a cada
municipio de Cuba** —o que a ese municipio no se lleva— y esta plataforma lo
guardará, lo validará y sabrá resolver qué importe corresponde a una zona
concreta, con una regla escrita: si el municipio tiene tarifa, manda el
municipio; si no, manda la provincia; si tampoco, esa zona no se sirve.

Lo que **no** cambia en este ciclo: el comprador todavía no ve nada. No hay
selector de zona ni mapa en el checkout —eso es F-042—, así que una tienda que
elija el modo por zonas ofrecerá **solo recogida** hasta que F-042 exista, y no
cobrará ningún envío. Su tarifario, en cambio, ya se guarda desde el primer día.

## Pasos

Cinco fases. Dentro de cada una, el orden importa; entre fases, cada una
necesita la anterior.

| Nº     | Qué se hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Archivos                                                                                                                                     | Criterio que acerca  | Cómo se verifica                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**  | Generar el **índice** de 184 filas (16 de primer nivel + 168 municipios) desde el Codificador del DPA y una consulta viva a Overpass, con su procedencia y el informe de la unión. La errata de Santiago de Cuba (`32.xx` impreso donde va `34.xx`) queda **citada**, no corregida en silencio. Y el artefacto entra en `.prettierignore` en el mismo paso, porque Prettier le cambiaría los bytes y con ellos el sha256                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/features/zones/zone-index.json`, `…/zone-index.provenance.md`, `…/zone-index.join-report.md`, `.prettierignore`                         | C11, C16, C17        | Recuentos 184/16/168, cero códigos duplicados, 183 `osmRelationId` distintos (la Isla comparte relación), y el sha256 anotado. `npm run format:check` verde con el JSON ignorado           |
| **2**  | `toDecimalString` en `money.ts`, reutilizando la aritmética de enteros que ya existe. Ninguna segunda aritmética                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/lib/money.ts`                                                                                                                           | C2, C5               | `npm test` — `String(300)` da `"300"`, `toDecimalString(300)` da `"300.00"`                                                                                                                |
| **3**  | El **lector del índice**: `findZone`, `isKnownZoneCode`, `isRetiredZone`, `ZONE_INDEX_VERSION`. Sin `fs`, sin Prisma, sin React. Y la valla que impide que entre al cliente: `no-restricted-imports` para `src/components/**` y `src/app/**/*.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/features/zones/catalog.ts`, `eslint.config.mjs`                                                                                         | C6, C9, C16          | `npm run lint` y `npm run typecheck`                                                                                                                                                       |
| **4**  | La **precedencia** como función pura: importe, fila decisoria y **camino completo**, con las tres guardas (`FEE` sin importe no decide; `0` es envío gratis, comprobado contra `null` y nunca contra un falsy; negativo no decide)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/features/zones/precedence.ts`                                                                                                           | C1, C7               | `npm test`                                                                                                                                                                                 |
| **5**  | El guion que **calcula el vector ejecutando** la función pura sobre el fixture y emite el bloque JSON que se pega en el contrato, con los veredictos del camino **en inglés**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `scripts/compute-zone-vector.ts`, `package.json`                                                                                             | C1, C13              | `npm run vector:zones` imprime los 13 casos (10 de precedencia + 3 guardas)                                                                                                                |
| **6**  | El **esquema**: `ZONE_BASED` en `DeliveryFeeMode`, `ZONE_TARIFF` en `SyncEntity`, enums `ZoneLevel` y `ZoneTariffRule`, tablas `Zone`/`ZoneTariff`/`ZoneCatalogVersion`, columna `Store.zoneCode`. La migración **a mano**: `prisma migrate diff --from-config-datasource --to-schema … --script`, carpeta propia, `prisma migrate deploy`. **Nunca `migrate dev`** y se quitan del SQL los `DROP INDEX` de los cinco índices GIN no declarados                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `prisma/schema.prisma`, `prisma/migrations/<ts>_zone_shipping/migration.sql`                                                                 | C10                  | La migración corre contra la base real y una tienda con `ZONE_BASED` se guarda y se lee. Aditividad con `git diff main --stat -- prisma/migrations`, **no** con `migrate diff --exit-code` |
| **7**  | Mover los **cinco números clavados a mano** que la columna nueva desplaza: `Store 31 → 32` en dos asertos del test y en tres sitios del contrato, incluido «54 filas» → 55 y el título del propio test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `src/features/sync/fieldOwnership.test.ts`, `docs/sync-contract.md`                                                                          | C10                  | `npm test` — hoy quedaría verde mintiendo, así que se comprueba que el aserto cuenta 32                                                                                                    |
| **8**  | La **siembra** idempotente en un solo statement, su punto de entrada de producción y su línea documentada. `prisma/seed.ts` no corre en producción, así que el catálogo entra **a mano una vez**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/features/zones/server/catalogSeed.ts`, `scripts/seed-zone-catalog.ts`, `package.json`, `docs/despliegue.md`                             | C11                  | Sembrar dos veces seguidas deja 184 filas y la misma versión. El CI ya corre `npm run seed` dos veces                                                                                      |
| **9**  | **Desacoplar el vocabulario del domicilio** en dos preguntas con `switch` exhaustivo, para que `ZONE_BASED` no rompa `typecheck` y para que una tienda por zonas se acepte y degrade a recogida en vez de fallar con `STORE_DELIVERY_CONFIG_INCONSISTENT` para siempre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `src/features/orders/deliveryOffer.ts`, `src/features/orders/server/quote.ts`                                                                | C10, SP2             | `npm run typecheck` y `npm test`                                                                                                                                                           |
| **10** | La **séptima rama del sobre**: `zoneTariffPayloadSchema` (unión discriminada por `rule`), la rama de `syncEventSchema`, `zoneCode` en `storePayloadSchema`, y los códigos de error nuevos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/features/sync/schemas.ts`, `src/constants/sync.ts`                                                                                      | C3, C6, C9           | `npm test` — `NOT_SERVED`/`INHERIT` con importe dan 400, y `FEE` sin importe también                                                                                                       |
| **11** | El **handler** de `ZONE_TARIFF`: rechaza el `DELETE` **antes** de la guarda anti-rancio, resuelve la sucursal, guarda con la guarda, y reporta el slug para la invalidación. Más el séptimo `case` del despachador y la **cascada** `STORE → ZONE_TARIFF`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/features/sync/server/handlers/zoneTariff.ts`, `src/features/sync/server/processBatch.ts`, `src/features/sync/dependencies.ts`           | C2, C4, C5, C7, C12  | `npm test` y el `POST` real: 207 con `processed`, el `DELETE` en `failed[]` sin borrar filas, el rancio como `stale`                                                                       |
| **12** | La **guarda de zona en `STORE`** en las tres llamadas que ya usan `assertDeliveryConsistent`, y el borrado explícito del tarifario en el camino aplicado del `DELETE` —que hoy **suspende** la tienda en vez de borrarla, así que la cascada por clave ajena nunca se dispararía sola                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `src/features/sync/server/handlers/store.ts`                                                                                                 | C8, C9               | El `DELETE` de la sucursal se lleva sus filas, contadas antes y después                                                                                                                    |
| **13** | El **lector mínimo** del tarifario: carga las ≤2 filas de un `(tienda, zona)` y llama a la función pura                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/features/zones/server/tariffs.ts`                                                                                                       | C7                   | `npm test` contra base real                                                                                                                                                                |
| **14** | **Reapuntar los tests que van a mentir**: dos usan hoy `ZONE_TARIFF` como «entidad que el contrato no define» y seguirán en verde por otro motivo cuando exista. Y `zoneCode` entra en las columnas que el panel no comparte con el sync                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/features/sync/schemas.test.ts`, `src/features/sync/server/handlers/business.db.test.ts`, `src/features/admin/server/boundaries.test.ts` | C3, C9               | `npm test`                                                                                                                                                                                 |
| **15** | El **borrador de la v13** del contrato: la entidad, la precedencia con letra, los códigos de error, el vector en JSON calculado ejecutando, la tabla de cascadas, la versión del índice con su sha256 y la ruta del artefacto. Baja el bloque «Lo que NO entra en la v11». Más las **tres ADR nuevas**, `AGENTS.md` y la línea fechada de la S-007                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `docs/sync-contract.md`, `docs/adr/0032-…`, `0033-…`, `0034-…`, `AGENTS.md`, `.agent/solicitudes.md`                                         | C13                  | `npm test` (el test lee el contrato) y `npm run format:check`                                                                                                                              |
| **16** | Las **pruebas** de `sdd-tester`, en los proyectos que la arquitectura ya asignó: `precedence`, `catalog`, `boundaries` y `zoneTariff` en `server`; `zoneTariff`, `tariffs` y `catalogSeed` en `db`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | siete ficheros de test nuevos                                                                                                                | los 14 + C15/C16/C17 | `bash .agent/verify.sh F-041 --full` sale `0` (C14)                                                                                                                                        |
| **17** | **Cerrar la coordinación con cuadrecaja** (añadido el 2026-09-09, tras su veredicto): publicar el **hash del bloque JSON del vector** para que su test pueda fijar su copia sin tener nuestro fichero; **clasificar cada código de error nuevo** como permanente o reintentable, que es de lo que depende su outbox; y responder los **cinco menores** —las reglas de `ZONE_TARIFF.deliveryFee`, si `contact.zoneCode`/`zoneName` son opcionales o exigidos en una tienda `ZONE_BASED`, si `zoneCode` puede ser de provincia, el `storeId` de otro negocio como `404 UNKNOWN_STORE`, y desranciar el § «Nuestra postura sobre las solicitudes», que sigue proponiendo el selector jerárquico y el `400`—. Más la respuesta escrita al P7: `ZONE_BASED` con `deliveryFee` puesto en un `STORE`, y que una tienda `ZONE_BASED` **sin ninguna fila de tarifario es legal** y simplemente no ofrece domicilio, que es tu decisión SP2 dicha con letra | `docs/sync-contract.md`, `src/constants/sync.ts` (comentarios de clase), `src/features/zones/precedence.test.ts` (el hash)                   | C13                  | `npm test` y `npm run format:check`; el hash del bloque comprobado recalculándolo                                                                                                          |

## De dónde sale cada paso

| Paso | De dónde sale                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Componentes, filas «Índice / Procedencia / Informe de la unión»; § La versión del índice, punto 2 (`.prettierignore`); `spec.md` R6/R8, C17 |
| 2    | `architecture.md` § Decisión (3)                                                                                                                                |
| 3    | `architecture.md` § Decisión (2) y § La versión del índice, punto 3                                                                                             |
| 4    | `architecture.md` § Contratos 3; `spec.md` R26/R27 y las tres guardas                                                                                           |
| 5    | `architecture.md` § Componentes, fila «Calculadora del vector»; decisión del humano SP1 y AP1                                                                   |
| 6    | `architecture.md` § Modelo de datos y migraciones; `.agent/progress/F-041.md` § Notas (las tres fichas del playbook)                                            |
| 7    | `architecture.md` § Riesgos, punto 4; `spec.md` I5                                                                                                              |
| 8    | `architecture.md` § La siembra, en un statement; `spec.md` I8; decisión del humano AP3                                                                          |
| 9    | `architecture.md` § Contratos 1; `spec.md` I4; decisión del humano SP2                                                                                          |
| 10   | `architecture.md` § Contratos 2 y 4                                                                                                                             |
| 11   | `architecture.md` § Flujo A y § Contratos 5; decisión del humano SP3                                                                                            |
| 12   | `architecture.md` § Flujo B; `spec.md` I1 y R22                                                                                                                 |
| 13   | `architecture.md` § Flujo C                                                                                                                                     |
| 14   | `architecture.md` § Las doce incongruencias, I13; § La versión del índice, punto 8                                                                              |
| 15   | `features.json` C13; `architecture.md` § La versión del índice, puntos 4-7; decisiones del humano AP1, AP2 y AP4                                                |
| 16   | `architecture.md` § Componentes, tabla de tests                                                                                                                 |

## Qué queda fuera

- **Todo lo que ve el comprador.** El selector de zona, el mapa, `contact.zoneCode`
  y el cobro del envío por zona son **F-042**. Aquí una tienda `ZONE_BASED` acepta
  y guarda su tarifario, pero ofrece **solo recogida**: decisión del humano el
  2026-09-08, y es la única que no cobra un importe que nadie fijó para esa zona.
- **La geometría.** Ni polígonos, ni simplificación topológica, ni la herramienta
  que haría falta para ella. El índice de este feature **no lleva geometría**, y
  eso va escrito en su procedencia. También es de F-042.
- **Publicar la v13.** Este ciclo escribe el **borrador**; publicar espera el visto
  bueno de cuadrecaja, que es lo que pide el criterio 13. El borrador sale hacia
  ellos **al firmar este plan**, con la ruta del artefacto citada y el fichero
  adjunto.
- **PostGIS** (la ADR 0011 no se reabre: aquí las coordenadas no deciden el precio
  ni ordenan nada), **geocodificar**, **la pantalla del tarifario** (es de
  cuadrecaja, que se comprometió a que el encargado no pueda producir un `DELETE`
  cuando quiere decir «aquí no vamos») y **la búsqueda o los informes por zona**,
  que no existen en ningún backlog.
- **Corregir la errata de ONEI en silencio.** Los nueve municipios de Santiago de
  Cuba se siembran como `34.01`–`34.09` **citando** la errata; no se toca la
  fuente ni se presenta el número como si lo dijera el PDF.
- **Los puntos 1 y 2 de su veredicto, que son features propios** y los añadió el
  humano al backlog el 2026-09-09: **F-043** —un `zoneCode` desconocido falla solo
  su evento y no el lote, que corrige el criterio 6 de este feature porque la
  regla 3 no deja editarlo— y **F-044** —el tarifario entra en la reconciliación
  con su propio hash por sucursal—. **F-043 entra antes de publicar la v13**, para
  no publicar un `400` que ya sabemos que les rompe el drenaje.
- **La generalización del punto 4**: `parentCode` en vez de `provinceCode`, la
  precedencia redactada como cadena de padres y el tercer nivel opcional. El
  núcleo de su queja ya está resuelto —el padre es explícito y el contrato dice
  «nunca deducida de la forma del código»—; generalizarlo cambia el artefacto y el
  vector, así que no entra aquí.
- **Cambiar ningún `acceptance_criteria`.** El criterio 1 dice siete casos y el
  vector tiene diez: se implementan los diez y el criterio queda cumplido de
  sobra. La regla 3 se respeta y no se abre feature correctivo.

## Riesgos y plan B

Tres cosas de este plan **no se aprueban de pasada**, y están aquí para que se
firmen a la vista:

1. **Hay migración de base de datos.** Es aditiva —dos valores de enum, dos enums,
   tres tablas, una columna— y no borra ni transforma ningún dato existente. Pero
   corre contra la **base compartida entre worktrees**, así que se hace con
   `migrate diff` + carpeta a mano + `migrate deploy`, nunca con `migrate dev`, que
   ofrecería resetear el esquema. Marcha atrás: la migración inversa es un `DROP`
   de lo nuevo; un valor de enum de Postgres **no se puede quitar**, así que
   `ZONE_BASED` y `ZONE_TARIFF` se quedarían en el tipo aunque nadie los use.
2. **Se toca `docs/sync-contract.md`, que es el contrato con otro equipo.** Sube a
   v13 y hay gente al otro lado leyendo la versión para saber si lo que tiene sirve.
   Por eso el borrador sale antes de publicar.
3. **La cascada `STORE → ZONE_TARIFF` cambia lo que el POS puede esperar.** Hoy un
   `STORE` que falla no arrastra nada; desde la v13 arrastra los tarifarios de esa
   sucursal en el mismo lote. Va documentado en la v13 **antes** de que ellos lo
   implementen.

Y los tres que pueden torcer la ejecución:

4. **El paso 1 necesita Overpass viva.** `osmRelationId` y `osmName` no son
   opcionales. Si Overpass no responde ese día, el índice **no se genera a medias
   con los campos de OSM vacíos**: se para y se dice. Comprobado el 2026-09-08 que
   responde y devuelve 183 relaciones.
5. **Los bytes tienen que ser idénticos en los dos repositorios.** Tres cosas los
   mueven sin que nadie lo note: Prettier (de ahí el paso 1), un editor que cambie
   el final de línea, y una regeneración accidental. El sha256 del contrato es el
   árbitro y el test lo comprueba.
6. **El índice colado en el cliente no lo cazaría el presupuesto de bundle**
   (~7 KB gzip sobre 193, con la peor página en 182,1). La garantía son la regla de
   ESLint del paso 3 y el test de importadores del paso 16, no `check:bundle`.

## Coste

Dos ciclos de agente: `sdd-implementer` para los pasos 1-15 y `sdd-tester` para el
16, más las vueltas que el sensor pida. Sin `sdd-designer`: este feature no tiene
interfaz.

De lo que ya funciona se toca poco y en sitios acotados: `money.ts` gana una
función, `deliveryOffer.ts` se parte en dos preguntas (el propio comentario del
código dice que ese es el único sitio que decide, así que el cambio cae donde
estaba previsto), `schemas.ts` gana una rama, `processBatch.ts` un `case`,
`store.ts` una guarda y un borrado, y `dependencies.ts` dos líneas. Nada existente
cambia de comportamiento salvo una cosa a propósito: una tienda con
`deliveryEnabled` y modo por zonas pasa de ser **rechazada** a ser aceptada y
degradada a recogida.

Marcha atrás a mitad: revertir la rama deja el esquema con dos valores de enum
huérfanos (punto 1) y nada más. El artefacto y su procedencia se pueden quedar sin
daño: no los importa nadie hasta el paso 3.

## Preguntas antes de aprobar

**Ninguna.** Las ocho decisiones que necesitaban al humano están resueltas y
escritas donde viven: `SP1`–`SP4` al pie de su pregunta en `spec.md` § «Huecos y
preguntas al humano», y `AP1`–`AP4` en `architecture.md` § «Preguntas al humano».
Las cuatro anteriores —solo el índice, la errata, el momento del borrador y los
diez casos— están en `.agent/progress/F-041.md` § «Decisiones tomadas».

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-041 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-09T01:03:54Z — aprobado por el humano: «apruebo»

- 2026-09-09T03:40:04Z — aprobado por el humano: «firmado»
