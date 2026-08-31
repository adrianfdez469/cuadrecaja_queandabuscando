---
feature: F-026
agente: sdd-tester
actualizado: 2026-08-31T05:10:00Z
estado: listo
veredicto: listo
---

## Estrategia

Los 15 criterios se ejecutaron contra un `next dev` propio en el puerto 3100,
confirmado por PID/`cwd` como el de este worktree
(`/Users/adrian/orca/workspaces/queandabuscando/menhaden`) antes de creer nada
de lo que devolviera — el puerto 3000 ya había mordido a otra sesión de este
mismo feature (`.agent/progress/F-026.md` § Notas para quien retome), y
`AGENTS.md` § Cosas que muerden lo pide explícitamente.

Tres niveles:

1. **HTTP de verdad con `curl`**, código de estado incluido (`-w
'%{http_code}'`), nunca una lectura de código para los 404/200/aviso de
   cerrada (criterios 5, 6, 9).
2. **Sync de verdad**, con `scripts/send-catalog-batch.mjs` como base y tres
   variantes propias (`node -e` scripts efímeros, borrados al terminar) para
   los payloads que ese script no cubre: mover de categoría, borrar/renombrar
   categoría, y dos categorías homónimas — enviados contra el
   `/api/internal/sync/catalog` real, con el token de `seed-negocio-1`
   (`npm run mint:token -- seed-negocio-1`), nunca simulados ni escritos por
   `psql` (criterios 3, 7, 8, 9, 10, 11).
3. **El navegador de verdad** (Chrome vía MCP) para la única comprobación que
   pide clic, no lectura: el enlace de salida del 404 de categoría (V9,
   § Desviaciones de `impl.md`).

**Regla de higiene que este ciclo rompió una vez y aprendió**: los primeros
sync de los criterios 7–11 mutaron la fixture real de la base de desarrollo
(renombraron «Aseo», borraron «Panadería», movieron «Refresco de cola» de
categoría) y un guiso propio con un `externalId` adivinado mal
(`seed-tienda-1-p10`) sobrescribió por accidente «Detergente líquido 1 L» con
el nombre «Pan de molde» — los dos productos comparten sucursal y casi la
misma posición en la lista, y el `externalId` no está documentado en ningún
sitio más que en la base misma. Se detectó comparando conteos (`StoreProduct`
pasó de 15 a 16 en la tienda) y se corrigió con dos eventos `PRODUCT/UPDATE`
más. **Toda la fixture se restauró carácter a carácter** (mismos `slug`,
`name`, `localCategoryId`, `syncedPrice`, `availability`, `visible` que al
empezar — verificado contra la tabla completa, no solo contra lo que se tocó)
antes de cerrar, y `.agent/specs/F-026/smoke.sh` (nuevo, más abajo) reescribe
la lección: todo lo que crea usa un `externalId` con sufijo de `$(date +%s)`,
nunca los nombres de la fixture, y se autolimpia con SQL directo al terminar
— tres corridas de desarrollo de ese guion sí quedaron sin limpiar a tiempo y
se purgaron a mano (`DELETE ... WHERE "externalId" LIKE 'smoke-%'`),
confirmado contra los conteos que `.agent/sdd.sh start` documenta: **28
StoreProduct, 5 LocalCategory, 10 Store, 306 pedidos, 19 CanonicalProduct**,
todos verificados iguales al final de esta sesión.

## Mapa criterio → prueba

