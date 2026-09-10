---
feature: F-040
agente: sdd-spec
actualizado: 2026-09-10T18:13:55Z
estado: listo
---

> Cuatro decisiones del humano del 2026-09-10 llegan a este documento como
> **entrada**, no como algo que se vuelva a discutir (`.agent/progress/F-040.md`
> § «Decisiones tomadas»): el panel queda **fuera** (SP1 del feature), el
> checkout **no cambia su respuesta** y se demuestra ejecutando (SP2), el
> alcance son las **siete** vistas públicas, y el motivo es un **código interno
> nuevo** en `src/constants/storeClosure.ts` que la columna
> `Store.disabledReasonCode` no llega a ver nunca.
>
> El **2026-09-10**, ya con este documento escrito, el humano contestó además
> las dos preguntas que quedaban: **SP3 → opción (a)**, «las tres leen el
> catálogo», y **SP4 → «selector no, `BranchBar` sí»**. Las dos están
> incorporadas abajo (R9, R16, E8, E9, E13, E21) y la spec queda sin ninguna
> pregunta bloqueante.

## Problema

Una tienda publicada, con productos visibles, cuyo negocio tiene una moneda base
sin tasa vigente —o cuyos productos están todos en una moneda sin tasa— enseña
hoy **un catálogo vacío y sin explicación**. No es un fallo: es la degradación
producto a producto que F-039 dejó a propósito. `resolvePrice`
(`src/lib/pricing.ts:65`) llama a `convert` (`src/lib/money.ts:156`), que lanza
`MoneyError` (`src/lib/money.ts:35`) antes que inventar un precio; `safeResolve`
(`src/components/store/ProductCard.tsx:135`) y `resolveProductPrice`
(`src/features/catalog/catalogFilters.ts:255`) la atrapan y devuelven `null`
para que un producto sin tasa no tumbe la página.

Esa degradación es correcta para **un** producto y es muda para **todos**: con
N productos y N «Consultar», el comprador ve una tienda que no dice ni un
precio, y el comerciante ve lo mismo sin ninguna causa a la que agarrarse. Un
negocio con una moneda base bien formada y falsa no tiene «N productos sin
precio»: tiene la tienda entera muda.

Este feature convierte ese estado en algo que la tienda **dice**, reusando la
presentación de cierre que ya existe, sin escribir nada y sin arreglar la causa
—que es del negocio, no nuestra.

## Alcance

### Dentro

1. **La condición derivada** «hay productos y ninguno resuelve precio»,
   calculada en tiempo de render sobre el catálogo de la sucursal, sin columna
   nueva y sin escritura (R1-R4).
2. **Las siete vistas públicas** que hoy montan `StoreClosedNotice`
   (`src/components/store/StoreClosedNotice.tsx`) para una tienda cerrada pasan
   a montarlo también para una tienda muda, con el motivo nuevo:
   - `src/app/[slug]/page.tsx` (guarda actual en L116)
   - `src/app/[slug]/p/[productSlug]/page.tsx` (L115)
   - `src/app/[slug]/catalogo/page.tsx` (L122)
   - `src/app/[slug]/buscar/page.tsx` (L132)
   - `src/app/[slug]/c/[categorySlug]/page.tsx` (L90)
   - `src/app/[slug]/carrito/page.tsx` (L30)
   - `src/app/[slug]/checkout/page.tsx` (L31)
3. **Un código de motivo interno nuevo** en `src/constants/storeClosure.ts`, con
   la misma forma que `PLATFORM_ROLLOUT_REASON_CODE` (L33): constante propia,
   **fuera** de `STORE_DISABLED_REASONS`, y por tanto fuera de la lista que el
   panel ofrece y del `enum` que valida su escritura
   (`src/features/admin/schemas.ts:58`).
4. **Su frase** en `resolveStoreClosureHeadline` (`src/lib/storeClosure.ts:15`),
   en una rama propia delante del respaldo por `disabledAt`.
5. **La verificación del camino de pedido** (criterio 5), que hoy ya degrada:
   `POST /api/orders/quote` responde 200 con las líneas `orderable: false`,
   `reason: "NO_PRICE"`, y `POST /api/orders` responde 409 `ITEMS_UNAVAILABLE`.
   Se demuestra ejecutando, incluidos los dos caminos que podrían lanzar —la
   cuota de domicilio (`src/features/orders/server/createOrder.ts:239-251`) y
   `buildRateSnapshot` (`createOrder.ts:440`)—; ninguno cambia.
6. **Las dos lecturas que les faltan a tres de las siete vistas** (SP3, opción
   (a), decidida el 2026-09-10): `/[slug]/buscar` en su camino simple lee
   `getStoreCatalog`; `/[slug]/carrito` y `/[slug]/checkout` leen
   `getStoreCatalog` y `getStoreRates`. Son las **mismas** entradas cacheadas y
   los mismos tags que ya sirven a `/[slug]`: ninguna entrada de caché nueva,
   ningún tag nuevo, cero round-trips en caliente (R9).
7. **El `BranchBar` de la sucursal que se está mirando** (SP4, decidida el
   2026-09-10): en las cinco vistas que lo montan, una tienda muda lo pinta con
   `isOpen={false}`, igual que hoy lo pinta una tienda cerrada. Coste cero: el
   catálogo ya está en la mano (R16, E21).

### Fuera (explícito)

1. **Arreglar la causa.** Que un negocio declare una moneda base sin tasa, o
   ponga todo su catálogo en una moneda sin tasa, es un dato del negocio. Aquí
   no se corrige, no se sustituye por otra moneda y no se avisa al POS. Lo
   declara el propio feature en `.agent/features.json` § `notes`.
2. **Validar el código de moneda contra un catálogo de monedas reales.** `XXX`
   entra por el cable porque `baseCurrency` es `z.string().length(3)`; comprobar
   contra ISO 4217 sería otro feature. También lo declara el feature.
