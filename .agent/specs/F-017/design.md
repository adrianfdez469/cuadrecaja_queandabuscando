---
feature: F-017
agente: sdd-designer
actualizado: 2026-08-27T02:43:30Z
estado: listo
---

> **Alcance de este documento: la etapa 2 de `architecture.md`.** Tres pantallas
> nuevas y dos zonas que crecen, para los criterios **2** (una marca con dos
> sucursales responde 200 y el HTML contiene ambas) y **6** (cambiar de sucursal
> con el carrito lleno muestra en pantalla qué pasa con el carrito antes de
> aplicarlo). La etapa 1 no tiene pantalla propia: mueve el slug, el registro y
> el resolvedor sin que nadie vea nada distinto, y eso es exactamente su éxito.
>
> **Qué leí antes de dibujar.** `AGENTS.md` § Prohibiciones (las dos de diseño:
> `"use client"` sin estado ni eventos, y **nunca** en algo que renderice
> catálogo); `spec.md` con su § Fuera ya corregido —la corrección **antes** de la
> lista, como corresponde: el selector y el aviso están DENTRO—;
> `architecture.md` entero, y con lupa § El selector de sucursal, § Agrupar dos
> tiendas bajo una marca, § Cambiar de sucursal con el carrito lleno, § El
> servicio de disponibilidad de slug, § `prisma/seed.ts` (la trampa: la rama
> `update` de los `upsert` no escribe `slug` ni `storefrontId`, o `npm run seed`
> desharía la agrupación y el criterio 2 se pondría rojo sin que nadie tocara
> código); los ocho criterios literales de `.agent/features.json`; HS1–HS9 de
> `.agent/progress/F-017.md`; ADR 0018 y 0012; mi propio
> `.agent/specs/F-011/design.md` —el lenguaje visual del panel es el de ahí,
> incluidos el hub, la insignia de estado, la confirmación en línea y el
> `<noscript>`, y su § Congelado sigue congelado: **el editor de branding no es
> de este feature**—; y el código: `src/constants/cart.ts`,
> `src/features/cart/{cartStore,cartStorage,parseCart}.ts`,
> `src/features/cart/components/CartBadge.tsx`, `src/app/[slug]/**`,
> `src/components/{ui,store}/**`, `src/theme/tokens.css`,
> `src/features/admin/components/{StoreList,StorePublicSwitch}.tsx`,
> `src/features/admin/server/stores.ts`, `scripts/check-bundle-budget.mjs` y
> `scripts/check-theme-tokens.mjs`.
>
> **HS5 comprobada por mí mismo, como se pidió.** `src/constants/cart.ts:13`:
> `CART_STORAGE_KEY_PREFIX = "qab.cart.v1."` con el comentario
> «`localStorage` key is this prefix + `Store.id`. Never by slug (R12)», y
> `cartStorage.ts:13` (`keyFor`) es el único sitio que compone la clave. **Este
> diseño no toca esa clave ni pide tocarla.** Ni traslada, ni re-precia, ni
> vacía: el criterio 6 se cumple **informando**, y la frase dice la verdad —que
> no se pierde nada y que sigue ahí cuando vuelva— sin prometer que se traslade.
>
> **Las respuestas del humano ya están aplicadas** y este documento afirma, sin
> condicionales: **AP6 → (a)**, al agrupar, la URL de la marca principal pasa de
> catálogo a selector; **DP1 → no**, el aviso del carrito habla **solo** del
> carrito de la sucursal que se deja, como lo tenía pensado el arquitecto;
> **DP2 → sí**, **DP3 → sí**, **DP4 → sí a las dos**, **DP5 → no**. El detalle y
> la traza de cada una, en § Respuestas del humano.

---

## Qué se miró de verdad, y qué no se pudo mirar

**Ejecutado.** `npm run dev` levantado en el 3000 contra el Postgres del 5433 y
las tres tiendas del seed. Con las herramientas de Chrome abrí
`http://localhost:3000/tienda-demo` (200, `<title>La Rampa · Vedado`) y
`/tienda-cerrada`. Lo que vi, y que este diseño usa:

1. La cabecera real es `bg-brand` / `text-brand-contrast` con el nombre a la
   izquierda y `Carrito` a la derecha; `· {ciudad}` es `hidden sm:inline`.
2. **El navegador estaba en modo oscuro** y la página se ve bien: la cabecera de
   marca no cambia con el esquema (los tokens `brand` no se redefinen en
   `prefers-color-scheme: dark`), las superficies sí. El selector hereda eso
   tal cual, así que hay que mirarlo en oscuro además de en claro.
3. La página cerrada de `/tienda-cerrada` sale con `<h1>La Rampa · Marianao`,
   un `Alert tone="warning"` con `Cerrado por vacaciones. Volvemos pronto.`, el
   mensaje del admin, `Dirección: …`, la línea `Esta página se actualiza sola
cuando la tienda vuelva a abrir.` y **sin `Carrito` en la cabecera**. Es la
   pantalla más liviana de la aplicación y así se queda.
4. **Los nombres del seed ya traen la marca dentro**: la marca es «La Rampa» y
   las sucursales se llaman «La Rampa · Vedado» y «La Rampa · Marianao». Eso
   tiene consecuencia de diseño y está resuelta abajo (§ 1, «La redundancia del
   nombre»): **no se le hace cirugía al string** que manda el POS.

**No ejecutado, y por cuarta vez el mismo motivo: `resize_window` no cambia el
tamaño real de la captura.** Prueba de esta sesión, en una sola ventana y con
tres tamaños distintos:

| Pedido a `resize_window` | Respuesta       | Captura obtenida | `· Vedado` (`hidden sm:inline`) | Cuadrícula |
| ------------------------ | --------------- | ---------------- | ------------------------------- | ---------- |
| 360×760                  | «Successfully…» | **948×1287**     | oculto                          | 2 columnas |
| 1280×900                 | «Successfully…» | **948×1287**     | oculto                          | 2 columnas |
| 1600×1000                | «Successfully…» | **948×1287**     | oculto                          | 2 columnas |

Tres tamaños, tres capturas idénticas, y a 1600 px seguiría oculto un elemento
que aparece a partir de 640 px: la ventana **no se movió**. Así que **todos los
pasos de 360 / 768 / 1280 quedan sin marcar** (§ Verificación visual), y no los
maquillo. Lo que sí puede hacerlos es la etapa headless que ya existe en el
arnés: `bash .agent/verify.sh F-017 --visual` con
`.agent/specs/F-017/visual.mjs` (hoy **no existe** → la etapa sale en ROJO, y
`sdd.sh done` no cierra el feature con `design.md` en `listo` sin que haya
salido `PASA` alguna vez). Chromium headless **sí** fija el viewport, así que
los `V8`–`V21` de abajo están escritos para traducirse a ese guion, uno a uno.
Escribir `visual.mjs` no es mío —mi frontera es este archivo—: va al plan.

---

## Flujo de usuario

**El comprador, con un QR de marca** (`/la-rampa`, dos sucursales):

```
QR de la marca → /la-rampa (selector)
    ├─ toca «La Rampa · Vedado»  → /la-rampa-vedado (catálogo)  → producto → carrito → checkout
    └─ toca «La Rampa · Marianao» (cerrada) → /la-rampa-marianao (aviso de cierre)
                                              └─ «Ver las otras sucursales» → /la-rampa-marianao/sucursales
```

**El comprador, con un QR de local** (`/la-rampa-vedado`): entra **directo al
catálogo**, sin pasar por el selector. Nunca ve una pantalla intermedia que no
pidió. Sobre el catálogo aparece una tira: `Estás en La Rampa · Vedado.` +
`Cambiar de sucursal`.

```
/la-rampa-vedado (catálogo, con carrito de 3 productos)
   → «Cambiar de sucursal» → /la-rampa-vedado/sucursales
        · lee ANTES de aplicar: «Dejas 3 productos en el carrito de La Rampa · Vedado. Siguen ahí cuando vuelvas.»
        → toca «La Rampa · Playa» → /la-rampa-playa (catálogo, carrito propio, vacío o con lo suyo)
        → vuelve atrás (botón del navegador o «Cambiar de sucursal» otra vez)
             → /la-rampa-vedado: los 3 productos siguen exactamente donde estaban
```

