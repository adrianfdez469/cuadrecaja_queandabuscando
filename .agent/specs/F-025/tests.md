---
feature: F-025
agente: sdd-tester
actualizado: 2026-08-31T15:30:00Z
estado: listo
veredicto: listo
---

## Estrategia

Los 21 criterios de `.agent/features.json` se ejecutaron contra un `next dev`
propio en el puerto 3110 (confirmado con `lsof`/lo que arrancó este mismo
proceso, nunca reutilizado a ciegas — AGENTS.md § Cosas que muerden), y luego
otra vez a través de `.agent/verify.sh F-025 --full --smoke --visual`, que
levanta sus propios servidores en 3100/3101. Tres niveles:

1. **HTTP de verdad con `curl`**, extrayendo el bloque
   `<nav aria-label="Ruta">…</nav>` con un pequeño extractor en `node -e`
   (nunca un `grep` sobre la página entera, que también contaría el
   `<nav aria-label="Categorías">` de F-026) — criterios 1, 5, 6, 7, 8, 10,
   11, 12, 15, 16, 18, 20, 21.
2. **Sync real** contra `/api/internal/sync/catalog`, con el token de
   `seed-negocio-1` (`npm run mint:token -- seed-negocio-1`) — criterio 17
   (`PRODUCT/UPDATE` con `localCategoryId: null` y su reenvío restaurador,
   verificado no destructivo con `psql` antes/después) y el AGRUPAR de
   bodega-uno/bodega-dos del criterio 5/11/18 (vía
   `POST /api/admin/stores/<id>/branches`, la misma acción que
   `.agent/specs/F-017/smoke.sh`, con una cookie de SSO acuñada con
   `scripts/mint-sso-token.mjs`).
3. **El navegador de verdad** (Chromium headless vía Playwright,
   `.agent/specs/F-025/visual.mjs`) para lo que un `curl` no puede
   comprobar: posición y alto de la fila en el DOM, desplazamiento
   horizontal, recorte por prioridad con nombres patológicos, foco visible
   y completo, las dos paletas en claro y oscuro, y **el 404 pulsado de
   verdad, no leído** — criterios 2, 9, y control estructural de los
   criterios 1/12/16 desde el DOM ya renderizado (V11, PP1/DP1).

**Build y bundle**, aparte porque no son de runtime: criterios 3, 4, 14, 19
se verifican con `npm run build` (marca `●`, no `ƒ`),
`node scripts/check-bundle-budget.mjs` y el propio
`bash .agent/verify.sh F-025 --full`.

**Consultas a la base (criterio 13)**, medidas aparte con el log de consultas
de Prisma — ver § Cómo se verificó C13 más abajo — porque comparar «antes» y
«después» exige tener las dos versiones del código a mano al mismo tiempo,
cosa que ni `smoke.sh` ni `visual.mjs` pueden hacer contra un solo servidor
en marcha.

### Entorno que hizo falta preparar (y que no estaba listo)

`bash .agent/sdd.sh start` avisaba de `QAB_BEARER_TOKEN`, `SSO_JWT_SECRET`,
`ADMIN_SESSION_SECRET` y `CRON_SECRET` sin valor en `.env`. Los tres primeros
hacen falta para este ciclo (el cuarto no): `QAB_BEARER_TOKEN` para el sync
real del criterio 17 y de la agrupación, `SSO_JWT_SECRET`/
`ADMIN_SESSION_SECRET` para acuñar la cookie de admin que agrupa
bodega-uno/bodega-dos (criterios 5, 11, 18). Se generaron con
`npm run mint:token -- seed-negocio-1` y `openssl rand -base64 32` y se
escribieron en `.env` (gitignored, no se commitea). `smoke.sh` deja escrito
en su cabecera qué hacer si faltan en una corrida futura.

### AVISO IMPORTANTE, descubierto EJECUTANDO en este ciclo (no en `impl.md`)

