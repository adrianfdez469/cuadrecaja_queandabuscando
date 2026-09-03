---
feature: F-022
agente: sdd-designer
actualizado: 2026-09-02T22:31:40Z
estado: listo
---

> **Ciclo 2. Reescrito entero después de `AP1`.** El ciclo 1 de este documento
> diseñaba un cartel de **estado en vivo** («Atendiendo ahora · cierra a las
> 18:00») dentro de un hueco dinámico en `<Suspense>`, que es lo que la spec
> fijó en SP5 = (a). Ese mecanismo **no existe** en Next 16.3.2 con la
> configuración de caché de este repo, medido por `sdd-architect` con cuatro
> builds reales, y el humano resolvió `AP1` con estas palabras: **«HTML
> cacheado, y la línea dice el horario»**.
>
> Este documento diseña eso: **el horario publicado de la semana, en HTML
> cacheado, sin afirmar ningún estado y sin un solo byte de JavaScript**. Lo que
> desapareció del ciclo 1 y por qué está en § Lo que cambió con `AP1`, porque el
> motivo de un descarte se olvida antes que el descarte.
>
> `DP1`, `DP2` y `DP3` del ciclo 1 están **resueltas** y su respuesta está
> aplicada en todo el documento. Quedan abiertas `DP4` y `DP5`, y **ninguna
> bloquea el plan**.

## Qué se miró antes de diseñar

`.agent/specs/F-022/spec.md` entera (E1-E13, R1-R14, los 12 casos límite, la
subsección «El cartel en la página, y de dónde sale su instante», los siete
criterios literales y los dos `[nuevo]`, I1-I8 y § No decidido a propósito), el
feature y las `rules` de `.agent/features.json`, `.agent/progress/F-022.md` con
las tres tandas de decisiones del humano, y
`.agent/specs/F-022/architecture.md` en `borrador` —en particular su § 2, el
contrato de lectura del calendario, y su § «El cartel en la página», que es donde
`AP1` está medido—.

`AGENTS.md` (§ Prohibiciones, § «El presupuesto de JavaScript no es un muro»,
§ Cosas que muerden, § Idioma),
`docs/adr/0006-isr-con-revalidacion-por-tag.md`, la propuesta
`.agent/specs/propuestas/contraste-de-tokens-de-tema.md`, y del playbook
`.agent/playbook/alert-tone-hereda-color-en-body-de-texto-largo.md`,
`.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md`,
`.agent/playbook/bundle-fuera-de-presupuesto.md`,
`.agent/playbook/proxy-matcher-anula-isr.md` y
`.agent/playbook/next-dev-uno-por-directorio.md`. De F-011,
`.agent/specs/F-011/spec.md` en las líneas 67-69 y 440-442: el editor de
horarios y la frase «el panel no evalúa horarios locales» son suyos.

Del código: `src/app/[slug]/layout.tsx`, `src/app/[slug]/page.tsx`,
`src/lib/storeClosure.ts`, `src/components/store/BranchCard.tsx`,
`src/components/store/BranchBar.tsx`,
`src/components/store/StoreClosedNotice.tsx`,
`src/components/store/StoreTrail.tsx`,
`src/components/store/StoreSearchBox.tsx`,
`src/features/admin/components/StoreList.tsx`, los primitivos
`src/components/ui/Alert.tsx`, `src/components/ui/Badge.tsx`,
`src/components/ui/Container.tsx`, `src/theme/tokens.css`,
`src/features/theming/storeTheme.ts`, `src/features/catalog/server/queries.ts`
y los dos sensores que este diseño usa como verificación,
`scripts/check-bundle-budget.mjs` y `scripts/check-theme-tokens.mjs`.

**Se miró la pantalla de verdad, en los tres anchos y en los dos temas.**
Levanté `npm run dev` en el puerto 3022 de este worktree —el 3000 lo tiene
ocupado un `next dev` de cuadrecaja en otro worktree, ficha
`.agent/playbook/next-dev-uno-por-directorio.md`— contra el Postgres del
`docker-compose.yml` ya levantado, y capturé `/tienda-demo` y `/tienda-dos` con
Playwright a 360, 768 y 1280, en `light` y en `dark`.

Lo que hay hoy y este diseño no puede contradecir:

- **Cabecera** `bg-brand text-brand-contrast` con el nombre de la tienda a la
  izquierda; la ciudad aparece a partir de `sm` (`· La Habana` en el 1280);
  `Carrito` y `Cuenta` a la derecha. `tienda-demo` sale azul, `tienda-dos`
  verde: la marca cae de verdad.
- Debajo, dentro de `<Container className="pt-4 pb-8">`: la ruta
  (`<nav aria-label="Ruta">` con `mb-4` y `min-h-11`), el buscador
  (`max-w-2xl`), el `<h1>Catálogo</h1>` en `text-2xl font-semibold` con
  `Filtrar y ordenar` a la derecha, la descripción en `text-fg-muted`, los chips
  de categoría y la rejilla `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`.
- **A 360 px el contenido mide 328 px** (`max-w-6xl px-4`) y a 768 son 672 px
  (`sm:px-6`). Ninguno de los tres anchos hace scroll horizontal.
- **A 360×800 la primera imagen de producto empieza en y≈430** y el nombre del
  primer producto en y≈628. Ese número es el que acota cuánto espacio vertical
  puede gastar este diseño antes de empujar el catálogo fuera de la pantalla, y
  está medido, no estimado.
- **La tira de sucursal no aparece** en ninguna de las dos tiendas sembradas
  (`branchCount <= 1`, `BranchBar` devuelve `null`), así que el primer elemento
  tras la cabecera es la ruta. El diseño tiene que funcionar con y sin esa tira.
- **Ninguna de las dos tiendas sembradas está cerrada**, así que el aviso de
  `StoreClosedNotice` no se pudo ver en pantalla en este ciclo; se leyó su
  código y el de `resolveStoreClosureHeadline`.

## Lo que cambió con `AP1`, y por qué

`AP1` no ajustó un detalle: cambió **qué se comunica**. Merece quedar escrito,
porque un lector futuro va a encontrar en la spec un SP5 que promete un hueco
dinámico y unos escenarios E2 y E13 redactados para un cartel en vivo.

| Ciclo 1 (lo que la spec fijó)                         | Ciclo 2 (lo que se construye)                              |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Un **estado**: «Atendiendo ahora», «Fuera de horario» | El **horario publicado** de la semana. Ningún estado       |
| Hueco dinámico dentro de `<Suspense>`                 | HTML cacheado, el mismo que ya sirve el CDN                |
| Un `fallback` que no podía afirmar nada               | **No hay `fallback`, porque no hay hueco**                 |
| Ocho estados de copy cruzados con «cierra a las…»     | Una presentación: siete días compactados en tramos         |
| Vocabulario disjunto obligatorio (R11, I5)            | R11 se cumple sin esfuerzo. **I5 se disuelve** (ver abajo) |
| Riesgo de salto de layout al resolverse el hueco      | Ninguno: no hay nada que resolver                          |
| El instante de la petición entraba en la vista        | El instante **no entra** en ninguna parte de la vista      |

### Por qué el hueco no era posible

Tres hechos, dos suyos y uno mío, que apuntan al mismo sitio:

1. **`sdd-architect` lo midió con builds reales:** en Next 16.3.2, un
   `await connection()` dentro de un `<Suspense>` en una página con
   `export const revalidate` deja **la ruta entera** en dinámica y le quita su
   columna de revalidación. `cacheComponents: true` —el prerenderizado parcial
   de verdad— hace **fallar el build** con esta configuración, y contradice a
   `docs/adr/0006-isr-con-revalidacion-por-tag.md`, que lo declinó a propósito.
