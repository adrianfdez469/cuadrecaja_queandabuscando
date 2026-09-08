---
feature: F-039
agente: sdd-spec
actualizado: 2026-09-08T12:06:52Z
estado: listo
---

> La mitad visible de la **S-008**. El lado receptor ya está en pie: F-038
> guarda `Business.displayCurrencies` (`prisma/schema.prisma:147`) y **nadie la
> lee**. Este feature es el lector, y hereda de F-038 una deuda con nombre —
> «el día que exista el lector, la invalidación tiene que llegar con él»
> (`.agent/specs/F-038/spec.md` I7/R13, SP1(a), y `.agent/specs/F-038/impl.md`
> § Deuda dejada). La regla de producto está publicada y es vinculante:
> `docs/sync-contract.md` § «`payload` de `BUSINESS` (v12)» → «Cómo se usa, que
> es la mitad que importa», reglas ① y ②. Este documento no la reinterpreta: la
> traduce a requisitos que se pueden ejecutar.

## Problema

Hoy todas las páginas públicas convierten cada precio a la moneda base del
negocio y pintan **un solo** importe: `resolvePrice`
(`src/lib/pricing.ts:65`) recibe siempre `targetCurrency = store.baseCurrencyCode`
(`src/app/[slug]/page.tsx:202`, `src/app/[slug]/c/[categorySlug]/page.tsx:176`,
`src/app/[slug]/catalogo/page.tsx:181`, `src/app/[slug]/buscar/page.tsx:226`,
`src/app/[slug]/p/[productSlug]/page.tsx:152`). El comprador cubano razona en
dos o tres monedas a la vez y no tiene forma de saber cuánto es «eso» en la
suya: hace la cuenta a mano, con una tasa que se inventa, o se va. El negocio ya
declaró **qué monedas quiere enseñar** y esa señal está guardada sin usar.

## Alcance

### Dentro

1. La **tarjeta de producto** (`src/components/store/ProductCard.tsx`) enseña el
   importe en la moneda base como principal y, al lado, los equivalentes en las
   monedas que el negocio declara, marcados como aproximados. Como es un solo
   componente, las cuatro superficies que lo pintan lo ganan a la vez: `/[slug]`,
   `/[slug]/c/[categorySlug]`, `/[slug]/catalogo` y `/[slug]/buscar` (esta última
   por `src/components/store/StoreCatalogResults.tsx`).
2. La **ficha de producto** (`src/app/[slug]/p/[productSlug]/page.tsx`), con el
   mismo trato para su importe grande.
3. Un **selector de moneda de referencia** en la cabecera de la tienda
   (`src/app/[slug]/layout.tsx`), único, que aplica a todas las pantallas y se
   recuerda entre visitas en el mismo navegador (DH2). Ofrece **solo** las
   monedas declaradas cuyo equivalente se puede calcular (DH5, R23).
4. **Carrito y checkout** (`src/features/cart/components/CartView.tsx`,
   `src/features/cart/components/CheckoutForm.tsx`): el equivalente acompaña al
   agregado que esas pantallas ya enseñan, con el aviso de que el cobro va en la
   moneda base (DH3).
5. La **invalidación de caché** que F-038 dejó pendiente: escribir la lista
   expira la marca de las sucursales renderizables del negocio.
6. La **lectura** de `Business.displayCurrencies` en la capa de datos del
   escaparate (`src/features/catalog/server/queries.ts`), que hoy solo trae
   `baseCurrencyCode` (L139).

### Fuera (explícito)

1. **Convertir en el cliente con aritmética propia.** La conversión la hace
   `convert` (`src/lib/money.ts:141`) y nada más. Llamar a esa función desde
   código de cliente **no** es reimplementarla (R12); escribir una segunda
   división en JavaScript sí, y está prohibido.
2. **Un endpoint de tasas.** Lo dice el contrato: «nada de esto necesita una
   caché nueva ni un endpoint de tasas» (`docs/sync-contract.md`, § BUSINESS).
3. **Cambiar lo que se cobra.** El importe que se cobra sigue siendo el de la
   moneda base en las cuatro pantallas. `AddToCartButton` sigue recibiendo
   `currencyCode = resolved.price.currency` (base) y `expectedTotal` sigue
   viajando en base (`src/features/cart/components/CheckoutForm.tsx:313-324`).
4. **La página del pedido y la cuenta** (`src/app/[slug]/pedido/[code]/page.tsx`,
   `src/app/cuenta`). Ahí el importe es histórico y ya acordado; convertirlo con
   la tasa de hoy enseñaría un número que nunca fue cierto, y el snapshot del
   pedido solo guarda las tasas de las monedas de origen que se usaron
   (`src/features/orders/server/createOrder.ts:353-363`). Guardar la moneda de
   referencia del comprador en el pedido tampoco entra.
5. **El equivalente del precio tachado** («Antes …», `ProductCard.tsx:69-73`) y
   **los importes de los chips de rango de precio** de F-027. No se cobran y
   duplicarían el ruido y los bytes del HTML.
6. **Tocar lo que el POS envía.** Cero cambios en `docs/sync-contract.md`: la
   v12/v12.1 ya publica la regla que este feature implementa (I5).
7. **Filtrar, ordenar o paginar por la moneda de referencia** (R14).
8. **Leer la tabla global `Currency`** para decidir qué se pinta (R6).

## Actores y precondiciones

- **El comprador** (anónimo, sin sesión) abre una URL pública de la tienda.
- **El comercio**, desde cuadrecaja, emite un `BUSINESS` con su lista; y emite
  `EXCHANGE_RATE` cuando cambia una tasa.
- Precondición de datos: `Business.displayCurrencies` (`String[] @default([])`)
  y las tasas vigentes por `(businessId, currencyCode)` que resuelve
  `loadCurrentRates` (`src/features/catalog/server/rates.ts:51`). `npm run seed`
  **no** escribe `displayCurrencies`: un negocio recién sembrado tiene `[]`, que
  es exactamente el estado del criterio 9. Para el resto de los escenarios la
  lista se pone con `node scripts/send-catalog-batch.mjs --business` (F-038, C12)
  o con una fixture.

## Las dos capas, y el tercer conjunto que separó DH5

Toda la ambigüedad de este feature se disuelve separando cosas que se llaman
parecido. Las dos primeras están así en el contrato (§ BUSINESS, regla ①) y son
el fallo que cazó el arnés de cuadrecaja (`features.json`, nota de F-039: copiar
su `useMonedasAlternativas` literal descartaba la base). La tercera la separó el
humano el 2026-09-08 (DH5) y **no** estaba en la primera versión de esta spec.

**Capa 1 — la lista declarada.** Es `Business.displayCurrencies` tal como el POS
la mandó, deduplicada y en su orden (F-038 R4). Es una **declaración del
comerciante**, no una lista derivada: **no se poda** por falta de tasa, ni por
el ancla, ni porque una moneda no tenga fila en `Currency`. Es lo que se guarda
y lo que se **intenta** pintar: los códigos que el escaparate recorre producto a
producto para ver cuál puede calcular.

**Capa 2 — el equivalente que se puede calcular.** Es el importe concreto de
**este** producto en **esta** moneda. Se calcula con `convert`, que lanza
`MoneyError` cuando no hay tasa (`src/lib/money.ts:147-149`), y lo que no se
puede calcular **se omite**: nunca un cero, nunca un guion, nunca un error que
sube. La omisión es **producto a producto y moneda a moneda**, y no toca la capa 1.

