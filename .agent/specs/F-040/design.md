---
feature: F-040
agente: sdd-designer
actualizado: 2026-09-10T18:41:44Z
estado: listo
---

> Escrito **en paralelo** con `.agent/specs/F-040/architecture.md`, que en el
> momento de cerrar esto seguía en plantilla. Nada de aquí decide dónde vive el
> código ni cómo se calcula la condición: eso es del arquitecto. Este documento
> decide **lo que lee quien compra** —la frase, las notas por vista y qué se
> pinta y qué no en cada una de las siete—, que es exactamente el hueco que
> `.agent/specs/F-040/spec.md` § «No decidido a propósito» le deja al diseño.
>
> **Entrada vinculante, no se reabre** (`.agent/progress/F-040.md`
> § «Decisiones tomadas», y la spec en `estado: listo`): el panel queda fuera
> (SP1), el checkout no cambia su respuesta (SP2), son **siete** vistas, las
> tres que no leían catálogo lo leen (SP3(a)), el selector de marca no se toca y
> el `BranchBar` de la vista sí (SP4), el motivo es un **código interno** que
> nunca se escribe en la base (R5, criterio 4) y se **reusa**
> `src/components/store/StoreClosedNotice.tsx` en vez de inventar una
> presentación nueva.
>
> **Corrección del 2026-09-10T18:34Z**: la primera versión de este documento
> afirmaba que la app no se podía levantar, y era **falso** —el Postgres del
> worktree escucha en el 5433 y el `.env` estaba bien—; el sondeo de puertos que
> lo «demostró» ni siquiera preguntó por ese puerto. La app se levantó, se midió
> todo lo que estaba estimado y las secciones § Estructura por breakpoint,
> § Accesibilidad y § Verificación visual están reescritas con números reales.
> Dos afirmaciones cayeron con la premisa: el orden de foco no era de «dos
> paradas» (son hasta cuatro) y el contraste no era el que se citaba de F-019
> (medido aquí: 4.76:1 en claro).
>
> **Cerrado el 2026-09-10: el humano contestó las tres preguntas, las tres en
> la opción recomendada, y firmó el plan.** `DP1` → **F1**, la frase que se lee
> abajo, la misma cadena en las siete vistas; `DP2` → (a), la cabecera se queda
> como está, con su contradicción y su deuda de accesibilidad anotadas a
> propósito; `DP3` → (a), el mensaje de WhatsApp cambia **solo** en la rama del
> código nuevo. Las tres se conservan en § Preguntas al humano con su respuesta
> y con las opciones descartadas: eso es lo que impide volver a discutirlas
> dentro de tres semanas. **No queda ninguna pregunta abierta**, y el documento
> queda en `estado: listo`.

## Qué se miró antes de diseñar

`AGENTS.md` entero, con parada en § Idioma (UI en español, código en inglés),
§ Prohibiciones —la de `"use client"` en cualquier cosa que renderice catálogo,
que aquí es trivial de cumplir porque no se añade ni una línea de cliente— y
§ «El presupuesto de JavaScript no es un muro». `.agent/specs/F-040/spec.md`
completo (E1..E21, R1..R16, § Datos y contrato, § Casos límite, I1..I5 y
§ «No decidido a propósito»), la entrada F-040 de `.agent/features.json` con sus
ocho criterios y su `notes`, y `.agent/progress/F-040.md`.

Del código, abierto y leído, no citado de memoria:
`src/components/store/StoreClosedNotice.tsx` (el orden exacto de lo que pinta y
sus siete props), `src/lib/storeClosure.ts` (`resolveStoreClosureHeadline`, sus
cuatro ramas, y `buildStoreClosureWhatsappUrl` con su mensaje prescrito),
`src/constants/storeClosure.ts` (las seis frases del panel y
`PLATFORM_ROLLOUT_REASON_CODE`), `src/components/ui/Alert.tsx` (tonos y el
`role` que le corresponde a cada uno), `src/components/ui/Container.tsx`,
`src/components/store/BranchBar.tsx`, `src/app/[slug]/layout.tsx` (la cabecera,
el `CartBadge` y la fila del selector de moneda de F-039),
`src/features/storefront/trail.ts` y las siete páginas con su rama de tienda
cerrada: `src/app/[slug]/page.tsx`,
`src/app/[slug]/p/[productSlug]/page.tsx`, `src/app/[slug]/catalogo/page.tsx`,
`src/app/[slug]/c/[categorySlug]/page.tsx`, `src/app/[slug]/buscar/page.tsx`,
`src/app/[slug]/carrito/page.tsx` y `src/app/[slug]/checkout/page.tsx`. De
tema, `src/theme/tokens.css` (incluida la nota de F-019 sobre `--color-warning`)
y `src/constants/cart.ts` (`CART_EXPIRY_DAYS`, que es lo que hace cierta la nota
del carrito). Como referencia de tono, `.agent/specs/F-011/design.md` § 8 —la
pantalla de tienda cerrada, que es la que aquí se reusa— y
`.agent/specs/F-039/design.md`.

### Se miró la pantalla de verdad, y con números

Levanté `next dev` **en el 3200** de este worktree tras comprobar que no había
ningún otro servidor entre el 3000 y el 3300 (los dos `node` que escuchaban en
la máquina eran un 5173 y un 5555 ajenos). La base de desarrollo ya sembrada
sirve el fixture que hace falta sin tocar ni una fila: **no se escribió nada en
la base y no se cerró ninguna tienda a mano**, porque `prisma/seed.ts` ya deja
tres cerradas.

