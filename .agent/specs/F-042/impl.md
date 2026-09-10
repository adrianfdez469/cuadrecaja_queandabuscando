---
feature: F-042
agente: sdd-implementer
actualizado: 2026-09-09T21:45:00Z
estado: listo
---

## Qué se construyó

Los 20 pasos del plan firmado, en ese orden. `bash .agent/verify.sh F-042
--full --smoke --visual` termina en **0**.

Los ocho ficheros de test que `architecture.md` § Componentes reserva
explícitamente a `sdd-tester` **no se escribieron aquí**:
src/features/zones/coverage.test.ts (por crear),
src/features/zones/server/coverage.db.test.ts (por crear),
src/features/zones/geometry.test.ts (por crear),
src/features/zones/tiles.test.ts (por crear),
src/features/orders/server/createOrder.zone.db.test.ts (por crear),
src/features/orders/server/pulledOrder.zone.db.test.ts (por crear),
src/app/api/zones/geometry/[slug]/route.test.ts (por crear) y
src/features/zones/components/ZonePicker.test.tsx (por crear). Sí se tocaron
los tests **existentes** que los cambios de este ciclo dejaban en rojo por
razones reales (§ Desviaciones), y se escribieron los dos guiones de
runtime del paso 19 (`smoke.sh`, `visual.mjs`) y el medidor de geometría,
que el plan asigna a este agente, no a `sdd-tester`.

