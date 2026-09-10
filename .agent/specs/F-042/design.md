---
feature: F-042
agente: sdd-designer
actualizado: 2026-09-09T05:09:01Z
estado: listo
---

> **La mitad que se toca.** `.agent/specs/F-042/spec.md` fija qué tiene que ser
> posible; este documento fija **dónde va cada cosa, qué dice y qué pasa cuando
> falla**. Se escribe **en paralelo** con `sdd-architect`, que está redactando
> architecture.md ahora mismo: **no se abrió**. Todo lo que aquí se necesita del
> servidor se nombra por lo que es —«la lista de municipios a los que llega esta
> tienda, con su importe», «la geometría de esa cobertura»— y nunca por cómo
> viaja. Las dos únicas exigencias de forma están juntas y marcadas en
> § «Lo que este diseño le exige al arquitecto», para que la conciliación sea
> una lectura y no una negociación.
>
> **Las ocho decisiones del humano del 2026-09-09 (D1-D8 de
> `.agent/progress/F-042.md`) se dan por firmes y no se reabren.** Las cuatro
> que gobiernan esta pantalla: **D1** el checkout lleva JavaScript y lo declara
> con su `<noscript>`; **D2** el mapa es Leaflet + OpenStreetMap con la
> **atribución visible siempre**, que aquí es una restricción de maquetación y
> no un detalle de implementación; **D3** el comprador elige **siempre un
> municipio**, y el paso de provincia es navegación; **D5** las opciones se
> pintan **en el HTML del servidor** y el JavaScript filtra lo que ya está.
>
> **Lo que este diseño NO toca**, por encargo explícito: los campos de contacto,
> el resumen del pedido, el botón de confirmar y los dos `RadioCard` de
> recogida/domicilio de `src/features/cart/components/CheckoutForm.tsx`. Se
> injerta entre ellos. Tampoco toca `src/` en absoluto: aquí no se implementa.

## Qué se miró antes de diseñar

`AGENTS.md` entero, con parada larga en § Prohibiciones —la de `"use client"`
sin estado ni eventos y **nunca** en algo que renderice catálogo, la de
`setState` dentro de un `useEffect` (error de ESLint con React 19, no aviso) y
la de magic strings—, § «El presupuesto de JavaScript no es un muro»,
§ «Cosas que muerden» (el `<noscript>`, la trampa de Prettier sobre la prosa y
la de las rutas abreviadas de `npm run check:harness`) y § Idioma.

`.agent/specs/F-042/spec.md` completa: los 26 escenarios E1-E26 con sus cuatro
subsecciones, las 27 reglas R1-R27, los 18 casos límite, § «Datos y contrato»,
los 15 criterios y las nueve incongruencias —de las que I1, I2, I7 y I8 son de
diseño—. La entrada **F-042** de `.agent/features.json` con sus doce criterios y
sus `notes` completas. `.agent/progress/F-042.md` § «Decisiones tomadas» (D1-D8)
y § «Notas para quien retome». `.agent/solicitudes.md`, fila **S-007** y su
bloque de razonamiento, en especial § «Cómo elige el comprador su zona»: el
argumento de usabilidad que sostiene el mapa es de cuadrecaja y es real —en La
Habana mucha gente no sabe si su calle es Playa o Marianao— y la granularidad
por cobertura declarada también es idea suya.

De precedente de método y de tono: `.agent/specs/F-031/design.md` (§ «El
léxico», que es el patrón que aquí se repite, y § 2, que es la única vez que
alguien tocó este mismo `<fieldset>`) y `.agent/specs/F-039/design.md`
(§ «Se miró la pantalla de verdad, y con números»).

Del código: `src/features/cart/components/CheckoutForm.tsx` entero —el
`<noscript>` de la línea 520, el resumen y el total de las líneas 437-471, el
`<fieldset>` «¿Cómo lo quieres recibir?» de la 772, el campo de dirección de la
801 y la validación de la 285—, `src/app/[slug]/checkout/page.tsx`,
`src/features/cart/components/OrderSummary.tsx`, `src/components/ui/Field.tsx`,
`src/components/ui/RadioCard.tsx`, `src/components/ui/Button.tsx`,
`src/components/ui/Alert.tsx`, `src/components/ui/Card.tsx`,
`src/components/ui/Badge.tsx`, `src/components/ui/Container.tsx` y
`src/features/currency/components/ReferenceCurrencySelect.tsx`, que es el único
selector del repositorio y el precedente de «un control que solo existe tras
hidratar». De zonas: `src/features/zones/zone-index.json`,
`src/features/zones/catalog.ts`, `src/features/zones/precedence.ts` y
`src/features/orders/deliveryOffer.ts`. De tema: `src/theme/tokens.css`,
`src/app/globals.css` y `scripts/check-theme-tokens.mjs`. De coste:
`scripts/check-bundle-budget.mjs`. Y `src/lib/money.ts` (`formatMoney` en
`es-CU`: `"$1,234.56"`, coma de millares y punto decimal) con
`src/lib/slug.ts:49`, que es el único sitio del repositorio que hoy pliega
tildes con `normalize("NFD")`.

### Se miró la pantalla de verdad, y con números

Se levantó `next dev` **en el 3200** de este worktree tras comprobar que nadie
lo ocupaba (AGENTS.md § «Un solo `next dev` por directorio»: los únicos `node`
escuchando eran un 5173 y un 5555 ajenos, y los contenedores compartidos ya
estaban arriba, así que no se levantó ninguno). Todo lo que sigue está **medido**
con Playwright contra ese servidor y la base de desarrollo sembrada.

**El checkout de hoy, `/tienda-demo/checkout` con tres líneas en el carrito:**

| Medida                             | 360     | 768    | 1280   |
| ---------------------------------- | ------- | ------ | ------ |
| Ancho de la columna del formulario | **328** | 720    | 720    |
| Ancho del panel de resumen         | 328     | 720    | 352    |
| Alto del documento                 | 1279    | 1155   | 930    |
| Desbordamiento horizontal          | no      | no     | no     |
| Posición del resumen               | debajo  | debajo | sticky |

**Y un hallazgo que decide la mitad de este documento.** `curl` sobre
`/tienda-demo/checkout` devuelve 26 235 bytes de HTML que **sí** traen el
`<noscript>` («activar JavaScript»), «Tus datos de contacto» y «Confirmar
pedido», y **no** traen el bloque «¿Cómo lo quieres recibir?»: cero
coincidencias de «recibir». Hoy ese `<fieldset>` está detrás de
`quoteState === "ready"`, que es una condición de cliente después de un `fetch`.
El criterio 1 se verifica **contando municipios en el HTML de `curl`**, así que
el bloque de zona **no puede colgar de la cotización**. Es la primera exigencia
de § «Lo que este diseño le exige al arquitecto» y no es una preferencia: sin
eso, C1 no se puede comprobar como está escrito.

**El ancho útil de una opción de la lista, medido con la tipografía real**
(Inter, la del `--font-sans`) a 360 px: la fila mide 328 y con `px-3` quedan
**304 px** para el nombre, el hueco y el importe.

| Texto                            | Ancho a 16 px | Ancho a 14 px |
| -------------------------------- | ------------- | ------------- |
| `Playa`                          | 41            | —             |
| `Plaza de la Revolución`         | 170           | —             |
| `San Miguel del Padrón`          | 170           | —             |
| `San Antonio de los Baños`       | 193           | —             |
| `Carlos Manuel de Céspedes`      | **214**       | —             |
| `+ $300.00`                      | —             | 70            |
| `+ $1,150.00`                    | —             | 75            |
| `Envío gratis`                   | —             | **78**        |
| `Pinar del Río` (línea de prov.) | —             | 83            |

De ahí sale la regla de la fila: **el nombre nunca se trunca ni se abrevia**
—es la identidad que el comprador reconoce (R4, R7)— y el importe va
`shrink-0 whitespace-nowrap` a la derecha. Con eso, **los 15 municipios de La
Habana caben en una sola línea a 360** (el peor, 170 + 12 + 78 = 260 ≤ 304) y
solo los dos nombres más largos del país envuelven a dos líneas, y solo si su
importe es «Envío gratis» (214 + 12 + 78 = 304, justo en el límite). Envolver es
correcto; recortar el nombre, no.

