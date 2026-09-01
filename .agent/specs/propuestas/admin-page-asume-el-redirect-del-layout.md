---
propuesta: admin-page-asume-el-redirect-del-layout
agente: sdd-spec
actualizado: 2026-09-01T02:38:41Z
estado: resuelta
---

> **RESUELTA el 2026-09-01, sin pasar por el backlog.** El humano eligió
> arreglarla con `/fix` en vez de abrir feature, y por la opción de comprobar en
> la página (SP8 a), no con un helper `requireAdminSession()`. `src/app/admin/page.tsx`
> ya no usa la aserción no-nula: lee la sesión y redirige por su cuenta. Verificado
> ejecutando: el smoke de F-029 pasa y su log de servidor queda limpio, y
> `grep -rn '())!' src/app/` da cero fuera de los tests. La lección quedó en
> `.agent/playbook/pagina-asume-el-redirect-de-su-layout.md`.

## Problema

`src/app/admin/page.tsx:11` afirma que la sesión existe sin comprobarlo:

```ts
// The layout already redirects when there is no session.
const session = (await getAdminSession())!;
```

El comentario es falso en el App Router. `AdminLayout`
(`src/app/admin/layout.tsx:10-11`) y `AdminHomePage` **no** se serializan: Next
los renderiza en paralelo, cada uno con su propia llamada a
`getAdminSession()`. Cuando la cookie `qab-admin-session` está **presente pero
no se puede leer**, las dos llamadas devuelven `null`, el layout llama a
`redirect()` y la página se ejecuta igualmente — el `!` fuerza el `null` y
`listManagedStores` (`src/features/admin/server/stores.ts:33`) revienta al
tocar `session.storeIds`.

Reproducido ejecutando, no leyendo, contra `npx next dev -p 3100` de este
worktree:

```
$ curl -s -o /dev/null -w '%{http_code}\n' \
    -H 'Cookie: qab-admin-session=no-es-un-jwt' http://localhost:3100/admin
307
```

y en el log del servidor, para esa única petición:

```
⨯ TypeError: Cannot read properties of null (reading 'storeIds')
    at listManagedStores (src/features/admin/server/stores.ts:33:15)
    at AdminHomePage (src/app/admin/page.tsx:12:41)
  32 | export async function listManagedStores(session: AdminSession): Promise<AdminStoreListItem[]> {
> 33 |   if (session.storeIds.length === 0) return [];
     |               ^
  digest: '310672233'
}
 GET /admin 307 in 383ms
```

Tres corridas seguidas, tres `TypeError`: 3/3, sin ninguna otra petición de por
medio.

**Al usuario no le pasa nada malo hoy**: el 307 del layout gana la carrera de la
respuesta y el navegador acaba en `/?admin=sesion-requerida`, que es lo
correcto. Lo que hay hoy es ruido en el log y una aserción no-nula sostenida por
una suposición sobre el orden de render que ni Next ni React garantizan. El día
que ese orden cambie —una versión de Next, `dynamic` distinto, PPR— el `!` deja
de ser ruido y pasa a ser el 500 que el layout ya no llega a tapar.

**No es un caso de laboratorio.** La misma excepción sale con una cookie que es
un JWT perfectamente formado firmado con **otro** secreto, que es lo que tiene
en el navegador cualquiera que estuviera dentro cuando se rotó
`ADMIN_SESSION_SECRET`:

```
$ curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: qab-admin-session=$JWT_CON_OTRO_SECRETO" \
    http://localhost:3100/admin
307
⨯ TypeError: Cannot read properties of null (reading 'storeIds')
```

Es de **F-011** (`passes: true`), no de F-029. Lo encontró `sdd-tester`
verificando F-029 y lo dejó documentado con su evidencia en
`.agent/specs/F-029/tests.md` § Fallos encontrados, fallo 1.

### La causa exacta de la carrera, medida

