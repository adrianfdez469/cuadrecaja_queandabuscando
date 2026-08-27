# 0019 — SQL crudo para `tsvector`, y pruebas contra Postgres real

**Aceptada** · 27 de agosto de 2026 · F-015

## Contexto

`CanonicalProduct.searchVector` es una columna `tsvector`, y Prisma no modela ese
tipo: en el schema es `Unsupported("tsvector")`, así que **no aparece en el tipo
del modelo y la API tipada no puede leerla ni escribirla**. Tampoco vale
convertirla en columna generada de Postgres: `to_tsvector('spanish', unaccent(…))`
no es inmutable, porque `unaccent` resuelve su diccionario en tiempo de ejecución.
Un índice de expresión sobre esa misma expresión falla por lo mismo.

De ahí salen dos estrenos que este repo no tenía: el primer SQL crudo y las
primeras pruebas que tocan una base de datos de verdad. Son la misma historia
contada por los dos lados —hay una columna que Prisma no ve—, y por eso van en
una sola ADR y no en dos.

## Decisión (a) — el SQL crudo se compone solo con `Prisma.sql`

Nunca `$queryRawUnsafe` ni `$executeRawUnsafe`, y nunca interpolación de texto
escrito por una persona. Todos los valores viajan ligados, incluidos los dos
valores de enum, que se importan del cliente generado y van con su cast
(`$3::"Availability"`): así un renombrado del enum rompe la compilación en vez de
la búsqueda.

El SQL crudo **no es una excepción a la tabla de capas** de `AGENTS.md`: vive en
`src/features/*/server/`, igual que cualquier otra cosa que toque Prisma. En
`src/lib/` solo queda lo verdaderamente puro —recortar, truncar y acotar el
término—, sin una línea de SQL. Componer `Prisma.sql` exige importar el cliente
generado, y la propia guarda del panel cuenta ese import como «tocar Prisma».

## Decisión (b) — la expresión de escritura y la de consulta se definen una vez

`to_tsvector(…, unaccent(documento))` y `plainto_tsquery(…, unaccent(término))`
son gemelas: si solo se normaliza un lado, buscar `cafe` deja de encontrar `Café`
—o al revés— y **nada se pone rojo**. Viven en un solo módulo, y una prueba de
frontera afirma que en todo `src/` hay exactamente un archivo que contiene
`to_tsvector(`.

La misma prueba vigila la forma del predicado: la consulta va **contra la
columna** (`"searchVector" @@ …`), nunca contra `to_tsvector(...) @@ …`, que es
equivalente en resultado y deja el índice GIN sin usar. Un error que no cambia
ninguna respuesta y solo se nota cuando la tabla crece.

Y una consecuencia estructural que importa más que las dos anteriores: para
escribir el vector hubo que **quitar** `searchDocument` de los cuatro `create`
tipados del sync y de las dos escrituras del seed. Después de F-015 hay
exactamente **un** sitio en el repo que escribe esa columna, y escribe siempre
las dos a la vez. La trampa que [ADR 0004](0004-identidad-canonica-en-el-sync.md)
§ Trampa describe —olvidar recalcular el documento degrada la búsqueda en
silencio— pasa de ser disciplina que hay que recordar en seis sitios a una
propiedad de construcción.

## Decisión (c) — lo que no se puede probar con Prisma mockeado se prueba contra Postgres real

La semántica de `tsvector`, de `unaccent` y del orden por `ts_rank` no existe en
TypeScript: un mock puede afirmar que se llamó a la sentencia correcta, nunca que
Postgres devuelve lo que uno cree. Esas pruebas viven en un proyecto propio de
vitest, `db`, con sus archivos en `*.db.test.ts`.

**Fallan, no se saltan.** Si falta `DATABASE_URL`, si `SELECT 1` no responde o si
el esquema no está migrado, el setup lanza con el comando exacto en el mensaje.
Ni `it.skip`, ni bandera de opt-out. El motivo es que `verify.sh` mira el código
de salida, y **un salto sale verde**: una prueba que se salta sin decirlo no
verifica nada, y es peor que no tenerla, porque además tranquiliza.

El precio se acepta con los ojos abiertos y lo decidió el humano: cualquier
sesión de este repo, incluso una que solo toque CSS, necesita
`docker compose up -d postgres`. Por eso `.agent/init.sh` también pasó de avisar
a fallar cuando Postgres no responde — el entorno no puede decir `ENTORNO LISTO`
justo antes de que el sensor se ponga rojo.

## Decisión (d) — el aislamiento es por token único por ejecución, nunca por truncado

La base de desarrollo está **compartida entre worktrees y sembrada**, y
`prisma migrate reset` está prohibido por `AGENTS.md`. Truncar tablas tampoco es
una opción: borraría el trabajo de otra sesión.

Cada ejecución genera un token y lo mete en los nombres de sus propios datos. Lo
que hace exacto el aislamiento es que **el token viaja dentro del propio término
de búsqueda**: `plainto_tsquery` combina los términos con Y, así que una búsqueda
por `cafe <token>` solo puede casar con las filas de esa ejecución. Eso hace
fiables incluso las aserciones de orden y de paginación sobre una base llena de
datos ajenos. Los EAN se derivan del token, porque `CanonicalProduct.ean` es
único y los del seed no se pueden reutilizar.

## Consecuencias

- Cualquier sesión necesita Postgres levantado. Es la más cara y es deliberada.
- Cada archivo de prueba de base real es un worker con su propio cliente: el
  techo práctico son ~6 archivos antes de tener que limitar el paralelismo.
- El schema declarativo no cambió, así que F-015 no ejecutó `prisma migrate dev`
  y el índice GIN que ese comando se lleva por delante no hubo que esquivarlo.
- Una prueba nueva que necesite base va en `*.db.test.ts`, no en `*.test.ts`.

## Reabrir cuando

Prisma modele `tsvector` de forma nativa —entonces (a) y (b) se pueden revisar,
aunque la unicidad de la expresión seguiría valiendo la pena—, o cuando las
pruebas contra base real se vuelvan tan lentas que alguien quiera saltárselas: si
ese día llega, la respuesta es hacerlas más rápidas o menos, **no** volverlas
silenciosas.
