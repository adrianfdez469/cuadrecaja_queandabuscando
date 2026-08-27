---
feature: F-017
agente: sdd-architect
actualizado: 2026-08-27T02:41:13Z
estado: listo
---

> **Entrada.** `.agent/specs/F-017/spec.md` (`estado: listo`, con § Fuera ya
> corregido por el orquestador) más los **ocho criterios reales** de
> `.agent/features.json` en `main`, que llegaron a mitad de este ciclo y
> **amplían** el alcance: sus criterios 2 y 6 exigen el selector de sucursal y el
> aviso del carrito. Y una segunda ampliación, de la ronda de respuestas del
> humano: **HS7** (un servicio que le diga a cuadrecaja qué slug va a quedar) y
> **HS8** (agrupar dos tiendas bajo una marca, desde el panel). Los criterios
> mandan (regla 3).
>
> Qué leí, además: `AGENTS.md` completo, ADR 0006/0007/0012/0016/0017,
> `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/migrations/*`,
> `src/lib/{slug,cache,pricing}.ts`, `src/constants/cart.ts`,
> `src/features/catalog/server/queries.ts`,
> `src/features/sync/server/{processBatch,availability}.ts` y
> `handlers/{store,product}.ts`,
> `src/features/orders/server/{quote,read,createOrder,pull}.ts`,
> `src/features/admin/server/{mutations,stores,boundaries.test}.ts`,
> `src/features/admin/authorization.ts`, `src/features/theming/storeTheme.ts`,
> `src/app/[slug]/**`, `src/app/{sitemap,robots}.ts`, `src/proxy.ts`,
> `scripts/{send-store-batch,check-bundle-budget}.mjs`,
> `.agent/specs/F-011/{architecture,design}.md` (§ el embudo, § Congelado),
> las dos fichas de `prisma migrate` del playbook, y la base de desarrollo real
> (3 tiendas, 1 negocio, PG 16.15, cuatro migraciones aplicadas sin drift).
>
> **Decisiones del humano que no se reabren**, y que este documento ya aplica
> enteras: HS1 (alcance recortado, salvo lo que los criterios 2 y 6 devuelven),
> HS2 (la marca nace al publicar la primera sucursal, uno a uno), HS4 (un slug de
> `Store` ya emitido responde 200: ni 404 ni redirección), **HS5** (el carrito no
> se borra nunca al cambiar de sucursal: cada tienda conserva el suyo; el criterio
> 6 se cumple **informando**), **HS6** (la sucursal conserva slug propio de primer
> nivel y `/[marca]` muestra el selector), **HS7** (el sync disfraza un slug
> reservado y cuadrecaja puede consultar de antemano qué slug va a quedar),
> **HS8** (agrupar dos tiendas bajo una marca entra en el alcance, y es de donde
> sale la segunda sucursal que pide el criterio 2), **HS9** (no hay producción: la
> migración va completa de una vez, con los tres `DROP COLUMN` dentro).

## Las dos etapas, y qué firma cada una

Un solo feature, ocho criterios, **dos entregas verificables por separado y dos
firmas**. La etapa 1 es autosuficiente: se construye, se verifica y se puede
dejar en `main` sin que exista ninguna marca con dos sucursales —ninguno de sus
seis criterios la necesita—. La etapa 2 añade la acción de agrupar, la vitrina de
marca y el aviso del carrito.

| Criterio (literal, `features.json`)                                                      | Etapa | Con qué se verifica                                                                     |
| ---------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| 1. `/[slug]` de marca con UNA sucursal → 200, sin selector en el HTML                    | 1     | `curl` de `/tienda-demo` + `grep -c` del marcador del selector                          |
| 2. `/[slug]` de marca con DOS sucursales → 200 y el HTML contiene ambas                  | **2** | `POST` de agrupar sobre las dos fixtures dedicadas + `curl` + `grep` de los dos nombres |
| 3. Slug de `Store` ya emitido → 200, ni 404 ni redirección                               | 1     | `curl --max-redirs 0` de la fixture con `Store.slug` vivo                               |
| 4. Sucursal con slug ya usado por una marca → error de restricción única                 | 1     | `INSERT` a mano en `Slug` por `psql` del contenedor                                     |
| 5. Crear una tienda con slug `admin` o `api` falla                                       | 1     | test del registro (0 queries) + `INSERT` a mano                                         |
| 6. Cambiar de sucursal con carrito lleno: se ve en pantalla qué le pasa antes de aplicar | **2** | `curl` de `/[slug]/sucursales` + prueba de UI del aviso                                 |
| 7. `npm run build` sigue marcando las rutas de tienda como SSG                           | 1 y 2 | `npm run build \| grep '\[slug\]'`                                                      |
| 8. `bash .agent/verify.sh F-017 --full` → 0                                              | 1 y 2 | el sensor                                                                               |

**Etapa 1** (el modelo, la URL y el contrato): `Storefront`, `Slug`, la
migración, el resolvedor único, el slug canónico de invalidación, las palabras
reservadas, el sync que crea marca + sucursal, **el servicio de disponibilidad de
slug (HS7)**, el branding y el contacto en su sitio, y el seed con la fixture de
alias y las dos fixtures dedicadas a agrupar. Criterios **1, 3, 4, 5, 7, 8**.

**Etapa 2** (la marca con varias sucursales): **la acción de agrupar (HS8)** —de
donde sale la segunda sucursal—, el listado de sucursales como componente de
servidor, `/[slug]` en modo doble (catálogo o selector), y `/[slug]/sucursales`
con el aviso del carrito. Criterios **2, 6**, y revalidar 7 y 8.

Por qué el servicio de slug va en la etapa 1 y no en la 2: solo depende del
registro, es lo que hace **predecible** el disfraz que la etapa 1 introduce, y lo
consume el otro equipo —cuanto antes tenga la forma, antes puede empezar—.
Por qué agrupar va en la etapa 2: sin selector, una marca con dos sucursales
tendría una URL que no sabe qué renderizar.

---

## Estado actual relevante

Qué existe y **se reutiliza tal cual** —esto es lo primero, porque un componente
nuevo que duplica uno existente es una regresión:

