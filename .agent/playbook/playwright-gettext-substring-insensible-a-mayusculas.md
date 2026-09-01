---
slug: playwright-gettext-substring-insensible-a-mayusculas
sintoma: "un guion visual falla con: strict mode violation: getByText(...) resolved to N elements"
firma: strict mode violation:? getByText
etapa: visual
visto_en: F-031
creado: 2026-09-01T19:26:31Z
promovido_a_agents: no
arreglo: pasa { exact:true } a getByText/getByLabel, o localiza por una cadena que NINGÚN otro texto de la pantalla contenga como substring en minúsculas
---

## Qué pasa de verdad

`page.getByText("Por confirmar")`, sin `{ exact: true }`, hace **substring e
insensible a mayúsculas** por defecto — no exacto ni sensible al caso, que es
lo que la mayoría asume leyendo el nombre del método. En una pantalla de
F-031 con tres cadenas emparentadas — la celda `"Por confirmar"`, la
descripción del radio `"Costo por confirmar"` y la coletilla `"más el envío
por confirmar"` — las tres contienen la subcadena `por confirmar` en
minúsculas, así que `getByText("Por confirmar")` resuelve a **3** elementos y
Playwright para en seco con «strict mode violation» en vez de esperar a que
aparezca uno.

No es un fallo del componente ni de la copia: `design.md` fijó esas tres
cadenas a propósito, relacionadas por diseño (el léxico de F-031 tiene solo
cinco cadenas y ninguna es casual). El guion que las verifica es el que
necesita ser más preciso que "un texto que contenga esto".

## Cómo se arregla

Añadir `{ exact: true }` en cualquier `getByText`/`getByLabel` cuya cadena
sea substring de otra cadena visible en la misma pantalla:

```js
await page.getByText("Por confirmar", { exact: true }).waitFor();
```

Si ni con `exact` alcanza (dos elementos con el mismo texto exacto en la
pantalla — por ejemplo la tabla nueva y la plegada mostrando la misma
etiqueta), hay que acotar el `locator` a un contenedor padre
(`page.locator("main").getByText(...)`) o leer el DOM a mano con
`page.evaluate()`, que es lo que este mismo guion ya hace para las filas de
importe (`leerFilaPorEtiqueta`/`leerBloqueTotal` en
`.agent/specs/F-031/visual.mjs`) precisamente para no depender de que el
texto sea único en toda la página.

## Cuándo NO es esto

Si el mensaje dice `resolved to 0 elements` (o un timeout de `waitFor` sin
mencionar «strict mode»), el problema es que el texto no apareció —
normalmente una precondición que falta (el fixture no está en el estado que
el paso asume), no esto. Esta ficha es específicamente sobre **más de una**
coincidencia.

## Cómo se evita

Antes de usar `getByText`/`getByLabel` con una cadena corta, grepea la copia
de `design.md` (o el propio JSX) buscando esa cadena como subcadena de otra
— «por confirmar» apareciendo dentro de tres frases distintas es exactamente
el patrón que dispara esto. Si la copia del feature reutiliza deliberadamente
la misma palabra en varias frases (aquí, a propósito: es el léxico
canónico), asume que el `getByText` por defecto NO alcanza y usa `exact` o
`evaluate()` desde el principio, en vez de descubrirlo con un fallo en CI.
