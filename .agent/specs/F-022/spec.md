---
feature: F-022
agente: sdd-spec
actualizado: 2026-09-02T22:36:09Z
estado: listo
---

## Problema

Hoy no existe ninguna regla de horario en el producto. `Store.openingHours`
(`prisma/schema.prisma:258`) se **escribe** desde el sync
(`src/features/sync/server/handlers/store.ts:173`) y **nadie lo lee**: cero
apariciones de `Intl.DateTimeFormat`, `timeZone`, `getHours` o `startOfDay` en
todo `src/`, y ninguna librería de fechas en `package.json`. Lo que hoy decide si
una tienda está «abierta» o «cerrada» es otra cosa —`status` más las columnas
`disabled*`, resueltas en `src/lib/storeClosure.ts:15`—, o sea el interruptor,
no el reloj.

Por eso el comprador no puede saber, mirando la tienda, cuándo atiende el
negocio: la única señal que ve es «Abierta» en cuanto la tienda está publicada, a
las cuatro de la mañana igual que al mediodía, y en ninguna parte del producto
está escrito a qué hora abren los domingos. Lo que este feature le da es
justamente eso —**el horario publicado de la semana, y que decida él**, en
palabras del humano—, no un «abierto ahora»: por qué no puede ser un «ahora»
está en SP5 y en R14, y es la decisión más importante de este documento.

Y el porqué de la zona horaria ya estaba escrito en la propuesta que originó el
feature: **la regla de horario, si se construyera hoy, se evaluaría contra el
reloj del servidor y daría resultados distintos según dónde se ejecute** —un
contenedor en UTC, la máquina de un desarrollador en `America/Havana`, un runtime
de Vercel en otra región—, porque
`openingHours` no viene acompañado de la zona horaria del local. «Abrimos a las
9:00» es una afirmación sobre el reloj **de la tienda**, y sin ese dato la
afirmación no se puede evaluar: no hay contra qué comparar. Un desplazamiento
fijo (`-04:00`) tampoco sirve: Cuba cambia de horario dos veces al año y el
mismo `-04:00` sería falso medio año.

**Y una honestidad que conviene dejar escrita ahora y no descubrir en la
revisión:** para _pintar_ «de 9:00 a.m. a 6:00 p.m.» la página no necesita la
zona horaria. `Store.timezone` la piden los criterios 1, 2 y 3 —publicar sin
zona falla, el cálculo coincide con la hora local, un identificador inválido se
rechaza—, la necesita `evaluateStoreHours` para decir abierto o cerrado, y la
consumirá F-011 cuando el panel le muestre su estado al negocio. Sin ella el
horario sería un texto sin reloj al que referirse, y la primera regla que alguien
escriba sobre él volvería a evaluarse contra el reloj del servidor. La columna se
crea ahora, con el calendario, porque separarlas es lo que dejó este hueco
abierto.

El segundo problema es de datos, no de pantalla, y muerde en silencio.
[ADR 0007] fija el dueño de cinco campos de `StoreProduct`; la v7 del contrato
(`docs/sync-contract.md:561-576`) fija el de cinco de `Store` y dice, con esas
palabras, que «el resto de columnas de `Store` y de `StoreProduct` queda para la
tabla exhaustiva de F-022». Son 10 campos con dueño escrito de 54 columnas. Cada
columna sin dueño escrito es una discusión futura sobre quién pisó qué, y un
`UPDATE` del sync que borra el trabajo del negocio sin error y sin rastro.

## Alcance

### Dentro

1. **`Store.timezone`**: columna nueva, `NOT NULL` con default
   `America/Havana`, propiedad del **panel**. La escribe la migración; en este
   feature no la escribe nadie más (ver I3).
2. **El validador de identificadores IANA**: una función pura y un schema Zod
   que aceptan `America/Havana` y rechazan `America/Habana`, `-04:00`, `Cuba`,
   `UTC` y `EST5EDT`. Es lo que da dientes a R1.
3. **La forma de `openingHours`**: hoy es `z.unknown().nullish()`
   (`src/features/sync/schemas.ts:41`), o sea que el POS puede mandar cualquier
   cosa y se guarda. Este feature fija el formato, lo valida y lo publica en el
   contrato. **SP3 = (a):** un `openingHours` malformado **rechaza ese evento**,
   con `STORE_OPENING_HOURS_INVALID`. Dónde vive la comprobación lo midió
   sdd-architect y **no** es el schema del `payload`: ver E10.
4. **El evaluador de abierto/cerrado en hora de la tienda** (`evaluateStoreHours`):
   función pura, sin Prisma y sin React, que recibe el calendario, la zona y el
   instante, y devuelve abierto/cerrado más la siguiente transición. Se
   construye y se prueba con `TZ` en varios husos —el criterio 2 lo exige
   literalmente— y **en este ciclo no lo consume la interfaz**: sus únicos
   llamadores son sus pruebas, y el de producción llega con F-011. Es una
   función exportada sin consumidor durante un ciclo, a propósito y con la
   incomodidad incluida (ver SP5 y R14).
5. **Pintar el horario publicado de la semana en la página pública de la
   tienda**: los siete días en orden, cada uno con sus tramos o «no abre», en el
   **HTML cacheado** de `/[slug]`, sin afirmar ningún estado en vivo y sin un
   byte de JavaScript de cliente (SP5 = (b), R14).
6. **La tabla exhaustiva de propiedad de campos** en `docs/sync-contract.md`:
   las 31 columnas de `Store` y las 23 de `StoreProduct`, cada una con su dueño
   y con qué le hace un evento `STORE`/`PRODUCT` que la toca.
7. **Dejar escrito que el umbral de stock bajo se configura y se queda en
   cuadrecaja** ([ADR 0003]), y que aquí no hay ni habrá columna que lo guarde.
8. La versión nueva del contrato y su sección de cambios (ver § Datos y
   contrato, «Versión del contrato»).

### Fuera (explícito)

- **El editor de horarios y de zona horaria en el panel. Es F-011.** F-022 no
  añade ni formulario, ni endpoint, ni mutación que escriba `timezone` u
  `openingHours`. Consecuencia directa sobre el criterio 3: ver I3.
- **La política de vencimiento de pedidos y propuestas.** Sigue siendo del
  bucle de renegociación de F-019, con el reloj del proceso y el `now()` de
  Postgres: `src/features/orders/server/expiry.ts:33-37` y `:86-91`,
  `src/features/orders/server/proposal.ts:72-73`, `src/features/orders/deadline.ts`.
  No se toca ni una línea. Esto **acota R2 de la propuesta**, que decía «ninguna
  regla de horario usa la hora del servidor» y se leía como «todos los relojes
  del producto»: la decisión del humano es que R2 alcanza **solo** a
  abierto/cerrado.
- **La vigencia de promociones en hora de la tienda.** `isVigente`
  (`src/lib/promotions.ts:52-55`) compara instantes UTC y se queda como está.
- **Un segundo calendario de entrega**, distinto del de apertura. Decisión del
  humano: un solo calendario, el de apertura. La `SP2` de la propuesta queda
  cerrada por ahí.
- **Que el horario bloquee comprar. Decidido: no lo hace** (SP4 = (a)). El
  horario **solo informa**. Una tienda `PUBLISHED` fuera de su horario sigue
  navegable, el carrito funciona, el checkout acepta el pedido y el
  `409 STORE_CLOSED` del contrato **conserva su significado actual**: el
  interruptor apagado, nunca «son las 3:00». Ni `src/features/orders/` ni
  `src/features/cart/` se tocan. Bloquear la compra por horario sería un feature
  del humano, con sus propios criterios (regla 4).
- **Cualquier columna de `Storefront`, `Promotion`, `Order` u `OrderItem` en la
  tabla de propiedad.** El criterio 4 nombra `Store` y `StoreProduct`; el resto
  es una propuesta (ver AC8).
- **Afirmar el estado en vivo en la página pública.** La tienda **no** dice
  «abierta ahora» ni «cerrada ahora», ni «hoy atendemos de…», ni «abre en tres
  horas», ni resalta el día actual: cualquiera de esas frases depende del
  instante y el HTML está cacheado (SP5 = (b), R14). Lo que se pinta es el
  horario de la semana, que es dato de la tienda y no del momento.
- **El hueco dinámico dentro de `<Suspense>`.** La spec lo fijó en su primera
  versión y **no existe** en Next 16.3.2 con la caché de este repo: medido con
  cuatro builds reales por sdd-architect (`.agent/specs/F-022/architecture.md`,
  § «El cartel en la página»). No se vuelve dinámica ninguna ruta, no se toca
  `src/app/[slug]/layout.tsx` y [ADR 0006] se queda como está.
- **Bajar el `revalidate` de la tienda.** Descartado, y además inservible: con
  ISR el primer visitante después del vencimiento recibe el HTML rancio y la
  regeneración va detrás, así que en una tienda con poco tráfico el desfase es
  el intervalo entre visitas, no el `revalidate`.
- **El horario en la ficha de producto, el catálogo, las categorías y la
  búsqueda.** Contesta una pregunta de entrada a la tienda; repetirlo en cinco
  rutas más no añade información y multiplica la superficie de un cambio de
  texto.
- **Migrar los `openingHours` que ya estén guardados.** Hoy no hay ninguno: el
  seed no escribe la columna y no existe ningún fixture que la ponga, así que
  todas las filas tienen `NULL`. La regla del lector tolerante (R9) cubre el
  caso por si alguna base tiene un valor a mano.

## Actores y precondiciones

