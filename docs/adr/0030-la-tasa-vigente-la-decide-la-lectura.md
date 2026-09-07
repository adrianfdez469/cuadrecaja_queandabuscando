# 0030 — La tasa vigente de un par (negocio, moneda) la decide la lectura, no la última escritura

**Aceptada** · 2026-09-07 · F-036

El **porqué** de la regla no se repite aquí: está argumentado y firmado en
[`.agent/solicitudes.md`](../../.agent/solicitudes.md) § «S-004, S-005 y S-006 ·
Las tres reglas que cambió la v11» —S-005, «la guarda, sí; el rechazo, no»— y
publicado como regla ② de [`docs/sync-contract.md`](../sync-contract.md)
§ «Cambios respecto a la v10.1». Esta ADR existe porque **ninguno de esos dos
documentos es donde alguien mira**: el primero es un registro de negociación
con el equipo de cuadrecaja, el segundo es el contrato del cable, y la pregunta
que esta decisión deja para siempre es de esquema.

## Contexto

`ExchangeRate` es append-only, igual que en cuadrecaja: nunca se actualiza una
fila y no hay forma de borrar una desde `src/`. Hasta F-036, «la tasa vigente»
no estaba definida en ninguna parte: era una consecuencia de cómo leían los dos
únicos lectores —`loadRates` de la vitrina y `loadFreshRates` del checkout—, que
pedían `orderBy: { createdAt: "desc" }` y se quedaban con la primera fila de cada
moneda. Es decir, vigente = **la última que llegó**.

Eso convierte el orden de entrega en parte de la semántica, y el orden de entrega
no está garantizado: el outbox del POS no tiene backoff y corta a los 6 intentos
(su ADR 0011). Si el evento de 440 falla, entra el de 480 y luego el de 440 se
reintenta y pasa, la tienda vuelve a cotizar a 440 **sin error, sin alerta y sin
que ninguno de los dos lados lo detecte**. Y el checkout no se salvaba por leer
fresco: leía lo mismo, con el mismo criterio, así que tampoco saltaba el
`409 PRICE_CHANGED`. La tasa no estaba caducada: estaba **resucitada**.

La tabla tiene tres propiedades que descartan los arreglos habituales. No admite
un `@@unique([businessId, currencyCode])`, porque el histórico es el producto.
No admite una bandera `isCurrent` mantenida al escribir, porque eso añade un
escritor que puede quedarse a medias y rompe el append-only. Y no admite
rechazar el evento rancio con un estado nuevo, porque para el POS «no aplicado»
significa reintentar, y el evento **sí** insertó su fila: gastaría intentos de su
outbox en algo que no es un fallo.

## Decisión

**Cuatro puntos.**

1. **La verdad la fija el criterio de lectura, no la escritura.** Toda fila se
   inserta, siempre, incluida la rancia, y el handler responde `processed` como
   cualquier otra. Vigente es la fila de `sourceUpdatedAt` mayor del par
   `(businessId, currencyCode)`, con desempate `createdAt DESC` («la última que
   llegó») y `id DESC` como último recurso para que el resultado sea
   **determinista** y por tanto igual en cualquier lector. `sourceUpdatedAt` es
   `payload.updatedAt` sin transformar.

   **La columna es `DateTime?` — nullable y sin `@default`, no `NOT NULL` con
   relleno.** Decisión del humano al firmar el plan (`.agent/specs/F-036/plan.md`
   § PD1), y va contra lo que argumentaban `spec.md` y una versión anterior de
   este documento: Prisma no puede generar un `UPDATE` de relleno a partir de
   un cambio de esquema, y su propio rodeo para ese caso —`--create-only` y
   editar el archivo generado— es exactamente lo que el humano pidió no hacer
   («las migraciones las genera Prisma, no se editan»). En su lugar, el
   **único** `ORDER BY` que lee esta columna (`buildCurrentRatesSql`, punto 2
   más abajo) pone `NULLS LAST` en su primera clave: una fila sin marca ordena
   al final y nunca gana, migrada o no. Eso sustituye al relleno como lo que
   cumple el criterio 5 — la objeción que la spec le hacía a esta variante
   («deja la trampa viva para la siguiente consulta que alguien escriba») deja
   de aplicar porque hay **un solo sitio** que ordena por esta columna, no
   varios: ver el punto 2.

