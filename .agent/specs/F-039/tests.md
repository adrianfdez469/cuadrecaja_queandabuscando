---
feature: F-039
agente: sdd-tester
actualizado: 2026-09-08T15:10:00Z
estado: listo
veredicto: listo
---

## Estrategia

Los diez pasos del plan firmado estaban construidos y `bash .agent/verify.sh
F-039 --full` ya salía 0 al recibir el árbol. El primer ciclo cubrió los
pasos 9 y 10: escribir `.agent/specs/F-039/smoke.sh` (lo que solo se ve con
la app levantada), medir el criterio 10 y emitir el veredicto por criterio.
Un segundo ciclo, corto, añadió `.agent/specs/F-039/visual.mjs`: `design.md`
tiene interfaz (`estado: listo`), y `bash .agent/sdd.sh done F-039` no cierra
un feature con interfaz cuyos pasos visuales no se ejecutaron nunca — leer el
documento y dar por buenas sus cifras no cuenta.

Cuatro niveles, por lo que AGENTS.md § Cosas que muerden manda sobre la
extensión del archivo:

- **`node`** (`*.test.ts`): la aritmética pura (`src/lib/priceEquivalents.ts`,
  `src/lib/money.ts`), el reparto de tags de invalidación con Prisma simulado
  y contra Postgres real (`*.db.test.ts`), y el corte de fronteras
  (`src/lib/boundaries.test.ts`).
- **`ui`** (`*.test.tsx`, jsdom): `ProductCard`, `CartView`, `CheckoutForm`, el
  selector de la cabecera y las cinco ramas del guion de arranque ejecutadas
  de verdad en un DOM fabricado.
- **`smoke`** (`.agent/specs/F-039/smoke.sh`, app levantada, Postgres real de
  `docker-compose.yml`): lo que ningún test unitario puede ver — el HTML
  crudo sin ejecutar nada, dos peticiones con `Cookie`/`Accept-Language`
  distintos, un `EXCHANGE_RATE` real cambiando la primera visita posterior, y
  un pedido de verdad creado con `POST /api/orders`.
- **`visual`** (`.agent/specs/F-039/visual.mjs`, app levantada, Playwright
  headless): lo que ni `curl` ni un test de jsdom pueden ver con un motor de
  render real — el salto de maquetación al hidratar (medido en píxeles), el
  foco del teclado, si cambiar de moneda dispara una petición de red, el
  contraste compuesto en un tema real, y el nombre accesible que calcula
  Chromium. Traduce los OCHO puntos de `design.md` § Verificación visual.

El criterio 6 tiene una incongruencia documentada por `spec.md` (I1): tomado
literalmente no es ejecutable porque el checkout nunca cobra en la moneda del
equivalente. Se verifica con las dos comparaciones que I1/C6 dejan escritas:
(a) el principal es idéntico al importe cobrado, (b) el equivalente es
`convert()` de ese importe cobrado con las mismas tasas de esa cotización —
la función real de `src/lib/money.ts`, llamada vía `npx tsx` desde el guion de
humo, nunca reimplementada a mano.

## Mapa criterio → prueba

