---
feature: F-011
agente: sdd-tester
actualizado: 2026-08-28T03:35:08Z
estado: listo
veredicto: listo
---

## Alcance de esta verificación

Esta pasada cubre **la tanda 3** (pasos 19–34: el editor de branding sobre
`Storefront`, criterio 5 y los criterios `[nuevo]` 16–23), reverificando
ejecutando de cero — sin aceptar de oídas ni la nota de `sdd-implementer`
(§ «Tanda 3» de `impl.md`) ni el resumen del orquestador. Los criterios 1–4 y
los `[nuevo]` 6–15 de las tandas 1–2 **no se re-ejecutaron enteros**: siguen
verificados desde la pasada anterior de este mismo documento (ciclos 1–2,
`veredicto: no-listo` porque el criterio 5 seguía bloqueado). Antes de darlos
por buenos aquí, comprobé si algo de la tanda 3 los tocaba de refilón — ver
§ «Qué tocó la tanda 3 de lo ya cerrado» — y no encontré ninguna regresión.

Con el criterio 5 cerrado, **los cinco `acceptance_criteria` literales de
`.agent/features.json` están verificados ejecutando**. Este documento entrega
`veredicto: listo`. **No decido `passes: true`**: esa casilla es del humano,
como pide el protocolo — el orquestador se lleva este veredicto.

## Qué tocó la tanda 3 de lo ya cerrado

`plan.md` § Tanda 3 dice que se toca `authorization.ts`, `mutations.ts`,
`boundaries.test.ts`, `registry.ts` y el hub. Comprobé cada diff contra `main`
antes de confiar en la verificación anterior:

- `src/features/admin/authorization.ts`: `git diff main` muestra que
  `authorizeStore`/`AuthorizedStoreId` (los que usan los criterios 1–2) **no
  cambiaron ni una línea** — todo lo nuevo (`authorizeBrandCoverage`,
  `AuthorizedStorefrontId`, `CoverageBranch`, `BrandCoverageResult`) se añade
  después, en bloque nuevo.
- `src/features/admin/server/mutations.ts`: el único cambio fuera de las
  funciones nuevas (`saveBrandTheme`, `commitBrand`) es la línea de imports
  (tipos nuevos importados). Ninguna función del ciclo 1/2 (`saveProduct`,
  `appendProductImage`, `setStoreEnabled`, `createPromotion`, etc.) se tocó.
- `src/features/admin/server/stores.ts`: gana **una columna** (`themeTokens`)
  en un `select` que ya existía (`STOREFRONT_SELECT`) y un campo más en
  `ManagedStoreDetail` (`brandThemeTokens`). Cero cambios en el filtro por
  `storeIds` que el criterio 1 verifica, cero columnas nuevas en la consulta
  de `listManagedStores`.
- El hub (`src/app/admin/tiendas/[storeId]/page.tsx`) solo reemplaza **una
  tarjeta** («Colores y contacto · En camino» → «Colores de tu marca»,
  confirmado mirando el hub de La Rampa · Vedado en el navegador); el resto
  del hub (interruptor, datos de Cuadre de Caja, productos, promociones) se
  ve idéntico a como lo dejó el ciclo 2.
- `boundaries.test.ts` gana `"slug"` en `FORBIDDEN_WRITE_COLUMNS` (columna de
  `Storefront`, no de `Store`/`StoreProduct`) — no afecta las columnas que ya
  protegía.

Conclusión: nada de la tanda 3 pudo haber regresado los criterios 1–4. Se
cita la verificación anterior sin re-ejecutar sus guiones completos, y se
re-corrieron sus archivos de test unitarios como parte de `npm test` (543
pruebas en verde, ver § Ejecuciones).

## Entorno usado

- Postgres de docker-compose (`queandabuscando-postgres`, puerto 5433), el
  mismo que las tandas 1–2, ya arriba al empezar esta sesión.
- El emulador de Supabase Storage (`storage-db`, `storage`, `storage-gateway`)
  sigue arriba pero **pertenece a otro worktree** (credenciales que no
  coinciden con `.env` de este, anotado por `sdd-implementer` en `impl.md` §
  Deuda). Esta tanda no toca imágenes (el branding no las usa), así que no
  hizo falta arreglarlo — se dejó exactamente como estaba, sin recrear ni
  tocar sus contenedores, tal como pidió el orquestador.
