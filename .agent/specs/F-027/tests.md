---
feature: F-027
agente: sdd-tester
actualizado: 2026-08-31T20:15:00Z
estado: listo
veredicto: listo
---

## Estrategia

Los 16 `acceptance_criteria` de `.agent/features.json` (no los 18 de
`spec.md` § Criterios de aceptación propuestos — el criterio del `EXPLAIN`
que la spec numera como su #15 nunca entró en `features.json`, así que no es
contrato de este feature y no se verifica aquí como criterio) se ejecutaron
en tres niveles, todos contra Postgres real en `5433` y `next dev` real,
nunca leyendo código para dar algo por bueno:

1. **HTTP de verdad con `curl`**, código de estado incluido, para los
   criterios que dependen del árbol de rutas, de la cascada de estados
   (vacíos, `SUSPENDED`, selector) o del HTML servido sin JavaScript
   (criterios 3, 4, 9, 10, 11, 13, 14, 15). Encapsulado en
   `.agent/specs/F-027/smoke.sh`, reproducible con
   `bash .agent/verify.sh F-027 --smoke`.
2. **Un servidor de comparación contra `main`**, para el criterio 1: el
   segundo checkout del repo (`/Users/adrian/Documents/PROJECTS/cuadre-caja/queandabuscando`,
   en `main`, mismo Postgres) levantado en un puerto propio y comparado
   byte a byte (el orden de los `href` de producto) contra este worktree en
   otro puerto — nunca contra la intuición de que «el query no cambió».
3. **El navegador de verdad (Playwright, Chromium headless)** para la
   verificación visual V1–V18 de `design.md`, en
   `.agent/specs/F-027/visual.mjs`, reproducible con
   `bash .agent/verify.sh F-027 --visual`. Cubre JavaScript desactivado
   (V8, V9), foco y tabulación (V7), el árbol de accesibilidad (V17) y
   estructura de grid por breakpoint (V4) — lo que `curl` no puede ver.

Los criterios 5, 6, 7 y 8 no tienen fixture en el seed (`tienda-demo` tiene
cero promociones, ninguna moneda sin tasa, no trae «ácido»/«azúcar» y no
tiene 25 productos con el mismo `createdAt`). `smoke.sh` siembra su propia
tienda sintética por el sync real (`f027-store-$SUFFIX`, aditiva, con el
mismo criterio de higiene de datos que ya usa `.agent/specs/F-026/smoke.sh`)
y usa `psql` directo solo para lo que el contrato de sync **no** transporta
(`priceOverride` y `Promotion` son del panel de administración, nunca del
POS — `docs/sync-contract.md:472`), siempre seguido de un evento de sync
inocuo que fuerza `revalidateStores()` — un `UPDATE`/`INSERT` directo no
dispara `revalidateTag` y daría un falso verde, la misma trampa que fichó
F-026. V18 siembra igual, 15 categorías propias, y las borra en un
`finally`.

Los 31 tests unitarios de `src/features/catalog/catalogFilters.test.ts`
(del implementador) se leyeron y se corrieron, y cubren el mismo terreno de
5, 6, 7 y 8 a nivel de función pura — se dan por buenos como una segunda
capa de evidencia, pero **ningún criterio se cerró solo con ellos**: los 16
tienen además su propia ejecución end-to-end contra HTTP real, con datos
sembrados por este ciclo, no reutilizando los del implementador.

## Mapa criterio → prueba

