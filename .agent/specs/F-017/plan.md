---
feature: F-017
agente: orquestador
actualizado: 2026-08-27T04:01:32Z
estado: listo
aprobado: sí
---

## Etapa 1 — firmada, construida y verificada

Se firmó el 2026-08-27 («Ok»), se construyó en 15 pasos y `sdd-tester` dio
**PASA a sus seis criterios** (1, 3, 4, 5, 7 y 8) ejecutando algo real en cada
uno: `verify.sh F-017 --full` → 0 en las nueve etapas, `--smoke` → 0, `--visual`
→ 0 —la primera vez que esa etapa corre de verdad en este repo—, 375 pruebas, y
los guiones de humo de F-010 y F-011 repetidos sin tocarlos, sin fallos.

Lo que quedó en pie: la marca existe y posee el slug, el branding y el contacto
que se muestra; el registro de slugs rechaza reservadas por restricción de base;
el resolvedor es único; el slug canónico es la clave de invalidación; el sync
crea marca y sucursal en la misma entrega; y Cuadre de Caja tiene su servicio
para saber, antes de publicar, si un slug está libre y cuál será el definitivo.

El detalle está en `impl.md` y en `tests.md`. La firma de esa etapa se conserva
al pie de este documento; **lo que se firma ahora es la etapa 2**.

## Qué se va a construir

**Etapa 2 de dos, y la que cierra el feature.** El negocio con dos locales deja
de tener la marca partida: agrupa sus tiendas desde el panel, y a partir de ahí
la URL de la marca muestra un **selector de sucursal** en vez de un catálogo,
mientras cada local conserva su propia URL — la que ya está impresa en su QR.

El comprador que cambia de sucursal lee **antes de tocar nada** qué pasa con su
carrito, y lo que pasa es que no se pierde: cada tienda guarda el suyo.

Lo que **no** cambia: el pedido, el precio y las existencias se siguen
resolviendo contra una única sucursal; nada de catálogo unión ni de pedidos
partidos. Y agrupar **no tiene vuelta atrás**, así que la pantalla lo dice y
enseña las dos URL resultantes antes de aplicar.

## Pasos

Nueve pasos. Cubren los criterios **2** y **6**, y revalidan **7** y **8**.
**No hay migración**: `Storefront`, `Slug` y `Store.storefrontId` los creó la
etapa 1.

