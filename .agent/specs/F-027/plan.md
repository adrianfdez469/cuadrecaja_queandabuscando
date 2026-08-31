---
feature: F-027
agente: orquestador
actualizado: 2026-08-31T18:54:35Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Quien entra a una tienda va a poder **acotar y reordenar el catálogo** sin saber
cómo se llama lo que busca: «solo lo que hay», «solo bebidas y panadería», «hasta
$500», «lo más barato primero». Vive en una pantalla nueva, `/[slug]/catalogo`,
a la que se llega por un enlace «Filtrar y ordenar» junto al título del catálogo.

**Lo que no cambia:** `/[slug]` sigue enseñando el mismo catálogo, en el mismo
orden, servido del CDN como hoy — gana un enlace y nada más. La búsqueda de
F-021 sigue devolviendo lo mismo cuando nadie pide un orden distinto, y gana un
selector de orden. Todo funciona sin JavaScript.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                   | Archivos                                                                                                                                      | Criterio que acerca | Cómo se verifica                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Los tokens del vocabulario (`hay`, `si`, los cinco `sort`, `CATALOG_FILTER_VALUES_MAX = 12`, el segmento `catalogo`) y la nota de que el tamaño de página deja de ser solo del buscador                       | `src/constants/catalog.ts` (crece), `src/constants/storeSearch.ts` (una línea de comentario)                                                  | 10, 12              | `npm run typecheck` y `npm run lint` en 0; `grep` de que ningún literal del vocabulario queda suelto                                         |
| 2   | `formatWholeMoney(value, options?)` compartiendo con `formatMoney` el helper privado del `Intl.NumberFormat` y su rama de respaldo (RD4)                                                                      | `src/lib/money.ts` (crece), `src/lib/money.test.ts` (crece)                                                                                   | —                   | `npm test -- money`: «$350» y no «$350.00», y el símbolo idéntico al de `formatMoney` para la misma moneda                                   |
| 3   | `createdAt` proyectado en `CatalogProduct` en **los dos** lectores del tipo                                                                                                                                   | `src/features/catalog/server/queries.ts`, `src/features/catalog/server/search.ts`                                                             | 8                   | `npm run typecheck` en 0 (el tipo compartido rompe la compilación del segundo si se olvida — ADR 0025)                                       |
| 4   | El módulo único: `parseCatalogFilters` (Zod, `.catch()` por campo), `catalogFilterHref`, `applyCatalogFilters` (filtrar + contar las cinco facetas + ordenar + paginar), `describeCatalogFilters`             | `src/features/catalog/catalogFilters.ts` (por crear), `src/features/catalog/catalogFilters.test.ts` (por crear)                               | 3–8, 10, 14         | `npm test -- catalogFilters`: unión/intersección, override 900→300, promo 600→300, sin tasa al final, «ácido/Agua/azúcar», parámetros basura |
| 5   | Los cuatro números de precio de RD3 —`min`, `max`, `pricedCount`, `brackets`— en la misma pasada                                                                                                              | `src/features/catalog/catalogFilters.ts`                                                                                                      | 5, 6                | `npm test`: sobre los precios de `tienda-demo` los tres tramos dan 5/5/5; con n<12 `price.brackets` es `null`                                |
| 6   | `getFilteredStoreCatalog`: envoltorio sobre `getStoreCatalog` ya cacheado + `applyCatalogFilters`. Cero consulta nueva, cero entrada de caché nueva                                                           | `src/features/catalog/server/queries.ts` (crece)                                                                                              | 1, 12               | `npm test`; `npm run lint` (sin Prisma en componentes)                                                                                       |
| 7   | `searchStoreProducts` en modo conjunto completo: devuelve los candidatos sin paginar **solo** cuando la petición lleva filtro u orden                                                                         | `src/features/catalog/server/search.ts` (crece)                                                                                               | 9                   | Los tests de F-021 se re-ejecutan y siguen verdes; uno nuevo para el modo con `sort`                                                         |
| 8   | Las piezas de UI, todas de servidor: panel (`<details>` dentro de `<form method="get">`, abierto/plegado según lo aplicado), chips, selector de orden (`<select>` + «Ordenar»), línea de resultados y rejilla | `src/components/store/StoreFilterPanel.tsx`, `StoreFilterChips.tsx`, `StoreCatalogSort.tsx`, `StoreCatalogResults.tsx` (los cuatro por crear) | 11, 12              | `grep -rn '"use client"' src/components/store/` sin resultados nuevos; `npm run check:theme` en 0                                            |
| 9   | La página nueva: resolución, tienda cerrada sin consulta, modo selector 404, los tres vacíos, `force-dynamic`, `robots: { index: false }` y canónica a `/[slug]`. **Sin `loading.tsx`**                       | `src/app/[slug]/catalogo/page.tsx`, `src/app/[slug]/catalogo/not-found.tsx` (por crear)                                                       | 11, 13, 15          | `curl` de las URL: 200/404 donde toca, `noindex` y `canonical` en el HTML                                                                    |
| 10  | `filterTrail(store)`, gemelo de `searchTrail`, para el rastro de F-025                                                                                                                                        | `src/features/storefront/trail.ts` (crece), su test                                                                                           | —                   | `npm test -- trail`                                                                                                                          |
| 11  | El enlace «Filtrar y ordenar» en la fila del `<h1>`, con la regla de § Decisión 4 (2+ productos y alguna faceta que dibujar)                                                                                  | `src/app/[slug]/page.tsx`, `src/app/[slug]/c/[categorySlug]/page.tsx`                                                                         | 1, 2                | `npm run build`: `/[slug]`, `/[slug]/p/[productSlug]` y `/[slug]/c/[categorySlug]` siguen `●`; la ruta nueva es `ƒ`                          |
| 12  | `/[slug]/buscar` gana el selector de orden y los chips, y la canónica solo cuando la URL lleva filtro u orden                                                                                                 | `src/app/[slug]/buscar/page.tsx`                                                                                                              | 9, 13               | Los criterios 1 y 2 de F-021 se re-ejecutan sin `sort` y siguen verdes                                                                       |
| 13  | Verificación completa y cierre                                                                                                                                                                                | —                                                                                                                                             | 16                  | `bash .agent/verify.sh F-027 --full` en 0 (nueve etapas, `bundle` incluida, sin subir `BUDGET_KB`)                                           |