| #   | Criterio de aceptación (`features.json`)                                                                        | Prueba                                                                                                                                                                                                                                                                                                                                     | Archivo                                                                                                                                                                                        | Resultado              |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | Tarjeta con base + equivalente aproximado, verificado en la página servida                                      | Unitario: principal + equivalente marcado, el aproximado no es el elemento principal. Runtime: `curl` de `/tienda-demo`                                                                                                                                                                                                                    | `src/components/store/ProductCard.test.tsx` (12 tests); `.agent/specs/F-039/smoke.sh` § criterio 2                                                                                             | **PASA**               |
| 2   | Los equivalentes viajan en el HTML, visibles sin ejecutar JavaScript                                            | `curl -s localhost:3100/tienda-demo` contiene `data-equiv="USD"`/`"MLC"`; la etiqueta `<html>` servida no lleva `data-ref-currency` (R13). Con JavaScript DESHABILITADO de verdad en Playwright (no solo `curl`): ambos equivalentes son visibles a 360/768/1280, sin selector y sin desplazamiento horizontal                             | `.agent/specs/F-039/smoke.sh` § criterio 2; `.agent/specs/F-039/visual.mjs` punto 1                                                                                                            | **PASA**               |
| 3   | La preferencia se recuerda y NO crea variante de caché: mismo cuerpo para dos `Cookie`/`Accept-Language`        | Dos peticiones a `/tienda-demo`, cuerpos idénticos tras quitar `<script>`; frontera sin `next/headers` en `/[slug]`; persistencia en `localStorage`. En un navegador real: elegir MLC no hace NINGUNA petición al servidor, el foco se queda en el `<select>`, y la elección sobrevive a recargar y a navegar a las otras cuatro pantallas | `.agent/specs/F-039/smoke.sh` § criterio 3; `src/lib/boundaries.test.ts` (5 tests); `src/features/currency/referenceCurrencyStore.test.tsx`; `.agent/specs/F-039/visual.mjs` punto 4           | **PASA**               |
| 4   | Moneda declarada sin tasa: no se pinta para ese producto, los demás sí, el principal no desaparece              | Unitario (`R5`/DH5, las dos mitades). Runtime: el-faro con `["CUP","USD","EUR"]`, tasa solo de USD — el equivalente de USD se pinta, el de EUR no, el principal sigue, y el selector ofrece EXACTAMENTE dos opciones (visual, conteo real)                                                                                                 | `src/lib/priceEquivalents.test.ts`, `src/components/store/ProductCard.test.tsx` (24 tests); `.agent/specs/F-039/smoke.sh` § "criterio 4/12(b)/DH5"; `.agent/specs/F-039/visual.mjs` punto 5(a) | **PASA**               |
| 5   | La base se muestra aunque no venga en la lista declarada                                                        | Unitario (R2/E7). Runtime: el-faro con `displayCurrencies=["USD"]` (sin "CUP"): el principal sigue en CUP, sin cambiar                                                                                                                                                                                                                     | `src/lib/priceEquivalents.test.ts -t "keeps the whole list when the base is absent"`; `.agent/specs/F-039/smoke.sh` § criterio 5                                                               | **PASA**               |
| 6   | El equivalente coincide al céntimo con lo que cobra el checkout, creando el pedido y comparando los dos números | I1 de `spec.md`: dos comparaciones literales — (a) principal === `unitPrice` del pedido REAL creado; (b) equivalente === `convert(unitPrice, USD, tasas de la cotización)`, con `convert()` real vía `npx tsx`                                                                                                                             | `.agent/specs/F-039/smoke.sh` § criterio 6 (POST /api/orders real, 201, fila leída de `OrderItem`)                                                                                             | **PASA**               |
| 7   | Producto y equivalente en monedas no-CUP dan el mismo céntimo que la conversión por CUP: el ancla no se salta   | Unitario: base MLC, producto USD, equivalente EUR — coincide con `convert(convert(...))` y difiere del cociente directo                                                                                                                                                                                                                    | `src/lib/priceEquivalents.test.ts -t "never skips the anchor"`                                                                                                                                 | **PASA**               |
| 8   | Un `EXCHANGE_RATE` cambia los equivalentes en la primera visita posterior, sin esperar el suelo de revalidación | `EXCHANGE_RATE` de EUR (antes sin tasa) a un negocio real; la primera visita posterior ya trae el equivalente Y la moneda entra sola al selector (E19); una segunda tasa (cambiada) también se refleja sin reiniciar nada; visualmente, el conteo de opciones del selector antes (2) y después (3)                                         | `.agent/specs/F-039/smoke.sh` § "criterio 8/E19"; `.agent/specs/F-039/visual.mjs` punto 5(b)                                                                                                   | **PASA**               |
| 9   | Un negocio sin monedas extra declaradas sirve exactamente lo que sirve hoy                                      | el-faro (`displayCurrencies=[]`, el estado del seed): sin `data-ref-choices`, sin `data-equiv`, sin la sub-barra. Y lo mismo con una lista que declara pero NINGUNA moneda tiene tasa                                                                                                                                                      | `.agent/specs/F-039/smoke.sh` § criterio 9; `src/components/store/ProductCard.test.tsx`; `.agent/specs/F-039/visual.mjs` punto 5(c)                                                            | **PASA**               |
| 10  | El JavaScript añadido está medido y anotado en el progress, y la página sigue siendo utilizable sin él          | `npm run check:bundle` antes/después (`.agent/progress/F-039.md` § Medición); usable sin JS verificado con `curl` y con Playwright real (`javaScriptEnabled: false`, punto 1 del visual)                                                                                                                                                   | `.agent/progress/F-039.md` § "Medición del criterio 10"; `.agent/specs/F-039/smoke.sh` § criterio 2; `.agent/specs/F-039/visual.mjs` punto 1                                                   | **PASA**               |
| 11  | `bash .agent/verify.sh F-039 --full` termina con código 0                                                       | Ejecutado                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                              | **PASA**, código **0** |