| Actor            | Qué dispara                                                                 | Precondición                                      |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| El comprador     | Abre `/[slug]` y lee el horario publicado de la semana                      | La tienda existe y no está en `DRAFT`             |
| cuadrecaja       | Manda un evento `STORE` con `openingHours`                                  | Token de sync válido; `publishToStore` como sea   |
| El sync          | Publica o republica la tienda (`status: "PUBLISHED"`)                       | `handleStore` llegó al camino de crear/republicar |
| El administrador | Reabre la tienda con el interruptor (`PATCH /api/admin/stores/{id}/status`) | Sesión de panel con acceso a esa tienda           |
| La plataforma    | Aplica la migración que añade `timezone` con su default                     | —                                                 |

Nadie edita la zona horaria ni el calendario desde el panel en este feature: no
hay pantalla ni endpoint que lo permita (§ Alcance, Fuera).

## Comportamiento esperado

Los escenarios E1-E4 vienen de la propuesta; E2 cambia de contenido porque el
vencimiento de pedidos quedó fuera de alcance, y el resto son nuevos.

**Léelos sabiendo a quién se le pregunta.** E1, E2, E6 y E7 son del **evaluador**
(`evaluateStoreHours`), que recibe su instante por parámetro; E8, E9, E12 y E13
son de la **página**, que en este ciclo pinta el horario de la semana y no afirma
ningún estado (SP5 = (b), R14). Confundir los dos sujetos es el malentendido más
caro que puede tener este documento: la primera versión de E13 pedía justo lo que
se decidió no construir.

- **E1** — Dada una tienda con `timezone = "America/Havana"` y `wed` abierto de
  09:00 a 18:00, cuando se evalúa el instante `2026-09-02T14:00:00Z` (10:00 en La
  Habana), entonces `evaluateStoreHours` devuelve **abierta**,
  **independientemente del `TZ` del proceso que la ejecute**. Ojo a quién se le
  pregunta: es el evaluador, no la página. La página de este ciclo no afirma
  estados (SP5 = (b), E13).
- **E2** — Dada la misma tienda, cuando el instante es `2026-09-02T04:30:00Z`
  (00:30 del miércoles en La Habana), entonces `evaluateStoreHours` devuelve
  **cerrada** con la próxima apertura a las 09:00 del mismo día. La fecha de
  entrega propuesta **no cambia**: sigue saliendo del reloj de Postgres y de
  `orderExpiryHours` (§ Alcance, Fuera).
- **E3** — Dada una tienda cuya columna `timezone` tiene un valor que no es un
  identificador IANA conocido por el runtime, cuando el sync intenta
  publicarla o republicarla, entonces el evento **falla** (`SyncEvent.status =
"FAILED"`, con su `error`), la tienda no queda `PUBLISHED` y el lote responde
  el evento como fallido, nunca como `ok` (AGENTS.md § «Un evento fallido NO es
  un duplicado»).
- **E4** — Dado un `product.update` del sync, entonces ninguna columna cuyo
  dueño sea el panel cambia: `description`, `imageUrls`, `priceOverride`,
  `priceOverrideCurrency`, `visible`, `featured`. Es la invariante que ya
  protege `src/features/sync/server/handlers/product.test.ts:117-138`; F-022 la
  documenta campo a campo, no la reimplementa.
- **E5** — Dada la misma tienda del E3, cuando el administrador pulsa el
  interruptor para reabrirla, entonces `PATCH /api/admin/stores/{storeId}/status`
  con `{ "enabled": true }` responde **409** `{"error":"INVALID_TIMEZONE"}` y
  `status` sigue siendo `SUSPENDED`. Cerrar (`{"enabled": false, ...}`) sigue
  funcionando siempre: una zona ilegible nunca puede impedir cerrar una tienda.
- **E6** — Dada una tienda con `timezone = "America/Havana"` y `tue` con la
  ventana `22:00 → 02:00`, cuando el instante es `2026-09-02T04:30:00Z` (00:30
  del **miércoles**), entonces está **abierta**: la ventana del martes cruza la
  medianoche. Con la misma ventana declarada en `wed` en vez de `tue`, el mismo
  instante da **cerrada**.
- **E7** — Dada una tienda con `sat` de `22:00 → 02:00`, cuando el instante es
  `2026-11-01T04:30:00Z` y cuando es `2026-11-01T05:30:00Z` —los dos son «00:30
  del domingo» en La Habana, porque esa madrugada el reloj se atrasa—, entonces
  las dos veces está **abierta**, con la misma respuesta y sin error.
- **E8** — Dada una tienda sin horario publicado (`openingHours IS NULL`, que es
  el estado de **todas** las filas de hoy), entonces la página **no pinta nada**
  de horario y se comporta exactamente como antes de este feature. No hay
  «horario no disponible»: una línea que no aporta información ocupa sitio y
  ensucia la vitrina.
- **E9** — Dada una tienda con horario publicado pero con `status` distinto de
  `PUBLISHED`, entonces manda el interruptor: la página muestra el aviso de
  cierre que ya existe (`resolveStoreClosureHeadline`) y **no** pinta el horario.
  El horario solo aparece en la rama publicada. A un comprador que llega a una
  tienda suspendida, saber que los martes abre a las 9:00 no le sirve de nada:
  lo que necesita es por qué está cerrada y cómo preguntar.
- **E10** — Dado un evento `STORE` cuyo `openingHours` no cumple el formato,
  entonces **ese evento se rechaza** con `STORE_OPENING_HOURS_INVALID` y
  **ninguna** columna de la tienda cambia. SP3 = (a), con su consecuencia
  aceptada por el humano: **ese evento tampoco aplica el resto de sus campos**;
  un `name` o un `phone` corregidos en el POS viajan en el mismo evento y se
  quedan sin aplicar hasta que el calendario sea válido. Se verifica entregando
  un lote con un `openingHours` malformado y comprobando cuatro cosas: el evento
  vuelve **fallido** (nunca en `ok`), su `SyncEvent.status` es `"FAILED"` con el
  `error` nombrando la constante, `SELECT name, "openingHours"` devuelve los
  valores de antes, y **los demás eventos del mismo lote sí se aplican**.

  Ese último punto es el matiz que corrigió sdd-architect y que esta spec tenía
  mal: la comprobación **no** puede vivir en `storePayloadSchema` junto al
  `STORE_DELIVERY_CONFIG_INCONSISTENT` de hoy, porque ese camino responde un
  `400 INVALID_BATCH` que **tira el lote entero sin escribir ninguna
  `SyncEvent`** —el outbox del POS se atascaría completo por un calendario, y
  E10 no se podría verificar como está escrito—. Vive en el handler, como una
  guarda que lanza `SyncEventFailure` justo antes de la escritura, que es el
  patrón que `assertDeliveryConsistent` ya usa
  (`src/features/sync/server/handlers/store.ts:296`). El comportamiento
  observable que este escenario exige no cambia; el sitio, sí.

- **E11** — Dado un evento `STORE` con la clave `timezone` en el `payload`,
  entonces se ignora sin error y `Store.timezone` no cambia: `storePayloadSchema`
  no es `.strict()`, así que Zod descarta las claves desconocidas. La zona es
  del panel y el POS no la puede escribir ni por accidente.
- **E12** — Dado un `openingHours` guardado que el lector no puede interpretar
  (formato viejo, o `version` desconocida), o una `timezone` guardada que este
  runtime no conoce, entonces la página **no falla**: se comporta como el E8 (no
  pinta nada) y deja un `console.warn("[hours] ...")` —nunca `console.error`, que
  pondría roja cualquier etapa que lea la salida del servidor (AGENTS.md).
- **E13** — Dada una tienda `PUBLISHED` con horario publicado, cuando se pide
  `/[slug]` a las 17:59 y otra vez a las 18:01 hora de la tienda, entonces **las
  dos respuestas son el mismo HTML**: se pinta el horario de la semana —los siete
  días en orden, con sus tramos o «no abre»— y **ninguna de las dos afirma nada
  sobre el ahora**. Ni el estado, ni qué día es hoy. Por eso puede salir del CDN
  sin mentir, con su `export const revalidate = 3600`
  (`src/app/[slug]/layout.tsx:19`) intacto y sin JavaScript nuevo en el
  navegador.

  **La versión anterior de este escenario pedía lo contrario** —que las dos
  respuestas dijeran cosas distintas sin revalidar— y esa propiedad **se soltó a
  propósito** cuando sdd-architect midió que el hueco dinámico no existe en este
  Next (SP5 = (b)). Queda escrito así, sin maquillar: el producto no sabe decir
  «abierto ahora» en la vitrina, y el día que lo sepa será porque alguien migró
  el modelo de caché de la app, que es otro feature.

## Reglas de negocio

- **R1** — `Store.timezone` es un identificador IANA de zona **canónico**, no un
  desplazamiento fijo. Se valida en tres pasos, y los tres hacen falta:
  1. forma: `^[A-Za-z][A-Za-z_]*(?:/[A-Za-z0-9_+-]+){1,2}$` —esto ya elimina
     `-04:00`, `+0500` y la cadena vacía;
  2. **pertenencia a `Intl.supportedValuesOf("timeZone")`**, y **sensible a
     mayúsculas**: 418 valores en este runtime, y de todas las capitalizaciones
     posibles solo `America/Havana` está en la lista. Esto es lo que elimina
     `Cuba`, `EST5EDT`, `UTC`, `GMT`, `Etc/GMT+5` y `america/havana`;
  3. usabilidad: `new Intl.DateTimeFormat("en-US", { timeZone: v })` no lanza.

  **El paso 2 es el que hace el trabajo, y el orden importa.** Medido contra
  este runtime (Node 24.13.1, ICU 78.2): `Intl.DateTimeFormat` **acepta**
  `+05:00`, `+0500`, `Cuba`, `EST5EDT`, `UTC`, `GMT`, `Etc/GMT+5` y
  `america/havana` —resolviendo unos a `America/Havana` y otros a un
  desplazamiento fijo— y solo lanza con basura del tipo `Nope/Nada`,
  `America/Habana`, la cadena vacía o un espacio final. Así que validar «con
  `Intl` no explota» **no es validar R1**.

  Corolario, y es una trampa que hay que escribir en el código: **nada de
  `toLowerCase()` ni de `trim()` de cortesía antes de comprobar la
  pertenencia.** Normalizar la capitalización convertiría `america/havana` en un
  valor aceptado, que es exactamente lo que R1 prohíbe: un identificador IANA
  tiene una sola forma canónica y esa es la que se guarda. Si un valor llega con
  otra capitalización, se rechaza y se corrige en el origen.