| Nº  | Qué se hace                                                                                                                                                                                                                                        | Archivos                                                                                                                                                    | Criterio | Cómo se verifica                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | El listado de sucursales como componentes **de servidor**: la tarjeta de cada sucursal con nombre, ciudad y su estado de apertura, ordenadas abiertas primero y alfabético dentro de cada grupo                                                    | + src/components/store/BranchList.tsx (por crear), + src/components/store/BranchCard.tsx (por crear)                                                        | **2**    | `+ BranchList.test.tsx`: el orden es el pactado, y `grep -rn '"use client"' src/components/store/` sigue vacío                                                       |
| 2   | `/[slug]` en modo doble: una sucursal renderizable → su catálogo; varias → el selector, con su marcador en el HTML. Y el caso de todas cerradas                                                                                                    | ~ `src/app/[slug]/page.tsx`                                                                                                                                 | **2**, 7 | `curl` de la marca agrupada → 200 con los dos nombres; `curl` de una marca con una sola → 200 **sin** el marcador; `npm run build` mantiene las rutas de tienda en ● |
| 3   | Autorizar y escribir la agrupación: se comprueban **las dos** tiendas contra la sesión, y la escritura va en un solo lote —re-apuntar el slug **antes** de borrar la marca vacía, o la URL de la sucursal daría 404                                | ~ `src/features/admin/authorization.ts`, ~ `src/features/admin/server/mutations.ts`                                                                         | **2**    | `+ tests` de las cinco escrituras y su orden; y los rechazos: negocios distintos → 409, la marca que ya tiene → 409, sin permiso sobre las dos → 403                 |
| 4   | El endpoint de agrupar, con el guard y la capa HTTP de F-011 sin inventar otra                                                                                                                                                                     | + `src/app/api/admin/stores/[storeId]/branches/route.ts`                                                                                                    | **2**    | `curl` con cookie: propia+propia → 200 con las dos URL; ajena → 403; sin cookie → 401; cuerpo inválido → 400                                                         |
| 5   | La pantalla de agrupar: elegir la tienda que se une, **la vista previa con las dos URL resultantes y qué cambia**, la confirmación de algo sin vuelta atrás, y los errores del endpoint con su texto                                               | + src/features/admin/components/GroupStoresForm.tsx (por crear), + `src/app/admin/tiendas/[storeId]/agrupar/page.tsx`                                       | **2**    | `design.md` § la pantalla de agrupar; la vista previa sale de `previewSlug()` **en el servidor**, así que no puede divergir de lo que aplica el `POST`               |
| 6   | La tarjeta «Tu marca» en el hub, con las sucursales hermanas por nombre y ciudad y **sin `storeId`** — la lectura no puede construir un enlace ni un formulario aunque alguien lo intente después (HS12)                                           | + `src/features/admin/components/StoreBrandCard.tsx`, ~ `src/features/admin/server/stores.ts`                                                               | —        | Test de que la lectura **no** devuelve `storeId` y que `listManagedStores` no cambió; el criterio 1 de F-011 sigue verde en su humo                                  |
| 7   | El cambio de sucursal: la tira `Estás en … · Cambiar de sucursal`, la página `/[slug]/sucursales` y el aviso del carrito — que dice la verdad **desde el HTML**, sin esperar JavaScript, y la isla solo añade el número de la sucursal que se deja | + `src/app/[slug]/sucursales/page.tsx`, + src/components/store/BranchBar.tsx (por crear), + src/features/cart/components/BranchSwitchNotice.tsx (por crear) | **6**    | `curl` de `/[slug]/sucursales` trae la frase de que cada sucursal guarda su carrito; y con JavaScript deshabilitado sigue trayéndola                                 |
| 8   | El guion visual y el de humo, ampliados con lo de esta etapa: el selector y la pantalla de agrupar a 360 y 1280 px                                                                                                                                 | ~ `.agent/specs/F-017/visual.mjs`, ~ `.agent/specs/F-017/smoke.sh`                                                                                          | 8        | `verify.sh F-017 --visual` → 0 y `--smoke` → 0, con capturas que muestran lo que el guion afirma                                                                     |
| 9   | Cierre del feature: `tests.md` con los ocho criterios, progreso, lecciones fichadas, y **la propuesta de nota** para que tú marques `passes` en `features.json`                                                                                    | ~ `tests.md`, `.agent/progress/F-017.md`, `.agent/playbook/`                                                                                                | 8        | `verify.sh --full` → 0, `--smoke` → 0, `--visual` → 0, `pending F-017` vacío; y `sdd.sh done F-017` **después** de tu firma en `features.json`                       |

## De dónde sale cada paso

| Paso | De dónde sale                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § El selector de sucursal (etapa 2, criterio 2); `design.md` § selector, con DP3                                  |
| 2    | `architecture.md` § Componentes, fila `/[slug]` en modo doble; `spec.md` criterio 1 frente a 2                                      |
| 3    | `architecture.md` § Agrupar dos tiendas → «Qué les pasa a los slugs» y «Cómo se escribe»; HS8                                       |
| 4    | `architecture.md` § Agrupar dos tiendas → la ruta y § Tabla de errores                                                              |
| 5    | `design.md` § la pantalla de agrupar; HS10 y DP5; `architecture.md` § DP5, que la resuelve con `previewSlug()` en servidor          |
| 6    | HS12 (la respuesta del humano, con las tres condiciones de la arquitectura); `architecture.md` § Hermanas de la marca en el panel   |
| 7    | `design.md` § 8 y § 9 reescritas tras la reversión de DP1; HS5 y HS11; `architecture.md` § Cambiar de sucursal con el carrito lleno |
| 8    | `.agent/verify.sh` § `correr_visual`; `design.md` § «Qué el guion visual NO puede comprobar por diseño»                             |
| 9    | `.agent/README.md` § «Al completar un feature»; reglas 1 y 4 de `features.json`                                                     |

## Qué queda fuera

- **Desagrupar.** No existe: agrupar no tiene vuelta atrás, y eso se le dice al
  admin antes de aplicar. Deshacerlo sería otro feature con sus criterios.
- **Agrupar más de dos tiendas de golpe**, y agrupar tiendas de negocios
  distintos: lo segundo se rechaza con 409.
- **Que el aviso mencione los carritos de las otras sucursales.** Lo pediste y lo
  reconsideraste: el aviso habla del carrito de la sucursal que se deja. La
  pantalla donde el comprador ve **todos** sus carritos es la propuesta
  `.agent/specs/propuestas/carritos-abiertos-del-comprador.md`, que sigue fuera.
