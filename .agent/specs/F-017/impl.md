---
feature: F-017
agente: sdd-implementer
actualizado: 2026-08-27T08:20:00Z
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

> **Resuelto en el Ciclo 3 (etapa 2).** Las dos rutas que faltaban
> (`src/components/store/BranchList.tsx`,
> `src/features/cart/components/BranchSwitchNotice.tsx`) ya existen —la
> etapa 2 las creó— y `bash .agent/verify.sh F-017 --full` da `0` de punta a
> punta, `harness` incluido, en cuatro corridas de ese ciclo. Queda esta
> nota como historial, no como bloqueo vigente.

---

# Ciclo 3 — Etapa 2 (criterios 2, 6)

> Plan firmado por el humano: «comitea etapa 1, abre PR y despues comienza
> con la etapa 2» (2026-08-27T04:01:32Z). Los nueve pasos de
> `.agent/specs/F-017/plan.md`, completos. La etapa 1 (arriba) no se tocó.

## Qué se construyó

| Archivo                                                                                                                       | Qué hace                                                                                                                                                                                                                                                         | Paso / criterio      |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/components/store/BranchList.tsx` (+ test), `BranchCard.tsx`                                                              | La `<ul data-branch-picker>` y su tarjeta-enlace: orden DP3 (abiertas · cerradas · suspendidas, alfabético dentro de cada grupo, `Array#sort` estable sobre el orden ya alfabético del resolvedor)                                                               | paso 1, cr. 2        |
| `src/components/store/BranchBar.tsx`                                                                                          | La tira `Estás en … · Cambiar de sucursal` / `Esta sucursal está cerrada. · Ver las otras N sucursales`. Server, 0 bytes de cliente                                                                                                                              | paso 7, cr. 6 (tira) |
| `src/features/storefront/server/resolve.ts` (+ test)                                                                          | `BranchRef` gana `disabledReasonCode`/`disabledMessage`/`disabledAt` (mismo `select`, sin consulta nueva); `BranchResolution` gana `branches?` (los hermanos, cuando `branchCount > 1`) — ver § Desviaciones 1                                                   | paso 1/2/7           |
| `src/features/catalog/server/queries.ts`                                                                                      | `loadPublishedStorefronts()` (antes `loadPublishedBranches`) también agrupa marcas con 2+ sucursales como `selectors`; `getStorefrontBranding()` nuevo (tema del selector, DP4)                                                                                  | paso 2, DP4          |
| `src/app/[slug]/layout.tsx`, `page.tsx`, `p/[productSlug]/page.tsx`                                                           | Modo doble: `kind: "selector"` → cabecera de marca sin `CartBadge` + `BranchList`; `kind: "branch"` → igual que hoy + `BranchBar` cuando `branchCount > 1`                                                                                                       | paso 2, cr. 2, 7     |
| `src/app/[slug]/sucursales/page.tsx` (+ metadata `noindex`, `force-dynamic`/`revalidate=0` literales)                         | El aviso (línea A siempre en el HTML, `<noscript>` F) + `BranchList` variante `switch`                                                                                                                                                                           | paso 7, cr. 6        |
| `src/features/cart/components/BranchSwitchNotice.tsx` (+ test)                                                                | La única isla del feature. `useSyncExternalStore` (no `useState`+`useEffect` — ficha `set-state-en-efecto-prohibido`), lee **una** clave con `readCart()` suelto, nunca `useCart()`/`cartStore.ts`                                                               | paso 7, cr. 6, HS11  |
| `src/features/storefront/server/registry.ts` (+ test)                                                                         | `regroupStoreIntoBrand()`: las cinco escrituras y su orden — ver § Desviaciones 2                                                                                                                                                                                | paso 3, HS8          |
| `src/features/admin/server/mutations.ts` (+ test)                                                                             | `groupStoreIntoBrand()`: llama al registro, revalida (`revalidateStores`/`Storefronts`/`Slugs`) y relee la marca para las URL reales del `200`                                                                                                                   | paso 3               |
| `src/features/admin/server/stores.ts` (+ test)                                                                                | `listGroupCandidates()` (radios, del mismo negocio, no en esta marca), `listBrandBranches()` (hermanas, **sin `storeId`**, HS12), `previewGrouping()` (usa `previewSlug()`, DP5), `ManagedStoreDetail` gana `storefrontId`/`branchCount`/`brandSlug`/`brandName` | paso 3, 5, 6         |
| `src/features/admin/types.ts`, `schemas.ts`, `src/app/api/admin/_lib/respond.ts`                                              | `GroupStoresBody`/`Row`/`Branch`, `BrandBranch`, `GroupCandidate`; dos `AdminWriteResult` nuevos (`different_business`/`already_in_brand` → 409); `groupStoresBodySchema`                                                                                        | paso 3, 4            |
| `src/app/api/admin/stores/[storeId]/branches/route.ts`                                                                        | `POST`: mismo guard/embudo de F-011, autoriza las DOS tiendas por separado                                                                                                                                                                                       | paso 4               |
| `src/features/admin/components/GroupStoresForm.tsx`, `StoreBrandCard.tsx`, `src/app/admin/tiendas/[storeId]/agrupar/page.tsx` | La pantalla de agrupar (radios → vista previa → confirmación) y la Card «Tu marca» del hub                                                                                                                                                                       | paso 5, 6            |
| `src/app/admin/tiendas/[storeId]/page.tsx`                                                                                    | Monta `StoreBrandCard` cruzando `listBrandBranches` (sin id) con `listManagedStores` (con id) para las hermanas administradas — ver § Desviaciones 3                                                                                                             | paso 6, HS12         |
| `prisma/seed.ts::seedStorefront()`                                                                                            | Ya no colisiona si el slug de una fixture agrupable fue reasignado por `groupStoreIntoBrand` — bug real, ver § Desviaciones 5                                                                                                                                    | paso 8/9 (soporte)   |
| `.agent/specs/F-017/smoke.sh`, `visual.mjs`                                                                                   | Etapa 2: agrupar `bodega-uno`+`bodega-dos` de verdad (idempotente entre corridas), criterios 2/6 por `curl`, rechazos 401/403/400, capturas del selector/`sucursales`/`agrupar` (sin confirmar nunca)                                                            | paso 8               |