**Otras tres medidas que deciden maquetación, todas a 360:**

- «No sé mi municipio: verlo en el mapa» mide **281 px** a 16 px/500: cabe en un
  botón de ancho completo (`px-4` deja 296).
- «¿Tu dirección está en Plaza de la Revolución?» mide **349 px**: **no** cabe y
  envuelve a dos líneas, que es aceptable en un encabezado.
- «Sí, es Plaza de la Revolución» mide **217 px**, y con el `px-6` del botón
  grande son 265: cabe sola, pero **no** al lado de un segundo botón (265 + 12 +
  ≈70 = 347 > 328). Por eso los dos botones de la confirmación del mapa **se
  apilan a 360** y van en fila a partir de 768.
- «© colaboradores de OpenStreetMap» mide **207 px** a 12 px: la atribución
  completa de D2 **cabe entera en una línea incluso a 360**. No hay ningún
  argumento de espacio para esconderla, que es justo lo que la licencia no
  permite.

**El peso de la lista en la respuesta**, medido comprimiendo el marcado real de
las opciones y el mismo conjunto como datos (gzip -9, cada uno por separado; en
la respuesta real comparten diccionario con el resto y salen algo menos):

| Cobertura                     | HTML de las opciones | gzip    | Datos (JSON) | gzip    | Suma gzip  |
| ----------------------------- | -------------------- | ------- | ------------ | ------- | ---------- |
| 4 municipios (el caso cubano) | 1 272 B              | 295 B   | 368 B        | 148 B   | **443 B**  |
| 15 (La Habana entera)         | 4 734 B              | 473 B   | 1 344 B      | 281 B   | **754 B**  |
| 168 (el país entero, absurdo) | 62 777 B             | 2 852 B | 14 844 B     | 1 948 B | **4,7 KB** |

El caso normal cuesta **menos de medio kilobyte** en la respuesta y **cero** en
el bundle. Incluso el disparate de una tienda que sirviera los 168 municipios
pesa menos que los ~7 KB gzip que costaría meter el índice en el árbol de
cliente, que es exactamente lo que D5 y `src/features/zones/boundaries.test.ts`
prohíben.

**Lo que no se pudo medir aquí y hay que medir al construir:** Leaflet no está
instalado (`node_modules/leaflet` no existe), así que el peso real de su trozo
son **cifras publicadas, no medidas**, y quedan marcadas como tales en
§ Coste de cliente. El criterio 11 exige medirlas de todas formas.

## El léxico: siete cadenas y ni una octava

Antes de la maquetación, la decisión que gobierna las seis superficies donde
esto se lee. Es el método de `.agent/specs/F-031/design.md` § «El léxico», y por
la misma razón: un feature de pantalla se rompe por sinónimos.

| Concepto                                | Cadena canónica                                | Dónde aparece                                                      |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Lo que el comprador elige               | **municipio**                                  | etiqueta, ayuda, errores, mapa, confirmación                       |
| El conjunto al que la tienda llega      | **los municipios a los que llega esta tienda** | ayuda del campo, vacío de búsqueda, mapa                           |
| El importe, en una opción de la lista   | **+ $300.00**                                  | lista, mapa                                                        |
| El importe cero                         | **Envío gratis**                               | lista, mapa, línea de la zona elegida                              |
| El importe cero, en la fila del resumen | **Gratis**                                     | la fila «Envío» de `src/features/cart/components/OrderSummary.tsx` |
| Tocar el mapa, antes de aceptar         | **¿Tu dirección está en X?**                   | barra de confirmación del mapa                                     |
| El punto fuera de la cobertura          | **Esta tienda no llega ahí.**                  | mapa                                                               |

Cinco reglas sobre ese léxico, y las cinco son verificables:

1. **La palabra «zona» no aparece nunca en la pantalla del comprador.** Es
   vocabulario del contrato y del POS. El comprador lee «municipio», que es
   además lo único que puede elegir (D3, R3). En este documento se usa «zona»
   solo cuando se habla del modelo.
2. **Un importe de `0` se dice con palabras, no con una cifra** (E5, y el
   encargo del humano). «Envío gratis» donde hay sitio para la frase; «Gratis»
   en la fila del resumen, donde la columna es estrecha. **Nunca** `$0.00` en un
   envío a domicilio de una tienda `ZONE_BASED`, y **nunca** «Por confirmar»,
   que es el léxico de `QUOTED_PER_ORDER` y aquí sería mentira (R11).
   Esto **no** toca el `$0.00` de la recogida, que sigue como está hoy
   (`CheckoutForm.tsx:815-821`) y que la etapa `visual` de F-010 ya afirma.
3. **Ni un importe inventado, ni un «desde», ni un rango.** Mientras no haya
   municipio elegido, la fila «Envío» del resumen dice `Calculando…` solo
   mientras la cotización carga, y después **no muestra importe** hasta que hay
   municipio: la cadena es `Elige tu municipio`. No es un número disfrazado.
4. **El nombre del municipio se escribe verbatim del catálogo** (R20). Cuando la
   pantalla añade la provincia para desambiguar (R7), la provincia va en **otra
   línea o tras un separador**, nunca concatenada dentro del nombre: lo que se
   guarda en el pedido es el nombre a secas.
5. **Un municipio que esta tienda no sirve no se nombra jamás** (E2). Ni
   deshabilitado, ni con una nota, ni en el mensaje de «no encontré nada». Para
   esta tienda no existe.

## Flujo de usuario

Una tienda `ZONE_BASED` con al menos un municipio resoluble. Entre corchetes, el
estado del bloque de zona.

1. **Carrito** (`src/features/cart/components/CartView.tsx`). Sin cambios: «El
   envío se calcula en el siguiente paso.» sigue siendo cierto y ahora más que
   antes.
2. **Checkout, primer pintado, todavía sin JavaScript ejecutado** [sin elegir].
   El HTML ya trae los campos de contacto, el bloque «¿Cómo lo quieres
   recibir?» con sus dos `RadioCard`, **el campo de municipio con sus opciones
   dentro** y el botón de confirmar. El resumen dice `Calculando…`. Nada de esto
   espera a la cotización.
3. **Elige «Envío a domicilio»** [sin elegir]. Aparecen, en este orden: el paso
   de provincia **si la cobertura cruza más de una** (R5), el campo de
   municipio, la entrada al mapa y el campo de dirección. La fila «Envío» del
   resumen dice `Elige tu municipio` y el total todavía es el de subtotal menos
   descuento.
4. **Escribe tres letras** [eligiendo]. La lista se filtra **sin una sola
   petición** (E3, C5): filtra lo que ya está en la página. Se anuncia cuántos
   coinciden.
5. **Elige «Playa»** [elegido]. La lista se cierra, el campo muestra «Playa», y
   debajo aparece la línea `Envío a Playa · + $300.00`. En el resumen, la fila
   «Envío» pasa a `$300.00` y el total a `subtotal − descuento + 300.00`,
   **antes de tocar nada más** (E4, C2). Con un importe de `0`, la línea dice
   `Envío a Playa · Envío gratis`, la fila del resumen dice `Gratis` y el total
   no se mueve (E5).
6. **No sabe su municipio** [mapa]. Pulsa «No sé mi municipio: verlo en el
   mapa». **Ahí y solo ahí** empiezan a pedirse el JavaScript del mapa, la
   geometría de la cobertura y las teselas (E7, R14). A 360 el mapa ocupa la
   pantalla entera; a partir de 768 se abre en línea, debajo del campo.
7. **Toca una zona del mapa** [mapa, tocado]. La zona se resalta y **la pantalla
   escribe el nombre**: «¿Tu dirección está en Marianao? Envío + $250.00», con
   «Sí, es Marianao» y «No, elegir otro». Hasta que confirma, **el pedido no
   cambia y el total no se mueve** (E10). Tocar no es elegir.
8. **Confirma** [elegido]. El mapa se cierra, el campo de municipio muestra
   «Marianao», la línea del importe y el resumen se actualizan igual que en el
   paso 5, y el foco vuelve al campo de municipio.