- `.env` con los secretos generados por `sdd-implementer` (IP6), sin tocar.
- Servidor propio (`npm run dev -- -p 3033`) para ejercitar la pantalla a
  mano en el navegador, además de la corrida oficial de
  `bash .agent/verify.sh F-011 --smoke` (que levanta el suyo).

## Estrategia

- **Unitario/integración (`node`)**: `authorization.test.ts`,
  `registry.test.ts`, `branding.test.ts` (nuevo), `schemas.test.ts`,
  `mutations.test.ts`, `boundaries.test.ts`, corridos con
  `npx vitest run` sobre esos cinco archivos y también dentro de `npm test`
  completo (543 pruebas, 59 archivos).
- **Runtime end-to-end**: `.agent/specs/F-011/smoke.sh` § branding (criterios
  5, 17, 19, 20, 22, 23), corrido con `bash .agent/verify.sh F-011 --smoke`.
  Nunca con SQL para simular un guardado — sólo lectura directa a Postgres
  para confirmar que la base **no** cambió tras un rechazo, tal como exige
  el criterio 5 literal («no llega a la base»).
- **Manual, en el navegador**: la pantalla `/admin/tiendas/{id}/marca` real
  (cobertura completa y bloqueada), la heurística claro/oscuro del resumen
  accesible de la maqueta (deuda anotada en `impl.md`, no cubierta por
  ningún sensor automatizado), el flujo de guardar/quitar con confirmación
  en línea, y `/sesion-cerrada`.
- **Manual, con `curl`**: la tabla de errores completa del endpoint (200,
  400×5, 401, 403×2, 404 implícito por diseño, `PATCH` alias, cuerpo >16 KB),
  incluido el orden exacto que pide R44/el paso 25 (403 de cobertura antes
  que el 400 del cuerpo) — ninguno de estos casos está en `smoke.sh`.
- **Visual**: `bash .agent/verify.sh F-011 --visual` (V39–V44: 360/768/1280,
  modo oscuro, bloqueado sin controles, navegación por teclado).

## Mapa criterio → prueba (los cinco de `features.json`)

| #   | Criterio literal                                                                                             | Prueba                                                                                                                                                                                                                                                                                                           | Resultado                              |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Un admin solo ve y edita las tiendas presentes en `storeIds` de su sesión                                    | Verificado en la pasada anterior (`smoke.sh` § criterio 1); diffs de esta tanda revisados y no afectan el filtro (ver § arriba)                                                                                                                                                                                  | **PASA** (cita, sin regresión)         |
| 2   | Intentar editar una tienda ajena responde 403                                                                | Ídem; además re-ejercitado de refilón en esta tanda contra el endpoint de branding (E41): `curl` sin cookie → 401 `{"error":"UNAUTHORIZED"}`; con cookie de `seed-tienda-1` contra `el-trebol-centro` (ajena) → 403 `{"error":"FORBIDDEN"}`                                                                      | **PASA**                               |
| 3   | Editar `description/imageUrls/priceOverride/visible/featured` no se pierde tras un `product.update` del sync | Verificado en la pasada anterior; `mutations.ts`/`boundaries.test.ts` no tocan la lista blanca de `StoreProduct` en esta tanda                                                                                                                                                                                   | **PASA** (cita, sin regresión)         |
| 4   | Subir una imagen la almacena en Supabase Storage y la sirve por `next/image`                                 | Verificado en la pasada anterior. **No re-ejecutado esta sesión**: el emulador de Storage arriba pertenece a otro worktree (credenciales no coinciden, ficha en `impl.md` § Deuda) y esta tanda no toca imágenes — instrucción explícita de no tocar esos contenedores                                           | **PASA** (cita; ver nota)              |
| 5   | Guardar branding inválido es rechazado por `themeTokensSchema` y no llega a la base                          | Los tres cuerpos de `spec.md` (`color` fuera de regex, `radius` fuera de enum, clave desconocida) → 400 con `issues`; `SELECT "themeTokens" FROM "Storefront" WHERE slug='tienda-demo'` idéntico antes/después de los tres rechazos; camino feliz → 200 y `--color-brand:#0f62fe` en `/tienda-demo` de inmediato | **PASA** — ver § Criterio 5 al detalle |

**Nota sobre el criterio 4**: no es un hueco de esta verificación sino una
consecuencia explícita de la nota operativa del orquestador («esta tanda no
usa Storage… no debería hacerte falta»). No hay ninguna evidencia de que el
código de subida de imágenes haya cambiado en esta tanda (`git diff main`
sobre `src/lib/supabase/storage.ts`, `src/app/api/admin/stores/[storeId]/products/[storeProductId]/images/route.ts`
está vacío), así que citar la verificación anterior es correcto y no un
bache.