3. **El panel del comerciante** (SP1, decidido el 2026-09-10): ninguna
   superficie nueva de panel, ningún aviso al comerciante, ninguna consulta
   nueva en `src/features/admin/`. Si se quiere, es un feature aparte que
   escribe el humano (regla 4).
4. **Cambiar la respuesta del checkout o del carrito** (SP2, decidido el
   2026-09-10): ni el código HTTP, ni el cuerpo, ni `QuoteLineReason`
   (`src/features/orders/types.ts:13`), ni `CartLineStatus`. Una tienda muda
   sigue siendo `PUBLISHED`, así que `POST /api/orders/quote` **no** responde
   `STORE_CLOSED`: eso sería un cambio de contrato con el island del carrito.
5. **Escribir la columna.** `Store.disabledReasonCode`, `disabledMessage`,
   `disabledAt` y `status` no se tocan (ADR 0017 (a), criterio 4).
6. **La metadata de las siete vistas.** Ni `robots: { index: false }` ni un
   título distinto: hacerlo obligaría a leer el catálogo y las tasas dentro de
   `generateMetadata` en páginas que hoy no lo hacen (por ejemplo
   `src/app/[slug]/page.tsx:38`), que es exactamente el coste que el criterio 6
   quiere evitar. El cuerpo de la página lleva el mensaje; el `<title>` se queda
   como está (R15).
7. **El selector de marca.** `src/app/[slug]/page.tsx:87-110` y `BranchList`
   siguen decidiendo «abierta/cerrada» por `Store.status`, y no se tocan: marcar
   una sucursal muda en la lista de una marca exigiría leer el catálogo de
   **cada** sucursal, N consultas donde hoy hay cero (SP4, decidida el
   2026-09-10). El `BranchBar` de la propia vista sí se marca — § Dentro,
   punto 7, y R16.
8. **La caché y su invalidación.** No hay entrada de caché nueva, tag nuevo ni
   mecanismo nuevo: la tienda deja de estar muda con el mismo
   `revalidateTag(storeTag/storeCatalogTag)` que ya dispara la llegada de un
   `EXCHANGE_RATE` (F-035) o de un `PRODUCT` (R10).

## Actores y precondiciones

- **Quien compra**, que abre cualquiera de las siete URLs públicas de una
  sucursal. No hay sesión, no hay permiso que comprobar.
- **La sucursal**, resuelta por `requireResolution` a `kind: "branch"` y con
  `status === "PUBLISHED"` (`requireStore`,
  `src/features/catalog/server/queries.ts:231`). Una `DRAFT` o inexistente sigue
  siendo 404; una `SUSPENDED` sigue enseñando **su** cierre (R6).
- **El catálogo** de esa sucursal, tal cual lo devuelve `getStoreCatalog`
  (`queries.ts:346`): productos `visible: true`, `deletedAt: null`, de una
  tienda `PUBLISHED` (`loadCatalog`, `queries.ts:261`), con sus promociones
  vigentes indexadas contra la misma foto.
- **Las tasas** de ese negocio, tal cual las devuelve `getStoreRates`
  (`queries.ts:442`), que es la misma lectura que usa el checkout.

Nada de esto es nuevo: los cuatro ya se leen hoy en cinco de las siete vistas.

## Comportamiento esperado

Notación: «tienda muda» es la tienda que cumple R1. `<CODE>` es el código de
motivo nuevo (R5) y `<FRASE>` la frase que `resolveStoreClosureHeadline` le
asocia. Todas las respuestas son **200**, salvo donde se diga otra cosa.

### E1 — la portada de una tienda muda lo dice (criterio 1)

**Dado** un negocio con `baseCurrencyCode = "XXX"` y sin ninguna
`ExchangeRate` vigente para `XXX`, y una sucursal `PUBLISHED` con tres
`StoreProduct` visibles con `syncedPriceCurrency = "CUP"`,
**cuando** se pide `GET /<slug>`,
**entonces** la respuesta es 200 y su HTML contiene `<FRASE>` y el nombre de la
tienda, y **no** contiene ni una sola tarjeta de producto, ni el texto «Esta
tienda todavía no tiene productos publicados.», ni la palabra «Consultar».

### E2 — solo algunos sin precio: nada cambia (criterio 2)

**Dado** el mismo negocio con una tasa vigente para `CUP` que hace resoluble
uno de los tres productos,
**cuando** se pide `GET /<slug>`,
**entonces** la respuesta trae las **tres** tarjetas, dos con «Consultar» y una
con su importe, y el HTML **no** contiene `<FRASE>` ni ningún elemento del aviso
de cierre. Lo mismo, en la misma corrida, para `/<slug>/catalogo`,
`/<slug>/c/<categoria>`, `/<slug>/buscar?q=<termino>` y `/<slug>/p/<producto>`.

### E3 — una tienda vacía sigue vacía, y es legítimo (criterio 3)

**Dado** una sucursal `PUBLISHED` sin ningún `StoreProduct` visible,
**cuando** se pide `GET /<slug>`,
**entonces** la respuesta es byte a byte la de hoy: «Esta tienda todavía no tiene
productos publicados.», sin `<FRASE>` y sin aviso. Y `/<slug>/catalogo` responde
con su propio mensaje vacío de hoy (`catalogo/page.tsx:158-175`), también sin
aviso.

### E4 — la ficha dice lo mismo que la portada (criterio 7)

**Dado** la tienda muda de E1 y uno de sus productos,
**cuando** se pide `GET /<slug>/p/<producto>`,
**entonces** la respuesta es 200 con `<FRASE>` —**la misma cadena** que E1— y sin
importe, sin «Consultar precio», sin insignia de disponibilidad y sin el botón
de añadir al carrito.

### E5 — la ficha de un producto que no existe, en una tienda muda

