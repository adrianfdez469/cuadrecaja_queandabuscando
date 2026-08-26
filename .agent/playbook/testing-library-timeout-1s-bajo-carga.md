---
slug: testing-library-timeout-1s-bajo-carga
sintoma: 'un test de componente falla con «Unable to find role=...» y un tiempo de ~1000-1100 ms, y vuelve a pasar si lo corres solo'
firma: Unable to find role
etapa: test
visto_en: F-007
creado: 2026-08-26T12:20:00Z
promovido_a_agents: no
arreglo: no es tu cambio, es el timeout de 1 s de findBy*/waitFor agotado bajo carga — sube el timeout en ESE aserto (`{ timeout: 5000 }`), no toques el componente
---

## Qué pasa de verdad

El mensaje miente por omisión. «Unable to find role="alert"» suena a que el
elemento no se renderiza, y el volcado del DOM que lo acompaña lo confirma
visualmente: ahí no está. Pero el elemento **sí** aparece — un poco después de
que Testing Library dejara de esperar.

`findBy*` y `waitFor` traen un timeout **por defecto de 1000 ms**. En una
máquina descargada estas pruebas tardan decenas de milisegundos, así que el
margen es enorme y nadie lo nota. Con la caché de transformación de Vitest
fría, la suite entera corriendo en paralelo y jsdom montándose por primera vez,
el mismo aserto se va a ~1000-1100 ms y cae por un pelo.

De ahí las dos señales que lo identifican, y que hay que leer juntas:

1. **El tiempo del test es ~1000-1100 ms**, no 5 ms ni 30 s. Es el timeout,
   no un cuelgue.
2. **Pasa si lo corres solo.** `npx vitest run <archivo>` en verde mientras la
   suite completa está en rojo no es un test que dependa de otro: es un test al
   que le falta presupuesto.

Medido en F-007 sobre `src/features/cart/components/CheckoutForm.test.tsx`:
solo, 2/2 en 86 ms. Suite completa con la caché fría, tres vueltas: verde,
**rojo a 1013 ms**, verde. Y en la vuelta roja cayó el **segundo** test, no el
primero — cuál de los dos se lleva el fallo es azar, lo que confirma que no es
un defecto de ninguno de los dos en particular.

## Cómo se arregla

Dale presupuesto al aserto que se quedó corto, y solo a ese:

```ts
// antes
const resumen = await screen.findByRole("alert");
// después
const resumen = await screen.findByRole("alert", {}, { timeout: 5000 });

// y lo mismo en waitFor
await waitFor(() => expect(resumen).toHaveFocus(), { timeout: 5000 });
```

Cinco segundos no hacen la suite más lenta: el timeout es un **techo**, no una
espera. Cuando el elemento aparece a los 40 ms, el aserto termina a los 40 ms.
Lo único que cambia es cuánto aguanta antes de rendirse.

Si prefieres no tocar cada aserto, el techo global va en `vitest.config.mts`,
en el proyecto `ui`:

```ts
test: { name: "ui", environment: "jsdom", testTimeout: 10_000, ... }
```

Pero ojo: `testTimeout` es el del test completo, **no** el de `findBy*`. El de
Testing Library se sube con `configure({ asyncUtilTimeout: 5000 })` en
`vitest.setup.ts`, que es lo que de verdad gobierna este fallo.

Lo que **no** se arregla es el componente. En F-007 se comprobó antes de tocar
nada: `CheckoutForm` mueve el foco correctamente en el primer envío —eso es
justamente la regresión que F-010 arregló y que estas dos pruebas fijan—, así
que «arreglar» el componente sería perseguir un fantasma y probablemente
romper lo que las pruebas protegen.

## Cuándo NO es esto

La firma es ancha a propósito y pesca cualquier `Unable to find role`. Antes de
aplicar el arreglo, las dos comprobaciones que lo descartan:

- **Corre el archivo solo.** Si falla solo también, no es esto: el elemento de
  verdad no se renderiza y tienes un fallo real. Arréglalo, no le des más
  tiempo.
- **Mira el tiempo.** Si el test cayó a los 5 ms, tampoco es esto — no llegó a
  esperar nada, así que el rol no existía en ningún momento.

Y un caso que se parece pero es peor: si el rol falta porque el componente
lanzó al renderizar, el volcado del DOM sale **vacío** o a medias en vez de
mostrar el formulario entero. Ahí la causa está en la excepción, que suele
aparecer más arriba en el log.

Subir el timeout de un fallo que no es este lo convierte en un test que tarda
5 s en dar el mismo rojo. Es la razón por la que esta sección existe.

## Cómo se evita

Al escribir una prueba que espera algo asíncrono, no dejar el timeout por
defecto cuando el camino incluye un `fetch` stubeado más un re-render por
estado. Un segundo parece muchísimo mientras la máquina está tranquila, y esta
suite corre además en CI, en un runner compartido y siempre con la caché fría —
es decir, en las condiciones exactas que lo disparan.

La regla general, que es la que vale más allá de este fallo: **un test que pasa
solo y falla en la suite no es un test que dependa de otro hasta que lo hayas
descartado.** Antes de buscar estado compartido entre archivos, mira el reloj
del aserto. Aquí el reloj lo decía todo y el estado compartido no tenía nada
que ver.
