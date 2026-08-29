---
propuesta: resenas-y-calificaciones
agente: sdd-spec
actualizado: 2026-08-29T03:09:36Z
estado: propuesta
---

> Origen: pedido del humano del 2026-08-28 («…reseñas y calificaciones»),
> repartido por el orquestador en cuatro propuestas. Esta es la cuarta y la
> única que introduce datos nuevos, escritura pública nueva y contenido de
> terceros en páginas indexables.

## Problema

Hoy un comprador que abre `/[slug]` no tiene ninguna señal de si esa tienda
cumple: ve catálogo, precios y disponibilidad, todo escrito por el propio
negocio. No hay ni una fila en la base que registre la opinión de alguien que
ya compró (`grep -niE "review|rating" prisma/schema.prisma` no devuelve nada).
En un marketplace de tiendas pequeñas y desconocidas entre sí, esa ausencia es
justamente la que decide si alguien pide o no pide.

El pedido del humano —«reseñas y calificaciones»— arrastra tres decisiones que
este repo aún no ha tomado: **quién puede escribir sin cuenta**, **quién puede
borrar lo escrito**, y **qué pasa cuando texto de un tercero se renderiza en
una página SSG que Google indexa**. Ninguna de las tres se resuelve aquí: se
formulan como preguntas con opciones y recomendación.

## Alcance

### Dentro

- Una **reseña por pedido**: una calificación de la tienda (obligatoria,
  entero 1..5), un texto opcional y un nombre para mostrar.
- Opcionalmente (ver SP2), una calificación por **línea del pedido**, que
  agrega a la oferta de esa tienda (`StoreProduct`), nunca al canónico
  compartido entre negocios (`CanonicalProduct`).
- La **puerta de entrada**: quién tiene derecho a escribirla y con qué guarda
  anti-abuso, al estilo de `ORDER_RATE_LIMIT_MAX_PENDING` /
  `ORDER_RATE_LIMIT_WINDOW_MINUTES` (`src/constants/orders.ts`).
- La **lectura pública**: media + número de reseñas en la cabecera de la
  tienda y en la ficha de producto, lista paginada de reseñas.
- La **moderación desde el panel** (F-011): ocultar una reseña y responderla
  públicamente, con la frontera de tienda que ya impone
  `src/app/api/admin/_lib/guard.ts`.
- Los agregados (media y conteo) como dato **derivado**, propiedad de ninguno
  de los dos lados del sync — la tercera categoría que ya estrenó
  `docs/adr/0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md`.

### Fuera (explícito)

- **Cuentas de cliente.** No se construye nada de F-012 aquí. El modelo deja
  un `customerId` nullable como enganche para cuando exista, y nada más.
- **Reseñas en el marketplace.** F-015 busca sobre `CanonicalProduct`,
  compartido entre negocios; fusionar la reputación de dos tiendas distintas
  bajo un mismo canónico es una decisión de marketplace que ni F-015 ni F-024
  han tomado. Aquí la reputación vive **por tienda**.
- **Ranking por valoración en la búsqueda de F-021.** Ver I9 y SP4: «ordenar
  por mejor valorados» pertenece a la propuesta hermana
  `.agent/specs/propuestas/filtros-y-ordenamiento-avanzados.md`, y depende de
  este feature, no al revés.
- **Fotos en la reseña.** Duplicaría la superficie de F-023 (variantes,
  huérfanos en el bucket) por un beneficio que nadie pidió.
- **Aviso al negocio de que llegó una reseña.** El timbre de F-020 es de
  pedidos y lleva cero datos; ampliarlo es otro feature.
- **Envío de la reseña al POS.** Como `Promotion`, esto vive solo en
  queandabuscando (ver «Datos y contrato»).
- **Reputación a nivel de marca** (`Storefront`). Una marca con dos sucursales
  muestra la media **de cada sucursal**, no una fusionada.