| #   | Criterio de aceptación (resumido)                                                  | Prueba                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Resultado |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | `GET /tienda-demo` 200, un enlace por categoría con stock, ninguno sin             | `curl -w '%{http_code}' /tienda-demo` → 200; `grep -oE 'href="/tienda-demo/c/[a-z-]*"'` → exactamente `alimentos aseo bebidas panaderia`; consulta a Postgres confirma que esas 4 son las únicas categorías con `count(*) > 0` de `StoreProduct` visible en `d2340170-…` (tienda-demo). Negativo reforzado con `bodega-dos` (solo `alimentos`+`bebidas` en stock): su HTML **no** trae `aseo` ni `panaderia`, que sí existen en el mismo negocio                                                                                                                                                                                                                         | **LISTO** |
| 2   | Vista de categoría 200, solo sus productos                                         | `curl /tienda-demo/c/bebidas` → 200; los 4 nombres de bebidas presentes, los 3 de `aseo` ausentes (`grep -c` = 0 para cada uno)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **LISTO** |
| 3   | `visible=false` la quita; `OUT_OF_STOCK` la deja con distintivo                    | `PRODUCT/UPDATE` con `publishToStore:false` sobre «Jabón de baño» → desaparece de `/tienda-demo/c/aseo`; restaurado; `POST /api/internal/sync/availability` con `OUT_OF_STOCK` → sigue apareciendo, con `>Agotado<` en su tarjeta. Repetido de forma no destructiva en `smoke.sh` con un producto sintético                                                                                                                                                                                                                                                                                                                                                              | **LISTO** |
| 4   | `priceOverride`: mismo precio carácter a carácter en `/[slug]` y en la categoría   | Extraído por script el `<p class="text-brand text-base font-semibold">` de «Aceite de girasol 900 ml» (tiene `priceOverride`) en `/tienda-demo` y en `/tienda-demo/c/alimentos`: `'$1,150.00' == '$1,150.00'` (comparación de cadenas en Python, no a ojo)                                                                                                                                                                                                                                                                                                                                                                                                               | **LISTO** |
| 5   | Categoría de otra sucursal → 404, igual que inexistente                            | `curl -o /dev/null -w '%{http_code}' /bodega-uno/c/aseo` → **404** (bodega-uno solo tiene `alimentos`/`bebidas`; `aseo` es del mismo negocio pero sin stock ahí); `/tienda-demo/c/no-existe-123` → **404**                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **LISTO** |
| 6   | Selector → 404; `SUSPENDED` → aviso sin consulta de catálogo                       | `/el-trebol/c/lo-que-sea` (kind:selector, 2 sucursales renderizables) → **404**; `/tienda-cerrada/c/<categorySlug-inventado>` (marca de 1 sucursal, `SUSPENDED`) → **200** con el aviso — la prueba de que NO se ejecuta consulta de catálogo es que un `categorySlug` que no existe en ningún sitio da 200-aviso y no 404: si el código consultara el catálogo antes de mirar `status`, un slug inventado forzaría `notFound()`. Reforzado leyendo el orden real en `src/app/[slug]/c/[categorySlug]/page.tsx`: el chequeo de `store.status !== "PUBLISHED"` ocurre y retorna ANTES del único `Promise.all` que llama a `getStoreCategoryView`/`getStoreCategories`     | **LISTO** |
| 7   | `PRODUCT/UPDATE` de precio → la vista de categoría también lo muestra              | `PRODUCT/UPDATE` real sobre «Refresco de cola 1.5 L» (450→499) vía `send-catalog-batch.mjs` contra el `/api/internal/sync/catalog` de este `next dev` → `/tienda-demo` **y** `/tienda-demo/c/bebidas` muestran `$499.00`, en la misma comprobación. Repetido de forma no destructiva en `smoke.sh`                                                                                                                                                                                                                                                                                                                                                                       | **LISTO** |
| 8   | `PRODUCT/UPDATE` de `localCategoryId` → sale de la vieja, entra en la nueva        | Movido el mismo producto de `bebidas` a `alimentos` y de vuelta por sync real: desaparece de `/tienda-demo/c/bebidas`, aparece en `/tienda-demo/c/alimentos`, en la misma comprobación. Repetido de forma no destructiva en `smoke.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                   | **LISTO** |
| 9   | `CATEGORY/DELETE` → fuera del selector, vista 404, productos siguen en `/[slug]`   | `CATEGORY/DELETE` real de «Panadería»: desaparece de los `href` de `/tienda-demo`, `/tienda-demo/c/panaderia` → 404, y los 3 nombres de sus productos siguen en `/tienda-demo`. Recreada después con el mismo `externalId` (slug volvió a ser `panaderia`, quedó libre)                                                                                                                                                                                                                                                                                                                                                                                                  | **LISTO** |
| 10  | `CATEGORY/UPDATE` que renombra → nombre nuevo, misma URL 200                       | `CATEGORY/UPDATE` real de «Aseo» → «Higiene y limpieza»: `/tienda-demo/c/aseo` sigue en **200**, su `<h1>` y el chip del selector muestran el nombre nuevo. Revertido                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **LISTO** |
| 11  | Dos categorías homónimas al slugificar → 2 URL, cada una con lo suyo               | `CATEGORY/CREATE` real de «Café» y «CAFÉ» (mismo slug base `cafe` tras `slugify`) → `cafe` y `cafe-2` en la base; un producto sintético en cada una; `/tienda-demo/c/cafe` y `/tienda-demo/c/cafe-2` responden 200 y cada uno solo lista el suyo. Reproducido también en `smoke.sh` con «Ñame»/«name»                                                                                                                                                                                                                                                                                                                                                                    | **LISTO** |
| 12  | `npm run build`: `/[slug]` sigue ● (SSG)                                           | `npm run build` limpio (tras las mutaciones de sync de este ciclo) → `/[slug]` es la fila agrupadora sin marca propia; sus rutas concretas (`/tienda-demo`, `/tienda-dos`, `/bodega-central`, `[+6 more paths]` = 9) llevan **●**, no ƒ; `/[slug]/c/[categorySlug]` también **●** (3 mostradas + 11 más = 14 en esa corrida). Log crudo comprobado, no solo el resumen de `verify.sh`                                                                                                                                                                                                                                                                                    | **LISTO** |
| 13  | `check-bundle-budget.mjs` → 0; sin `"use client"` en lo nuevo                      | `node scripts/check-bundle-budget.mjs` → exit **0** (177.6 KB / 193 KB de presupuesto); `grep -rn "use client"` sobre los 11 archivos nuevos/tocados del feature (`src/app/[slug]/c/`, `src/components/store/StoreCategoryNav.tsx`, `src/features/catalog/storeCategories.ts(.test.ts)`, `src/constants/catalog.ts`, `src/features/catalog/server/queries.ts`, `src/features/catalog/server/search.ts`, `src/app/[slug]/page.tsx` y `src/app/[slug]/p/[productSlug]/page.tsx`, `src/features/sync/server/handlers/misc.ts(.test.ts)`, `src/features/sync/server/handlers/types.ts`, `src/features/sync/server/processBatch.ts(.test.ts)`, `src/lib/slug.ts`) → **vacío** | **LISTO** |
| 14  | Sin JavaScript, un enlace del selector carga la categoría con productos en el HTML | `curl` (que NUNCA ejecuta JavaScript) sigue el `<a href>` real de `/tienda-demo` hasta `/tienda-demo/c/alimentos`: 200, nombre y precio del producto en el HTML crudo, sin ninguna diferencia entre pedir el enlace "a mano" o "siguiéndolo" — es la prueba más fuerte posible de E15, más estricta que un navegador con JS desactivado (que sigue ejecutando el HTML parser con las mismas APIs)                                                                                                                                                                                                                                                                        | **LISTO** |
| 15  | `bash .agent/verify.sh F-026 --full` → 0                                           | Ejecutado **dos** veces al final de esta sesión (intento 27 y 30, tras limpiar la fixture) → **PASA** las dos veces, con las nueve etapas completas en verde (ver § Ejecuciones → El sensor, más abajo, con la transcripción exacta). `bash .agent/verify.sh pending F-026` → vacío                                                                                                                                                                                                                                                                                                                                                                                      | **LISTO** |

Los **quince** están cubiertos ejecutando algo real contra el servidor vivo,
el sync real o el build real — ninguno se dio por bueno leyendo código.

## Ejecuciones

### El sensor

```
$ bash .agent/verify.sh F-026 --full        (intento 27, tras restaurar la fixture)
  ✓ harness 0s  ✓ typecheck 2s  ✓ lint 4s  ✓ format 5s  ✓ test 18s
  ✓ prisma 1s   ✓ build 7s     ✓ theme 0s  ✓ bundle 0s