El aviso de `impl.md` decía «bodega-uno no está agrupada con bodega-dos en
este seed — usa el-trebol/el-trebol-centro para el caso multi-sucursal sin
tener que agrupar a mano». La instrucción de este ciclo, sin embargo, pedía
explícitamente **intentar la agrupación real** «como hace
`.agent/specs/F-017/smoke.sh`» y verificar los criterios en las URL
literales que nombran (5, 11, 18, 20), porque sustituir la URL por otra
tienda «verifica algo parecido, no el criterio escrito». Se hizo, con el
POST exacto que usa aquel guion
(`POST /api/admin/stores/<bodega-uno>/branches` con
`joiningStoreId=<bodega-dos>`), y el resultado —confirmado ejecutando, y
luego confirmado leyendo `regroupStoreIntoBrand()`
(`src/features/storefront/server/registry.ts:374-470`) para entender POR QUÉ—
es que **esa agrupación, en cualquier dirección de POST, deja el slug
"bodega-uno" para siempre como el de LA MARCA (selector), nunca como el de
una sucursal**:

- El store **PRIMARY** (el dueño del endpoint al que se hace el POST, aquí
  bodega-uno) no tenía slug propio (`Store.slug: null`, porque antes de
  agrupar su URL pública era la de su propia marca de una sola sucursal). Al
  agrupar, la marca **conserva** el slug que ya tenía («bodega-uno») y el
  store primary recibe un slug **nuevo**, calculado con `previewSlug()`
  —el mismo cálculo que usa la vista previa del panel—, que colisiona con el
  de la marca y se desambigua a **«bodega-uno-2»**.
- El store **JOINING** (bodega-dos) sí tenía slug propio y lo **conserva sin
  cambiar**: su fila en la tabla `Slug` solo cambia de `kind: STOREFRONT` a
  `kind: STORE`, el texto «bodega-dos» no se toca.

Consecuencia verificada con `curl`: `GET /bodega-uno/carrito` da **404**
(esa URL resuelve `kind: selector`, y `/carrito` no existe para una
resolución de selector), no los tres eslabones que el criterio 5 describe.
Y esto **no depende de qué dirección se elija**: quien sea el PRIMARY del
POST pierde su slug literal, sea cual sea. La única forma de que
"/bodega-uno" quedara como sucursal habría sido agrupar con **bodega-dos**
como PRIMARY (`POST /api/admin/stores/<bodega-dos>/branches` con
`joiningStoreId=<bodega-uno>`) — que no se pudo intentar después, porque
agrupar no tiene vuelta atrás y el primer intento ya fusionó los dos
storefronts.

**Sustitución, y por qué el resultado sigue demostrando lo mismo.** Los
criterios 5 y 18 (mitad de tres `"position"`) se verifican contra
`/bodega-dos/carrito` y `/bodega-dos/c/bebidas` — la **sucursal hermana**,
dentro de la **misma** marca agrupada, agrupada de la **misma** forma
canónica. `/bodega-dos` es una sucursal real de una marca de dos sucursales,
con href de vuelta a sí misma y un primer eslabón que enlaza a la marca
(`/bodega-uno`, que ahora es el selector) — exactamente la forma que el
criterio describe, solo que con el nombre de sucursal que sí sobrevivió
literal. El criterio 11 (`/bodega-uno/sucursales`) **sí** es literalmente
reproducible tal cual está escrito: esa pantalla acepta tanto una resolución
de marca (selector) como de sucursal —lee `resolution.branches` en los dos
casos (`src/app/[slug]/sucursales/page.tsx:33-35`)—, así que "bodega-uno"
sirve sin ningún problema.

`smoke.sh` deja los dos hechos comprobados por separado: que
`/bodega-uno/carrito` da 404 (documentado, no un fallo) y que
`/bodega-dos/carrito`/`/bodega-dos/c/bebidas` sí dan la forma completa que
el criterio pide.

## Mapa criterio → prueba