## Actores y precondiciones

| Actor             | Qué hace                     | Precondición                                                                                    |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Comprador         | Escribe la reseña sin sesión | Tiene un `Order` real de esa tienda y su `code`; el pedido está en un estado reseñable (SP2/E2) |
| Visitante         | Lee media, conteo y reseñas  | Ninguna: `/[slug]` es pública y SSG                                                             |
| Encargado (panel) | Oculta, responde             | Sesión de admin de F-008 y la tienda en `storeIds` de su sesión                                 |
| POS (cuadrecaja)  | Nada                         | —                                                                                               |

Precondición de plataforma: F-010 cerrado (`passes: true`), que es lo que hace
que exista un `Order` con `code` y `contactPhone` de un invitado.

## Comportamiento esperado

**E1** — Dado un comprador con el `code` de un pedido suyo, cuando abre
`/[slug]/pedido/[code]` y el pedido es reseñable, entonces la página le ofrece
dejar una reseña; si ya la dejó, le muestra la suya en vez del formulario.

**E2** — Dado un pedido que **no** es reseñable (estado `PENDING`, `PULLED`,
`CANCELLED`), cuando se intenta crear la reseña, entonces la respuesta es
`409 ORDER_NOT_REVIEWABLE` y no se escribe nada.

**E3** — Dado un `code` que no existe, o que existe pero pertenece a **otra**
tienda, cuando se intenta crear la reseña, entonces la respuesta es `404`
idéntica en ambos casos — nunca un 403 que distinga «no existe» de «no es
tuyo». Es el mismo criterio que ya sostiene `setOrderStatus()`
(`src/features/orders/server/status.ts`) y el `notFound()` del panel.

**E4** — Dado un pedido reseñable, cuando se envía calificación 1..5 y texto
válido, entonces se crea **una** reseña, la respuesta es `201` con el enlace a
la página de reseñas de la tienda, y la media pública de la tienda cambia.

**E5** — Dado un pedido que **ya** tiene reseña, cuando se envía otra, entonces
no se crea una segunda fila: la unicidad la impone la base (`@@unique` sobre
`orderId`, capturando `P2002`), nunca un `SELECT` previo que pierde la carrera.
Es la defensa 1 de `docs/adr/0016-escritura-publica-sin-sesion.md`, aplicada
igual.

**E6** — Dado un mismo teléfono de contacto que ya dejó N reseñas en esa tienda
dentro de la ventana, cuando envía una más, entonces la respuesta es `429` con
cabecera `Retry-After`, exactamente como `too_many_orders` en
`src/app/api/orders/route.ts`.

**E7** — Dado un texto que contiene una URL o un dominio, cuando se envía,
entonces la respuesta es `400 REVIEW_TEXT_NOT_ALLOWED` y no se escribe nada.
El motivo económico del spam en contenido de usuario indexable es el enlace.

**E8** — Dado un visitante sin JavaScript, cuando abre `/[slug]`, entonces ve
la media y el número de reseñas en el HTML servido; y cuando abre la ficha de
un producto, ve la media de ese producto si la tiene y su ausencia declarada si
no («Sin reseñas todavía»), nunca un cero que se lee como «cero estrellas».

**E9** — Dado un producto con menos reseñas que el mínimo, cuando se renderiza
la tarjeta del catálogo, entonces se muestra el **conteo** pero no la media.
La media nunca aparece sin su conteo al lado (R7).

**E10** — Dado un encargado autenticado con la tienda en su sesión, cuando
oculta una reseña indicando un motivo del vocabulario cerrado, entonces el
texto desaparece del HTML público, la **calificación sigue contando** en la
media, y la página declara cuántas reseñas hay ocultas.

**E11** — Dado un encargado, cuando responde a una reseña, entonces la
respuesta aparece bajo ella, atribuida a la tienda; una segunda respuesta a la
misma reseña sustituye a la primera y nunca crea dos.

