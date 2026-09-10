---
feature: F-042
agente: orquestador
actualizado: 2026-09-09T19:53:45Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Un comprador de una tienda que cobra el envío por zonas elige su municipio en el
checkout —escribiendo dos letras en una lista, o tocándolo en un mapa si no sabe
cuál es el suyo—, **ve lo que le va a costar el envío antes de confirmar**, y el
pedido llega al POS con el municipio y el importe ya resueltos. Una tienda que
todavía no ha puesto ninguna tarifa deja de ofrecer domicilio en vez de
ofrecerlo y fallar al final.

Lo que **no** cambia: el catálogo, el carrito, el resto del checkout, y el
comportamiento de las tiendas que cobran tarifa plana o cotizan a mano. Y la
v13 del contrato **sigue sin publicarse**: este feature edita el borrador.

## Pasos

Veinte, en este orden. Los pasos 1-9 son aditivos —lo único que rozan de lo que
ya funciona es la extracción del paso 5, que no cambia comportamiento—; desde el
10 se toca código vivo. Cada paso se verifica con `bash .agent/verify.sh F-042` salvo donde se
dice otra cosa; la columna «Cómo se verifica» dice lo que **añade** ese paso.

| Nº  | Qué se hace                                                                                                                                                                                                                | Archivos                                                                                                                                                                                                                                                | Criterio          | Cómo se verifica                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Dependencias, fijadas por versión: `leaflet` 1.9.4, `react-leaflet` 5.0.0, `@types/leaflet` 1.9.20; y de desarrollo, `mapshaper` y `osmtogeojson` para generar                                                             | `package.json`, `.prettierignore`                                                                                                                                                                                                                       | C6, C11           | `npm run typecheck`; `npm ls leaflet react-leaflet` resuelve a las versiones fijadas                    |
| 2   | El generador: descarga por `osmRelationId` **distinto** (183, no 184 — la Isla de la Juventud sale una vez), convierte, hace snap, simplifica **en una sola operación** con `interval=100 m`, redondea a 4 decimales       | scripts/build-zone-geometry.ts (por crear)                                                                                                                                                                                                              | C6                | Se ejecuta y termina en 0                                                                               |
| 3   | Las **dos** comprobaciones topológicas, **después** del redondeo: los municipios de una provincia reconstruyen su provincia, y cualquier punto cae en **exactamente una** zona. Si fallan, el generador no escribe nada    | scripts/build-zone-geometry.ts (por crear)                                                                                                                                                                                                              | C6                | El generador imprime las dos y sale 0; forzar un fallo lo deja en 1 sin escribir                        |
| 4   | El artefacto: 168 ficheros de municipio más el manifiesto, y su procedencia con volcado, `admin_level`, proyección, snap, tolerancia, herramienta y versión, precisión decimal, hashes, recuentos y las dos comprobaciones | src/features/zones/geometry/ (por crear), src/features/zones/geometry.provenance.md (por crear)                                                                                                                                                         | C6                | src/features/zones/geometry.test.ts (por crear): el manifiesto tiene exactamente los 168 del índice     |
| 5   | Plegado de texto sin tildes, extraído de `slugify` para no escribir el truco Unicode dos veces                                                                                                                             | src/lib/text.ts (por crear), `src/lib/slug.ts`                                                                                                                                                                                                          | C5                | Test propio; `npm test` sigue verde en los tests de `slug`                                              |
| 6   | Cobertura pura: qué zona es ofrecible, provincias distintas, búsqueda por texto plegado, desambiguación por provincia                                                                                                      | src/features/zones/coverage.ts (por crear)                                                                                                                                                                                                              | C1, C7            | src/features/zones/coverage.test.ts (por crear)                                                         |
| 7   | Cobertura de datos: **una** consulta por render, las 168 resoluciones puras con `resolveZoneTariff`, `null` si la tienda no es `ZONE_BASED`                                                                                | src/features/zones/server/coverage.ts (por crear)                                                                                                                                                                                                       | C1, C9            | src/features/zones/server/coverage.db.test.ts (por crear), contra Postgres real                         |
| 8   | Lector de geometría (sirve cada fichero **como cadena**, memoiza, nunca parsea) y la ruta pública que compone por cobertura                                                                                                | src/features/zones/server/geometry.ts (por crear), src/app/api/zones/geometry/[slug]/route.ts (por crear)                                                                                                                                               | C6                | src/app/api/zones/geometry/[slug]/route.test.ts (por crear)                                             |
| 9   | Teselas: la regla del par como función pura, las constantes, y las dos variables nuevas en el entorno                                                                                                                      | src/features/zones/tiles.ts (por crear), src/constants/zones.ts (por crear), `src/lib/env.ts`, `.env.example`                                                                                                                                           | C6                | src/features/zones/tiles.test.ts (por crear): las tres combinaciones del par                            |
| 10  | `Order` gana dos columnas de texto anulables, sin enum, sin clave ajena y sin índice. **Quitar del `migration.sql` generado los `DROP INDEX` de los cinco índices GIN y parciales** antes de aplicarlo                     | `prisma/schema.prisma`, prisma/migrations/&lt;ts&gt;\_order_delivery_zone/migration.sql (por crear)                                                                                                                                                     | C3                | `npx prisma validate`; `npm run db:migrate` y leer la tabla                                             |
| 11  | El vocabulario del envío: `isDeliveryOffered` recibe el hecho ya resuelto en un **segundo parámetro obligatorio**, y `deliveryFeeForNewOrder` deja de lanzar y devuelve un resultado discriminado de tres casos            | `src/features/orders/deliveryOffer.ts`, `src/features/orders/types.ts`                                                                                                                                                                                  | C9, C10           | `src/features/orders/deliveryOffer.test.ts`: `ZONE_BASED` **no puede** dar «sin cotizar»                |
| 12  | Crear el pedido: resuelve la zona contra la base **en ese instante**, escribe código y nombre, y devuelve los dos errores nuevos, distinguibles entre sí y de `PRICE_CHANGED`                                              | `src/features/orders/server/createOrder.ts`, `src/features/orders/schemas.ts`, `src/app/api/orders/route.ts`                                                                                                                                            | C3, C10, C13, C14 | src/features/orders/server/createOrder.zone.db.test.ts (por crear)                                      |
| 13  | El pull: dos claves más en `contact`, **siempre presentes** —en `null` cuando el pedido no lleva zona—, y el envío ya resuelto                                                                                             | `src/features/orders/server/pulledOrder.ts`                                                                                                                                                                                                             | C4                | src/features/orders/server/pulledOrder.zone.db.test.ts (por crear)                                      |
| 14  | La página del checkout carga la cobertura en servidor y la pasa como prop, junto con el hecho de si hay domicilio                                                                                                          | `src/app/[slug]/checkout/page.tsx`                                                                                                                                                                                                                      | C1, C15           | `curl` al checkout: los nombres de los municipios están en el HTML de la **primera** respuesta          |
| 15  | **Desenganchar de la cotización el `<fieldset>` de modalidad** (`CheckoutForm.tsx:772`): hoy cuelga de `quoteState === "ready"` y por eso no existe en el HTML servido. Pasa a depender del hecho que llega por prop       | `src/features/cart/components/CheckoutForm.tsx`                                                                                                                                                                                                         | C1                | El mismo `curl` del paso 14 encuentra «¿Cómo lo quieres recibir?»; los tests del checkout siguen verdes |
| 16  | El selector: escritura predictiva sobre las opciones que ya vienen en el HTML, paso de provincia condicional, desambiguación, y el control que abre el mapa                                                                | src/features/zones/components/ZonePicker.tsx (por crear), src/features/zones/components/ZoneCombobox.tsx (por crear)                                                                                                                                    | C1, C2, C5, C7    | src/features/zones/components/ZonePicker.test.tsx (por crear)                                           |
| 17  | El mapa, detrás de un `next/dynamic` con `ssr: false`: único importador de Leaflet y de su hoja de estilos, pide la geometría al renderizarse, confirma el nombre en texto antes de aceptar                                | src/features/zones/components/ZoneMapPanel.tsx (por crear), src/features/zones/components/ZoneMap.tsx (por crear)                                                                                                                                       | C5, C6            | La etapa `visual`: cargar y teclear no produce ninguna petición de geometría ni de teselas              |
| 18  | El importe en pantalla y el total, el envío del código al confirmar, y la cadena del `RadioCard` de domicilio en `ZONE_BASED`, que hoy imprime un `deliveryFee` residual                                                   | `src/features/cart/components/CheckoutForm.tsx`, `src/features/cart/components/OrderSummary.tsx`                                                                                                                                                        | C2                | La etapa `visual`: elegir una zona muestra el importe y el total lo suma, sin enviar nada               |
| 19  | El sensor de este feature: el medidor de geometría, la etapa `smoke` y la etapa `visual`                                                                                                                                   | scripts/check-geometry-budget.mjs (por crear), .agent/specs/F-042/smoke.sh (por crear), .agent/specs/F-042/visual.mjs (por crear)                                                                                                                       | C6, C8, C11       | `bash .agent/verify.sh F-042 --smoke`                                                                   |
| 20  | La documentación: el borrador del contrato a **v13.1**, el paso operativo, las dos notas fechadas en las ADR, y la lista blanca de importadores                                                                            | `docs/sync-contract.md`, `docs/despliegue.md`, `docs/adr/0032-catalogo-de-zonas-bytes-commiteados-y-la-base-como-espejo.md`, `docs/adr/0033-cobrar-el-domicilio-y-ofrecerlo-son-dos-preguntas.md`, `AGENTS.md`, `src/features/zones/boundaries.test.ts` | C4, C15           | `bash .agent/verify.sh F-042 --full` en 0                                                               |

