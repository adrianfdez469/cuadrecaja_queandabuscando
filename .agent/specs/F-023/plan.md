---
feature: F-023
agente: orquestador
actualizado: 2026-08-28T17:49:34Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cuando el admin sube una foto de producto, la app la decodifica una sola vez y
genera al momento cuatro variantes optimizadas (dos tamaños × AVIF/WebP), que
quedan guardadas junto al original en el bucket. La tienda deja de pedirle nada
a Next: cada imagen se sirve directo del CDN de Supabase con un `<picture>` que
el navegador resuelve solo, sin optimizador de por medio y sin JavaScript
nuevo. Quitar una imagen o borrar un producto ya no deja archivos huérfanos.

Lo que no cambia: el flujo de subida del admin (elige archivo → sube →
aparece), el campo `imageUrls` del contrato con cuadrecaja, y las fotos que
F-011 ya subió (siguen sirviéndose, sin variantes, indistinguibles a simple
vista de una tarjeta normal).

## Pasos

Quince pasos: fundamentos puros (1-3), capa de almacenamiento (4-5), servido
(6-8), escritura (9-11), datos de referencia (12-13) y cierre (14-15). **Sin
migración de `prisma/schema.prisma`** — `StoreProduct.imageUrls` no cambia de
forma.

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                                                               | Archivos                                                                                                                                                                                                                                                                     | Criterio                 | Cómo se verifica                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Constantes del juego de variantes (dos anchos, dos formatos, tope por imagen, tope de píxeles, calidades, `CATALOG_EAGER_IMAGE_COUNT`) y la función pura de derivación: de la URL del original a las cuatro variantes, o `null` si es una URL heredada de F-011 (R11)                                                                     | ~ `src/constants/media.ts`; + `src/lib/imageVariants.ts`; + `src/lib/imageVariants.test.ts`                                                                                                                                                                                  | 1, 5, 6 (base)           | `npm test -- imageVariants`: una URL `.../<uuid>/original.jpg` deriva 4 variantes; una URL `.../<uuid>.jpg` (F-011) o ajena al bucket devuelve `null`                                                                                         |
| 2   | El codificador: `sharp` aislado en un módulo propio, `.rotate()` antes de redimensionar, `limitInputPixels` en 80 MP, una decodificación y cuatro codificaciones, nunca lanza                                                                                                                                                             | ~ `package.json` (+ `sharp`); + `src/lib/imageEncoder.ts`; + `src/lib/imageEncoder.test.ts`                                                                                                                                                                                  | 1                        | `npm test -- imageEncoder`: una foto con EXIF rotado sale derecha; una entrada de más de 80 MP devuelve `too_many_pixels`, no revienta memoria; las 4 variantes de un JPEG de prueba están bajo su tope de calidad                            |
| 3   | Guarda de fronteras: nadie bajo `src/` importa `next/image`; solo el codificador importa `sharp`; solo `src/lib/supabase/storage.ts` llama a `.remove(`/`.list(`                                                                                                                                                                          | + `src/lib/boundaries.test.ts`                                                                                                                                                                                                                                               | 2 (apoya)                | `npm test -- boundaries`: falla si se reintroduce cualquiera de las tres cosas                                                                                                                                                                |
| 4   | `src/lib/supabase/storage.ts` gana subida en lote, borrado por claves y borrado por prefijo (listado de dos niveles, ninguno recursivo en la API real); ninguna función nueva lanza                                                                                                                                                       | ~ `src/lib/supabase/storage.ts`; ~ su archivo de test si existe                                                                                                                                                                                                              | 1, 6                     | Test contra el emulador: `uploadStoreObjects` sube 5 objetos o ninguno; `removeStoreObjectsUnder(prefix)` borra un directorio de imagen y dos niveles de objetos planos                                                                       |
| 5   | `objectPathFor` pasa de nombrar un archivo a nombrar un directorio (`.../<uuid>/original.<ext>`); mismo nombre, misma firma                                                                                                                                                                                                               | ~ `src/features/admin/storagePaths.ts`; ~ `src/features/admin/storagePaths.test.ts`                                                                                                                                                                                          | 1, 5 (R11)               | `npm test -- storagePaths`: la expresión regular del primer caso admite el directorio nuevo; el segundo caso (dos llamadas, uuids distintos) sigue pasando sin tocarlo                                                                        |
| 6   | `ResponsiveImage`: componente de servidor que emite `<picture>` con AVIF/WebP + `<img>` de respaldo cuando hay variantes, o un `<img>` simple cuando `deriveImageVariants` devuelve `null` (R11/E9). Cero `"use client"`                                                                                                                  | + `src/components/ui/ResponsiveImage.tsx`; + `src/components/ui/ResponsiveImage.test.tsx`                                                                                                                                                                                    | 2, 4, 5 (base)           | Test: con variantes emite 2 `<source>` + 1 `<img>` de respaldo según D5; sin variantes emite un `<img>` a secas; `priority` cambia `loading`/`fetchpriority`                                                                                  |
| 7   | `next.config.ts` apaga el optimizador (`images.unoptimized: true`) y se van `formats`, `remotePatterns`, `dangerouslyAllowLocalIP`; ESLint deja de avisar `no-img-element` solo dentro de `ResponsiveImage.tsx`                                                                                                                           | ~ `next.config.ts`; ~ `eslint.config.mjs`                                                                                                                                                                                                                                    | 2                        | `npm run build` sin error; `grep -c remotePatterns next.config.ts` → 0; `npm run lint` sin avisos nuevos fuera del archivo acotado                                                                                                            |
| 8   | Los seis puntos que importan `next/image` pasan a `ResponsiveImage`: tarjeta de catálogo (con `eager` en las 4 primeras), las dos rejillas de búsqueda, la ficha de producto (con `openGraph` vía `socialImageUrl`), la galería del panel (copy de I1: quitar ahora borra el archivo, badge "Imagen externa") y la miniatura del listado  | ~ `src/components/store/ProductCard.tsx`; ~ `src/components/store/StoreSearchResults.tsx`; ~ `src/app/[slug]/page.tsx`; ~ `src/app/[slug]/p/[productSlug]/page.tsx`; ~ `src/features/admin/components/ImageUploader.tsx`; ~ `src/features/admin/components/ProductTable.tsx` | 2, 4                     | `grep -rn "next/image" src/` → vacío; `curl -s $BASE/$SLUG \| grep -c _next/image` → 0                                                                                                                                                        |
| 9   | Endpoint de subida: etapa de codificación entre el sniff de mime y la escritura; `runtime`/`maxDuration` literales; archivo corrupto o >80 MP responde `400 decode`, nunca sube nada                                                                                                                                                      | ~ `src/app/api/admin/stores/[storeId]/products/[storeProductId]/images/route.ts`; ~ `src/app/api/admin/_lib/respond.ts` (`invalidFile` gana `"decode"`)                                                                                                                      | 1                        | `curl -F` con una foto válida → `201` y 5 objetos nuevos en el bucket; con un archivo corrupto (extensión de imagen, bytes basura) → `400` `reason:"decode"` y cero objetos subidos                                                           |
| 10  | `appendProductImage` sube el juego completo o revierte lo ya subido si algo falla a mitad (R6/E2) y arrastra el aviso de E3 si la variante de tarjeta quedó pesada; `saveProduct` compara `imageUrls` antes/después del `commit()` y purga (con `await`, nunca `void`) las URLs que desaparecieron                                        | ~ `src/features/admin/server/mutations.ts`; ~ `src/features/admin/server/mutations.test.ts`                                                                                                                                                                                  | 1, 5, 6 (mitad panel)    | `mutations.test.ts`: una subida con la última variante fallando no deja `imageUrls` tocado y borra lo ya subido; quitar una URL en `saveProduct` dispara **una** llamada de borrado después de escribir; no quitar ninguna no dispara ninguna |
| 11  | La rama de `product.ts:95-107` se parte por `operation` (R10): solo `DELETE` vacía `imageUrls` y reporta `purgeObjectPrefix`; `publishToStore:false` conserva las imágenes. `processBatch.ts` drena los prefijos (deduplicados) **después** de revalidar                                                                                  | ~ `src/features/sync/server/handlers/types.ts`; ~ `src/features/sync/server/handlers/product.ts`; ~ `src/features/sync/server/processBatch.ts`; ~ `src/features/sync/server/handlers/product.test.ts`                                                                        | 6                        | `npm test -- product.test`: `DELETE` de un producto con imágenes deja `imageUrls: []` y un `purgeObjectPrefix`; `publishToStore:false` no toca ninguno de los dos; los casos existentes (líneas 254-268, 319-332) siguen pasando              |
| 12  | Foto real de referencia (CC0, ≥ 1200 px) y etapa de siembra en el seed: sube el juego completo a los 15 productos de `tienda-demo` por el mismo camino que el panel, con directorio determinista (no `randomUUID()`) y `upsert`, para que correr el seed dos veces deje el mismo resultado; se salta entero si Storage no está disponible | + `prisma/fixtures/producto-demo.jpg`; + `prisma/fixtures/README.md` (licencia y atribución); ~ `prisma/seed.ts`                                                                                                                                                             | 3 (habilita la medición) | `npm run seed && npm run seed`: los 15 productos de `tienda-demo` tienen exactamente una URL en `imageUrls` y el bucket no acumula un segundo juego de objetos en la segunda corrida                                                          |
| 13  | Comprobación de presupuesto de imágenes: pide el HTML de una tienda levantada, toma el candidato AVIF de menor ancho de cada `<picture>`, suma sus `content-length` y falla si supera 300 KB o si el conjunto está vacío (I5) o si algún `HEAD` no es `200`                                                                               | + `scripts/check-image-budget.mjs`; ~ `package.json` (`+ "check:images"`)                                                                                                                                                                                                    | 3                        | `node scripts/check-image-budget.mjs --base $BASE --slug tienda-demo` → `0` con el seed corrido y el servidor levantado; forzando una URL rota en un fixture de prueba → `1` (no un `0` que mida cero bytes)                                  |
| 14  | Smoke de F-023 (criterios 1, 3, 4, 5, 6 contra servidor + emulador levantados) y arreglo del smoke de F-011 (AP1): el bloque que comprobaba `/_next/image` (líneas 288-305) se sustituye por el equivalente de F-023 — la URL del original y su variante AVIF responden `200` desde el CDN                                                | + `.agent/specs/F-023/smoke.sh`; ~ `.agent/specs/F-011/smoke.sh`                                                                                                                                                                                                             | 1, 3, 4, 5, 6            | `bash .agent/verify.sh F-023 --smoke` → `0`; `bash .agent/verify.sh F-011 --smoke` → `0` (deja de estar en rojo por el cambio de F-023)                                                                                                       |
| 15  | ADR 0022 pasa de "Propuesta" a "Aceptada"; `tests.md` con veredicto por los 8 criterios de `features.json`; progreso y lecciones fichadas                                                                                                                                                                                                 | ~ `docs/adr/0022-imagenes-derivadas-al-subir.md`; + `tests.md`; ~ `progress/F-023.md`; `.agent/playbook/` si hubo lecciones                                                                                                                                                  | 7, 8                     | `bash .agent/verify.sh F-023 --full` → `0` (harness · typecheck · lint · format · test · prisma · build · theme · bundle); `bash .agent/sdd.sh log F-023 sdd-tester` con el veredicto                                                         |

