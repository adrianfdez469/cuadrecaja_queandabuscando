---
propuesta: 404-sin-salida-sin-javascript
agente: orquestador
actualizado: 2026-08-31T05:00:00Z
estado: propuesta
---

> Levantada por `sdd-tester` al verificar F-026
> (`.agent/specs/F-026/tests.md` § Fallos encontrados, hallazgo 1) y escrita a
> petición del humano el 2026-08-31, que eligió «abrir feature aparte» frente a
> «aceptarlo por escrito». **No está en `.agent/features.json` y no debe
> añadirla un agente** (regla 4): esta propuesta existe para que el humano
> decida con el texto delante.
>
> No lo causa F-026. Se comprobó igual en tres `not-found.tsx` de features
> distintos, uno de ellos anterior a este ciclo.

## Problema

Cuando alguien llega a una página que no existe —una categoría borrada, un
pedido con código mal copiado, una tienda que no está— **el HTML que el servidor
manda no contiene ni un solo enlace**. Ni el de salida («Ver todo el catálogo»),
ni el de la cabecera de la tienda. El texto se ve, porque viaja como subcadena
dentro del payload de hidratación de React, pero no hay ningún `<a href>` que un
navegador sin JavaScript pueda pintar ni un rastreador pueda seguir.

Quien cae ahí sin JavaScript se queda **sin salida**: puede leer «Ver todo el
catálogo» y no puede pulsarlo. Importa aquí más que en otro producto porque el
argumento entero de esta tienda es que **se lee sin esperar el JavaScript**
(`AGENTS.md` § Prohibiciones), y porque contradice la letra de una regla que ya
está escrita: R6 de `.agent/specs/F-026/spec.md`, «ninguna navegación puede
volver un producto inalcanzable».

## Alcance

### Dentro

1. Que la página de «no encontrado» de la tienda pública sirva **HTML real**,
   con sus enlaces como `<a href>`, sin depender de la hidratación.
2. Los tres `not-found.tsx` que hoy se comportan igual, no solo el de categoría:
   `src/app/[slug]/c/[categorySlug]/not-found.tsx` (F-026),
   `src/app/[slug]/pedido/[code]/not-found.tsx` (F-011/F-012) y
   `src/app/not-found.tsx` (el global).
3. Decidir **por qué** ocurre —estrategia de render de `notFound()` en Next 16
   con Turbopack— antes de parchear: es lo que separa un arreglo de un
   apaño que se deshace en la próxima actualización.

### Fuera (explícito)

- **Rediseñar lo que dicen esas páginas.** El texto y la forma ya están
  decididos en el diseño de cada feature; esto es sobre el marcado servido.
- **Las páginas 200.** Se comprobó que ahí los enlaces sí son HTML real (23
  `<a>` en `/tienda-demo`). El problema es específico del camino de
  `notFound()`.
- **El panel de administración**, que sí exige sesión y JavaScript.

## Actores y precondiciones

**Quien llega a una URL que no existe** de la tienda pública: un comprador con
un enlace viejo o mal copiado, un rastreador de buscador, un `curl` de
monitoreo, o cualquiera con el JavaScript sin cargar todavía —que es todo el
mundo, durante los primeros cientos de milisegundos.

Precondición: ninguna. Es la ruta de error, y por definición se llega a ella sin
haber pedido nada.

## Comportamiento esperado

**E1 — el 404 de la tienda trae sus enlaces en el HTML.**
Dada una URL inexistente bajo una tienda publicada, cuando se pide con una
herramienta que **no** ejecuta JavaScript, entonces la respuesta trae el enlace
de salida como `<a href>` y su destino responde 200.

**E2 — la cabecera de la tienda sigue siendo cabecera.**
Dado ese mismo 404, cuando se pide igual, entonces los enlaces del marco de la
tienda (la cabecera, el nombre) también son `<a href>` reales, como en cualquier
página 200 de la misma tienda.

**E3 — sigue siendo un 404 de verdad.**
Dado el arreglo, cuando se pide una URL inexistente, entonces el código de
estado sigue siendo **404** y no 200. Lo que cambia es el cuerpo, no el
contrato.

**E4 — los tres se comportan igual.**
Dado el 404 de categoría, el de pedido y el global, cuando se piden sin
JavaScript, entonces los tres traen enlaces reales. Que uno quede fuera es el
fallo repitiéndose en el siguiente feature.

## Reglas de negocio

**R1 — la página de error se lee sin JavaScript**, igual que el catálogo. Es la
misma regla que `AGENTS.md` § Prohibiciones ya impone a todo lo que renderiza
catálogo, aplicada al camino por el que se sale de un error.

**R2 — no se cambia el código de estado para arreglar el marcado.** Un 404 que
responde 200 para poder renderizarse estáticamente rompe a los rastreadores y a
los monitores, que es justo a quien esto pretende ayudar.

**R3 — un arreglo que solo cubra un `not-found.tsx` no cierra esto.** Son tres
hoy, y el cuarto lo escribirá el próximo feature copiando al vecino.

## Casos límite y errores

