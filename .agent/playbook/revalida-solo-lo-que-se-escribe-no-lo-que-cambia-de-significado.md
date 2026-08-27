---
slug: revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado
sintoma: "una URL sirve una resolución cacheada que ya no es cierta — un selector que ya se encogió a una sola sucursal, un Badge de estado desactualizado en una hermana, el nombre viejo de una sucursal tras un evento de sync rutinario — y ningún test ni el sensor lo detecta"
firma: —
etapa: review
visto_en: F-017 (la tercera instancia vive en el camino del sync, código que corre en producción con cada lote real de Cuadre de Caja — no en una acción rara del panel)
creado: 2026-08-27T06:10:00Z
promovido_a_agents: no
arreglo: no vuelvas a escribir el `.map()`/`.filter()` que arma la lista de slugs a mano — llama a `features/storefront/server/registry.ts::expandBrandTouch(brandSlug, members)`, la única función que hace esa expansión, y pasa su resultado a `revalidateSlugs`/`revalidateStores`. La garantía real ya no es un test que reconozca la sintaxis del bug: `expandBrandTouch()` devuelve `SlugTouchSet`, un tipo nominal (`unique symbol`, el mismo truco que `PublicSlug`) que solo esa función puede producir. `RegroupResult.revalidate.slugValues` y `HandlerOutcome.touchedSlugValues` (`features/sync/server/handlers/types.ts`) exigen ese tipo, así que un array armado a mano en cualquiera de sus formas — `.map()`, desestructurando, con llaves, encadenado, `for`, `.reduce`, `.flatMap`, una función nombrada — no compila en esos dos sitios. `boundaries.test.ts` sigue ahí como segunda línea, parcial a propósito (ver su comentario y `tests.md` § 4 de F-017 para la tabla de qué sí y qué no caza), y sigue siendo la única defensa para `setStoreEnabled()` (`features/admin/server/mutations.ts`), que llama a `revalidateSlugs(expandBrandTouch(...))` en la misma línea, sin un campo tipado de por medio que se pueda marcar.
---

## Qué pasa de verdad

`revalidateTag` solo invalida lo que se le pide explícitamente. Cuando una
escritura cambia el significado de una URL que **no** tiene fila propia en lo
que se escribió (el slug de una marca que se vacía a una sola sucursal, la
lista de hermanas de una marca que gana un miembro, el Badge de una hermana
cuyo estado cambió), es muy fácil listar solo los slugs de las filas que el
código acaba de tocar con `prisma.*.update`/`create` y olvidar los que
cambiaron de significado **sin que nadie escribiera su fila**.

El síntoma no lo pesca ningún test que solo compruebe "¿se llamó a
`revalidateStores`?" — hay que afirmar **qué slugs concretos** están en el
array. Tampoco lo pesca el sensor: `verify.sh --full`/`--smoke`/`--visual`
pueden salir en 0 mientras la URL rancia sigue ahí, porque el criterio que se
prueba (una sola llamada de agrupar, sin repetirla) nunca ejercita la segunda
llamada que revela el hueco.

En F-017 pasó **tres veces en el mismo ciclo**, en tres sitios que no se
conocían entre sí:

1. `regroupStoreIntoBrand()` no revalidaba el slug de la marca que se vacía a
   una sola sucursal, ni las hermanas preexistentes de la marca primaria.
2. `setStoreEnabled()` (código de F-011, ya en `main`) no revalidaba el slug
   de la marca ni el de las hermanas al cambiar el estado de una sucursal
   dentro de una marca multi-sucursal.
3. **La instancia que importa más**: un evento `STORE` **de rutina** del
   sync (alguien cambia el nombre o la ciudad de una sucursal existente) en
   una marca multi-sucursal no revalidaba ni el selector de la marca ni
   ninguna hermana — solo el canónico de la propia sucursal
   (`src/features/sync/server/handlers/store.ts`, la rama de actualización;
   `src/features/sync/server/processBatch.ts`, que solo pasaba a
   `revalidateSlugs` los canónicos que el propio lote había tocado). A
   diferencia de las dos primeras, esta vive en el camino **caliente** que
   corre con cada lote real del POS, no en una acción de panel poco
   frecuente — por eso, aunque las tres tienen la misma forma, esta es la de
   severidad ALTA.

## Por qué tres sitios que no se conocen fallando igual no es "tres bugs"

Si tres escritores sin relación entre sí caen en el mismo hueco, el hueco no
está en ninguno de los tres: está en que **cada escritor decidía por su
cuenta qué revalidar**, y acertaba solo mientras pensaba en lo que él mismo
tocó. Parchear el tercer sitio a mano habría dejado el mismo hueco esperando
a un cuarto escritor. El arreglo real no son tres parches — es un **embudo**:
una sola función, en el mismo módulo que ya posee la maquinaria del slug
canónico (`src/features/storefront/server/`), que toma "la marca y su lista
de miembros" y devuelve "todo lo que hay que revalidar", y que TODOS los
escritores llaman en vez de construir el array ellos mismos.

`expandBrandTouch(brandSlug, members)` (en `registry.ts`) es esa función: da
el slug de la marca más el slug propio de cada miembro — sin excepciones, sin
que cada llamador decida cuáles hermanas "sí importan". Los tres escritores
(`regroupStoreIntoBrand`, `setStoreEnabled`, la rama de actualización de
`handleStore`) la llaman; ninguno vuelve a hacer su propio
`.map()`/`.filter()`.