## De dónde sale cada paso

| Paso | De dónde sale                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | `spec.md` R2, R5, R11; `architecture.md` § El contrato de la derivación; `design.md` D1, D2, D4                     |
| 2    | `spec.md` SP1, I6; `architecture.md` § El codificador — la decisión (b), sus cuatro puntos obligatorios             |
| 3    | `architecture.md` § Componentes → «Guarda de fronteras de imagen»                                                   |
| 4    | `spec.md` R9, R12; `architecture.md` § Cinco cosas que solo se ven leyendo, punto 3; § Contratos → Storage          |
| 5    | `spec.md` R11; `architecture.md` § Rutas de objeto — la decisión (a)                                                |
| 6    | `spec.md` R4, R16; `architecture.md` § Servido; `design.md` D3, D5 y el marcado exacto de § Inventario de pantallas |
| 7    | `spec.md` R1; `architecture.md` § `next.config.ts`; § Cinco cosas que solo se ven leyendo, punto 5                  |
| 8    | `spec.md` E5, E6, R15; `architecture.md` § Componentes (modificados); `design.md` §§ 1-4 (marcado, textos, `eager`) |
| 9    | `spec.md` E1, E4, casos límite «archivo corrupto»; `architecture.md` § Subida (E1, E2, E3, R6)                      |
| 10   | `spec.md` E2, E3, R6, R14; `architecture.md` § Subida y § Quitar o reemplazar una imagen                            |
| 11   | `spec.md` E11, E12, E13, R10, R13, R14; `architecture.md` § Borrado desde el sync                                   |
| 12   | `spec.md` I5; `architecture.md` § Sembrar una imagen de verdad (I5); AP2 aprobada                                   |
| 13   | `spec.md` R7, R8, criterio 3; `architecture.md` § El presupuesto de imágenes — la decisión (c)                      |
| 14   | `spec.md` criterios 1, 3, 4, 5, 6; `architecture.md` § Qué se rompe, punto 8; AP1 aprobada                          |
| 15   | `.agent/README.md` § «Al completar un feature»; `architecture.md` § ¿Hace falta una ADR?                            |