| Caso                                        | Qué tiene que pasar                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 404 bajo un alias de sucursal               | El enlace de salida lleva al slug **canónico**, no al alias                                 |
| 404 bajo una tienda `SUSPENDED`             | Se mantiene el aviso de cerrada que ya existe; esta propuesta no lo cambia                  |
| 404 global, fuera de cualquier tienda       | El enlace de salida es el de la plataforma, no el de una tienda que no sabemos cuál es      |
| La página de error de un error 500          | Fuera de alcance por ahora, pero conviene mirar si sufre lo mismo                           |
| El arreglo obliga a que el 404 sea estático | Comprobar que no vuelve dinámica ninguna ruta que hoy es ● (SSG): es el criterio 1 de F-004 |

## Datos y contrato

**Ninguno.** No toca la base, no toca `docs/sync-contract.md`, no toca el
contrato con cuadrecaja. Es render.

## Criterios de aceptación propuestos

Todos `[nuevo]`: esta propuesta no está en `features.json`.

1. `[nuevo]` `curl` (que nunca ejecuta JavaScript) contra una categoría
   inexistente de una tienda publicada devuelve **404** y su cuerpo contiene al
   menos un `<a href>` real cuyo destino responde 200.
2. `[nuevo]` Lo mismo contra un código de pedido inexistente y contra una URL
   fuera de toda tienda: los tres traen enlaces reales.
3. `[nuevo]` En los tres casos, el código de estado sigue siendo 404.
4. `[nuevo]` `npm run build` sigue marcando `/[slug]` y `/[slug]/p/[productSlug]`
   como ● (SSG).
5. `[nuevo]` `node scripts/check-bundle-budget.mjs` termina en 0 y ningún
   archivo de este feature usa la directiva de cliente.
6. `[nuevo]` La comprobación `CONOCIDO` que `.agent/specs/F-026/smoke.sh` dejó
   sembrada para este hallazgo pasa a ser una aserción normal, y pasa.
7. `[nuevo]` `bash .agent/verify.sh <ID> --full` termina en 0.

## Incongruencias detectadas

**I1 — contradice R6 de F-026, que ya está escrita y verificada.**
`.agent/specs/F-026/spec.md` § Reglas de negocio dice «ninguna navegación puede
volver un producto inalcanzable». El 404 de categoría es exactamente el sitio
donde eso se rompe, y el feature se cerró igual porque **ninguno de sus 15
criterios lo exigía tal como estaban escritos** — el criterio 14 es sobre el
enlace del selector hacia una vista 200, no sobre la salida de un 404.

**I2 — el diseño de F-026 pidió comprobarlo y la comprobación se hizo con
JavaScript.** V9 de `.agent/specs/F-026/design.md` dice «el 404 de categoría
conserva la cabecera de la tienda y su enlace lleva a la tienda», y se verificó
con el navegador — que sí ejecuta JavaScript, y por eso salió bien. La
comprobación no era falsa: era incompleta, y solo `curl` lo destapó.

**I3 — es anterior a F-026 y nadie lo había visto.** El
`src/app/[slug]/pedido/[code]/not-found.tsx` de F-011/F-012 se comporta igual
desde que existe. Que lo encontrara ahora un probador ejecutando `curl` en vez
de leer código dice algo del método, no del feature.

**I4 — puede no ser código nuestro.** El comportamiento se reprodujo con
`next build && next start`, no solo con `next dev`, así que no es un artefacto
del servidor de desarrollo; pero sí puede ser una propiedad de cómo Next 16
renderiza `notFound()`. Eso lo tiene que mirar `sdd-architect` **antes** de que
nadie escriba un parche.

## Huecos y preguntas al humano

**SP1 — ¿Esto es un feature o una ficha del playbook?**
Si tiene arreglo —que el `not-found.tsx` se renderice estáticamente, o el patrón
que el arquitecto encuentre—, es un feature pequeño con siete criterios. Si
resulta ser una limitación de Next 16 sin salida razonable, es una ficha de
`.agent/playbook/` que avise al siguiente y una nota en `AGENTS.md`. **No se
puede decidir sin que `sdd-architect` mire primero I4.**
Recomendación: **abrirlo como feature**, y que el arquitecto lo convierta en
ficha si resulta que no hay nada que construir. Es más barato cerrar un feature
que no hacía falta que descubrir dentro de seis meses que nadie miró.

**SP2 — ¿Entra también la página de error 500?**
No se comprobó. Si sufre lo mismo, el arreglo probablemente es el mismo y sale
casi gratis meterlo aquí; si no, es ruido en el alcance.
Recomendación: que `sdd-architect` lo compruebe de paso y lo diga, y el humano
decida entonces con el dato.

**SP3 — ¿Qué prioridad tiene?**
Nadie se ha quejado, y la inmensa mayoría de los compradores llegan con
JavaScript. Pero el argumento del producto es que se lee sin él, y un rastreador
que encuentra un 404 sin enlaces no sigue explorando la tienda.
Recomendación: después de F-025 y F-027, que son valor visible, y antes de
cualquier feature nuevo de navegación — porque cada uno de esos escribe otro
`not-found.tsx` copiando al vecino (R3).

## No decidido a propósito

- **La forma técnica del arreglo.** `sdd-architect`, después de mirar I4.
- **Si el 404 global de la plataforma se trata igual que el de una tienda.** Son
  dos actores distintos y puede que dos decisiones distintas.
- **Si esto merece una línea en `AGENTS.md` § Cosas que muerden** además del
  arreglo. Depende de si el arreglo es estructural o hay que acordarse en cada
  `not-found.tsx` nuevo — y si es lo segundo, la línea es obligatoria.