| Fixture             | Qué aporta                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/el-trebol-playa`  | `SUSPENDED` en una marca con **dos** sucursales renderizables: la única con `BranchBar`, y con sus siete URL sirviendo el aviso |
| `/tienda-principal` | Cerrada **con teléfono**: la única con botón `Escribir por WhatsApp` visible                                                    |
| `/tienda-cerrada`   | Cerrada con dirección y sin marca múltiple: el aviso más corto posible                                                          |
| `/tienda-demo`      | Abierta: la cabecera que va a llevar una tienda muda (DP2) y su orden de tabulación                                             |

Todo lo que sigue está **medido** con Playwright contra ese servidor —cajas,
recuento de líneas por `Range.getClientRects()`, contraste rasterizado en un
`canvas` de 1×1 y el orden de tabulación pulsando Tab de verdad—, en 360, 768 y 1280. Las frases candidatas y las notas nuevas se midieron **sustituyéndolas en
el componente real**, no en una maqueta. Lo único que no se puede mirar todavía
es la pantalla muda entera, porque **el código aún no existe**: para eso, la
composición exacta (frase larga + sin mensaje del comerciante + nota nueva) se
simuló en el DOM de la página cerrada, y lo que queda pendiente está en
§ Verificación visual. La salida del servidor terminó sin una sola línea de
error ni un `⨯`.

## La frase que lee el comprador

**Decidida el 2026-09-10 por el humano (DP1): es F1.**

> Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando
> pedidos.

La misma cadena en las siete vistas, sin excepción. Lo que sigue —las cuatro
restricciones y las tres candidatas con sus medidas— se conserva porque es el
argumento de por qué es esa y no otra, y porque el día que alguien quiera
retocarla tiene que volver a pasar por aquí.

Es lo más delicado del feature: la única superficie donde se puede quedar mal
con el comerciante delante de su cliente. Cuatro restricciones, dos de la spec
(§ Datos y contrato) y dos del oficio:

1. **No atribuir el cierre a nadie.** Nadie cerró esta tienda. `Store.status`
   sigue en `PUBLISHED` y el comerciante muy probablemente ni sabe que su tienda
   está muda. Un «cerrado» seco delante de su cliente es una acusación falsa.
2. **Cero jerga.** Ni «tasa de cambio», ni «moneda base», ni «conversión», ni el
   código de moneda. Son del dominio interno.
3. **Ninguna fecha ni promesa.** No sabemos cuándo llega la tasa que falta.
4. **Misma familia que las siete frases que ya existen**: una oración corta, en
   tercera persona sobre «esta tienda» o en primera del plural del comercio,
   sin signos de admiración y sin disculpas largas.

Las que ya existen, para comparar (`src/constants/storeClosure.ts` y
`src/lib/storeClosure.ts`): «Estamos realizando adecuaciones en la tienda.»,
«Tienda temporalmente fuera de servicio.», «Estamos reponiendo el inventario.
Volvemos en cuanto tengamos productos.», «Cerrado por vacaciones. Volvemos
pronto.», «Por ahora atendemos solo en el local, no por internet.», «Esta tienda
todavía no está tomando pedidos por internet.», «Esta tienda no está tomando
pedidos por ahora.» y «Esta tienda no está disponible en este momento.»

### Las candidatas

**F1 — la elegida (DP1, 2026-09-10).** 86 caracteres.

> Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando
> pedidos.

Dice la causa en términos del comprador («no aparecen los precios» es
literalmente lo que él ve) y la consecuencia («no está tomando pedidos»), en ese
orden. **«No puede»**, no «no muestra» ni «decidió no mostrar»: es una
imposibilidad, no una elección, que es la mitad que impide leerlo como una
decisión del comerciante. Abre con «Esta tienda no…», igual que dos de las
frases que ya existen, así que suena de la familia. Y es la única de las tres
que le explica al comprador **por qué la tienda está vacía**, que es el
enunciado del feature («lo dice, en vez de mostrar un catálogo vacío sin
explicación») y lo que el criterio 1 llama «con su motivo».

Coste, **medido** sustituyéndola en el `Alert` real de `/el-trebol-playa`: **3
líneas a 360 px** (el aviso pasa de 54 a 94 px de alto) y **1 sola línea a 768 y
a 1280**. Una línea más que la frase más larga de hoy a 360 —«Estamos reponiendo
el inventario…», que mide 2— y ninguna diferencia por encima de 768. La pantalla
entera sigue entrando sin desplazamiento en un móvil de 360×640 (§ Estructura
por breakpoint). Es el precio de explicar algo, y cabe.

**F2 — la mínima.** 48 caracteres; **2 líneas a 360**, 1 desde 768.

> Esta tienda no está tomando pedidos ahora mismo.

Riesgo cero de tono y familia perfecta: es la frase del POS con «ahora mismo» en
vez de «por ahora». **Se descarta** por dos motivos. Uno de producto: no explica
nada, y el feature existe precisamente para explicar; el comprador se queda sin
saber por qué no hay ni un producto. Uno práctico: es casi la misma cadena que
la rama de `disabledAt` —que es exactamente la que sirve hoy `/tienda-principal`,
comprobado en pantalla: «Esta tienda no está tomando pedidos por ahora.»—, y con
dos ramas devolviendo textos indistinguibles
ninguna prueba de las de la spec (que buscan `<FRASE>` en el HTML) puede
demostrar **cuál** de las dos se ejecutó — E1, E4 y el criterio 7 se vuelven
mucho más débiles.

**F3 — la de dos oraciones.** 107 caracteres.

> Los precios de esta tienda no están disponibles en este momento. Mientras
> tanto no se pueden hacer pedidos.

Misma cadencia que «Estamos reponiendo el inventario. Volvemos en cuanto
tengamos productos.», y es la más impersonal de las tres: el sujeto son los
precios, no la tienda, de modo que ni por asomo suena a decisión del
comerciante. **Se descarta por longitud, y ahora con la medida delante**: 3
líneas a 360 px igual que F1, pero **2 también a 768**, donde F1 ya cabe en una
— es la única de las tres que se desborda en tableta. Y encima su «Mientras
tanto…» choca con las notas por vista, que ya empiezan con esas dos palabras
(§ Textos). Queda como el
respaldo si el humano encuentra a F1 demasiado explícita.

**Se recomendó F1 y el humano la eligió** (DP1, 2026-09-10). Se le llevó a él
porque la spec la delega explícitamente en el diseño y porque es la única
decisión de este documento que no se deshace barata: cambiarla después de
publicar significa cambiar lo que ya leyeron compradores reales.

## Flujo de usuario

Quien compra escanea el QR de la pared o abre un enlace compartido y cae en
cualquiera de las siete URL. En vez de un catálogo vacío sin explicación:

1. **Reconoce el sitio**: la cabecera de la tienda con su color y su nombre (la
   de siempre, DP2) y un `<h1>` con el nombre. El QR llevó a donde decía.
2. **Lee la frase** en el `Alert` de tono `warning`: la tienda no puede mostrar
   precios y por eso no toma pedidos. Sabe que no es cosa suya ni de su
   teléfono.
3. **Tiene una salida útil**, y aquí este caso es _mejor_ que el de una tienda
   cerrada: la tienda **está abierta**, lo único que no funciona es el precio en
   internet. El botón `Escribir por WhatsApp` lleva un mensaje ya escrito que
   pregunta justo eso (§ Textos, DP3). Si no hay número, queda la dirección como
   dato, sin invitar a nada.
4. **Puede irse a otra sucursal** si la marca tiene más de una: el `BranchBar`,
   en su forma cerrada, debajo del aviso.
5. **No pierde nada**. El carrito guardado en el teléfono sigue ahí —nadie lo
   borra, nadie lo vacía, y caduca a los 30 días como cualquier otro
   (`CART_EXPIRY_DAYS`)— y las dos pantallas donde eso importa se lo dicen.

**La vuelta atrás y qué se pierde.** Se pierde exactamente una cosa: el término
que alguien hubiera escrito en `/buscar` no se busca, no se registra y **no se
devuelve escrito** ni en la caja de búsqueda (que no se pinta) ni en las migas
(`searchTrail(store, null)`, igual que la rama cerrada). Todo lo demás sobrevive.
Navegar entre las siete URL da siempre la misma pantalla, con su nota: no hay
callejón sin salida porque no hay ningún sitio distinto al que ir, y por eso
tampoco se añade ningún enlace nuevo de «volver al catálogo» — llevaría al mismo
aviso.

**El regreso es solo.** Cuando llega la tasa que faltaba, la invalidación que ya
existe (R10) hace que la **siguiente** visita a la misma URL enseñe el catálogo
con sus precios. El comprador no tiene que hacer nada, y la última línea del
aviso se lo promete en los mismos términos (§ Textos).

## Inventario de pantallas y estados

### Las siete vistas, una por una

Todas comparten el mismo bloque: migas + `StoreClosedNotice` dentro de un
`Container className="pt-4 pb-8"`, con `disabledMessage={null}` y
`disabledAt={null}` (R8) y con el código de motivo interno. Lo que cambia es la
**nota extra** y si lleva `BranchBar`. En las cinco que lo llevan, el orden es
el de la rama de tienda cerrada de hoy: **el `Container` primero y la barra
debajo**, no arriba como en el camino abierto. Es deliberado: lo primero que se
lee es la explicación, y la barra queda como salida al final.

| Vista                      | Sustituye a                                                                          | Nota extra              | `BranchBar`          | Migas                              |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------- | -------------------- | ---------------------------------- |
| `/[slug]`                  | Buscador, `<h1>Catálogo</h1>`, enlace «Filtrar y ordenar», rejilla, aviso de horario | **ninguna**             | sí, `isOpen={false}` | `catalogTrail`, sin `jsonLd`       |
| `/[slug]/p/[productSlug]`  | Imagen, importe, insignia, botón de añadir, descripción                              | **ninguna**             | sí, `isOpen={false}` | `catalogTrail` (no `productTrail`) |
| `/[slug]/catalogo`         | Panel de facetas, chips, orden, resultados, paginación                               | «filtrar y ordenar»     | sí, `isOpen={false}` | `filterTrail`                      |
| `/[slug]/c/[categorySlug]` | Título de la categoría, contador, rejilla                                            | «esta categoría»        | sí, `isOpen={false}` | `catalogTrail`                     |
| `/[slug]/buscar`           | Caja de búsqueda, resultados, vacíos, paginación                                     | «buscar»                | sí, `isOpen={false}` | `searchTrail(store, null)`         |
| `/[slug]/carrito`          | `CartView`                                                                           | la del carrito guardado | no (nunca lo tuvo)   | `cartTrail`                        |
| `/[slug]/checkout`         | `CheckoutForm`                                                                       | la del carrito guardado | no (nunca lo tuvo)   | `checkoutTrail`                    |

Las decisiones que no se leen en la tabla:

- **La portada no lleva nota.** No hay nada que añadir: la frase ya dice todo lo
  que esa pantalla tiene que decir, y cualquier nota extra la separaría de la
  ficha, que por el criterio 7 tiene que decir **lo mismo**.
- **La ficha tampoco, y no nombra el producto.** «Dice lo mismo que la portada»
  (criterio 7) se toma al pie de la letra: mismo `<h1>`, misma frase, misma
  ausencia de nota. Y aunque aquí el catálogo **sí** está en la mano —a
  diferencia de la rama cerrada, que ni lo lee—, el producto no se nombra ni se
  pinta: nombrarlo obligaría a decidir qué hacer con `/p/no-existe` (E5), que
  enseña esta misma pantalla, y reintroduciría por la puerta de atrás la fuga
  que la rama cerrada evita. Las migas usan `catalogTrail`, no `productTrail`,
  por lo mismo.
- **`/catalogo`, `/c/…` y `/buscar` heredan la nota de hoy con otra redacción.**
  Las de hoy dicen «mientras la tienda esté cerrada», que aquí sería falso: no
  está cerrada. Las tres se reescriben en § Textos con el mismo esqueleto
  («Mientras tanto no se puede…») para que las tres suenen igual.
- **La categoría no se nombra**, ni siquiera cuando existe: mismo argumento que
  el producto, y así `/c/no-existe` (E6) y `/c/bebidas` son la misma pantalla.
- **`/carrito` y `/checkout` pillan a alguien con productos ya elegidos**, y eso
  es lo único que estas dos tienen que resolver: qué pasa con lo que ya tenía.
  La respuesta es **no pasa nada**, y hay que decirlo. No se monta `CartView` ni
  `CheckoutForm` (R7), **no se toca `localStorage`** —no hay ningún código de
  cliente en esta pantalla que pudiera tocarlo—, no se vacía, no se caduca antes
  y no se le pide al comprador que confirme nada. La nota de hoy ya dice
  exactamente eso; solo cambia el final «cuando la tienda vuelva a abrir» por
  «cuando la tienda vuelva a mostrar precios». Las dos comparten cadena, como
  hoy: son la misma promesa.
- **Ninguna de las siete estrena `BranchBar`.** Las cinco que lo pintan lo
  pintan cerrado (R16, E21); las dos que nunca lo tuvieron siguen sin él, porque
  ofrecer «cambiar de sucursal» a dos campos de pagar es lo que
  `src/components/store/BranchBar.tsx` decidió no hacer.

### Los estados aburridos

| Estado                          | Qué se ve                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Muda** (el estado nuevo)      | Lo de la tabla de arriba, en las siete vistas                                                                                                                                                             |
| **Parcial: algunos sin precio** | Nada cambia. Catálogo de siempre, con «Consultar» en las tarjetas sin precio y «Consultar precio» en la ficha (R14, criterio 2, E2). Es el estado que este feature **no** toca                            |
| **Vacía: sin productos**        | Nada cambia. «Esta tienda todavía no tiene productos publicados.» y el mensaje propio de `/catalogo`, sin aviso (R3, criterio 3, E3)                                                                      |
| **Cerrada de verdad**           | Gana el cierre real, con su propia frase y su mensaje del comerciante (R6, E15). Precedencia, no mezcla: nunca se ven las dos cosas                                                                       |
| **Cargando**                    | No existe. Las cinco de catálogo son HTML servido y las dos dinámicas (`/carrito`, `/checkout`) hoy no tienen esqueleto ni `loading.tsx`; el aviso llega ya renderizado. No se añade ninguno              |
| **Error**                       | Si las tasas o el catálogo no se pueden leer, la página falla como falla hoy. **No** se disfraza un fallo de infraestructura de «tienda muda» (spec § Casos límite): sería mentirle al comprador          |
| **Sin permiso**                 | No aplica: las siete son públicas y sin sesión                                                                                                                                                            |
| **Pestaña rancia**              | Quien tenía el catálogo abierto de antes y pulsa «Pedir» recibe el 409 `ITEMS_UNAVAILABLE` de siempre, con el banner que F-010 ya pinta. No se cambia ni el código, ni el cuerpo, ni el banner (SP2, R12) |
| **Recuperación**                | La primera visita posterior a la invalidación enseña el catálogo con precios, sin aviso y sin acción del comprador (E14, R10)                                                                             |

### Lo que NO se ve, y no es un olvido

Ni una tarjeta, ni un importe, ni «Consultar», ni «Consultar precio», ni una
insignia de disponibilidad, ni el panel de facetas, ni los chips, ni el
buscador, ni el enlace «Filtrar y ordenar», ni el aviso de horario de F-022, ni
`jsonLd` de migas: una página sin productos no publica datos estructurados de
catálogo. Y ningún enlace nuevo: ni «ver otras tiendas» (no hay directorio,
`.agent/specs/F-011/design.md` § 8), ni «volver al catálogo» (llevaría aquí
mismo).

**Lo que sí sigue igual, y es una decisión, no un descuido**: el `<title>` de
las siete. R15 y § Fuera, punto 6 lo prohíben expresamente —leer catálogo y
tasas dentro de `generateMetadata` es el coste que el criterio 6 evita—, así que
la pestaña seguirá diciendo lo de siempre mientras el cuerpo dice que no hay
precios. Se acepta con los ojos abiertos: el mensaje va donde el comprador mira.

## Estructura por breakpoint

No hay una sola regla `sm:`/`lg:` nueva. `StoreClosedNotice` es una columna
dentro de `Container` (`max-w-6xl px-4 sm:px-6`) y el `Alert` ocupa el ancho
disponible en los tres tamaños. Lo que cambia con el ancho es **cuántas líneas
ocupa cada texto**, y eso es lo único que había que mirar. **Todo lo de esta
tabla está medido** en `/el-trebol-playa` y sus siete URL, con las cadenas de
este documento sustituidas en el componente real; no queda ninguna estimación.

| Zona                              | 360 px                                                         | 768 px                           | 1280 px            |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------- | ------------------ |
| Ancho útil del texto del aviso    | **294 px** (`Container` 328 menos el `p-4` del `Alert`)        | 686 px                           | 1070 px            |
| Cabecera de la tienda             | 68 px de alto; nombre con `truncate`, ciudad oculta            | 68 px, con ciudad (`sm:inline`)  | 68 px              |
| Migas (`StoreTrail`)              | 1 línea                                                        | 1 línea                          | 1 línea            |
| `<h1>` nombre de la tienda        | 32 px, 1 línea con los nombres del seed                        | 1 línea                          | 1 línea            |
| `Alert` con la frase (F1)         | **3 líneas, 94 px de alto** (54 px con una frase de una línea) | **1 línea, 54 px**               | 1 línea, 54 px     |
| Botón `Escribir por WhatsApp`     | 204×**44** px, en línea, no a todo el ancho                    | Igual                            | Igual              |
| Dirección                         | 1 línea, `text-fg-muted`                                       | 1 línea                          | 1 línea            |
| Nota de catálogo/categoría/buscar | **2 líneas, 48 px**                                            | **1 línea, 24 px**               | 1 línea, 24 px     |
| Nota de carrito y checkout        | **4 líneas, 96 px**                                            | **2 líneas, 48 px**              | **1 línea, 24 px** |
| Línea de cierre                   | 2 líneas, 48 px, `text-sm`                                     | 1 línea, 24 px                   | 1 línea, 24 px     |
| `BranchBar`                       | **Apilado**, 92 px: frase arriba y enlace de 328×44 debajo     | En fila, 68 px, enlace de 129×44 | En fila, 68 px     |

**Entra sin desplazamiento en un móvil de 360×640**, medido sobre la
composición muda completa (F1 + sin mensaje del comerciante + la nota nueva + la
línea de cierre nueva): el contenido termina en **474 px** en la portada y la
ficha, en **538 px** en `/catalogo` y `/buscar` —las dos que suman nota y
barra— y en **462 px** en `/carrito` y `/checkout`, que llevan la nota de cuatro
líneas pero no llevan barra. Nada se oculta en ningún tamaño y nada cambia de
jerarquía.

## Componentes de UI

**Ninguno nuevo.** Ni un primitivo, ni una variante, ni un `props` de
presentación. Se reutilizan tal cual `src/components/store/StoreClosedNotice.tsx`
(que ya acepta `extraNote`), `src/components/ui/Alert.tsx` con `tone="warning"`,
`src/components/ui/Container.tsx`, `src/components/store/StoreTrail.tsx` y
`src/components/store/BranchBar.tsx` con `isOpen={false}`.

Lo único que este feature añade son **cadenas resueltas por código**: la frase
del motivo nuevo dentro de `resolveStoreClosureHeadline`
(`src/lib/storeClosure.ts`), y las notas por vista, que son literales en cada
página igual que las de hoy. **Dónde vive cada cosa lo decide
`.agent/specs/F-040/architecture.md`**; lo que este documento fija es el texto.

Dos textos más que hoy están **fijos** dentro de piezas compartidas y que para
este motivo dicen algo falso. El diseño pide cambiarlos **solo en la rama del
código nuevo**, sin tocar lo que ve ninguna tienda cerrada de verdad (E20 sigue
siendo byte a byte):

1. **La última línea de `StoreClosedNotice`**, hoy literal: «Esta página se
   actualiza sola cuando la tienda vuelva a abrir.» Aquí la tienda nunca cerró.
2. **El mensaje prescrito de WhatsApp** de `buildStoreClosureWhatsappUrl`, hoy
   «¿Cuándo vuelven a tomar pedidos?», que le llega a un comerciante que cree
   —con razón— que su tienda está abierta y tomando pedidos. Es el único canal
   por el que ese comerciante puede enterarse de que su tienda está muda, porque
   el panel quedó fuera (SP1).

El segundo **ya no es negociable**: lo decidió el humano el 2026-09-10 (DP3), así
que la arquitectura tiene que hacerle sitio. El primero sigue siendo una decisión
de diseño y es el único de los dos que se puede sacrificar si sale caro; es el
cosmético.

## Tokens y tema

Ningún token nuevo, ninguna clase con valor literal. Todo lo que se pinta ya
resuelve a `var()`: `Alert tone="warning"` usa `--color-warning` —el que F-019
oscureció a `oklch(0.5 0.15 75)` justamente para que el texto de este tono mida
por encima de 4.5:1—, la nota extra y la línea de cierre usan `--color-fg-muted`,
el botón de WhatsApp usa `--color-brand`/`--color-brand-contrast` y el
`BranchBar` usa `--color-surface-muted` con el enlace en `--color-brand`.

**Branding por tienda**: intacto y visible. La pantalla vive dentro del
`[data-store="…"]` del layout, así que la cabecera y el botón de WhatsApp salen
en el color de la tienda; el aviso, en cambio, se queda en el `warning` del
sistema a propósito — un aviso repintado con la marca del negocio se lee como
parte del catálogo. **Modo oscuro**: heredado, sin ninguna regla nueva
(`--color-warning` sube a `oklch(0.8 0.14 75)` en `prefers-color-scheme: dark`).
`npm run check:theme` no tiene nada nuevo que comprobar.

## Accesibilidad

**Respecto a lo que `StoreClosedNotice` ya hace, no cambia nada**, y lo digo
explícitamente en vez de callarlo: no hay ningún control nuevo, ningún `aria-*`
nuevo, ninguna región viva nueva y ningún elemento enfocable que hoy no exista.
Lo que sigue está **comprobado en la pantalla**, pulsando Tab a 360 px, no
deducido del JSX:

- **Orden de foco medido** en la tienda cerrada de hoy: `Tu cuenta` (cabecera) →
  las migas, de una a tres paradas según la vista → `Escribir por WhatsApp` si
  hay número → `Ver la otra sucursal` del `BranchBar`. En `/el-trebol-playa` son
  **tres** paradas y en su `/checkout`, **cuatro**. Corrige lo que este
  documento decía en su primera versión («dos paradas como mucho»): las migas
  aportan más de una, y la cabecera aporta la primera. El `<h1>`, el `Alert`, la
  dirección, la nota y la línea de cierre no son enfocables porque no son
  interactivos, y no hay ninguna trampa de foco: la pantalla se recorre entera y
  se sale.
- **En una tienda muda habrá tres paradas más antes de las migas**, porque su
  cabecera es la de una tienda abierta (DP2): medidas en `/tienda-demo`, el
  nombre de la tienda, `Carrito` y `Tu cuenta`.
- **Área de toque**: todo lo que este feature pinta mide **44 px** exactos de
  alto —el botón de WhatsApp (204×44), los enlaces de migas y el del `BranchBar`
  (328×44 apilado a 360, 129×44 en fila)—. **Lo que no llega es de la cabecera y
  es de antes**: `Tu cuenta` mide 28 px y `Carrito` 20. No es de F-040 y aquí no
  se toca; queda anotado porque una tienda muda los pinta y alguien podría
  atribuírselo a este feature.
- **`role="alert"`** confirmado en el DOM servido, puesto por `Alert` para el
  tono `warning`. En una página ya renderizada eso se anuncia al cargar, que aquí
  es justo lo que se quiere: el lector de pantalla dice la frase antes de que el
  usuario descubra solo que no hay productos. No se añade `aria-live`.
- **Contraste, medido sobre el fondo compuesto real** (canvas de 1×1, como pide
  la ficha `.agent/playbook/alert-tone-hereda-color-en-body-de-texto-largo.md`, y
  no sobre el color declarado) con F1 dentro del aviso: **4.76:1 en claro** y
  **7.73:1 en oscuro** para el texto del aviso; **5.38:1** y **7.16:1** para la
  línea de cierre en `text-fg-muted`. Los cuatro pasan el 4.5:1 de texto normal.
  Un primer intento de medirlo leyendo `getComputedStyle` dio 1.01:1 y era falso:
  el navegador devuelve `lab(…)` y hay que rasterizarlo.
- **Nada depende del color**: la frase dice por sí sola lo que pasa. Un usuario
  con el color desactivado lee exactamente lo mismo.
- **Encabezados**: un único `<h1>` con el nombre de la tienda, y ninguno más.
  Los `<h1>` que la vista abierta pinta («Catálogo», «Filtrar y ordenar»,
  «Buscar en la tienda») desaparecen con su contenido, así que no queda un
  encabezado huérfano describiendo algo que no está.
- **Idioma**: `lang="es"` viene del layout raíz; los textos nuevos son españoles
  y no llevan abreviaturas ni códigos de moneda que un lector de pantalla
  tuviera que deletrear — otra razón, además de la del comprador, para que la
  frase no nombre la moneda.

## Coste de cliente

**Cero.** No hay ni un `"use client"` nuevo, ni un `useState`, ni un `useEffect`,
ni un módulo de cliente más. Las siete vistas resuelven la condición en el
servidor y sirven HTML: la prohibición más dura del repo —que la tienda se lea
sin esperar el JavaScript— no solo se cumple, es que este feature va en la
dirección contraria a romperla.

De hecho una vista muda pesa **menos** que la misma vista abierta: no monta la
rejilla, ni el panel de filtros, ni `CartView`, ni `CheckoutForm`. El único
JavaScript que sigue llegando es el que el layout ya cargaba antes de este
feature —`CartBadge`, `AccountBadge` y, si el negocio ofrece equivalentes, el
`ReferenceCurrencySelect` de F-039 con su guion de arranque—, y sobre eso va
DP2. `scripts/check-bundle-budget.mjs` no tiene nada que medir de nuevo y
`BUDGET_KB` **no se toca**: subirlo aquí sería una regresión disfrazada.

## Textos

Microcopy exacto. Todo en español, sin variables salvo donde se indica.

### La frase del motivo (`resolveStoreClosureHeadline`)

> Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando
> pedidos.

Es **la** frase: decidida por el humano el 2026-09-10 (DP1) y sin alternativa
viva. Las dos descartadas quedan escritas con su motivo, que es historia útil:
F2 «Esta tienda no está tomando pedidos ahora mismo.», descartada por no
explicar nada y por ser indistinguible de la que ya devuelve la rama de
`disabledAt`; F3 «Los precios de esta tienda no están disponibles en este
momento. Mientras tanto no se pueden hacer pedidos.», descartada por longitud
—dos líneas ya a 768— y por chocar con el arranque de las notas por vista.

**La misma cadena en las siete vistas**, sin excepción: es lo que exigen el
criterio 7 y E4, y lo que permite que las pruebas la busquen tal cual en el HTML.

### Las notas por vista (`extraNote`)

| Vista                      | Hoy (tienda cerrada)                                                                                                             | Tienda muda                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/[slug]`                  | (ninguna)                                                                                                                        | (ninguna)                                                                                                                                   |
| `/[slug]/p/[productSlug]`  | (ninguna)                                                                                                                        | (ninguna)                                                                                                                                   |
| `/[slug]/catalogo`         | «No se puede filtrar mientras la tienda esté cerrada.»                                                                           | «Mientras tanto no se puede filtrar ni ordenar el catálogo.»                                                                                |
| `/[slug]/c/[categorySlug]` | «No se puede ver esta categoría mientras la tienda esté cerrada.»                                                                | «Mientras tanto no se pueden ver los productos de esta categoría.»                                                                          |
| `/[slug]/buscar`           | «No se puede buscar mientras la tienda esté cerrada.»                                                                            | «Mientras tanto no se puede buscar en el catálogo.»                                                                                         |
| `/[slug]/carrito`          | «Si tenías productos en el carrito, siguen guardados en este teléfono: cuando la tienda vuelva a abrir los vas a encontrar ahí.» | «Si tenías productos en el carrito, siguen guardados en este teléfono: cuando la tienda vuelva a mostrar precios, los vas a encontrar ahí.» |
| `/[slug]/checkout`         | Idéntica a la del carrito                                                                                                        | Idéntica a la del carrito                                                                                                                   |

