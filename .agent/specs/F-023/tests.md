---
feature: F-023
agente: sdd-tester
actualizado: 2026-08-28T19:05:55Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno ejecutado por mí de forma independiente (no me limité a
leer `impl.md`/`progress.md` ni a confiar en el código de salida ajeno):

1. **Unitario** (`npm test`, proyecto `node` salvo `ResponsiveImage.test.tsx`
   que es `.tsx` → `jsdom`, regla de `AGENTS.md` § Cosas que muerden): leí cada
   archivo nuevo/modificado línea a línea para confirmar que ejercita
   comportamiento, no solo lo describe.
2. **Runtime contra servidor + emulador reales**: además de correr
   `.agent/specs/F-023/smoke.sh` vía `verify.sh --smoke`, levanté **mi propio**
   `next dev` en un puerto distinto (3105) y repetí a mano, con mis propios
   `curl`/`docker exec psql`/llamadas a la API de Storage, los criterios 1, 2,
   3, 4, 5 y 6 — sin leer el código y asumir, ejecutando y mirando la
   respuesta real.
3. **Bordes no cubiertos por spec/impl**: archivo con cabecera de imagen válida
   pero cuerpo corrupto de verdad, el límite exacto de 80 MP, tres subidas
   concurrentes al mismo producto, y `deriveImageVariants` con querystring y
   con fragmento.

## Mapa criterio → prueba

| #   | Criterio de aceptación                                                               | Prueba                                                                                                                                             | Archivo / comando                                                                                                                                                                                                                                                                                                          | Resultado                                                              |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Subir una imagen deja más de un objeto en el bucket: original más variantes.         | `POST` a un producto sin imágenes (Café molido, tienda-dos, sin tocar por la siembra), listado de la API de Storage antes/después                  | `curl -F file=@.../sample.jpg .../images` → `201`; `.storage/v1/object/list` sobre el prefijo del producto → 1 directorio; dentro, 5 objetos (`original.jpg`,`w400/800.avif/webp`)                                                                                                                                         | **LISTO** — verificado a mano, con mis propios curls, además del smoke |
| 2   | El HTML servido de `/[slug]` no contiene ninguna URL de `/_next/image`.              | `curl` sobre `/tienda-demo`, `/tienda-demo/buscar?q=cola`, `/tienda-demo/p/arroz-blanco-1-kg`                                                      | `grep -c "_next/image"` → `0` en las tres; `src/lib/boundaries.test.ts` (guarda: nadie bajo `src/` importa `next/image`)                                                                                                                                                                                                   | **LISTO**                                                              |
| 3   | El peso total de imágenes de una página de catálogo está bajo presupuesto.           | `check-image-budget.mjs` contra mi propio servidor, más inspección manual del HTML                                                                 | `node scripts/check-image-budget.mjs --base=http://localhost:3105 --slug=tienda-demo` → `0`, 209.7–241.9 KB según el estado del catálogo, siempre bajo 300 KB; guardia de medición vacía probada aparte (`--slug=bodega-central`, sin imágenes) → `1`                                                                      | **LISTO**                                                              |
| 4   | Con `Accept: image/avif` responde AVIF; sin él, el respaldo.                         | `curl -sI` con y sin el header, sobre las URLs reales que el `<picture>` de una tarjeta emite                                                      | `Accept: image/avif,...` → `200 image/avif`; `Accept: image/webp,...` → `200 image/webp` (el objeto no negocia por headers — I3: la elección es del `<picture>`, comportamiento observable correcto)                                                                                                                       | **LISTO**                                                              |
| 5   | Reemplazar la imagen cambia lo que se ve tras la revalidación, sin variantes viejas. | Subida + `PUT` de reemplazo en un **mismo proceso de servidor** (ver nota metodológica abajo), luego `curl` del catálogo y de los 5 objetos viejos | Página muestra el directorio nuevo, no el viejo; los 5 objetos viejos (`original`+4 variantes) responden `400` (no `200`) — repetido también dentro de `smoke.sh` con `seed-tienda-1-p0`                                                                                                                                   | **LISTO**                                                              |
| 6   | Borrar un producto no deja objetos huérfanos.                                        | Evento `DELETE` real al endpoint de sync sobre Café molido (`seed-tienda-2-p3`), listado del bucket y `SELECT imageUrls` antes/después             | `POST /api/internal/sync/catalog` → `207`, `status:"processed"`; prefijo del producto → `[]`; `imageUrls` en Postgres → `{}`. Caso simétrico `publishToStore:false` (Jabón, `seed-tienda-2-p2`) verificado también en vivo: `deletedAt` se pone, `imageUrls` **conserva sus 3 URLs**, el bucket conserva los 3 directorios | **LISTO**                                                              |
| 7   | `node scripts/check-bundle-budget.mjs` termina en 0.                                 | Ejecutado tras `npm run build`                                                                                                                     | `0`, 176.9 KB gzip sobre presupuesto de 193 KB, `BUDGET_KB` sin tocar                                                                                                                                                                                                                                                      | **LISTO**                                                              |
| 8   | `bash .agent/verify.sh F-023 --full` termina en 0.                                   | Ejecutado tal cual                                                                                                                                 | `PASA`, las nueve etapas en verde (ver salida completa en § Ejecuciones)                                                                                                                                                                                                                                                   | **LISTO**                                                              |