- **R2** — Ninguna regla de **abierto/cerrado** usa la hora del servidor. La
  única forma de obtener la hora local de la tienda es formatear un instante con
  `timeZone: store.timezone`; está prohibido `getHours()`, `getDay()`,
  `toLocaleString()` sin `timeZone`, restar un desplazamiento a mano y sumar
  minutos a un `Date` para «pasarlo» a otra zona. Fuera de abierto/cerrado, el
  reloj del proceso y el de Postgres siguen mandando (§ Alcance, Fuera).
- **R3** — Cada columna de `Store` y de `StoreProduct` tiene **exactamente un**
  dueño escrito en `docs/sync-contract.md`. Un campo con dos dueños, o con
  ninguno, es un fallo del criterio 4, no una ambigüedad tolerable. Cuando dos
  escritores tocan legítimamente la misma columna (hoy `status`, `disabledMessage`
  y `disabledAt`), la fila nombra al **árbitro** que decide, no dos dueños.
- **R4** — El umbral de stock bajo no se envía ni se almacena aquí. Solo viaja el
  enum `Availability` de tres valores ([ADR 0003]). Ninguna columna nueva de este
  feature —ni de ningún otro— se llama `*Threshold` ni `umbral*`.
- **R5** — El cálculo de abierto/cerrado se resuelve **en el servidor**, y en la
  vitrina no se calcula en absoluto: la página pinta un dato guardado, no un
  estado. Pintar el horario **no añade JavaScript de cliente**: nada de
  `"use client"` en el camino del catálogo (AGENTS.md § Prohibiciones), ni
  `new Date()` en el navegador —que además daría la hora del comprador, que es
  justo el error que este feature existe para arreglar—, ni una petición del
  cliente para refrescar nada. El presupuesto de `npm run check:bundle` no se
  mueve por este feature; si se moviera, es la señal de que alguien puso el
  cálculo en el navegador.
- **R6** — El evaluador es **puro**: recibe `{ hours, timezone, now }` y no
  llama a `Date.now()` por su cuenta. Vive en `src/lib/` (sin Prisma, sin
  React). Un solo módulo lo implementa y ninguna vista rehace el cálculo
  —misma razón que `lib/pricing.ts` en [ADR 0007].
- **R7** — El calendario es **de la sucursal**, no de la marca. Es lo que ya
  asume `.agent/specs/F-017/architecture.md:1483`: `openingHours` es por local.
  Una marca con varias sucursales no tiene horario propio.
- **R8** — El interruptor manda sobre el horario (E9). El orden de precedencia
  es: `status !== "PUBLISHED"` → el aviso de cierre de `src/lib/storeClosure.ts`
  y nada más; `status === "PUBLISHED"` y sin horario legible → nada;
  `status === "PUBLISHED"` con horario → el horario de la semana.
- **R9** — El **lector** es tolerante y el **escritor** es estricto, y las dos
  mitades son deliberadas (SP3 = (a)). Escribir: un `openingHours` que no cumple
  el formato **hace fallar ese evento** —en el handler, no en el schema del
  `payload` (E10)—, así que la columna no cambia y el POS se lleva un error con
  nombre. Leer: un valor
  que no cumple —porque entró antes de que existiera la puerta, o lo puso alguien
  a mano— nunca rompe la tienda (E12). Un lector estricto convertiría un dato
  viejo en un 500 en la vitrina; un escritor tolerante iría acumulando
  calendarios que nadie va a arreglar.
- **R10** — Las horas se pintan en **hora de pared de la tienda**, nunca como un
  instante absoluto ni con un desplazamiento, y en **formato de 12 horas con
  `a.m.` y `p.m.`** (decisión del humano, `DP1` de
  `.agent/specs/F-022/design.md`): `9:00 a.m.` se escribe con el `:00` puesto y
  con los nombres de los días en español. Así el horario de verano deja de ser
  aritmética: no hay ninguna conversión de vuelta a UTC que pueda caer en una
  hora que no existe.

  Y la mitad que la primera versión de esta regla tenía al revés: **nada de
  palabras relativas al ahora.** «Hoy», «mañana», «abre en tres horas» y
  resaltar el día actual quedan prohibidos en la vitrina, porque los tres
  dependen del instante y el HTML está cacheado (R14). El `inDays` que devuelve
  `evaluateStoreHours` existe para F-011, no para esta página.

- **R11** — El texto del horario **no usa** las palabras del interruptor.
  «Abierta» y «Cerrada ahora» ya significan `status` en
  `src/components/store/BranchCard.tsx:20-25` y en
  `src/features/admin/components/StoreList.tsx:91-96`, y esos tres archivos no se
  tocan. Con el horario de la semana la regla se cumple **casi por
  construcción** —las únicas palabras de la pantalla son los siete días, «de … a
  …» y «no abre»—, y por eso ya no hace falta inventar un vocabulario disjunto
  (I5 se disolvió). Se sigue comprobando con un `grep` sobre el componente
  nuevo: una regla que se cumple sin esfuerzo se rompe igual de fácil en la
  primera edición.
- **R12** — La transición a `PUBLISHED` valida `timezone` (R1). Los tres únicos
  sitios que hoy escriben `status: "PUBLISHED"` son
  `src/features/sync/server/handlers/store.ts:195-196` (crear),
  `:234-235` (republicar) y `src/features/admin/server/mutations.ts:394`
  (`setStoreEnabled` con `enabled: true`). Los tres pasan por la misma
  comprobación; ninguno la reimplementa.
- **R13** — El default de la columna es una constante nombrada, no un literal
  repetido (AGENTS.md § Prohibiciones, magic strings). El mismo valor aparece en
  `prisma/schema.prisma`, en el `migration.sql` y en el código: los tres se
  cuadran contra la constante en un test.
- **R14** — **La página no afirma nada del ahora, y por eso se puede cachear sin
  mentir** (SP5 = (b)). Ni el estado abierto/cerrado, ni qué día es hoy, ni
  cuánto falta para abrir. Lo que pinta es el horario **publicado** de la semana,
  que es un dato de la tienda y cambia cuando el POS publica otro calendario —lo
  que ya dispara `revalidateTag` ([ADR 0006])—, no cuando pasa el tiempo.

  Las dos prohibiciones de la versión anterior de esta regla siguen valiendo, y
  ahora se cumplen solas porque no hay instante que colocar en ningún sitio:
  1. **no meter el instante en nada cacheado** con el resto de la tienda —lo que
     se cachea es la lectura de `{ timezone, openingHours }`, que ya viaja en el
     mismo `select`—;
  2. **no bajar el `revalidate`** ni volver dinámica la página, que anularía el
     ISR de todo el catálogo —justo lo que AGENTS.md protege cuando prohíbe que
     el `matcher` del proxy toque `/[slug]`— y además pondría **roja la etapa
     `bundle`**: `scripts/check-bundle-budget.mjs:81-89` exige que el build
     prerenderice al menos una portada de tienda y sale con 1 si no la
     encuentra, así que se llevaría con ella el criterio 7.

  La consecuencia de esta regla es que `evaluateStoreHours` se queda un ciclo
  **sin llamador de producción** (§ Alcance, punto 4). Es incómodo y es a
  propósito: el criterio 2 exige el evaluador, y su consumidor es F-011.

## Casos límite y errores

La propuesta dejó cuatro casos abiertos. Los cuatro se cierran aquí, y hay seis
más que salieron de leer el código.

