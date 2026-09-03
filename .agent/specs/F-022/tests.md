---
feature: F-022
agente: sdd-tester
actualizado: 2026-09-04T00:40:00Z
estado: final
veredicto: listo
---

## Estrategia

Tres entornos, por extensión (AGENTS.md § Cosas que muerden):

- **`*.test.ts` (proyecto `server`, mockeado)**: el validador de zona
  (`src/lib/timezone.ts`), el calendario y el evaluador
  (`src/lib/openingHours.ts`), la puerta de `PUBLISHED` en los dos escritores
  (`store.ts`, `mutations.ts`), el schema del payload (`schemas.ts`), el
  invariante del panel en `product.ts`, y la exhaustividad de la tabla del
  contrato. Todo puro o con Prisma mockeado — sin red, sin Postgres.
- **`*.db.test.ts` (proyecto `db`, Postgres real)**: el único punto donde
  AC1 se puede demostrar — forzando `Store.timezone` por SQL directo a un
  valor que este runtime no puede leer, y comprobando que los dos caminos
  reales (el sync vía el `POST` completo, el panel vía `setStoreEnabled`)
  rechazan la publicación contra la fila real, no contra un mock.
- Nada de esta feature necesita `--smoke`: no hay endpoint nuevo que probar
  con la app viva (el `PATCH` de estado ya existe desde HD10 y su
  comportamiento nuevo —409 `INVALID_TIMEZONE`— se verifica contra Postgres
  real en el `.db.test.ts`, que es más fuerte que un `curl` sin servidor
  levantado).
- **`--visual` (`.agent/specs/F-022/visual.mjs`, Chromium headless)**: el
  cartel de la vitrina SÍ tiene interfaz (`design.md` está `listo`), así que
  no basta con la verificación a mano que dejó `sdd-implementer` en
  `impl.md` § Comandos ejecutados — el arnés exige que los pasos visuales se
  EJECUTEN, no que se lean. Traduce los QUINCE pasos V1-V15 de `design.md` §
  Verificación visual: la posición del bloque en el DOM, la ausencia de
  scroll horizontal, la altura de la primera tarjeta, el contraste medido
  con canvas en claro y oscuro, el HTML servido por `curl`/`fetch` (sin
  hidratar nada), el árbol de accesibilidad del `<dl>` con `sm:contents`, el
  recorrido del tabulador, el grep del módulo de copy, la tienda cerrada, la
  comparación de marca (`tienda-demo`/`tienda-dos`), los tres casos y los
  cinco bordes del reloj con el texto literal del diseño, y la ausencia de
  `<Suspense>`/`fallback`/esqueleto/`loading.tsx`. Añadido en un segundo
  turno de este mismo ciclo, a pedido del orquestador: el plan original no
  lo incluyó entre mis pasos aunque el feature sí tiene interfaz. Un tercer
  turno corrigió los doce por quince: el primer resumen del orquestador se
  cortó en V12 sin que nadie —ni él, ni yo— notara que la tabla de
  `design.md` seguía hasta V15; no los excluyó nadie.

## Mapa criterio → prueba