**Dado** la tienda muda de E1,
**cuando** se pide `GET /<slug>/p/no-existe`,
**entonces** la respuesta es 200 con el mismo aviso, **no** un 404: mismo trato
que ya recibe cualquier `productSlug` bajo una tienda `SUSPENDED`
(`p/[productSlug]/page.tsx:112-115`, «no way to leak whether a given productSlug
exists»). Decisión de esta spec, R7.

### E6 — la vista por categoría (criterio 1, alcance de las siete vistas)

**Dado** la tienda muda de E1, cuyos productos están en la categoría `bebidas`,
**cuando** se pide `GET /<slug>/c/bebidas` y también `GET /<slug>/c/no-existe`,
**entonces** las dos responden 200 con el aviso y `<FRASE>`, ninguna 404 y
ninguna con rejilla de productos. Mismo criterio que la rama `SUSPENDED` de
`c/[categorySlug]/page.tsx:85-90`.

### E7 — el catálogo filtrable

**Dado** la tienda muda de E1,
**cuando** se pide `GET /<slug>/catalogo?orden=precio_asc&precio_min=10`,
**entonces** la respuesta es 200 con el aviso, sin panel de facetas, sin chips y
sin resultados — cualesquiera que sean los `searchParams`.

### E8 — la búsqueda no busca, y no registra nada

**Dado** la tienda muda de E1,
**cuando** se pide `GET /<slug>/buscar?q=agua`,
**entonces** la respuesta es 200 con el aviso, con el `BranchBar` en su forma
cerrada (E21), y al terminar la petición **no** existe ninguna fila nueva en el
registro de búsquedas (`src/features/catalog/server/searchLog.ts`), contado
antes y después. Es el mismo trato que la rama de tienda cerrada de
`buscar/page.tsx:131-157`, que tampoco busca ni registra (R11).

La condición se evalúa aquí sobre `getStoreCatalog`, que esta página lee **a
propósito desde este feature** en su camino simple (SP3, opción (a)): es la
entrada cacheada que `/[slug]` ya paga, y en su camino filtrado la página ya la
leía vía `getStoreCategories` (`buscar/page.tsx:220-223`). La evaluación **no**
se hace sobre los resultados de la búsqueda: lo prohíbe R2.

### E9 — carrito y checkout

**Dado** la tienda muda de E1 y un carrito guardado en el navegador,
**cuando** se piden `GET /<slug>/carrito` y `GET /<slug>/checkout`,
**entonces** las dos responden 200 con el aviso, sin montar `CartView` ni
`CheckoutForm`, y con la nota extra sobre el carrito guardado que esas dos
pantallas ya usan hoy (`src/app/[slug]/carrito/page.tsx:42`,
`src/app/[slug]/checkout/page.tsx:43`). Ninguna de las dos monta `BranchBar` hoy
y ninguna lo estrena aquí (`src/components/store/BranchBar.tsx:10-13`: nunca en
`/carrito` ni en `/checkout`).

Estas dos son las que más lecturas ganan: hoy `/carrito` solo lee
`requireStore` y `/checkout` lee además `loadStoreForOrder` y, si procede, la
cobertura de zonas. Con SP3(a) las dos leen `getStoreCatalog` y `getStoreRates`
—cacheadas, con los tags que ya existen— para poder evaluar la condición. El
criterio 6 **no** se cuenta en estas dos URL (R9, E13).

### E10 — la detección no escribe nada (criterio 4)

**Dado** la tienda muda de E1, con `SELECT status, "disabledReasonCode",
"disabledMessage", "disabledAt" FROM "Store" WHERE id = $1` capturado antes,
**cuando** se visitan las siete URLs de arriba, en ese orden,
**entonces** el mismo `SELECT` devuelve **exactamente** la misma fila: `status`
sigue en `PUBLISHED`, y las tres columnas de motivo siguen como estaban
(típicamente `NULL`). El código nuevo no aparece en la base en ningún momento.

### E11 — cotizar en una tienda muda (criterio 5)

**Dado** la tienda muda de E1,
**cuando** se hace `POST /api/orders/quote` con dos de sus productos,
**entonces** responde **200** con `lines[*].orderable === false`,
`lines[*].reason === "NO_PRICE"`, `subtotal === "0.00"` y
`discountTotal === "0.00"` en la moneda base. No responde `STORE_CLOSED`, no
responde 500.

### E12 — crear un pedido en una tienda muda (criterio 5)

**Dado** la tienda muda de E1 y `SELECT count(*) FROM "Order"` capturado antes,
**cuando** se hace `POST /api/orders` con esos mismos productos —una vez con
`fulfillment: "PICKUP"` y otra con `"DELIVERY"` sobre una tienda `ZONE_BASED`
con `zoneCode` válido—,
**entonces** las dos responden **409** `{"error":"ITEMS_UNAVAILABLE"}` con una
línea por producto y `reason: "NO_PRICE"`, el `count(*)` no se mueve, y la
salida del servidor no contiene ninguna línea que empiece por algo acabado en
`Error` ni un `⨯` (AGENTS.md § «Cosas que muerden»: un 500 aquí imprimiría
`[orders] create failed` con `console.error`, `src/app/api/orders/route.ts:41`,
y pondría roja la etapa `smoke` sola).

### E13 — la condición no añade consultas (criterio 6)

**Dado** el catálogo de una tienda cualquiera y el log de consultas de Prisma
activado como en `.agent/specs/F-025/tests.md` § «Cómo se verificó C13»,
**cuando** se piden, con el mismo calentamiento y antes y después del cambio,
las **cuatro vistas de catálogo** —las que la ADR 0025 cubre y el criterio 6
cita—: `GET /<slug>`, `GET /<slug>/c/<categoria>`, `GET /<slug>/catalogo` y
`GET /<slug>/p/<producto>`,
**entonces** el número de líneas `prisma:query` es **idéntico** en los dos
lados, en las cuatro URLs.

