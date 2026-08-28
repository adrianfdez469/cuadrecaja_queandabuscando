# 0020 — Todos los códigos de barras se guardan; la fusión sigue usando uno

**Aceptada** · 28 de agosto de 2026 · F-024

Extiende [ADR 0004](0004-identidad-canonica-en-el-sync.md) sin superarla: sus
tres ramas siguen siendo el algoritmo. Lo que esta ADR añade es **qué se hace
con los códigos que no resolvieron la identidad**.

## Contexto

En cuadrecaja los códigos de barras de un producto son una **tabla**
(`CodigoProducto`), no un campo. El contrato v3 recibía `barcode` en singular y
lo mapeaba contra `CodigoProducto.codigo`: de N códigos llegaba uno, **nadie
elegía cuál**, y los demás se perdían sin registro. No era una mejora
pendiente, era una pérdida de datos en curso, y hacía invisible el escenario
que motivó el feature: un negocio que asocia tres códigos a un genérico
(«Refresco de pomo») mientras otros usan cada código para un producto distinto.

Hay una propuesta más grande —`.agent/specs/propuestas/canonico-fusionado-por-ean-sucio.md`—
que quiere un grafo de canónicos con nodos concentradores. No se puede decidir
sin saber cuántas veces ocurre de verdad, y no se puede medir sin guardar los
códigos primero.

## Decisión

**(a) El contrato v4 recibe la lista completa.** `barcodes: string[]`,
obligatoria, `[]` cuando el producto no tiene ninguno. La clave singular no se
ignora: su presencia es `400 INVALID_BATCH` del lote entero. Es un corte, no una
adición, por el mismo motivo que lo fue la v3 en autenticación: en cuadrecaja no
hay nada desarrollado de esta integración, así que no hay consumidor vivo al que
migrar sin cortar.

**(b) Todos los códigos válidos se guardan, en una tabla nueva.**
`CanonicalBarcode(canonicalProductId, ean)`, única por pareja, con índice por
`ean`. Aditiva: se insertan los que falten y **no se borra ninguno**, tampoco
los que el POS deja de enviar.

**(c) La fusión no cambia.** `CanonicalProduct.ean` sigue siendo `@unique` y
sigue siendo lo único que fusiona. Cuando no viene `canonicalProductId`, la
identidad se resuelve por **un solo** código: el **menor en orden lexicográfico
de cadenas** entre los válidos. Guardar N códigos y fusionar por uno son
decisiones separadas a propósito.

**(d) `CanonicalBarcode` no lleva `businessId`.** La pregunta que hay que
responder —«¿ocurre el escenario en datos reales?»— se contesta con el JOIN que
ya existe: `CanonicalProduct` → `StoreProduct` → `Store.businessId`.

## Por qué

Elegir el menor y no «el primero que llegue» es lo que hace que reenviar la
misma lista en otro orden resuelva **el mismo** canónico. Sin eso, el orden de
entrega —que el resto del sync convirtió en irrelevante con
`sourceUpdatedAt`— volvería a decidir la identidad de un producto.

Aditivo y sin atribución van juntos: el canónico es compartido entre negocios y
una fila no dice quién aportó el código, así que borrar «los códigos que este
negocio ya no envía» borraría el aporte de otro. Mientras no haya atribución, no
se puede limpiar bien; y no hay atribución porque hoy nadie necesita el dato.

## Consecuencia aceptada

Un mismo `ean` puede aparecer en **dos canónicos distintos**: si un canónico X
tiene los códigos cod1 (su `ean`) y cod2, y otro negocio envía un producto cuyo
único código es cod2, nace un canónico Y con `ean = cod2`. Eso no es un bug: es
exactamente el dato que hay que medir, y un `@unique` global sobre
`CanonicalBarcode.ean` lo destruiría. Relacionar X con Y es el grafo, y el grafo
espera el número.

## Qué reabre esto, y cuándo

El ejecutable de medición de F-024 (scripts/count-canonical-barcodes.ts)
responde cuántos canónicos tienen más de un código y cuántos tienen ofertas
vivas de más de un negocio. Con ese número en
la mano se decide, en otro feature: los nodos concentradores, las aristas entre
canónicos, el tope de grado, y si hace falta una columna que atribuya cada
código a quien lo aportó. Ninguna de las cuatro se decide aquí.

## Alternativas descartadas

- **Fusionar por «comparte cualquier código»** — es la propuesta grande sin el
  número que la justifique, y rompería lo que F-002 y F-015 verificaron.
- **Quitar `@unique` de `CanonicalProduct.ean`** — lo pide la propuesta del
  grafo, no este feature; los criterios de F-024 exigen lo contrario.
- **Guardar los códigos en `searchDocument`** — buscar por código de barras es
  otro feature, y meterlos ahí ensuciaría el ranking de la búsqueda por texto.
- **Un tope al tamaño de la lista** — convertiría un dato que el POS no puede
  cambiar en un `400` permanente del lote entero.
