---
feature: F-040
agente: orquestador
actualizado: 2026-09-10T18:41:17Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Una tienda que no puede ponerle precio a **nada** dejará de mostrar un catálogo
vacío sin explicación: dirá, en las siete páginas públicas, que no puede mostrar
sus precios y que por eso no está tomando pedidos, reusando la misma
presentación que ya tiene una tienda cerrada.

No cambia nada para las demás tiendas: una a la que solo le fallan **algunos**
precios sigue enseñando su catálogo con los que sí, y una tienda publicada y
vacía sigue enseñando su catálogo vacío, que es un estado legítimo. No se
escribe ninguna columna, no se añade ninguna consulta, no se añade ningún
JavaScript y el panel del comerciante no se toca.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                  | Archivos                                                                                                                                             | Criterio que acerca | Cómo se verifica                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `tryResolvePrice`: UNA definición de «este producto no tiene precio», y los tres `try/catch` que hoy la duplican pasan a llamarla. `src/features/orders/` se queda fuera a propósito.        | `src/lib/pricing.ts`, `src/components/store/ProductCard.tsx`, `src/features/catalog/catalogFilters.ts`, `src/app/[slug]/p/[productSlug]/page.tsx`    | (base de 1 y 2)     | `bash .agent/verify.sh F-040` en 0, y las pruebas de F-039 siguen verdes sin tocarlas                         |
| 2   | El predicado puro `isCatalogUnpriced` (R1–R3: hay productos **y** ninguno resuelve precio) y la terna de props `UNPRICED_CATALOG_CLOSURE`, con su prueba unitaria sin base de datos.         | src/features/catalog/unpricedCatalog.ts (por crear), src/features/catalog/unpricedCatalog.test.ts (por crear)                                        | 1, 2, 3             | `npm test` — casos: tienda vacía → `false`, alguno con precio → `false`, ninguno → `true`, promoción sin tasa |
| 3   | El código interno `PRICES_UNAVAILABLE`, **fuera** de la lista que ofrece el panel, y su frase en `resolveStoreClosureHeadline`, más la línea de cierre y el mensaje de WhatsApp propios.     | `src/constants/storeClosure.ts`, `src/lib/storeClosure.ts`, `src/components/store/StoreClosedNotice.tsx`                                             | 1, 4, 7             | `npm test` sobre `src/lib/storeClosure.test.ts`, más un caso que afirme que el panel lo rechaza (E19)         |
| 4   | La puerta de servidor `getStoreCatalogPricing`: envoltorio fino sobre las dos lecturas cacheadas que ya existen, sin `keyParts` ni tags nuevos. Cuarta proyección de la familia de ADR 0025. | `src/features/catalog/server/queries.ts`                                                                                                             | 6                   | `npm run typecheck` y la prueba de que no estrena entrada de caché ni tag                                     |
| 5   | Las **cuatro** vistas de catálogo cambian sus dos entradas del `Promise.all` por la puerta y montan el aviso. `BranchBar` con `isOpen={false}`.                                              | `src/app/[slug]/page.tsx`, `src/app/[slug]/p/[productSlug]/page.tsx`, `src/app/[slug]/catalogo/page.tsx`, `src/app/[slug]/c/[categorySlug]/page.tsx` | 1, 6, 7             | `bash .agent/verify.sh F-040 --smoke` y las páginas servidas contra una tienda muda sembrada                  |
| 6   | Las **tres** vistas restantes estrenan la puerta. `/buscar` no busca ni registra la búsqueda; carrito y checkout no vacían nada.                                                             | `src/app/[slug]/buscar/page.tsx`, `src/app/[slug]/carrito/page.tsx`, `src/app/[slug]/checkout/page.tsx`                                              | 1                   | Las tres URL servidas contra la tienda muda; el carrito sigue en el navegador                                 |
| 7   | Las pruebas de los criterios que faltan: la fila intacta antes y después de visitar (4), el pedido que no da 500 (5), y el conteo de consultas en las cuatro vistas de catálogo (6).         | Pruebas bajo `src/features/catalog/` y `src/features/orders/` (por crear)                                                                            | 4, 5, 6             | `npm test`, más el conteo, cuyo procedimiento decide `tests.md`                                               |
| 8   | Cierre: el sensor entero.                                                                                                                                                                    | —                                                                                                                                                    | 8                   | `bash .agent/verify.sh F-040 --full` termina en 0                                                             |

## De dónde sale cada paso