**E12** — Dado un admin autenticado para la tienda B, cuando intenta ocultar o
responder una reseña de la tienda A, entonces recibe `404` — la misma frontera
que el criterio 2 de F-011.

**E13** — Dada una tienda cerrada al público (`status != PUBLISHED`), cuando
alguien intenta crear una reseña, entonces la respuesta es `409 STORE_CLOSED`,
tomada **antes** de gastar un hueco de la ventana anti-abuso, igual que hace
`createOrder()` en su paso 1.5.

**E14** — Dado el autor de una reseña que conserva el `code`, cuando la edita
dentro de la ventana de edición, entonces se actualiza y queda marcada como
editada; pasada la ventana, `409 REVIEW_FROZEN`.

**E15** — Dado un `StoreProduct` con `deletedAt` puesto por el sync, cuando se
renderiza la tienda, entonces sus reseñas siguen contando para la media de la
**tienda** y su media de producto deja de mostrarse en ningún sitio, porque su
ficha ya no existe.

## Reglas de negocio

- **R1** — Una reseña pertenece a **un** `Order` y un `Order` tiene **como
  máximo una** reseña. La restricción es de base de datos, no de aplicación.
- **R2** — La calificación es un **entero de 1 a 5**. No hay medias estrellas,
  ni 0, ni escala configurable por tienda.
- **R3** — El texto es **opcional**. Si viene, tiene longitud mínima y máxima
  (ver «Datos»); si no viene, la reseña vale igual y cuenta para la media.
- **R4** — El HTML público de una reseña **nunca** contiene el `Order.code`, ni
  el teléfono, ni el email, ni la dirección de entrega. `Order.contactName`
  tampoco se publica tal cual: el autor escribe un nombre para mostrar, con un
  valor por defecto derivado (nombre + inicial). La razón está escrita en la
  propia ADR 0016: `/[slug]/pedido/[code]` va con `noindex` justamente porque
  muestra esos datos, y `/[slug]` es lo contrario — SSG e indexada
  (`src/app/sitemap.ts`).
- **R5** — Ocultar **no** borra la calificación de la media. Quita el texto y
  el nombre; el número sigue contando. Es lo que impide que la moderación se
  convierta en un lavado de nota.
- **R6** — El motivo para ocultar sale de un **vocabulario cerrado** de
  constantes, como `STORE_DISABLED_REASONS` en `src/constants/storeClosure.ts`,
  no de texto libre.
- **R7** — La media nunca se muestra sin el número de reseñas que la produce.
- **R8** — Los agregados (suma, conteo, media) son **derivados**: ningún lado
  del sync los posee y ninguna escritura del panel ni del sync los toca a mano.
  Se recalculan desde las reseñas, con el mismo razonamiento de la ADR 0021.
- **R9** — La reseña no viaja al POS. Ninguna ruta de `/api/internal/*` cambia
  y `docs/sync-contract.md` no sube de versión por este feature (sí gana una
  fila en la tabla de propiedad de F-022: «no sincronizada»).
- **R10** — La ruta pública de escritura acepta **solo**
  `content-type: application/json` estricto (fuerza _preflight_ CORS y deja
  fuera el POST cruzado), tiene tope de cuerpo propio y hereda el
  `disallow: ["/api/"]` de `src/app/robots.ts`. Son las defensas 3, 4 y 5 de la
  ADR 0016, replicadas.
- **R11** — Una tienda **sin reseñas** no muestra ni media ni estrellas vacías:
  muestra su ausencia con palabras. Cero reseñas y una reseña de 1 estrella no
  pueden parecerse en pantalla.
- **R12** — Las páginas de tienda siguen siendo legibles sin JavaScript y
  siguen marcándose ● (SSG) en el build. Nada de lo que se añada al catálogo
  gana un `"use client"` (prohibición de `AGENTS.md`).
