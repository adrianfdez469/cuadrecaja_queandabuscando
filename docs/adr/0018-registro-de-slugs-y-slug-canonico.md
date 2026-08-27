# 0018 — El registro de slugs, el slug canónico, y la sucursal con URL de primer nivel

**Aceptada** · 27 de agosto de 2026 · F-017

Extiende y **supera en un punto** a [ADR 0012](0012-storefront-sobre-store.md), y
cierra el punto de [ADR 0017](0017-frontera-de-escritura-del-panel.md)
§ «Reabrir cuando» que esperaba a `Storefront`.

## Contexto

ADR 0012 decidió que `Storefront` —la marca— posee el slug, el branding y el
contacto, y dejó tres cosas sin forma: cómo se garantiza que los slugs son
únicos entre tablas, qué pasa con un slug cuando su dueño desaparece, y cuál de
las URL de una sucursal manda cuando tiene dos.

Esa última pregunta no es teórica. Los QR se imprimen en papel, así que un slug
de `Store` ya emitido tiene que responder 200 para siempre, sin redirección
(decisión del humano). Al mismo tiempo la marca quiere ese mismo string. Y hay
una consecuencia que solo se ve leyendo el código: `src/lib/cache.ts:19-23`
construye los tags de ISR **con el slug de la URL pedida**
(`queries.ts:84,178,197`). Con dos URL vivas por sucursal, invalidar por la URL
pedida deja la otra rancia **para siempre**: el peor tipo de bug, el que nadie
nota porque la página sigue respondiendo 200 con datos viejos.

Además, hoy `Business.slug` y `Store.slug` son únicos **cada uno en su tabla**,
así que dos tablas pueden coincidir; nada impide un slug `admin` o `api`; y
`Business.slug` se genera en cada creación (`handlers/store.ts:38`) sin que
**ningún** módulo lo lea.

## Decisión (a) — un registro de slugs con la exclusividad en la base

Una tabla `Slug` donde conviven marcas, sucursales y palabras reservadas, con el
valor del slug como **clave primaria**. Tres propiedades, tres piezas distintas,
ninguna que dependa de recordar nada:

1. **Un valor tiene como máximo un dueño** → la clave primaria.
2. **Un dueño tiene como máximo un valor** → un índice único por columna de
   dueño (`storefrontId`, `storeId`).
3. **El `kind` no miente** → un `CHECK` escrito a mano en la migración, porque
   Prisma no puede declararlo:

```sql
ALTER TABLE "Slug" ADD CONSTRAINT "Slug_owner_matches_kind" CHECK (
     ("kind" = 'RESERVED'   AND "storefrontId" IS NULL AND "storeId" IS NULL)
  OR ("kind" = 'STOREFRONT' AND "storeId" IS NULL)
  OR ("kind" = 'STORE'      AND "storefrontId" IS NULL)
);
```

**Nunca un `SELECT` previo en código**: una comprobación de aplicación pierde
cualquier carrera y no es lo que exige el criterio.

**Un valor no se reasigna nunca.** Las claves ajenas van con
`ON DELETE SET NULL`, así que al desaparecer el dueño la fila **sobrevive** con
el puntero a `null` y `retiredAt` puesto: no resuelve y no vuelve al pool. Un QR
impreso no puede acabar apuntando al negocio de otro.

El `CHECK` permite a propósito `kind = 'STOREFRONT'` con `storefrontId IS NULL`
—ese es el estado retirado—, y como efecto secundario deseable un `INSERT` de un
valor ya tomado llega hasta la clave primaria y falla con el mensaje que dice la
verdad: `duplicate key value violates unique constraint "Slug_pkey"`.

**Cada palabra reservada tiene su fila** (`kind = 'RESERVED'`), así que la lista
de `src/lib/slug.ts` no es la única defensa: una escritura que se salte la
validación choca con la clave primaria.

**`Business.slug` se retira** (nullable, deja de generarse) y **no** entra en el
registro. Un negocio llamado «La Rampa» reservaría `la-rampa` para una fila que
no resuelve ninguna URL, y se lo quitaría a la marca que sí la resuelve.

## Decisión (b) — la sucursal de una marca con varias conserva un slug de primer nivel

