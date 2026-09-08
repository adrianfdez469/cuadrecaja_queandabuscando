---
feature: F-039
agente: orquestador
actualizado: 2026-09-08T12:24:27Z
estado: listo
aprobado: sí
---

## Qué se va a construir

El comprador verá el precio en la moneda en la que se le va a cobrar y, al lado,
lo que eso vale en la moneda que él elija de entre las que el negocio declaró —
marcado como aproximado, porque lo es. La elección se hace una vez, en la
cabecera de la tienda, y le acompaña por el catálogo, la ficha del producto, el
carrito y el checkout, también la próxima vez que vuelva.

Lo que **no** cambia: lo que se cobra. El importe en la moneda base sigue siendo
el principal, el que viaja al carrito y el que compara el checkout antes de
crear el pedido. Una tienda cuyo negocio no declara ninguna moneda extra se
sirve exactamente igual que hoy, byte por byte.

## Pasos

Diez pasos en el orden en que se ejecutan. Los pasos 1 y 2 no dependen de nada;
del 3 en adelante cada uno se apoya en los anteriores. Cada paso termina con el
sensor en verde antes de empezar el siguiente.

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                | Archivos                                                                                                                                                                                                                                                                                                                                                                                           | Criterio que acerca    | Cómo se verifica                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **La aritmética, sola y sin interfaz.** Las tres funciones puras de AD1 —`priceEquivalents`, `equivalentCurrencies` y `selectableCurrencies`— y las constantes compartidas: el patrón del código de moneda, la clave de `localStorage`, el centinela y los nombres de los cuatro atributos | src/lib/priceEquivalents.ts (por crear), src/lib/priceEquivalents.test.ts (por crear), src/constants/currency.ts (por crear), y `src/features/sync/displayCurrencies.ts` que pasa a importar el patrón en vez de declararlo                                                                                                                                                                        | 4, 5, 7                | `bash .agent/verify.sh F-039` en 0. El caso del criterio 7 es unitario: base MLC, producto USD, equivalente EUR, y **no** coincide con el cociente directo |
| 2   | **El memo de los formateadores** (AD6): un `Intl.NumberFormat` por (locale, moneda, dígitos), con tope de 64 entradas y la rama de respaldo memoizada también                                                                                                                              | `src/lib/money.ts`, `src/lib/money.test.ts`                                                                                                                                                                                                                                                                                                                                                        | 10 (el coste que mide) | `bash .agent/verify.sh F-039` en 0, con el test que afirma **una** construcción en 100 llamadas y que la salida no cambia ni un carácter                   |
| 3   | **La lectura del dato**: la línea 139 del `select` gana una columna, `StoreSummary` gana el campo y `getStoreBySlug` tolera una entrada de caché escrita con la forma vieja (AD5, AD10)                                                                                                    | `src/features/catalog/server/queries.ts`                                                                                                                                                                                                                                                                                                                                                           | 1 (lo hace posible)    | `bash .agent/verify.sh F-039` en 0. Y **cero consultas nuevas**: es una columna de un `findUnique` que ya se hacía                                         |
| 4   | **El mecanismo y el selector** (AD4, AD9, DH2): el generador de las N+1 reglas de CSS, el guion de arranque de 377 bytes, el estado de cliente sobre `localStorage`, el `<select>` de la sub-barra, y `suppressHydrationWarning` en el `<html>`                                            | src/features/currency/reveal.ts (por crear), src/features/currency/referenceCurrencyStore.ts (por crear), src/features/currency/components/ReferenceCurrencySelect.tsx (por crear), sus tres pruebas (por crear), `src/app/[slug]/layout.tsx`, `src/app/layout.tsx`                                                                                                                                | 3, 9                   | `bash .agent/verify.sh F-039` en 0, con las **cinco ramas** del guion ejercitadas una a una en jsdom                                                       |
| 5   | **Las dos superficies del catálogo**: la tarjeta pinta los equivalentes con `data-equiv` y sigue siendo componente de servidor; la ficha hace lo mismo con su importe grande                                                                                                               | `src/components/store/ProductCard.tsx`, src/components/store/ProductCard.test.tsx (por crear, la primera prueba de este componente), `src/app/[slug]/p/[productSlug]/page.tsx`                                                                                                                                                                                                                     | 1, 2, 4, 9             | `bash .agent/verify.sh F-039` en 0. El nombre accesible del equivalente oculto **no** se anuncia                                                           |
| 6   | **Carrito y checkout** (DH3, DH8, AD3): la cotización publica las tasas y la lista, y las dos pantallas pintan el equivalente del agregado con el aviso del cobro. `expectedTotal` **no se toca**                                                                                          | `src/features/orders/server/quote.ts`, `src/features/orders/types.ts`, `src/features/cart/components/CartView.tsx`, src/features/cart/components/CartView.test.tsx (por crear), `src/features/cart/components/CheckoutForm.tsx`, `src/features/cart/components/OrderSummary.tsx`, y los tres fabricantes de `quote()` de las pruebas que el tipo nuevo rompe a propósito                           | 6                      | `bash .agent/verify.sh F-039` en 0, con el aserto de que el `expectedTotal` que sale al `POST /api/orders` es **idéntico** al de hoy                       |
| 7   | **La invalidación que F-038 dejó a deber** (R18, AD7, AD8): `outcomeOf` se muda a los tipos de los handlers, `handleBusiness` gana el cuarto parámetro y el `case "BUSINESS"` reenvía el memo del lote                                                                                     | `src/features/sync/server/handlers/types.ts`, `src/features/sync/server/handlers/business.ts`, `src/features/sync/server/processBatch.ts`, `src/features/sync/server/handlers/business.test.ts`, `src/features/sync/server/processBatch.test.ts`, `src/features/sync/server/processBatch.invalidationCount.test.ts`, src/features/sync/server/handlers/businessInvalidation.db.test.ts (por crear) | 8                      | `bash .agent/verify.sh F-039` en 0, contando: un lote con dos `BUSINESS` del mismo negocio hace **una** consulta de sucursales                             |
| 8   | **La ADR 0031**, «La preferencia del visitante no entra en el HTML»: la decisión reutilizable para el próximo selector —zona, idioma, sucursal favorita—, con su alternativa descartada                                                                                                    | docs/adr/0031-la-preferencia-del-visitante-no-entra-en-el-html.md (por crear)                                                                                                                                                                                                                                                                                                                      | —                      | `npm run check:harness` verde y `npm run format:check` en 0                                                                                                |
| 9   | **Medir y dejarlo escrito**: `npm run check:bundle` antes y después, la cifra al progreso, y el guion de humo que comprueba lo que solo se ve con la app levantada                                                                                                                         | .agent/specs/F-039/smoke.sh (por crear), `.agent/progress/F-039.md`                                                                                                                                                                                                                                                                                                                                | 2, 3, 6, 8, 9, 10      | `bash .agent/verify.sh F-039 --smoke`, y dos peticiones con `Cookie` y `Accept-Language` distintos que devuelven el **mismo** cuerpo                       |
| 10  | **El veredicto**: `sdd-tester` recorre los once criterios, ejecutando, y dice listo o no listo por criterio                                                                                                                                                                                | `.agent/specs/F-039/tests.md`, y las pruebas que él añada                                                                                                                                                                                                                                                                                                                                          | 11                     | `bash .agent/verify.sh F-039 --full` termina en 0                                                                                                          |

