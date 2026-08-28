---
slug: nextjs-loading-tsx-rompe-status-code-de-notfound
sintoma: "una página con loading.tsx en su segmento responde HTTP 200 aunque la página misma llame a notFound() (o lance/redirija con un status distinto) — el HTML final SÍ muestra el contenido de not-found.tsx, pero curl/Playwright ven 200, nunca 404"
firma: VISUAL FAIL.*responde 404|el slug en modo selector responde 404
etapa: visual
visto_en: F-021
creado: 2026-08-28T14:20:00Z
promovido_a_agents: no
arreglo: quita loading.tsx del segmento que puede terminar en notFound()/error, o muévelo a un segmento padre que nunca resuelva a 404
---

## Qué pasa de verdad

Un `loading.tsx` envuelve el segmento en un `<Suspense>` implícito. Next
empieza a transmitir (streamear) la respuesta con el fallback de
`loading.tsx` **antes** de que el componente de página termine de resolver
—eso es justamente lo que hace que el loading sirva de algo—, y para
entonces ya comprometió la cabecera HTTP con status 200. Cuando la página
llama a `notFound()` (o lanza) más tarde, en medio del streaming, React
consigue pintar la UI de `not-found.tsx`/`error.tsx` dentro del HTML que ya
salió, pero el código de estado no se puede corregir retroactivamente: ya
se envió. El resultado es un 200 con el cuerpo de un 404 — indistinguible a
simple vista (`curl` sin `-i` no lo nota), pero cualquier cosa que mire el
status (una prueba, un crawler, un proxy) lo trata como éxito.

Reproducido exacto en este feature: `src/app/[slug]/buscar/page.tsx` llama
a `notFound()` cuando el slug resuelve a una marca en modo selector (E13),
y `src/app/[slug]/buscar/loading.tsx` (existía por el pedido de design.md
de mostrar "Buscando…" durante la paginación) hacía que esa ruta respondiera
200 en vez de 404. `src/app/[slug]/p/[productSlug]/page.tsx`, que llama a
`notFound()` de la misma forma pero **no tiene** `loading.tsx` en su
segmento, sí devuelve 404 correctamente — la única diferencia entre los dos
es la presencia del archivo.

## Cómo se arregla

Quita `loading.tsx` del segmento. Si la transición de carga importa (por
ejemplo, para que un `next/link` de paginación no se quede "pegado"),
acéptalo: sin `loading.tsx`, Next deja el contenido anterior visible hasta
que la navegación completa llega — más lento a la vista, pero correcto en
status. La alternativa de mover el `loading.tsx` a un segmento **padre**
que nunca resuelva a 404 (por ejemplo el propio `/[slug]`) no sirve aquí:
seguiría envolviendo el mismo `notFound()` hijo con el mismo problema.

## Cuándo NO es esto

Si la página SIEMPRE responde 200 (nunca llama a `notFound()`/lanza un
error dentro de ese segmento), un `loading.tsx` es inofensivo — el status
200 que compromete el streaming es exactamente el que se quería de todas
formas. Esto solo muerde cuando el MISMO segmento combina un `loading.tsx`
con un camino que termina en un status distinto de 200.

## Cómo se evita

Antes de añadir `loading.tsx` a un segmento, revisa si ese segmento (o
cualquier página bajo él) puede llamar a `notFound()`, `redirect()` o lanzar
un error intencional. Si puede, o se prueba el status HTTP real de esa ruta
antes de dar el feature por cerrado (no solo el contenido del HTML), o se
prescinde del `loading.tsx` en ese segmento concreto.
