---
feature: F-011
agente: orquestador
actualizado: 2026-08-28T02:44:37Z
estado: listo
aprobado: sí
---

> El plan de la **tanda 1** (pasos 1–18, más abajo) ya está construido, verificado
> y firmado — no se toca ni se re-firma. Este documento vuelve a `estado: borrador`
> solo para añadir la **tanda 3** (pasos 19–34, al final), sobre `Storefront`
> (F-017), que HD6 dejó bloqueada. La firma nueva cubre solo esos dieciséis pasos.

## Qué se va a construir

El negocio entra al panel, ve **solo** sus tiendas, y por primera vez manda sobre
su vitrina: **la abre y la cierra al público** —eligiendo qué frase lee su
cliente cuando está cerrada—, escribe la descripción de cada producto, le sube
fotos, le pone un precio online distinto del que dice el POS, lo esconde o lo
destaca, y crea promociones que el comprador ve de verdad: precio anterior
tachado, precio nuevo, y el descuento aplicado en el pedido que llega a Cuadre de
Caja.

Y cambia una cosa para todas las tiendas que ya existen: **ninguna estará en
público hasta que un admin lo decida**. La migración las cierra a todas con un
motivo de estreno, y quien escanee un QR verá una página que explica por qué, en
vez de un 404 que parece un negocio desaparecido.

Lo que **no** cambia: el POS sigue siendo dueño del nombre, del precio
sincronizado, de la disponibilidad y de su propio opt-in de publicación; y el
contrato con cuadrecaja no se rompe — lo único que se le propone es un campo
**opcional** de motivo, que el otro equipo puede ignorar.

Lo que **no entra**: los colores y el contacto de la tienda. Esperan a
`Storefront` (HD6), así que el criterio 5 —«guardar branding inválido es
rechazado»— no se puede cubrir y **F-011 no llegará a `passes: true` al terminar
esta tanda**: se queda en 4 de 5 criterios verificados.

## Pasos

Dieciocho pasos, en cinco bloques: base común (1–5), productos (6–8), imágenes
(9–11), el interruptor público (12–15) y promociones (16), más el contrato (17) y
el cierre (18).

**Hay dos migraciones, las dos aditivas**, y una de ellas trae un `UPDATE` que
toca todas las filas de `Store`: es HD12 y es lo más irreversible del plan.

