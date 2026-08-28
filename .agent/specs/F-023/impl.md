---
feature: F-023
agente: sdd-implementer
actualizado: 2026-08-28T18:42:14Z
estado: listo
---

## Qué se construyó

Los 15 pasos de `plan.md`, en orden, tal como fueron firmados. Sin
desviaciones de alcance.

| Archivo                                                                                                                                                                                                                                              | Qué hace                                                                                                                                                                            | Criterio que cubre |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/constants/media.ts`                                                                                                                                                                                                                             | Juego de variantes (anchos, formatos, calidades, topes), `IMAGE_ORIGINAL_BASENAME`, `IMAGE_MAX_PIXELS`, `CATALOG_EAGER_IMAGE_COUNT`                                                 | 1, 3, 5, 6 (base)  |
| `src/lib/imageVariants.ts` (+ `.test.ts`)                                                                                                                                                                                                            | `deriveImageVariants`, `imageObjectNamesFor`, `productObjectPrefix`, `socialImageUrl` — pura, sin entorno                                                                           | 1, 5, 6 (base)     |
| `src/lib/imageEncoder.ts` (+ `.test.ts`)                                                                                                                                                                                                             | Único módulo que importa `sharp`; `.rotate()`, `limitInputPixels`, una decodificación/cuatro codificaciones, nunca lanza                                                            | 1                  |
| `src/lib/boundaries.test.ts`                                                                                                                                                                                                                         | Guarda: nadie más importa `next/image` ni `sharp`; solo `storage.ts` habla con `.storage.from(...)`                                                                                 | 2 (apoya)          |
| `src/lib/supabase/storage.ts`                                                                                                                                                                                                                        | `+uploadStoreObjects`, `+removeStoreObjects`, `+removeStoreObjectsUnder`, `+objectPathOf`; `uploadStoreObject` gana `opts.upsert`                                                   | 1, 5, 6            |
| `src/features/admin/storagePaths.ts` (+ `.test.ts`)                                                                                                                                                                                                  | `objectPathFor` devuelve `.../<uuid>/original.<ext>` (mismo nombre y firma)                                                                                                         | 1, 5               |
| `src/components/ui/ResponsiveImage.tsx` (+ `.test.tsx`)                                                                                                                                                                                              | `<picture>` AVIF/WebP + `<img>` de respaldo, o `<img>` simple para una URL heredada (R11)                                                                                           | 2, 4, 5            |
| `next.config.ts`                                                                                                                                                                                                                                     | `images: { unoptimized: true }`; se van `formats`/`remotePatterns`/`dangerouslyAllowLocalIP`                                                                                        | 2                  |
| `eslint.config.mjs`                                                                                                                                                                                                                                  | `no-img-element` apagado solo en `ResponsiveImage.tsx`                                                                                                                              | —                  |
| `src/components/store/ProductCard.tsx`, `StoreSearchResults.tsx`, `src/app/[slug]/page.tsx`, `src/app/[slug]/p/[productSlug]/page.tsx`, `src/features/admin/components/ImageUploader.tsx`, `ProductTable.tsx`                                        | Los seis puntos que importaban `next/image` pasan a `ResponsiveImage`; `eager`/`priority` en el catálogo; `openGraph` vía `socialImageUrl` (R15); copy de I1 y aviso E3 en el panel | 2, 4               |
| `src/app/api/admin/stores/[storeId]/products/[storeProductId]/images/route.ts`, `src/app/api/admin/_lib/respond.ts`                                                                                                                                  | Etapa de codificación entre el sniff y la subida; `runtime`/`maxDuration` literales; `400 reason:"decode"`                                                                          | 1                  |
| `src/features/admin/server/mutations.ts` (+ `.test.ts`)                                                                                                                                                                                              | `appendProductImage` sube el juego completo o revierte lo subido (R6/E2); `saveProduct` purga tras `commit()`, con `await` (R9/R14)                                                 | 1, 5, 6            |
| `src/features/sync/server/handlers/types.ts`, `src/features/sync/server/handlers/product.ts` (+ `src/features/sync/server/handlers/product.test.ts`), `src/features/sync/server/processBatch.ts` (+ `src/features/sync/server/processBatch.test.ts`) | `HandlerOutcome.purgeObjectPrefix`; solo `DELETE` vacía `imageUrls`; `processBatch` drena tras revalidar, deduplicado (R10, R13, R14)                                               | 6                  |
| `prisma/fixtures/producto-demo.jpg`, `prisma/fixtures/README.md`, `prisma/seed.ts`                                                                                                                                                                   | Foto CC0 real (AP2); `seedProductImages` sube el juego a los 15 productos de `tienda-demo`, directorio determinista + upsert (I5)                                                   | 3                  |
| `scripts/check-image-budget.mjs`, `package.json` (`check:images`)                                                                                                                                                                                    | Mide el candidato AVIF de menor ancho de cada `<picture>`; falla en medición vacía o URL rota (R7/R8)                                                                               | 3                  |
| `.agent/specs/F-023/smoke.sh`                                                                                                                                                                                                                        | Criterios 1, 3, 4, 5, 6 contra servidor + emulador reales                                                                                                                           | 1, 3, 4, 5, 6      |
| `.agent/specs/F-011/smoke.sh`                                                                                                                                                                                                                        | AP1: bloque de `/_next/image` sustituido por el equivalente de F-023; fixtures de la subida en lote y del tope de 8 arregladas (ver Desviaciones)                                   | — (F-011)          |
| `docs/adr/0022-imagenes-derivadas-al-subir.md`                                                                                                                                                                                                       | Pasa de "Propuesta" a "Aceptada"                                                                                                                                                    | 8                  |

## Desviaciones

Ninguna de alcance. Cuatro ajustes menores, todos dentro de la frontera del
plan (arreglar smoke, no criterios):

1. **AP2 resuelta sin bloqueo**: el entorno SÍ tuvo acceso a internet
   (contra lo que el orquestador anticipaba como posible bloqueo). Se buscó
   una foto CC0 verificable —no un placeholder— en Wikimedia Commons
   (`Detergents-department-ramat-gan-supermarket-october-2015.jpg`, autor
   Rakoon, CC0 1.0), redimensionada a 1600 px / ~290 KB y documentada con su
   licencia en `prisma/fixtures/README.md`. Ver § Preguntas al humano (IP1)
   de todos modos, porque la elección concreta de la foto es una decisión de
   producto/imagen de marca que el humano no vio antes de que se subiera.
2. **Entorno: tres secretos faltantes en `.env`** (`SSO_JWT_SECRET`,
   `ADMIN_SESSION_SECRET`, `CRON_SECRET`) bloqueaban `storageAvailability()`
   —que hoy exige el `serverEnv()` completo aunque solo necesite dos de sus
   campos— apenas se llamó desde `prisma/seed.ts` (algo que ningún feature
   anterior hacía). Se generaron valores de desarrollo con `openssl rand` y
   se acuñó `QAB_BEARER_TOKEN` con el token que `npm run seed` imprimió al
   crear `seed-negocio-1`. Es infraestructura de entorno local, gitignored,
   no un cambio de código; lo anoto porque el próximo que retome este
   feature en una copia fresca del repo lo va a necesitar también.
3. **`.agent/specs/F-011/smoke.sh`, más allá del bloque de AP1**: dos
   fixtures adicionales de ESE mismo archivo se rompieron al correr el smoke
   de verdad, por razones que architecture.md no anticipó en su § Qué se
   rompe:
   - Los JPEG sintéticos de "llenar el tope de 8" y "novena imagen" (solo el
     encabezado mágico `FF D8 FF E0` + basura) pasaban el sniff de mime de
     F-011 pero ya no decodifican con `sharp` (la subida ahora exige un
     decode real, SP1). Se sustituyeron por JPEGs mínimos pero reales,
     generados con `sharp({create:...}).jpeg()`.
   - `seedProductImages` (paso 12) deja **siempre** una imagen en los 15
     productos de `tienda-demo`, así que el producto que F-011 usaba para
     "llenar el tope" ya no arranca en 0 imágenes sino en 1. El bucle de 8
     subidas pasó a 7.
   - Un tercer descuido mío propio (no de F-023 sobre F-011): mezclé
     `curl -D -` (cabeceras a stdout) con `-w '%{http_code}'` (que también
     escribe a stdout) al escribir el bloque nuevo de AP1, y el código
     capturado quedó con las cabeceras concatenadas delante. Corregido
     quitando `-D -`, que no hacía falta para ese chequeo.
     Las tres son arreglos de guion, no de código de producto ni de ningún
     `acceptance_criteria`; están dentro de lo que AP1 ya autorizó en espíritu
     ("sustituir el bloque… deja los dos smokes verdes"), y se descubrieron
     corriendo el smoke, no leyéndolo.
4. **`ImageUploader.tsx`**: el diseño describe un badge "Imagen externa"
   para una URL fuera de nuestro bucket. Implementarlo sin importar
   `src/lib/supabase/storage.ts` (que exige el `serverEnv()` completo,
   inservible en un árbol de cliente) exigió una comprobación local con
   `publicEnv.supabaseUrl` en vez de `objectPathOf`. No cambia comportamiento
   observable, solo de dónde sale el dato.

## Comandos ejecutados

- `npm run typecheck` → 0
- `npm run lint` → 0
- `npm run format:check` → 0 (tras `npm run format` en cada punto de
  control)
- `npm test` → 0, 65+ archivos, la suite completa en verde (incluye
  `imageVariants.test.ts`, `imageEncoder.test.ts`, `boundaries.test.ts`,
  `ResponsiveImage.test.tsx`, y los casos nuevos de `mutations.test.ts`,
  `product.test.ts`, `processBatch.test.ts`)
- `bash .agent/verify.sh F-023` → `0` (repetido tras cada paso significativo,
  ver `.agent/progress/F-023.md` § Bitácora para el detalle intento a
  intento)
- `bash .agent/verify.sh F-023 --smoke` → `0`, dos veces seguidas (confirma
  que el smoke —y la siembra que dispara— son idempotentes)
- `bash .agent/verify.sh F-011 --smoke` → `0` (AP1: dejó de estar en rojo)
- `bash .agent/verify.sh F-023 --full` → `0` (harness · typecheck · lint ·
  format · test · prisma · build · theme · bundle)
- `node scripts/check-bundle-budget.mjs` (tras el build) → `0`,
  **176.9 KB** gzip (bajó de 193 KB: criterio 7 se cumple por sustracción,
  tal como architecture.md predijo). `BUDGET_KB` no se tocó.
- `node scripts/check-image-budget.mjs --base=http://localhost:3100
--slug=tienda-demo` → `0`, **241.9 KB** sobre un presupuesto de 300 KB (15
  variantes de tarjeta AVIF, cada una ~16.1 KB, bajo el tope de 20 480 B)
- `npm run seed && npm run seed` → `0` ambas veces; el bucket no acumula un
  segundo juego de objetos en la segunda corrida (verificado a mano listando
  el prefijo del directorio con la API de Storage)

## Deuda dejada

- **Ninguna de código.** Todo lo que el plan pedía quedó implementado y
  verificado.
- **`prisma/fixtures/producto-demo.jpg`** pesa ~290 KB en el árbol de git,
  permanente — el costo que AP2 ya aceptó.
- **Objetos huérfanos que F-011 dejó antes de este feature** siguen sin
  recolectar (fuera de alcance explícito, R11 los hace inofensivos).

## Qué necesita quien pruebe

- Entorno: `docker compose up -d`, `.env` con `SUPABASE_SERVICE_ROLE_KEY` /
  `STORAGE_JWT_SECRET` que **coincidan** con los contenedores que de verdad
  están arriba — en este ciclo los contenedores existentes pertenecían a un
  worktree hermano ya borrado (`conger`) con un secreto distinto; hubo que
  recrearlos (`docker stop/rm` + `docker compose up -d`) para que
  `storageAvailability()` dejara de responder `signature verification