**Tercer conjunto — lo que el selector ofrece (DH5).** Son las monedas de la
capa 1, menos la base, **cuyo equivalente se puede calcular** con las tasas
vigentes de este negocio. Una moneda declarada sin tasa **no aparece** entre las
opciones. Palabras del humano ante DP3 del diseñador: «si en la tienda tienen una
moneda configurada sin tasa no se debe mostrar». Descartadas explícitamente:
dejarla listada e inerte, y dejarla listada pero deshabilitada.

**Por qué son tres conjuntos y no uno.** La calculabilidad de un equivalente es
una propiedad del **par** (moneda base, moneda destino) y de la tabla de tasas
del negocio, **no** del producto: `convert` solo mira las tasas de esas dos
monedas (`src/lib/money.ts:144-156`). Así que una moneda sin tasa no puede pintar
su equivalente en **ningún** producto del negocio, y ofrecerla en el selector
sería ofrecer una opción muerta: elegirla no cambiaría nada en ninguna pantalla.
La capa 2, en cambio, se decide producto a producto porque un producto **sí**
puede quedarse sin importe principal (E9) mientras sus vecinos lo tienen.

**La tensión con el contrato, escrita y no escondida.** La regla ① de
`docs/sync-contract.md` § BUSINESS dice que «la lista no se poda por falta de
tasa». Sigue siendo cierta y este feature la respeta: habla de lo que se
**guarda** —la lista declarada no se toca, ni se reescribe, ni se filtra al
leerla— y de que lo que se omite es **el importe concreto** que no se puede
calcular. El selector es superficie **nuestra**, posterior al contrato, y no
existía cuando esa regla se escribió. El efecto práctico de que la lista siga
intacta es el que importa: el día que llegue el `EXCHANGE_RATE` de esa moneda,
aparece en el selector **sola**, sin que nadie reenvíe un `BUSINESS` (E19). Por
eso `docs/sync-contract.md` **no se edita** en este feature (I5).

**Lo que DH5 no cambia.** El importe principal (R3), la moneda base aunque no
venga en la lista (R4, criterio 5) y la omisión producto a producto del
equivalente incalculable (R5, criterio 4). Los dos criterios de `features.json`
que rozan esto siguen cumpliéndose tal como están escritos, y se dice
explícitamente en C4 y C5.

Las tres capas juntas producen el criterio 4 sin ningún caso especial, y el
criterio 5 sale de una tercera frase del contrato: **la moneda base se enseña
aunque no venga en la lista**, porque es la moneda del cobro y no una
preferencia.

## Comportamiento esperado

**E1 — dos monedas declaradas, tasa disponible.** Dado un negocio con
`baseCurrencyCode = "CUP"`, `displayCurrencies = ["CUP", "USD"]` y tasa vigente
`USD = 440`; cuando el comprador pide `/tienda-demo` sin JavaScript; entonces la
tarjeta de un producto de 4400.00 CUP muestra `$4,400.00` como importe principal
y un equivalente `≈ USD 10.00` marcado como aproximado, y el `USD` no aparece
como el número grande.

**E2 — los N equivalentes viajan en el HTML.** Dado `displayCurrencies =
["CUP", "USD", "MLC"]` con tasas para las dos; cuando se pide el HTML crudo
(`curl`) y **no se ejecuta nada**; entonces el cuerpo contiene los **dos**
equivalentes (USD y MLC) de cada producto, visibles: el estado por defecto del
documento servido no oculta ninguno.

**E3 — elegir una moneda con JavaScript activo.** Dado el mismo HTML de E2;
cuando el comprador elige `USD` en el selector de la cabecera; entonces la
tarjeta muestra el principal en CUP y **solo** el equivalente en USD, el de MLC
queda oculto (y fuera del árbol de accesibilidad), y no se pide nada al
servidor.

**E4 — la elección se recuerda.** Dado que el comprador eligió `USD`; cuando
cierra la pestaña y vuelve más tarde en el mismo navegador a cualquier página de
la tienda; entonces sigue viendo el equivalente en USD y **no** vuelve a
elegirlo.

**E5 — la elección no viaja al servidor.** Dado dos compradores con
preferencias distintas; cuando los dos piden la misma URL; entonces reciben el
**mismo cuerpo**, byte a byte (normalizando los `<script>`, ficha
`.agent/playbook/smoke-diff-html-rsc-no-determinista.md`). No hay cookie, ni
parámetro de consulta, ni cabecera que la transporte, y ninguna página lee
nada de eso para decidir qué pinta.

**E6 — moneda declarada sin tasa.** Dado `displayCurrencies = ["CUP", "USD",
"EUR"]` con tasa para USD y **ninguna** para EUR; cuando se pide el catálogo;
entonces cada tarjeta muestra el principal en CUP y el equivalente en USD, y
**ningún** elemento para EUR — ni vacío, ni con guion. Y el EUR **no aparece
entre las opciones del selector** (DH5, R23): ofrecerlo sería ofrecer una opción
que no cambia nada en ninguna pantalla. La lista guardada sigue siendo
`["CUP","USD","EUR"]`: no se reescribe ni se filtra (R1).

**E7 — la base no viene en la lista.** Dado `baseCurrencyCode = "CUP"` y
`displayCurrencies = ["USD"]`; cuando se pide el catálogo; entonces el importe
principal sigue siendo el de CUP, y el USD va al lado como equivalente. Lo mismo
con `displayCurrencies = []` y con una lista que no menciona la base.

**E8 — la base repetida en la lista.** Dado `baseCurrencyCode = "CUP"` y
`displayCurrencies = ["CUP", "USD"]`; entonces se pinta **un solo** importe en
CUP (el principal) y un equivalente en USD: la base nunca se pinta dos veces.

**E9 — producto sin precio resoluble.** Dado un producto cuya moneda de precio
no tiene tasa (`safeResolve` devuelve `null`, `ProductCard.tsx:91-106`); cuando
se pinta su tarjeta; entonces sigue diciendo «Consultar» exactamente como hoy y
**no** se pinta ningún equivalente: no hay importe del que derivarlos.

**E10 — ninguna moneda extra declarada.** Dado un negocio con
`displayCurrencies = []`, o `["CUP"]` siendo CUP la base; cuando se piden sus
páginas; entonces el HTML es el de hoy: un solo importe, **ningún** elemento
nuevo, y **ningún** selector en la cabecera.

**E11 — cambia una tasa.** Dado un catálogo ya servido desde caché; cuando llega
un lote con un `EXCHANGE_RATE` de `USD`; entonces la **primera** visita
posterior muestra los equivalentes recalculados con la tasa nueva, sin esperar
el suelo de 3600 s (`src/app/[slug]/layout.tsx:19`) y sin reiniciar el servidor.
Esto ya lo hace F-035 sobre `storeTag`: no se reimplementa.

**E12 — cambia la lista.** Dado un catálogo ya servido desde caché; cuando llega
un `BUSINESS` que **escribe** una lista nueva; entonces la primera visita
posterior a cada sucursal renderizable del negocio enseña la lista nueva, sin
esperar el suelo. Si el evento responde `stale` o vuelve en `failed[]`, no se
invalida nada.