| #   | Caso                                                 | Resolución                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Zona inválida o desconocida para el runtime**      | Al escribir: imposible por R1 (y hoy, por alcance, nadie escribe). Al publicar: E3/E5, falla. Al leer: E12, no se pinta nada y queda un `console.warn`. Un runtime con ICU recortada se detecta en un test que afirma que el default está en `Intl.supportedValuesOf("timeZone")` y que la lista tiene más de 300 entradas: si el despliegue cambia de runtime, se pone rojo el CI en vez de mentir en producción                                                                        |
| 2   | **Cambio de horario de verano dentro de la ventana** | No hace aritmética: el evaluador va del instante a la hora de pared, nunca al revés (R10). En La Habana el salto es a medianoche, justo dentro de una ventana `22:00 → 02:00`. Adelanto (2026-03-08): la hora local 00:00-00:59 **no existe** y ningún instante la produce, así que la tienda abre una hora menos ese día; se acepta y se documenta. Atraso (2026-11-01): «00:30 del domingo» **ocurre dos veces** y las dos dan la misma respuesta (E7)                                 |
| 3   | **Tienda que cambia de zona con pedidos abiertos**   | No afecta a ningún pedido. Los vencimientos son instantes UTC y quedaron fuera de alcance: cambiar la zona cambia **solo** cómo se interpretaría el calendario, desde ese momento. Con el editor de F-011 esto habrá que revisarlo otra vez, y ahí es donde debe quedar escrito                                                                                                                                                                                                          |
| 4   | **Horario que cruza medianoche (22:00 → 02:00)**     | Se soporta explícitamente: `to <= from` significa que la ventana termina el día **siguiente**. La ventana pertenece al día en que **abre**. E6 lo prueba con dos filas que solo se diferencian en de qué día es la ventana, que es el bug clásico. `00:00 → 24:00` es «abierto todo el día» y no cruza nada; `from == to` se rechaza al validar por ambiguo                                                                                                                              |
| 5   | **Todas las filas tienen `openingHours = NULL`**     | Es el estado real de la base hoy. E8: no se pinta nada. El seed publica un horario en la tienda de demostración —incluida una ventana que cruza medianoche— para que la etapa visual tenga algo que mirar, y sigue siendo idempotente al correrlo dos veces                                                                                                                                                                                                                              |
| 6   | **Un día sin ventanas y un día ausente**             | `[]` es «cerrado todo el día» y es válido. Una clave de día **ausente** es un error de validación, no un cierre implícito: el POS y el futuro editor tienen que decir los siete días. Los siete `[]` es un calendario válido que significa «nunca abre»                                                                                                                                                                                                                                  |
| 7   | **Ventanas solapadas o desordenadas dentro del día** | Se rechaza al validar: las ventanas de un día van estrictamente ordenadas por `from` y sin solapar. Como máximo una ventana por día puede cruzar la medianoche, y tiene que ser la última                                                                                                                                                                                                                                                                                                |
| 8   | **Reintento del mismo evento `STORE`**               | Sin cambios: `openingHours` se escribe por reemplazo completo, nunca fusionando, así que aplicar dos veces el mismo evento deja la misma fila. La guarda anti-rancio `sourceUpdatedAt` sigue siendo el único árbitro (AGENTS.md § Cosas que muerden)                                                                                                                                                                                                                                     |
| 9   | **Evento que omite `openingHours`**                  | La columna queda **intacta**, que es lo que ya hace el código (`src/features/sync/server/handlers/store.ts:173`) y lo que promete el contrato (`docs/sync-contract.md:555`). Esto no cambia: sería un cambio de semántica de omisión, y ese debate ya lo cerró F-032                                                                                                                                                                                                                     |
| 10  | **Dos relojes en un test**                           | Cualquier `*.db.test.ts` de este feature que compare tiempos lee los dos extremos de la **misma** fuente. Fichas `.agent/playbook/db-test-cross-process-clock-skew.md` y `.agent/playbook/realtime-bell-close-clock-skew.md`: el reloj de Postgres y el de Node difieren en decenas de milisegundos. En este feature el riesgo es bajo porque el evaluador recibe su `now`, pero la puerta de publicación corre contra la base                                                           |
| 11  | **Evento `STORE` con un `openingHours` malformado**  | Falla ese evento **completo** con `STORE_OPENING_HOURS_INVALID` (E10, SP3 = (a)) y no se aplica ninguno de sus campos, ni los que no tienen nada que ver con el horario. El resto del lote sí se aplica: la guarda vive en el handler, no en el schema del `payload`. Es el coste aceptado de tratar el evento como una unidad, y es lo que hay que avisarle a cuadrecaja antes de publicar la v9: un POS que empiece a mandar calendarios tiene que mandarlos bien o dejar de mandarlos |
| 12  | **El HTML cacheado envejece**                        | No puede mentir, porque no afirma nada del ahora (R14, SP5 = (b)): el horario de la semana es el mismo a las 17:59 y a las 18:01, y cambia solo cuando el POS publica otro calendario, lo que ya dispara `revalidateTag`. Los dos riesgos que quedan son de implementación y están prohibidos por escrito: que alguien meta «hoy» o «abierto ahora» en ese HTML, y que alguien vuelva dinámica la página para poder hacerlo —lo segundo pone roja la etapa `bundle`                      |

## Datos y contrato

### `Store.timezone`

| Propiedad | Valor                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo      | `String` (`TEXT`), `NOT NULL`                                                                                                                                           |
| Default   | `America/Havana`, desde una constante nombrada (R13)                                                                                                                    |
| Dueño     | **panel** (decisión del humano). El POS nunca la manda; si la manda, se ignora (E11)                                                                                    |
| Valores   | Identificador IANA canónico (R1). Ni desplazamientos, ni alias, ni `UTC`                                                                                                |
| Largo     | ≤ 64 caracteres                                                                                                                                                         |
| Migración | `ALTER TABLE "Store" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT '...'` — aditiva, no reescribe filas, no necesita ninguno de los dos comandos prohibidos por AGENTS.md |

Dos avisos para quien escriba la migración:

1. **Sin `CHECK`.** Una restricción de base no puede expresar «es un IANA que el
   runtime conoce», y un `CHECK (timezone <> '')` haría **imposible** verificar
   el criterio 1 por el camino acordado con el humano. Si alguien la añade de
   todos modos, el test de ese criterio tiene que forzar `'Nowhere/Nothing'` en
   vez de la cadena vacía.
2. **Quita del `migration.sql` generado los `DROP INDEX` de los cinco índices
   GIN y parciales que no están en el schema** (AGENTS.md § Cosas que muerden).
   Aplicarlo sin mirar no rompe ningún test y deja la búsqueda en producción
   haciendo scans secuenciales.

Y **dos** pasos operativos, que van a `docs/despliegue.md` **en el mismo ciclo**
(AGENTS.md § Documentación), porque son las dos mitades que ningún sensor puede
comprobar:

1. **La zona a mano mientras no haya editor.** Mientras F-011 no tenga el
   formulario, la zona de una tienda que no esté en el huso de La Habana hay que
   cambiarla con un `UPDATE` al dar de alta el negocio.
2. **Comprobar una vez, en un preview, que el ICU del runtime trae el juego
   completo de zonas** (`AP2`, resuelta por el humano): que
   `Intl.supportedValuesOf("timeZone")` devuelve el juego completo y no una lista
   recortada. El test del caso límite 1 —el default dentro de la lista y más de
   300 entradas— cubre la otra mitad, pero corre en la máquina del CI, que no es
   la que sirve las peticiones. Medido aquí para que el preview tenga contra qué
   comparar: Node 24.13.1 con ICU 78.2 devuelve 418 zonas e incluye
   `America/Havana`.

### La forma exacta de `openingHours`

Un objeto, no un array; con versión, para que el próximo cambio de forma no
obligue a hacer arqueología. Los nombres van en inglés (AGENTS.md § Idioma).

```jsonc
{
  "version": 1,
  "days": {
    "mon": [{ "from": "09:00", "to": "18:00" }],
    "tue": [
      { "from": "09:00", "to": "13:00" },
      { "from": "15:00", "to": "18:00" },
    ],
    "wed": [], // cerrado todo el día
    "thu": [{ "from": "09:00", "to": "18:00" }],
    "fri": [{ "from": "22:00", "to": "02:00" }], // cruza la medianoche
    "sat": [{ "from": "00:00", "to": "24:00" }], // abierto todo el día
    "sun": [],
  },
}
```

Reglas del formato, todas comprobables por separado:

| Regla               | Detalle                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | Entero, hoy siempre `1`. Un `version` desconocido se rechaza al escribir (E10) y no se evalúa al leer (E12)                                                               |
| `days`              | Objeto con **exactamente** las siete claves `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. Ni una menos (caso 6), ni una más                                            |
| Ventanas por día    | Array de 0 a 4 elementos. `[]` = cerrado                                                                                                                                  |
| `from`, `to`        | Cadena `HH:MM` en 24 horas, `^([01]\d\|2[0-3]):[0-5]\d$`; además `to` admite el valor exacto `"24:00"` para decir «hasta el final del día»                                |
| `from != to`        | Una ventana de longitud cero se rechaza. «Abierto 24 h» se escribe `00:00 → 24:00`                                                                                        |
| Orden               | Las ventanas de un día van estrictamente ordenadas por `from` y sin solaparse                                                                                             |
| Cruce de medianoche | `to < from` (p. ej. `22:00 → 02:00`) significa que cierra a esa hora del día siguiente. Como máximo una por día, y la última                                              |
| Claves desconocidas | Se rechazan (`.strict()`). Un `{"lunes": "9-6"}` da un error claro, no un calendario ignorado en silencio                                                                 |
| Tamaño              | El JSON serializado, ≤ 2 KB                                                                                                                                               |
| Zona                | **No** viaja aquí. La zona es `Store.timezone` y es del panel. Un `openingHours` con una clave `timezone`, `tz` u `offset` se rechaza por la regla de claves desconocidas |

El evaluador (en src/lib/openingHours.ts, por crear) recibe
`{ hours, timezone, now }` y devuelve tres estados: `unknown` (sin horario, o
ilegible), `open` con la hora a la que cierra, y `closed` con el próximo día y
hora de apertura —buscando hasta 7 días hacia delante— o `null` si el
calendario nunca abre. Dos trampas de implementación que ya están medidas y que
hay que escribir en el código:

1. **La hora de pared se saca con `formatToParts`, con el locale fijado a
   `"en-US"` y `hourCycle: "h23"`.** Con el locale por defecto del runtime, la
   cadena del día de la semana cambia y la búsqueda de la clave falla; con
   `hour12: false` en vez de `hourCycle: "h23"`, según la versión de ICU la
   medianoche puede formatearse como `24:00` en vez de `00:00`. En este runtime
   (Node 24.13.1, ICU 78.2) `hour12: false` da `00:00`, pero eso es suerte, no
   contrato.
2. **La ventana pertenece al día en que abre.** Evaluar «¿estoy dentro de alguna
   ventana?» solo mirando el día de hoy da cerrado a las 00:30 de un miércoles
   cuando el martes cierra a las 02:00. Hay que mirar también la ventana que
   cruza desde el día anterior (E6).

### El horario en la página

SP5 = (b), decidido por el humano con estas palabras: «HTML cacheado, y la línea
dice el horario». La forma, no el mecanismo:

| Aspecto               | Qué se fija                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué se pinta          | El horario **publicado de la semana**: los siete días en orden, cada uno con sus tramos o «no abre». Nada de estado en vivo                                             |
| Qué NO se pinta       | «Abierta ahora», «cerrada ahora», «hoy atendemos de…», «abre en tres horas», ni el día actual resaltado. Los cuatro dependen del instante                               |
| Dónde vive            | En el **HTML cacheado** de `/[slug]`, el mismo que hoy sale del CDN. Sin `<Suspense>`, sin `fallback`, sin `await connection()`, sin volver dinámica ninguna ruta       |
| De dónde sale el dato | Del mismo `select` que ya lee la tienda (`src/features/catalog/server/queries.ts:169`): `timezone` y `openingHours` entran ahí. Cero queries nuevas                     |
| Formato de hora       | 12 horas con `a.m.` / `p.m.`, con el `:00` puesto, en hora de pared de la tienda (R10, `DP1`)                                                                           |
| Cuándo cambia         | Cuando el POS publica otro calendario, que es lo que ya dispara `revalidateTag` ([ADR 0006]). No cuando pasa el tiempo                                                  |
| Sin horario legible   | No se pinta nada (E8, E12). Es el estado de **todas** las filas de hoy                                                                                                  |
| Tienda no publicada   | Manda el aviso de cierre del interruptor; el horario no aparece (R8, E9)                                                                                                |
| Presupuesto de JS     | **0 bytes nuevos**. Lo único que crece es el HTML de la portada                                                                                                         |
| Qué no se toca        | `src/app/[slug]/layout.tsx`, su `revalidate` literal, `src/proxy.ts`, [ADR 0006], `src/components/store/BranchCard.tsx` y `src/features/admin/components/StoreList.tsx` |

El componente, el sitio, el orden visual y la redacción exacta son de
sdd-designer; los nombres de los días y los tramos, suyos también. Lo que no
está abierto es que el texto no afirme el ahora.

**Y la parte incómoda, escrita donde se ve:** con esta decisión, el evaluador
`evaluateStoreHours` **no tiene llamador de producción en este ciclo**. Se
construye porque el criterio 2 lo exige palabra por palabra, se prueba con el
reloj del proceso en varios husos, y su consumidor —el panel mostrándole al
negocio si está atendiendo ahora— es F-011. Quien lea el código dentro de un mes
va a encontrar una función exportada que nadie llama: no es un descuido, y
borrarla rompe el criterio 2.

### La tabla de propiedad de campos

Va a `docs/sync-contract.md`, en la sección que la v7 ya abrió
(`docs/sync-contract.md:561-576`), sustituyendo la tabla de cinco filas por dos
tablas exhaustivas con las mismas tres columnas: **campo · dueño
(`cuadrecaja` / `panel` / `plataforma`) · qué pasa si llega un evento que lo
toca**. Las cinco filas de F-032 se conservan con su texto («cuadrecaja (desde
v7)»), no se reescriben.

`Store` — 31 columnas (30 hoy más `timezone`):

| Campo                | Dueño                                         | Un evento `STORE` que lo trae                                                                                                                                                             |
| -------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | plataforma                                    | Nada: la fila se localiza por `externalId`, el `id` no viaja                                                                                                                              |
| `businessId`         | plataforma                                    | Nada. El negocio sale del token autenticado, no del `payload`; una tienda cuyo `externalId` es de otro negocio se ignora (`src/features/sync/server/handlers/store.ts:97`)                |
| `storefrontId`       | plataforma (registro de marcas)               | Se fija al crear y no se mueve. Solo lo reescribe `src/features/storefront/server/registry.ts` cuando el panel agrupa dos tiendas                                                         |
| `externalId`         | cuadrecaja                                    | Se escribe al crear. Es la identidad de la `Tienda` en el POS y la clave de búsqueda                                                                                                      |
| `slug`               | plataforma (registro de slugs, [ADR 0018])    | Nada. `payload.slug` es **semilla de derivación** al crear y nada más; cambiarlo rompería URLs vivas e ISR                                                                                |
| `name`               | cuadrecaja                                    | Escribe el nuevo valor. Viaja siempre                                                                                                                                                     |
| `description`        | cuadrecaja                                    | Escribe el valor; **ausente o `null` BORRA** la columna                                                                                                                                   |
| `status`             | compartida, árbitro escrito                   | El sync la toca **solo** si `publishToStore` difiere de `sourceOptIn` (AP5); el panel la escribe en `setStoreEnabled`. Desde F-022, pasar a `PUBLISHED` exige una `timezone` válida (R12) |
| `phone`              | cuadrecaja                                    | Escribe el valor; ausente o `null` BORRA                                                                                                                                                  |
| `whatsapp`           | cuadrecaja                                    | Ídem                                                                                                                                                                                      |
| `email`              | cuadrecaja                                    | Ídem                                                                                                                                                                                      |
| `address`            | cuadrecaja                                    | Ídem                                                                                                                                                                                      |
| `city`               | cuadrecaja                                    | Ídem                                                                                                                                                                                      |
| `province`           | cuadrecaja                                    | Ídem                                                                                                                                                                                      |
| `latitude`           | cuadrecaja                                    | Ídem                                                                                                                                                                                      |
| `longitude`          | cuadrecaja                                    | Ídem                                                                                                                                                                                      |
| `openingHours`       | cuadrecaja                                    | Escribe el calendario **completo**, por reemplazo. Ausente o `null` deja la columna intacta. Desde la versión nueva, un valor que no cumple el formato no se guarda (E10/SP3)             |
| `timezone`           | **panel**                                     | **Nada.** No viaja en el `payload`; si llega la clave, Zod la descarta (E11). Hoy no la escribe nadie: el editor es F-011                                                                 |
| `checkoutMode`       | cuadrecaja (desde v7)                         | Escribe el nuevo valor; ausente la deja intacta                                                                                                                                           |
| `deliveryEnabled`    | cuadrecaja (desde v7)                         | Ídem                                                                                                                                                                                      |
| `deliveryFee`        | cuadrecaja (desde v7)                         | Escribe el nuevo valor, o `NULL` si llega `null` explícito                                                                                                                                |
| `deliveryFeeMode`    | cuadrecaja (desde v7)                         | Escribe el nuevo valor; ausente la deja intacta                                                                                                                                           |
| `orderExpiryHours`   | cuadrecaja (desde v7; antes, queandabuscando) | Ídem                                                                                                                                                                                      |
| `publishedAt`        | sync                                          | Se pone al publicar y al republicar, y se borra al suspender, siempre junto a `status` y con la misma puerta. El panel no la toca ni al reabrir                                           |
| `disabledReasonCode` | panel (vocabulario propio)                    | El sync solo la pone a `null`: al suspender, porque el POS no habla nuestro vocabulario, y al republicar                                                                                  |
| `disabledMessage`    | compartida, árbitro escrito                   | El sync escribe `unpublishReason ?? null` al suspender por un cambio de opt-in; el panel escribe su texto libre al cerrar. Gana el último que actúe                                       |
| `disabledAt`         | compartida, árbitro escrito                   | El sync la pone al suspender y la borra al republicar; el panel, al cerrar y al abrir                                                                                                     |
| `sourceUpdatedAt`    | cuadrecaja                                    | Escribe `payload.updatedAt` en todo evento aplicado. Un evento con `updatedAt` menor o igual al guardado es `STALE` y no escribe nada                                                     |
| `sourceOptIn`        | cuadrecaja                                    | Escribe `payload.publishToStore` (y `false` en un `DELETE`)                                                                                                                               |
| `createdAt`          | plataforma                                    | Nada: default de la base                                                                                                                                                                  |
| `updatedAt`          | plataforma                                    | Se mueve sola en cualquier evento aplicado (`@updatedAt`)                                                                                                                                 |

`StoreProduct` — 23 columnas. El schema ya trae los tres bloques comentados
(`prisma/schema.prisma:441`, `:453`, `:461`), así que esta tabla es su
traducción al contrato, con una tercera columna que el schema no tiene:

| Campo                   | Dueño                                    | Un evento `PRODUCT` que lo trae                                                                                                                      |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | plataforma                               | Nada                                                                                                                                                 |
| `storeId`               | plataforma                               | Se fija al crear, desde la tienda que resuelve el evento                                                                                             |
| `canonicalProductId`    | plataforma (fusión canónica, [ADR 0020]) | Se recalcula en cada evento: lo decide `resolveCanonical`, nunca el `payload` directamente                                                           |
| `externalId`            | cuadrecaja                               | Se escribe al crear. Identidad del `ProductoTienda`                                                                                                  |
| `slug`                  | plataforma                               | Se deriva **solo al crear** (`src/features/sync/server/handlers/product.ts:161`) y se congela: renombrar en el POS cambia `localName`, nunca esto    |
| `localName`             | cuadrecaja                               | Escribe el nuevo valor                                                                                                                               |
| `syncedPrice`           | cuadrecaja                               | Escribe el nuevo valor. El precio efectivo sigue siendo `priceOverride ?? syncedPrice` ([ADR 0007])                                                  |
| `syncedPriceCurrency`   | cuadrecaja                               | Escribe el nuevo valor                                                                                                                               |
| `availability`          | cuadrecaja                               | Escribe el enum de tres valores. El entero de existencias y su umbral **nunca cruzan la frontera** ([ADR 0003], R4)                                  |
| `localCategoryId`       | cuadrecaja                               | Se resuelve desde la categoría del payload                                                                                                           |
| `sourceUpdatedAt`       | cuadrecaja                               | Guarda anti-rancio: un evento más viejo que el guardado no escribe nada                                                                              |
| `syncedAt`              | plataforma                               | Instante de la escritura local, no del payload                                                                                                       |
| `deletedAt`             | cuadrecaja                               | Un `DELETE` la pone; un producto que reaparece la vuelve a `null`                                                                                    |
| `description`           | **panel**                                | **Nada: sobrevive.** El `data` del handler no la menciona (`src/features/sync/server/handlers/product.ts:148-155`)                                   |
| `imageUrls`             | **panel**                                | Nada: sobrevive                                                                                                                                      |
| `priceOverride`         | **panel**                                | Nada: sobrevive. Un override de cero es un precio real, no un valor ausente ([ADR 0007])                                                             |
| `priceOverrideCurrency` | **panel**                                | Nada: sobrevive                                                                                                                                      |
| `visible`               | **panel**                                | Nada: sobrevive                                                                                                                                      |
| `featured`              | **panel**                                | Nada: sobrevive                                                                                                                                      |
| `searchDocument`        | de ninguno de los dos (derivado, F-021)  | Se **recalcula** desde el estado de la fila, nunca se copia del payload. Ni el sync ni el panel lo ponen en su `data`: los dos llaman al reindexador |
| `searchVector`          | de ninguno de los dos (derivado, F-021)  | Ídem, con SQL crudo ([ADR 0019])                                                                                                                     |
| `createdAt`             | plataforma                               | Nada                                                                                                                                                 |
| `updatedAt`             | plataforma                               | Se mueve sola                                                                                                                                        |

Y una línea que la tabla necesita para que R4 quede escrito donde se lee: **no
existe ninguna columna de umbral de stock bajo, aquí ni en el cable.** El umbral
se configura y se queda en cuadrecaja, porque calcular el enum requiere el
stock, que nunca viaja ([ADR 0003]).

### Versión del contrato

Está en **v8** desde el 2 de septiembre. Este feature la sube a **v9, mayor**, y
el motivo no es la tabla:

- **La tabla de propiedad, sola, sería una menor** (`8` → `8.1`). No cambia lo
  que el POS envía ni recibe: documenta, campo a campo, la propiedad que ya está
  en efecto en el código de hoy. Es exactamente lo que la § Versionado llama
  «aclara lo ya acordado». Un POS que implementó la v8 sigue siendo un lector
  correcto sin tocar una línea.
- **Fijar la forma de `openingHours` es una mayor.** La § Versionado dice
  «mayor: cambia lo que el POS envía o recibe —un endpoint, un campo, un enum, un
  código de error, **una regla de validación**—, sea aditivo o no». Hoy el campo
  es `z.unknown()`: cualquier JSON entra. Después de este feature hay una forma
  normativa y un rechazo real (SP3 = (a)). Eso cambia lo que el POS puede
  enviar, así que es `8` → `9`, y **se coordina con el equipo de cuadrecaja
  antes de publicarla** (AGENTS.md § Documentación). Que hoy nadie mande un
  calendario válido no lo convierte en menor: lo que fija la categoría es el
  cambio de regla, no cuántos lo notan.
- Las dos ediciones caben en la misma subida: una sola versión, una sola sección
  «Cambios respecto a la v8», y las dos cosas anotadas allí. La regla de la
  memoria del proyecto se cumple igual: **toda edición de ese fichero mueve la
  versión de su primera línea**, y el hook `.claude/hooks/sync-contract-version.sh`
  avisa si no se movió.
- `timezone` **no** aporta nada al cable: no es un campo del `payload` y su fila
  en la tabla dice justamente que el POS no la manda. Sin `openingHours`, este
  feature habría sido una menor.

Lo que la v9 tiene que decir, además de las dos tablas de propiedad, y en este
orden de importancia:

1. **La forma completa de `openingHours`**, con el ejemplo de arriba, las siete
   claves obligatorias, `[]` como «cerrado», `24:00` como final de día y el
   cruce de medianoche explicado con `22:00 → 02:00`. Es lo único que el POS
   tiene que implementar.
2. **El rechazo, con su nombre y su alcance**: `STORE_OPENING_HOURS_INVALID`, y
   la frase incómoda escrita entera —un evento `STORE` con un calendario
   malformado **no aplica ninguno de sus campos**, tampoco el `name` o el
   `phone` que viajaban en el mismo evento—, más la mitad tranquilizadora: **el
   resto del lote sí se aplica**, y ese evento vuelve en `failed` para que el
   POS lo reintente cuando lo corrija. Es la consecuencia que el humano
   aceptó al elegir (a) y es la que el otro equipo necesita leer **antes** de
   empezar a mandar horarios, no después.
3. **Que la semántica de omisión no cambia**: `openingHours` ausente o `null`
   deja la columna intacta, igual que en la v7 (`docs/sync-contract.md:555`).
   Validar no es lo mismo que exigir: un POS que nunca mande el campo sigue
   siendo un lector correcto de la v9.
4. **Que `Store.timezone` existe, es del panel y el POS no la manda.** Va en la
   tabla, no en el `payload`, y una clave `timezone` que llegara se descarta sin
   error (E11).
5. **Que el umbral de stock bajo se queda en cuadrecaja** ([ADR 0003], R4), en
   la línea que acompaña a la tabla.

## Criterios de aceptación propuestos

Los siete `[ya]` están copiados **literalmente** de `.agent/features.json`
(regla 3: no se reescriben, ni para corregirles la ortografía). Debajo de cada
uno, cómo se verifica ejecutando algo y qué respuesta exacta se espera.

**AC1 `[ya]`** — «Publicar una tienda sin timezone falla.»

Con la zona `NOT NULL` y con default, «sin timezone» no es un estado alcanzable:
ni el panel ni el sync pueden producirlo, y el criterio no se puede probar por el
camino normal. **Este es el punto débil del feature y así hay que leerlo.** La
resolución acordada con el humano —y el criterio no se reescribe— es verificar la
puerta forzando el valor por SQL directo:

1. En un `*.db.test.ts`: `UPDATE "Store" SET timezone = 'Nowhere/Nothing' WHERE id = $1`
   sobre una tienda `SUSPENDED`, luego entregar un evento `STORE` con
   `publishToStore: true` y un `updatedAt` más nuevo. Esperado: el lote responde
   ese evento como **fallido**, `SyncEvent.status = "FAILED"` con `error` no
   vacío, y `SELECT status FROM "Store"` sigue devolviendo `SUSPENDED`. Que se
   reporte como fallido y no como `ok` importa tanto como que falle: reportarlo
   en `ok` haría que el POS marque su outbox como procesado y la tienda se
   quedara cerrada para siempre en silencio.
2. Por HTTP, el camino corto del E5: con la misma fila forzada,
   `PATCH /api/admin/stores/{storeId}/status` con `{"enabled":true}` responde
   **409** y cuerpo `{"error":"INVALID_TIMEZONE"}`. Y `{"enabled":false,...}`
   sigue respondiendo 200.
3. Un test de unidad afirma que los tres sitios que escriben
   `status: "PUBLISHED"` llaman a la misma comprobación, con la misma técnica de
   rastreo de texto que ya usa `src/features/admin/server/boundaries.test.ts`.

**AC2 `[ya]`** — «Con timezone puesta y el reloj del proceso en otro huso
(TZ=UTC), el calculo de abierto/cerrado coincide con la hora local de la
tienda.»

Se verifica contra **`evaluateStoreHours`, no contra la página**: con SP5 = (b)
la vitrina no afirma ningún estado, así que ahí no hay «cálculo de
abierto/cerrado» que comparar. Un test de tabla sobre el evaluador, con instantes
reales ya comprobados contra este runtime:

| Instante (UTC)         | Hora en La Habana | Calendario        | Esperado                 |
| ---------------------- | ----------------- | ----------------- | ------------------------ |
| `2026-09-02T14:00:00Z` | mié 10:00         | `wed 09:00→18:00` | `open`, cierra 18:00     |
| `2026-09-02T04:30:00Z` | mié 00:30         | `wed 09:00→18:00` | `closed`, abre hoy 09:00 |
| `2026-09-02T04:30:00Z` | mié 00:30         | `tue 22:00→02:00` | `open`                   |
| `2026-09-02T04:30:00Z` | mié 00:30         | `wed 22:00→02:00` | `closed`                 |
| `2026-11-01T04:30:00Z` | dom 00:30 (GMT-4) | `sat 22:00→02:00` | `open`                   |
| `2026-11-01T05:30:00Z` | dom 00:30 (GMT-5) | `sat 22:00→02:00` | `open`                   |
| `2026-03-08T04:59:00Z` | sáb 23:59 (GMT-5) | `sat 22:00→02:00` | `open`                   |
| `2026-03-08T05:01:00Z` | dom 01:01 (GMT-4) | `sat 22:00→02:00` | `open`                   |

Y la parte que da nombre al criterio: **la tabla entera se evalúa con el `TZ` del
proceso puesto en al menos tres valores distintos** —`UTC`,
`Pacific/Kiritimati` (UTC+14) y `America/Los_Angeles`— y las respuestas son
idénticas byte a byte. Hoy no hay ningún `TZ` fijado en `vitest.config.mts` ni
en el CI, y cero tests de husos: eso lo trae este feature. Dos formas de
ejecutarlo, en orden de preferencia: (a) fijar `TZ` en la configuración de los
proyectos de Vitest y recorrer los valores dentro del test cambiando
`process.env.TZ` antes de cada evaluación; (b) si esa mutación no resulta fiable
en Node 24, un script de npm que corra el mismo archivo tres veces con `TZ` en
el entorno. **La (a) sirve**: sdd-architect midió que `process.env.TZ` se puede
mutar en caliente en Node 24.13.1 y que el cambio afecta a `Date` y a `Intl` en
la misma ejecución. Lo que no vale es un solo `TZ`: sin comparar dos husos, el
test pasa con un evaluador que use el reloj del proceso.

**AC3 `[ya]`** — «Un identificador de timezone invalido se rechaza al guardar.»

En el alcance decidido **no hay camino de guardado** para `timezone` (I3), así
que se verifica sobre el validador compartido, que es lo que ese camino usará
cuando exista:

- Un test de unidad recorre la tabla completa: aceptados `America/Havana`,
  `America/New_York`, `Europe/Madrid`; rechazados `America/Habana` (la falta de
  ortografía que un humano escribe), `-04:00`, `+0500`, `Cuba`, `EST5EDT`,
  `UTC`, `GMT`, `Etc/GMT+5`, `america/havana`, `"America/Havana "` con espacio
  final, `""` y `"  "`. Esperado: `safeParse().success === false` en todos los
  rechazados, con un error nombrado.
- Un test afirma que `Intl.supportedValuesOf("timeZone")` de este runtime
  contiene el default y tiene más de 300 entradas (caso límite 1).
- Y queda propuesto AC9 para cuando exista el endpoint.

**AC4 `[ya]`** — «docs/sync-contract.md contiene la tabla de propiedad y CADA
campo de Store y StoreProduct aparece en ella con su dueno y que pasa si llega
un evento que lo toca.»

Son **31 columnas de `Store`** (las 30 de hoy más `timezone`) y **23 de
`StoreProduct`**: 54 filas. Las relaciones no cuentan porque no son columnas
—`business`, `storefront`, `slugEntry`, `products`, `promotions`, `orders`,
`adminAccess`, `searchQueries` en `Store`; `store`, `canonicalProduct`,
`localCategory`, `orderItems` en `StoreProduct`—, pero **las claves ajenas sí
son columnas y sí están** (`businessId`, `storefrontId`, `storeId`,
`canonicalProductId`, `localCategoryId`).

No se cuentan a ojo. Un test del proyecto `server` hace la comprobación en los
dos sentidos:

1. Saca los nombres de columna leyendo `prisma/schema.prisma` con una expresión
   regular sobre el cuerpo de `model Store` y de `model StoreProduct`,
   descartando comentarios, atributos de bloque y campos cuyo tipo es un modelo.
2. Saca los nombres documentados de `docs/sync-contract.md`, extrayendo todos los
   identificadores entre comillas invertidas de la primera columna de las dos
   tablas.
3. Afirma **igualdad de conjuntos** en los dos sentidos —falta ninguno, sobra
   ninguno—, que ningún nombre aparece dos veces (R3: exactamente un dueño) y que
   las tres columnas de la tabla están rellenas en las 54 filas.
4. Y una guarda contra el falso verde: el conjunto parseado del schema tiene que
   ser un **superconjunto** de las claves de `StoreScalarFieldEnum` y
   `StoreProductScalarFieldEnum` del cliente generado. Si la expresión regular se
   rompe y devuelve un conjunto vacío, esta afirmación lo caza. El superconjunto
   no es un detalle: `searchVector` es `Unsupported("tsvector")` y **no aparece**
   en `StoreProductScalarFieldEnum` (22 claves para 23 columnas), así que un
   check basado solo en el cliente generado dejaría escapar una columna en
   silencio.

Ejecutado: `npm test` en verde con ese archivo incluido, y a mano
`npx vitest run --project=server <archivo>` durante el desarrollo.

**AC5 `[ya]`** — «Un product.update del sync no altera ningun campo cuyo dueno
sea el panel.»

Ya está protegido y hay que **extenderlo a los seis campos de la tabla**, no a
los cinco de [ADR 0007]: `priceOverrideCurrency` también es del panel y la ADR no
la nombra. Se verifica con el test que ya existe
(`src/features/sync/server/handlers/product.test.ts:117-138`, con su
`PANEL_COLUMNS`): un producto con los seis campos con valor, un
`product.update` que además intenta traerlos en el payload, y después las seis
columnas intactas. Esperado: `npm test` en verde con `PANEL_COLUMNS` conteniendo
los seis nombres, comprobado contra la tabla del contrato por el mismo test del
AC4 —la lista del test y la del documento no pueden divergir sin que algo se
ponga rojo.

**AC6 `[ya]`** — «'grep -ri "umbral\|threshold" src/ prisma/schema.prisma' no
devuelve ningun campo almacenado.»

Hoy ya se cumple, y hay que **mantenerlo**, que es lo que este criterio protege
de verdad: que a nadie se le ocurra guardar aquí un umbral. El grep literal
devuelve hoy 6 aciertos y ninguno es una columna: un comentario del schema
(`prisma/schema.prisma:28`), un comentario en `src/lib/availability.ts:7`, un
umbral de número de categorías que no tiene nada que ver con el stock
(`src/app/[slug]/page.tsx:177`), dos comentarios y un nombre de test, y el
schema embebido como cadena dentro del cliente generado
(`src/generated/prisma/internal/prismaNamespace.ts` y el `inlineSchema` de
`src/generated/prisma/internal/class.ts`, que AGENTS.md excluye de lint por
generado). Para que la comprobación no dependa de mirar una lista con los ojos,
dos comandos:

- `grep -n "umbral\|threshold" prisma/schema.prisma` devuelve **solo** líneas que
  empiezan por `///` o `//`.
