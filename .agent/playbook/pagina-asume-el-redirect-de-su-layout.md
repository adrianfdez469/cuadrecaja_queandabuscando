---
slug: pagina-asume-el-redirect-de-su-layout
sintoma: "el log de next dev escupe «⨯ TypeError: Cannot read properties of null» desde una página cuyo layout comprueba la sesión y redirige, mientras la petición responde 307 con toda normalidad"
firma: TypeError: Cannot read properties of null
etapa: smoke
visto_en: F-029
creado: 2026-09-01T03:40:00Z
promovido_a_agents: no
arreglo: "quita la aserción no-nula: la página comprueba la sesión y redirige por su cuenta, porque un layout y su página renderizan EN PARALELO y el redirect del layout no ha ocurrido todavía cuando la página lee la sesión"
---

## Qué pasa de verdad

En el App Router de Next, un layout y su página **no** son secuenciales: se
renderizan en paralelo. Un `redirect()` en el layout no impide que la página se
ejecute — lo que hace es descartar su resultado después.

Así que este patrón, que se lee razonable, es una bomba:

```ts
// layout.tsx
const session = await getAdminSession();
if (!session) redirect("/?admin=sesion-requerida");

// page.tsx
// The layout already redirects when there is no session.  ← mentira
const session = (await getAdminSession())!;
```

Lo que lo hace difícil de ver es que **solo falla a veces**, y por una razón
con sentido: el layout gana la carrera cuando su camino es el más corto. En
F-029 se midió el caso exacto —`src/app/admin/page.tsx`, `AdminSession`:

- **Sin cookie**: `getAdminSession()` vuelve en cuanto resuelve `cookies()`, el
  `redirect()` del layout llega primero y el log queda limpio.
- **Con cookie presente pero ilegible** (caducada, manipulada, o firmada con un
  secreto que se rotó): hay un `await jwtVerify` de por medio. Ese tick de más
  basta para que la página alcance a leer `session.storeIds` sobre un `null`.

Al usuario le sigue llegando su 307, así que no hay pantalla rota: el único
rastro es el `⨯ TypeError` en el log del servidor. Y mientras el guardián del
sensor estuvo muerto (`guardian-de-servidor-grep-tras-rm`), ese rastro no ponía
roja ninguna etapa. Se descubrió por casualidad, leyendo el log de un informe
verde.

## Cómo se arregla

La página comprueba y redirige ella también. Son dos líneas y no depende de
ningún orden de render:

```ts
const session = await getAdminSession();
if (!session) redirect("/?admin=sesion-requerida");
```

El layout **no** se toca: sigue haciendo falta para el resto de rutas del grupo.
La duplicación es correcta aquí — cada renderizador se defiende solo.

## Cuándo NO es esto

Si el `TypeError` sale de una página cuya sesión llega por props o por
parámetro, no es esto: es un dato que de verdad venía nulo.

Y si la ruta pasa la sesión a un ayudante que ya acepta `null` —como
`authorizeStore(session, storeId)` en `src/features/admin/authorization.ts`, que
es lo que hacen las otras ocho páginas de `src/app/admin/`— tampoco: ese camino
ya está a salvo por construcción, y fue el que hizo que este fallo apareciera en
un solo archivo del repo y no en nueve.

## Cómo se evita

`grep -rn '())!' src/app/` pesca el patrón entero: una aserción no-nula sobre el
resultado de un `await` en una página. En este repo debe seguir dando **cero**
resultados fuera de los tests.

La regla, dicha sin Next de por medio: **un comentario que explica por qué algo
no puede ser nulo es el sitio donde mirar cuando resulte que sí lo era.** Si
hace falta el comentario, hace falta la comprobación.