**E13 — el equivalente y lo que se cobra.** Dado un producto con equivalente en
USD; cuando el comprador lo agrega, cotiza y crea el pedido; entonces el pedido
se crea con el importe **en la moneda base**, idéntico al número principal que
vio la tarjeta, y el equivalente que vio es exactamente
`convert(importe_cobrado, "USD", tasas)` con las mismas tasas de esa cotización.

**E14 — ninguna de las dos monedas es CUP.** Dado un negocio con
`baseCurrencyCode = "MLC"`, un producto con `syncedPriceCurrency = "USD"` y
`displayCurrencies = ["EUR"]`, con tasas `USD`, `MLC` y `EUR` en la tabla;
entonces el principal es el del producto convertido a MLC y el equivalente es
`convert(principal_en_MLC, "EUR", tasas)`: los dos saltos pasan por el ancla CUP
y ninguno inventa un par directo USD/EUR ni MLC/EUR.

**E15 — el carrito.** Dado que el comprador eligió USD y tiene tres líneas;
cuando abre `/[slug]/carrito`; entonces el subtotal se enseña en la moneda base
como hoy y, debajo, su equivalente aproximado en USD con el aviso de que el
cobro es en la moneda base. Sin JavaScript esa pantalla sigue diciendo lo que
dice hoy («necesitas activar JavaScript», `CartView.tsx:115-122`).

**E16 — el checkout.** Igual que E15 sobre el **total** (y sobre el total
parcial, cuando el envío está por cotizar). El cuerpo del `POST /api/orders`
—`expectedTotal`, `expectedUnitPrice`— no cambia ni un carácter.

**E17 — la moneda elegida no la ofrece esta tienda.** Dado que el comprador
eligió EUR en la tienda A; cuando abre la tienda B, que **no ofrece** EUR —o
porque no lo declara, o porque lo declara sin tasa (R23)—; entonces en B ve solo
el principal (ningún equivalente seleccionado) y su preferencia de EUR **no se
borra**: al volver a A sigue puesta. Es el mismo centinela para los dos motivos,
que es lo que hace que DH5 no necesite ningún camino nuevo aquí.

**E18 — la ficha de producto.** Dado el selector en USD; cuando el comprador
entra a `/[slug]/p/[productSlug]`; entonces ve el mismo trato que en la tarjeta:
principal en base, equivalente en USD, y el botón de agregar sigue llevando el
importe y la moneda base (`page.tsx:237`).

**E19 — la tasa que faltaba llega después.** Dado el negocio de E6 (EUR
declarado, sin tasa, y por tanto sin opción en el selector); cuando llega un lote
con un `EXCHANGE_RATE` de `EUR`; entonces en la **primera** visita posterior el
EUR ya es una opción del selector y su equivalente se pinta en cada producto que
lo pueda calcular, **sin** que cuadrecaja reenvíe ningún `BUSINESS` y sin esperar
el suelo de revalidación. Es la consecuencia de que la lista guardada no se pode
(R1, R23(3)), y se apoya en la invalidación que F-035 ya dispara por
`EXCHANGE_RATE`.

## Reglas de negocio

**R1 — la lista declarada no se poda: es lo que se guarda y lo que se intenta
pintar.** La lista es `Business.displayCurrencies` tal cual (dedupe y orden ya
garantizados por F-038, `src/features/sync/displayCurrencies.ts:35`). Nada la
filtra por falta de tasa, por ausencia en `Currency` ni por el ancla, ni al
escribirla ni al leerla. Publicado: `docs/sync-contract.md` § BUSINESS regla ①.
**Lo que R1 ya no dice, desde DH5:** no es lo que decide las opciones del
selector. Eso es R23, y son dos conjuntos distintos a propósito — ver § Las dos
capas, y el tercer conjunto que separó DH5.

**R2 — el conjunto de equivalentes que se intentan pintar = lista declarada menos
la base**, comparando el código como cadena exacta, sin normalizar mayúsculas.
Esto implementa E8 y no toca R1: la base sale del conjunto de **equivalentes**
porque ya es el principal, no de la lista. De este conjunto, cada producto pinta
los que puede calcular (R5), y de él sale además, filtrado por calculabilidad, lo
que ofrece el selector (R23).

**R3 — el importe principal es el de la moneda base y es el que se cobra.** Los
equivalentes van **junto a él**, nunca en su lugar, y nunca con más peso
tipográfico. Publicado: contrato § BUSINESS regla ②. Los otros importes de la
página que hoy están en base (tachado, chips, filtros, carrito, checkout) siguen
en base.

**R4 — la base se muestra aunque no esté en la lista.** No se comprueba su
pertenencia a `displayCurrencies` en ningún sitio, ni para pintarla ni para
decidir si hay algo que pintar. Motivo, del contrato: «es la moneda del cobro,
no una preferencia»; y es el fallo concreto que el arnés de cuadrecaja cazó,
porque el ancla nunca tiene tasa propia (`src/lib/money.ts:144-145`) y un filtro
«solo las que tienen tasa» habría borrado la moneda en la que se paga.

**R5 — el equivalente que no se puede calcular se omite, producto a producto.**
La única condición que lo omite es que `convert` lance `MoneyError`. Se atrapa
`MoneyError` y **solo** ese tipo: cualquier otro error es un defecto del código
y tiene que subir, no quedarse en silencio. (Los dos `catch` pelados de hoy —
`ProductCard.tsx:103` y `catalogFilters.ts:264` — no se tocan en este feature.)

**R6 — la tabla global `Currency` no decide nada.** Ni `active`, ni `symbol`, ni
la existencia de la fila. Motivo, con cita: esa tabla es **global a la
plataforma** (`docs/sync-contract.md` § CURRENCY ①) y el propio contrato avisa de
que «un negocio que retire el euro se lo retira a todos»; `displayCurrencies`
existe precisamente para no seguir esa recomendación. El símbolo lo pone
`formatMoney` vía `Intl` (`src/lib/money.ts:173-192`), que ya trae su rama de
respaldo `«CÓDIGO importe»` para una moneda que el runtime no conozca.

**R7 — un solo sitio calcula los equivalentes.** Una función **pura** —sin
Prisma, sin React— que recibe el importe ya resuelto (`Money` en base), la lista
declarada, el código de la base y la `RateTable`, y devuelve los equivalentes en
el orden de la lista, ya omitidos los incalculables. Es la misma disciplina del
«compositor único» de `resolvePrice` (`src/lib/pricing.ts:59-64`): la tarjeta, la
ficha, el carrito y el checkout llaman a **esa**, y así no pueden discrepar. Es
también lo que hace verificable el criterio 7 con una prueba unitaria, sin
sembrar un negocio de base no-CUP.

**R8 — el equivalente se deriva del importe que se cobra**, no del precio en su
moneda de origen (`ResolvedPrice.beforeConversion`). Dos motivos, y el segundo
es el que decide: (a) el criterio 6 solo es verificable si el equivalente es una
función del importe cobrado; (b) si se derivara del origen, dos productos con el
**mismo** importe mostrado podrían enseñar equivalentes distintos por un céntimo
—porque uno vino en USD y el otro en MLC— y eso es una incoherencia visible en la
misma rejilla. Consecuencia aceptada: hay dos redondeos en cadena cuando el
precio de origen no está en la base, y por eso el equivalente se marca como
aproximado.