Ningún paso sale de un documento que no exista.

## Qué queda fuera

- **Recorte, rotación o edición de imagen en el panel.** Fuera de alcance
  desde la spec; el admin sube lo que tiene.
- **Imágenes de `CanonicalProduct`** (marketplace). Mismo mecanismo, otro
  feature.
- **`Storefront.logoUrl`/`coverUrl`.** F-011 los aparcó esperando a F-023, pero
  ningún criterio de F-023 los nombra (I7): siguen sin quien los escriba.
- **Recolección retroactiva de los huérfanos que F-011 ya dejó** en el bucket
  antes de este feature. Las filas viejas siguen sirviéndose (R11), sin
  backfill.
- **Migración de datos.** `imageUrls` no cambia de forma ni de significado.
- **Bajar el presupuesto de JavaScript de F-013.** Este feature solo se
  compromete a no subirlo (criterio 7); si baja, es efecto colateral, no meta.
- **Subir la memoria de la función de subida en Vercel.** AP3: se acepta un
  tope de 80 MP con `sharp.concurrency(1)` y un `503` en la segunda subida
  grande concurrente por instancia, en vez de pagar más infraestructura.
- **Una cola de generación en segundo plano.** No hay broker en este repo (ADR
  0015); SP1 ya fija que la generación ocurre dentro de la petición de subida.