9. **Toca fuera de la cobertura** [mapa, fuera]. No se selecciona nada, y el
   mapa dice «Esta tienda no llega ahí.» con una sola salida honesta: recoger en
   la tienda. No se ofrece ningún camino para pedir a ese punto (E11).
10. **Escribe la dirección**, confirma el pedido, y el servidor decide el importe
    de verdad (E14).

**Vueltas atrás, y qué se pierde en cada una:**

- **Domicilio → recogida.** El bloque de zona desaparece; la fila «Envío» vuelve
  a `$0.00` y el total baja. **El municipio elegido se conserva en la pantalla**
  y vuelve tal cual si se elige domicilio otra vez: es lo mismo que hoy hace
  `deliveryAddress`, y no cuesta nada. Lo que **no** pasa es que se guarde: un
  pedido cerrado como `PICKUP` no lleva zona (R21, caso límite 11).
- **Cambiar de municipio** después de haber elegido. El importe y el total se
  recalculan con el nuevo antes de confirmar (caso límite 10). No hay
  confirmación intermedia: cambiar de opción en una lista es reversible.
- **Cerrar el mapa sin confirmar.** No se pierde nada: el municipio elegido
  antes del mapa sigue elegido. Cerrar el mapa nunca borra una elección.
- **Cambiar de provincia** con un municipio ya elegido. La lista se acota, pero
  **el municipio elegido no se borra**: sigue mostrándose en el campo y en el
  total. Borrarlo por navegar sería castigar una exploración.
- **Volver al carrito y volver.** Igual que hoy: los campos de contacto se
  conservan por el mismo camino, y el municipio no. Es una recarga, y esto no
  añade persistencia nueva.

## Inventario de pantallas y estados

Una sola pantalla —`/[slug]/checkout`— y un bloque nuevo dentro de ella. Todo lo
demás de esa pantalla se queda como está.

### 0 · Dónde se injerta, exactamente

Dentro del `<fieldset>` «¿Cómo lo quieres recibir?» de
`src/features/cart/components/CheckoutForm.tsx`, entre los dos `RadioCard` y el
campo de dirección:

```
  ¿Cómo lo quieres recibir?                      ← legend, sin tocar
  [ ] Recoger en la tienda · Sin costo de envío  ← RadioCard, sin tocar
  [x] Envío a domicilio · El costo depende de tu municipio   ← descripción NUEVA
  ─────────────────────────────────────────────
  Provincia            (solo si la cobertura cruza más de una)
  Municipio a donde enviamos
  [ Escribe tu municipio                       ]
  Envío a Playa · + $300.00                     (solo con municipio elegido)
  No sé mi municipio: verlo en el mapa
  El mapa es una ayuda para ubicarte. También puedes elegirlo en la lista.
  ─────────────────────────────────────────────
  Dirección de entrega                          ← campo existente
  [                                            ]
  Calle, número y entre calles.                 ← ayuda MODIFICADA (DP3)
```

**La descripción del `RadioCard` de domicilio cambia y tiene que cambiar.** Hoy
imprime `+ ${formatMoney(store.deliveryFee)}` (líneas 772-786), que en una
tienda `ZONE_BASED` es el importe residual que **nadie fijó para ninguna zona**:
R9 lo llama, con razón, el fallo silencioso más caro que este feature puede
introducir. En `ZONE_BASED` la descripción es **«El costo depende de tu
municipio»**, sin dígitos y sin cambiar después de elegir —el importe vive en la
línea del municipio y en el resumen, y repetirlo en tres sitios es cómo se
desincronizan—. Los otros dos modos no se tocan.

### 1 · El campo de municipio

| Estado                             | Qué se ve                                                                                                                   | Qué NO pasa                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Sin elegir**                     | Etiqueta, campo vacío con `Escribe tu municipio`, ayuda `Escribe las primeras letras o ábrelo para verlos todos.`           | No hay lista abierta ni importe                          |
| **Abierto, sin escribir**          | La lista con **todas** las opciones ofrecibles, la primera resaltada                                                        | No se pide nada a la red                                 |
| **Eligiendo**                      | La lista reducida a las coincidencias, la primera resaltada, y un anuncio `4 municipios coinciden`                          | Nada se elige por escribir: hay que pulsar Enter o tocar |
| **Sin coincidencias**              | `Ningún municipio de esta tienda coincide con «regla».` y, debajo, `Ver todos` y la entrada al mapa                         | Nunca se nombra un municipio que la tienda no sirve      |
| **Elegido**                        | El campo con el nombre, y debajo `Envío a Playa · + $300.00` (o `· Envío gratis`)                                           | El total ya cambió; no hay que confirmar nada            |
| **Elegido y reabierto**            | El texto se selecciona entero al enfocar, y la opción elegida sale marcada (`aria-selected`) y a la vista                   | Editar el texto no cambia la elección                    |
| **Error de validación**            | Borde y texto en `text-danger`: `Elige el municipio a donde enviamos.`, y la entrada en el resumen de errores que ya existe | El pedido no se envía                                    |
| **Cobertura de un solo municipio** | No hay campo de búsqueda: una línea `Esta tienda solo entrega en Playa · + $300.00`, y el municipio queda elegido           | No hay mapa, no hay provincia, no hay lista              |

**Por qué un combobox y no un `<select>` nativo, escrito para que nadie lo
reabra.** Se descartaron dos alternativas más baratas, y las dos por motivos de
la spec, no de gusto:

- **`<select>` nativo** (lo que hoy usa
  `src/features/currency/components/ReferenceCurrencySelect.tsx`): su
  «escritura predictiva» es el _typeahead_ del sistema operativo, que empieza por
  el principio del nombre y **respeta las tildes**, así que «holguin» no
  encuentra «Holguín» y «hab» no encuentra «La Habana Vieja». R6 lo prohíbe con
  todas las letras, y el criterio 5 pide escritura predictiva de verdad. Además
  no puede llevar el importe al lado del nombre sin meterlo dentro de la misma
  cadena.
- **`<input list>` con `<datalist>`**: el filtro es del navegador, con la misma
  sensibilidad a tildes de R6, su presentación es distinta en cada navegador, y
  lo que sale del control es **texto libre**, no un código — que es exactamente
  lo que R4 prohíbe que decida nada.

La única forma de mantener a la vez la escritura predictiva sin tildes, el
importe al lado de cada nombre y la desambiguación de R7 es una lista propia. La
compensación está en § Coste de cliente y es pequeña.

**La lista, opción por opción.** Cada fila es `min-h-11` (44 px, área de toque),
`flex justify-between gap-3`, con el nombre a la izquierda (16 px, `text-fg`,
puede envolver) y el importe a la derecha (14 px, `text-fg-muted`, `shrink-0`).
La lista se ordena por nombre con la colación española; cuando la cobertura
cruza más de una provincia, se ordena por provincia y luego por nombre, y cada
opción gana una **segunda línea** con el nombre de su provincia (14 px,
`text-fg-muted`, +20 px de alto). Esa línea es lo que cierra R7 sin casos
especiales: en el índice hay **una** colisión real entre municipios («San Luis»,
`21.09` y `34.03`) y solo puede darse en una tienda que cruce provincias, que es
justo cuando la línea está puesta. Dentro de una misma provincia **no hay ni un
nombre repetido** —comprobado sobre `src/features/zones/zone-index.json`—, así
que en la tienda de una sola provincia la línea sobra y no se pinta.

**Cuánto mide la lista abierta.** `max-height` de 17,5 rem a 360 (unas seis
filas) y 24 rem a partir de 768, con desplazamiento interno y
`overscroll-contain` para que llegar al final no arrastre la página. Es un
desplegable posicionado sobre el contenido, no un bloque que empuje el
formulario: abrirlo y cerrarlo no puede mover el campo de dirección.

### 2 · El paso de provincia (criterio 7, R5, E6)

**Con cobertura en una sola provincia el paso no existe**: no está en el DOM, ni
deshabilitado ni oculto. C7 lo comprueba así, y un control deshabilitado sí
estaría en el DOM y en el árbol de accesibilidad.