- **R13** — La reputación es de la **sucursal** (`Store`), no de la marca
  (`Storefront`). Borrar una tienda borra sus reseñas en cascada; borrar un
  pedido borra la suya.
- **R14** — La respuesta de la tienda es **una** por reseña, sustituible, y se
  publica atribuida a la tienda, no a una persona.

## Casos límite y errores

- **Vacío** — Tienda sin ninguna reseña: E8/R11. Producto sin reseñas dentro de
  una tienda que sí las tiene: la ficha muestra la media de la tienda y declara
  que el producto no tiene la suya.
- **Duplicado** — Dos envíos con el mismo `code` (doble clic, reintento de red):
  E5. La segunda respuesta debe ser inequívoca; se propone `200` con
  `idempotent: true`, igual que hace hoy el checkout, en vez de un `409` que un
  cliente reintentando interpretaría como fallo.
- **Concurrencia** — Dos peticiones simultáneas con el mismo `code`: gana la
  base. Nada de `$transaction` — el pooler de Supabase corre en modo
  transacción (`AGENTS.md` § «Cosas que muerden»); la guarda anti-abuso y la
  comprobación de existencia deben caber en una sola consulta, como ya hace
  `createOrder()`.
- **Pedido borrado o tienda despublicada después** — La reseña sobrevive a que
  la tienda se cierre (`status != PUBLISHED`): la página deja de ser pública
  igual que el catálogo, pero el dato no se pierde. La reseña **no** sobrevive
  al borrado de su tienda (R13).
- **Producto borrado en blando por el sync** — E15.
- **Cambio de sucursal / reagrupación (F-017)** — Al agrupar dos sucursales bajo
  una marca, `/[slug]` de la marca pasa a ser selector: la media que se
  mostraba ahí desaparece de esa URL y sigue viva en la de cada sucursal. Si
  este feature revalida, tiene que hacerlo por el embudo
  `expandBrandTouch()` de `src/features/storefront/server/registry.ts` — armar
  el array de slugs a mano ni siquiera compila, y está prohibido en
  `AGENTS.md`.
- **Texto hostil** — Emojis, RTL, control chars, 4-byte UTF-8, HTML crudo. React
  escapa por defecto, así que el riesgo real no es XSS sino romper el layout y
  el `grep` de verificación. Normalización y tope en bytes, no en `length`.
- **Sin permiso** — E12. Y el panel jamás filtra la existencia de una reseña
  ajena.
- **A medio camino** — Reseña creada y la revalidación de la página falla: la
  reseña existe y la página se pone al día en el suelo de `revalidate = 3600`
  de `src/app/[slug]/layout.tsx`. Nunca al revés (página actualizada sin fila).
- **Reintento** — El mismo `code` tras un 429: no debe consumir la
  idempotencia. La idempotencia gana al rate limit, igual que en R31 de F-010.

## Datos y contrato

Nada de esto existe hoy: `grep -niE "review|rating|resena|calificacion"
prisma/schema.prisma` devuelve cero coincidencias. Todo es aditivo.

Modelos propuestos (nombres en inglés, `AGENTS.md` § Idioma). El detalle final
lo cierra `sdd-architect`:

| Modelo                       | Campos que importan                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Review`                     | `id`, `storeId`, `orderId` **@unique**, `customerId String?` (enganche para F-012, siempre `null` en v1), `storeRating Int` 1..5, `text String?`, `displayName String`, `status` (`VISIBLE` / `HIDDEN_BY_STORE`), `hiddenReasonCode String?`, `createdAt`, `editedAt DateTime?` |
| ReviewItemRating (por crear) | `reviewId`, `storeProductId`, `rating Int` 1..5, `@@unique([reviewId, storeProductId])`                                                                                                                                                                                         |
| ReviewResponse (por crear)   | `reviewId` **@unique**, `text`, `adminUserId String?`, `createdAt`, `updatedAt`                                                                                                                                                                                                 |

**Agregados.** Dos formas, y la elección tiene consecuencias fuera de este
feature (ver I6): (a) columnas `ratingCount`/`ratingSum` en `Store` y
`StoreProduct` — rápido de leer, pero obliga a F-022 a meterlas en su tabla de
propiedad; (b) tabla de resumen propia, keyed por destino — no toca ninguna
tabla que el sync o el panel posean. **Recomendación: (b)**, y queda para
`sdd-architect`.

**Constantes** (a src/constants/reviews.ts, por crear — `AGENTS.md` prohíbe
magic numbers), con los valores propuestos:

```
REVIEW_MIN_RATING = 1              REVIEW_MAX_RATING = 5
REVIEW_TEXT_MIN_LENGTH = 10        REVIEW_TEXT_MAX_LENGTH = 1000
REVIEW_DISPLAY_NAME_MAX_LENGTH = 40
REVIEW_MAX_BODY_BYTES = 8 * 1024   // el pedido usa 32 KB para 50 líneas
REVIEW_RATE_LIMIT_MAX = 3          REVIEW_RATE_LIMIT_WINDOW_MINUTES = 60
REVIEW_EDIT_WINDOW_DAYS = 30       REVIEW_PAGE_SIZE = 10
REVIEW_MIN_COUNT_FOR_AVERAGE = 1   // ver SP4
```

**Contrato con cuadrecaja:** sin cambios. `docs/sync-contract.md` no sube de
versión (R9). Sí hereda una obligación de F-022: su criterio 4 exige que
**cada** campo de `Store` y `StoreProduct` aparezca en la tabla de propiedad,
así que la opción (a) de agregados le añade filas a un feature que sigue en
`passes: false`.

**Zona horaria:** las reseñas se muestran con fecha, no con hora local de la
tienda; este feature **no** depende de `Store.timezone` (F-022).

## Criterios de aceptación propuestos

Todos `[nuevo]` — no hay ningún feature en `.agent/features.json` con criterios
sobre reseñas.

1. `POST` a la ruta pública de reseñas con un `code` inexistente responde 404 y
   `SELECT count(*)` sobre la tabla de reseñas no cambia.
2. Con el `code` de un pedido de la tienda A dirigido a la tienda B, la
   respuesta es 404 — byte a byte la misma que la del punto 1.
3. Con un pedido en `PENDING` responde 409 `ORDER_NOT_REVIEWABLE`; el mismo
   pedido llevado al estado reseñable responde 201.
4. Enviar dos veces la misma reseña deja **una** fila:
   `SELECT count(*) ... WHERE "orderId" = $1` devuelve 1 y la segunda respuesta
   es 200 con `idempotent: true`.
5. Superado el tope por tienda + teléfono normalizado en la ventana, la
   respuesta es 429 **con** cabecera `Retry-After`; un reintento con el mismo
   pedido ya reseñado sigue devolviendo 200, no 429.
6. Un texto con `http://`, `https://`, `www.` o un dominio desnudo responde 400
   y no escribe.
7. `content-type` distinto de `application/json` responde 415 y un cuerpo por
   encima del tope responde 413.
8. `curl` de `GET /[slug]` y de `GET /[slug]/p/[productSlug]` muestra media y
   conteo en el HTML servido, y `npm run build` sigue marcando ambas rutas ●
   (SSG), no ƒ (Dynamic).
9. El HTML público de una reseña no contiene el `Order.code`, ni el teléfono,
   ni el email, ni la dirección del pedido que la originó, verificado con
   `grep` sobre el HTML servido con datos sembrados.
10. Ocultar una reseña desde el panel la quita del HTML público y **no** cambia
    la media: el número antes y después es idéntico, y el HTML declara cuántas
    hay ocultas.
11. Un admin de la tienda B recibe 404 al ocultar o responder una reseña de la
    tienda A.