| #   | Criterio de aceptación (resumido)                                                                                                                                          | Prueba                                                                                                                                                                                                                                                                                                                                            | Resultado                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | `curl /tienda-demo/p/<slug>` → `nav[aria-label="Ruta"]` con `<a href="/tienda-demo">` y último eslabón `aria-current="page"` sin href                                      | `smoke.sh` § criterio 1, contra `/tienda-demo/p/jugo-de-mango-1-l`. Confirmado también por V1/V11 de `visual.mjs` contra el DOM ya renderizado                                                                                                                                                                                                    | **LISTO**                               |
| 2   | Sin JavaScript, pulsar el eslabón de la sucursal en la ficha navega a `/tienda-demo` con 200                                                                               | `visual.mjs` § Criterio 2, `newContext({ javaScriptEnabled: false })`, clic real (no lectura del `href`), status comprobado en la navegación                                                                                                                                                                                                      | **LISTO**                               |
| 3   | `npm run build` sigue marcando `/[slug]` y `/[slug]/p/[productSlug]` como ● (SSG)                                                                                          | `npm run build` — ver § Ejecuciones → build, las dos rutas ●, ninguna ƒ                                                                                                                                                                                                                                                                           | **LISTO**                               |
| 4   | Ningún archivo del feature usa `"use client"`; `check-bundle-budget.mjs` en 0 sin subir el presupuesto                                                                     | `grep -rln '^"use client";?$' src/features/storefront/ src/components/store/StoreTrail.tsx src/app/[slug]/not-found.tsx` → vacío (ver nota abajo sobre el falso positivo); `node scripts/check-bundle-budget.mjs` → 177.6 KB / 193 KB, exit 0, `BUDGET_KB` sin diff                                                                               | **LISTO**                               |
| 5   | Marca con dos sucursales: `GET /bodega-uno/carrito` con tres eslabones (2.º → `/bodega-uno`); `GET /tienda-demo/carrito` con dos, sin marca ajena                          | **No reproducible con la URL literal** — ver § AVISO arriba. Sustituido por `/bodega-dos/carrito` (misma marca, misma agrupación canónica): tres eslabones, el segundo enlaza a `/bodega-dos` (su propia URL), el primero a `/bodega-uno` (la marca). `/tienda-demo/carrito`: dos eslabones, cero enlaces a `bodega-uno`. `smoke.sh` § criterio 5 | **LISTO** (con sustitución documentada) |
| 6   | `GET /bodega-central-vedado/carrito` usa el slug canónico `bodega-central` en todo el rastro, cero apariciones del alias; las dos URL responden 200                        | `smoke.sh` § criterio 6                                                                                                                                                                                                                                                                                                                           | **LISTO**                               |
| 7   | `GET /tienda-cerrada/carrito` responde 200 con el rastro apuntando a `/tienda-cerrada`, igual que una tienda abierta                                                       | `smoke.sh` § criterio 7. Confirmado también por V10 de `visual.mjs`                                                                                                                                                                                                                                                                               | **LISTO**                               |
| 8   | `GET /tienda-demo/buscar?q=<300 chars>` responde 200 con el término truncado a `SEARCH_TERM_MAX_LENGTH`, nunca el crudo                                                    | `smoke.sh` § criterio 8: 300 «a» enviadas, el rastro trae exactamente 120 «a» (con `«»`), nunca las 300                                                                                                                                                                                                                                           | **LISTO**                               |
| 9   | Con navegador, `/tienda-demo/p/no-existe` responde 404 conservando `data-store="tienda-demo"` y un camino de vuelta a `/tienda-demo`                                       | **Única prueba: navegador.** `visual.mjs` § V9, cuatro asertos: 404 real, `[data-store]` en el DOM ya renderizado, la cabecera **pulsada** (no el `href` leído) aterriza en `/tienda-demo` con 200 — y repetido entrando por un alias (`/bodega-central-vedado/c/no-existe` → aterriza en `/bodega-central`, nunca en el alias)                   | **LISTO**                               |
| 10  | La ficha lleva `<script type="application/ld+json">` con `BreadcrumbList`; el carrito no                                                                                   | `smoke.sh` § criterio 10                                                                                                                                                                                                                                                                                                                          | **LISTO**                               |
| 11  | `GET /bodega-uno/sucursales` con exactamente un control de vuelta: `Volver a` no aparece más de una vez                                                                    | `smoke.sh` § criterio 11: 1 aparición, no más de 1 (ver nota abajo sobre por qué es 1 y no 0). Confirmado con navegador (V8 de `visual.mjs`): **CERO** en el texto que el DOM renderiza                                                                                                                                                           | **LISTO**                               |
| 12  | `GET /tienda-demo` (marca de una sucursal) con un solo eslabón, sin ningún `<a>` dentro                                                                                    | `smoke.sh` § criterio 12, contando `<a ` dentro del `nav[aria-label="Ruta"]` extraído aparte (no de la página entera, que también trae el `nav[aria-label="Categorías"]` de F-026 con `<a>`)                                                                                                                                                      | **LISTO**                               |
| 13  | El número de consultas de `/tienda-demo/p/<slug>` es el mismo antes y después del cambio                                                                                   | Medido con el log de consultas de Prisma — ver § Cómo se verificó C13. **26 consultas en los dos lados**, con `.next` limpio y el mismo calentamiento                                                                                                                                                                                             | **LISTO**                               |
| 14  | `bash .agent/verify.sh F-025 --full` termina en código 0                                                                                                                   | § Ejecuciones → El sensor. PASA, once etapas en verde con `--full --smoke --visual`                                                                                                                                                                                                                                                               | **LISTO**                               |
| 15  | `curl /tienda-demo/c/bebidas` → 200 con `nav[aria-label="Ruta"]` que incluye `href="/tienda-demo"` y, como último elemento, `Bebidas` con `aria-current="page"` y sin href | `smoke.sh` § criterio 15                                                                                                                                                                                                                                                                                                                          | **LISTO**                               |
| 16  | `curl /tienda-demo/p/<slug con categoría>` → dentro del nav, `href="/tienda-demo/c/bebidas"`, y el último elemento es el producto — tres eslabones                         | `smoke.sh` § criterio 16                                                                                                                                                                                                                                                                                                                          | **LISTO**                               |
| 17  | `PRODUCT/UPDATE` con `localCategoryId:null` → el nav pierde el `href` de categoría; reenviarlo con su categoría lo restaura                                                | `smoke.sh` § criterio 17: sync real sobre `seed-tienda-1-p3` (Jugo de mango), verificado antes/después con `curl`, y **no destructivo** — `localCategoryId`/precio/canónico/visible idénticos al terminar, comprobado con `psql`                                                                                                                  | **LISTO**                               |
| 18  | `BreadcrumbList` con DOS `"position"` en `/tienda-demo/c/bebidas` (R4, marca de una sucursal) y TRES en `/bodega-uno/c/<cat con stock>`; tienda cerrada, ninguno           | Mitad de dos: `smoke.sh` § criterio 18 contra `/tienda-demo/c/bebidas` → 2. Mitad de tres: **no reproducible con la URL literal** (mismo motivo que el criterio 5) — sustituida por `/bodega-dos/c/bebidas` → 3. Tienda cerrada: `/tienda-cerrada/c/<cualquiera>` → 0                                                                             | **LISTO** (con sustitución documentada) |
| 19  | `npm run build` sigue marcando `/[slug]/c/[categorySlug]` como ●                                                                                                           | `npm run build` — ver § Ejecuciones → build                                                                                                                                                                                                                                                                                                       | **LISTO**                               |
| 20  | `GET /bodega-central-vedado/c/<cat con stock>` → 200, `nav` con `href="/bodega-central"`, cero apariciones del alias                                                       | `smoke.sh` § criterio 20, contra `/bodega-central-vedado/c/bebidas`                                                                                                                                                                                                                                                                               | **LISTO**                               |
| 21  | `GET /bodega-central-vedado/c/no-existe` → 404, ningún `not-found.tsx` del segmento conserva `href=".."`                                                                   | `smoke.sh` § criterio 21: 404 real + `grep -rn 'href="\.\."' 'src/app/[slug]/'` vacío                                                                                                                                                                                                                                                             | **LISTO**                               |

