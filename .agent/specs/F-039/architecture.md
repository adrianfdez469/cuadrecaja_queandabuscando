---
feature: F-039
agente: sdd-architect
actualizado: 2026-09-08T05:04:00Z
estado: listo
---

> Diseño sobre `.agent/specs/F-039/spec.md` en `estado: listo` (22 reglas
> R1-R22, 18 escenarios E1-E18, 16 criterios C1-C16, 13 casos límite y tres
> preguntas SP1-SP3 **ya cerradas** por el humano el 2026-09-08). No reabro
> nada de eso. Aquí se decide **cómo**, que es exactamente lo que la spec dejó
> en § «No decidido a propósito»: los siete puntos, cada uno con archivo,
> firma y coste.
>
> Las cinco decisiones del humano del 2026-09-08 —**DH1** base como principal
> y solo el equivalente elegido visible, los demás en el HTML ocultos por CSS;
> **DH2** un selector único en la cabecera, recordado entre visitas; **DH3**
> carrito y checkout también, con el aviso del cobro; **DH4** = SP1(a) primera
> declarada calculable + opción «solo la moneda base», SP2(a) sin tope medido
> con `npm run check:bundle`, SP3(a) solo el importe que se cobra; **DH5** una
> moneda declarada **sin tasa vigente no se ofrece** en el selector— están
> incorporadas y no se vuelven a preguntar. Las tres preguntas de este
> documento están **cerradas**: AP1(a), AP2(a) y AP3(a) (§ Preguntas al humano).
>
> **Qué cambió en el ciclo 2 respecto de la versión que el orquestador ya
> leyó**, para que nadie tenga que diffear 1100 líneas:
>
> 1. **AD1 cambia una exportación**: `defaultEquivalentCurrency` desaparece y
>    en su lugar hay `selectableCurrencies`, que es el conjunto que DH5 pide y
>    del que SP1(a) sale como su primer elemento. Tres exportaciones, igual que
>    antes.
> 2. **AD4 cambia el guion de arranque**, y no por DH5: la versión de 324 bytes
>    **no implementaba E17** como está escrito —comprobado ejecutándola, caía
>    en la moneda por defecto donde la spec pide el centinela— mientras que la
>    prosa de este documento decía que sí. Corregido a 377 bytes, con las cinco
>    ramas ejercitadas una por una. DH5 hace ese camino habitual en vez de raro
>    (es lo que pasa cuando una tasa caduca), así que tenía que estar bien.
> 3. **AD4 y AD5 ganan una consulta que la versión anterior ya necesitaba y no
>    declaraba**: `src/app/[slug]/layout.tsx` tiene que leer las tasas. Ya era
>    cierto con `data-ref-default` (SP1(a)); DH5 solo lo hace más visible. Es
>    una lectura cacheada con la **misma** clave y el **mismo** tag que la que
>    ya hacen las páginas, así que no hay entrada de caché nueva ni tag nuevo
>    (§ Escalabilidad, primera tabla).
> 4. Ninguna otra AD se toca. AD2, AD3, AD6, AD7, AD8, AD9 y AD10 quedan como
>    estaban.
>
> **Reparto con el diseñador, que trabaja en paralelo sobre esta misma spec:**
> yo fijo el **mecanismo** (qué atributo va en qué elemento, qué CSS se genera,
> qué corre antes del pintado) y su coste en bytes; él fija la **apariencia y
> las palabras** (dónde va el equivalente en la tarjeta, cómo se marca el
> aproximado, cómo se ve el selector, la frase del cobro). Lo que mi mecanismo
> le restringe está aislado en § Restricciones para el diseñador, en cinco
> puntos, para que lo lea sin tener que leer el resto.
>
> **Cuatro cosas comprobadas aquí ejecutando, no leyendo:**
>
> 1. **jsdom 29.1.1 sí aplica un `<style>` con selectores de atributo y
>    `:not()`** al `getComputedStyle`. Reproducido con jsdom directamente, con
>    el `<style>` dentro del `<body>` y el atributo en un `div` intermedio:
>    de tres hermanos `data-equiv="USD"/"MLC"/"EUR"` bajo
>    `data-ref-currency="USD"`, el primero resuelve `display: inline` y los
>    otros dos `display: none`. Consecuencia: **C15 se puede verificar en el
>    proyecto `ui`** (nombre accesible y `toBeVisible`), no hace falta un
>    navegador de verdad para ese criterio.
> 2. **Los bytes del HTML, medidos con gzip real** sobre markup con importes
>    distintos por tarjeta (no el mismo repetido, que comprime de mentira):
>    24 tarjetas × 2 equivalentes = **+5,7 KB en crudo, +0,4 KB gzip**; × 3 =
>    +8,6 KB / +0,6 KB; × 40 = **+114 KB / +6,3 KB**. Las cifras completas y
>    qué significan están en § Escalabilidad.
> 3. **El guion de arranque cabe en 377 bytes** y el bloque de CSS en 205
>    bytes para dos monedas ofrecidas (76 bytes por regla; 3,1 KB en crudo y
>    0,29 KB gzip para 40). Los dos textos exactos están en § Contratos.
> 4. **Las cinco ramas del guion, ejecutadas una por una** en jsdom con un
>    `localStorage` fabricado y `data-ref-choices="USD MLC"`: sin preferencia →
>    `USD` (SP1(a)); `USD` → `USD`; `none` → `none`; `EUR`, que no se ofrece →
>    `none` (E17 y DH5 con la tasa caducada); basura (`{"a":1}`) → `USD`, o sea
>    tratada como «sin preferencia» (R17). La versión anterior del guion daba
>    `USD` en el cuarto caso, y ahí está el fallo que este ciclo corrige.

## Estado actual relevante

Qué existe hoy y qué se reutiliza **tal cual**, que es lo primero que hay que
inventariar antes de proponer nada nuevo.

| Pieza                                                                                                                            | Qué hace hoy                                                                                                                     | Qué hace F-039 con ella                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/money.ts` (`convert`, L141-162)                                                                                         | Convierte por el ancla CUP en **una sola** división, half-up sobre enteros escalados; lanza `MoneyError` si falta la tasa        | Se llama, no se toca (R9, R10)                                              |
| `src/lib/money.ts` (`formatWithIntl`, L173-192)                                                                                  | Construye **un `Intl.NumberFormat` por importe formateado**, con rama de respaldo `«CÓDIGO importe»`                             | Gana un memo acotado (AD6). Única modificación de este archivo              |
| `src/lib/pricing.ts` (`resolvePrice`, L65)                                                                                       | El compositor único: precio efectivo → promoción → `convert` al `targetCurrency`                                                 | Se llama igual. `targetCurrency` sigue siendo la base (R3)                  |
| `src/features/catalog/server/queries.ts` (`loadStore` L117-186, `StoreSummary` L46-81, `getStoreBySlug` L188)                    | Lee la tienda cacheada con `unstable_cache`, tag `storeTag(canonicalSlug)`; el `select` ya baja a `business` en la **línea 139** | La línea 139 gana **una columna**. Cero consultas nuevas (AD5)              |
| `src/features/catalog/server/rates.ts` (`loadCurrentRates` L51) y `getStoreRates` (`src/features/catalog/server/queries.ts:417`) | La única sentencia que decide la tasa vigente (ADR 0030); ya devuelve **todas** las tasas del negocio                            | Se lee igual. Nada que filtrar ni añadir                                    |
| `src/components/store/ProductCard.tsx`                                                                                           | Componente de **servidor**; `safeResolve` (L91-106) atrapa el fallo y pinta «Consultar»                                          | Pinta los equivalentes. Sigue siendo de servidor (R12)                      |
| `src/components/store/StoreCatalogResults.tsx`                                                                                   | Pinta la rejilla de `ProductCard` en `/[slug]/buscar` y `/[slug]/catalogo`                                                       | **No se toca**: los equivalentes entran por `ProductCard`                   |
| `src/app/[slug]/layout.tsx`                                                                                                      | Cabecera compartida; ya emite un `<style>` de tema y ya monta `CartBadge`, la isla que no pinta nada en el HTML servido          | Emite el `<style>` de monedas, el guion de arranque y el selector           |
| `src/features/cart/cartStore.ts` (L83-85, L213-215)                                                                              | Estado de cliente con `useSyncExternalStore`; `getServerSnapshot` vacío es la técnica de «no pintar nada hasta hidratar»         | Se **copia la técnica**, no se importa (AD4)                                |
| `src/features/cart/cartStorage.ts` (L24-64)                                                                                      | Adaptador de `localStorage` con respaldo en memoria cuando lanza                                                                 | Se copia la disciplina (R17); clave nueva, no la del carrito                |
| `src/features/orders/server/quote.ts` (`loadStoreForOrder` L112-129, `CartQuote.rates` L94, `toQuoteResponse` L349)              | `CartQuote` ya lleva `rates`; `toQuoteResponse` simplemente no las publica; el `select` ya baja a `business` (L128)              | `rates` se publican y el `select` gana **una columna** (AD3)                |
| `src/features/sync/server/handlers/business.ts`                                                                                  | Escribe la lista con **un** `updateMany` condicional y devuelve `PROCESSED` pelado                                               | Gana el cuarto parámetro y devuelve `outcomeOf(...)` (AD7)                  |
| `src/features/sync/server/businessBranches.ts` (`createRenderableBranchLookup` L64)                                              | El memo por lote de F-035: una consulta por negocio, promesa memoizada, entrada borrada si se rechaza                            | Se reutiliza **entero**. Ni una consulta nueva                              |
| `src/features/sync/server/processBatch.ts` (memo creado en L49, `applyEvent` en L160)                                            | Crea el memo una vez por lote y ya se lo pasa a `applyEvent` como tercer parámetro                                               | El `case "BUSINESS"` lo reenvía. Una línea                                  |
| `src/lib/cache.ts` (`revalidateStores` L86-93)                                                                                   | Expira `storeTag` y `storeCatalogTag` de cada slug canónico, deduplicado                                                         | Se llama por el camino que ya existe. **Ningún tag nuevo** (R19)            |
| `src/features/sync/displayCurrencies.ts` (`DISPLAY_CURRENCY_CODE` L15)                                                           | `/^[A-Z]{3}$/`, sin llamantes fuera de su módulo (comprobado con `grep`)                                                         | El patrón se muda a `src/constants/` y lo comparten escritor y lector (AD2) |
| `src/features/catalog/catalogFilters.ts` (`resolveProductPrice` L255-266, `CatalogFilterContext`)                                | Filtra y ordena sobre el precio en la **base**                                                                                   | **No se toca** (R14). Su ausencia de cambio es lo que verifica C16          |
| `src/proxy.ts`                                                                                                                   | No hace match sobre `/[slug]`                                                                                                    | **No se toca** (R20, ficha `proxy-matcher-anula-isr`)                       |

Y lo que **no** existe y por eso hay que crearlo: no hay ninguna función que
calcule un equivalente, no hay ningún estado de cliente que no sea el carrito,
`src/components/store/ProductCard.tsx` **no tiene prueba propia** (C1 abre la
primera) y `src/features/cart/components/CartView.tsx` tampoco (C13 abre la
suya).

## Decisión

Diez decisiones, `AD1..AD10`. Las siete primeras responden, en orden, a los
siete puntos de § «No decidido a propósito» de la spec.

### AD1 — la función pura de R7 vive en src/lib/priceEquivalents.ts (por crear), devuelve `Money[]`, y es una de tres exportaciones del mismo módulo (revisada por DH5)

**Capa:** `src/lib/` (lógica pura y reutilizable, sin Prisma y sin React,
AGENTS.md § Arquitectura). **Módulo nuevo, no dentro de `src/lib/pricing.ts`**,
y esa es la única parte de esta decisión que no es obvia: `pricing.ts` importa
`src/lib/promotions.ts` en su cabecera, y carrito y checkout —que son árbol de
cliente— tendrían que importar de ahí, arrastrando la maquinaria de promociones
al bundle si el empaquetador no consigue sacudirla. El módulo nuevo importa
**solo** de `./money`, que ya está en ese árbol.

**DH5 y los tres conjuntos.** La respuesta corta a la pregunta del
orquestador: **`equivalentCurrencies` sola ya no sirve para las dos cosas, y
hace falta una exportación más** —no dos conjuntos nuevos, uno. Los tres
conjuntos, con qué función responde a cada uno:

| Conjunto                                   | Qué es                                                                     | Quién lo pide                                                         | Función                        |
| ------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| **La lista declarada**                     | `Business.displayCurrencies` tal cual, sin podar (R1)                      | Nadie la pinta; es la entrada de todo lo demás                        | Ninguna: es el dato            |
| **Lo que se pinta**, por producto          | Los equivalentes que `convert` consigue calcular para **ese** importe (R5) | `ProductCard`, la ficha, carrito y checkout                           | `priceEquivalents`             |
| **Lo que el selector ofrece**, por negocio | Las declaradas distintas de la base con equivalente **calculable** (DH5)   | El selector, `data-ref-choices`, `data-ref-default` y el CSS generado | `selectableCurrencies` (nueva) |

Y `equivalentCurrencies` se queda como lo que siempre fue: el enunciado de R2
—la lista declarada menos la base, con la forma validada—, del que los otros
dos conjuntos se derivan. Deja de ser lo que consume el selector, que era su
segundo uso.

**Los dos conjuntos que se pintan y se ofrecen ahora coinciden por
construcción**, y eso es una propiedad que conviene tener escrita: el predicado
que usa `selectableCurrencies` para filtrar es el mismo `convert` que
`priceEquivalents` usa para omitir, así que el selector no puede ofrecer una
moneda que no aparezca en ninguna tarjeta, ni callarse una que sí aparezca. Con
la forma anterior (selector = lista declarada) esas dos cosas podían discrepar,
y de hecho discrepaban: era el caso E6.

**Por qué la calculabilidad es propiedad del negocio y no del producto.**
`priceEquivalents` recibe un `price` que está **siempre** en la moneda base, así
que `convert` solo consulta dos tasas: la de la base y la del destino. Ninguna
de las dos depende del producto. O sea que «el destino tiene tasa utilizable»
—existe, es numérica y es positiva (`src/lib/money.ts:151`)— decide igual para
las 24 tarjetas de la rejilla, y se puede calcular **una vez por página**. El
único caso que sigue siendo por producto es E9, un producto cuyo precio no se
resuelve en absoluto: ahí no hay `price` que pasarle a la función y no se llama.

Un corolario que hay que escribir porque no es evidente: **si la propia moneda
base no tiene tasa utilizable** (posible solo si la base no es CUP y su fila no
está), `convert` lanza para **todos** los destinos, `selectableCurrencies`
devuelve `[]` y la tienda se comporta exactamente como una de lista vacía: sin
selector, sin equivalentes, sin nada nuevo en el HTML. Es el criterio 9 llegando
por otra puerta, y sale gratis.

Las tres firmas exactas:

```ts
/**
 * Los equivalentes de un importe ya resuelto, en el orden de la lista
 * declarada, ya omitidos los que no se pueden calcular (R5, R7, R8).
 * `price` está SIEMPRE en la moneda base: es `resolvePrice(...).price`, el
 * importe que se cobra, nunca `beforeConversion` (R8).
 */