Las tres notas de catálogo, categoría y búsqueda comparten arranque —«Mientras
tanto no se puede…»— porque cuelgan de la misma frase de arriba y así se leen
como su continuación, no como tres avisos distintos. Ninguna dice «cerrada»:
la tienda no lo está.

### La línea de cierre de `StoreClosedNotice`

| Caso           | Texto                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| Tienda cerrada | «Esta página se actualiza sola cuando la tienda vuelva a abrir.» (sin cambios) |
| Tienda muda    | «Esta página se actualiza sola en cuanto la tienda vuelva a mostrar precios.»  |

Es cierta palabra por palabra: la invalidación de R10 hace exactamente eso, sin
que el comprador tenga que recargar a mano ni esperar una fecha que nadie puede
dar.

### El mensaje prescrito de WhatsApp

| Caso           | Texto                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| Tienda cerrada | «Hola {tienda}, vi su tienda online. ¿Cuándo vuelven a tomar pedidos?» (sin cambios)        |
| Tienda muda    | «Hola {tienda}, vi su tienda online pero no me aparecen los precios. ¿Me los pueden decir?» |

Decidido por el humano el 2026-09-10 (DP3): cambia **solo** en la rama del
código nuevo, y el de una tienda cerrada de verdad no se toca. El texto del
botón tampoco cambia: «Escribir por WhatsApp». Y **no se promete** que
el comerciante vaya a tomar el pedido por ahí: no lo sabemos, y prometer un
canal ajeno es la clase de promesa que después no se cumple.