| Ya existe                                                                        | Se reutiliza                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/lib/cache.ts` (`storeTag`, `storeCatalogTag`, `cached`, `revalidateStores`) | Entero. Gana **un** tag y **un** tipo; ninguna firma cambia de forma (R17)             |
| `src/lib/slug.ts` (`slugify`, `isValidSlug`, `isReservedSlug`, `uniqueSlug`)     | Entero. La lista crece y se exporta; `uniqueSlug` **no** cambia de comportamiento (I4) |
| `src/features/catalog/server/queries.ts`                                         | Entero: las cuatro lecturas cacheadas siguen siendo las mismas, con otra clave         |
| `src/features/theming/storeTheme.ts::renderStoreTheme`                           | Entero, sin tocar una línea: es puro y recibe slug + tokens (E18)                      |
| `src/lib/pricing.ts`, `src/lib/promotions.ts`, `src/lib/money.ts`                | Sin cambios                                                                            |
| `src/features/cart/**` y `src/constants/cart.ts`                                 | **Sin cambios.** Ver § El carrito no se toca                                           |
| `src/features/orders/server/quote.ts::quoteCart`, `toQuoteResponse`              | Enteros: solo cambia cómo se resuelve la tienda antes de cotizar                       |
| `src/features/admin/server/mutations.ts` (el embudo y `commit()`)                | Entero: la escritura del branding entra por ahí, no por un camino nuevo                |
| `src/features/admin/authorization.ts` (`AuthorizedStoreId`)                      | Es el **patrón** del tipo marcado que copia `PublicSlug`                               |
| `src/components/store/StoreClosedNotice.tsx`                                     | Entero, con los mismos props: se le pasan valores ya resueltos                         |
| `src/features/admin/server/boundaries.test.ts`                                   | Es el **patrón** del test de fronteras por `grep` que copia el del resolvedor          |
| `src/proxy.ts`                                                                   | **No se toca.** Su `matcher` sigue sin cubrir `/[slug]` (R20)                          |

Y las cuatro cosas que hoy son verdad y que este feature invalida:

1. `/[slug]` resuelve un `Store` con `findFirst({ where: { slug } })`
   (`queries.ts:53`), y hay **cuatro** implementaciones más de lo mismo
   (`quote.ts:86`, `read.ts:56`, `admin/server/stores.ts:20,52`) — I6.
2. Los tags de ISR se construyen con **el slug pedido**
   (`cache.ts:19-23`, `queries.ts:84,178,197`) — I5, el fallo caro.
3. El branding vive en `Store` y el sync reescribe `description`, `phone`,
   `whatsapp` y `email` en **todo** evento (`handlers/store.ts:90-104`).
4. `Business.slug` se genera (`src/features/sync/server/handlers/store.ts:38`) y **nadie lo lee** — I1.

Base de desarrollo, comprobada: 3 `Store` (`tienda-demo`, `tienda-dos`,
`tienda-cerrada`), 1 `Business` (`la-rampa`), Postgres **16.15** en el 5433,
migraciones `_init`, `_order_idempotency_and_original_price`,
`_store_public_switch`, `_promotion_name`, todas aplicadas y **sin drift ahora
mismo** (las cuatro carpetas locales coinciden con `_prisma_migrations`).

---

## Decisión

**Una tabla `Slug` con el valor como clave primaria y un `CHECK` que ata el
dueño al `kind`; el slug público canónico de una sucursal como única clave
de caché, ISR y `data-store`, minado por una función pura y transportado por un
tipo marcado; un resolvedor cacheado en `features/storefront/server/` por el que
pasan las cinco lecturas que hoy resuelven por su cuenta; una migración de ocho
pasos en un solo archivo transaccional que mueve el slug de la sucursal a la
marca; la sucursal de una marca con varias conserva un slug de primer nivel, con
`/[slug]` de la marca en modo selector; un endpoint interno de solo lectura que
le dice a cuadrecaja qué slug va a quedar, con la misma función que lo decide de
verdad; y agrupar dos tiendas como acción del panel, en una transacción por
lotes, sin que ninguna URL deje de responder.**

Alternativas, una línea cada una:

- **Exclusividad del slug con clave ajena compuesta** (`Slug(value, storefrontId)
→ Storefront(slug, id)`): garantiza además que `Slug.value` y
  `Storefront.slug` no derivan, pero necesita `ON DELETE SET NULL (columna)`
  (Postgres 15+) para no borrar la fila retirada, y Prisma no puede declararla,
  así que aparecería en cada `migrate diff` futuro como la trampa de los índices
  GIN. **Descartada.**
- **Exclusividad comprobada en código** (`SELECT` previo): prohibida por el
  criterio 4 y perdedora en cualquier carrera. Descartada.
- **El slug solo en la tabla `Slug`, sin columna en `Storefront`/`Store`**: mata
  la deriva por construcción, pero obliga a un `JOIN` en toda lectura y deja sin
  columna las consultas de verificación. Descartada; la deriva se cierra con un
  único escritor y un `grep` de fronteras.
- **La marca coge un slug nuevo y la sucursal conserva el suyo**: dos URL
  públicas por tienda para siempre y la marca obligada a `tienda-demo-2`.
  Descartada por la spec (paso 4 de la migración) y por HS4.
- **`/[slug]/[sucursal]` para la marca con varias** (letra de ADR 0012): duplica
  el árbol de rutas de la vitrina, mete `carrito`/`checkout`/`p`/`pedido` en un
  segundo espacio de palabras reservadas y **no evita** que una sucursal tenga
  dos URL. Descartada por el humano en **HS6** y sustituida por la del slug de
  primer nivel; contradice una línea de ADR 0012, y por eso se supera con la 0018.
- **Re-preciar o vaciar el carrito al cambiar de sucursal**: cerrada por HS5.
- **Que el disfraz del slug sea una sorpresa** (el POS manda un nombre y se
  entera del slug final cuando ya está publicado): cerrada por HS7 con un
  servicio de consulta. Descartada la alternativa de **reservar** el slug en esa
  consulta: reservar sin publicar deja slugs apartados por tiendas que nunca
  llegan, y obliga a un caducado que nadie pidió.
- **La segunda sucursal desde un fixture del seed**: cerrada por HS8, que mete
  la acción de agrupar en el alcance.
- **Aplazar los tres `DROP COLUMN` a un despliegue posterior**: cerrada por HS9
  (no hay producción), y aplazarlos dejaría esquema muerto y una migración
  pendiente que nadie recordaría.
- **Subir el interruptor de cierre a la marca**: cerrada por R6 (el `sourceOptIn`
  del POS es por `Tienda`).

---

## Componentes

Capas según `AGENTS.md` § Arquitectura. `E1`/`E2` es la etapa.

| Componente                         | Capa                          | Responsabilidad                                                                                                       | Archivo                                                                          | Etapa  |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| `PublicSlug` + `canonicalSlug()`   | `src/lib/`                    | Tipo marcado y **única** función que decide el slug canónico de una sucursal. Pura                                    | `src/lib/publicSlug.ts` (nuevo)                                                  | E1     |
| Palabras reservadas                | `src/lib/`                    | `RESERVED_SLUGS` exportado, `isReservedSlug`, `isValidSlug`, `uniqueSlug` (sin cambio de conducta)                    | `src/lib/slug.ts` (crece)                                                        | E1     |
| Precedencia de contacto            | `src/lib/`                    | `presentationContact()` (marca ?? sucursal) y `routingWhatsappNumber()` (siempre sucursal). Pura                      | `src/lib/storeContact.ts` (nuevo)                                                | E1     |
| Tags y revalidación                | `src/lib/`                    | `storefrontTag`, `revalidateStorefronts`, firmas tipadas a `PublicSlug`                                               | `src/lib/cache.ts` (crece)                                                       | E1     |
| **Resolvedor único**               | `features/storefront/server/` | `resolvePublicSlug(requested)`: `Slug` → sucursal o selector. Cacheado y tagueado                                     | `src/features/storefront/server/resolve.ts` (nuevo)                              | E1     |
| Registro de slugs                  | `features/storefront/server/` | **Único** escritor de `Slug` y `Storefront`: reserva, crea marca + sucursal, reintenta colisiones                     | `src/features/storefront/server/registry.ts` (nuevo)                             | E1     |
| **Pronóstico del slug (HS7)**      | `features/storefront/server/` | `previewSlug()`: si el candidato está tomado y **cuál sería el slug final**. La misma función que el sync             | `src/features/storefront/server/registry.ts`                                     | E1     |
| Esquema del slug propuesto         | `features/storefront/`        | Zod: forma, longitud y rechazo de reservada, con error tipado                                                         | `src/features/storefront/schemas.ts` (nuevo)                                     | E1     |
| Frontera del resolvedor            | test                          | `grep` de `src/`: nadie más resuelve por slug ni escribe en `Slug`                                                    | `src/features/storefront/server/boundaries.test.ts` (nuevo)                      | E1     |
| **Servicio interno de slug (HS7)** | `src/app/`                    | `GET /api/internal/slug-availability`: cáscara fina sobre `previewSlug`, con el guard de siempre                      | `src/app/api/internal/slug-availability/route.ts` (nuevo)                        | E1     |
| Lectura pública                    | `features/catalog/server/`    | Las mismas cuatro lecturas, con `PublicSlug` y el branding leído de la marca                                          | `src/features/catalog/server/queries.ts`                                         | E1     |
| Handler `STORE`                    | `features/sync/server/`       | Llama al registro cuando la sucursal no existe; **no menciona** ninguna columna de la marca                           | `src/features/sync/server/handlers/store.ts`                                     | E1     |
| Revalidación del sync              | `features/sync/server/`       | `touchedStoreSlug` pasa a ser canónico y viaja con el slug de su marca                                                | `handlers/{store,product}.ts`, `availability.ts`, `processBatch.ts`              | E1     |
| Pedidos                            | `features/orders/server/`     | `loadStoreForOrder` y `getOrderByCode` resuelven por el resolvedor; `orderUrl` con el canónico                        | `quote.ts`, `read.ts`, `createOrder.ts`                                          | E1     |
| Panel                              | `features/admin/server/`      | `commit()` revalida el canónico; el enlace público usa el canónico                                                    | `mutations.ts`, `stores.ts`, `types.ts`                                          | E1     |
| Enlace del hub                     | `features/admin/components/`  | `href` al slug canónico                                                                                               | `StoreList.tsx`                                                                  | E1     |
| Rutas de la vitrina                | `src/app/`                    | Resuelven una vez y pasan la resolución hacia abajo. `revalidate = 3600` sigue literal                                | `src/app/[slug]/**`                                                              | E1     |
| Sitemap                            | `src/app/`                    | Una URL por sucursal (su canónico) + una por marca con selector (DP4); `alternates.canonical` en el alias             | `src/app/sitemap.ts`, `[slug]/page.tsx`                                          | E1     |
| Schema y migración                 | `prisma/`                     | `Storefront`, `Slug`, `SlugKind`, `Store.storefrontId`, `Store.slug` nullable                                         | `prisma/schema.prisma`, `prisma/migrations/<ts>_storefront_slug_registry/`       | E1     |
| Seed                               | `prisma/`                     | Marca por tienda, fixture de **alias vivo**, dos fixtures para agrupar, palabras reservadas                           | `prisma/seed.ts`                                                                 | E1     |
| Listado de sucursales              | `src/components/store/`       | Componente **de servidor**: nombre, ciudad, dirección y estado, con enlace. Abiertas primero, alfabético dentro (DP3) | src/components/store/BranchList.tsx (etapa 2, por crear) (nuevo)                 | **E2** |
| `/[slug]` en modo doble            | `src/app/`                    | Una sucursal → catálogo; varias → `BranchList`. Sin JavaScript de cliente                                             | `src/app/[slug]/page.tsx`                                                        | **E2** |
| Página de cambio de sucursal       | `src/app/`                    | `/[slug]/sucursales`: `BranchList` + el aviso del carrito. Dinámica                                                   | `src/app/[slug]/sucursales/page.tsx` (nuevo)                                     | **E2** |
| Aviso del carrito                  | `features/cart/components/`   | Isla de cliente **mínima**: lee el carrito de la tienda actual y dice qué le pasa (nada)                              | src/features/cart/components/BranchSwitchNotice.tsx (etapa 2, por crear) (nuevo) | **E2** |
| **Agrupar (HS8)**                  | `features/admin/server/`      | `groupStoreIntoBrand()`: mueve la sucursal, convierte el slug de la marca que se vacía, emite el que falta            | `src/features/admin/server/mutations.ts` (crece)                                 | **E2** |
| **Autorización de agrupar**        | `features/admin/`             | Autoriza las **dos** tiendas contra `storeIds` de la sesión                                                           | `src/features/admin/authorization.ts` (crece)                                    | **E2** |
| **Endpoint de agrupar**            | `src/app/`                    | `POST /api/admin/stores/{storeId}/branches`, mismo guard y misma capa HTTP de F-011                                   | `src/app/api/admin/stores/[storeId]/branches/route.ts` (nuevo)                   | **E2** |
| Pantalla de agrupar                | `features/admin/components/`  | Elegir la tienda que se une, **enseñar qué URL cambia** y confirmar, en dos pasos (DP5). La diseña `sdd-designer`     | `src/features/admin/components/` (nuevo, E2)                                     | **E2** |
| Hermanas de la marca en el panel   | `features/admin/server/`      | `listBrandBranches(storefrontId)`: nombre y ciudad, **sin `storeId`**, para la tarjeta «Tu marca» (DP2)               | `src/features/admin/server/stores.ts` (crece)                                    | **E2** |

Nada de `src/components/ui/` cambia. Ningún componente nuevo de la etapa 1
lleva `"use client"`.

---

## Modelo de datos

### `Storefront` — la marca

```prisma
/// The brand a shopper's QR points at. Owns the public slug, the branding and
/// the panel's own contact columns. Lives only in queandabuscando: the POS
/// knows nothing about it, so no column here is ever written by the sync
/// except at creation (R5).
model Storefront {
  id         String @id @default(uuid())
  businessId String
  name       String
  slug       String @unique

  // --- owned by the admin panel; the sync NEVER touches these ---
  themeTokens     Json?
  logoUrl         String?
  coverUrl        String?
  contactPhone    String?
  contactWhatsapp String?
  contactEmail    String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  business  Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  stores    Store[]
  slugEntry Slug?

  @@index([businessId])
}
```

Sin `status` ni columnas de cierre (R6). Sin descripción (R8). Las tres de
contacto se llaman `contactX` y no `phone`/`whatsapp`/`email` para que no se
solapen con las de `Store`, que siguen sincronizadas y son la fuente de R14/R15.

### `Slug` — el registro

```prisma
enum SlugKind {
  STOREFRONT
  STORE
  RESERVED
}

/// The single namespace of public first-level slugs. A value has AT MOST one
/// owner and that is enforced by the primary key plus the `Slug_owner_matches_kind`
/// CHECK written by hand in the migration (Prisma has no @@check) — never by a
/// SELECT in application code (criterio 4).
///
/// A value is never reassigned (R13): when its owner disappears the FK sets the
/// pointer to NULL and the row survives with `retiredAt`, so a printed QR can
/// never end up pointing at somebody else's business.
model Slug {
  value        String    @id
  kind         SlugKind
  storefrontId String?   @unique
  storeId      String?   @unique
  retiredAt    DateTime?
  createdAt    DateTime  @default(now())

  storefront Storefront? @relation(fields: [storefrontId], references: [id], onDelete: SetNull)
  store      Store?      @relation(fields: [storeId], references: [id], onDelete: SetNull)
}
```

Y la restricción, en el `migration.sql`:

```sql
ALTER TABLE "Slug" ADD CONSTRAINT "Slug_owner_matches_kind" CHECK (
     ("kind" = 'RESERVED'   AND "storefrontId" IS NULL AND "storeId" IS NULL)
  OR ("kind" = 'STOREFRONT' AND "storeId" IS NULL)
  OR ("kind" = 'STORE'      AND "storefrontId" IS NULL)
);
```

**Por qué esta forma y no otra.** Tres propiedades, cada una de una pieza
distinta, y ninguna depende de recordar nada:

1. **Un valor, un dueño como máximo** → la clave primaria sobre `value`. Es lo
   que hace fallar el criterio 4 con `duplicate key value violates unique
constraint "Slug_pkey"`.
2. **Un dueño, un valor como máximo** → los dos `@unique` sobre las columnas de
   dueño. Sin ellos una marca podría acumular slugs y el canónico dejaría de ser
   único.
3. **El `kind` no miente** → el `CHECK`. Es lo que hace fallar un `UPDATE` que
   le cuelgue un `storeId` a una fila de marca.

El `CHECK` **permite** `kind = 'STOREFRONT'` con `storefrontId IS NULL`: ese es
exactamente el estado **retirado**, y es lo que deja que `ON DELETE SET NULL`
funcione sin borrar la fila (R13). Dos consecuencias que hay que saber:

- Una fila retirada **no resuelve**: el resolvedor la trata como 404. Un `grep`
  del resolvedor lo enseña en una línea.
- Un `INSERT` sin dueño (`(value, kind) VALUES ('x','STOREFRONT')`) pasa el
  `CHECK` y **llega a la clave primaria**, que es lo que el criterio 4 espera
  leer. Si el `CHECK` fuera estricto, Postgres lo rechazaría **antes** de mirar
  el índice único y el mensaje sería otro. Está escrito aquí porque es la clase
  de detalle que hace que un tester crea que el criterio no se cumple.

### `Store` — qué cambia

```prisma
model Store {
  // ...
  storefrontId String                 // NOT NULL
  slug         String?  @unique       // solo las sucursales con URL propia
  // fuera: themeTokens, logoUrl, coverUrl
  // se quedan, sincronizadas: description, phone, whatsapp, email
  storefront Storefront @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  slugEntry  Slug?
  @@index([storefrontId])
}
```

`Business.slug` pasa a `String? @unique` y **deja de generarse**
(`src/features/sync/server/handlers/store.ts:38` desaparece). No entra en el registro: un negocio «La
Rampa» reservaría `la-rampa` para una fila que no resuelve ninguna URL (I1).

**Invariante que ninguna restricción de base puede expresar**, y que por eso va
escrita aquí y en un test: **una marca con más de una sucursal renderizable
exige que todas sus sucursales tengan `slug` no nulo**, porque su URL es el slug
de primer nivel de la sucursal (§ El selector). En la etapa 1 no puede violarse:
el sync crea siempre 1:1 (HS2) y no hay ninguna marca con dos sucursales. Quien
la crea es **agrupar** (HS8, etapa 2), y es quien tiene que hacer cumplir el
invariante: emitir el slug de la sucursal que no lo tenía y revalidar los tags
viejos y nuevos (§ Agrupar dos tiendas, § El slug canónico tercer punto).

---

## El slug canónico, y por qué es el corazón del feature (I5)

Hoy `storeTag(slug)` se construye con **el slug de la URL pedida**. Con dos URL
vivas por sucursal (HS4, criterio 3), invalidar por la URL pedida deja la otra
rancia para siempre: el peor tipo de bug, el que nadie nota.

**La clave canónica de invalidación es el slug público canónico de la
sucursal**, y se define así:

```
canonicalSlug(sucursal) =
    slug de su marca      si la marca tiene exactamente UNA sucursal renderizable
    su propio Store.slug  si la marca tiene varias
```

- **Quién la calcula**: `canonicalSlug()` en `src/lib/publicSlug.ts`, **pura**,
  sin Prisma, con test de nodo. Recibe `{ storeSlug, brandSlug, brandBranchCount }`
  y devuelve un `PublicSlug`.
- **Dónde**: en el resolvedor (lectura) y en el mismo `select` que ya hace cada
  escritor (sync, panel), que pasa a traer `storefront: { select: { slug: true } }`
  y el número de sucursales renderizables de la marca.
- **Cómo se garantiza que ninguna lectura declara un tag distinto del que
  dispara la escritura**: con un **tipo marcado**, el mismo patrón que
  `AuthorizedStoreId` ya usa en el panel:

```ts
// src/lib/publicSlug.ts
declare const publicSlugBrand: unique symbol;
export type PublicSlug = string & { readonly [publicSlugBrand]: true };

export type CanonicalSlugInput = {
  storeSlug: string | null;
  brandSlug: string;
  /** Sucursales de la marca que pueden renderizar (status != DRAFT). */
  brandBranchCount: number;
};