export function priceEquivalents(
  price: Money,
  declaredCurrencies: readonly string[],
  baseCurrency: string,
  rates: RateTable,
): readonly Money[];

/**
 * El enunciado de R2: la lista declarada menos la base, comparando el código
 * como cadena exacta, descartando lo que no case `CURRENCY_CODE_PATTERN`.
 * NO poda por falta de tasa — eso es `selectableCurrencies`, y la lista
 * declarada sigue sin podarse en ningún sitio (R1).
 */
export function equivalentCurrencies(
  declaredCurrencies: readonly string[],
  baseCurrency: string,
): readonly string[];

/**
 * DH5 (humano, 2026-09-08): las de `equivalentCurrencies` cuyo equivalente se
 * puede CALCULAR con estas tasas, en el mismo orden. Lo que el selector
 * ofrece, lo que viaja en `data-ref-choices` y lo que genera las reglas de
 * CSS. Su PRIMER elemento es SP1(a), así que la moneda inicial está ofrecida
 * por construcción y no hay que comprobarlo en ninguna parte.
 *
 * El predicado es `convert` sobre un importe nominal, no `code in rates`: una
 * tasa cero o negativa hace lanzar igual que su ausencia
 * (`src/lib/money.ts:151`), y escribir aquí una segunda condición sería
 * reimplementar la regla que `convert` ya tiene (R10).
 */