- Contra la base: `SELECT column_name FROM information_schema.columns WHERE
column_name ILIKE '%umbral%' OR column_name ILIKE '%threshold%'` devuelve
  **0 filas**.

Aviso para el implementador: no llames `*Threshold` a ninguna constante nueva de
este feature, o el grep del criterio empieza a dar aciertos que hay que
explicar.

**AC7 `[ya]`** — «'bash .agent/verify.sh F-022 --full' termina con codigo 0.»

Literal: `bash .agent/verify.sh F-022 --full`, código de salida `0`. Corre
`harness typecheck lint format test prisma build theme bundle`. Tres avisos que
en este feature son casi seguros:

- **`format`**: `npm run format` sobre lo que tú hayas escrito, incluidos los
  `.md` del arnés, antes de dar la etapa por buena. Es la ficha con más
  reincidencias del repo.
- **`harness`**: los archivos que este feature va a crear —el evaluador, sus
  tests, el `migration.sql`— se citan **sin comillas invertidas** y con
  «(por crear)» detrás hasta que existan.
- **`prisma`**: `npx prisma validate` no basta para ver el `DROP INDEX` de los
  cinco índices no declarados. Eso se revisa leyendo el `migration.sql` generado.

**AC8 `[nuevo]`** — Propuesto al humano: las 12 columnas de `Storefront` también
tienen fila en la tabla de propiedad. Verificable con el mismo test del AC4,
extendido a un tercer modelo. Motivo: el schema ya declara el bloque
(`prisma/schema.prisma:186`), F-011 tocó esas columnas y el criterio 4 solo
nombra dos modelos, así que hoy quedarían fuera por escrito.