## Ejecuciones

```
$ bash .agent/sdd.sh start F-023
ENTORNO LISTO (Node, Postgres, emulador de Storage con bucket store-media)

$ bash .agent/verify.sh F-023 --full
== Verificación F-023 · intento 22 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       7s
  ✓ format     7s
  ✓ test       11s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s
PASA

$ bash .agent/verify.sh F-023 --smoke      # primera corrida
== intento 23 == typecheck·lint·format·test·smoke → PASA
0 aserciones fallidas (.agent/runs/F-023/023-smoke.log)

$ bash .agent/verify.sh F-023 --smoke      # segunda corrida, idempotencia
== intento 24 == PASA
0 aserciones fallidas (.agent/runs/F-023/024-smoke.log)

$ bash .agent/verify.sh F-011 --smoke
== intento 4 == PASA (no lo rompió correr el smoke de F-023 encima)

$ node scripts/check-bundle-budget.mjs
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 176.9 KB gzipped (budget 193 KB)
exit 0

$ node scripts/check-image-budget.mjs --base=http://localhost:3105 --slug=tienda-demo
✓ 13-15 imágenes medidas (varía según qué productos toqué en la sesión)
    total: 209.7-241.9 KB (presupuesto 300 KB)
exit 0

$ node scripts/check-image-budget.mjs --base=http://localhost:3105 --slug=bodega-central
✗ No se encontró ninguna imagen — medición vacía
exit 1   (guardia correcta, no un 0 falso)

# Verificación manual independiente (servidor propio, puerto 3105, no el de smoke.sh)
$ curl -F file=@.agent/specs/F-011/fixtures/sample.jpg ... /images → 201
$ curl -X POST .../storage/v1/object/list/store-media -d '{"prefix":".../<producto>/"}'
  → 1 directorio; dentro, 5 objetos con content-type image/jpeg, image/avif×2, image/webp×2

$ curl -sI -H 'Accept: image/avif,image/webp,*/*' <url>/w400.avif → 200 image/avif
$ curl -sI -H 'Accept: image/webp,*/*' <url>/w400.webp            → 200 image/webp

# Reemplazo (criterio 5) contra mi propio servidor:
$ curl -F file=@sample.jpg ... /images → 201 (nueva url)
$ curl -X PUT .../products/<id> -d '{"imageUrls":["<nueva>"]}' → 200
$ curl http://localhost:3105/tienda-dos | grep <dir-nuevo> → presente
$ for SUFFIX in original.jpg w400.avif w400.webp w800.avif w800.webp; do
    curl -o /dev/null -w '%{http_code}' <dir-viejo>$SUFFIX
  done
  → 400 400 400 400 400   (nunca 200)

# DELETE del sync (criterio 6) contra mi propio servidor:
$ curl -X POST /api/internal/sync/catalog -d '{...operation:"DELETE"...}' → 207, processed
$ list_bucket(prefijo del producto) → []
$ psql ... SELECT "imageUrls" ... → {}

# publishToStore:false (E12, mitad simétrica del criterio 6):
$ curl -X POST /api/internal/sync/catalog -d '{...publishToStore:false...}' → 207, processed
$ psql ... → deletedAt puesto, imageUrls SIGUE con sus 3 URLs, visible=f
$ list_bucket(prefijo del producto) → 3 directorios (conservados)

$ bash .agent/verify.sh pending F-023
(vacío — nada sin fichar ni descartar)
```