export function selectableCurrencies(
  declaredCurrencies: readonly string[],
  baseCurrency: string,
  rates: RateTable,
): readonly string[];
```

SP1(a) deja de tener función propia: es `selectableCurrencies(...)[0] ?? null`,
una línea en el llamante. Un `defaultEquivalentCurrency` cuyo cuerpo fuera
`[0]` sería un nombre más que mantener y, peor, un sitio donde «el defecto» y
«lo ofrecido» podrían dejar de coincidir.

**Devuelve `Money[]`, no pares `{ currency, amount }`.** `Money`
(`src/lib/money.ts:21-25`) **es** ese par, y declarar un segundo tipo con la
misma forma es exactamente lo que AGENTS.md § Prohibiciones llama «duplicar
interfaces entre la capa de datos y la vista». Además el llamante quiere
pasárselo a `formatMoney`, que pide un `Money`.

**El cuerpo, con las tres reglas que no se negocian dentro:**

```ts
export function priceEquivalents(price, declaredCurrencies, baseCurrency, rates) {
  const out: Money[] = [];
  for (const code of equivalentCurrencies(declaredCurrencies, baseCurrency)) {
    try {
      out.push(convert(price, code, rates));
    } catch (error) {
      // R5: SOLO MoneyError se omite. Cualquier otro error es un defecto
      // del código y tiene que subir — a diferencia de los dos `catch`
      // pelados de hoy (ProductCard.tsx:103, catalogFilters.ts:264), que
      // este feature NO toca.
      if (!(error instanceof MoneyError)) throw error;
    }
  }
  return out;
}
```

`equivalentCurrencies` compara el código como cadena exacta, sin normalizar
mayúsculas (R2), y `convert` devuelve el mismo objeto cuando origen y destino
coinciden (`money.ts:142`), así que la base repetida en la lista (E8) queda
fuera por R2 y no por un caso especial.

**`priceEquivalents` sigue recorriendo `equivalentCurrencies` y no
`selectableCurrencies`**, aunque con DH5 den la misma salida. Dos razones: R5
enuncia la omisión como «se omite lo que no se puede calcular», y ese enunciado
vive en el `catch`, no en un prefiltro; y la función tiene que seguir siendo
correcta cuando la llaman con una tabla distinta de la que se usó para calcular
las opciones —que es exactamente lo que pasa en el carrito, donde las tasas son
las de la cotización (AD3) y el selector se dibujó con las de la página—. Un
prefiltro las ataría, y esa atadura no existe hoy.

`selectableCurrencies` se implementa sobre la misma función, sin un segundo
`try` escrito a mano:

```ts
export function selectableCurrencies(declaredCurrencies, baseCurrency, rates) {
  // Un importe nominal en la base: solo interesa SI convierte, no cuánto.
  const probe = money(1, baseCurrency);
  return priceEquivalents(probe, declaredCurrencies, baseCurrency, rates).map((m) => m.currency);
}
```

Tres líneas, un solo predicado en todo el módulo, y la coincidencia entre lo
ofrecido y lo pintado deja de ser una promesa para ser el mismo código.

**La llaman las cuatro pantallas** —`src/components/store/ProductCard.tsx`,
`src/app/[slug]/p/[productSlug]/page.tsx`,
`src/features/cart/components/CartView.tsx` y
`src/features/cart/components/CheckoutForm.tsx` — y las dos últimas la llaman
igual y luego eligen **uno** de los devueltos con un `.find`. Una función, un
redondeo, cero discrepancias posibles (R7).

**Alternativas descartadas:** src/features/catalog/priceEquivalents.ts
(obligaría a `features/cart` a importar de `features/catalog`); dentro de
`src/lib/pricing.ts` (arrastra `promotions.ts` al cliente); `displayPrice`
(`src/lib/pricing.ts:128`) reutilizado como principal (es la confusión que
S-008 vino a evitar, I4 de la spec).

### AD2 — el patrón del código de moneda se muda a src/constants/currency.ts (por crear) y lo comparten el escritor del sync y el lector del escaparate

`DISPLAY_CURRENCY_CODE` vive hoy en `src/features/sync/displayCurrencies.ts:15`.
Que `src/lib/` importe de `src/features/sync/` sería invertir la capa. Que el
lector escriba un segundo `/^[A-Z]{3}$/` es lo que la fila «código basura» de
la spec prohíbe con nombre. Así que el patrón se muda a
src/constants/currency.ts (por crear) como `CURRENCY_CODE_PATTERN`, con su
JSDoc de D3 (humano 2026-09-07), y `src/features/sync/displayCurrencies.ts`
lo importa de ahí en vez de declararlo. **Cero llamantes externos que romper**:
verificado con `grep -rn "DISPLAY_CURRENCY_CODE" src scripts` → solo su propio
módulo. Es además el sitio que AGENTS.md § Prohibiciones exige para un patrón
literal compartido («Magic strings y números → a `src/constants/`»).

### AD3 — carrito y checkout reciben lista y tasas en `QuoteResponse`, no como props

**Decisión: `QuoteResponse` gana `rates` y `QuoteStore` gana
`displayCurrencies`**, los dos publicados por `toQuoteResponse`
(`src/features/orders/server/quote.ts:349`) desde el **mismo** `CartQuote` que
produjo `subtotal`.

La propiedad que la spec pone como no negociable —«el equivalente de un
agregado se calcula con la misma tabla que produjo ese agregado»— es lo que
decide. Un prop `rates` bajado desde `src/app/[slug]/carrito/page.tsx` sería
**otra lectura, en otro instante**: la página es `force-dynamic` y se renderiza
antes de que el cliente cotice, así que entre su `loadCurrentRates` y el
`loadCurrentRates` de `quoteCart` (`src/features/orders/server/quote.ts:298`)
puede entrar un `EXCHANGE_RATE`. Con props, el equivalente dejaría de ser una
función del total y C6 pasaría a ser falsable por una carrera. Con
`QuoteResponse`, `subtotal` y `rates` salen del mismo objeto, capturado en el
mismo `capturedAt`.

`displayCurrencies` viaja por el mismo sitio por simetría y por coste: el
`select` de `loadStoreForOrder` ya baja a `business`
(`src/features/orders/server/quote.ts:128`) y solo gana una columna, así que la
lista llega sin una consulta nueva; y con las dos cosas en el mismo objeto no
existe el estado intermedio «tengo la lista pero no las tasas».

Lo que **no** cambia, y se prueba: `expectedTotal`, `expectedUnitPrice` y todo
el cuerpo del `POST /api/orders` no cambian ni un carácter (C13, § Fuera 3 de
la spec). Los campos nuevos son de **lectura**. Y no son opcionales: obligar a
cada sitio de construcción a mirarse una vez es lo que hace que una pantalla no
pueda quedarse sin equivalentes en silencio (§ Qué rompe en compilación).

### AD4 — el mecanismo de revelar/ocultar: un atributo en `<html>`, N+1 reglas de CSS generadas por el servidor, y un guion en línea antes del pintado (guion corregido en el ciclo 2)

Es la decisión con más consecuencias, así que va con las cuatro reglas que
tiene que cumplir delante: R11 (mismo cuerpo byte a byte), R12 (el cliente solo
revela), R13 (el defecto del documento enseña **todos**) y R15 (los ocultos
salen del árbol de accesibilidad).

**Las tres piezas:**

1. **Cada equivalente lleva `data-equiv="<CÓDIGO>"`** en el elemento que tiene
   que desaparecer **entero**, con su marca de aproximado y su texto para
   lector de pantalla dentro. Lo pinta el servidor. Sin más atributos: ni
   `hidden`, ni `class="hidden"`, ni `aria-hidden` — eso sería ocultar en el
   HTML servido y rompe R13.
2. **El servidor emite un `<style>` con N+1 reglas**, una por moneda de
   `selectableCurrencies` más la del centinela, **una vez por página** (no por
   producto), en `src/app/[slug]/layout.tsx`, con la misma técnica que el
   `<style>` del tema que ya hay en la línea 74. Con DH5, N es el número de
   monedas **ofrecidas**: una regla para una moneda sin tasa sería CSS muerto,
   porque ningún elemento lleva ese `data-equiv` y el guion nunca escribe ese
   valor en el atributo.

   ```css
   [data-ref-currency="USD"] [data-equiv]:not([data-equiv="USD"]) {
     display: none;
   }
   [data-ref-currency="MLC"] [data-equiv]:not([data-equiv="MLC"]) {
     display: none;
   }
   [data-ref-currency="none"] [data-equiv] {
     display: none;
   }
   ```

3. **`data-ref-currency` lo pone el cliente en `<html>`**, y nadie más. El
   documento servido **no lo lleva**, así que ninguna regla casa y se ven
   todos: R13 sale del defecto del documento, no de una clase.

**Por qué `:not()` y no «ocultar todos y revelar el elegido».** La forma
ingenua —una regla que oculta `[data-equiv]` y otra que revela el elegido con
`display: revert`— le quita al diseñador el control del `display` del elemento
visible: `revert` descarta las declaraciones de autor y volvería al valor del
agente de usuario, rompiendo cualquier `flex`/`grid` que él ponga. Con `:not()`
el elemento visible **nunca** recibe una declaración de `display`, así que el
diseñador maqueta con libertad. Coste: 76 bytes por regla en vez de ~45.

**Por qué un guion en línea y no un efecto de la isla.** Sin él, la primera
pintura enseña los N equivalentes y colapsan a uno al hidratar: destello y
salto de maquetación en cada carga completa. El guion va como **primer hijo**
del `div` de la tienda, así que corre mientras el navegador aún está leyendo el
HTML, **antes** de que exista una sola tarjeta. Cero destello, cero reflujo.

El texto exacto, medido en **377 bytes**, constante literal sin ninguna
interpolación (los datos por tienda viajan en atributos que React escapa, así
que no hay superficie de inyección):

```js
(function () {
  var d = document,
    r = d.documentElement,
    e = d.currentScript.parentElement,
    c = (e.getAttribute("data-ref-choices") || "").split(" "),
    v = null;
  try {
    v = localStorage.getItem("qab.reference-currency.v1");
  } catch (_) {}
  if (v !== "none" && !/^[A-Z]{3}$/.test(v || "")) v = e.getAttribute("data-ref-default");
  else if (v !== "none" && c.indexOf(v) < 0) v = "none";
  r.setAttribute("data-ref-currency", v || "none");
})();
```

**Corrección respecto de la versión anterior de este documento, y es un
arreglo, no un retoque.** El guion de 324 bytes tenía **una** condición y
mandaba a `data-ref-default` cualquier valor que no estuviera en la lista, o sea
también un código válido que esta tienda no ofrece — donde E17 pide el
centinela. Comprobado ejecutando las dos versiones en jsdom con
`data-ref-choices="USD MLC"` y `EUR` guardado: la vieja escribía `USD`, la nueva
escribe `none`. La prosa de este documento afirmaba lo segundo mientras el
código hacía lo primero, y DH5 convierte ese camino en el habitual: es lo que
pasa cuando la tasa de la moneda elegida caduca. Los 53 bytes de más son la
comprobación de forma que separa «basura guardada» de «código válido que aquí
no se ofrece».

Las cinco ramas, que son las cinco reglas de la spec en un solo sitio, y están
ejercitadas una por una (§ intro, punto 4):

| `localStorage`                 | Atributo que escribe | Regla                                                  |
| ------------------------------ | -------------------- | ------------------------------------------------------ |
| vacío                          | `data-ref-default`   | SP1(a): la primera ofrecida                            |
| `"USD"`, y se ofrece           | `USD`                | DH1/DH2: lo que el comprador eligió                    |
| `"none"`                       | `none`               | SP1(a): «solo la moneda base»                          |
| `"EUR"`, no se ofrece          | `none`               | E17 y DH5 con la tasa caducada                         |
| `'{"a":1}'` o cualquier basura | `data-ref-default`   | R17: se trata como «sin preferencia» y **no** se borra |

Y el `try` sigue cubriendo la navegación privada y la cuota llena (R17): si
`getItem` lanza, `v` se queda en `null` y cae por la primera rama.

**El atributo va en `<html>`, y eso obliga a `suppressHydrationWarning`.** Un
atributo que un guion añade antes de hidratar a un elemento que React sí
renderiza provoca el aviso «Extra attributes from the server», que se imprime
con `console.error` — y una línea de `console.error` es exactamente lo que pone
roja una etapa que captura la salida del servidor (AGENTS.md § Cosas que
muerden, ficha `.agent/playbook/console-error-dispara-guardian-servidor.md`).
`document.documentElement` con `suppressHydrationWarning` en el `<html>` de
`src/app/layout.tsx` es el patrón conocido para esto, y es una sola propiedad.

**Dos atributos más, en el `div` de la tienda de `src/app/[slug]/layout.tsx`**
(el que ya lleva `data-store`), y **solo** cuando `selectableCurrencies`
devuelve algo: `data-ref-choices="USD MLC"` —el conjunto **ofrecido** de DH5,
que es contra lo que el guion valida— y `data-ref-default="USD"`, que es su
primer elemento (SP1(a)). Con lista vacía, con lista que solo trae la base, o
con ninguna moneda de tasa utilizable, no se emiten ni ellos, ni el `<style>`,
ni el guion, ni el selector: el HTML es **idéntico** al de hoy, que es C9
literal.

Con DH5 el atributo cambia de contenido pero **no** de contrato, y por eso el
mecanismo lo absorbe: el guion no sabe ni le importa por qué una moneda está o
no está en la lista, solo comprueba pertenencia. Lo que antes era un caso límite
—elegiste algo que aquí no hay— es ahora el comportamiento correcto de un
escenario normal.

**Lo que este atributo obliga, y la versión anterior no decía:** para calcular
`selectableCurrencies` el layout necesita las **tasas**, y hoy no las lee. Ya
era cierto con `data-ref-default` (SP1(a) siempre fue «la primera calculable»),
así que no es una consecuencia de DH5 sino un hueco de la versión anterior. Va
resuelto y cuantificado en § Escalabilidad, primera tabla: una llamada a
`getStoreRates(resolution)` en el layout, con la **misma** clave de caché y el
**mismo** tag que la que ya hacen las páginas.

**La asimetría con carrito y checkout, y su razón.** Ahí **no** hay CSS ni
equivalentes ocultos: las dos pantallas son islas que sin JavaScript no pintan
importes (E15 lo dice: siguen diciendo «necesitas activar JavaScript»,
`src/features/cart/components/CartView.tsx:115-122`), así que el cliente
calcula el equivalente de la moneda elegida y pinta **uno**. No hay nada que
revelar porque no hay nada servido que ocultar. Es más barato en bytes y no
introduce una segunda forma del mismo mecanismo en el mismo feature.

### AD5 — la lectura de `displayCurrencies` entra en el `select` de la línea 139, y no añade ninguna consulta

En `src/features/catalog/server/queries.ts`, la línea **139** es hoy
`business: { select: { baseCurrencyCode: true } },` y pasa a
`business: { select: { baseCurrencyCode: true, displayCurrencies: true } },`.
Es una columna más de un `findUnique` que ya se hace: **cero** round-trips
nuevos, cero `JOIN` nuevos (la relación ya está en el `select`), y sigue dentro
de la misma entrada de `unstable_cache` con el mismo tag `storeTag`. Las cinco
páginas públicas mantienen exactamente el mismo número de consultas por
petición que hoy.

`StoreSummary` (L46-81) gana `displayCurrencies: readonly string[]` y
`loadStore` (L117-186) lo devuelve en el objeto de la L178.

### AD6 — el memo de `Intl` vive en `src/lib/money.ts` y está acotado a 64 entradas

`formatWithIntl` (`src/lib/money.ts:173-192`) construye **un
`Intl.NumberFormat` por importe formateado**, y su rama de respaldo construye
**dos** (el que lanza y el plano). Hoy eso son 24-48 construcciones por
renderizado de catálogo; con M equivalentes serían 24 × (1 + M), o **984** en
el caso de las 40 monedas de SP2. La mitigación que la spec le encarga al
arquitecto:

```ts
const FORMATTERS = new Map<string, Intl.NumberFormat | null>();
/** `null` = el runtime no conoce esa moneda -> rama de respaldo, memoizada
 *  también, bajo una clave con la moneda vacía. */
