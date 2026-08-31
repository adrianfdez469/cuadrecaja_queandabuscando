---
feature: F-025
agente: orquestador
actualizado: 2026-08-31T14:20:32Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Quien entra a una tienda —normalmente escaneando un QR, con el historial del
navegador vacío— va a ver en todo momento **dónde está** y va a poder **volver**,
sin depender del botón «atrás» del teléfono, que hoy lo saca del sitio. En las
diez pantallas públicas aparece una fila de navegación del tipo
`Marca › Sucursal › Bebidas › Jugo de mango`, con cada eslabón enlazado a su
sitio y el último marcado como la página actual. El «atrás» no es un control
aparte: es el penúltimo eslabón de esa misma fila, así que rastro y vuelta no se
pueden contradecir nunca.

No cambia ningún dato, ningún precio, ninguna disponibilidad y ninguna consulta a
la base. No cambia el contrato con cuadrecaja. No aparece nada nuevo en el panel
de administración. Y no se añade **ni un byte** de JavaScript de cliente: la fila
es HTML servido, así que funciona antes de que el navegador ejecute nada.

## Pasos

Los seis primeros son de `sdd-implementer`, en este orden y de uno en uno. El
séptimo es de `sdd-tester`.

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                                                                 | Archivos                                                                                                                                                                                   | Criterio que acerca      | Cómo se verifica                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **El motor del rastro**, sin nada de React: los tipos `Crumb`/`Trail`/`TrailStore`, la espina de R4, el constructor `storeTrail()`, `backTarget()`, los ocho envoltorios por pantalla y `TRAIL_LABEL`. Construir la lista **por delante** (`[first, ...rest]`), que es lo único que compila contra el tipo tupla.                           | src/features/storefront/trail.ts (por crear) · src/features/storefront/trail.test.ts (por crear)                                                                                           | 1, 5, 6, 12, 15, 16, 17  | `npx vitest run src/features/storefront/trail.test.ts` en verde, con una prueba por cada fila de la tabla de pantallas, más R4, R5, R19 y `backTarget` de un solo eslabón. `verify.sh`                                                                   |
| 2   | **El serializador de JSON-LD**, aparte porque es agnóstico del dominio y porque su único riesgo —cerrar el `<script>` desde dentro del dato— se prueba solo.                                                                                                                                                                                | src/lib/jsonLd.ts (por crear) · src/lib/jsonLd.test.ts (por crear)                                                                                                                         | 10, 18                   | `npx vitest run src/lib/jsonLd.test.ts`, con el caso `</script>` y el caso `<!--` dentro del nombre de un producto. `verify.sh`                                                                                                                          |
| 3   | **El componente de servidor** que pinta la fila: `<nav aria-label="Ruta">` con `<ol>`, separador `›` en `<span aria-hidden="true">`, el actual en `<span aria-current="page">` (nunca un `<a>` sin href), `min-h-11` por eslabón y el reparto por prioridad de la Decisión 2 del diseño.                                                    | src/components/store/StoreTrail.tsx (por crear)                                                                                                                                            | 1, 4                     | `npm run typecheck` y `npm run lint`; `grep -rn "use client" src/features/storefront/ src/components/store/StoreTrail.tsx` vacío. `verify.sh`                                                                                                            |
| 4   | **Montarlo en las tres pantallas indexables**, que son las que llevan además el `BreadcrumbList` y las que no pueden dejar de ser estáticas. Incluye el ajuste vertical `py-8`→`pt-4 pb-8` (`pt-6`→`pt-4` en la ficha) y, por PP1, **quitar de la ficha el enlace de categoría de encima del `<h1>`**, que el rastro sustituye con ventaja. | `src/app/[slug]/page.tsx` · `src/app/[slug]/c/[categorySlug]/page.tsx` · `src/app/[slug]/p/[productSlug]/page.tsx`                                                                         | 1, 3, 10, 12, 13, 15–19  | `npm run build` marcando las tres como `●`; `curl` para 1, 10, 12, 15, 16, 18; el log de consultas de Prisma para 13. Para PP1, el nombre de la categoría aparece **una sola vez** en la ficha, dentro del `<nav aria-label="Ruta">`. `verify.sh --full` |
| 5   | **Montarlo en las seis restantes**, y de paso los tres arreglos que R14 e I4 piden: fuera el «← Volver a {nombre}» de `sucursales`, y el `<a href>` de la página de pedido pasa a `<Link>`.                                                                                                                                                 | `src/app/[slug]/buscar/page.tsx` · `src/app/[slug]/carrito/page.tsx` · `src/app/[slug]/checkout/page.tsx` · `src/app/[slug]/pedido/[code]/page.tsx` · `src/app/[slug]/sucursales/page.tsx` | 5, 6, 7, 8, 11           | `curl` contra `/bodega-uno/carrito`, `/bodega-central-vedado/carrito`, `/tienda-cerrada/carrito`, `/tienda-demo/buscar?q=<300 chars>` y `/bodega-uno/sucursales`. `verify.sh --full`                                                                     |
| 6   | **Los tres 404 de la tienda**: el nuevo, que recupera el marco de la tienda para el producto inexistente, y los dos existentes, que pierden su `<Link href="..">` relativo —el que conserva el alias— y pasan a apoyarse en la salida canónica de la cabecera.                                                                              | src/app/[slug]/not-found.tsx (por crear) · `src/app/[slug]/pedido/[code]/not-found.tsx` · `src/app/[slug]/c/[categorySlug]/not-found.tsx`                                                  | 9, 21                    | `grep -rn 'href="\.\."' 'src/app/[slug]/'` vacío para el 21; navegador (no `curl`) para el 9, por lo que explica § Riesgos. `verify.sh --full`                                                                                                           |
| 7   | **Las pruebas que un `curl` no alcanza**: el guion visual con los diez pasos V1–V10 del diseño, y el guion de humo del feature.                                                                                                                                                                                                             | .agent/specs/F-025/visual.mjs (por crear) · .agent/specs/F-025/smoke.sh (por crear)                                                                                                        | 2, 9, 14, y el veredicto | `bash .agent/verify.sh F-025 --full` en 0, y la etapa visual ejecutando V1–V10 sobre la app levantada                                                                                                                                                    |