### Textos que este feature NO debe hacer aparecer

«Consultar», «Consultar precio», «Esta tienda todavía no tiene productos
publicados.», «Esta sucursal está abierta»/«Estás en …», cualquier importe y
cualquier código de moneda. E1, E4 y E21 los buscan por ausencia.

## Verificación visual

### Lo que ya está medido, y no hay que volver a mirar

Contra `next dev` en el 3200 de este worktree, con los fixtures cerrados que el
seed ya deja y las cadenas de este documento sustituidas en el componente real.
Nada de esto se escribió en la base: **no se cerró ninguna tienda a mano y no
hubo nada que deshacer.**

| Qué                                                | Dónde                                                      | Ancho          | Resultado                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| Las siete vistas sirven el aviso con 200           | `/el-trebol-playa` y sus seis subrutas, más `/p/x`, `/c/x` | —              | Las siete, 200                                                                       |
| Líneas de F1, F2 y F3 en el `Alert`                | `/el-trebol-playa`                                         | 360, 768, 1280 | F1 3/1/1 · F2 2/1/1 · F3 3/**2**/1                                                   |
| Líneas de las notas nuevas                         | `/el-trebol-playa`                                         | 360, 768, 1280 | Catálogo, categoría y buscar 2/1/1 · carrito y checkout 4/2/1                        |
| Línea de cierre nueva                              | `/el-trebol-playa`                                         | 360, 768, 1280 | 2/1/1                                                                                |
| La pantalla muda completa entra sin desplazar      | Portada, `/catalogo`, `/buscar`, `/carrito`                | **360×640**    | 474 · 538 · 538 · 462 px de contenido                                                |
| `BranchBar` apilado abajo y cerrado                | Las cinco vistas con barra                                 | 360 / 768      | 92 px apilado · 68 px en fila, enlace 44 px                                          |
| Área de toque de todo lo que pinta el aviso        | `/tienda-principal` (WhatsApp) y `/el-trebol-playa`        | 360            | 44 px en todo; 28 y 20 px en la cabecera, **de antes**                               |
| Orden de tabulación real                           | `/el-trebol-playa`, su `/checkout`, `/tienda-principal`    | 360            | 3, 4 y 2 paradas (§ Accesibilidad)                                                   |
| `role="alert"` presente en el aviso servido        | `/el-trebol-playa`                                         | —              | Sí                                                                                   |
| Contraste sobre el fondo compuesto, claro y oscuro | `/el-trebol-playa` con F1                                  | 360            | 4.76:1 y 7.73:1 el aviso; 5.38:1 y 7.16:1 la línea de cierre                         |
| La cabecera de una tienda publicada (DP2)          | `/tienda-demo`                                             | 360            | Nombre enlazado, `Carrito`, `Tu cuenta` y la fila «Cobramos en CUP.» con su selector |