2. **La colisión con el sensor, que este documento ya había detectado desde el
   otro lado.** El ciclo 1 escribió, como verificación del presupuesto de
   cliente, que `scripts/check-bundle-budget.mjs` exige un `<slug>.html`
   prerenderizado y sale con código 1 diciendo «No store page was prerendered»
   si no lo hay. Con el hueco dinámico, `/[slug]` habría dejado de
   prerenderizarse y **ese mismo sensor habría puesto roja la etapa `bundle`**,
   arrastrando con ella el criterio 7 del feature. Lo que en el ciclo 1 era el
   guardián de R14 resultó ser también la prueba de que el mecanismo era
   inviable.
3. **La decisión del humano cerró el trilema por la esquina correcta.** De las
   tres cosas —cartel correcto en el instante, HTML cacheado y cero
   JavaScript— solo se podían tener dos, y las dos que se quedan son las que
   protegen al usuario de este producto: la página sale del CDN y el navegador
   no recibe nada nuevo.

### Por qué es el horario de la SEMANA y no el de hoy

Ésta no es una decisión de gusto, y hay que leerla despacio porque es el punto
donde un implementador bienintencionado va a romper el feature:

**«Qué día es hoy» también depende del instante.** Un «Hoy atendemos de 9:00
a.m. a 6:00 p.m.» metido en HTML cacheado enseñaría el día equivocado durante
hasta una hora después de medianoche —y en una tienda con poco tráfico, durante
todo el tiempo que pase entre dos visitas, porque con ISR el primer visitante
después del vencimiento recibe el HTML rancio y la regeneración va detrás—. Un
sábado leyendo el horario del viernes es exactamente el mismo error que este
feature existe para arreglar, solo que a un día de distancia en vez de a cinco
husos.

**El horario de la semana, en cambio, se puede cachear sin mentir nunca.** Es un
dato de la tienda, no del momento: cambia cuando el POS publica un calendario
nuevo, y eso ya dispara `revalidateTag` (ADR 0006). Y le da al comprador algo
que hasta hoy no tenía en ninguna parte del producto: la respuesta a «¿a qué
hora abren los domingos?».

Consecuencia dura, y es un requisito: **nada en esta pantalla puede depender de
`now`.** Ni «hoy», ni «mañana», ni «abre en 3 horas», ni resaltar el día actual
en la lista. Ver A5, que lo convierte en algo comprobable.

### Por qué I5 se disuelve

I5 decía: «Abierta» y «Cerrada ahora» ya significan `status` en `BranchCard` y
en `StoreList`, así que un cartel de horario que reutilizara esas palabras
haría que dos cosas distintas dijeran lo mismo. R11 nació de ahí.

**Con el horario de la semana no hay dos afirmaciones que competir.** El
interruptor sigue diciendo si la tienda está abierta; el horario dice a qué hora
abre cada día. Son una afirmación de estado y una tabla de datos: no se
contradicen ni con las mismas palabras. El ciclo 1 necesitaba un vocabulario
disjunto («atender» frente a «abrir/cerrar») porque las dos afirmaciones iban a
convivir en la misma pantalla; el ciclo 2 no lo necesita, y por eso `DP2`
—confirmar ese vocabulario— **quedó sin objeto**.

R11 se sigue cumpliendo, y ahora casi por accidente: las únicas palabras de esta
pantalla son los siete días de la semana, `de … a …` y `no abre`. Ninguna es
«Abierta», «Cerrada», «Cerrada ahora» ni «Suspendida». Sigue verificado con un
`grep` (V11), porque una regla que se cumple sin esfuerzo se rompe igual de
fácil en la primera edición.

## Flujo de usuario

No hay pantallas nuevas, no hay navegación nueva, no hay nada interactivo y **no
hay ningún estado de carga**. El flujo entero es un HTML que ya estaba cacheado.

```text
El comprador escanea el QR de la pared / abre el enlace
        │
        ▼
GET /[slug]                    ← el mismo HTML del CDN que ya se servía
        │
        ├─ ¿status !== PUBLISHED?  ──► StoreClosedNotice, como hoy.
        │                              SIN horario (R8, E9).
        │
        ├─ ¿openingHours ausente o ilegible?
        │                          ──► la página de siempre, byte a byte.
        │                              SIN bloque, SIN hueco, SIN placeholder.
        │
        └─ tienda PUBLISHED con calendario legible
                 │
                 ▼
        Entre la ruta y el buscador, el horario de la semana:
             «Horario: todos los días de 9:00 a.m. a 6:00 p.m.»
          o  «Horario de atención»
             Lunes a viernes   de 9:00 a.m. a 6:00 p.m.
             Sábado            de 9:00 a.m. a 1:00 p.m.
             Domingo           no abre
                 │
                 ▼
        El comprador decide: busca, navega el catálogo, añade al carrito
        y hace el pedido. Fuera de horario TAMBIÉN (SP4 = (a)).
```

Tres cosas que el flujo deja claras:

- **El horario no es una puerta.** No cambia ni un control de lo que hay debajo:
  el carrito sigue en la cabecera, el botón de añadir sigue habilitado, el
  checkout sigue aceptando el pedido y el `409 STORE_CLOSED` sigue significando
  el interruptor. Un comprador que a las 3 de la madrugada lee «Domingo: no
  abre» y hace su pedido igual está haciendo exactamente lo que el negocio
  quiere. **Es él quien decide**, que es la frase con la que el humano cerró
  `AP1`.
- **La vuelta atrás no existe porque no hay avance que perder.** No hay
  interacción, no hay estado, no hay nada que se resuelva después. El bloque
  está en el HTML o no está.
- **La misma URL dice lo mismo a las 17:59 y a las 18:01**, y eso ahora es
  correcto en vez de un bug: lo que dice es el horario publicado, que a esas dos
  horas es el mismo. E13 de la spec describía el comportamiento del cartel en
  vivo del ciclo 1; con `AP1` lo que hay que verificar es lo contrario, que el
  contenido **no** cambia con la hora (V7).

## Inventario de pantallas y estados

Una sola pantalla toca este feature: `/[slug]` en modo sucursal. Todo lo demás
aparece en la tabla para decir explícitamente que **no cambia**.

| #   | Pantalla y condición                                                  | Qué se ve                                                               |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P1  | `/[slug]` sucursal, `PUBLISHED`, semana que compacta a un tramo       | Una línea: `Horario: todos los días de 9:00 a.m. a 6:00 p.m.`           |
| P2  | `/[slug]` sucursal, `PUBLISHED`, semana de 2 a 7 tramos               | El rótulo `Horario de atención` y la lista de tramos, uno por línea     |
| P3  | `/[slug]` sucursal, `PUBLISHED`, calendario con los siete días vacíos | Una frase: `Esta tienda no tiene ningún día de apertura en su horario.` |
| P4  | `/[slug]` sucursal, `PUBLISHED`, `openingHours` nulo (E8)             | La página de hoy, **sin nada nuevo**                                    |
| P5  | `/[slug]` sucursal, `PUBLISHED`, calendario ilegible (E12)            | Igual que P4, y un `console.warn("[hours] …")` en el servidor           |
| P6  | `/[slug]` sucursal, `status !== "PUBLISHED"` (E9)                     | `StoreClosedNotice` como hoy. **Ningún** horario                        |
| P7  | `/[slug]` en modo selector de marca                                   | Sin cambios. Ver § Dónde NO entra el horario                            |
| P8  | `/[slug]` sucursal, `DRAFT` o inexistente                             | 404 como hoy                                                            |
| P9  | `/[slug]/p/[productSlug]`, `/catalogo`, `/c/…`, `/buscar`             | Sin cambios en este feature (`DP3` = no)                                |
| P10 | `/[slug]/carrito`, `/checkout`, `/pedido/[code]`                      | Sin cambios (`DP5`)                                                     |
| P11 | `/admin/tiendas` y la ficha de tienda del panel                       | Sin cambios. Ver § Dónde NO entra el horario                            |