**Qué se pierde en cada vuelta atrás: nada.** Es el punto entero de HS5, y es lo
único que este flujo tiene que dejar claro por escrito en pantalla. El único
caso donde algo **sí** se pierde es que el navegador no esté guardando
(`isLocalStorageAvailable() === false`, respaldo en memoria de
`cartStorage.ts`): al navegar a otra sucursal ese carrito muere. Tiene estado y
frase propias (§ 3, estado **E**), porque prometerle permanencia a quien está en
navegación privada sería mentir.

**El admin, agrupando** (HS8, sin vuelta atrás):

```
/admin → hub de la tienda A → Card «Tu marca» → «Agrupar otra tienda en esta marca»
    → /admin/tiendas/<A>/agrupar
         1. elige B entre sus tiendas (radio)
         2. LEE «Qué va a cambiar»: las dos URL resultantes, fila por fila, antes de aplicar
            └─ salida lateral: «¿Prefieres que la dirección de B sea la de la marca? Hazlo desde B.»
         3. confirma en línea → 200 → pantalla de resultado con las URL de verdad
    → «Volver a A»: el hub ya dice «marca con 2 sucursales» y la URL pública de A cambió
```

Vueltas atrás del admin: en los pasos 1 y 2, todas (`No, dejarlo así`, el botón
atrás, cerrar la pestaña; no se ha escrito nada). Después del paso 3, **ninguna**:
no hay desagrupar y la pantalla lo dice con esas palabras antes de aplicar.

---

## Inventario de pantallas y estados

### 1 · `/[slug]` en modo selector — la vitrina de la marca (criterio 2)

Componente de **servidor**, ruta `●`, ISR con `revalidate = 3600` literal.
Cero módulos de cliente. El tema es el de la **marca**, con
`data-store={brandSlug}`.

**Cabecera** (layout, modo selector): nombre de la **marca**, texto, **no**
enlace (no hay a dónde ir desde aquí: ya estás en la raíz de la marca), **sin
`CartBadge`** —una marca no tiene carrito, cada sucursal tiene el suyo— y sin
«seguir comprando». **Pie**: sin dirección (la marca no tiene una), solo
`Publicado con queandabuscando`.

**Cuerpo**: `<h1>Elige tu sucursal</h1>`, una línea de contexto, y una `<ul>` de
tarjetas. El contenedor de la lista lleva **`data-branch-picker`**: es el
marcador que el criterio 1 comprueba que **no** está en la marca de una sola
sucursal, y solo prueba algo si el componente existe de verdad.

Cada tarjeta es **un solo enlace** que envuelve todo (`<a>` con la `Card`
dentro, no una tarjeta con enlaces sueltos: un tab stop por sucursal, y en el
móvil el dedo acierta en cualquier parte):

| Elemento                 | Contenido                                                                | Notas                                                        |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `<h2>`                   | `{branch.name}` — **tal cual llega del POS**                             | Es lo que el criterio 2 busca en el HTML                     |
| `Badge`                  | `Abierta` (positive) · `Cerrada ahora` (warning) · `Suspendida` (danger) | Mismo vocabulario que el panel de F-011                      |
| Línea 2                  | `{ciudad} · {dirección}`, truncada a una línea                           | Lo que de verdad distingue una sucursal de otra              |
| Línea 3 (condicional)    | motivo del cierre, o `Todavía sin productos publicados.`                 | `text-fg-muted text-sm`                                      |
| Afordancia (última fila) | `Ver el catálogo →` · `Ver por qué está cerrada →` · `Ver la sucursal →` | `text-brand text-sm font-medium`, `aria-hidden` en la flecha |

**La redundancia del nombre.** En el seed real la marca es «La Rampa» y las
sucursales «La Rampa · Vedado»: el `<h2>` repite la marca que ya está en la
cabecera. **No se recorta el string.** Quitarle un prefijo a un nombre que
escribió el comerciante en Cuadre de Caja es adivinar, y el día que llame a una
sucursal «Vedado» a secas el recorte produce basura. Se resuelve por jerarquía
visual: la ciudad de la línea 2 es la que lleva el peso de distinguir, y el
`<h1>` no repite el nombre de la marca (ya está en la cabecera).

**Orden** (determinista, en el servidor, para que el prerender sea estable):

1. abiertas con catálogo, 2. abiertas sin catálogo, 3. cerradas, 4. suspendidas;
   dentro de cada grupo, alfabético por nombre —que es el `orderBy: { name: "asc" }`
   que el resolvedor ya hace—. Motivo: sin geolocalización (F-015 / ADR 0011 está
   fuera) no hay nada mejor que «lo que se puede comprar, primero»; poner una
   cerrada arriba es mentir sobre qué está disponible. **Contestado (DP3 → sí).**

| Estado                                 | Qué se ve                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal (2+ sucursales, ≥1 abierta)** | `<h1>` + línea de contexto + la lista. **Es el estado del criterio 2**                                                                                                                          |
| **Todas cerradas o suspendidas**       | `Alert tone="warning"` arriba de la lista, y la lista **completa igual**: cada tarjeta con su motivo y su enlace. Nunca un 404, nunca una lista vacía                                           |
| **Una sucursal sin catálogo**          | Su tarjeta baja al grupo 2 y suma la línea `Todavía sin productos publicados.` **Sigue enlazando**: el aviso de «esta tienda todavía no tiene productos publicados» que ya existe es suficiente |
| **Una sola sucursal**                  | Esta pantalla **no existe**: el resolvedor devuelve `branch` y se ve el catálogo (criterio 1). `grep -c data-branch-picker` = 0                                                                 |
| **Cero sucursales renderizables**      | **404** (E6). No se diseña pantalla: no debe existir                                                                                                                                            |
| **Cargando**                           | No hay: es SSG servida desde el CDN. Sin `loading.tsx`, sin esqueleto, sin `Suspense`                                                                                                           |
| **Error**                              | El `src/app/error.tsx` que ya existe. Esta pantalla no añade caminos de error propios: hace **cero** consultas por su cuenta                                                                    |
| **Sin permiso**                        | No aplica: es pública                                                                                                                                                                           |

**Metadatos**: `title = {brandName}`;
`description = "Elige una de las {N} sucursales de {brandName} para ver su catálogo y hacer tu pedido."`;
**indexable** (no `noindex`: es una vitrina de verdad, y es la URL que va
impresa en el QR) y **entra en `sitemap.ts`** junto a las canónicas de cada
sucursal — DP4 contestado, sí a las dos—. Y el diseño pide además que
`generateStaticParams` incluya los slugs de marca en modo selector, o el
criterio 7 dejaría de ver `●` donde hoy lo ve.

### 2 · La tira de sucursal — cómo se llega a cambiar (server, `●`, 0 bytes)

Un componente de servidor `BranchBar` que se renderiza **solo cuando
`resolution.branchCount > 1`**, como primer hijo de dos páginas: el catálogo
`/[slug]` en modo `branch` y la ficha `/[slug]/p/[productSlug]`. Es un `<nav
aria-label="Sucursal">` sobre `bg-surface-muted`, con un `<a>` dentro. **Un
enlace, no una isla**: cero JavaScript en rutas `●`.

**Por qué en las páginas y no en el layout**, que sería más corto: el layout lo
pondría también en `/carrito` y `/checkout`, y ofrecerle «cambiar de sucursal» a
alguien que está a dos campos de terminar el pedido es empujarlo a abandonarlo.
Las dos páginas que lo llevan son las de mirar, no las de pagar.

| Variante                                 | Texto                                          | Enlace                                                               |
| ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Sucursal abierta de marca con varias     | `Estás en {branchName}.`                       | `Cambiar de sucursal` → `/{canonicalSlug}/sucursales`                |
| **Sucursal cerrada** de marca con varias | `Esta sucursal está cerrada.`                  | `Ver las otras {N-1} sucursales` (`Ver la otra sucursal` si N-1 = 1) |
| Marca con una sola sucursal              | **No se renderiza nada.** Ni el elemento vacío | —                                                                    |

La variante cerrada va **debajo** del `StoreClosedNotice`, no encima: primero se
entiende por qué está cerrado esto y después se ofrece la alternativa. Es la
mejora de producto más barata del feature: hoy quien llega a una sucursal
cerrada se va, y su negocio tiene otra abierta a diez cuadras.

### 3 · `/[slug]/sucursales` — cambiar de sucursal, y el aviso del carrito (criterio 6)

`metadata.robots = { index: false }` (pantalla de tránsito, como `/carrito` y
`/checkout`). Lee **solo** `requireResolution(params.slug)` y reutiliza
`BranchList` verbatim: **cero consultas propias**. Funciona tanto entrando por
el slug de una sucursal (`kind: "branch"` → hay una sucursal «actual») como por
el de la marca (`kind: "selector"` → no hay actual).