Los pasos 1–7 son servidor puro y los verifica `npm test`; los 8–12 son la
superficie y los verifica el navegador más el build. El paso 13 es el que firma
el criterio 16.

## De dónde sale cada paso

| Paso | Sale de                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Dónde vive el módulo (los tokens a `src/constants/catalog.ts`); `AGENTS.md` § Prohibiciones   |
| 2    | `design.md` RD4 → `architecture.md` § Contratos › Funciones (`formatWholeMoney`)                                  |
| 3    | `architecture.md` § Componentes, fila `CatalogProduct.createdAt`; `spec.md` § Datos y contrato (`createdAt`, I9)  |
| 4    | `spec.md` R2, R4, R5, R8, R10, R17, R18; `architecture.md` § El vocabulario de la URL y § Contratos               |
| 5    | `design.md` § Decisión 2 (atajos derivados) + RD3 → `architecture.md` § Contratos › `CatalogPriceFacet`           |
| 6    | `spec.md` SP3 (RESUELTO por el humano) y I7; `architecture.md` § Componentes                                      |
| 7    | `spec.md` I8 y E12; `architecture.md` § La petición de `/[slug]/buscar`                                           |
| 8    | `design.md` § Decisiones 1, 3, 5, 7 y § Componentes de UI; `spec.md` R12, R18, E14                                |
| 9    | `spec.md` SP4, E16–E19, R14; `architecture.md` § Ruta (punto 3) y la ficha `nextjs-loading-tsx-rompe-status-code` |
| 10   | `architecture.md` § Componentes, fila «Miga de pan»; `design.md` § Flujo de usuario                               |
| 11   | `design.md` § Decisión 4 y § Decisión 6; `spec.md` R13, E20, I1                                                   |
| 12   | `design.md` § Inventario 3; `spec.md` E11, E12, criterio 9                                                        |
| 13   | Criterio 16 de `.agent/features.json`                                                                             |