Y los estados aburridos, que son la mitad del trabajo:

- **Cargando: no existe, y es una afirmación, no un olvido.** El bloque sale del
  mismo HTML prerenderizado que el resto de la página. No hay `<Suspense>`, no
  hay `fallback`, no hay esqueleto, no hay `loading.tsx`. Si en la
  implementación aparece cualquiera de esas cuatro cosas, el diseño se
  implementó mal.
- **Vacío** = P4, y «vacío» significa _nada_: sin calendario la página tiene que
  quedarse **idéntica** a la de antes del feature. Se verifica comparando el
  HTML (V6). Nada de un `Horario: —`, ni de un rótulo con la lista en blanco: un
  hueco etiquetado le dice al comprador que falta algo, cuando lo que pasa es
  que la tienda no publicó horario.
- **Error** = P5. Un calendario que el lector no entiende no produce ni un
  bloque roto ni un 500: produce P4 más un aviso en el servidor. El horario **no
  puede llevarse la página por delante** (A4).
- **Parcial no existe.** O se pintan los siete días, o no se pinta nada. Un
  calendario legible tiene las siete claves por construcción (el schema del
  arquitecto las exige), así que «faltan tres días» no es un estado alcanzable.
- **Sin permiso** no aplica: la tienda es pública y el bloque es idéntico para
  todo el mundo. No depende de sesión, de cookie ni de quién mira — que es
  justamente lo que permite que viva en HTML cacheado.

## Dónde va el horario, y dónde no

### Dónde va

Dentro de `<Container className="pt-4 pb-8">` de `src/app/[slug]/page.tsx`,
**inmediatamente después de `<StoreTrail>` y antes de `<StoreSearchBox>`**, en
el camino de la tienda `PUBLISHED` en modo sucursal.

Por qué ahí:

- **Es el punto de decisión.** El horario sirve para decidir si merece la pena
  pedir ahora o esperar, y esa decisión se toma **antes** de llenar un carrito,
  no en la pantalla de confirmación.
- **Cabe sin empujar el catálogo fuera de la pantalla, y está medido.** Hoy, a
  360×800, la primera imagen de producto empieza en y≈430. El bloque cuesta
  ~24 px en P1 (una línea con su margen), ~68 px en el caso típico de tres
  tramos y ~160 px en el peor caso de siete tramos con envolturas. Incluso en el
  peor caso la primera fila de tarjetas sigue empezando por encima de los 600 px
  y se ve en un móvil de 800 px de alto. **Un bloque que hay que buscar no está
  entregado**: el pie de una página de catálogo en móvil está a dos mil píxeles
  de scroll, y poner ahí el horario es lo mismo que no publicarlo.
- **Está en el orden de lectura correcto** para un lector de pantalla: ruta →
  horario de la tienda → buscador → catálogo, sin ninguna región nueva y sin
  ningún salto.
- **No va dentro de la sección `Catálogo`.** El `<h1>Catálogo</h1>` abre la
  sección de productos; el horario es información de la tienda, no del catálogo,
  y meterlo debajo de ese encabezado lo dejaría fuera de sitio en el esquema del
  documento.
- **No va en la cabecera.** Es un bloque de una a siete líneas y la cabecera es
  una franja de una sola, sobre `bg-brand`, con el nombre truncado y dos
  iconos. No cabe, y sobre el color de la marca el texto secundario pierde
  contraste en cuanto una tienda elige un tono claro.
- **No va en la tira `BranchBar`.** Es un `<nav aria-label="Sucursal">` cuyo
  trabajo es cambiar de sucursal, y solo existe con `branchCount > 1`. Colgar el
  horario de un componente condicional lo haría desaparecer justo en las
  tiendas de una sola sucursal, que son las dos sembradas y la mayoría de las
  reales.
- **Cuando `BranchBar` sí aparece**, el orden queda: tira de sucursal (banda
  `bg-surface-muted` a ancho completo) → ruta → horario. No hay dos bandas
  grises seguidas, porque el bloque del horario **no lleva fondo propio**.

### Dónde NO entra, y por qué