**R9 — el ancla no se salta.** Toda conversión pasa por `convert`, que va al
ancla CUP y de ahí al destino en **una sola división**
(`src/lib/money.ts:158-161`). Nunca se compone un par directo entre dos monedas
no ancla, ni se multiplica por un cociente de tasas calculado aparte.

**R10 — el redondeo no se reimplementa.** `convert` es la función del checkout
(`src/features/orders/server/quote.ts:242` la usa a través de `resolvePrice`).
Ninguna otra división, `Math.round`, `toFixed` ni multiplicación por una tasa
aparece en este feature.

**R11 — el cuerpo servido no varía por la preferencia de moneda.** Para una URL
dada, el HTML es idéntico byte a byte para todos los visitantes. De ahí tres
prohibiciones concretas: **ninguna cookie** que transporte la preferencia (leer
una en un componente de servidor volvería la ruta dinámica y anularía el ISR),
**ningún parámetro de consulta** (`?moneda=USD` sería una URL nueva para el
mismo contenido, duplicado para los buscadores y una entrada de caché más), y
**ninguna** variante por `Accept-Language` o geolocalización. La preferencia
vive **solo** en el navegador. Es el criterio 3 y es también lo que hace que la
alternativa descartada —una variante de caché por moneda— no vuelva por la
puerta de atrás: multiplicaría lo que hay que revalidar cada vez que llega una
tasa.

**R12 — el HTML lo pinta el servidor; el cliente solo revela.** `ProductCard`
sigue siendo un componente de servidor (AGENTS.md § Prohibiciones: nunca
`"use client"` en algo que renderice catálogo). El código de cliente que este
feature añade hace exactamente dos cosas: guardar/leer la preferencia y
mostrar/ocultar los equivalentes ya presentes en el DOM. **No** convierte, **no**
formatea importes del catálogo y **no** pide nada al servidor.

Excepción explícita y acotada: en carrito y checkout el total lo compone el
cliente (`CheckoutForm.tsx:313-324`), así que su equivalente se calcula
**llamando** a `convert` desde ese código de cliente, con la misma tabla de
tasas con la que se calculó el total. Eso no es reimplementar el redondeo —es
usar la misma función— y `src/lib/money.ts` ya está en ese árbol de cliente
(`money`, `add`, `subtract`, `formatMoney`).

**R13 — el estado por defecto del documento enseña todos los equivalentes.**
Ocultar es una acción del cliente, nunca una clase estática en el HTML servido.
Si el JavaScript no llega, no corre o falla, se ven todos (criterio 2). Y el
selector no aparece en el HTML servido: se pinta después de hidratar, con la
misma técnica que `CartBadge` (`getServerSnapshot` vacío,
`src/features/cart/cartStore.ts:83-85`), porque un control que sin JavaScript no
hace nada es peor que ningún control.

**R14 — la moneda de referencia no altera el conjunto ni el orden.** Los
filtros, el orden y la paginación de F-027 siguen operando sobre el precio en la
base (`CatalogFilterContext.displayCurrency`), y `precio_min`/`precio_max` de la
URL siguen expresados en la base. Motivo: son decisiones del servidor por URL;
hacerlas depender de la preferencia crearía la variante de caché que R11
prohíbe y cambiaría el conjunto de resultados según quién mira.

**R15 — los equivalentes ocultos salen del árbol de accesibilidad.** Se ocultan
con `display: none` (o el atributo `hidden`), no solo visualmente: un lector de
pantalla no puede anunciar tres precios por producto.

**R16 — cada equivalente se marca como aproximado** de forma visible y con
nombre accesible (no solo un símbolo suelto), y cada pantalla que enseña alguno
lleva **una** frase que dice que el cobro es en la moneda base. En carrito y
checkout esa frase acompaña al importe agregado (DH3, exigencia literal).

**R17 — la preferencia es del comprador, no de la tienda.** Una sola clave de
`localStorage`, sin sufijo de tienda, con la convención que ya usa el repo
(`qab.<cosa>.v1`, `src/constants/cart.ts:14`). Si el código guardado no está
entre las monedas que **ofrece** la tienda que se está viendo (R23) —sea porque
no la declara, sea porque la declara sin tasa—, se muestra solo el principal y la
preferencia **no se borra** (E17): un solo centinela para los dos motivos, sin
camino nuevo. Si `localStorage` no está disponible
—navegación privada, cuota llena—, la elección vale para la sesión y nada falla:
mismo trato que el carrito (`src/features/cart/cartStorage.ts:24-38`).

**R18 — escribir la lista invalida las sucursales renderizables del negocio.**
Es la deuda I7/D4 de F-038, y este feature la paga. La forma no se inventa:
`handleBusiness` (`src/features/sync/server/handlers/business.ts:47`) gana el
parámetro `renderableBranches: RenderableBranchLookup` y devuelve
`touchedStoreSlugs` con el conjunto que ya resuelve
`createRenderableBranchLookup` (`src/features/sync/server/businessBranches.ts:64`),
memoizado **una vez por lote**; y `applyEvent` se lo pasa en su
`case "BUSINESS"` (`src/features/sync/server/processBatch.ts:176-177`, hoy el
único de los seis que no lo recibe). Prohibido: armar el array de slugs a mano
(AGENTS.md § Prohibiciones y ficha
`.agent/playbook/revalida-solo-lo-que-se-escribe-no-lo-que-cambia-de-significado.md`)
y abrir una consulta nueva por evento. Un evento `stale` o fallido **no**
invalida nada: se invalida lo que se escribió, igual que el `CUP` de
`handleExchangeRate` vuelve antes de llamar a la clausura
(`src/features/sync/server/handlers/misc.ts:197-198`).

**R19 — el tag que se expira es el que ya existe.** El lector nuevo vive en la
lectura cacheada de la tienda (`getStoreBySlug`, cacheada con
`storeTag(canonicalSlug)`, `src/features/catalog/server/queries.ts:188-195`), y
`revalidateStores` expira `storeTag` y `storeCatalogTag`
(`src/lib/cache.ts:86-93`). Ni un tag nuevo, ni una entrada de caché nueva, ni
un `revalidate` nuevo en ningún segmento —y ninguno de los que hay se toca, que
son literales a propósito (`.agent/playbook/revalidate-no-literal.md`).

**R20 — `src/proxy.ts` no se toca.** Ninguna parte de este feature necesita el
proxy, y meter `/[slug]` en su `matcher` anularía el ISR completo (AGENTS.md,
ficha `.agent/playbook/proxy-matcher-anula-isr.md`). Se escribe aquí porque un
feature que va de «recordar algo del visitante» es exactamente el que invita a
hacerlo con una cookie leída en el proxy.

**R21 — el presupuesto de JavaScript se mide y se anota, no bloquea.** Decisión
del humano del 2026-09-06 (nota de F-039 en `features.json`, y AGENTS.md § «El
presupuesto de JavaScript no es un muro»). Se mide con `npm run check:bundle`
antes y después, y el número va al `progress` (criterio 10). Si hay que subir
`BUDGET_KB`, se sube con la medición en el comentario
(`scripts/check-bundle-budget.mjs:22-26`), nunca en silencio.

