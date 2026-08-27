---
feature: F-017
agente: sdd-implementer
actualizado: 2026-08-27T03:40:00Z
estado: listo
---

> Etapa 1 de dos (criterios 1, 3, 4, 5, 7, 8). Los criterios 2 y 6 (agrupar,
> selector de sucursal, `/[slug]/sucursales`, aviso del carrito) son la etapa
> 2 y **no se tocan aquí** — ver `.agent/specs/F-017/plan.md`.

## Qué se construyó

| Archivo                                                                                                                     | Qué hace                                                                                                                                                                                   | Criterio(s)        |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `src/lib/publicSlug.ts` (+ test)                                                                                            | `PublicSlug` (tipo marcado) y `canonicalSlug()` — la única función que decide el canónico                                                                                                  | paso 1, I5         |
| `src/lib/slug.ts`                                                                                                           | `RESERVED_SLUGS` exportado (+ `sesion-cerrada`, `sucursales`), `isWellFormedSlug` separado                                                                                                 | paso 2, cr.5       |
| `src/lib/storeContact.ts` (+ test)                                                                                          | `presentationContact()` (R14) y `routingWhatsappNumber()` (R15), gemelo de `lib/pricing.ts`                                                                                                | paso 6             |
| `src/lib/cache.ts`                                                                                                          | `storeTag`/`storeCatalogTag` ahora exigen `PublicSlug`; `storefrontTag`, `slugTag`, `revalidateStorefronts`, `revalidateSlugs` nuevos                                                      | paso 1, 5          |
| `prisma/schema.prisma`                                                                                                      | `Storefront`, `Slug`, `SlugKind`; `Store.storefrontId` NOT NULL, `Store.slug` nullable; `Business.slug` nullable                                                                           | paso 3             |
| `prisma/migrations/20260827023801_storefront_slug_registry/migration.sql`                                                   | Migración de 8 pasos a mano (diff + ficha de índices GIN + ficha de checksum drift)                                                                                                        | paso 3             |
| `src/features/storefront/schemas.ts`                                                                                        | `assertProposableSlug()` — rechazo tipado, 0 queries                                                                                                                                       | paso 2, cr.5, cr.8 |
| `src/features/storefront/server/registry.ts` (+ test)                                                                       | `createStorefrontWithStore()` (único escritor de `Slug`/`Storefront`) y `previewSlug()` (HS7)                                                                                              | paso 4, cr.8, HS7  |
| `src/features/storefront/server/resolve.ts` (+ test)                                                                        | `resolvePublicSlug`/`requireResolution` — el resolvedor único, cacheado por `slugTag`                                                                                                      | paso 5, cr.3       |
| `src/features/storefront/server/boundaries.test.ts`                                                                         | Frontera por `grep` (con extracción de llamadas `prisma.*` reales, sin comentarios ni tipos)                                                                                               | paso 4/5           |
| `src/app/api/internal/slug-availability/route.ts` (+ test)                                                                  | `GET` — HS7, contrato aditivo (v3 pendiente de enviar)                                                                                                                                     | paso 11, HS7       |
| `src/features/catalog/server/queries.ts`                                                                                    | `StoreSummary.canonicalSlug` (rename de `slug`), lecturas por `BranchResolution`, `presentationContact`, `getPublishedBranchesForParams` (una consulta por sucursal, no por slug)          | paso 7             |
| `src/app/[slug]/{layout,page,carrito,checkout,p/[productSlug],pedido/[code]}.tsx`                                           | `requireResolution` → `requireStore`; `<link rel="canonical">` en el alias                                                                                                                 | paso 7, cr.3       |
| `src/app/sitemap.ts`                                                                                                        | `getCanonicalStoreSlugs()` — una URL por sucursal, nunca el alias (R22)                                                                                                                    | paso 7             |
| `src/features/sync/server/handlers/{store,product}.ts`                                                                      | `!existing` crea marca + sucursal vía el registro; `touchedStoreSlug`/`touchedBrandSlug` canónicos                                                                                         | paso 8, E9         |
| `src/features/sync/server/{availability,processBatch}.ts`                                                                   | Canónico + `revalidateSlugs`/`revalidateStorefronts`                                                                                                                                       | paso 8             |
| `src/features/orders/server/{quote,read}.ts` (+ tests)                                                                      | Resuelven por el resolvedor, no por `slug`; `routingWhatsappNumber` (R15)                                                                                                                  | paso 9             |
| `src/features/admin/server/{mutations,stores,products}.ts`, `types.ts`, `StoreList.tsx`, `admin/tiendas/[storeId]/page.tsx` | `canonicalOfStore()`, `AdminStoreListItem.canonicalSlug`, enlaces al canónico                                                                                                              | paso 10            |
| `prisma/seed.ts`                                                                                                            | `seedStorefront()`, marca por tienda, fixture de alias vivo (`bodega-central-vedado`), `bodega-uno`/`bodega-dos`, `RESERVED_SLUGS` sembradas; `update` nunca escribe `slug`/`storefrontId` | paso 12            |
| `.agent/specs/F-017/visual.mjs`                                                                                             | Chromium headless a 360/1280 px — criterio 1 e I5 (mismo `data-store` por las dos URL)                                                                                                     | paso 13, cr.1      |
| `.agent/specs/F-017/smoke.sh`                                                                                               | Runtime propio de F-017: criterios 1, 3, 4, 5, HS7, E9                                                                                                                                     | paso 14            |
| `scripts/place-order.mjs`                                                                                                   | Su SQL directo ahora resuelve por marca o por alias (`Storefront`/`Store.slug`), no solo `Store.slug`                                                                                      | paso 14 (F-010)    |
| `src/lib/prisma.ts`                                                                                                         | `max: 5` en el pool de `pg` — ver § Desviaciones                                                                                                                                           | paso 7 (build)     |
| `docs/sync-contract.md`                                                                                                     | Diff de HS7 aplicado (§ Endpoints, ⑥ Disponibilidad de slug, nota en `payload de STORE`, § Cambios requeridos) — **sin enviar**                                                            | paso 15            |

