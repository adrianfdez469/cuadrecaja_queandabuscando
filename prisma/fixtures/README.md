# Fixtures de imágenes del seed

## `producto-demo.jpg` (F-023, AP2)

Necesaria para que el criterio 3 (presupuesto de peso de imágenes) mida algo
real: una foto sintética o un color plano comprime a casi nada en AVIF y
dejaría la medición pasando en verde sin comprobar nada (I5 de
`.agent/specs/F-023/spec.md`).

- **Fuente**: Wikimedia Commons, [`Detergents-department-ramat-gan-supermarket-october-2015.jpg`](https://commons.wikimedia.org/wiki/File:Detergents-department-ramat-gan-supermarket-october-2015.jpg)
- **Autor**: [Rakoon](https://commons.wikimedia.org/wiki/User:Rakoon)
- **Licencia**: [CC0 1.0 Universal](http://creativecommons.org/publicdomain/zero/1.0/deed.en)
  (dominio público — no exige atribución; se deja igual, por cortesía)
- **Original**: 2592×1456, ~1,4 MB
- **Este archivo**: redimensionado a 1600 px de ancho y recomprimido a JPEG
  calidad 82 (~290 KB) — sigue siendo una fotografía real de un pasillo de
  supermercado, muy por encima de los 1200 px mínimos que architecture.md
  exige para que la siembra (`prisma/seed.ts`) tenga algo representativo que
  codificar en las cuatro variantes de F-023.

Se sube el mismo juego de variantes codificado UNA vez a los 15 productos de
`tienda-demo` (`prisma/seed.ts`, `seedProductImages`) — no una foto distinta
por producto: lo que importa para el criterio 3 es el peso agregado de un
catálogo real, no la variedad visual.