**R22 — la lectura tolera una entrada de caché anterior.** Añadir un campo a
`StoreSummary` (`src/features/catalog/server/queries.ts:65`) no invalida las
entradas de `unstable_cache` que ya estén escritas con la forma vieja: un
`displayCurrencies` `undefined` se lee como lista vacía y la página se pinta
como hoy, nunca revienta.

**R23 — el selector solo ofrece monedas con equivalente calculable (DH5,
humano, 2026-09-08).** Las opciones son las de R2 —lista declarada menos la
base— filtradas por que `convert` de un importe en la moneda base a esa moneda,
con las tasas vigentes del negocio, **no lance `MoneyError`**. Cuatro
consecuencias, cada una comprobable por separado:

1. **El criterio es «equivalente calculable», no «existe fila de tasa».** Una
   tasa cero o negativa hace lanzar a `convert` igual que su ausencia
   (`src/lib/money.ts:151`), así que se poda por lo mismo. Es el criterio con el
   que ya se elige el estado inicial (SP1(a)/DH4), y por eso el defecto es
   siempre una opción ofrecida y nunca una opción muerta.
2. **Es una propiedad de página, no de producto.** Se calcula una vez por
   página con la base y la tabla de tasas, nunca por tarjeta; no depende de qué
   productos se estén pintando ni de cuáles tienen precio resoluble.
3. **La lista guardada no se toca.** Ni se reescribe, ni se filtra al leerla, ni
   se emite nada hacia cuadrecaja: la poda es solo del control (R1). El día que
   llegue el `EXCHANGE_RATE` de esa moneda, entra en el selector sola, por la
   invalidación que F-035 ya dispara (E19).
4. **Si el conjunto queda vacío, no hay selector**, exactamente igual que cuando
   no hay ninguna moneda extra declarada (E10, criterio 9). Un selector con la
   única opción «solo la moneda base» no es una elección.

Lo que R23 **no** hace: no quita el importe principal, no cambia lo que se
pinta producto a producto (R5) ni toca la regla de que la base se muestra
siempre (R4).

## Casos límite y errores

| Caso                                                                                              | Comportamiento exigido                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lista vacía** (`[]`, el defecto de la columna y el de todo negocio recién sembrado)             | Nada nuevo en el HTML: un importe, sin selector, sin marca de aproximado (E10, criterio 9). `[]` y «nunca llegó un `BUSINESS`» son indistinguibles y significan lo mismo, como dejó escrito F-038 (`.agent/specs/F-038/architecture.md` AD1)                                                                                                                                                                                                                                                                                                                   |
| **Lista con la base repetida** (`["CUP","USD"]`, base CUP)                                        | Un solo importe en CUP como principal y un equivalente en USD (R2, E8). Es el caso **normal**, no el raro: el contrato manda incluir `Negocio.monedaBase` en la lista (`docs/sync-contract.md` § Mapeo de nombres, fila `displayCurrencies`)                                                                                                                                                                                                                                                                                                                   |
| **Lista con la base y nada más** (`["CUP"]`, base CUP)                                            | Idéntico a la lista vacía (E10). El conjunto de equivalentes queda vacío tras R2                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Moneda declarada sin tasa vigente**                                                             | No se pinta su equivalente en **ningún** producto, los demás sí, el principal no desaparece (E6, criterio 4) y **no se ofrece en el selector** (DH5, R23), porque sería una opción muerta: no hay ningún producto del negocio en el que pudiera pintar nada. La lista guardada no se toca, así que cuando llegue su `EXCHANGE_RATE` aparece sola (E19)                                                                                                                                                                                                         |
| **Todas las monedas declaradas sin tasa** (o la propia base sin tasa, con base no CUP)            | El selector desaparece —conjunto vacío, R23(4)— y la página queda como la de hoy: un importe y ningún elemento nuevo, igual que E10, aunque la lista **no** esté vacía. Con base no CUP y sin tasa de la base, nada es calculable: es el mismo caso                                                                                                                                                                                                                                                                                                            |
| **Producto sin precio resoluble**                                                                 | «Consultar» como hoy y **cero** equivalentes (E9). En `/[slug]/catalogo` y `/[slug]/buscar` sigue además fuera de todo rango de precio y último en los dos órdenes (`src/features/catalog/catalogFilters.test.ts:251`)                                                                                                                                                                                                                                                                                                                                         |
| **Código basura ya guardado en la columna**                                                       | Hoy no puede entrar: el único escritor valida `/^[A-Z]{3}$/` antes de escribir (`src/features/sync/displayCurrencies.ts:15`, `src/features/sync/server/handlers/business.ts:63-70`) y la columna nació con F-038, así que no hay filas anteriores. Aun así el lector **no confía en la forma**: descarta lo que no case ese patrón —reutilizando la constante exportada, no un segundo literal— y para un código bien formado pero desconocido (`ZZZ`) sin tasa no pinta nada (R5), y con tasa lo pinta con la rama de respaldo de `formatMoney`. Nunca un 500 |
| **Lista con muchas monedas** (40 códigos válidos; F-038 C10 garantiza que no hay tope)            | Se pintan **todos** los calculables, sin truncar (SP1). Dos consecuencias medibles y que hay que medir: el HTML crece (`npm run check:bundle` imprime el HTML gzip de la página más pesada) y se construyen N×M formateadores `Intl` por render, que es el coste real de `formatMoney` —un formateador memoizado por moneda es la mitigación obvia y es del arquitecto—                                                                                                                                                                                        |
| **La moneda elegida deja de ofrecerse** (el comercio la retira de la lista, o su tasa desaparece) | La página vuelve a enseñar solo el principal (más los equivalentes que queden, sin JavaScript) y la preferencia guardada se queda como está hasta que el comprador elija otra (R17, R23, E17). Los dos motivos caen en el **mismo** centinela: no hace falta distinguirlos                                                                                                                                                                                                                                                                                     |
| **`localStorage` no disponible o con JSON basura en la clave**                                    | Se ignora el valor ilegible, se trata como «sin preferencia», y no se lanza nada (R17)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Tasa que cambia entre pintar el catálogo y cotizar**                                            | Sin cambios respecto de hoy: el checkout lee fresco (`loadCurrentRates` en `quoteCart`, `src/features/orders/server/quote.ts:298`) y el `409 PRICE_CHANGED` sigue siendo el mecanismo (`src/features/orders/server/createOrder.ts:202-209`). El equivalente es aproximado, y por eso se marca                                                                                                                                                                                                                                                                  |
| **Lote con `BUSINESS` de dos negocios distintos**                                                 | Cada uno invalida **solo** sus sucursales, con una consulta por negocio y por lote (R18, memo de F-035). Un lote de 500 eventos sigue disparando una invalidación deduplicada por familia de tags                                                                                                                                                                                                                                                                                                                                                              |
| **`BUSINESS` de un negocio sin ninguna sucursal renderizable**                                    | Responde `processed` y no invalida nada, exactamente como el criterio 5 de F-035                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Marca (`Storefront`) con varias sucursales**                                                    | La invalidación cubre **todas** las sucursales renderizables de la marca, porque `createRenderableBranchLookup` delega en `expandBrandRevalidation`; el selector de marca (`kind: "selector"`) no pinta ningún importe, así que no lleva selector de moneda ni se invalida por esto                                                                                                                                                                                                                                                                            |

## Datos y contrato

**Lo que se lee, y de dónde.**