| Nº  | Qué se hace                                                                                                                                                                                   | Archivos                                                                                                                                                                                          | Criterio                     | Cómo se verifica                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Una sola implementación de errores HTTP serializables y de lectura de cuerpo JSON                                                                                                             | + `src/lib/httpJson.ts`; ~ `api/internal/_lib/issues.ts`, `features/orders/types.ts`                                                                                                              | —                            | `verify.sh F-011` → 0 con los tests de `/api/internal/*` pasando sin cambios                                                                                           |
| 2   | Autorización del panel: pura, envuelve `canManageStore`, devuelve un id **marcado** que las escrituras exigen por firma                                                                       | + `features/admin/{authorization,types}.ts`, + `constants/admin.ts`                                                                                                                               | 1, 2                         | `+ authorization.test.ts`: sin sesión → 401, ajena → 403, propia → ok. Sin base de datos                                                                               |
| 3   | Capa HTTP: 401/403 en el guard, 400/404/500 en la respuesta, tope de bytes, `no-store`                                                                                                        | + `app/api/admin/_lib/{guard,respond}.ts`                                                                                                                                                         | 2                            | Test de cada rama; `/api/admin` **no** entra en el matcher de `src/proxy.ts` (daría 302 donde el criterio espera 401)                                                  |
| 4   | Lecturas y listado: tiendas de la sesión, hub de tienda con lo del POS en solo lectura                                                                                                        | + `features/admin/server/stores.ts`, + `StoreList.tsx`; ~ `app/admin/{page,layout}.tsx`, + `app/admin/tiendas/[storeId]/page.tsx`                                                                 | 1                            | Test: `storeIds=[A]` → 1 fila, `[]` → 0, y nunca filtra por `businessId`. `curl` del listado: trae `tienda-demo`, no `tienda-dos`                                      |
| 5   | Fixture del 403: bandera `--stores=` en el emisor de tokens, que hoy firma las dos tiendas del seed                                                                                           | ~ `scripts/mint-sso-token.mjs`                                                                                                                                                                    | 1, 2                         | `node scripts/mint-sso-token.mjs --stores=seed-tienda-1` y el listado deja de traer la segunda                                                                         |
| 6   | El embudo: **una** función escribe y revalida en el mismo sitio, con lista blanca por tipo. Incluye `status` y el motivo (HD10), y por eso **se invierte** la aserción que los prohibía       | + `features/admin/server/mutations.ts`, + `features/admin/schemas.ts`                                                                                                                             | 3, 8 `[nuevo]`, 12 `[nuevo]` | `+ mutations.test.ts` (mock de `@/lib/cache`): cada función revalida su tienda. `+ boundaries.test.ts`: Prisma solo en `server/`, `publishedAt` nunca escrito          |
| 7   | Endpoint y pantallas de producto: listado paginado que incluye lo invisible, editor de los seis campos, isla con `fetch` y `<noscript>`                                                       | + endpoint de producto, + `src/features/admin/server/products.ts`, + `{ProductTable,ProductForm}.tsx`, + páginas                                                                                  | 3, 8 `[nuevo]`               | `curl`: propia → 200, ajena → 403, sin cookie → 401, `priceOverride` negativo o con tres decimales → 400                                                               |
| 8   | La prueba que hoy no existe: que el sync **no** pise los seis campos del panel                                                                                                                | + `features/sync/server/handlers/product.test.ts`                                                                                                                                                 | **3**                        | Fijar los seis por el panel → `send-catalog-batch.mjs` → `syncedPrice` cambió y los seis intactos, en base y en test                                                   |
| 9   | El emulador de Supabase Storage: cuatro servicios con su propia base, la pasarela, el bucket sembrado, y el entorno que sigue diciendo ENTORNO LISTO sin ellos                                | ~ `docker-compose.yml`, + `docker/storage-{roles.sql,gateway.conf}`, ~ `.env.example`, ~ `.agent/init.sh`                                                                                         | 4                            | `docker compose up -d` y `curl -fsS localhost:54321/storage/v1/bucket` trae `store-media`; `init.sh` en ENTORNO LISTO con los contenedores parados                     |
| 10  | El optimizador acepta el host del emulador derivando **protocolo, host y puerto** — sin el puerto, `next/image` da 400 sin decir por qué                                                      | ~ `next.config.ts`                                                                                                                                                                                | 4                            | `curl -sI` de `/_next/image?url=…` → 200 con `image/avif` o `image/webp`, sin romper el patrón de producción                                                           |
| 11  | Subida de imágenes: módulo único que habla con Storage y nunca lanza, mime **por contenido**, ruta con uuid, tope de 4 MB, tope por producto, y el cargador                                   | + `lib/supabase/storage.ts`, + `lib/imageType.ts`, + `features/admin/storagePaths.ts`, + `constants/media.ts`, + endpoint, + `ImageUploader.tsx`                                                  | **4**, 10, 11 `[nuevo]`      | `curl -F` → 201 y URL pública; `curl -sI` → 200; `text/plain` con nombre `.jpg` → 400; 6 MB → 400; la novena → 409; contenedor parado → 503 y `imageUrls` sin cambiar  |
| 12  | La migración del interruptor y el handler del sync: tres columnas de motivo, **el `UPDATE` que cierra todas las tiendas publicadas** (HD12), la marca de tiempo de origen y el opt-in del POS | ~ `prisma/schema.prisma`, + `prisma/migrations/<ts>_store_public_switch/`, ~ `features/sync/server/handlers/store.ts`                                                                             | 14 `[nuevo]`                 | `prisma validate` → 0, `migrate status` aplicada, `migration.sql` sin ningún `DROP INDEX` de `CanonicalProduct`; un evento rancio y un evento rutinario **no** reabren |
| 13  | La tienda cerrada al público: página con el motivo, la ficha respondiendo lo mismo sin leer el producto, `noindex`, avisos en carrito y checkout, y el pedido rechazado                       | + `ClosedStoreNotice.tsx`, + página cerrada; ~ `src/features/catalog/server/queries.ts`, `orders/server/{quote,createOrder}.ts`, `app/[slug]/**`                                                  | —                            | Cerrar **desde el panel** (no con SQL: ver riesgos) → `/tienda-demo` 200 con la frase y sin catálogo; la ficha igual; el comprobante sigue accesible; checkout → 409   |
| 14  | El interruptor en el panel: endpoint, isla en el hub, los seis motivos en constantes, texto libre obligatorio con «Otro», previsualización del aviso real, insignia y **quién** cerró         | + endpoint del interruptor, + `StorePublicSwitch.tsx`, + `src/constants/storeClosure.ts`; ~ hub y `StoreList.tsx`                                                                                 | —                            | Cerrar y abrir se ven en el acto en la vitrina; «Otro» sin mensaje → 400 y nada cambia en la base; el motivo guardado es el **código**, nunca la frase                 |
| 15  | Reparar lo que HD12 rompe: el seed vuelve a abrir sus dos tiendas a propósito y gana una **tercera cerrada** como fixture, y los guiones de F-004, F-005, F-006 y F-010 recuperan su suelo    | ~ `prisma/seed.ts`, ~ `scripts/*.mjs`, ~ `scripts/check-bundle-budget.mjs`                                                                                                                        | 15 `[nuevo]`                 | `verify.sh F-011 --full` → 0 y `--smoke` → 0 con las cuatro cadenas anteriores en verde; y `check:bundle` **falla** si no hay ninguna tienda publicada que medir       |
| 16  | Promociones completas: la columna del nombre con su migración, el módulo puro, **un solo** compositor de precio para vitrina y pedido, el CRUD, y el arreglo del total esperado del checkout  | ~ `prisma/schema.prisma` + migración; + `src/lib/promotions.ts`, + `src/features/admin/server/promotions.ts`, + `PromotionForm.tsx`, + endpoints; ~ `lib/{pricing,money}.ts` y cinco lectores más | —                            | Los doce requisitos de promociones de `spec.md`; y **la verificación de checkout de F-010 entera**, porque el paso toca su camino                                      |
| 17  | El diff de la v3 del contrato, escrito y listo para enviar: un campo opcional de motivo en el evento `STORE` y los dos avisos de comportamiento                                               | ~ `docs/sync-contract.md` (propuesta, en rama; el envío lo hace el humano)                                                                                                                        | —                            | El diff es **aditivo**: un lector de la v2 sigue funcionando sin cambiar una línea, y eso se comprueba mandando un evento sin el campo nuevo                           |
| 18  | Cierre: sensor completo, `tests.md` con veredicto por criterio, progreso, lecciones fichadas, y la nota de por qué el criterio 5 sigue abierto                                                | ~ `tests.md`, `progress/F-011.md`, `.agent/playbook/`                                                                                                                                             | 15 `[nuevo]`                 | `verify.sh --full` → 0, `--smoke` → 0, `verify.sh pending F-011` vacío                                                                                                 |