export function canonicalSlug(input: CanonicalSlugInput): PublicSlug;
```

`storeTag`, `storeCatalogTag`, `revalidateStores`, `getStoreBySlug`,
`getStoreCatalog`, `getStoreRates` y `requireStore` pasan a aceptar **solo**
`PublicSlug`. Pasarles el `slug` de la URL, o un `Store.slug`, es un **error de
compilación**. Es la misma jugada que hace que en el panel no se pueda escribir
sin autorizar.

Tres cosas más, en el mismo sitio:

1. **La resolución tiene su propio tag** (R18): `slugTag(value) = "slug:<value>"`.
   Se invalida cuando se crea o cambia una fila de `Slug`. Es lo que hace que una
   marca nueva del sync aparezca sin esperar el piso de 3600 s.
2. **La marca tiene su propio tag**: `storefrontTag(brandSlug) = "storefront:<brandSlug>"`.
   Lo dispara **desde la etapa 1** todo escritor que toque una sucursal, aunque
   el único lector (el selector) llegue en la etapa 2. Motivo: así el sync y el
   panel se tocan **una vez**, no dos.
3. **Cuando el canónico de una sucursal cambia** —solo puede pasar al pasar de
   una a dos sucursales, es decir al **agrupar** (HS8, § Agrupar dos tiendas)— hay
   que revalidar el canónico **viejo y nuevo** y el `storefront:` de la marca. Es
   la única consecuencia incómoda del modo doble de `/[slug]`, y la alternativa
   (`/[slug]/[sucursal]`) tiene exactamente la misma, porque también pasa de
   `/marca` a `/marca/sucursal`.

`data-store` y el `<style>` del tema usan **el canónico**, nunca el pedido: con
eso las dos URL de una sucursal emiten el mismo CSS y E18 se cumple byte a byte
(el string es el mismo que antes porque la migración **mueve** el valor).

---

## El resolvedor único (I6)

**Dónde vive**: `src/features/storefront/server/resolve.ts`. Un `feature` nuevo
—`storefront`— y no dentro de `catalog`, porque lo usan cinco consumidores de
tres dominios distintos (vitrina, pedidos, panel) y meterlo en `catalog` haría
que `orders` importara de `catalog`.

**Qué devuelve**:

```ts
export type BranchRef = {
  storeId: string;
  /** Canónico de ESA sucursal: con lo que se enlaza y con lo que se taguea. */
  canonicalSlug: PublicSlug;
  name: string;
  city: string | null;
  address: string | null;
  status: "PUBLISHED" | "SUSPENDED";
};

export type PublicResolution =
  | {
      kind: "branch";
      /** La sucursal a renderizar. */
      storeId: string;
      canonicalSlug: PublicSlug;
      storefrontId: string;
      brandSlug: PublicSlug;
      brandName: string;
      /** Sucursales renderizables de la marca. 1 en toda la etapa 1. */
      branchCount: number;
      /** true cuando la URL pedida no es la canónica (criterio 3). */
      isAlias: boolean;
    }
  | {
      kind: "selector";
      storefrontId: string;
      brandSlug: PublicSlug;
      brandName: string;
      branches: BranchRef[]; // length >= 2
    };

