# 0028 — La configuración de compra de una tienda la escribe cuadrecaja, y omitir no es apagar

**Propuesta** · 1 de septiembre de 2026 · F-032 — pasa a **Aceptada** cuando
F-032 esté construido, verificado y fusionado, como hizo
[ADR 0017](0017-frontera-de-escritura-del-panel.md) con su propia versión.

Completa a [ADR 0017](0017-frontera-de-escritura-del-panel.md) (a), que dice
**quién puede escribir cada columna**, y a
[ADR 0027](0027-ausencia-de-importe-en-la-base-cero-mas-bandera-en-el-cable.md),
que dice **cómo se representa** un importe que todavía no existe. Esta dice
**quién es el dueño de las cinco columnas que deciden cómo se compra en una
tienda** —lo que ADR 0027 dejó explícitamente sin decidir en su § «Lo que esta
ADR no decide»— y **qué significa que un evento no las traiga**.

## Contexto

Cinco columnas de `Store` deciden cómo se compra: `checkoutMode`,
`deliveryEnabled`, `deliveryFee`, `deliveryFeeMode` y `orderExpiryHours`
(`prisma/schema.prisma`, bloque de `Store`). Hoy **no las escribe nadie salvo el
seed**: no viajan en el `payload` de `STORE` (`src/features/sync/schemas.ts` no
las declara) y el panel no las expone. Activar el envío cotizado que construyó
F-031 exige un `UPDATE` a mano contra Postgres, escrito paso a paso en
`docs/despliegue.md`. Un negocio no puede configurar su propia tienda sin que
alguien con acceso a la base lo haga por él.

Las cinco son configuración **del negocio**, y el negocio ya configura su tienda
en cuadrecaja. Que una parte viva solo aquí es un estado de tránsito.

Traerlas por el sync choca con dos cosas escritas antes:

1. **`Store.orderExpiryHours` está declarada de queandabuscando.** F-019 (R5 y
   R20), el comentario `///` del schema y `docs/sync-contract.md` (§ v4 y § ③④)
   dicen, con esas palabras, que «el POS no lo envía y un evento `STORE` no lo
   pisa». Eso deja de ser cierto.
2. **El POS de hoy no conoce ninguna de las cinco.** Cuadrecaja tiene que
   añadirlas a su `Tienda`, exponerlas y emitirlas; mientras tanto sigue
   mandando el `STORE` de siempre. Si «campo ausente» significara «vuelve al
   default», el primer evento rutinario —alguien corrige un teléfono en el
   POS— apagaría el domicilio de todas las tiendas configuradas a mano, sin
   error, sin rastro y sin que nadie lo hubiera pedido.

## Decisión

**(a) Las cinco columnas pasan a ser del sync.** Su dueño es cuadrecaja: es el
único escritor en producción, y la guarda anti-rancio que ya existe
(`Store.sourceUpdatedAt`, AP6 de ADR 0017 (c)) es el **único** árbitro cuando
llegan dos versiones. No se añade ninguna marca de «configurada a mano» ni forma
de liberarla: el primer envío del POS que traiga un campo pisa lo que hubiera,
por viejo que sea el `UPDATE` que lo puso. Es la decisión SP3 del humano y es lo
que hace que la propiedad sea propiedad y no una preferencia.

**(b) `Store.orderExpiryHours` cambia de dueño.** Las líneas de F-019 R5/R20,
del comentario del schema y del contrato que la declaraban de queandabuscando
**dejan de ser ciertas** y se corrigen en el mismo ciclo. Lo que ese número
_significa_ no cambia —cuánto dura una propuesta y cuánto vive un pedido sin
cotizar (v6 del contrato)— y el bucle de renegociación de F-019 no se toca:
`src/features/orders/server/expiry.ts` y `src/features/orders/server/proposal.ts`
siguen leyendo la columna igual. Cambia quién la escribe, nada más.

**(c) Esto CUMPLE ADR 0017 (a), no la contradice.** La regla de 0017 (a) es «el
panel nunca comparte columna con el sync». Las cinco pasan a ser del sync y el
panel **sigue sin tocarlas**: no hay editor, no lo habrá en este feature (SP3 de
F-031, mantenida), y la lista negra de
`src/features/admin/server/boundaries.test.ts` gana las cinco para que dejar de
cumplirlo sea un test rojo y no una revisión atenta. Lo que 0017
prohíbe es el estado compartido sin árbitro; aquí no hay estado compartido: hay
un dueño, y ese dueño no es el panel.

**(d) Omitir no es apagar.** Los cinco campos viajan **opcionales** y **planos**
en el `payload` de `STORE`, y un evento que no trae un campo deja esa columna
exactamente como estaba. `null` explícito solo tiene significado en
`deliveryFee` (vaciar el importe al pasar a `QUOTED_PER_ORDER`); en las otras
cuatro es un error de tipo.

Esta es la forma general de **transferir la propiedad de una columna a un
sistema que todavía no sabe que la tiene**: el campo se declara del POS, se
declara opcional, y la ausencia se lee como silencio, no como negación. Sin
ella, la transferencia solo sería segura si los dos lados desplegaran a la vez,
que es justo lo que ADR 0001 y ADR 0002 evitan.

