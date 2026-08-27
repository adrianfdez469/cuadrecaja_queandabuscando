---
feature: F-015
agente: orquestador
actualizado: 2026-08-27T17:42:29Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Hoy esta base tiene los datos y el índice para contestar «quién vende café» y no
puede contestarlo: nadie escribe nunca la columna `searchVector` y no hay
ninguna consulta de búsqueda. F-015 cierra ese hueco **por debajo**: una función
de servidor que, dado un término escrito por una persona, devuelve productos
canónicos del marketplace, con acentos indiferentes, los exclusivos fuera y un
filtro opcional de existencia.

**No cambia nada de lo que hoy se ve.** Ni una pantalla, ni una ruta, ni un
kilobyte de JavaScript de cliente: la función queda escrita y probada, y **nadie
la llama todavía**. La pantalla que la use es otro feature. El contrato con
cuadrecaja tampoco se toca: `searchVector` es derivado y privado de este lado,
así que `docs/sync-contract.md` no cambia y el POS no se enterará.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                           | Archivos                                                                                                                                                                                      | Criterio que acerca | Cómo se verifica                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Las constantes, la limpieza pura del término y **la expresión única** de normalización (escritura y consulta en el mismo módulo)                                                                      | src/constants/marketplace.ts, src/lib/searchTerm.ts, src/features/marketplace/server/searchVector.ts (por crear) + prueba de unidad                                                           | C9, R2, R6, R7      | `bash .agent/verify.sh F-015` en 0, con pruebas de unidad sin base: término vacío, de una letra, con metacaracteres, de 10 000 caracteres                                 |
| 2   | **Quitar** `searchDocument` de los cuatro `create`/`update` tipados del sync y de los dos del seed, y sustituirlos por seis llamadas al escritor único, que escribe documento y vector en un `UPDATE` | `src/features/sync/server/handlers/product.ts`, `prisma/seed.ts`, `src/features/sync/server/handlers/product.test.ts`                                                                         | C1, R1, E1–E4       | Pruebas mockeadas: evento rancio → el escritor **no** se llama; create y alias nuevo → una llamada con el documento esperado. Y `npm run seed && npm run seed` en 0       |
| 3   | El relleno de las filas heredadas: la función por lotes, el ejecutable con `--check` y la migración de datos escrita a mano                                                                           | src/features/marketplace/server/searchVector.ts, scripts/backfill-search-vector.ts, prisma/migrations/&lt;timestamp&gt;_backfill_search_vector/migration.sql (por crear), `package.json`      | C5, C6, R13, E20    | `--check` imprime N > 0 en la base actual; sin bandera lo deja en 0; la segunda pasada actualiza 0 filas; `npx prisma validate` verde                                     |
| 4   | La consulta de búsqueda                                                                                                                                                                               | src/features/marketplace/server/search.ts (por crear)                                                                                                                                         | C2, C3, C7, C8      | Compila y pasa lint. **Es la etapa que menos verifica y por eso no va antes**: sin la 5 no hay nada que demuestre que la consulta hace lo que dice                        |
| 5   | Las pruebas contra Postgres real: tercer proyecto de vitest, fixtures con token único por ejecución, las dos suites, y el aviso de Postgres de `.agent/init.sh` convertido en fallo (PP1)             | `vitest.config.mts`, `.agent/init.sh`, vitest.setup.db.ts, src/features/marketplace/server/dbFixtures.ts, search.db.test.ts, src/features/sync/server/handlers/product.db.test.ts (por crear) | C2, C3, C4, C7, C8  | `npm test` con Postgres arriba: E5–E22, los cuatro casos del filtro, el orden y la paginación                                                                             |
| 6   | La guarda contra la degradación silenciosa (cinco asertos que leen el fuente)                                                                                                                         | src/features/marketplace/server/boundaries.test.ts (por crear)                                                                                                                                | C10                 | Se pone roja si mañana alguien escribe `searchDocument` sin su vector, copia la expresión a un segundo sitio, o escribe el predicado de forma que el índice GIN no se use |
| 7   | Cierre: la nota en la ADR 0011 y la ADR nueva                                                                                                                                                         | `docs/adr/0011-sin-postgis-por-ahora.md`, docs/adr/0019-sql-crudo-para-tsvector-y-pruebas-contra-postgres-real.md (por crear)                                                                 | C11                 | `bash .agent/verify.sh F-015 --full` en 0                                                                                                                                 |

Dos puntos del orden **no son negociables**: la etapa 1 va primera porque las
otras cinco importan de ella, y la 5 va después de la 3 porque las pruebas de
base real necesitan el relleno para no depender del estado previo de la base.

## De dónde sale cada paso