| Sitio                                                              | En este feature | Motivo                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/store/BranchCard.tsx` y el selector de marca       | **No**          | Es la decisión que la spec dejó a diseño y arquitectura, y la respuesta es no. La tarjeta de sucursal es una lista de decisión de una línea por sucursal, y meterle de una a siete líneas de horario en cada una la convierte en un muro. Queda como propuesta (§ Qué queda fuera), y el coste de traerlo está medido en architecture.md |
| `src/features/admin/components/StoreList.tsx` y la ficha del panel | **No**          | El panel no tiene todavía editor de horarios (F-011): mostrar un horario que el administrador no puede corregir es enseñarle un dato ajeno sin darle la manija. Cuando exista el editor, el horario se verá **dentro** de él                                                                                                             |
| La ficha de producto, el catálogo, las categorías y la búsqueda    | **No** (`DP3`)  | El horario contesta una pregunta de entrada a la tienda. Repetirlo en cinco rutas más no añade información y multiplica por cinco la superficie de un cambio de copy                                                                                                                                                                     |
| El carrito, el checkout y la página del pedido                     | **No** (`DP5`)  | Ahora que no cuesta nada técnicamente, el argumento que queda es de foco: en el checkout el comprador ya decidió, y un horario ahí compite con los campos que tiene que rellenar. Ver `DP5`                                                                                                                                              |
| Los metadatos (`generateMetadata`, OpenGraph)                      | **No**          | El horario en el `title` o en la descripción de compartir gasta el espacio que hoy usa la descripción de la tienda, que vende más. Y una tienda con siete tramos no cabe en un `meta description`                                                                                                                                        |
| El pie de la página, en `src/app/[slug]/layout.tsx`                | **No** (`DP5`)  | Es donde más se parece a un sitio web convencional —el pie ya lleva `store.address`—, pero el pie del layout envuelve **siete rutas**, incluido el checkout, y en móvil está debajo de todo el catálogo. Ver `DP5`                                                                                                                       |

## La jerarquía cuando hay dos motivos de cierre

R8 fija el orden y este diseño lo lleva a la pantalla sin matices:

| `status`    | Calendario         | Qué se pinta                               |
| ----------- | ------------------ | ------------------------------------------ |
| `DRAFT`     | cualquiera         | 404 (como hoy)                             |
| `SUSPENDED` | cualquiera         | Solo `StoreClosedNotice`. **Cero** horario |
| `PUBLISHED` | ausente o ilegible | Nada nuevo: la página de siempre           |
| `PUBLISHED` | legible            | El horario de la semana (P1, P2 o P3)      |

**El interruptor gana, y el horario no se subordina: desaparece.** No hay
versión atenuada, ni segunda línea, ni paréntesis. Tres motivos, y el primero
cambió de forma con `AP1` pero no de conclusión:

1. **Sería un dato sin uso, colocado donde estorba.** «Lunes a viernes de 9:00
   a.m. a 6:00 p.m.» en una tienda suspendida no le sirve de nada al comprador:
   el lunes a las 9:00 seguirá sin tomar pedidos, porque lo que la cerró no es
   el reloj. La spec lo dice en E9 con estas palabras: «cerrada porque el
   negocio la cerró» y «cerrada porque son las 3:00» no se muestran juntas.
2. **La página cerrada tiene que seguir siendo la más ligera de la app**, que es
   lo que el comentario de `src/components/store/StoreClosedNotice.tsx` ya
   promete.
3. **El aviso que ya existe es accionable y el horario no.** `StoreClosedNotice`
   lleva el botón de WhatsApp y la dirección: es lo que el comprador puede
   _hacer_. Un horario por encima le quita foco a lo único que sirve ahí — y si
   quiere saber cuándo vuelven, el botón de WhatsApp lo pregunta mejor que una
   tabla.

## La presentación de la semana

Siete días son siete líneas, y siete líneas encima del catálogo en un móvil es
demasiado para la mayoría de las tiendas, que abren igual casi todos los días.
La compactación es, por tanto, parte del diseño y no un adorno.

### Cómo se compacta

Un algoritmo determinista, puro y verificable con una tabla de entradas y
salidas:

1. **Se renderiza el valor de cada día**, en el orden fijo de la semana:
   `lun, mar, mié, jue, vie, sáb, dom`. El valor es la cadena de sus ventanas
   (`de 9:00 a.m. a 6:00 p.m.`) o `no abre` cuando el día es `[]`.
2. **Se agrupan los días consecutivos con el mismo valor** en tramos. Solo
   **consecutivos**: nunca se juntan días salteados.
3. **Cada tramo se rotula** según cuántos días abarca:
   - uno: `Lunes`
   - dos: `Lunes y martes`
   - tres o más: `Lunes a viernes`
4. **Si sale un solo tramo** —los siete días con el mismo valor—, el rótulo es
   `todos los días` y el bloque se colapsa en la línea única de P1.
5. **Si los siete días son `[]`**, no se rotula nada: se pinta la frase de P3.

Por qué solo días consecutivos, cuando juntar los salteados daría menos
líneas: «Lunes, miércoles y viernes de 9:00 a.m. a 6:00 p.m.» obliga al lector a
reconstruir la semana en la cabeza para saber qué pasa el martes, y con dos
grupos salteados que se cruzan el orden de las líneas deja de ser el orden de la
semana. Una lista de horarios se lee de lunes a domingo; romper ese orden ahorra
una línea y cuesta la comprensión. El tope es **siete líneas**, que es lo que
tiene una semana.

### Los tres casos, con datos reales

**Caso 1 — una tienda que abre igual todos los días** (un tramo, P1):

```text
Horario: todos los días de 9:00 a.m. a 6:00 p.m.
```

**Caso 2 — el caso típico, tres tramos** (P2):

```text
Horario de atención
Lunes a viernes    de 9:00 a.m. a 6:00 p.m.
Sábado             de 9:00 a.m. a 1:00 p.m.
Domingo            no abre
```

**Caso 3 — el peor caso, con dos ventanas y un cruce de medianoche** (P2, cinco
tramos; es el calendario que el caso límite 5 pide sembrar):

```text
Horario de atención
Lunes              de 9:00 a.m. a 6:00 p.m.
Martes             de 9:00 a.m. a 1:00 p.m. y de 3:00 p.m. a 6:00 p.m.
Miércoles          no abre
Jueves             de 9:00 a.m. a 6:00 p.m.
Viernes            de 10:00 p.m. a 2:00 a.m. del día siguiente
Sábado             abierto las 24 horas
Domingo            no abre
```

En el caso 3 los tramos no compactan nada porque el calendario no se repite:
siete líneas para una semana irregular, que es la información que esa tienda
necesita publicar. Y ahí el bloque cuesta ~160 px con las envolturas de 360 px,
que sigue dejando la primera fila de tarjetas por encima de los 600 px.

## Estructura por breakpoint

| Zona                          | 360px                                                                               | 768px                                                            | 1280px        |
| ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------- |
| Cabecera                      | Sin cambios                                                                         | Sin cambios (aparece `· ciudad`)                                 | Sin cambios   |
| Tira de sucursal (si aparece) | Sin cambios                                                                         | Sin cambios                                                      | Sin cambios   |
| Ruta                          | Sin cambios (`mb-4`)                                                                | Sin cambios                                                      | Sin cambios   |
| **Horario, caso P1**          | Una línea; envuelve a dos si hace falta                                             | Una línea                                                        | Una línea     |
| **Horario, caso P2**          | Rótulo, y cada tramo en su línea: **día y horas seguidos**, envolviendo si no caben | Rótulo, y cada tramo con el **día en una columna de ancho fijo** | Igual que 768 |
| **Horario, caso P3**          | Una frase; envuelve a dos                                                           | Una frase                                                        | Una frase     |
| Buscador                      | Sin cambios (`max-w-2xl`)                                                           | Sin cambios                                                      | Sin cambios   |
| Resto de la página            | Sin cambios                                                                         | Sin cambios                                                      | Sin cambios   |

**El corte es `sm` (640 px), el que ya usa toda la tienda** (`sm:px-6`,
`sm:grid-cols-3`, el `sm:inline` de la ciudad). No se introduce ningún
breakpoint nuevo.

Qué cambia de verdad en ese corte, y por qué:

- **A 360 px el día y sus horas van seguidos en flujo**, separados por un
  espacio, y envuelven juntos: `flex flex-wrap items-baseline gap-x-2`. Con
  328 px de contenido y `text-sm`, un tramo como `Lunes a viernes de 9:00 a.m. a
6:00 p.m.` son 40 caracteres, ~280 px: entra en una línea. El tramo más largo,
  `Martes de 9:00 a.m. a 1:00 p.m. y de 3:00 p.m. a 6:00 p.m.`, envuelve a dos
  líneas con las horas alineadas al margen izquierdo, que es lo correcto en una
  columna estrecha: una columna de días de ancho fijo a 360 px robaría un tercio
  del ancho para escribir `Miércoles`.
- **A partir de 640 px el día ocupa una columna de ancho fijo** y las horas
  arrancan todas a la misma altura: `sm:grid sm:grid-cols-[8rem_1fr]`. Con siete
  tramos, una rejilla se lee de un golpe y una lista en flujo no. `8rem` es el
  ancho de `Lunes a viernes` en `text-sm`, el rótulo más largo de los posibles.
- **Una sola columna de tramos en los tres anchos.** Partir la semana en dos
  columnas a 1280 px ahorraría altura y rompería el orden de lectura: el domingo
  aparecería arriba a la derecha, al lado del lunes.
- **Nada se oculta en ningún ancho.** No hay `truncate` ni `line-clamp` en este
  bloque, a diferencia del nombre de la tienda en la cabecera: un horario
  recortado es peor que ningún horario.

## Componentes de UI

### Se reutiliza

- `src/components/ui/Container.tsx` — el que ya envuelve la página. El bloque
  vive dentro y no crea contenedor propio.
- Nada más, y es una decisión.

### Se crea

El componente de presentación que `architecture.md` ya nombra:
src/components/store/StoreHoursNotice.tsx (por crear, F-022). Server component,
sin estado, sin eventos, sin `"use client"` y sin importar nada del navegador.
**Cambia su prop respecto al ciclo 1**: recibe el horario semanal ya leído, no
un estado en vivo. El arquitecto lo cerró así, y este diseño se escribe contra
esa forma:

```ts
export type WeeklyScheduleDay = { day: DayKey; windows: OpeningWindow[] };
export function readWeeklySchedule(value: unknown): WeeklyScheduleDay[] | null;
```

Siempre **siete entradas en orden `mon → sun`**, `windows: []` es el día
cerrado, y `null` es «no se pinta nada» (P4, P5).

**Que la vista reciba un array de siete y no el objeto `days` no es una
comodidad: es una corrección.** El calendario viaja en una columna `Json` y pasa
por la caché, así que el orden de las claves del objeto es **el de inserción del
POS** y puede empezar en domingo. Pintar la semana recorriendo las claves del
objeto daría, en esa tienda, una lista que empieza por el domingo y que además
compacta mal —los tramos de § Cómo se compacta son de días **consecutivos**, y
«consecutivo» solo significa algo si el orden es el de la semana—. Regla, por
tanto: **la vista nunca itera el objeto crudo**; recorre el array que le llega,
y el orden de la semana lo garantiza quien lo construye.

Y la compactación con su copy, en una función pura verificable sin React ni DOM:
src/lib/openingHoursCopy.ts (por crear, F-022). La ubicación final la fija el
plan con el arquitecto; lo que este diseño exige es que **exista separada del
JSX**, porque el algoritmo de tramos y los bordes del formato de 12 horas
(medianoche, mediodía, `24:00`, el cruce de día) se prueban con una tabla de
entradas y salidas, no renderizando siete pantallas.

### Por qué no `Badge` ni `Alert`, que ya existen

| Primitivo                     | Por qué no                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/ui/Badge.tsx` | Es una pastilla de una palabra para un **estado**, y aquí no hay estado que mostrar: hay una tabla de datos. Además es el lenguaje del interruptor en `BranchCard` y en `StoreList`, y su cuerpo lleva `text-{tono}` sobre fondo translúcido, el patrón que la ficha del playbook midió en 2,17:1 antes de que F-019 moviera el token |
| `src/components/ui/Alert.tsx` | Pone `role="alert"` en los tonos `danger` y `warning`, y `role="status"` en los otros. **Un horario no es una alerta ni un estado**: es información permanente de la tienda. Y las dos marcas son regiones vivas, que aquí no tienen ningún sentido porque nada llega tarde                                                           |