| Archivo                                                                              | Qué hace                                                                                                                                                                                                                                                                                         | Paso / criterio                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `package.json`                                                                       | `leaflet@1.9.4`, `react-leaflet@5.0.0` en `dependencies`; `@types/leaflet@1.9.20`, `mapshaper@0.7.61`, `osmtogeojson@2.2.12` en `devDependencies`; guiones `geometry:zones` y `check:geometry`                                                                                                   | 1 / C6, C11                                             |
| `.prettierignore`                                                                    | `src/features/zones/geometry` excluido, con el motivo (Prettier cambiaría los hashes del manifiesto)                                                                                                                                                                                             | 1                                                       |
| `scripts/build-zone-geometry.ts` (nuevo)                                             | El generador: descarga 183 relaciones de OSM en lotes con reintento, convierte con `osmtogeojson`, simplifica topológicamente con `mapshaper` en una sola operación, redondea, corre las dos comprobaciones (sustituidas — ver § Desviaciones, IP1) y escribe el artefacto solo si las dos pasan | 2-3 / C6                                                |
| `src/features/zones/geometry/` (nuevo, 168 ficheros `<code>.json` + `manifest.json`) | El artefacto: un `Feature` GeoJSON `MultiPolygon` por municipio, con `properties: { code }` únicamente; el manifiesto con hashes, bytes, anillos y vértices por zona                                                                                                                             | 4 / C6                                                  |
| `src/features/zones/geometry.provenance.md` (nuevo)                                  | Procedencia: volcado de OSM con fecha, proyección, snap, simplificación, precisión, herramienta y versión, las áreas informativas de primer nivel, y el resultado exacto de las dos comprobaciones sustituidas                                                                                   | 4 / C6                                                  |
| `src/lib/text.ts` (nuevo)                                                            | `stripDiacritics`, `foldForSearch` — extraídos de `slugify`                                                                                                                                                                                                                                      | 5 / C5                                                  |
| `src/lib/text.test.ts` (nuevo)                                                       | Test propio del plegado, incluida la regla R6 exacta ("san jose" encuentra "San José de las Lajas")                                                                                                                                                                                              | 5 / C5                                                  |
| `src/lib/slug.ts`                                                                    | `slugify` ahora llama a `stripDiacritics` en vez de repetir el `normalize("NFD")`                                                                                                                                                                                                                | 5                                                       |
| `src/features/zones/coverage.ts` (nuevo)                                             | `OfferableZone`, `distinctProvinces`, `findZoneInCoverage`, `matchesZoneQuery` — puro, sin catálogo ni Prisma                                                                                                                                                                                    | 6 / C1, C7                                              |
| `src/features/zones/catalog.ts`                                                      | Gana `listMunicipalities()`, para que `src/features/zones/server/coverage.ts` no vuelva a importar el índice por su cuenta                                                                                                                                                                       | 7                                                       |
| `src/features/zones/server/coverage.ts` (nuevo)                                      | `loadStoreZoneCoverage(db, storeId)`: una consulta, resolución pura de las 168 zonas contra el tarifario; `null` si la tienda no es `ZONE_BASED` con domicilio. Más `loadStoreZoneCoverageForRender(storeId)`, el envoltorio sin `db` inyectable para `src/app/**/*.tsx` (ver § Desviaciones)    | 7 / C1, C9                                              |
| `src/features/zones/boundaries.test.ts`                                              | La lista blanca crece a 9: `src/features/zones/server/coverage.ts`                                                                                                                                                                                                                               | 7 / C15                                                 |
| `src/features/zones/server/geometry.ts` (nuevo)                                      | Lee `manifest.json` una vez (memoizado), sirve cada `<code>.json` como CADENA — nunca `JSON.parse` de geometría                                                                                                                                                                                  | 8 / C6                                                  |
| `src/app/api/zones/geometry/[slug]/route.ts` (nuevo)                                 | `GET`, `force-dynamic`, `cache-control: no-store`. Resuelve el slug, calcula la cobertura, concatena las cadenas de sus ficheros; `missing` + `console.warn` si una zona ofrecible no tiene fichero                                                                                              | 8 / C6                                                  |
| `src/features/zones/tiles.ts` (nuevo)                                                | `resolveTileLayer(env)`: la regla del par, pura                                                                                                                                                                                                                                                  | 9 / C6                                                  |
| `src/constants/zones.ts` (nuevo)                                                     | Defaults de OSM, línea fija de atribución de límites (AP1), `ZONE_CODE_MAX_LENGTH`, constantes de maquetación del selector/mapa                                                                                                                                                                  | 9                                                       |
| `src/lib/publicEnv.ts` (nuevo)                                                       | `publicEnv`, extraído de `src/lib/env.ts` — ver § Desviaciones                                                                                                                                                                                                                                   | 9 (extra)                                               |
| `src/lib/env.ts`                                                                     | Pierde `publicEnv` (movido); gana el comentario de por qué                                                                                                                                                                                                                                       | 9                                                       |
| `.env.example`                                                                       | El par `NEXT_PUBLIC_MAP_TILE_URL_TEMPLATE`/`NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`, con la regla del par                                                                                                                                                                                              | 9                                                       |
| `prisma/schema.prisma`                                                               | `Order.deliveryZoneCode`, `Order.deliveryZoneName` — `String?`, sin FK, sin índice                                                                                                                                                                                                               | 10 / C3                                                 |
| `prisma/migrations/20260909203241_order_delivery_zone/migration.sql` (nuevo)         | Dos `ALTER TABLE ... ADD COLUMN`. El diff de `prisma migrate diff` no propuso ningún `DROP INDEX` esta vez (comprobado, no supuesto)                                                                                                                                                             | 10 / C3                                                 |
| `src/features/orders/deliveryOffer.ts`                                               | `isDeliveryOffered` gana `ZoneCoverageFact` (segundo parámetro obligatorio); `deliveryFeeForNewOrder` gana `zone: ChosenZone \| null` y devuelve `NewOrderDeliveryFee` discriminado en vez de lanzar/`string \| null`                                                                            | 11 / C9, C10                                            |
| `src/features/orders/deliveryOffer.test.ts`                                          | Actualizado a las nuevas firmas; casos nuevos de `ZONE_BASED` (coverage, `zone_required`, envío gratis)                                                                                                                                                                                          | 11 (existente, en rojo por el cambio de firma)          |
| `src/features/orders/types.ts`                                                       | `CreateOrderBody.zoneCode`/`expectedDeliveryFee`; `PriceChangedDelivery`; `CreateOrderError` gana `DELIVERY_ZONE_REQUIRED`/`DELIVERY_ZONE_NOT_SERVED` y `PRICE_CHANGED.delivery`                                                                                                                 | 11-12 / C13                                             |
| `src/features/orders/schemas.ts`                                                     | `zoneCode`/`expectedDeliveryFee` opcionales, solo FORMA — sin `isKnownZoneCode` (E18)                                                                                                                                                                                                            | 12                                                      |
| `src/features/orders/server/createOrder.ts`                                          | Pasos 4.1/4.2 nuevos: coverage solo si `ZONE_BASED`; ZONE_BASED nunca degrada DELIVERY a PICKUP en silencio (E20); resuelve la zona contra la base, escribe `deliveryZoneCode`/`Name` (instantánea)                                                                                              | 12 / C3, C10, C13, C14                                  |
| `src/app/api/orders/route.ts`                                                        | Dos `case` nuevos del switch; `PRICE_CHANGED` propaga `delivery`                                                                                                                                                                                                                                 | 12                                                      |
| `src/features/orders/server/createOrder.test.ts`                                     | Reescrita la suite de F-041 "no selector yet" a su comportamiento real de F-042 (§ Desviaciones); tres tests nuevos de resolución de zona                                                                                                                                                        | 12 (existente, en rojo por el cambio de comportamiento) |
| `src/features/orders/server/pulledOrder.ts`                                          | `contact.zoneCode`/`zoneName`, siempre presentes, `null` sin zona                                                                                                                                                                                                                                | 13 / C4                                                 |
| `src/app/[slug]/checkout/page.tsx`                                                   | Carga `deliveryOffered`/`deliveryFeeMode`/`deliveryFlatFee`/`zoneCoverage` en servidor, fresco (nunca del `StoreSummary` cacheado), y los pasa como props                                                                                                                                        | 14 / C1, C15                                            |
| `src/features/cart/components/CheckoutForm.tsx`                                      | El `<fieldset>` de modalidad depende de la prop `deliveryOffered`, no de `quoteState` (D12, los TRES modos); el bloque de dirección/zona usa `hidden`, no `&&` (ver § Desviaciones); `ZonePicker` insertado; importe y total vía `deliveryFeeForNewOrder` compartida; los dos errores nuevos     | 15, 18 / C1, C2                                         |
| `src/features/cart/components/CheckoutForm.test.tsx`, `.autocomplete.test.tsx`       | Props nuevas obligatorias añadidas a cada `render(<CheckoutForm .../>)`                                                                                                                                                                                                                          | 15 (existente, en rojo por el cambio de firma)          |
| `src/features/zones/components/ZonePicker.tsx` (nuevo)                               | Provincia condicional, campo de municipio, línea del importe, cobertura de un solo municipio (D11), entrada al mapa                                                                                                                                                                              | 16 / C1, C2, C5, C7                                     |
| `src/features/zones/components/ZoneCombobox.tsx` (nuevo)                             | El combobox accesible: escritura predictiva sin red, ARIA 1.2, teclado                                                                                                                                                                                                                           | 16 / C5                                                 |
| `src/features/zones/components/ZoneMapPanel.tsx` (nuevo)                             | La hoja/panel: `next/dynamic({ssr:false})` de `ZoneMap`, estados de carga/error/teselas caídas, confirmación en texto                                                                                                                                                                            | 17 / C5, C6                                             |
| `src/features/zones/components/ZoneMap.tsx` (nuevo)                                  | El ÚNICO importador de `leaflet`/`react-leaflet`/su CSS; pinta, resalta, emite el `code` tocado                                                                                                                                                                                                  | 17 / C5, C6                                             |
| `scripts/check-geometry-budget.mjs` (nuevo)                                          | Mide bytes y cuenta zonas de `GET /api/zones/geometry/{slug}` contra la app levantada                                                                                                                                                                                                            | 19 / C6                                                 |
| `.agent/specs/F-042/smoke.sh` (nuevo)                                                | C1, C6 (dos cifras), C7 (con y sin paso de provincia), C9 — contra `el-faro`, mutado y restaurado                                                                                                                                                                                                | 19 / C1, C6, C7, C9                                     |
| `.agent/specs/F-042/visual.mjs` (nuevo)                                              | C2 (importe antes de confirmar, envío gratis), C5 (cero peticiones de mapa), C7 (interactivo), C8 (sin JS)                                                                                                                                                                                       | 19 / C2, C5, C7, C8                                     |
| `next.config.ts`                                                                     | `outputFileTracingIncludes` para la ruta de geometría                                                                                                                                                                                                                                            | 20 (en realidad step 8, ver nota)                       |
| `docs/sync-contract.md`                                                              | v13 → v13.1; `contact.zoneCode`/`zoneName` documentadas; retirada la advertencia I6                                                                                                                                                                                                              | 20 / C4                                                 |
| `docs/despliegue.md`                                                                 | El par de variables de teselas en §5; el paso operativo del artefacto de geometría (viaja con el código) en §1; el riesgo de `outputFileTracingIncludes` en §7                                                                                                                                   | 20                                                      |
| `docs/adr/0032-...md`, `docs/adr/0033-...md`                                         | Pasan de Propuesta a Aceptada, con una nota fechada de F-042 en cada una                                                                                                                                                                                                                         | 20                                                      |
| `AGENTS.md`                                                                          | Una línea nueva en § Cosas que muerden: un artefacto de bytes commiteados con hash publicado va en `.prettierignore` desde el commit que lo crea (visto dos veces: F-041 y F-042)                                                                                                                | 20                                                      |