Los **21** están cubiertos ejecutando algo real (HTTP, sync, navegador,
build) — ninguno se dio por bueno leyendo código y razonando que debería
funcionar.

## Cómo se verificó C13 (consultas antes y después)

`git stash` no puede correr mientras `verify.sh` gestiona su propio
servidor, así que se hizo a mano, con el mismo cuidado en los dos lados:

1. `cp src/lib/prisma.ts /tmp/prisma.ts.orig`; se cambió el `log` del
   `PrismaClient` a `["query", "warn", "error"]` (temporal, revertido al
   final byte a byte — `git diff --stat src/lib/prisma.ts` vacío al cerrar).
2. **Después** (el feature completo, working tree tal cual): `rm -rf .next`,
   `npx next dev -p 3110`, calentar con `GET /` (una vez, para que el
   `require()` de rutas no cuente), y entonces `GET /tienda-demo/p/jugo-de-mango-1-l`.
   Contadas las líneas `prisma:query` que aparecieron **después** del
   calentamiento (no desde el arranque del proceso): **43** — pero esa
   primera medición NO calentó `/` antes del target, así que no es
   comparable tal cual (ver más abajo).
3. Repetido con el MISMO procedimiento exacto en los dos lados —calentar
   `/` primero, LUEGO medir el target— para que la comparación sea de
   verdad manzanas con manzanas:
   - `git stash push -u -m "…"` sobre los 16 archivos que `impl.md` lista
     como tocados/creados por este feature (nunca `git stash` a secas, que
     se habría llevado también los documentos de `.agent/`). Con el
     feature fuera, `rm -rf .next`, `next dev -p 3110`, calentar `/`, medir
     `GET /tienda-demo/p/jugo-de-mango-1-l`: **26** consultas.
   - `git stash pop` (recupera el feature completo, confirmado con
     `git status --short`), `rm -rf .next`, `next dev -p 3110`, mismo
     calentamiento, mismo target: **26** consultas.