### Lo que queda por mirar cuando el código exista

No por falta de entorno: **la vista muda todavía no se puede pedir porque no
está escrita**. Lo de arriba la simula sustituyendo cadenas en la página
cerrada, que comparte componente pero no comparte datos.

1. Las siete URL de una tienda **muda de verdad**, con su fixture sembrado (un
   negocio con moneda base sin tasa vigente y productos en otra moneda, y la
   variante de base `CUP` con productos en `EUR` sin tasa, que es E16), a 360:
   que la frase sea **la misma cadena** en las siete (criterio 7) y que no
   aparezca ningún importe, ni «Consultar», ni una insignia.
2. Que **no quede rastro del mensaje del comerciante**: el aviso muda va con
   `disabledMessage={null}` (R8), y en las mediciones de arriba ese párrafo se
   quitó a mano. Con el código real tiene que no existir.
3. **Una tienda con marca propia** (tokens de tienda): cabecera y botón de
   WhatsApp en su color, aviso en el `warning` del sistema.
4. `/[slug]/p/no-existe` y `/[slug]/c/no-existe` bajo una tienda muda: la misma
   pantalla que sus equivalentes existentes, sin 404 y sin nombrar nada (E5, E6).
5. **La comparación lado a lado** con una tienda cerrada de verdad: que se
   distingan por la frase y no por el diseño, y que la muda no diga «cerrada» en
   ningún sitio.
