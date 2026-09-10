---
slug: catalogo-de-zonas-sin-sembrar-en-pruebas-de-base
sintoma: "un *.db.test.ts de zonas falla con: Foreign key constraint violated on the constraint: `Store_zoneCode_fkey`, o un zoneCode que se acaba de escribir se lee null"
firma: Foreign key constraint violated on the constraint..(Store_zoneCode_fkey|ZoneTariff_zoneCode_fkey)
etapa: test
visto_en: F-044
creado: 2026-09-10T13:03:21Z
promovido_a_agents: no
arreglo: siembra el catálogo con `seedZoneCatalog(prisma)` — ya está en el `beforeAll` de `vitest.setup.db.ts`; si el fallo persiste, la base contra la que corres no está migrada
---

## Qué pasa de verdad

La tabla `Zone` está **vacía**, y `ZoneTariff.zoneCode` y `Store.zoneCode`
tienen clave ajena contra ella. El mensaje habla de la clave ajena, no del
catálogo, así que se lee como un fallo del dato que la prueba acaba de
escribir cuando lo que falta es el dato de referencia de debajo.

Se ve **solo en una base recién migrada**, y por eso es tan fácil de no ver:
en la base local de cualquiera que haya corrido `npm run seed` alguna vez el
catálogo lleva tiempo sembrado y las pruebas pasan. El CI no tiene esa
suerte —`.github/workflows/ci.yml` corre `npm run seed` **después** de
`npm test`, en la etapa «Seed is idempotent»—, así que las pruebas de base
del CI ven `Zone` con cero filas. Ese desfase es lo que hizo que cinco
archivos y 45 pruebas de F-041, F-042 y F-044 estuvieran rojas en el primer
CI de la rama mientras `bash .agent/verify.sh --full` salía 0 en local.

## Cómo se arregla

Ya está arreglado en la raíz: `vitest.setup.db.ts` llama a `seedZoneCatalog(prisma)`
en su `beforeAll`, después de `sweepStaleFixtures()`. Es idempotente y cuesta
un `INSERT … ON CONFLICT DO UPDATE` de 184 filas en un solo round trip, el
mismo que ya hace `prisma/seed.ts` en su primera línea.

Si vuelve a aparecer, la causa es otra: comprueba que la base contra la que
corres está migrada (`npm run db:deploy`) y que el artefacto
`src/features/zones/zone-index.json` no está vacío ni recortado.

## Cuándo NO es esto

Si el `zoneCode` del fallo **no está en el catálogo** —los códigos de primer
nivel publicados son `21`…`35` y `40`, nunca `01`…`20`—, el problema es el
código, no la siembra: el catálogo está bien y la prueba está pidiendo una
zona que no existe. Compruébalo con
`node -e "console.log(require('./src/features/zones/zone-index.json').zones.some(z=>z.code==='<código>'))"`.
Sembrar zonas sintéticas para que pase **no** es la salida: rompe el
`toBe(184)` de `src/features/zones/server/catalogSeed.db.test.ts` y la
[ADR 0032](../../docs/adr/0032-catalogo-de-zonas-bytes-commiteados-y-la-base-como-espejo.md).

## Cómo se evita

Un dato de referencia con clave ajena encima se siembra en el **setup del
proyecto de pruebas**, no se da por sembrado porque la base de desarrollo lo
tenga. La regla general, que aplica a cualquier catálogo que venga después:
si una prueba de base necesita una fila que ningún `describe` crea, esa fila
es del setup.

Y la mitad que cuesta más cara: **`verify.sh --full` en verde no es el CI en
verde** cuando el estado de la base entra en juego. El sensor corre contra
una base viva y de meses; el CI, contra una recién migrada. Una rama que
nunca ha pasado por CI puede llevar features enteros con las pruebas de base
rojas sin que nadie se entere — que es exactamente lo que pasó aquí, con
F-041, F-042 y F-044 acumuladas en la misma rama.
