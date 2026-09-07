---
slug: cache-de-react-es-un-no-op-en-un-route-handler
sintoma: un route handler memoiza con `cache()` de React esperando "una consulta por lote", y en producción sigue siendo una consulta por evento — sin que ningún test lo note, en ninguna dirección
firma: —
etapa: review
visto_en: F-035
creado: 2026-09-07T02:14:41Z
promovido_a_agents: no
arreglo: memoiza con una clausura de ámbito propio (un `Map` creado por la función que procesa el lote y pasado a quien lo necesite), nunca con `cache()` de React, dentro de cualquier código que un `route.ts` invoque
---

## Qué pasa de verdad

`cache()` de React solo memoiza si React tiene instalado un _cache
dispatcher_; sin él, la implementación real hace `fn.apply(null, arguments)`
y ya —llama a la función tal cual, sin memoizar nada—. Ese dispatcher lo
instala el renderizador de RSC (páginas), y el runtime de un route handler
**no lo trae**. Comprobado en este repo, Next 16.3.2, contando
`getCacheForType` (la función interna que busca el dispatcher):

```
node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js: 3
node_modules/next/dist/compiled/next-server/app-route.runtime.prod.js: 0
node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js: 0
node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js: 0
node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js: 0
```

Solo las variantes `-experimental` lo traen, y exigen banderas que
`next.config.ts` no activa (`src/lib/cache.ts` ya deja escrito que
`cacheComponents` no se enciende). El sync entra por
`src/app/api/internal/sync/catalog/route.ts`, un route handler: `cache()`
ahí sería un no-op silencioso.

Lo peor no es que falle: es que **no hay manera de notarlo por un test**.
Vitest tampoco instala el dispatcher, así que un test que afirme "un solo
`findMany` para 500 eventos" falla, y uno que afirme "uno por evento" pasa —
con y sin `cache()`. La memoización sería literalmente inobservable, en
cualquier dirección, y solo se vería en producción como una consulta de más
por evento con un comentario en el código jurando que hay una sola.

## Cómo se arregla

Memoizar con una clausura de ámbito propio, no con `cache()`:

```ts
export function createRenderableBranchLookup(): RenderableBranchLookup {
  const memo = new Map<string, Promise<readonly PublicSlug[]>>();
  return (businessId: string) => {
    const existing = memo.get(businessId);
    if (existing) return existing;
    const promise = loadRenderableBranchSlugs(businessId);
    promise.catch(() => memo.delete(businessId));
    memo.set(businessId, promise);
    return promise;
  };
}
```

Quien procesa el lote crea la clausura **una vez** al principio (nunca a
nivel de módulo, que se compartiría entre peticiones y entre negocios) y la
pasa a quien la necesite. Se memoiza la **promesa**, no el valor resuelto, y
la entrada se borra si la promesa se rechaza — así un corte de base a mitad
de lote falla solo al evento que lo sufrió, no a los siguientes.
Ver `src/features/sync/server/businessBranches.ts` (F-035).

## Cuándo NO es esto

Si el código que memoiza con `cache()` se llama desde una **página** (un
`page.tsx`/`layout.tsx` renderizado como RSC), el dispatcher sí existe y
`cache()` sí memoiza — es el caso de `src/features/catalog/server/queries.ts`
y `src/features/storefront/server/resolve.ts`, los dos únicos usos del repo.
El único route handler que los alcanza
(`src/app/[slug]/pedido/[code]/respuesta/route.ts`) los llama una vez por
petición, así que ahí tampoco cuesta nada — no hay nada que arreglar fuera de
un caso como F-035, donde el punto de entrada es un route handler y el lote
completo depende de que la memoización sea real.

## Cómo se evita

Antes de elegir `cache()` de React para memoizar algo, pregunta por dónde
entra la petición. Si la respuesta es "un `route.ts`" (cualquier
`src/app/api/**/route.ts`), `cache()` no sirve — usa una clausura creada por
quien procesa esa petición/lote, del mismo modo que un handler de acción de
servidor tampoco tiene dispatcher si nunca lo invoca un render RSC.
