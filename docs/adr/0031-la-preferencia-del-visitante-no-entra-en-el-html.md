# 0031 — La preferencia del visitante no entra en el HTML

**Aceptada** · 2026-09-08 · F-039

## Contexto

El escaparate se sirve por ISR con revalidación por tag
([ADR 0006](0006-isr-con-revalidacion-por-tag.md)): una página se genera una
vez, se cachea, y el sync la invalida por `storeTag`/`storeCatalogTag`
(`src/lib/cache.ts:86-93`) cuando algo cambia. Esa promesa depende de que el
cuerpo servido sea el **mismo** para cualquier visitante que pida la misma
URL — no hay una entrada de caché por visitante, hay una por tienda.

F-039 es el primer feature en el que el visitante tiene una **preferencia**
que cambia lo que ve: su moneda de referencia, elegida una vez en la cabecera
y recordada entre visitas (R17, `src/constants/currency.ts`). Y no será el
último — cualquier selector de zona de envío, de idioma o de sucursal
favorita llega con la misma pregunta: ¿esa preferencia entra en el cuerpo que
el CDN sirve, o no?

Si entrara, la respuesta obvia — una cookie o un parámetro de consulta que el
servidor lee para decidir qué pintar — rompe la premisa de la que depende
todo lo demás en `src/app/[slug]/`: una tasa de cambio nueva (`EXCHANGE_RATE`)
tendría que invalidar una entrada de caché **por moneda de referencia
posible**, no una por tienda, y el guardián que impide meter `/[slug]` en el
`matcher` del proxy (AGENTS.md § Cosas que muerden,
`.agent/playbook/proxy-matcher-anula-isr.md`) existe precisamente para que
nadie necesite leer nada del visitante ahí.

## Decisión

**La preferencia del visitante no entra en el cuerpo servido y no crea
variantes de caché.** El servidor pinta **todas** las alternativas en el
HTML, cada una marcada con un atributo que la identifica
(`data-equiv`/`data-ref-choices`, `src/constants/currency.ts`); el cliente
escribe **un** atributo en `<html>` (`data-ref-currency`) y unas reglas de
CSS generadas por el servidor (`src/features/currency/reveal.ts`) deciden
cuál de las alternativas se ve. La preferencia vive **solo** en
`localStorage`, bajo la clave `qab.reference-currency.v1`
(`src/features/currency/referenceCurrencyStore.ts`).

Prohibido, y por la misma razón en los tres casos: una cookie que el
servidor lea para decidir el cuerpo, un parámetro de consulta con el mismo
efecto, una cabecera `Vary`, y leer cualquiera de los tres en
`src/proxy.ts`.

## Consecuencias

**Lo que se gana.** Para una URL, un solo cuerpo y una sola entrada de
caché — una tasa nueva invalida **una** cosa, no N variantes por moneda
posible. Sin JavaScript se ve todo (los N equivalentes), lo que es una
mejora respecto de no ver ninguno, nunca una degradación. Ninguna página de
`src/app/[slug]/` importa `next/headers` ni lee un parámetro de moneda —
comprobado por `src/lib/boundaries.test.ts` — así que la frontera entre lo
que decide el servidor y lo que decide el cliente sigue siendo la misma que
`docs/adr/0006-isr-con-revalidacion-por-tag.md` ya fijó.

**Lo que se acepta a cambio.** El HTML carga las alternativas que casi nadie
va a mirar — solo una de las N se ve, las demás quedan ocultas por CSS pero
viajan igual por la red. Eso pone un techo práctico al número de monedas
declaradas por tarjeta, que F-039 mide y anota (`npm run check:bundle`,
criterio 10 de `.agent/features.json`) en vez de suponer o limitar en
código: no hay tope arbitrario de monedas, hay una cifra medida contra la
que comparar la siguiente.

**El aviso de hidratación de React queda silenciado a propósito.**
`suppressHydrationWarning` en el `<html>` de `src/app/layout.tsx` es la
consecuencia inevitable de que el atributo que decide qué se ve lo escribe
un guion antes del primer pintado, no el servidor: sin esa propiedad, un
desajuste legítimo se imprime con `console.error` y pone roja una etapa
entera del sensor (ficha
`.agent/playbook/console-error-dispara-guardian-servidor.md`). Afecta a
toda la app, no solo a la tienda — un desajuste futuro de atributos de ese
elemento, de cualquier feature, dejaría de avisar en desarrollo. Aceptado
porque la alternativa —dejar el aviso activo— pone en rojo exactamente el
mecanismo que esta decisión elige a propósito.

## Alternativa descartada

**Una variante de caché por moneda de referencia** (una entrada distinta,
con su propio tag, por cada combinación tienda×moneda posible). Multiplica lo
que hay que revalidar en cada `EXCHANGE_RATE` — de una invalidación por
tienda a una por (tienda, moneda), sin techo si el negocio declara muchas
monedas — y duplica URLs equivalentes para los buscadores, dos problemas que
esta decisión evita sin necesidad de resolverlos.
