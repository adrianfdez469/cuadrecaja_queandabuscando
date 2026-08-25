# 0006 — ISR con revalidación por tag disparada desde el sync

**Aceptada** · 2026-08-25

## Contexto

El público objetivo tiene conexión limitada. Las páginas de tienda deben salir
del CDN, pero reflejar un cambio de precio en minutos, no en horas.

## Decisión

`generateStaticParams` + `revalidate = 3600` como piso, y `revalidateTag` al
terminar cada lote de sync, **una vez por tienda afectada**.

Toda lectura pasa por `lib/cache.ts`, que construye los tags. Un tag mal escrito
produce una página que nunca se actualiza, y ese es el peor bug de notar.

## Por qué no `"use cache"` de Next 16

Está estabilizado, pero requiere `cacheComponents: true`, que cambia la app a
semántica PPR y exige Suspense alrededor de cada lectura dinámica. Es un
compromiso mayor del que un harness debería tomar antes de tener features.

## La trampa

El `matcher` de `src/proxy.ts` **no debe tocar `/[slug]`**. El proxy corre en
cada petición, incluidas las que el CDN serviría de caché; hacer match sobre la
tienda anula toda la estrategia. Es el error más fácil de cometer en este repo y
por eso está escrito en tres sitios.

Además, `export const revalidate` tiene que ser un **literal**: Next analiza los
segment config exports estáticamente y una constante importada rompe el build.