**Con cobertura en dos o más** aparece encima del campo de municipio, como un
`<select>` nativo dentro de un `Field` (`src/components/ui/Field.tsx`), etiqueta
`Provincia`, primera opción `Todas las provincias`, y después las provincias de
la cobertura ordenadas por nombre. Aquí el nativo **sí** es la elección correcta,
y por lo mismo que no lo era arriba: son como mucho 16 opciones, se eligen por
nombre completo, no hace falta buscar y no hay importe que enseñar; el nativo da
teclado, lector de pantalla y la rueda del sistema operativo gratis.

Elegir provincia **acota la lista de municipios** y no elige nada (R3, D3). Si
hay texto escrito y ninguna coincidencia dentro de la provincia elegida pero sí
fuera, la lista lo dice y ofrece la salida: `«playa» no está en Matanzas. Ver 1
coincidencia en todas las provincias.` Sin eso, el paso pensado para acortar se
convierte en una trampa.

### 3 · El mapa

Se abre **solo al pedirlo** (E7, R14) desde un botón secundario a ancho completo
bajo el campo, con el texto `No sé mi municipio: verlo en el mapa` (`Ver el mapa`
cuando ya hay municipio elegido, porque entonces sirve para comprobar y no para
decidir). Debajo del botón, siempre visible, la frase que la accesibilidad
exige: `El mapa es una ayuda para ubicarte. También puedes elegir tu municipio
en la lista.`

| Estado                        | Qué se ve                                                                                                                                                                                                | Salida                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Cerrado**                   | Solo el botón y su frase                                                                                                                                                                                 | —                                                        |
| **Abriéndose**                | El contenedor ya con su alto final, fondo `bg-surface-muted`, y `Cargando el mapa…` centrado. En una conexión lenta, a los 3 s: `Sigue cargando. Mientras tanto puedes elegir tu municipio en la lista.` | `Cancelar` cierra y no deja nada a medias                |
| **Abierto**                   | Los polígonos de la cobertura sobre las teselas, la atribución abajo a la derecha, el control de acercar/alejar, y `Toca el municipio donde vives.`                                                      | `Cerrar el mapa`                                         |
| **Tocado**                    | La zona tocada resaltada y la barra de confirmación con el nombre y el importe                                                                                                                           | `Sí, es X` · `No, elegir otro`                           |
| **Fuera de cobertura**        | Nada seleccionado y, en la misma barra, `Esta tienda no llega ahí. Solo entrega en los municipios pintados.`                                                                                             | Se puede seguir tocando, o cerrar y recoger en la tienda |
| **Teselas caídas**            | Los polígonos sobre `bg-surface-muted`, tocables igual, y una nota discreta: `El fondo del mapa no cargó, pero los municipios se pueden tocar igual.`                                                    | Elegir **no** depende de las teselas (caso límite 15)    |
| **Error al cargar**           | `No pudimos cargar el mapa. Elige tu municipio en la lista de arriba.` con `Reintentar`                                                                                                                  | El pedido nunca se bloquea por esto                      |
| **Sin geometría de una zona** | La zona sin polígono **no se puede tocar**, y el mapa no finge: la lista la sigue teniendo. Es el desalineamiento del caso límite 16 y lo caza la generación, no la pantalla                             | —                                                        |

**La confirmación es una barra de texto, no un globo sobre el mapa** (E10). Va
**debajo** del mapa —fija al fondo de la hoja a 360, en el flujo a partir de
768— por una razón física: en un teléfono el dedo y su sombra tapan justo el
punto que se acaba de tocar, y un globo encima del punto sería ilegible la mitad
de las veces. Contiene, en este orden: el nombre en 16 px/600, el importe
(`+ $300.00` o `Envío gratis`), y los dos botones. Mientras esa barra está
abierta, **el municipio del pedido no ha cambiado**: el resumen y el total están
exactamente como estaban.

**La atribución** (D2, R18, E12) vive **dentro** del área del mapa, abajo a la
derecha, sobre una tira `bg-surface/90` con `text-fg-muted` a 12 px, y el texto
completo cabe en una línea incluso a 360 (medido: 207 px). No hay ningún control
que la oculte, ni se pliega, ni se abrevia a un icono. Con el proveedor
alternativo configurado, en su sitio va la atribución de esa variable, con la
misma forma y en el mismo lugar.

**El mapa no tiene pin, ni «usar mi ubicación», ni buscador de calles** (D7). El
único gesto que significa algo es tocar dentro de una zona pintada.

### 4 · El resumen y el total (criterio 2)

Se toca **solo** lo que la fila «Envío» dice, y solo cuando el modo es
`ZONE_BASED` y la modalidad es domicilio. `src/features/cart/components/OrderSummary.tsx`
no cambia de contrato: su `deliveryFeeLabel` ya acepta una cadena.

| Situación                            | Fila «Envío»             | Bloque del total                   |
| ------------------------------------ | ------------------------ | ---------------------------------- |
| Cotización cargando                  | `Calculando…`            | `Total` · `Calculando…` — como hoy |
| Recogida                             | `$0.00`                  | `Total` — como hoy                 |
| Domicilio, sin municipio elegido     | **`Elige tu municipio`** | `Total` con subtotal − descuento   |
| Domicilio, municipio con importe     | `$300.00`                | `Total` con el envío incluido      |
| Domicilio, municipio con importe `0` | **`Gratis`**             | `Total` sin cambio                 |
| La tienda no ofrece domicilio        | fila oculta              | `Total` — como hoy                 |

Nunca aparece `Total parcial` ni «más el envío por confirmar»: ese léxico es de
`QUOTED_PER_ORDER` y en `ZONE_BASED` sería falso (R11, y los dos modos son
excluyentes). El bloque ya es `aria-live="polite"`, así que el cambio de importe
se anuncia solo: **no** se pasa un `announcement` adicional, por lo mismo que
razonó `.agent/specs/F-031/design.md`.

### 5 · La tienda que no sirve ninguna zona (criterio 9, E20)

**No es un domicilio deshabilitado con un mensaje: la opción no está.** El
`RadioCard` «Envío a domicilio» no se pinta, el bloque de zona no existe, la
fila «Envío» del resumen desaparece —`deliveryFeeLabel` en `undefined`, que ya
es lo que hoy hace `CheckoutForm.tsx`— y el comprador ve la pantalla de una
tienda que solo entrega en el mostrador. No hay explicación, porque no hay nada
que explicar: una tienda que no llega a tu casa no le debe un párrafo a nadie, y
un párrafo del tipo «no hay zonas configuradas» sería jerga nuestra en la cara
de un comprador.

Con **una sola** modalidad, el `<fieldset>` sigue pintándose con su único
`RadioCard` marcado, como hoy.

### 6 · Los tres errores del envío al confirmar

Los tres usan `src/components/ui/Alert.tsx` en el mismo sitio donde ya viven los
del checkout (líneas 593-648), y los tres dicen **que no se creó ningún pedido**,
que es la frase que esta pantalla ya usa y en la que el comprador confía.

| Caso                                                            | Tono      | Qué se ve                                                                                                                                | Qué queda en pantalla                                                                                     |
| --------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **El importe del envío cambió** (E15, `409`)                    | `warning` | `El costo del envío cambió mientras hacías el pedido.` · `Playa: antes $300.00, ahora $350.00` · `No se creó ningún pedido.`             | El total se repinta con el nuevo y el botón dice `Confirmar con el total nuevo` — el camino que ya existe |
| **La zona dejó de servirse** (E16, error propio)                | `danger`  | `Esta tienda ya no hace envíos a Playa.` · `No se creó ningún pedido. Elige otro municipio o recógelo en la tienda.` · `Volver a cargar` | El municipio se **deselecciona**, el foco va al campo, el total vuelve a subtotal − descuento             |
| **Falta el municipio** (E17; la pantalla no debería llegar ahí) | `danger`  | El error de validación del propio campo, no una alerta: `Elige el municipio a donde enviamos.`                                           | Se enfoca el resumen de errores, como hoy                                                                 |

