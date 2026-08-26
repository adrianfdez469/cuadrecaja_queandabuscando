---
propuesta: storefront-multisucursal
agente: sdd-spec
actualizado: 2026-08-26T01:59:27Z
estado: propuesta
---

> Origen: revisión de arquitectura del 2026-08-25.
> Decisión de fondo en [ADR 0012](../../../docs/adr/0012-storefront-sobre-store.md).

## Problema

Un negocio con varias sucursales recibe hoy una URL y un QR por local, porque
`/[slug]` resuelve un `Store` y `Store` es el espejo de una tienda física. La
marca queda partida y el comprador tiene que saber de antemano a qué local va.

Importa **ahora** y no cuando haya tiempo porque los QR se imprimen en papel y se
pegan en la pared: cambiar la forma de la URL después obliga a reimprimir. Es lo
único de este rediseño que no se arregla con una migración.

## Alcance

### Dentro

- Modelo `Storefront` (marca): slug, nombre, branding, contacto.
- `Store` pasa a colgar de `Storefront` y conserva precios, stock y pedidos.
- Resolución de `/[slug]`: primero `Storefront`, después `Store`.
- Selector de sucursal cuando hay más de una; render directo cuando hay una.
- Tabla `Slug` como registro único de marcas, sucursales y palabras reservadas.
- Carrito namespaced por sucursal y aviso al cambiar de sucursal.

### Fuera (explícito)

- **Inventario distribuido.** Nada de catálogo unión ni pedidos partidos entre
  sucursales. Ver ADR 0012.
- **Almacenes.** queandabuscando no aprende qué es un almacén; vender existencias
  de almacén se resuelve con un traslado dentro de cuadrecaja.
- Búsqueda por cercanía (sigue en F-015 / ADR 0011).

## Actores y precondiciones

El administrador publica desde cuadrecaja; el modelo ya distingue `Business` de
`Store`. Precondición: existe al menos un negocio con dos tiendas publicables.

## Comportamiento esperado

- **E1** — Dado un `Storefront` con **una** sucursal, cuando se pide `/[slug]`,
  entonces se renderiza el catálogo de esa sucursal sin selector y sin redirección.
- **E2** — Dado un `Storefront` con **dos** sucursales, cuando se pide `/[slug]`,
  entonces se muestra el selector de sucursal.
- **E3** — Dado el slug de un `Store` emitido antes de este cambio, cuando se
  pide `/[slug]`, entonces sigue respondiendo 200 con esa sucursal.
- **E4** — Dado un carrito con productos de la sucursal A, cuando el comprador
  cambia a la sucursal B, entonces se le muestra qué pasa con el carrito antes de
  aplicarlo.
- **E5** — Dado un slug ya tomado por una marca, cuando se intenta crear una
  sucursal con el mismo slug, entonces se rechaza.

## Reglas de negocio

- **R1** — El slug lo posee el `Storefront`. Una sucursal solo tiene slug propio
  si su marca tiene más de una.
- **R2** — Un `Store` pertenece a exactamente un `Storefront`.
- **R3** — Precio, disponibilidad y pedido se resuelven **siempre** contra un
  único `Store`. Después del selector, nada aguas abajo cambia.
- **R4** — El espacio de slugs es único entre marcas, sucursales y reservados
  (`admin`, `api`, `buscar`, y las rutas que existan).
- **R5** — El carrito se namespacea por sucursal, nunca por marca.

## Casos límite y errores

- Marca con cero sucursales publicadas → 404, no selector vacío.
- Sucursal suspendida mientras el comprador tiene su carrito abierto.
- Sucursal única que pasa a ser dos: el slug viejo debe seguir resolviendo.
- Colisión de slug entre una marca nueva y una sucursal existente.

## Datos y contrato

`Storefront` es **propio de queandabuscando**: cuadrecaja no lo conoce. Lo que
llega por sync sigue siendo `Tienda` → `Store`. Agrupar sucursales bajo una marca
es una decisión de vitrina, así que la toma el panel (corte limpio: cuadrecaja
publica, queandabuscando viste). Ver `docs/sync-contract.md`.

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. `GET /[slug]` de una marca con una sucursal responde 200 y **no** contiene el
   selector en el HTML.
2. `GET /[slug]` de una marca con dos sucursales responde 200 y contiene ambas.
3. `GET /[slug-de-store-antiguo]` responde 200 (no 404, no redirección).
4. Crear una sucursal con un slug ya usado por una marca falla con error de
   restricción única.
5. Crear una tienda con slug `admin` o `api` falla.
6. `npm run build` sigue marcando las rutas de tienda como ● (SSG).
7. `bash .agent/verify.sh <id> --full` termina en 0.

## Incongruencias detectadas

- `prisma/schema.prisma`: `Business.slug` y `Store.slug` son `@unique` **cada uno
  en su tabla**, así que el requisito «slugs únicos sin importar el negocio» no se
  cumple hoy.
- Nada impide un slug que colisione con una ruta real (`/admin`, `/api`).
- F-004 ya está en `passes: true` con `/[slug]` resolviendo un `Store`. Por la
  regla 3 sus criterios no se tocan: este feature los **extiende**, y E3 existe
  justamente para probar que lo de F-004 sigue siendo cierto.

## Huecos y preguntas al humano

- **SP1** — ¿La marca la crea el admin agrupando sucursales ya publicadas, o se
  crea al publicar la primera? Recomendación: al publicar la primera, con la
  agrupación como acción posterior; evita un paso extra al 90% que tiene un local.
- **SP2** — Al cambiar de sucursal con carrito lleno: ¿re-preciar lo que exista
  en la nueva o vaciar? Recomendación: re-preciar y listar explícitamente lo que
  no está disponible allí. Vaciar sin avisar pierde la compra.

## No decidido a propósito

Si el selector de sucursal usa geolocalización o solo una lista. Lo cierra
`sdd-designer`; el modelo de datos no cambia en ninguno de los dos casos.