Un criterio sin fila no está cubierto. Los once tienen fila y los once
pasaron.

## Ejecuciones

```
$ bash .agent/verify.sh F-039 --full
== Verificación F-039 · intento 57/54 ==
  ✓ harness    0-1s
  ✓ typecheck  1-2s
  ✓ lint       5-6s
  ✓ format     9-10s
  ✓ test       28-34s
  ✓ prisma     1s
  ✓ build      5-7s
  ✓ theme      0s
  ✓ bundle     0s
PASA  (código de salida: 0)
```

```
$ bash .agent/verify.sh F-039 --smoke
== Verificación F-039 · intento 53/56/58/59 ==
  ✓ typecheck  1-2s
  ✓ lint       5-6s
  ✓ format     9-10s
  ✓ test       28-37s
  ✓ smoke      9-11s
PASA  (código de salida: 0)
```

`bash .agent/specs/F-039/smoke.sh` corrido a mano contra un `next dev` propio
(puerto 3199), **tres veces seguidas sobre la misma base**, sin recrear
contenedores ni datos: **0 aserciones fallidas** las tres veces —
comprobación explícita de que el guion es idempotente (restaura `el-faro` a
`displayCurrencies=[]` y borra las filas de `ExchangeRate` que él mismo
añadió, así que la siguiente corrida encuentra la misma precondición del
criterio 9 e I3).

```
$ npm test
 Test Files  146 passed (146)
      Tests  1563 passed (1563)
```

```
$ npm run check:bundle   (tras npm run build)
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 178.3 KB gzipped (budget 193 KB)
    HTML:      5.2 KB gzipped — this is what decides first paint
```

Antes de este feature (medido en el ciclo 1/F-010 y confirmado sin cambios
hasta el ciclo 2 de F-039): **182,1 KB**. Después de los diez pasos: **178,3
KB** — por debajo de la línea base, no por encima como estimaba
`architecture.md`. 178,3 < 193: no hace falta subir `BUDGET_KB`. Detalle
completo en `.agent/progress/F-039.md` § "Medición del criterio 10".

`bash .agent/verify.sh pending F-039` → vacío (sin fallos sin fichar ni
descartar).

```
$ bash .agent/verify.sh F-039 --visual
== Verificación F-039 · intentos 67/68/69 ==
  ✓ typecheck  1s
  ✓ lint       5-6s
  ✓ format     8-9s
  ✓ test       27-28s
  ✓ visual     17-21s
PASA  (código de salida: 0)
```

`bash .agent/specs/F-039/visual.mjs` corrido **cuatro** veces seguidas contra
la misma base (dos a mano contra un `next dev` propio, dos más a través de
`bash .agent/verify.sh F-039 --visual` — una reutilizando ese mismo servidor
y otra arrancando el suyo propio desde cero tras matar el anterior): **0
aserciones fallidas** las cuatro veces. Los ocho puntos de `design.md`
§ Verificación visual, traducidos:

1. Sin JavaScript (`javaScriptEnabled: false` real, no solo `curl`), los dos
   equivalentes son visibles a 360/768/1280, sin selector y sin
   desplazamiento horizontal.