PASA

$ bash .agent/verify.sh F-026 --smoke       (intento 29, con .agent/specs/F-026/smoke.sh ya escrito)
  ✓ typecheck 2s  ✓ lint 4s  ✓ format 6s  ✓ test 19s  ✓ smoke 8s
PASA   (44 aserciones ok, 0 fallidas)

$ bash .agent/verify.sh F-026 --full        (intento 30, verificación final tras limpiar de nuevo)
  ✓ harness 0s  ✓ typecheck 2s  ✓ lint 4s  ✓ format 5s  ✓ test 18s
  ✓ prisma 1s   ✓ build 5s     ✓ theme 0s  ✓ bundle 0s
PASA

$ bash .agent/verify.sh pending F-026
(sin salida)
```

### Comandos exactos por criterio

```
# entorno: next dev propio en 3100, PID confirmado con lsof/ps contra el cwd de este worktree
npx next dev -p 3100

# criterio 1
curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/tienda-demo   # 200
curl -s http://localhost:3100/tienda-demo | grep -oE 'href="/tienda-demo/c/[a-z-]*"' | sort -u
docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -c \
  'SELECT lc.slug, count(sp.id) FROM "StoreProduct" sp JOIN "LocalCategory" lc ON lc.id = sp."localCategoryId"
   WHERE sp."storeId" = '"'"'d2340170-638e-4bca-aa34-1d630f73604c'"'"' AND sp."deletedAt" IS NULL AND sp.visible GROUP BY lc.slug;'
curl -s http://localhost:3100/bodega-dos | grep -oE 'href="/bodega-dos/c/[a-z-]*"'   # solo alimentos y bebidas

# criterio 2
curl -s http://localhost:3100/tienda-demo/c/bebidas > bebidas.html
grep -c "Refresco de cola" bebidas.html; grep -c "Jabón de baño" bebidas.html   # 1 / 0

# criterio 3
npm run mint:token -- seed-negocio-1
node -e '<PRODUCT/UPDATE publishToStore:false sobre seed-tienda-1-p9>'   # via fetch a /api/internal/sync/catalog
curl -s http://localhost:3100/tienda-demo/c/aseo | grep -c "Jabón de baño"   # 0
node -e '<restaura publishToStore:true>'; psql ... 'UPDATE "StoreProduct" SET visible = true WHERE ...'
curl -s -X POST http://localhost:3100/api/internal/sync/availability -d '{"...":"OUT_OF_STOCK"}'
curl -s http://localhost:3100/tienda-demo/c/aseo | grep -c "Agotado"   # 1