## De dónde sale cada paso

| Paso | Sale de                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | `spec.md` R7 («un solo sitio calcula los equivalentes»), R23 (DH5) y R5; `architecture.md` AD1 y AD2                 |
| 2    | `architecture.md` AD6; `spec.md` R21; `design.md` § Coste de cliente (12,2 ms → 1,4 ms con 40 monedas y 24 tarjetas) |
| 3    | `architecture.md` AD5 y AD10; `spec.md` R22                                                                          |
| 4    | `architecture.md` AD4 y AD9; `spec.md` R11, R12, R13, R15 y R17; `design.md` § El selector y D4/D5; DH2 y DH4/SP1(a) |
| 5    | `spec.md` R2, R3, R8 y R16; `design.md` § Componentes de UI y D1/D2; DH1                                             |
| 6    | DH3 (la superficie) y DH8 (la tabla entera); `architecture.md` AD3; `spec.md` R12 § excepción acotada                |
| 7    | `spec.md` R18 y R19; `architecture.md` AD7 y AD8; la deuda I7/D4 de `.agent/specs/F-038/impl.md`                     |
| 8    | `architecture.md` § «¿Hace falta una ADR?», que dejó el borrador escrito                                             |
| 9    | El criterio 10 de `.agent/features.json`; `spec.md` R21; `architecture.md` § Pruebas, última fila                    |
| 10   | El criterio 11 de `.agent/features.json`; `.agent/README.md` § «Al completar un feature»                             |