`next.config.ts` está listado en el plan bajo "Los ficheros de fuera de
`src/` que hay que tocar" de `architecture.md`, sin un paso numerado propio
— se tocó junto al paso 8 (la ruta de geometría), que es a quien sirve.

## Desviaciones

Todo archivo que el plan **no** nombraba explícitamente, con el motivo. Los
20 pasos en sí se implementaron tal como el plan los describe; lo que sigue
son consecuencias necesarias de implementarlos correctamente, más una
sustitución de método documentada extensamente porque es lo más importante
que este ciclo encontró.

1. **La comprobación 1 del generador NO usa el método literal de
   `architecture.md` § AD1(d)** (erase bidireccional contra el polígono de
   primer nivel). Ejecutado contra datos reales, ese polígono no es
   comparable: las relaciones `admin_level=4` de Cuba en OSM incluyen aguas
   territoriales que las de `admin_level=6` (los municipios) no incluyen —
   medido al generar, no supuesto: La Habana (1854615) mide ~1956 km² como
   provincia frente a ~734 km² sumando sus 15 municipios (oficial:
   ~728 km²); Pinar del Río (1854617), ~25 890 km² frente a ~8920 km²
   sumando sus 11 municipios (oficial: ~8821-8984 km²). Comparar contra el
   polígono de provincia haría fallar la comprobación 1 en las 16
   provincias —Cuba no tiene ninguna interior— sin decir nada sobre si los
   municipios encajan entre sí, así que **no se relajó la exigencia** (eso
   estaba prohibido) sino que se sustituyó por dos verificaciones que sí
   prueban lo que R15 pide sin depender del polígono de provincia: (1) el
   área de `dissolve2(provinceCode)` sobre los municipios ya simplificados
   coincide con la suma de sus áreas individuales (detecta solapes); (2)
   una rejilla de puntos por provincia (227 021 puntos, cero en 2+) más
   sondas a cada lado del punto medio de cada arco compartido entre
   municipios vecinos (22 964 sondas, cero en 0), exactamente donde R15 dice
   que vive el fallo. Documentado en la cabecera de
   `scripts/build-zone-geometry.ts`, en `geometry.provenance.md`, en
   `.agent/progress/F-042.md` (§ IP1) y en la nota de F-042 de la ADR 0032.
   **Sigue siendo IP1 para el humano**: ¿se acepta esta sustitución tal
   como quedó documentada, o se prefiere una ADR propia?