## Desviaciones

1. **`resolve.ts` y `src/features/catalog/server/queries.ts` crecen más de lo que
   `plan.md` listaba explícitamente para los pasos 1/2/7** (que solo
   mencionaban los componentes nuevos). Necesario porque: (a) `BranchCard`
   necesita `disabledReasonCode`/`disabledMessage`/`disabledAt` por
   sucursal para el Badge "Cerrada ahora" vs "Suspendida" y el motivo del
   cierre — mismo `select`, sin consulta nueva, así que el I6 "exactamente
   dos consultas indexadas" del resolvedor **no se rompe**; (b) `/[slug]/sucursales`
   necesita el nombre y el `storeId` de la sucursal actual **sin** una
   tercera consulta, así que `BranchResolution` (el caso `"branch"`) gana
   `branches?: BranchRef[]` — los mismos hermanos que el resolvedor YA tenía
   en memoria por la misma query que calculó `branchCount`. Nunca se agregó
   una consulta nueva al resolvedor.
2. **Las cinco escrituras de agrupar viven en
   `features/storefront/server/registry.ts::regroupStoreIntoBrand()`, no en
   `features/admin/server/mutations.ts::groupStoreIntoBrand()`** como el
   bloque de código de `architecture.md` § Cómo se escribe sugiere
   literalmente. Motivo, y no es opcional:
   `src/features/storefront/server/boundaries.test.ts` (I6, ya existente, etapa 1) prueba
   por `grep` que **solo** `resolve.ts`/`registry.ts` puede llamar
   `prisma.slug.*` — escribir `prisma.slug.update`/`create` desde
   `mutations.ts` habría puesto ese test en rojo. `mutations.ts::groupStoreIntoBrand()`
   sigue siendo la función pública del panel (como pide `architecture.md` §
   Componentes): autoriza (vía el guard del endpoint), llama al registro,
   revalida y relee — el registro hace las cinco escrituras y devuelve qué
   revalidar.
3. **`listBrandBranches()` nunca devuelve `storeId` (HS12), así que
   "Abrir en el panel" en `StoreBrandCard` no puede construirse ahí.** La
   página del hub (`admin/tiendas/[storeId]/page.tsx`) cruza esa lista
   (nombre + `canonicalSlug`) con `listManagedStores(session)` —que SÍ
   trae `id`, porque ya está scoped a `session.storeIds`— por
   `canonicalSlug`, y solo entonces construye el `href`. Las tres
   condiciones de HS12 se cumplen: `listManagedStores` no cambió de forma
   (solo ganó `id`/`slug`/`name` en el `select` de `Storefront`, ya
   presentes ahí para otros usos), la lectura nueva se autoriza porque el
   admin ya administra la tienda actual de esa marca, y el `storeId` nunca
   sale de `listBrandBranches`.
4. **`regroupStoreIntoBrand()` deriva el slug propio de la sucursal
   principal llamando a `previewSlug()`** (el mismo módulo de HS7), no a
   `uniqueSlug()` directamente con un `fallback` distinto. Es DP5 al pie de
   la letra («la vista previa sale de `previewSlug()` en el servidor, la
   misma función que aplica el `POST`») — con `uniqueSlug(nombre, ...,
{fallback:"sucursal"})` habría sido funcionalmente equivalente en el caso
   común, pero DOS implementaciones distintas del mismo cálculo es
   exactamente la clase de divergencia que la decisión prohíbe.
5. **`prisma/seed.ts::seedStorefront()` gana un caso nuevo, fuera de lo que
   `plan.md` listaba**: si el slug de una fixture ya fue reasignado por
   `groupStoreIntoBrand` (la marca que lo poseía se borró), resuelve el
   `storefrontId` actual del `Store` en vez de intentar crear una marca
   nueva. Es un bug real que encontré ejecutando `npm run seed` después de
   agrupar (P2002/`UniqueConstraintViolation`), no leyendo código — ficha
   `.agent/playbook/seed-storefront-colisiona-con-slug-ya-agrupado.md`.
6. **`GroupStoresForm` ganó `primaryBranchAlreadyExists`**
   (`stores.ts::previewGrouping()`), fuera de lo que `design.md` § 5
   especificaba literalmente (esa tabla asume el caso "todavía no existe").
   Bug real encontrado mirando la captura de `visual.mjs` sobre
   `bodega-central` (que YA tiene un alias vivo, criterio 3): la vista
   previa decía "Todavía no existe" sobre una URL que respondía 200 desde
   la etapa 1. Ahora dice "esta dirección ya existe" / "sin cambios" cuando
   corresponde — sigue siendo el mismo `previewSlug()`, solo que ahora la
   pantalla sabe si el resultado fue "mintado" o "ya existía".
7. **`authorization.ts` no creció**, aunque `architecture.md` § Componentes
   lo lista como "crece". `authorizeStore(session, storeId)` ya es genérica
   — el endpoint la llama dos veces (una por tienda) sin necesitar una
   firma nueva. No hay nada que este archivo necesitara ganar.
8. **`/[slug]/sucursales` se dejó `force-dynamic`**, la opción por defecto
   de `architecture.md` — `design.md` § Coste de cliente deja explícitamente
   la puerta abierta a hacerla `●` (`revalidate = 3600` literal) porque no
   lee nada por petición, y dice "decide el plan". `plan.md` no lo decidió
   explícitamente tampoco, así que se quedó en lo que la arquitectura ya
   tenía escrito — es reversible sin tocar el resto del diseño si alguien
   quiere el KB extra de CDN más adelante.
