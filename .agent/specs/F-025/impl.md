---
feature: F-025
agente: sdd-implementer
actualizado: 1970-01-01T00:00:00Z
estado: borrador
---

## Qué se construyó

Los seis pasos de `plan.md`, en orden, cada uno verificado con
`bash .agent/verify.sh F-025` (pasos 1-3) o `--full` (pasos 4-6) antes de
pasar al siguiente.

| Archivo                                         | Qué hace                                                                                                                                                                                                                                                                                                                                            | Criterio que cubre          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `src/features/storefront/trail.ts`              | Los tipos (`Crumb`, `Trail`, `TrailStep`, `BackTarget`, `TrailStore`), los adaptadores (`branchTrailStore`, `brandTrailStore`), la espina R4 (`trailSpine`), el constructor `storeTrail()` (construcción por delante, `[first, ...rest]`), `backTarget()`, `categorySteps()`, `TRAIL_LABEL`, los ocho envoltorios por pantalla y `breadcrumbList()` | 1, 5, 6, 12, 15, 16, 17, 19 |
| `src/features/storefront/trail.test.ts`         | Una prueba por cada una de las 15 filas de la tabla de pantallas de `architecture.md`, más R4, R5, R19, `backTarget()` con un eslabón, la construcción front-first y `breadcrumbList()`                                                                                                                                                             | 1, 5, 6, 12, 15, 16, 17     |
| `src/lib/jsonLd.ts`                             | `jsonLdScriptContent()`: `JSON.stringify` + escape de `<`                                                                                                                                                                                                                                                                                           | 10, 18                      |
| `src/lib/jsonLd.test.ts`                        | Caso `</script>`, caso `<!--`, y que el resultado siga siendo el mismo JSON al hacer `JSON.parse`                                                                                                                                                                                                                                                   | 10, 18                      |
| `src/components/store/StoreTrail.tsx`           | El `<nav aria-label="Ruta">`/`<ol>`, separador `aria-hidden`, `aria-current="page"` en el actual, el reparto por prioridad de `design.md` § Decisión 2 (`shrink`/`shrink-0`/`shrink-[9999]`, tope `max-w-[calc(100%-Nrem)]` literal), y el `<script type="application/ld+json">` cuando `jsonLd` es `true`                                          | 1, 2, 4, 10, 12, 18         |
| `src/app/[slug]/page.tsx`                       | Monta el rastro en las tres ramas (selector, sucursal abierta con `jsonLd`, sucursal cerrada); `py-8`→`pt-4 pb-8`                                                                                                                                                                                                                                   | 1, 3, 5, 6, 7, 12, 15       |
| `src/app/[slug]/c/[categorySlug]/page.tsx`      | Monta el rastro en las dos ramas (abierta con `jsonLd`, cerrada corta); `py-8`→`pt-4 pb-8`                                                                                                                                                                                                                                                          | 15, 18, 19, 20              |
| `src/app/[slug]/p/[productSlug]/page.tsx`       | Monta el rastro en las dos ramas (abierta con `jsonLd`, cerrada corta); `pt-6`→`pt-4`; **PP1/DP1**: se borró el `<Link>` de categoría de encima del `<h1>` y el `mt-1` del `<h1>`                                                                                                                                                                   | 1, 2, 3, 10, 13, 16, 17     |
| `src/app/[slug]/buscar/page.tsx`                | Monta el rastro en las tres ramas (cerrada, sin `q`, con `q`); `py-8`→`pt-4 pb-8`                                                                                                                                                                                                                                                                   | 8                           |
| `src/app/[slug]/carrito/page.tsx`               | Monta el rastro en las dos ramas; `py-8`→`pt-4 pb-8`                                                                                                                                                                                                                                                                                                | 5, 6, 7                     |
| `src/app/[slug]/checkout/page.tsx`              | Monta el rastro en las dos ramas; `py-8`→`pt-4 pb-8`                                                                                                                                                                                                                                                                                                | —                           |
| `src/app/[slug]/pedido/[code]/page.tsx`         | Monta el rastro; el `<a href>` de «Seguir comprando» pasa a `<Link>` (I4)                                                                                                                                                                                                                                                                           | —                           |
| `src/app/[slug]/sucursales/page.tsx`            | Monta el rastro (construido desde `resolution`/`current`, sin `requireStore()` nuevo); se borró el «← Volver a {nombre}» y el `mt-1` del `<h1>`                                                                                                                                                                                                     | 11                          |
| `src/app/[slug]/not-found.tsx`                  | Nuevo. El 404 con marco de tienda para `/[slug]/p/no-existe` y cualquier otro `notFound()` del segmento sin `not-found.tsx` propio. Síncrono, sin API dinámica, sin `<Link>` propio (la salida canónica es la cabecera del layout)                                                                                                                  | 9, 21                       |
| `src/app/[slug]/pedido/[code]/not-found.tsx`    | Perdió su `<Link>` relativo (`..`) y el comentario que lo justificaba                                                                                                                                                                                                                                                                               | 21                          |
| `src/app/[slug]/c/[categorySlug]/not-found.tsx` | Perdió su `<Link>` relativo (`..`) y el párrafo de comentario que lo justificaba                                                                                                                                                                                                                                                                    | 21                          |