Ningún paso sale de una decisión mía sin documento detrás. Los dos que más se
parecen a alcance añadido —el 6 y el 8— tienen dueño: el 6 es tu DH3, y el 8 lo
propuso la arquitectura con el número y el título ya elegidos.

## Qué queda fuera

1. **Convertir en el cliente con aritmética propia.** La conversión la hace
   `convert` (`src/lib/money.ts:141`) y nada más. Llamar a esa función desde
   carrito y checkout no es reimplementarla; escribir una segunda división en
   JavaScript sí, y no se hace.
2. **Un endpoint público de tasas.** Lo prohíbe el contrato en la misma sección
   que concede la lista.
3. **Cambiar lo que se cobra.** Ni el importe, ni la moneda, ni
   `expectedTotal`, ni lo que se guarda en el pedido.
4. **La página del pedido y la cuenta.** Ahí el importe es histórico: convertirlo
   con la tasa de hoy enseñaría un número que nunca fue cierto. El selector se
   verá en esa página porque vive en la cabecera, y no convertirá nada.
5. **El precio tachado y los chips de rango de precio** (tu DH4/SP3).
6. **Filtrar, ordenar o paginar por la moneda de referencia.** Los filtros de
   F-027 siguen operando sobre la moneda base, y `precio_min`/`precio_max` de la
   URL siguen expresados en ella. Que `src/features/catalog/catalogFilters.ts`
   **no cambie** es lo que verifica el criterio 16 de la spec.
7. **Tocar `docs/sync-contract.md`.** La v12/v12.1 ya publicó la regla que este
   feature implementa. No hay versión nueva ni nada que coordinar con el otro
   equipo.
8. **Podar la lista guardada.** DH5 quita la moneda sin tasa del **selector**;
   `Business.displayCurrencies` se queda tal como el POS la mandó, y por eso la
   moneda aparece sola cuando llega su tasa.
9. **Un tope de monedas por tarjeta.** Se mide y se anota (tu DH4/SP2); si la
   cifra molesta, el tope es un feature nuevo tuyo.
10. **Subir `BUDGET_KB` a ciegas.** La estimación es +0,6 a 1,0 KB gzip sobre
    182,1 medidos, con el presupuesto en 193: no hace falta tocarlo. Si la
    medición real dijera otra cosa, se sube con la cifra en el comentario, nunca
    en silencio.

Y una nota sobre el paso 6, porque es la única parte del plan que no nace de un
`acceptance_criteria`: pintar el equivalente en **carrito y checkout** es tu
DH3, superficie por encima de los once criterios. Si al leer el plan preferís
dejarlo para otro ciclo, quítalo al firmar («ok, pero sin el paso 6») y el
feature sigue cerrando: ningún criterio lo exige.

## Riesgos y plan B

**No hay migración de datos, no hay cambio de contrato y no hay ningún comando
prohibido.** Las dos columnas que este feature lee ya existen desde F-038, y
`prisma/schema.prisma` no se toca: nada de `prisma migrate reset` ni de
`prisma db push`.