# criterio 4
python3 -c "compara el <p class=\"text-brand...\"> de 'Aceite de girasol 900 ml' entre /tienda-demo y /tienda-demo/c/alimentos"
# => '$1,150.00' == '$1,150.00'

# criterio 5
curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/bodega-uno/c/aseo          # 404
curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/tienda-demo/c/no-existe-123 # 404

# criterio 6
curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/el-trebol/c/lo-que-sea       # 404
curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/tienda-cerrada/c/inventado   # 200
curl -s http://localhost:3100/tienda-cerrada/c/inventado | grep -io "cerrad[oa]"

# criterios 7-11: eventos CATEGORY/PRODUCT reales contra /api/internal/sync/catalog,
# ver .agent/specs/F-026/smoke.sh para la forma exacta y reproducible (con externalId
# de un solo uso, nunca los de la fixture)

# criterio 12
npm run build 2>&1 | sed -n '/Route (app)/,/Dynamic/p'

# criterio 13
node scripts/check-bundle-budget.mjs
grep -rn "use client" src/app/\[slug\]/c src/components/store/StoreCategoryNav.tsx \
  src/constants/catalog.ts src/features/catalog/storeCategories.ts \
  src/features/catalog/storeCategories.test.ts "src/app/[slug]/p/[productSlug]/page.tsx" \
  "src/app/[slug]/page.tsx" src/features/catalog/server/queries.ts \
  src/features/catalog/server/search.ts src/features/sync/server/handlers/misc.ts \
  src/features/sync/server/handlers/misc.test.ts src/features/sync/server/handlers/types.ts \
  src/features/sync/server/processBatch.ts src/features/sync/server/processBatch.test.ts \
  src/lib/slug.ts   # vacío, exit 1 de grep (sin coincidencias)

# criterio 14
curl -s http://localhost:3100/tienda-demo -o /tmp/nojs1.html
href=$(grep -oE 'href="/tienda-demo/c/[a-z0-9-]*"' /tmp/nojs1.html | head -1 | sed 's/href="//;s/"$//')
curl -s -o /dev/null -w '%{http_code}' "http://localhost:3100$href"   # 200, con curl (0 JS ejecutado)

# criterio 15
bash .agent/verify.sh F-026 --full
bash .agent/verify.sh pending F-026
```

### V9 — el 404 de categoría, pulsado de verdad (no leído)

Con Chrome vía MCP: navegación a
`http://localhost:3100/tienda-demo/c/categoria-que-no-existe`, captura de
pantalla (cabecera «La Rampa · Vedado» conservada, texto «Esta categoría ya no
está», enlace «Ver todo el catálogo»), clic en el enlace, y captura de la
página resultante: **`http://localhost:3100/tienda-demo`**, con la rejilla
completa del catálogo — confirma la desviación documentada en `impl.md`
(`href=".."` en vez de `"../.."`) resuelve donde tiene que resolver, no a la
raíz del sitio. El diseño pedía exactamente esta comprobación («cómprubalo,
no lo asumas») y así se hizo, con clic real, no con `curl -I`.

## Fallos encontrados

Ninguno de los 15 criterios falló. Cuatro hallazgos que **no** rompen ningún
criterio literal pero que vale la pena que alguien decida qué hacer con ellos
— ver § Preguntas al humano. Los dos primeros salieron del primer ciclo de
pruebas (HTTP y sync); el 3 y el 4 salieron de escribir
`.agent/specs/F-026/visual.mjs` en el segundo ciclo, a pedido del
coordinador, porque `bash .agent/sdd.sh done F-026` se negaba sin él
(`design.md` § Verificación visual, V1–V11, nunca se había ejecutado).