| Dato                      | Origen                                                                                                                              | Tipo                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Lista declarada           | `Business.displayCurrencies` (`prisma/schema.prisma:147`), vía `loadStore` (`src/features/catalog/server/queries.ts:117-186`)       | `string[]`, `[]` posible |
| Moneda base               | `Business.baseCurrencyCode`, ya en `StoreSummary.baseCurrencyCode` (`src/features/catalog/server/queries.ts:65`)                    | `string` (3 letras)      |
| Tasas vigentes            | `getStoreRates` (`src/features/catalog/server/queries.ts:417-422`) → `loadCurrentRates` (`src/features/catalog/server/rates.ts:51`) | `Record<string,string>`  |
| Importe mostrado          | `resolvePrice(...).price` (`src/lib/pricing.ts:65`)                                                                                 | `Money`                  |
| Total/subtotal del pedido | `QuoteResponse.subtotal` / la suma del checkout, en `quote.store.currencyCode`                                                      | cadena decimal + código  |

**Unidades y redondeo.** Todo importe es decimal de dos dígitos como cadena
(`Money.amount`, `src/lib/money.ts:21-25`); las tasas son «CUP por 1 unidad» con
seis decimales; el redondeo es half-up alejándose del cero sobre enteros
escalados, en una sola división por conversión. Nada de esto se decide aquí: es
`convert`, y ADR
`docs/adr/0030-la-tasa-vigente-la-decide-la-lectura.md` fija además **qué fila**
es la tasa vigente (una sola sentencia, `buildCurrentRatesSql`).

**Contrato con cuadrecaja: cero cambios.** La regla que este feature implementa
ya está publicada en `docs/sync-contract.md` v12/v12.1 (§ «`payload` de
`BUSINESS`», reglas ① y ②, y el párrafo del redondeo). No hay campo nuevo, ni
error nuevo, ni entidad nueva, así que **la versión del documento no se mueve**
por este feature. Si al implementarlo se descubre que lo publicado no es
implementable, entonces sí: versión menor y una línea en «Cambios respecto a…»,
como manda AGENTS.md § Documentación.

**Contrato interno que sí puede moverse.** Para que carrito y checkout puedan
calcular su equivalente con **las mismas** tasas con las que se calculó el
total, `QuoteResponse` (`src/features/orders/types.ts`) es el sitio natural:
`CartQuote` ya lleva `rates` (`src/features/orders/server/quote.ts:94`) y
`toQuoteResponse` simplemente no las publica. Es una API interna, no el contrato
del POS. La alternativa —que las páginas de carrito y checkout pasen tasas y
lista como props desde el servidor— también vale, pero deja la puerta a que el
equivalente use una tabla distinta de la del total. Lo que **no** es negociable
es la propiedad: el equivalente de un agregado se calcula con la misma tabla que
produjo ese agregado. La forma la elige el arquitecto.

## Criterios de aceptación propuestos

Los once primeros son los de `features.json`, en su orden, traducidos a algo que
se ejecuta. No se modifica ninguno (regla 3).

**C1 [ya] — tarjeta con base + equivalente aproximado.** Con un negocio de
`displayCurrencies = ["CUP","USD"]` y tasa de USD:
`curl -s localhost:3100/tienda-demo` contiene, dentro de la tarjeta de un
producto, el importe en CUP y un equivalente en USD con su marca de aproximado;
y una prueba de componente de `ProductCard` (hoy **no existe**,
`src/components/store/ProductCard.tsx` no tiene test propio) afirma los dos
importes y que el aproximado no es el elemento principal.

**C2 [ya] — todos los equivalentes en el HTML crudo.** Con
`["CUP","USD","MLC"]`, el `curl` de la misma URL contiene los dos equivalentes
de cada producto y **ninguna** clase o atributo estático que los oculte. Se
comprueba sobre el HTML, sin ejecutar JavaScript.

**C3 [ya] — la preferencia se recuerda y no crea variante de caché.** Dos
mitades: (a) `curl` de la misma URL con dos `Cookie:` distintas y dos
`Accept-Language` distintos devuelve cuerpos **idénticos** tras quitar todos los
`<script>` (ficha `smoke-diff-html-rsc-no-determinista`); (b) en un navegador
real, elegir USD, recargar y navegar a otra página de la tienda sigue enseñando
USD. Se añade una prueba de frontera: ningún módulo del árbol de `/[slug]` lee
cookies ni cabeceras para decidir moneda.

**C4 [ya] — moneda declarada sin tasa.** Con `["CUP","USD","EUR"]` y sin tasa de
EUR: el HTML tiene el equivalente de USD, **cero** apariciones de EUR como
importe, y el principal presente en todas las tarjetas. Unitario sobre la
función de R7 más el `curl`. **DH5 le añade una comprobación y no le quita
ninguna:** el EUR tampoco aparece entre las opciones del selector. El criterio 4
de `features.json` —«no se pinta para ese producto, los demás equivalentes sí se
pintan, y el importe principal no desaparece»— sigue cumpliéndose **palabra por
palabra**: la poda es del control, no del importe. Y el criterio 4 se sigue
verificando igual (`curl` + unitario); lo del selector es aserto nuevo, en C12.

**C5 [ya] — la base aunque no esté en la lista.** Con `["USD"]` y base CUP: el
principal sigue en CUP en el HTML servido. Unitario sobre la función de R7 con
la base ausente de la lista. **DH5 no lo toca:** la base nunca fue una opción del
selector —es el principal, y «solo la moneda base» es el centinela, no una
moneda—, así que el criterio 5 de `features.json` se cumple igual y se verifica
igual. Caso deliberado que lo prueba: `["EUR"]` con base CUP y sin tasa de EUR
deja la página sin selector y **con** el principal en CUP.

**C6 [ya] — el equivalente coincide al céntimo con lo que se cobra.** Para el
mismo producto: se lee el principal y el equivalente del HTML, se cotiza y se
crea el pedido (`POST /api/orders/quote` y `POST /api/orders`) y se comprueba
(a) principal === `unitPrice` del pedido, en la moneda base; (b) equivalente
=== `convert(unitPrice, moneda_elegida, tasas de esa cotización)`. Ver I1: el
criterio, tal como está escrito, no se puede tomar más literalmente que esto
porque el checkout **nunca** cobra en la moneda del equivalente.

**C7 [ya] — el ancla no se salta.** Unitario: base `MLC`, producto en `USD`,
equivalente en `EUR`, tasas de las tres; el equivalente es exactamente
`convert(convert(precio_USD,"MLC",tasas),"EUR",tasas)` al céntimo, y no coincide
con ninguna variante que multiplique por `rate_USD/rate_EUR` sin pasar por el
ancla cuando esa variante difiera. Se hace en el proyecto `node`, sin base de
datos: no hay negocio sembrado con base distinta de CUP (`prisma/seed.ts:348`,
`prisma/seed.ts:574`).

**C8 [ya] — una tasa nueva cambia los equivalentes en la primera visita.**
Guion de humo: `curl` (queda cacheado), `POST /api/internal/sync/catalog` con un
`EXCHANGE_RATE` de una moneda sintética declarada, `curl` otra vez → el
equivalente cambió, sin esperar 3600 s. Es el escenario de F-035 con el
equivalente en vez del principal.

**C9 [ya] — sin monedas extra, nada nuevo.** Un negocio con `[]`: se comparan el
HTML de antes y el de después del feature para la misma URL (quitando los
`<script>`) y son **idénticos**; y no aparece selector en la cabecera.