## Desviaciones

Ninguna de alcance. Tres decisiones pequeñas, tomadas dentro de lo que el
plan dejaba a criterio del implementador:

1. **`src/app/[slug]/sucursales/page.tsx` no llama a `requireStore()`.** El
   plan/arquitectura nombran `branchSwitchTrail(store)` con una variable
   `store`, pero esta página nunca cargó un `StoreSummary`: solo tiene
   `resolution` (con `brandName`) y `current` (un `BranchRef`, sin
   `brandName`). En vez de añadir una consulta nueva —que R7 pide evitar—
   construí el `TrailStore` con los datos que la página ya tenía en memoria
   (`resolution.brandName` + `current.canonicalSlug`/`current.name`), igual
   que `architecture.md` § Cómo se construye el rastro… ya autoriza para las
   dos pantallas sin `StoreSummary` a mano. El propio documento dice que
   `resolution.brandName` es «exactamente el mismo valor que sus propias
   páginas ya pintan hoy», y esta página ya lo usaba para su «← Volver a
   {nombre}» — cero consultas nuevas, cero dependencia nueva.
2. **`/[slug]/buscar` con tienda cerrada usa `searchTrail(store, null)`**
   («Buscar», sin término) en vez de leer `searchParams` para mostrar
   `Buscar «término»`. La rama de tienda cerrada de este archivo ya
   retornaba antes de leer `searchParams` (no lo necesitaba: solo pinta el
   aviso de cerrada), y parsear el término ahí solo para el rastro habría
   sido una lectura nueva sin necesidad real — ninguna spec/criterio exige
   el término en esa rama. Mantiene el patrón «si un dato no está, el
   eslabón no lo pide» (R7/R19 en espíritu).
3. **Los comentarios de los dos `not-found.tsx` que perdieron su enlace no
   citan el código con backticks `href=".."`**, aunque así lo hice en el
   primer borrador: el criterio 21 hace `grep -rn 'href="\.\."'
'src/app/[slug]/'` sobre **todo el árbol**, incluidos los comentarios, y
   la cadena literal en un comentario habría hecho fallar ese mismo grep que
   el criterio usa para probar que ya no existe. Reescrito para describir el
   enlace sin reproducir la cadena exacta que el sensor busca.

Ninguna desviación cambia una firma, un archivo prohibido o un criterio.

## Comandos ejecutados

- `bash .agent/verify.sh F-025` — ejecutado después de cada uno de los pasos
  1, 2 y 3. **Salida final: `PASA`, código 0** (typecheck·lint·format·test).
- `bash .agent/verify.sh F-025 --full` — ejecutado después de cada uno de los
  pasos 4, 5 y 6, y una vez más al cierre del ciclo. **Última ejecución:
  `PASA`, código 0** (harness·typecheck·lint·format·test·prisma·build·theme·bundle).
- Un fallo de `test` en el intento 12 (mi propio descuido: el test 1 de
  `trail.test.ts` esperaba `href` en un rastro de un solo eslabón, cuando
  `storeTrail()` sin `current` correctamente le quita el `href` al último —
  R5). Corregida la expectativa del test, no el código. Descartado con
  `bash .agent/verify.sh dismiss F-025 '<firma>' '<motivo>'` porque no es una
  trampa del repo, es un error mío al escribir el test.
- `npm run build` a mano, dos veces, para confirmar que `/[slug]`,
  `/[slug]/p/[productSlug]` y `/[slug]/c/[categorySlug]` siguen `●` (nunca
  `ƒ`) — antes y después del paso 6.
- `npm run start` a mano en tres puertos temporales (3900, 3901, 3902) para
  inspeccionar el HTML servido de: la ficha con categoría (`/tienda-demo/p/refresco-de-cola-1-5-l`),
  el carrito de una marca multi-sucursal (`/el-trebol-centro/carrito`), el
  alias (`/bodega-central-vedado/carrito`, `/bodega-central-vedado/c/no-existe`),
  la tienda cerrada (`/tienda-cerrada/carrito`), la búsqueda con un término de
  300 caracteres, `/bodega-uno/sucursales`/`/el-trebol-centro/sucursales`, y
  los tres 404 (`/tienda-demo/p/no-existe`, `/bodega-central-vedado/c/no-existe`,
  `/tienda-demo/pedido/ZZZZZZZZZZ`). Los tres servidores temporales se
  mataron al terminar cada inspección.