1. **[hallazgo, no bloqueante] El 404 de categoría no se puede navegar sin
   JavaScript — y es un problema de toda la app, no de este feature.**
   `curl` contra `http://localhost:3200/tienda-demo/c/no-existe` (con
   `next build && next start`, para descartar que fuera un artefacto de
   `next dev`) devuelve **cero** etiquetas `<a>` reales en el HTML: ni el
   enlace de salida ni siquiera el enlace de la cabecera del `layout`
   (`href="/tienda-demo"`, que en cualquier página 200 SÍ es HTML real —
   comprobado, 23 `<a>` en `/tienda-demo`). Todo el contenido de la página
   —incluido el texto que SÍ aparece como subcadena legible en la
   respuesta— viaja únicamente dentro del payload de React Flight que Next
   serializa para la hidratación (`{"href":"..","children":"Ver todo el
catálogo"}`, con las comillas escapadas de verdad,
   `\"href\":\"..\"`), nunca como marcado servido. **No es nuevo de F-026**:
   se comprobó lo mismo contra `src/app/[slug]/pedido/[code]/not-found.tsx`
   (de F-011/F-012, que este feature dice haber calcado) y contra el 404
   global de la app (`/esta-marca-no-existe-nunca`) — los tres, cero `<a>`.
   Es una característica de cómo Next 16 (con Turbopack, en dev y en
   `next start`) renderiza los `notFound()` de esta app entera, no algo que
   el código de F-026 haya roto. **Por qué no cuenta como fallo de este
   feature**: ninguno de los 15 criterios lo pide tal como está escrito —
   el criterio 14 es sobre el enlace del SELECTOR hacia una vista 200
   (que sí es HTML real, comprobado), no sobre el enlace de salida de un
   404 — y V9 (que sí pide comprobar el enlace) se verificó **con el
   navegador**, que sí ejecuta JavaScript, que es como llega la inmensa
   mayoría de los compradores. Pero si un día importa (un lector con JS
   desactivado, un rastreador, un `curl` de monitoreo) hoy se queda sin
   salida en el 404 de categoría — un caso que R6 dice explícitamente que
   no debería pasar («ninguna navegación puede volver un producto
   inalcanzable»). `.agent/specs/F-026/smoke.sh` deja esto como una
   comprobación `CONOCIDO` (no suma a `FAILS`) para que se note si algún
   día empieza o deja de pasar. **Va a `sdd-architect`**, porque es
   transversal a al menos tres `not-found.tsx` de features distintos y
   pide una decisión de estrategia de render (¿PPR? ¿otro patrón de
   streaming?), no un parche de una línea en un archivo de este feature.

2. **[hallazgo, no bloqueante] Dos builds seguidos sin borrar `.next/cache`
   no ven los cambios de la base entre uno y otro.** Se hizo el
   experimento sin querer: tras las mutaciones de sync de los criterios
   9-11 (borrar «Panadería», crear «Café»/«CAFÉ»), un `npm run build`
   fresco siguió listando `tienda-demo/c/panaderia` en el manifiesto de
   prerenderizado de Next (`prerender-manifest.json`, bajo `.next/`, un
   artefacto de build, no un archivo del repositorio) y **no** listaba
   `cafe`/`cafe-2` — los
   archivos de `.next/cache/fetch-cache/` tenían fecha de 18 minutos antes
   del build (dentro del `STOREFRONT_REVALIDATE` de 3600 s de
   `src/lib/cache.ts`) y ninguno se tocó durante el build. Es
   `unstable_cache` persistiendo en disco entre invocaciones separadas de
   `next build` — el `revalidateTag()` que sí corrió (en el proceso del
   `next dev` que atendía los eventos de sync) nunca llegó al proceso de
   `next build`, que es otro proceso con su propia sesión de caché en
   disco pero que aparentemente no la refresca si el TTL no expiró.
   **No es un bug de F-026**: el mecanismo (`cached()`,
   `STOREFRONT_REVALIDATE`) es de F-004 y F-026 solo lo reutiliza tal cual
   para `getStoreCategories`/`getStoreCategoryView`, calcado del patrón que
   ya usaba `getStoreCatalog`. No afecta al criterio 12 (que solo exige la
   marca ●, presente igual) ni a ningún otro de los 15 (todos se verificaron
   contra el servidor VIVO, que sí revalida correctamente porque el sync y
   la lectura pública corren en el mismo proceso — que es como funciona de
   verdad en producción, un solo proceso largo, no un rebuild por evento).
   Es, sin embargo, un riesgo operativo real si algún día el pipeline de
   despliegue cachea `.next/cache` entre builds (una optimización común):
   un deploy podría hornear una lista de categorías vieja hasta que el TTL
   expire o llegue un evento de sync en el proceso YA desplegado. **Va a
   `sdd-architect`** para decidir si vale una nota en
   `docs/despliegue.md` o en un ADR — no bloquea el veredicto de este
   feature porque no lo causa ni lo prueba ningún criterio.