| Paso | Línea que lo justifica                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Decisión, corte 1 y § Contratos; `spec.md` R2, R6, R7 y E15–E18                                           |
| 2    | `architecture.md` § Decisión, corte 2 y § SQL W1; `spec.md` R1 y criterio 1 de `.agent/features.json`; ADR 0004 § Trampa      |
| 3    | `architecture.md` § Decisión, corte 4 y § SQL W2; `spec.md` C5, C6, R13, e I2/I3 (los huecos que el criterio 1 deja abiertos) |
| 4    | `architecture.md` § SQL Q1; `spec.md` § Datos y contrato, R4, R5, R8, R9, R10                                                 |
| 5    | `architecture.md` § Pruebas contra Postgres real; `spec.md` I6 y § No decidido a propósito                                    |
| 6    | `architecture.md` § La guarda de C10; `spec.md` C10                                                                           |
| 7    | `spec.md` I1; `architecture.md` § ¿Hace falta una ADR? y AP3                                                                  |

Ningún paso sale de mí. Si alguno no te cuadra, el documento que hay que corregir
está en esa tabla.

## Qué queda fuera

- **Cualquier pantalla y cualquier ruta HTTP.** Tú lo decidiste (SP-H1). Nada en
  `src/app/`, ningún componente, ningún `"use client"`, ninguna entrada de caché.
  La función se llama desde código de servidor y **nadie la llama todavía**.
- **La búsqueda dentro de una tienda.** Es F-021, que está bloqueado por F-011.
  F-015 no filtra por tienda, no hace difusa y no registra consultas vacías.
- **La cercanía geográfica.** Tú decidiste no reabrir la ADR 0011 (SP-H5): nada
  de PostGIS, `geography` ni GiST.
- **El precio.** Tú pediste el resultado mínimo (SP-H6): ni precio mínimo, ni
  moneda, ni conversión. Meterlo arrastraría `src/lib/pricing.ts` y las tasas de
  cambio dentro de la búsqueda.
- **La lista de tiendas por resultado.** Solo el conteo (SP-H6).
- **Ampliar qué se indexa.** Sigue siendo nombre + alias (ADR 0004). Ni la
  descripción del canónico, ni la categoría global, ni el nombre local de cada
  tienda.
- **Ponderar el nombre por encima de los alias** (`setweight`), sugerencias,
  autocompletado, corrección ortográfica y sinónimos.
- **Un criterio de «EXPLAIN no hace seq scan».** Con las decenas de filas de una
  base de desarrollo el planificador elige `Seq Scan` con toda la razón, y
  forzarlo con `enable_seqscan = off` sería teatro. Lo que sí se verifica es la
  **forma** del predicado, y de eso se encarga el paso 6.
- **`prisma/schema.prisma`.** No se toca: ni una columna, ni un índice. Todo lo
  que F-015 necesita está desde F-002.

## Riesgos y plan B

**Hay migración de datos, y es la única.** Sin cambio de schema: una carpeta
escrita a mano con un `UPDATE` que rellena `searchVector` desde
`searchDocument`. No borra nada, no cambia ninguna columna de sitio y en una base
vacía actualiza 0 filas. Consecuencia deliberada: **no se ejecuta
`prisma migrate dev` en este feature**, así que el índice GIN que ese comando se
lleva por delante (ficha ya escrita, visto en F-010) no se esquiva a mano — se
evita, porque no hay diff declarativo que hacer.

**Ninguno de los dos comandos prohibidos aparece.** Ni `prisma migrate reset` ni
`prisma db push`. Las pruebas de base real no truncan ni una tabla: se aíslan con
un token único por ejecución metido dentro del propio término de búsqueda.

**`docs/sync-contract.md` no cambia.** No hay nada que coordinar con el otro
equipo.

| Riesgo                                                                                                                      | Cómo se notaría                               | Plan B                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| En Supabase `unaccent` puede vivir en el esquema `extensions` y la expresión sin cualificar fallaría **solo en producción** | El ejecutable con `--check` contra producción | La expresión está en un sitio: cualificarla o fijar `search_path` es una línea                              |
| A ~10 000 candidatos para un término muy común, la subconsulta del conteo cuesta 50–150 ms                                  | Medición cuando haya llamador                 | Materializar `hasLiveOffer` en el canónico, mantenido por el sync. Hoy son 12 canónicos: no se construye ya |
| `OFFSET` profundo recalcula todo lo anterior                                                                                | Cuando exista paginación real                 | Keyset en vez de `OFFSET`                                                                                   |
| Las pruebas de base real acumulan conexiones                                                                                | El runner se cuelga                           | Techo declarado en 6 archivos; después `fileParallelism: false`                                             |
| Alguien corre `prisma migrate dev` por costumbre y se lleva el índice GIN                                                   | El índice desaparece del `migration.sql`      | La ficha ya está escrita y el paso 3 dice explícitamente que la carpeta se escribe a mano                   |

