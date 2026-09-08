---
feature: F-039
agente: sdd-implementer
actualizado: 2026-09-08T13:49:17Z
estado: borrador
---

> Ciclo 1: solo los pasos **1, 2 y 3** del plan firmado
> (`.agent/specs/F-039/plan.md`). Los pasos 4-10 no se tocan: nada en
> `src/features/currency/`, `src/app/`, `src/components/store/`, el
> carrito, el checkout, la cotización, los handlers del sync ni la ADR 0031.
>
> Ciclo 2 (este): **pasos 4 y 5**, y solo esos. Los pasos 6-10 siguen sin
> tocarse: nada en `src/features/orders/`, el carrito, el checkout, los
> handlers del sync, la ADR 0031 ni el guion de humo.

## Qué se construyó

| Archivo                                    | Qué hace                                                                                                                                                                                                                                                                                                                                   | Criterio que cubre              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `src/constants/currency.ts` (nuevo)        | AD2/AD6/AD9: `CURRENCY_CODE_PATTERN`, `REFERENCE_CURRENCY_STORAGE_KEY`, `REFERENCE_CURRENCY_NONE`, los cuatro nombres de atributo (`REFERENCE_CURRENCY_ATTR`, `EQUIVALENT_CURRENCY_ATTR`, `REFERENCE_CURRENCY_CHOICES_ATTR`, `REFERENCE_CURRENCY_DEFAULT_ATTR`) y `CURRENCY_FORMATTER_CACHE_MAX`                                           | Paso 1 (constantes compartidas) |
| `src/lib/priceEquivalents.ts` (nuevo)      | AD1: las tres exportaciones puras — `equivalentCurrencies`, `priceEquivalents`, `selectableCurrencies` —, solo importando de `./money`                                                                                                                                                                                                     | Paso 1; C4, C5, C7              |
| `src/lib/priceEquivalents.test.ts` (nuevo) | Los casos de R2/R5/R7/R9/R10/R23: moneda sin tasa (no se pinta y no se ofrece), tasa cero y negativa como ausentes, base ausente/repetida, lista vacía, código basura, base sin tasa propia ⇒ selector vacío, primer ofrecido = SP1(a), y el ancla no se salta (base MLC, producto USD, equivalente EUR, no coincide con el atajo directo) | Paso 1; C4, C5, C7              |
| `src/features/sync/displayCurrencies.ts`   | `findInvalidDisplayCurrency` importa `CURRENCY_CODE_PATTERN` de `@/constants/currency` en vez de declarar su propio `/^[A-Z]{3}$/` (`DISPLAY_CURRENCY_CODE` retirado; sin llamantes externos, verificado con `grep` antes de tocarlo)                                                                                                      | Paso 1 (AD2)                    |
| `src/lib/money.ts`                         | AD6: memo `FORMATTERS` (`Map<string, Intl.NumberFormat \| null>`) y `formatterFor(locale, currency, min, max)`, tope `CURRENCY_FORMATTER_CACHE_MAX`; `formatWithIntl` pasa a usarlo para la rama primaria y para la de respaldo (memoizada también, bajo `currency=""`)                                                                    | Paso 2; R21                     |
| `src/lib/money.test.ts`                    | Dos pruebas nuevas: 100 llamadas con la misma (locale, moneda, dígitos) construyen **una** sola vez `Intl.NumberFormat` y la salida no cambia ni un carácter; la rama de respaldo también memoiza (2 construcciones en 100 llamadas, no 200)                                                                                               | Paso 2; R21                     |
| `src/features/catalog/server/queries.ts`   | `select` de la línea 139 gana `displayCurrencies: true`; `StoreSummary` gana `displayCurrencies: readonly string[]`; `loadStore` lo devuelve; `getStoreBySlug` normaliza con el tipo `CachedStore` (AD10) — `displayCurrencies?: readonly string[]` y `?? []` en el borde de lectura, no un `if` defensivo en medio del código             | Paso 3; R22                     |

## Desviaciones

Ninguna respecto del plan firmado. Dos decisiones de forma que el plan dejó
al implementador y que documento aquí para que quien siga no las tenga que
redescubrir:

1. **Los cuatro nombres de atributo y `CURRENCY_FORMATTER_CACHE_MAX` se
   crearon ya en el paso 1**, aunque la fila del paso 1 del plan solo cita
   "el patrón del código de moneda, la clave de `localStorage`, el
   centinela y los nombres de los cuatro atributos" y no menciona el tope
   del memo. Lo hice porque AD9 es explícito: los seis literales
   («ninguno de los seis puede quedar como literal suelto en dos archivos»)
   viven en `src/constants/currency.ts`, y el paso 2 (el memo de
   formateadores) necesita `CURRENCY_FORMATTER_CACHE_MAX` ya declarado ahí
   — su fila del plan solo lista `src/lib/money.ts` y
   `src/lib/money.test.ts` como archivos, lo que solo tiene sentido si la
   constante ya existe. No es alcance añadido: es la misma constante que
   AD6 asigna a este archivo, creada en el momento correcto para que el
   paso 2 la importe sin tocar `src/constants/currency.ts` una segunda vez.