| #   | Criterio de aceptación (literal de `features.json`)                                                                                                                                                                                           | Prueba                                                                                                                                        | Archivo                       | Resultado                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| 1   | GET /[slug] sin parametros devuelve exactamente el mismo conjunto y el mismo orden de productos que antes del cambio.                                                                                                                         | `curl` a `/tienda-demo` en `main` (puerto 3401) y en este worktree (puerto 3450); diff de los 15 `href` de producto en orden                  | § Ejecuciones                 | **LISTO** — orden idéntico, único diff el enlace nuevo |
| 2   | 'npm run build' sigue marcando /[slug] y /[slug]/p/[productSlug] como SSG (bullet); la superficie de catalogo filtrado nueva aparece como ƒ (Dynamic).                                                                                        | `npm run build`, grep de la tabla de rutas                                                                                                    | § Ejecuciones                 | **LISTO**                                              |
| 3   | Con un producto OUT_OF_STOCK y otro AVAILABLE sembrados, la URL sin filtro contiene los dos nombres y la URL con 'solo lo que hay' contiene uno y no el otro.                                                                                 | `smoke.sh` § criterio 3, sobre `tienda-demo` real (Papel sanitario x4 / Arroz blanco 1 kg)                                                    | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 4   | Filtrar por dos categorias devuelve la union de ambas; filtrar por categoria y disponibilidad a la vez devuelve la interseccion.                                                                                                              | `smoke.sh` § criterio 4, bebidas+alimentos (unión, 9) vs. bebidas+hay (intersección, 3)                                                       | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 5   | Un producto con syncedPrice 900 y priceOverride 300 aparece bajo 'hasta 500' y no bajo 'desde 500'; un producto de 600 con una promocion vigente del 50% tambien aparece bajo 'hasta 500'.                                                    | `smoke.sh` § criterio 5, sobre la tienda sintética                                                                                            | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 6   | Un producto en una moneda sin tasa vigente no aparece bajo ningun rango de precio, y ocupa la ultima posicion en el orden por precio en las dos direcciones.                                                                                  | `smoke.sh` § criterio 6 (moneda `ZZZ`, sin `ExchangeRate`), última fila en `precio_asc` y `precio_desc`                                       | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 7   | Ordenar por nombre sobre 'acido', 'Agua' y 'azucar' devuelve ese orden exacto, ignorando acentos y mayusculas.                                                                                                                                | `smoke.sh` § criterio 7, posiciones 1/2/3 exactas                                                                                             | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 8   | Con mas productos que el tope de pagina y todos con el mismo createdAt, la union de la pagina 1 y la pagina 2 de 'mas reciente' no repite ni omite ningun identificador.                                                                      | `smoke.sh` § criterio 8, 25 productos con `createdAt` forzado idéntico, 24+7=31 sin repetidos                                                 | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 9   | En /[slug]/buscar sin parametro de orden, los criterios 1 y 2 de F-021 (coincidencia exacta primero, arrastre de categoria) se re-ejecutan y siguen verdes; con un orden explicito, el resultado se ordena de punta a punta por ese criterio. | `smoke.sh` § criterios 9 y 10, mismo término que `.agent/specs/F-021/tests.md` § Criterios 1, 2                                               | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 10  | Una URL con un parametro desconocido, una categoria inexistente, precio_min mayor que precio_max y letras donde va un numero responde 200, ignora esos valores y no genera ningun chip por ellos.                                             | `curl` manual, § Ejecuciones (parámetro basura combinado)                                                                                     | § Ejecuciones                 | **LISTO**                                              |
| 11  | Una combinacion de filtros validos sin resultados responde 200 con los filtros aplicados nombrados y un enlace para quitarlos; una tienda sin productos responde 200 con el mensaje de siempre y sin panel de filtros.                        | `smoke.sh` § criterio 11 (`categorySlug=bebidas&precio_min=99999`; `el-trebol-centro`, PUBLISHED con 0 productos)                             | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 12  | 'node scripts/check-bundle-budget.mjs' termina con codigo 0 sin subir el presupuesto, y ningun componente de filtro usa 'use client'.                                                                                                         | `node scripts/check-bundle-budget.mjs`; `git diff main -- scripts/check-bundle-budget.mjs`; `grep -rln '^"use client"' src/components/store/` | § Ejecuciones                 | **LISTO**                                              |
| 13  | El HTML de una URL filtrada u ordenada contiene 'noindex' y un <link rel="canonical"> a /[slug].                                                                                                                                              | `smoke.sh` § criterio 13                                                                                                                      | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 14  | Un producto visible=false o con deletedAt no nulo no aparece bajo ninguna combinacion de filtros y ordenes.                                                                                                                                   | `smoke.sh` § criterio 14, un invisible + un borrado contra 6 combinaciones distintas de filtro/orden                                          | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 15  | Una tienda SUSPENDED responde con el aviso de cerrada sin ejecutar consulta de catalogo, y un slug en modo selector responde 404.                                                                                                             | `smoke.sh` § criterio 15 (`tienda-cerrada`, `el-trebol`, `bodega-uno`)                                                                        | `.agent/specs/F-027/smoke.sh` | **LISTO**                                              |
| 16  | 'bash .agent/verify.sh F-027 --full' termina con codigo 0.                                                                                                                                                                                    | Ejecutado dos veces seguidas                                                                                                                  | § Ejecuciones                 | **LISTO**                                              |