**Esto supera la línea de ADR 0012** que dice «con N, `/[slug]` muestra el
selector y las páginas viven en `/[slug]/[sucursal]`». Se conserva la primera
mitad y se cambia la segunda:

- Una marca con **una** sucursal renderiza el catálogo directo en `/[slug]`. El
  comerciante de un solo local no nota que la capa existe.
- Una marca con **varias** sirve en `/[slug]` un **selector** de sucursales, y
  cada sucursal vive en **su propio slug de primer nivel** (`/la-rampa-vedado`),
  no en un segundo segmento.

Tres motivos, los tres del código:

1. `/[slug]/[sucursal]` conviviría con los segmentos estáticos `carrito`,
   `checkout`, `p` y `pedido`. Next resuelve el estático primero, así que haría
   falta un **segundo** espacio de palabras reservadas con su propia validación.
2. Duplicaría el árbol de rutas de la vitrina: la marca de una sola sucursal
   tiene que seguir sirviendo en `/[slug]`, así que habría dos juegos de las
   mismas seis páginas que F-004, F-007 y F-010 ya verificaron.
3. **No resuelve el problema de fondo**: una sucursal seguiría teniendo dos URL
   (la anidada y su slug histórico). Eso lo cierra la decisión (c), no la forma
   de la URL.

Es reversible en la dirección que importa: añadir `/marca/sucursal` después como
**alias** con `canonical` al slug de primer nivel es aditivo. Empezar anidado y
volver, no: rompe papel ya impreso.

## Decisión (c) — el slug canónico es la única clave de caché, de tags y de tema

```
canonicalSlug(sucursal) =
    slug de su marca      si la marca tiene exactamente UNA sucursal renderizable
    su propio Store.slug  si la marca tiene varias
```

- Lo calcula **una** función pura (`src/lib/publicSlug.ts`), que exige el número
  de sucursales renderizables de la marca: no se puede inventar sin haber
  consultado la marca.
- Viaja en un **tipo marcado** (`PublicSlug`), el mismo patrón que
  `AuthorizedStoreId` ya usa en el panel. `storeTag`, `storeCatalogTag`,
  `revalidateStores` y las cuatro lecturas cacheadas aceptan **solo** ese tipo,
  así que pasarles el slug de la URL es un **error de compilación**.
- **Dos URL de la misma sucursal comparten entrada de caché, tags y
  `data-store`.** Es lo que evita que la URL del alias quede rancia para
  siempre.
- La **resolución** tiene su propio tag (`slug:<valor>`), que se invalida cuando
  cambia el registro, y la marca el suyo (`storefront:<slug>`), que dispara todo
  escritor desde el primer día aunque su único lector —el selector— llegue
  después.

Y **un solo resolvedor** (`src/features/storefront/server/resolve.ts`) en lugar
de los cuatro que hoy resuelven por slug con su propia consulta
(`queries.ts:53`, `quote.ts:86`, `read.ts:56`, `admin/server/stores.ts`). Se
hace cumplir con el tipo marcado, con la firma de las lecturas y con un test de
fronteras por `grep` —el mismo mecanismo que ya protege el embudo del panel—.

## Decisión (d) — derivar y proponer son dos caminos, y solo uno rechaza

`uniqueSlug` **disfraza** hoy una palabra reservada (`admin` → `admin-tienda`).
Eso es correcto para el sync —un evento del POS no debe fallar por el nombre
desafortunado de un local, o se reintenta para siempre y la tienda nunca se
publica— y es incorrecto para un slug que alguien **propone**.

- **Derivar** (el sync, desde `payload.slug || payload.name`): disfraza y sufija.
  El evento sale `processed`.
- **Proponer** (el registro, y el día que el panel lo edite): se **valida y se
  rechaza** con un error tipado, **antes** de tocar la base.
- **Red de seguridad**: la fila `RESERVED` y la clave primaria.

Ninguna fila de la base acaba nunca con el valor `admin` o `api`, que es lo que
el requisito protege.