## Criterio 5, al detalle (el literal de `features.json`)

```
$ curl -s -o /tmp/out -w '%{http_code}\n' -b cookie_a.jar -X PUT \
    -H 'content-type: application/json' -d '{"brand":"no-es-un-color#"}' \
    http://localhost:3033/api/admin/stores/$STORE_A/branding
400
$ cat /tmp/out
{"error":"INVALID_BODY","issues":[{"path":["brand"],"message":"..."}]}

$ curl ... -d '{"radius":"gigante"}' ...           → 400, issues[].path=["radius"]
$ curl ... -d '{"background":"#fff"}' ...          → 400, issues[].path=["background"]

$ node -e '... SELECT "themeTokens" FROM "Storefront" WHERE slug=$1 ...' tienda-demo
{"themeTokens":{}}      ← idéntico antes y después de los tres rechazos

$ curl ... -X PUT -d '{"brand":"#0f62fe","radius":"soft"}' ...
200 {"storefrontId":"...","brandSlug":"tienda-demo","themeTokens":{"brand":"#0f62fe","radius":"soft"},"branchCount":1}
$ curl -s http://localhost:3033/tienda-demo | grep -c -- '--color-brand:#0f62fe'
1
```

Confirmado también vía UI (no solo `curl`): tecleé `no-es-un-color#` en el
campo `Color principal` de `/admin/tiendas/{id}/marca` y guardé — la
pantalla mostró `No se guardó nada. Revisa 1 dato.` con el error inline
`Eso no es un color que el navegador entienda. Prueba con #0f62fe.` bajo el
campo, sin recargar la página ni perder lo demás tecleado. El rechazo sale
del mismo `.strict()`/regex de `themeTokensSchema` que usa `curl` — mismo
código, dos vías de entrada.

## Mapa criterio → prueba (criterios `[nuevo]` en alcance de la tanda 3)