**C10 [ya] — el JavaScript añadido, medido y anotado.** `npm run check:bundle`
antes y después, con las dos cifras (JS de cliente gzip de la página más pesada y
HTML gzip) escritas en `.agent/progress/F-039.md`; y la página con JavaScript
deshabilitado sigue navegable y con todos los importes (que es C2).

**C11 [ya] — `bash .agent/verify.sh F-039 --full` termina en 0.**

**C12 [nuevo] — un solo selector en la cabecera que aplica a todo (DH2), y solo
con monedas ofrecibles (DH5).** Dos mitades: (a) elegir USD en la cabecera de
`/[slug]` y navegar a `/[slug]/c/...`, `/[slug]/catalogo`, `/[slug]/buscar` y
`/[slug]/p/...` enseña el equivalente en USD en las cinco, sin volver a elegir;
(b) con `["CUP","USD","EUR"]` y sin tasa de EUR, las opciones del selector son
exactamente `USD` y «solo la moneda base» —**cero** apariciones de `EUR` en el
control—, y con la tasa de EUR aplicada (mismo guion que C8) el `EUR` aparece en
la primera visita posterior (E19). La mitad (b) se puede afirmar además con un
unitario sobre la función pura que decide las opciones (R23), sin navegador.

**C13 [nuevo] — carrito y checkout (DH3).** Con dos líneas y USD elegido:
`/[slug]/carrito` enseña el subtotal en base y su equivalente aproximado en USD
con el aviso del cobro; `/[slug]/checkout` lo mismo sobre el total; y el
`POST /api/orders` que se envía lleva el `expectedTotal` en base, idéntico al de
antes de este feature (comparado en el test de `CheckoutForm`, que ya existe:
`src/features/cart/components/CheckoutForm.test.tsx`).

**C14 [nuevo] — escribir la lista invalida, y solo cuando escribe (R18).**
Sobre el `POST` del route handler con `next/cache` espiado, como hizo F-035
(`src/features/sync/server/handlers/exchangeRateAllDraft.db.test.ts`): un
`BUSINESS` que escribe dispara `revalidateTag` de `storeTag`/`storeCatalogTag`
de **cada** sucursal renderizable del negocio y de ninguna otra; un `stale`, un
`BUSINESS_DELETE_NOT_SUPPORTED` y un `BUSINESS_DISPLAY_CURRENCIES_INVALID`
disparan **cero**; y un lote con dos `BUSINESS` del mismo negocio hace **una**
consulta de sucursales, no dos.

**C15 [nuevo] — los equivalentes ocultos no los anuncia un lector de pantalla
(R15).** Con USD elegido, el nombre accesible de la tarjeta contiene el precio en
base y el equivalente en USD, y **no** contiene el de MLC.

**C16 [nuevo] — la moneda de referencia no cambia el conjunto ni el orden
(R14).** Con USD elegido, `/[slug]/catalogo?precio_max=500` devuelve exactamente
los mismos productos, en el mismo orden, que con la preferencia sin poner: la
regresión de F-027 se comprueba con su propia suite
(`src/features/catalog/catalogFilters.test.ts`).

## Incongruencias detectadas

**I1 — el criterio 6 no se puede tomar literalmente: el checkout nunca cobra en
la moneda del equivalente.** «El equivalente coincide al céntimo con lo que
cobra el checkout para el mismo producto» — lo que cobra el checkout está en la
moneda base (`quote.store.currencyCode = business.baseCurrencyCode`,
`src/features/orders/server/quote.ts:138`) y el equivalente, por definición, está
en otra. La lectura que sí se puede ejecutar es la de C6, en dos comparaciones:
el **principal** es idéntico al importe cobrado, y el **equivalente** es
`convert` de ese importe cobrado con las mismas tasas. No propongo criterio
nuevo que lo sustituya (regla 3); si el humano quería otra cosa, esto es lo que
hay que corregir antes de diseñar.

**I2 — DH3 (carrito y checkout) es superficie que ningún `acceptance_criteria`
nombra.** Los once hablan de la tarjeta y de la página de catálogo. DH3 la añade
sin modificar ninguno, y por eso está en C13/C15 como `[nuevo]`. Queda anotado
porque `sdd.sh done` cuenta casillas contra `features.json`: los `[nuevo]` no
suman ahí y no pueden usarse para cerrar el feature.

**I3 — el criterio 9 se verifica contra un HTML que ya cambió en la base
compartida.** «Muestra exactamente lo que muestra hoy» necesita un negocio con
lista vacía, y el guion de humo de F-038 dejó a `seed-negocio-1` con
`["CUP","USD","MLC"]` a propósito (`.agent/specs/F-038/impl.md` § Qué necesita
quien pruebe). O se usa `seed-negocio-2` (base CUP, lista vacía, sin tasas), o se
vacía la lista con `--business=empty` antes de medir. No es un defecto de nada:
es una precondición que hay que escribir en el guion.

**I4 — `displayPrice` (`src/lib/pricing.ts:128`) sigue sin llamantes en
producción.** Es exactamente «el precio en la moneda en que el comprador
navega», que es lo que este feature parece pedir, y **no** es lo que hace falta:
aquí el precio mostrado sigue siendo el de la base y lo que se añade son
equivalentes al lado (R3). Lo anoto para que nadie lo cablee creyendo que cierra
el feature: usarlo como principal sería exactamente la confusión que S-008 vino
a evitar. Si sigue sin llamantes al cerrar F-039, sobra, y retirarlo es un
`refactor:` de otro ciclo.

**I5 — el contrato dice que la lista incluye la moneda base y AGENTS.md no tiene
nada que ajustar, pero el aviso de v12 sí quedó cerrado.** No es una
contradicción: es la confirmación de que este feature **no** mueve
`docs/sync-contract.md` (la v12.2 ya retiró el aviso al cerrar F-038). Se anota
porque el criterio 13 de F-038 movió la versión y alguien podría suponer que
F-039 tiene que moverla otra vez. No. **Y sigue siendo No después de DH5**, que
es lo que alguien podría cuestionar al leer la regla ① («la lista no se poda por
falta de tasa») al lado de un selector que sí poda: la regla habla de lo que se
guarda y del importe que se omite, y las dos cosas se cumplen; el selector es
superficie nuestra y posterior. El razonamiento completo está en § Las dos capas,
y el tercer conjunto que separó DH5, escrito ahí a propósito para que lo
encuentre quien lea esto en seis meses.

**I6 — el selector aparece en páginas donde no convierte nada.** La cabecera es
un `layout.tsx` compartido por todo `/[slug]`, incluido
`/[slug]/pedido/[code]`, donde el importe es histórico y está fuera de alcance.
Consecuencia aceptada: ahí el selector no tiene efecto visible. La alternativa
—que el layout sepa qué pinta cada página— es peor que el defecto. Si molesta,
se resuelve con una frase, no con arquitectura.