## De dónde sale cada paso

| Paso | Sale de                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Contratos (la firma completa) y § La trampa del tipo tupla, que es un hallazgo comprobado con `tsc --strict`, no una preferencia. La tabla de pantallas es de `spec.md` § Datos y contrato.                                    |
| 2    | `architecture.md` § El JSON-LD de `BreadcrumbList`, y R13 de `spec.md` (solo donde se indexa).                                                                                                                                                     |
| 3    | `design.md` decisiones 1 a 5, y RD1–RD3 de su § Lo que este diseño le pide al arquitecto. El `<span aria-current>` en vez de `<a>` sin href es RD3, textual.                                                                                       |
| 4    | R13 de `spec.md` (qué rutas llevan JSON-LD), R18 (no romper el estático) y § Estructura por breakpoint de `design.md` (el ajuste vertical).                                                                                                        |
| 5    | R14 de `spec.md` (un solo control de vuelta) e I4 (el `<a>` que recarga la aplicación entera). Las seis pantallas están en la tabla de § Datos y contrato.                                                                                         |
| 6    | Punto 4 de § Alcance de `spec.md` (I6, E15), I3 e I10 (los dos relativos que conservan el alias), y § Los dos `not-found.tsx` sin `params` de `architecture.md`, que demuestra que la solución tiene que ser una sola y por qué no puede ser otra. |
| 7    | § Verificación visual de `design.md` (V1–V10) y el criterio 14, que exige el sensor en `--full`.                                                                                                                                                   |

Ningún paso sale de mí. Los ajustes de padding del paso 4 y el `<Link>` del paso
5 podrían parecer alcance colado: no lo son —el primero es § Estructura por
breakpoint del diseño, el segundo es I4 de la spec, escrito antes de que
existiera este plan.

## Qué queda fuera

- **Que un 404 se pueda navegar sin JavaScript.** Está medido que en esta app
  **ningún** `notFound()` sirve HTML real: el cuerpo va vacío y el contenido
  viaja en el payload de hidratación. Es anterior a este feature, pasa en los
  tres 404 que ya existían, y tiene su propia propuesta abierta
  (`.agent/specs/propuestas/404-sin-salida-sin-javascript.md`). F-025 recupera el
  marco de la tienda para quien tenga JavaScript; el HTML servido lo arregla
  aquella.
- **El historial del navegador.** Ni `history.back()`, ni `router.back()`, ni
  `document.referrer`. El destino de «atrás» se calcula de la URL, así que dos
  compradores en la misma página vuelven al mismo sitio.
- **Recordar de dónde venías.** Volver desde una ficha lleva a su categoría (o al
  catálogo si el producto no tiene), nunca a los resultados de búsqueda de los
  que se vino. Marcar la procedencia en la URL volvería dinámica la ficha y
  rompería un criterio de F-004 que ya está verificado.
- **Un eslabón de subcategoría.** No hay dato detrás: F-026 construyó un solo
  nivel. El motor lo admite sin reescribir nada —§ La prueba de la subcategoría
  de `architecture.md` lo demuestra—, pero no se construye hoy.
- **Conservar filtros y orden al volver.** Es F-027, y hoy no hay filtros que
  conservar.
- **El panel de administración.** Repite el patrón «← X» en siete páginas y
  seguirá haciéndolo. No lo ve ningún comprador.
- **Rediseñar `BranchBar` ni los chips de categoría de F-026.** Conviven con el
  rastro; uno es un selector y el otro es la ubicación.

## Riesgos y plan B