En `/[slug]/buscar`, `/[slug]/carrito` y `/[slug]/checkout` **no** se cuenta:
por decisión del humano del 2026-09-10 (SP3, opción (a)) esas tres estrenan una
lectura de la caché de datos —`getStoreCatalog`, más `getStoreRates` en dos de
ellas—, sin entrada de caché nueva ni tag nuevo, y eso queda documentado en R9
en vez de medido aquí.

### E14 — la tienda deja de estar muda sola

**Dado** la tienda muda de E1, ya renderizada y cacheada,
**cuando** llega por el sync un `EXCHANGE_RATE` que da tasa vigente a la moneda
que faltaba,
**entonces** la **primera** visita posterior a `/<slug>` enseña el catálogo con
sus precios y ya no enseña `<FRASE>`, sin esperar el suelo de revalidación de
3600 s y sin ninguna invalidación nueva: la que ya dispara F-035 basta (R10).

### E15 — un cierre de verdad gana (precedencia)

**Dado** una sucursal `SUSPENDED` por el panel, con
`disabledReasonCode = "VACACIONES"`, cuyo catálogo además no resolvería ningún
precio,
**cuando** se pide `GET /<slug>`,
**entonces** la respuesta enseña la frase de `VACACIONES`, **no** `<FRASE>`, y no
se lee el catálogo (hoy `loadCatalog` filtra `status: "PUBLISHED"`, así que para
una `SUSPENDED` devolvería `[]` de todas formas y la condición sería falsa por
R3).

### E16 — el ancla no se salta

**Dado** un negocio con `baseCurrencyCode = "CUP"` y todos sus productos con
`syncedPriceCurrency = "EUR"` sin tasa vigente,
**cuando** se pide `GET /<slug>`,
**entonces** la tienda es muda igual que en E1: la base `CUP` nunca falla por sí
sola —`convert` la trata como el ancla, `src/lib/money.ts:160`—, pero sí puede
fallar el paso desde la moneda de cada producto.

### E17 — sin stock no es sin precio

**Dado** una tienda cuyos productos resuelven precio y están todos
`OUT_OF_STOCK`,
**cuando** se pide `GET /<slug>`,
**entonces** enseña el catálogo de siempre con sus insignias: la disponibilidad
no entra en la condición (R1).

### E18 — una promoción que no se puede aplicar cuenta como sin precio

**Dado** un producto cuyo importe base sí convierte, pero con una promoción
`FIXED` denominada en una moneda sin tasa, de modo que `resolvePrice` lanza,
**cuando** se evalúa la condición,
**entonces** ese producto cuenta como «no resuelve precio», porque es
exactamente lo que ya ven `safeResolve` y `resolveProductPrice`: la misma
llamada, el mismo `catch` (R1).

### E19 — el código nuevo no se puede escribir desde el panel (criterio 4)

**Dado** el código `<CODE>`,
**cuando** se ejecuta `isStoreDisabledReasonCode("<CODE>")` y
`storeStatusBodySchema.safeParse({ enabled: false, reasonCode: "<CODE>" })`,
**entonces** el primero devuelve `false` y el segundo falla la validación: el
panel no lo ofrece en su lista (`StorePublicSwitch.tsx:215`) y su endpoint lo
rechaza (`src/features/admin/schemas.ts:58`). Mismo trato que
`PLATFORM_ROLLOUT_REASON_CODE`.

### E20 — nada cambia para el 99 % de las tiendas

**Dado** cualquier sucursal cuyo catálogo resuelve al menos un precio, o que no
tiene productos,
**cuando** se piden sus siete URLs antes y después del cambio,
**entonces** el HTML es idéntico byte a byte en las siete.

### E21 — la barra de sucursal no dice «abierta» encima del aviso

**Dado** la tienda muda de E1, en una marca con dos o más sucursales
renderizables (para que el `BranchBar` se pinte con su enlace),
**cuando** se piden sus cinco vistas con barra —`/<slug>`,
`/<slug>/p/<producto>`, `/<slug>/catalogo`, `/<slug>/buscar?q=<termino>` y
`/<slug>/c/<categoria>`—,
**entonces** las cinco traen la barra en su forma cerrada —«Esta sucursal está
cerrada.» y el enlace `Ver …`, `src/components/store/BranchBar.tsx:34-36`—, y
ninguna trae «Estás en …». En el **selector** de esa misma marca, en cambio, la
sucursal muda sigue apareciendo como cualquier otra: el selector no lee
catálogos (R16).

## Reglas de negocio

**R1 — la condición.** Para una sucursal resuelta y `PUBLISHED`, con
`catalog = getStoreCatalog(branch)` y `rates = getStoreRates(branch)`:

```
muda  ⟺  catalog.length > 0  ∧  ∀ p ∈ catalog : precio(p) = null
```

donde `precio(p)` es el resultado de

```ts
resolvePrice(p, {
  targetCurrency: store.baseCurrencyCode,
  rates,
  baseCurrency: store.baseCurrencyCode,
  promotions: p.promotions,
});
```

y `null` cuando esa llamada **lanza** —exactamente lo que ya hacen `safeResolve`
(`src/components/store/ProductCard.tsx:135`) y `resolveProductPrice`
(`src/features/catalog/catalogFilters.ts:255`). No se define un segundo
predicado de «sin precio»: si el catálogo pinta «Consultar» para un producto, la
condición cuenta ese producto como sin precio, y al revés.

**R2 — el conjunto es la tienda entera, nunca el recorte que pinta la vista.**
La condición se evalúa sobre el catálogo completo de la sucursal, no sobre los
productos de la categoría, ni sobre la página de resultados de una búsqueda, ni
sobre lo que sobrevive a los filtros. Lo obliga el criterio 2: «una tienda con
productos donde SOLO ALGUNOS no resuelven precio sigue mostrando el catálogo con
los que sí, y **sin ningún aviso de cierre**» — es una afirmación sobre la
tienda. Con el conjunto por vista, esa misma tienda enseñaría el aviso en
`/c/<categoria>` en cuanto una categoría tuviera sus tres productos sin precio,
que es justo lo que el criterio 2 prohíbe. Consecuencia directa y comprobable:
**una categoría cuyos tres productos no resuelven precio, en una tienda que sí
resuelve otros, NO se cierra** (E2).

