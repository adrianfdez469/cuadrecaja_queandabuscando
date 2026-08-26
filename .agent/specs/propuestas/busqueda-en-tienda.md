---
propuesta: busqueda-en-tienda
agente: sdd-spec
actualizado: 2026-08-26T02:01:34Z
estado: propuesta
---

> Origen: revisión de arquitectura del 2026-08-25.

## Problema

El comprador dentro de una tienda no puede buscar. F-015 existe pero es **otra
cosa**: búsqueda del marketplace sobre `CanonicalProduct`. Lo que falta es buscar
dentro de un `storeId`, que es el uso diario y el que hoy no tiene ni feature ni
índice.

Y los datos que más ayudarían a esa búsqueda están fuera del documento indexado:
`StoreProduct.description` y `StoreProduct.localName` —lo que escribe el
comerciante— no entran en `CanonicalProduct.searchDocument`.

El resultado esperado no es coincidencia exacta. Para «Refresco coca-cola 1.5 LT»
se quiere ese producto primero, después otros formatos de coca-cola, después otros
refrescos, y muy al final «Cola-loca». Eso son tres capas, no una técnica.

## Alcance

### Dentro

- Documento de búsqueda por `StoreProduct` (nombre local + alias + descripción).
- Ranking en tres capas: léxica ponderada (`tsvector` español + `unaccent`),
  difusa (`pg_trgm`) y expansión por `GlobalCategory`.
- Registro de cada consulta con su número de resultados.
- Página de resultados dentro de la tienda.

### Fuera (explícito)

- **pgvector / embeddings.** Ver abajo.
- El buscador del marketplace: sigue siendo F-015.
- Búsqueda por cercanía: sigue siendo ADR 0011.
- Filtros por facetas y ordenaciones. Otro feature.

## Actores y precondiciones

El comprador, sin cuenta. Precondición: `unaccent` y `pg_trgm` instalados (ya lo
están desde F-002) y productos con categoría global asignada para que la tercera
capa aporte algo.

## Comportamiento esperado

- **E1** — Dada la consulta exacta del nombre de un producto de la tienda, ese
  producto sale **primero**.
- **E2** — Dada la misma consulta, otros productos de su misma categoría global
  aparecen después, no ausentes.
- **E3** — Dada una consulta con acentos o sin ellos, el resultado es el mismo.
- **E4** — Dada una consulta con un error de tecleo («cocacola»), el producto
  aparece igual.
- **E5** — Dada una consulta sin ninguna coincidencia, se registra con cero
  resultados.
- **E6** — Un producto `visible: false` u `OUT_OF_STOCK` respeta las mismas reglas
  que ya aplica el catálogo.
- **E7** — La búsqueda solo devuelve productos de **esa** tienda.

## Reglas de negocio

- **R1** — El orden es: coincidencia léxica, luego difusa, luego misma categoría.
- **R2** — El documento incluye nombre local, alias y descripción del comerciante.
- **R3** — Cambiar la descripción o el alias **recalcula** el documento. Olvidarlo
  degrada la búsqueda en silencio; es el mismo riesgo que ya nombra [ADR 0004].
- **R4** — Toda consulta se registra con su número de resultados.
- **R5** — La búsqueda nunca cruza tiendas.

## Casos límite y errores

- Consulta vacía o de un solo carácter.
- Consulta muy larga; límite de tamaño.
- Tienda sin productos categorizados: la tercera capa queda vacía y no debe
  romper el orden.
- Caracteres que rompen `websearch_to_tsquery`.
- Producto sin descripción ni alias.

## Datos y contrato

No toca el contrato con cuadrecaja: el documento se construye con datos que ya
están. La descripción es propiedad del panel y el sync no la pisa ([ADR 0007]),
así que recalcular el documento es un efecto del **panel**, no del sync.

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. Buscar el nombre exacto de un producto lo devuelve en la posición 1.
2. Esa misma búsqueda devuelve además ≥1 producto de la misma categoría global.
3. «refresco» y «refrescó» dan el mismo conjunto de resultados.
4. Una consulta con un carácter cambiado devuelve el producto.
5. Buscar desde la tienda A nunca devuelve un producto de la tienda B.
6. Tras editar la descripción de un producto, buscar por una palabra nueva de esa
   descripción lo encuentra.
7. Una consulta sin resultados deja una fila registrada con `0`.
8. `EXPLAIN` de la consulta usa los índices y no hace _seq scan_ del catálogo.
9. `bash .agent/verify.sh <id> --full` termina en 0.

## Incongruencias detectadas

- `prisma/schema.prisma`: `StoreProduct` **no tiene** `searchVector`; el único
  índice de búsqueda está en `CanonicalProduct` (`searchVector` GIN y
  `name gin_trgm_ops`).
- `CanonicalProduct.searchDocument` es «nombre + alias»: deja fuera la descripción
  del comerciante, que es justo el texto añadido para mejorar la búsqueda.
- F-015 describe el buscador del marketplace, no este. Son dos features.

## Huecos y preguntas al humano

- **SP1** — ¿Búsqueda vectorial? Recomendación: **no ahora**. Cuesta una llamada a
  API por producto y por alias nuevo, el índice HNSW consume memoria, hay que
  fusionarla con la léxica (RRF) y afinar esa fusión es trabajo real. Para el
  ejemplo de la coca-cola, la expansión por categoría le gana. Reabrir **con
  datos**: si el registro de consultas muestra que las de cero resultados son
  mayoritariamente fallos semánticos, entonces sí — y ADR 0001 ya dejó el sitio
  (pgmq para la cola de embeddings).
- **SP2** — ¿La búsqueda es una página o filtra en la actual? Afecta al
  presupuesto de JavaScript (F-013 y la prohibición de `"use client"` en el
  catálogo). Recomendación: página propia, renderizada en servidor.

## No decidido a propósito

Los pesos exactos de cada capa. Se afinan con el registro de consultas, no antes.