**No se degrada a recogida en silencio, nunca** (E16). Cambiar el `RadioCard`
por el comprador sería convertirle un pedido a domicilio en uno de mostrador sin
decírselo, que es exactamente lo que la spec prohíbe. La pantalla deja la
modalidad como está y le devuelve la decisión.

Si el error llega porque la tienda **se quedó sin ninguna zona** (mismo error,
caso límite 4), `Volver a cargar` es la salida honesta: la recarga ya no ofrece
domicilio, por § 5.

### 7 · Sin JavaScript (criterio 8, D1, E24)

El `<noscript>` que ya existe (línea 520) **no se toca**: dice «Para armar un
pedido necesitas activar JavaScript» y eso cubre el criterio, tal como anota I8.
Lo que este diseño añade es un `<noscript>` **propio del bloque de zona**, de una
frase, para que el campo muerto no parezca vivo:

`Para elegir el municipio y ver el costo del envío hace falta JavaScript.`

Con el JavaScript apagado, la lista de opciones **está en el HTML** —es lo que
cuenta el criterio 1— pero cerrada, así que no hay un formulario de zona que
parezca funcionar y muera al final. Y el botón de confirmar no es operable, que
es lo que la etapa `visual` comprueba con `javaScriptEnabled: false`.

### 8 · Los estados aburridos, que son los que se olvidan

- **Cotización cargando y bloque de zona ya usable.** Se puede elegir municipio
  antes de que la cotización vuelva. La fila «Envío» dice `Calculando…` y el
  importe elegido aparece en cuanto hay total con el que sumarlo. Nada se
  bloquea esperando.
- **Cotización en error** (`quoteState === "error"`). El bloque de zona sigue
  visible y usable, pero el pedido no se puede enviar: eso ya lo gobierna la
  pantalla de hoy y no cambia.
- **Tienda cerrada mientras se elegía.** Manda el camino que ya existe; el
  bloque de zona no añade nada.
- **Carrito vacío.** No hay checkout, y por tanto no hay bloque de zona.
- **Cobertura muy grande** (caso límite 9). La lista de 168 con su línea de
  provincia mide 60 px por fila: con el `max-height` y el desplazamiento
  interno, se ve igual que una de cuatro. No se recorta la cobertura.
- **Pulsar dos veces la entrada al mapa.** El segundo toque no dispara una
  segunda descarga: mientras carga, el botón queda `aria-busy` y sin efecto.

## Estructura por breakpoint

| Zona                  | 360px (col. 328)                                                                                                                  | 768px (col. 720)                                               | 1280px (col. 720 + resumen 352)                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bloque de zona        | Apilado, ancho completo, dentro del `<fieldset>`                                                                                  | Igual, ancho completo                                          | Igual; el resumen sigue `sticky` a la derecha                                                 |
| Provincia + municipio | Apilados, uno debajo del otro                                                                                                     | En dos columnas (`sm:grid-cols-2`), como nombre y teléfono hoy | Igual que 768                                                                                 |
| Lista desplegable     | Superpuesta bajo el campo, ancho del campo, `max-h` 17,5 rem, desplazamiento interno                                              | Igual, `max-h` 24 rem                                          | Igual que 768                                                                                 |
| Fila de opción        | 44 px; 60 px con línea de provincia; envuelve solo con nombre largo + «Envío gratis»                                              | 44/60 px, nunca envuelve                                       | Igual que 768                                                                                 |
| Entrada al mapa       | Botón secundario a ancho completo (el texto mide 281 y caben 296)                                                                 | Botón alineado a la izquierda, ancho por contenido             | Igual que 768                                                                                 |
| **El mapa**           | **Hoja a pantalla completa** (`100dvh`): barra superior de 56 px con título y `Cerrar`, mapa en el resto, confirmación fija abajo | **Panel en línea** bajo el campo, alto 24 rem                  | Panel en línea, alto 28 rem                                                                   |
| Barra de confirmación | Fija al fondo de la hoja, botones **apilados** a ancho completo (medido: no caben en fila)                                        | En el flujo, bajo el mapa, botones **en fila**                 | Igual que 768                                                                                 |
| Atribución de OSM     | Dentro del mapa, abajo a la derecha, una línea de 12 px                                                                           | Igual                                                          | Igual                                                                                         |
| Resumen y total       | Debajo del formulario, como hoy                                                                                                   | Debajo, como hoy                                               | `sticky` a la derecha; abrir el mapa alarga la columna izquierda y el resumen se queda arriba |

**Por qué a 360 el mapa es una hoja y no un panel en línea.** Tres razones
medidas o mecánicas: (a) un mapa en línea de 24 rem dentro de un documento que
ya mide 1 279 px obliga a desplazarse para ver el mapa y la confirmación a la
vez; (b) Leaflet captura el arrastre táctil, así que un mapa embebido en una
página larga secuestra el gesto de desplazar —el usuario intenta bajar y hace
_pan_—; (c) el teclado virtual: si el campo tenía el foco, el teclado ocupa
cerca de un tercio del alto y dejaría el mapa en una franja inútil. Por eso,
**abrir el mapa quita el foco del campo primero** (y con él el teclado) y luego
abre la hoja. A partir de 768 nada de esto aplica y el panel en línea es mejor,
porque deja ver la lista y el mapa a la vez.

## Componentes de UI

**Se reutilizan, sin tocarlos:**

