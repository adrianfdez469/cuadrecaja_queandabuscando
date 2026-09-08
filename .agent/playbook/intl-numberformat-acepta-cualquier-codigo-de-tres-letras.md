---
slug: intl-numberformat-acepta-cualquier-codigo-de-tres-letras
sintoma: "un test que espera que `new Intl.NumberFormat(locale, { style: 'currency', currency })` LANCE para una moneda 'desconocida' de tres letras no lanza, y una cuenta de construcciones sale una de menos"
firma: expected "NumberFormat" to be called \d+ times, but got \d+ times
etapa: test
visto_en: F-039
creado: 2026-09-08T12:40:00Z
promovido_a_agents: no
arreglo: usa un código que NO tenga tres letras (p. ej. "ZZ" o "ZZZZ") para forzar de verdad la rama de respaldo — un código de tres letras, aunque sea inventado, nunca lanza
---

## Qué pasa de verdad

`Intl.NumberFormat` con `style: "currency"` solo valida la FORMA del código
(tres letras ASCII), no que exista de verdad en ISO 4217. Un código
totalmente inventado como `"ZZZ"` o `"XYZ"` construye sin lanzar y se
imprime el código tal cual como símbolo (`"ZZZ 10.00"`). El `catch` de
`formatWithIntl` (`src/lib/money.ts`) — y, con él, la rama de respaldo que
R6/AD6 memoizan por separado — solo se alcanza con un código que falle esa
comprobación de forma: menos o más de tres letras, dígitos, vacío. Verificado
ejecutando:

```js
new Intl.NumberFormat("en-US", { style: "currency", currency: "ZZZ" }); // no lanza
new Intl.NumberFormat("en-US", { style: "currency", currency: "ZZ" }); // "Invalid currency code : ZZ"
```

## Cómo se arregla

Si el test necesita forzar de verdad la rama de respaldo (para contar
construcciones, para afirmar el formato `"<símbolo> <importe>"`, etc.), usa
un código que no tenga exactamente tres letras — dos, cuatro, con dígitos o
vacío —, nunca un código inventado de tres letras creyendo que «Intl no lo
conoce».

## Cuándo NO es esto

Esto no es un defecto de `src/lib/money.ts`: el propio R6 dice que la tabla
`Currency` no decide nada y que el símbolo lo pone `Intl` con su rama de
respaldo para lo que el runtime no reconozca — y en la práctica, para
cualquier negocio real, el código siempre tiene tres letras (lo valida el
escritor del sync, `CURRENCY_CODE_PATTERN`), así que esta rama es
defensiva y casi nunca se ejercita con datos reales. No es un bug que haya
que perseguir en producción.

## Cómo se evita

Antes de escribir un test que asuma «este código de moneda no lo conoce
`Intl`», pruébalo suelto en un `node -e` primero: la intuición de que un
código «raro» va a lanzar es la trampa.