## Coste

**Dos ciclos de agente**: `sdd-implementer` (pasos 1–4 y 6) y `sdd-tester`
(paso 5 y el veredicto). El paso 7 lo hago yo al cerrar.

**Lo que se toca de lo que ya funciona, y es la parte que importa:**
`src/features/sync/server/handlers/product.ts` y `prisma/seed.ts`. A los cuatro
`create`/`update` del sync **se les quita** `searchDocument` y se sustituye por
una llamada al escritor único. Dicho con las palabras del arquitecto, porque un
lector rápido lo entendería mal: no es que se toque la mitad de los sitios, es
que después del paso 2 hay **exactamente un sitio en todo el repo** que escribe
esa columna, y escribe siempre las dos a la vez. La regla pasa de ser algo que
hay que recordar en seis sitios a una propiedad de construcción.

`vitest.config.mts` gana un tercer proyecto. `package.json`, un script.

**Marcha atrás a mitad:** todo lo nuevo son archivos nuevos y se borran. Los dos
archivos modificados vuelven con un `git checkout`. La migración de datos, si ya
se aplicó, **no hace falta deshacerla**: dejar `searchVector` poblado no rompe
nada de lo que existe hoy, porque hoy nadie lo lee. Es una marcha atrás barata.

## Preguntas antes de aprobar

**Las cuatro quedaron resueltas por el humano el 2026-08-27, antes de la firma.**
Cada una con la opción elegida y lo que implica para los pasos de arriba.

**PP1 · ¿El sensor pasa a exigir Postgres levantado?** (AP1 del arquitecto.)
→ **RESUELTA: (a) falla ruidosamente**, con el comando exacto en el mensaje. Se
descartaron el salto con aviso —`verify.sh` mira el código de salida, y un salto
sale **verde**: es el salto invisible que la spec prohíbe— y «solo en el CI», que
le quitaría al implementador la única forma de verificar C2, C3, C7, C8 y C9
antes de abrir el PR.

Consecuencias que el paso 5 incorpora, y que se aceptan con los ojos abiertos:

- El setup del proyecto `db` hace `throw` si `DATABASE_URL` falta, si `SELECT 1`
  no responde o si el esquema no está migrado. **Ni `it.skip`, ni bandera de
  opt-out.**
- **Cualquier sesión de este repo, incluso una que solo toque CSS, necesitará
  `docker compose up -d postgres`.**
- El aviso de `.agent/init.sh` sobre un Postgres inalcanzable **pasa a ser un
  fallo**, para que el entorno no diga `ENTORNO LISTO` cuando el sensor va a
  ponerse rojo. Es un archivo del arnés y entra en el paso 5 con permiso
  explícito de esta respuesta.

**PP2 · ¿La migración de datos se aplica también en la base compartida?** (AP2.)
→ **RESUELTA: (b) migración + ejecutable, y en local solo el ejecutable.** La
migración va al repo porque la ADR 0010 dejó `postinstall` sin `migrate deploy` y
sin ella el relleno de producción depende de que alguien se acuerde. No se aplica
en la base de desarrollo compartida entre los cuatro worktrees: adelantar
`_prisma_migrations` allí es el riesgo que la ficha
`.agent/playbook/prisma-migrate-dev-checksum-drift-bd-compartida.md` dice que se
escala, no que se resuelve en silencio. En local el ejecutable hace exactamente
lo mismo sin tocar la contabilidad de migraciones.

**PP3 · ¿Una ADR o dos?** (AP3.)
→ **RESUELTA: (a) una sola, la 0019**, con las cuatro decisiones: el SQL crudo se
compone solo con `Prisma.sql` y nunca con las variantes `Unsafe`; la expresión de
escritura y la de consulta se definen una vez y una prueba de frontera lo vigila;
lo que no se puede probar con Prisma mockeado se prueba contra Postgres real, en
un proyecto que **falla** en vez de saltarse; y el aislamiento es por token único
por ejecución, nunca por truncado. La escribo yo en el paso 7, junto con la nota
de I1 en la ADR 0011.

**PP4 · Las dos decisiones que tomó `sdd-spec` y no el humano.**
→ **RESUELTA: se dejan las dos como están.**

- **`storeCount` cuenta ofertas vivas, no totales** (R10). El número significa lo
  mismo con el filtro encendido y apagado, y el desempate del orden es exactamente
  `storeCount > 0`. Precio aceptado: un canónico sin ofertas vivas sale con
  `storeCount: 0`, y la futura pantalla tendrá que pintarlo como «sin
  disponibilidad ahora».
- **Término vacío devuelve vacío, no el catálogo entero** (R6).

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-015 '<lo que dijo el humano>'`. -->

- 2026-08-27T17:42:29Z — aprobado por el humano: «aprobado, dale»