Sin cookie ninguna, el log queda **limpio**:

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/admin
307
(log del servidor: ninguna línea nueva)
```

La diferencia está en `src/lib/auth/adminSession.ts:47-51`: sin cookie,
`getAdminSession()` devuelve `null` en cuanto resuelve `cookies()`, y el
`redirect()` del layout se dispara antes de que la página avance. Con una
cookie ilegible hay un `await jwtVerify(...)` de por medio (línea 54) que
rechaza un tick después, y ese tick es exactamente el margen que la página
necesita para llegar a `listManagedStores`. Es decir: **la carrera la gana el
layout solo cuando su camino es el más corto**, que es la peor forma posible de
depender de ella.

## Alcance

### Dentro

- Que `src/app/admin/page.tsx` deje de afirmar sin comprobar: el `!` de la
  línea 11 desaparece y el `null` se trata explícitamente.
- Que la conducta observable no cambie: `/admin` sin sesión legible sigue
  respondiendo 307 hacia `/?admin=sesion-requerida`, y con sesión legible sigue
  respondiendo 200.
- Que el log del servidor quede **limpio** en el caso de la cookie ilegible, y
  que eso quede fijado por una aserción que se ejecuta —el guion de humo de
  F-011, `.agent/specs/F-011/smoke.sh`, que ya levanta la app.
- Decidir si el arreglo se queda en la página o sube a un helper en
  `src/lib/auth/adminSession.ts`.

### Fuera (explícito)

- **Las demás páginas del panel.** Ya están bien (ver § Casos límite): pasan la
  sesión por `authorizeStore(session, storeId)`
  (`src/features/admin/authorization.ts:27-31`), cuya firma acepta
  `AdminSession | null`. Tocarlas sería refactor sin fallo detrás.
- **`src/app/api/admin/_lib/guard.ts`.** Mismo caso: `guardAdminStore` ya
  contempla el `null` y lo mapea a 401.
- **Cambiar la firma de `listManagedStores`** para que acepte `null`. Aceptar
  `null` donde el dominio exige una sesión mueve el fallo, no lo quita.
- **Rediseñar la autenticación del panel**, el SSO, la duración de la cookie o
  la rotación del secreto.
- **Arreglar `.agent/verify.sh`.** Es la otra propuesta
  (`.agent/specs/propuestas/guardian-de-smoke-nunca-se-ejecuta.md`) y se decide
  por separado. Ver § Relación con la otra propuesta.
- **`src/app/[slug]/layout.tsx`** y la tienda pública: no hay sesión de por
  medio.

## Actores y precondiciones

**Actor**: cualquiera que pida `/admin` con una cookie `qab-admin-session`
presente y no verificable. No hace falta ningún ataque ni ningún privilegio:

- una cookie emitida antes de rotar `ADMIN_SESSION_SECRET`;
- una sesión caducada (12 h, `SESSION_HOURS` en
  `src/lib/auth/adminSession.ts:14`) que el navegador conserva porque el
  `maxAge` de la cookie y el `exp` del JWT no tienen por qué expirar a la vez;
- un `.env` a medias donde `serverEnv()` lanza y `getAdminSession()` se traga
  el error —el camino que F-029 documentó;
- un `curl` con basura, que es la forma más barata de reproducirlo.

**Precondición única**: la cookie existe y `jwtVerify` la rechaza. Si la cookie
no existe, no pasa nada (medido arriba).

## Comportamiento esperado

- **E1 — Cookie ilegible.** Dada una petición a `/admin` con
  `Cookie: qab-admin-session=no-es-un-jwt`, cuando el servidor la atiende,
  entonces responde **307** hacia `/?admin=sesion-requerida` —igual que hoy— y
  el log del servidor **no** contiene ninguna línea que case con
  `(⨯|Unhandled|Error:)` para esa petición.
- **E2 — Cookie de un secreto viejo.** Dada una cookie que es un JWT bien
  formado firmado con un `ADMIN_SESSION_SECRET` distinto del actual, entonces
  se comporta exactamente como E1. Es el mismo camino de código y el caso real.
- **E3 — Sin cookie.** Dada una petición a `/admin` sin la cookie, entonces
  responde 307 y el log queda limpio. Es la conducta de hoy y no debe cambiar.
- **E4 — Sesión válida.** Dada una cookie de sesión legible y vigente, entonces
  `/admin` responde **200**, pinta las tiendas del administrador y el log queda
  limpio. Verificado hoy como línea base: 200 y ni una línea de error.
- **E5 — Sesión válida sin tiendas.** Dada una sesión legible cuyo `storeIds`
  está vacío, entonces `/admin` sigue respondiendo 200 y `listManagedStores`
  devuelve `[]` por su guarda de la línea 33, que es para lo que está.
- **E6 — El resto del panel no se mueve.** Dada la misma cookie ilegible contra
  `/admin/tiendas/<id>`, entonces responde 307 y el log queda limpio, antes y
  después del cambio. Medido hoy: ya está limpio.

## Reglas de negocio

- **R1 — Ninguna página del panel afirma que hay sesión sin comprobarlo.** El
  operador `!` sobre el resultado de `getAdminSession()` queda prohibido en
  `src/app/`: o se comprueba, o se pasa por una función cuya firma acepte
  `AdminSession | null`.
- **R2 — El redirect de un layout no es una garantía de control de flujo para
  su página.** Es la lección de fondo y la que sobrevive a este arreglo: en el
  App Router, layout y página se evalúan en paralelo. Cualquier comentario que
  diga «el layout ya redirige» describe una carrera, no una precondición.
- **R3 — La respuesta HTTP no cambia.** 307 donde hoy hay 307, 200 donde hoy
  hay 200, y el mismo destino `/?admin=sesion-requerida`. Este no es un cambio
  de producto.
- **R4 — Una cookie ilegible se trata igual que una cookie ausente.** Ya es lo
  que promete el `catch` de `src/lib/auth/adminSession.ts:63-66` («Treat exactly
  like "not signed in"»); la página es el único sitio donde esa promesa se
  rompe.
- **R5 — Cero consultas nuevas.** El arreglo no puede añadir un round-trip a
  Prisma ni una segunda lectura de la cookie por petición.

## Casos límite y errores

- **El `!` repetido en otro sitio: no lo está.** Buscado y ejecutado:

  ```
  $ grep -rn '())!' src/
  src/app/admin/page.tsx:11:  const session = (await getAdminSession())!;
  ```

  Con el patrón ampliado (`\)\)!\s*;|\)!\s*;|\)!\.`) los otros ocho aciertos
  están todos en archivos `*.test.ts` / `*.test.tsx`
  (`src/app/[slug]/pedido/[code]/respuesta/route.test.ts`,
  `src/features/orders/whatsapp.test.ts`, `src/features/orders/server/read.test.ts`),
  donde una aserción no-nula es legítima. **En código de producción bajo
  `src/app/` el patrón aparece una sola vez.** Eso hace la propuesta pequeña.

- **Las otras ocho páginas de `src/app/admin/`** llaman a `getAdminSession()`
  sin `!` y le pasan el resultado a `authorizeStore(session, storeId)`, que
  declara `session: AdminSession | null` y devuelve `{ ok: false, denial:
"UNAUTHORIZED" }` cuando es `null`. No dependen del layout para nada, y por
  eso el log queda limpio (E6, medido).

- **Sesión válida para tiendas que ya no existen**: `missingCount` en
  `src/app/admin/page.tsx:13` se calcula restando; ese camino no lo toca esta
  propuesta y sigue igual.

- **Doble `redirect()`**, si el arreglo elegido redirige también desde la
  página: los dos apuntan al mismo destino y `redirect()` lanza, así que gane
  quien gane el resultado es el mismo 307. No hay bucle: `/` no está bajo
  `src/app/admin/`.

- **Concurrencia**: la carrera es entre dos renders del mismo request, no entre
  peticiones. No hay estado compartido que proteger.

## Datos y contrato

Ninguno. No hay migración, ni endpoint nuevo, ni campo nuevo. No roza
`docs/sync-contract.md`: la sesión de admin no viaja al POS. El único contrato
que se toca es el interno de `getAdminSession()`, que ya declara
`Promise<AdminSession | null>` y que la página ignoraba.

## Criterios de aceptación propuestos

Todos `[nuevo]`. F-011 tiene `passes: true` y la regla 3 prohíbe tocar sus
`acceptance_criteria`; estos se proponen aparte, escritos para copiarse tal cual
a `.agent/features.json`.

1. `[nuevo]` `grep -rn '())!' src/app/` no encuentra nada: ninguna página
   afirma tener sesión sin comprobarlo.
2. `[nuevo]` Con la app levantada, `curl -s -o /dev/null -w '%{http_code}'
-H 'Cookie: qab-admin-session=no-es-un-jwt' "$SMOKE_BASE_URL/admin"` responde
   **307**, y el log del servidor de esa corrida **no** contiene ninguna línea
   que case con `grep -aE '(⨯|Unhandled|Error:)'`. Es el criterio central: el
   `curl` con cookie ilegible deja el log **limpio**.
3. `[nuevo]` La misma petición con un JWT bien formado firmado con un secreto
   distinto del de `.env` responde 307 y deja el log igual de limpio.
4. `[nuevo]` `curl` a `/admin` con una cookie de sesión real —la que emite
   `/admin/sso`, como ya hace `.agent/specs/F-011/smoke.sh`— sigue respondiendo
   **200** y el HTML sigue conteniendo `Tus tiendas`.
5. `[nuevo]` `.agent/specs/F-011/smoke.sh` incluye los tres pasos anteriores
   con su `SMOKE FAIL <qué>`, y `bash .agent/verify.sh F-011 --smoke` sale 0.
6. `[nuevo]` `bash .agent/verify.sh F-011 --full` sale 0.
7. `[nuevo]` `npm run typecheck` sale 0 sin ninguna aserción no-nula nueva: el
   `null` se estrecha comprobándolo, no afirmándolo.

## Incongruencias detectadas

- **I1 — El comentario de `src/app/admin/page.tsx:10` afirma algo falso.** «The
  layout already redirects when there is no session» describe una carrera que
  se pierde de forma reproducible, no una precondición. Un comentario que
  justifica un `!` con una garantía inexistente es peor que no tener
  comentario: es lo que hace que el siguiente lector no vuelva a mirar.
- **I2 — `src/app/admin/page.tsx` contradice al resto de su propio panel.** Las
  otras ocho páginas de `src/app/admin/` tratan el `null` explícitamente vía
  `authorizeStore`. La página raíz es la única excepción, y no hay ninguna
  razón escrita para que lo sea.
- **I3 — Contradice al `catch` de `src/lib/auth/adminSession.ts:63-66`,** que
  promete tratar una cookie manipulada o caducada «exactly like "not signed
  in"». La página convierte ese `null` prometido en un `TypeError`.
- **I4 — `AGENTS.md` § Arquitectura dice que `src/app/` "rutea y compone. Nada
  de lógica de negocio".** Un `!` que sostiene una invariante de autorización
  **es** lógica de negocio, y está en la capa que dice no tenerla. Refuerza la
  opción (c) de SP8.
- **I5 — El fallo lleva desde F-011 sin que ningún sensor lo viera, y no es
  casualidad.** El único sensor que lo habría pescado —el guardián de
  `.agent/verify.sh:295`— está roto desde el 2026-08-25. Ver § Relación.

## Relación con la otra propuesta

Este fallo es hoy **invisible por construcción**. Deja un `⨯ TypeError` en el
log del servidor y nada más, y el único mecanismo del arnés que convierte «hay
un error en el log» en «la etapa está roja» es el `grep` de
`.agent/verify.sh:295`, que corre sobre un archivo ya borrado y por tanto nunca
asigna `code=1`. Está descrito y medido en
`.agent/specs/propuestas/guardian-de-smoke-nunca-se-ejecuta.md`.

Las dos direcciones importan y conviene verlas juntas:

- **Si se arregla el guardián sin arreglar esto**, `bash .agent/verify.sh F-029
--smoke` se pone rojo, porque su guion de humo pide `/admin` con una cookie
  basura a propósito. Este arreglo es, literalmente, una de las dos cosas que
  hay que hacer para que el guardián arreglado no deje el repo en rojo.
- **Si se arregla esto sin arreglar el guardián**, el criterio 2 de arriba se
  verifica una vez a mano y nada impide que vuelva mañana. La propuesta sigue
  valiendo la pena —el `!` es el defecto, no su detectabilidad— pero pierde la
  red.

Recomendación de orden: **este primero, el guardián después.** Arreglar dos
líneas de una página es más barato que arreglar el sensor con el repo en rojo
por debajo.

## Huecos y preguntas al humano

**SP7 — ¿Se puede tocar `src/app/admin/page.tsx`, que es de F-011 y ya está en
`passes: true`?**
Qué falta: permiso para modificar código de un feature cerrado.
Por qué bloquea: sin permiso, la propuesta se queda en documentación de un
fallo que se seguirá reproduciendo. La regla 3 protege los
`acceptance_criteria` de F-011, no su código; pero cambiar código de un feature
cerrado es del humano, no mío.
Opciones: (a) sí, dentro de F-011, añadiendo los criterios de arriba como
feature nuevo que lo corrige —que es lo que la propia regla 3 manda hacer;
(b) sí, pero como parte del feature que arregle el guardián, en un solo ciclo;
(c) no, y queda escrito aquí.
**Recomiendo (a)**: el cambio son dos líneas de una página, el resto del panel
ya se comporta así, y R3 garantiza que ninguna respuesta HTTP cambia. Meterlo
en el ciclo del guardián (b) mezcla un arreglo de producto con uno de
infraestructura y hace ilegible el diff de los dos.

**SP8 — ¿Comprobar en la página, o un `requireAdminSession()` en
`src/lib/auth/adminSession.ts`?**
Qué falta: elegir dónde vive el arreglo.
Por qué importa: cambia el tamaño del diff y quién hereda la regla R1.
Opciones:
(a) **En la página**: `const session = await getAdminSession(); if (!session)
redirect("/?admin=sesion-requerida");`. Dos líneas, cero superficie nueva,
duplica el destino del redirect en dos archivos.
(b) **La página recibe la sesión ya resuelta del layout**. Suena bien y **no es
viable**: en el App Router un layout no le pasa props a `children`, y la única
vía sería un Context de cliente —prohibido para esto— o una caché por petición
que dedupe la llamada pero **no** quita el `null`. La descarto por
comprobación, no por gusto.
(c) **Un helper `requireAdminSession()`** en `src/lib/auth/adminSession.ts` que
llame a `getAdminSession()` y haga `redirect()` cuando sea `null`, devolviendo
`AdminSession` a secas. La página queda en una línea, el layout lo usa también,
el destino del redirect vive en un solo sitio y R1 pasa a estar garantizada por
firma de tipos en vez de por vigilancia.
**Recomiendo (c)**, con una salvedad honesta: `AGENTS.md` § Arquitectura pide
que `src/lib/` sea «lógica pura y reutilizable, sin Prisma, sin React», y
`redirect` acopla el módulo a `next/navigation`. El precedente juega a favor:
ese archivo ya importa `cookies` de `next/headers` en su línea 1, así que la
pureza ya está negociada ahí y el helper no abre ninguna puerta nueva. Si el
humano prefiere no ampliar ese acoplamiento, **(a) es suficiente** y arregla el
fallo entero; lo que se pierde es la garantía para la próxima página del panel.

**SP9 — ¿El caso de la cookie ilegible entra en `.agent/specs/F-011/smoke.sh`,
o hace falta un guion nuevo?**
Qué falta: dónde vive la aserción que impide la regresión.
Por qué importa: sin sitio, el criterio 2 se verifica una vez y se olvida.
Opciones: (a) en `.agent/specs/F-011/smoke.sh`, que ya levanta la app y ya monta
una sesión real por `/admin/sso`; (b) en el guion del feature nuevo que salga de
esto; (c) en un test de servidor con `vitest`, que **no** sirve: la carrera
entre layout y página solo existe en el runtime de Next, no en un test unitario
que llama a la función.
**Recomiendo (a)**. Es donde está el resto de la verificación del panel y el
precedente exacto ya existe: `.agent/specs/F-012/smoke.sh` prueba
`qab-shopper-auth=smoke-garbage-session` para el lado de cliente. Lo que faltaba
era el gemelo de admin.

## No decidido a propósito

- **Si `AGENTS.md` gana una línea nueva en § Cosas que muerden** con R2 («en el
  App Router, layout y página se renderizan en paralelo: el redirect de un
  layout no protege a su página»). Es una trampa de Next, no de este repo, y
  hasta hoy ha mordido una sola vez; la convención del propio `AGENTS.md` es
  que una lección sube cuando muerde en dos features distintos. Lo decide quien
  cierre el feature.
- **Si el destino del redirect debería llevar un motivo distinto**
  (`?admin=sesion-invalida` en vez de `?admin=sesion-requerida`) cuando la
  cookie existía pero no se pudo leer. Es un cambio de producto pequeño y real
  —le diría al administrador que su sesión caducó en vez de que no la tenía—
  pero está fuera de este alcance, que promete no cambiar ninguna respuesta.
- **Por qué exactamente Next 16.3.2 / React 19.2.8 con Turbopack no serializa
  layout y página.** Medido y reproducible al 100%; la causa mecánica dentro de
  Next no se investigó porque el arreglo no depende de ella. Si alguien la
  encuentra, que la escriba aquí.
