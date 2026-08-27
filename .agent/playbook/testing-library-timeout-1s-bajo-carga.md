---
slug: testing-library-timeout-1s-bajo-carga
sintoma: "un test de componente falla con «Unable to find role=...» a ~1000-1100 ms, o con «Test timed out in 5000ms» cuando la suite crece, y vuelve a pasar si lo corres solo"
firma: Unable to find role|Test timed out in [0-9]+ms
etapa: test
visto_en: F-007, F-011, F-017, PR #7
creado: 2026-08-26T12:20:00Z
promovido_a_agents: no
arreglo: NO subas el techo — el diagnóstico original era falso. Busca un `fireEvent.click` sobre un control que se renderiza deshabilitado mientras carga algo: espera a que esté habilitado antes de pulsarlo (`await waitFor(() => expect(boton).toBeEnabled())`) y hazlo determinista retardando el fetch stubeado
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

## Resuelto en PR #7: no era el techo, era una carrera

Esta ficha estuvo mal escrita desde F-007, y la receta de arriba —subir
`asyncUtilTimeout`— nunca arregló nada: llegó a 8000 ms y el intermitente
siguió cayendo ~1 de cada 3 suites completas. Ocho segundos no son «un pelo»,
así que la explicación del timeout justo no se sostenía.

La causa real, en `CheckoutForm.test.tsx`:

```ts
const enviar = await screen.findByRole("button", { name: /confirmar/i });
fireEvent.click(enviar); // ← no dispara nada si sigue deshabilitado
const resumen = await screen.findByRole("alert"); // ← espera para siempre
```

El botón de enviar se renderiza desde el primer commit, **deshabilitado**
mientras `quoteState === "loading"`. `findByRole("button")` lo encuentra
igualmente —deshabilitado no lo saca del árbol de accesibilidad— y
`fireEvent.click` sobre un botón deshabilitado no dispara el handler. Sin
`submit()` no hay `fieldErrors`; sin `fieldErrors` no hay `role="alert"`. El
aserto siguiente agota su techo esperando algo que ya no va a ocurrir, y por
eso subirlo solo cambiaba cuánto tardaba en reportar el fallo. En una máquina
descargada la cotización stubeada resolvía antes del clic y la prueba ganaba
la carrera por azar; bajo carga, la perdía.

### El arreglo, y cómo se prueba que es este

Dos partes, las dos necesarias:

1. **Esperar a la precondición, no al elemento final.** Un ayudante que
   espera a que el botón esté habilitado —o sea, a `quoteState === "ready"`,
   que es la precondición real de lo que la prueba afirma— antes de pulsarlo.
2. **Quitarle el azar.** El `fetch` stubeado de la cotización ahora tarda
   50 ms a propósito, así que la transición loading→ready se ejercita
   siempre. Sin esto la prueba vuelve a pasar por lo rápido que iba el
   runner.

La segunda parte es también el instrumento que lo demuestra: con el retardo
puesto y sin el ayudante, las dos pruebas fallan **de forma determinista** con
la firma exacta de esta ficha, a los 8071 ms. Con el ayudante, verdes en 230 ms
— y 8 suites completas seguidas en verde donde antes caía 1 de cada 3.

### Por qué costó dos ciclos

La hipótesis correcta se planteó y se descartó por una **medición mal
cronometrada**: la sonda leía `enviar.disabled` dentro del `catch`, es decir
8 s DESPUÉS del clic, cuando la cotización ya había llegado y React había
actualizado ese mismo nodo a `disabled === false`. La sonda decía «el botón
estaba activo» y refutaba la única hipótesis buena. Si instrumentas una
carrera, **captura el estado en el instante del evento** y guárdalo en una
variable; leerlo después mide otro momento, y no lo avisa.

La segunda pista, gratis y desperdiciada: los campos `name` y `phone`
arrancan en `""` y nada los rellena, así que `validate()` no puede devolver
cero errores. Si el `alert` no aparece, el clic no llegó a `submit()`. Cuando
el estado inicial demuestra que un camino es imposible, deja de sospechar de
ese camino.