Orden de arriba abajo, y el orden es el requisito: **el aviso va ANTES de la
lista**, porque el criterio 6 dice «antes de aplicarlo» y aplicar es tocar un
enlace de la lista.

1. `← Volver a {branchName}` (o `← Volver` si se entró por la marca).
2. `<h1>Cambiar de sucursal</h1>`.
3. **El aviso del carrito** — un `Alert` con `role="status"` y
   `aria-live="polite"`, cuya **primera línea existe en el HTML de la primera
   respuesta** (es lo que el `curl` del criterio 6 lee) y la isla la sustituye
   por la versión con números.
4. `BranchList` en variante «cambio»: la sucursal actual **no es enlace**, lleva
   `Badge muted` `Estás aquí` y `aria-current="page"`.

**Los estados del aviso**, que son la mitad de esta pantalla. La regla del
carrito es **la primera línea y está siempre**, desde el HTML de la primera
respuesta; lo único que la isla añade es el **número de la sucursal que se
deja**:

| #   | Situación                                                     | Qué se lee                                                                                                                                                                                                | Tono      |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| A   | **Servidor / antes de hidratar / sin carrito en la que deja** | `Tu carrito no se mueve: cada sucursal guarda el suyo.`                                                                                                                                                   | `muted`   |
| B   | Carrito en la que deja                                        | La línea de **A**, y debajo: `Dejas {n} productos en el carrito de {branchName}. Siguen ahí cuando vuelvas.` + `Un carrito que no tocas en 30 días se vacía solo.`                                        | `muted`   |
| C   | Carrito **también** en otra sucursal                          | **Exactamente lo mismo que B.** La pantalla no lo distingue, y la línea de A ya dice la verdad de las dos: cada una guarda el suyo                                                                        | `muted`   |
| D   | Alguna sucursal de la lista está **cerrada**                  | Su tarjeta lleva `Cerrada ahora`, y bajo el aviso: `Una sucursal cerrada guarda su carrito igual: cuando vuelva a abrir, lo que armaste va a estar ahí.` — **línea de servidor**, no depende de leer nada | `muted`   |
| E   | El navegador **no guarda** y hay carrito                      | `Tu navegador no está guardando el carrito. Si cambias de sucursal ahora, vas a perder lo que armaste en {branchName}.`                                                                                   | `warning` |
| F   | Sin JavaScript                                                | `<noscript>`: `Sin JavaScript no podemos contarte lo que tienes en cada carrito. No se borra nada: cada sucursal guarda el suyo.`                                                                         | `muted`   |

> **DP1 se contestó «no», y esto es lo que significa en pantalla.** El humano
> reconsideró y cerró: «deja el aviso como lo tenía pensado el arquitecto». Así
> que la isla lee **una** clave —la de la sucursal actual, con el `useCart` que
> ya existe— y **no** enumera los carritos de las hermanas: ni sus nombres ni
> sus conteos. Los dos estados que el encargo pedía cubrir siguen cubiertos, y
> por eso están en la tabla como **C** y **D**, pero se cubren **diciendo la
> verdad general en vez de contando lo ajeno**:
>
> - **C** (carrito en las dos): `cada sucursal guarda el suyo` es cierto para la
>   que se deja y para la otra. No hace falta leer la otra para no mentir sobre
>   ella; hace falta no prometer un traslado, y ninguna frase lo promete.
> - **D** (carrito en una sucursal ahora cerrada): lo resuelve una línea **de
>   servidor** que aparece cuando alguna sucursal de la lista está cerrada. Es
>   verdad sin leer ni una clave, funciona sin JavaScript, y el estado de esa
>   sucursal ya está en su tarjeta.
>
> Lo que se pierde con «no» y hay que asumir: el comprador que armó un carrito
> en A y está mirando B no ve **el número** de lo que dejó en A. Lo que se gana:
> un aviso corto, una sola lectura de `localStorage`, y una frontera limpia con
> `.agent/specs/propuestas/carritos-abiertos-del-comprador.md` —la pantalla que
> le enseñaría al comprador **todos** sus carritos—, que sigue **fuera de
> alcance por decisión expresa** y que esta pantalla **no enlaza**: ni un «Ver
> todos mis carritos», ni un pie que insinúe que existe. Lo dejo escrito porque
> la tentación es real —teniendo delante «tienes carrito aquí», el paso
> siguiente parece «¿y en el resto?»— y el día que alguien la resuelva «de paso»
> habrá construido un feature sin spec.

Detalles que hacen que esto no mienta:

- **Ninguna frase dice «se traslada», «se lleva» ni «se mueve contigo».** El
  verbo es siempre _quedarse_. Es HS5 dicho en cristiano.
- **Ninguna frase afirma un vacío que no se comprobó.** No existe «en las otras
  no tienes nada»: la única afirmación con número es sobre la sucursal actual,
  que es la que `cartStore.ts` posee de verdad.
- **El plazo se nombra.** `CART_EXPIRY_DAYS = 30` es real
  (`parseStoredCart` descarta al leer), así que «siguen ahí cuando vuelvas»
  necesita su asterisco. Sin él, la frase es falsa al día 31.
- **Singulares**: `1 producto` / `{n} productos`; `la otra sucursal` /
  `las otras {N-1} sucursales`. Se resuelve con un ternario, no con librería.
- **La línea de A es la del servidor y no cambia nunca**, así que la hidratación
  solo **añade** debajo: cero desplazamiento cuando no hay carrito —el caso más
  común—, y ~40 px hacia abajo cuando lo hay, una sola vez y antes de que nadie
  haya podido tocar un enlace de la lista. Nunca aparece algo encima de lo que
  ya se podía tocar, que es la regla de F-010. Es el paso `V13`.
