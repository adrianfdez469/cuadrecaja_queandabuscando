---
feature: F-040
agente: sdd-implementer
actualizado: 2026-09-10T19:10:00Z
estado: listo
---

## Qué se construyó

Los pasos 1 a 6 del plan firmado. Nada de la base de datos se toca (criterio
4): el código de motivo viaja solo en props de React, en tiempo de render.

| Archivo                                        | Qué hace                                                                                                                                                                                                                                           | Criterio que cubre                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `src/lib/pricing.ts`                           | `tryResolvePrice`: LA definición de "este producto no tiene precio" (AD6), reutilizada por los cuatro llamadores                                                                                                                                   | 1, 6, 7 (base)                    |
| `src/components/store/ProductCard.tsx`         | `safeResolve` desaparece; usa `tryResolvePrice`                                                                                                                                                                                                    | 2 (sin cambios de comportamiento) |
| `src/features/catalog/catalogFilters.ts`       | `resolveProductPrice` pasa a ser `tryResolvePrice(...)?.price ?? null`                                                                                                                                                                             | 2 (sin cambios de comportamiento) |
| `src/app/[slug]/p/[productSlug]/page.tsx`      | El `try/catch` en línea desaparece, usa `tryResolvePrice`                                                                                                                                                                                          | 7 (base)                          |
| `src/features/catalog/unpricedCatalog.ts`      | `isCatalogUnpriced` (R1-R3, corte en el primer producto que resuelve) y `UNPRICED_CATALOG_CLOSURE` (R8)                                                                                                                                            | 1, 2, 3                           |
| `src/features/catalog/unpricedCatalog.test.ts` | Prueba unitaria sin base de datos: vacía→false, alguno con precio→false, ninguno→true, E16 (ancla CUP), E17 (disponibilidad no entra), E18 (promoción que lanza cuenta como sin precio)                                                            | 1, 2, 3 (unitario)                |
| `src/constants/storeClosure.ts`                | `PRICES_UNAVAILABLE_REASON_CODE = "PRICES_UNAVAILABLE"`, fuera de `STORE_DISABLED_REASONS`                                                                                                                                                         | 1, 4                              |
| `src/lib/storeClosure.ts`                      | Rama nueva en `resolveStoreClosureHeadline` (antes del respaldo por `disabledAt`, AD8); `resolveStoreClosureClosingLine` (nueva función); `buildStoreClosureWhatsappUrl` gana el parámetro `disabledReasonCode` y elige el mensaje prescrito (DP3) | 1, 7                              |
| `src/lib/storeClosure.test.ts`                 | Casos nuevos: la frase nueva, E19 (`isStoreDisabledReasonCode` y `storeStatusBodySchema` rechazan el código), la línea de cierre nueva, el mensaje de WhatsApp nuevo y que el de una tienda cerrada de verdad no cambia                            | 4, 7                              |
| `src/components/store/StoreClosedNotice.tsx`   | Usa `resolveStoreClosureClosingLine` en vez del literal fijo; pasa `disabledReasonCode` a `buildStoreClosureWhatsappUrl`                                                                                                                           | 1, 7                              |
| `src/features/catalog/server/queries.ts`       | `getStoreCatalogPricing` (AD5): envoltorio fino sobre `getStoreCatalog` + `getStoreRates` + `isCatalogUnpriced`, cero Prisma propio, cero entradas de caché nuevas, cero tags nuevos                                                               | 6                                 |
| `src/app/[slug]/page.tsx`                      | Sustituye `getStoreCatalog`+`getStoreRates` por `getStoreCatalogPricing`; guarda nueva después de la rama `status !== "PUBLISHED"` (AD7); `BranchBar isOpen={false}`                                                                               | 1, 6, 7                           |
| `src/app/[slug]/p/[productSlug]/page.tsx`      | Ídem; sin nombrar el producto, `catalogTrail` en vez de `productTrail` (E5, E7 del criterio 7)                                                                                                                                                     | 1, 6, 7                           |
| `src/app/[slug]/catalogo/page.tsx`             | Ídem, con `extraNote` propia; guarda antes del mensaje de catálogo vacío                                                                                                                                                                           | 1, 6, 7                           |
| `src/app/[slug]/c/[categorySlug]/page.tsx`     | `getStoreCatalogPricing` como TERCER lector de la misma entrada cacheada (patrón que la página ya ejecutaba con `getStoreCategoryView`/`getStoreCategories`); guarda antes de `!view` (E6)                                                         | 1, 6, 7                           |
| `src/app/[slug]/buscar/page.tsx`               | Estrena `getStoreCatalogPricing`; guarda antes de `await searchParams` (AD10, R11); `/buscar` sin `q` también enseña el aviso                                                                                                                      | 1                                 |
| `src/app/[slug]/carrito/page.tsx`              | Estrena `getStoreCatalogPricing`; guarda después de la rama de cierre; sin `BranchBar`                                                                                                                                                             | 1                                 |
| `src/app/[slug]/checkout/page.tsx`             | Estrena `getStoreCatalogPricing`, en paralelo con `loadStoreForOrder` (AD9); guarda antes de la cobertura de zonas; sin `BranchBar`                                                                                                                | 1                                 |