## De dónde sale cada paso

| Paso | De dónde sale                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Componentes (`httpJson.ts`) y § Retoques de reutilización                                                         |
| 2    | `architecture.md` § Contratos → «Autorización — un solo sitio»; `spec.md` R3, E4, E5                                                  |
| 3    | `architecture.md` § Componentes (`src/app/api/admin/_lib/guard.ts`, `src/app/api/admin/_lib/respond.ts`) y § Tabla de errores         |
| 4    | `architecture.md` § Componentes (base común) y § Lecturas del panel; `spec.md` E1, E2                                                 |
| 5    | `spec.md` I7; `architecture.md` § Fixtures                                                                                            |
| 6    | `architecture.md` § Contratos → «El embudo» y su nota sobre la lista blanca con `status`; `spec.md` R8, R10 e I3                      |
| 7    | `architecture.md` § Componentes → Productos y § Endpoints; `design.md` § editor de producto; `spec.md` E14–E19                        |
| 8    | `spec.md` criterio 3 («no tiene ninguna prueba»); `architecture.md` § Pruebas que exige la arquitectura                               |
| 9    | HD1; `architecture.md` § Emulador de Storage, sus seis pasos y su criterio de abandono                                                |
| 10   | `architecture.md` § `next.config.ts`; `spec.md` R23                                                                                   |
| 11   | `architecture.md` § Componentes → Imágenes; `design.md` § cargador de imágenes; `spec.md` E20–E25; PP1 (4 MB)                         |
| 12   | HD10, HD12, HD13 + AP5 (b) y AP6 (a) aprobadas; `architecture.md` § La migración y § El handler del sync                              |
| 13   | HD11; `architecture.md` § La lectura pública y § Checkout; `design.md` § 8 · La tienda cerrada al público                             |
| 14   | HD10, HD14, HD15; `design.md` § 9 · El interruptor del panel y su tabla de códigos y frases                                           |
| 15   | HD12; `architecture.md` § «HD12, feature por feature», incluido el hallazgo de que `check:bundle` pasaría en verde midiendo otra cosa |
| 16   | HD3, PP3; `architecture.md` § Promociones al detalle; `design.md` § promociones; `spec.md` P1–P12                                     |
| 17   | HD15; `architecture.md` § Contrato v3, con el diff exacto; AGENTS.md § Documentación                                                  |
| 18   | `.agent/README.md` § «Cuando algo falla» y § «Al completar un feature»; regla 1 de `features.json`                                    |

Ningún paso sale de un documento que no exista.

## Qué queda fuera

- **Branding y contacto de la tienda** (HD5, HD6). Diseñados y arquitecturados,
  congelados esperando a `Storefront`. Con ellos queda fuera el **criterio 5**, y
  por eso esta tanda no cierra el feature.
- **Un estado propio del panel separado del del POS.** HD13: un solo estado, gana
  el último. Con AP5 (b), «el POS escribió» pasa a significar «el POS dijo algo
  sobre publicación», no «el POS mandó cualquier evento».
- **Publicar una tienda en `DRAFT` desde el panel.** El panel abre y cierra lo que
  el sync ya creó; una tienda en borrador sigue respondiendo 404.
- **Alta y baja de productos, categorías y precios sincronizados.**
- **Selector de moneda del override.** Se guarda en la moneda sincronizada del
  producto en ese momento.
- **Borrar el objeto del bucket al quitar una URL** (queda huérfano a propósito), y
  **recorte o rotación** de imágenes.
- **Reducir la foto en el navegador antes de subir.** Sería la diferencia entre
  subir 4 MB y 400 KB en la conexión del público objetivo, pero es un feature con
  su propio criterio medible, no un extra silencioso de este.
- **Que el comprobante diga cuánto ahorró el comprador.** Dos columnas nuevas y
  una conversación de contrato. La vitrina sí tacha el precio anterior.
- **Desglose del descuento hacia el POS.** El descuento va dentro de `unitPrice`,
  que es lo que mantiene viva la fórmula que el contrato ya publica.
- **Cron de revalidación en los bordes de una promoción.** Hasta una hora de
  retardo en la vitrina cacheada. Anotado, no arreglado.
- **Enviar la v3 del contrato.** El paso 17 la deja escrita; avisar al otro equipo
  es tuyo — y ese aviso debería llevar también los cambios de la v2, que nunca se
  le comunicaron.