- **Paginar `/[slug]`.** El presupuesto de 300 KB se mide contra el catálogo
  de referencia (15 productos); I4 deja escrito que a partir de ~60 productos
  la paginación deja de ser una mejora y pasa a ser necesaria — es trabajo de
  otro feature.

## Riesgos y plan B

- **Memoria de la función en subidas grandes concurrentes.** Una imagen de 64
  MP decodificada ocupa ~256 MB; con la función por defecto de Vercel (1024
  MB) hay sitio para ~1-2 subidas grandes a la vez por instancia.
  `limitInputPixels` (80 MP, AP3) y `sharp.concurrency(1)` acotan el riesgo; el
  síntoma de sobrepasarlo es un `503`, no un proceso caído. Plan B si en
  producción muerde: subir la memoria de esa función (AP3 (b), descartada por
  ahora).
- **15 × la variante de tarjeta no cabe en 300 KB.** Es el resultado que el
  feature quiere poder descubrir. Plan B: bajar calidad o ancho de la
  constante (R8), nunca subir el presupuesto en silencio — ni `BUDGET_KB` ni
  `IMAGE_BUDGET_KB` se tocan sin dejar escrito quién, por qué y con qué
  medición, igual que ya exige el comentario de `check-bundle-budget.mjs`.
- **`.agent/specs/F-011/smoke.sh` se queda en rojo si el paso 14 no se
  ejecuta.** Es AP1, ya aprobada: el paso 14 lo arregla como parte del plan,
  no como deuda aparte.