| Criterio de aceptación (literal de `features.json`)                                                                                                                         | Prueba                                                                                                                                                                                                                                                           | Archivo                                                                           | Resultado |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------- |
| **AC1** "Publicar una tienda sin timezone falla."                                                                                                                           | `timezone` forzada por SQL a `'Nowhere/Nothing'`: republicar vía sync falla el evento (207, `failed[]`, `SyncEvent.status=FAILED`), `status` de la tienda no cambia; reabrir vía panel responde 409; un evento sano de OTRA tienda en el MISMO lote sí se aplica | `src/features/sync/server/handlers/storePublishGate.db.test.ts`                   | LISTO     |
| **AC1** (tercera pata: los tres escritores llaman al mismo predicado)                                                                                                       | Todo archivo que escribe `status: "PUBLISHED"` menciona `isCanonicalTimeZone`                                                                                                                                                                                    | `src/lib/boundaries.test.ts` (describe "PUBLISHED gate and evaluator boundaries") | LISTO     |
| **AC2** "Con timezone puesta y el reloj del proceso en otro huso (TZ=UTC), el calculo de abierto/cerrado coincide con la hora local de la tienda."                          | Las 8 filas de spec.md AC2 + 2 filas de cruce explícito (23:00/01:00), evaluadas con `process.env.TZ` en `UTC`, `Pacific/Kiritimati` y `America/Los_Angeles`, y comparadas byte a byte entre las tres                                                            | `src/lib/openingHours.test.ts` (describe "criterio 2")                            | LISTO     |
| **AC3** "Un identificador de timezone invalido se rechaza al guardar."                                                                                                      | Tabla de aceptados/rechazados de spec.md R1 (incluidos los 7 que `Intl` sí acepta pero R1 rechaza), sensibilidad a mayúsculas, sin trim; caso límite 1 (default en la lista, >300 zonas)                                                                         | `src/lib/timezone.test.ts`                                                        | LISTO     |
| **AC4** "docs/sync-contract.md contiene la tabla de propiedad y CADA campo de Store y StoreProduct aparece en ella con su dueno y que pasa si llega un evento que lo toca." | Cruce de conjuntos en los dos sentidos entre `prisma/schema.prisma` (31+23) y las dos tablas del contrato; sin duplicados; las 3 celdas rellenas en las 54 filas; superconjunto del cliente generado; simulación de una columna nueva sin documentar             | `src/features/sync/fieldOwnership.test.ts`                                        | LISTO     |
| **AC5** "Un product.update del sync no altera ningun campo cuyo dueno sea el panel."                                                                                        | Los 6 campos de `PANEL_PRODUCT_COLUMNS` (importado desde `@/constants/admin`, ya no un literal local) intactos tras un `product.update` que intenta tocarlos                                                                                                     | `src/features/sync/server/handlers/product.test.ts`                               | LISTO     |
| **AC6** `'grep -ri "umbral\|threshold" src/ prisma/schema.prisma'` sin ningún campo almacenado.                                                                             | Comando ejecutado directamente (ver § Ejecuciones) — 6 aciertos, todos comentarios/nombres de test/schema embebido generado, cero columnas; y `SELECT` contra Postgres real con 0 filas                                                                          | Comando de shell, no un test unitario (así lo pide el criterio literal)           | LISTO     |
| **AC7** `'bash .agent/verify.sh F-022 --full' termina con codigo 0.`                                                                                                        | Ejecutado (ver § Ejecuciones)                                                                                                                                                                                                                                    | —                                                                                 | LISTO     |

Los otros escenarios/reglas de `spec.md` que este ciclo también cubre, sin
ser uno de los 7 criterios: E10/SP3 (calendario malformado rechaza el evento
completo, sin tocar `name`/`phone` del mismo evento) y caso límite 9
(ausente deja la columna intacta) en `store.test.ts`; E11 (clave `timezone`
en el payload se descarta) en `schemas.test.ts` y `store.test.ts`; R12 en su
variante "evento rutinario con zona ilegible NO falla" en `store.test.ts`;
E5 completo (cerrar siempre funciona, incluso con zona ilegible) en
`mutations.test.ts` y en el `.db.test.ts`; A5 (ninguna vista menciona
`evaluateStoreHours`) en `boundaries.test.ts`.

## Ejecuciones

```
$ bash .agent/verify.sh F-022 --full
== Verificación F-022 · intento 29 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       6s
  ✓ format     8s
  ✓ test       26s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s
PASA
$ echo $?
0
```

```
$ npx vitest run
 Test Files  125 passed (125)
      Tests  1314 passed (1314)
```

(1223 antes de este ciclo + 91 pruebas nuevas de los 4 archivos nuevos y las
adiciones a los 5 modificados = 1314; 0 rojas.)

Por criterio, el comando exacto y su salida real:

**AC1 — sync + panel, contra Postgres real:**

```
$ npx vitest run src/features/sync/server/handlers/storePublishGate.db.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

**AC1 — el mismo predicado en los tres escritores:**

```
$ npx vitest run src/lib/boundaries.test.ts -t "isCanonicalTimeZone"
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
```

**AC2 — la tabla con TZ mutado:**

```
$ npx vitest run src/lib/openingHours.test.ts -t "criterio 2"
 Test Files  1 passed (1)
      Tests  7 passed | 26 skipped (33)
```

**AC3 — el validador:**

```
$ npx vitest run src/lib/timezone.test.ts
 Test Files  1 passed (1)
      Tests  33 passed (33)