La misma cadena —«Esta tienda no puede mostrar sus precios ahora mismo, así
que no está tomando pedidos.»— sale de una única rama de
`resolveStoreClosureHeadline` y se monta en las siete vistas a través de
`UNPRICED_CATALOG_CLOSURE`, así que no hay siete copias que puedan divergir.

## Desviaciones

**Corrección post-cierre (verificación visual del probador, ciclo
posterior).** `src/app/[slug]/c/[categorySlug]/page.tsx`: `generateMetadata`
llamaba a `notFound()` cuando `getStoreCategoryView` devolvía `null`, sin
comprobar antes `pricing.unpriced` — a diferencia del cuerpo de la página,
que sí tiene esa guarda (AD7) antes de su propio `if (!view) notFound()`.
Efecto: el HTML de la respuesta inicial era el correcto (el aviso de tienda
muda), pero el RSC payload también streameaba el segmento de
`generateMetadata`'s `notFound()`, y el cliente lo usaba para reemplazar el
DOM al hidratar (~300-500 ms después), sustituyendo el aviso por el
`not-found.tsx` del segmento delante del comprador. Reproducido en
`next dev` y en `next build && next start`; `curl`/`smoke.sh` no lo veían
porque solo miran la respuesta HTTP cruda. Rompía E6 y el criterio 1.
Diagnóstico y arreglo prescritos por el probador en la ficha
`.agent/playbook/generatemetadata-notfound-independiente-del-guardado-muda.md`.

Arreglo: `generateMetadata` replica ahora la MISMA guarda, en el MISMO
orden, que el cuerpo — tras `store.status !== "PUBLISHED"`, lee
`getStoreCatalogPricing(resolution, store.baseCurrencyCode)` (memoizada por
`cache()` de React, así que no añade una consulta: la comparte con la que el
cuerpo ya hace en la misma petición) y, si `pricing.unpriced`, devuelve la
misma metadata genérica que la rama de tienda cerrada (`${store.name} · No
disponible ahora`, `robots: { index: false }`, sin nombrar la categoría)
ANTES de llamar a `getStoreCategoryView`/`notFound()`.

Revisé la MISMA clase de fallo en las otras seis vistas —cualquier
`generateMetadata` que decida un `notFound()` propio, no solo el caso que el
probador reprodujo (`/c/no-existe`)—, empezando por
`src/app/[slug]/p/[productSlug]/page.tsx`, que también resuelve algo por
slug:

- `src/app/[slug]/page.tsx`: su `generateMetadata` no llama a `notFound()`
  en ningún caso. Sin riesgo.
- `src/app/[slug]/p/[productSlug]/page.tsx`: su `generateMetadata` YA usa la
  opción barata que la propia ficha cita como alternativa válida — cuando el
  producto no existe, devuelve `{ title: "Producto no encontrado" }` en vez
  de llamar a `notFound()`. Sin `notFound()` propio, no hay nada que
  reemplazar al hidratar. Sin riesgo, sin cambios.
- `src/app/[slug]/catalogo/page.tsx` y `src/app/[slug]/buscar/page.tsx`: sus
  `generateMetadata` solo llaman a `notFound()` para
  `resolution.kind === "selector"` —la MISMA guarda, en el MISMO orden, que
  el cuerpo usa para ese mismo caso, antes de `requireStore`—, nunca por una
  condición que dependa del catálogo o de la moneda. Sin riesgo.
- `src/app/[slug]/carrito/page.tsx` y `src/app/[slug]/checkout/page.tsx`:
  usan `export const metadata` estático, no una función `generateMetadata`;
  no hay ningún `notFound()` que pueda decidirse por su cuenta. Sin riesgo.

Solo `c/[categorySlug]/page.tsx` tenía el agujero: es la única vista cuyo
`generateMetadata` resuelve una entidad (la categoría) que el cuerpo también
resuelve bajo una guarda que `generateMetadata` no replicaba.

Respecto al resto del plan firmado (pasos 1-6): ninguna desviación. Los ocho
contratos que `architecture.md` prescribe literalmente (`isCatalogUnpriced`,
`UNPRICED_CATALOG_CLOSURE`, `getStoreCatalogPricing`) se implementaron tal
cual el documento los escribe, incluido el cuerpo que AD1 da por sentado.

Una nota, no una desviación: la línea de cierre nueva
(`resolveStoreClosureClosingLine`) y el mensaje de WhatsApp nuevo
(`disabledReasonCode` en `buildStoreClosureWhatsappUrl`) no tienen un AD
propio en `architecture.md` —el documento no llega a decidir DÓNDE viven,
solo QUÉ dicen (`design.md` § Textos)—. Elegí la misma forma que AD8 usa para
la frase: una rama condicional sobre `PRICES_UNAVAILABLE_REASON_CODE`, junto
a la función que ya existía, sin tocar su firma pública salvo añadir un
parámetro opcional a `buildStoreClosureWhatsappUrl`. Es la lectura más
conservadora de "más el mensaje de WhatsApp propios" del paso 3 del plan.