## De dónde sale cada paso

| Paso  | Sale de                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------- |
| 1     | `.agent/specs/F-042/architecture.md` § AD1 y § AD5; D2 del progreso                                                 |
| 2-4   | `.agent/specs/F-042/architecture.md` § AD1; `.agent/specs/propuestas/zonas-de-envio.md` § «El catálogo, cerrado»    |
| 5-7   | `.agent/specs/F-042/architecture.md` § AD3; `.agent/specs/F-042/spec.md` R1, R5, R6, R7                             |
| 8     | `.agent/specs/F-042/architecture.md` § AD1, y la **AP2 que F-041 dejó abierta** y esta arquitectura contesta que sí |
| 9     | `.agent/specs/F-042/architecture.md` § AD9; D2 del progreso                                                         |
| 10    | `.agent/specs/F-042/architecture.md` § AD6; `.agent/specs/F-042/spec.md` § «Datos y contrato»                       |
| 11    | `.agent/specs/F-042/architecture.md` § AD2 y § AD4 (I4 e I3 de la spec)                                             |
| 12    | `.agent/specs/F-042/architecture.md` § AD7; `.agent/specs/F-042/spec.md` casos límite 3 y 4                         |
| 13    | `.agent/specs/F-042/spec.md` § «El pull»; D3 del progreso                                                           |
| 14    | `.agent/specs/F-042/architecture.md` § AD3 y § AD5; D5 del progreso                                                 |
| 15    | `.agent/specs/F-042/design.md` § «Lo que este diseño le exige al arquitecto», exigencia 1 — **medida**, no supuesta |
| 16-18 | `.agent/specs/F-042/design.md` § «Inventario de pantallas y estados» y § «Componentes de UI»                        |
| 19    | `.agent/specs/F-042/spec.md` § «Criterios de aceptación», C6, C8 y C11                                              |
| 20    | D4 y D6 del progreso; `.agent/specs/F-042/architecture.md` § «¿Hace falta una ADR?»                                 |