La estructura, descrita para que se pueda escribir sin ambigüedad. Caso P1:

```text
<p class="mb-4 text-sm">
  <span class="font-medium">Horario:</span> todos los días de 9:00 a.m. a 6:00 p.m.
</p>
```

Caso P2:

```text
<section aria-labelledby="horario" class="mb-4 text-sm">
  <p id="horario" class="font-medium">Horario de atención</p>
  <dl class="mt-1 sm:grid sm:grid-cols-[8rem_1fr] sm:gap-x-3">
    <div class="flex flex-wrap items-baseline gap-x-2 sm:contents">
      <dt class="font-medium">Lunes a viernes</dt>
      <dd class="text-fg-muted">de 9:00 a.m. a 6:00 p.m.</dd>
    </div>
    …
  </dl>
</section>
```

Caso P3:

```text
<p class="mb-4 text-fg-muted text-sm">
  Esta tienda no tiene ningún día de apertura en su horario.
</p>
```

Son bloques de ejemplo, no código a copiar: el implementador puede llegar a la
misma estructura de otra forma, siempre que se cumplan la semántica del `<dl>`,
el orden de lectura y la ausencia de `role` y de `aria-live`.

## Tokens y tema

**Ningún token nuevo.** `src/theme/tokens.css` no se toca, y eso es a propósito:
la propuesta `.agent/specs/propuestas/contraste-de-tokens-de-tema.md` está
abierta justamente porque nadie sabe cuántos tokens no llegan a su umbral, y
este diseño no añade un caso más a ese inventario.

| Elemento                   | Token                                                      | Por qué ése                                                                                                    |
| -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rótulo (`Horario`, el día) | `text-fg` (heredado) + `font-medium`                       | Contraste máximo garantizado, el mismo par `fg`/`bg` que todo el texto de la tienda                            |
| Las horas                  | `text-fg-muted`                                            | Jerarquía sin bajar de umbral: el mismo token de la descripción de la tienda y de la ubicación en `BranchCard` |
| `no abre`                  | `text-fg-muted`                                            | Es un valor como cualquier otro, no una advertencia                                                            |
| La frase de P3             | `text-fg-muted`                                            | Ídem                                                                                                           |
| Caja                       | `mb-4`, `mt-1`, `gap-x-2`, `sm:gap-x-3`, `text-sm`, `8rem` | Toda la escala ya en uso en la tienda                                                                          |

**El horario no usa ni un token de color de estado, y ése es el resultado más
limpio de `AP1`.** El ciclo 1 necesitaba `positive` y `warning` para codificar
«atendiendo» y «fuera de horario», con toda la discusión de contraste que eso
arrastraba. Aquí no hay estado, así que **no hay color con significado**: solo
texto sobre el fondo de la página, en dos niveles de jerarquía que ya existen.
Nada depende del color, ni del punto, ni del tono.

**Y no reacciona al branding, a propósito.** Los cuatro únicos tokens que una
tienda puede sobrescribir son `brand`, `brandContrast`, `accent` y
`accentContrast`, más la escala de `radius` (`themeTokensSchema` en
`src/features/theming/storeTheme.ts`, que es `.strict()`). `fg` y `fg-muted` no
están en esa lista, así que el horario se lee igual en `tienda-demo` (azul) y en
`tienda-dos` (verde). No se usa `text-brand`: sería el único texto de la página
cuyo color cambia sin que cambie su significado, y en una tienda con una marca
clara el horario dejaría de leerse.

### Claro y oscuro

El par que carga el contenido, en los valores declarados de
`src/theme/tokens.css`:

| Tema   | Rótulo                               | Horas                                      | Fondo                                |
| ------ | ------------------------------------ | ------------------------------------------ | ------------------------------------ |
| Claro  | `--color-fg` `oklch(0.22 0.015 256)` | `--color-fg-muted` `oklch(0.52 0.015 256)` | `--color-bg` `oklch(0.99 0.003 256)` |
| Oscuro | `--color-fg` `oklch(0.95 0.005 256)` | `--color-fg-muted` `oklch(0.7 0.012 256)`  | `--color-bg` `oklch(0.17 0.012 256)` |

Los cuatro son pares ya en uso en toda la tienda, pero **este documento no
afirma un número sin medirlo**: la ficha
`.agent/playbook/alert-tone-hereda-color-en-body-de-texto-largo.md` existe
porque un `design.md` dio por bueno un «3:1 admisible» que en el DOM real era
2,17:1. La verificación V4 mide el rótulo y las horas con la técnica del canvas
1×1, componiendo contra el fondo real, en claro y en oscuro, con umbral **4,5:1
para los dos** — no se pide el 3:1 de texto grande, porque `text-sm` no es texto
grande.

## Accesibilidad

- **Orden de foco: sin cambios.** El bloque no tiene nada enfocable. La
  secuencia sigue siendo cabecera (nombre, Carrito, Cuenta) → migas de la ruta →
  campo de búsqueda → `Buscar` → `Filtrar y ordenar` → chips de categoría →
  tarjetas. Verificable tabulando, y verificable en negativo: el horario no
  puede aparecer en el recorrido (V9).
- **Semántica de lista de definiciones.** Los tramos van en un `<dl>` con
  `<dt>` para el día y `<dd>` para las horas, que es exactamente lo que un
  horario es: pares de término y valor. Un lector de pantalla lo anuncia como
  lista y da el número de elementos, así que el usuario sabe cuántos tramos hay
  antes de recorrerlos. Con `<div>` sueltos perdería las dos cosas.
- **El `sm:contents` de la fila no rompe la semántica**, pero hay que
  comprobarlo en vez de suponerlo: `display: contents` sobre el envoltorio de
  cada fila es lo que permite que `<dt>` y `<dd>` caigan en la rejilla de dos
  columnas, y en algunos motores ha eliminado el rol de sus hijos. V10 lo
  verifica leyendo el árbol de accesibilidad a 768 px; si el rol se pierde, la
  alternativa es una rejilla por fila en vez de una rejilla de bloque, y el
  diseño no cambia a la vista.
- **Sin región viva, y sin `role` ninguno.** Ni `aria-live`, ni `role="status"`,
  ni `role="alert"`. Nada llega tarde: el bloque está en el HTML inicial. Con
  `AP1` esto pasó de ser una decisión delicada —en el ciclo 1 había que evitar
  que el cambio del `<Suspense>` sonara como una alerta— a ser lo obvio.