- **Inventario distribuido, catálogo unión, pedidos partidos y almacenes.**
  Descartados en ADR 0012.
- **Geolocalización en el selector.** El modelo no cambia si algún día se añade.
- **Enviar el anuncio del contrato.** Sigue escrito y sin enviar, y ya acumula
  tres cosas: los cambios de la v2, el motivo de cierre de F-011 y el servicio de
  slug de F-017.
- **El editor de branding de F-011.** Esta etapa termina de dejarle el sitio; el
  criterio 5 de F-011 se cierra en su propio ciclo, y su plan vuelve a tu firma
  porque es un cambio de alcance sobre algo ya firmado.

## Riesgos y plan B

- **Agrupar no se puede deshacer**, y por eso el freno está en la pantalla: la
  vista previa enseña las dos URL resultantes y qué cambia **antes** de aplicar.
  La vista previa se calcula en el servidor con la misma función que aplica el
  `POST`, así que no puede prometer una URL y crear otra.
- **El orden de las cinco escrituras importa**: si se borra la marca vacía antes
  de re-apuntar su slug a la sucursal, esa URL —que puede estar impresa en un
  papel— responde 404. Va en un solo lote, no en una transacción interactiva,
  porque el pooler corre en modo transacción.
- **Verificar el criterio 2 tiene una trampa que ya está desactivada**: agrupar
  `tienda-demo` con `tienda-dos` convertiría `/tienda-demo` en selector y
  rompería el criterio 3 de F-004, el humo de F-010 y la medición del
  presupuesto. La etapa 1 sembró **dos tiendas dedicadas** a esto, y la regla de
  que el seed no reescriba `slug` ni `storefrontId` evita que `npm run seed`
  deshaga la agrupación.
- **El selector no pagina.** A 50 sucursales el HTML ronda los 30 KB; a 200 hay
  que limitarlo. Hoy son tres tiendas: queda anotado, no arreglado.
- **La única isla nueva** es el aviso del carrito, en ruta dinámica. Y como el
  presupuesto de JavaScript ya no es un muro (`AGENTS.md`), si la pantalla queda
  mejor con algo más de cliente, se hace y se mide — lo que no se hace es
  degradar la pantalla para salvar kilobytes.
- **Nada de migración y nada de contrato** en esta etapa.

## Coste

- **Ciclos de agente**: 1 de implementación —los pasos 3, 5 y 7 son los caros—,
  1 de pruebas y verificación, más los reintentos del sensor.
- **Se toca de lo que ya funciona**: `/[slug]` (pasa a modo doble), la
  autorización y las mutaciones del panel de F-011, el hub, y el sitemap y el
  pre-render, que la etapa 1 ya dejó preparados para esto. El criterio 1 de F-011
  hay que volver a verlo verde por HS12.
- **Marcha atrás**: todo es código nuevo o ramas nuevas en archivos existentes;
  `git revert` y no hay datos que deshacer — salvo una agrupación ya hecha, que
  se revierte a mano en la base porque el producto no ofrece desagrupar.

## Preguntas antes de aprobar

Ninguna. Las doce decisiones que sostienen el feature —HS1 a HS12— están
tomadas y escritas en `.agent/progress/F-017.md`, incluidas las tres que
resolviste sobre esta etapa: **HS10** (al agrupar, la URL de la marca principal
pasa a selector), **HS11** (el aviso habla solo del carrito de la sucursal que se
deja) y **HS12** (la tarjeta «Tu marca» nombra las hermanas por nombre y ciudad,
sin `storeId`).

Una cosa que decidí yo y que señalo para que tengas el veto: al revertir HS11, el
diseñador **no** volvió al texto literal anterior, porque ese texto enumeraba la
otra sucursal con su conteo — justo lo que la reversión prohíbe. Lo reescribió
para cubrir los mismos casos sin contar nada ajeno, y la frase «cada sucursal
guarda el suyo» pasó a estar siempre y servida desde el HTML. Lo aprobé: cumple
tu decisión y dice la verdad.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-017 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-27T02:30:16Z — aprobado por el humano: «Ok» (**etapa 1**)

- 2026-08-27T04:01:32Z — aprobado por el humano: «comitea etapa 1, abre PR y despues comienza con la etapa 2»