/** null = 404. Nunca lanza; `requireResolution()` es quien llama a notFound(). */
export function resolvePublicSlug(requested: string): Promise<PublicResolution | null>;
export function requireResolution(requested: string): Promise<PublicResolution>;
```

**Cómo resuelve**, exactamente dos consultas indexadas:

1. `prisma.slug.findUnique({ where: { value: requested } })` — clave primaria.
   Sin fila, o fila `RESERVED`, o fila retirada (los dos punteros a `null`) →
   `null`.
2. `prisma.store.findMany({ where: { storefrontId, status: { not: "DRAFT" } }, select: {...}, orderBy: { name: "asc" } })`
   sobre el índice `Store(storefrontId)`. Con la fila de `Slug` de tipo `STORE`,
   el `storefrontId` sale del `select` anidado de la misma consulta 1.

Y el reparto de resultados, que es donde se cumplen E1–E6:

| Fila de `Slug`                    | Sucursales renderizables de la marca | Resultado                                                           |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `STOREFRONT`                      | 0                                    | `null` → 404 (E6)                                                   |
| `STOREFRONT`                      | 1                                    | `branch`, canónico = slug de la marca (E1, E4 si `SUSPENDED`)       |
| `STOREFRONT`                      | ≥ 2                                  | `selector` (criterio 2, etapa 2)                                    |
| `STORE`                           | la sucursal está `DRAFT`             | `null` → 404 (E5)                                                   |
| `STORE`                           | 1                                    | `branch`, canónico = slug de la marca, `isAlias: true` (criterio 3) |
| `STORE`                           | ≥ 2                                  | `branch`, canónico = su propio slug                                 |
| `RESERVED` / retirada / no existe | —                                    | `null` → 404 (E3)                                                   |

**Cacheado** con `cached()`: `keyParts: ["public-slug"]`,
`tags: [slugTag(requested)]`, `revalidate: STOREFRONT_REVALIDATE`. Además
envuelto en `React.cache` para que layout y page de la misma petición no paguen
dos veces ni siquiera el acierto de caché.

**Cómo se impide que aparezca un quinto**, tres capas:

1. **El tipo.** Todo lo que consume un slug canónico exige `PublicSlug`, y el
   único sitio que lo mina es `canonicalSlug()`, que exige `brandBranchCount`:
   no se puede inventar sin haber consultado la marca.
2. **El test de fronteras** `src/features/storefront/server/boundaries.test.ts`,
   copia del de `admin`: recorre `src/` y falla si algún archivo que no sea
   `resolve.ts`/`registry.ts` (ni sus tests) contiene
   `where: { slug`, `store: { slug:`, `storefront: { slug:` o `prisma.slug.`.
   Es el mismo mecanismo por `grep` que ya protege el embudo del panel, y cubre
   los `route.ts`, donde ESLint no llega.
3. **La firma de las lecturas**: `requireStore(canonical: PublicSlug)` ya no
   acepta el `params.slug` de una página, así que una ruta nueva **tiene** que
   pasar por `requireResolution`.

Los cinco consumidores, después:

| Consumidor                                        | Antes                                                   | Después                                                              |
| ------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/app/[slug]/**`                               | `requireStore(params.slug)`                             | `requireResolution(params.slug)` → `requireStore(res.canonicalSlug)` |
| `src/features/orders/server/quote.ts`             | `store.findFirst({ where: { slug } })`                  | `requireResolution` → `store.findUnique({ where: { id } })`          |
| `src/features/orders/server/read.ts`              | `order.findFirst({ where: { code, store: { slug } } })` | `requireResolution` → `where: { code, storeId }`                     |
| `src/features/admin/server/stores.ts`             | expone `Store.slug`                                     | expone `canonicalSlug` calculado con el `select` de la marca         |
| `sync` y `src/features/admin/server/mutations.ts` | `touchedStoreSlug = store.slug`                         | canónico + `brandSlug`, para los tres tags                           |

---

## Palabras reservadas (criterio 5)

**Las rutas que existen de verdad.** `find src/app -maxdepth 1 -type d`:
`(marketing)` —grupo de rutas, no es segmento de URL—, `admin`, `api` y
`[slug]` —dinámico—. Los archivos de primer nivel producen `/robots.txt`,
`/sitemap.xml` y `/favicon.ico`, que llevan punto y por eso **no pueden**
colisionar con un slug (`isValidSlug` no admite `.`). Así que los segmentos
literales de primer nivel que existen hoy son exactamente **dos**: `admin` y
`api`, y los dos ya están en la lista.

Qué cambia en `src/lib/slug.ts`:

- La lista se **exporta** (`export const RESERVED_SLUGS`), porque ahora la leen
  el registro, el seed y el `migration.sql`. Hoy es un `const` privado y el seed
  no puede sembrar las filas `RESERVED` sin duplicarla.
- Se **añade `sesion-cerrada`** (I3): `.agent/specs/F-011/design.md` § 10 la
  define como página de primer nivel y F-011 la recortó al cerrar, así que hoy
  no existe en `src/app/` **ni** está reservada. Reservarla antes de construirla
  es gratis; descubrirlo después de que una marca se quede el slug no lo es.
- Se **añade `sucursales`**, el segundo segmento que introduce la etapa 2, por
  la misma simetría con la que `carrito`, `checkout` y `pedido` ya están.
- **No se quita ninguna** (R11).
- **No se añade `p`**: es una sola letra, solo aparece como segundo segmento
  (`/[slug]/p/...`) y reservarla le prohibiría a un producto llamarse «P».

**Rechazar y disfrazar conviven porque son dos caminos distintos** (I4), y esta
es la frontera exacta:

| Camino                                                              | Función                                      | Conducta                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Derivar** — el sync, a partir de `payload.slug \|\| payload.name` | `uniqueSlug()`, **sin tocar** (`slug.ts:66`) | Disfraza (`admin` → `admin-tienda`) y sufija (`-2`, `-3`). Un evento **nunca** falla por el nombre del local (E14) |
| **Proponer** — el registro y, el día que exista, el panel           | `slugSchema` / `assertProposableSlug()`      | **Rechaza** con error tipado `RESERVED_SLUG` / `INVALID_SLUG`, **antes** de cualquier consulta                     |
| **Red de seguridad** — la base                                      | fila `RESERVED` en `Slug` + clave primaria   | Una escritura que se salte las dos anteriores choca con `Slug_pkey` (R12)                                          |

Con eso el criterio 5 se cumple por tres sitios y **ninguna fila de la base
acaba nunca con el valor `admin` o `api`**. La única lectura del criterio que
esta arquitectura no cumple es «el evento del POS que propone `slug: "admin"`
debe fallar»: aquí sale `processed` con `admin-tienda`. Lo contestó el humano en
**HS7** —el evento no falla nunca— y con un añadido: para que el disfraz no sea
una sorpresa, cuadrecaja puede consultar antes qué slug va a quedar
(§ El servicio de disponibilidad de slug).

Cierra el hueco un test de nodo que **lee `src/app/`** y comprueba que todo
directorio de primer nivel que sea un segmento literal está en
`RESERVED_SLUGS`: una ruta nueva que nadie reserve deja de ser un 404 silencioso
en producción.

---

## El servicio de disponibilidad de slug (HS7, etapa 1)

El disfraz de una palabra reservada y el sufijo `-2` resuelven que un evento no
falle, pero dejan al comerciante enterándose del slug de su tienda **después** de
publicarla. HS7 lo cierra: cuadrecaja puede preguntar antes.

**Esto es contrato.** Lo consume el otro equipo, así que su forma se acuerda y no
se cambia por gusto. Y se suma al **anuncio de la v3 que ya está pendiente de
enviar** (`docs/sync-contract.md` § «Propuesta v3 — `unpublishReason`, aditiva,
sin enviar todavía»): **no abre una v4**. Motivo: la v3 todavía no se comunicó,
así que añadir un endpoint de solo lectura al mismo anuncio no cuesta una ronda
más de coordinación, y dos anuncios seguidos al mismo equipo por dos cambios
aditivos es la forma más fácil de que el segundo no se lea.

### La ruta

```
GET /api/internal/slug-availability?slug=<candidato>&name=<nombre>&storeId=<Tienda.id>
Authorization: Bearer <SYNC_TOKEN>
```

- **`GET`**, y **no reserva nada**. Es un pronóstico, no un apartado. Dicho en el
  cuerpo con `"reserving": false` para que no haya duda al leer la respuesta.
- Al menos uno de `slug` o `name`. Con los dos, `slug` es el candidato y `name`
  solo se usa si `slug` no deja nada slugificable.
- `storeId` es **opcional** y es el `Tienda.id` del POS (nuestro
  `Store.externalId`): sirve para responder «ese slug ya es tuyo, no cambia
  nada» en vez de «está tomado».
- `cache-control: no-store` y `export const dynamic = "force-dynamic"`: la
  respuesta caduca en cuanto alguien publica.

**Respuesta 200** (el mismo cuerpo para libre, tomado, reservado o inválido: el
trabajo del endpoint es responder, no regañar):

```jsonc
{
  "candidate": "la-rampa", // lo evaluado, ya normalizado por slugify
  "available": false, // ¿queda tal cual?
  "reason": "taken", // free | taken | reserved | invalid | retired | own
  "resolvedSlug": "la-rampa-2", // el slug que quedaría si se publicara AHORA
  "url": "https://queandabuscando.com/la-rampa-2",
  "storeKnown": true, // ¿existe ya la tienda de storeId en esta base?
  "reserving": false, // SIEMPRE false
}
```

| `reason`   | Cuándo                                                           | `resolvedSlug`                 |
| ---------- | ---------------------------------------------------------------- | ------------------------------ |
| `free`     | Nadie lo tiene                                                   | el candidato                   |
| `own`      | Lo tiene la marca de `storeId`: publicar no lo cambia            | el candidato                   |
| `taken`    | Lo tiene otra marca u otra sucursal                              | el siguiente libre             |
| `reserved` | Es una palabra reservada (`admin`, `api`, `sesion-cerrada`, …)   | el disfraz (`-tienda`)         |
| `retired`  | Fila que existió y cuyo dueño desapareció: **no vuelve al pool** | el siguiente libre             |
| `invalid`  | Nada slugificable, o pasa de 80 caracteres                       | derivado de `name`, o `tienda` |

**Errores**: `400 { "error": "MISSING_QUERY" }` si no viene ni `slug` ni `name`;
`401 { "error": "UNAUTHORIZED" }` y `503 { "error": "SYNC_NOT_CONFIGURED" }` del
guard compartido de `src/app/api/internal/_lib/guard.ts`, sin tocarlo. Un `storeId`
desconocido **no** es 404: es el caso normal antes de publicar, y se responde con
`"storeKnown": false`.

### Por qué es fiable, que es lo único que importa aquí

`previewSlug()` vive en `registry.ts` y llama a **la misma** `uniqueSlug` con
**el mismo** predicado `taken` sobre la tabla `Slug` que usa la creación. Si el
pronóstico y la creación fueran dos implementaciones, el endpoint mentiría el día
que alguien cambiara una de las dos — y mentir sobre el slug es exactamente lo
que HS7 viene a arreglar. Es la misma razón por la que hay **un** compositor de
precio y **un** resolvedor.

Lo que el endpoint **no** puede prometer, y va escrito en el contrato: entre la
consulta y la publicación otro puede quedarse el valor. El pronóstico vale para
lo que el humano pidió —que el comerciante vea qué slug va a quedar— y no como
garantía. Quien publique se lleva lo que diga la clave primaria.

### Lo que F-018 va a exigir, y que este endpoint ya cumple

F-018 («la identidad del llamante sale del token y no del payload») es el feature
que sigue en este backlog. Tres cosas para no dejarle deuda:

1. **No hay `businessId` en la petición.** No es un olvido: el espacio de slugs
   es **global**, así que la respuesta no depende de quién pregunta y no hay
   identidad que suplantar. Es el único endpoint interno que sale de este ciclo
   sin ese parámetro, y a propósito.
2. **`storeId` no es identidad.** Hoy solo decide `own` frente a `taken`. Cuando
   F-018 llegue, la regla es de una línea: la tienda de `storeId` **tiene que
   pertenecer al negocio del token**, y si no, `403`. Queda escrito aquí para que
   F-018 no tenga que adivinarlo.
3. **No divulga nada que no sea público.** Un slug tomado se descubre con un
   `curl` a la URL, así que responder `taken` no filtra información; y no
   devuelve **de quién** es, que sí lo sería.

### El diff propuesto de `docs/sync-contract.md`

No edito el archivo (no es mío en este ciclo). Esto es lo que hay que añadir, y
va **dentro del anuncio de la v3 pendiente**, no en uno nuevo:

1. En § Endpoints, una fila en la tabla:

   ```
   | `GET`  | `/api/internal/slug-availability?slug=&name=&storeId=` | — | 200 `{ candidate, available, reason, resolvedSlug, url, storeKnown, reserving }` |
   ```

2. Una subsección nueva, `## ⑥ Disponibilidad de slug (v3, aditiva)`, con la
   tabla de `reason` de arriba, los tres errores, y dos frases en negrita: **no
   reserva** y **no garantiza**.

3. En § `payload de STORE`, una nota junto a `slug`: sigue siendo «solo se usa al
   CREAR» —ahora para el slug de la **marca**— y **nunca falla el evento**: si el
   valor está tomado o es reservado, queandabuscando lo convierte en el
   siguiente libre, y el endpoint ⑥ es la forma de saber en qué, antes.

4. En § Cambios requeridos en cuadrecaja, una línea: **nada obligatorio.**
   `Tienda.slug` ya está en esa lista desde la v1. Lo único opcional es llamar al
   ⑥ desde la pantalla donde el POS edita el slug, que es lo que pidió el humano.

## Contratos

### Escritura del registro (etapa 1)

```ts
// src/features/storefront/server/registry.ts — ÚNICO escritor de Slug y Storefront
export type SlugRejection = "INVALID_SLUG" | "RESERVED_SLUG" | "SLUG_TAKEN";

export type CreateBrandInput = {
  /** Del llamante, nunca del payload: F-018 va a cambiar de dónde sale. */
  businessId: string;
  brandName: string;
  /** Propuesta explícita (se valida y se rechaza) o `null` para derivar. */
  proposedSlug: string | null;
  /** Semilla de la derivación cuando `proposedSlug` es null. */
  derivedFrom: string;
  store: StoreCreateData; // exactamente las columnas que hoy pone handleStore
};

export type CreateBrandResult =
  | { ok: true; storefrontId: string; storeId: string; canonicalSlug: PublicSlug }
  | { ok: false; error: SlugRejection };

export function createStorefrontWithStore(input: CreateBrandInput): Promise<CreateBrandResult>;
```

**Un solo round-trip y sin `$transaction`.** La marca, su fila de `Slug` y la
sucursal se escriben con **un `create` anidado desde `Storefront`**:

```ts
prisma.storefront.create({
  data: {
    businessId,
    name: brandName,
    slug,
    slugEntry: { create: { value: slug, kind: "STOREFRONT" } },
    stores: { create: { ...storeData } },
  },
  select: { id: true, slug: true, stores: { select: { id: true } } },
});
```

Por qué así y no tres escrituras: Prisma envuelve el escrito anidado en **una**
transacción del lado del servidor, así que no hay estado a medias que un
reintento del outbox pueda duplicar; y no es un `$transaction` interactivo con
el cliente global, que es lo único que hace deadlock contra el pooler en modo
transacción (`AGENTS.md` § Cosas que muerden, ficha `pooler-transaccion-deadlock`).
Con tres escrituras sueltas, un fallo entre la segunda y la tercera dejaría una
marca sin sucursal y un slug quemado, y el reintento crearía `la-rampa-2`.

**La carrera de slugs** (dos eventos que derivan el mismo valor a la vez): el
`create` falla con `P2002`, se captura y se reintenta con el siguiente candidato,
hasta 3 veces. Nunca queda un evento fallido por una carrera de slug, y un
evento fallido **nunca** se reporta `ok` (`inbox.ts`).

### Handler del sync (etapa 1)

`handleStore` mantiene sus dos propiedades —idempotente y guardado contra
escrituras rancias por `sourceUpdatedAt`— y sus tres reglas de HD10–HD15
intactas. Lo que cambia:

- El `select` del `findUnique` inicial pasa a traer
  `{ id, slug, sourceUpdatedAt, sourceOptIn, storefront: { select: { id, slug, _count } } }`.
- La rama `!existing` deja de hacer `prisma.store.create` y llama a
  `createStorefrontWithStore` (E9). `payload.slug` viaja como **semilla de
  derivación**, no como propuesta, para no fallar el evento (HS7).
- La rama `!optIn && !existing` sigue devolviendo `SKIPPED`: una tienda que
  nunca se publicó **no reserva slug** (E13).
- `touchedStoreSlug` pasa a ser el canónico, y se añade `touchedBrandSlug`.
- **No menciona** `themeTokens`, `logoUrl`, `coverUrl` ni ninguna `contactX`
  (R5): el `grep` no devuelve nada porque esas columnas no existen en su
  vocabulario, no porque alguien se acordó de omitirlas.
- `Business.slug` desaparece del `upsert` (I1).

El contrato con cuadrecaja **no cambia**: no hay v4, `docs/sync-contract.md` no
se toca.

### Lectura pública (etapa 1)

`StoreSummary` cambia de forma, y **a propósito**:

```ts
export type StoreSummary = {
  id: string;
  /** Sustituye a `slug`. El rename es deliberado: cada uso pasa a ser un error
   *  de compilación que hay que mirar una vez. */
  canonicalSlug: PublicSlug;
  /** De la marca: el HTML no cambia (R7), pero el enlace y el editor lo piden. */
  storefrontId: string;
  brandName: string;
  name: string;
  description: string | null;
  logoUrl: string | null; // de la marca
  coverUrl: string | null; // de la marca
  themeTokens: unknown; // de la marca
  /** R14 ya aplicada: ningún componente compone la precedencia por su cuenta. */
  contact: { phone: string | null; whatsapp: string | null; email: string | null };
  address: string | null;
  city: string | null;
  baseCurrencyCode: string;
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: Date | null;
};
```

`loadStore` pasa a `findUnique({ where: { id: storeId } })` con
`storefront: { select: { ... } }` — una consulta, un `JOIN`, igual que hoy con
`business`. `loadCatalog` y `loadRates` cambian `where: { store: { slug } }` por
`where: { storeId }` (mejor índice: `StoreProduct(storeId, deletedAt, visible)`
ya existe). `getPublishedStoreSlugs` pasa a devolver los canónicos de las
sucursales renderizables **más** los alias vivos, para `generateStaticParams`. Y
con una distinción que DP4 obliga a precisar: `/[slug]` prerenderiza además los
slugs de las marcas **con selector** —son páginas reales e indexables—, mientras
que `/[slug]/p/[productSlug]` los **excluye**, porque bajo un slug de selector no
hay catálogo que recorrer y esas rutas responden 404.

### Contacto (R14/R15)

```ts
// src/lib/storeContact.ts — puro, gemelo de lib/pricing.ts
export type StoreContactSource = {
  brand: {
    contactPhone: string | null;
    contactWhatsapp: string | null;
    contactEmail: string | null;
  };
  branch: { phone: string | null; whatsapp: string | null; email: string | null };
};

/** Lo que el comprador VE y pulsa: gana la marca si tiene algo. */
export function presentationContact(source: StoreContactSource): {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
};

/** A dónde VIAJA un pedido: SIEMPRE la sucursal (R15). Mata además el
 *  `whatsapp ?? phone` duplicado en quote.ts:115 y read.ts:92. */
export function routingWhatsappNumber(branch: {
  whatsapp: string | null;
  phone: string | null;
}): string | null;
```

Un pedido lo atiende un local concreto; cambiar esto tocaría el pull del POS y
`docs/sync-contract.md`. Las columnas de la marca nacen a `null` y el sync no
las siembra (R16), así que hasta que exista el editor lo que se ve es
exactamente lo que se ve hoy (E19).

### Endpoints

**Etapa 1: uno nuevo, y es contrato** —
`GET /api/internal/slug-availability` (HS7, § El servicio de disponibilidad de
slug). Ni el panel ni la vitrina estrenan ruta. El único cambio en un endpoint
existente es que `POST /api/orders` y `POST /api/orders/quote` aceptan como
`storeSlug` **cualquiera** de las URL vivas de la sucursal, y el `orderUrl` que
devuelven va con el canónico (E8).

**Etapa 2: uno nuevo, del panel** —
`POST /api/admin/stores/{storeId}/branches` (HS8, § Agrupar dos tiendas).
`/[slug]/sucursales` es una **página**, no un endpoint, y no hay endpoint de
traslado de carrito: HS5 lo canceló.

### Tabla de errores

| Situación                                                  | Qué responde                             | Dónde se decide                              |
| ---------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Slug que no existe, `RESERVED` o retirado                  | **404** (`notFound()`)                   | `requireResolution`                          |
| Marca con cero sucursales renderizables                    | **404** (E6)                             | `resolvePublicSlug`                          |
| Sucursal única `DRAFT`                                     | **404** (E5)                             | `resolvePublicSlug`                          |
| Sucursal única `SUSPENDED`                                 | **200** + página de cierre (E4)          | `page.tsx`, como hoy                         |
| Slug de sucursal vivo                                      | **200**, sin `Location` (criterio 3)     | `resolvePublicSlug`, `isAlias: true`         |
| `/[marca con varias]/p/x`, `/carrito`, `/checkout`         | **404**: no hay sucursal que resolver    | cada `page.tsx`, sobre `kind`                |
| Slug propuesto reservado o mal formado                     | `{ ok: false, error }` tipado, 0 queries | `slugSchema` en el registro                  |
| Slug propuesto ya tomado                                   | `SLUG_TAKEN`                             | `P2002` del `create` anidado                 |
| `POST /api/orders` con slug de marca de varias sucursales  | **404 STORE_NOT_FOUND**                  | `loadStoreForOrder` (no hay sucursal única)  |
| `GET /api/internal/slug-availability` sin `slug` ni `name` | **400 MISSING_QUERY**                    | la ruta                                      |
| Ese mismo endpoint con `storeId` desconocido               | **200** con `"storeKnown": false`        | la ruta: no publicado todavía no es un error |
| Agrupar dos tiendas de negocios distintos                  | **409 DIFFERENT_BUSINESS**               | `groupStoreIntoBrand`                        |
| Agrupar una tienda en la marca que ya tiene                | **409 ALREADY_IN_BRAND**                 | `groupStoreIntoBrand`                        |
| Agrupar sin permiso sobre una de las dos tiendas           | **403 FORBIDDEN**                        | el guard + `authorizeStore` del cuerpo       |

---

## Migración

Un solo `migration.sql`, en la carpeta
`prisma/migrations/<ts>_storefront_slug_registry/`. Prisma aplica cada archivo
de migración **dentro de una transacción**, así que o entra todo o no entra
nada: no hay estado a medias que haya que limpiar a mano.

### Cómo se genera, dado que la base de desarrollo está compartida

`prisma migrate dev` ya falló en F-011 por checksum drift
(ficha `prisma-migrate-dev-checksum-drift-bd-compartida`) y hoy la base no
tiene drift, pero otro worktree puede provocarlo en cualquier momento. Y
`prisma migrate reset` y `prisma db push` están **prohibidos** por `AGENTS.md`:
si algo pareciera necesitarlos, se para y se pregunta. El camino es el de la
ficha:

```bash
# 0. Volcado ANTES de nada (§ Qué es reversible)
docker exec queandabuscando-postgres pg_dump -U postgres -Fc queandabuscando \
  > .agent/runs/pre-f017-$(date +%s).dump        # .agent/runs está en .prettierignore y en .gitignore

# 1. Vuelo previo: ningún slug vivo puede ser una palabra reservada
docker exec queandabuscando-postgres psql -U postgres -d queandabuscando -Atc \
  "SELECT slug FROM \"Store\" WHERE slug = ANY (ARRAY['admin','api','app','auth','buscar','carrito','checkout','cuenta','login','logout','pedido','public','static','_next','sesion-cerrada','sucursales'])"
# tiene que salir vacío. Si sale algo, PARA: el paso 6 abortaría la migración

# 2. DDL como materia prima, sin tocar _prisma_migrations
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

# 3. Carpeta a mano y migration.sql escrito con el ORDEN de abajo. Quitar los
#    DROP INDEX de CanonicalProduct_searchVector_idx y CanonicalProduct_name_trgm_idx
#    (ficha prisma-migrate-dev-borra-indices-gin-no-declarados) y añadir el CHECK
#    y los pasos 3-7, que el diff no sabe generar.

# 4. Aplicar con el mismo comando que CI/producción, que no revalida checksums viejos
npm run db:deploy    # = prisma migrate deploy
npx prisma validate && npx prisma migrate status
```

### El archivo, en orden

El orden **no es cosmético**: tres pasos fallan si se adelantan.

```sql
-- 1. Tablas nuevas: Storefront, SlugKind, Slug, sus índices y sus FK.
--    (Del diff, tal cual. `Slug.storefrontId`/`storeId` con ON DELETE SET NULL.)

-- 1b. La restricción que Prisma no puede declarar (criterio 4, R9).
ALTER TABLE "Slug" ADD CONSTRAINT "Slug_owner_matches_kind" CHECK (...);

-- 2. Store gana el puntero, NULLABLE todavía, y su índice.
ALTER TABLE "Store" ADD COLUMN "storefrontId" TEXT;
ALTER TABLE "Store" ADD CONSTRAINT "Store_storefrontId_fkey"
  FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Store_storefrontId_idx" ON "Store"("storefrontId");

-- 3. Palabras reservadas PRIMERO, con la tabla vacía: nada puede chocar aún, y
--    si una tienda viva tuviera un slug reservado el paso 6 aborta en vez de
--    crear en silencio una marca que ninguna URL alcanza.
INSERT INTO "Slug" ("value","kind") VALUES ('admin','RESERVED'), ('api','RESERVED'), ...;

-- 4. Una marca por cada tienda, con su nombre, su branding y su slug.
INSERT INTO "Storefront" ("id","businessId","name","slug","themeTokens","logoUrl","coverUrl","createdAt","updatedAt")
SELECT gen_random_uuid()::text, s."businessId", s."name", s."slug",
       s."themeTokens", s."logoUrl", s."coverUrl", now(), now()
FROM "Store" s;

-- 5. Enlace. El slug es único en las DOS tablas en este instante, así que
--    unir por slug es exacto y no hace falta ninguna columna temporal.
UPDATE "Store" s SET "storefrontId" = sf."id" FROM "Storefront" sf WHERE sf."slug" = s."slug";

-- 6. Registro de las marcas. Aborta la migración si un slug era reservado.
INSERT INTO "Slug" ("value","kind","storefrontId")
SELECT sf."slug", 'STOREFRONT', sf."id" FROM "Storefront" sf;

-- 7. ANTES de vaciar: quitar el NOT NULL, o el UPDATE falla.
ALTER TABLE "Store" ALTER COLUMN "slug" DROP NOT NULL;
--    El mismo string pasa a ser el slug de la MARCA: la URL impresa responde
--    200 sin redirección (HS4) y no queda una segunda URL por tienda.
UPDATE "Store" SET "slug" = NULL;

-- 8. Cerrar el modelo. Los tres DROP son el único paso irreversible.
ALTER TABLE "Store" ALTER COLUMN "storefrontId" SET NOT NULL;
ALTER TABLE "Store" DROP COLUMN "themeTokens";
ALTER TABLE "Store" DROP COLUMN "logoUrl";
ALTER TABLE "Store" DROP COLUMN "coverUrl";
ALTER TABLE "Business" ALTER COLUMN "slug" DROP NOT NULL;
```

Con la base de desarrollo de hoy eso produce: 3 `Storefront`
(`tienda-demo`, `tienda-dos`, `tienda-cerrada`), 3 filas `STOREFRONT` en `Slug`,
16 filas `RESERVED`, 3 `Store` con `storefrontId` y `slug IS NULL`, y el mismo
`Business` con `slug = 'la-rampa'` que ya nadie lee.

### Qué es reversible y qué no

| Paso     | Reversible                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–3      | Sí, aditivo: `DROP TABLE "Slug"`, `DROP TABLE "Storefront"`, `DROP TYPE "SlugKind"`                                                                                                                                                       |
| 4–6      | Sí: los datos se derivan de `Store`, no se pierde nada                                                                                                                                                                                    |
| 7        | Sí **mientras cada marca tenga una sola sucursal**: `UPDATE "Store" s SET slug = sf.slug FROM "Storefront" sf WHERE sf.id = s."storefrontId"`. Con dos sucursales por marca, las dos querrían el mismo string y ya **no** se puede volver |
| 8 (DROP) | **No.** Los tres valores solo existen en `Storefront` después. `Business.slug` sí es reversible (solo pierde el NOT NULL)                                                                                                                 |

Lo que hay que tener antes: el volcado `-Fc` del paso 0, que en desarrollo cuesta
un segundo. **Y va completa de una vez, los tres `DROP COLUMN` incluidos**, por
**HS9**: no hay producción con tiendas vivas, así que no hay nada que proteger
partiendo la migración en dos, y partirla dejaría tres columnas muertas en
`Store` y una segunda migración pendiente que dentro de un mes nadie recordaría.
La decisión se tomó **sabiendo** que las únicas filas afectadas son las 3 tiendas
del seed de desarrollo.

### `prisma/seed.ts`

Idempotente, como hoy. Las marcas se hacen `upsert` por `slug` (único), las
sucursales siguen haciéndose `upsert` por `externalId`, y las filas `RESERVED`
se insertan iterando `RESERVED_SLUGS` con `skipDuplicates`. Fixtures:

| Fixture                                                                                                               | Para qué                                                                                                  | Etapa |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----- |
| Marca `tienda-demo` + 1 sucursal (`Store.slug` null)                                                                  | F-004, F-005, F-007, F-010, `check:bundle`; criterio 1                                                    | 1     |
| Marca `tienda-dos` + 1 sucursal, `themeTokens` en la **marca**                                                        | F-016 criterio 4 (verde, esquinas redondeadas) y E18                                                      | 1     |
| Marca `tienda-cerrada` + 1 sucursal `SUSPENDED`                                                                       | HD11, E4, y la tienda ajena del 403 de F-011                                                              | 1     |
| **Nueva**: marca `bodega-central` + 1 sucursal que **conserva** `Store.slug = 'bodega-central-vedado'` (kind `STORE`) | Criterio 3 y E21 sobre la rama «después `Store`», que si no existe ninguna fila viva es código muerto     | 1     |
| **Nuevas**: dos tiendas dedicadas a agrupar, `bodega-uno` y `bodega-dos`, del mismo negocio, con 2 productos cada una | Criterios 2 y 6, que se verifican **agrupándolas** (HS8) y por tanto consumen las fixtures de un solo uso | 1     |

**Por qué dos fixtures nuevas y no las de siempre.** Agrupar **no tiene vuelta**
(no hay desagrupar), y agrupar `tienda-demo` con `tienda-dos` convertiría
`/tienda-demo` en un selector: eso rompe el criterio 3 de F-004
(«`GET /tienda-demo` responde 200 y los nombres de los productos aparecen en el
HTML»), el `smoke.sh` de F-010 y la medición de `check:bundle`. Las dos tiendas
de agrupar son de un solo uso y no las lee ningún otro feature. Van en la etapa 1
—aunque se agrupen en la 2— para que el seed se toque una sola vez, y hay que
añadirlas al token con `node scripts/mint-sso-token.mjs --stores=...`, que ya
tiene la bandera.

**Regla nueva del seed, y es la que evita el bug silencioso**: la rama `update`
de todo `upsert` de tienda **no escribe nunca `slug` ni `storefrontId`**; solo la
rama `create` los pone. Sin esa regla, `npm run seed` después de agrupar
desharía la agrupación —devolvería la tienda a su marca vieja— y el criterio 2
pasaría a rojo sin que nadie hubiera tocado código.

El seed sigue reabriendo a propósito lo que cierra la migración de HD12
(`seed.ts:388-395`): eso no cambia, y el comentario que lo explica tampoco.

---

## El selector de sucursal (etapa 2, criterio 2)

**La forma de la URL**, que es la decisión de fondo: la sucursal de una marca
con varias **conserva un slug de primer nivel** (`/la-rampa-vedado`) y
`/[slug]` de la marca renderiza el **selector**. Nada baja un segmento.

Por qué, en tres motivos que salen del código:

1. `/[slug]/[sucursal]` conviviría con los segmentos estáticos `carrito`,
   `checkout`, `p` y `pedido`. Next resuelve el estático primero, así que una
   sucursal llamada «carrito» quedaría inalcanzable: haría falta un **segundo**
   espacio de palabras reservadas, con su propia validación y su propio test.
2. Duplicaría el árbol de rutas: `/[slug]/carrito` **y**
   `/[slug]/[sucursal]/carrito`, porque el criterio 1 exige que la marca de una
   sucursal siga sirviendo el catálogo en `/[slug]`. Son seis páginas nuevas que
   repiten las seis que F-004, F-007 y F-010 ya verificaron.
3. No resuelve nada de I5: una sucursal seguiría teniendo dos URL (la anidada y
   su slug histórico), que es el problema que el slug canónico cierra.

Y es **aditivo hacia atrás**: si algún día se quiere `/marca/sucursal`, se añade
como alias que resuelve al mismo `storeId`, con `canonical` al slug de primer
nivel. Lo contrario —empezar anidado y volver— rompe QR. Aun así contradice una
línea de ADR 0012 aceptada: la contestó el humano en **HS6** y la supera la
ADR 0018.

**Qué lee y dónde vive**:

- `BranchList` (src/components/store/BranchList.tsx (etapa 2, por crear)) — componente **de
  servidor**, sin estado ni eventos, así que **nada de `"use client"`**
  (`AGENTS.md` § Prohibiciones: nunca en algo que renderice catálogo). Recibe
  `branches: BranchRef[]` —ya resueltas, cero consultas propias— y pinta por
  cada una nombre, ciudad, dirección, un `Badge` de estado y un enlace a
  `/${branch.canonicalSlug}`. El nombre de cada sucursal en el HTML es lo que
  verifica el criterio 2.
- `/[slug]/page.tsx` pasa a **modo doble** sobre `resolution.kind`:
  `branch` → exactamente lo que hace hoy; `selector` → cabecera de marca +
  `BranchList`. Sigue siendo `●`: no estrena ninguna API dinámica.
- El layout `/[slug]/layout.tsx` deja de llamar a `requireStore` y llama a
  `requireResolution`. En modo selector: el nombre de la **marca** en la
  cabecera, sin `CartBadge` (no hay carrito de una marca) y sin enlace de
  «seguir comprando». En modo `branch` queda **idéntico** a hoy.
- El tema del selector es el de la marca, con `data-store={brandSlug}`.

**El marcador que el criterio 1 comprueba que NO está**: `BranchList` emite un
`data-branch-picker` en su contenedor. Un criterio que se cumple porque nadie
construyó el componente es trivialmente cierto (I7); con un atributo estable, el
`grep -c` de la marca de una sucursal da 0 **teniendo** el componente
construido, que es la única forma de que el criterio pruebe algo.

---

## Agrupar dos tiendas bajo una marca (HS8, etapa 2)

De aquí sale la segunda sucursal que necesita el criterio 2. HS1 lo había dejado
fuera y **HS8 lo mete**, así que es alcance de la etapa 2 y no de un ciclo futuro.

> **Nada de esta sección es trabajo de la etapa 1.** Quien esté construyendo el
> modelo, la migración, el registro o el resolvedor no tiene aquí ninguna tarea
> pendiente. Lo único que la etapa 1 le debe a esta sección son las dos fixtures
> del seed (§ `prisma/seed.ts`), que se siembran ahora y se agrupan después.

### La forma: se agrupan dos tiendas, no una tienda y una marca

El endpoint recibe **dos tiendas** y no una marca, por un motivo de
autorización: la sesión del panel trae `storeIds` (F-008), así que «tengo permiso
sobre esto» solo se sabe decir de una tienda. Agrupar toca dos, luego se
autorizan **las dos**.

```
POST /api/admin/stores/{storeId}/branches
  {storeId} en la ruta = la tienda cuya MARCA sobrevive (la principal)
  body: { "joiningStoreId": "<uuid de la tienda que se une>" }
  200 {
        "storefrontId": "...",
        "brandSlug": "la-rampa",              // ahora es la URL del selector
        "branches": [
          { "storeId": "...", "slug": "la-rampa-vedado", "url": "/la-rampa-vedado" },
          { "storeId": "...", "slug": "tienda-dos",      "url": "/tienda-dos" }
        ]
      }
```

Entra por **el mismo embudo y el mismo guard de F-011**, sin inventar nada:
`content-type: application/json` estricto, tope de 16 KB, `cache-control:
no-store`, el guard de `src/app/api/admin/_lib/guard.ts` para la tienda de la
ruta, `authorizeStore(session, joiningStoreId)` para la del cuerpo, el mapeo de
`AdminWriteResult` a HTTP de `src/app/api/admin/_lib/respond.ts`, y la escritura dentro de
`mutations.ts` terminando en revalidación.

### Qué les pasa a los slugs, que es la parte delicada

Sean **A** la tienda principal (su marca sobrevive, slug de marca `a`) y **B** la
que se une (marca propia con slug `b`, una sola sucursal):

| Antes                                      | Después                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `/a` → catálogo de A (canónico de A = `a`) | `/a` → **selector** con A y B. 200, sin redirección                                                                     |
| A no tenía `Store.slug`                    | A recibe `Store.slug` derivado de su nombre (`la-rampa-vedado`), kind `STORE`. Su catálogo vive ahí                     |
| `/b` → catálogo de B (canónico de B = `b`) | `/b` → **el mismo catálogo de B**: la fila de `Slug` pasa de `STOREFRONT` a `STORE` apuntando a B                       |
| Marca de B, con una sucursal               | **Se borra** (queda vacía). Su fila de `Slug` ya no le pertenece, así que `ON DELETE SET NULL` no tiene nada que anular |

Dos propiedades que hacen que esto sea aceptable, y hay que leerlas juntas:

1. **Ninguna URL deja de responder, y ninguna redirige.** `/b` sigue sirviendo
   exactamente el mismo catálogo —cambia el dueño de la fila del registro, no lo
   que la URL enseña—, y `/a` responde 200 con un selector que lleva al catálogo
   de A en un clic. HS4 se respeta a la letra.
2. **El canónico de B no cambia** (`b` antes como slug de marca, `b` después como
   slug de sucursal de una marca con varias), así que su caché, sus tags y su
   `data-store` siguen igual. El único canónico que cambia es el de A.

Que `/a` pase de catálogo a selector es el **significado** de agrupar, y lo pide
el admin. Es un cambio de lo que ve alguien con un QR impreso, y **el humano lo
aceptó explícitamente (HS10)**: se prefiere esto a la variante que no cambiaba el
significado de ninguna URL —crear una marca nueva con un slug escrito por el
admin— por dos motivos suyos: el formulario queda más simple (ni un campo de slug
que validar) y no hay que decidir qué branding hereda la marca nueva. Aquí no
queda nada contingente.

A cambio, el requisito duro se mantiene: **la pantalla tiene que enseñar las dos
URL resultantes y qué va a cambiar antes de aplicar**, con el mismo patrón de
confirmación en línea que ya usan «Vaciar carrito» (F-010) y «Quitar el branding»
(F-011 § Congelado). Es un requisito para `sdd-designer`, no una sugerencia,
porque agrupar no tiene vuelta.

**Y de dónde sale ese «qué va a cambiar»**, que es la parte que podría haberse
convertido en un endpoint de más: del **render de servidor** del paso 1, que
llama a `previewSlug()` —el mismo módulo de HS7— para saber qué slug estrenaría la
sucursal principal. No hay endpoint de previsualización, no hay `fetch` desde el
cliente y no hay una segunda derivación que pueda divergir de la que aplica el
`POST`. Es la reutilización que hace que DP5 (dos pasos más confirmación en línea)
no cueste arquitectura nueva.

Si B ya era una de **varias** sucursales de su marca, no hay nada que convertir:
B ya tiene su `Store.slug`, su marca vieja sobrevive con las demás, y ni un slug
cambia de dueño.

### Cómo se escribe: una transacción por lotes, un round-trip

Cuatro escrituras que **no** pueden quedar a medias —si se aplican tres, una URL
queda apuntando a nada—, así que van en **un** `prisma.$transaction([...])` en
forma de **lote**, no interactivo:

```ts
await prisma.$transaction([
  // 1. el slug de la marca de B pasa a ser el slug propio de B
  prisma.slug.update({
    where: { value: bBrandSlug },
    data: { kind: "STORE", storefrontId: null, storeId: bStoreId },
  }),
  // 2. B se muda de marca y se queda ese slug en su fila
  prisma.store.update({
    where: { id: bStoreId },
    data: { slug: bBrandSlug, storefrontId: aStorefrontId },
  }),
  // 3. A estrena slug de sucursal (derivado ANTES, con uniqueSlug, fuera de la tx)
  prisma.store.update({ where: { id: aStoreId }, data: { slug: aBranchSlug } }),
  prisma.slug.create({ data: { value: aBranchSlug, kind: "STORE", storeId: aStoreId } }),
  // 4. la marca vacía de B desaparece; su slug ya no le pertenece
  prisma.storefront.delete({ where: { id: bStorefrontId } }),
]);
```

**El lote y no el callback** por la ficha `pooler-transaccion-deadlock`: en la
forma de array no hay manera de usar el cliente global dentro, porque no hay
«dentro». Se ejecuta en orden, en una conexión, y el orden importa: (1) antes de
(4), o el borrado de la marca dejaría la fila del registro sin dueño y `/b`
respondería 404. La derivación de `aBranchSlug` es una **lectura** y va antes de
abrir la transacción.

Después del commit, `commit()` revalida: el canónico viejo de A (`a`), el nuevo
(`aBranchSlug`), el de B (`b`, sin cambio pero su marca sí cambió), los tags
`storefront:` de **las dos** marcas, y `slug:` de los tres valores tocados. Son
~9 `revalidateTag` en una petición del panel.

### Qué NO se permite, y por qué

| Intento                                          | Respuesta                              | Motivo                                                                                                                                             |
| ------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agrupar tiendas de **negocios distintos**        | `409 DIFFERENT_BUSINESS`               | R3: todas las sucursales de una marca son del mismo `Business`. Y el precio, el stock y las tasas son por negocio                                  |
| Agrupar una tienda **con la marca que ya tiene** | `409 ALREADY_IN_BRAND`                 | No hay nada que hacer, y borrar una marca para volver a crearla movería slugs sin motivo                                                           |
| Agrupar sin permiso sobre **una de las dos**     | `403 FORBIDDEN`                        | Agrupar toca dos tiendas: el permiso se comprueba dos veces contra `storeIds` de la sesión                                                         |
| **Desagrupar**                                   | **No existe endpoint**                 | Habría que decidir qué slug de marca recibe la que se va, y una marca nueva estrena una URL que nadie ha impreso. Es su propio feature, con su ADR |
| Agrupar más de dos de una vez                    | No: una llamada, una tienda que se une | Dos llamadas seguidas hacen lo mismo, y cada una es atómica y revisable en pantalla                                                                |
| Agrupar una tienda **`DRAFT`**                   | Se permite                             | No renderiza, así que no cuenta para `branchCount` ni cambia ninguna URL. Cuando publique, ya estará en su marca                                   |

## Cambiar de sucursal con el carrito lleno (etapa 2, criterio 6)

**HS5 lo resuelve informando, no modificando.** Lo comprobé en el código, como
pedía el orquestador: `src/constants/cart.ts:13` guarda cada carrito bajo
`qab.cart.v1.` + **`Store.id`**, con el comentario «Never by slug (R12)», y
`cartStorage.ts:13` es el único sitio que compone la clave. Conclusión, y es un
resultado, no un detalle:

**Mover el slug de la sucursal a la marca no toca el carrito.** Ni la clave, ni
`cartStore.ts`, ni `parseCart.ts`, ni una migración de datos del navegador. Cada
tienda conserva el suyo, cambiar de sucursal no pierde nada y volver lo encuentra
intacto. **Si un diseño exige tocar la forma de esa clave, se está desviando.**

La pantalla, al nivel de contrato y fronteras (lo visual es de `sdd-designer`):

- **Ruta**: `/[slug]/sucursales`, con `export const dynamic = "force-dynamic"` y
  `export const revalidate = 0` **literales** (ficha `revalidate-no-literal`), y
  `metadata.robots = { index: false }` — es una pantalla de tránsito, igual que
  `/carrito` y `/checkout`. (DP4 hace indexable el **selector** de `/[slug]`, que
  es otra página; esta no.)
- **Qué lee del servidor**: `requireResolution(params.slug)` y nada más. Reusa
  `BranchList` con las sucursales ya resueltas: **cero consultas propias**.
- **Qué lee del cliente**: `BranchSwitchNotice`, isla mínima, lee **solo** el
  carrito de la tienda actual con el `readCart(storeId)` que ya existe y dice
  cuántas líneas tiene y que se quedan donde están. Sin Zod en el árbol de
  cliente (`AGENTS.md`), sin gestor de estado: `useSyncExternalStore` sobre el
  módulo de F-010, que ya expone lo necesario. Y **no** pasa por `cartStore.ts`
  para leer: `ensureStore` cambia el carrito que hay en memoria y notifica a los
  suscriptores (F-010 § E4), así que el `CartBadge` de la cabecera pintaría otro
  contador. `readCart` es una lectura suelta, con el mismo `parseStoredCart` —así
  que un carrito caducado a los 30 días cuenta como 0, igual que lo encontraría
  el comprador—.
- **Cómo se llega**: desde la cabecera de la vitrina, un
  `<a href="/${canonicalSlug}/sucursales">` —un enlace, **no** una isla— que solo
  se renderiza cuando `resolution.branchCount > 1`. Esto es lo que mantiene el
  criterio 7 y el presupuesto de bundle: en las páginas `●` no aparece ni un
  módulo de cliente nuevo.
- **Qué NO hace**: no traslada líneas, no re-precia, no vacía, no llama a
  `POST /api/orders/quote` (HS5). Un traslado habría necesitado mapear
  `StoreProduct.id` entre sucursales por `canonicalProductId`, un endpoint nuevo
  y una pantalla de líneas caídas y precios cambiados. Nada de eso se construye.
- **Fuera de alcance, remitido**: la pantalla que le enseña al comprador todos
  los carritos que tiene abiertos en varias tiendas está en
  `.agent/specs/propuestas/carritos-abiertos-del-comprador.md`. No se diseña
  aquí, y el aviso de esta pantalla **no** los menciona: habla del carrito de la
  sucursal que se deja, que es el único que el comprador tiene delante.

---

## Flujo de datos

**Lectura pública de `/[slug]` (una sucursal)**

```
GET /tienda-demo
  layout: requireResolution("tienda-demo")
      → cached[slug:tienda-demo]  Slug.findUnique(value)         (1)
      → cached[slug:tienda-demo]  Store.findMany(storefrontId)   (2)
      → canonicalSlug({storeSlug:null, brandSlug:"tienda-demo", branchCount:1})
  layout: requireStore(canonical) → cached[store:tienda-demo]    (3)
  page:   getStoreCatalog(canonical) → cached[store:tienda-demo:catalog] (4,5 en paralelo)
          getStoreRates(canonical)   → cached[store:tienda-demo]  (6)
  render: renderStoreTheme(canonical, brand.themeTokens); data-store=canonical
```

Con caché caliente: **0 round-trips**. En frío: 6 consultas en 4 oleadas (hoy
son 4 en 3). Todo indexado; ningún `$transaction`.

**El alias (criterio 3)**: `GET /bodega-central-vedado` resuelve `kind: "STORE"`,
canónico `bodega-central`, `isAlias: true` → **las mismas** entradas de caché y
los mismos tags que `/bodega-central`, y un `<link rel="canonical">` a
`/bodega-central`. Sin `Location`, sin 301, sin 302 (HS4).

**Sync de una tienda nueva (E9)**

```
POST /api/internal/sync/catalog  (evento STORE, storeId desconocido)
  recordBatch → inbox
  handleStore: business.upsert                                   (1)
               store.findUnique(externalId) → null               (2)
               uniqueSlug(payload.slug || payload.name, taken)   (3..n, PK lookups en Slug)
               registry.createStorefrontWithStore                (1 escritura anidada)
  processBatch: revalidateStores([canonical]) + revalidateStorefronts([brand])
                revalidateTag(slug:<canonical>)
  → 207, "processed";  GET /<canonical> responde 200
```

**Escritura del panel (existe hoy, sigue igual)**: `commit(canonicalSlug, write)`
en `mutations.ts`. Lo único que cambia es de dónde sale el slug que recibe:
`existing.store.storefront.slug` y el conteo de sucursales, en el mismo `select`
que ya se hacía. Cero round-trips añadidos.

---

## El branding: su sitio, y qué le queda a F-011

Las seis columnas del panel viven en `Storefront` (arriba). Ahí termina la mitad
que F-017 entrega. Y ahí está el motivo por el que el humano pidió este feature,
así que conviene ser explícito: **ningún criterio de F-017 verifica el branding**
—los ocho hablan de URL, restricciones, SSG y sensor—, así que la verificación de
que esto sirvió es el **criterio 5 de F-011**, y F-011 sigue `passes: false`
hasta entonces.

Cómo lo escribirá el panel, **reutilizando el embudo de F-011 sin inventar otro**:

```ts
// src/features/admin/server/mutations.ts — el MISMO archivo, la MISMA forma
type PanelStorefrontColumn =
  "themeTokens" | "logoUrl" | "coverUrl" | "contactPhone" | "contactWhatsapp" | "contactEmail";
type PanelStorefrontWrite = Pick<Prisma.StorefrontUpdateInput, PanelStorefrontColumn>;

export function saveBranding(
  storefrontId: AuthorizedStorefrontId,
  body: BrandingBody,
): Promise<AdminWriteResult<AdminStorefrontRow>>;
```

Cuatro cosas de esa firma que F-017 **sí** deja preparadas, porque son
arquitectura y no pantalla:

1. **La lista blanca es la tabla entera menos `id`/`businessId`/`name`/`slug`.**
   No hay ni una columna compartida con el sync en `Storefront` (R5), así que la
   frontera de ADR 0017 (a) se cumple **por construcción**, no por lista. Es
   exactamente el mecanismo que ADR 0017 § «Reabrir cuando» prescribe.
2. **`AuthorizedStorefrontId`**: la marca de la sucursal autorizada. La sesión
   trae `storeIds` (F-008), así que autorizar una marca es «alguna de mis
   sucursales pertenece a esta marca»: una consulta indexada
   `store.count({ where: { id: { in: session.storeIds }, storefrontId } })`.
   Lo entrega F-017 en `src/features/admin/authorization.ts` junto al que ya
   existe, o F-011 al descongelar; **decidirlo es del plan**, no cambia nada más.
3. **`revalidateStorefronts(brandSlug)` y la revalidación de R19**: escribir el
   branding de una marca invalida los tags de **todas** sus sucursales, resueltas
   en **una** consulta (`Store.findMany({ where: { storefrontId } })`). La
   función la entrega F-017 y la usa `commit()`.
4. **`themeTokensSchema`** ya existe (`features/theming/storeTheme.ts:17`) y no
   se toca: es lo que el criterio 5 de F-011 exige que rechace.

Lo que F-011 tiene que hacer después para cerrar su criterio 5, y **no** entrega
F-017:

1. El **endpoint**: `PUT /api/admin/storefronts/{storefrontId}/branding`, con el
   guard de `src/app/api/admin/_lib/guard.ts`, el tope de 16 KB, `cache-control: no-store`
   y `content-type` estricto, validando con `themeTokensSchema` (400 con
   `issues`) y llamando a `saveBranding`.
2. La **tarjeta 2b entera** tal como quedó congelada y firmada en
   `.agent/specs/F-011/design.md` § Congelado: `BrandingForm`, `ColorTokenField`,
   la previsualización, las seis paletas en `src/constants/`, VE6 (el
   `<input type="color">` **sin** `name`), DP3 y DP4 —ya contestadas—.
3. La **extracción de `themeCustomProperties(tokens)`** desde
   `storeTheme.ts`, que la maqueta necesita y el diseño congelado ya especifica.
4. La **URL y el dueño** del editor: la marca, no la sucursal
   (`/admin/marcas/<storefrontId>`), y el listado de `/admin` pasando de «tus
   tiendas» a «tu marca y tus sucursales». Eso es rediseño, y el bloque congelado
   lo avisa en su punto 1.

Y el aviso del bloque congelado que **ya no** hay que corregir: su punto 2 dice
que la maqueta debe llevar selector de sucursal. Con el criterio 2 de F-017 el
selector **existe**, así que ese punto vuelve a aplicar tal como está escrito.

---

## Qué se rompe de lo ya verificado, y con qué paso se arregla

F-011 cerró con **325 pruebas en verde**. Esta es la lista de lo que hay que
volver a correr, feature por feature.

| Feature                                    | Qué asume                                                                                           | Qué le pasa                                                                                                                                                                                           | Paso que lo arregla                                                                                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-004** (vitrina, `passes: true`)        | `/[slug]` resuelve un `Store` por `slug`; `StoreSummary.slug`                                       | **Rompe en compilación**: las seis páginas de `src/app/[slug]/**` y las cuatro lecturas de `queries.ts`                                                                                               | Etapa 1: `requireResolution` en layout y páginas; `canonicalSlug` en lugar de `slug`. Verifica: `npm run build`, `curl` de los 7 criterios de F-004                                                                                       |
| **F-005** (sync, `passes: true`)           | `handleStore` crea un `Store` suelto; el mock de `store.test.ts` no conoce `prisma.storefront`      | **Rompen los tests**: `store.test.ts` (mock incompleto) y las aserciones sobre `storeCreate`                                                                                                          | Etapa 1: extender el mock con `storefront.create` y `slug.findUnique`; casos nuevos para E9/E13/E14. Verifica: `npm test -- store`, `send-store-batch.mjs` en sus cinco modos                                                             |
| **F-006** (disponibilidad, `passes: true`) | `applyAvailability` selecciona `store.slug` (`availability.ts:29,50`)                               | **Rompe en compilación** (`slug` es `string \| null`); sin test propio hoy                                                                                                                            | Etapa 1: `select: { id, externalId, slug, storefront: { select: { slug } } }` y canónico al `touchedStores`. Verifica: `send-availability-batch.mjs`, ciclo AVAILABLE → OUT_OF_STOCK → AVAILABLE                                          |
| **F-007** (pull, `passes: true`)           | `pull.ts` **no** publica ningún slug al POS (verificado con `grep`)                                 | **Nada**. La página del pedido resuelve por el canónico y el `orderUrl` cambia de string solo si cambió la URL                                                                                        | Ninguno. Se anota como comprobado para que nadie lo «arregle». Verifica: `pull-orders.mjs`                                                                                                                                                |
| **F-010** (carrito, `passes: true`)        | Clave de `localStorage` = prefijo + **`Store.id`**; `quote`/`read`/`createOrder` resuelven por slug | **El carrito, nada** (HS5, comprobado). **Rompen**: `quote.test.ts`, `read.test.ts` (mocks de `findFirst` con `store: { slug }`)                                                                      | Etapa 1: resolvedor en `loadStoreForOrder` y `getOrderByCode(storeId, code)`; mocks pasan a mockear `resolvePublicSlug`. Verifica: `npm test -- orders`, `.agent/specs/F-010/smoke.sh`, `place-order.mjs` contra el slug de la marca (E8) |
| **F-011** (panel, `passes: false`)         | `commit(existing.store.slug)`; `listManagedStores` expone `Store.slug` para el enlace público       | **Rompen en compilación** `mutations.ts` y `stores.ts`; **rompen** `mutations.test.ts` (mocks `store: { slug }`) y posiblemente `boundaries.test.ts` si el `grep` de columnas alcanza al nuevo bloque | Etapa 1: `select` con `storefront: { slug }`, `commit(canonical)`, `AdminStoreListItem.canonicalSlug`, `StoreList.tsx:66`. Verifica: `npm test -- admin`, `.agent/specs/F-011/smoke.sh`                                                   |
| **F-016** (branding, `passes: true`)       | `renderStoreTheme(slug, tokens)` y el string de `data-store`                                        | **Nada en el código** (es puro). El **valor** viaja de `Store` a `Storefront` y el string del canónico es el mismo                                                                                    | Ninguno en `src/`. Verifica: `npm run check:theme`, y las dos capturas del criterio 4 (`tienda-demo` azul / `tienda-dos` verde y redondeada)                                                                                              |
| **`check:bundle`**                         | Mide el HTML prerenderizado con más JavaScript                                                      | **Etapa 1: nada** (ni un módulo de cliente nuevo). **Etapa 2**: la isla vive en una ruta `force-dynamic`, que no emite HTML prerenderizado                                                            | Ninguno, si el enlace de la cabecera sigue siendo un `<a>`. Si el diseño lo convierte en isla, subir el presupuesto es decisión del humano, como en F-010                                                                                 |
| **`seed`**                                 | `seedStore` escribe `PUBLISHED` en `create` y en `update`                                           | Sigue igual y sigue siendo deliberado (contradice HD12 a propósito)                                                                                                                                   | Mantener el comentario de `seed.ts:388-395` intacto                                                                                                                                                                                       |
| **`mint-sso-token.mjs`**                   | Firma `seed-tienda-1` y `seed-tienda-2`                                                             | **Nada**: son `externalId` de `Store`, que no cambian                                                                                                                                                 | Ninguno en el script. La etapa 2 lo llama con `--stores=` para incluir las dos fixtures de agrupar, que es para lo que existe la bandera (I7 de F-011)                                                                                    |
| **`docs/sync-contract.md`**                | v2 enviada; v3 (`unpublishReason`) **propuesta y sin enviar**                                       | Gana una sección: el endpoint ⑥ de HS7. **No abre una v4**: se suma al anuncio pendiente de la v3                                                                                                     | El diff está propuesto en § El servicio de disponibilidad de slug § El diff propuesto. Lo escribe quien tenga el archivo asignado, no este ciclo                                                                                          |

Orden de verificación al final de la etapa 1:
`npm run db:deploy && npm run seed && bash .agent/verify.sh F-017 --full`, y
después los `smoke.sh` de F-010 y F-011, que son los dos que tocan servidor y
base reales.

---

## Escalabilidad y límites

Números, no adjetivos. «100×» sobre lo que hay hoy: 3 tiendas, 20 productos,
1 negocio, 182,1 KB de JS con presupuesto en 193.

| Camino                                   | Round-trips (frío / caliente) | Crece con                                                     | Qué se rompe primero, y cuándo                                                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /[slug]` (sucursal)                 | 6 / 0                         | nada                                                          | Nada: las dos consultas nuevas son una clave primaria y un índice. +2 consultas frías por página nueva, ~0,4 ms                                                                                                                                         |
| `GET /[slug]` (selector, etapa 2)        | 2 / 0                         | sucursales de la marca                                        | El `findMany` devuelve **todas** las sucursales sin paginar. A 50 sucursales el HTML del selector ronda 30 KB; a **200** hay que limitar y paginar                                                                                                      |
| `GET /[slug]/sucursales`                 | 2 / 2 (dinámica)              | sucursales                                                    | Igual, y sin caché: 2 consultas por visita. Es una pantalla de tránsito, tráfico bajo                                                                                                                                                                   |
| `POST /api/orders` y `/quote`            | +1 sobre hoy                  | nada                                                          | Nada. La resolución cacheada sustituye un `findFirst` por `slug` por un `findUnique` por `id`, que es **mejor** índice                                                                                                                                  |
| Lote del sync (500 eventos, 3 tiendas)   | igual + 1 por tienda nueva    | tiendas nuevas del lote                                       | Nada: la creación de marca es **un** escrito anidado. Los `revalidateTag` pasan de 6 a **9** (3 tags × 3 tiendas)                                                                                                                                       |
| `revalidateStorefronts` (editor, F-011)  | 1 consulta + 2 tags/sucursal  | sucursales de la marca                                        | A 100 sucursales son 201 `revalidateTag` en una petición del panel: a partir de ~50 conviene agrupar por marca en el CDN                                                                                                                                |
| `generateStaticParams` de `/[slug]/p/**` | 1 + N consultas de catálogo   | slugs renderizables (marcas de una sucursal + alias vivos)    | Ya es N+1 **hoy**. A 300 slugs el build hace 300 consultas de catálogo y pasa de los minutos; el arreglo es limitar el prerender a los K más visitados, y no es de este feature                                                                         |
| Tabla `Slug`                             | —                             | 1 fila/marca + 1/alias + 16                                   | A 10 000 tiendas son ~10 000 filas y un btree de menos de 1 MB. No se rompe: es la tabla más barata del schema                                                                                                                                          |
| `GET /api/internal/slug-availability`    | 1 + k / no cacheado           | colisiones del candidato (`k` = sondas hasta encontrar libre) | Cada sonda es una clave primaria. El peor caso teórico son las 1000 vueltas de `uniqueSlug`; con un candidato normal son 1–2. Si algún día un token abusa del endpoint, el arreglo es un tope de sondas, no una caché (la respuesta caduca al instante) |
| `POST .../branches` (agrupar, etapa 2)   | 3 lecturas + 1 lote de 5      | nada                                                          | Nada: es una acción del panel, de una en una. Dispara ~9 `revalidateTag`                                                                                                                                                                                |
| `localStorage` del comprador             | —                             | tiendas visitadas                                             | Un carrito por tienda, tope 50 líneas, expira a 30 días (`constants/cart.ts`). Con 20 tiendas visitadas son ~40 KB de los 5 MB del navegador                                                                                                            |

**Presupuesto de JavaScript**: etapa 1 lo deja **exactamente** en 182,1 KB —no
hay ni un `"use client"` nuevo—. La etapa 2 añade una isla, y **solo** en
`/[slug]/sucursales`, que es `force-dynamic` y por tanto no produce HTML
prerenderizado: `check-bundle-budget.mjs` mide `.next/server/app/**/*.html`, así
que el número que compara con 193 no se mueve. El margen real es de ~11 KB y no
se gasta aquí.

**Caché e ISR**: piso de 3600 s (`layout.tsx:17`, literal). Invalidación por
tres tags: `store:<canónico>`, `store:<canónico>:catalog`,
`storefront:<marca>`, más `slug:<valor>` cuando cambia el registro. Dos URL de
la misma sucursal comparten **entrada de caché y tags**: es lo que hace que la
del alias no quede rancia para siempre (I5).

**Pooler en modo transacción**: ni un `$transaction` nuevo. La única escritura
compuesta —marca + slug + sucursal— es un `create` anidado, que Prisma resuelve
en una transacción del lado del servidor sin usar el cliente global dentro.

---

## Patrones a seguir / antipatrones a evitar

- **Prisma solo en `features/*/server/`** (`AGENTS.md` § Arquitectura). El
  resolvedor y el registro son server; `publicSlug.ts`, `slug.ts` y
  `storeContact.ts` son `lib/`: puros, sin Prisma y sin React.
- **`export const revalidate` literal**. `layout.tsx:17` sigue en `3600` y la
  página nueva de la etapa 2 va con `0` escrito a mano. Ficha
  `revalidate-no-literal`.
- **`src/proxy.ts` no se toca.** Su `matcher` sigue en `/admin`. Hacer match
  sobre `/[slug]` anularía el ISR completo. Ficha `proxy-matcher-anula-isr`.
- **Nada de `"use client"` en lo que renderiza catálogo.** El selector es de
  servidor; la única isla vive en una ruta dinámica.
- **Sin `any`**, sin cadenas mágicas: `RESERVED_SLUGS` y los prefijos de tag ya
  están centralizados; los nombres de las fixtures del seed no son constantes de
  producción y se quedan donde están.
- **Idempotencia y guarda anti-rancio en todo lo que escribe el sync**
  (`AGENTS.md` § Cosas que muerden): `sourceUpdatedAt` se compara **antes** de
  crear la marca, así que un evento rancio no crea ni marca ni slug (E12).
- **Un evento fallido no es un duplicado**: `inbox.ts` no se toca.
- **Un solo compositor por concepto**: precio en `lib/pricing.ts`, contacto en
  `lib/storeContact.ts`, slug canónico en `lib/publicSlug.ts`, resolución en
  `features/storefront/server/resolve.ts`. Cuatro módulos, cuatro conceptos,
  ninguna duplicación.

---

## Riesgos y plan B

| Riesgo                                                                                                         | Plan B                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un `prisma migrate dev` futuro propone `DROP CONSTRAINT "Slug_owner_matches_kind"` porque Prisma no lo declara | Quitar esa línea del `migration.sql` generado, igual que con los índices GIN, y recrear el `CHECK` a mano. Si pasa, ficha nueva en el playbook                                |
| Checksum drift de la base compartida a mitad de la migración                                                   | El camino ya es `migrate diff` + carpeta a mano + `migrate deploy`, que no revalida checksums. **Nunca** aceptar el reset que ofrece `migrate dev`                            |
| El paso 6 aborta porque una tienda tenía un slug reservado                                                     | El vuelo previo del paso 1 lo detecta antes de aplicar nada; hoy sale vacío. Si algún día sale con algo, se renombra esa tienda **con el negocio delante**, nunca en silencio |
| `/[slug]` deja de ser `●` por un descuido (una API dinámica en el resolvedor)                                  | El criterio 7 lo caza en el build. El resolvedor no lee `headers()`, `cookies()` ni `searchParams`: si alguien los mete, el build lo dice                                     |
| La deriva entre `Slug.value` y `Storefront.slug`                                                               | Un solo escritor (`registry.ts`), el test de fronteras que lo prueba por `grep`, y una consulta de invariante en el seed: cero filas huérfanas                                |
| El paso 8 borra tres columnas y luego hay que volver                                                           | Volcado `-Fc` antes del paso 0. Con HS9 el alcance del daño posible son 3 filas de desarrollo, y el volcado las restituye en un comando                                       |
| La etapa 2 tienta a meter la isla en la cabecera de todas las páginas                                          | El enlace es un `<a>`. Si el diseño insiste, el presupuesto sube por decisión del humano —como en F-010—, no por deriva                                                       |
| `npm run seed` deshace una agrupación y el criterio 2 se pone rojo sin que nadie toque código                  | La rama `update` de los `upsert` de tienda no escribe `slug` ni `storefrontId` (§ `prisma/seed.ts`), y el test de fixtures lo fija                                            |
| El pronóstico de HS7 y la creación divergen, y el endpoint miente                                              | Los dos llaman a la **misma** `previewSlug`/`uniqueSlug` con el mismo predicado sobre `Slug`. Un test fija que el pronóstico y la creación dan el mismo string                |

---

## Efecto sobre el backlog nuevo

No invento alcance de ninguno; solo digo si esto les pone las cosas difíciles.

- **F-018 (identidad del llamante desde el token)**: **a favor, y con una
  entrada nueva en su lista**. `createStorefrontWithStore` recibe `businessId`
  como **argumento**, nunca lee `payload.businessId`, así que F-018 cambia el
  llamante y no el registro, y su criterio del `grep` de `payload.businessId` se
  cumple más fácil. El endpoint de HS7 le añade **una** ruta interna a revisar y
  se la deja lo más fácil posible: no acepta `businessId`, porque el espacio de
  slugs es global y no hay identidad que suplantar; lo único que F-018 tiene que
  hacer allí es exigir que la tienda de `storeId` pertenezca al negocio del token
  (§ Lo que F-018 va a exigir). Sin eso, un token podría averiguar si un slug es
  «suyo», que es la única señal del endpoint que no es ya pública.
- **F-022 (zona horaria y tabla de propiedad de campos)**: **a favor, y le da
  trabajo nuevo**. `Storefront` nace con la propiedad limpia —todas sus columnas
  son del panel salvo `name`/`slug`, que el sync solo escribe al crear— así que
  la tabla de propiedad gana un bloque **sin excepciones**. Dos cosas que F-022
  tiene que resolver y que aquí quedan dichas: (a) `Store.timezone` va en la
  **sucursal**, no en la marca, porque `openingHours` es por local; (b) el slug
  y el branding ya tienen dueño escrito (marca) y contacto tiene **dos** dueños
  con precedencia (R14/R15), que es la fila más sutil de esa tabla.
- **F-021 (búsqueda dentro de una tienda)**: **neutro**. Busca dentro de un
  `storeId` y aquí no cambia ni el `StoreProduct` ni sus índices. Lo único que
  hereda es que la ruta de búsqueda, cuando exista, tiene que resolver por el
  resolvedor y no por `slug` —o será el quinto resolvedor—, y que `buscar` ya
  está en `RESERVED_SLUGS`.
- **F-023 (imágenes optimizadas al subir)**: **neutro con un aviso**.
  `Storefront.logoUrl` y `coverUrl` pasan a ser columnas del panel, así que el
  esquema de variantes de F-023 tendrá **tres** dueños de imagen
  (`StoreProduct.imageUrls`, `Storefront.logoUrl`, `Storefront.coverUrl`) en vez
  de dos. Ninguna de las dos se sirve hoy por `next/image` en la vitrina, así que
  su criterio de `/_next/image` no se complica.

---

## ¿Hace falta una ADR?

**Sí, y ya está escrita: `docs/adr/0018-registro-de-slugs-y-slug-canonico.md`,
en estado «Aceptada»** —el humano contestó las cuatro preguntas que la sostenían
(HS6–HS10), así que no queda nada contingente.

No basta con extender la 0012 por dos motivos. Uno, hay decisiones que la 0012
no toma y que gobiernan código para siempre: la forma de la restricción del
registro, la retirada de un valor, el slug canónico como única clave de
invalidación, la separación entre derivar y proponer, el pronóstico consultable
del slug, y la retirada de `Business.slug`. Dos, y más importante: la 0018
**supera una línea** de la 0012 —«con N, las páginas viven en
`/[slug]/[sucursal]`»— y una ADR aceptada no se contradice editándola por lo
bajo: se supera con otra que diga por qué. La 0018 cierra además el punto de
ADR 0017 § «Reabrir cuando» que esperaba a `Storefront`, y deja **desagrupar**
como su propio disparador de reapertura.

---

## Preguntas al humano

**Ninguna abierta.** Las cinco que este documento planteó están contestadas y
aplicadas: HS6 (la URL de la sucursal), HS7 (el disfraz y su servicio de
consulta), HS8 (agrupar desde el panel), HS9 (migración completa de una vez) y
**HS10** (al agrupar, la URL de la marca principal pasa de catálogo a selector).
La variante que creaba una marca nueva con slug escrito por el admin queda
**descartada**, con su motivo, en § Agrupar dos tiendas y en las alternativas de
la ADR 0018.

Hubo una quinta respuesta —el aviso al cambiar de sucursal mencionando también
los carritos de las otras sucursales— que el humano **reconsideró y retiró**
(«deja el aviso como lo tenía pensado el arquitecto»). El aviso se queda como
está descrito en § Cambiar de sucursal con el carrito lleno: habla del carrito de
la sucursal que se deja, y los carritos que el comprador tenga en otras tiendas
siguen siendo la propuesta `carritos-abiertos-del-comprador.md`, fuera de F-017.

### Las decisiones de presentación del orquestador (DP2–DP5)

Se revisaron contra esta arquitectura. **Cuatro entran sin romper nada**, y una
—DP2— roza un criterio ya verificado y sale con una condición:

- **DP2 · la tarjeta «Tu marca» nombra también las hermanas que ese admin no
  administra, sin enlace.** Entra, **con tres condiciones**, porque el criterio 1
  de F-011 («un admin solo ve y edita las tiendas presentes en `storeIds` de su
  sesión») está `passes`-verificado y no se toca: (a) `listManagedStores` **no se
  modifica** —lo que se añade es una lectura nueva y con otro nombre,
  `listBrandBranches(storefrontId)`, autorizada por pertenecer a la marca de una
  tienda que el admin **sí** administra—; (b) devuelve **nombre y ciudad, y ningún
  `storeId`**, para que la pantalla no pueda construir un enlace ni un formulario
  aunque alguien lo intente después; (c) queda anotado como **extensión** del
  criterio 1 de F-011, no como excepción: sigue siendo cierto que solo se ve y se
  edita lo de `storeIds`, porque nada de lo que sale por aquí es editable ni
  enlazable. Si el humano prefiere que el admin no vea ni el nombre, se cae la
  lectura y la tarjeta enseña «y otra sucursal más» — un cambio de una línea.
- **DP3 · el selector ordena abiertas primero y alfabético dentro de cada
  grupo.** Entra sin coste: el `orderBy: { name: "asc" }` del resolvedor ya
  ordena, y el agrupado por estado es un `sort` estable en memoria sobre ≤ N
  elementos que ya están en `BranchRef` (que lleva `status`). **Ni una consulta
  más.**
- **DP4 · el selector es indexable y entra en el sitemap, con el alias declarando
  su canónico.** Entra, y **obliga a precisar dos cosas** que este documento
  tenía a medias, así que están corregidas donde viven: (a) `src/app/sitemap.ts`
  publica una URL por sucursal renderizable —su canónico— **más** la URL de cada
  marca con varias sucursales, que es una página distinta con contenido distinto y
  no compite con las de sus sucursales; para una marca de una sola sucursal las
  dos URL son el mismo string, así que no hay duplicado; (b)
  `generateStaticParams` de `/[slug]` incluye los slugs de marca **con selector**
  (para que se prerenderice `●`), mientras que el de
  `/[slug]/p/[productSlug]` **los excluye** —ahí no hay catálogo que recorrer— y
  esas rutas responden 404 bajo un slug de selector. **Las dos son no-ops en la
  etapa 1**: sin ninguna marca con selector, el sitemap publica exactamente las
  mismas URL que hoy y `generateStaticParams` devuelve exactamente la misma lista.
  La rama empieza a servir con la primera agrupación.
- **DP5 · agrupar en dos pasos más confirmación en línea.** Entra sin
  arquitectura nueva: el paso 1 es un render de servidor que llama a
  `previewSlug()` (§ Agrupar dos tiendas), y sigue habiendo **un solo** `POST`,
  el del final. Nada de endpoint de previsualización.