Un criterio sin fila es un criterio sin cubrir — no es el caso: los 16 están.

**Verificación visual (V1–V18, `design.md`)**: las 18 pasaron, ejecutadas con
`.agent/specs/F-027/visual.mjs` tanto en directo (`node .agent/specs/F-027/visual.mjs`
contra un `next dev` propio) como a través del arnés
(`bash .agent/verify.sh F-027 --visual`, que reutilizó el `next dev` de este
worktree — ficha `next-dev-uno-por-directorio`, comprobado el `cwd` del
proceso antes de creer nada). Ninguna quedó en `nota` salvo la mitad de V17
(el singular «1 producto»: ninguna faceta de `tienda-demo` tiene conteo 1
hoy, así que esa mitad queda como hueco de cobertura, no como fallo).

## Datos sembrados (reproducibles)

Ninguno de estos comandos toca `tienda-demo` más allá de lecturas: la tienda
sintética y sus filas quedan en la base, aditivas, con un `externalId`/
`localName` que lleva siempre el prefijo `f027-`/`F027 `.

```bash
# 1. Token de sync de seed-negocio-1 (rota el existente; guardarlo)
npm run mint:token -- seed-negocio-1

# 2. Levantar la app y correr el guion de runtime — siembra, verifica y
#    limpia lo que puede limpiarse en el mismo paso:
QAB_BEARER_TOKEN=<el-token-de-arriba> bash .agent/verify.sh F-027 --smoke

# 3. La verificación visual (V18 siembra 15 categorías propias en
#    tienda-demo y las borra en su propio `finally`):
QAB_BEARER_TOKEN=<el-token-de-arriba> bash .agent/verify.sh F-027 --visual
```

`smoke.sh` deja en la base, cada corrida, una tienda sintética nueva
(`f027-store-<timestamp>`, sufijo distinto cada vez) con 31 `StoreProduct` y
1 `Promotion` — es aditivo a propósito, la misma convención que
`.agent/specs/F-026/smoke.sh` ya documentó («queda en la base al terminar»):
ninguna aserción de ningún feature depende de un conteo exacto de tiendas o
de productos de `seed-negocio-1`.

## Ejecuciones

### Criterio 1 — comparación byte a byte contra `main`

```
$ (en /Users/adrian/Documents/PROJECTS/cuadre-caja/queandabuscando, main @ 5d65874)
$ npx prisma generate && npx next dev -p 3401
$ curl -s http://localhost:3401/tienda-demo | grep -oE 'href="/tienda-demo/p/[a-z0-9-]+"' | sed ... > main-order.txt   # 15 líneas

$ (en este worktree, F-027)
$ npx next dev -p 3450
$ curl -s http://localhost:3450/tienda-demo | grep -oE 'href="/tienda-demo/p/[a-z0-9-]+"' | sed ... > f027-order.txt  # 15 líneas

$ diff main-order.txt f027-order.txt
(sin diferencias) → IDENTICAL ORDER

$ grep -o "Filtrar y ordenar" main-tienda-demo.html   # (nada)
$ grep -o "Filtrar y ordenar" f027-tienda-demo.html
Filtrar y ordenar
```

Confirmado por PID/`cwd` que cada servidor era el suyo (`lsof -a -p <pid> -d cwd`),
por la ficha `next-dev-uno-por-directorio`: 3401 → el checkout de `main`, 3450 →
este worktree.

### Criterio 2 — `npm run build`