9. **La agrupación de "sucursal que ya es multi-branch"** (§ "Si B ya era
   una de varias sucursales de su marca" en `architecture.md`) está
   implementada en `regroupStoreIntoBrand()` y cubierta por
   `registry.test.ts`, aunque ningún fixture del seed la ejercita en
   runtime (`bodega-uno`/`bodega-dos` son ambas de una sola sucursal). Es
   código correcto y probado, no código muerto — pero nadie lo vio pasar
   por un `curl` real en este ciclo.
10. **El guion visual fotografía la pantalla de agrupar SIN confirmar
    nunca** (usa `bodega-central` + `tienda-demo` como candidatas reales,
    pero nunca hace clic en «Sí, agrupar las dos tiendas»): es la única
    forma de tener algo que fotografiar sin gastar una tercera fixture de
    un solo uso. La pantalla de RESULTADO (tras el `200`) no tiene captura
    propia — anotado en `progress.md` § Notas para quien retome.

## Comandos ejecutados

- `bash .agent/verify.sh F-017` → **0** (typecheck·lint·format·test), varias
  veces a lo largo del ciclo, última línea `PASA`.
- `bash .agent/verify.sh F-017 --full` → **0** en `harness·typecheck·lint·
format·prisma·build·theme·bundle` (dos corridas limpias al cierre). El
  presupuesto de bundle **no subió**: sigue en 182,1 KB de 193 (comprobado
  con `node scripts/check-bundle-budget.mjs` tras `npm run build`).
- `bash .agent/verify.sh F-017 --smoke` → **0**. La primera corrida agrupó
  `bodega-uno`+`bodega-dos` **de verdad y para siempre** (fixtures de un
  solo uso, ya consumidas); una segunda corrida confirmó el camino
  idempotente («ya están agrupadas, no se repite el `POST`»), también en
  **0**.
- `bash .agent/verify.sh F-017 --visual` → **0**, dos veces (la segunda tras
  arreglar la desviación 6). Capturas V06–V10 en `.agent/runs/F-017/shots/`:
  el selector agrupado a 360/1280, `/sucursales` con el aviso, y la
  pantalla de agrupar hasta «Qué va a cambiar» (sin confirmar).
- `npm run seed` **dos veces seguidas después de agrupar** → mismo
  resultado (`{ stores: 23, storefronts: 22, ... }`), y `bodega-uno`/
  `bodega-dos` siguen agrupadas — confirma el arreglo de la desviación 5.
- `bash .agent/specs/F-010/smoke.sh` y `bash .agent/specs/F-011/smoke.sh`
  contra un `next dev` propio (puerto 3100), sin tocar ninguno de los dos
  archivos → **0 aserciones fallidas** en los dos.
- `bash .agent/verify.sh pending F-017` → vacío al cierre: todo fallo del
  ciclo quedó fichado (`seed-storefront-colisiona-con-slug-ya-agrupado`,
  nueva) o descartado con motivo (`typecheck TS2339` propio, dos
  repeticiones más de `testing-library-timeout-1s-bajo-carga`, ninguna
  suya).
- `npx vitest run src/features/cart/components/BranchSwitchNotice.test.tsx`
  suelto, para confirmar el caso E (`localStorage` bloqueado) antes de que
  `vi.resetModules()` + reimport dinámico quedara en la suite completa.

## Deuda dejada

1. **La pantalla de resultado de agrupar** (tras el `200`, con las URL
   reales) no tiene captura propia en `visual.mjs` — solo el estado previo
   a confirmar. Necesitaría una tercera fixture de un solo uso; anotado en
   `progress.md` para quien la agregue.
2. **La agrupación "sucursal ya multi-branch"** está probada por
   `registry.test.ts` pero nunca ejercitada por `smoke.sh`/`visual.mjs`
   contra runtime real (§ Desviaciones 9) — haría falta una TERCERA tienda
   del mismo negocio agrupándose sobre una marca que ya tiene dos.
3. Todo lo que `impl.md` de la etapa 1 ya dejaba anotado (el editor de
   branding de F-011, el anuncio del contrato a cuadrecaja) sigue igual —
   esta etapa no lo tocó.

## Qué necesita quien pruebe

- Entorno: `bash .agent/init.sh` → `ENTORNO LISTO`; `npm run seed` corrido
  al menos una vez **después** de que `bodega-uno`/`bodega-dos` se
  agruparan (si no se ha corrido `--smoke` todavía, agruparlas es lo que
  hace la primera corrida de `smoke.sh`).
- **No agrupes `tienda-demo` con `tienda-dos`** ni ninguna otra combinación
  fuera de `bodega-uno`/`bodega-dos`: romperías el criterio 3 de F-004, el
  `smoke.sh` de F-010 y la medición de `check:bundle`. Y no hay
  desagrupar.
- El slug propio de `bodega-uno` es `"bodega-uno-2"` (no `"bodega-uno"` —
  colisiona con el de su propia marca). Léelo del `href` real, nunca lo
  hardcodees.
- `bash .agent/verify.sh F-017 --smoke`: **idempotente**. La primera vez
  que corre en un worktree agrupa las fixtures para siempre; las
  siguientes veces solo verifica el estado resultante.
- `bash .agent/verify.sh F-017 --visual`: capturas nuevas V06–V10 en
  `.agent/runs/F-017/shots/`. La pantalla de agrupar se ve hasta «Qué va a
  cambiar» — nunca confirmada por este guion.
- Para probar la pantalla de agrupar a mano sin gastar una fixture:
  `node scripts/mint-sso-token.mjs --stores=seed-tienda-4,seed-tienda-1`
  (Bodega Central + tienda-demo, mismo negocio, marcas distintas) y entra a
  `/admin/tiendas/<id-de-bodega-central>/agrupar` — **no confirmes** si
  quieres poder repetir la prueba.
- `previewGrouping()`/`previewSlug()` son el contrato de la vista previa:
  si algún día cambia su forma, `GroupStoresForm` tiene que volver a leerse
  entero, no solo el campo nuevo.

## Code review

Pasé el skill `code-review` (nivel `high`) sobre el diff completo de esta
etapa antes de cerrar. Tres hallazgos, los tres reales y arreglados:

1. **`BranchSwitchNotice.tsx` cacheaba la primera lectura de un `storeId`
   para siempre**, en un `Map` a nivel de módulo — un remonte por
   navegación cliente (un `<Link>` de `BranchBar`, no una recarga dura)
   seguía leyendo el snapshot de la PRIMERA vez que ese `storeId` se vio en
   esta pestaña, aunque el carrito hubiera cambiado. Arreglo: el caché pasó
   a un `useRef` (vive y muere con la instancia del componente), que sigue
   dando la referencia estable que `useSyncExternalStore` exige dentro de
   un mismo montaje, pero se reinicia en cada montaje nuevo.
2. **`regroupStoreIntoBrand()` no revalidaba a los hermanos que se quedan**
   en la marca vieja de la tienda que se une, cuando esa marca ya tenía más
   de una sucursal. Si esa marca pasa de 2 a 1 sucursal, el canónico de la
   que queda cambia (de su propio slug al de la marca) sin que se escriba
   su fila — exactamente la clase de cambio de resolución sin escritura que
   `slugTag` existe para cubrir. Arreglo: el `select` de la tienda que se
   une ahora trae el `slug` de sus hermanos, y `regroupStoreIntoBrand()` los
   suma a `canonicalSlugs`/`slugValues` cuando esa marca no era de una sola
   sucursal. `registry.test.ts` gana la aserción.
3. **`GroupStoresForm`'s inline `ref={(el) => el?.focus()}`** re-enfocaba el
   `<h2>` del resultado en CADA re-render de esa rama, no solo al montarla —
   robándole el foco a quien ya se había movido. Arreglo: `useRef` +
   `useEffect` con `[phase.kind]` como dependencia, que enfoca una sola vez,
   exactamente en la transición a `"done"`.

Verificado después de los tres arreglos: `verify.sh F-017` (sin flags),
`--full`, `--smoke` y `--visual` → `0` cada uno, de nuevo.

## Corrección tras `sdd-tester` — revalidación incompleta al agrupar/re-agrupar

`sdd-tester` dio **`no-listo`** con severidad **ALTA**, con repro completa en
`tests.md` § Fallos encontrados #1 y #2: `regroupStoreIntoBrand()` no
revalidaba (a) el slug de la marca de `joining` cuando esa marca **no** era
de una sola sucursal (se queda rancio para siempre si esa marca se encoge a
una sola sucursal), ni (b) las hermanas **preexistentes** de la marca
primaria cuando llega un miembro nuevo. La corrección del hallazgo 2 de
`code-review` (§ arriba) resolvía solo la mitad — las hermanas que se
**quedan** en la marca de `joining`, nunca el slug de esa marca en sí ni las
hermanas de la marca **primaria**.

**Por qué mi propio test no lo pescó**: cubría el caso simétrico al que
`code-review` señaló (hermanas restantes del lado de `joining`), pero nunca
afirmaba nada sobre `joiningBrandSlug` mismo ni sobre las hermanas
preexistentes del lado de `primary` — exactamente los dos casos que
`sdd-tester` reprodujo. Es la primera cosa que arreglé, no la última.

**Arreglo**, en `src/features/storefront/server/registry.ts::regroupStoreIntoBrand()`:

1. El `select` de `primary` ahora trae también `storefront.stores` (con su
   `slug`) — la lista de A tal como estaba **antes** de esta escritura, igual
   que ya se hacía para `joining`.
2. `touchedSlugValues` (unificado: antes había una lista para `canonicalSlugs`
   y otra, distinta, para `slugValues` — ahora es la MISMA, porque todo lo
   que puede cambiar de significado necesita las dos invalidaciones) incluye:
   `primaryBrandSlug`, `primaryOwnSlug`, `joiningOwnSlug`,
   `primaryExistingSiblingSlugs` (las hermanas que A ya tenía, siempre — es
   `[]` si A no tenía ninguna) y, cuando la marca de `joining` no era de una
   sola sucursal, `joiningBrandSlug` **y** `remainingSiblingSlugs` (ya
   presente desde el `code-review`, ahora junto al slug de la marca misma).

**La prueba que lo habría pescado** (y que falla antes del arreglo, verificado
revirtiendo el archivo y confirmando el fallo antes de restaurarlo):
`registry.test.ts` gana la aserción que faltaba en el test ya existente
(`.toContain("otra-marca")`, el slug de la marca que se encoge) y un test
nuevo, `"three branches across two brands (sdd-tester's exact repro)"`, que
replica la carga exacta del reporte (D ya tiene a B; se une E; se afirma que
el slug propio de B — la hermana preexistente — entra en la revalidación).

**Más de lo mismo, encontrado buscando**: `setStoreEnabled()` (el
interruptor público, HD10-HD15) tenía **la misma clase de agujero** — un
cambio de estado (`PUBLISHED`↔`SUSPENDED`) dentro de una marca
multi-sucursal solo revalidaba el canónico de la propia tienda, nunca el
slug de la marca ni el de las hermanas, así que el selector y la
`/sucursales` de una hermana seguían mostrando el Badge viejo hasta que el
piso de 3600s expirara. Arreglado en `mutations.ts::setStoreEnabled()`: si
`updated.storefront.stores.length > 1`, además de `revalidateStores([canonical])`
ahora llama `revalidateSlugs([brandSlug, ...siblingSlugs])`. `STORE_CANONICAL_SELECT`
gana `slug: true` en su `stores` anidado (antes solo `id: true`) para poder
leer esos slugs sin una consulta nueva. Dos tests nuevos en
`mutations.test.ts` (uno confirma que el caso de una sola sucursal **no**
llama a `revalidateSlugs`, el otro confirma la lista exacta en el caso
multi-sucursal); confirmado que el segundo falla sin el arreglo, igual que
el de `registry.test.ts`. Ficha nueva:
`.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`
— no la pesca el sensor (el criterio simple, de una sola llamada, no la
ejercita), así que queda escrita para que la próxima función que toque una
marca multi-sucursal se pregunte por las hermanas antes de escribir el
array de revalidación.

**Verificado por el camino que revalida, no con `psql`** (`smoke.sh`, nueva
sección "etapa 2: repro de sdd-tester"): cuatro tiendas creadas por el sync
(`grp2-primary-*`, `grp2-joining-*`, `grp2-shrink-*`, `grp2-third-*`, nunca
`bodega-uno`/`bodega-dos`/`tienda-demo`/`tienda-dos`), la MISMA secuencia de
tres llamadas que `sdd-tester` reprodujo, y `curl` de cada URL afectada
inmediatamente después de cada `POST`/`PUT` — sin esperar nada. Las dos
aserciones `[ALTA #1]`/`[ALTA #2]` y las dos de `setStoreEnabled` están en
verde contra un servidor real.

No busqué exhaustivamente en el resto del código — los otros escritores de
`revalidateStores`/`Storefronts`/`Slugs` (`src/features/sync/server/processBatch.ts`,
`availability.ts`) tocan una sola tienda por evento y nunca cambian de qué
marca es miembro, así que no comparten esta clase de agujero; no los toqué.

## Preguntas al humano

Ninguna. HS10–HS12 (las tres decisiones de esta etapa) ya estaban
contestadas antes de empezar a implementar (`.agent/progress/F-017.md` §
Decisiones tomadas) y este ciclo no encontró ninguna decisión de producto
sin cerrar — los dos bugs que sí encontró (§ Desviaciones 5 y 6) eran de
implementación, no de producto.

---

# Ciclo 4 — la tercera instancia (encargo autocontenido, sin agente anterior disponible)

> Encargo del humano/orquestador: arreglar **solo** la tercera instancia del
> defecto de revalidación que `sdd-tester` dejó descrita y sin tocar en
> `tests.md` § Fallos encontrados #3 (severidad ALTA) — un evento `STORE` de
> rutina del sync sobre una sucursal de una marca multi-sucursal no
> revalidaba ni el selector de la marca ni ninguna hermana. El pedido no era
> "arreglar el tercer sitio": era construir el embudo que hace **imposible**
> una cuarta aparición del mismo patrón, porque tres escritores sin relación
> entre sí cayendo en el mismo hueco significa que el hueco no vive en
> ninguno de los tres.

## Qué se construyó

| Archivo                                                                              | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                  | Por qué                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/storefront/server/registry.ts`                                         | `expandBrandTouch(brandSlug, members)` — la única función que expande "una marca y su lista de miembros (con su `slug` propio)" a "todo lo que hay que revalidar": el slug de la marca más el slug propio de cada miembro. `regroupStoreIntoBrand()` se refactorizó para usarla (dos llamadas, una por cada marca que puede seguir existiendo tras el `$transaction`, fundidas en un solo array) en vez de su `.map()`/`.filter()` propio | El embudo — "una sola función que expanda «tiendas tocadas» → «todos los slugs cuyo significado cambia»"                                                      |
| `src/features/admin/server/mutations.ts::setStoreEnabled()`                          | Llama a `expandBrandTouch()` en vez de su `.map((s) => s.slug).filter(...)` inline                                                                                                                                                                                                                                                                                                                                                        | Todos los escritores pasan por el embudo                                                                                                                      |
| `src/features/sync/server/handlers/store.ts::handleStore()`                          | **La corrección real**: el `select` de `existing.storefront.stores` gana `slug: true` (antes solo `id: true` — cero consultas nuevas, mismo query); una función local `siblingTouch()` llama a `expandBrandTouch()` cuando la marca tiene más de una sucursal renderizable, y AMBAS ramas de actualización (el opt-out que suspende y el opt-in que publica/actualiza) reportan el resultado en `HandlerOutcome.touchedSlugValues`        | El sitio con archivo:línea que `tests.md` § 4 reportó                                                                                                         |
| `src/features/sync/server/handlers/types.ts`                                         | `HandlerOutcome` gana `touchedSlugValues?: string[]`                                                                                                                                                                                                                                                                                                                                                                                      | El handler necesita un canal para reportar lo que `expandBrandTouch` calculó                                                                                  |
| `src/features/sync/server/processBatch.ts`                                           | Un `Set<string>` nuevo (`touchedSlugValues`) acumula lo que cada evento reporta; se funde en la MISMA llamada a `revalidateSlugs` que ya existía (`new Set([...touchedStores, ...touchedSlugValues])`) — nunca una llamada nueva por evento                                                                                                                                                                                               | "Cache invalidation happens once per affected store at the end, not per event" — el doc comment de este archivo, que la corrección respeta al pie de la letra |
| `src/features/storefront/server/boundaries.test.ts`                                  | Segundo `describe` ("revalidation funnel boundaries (I5/R18)"): greppea, fuera de `registry.ts`, la forma exacta del bug (`.map((x) => x.slug)` sobre una colección de sucursales/miembros)                                                                                                                                                                                                                                               | El test de frontera que impide la cuarta instancia — pedido explícito del encargo                                                                             |
| `src/features/sync/server/handlers/store.test.ts`                                    | Tres tests nuevos: el caso concreto (dos sucursales, un evento de rutina sobre una, el `touchedSlugValues` esperado), el mismo caso por la rama de opt-out, y el caso de una sola sucursal (no reporta nada)                                                                                                                                                                                                                              | Prueba de unidad, la más rápida de las dos que piden "que falle antes del arreglo"                                                                            |
| `src/features/sync/server/processBatch.test.ts` (nuevo archivo — no existía)         | Tres tests: el caso concreto a nivel de lote (revalida la sucursal tocada, la marca Y la hermana, en una sola llamada), el caso de una sola sucursal (no agrega nada), y el caso de DOS eventos del mismo lote que tocan la misma marca (una sola llamada deduplicada)                                                                                                                                                                    | La aserción a nivel de `processCatalogBatch()`, donde vive el requisito de "una sola llamada por lote"                                                        |
| `.agent/specs/F-017/smoke.sh`                                                        | Nueva sub-sección al final del bloque "etapa 2: repro de sdd-tester": reutiliza las fixtures `grp2-*` ya creadas (D tiene D/B/E), envía un evento `STORE` de rutina renombrando a B, y comprueba con `curl` inmediato que el SELECTOR de D y la propia `/sucursales` de la hermana E traen el nombre nuevo                                                                                                                                | La prueba en runtime real, contra Postgres de verdad, del caso exacto que `tests.md` § 4 reprodujo                                                            |
| `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md` | Actualizada (no re-creada): la tercera instancia, la sección nueva "Por qué tres sitios que no se conocen fallando igual no es 'tres bugs'" (el embudo, no el parche), y el `arreglo`/`firma` del frontmatter apuntando a `expandBrandTouch()` y al test de frontera                                                                                                                                                                      | Pedido explícito del encargo: "la ficha vale más describiendo la solución estructural que tres parches"                                                       |

## Por qué la expansión no añade una consulta por tienda tocada

El encargo pedía decirlo con el número si hacía falta una consulta nueva por
tienda tocada en un lote de 500 eventos — **no hace falta ninguna**. La
única consulta que ya existía en `handleStore()` (`prisma.store.findUnique`
sobre `existing`) ya traía `storefront.stores` completo (para contar
`brandBranchCount`); el único cambio al `select` fue pedirle `slug` a esa
colección además de `id` — mismo _round-trip_, más columnas del mismo `SELECT`.
`expandBrandTouch()` es aritmética pura sobre lo que esa consulta ya devolvió.
A nivel de lote, `processBatch.ts` sigue disparando **una** llamada a
`revalidateSlugs` por lote (no una por evento): el `Set<string>` nuevo se
funde con el que ya existía antes de la única llamada al final, exactamente
como el doc comment del archivo ya prometía. Verificado con
`processBatch.test.ts`'s tercer caso (dos eventos de la misma marca en un
lote → una sola llamada, deduplicada).

## Desviaciones

Ninguna respecto de lo que el encargo pedía. Dentro de "cómo" (no "qué"):

1. **`regroupStoreIntoBrand()` se refactorizó para usar `expandBrandTouch()`**
   aunque el encargo solo pedía arreglar el tercer sitio — no estaba roto.
   Lo hice porque el pedido explícito era "una sola función" y "todos los
   escritores pasan por ella": dejar la lógica ya arreglada de
   `regroupStoreIntoBrand()` con su propio `.map()`/`.filter()` en paralelo
   al de `expandBrandTouch()` habría sido DOS implementaciones del mismo
   cálculo — la clase de divergencia que `impl.md` (etapa 2, desviación 4)
   ya señaló como prohibida en otro contexto (DP5). Verificado con
   `registry.test.ts` sin tocar: los tres tests existentes de
   `regroupStoreIntoBrand()` (incluida la aserción exacta
   `.toEqual(["la-rampa", "la-rampa-vedado", "tienda-dos"])`) pasan
   idénticos con la nueva implementación.
2. **El test de frontera vive como un segundo `describe` en el
   `boundaries.test.ts` que ya existía**, no en un archivo nuevo — mismo
   mecanismo de grep, mismo directorio, "del estilo de los que ya existen"
   tal como pedía el encargo. Su lista de archivos permitidos
   (`REVALIDATION_ALLOWED_FILES`) es independiente de la de I6
   (`ALLOWED_FILES`): son dos invariantes distintas que comparten técnica,
   no una.
3. **No añadí `expandBrandTouch()` a la lista de `ALLOWED_FILES` de I6** — no
   hacía falta, `registry.ts` ya está ahí desde la etapa 1.

## Comandos ejecutados

- `bash .agent/verify.sh F-017` → **0** (typecheck·lint·format·test), última
  línea `PASA`, varias veces a lo largo del ciclo.
- `bash .agent/verify.sh F-017 --full` → **0** en las nueve etapas
  (`harness` incluido, tras corregir tres referencias abreviadas a
  `src/features/sync/server/handlers/store.ts` en `progress/F-017.md` — mías, las arreglé).
- `bash .agent/verify.sh F-017 --smoke` → **0**, con la nueva sub-sección de
  `smoke.sh` (instancia 3) en verde contra Postgres real.
- `bash .agent/verify.sh F-017 --visual` → **0**, sin capturas nuevas (este
  ciclo no toca nada visible).
- **La prueba que pide el encargo, hecha dos veces, a dos niveles**:
  - Unitario: revertí `src/features/sync/server/handlers/store.ts` (quité
    las dos líneas que reportan `touchedSlugValues`) y
    `src/features/sync/server/processBatch.ts` (volví
    `revalidateSlugs(touchedStores)` a como estaba) por separado; en los dos
    casos `npx vitest run` de los archivos de prueba nuevos falló con la
    aserción exacta que se esperaba (`expected undefined to deeply equal
[...]`, `expected ['bodega-dos'] to deeply equal [...]`); restauré con el
    backup y confirmé `diff` vacío antes de continuar.
  - En vivo, contra un servidor real (`next dev` en el puerto 3100, Postgres
    de docker): con el arreglo de `src/features/sync/server/handlers/store.ts` neutralizado
    (`siblingTouch()` devolviendo siempre `undefined`, para no romper lint),
    corrí `.agent/specs/F-017/smoke.sh` a mano — las DOS aserciones nuevas
    (`[ALTA #3]`, selector de la marca Y `/sucursales` de la hermana) dieron
    `SMOKE FAIL`. Restauré el archivo, esperé el hot-reload de `next dev`,
    repetí — las dos en verde, `0 aserciones fallidas`. La primera vez que
    até la aserción de la hermana fallé en darle una lectura previa a su
    página (caché fría, no revalidación) y la aserción "pasaba" incluso sin
    el arreglo — lo detecté, corregí `smoke.sh` para precalentar esa
    resolución ANTES del evento, y confirmé que entonces sí falla sin el
    arreglo (documentado también en el comentario del propio `smoke.sh`).
- `bash .agent/specs/F-010/smoke.sh` y `bash .agent/specs/F-011/smoke.sh`,
  contra el mismo servidor manual, sin tocarlos → **0 aserciones fallidas**
  en los dos.
- `npm test` → **415 passed** (era 408/415 según el punto del ciclo; los
  seis tests nuevos son los de `src/features/sync/server/handlers/store.test.ts` (3) y
  `processBatch.test.ts` (3, archivo nuevo)).
- `bash .agent/verify.sh pending F-017` → vacío al cierre: los cuatro fallos
  de este ciclo (un flaky ya fichado, un `TS2345` de mi propia fixture, un
  `no-unused-vars` de mi propia prueba de reversión, y el mismo flaky una
  segunda vez) quedaron descartados con motivo — ninguno dio lección nueva
  más allá de la ficha que ya se actualizó arriba.

## Deuda dejada

Ninguna nueva. Lo que ya estaba anotado en el ciclo 3 (la pantalla de
resultado de agrupar sin captura propia, "sucursal ya multi-branch" sin
runtime real, y los pendientes de F-011/el anuncio del contrato) sigue
igual — este ciclo no lo tocó.

## Qué necesita quien pruebe

- Todo lo que `impl.md` de los ciclos 1-3 ya dejaba escrito (fixtures,
  entorno, `SYNC_TOKEN`, el `--smoke` idempotente) sigue vigente sin
  cambios.
- El repro exacto de `tests.md` § 4 se puede reconstruir con **cualquier**
  marca de dos o más sucursales creada por el sync (nunca
  `bodega-uno`/`bodega-dos`/`tienda-demo`/`tienda-dos` para no interferir
  con otros criterios) — mandar un segundo evento `STORE` con el mismo
  `storeId` externo, `publishToStore` sin cambiar y un `name`/`city`
  distinto, y comprobar con `curl` inmediato tanto el slug de la marca como
  el de cualquier hermana.
- `.agent/specs/F-017/smoke.sh` ya lo cubre de punta a punta (nueva
  sub-sección al final del bloque de agrupar), así que no hace falta
  repetirlo a mano salvo para confirmar la reproducción con severidad ALTA
  específicamente.
- El test de frontera nuevo (`boundaries.test.ts`, segundo `describe`)
  falla si un futuro escritor reconstruye el patrón viejo — si algún día
  hay que AÑADIR un cuarto escritor legítimo que necesite expandir una
  marca a sus miembros por otra razón (no revalidación), añádelo a
  `REVALIDATION_ALLOWED_FILES` explicando por qué, no lo dejes pasar en
  silencio.

## Preguntas al humano

Ninguna. El encargo era autocontenido, la causa y el arreglo estaban
descritos con archivo:línea y repro exacta en `tests.md` § 4, y no encontré
ninguna decisión de producto sin cerrar en el camino — solo una corrección a
mi propia prueba de humo (precalentar la caché de la hermana antes del
evento, o el falso verde de siempre) que anoté arriba, no una pregunta.

---

# Ciclo 6 — endurecer la frontera: detección → imposibilidad (encargo del humano, cierre)

> Encargo: `sdd-tester` midió que `boundaries.test.ts` (segundo `describe`,
> ciclo 4) solo caza **dos de nueve** variantes sintácticas equivalentes del
> patrón que causó las tres instancias del defecto (`tests.md` § 4). El
> pedido era convertir eso de "detección parcial" a "no compila o no pasa
> el lint", eligiendo entre (1) hacer inalcanzable la función de bajo nivel
> fuera de su módulo o (2) una regla de ESLint — sin tocar la lógica del
> embudo ni de los escritores, ya verificados.

## Qué evalué y por qué no elegí ninguna de las dos formas literales

**Camino 1 tal como está escrito** ("no exportar `revalidateStores`/
`revalidateSlugs`/`revalidateStorefronts`, o exportarlas solo hacia el
embudo") no es viable sin tocar los escritores: esas tres funciones de
`lib/cache.ts` también reciben, en las mismas líneas de `mutations.ts`,
`processBatch.ts` y `availability.ts`, arrays que **no** tienen nada que ver
con una marca (un slug canónico suelto, el conjunto mezclado de un lote de
sync). Restringir su importación habría forzado a esos otros llamadores —
sin relación con este defecto — a pasar por el embudo también, o a
reescribir su forma de invalidar caché. Es "mover código de módulo" en el
sentido que el encargo pedía señalar antes de tocar nada.

**Camino 2 tal como está escrito** (`no-restricted-imports` sobre esas
mismas funciones) tiene el mismo problema desde el otro lado: no distingue
"esta llamada es un touch de marca" de "esta llamada es un canónico suelto"
— ambas viven en los mismos archivos. Y una regla `no-restricted-syntax`
que mirara la FORMA del código (en vez de qué se importa) seguiría siendo,
en espíritu, "un grep mejor" — el propio encargo dice que ese no es el
objetivo, y verifiqué que además tendría falsos positivos reales: hay
código legítimo hoy (`src/app/[slug]/p/[productSlug]/page.tsx:36`,
`src/features/admin/server/stores.ts:47,157`) que también desestructura o
lee `.slug` dentro de un `.map()` por razones que no tienen nada que ver con
esta expansión.

**Lo que implementé** — con el criterio que el encargo dejaba a mi cargo —
es la garantía que el propio encargo pedía (compile-time, inmune a la
sintaxis) llevada al nivel correcto: no una función inalcanzable, sino un
**tipo inalcanzable**. `expandBrandTouch()` ahora devuelve `SlugTouchSet`
(`src/features/storefront/server/registry.ts`), un tipo nominal (`unique
symbol`, el mismo truco que ya usa `PublicSlug` en `lib/publicSlug.ts` para
el mismo problema en otro punto de este feature). Nada que no haya pasado
por `expandBrandTouch()` puede tener ese tipo — sin que importe la forma
sintáctica del intento de sustituirlo.

## Qué toqué

| Archivo                                                                              | Cambio                                                                                                                                                                                                                                                                                                         | Por qué es seguro (no lógica)                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/storefront/server/registry.ts`                                         | `SlugTouchSet` (tipo nuevo); `expandBrandTouch()` devuelve `SlugTouchSet` en vez de `string[]`; `RegroupResult.revalidate.slugValues` exige `SlugTouchSet`; el `[...expandBrandTouch(...), ...expandBrandTouch(...)]` de `regroupStoreIntoBrand()` se re-castea (comentado) porque el spread erosiona la marca | Solo anotaciones de tipo y un cast en el ÚNICO archivo que ya es el embudo. Cero cambio de comportamiento — el JS emitido es idéntico                                                                                                                         |
| `src/features/sync/server/handlers/types.ts`                                         | `HandlerOutcome.touchedSlugValues` pasa de `string[]` a `SlugTouchSet`                                                                                                                                                                                                                                         | Archivo de tipos compartido, no lógica de ningún escritor. `src/features/sync/server/handlers/store.ts` no cambió una sola línea: su `siblingTouch()` ya devolvía `expandBrandTouch(...)` directamente, así que el tipo más estricto lo satisface sin tocarlo |
| `src/features/storefront/server/boundaries.test.ts`                                  | Comentario del segundo `describe` reescrito: dice que la garantía real es `SlugTouchSet`, que este test es una segunda línea parcial, y enumera qué caza y qué no (la tabla de `tests.md` § 4)                                                                                                                 | Cero cambio a la lógica del test — sigue siendo el mismo `grep`, solo deja de fingir que es la defensa principal                                                                                                                                              |
| `.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md` | Nueva sección "La garantía real: un tipo, no un test que reconozca sintaxis"; `arreglo` del frontmatter reescrito                                                                                                                                                                                              | Documentación                                                                                                                                                                                                                                                 |
| `AGENTS.md` § Prohibiciones                                                          | Una línea nueva: armar a mano el array de slugs a revalidar                                                                                                                                                                                                                                                    | Documentación                                                                                                                                                                                                                                                 |

**Confirmé** que `setStoreEnabled()` (`features/admin/server/mutations.ts`)
y `handleStore()`/`processBatch.ts` no necesitaron ningún cambio de código
—solo se benefician del tipo más estricto que ya cumplían.

## La prueba de que la barrera salta de verdad

Reemplacé temporalmente el cuerpo de `siblingTouch()` en `src/features/sync/server/handlers/store.ts`
por una de las **siete variantes que `boundaries.test.ts` NO caza**
(desestructurada: `storefront.stores.map(({ slug }) => slug).filter(...)`),
sin tocar nada más:

1. `npx vitest run src/features/storefront/server/boundaries.test.ts` →
   **2 passed** — el grep no la detecta, confirmando la medición de
   `sdd-tester`.
2. `npm run typecheck` → **2 errores**, ambos `TS2322: Type 'string[] |
undefined' is not assignable to type 'SlugTouchSet | undefined'`, en las
   dos líneas de `src/features/sync/server/handlers/store.ts` donde se usa el resultado.

Es decir: la variante que el test de frontera deja pasar sin avisar, el
compilador la rechaza. Reverti el archivo inmediatamente después (`git
diff` limpio contra el estado previo, confirmado leyendo `siblingTouch()`)
y volví a correr `verify.sh F-017 --full` → `0`.

## El hueco que queda, dicho explícitamente

`setStoreEnabled()` llama `revalidateSlugs(expandBrandTouch(...))` en la
misma línea, sin guardar el resultado en un campo tipado — no hay dónde
poner el sello `SlugTouchSet`. Ensanchar la firma de `revalidateSlugs()`
para exigirlo ahí habría roto todos sus otros llamadores legítimos (un
canónico suelto, el conjunto mezclado de un lote de sync), que no tienen
nada que ver con una marca — exactamente la clase de "contorsión" que el
encargo pedía evitar. Ese único sitio sigue protegido solo por
`boundaries.test.ts` (parcial, dos de nueve). Queda escrito en la ficha, en
el comentario del test y aquí — no oculto.

## Comandos ejecutados

- `bash .agent/verify.sh F-017` → **0** varias veces mientras iteraba el
  tipo (typecheck·lint·format·test), última línea `PASA`. Un fallo de
  `test` durante el ciclo fue el flaky ya fichado
  (`testing-library-timeout-1s-bajo-carga`, `CheckoutForm.test.tsx`) —
  confirmado no relacionado repitiendo sin cambios y viéndolo pasar.
- `bash .agent/verify.sh F-017 --full` → **0** en las nueve etapas
  (`harness·typecheck·lint·format·test·prisma·build·theme·bundle`).
- `npm test` → **415 passed** (47 archivos) — el mismo número que al cierre
  del ciclo anterior; ningún test cambió de forma, solo se ajustaron
  comentarios de documentación.
- `bash .agent/verify.sh pending F-017` → vacío.
- La prueba de la barrera (arriba): `npx vitest run boundaries.test.ts` en
  verde con la variante peligrosa presente, `npm run typecheck` en rojo con
  la misma variante — confirmando que el tipo, no el grep, es la garantía.

## Desviaciones

Ninguna respecto del encargo. Elegí una tercera implementación técnica (un
tipo nominal) en vez de las dos formas literales que el encargo enumeraba,
razonado arriba (§ Qué evalué), dentro del margen que el propio encargo
daba ("eliges tú con criterio"). No moví código entre módulos, no toqué la
lógica del embudo ni de ningún escritor.

## Deuda dejada

El hueco de `setStoreEnabled()` (§ arriba) — deliberado, documentado en tres
sitios (ficha, `boundaries.test.ts`, aquí), no un olvido.

## Qué necesita quien pruebe

- No hay comportamiento nuevo que probar en runtime: este ciclo es
  puramente de tipos y documentación, cero cambio de JS emitido.
- Para confirmar la barrera de forma independiente: repetir el experimento
  de § "La prueba de que la barrera salta de verdad" con cualquiera de las
  otras seis variantes de `tests.md` § 4 (bloque de llaves, encadenado,
  `for`, `.reduce`, `.flatMap`, función nombrada) contra
  `RegroupResult.revalidate.slugValues` o `HandlerOutcome.touchedSlugValues`
  — todas fallan `typecheck` igual, porque ninguna produce `SlugTouchSet`.
- `.agent/verify.sh F-017 --full` sigue en `0`; no se corrió `--smoke`/
  `--visual` de nuevo porque el cambio no altera ningún comportamiento en
  runtime (solo tipos y comentarios) — si quien prueba quiere confirmarlo
  igual, son los mismos guiones de siempre, sin fixtures nuevas.

## Preguntas al humano

Ninguna. El criterio de elegir entre las dos opciones lo dejó el propio
encargo a mi cargo ("eliges tú con criterio"), y la razón para no usar
ninguna de las dos formas literales queda escrita arriba, no decidida en
silencio.