12. Responder dos veces a la misma reseña deja **una** respuesta y la segunda
    sustituye a la primera.
13. La media que muestra la página coincide con el promedio calculado en SQL
    sobre todas las reseñas de esa tienda, ocultas incluidas.
14. Una tienda sin reseñas no emite ninguna estrella en su HTML: el `grep` del
    marcador de estrellas no encuentra nada y sí encuentra el texto de
    ausencia.
15. `node scripts/check-bundle-budget.mjs` termina en 0 y las páginas de
    catálogo no ganan ningún módulo de cliente nuevo.
16. `bash .agent/verify.sh <ID> --full` termina con código 0.

## Incongruencias detectadas

- **I1 — La ADR 0016 dice que esta ruta no debería existir.**
  `docs/adr/0016-escritura-publica-sin-sesion.md` § Decisión: «Existe **una**
  ruta pública de escritura, `POST /api/orders`… **No hay ninguna más y añadir
  otra es una decisión de este mismo peso**». Este feature añade la segunda.
  Sin una ADR que lo cubra, alguien la «arreglará» dentro de un año — que es
  exactamente el escenario que la 0016 dice querer evitar. Ver SP5.
- **I2 — El argumento de la 0016 no cubre este caso.** Su § «Por qué es
  aceptable» se apoya en que la escritura se confina a `Order`/`OrderItem`,
  «dos tablas que nadie más posee», y en que la única página que muestra ese
  texto va con `noindex`. Una reseña es texto de un tercero renderizado en
  `/[slug]`, que es SSG, está en `src/app/sitemap.ts` y `src/app/robots.ts`
  permite indexar. Es una clase de riesgo nueva (spam de enlaces, difamación),
  no una más de las que la ADR ya pesó.
- **I3 — La verificación por pedido NO distingue al comprador de la tienda.**
  `src/features/orders/server/pull.ts` devuelve al POS `code` **y**
  `contact.phone` de cada pedido. Cualquier credencial derivada del pedido la
  tiene también el negocio: una tienda puede auto-reseñarse una vez por pedido
  real, y ADR 0016 § Consecuencia ya acepta a sabiendas que el tope por
  teléfono «no frena a quien rote teléfonos», así que también puede fabricar
  los pedidos. Ninguna variante de esta puerta arregla eso. Ver SP6.
- **I4 — El modelo no existe.** `prisma/schema.prisma` no tiene `Review`,
  `Rating` ni nada equivalente. No hay nada que corregir; hay todo que crear,
  con migración aditiva y sin `prisma db push` ni `migrate reset`
  (`AGENTS.md` § Comandos prohibidos).
- **I5 — Depender de F-012 bloquea el feature.** F-012 está en
  `.agent/features.json` con `"passes": false` y nota «Sin empezar», y la regla
  5 dice «No se empieza un feature cuyos `depends_on` no tengan
  `passes`: true». Si la atribución exige cuenta, esta propuesta no puede
  arrancar. Ver SP1.
- **I6 — Los agregados chocan con F-022.** Su criterio 4 exige que **cada**
  campo de `Store` y `StoreProduct` esté en la tabla de propiedad de
  `docs/sync-contract.md`. Meter `ratingCount`/`ratingSum` en esas dos tablas
  le añade trabajo a un feature ajeno todavía en `passes: false`. El precedente
  de la tercera categoría («ni del sync ni del panel») es
  `docs/adr/0021-el-indice-de-busqueda-de-una-oferta-es-derivado.md`.
- **I7 — Una escritura pública que invalida caché es un vector nuevo.**
  `src/app/[slug]/layout.tsx` fija `revalidate = 3600` y `src/lib/cache.ts`
  documenta que la invalidación va por tag; hoy **solo** el sync y el panel
  disparan `revalidateTag`. Si crear una reseña revalida, el spam pasa a poder
  forzar churn de caché en cada petición aceptada. Mitigación propuesta:
  agregados almacenados + **no revalidar** en la creación (la media entra al
  siguiente ciclo de 3600 s) y la lista de reseñas en su propia página
  dinámica, siguiendo el precedente de `/[slug]/buscar` de F-021
  (`export const dynamic = "force-dynamic"`).