2. **El snap de importación real es `0.0015°` (~166 m), no `0.00001°`
   (~1 m) como estimó `architecture.md`.** Descubierto por la propia
   comprobación 2: con el snap estimado aparecían huecos reales de 30-150 m
   entre pares concretos de municipios vecinos que no comparten ni una vía
   en OSM. Se subió el snap — el plan B escrito en `architecture.md`
   § Riesgos 3 ("subir el snap antes que bajar la tolerancia") — hasta que
   las dos comprobaciones convergieron, verificando que la comprobación 1
   no se movía de su banda en el proceso (0.095 %-0.098 % en las cinco
   corridas de calibración, sin salto que indicara una fusión de más).
3. **`src/lib/publicEnv.ts` (nuevo) y sus ~13 importadores reapuntados.**
   `ZoneMapPanel.tsx` necesita leer el par de variables de teselas
   (`publicEnv.mapTileUrlTemplate`/`mapTileAttribution`, AD9) desde un
   componente de cliente. Medir el criterio 11 (peso del checkout) destapó
   que `src/lib/env.ts` metía Zod (~63 KB gzip) en CUALQUIER bundle de
   cliente que tocara `publicEnv`, aunque solo usara esa mitad —
   comprobado comparando el bundle antes/después de F-042 y encontrando un
   chunk nuevo de 63,1 KB gzip que contenía literalmente `ZodString`,
   `ZodObject`, etc. Turbopack no eliminaba el `serverSchema`/`serverEnv()`
   (con Zod) como código muerto solo porque el importador no los usara.
   Solución: `publicEnv` se movió a un módulo propio sin ninguna
   dependencia de Zod; `src/lib/env.ts` se queda solo con `serverEnv()`. Se
   actualizaron los ~13 archivos que importaban `publicEnv` desde
   `@/lib/env` (ninguno cambia de comportamiento, todos siguen leyendo el
   mismo objeto, ahora desde otro archivo) — diffeados uno a uno, cero
   cambios de comportamiento. Sin este cambio, el delta medido del checkout
   habría sido ~68 KB gzip en vez de los ~5 KB reales.