function formatterFor(locale: string, currency: string, min: number, max: number) { … }
```

Clave `${locale}|${currency}|${min}|${max}`; el fallo del constructor se
memoiza como `null` para que una moneda desconocida no vuelva a costar dos
construcciones **por importe**. Acotado con
`CURRENCY_FORMATTER_CACHE_MAX = 64` en src/constants/currency.ts (por crear):
por encima de eso se sigue formateando bien, sin memoizar. El tope existe por
una razón concreta y no por prudencia decorativa: los códigos entran por el
sync validados solo como tres letras mayúsculas, o sea 17 576 posibles, y un
mapa sin tope es memoria que crece con lo que el POS decida mandar en un
proceso de vida larga. 64 cubre cualquier tienda real con holgura.

Es un cambio **sin efecto observable en la salida**, y por eso se prueba
contando construcciones (§ Pruebas): 100 llamadas con la misma moneda ⇒ **1**
construcción.

### AD7 — R18/R19: `handleBusiness` gana un cuarto parámetro, el memo ya está creado, y no hace falta ningún tag nuevo

**La firma**, con el memo **al final**, que es donde lo llevan las dos que ya
lo reciben (`handleCurrency`, `handleExchangeRate`, tercero y último en las
dos):

```ts
export async function handleBusiness(
  payload: BusinessPayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
  businessId: string,
  renderableBranches: RenderableBranchLookup,
): Promise<HandlerOutcome>;
```

**El único cambio del cuerpo** es la última línea de
`src/features/sync/server/handlers/business.ts` (hoy L88):

```ts
// R18: se invalida lo que se ESCRIBIÓ. Un `stale` vuelve aquí sin haber
// llamado nunca a la clausura -> cero consultas y cero invalidación, igual
// que el `return SKIPPED` del CUP de handleExchangeRate
// (handlers/misc.ts:197-198). Los dos `throw` de arriba salen antes todavía.
return written.count === 0 ? STALE : outcomeOf(await renderableBranches(businessId));
```

**Cómo llega el memo.** No hay que crear nada:
`src/features/sync/server/processBatch.ts` ya lo construye **una vez por lote**
en la línea 49 (`createRenderableBranchLookup()`) y ya lo pasa a `applyEvent`
como tercer parámetro (L95, `applyEvent` en L160). El `case "BUSINESS"` —hoy el
único de los seis que no lo reenvía— pasa a:

```ts
case "BUSINESS":
  return handleBusiness(event.payload, event.operation, businessId, renderableBranches);
```

Una línea. Y el memo es una **clausura**, no `cache()` de React, que en un
route handler sería un no-op silencioso e inobservable por test
(ficha `.agent/playbook/cache-de-react-es-un-no-op-en-un-route-handler.md`).

**Por qué no hace falta ningún tag ni entrada de caché nueva.** El lector nuevo
no vive en una lectura nueva: vive **dentro de `StoreSummary`**, que es lo que
devuelve `getStoreBySlug` (`src/features/catalog/server/queries.ts:188`),
cacheado con `storeTag(canonicalSlug)` (L188-195). `revalidateStores`
(`src/lib/cache.ts:86-93`) ya expira `storeTag` y `storeCatalogTag` de cada
slug canónico que le llegue, y `processBatch.ts` ya funde `touchedStoreSlugs`
en el mismo `Set` que alimenta esa llamada (comentario de
`src/features/sync/server/handlers/types.ts:16-31`). O sea: la lista nueva llega
por el conducto que F-026 y F-035 ya dejaron abierto. Ningún tag nuevo, ninguna
entrada de caché nueva, y **ningún `export const revalidate` se toca** — son
literales a propósito (ficha `.agent/playbook/revalidate-no-literal.md`).

Y lo que **está prohibido y no se hace**: armar el array de slugs a mano. El
conjunto sale de `createRenderableBranchLookup`
(`src/features/sync/server/businessBranches.ts:64`), que delega en
`expandBrandRevalidation`; un `.map()` propio no compilaría en
`touchedSlugValues` y aquí, además, sería la tercera instancia del fallo que
ficha `revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado`.

### AD8 — `outcomeOf` se **comparte**, y se muda a `src/features/sync/server/handlers/types.ts`

Hoy es una función privada de tres líneas en
`src/features/sync/server/handlers/misc.ts:51-53`. **Se mueve a
`src/features/sync/server/handlers/types.ts`** y la importan `misc.ts` y
`business.ts`.

Por qué mudarla y no exportarla desde `misc.ts`: `types.ts` ya exporta
`HandlerOutcome`, `PROCESSED`, `SKIPPED` y `STALE`, y ya importa `PublicSlug`.
`outcomeOf` **es el constructor de ese tipo**, y el invariante que sostiene
—«conjunto vacío ⇒ el campo `touchedStoreSlugs` **no** aparece», del que
depende que un negocio sin sucursales renderizables no invalide nada (criterio
5 de F-035)— pertenece al archivo que declara el campo como opcional.
Duplicarla en tres líneas dejaría dos sitios donde ese invariante puede
divergir, y divergiría en silencio: `processBatch.ts` no distingue «campo
ausente» de «campo con array vacío» hasta que cuenta invalidaciones.
Importarla de `misc.ts` haría que `business.ts` dependa de un módulo lleno de
Prisma y de handlers que no le tocan.

Detalle de aseo que hay que mirar al mover: `misc.ts` importa
`type PublicSlug` (L3) y `outcomeOf` es su único uso anotado; si al quitarla el
`import type` queda sin usar, hay que retirarlo o `@typescript-eslint/no-unused-vars`
lo marca como **error** (AGENTS.md § Prohibiciones).

### AD9 — la clave de `localStorage` es `qab.reference-currency.v1`, en src/constants/currency.ts (por crear), y guarda una cadena pelada

```ts
/** R17: del COMPRADOR, no de la tienda — sin sufijo de `Store.id`, al
 *  contrario que el carrito (`CART_STORAGE_KEY_PREFIX`,
 *  `src/constants/cart.ts:14`). Valor: un código de tres letras mayúsculas,
 *  o REFERENCE_CURRENCY_NONE. Nunca JSON: no hay nada que envolver, y la
 *  versión ya va en la clave, igual que en el carrito. */
export const REFERENCE_CURRENCY_STORAGE_KEY = "qab.reference-currency.v1";

/** SP1(a), la opción explícita «solo la moneda base». En minúsculas a
 *  propósito: no puede colisionar con un código, que CURRENCY_CODE_PATTERN
 *  fuerza a mayúsculas. */
export const REFERENCE_CURRENCY_NONE = "none";
```

El archivo es **nuevo** y no `src/constants/catalog.ts`: la preferencia también
gobierna carrito y checkout, así que no es del catálogo; y `src/constants/` ya
tiene un archivo por dominio. Ahí van además los cuatro nombres de atributo
(`data-ref-currency`, `data-equiv`, `data-ref-choices`, `data-ref-default`),
`CURRENCY_CODE_PATTERN` (AD2) y `CURRENCY_FORMATTER_CACHE_MAX` (AD6) — ninguno
de los seis puede quedar como literal suelto en dos archivos.

**Lectura tolerante (R17):** un valor que no case `CURRENCY_CODE_PATTERN` y no
sea el centinela se trata como «sin preferencia», no se borra y no lanza. La
misma disciplina de `src/features/cart/cartStorage.ts:24-38`, incluido el
respaldo en memoria cuando `localStorage` no está: la elección vale para la
sesión y nada falla.

### AD10 — R22: la entrada de caché vieja se tolera en el borde de lectura, con un tipo, no con un `if` defensivo

Una entrada de `unstable_cache` escrita antes de este feature **no tiene** el
campo: las entradas viven en la caché de datos indexadas por `keyParts` y
argumentos, no por versión del código, así que el primer renderizado después de
despegar puede leer perfectamente una entrada con la forma vieja, y el suelo de
3600 s (`src/app/[slug]/layout.tsx:19`) puede tardar una hora en barrerla. Sin
esto, `store.displayCurrencies` sería `undefined` y
`equivalentCurrencies(undefined, …)` reventaría la página entera de la tienda:
la peor forma de fallar de todo el feature, en producción y solo tras un
despliegue.

La normalización va en `getStoreBySlug`
(`src/features/catalog/server/queries.ts:188`), que ya es el sitio donde el
objeto cacheado se completa con `canonicalSlug`:

```ts
/** R22: una entrada escrita antes de F-039 no trae el campo. Tipado, no
 *  un `??` defensivo sobre algo que el compilador cree no-nulo. */
type CachedStore = Omit<StoreSummaryWithoutCanonical, "displayCurrencies"> & {
  displayCurrencies?: readonly string[];
};
```

y el `.then` mapea `displayCurrencies: store.displayCurrencies ?? []`. Con el
tipo, el `??` es **necesario** para compilar y dice la verdad; sin él sería una
guarda sobre un valor que el tipo jura que existe, o sea la clase de línea que
alguien borra en un aseo. Y `[]` es exactamente el estado del criterio 9, que
`.agent/specs/F-038/architecture.md` AD1 ya declaró indistinguible de «nunca
llegó un `BUSINESS`».

## Componentes

| Componente                            | Capa                       | Responsabilidad                                                                                                                                                              | Archivo                                                                  |
| ------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `priceEquivalents` y sus dos hermanas | `src/lib/`                 | AD1. Los equivalentes de un importe (por producto) y el conjunto que el selector ofrece (por negocio, DH5), cuyo primer elemento es SP1(a). Pura                             | src/lib/priceEquivalents.ts (por crear)                                  |
| Constantes de moneda                  | `src/constants/`           | AD2, AD9, AD6. La clave de `localStorage`, el centinela, los cuatro atributos, el patrón del código y el tope del memo                                                       | src/constants/currency.ts (por crear)                                    |
| Generador del CSS y guion de arranque | `src/features/currency/`   | AD4. `renderReferenceCurrencyCss(codes)` sobre el conjunto ofrecido y la constante del guion (377 B). Texto, puro, **solo servidor** (no entra en el bundle)                 | src/features/currency/reveal.ts (por crear)                              |
| Estado de la preferencia              | `src/features/currency/`   | AD9. `useSyncExternalStore` sobre `localStorage` + evento `storage`; `getServerSnapshot` = «sin hidratar». Único escritor del atributo tras el arranque                      | src/features/currency/referenceCurrencyStore.ts (por crear)              |
| Selector de la cabecera               | `src/features/currency/`   | DH2, DH5. Isla de cliente; **nada** en el HTML servido (R13); opciones = `selectableCurrencies` + «solo la moneda base», nunca una moneda sin tasa utilizable                | src/features/currency/components/ReferenceCurrencySelect.tsx (por crear) |
| Tarjeta de producto                   | `src/components/store/`    | Pinta los equivalentes con `data-equiv`. Sigue siendo **componente de servidor**                                                                                             | `src/components/store/ProductCard.tsx`                                   |
| Ficha de producto                     | `src/app/`                 | Lo mismo para el importe grande. El botón de agregar no cambia                                                                                                               | `src/app/[slug]/p/[productSlug]/page.tsx`                                |
| Cabecera de la tienda                 | `src/app/`                 | Monta el `<style>`, el guion, los dos atributos y el selector — los cuatro **solo** si `selectableCurrencies` devuelve algo. Es el sitio que lee las tasas (§ Escalabilidad) | `src/app/[slug]/layout.tsx`                                              |
| Raíz del documento                    | `src/app/`                 | `suppressHydrationWarning` en el `<html>` (AD4)                                                                                                                              | `src/app/layout.tsx`                                                     |
| Lectura de la tienda                  | `features/catalog/server/` | AD5, AD10. Una columna más en el `select` de la L139; `StoreSummary` gana el campo; `getStoreBySlug` normaliza                                                               | `src/features/catalog/server/queries.ts`                                 |
| Memo de formateadores                 | `src/lib/`                 | AD6. Un `Intl.NumberFormat` por (locale, moneda, dígitos), tope 64                                                                                                           | `src/lib/money.ts`                                                       |
| Cotización                            | `features/orders/server/`  | AD3. `select` con una columna más; `toQuoteResponse` publica `rates` y `displayCurrencies`                                                                                   | `src/features/orders/server/quote.ts`                                    |
| Tipos del cable                       | `features/orders/`         | AD3. `QuoteStore.displayCurrencies`, `QuoteResponse.rates`                                                                                                                   | `src/features/orders/types.ts`                                           |
| Carrito                               | `features/cart/`           | DH3. Equivalente del subtotal + aviso del cobro                                                                                                                              | `src/features/cart/components/CartView.tsx`                              |
| Checkout                              | `features/cart/`           | DH3. Equivalente del total y del total parcial + aviso. `expectedTotal` intacto                                                                                              | `src/features/cart/components/CheckoutForm.tsx`                          |
| Handler de `BUSINESS`                 | `features/sync/server/`    | AD7. Cuarto parámetro y `outcomeOf` en el camino escrito                                                                                                                     | `src/features/sync/server/handlers/business.ts`                          |
| Constructor del `HandlerOutcome`      | `features/sync/server/`    | AD8. `outcomeOf` mudado aquí, importado por dos handlers                                                                                                                     | `src/features/sync/server/handlers/types.ts`                             |
| Reparto del lote                      | `features/sync/server/`    | AD7. El `case "BUSINESS"` reenvía el memo. Una línea                                                                                                                         | `src/features/sync/server/processBatch.ts`                               |
| Patrón compartido                     | `features/sync/`           | AD2. Importa `CURRENCY_CODE_PATTERN` en vez de declararlo                                                                                                                    | `src/features/sync/displayCurrencies.ts`                                 |

**Por qué una carpeta `src/features/currency/` nueva** y no `features/catalog/`
ni `components/store/`: la preferencia cruza catálogo, ficha, carrito y
checkout, así que ponerla en cualquiera de esos dominios obliga a los otros a
importar de él. Y `src/components/store/` no tiene hoy **ni un**
`"use client"` (comprobado): meterle la primera isla borraría una propiedad
que hoy se lee de un `head -3`. El precedente exacto es
`src/features/cart/components/CartBadge.tsx`, la otra isla de la cabecera.

## Flujo de datos

**Catálogo y ficha (servidor, cacheado, sin JavaScript de por medio):**

```
BUSINESS (sync)              EXCHANGE_RATE (sync)
      |                              |
      v                              v
