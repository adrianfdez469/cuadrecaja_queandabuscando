---
feature: F-011
agente: orquestador
actualizado: 2026-08-26T19:26:47Z
estado: listo
aprobado: sí
---

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

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-011 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-26T19:26:47Z — aprobado por el humano: «Me vale»