El paso 15 es el único que **no** sale de un documento escrito antes de este
plan: sale de un hallazgo del diseño que la arquitectura no recogió porque las
dos se escribieron en paralelo. Está verificado leyendo el código, no deducido —
`src/features/cart/components/CheckoutForm.tsx:772` es literalmente
`{quoteState === "ready" && deliveryOffered && (`, y en el render de servidor
`quoteState` vale `"loading"`. Va como **PP4** porque cambia lo que ve alguien
que compra en una tienda que no tiene nada que ver con este feature.

## Qué queda fuera

- **Publicar la v13.** Se edita el borrador y sube a v13.1; publicarla espera a
  F-043 y al visto bueno de cuadrecaja (D4/D6).
- **`contact.lat`/`lng`.** Ni columnas, ni clave en el pull, ni pin en el mapa
  (D7). Nada en esta pantalla las produce.
- **Geocodificar, y confiar en el GPS.** La zona la elige la persona.
- **La pantalla del tarifario del encargado**, que es de cuadrecaja.
- **Búsqueda o informes por zona, y ordenar tiendas por distancia.** No existen,
  nadie los ha pedido, y la ADR 0011 (PostGIS) **no se reabre**: el único
  punto-en-polígono lo hace Leaflet en el navegador.
- **Cotizar a mano en una tienda `ZONE_BASED`**, y tocar el ciclo de propuesta y
  aprobación de F-019/F-031.
- **Reconstruir el checkout para que funcione sin JavaScript** (D1). El paso 15
  desengancha el `<fieldset>` de la cotización, que es otra cosa: hace que el
  HTML servido contenga las opciones, no que el pedido se pueda enviar sin JS.
