---
propuesta: carritos-abiertos-del-comprador
agente: orquestador
actualizado: 2026-08-27T00:40:00Z
estado: propuesta
---

> Origen: decisión del humano al resolver SP2 de F-017 (2026-08-27). Sus
> palabras: «al usuario no se le deben borrar los products del carrito de
> ninguna de estas tiendas. Deberían aparecerle pero separados por tienda, que
> el usuario sepa que tiene un carrito conformado en cada una de estas aunque
> esto será objeto de otra funcionalidad».

## Problema

Un comprador arma un carrito en la tienda X, entra a la tienda Y del mismo
negocio y arma otro, y luego a la tienda Z de otro negocio y arma un tercero.
Los tres se conservan —eso ya funciona—, pero **el comprador no tiene forma de
enterarse de que existen**: cada uno solo se ve estando dentro de su tienda. Se
olvidan compras a medio armar que el negocio nunca llega a ver.

## Lo que ya está construido, y por qué esta propuesta es pequeña

`src/constants/cart.ts` guarda cada carrito en `localStorage` bajo
`qab.cart.v1.` + `Store.id`, con el comentario «Never by slug (R12)». La
separación por tienda que el humano describe **ya es la implementación**, y
sobrevive a que el slug pase a la marca en F-017 justamente porque la clave no
usa el slug. Lo que falta no es el almacenamiento: es la pantalla.

## Alcance

### Dentro

- Una vista para el comprador con los carritos que tiene abiertos: por tienda,
  con el nombre de la tienda, cuántas líneas y el importe, y un enlace a cada
  una.
- Agrupar por negocio cuando dos tiendas son del mismo, ahora que F-017
  introduce la marca.
- Vaciar un carrito desde ahí, explícitamente.
- Qué se muestra cuando un carrito apunta a una tienda que ya no existe, está
  cerrada al público (F-011) o cuyos productos cambiaron de precio.

### Fuera

- **Fusionar carritos** de dos tiendas. No tiene sentido: el pedido se resuelve
  contra un único `Store` (ADR 0012, R3).
- Sincronizar carritos entre dispositivos. Eso exige cuenta de cliente (F-012) y
  guardarlos en base, no en el navegador; es otro feature con su propio coste de
  privacidad.
- Recordatorios por WhatsApp o correo de un carrito abandonado.

## Preguntas para el humano

- **CP1** — ¿Dónde vive esa vista? Un enlace en la cabecera de la tienda cuesta
  JavaScript en la vitrina, que es justo lo que F-013 quiere bajar. Una ruta
  propia (`/mis-carritos`) no cuesta nada a la tienda pero hay que descubrirla.
- **CP2** — ¿Expira un carrito? El humano dijo «o expire», así que existe la
  idea; falta el plazo y qué se le dice al comprador cuando pasa.
- **CP3** — ¿Cuenta esto para el comprador sin sesión, o solo con la cuenta de
  F-012? Sin sesión vive en un solo navegador y se pierde al limpiar datos.

## Por qué no es un feature todavía

La regla 4 reserva el backlog al humano. Esto queda aquí hasta que decida si
entra, y con qué criterios ejecutables.