No hay ningún paso que no salga de una línea de los tres documentos.

## Dos choques entre arquitectura y diseño, resueltos por el orquestador

Los dos artefactos cerraron en paralelo y se contradicen en dos puntos. Ninguno
es decisión de producto, así que los resuelvo yo y los dejo escritos aquí para
que se puedan revocar al firmar:

**C1 — el selector de orden: `<select>` (diseño) o enlaces, uno por criterio
(arquitectura).** Gana el **`<select>` con su botón «Ordenar»**. El diseño lo
midió en el navegador a 360/768/1280 y lo integró con su regla de canonización
(§ Decisión 7); la arquitectura lo dice de pasada en una fila de tabla, sin
argumento. Los dos son cero JavaScript y el contrato de `sort` no cambia: es un
valor único en cualquiera de las dos formas. La forma del control es del
diseñador.

**C2 — la paginación: extraer un `StorePager` compartido (arquitectura) o copiar
su forma (diseño).** Gana **copiar la forma**, y la extracción queda fuera
(§ Qué queda fuera). El arquitecto la justificó citando «Duplicar interfaces» de
`AGENTS.md` § Prohibiciones, y esa prohibición habla de **interfaces de
TypeScript entre la capa de datos y la vista** —lo comprobé, `AGENTS.md:113`—,
no de marcado JSX. Sin esa regla detrás, extraer el paginador significa tocar
`StoreSearchResults.tsx`, un componente cuya prueba visual firmó F-021, a cambio
de nada que este feature necesite; su propia tabla de riesgos lo lista como
riesgo. Se replica el marcado (unas veinte líneas) y la extracción se abre como
`refactor:` aparte.

## Qué queda fuera

- **Filtrar por marca, talla, color o cualquier atributo.** No existe el dato en
  el schema ni en la v4 del contrato; exigiría una v5 con el equipo de
  cuadrecaja (`spec.md` I4).
- **Ordenar por «más vendido».** Lo cerró el humano en SP1: el contrato prohíbe
  `Venta` y `MovimientoStock`, y los pedidos nacidos aquí no son las ventas del
  negocio.
- **Ordenar por calificación o filtrar por estrellas.** No hay modelo de
  reseñas; es la propuesta hermana, todavía sin promover.
- **Subcategorías y el árbol de categorías.** Nadie escribe `parentId` hoy; el
  filtro es de un solo nivel (`spec.md` I5).
- **Conteos por faceta en `/[slug]/buscar`.** SP5 aceptó la asimetría a
  propósito: allí exigirían una segunda consulta.
- **Paginar `/[slug]`.** El catálogo sin filtrar sigue pintando todas las
  tarjetas (`spec.md` I6). Este feature lo hace visible pero no lo causa.
- **Extraer un componente común de paginación** (C2), y **unificar el orden
  alfabético de `/[slug]` con el de `sort=nombre`** (I-A2: uno ordena en
  Postgres y el otro en ICU; tocar el `ORDER BY` rompería el criterio 1).
- **Guardar la preferencia del comprador.** El estado vive entero en la URL
  (R19): sin cookie, sin `localStorage`, sin fila en la base.
- **Redirigir una URL no canónica.** Responde 200 tal cual; lo que protege el
  índice es el `noindex` más la canónica, no un 308 (§ Decisión 7).