**AC9 `[nuevo]`** — Propuesto al humano, para el feature que construya el
editor (F-011): `PUT /api/admin/stores/{storeId}/settings` con
`{"timezone":"America/Habana"}` responde 400 `INVALID_BODY` y la columna no
cambia. Es la forma que el criterio 3 tendría si existiera el camino de guardado
(I3), y reutiliza el validador de este feature en vez de escribir otro.

## Incongruencias detectadas

- **I1 — El criterio 1 no es alcanzable por el camino normal.** «Publicar una
  tienda sin timezone falla», con la columna `NOT NULL DEFAULT 'America/Havana'`
  que decidió el humano, describe un estado que ni el panel ni el sync pueden
  producir. Está aceptado a propósito y se verifica forzando la fila por SQL
  (AC1). No se reescribe el criterio (regla 3), pero conviene saber que **lo que
  ese test prueba es la puerta de publicación, no la ausencia de la zona**.
- **I2 — El criterio 6 ya estaba cumplido antes de empezar.** No existe ninguna
  columna de umbral: `grep` solo encuentra comentarios
  (`prisma/schema.prisma:28`, `src/lib/availability.ts:7`) y un umbral de número
  de categorías ajeno al stock (`src/app/[slug]/page.tsx:177`). Es un criterio de
  no-regresión, no de construcción; verificarlo cuesta dos comandos y no hay que
  construir nada para él.
- **I3 — El criterio 3 dice «al guardar» y en este alcance no hay nada que
  guarde.** El editor del panel es F-011 y queda fuera, así que la única
  escritura de `timezone` en todo el feature es el default de la migración. El
  criterio se verifica sobre el validador compartido (AC3) y se propone AC9 para
  cuando el endpoint exista. Si el humano quiere el criterio 3 verificado por
  HTTP en **este** ciclo, hay que meter en alcance una mutación mínima que
  escriba la zona, y eso es un cambio de alcance que no puedo decidir yo.
- **I4 — La propuesta que originó el feature está desactualizada en cuatro
  puntos, y `features.json` la cita como su alcance.** `.agent/specs/propuestas/horarios-y-propiedad-de-campos.md`
  recomienda dos calendarios (`SP2`), pone «toda la lógica de horarios y
  vencimientos» dentro del alcance, dice que el formato de `openingHours` lo
  cierra sdd-architect, y su E2 habla de la fecha de entrega de un pedido de las
  02:00. Las cuatro cosas están decididas al revés por el humano (un solo
  calendario; solo abierto/cerrado; el formato lo fija esta spec; el vencimiento
  fuera). La propuesta no se edita —es el origen histórico—, pero **manda esta
  spec**, y las `notes` de `features.json` heredan las dos preguntas ya
  resueltas.
- **I5 — «Abierta» y «Cerrada ahora» ya están usadas para otra cosa. DISUELTA
  por la decisión del humano en SP5.**
  `src/components/store/BranchCard.tsx:20-25` pinta «Abierta» / «Cerrada ahora» a
  partir de `status`, y `src/features/admin/components/StoreList.tsx:91-96` pinta
  «Abierta» / «Cerrada» / «Suspendida» / «Borrador» igual. Mientras la página
  fuera a afirmar «abierta ahora», dos cosas distintas —el interruptor y el
  reloj— habrían dicho lo mismo con la misma etiqueta, y de ahí nació R11.

  **Con el horario de la semana no hay dos afirmaciones que puedan competir**: el
  interruptor dice si la tienda está abierta, el horario dice a qué hora abre
  cada día. Una es un estado y la otra es una tabla de datos. La incongruencia no
  se borra porque explica por qué R11 sigue escrita y por qué su `grep` merece la
  pena: la regla se cumple hoy casi por accidente, y lo que se cumple por
  accidente se rompe en la primera edición.