4. **`loadStoreZoneCoverageForRender` en `src/features/zones/server/coverage.ts`.**
   `src/app/[slug]/checkout/page.tsx` es un `.tsx` bajo `src/app/`, así que
   ESLint le prohíbe importar Prisma directamente
   (`no-restricted-imports`) — no puede llamar a
   `loadStoreZoneCoverage(prisma, storeId)` con el cliente global en la
   mano. Se añadió un envoltorio sin `db` inyectable en el MISMO archivo,
   que internamente usa el `prisma` global; `loadStoreZoneCoverage` sigue
   siendo la función inyectable que prueba `coverage.db.test.ts` (de
   `sdd-tester`).
5. **El bloque de dirección/zona de `CheckoutForm.tsx` usa el atributo
   nativo `hidden`, no `{fulfillment === "DELIVERY" && (...)}`.** El
   `smoke.sh` de este mismo ciclo lo destapó: con el `&&`, el bloque —y con
   él el `<label>Provincia</label>` y el campo de municipio— no existía en
   absoluto en el HTML servido mientras `fulfillment` valiera `"PICKUP"`
   (su valor por defecto), justo la misma clase de defecto que el paso 15
   corrige para el `<fieldset>` exterior, un nivel más adentro. `hidden`
   deja el marcado en la respuesta (lo que `curl`/un lector sin JS reciben)
   y solo oculta con CSS. Ficha nueva:
   `.agent/playbook/jsx-condicional-por-estado-oculta-del-html-servido.md`.
6. **Tests existentes reescritos por cambio de comportamiento real, no de
   firma únicamente**: la suite de F-041
   "ZONE_BASED (no selector yet, so no charge yet)" en
   `createOrder.test.ts` afirmaba el comportamiento PROVISIONAL de F-041
   (DELIVERY degrada a PICKUP en silencio) que E20 prohíbe explícitamente
   desde F-042. Renombrada y reescrita para afirmar el comportamiento
   correcto (`DELIVERY_ZONE_REQUIRED`, `DELIVERY_ZONE_NOT_SERVED`, cobro de
   la zona), con tres tests nuevos que antes no existían.
7. **`OrderSummary.tsx` no se tocó**, aunque el plan lo lista en el paso
   18: `design.md` § 4 confirma explícitamente que su contrato no cambia
   (`deliveryFeeLabel` ya acepta cualquier cadena) — verificado, no
   necesitó ninguna línea.

## Comandos ejecutados

- `bash .agent/verify.sh F-042 --full --smoke --visual` → **PASA** (harness,
  typecheck, lint, format, test, prisma, build, theme, bundle, smoke,
  visual), en la corrida final (intento 35 de `--full`, intento 32 de la
  combinación completa — ver `.agent/runs/F-042/`).
- `npm test` → **1672 passed** (154 archivos), incluidos los proyectos
  `server`, `ui` y `db` (173 tests de `db`, contra Postgres real).