2. Con JavaScript y `localStorage` limpio, una sola línea de equivalente
   (USD) y el selector en «También en USD»; y YA en `domcontentloaded` (antes
   de que termine de hidratar) el atributo está puesto y MLC ya está oculto
   — no hay un instante con dos equivalentes visibles (EX1).
3. **El salto que no debe existir (EX2).** La primera tarjeta de la rejilla
   real (`ul.grid > li`, no la fila de chips de categoría — ver el hallazgo
   de abajo) está en la posición **exactamente igual** antes y después de
   hidratar, y coincide al píxel con lo que mide `design.md`: **721 a 360,
   637 a 768 y 1280**.
4. Cambiar de USD a MLC no dispara NINGUNA petición de red, el foco se queda
   en el `<select>` (comprobado enfocándolo con un `click()` real antes de
   elegir, como haría un comprador — `selectOption()` a secas de Playwright
   nunca enfoca el control), y la elección sobrevive a recargar y a navegar
   a las otras cuatro pantallas sin volver a elegir (criterio 12).
5. Los tres casos raros, con datos reales enviados por sync a el-faro
   (token propio, acuñado en el guion): (a) `["CUP","USD","EUR"]` con tasa
   solo de USD → selector con EXACTAMENTE dos opciones («Solo CUP»,
   «También en USD»), cero apariciones de EUR; (b) llega el `EXCHANGE_RATE`
   de EUR → la PRIMERA visita posterior ya lo ofrece (tres opciones) y pinta
   su equivalente, sin reenviar `BUSINESS`; (c) lista vacía y lista que
   declara pero ninguna moneda con tasa (`["GBP"]`, sin su tasa) → los dos
   casos sin selector y sin ningún equivalente, igual que hoy.
6. Cuarenta monedas sintéticas (el mismo generador de F-038 C10) a 360 px,
   en el estado servido (sin reducir): sin desplazamiento horizontal, dos
   columnas alineadas, ninguna imagen deformada. La altura exacta de tarjeta
   y de página no se exige al píxel (depende de los códigos/tasas al azar de
   esta corrida, distintos de los del prototipo de `design.md`) — se anota
   como referencia (~954-994 px de tarjeta, ~8 590-8 680 px de página, mismo
   orden de magnitud que los ~792/~7 069 del prototipo).
7. Tema oscuro en `tienda-dos` (branding propio, `--color-brand` verde): el
   equivalente sigue con contraste ≥ 4,5:1 (medido: 7,16, componiendo colores
   en un canvas de 1×1 porque Chromium serializa los tokens en
   lab()/oklab(), nunca en rgb() — misma técnica que
   `.agent/specs/F-010/visual.mjs`), y el `<select>` sigue en
   `--color-surface`, nunca en el `--color-brand` de la tienda.
8. Con USD elegido, el nombre accesible (`ariaSnapshot()`) de "Arroz blanco
   1 kg" contiene "aproximadamente US$…" y NO contiene "MLC"; hay
   EXACTAMENTE una región `aria-live=polite` en toda la página, y cambiar de
   moneda anuncia EXACTAMENTE una frase, no veinticuatro.

**Hallazgo real durante la escritura, corregido antes de dar el punto 3 por
bueno**: la primera versión medía con el selector `main ul > li`, que en
esta página coincide con la fila de CHIPS DE CATEGORÍA (también un
`<ul><li>`, situada antes de la rejilla de productos) y no con la rejilla
misma — daba 641 px/557 px, **80 px por debajo** de los 721/637 que mide
`design.md`. Aislado inyectando y quitando la sub-barra en el mismo negocio
(seed-negocio-1): el aporte de la sub-barra por sí sola es **exactamente 53
px** en los tres anchos, coincidiendo con lo que dice `design.md` — el error
estaba en mi selector, no en el código de producto. Corregido a
`ul.grid > li`, la cifra coincide **exacta** con la de diseño.

## Fallos encontrados

Ninguno de código de este feature. Un fallo de infraestructura, no
atribuible:

- **`test:AssertionError: expected […](4) to deeply equal […](4)`**,
  `src/features/marketplace/server/search.db.test.ts > pagination is stable
and total order holds across repeated calls (E21, R8)` — un archivo que
  F-039 no toca (búsqueda del marketplace, no precios ni monedas). Apareció
  UNA vez dentro de `bash .agent/verify.sh F-039 --smoke` y pasó limpio en
  solitario (2 veces) y en dos corridas completas posteriores de `npm test`
  (146/146 y 1563/1563). El `ORDER BY` de `searchCanonicalProducts` ya tiene
  un desempate completo y escrito a propósito (`rank, storeCount, name, id`
  — su propio comentario cita R8), así que no hay un hueco de diseño
  evidente para fichar sin investigar código de otro feature, fuera del
  alcance de este ciclo. **Descartado**, no fichado:
  `bash .agent/verify.sh dismiss F-039 '<firma>' '<motivo>'` (motivo completo
  en `.agent/progress/F-039.md` § "Problemas resueltos en este ciclo" y en el
  registro del propio comando). Si volviera a aparecer de forma reproducible,
  vuelve a **`sdd-implementer`** (o a quien posea `search.db.test.ts`), no a
  este feature.

Dos descuidos propios del guion `.agent/specs/F-039/visual.mjs`, corregidos
antes de dar sus puntos por buenos y anotados aquí porque `sdd.sh done`
también los cuenta como fallos de este ciclo si no quedan explicados:

- Punto 3 (EX2): medía con el selector `main ul > li`, que coincidía con la
  fila de chips de categoría en vez de con la rejilla de productos — daba
  80 px menos de lo real. Corregido a `ul.grid > li` antes de dar el punto
  por bueno (detalle completo arriba, § Ejecuciones). No fichado: es un
  error de mi propio guion de verificación, no un patrón que vaya a repetirse
  en otro feature.
- Punto 5(c): reutilizaba EUR para el caso "declara pero sin tasa", pero EUR
  ya tenía tasa desde el punto 5(b) del mismo guion. Corregido a usar `GBP`,
  una moneda sin tasa en ningún punto anterior. No fichado, mismo motivo.

## Huecos de cobertura

Ninguno de los once criterios. Una nota honesta sobre alcance que ya no es
un hueco, y una que sigue siéndolo a propósito:

1. **Criterio 10, "usable sin JavaScript"**: verificado con `curl` (nunca
   ejecuta JavaScript) Y con un navegador real en Playwright con
   `javaScriptEnabled: false` (`.agent/specs/F-039/visual.mjs` punto 1): a
   360/768/1280, ambos equivalentes son visibles, no hay ningún control y no
   hay desplazamiento horizontal. Ya no es un hueco — es lo que este mismo
   ciclo cerró a pedido del coordinador.
2. **DH3 (carrito y checkout)** es superficie añadida que ningún
   `acceptance_criteria` nombra (I2 de `spec.md`) — verificada aquí
   (`.agent/specs/F-039/smoke.sh` § criterio 6, los dos asertos "DH3") pero
   **no cuenta** para ninguno de los once criterios, tal como pide el
   encargo.

## Veredicto

**`LISTO`**. Los once criterios de `features.json` se verificaron
ejecutando algo — comando, código de salida o petición HTTP real y su
respuesta, nunca leyendo el código y concluyendo que debería funcionar.
`bash .agent/verify.sh F-039 --full` → **0**. `bash .agent/verify.sh F-039
--smoke` → **0**. `bash .agent/verify.sh F-039 --visual` → **0** (los ocho
puntos de `design.md` § Verificación visual, ejecutados con Playwright real,
no leídos). `bash .agent/verify.sh pending F-039` → vacío.

## Preguntas al humano

Ninguna. `TP1..TPn`: no aplica — ningún criterio quedó sin poder verificarse
tal como está escrito (I1 de `spec.md` ya lo resolvió con las dos
comparaciones de C6, y no lo reabro), y el único fallo del sensor
(marketplace, ajeno) se descartó con su motivo completo, sin necesitar una
decisión de producto.