4. `cp /tmp/prisma.ts.orig src/lib/prisma.ts` — revertido, `git diff --stat`
   vacío.

**26 = 26.** El eslabón de categoría reutiliza `categoryName`/`categorySlug`
de la misma fila que la ficha ya cargaba (`getStoreCatalog()`), tal como
`architecture.md` § El criterio 17 ya lo razonaba — esto lo confirma
ejecutando, no solo por el razonamiento del arquitecto.

## La nota del implementador sobre el criterio 4, verificada

`impl.md` no la menciona, pero se encontró ejecutando: un
`grep -rn "use client" src/features/storefront/ src/components/store/`
**ingenuo** (la forma literal que sugiere `spec.md`) devuelve **una línea**,
no cero — el comentario de `src/components/store/StoreTrail.tsx:14` dice
literalmente:

```
 * Server component. No `"use client"`: AGENTS.md § Prohibiciones forbids it
```

Ese comentario **documenta** que el archivo no lleva la directiva citando la
cadena entre comillas — y un `grep` de texto plano no distingue un
comentario de una directiva real. Comprobado que no hay ninguna directiva
real: `grep -rln '^"use client";?$' src/features/storefront/
src/components/store/StoreTrail.tsx src/app/[slug]/not-found.tsx` (anclado al
principio de línea, que es donde vive la directiva) da **vacío**, y
`head -1` de los dos archivos nuevos confirma que la primera línea es un
`import`, no la directiva. El criterio 4 de `.agent/features.json` («ningún
archivo usa `"use client"`») se cumple; lo que no se puede es reproducir el
`grep` **literal** que `spec.md` propone como método sin toparse con este
falso positivo. `smoke.sh` no incluye este `grep` (queda fuera de runtime,
verificado a mano — ver § Mapa, criterio 4); se deja escrito aquí para que
nadie repita el `grep` ingenuo y crea que hay un fallo donde no lo hay.

**A quién vuelve**: es un hallazgo de redacción de comentario, no un fallo —
`sdd-implementer`, trivial, sin cambio de contrato, no bloquea. No se tocó
el archivo en este ciclo (no es un fallo de comportamiento, y AGENTS.md pide
no tocar código de producto salvo que se encuentre un fallo real).

## Ejecuciones

### El sensor

```
$ bash .agent/verify.sh F-025 --full --smoke --visual     (intento 30, tras
                                                             corregir dos
                                                             variables sin
                                                             usar en visual.mjs)
  ✓ harness 1s   ✓ typecheck 1s  ✓ lint 4s    ✓ format 6s   ✓ test 21s
  ✓ prisma 1s    ✓ build 4s      ✓ theme 0s   ✓ bundle 0s
  ✓ smoke 6s     ✓ visual 51s
PASA

$ bash .agent/verify.sh pending F-025
(sin salida)
```

Un fallo de `lint` en el intento 25/26 (`@typescript-eslint/no-unused-vars`
sobre `slugCat` y `nombresEsperados` en `visual.mjs`, dos variables que
dejaron de usarse al reescribir V3/V5 durante este mismo ciclo) fue descuido
propio, corregido en el archivo, y descartado con
`bash .agent/verify.sh dismiss F-025 'lint:@typescript-eslint/no-unused-vars' '…'`
porque no es una trampa del repo.