6. **La recuperación** en vivo: sembrar la tasa que falta, revalidar y recargar
   `/[slug]`; catálogo con precios y ni rastro del aviso (E14).

## Preguntas al humano

**No queda ninguna abierta.** Las tres se contestaron el **2026-09-10**, las
tres en la opción recomendada, y con ellas el humano firmó el plan. Se conservan
enteras —con las opciones descartadas y su motivo— porque la opción elegida sin
las descartadas al lado no impide que alguien vuelva a abrir la discusión dentro
de tres semanas.

### DP1 — la frase que lee el comprador · **CONTESTADA**

Era la única decisión de este documento que se le pedía al humano, y la spec la
delegó aquí a propósito.

- **(a) F1, recomendada.** «Esta tienda no puede mostrar sus precios ahora
  mismo, así que no está tomando pedidos.» Explica la causa en términos del
  comprador y la consecuencia, sin culpar a nadie («no puede», no «no quiere»),
  sin jerga y sin fecha. 86 caracteres; **medida en el componente real: 3
  líneas a 360 px, 1 a 768 y 1 a 1280**, y la pantalla entera sigue entrando en
  un móvil de 360×640.
- **(b) F2.** «Esta tienda no está tomando pedidos ahora mismo.» La más corta y
  la más segura de tono, pero no explica nada —que es el feature entero— y es
  casi indistinguible de la frase que ya devuelve la rama de `disabledAt`, lo
  que debilita E1, E4 y el criterio 7.