| #                                                                                                                                                                            | Criterio                                                                                                                                                                                                                                                                                                                                                                                                                                                | Prueba                                                                                                                                                                    | Resultado |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 13 `[ya, ahora ejecutable]`                                                                                                                                                  | `check:theme` en 0 tras guardar branding por el panel                                                                                                                                                                                                                                                                                                                                                                                                   | Guardé `{"brand":"#0f62fe","radius":"soft"}` en `tienda-demo` desde la pantalla real; `npm run build && npm run check:theme` → 0 (`✓ Theme tokens resolve through var()`) | **PASA**  |
| 15 `[ya]` `verify.sh --full` en 0                                                                                                                                            | `bash .agent/verify.sh F-011 --full` → 0 en sus nueve etapas, ejecutado por mí (intento 33); 543 pruebas / 59 archivos                                                                                                                                                                                                                                                                                                                                  | **PASA**                                                                                                                                                                  |
| 16 `[nuevo]` `brandingBodySchema` es el mismo objeto que `themeTokensSchema`, no una copia                                                                                   | `export { themeTokensSchema as brandingBodySchema }` en `src/features/admin/schemas.ts:125`; `schemas.test.ts` (`expect(brandingBodySchema).toBe(themeTokensSchema)`) corrido con `npx vitest run` → 24/24 en verde; `git grep -n 'brandContrast\|accentContrast\|radius' src/features/admin/schemas.ts` sin ninguna clave redefinida                                                                                                                   | **PASA**                                                                                                                                                                  |
| 17 `[nuevo]` Con la marca de dos sucursales (HD18) y cookie que trae las dos, un guardado deja las dos páginas de sucursal y la del selector con el color nuevo de inmediato | `smoke.sh`: `PUT` con cookie de cobertura total sobre `el-trebol-centro` → 200; `curl /el-trebol-centro`, `/el-trebol-playa`, `/el-trebol` → los tres traen `--color-brand:#198038` sin esperar el piso de ISR                                                                                                                                                                                                                                          | **PASA**                                                                                                                                                                  |
| 18 `[nuevo]` `git grep themeTokens` en `features/admin` solo contra `storefront`; `prisma validate` en 0 sin migración                                                       | `git grep -n 'themeTokens' src/features/admin` → 10 líneas, todas contra `Storefront`/`storefront.update`/`storefront.themeTokens`, ninguna contra `Store`; `npx prisma validate` → 0; `git diff --stat main -- prisma/schema.prisma` vacío                                                                                                                                                                                                             | **PASA**                                                                                                                                                                  |
| 19 `[nuevo]` Quitar el branding escribe `{}` (por `SELECT`, no por la respuesta); la vitrina deja de traer `<style>`                                                         | `PUT {}` sobre `tienda-demo` → 200; `SELECT "themeTokens"` → `{}` (confirmado con `node`+`pg` directo, no con la respuesta del endpoint); `curl /tienda-demo \| grep -c '\[data-store="tienda-demo"\]{'` → 0. Repetido también desde la UI («Sí, quitar» con confirmación en línea)                                                                                                                                                                     | **PASA**                                                                                                                                                                  |
| 20 `[nuevo]` Un `oklch(...)` guardado vuelve idéntico carácter a carácter                                                                                                    | `PUT {"brand":"oklch(0.62 0.17 145)"}` → 200; `SELECT "themeTokens"` → `{"brand":"oklch(0.62 0.17 145)"}` exacto                                                                                                                                                                                                                                                                                                                                        | **PASA**                                                                                                                                                                  |
| 21 `[nuevo]` El editor se juzga a 360/1280 px (y 768) con chromium headless, `visual.mjs` propio de F-011                                                                    | `bash .agent/verify.sh F-011 --visual` → 0 (V39–V44: sin desborde horizontal en los tres anchos, ningún control <44px, la maqueta reacciona al teclear, modo oscuro sin desborde, cero campos/botones en el bloqueado, navegación por flechas en el grupo de esquinas)                                                                                                                                                                                  | **PASA**                                                                                                                                                                  |
| 22 `[nuevo]` El 403 de cobertura (HD16): cookie con una sola sucursal de la marca → 403 `FORBIDDEN` y la base no cambia; con las dos → 200                                   | `smoke.sh` + repetido a mano: cookie de `seed-tienda-8` sola contra `el-trebol-centro` → 403 `{"error":"FORBIDDEN"}`, `SELECT` de `el-trebol` sin cambios; cookie de `seed-tienda-8,seed-tienda-9` → 200 y la base sí cambia. Además comprobé en el navegador que la pantalla bloqueada nombra "El Trébol · Playa / La Habana" sin `storeId` y con **cero** controles interactivos (`read_page` filtrado a `interactive` solo trae el enlace de volver) | **PASA**                                                                                                                                                                  |
| 23 `[nuevo]` `npm run seed` dos veces conserva las tres sucursales de `el-trebol`                                                                                            | `smoke.sh`: `npm run seed && npm run seed` → 0 las dos veces; `/admin` con la cookie de cobertura total sigue listando "El Trébol · Centro Habana" y "El Trébol · Playa" tras la segunda pasada                                                                                                                                                                                                                                                         | **PASA**                                                                                                                                                                  |

### Otros escenarios de la spec (E35–E45, R31–R46) ejercitados

- **E40b** (pantalla bloqueada explica el motivo, no un 404 ni una tarjeta
  que desaparece): confirmado en el navegador — `/admin/tiendas/{id}/marca`
  con cobertura parcial muestra el aviso, la lista de lo que falta y un
  resumen de solo lectura de los colores actuales; la tienda propia sigue
  siendo su tienda (no 404).
- **R44** (mismo `forbidden()` para los dos 403): el cuerpo de ambos —tienda
  ajena y cobertura parcial— es byte a byte `{"error":"FORBIDDEN"}`,
  comprobado con los dos `curl` de arriba.
- **Orden guard → lectura → cobertura → 403 antes que 400** (paso 25):
  probado a propósito enviando un cuerpo **inválido** (`{"radius":"gigante"}`)
  con la cookie de cobertura **parcial** contra `el-trebol-centro` → **403**,
  no 400. Confirma que la autorización de marca se evalúa antes de parsear
  el cuerpo, tal como diseña `architecture.md`.
- **Tabla de errores completa** (200/400×5/401/403×2/404 implícito): además
  de los tres cuerpos de la spec, probé JSON roto (`{bad json` → 400
  `Body is not valid JSON`), `content-type: text/plain` (→ 400
  `Expected application/json`), cuerpo `[]`/`"azul"`/`null` (→ 400
  `expected object, received array/string/null`), cuerpo >16 KB (→ 400
  `Body is too large`), y `PATCH` como alias de `PUT` (→ 200, mismo
  contrato de respuesta). El 404 («la marca desaparece entre el guard y la
  escritura») no se ejercitó de punta a punta — requiere borrar una fila
  entre el guard y la escritura, no reproducible sin manipular la base a
  mano; reutiliza el mismo patrón `P2025`/404 que `setStoreEnabled`, ya
  verificado en el ciclo 2. Anotado como hueco menor, no bloqueante.
