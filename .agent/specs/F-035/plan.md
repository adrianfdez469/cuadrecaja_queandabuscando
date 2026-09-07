---
feature: F-035
agente: orquestador
actualizado: 2026-09-07T02:08:06Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cuando cuadrecaja mande una tasa de cambio nueva, la vitrina de ese negocio va a
mostrar el importe convertido con la tasa nueva **en la primera visita
posterior**, en vez de seguir sirviendo el precio viejo hasta 58 minutos. Hoy el
comprador puede añadir al carrito lo que vio, pulsar «pedir» y llevarse un
`409 PRICE_CHANGED` que no sabe interpretar: ninguna de las dos cifras está mal,
solo están a distinta edad.

Lo que **no** cambia: nada de lo que el POS envía ni recibe —ni un campo del
`payload`, ni el `207` de la respuesta—, ni el contrato (la regla ya está
publicada en la v11 y este feature solo la cumple). El checkout sigue cotizando
igual que hoy, porque nunca leyó de caché. La página no se repinta al llegar el
evento: se marca como caducada y se rehace en la siguiente visita.

Lo que sigue sin poder hacerse: avisar al comprador que está mirando de que el
precio acaba de cambiar. Eso sería una pantalla, y no es este feature.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                                       | Archivos                                                                                      | Criterio que acerca | Cómo se verifica                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | El módulo de resolución: la consulta con raíz en `Storefront` y `stores: { where: { status: { not: "DRAFT" } } }`, delegando los canónicos en `expandBrandRevalidation()`; la fábrica del memo por lote (`Map` en clausura, promesa memoizada, entrada borrada si se rechaza); y el tipo que los handlers reciben | src/features/sync/server/businessBranches.ts (por crear)                                      | 2, 3, 5, 6          | `bash .agent/verify.sh F-035`                                                                        |
| 2   | Sus pruebas con `prisma` mockeado: los dos fixtures que cazan R4 y R6 —`el-trebol` (la `DRAFT` sin slug no debe llegar a `canonicalSlug()`) y `bodega-central` (el canónico es el de la marca, no `bodega-central-vedado`)—, más «un `findMany` por lote» y «cero marcas → `[]`»                                  | src/features/sync/server/businessBranches.test.ts (por crear)                                 | 2, 3, 5, 6          | `bash .agent/verify.sh F-035`                                                                        |
| 3   | Los dos handlers: `handleCurrency` gana `businessId` y la clausura, `handleExchangeRate` gana la clausura, y los dos cambian `return PROCESSED` por `outcomeOf(await lookup(businessId))` **después** de escribir y **después** del `return SKIPPED` de `CUP`. Cero importaciones de `src/lib/cache.ts`           | `src/features/sync/server/handlers/misc.ts`, `src/features/sync/server/handlers/misc.test.ts` | 1, 4, 5             | `bash .agent/verify.sh F-035`                                                                        |
| 4   | El cableado del lote: `processCatalogBatch` crea la clausura una vez antes del bucle y `applyEvent` la pasa a los dos `case`. La invalidación del final **no se toca**                                                                                                                                            | `src/features/sync/server/processBatch.ts`, `src/features/sync/server/processBatch.test.ts`   | 2, 6                | `bash .agent/verify.sh F-035`                                                                        |
| 5   | Los dos comentarios que dejan de ser ciertos: el de `touchedStoreSlugs` («Only `handleCategory` sets this today», I4) y el de `expandBrandRevalidation`, que gana un segundo llamador                                                                                                                             | `src/features/sync/server/handlers/types.ts`, `src/features/storefront/server/registry.ts`    | —                   | `bash .agent/verify.sh F-035`                                                                        |
| 6   | El criterio 5 contra Postgres: un negocio con **todas** sus sucursales en `DRAFT` acepta el evento, responde `processed` y dispara **cero** `revalidateTag`. La fixture (mockear `prisma` o sembrar) la decide quien lo escriba                                                                                   | .agent/specs/F-035/ lo que decida sdd-tester (por crear)                                      | 5                   | `npx vitest run` sobre el archivo nuevo, y `bash .agent/verify.sh F-035`                             |
| 7   | El smoke de lo que solo se ve por HTTP: calentar la caché, mandar la tasa, y una sola visita posterior; más el negocio de al lado que **sigue** sirviendo su valor viejo. Con **moneda sintética de tres letras**, nunca `USD`                                                                                    | .agent/specs/F-035/smoke.sh (por crear)                                                       | 1, 3, 7             | `bash .agent/verify.sh F-035 --smoke`                                                                |
| 8   | Cierre: `impl.md` con lo construido y lo desviado, `tests.md` con una casilla por criterio y su comando, y el sensor completo                                                                                                                                                                                     | `.agent/specs/F-035/impl.md`, `.agent/specs/F-035/tests.md`, `.agent/progress/F-035.md`       | 8, 9                | `bash .agent/verify.sh F-035 --full` sale 0, y `git diff --stat main -- docs/sync-contract.md` vacío |