failed`. Si `bash .agent/init.sh` marca el emulador de Storage en rojo,
  sospecha primero de esto, no del código.
- `SSO_JWT_SECRET`, `ADMIN_SESSION_SECRET`, `CRON_SECRET` y
  `QAB_BEARER_TOKEN` tienen que tener valor en `.env` — sin ellos
  `prisma/seed.ts` revienta al llamar `storageAvailability()` (ver
  Desviaciones §2) y el smoke de F-023 no puede mandar el evento DELETE del
  criterio 6.
- `npm run seed` antes de `bash .agent/verify.sh F-023 --smoke` (el propio
  smoke ya lo hace al principio, por las dudas).
- El smoke de F-023 sube y borra imágenes de `seed-tienda-2-p0` (Coca-Cola
  1.5L, tienda-dos) y reemplaza la de `seed-tienda-1-p0` (Refresco de cola
  1.5L, tienda-demo); ambos se restauran solos con `npm run seed`
  (idempotente) o, para `seed-tienda-2-p0`, con el evento de "revivir" que el
  propio guion manda al final (ver el comentario en `smoke.sh` — un `DELETE`
  real no lo deshace `npm run seed`, solo un evento nuevo del sync).
- `scripts/check-image-budget.mjs` asume que React serializa `srcSet` como
  el atributo literal `srcSet` (camelCase) en el HTML estático — HTML lo
  trata igual que `srcset` (insensible a mayúsculas), pero cualquier guion
  nuevo que grep-ee sobre el HTML crudo debe recordar esto o el patrón no
  matchea nada.

## Preguntas al humano

- **IP1** — La foto de `prisma/fixtures/producto-demo.jpg` (AP2) es una
  fotografía real de un pasillo de detergentes de supermercado (CC0,
  Wikimedia Commons, autor Rakoon), no un producto individual. Cumple los
  requisitos técnicos del criterio 3 (real, ≥1200 px, comprime de forma
  representativa) pero no es "bonita" para una demo visual del panel — un
  admin que la vea sabrá que es un placeholder. Si el humano prefiere una
  foto de producto real del piloto (AP2 opción (b), ya recomendada por
  `sdd-architect` como alternativa igual de válida), es un reemplazo de un
  solo archivo sin tocar código; recomiendo mantenerla como está salvo que
  el humano tenga una foto de producto real a mano ahora mismo.