## Desviaciones

1. **`src/lib/prisma.ts` gana `max: 5` en el pool de `pg`.** No estaba en
   ningún documento firmado. Lo forzó un fallo real de `npm run build`
   (`P2037 Too many database connections`, ficha
   `prisma-p2037-too-many-connections-build-static-params`): con Slug/Storefront
   de por medio, cada página de producto resuelve una capa más que antes
   (`resolvePublicSlug` + `loadStore`), y el build local (sin pooler delante
   de Postgres) agotaba `max_connections=100` bajo la concurrencia de los
   workers de Next. No es un cambio de arquitectura ni de comportamiento —
   es un techo explícito más bajo que el implícito de `node-postgres`
   (10) — y detrás de Supavisor en producción es un piso, nunca un cuello de
   botella. Lo anoto igual porque toca un archivo fuera de lo que el plan
   listaba.
2. **`getStoreBySlug`/`requireStore`/`getStoreCatalog`/`getStoreRates` toman
   `Pick<BranchResolution, "storeId" | "canonicalSlug">`, no la unión
   completa `BranchResolution`.** `architecture.md` escribe la firma como
   `requireStore(canonical: PublicSlug)`; implementarla así habría obligado
   a re-resolver por slug dentro de `src/features/catalog/server/queries.ts` para
   encontrar el `storeId` — exactamente el "quinto resolvedor" que I6
   prohíbe, y que mi propio `boundaries.test.ts` habría cazado. El tipo más
   estrecho es estructuralmente compatible con `BranchResolution` (todo
   llamador real le pasa uno), así que ningún call site cambió; solo
   permite además pasar el objeto liviano de
   `getPublishedBranchesForParams()` sin inventar un segundo tipo.