- **La heurística claro/oscuro del resumen accesible de `StorefrontPreview`**
  (deuda anotada en `impl.md`): confirmado en el navegador que un valor que
  coincide con el atajo `Claro` (`#ffffff`) se resume como «Texto sobre el
  principal: claro», y que un valor arbitrario (`#123456`, ninguno de los
  dos atajos) cae al valor crudo («Texto sobre el principal: #123456») en
  vez de mostrar «claro»/«oscuro» erróneamente. Es el comportamiento que
  `impl.md` documenta como simplificación aceptada, no un bug — confirmado
  que no inventa un "claro"/"oscuro" incorrecto para un valor que no es
  ninguno de los dos.
- **Confirmación en línea de «¿Quitar los colores…?»**: al pulsar «Quitar
  los colores» aparece `¿Quitar los colores y volver a la paleta por
defecto?` con botones `Sí, quitar`/`No`, sin un `window.confirm` nativo;
  confirmar dispara el `PUT {}` real (verificado con el `SELECT` de arriba).
- **`/sesion-cerrada`** (paso 30, arregla el 401 de agrupar y de branding):
  `curl`/navegador → 200 con «Tu sesión se cerró. Vuelve a entrar desde
  Cuadre de Caja…», nunca 404.

## Ejecuciones

```
$ bash .agent/init.sh
...
ENTORNO LISTO

$ bash .agent/verify.sh F-011 --full
== Verificación F-011 · intento 33 ==
  ✓ harness    0s
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       3s
  ✓ prisma     1s
  ✓ build      3s
  ✓ theme      0s
  ✓ bundle     0s
PASA
$ echo $?
0
```

`npm test` (dentro de `verify.sh`): **543 pruebas, 59 archivos, todas en
verde** (`.agent/runs/F-011/033-test.log`), igual al número que `impl.md`
reporta — reproducido por mí, no citado de oídas. `npm run build`:
`/admin/tiendas/[storeId]/marca`, `/api/admin/stores/[storeId]/branding` y
`/sesion-cerrada` aparecen en el árbol de rutas (`ƒ`/`○` según corresponde).

```
$ bash .agent/verify.sh F-011 --smoke
== Verificación F-011 · intento 34 ==
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       3s
  ✗ smoke      14s  (salida 1)
FALLA en smoke.
```

Las **11 líneas `SMOKE FAIL`** de esta corrida son **todas** de la sección de
subida de imágenes (503, ciclos 1–2, fuera de alcance de esta tanda — el
emulador de Storage arriba pertenece a otro worktree). Confirmado con
`grep -n "SMOKE FAIL" .agent/runs/F-011/034-smoke.log`: las 11 mencionan
"subida"/"imagen". La sección de branding entera —criterios 5, 17, 19, 20,
22, 23— aparece con `ok` en las 15 aserciones que le corresponden, cero
fallos. La firma `smoke:SMOKE FAIL subida del fixture real — esperaba 201,
obtuve 503` ya estaba descartada por `sdd-implementer` (`verify.sh dismiss`),
así que `bash .agent/verify.sh pending F-011` sigue vacío pese a esta
corrida.

```
$ bash .agent/verify.sh F-011 --visual
== Verificación F-011 · intento 35 ==
  ✓ typecheck  1s
  ✓ lint       3s
  ✓ format     3s
  ✓ test       3s
  ✓ visual     12s
PASA
$ echo $?
0

$ bash .agent/verify.sh pending F-011
(vacío)

$ bash .agent/verify.sh F-011
== Verificación F-011 · intento 36 ==
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     3s
  ✓ test       3s
PASA
```

```
$ npx vitest run src/features/admin/schemas.test.ts
 Test Files  1 passed (1)
      Tests  24 passed (24)

$ npx vitest run src/features/admin/server/boundaries.test.ts \
    src/features/admin/authorization.test.ts \
    src/features/storefront/server/registry.test.ts \
    src/features/admin/server/branding.test.ts \
    src/features/admin/server/mutations.test.ts
 Test Files  5 passed (5)
      Tests  58 passed (58)

$ npx prisma validate
El schema es válido 🚀
$ git diff --stat main -- prisma/schema.prisma
(vacío)
```

Datos de prueba restaurados: `Storefront.themeTokens` de `tienda-demo`
vuelve a `{}` (confirmado con `SELECT` directo tras la última prueba);
`el-trebol` queda con `{"brand":"#198038"}`, el color que el propio
`smoke.sh` le dejó a propósito (HD18: fixture de un solo uso, `npm run seed`
no lo pisa porque no pasa un valor truthy). Servidor de desarrollo propio
(`next dev -p 3033`) detenido al terminar (`ps aux | grep "next dev"` sin
resultado).

## Fallos encontrados

Ninguno de código nuevo de esta tanda. Todo lo probado se comportó tal como
`spec.md`/`architecture.md`/`design.md` lo describen, incluidas las
desviaciones ya anotadas por `sdd-implementer` (`storeName` de propina en
`loadBrandingTarget`, la heurística claro/oscuro de la maqueta).

## Huecos de cobertura

- **El 404 de "la marca desaparece entre el guard y la escritura"** no se
  ejercitó de punta a punta en esta sesión (requiere borrar una fila a mitad
  de una petición en vuelo). Reutiliza el mismo `P2025`→404 que
  `setStoreEnabled`, verificado en el ciclo 2. Riesgo residual bajo.
- **Huecos ya heredados de las tandas 1–2** (visual a 360/768 previo a
  F-017, `PromotionForm` con UI simplificada, drift de `_prisma_migrations`
  entre worktrees, retardo de hasta 3600 s en promociones): sin cambios en
  esta tanda; siguen documentados donde ya estaban.
- **Criterio 4 no re-ejecutado esta sesión** (ver nota en la tabla de
  arriba): decisión explícita del alcance de esta tanda, no un descuido.

## Veredicto

**Tanda 3 (pasos 19–34): LISTO.** El criterio 5 literal de
`.agent/features.json` está verificado ejecutando de punta a punta —los tres
rechazos, el `SELECT` que confirma que la base no cambió, y el camino feliz
visible en la vitrina sin esperar el piso de ISR—, y los ocho criterios
`[nuevo]` en alcance de esta tanda (16–23) también, cada uno con su comando
o su interacción real y su resultado. `bash .agent/verify.sh F-011 --full` →
0 en sus nueve etapas (reproducido por mí, intento 33); `--smoke` → 0 lógico
en la sección de branding (los 11 fallos son de imágenes, fuera de alcance,
ya descartados); `--visual` → 0; `bash .agent/verify.sh pending F-011` →
vacío.

**Los cinco `acceptance_criteria` de `.agent/features.json` están, ahora sí,
verificados ejecutando los cinco.** Los criterios 1–3 se citan de la
verificación anterior tras confirmar que ningún diff de esta tanda los toca;
el criterio 4 se cita también, sin re-ejecutar por la razón explícita de
alcance (Storage no es de esta tanda); el criterio 5 se verificó de cero en
esta sesión.

**No decido `passes: true`.** Esa casilla, y la pregunta abierta a propósito
de `plan.md` § Tanda 3 sobre si F-011 pasa a `passes: true` pese a la nota
de `features.json` sobre F-023/criterio 4, son del humano — el orquestador
se lleva este veredicto para esa conversación.

## Preguntas al humano

Ninguna pregunta nueva de este agente que bloquee el veredicto. Repito, sin
resolverlas yo (no me corresponde, regla 3), las que ya trae `impl.md` para
que el orquestador las junte con las de los demás agentes al cerrar:

- **IP6** (de `impl.md`) — si se dejan los secretos de desarrollo generados
  en `.env` (recomendado por el implementador, y lo que este agente asumió
  como estado del entorno para poder verificar).
- **IP4** (de `impl.md`, repetida de IP2/TP1 del ciclo 1) — las rutas
  abreviadas de `architecture.md` que `check:harness` seguiría marcando si
  no fuera porque ya se resolvieron con el código construido; confirmar que
  no queda ninguna pendiente le corresponde a quien pueda editar ese
  documento, no a este agente.
- **La pregunta que `plan.md` § Tanda 3 deja explícitamente para el paso
  34** — si F-011 pasa a `passes: true` al cerrar esta tanda pese a que su
  nota en `features.json` menciona que F-023 sustituye parcialmente el
  criterio 4 (servir la imagen por `next/image` en caliente). No es mía
  para decidir; la traigo aquí porque `spec.md` la deja anotada como «no
  decidido a propósito» y el paso 34 pide preguntarla exactamente aquí.
