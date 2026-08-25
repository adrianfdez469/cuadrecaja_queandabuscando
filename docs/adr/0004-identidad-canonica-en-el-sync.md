# 0004 — La identidad canónica se resuelve al ingerir

**Aceptada** · 2026-08-25

## Contexto

El marketplace necesita saber que el «Refresco de cola 1.5 L» de una tienda y la
«Coca-Cola 1.5L» de otra son el mismo producto. Se podría resolver después,
cuando el marketplace se construya.

## Decisión

Resolverlo en el momento del sync, con tres modelos: `CanonicalProduct`
(identidad compartida), `ProductAlias` (cómo lo llama cada negocio) y
`StoreProduct` (la oferta concreta).

## Por qué

Hacerlo después obliga a reprocesar el catálogo entero. Hacerlo al ingerir
cuesta una query por evento y deja el marketplace a un paso.

## El algoritmo, y su tercera rama

1. `canonicalProductId` presente → usarlo.
2. Ausente pero con GTIN válido (8/12/13/14 dígitos) → buscar o crear por EAN.
3. Ninguno → crear un canónico **huérfano** con `isExclusive: true`.

La tercera rama es el punto. Un producto sin identidad resuelta **igual se
publica** en su propia tienda, con su nombre local, y solo queda fuera del
marketplace. Nunca hay un producto que no se pueda publicar.

Un código que no es un GTIN (por ejemplo uno interno de 5 dígitos) se trata como
ausente, no como identidad: confiar en él fusionaría productos no relacionados
de negocios distintos en un mismo canónico.

## Trampa

Un alias nuevo invalida el `searchDocument` del canónico. Olvidar recalcularlo
degrada la búsqueda **en silencio**, así que está implementado como efecto
explícito del handler y no como responsabilidad de quien lo llama.