`npm test` (dentro de `--full`/`--smoke`): suite completa en verde, incluidos
`imageVariants.test.ts`, `imageEncoder.test.ts`, `boundaries.test.ts`,
`ResponsiveImage.test.tsx`, y los casos nuevos de `mutations.test.ts`,
`product.test.ts`, `processBatch.test.ts`, `storagePaths.test.ts`.

### Nota metodológica sobre el criterio 5

Al levantar mi propio `next dev` en un puerto distinto al que usó una corrida
**anterior y ya terminada** de `smoke.sh`, un producto que ese smoke ya había
mutado (`Refresco de cola 1.5 L`) se veía con el hueco «Sin imagen» pese a que
Postgres y el bucket tenían la imagen correcta — cache de ruta (`revalidatePath`
sin `export const revalidate`, en dev) que vive en el proceso que hizo la
mutación, no en un proceso nuevo que arranca después. **No es un defecto de
F-023**: es un artefacto de mi metodología (dos procesos de servidor
independientes), no algo que ocurra en producción (Vercel centraliza el Data
Cache entre invocaciones) ni siquiera en un despliegue autoalojado de un solo
proceso (que es el que `smoke.sh` ya modela correctamente: muta y lee contra
**el mismo** proceso, como pide la redacción del propio criterio 5 — «medido
sobre el servidor levantado», singular). Repetí la mutación y la lectura
**dentro de mi mismo proceso** (arriba) y el resultado fue el esperado. Lo dejo
escrito porque es la clase de trampa que puede confundir a quien pruebe esto
en el futuro con dos terminales abiertas.

## Fallos encontrados

Ninguno que bloquee un criterio. Dos hallazgos menores, ninguno de severidad
alta, reportados con destinatario:

1. **`src/lib/supabase/storage.ts` no tiene archivo de test propio.**
   `plan.md` paso 4 pedía explícitamente «Test contra el emulador:
   `uploadStoreObjects` sube 5 objetos o ninguno; `removeStoreObjectsUnder(prefix)`
   borra un directorio de imagen y dos niveles de objetos planos» y ese
   archivo no existe (`find src -iname "storage.test.ts"` → vacío).
   `mutations.test.ts` prueba la reacción de `appendProductImage`/`saveProduct`
   a lo que `storage.ts` **le informa** (mockeado), no el comportamiento real
   de `uploadStoreObjects`/`removeStoreObjectsUnder` contra el emulador. Yo
   verifiqué esas dos propiedades a mano contra el emulador real (arriba,
   criterios 1 y 6) y se cumplen, así que ningún `acceptance_criteria` queda
   sin cubrir — pero la propiedad de atomicidad («todas las 5 o ninguna») bajo
   un fallo real a mitad de lote no tiene una prueba automatizada que la
   proteja de una regresión futura; solo la protege el mock de
   `mutations.test.ts`, que asume el contrato en vez de ejercerlo.
   **Destinatario: `sdd-implementer`** — un test de integración de
   `storage.ts` contra el emulador (el `paso 4` ya escrito en `plan.md`) es
   deuda de cobertura, no un bug: no bloquea el veredicto porque el
   comportamiento observable ya está probado en runtime real (smoke +
   verificación manual), pero conviene cerrarlo antes de tocar ese archivo de
   nuevo.