```

**AC4 — la tabla de 54 filas:**

```
$ npx vitest run src/features/sync/fieldOwnership.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

**AC5 — los 6 campos del panel:**

```
$ npx vitest run src/features/sync/server/handlers/product.test.ts -t "panel"
 Test Files  1 passed (1)
      Tests  1 passed | 17 skipped (18)
```

**AC6 — el grep literal y la base real:**

```
$ grep -ri "umbral\|threshold" src/ prisma/schema.prisma
src/generated/prisma/internal/class.ts: ...inlineSchema... (el schema embebido, AGENTS.md excluye src/generated/ de lint)
src/app/[slug]/page.tsx:        {/* design.md § Inventario, umbral: con menos de dos categorías... (umbral de CANTIDAD DE CATEGORÍAS, ajeno a stock)
src/features/orders/server/bell.db.test.ts: // A window that opened just under the threshold ... (comentario, ventana de tiempo del timbre, ajeno a stock)
src/features/orders/server/bell.db.test.ts: // Advance the window fully past the threshold ... (comentario, ídem)
src/features/account/server/orderIdentity.test.ts:  it("normal link, under the threshold: ..." (nombre de un test, ajeno a stock)
src/lib/availability.ts: * is computed there, against a per-product threshold that lives beside... (comentario)
prisma/schema.prisma:/// Derived in cuadrecaja from stock + umbralBajo. The raw stock integer never (comentario /// sobre el enum Availability)

$ grep -n "umbral\|threshold" prisma/schema.prisma
28:/// Derived in cuadrecaja from stock + umbralBajo. The raw stock integer never

$ docker exec -i queandabuscando-postgres psql -U postgres -d queandabuscando -t \
  -c "SELECT column_name FROM information_schema.columns WHERE column_name ILIKE '%umbral%' OR column_name ILIKE '%threshold%';"
(0 filas)
```

Los 6 aciertos del primer grep son, uno por uno: el schema embebido dentro
del cliente generado (excluido de lint por AGENTS.md), un umbral de
**cantidad de categorías** en la portada (ajeno al stock), dos comentarios
sobre una ventana de **tiempo** del timbre de F-020, el nombre de un test de
F-030 sobre un umbral de tiempo de vinculación, y el comentario de
`src/lib/availability.ts` que describe dónde vive el cálculo (en
cuadrecaja). El único acierto en `prisma/schema.prisma` es el comentario
`///` del enum `Availability` — la línea que la propia spec cita como ya
existente. Cero columnas. El criterio ya se cumplía antes de este ciclo (I2
de `spec.md`) y sigue cumpliéndose.

**AC7 — ya mostrado arriba** (código de salida `0`).

## Verificación visual

`bash .agent/verify.sh F-022 --visual` levanta su propio `next dev` en el
puerto 3101 (el 3000 de este equipo lo ocupa el `next dev --turbopack` de
otro worktree — ficha `next-dev-uno-por-directorio`) y corre
`.agent/specs/F-022/visual.mjs`, que traduce los QUINCE pasos V1-V15 de
`design.md § Verificación visual` (design.md:837-851) contra los datos ya
sembrados: `tienda-demo` (el calendario del caso 3 — lunes a domingo con dos
ventanas un día, un día cerrado, un cruce de medianoche el viernes y 24
horas el sábado — que además resultó ser, medido, el PEOR caso de siete
tramos sin ninguno compactado), `tienda-dos` (sin horario, tema verde
distinto — V13) y `tienda-cerrada` (SUSPENDED, sin horario).

**Corrección de alcance, sobre una versión anterior de esta misma sección:**
la primera pasada de este documento solo listaba V1-V12. El orquestador
enumeró esos doce en su mensaje porque `design.md:837-848` fue lo que leyó,
y ni él ni yo nos dimos cuenta de que la tabla seguía hasta la fila V15
(`design.md:849-851`). No los excluyó nadie — es un error de hecho que el
propio orquestador señaló, y esta versión lo corrige con los quince.

```
$ bash .agent/verify.sh F-022 --visual
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     7s
  ✓ test       29s
  ✓ visual     10s
PASA
$ echo $?
0
```

Salida completa del guion visual, en el orden en que corre (48 aserciones,
0 fallidas):