Durante el paso 3 añadí también un caso de prueba de E19 (el panel rechaza el
código) a `src/lib/storeClosure.test.ts`, un archivo que ya existía y no
está en la lista de "por crear" del plan — el propio paso 3 lo cita como
lugar de verificación ("`npm test` sobre `src/lib/storeClosure.test.ts`, más
un caso que afirme que el panel lo rechaza (E19)"), así que lo tomé como
parte de mi propio trabajo de verificación del paso, no como una prueba de
integración que le tocara al probador (que son las de `src/features/catalog/`
y `src/features/orders/` del paso 7).

## Comandos ejecutados

- `bash .agent/verify.sh F-040` → `PASA` — typecheck · lint · format · test

  10 intentos durante el ciclo, el último en código de salida `0`.

- `bash .agent/verify.sh F-040 --full` → `PASA` — harness · typecheck · lint · format · test · prisma · build · theme · bundle

  `bundle` no se movió: cero JavaScript de cliente nuevo, tal como exige
  AGENTS.md § Prohibiciones.

- `bash .agent/verify.sh pending F-040` — vacío, sin fallos abiertos.
- Un fallo de `typecheck` (TS2304, `getStoreRates` sin importar en
  `src/app/[slug]/catalogo/page.tsx` tras cablear `getStoreCatalogPricing`)
  fue mío, no una trampa del repo: lo corregí y lo descarté con
  `bash .agent/verify.sh dismiss F-040 'typecheck:error TS2304' '...'` en vez
  de escribir una ficha que no le serviría a nadie más.

**Tras la corrección del `generateMetadata` de `c/[categorySlug]/page.tsx`
(§ Desviaciones):**

- `bash .agent/verify.sh F-040 --full` → `PASA` — harness · typecheck · lint · format · test · prisma · build · theme · bundle

  Repetido tras el arreglo, código de salida `0`.

- `bash .agent/verify.sh F-040 --visual` → `PASA` — typecheck · lint · format · test · visual

  Es la etapa que el probador usó para destapar el fallo; la que lo tiene
  que dar por bueno. `0` tras el arreglo.

- `bash .agent/verify.sh pending F-040` — vacío otra vez al terminar.

## Deuda dejada

Ninguna. Los seis pasos están completos y verificados. `plan.md` § Coste ya
anota que los pasos 2 y 3 solo añaden archivos y constantes, y los 4-6 son
sustituciones acotadas: no queda ningún `TODO` en el código.

## Qué necesita quien pruebe

- **Los pasos 7 y 8 siguen abiertos**: las pruebas de los criterios 4, 5 y 6
  (`src/features/catalog/` y `src/features/orders/`, por crear) y el cierre
  del criterio 8.
- **El fixture de la tienda muda no existe todavía.** `plan.md` § «No
  decidido a propósito» lo deja para el plan con el probador: un negocio con
  `baseCurrencyCode` sin `ExchangeRate` vigente y productos en otra moneda
  (E1), más la variante de E16 (base `CUP`, productos en `EUR` sin tasa). No
  toqué `prisma/seed.ts` ni sembré nada a mano — sembrarlo es del paso 7.
- **`getStoreCatalogPricing(branch, baseCurrencyCode)` es la puerta única**
  para las siete vistas: `pricing.catalog`, `pricing.rates` y
  `pricing.unpriced`. Cualquier prueba de integración que necesite forzar el
  estado mudo solo tiene que hacer que ningún producto resuelva precio en el
  catálogo completo de la sucursal — no en el recorte que pinte una vista
  concreta (R2).
- **El criterio 5 no necesita código nuevo** (I3 de `spec.md`): `quote.ts` y
  `createOrder.ts` ya cortan antes de la cuota de domicilio y de
  `buildRateSnapshot`. Es una demostración ejecutando, no una implementación.
- **El criterio 6 se cuenta en las cuatro vistas de catálogo** (`/[slug]`,
  `/[slug]/p/[productSlug]`, `/[slug]/catalogo`, `/[slug]/c/[categorySlug]`):
  el procedimiento de conteo de consultas de Prisma está en
  `.agent/specs/F-025/tests.md`. En las otras tres (`/buscar`, `/carrito`,
  `/checkout`) el coste es una lectura de la caché de datos, documentada en
  R9, no medida.
- **Frágil, para tenerlo presente**: `src/features/account/server/
orderIdentity.test.ts` › «timeout» puede fallar por un milisegundo bajo
  carga — no es de este feature (AGENTS.md § Cosas que muerden, ficha
  `.agent/playbook/settimeout-fira-antes-que-performance-now.md`). No lo vi
  fallar en ninguna de las diez corridas de este ciclo.

## Preguntas al humano

Ninguna. El plan firmado no dejó ninguna decisión de producto pendiente para
los pasos 1-6.
