---
slug: jsx-condicional-por-estado-oculta-del-html-servido
sintoma: un `curl` o una comprobación sobre el HTML de la primera respuesta no encuentra un bloque que "debería" estar ahí, aunque el componente ya recibe el dato/prop correcto
firma: —
etapa: smoke
visto_en: F-042
creado: 2026-09-09T21:21:21Z
promovido_a_agents: no
arreglo: cambia `{condicion && (<bloque/>)}` por `<div hidden={!condicion}>` (o equivalente) cuando el criterio exige que el bloque esté en el HTML servido, aunque no sea visible hasta que el comprador actúe
---

## Qué pasa de verdad

Un island de cliente arranca con un estado por defecto (aquí,
`fulfillment === "PICKUP"`). Un bloque escrito como
`{fulfillment === "DELIVERY" && (<div>…</div>)}` no se monta en absoluto en
ese primer render — ni en el servidor ni en el cliente — así que su
contenido (etiquetas, `<option>`, texto estático como "Provincia") **no
existe en el HTML** que `curl` o un lector sin JavaScript reciben. Esto es
independiente de si los DATOS que ese bloque necesita ya llegaron como prop:
los props de un componente cliente se serializan en el RSC payload en cuanto
se le pasan (eso SÍ está en el HTML, como bloque de datos), pero el JSX que
los consumiría solo aparece en el marcado si esa rama del árbol realmente se
ejecuta durante el render.

## Cómo se arregla

Cuando un criterio exige que un bloque esté en el HTML de la primera
respuesta (contarlo con `curl`, o que exista para un lector sin JS) pero su
_visibilidad_ depende de una elección del comprador, no se condiciona su
EXISTENCIA — se condiciona su presentación con el atributo nativo `hidden`
(`<div className="..." hidden={!condicion}>…</div>`). El contenido queda en
el marcado (curl lo ve, cuenta lo que tenga que contar) y el navegador lo
oculta con CSS (`display: none` de la hoja de estilos por defecto), sin
esperar a que el estado cambie del lado del cliente.

## Cuándo NO es esto

Si lo que falta en el HTML es la LISTA de opciones dentro de un combobox
propio (no un `<select>` nativo) que solo pinta su `<ul>` cuando está
abierto, eso no es este bug: los DATOS (nombres, códigos, importes) ya están
en el HTML vía el prop serializado del componente padre, que es justo lo que
un criterio sobre "el HTML trae los nombres" pide (D5/AD3 de F-042). No hace
falta forzar la lista abierta para que ese criterio concreto pase — solo el
bloque contenedor (etiquetas, campos estáticos) necesita el tratamiento de
arriba.

## Cómo se evita

Antes de escribir `{estadoDeCliente && (<bloque/>)}` alrededor de cualquier
cosa que un criterio vaya a contar por HTML crudo (`curl`, un lector sin JS,
un rastreador), preguntar: ¿este bloque tiene que EXISTIR desde el primer
render, aunque no sea visible? Si la respuesta es sí, usar `hidden` (o una
clase CSS controlada por el mismo estado) en vez de un `&&` que lo saque del
árbol entero. Un `git grep -n '"DELIVERY" && ('` (o el equivalente del
propio feature) antes de dar una etapa de diseño por implementada ayuda a
encontrar estos casos temprano.