```
  ok   V11 — el CÓDIGO de StoreHoursNotice.tsx (sin comentarios) no usa hoy/ahora/mañana/Abierta/Cerrada/Suspendida
  ok   V14 caso 1 (contiene "Horario:")
  ok   V14 caso 1 (contiene "todos los días de 9:00 a.m. a 6:00 p.m.")
  ok   V14 caso 2 (contiene "Horario de atención")
  ok   V14 caso 2 (Lunes a viernes) (contiene "Lunes a viernes")
  ok   V14 caso 2 (de 9:00 a.m. a 6:00 p.m.) (contiene "de 9:00 a.m. a 6:00 p.m.")
  ok   V14 caso 2 (Sábado) (contiene "Sábado")
  ok   V14 caso 2 (de 9:00 a.m. a 1:00 p.m.) (contiene "de 9:00 a.m. a 1:00 p.m.")
  ok   V14 caso 2 (Domingo) (contiene "Domingo")
  ok   V14 caso 2 (no abre) (contiene "no abre")
  ok   V14 caso 3 (contiene "Lunes" ... "Domingo", los siete tramos literales)
  ok   V14 borde "00:00" → "12:00 a.m." / "12:00" → "12:00 p.m." / "12:30" → "12:30 p.m." / "00:30" → "12:30 a.m."
  ok   V14 borde "24:00" → "medianoche" (nunca como hora)
  ok   V14 el cruce de medianoche se dice con todas las letras ("del día siguiente")
  ok   V14 abierto las 24 horas / los siete días vacíos (P3)
  0 aserciones fallidas (V14)
  ok   V15 — ninguno de los 12 archivos que el feature crea o toca tiene <Suspense>/fallback/esqueleto
  ok   V15 — no existe src/app/[slug]/loading.tsx
  ok   V1 — orden DOM (ruta, horario, buscador) a 360/768/1280px
  ok   V2 — sin scroll horizontal a 360px
  ok   V3 — la primera tarjeta de producto empieza por debajo de 0 (y=588)
  ok   V3 — y de la primera tarjeta < 600px a 360×800
  ok   V9 — se alcanzó la primera tarjeta con Tab (el recorrido avanzó)
  ok   V9 — el horario nunca recibió el foco en el recorrido
  ok   V4 — contraste del rótulo ≥ 4.5:1 en light (16.82:1) y en dark (16.53:1)
  ok   V4 — contraste de las horas ≥ 4.5:1 en light (5.38:1) y en dark (7.16:1)
  ok   V10 — el <div> envolvente de cada tramo es display:contents a 768px
  nota V10 — aria snapshot: 7 pares term/definition, texto literal del caso 3
  ok   V10 — nº de roles 'term'/'definition' en el árbol de accesibilidad = nº de tramos
  ok   V12 — StoreClosedNotice se pinta ([role=alert] presente), ningún horario
  ok   V13 — tienda-demo y tienda-dos tienen --color-brand REALMENTE distinto (lab(46.1471% 7.90268 -65.3561) vs oklch(0.62 0.17 145))
  ok   V13 — --color-fg-muted (lo único que StoreHoursNotice usa) es IDÉNTICO en las dos tiendas
  ok   V13 — StoreHoursNotice.tsx no usa ninguna clase bg-brand/text-brand/bg-accent/text-accent
  ok   V13 — CUSTOM_PROPERTY (storeTheme.ts) nunca declara --color-fg
  ok   V5 — 'Horario de atención' y un tramo formateado están en el HTML servido de /tienda-demo
  ok   V6 — /tienda-dos (sin horario) no contiene la palabra 'horario' ni el id #horario
  ok   V7 — el horario es idéntico en dos peticiones separadas en el tiempo

0 aserciones fallidas
```

(La salida real y completa, sin resumir, queda en `.agent/runs/F-022/045-visual.log`.)

V8 (`check:bundle`) corre APARTE de `visual.mjs`, con el `next dev` parado
—arrancarlo a la vez habría escrito `next build` sobre el mismo `.next/`
que el dev server está usando, mismo criterio que ya usó
`.agent/specs/F-023/tests.md` § criterio 7—:

```
$ npm run build
✓ Compiled successfully
...
● /tienda-demo (SSG)
...
$ npm run check:bundle
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 177.6 KB gzipped (budget 193 KB)
    HTML:      4.3 KB gzipped — this is what decides first paint
$ echo $?
0
$ find .next/server/app -iname "tienda-demo.html"
.next/server/app/tienda-demo.html
$ grep -c "horario" .next/server/app/tienda-dos.html
0
```

`BUDGET_KB` (193) sin tocar; el peor caso sigue siendo la ficha de producto
de `bodega-central`, no `/tienda-demo` — el horario no le añadió peso
apreciable al HTML de la portada.

V14 corre aparte del navegador, con `npx tsx .agent/specs/F-022/renderHoursNotice.mjs`
(nuevo, compañero de `visual.mjs`): renderiza el componente REAL
`StoreHoursNotice` —sin cambiar una línea de él— con `react-dom/server`,
contra ocho calendarios sintéticos (los tres casos + los cinco bordes del
reloj + el cruce de medianoche + los siete días vacíos), y compara el HTML
resultante contra el texto **literal** de `design.md`. Por qué no se
provocó "cambiando el calendario sembrado" como sugiere `design.md:853-856`:
el único camino de escritura real es el sync, y acuñar el token que
necesitaría **rota** el de `seed-negocio-1` — la trampa fichada en
`.agent/playbook/mint-token-rota-el-token-en-bd-compartida.md`, que le
dejaría un `401` a cualquier otra sesión de otro worktree que lo tuviera
exportado. `StoreHoursNotice` no recibe más que `{ schedule }` (nunca una
tienda, nunca un tema, nunca un instante — architecture.md § Componentes),
así que renderizarlo aislado es el MISMO código, no un sustituto:

```
$ npx tsx .agent/specs/F-022/renderHoursNotice.mjs
  ok   V14 caso 1 (contiene "Horario:")
  ... (29 líneas ok, ver arriba y el log completo)
0 aserciones fallidas (V14)
$ echo $?
0
```

V13 corrió contra Postgres real (los datos ya sembrados, sin mutar nada):
`tienda-demo` y `tienda-dos` tienen `Storefront.themeTokens` genuinamente
distintos (confirmado midiendo `--color-brand` computado en las dos
páginas: `lab(46.1471% 7.90268 -65.3561)` contra `oklch(0.62 0.17 145)`), y
`--color-fg-muted` —el único token que `StoreHoursNotice` usa— es idéntico
en las dos. Cerrado con la prueba estructural: `src/features/theming/storeTheme.ts::CUSTOM_PROPERTY`
es la ÚNICA puerta por la que un `Storefront.themeTokens` llega al CSS, y
su mapa (leído, no supuesto) solo declara `--color-brand`/`--color-brand-contrast`/`--color-accent`/`--color-accent-contrast`
— nunca `--color-fg`. Es estructuralmente imposible que una marca toque el
horario, no solo cierto hoy por casualidad.

V15 corrió sobre los 12 archivos de producción que `architecture.md § Archivos`
lista como creados o tocados por este feature, más un `find` de
`src/app/[slug]/loading.tsx`: ninguno tiene `<Suspense`, una prop
`fallback={`, `<Skeleton` ni `animate-pulse`, y el `loading.tsx` no existe.
(El primer borrador de la regex prohibida era más ancha —`fallback\s*[:=]`—
y coincidía con el parámetro `fallback: DeliveryConfig` de
`assertDeliveryConsistent`, que F-032 ya usaba y no tiene nada que ver con
`<Suspense>`; descartado en la bitácora de `verify.sh`, no es una trampa
del repo.)

### Los quince pasos, uno por uno