Business.displayCurrencies     ExchangeRate (append-only)
      |                              |
      | loadStore, select L139       | loadCurrentRates (ADR 0030)
      v                              v
StoreSummary.displayCurrencies   getStoreRates -> RateTable
      \                             /
       \                           /
        v                         v
   ProductCard / ficha:  resolvePrice(...).price  ->  el PRINCIPAL (base, R3)
                                  |
                                  | priceEquivalents(price, declaradas, base, rates)
                                  v
                    Money[] en orden de la lista, incalculables ya omitidos
                                  |
                                  v
              un elemento con data-equiv="XXX" por cada uno, TODOS visibles
```

Y en la cabecera, con las **mismas** dos entradas y una sola función más:

```
StoreSummary.displayCurrencies + RateTable (getStoreRates, misma clave y tag)
                                  |
                                  | selectableCurrencies(declaradas, base, rates)
                                  v
        los códigos OFRECIDOS (DH5)  ->  data-ref-choices
                 su primer elemento  ->  data-ref-default (SP1(a))
                     el mismo conjunto ->  las N+1 reglas del <style>
                     el mismo conjunto ->  las opciones del selector
                                  |
                        conjunto vacío -> nada de lo anterior se emite (C9)
```

**En el navegador (nada de esto llega al servidor, R11):**

```
carga completa
   |
   v
guion en línea (primer hijo del div de la tienda, 377 B)
   |  lee qab.reference-currency.v1
   |  sin preferencia, o basura      ->  data-ref-default (SP1(a), R17)
   |  un código que aquí no se ofrece ->  none (E17, DH5)
   |  un código ofrecido, o none      ->  tal cual
   v
<html data-ref-currency="USD">     ANTES de que exista la primera tarjeta
   |
   v
el <style> de la cabecera oculta [data-equiv]:not([data-equiv="USD"])
   |
   v
hidratación: el selector aparece (no estaba en el HTML servido, R13)
   |
   | el comprador elige  ->  referenceCurrencyStore: escribe localStorage,
   |                         notifica, y su efecto reescribe el atributo
   v
CSS reevalúa. Cero peticiones, cero cuerpos distintos, cero URLs nuevas
```

**Carrito y checkout:**

```
POST /api/orders/quote  ->  quoteCart  ->  CartQuote { subtotal, rates, store }
                                                |  toQuoteResponse
                                                v
                        QuoteResponse { subtotal, rates, store.displayCurrencies }
                                                |
                       priceEquivalents(money(subtotal, currencyCode), ...)
                                                |  .find(e => e.currency === elegida)
                                                v
                     UN equivalente + la frase del cobro (DH3, R16)
```

**La invalidación (R18, el conducto que ya existe):**

```
BUSINESS escribe  ->  outcomeOf(await renderableBranches(businessId))
                             |  memo por LOTE (una consulta por negocio)
                             v
                     touchedStoreSlugs
                             |  processBatch funde en el Set que ya había
                             v
                     revalidateStores  ->  storeTag + storeCatalogTag
                             |
                             v
   la primera visita posterior a cada sucursal renderizable relee loadStore
   (y con él displayCurrencies) sin esperar el suelo de 3600 s
```

`stale`, `BUSINESS_DELETE_NOT_SUPPORTED` y
`BUSINESS_DISPLAY_CURRENCIES_INVALID` salen **antes** de llamar a la clausura:
cero consultas y cero invalidación.

## Contratos

### El módulo puro (src/lib/priceEquivalents.ts, por crear)

Las tres firmas están en AD1. Sin Zod: es lógica pura sobre tipos que ya
existen (`Money`, `RateTable`, `src/lib/money.ts:21-28`). No hay endpoint nuevo
ni error nuevo que tabular — la única condición de error es `MoneyError`, y su
tratamiento es «omitir ese equivalente» (R5).

### El cable de la cotización (`src/features/orders/types.ts`)

```ts
export type QuoteStore = {
  … // sin cambios
  /** F-039 AD3: la lista declarada TAL CUAL (R1), sin podar. `[]` es lo
   *  normal en un negocio que nunca emitió un BUSINESS. */
  displayCurrencies: string[];
};

export type QuoteResponse = {
  … // sin cambios
  /** F-039 AD3: las MISMAS tasas con las que se calculó `subtotal`, del
   *  mismo `CartQuote` y el mismo `capturedAt`. Publicarlas es lo que hace
   *  que el equivalente sea una función del total y no de otra lectura. */
  rates: Record<string, string>;
};
```

No hay esquema Zod que mover: `src/features/orders/schemas.ts` valida
**peticiones** (`satisfies z.ZodType<QuoteRequestBody>`, etc.), nunca esta
respuesta. Y la respuesta va con `no-store`
(`src/app/api/orders/quote/route.ts:38`), así que no existe una versión
cacheada de la forma vieja: aquí no aplica nada parecido a R22.

### El contrato con cuadrecaja

**Cero cambios.** `docs/sync-contract.md` no se toca y **su versión no se
mueve** (I5 de la spec): la regla que este feature implementa ya está publicada
en la v12/v12.1, y la v12.2 retiró el aviso al cerrar F-038. Ningún campo,
error ni entidad nuevos.

### El CSS generado y sus dos atributos (src/features/currency/reveal.ts, por crear)

```ts
/** N+1 reglas (AD4): una por moneda OFRECIDA (`selectableCurrencies`, DH5),
 *  mas la del centinela. Cadena VACÍA cuando no hay ninguna — C9 exige que
 *  no aparezca ni el `<style>`. 76 bytes por regla, medidos. */
export function renderReferenceCurrencyCss(codes: readonly string[]): string;