**R3 — una tienda vacía no está muda.** `catalog.length === 0` corta antes de
mirar ningún precio. Es el criterio 3, y es la mitad que distingue esta
condición de la versión ingenua: «ningún producto resuelve precio» es cierto
también para el conjunto vacío.

**R4 — es un estado derivado, no una bandera.** Se calcula en cada render, a
partir de datos que ya se leen. No hay columna nueva, no se escribe ninguna
existente, y no hay caché propia: si el catálogo o las tasas cambian, el estado
cambia con ellos por construcción (ADR 0017 (a), criterio 4).

**R5 — el motivo es un código interno.** Una constante nueva en
`src/constants/storeClosure.ts`, exportada aparte y **no** añadida a
`STORE_DISABLED_REASONS` ni a `STORE_DISABLED_REASON_CODES`, con la forma de
`PLATFORM_ROLLOUT_REASON_CODE` (L33). Su frase vive en
`resolveStoreClosureHeadline` (`src/lib/storeClosure.ts:15`), en una rama propia
**antes** del respaldo por `disabledAt`. Comprobable por separado: E19.

**R6 — precedencia.** El cierre real manda. La condición solo se evalúa en el
camino `status === "PUBLISHED"` de cada vista; una `SUSPENDED` sigue enseñando
su propio motivo y una `DRAFT` o inexistente sigue siendo 404 (E15).

**R7 — el aviso sustituye al contenido de catálogo de la vista, no lo
acompaña.** En las siete vistas, cuando la tienda está muda, se monta
`StoreClosedNotice` en el sitio donde hoy se monta para una tienda cerrada, y
**no** se pinta rejilla, ficha, panel de filtros, resultados de búsqueda,
carrito ni formulario de checkout. Bajo una tienda muda, un `productSlug` o un
`categorySlug` que no existe enseña el aviso en vez de 404 (E5, E6), igual que
bajo una tienda `SUSPENDED`.

**R8 — el aviso no se disfraza de cierre del comerciante.** Al componente se le
pasan `disabledMessage: null` y `disabledAt: null`: el texto libre es del cierre
del comerciante y aquí no hay ningún instante que nombrar. Lo único que
identifica el estado es `<CODE>`.

**R9 — cero consultas nuevas donde ADR 0025 aplica.** En `/[slug]`,
`/[slug]/p/[productSlug]`, `/[slug]/catalogo` y `/[slug]/c/[categorySlug]` la
condición se deriva de `getStoreCatalog` + `getStoreRates`, que esas cuatro
páginas ya leen (`page.tsx:142-146`, `p/[productSlug]/page.tsx:141-144`,
`catalogo/page.tsx:149-153`, `c/[categorySlug]/page.tsx:117-121`). Ninguna
entrada de caché nueva, ningún tag nuevo, ninguna función pura duplicada:
proyección, como `getStoreCategories` (`queries.ts:361`) y `getStoreCategoryView`
(`queries.ts:383`).

En las **tres** restantes —`/[slug]/buscar` en su camino simple,
`/[slug]/carrito` y `/[slug]/checkout`— la condición se deriva de las mismas dos
lecturas, que esas páginas **estrenan** con este feature (SP3, opción (a),
decidida por el humano el 2026-09-10). Restricción de la que no se sale: son
`getStoreCatalog` y `getStoreRates` tal cual, con sus `keyParts` y sus tags
actuales, así que no aparece ninguna entrada de caché nueva, ningún tag nuevo y
ninguna consulta Prisma en caliente; en frío son los mismos round-trips que
`loadCatalog` y `loadCurrentRates` ya pagan para `/[slug]`. El criterio 6 se
cuenta en las cuatro de arriba (E13); en estas tres, el coste se documenta.

**R10 — la recuperación es la invalidación que ya existe.** Cuando llega la tasa
o el precio que faltaba, el sync ya expira `storeTag` y `storeCatalogTag`
(`src/lib/cache.ts:86-93`); el siguiente render recalcula la condición y el
aviso desaparece. No se añade tag, ni ruta de revalidación, ni trabajo de fondo.

**R11 — una tienda muda no busca.** En `/[slug]/buscar`, el aviso se decide
**antes** de llamar a `searchStoreProducts`, así que no se ejecuta la consulta de
búsqueda y el `after()` que registra el término no llega a programarse
(`buscar/page.tsx:246-248`). Mismo comportamiento que la rama de tienda cerrada.

**R12 — el contrato de pedido no se toca.** `QuoteLineReason`, `CartLineStatus`,
los códigos HTTP y los cuerpos de `/api/orders` y `/api/orders/quote` quedan
como están. Una tienda muda es `PUBLISHED`: la cotización responde 200 con
líneas `NO_PRICE`, y crear el pedido responde 409 `ITEMS_UNAVAILABLE`.

**R13 — los caminos que podrían lanzar quedan probados, no cambiados.**
`createOrder` devuelve `items_unavailable` en L179-187, **antes** de calcular la
cuota de domicilio (L239-251) y antes de `buildRateSnapshot` (L440). En una
tienda muda ninguna línea es `orderable`, así que esos dos caminos son
inalcanzables por construcción; el trabajo es demostrarlo con E12, no
protegerlos con un `try`.

**R14 — la degradación por producto se queda.** «Consultar» y «Consultar
precio» siguen siendo la respuesta cuando algunos productos no resuelven precio
(criterio 2). Este feature no toca `safeResolve` ni `resolveProductPrice` salvo,
si la arquitectura lo decide, para **reusarlos** desde la derivación.

**R15 — la metadata no cambia.** Ningún `robots: { index: false }` nuevo, ningún
título nuevo, en ninguna de las siete vistas (§ Fuera, punto 6).

