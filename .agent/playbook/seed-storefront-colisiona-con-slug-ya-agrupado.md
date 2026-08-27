---
slug: seed-storefront-colisiona-con-slug-ya-agrupado
sintoma: "npm run seed falla con PrismaClientKnownRequestError P2002 UniqueConstraintViolation, meta.modelName: 'Storefront', justo al sembrar una tienda que YA se agrupó (HS8) con otra en una corrida anterior"
firma: UniqueConstraintViolation
etapa: prisma
visto_en: F-017
creado: 2026-08-27T04:40:06Z
promovido_a_agents: no
arreglo: en prisma/seed.ts::seedStorefront(), si no hay Storefront con ese slug, comprueba el registro Slug — si el valor ya es propiedad de un Store (kind STORE), resuelve el storefrontId ACTUAL de ese Store y devuélvelo sin crear nada
---

## Qué pasa de verdad

`seedStorefront(slug)` decide crear-o-actualizar mirando solo si existe un
`Storefront` con ese `slug`. Agrupar (`groupStoreIntoBrand`,
architecture.md § Qué les pasa a los slugs) hace justo lo que ese chequeo no
anticipa: la marca que se vacía se **borra**, y su slug pasa a ser el
`Store.slug` propio de la sucursal que se unió (`Slug.kind` de `STOREFRONT`
a `STORE`). La próxima vez que `npm run seed` siembra esa fixture, no
encuentra `Storefront`, así que intenta **crear uno nuevo** con
`slugEntry: { create: { value: slug, kind: "STOREFRONT" } } }` — y esa fila
de `Slug` ya existe, con otro dueño. El P2002 que Prisma reporta apunta a
`Storefront` (el modelo de la escritura anidada), no a la causa real (la
fila de `Slug` reasignada).

## Cómo se arregla

`prisma/seed.ts::seedStorefront()`: cuando `prisma.storefront.findUnique({
where: { slug } })` no encuentra nada, antes de crear, lee
`prisma.slug.findUnique({ where: { value: slug }, select: { storeId: true }
})`. Si esa fila existe y tiene `storeId` (kind `STORE`, ya no `STOREFRONT`),
resuelve `prisma.store.findUnique({ where: { id: storeId }, select: {
storefrontId: true } }).storefrontId` y devuélvelo tal cual — no hay marca
que crear ni rebrandear bajo un slug que este run ya no posee. El resto de
`seedStore()` sigue igual: su `store.upsert` nunca escribe `slug` ni
`storefrontId` en la rama `update`, así que la agrupación queda intacta.

## Cuándo NO es esto

Un P2002 con `modelName: 'Storefront'` que **no** venga de `npm run seed`, o
que apunte a un negocio/slug distinto de una fixture agrupable
(`bodega-uno`/`bodega-dos` y las que se les agreguen), es otra cosa —
revisa qué escritura real está corriendo antes de aplicar este arreglo.

## Cómo se evita

Cualquier `seedStorefront`-como-función que decida crear-o-actualizar por el
`slug` de un modelo que **agrupar** puede borrar tiene que comprobar el
registro `Slug`, no solo la tabla que cree poseerlo. Si en el futuro se
seedean más marcas agrupables, pasan por la misma `seedStorefront()` — no
hace falta repetir el chequeo en otro sitio.