- **I8 — Superposición con la propuesta hermana.**
  `.agent/specs/propuestas/filtros-y-ordenamiento-avanzados.md` va a introducir
  ordenamientos del catálogo. «Ordenar por mejor valorados» **pertenece allí** y
  **depende de esto**; anotado en ambas direcciones para que no se implemente
  dos veces ni se quede huérfano.
- **I9 — No tocar el ranking de F-021.** F-021 está cerrado con 12 criterios
  verificados y pesos de `ts_rank` afinables en `src/constants/storeSearch.ts`.
  Inyectar popularidad en esa consulta cambiaría lo que miden sus criterios
  («el nombre exacto lo devuelve en la posición 1»). La regla 3 protege sus
  criterios; la prudencia protege su comportamiento.

## Huecos y preguntas al humano

- **SP1 — ¿Reseña con cuenta o anónima verificada por pedido?**
  _Qué falta:_ la atribución. _Por qué bloquea:_ decide si esta propuesta es
  independiente o queda detrás de F-012 (I5), y decide el modelo de datos
  entero.
  (a) **Anónima verificada por pedido**: escribe quien presenta un `code`
  válido de esa tienda. Cero infraestructura de identidad, independiente de
  F-012, y la guarda anti-abuso es la de F-010 replicada.
  (b) **Con cuenta (F-012)**: exige arrancar un feature sin empezar; además el
  criterio 4 de F-012 dice que el pedido de invitado sigue siendo posible, así
  que exigir cuenta para reseñar dejaría fuera a la mayoría de los compradores.
  (c) **Híbrido escalonado**: (a) ahora, con `Review.customerId` nullable desde
  el día uno, para que cuando F-012 exista una reseña atribuida a cuenta sea un
  cambio aditivo y una insignia («verificada»), no una migración de significado.
  **Recomendación: (c).** Ship ahora, sin cerrarle la puerta a la cuenta.

- **SP2 — ¿Se reseña el producto, la tienda o el pedido?**
  _Qué falta:_ el objeto de la reseña. _Por qué bloquea:_ cambia el esquema, la
  superficie de moderación y dónde se pinta la media.
  (a) **Solo tienda**, anclada a un pedido: lo más barato y lo más creíble.
  (b) **Solo producto**: obliga a decidir si la reputación agrega en
  `StoreProduct` o en `CanonicalProduct` (compartido entre negocios), decisión
  de marketplace que F-015/F-024 dejaron abierta.
  (c) **Pedido → tienda (obligatoria) + estrellas por línea (opcional)**, un
  solo formulario, un solo campo de texto (el de la tienda), agregando siempre
  en `StoreProduct` y **nunca** en `CanonicalProduct`.
  **Recomendación: (c).** Es lo que el humano describió («de productos y/o
  tiendas») con una sola superficie de abuso —un texto por pedido— en vez de N.
  Si se quiere partir en dos features, el corte natural es (a) primero y las
  estrellas por línea después.

- **SP3 — ¿Moderación previa o publicación directa?**
  _Qué falta:_ el estado inicial de una reseña y quién puede quitarla.
  (a) **Cola de pendientes** antes de publicar: nadie en la plataforma la va a
  atender, así que en la práctica las reseñas no aparecerían nunca.
  (b) **Publicación directa; la tienda puede ocultar libremente**: convierte la
  nota en propaganda.
  (c) **Publicación directa; la tienda puede responder públicamente y ocultar
  con motivo de vocabulario cerrado, pero ocultar quita el texto y NO la
  calificación** (R5), y la página declara cuántas hay ocultas.
  **Recomendación: (c).** Es la única de las tres en la que moderar sirve para
  quitar un insulto y no para maquillar una nota.