**Un criterio propuesto que se retira, y por qué**: el criterio 7 `[nuevo]` de la
spec pedía que `status` no apareciera nunca en el módulo de escritura del panel.
HD10 lo contradice de frente: ahora el panel escribe `status` a propósito. Era una
propuesta, no un criterio firmado, así que se retira y se queda con su mitad
todavía verificable: **el panel nunca escribe `publishedAt` y nunca publica una
tienda en `DRAFT`**. Los cinco criterios de `features.json` no se tocan (regla 3).

## Riesgos y plan B

- **HD12 es lo más irreversible del plan**: un `UPDATE` que cierra todas las
  tiendas publicadas. En este repo son dos filas de desarrollo; en producción son
  todas las tiendas vivas, que quedan fuera de línea hasta que cada admin entre a
  abrirlas. Marcha atrás: no la hay automática —la migración no guarda qué estado
  tenía cada fila—, así que si esto va a producción, el paso previo es un volcado
  de `id, status` de `Store`. Lo digo aquí porque firmar el plan es firmar esto.
- **La trampa que encontró el diseñador verificando, y que cambia cómo se prueba**:
  cambiar `status` con SQL **no cambia la página** en ninguno de los dos sentidos,
  porque manda el `unstable_cache` con el tag de la tienda. Puso `tienda-demo` en
  `DRAFT` y siguió sirviendo catálogo con 200 tras reiniciar y borrar
  `.next/cache`. Consecuencia: toda verificación del interruptor se hace **desde el
  panel**, que es lo único que revalida. Un guion que lo pruebe con `psql` daría un
  falso verde.
- **`check:bundle` pasaría en verde midiendo otra cosa.** Sin ninguna tienda
  publicada no falla: mide `index.html`. Es pérdida silenciosa de cobertura, y el
  paso 15 la convierte en fallo explícito.
- **El seed pelea con la migración a propósito**: `seedStore` escribe `PUBLISHED`
  en `create` **y** en `update`, así que `npm run seed` reabre sus tiendas y
  deshace el `UPDATE` retroactivo. Es deliberado —F-010 necesita las dos abiertas—
  y lleva comentario, o alguien lo «arregla» y rompe cuatro features.
- **Dos migraciones aditivas** (pasos 12 y 16), ninguna con `DEFAULT`, backfill ni
  índices nuevos, y ninguna usando los dos comandos que `AGENTS.md` prohíbe. Las
  dos arrastran la trampa fichada: `prisma migrate dev` propone borrar los índices
  GIN de `CanonicalProduct` que el schema no declara, así que el `migration.sql` se
  revisa a mano. Si se cuela, la búsqueda de F-015 se queda sin índices y nadie lo
  nota hasta entonces.
- **El emulador de Storage es el riesgo número uno de esfuerzo**, con criterio de
  abandono escrito: si tras **dos** arranques —el segundo con el servicio extra que
  el compose oficial de Supabase usa— no responde al listado de buckets, o si
  aparece la necesidad de un servicio más, se pasa a la CLI de Supabase desde un
  script de entorno. Se conserva HD1; se sacrifica «todo en docker-compose».
- **El checkout de F-010 se rompería en silencio con las promociones**: hoy calcula
  el total esperado en el cliente, así que con una promoción de pedido **todos** los
  checkouts responderían 409. Lo arregla el paso 16, y por eso ese paso obliga a
  correr la verificación de F-010 completa.
- **El contrato**: la v3 es aditiva y el otro equipo no tiene que hacer nada. Pero
  es un cambio en `docs/sync-contract.md` y hay gente al otro lado: el paso 17 lo
  deja escrito, no enviado.
- **La verificación visual sigue a medias, y es la tercera vez que lo escribo.** El
  diseñador lo intentó cinco veces en tres ciclos: la herramienta dice
  «redimensionada» y la captura mide lo mismo. **No hay juicio a 360 ni a 768 px**,
  que es el aparato del público objetivo. Va como paso, no como nota.

## Coste

- **Ciclos de agente**: 2 de implementación (los pasos 12–15 son un bloque
  coherente y caro por sí solos), 1 de pruebas y verificación, más los reintentos
  del sensor. Si quieres partirlo, hay **dos líneas limpias**: entre el 8 y el 9
  (productos / imágenes) y entre el 15 y el 16 (interruptor / promociones). El
  interruptor es lo que más valor te da y lo que menos depende de lo demás: si solo
  quieres una cosa, es el bloque 12–15.
- **Se toca de lo que ya funciona**: dos reexports, `/admin` y su layout (hoy un
  cascarón), el emisor de tokens, el **handler del sync de tienda** (paso 12), las
  lecturas públicas del catálogo (13), el seed y cuatro guiones de verificación
  (15), y los precios, la cotización, el pedido y el checkout (16). Los pasos 12, 13
  y 16 son los que pueden romper algo que hoy está en verde.
- **Marcha atrás**: 1–11 son código nuevo aislado y dos reexports; `git revert` y
  nada de datos. El 12 no tiene marcha atrás de datos sin volcado previo. El 16 se
  revierte con `DROP COLUMN` más `git revert`.

## Preguntas antes de aprobar

Ninguna abierta. Las siete que hubo están resueltas y escritas aquí para que el
plan se pueda leer sin el hilo del chat:

- **PP1 — Tope de imagen: 4 MB**, en `src/constants/media.ts` con el motivo en el
  comentario; el tope del emulador se queda en 10 MB para que muerda el nuestro.