2. **`DISPLAY_CURRENCY_CODE` se retiró en vez de mantenerse como
   reexportación.** El plan dice "lo importa de ahí en vez de declararlo";
   comprobé con `grep -rn "DISPLAY_CURRENCY_CODE" src scripts` que no
   quedaba ningún llamante fuera de su propio módulo (ya lo había
   verificado la arquitectura, y lo repetí antes de borrar), así que no
   hay una reexportación que mantener por compatibilidad.

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-039` → `0` (aprobado, comprobado antes de
  escribir una línea).
- `bash .agent/verify.sh F-039` → **`0`** en el estado final del árbol
  (typecheck · lint · format · test, las cuatro etapas en verde). Costó
  varios intentos intermedios (21 de la fase de planificación + 7 de este
  ciclo, hasta el intento 28) por dos fallos reales de este ciclo, ninguno
  atribuible a la otra sesión de F-041:
  - `TypeError: primary.format is not a function` / «el mock no usa
    'function' o 'class'» — `vi.spyOn(Intl, "NumberFormat")` no llama a
    través del original cuando el código bajo prueba usa `new`, y el
    `mockImplementation` tiene que ser una `function`, no una arrow
    function, para ser invocable con `new`. Ficha nueva:
    `.agent/playbook/vi-spyon-constructor-necesita-function-keyword.md`.
  - `expected "NumberFormat" to be called 2 times, but got 1 times` — un
    código de moneda inventado pero bien formado (`"ZZZ"`) NO lanza en
    `Intl.NumberFormat`, así que no ejercita la rama de respaldo; hacía
    falta un código que fallara la comprobación de forma (`"ZZ"`). Ficha
    nueva:
    `.agent/playbook/intl-numberformat-acepta-cualquier-codigo-de-tres-letras.md`.
  - No hubo ningún fallo del sensor atribuible a `.agent/specs/propuestas/zonas-de-envio.md`
    ni a otro archivo de F-041 en este ciclo.
- `npm run format` sobre los archivos propios (`src/lib/money.ts`,
  `src/lib/priceEquivalents.ts`, `src/lib/priceEquivalents.test.ts`,
  `src/constants/currency.ts`, `src/features/sync/displayCurrencies.ts`,
  `src/features/catalog/server/queries.ts`, más las dos fichas de
  playbook nuevas) — sin tocar prosa ajena.
- `bash .agent/verify.sh F-039 --full` **no se ejecutó** en este ciclo: los
  tres pasos firmados no lo exigen (su "Cómo se verifica" pide
  `bash .agent/verify.sh F-039` en `0`, no `--full`), y `--full` añade
  build/prisma/theme/bundle, que son del cierre del feature (paso 9/10).

## Deuda dejada

Nada propio de los pasos 1-3. Anotado para quien siga con los pasos 4+, sin
tocarlo yo (el alcance lo cambia el humano, no el implementador que lo
descubre):

- El paso 4 (el guion de arranque, el selector, el mecanismo de CSS) va a
  necesitar que `src/app/[slug]/layout.tsx` lea las tasas
  (`getStoreRates`) para poder llamar a `selectableCurrencies` — ya está
  escrito en `architecture.md` § Escalabilidad, no es un descubrimiento
  mío, solo lo repito para que no se pierda entre pasos.
- Ningún `TODO` en el código. Los tres archivos nuevos
  (`src/constants/currency.ts`, `src/lib/priceEquivalents.ts`,
  `src/lib/priceEquivalents.test.ts`) son aditivos y sin llamantes
  todavía (nadie más los importa hasta el paso 4), tal como el plan
  anticipa en § Riesgos y plan B, fila "Marcha atrás a mitad".

## Qué necesita quien pruebe

- Los tres archivos nuevos son puros: `npm test` los cubre sin Postgres ni
  emuladores. No hace falta levantar nada para verificar los pasos 1 y 2.
- El paso 3 (`queries.ts`) sí toca una consulta real, pero es la misma
  consulta de siempre con una columna más: **cero** round-trips nuevos.
  Cualquier prueba de humo existente contra `getStoreBySlug`/`loadStore`
  sigue pasando porque `displayCurrencies` en la base ya existe desde
  F-038 (`Business.displayCurrencies`, `String[] @default([])`); un
  negocio sembrado sin `BUSINESS` previo simplemente trae `[]`.
- El caso de AD10 (entrada de caché con la forma vieja, sin
  `displayCurrencies`) no se puede reproducir con datos frescos: solo se
  ve con una entrada de `unstable_cache` escrita ANTES de este cambio.
  Nada que hacer al respecto en este ciclo — es exactamente el riesgo que
  el tipo `CachedStore` mitiga sin necesitar reproducirlo para probarlo
  (el compilador no puede avisar de esto, así que no hay un test posible
  que lo ejercite honestamente sin fabricar una entrada de caché a mano).

## Preguntas al humano

Ninguna. Los tres pasos estaban completamente especificados por el plan
firmado y por AD1/AD2/AD5/AD6/AD9/AD10 de `architecture.md`; no hubo
ninguna decisión de alcance que tomar.

---

# Ciclo 2 — pasos 4 y 5 (2026-09-08)

> El árbol se recibió con los pasos 1-3 verificados
> (`bash .agent/verify.sh F-039` en 0 antes de escribir una línea,
> comprobado). La otra sesión de F-041 se había apartado por pedido del
> humano — el sensor de este ciclo es enteramente atribuible a este
> trabajo.

## Qué se construyó

| Archivo                                                                                                                                                                                                               | Qué hace                                                                                                                                                                                                                                                                                                                                                                      | Criterio que cubre      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `src/features/currency/reveal.ts` (nuevo)                                                                                                                                                                             | AD4: `renderReferenceCurrencyCss(codes)` (N+1 reglas `:not()`, cadena vacía con `[]`) y `REFERENCE_CURRENCY_BOOT_SCRIPT`, constante literal de las cinco ramas                                                                                                                                                                                                                | Paso 4; C2, C9          |
| `src/features/currency/reveal.test.ts` (nuevo)                                                                                                                                                                        | El texto exacto de las reglas, la cadena vacía, que el guion es una constante sin `${` y sus bytes medidos                                                                                                                                                                                                                                                                    | Paso 4; C2, C9          |
| `src/features/currency/referenceCurrencyStore.ts` (nuevo)                                                                                                                                                             | AD9: `useReferenceCurrencyPreference(offeredCurrencies)` sobre `useSyncExternalStore` + `localStorage` + evento `storage`; `getServerSnapshot` = `REFERENCE_CURRENCY_NOT_HYDRATED`; `resolveReferenceCurrency()` (mismas cinco ramas del guion, en TypeScript); único escritor de `data-ref-currency` tras el arranque, en un `useEffect` que muta el DOM, no estado de React | Paso 4; C3(b), E17, DH5 |
| `src/features/currency/referenceCurrencyStore.test.tsx` (nuevo)                                                                                                                                                       | Las cinco ramas del guion **ejecutado de verdad** en una `JSDOM` propia (`runScripts: "dangerously"`, `beforeParse` inyectando `localStorage`); la clave y su valor; garbage tolerado y no borrado; `localStorage` bloqueado cae a memoria; una preferencia no ofrecida sobrevive; `getServerSnapshot` vía `renderToString`; reacciona a `storage`                            | Paso 4; C3(b), E17, DH5 |
| `src/features/currency/components/ReferenceCurrencySelect.tsx` (nuevo)                                                                                                                                                | La única isla `"use client"` del feature: `<select>` nativo 160×44, hueco fijo antes de hidratar, opciones "Solo `<base>`" + "También en `<code>`" por moneda ofrecida, región `aria-live="polite"` `sr-only` para D7                                                                                                                                                         | Paso 4; C12, DH5        |
| `src/features/currency/components/ReferenceCurrencySelect.test.tsx` (nuevo)                                                                                                                                           | Nada en el HTML servido (R13); las opciones son exactamente el conjunto ofrecido + "solo la base"; una moneda sin tasa nunca aparece; el valor inicial es SP1(a); el anuncio D7 en los dos sentidos; el anuncio vacío en el montaje                                                                                                                                           | Paso 4; C12, DH5        |
| `src/app/[slug]/layout.tsx`                                                                                                                                                                                           | Lee `getStoreRates` y calcula `selectableCurrencies` (solo si la tienda no está cerrada); el guion como primer hijo del `div` de la tienda, el `<style>` del tema y el `<style>` generado, `data-ref-choices`/`data-ref-default` en el mismo `div`, la sub-barra (aviso D3 + `ReferenceCurrencySelect`) — los cuatro **solo** con `selectableCurrencies` no vacío             | Paso 4; C3, C9          |
| `src/app/layout.tsx`                                                                                                                                                                                                  | `suppressHydrationWarning` en el `<html>` (AD4, decidido AP1(a))                                                                                                                                                                                                                                                                                                              | Paso 4                  |
| `src/components/store/ProductCard.tsx`                                                                                                                                                                                | Nuevo prop `displayCurrencies`; pinta los equivalentes con `data-equiv`, `≈` `aria-hidden` + `sr-only`"aproximadamente "+ importe, agrupados con `gap-x-2`/`gap-y-1` dentro del mismo párrafo del precio; con `[]` el HTML es idéntico al de hoy (ni siquiera un `<span>` de más). Sigue siendo componente de servidor                                                        | Paso 5; C1, C2, C9, C15 |
| `src/components/store/ProductCard.test.tsx` (nuevo)                                                                                                                                                                   | La primera prueba de este componente: principal + equivalente marcado, el aproximado nunca es el principal, N equivalentes sin nada estático que oculte, "Consultar" con cero equivalentes, una moneda sin tasa se omite, y con el `<style>` del mecanismo puesto el nombre accesible **no** anuncia la moneda oculta (verificado con `getByRole({name})`, no `textContent`)  | Paso 5; C1, C2, C9, C15 |
| `src/app/[slug]/p/[productSlug]/page.tsx`                                                                                                                                                                             | Mismo tratamiento para el importe grande, un tamaño arriba (`text-sm`, 14 px)                                                                                                                                                                                                                                                                                                 | Paso 5; C1, C2, C9      |
| `src/components/store/StoreCatalogResults.tsx`, `StoreSearchResults.tsx`, `src/app/[slug]/page.tsx`, `src/app/[slug]/c/[categorySlug]/page.tsx`, `src/app/[slug]/catalogo/page.tsx`, `src/app/[slug]/buscar/page.tsx` | Enhebrado mecánico de `displayCurrencies={store.displayCurrencies}` hasta `ProductCard`, paralelo al `displayCurrency`/`rates` que ya se enhebraban — ver § Desviaciones                                                                                                                                                                                                      | Paso 5                  |

## Desviaciones

1. **`displayCurrencies` se enhebró por seis archivos que el paso 5 del
   plan no cita** (`src/components/store/StoreCatalogResults.tsx`,
   `StoreSearchResults.tsx`, `src/app/[slug]/page.tsx`,
   `src/app/[slug]/c/[categorySlug]/page.tsx`,
   `src/app/[slug]/catalogo/page.tsx`,
   `src/app/[slug]/buscar/page.tsx`). El paso 5 solo lista `ProductCard.tsx`, su prueba y
   `p/[productSlug]/page.tsx`, y design.md § 1 dice literalmente que "las
   cuatro páginas que pintan `ProductCard` lo ganan a la vez sin retoques
   propios". Eso es cierto para el DISEÑO (ninguna decide nada nuevo) pero
   no para el TIPO: `ProductCard` gana un prop **obligatorio** más
   (`displayCurrencies`, paralelo a `displayCurrency`/`rates`, que ya
   viajan por exactamente esos mismos seis archivos), y sin enhebrarlo el
   árbol no compila. No es alcance añadido — es la misma plomería
   mecánica que ya existía para `rates`, repetida una vez más porque
   `ProductCard` ahora necesita ese dato también; ninguno de los seis
   archivos tomó una decisión propia (todos solo pasan el mismo
   `store.displayCurrencies` que el paso 3 ya dejó listo en
   `StoreSummary`).
2. **`resolveReferenceCurrency()` es una función nueva no nombrada en
   AD9/AD4.** El guion de arranque toma su decisión en el navegador antes
   de que React exista; `ReferenceCurrencySelect` necesita la MISMA
   decisión en render (qué `<option>` viene seleccionada) sin poder
   ejecutar el guion. `resolveReferenceCurrency` es ese espejo en
   TypeScript, con la firma más simple que reproduce las mismas cinco
   ramas (recibe ya `getSnapshot()`, no el `localStorage` crudo). Vive en
   `referenceCurrencyStore.ts` porque es sobre la interpretación de la
   preferencia guardada, no sobre el CSS ni el `<select>`.
3. **`ReferenceCurrencySelect` no tiene una prop `equivalents`/`quote`**:
   solo pinta el `<select>` y el anuncio; no calcula ni pinta ningún
   importe. Es literal a AD4 ("nada de esto renderiza catálogo") y a
   design.md § Coste de cliente.
4. **`suppressHydrationWarning` NO se puso en el `<script>` del guion.**
   Solo hacía falta en el `<html>` (AD4 lo dice explícitamente): el
   `<script>` lo emite un componente de **servidor** (`StoreLayout`), así
   que React nunca lo re-renderiza del lado del cliente para comparar —
   no hay hidratación que silenciar ahí.

## Medición de bytes: dos cifras que no coinciden con `architecture.md`

Se reportan aquí, con el método de medición, en vez de tocar ese documento
(que no es mío).

- **El guion de arranque mide 373 bytes (UTF-8), no 377.** AD4 dice "El
  texto exacto, medido en 377 bytes" e imprime una versión con
  formato "bonito" (multilínea, indentada) inmediatamente debajo — esa
  versión pretty-printed pesa **467 bytes**, medida con
  `Buffer.byteLength`. Ninguna de las dos coincide con 377. La constante
  que escribí (`REFERENCE_CURRENCY_BOOT_SCRIPT`, una sola línea,
  minificada, semánticamente idéntica a las cinco ramas de la tabla de
  AD4 y verificada ejecutándola en jsdom para las cinco) mide **373**.
  La diferencia con 377 (4 bytes) probablemente sea una micro-variante de
  minificación (p. ej. `var v;` sin inicializar en vez de `var v = null;`,
  que ahorra 6 caracteres) que no afecta ninguna de las cinco ramas — lo
  comprobé ejecutando las dos formas. No ajusté la prosa de
  `architecture.md`: la cifra real es 373, y queda dicha aquí con el
  método de medición (`Buffer.byteLength(script, "utf8")`, en
  `reveal.test.ts`).
- **Cada regla `:not()` mide exactamente 76 bytes**, coincidiendo con lo
  que AD4 afirma ("76 bytes por regla, medidos") — esta cifra **sí**
  cuadra, con el formato minificado
  `[data-ref-currency="USD"] [data-equiv]:not([data-equiv="USD"]){display:none}`
  (sin espacio antes de `{`, sin `;` final). Lo dejo explícito porque es
  la comprobación que hizo evidente que el guion sí difiere.

## Una dependencia de desarrollo nueva: `@types/jsdom`

`referenceCurrencyStore.test.tsx` necesita `new JSDOM(...)` de verdad
(`jsdom` ya es dependencia directa del repo, usada por el proyecto `ui` de
Vitest, pero solo como _entorno_, nunca importada a mano en un test) para
ejecutar el guion de arranque en un documento propio con su propio
`localStorage` inyectado — es la técnica que `architecture.md` § Pruebas,
punto 4, describe explícitamente («jsdom con `runScripts: "dangerously"` y
un `localStorage` inyectado en `beforeParse`»). El paquete `jsdom` no traía
tipos propios y no había `@types/jsdom` instalado; sin él, `tsc --noEmit`
fallaba con `TS7016`. Instalé `@types/jsdom@30.0.0` como
`devDependency` (`npm install --save-dev @types/jsdom`, confirmé antes que
había red disponible con `npm view`). No toqué ninguna dependencia de
producción; el diff de `package.json`/`package-lock.json` es exactamente
esa entrada.

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-039` → `0` (comprobado antes de escribir una
  línea, y otra vez al final).
- `bash .agent/verify.sh F-039` → **`0`** en el estado final del árbol
  (typecheck · lint · format · test). El único fallo real de este ciclo
  fue de `format`, y de archivos propios: las tres piezas nuevas de
  `src/features/currency/` sin pasar por `npm run format` la primera vez
  (intento 32 → 33). Arreglado formateando exactamente esos tres
  archivos, no el árbol entero (ficha
  `.agent/playbook/prettier-write-reescribe-prosa-ajena.md`, que sigue
  aplicando aunque en este ciclo la otra sesión ya no estuviera escribiendo).
- `npx vitest run` (suite completa, 143 archivos · 1541 pruebas) en verde
  antes de considerar el ciclo cerrado, no solo los archivos nuevos.
- `npm run check:harness` → verde (no era parte del criterio de este
  ciclo, que solo pide `verify.sh` en 0, pero lo corrí porque añadí rutas
  nuevas a la prosa de este documento).
- `npm run lint`, `npx tsc --noEmit`: verdes, sin warnings nuevos (el
  único warning de `lint` es preexistente, de
  `src/features/account/components/ProfileForm.tsx`, ajeno a este
  ciclo).

## Deuda dejada

- Ninguna del alcance de los pasos 4-5. No se creó ningún archivo de los
  pasos 6-10 (`src/features/orders/`, el carrito, el checkout, los
  handlers del sync, la ADR 0031, el guion de humo).
- **No se añadió una prueba de componente para
  `src/app/[slug]/p/[productSlug]/page.tsx`.** Ni el paso 5 del plan ni la
  tabla de `architecture.md` § Pruebas piden un archivo de prueba para esa
  página (solo `ProductCard.test.tsx`, "la primera prueba de este
  componente"); la cobertura de la lógica compartida
  (`priceEquivalents`) ya está en `src/lib/priceEquivalents.test.ts` (ciclo
  1. y en `ProductCard.test.tsx` (este ciclo), y la página en sí compila,
     tipa y pasa el resto de la suite. Si `sdd-tester` decide que hace falta
     una prueba dedicada de esa página, no es una desviación mía: el plan no
     la ordenó.
- **`getStoreRates(resolution)` ahora se llama tanto desde
  `src/app/[slug]/layout.tsx` como, por separado, desde cada página** (ya
  lo hacían antes de este ciclo). `cached()` (`src/lib/cache.ts`) envuelve
  con `unstable_cache` pero no con `React.cache()`, así que dos llamadas
  **concurrentes** con la misma clave (layout y página se renderizan en
  paralelo, ficha
  `.agent/playbook/pagina-asume-el-redirect-de-su-layout.md`) podrían, en
  el peor caso de caché fría, disparar dos lecturas en vez de una. Es
  exactamente lo que AD4 § "Lo que este atributo obliga" ordena
  (`getStoreRates(resolution)` en el layout, "misma clave de caché y mismo
  tag que la que ya hacen las páginas") y no algo que este ciclo introdujo
  por su cuenta — lo anoto porque no está medido, no porque lo haya
  descubierto como error mío. Si `sdd-tester` quiere medirlo bajo carga,
  es una etapa `--full`/`bundle`-style, no un test unitario.

## Qué necesita quien pruebe

- Los tres módulos nuevos de `src/features/currency/` son puros o de
  cliente sin Prisma: `npm test` los cubre sin Postgres ni emuladores.
- Para ver el selector de verdad hace falta un negocio con
  `displayCurrencies` no vacío y al menos una tasa vigente para alguna de
  esas monedas — `seed-negocio-1` (`["CUP","USD","MLC"]`) ya lo cumple
  desde F-038/ciclo 1.
- El criterio 9 (lista vacía ⇒ HTML idéntico) se ve con un negocio sin
  `displayCurrencies` — `seed-negocio-2`, o vaciando la lista como ya
  anotó el ciclo 1.
- La medición real de bytes (373, no 377) está en
  `src/features/currency/reveal.test.ts`, ejecutable con
  `npx vitest run src/features/currency/reveal.test.ts`.

## Preguntas al humano

Ninguna. Los dos pasos estaban completamente especificados por el plan
firmado y por AD1/AD4/AD9/AD6 de `architecture.md` y § El selector/§
Componentes de UI/§ Accesibilidad/§ Textos de `design.md`; las cuatro
decisiones documentadas arriba en § Desviaciones son de forma, no de
alcance.

---

# Ciclo 3 — paso 6: carrito y checkout (2026-09-08)

> El árbol se recibió con los pasos 1-5 verificados
> (`bash .agent/verify.sh F-039` en 0 antes de escribir una línea,
> comprobado, y la puerta `bash .agent/sdd.sh gate F-039` también en 0). La
> otra sesión de F-041 seguía apartada por pedido del humano: el sensor de
> este ciclo es enteramente atribuible a este trabajo. Solo el paso 6; los
> pasos 7-10 no se tocan (nada en `src/features/sync/`, la ADR 0031 ni el
> guion de humo).

## Qué se construyó

| Archivo                                                           | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Criterio que cubre |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/features/orders/types.ts`                                    | AD3: `QuoteStore` gana `displayCurrencies: readonly string[]` (obligatorio); `QuoteResponse` gana `rates: Record<string, string>` (obligatorio, top-level, la tabla ENTERA que produjo `subtotal`)                                                                                                                                                                                                                                                                                      | Paso 6; C13        |
| `src/features/orders/server/quote.ts`                             | `OrderStore` gana `displayCurrencies`; el `select` de `loadStoreForOrder` (L128) gana `displayCurrencies: true` en el mismo `business` — cero consultas nuevas; el objeto devuelto lo publica; `toQuoteResponse` publica `store.displayCurrencies` y el `rates` de nivel superior, ambos desde el mismo `CartQuote`                                                                                                                                                                     | Paso 6; C13        |
| `src/features/orders/server/quote.test.ts`                        | El `store` fixture gana `displayCurrencies: []` (rompía a propósito, architecture.md § Qué rompe en compilación punto 2); dos pruebas nuevas: `displayCurrencies` viaja sin podar por `loadStoreForOrder`, y `toQuoteResponse` publica la MISMA tabla de tasas que produjo `subtotal`, con la lista declarada intacta aunque una moneda no tenga tasa (DH8)                                                                                                                             | Paso 6; C13        |
| `src/features/cart/components/CartView.tsx`                       | DH3: bajo el subtotal, el equivalente aproximado en la moneda ya elegida (leída de `referenceCurrencyStore.ts`, reutilizado, nunca escrito desde aquí) calculado con `priceEquivalents(subtotalMoney, quote.store.displayCurrencies, quote.store.currencyCode, quote.rates)` — la MISMA tabla que produjo el subtotal (AD3); el aviso «Cobramos en CUP; el equivalente es aproximado.» se añade al párrafo que ya existe (D8), solo cuando hay equivalente; nunca durante «Calculando…» | Paso 6; C13        |
| `src/features/cart/components/CartView.test.tsx` (nuevo)          | La primera prueba de este componente: sin equivalente mientras el subtotal no es firme; con equivalente y el aviso cuando hay preferencia elegida y ofrecida; nada con «solo la moneda base»; nada (y la preferencia no se borra, R17) con una preferencia que esta tienda no ofrece; nada nuevo sin monedas declaradas (E10/C9)                                                                                                                                                        | Paso 6; C13        |
| `src/features/cart/components/CheckoutForm.tsx`                   | El total (y el total parcial, F-031) ganan su equivalente igual que el subtotal, con la MISMA tabla de la cotización; `expectedTotal` sigue construyéndose exactamente igual — ni una línea tocada en su fórmula (`add(subtract(...), ...)`)                                                                                                                                                                                                                                            | Paso 6; C13        |
| `src/features/cart/components/OrderSummary.tsx`                   | Ranura nueva `equivalentLabel` (D9), hermana de `partialNotice`, tipada `ReactNode` (no `string`) para llevar el mismo par `aria-hidden "≈"` + `sr-only "aproximadamente "` que ya usa `ProductCard`; `note` se reutiliza tal cual para la frase del cobro                                                                                                                                                                                                                              | Paso 6; C13        |
| `src/features/cart/components/CheckoutForm.test.tsx`              | Los dos fabricantes de `quote()` (L21 y L150) ganan `displayCurrencies`/`rates` (rompían a propósito); prueba nueva de C13: con USD elegido y ofrecido, el resumen pinta el equivalente **y** el `POST /api/orders` que sale lleva `expectedTotal` idéntico al de siempre, en la base, sin ninguna mención de USD en el cuerpo                                                                                                                                                          | Paso 6; C13        |
| `src/features/cart/components/CheckoutForm.autocomplete.test.tsx` | El único fabricante de `quote()` (L21) gana `displayCurrencies`/`rates` (rompía a propósito)                                                                                                                                                                                                                                                                                                                                                                                            | Paso 6             |

## Desviaciones

Ninguna respecto del plan firmado. Una decisión de forma que documento para
quien siga:

1. **`OrderStore` (server-side) también gana `displayCurrencies`, aunque el
   plan solo cita `src/features/orders/server/quote.ts` sin desglosar sus
   tipos.** Es la consecuencia directa e inevitable de AD3 —`toQuoteResponse`
   publica `quote.store.displayCurrencies`, y `quote.store` es un
   `OrderStore`—, y architecture.md § Qué rompe en compilación punto 2 ya la
   anticipa por su nombre exacto: «`OrderStore` con `displayCurrencies` rompe
   cualquier literal que lo construya en pruebas de
   `src/features/orders/server/`». No es alcance añadido: sin este campo
   `quote.ts` no compila.
2. **`OrderSummary.equivalentLabel` es `ReactNode`, no `string`**, a
   diferencia de los demás labels del componente (`subtotalLabel`,
   `discountLabel`, `totalLabel`, que sí son `string | null`/`string`). Es
   deliberado: R16 exige que el equivalente lleve su propio nombre accesible
   («aproximadamente US$…»), y eso solo se consigue con el mismo par
   `aria-hidden`/`sr-only` que `ProductCard.tsx` ya usa — un `string` plano
   perdería esa marca o la duplicaría de otra forma en cada llamante.
   `design.md` § Componentes de UI ya pedía la ranura «hermana de
   `partialNotice`»; el tipo es la única decisión que no estaba escrita ahí.

## Comandos ejecutados

- `bash .agent/sdd.sh gate F-039` → `0`, comprobado antes de escribir una
  línea.
- `bash .agent/verify.sh F-039` → **`0`** en el estado final del árbol
  (typecheck · lint · format · test). Hubo dos fallos reales de este ciclo,
  los dos triviales y ya fichados:
  - `format` en rojo dos veces (intento 36 y 38), ambas por archivos
    **propios** recién tocados
    (`src/features/cart/components/CartView.tsx`,
    `src/features/orders/server/quote.test.ts` la primera vez;
    `src/features/cart/components/CheckoutForm.test.tsx` la segunda) sin
    pasar por `npm run format` — arreglado formateando exactamente esos
    archivos (ficha `prettier-sin-formatear`, ya fichada por el ciclo 1; no
    hizo falta una ficha nueva).
  - Ningún fallo de compilación imprevisto: los que architecture.md § Qué
    rompe en compilación anticipaba (los tres fabricantes de `quote()` y el
    `describe("toQuoteResponse()")`, más `OrderStore` en `quote.test.ts`)
    salieron exactamente donde el documento dijo que iban a salir, y se
    arreglaron en el mismo cambio que los introdujo.
  - No hubo ningún fallo del sensor atribuible a un archivo de F-041 en
    este ciclo.
- `npx vitest run src/features/cart/components/CartView.test.tsx` y
  `npx vitest run src/features/cart/components/CheckoutForm.test.tsx` en
  verde de forma aislada, antes de correr la suite completa dentro de
  `verify.sh`.
- `npx prettier --write` sobre exactamente los archivos propios listados
  arriba (nunca el árbol entero ni prosa ajena — ficha
  `prettier-write-reescribe-prosa-ajena.md`, que sigue aplicando aunque en
  este ciclo no haya prosa de `.agent/` que tocar).
- `bash .agent/verify.sh F-039 --full` **no se ejecutó** en este ciclo: el
  "Cómo se verifica" del paso 6 pide `bash .agent/verify.sh F-039` en `0`,
  no `--full` — eso es del cierre (paso 9/10).
- Skill `code-review` (nivel medio) sobre el diff de este ciclo, como pide
  `sdd-implementer.md` para un cambio sustancial.

## Deuda dejada

Nada propio del paso 6. Anotado para quien siga con los pasos 7-10, sin
tocarlo yo (el alcance lo cambia el humano, no quien lo descubre):

- El paso 7 (la invalidación de F-038) sigue exactamente donde lo dejó el
  ciclo 2: nada de `src/features/sync/` se tocó en este ciclo.
- `createOrder.test.ts` construye su propio `store` (línea 38) para
  `loadStoreForOrder`/`quoteCart`, pero los dos están **mockeados** ahí
  (`vi.mock("./quote", …)`), así que ese literal nunca se comprueba contra
  el tipo real `OrderStore` y no necesitó ningún cambio para compilar. Lo
  anoto porque es la única razón por la que ese archivo no aparece en la
  tabla de arriba, no porque lo haya revisado y decidido que no aplica: si
  algún día ese mock se vuelve real, ese literal va a necesitar
  `displayCurrencies` igual que el de `quote.test.ts`.
- No añadí ninguna prueba de humo ni medí bytes: eso es el paso 9, no
  este.

## Qué necesita quien pruebe

- Las pruebas nuevas (`CartView.test.tsx`, la de C13 en
  `CheckoutForm.test.tsx`) son de componente puro, sin Prisma: `npm test`
  las cubre sin Postgres ni emuladores.
- Para ver el equivalente de verdad en el carrito o el checkout hace falta
  una tienda con `Business.displayCurrencies` no vacío, una tasa vigente
  para al menos una de esas monedas, y una preferencia ya elegida en
  `localStorage` bajo la clave `qab.reference-currency.v1` (la MISMA que
  escribe el selector de la cabecera, paso 4) — `seed-negocio-1`
  (`["CUP","USD","MLC"]`) sirve para esto igual que para el catálogo.
- El aserto duro del criterio 6/13 —`expectedTotal` idéntico al de antes
  del feature— está en la nueva prueba
  `CheckoutForm.test.tsx > CheckoutForm — el equivalente no toca lo que se
cobra (C13)`: compara el cuerpo real que `fetch` recibe en
  `POST /api/orders`, no solo lo que se pinta en pantalla.
- `CartQuote.rates` (y por tanto `QuoteResponse.rates`) es la tabla
  **entera** que `loadCurrentRates` devolvió para ese negocio en el momento
  de cotizar, sin filtrar a lo declarado — quien escriba un fixture de
  `QuoteResponse` a mano para otra prueba tiene que acordarse de los dos
  campos nuevos, obligatorios: `rates` (nivel superior) y
  `store.displayCurrencies`.

## Preguntas al humano

Ninguna. El paso 6 estaba completamente especificado por AD3 de
`architecture.md`, R12 § excepción acotada de `spec.md`, y § Componentes de
UI / § Textos (D8, D9) de `design.md`; no hubo ninguna decisión de alcance
que tomar.

---

# Ciclo 4 — pasos 7 y 8: la invalidación y la ADR 0031 (2026-09-08)

> Solo los pasos **7 y 8** del plan firmado. Los pasos 9 y 10 no se tocan:
> nada de `.agent/specs/F-039/smoke.sh`, `.agent/progress/F-039.md` ni
> `.agent/specs/F-039/tests.md`.

## Qué se construyó

| Archivo                                                                     | Qué hace                                                                                                                                                                                                                                                    | Criterio que cubre |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/features/sync/server/handlers/types.ts`                                | AD8: `outcomeOf` mudado aquí desde `src/features/sync/server/handlers/misc.ts`, exportado. Mismo cuerpo, mismo invariante (conjunto vacío ⇒ sin campo)                                                                                                      | Paso 7 (base)      |
| `src/features/sync/server/handlers/misc.ts`                                 | Importa `outcomeOf` de `./types` en vez de declararlo; se retira el `import type { PublicSlug }` de la línea 3, que quedaba sin otro uso                                                                                                                    | Paso 7             |
| `src/features/sync/server/handlers/business.ts`                             | AD7: `handleBusiness` gana el cuarto y último parámetro `renderableBranches: RenderableBranchLookup`; la última línea pasa de `PROCESSED` pelado a `outcomeOf(await renderableBranches(businessId))`, llamado **solo** en el camino que escribió (R18)      | R18, R19, C14      |
| `src/features/sync/server/processBatch.ts`                                  | El `case "BUSINESS"` de `applyEvent` reenvía `renderableBranches`, el mismo memo que ya recibían `CURRENCY`/`EXCHANGE_RATE` (una línea, AD7)                                                                                                                | R18, C14           |
| `src/features/sync/server/handlers/business.test.ts`                        | Todas las llamadas ganan el cuarto argumento (un `vi.fn()` fake, nunca el memo real); dos casos nuevos: el conjunto que devuelve la clausura se convierte en `touchedStoreSlugs`, y `renderableBranches` **no se llama nunca** en DELETE/inválido/stale     | C14                |
| `src/features/sync/server/processBatch.test.ts`                             | El `case "BUSINESS"` se verifica con el cuarto argumento; test nuevo: `handleBusiness` recibe la **misma** función que `handleCurrency`/`handleExchangeRate` del mismo lote                                                                                 | C14                |
| `src/features/sync/server/processBatch.invalidationCount.test.ts`           | `./handlers/business` deja de mockearse (queda real, igual que `handleCurrency`/`handleExchangeRate`); dos `BUSINESS` del mismo negocio en un lote ⇒ **una** `storefront.findMany` y 2×3 `revalidateTag`; de dos negocios (dos lotes) ⇒ dos consultas       | C14                |
| `src/features/sync/server/handlers/businessInvalidation.db.test.ts` (nuevo) | Contra Postgres real, por el `POST` de verdad: un negocio con dos sucursales `PUBLISHED` invalida **exactamente** `storeTag`/`storeCatalogTag` de cada una y de ninguna otra; `stale`, `DELETE`, inválido y un negocio entero en `DRAFT` invalidan **cero** | C14                |
| `docs/adr/0031-la-preferencia-del-visitante-no-entra-en-el-html.md` (nuevo) | La ADR con el borrador de `architecture.md` como base: contexto, decisión, consecuencias y la alternativa descartada                                                                                                                                        | Paso 8             |

**La deuda I7/D4 de `.agent/specs/F-038/impl.md` § Deuda dejada queda
cerrada por este ciclo**: «F-039 tiene que traer su propia invalidación de
caché cuando exista el lector» — el lector es `StoreSummary.displayCurrencies`
(F-039 paso 3) y la invalidación es exactamente la de esta tabla.

## Desviaciones del plan firmado

Ninguna. La firma de `handleBusiness` es la que `architecture.md` AD7 dicta
letra por letra (el memo al final, tercero y último en las dos que ya lo
reciben, cuarto aquí porque `handleBusiness` ya tenía tres). `outcomeOf` se
movió al archivo exacto que AD8 pide, con la razón que AD8 da (el invariante
vive junto al campo que declara opcional). La ADR usa el número y el título
que `architecture.md` § «¿Hace falta una ADR?» ya había elegido.

Una decisión de forma, no de alcance, que el plan no bajaba a ese detalle:
en `businessInvalidation.db.test.ts` usé **dos** sucursales `PUBLISHED` (no
una) para el caso de la invalidación exitosa, precisamente para que «cada
sucursal renderizable y de ninguna otra» se demuestre con un conjunto de más
de un elemento — con una sola sucursal, `canonicalSlug()` con
`brandBranchCount<=1` resuelve al slug del propio `Storefront`, y «cada» se
volvería indistinguible de «la única».

## Qué se verificó y cómo

- `bash .agent/verify.sh F-039` → **`0`** (typecheck · lint · format · test)
  en el estado final del árbol.
- `bash .agent/verify.sh F-039 --full` → **`0`** también (harness · typecheck
  · lint · format · test · prisma · build · theme · bundle). No era el
  criterio de cierre de este ciclo (eso es el paso 10), pero corrí `--full`
  para comprobar `npm run check:harness` sobre la ADR nueva sin tener que
  levantar el guion aparte, y de paso confirmar que el ciclo no dejó nada en
  rojo para el paso 9/10.
- `npm run check:harness` sola, antes del `--full`: verde sobre las nueve
  rutas nuevas que cita el ADR (`src/lib/cache.ts`,
  `src/constants/currency.ts`, `src/features/currency/reveal.ts`,
  `src/features/currency/referenceCurrencyStore.ts`, `src/proxy.ts`,
  `src/app/layout.tsx`, `src/lib/boundaries.test.ts`, y las dos fichas de
  `.agent/playbook/`) — comprobado con `ls` una por una antes de escribirlas
  entre comillas invertidas.
- `npm run format:check` → `0`. `npm run format` se corrió sobre el árbol
  completo (el guion del repo no acepta una lista de archivos que se
  respete de verdad) y no reescribió nada fuera de lo que yo mismo acababa
  de tocar — comprobado con `git status --short` antes y después, sin
  ningún archivo ajeno de por medio (la sesión de F-041 ya había soltado el
  árbol, como anticipaba PP1(b) del plan).
- `npx vitest run src/features/sync/server/handlers/business.test.ts
src/features/sync/server/processBatch.test.ts
src/features/sync/server/processBatch.invalidationCount.test.ts
src/features/sync/server/handlers/businessInvalidation.db.test.ts` en verde
  de forma aislada, contra Postgres real (los emuladores ya estaban arriba,
  compartidos con otro checkout — no levanté ni recreé ningún contenedor),
  antes de correr la suite completa dentro de `verify.sh`.
- Ningún fallo del sensor en este ciclo: `verify.sh` pasó en el primer
  intento posterior a cada cambio de código; los únicos rojos de
  `typecheck` fueron los que `architecture.md` § Qué rompe en compilación
  anticipaba (los once sitios de `business.test.ts` que llamaban a
  `handleBusiness` con tres argumentos), arreglados en el mismo cambio que
  los introdujo.
- Comprobé `docs/despliegue.md` sin tocarlo: este ciclo no introduce ningún
  paso operativo (ni secreto, ni cron, ni bucket, ni regla de plataforma, ni
  migración que revisar a mano) — reutiliza el conducto de invalidación que
  F-026/F-035 ya dejaron abierto (AD7), así que lo esperado es que el
  documento no cambie, y no cambió.

## Deuda dejada

Ninguna nueva propia de los pasos 7 y 8. **El criterio 6 no es mío**: sigue
exactamente como `spec.md` lo dejó — I1 ya avisa que «no se puede tomar
literalmente» (el checkout nunca cobra en la moneda del equivalente) y su
letra (a)/(b) las cierra el humano o `sdd-tester`, no este ciclo, que no
tocó nada de `src/features/orders/` ni del carrito/checkout. Los pasos 9 y
10 siguen sin empezar: nada de guion de humo, nada de `tests.md`, nada de
`npm run check:bundle` como entrega (lo corrí solo para mirar, dentro de
`--full`, y no cambió nada — sigue en 182,1 KB gzip medidos en el ciclo 2,
sin que este ciclo tocara ningún componente de cliente).

## Qué necesita quien pruebe

- El criterio 14 completo se prueba en dos niveles: la cuenta de consultas
  (Prisma simulado, `processBatch.invalidationCount.test.ts`) y los tags
  exactos contra Postgres real (`businessInvalidation.db.test.ts`) — los
  dos hace falta correrlos, ninguno sustituye al otro (§ Pruebas de
  `architecture.md`, decisión 3).
- `businessInvalidation.db.test.ts` asume la forma exacta del slug que
  `dbFixtures.ts::createStore` genera (el token de la sesión, guion,
  "store", guion, un contador que empieza en 1) para predecir los dos
  slugs que `canonicalSlug()` va a resolver. Si esa fixture cambia de
  forma, este archivo es el primero en fallar, y su propio `expect`
  intermedio sobre los dos `externalId` es solo un canario de que las dos
  tiendas se crearon, no una prueba de la forma del slug en sí.
- La ADR 0031 no tiene prueba automática — es prosa. Lo que sí se puede
  comprobar es que el código la respeta: `src/lib/boundaries.test.ts` ya
  afirma que ningún archivo de `src/app/[slug]/`,
  `src/components/store/` o `src/features/catalog/` importa
  `next/headers`, que es la mitad comprobable de «prohibido: cookie,
  parámetro de consulta, cabecera `Vary`».

## Preguntas al humano

Ninguna. Los pasos 7 y 8 estaban completamente especificados —AD7/AD8 de
`architecture.md` bajan la firma exacta y el archivo exacto; el borrador de
la ADR ya venía con el número, el título y las cuatro secciones escritas—, y
no hubo ninguna decisión de alcance que tomar.