**Un ciclo de endurecimiento posterior** convirtió esto de "detectado" a
"imposible" en dos de los tres sitios (§ siguiente). El tercero
(`setStoreEnabled`) sigue dependiendo de un test de frontera, y ese test —
medido por `sdd-tester` con nueve variantes sintácticas equivalentes— solo
caza dos.

## La garantía real: un tipo, no un test que reconozca sintaxis

Un test de frontera en `features/storefront/server/boundaries.test.ts`
greppea el código fuera de `registry.ts` buscando la forma exacta del bug
(`.map((x) => x.slug)` sobre una colección de sucursales/miembros) y falla
si alguien la reintroduce — verificado deliberadamente: se reintrodujo el
patrón viejo a mano, el test lo cazó, se revirtió. **Pero un `grep`, sea
regex o AST, siempre es parcial**: `sdd-tester` probó nueve formas
semánticamente equivalentes de escribir la misma proyección
(desestructurando, con cuerpo de llaves, encadenando algo tras `.slug`, un
`for`, un `.reduce()`, un `.flatMap()`, una función nombrada aparte) y solo
las dos más cercanas a la forma literal caen en la red. Las otras siete
pasan el test sin que nadie se entere.

Por eso `expandBrandTouch()` no devuelve `string[]`: devuelve
`SlugTouchSet`, un tipo nominal (`unique symbol`, el mismo truco que ya usa
`PublicSlug` en `lib/publicSlug.ts` para que un slug de URL sin resolver no
compile donde se espera uno canónico). Nada que no haya pasado por
`expandBrandTouch()` puede tener ese tipo, sin que importe CÓMO se escribió
el intento de sustituirlo — eso es justo lo que un test de forma no puede
prometer. `RegroupResult.revalidate.slugValues` (en `registry.ts`, el
resultado de `regroupStoreIntoBrand`) y `HandlerOutcome.touchedSlugValues`
(`features/sync/server/handlers/types.ts`, lo que `handleStore` reporta)
exigen `SlugTouchSet`: un array armado a mano en cualquiera de las nueve
formas de la tabla de `sdd-tester` es, en esos dos sitios, un **error de
compilación**, no una alarma que depende de que el patrón coincida.

Queda un hueco, y se deja escrito en vez de fingir que no existe:
`setStoreEnabled()` (`features/admin/server/mutations.ts`) llama a
`revalidateSlugs(expandBrandTouch(...))` en la misma línea, sin guardar el
resultado en un campo tipado — no hay dónde poner el sello. Ensanchar la
firma de `revalidateSlugs()` para exigir `SlugTouchSet` ahí rompería todos
sus otros llamadores legítimos (un slug canónico suelto, el conjunto
mezclado de un lote de sync), que no tienen nada que ver con una marca. Ese
único sitio sigue protegido solo por el test de frontera — parcial, y
sabido.

## Cómo se arregla

Antes de escribir el array que se pasa a `revalidateStores`/`revalidateSlugs`/
`revalidateStorefronts`, responde por escrito: "¿qué otras URL, aparte de la
que esta función actualiza, pueden estar sirviendo una página distinta a la
de hace un segundo?" Para cualquier operación que toque una marca con más de
una sucursal, eso normalmente incluye: el slug de la marca misma (aunque su
fila no cambie), y el slug propio de cada hermana (aunque tampoco cambie su
fila) — su **contenido cacheado** (la lista de sucursales, el Badge de
estado) sí cambió. Después, no lo escribas a mano: llama a
`expandBrandTouch()` con la marca y la lista de miembros que ya tengas en
memoria (nunca hace falta una consulta nueva — todo escritor de este tipo ya
selecciona `storefront.stores` para calcular su propio `brandBranchCount`;
lo único que cambia es pedirle `slug` a esa selección además de `id`).

La prueba que lo pesca: no una que compruebe que la función `revalidateX` se
llamó, sino una que afirme **la lista exacta de slugs** que se le pasó, en un
escenario con al menos dos marcas y tres sucursales — el caso de una sola
sucursal o de una sola llamada no lo ejercita nunca. Y, para el camino del
sync en concreto, una prueba a nivel de `processCatalogBatch()` que
confirme que el conjunto de un handler se **funde** en la misma llamada
batcheada, no en una llamada nueva por evento (el lote de 500 eventos sigue
siendo una sola invalidación deduplicada por familia de tag — cero consultas
nuevas, la expansión es aritmética sobre datos ya cargados).

## Cuándo NO es esto

Una escritura que solo cambia el contenido de UNA sucursal (un producto, una
promoción, el nombre de una tienda de una sola sucursal) no tiene este
problema: revalidar su propio canónico basta, porque nada más depende de esa
fila.

## Cómo se evita

Cualquier función nueva que toque el `storefrontId` de una tienda, o el
`status`/contenido visible de una tienda que pertenece a una marca
multi-sucursal, tiene que preguntarse por las hermanas y por la marca misma
— no solo por la fila que escribió, y hacerlo llamando a
`expandBrandTouch()`, nunca reconstruyendo la proyección a mano. Es la misma
disciplina que ya exige R19 (`revalidateStorefronts` en cada escritor de
branding, "desde el día uno aunque nadie lo lea todavía"): revalidar de más
es barato; revalidar de menos deja una URL rancia para siempre. Y ahora,
además, hay un sensor que lo comprueba por ti: si tu escritor nuevo hand-rolla
la lista otra vez, `boundaries.test.ts` te lo dice antes que un probador con
suerte.