## Cuándo NO es esto

La firma es ancha a propósito y pesca cualquier `Unable to find role`. Lo que
la distingue **no** es el reloj —eso era el diagnóstico falso— sino que haya un
`fireEvent`/`userEvent` sobre un control que pudo estar deshabilitado, ausente
o reemplazado en ese instante. Tres cosas que la descartan:

- **El volcado del DOM sale vacío o a medias** en vez de mostrar la pantalla
  entera: el componente lanzó al renderizar. La causa está en la excepción, que
  suele aparecer más arriba en el log.
- **El test cayó a los pocos milisegundos**: no llegó a esperar nada, así que
  el rol no existía en ningún momento y no hay carrera que perder.
- **No hay ningún evento antes del aserto que falla**: si solo renderizas y
  esperas, no hay clic que se pierda. Ahí sí es el elemento el que no llega.

Y ojo con la comprobación que esta ficha recomendaba antes: «corre el archivo
solo, si pasa es esto». Pasar solo no distingue nada — un clic que se pierde
por una carrera **también** pasa solo, porque en una máquina descargada la
carrera se gana. Sirve para saber que no es estado compartido entre archivos, y
para nada más.

## Cómo se evita

Al escribir una prueba que dispara un evento sobre algo que aparece después de
un `fetch`, esperar a la **precondición del control**, no a que el control
exista:

```ts
// frágil: el botón existe desde el primer commit, deshabilitado
const boton = await screen.findByRole("button", { name: /confirmar/i });
fireEvent.click(boton);

// robusto: espera a que se pueda pulsar de verdad
const boton = await screen.findByRole("button", { name: /confirmar/i });
await waitFor(() => expect(boton).toBeEnabled());
fireEvent.click(boton);
```

Y retardar a propósito el `fetch` stubeado (50 ms bastan) en vez de resolverlo
al instante. Cuesta 50 ms y convierte «pasa según cómo vaya el runner» en «pasa
o falla siempre». Una prueba que gana una carrera por azar no está
verificando lo que dice verificar.

La regla general, y la lección más cara de las dos veces que esto se fichó mal:
**un test que pasa solo y falla en la suite no es un test al que le falte
tiempo.** Antes de subir un techo, busca qué evento pudo caer en el vacío.
Subir el timeout de un fallo que no es de timeout solo compra un rojo más
lento, y esta ficha se pasó dos ciclos comprándolo.

## Historia de los dos diagnósticos falsos

Se conservan porque explican por qué los números de `vitest.setup.ts` y
`vitest.config.mts` están donde están, y por qué no hay que volver a subirlos.

- **F-007**: se midió el test cayendo a ~1013 ms y se leyó como que se pasaba
  del techo de 1000 ms por un pelo. Era el techo agotándose esperando un
  `alert` que el clic perdido nunca iba a provocar. Arreglo aplicado:
  `asyncUtilTimeout` a 5000 y luego a 8000 ms. No arregló nada.
- **F-011**: con ~15 archivos de test más, el mismo test empezó a fallar con
  «Test timed out in 5000ms» en vez de «Unable to find role». La observación
  técnica es correcta y sigue valiendo —`testTimeout` y `asyncUtilTimeout` son
  dos techos independientes, y el del test completo puede agotarse antes—, pero
  la causa era la misma carrera: el techo que se agotaba dependía de cuál
  llegaba primero. Arreglo aplicado: `testTimeout: 15_000` en el proyecto `ui`.
  Tampoco arregló nada.

Los dos techos siguen en su sitio: un techo no es una espera y no cuesta nada
en verde. Pero ninguno de los dos es ya un seguro contra nada conocido, y si
alguna vez estorban para leer un fallo real, bajarlos hacia el valor por
defecto es el movimiento correcto.