- **(c) F3.** «Los precios de esta tienda no están disponibles en este momento.
  Mientras tanto no se pueden hacer pedidos.» La más impersonal (el sujeto son
  los precios), pero 107 caracteres: **3 líneas a 360 y 2 también a 768**, la
  única de las tres que se desborda en tableta, y su «Mientras tanto» choca con
  las notas por vista.

**Recomendación: (a). Respuesta del humano, 2026-09-10: (a), F1**, con la
condición de que sea la **misma cadena en las siete vistas, sin excepción**.
(b) y (c) quedan descartadas por lo escrito arriba.

### DP2 — la cabecera sigue siendo la de una tienda abierta · **CONTESTADA**

En una tienda muda, `Store.status` es `PUBLISHED`, así que
`src/app/[slug]/layout.tsx` la trata como abierta: el nombre va como **enlace**,
se pinta el **`CartBadge`** con su burbuja, y si el negocio declara equivalentes
calculables aparece la segunda fila de F-039 con «Cobramos en {MONEDA}.» y su
selector — encima de un aviso que dice que no hay precios. **Comprobado en
`/tienda-demo`**, que es publicada: pinta el nombre enlazado, `Carrito`,
`Tu cuenta` y la fila «Cobramos en CUP.» con su selector.

- **(a) Dejarlo como está, recomendada.** El carrito sigue siendo cierto (los
  productos están guardados y el aviso de `/carrito` lo explica), el enlace del
  nombre lleva a la portada, que enseña el mismo aviso, y la fila de moneda dice
  algo que no es falso. Coste cero.