- **El rótulo nombra la sección** con `aria-labelledby` apuntando al `<p>` que
  ya se ve, no con un `aria-label` duplicado: un solo texto, visible y
  accesible, que no puede divergir de sí mismo.
- **No es un encabezado.** El rótulo es un `<p class="font-medium">`, no un
  `<h2>`: no titula una sección del documento y un `<h2>` antes del
  `<h1>Catálogo</h1>` desordenaría el esquema de encabezados de la página.
- **Nada depende del color** (§ Tokens y tema).
- **Área de toque: no aplica**, porque no hay ningún control. Si `DP5` o la
  propuesta del selector añaden algún día un enlace, hereda el `min-h-11` que ya
  usan la ruta y el buscador.
- **Teclado: nada nuevo.** Ningún atajo, ningún foco que se mueva, ningún
  contenido que aparezca o desaparezca.
- **Ninguna imagen ni icono**, así que no hay texto alternativo que escribir.
- **El rango se escribe con la palabra `a`, nunca con un guion ni una raya**
  (`de 9:00 a.m. a 6:00 p.m.`, no `9:00 a.m. – 6:00 p.m.`). Un lector de
  pantalla lee `–` de formas distintas según el motor y la configuración —a
  veces «menos», a veces nada—, y «de nueve a seis» es lo que un hispanohablante
  dice en voz alta.
- **Zoom y texto grande**: al 200 % el bloque crece con el contenido y envuelve
  sin recortar nada. La rejilla de dos columnas se apoya en `8rem`, que escala
  con la raíz, así que la columna del día crece con el texto en vez de
  apretarlo.

## Coste de cliente

**Cero bytes de JavaScript nuevo, y ahora es trivial de cumplir.** No hay
interacción, no hay estado, no hay `<Suspense>`, no hay hidratación: el bloque
es texto en el HTML prerenderizado. Nada de esto puede llevar `"use client"` —
vive en el camino que renderiza el catálogo, donde `AGENTS.md` lo prohíbe sin
excepción— y ya no hay ningún motivo por el que alguien querría ponérselo.

Escrito como se comprueba, en cinco pasos ejecutables:

1. **`npm run check:bundle` no crece.** El presupuesto (`BUDGET_KB = 193` en
   `scripts/check-bundle-budget.mjs`) **no se toca**, y el número medido de la
   página más pesada tampoco debe subir: hoy F-023 lo dejó en 176,9 KB.
2. **Y el mismo guion vigila que la página siga cacheada.**
   `scripts/check-bundle-budget.mjs` exige que exista un `<slug>.html`
   prerenderizado y sale con código 1 diciendo «No store page was prerendered»
   si no lo hay. Con `AP1` esto pasó de ser el guardián de R14 a ser **la
   comprobación central del feature**: si alguien vuelve dinámica `/[slug]` —por
   ejemplo metiendo el instante para «resaltar el día de hoy»—, esta etapa se
   pone roja sola y arrastra el criterio 7. No hay que escribir nada nuevo para
   tenerlo.
3. `grep -rn "use client" src/components/store/` no devuelve ninguna línea nueva
   respecto a hoy.
4. `grep -rn "new Date()\|Date.now()" src/components/store/` sigue sin devolver
   nada. Con `AP1` esto es más fuerte que en el ciclo 1: **el instante no entra
   en la vista por ninguna puerta**, ni siquiera como prop.
5. El HTML servido contiene el horario (V5). Si solo apareciera tras hidratar,
   no estaría en el HTML: encontrarlo en un `curl` es la prueba de que se
   resolvió en el servidor.

Un aviso sobre el otro lado del presupuesto, porque `AGENTS.md` lo pide
explícitamente: **si algo de este diseño hiciera falta subir el número, se
sube.** No se recorta el bloque ni se esconden días para salvar unos kilobytes.
Simplemente no debería hacer falta, porque aquí no hay ni un byte de cliente que
añadir.

Y una nota que **no** es de este documento pero que el plan tiene que recoger:
`src/app/[slug]/` no tiene ni debe tener un `loading.tsx`. La ficha
`.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md` lo cuenta
entero: un `loading.tsx` en un segmento que puede llamar a `notFound()` —y
`/[slug]` lo llama para `DRAFT` y para un slug inexistente— compromete la
cabecera con un 200 y ese 404 desaparece. Con `AP1` no hay ninguna razón para
añadirlo, porque no hay nada que espere.

## Textos

Todo en español. **Ningún texto de esta pantalla afirma un estado**: no hay
«abierto», ni «cerrado ahora», ni «hoy», ni «mañana», ni «en 3 horas».

### Rótulos

| Situación              | Texto                                                           |
| ---------------------- | --------------------------------------------------------------- |
| Un solo tramo (P1)     | `Horario:` seguido de `todos los días de 9:00 a.m. a 6:00 p.m.` |
| Dos o más tramos (P2)  | `Horario de atención`                                           |
| Siete días vacíos (P3) | `Esta tienda no tiene ningún día de apertura en su horario.`    |

### Los días y los tramos

| Tramo            | Texto                         |
| ---------------- | ----------------------------- |
| Un día           | `Lunes` … `Domingo`           |
| Dos consecutivos | `Lunes y martes`              |
| Tres o más       | `Lunes a viernes`             |
| Los siete        | `todos los días` (solo en P1) |

Los siete nombres, con su clave del calendario, para que nadie los invente al
programar: `mon` → `Lunes`, `tue` → `Martes`, `wed` → `Miércoles`, `thu` →
`Jueves`, `fri` → `Viernes`, `sat` → `Sábado`, `sun` → `Domingo`. En un tramo de
dos o más, el **segundo** nombre va en minúscula (`Lunes y martes`, `Lunes a
viernes`), porque solo la primera palabra del rótulo abre la línea.

### Las horas

| Situación                       | Texto                                                 |
| ------------------------------- | ----------------------------------------------------- |
| Una ventana                     | `de 9:00 a.m. a 6:00 p.m.`                            |
| Dos o más ventanas              | `de 9:00 a.m. a 1:00 p.m. y de 3:00 p.m. a 6:00 p.m.` |
| Ventana que cruza la medianoche | `de 10:00 p.m. a 2:00 a.m. del día siguiente`         |
| Ventana que termina en `24:00`  | `de 10:00 p.m. a medianoche`                          |
| Ventana `00:00 → 24:00`         | `abierto las 24 horas`                                |
| Día sin ventanas (`[]`)         | `no abre`                                             |

### Las reglas de redacción, para que no se inventen al programar

- **Formato de 12 horas con `a.m.` y `p.m.`** (`DP1`, resuelta por el humano).
  Se escribe con puntos y en minúscula, separado de la hora por un espacio:
  `9:00 a.m.`, `6:00 p.m.`
- **La hora va sin cero a la izquierda y los minutos siempre con dos cifras**:
  `"09:00"` → `9:00 a.m.`; `"18:30"` → `6:30 p.m.` El `:00` **no se omite**
  (`9:00 a.m.`, no `9 a.m.`), porque «a las 9» se lee como aproximado y «a las
  9:00» como el horario que es.
- **Los cuatro bordes del reloj de 12 horas, escritos porque los cuatro se
  equivocan solos**: `"00:00"` → `12:00 a.m.`; `"12:00"` → `12:00 p.m.`;
  `"12:30"` → `12:30 p.m.`; `"00:30"` → `12:30 a.m.` Y el quinto, que no es una
  hora del reloj: **`"24:00"` nunca se imprime como hora**, se dice
  `medianoche`.