3. **`getPublishedStoreSlugs()` cambia de forma dos veces**: primero para
   devolver `PublicSlug[]` con canónico+alias (no solo canónico), después se
   le añade `getCanonicalStoreSlugs()` (solo canónico, para `sitemap.ts`,
   R22) y `getPublishedBranchesForParams()` (agrupado por sucursal, para el
   `generateStaticParams` de la ficha de producto). `architecture.md` no
   anticipa esta división en tres; surgió al notar que `sitemap.ts` no
   puede reusar la lista de pre-renderizado tal cual sin listar el alias
   (violaría R22) y al perseguir el bug de conexiones del punto 1.
4. **El seed añade `prisma.slug.upsert()` en la fixture del alias
   (`bodega-central-vedado`)**, que `architecture.md` § `prisma/seed.ts` no
   menciona explícitamente. Sin esa fila el alias escribe `Store.slug` pero
   **no resuelve nada** — `resolvePublicSlug` solo lee `Slug`, nunca
   `Store.slug` directamente (I6) — y el criterio 3/E2 habría quedado
   probando una rama muerta. Lo descubrí verificando en runtime, no
   leyendo el código: `curl` a `/bodega-central-vedado` daba 404 hasta este
   fix.
5. **No se tocó `src/features/sync/server/handlers/misc.ts`** (categoría/moneda/tasa): ningún
   criterio de F-017 los alcanza y no leen ni escriben `Slug`/`Storefront`.

## Comandos ejecutados

- `npx prisma validate` → 0.
- `npm run db:deploy` (`prisma migrate deploy`) → aplicó
  `20260827023801_storefront_slug_registry` sin drift.
- `npm run seed` (dos veces seguidas) → mismos conteos, idempotente:
  `{ stores: 6, storefronts: 6, canonical: 17, aliases: 20, products: 26 }`
  antes de las pruebas manuales que añadieron tiendas vía sync.
- `bash .agent/verify.sh F-017` → **0** (typecheck·lint·format·test), última
  línea `PASA`.
- `bash .agent/verify.sh F-017 --only prisma|build|theme|bundle` → **0** cada
  una (ver § Desviaciones sobre por qué se corrieron sueltas y no con
  `--full`).
- `bash .agent/verify.sh F-017 --smoke` → **0**, `.agent/specs/F-017/smoke.sh`
  propio (criterios 1, 3, 4, 5, HS7, E9).
- `bash .agent/verify.sh F-017 --visual` → **0**, primera vez que la etapa
  `visual` corre en este repo de verdad; capturas en
  `.agent/runs/F-017/shots/` (V01–V05).
- `bash .agent/specs/F-010/smoke.sh` y `bash .agent/specs/F-011/smoke.sh`
  contra el mismo servidor → **0 aserciones fallidas** en las dos, sin tocar
  ninguno de los dos archivos.
- `node scripts/place-order.mjs`, `--store=tienda-dos --delivery`,
  `--idempotent`; `node scripts/send-store-batch.mjs --store=<nuevo>`;
  `node scripts/send-availability-batch.mjs`; `curl` manual de
  `/api/internal/slug-availability` en sus cinco casos (libre, tomado,
  reservado, propio, sin token, sin query) — todos con el resultado que
  `architecture.md` predice.
- `npm run build | grep '\[slug\]'` → `/[slug]` y `/[slug]/p/[productSlug]`
  siguen `●`.
- `bash .agent/verify.sh pending F-017` → vacío: todo fallo de este ciclo
  quedó fichado o descartado.

## Deuda dejada

Ninguna deliberada dentro del alcance de la etapa 1. Lo que sigue es lo que
el plan ya anotaba como trabajo de otro momento:

1. **El editor de branding de F-011 (su criterio 5)** sigue sin construir —
   F-017 le deja el sitio (`Storefront.themeTokens`/`logoUrl`/`coverUrl`/
   `contactX`), pero el endpoint de escritura, la tarjeta 2b y la URL del
   editor son trabajo del ciclo que descongele F-011 (ya anotado en
   `.agent/progress/F-017.md`).