- **(b) Tratarla como cerrada también en la cabecera.** Más coherente, pero el
  layout envuelve **todas** las rutas de `/[slug]` —incluidas `/sucursales` y
  `/pedido/[code]`, que están fuera del alcance—, así que obligaría a evaluar la
  condición ahí y a leer el catálogo en cada una. Es exactamente el coste que el
  criterio 6 quiere evitar, por una incoherencia menor.

**Recomendación: (a). Respuesta del humano, 2026-09-10: (a)**, la cabecera se
deja como está. La contradicción queda anotada **a propósito**, para que nadie
la descubra en producción creyendo que es un fallo, y con ella el efecto
secundario medido: en una tienda muda el foco pasa por **tres** controles de
cabecera antes de llegar al aviso, y dos de ellos miden 28 y 20 px de alto. Es
una deuda de accesibilidad **previa**, que F-040 ni crea ni arregla.

### DP3 — el mensaje de WhatsApp, que es el único canal que le queda al comerciante · **CONTESTADA**

Con el panel fuera (SP1), el comerciante **no se entera** de que su tienda está
muda por ningún camino nuestro. El único que queda es un cliente escribiéndole.

- **(a) Cambiarlo en la rama del motivo nuevo, recomendada.** «Hola {tienda}, vi
  su tienda online pero no me aparecen los precios. ¿Me los pueden decir?» Es lo
  que el comprador realmente quiere preguntar y, de paso, le dice al comerciante
  qué está roto con palabras que él entiende.
- **(b) Dejar el de hoy.** «¿Cuándo vuelven a tomar pedidos?» le llega a alguien
  que cree que su tienda está abierta —y lo está—, así que probablemente
  conteste «estamos abiertos» y nadie descubra nada.

**Recomendación: (a). Respuesta del humano, 2026-09-10: (a)**, cambiándolo
**solo** en la rama del código nuevo: el mensaje de una tienda cerrada de verdad
no se toca, y el texto del botón tampoco.