- **SP4 — ¿Dónde se muestra la media, y afecta al ranking?**
  _Qué falta:_ las superficies. _Por qué bloquea:_ la tarjeta del catálogo es
  SSG y cada dato extra ahí es una consulta por producto en `generateStaticParams`.
  Opciones: solo ficha; ficha + cabecera de tienda; ficha + cabecera + tarjeta.
  **Recomendación: ficha + cabecera de tienda + tarjeta**, con la media siempre
  acompañada del conteo (R7) y sin estrellas cuando no hay reseñas (R11).
  Sobre el ranking: **no** tocar la consulta de F-021 (I9); «ordenar por mejor
  valorados» va en la propuesta hermana de filtros y ordenamiento (I8).
  Sub-pregunta: ¿mínimo de reseñas para mostrar media? Recomendación: **1**, y
  que la honestidad la aporte el conteo visible, no un umbral que esconde datos.

- **SP5 — La segunda ruta pública de escritura necesita firma.**
  _Qué falta:_ decidir si se enmienda `docs/adr/0016-escritura-publica-sin-sesion.md`
  o se escribe una ADR nueva (I1, I2). _Por qué bloquea:_ `AGENTS.md` §
  Documentación exige una ADR para toda decisión estructural nueva, y la propia
  0016 dice que añadir otra ruta pesa lo mismo que la primera.
  **Recomendación: ADR nueva** que cite a la 0016, enumere sus defensas
  replicadas y las suyas propias, y nombre explícitamente la clase nueva que la
  0016 no pesó: texto de terceros en una página indexable.

- **SP6 — El techo que hay que aceptar a sabiendas (o no).**
  _Qué falta:_ aceptar o rechazar que **la tienda puede auto-reseñarse** (I3).
  El pull le entrega `code` y teléfono de todos sus pedidos, y la ADR 0016 ya
  acepta que se pueden fabricar pedidos rotando teléfonos.
  (a) **Aceptarlo y escribirlo** en la ADR de SP5, con el mismo tono de la
  0016 («es una decisión, no un olvido»), y reabrir si aparece abuso medido.
  (b) **No aceptarlo** → hay que esperar a F-012 (y aun así solo sube el coste
  del fraude, no lo elimina).
  **Recomendación: (a).** El daño es reputación inflada de una tienda, no
  pérdida de datos ni dinero; y (b) paga un feature entero por una mejora
  parcial.

- **SP7 — ¿El comprador puede editar o borrar su reseña?**
  _Qué falta:_ si se construyen las rutas de edición y borrado.
  Recomendación: **editar sí**, mientras conserve el `code` y dentro de
  `REVIEW_EDIT_WINDOW_DAYS` (E14), quedando marcada como editada; **borrar
  sí**, y el borrado del autor **sí** quita la calificación de la media (a
  diferencia de ocultar, R5) — es su contenido, no el de la tienda.

## No decidido a propósito

- **Cómo se almacenan y recalculan los agregados** (columnas en `Store`/
  `StoreProduct` vs tabla de resumen vs cálculo en la lectura cacheada): lo
  cierra `sdd-architect` con I6 e I7 en la mano.
- **Si la lista de reseñas vive en su propia ruta dinámica o en la ficha**: lo
  cierra `sdd-architect`; el precedente barato es `/[slug]/buscar` de F-021.
- **La forma exacta del control de estrellas** (radios nativos sin JavaScript
  vs isla mínima): lo cierra `sdd-designer` respetando R12.
- **Retención y anonimización** de reseñas ocultas y de sus motivos: fuera de
  este feature, igual que la retención de `StoreSearchQuery` en F-021.
- **El ID del feature y su entrada en `.agent/features.json`**: los escribe el
  humano (regla 4). Esta propuesta no toca el backlog.