- **PP2 — F-011 se queda en `passes: false`, 4 de 5 criterios.** El quinto espera a
  `Storefront`.
- **PP3 — La promoción lleva nombre**, columna opcional (paso 16).
- **AP5 (b) — El POS escribe el estado solo cuando cambia su propio opt-in**, no en
  cada evento. Sin esto, corregir un teléfono en el POS reabría una tienda cerrada
  por vacaciones.
- **AP6 (a) — Se añade la guarda anti-rancia a la tienda**, con el `updatedAt` que
  el payload ya trae. Sin coste de contrato.
- **HD11 — Cerrada se ve como página**, 200 con el motivo, sin catálogo ni carrito,
  `noindex` mientras esté cerrada.
- **HD14 — Seis motivos fijos más texto libre opcional**, obligatorio con «Otro».
  En la base se guarda el código, nunca la frase.

## Aprobación (tanda 1)

- 2026-08-26T19:26:47Z — aprobado por el humano: «Me vale»

---

# Tanda 3 — el editor de branding sobre `Storefront`

**Capítulo añadido el 2026-08-28.** Cierra el quinto y último `acceptance_criteria`
de F-011 («Guardar branding inválido es rechazado por `themeTokensSchema` y no
llega a la base»), bloqueado por HD6 hasta que existiera `Storefront` (F-017, ya
`passes: true`). Se apoya en `.agent/specs/F-011/spec.md` § «Tanda 3» (`estado:
listo`), `.agent/specs/F-011/architecture.md` § «Tanda 3» (`estado: listo`) y
`.agent/specs/F-011/design.md` § «Tanda 3» (`estado: listo`). No reabre, no
reescribe y no re-verifica los pasos 1–18: los criterios 1–4 siguen en `main`,
verificados.

## Qué se va a construir

Un admin que administra **todas** las sucursales renderizables de su marca entra
a `/admin/tiendas/{storeId}/marca`, elige una paleta o ajusta los cinco tokens a
mano, mira una maqueta en vivo del catálogo de su cliente y guarda: el color
cambia **en el acto**, en todas sus sucursales y en la página que las lista, sin
esperar la hora de caché. Un branding inválido —un color que el navegador no
entiende, una clave que no existe— se rechaza con un error por campo y **no
llega a la base**. Un admin al que le falta aunque sea una sucursal de la marca
ve la misma pantalla **sin ningún campo**, con el nombre y la ciudad de lo que le
falta, nunca un formulario a medio llenar.

Lo que **no** cambia: los cuatro criterios ya construidos (listado, 403, los seis
campos de producto, imágenes), la tienda pública, y el contrato con cuadrecaja.

## Pasos