3. **[hallazgo, va a `sdd-designer`/`sdd-implementer`] Tabulando por el
   selector a 360px, el chip «Bebidas» se queda con el anillo de foco
   parcialmente fuera de la pantalla — `design.md` § V5 exige que se vea
   **entero**.** Medido con Playwright (`.agent/specs/F-026/visual.mjs`,
   V5), estable en **cinco** corridas seguidas, con y sin `.next/cache`
   limpio: al enfocar «Bebidas» con `Tab`, `nav.scrollLeft` sigue en `0` —
   el navegador NO desplaza la fila. Comprobado que sí lo hace con
   «Panadería» (que arranca **totalmente** fuera de pantalla): el
   mecanismo nativo de scroll-al-enfocar de Chromium solo actúa cuando el
   elemento está **completamente** fuera de vista; si ya asoma aunque sea
   un poco (como «Bebidas», que empieza dentro de los 360px y termina
   fuera — el propio caso que V1 pide), el navegador lo da por «ya
   visible» y no completa el desplazamiento. No es un artefacto de
   Playwright: el mismo evento de teclado sí dispara correctamente el
   estilo `:focus-visible` en ese mismo chip (comprobado, `outline-width >
0`) — es el comportamiento real y documentado de scroll-into-view del
   navegador, no una limitación del arnés de prueba. **Por qué no lo
   ablando**: R9 prohíbe una línea de JavaScript para arreglarlo
   (`scrollIntoView` manual sería exactamente el `"use client"` que R9
   veta), así que esto no tiene arreglo dentro de las reglas que el propio
   `design.md` se puso — necesita que alguien decida: aceptarlo por
   escrito (como PP2 aceptó el contraste heredado), o cambiar el diseño
   (más espacio entre chips para que ninguno asome parcialmente al
   entrar en pantalla, por ejemplo). **Relacionado, mismo paso V1**: el
   propio texto de `design.md` da por hecho que el chip que asoma cortado
   es «Panadería» («la cuarta [categoría]»); medido de verdad, el que
   asoma es «Bebidas» (la tercera) y «Panadería» queda totalmente oculta.
   `visual.mjs` ya no asume el nombre — verifica la propiedad estructural
   (cuál sea que asome, que asome cortado) — pero la discrepancia con el
   nombre que dan por sentado tanto `design.md` como este mismo hallazgo
   de V5 (que si el diseño hubiera dicho «Bebidas» habría acertado el chip
   real) es la misma raíz: **quien escribió `design.md` midió con datos o
   una fuente distintos a los de este entorno**, y vale la pena que
   `sdd-designer` repita la medición aquí antes de decidir sobre V5.

