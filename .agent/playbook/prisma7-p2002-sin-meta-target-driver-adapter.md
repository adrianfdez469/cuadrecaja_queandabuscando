---
slug: prisma7-p2002-sin-meta-target-driver-adapter
sintoma: "un P2002 real (contra Postgres de verdad) no lo reconoce un chequeo que compara error.meta.target, y el catch que debía tragárselo deja pasar el PrismaClientKnownRequestError sin capturar"
firma: Unique constraint failed on the fields
etapa: test
visto_en: F-012, F-034
creado: 2026-08-29T15:26:00Z
promovido_a_agents: no
arreglo: usa src/features/orders/server/prismaErrors.ts::isUniqueViolation() — ya sabe leer las dos formas — y si escribes tu propio chequeo, lee también error.meta.driverAdapterError.cause.constraint.fields
---

## Qué pasa de verdad

Con Prisma 7 y `@prisma/adapter-pg` (el conector que corre este repo, local y
en producción — ver `src/lib/prisma.ts`), un `P2002` real contra Postgres NO
trae el `meta.target` clásico (ni string ni array) que la documentación de
Prisma y casi todo el código de ejemplo asumen. El nombre de la columna vive
anidado: `error.meta.driverAdapterError.cause.constraint.fields`, y cada campo
llega con sus propias comillas dobles literales (`'"supabaseUserId"'`, no
`'supabaseUserId'`) porque es el mensaje de Postgres, citado tal cual.

Un chequeo que solo mira `error.meta?.target` —que es exactamente lo que
`isUniqueViolation()` hacía antes de F-012— nunca reconoce esta colisión: el
`if (!isUniqueViolation(...)) throw error;` deja escapar el error crudo, y
quien esperaba «relee la fila ganadora» revienta con un 500 en su lugar.
Verificado con un test desechable contra Postgres local, tanto para
`prisma.customer.upsert()` como para `prisma.customer.create()` — el problema
no es de `upsert`, es genérico de cómo este conector reporta P2002.

Los tests que mockean `{ code: "P2002", meta: { target: ... } }` (la forma de
ejemplo de la documentación) siguen en verde con este bug delante: solo un
test contra la base real lo saca a la luz.

## Cómo se arregla

No dupliques el chequeo: importa `isUniqueViolation` de
`src/features/orders/server/prismaErrors.ts`, que ya intenta las tres formas
en orden (`target` string, `target` array, y la anidada del driver adapter,
con el `replace(/"/g, "")` que le quita las comillas antes de comparar). Si
alguna vez hace falta un chequeo nuevo en otro sitio, réplica esa función —
no la reimplementes mirando solo `meta.target`.

## Cuándo NO es esto

Si el error NO es un P2002 (otro código, u otro modelo de excepción por
completo), esto no aplica. Y si tu test mockea el error a mano con
`meta: { target: [...] }`, nunca vas a ver este bug — lo que hace falta es un
`*.db.test.ts` contra Postgres real para que la forma verdadera del error
aparezca.

## Cómo se evita

Cualquier manejo nuevo de P2002 pasa por `isUniqueViolation()`, y cualquier
camino que dependa de "la colisión se resuelve, no se propaga" se prueba, al
menos una vez, contra la base real — nunca solo con un error mockeado a mano.
