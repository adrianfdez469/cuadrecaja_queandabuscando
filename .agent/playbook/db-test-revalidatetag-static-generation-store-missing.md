---
slug: db-test-revalidatetag-static-generation-store-missing
sintoma: un *.db.test.ts que llama a un route handler o a una mutación real (no mockeada) lanza "Invariant: static generation store missing in revalidateTag ..."
firma: Invariant: static generation store missing in revalidateTag
etapa: test
visto_en: F-022
creado: 2026-09-03T22:12:00Z
promovido_a_agents: no
arreglo: en el .db.test.ts, `vi.mock("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn) => fn }))` antes de importar (dinámicamente) el código que revalida — nunca envolver la llamada real en un intento de simular un request de Next
---

## Qué pasa de verdad

`next/cache`'s `revalidateTag` necesita un "static generation store" — un
contexto que solo existe dentro de un servidor Next real (`next dev`/`next
start` sirviendo la petición). Vitest ejecuta el código directamente en
Node, sin ese contexto, así que cualquier camino que llegue de verdad hasta
`revalidateTag` (el `POST` de `/api/internal/sync/catalog`,
`src/features/admin/server/mutations.ts`'s `setStoreEnabled`, o cualquier
otra mutación que pase por `src/lib/cache.ts`) revienta con este `Invariant`,
aunque el código bajo prueba esté perfecto. Es un artefacto del arnés de
pruebas, no del código: la invalidación de caché en sí ya está cubierta,
mockeada, en `src/features/sync/server/processBatch.test.ts` y en los
`*.test.ts` de cada mutación.

Pasó en F-022 al escribir `storePublishGate.db.test.ts`: el primer intento
llamaba al `POST` real del route de sync y a `setStoreEnabled` real contra
Postgres, y las dos rutas que sí llegaban a escribir (`status: "PUBLISHED"` o
`SUSPENDED`) disparaban `revalidateStores`/`revalidateTag` y reventaban con
este error — un 500 en vez del 207/409 esperado.

## Cómo se arregla

Mockea `next/cache` al principio del `.db.test.ts`, igual que ya hacen
`src/lib/cache.test.ts` y `src/features/storefront/server/resolve.test.ts`
(que no son `db`, pero usan la misma técnica):

```ts
vi.mock("next/cache", () => ({
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

const { POST } = await import("@/app/api/internal/sync/catalog/route");
```

El resto del archivo (Postgres real, `createFixtureSession`, etc.) no
cambia: solo la invalidación de caché queda stubeada, que es exactamente lo
que un test contra Postgres real no necesita demostrar.

## Cuándo NO es esto

Si el mensaje trae otra ruta de Next (no `revalidateTag`) o aparece en un
test que SÍ corre dentro de `next dev` (`smoke`, `visual`), no es esto —
revisa si el servidor de desarrollo realmente levantó (ficha
`next-dev-uno-por-directorio`).

## Cómo se evita

Antes de escribir un `*.db.test.ts` que invoque un `route.ts` completo o una
función de `src/features/admin/server/mutations.ts` que pueda llegar a
escribir `status`, revisa si esa escritura dispara
`revalidateStores`/`revalidateSlugs`/etc. (`src/lib/cache.ts`). Si la
respuesta es sí, mockea `next/cache` desde el principio del archivo — no
hace falta descubrirlo por el fallo.