**Y el disfraz es consultable, no una sorpresa.** Un comerciante no puede
enterarse del slug de su tienda después de publicarla, así que
queandabuscando expone un endpoint interno de solo lectura —
`GET /api/internal/slug-availability` — que responde, para un candidato, si está
tomado y **cuál sería el slug final**. Tres propiedades lo definen: usa **la
misma** función que la creación (si fueran dos implementaciones, mentiría el día
que alguien cambiara una), **no reserva** nada (reservar sin publicar aparta
slugs para tiendas que nunca llegan, y obliga a un caducado que nadie pidió), y
**no acepta un `businessId`** (el espacio de slugs es global: no hay identidad
que suplantar, lo que deja el endpoint alineado con
[ADR 0013](0013-identidad-de-integracion.md) antes de que F-018 lo exija).

Es contrato con el otro equipo y **aditivo**: se suma al anuncio de la v3 de
`docs/sync-contract.md` que todavía está pendiente de enviar, en vez de abrir una
v4 aparte. Dos anuncios seguidos al mismo equipo por dos cambios aditivos es la
forma más fácil de que el segundo no se lea.

## Decisión (e) — el branding y el contacto suben a la marca

Cierra ADR 0017 § «Reabrir cuando». `themeTokens`, `logoUrl`, `coverUrl` y tres
columnas de contacto propias del panel (`contactPhone`, `contactWhatsapp`,
`contactEmail`) viven en `Storefront`, y el sync **no escribe ninguna columna de
la marca** salvo crearla entera la primera vez. La frontera de ADR 0017 (a) se
cumple **por construcción**: no hay una sola columna compartida entre el sync y
el panel en esa tabla, así que no hay «gana el último» posible.

El contacto tiene **dos** lecturas, y la distinción es de producto:

- **Presentación** (lo que el comprador ve y pulsa) =
  `marca.contactX ?? sucursal.<columna sincronizada>`, con la precedencia en un
  solo módulo, gemelo de `lib/pricing.ts`.
- **Enrutado de un pedido** = **siempre** la sucursal
  (`Store.whatsapp ?? Store.phone`). Un pedido lo atiende un local concreto, y
  cambiarlo tocaría el pull del POS y `docs/sync-contract.md`.

`Storefront` **no** recibe `status` ni columnas de cierre: abrir y cerrar al
público sigue siendo de la sucursal, porque el opt-in del POS (`sourceOptIn`) es
por `Tienda` y subir el interruptor a la marca haría que un flip en un local
abriera o cerrara los demás.

## Decisión (f) — agrupar dos tiendas bajo una marca, desde el panel, y sin desagrupar

La marca nace al publicar la primera sucursal, una por tienda. Juntar dos bajo
una sola marca es una **acción explícita del panel**, no un efecto del sync.

- Se agrupan **dos tiendas**, no una tienda y una marca: la sesión del panel trae
  `storeIds`, así que el permiso solo se sabe decir de una tienda, y agrupar toca
  dos. Se autorizan **las dos**.
- La marca de la tienda **principal** sobrevive con su slug, su branding y su
  contacto. La de la que se une queda vacía y se borra.
- **El slug de la marca que se vacía pasa a ser el slug propio de esa sucursal**:
  la misma URL sigue sirviendo el mismo catálogo. No es reasignar un valor a otro
  dueño —lo que la decisión (a) prohíbe—, es la misma tienda con el mismo
  contenido y otro tipo de fila en el registro.
- La sucursal principal, que no tenía slug propio porque su marca lo poseía,
  **estrena uno** derivado de su nombre. Su marca pasa a servir el selector.
- **Ninguna URL deja de responder y ninguna redirige.** Lo que cambia es el
  contenido de una: la de la marca principal, que pasa de catálogo a selector.
  Eso es lo que agrupar significa, y por eso la pantalla **tiene que enseñar las
  dos URL resultantes antes de aplicar**.
- Las cinco escrituras van en **una transacción por lotes** (`$transaction([…])`,
  la forma de array): si se aplicaran tres de cinco, una URL quedaría apuntando a
  nada. En forma de array no hay manera de usar el cliente global dentro, que es
  lo único que hace deadlock contra el pooler en modo transacción.
- **No se permite**: agrupar tiendas de negocios distintos (decisión de que todas
  las sucursales de una marca son del mismo `Business`), agrupar una tienda en la
  marca que ya tiene, ni agrupar sin permiso sobre las dos.
- **Desagrupar no existe.** Habría que decidir qué slug de marca recibe la que se
  va, y crear una marca nueva significa estrenar una URL que nadie ha impreso. Es
  su propio feature, con su propia decisión.