2. **El anuncio del contrato a cuadrecaja no se envió** — el diff de
   `docs/sync-contract.md` está aplicado en la rama (§ Endpoints, ⑥
   Disponibilidad de slug, la nota en `payload de STORE`, la línea en §
   Cambios requeridos), pero comunicarlo es una acción del humano, no mía.
3. **Los `Store.slug` de agrupar (etapa 2)** no se emiten aquí: la
   invariante «una marca con más de una sucursal exige que todas tengan
   `slug` no nulo» la hace cumplir `groupStoreIntoBrand`, que no existe
   todavía.

## Qué necesita quien pruebe

- Entorno: `bash .agent/init.sh` → `ENTORNO LISTO`; `npm run seed` corrido
  (idempotente, seguro repetir).
- Fixtures nuevas de esta etapa: `bodega-central` (marca) con su sucursal en
  `bodega-central-vedado` (alias vivo, kind `STORE` en el registro);
  `bodega-uno` y `bodega-dos` (de un solo uso, para agrupar en la etapa 2 —
  **no las agrupes verificando esta etapa**, romperías el criterio 3 de
  F-004, el `smoke.sh` de F-010 y `check:bundle`).
- `SYNC_TOKEN` de `.env` para el servicio de slug y los scripts de sync.
- El guion de humo propio: `bash .agent/verify.sh F-017 --smoke` (usa
  `docker exec` sobre el contenedor `queandabuscando-postgres` para las
  restricciones de base de los criterios 4/5 — nunca para cambiar algo que
  una página tenga que reflejar).
- El guion visual: `bash .agent/verify.sh F-017 --visual`; capturas en
  `.agent/runs/F-017/shots/`.
- Frágil, y por qué: el build local (`npm run build`) es sensible a cuántas
  conexiones tiene libres Postgres en ese momento — si algo más está
  conectado a la base de desarrollo (otro worktree, un `psql` abierto), el
  `max: 5` del pool ayuda pero no es infinito. Si `build` vuelve a fallar
  con `P2037`, la ficha del playbook tiene el diagnóstico y el arreglo de
  las dos mitades.
- El servicio `GET /api/internal/slug-availability` es contrato: su forma
  exacta (los seis `reason`, `reserving` siempre `false`) está fijada por
  `architecture.md` § El servicio de disponibilidad de slug y no debería
  cambiar sin volver a ese documento.

## Preguntas al humano

Ninguna nueva. Las que bloqueaban la etapa 1 (HS6–HS9) ya están contestadas
y aplicadas; **AP6** y **DP1–DP5** siguen abiertas pero son de la etapa 2, no
de este cierre.

## Escalado (no es una pregunta, es un aviso)

`bash .agent/verify.sh F-017 --full` no llega a `0`: la etapa `harness`
(`npm run check:harness`) marca 20 referencias de ruta abreviada en
`architecture.md`, `spec.md` y `plan.md` (ficha
`check-harness-falso-positivo-ruta-abreviada`) — documentos que no son míos
(`spec.md`/`architecture.md`/`design.md`/`plan.md` no se editan). Las
mismas abreviaturas en `.agent/progress/F-017.md` **sí** las arreglé (son
mías). Dos de las referencias son distintas: src/components/store/BranchList.tsx (etapa 2, por crear)
y src/features/cart/components/BranchSwitchNotice.tsx (etapa 2, por crear) van con ruta
completa y de verdad no existen todavía — son de la etapa 2 y no se
construyen aquí, así que el check las señala correctamente hasta que esa
etapa los cree. Verifiqué typecheck·lint·format·test·prisma·build·theme·bundle·smoke·visual
uno por uno con `--only`/`--smoke`/`--visual`: los diez salen `0`. Solo
`harness` queda rojo, y por un motivo que no puedo arreglar sin tocar
documentos ajenos. Corresponde al orquestador pedirle al arquitecto (o a
quien tenga `architecture.md`/`spec.md`/`plan.md`) que complete esas rutas,
o decidir que el checker necesita entender abreviaturas — ninguna de las
dos es mía.