- **La conversión la hace la función de copy con aritmética sobre la cadena
  declarada, no `Intl`.** `toLocaleTimeString` volvería a meter un locale y una
  zona en el camino, que es lo que R2 prohíbe, y la spec ya midió que un
  `hour12: false` de más convierte la medianoche en `24:00` según la versión de
  ICU. Aquí no hay ningún `Date`: hay una cadena `HH:MM` y una tabla de reglas.
- **El cruce de medianoche se dice con todas las letras, y es la decisión de
  redacción más delicada del bloque.** La ventana llega **en el día en que
  abre** (`fri: 22:00 → 02:00`), que es lo correcto en el dato y lo confuso en
  la pantalla: `Viernes de 10:00 p.m. a 2:00 a.m.` a secas no le dice al lector
  si esa tienda cierra dos horas después de abrir o veinte antes. Tres opciones
  se consideraron y se descartaron dos:
  - **Partir la ventana en dos filas** (`Viernes de 10:00 p.m. a medianoche` y
    `Sábado de medianoche a 2:00 a.m.`). Descartada: inventa una ventana que el
    calendario no declara, rompe la compactación —dos días que eran iguales
    dejan de serlo— y le dice al comprador que hay un cierre a medianoche que no
    existe.
  - **Marcarlo con un símbolo** (`de 10:00 p.m. a 2:00 a.m. +1`). Descartada:
    hay que saber la convención para entenderla, y un lector de pantalla la lee
    como «más uno».
  - **Elegida: el sufijo `del día siguiente`.** Se lee solo, no necesita
    convención, se dice igual en voz alta y no toca la fila del sábado. Cuesta
    17 caracteres en la única fila que los necesita.
    Y una propiedad que hace esto seguro: el sufijo **no depende del instante**.
    Es información de la ventana, no del momento en que se lee, así que se puede
    cachear con el resto del bloque.
- **Nada de instantes absolutos, de zonas ni de desplazamientos** (R10). No
  aparece «UTC», ni «-04:00», ni «America/Havana», ni una fecha.
- **Ninguna palabra que dependa de `now`.** Prohibidas por escrito en esta
  pantalla: «hoy», «ahora», «mañana», «abre en», «cierra en», «esta semana». Es
  la mitad de copy del requisito A5, y se comprueba con un `grep` sobre el
  módulo de copy (V11).
- **Ninguna de estas palabras aparece en el bloque: «Abierta», «Cerrada»,
  «Cerrada ahora», «Suspendida», «Borrador».** Son del interruptor (R11). Ya no
  hay riesgo de que compitan (§ Por qué I5 se disuelve), y la comprobación se
  queda igual porque cuesta un `grep`.

### Textos que este feature NO escribe

- **El del interruptor no se toca**: `resolveStoreClosureHeadline`
  (`src/lib/storeClosure.ts`) y sus tres consumidores conservan sus cadenas tal
  cual, incluidas «Abierta» y «Cerrada ahora».
- **No hay texto de error para el comprador.** Un calendario ilegible no produce
  ninguna frase en pantalla: produce ausencia de bloque y un
  `console.warn("[hours] …")` en el servidor, que **nunca** es `console.error`
  porque eso pondría roja cualquier etapa que lea la salida del servidor (E12,
  `AGENTS.md`, y la ficha
  `.agent/playbook/console-error-dispara-guardian-servidor.md`).
- **No hay ningún texto en el panel** ni en el selector de marca.

## Lo que este diseño le pide a arquitectura

Necesidades, no firmas. `architecture.md` está en `borrador` y estas seis cosas
son lo que hay que conciliar en él; las cinco primeras son consecuencia directa
de `AP1`.

- **A1 — CONCILIADO. La prop es el horario semanal, no un estado.** El ciclo 1
  se escribió contra `{ status: StoreHoursStatus }`, que es un valor
  **dependiente del instante** y por tanto incompatible con `AP1`. El arquitecto
  ya lo cerró: `readWeeklySchedule(value): WeeklyScheduleDay[] | null`, siete
  entradas en orden `mon → sun`, `windows: []` para el día cerrado y `null` para
  «no se pinta nada». Este documento está escrito contra esa forma
  (§ Componentes de UI). Lo único que la vista necesita además es el `timezone`
  de la tienda, y solo para `DP4`. **No debe recibir un `now`**: lo que no llega
  no se puede usar por error.
- **A2 — El horario se lee en la parte cacheada.** Es la mitad válida del
  hallazgo A1 del ciclo 1, y ahora es más simple: «¿tiene esta tienda un
  calendario legible?» es una pregunta pura sobre `openingHours`, sin instante,
  así que se contesta donde ya se lee la tienda —el `cached()` con tags de
  `src/features/catalog/server/queries.ts`— y sin ninguna query nueva. Si la
  respuesta es `null`, **no se pinta nada** (P4, P5) y no queda ningún hueco que
  colapsar.
- **A3 — La compactación y el copy son una función pura**, con las siete
  entradas como entrada y los tramos ya redactados como salida. Se prueba con
  una tabla; la vista solo los coloca. Aquí es donde vive la regla de que un
  tramo agrupa días **consecutivos**, que depende de que el array llegue en
  orden de semana y no en el de las claves del `Json`.
- **A4 — La lectura no puede tirar la página.** `readWeeklySchedule` devuelve
  `null` y avisa, nunca lanza. Si lanzara, el error subiría hasta
  `src/app/error.tsx` y una tienda entera dejaría de verse por un horario mal
  escrito.
- **A5 — Ninguna ruta del catálogo puede llamar al evaluador.**
  `evaluateStoreHours` **sigue en alcance** —el criterio 2 lo exige y su test de
  tabla con tres husos lo verifica—, pero con `AP1` **ninguna vista lo consume**.
  Es un riesgo real: es exactamente la función que alguien va a querer enchufar
  «para resaltar el día de hoy», y hacerlo volvería dinámica `/[slug]`. La
  guarda es barata y este repo ya tiene la técnica en
  `src/lib/boundaries.test.ts`: un test que afirme que ningún archivo bajo
  `src/app/` ni bajo `src/components/` menciona `evaluateStoreHours`. Vale más
  que un párrafo en un documento.
- **A6 — `timezone` y la constante del default llegan a la vista** (para `DP4`).
  Las dos ya existen en el plan del arquitecto: `timezone` entra en el `select`
  de `loadStore` y `DEFAULT_STORE_TIMEZONE` vive en src/constants/storeHours.ts
  (por crear, F-022).

## Verificación visual

Con `npm run dev` en un puerto propio de este worktree (ficha
`.agent/playbook/next-dev-uno-por-directorio.md`) y la tienda sembrada con el
calendario del caso 3 —dos ventanas en un día, un día cerrado, un cruce de
medianoche y un día de 24 horas—, que es lo que el caso límite 5 pide sembrar.
Anchos 360, 768 y 1280, en `light` y en `dark`.