Dieciséis pasos, en el orden en que se ejecutan: dominio puro (19–22), embudo de
escritura (23–24), HTTP (25), constantes y pantalla (26–29), deuda menor aprobada
(30), fixture y sensor (31–33), cierre (34). **Sin migración de `prisma/schema.prisma`
y sin ninguno de los dos comandos que `AGENTS.md` prohíbe.**

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                                                                        | Archivos                                                                                                                 | Criterio                          | Cómo se verifica                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19  | Extraer `themeCustomProperties()` de `renderStoreTheme`, mismo `CUSTOM_PROPERTY`/`RADIUS_SCALE`, como objeto — **cero cambio de salida**                                                                                                                                                                                                           | ~ `src/features/theming/storeTheme.ts`                                                                                   | 13 (no regresión)                 | Test de igualdad de cadena **antes** del refactor sobre los casos que ya cubre `storeTheme.test.ts`; `npm run check:theme` → 0                                                                                                                     |
| 20  | `authorizeBrandCoverage` + `AuthorizedStorefrontId` + `CoverageBranch` + `BrandCoverageResult`: puro, 0 consultas, reutiliza `canManageStore`; `missing` sin `storeId`                                                                                                                                                                             | ~ `src/features/admin/authorization.ts`                                                                                  | 22 `[nuevo]`                      | `+ authorization.test.ts`: todas en sesión → `ok`; falta una → `FORBIDDEN` con esa sucursal en `missing` sin `storeId`; lista vacía → `ok`; no depende del orden                                                                                   |
| 21  | `expandBrandRevalidation` + `BrandRevalidationSet`: gemela de `expandBrandTouch`, sin cast, con `canonicalSlug()`                                                                                                                                                                                                                                  | ~ `src/features/storefront/server/registry.ts`                                                                           | 17 `[nuevo]`                      | `+` test: un miembro sin slug propio → `[brandSlug]`; tres miembros → los tres slugs propios; un miembro sin slug dentro de una marca de varios → lanza                                                                                            |
| 22  | `loadBrandingTarget`: la lectura única (R43) — marca, `themeTokens`, sucursales renderizables con `status` (B13)                                                                                                                                                                                                                                   | + `src/features/admin/server/branding.ts`                                                                                | 5, 22 `[nuevo]`                   | Test de tipos + integración: filtra `status != DRAFT`; `null` si la tienda desapareció                                                                                                                                                             |
| 23  | `brandingBodySchema` re-exporta `themeTokensSchema` (ninguna clave redefinida); tipos de cable `AdminBrandingRow`/`BrandingBody`                                                                                                                                                                                                                   | + en `src/features/admin/schemas.ts`; + en `src/features/admin/types.ts`                                                 | 5, 16 `[nuevo]`                   | `+ schemas.test.ts`: `expect(brandingBodySchema).toBe(themeTokensSchema)`; `grep` sin `brandContrast`/`accentContrast`/`radius` en `schemas.ts`                                                                                                    |
| 24  | `saveBrandTheme` + `commitBrand` (lista blanca `PanelStorefrontWrite = Pick<…, "themeTokens">`, revalida marca + todas las sucursales, nunca `revalidateSlugs`); `boundaries.test.ts` gana `"slug"` en `FORBIDDEN_WRITE_COLUMNS`                                                                                                                   | ~ `src/features/admin/server/mutations.ts`; ~ `src/features/admin/server/boundaries.test.ts`                             | 5, 17 `[nuevo]`                   | `+ mutations.test.ts` (mock `@/lib/cache`): `revalidateStores` con **todos** los canónicos, `revalidateStorefronts` con el slug de marca, **nunca** `revalidateSlugs`; `R34` por construcción (`themeTokensSchema.parse({})` → `{}`, nunca `null`) |
| 25  | Endpoint `PUT`/`PATCH` `/api/admin/stores/{storeId}/branding`: guard (401/403 sin consulta) → lectura → `authorizeBrandCoverage` → 403 **antes** que 400 → cuerpo → mutación; mismo `forbidden()` para los dos 403 (R44)                                                                                                                           | + `src/app/api/admin/stores/[storeId]/branding/route.ts`                                                                 | 5, 22 `[nuevo]`                   | `curl` de la tabla de errores completa: 200/400×3/401/403×2/404/500, con `.issues[].path` no vacío en el 400                                                                                                                                       |
| 26  | `src/constants/branding.ts`: seis paletas literales (DP13, con nota de que se espera un sistema de diseño propio más adelante), atajos `Claro`/`Oscuro`, dos nombres de producto de ejemplo                                                                                                                                                        | + `src/constants/branding.ts`                                                                                            | —                                 | `grep` sin cadenas mágicas equivalentes en los componentes que las usan                                                                                                                                                                            |
| 27  | Pantalla `/admin/tiendas/{storeId}/marca` (+ `loading.tsx`): cabecera con la frase según N sucursales, editor 12a con cobertura completa, bloqueado 12b sin campos con `authorizeBrandCoverage`, `dynamic = "force-dynamic"` literal, 404 de tienda ajena                                                                                          | + `src/app/admin/tiendas/[storeId]/marca/{page,loading}.tsx`                                                             | 5, 22 `[nuevo]`                   | V33–V37 de `design.md`: sin `En camino.`; cuatro `name` de campo y cero `name` en el `type="color"`; con cobertura parcial → 200 con `Te faltan estas sucursales` y sin ningún campo ni `id` ajeno; tienda ajena → 404                             |
| 28  | `BrandingForm` (isla, único `"use client"`) + `ColorTokenField`, `BrandCoverageNotice`, `ThemeSwatches`, `StorefrontPreview` (sin directiva): chips de paleta, control de color compuesto, `RadioCard` de `radius`, maqueta con `themeCustomProperties()` en `style`, `fetch`, `issues` por campo, confirmación en línea para quitar, `<noscript>` | + `src/features/admin/components/{BrandingForm,ColorTokenField,BrandCoverageNotice,ThemeSwatches,StorefrontPreview}.tsx` | 5, 13, 19 `[nuevo]`, 20 `[nuevo]` | V38–V40, V42, V44 de `design.md`; `grep -rn "use client" src/components/ui/` vacío; `npm run build && check:bundle && check:theme` → 0                                                                                                             |
| 29  | Tarjeta del hub «Colores de tu marca» (sustituye «Colores y contacto · En camino»): cuatro muestras + esquinas si hay branding (B14: `themeTokens` en `STOREFRONT_SELECT`), enlace a la pantalla nueva                                                                                                                                             | ~ `src/app/admin/tiendas/[storeId]/page.tsx`; ~ `src/features/admin/server/stores.ts`                                    | —                                 | V33: el hub ya no contiene `En camino.`; cero consultas nuevas (misma `select` del hub, una columna más)                                                                                                                                           |
| 30  | `/sesion-cerrada` (DP12, aprobado): componente de servidor, cero JS, explica que se cerró la sesión y se vuelve a entrar desde Cuadre de Caja — arregla de paso el 401 de agrupar sucursales                                                                                                                                                       | + `src/app/sesion-cerrada/page.tsx`                                                                                      | —                                 | `curl` tras un 401 tanto en agrupar como en branding llega a 200 con el texto, no a 404; `src/lib/slug.test.ts` (ya existente) deja de estar huérfano                                                                                              |
| 31  | Fixture HD18: `seedBrandWithBranches()` — marca `el-trebol`, tres sucursales (`PUBLISHED`, `SUSPENDED`, `DRAFT`), `themeTokens: null`, sin productos; no toca `seedStore`/`seedClosedStore` ni `bodega-uno`/`bodega-dos`                                                                                                                           | ~ `prisma/seed.ts`                                                                                                       | 23 `[nuevo]`                      | `npm run seed && npm run seed` → 0, la marca conserva sus tres sucursales la segunda vez                                                                                                                                                           |
| 32  | Sección de branding en el sensor repetible: los tres cuerpos inválidos (400, DB intacta), camino feliz (200 + `--color-brand` en la vitrina), `{}` (200, sin `<style>`), `oklch(...)` conservado, 403 de cobertura parcial, 200 con cobertura de marca revalidando las tres URL                                                                    | ~ `.agent/specs/F-011/smoke.sh`                                                                                          | 5, 17, 19, 20, 22, 23 `[nuevo]`   | `bash .agent/verify.sh F-011 --smoke` → 0                                                                                                                                                                                                          |
| 33  | `.agent/specs/F-011/visual.mjs`: 360/768/1280 px del editor con branding, bloqueado por cobertura, y modo oscuro, reutilizando la etapa `--visual` que construyó F-017                                                                                                                                                                             | + `.agent/specs/F-011/visual.mjs`                                                                                        | 21 `[nuevo]`                      | `bash .agent/verify.sh F-011 --visual` → 0; V39–V44 de `design.md`                                                                                                                                                                                 |
| 34  | Cierre de la tanda: `tests.md` con veredicto por criterio (los cinco de `features.json` + los criterios `[nuevo]` de las tres tandas), progreso actualizado, lecciones fichadas, y la decisión de `passes` que solo toma el humano (SP5)                                                                                                           | ~ `tests.md`, `progress/F-011.md`, `.agent/playbook/`                                                                    | —                                 | `verify.sh F-011 --full` → 0 en sus nueve etapas; `verify.sh pending F-011` vacío                                                                                                                                                                  |