| Riesgo                                                                                                                                                                                                                        | Cómo se notaría                                                                                                                                                                                  | Qué se hace                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Otra sesión tiene este árbol.** Hay trabajo en curso de F-041 sobre `.agent/features.json` y la propuesta de zonas. El sensor es del repo entero, así que dos implementadores a la vez hacen que un fallo no sea atribuible | Ya pasó tres veces en la fase de planificación: `verify.sh --only format` señalando archivos ajenos a medio escribir, y una de ellas llegó a `2` (ESTANCADO) sin que nada nuestro estuviera roto | Es la pregunta **PP1**. Si se implementa ya, el implementador comprueba **de qué archivo** se queja el sensor antes de tocar nada y nunca formatea prosa ajena                  |
| **El destello.** Si la reducción de N equivalentes a uno ocurriera después del primer pintado, la página salta: 218 px con tres monedas, 4 058 px (57 %) con cuarenta                                                         | Se ve a ojo en la primera carga, y el diseño lo midió                                                                                                                                            | El guion va como primer hijo, antes de que exista una sola tarjeta. Si en algún caso no se pudiera, la regla escrita es **dejar todos visibles esa carga**, nunca reducir tarde |
| **`suppressHydrationWarning` en el `<html>`** afecta a toda la app, no solo a la tienda: un desajuste futuro de atributos de ese elemento dejaría de avisar en desarrollo                                                     | No se notaría — es justo el problema                                                                                                                                                             | Decidido (DO1/AP1a) porque la alternativa es peor: React imprime el aviso con `console.error` y eso pone roja una etapa entera del sensor. Es una línea, reversible             |
| **Entradas de caché con la forma vieja de `StoreSummary`** tras desplegar                                                                                                                                                     | Solo en producción, solo en la portada, y el compilador **no** puede avisar                                                                                                                      | AD10: se resuelve con un tipo en el borde de lectura, no con un `??` defensivo que alguien borre en un aseo                                                                     |
| **Los tipos nuevos rompen pruebas que hoy pasan** (tres fabricantes de `quote()` y el `describe` de `toQuoteResponse`)                                                                                                        | Rojo en typecheck en el paso 6                                                                                                                                                                   | Es a propósito: obligatorios y no opcionales, para que ninguna pantalla se quede sin equivalentes en silencio. El plan lo ordena en vez de descubrirlo                          |
| **Marcha atrás a mitad**                                                                                                                                                                                                      | —                                                                                                                                                                                                | Los pasos 1, 2 y 8 son aditivos y se pueden quedar sin que nada los use. Del 3 al 7 se revierten por pasos, en orden inverso, y el `git revert` de cada uno es independiente    |

## Coste

Cuatro o cinco ciclos de `sdd-implementer` (los pasos 1-2, 3-5, 6, 7-8 agrupan
bien) y uno o dos de `sdd-tester`, más el paso 9, que es medir y escribir.

**De lo que ya funciona se toca:** la lectura cacheada de la tienda (una
columna), la tarjeta de producto y la ficha (pintan más), la cotización (publica
dos campos más), el carrito y el checkout (un importe más y un aviso), el
handler de `BUSINESS` (un parámetro) y el reparto del lote (una línea). **No se
toca:** el proxy, los filtros y el orden de F-027, el esquema de la base, el
contrato, lo que se cobra y lo que se guarda en un pedido.

**Marcha atrás:** revertir los pasos 3 al 7 en orden inverso devuelve la tienda
a lo de hoy sin dejar rastro en la base de datos, porque este feature no escribe
ninguna columna nueva. Lo único que sobreviviría es una preferencia guardada en
el navegador de algún visitante, que sin el CSS que la usa no hace nada.

## Preguntas antes de aprobar

**PP1 — ¿se implementa ya, o se espera a que la otra sesión suelte el árbol?**
Hay trabajo de F-041 en curso en este mismo worktree. Planificar en paralelo no
molesta —solo se escriben documentos—, pero programar sí: cada etapa del sensor
corre sobre el repo entero, así que el archivo a medio escribir de un
implementador pone en rojo la verificación del otro y el fallo deja de ser
atribuible; y si los dos fueran del mismo feature, además se pisarían el
historial que cuenta las rachas de error. Opciones: **(a)** esperar a que ese
trabajo cierre —lo que recomiendo si va a ser hoy—; **(b)** implementar ya y
asumir que habrá que leer con lupa de qué archivo se queja el sensor cada vez;
**(c)** mover F-039 a un worktree propio, que es lo limpio pero cuesta preparar
otro entorno y los emuladores de Docker son compartidos.
**Recomendación: (a)**, y si el otro trabajo va para largo, (c) antes que (b).

> **RESUELTA por el humano el 2026-09-08**, y no con ninguna de las tres
> opciones tal cual: «Implementa, le dije a la otra sesion que esperara por ti».
> Es la (b) sin su inconveniente — el árbol queda para F-039 porque la otra
> sesión se aparta, no porque asumamos el ruido. Lo que eso obliga a este lado:
> el implementador da por suyo el sensor, así que un fallo **sí** es atribuible
> y no se justifica con «será de la otra sesión»; y si aun así el sensor señala
> un archivo de F-041, se lee de qué archivo habla y **no se formatea prosa
> ajena** (ficha `.agent/playbook/prettier-write-reescribe-prosa-ajena.md`).

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-039 '<lo que dijo el humano>'`. -->

- 2026-09-08T12:24:27Z — aprobado por el humano: «Aprobado tal cual. Implementa, le dije a la otra sesion que esperara por ti.»