- **Un tercer nivel de zona, `parentCode` y la cadena de padres.** Decisión del
  humano del 2026-09-09 al triar los nueve puntos de cuadrecaja.
- **C13, C14 y C15 se construyen y se prueban, pero no son criterios** (D8):
  `sdd.sh done` sigue contando 12 casillas.

## Riesgos y plan B

1. **La geometría es la pieza que más puede salir mal, y su fallo es silencioso.**
   Si la simplificación no preserva la topología, el comprador toca su casa en el
   límite entre Playa y Marianao y el punto no cae en ninguna zona, o cae en dos
   — exactamente donde el mapa existe para ayudar. Por eso los pasos 2 y 3 están
   separados y el generador **no escribe nada** si las dos comprobaciones fallan.
   Plan B si `mapshaper` no da una topología limpia: subir la tolerancia antes
   que bajar la exigencia, y si aun así falla, el mapa se pospone a un feature
   propio y el selector sale solo — la lista es el camino primario y se sostiene
   sin él.
2. **Hay migración**, y es aditiva: dos columnas de texto anulables, sin enum,
   sin clave ajena, sin índice. No hay pérdida de datos posible. Pero
   `prisma migrate dev` propone `DROP INDEX` de cinco índices GIN y parciales que
   no están en el schema, en un diff que no tiene nada que ver con ellos: **hay
   que quitar esas líneas del `migration.sql` antes de aplicarlo**. Aplicarlo sin
   mirar no rompe ningún test y deja la búsqueda haciendo scans secuenciales en
   producción. `prisma migrate reset` y `prisma db push` están prohibidos.
3. **Hay cambio en `docs/sync-contract.md`**, y hay otro equipo al otro lado. Es
   el borrador y no lo publicado, sube a v13.1, y añade dos claves a `contact`
   que la propia v13 dejó reservadas a este feature (D3/D6).
4. **El paso 15 toca a quien no venía a esto.** Desenganchar el `<fieldset>` de
   la cotización cambia lo que ve alguien que compra en una tienda `FLAT_RATE` o
   `QUOTED_PER_ORDER`: la pregunta de cómo recibir aparece antes, en vez de
   después del parpadeo. Es una mejora de estabilidad de la página, pero es un
   cambio visible fuera del alcance nominal. Va como **PP4**.
5. **~2,4 MB commiteados** (estimados) en 169 ficheros, que se pagan enteros otra
   vez en cada regeneración. Va como **PP1**.
6. **Leaflet no lo caza ningún guardián.** `npm run check:bundle` recorre solo
   HTML prerenderizado y el checkout es `force-dynamic`: **el presupuesto de 193
   KB no mide esta página** y no hay número que subir. La cifra de Leaflet
   (~42 KB gzip) está **publicada, no medida**; el criterio 11 obliga a medirla
   con la tabla de rutas de `npm run build` y a anotarla en el progreso.
7. **Dos fuentes para el mismo hecho durante ~300 ms.** La lista viene del render
   del servidor y la cotización llega después. Si el tarifario cambia en esa
   ventana, el comprador ve una lista de hace un instante — y lo cierra el error
   al confirmar, que es el paso 12. Se acepta a propósito: la alternativa, mover
   la lista a la cotización, cuesta el D5 entero.

## Coste

Un ciclo de `sdd-implementer` y uno de `sdd-tester`, con el paso 2-4 como el
tramo largo (la descarga de 183 relaciones de Overpass y la simplificación son
minutos, no segundos, y se hacen **una** vez). Se toca de lo que ya funciona:
`CheckoutForm.tsx` (pasos 15 y 18), `deliveryOffer.ts` y sus importadores (paso
11, que cambia una firma y por tanto arrastra `createOrder` y sus tests),
`pulledOrder.ts` (paso 13) y `src/lib/slug.ts` (paso 5, extracción sin cambio de
comportamiento).

Marcha atrás a mitad: los pasos 1-9 son aditivos y se revierten borrando
archivos. Desde el paso 10 hay una migración aplicada, y deshacerla es una
migración nueva que quita las dos columnas — no se revierte editando la
existente. El paso 15 es el único cuya marcha atrás hay que pensar aparte,
porque cambia una condición de render que hoy tiene sus tests.

## Preguntas antes de aprobar

**Las cuatro las cerró el humano el 2026-09-09, antes de firmar**, y las cuatro
en la opción recomendada. Se quedan escritas con lo que se descartó, porque el
motivo de un «no» se olvida antes que el del «sí».