## De dónde sale cada paso

| Paso | De dónde sale                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 19   | `architecture.md` § Componentes (`themeCustomProperties`); `design.md` § Cómo encaja con `architecture.md`    |
| 20   | `architecture.md` § Decisión punto 2 y § Contratos → «Autorización»; `spec.md` HD16, R42                      |
| 21   | `architecture.md` § Decisión punto 4 y § Contratos → «La proyección de revalidación»; `spec.md` R36, R37, I12 |
| 22   | `architecture.md` § Decisión punto 3 y § Contratos → «La lectura única»; `spec.md` R43; `design.md` B13       |
| 23   | `architecture.md` § Contratos → «El esquema»; `spec.md` R32, criterio 16                                      |
| 24   | `architecture.md` § Contratos → «El embudo» y § Pruebas que exige; `spec.md` R33, R34, R35                    |
| 25   | `architecture.md` § «El endpoint» y § Tabla de errores; `spec.md` E35–E42                                     |
| 26   | `design.md` § 12a (i)/(ii)/(iv); DP13 (aprobada, con nota de reemplazo futuro)                                |
| 27   | `design.md` § 12, 12a, 12b; `architecture.md` § Componentes (pantalla de marca)                               |
| 28   | `design.md` § 12a, § Componentes de UI; `architecture.md` § Componentes (`BrandingForm`)                      |
| 29   | `design.md` § 11; `design.md` B14                                                                             |
| 30   | `design.md` DP12 (aprobada); `design.md` VE26                                                                 |
| 31   | `architecture.md` § Modelo de datos y migraciones → «La fixture de HD18»                                      |
| 32   | `architecture.md` § Fixtures y cómo se verifica                                                               |
| 33   | `design.md` § Verificación (V39–V44); `architecture.md` § Componentes (`visual.mjs`)                          |
| 34   | `.agent/README.md` § «Al completar un feature»; `spec.md` § «No decidido a propósito» (SP5)                   |

Ningún paso sale de un documento que no exista.

## Qué queda fuera

- **El contacto de la marca** (`contactPhone`, `contactWhatsapp`, `contactEmail`).
  HD17/SP2: fuera de esta tanda, deuda anotada en `spec.md` I15.
- **Logo y portada de la marca** (`logoUrl`, `coverUrl`). HD19/SP4: fuera; F-023 va
  a cambiar cómo se almacenan y sirven las imágenes.
- **`Storefront.slug`.** Lo gobierna el registro de slugs (ADR 0018); cambiarlo es
  otro feature.
- **`Storefront.name`.** Nace del sync; renombrarla no lo pide ningún criterio.
- **Validación de contraste en servidor.** HD8/R39: un branding ilegible se puede
  guardar, con aviso en la maqueta, sin bloquear.
- **Agrupar y desagrupar sucursales.** Ya construido (agrupar, F-017) o descartado
  a propósito (desagrupar, ADR 0018 (f)).
- **Publicar, cerrar y abrir la tienda al público.** Es de la sucursal y ya está
  construido (tanda 1, HD10–HD15).
- **Los criterios 1–4 y sus pantallas.** Verificados y en `main`; no se reabren.
- **Un permiso nuevo por marca** (`AuthorizedStorefrontId` con endpoint propio por
  `storefrontId`). Descartado en `architecture.md`: la marca se deriva de una
  sucursal ya autorizada, nunca de la URL ni del cuerpo.

## Riesgos y plan B

- **Sin migración de schema y sin los comandos prohibidos por `AGENTS.md`**:
  `Storefront.themeTokens` ya existe (F-017). Si en algún paso pareciera hacer
  falta una migración, es señal de que algo se entendió mal — se para y se
  pregunta.