**No hay migración de datos, ni cambio en `docs/sync-contract.md`, ni nada de lo
que `AGENTS.md` marca como prohibido.** No se toca `prisma/`, ni `src/proxy.ts`,
ni `src/lib/cache.ts`. Esto no se aprueba de pasada porque sí: se aprueba de
pasada porque de verdad no hay nada que aprobar ahí.

- **Que alguna de las tres rutas estáticas deje de serlo.** Es el riesgo caro: el
  criterio 1 de F-004 lleva verificado desde entonces. Se notaría en el `npm run
build` del paso 4, como una `ƒ` donde había una `●`. Lo previene RD4 (el rastro
  no puede pedir `headers()`, `cookies()` ni `searchParams` ahí) y lo detecta el
  propio paso antes de seguir. Plan B: el rastro de esa ruta se construye con lo
  que ya tenía la página en la mano, que es de donde debía salir.
- **Que el criterio 9 no se pueda demostrar.** Ya se sabe que con `curl` no se
  puede, y por eso se reformuló hoy. Si tampoco se pudiera con navegador, el paso
  6 se entrega sin src/app/[slug]/not-found.tsx (por crear) y el punto 4 del
  alcance se va entero a la propuesta del 404.
- **Que el rastro quede rancio al agrupar una marca.** Una sucursal que pasa de
  sola a agrupada tiene que ganar el eslabón de marca. El arquitecto verificó que
  el embudo de revalidación que ya existe lo cubre, porque la etiqueta sale de la
  misma lectura de catálogo que ya está tageada. Se notaría como un rastro de un
  eslabón en una marca que ya tiene dos sucursales. Es el fallo exacto que fichó
  `revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado`.
- **Que la fila desborde en 360 px con cuatro eslabones.** El diseño lo cerró con
  suelos y topes cuya suma de mínimos da 100 %, medido en 14 escenas × 3 anchos ×
  2 esquemas. V3 lo comprueba en cada pantalla.
- **Marcha atrás.** Los seis pasos son aditivos salvo tres borrados pequeños (el
  «← Volver a», y los dos `<Link href="..">` relativos). Revertir es quitar el
  montaje del componente de las nueve páginas y devolver esos tres; ningún dato
  queda tocado, así que no hay nada que restaurar.

## Coste

Cinco ciclos de agente ya gastados (spec, arquitectura, diseño, más dos
correcciones). Quedan **dos**: uno de `sdd-implementer` para los seis pasos y uno
de `sdd-tester` para el séptimo y el veredicto. Si el paso 6 se tuerce, un
tercero.

Se toca lo que ya funciona en tres sitios: las nueve páginas públicas ganan una
fila y pierden 4 px de padding superior; `/[slug]/sucursales` pierde su enlace de
vuelta propio; y la página de pedido cambia una recarga completa por una
navegación de cliente. Nada de eso altera datos ni consultas.

## Preguntas antes de aprobar

**PP1 — la ficha de producto va a decir el nombre de la categoría dos veces.
¿Se quita una? — RESUELTA por el humano el 2026-08-31: opción (b).** Se quita la
línea de encima del título; el rastro se queda como el único sitio donde aparece
la categoría en la ficha. Ya está incorporado al paso 4, y con ello `design.md`
puede cerrar su DP1. Revierte el efecto visible de DP2 de F-026 a sabiendas: se
le advirtió y aun así eligió (b), que es lo que recomendaban el diseñador y el
arquitecto por separado.

El texto de la pregunta, tal como se le enseñó, se conserva abajo.

Desde que decidiste ampliar el alcance a la categoría, el rastro de la ficha
lleva «Bebidas» como eslabón de vuelta. Y justo encima del título ya está ese
mismo nombre, enlazando a esa misma URL: lo puso F-026 al resolver su DP2, que
decidiste tú. En 360 px quedan dos enlaces idénticos a 60 px de distancia, y para
un lector de pantalla son dos enlaces con el mismo nombre y el mismo destino.

- **(a) No tocar nada.** El rastro es cromo de navegación y la línea de encima
  del título es metadato del producto. Es lo que dice la spec hoy, y es lo que se
  implementa **si no respondes**: no bloquea.
- **(b) Quitar la línea de encima del título. ← ELEGIDA.** El rastro hace ese trabajo con
  ventaja: mismo nombre, mismo enlace, y además dice de qué sucursal cuelga.
  Ahorra 20 px en la pantalla más apretada. **Recomendada por el diseñador y por
  el arquitecto, cada uno por su lado** — con la advertencia de que revierte el
  efecto visible de una decisión tuya de hace dos días.
- **(c) Dejarla como texto sin enlace.** Quita la duplicación de destino y
  conserva el dato junto al título. Deshace DP2 a medias.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-025 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-31T14:20:32Z — aprobado por el humano: «Apruebo. Y en PP1, quitar la línea de encima del título: que la categoría aparezca solo en el rastro.»
