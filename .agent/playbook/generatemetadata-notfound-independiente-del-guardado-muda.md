---
slug: generatemetadata-notfound-independiente-del-guardado-muda
sintoma: el SSR de una página con guarda (cierre real, tienda muda, etc.) es correcto, pero tras hidratar el cliente la sustituye por el not-found.tsx del segmento
firma: VISUAL FAIL V4 \(categoria-no-existe\)
etapa: visual
visto_en: F-040
creado: 2026-09-10T20:12:39Z
promovido_a_agents: no
arreglo: en generateMetadata, replica la MISMA guarda (y el MISMO orden) que el cuerpo de la página antes de llamar a notFound() — nunca solo `store.status !== "PUBLISHED"`
---

## Qué pasa de verdad

`generateMetadata` y el cuerpo de la página son dos funciones separadas que
Next.js ejecuta por su cuenta, ambas leyendo la misma resolución cacheada por
`cache()` de React — pero **cada una decide sus propios `notFound()`**. Si el
cuerpo de la página tiene una guarda que hace que un caso (aquí, «tienda
muda») nunca llegue a comprobar si el recurso pedido existe, pero
`generateMetadata` **no** replica esa misma guarda, `generateMetadata` sigue
llamando a `notFound()` para ese recurso.

El HTML que el servidor manda en la respuesta inicial es el del CUERPO de la
página — correcto, con la guarda aplicada — así que `curl` (y cualquier
prueba que solo mire la respuesta HTTP, `smoke.sh` incluido) lo ve bien y
responde 200. Pero Next.js **también** streamea, en el mismo documento, el
segmento renderizado por el `not-found.tsx` del layout — la salida de
`generateMetadata`'s propio `notFound()` — como parte del RSC payload
(`"$"` refs dentro de `<script>` con datos de streaming). El cliente, al
hidratar (~300-500 ms después de `domcontentloaded`, tras conectar el
WebSocket de HMR/Fast Refresh en dev o el propio router en producción),
reconcilia usando ESA referencia y sustituye el DOM correcto por el
`not-found.tsx`, delante de los ojos de quien compra.

Confirmado en F-040 (`src/app/[slug]/c/[categorySlug]/page.tsx`): el CUERPO
de la página tiene la guarda `if (pricing.unpriced) { return <aviso/> }`
ANTES de comprobar `if (!view) notFound()` (arquitectura AD7), así que un
`categorySlug` que no existe bajo una tienda muda nunca llega a `notFound()`
en el cuerpo. Pero `generateMetadata` (líneas 47-70 del mismo archivo) SOLO
comprueba `store.status !== "PUBLISHED"` antes de `const view =
getStoreCategoryView(...); if (!view) notFound();` — no comprueba
`pricing.unpriced` en absoluto, porque nunca llama a `getStoreCatalogPricing`.
Reproducido en `next dev` Y en `next build && next start`: no es un
artefacto de Turbopack ni de HMR, aunque HMR lo hace más fácil de ver en dev
(el WebSocket dispara la reconciliación antes).

## Cómo se arregla

`generateMetadata` tiene que replicar la MISMA guarda, en el MISMO orden,
que ya usa el cuerpo de la página — nunca una guarda distinta o más corta.
En `src/app/[slug]/c/[categorySlug]/page.tsx`, eso significa: tras el
`if (store.status !== "PUBLISHED")`, leer `getStoreCatalogPricing(resolution,
store.baseCurrencyCode)` y, si `pricing.unpriced`, devolver metadata
genérica (sin nombrar la categoría, igual que hace la rama de tienda
cerrada) ANTES de llamar a `getStoreCategoryView`/`notFound()`. La opción
barata que ya usa `/[slug]/p/[productSlug]/page.tsx` para el mismo problema
—su `generateMetadata` nunca llama a `notFound()` si el producto no existe,
solo devuelve `{ title: "Producto no encontrado" }`— es la otra salida
válida si no se quiere pagar una lectura más de `getStoreCatalogPricing`
dentro de `generateMetadata`.

## Cuándo NO es esto

La firma pesca el síntoma exacto de F-040 (categoría inexistente bajo una
tienda muda). Si el fallo es que la portada, la ficha u otra vista SÍ
mantienen la misma frase pero **antes** de hidratar (osea en el HTML crudo),
no es esto — mira si la ruta en cuestión tiene un `generateMetadata` propio
que llame a `notFound()` sin la guarda que el cuerpo sí tiene. Si el
`generateMetadata` de la ruta nunca llama a `notFound()` (como
`/p/[productSlug]`), esta ficha no aplica: el síntoma tiene que venir de
otro lado.

## Cómo se evita

Toda página con `generateMetadata` que llame a `notFound()` tiene que leer
la MISMA condición de guarda que decide el `return` temprano del cuerpo de
la página, en el MISMO orden — nunca una copia parcial (solo
`store.status`, por ejemplo, cuando el cuerpo también mira
`pricing.unpriced`). Una prueba que solo golpea el endpoint con `curl`
**no** destapa esto — hace falta un navegador real que espere a que el
cliente hidrate (`page.goto(..., { waitUntil: "networkidle" })` más un
margen de ~300-500 ms) y lea el DOM **después**, no el HTML crudo de la
respuesta. `smoke.sh` (HTTP puro) no lo habría visto nunca; solo
`visual.mjs` lo pescó.