- **`ThemeTokens` (propiedades opcionales) puede no encajar en
  `Prisma.InputJsonValue`.** Plan B: `as Prisma.InputJsonObject` en el `data`,
  nunca `any` (ESLint lo prohíbe).
- **La lectura nueva puede disparar el test de fronteras del storefront** si va
  por `slug` en vez de por `id`, o si anida `storefront: { slug: true }` en vez
  de `storefront: { select: … }`. Ya está previsto en el paso 22; si aun así
  salta, el mensaje del test señala el archivo.
- **Extraer `themeCustomProperties()` puede cambiar un carácter del `<style>`
  público.** Plan B: el test de igualdad de cadena del paso 19 corre **antes**
  del refactor, no después.
- **La fixture de tres sucursales (paso 31) puede mover qué página mide
  `check:bundle`.** Las tres páginas nuevas no llevan catálogo (más ligeras que
  `tienda-demo`), así que la página peor medida no cambia; el smoke ya comprueba
  cuál se midió (patrón del ciclo 2).
- **`npm run seed` dos veces puede dejar la marca a medias.** Criterio 23 en el
  sensor lo comprueba explícitamente; `seedStorefront()` ya es idempotente contra
  el registro `Slug`.
- **El techo de la cookie de sesión (~60–65 tiendas, límite de F-008) hace que una
  marca con más de ~60 sucursales renderizables no tenga branding editable por
  nadie.** Es consecuencia medida de HD16, no un bug de esta tanda; el arreglo es
  de F-008.
- **Revalidar una marca grande cuesta 2N+1 tags** (~1,5–3,5 s con 60 sucursales).
  Si algún día hace falta, se mueve a un `after()` o a una cola — **nunca** se
  revalida menos, porque eso reabre la ficha del playbook sobre revalidar solo lo
  que se escribe.
- **`check:harness` puede marcar en falso archivos "por crear" citados con ruta
  abreviada.** Ya mordió en F-011 y F-017: las rutas nuevas van sin comillas
  invertidas y con «(por crear)», como en la tabla de pasos de arriba.
- **DP13 es un valor de paso, no definitivo**: el humano ya avisó que estos seis
  hexadecimales se van a reemplazar cuando exista un sistema de diseño propio.
  Cambiarlos después es editar `src/constants/branding.ts`; no toca ninguna
  tienda ya guardada (los tokens se guardan como valor, no como referencia a la
  paleta).

## Coste

- **Ciclos de agente**: 1 de implementación (los dieciséis pasos son un solo
  camino de escritura sobre piezas que ya existen, sin migración) + 1 de pruebas,
  más los reintentos del sensor. Es mucho más pequeño que la tanda 1 porque reusa
  el embudo, el guard y la capa HTTP enteros.
- **Se toca de lo que ya funciona**: `authorization.ts`, `mutations.ts`,
  `boundaries.test.ts`, `registry.ts` del storefront, `stores.ts` (una columna más
  en un `select` existente), el hub de tienda (una tarjeta) y `storeTheme.ts` (un
  refactor sin cambio de salida). Nada de esto tiene migración de datos detrás.
- **Marcha atrás**: todo el capítulo es aditivo y sin migración — `git revert` del
  diff completo, sin dato que deshacer. El paso más caro de deshacer a medias es
  el 31 (la fixture del seed), y solo si `npm run seed` ya corrió en una base con
  datos que alguien quiere conservar.

## Preguntas antes de aprobar

Ninguna abierta. Las seis que hubo (SP1–SP4 de la spec, DP12 y DP13 del diseño)
están resueltas y escritas aquí para que el plan se lea sin el hilo del chat:

- **SP1 — Cobertura estricta**: un admin solo edita el branding de una marca si
  `session.storeIds` cubre el **100 %** de sus sucursales renderizables. Si falta
  una, 403 seco — nunca un guardado parcial ni un aviso de «a cuántas afecta».
- **SP2 — El contacto de la marca queda fuera** de esta tanda.
- **SP3 — La fixture de dos-o-más-sucursales va en `prisma/seed.ts`** (marca
  `el-trebol`, de un solo uso), no agrupada al vuelo dentro del smoke.
- **SP4 — Logo y portada quedan fuera** de esta tanda.
- **DP12 — Se construye `/sesion-cerrada`** en esta tanda (paso 30): quince líneas,
  arregla de paso el 401 de agrupar sucursales.
- **DP13 — Se aprueban los seis hexadecimales de las paletas**, con la advertencia
  del humano de que se van a reemplazar por un sistema de diseño propio más
  adelante; el reemplazo es una edición de constante, no de esta tanda.

**Lo que sigue abierto a propósito, y no bloquea esta firma**: si F-011 pasa a
`passes: true` al cerrar esta tanda pese a que su nota en `features.json` menciona
que F-023 sustituye parcialmente el criterio 4. `spec.md` lo deja como «No
decidido a propósito» — es una decisión de cierre, no de plan, y se le pregunta
al humano en el paso 34.

## Aprobación (tanda 3)

<!-- Lo escribe `bash .agent/sdd.sh approve F-011 '<lo que dijo el humano>'`.
     No se edita a mano. -->

- 2026-08-28T02:44:37Z — aprobado por el humano: «Apruebo el plan (recomendado)»