```
$ npm run build
...
Route (app)
┌ ○ /
├ ○ /_not-found
├   /[slug]
│ ├ ● /tienda-demo
│ ├ ● /tienda-dos
│ ├ ● /bodega-central
│ └ ● [+7 more paths]
├ ƒ /[slug]/buscar
├   /[slug]/c/[categorySlug]
│ ├ ● /tienda-demo/c/alimentos
...
├ ƒ /[slug]/catalogo
├ ƒ /[slug]/checkout
├   /[slug]/p/[productSlug]
│ ├ ● /tienda-demo/p/arroz-blanco-1-kg
...
```

`/[slug]` y `/[slug]/p/[productSlug]` en `●`; `/[slug]/catalogo` en `ƒ`.

### Criterio 10 — parámetro basura combinado

```
$ curl -s "http://localhost:3450/tienda-demo/catalogo?parametroDesconocido=xyz&categorySlug=marca-ajena-inexistente&precio_min=999&precio_max=1&precio_min=abc" -o c10.html -w "status=%{http_code}\n"
status=200
$ grep -o "noindex" c10.html | head -1
noindex
$ grep -oE '[0-9]+ productos? en' c10.html
15 productos en
15 productos en
$ grep -oE 'aria-label="Filtros aplicados"[^>]*>.*?</nav>' c10.html
(vacío — ningún chip)
```

200, el catálogo completo (15 productos, nada filtrado por la basura), sin
un solo chip.

### Criterio 12 — presupuesto y `"use client"`

```
$ node scripts/check-bundle-budget.mjs
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 177.6 KB gzipped (budget 193 KB)
    HTML:      4.3 KB gzipped
exit=0

$ grep -n "BUDGET_KB = " scripts/check-bundle-budget.mjs
const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 193);
$ git diff main -- scripts/check-bundle-budget.mjs
(sin diferencias — el número no subió)

$ grep -rln '^"use client"' src/components/store/
(sin resultados — ningún componente de la tienda pública es de cliente)
```

### Criterio 16 — `verify.sh --full`, dos veces seguidas

```
$ bash .agent/verify.sh F-027 --full
== Verificación F-027 · intento 10 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     6s
  ✓ test       21s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     1s
PASA
$ echo $?
0

$ bash .agent/verify.sh F-027 --full     # repetido, por el fallo intermitente de abajo
== Verificación F-027 · intento 11 == ... PASA
$ echo $?
0
```

### `smoke.sh` completo

```
$ QAB_BEARER_TOKEN=*** bash .agent/verify.sh F-027 --smoke
== Verificación F-027 · intento 8 ==
  ✓ typecheck  2s
  ✓ lint       6s
  ✓ format     6s
  ✓ test       24s
  ✓ smoke      10s
PASA
```

Las ~60 aserciones de `smoke.sh` (una por línea de `ok` en
`.agent/runs/F-027/008-smoke.log`) cubren los criterios 3, 4, 5, 6, 7, 8, 9,
10, 11, 13, 14 y 15, todas `ok`, 0 `SMOKE FAIL`.

### `visual.mjs` completo

```
$ QAB_BEARER_TOKEN=*** bash .agent/verify.sh F-027 --visual
== Verificación F-027 · intento 9 ==
  ✓ typecheck  1s
  ✓ lint       5s
  ✓ format     6s
  ✓ test       23s
  ✓ visual     26s
PASA
```

Las 18 verificaciones (V1–V18) terminaron en `0 aserciones fallidas`.

## Fallos encontrados

**`test:AssertionError: expected true to be false Object.is equality`** (en
`src/features/catalog/server/search.db.test.ts` › «el EXPLAIN usa los
índices (criterio 8, SP4)» › «(b) the plan of the exact Q1 statement never
Seq Scans StoreProduct»). Es una prueba de **F-021**, no de F-027 (el
criterio del `EXPLAIN` ni siquiera está entre los 16 de `features.json`), y
falló una vez de cuatro corridas completas de `npm test`/`verify.sh --full`
en este ciclo — nunca falló corriendo el archivo solo. La causa real:
`ANALYZE` sin `VACUUM` sobre una tabla que otros `*.db.test.ts` dejaron con
tuplas muertas en la misma sesión serial del proyecto `db`
(`fileParallelism: false`), lo que a veces basta para que el optimizador
prefiera `Seq Scan` en el margen. **Reproducido también en `main`** (sin el
cambio de F-027) bajo la carga suficiente, así que no es una regresión de
este feature — F-027 solo ensancha un poco el `SELECT` de esa misma CTE
(`sp."createdAt"`), lo que puede haber estrechado el margen sin causarlo.