**R16 — el selector no marca las mudas; el `BranchBar` de la vista sí.** Dos
mitades, decididas por el humano el 2026-09-10 (SP4):

- **El selector de marca no se toca.** `src/app/[slug]/page.tsx:87-110` y
  `BranchList` siguen leyendo `Store.status` y nada más. No lee catálogos y no
  va a empezar: serían N lecturas por marca.
- **El `BranchBar` sí.** En las cinco vistas que lo montan —`/[slug]`,
  `/[slug]/p/[productSlug]`, `/[slug]/catalogo`, `/[slug]/buscar` y
  `/[slug]/c/[categorySlug]`— una tienda muda lo pinta con `isOpen={false}`,
  que es lo que ya hace la rama de tienda cerrada de esas mismas páginas. Coste
  cero: el catálogo que decide la condición ya está en la mano. Sin esto, la
  barra diría «Estás en …» encima de un aviso que dice lo contrario
  (`src/components/store/BranchBar.tsx:34`). Comprobable por separado: E21.

## Casos límite y errores

- **Catálogo vacío por invisibilidad.** Una tienda con veinte productos todos
  `visible: false` o `deletedAt != null` tiene `catalog.length === 0`: es el
  caso legítimo de R3, no una tienda muda. La distinción está en `loadCatalog`,
  no aquí.
- **Un solo producto, sin precio.** `catalog.length === 1` y ese producto no
  resuelve: es muda. La condición no tiene umbral mínimo de productos.
- **Tasas ilegibles.** Si `getStoreRates` lanza, la página falla como falla hoy;
  este feature no añade un `catch` que convierta un fallo de base en «tienda
  muda». Un fallo de infraestructura disfrazado de estado de negocio es peor que
  el fallo.
- **Precio no numérico.** Un `syncedPrice` que `parseToMinor` rechaza
  (`money.ts:39`) hace lanzar a `money()` y cuenta como sin precio, igual que la
  falta de tasa. La condición no distingue entre motivos: solo mira si hay
  precio.
- **`/buscar` con filtros.** El camino filtrado ya lee el catálogo entero, vía
  `getStoreCategories` (`buscar/page.tsx:220-223`); el camino simple no leía
  ninguno y con SP3(a) lo lee. Los dos caminos tienen que dar el **mismo**
  veredicto para la misma tienda: la condición es la de R2, no la del conjunto
  que cada camino pinta.
- **Alias vivo.** Las dos URL de una sucursal (canónica y alias) resuelven al
  mismo `storeId` y deben dar el mismo veredicto: la condición se evalúa sobre
  la `BranchResolution`, nunca sobre el slug pedido.
- **Concurrencia.** Dos peticiones simultáneas pueden ver estados distintos si
  una tasa llega entre ambas. Es aceptable y no hay nada que sincronizar: no se
  escribe nada, la caché de datos ya arbitra, y el estado converge en la primera
  petición posterior a la invalidación (R10).
- **Prerenderizado.** `generateStaticParams` de `/p/[productSlug]` y de
  `/c/[categorySlug]` sigue enumerando los productos y las categorías de una
  tienda muda; esas páginas se prerenderizan con el aviso y se invalidan como
  cualquier otra. No hay que podar la lista: hacerlo la volvería a llenar en
  cuanto llegue la tasa, y eso ya lo hace la revalidación.
- **Reintento.** Recargar N veces no cambia nada: la operación es de solo
  lectura y no tiene efectos.

## Datos y contrato

- **Nada nuevo en la base.** Ni columna, ni tabla, ni migración, ni índice.
- **Nada nuevo en `docs/sync-contract.md`.** No cambia lo que el POS envía ni lo
  que recibe, así que no se mueve su versión.
- **El código de motivo** es una cadena literal en `src/constants/storeClosure.ts`
  con la misma forma que `PLATFORM_ROLLOUT_REASON_CODE`: `SCREAMING_SNAKE_CASE`,
  en inglés (AGENTS.md § Idioma), nunca traducida ni guardada. Solo viaja como
  prop de React dentro de un render.
- **La frase** es española y la escribe `resolveStoreClosureHeadline`. Su
  redacción exacta la fija `design.md`; la spec fija dos restricciones: no puede
  atribuir el cierre a una decisión del comerciante (no lo cerró nadie) y no
  puede exponer el detalle técnico —ni «tasa de cambio», ni el código de moneda—
  a quien compra.
- **Fixture de prueba.** Los criterios 1, 5 y 7 necesitan una sucursal muda
  sembrada: un negocio con `baseCurrencyCode` sin `ExchangeRate` vigente y
  productos en otra moneda. Si acaba en `prisma/seed.ts`, tiene que ser
  idempotente y no puede cambiar lo que ven las pruebas visuales y de humo de
  los features ya cerrados (§ No decidido a propósito).

## Criterios de aceptación propuestos

Los ocho de `.agent/features.json`, en forma ejecutable. No se modifica ninguno
(regla 3).

| #   | Criterio                               | Cómo se verifica ejecutando                                                                                                                                                         | Escenarios |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Tienda con productos, ninguno resuelve | `[ya]` Sembrar el fixture; `curl -s /<slug>` contiene `<FRASE>` y no contiene ninguna tarjeta ni «Consultar»                                                                        | E1         |
| 2   | Solo algunos sin precio                | `[ya]` Con una tasa que resuelve uno de tres: `curl -s` de las cinco vistas de catálogo trae las tres tarjetas y **no** contiene `<FRASE>`                                          | E2         |
| 3   | Tienda vacía, sin marcar               | `[ya]` `curl -s /<slug>` de una tienda sin productos contiene el mensaje de siempre y no `<FRASE>`                                                                                  | E3         |
| 4   | No se escribe nada                     | `[ya]` `SELECT status, "disabledReasonCode", "disabledMessage", "disabledAt"` idéntico antes y después de las siete visitas; más `isStoreDisabledReasonCode`/`safeParse` en rojo    | E10, E19   |
| 5   | Pedido sin 500 ni importes inválidos   | `[ya]` `POST /api/orders` → 409 `ITEMS_UNAVAILABLE` (PICKUP y DELIVERY/`ZONE_BASED`), `count(*)` de `Order` sin cambios, salida de servidor sin `⨯`; `POST /api/orders/quote` → 200 | E11, E12   |
| 6   | Ninguna consulta nueva                 | `[ya]` Log de consultas de Prisma como en `.agent/specs/F-025/tests.md`: mismo número de `prisma:query` antes y después en las cuatro URL de catálogo                               | E13, I1    |
| 7   | La ficha dice lo mismo que la portada  | `[ya]` `curl -s /<slug>/p/<producto>` contiene la **misma** `<FRASE>` que `/<slug>` y ningún importe                                                                                | E4         |
| 8   | El sensor en verde                     | `[ya]` `bash .agent/verify.sh F-040 --full` termina con código 0                                                                                                                    | —          |