## Riesgos y plan B

| Riesgo                                                                              | Cómo se notaría                                  | Plan B                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Una tienda pasa de ~4.200 productos y su catálogo deja de cachearse **en silencio** | Nada se pone rojo; sube la latencia de `/[slug]` | Está escrito con número y síntoma. Se recorta el peso por producto (`description`, `imageUrls`) antes de reabrir SP3 |
| El modo «conjunto completo» de la búsqueda mueve su orden por defecto               | Criterios 1 y 2 de F-021 en rojo                 | El modo solo se activa con filtro o `sort`; el criterio 9 re-ejecuta el otro camino                                  |
| El build marca la ruta nueva como `●` por descuido                                  | Criterio 2                                       | `force-dynamic` + `searchParams` no deja alternativa                                                                 |
| El panel gana un `"use client"` «para que se aplique solo»                          | Criterio 12 (`grep`) y `check:bundle`            | Prohibido por R12 y por `AGENTS.md`; se revierte                                                                     |
| El chip del atajo medio dice «Desde $351» y su rótulo «De $350 a $540» (I-A4)       | Al mirar la pantalla                             | El rótulo es del diseño: se ajusta el texto sin tocar el contrato                                                    |

**Nada de esto toca lo que no se aprueba de pasada:** no hay migración de datos,
no hay índice nuevo, `docs/sync-contract.md` no cambia ni sube de versión, y no
se usa ningún comando de los que `AGENTS.md` marca como prohibidos. Lo único
fuera de `src/` es el borrador de **ADR 0026** (vocabulario único de querystring
del catálogo), que el arquitecto dejó en estado **Propuesta** y que se firma con
este plan o se queda en propuesta.

## Coste

Dos ciclos de agente: uno de `sdd-implementer` (los trece pasos; los 1–7 y los
8–12 son dos tandas naturales dentro del mismo ciclo) y uno de `sdd-tester`
sobre los 16 criterios. Un tercero solo si el sensor sale `ESTANCADO`.

**Se toca de lo que ya funciona:** `src/lib/money.ts` (añade, no cambia),
`src/features/catalog/server/queries.ts` y `search.ts` (crecen), `src/app/[slug]/page.tsx`
y `src/app/[slug]/c/[categorySlug]/page.tsx` (un enlace cada uno),
`src/app/[slug]/buscar/page.tsx` (selector y chips), `src/constants/` (dos
archivos). Nada de lo existente cambia de comportamiento cuando no hay
parámetros — que es el criterio 1.

**Marcha atrás a mitad:** los pasos 1–7 son aditivos y se pueden dejar sin que
nada los use. Lo único que se vería desde fuera es el enlace del paso 11 y la
ruta del paso 9: quitar esos dos deja el storefront exactamente como está hoy.

## Preguntas antes de aprobar

Ninguna abierta. Las dos que había las resolvió el humano el 2026-08-31, antes
de firmar:

**PP1 — el borrador de ADR 0026. RESUELTA: aceptarla ahora.**
`docs/adr/0026-vocabulario-unico-de-querystring-del-catalogo.md` pasa de
**Propuesta** a **Aceptada** con la firma de este plan. Fija lo que sobrevive al
feature: un solo vocabulario de querystring, un solo intérprete, nunca sobre una
ruta pre-renderizada, y `noindex` + canónica en todo recorte.

**PP2 — los dos choques entre arquitectura y diseño. RESUELTA: los dos como
están.** C1 (el selector de orden es un `<select>` con su botón «Ordenar») y C2
(la paginación se copia; extraer un `StorePager` compartido queda fuera) se
quedan como los resolvió el orquestador en § Dos choques. El razonamiento de
cada uno está ahí y no se repite aquí.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-027 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-31T18:54:35Z — aprobado por el humano: «Apruebo el plan tal como está. ADR 0026: aceptarla ahora. C1 y C2: los dos como están.»