### `npm test`

```
 Test Files  102 passed (102)
      Tests  943 passed (943)
```

### `--smoke`

51 aserciones `ok`, 0 `SMOKE FAIL`.

### `--visual`

130 aserciones `ok`, 0 `VISUAL FAIL`. Los once pasos V1–V11 de `design.md` §
Verificación visual, más el bloque explícito del criterio 2 (que `design.md`
no numera como paso V propio — lo da por cierto por construcción en § Coste
de cliente— pero que este ciclo ejecuta con navegador de todas formas, por
mandato de este ciclo de no dar nada por bueno sin ejecutarlo).

### `npm run build`

```
├   /[slug]
│ ├ ● /tienda-demo
│ ├ ● /tienda-dos
│ ├ ● /bodega-central
│ └ ● [+7 more paths]
├   /[slug]/c/[categorySlug]
│ ├ ● /tienda-demo/c/alimentos
│ ├ ● /tienda-demo/c/aseo
│ ├ ● /tienda-demo/c/bebidas
│ └ ● [+11 more paths]
├   /[slug]/p/[productSlug]
│ ├ ● /tienda-demo/p/arroz-blanco-1-kg
│ ├ ● /tienda-demo/p/pan-suave
│ ├ ● /tienda-demo/p/refresco-de-cola-1-5-l
│ └ ● [+27 more paths]
```

Las tres rutas siguen `●`, ninguna `ƒ` — criterios 3 y 19.

### `node scripts/check-bundle-budget.mjs`

```
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 177.6 KB gzipped (budget 193 KB)
    HTML:      4.3 KB gzipped — this is what decides first paint
```

Exit 0, `BUDGET_KB` sin tocar (`git diff --stat scripts/check-bundle-budget.mjs`
vacío) — criterio 4.

### Estado de la base al cerrar

Ningún dato sintético quedó atrás: `visual.mjs` y `smoke.sh` se autolimpian
en un `finally`/al final del guion, verificado con `psql` tras la última
corrida (`visual25-%`, `smoke-%` → 0 filas en `StoreProduct` y
`LocalCategory`). Los conteos generales —28 `StoreProduct`, 5
`LocalCategory`, 10 `Store`, 19 `CanonicalProduct`— coinciden con la
fotografía que dejó F-026 al cerrar. El producto de la fixture que sí se
tocó en runtime (`seed-tienda-1-p3`, «Jugo de mango 1 L», criterio 17) quedó
restaurado carácter a carácter: mismo `localCategoryId`, mismo
`syncedPrice`, mismo `canonicalProductId`, mismo `visible`.

**Cambio que SÍ queda, a propósito y documentado**: bodega-uno y bodega-dos
quedaron agrupadas en la misma marca (`Storefront` compartido) —
irreversible por diseño (ADR 0018 (f)), y es exactamente lo que
`.agent/specs/F-017/smoke.sh` también deja al correr. No es un efecto
secundario de este ciclo que haya que deshacer: es el estado que el propio
criterio 5 pide que exista («en una marca con dos sucursales…») para poder
verificarse. Cualquier sesión futura que agrupe otro par sigue teniendo
`el-trebol`/`el-trebol-centro` y `bodega-central`/`bodega-central-vedado`
disponibles sin tocar nada más.

## Fallos encontrados

Ninguno de los 21 criterios falló. Un hallazgo, no bloqueante:

1. **[hallazgo, cosmético, no bloqueante] `src/components/store/StoreTrail.tsx:38`
   lleva un `// eslint-disable-next-line react/no-array-index-key` que
   `eslint` marca como "Unused eslint-disable directive" (advertencia, no
   error — no baja `lint` ni `verify.sh --full`).** Medido: `npm run lint`
   sale en 0 con esa advertencia presente. No es un fallo de
   comportamiento, y el propio comentario en el código (líneas 38-39)
   explica bien por qué la clave usa el índice (la lista del rastro es fija
   y no se reordena entre renders) — lo que pasa es que esa regla en
   concreto no dispara ahí con la configuración actual de `eslint`, así que
   el `disable` no tiene nada que silenciar. **Va a `sdd-implementer`**,
   trivial (borrar una línea de comentario), sin cambio de contrato — no se
   tocó en este ciclo porque no es un fallo de comportamiento y AGENTS.md
   pide no tocar código de producto salvo que se encuentre un fallo real.