Y tres que se proponen al humano, porque cubren decisiones ya tomadas que
ninguno de los ocho llega a comprobar:

- **`[nuevo]` Las siete vistas, no dos.** `curl -s` de `/<slug>`,
  `/<slug>/p/<producto>`, `/<slug>/catalogo`, `/<slug>/buscar?q=<termino>`,
  `/<slug>/c/<categoria>`, `/<slug>/carrito` y `/<slug>/checkout` en una tienda
  muda: las siete responden 200 y las siete contienen `<FRASE>` (E1, E4, E6-E9).
- **`[nuevo]` La búsqueda de una tienda muda no registra el término.** Contar las
  filas del registro de búsquedas antes y después de `GET /<slug>/buscar?q=x`:
  el mismo número (E8).
- **`[nuevo]` Nada cambia para una tienda normal.** El HTML de las siete URL de
  una sucursal con precios es idéntico byte a byte antes y después del cambio
  (E20).
- **`[nuevo]` La barra de sucursal no contradice al aviso.** En las cinco vistas
  que montan `BranchBar`, el HTML de una tienda muda contiene «Esta sucursal
  está cerrada.» y no contiene «Estás en …»; en el selector de esa misma marca,
  la sucursal muda sigue apareciendo como cualquier otra (E21, SP4).

## Incongruencias detectadas

**I1 — el criterio 6 y las siete vistas no caben a la vez, literalmente.** El
criterio 6 dice «se deriva del catálogo que la página ya lee (ADR 0025)». Eso es
cierto en cuatro vistas y en el camino filtrado de `/buscar`, y **falso** en
tres:

- `src/app/[slug]/buscar/page.tsx:212` lee `getStoreRates` pero **no**
  `getStoreCatalog` en el camino simple: su índice es la excepción de la ADR
  0025 (ADR 0021).
- `src/app/[slug]/carrito/page.tsx:27` solo lee `requireStore`.
- `src/app/[slug]/checkout/page.tsx:28,55,69` lee la tienda, `loadStoreForOrder`
  y quizá la cobertura de zonas: ninguna trae catálogo ni tasas.

Con el alcance de siete vistas decidido por el humano, esas tres necesitan
`getStoreCatalog` y —dos de ellas— `getStoreRates`. Son lecturas **cacheadas y
ya tagueadas**, la misma entrada que sirve `/[slug]`: cero entradas nuevas, cero
tags nuevos, y cero round-trips en caliente; en frío, los dos que `loadCatalog`
ya paga. Aun así, «cero consultas» deja de ser literal en esas tres URL, y el
criterio 6 no se puede reescribir (regla 3).

**Resuelta el 2026-09-10 por el humano (SP3, opción (a)):** las tres leen el
catálogo, el criterio 6 se cuenta en las **cuatro** vistas donde la ADR 0025
aplica y el criterio la cita (E13), y en las otras tres el coste queda
**documentado** —una lectura de la caché de datos— en vez de medido (R9). La
incongruencia se queda escrita porque explica por qué el criterio 6 se verifica
en cuatro URL y no en siete: quien lea la tabla de criterios sin esto pensará
que faltan tres mediciones.

**I2 — «estado de tienda cerrada» es la presentación, no el estado.** El
criterio 1 dice «muestra el estado de tienda cerrada»; la tienda **no** se
cierra: `Store.status` sigue en `PUBLISHED` y ninguna columna se escribe
(criterio 4 y ADR 0017 (a)). Lo que se reusa es `StoreClosedNotice` y la frase
de `resolveStoreClosureHeadline`. Esta spec lee el criterio 1 como «muestra lo
que muestra una tienda cerrada», y la contradicción se disuelve; se anota porque
la lectura contraria llevaría a escribir la columna, que es justo lo que el
criterio 4 prohíbe.

**I3 — el criterio 5 ya está cumplido antes de empezar.** `quote.ts:253-261`
atrapa el `MoneyError` y devuelve `reason: "NO_PRICE"`; `createOrder.ts:179-187`
corta con `items_unavailable` antes de tocar la cuota de domicilio y
`buildRateSnapshot`; `route.ts:77-81` responde 409. No hay código que escribir
para el criterio 5: hay una demostración que ejecutar (decisión SP2 del humano,
E11-E12). Si el probador encuentra un 500 ahí, lo que ha encontrado es otra
cosa, no este feature.

**I4 — nada estructural impide que el código derivado acabe en la base.** El
`disabledReasonCode` de `StoreClosedNotice` está tipado `string | null`
(`StoreClosedNotice.tsx:21`), igual que el de `StoreSummary`
(`queries.ts:74`): un descuido futuro podría pasar el código nuevo a una
escritura. Hoy la barrera es doble y basta —la lista blanca del panel
(`src/features/admin/schemas.ts:58`, ADR 0017 (a)) y que la constante viva fuera
de `STORE_DISABLED_REASONS`—, y E19 la comprueba ejecutando. Se anota para que
la arquitectura decida si además quiere un tipo que lo haga imposible.