| Componente                                      | Para qué aquí                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/ui/Field.tsx`                   | Etiqueta, ayuda, error, `aria-describedby` y `aria-invalid` del campo de municipio y del `<select>` de provincia. Su `children` es un _render prop_, así que acepta un combobox igual que acepta un `<input>` |
| `src/components/ui/RadioCard.tsx`               | Los dos de modalidad, sin cambios de código: solo cambia la cadena de `description` que le pasa el checkout                                                                                                   |
| `src/components/ui/Button.tsx`                  | Entrada al mapa (`secondary`), `Sí, es X` (`primary`), `No, elegir otro` (`ghost`), `Reintentar`, `Cerrar el mapa`                                                                                            |
| `src/components/ui/Alert.tsx`                   | Los dos errores de envío; su `tone` ya reparte `role="alert"` y `role="status"`                                                                                                                               |
| `src/features/cart/components/OrderSummary.tsx` | La fila «Envío» y el total, **sin cambiar su contrato**: `deliveryFeeLabel` ya acepta cualquier cadena                                                                                                        |

**Hacen falta nuevos, y por qué no alcanza con lo que hay.** Nombres propuestos;
el definitivo es del implementador. Todos **por crear**:

1. src/features/zones/components/ZonePicker.tsx (por crear) — el bloque entero:
   provincia condicional, campo de municipio, línea del importe, entrada al mapa
   y el `<noscript>` propio. Es quien conoce el estado «municipio elegido» y se
   lo devuelve al checkout. Cliente, y lo justifica § Coste de cliente.
2. src/features/zones/components/ZoneCombobox.tsx (por crear) — el combobox
   accesible. No existe nada parecido en `src/components/ui/`: el único selector
   del repositorio es un `<select>` nativo. **No** se pone en
   `src/components/ui/` todavía, porque este sabe de provincias, importes y
   colisiones de nombre, y un primitivo que sabe del dominio deja de serlo; si
   aparece un segundo combobox, ese es el momento de subirlo.
3. src/features/zones/components/ZoneMapPanel.tsx (por crear) — la hoja a 360 y
   el panel a partir de 768, con los estados de carga, error y teselas caídas, la
   barra de confirmación y la atribución. **Es lo que se importa bajo demanda**,
   y lo que garantiza que no baje ni un byte de mapa antes de pedirlo.
4. src/features/zones/components/ZoneMap.tsx (por crear) — solo Leaflet: teselas,
   polígonos, resaltado y el evento de toque. Lo carga el panel.
5. Un ayudante puro para plegar tildes y mayúsculas (R6), del estilo de
   src/lib/textFold.ts (por crear). El precedente exacto de la técnica está en
   `src/lib/slug.ts:49` (`normalize("NFD")`), pero **no se reutiliza `slug()`**:
   un slug también cambia espacios por guiones y recorta, y buscar «san jose»
   dejaría de encontrar «San José de las Lajas».
6. Las cadenas y los números de este documento que se repiten —el `max-height`
   de la lista, la etiqueta del campo, los textos del mapa— van a
   src/constants/zones.ts (por crear) o al que decida el implementador dentro de
   `src/constants/`, por AGENTS.md § Prohibiciones (magic strings y números).

## Tokens y tema

**Todo sale de `src/theme/tokens.css` y nada se escribe a mano.** El bloque de
zona usa exactamente la paleta que el checkout ya usa: `bg-surface` y
`bg-surface-muted` para superficies, `border-border`, `text-fg` y `text-fg-muted`
para texto, `text-danger` para el error del campo, y `brand` para lo elegido:
la opción resaltada es `bg-brand/8` con `text-fg` —nunca `text-brand` sobre
`bg-brand`, que dependería de dos tokens que una tienda puede redefinir a la
vez— y el foco visible es el mismo `focus-visible:outline-brand outline-2
outline-offset-2` de `src/components/ui/Button.tsx`.

**Los polígonos del mapa también son tokens, y esto es lo que hay que hacer
bien.** Leaflet pinta rutas SVG y su API acepta colores como **cadenas de
JavaScript**: escribirlas ahí mataría el rebranding por tienda, porque un
literal no pasa por `var(--color-brand)` y `scripts/check-theme-tokens.mjs`
existe justo por ese error. Los polígonos se pintan con la opción `className` de
Leaflet y utilidades de Tailwind, que en la versión 4 sí generan
`fill: var(--color-brand)`:

| Estado del polígono   | Utilidades                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| Servido, en reposo    | `fill-brand/15 stroke-brand` con trazo de 1,5 px                          |
| Bajo el cursor        | `fill-brand/25`                                                           |
| Tocado, sin confirmar | `fill-brand/35 stroke-brand` con trazo de 3 px                            |
| Ya elegido            | `fill-brand/35` y un contorno interior de 1 px en `stroke-brand-contrast` |

Ese contorno en `--color-brand-contrast` no es adorno: una tienda puede
redefinir `--color-brand` a un amarillo claro que sobre las teselas de OSM no se
distinga, y `brand-contrast` es el token que **por definición** contrasta con
`brand`. Se recomienda al implementador añadir `fill-brand` a la lista
`OVERRIDABLE` de `scripts/check-theme-tokens.mjs` con la declaración
`fill: var(--color-brand)`, para que el mapa quede protegido por el mismo
guardián que el resto.

**La hoja de estilos de Leaflet trae su propia estética y no la nuestra.** Se
importa **junto al componente del mapa**, nunca en `src/app/globals.css`, para
que las páginas de catálogo no paguen ni un byte por ella; y sobre ella se
redefinen tres cosas con tokens: el fondo de `.leaflet-container` a
`var(--color-surface-muted)` —que es lo que se ve cuando las teselas no
cargan—, la tira de atribución a `bg-surface/90` con `text-fg-muted`, y los
botones de acercar/alejar a `bg-surface text-fg border-border` **y a 44 px**,
porque los 30 px de Leaflet están por debajo del área de toque mínima del repo.

**Modo oscuro.** Las teselas de OSM son claras y **se quedan claras**: no se les
aplica ningún filtro de inversión, que encarece el pintado en un teléfono
barato y hace ilegibles los rótulos del propio mapa. Lo que se adapta es el
marco: la tarjeta, la barra de confirmación y la tira de atribución salen de
`surface`/`fg`, que ya se redefinen en el bloque `prefers-color-scheme: dark` de
`src/theme/tokens.css`. Un mapa claro dentro de una página oscura es lo que hace
todo el mundo y se lee bien; una inversión mal hecha, no.

**Movimiento.** La apertura del panel y de la hoja usan opacidad y
desplazamiento; la regla global de `src/app/globals.css` para
`prefers-reduced-motion` ya las reduce a 0,01 ms sin que haya que hacer nada.

## Accesibilidad

**Orden de foco dentro del bloque**, y es el orden visual: `Recoger` → `Envío a
domicilio` → [`Provincia`] → `Municipio a donde enviamos` → `No sé mi
municipio: verlo en el mapa` → `Dirección de entrega`. La lista desplegable
**no** entra en el orden de tabulación: se recorre con las flechas desde el
campo, que es el patrón de combobox y lo que evita que tabular te meta en 168
paradas.

**El combobox, con nombres concretos** (patrón ARIA 1.2): el `<input>` lleva
`role="combobox"`, `aria-expanded`, `aria-controls` apuntando a la lista,
`aria-autocomplete="list"` y `aria-activedescendant` con el `id` de la opción
resaltada; la lista es `role="listbox"` con `aria-label` «Municipios a los que
llega esta tienda»; cada fila es `role="option"` con `aria-selected`. El
`Field` de `src/components/ui/Field.tsx` ya cablea `id`, `aria-describedby` y
`aria-invalid`.

**Teclado, tecla por tecla:**

| Tecla         | Qué hace                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- |
| Flecha abajo  | Abre la lista si está cerrada; si no, baja una opción, y en la última vuelve a la primera |
| Flecha arriba | Sube una opción, y en la primera va a la última                                           |
| Inicio / Fin  | Primera / última opción                                                                   |
| Escribir      | Filtra y resalta la primera coincidencia. **No elige nada por sí solo** (R4)              |
| Enter         | Elige la opción resaltada y cierra. Con la lista cerrada, no envía el formulario          |
| Escape        | Cierra la lista y **devuelve el texto al del municipio elegido**, o lo vacía si no hay    |
| Tab           | Cierra la lista conservando lo que ya estaba elegido, sin elegir la resaltada             |

**El texto del campo nunca es el valor.** Lo que sale del control es el
**código** (R4); al perder el foco, el texto vuelve al nombre del municipio
elegido, o se vacía. Así no puede quedar «play» escrito con «Playa» elegida, ni
«Marianao» escrito sin nada elegido.

**Lo que se anuncia, y lo que no.** Una sola región `aria-live="polite"` de
`sr-only` en el bloque, para el resultado del filtrado: «4 municipios coinciden»
/ «Ningún municipio coincide». El **importe** no se anuncia desde aquí: el
resumen ya es `aria-live="polite"` y anunciarlo dos veces es peor que no
anunciarlo. Y la región arranca **vacía**: nada se anuncia al cargar, que es la
lección que `src/features/currency/components/ReferenceCurrencySelect.tsx` ya
dejó escrita en su comentario.

**El mapa, y su alternativa dicha en la pantalla.** El lienzo de Leaflet es una
imagen interactiva que no se puede recorrer con un lector de pantalla de forma
razonable, así que **no se finge**: el lienzo va `aria-hidden` y fuera del orden
de tabulación, y la alternativa equivalente es la lista, **escrita en la
pantalla** bajo la entrada al mapa —«También puedes elegir tu municipio en la
lista»— y no solo en este documento. Lo que **sí** es accesible es todo lo
demás del panel: el título, el botón de cerrar, la barra de confirmación (que es
texto y dos botones) y los controles de acercar/alejar.

**El panel del mapa, según el ancho.** A 360 es `role="dialog"` con
`aria-modal="true"` y `aria-labelledby` en su título; atrapa el foco, Escape
cierra, y el desplazamiento del documento de detrás se bloquea mientras está
abierto. A partir de 768 es una región con `role="group"` y `aria-label`, sin
trampa de foco, porque no tapa nada.

**Movimiento del foco, y cómo se implementa sin romper ESLint.** Abrir el mapa
lleva el foco al título del panel; cerrarlo lo devuelve al botón que lo abrió;
confirmar una zona cierra y lo lleva al campo de municipio, que ya muestra el
nombre nuevo. Las tres son **intenciones de una sola vez**: se guardan en un
`useRef`, se ponen a `true` en el manejador y **se consumen** en el efecto, que
es lo que AGENTS.md § Prohibiciones exige; ni `setState` dentro del efecto ni un
`setTimeout(…, 0)` que calle el lint.

**Área de toque:** 44 px en las filas de la lista, en los botones, en el
`<select>` de provincia y en los controles del mapa (que hay que agrandar a
mano). **Contraste:** el texto secundario de una opción es `text-fg-muted` sobre
`bg-surface`, que es la pareja que ya usa todo el checkout; la opción resaltada
mantiene `text-fg` para que su legibilidad no dependa del color de marca de la
tienda.

## Coste de cliente

**Qué lleva `"use client"` y por qué está permitido.** El bloque de zona vive
dentro de `src/features/cart/components/CheckoutForm.tsx`, que es una isla de
cliente desde F-010 (`"use client"` en su línea 1). Los componentes nuevos
tienen **estado** (el municipio elegido, el texto tecleado, el mapa abierto) y
**eventos** (escribir, elegir, tocar el mapa): no son «`"use client"` sin estado
ni eventos». Y **no renderizan catálogo**: la prohibición de AGENTS.md protege
que la tienda se lea sin esperar el JavaScript, y aquí ni el catálogo de
productos ni las páginas que lo pintan tocan nada de esto.

**La lista se pinta en el servidor y el JavaScript solo filtra lo que ya está**
(D5). El navegador recibe los municipios **de esta sucursal**, con su nombre y
su importe, que es lo que R25 autoriza explícitamente; lo que **no** entra en
ninguna parte es un importador de `src/features/zones/catalog.ts` o de
`src/features/zones/zone-index.json` en un árbol de cliente, así que la lista
blanca de `src/features/zones/boundaries.test.ts` no se relaja (E25, C15).
Medido más arriba: **443 bytes gzip** en el caso cubano común, 4,7 KB en el
disparate de servir el país entero.

**Lo que este diseño añade a la primera carga del checkout:**

| Pieza                                              | Coste                                             | Cuándo baja           |
| -------------------------------------------------- | ------------------------------------------------- | --------------------- |
| Opciones en la respuesta (4 / 15 / 168 municipios) | 0,43 / 0,75 / 4,7 KB gzip **medidos**             | Siempre               |
| El combobox y el bloque, código de cliente         | estimado por debajo de 3 KB gzip                  | Siempre               |
| El plegado de tildes                               | estimado por debajo de 0,3 KB gzip                | Siempre               |
| Leaflet 1.9.4                                      | ≈ 42 KB gzip, **cifra publicada**                 | Solo al abrir el mapa |
| react-leaflet 5.0.0                                | ≈ 5 KB gzip, **cifra publicada**                  | Solo al abrir el mapa |
| La hoja de estilos de Leaflet                      | ≈ 1,5 KB gzip, **cifra publicada**                | Solo al abrir el mapa |
| El panel y el mapa propios                         | estimado por debajo de 3 KB gzip                  | Solo al abrir el mapa |
| La geometría de la cobertura                       | objetivo por debajo de 1 MB (R27), del arquitecto | Solo al abrir el mapa |

Las cifras marcadas como publicadas **no se midieron aquí**: Leaflet no está
instalado en este árbol y el diseñador no instala dependencias. El criterio 11
obliga a medirlas de verdad con la tabla de rutas de `npm run build` y a
anotarlas en `.agent/progress/F-042.md`.

**Tres reglas de coste que este diseño impone y son comprobables:**

1. **Nada del mapa se descarga antes de pedirlo** (E7, C5, R14): ni su
   JavaScript, ni la hoja de estilos, ni la geometría, ni una tesela. Eso
   incluye no dejar que nada lo **preargue**: sin `link rel="preload"` ni
   `prefetch` del trozo del mapa, porque C5 cuenta **todas** las peticiones de
   la sesión.
2. **Escribir no pide nada** (E3, C5). El filtrado es local sobre lo que ya
   está en la página. No hay _debounce_ que valga: no hay red que retrasar.
3. **El trozo del mapa no puede acabar referenciado por ninguna página de
   catálogo.** `scripts/check-bundle-budget.mjs` **no** mide el checkout —es
   `force-dynamic` y no prerenderiza, I1— pero sí mide las páginas que
   prerenderizan, y ahí es donde ese guardián sigue sirviendo.

**Sobre el presupuesto de 193 KB:** AGENTS.md es explícito en que no es un muro.
Si el número tiene que subir, se sube con quién, por qué y la medición en el
comentario de `scripts/check-bundle-budget.mjs`. Lo que **no** se hace es
recortar el mapa o el selector para salvar kilobytes (R26).

## Textos

Microcopy exacto, en español. Lo que no está aquí, no se inventa al programar.

**El bloque de zona**

| Elemento                                  | Texto                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Descripción del `RadioCard` de domicilio  | `El costo depende de tu municipio`                                             |
| Etiqueta del paso de provincia            | `Provincia`                                                                    |
| Primera opción del paso de provincia      | `Todas las provincias`                                                         |
| Etiqueta del campo                        | `Municipio a donde enviamos`                                                   |
| Texto de relleno del campo                | `Escribe tu municipio`                                                         |
| Ayuda del campo                           | `Escribe las primeras letras o ábrelo para verlos todos.`                      |
| Importe en una opción                     | `+ $300.00` · con importe cero, `Envío gratis`                                 |
| Línea del municipio elegido               | `Envío a Playa · + $300.00` · con importe cero, `Envío a Playa · Envío gratis` |
| Cobertura de un solo municipio            | `Esta tienda solo entrega en Playa · + $300.00`                                |
| Anuncio del filtrado (solo lector)        | `4 municipios coinciden` · `1 municipio coincide`                              |
| Sin coincidencias                         | `Ningún municipio de esta tienda coincide con «regla».`                        |
| Salida del vacío                          | `Ver todos`                                                                    |
| Con provincia puesta y coincidencia fuera | `«playa» no está en Matanzas. Ver 1 coincidencia en todas las provincias.`     |
| Error de validación                       | `Elige el municipio a donde enviamos.`                                         |
| Etiqueta en el resumen de errores         | `Municipio`                                                                    |
| `<noscript>` del bloque                   | `Para elegir el municipio y ver el costo del envío hace falta JavaScript.`     |

**El mapa**

| Elemento                                 | Texto                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Entrada, sin municipio elegido           | `No sé mi municipio: verlo en el mapa`                                                |
| Entrada, con municipio elegido           | `Ver el mapa`                                                                         |
| Frase de la alternativa, siempre visible | `El mapa es una ayuda para ubicarte. También puedes elegir tu municipio en la lista.` |
| Título de la hoja / del panel            | `Elige tu municipio en el mapa`                                                       |
| Instrucción sobre el mapa                | `Toca el municipio donde vives.`                                                      |
| Cargando                                 | `Cargando el mapa…`                                                                   |
| Cargando, pasados 3 s                    | `Sigue cargando. Mientras tanto puedes elegir tu municipio en la lista.`              |
| Cancelar la carga                        | `Cancelar`                                                                            |
| Error al cargar                          | `No pudimos cargar el mapa. Elige tu municipio en la lista de arriba.` + `Reintentar` |
| Teselas caídas                           | `El fondo del mapa no cargó, pero los municipios se pueden tocar igual.`              |
| Pregunta de confirmación                 | `¿Tu dirección está en Marianao?`                                                     |
| Importe bajo la pregunta                 | `Envío + $250.00` · con importe cero, `Envío gratis`                                  |
| Botón de aceptar                         | `Sí, es Marianao`                                                                     |
| Botón de rechazar                        | `No, elegir otro`                                                                     |
| Fuera de la cobertura                    | `Esta tienda no llega ahí. Solo entrega en los municipios pintados.`                  |
| Salida honesta desde ahí                 | `Puedes recogerlo en la tienda.`                                                      |
| Cerrar                                   | `Cerrar el mapa`                                                                      |
| Atribución por defecto                   | `© colaboradores de OpenStreetMap`                                                    |

**El resumen y los errores**

| Elemento                           | Texto                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Fila «Envío», sin municipio        | `Elige tu municipio`                                                                                                         |
| Fila «Envío», importe cero         | `Gratis`                                                                                                                     |
| Ayuda del campo de dirección (DP3) | `Calle, número y entre calles.`                                                                                              |
| Alerta, el envío cambió            | `El costo del envío cambió mientras hacías el pedido.` / `Playa: antes $300.00, ahora $350.00` / `No se creó ningún pedido.` |
| Alerta, la zona dejó de servirse   | `Esta tienda ya no hace envíos a Playa.` / `No se creó ningún pedido. Elige otro municipio o recógelo en la tienda.`         |
| Enlace de recarga en esa alerta    | `Volver a cargar`                                                                                                            |

**Lo que ninguna pantalla dice nunca:** «zona», «tarifario», «no servida»,
«cotizar», «por confirmar» (en `ZONE_BASED`), «$0.00» como importe de un envío
gratis, ni el nombre de un municipio que esta tienda no sirve.

## Lo que este diseño le exige al arquitecto

Cuatro cosas, y las cuatro son necesidades de pantalla, no preferencias de
forma. Cómo se transportan es suyo.

1. **Las opciones tienen que estar en el HTML de la primera respuesta, sin
   depender de la cotización.** Medido arriba: hoy el `<fieldset>` de modalidad
   no aparece en el `curl` porque cuelga de `quoteState === "ready"`. El
   criterio 1 se comprueba contando municipios en ese HTML. Si la lista sigue
   colgando de un `fetch` de cliente, C1 no se puede verificar como está escrito
   y el bloque parpadea en cada carga.
2. **Cada opción necesita cuatro datos**: el código, el nombre verbatim del
   catálogo, la provincia (para ordenar y para la línea de desambiguación de R7)
   y **su importe ya resuelto** como cadena de dos decimales. El importe se
   resuelve en el servidor con la misma función que cobra (R8): la pantalla no
   calcula tarifas. Y **`0.00` tiene que llegar como `0.00`**, no como ausencia:
   la pantalla distingue «gratis» de «sin importe» comparando contra `null`,
   nunca con un `if (!fee)` (R10).
3. **El error de «esa zona ya no se sirve» tiene que ser distinguible** de
   `PRICE_CHANGED` y de «falta la zona», porque son tres mensajes distintos en
   pantalla. No hace falta que el servidor mande el nombre: la pantalla ya sabe
   cuál mostró. Y para el mensaje del `409`, la pantalla necesita poder decir
   «antes 300, ahora 350»: el importe viejo es suyo y el nuevo tiene que venir
   en la respuesta.
4. **La geometría tiene que poder pintarse sin las teselas** y cada polígono
   tiene que traer su código, porque tocar un polígono es exactamente elegir la
   opción de la lista con ese código. Solo llegan las zonas ofrecibles (E8, R13);
   la pantalla no filtra geometría que no debería haber recibido.

Y una que es del implementador: **`isDeliveryOffered` no puede consultar la base
desde el árbol de cliente** (I4). Este diseño no necesita saber cómo se le pasa
el hecho ya resuelto; solo necesita que el bloque sepa, en servidor, si esta
tienda ofrece domicilio.

## Verificación visual

Con la app levantada y `bash .agent/verify.sh F-042 --visual`, sobre cuatro
fixtures: **(A)** cobertura de 4 municipios de `23`; **(B)** provincia `23` con
`FEE 300` y `23.05` con `NOT_SERVED`; **(C)** cobertura en `23` y `22`;
**(D)** tarifario que no hace resoluble ninguna zona.

| Qué mirar                                                                                                      | Viewport     | Fixture |
| -------------------------------------------------------------------------------------------------------------- | ------------ | ------- |
| El bloque de zona está en el HTML de `curl`, con los 14 municipios y **sin** `23.05` ni «Regla»                | —            | B       |
| Escribir `pla` deja «Playa» y «Plaza de la Revolución»; escribir `regla` no ofrece nada                        | 360          | B       |
| Escribir `holguin` encuentra «Holguín» y `hab` encuentra «La Habana Vieja»                                     | 360          | C       |
| Elegir «Playa»: `+ $300.00` en pantalla y el total = subtotal − descuento + 300, sin haber enviado nada        | 360 / 1280   | A       |
| Un municipio con `FEE 0`: dice `Envío gratis`, la fila del resumen dice `Gratis` y el total no cambia          | 360          | A       |
| No hay paso de provincia; con la cobertura C sí lo hay y elegir `22` deja solo municipios de `22`              | 360          | A y C   |
| Ninguna petición de geometría, teselas ni del trozo del mapa hasta pulsar la entrada al mapa                   | 360          | A       |
| Con el mapa abierto: la atribución se ve **sin desplegar nada**, en una línea, y no hay control que la esconda | 360          | A       |
| Tocar una zona escribe el nombre y **el total no se mueve** hasta confirmar                                    | 360          | A       |
| Tocar fuera no selecciona nada y lo dice                                                                       | 768          | A       |
| El mapa a 360 es hoja completa con la confirmación abajo y los botones apilados; a 768 es panel en línea       | 360 / 768    | A       |
| Con las teselas bloqueadas, los polígonos siguen pintados y tocables                                           | 360          | A       |
| Sin JavaScript: se ve el `<noscript>`, no hay control de envío operable y la lista no parece funcionar         | 360          | B       |
| Sin ninguna zona resoluble: no hay `RadioCard` de domicilio, ni bloque, ni fila de «Envío»                     | 360          | D       |
| Recorrido completo con teclado, sin ratón: modalidad, provincia, municipio, dirección y confirmar              | 1280         | C       |
| Modo oscuro: el marco del mapa, la barra de confirmación y la atribución se leen                               | 360          | A       |
| Sin desplazamiento horizontal en ninguno de los tres anchos, con la lista abierta y con el mapa abierto        | 360/768/1280 | C       |

## Preguntas al humano

Tres, y ninguna bloquea empezar: las tres tienen una opción recomendada que ya
está escrita en el documento. Bloquean la firma del plan, que es donde toca
cerrarlas.

**DP1 — ¿el importe de cada municipio se ve en la lista, antes de elegirlo?**
Este diseño lo muestra: cada opción lleva su `+ $300.00`. A favor:
transparencia, y el comprador que duda entre dos municipios ve la diferencia
antes de comprometerse, que es la mitad del problema que el mapa vino a
resolver. En contra, y es real: enseñar que el municipio de al lado cuesta la
mitad **invita a mentir**, y quien miente se queda sin pedido cuando el
mensajero llega. Opciones: **(a)** el importe en cada opción **[recomendada]**;
**(b)** el importe solo al elegir, y la lista con nombres a secas.
Recomendación (a): el importe se va a ver igual en cuanto pruebe dos opciones,
así que esconderlo no evita el incentivo, solo hace el primer intento más lento.

**DP2 — cobertura de un solo municipio: ¿elegido de entrada o hay que
marcarlo?** Este diseño lo da por elegido y lo declara («Esta tienda solo
entrega en Playa · + $300.00»), con el importe ya en el total. Opciones:
**(a)** elegido de entrada **[recomendada]**; **(b)** un `RadioCard` que hay que
marcar. Recomendación (a): elegir «Envío a domicilio» en una tienda que solo
llega a un municipio **ya es** el acto explícito, y (b) añade un toque a la
inmensa mayoría de los pedidos del caso cubano común. Lo que (b) protegería
—que alguien de Marianao no crea que le llegan— está cubierto porque el nombre
se dice en la línea y en el resumen. Va como pregunta porque cambia la fricción
de todos los pedidos del negocio pequeño, y eso es suyo.

**DP3 — la ayuda del campo de dirección deja de pedir el municipio.** Hoy dice
«Calle, número, entre calles y municipio.»; con este bloque el municipio ya se
eligió arriba y pedirlo dos veces es ruido. Opciones: **(a)** cambiarla a
«Calle, número y entre calles.» **[recomendada]**; **(b)** dejarla como está,
conservando la redundancia para el mensajero. Recomendación (a): el municipio
viaja en el pedido como código **y** como nombre, así que el mensajero lo tiene
igual, y una redundancia que el comprador puede contradecir («Playa» arriba y
«Marianao» escrito abajo) es una fuente de conflicto sin dueño. Es la única
cadena del checkout existente que este diseño toca, y por eso se pregunta.