| #   | Qué mirar (design.md)                                                                    | Verde si                                                            | Resultado real                                                                                                                                                                                                 | Veredicto |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| V1  | El bloque entre la ruta y el buscador, en los tres anchos                                | Sí, y en ese orden en el DOM                                        | `NAV,SECTION,FORM` en ese orden exacto a 360/768/1280px                                                                                                                                                        | LISTO     |
| V2  | Scroll horizontal a 360px, calendario del caso 3                                         | No hay                                                              | `scrollWidth <= innerWidth+1` → sin desborde                                                                                                                                                                   | LISTO     |
| V3  | `y` de la primera imagen de producto a 360×800, peor caso de siete tramos                | Por debajo de 600px                                                 | `y = 588px` (tienda-demo da, medido, el peor caso: 7 tramos, ninguno compactado)                                                                                                                               | LISTO     |
| V4  | Contraste del rótulo y de las horas, canvas 1×1 contra el fondo real                     | ≥ 4,5:1 los dos, claro y oscuro                                     | Rótulo 16.82:1 (claro) / 16.53:1 (oscuro); horas 5.38:1 (claro) / 7.16:1 (oscuro)                                                                                                                              | LISTO     |
| V5  | `curl`/`fetch` de `/tienda-demo`, buscar el horario                                      | El texto está en el HTML servido                                    | `"Horario de atención"` y `"9:00 a.m. a 6:00 p.m."` presentes en el HTML servido (dev Y build de producción)                                                                                                   | LISTO     |
| V6  | Una tienda con `openingHours` nulo (`tienda-dos`), el HTML entre trail y buscador        | Idéntico a antes del feature (E8)                                   | Cero apariciones de "horario" y de `id="horario"` en el HTML servido                                                                                                                                           | LISTO     |
| V7  | Dos peticiones a la misma URL separadas en el tiempo                                     | El horario dice lo mismo las dos veces                              | Bloque `#horario`…`</dl>` byte a byte idéntico en dos `fetch` separados por 1.5s                                                                                                                               | LISTO     |
| V8  | `npm run check:bundle`                                                                   | Código 0, `<slug>.html` presente, KB sin subir, `BUDGET_KB` intacto | `0`; `tienda-demo.html` existe; 177.6 KB sobre 193 KB (mismo número que impl.md midió); `BUDGET_KB` sin tocar                                                                                                  | LISTO     |
| V9  | Tabulador desde la cabecera hasta la primera tarjeta                                     | El horario no aparece en el recorrido                               | 25 `Tab` desde `body`: se alcanzó la primera tarjeta y el horario nunca recibió el foco (no tiene nada enfocable)                                                                                              | LISTO     |
| V10 | Árbol de accesibilidad del `<dl>` a 768px, con `sm:contents`                             | Los roles de lista de definiciones siguen ahí, nº = nº de tramos    | `display: contents` confirmado en el `<div>` envolvente; 7 roles `term` y 7 `definition` (aria snapshot adjunto)                                                                                               | LISTO     |
| V11 | El módulo de copy: grep de «hoy», «ahora», «mañana», «Abierta», «Cerrada», «Suspendida»  | Sin resultados                                                      | Sin resultados en el CÓDIGO (comentarios excluidos — el propio JSDoc del módulo cita esas palabras para explicar por qué R11 las prohíbe, igual que el criterio 6 acepta comentarios que mencionan "umbral")   | LISTO     |
| V12 | Una tienda con el interruptor apagado (`tienda-cerrada`)                                 | `StoreClosedNotice` y ningún horario (E9)                           | `[role="alert"]` presente, `#horario` ausente                                                                                                                                                                  | LISTO     |
| V13 | La marca: `tienda-demo` y `tienda-dos`                                                   | El horario se lee igual en las dos; ningún color de marca lo toca   | `--color-brand` REALMENTE distinto entre las dos; `--color-fg-muted` (lo único que usa el componente) idéntico; `CUSTOM_PROPERTY` nunca declara `--color-fg`; el componente no usa clases brand/accent         | LISTO     |
| V14 | Los tres casos de § La presentación de la semana y los cinco bordes del reloj, literales | Los ocho se ven, con el texto literal de `design.md`                | 29/29 aserciones contra el HTML del componente REAL renderizado offline (`react-dom/server`), texto literal exacto de los tres bloques de código y de las cinco filas de `design.md § Las reglas de redacción` | LISTO     |
| V15 | `<Suspense>`, `fallback`, esqueleto y `loading.tsx`                                      | **No existe ninguno de los cuatro** en el diff del feature          | Cero coincidencias en los 12 archivos que `architecture.md § Archivos` lista; `src/app/[slug]/loading.tsx` no existe                                                                                           | LISTO     |

Los quince, LISTO. Ninguno se maquilló ni se relajó. El guion falló cuatro
veces mientras se escribía, las cuatro por descuidos míos, ninguna del
código bajo prueba: una constante sin usar, V11 greppeando un comentario
que EXPLICA la regla en vez del código que la cumple, y V15 con una regex
demasiado ancha que coincidía con un parámetro `fallback` genérico de
F-032 sin relación con `<Suspense>` (dos veces: la primera versión de V15,
y su reaparición al añadir V13-V15 en el tercer turno). Las cuatro
descartadas en la bitácora de `verify.sh` (`bash .agent/verify.sh dismiss`).
`bash .agent/verify.sh pending F-022` queda vacío.