2. **Los dos lectores comparten una función y una sentencia.** No dos consultas
   con el mismo criterio: **una**, en el módulo
   `src/features/catalog/server/rates.ts`, ejecutada por la vitrina (cacheada,
   con `storeTag`) y por el checkout (fresca). Es la parte estructural de la
   decisión: si «el criterio es idéntico en los dos lectores» fuera una regla que
   mantener, el día que divergiera nadie se enteraría —los dos lados estarían de
   acuerdo en el importe equivocado, que es exactamente el fallo de partida—.
   Siendo una sola sentencia, no hay dos sitios donde divergir, y es lo que hace
   sostenible que la columna sea nullable en vez de `NOT NULL`.

3. **Esa sentencia es `DISTINCT ON (currencyCode)`, en SQL crudo.** Prisma no
   expresa `DISTINCT ON` —su `distinct` filtra en memoria después de traer las
   filas—, así que se compone con `Prisma.sql` y se ejecuta con `$queryRaw`,
   bajo las mismas reglas que fijó [ADR 0019](0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md):
   nunca `$queryRawUnsafe`, todos los valores ligados, y el módulo en
   `features/*/server/`. El motivo es de escala y no de estética: la variante que
   trae todas las filas del negocio y se queda con la primera de cada moneda
   crece **sin techo**, porque la tabla no borra nunca. El constructor de la
   sentencia se exporta para que el `EXPLAIN` de la prueba explique **la
   sentencia real** y no una copia que se despegue del código.

4. **La tabla lleva un índice cubridor, porque la verdad se decide leyendo.**
   `(businessId, currencyCode, sourceUpdatedAt DESC, createdAt DESC, id DESC, rate)`,
   con nombre explícito `ExchangeRate_current_rate_idx`. Las cinco primeras
   columnas son el criterio de orden; `rate` es de cola para que la consulta no
   necesite el heap. Medido: sin esa sexta columna Postgres **no elige** el índice
   —las filas de un negocio están dispersas por el heap por construcción, así que
   el `Index Scan` ordenado sale más caro que escanear y ordenar— y el plan
   vuelve a `Bitmap Heap Scan` + `Sort`. El índice anterior,
   `(businessId, currencyCode, createdAt)`, se retira: no sirve a ningún lector.

## Consecuencias

**Lo que se gana.** El orden de entrega deja de importar para las tasas, que es
la promesa que `AGENTS.md` § Cosas que muerden ya hacía para todo lo que el sync
escribe. El histórico queda intacto: cero filas borradas, cero huecos. El POS no
cambia una línea —`updatedAt` ya viajaba y ya se validaba; lo único que cambia es
que deja de tirarse— y no gasta ninguno de sus 6 intentos.

**Lo que se acepta a cambio.** Se confía en el reloj del origen: una tasa con
`updatedAt` en el futuro gana, y sigue ganando hasta que llegue una marca mayor.
Es la misma consecuencia que ya tienen las otras tres entidades con guarda, y
recortar la marca a `now()` sería un cambio de contrato.

**La columna nullable no es solo una forma de generar la migración: también
degrada con gracia.** Un `INSERT` que se olvide de `sourceUpdatedAt` —el propio
seed de un checkout que aún no tenga este código, por ejemplo— deja la fila con
`NULL`, y `NULLS LAST` la manda al final: no gana nunca, pero tampoco falla la
escritura. Es el mismo argumento de R7 en `spec.md`, con el signo cambiado: la
opción `NOT NULL` habría convertido ese olvido en un error ruidoso en el
momento de escribir; la nullable lo convierte en una fila que simplemente
pierde, en silencio, en el momento de leer. Se acepta porque el único sitio que
puede olvidar la marca hoy es el propio repo (R15), y ahí el seed la pone
explícita.

**La forma de la guarda no es la misma que la de las otras tres, y esto es lo que
alguien va a copiar mal.** En `STORE`, `CATEGORY` y `PRODUCT` la guarda
**rechaza** la escritura y devuelve `STALE`. Aquí se **escribe siempre** y se
decide al leer, porque la tabla es append-only y el histórico es el producto.
Quien añada un handler copiando esta forma esperando un `STALE` se equivocará.

**`CURRENCY` sigue siendo la excepción, a propósito.** Su tabla es global a la
plataforma y su tercera asimetría —gana el último que llegue— sigue publicada en
el contrato (§ `payload` de `CURRENCY` ③). No se toca aquí.

**Lo que queda abierto.** El desempate por `id` hace el resultado determinista,
no «el último de verdad»: dos inserciones en el mismo milisegundo empatan también
en `createdAt`, que es `TIMESTAMP(3)`. El caso no se ha observado nunca en datos
reales —las inserciones de un lote van a 400-700 ms una de otra— y la letra
exacta necesitaría una columna monótona. Está escrito como `SP2` en
`.agent/specs/F-036/spec.md` § Huecos y preguntas al humano.