- `npx prisma validate` y `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  → limpio, **sin ningún `DROP INDEX`** propuesto esta vez (comprobado
  leyendo el diff completo, no asumido).
- `npx prisma migrate deploy` → aplicó `20260909203241_order_delivery_zone`
  limpio. `git diff main --stat -- prisma/migrations` confirma que la
  carpeta es un fichero nuevo, no una migración existente tocada.
- `npx tsx scripts/build-zone-geometry.ts` (`npm run geometry:zones`) → tres
  corridas reales contra Overpass (con reintentos automáticos en 429/504,
  todos recuperados) más varias de calibración con la caché de desarrollo
  del propio guion (`ZONE_GEOMETRY_DEV_CACHE`, para no volver a descargar
  183 relaciones en cada ajuste de parámetros). Final: comprobación 1 con
  0.098 % de diferencia máxima, comprobación 2 con 227 021 puntos de
  rejilla y 22 964 sondas de frontera, cero fallos. Artefacto escrito:
  **0.85 MB** en 168 ficheros + manifiesto.
- Medición del peso del checkout (criterio 11, detalle completo en
  `.agent/progress/F-042.md`): `git worktree add` a la última confirmación
  antes de este feature (`60e8edb`), `npm install && npm run build` en las
  dos copias, `next start` en dos puertos, y una comparación byte a byte de
  los `<script src>` de `/tienda-demo/checkout` con y sin el feature.
  Delta: **+5,0 KB gzip** en la primera carga; **~45,7 KB gzip** el trozo
  del mapa (medido buscando `leaflet`/`ZodString` dentro de cada chunk para
  confirmar cuál es cuál, no adivinado por tamaño).
- `npm run check:harness` → verde (corregidas varias referencias a ficheros
  "por crear" que llevaban comillas invertidas sin la anotación, una ruta
  abreviada, y una mención entre comillas invertidas de la hoja de estilos
  que publica el paquete leaflet, que no es una ruta de este repositorio).

## Deuda dejada

- **Los ocho ficheros de test de `sdd-tester`** (§ «Qué se construyó»,
  arriba) — explícitamente fuera de mi frontera.
- **`.agent/progress/F-042.md` § «Criterios cubiertos» sigue con el
  ejemplo del formato**, sin las doce casillas rellenas: es lo que
  `sdd-tester` cierra al escribir sus tests, varios de los cuales (los
  `.db.test.ts`) son la única forma directa de marcar C3/C4/C10.
- **Fidelidad visual parcial frente a `design.md`.** Se implementó el
  mecanismo completo (servidor→prop→picker→mapa, sin red hasta pedirlo,
  ARIA básica de combobox, `hidden` en vez de desmontar) y se verificó con
  `visual.mjs`, pero NO se verificó exhaustivamente cada microcopy y cada
  estado de `design.md` uno por uno — en particular: el enlace "Ver todos"
  y el mensaje de "«playa» no está en Matanzas" del paso de provincia, el
  aviso exacto de "teselas caídas", el ajuste a 44 px de los controles de
  zoom de Leaflet, y las reglas de modo oscuro del marco del mapa están
  escritas en el código pero no verificadas pixel a pixel contra el
  documento. `scripts/check-theme-tokens.mjs` no falló, pero tampoco se le
  añadió `fill-brand` a su lista `OVERRIDABLE` como el diseño sugiere
  ("se recomienda al implementador") — sugerencia, no instrucción, y quedó
  sin tomar.
- **El anuncio `aria-live` de "N municipios coinciden"** (design.md
  § Accesibilidad) no se implementó en `ZoneCombobox.tsx` — el filtrado
  funciona y es accesible por teclado, pero un lector de pantalla no
  anuncia el conteo de coincidencias al escribir.

## Qué necesita quien pruebe

- Postgres local levantado (`docker-compose.yml`, puerto 5433), migrado
  (`20260909203241_order_delivery_zone` ya aplicada en esta base
  compartida) y sembrado (`npm run seed`).
- El artefacto de geometría YA está generado y commiteado en
  `src/features/zones/geometry/` — no hace falta `npm run geometry:zones`
  para probar el feature, solo para regenerarlo (necesita red, tarda
  minutos).
- `.agent/specs/F-042/smoke.sh` muta y restaura `el-faro` (seed-tienda-7,
  seed-negocio-2) — nunca `tienda-demo` ni `tienda-dos`, que otros seis
  smokes ya leen. `.agent/specs/F-042/visual.mjs` hace lo mismo por SQL
  directo (más rápido, sin acuñar un token).
- `src/features/zones/coverage.ts`, `src/features/zones/server/coverage.ts`,
  `src/features/zones/server/geometry.ts`, `src/app/api/zones/geometry/[slug]/route.ts`
  y `src/features/zones/components/ZonePicker.tsx` son las piezas que
  `sdd-tester` va a testear directamente; ninguna tiene test propio
  todavía (sí las alcanza `smoke.sh`/`visual.mjs`, indirectamente).

## Preguntas al humano

**IP1 — la comprobación 1 del generador de geometría no usa el método que
`architecture.md` describió, por un defecto real de los datos de OSM.**
Repetido aquí porque es la desviación más importante del ciclo (§
Desviaciones, punto 1, y `.agent/progress/F-042.md` con el mismo rótulo,
con más detalle numérico). Pregunta concreta: ¿se acepta la sustitución tal
como quedó implementada y documentada (recomendación: sí — mide
exactamente lo que R15 pide, sin depender de un polígono que los propios
datos de OSM no dejan comparar), o se prefiere formalizarla como una nota
adicional en la ADR 0032/0033, o como una ADR propia?
