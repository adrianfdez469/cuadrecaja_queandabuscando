# 0034 — Lo que valida el sobre y lo que valida el aplicador

**Aceptada** · 9 de septiembre de 2026 · F-043 — construida, verificada y
fusionada en el mismo ciclo que la propone.

**Estrecha la tercera consecuencia de
[ADR 0028](0028-configuracion-de-compra-del-pos.md)**, así que no puede ser una
nota dentro de ella (AGENTS.md § Documentación: «contradecir una decisión
publicada exige una ADR nueva que la supere»). Es el mismo movimiento, letra
por letra, que hizo [ADR 0033](0033-cobrar-el-domicilio-y-ofrecerlo-son-dos-preguntas.md)
con el invariante (e) de la misma 0028: estrechar una decisión publicada para
UN campo, dejando el resto de la familia donde estaba.

## Contexto

Tres precedentes ya decidieron esto mismo, de uno en uno y sin que ninguna
regla lo dijera por escrito:

- **`barcodes`, v4** (`src/features/sync/schemas.ts:109-111`). El schema exige
  `z.array(z.string())` — la LISTA es obligatoria y de cadenas — pero nunca
  valida el formato de un código de barras individual. Un miembro con la forma
  que sea se acepta en el sobre; es el aplicador quien decide qué hacer con él.
- **`openingHours`, v9** (`src/features/sync/server/handlers/store.ts:199-205`).
  `storePayloadSchema.openingHours` es `z.unknown().nullish()`: el schema del
  lote no opina en absoluto sobre la forma del calendario. `assertOpeningHoursValid`
  vive en el handler, y un calendario mal formado falla **ese evento**
  (`STORE_OPENING_HOURS_INVALID`, `207 failed[]`), nunca el lote con `400`.
- **`displayCurrencies`, v12** (`src/features/sync/schemas.ts:146-151`, «LAX on
  purpose»). El schema exige `z.array(z.string())` y nada más; cada miembro se
  valida en el aplicador, con `BUSINESS_DISPLAY_CURRENCIES_INVALID` fallando
  solo ese evento.

Los tres precedentes fallan **ese evento**, nunca el lote — y ninguno de los
tres tiene una línea que diga POR QUÉ esa es la frontera correcta, así que cada
feature nuevo tenía que redescubrirla o, peor, no redescubrirla.

La ADR 0028 § Consecuencias dice lo contrario para una familia de la que
`zoneCode` entró a formar parte por R29 de F-041: «un valor mal formado tumba
el **lote entero** con `400`, con lo que el outbox del negocio se para hasta
que alguien lo corrija (decisión SP1 del humano)». Esa premisa está **medida
como falsa**, no solo mal redactada: lo que hace de verdad `planOutboxAck` de
cuadrecaja (`src/lib/qab/outboxAck.ts` en su repositorio) es sumarle un
intento a **todas** las filas del lote, no a la culpable, y con
`QAB_OUTBOX_MAX_ATTEMPTS = 6` una sola divergencia agota los seis intentos de
cada fila que viajara con ella — que después el drenaje **no vuelve a
reclamar nunca**. Eso no es «se para»: es pérdida silenciosa. Quien mañana
añada una sexta columna a la familia de 0028 leería SP1 y aplicaría un `400`
creyendo que el peor caso es una parada corregible; ese es el daño que una ADR
evita y una línea del plan de F-043 no habría evitado.

## Decisión

**El sobre valida la FORMA — tipo JSON, claves obligatorias, discriminantes,
pertenencia a un enum generado. El aplicador valida el VALOR cuando ese valor
pertenece a un vocabulario que los dos lados convergen por separado — un
catálogo, una lista de monedas, un calendario — y entonces el fallo es de ESE
evento, en `207 failed[]`, y es reintentable.**

La pregunta que separa las dos capas: ¿pueden los dos lados divergir sobre
este vocabulario sin que ninguno de los dos esté "mal", solo desactualizado?
Si sí —un catálogo de zonas que se regenera, una lista de monedas que un
negocio amplía, un calendario que cambia con el negocio— la respuesta es del
aplicador y el fallo es reintentable: el mismo evento, sin cambiar un byte,
puede terminar aplicándose cuando el vocabulario converja. Si no —un `rule`
fuera del enum, un tipo cambiado, una clave obligatoria ausente— es un defecto
del emisor que ningún reintento sin cambios arregla, y el sobre lo corta antes
de escribir nada.