| #   | Qué mirar                                                                                                                     | Verde si                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| V1  | El bloque está entre la ruta y el buscador, en los tres anchos                                                                | Sí, y en ese orden en el DOM                                                           |
| V2  | Scroll horizontal a 360 px, con el calendario del caso 3                                                                      | No hay                                                                                 |
| V3  | La `y` de la primera imagen de producto a 360×800, con el peor caso de siete tramos                                           | Por debajo de 600 px: la primera fila de tarjetas se ve sin hacer scroll               |
| V4  | Contraste del rótulo y de las horas, canvas 1×1 contra el fondo compuesto real                                                | ≥ 4,5:1 los dos, en claro y en oscuro                                                  |
| V5  | `curl -s http://localhost:PUERTO/tienda-demo` y buscar el horario                                                             | El texto está en el HTML: se resolvió en el servidor                                   |
| V6  | Una tienda con `openingHours` nulo: el HTML entre el cierre de la ruta y la apertura del buscador                             | **Idéntico** al de antes del feature (E8)                                              |
| V7  | Dos peticiones a la misma URL separadas por un borde de ventana del calendario                                                | El horario dice **lo mismo** las dos veces: no depende del instante                    |
| V8  | `npm run check:bundle`                                                                                                        | Código 0, `<slug>.html` presente, KB medidos sin subir y `BUDGET_KB` sin tocar         |
| V9  | Tabulador desde la cabecera hasta la primera tarjeta                                                                          | El horario no aparece en el recorrido                                                  |
| V10 | El árbol de accesibilidad del `<dl>` a 768 px, con `sm:contents` aplicado                                                     | Los roles de lista de definiciones siguen ahí y el número de elementos es el de tramos |
| V11 | El módulo de copy: `grep` de «hoy», «ahora», «mañana», «Abierta», «Cerrada», «Suspendida»                                     | Sin resultados                                                                         |
| V12 | Una tienda con el interruptor apagado                                                                                         | `StoreClosedNotice` y **ningún** horario (E9)                                          |
| V13 | La marca: `tienda-demo` (azul) y `tienda-dos` (verde)                                                                         | El horario se lee igual en las dos; ningún color de marca lo toca                      |
| V14 | Los tres casos de § La presentación de la semana, y los cinco bordes del reloj (`00:00`, `12:00`, `12:30`, `24:00`, el cruce) | Los ocho se ven, con el texto literal de este documento                                |
| V15 | El `<Suspense>`, el `fallback`, el esqueleto y el `loading.tsx`                                                               | **No existe ninguno de los cuatro** en el diff del feature                             |

V14 es fácil ahora y conviene decir por qué: como nada depende del instante, los
tres casos y los cinco bordes se provocan **cambiando el calendario sembrado**,
sin esperar a que sea de madrugada y sin falsear ningún reloj. El ciclo 1
necesitaba forzar el `now` para ver sus ocho estados; éste no.

## Qué queda fuera

- **El estado en vivo de abierto/cerrado.** Es lo que `AP1` descartó. Volverá si
  algún día se adopta `cacheComponents` —una ADR que supere a la 0006, ~55
  archivos— o si el humano acepta pagarlo con la caché o con JavaScript de
  cliente. Con el horario publicado en pantalla, la necesidad es mucho menor:
  el comprador puede calcularlo él, que es lo que el humano decidió.
- **Resaltar el día de hoy en la lista.** Es la primera cosa que alguien va a
  querer añadir y es exactamente el bug que `AP1` evita: «qué día es hoy»
  depende del instante y en HTML cacheado sale mal. A5 lo convierte en un test.
- **El editor de horarios y de zona horaria del panel. Es F-011.** Este diseño
  no dibuja ni un campo, ni un selector de zona, ni una vista previa del
  calendario. Consecuencia práctica: hasta que ese editor exista, el único
  horario que se puede ver en pantalla es el que mande cuadrecaja o el que se
  ponga a mano en la base.
- **Que el horario bloquee comprar.** SP4 = (a): informa y nada más. Ningún
  control se deshabilita, ningún aviso aparece en el carrito o en el checkout, y
  el `409 STORE_CLOSED` sigue significando el interruptor.
- **Cambiar el vocabulario del interruptor.** «Abierta» y «Cerrada ahora» siguen
  donde están y significando lo que significan.
- **El horario en el selector de marca y en la tarjeta de sucursal.** Decidido
  que no. Es un buen candidato a propuesta propia, y ahora es más barata que en
  el ciclo 1 —sin instante no hay trilema, solo hay que traer `openingHours` de
  cada sucursal—; lo que sigue costando es el espacio: una lista de sucursales
  con siete líneas de horario por tarjeta deja de ser una lista de decisión.
- **Un token nuevo o cualquier cambio en `src/theme/tokens.css`.**
- **Medir el contraste de toda la paleta.** Es
  `.agent/specs/propuestas/contraste-de-tokens-de-tema.md`, no este feature.
  Aquí solo se miden el rótulo y las horas (V4).

## Preguntas al humano

### Resueltas en este ciclo, y no se vuelven a preguntar

- **`DP1` — formato de hora. RESUELTA: 12 horas con `a.m.`/`p.m.`**, «de 9:00
  a.m. a 6:00 p.m.». Aplicado en § Textos, con los cinco bordes del reloj de 12
  horas escritos uno por uno porque los cinco se equivocan solos.
- **`DP2` — el vocabulario `Atendiendo ahora` / `Fuera de horario`. SIN OBJETO.**
  Con `AP1` no se afirma ningún estado, así que no hay vocabulario de estado que
  elegir. El motivo largo está en § Por qué I5 se disuelve, y merece leerse:
  R11 nació de una colisión que ya no puede ocurrir.
- **`DP3` — ¿el horario entra también en la ficha de producto? RESUELTA: no** en
  este feature. Escrito en § Dónde NO entra el horario.

### Abiertas, y ninguna bloquea el plan

Las dos tienen recomendación **ya aplicada** en todo el documento, y cambiar
cualquiera de las dos toca la función pura de copy o una línea de colocación, no
la estructura, ni la semántica, ni la accesibilidad.

**`DP4` — ¿Se dice en algún sitio que el horario está en la hora de la tienda?**

Es hora de pared de la tienda (R10), y para un comprador cubano mirando una
tienda cubana decirlo es ruido. Para uno que mira desde otro huso, no decirlo
es una trampa silenciosa.

- **(a) Solo cuando la zona de la tienda no es la del producto. Recomendada.**
  Si `store.timezone !== DEFAULT_STORE_TIMEZONE`, el rótulo pasa a `Horario de
atención (hora de la tienda)` y la línea de P1 gana el sufijo `, hora de la
tienda`. Con la zona por defecto —hoy, todas las tiendas— no se ve nada. Coste:
  una comparación de cadenas en la vista (A6). El defecto conocido: la
  comparación es contra la zona **del producto**, no contra la del visitante,
  que no se puede saber sin instante ni cabeceras; es un aproximado que acierta
  en el caso que importa.
- (b) Siempre, en las tres formas. Es la más honesta y le añade nueve caracteres
  a cada tienda para avisar de algo que a casi ninguna le aplica.
- (c) Nunca. Es lo más limpio y deja al comprador de otro huso sin ninguna
  pista. No se recomienda: cuando el editor de F-011 permita poner cualquier
  zona, este caso deja de ser teórico.

**`DP5` — ¿El horario aparece también en el pie de las demás páginas de la
tienda?**

En el ciclo 1 la respuesta era no por coste técnico (habría metido un hueco
dinámico en siete rutas, incluido el checkout). **Ese argumento ya no existe**:
el bloque es HTML estático y en el pie del layout costaría cero. Lo que queda es
un juicio de foco, y por eso vuelve a preguntarse.

- **(a) No: solo en la portada de la tienda. Recomendada.** El horario se
  consulta al decidir, y en el checkout compite con los campos que hay que
  rellenar. Además mantiene el feature en un archivo y deja el pie —que ya lleva
  la dirección— como está.
- (b) Sí, en el pie de `src/app/[slug]/layout.tsx`, junto a `store.address`. Es
  lo más parecido a un sitio web convencional, y donde alguien va a buscarlo por
  costumbre. Coste real: el pie envuelve siete rutas incluido el checkout, hay
  que suprimirlo en la rama cerrada (R8) y en móvil queda debajo de todo el
  catálogo, o sea que casi nadie lo vería.
- (c) Sí en la portada y en la ficha de producto, no en el checkout. Es el punto
  medio y contradice `DP3`, que el orquestador ya cerró en este ciclo.