4. **[hallazgo, confirma y amplía el #2] La misma foto vieja de la caché
   de datos de Next también aparece reiniciando `next dev`, no solo entre
   dos `npm run build`.** Al escribir `visual.mjs`, cada corrida sucesiva
   de `bash .agent/verify.sh F-026 --visual` (que arranca su propio
   `next dev` cuando no reutiliza uno propio) mostraba, en criterios V1 y
   V5, categorías **de la corrida ANTERIOR** («Visual Categoria NN
   `<sufijo-viejo>`») que ya no existían en la base — confirmado con
   `psql` en el momento exacto: la base ya estaba limpia (5 `LocalCategory`
   reales), pero la RESPUESTA seguía sirviendo las 20 de la corrida
   anterior. `rm -rf .next` antes de levantar el servidor lo resuelve por
   completo (verificado: con `.next` borrado, la corrida es idéntica a una
   invocación manual y solo queda el hallazgo #3). Causa: `.next/cache/
fetch-cache/` sobrevive al reinicio del proceso de `next dev` en disco,
   y el `revalidateTag()` de la limpieza de la corrida anterior —que
   `visual.mjs` y `smoke.sh` ya hacían mal al principio (limpiaban con
   `DELETE` directo de `psql`, que **nunca** invalida la caché — se
   corrigió en ambos guiones en este mismo ciclo, con un evento
   `PRODUCT/UPDATE` trivial al final de la limpieza) alcanzó a escribirse
   en memoria, pero puede no haberse asentado a tiempo en el manifiesto de
   disco antes de que `verify.sh` matara el proceso. **No es un bug de
   F-026** (mismo mecanismo de F-004 que ya documentaba el hallazgo #2),
   pero si `sdd-architect` decide actuar sobre el #2, esta es la mitad que
   falta: afecta también a `next dev`, no solo a `next build`.

## Qué cubre el visual y qué no

`.agent/specs/F-026/visual.mjs` (nuevo, este ciclo) traduce los **once** pasos
V1–V11 de `design.md` § Verificación visual. Corre con
`bash .agent/verify.sh F-026 --visual`; **hay que borrar `.next` antes de la
primera corrida de una sesión** (hallazgo #4) o los primeros pasos (V1, V5)
pueden leer una foto vieja de una corrida anterior — no es opcional, es la
diferencia entre un guion que prueba algo y uno que prueba su propia caché.

| Paso | Se tradujo                                                                                                                                                                                                                                                                                                                                                 | Resultado                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| V1   | Sí                                                                                                                                                                                                                                                                                                                                                         | **LISTO**, con una nota: el chip que asoma cortado es «Bebidas», no «Panadería» como asume el texto de `design.md` (hallazgo #3) |
| V2   | Sí (envuelve con volumen real se comprueba en V10, no aquí — con las 4 categorías reales no hace falta envolver, y forzar esa aserción habría sido un falso fallo, no un hallazgo)                                                                                                                                                                         | **LISTO**                                                                                                                        |
| V3   | Sí                                                                                                                                                                                                                                                                                                                                                         | **LISTO**                                                                                                                        |
| V4   | Sí (columnas, ancho de tarjeta y `gap`, comparados con cajas medidas en los tres anchos, no a ojo)                                                                                                                                                                                                                                                         | **LISTO**                                                                                                                        |
| V5   | Sí                                                                                                                                                                                                                                                                                                                                                         | **NO LISTO** para el chip «Bebidas» — hallazgo #3, va a `sdd-designer`/`sdd-implementer`                                         |
| V6   | Sí (radio de esquina, verde de marca, contraste en oscuro)                                                                                                                                                                                                                                                                                                 | **LISTO**                                                                                                                        |
| V7   | **Deliberadamente no traducido** — `smoke.sh` ya lo cubre con `curl`, que no ejecuta ni un byte de JavaScript: más estricto que cualquier navegador con JS desactivado. Traducirlo aquí también no habría aportado nada distinto                                                                                                                           | —                                                                                                                                |
| V8   | Sí (sin fila ni en el catálogo ni en la vista de categoría bajo `SUSPENDED`)                                                                                                                                                                                                                                                                               | **LISTO**                                                                                                                        |
| V9   | Sí — y aporta algo que `smoke.sh` no puede: sigue el enlace de verdad (clic real, headless) y comprueba a dónde ATERRIZA, algo que `curl` no puede ver porque nunca resuelve un `href` relativo contra la URL actual. Reemplaza la comprobación manual con la extensión de Chrome (que pedía un humano) por una reproducible en cualquier máquina con Bash | **LISTO**                                                                                                                        |
| V10  | Sí, con 15 categorías sembradas y limpiadas por sync real (nunca `psql` a secas — hallazgo #4)                                                                                                                                                                                                                                                             | **LISTO** (incluida la comprobación de que SÍ envuelve a 768/1280 con volumen, que es donde V2 de verdad se ejercita)            |
| V11  | Sí, con una sucursal sintética creada y borrada por sync + SQL de sucursal completa (cascada `Storefront → Store → StoreProduct`)                                                                                                                                                                                                                          | **LISTO**                                                                                                                        |

## Huecos de cobertura

Lo que no tenía prueba automatizada antes de este ciclo, y lo que sigue sin
tenerla:

- **Cerrado en este ciclo**: F-026 no tenía `smoke.sh` — a diferencia de
  F-007, F-010, F-011, F-012, F-017, F-018, F-019, F-023 y F-028, que sí lo
  tienen. Se escribió `.agent/specs/F-026/smoke.sh` (45 aserciones), que
  cubre los criterios 1-11 y 14, más V9, contra el servidor real y con
  eventos de sync reales — exactamente lo que este documento no puede dejar
  solo en la bitácora de una sesión. Corre con
  `bash .agent/verify.sh F-026 --smoke` y se autolimpia (borra por SQL
  directo, al final, únicamente lo que él mismo creó con su propio sufijo
  de ejecución — nunca la fixture original).
- **Sigue sin cobertura automatizada de test unitario/integración**:
  `getStoreCategories`/`getStoreCategoryView`
  (`src/features/catalog/server/queries.ts`) — los envoltorios que de
  verdad tocan Prisma — no tienen ningún test propio; solo sus dos
  derivaciones puras (`deriveStoreCategories`/`productsOfCategory` en
  `storeCategories.ts`, 8 tests) están cubiertas a nivel unitario. Es
  consistente con el resto del repo (`getStoreCatalog` tampoco tiene test
  propio, solo se ejerce vía `smoke.sh`/`search.db.test.ts`), así que no es
  un hueco NUEVO de F-026 — pero ahora que existe `smoke.sh` sería barato
  añadir un `queries.db.test.ts` que cubra el `null` de una categoría de
  otra sucursal (criterio 5) sin depender de un servidor levantado.
- **`categorySlug` en `search.ts` (PP1) no tiene ninguna aserción propia**
  en `search.db.test.ts` — se comprobó que compila (la razón por la que
  PP1 se aceptó) y, indirectamente, que las páginas que lo consumen
  funcionan, pero ningún test de búsqueda afirma sobre el valor de
  `categorySlug` en un resultado. Bajo riesgo (es una proyección de una
  columna que ya se leía para `categoryName`, mismo JOIN), pero es la
  clase de "cero tests rojos, comportamiento roto en silencio" que
  `AGENTS.md` pide evitar si alguien lo toca después.
- **La asimetría del umbral de "≥2 categorías" no se comprobó con datos
  reales**: `design.md` § Inventario fija el umbral para la pantalla
  `/[slug]` (`categories.length >= 2` en `src/app/[slug]/page.tsx:153`),
  pero la vista de categoría (`/[slug]/c/[categorySlug]/page.tsx`) monta
  `StoreCategoryNav` sin ese mismo chequeo — no hay una tienda con
  exactamente 1 categoría en la base de desarrollo para probarlo sin
  sembrarla, y ningún criterio de los 15 lo exige. Queda como pregunta,
  no como fallo (§ Preguntas al humano, TP1).

## Preguntas al humano

**TP1 — ¿La vista de categoría (`/[slug]/c/[categorySlug]`) debería aplicar
el mismo umbral de "≥2 categorías" que `/[slug]` para mostrar el selector, o
es correcto que siempre lo muestre (incluso con una sola categoría)?**
`design.md` § Inventario solo escribe el umbral para la pantalla `/[slug]`;
la tabla de la vista de categoría no lo menciona. Hoy `tienda-demo` tiene 4
categorías así que esto nunca se ejercita con datos reales. Es una
inconsistencia menor de forma, no de dato — recomiendo (a) dejarlo como está
(en la vista de categoría, "Todo el catálogo" + la propia categoría SÍ es una
elección real, a diferencia de `/[slug]` con una sola categoría, donde las
dos opciones muestran lo mismo), pero lo firma `sdd-designer` o `sdd-spec`,
no yo.

**TP2 — Los hallazgos 1 y 2 de § Fallos encontrados (el 404 sin salida
navegable sin JavaScript, transversal a tres features; y la posible
foto vieja de un `next build`/`next dev` si no se borra `.next/cache` entre
invocaciones — confirmado también en `next dev`, hallazgo #4) ¿abren
feature/ficha aparte, o se aceptan por escrito como en PP2 de `plan.md`?**
Los dos son pre-existentes (no los causa F-026) y ninguno rompe un criterio
de los 15, pero el primero contradice la letra de R6 en el caso límite de
"sin JavaScript", y el segundo es un riesgo operativo real si algún día se
cachea `.next/cache` en CI/CD. Recomiendo `sdd-architect` para los dos, con
la misma lógica que ya usó `plan.md` para PP2: aceptar por escrito o abrir
feature/ficha, decisión del arquitecto con el humano si toca alcance.

**TP3 — El hallazgo 3 (V5: el chip «Bebidas» no se desplaza entero a la
vista al enfocarlo con `Tab` a 360px) ¿se acepta como límite del propio
mecanismo nativo del navegador (sin JS, por R9), o `design.md` cambia el
espaciado de los chips para que ninguno empiece a asomar antes de estar
totalmente fuera de pantalla?** Confirmado estable en cinco corridas,
independiente de caché o de qué categoría real ocupe esa posición: es el
propio comportamiento de scroll-al-enfocar de Chromium (actúa solo si el
elemento está **totalmente** fuera de vista), no un defecto del código de
F-026 ni del arnés de prueba. Arreglarlo con una línea de `scrollIntoView`
violaría R9 (`AGENTS.md` § Prohibiciones) tal como el propio `design.md` ya
anticipó («No hay JavaScript que lleve la fila hasta el chip activo, y no
lo va a haber»); esa frase habla de la fila SIGUIENDO al chip activo al
navegar, no del navegador completando su propio scroll nativo al enfocar
con `Tab`, así que no cierra la pregunta por sí sola. Recomiendo
`sdd-designer`: o se acepta por escrito (mismo patrón que PP2), o se ajusta
`gap`/gap del contenedor para que ningún chip quede a medias al entrar en
pantalla. De paso, `sdd-designer` puede confirmar si «Bebidas» (no
«Panadería») es de verdad el chip que se midió al escribir V1 — con los
datos de esta base de desarrollo, es «Bebidas» el que asoma cortado.

## Veredicto

**`listo`** — los 15 criterios de `.agent/features.json` se verificaron
ejecutando algo real (HTTP, sync, build, navegador), ninguno se dio por bueno
leyendo código, y `bash .agent/verify.sh F-026 --full` termina en 0 dos veces
seguidas al cierre de esta sesión, con la fixture de la base de desarrollo
restaurada carácter a carácter a como estaba al empezar.

**`bash .agent/verify.sh F-026 --visual` NO termina en 0**: sale en **2**
(`ESTANCADO`, la misma firma cinco veces seguidas: `VISUAL FAIL V5 — a
360px, el chip enfocado ("Bebidas") queda dentro de la ventana`). Es el
hallazgo #3 de § Fallos encontrados, confirmado estable, único, y aislado de
cualquier ruido de caché (§ hallazgo #4) — no un guion roto. **No baja el
veredicto de los 15 criterios** porque design.md § V1–V11 es una capa de
verificación **del diseñador**, distinta de `.agent/features.json` § los 15
`acceptance_criteria` que gobiernan este campo (la propia plantilla de este
documento lo dice: LISTO exige que se verifiquen los criterios de
aceptación, no cada paso V* de cada `design.md`). Pero **es un fallo real,
reproducible y sin ablandar**, y por eso: `bash .agent/verify.sh F-026
--visual` queda en rojo a propósito, documentado aquí y en el propio guion
(`VISUAL FAIL`, no un `note()` que lo esconda), y las preguntas TP2/TP3
piden una decisión de `sdd-designer`/`sdd-architect` antes de que alguien
intente ponerlo en verde sin más contexto que el código de salida.

Los cuatro hallazgos de § Fallos encontrados son reales y quedan
documentados y con prueba (`CONOCIDO` en `smoke.sh` para el primero,
`VISUAL FAIL` estable para el tercero), pero ninguno de los 15 criterios,
tal como están escritos, los exige — por eso no bajan el veredicto de los 15,
y por eso van a `sdd-architect`/`sdd-designer` como preguntas (TP2, TP3), no
como bloqueo silencioso.
