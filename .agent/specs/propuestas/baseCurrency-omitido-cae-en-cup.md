---
slug: baseCurrency-omitido-cae-en-cup
agente: orquestador
actualizado: 2026-09-10T04:05:00Z
estado: propuesta
---

> **Salió de F-045, no de una idea suelta.** Al medir la incongruencia I4 —un
> `STORE` que no se aplica escribe igual el nombre y la moneda base del
> negocio— apareció un segundo camino por el que la moneda base se corrompe, y
> es independiente del primero: no importa si el evento se aplica o no.
> Se sacó de F-045 a propósito el **2026-09-10**, con el choque puesto delante
> del humano: quitar ese `.default` cambia **lo que el POS puede omitir**, o
> sea una versión **mayor** del contrato, y meterlo en F-045 habría bloqueado
> la publicación de la v13 detrás de una negociación con cuadrecaja. Sus
> palabras al elegir: «F-045 solo I4; el `.default` va como F-046».
> El análisis de I4, con las cuatro mediciones, está en
> [`store-escribe-el-negocio-antes-de-las-guardas.md`](store-escribe-el-negocio-antes-de-las-guardas.md).

## Problema

`src/features/sync/schemas.ts:42`:

```ts
baseCurrency: z.string().length(3).default("CUP"),
```

Un evento `STORE` que **omite** `baseCurrency` no deja la moneda base como
estaba: la pone en `CUP`. Omitir no significa «no toques esto», significa «pon
`CUP`». Un negocio en `USD` vuelve a `CUP` por un evento que nunca habló de
monedas.

Esto **no** es I4 y no lo arregla F-045. I4 es _cuándo_ se escribe —eventos que
fallan o se descartan escribiendo igual—; esto es _qué_ se escribe cuando el
campo no viene. Un `STORE` perfectamente válido, aplicado como `processed`, con
todas las guardas pasadas, resetea la moneda si el POS no manda el campo.

## Lo que ya está medido

De la medición **M2** de la propuesta de I4, ejecutada contra el Postgres real
por la ruta HTTP: un evento rechazado con `STORE_OPENING_HOURS_INVALID` que
omitía `baseCurrency` dejó el negocio en `CUP` viniendo de `USD`.

```
M2 antes:    {"name":"…","baseCurrencyCode":"USD"}
M2 despues:  {"name":"Nombre de un evento rechazado","baseCurrencyCode":"CUP"}
```

**El `CUP` no venía del payload: venía del `.default`.** Ese caso concreto lo
tapa F-045 —el evento fallaba, así que después de F-045 no escribirá nada—,
pero el camino de debajo sigue abierto: **el mismo payload, sin el
`openingHours` malo, se aplica y pone `CUP` igual.** Eso es lo que queda por
medir y lo primero que tiene que hacer quien tome esto.

## Por qué importa, y por qué puede no importar

**Importa** porque `Business.baseCurrencyCode` (`prisma/schema.prisma:160`) no
es cosmético, a diferencia de `Business.name`:

- es la moneda con la que `resolveStoreForOrder` cotiza un pedido
  (`src/features/orders/server/quote.ts:142`, vía `store.business.baseCurrencyCode`);
- es la frase «Cobramos en X» de la portada de cada tienda
  (`src/app/[slug]/layout.tsx:156`);
- es la moneda de visualización del catálogo, de la ficha de producto y de las
  promociones del panel.

**Puede no importar tanto** por dos razones que hay que comprobar antes de
priorizarlo, no después:

1. En la práctica casi todos los negocios de este proyecto **son** `CUP`, así
   que el defecto puede no tener ninguna víctima real hoy. Cuántos negocios hay
   con `baseCurrencyCode != 'CUP'` se resuelve con una consulta.
2. Hay que comprobar si el POS de cuadrecaja **omite** ese campo alguna vez o
   si lo manda siempre. Si lo manda siempre, esto es un defecto latente, no uno
   activo.

## El nudo: el contrato promete el `.default`

`docs/sync-contract.md:2146` dice, literalmente, `"baseCurrency": "CUP", // por
defecto CUP si se omite`. **La promesa está publicada y cuadrecaja la leyó**:
no es un descuido nuestro que podamos retirar sin avisar.

Por eso esto es una versión **mayor** del contrato —cambia una regla de
validación de lo que el POS envía— y hay que acordarla con ellos **antes** de
tocar nada. Es exactamente el motivo por el que se sacó de F-045.

## Opciones, sin recomendar todavía