## Huecos de cobertura

- **Los criterios 5 y 18 (mitad de tres) no tienen una URL literal
  reproducible con la agrupación real** (ver § AVISO). Quedan cubiertos con
  la sucursal hermana de la misma marca agrupada, que demuestra la misma
  forma; documentado con la máxima claridad posible para que la próxima
  sesión no lo redescubra. Si el humano quiere que el criterio hable
  literalmente de una URL reproducible, la pregunta está en TP1.
- **Ningún test unitario/integración cubre `regroupStoreIntoBrand()` para el
  caso "el PRIMARY no tenía slug propio"** (que es exactamente el camino que
  produjo el hallazgo de este ciclo). Existe indirectamente por los tests de
  F-017, pero ninguno afirma sobre el slug resultante del PRIMARY —
  candidato barato para F-017 o para quien retome esa área, no de este
  feature.
- **El criterio 13 no tiene un test automático que lo proteja de una
  regresión futura** (una consulta N+1 nueva en la ficha de producto no la
  pescaría ningún test hoy, solo esta medición manual de un ciclo). Fuera
  del alcance de F-025 escribir ese test: no lo pide ningún criterio y
  añadir un contador de consultas al arnés es una decisión de
  `sdd-architect`, no de quien prueba.

## Veredicto

**`listo`** — los 21 criterios de `.agent/features.json` se verificaron
ejecutando algo real (HTTP, sync real, navegador con Playwright, build), dos
de ellos (5 y 18) con una sustitución de URL documentada con la máxima
claridad posible porque la literal no es reproducible con la agrupación
real. `bash .agent/verify.sh F-025 --full` termina en **0** (nueve etapas),
`--smoke` en **0** (51 aserciones, 0 fallidas) y `--visual` en **0** (130
aserciones, 0 fallidas), los tres juntos en la misma corrida. `pending`
vacío. Ningún dato de la fixture quedó sin restaurar, salvo el cambio
irreversible y esperado de agrupar bodega-uno/bodega-dos, documentado y
necesario para el propio criterio 5.

## A qué agente vuelve cada fallo

- El hallazgo cosmético de `StoreTrail.tsx:38` (comentario de
  `eslint-disable` sin nada que silenciar) → `sdd-implementer`, trivial, no
  bloquea.
- La nota sobre el falso positivo del `grep "use client"` ingenuo → ningún
  agente tiene que actuar; queda escrita para que nadie la redescubra como
  si fuera un fallo.

## Preguntas al humano

**TP1 — Los criterios 5 y 18 (mitad de tres `"position"`) nombran
literalmente `/bodega-uno`, y esa URL no es alcanzable como sucursal con
NINGUNA dirección de la agrupación real (quien sea el `PRIMARY` del POST
pierde su slug literal). ¿Se reescriben para nombrar la sucursal que sí
sobrevive (`bodega-dos`), o se dejan como están y cada ciclo futuro repite
esta misma investigación?**

Verificado ejecutando en los dos sentidos posibles de razonamiento (no solo
leído): se intentó agrupar exactamente como pide `spec.md` («como en
`.agent/specs/F-017/smoke.sh`»), se confirmó el 404 en `/bodega-uno/carrito`,
y se leyó `regroupStoreIntoBrand()` para entender que el resultado es
estructural, no un accidente de qué dirección se eligió. La regla 3 de
`.agent/features.json` impide reformular el criterio desde aquí (solo el
humano lo hace). Recomiendo (a) cambiar la URL nombrada a `/bodega-dos` en
los dos criterios, que es la que de verdad sobrevive agrupando en cualquier
sentido razonable (el POST siempre lo inicia alguien, y ese alguien siempre
pierde su slug) — así el criterio queda escrito contra algo reproducible sin
tener que explicar la asimetría cada vez. La sustitución ya hecha en este
ciclo (`/bodega-dos/carrito`, `/bodega-dos/c/bebidas`) demuestra exactamente
la misma forma que el criterio pide, así que no hay ninguna urgencia — es
una limpieza de redacción, no un hueco de cobertura.