- **La isla lee una sola clave, y con `useCart(currentStoreId)`.** No se le pide
  el carrito de otra tienda a ese módulo: `cartStore.ts` sostiene **uno** en
  memoria (§ «Holds exactly ONE store's cart at a time») y `ensureStore()` con
  el id de otra sucursal lo cambiaría — con `CartBadge` montado en la cabecera
  de esta misma pantalla, el síntoma sería que la burbuja muestra el conteo de
  otra sucursal. Con DP1 en «no» esa trampa **no se puede pisar**, y queda
  escrita para el día que alguien reabra la pregunta.
- **Los conteos van en el aviso, no dentro de las tarjetas.** Meter «tienes 3
  aquí» en cada tarjeta obligaría a que la isla **envuelva la lista entera** y
  `BranchList` dejaría de ser el mismo componente de servidor que usa el
  selector `●`. Un kilobyte no vale ese precio.

| Estado de la pantalla                | Qué se ve                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal**                           | Aviso + lista con `Estás aquí`                                                                                                                        |
| **Marca con una sola sucursal**      | **404**. No hay nada que elegir, y el enlace que llega aquí solo existe cuando `branchCount > 1`                                                      |
| **Todas las demás cerradas**         | La lista completa con sus motivos; el aviso no cambia (el carrito no depende de que abran)                                                            |
| **Se entró por el slug de la marca** | Sin `Estás aquí`, sin `← Volver a …` (solo `← Volver`); no hay sucursal «actual» de la que se deje nada, así que el aviso se queda en el estado **A** |
| **Cargando**                         | Nada que cargar del servidor. La isla no tiene estado «cargando»: leer `localStorage` es sincrónico                                                   |
| **Error**                            | Sin caminos de error propios: no hace `fetch`, no cotiza, no escribe                                                                                  |

### 4 · Panel · Card «Tu marca» en el hub de la tienda (punto 4 del encargo)

Va en `/admin/tiendas/<storeId>`, **entre** la Card «Datos de Cuadre de Caja» y
las dos tarjetas de destino (`Productos`, `Promociones`). Ese sitio y no otro:
arriba manda el interruptor de HD10 (la acción con más consecuencias), y la
marca es contexto de identidad, no una acción diaria. Servidor, cero JS.

Y **un cambio en la cabecera del hub**: la URL pública que hoy muestra
`queandabuscando.com/{store.slug}` pasa a mostrar el **canónico** de la
sucursal, que es lo que un cliente escribe de verdad
(`la-rampa` con una sucursal, `la-rampa-vedado` con varias). Es la línea que le
dice al admin que su URL cambió después de agrupar.

| Estado                                     | Qué se ve                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Marca con una sucursal, con candidatas** | `<h2>Tu marca</h2>`; `{brandName}` + `queandabuscando.com/{brandSlug}` (enlace `↗`); `Esta es tu única sucursal, así que esa dirección lleva directo a tu catálogo.`; `Button variant="secondary"`: `Agrupar otra tienda en esta marca`                                                                                                    |
| **Marca con una sucursal, sin candidatas** | Igual, y en vez del botón: `Cuando publiques otro local desde Cuadre de Caja vas a poder agruparlo aquí.` (`Alert tone="muted"`)                                                                                                                                                                                                           |
| **Marca con varias**                       | `{brandName}` + su URL; `Esa dirección muestra la lista de tus {N} sucursales.`; `<h3>Sucursales de esta marca</h3>` y una `<ul>`: por sucursal el nombre, su URL, su `Badge` de estado, `Esta tienda` en la actual, `Abrir en el panel` cuando el admin la administra y `Ver ↗` siempre. Debajo, el botón de agrupar si quedan candidatas |
| **Hermana que este admin NO administra**   | Se nombra con su URL y su estado, **sin** enlace al panel. Motivo: ya es pública en el selector de la marca, así que no revela nada nuevo; y no nombrarla dejaría al admin contando sucursales que no cuadran. **Contestado (DP2 → sí)**                                                                                                   |
| **Cargando**                               | El hub es `force-dynamic`; su `loading.tsx` ya dice `Cargando la tienda…`                                                                                                                                                                                                                                                                  |
| **Sin permiso / tienda ajena**             | **404** de Next, sin el nombre de la tienda en el cuerpo. Igual que F-011 (E3, R7)                                                                                                                                                                                                                                                         |

El **listado `/admin`** no se reorganiza por marca en este ciclo: eso es el
rediseño que el § Congelado de F-011 anota en su punto 1 («`/admin` pasando de
_tus tiendas_ a _tu marca y tus sucursales_») y llega con el editor de branding.
Lo único que cambia allí es el `href` de `Ver la tienda ↗`, que pasa al
canónico —y eso ya lo lleva `architecture.md` § Componentes—.

### 5 · Panel · `/admin/tiendas/[storeId]/agrupar` (HS8)

Ruta propia y no un bloque dentro del hub, por tres motivos: es irreversible y
merece una pantalla donde no haya nada más que tocar; tiene URL para volver y
para compartir con quien decide; y el 404 de tienda ajena la protege igual que
al resto del panel. `force-dynamic`, como todo `/admin` (R9).

Estructura, de arriba abajo:

1. `← {storeName}` (al hub) y `<h1>Agrupar otra tienda en tu marca</h1>`.
2. Párrafo de qué significa: `Las tiendas agrupadas comparten una sola
dirección: tus clientes entran por la marca y eligen la sucursal. Cada sucursal
conserva su propio catálogo, sus precios y su propia dirección.`
3. **`Alert tone="warning"`, antes del formulario**, porque enmarca todo lo que
   viene: título `Esto no se puede deshacer.`, cuerpo `No hay forma de separar
dos tiendas agrupadas desde el panel. Lee lo que va a cambiar antes de
confirmar.`
4. `<fieldset>` con `<legend>¿Qué tienda quieres agrupar?</legend>` y un
   `RadioCard` por candidata: `label = {name}`,
   `description = "{ciudad} · queandabuscando.com/{slug}"`.
   **Candidatas** = tiendas de `session.storeIds`, del **mismo negocio**, que no
   estén ya en esta marca. El filtro en el servidor es lo que hace que los dos
   409 sean casos de carrera y no el camino normal.
5. **`Qué va a cambiar`** — aparece **debajo** del radio elegido, nunca encima
   (regla de F-011), con `aria-live="polite"` y **sin mover el foco**.
6. La confirmación en línea: `Sí, agrupar las dos tiendas` (primary) y
   `No, dejarlo así` (ghost). Mismo patrón que `Vaciar carrito` (F-010) y el
   interruptor de HD10 (F-011).

**El bloque «Qué va a cambiar» es el requisito duro**, así que va literal. Con
A = la tienda de la ruta (su marca sobrevive, slug `la-rampa`) y B = la elegida
(slug `tienda-dos`):

| Dirección                             | Ahora                            | Después                                       |
| ------------------------------------- | -------------------------------- | --------------------------------------------- |
| `queandabuscando.com/la-rampa`        | El catálogo de La Rampa · Vedado | **La lista de tus 2 sucursales**              |
| `queandabuscando.com/la-rampa-vedado` | Todavía no existe                | El catálogo de La Rampa · Vedado              |
| `queandabuscando.com/tienda-dos`      | El catálogo de La Rampa · Playa  | El catálogo de La Rampa · Playa — sin cambios |

Y debajo, en `Alert tone="warning"`:

`Los códigos QR que ya imprimiste siguen funcionando: ninguna dirección deja de
responder y ninguna redirige. Pero el QR de La Rampa · Vedado va a llevar a la
lista de sucursales, no directo a su catálogo. Su catálogo queda a un clic, en
queandabuscando.com/la-rampa-vedado.`

Y una **salida lateral**, que es lo que convierte esa advertencia en algo
accionable en vez de en un susto:

`¿Prefieres que la dirección de tu marca sea queandabuscando.com/tienda-dos?
Entonces agrupa desde La Rampa · Playa.` → enlace a
`/admin/tiendas/<B>/agrupar?con=<A>` (llega con B como principal y A
preseleccionada). Es la respuesta de producto a AP6 sin cambiar el modelo:
**el admin elige cuál de sus dos URL impresas es la que cambia de significado.**

**De dónde sale el string `la-rampa-vedado` de la vista previa**: lo calcula el
**servidor** al renderizar la página, una vez por candidata, con `previewSlug()`
de HS7 —la misma función que decide de verdad—. No hay `fetch` de vista previa y
no hay adivinanza en el cliente. Si entre la vista previa y el `POST` alguien se
lleva ese slug, la pantalla de resultado muestra **las URL que devolvió el 200**,
que son las de verdad; nunca se repite el string de la vista previa como si
hubiera pasado.

| Estado                         | Qué se ve                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal**                     | El aviso, los radios, y nada más hasta que se elige                                                                                                                                     |
| **Sin candidatas**             | `No tienes otra tienda para agrupar.` + `Solo se pueden agrupar tiendas del mismo negocio que administres tú. Publica el otro local desde Cuadre de Caja y vuelve aquí.` Sin formulario |
| **Elegida, sin confirmar**     | La tabla + la advertencia + la salida lateral + los dos botones                                                                                                                         |
| **Enviando**                   | Los dos botones deshabilitados, el primario dice `Agrupando…`; los radios deshabilitados                                                                                                |
| **Éxito**                      | § abajo                                                                                                                                                                                 |
| **Error**                      | `Alert tone="danger"` **encima** del bloque de confirmación, el foco salta a él (`tabIndex={-1}` + `focus()`), los radios vuelven a estar activos. Textos en § Textos                   |
| **Sin JavaScript**             | `<noscript>`: `Para agrupar dos tiendas necesitas activar JavaScript. Es una acción que no se puede deshacer y preferimos que veas antes qué cambia.`                                   |
| **Tienda ajena / inexistente** | **404**, sin nombres en el cuerpo                                                                                                                                                       |
| **Sesión caída (401)**         | El camino que ya existe: `/sesion-cerrada` de F-011                                                                                                                                     |

**Qué se ve después (el resultado, en la misma pantalla).** No se redirige: hay
que poder **leer** las URL resultantes sin correr detrás de ellas. El bloque de
confirmación se sustituye por una `Card` con `Alert tone="positive"`:

- `<h2>Listo: {brandName} tiene 2 sucursales</h2>`
- `queandabuscando.com/{brandSlug} ahora muestra la lista de las dos.`
- Una `<ul>` con lo que devolvió el endpoint, una fila por sucursal:
  `{name}` — `queandabuscando.com/{slug}` — `Ver ↗`.
- `Los códigos QR que ya imprimiste siguen funcionando.`
- Dos enlaces: `Volver a {A}` (hub) y `Ver la lista de sucursales ↗`.
- El foco salta al `<h2>` del resultado.

El hub, al volver, ya muestra: la URL pública de A cambiada al canónico nuevo, y
la Card «Tu marca» con las dos hermanas. Es `force-dynamic`, así que no hay
caché rancia que explicar. En el hub de **B** —si el admin entra— la Card «Tu
marca» pasa a nombrar la marca de A, y su propia URL no cambió.

---

## Estructura por breakpoint

360 primero. `Container` (`mx-auto max-w-6xl px-4 sm:px-6`) no se toca.

| Zona                             | 360                                                                                                                                                                          | 768                                                             | 1280                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Selector · lista**             | Una columna, tarjetas a todo el ancho, `min-h-20`                                                                                                                            | Una columna, `max-w-3xl`                                        | Una columna `max-w-3xl`; **`lg:grid-cols-2` solo si hay más de 4 sucursales** |
| **Selector · tarjeta**           | Fila 1: `<h2>` + `Badge` (`shrink-0`, el `<h2>` `min-w-0 truncate`). Fila 2: ciudad · dirección. Fila 3: motivo o «sin productos». Fila 4: la afordancia                     | Igual; `Badge` a la derecha en la misma fila del título         | Igual                                                                         |
| **Tira de sucursal**             | Dos líneas: `Estás en …` arriba, el enlace debajo alineado a la izquierda, `min-h-11`                                                                                        | Una fila: texto a la izquierda, enlace a la derecha             | Igual que 768                                                                 |
| **`/sucursales`**                | Aviso a todo el ancho arriba, lista debajo. Igual que el selector                                                                                                            | `max-w-3xl`                                                     | `max-w-3xl`, **sin** pasar a dos columnas: aquí se compara, no se ojea        |
| **Card «Tu marca»**              | Nombre y URL en líneas separadas (la URL `break-all`); la `<ul>` de hermanas apilada: nombre + `Badge`, URL debajo, acciones en una fila que envuelve, `min-h-11` cada una   | Nombre + `Badge` + URL en una fila; acciones a la derecha       | Igual que 768, dentro del `max-w-4xl` del hub                                 |
| **Agrupar · radios**             | `RadioCard` apilados, `min-h-14` (llevan descripción con URL)                                                                                                                | Apilados igual: una URL por fila se lee, dos no                 | Igual                                                                         |
| **Agrupar · «Qué va a cambiar»** | **No es tabla**: un bloque por dirección — la URL (`text-sm break-all font-medium`), luego `Ahora: …` y `Después: …` en dos líneas `text-sm`, con la fila que cambia marcada | `<table>` de tres columnas con `<caption>` y `<th scope="col">` | Igual que 768, `max-w-4xl`                                                    |
| **Agrupar · acciones**           | Dos botones apilados, `Sí, agrupar las dos tiendas` **arriba**, a todo el ancho                                                                                              | En fila                                                         | En fila                                                                       |
| **Resultado**                    | `<ul>` apilada, una URL por fila, `Ver ↗` debajo con `min-h-11`                                                                                                              | URL y `Ver ↗` en la misma fila                                  | Igual                                                                         |

**La regla en 360**: una columna, sin scroll horizontal, una acción primaria por
tarjeta, nada fijo arriba ni abajo, y ninguna URL que desborde —todas van con
`break-all`, que es la única forma de que `queandabuscando.com/la-rampa-vedado`
quepa en 328 px de contenido—.

**Por qué el selector no se abre a cuadrícula hasta 5 sucursales**: el caso real
son 2 o 3, y una cuadrícula de tres columnas con dos tarjetas parece que falta
algo (mismo razonamiento que el listado de `/admin` en F-011). A partir de 5 la
lista en una columna a 1280 obliga a hacer scroll para ver el final, y ahí sí
gana la cuadrícula.

---

## Componentes de UI

**Se reutilizan tal cual, sin tocar una línea**: `Container`, `Card`, `Badge`,
`Alert`, `Button`, `RadioCard`, `StoreClosedNotice`. Y `resolveStoreClosureHeadline`
de `src/lib/storeClosure.ts` —puro— para el motivo de cierre de una tarjeta.

**Nada nuevo entra en `src/components/ui/`.** Y la regla de F-011 sigue en pie,
que es la única vía por la que el panel puede contaminar la vitrina: en
`src/components/ui/` **jamás** entra `"use client"`.

| Componente           | Dónde                            | Qué hace                                                                                                        | `"use client"`                        |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `BranchList`         | `src/components/store/`          | La `<ul>` de sucursales. Props `branches`, `variant: "selector" \| "switch"`, `currentStoreId?`. Cero consultas | **No**                                |
| `BranchCard`         | `src/components/store/`          | Una tarjeta-enlace. Se separa para que el orden y el estado se prueben aparte                                   | **No**                                |
| `BranchBar`          | `src/components/store/`          | La tira `Estás en … · Cambiar de sucursal`, en dos variantes                                                    | **No**                                |
| `BranchSwitchNotice` | `src/features/cart/components/`  | El aviso del carrito con números                                                                                | **Sí** — isla, y la única del feature |
| `StoreBrandCard`     | `src/features/admin/components/` | La Card «Tu marca» del hub, con las hermanas                                                                    | **No**                                |
| `GroupStoresForm`    | `src/features/admin/components/` | Radios + vista previa + confirmación + `fetch` + errores + resultado                                            | **Sí** — isla                         |

**Por qué `BranchList` vive en `src/components/store/` y no en un feature**: lo
importan una ruta `●` (el selector) y una de tránsito, las dos de la vitrina
pública, y es exactamente lo que esa carpeta es. Lo dice ya
`architecture.md` § Componentes; lo repito porque de ahí depende que la isla del
carrito **no** lo envuelva.

**Por qué `BranchSwitchNotice` va en `features/cart/components/` y no en
`store/`**: importa `cartStorage`/`cartStore`, que son del carrito. Ponerlo en
`components/store/` invitaría a que mañana alguien lo importe desde el selector
`●` y le meta el módulo del carrito a una página que hoy no lo tiene.

---

## Tokens y tema

Todo sale de `src/theme/tokens.css`. Cero valores literales; `npm run check:theme`
verifica que las utilidades resuelvan por `var()` (y por eso se usan los nombres
del tema —`rounded-lg`, `bg-brand`— y **nunca** la forma de valor arbitrario con
`--var`, que en Tailwind 4 compila a una declaración inválida).

| Zona                               | Tokens                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Cabecera del selector              | `bg-brand`, `text-brand-contrast` — lo mismo que la sucursal              |
| Tarjeta de sucursal                | `bg-surface`, `border-border`, `rounded-lg`, `shadow-card` (vía `Card`)   |
| Nombre / ciudad / motivo           | `text-fg` · `text-fg-muted` · `text-fg-muted text-sm`                     |
| Afordancia `Ver el catálogo →`     | `text-brand`                                                              |
| `Badge` de estado                  | `positive` / `warning` / `danger` / `muted` — los tonos que ya existen    |
| Tira de sucursal                   | `bg-surface-muted`, `text-fg`, enlace `text-brand`                        |
| Aviso del carrito                  | `Alert tone="muted"`, y `warning` en el estado E                          |
| Advertencia de agrupar / resultado | `Alert tone="warning"` / `Alert tone="positive"`                          |
| Foco                               | `focus-visible:outline-brand outline-2 outline-offset-2` — el de `Button` |

**Nada de `font-mono` para las URL.** `tokens.css` define **solo** `--font-sans`;
`font-mono` caería en el valor por defecto de Tailwind, que es una familia
literal fuera de los tokens. Las URL se distinguen con
`text-sm font-medium break-all`. Si algún día se quiere monoespaciado, el cambio
exacto es añadir `--font-mono: ui-monospace, SFMono-Regular, monospace;` al
bloque `@theme` de `src/theme/tokens.css` —lo hace el implementador, no yo— y
**no lo recomiendo**: una familia más por tres cadenas de texto.

**Cómo reacciona al branding de cada tienda.** Después de F-017 el branding es
**de la marca** (`Storefront.themeTokens`; las columnas de `Store` se van en el
paso 8 de la migración). Consecuencias de diseño, y las tres importan:

1. **El selector se pinta con la paleta de la marca**, con
   `data-store={brandSlug}` en el `<div>` raíz del layout. La misma
   `renderStoreTheme(slug, tokens)` de siempre, sin tocar una línea.
2. **Las tarjetas del selector NO se pintan cada una de su color.** Ya no hay
   colores por sucursal, y es lo correcto: una marca, una paleta. Lo que
   distingue una sucursal de otra es el texto —ciudad, dirección, estado—, no un
   color. Si alguien pide colores por sucursal, contradice el feature entero.
3. **Las tres pantallas siguen legibles con la paleta más agresiva** porque nada
   depende de `--color-brand` para transmitir información: los estados van por
   `positive`/`warning`/`danger`, que la tienda **no** puede sobrescribir (solo
   puede las cuatro de marca). Un comerciante con marca roja no convierte
   «Cerrada» en algo que parezca «Abierta».
4. El panel **no** se tematiza (nunca lo hizo): `/admin` usa los tokens base.

---

## Accesibilidad

**Orden de foco (Tab).**

- _Selector_: (cabecera: nombre de marca, que **no** es foco porque no es
  enlace) → sucursal 1 → sucursal 2 → … → pie. **Un solo tab stop por
  sucursal**: la tarjeta entera es el enlace. El `Badge` y la ciudad van dentro
  del mismo `<a>`, así que un lector de pantalla lee «La Rampa · Marianao,
  Cerrada ahora, Cerrado por vacaciones, Calle 100, Marianao, enlace».
- _`/sucursales`_: `← Volver a …` → (el aviso **no** es foco: es
  `role="status"` con `aria-live="polite"`, se anuncia sin robar el foco) →
  sucursales en el orden de la lista, **saltando la actual** (no es enlace,
  lleva `aria-current="page"`) → pie.
- _Agrupar_: `← {tienda}` → (banner de error, si existe) → el grupo de radios
  (un `Tab` entra, las flechas se mueven dentro: es un `<input type="radio">` de
  verdad, no un `div role="radio"`) → `Sí, agrupar las dos tiendas` →
  `No, dejarlo así`. La vista previa **se inserta debajo** del radio y **el foco
  no se mueve**: moverlo por marcar un radio desorienta (lección de F-010).
- _Tras un error_: el foco salta al `Alert` (`tabIndex={-1}` + `focus()`) y desde
  ahí un `Tab` llega al botón de reintentar.
- _Tras el 200_: el foco salta al `<h2>` del resultado, porque el contenido que
  hay que leer —las URL— está ahí y no donde estaba el botón.
- _`Escape`_ con la confirmación abierta: vuelve al estado «elegida, sin
  confirmar» y el foco al radio elegido. Nada se envía.

**Semántica.**

- Un `<h1>` por pantalla; `<h2>` por sucursal en el selector; `<h3>` para
  `Sucursales de esta marca` y `Qué va a cambiar`.
- La lista de sucursales es una `<ul>` de `<li>`, no `<div>`s: el lector anuncia
  «lista de 2 elementos», que es la información que da esta pantalla.
- La sucursal actual en `/sucursales`: `aria-current="page"` en el `<li>` y
  `Badge` `Estás aquí` como texto —no solo un color—.
- El aviso del carrito: `role="status"` + `aria-live="polite"`. **No**
  `role="alert"`: no es una interrupción, y `Alert tone="muted"` ya lo resuelve
  así en el componente (`TONE_ROLE`).
- «Qué va a cambiar» a 768+ es una `<table>` de verdad con `<caption
class="sr-only">Qué cambia en cada dirección</caption>` y
  `<th scope="col">`. A 360, los bloques llevan `Ahora:` / `Después:` como
  texto visible, no como columna implícita.
- Las flechas `→` y `↗` van `aria-hidden`; los enlaces que abren pestaña llevan
  `aria-label="Ver la tienda en una pestaña nueva"`, como ya hace `StoreList`.
- El `<fieldset><legend>` de las candidatas es obligatorio: un grupo de radios
  sin `legend` es «una tienda» repetido tres veces.

**Área de toque.** Tarjeta de sucursal `min-h-20` (80 px, y en 360 ocupa el
ancho); enlaces de la tira y de las hermanas `min-h-11` (44 px); `RadioCard`
`min-h-14`; botones `Button size="md"` = `min-h-11`.

**Contraste.** Todo par texto/fondo sale de combinaciones que ya están en
producción (`text-fg` sobre `bg-surface`, `text-brand-contrast` sobre
`bg-brand`, los `Badge` con `bg-x/12 text-x`). El caso que hay que **mirar** y
que no se puede afirmar leyendo JSX es la afordancia `text-brand` sobre
`bg-surface` con la marca de `tienda-dos` (verde) en modo oscuro: es el paso
`V16`, y está sin ejecutar. Si no llega, la salida es quitarle el color a la
afordancia y dejarla `text-fg` con subrayado.

**Teclado, casos concretos.** El selector se recorre entero con `Tab` y se abre
con `Enter` (son enlaces, no botones con `onClick`). En `agrupar`, `Enter` sobre
un radio **no** envía nada: la única forma de aplicar es el botón de confirmar
—en una acción sin vuelta atrás, un `Enter` de más no puede agrupar dos
tiendas—.

---

## Coste de cliente

**Una sola isla nueva en la vitrina, y en una ruta que el presupuesto no mide.**
Comprobado en `scripts/check-bundle-budget.mjs`: recorre los `.html` de
`.next/server/app` y suma los `<script src>` que **referencia una página
prerenderizada**; una ruta `force-dynamic` no emite `.html`, así que no entra en
la medición (es la misma VE3 que verifiqué en F-011).

| Módulo                                  | Directiva      | Justificación contra `AGENTS.md`                                                                                                                                                          | Ruta                                 | Estimado (gzip) |
| --------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------- |
| `BranchList`, `BranchCard`, `BranchBar` | —              | **Sin estado y sin eventos**: enlaces y texto. Y renderizan vitrina, donde la directiva está **prohibida** de plano                                                                       | `/[slug]` (`●`), `/[slug]/p/*` (`●`) | **0**           |
| `/[slug]` en modo selector              | —              | Server component. Además **quita** el `CartBadge` (una marca no tiene carrito), así que carga **menos** cliente que el catálogo al que sustituye                                          | `/[slug]` (`●`)                      | **0, y baja**   |
| `BranchSwitchNotice`                    | `"use client"` | Lee `localStorage` —que solo existe en el navegador— y tiene que reaccionar a un `storage` de otra pestaña. Sin cliente **no hay número que mostrar** y el criterio 6 no se puede cumplir | `/[slug]/sucursales`                 | ~0.8 KB propios |
| `GroupStoresForm`                       | `"use client"` | Estado (candidata elegida, confirmando, enviando, error, resultado) y eventos (`fetch` al endpoint de agrupar). Es el patrón de las cuatro islas de F-011                                 | `/admin/…/agrupar` (`ƒ`)             | ~1.5 KB         |
| Card «Tu marca», hub, selector, tira    | —              | Cero módulos de cliente                                                                                                                                                                   | `/admin/**`, `/[slug]`               | **0**           |

**El presupuesto de 193 KB no se mueve, y por construcción**:

1. La única ruta `●` que cambia es `/[slug]`, y en modo selector carga un
   subconjunto de lo que ya cargaba (sin `CartBadge`, sin `AddToCartButton`).
   El «peor caso» que mide el script sigue siendo la página de catálogo.
2. La isla del carrito aterriza en `/[slug]/sucursales`, que no emite `.html`.
   Su grafo (`cartStorage` + `parseCart` + `cartStore`) **ya viaja** hoy en
   `/carrito` y `/checkout`, así que ni siquiera es código nuevo en el proyecto.
3. La isla del panel aterriza en `/admin`, que es `force-dynamic` entero (R9).
4. **Cero dependencias nuevas.** Sin Zod en el árbol de cliente: la isla del
   carrito no valida nada (lo hace `parseStoredCart`, que ya existe y no usa
   Zod), y la del panel mapea el `error` del endpoint a español con un objeto
   plano.

**Y F-013, que quiere bajar el número, sale beneficiado**: cada marca
multisucursal añade una página `●` con menos cliente que la media.

**Una nota para el plan, no un cambio de diseño.** `architecture.md` pone
`/[slug]/sucursales` como `force-dynamic`. Esta pantalla **no lee nada por
petición**: ni cookies, ni cabeceras, ni cotización —el carrito es del
navegador—. Podría ser `●` con `revalidate = 3600` literal, servirse del CDN
(que es lo que importa en la conexión de un teléfono cubano) y dejar el `grep`
del criterio 7 con una fila `ƒ` menos. El diseño **funciona igual de las dos
maneras** y no depende de la elección: la primera línea del aviso es universal y
la isla hidrata después. Si se queda `ƒ`, no cambia ni una palabra de este
documento; si pasa a `●`, el presupuesto la empieza a medir y sube ~2 KB en esa
página (nunca en el peor caso, que es el catálogo). Decide el plan.

---

## Textos

Microcopy exacto. `{n}`/`{N}` en singular o plural con ternario; `{name}` es el
nombre tal como lo manda el POS.

**Selector `/[slug]`**

- `Elige tu sucursal`
- `{brandName} tiene {N} sucursales. Los precios y los productos pueden cambiar de una a otra.`
- Afordancias: `Ver el catálogo →` · `Ver por qué está cerrada →` · `Ver la sucursal →`
- Badges: `Abierta` · `Cerrada ahora` · `Suspendida`
- Línea sin catálogo: `Todavía sin productos publicados.`
- Todas cerradas (`Alert tone="warning"`), título: `Ahora mismo no hay ninguna sucursal abierta.`
  cuerpo: `Las {N} están cerradas. Puedes ver por qué en cada una, y esta página se actualiza sola cuando alguna vuelva a abrir.`
- Metadatos: `title = {brandName}` ·
  `description = Elige una de las {N} sucursales de {brandName} para ver su catálogo y hacer tu pedido.`

**Tira de sucursal**

- `Estás en {branchName}.` + `Cambiar de sucursal`
- Cerrada: `Esta sucursal está cerrada.` + `Ver las otras {N-1} sucursales` / `Ver la otra sucursal`

**`/[slug]/sucursales`**

- `← Volver a {branchName}` / `← Volver`
- `Cambiar de sucursal`
- A (siempre, y en el HTML de la primera respuesta): `Tu carrito no se mueve: cada sucursal guarda el suyo.`
- B: `Dejas {n} productos en el carrito de {branchName}. Siguen ahí cuando vuelvas.`
  (`{n} producto` en singular)
- B (nota): `Un carrito que no tocas en 30 días se vacía solo.`
- C: no tiene texto propio — es **A + B**
- D (servidor, si alguna sucursal de la lista está cerrada): `Una sucursal cerrada guarda su carrito igual: cuando vuelva a abrir, lo que armaste va a estar ahí.`
- E: `Tu navegador no está guardando el carrito. Si cambias de sucursal ahora, vas a perder lo que armaste en {branchName}.`
- F (`<noscript>`): `Sin JavaScript no podemos contarte lo que tienes en cada carrito. No se borra nada: cada sucursal guarda el suyo.`
- Badge de la actual: `Estás aquí`

**Panel · Card «Tu marca»**

- `Tu marca`
- `Esta es tu única sucursal, así que esa dirección lleva directo a tu catálogo.`
- `Esa dirección muestra la lista de tus {N} sucursales.`
- `Sucursales de esta marca`
- `Esta tienda` · `Abrir en el panel` · `Ver ↗`
- `Agrupar otra tienda en esta marca`
- Sin candidatas: `Cuando publiques otro local desde Cuadre de Caja vas a poder agruparlo aquí.`

**Panel · Agrupar**

- `Agrupar otra tienda en tu marca`
- `Las tiendas agrupadas comparten una sola dirección: tus clientes entran por la marca y eligen la sucursal. Cada sucursal conserva su propio catálogo, sus precios y su propia dirección.`
- Aviso previo, título: `Esto no se puede deshacer.`
  cuerpo: `No hay forma de separar dos tiendas agrupadas desde el panel. Lee lo que va a cambiar antes de confirmar.`
- `¿Qué tienda quieres agrupar?`
- Sin candidatas: `No tienes otra tienda para agrupar.` +
  `Solo se pueden agrupar tiendas del mismo negocio que administres tú. Publica el otro local desde Cuadre de Caja y vuelve aquí.`
- `Qué va a cambiar` · encabezados `Dirección` · `Ahora` · `Después` ·
  celdas `El catálogo de {name}` · `La lista de tus {N} sucursales` ·
  `Todavía no existe` · `El catálogo de {name} — sin cambios`
- Advertencia: `Los códigos QR que ya imprimiste siguen funcionando: ninguna dirección deja de responder y ninguna redirige. Pero el QR de {A} va a llevar a la lista de sucursales, no directo a su catálogo. Su catálogo queda a un clic, en queandabuscando.com/{aBranchSlug}.`
- Salida lateral: `¿Prefieres que la dirección de tu marca sea queandabuscando.com/{bSlug}? Entonces agrupa desde {B}.`
- Botones: `Sí, agrupar las dos tiendas` · `No, dejarlo así` · enviando: `Agrupando…`
- `<noscript>`: `Para agrupar dos tiendas necesitas activar JavaScript. Es una acción que no se puede deshacer y preferimos que veas antes qué cambia.`

**Panel · Agrupar · resultado**

- `Listo: {brandName} tiene {N} sucursales`
- `queandabuscando.com/{brandSlug} ahora muestra la lista de las dos.`
- `Los códigos QR que ya imprimiste siguen funcionando.`
- `Volver a {A}` · `Ver la lista de sucursales ↗`

**Panel · Agrupar · errores** (uno por respuesta del endpoint, y ninguno dice
«algo salió mal»)

| Respuesta                | Texto                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `409 DIFFERENT_BUSINESS` | `Esa tienda es de otro negocio. Solo puedes agrupar tiendas del mismo negocio, porque comparten precios y existencias.` |
| `409 ALREADY_IN_BRAND`   | `Esa tienda ya está en esta marca. Actualiza la página para ver tus sucursales.`                                        |
| `403 FORBIDDEN`          | `Ya no tienes permiso sobre una de las dos tiendas. Vuelve a entrar desde Cuadre de Caja.`                              |
| `400`                    | `No pudimos agrupar con la tienda que elegiste. Actualiza la página y vuelve a intentarlo.`                             |
| `401`                    | Camino existente: `/sesion-cerrada` de F-011                                                                            |
| `5xx` o red caída        | `No pudimos agrupar ahora y no cambió nada. Intenta de nuevo en un momento.`                                            |

Las dos frases de 409 mencionan «actualiza la página» a propósito: la lista de
candidatas la filtra el servidor, así que un 409 significa que la pantalla está
vieja, y eso es lo único accionable.

---

## Verificación visual

`V1`–`V7` no necesitan navegador y se pueden correr hoy con `npm run dev`.
`V8`–`V21` **están sin ejecutar** por lo de § Qué se miró: `resize_window`
respondió «Successfully» a 360, 1280 y 1600 y devolvió la **misma** captura de
948×1287 las tres veces. Van escritos para traducirse a
`.agent/specs/F-017/visual.mjs` —Chromium headless sí fija el viewport—, que
hoy no existe y por eso la etapa `visual` sale en ROJO.

**Fixtures que hacen falta antes de correr nada**, y salen del seed de la
etapa 1: las dos tiendas de un solo uso `bodega-uno` y `bodega-dos` (mismo
negocio, 2 productos cada una), firmadas en el token con
`node scripts/mint-sso-token.mjs --stores=…`. **No** se puede verificar
agrupando `tienda-demo` con `tienda-dos`: convertiría `/tienda-demo` en selector
y rompería el criterio 3 de F-004, el `smoke.sh` de F-010 y la medición de
`check:bundle`. Para el estado «todas cerradas» hace falta cerrar las dos
bodegas ya agrupadas con el interruptor de F-011 (dos `PUT` de `status`), y para
el estado D del aviso, cerrar una con carrito dentro.

**Sin navegador**

- **V1** — Agrupar por el endpoint y después
  `curl -s /bodega-uno | grep -c 'data-branch-picker'` → `1`, y el HTML contiene
  **los dos nombres** de sucursal. **Es el criterio 2.**
- **V2** — `curl -s /tienda-demo | grep -c 'data-branch-picker'` → `0`
  (criterio 1), y sigue trayendo los nombres de sus productos (F-004 sin
  regresión).
- **V3** — `curl -s -o /dev/null -w '%{http_code}' --max-redirs 0 /bodega-dos`
  → `200` y sin cabecera `Location` (criterio 3 y HS6: el slug de la sucursal
  que se unió sigue sirviendo **su catálogo**, no el selector).
- **V4** — `curl -s /bodega-uno-<sufijo>/sucursales | grep -c 'Tu carrito no se mueve'`
  → `1`: la frase del carrito está en el **HTML de la primera respuesta**, sin
  JavaScript. **Es la mitad `curl` del criterio 6.**
- **V5** — `curl -s -o /dev/null -w '%{http_code}' /tienda-demo/sucursales`
  → `404` (marca de una sola sucursal).
- **V6** — `npm run build | grep '\[slug\]'`: `/[slug]` y `/[slug]/p/[productSlug]`
  siguen `●`; las dinámicas siguen siendo exactamente `carrito`, `checkout`,
  `pedido/[code]` (más `sucursales` si el plan la deja `ƒ`). **Criterio 7.**
- **V7** — `npm run check:bundle` en 0 y el «peor caso» sigue siendo la página
  de catálogo, no el selector; `npm run check:theme` en 0;
  `grep -rn '"use client"' src/components/ui/ src/components/store/` **vacío**;
  `grep -rn 'features/admin' src/app/\[slug\] src/components/store` **vacío**.

**Con navegador — NO EJECUTADOS**

- **V8** — Selector a 360 px con 2 sucursales: sin scroll horizontal; nombre y
  `Badge` no se solapan; la tarjeta entera es pulsable y mide ≥ 80 px.
- **V9** — Selector a 360 px con **5** sucursales de nombre largo («La Rampa ·
  Reparto Bahía Ampliación»): el `<h2>` trunca, la ciudad no, nada desborda.
- **V10** — Selector a 768 y 1280: una columna `max-w-3xl`; con 6 sucursales, a
  1280 pasa a dos columnas.
- **V11** — Selector con **todas** las sucursales cerradas: el `Alert` arriba,
  las dos tarjetas con su motivo, ningún 404, y `Carrito` **no** aparece en la
  cabecera.
- **V12** — Modo oscuro (`prefers-color-scheme: dark`) en el selector de las dos
  bodegas: cabecera de marca legible, `Badge` `Cerrada ahora` legible.
- **V13** — `/sucursales` con carrito de 3 productos en la sucursal actual: la
  línea de A **no cambia** y la del número **se añade debajo**; la lista se
  desplaza **≤ 40 px** y **hacia abajo**, y nada de lo que ya se podía tocar se
  mueve por encima.
- **V14** — `/sucursales` **sin** carrito en la sucursal actual: el texto **no
  cambia** al hidratar (cero desplazamiento). Es el caso común y el que hay que
  mirar dos veces.
- **V15** — Carrito en **las dos** sucursales (estado C) y una de ellas cerrada
  (estado D): el aviso **no nombra** la otra sucursal ni da su conteo —DP1 en
  «no»—, aparece la línea de servidor de la sucursal cerrada, y **el carrito de
  la otra sigue intacto al volver** (contar los productos antes y después: es la
  comprobación de HS5 y la que de verdad importa).
- **V16** — Contraste de `Ver el catálogo →` (`text-brand`) sobre `bg-surface`
  con la paleta verde de `tienda-dos`, en claro y en oscuro. Si no pasa, la
  afordancia se queda `text-fg` con subrayado.
- **V17** — JavaScript desactivado en `/sucursales`: se lee el `<noscript>`, la
  lista funciona y se puede cambiar de sucursal (son enlaces).
- **V18** — Navegación privada / `localStorage` bloqueado con productos en el
  carrito: sale el estado **E** en `warning`, y no la promesa de permanencia.
- **V19** — `agrupar` a 360 px: los `RadioCard` apilados; «Qué va a cambiar» en
  bloques, con las URL en `break-all` y sin scroll horizontal; los dos botones
  apilados con el primario arriba.
- **V20** — `agrupar` con teclado, de punta a punta: `Tab` al grupo de radios,
  flechas para elegir, la vista previa aparece **debajo** y el foco **no se
  mueve**; `Enter` sobre el radio **no agrupa nada**; `Escape` cierra la
  confirmación y devuelve el foco al radio.
- **V21** — Los tres errores del endpoint, provocados de verdad (una tienda de
  otro negocio, una ya agrupada, y un token sin la segunda tienda): sale el
  texto exacto de § Textos, el foco salta al banner, y **nada** cambió en la
  base (comprobar con `psql` que `Store.storefrontId` sigue igual).

**Qué el guion visual NO puede comprobar por diseño**, y por tanto necesita otro
paso o otro par de ojos. Lo escribo porque el orquestador lo pidió y porque un
guion que se cree capaz de todo deja agujeros con forma de verde:

1. **Si algo está feo.** El guion detecta desbordamiento a 360 px, desplazamiento
   al hidratar y errores de consola; no detecta que un `<h2>` truncado corte el
   nombre en un sitio ridículo (`V9`) ni que dos tarjetas queden desequilibradas.
   Eso es mirar, y es la mitad de `V8`–`V10`.
2. **El contraste real de una paleta de tienda** (`V16`). Se puede **calcular**
   —leer el color computado de `text-brand` sobre `bg-surface` y sacar la razón
   de contraste—, y **así debería escribirse**: como aserción numérica, no como
   captura. Lo que no se puede es decidir el umbral por mí: si sale entre 3:1 y
   4.5:1, alguien tiene que elegir entre bajar el token de la tienda o quitarle
   el color a la afordancia.
3. **El estado del navegador que no guarda** (`V18`). Se simula sobrescribiendo
   `window.localStorage` para que lance, y hay que hacerlo **antes** de que cargue
   el módulo del carrito o `isLocalStorageAvailable()` ya habrá cacheado `true`
   (`cartStorage.ts` lo memoriza una vez por carga). Si el guion no puede
   garantizar ese orden, este paso se queda en manos de un humano con una ventana
   privada.
4. **Lo que pasa en la base** (`V21`). El guion vive en el navegador; que
   `Store.storefrontId` no se moviera después de un 409 lo dice `psql`, y es una
   aserción de `smoke.sh`, no de la etapa `visual`.
5. **El QR de verdad.** Nada automatizable: el sentido entero del feature es que
   un papel pegado en una pared siga funcionando, y eso se comprueba con un
   teléfono y el papel. Merece un paso manual en el plan, una sola vez.
6. **iOS Safari.** Chromium headless no lo cubre, y es donde el `break-all` de
   las URL largas y el `min-h` de las tarjetas se comportan distinto.

---

## Nota histórica sobre AP6

**AP6 se contestó (a)** y este documento está escrito sobre (a) sin
condicionales: al agrupar, la URL de la marca principal pasa de servir catálogo a
servir el selector, ninguna URL deja de responder y ninguna redirige. La
alternativa (b) —crear una marca nueva con un slug que escribe el admin— **ya no
es un camino vivo**: aquí queda solo la constancia de que se evaluó, con lo que
habría costado (un campo de slug validado contra el servicio de HS7, un radio de
qué branding hereda la marca nueva, y la salida lateral de § 5 sobrando).

---

## Respuestas del humano

**Las cinco `DP` están contestadas y ninguna queda abierta**, así que este
documento no bloquea la firma de `plan.md`. Quedan escritas con su respuesta
porque cada una es una decisión de producto que alguien va a querer rastrear.

| #       | Pregunta                                                               | Respuesta                                                    | Qué quedó en el diseño                                                                                                      |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **DP1** | ¿El aviso del carrito menciona los carritos de las _otras_ sucursales? | **No** — «deja el aviso como lo tenía pensado el arquitecto» | El aviso habla del carrito de **la sucursal que se deja**. § 3 y § Textos, sin lista de hermanas y sin conteos por sucursal |
| **DP2** | ¿La Card «Tu marca» nombra hermanas que ese admin no administra?       | **Sí**, sin enlace al panel                                  | § 4, fila «Hermana que este admin NO administra»                                                                            |
| **DP3** | ¿En qué orden se listan las sucursales del selector?                   | **Abiertas primero, alfabético dentro de cada grupo**        | § 1, § Orden                                                                                                                |
| **DP4** | ¿El selector es indexable y entra en el sitemap?                       | **Sí a las dos**                                             | § 1, § Metadatos                                                                                                            |
| **DP5** | ¿Agrupar pide algo más que un clic de confirmación?                    | **No**: dos pasos más la confirmación en línea de la casa    | § 5, pasos 4–6                                                                                                              |
| **AP6** | ¿Puede una URL impresa cambiar de significado al agrupar?              | **(a)**, la recomendada                                      | Todo § 5, y § Nota histórica sobre AP6                                                                                      |

**Mi recomendación en DP1 no ganó, y el documento afirma la decisión, no mi
recomendación.** Lo dejo dicho de una vez para que nadie tenga que reconstruirlo:
lo que se pierde con «no» es que el comprador que armó un carrito en la sucursal
A y está mirando la B no lea que el de A sigue ahí **con su número**; lo que se
gana es un aviso corto, una sola lectura de `localStorage`, y una frontera limpia
con `.agent/specs/propuestas/carritos-abiertos-del-comprador.md`, que pasa a ser
**el único** sitio donde el comprador verá todos sus carritos si el humano decide
meterla en el backlog. El criterio 6 se cumple igual: lo que pide es que se vea
en pantalla qué pasa con el carrito antes de aplicar el cambio, y eso lo dicen
los estados **A**, **B** y **E** del aviso.

## Preguntas al humano

**Ninguna abierta.**