**I7 — DH5 deja desactualizado un contrato ya escrito en
`.agent/specs/F-039/architecture.md`, y no es mío para arreglarlo.** La firma
`equivalentCurrencies` (L112-124 de ese documento) lleva escrito en su comentario
lo contrario de lo que ahora exige R23: «NO se poda por falta de tasa (R1): es lo
que ofrece el selector, y una moneda sin tasa sigue siendo una opción (E6)». Dos
cosas siguen siendo ciertas de esa firma —que no se poda **el conjunto que se
intenta pintar** y que es la lista menos la base—, y una dejó de serlo: que sea
lo que ofrece el selector. Quien la ajuste tiene el criterio ya escrito y una
función hermana que ya lo aplica en el mismo archivo (`defaultEquivalentCurrency`
devuelve la primera **calculable**, o `null`): las opciones del selector son ese
mismo filtro aplicado a todo el conjunto, no solo a su primer elemento, así que
lo natural es una función que las dos compartan en vez de dos filtros paralelos.
Es del arquitecto; lo anoto porque un comentario que miente es peor que ninguno,
y porque el orquestador ya avisó de que él se lo dice al diseñador pero no al
arquitecto.

## Huecos y preguntas al humano

Las tres van con su decisión por defecto ya escrita como regla, así que **ninguna
bloquea** al arquitecto ni al diseñador: por eso este documento cierra en
`estado: listo`, con el mismo criterio que `.agent/specs/F-038/spec.md`. Las tres
decisiones del 2026-09-08 (DH1, DH2, DH3) están incorporadas y no se vuelven a
preguntar.

> **CERRADAS por el humano el 2026-09-08**, anotado por el orquestador: las tres
> en la opción **(a)**, la recomendada de cada una. Es decir: SP1(a) el estado
> inicial enseña la **primera** moneda declarada con equivalente calculable, y
> el selector lleva una opción explícita «solo la moneda base» para volver atrás;
> SP2(a) **sin tope** de equivalentes, se mide con `npm run check:bundle` y se
> anota (R21); SP3(a) **solo** el importe que se cobra lleva equivalente — el
> tachado y los chips de rango de F-027 quedan **fuera**, como ya decía § Fuera
> punto 5. Lo de abajo se conserva como el razonamiento con el que se decidió.
>
> **Y una decisión posterior, DH5 (humano, 2026-09-08), que cambió un requisito
> de este documento:** una moneda declarada **sin tasa vigente no se ofrece en el
> selector**. Está incorporada en R23 (nueva), R1, R2, R17, § Las dos capas y el
> tercer conjunto, E6, E17, E19, las dos filas de § Casos límite y los asertos de
> C4, C5 y C12. No cierra ninguna `SP` de esta spec —las tres ya las había
> cerrado DH4—: cierra **DP3 del diseñador**, y con ella cae la frase D6 del
> diseño («Ahora no tenemos el cambio de EUR.»), porque desaparece el estado que
> explicaba. `docs/sync-contract.md` no se edita (I5, y § Las dos capas explica
> por qué la regla ① sigue siendo cierta).

**SP1 — con JavaScript activo y sin haber elegido nada todavía, ¿qué equivalente
se ve?**
Qué falta: el estado inicial. DH1 fija «solo el equivalente de la moneda
elegida», y no dice qué pasa antes de la primera elección. Por qué importa: si el
defecto es «ninguno», un comprador con JavaScript que nunca toque el selector no
verá el feature **nunca**, y el criterio 1 comprobado en un navegador (no en el
`curl`) fallaría; si el defecto es «la primera declarada», el feature se ve solo
y el selector sirve para cambiarlo. Por qué no bloquea: R17 y E3 valen igual con
cualquiera de las dos. Opciones: (a) la **primera** moneda de la lista declarada
que tenga equivalente calculable —defecto que asumo—; (b) ninguno hasta que el
comprador elija; (c) todos hasta que elija (ruido en la rejilla, que es lo que
DH1 descartó). **Recomendación: (a)**, y que el selector incluya una opción
explícita «solo la moneda base» para poder volver atrás — sin ella la elección
es irreversible.

**SP2 — ¿hay tope de equivalentes por tarjeta?**
Qué falta: qué hacer si un negocio declara 40 monedas (F-038 garantiza que no hay
tope en la lista, criterio 10). Por qué importa: son 40 importes por tarjeta en
el HTML de una rejilla de 24 productos; el criterio 2 exige que **viajen**, así
que el coste es bytes reales y `Intl` por importe. Por qué no bloquea: con dos o
tres monedas —lo real— no se nota, y la medición del criterio 10 dará el número
antes de que nadie decida a ciegas. Opciones: (a) sin tope, se mide y se anota
—defecto—; (b) un tope de N (por ejemplo 5) por orden de la lista, con el resto
descartado en silencio; (c) un tope solo en la **tarjeta** y todos en la ficha
de producto. **Recomendación: (a)**: un tope es una poda invisible para el
comerciante, que es justo lo que la regla ① del contrato prohíbe hacer con la
lista; y si la medición saliera mal, el tope es un feature nuevo del humano, no
una decisión de este ciclo.

**SP3 — ¿el equivalente acompaña también al importe tachado y a los chips de
rango de precio?**
Qué falta: el borde de la superficie. Por qué importa: el tachado y los chips son
importes visibles que quedarían «en otra moneda» que el resto de la página; si
se convierten, el HTML y el ruido crecen; si no, hay dos clases de importe en la
misma tarjeta. Por qué no bloquea: está escrito como «Fuera» punto 5 y el
diseñador puede trabajar con eso. Opciones: (a) fuera, solo el importe que se
cobra lleva equivalente —defecto—; (b) también el tachado; (c) también los chips
de F-027 (que además obligaría a `formatWholeMoney` a decidir qué hacer con dos
monedas en un chip). **Recomendación: (a)**.

## No decidido a propósito

1. **Dónde vive la función pura de R7** y cómo se llama (`src/lib/` junto a
   `pricing.ts`, o `src/features/catalog/`), y si devuelve `Money[]` o pares
   `{ currency, amount }`. Del arquitecto. Lo que no se negocia: que sea **una**,
   pura, y que la llamen las cuatro pantallas.
2. **El mecanismo exacto de revelar/ocultar** (atributo en la raíz + CSS
   generado, `hidden` por elemento, un `<style>` inyectado) y si hace falta un
   guion en línea antes del pintado para que no se vean todos un instante. Del
   diseñador y del arquitecto; comprobado que hay al menos una forma viable en
   ~300 bytes. Lo que no se negocia: R11, R12, R13 y R15.
3. **Las palabras exactas** de la marca de aproximado y del aviso del cobro
   («≈», «aprox.», «Cobramos en CUP»). Del diseñador, en español (AGENTS.md
   § Idioma).
4. **Si las tasas y la lista viajan en `QuoteResponse` o como props** en carrito
   y checkout (§ Datos y contrato). Del arquitecto; la propiedad que tiene que
   quedar es «la misma tabla que produjo el agregado».
5. **Si `outcomeOf`** (`src/features/sync/server/handlers/misc.ts:51-53`) se
   comparte con `src/features/sync/server/handlers/business.ts` o se duplica en tres líneas. Del
   arquitecto.
6. **El nombre y el valor exactos de la clave de `localStorage`** y en qué
   archivo de `src/constants/` vive. Del arquitecto; la convención ya está
   (`qab.<cosa>.v1`).
7. **El reparto de las pruebas entre archivos**, incluida la decisión de abrir el
   primer test de `ProductCard` (hoy no tiene) y en qué `*.db.test.ts` vive C14.
   Del arquitecto y del `sdd-tester`.
