---
slug: quien-agrupa-pierde-su-slug-literal
sintoma: "una spec o un smoke.sh escriben una URL de sucursal literal (p. ej. /bodega-uno/carrito) contra una marca que se acaba de agrupar, y esa URL da 404 — o peor, se descubre a mitad de sesión que ya no se puede volver atrás para probar la otra dirección"
firma: —
etapa: review
visto_en: F-025
creado: 2026-08-31T15:48:36Z
promovido_a_agents: no
arreglo: agrupa SIEMPRE con la sucursal cuyo slug literal quieres conservar como JOINING (el segundo argumento, joiningStoreId), nunca como el dueño del endpoint (POST /api/admin/stores/<PRIMARY>/branches) — el PRIMARY pierde su slug literal siempre, sin excepción
---

## Qué pasa de verdad

`regroupStoreIntoBrand()` (`src/features/storefront/server/registry.ts:374-470`)
trata a las dos sucursales de forma asimétrica. La marca (`Storefront`)
**conserva** el slug que ya tenía. El store **PRIMARY** —el dueño del
endpoint al que se hace el `POST /api/admin/stores/<id>/branches`— nunca
tiene slug propio antes de agrupar (`Store.slug: null`, porque su URL
pública era la de su propia marca de una sola sucursal), así que al agrupar
recibe uno **nuevo**, calculado con `previewSlug()` — que colisiona con el
que la marca ya tiene y se desambigua con un sufijo (`bodega-uno` →
`bodega-uno-2`). El store **JOINING** —el que se pasa en `joiningStoreId`—
si también era de una sola sucursal, **conserva su slug literal sin
cambiar**: solo se reasigna su fila en la tabla `Slug` de `kind: STOREFRONT`
a `kind: STORE`.

Consecuencia: **una URL de sucursal escrita contra el nombre "de siempre"
solo sigue siendo válida si esa sucursal fue la JOINING, nunca si fue la
PRIMARY.** `.agent/specs/F-017/smoke.sh` siempre agrupa con `bodega-uno`
como PRIMARY (`POST .../stores/$UNO_ID/branches` con
`joiningStoreId=$DOS_ID`) — así que, tras correr ese guion (o reproducir su
POST a mano), `/bodega-uno` es la marca (selector) para siempre y
`/bodega-uno/carrito`, `/bodega-uno/c/<cat>`, `/bodega-uno/p/<slug>` dan 404.
La sucursal que sí sigue en `/bodega-uno` —literal— es **bodega-dos**.

## Cómo se arregla

Si una spec/criterio necesita que una URL de sucursal **concreta** siga
siendo válida tras agrupar, la sucursal que la lleva tiene que ser la
**JOINING** del POST, nunca la PRIMARY:

```
POST /api/admin/stores/<PRIMARY>/branches
{ "joiningStoreId": "<JOINING — conserva su slug literal>" }
```

Y agrupar **no tiene vuelta atrás** (ADR 0018 (f)): si ya se agrupó en la
dirección equivocada, no hay forma de deshacerlo desde el panel ni desde el
API — solo queda usar la sucursal que sí sobrevivió (la JOINING) o, si hace
falta la otra combinación, sembrar un par nuevo de tiendas de un solo uso y
agruparlas en la dirección correcta desde el principio.

## Cuándo NO es esto

Si las dos sucursales YA tenían slug propio antes de agrupar (el caso
`joiningBrandIsSingle: false`, una marca que ya era multi-sucursal
absorbiendo otra), la asimetría no aplica igual — revisa
`regroupStoreIntoBrand()` para ese camino en concreto antes de asumir esta
ficha.

## Cómo se evita

Antes de escribir una spec/criterio/smoke.sh con una URL de sucursal
literal contra una marca que hay que agrupar para la prueba, decide primero
**qué sucursal necesita sobrevivir con su slug de siempre** y agrúpala como
`joiningStoreId`, nunca como el dueño del endpoint. Si el criterio ya está
escrito contra la sucursal equivocada (como pasó en F-025, criterios 5 y
18, contra "bodega-uno"), es una pregunta al humano (TP), no algo que se
arregle solo probando la otra dirección — agrupar no tiene vuelta atrás.