| Paso | Línea que lo justifica                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` AD6, autorizado por R14 de `spec.md`                                                                |
| 2    | `architecture.md` AD1 y AD2; `spec.md` R1, R2, R3, R8; escenarios E2, E3, E16, E17, E18                               |
| 3    | `architecture.md` AD3 y AD8; `spec.md` R5, E19; `design.md` § Textos                                                  |
| 4    | `architecture.md` AD5; `spec.md` R9, E13; ADR 0025                                                                    |
| 5    | `architecture.md` AD7 (precedencia) y § Flujo de datos; `spec.md` E1, E4, E6, E7, E21; `design.md` § Las siete vistas |
| 6    | Decisión del humano SP3(a) y SP4; `architecture.md` AD9 y AD10; `spec.md` E8, E9                                      |
| 7    | `spec.md` E10, E11, E12, E13; `acceptance_criteria` 4, 5 y 6                                                          |
| 8    | `acceptance_criteria` 8                                                                                               |

## Qué queda fuera

- **El panel del comerciante.** Decisión del humano (SP1): no se entera por
  ningún camino nuestro de que su tienda está muda. Si se quiere, es un feature
  aparte que escribe él en `.agent/features.json`.
- **Arreglar la causa.** Es del negocio, no nuestra: falta una tasa. Lo declara
  fuera el propio feature.
- **Validar el código de moneda contra un catálogo de monedas reales.** Ídem.
- **Cambiar la respuesta del checkout.** Decisión del humano (SP2). Hoy
  `src/features/orders/server/createOrder.ts` corta con `items_unavailable`
  antes de tocar la cuota de domicilio y `buildRateSnapshot`, así que esos dos
  caminos son inalcanzables: el criterio 5 se **demuestra**, no se construye.
- **El selector de marca.** Decisión del humano (SP4): marcar ahí la sucursal
  muda obligaría a leer N catálogos por marca.
- **La cabecera del layout**, que seguirá siendo la de una tienda abierta —
  pendiente de PP2.
- **Una ADR.** ADR 0017 (a) y ADR 0025 cubren las dos mitades; el arquitecto lo
  argumenta y estoy de acuerdo.
- **Un contador de consultas en el arnés.** No existe y este feature no lo crea;
  el criterio 6 se cuenta con uno de los dos procedimientos de F-025.

## Riesgos y plan B

- **Sin migración, sin cambio de contrato, sin comando prohibido.** No se toca
  `prisma/schema.prisma`, no se toca `docs/sync-contract.md` y no hace falta ni
  `migrate reset` ni `db push`. Nada que aprobar de pasada.
- **El criterio 6 no tiene arnés.** Es el riesgo real de cierre: «contando las
  consultas de la petición» hoy se hace a mano. Si el procedimiento no es
  reproducible, el criterio se queda sin marcar y el feature no cierra. Plan B:
  el conteo de F-025 por el log de Prisma, que ya se ejecutó una vez en este
  repo y está escrito paso a paso.
- **El paso 1 toca código de F-039, que ya pasa.** Si sus pruebas se ponen
  rojas, el paso 1 se revierte solo y los pasos 2-8 siguen sin él: la
  unificación es una mejora, no un requisito de ningún criterio.
- **Sembrar la tienda muda.** Un negocio cuya base no tiene tasa es un estado
  que el repo no produce hoy por accidente. Si la siembra resulta cara, el plan
  B es una sucursal más de un negocio existente en lugar de un negocio nuevo.

## Coste

Tres ciclos de agente: implementador (pasos 1-6), probador (paso 7) y el cierre
del 8, más las vueltas que pida el sensor.

**Se toca de lo que ya funciona:** las siete páginas públicas (una guarda nueva
después de la que ya existe, sin tocarla), tres sitios que hoy atrapan el error
de precio, y `src/features/catalog/server/queries.ts`. La rama de tienda cerrada
de hoy no se modifica en ninguna de las siete.

**Marcha atrás:** cada paso es independiente y se revierte solo. Los pasos 2 y 3
solo añaden archivos y constantes; los 4-6 son sustituciones acotadas dentro de
un `Promise.all` y una guarda. No queda estado en la base que deshacer, porque
este feature **no escribe nada**.

## Preguntas antes de aprobar

**Las tres las contestó el humano el 2026-09-10, antes de firmar.** Ninguna
queda abierta.

### PP1 — la frase que lee el comprador · **CONTESTADA: F1**

> Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando
> pedidos.

Es la misma cadena en las siete vistas, sin excepción: es lo que exigen el
criterio 7 y E4, y lo que permite que las pruebas la busquen tal cual en el
HTML. Descartadas F2 («Esta tienda no está tomando pedidos ahora mismo.»), que
no explica nada y es casi indistinguible de la rama que ya existe, y F3, que se
desborda a dos líneas en tableta.

### PP2 — la cabecera de una tienda muda · **CONTESTADA: (a), se deja como está**

El layout sigue tratándola como abierta —nombre enlazado, `CartBadge` y la fila
«Cobramos en {MONEDA}» de F-039— porque nada de eso es falso y porque tratarla
como cerrada obligaría a leer el catálogo en **todas** las rutas de `/[slug]`,
incluidas `/sucursales` y `/pedido/[code]`, que están fuera del alcance. La
contradicción queda anotada en `design.md` para que nadie la descubra en
producción creyéndola un fallo.

### PP3 — el mensaje de WhatsApp · **CONTESTADA: (a), se cambia**

En la rama del código nuevo, y **solo** en ella:

> Hola {tienda}, vi su tienda online pero no me aparecen los precios. ¿Me los
> pueden decir?

El de una tienda cerrada no se toca. El texto del botón tampoco cambia. Con el
panel fuera (SP1), un cliente escribiendo es el único camino por el que el
comerciante puede enterarse de que su tienda está muda.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-040 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-10T18:41:17Z — aprobado por el humano: «Apruebo tal cual. PP1: F1. PP2: dejarlo. PP3: cambiarlo.»