2. **`deriveImageVariants()` no maneja una URL con querystring sin punto de
   forma explícita.** Con `.../original.jpg?token=abc` la función pasa el
   chequeo de nombre (el `.` que separa la extensión sigue siendo el correcto)
   y genera las 4 variantes **sin el querystring** (`.../w400.avif`, sin
   `?token=abc`) — no revienta, pero silenciosamente descarta cualquier
   parámetro que algún día viajara en `imageUrls`. Con un querystring que
   **sí** tiene un punto (`?v=1.2`) el comportamiento es al revés y correcto:
   `dotIndex` cae dentro del querystring, el nombre no coincide con
   `original`, y la función devuelve `null` (fallback seguro a `<img>` con la
   URL completa, R11). Con un `#fragmento` no hay problema real: los
   fragmentos nunca viajan al servidor, así que perderlos al construir las
   URLs hermanas es inofensivo. Verificado con un test ad-hoc (borrado tras la
   comprobación, no forma parte del repo) contra `deriveImageVariants` real,
   no leyendo el código: los tres casos se comportan como describo. Hoy
   `imageUrls` nunca lleva querystring (todas las URLs las genera el propio
   endpoint de subida, sin parámetros), así que no es explotable en este
   momento. **Destinatario: `sdd-spec`/`sdd-architect`** (a discreción del
   humano) — si algún día se introduce un esquema de URLs firmadas o con
   cache-busting, esta función necesita una tercera condición explícita
   (recortar en el primer `?`/`#` antes de buscar el punto de la extensión).
   No bloqueante hoy.

Ninguno de los dos generó una ficha en `.agent/playbook/`: son huecos de
cobertura de este ciclo, no trampas del stack que se repitan en otro feature.
`bash .agent/verify.sh pending F-023` devuelve vacío.

## Huecos de cobertura

- La atomicidad real de `uploadStoreObjects` bajo un fallo real de red a
  mitad de lote (no simulado por mock) — hallazgo 1 arriba.
- `deriveImageVariants` con querystring/fragmento — hallazgo 2 arriba, riesgo
  bajo porque hoy no es alcanzable desde ningún camino del código.
- No repetí a mano el caso de una imagen de exactamente 4 MB **y** 80 MP a la
  vez (el límite de bytes se comprueba antes que el de píxeles en el
  endpoint real; los probé por separado — 80 MP con una imagen sintética de
  pocos KB, y el tope de 4 MB ya lo cubre `E4`/F-011 sin cambios). Combinar
  ambos límites en la misma petición no agrega información nueva sobre el
  comportamiento del sistema, así que no lo considero una laguna real.

## Veredicto

**LISTO.** Los 8 `acceptance_criteria` de `.agent/features.json` se
verificaron ejecutando algo — comandos propios, independientes de
`smoke.sh` y de los informes de `sdd-implementer` — y viendo el resultado
real, no leyendo el código. `bash .agent/verify.sh F-023 --full` y
`--smoke` (dos veces) terminan en `0`; `bash .agent/verify.sh F-011 --smoke`
sigue en verde. `bash .agent/verify.sh pending F-023` está vacío. Los dos
hallazgos de la sección anterior son deuda de cobertura no bloqueante, no
criterios incumplidos.

Queda pendiente, y no es de mi competencia: el humano decide IP1 (la foto de
`prisma/fixtures/producto-demo.jpg`, ya confirmada en `progress/F-023.md`) y
marca `"passes": true` en `.agent/features.json`.

## Preguntas al humano

Ninguna. Los 8 criterios se pudieron verificar tal como están escritos.