## Fallos encontrados

Ninguno de construcción. Los dos únicos rojos de la suite al empezar este
ciclo eran fixtures de prueba, confirmado antes de tocar nada (comparé el
comportamiento esperado por R12/E5 contra lo que el código realmente hace, no
al revés):

- `src/features/admin/server/mutations.test.ts` → `"publishes and clears the
disabled columns, then revalidates (HD10)"`: el mock de `storeFindUnique`
  no traía valor por defecto, así que la lectura nueva de `setStoreEnabled`
  (rama `enabled: true`) recibía `undefined` y devolvía `not_found` antes de
  llegar al `update`. Arreglo: `storeFindUnique.mockResolvedValue({ timezone:
"America/Havana" })` antes de la llamada — exactamente lo que `impl.md`
  documentó, verificado por mí, no solo copiado.
- `src/features/sync/server/handlers/store.test.ts` → `"a real opt-in flip to
publish clears the disabled columns"`: el mock de `existing` no traía
  `timezone`, así que `isCanonicalTimeZone(undefined)` daba `false` y la
  puerta nueva lanzaba `STORE_TIMEZONE_INVALID`. Arreglo: `timezone:
"America/Havana"` en el override de esa fila.

En ambos casos comprobé que el resultado correcto tras el arreglo es
efectivamente `saved`/`PUBLISHED` (no `invalid_timezone`/`FAILED`) — la
puerta deja pasar una zona canónica, que es lo que R12 pide, no un
`STALE`/`invalid_timezone` disfrazado de verde.

Dos gaps de prueba (no de código) que encontré y arreglé al modificar
`mutations.test.ts`, porque estaba ya autorizada a tocarlo:

- `"returns not_found and never revalidates when the row vanished (P2025)"`
  pasaba **por la razón equivocada**: sin `storeFindUnique` mockeado, el
  `not_found` salía de la lectura de zona (nueva de F-022), nunca de que
  `storeUpdate` rechazara con `P2025` — el aserto real de ese test nunca se
  ejercitaba. Arreglo: mock explícito de `storeFindUnique` para que el flujo
  llegue de verdad al `update` y a su rechazo P2025; añadí un test nuevo
  para el caso que el viejo dejó de cubrir sin querer (`"F-022 E5: returns
not_found when the row vanished BEFORE the timezone read itself"`).
- `"single-branch brand: never calls revalidateSlugs"` pasaba **de forma
  vacía**: `setStoreEnabled` devolvía `not_found` antes de llegar a
  `storeUpdate`/`revalidateSlugs`, así que el `expect(revalidateSlugs).not.toHaveBeenCalled()`
  era trivialmente cierto sobre una llamada que nunca ocurrió. Arreglo:
  mock de `storeFindUnique` para que el camino single-branch se ejecute de
  verdad.

Ningún fallo de este ciclo vuelve a otro agente.

**Fichas de playbook escritas** (una, por un fallo que costó más de un
intento — la creación del `.db.test.ts` de AC1):

- `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`:
  llamar al `POST` real del sync o a `setStoreEnabled` real desde un
  `*.db.test.ts` (sin el contexto de un `next dev`/`next start` real) hace
  que `revalidateTag` reviente con `Invariant: static generation store
missing`. Arreglo: `vi.mock("next/cache", ...)` al principio del archivo,
  igual que ya hacen `src/lib/cache.test.ts` y
  `src/features/storefront/server/resolve.test.ts` (que no son `db`, pero
  usan la misma técnica) — la invalidación de caché en sí ya está probada,
  mockeada, en otros archivos.

`bash .agent/verify.sh pending F-022` → vacío (confirmado tras escribir la
ficha de arriba).

## Huecos de cobertura