## Deuda dejada

Ninguna. Los seis pasos están completos y el sensor está en `0` en `--full`.

## Qué necesita quien pruebe

- **Entorno**: el mismo `.env` de este worktree (no levantar
  `docker compose` aquí — lo tiene el worktree hermano `cowrie`; ficha
  `docker-compose-container-name-fijo-choca-entre-worktrees`). `npm run dev`
  o `npm run build && npm run start`.
- **`el-trebol` / `el-trebol-centro`** es la marca multi-sucursal que ya
  viene agrupada en el seed (dos sucursales, `el-trebol-centro` PUBLISHED y
  `el-trebol-playa` SUSPENDED) — úsala para el criterio 5 y para cualquier
  caso de cuatro eslabones sin tener que agrupar `bodega-uno`/`bodega-dos` a
  mano primero. Verificado con curl: `/el-trebol-centro/carrito` da los tres
  eslabones (`El Trébol` › `El Trébol · Centro Habana` › `Carrito`), el
  segundo enlaza a `/el-trebol-centro`.
- **`bodega-uno` en este seed NO está agrupada con `bodega-dos`** por
  defecto — `curl /bodega-uno/carrito` da un rastro de **dos** eslabones, no
  de tres, hasta que se agrupe (como hace `.agent/specs/F-017/smoke.sh`). No
  es un fallo: es el estado del seed. `trail.test.ts` ya cubre el caso
  multi-sucursal a nivel unitario con un `TrailStore` fijo, sin depender del
  seed.
- **Aviso sobre el criterio 11 y «Volver a»** (design.md ya lo avisaba, y lo
  confirmé con curl): `src/app/not-found.tsx` (el 404 global de la
  plataforma) va embebido en el payload de React Flight de **toda** página
  de la app —incluida `/bodega-uno/sucursales` y `/el-trebol-centro/sucursales`—,
  como prop del `HTTPAccessFallbackBoundary`, y su texto es «Volver al
  inicio», que **contiene** la subcadena «Volver a». Es preexistente, no lo
  introduce F-025, y no es visible en el DOM renderizado (vive solo dentro
  de un `<script>` de hidratación). Un `grep -c "Volver a"` crudo sobre el
  HTML de `/bodega-uno/sucursales` da **1**, no **0**: satisface el criterio
  11 tal como está en `.agent/features.json` («no aparece más de una vez»),
  pero **no** satisface la redacción más estricta de `spec.md` («ya no
  aparece»). Si `smoke.sh` usa `grep -c` sobre el HTML crudo, que compare
  contra `<= 1`, no contra `0` — o que acote la búsqueda al DOM visible /
  fuera del `<script>` de Flight.
- **Los tres 404 no sirven HTML con contenido real** (medido y documentado
  en `architecture.md` § El 404 dentro de una tienda: es así en **toda** la
  app, no solo en este feature). `curl /tienda-demo/p/no-existe` da 404 con
  cuerpo casi vacío; el `data-store="tienda-demo"` y el `href="/tienda-demo"`
  de la cabecera están, pero **escapados**, dentro del payload de Flight
  (`data-store\":\"tienda-demo\"`). Confirmado con curl+grep sobre el
  payload crudo. El criterio 9 solo se puede probar con navegador —está
  reformulado así en `.agent/features.json`— y es la etapa `--visual`, que
  es de `sdd-tester` (paso 7, fuera de mi alcance).
- **V9 de `.agent/specs/F-026/visual.mjs`** pulsaba el «Ver todo el
  catálogo» propio del 404 de categoría — ese enlace ya no existe (paso 6 lo
  quitó). Cualquier guion visual que reutilice ese flujo tiene que pulsar la
  cabecera del layout en su lugar, como ya anticipaba `progress/F-025.md`.
- Rutas de ejemplo para probar rápido: `/tienda-demo/p/refresco-de-cola-1-5-l`
  (ficha con categoría, 3 eslabones, JSON-LD), `/tienda-demo/c/bebidas`
  (2 eslabones, JSON-LD), `/el-trebol-centro/p/…` o `/el-trebol-centro/checkout`
  (4 eslabones), `/bodega-central-vedado/carrito` (alias → canónico),
  `/tienda-cerrada/c/lo-que-sea` (200, rastro corto, sin JSON-LD),
  `/tienda-demo/p/no-existe` (404 con marco).

## Preguntas al humano

Ninguna. No encontré nada que el plan dejara corto ni ninguna discrepancia
entre `spec.md`/`architecture.md`/`design.md`/`plan.md` que requiriera
pararme.