**PP1 — el peso del artefacto en el repositorio. RESUELTA: (a).** Se aceptan los
~2,4 MB estimados con `interval=100 m` y 4 decimales. La cifra **real** se mide
al generar y se anota en la procedencia y en `.agent/progress/F-042.md`; si pasa
de 3 MB se aprieta la tolerancia antes de plantear nada más. Descartadas: (b)
`interval=200` y 3 decimales, que baja a poco más de la mitad a costa de una
frontera visiblemente más tosca al acercar —justo donde el mapa existe para
desempatar entre dos municipios vecinos—; y (c) sacarlo a un bucket versionado,
que perdería lo que la ADR 0032 eligió a propósito (los mismos bytes a los dos
lados y el hash como árbitro) y añadiría un paso operativo por entorno.

**PP2 — el importe en la lista. RESUELTA: (a).** Cada opción lleva su importe,
visible antes de elegirla. Se asume a sabiendas lo que tiene en contra: enseñar
que el municipio de al lado cuesta la mitad **invita a mentir**, y quien miente
se queda sin pedido cuando el mensajero llega. Se acepta porque el importe se ve
igual en cuanto alguien prueba dos opciones: esconderlo no quita el incentivo,
solo hace el primer intento más lento. Descartada (b), la lista con nombres a
secas.

**PP3 — cobertura de un solo municipio. RESUELTA: (a).** Viene elegido de
entrada y declarado en la línea («Esta tienda solo entrega en Playa ·

- $300.00»), con el importe ya en el total. Elegir «Envío a domicilio» en una
  tienda que solo llega a un municipio **ya es** el acto explícito. Descartada (b),
  un control que hay que marcar: añadía un toque a la inmensa mayoría de los
  pedidos del negocio pequeño cubano, y lo que protegía —que alguien de Marianao
  no crea que le llegan— ya lo cubre el nombre dicho en la línea y en el resumen.

**PP4 — a quién afecta desenganchar el `<fieldset>`. RESUELTA: (a).** Se
desengancha de la cotización **para todos los modos de envío**, no solo para
`ZONE_BASED`. El hecho de si hay domicilio se sabe en el servidor sin la
cotización, así que es lo coherente, y de paso quita un parpadeo en todas las
tiendas. **Se acepta explícitamente que se nota fuera del alcance nominal**: en
una tienda `FLAT_RATE` o `QUOTED_PER_ORDER` la pregunta de cómo recibir pasa a
aparecer con el HTML en vez de después de la cotización. Descartadas: (b) hacerlo
solo en `ZONE_BASED`, que deja dos caminos de render en el mismo componente y el
parpadeo donde estaba; y (c) no desengancharlo, que dejaría el criterio 1 sin
poder verificarse como está escrito.

**Dos decisiones más las tomó el orquestador y no subieron a pregunta**, porque
ninguna es de producto:

- **AP1 del arquitecto — la atribución del mapa va en DOS piezas.** Los polígonos
  son derivados de OSM y por ODbL exigen crédito **con independencia de quién
  sirva las teselas**, así que la atribución es el crédito del proveedor de
  teselas —el de la variable, o el de OSM— **más** una línea fija sobre los
  límites municipales y sus colaboradores de OpenStreetMap. Con la letra de D2
  aplicada tal cual, una tienda con proveedor alternativo pintaría datos de OSM
  sin acreditar a OSM. **No reabre D2**: la atribución de las **teselas** sigue
  siendo exactamente lo que el humano decidió.
- **DP3 del diseñador — la ayuda del campo de dirección** pasa de «Calle, número,
  entre calles y municipio.» a «Calle, número y entre calles.». El municipio ya
  se eligió arriba y viaja en el pedido como código **y** como nombre, así que el
  mensajero lo tiene igual; una redundancia que el comprador puede contradecir
  («Playa» arriba y «Marianao» escrito abajo) es una fuente de conflicto sin
  dueño.

Y una **discrepancia entre los dos documentos**, resuelta también aquí porque se
escribieron en paralelo: el plegador de tildes se llama **src/lib/text.ts** (por
crear), como dice la arquitectura, y no `textFold.ts` como lo nombró el diseño —
la arquitectura lo extrae de `src/lib/slug.ts`, que es lo que fija dónde vive. Y
los componentes son **cuatro**, no dos: la arquitectura fija la frontera de
capas (el selector, y el mapa como único importador de Leaflet) y el diseño
parte cada mitad en su envoltorio y su interior, que es decisión de UI.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-042 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-09T19:53:45Z — aprobado por el humano: «firmado»