- **El límite de tamaño de `openingHours` (`OPENING_HOURS_MAX_CHARS = 2048`)
  es inalcanzable con las otras reglas del schema activas.** Con el tope de
  `OPENING_HOURS_MAX_WINDOWS_PER_DAY = 4` y el formato fijo `HH:MM` de cada
  ventana, el calendario más grande posible que aún cumple el resto del
  schema mide 918 caracteres serializado (medido con un script de scratch):
  nunca llega a los 2048. El `.refine` del tamaño existe igual en el código
  —es una defensa razonable si algún día suben esos otros topes— pero no
  escribí un test que lo dispare porque no encontré ningún valor que sea a
  la vez "válido según el resto del schema" e "inválido por tamaño". No es
  un fallo de construcción (nada en los 7 criterios ni en R1-R14 lo exige
  explícitamente) y no cambié el código de producción para "arreglarlo" —
  solo lo dejo escrito para que quien edite esos topes en el futuro sepa que
  el `.refine` de tamaño empieza a ser alcanzable recién entonces.
- **AC1, ítem 2 (el camino del panel) se verificó contra `setStoreEnabled` +
  `writeResultToResponse` directamente, no contra el `PATCH` HTTP con sesión
  de administrador real.** `guardAdminStore` exige una sesión de Supabase
  autenticada, que ningún `.db.test.ts` del repo monta hoy (no hay
  precedente en `src/features/admin/`). Lo que sí se demuestra, contra
  Postgres real, es exactamente la forma que `writeResultToResponse` produce
  (`409 {"error":"INVALID_TIMEZONE"}`) a partir del resultado real de
  `setStoreEnabled` contra la fila forzada — la única capa que no se cubre
  es el guard de sesión, que es ortogonal a R12/E5 y ya tiene su propia
  cobertura en otros archivos de `admin/`.
- El cartel de la vitrina (`StoreHoursNotice`, paso 6) no tenía, hasta el
  segundo turno de este ciclo, ningún paso EJECUTADO — ver arriba §
  Verificación visual, que lo cierra con los QUINCE pasos V1-V15 (los tres
  últimos, en un tercer turno: una corrección de hecho del orquestador, que
  reconoció haber leído `design.md` hasta la fila V12 sin notar que la
  tabla seguía).
- **V14 no pasa por Postgres ni por el navegador**, a propósito: ver la
  cabecera de `visual.mjs` y § Verificación visual de arriba para el motivo
  completo (mutar el calendario sembrado de una tienda compartida exigiría
  rotar el token de `seed-negocio-1`, rompiendo cualquier otra sesión de
  otro worktree que lo tuviera exportado — ficha
  `mint-token-rota-el-token-en-bd-compartida`). Lo que SÍ se ejecuta es el
  componente de producción real, sin cambiar una línea, así que la
  cobertura de lo que el comprador ve es la misma; lo que no se cubre es la
  integración completa DB→página con esos ocho calendarios sintéticos en
  particular — la integración general (un calendario real, de principio a
  fin) sí la cubren V1/V5/V9/V10 contra `tienda-demo`.

## Veredicto

**LISTO.** Los 7 criterios de `features.json` se verificaron ejecutando algo
real: comandos de shell para AC6, `vitest` contra mocks para AC2/AC3/AC4/AC5
y la mitad estática de AC1, `vitest` contra Postgres real para la mitad
forzada de AC1, y `verify.sh F-022 --full` para AC7 — código `0`. Y, además
de los 7 criterios, los QUINCE pasos visuales V1-V15 que `design.md` (en
`estado: listo`) exige porque el feature tiene interfaz: `bash
.agent/verify.sh F-022 --visual` → código `0`, las 48 aserciones del guion
(más las 29 del renderer offline de V14) en verde, ninguna maquillada.
`bash .agent/verify.sh F-022 --full` → código `0`. `bash .agent/verify.sh
pending F-022` está vacío. No quedó ningún fallo de construcción: los dos
rojos de test que encontré al empezar eran fixtures, verificados y
corregidos, no disimulados; los cuatro fallos que costó escribir
`visual.mjs` (en sus dos turnos) eran descuidos de mi propio primer
borrador, descartados en la bitácora del arnés, no del código bajo prueba.

## Preguntas al humano

Ninguna. No encontré un criterio imposible de verificar tal como está
escrito (I1/I3 de `spec.md` ya anticipaban por qué AC1 y AC3 se prueban
como se prueban, y las dos rutas que usé son las que esos mismos documentos
prescriben) ni un fallo cuya severidad sea una decisión de producto.