Falta el dato de si el POS omite el campo, y sin él una recomendación sería una
corazonada con formato de tabla.

**(a) `baseCurrency` pasa a `.nullish()` y se une a la familia «omitir no es
apagar».** Omitir deja la columna como estaba; mandarla la cambia. Es la
semántica que la ADR 0028 ya declara para el resto de la familia y la que
`zoneCode` ganó en F-041 (R29), así que el sistema ya tiene la doctrina escrita
y el precedente. Coste: mayor del contrato; y un negocio recién creado por el
script de acuñación necesita una moneda inicial, que hoy se la da el
`@default("CUP")` de la columna y seguiría dándosela.

**(b) `baseCurrency` pasa a obligatorio.** El POS siempre la manda o el evento
es `400`. Más estricto y más explícito, sin ambigüedad de omisión. Coste: mayor
del contrato **y rompedor** —un POS que hoy la omite deja de funcionar—, así
que exige el aviso escalonado que el contrato ya usa para las entidades nuevas.

**(c) Dejarlo y documentarlo mejor.** Defendible **si** se comprueba que el POS
nunca omite el campo y que no hay negocios en otra moneda. Entonces el defecto
es latente y el coste de una versión mayor no lo compensa. Lo que **no** vale
es dejarlo sin comprobar esas dos cosas.

## Qué habría que medir antes de decidir

Tres cosas, todas baratas, y las tres son de ejecutar y no de leer:

1. Cuántos negocios tienen hoy `baseCurrencyCode != 'CUP'`.
2. Si algún `SyncEvent` de entidad `STORE` ya recibido **omite**
   `baseCurrency` en su `payload` — está guardado en JSONB, así que es una
   consulta.
3. Que un `STORE` **válido** que omite el campo, después de F-045, siga
   poniendo `CUP`. Es la prueba de que el defecto sobrevive al arreglo de I4,
   y hoy está razonada pero **no** medida.

## Criterios de aceptación propuestos

Provisionales: cuál de ellos sobrevive depende de la opción que se elija y de
lo que digan las tres mediciones. Escritos para (a), la que reusa doctrina ya
existente.

1. `[nuevo]` Un `STORE` válido que **omite** `baseCurrency` responde
   `processed` y deja `Business.baseCurrencyCode` como estaba, verificado
   leyendo la columna antes y después con un negocio en `USD`.
2. `[nuevo]` Un `STORE` que **manda** `baseCurrency` la aplica, verificado con
   una segunda petición que la cambia y la lectura posterior.
3. `[nuevo]` Un `STORE` con `baseCurrency` de longitud distinta de 3 sigue
   siendo `400` de lote: esta propuesta cambia la omisión, no la forma.
4. `[nuevo]` `docs/sync-contract.md` sube de versión **mayor**, retirando el
   `// por defecto CUP si se omite` de su ejemplo y añadiendo `baseCurrency` a
   la tabla de campos de la familia «omitir no es apagar», **acordada con
   cuadrecaja antes de publicarla**; `grep -c 'por defecto CUP si se omite'`
   da `0`.
5. `[nuevo]` `bash .agent/verify.sh F-046 --full` termina con código 0.

## Preguntas al humano

**PP1 — ¿Se toma esto, y con qué prioridad?** Depende de las tres mediciones de
arriba. Si nadie está en otra moneda y el POS nunca omite el campo, la opción
(c) es defendible y esto se queda en el cajón con su porqué escrito.

**PP2 — ¿(a) omitir-no-es-apagar u (b) obligatorio?** (a) reusa una doctrina que
el sistema ya tiene escrita tres veces; (b) es más explícita pero rompe a
cualquier POS que hoy omita el campo.

**PP3 — ¿Va en el mismo viaje de contrato que otra cosa?** Es una versión mayor
y hay que negociarla. Si hay otra mayor pendiente —la generalización del punto
4 del veredicto de cuadrecaja, por ejemplo, que quedó fuera— sale más barato
llevarlas juntas que gastar dos negociaciones.

## No decidido a propósito

1. **Si `Business.name` debería seguir viajando en el `payload` de `STORE`.**
   Cero lectores en `src/`, pero es una decisión de propiedad de campos y no de
   monedas. Otra conversación.
2. **La carrera entre sucursales del mismo negocio.** Dos `STORE` del mismo
   negocio entregados fuera de orden se resuelven por «gana el último que
   llegó», y el contrato ya lo declara asumido
   (`docs/sync-contract.md:1286`). Ni F-045 ni esto lo cambian.