## Consecuencias

- **Estrecha la tercera consecuencia de la ADR 0028 para `zoneCode`.**
  `zoneCode` entró en la familia de las cinco columnas de compra por R29 de
  F-041 (misma semántica de omisión), pero un valor mal formado o desconocido
  ya no tumba el lote: falla solo su evento, con `ZONE_TARIFF_ZONE_UNKNOWN` o
  `STORE_ZONE_UNKNOWN` en `207 failed[]`, reintentable.
- **Las CINCO columnas originales de la ADR 0028 (`checkoutMode`,
  `deliveryEnabled`, `deliveryFee`, `deliveryFeeMode`, `orderExpiryHours`)
  SIGUEN en `400` de lote, y no por inercia.** Su error es de **tipo**: un
  `checkoutMode` fuera del enum, un `deliveryFee` con más de dos decimales, un
  `orderExpiryHours` fuera de rango son defectos que el POS corrige sin que
  ningún catálogo compartido tenga que converger — no hay una segunda copia de
  ese vocabulario con la que estar temporalmente en desacuerdo. Es el mismo
  criterio del `barcode` singular (v4) y de un `rule` fuera de las tres
  opciones de `ZONE_TARIFF`: siguen siendo `400`, y con el mismo argumento.
- **Corrige la premisa de SP1 con los dos números.** Un `400` no «para el
  outbox hasta que alguien lo corrija»: `planOutboxAck` le suma un intento a
  las **todas** las filas del lote y, con `QAB_OUTBOX_MAX_ATTEMPTS = 6`, las
  abandona para siempre a partir del sexto intento fallido. Cualquier lectura
  futura de la ADR 0028 tiene que partir de este número, no del anterior.
- **El sensor del criterio, para el catálogo de zonas, es la lista blanca de
  `src/features/zones/boundaries.test.ts`** (F-043, architecture.md § AD1): si
  `src/features/sync/schemas.ts` vuelve a aparecer en `ALLOWED`, esa prueba se
  pone roja porque alguien devolvió una comprobación de VALOR al sobre.
- **`docs/sync-contract.md` sube a v13.2** documentando el cambio para
  `zoneCode` en los sitios que hablaban del `400` de lote por este campo — ver
  § «Cambios respecto a la v12.2» de ese documento.

## Alternativas descartadas

- **Enmendar la ADR 0028 in situ.** Descartado por la misma regla que ya citó
  la 0033 al abrirse: contradecir una decisión publicada exige una ADR que la
  supere, no una edición silenciosa de la que publicó SP1.
- **Una línea en `plan.md` de F-043, sin ADR.** Cubre el cambio de código pero
  no corrige la premisa medida como falsa de SP1, que sigue publicada y
  seguirá guiando decisiones futuras sobre el resto de la familia si nadie la
  corrige por escrito.
- **Extender el criterio nuevo a las cinco columnas originales ahora mismo.**
  Descartado: duplicaría el alcance de un feature (F-043) que cuadrecaja
  espera antes de publicar la v13, y ninguna de las cinco tiene hoy un
  catálogo compartido con el que converger — el criterio de esta ADR ya dice
  por qué se quedan donde están.

## Lo que esta ADR no decide

- **Si alguna de las cinco columnas originales ganará algún día un catálogo
  compartido propio** (por ejemplo, un `checkoutMode` que dependiera de una
  lista configurable). Si eso ocurriera, esa columna se estrecharía con su
  propia ADR, con el mismo criterio que esta fija.
- **Publicar la v13 del contrato.** Sigue en borrador; esta ADR y F-043 lo
  dejan en v13.2.

## Reabrir cuando

Una sexta entidad de entrada con un campo cuyo valor dependa de un vocabulario
que los dos lados mantienen por separado necesite la misma pregunta: si la
respuesta que da el criterio de esta ADR no basta para decidir dónde va la
comprobación, esta ADR se estrecha otra vez, con el mismo patrón que aplicó a
la 0028.