- **I6 — `openingHours` es del sync y su editor está planificado en el panel.**
  [ADR 0017] (a) dice que **el panel nunca comparte columna con el sync**, y
  `.agent/specs/F-011/spec.md:407` ya declara `openingHours` como «sync (si
  viene)» y fuera de alcance. Si algún día el negocio edita sus horarios desde el
  panel, no puede ser sobre esta columna: hará falta una columna de override con
  su precedencia, como `priceOverride`. F-022 no lo resuelve —no le hace falta,
  porque no escribe nada— pero quien construya F-011 se lo va a encontrar. Va a
  § No decidido a propósito.
- **I7 — La descripción del feature dice «tabla exhaustiva de propiedad de campos
  en el contrato» y el trabajo real de horarios pesa más.** No es contradicción,
  pero explica por qué este feature tiene interfaz: el humano decidió que F-022
  también pinte el horario en la tienda, y eso no se deduce de `features.json` ni
  de la propuesta. Queda escrito aquí para que nadie lo lea como sobrealcance.
  Ninguno de los siete criterios menciona la página: el horario en pantalla es
  alcance decidido por el humano, no un criterio que verificar.
- **I8 — Un estado en vivo calculado en el servidor no cabe en una página ISR.**
  `src/app/[slug]/layout.tsx:19` fija `export const revalidate = 3600` y
  `src/features/catalog/server/queries.ts:169` sirve la tienda desde un `cached()`
  con tags. Un cartel de estado metido en ese HTML se congela con la página: la
  tienda seguiría diciendo «abierto» una hora después de cerrar. No es una
  contradicción con AGENTS.md —que prohíbe tocar `/[slug]` con el `matcher` del
  proxy, no tener un hueco dinámico—, pero sí es un choque real entre el criterio
  2 y la estrategia de caché. Era SP5, y está resuelta, **pero al revés de como
  esta spec lo escribió primero**: no hay hueco dinámico que sacar el cálculo de
  la caché, porque en Next 16.3.2 con la configuración de este repo ese hueco no
  existe —cuatro builds reales en `.agent/specs/F-022/architecture.md`, § «El
  cartel en la página»— y volver dinámica la portada habría puesto roja la etapa
  `bundle` (`scripts/check-bundle-budget.mjs:81-89`). Lo que se soltó fue la
  afirmación instantánea: la página no dice el ahora y por eso puede cachearse
  (R14). La incongruencia se queda escrita porque es la razón de que R14 exista y
  de que el criterio 2 se verifique contra el evaluador y no contra la página.

## Huecos y preguntas al humano

**Ninguna pregunta queda abierta.** `SP1` y `SP2` de la propuesta ya estaban
resueltas (la zona es del panel; un solo calendario) y sus números no se
reutilizan; `SP3`, `SP4` y `SP5` las contestó el humano el 2026-09-02, las tres
por la recomendación. Se quedan escritas con su decisión y su motivo, porque el
porqué de una decisión se olvida antes que la decisión.

- **SP3 — ¿Qué hace el sync con un `openingHours` que no cumple el formato?**
  **Decidido: (a), rechazar el evento.** Escrito en E10, en el caso límite 11, en
  R9, en el punto 3 de § Alcance y en los puntos 1-2 de lo que debe decir la v9.
  La consecuencia va escrita con todas las letras y aceptada: **ese evento no
  aplica tampoco el resto de sus campos**, y hay que avisar a cuadrecaja antes de
  publicar la mayor. El lector sigue siendo tolerante (E12). Qué faltaba: la
  política de rechazo. Por qué bloqueaba: decide si el schema de Zod
  rechaza el evento entero o si el handler ignora el campo, decide el código de
  error del contrato, y decide qué le pedimos al equipo de cuadrecaja antes de
  publicar la mayor. Opciones: **(a)** rechazar el evento con
  `STORE_OPENING_HOURS_INVALID`, como ya se rechaza la tríada de envío
  inconsistente (`src/features/sync/schemas.ts:73-76`) —el **sitio** de esa
  comprobación se corrigió después: va en el handler, no en el schema, ver
  E10—; **(b)** aceptar el evento,
  dejar la columna intacta y registrar un `console.warn("[sync] ...")`, para que
  un calendario mal formado no impida corregir un teléfono; **(c)** rechazar,
  pero solo desde una fecha acordada, tolerando antes. Motivo de la elegida: es
  coherente con el precedente del repo —la tríada de envío inconsistente se
  rechaza igual— y hace visible el error en vez de dejar un calendario que nadie
  va a arreglar. El riesgo conocido, y aceptado, es el de (b): un calendario mal
  formado bloquea también la corrección de un teléfono que viajaba en el mismo
  evento.
- **SP4 — ¿«Cerrado ahora» bloquea comprar, o solo informa?** **Decidido: (a),
  solo informa.** Escrito en § Alcance, Fuera («Que el horario bloquee comprar»)
  y en E9. El `409 STORE_CLOSED` conserva su significado actual: el interruptor
  apagado. Bloquear la compra por horario sería un feature del humano (regla 4).
  Qué faltaba: el efecto del horario sobre el checkout. Por qué bloqueaba: cambia el diseño de la
  página, el estado del carrito y, si bloquea, toca el contrato —hoy el `409
STORE_CLOSED` significa «el interruptor está apagado», no «son las 3:00»— y las
  pantallas de F-010/F-031. Opciones: **(a)** informativo: el catálogo se navega,
  el carrito funciona y el pedido entra igual; **(b)** bloquea el checkout con el
  mismo 409 que el interruptor; **(c)** informativo ahora y bloqueo como feature
  aparte. Motivo de la elegida: vender de madrugada para entregar al otro día es
  un caso de negocio normal, y bloquearlo sin que nadie lo haya pedido sería una
  pérdida de pedidos que ningún criterio de este feature reclama.
- **SP5 — ¿De dónde sale el instante del cartel de horario?** **Decidido: (b),
  HTML cacheado y la línea dice el horario.** Palabras del humano: «HTML
  cacheado, y la línea dice el horario», más la decisión que va con ella: **se
  pinta el horario de la semana, no el de hoy**, porque «qué día es hoy» también
  depende del instante. Escrito en R14, en R10, en § Datos y contrato («El
  horario en la página»), en el punto 5 de § Alcance, en E9 y E13, y en el caso
  límite 12.

  **Esta respuesta corrige la que esta spec dio primero**, que era la (a), y el
  porqué importa más que la letra: sdd-architect midió con cuatro builds reales
  de Next 16.3.2 que el hueco dinámico **no existe** aquí —`await connection()`
  dentro de `<Suspense>` con `revalidate = 3600` vuelve dinámica la ruta entera y
  le quita la revalidación, y `cacheComponents: true` falla el build por
  incompatibilidad con los 9 `export const revalidate` y los 45
  `export const dynamic` de `src/app/`, además de contradecir [ADR 0006]—, y
  después apareció el remate: `scripts/check-bundle-budget.mjs:81-89` exige una
  portada de tienda prerenderizada y sale con 1 si no la hay, así que volver
  dinámica `/[slug]` habría puesto roja la etapa `bundle` y con ella el
  criterio 7. Las opciones eran: **(a)** el hueco dinámico dentro de
  `<Suspense>` —inexistente en este Next—; **(b)** el horario en el HTML
  cacheado, sin afirmar el ahora, **la elegida**; **(c)** bajar el `revalidate`,
  media solución porque con ISR el primer visitante tras el vencimiento recibe
  el HTML rancio; **(d)** migrar la app a `cacheComponents: true`, que da las
  tres cosas y es un feature propio con su ADR.

  Motivo de la elegida: la vitrina sigue saliendo del CDN, el navegador no
  recibe nada nuevo, y el negocio publica un horario que el comprador puede leer
  —una pregunta que hasta hoy el producto no contestaba en ninguna parte—. Lo
  que se paga está escrito sin maquillar en E13 y en R14: **el producto no sabe
  decir «abierto ahora» en la vitrina**, y `evaluateStoreHours` se queda un
  ciclo sin llamador de producción.

## No decidido a propósito

- **Cuándo el producto sabrá decir «abierto ahora» en la vitrina.** Hoy no
  puede: haría falta migrar la app a `cacheComponents: true` (la opción (d) de
  SP5), lo que toca ~55 archivos y necesita una ADR que supere a [ADR 0006]. Es
  un feature propio del humano, no una tarea pendiente de este. Mientras tanto,
  el evaluador ya está construido y probado, que es la mitad cara.
- **La redacción, el sitio y el orden visual del horario** son de sdd-designer,
  con R10 y R11 como límites: hora de pared de la tienda, 12 horas con
  `a.m.`/`p.m.`, sin palabras relativas al ahora, y sin las palabras del
  interruptor.
- **Si el horario aparece también en `BranchCard` y en el selector de marca.**
  Fuera de este feature. Ganas: el comprador compara sucursales antes de entrar.
  Coste: `src/features/storefront/server/resolve.ts` tendría que traer
  `openingHours` de cada sucursal —cero queries nuevas, la query ya existe— y
  siete filas más de HTML por sucursal. Lo decide sdd-designer con
  sdd-architect.
- **La columna de override de horarios que F-011 va a necesitar** (I6). No hace
  falta para este feature y decidirla aquí sería adivinar el diseño del editor.
  Quien construya el editor tiene que resolver [ADR 0017] (a) antes de escribir
  la primera línea.
- **La zona horaria de una marca con sucursales en husos distintos.** R7 dice que
  el calendario es de la sucursal, así que hoy no hay conflicto que resolver.
  Cuando exista el selector de marca con horarios (punto anterior), volverá.
- **Si `Store.timezone` debería viajar algún día al POS.** Hoy no: es dato de
  vitrina y el POS no lo necesita. Reabrir si cuadrecaja pide mostrar la hora
  local de la tienda en su propia interfaz.