/** El guion de AD4, constante literal, 377 bytes, sin interpolación. */
export const REFERENCE_CURRENCY_BOOT_SCRIPT: string;
```

| Atributo            | Dónde                 | Valor                                        | Quién lo escribe              |
| ------------------- | --------------------- | -------------------------------------------- | ----------------------------- |
| `data-equiv`        | Cada equivalente      | El código, tres letras                       | Servidor                      |
| `data-ref-choices`  | El `div` de la tienda | Los códigos OFRECIDOS, separados por espacio | Servidor, solo si hay alguno  |
| `data-ref-default`  | El `div` de la tienda | El primero de los ofrecidos (SP1(a))         | Servidor, solo si hay alguno  |
| `data-ref-currency` | `<html>`              | Un código, o `none`                          | **Solo** el cliente (R12/R13) |

### La tabla de errores

No hay ninguno nuevo. Los tres estados que este feature puede producir, todos
ya existentes: un equivalente que no se puede calcular **se omite** (R5); un
producto sin precio resoluble sigue diciendo «Consultar» (E9,
`src/components/store/ProductCard.tsx:91-106`); una preferencia guardada
ilegible se trata como «sin preferencia» (R17). Ninguno es un 500 y ninguno
sube al usuario.

## Modelo de datos y migraciones

**Ninguna migración, ninguna columna, ningún índice.** `Business.displayCurrencies`
(`prisma/schema.prisma:147`) y `displayCurrenciesSourceUpdatedAt` ya existen
desde F-038, con `String[] @default([])`. Este feature es **el lector**.
`prisma/schema.prisma` no se toca, así que ninguno de los dos comandos que
AGENTS.md marca como prohibidos aparece por aquí ni de lejos.

Lo único con sabor a dato: la fila del `select` de AD5, que es una columna de
una consulta que ya se hace.

**Precondición para probar, no para desplegar** (I3 de la spec): `npm run seed`
**no** escribe `displayCurrencies`, y el humo de F-038 dejó `seed-negocio-1`
con `["CUP","USD","MLC"]` a propósito. El criterio 9 necesita un negocio con
lista vacía: `seed-negocio-2`, o vaciar la lista con
`node scripts/send-catalog-batch.mjs --business` antes de medir. Va en el guion
de humo, no en `docs/despliegue.md`: no hay paso operativo nuevo —ni secreto,
ni cron, ni regla de plataforma, ni migración que revisar a mano—, así que ese
documento no se mueve.

## Escalabilidad y límites

La mitad que se falsea. Cada número con cómo se obtuvo.

### Consultas: ninguna lectura nueva de datos, una llamada nueva a una lectura que ya existe

| Página             | Round-trips hoy                                        | Con F-039  |
| ------------------ | ------------------------------------------------------ | ---------- |
| `/[slug]`          | `getStoreBySlug` + `getStoreCatalog` + `getStoreRates` | Los mismos |
| `/[slug]/c/[…]`    | Idem + categorías                                      | Los mismos |
| `/[slug]/catalogo` | Idem                                                   | Los mismos |
| `/[slug]/buscar`   | Idem + búsqueda                                        | Los mismos |
| `/[slug]/p/[…]`    | Idem                                                   | Los mismos |
| `/[slug]/carrito`  | `requireStore` + `quoteCart` (3 consultas en paralelo) | Los mismos |

La lista viaja en el `select` de la línea 139 y en el de
`src/features/orders/server/quote.ts:128`, los dos ya existentes. No hay N+1
que crear porque no hay ninguna lectura por producto: la lista es del negocio y
las tasas se leen una vez por página.

**La excepción, dicha en voz alta:** `src/app/[slug]/layout.tsx` gana una
llamada a `getStoreRates(resolution)`, porque sin las tasas no puede calcular
`selectableCurrencies` y por tanto no puede decidir ni las opciones del
selector, ni `data-ref-choices`, ni `data-ref-default`, ni qué reglas de CSS
emitir. **No es un dato nuevo ni una consulta nueva**, y esto es lo que hay que
comprobar antes de darlo por bueno: `getStoreRates`
(`src/features/catalog/server/queries.ts:417-422`) es
`cached(loadCurrentRates, { keyParts: ["store-rates"], tags: [storeTag(...)] })`
invocada con `businessId`, así que la clave de caché del layout es **idéntica**
a la de la página —mismos `keyParts`, mismo argumento— y el tag también. Cero
entradas de caché nuevas, cero tags nuevos, cero invalidaciones nuevas: es la
entrada compartida por negocio que el comentario de la L405-417 ya describe.

El único coste posible es un `$queryRaw` de más **en un renderizado frío**, si
el layout y la página fallan la caché de datos por separado en el mismo pase; en
régimen, con la entrada escrita, es cero. Se puede confirmar de un tirón cuando
se mida el criterio 10 (contando las consultas de un `curl` frío contra un
`curl` caliente). Y si alguien quisiera evitar incluso eso, la salida **no** es
mover el selector a las páginas —eso rompe DH2— sino aceptar el frío: no hay
tercera opción, porque el layout no puede recibir props de sus hijos.

Dos alternativas que descarté por si vuelven: derivar las opciones en el
cliente contando los `[data-equiv]` del DOM —imposible, el guion de arranque
corre **antes** de que exista la primera tarjeta, y en carrito y checkout no hay
ninguno— y dejar `data-ref-choices` con la lista declarada sin podar —daría los
mismos píxeles, porque una moneda sin tasa acaba igualmente sin nada que
revelar, pero deja el **selector** ofreciéndola, que es exactamente lo que DH5
prohíbe—.

### Formateadores `Intl` por renderizado (R21 y el caso de las 40 monedas)

| Escenario                       | Hoy       | Sin memo  | Con el memo de AD6 |
| ------------------------------- | --------- | --------- | ------------------ |
| 24 tarjetas, 0 equivalentes     | 24        | 24        | **1**              |
| 24 tarjetas, 2 equivalentes     | 24        | 72        | **3**              |
| 24 tarjetas, 40 equivalentes    | 24        | 984       | **41**             |
| Una moneda que `Intl` no conoce | 2/importe | 2/importe | **2 una vez**      |

Con el memo, las construcciones por página dejan de depender del número de
productos y pasan a ser el número de **pares (moneda, modo de dígitos)
distintos de la página**: M+1 en el peor caso, más uno o dos de los chips
enteros de F-027. Eso convierte «se construyen N×M formateadores» —el coste que
la spec señala como el real de `formatMoney`— en un techo constante por moneda.
Con 24 tarjetas y 40 monedas, de 984 a 41.

Lo que queda creciendo con M sin techo posible son las **conversiones**: 24 × M
llamadas a `convert`, aritmética de `BigInt` con una división cada una, del
orden de microsegundos. 960 conversiones ≈ 1-3 ms de CPU en el renderizado de
un ISR que se hace una vez por revalidación. No es el cuello.

### Bytes del HTML, por producto y por moneda

Medidos con gzip real sobre markup con importes **distintos** por tarjeta:

| Equivalentes por tarjeta | Crudo (24 tarjetas) | Gzip     |
| ------------------------ | ------------------- | -------- |
| 1                        | 2,9 KB              | +0,26 KB |
| 2                        | 5,7 KB              | +0,43 KB |
| 3                        | 8,6 KB              | +0,60 KB |
| 40 (SP2, sin tope)       | 114,3 KB            | +6,3 KB  |

**DH5 no cambia ninguna de estas cifras**, y conviene decirlo para que nadie
espere un ahorro que no llega: la columna es «equivalentes **por tarjeta**», o
sea los que se **pintan**, y esos ya eran solo los calculables desde R5. Lo que
DH5 poda son las **opciones del selector**, que no ocupan bytes por producto.
La única diferencia medible es a la baja y es pequeña: el `<style>` genera una
regla menos (76 bytes) por cada moneda declarada sin tasa. El peor caso sigue
siendo el negocio que declara 40 monedas **y** tiene tasa vigente de todas.

Por (producto, moneda) son ~118 bytes en crudo con la forma que estimé
—elemento, `data-equiv`, el importe formateado y una marca de aproximado—, de
los cuales el mecanismo **obliga** a ~30 (el elemento y su atributo) y el resto
lo decide el diseñador. Más, una vez por página: el `<style>` (205 bytes con
dos monedas ofrecidas, 3,1 KB crudo / 0,29 KB gzip con 40) y el guion (377 bytes).

**Qué se rompe primero al multiplicar por 100.** No el JavaScript, no las
consultas y no la CPU: **el HTML de un negocio que declare decenas de monedas**.
La referencia que hay medida en este repo es 3,4 KB gzip de HTML en la página
más pesada por JavaScript (`.agent/specs/F-021/tests.md:452`), así que con dos
o tres monedas —lo real— el HTML crece de forma imperceptible, y con 40 el
crecimiento es del orden de duplicarlo o más. El umbral, escrito para que nadie
lo decida a ciegas: si C10 mide un HTML gzip que suba por encima de ~2× el de
hoy, la conversación es SP2(b) —un tope por orden de la lista— y es un
**feature nuevo del humano**, no una poda que este ciclo se invente; la regla ①
del contrato prohíbe podar la lista en silencio.

### JavaScript de cliente y qué mide exactamente el criterio 10

Lo que se añade al bundle son **dos** módulos de cliente,
src/features/currency/referenceCurrencyStore.ts (por crear) y
src/features/currency/components/ReferenceCurrencySelect.tsx (por crear), más
el módulo puro de AD1, que entra por el árbol de carrito y checkout. Los tres son pequeños y sin dependencias nuevas: `money.ts` ya estaba
ahí, y el generador de CSS y el texto del guion viven en un módulo que **solo**
importa el servidor, así que no entran. Estimación: **+0,6 a +1,0 KB gzip**
sobre los 182,1 KB medidos de la página más pesada, con un presupuesto de 193
(`scripts/check-bundle-budget.mjs:26`). Queda holgura; si aun así se pasa, se
sube `BUDGET_KB` con la medición en el comentario, nunca en silencio (R21,
AGENTS.md § «El presupuesto de JavaScript no es un muro»).

**Qué mide exactamente el criterio 10**, porque es fácil medir lo que no es:
`npm run check:bundle` imprime **dos** números de **una sola** página, la de
mayor JavaScript (`scripts/check-bundle-budget.mjs:95-97`): `client JS` es la
suma gzip de todos los `<script src>` que esa página referencia, y `HTML` es el
gzip del documento. Tres consecuencias que hay que escribir en
`.agent/progress/F-039.md` junto a las cifras:

1. **El guion en línea de AD4 no aparece en `client JS`.** El guion cuenta los
   `<script src="…">` (L57) y el nuestro es inline: sus 377 bytes se ven en el
   número de **HTML**, no en el de JS. Quien busque el coste del feature en la
   cifra de JS no lo va a encontrar ahí.
2. **La página que mide puede no ser la del catálogo.** Elige la de más
   JavaScript, que en corridas anteriores fue una ficha de producto. Para el
   criterio 10, que habla de «la página de catálogo», hay que anotar además el
   HTML gzip de `/[slug]` a mano (un `curl … | gzip -c | wc -c`), o la cifra
   contestará a otra pregunta.
3. **Hay que medir antes y después con el mismo negocio.** Con
   `seed-negocio-1` en `["CUP","USD","MLC"]` (lo que dejó F-038) el «antes» ya
   no es el estado sin monedas: la comparación honesta es el mismo `slug`, el
   mismo catálogo, con y sin el feature.

Y la mitad del criterio 10 que no es un número: la página **sin JavaScript**
sigue navegable y con **todos** los importes, que es C2 y sale del defecto del
documento (R13).

### El sync

| Escenario del lote                                    | Consultas de sucursales | `revalidateTag` |
| ----------------------------------------------------- | ----------------------- | --------------- |
| 1 `BUSINESS` que escribe, negocio con 1 sucursal      | 1                       | 2               |
| 500 `BUSINESS` del mismo negocio (memo)               | **1**                   | 2               |
| 2 `BUSINESS` de dos negocios distintos                | 2                       | 2 por sucursal  |
| `BUSINESS` `stale`, o fallido por formato o `DELETE`  | **0**                   | **0**           |
| `BUSINESS` de un negocio sin sucursales renderizables | 1                       | **0**           |
| Marca con 50 sucursales renderizables                 | 1                       | 100             |

El camino `processed` pasa de 1 a 2 round-trips **solo en el primer `BUSINESS`
de cada negocio del lote**; el memo hace gratis el resto. La invalidación sigue
siendo **una** llamada deduplicada por familia de tags al final del lote
(`src/features/sync/server/processBatch.ts:132-143`), no una por evento. Lo
primero que se rompería al multiplicar por 100 aquí es la marca con muchísimas
sucursales, que es el techo que F-035 ya aceptó y no algo que este feature
empeore.

## Patrones a seguir / antipatrones a evitar

**A seguir:**

1. **Un solo compositor.** `priceEquivalents` es a los equivalentes lo que
   `resolvePrice` (`src/lib/pricing.ts:59-64`) es al precio mostrado: si las
   cuatro pantallas pasan por ella, no pueden discrepar (R7).
2. **El memo del lote es una clausura**, creada por quien procesa el lote y
   pasada hacia abajo — nunca estado de módulo, nunca `cache()` de React
   (ficha `cache-de-react-es-un-no-op-en-un-route-handler.md`).
3. **La expansión de slugs se delega**, siempre, a
   `src/features/sync/server/businessBranches.ts` (ficha
   `revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md` y
   AGENTS.md § Prohibiciones).
4. **`getServerSnapshot` vacío** para todo lo que dependa del navegador, como
   `src/features/cart/cartStore.ts:83-85` y `:213-215`. Nunca `setState` en un
   `useEffect` (AGENTS.md § Prohibiciones).
5. **`console.warn` con prefijo `[scope]`** si hace falta instrumentar algo de
   servidor; jamás `console.error` (AGENTS.md § Cosas que muerden).

**A evitar, y cada uno con el nombre de lo que rompería:**

1. **Una cookie, un `?moneda=`, o `Vary: Accept-Language`.** Rompe R11 y el
   criterio 3, y multiplica lo que hay que revalidar en cada tasa. Y su forma
   más tentadora —leerla en `src/proxy.ts`— anula el ISR completo (R20, ficha
   `proxy-matcher-anula-isr.md`).
2. **`"use client"` en `src/components/store/ProductCard.tsx`.** Prohibición
   literal de AGENTS.md para cualquier cosa que renderice catálogo, y además
   duplicaría el catálogo en el bundle.
3. **Una segunda división, un `toFixed` o un cociente de tasas.** R9/R10: todo
   pasa por `convert`, que va por el ancla en una sola división. Un par directo
   USD/EUR es el bug de E14.
4. **Un `<noscript><style>` que oculte.** Tentador y equivocado: el defecto ya
   enseña todos, así que ese bloque no añade nada y su versión invertida
   (ocultar por defecto y revelar con JavaScript) rompe R13 de frente.
5. **Un `catch` pelado alrededor de `convert`.** R5 exige atrapar **solo**
   `MoneyError`; los dos `catch` pelados que ya hay se quedan como están y no
   se copian.
6. **Podar la lista declarada** por falta de tasa, por el ancla o por la tabla
   `Currency`. R1/R4/R6, y es el fallo que el arnés de cuadrecaja cazó.
7. **Formatear a ciegas prosa ajena** con `npm run format` (ficha
   `prettier-write-reescribe-prosa-ajena.md`): hay otra sesión escribiendo en
   este árbol.

## Restricciones para el diseñador

Cinco, y solo cinco. Todo lo demás —dónde va el equivalente, cómo se marca el
aproximado, las palabras, la forma del selector, la tipografía— es suyo.

1. **Cada equivalente necesita un elemento propio con `data-equiv="<CÓDIGO>"`,
   y ese elemento tiene que contener TODO lo que debe desaparecer con él**: el
   `≈`, el importe, la palabra «aprox.» y cualquier texto para lector de
   pantalla. Lo que quede fuera se seguirá viendo y se seguirá anunciando
   (R15/C15).
2. **Los equivalentes de un mismo importe van como hermanos, y su contenedor no
   puede depender de cuántos hay visibles.** Entre «sin JavaScript» y «con
   JavaScript» pasan de M a 1: nada de `justify-between` que se descoloque,
   nada de `:nth-child` que numere, nada de separadores puestos con `::before`
   sobre el segundo elemento. Un `gap` de flex o de grid se comporta bien
   —`display: none` saca al elemento del flujo— y es la vía recomendada.
3. **El `display` del elemento visible es tuyo.** El mecanismo no le pone
   ninguna declaración de `display` al elegido (por eso `:not()` y no
   `revert`): puedes usar `inline`, `block`, `flex`, lo que la maqueta pida.
4. **Nada oculto en el HTML servido.** Ni `hidden`, ni `class="hidden"`, ni
   `aria-hidden`, ni `sr-only` sobre un equivalente: el documento servido los
   enseña **todos** (R13, criterio 2) y ocultar es siempre una acción del
   cliente. `aria-hidden` además no haría falta nunca: `display: none` ya saca
   del árbol de accesibilidad.
5. **Con lista vacía no puede aparecer nada nuevo.** Ni el selector, ni un
   contenedor vacío, ni una clase de más, ni un espacio reservado: con `[]` el
   HTML tiene que ser **idéntico** al de hoy (C9). Si tu maqueta necesita un
   hueco para el equivalente, ese hueco solo existe cuando hay al menos uno.

Y una cortesía, no una restricción: el selector no existe en el HTML servido
(aparece al hidratar, como `CartBadge`), así que tiene que poder aparecer sin
mover la cabecera de sitio, o cada carga dará un salto en el sitio donde el
comprador está mirando.

**Lo que DH5 te quita de encima.** La pregunta que abriste —qué frase mostrar
cuando una moneda declarada no tiene tasa— **ya no tiene respuesta que
redactar**: esa moneda no aparece en el selector, así que no hay estado que
explicar, ni texto de «sin tasa», ni opción deshabilitada que justificar. Dos
consecuencias para tu maqueta: el selector nunca ofrece algo que no se pueda
pintar (lo ofrecido y lo pintado son el mismo conjunto, AD1), y la lista de
opciones puede **encogerse o crecer sola** entre dos visitas, cuando una tasa
caduca o llega — así que no la maquetes asumiendo un número fijo de opciones ni
un ancho que dependa de ellas. Lo que sí sigue existiendo es el caso de E9, un
producto cuyo precio no se resuelve: ahí no hay principal ni equivalentes, y la
tarjeta dice «Consultar» como hoy.

## Pruebas: el reparto entre archivos

El punto 7 de § «No decidido a propósito», con el criterio de la spec para cada
fila. `sdd-tester` puede añadir, no quitar.

| Archivo                                                                       | Proyecto | Qué prueba                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Criterios              |
| ----------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| src/lib/priceEquivalents.test.ts (por crear)                                  | node     | La función pura, y **las dos mitades** de «moneda declarada sin tasa»: no se pinta su equivalente (R5) **y** no está en `selectableCurrencies` (DH5). Más: base ausente de la lista; base repetida; lista vacía; código basura descartado; tasa cero y tasa negativa tratadas como ausentes; base sin tasa propia ⇒ conjunto ofrecido vacío; el primero de los ofrecidos es SP1(a); el ancla no se salta (base MLC, producto USD, equivalente EUR) y **no** coincide con el cociente directo | C4, C5, C7             |
| src/components/store/ProductCard.test.tsx (por crear)                         | ui       | **El primer test de este componente**: principal en base + equivalente marcado; el aproximado no es el elemento principal; los N equivalentes presentes y sin nada estático que los oculte; «Consultar» con cero equivalentes; y, con el `<style>` y el atributo puestos, el nombre accesible **no** contiene el de la moneda no elegida                                                                                                                                                     | C1, C2, C9, C15        |
| src/features/currency/reveal.test.ts (por crear)                              | node     | El texto exacto de las N+1 reglas y que se generan del conjunto **ofrecido**, no del declarado (DH5); cadena vacía cuando no hay ninguno; el guion es constante y no interpola nada                                                                                                                                                                                                                                                                                                          | C2, C9                 |
| src/features/currency/referenceCurrencyStore.test.tsx (por crear)             | ui       | La clave y su valor; un valor ilegible se ignora y **no** se borra; `localStorage` caído cae a memoria y nada lanza; una preferencia que esta tienda no ofrece deja ver solo el principal y **sobrevive** en la clave; `getServerSnapshot` = sin hidratar. Y **las cinco ramas del guion de arranque ejecutadas** (tabla de AD4): necesita DOM, y la extensión es lo que decide el entorno                                                                                                   | C3(b), E17, DH5        |
| src/features/currency/components/ReferenceCurrencySelect.test.tsx (por crear) | ui       | DH5 donde se ve: las opciones son el conjunto **ofrecido** más «solo la moneda base», y una moneda declarada sin tasa **no** aparece — ni inerte ni deshabilitada; nada en el HTML servido antes de hidratar (R13)                                                                                                                                                                                                                                                                           | C12, DH5               |
| `src/lib/money.test.ts`                                                       | node     | El memo de AD6: 100 llamadas con la misma moneda ⇒ **una** construcción (`vi.spyOn(Intl, "NumberFormat")`), y la salida formateada no cambia ni un carácter                                                                                                                                                                                                                                                                                                                                  | R21                    |
| `src/lib/boundaries.test.ts`                                                  | node     | La frontera de C3: **ningún** archivo de `src/app/[slug]/`, `src/components/store/` o `src/features/catalog/` importa `next/headers`, y ninguno lee un parámetro de consulta de moneda                                                                                                                                                                                                                                                                                                       | C3(a)                  |
| `src/features/cart/components/CheckoutForm.test.tsx`                          | ui       | El equivalente del total y del total parcial con su aviso, y que `expectedTotal` del `POST /api/orders` es **idéntico** al de antes del feature                                                                                                                                                                                                                                                                                                                                              | C13                    |
| src/features/cart/components/CartView.test.tsx (por crear)                    | ui       | El equivalente del subtotal con su aviso. Archivo nuevo: hoy `CartView` no tiene prueba                                                                                                                                                                                                                                                                                                                                                                                                      | C13                    |
| `src/features/orders/server/quote.test.ts`                                    | node     | `toQuoteResponse` publica `rates` y `store.displayCurrencies`, y son **los del mismo** `CartQuote` que produjo `subtotal`                                                                                                                                                                                                                                                                                                                                                                    | C6, AD3                |
| `src/features/sync/server/handlers/business.test.ts`                          | node     | El cuarto parámetro con Prisma simulado: escribe ⇒ `touchedStoreSlugs` es lo que devolvió la clausura; `stale`, `DELETE` e inválido ⇒ la clausura **no se llama nunca**; conjunto vacío ⇒ `PROCESSED` pelado                                                                                                                                                                                                                                                                                 | C14                    |
| `src/features/sync/server/processBatch.test.ts`                               | node     | El `case "BUSINESS"` recibe **la misma** función que los de `CURRENCY`/`EXCHANGE_RATE` del lote                                                                                                                                                                                                                                                                                                                                                                                              | C14                    |
| `src/features/sync/server/processBatch.invalidationCount.test.ts`             | node     | **La cuenta**: dos `BUSINESS` del mismo negocio en un lote ⇒ **una** `storefront.findMany` y 2 × N `revalidateTag`; de dos negocios ⇒ dos consultas                                                                                                                                                                                                                                                                                                                                          | C14                    |
| src/features/sync/server/handlers/businessInvalidation.db.test.ts (por crear) | node     | **C14 contra Postgres real por el `POST` del route handler**, con `next/cache` espiado y contando: escribe ⇒ exactamente `storeTag` y `storeCatalogTag` de cada sucursal renderizable y de ninguna otra; `stale` ⇒ cero; `BUSINESS_DELETE_NOT_SUPPORTED` y `BUSINESS_DISPLAY_CURRENCIES_INVALID` ⇒ cero; negocio todo en `DRAFT` ⇒ cero                                                                                                                                                      | C14                    |
| `src/features/catalog/catalogFilters.test.ts`                                 | node     | **Sin cambios**, y eso es el aserto: `CatalogFilterContext` no gana ninguna moneda de referencia y el conjunto y el orden no se mueven                                                                                                                                                                                                                                                                                                                                                       | C16                    |
| .agent/specs/F-039/smoke.sh (por crear)                                       | —        | Lo que solo se ve levantando la app: el `curl` con los N equivalentes; dos `Cookie:` y dos `Accept-Language:` distintos ⇒ cuerpos idénticos tras quitar los `<script>`; un `EXCHANGE_RATE` y la primera visita posterior; el `[]` del criterio 9; el recorrido de las cinco pantallas                                                                                                                                                                                                        | C2, C3(a), C8, C9, C12 |

**Cuatro decisiones dentro de este reparto, con su razón:**

1. **C15 se puede hacer en jsdom**, y por eso vive en el test de componente y
   no solo en el navegador: comprobé ejecutando que jsdom 29.1.1 aplica el
   `<style>` con `:not()` y atributos al `getComputedStyle`, con el bloque
   dentro del `body` y el atributo en un `div` intermedio. El test renderiza la
   tarjeta dentro de un contenedor con el `<style>` y `data-ref-currency`, y
   afirma el nombre accesible. Si en la práctica se resistiera, el plan B es
   afirmar el texto exacto de la regla (que ya se prueba en reveal.test.ts) más
   una comprobación en la etapa visual.
2. **C14 se parte en tres y el `*.db.test.ts` es nuevo.** No se extiende
   `src/features/sync/server/handlers/business.db.test.ts`: ese archivo simula
   `next/cache` con un passthrough mudo y sus trece escenarios afirman **qué
   filas quedan**; C14 afirma **una cuenta**, y `vi.mock` es por archivo, así
   que convertir su mock en un espía haría que trece pruebas ajenas
   compartieran un contador cuyo estado depende del orden. Es la misma razón
   por la que F-035 abrió
   `src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts` en vez
   de ampliar `misc.test.ts`, y ese archivo es el molde a copiar, incluido el
   mock que evita `Invariant: static generation store missing` (ficha
   `db-test-revalidatetag-static-generation-store-missing.md`).
3. **La cuenta de consultas se afirma con Prisma simulado, no contra Postgres.**
   Espiar `prisma.storefront.findMany` sobre el cliente real de Prisma 7 no es
   fiable; `processBatch.invalidationCount.test.ts` ya simula `@/lib/prisma`
   entero y ya cuenta llamadas, así que «una consulta de sucursales, no dos» va
   ahí y el `*.db.test.ts` se queda con los tags.
4. **Las cinco ramas del guion se prueban ejecutándolo, y eso fuerza el
   entorno.** El guion es una cadena, así que la tentación es probar solo que
   la cadena no cambió; pero lo que importa es qué atributo escribe en cada uno
   de los cinco casos, y para eso hace falta un DOM y un `localStorage`
   fabricado. Eso obliga a que ese test viva en un archivo `.test.tsx`
   (proyecto `ui`, jsdom), no en reveal.test.ts, que es `.test.ts` y corre en
   `node`: la extensión decide el entorno y no es negociable (AGENTS.md
   § Cosas que muerden, ficha `test-en-entorno-equivocado`). Ya lo ejercité así
   —jsdom con `runScripts: "dangerously"` y un `localStorage` inyectado en
   `beforeParse`— y es como encontré el fallo de E17 que este ciclo corrige.

## Qué rompe en compilación (y es a propósito)

Lo que el implementador se va a encontrar en rojo, para que el plan lo ordene
en vez de descubrirlo:

1. **`QuoteStore` y `QuoteResponse` con campos obligatorios** rompen los
   fabricantes de `quote()` de
   `src/features/cart/components/CheckoutForm.test.tsx` (dos: L21 y L150) y de
   `src/features/cart/components/CheckoutForm.autocomplete.test.tsx` (L21), y
   el `describe("toQuoteResponse()")` de
   `src/features/orders/server/quote.test.ts:274`. Obligatorios a propósito:
   opcionales dejarían a una pantalla sin equivalentes en silencio.
2. **`OrderStore` con `displayCurrencies`** rompe cualquier literal que lo
   construya en pruebas de `src/features/orders/server/`.
3. **`handleBusiness` con cuarto parámetro** rompe `applyEvent`
   (`src/features/sync/server/processBatch.ts`) y
   `src/features/sync/server/handlers/business.test.ts`. Es la señal de que
   ambos se miraron.
4. **`outcomeOf` mudado** puede dejar el `import type { PublicSlug }` de
   `src/features/sync/server/handlers/misc.ts:3` sin usar, y eso es **error**
   de ESLint, no aviso.
5. **`StoreSummary` con un campo más** no rompe nada hoy —solo `loadStore` lo
   construye—, y por eso AD10 no es opcional: el compilador **no** puede avisar
   de la entrada de caché vieja.

## Riesgos y plan B

1. **La entrada de caché con la forma vieja tumba la tienda tras el
   despliegue.** Es el riesgo más caro del feature: se manifiesta solo en
   producción, solo tras desplegar, y en la página principal. Mitigado por
   AD10, con un tipo que obliga a escribir la normalización. Plan B si aun así
   se cuela: no hay uno bueno; por eso va tipado y no como comentario.
2. **Destello o salto de maquetación en la primera pintura.** Mitigado con el
   guion en línea de AD4, que corre antes de que exista la primera tarjeta.
   Plan B, si el guion resultara inaceptable: aceptar que con JavaScript se
   vean todos hasta hidratar (SP1(c), que DH1 descartó) — peor, y por eso no es
   el elegido.
3. **Navegación de cliente entre dos tiendas distintas dentro del mismo
   `layout`** (desde el selector de una marca): el guion en línea no vuelve a
   ejecutarse —un `<script>` que React reinserta no corre— así que el atributo
   se queda con el valor de la tienda anterior y, si esa moneda no la declara la
   nueva, ninguna regla casa y se ven **todos** los equivalentes un instante.
   Mitigado porque la isla del selector reescribe el atributo en un efecto
   cuando cambian sus props (escribir un atributo del DOM en un efecto no es
   `setState` y no cae en la prohibición de AGENTS.md). Queda un fotograma con
   los N visibles en ese caso concreto: aceptado y escrito.
4. **El aviso de hidratación de React convertido en etapa roja.** Mitigado con
   `suppressHydrationWarning` en el `<html>` de `src/app/layout.tsx` (AD4). Si
   se olvidara, el síntoma no dice «te falta esa propiedad»: dice que el
   servidor se cayó (ficha `console-error-dispara-guardian-servidor.md`).
5. **El HTML de un negocio con muchas monedas.** Sin tope por DH4/SP2(a).
   Mitigado midiendo (C10) y con el umbral escrito en § Escalabilidad. Plan B
   si la medición sale mal: SP2(b), y es un feature del humano.
6. **`format:check` en rojo por un documento ajeno.** Ya está pasando en este
   árbol con `.agent/specs/propuestas/zonas-de-envio.md`, que otra sesión está
   escribiendo. Se comprueba **de qué archivo** se queja antes de tocar nada y
   no se formatea prosa ajena (ficha
   `prettier-write-reescribe-prosa-ajena.md`).
7. **Alguien cablea `displayPrice`** (`src/lib/pricing.ts:128`) creyendo que
   cierra el feature. Es I4 de la spec: sería exactamente la confusión que
   S-008 vino a evitar. Mitigado porque `priceEquivalents` no lo llama y porque
   queda escrito aquí; si sigue sin llamantes al cerrar F-039, retirarlo es un
   `refactor:` de otro ciclo.

## ¿Hace falta una ADR?

**Sí, una, y es corta.** El siguiente número libre es el 0031 —el último es
`docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md`— y el título propuesto,
«La preferencia del visitante no entra en el HTML». **No la escribo**: el
orquestador la programa como paso del plan y la firma el humano ahí. Dejo aquí
el borrador para que ese paso no empiece de cero.

> **Contexto.** El escaparate se sirve por ISR con revalidación por tag (ADR
> 0006). F-039 es el primer feature en el que el visitante tiene una
> **preferencia** que cambia lo que ve: su moneda de referencia. Y no será el
> último: cualquier selector de zona, de idioma o de sucursal favorita llega
> con la misma pregunta.
>
> **Decisión.** La preferencia del visitante **no entra en el cuerpo servido**
> y no crea variantes de caché. El servidor pinta **todas** las alternativas en
> el HTML, con un atributo que las identifica; el cliente escribe **un** atributo
> en `<html>` y unas reglas de CSS generadas por el servidor deciden qué se ve.
> La preferencia vive solo en `localStorage`. Prohibido: cookie, parámetro de
> consulta, cabecera `Vary`, y leer cualquiera de las tres en `src/proxy.ts`.
>
> **Consecuencias.** Para una URL, un solo cuerpo y una sola entrada de caché,
> así que una tasa nueva invalida una cosa y no N. Sin JavaScript se ve todo, lo
> que es una mejora, no una degradación. A cambio, el HTML carga las
> alternativas que casi nadie mirará, y eso pone un techo práctico al número de
> alternativas por importe que se mide, no se supone (F-039, criterio 10).
>
> **Alternativa descartada.** Una variante de caché por moneda: multiplica lo
> que hay que revalidar en cada `EXCHANGE_RATE` y duplica URLs para los
> buscadores.

Las demás decisiones de este documento no son estructurales: AD1 y AD8 son
colocación, AD3 y AD5 son forma de un contrato interno, AD6 y AD9 son coste y
convención, y AD7 aplica una ADR que ya existe.

## Preguntas al humano

**Las tres están CERRADAS** (orquestador y humano, 2026-09-08). Se conservan
con su razonamiento porque el plan las cita, no porque queden abiertas. **No
queda ninguna pregunta pendiente de este documento.**

**AP1 — CERRADA en (a): el `<html>` de `src/app/layout.tsx` gana
`suppressHydrationWarning`**, por la razón que puse: sin ella el aviso «Extra
attributes from the server» se imprime con `console.error` y pone roja una
etapa entera por algo que no es un fallo. Es una propiedad y su alcance es un
nivel, no el árbol; el precio aceptado es que un desajuste futuro de atributos
**del propio `<html>`** dejaría de avisar en desarrollo. Descartadas: poner el
atributo en el `div` de la tienda y arriesgar el aviso, y renunciar al guion
previo al pintado aceptando el destello (SP1(c), ya descartada por DH1).

**AP2 — CERRADA en (a) por el humano: `QuoteResponse` publica la tabla de tasas
del negocio ENTERA, sin filtrar.** Son datos ya deducibles de los precios
publicados, la respuesta va con `no-store` y así el equivalente es una función
del total con la misma tabla que lo produjo (AD3). Descartada la (b) —publicar
solo las declaradas más la base—: eran unos bytes menos a cambio de una regla
más que mantener en `toQuoteResponse`.

**AP3 — CERRADA en (a): ningún umbral duro de bytes.** La cifra la trae el
criterio 10 y el tope de SP2(b) vuelve como conversación, no como fallo del
implementador. El ~2× que escribí en § Escalabilidad queda como lo que es —un
criterio para saber cuándo hablar—, no como una puerta que cierre el sensor.

**Y una decisión que tomé yo en este ciclo en vez de abrir una AP4**, porque
E17 ya la dictaba y abrir una pregunta bloquearía la firma del plan por algo
menor: cuando la moneda que el comprador tenía elegida **deja de ofrecerse**
—el comercio la retira, o su tasa caduca, que con DH5 es el caso nuevo—, la
pantalla vuelve a **solo el principal** (el centinela), no a la moneda por
defecto de la tienda, y la preferencia guardada **no se borra**. Es lo que E17
pide literalmente para la tienda que no declara la moneda elegida, y tratar los
dos casos igual evita dos comportamientos para la misma situación vista por el
comprador. Queda dicho aquí para que `sdd-spec` lo alinee al reescribir E6 y
E17: si el humano prefiriera que en ese caso se caiga a la moneda por defecto,
es **un carácter** del guion de AD4 (`v = "none"` → `v = e.getAttribute(...)`)
y una fila de la tabla de cinco ramas.
