# 0012 — Una marca con N sucursales: `Storefront` por encima de `Store`

**Aceptada** · 2026-08-25

## Contexto

`Store` es el espejo de una `Tienda` de cuadrecaja y hoy es también lo que
resuelve `/[slug]`. Eso ata la tienda virtual a exactamente un local físico, que
es lo correcto para el precio, el stock y el pedido —los tres tienen que
resolverse contra un local y solo uno—, pero deja sin respuesta al negocio que ya
tiene varias sucursales: recibe varias URL, varios QR y una marca partida.

También apareció la duda de si una tienda virtual podría salir de un **almacén**.

## Decisión

Dos cosas.

**Un almacén nunca es el origen de una tienda virtual.** En cuadrecaja los
precios viven en `ProductoTienda`; un almacén no tiene precio que leer ni venta
que registrar. Si el negocio quiere vender existencias de almacén, la respuesta
está dentro del POS: un traslado a la tienda. queandabuscando no aprende qué es
un almacén.

**Se introduce `Storefront` por encima de `Store`.** La marca posee el slug, el
branding y el contacto; la sucursal sigue poseyendo precios, stock y pedidos.

```
Storefront (marca, slug, branding)      ← el QR apunta aquí
   └── Store (precios, stock, pedidos)  ← 1..N sucursales
```

- Un `Storefront` con **una** sucursal renderiza directo, sin selector. El
  comerciante de un solo local no nota que la capa existe.
- Con **N**, `/[slug]` muestra el selector y las páginas viven en
  `/[slug]/[sucursal]`.
- `/[slug]` resuelve **primero `Storefront`, después `Store`**. Los slugs de
  tienda ya emitidos siguen funcionando para siempre.
- El carrito se namespacea **por sucursal**, no por marca.

Y un registro único de slugs: una tabla `Slug` donde conviven marcas, sucursales
y palabras reservadas.

## Por qué ahora y no cuando haga falta

El argumento no es técnico, es físico: **los QR se imprimen en papel y se pegan
en la pared.** Emitir hoy `/lacasa-vedado` y `/lacasa-playa` y querer mañana
`/lacasa` obliga a reimprimir. Es la única decisión de este rediseño que no se
revierte con una migración, y ya hay negocios con varias sucursales.

Lo que **no** se hace es inventario distribuido: catálogo unión y pedido partido
entre sucursales exigen reserva de stock, asignación y cancelación parcial por
pierna. Eso es un OMS, y además empujaría lecturas al camino caliente del POS,
que según [ADR 0003](0003-disponibilidad-por-query-convergente.md) ya hace 18–19
consultas y ya tuvo timeouts. Después de elegir sucursal se está dentro de un
solo `Store` y todo lo de abajo queda igual que antes.

## Por qué el registro de slugs

El requisito era «todos los slugs únicos sin importar el negocio», y hoy no se
cumple: `Business.slug` y `Store.slug` son únicos **cada uno en su tabla**, así
que dos tablas pueden coincidir. Y nada impide un slug `admin` o `api`, que
colisiona con rutas reales.

## Consecuencia

Cambiar de sucursal con el carrito lleno tiene que **re-preciar o vaciar**, y
eso se muestra en pantalla: resolverlo en silencio cambiaría el total sin avisar.