- **Un lote de sync con muchos `DELETE` de productos con imágenes dispara
  muchas llamadas de listado/borrado a Storage al final del lote** (~10 por
  producto). Acotado con tope de claves y concurrencia limitada
  (`architecture.md` § Escalabilidad); si algún día un lote real lo satura, la
  salida es una tabla de purgas pendientes que otro feature drena — no la hay
  hoy (ADR 0015).
- **Contraste de foto en escritorio retina (DPR 2).** La tarjeta sirve la
  variante de 400 px escalada 1,32× en el peor caso (D3). Aceptado con número;
  si en producción se ve mal, el remedio es subir el ancho de tarjeta en la
  constante, no rediseñar el marcado.
- **La ADR 0022 introduce la única excepción a ADR 0007** (el sync vacía
  `imageUrls` en el `DELETE` terminal). Está acotada a ese caso y documentada;
  cualquier ampliación futura de esa excepción necesita su propia ADR.
- **Sin migración de `prisma/schema.prisma` y sin ninguno de los dos comandos
  que `AGENTS.md` prohíbe.** Si algún paso pareciera necesitar uno, es señal
  de que algo se entendió mal: se para y se pregunta.
- **Cambio en `docs/sync-contract.md`: ninguno de forma.** El único efecto
  nuevo del lado de queandabuscando es que el `DELETE` ya vacía `imageUrls`
  además de lo que ya vaciaba; no hay campo nuevo ni versión nueva del
  contrato.

## Coste

- **Ciclos de agente:** 1 de implementación (los quince pasos son un solo
  camino de escritura sobre piezas existentes de F-011, sin migración) + 1 de
  pruebas y verificación, más los reintentos del sensor. Si hace falta
  partirlo, la línea limpia está entre el paso 8 (servido) y el 9 (escritura):
  con los pasos 1-8 la tienda ya sirve del CDN aunque la subida todavía no
  genere variantes nuevas.
- **Se toca de lo que ya funciona:** `storagePaths.ts`, `next.config.ts`,
  `ProductCard.tsx`, `ProductTable.tsx`, `ImageUploader.tsx` (los cuatro
  puntos que F-011 dejó en verde), el handler del sync de producto y
  `processBatch.ts`, y `prisma/seed.ts`. Los pasos 8, 10 y 11 son los que
  pueden romper algo que hoy está en verde si se hacen sin correr sus tests
  existentes primero.
- **Marcha atrás:** todo el feature es aditivo y sin migración de esquema.
  `git revert` del diff completo no deja dato roto: las URLs viejas de F-011
  siguen funcionando (R11) y ningún objeto de F-011 se toca. Lo único con
  estado real fuera de git son los objetos nuevos que la siembra (paso 12) y
  las pruebas suben al bucket — se limpian borrando el prefijo de `tienda-demo`
  o recreando el emulador.

## Preguntas antes de aprobar

Ninguna abierta. Las seis que hubo están resueltas y escritas aquí para que el
plan se lea sin el hilo del chat:

- **SP1** — Las variantes se generan en la propia app al subir, no con la
  transformación de imágenes de Supabase.
- **SP2** — Presupuesto de peso de imágenes de una página de catálogo: 300 KB.
- **I2/R10** — `publishToStore: false` conserva las imágenes; solo
  `operation: DELETE` borra objetos y vacía `imageUrls`.
- **AP1** — El smoke de F-011 se arregla (paso 14), sustituyendo el bloque de
  `/_next/image` por el equivalente de F-023.
- **AP2** — La foto de referencia del seed es una foto CC0/dominio público,
  con atribución en `prisma/fixtures/README.md`.
- **AP3** — Tope de entrada 80 MP con `sharp.concurrency(1)`; una segunda
  subida grande concurrente por instancia responde `503`. No se sube la
  memoria de la función.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-023 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-28T17:49:34Z — aprobado por el humano: «Apruebo el plan»