## Alternativas descartadas

- **Clave ajena compuesta** `Slug(value, storefrontId) → Storefront(slug, id)`:
  garantizaría además que el registro y la columna no derivan, pero necesita
  `ON DELETE SET NULL (columna)` (Postgres 15+) para no borrar la fila retirada
  y Prisma no puede declararla, así que reaparecería en cada `migrate diff` como
  la trampa de los índices GIN.
- **El slug solo en `Slug`, sin columna en `Storefront`**: mata la deriva por
  construcción, pero mete un `JOIN` en toda lectura pública.
- **Comprobar la unicidad en código**: pierde cualquier carrera.
- **Dar a la marca un slug nuevo y conservar el de la sucursal**: dos URL
  públicas por tienda para siempre y la marca obligada a `tienda-demo-2`.
- **`/[slug]/[sucursal]`**: ver decisión (b).
- **Re-preciar o vaciar el carrito al cambiar de sucursal** (la consecuencia que
  ADR 0012 anticipaba): innecesaria. F-010 guarda cada carrito bajo
  `qab.cart.v1.` + `Store.id`, así que cada sucursal ya tiene el suyo y cambiar
  no pierde nada. Decisión del humano: el carrito solo se borra con un pedido
  hecho, vaciándolo el comprador, o al expirar.
- **Subir el interruptor de cierre a la marca**: un flip del POS en un local
  abriría o cerraría los demás.
- **Que la consulta de slug lo reserve**: apartaría slugs para tiendas que nunca
  se publican.
- **Agrupar creando una marca nueva** con un slug que el admin escribe, en vez de
  quedarse con la de la tienda principal: no cambiaría el significado de ninguna
  URL existente —es su ventaja— pero estrena un tercer nombre que nadie ha
  impreso, obliga a decidir qué branding hereda la marca nueva y borra dos marcas
  en vez de una. **Descartada por el humano** (HS10): se acepta que la URL de la
  marca principal pase de catálogo a selector, a cambio de un formulario sin
  campo de slug y de no tener que decidir qué branding hereda.
- **La segunda sucursal desde un fixture del seed**: un fixture no le sirve a
  ningún comerciante, y la acción de agrupar hacía falta de todos modos.

## Consecuencias

- La migración **mueve** el slug de la sucursal a la marca. La URL impresa
  responde 200 sin redirección; el string pasa a ser de la marca.
- El canónico de una sucursal **cambia** si su marca pasa de una a dos
  sucursales. Quien construya la acción de agrupar tiene que revalidar el
  canónico viejo, el nuevo y el tag de la marca. La alternativa anidada tiene
  exactamente la misma consecuencia.
- Una marca con más de una sucursal exige que **todas** tengan `slug` no nulo.
  Ninguna restricción de base lo expresa: es un invariante de la acción de
  agrupar (decisión (f)), con su test.
- Agrupar **no tiene vuelta**, así que se verifica contra fixtures dedicadas y
  nunca contra las tiendas de las que dependen otros features ya verificados.
- Tres columnas de `Store` se borran (`themeTokens`, `logoUrl`, `coverUrl`).
  Es el único paso irreversible de la migración y exige volcado antes.
- El sitemap publica **una** URL por sucursal, la canónica; la URL viva de la
  sucursal lleva `alternates.canonical` a ella: sin redirección y sin competir
  consigo misma en el buscador.
- El contrato con cuadrecaja **no cambia**: `Storefront` es propio de
  queandabuscando y el POS no lo conoce. No hay v4.

## Reabrir cuando

- Alguien pida **desagrupar**: es la mitad que la decisión (f) deja fuera a
  propósito, y su problema es qué URL recibe la sucursal que se va.
- Alguien pida `/marca/sucursal`: se añade como **alias**, con `canonical` al
  slug de primer nivel, y esta ADR gana un párrafo en la decisión (b).
- Llegue el marketplace: el registro de slugs es el sitio donde vivirían los
  slugs de categoría global o de campaña, y entonces habrá que decidir si
  comparten espacio de nombres con las marcas o no.
- **F-022** escriba la tabla exhaustiva de propiedad de campos: el bloque de
  `Storefront` sale de la decisión (e), y la fila del contacto es la que tiene
  dos dueños con precedencia.