- **Va a**: nadie de este feature. Es una fragilidad de la suite de F-021
  (`search.db.test.ts`), no del código de F-027. Si vuelve a fallar de forma
  repetida, la línea a cambiar (`ANALYZE` → `VACUUM ANALYZE` en el
  `beforeAll` de esa `describe`) es una prueba, no producto, y la posee
  quien mantenga F-021.
- **Ficha**: `.agent/playbook/explain-seq-scan-flaky-bajo-analyze-sin-vacuum.md`
  (nueva). `bash .agent/verify.sh pending F-027` la reconoce.
- **Descartado además** el primer intento de `smoke.sh` (`no se pudo
sembrar la tienda sintética`): bug propio de este guion —la `Slug` de una
  storefront de una sola sucursal cuelga de `storefrontId`, no de
  `storeId`— arreglado en el propio archivo antes de la corrida que cerró
  este ciclo. `bash .agent/verify.sh dismiss F-027 '...' '...'` registrado.

Ningún otro fallo. Las tres desviaciones que `impl.md` § Desviaciones dejó
anotadas (orden de los chips entre `architecture.md` y `design.md`,
`count > 0` como aproximación de la visibilidad de faceta, y
`generateMetadata` recalculando el filtrado) se revisaron con lupa contra
los 16 criterios y contra V1–V18: ninguna de las tres rompe ningún criterio
ni ningún paso visual — el orden de los chips no lo verifica ningún
criterio, `count > 0` coincide con la condición exacta en todos los casos de
la base de hoy (comprobado en V10/V12/V18: «Solo con descuento» ausente con
0 promociones, el atajo de precio ausente en `tienda-dos`), y el doble
cálculo de `generateMetadata` es un coste de CPU, nunca una consulta nueva
ni una discrepancia de contenido.

## Huecos de cobertura

- **El singular «1 producto» del sr-only de los conteos (design.md §
  Accesibilidad)** no se comprobó: ninguna faceta de `tienda-demo` tiene
  conteo exactamente 1 hoy (todas ≥3). El plural sí está probado (V17). Bajo
  riesgo: es un único condicional (`n === 1 ? "producto" : "productos"`) y
  el propio criterio de aceptación 16 no lo exige.
- **El `EXPLAIN` de la lectura de catálogo filtrado** (criterio 15 de
  `spec.md`, ausente de `features.json`) no se verificó — no es un
  criterio de este feature (arquitectura ya lo resolvió: el cálculo de
  precio nunca llega a SQL, así que el hueco es correcto por diseño, no un
  olvido).
- **La revalidación tras un evento de sync real** durante la ventana en la
  que `smoke.sh`/`visual.mjs` mutan la tienda sintética/las categorías por
  `psql` directo se demostró funcionando (los datos aparecen tras el evento
  de sync inocuo), pero no se cronometró un caso límite de carrera con dos
  sesiones escribiendo a la vez sobre la MISMA tienda sintética — cada
  corrida usa su propio sufijo de timestamp, así que esa carrera no puede
  ocurrir entre corridas distintas de este mismo guion, pero sí podría con
  otro guion ajeno operando sobre `seed-negocio-1` al mismo tiempo (el mismo
  riesgo que ya fichó F-026, no uno nuevo de este feature).

## Veredicto

**LISTO.** Los 16 criterios de `features.json` se verificaron ejecutando
HTTP real, un navegador real y una comparación real contra `main` — ninguno
se cerró leyendo código. Las 18 verificaciones visuales de `design.md`
pasaron. `bash .agent/verify.sh F-027 --full` termina en 0, dos veces
seguidas. `bash .agent/verify.sh pending F-027` está vacío.

## Preguntas al humano

Ninguna. No hubo ningún criterio imposible de verificar tal como está
escrito, y el único fallo real de este ciclo (el `EXPLAIN` flaky) es de una
prueba de otro feature, ya fichado y con su severidad (baja, intermitente,
reproducible también sin este cambio) documentada arriba.