**I5 — `classifyStoreClosure` no conoce el código nuevo.**
`src/lib/storeClosure.ts:61` clasificaría `<CODE>` como `"platform"`. No es un
fallo mientras el panel quede fuera (SP1) y el código no llegue nunca a la base
(criterio 4): esa función solo se llama con valores leídos de la fila. Queda
anotado como el sitio exacto que habría que tocar el día que se abra el feature
de panel.

## Huecos y preguntas al humano

**No queda ninguna pregunta bloqueante.** Las cuatro que llegó a haber están
contestadas por el humano, todas el **2026-09-10**: `SP1` y `SP2` son las que el
propio feature dejó planteadas en sus `notes` (el panel fuera, el checkout sin
cambios) y están en § Alcance § Fuera, puntos 3 y 4; `SP3` y `SP4` las abrió
esta spec y se contestaron sobre ella. Se conservan abajo con su respuesta, no
se borran: la opción elegida y las descartadas son lo que impide volver a
discutirlas dentro de tres semanas.

### SP3 — ¿el criterio 6 se mide solo donde la ADR 0025 aplica? · **CONTESTADA**

**Qué se preguntaba.** Cómo se lee «la condición no añade ninguna consulta» en
las tres vistas que hoy no leen el catálogo: `/[slug]/buscar` (camino simple),
`/[slug]/carrito` y `/[slug]/checkout`.

**Por qué importaba.** Decidía si esas tres se construyen o no, y con qué se
verifica el criterio 6.

**Opciones.**

- **(a)** Las tres leen `getStoreCatalog` (y `getStoreRates` donde falte). Son
  lecturas cacheadas con los tags que ya existen: ninguna entrada de caché
  nueva, ningún tag nuevo, cero round-trips en caliente. El criterio 6 se
  verifica contando consultas en las **cuatro** vistas de catálogo —donde la ADR
  0025 aplica y el criterio la cita—, y se documenta que en las otras tres el
  coste es una lectura de la caché de datos.
- **(b)** Solo las cuatro vistas de catálogo enseñan el aviso; `/buscar`,
  `/carrito` y `/checkout` se quedan como están. El criterio 6 se cumple
  literalmente en las cuatro, pero `/buscar` de una tienda muda seguiría
  enseñando resultados sin precio, que es exactamente lo que la decisión de
  alcance del 2026-09-10 quería evitar.
- **(c)** `/buscar` evalúa la condición sobre **sus propios resultados** en vez
  de sobre el catálogo. Cero lecturas nuevas, pero rompe R2 y el criterio 2: una
  búsqueda cuyos tres resultados no resuelven precio cerraría una tienda que
  cobra el resto de su catálogo sin problema.

**Respuesta del humano, 2026-09-10: opción (a)** —la recomendada—, literal:
«las tres leen el catálogo». Las siete vistas del alcance se construyen; el
criterio 6 se cuenta en las cuatro vistas de catálogo (E13) y en las otras tres
el coste queda documentado (R9). (b) y (c) quedan descartadas: (b) dejaría
`/buscar` enseñando resultados sin precio en una tienda muda, y (c) rompe R2 y
el criterio 2.

### SP4 — ¿la sucursal muda debe verse cerrada en el selector de marca? · **CONTESTADA**

**Qué se preguntaba.** Una marca con dos o más sucursales renderizables enseña
la lista (`src/app/[slug]/page.tsx:87-110`) con «abierta/cerrada» por
`Store.status`. Una sucursal muda aparecería como **abierta**, y el comprador
entraría para encontrarse el aviso.

**Por qué importaba.** No bloqueaba la implementación, pero decidía si el
resultado se siente coherente — y cambiarlo después es tocar la misma superficie
dos veces.

**Opciones.**

- **(a)** Dejar el selector fuera: no lee catálogos y no debería empezar a
  hacerlo (serían N lecturas de catálogo por marca).
- **(b)** Marcarla en la lista, aceptando N lecturas cacheadas por marca.
- **(c)** Marcarla solo en el `BranchBar` de la sucursal que ya se está mirando,
  que es la única cuyo catálogo la vista ya tiene en la mano — coste cero.

**Respuesta del humano, 2026-09-10: «selector no, `BranchBar` sí»** —la
recomendación, (a) para el selector y (c) para la barra—. El selector y
`BranchList` no se tocan (§ Fuera, punto 7); el `BranchBar` de la vista que se
está mirando se pinta cerrado, que es gratis y evita una barra diciendo
«abierta» encima del aviso. R16 recoge las dos mitades y E21 las comprueba.

## No decidido a propósito

- **Dónde vive la función que deriva la condición** —módulo puro nuevo bajo
  `src/features/catalog/` (por crear), o una función exportada desde
  `src/features/catalog/catalogFilters.ts`— y si la vista recibe un booleano o
  un objeto con el código. Lo decide `architecture.md`. La única restricción de
  esta spec: es **pura**, sin Prisma y sin React, y reusa la misma llamada a
  `resolvePrice` que las vistas (R1).
- **La redacción exacta de `<FRASE>`** y de las notas extra por vista, dentro de
  las dos restricciones de § Datos y contrato. Lo decide `design.md`.
- **El nombre del código** (`<CODE>`). Lo decide `architecture.md`, en inglés y
  con la forma de `PLATFORM_ROLLOUT_REASON_CODE`.
- **Dónde vive el fixture de la tienda muda** —`prisma/seed.ts` o creado por la
  prueba— y si se prefiere un negocio nuevo o una sucursal más de uno existente.
  Lo decide el plan con el probador, mirando qué pruebas visuales de features ya
  cerrados podrían moverse.
- **Cómo se cuentan las consultas del criterio 6** —repetir el log de Prisma de
  F-025 o el delta de `xact_commit` de `pg_stat_database`—. Lo decide
  `tests.md`; los dos procedimientos están escritos en
  `.agent/specs/F-025/tests.md` y `.agent/specs/F-025/architecture.md`.