El orden importa en dos sitios. El paso 1 antes del 3, porque los handlers
reciben el tipo que ese módulo define. Y el paso 7 al final, porque es el único
que necesita la app levantada y la base sembrada: si falla antes de que los
pasos 1-4 estén en verde, el fallo no es atribuible.

Los pasos 1-5 son de `sdd-implementer`; los 6, 7 y 8, de `sdd-tester`. Un
implementador a la vez.

## De dónde sale cada paso

| Paso | Lo justifica                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` AD1 (memo por lote, no `cache()`), AD2 (módulo nuevo del sync) y AD3 (raíz en `Storefront`) · `spec.md` R2, R4, R5, R6, R7              |
| 2    | `architecture.md` AD3 § «Lo único que queda equivocable, y qué lo caza» (la tabla de dos fixtures) · `spec.md` R4, R6, E9                                 |
| 3    | `spec.md` § Datos y contrato (la tabla de tres líneas), R1, R8, E8 · `architecture.md` § Componentes                                                      |
| 4    | `spec.md` § Alcance → Dentro, punto 2 · `architecture.md` AD1 (la clausura la crea `processCatalogBatch`) y § Archivos que toca cada cambio               |
| 5    | `spec.md` I4 · `architecture.md` § Componentes (las dos últimas filas)                                                                                    |
| 6    | `spec.md` C5 y § No decidido a propósito, punto 3 · ficha `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`                      |
| 7    | `spec.md` C1 (el guion de cinco pasos y la trampa de la moneda), C3 (el `UPDATE` por `psql` que no revalida) y C7 · `architecture.md` § Archivos que toca |
| 8    | `.agent/README.md` § Al completar un feature · `spec.md` C8, C9                                                                                           |

Ningún paso sale de mi cabeza: los ocho tienen su línea. Y hay tres cosas que
**no** son pasos justamente porque ningún documento las pide: arreglar el hueco
de I1, tocar `affectedStoreSlugs`, y añadir un tag por negocio.

## Qué queda fuera

- **Repintar la página al llegar el evento.** Invalidar es expirar la marca, no
  re-renderizar: la vitrina se rehace en la primera visita posterior. Es lo que
  la regla ① del contrato promete y lo que no promete.
- **Tocar el checkout.** `loadFreshRates` nunca leyó de caché, así que ya cotiza
  con la tasa nueva. El criterio 7 es una no-regresión, no una construcción.
- **El hueco de I1 en `affectedStoreSlugs`** (F-026): un `CATEGORY` con
  productos en una sucursal `DRAFT` sin slug, dentro de una marca de dos o más
  renderizables, puede volver en `failed[]`. F-035 se obliga a **no heredarlo**
  (el filtro va en el `where`), pero no lo arregla: es un criterio ya verificado
  de F-026 y la regla 4 reserva ese feature al humano. Es PP1.
- **La invariante de ADR 0018** (una sucursal no-`DRAFT` de marca
  multi-sucursal sin `Store.slug` hace lanzar a seis sitios del repo). F-035 la
  hereda como los otros cinco; **no** se la traga con un `catch`, porque eso
  dejaría la sucursal rancia para siempre y el evento reportado como bueno. Es
  PP2.
- **Un tag por negocio** (`business:<id>`) que reduciría la invalidación a uno
  por lote. Es un mecanismo nuevo, la spec lo excluye (R10) y habría que
  coordinar la redacción del contrato. Es PP3.
- **`revalidateStorefronts` y `revalidateProducts`.** El selector de marca no
  pinta importes y `productTag` no lo lee nadie hoy.
- **Mover `docs/sync-contract.md`.** La regla ① de la v11 ya está publicada y
  este feature la implementa tal cual.

## Riesgos y plan B

| Riesgo                                                                                                  | Cómo se notaría                                                                                   | Plan B                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El tercer parámetro en los dos handlers resulta demasiada maquinaria                                    | Al leer el diff                                                                                   | Recalcular por evento: se borran la fábrica y el parámetro y todo lo demás queda igual. Cuesta hasta 1000 sentencias en el peor caso, que la spec ya acepta     |
| El smoke del criterio 1 no distingue «se expiró el tag» de «se re-renderizó porque sí»                  | El paso 3 del guion (calentar la caché) pasa aunque el tag no exista                              | El criterio se sostiene además en los pasos 2 y 4, que cuentan `revalidateTag` con un número exacto. El smoke añade la prueba de extremo a extremo, no la única |
| El criterio 3 se verifica en `next dev`, donde la caché de datos no se comporta igual que en producción | El `GET` del negocio de al lado devuelve el valor nuevo sin que nada lo haya invalidado           | Se cae al aserto de unidad —el conjunto de `seed-negocio-1` no contiene `el-faro`— y se anota en `tests.md` por qué. No se sube ningún techo ni se reintenta    |
| Alguien mueve la tasa de `USD` en el smoke                                                              | `npm run seed` **no** la restaura y `Cerveza Cristal` (1.20 USD → 528 CUP) queda mal para siempre | Moneda sintética de tres letras propia de la corrida, como el `ZZZ` de F-027. Está escrito en el paso 7 y en la spec                                            |
| La invariante de ADR 0018 está rota en la base de desarrollo                                            | La resolución lanza y el `EXCHANGE_RATE` cae en `failed[]`                                        | Es PP2 y no se tapa. Con el seed de hoy no se alcanza: ningún escritor del repo escribe `DRAFT`                                                                 |

**Nada de esto toca lo prohibido:** no hay migración (cero cambios en
`prisma/schema.prisma`), no hay `prisma migrate reset` ni `db push`, no se mueve
el contrato, y no se pierde ningún dato. El feature no escribe nada nuevo: solo
**lee** para decidir qué caché caducar.

## Coste

Dos ciclos de agente: uno de `sdd-implementer` (pasos 1-5) y uno de
`sdd-tester` (6-8). Un archivo nuevo de producción y ~15 líneas repartidas en
cuatro archivos que ya existen; dos de esos cuatro cambios son solo comentarios.

De lo que ya funciona se toca el camino caliente del sync —`processBatch.ts` y
`src/features/sync/server/handlers/misc.ts`—, así que la red de seguridad son sus dos suites, que ya
existen y ya cubren la agregación por lote. Cero JavaScript de cliente, cero
tags nuevos, cero entradas de caché nuevas: `npm run check:bundle` no se mueve.

Dar marcha atrás a mitad es un `git revert` de un commit: borrar el módulo
nuevo y devolver los dos `return PROCESSED`. No queda estado que limpiar,
porque nada se escribe.

## Preguntas antes de aprobar

**PP1 — ¿qué hacemos con el hueco de I1 (`affectedStoreSlugs`, de F-026)?**
Un `CATEGORY` con productos en una sucursal `DRAFT` sin slug propio, dentro de
una marca de dos o más sucursales renderizables, hace lanzar a `canonicalSlug()`
y ese evento vuelve en `failed[]` con un mensaje que no habla de categorías —y
el POS reintenta un lote que nunca va a entrar. Con el seed de hoy no se
reproduce; en producción basta un almacén en borrador con inventario.
Opciones: **(a)** feature nuevo tuyo, con el criterio que la spec ya redactó, y
mientras tanto queda escrito; **(b)** arreglarlo de paso en F-035, una línea en
la misma función; **(c)** solo dejarlo escrito y no abrir nada.
**Recomiendo (a).** (b) haría que un feature de invalidación reabra el camino de
escritura de categorías y toque un criterio ya verificado de F-026, que es lo
que la regla 3 quiere evitar.

**PP2 — ¿abrimos algo para la invariante de ADR 0018?** Hoy nada impide en la
base que una sucursal no-`DRAFT` de una marca multi-sucursal se quede sin
`Store.slug`, y en ese estado seis sitios del repo lanzan. No bloquea: para
llegar ahí `handleStore` ya tiene que haber fallado antes.
Opciones: **(a)** nada, queda escrito en `architecture.md`; **(b)** feature tuyo
que añada el `CHECK` en migración o una consulta de inventario; **(c)** que
F-035 se lo trague con un `catch`.
**Recomiendo (b) cuando toque, y (a) mientras tanto.** (c) no: dejaría una
sucursal rancia para siempre **y** el evento reportado como bueno, que es peor
que un fallo visible.

**PP3 — ¿te vale «invalidar el negocio entero» sin techo?** Una sola tasa expira
tres tags por sucursal y deja sus catálogos fríos: con el seed son 24 tags; un
negocio de 300 sucursales serían 900 y una oleada de 300 renders en frío. Es lo
que la regla ① del contrato promete tal como está escrita.
Opciones: **(a)** así se queda, con el umbral (~200 sucursales renderizables)
documentado; **(b)** abrir un feature para un tag por negocio, que baja la
invalidación a uno por lote pero es un mecanismo nuevo y habría que coordinar la
redacción del contrato con cuadrecaja.
**Recomiendo (a)**, y reabrir con (b) el día que un negocio real pase de las
~200 sucursales o que alguien mida la oleada.

Las tres son de backlog o de umbral y **ninguna bloquea la implementación**: si
respondes «(a)/(b)/(a)» o simplemente apruebas el plan, los pasos 1-8 son los
mismos. Lo que cambia con tu respuesta es qué se abre después.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-035 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-07T02:08:06Z — aprobado por el humano: «Apruebo tal cual. I1: feature nuevo mio. ADR 0018: feature mio cuando toque, y mientras tanto queda escrito. Techo por negocio: asi se queda, con el umbral documentado.»