**(e) El invariante se protege al escribir, en dos mitades.** Una fila escrita
por el sync nunca queda con `deliveryEnabled = true` **y**
`deliveryFeeMode = FLAT_RATE` **y** `deliveryFee IS NULL` — una tienda que dice
ofrecer domicilio sin nada con qué cobrarlo, que es exactamente el caso en que
`isDeliveryOffered` (`src/features/orders/deliveryOffer.ts`) devuelve `false`
con el domicilio encendido. Lo que el payload determina solo es `400` sobre el
lote entero; lo que solo se ve mezclando el payload con la fila guardada es un
`failed` dentro del `207`, sin escribir nada y sin avanzar `sourceUpdatedAt`.
Los dos códigos de respuesta salen de dónde puede mirarse la base, no de una
preferencia estética: un `refine` de Zod corre antes que la base y no puede
verla.

## Consecuencias

- **El `UPDATE` a mano de `docs/despliegue.md` § 9.5 desaparece como
  procedimiento**: dar de alta una tienda con envío cotizado deja de necesitar
  acceso a Postgres. Mientras cuadrecaja no emita los campos, la configuración
  se sigue poniendo a mano —pero como excepción documentada, no como el camino.
- **Ninguna tienda existente cambia de comportamiento el día del despliegue.**
  No hay migración: las columnas y el enum ya existen (F-031), y el único cambio
  en `prisma/schema.prisma` es el comentario `///` de `orderExpiryHours`. Nada
  se repara hacia atrás: una fila que hoy viole el invariante de (e) se queda
  como está hasta que un evento la toque.
- **Un payload contradictorio se reintenta para siempre.** Un `failed` no es un
  duplicado (`src/features/sync/server/inbox.ts`), así que el POS lo reenvía; el
  error es de configuración, no transitorio, y solo se arregla en el POS. Y un
  valor mal formado tumba el **lote entero** con `400`, con lo que el outbox del
  negocio se para hasta que alguien lo corrija (decisión SP1 del humano). Las
  dos cosas van escritas en el contrato, con ejemplo, para que el otro equipo lo
  sepa antes de implementarlas y no al depurar.
- **El panel queda cerrado para estas cinco columnas por decisión, no por
  olvido.** Construir un editor exige otra ADR que supere a esta y a 0017 (a):
  ahí sí habría dos escritores sobre la misma columna y haría falta un árbitro
  como el de 0017 (c).
- **El vocabulario del cable queda atado a los enums de Prisma**
  (`src/generated/prisma/enums.ts`). Un modo de envío o de checkout nuevo es una
  versión nueva del contrato, no un literal más en una lista.
- **`orderExpiryHours` llega con techo.** El contrato acota el entero a
  `1..8760` porque `src/features/orders/server/expiry.ts` y
  `src/features/orders/server/proposal.ts` hacen
  `now() ± make_interval(hours => …)`: un valor cercano a `INT_MAX` saca el
  timestamp de rango y rompe el barrido de vencimientos **entero**, no solo el
  de esa tienda.

## Alternativas descartadas

- **Una pantalla en el panel.** Es la vía corta y la descartó el humano en la
  SP3 de F-031: pondría al panel a compartir columna con el sync justo cuando el
  POS empieza a emitirla, que es lo que ADR 0017 (a) existe para impedir.
- **Marca de «configurada localmente» que el POS no pueda pisar.** Descartada
  con SP3: dos dueños con un desempate implícito. `sourceUpdatedAt` ya es el
  desempate, y es visible.
- **Que la ausencia signifique «vuelve al default».** Es la semántica que rompe
  todas las tiendas al primer evento rutinario del POS de hoy. Es el motivo
  entero del feature.
- **Un centinela para «vacía este importe»** (`-1`, `""`). `null` explícito ya
  distingue «no lo toques» de «bórralo», y ADR 0027 ya decidió que en la base la
  ausencia se modela como ausencia.
- **Un objeto anidado `purchaseConfig: { … }` en el payload.** Más ordenado de
  leer y peor de versionar: obliga al POS a distinguir «objeto ausente» de
  «objeto presente con claves ausentes», que son dos silencios donde hace falta
  uno. Los cinco campos viajan planos, como `name` o `phone`.
- **Rechazar el evento contradictorio siempre con `400`.** Imposible sin que el
  schema lea la base: las dos formas realistas del error —«enciendo el domicilio
  y olvido la tarifa», «paso a tarifa fija sin importe»— dependen de lo que ya
  hay guardado.
- **Aplicar el evento contradictorio degradado** (`deliveryEnabled = false` en
  silencio). Deja al negocio creyendo que activó el domicilio. Si el humano lo
  prefiere, es un cambio de una línea en el handler y se anota aquí.

## Lo que esta ADR no decide

- **La tabla exhaustiva de propiedad de cada campo de `Store` y
  `StoreProduct`.** Es el criterio 4 de F-022. Aquí nacen la sección y las cinco
  filas de estas columnas; el resto lo completa ese feature.
- **`Store.timezone`, y el umbral de stock bajo**, que sigue en cuadrecaja por
  [ADR 0003](0003-disponibilidad-por-query-convergente.md).
- **Los nombres en español de las cinco columnas dentro de cuadrecaja.** El
  contrato propone `modoCheckout`, `envioHabilitado`, `costoEnvio`, `modoEnvio`
  y `horasVencimientoPedido`, pero el schema del POS es suyo: lo que ata el
  contrato son los nombres del cable.

## Reabrir cuando

- **El negocio pida editar estas columnas desde el panel.** Entonces hay dos
  escritores y hace falta el árbitro de ADR 0017 (c), no una lista blanca más.
- **Aparezca un tercer modo de checkout o de envío.** Es una versión mayor del
  contrato, coordinada con el otro equipo, porque el vocabulario sale del enum.
- **Se quiera reparar hacia atrás** las filas que ya violan el invariante de
  (e): esta ADR decide explícitamente no tocarlas.
