---
feature: F-034
agente: sdd-spec
actualizado: 2026-09-03T05:14:44Z
estado: listo
---

## Problema

El paso 0 de toda la integración es un desarrollador de queandabuscando con
`DATABASE_URL` de producción en una terminal. `npm run mint:token -- <externalId>`
(`scripts/mint-sync-token.ts`) es la única vía para acuñar el token de un negocio
y, desde que el sync dejó de crear negocios (F-018, R8/E16 en
`src/features/sync/server/handlers/store.ts:69-76`), **es también el alta del
negocio**: sin ese comando no hay `Business`, sin `Business` no hay token, sin
token `/api/internal/*` responde 401 y cuadrecaja no puede empezar.

Eso convierte un trámite de cuadrecaja —«este comercio publica en tienda»— en
una cita entre dos equipos, y de paso deja una puerta comercial que nadie
decidió (§ Incongruencias, I14). El disparador ya existe y ya
está autenticado del otro lado: lo que falta es que pueda ejecutarse solo.

## Alcance

### Dentro

- **Una ruta nueva de aprovisionamiento** que, para un `externalId` dado, crea
  el `Business` si no existe y acuña su token de sync, devolviendo el valor en
  claro **una sola vez**. Vive en src/app/api/provisioning/credential/route.ts
  (por crear).
- **Un guard propio** para esa ruta, con un **secreto compartido en cabecera**,
  comparado en tiempo constante. Vive en src/app/api/provisioning/\_lib/guard.ts
  (por crear).
- **Semántica de crear-si-no-existe, NUNCA rotar** (R3): repetir la llamada no
  toca nada y no devuelve ningún token.
- **La escritura**, en un módulo de servidor propio —
  src/features/sync/server/provisioning.ts (por crear)— porque `src/app/` no
  toca Prisma (AGENTS.md § Arquitectura).
- **La versión 10 de `docs/sync-contract.md`** (mayor: hay una ruta nueva) y el
  secreto nuevo en `docs/despliegue.md`.
- **`scripts/mint-sync-token.ts` sobrevive**, sin cambios de comportamiento, como
  vía de rescate y como la única forma de **rotar**.

### Fuera (explícito)

- **La tabla `BusinessCredential`**, la **rotación con solape** y la
  **revocación**. Se quedan en
  `.agent/specs/propuestas/credenciales-de-integracion.md` (D6). Con ellas se
  queda `resolveCaller()` contra una tabla y la retirada de
  `Business.syncTokenHash`.
- **Devolver el token de un negocio que ya lo tiene.** Es la consecuencia
  directa de que no haya solape — § La arruga conocida del recorte.
- **Rotar por API.** Rotar sigue siendo `npm run mint:token`, con su ventana de
  corte (`docs/despliegue.md` § 11).
- **Revocar, listar o borrar negocios.** No hay `DELETE`, no hay `GET` de
  inventario. Un `externalId` mal escrito deja una fila que solo se limpia por
  SQL.
- **El HMAC de [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md) sobre
  las siete rutas de sync.** Este feature no lo adelanta ni lo retrasa (SP5 de la
  propuesta, sigue abierta allí).
- **Ejercer o consultar admisión de negocios** (D1, R16). Para queandabuscando,
  cualquier `externalId` que llegue con el secreto correcto tiene luz verde.
- **Firma asimétrica** (D4, vetado por D8). Si algún día se le añade la rotación,
  D8 se reabre.
- **Tocar `src/lib/env.ts`.** El secreto se lee de `process.env` directamente, y
  por eso este feature **no depende de F-029** (`passes: false`) — § Datos y
  contrato, «Configuración».
- **Rate limiting.** No existe en el repo hoy (no hay ni un módulo que lo
  implemente), y esta ruta no lo estrena.

## Actores y precondiciones

**Quién dispara**: el **superadministrador de cuadrecaja**, una vez **por
negocio** (D7). No es «el administrador publica su tienda», que ocurre una vez
por sucursal: esa lectura es la que § La trampa de la propuesta descartó.

**Precondiciones**:

- queandabuscando tiene configurado el secreto de aprovisionamiento
  (§ Datos y contrato). Si no lo tiene, la ruta responde 503 y nada más.
- cuadrecaja conoce el secreto y el `Negocio.id` del negocio, que es el
  `externalId` con el que queandabuscando lo conoce.
- cuadrecaja puede **persistir el token** que reciba, en la configuración de ese
  negocio, antes de dar la operación por buena. Esto es más fuerte que en la
  propuesta completa: sin solape, un token recibido y perdido no se recupera.

**Lo que NO hace falta**: que el negocio exista ya en queandabuscando; que ningún
otro negocio tenga token (la ruta es el arranque en frío de una base vacía); ni
que `/api/internal/*` esté respondiendo algo distinto de 503.

## Comportamiento esperado

Salvo donde se diga lo contrario, «con el secreto correcto» significa
`Authorization: Bearer <secreto de aprovisionamiento>` y un cuerpo
`application/json` válido, y «no se escribe nada» significa que ni `Business` ni
ninguna otra tabla cambia.

**E1 — Alta de un negocio desconocido.** Dado un `externalId` que no existe en
`Business`, cuando se llama con el secreto correcto, entonces se crea
**exactamente una** fila `Business` con ese `externalId` y con `syncTokenHash`
poblado, y la respuesta es **201** con `token` no vacío,
`created: true`, `minted: true`.

**E2 — Ese token autentica de verdad.** Dado el token de E1, cuando se envía un
lote de catálogo con `Authorization: Bearer <ese token>` y
`businessId: <ese mismo externalId>`, entonces `/api/internal/sync/catalog`
responde **207** — no 401 y no 403 `BUSINESS_MISMATCH`. Ver § Incongruencias, I8:
el guion de verificación fija `businessId: "seed-negocio-1"` y por eso el
criterio 2 se ejecuta sobre el camino de E3, no sobre el de E1.

**E3 — Negocio que existe y no tiene token.** Dado un `Business` con
`syncTokenHash` nulo y `active: true`, cuando se llama con su `externalId`,
entonces se acuña: **201** con `token` no vacío, `created: false`,
`minted: true`, y **no se crea ninguna fila `Business` nueva** (el `count(*)` de
`Business` no cambia).

**E4 — Repetición: el negocio ya tiene token.** Dado un `Business` con
`syncTokenHash` poblado, cuando se repite exactamente la misma llamada,
entonces **no se toca nada**: **200** con `token: null`, `created: false`,
`minted: false`, y el `syncTokenHash` de la base es **byte a byte idéntico**
antes y después.

**E5 — Registrar no rota nunca.** Dado E4, cuando después se usa el token de E1
o E3 contra `/api/internal/sync/catalog`, entonces sigue respondiendo **207**.
Es el escenario que fija R3, y el que hace que un reintento de cuadrecaja
—timeout, respuesta perdida, doble pulsación— sea inofensivo.

**E6 — Secreto ausente en el servidor.** Dado que el secreto no está configurado
—o está con una forma que no puede ser un SHA-256 hex de 64 caracteres—, cuando
se llama con cualquier cabecera, entonces **503**
`{"error":"PROVISIONING_NOT_CONFIGURED"}`, no se escribe nada, y **no se
consulta la base**. Nunca 200 y nunca 401: un secreto ausente jamás significa
«deja pasar todo», y un 401 esconde un deploy roto detrás de lo que parece un
error del llamante (ADR 0008 § Detalle de implementación).

**E7 — Las tres formas de fallar la cabecera.** Dado el secreto configurado,
cuando la cabecera `Authorization` **falta**, cuando llega con **otro esquema**
(`Basic …`, `Token …`, el valor desnudo sin esquema), o cuando llega con
`Bearer` y un **valor equivocado**, entonces **401**
`{"error":"UNAUTHORIZED"}` en los tres casos, con el **mismo cuerpo** y sin
ninguna cabecera que los distinga, y no se escribe nada. Quien prueba no
aprende cuál de las tres falló.

**E8 — Cuerpo inválido.** Dado el secreto correcto, cuando el cuerpo no trae
`externalId`, o lo trae vacío o solo con espacios, o más largo de 128
caracteres, o no es JSON parseable, o llega sin `content-type:
application/json`, entonces **400**
`{"error":"INVALID_BODY","issues":[{"path":[…],"message":"…"}]}` y **no se crea
ningún `Business`**. Las claves que el schema no conoce se descartan en silencio
(§ Datos y contrato, «Por qué el schema no es `strict`»).

**E9 — Negocio dado de baja.** Dado un `Business` con `active: false`, cuando se
llama con su `externalId`, entonces **403**
`{"error":"BUSINESS_INACTIVE"}`, no se acuña —su `syncTokenHash` queda
exactamente como estaba, poblado o nulo— y **no se reactiva**. Esta ruta no es
la vía para revertir una baja. No contradice D1: es moderación de un negocio que
ya existe, no admisión de uno nuevo.

**E10 — Dos llamadas concurrentes con el mismo `externalId` desconocido.** Dadas
dos llamadas simultáneas, entonces queda **un solo** `Business`
(`SELECT count(*) WHERE externalId = … ` = 1), **ninguna responde 500**, una
responde 201 con token y la otra 200 con `token: null`, y el token de la 201
autentica (E2). La perdedora reconoce el P2002 sobre `externalId`, vuelve a
leer y responde como E4.

**E11 — Dos llamadas concurrentes sobre un negocio existente sin token.** Dadas
dos llamadas simultáneas sobre el caso de E3, entonces **exactamente una**
responde 201 y la otra 200 con `token: null`, y el `syncTokenHash` guardado es
el de la que respondió 201 — nunca el de la otra. Es la mitad del problema que
un `SELECT` y luego un `UPDATE` incondicional perdería en silencio: el segundo
llamante se iría con un token que ya no resuelve. R12 lo cierra con un
compare-and-set (`WHERE externalId = … AND syncTokenHash IS NULL`).

**E12 — Colisión del hash acuñado.** Cuando `mintSyncToken()` produce un valor
cuyo hash ya está en la base (P2002 sobre `syncTokenHash`), entonces **503**
`{"error":"TOKEN_COLLISION"}` y **nada queda escrito** —tampoco el `Business`,
si era el caso de E1—; reintentar acuña otro valor. Mismo manejo que
`scripts/mint-sync-token.ts:53-59`. El P2002 sobre `syncTokenHash` y el P2002
sobre `externalId` (E10) se distinguen con `isUniqueViolation(error, target)`
(`src/features/orders/server/prismaErrors.ts:40`): confundirlos convertiría una
carrera normal en un 503.

**E13 — El secreto de aprovisionamiento contra el sync.** Cuando el secreto de
aprovisionamiento se presenta como `Authorization: Bearer <secreto>` a
`GET /api/internal/orders`, entonces **401** `{"error":"UNAUTHORIZED"}` — porque
el hash de ese valor no resuelve ningún `Business`
(`src/features/sync/server/caller.ts:31-42`), y no porque nada lo compruebe
explícitamente. Si **ningún** negocio tuviera token acuñado todavía, ese mismo
intento responde 503 `SYNC_NOT_CONFIGURED`, que es la invariante de siempre: en
ninguno de los dos casos pasa.

**E14 — Un token de negocio contra la ruta de aprovisionamiento.** La mitad
simétrica de E13: cuando el token de sync de un negocio se presenta a la ruta de
aprovisionamiento, entonces **401**, y no se escribe nada. Las dos credenciales
autentican cosas distintas y ninguna sirve en el sitio de la otra (R6).

**E15 — Arranque en frío.** Dada una base donde **ningún** `Business` tiene
`syncTokenHash` —el estado en que `/api/internal/*` responde 503
`SYNC_NOT_CONFIGURED`—, cuando se llama a la ruta de aprovisionamiento con el
secreto correcto, entonces responde 201 igual que en E1, y a partir de ahí
`/api/internal/*` deja de responder 503. El 503 del sync y el 503 del
aprovisionamiento son independientes: cada uno mira su propia configuración
(criterio 6).

**E16 — Método equivocado.** `GET`, `PUT` o `DELETE` sobre la ruta responden
**405** (el App Router lo hace solo al no exportar esos verbos) y no escriben
nada. La ruta es `POST` porque acuña una credencial y crea una fila: el mismo
motivo por el que `POST /api/internal/realtime/credential` no es un `GET`
(`src/app/api/internal/realtime/credential/route.ts:13-16`).

**E17 — El nombre del negocio.** Cuando el cuerpo trae `name`, el `Business`
creado se llama así. Cuando no lo trae, se llama como su `externalId` —el mismo
relleno que pone `scripts/mint-sync-token.ts:45`— y el **primer evento `STORE`**
lo corrige con `payload.businessName`
(`src/features/sync/server/handlers/store.ts:72-76`). Sobre un negocio que ya
existe, `name` **se ignora**: esta ruta no edita negocios (R3 vale para todas
las columnas, no solo para el hash).

## Reglas de negocio

- **R1.** El token en claro se devuelve **exactamente una vez**, en la respuesta
  que lo acuña, y **nunca se guarda**: solo su SHA-256 va a
  `Business.syncTokenHash`. Es la invariante que el guion y el seed ya cumplen
  (R11 de F-018) y no se relaja por cambiar de superficie.
- **R2.** El token lo acuña queandabuscando con `mintSyncToken()`
  (`src/lib/syncAuth.ts:58`), **reutilizada, nunca reimplementada**. Quien llama
  no lo propone ni lo influye: la entropía de una credencial la elige quien la
  verifica.
- **R3.** Registrar es **idempotente y no rota jamás**. Una segunda llamada no
  escribe ninguna columna de `Business` y no devuelve ningún token.
- **R4.** Corolario de R3: **un negocio que ya tiene token nunca recibe otro por
  esta vía.** Si cuadrecaja perdió el valor, la única salida sigue siendo rotar
  con corte desde el guion (§ La arruga conocida del recorte).
- **R5.** El secreto de aprovisionamiento autentica al **integrador**, no al
  negocio. Por eso el `externalId` viaja **en el cuerpo**, y eso **no contradice
  [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md)** —
  § La objeción que todo lector va a tener lo desarrolla.
- **R6.** El secreto de aprovisionamiento **no autentica ninguna ruta de sync**,
  y ningún token de negocio autentica esta ruta (E13, E14). No se comparte ni
  con `SSO_JWT_SECRET` (D2) ni con `CRON_SECRET`: tres valores distintos, tres
  superficies distintas.
- **R7.** La comparación del secreto es **en tiempo constante**:
  `timingSafeEqual` sobre dos buffers de **32 bytes** obtenidos de hashear los
  dos lados con SHA-256. Nunca `===`/`!==` sobre las cadenas, y nunca
  `timingSafeEqual` sobre los valores crudos —lanza si las longitudes difieren, y
  ese throw filtraría la longitud (ADR 0008 § Detalle de implementación).
- **R8.** Secreto **ausente**, vacío, o con una forma que no puede ser un
  SHA-256 hex → **503**, jamás 401 y jamás 200 (E6).
- **R9.** queandabuscando guarda el **SHA-256 del secreto**, no el secreto. Un
  volcado de la configuración de queandabuscando no permite llamar a esta ruta.
  Es la mitad de D4 que sobrevivió a D3 —«volcar la configuración de
  queandabuscando no debe permitir falsificar peticiones»— conseguida sin firma
  asimétrica, y es exactamente el patrón que el token de negocio ya usa: el
  verificador guarda el hash, el llamante guarda el valor.
- **R10.** Toda respuesta lleva `cache-control: no-store`. Devuelve una
  credencial. Precedente: `src/app/api/internal/slug-availability/route.ts:53`.
- **R11.** **Nunca se registra el secreto presentado ni el token acuñado**, ni
  entero ni en trozos. La instrumentación va con
  `console.warn("[provisioning] …")` —nunca `console.error`, y nunca una línea
  que empiece por algo acabado en `Error` (AGENTS.md § Cosas que muerden, ficha
  `.agent/playbook/console-error-dispara-guardian-servidor.md`).
- **R12.** La escritura es **crear-si-no-existe** más **compare-and-set** sobre
  `syncTokenHash IS NULL`. Prohibido el `upsert` con
  `update: { syncTokenHash: hash }` —es lo que hace el guion
  (`scripts/mint-sync-token.ts:43-48`) y en una ruta rota el token vivo de un
  negocio— y prohibido también el `upsert` con `update: {}`, que dejaría a un
  negocio del caso E3 sin token para siempre. La exclusividad la hace cumplir la
  base (los `@unique` de `externalId` y `syncTokenHash`), no un `SELECT` previo
  ([ADR 0018](../../../docs/adr/0018-registro-de-slugs-y-slug-canonico.md) (a)).
- **R13.** La ruta **no toca Prisma**: compone HTTP y llama al módulo de
  servidor (AGENTS.md § Arquitectura, y el mismo corte que
  `src/app/api/internal/_lib/guard.ts` respeta apoyándose en
  `src/features/sync/server/caller.ts`).
- **R14.** `active: false` → **403**, sin acuñar y **sin reactivar** (E9).
- **R15.** Colisión del hash acuñado → **503** y **nada escrito** (E12).
- **R16.** _(D1)_ queandabuscando **no ejerce ni consulta admisión de negocios**:
  no hay lista de permitidos, ni campo que la exprese, ni llamada a cuadrecaja
  para preguntarla. La única palanca de este lado es `Business.active`, y es
  posterior al alta.
- **R17.** `externalId` se **recorta** (`trim`) y se usa tal cual: **no** se
  normaliza el caso ni se transforma. Es el `Negocio.id` del POS y tiene que
  poder compararse con lo que llega en los payloads del sync
  (`src/features/sync/server/caller.ts:13-16`).
- **R18.** `scripts/mint-sync-token.ts` **sobrevive sin cambios**. Un
  aprovisionamiento que solo funciona si cuadrecaja está bien configurado no es
  una vía de rescate.

## La objeción que todo lector va a tener

**«El `externalId` en el cuerpo contradice ADR 0013.»** No lo hace, y conviene
tenerlo escrito antes de que alguien lo "arregle".

Lo que [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md) decide es
que **la identidad del llamante sale del token, nunca del payload**, y su
consecuencia operativa es que un `businessId` del cuerpo que no coincida con el
autenticado es un 403 (`BUSINESS_MISMATCH`). Eso presupone que el credencial
presentado **identifica a un negocio**. Aquí no: el secreto de
aprovisionamiento identifica a **cuadrecaja como integrador**, y el negocio es
el **objeto** de la operación, no el sujeto que la autentica. Si el
`externalId` saliera del credencial, haría falta un secreto por negocio — que es
justo lo que esta ruta existe para crear (huevo y gallina).

Dos consecuencias que sí se siguen de ahí, y que quedan como reglas:

1. Esta ruta **no vive** bajo `/api/internal/*` y **no** usa
   `withInternalAuth`. Ese guard resuelve el negocio desde el hash del token
   presentado, y su docstring lo llama «the shared envelope for EVERY
   /api/internal/\* route» (`src/app/api/internal/_lib/guard.ts:5-17`): meter
   ahí una ruta que se autentica de otra forma rompería esa frase y el test de
   fronteras que la vigila (`src/app/api/internal/boundaries.test.ts:20-22`).
2. Como el secreto no dice de qué negocio se habla, **quien tenga el secreto
   puede nombrar cualquier `externalId`**. Es aceptable por D1 (la admisión vive
   en cuadrecaja) y por D3 (no hay terceros), y su límite está en
   § Lo que esto no protege.

## La arruga conocida del recorte

Sin la tabla `BusinessCredential` **no hay solape**, y de ahí sale una
limitación que conviene decir en voz alta porque parece un olvido:

> A un negocio que **ya** tiene token, esta ruta no le puede dar uno nuevo. Si
> cuadrecaja perdió el valor, la única salida sigue siendo **rotar con corte**
> desde `npm run mint:token -- <externalId>`, con la ventana en la que el outbox
> de ese negocio se acumula y sus pedidos no se recogen
> (`docs/despliegue.md` § 11).

Está previsto en la propuesta
(`.agent/specs/propuestas/credenciales-de-integracion.md` § El recorte de F-034,
«Lo que F-034 no puede hacer»), y es la razón por la que la precondición «CC
puede persistir el token que reciba» es más fuerte aquí que allí. Devolver el
token vigente **no es una alternativa**: solo existe su SHA-256 (R1).

Efecto lateral bueno: R3 deja de ser solo higiene y pasa a ser una **propiedad
de seguridad**. Con el secreto filtrado, quien lo tenga **no** puede pedir el
token de un negocio que ya lo tiene, así que no puede secuestrar el sync de un
comercio en marcha. Ver § Lo que esto no protege para lo que sí puede.

## Casos límite y errores

| Caso                                                   | Respuesta                                  | Se escribe algo                     |
| ------------------------------------------------------ | ------------------------------------------ | ----------------------------------- |
| Secreto no configurado, o no es 64 hex                 | `503 PROVISIONING_NOT_CONFIGURED`          | no — ni se consulta la base         |
| Cabecera ausente / otro esquema / valor equivocado     | `401 UNAUTHORIZED` (mismo cuerpo los tres) | no                                  |
| Token de negocio presentado a esta ruta                | `401 UNAUTHORIZED`                         | no                                  |
| Cuerpo no JSON, sin `content-type`, o mayor de 4 KB    | `400 INVALID_BODY`                         | no                                  |
| `externalId` ausente, vacío, blanco, o mayor de 128    | `400 INVALID_BODY`                         | no                                  |
| `externalId` desconocido                               | `201` con `token`                          | sí: una fila `Business` con su hash |
| `externalId` conocido, `syncTokenHash` nulo            | `201` con `token`                          | sí: solo el hash de esa fila        |
| `externalId` conocido, `syncTokenHash` poblado         | `200` con `token: null`                    | no                                  |
| `Business.active = false`                              | `403 BUSINESS_INACTIVE`                    | no                                  |
| Dos altas concurrentes del mismo `externalId`          | una `201`, otra `200` como E4              | un solo `Business`                  |
| Dos acuñaciones concurrentes sobre un negocio sin hash | una `201`, otra `200`                      | un solo hash, el de la `201`        |
| Colisión de `syncTokenHash`                            | `503 TOKEN_COLLISION`                      | no — todo queda como estaba         |
| Método distinto de `POST`                              | `405`                                      | no                                  |
| `name` sobre un negocio que ya existe                  | se ignora (200 o 201 según el hash)        | no cambia `Business.name`           |

**Reintentos.** Un reintento tras una 201 que cuadrecaja no llegó a leer cae en
E4: **200 con `token: null`**, y el token acuñado queda perdido. No hay `jti`
que consumir ni nada que limpiar, pero tampoco hay forma de recuperarlo — es
exactamente la arruga de arriba, y el motivo por el que la precondición dice
«persistir antes de dar la operación por buena».

**Un `externalId` mal escrito** crea un `Business` que no se puede borrar por
API. No acapara ningún slug —`Business.slug` está retirado y **no entra** en el
registro ([ADR 0018](../../../docs/adr/0018-registro-de-slugs-y-slug-canonico.md)
(a), `prisma/schema.prisma:130-134`)—, así que el daño es una fila huérfana y un
token acuñado que nadie usa. Se limpia por SQL.

## Datos y contrato

**Esquema.** **Ninguna migración.** Se escriben columnas que ya existen:
`Business.externalId`, `Business.name`, `Business.syncTokenHash`
(`prisma/schema.prisma:126-141`). `Business.syncTokenHash` sigue siendo una
columna `String? @unique` — retirarla es de la propuesta, no de aquí.

**Ruta.** `POST /api/provisioning/credential`

**Cabecera.**

```
Authorization: Bearer <secreto de aprovisionamiento, en claro>
Content-Type: application/json
```

El esquema es `Bearer` —el mismo que usa `src/app/api/crons/_lib/guard.ts:14`
para `CRON_SECRET`— por dos motivos: es la cabecera que los proxies y los logs
ya saben que hay que redactar, y el criterio 7 habla de «otro esquema», lo que
presupone que hay uno. Que el sync use la misma cabecera con otro valor no crea
ambigüedad: los dos guards son distintos, viven en rutas distintas y ninguno
acepta el valor del otro (E13, E14, criterio 11).

**Cuerpo de la petición.**

| Campo        | Tipo     | Obligatorio | Límites                                                       |
| ------------ | -------- | ----------- | ------------------------------------------------------------- |
| `externalId` | `string` | **sí**      | no vacío tras `trim`, ≤ 128 caracteres                        |
| `name`       | `string` | no          | no vacío tras `trim`, ≤ 200; ignorado si ya existe el negocio |

Cuerpo completo ≤ **4 KB** (`readJsonBody(request, { maxBytes: 4096 })`,
`src/lib/httpJson.ts:37`).

```jsonc
{
  "externalId": "neg-000123", // el Negocio.id de cuadrecaja
  "name": "Bodega La Rampa", // opcional; relleno = externalId (E17)
}
```

**Por qué el schema no es `strict`.** Con `strip` (el defecto de Zod) una clave
que el schema no conoce se descarta, y el caso que de verdad importa —el typo
`external_id`— **sigue dando 400**, porque `externalId` falta. A cambio,
cuadrecaja puede añadir un campo suyo (una etiqueta, una traza) sin que la ruta
entera empiece a responder 400. El día que un campo se **retire** del contrato,
se prohíbe explícitamente como ya hace `ProductPayload.barcode`
(`src/features/sync/schemas.ts`), no volviendo todo el schema estricto.

**Respuesta 201** (se acuñó un token):

```jsonc
{
  "externalId": "neg-000123",
  "created": true, // ¿se creó también el Business? (false en E3)
  "minted": true,
  "token": "<48 caracteres base64url, la única vez que se ve>",
}
```

**Respuesta 200** (ya tenía token, E4):

```jsonc
{
  "externalId": "neg-000123",
  "created": false,
  "minted": false,
  "token": null,
}
```

Tres decisiones sobre esta forma:

- **`minted` y `created` son dos preguntas distintas**, y por eso son dos
  campos: el caso de E3 es `created: false, minted: true`, así que ni el código
  de estado ni un solo booleano bastan. El `registered` de la propuesta se cae:
  era siempre `true`.
- **No se devuelve `Business.id`** (el uuid interno). No forma parte del
  contrato con cuadrecaja —la identidad que viaja es siempre el `externalId`
  (`src/features/sync/server/caller.ts:13-16`)— y estrenar un identificador
  nuevo en la respuesta invita a que alguien lo empiece a guardar del otro lado.
- **No se devuelve el hash**, ni un prefijo del token, ni una huella. Solo el
  token, y solo cuando se acuña.

**Códigos de error.**

| Código | Cuerpo                                    | Cuándo                                                                                                                                                         |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `{"error":"INVALID_BODY","issues":[…]}`   | Cuerpo no JSON, sin `content-type` JSON, demasiado grande, o que no cumple el schema. `issues` con la forma de `serializableIssues` (`src/lib/httpJson.ts:14`) |
| `401`  | `{"error":"UNAUTHORIZED"}`                | Cabecera ausente, otro esquema, o valor equivocado. **Mismo cuerpo en los tres casos**                                                                         |
| `403`  | `{"error":"BUSINESS_INACTIVE"}`           | El negocio existe con `active: false`. Mismo código y mismo cuerpo que ya usa el sync                                                                          |
| `405`  | (el del framework)                        | Cualquier método distinto de `POST`                                                                                                                            |
| `503`  | `{"error":"PROVISIONING_NOT_CONFIGURED"}` | El secreto no está configurado, o no tiene forma de SHA-256 hex                                                                                                |
| `503`  | `{"error":"TOKEN_COLLISION"}`             | El hash acuñado colisionó con uno existente. Nada escrito; reintentar                                                                                          |

Los nombres siguen el vocabulario que ya existe:
`PROVISIONING_NOT_CONFIGURED` es hermano de `SYNC_NOT_CONFIGURED`
(`src/app/api/internal/_lib/guard.ts:39`) y de `REALTIME_NOT_CONFIGURED`
(`src/app/api/internal/realtime/credential/route.ts:28`); `INVALID_BODY` es
hermano de `INVALID_BATCH` e `INVALID_QUERY` (`docs/sync-contract.md`
§ Vocabulario de errores); `BUSINESS_INACTIVE` y `UNAUTHORIZED` son
**literalmente** los que ya están.

**Configuración.**

| Variable                     | Dónde se lee                                      | Qué contiene                                                    |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `PROVISIONING_SECRET_SHA256` | `process.env`, en el guard de la ruta (por crear) | El **SHA-256 hex** (64 caracteres) del secreto compartido       |
| `QAB_PROVISIONING_SECRET`    | Solo guiones y smokes locales                     | El secreto **en claro**, para poder llamar a la ruta desde aquí |

- **No entra en el esquema de `serverEnv()`.** `src/lib/env.ts:29` parsea el
  esquema **completo** y lanza si falta un campo requerido, así que declararlo
  allí ataría F-034 a F-029 (`passes: false`) sin necesidad. Se lee de
  `process.env` directamente, como `CRON_SECRET` en
  `src/app/api/crons/_lib/guard.ts:11`.
- **Se guarda el digest, no el secreto** (R9). El reparto es el mismo que el del
  token de negocio: cuadrecaja guarda el valor en claro, queandabuscando solo su
  SHA-256. La comparación de R7 hashea el valor presentado de todos modos, así
  que **no cuesta nada**: es una línea del guard y un paso más en
  `docs/despliegue.md`. La pareja `QAB_PROVISIONING_SECRET` (claro, para los
  guiones) / valor hasheado en el servidor repite exactamente lo que
  `.env.example` ya hace con `QAB_BEARER_TOKEN`.
- **Si el valor configurado no es 64 hex**, la ruta responde 503 y avisa una vez
  con `console.warn("[provisioning] …")`. Es el diagnóstico del error más
  probable de este diseño —pegar el secreto en claro donde va su hash— y con un
  401 sería indistinguible de «cuadrecaja se equivocó de valor».
- **No se valida la longitud del secreto en runtime**: `docs/despliegue.md`
  prescribe generarlo con `openssl rand -base64 32`, y un secreto débil es un
  problema de despliegue, no un 503 que nadie sabría leer.

**Contrato con cuadrecaja.** Es una **v10** de `docs/sync-contract.md` (mayor:
hay una ruta nueva, y § Versionado lo llama mayor «sea aditivo o no»; hay que
coordinarla con el otro equipo antes de publicarla, AGENTS.md § Documentación).
Cuatro sitios cambian, y tres de ellos porque hoy dicen algo que dejará de ser
cierto:

1. **§ Autenticación** gana el procedimiento de alta —hoy dice
   «queandabuscando lo acuña, entrega el valor en claro una sola vez» **sin
   decir por dónde**— y tiene que **corregir** la frase «No hay ninguna variable
   de entorno compartida entre los dos proyectos» (I4).
2. **§ Endpoints** gana una sección propia para esta ruta, **fuera** de la tabla
   de las siete y **fuera** del alcance de § Vocabulario de errores, que dice
   «válido para las siete rutas de arriba» (I5).
3. **§ Modos de falla** gana la fila «cuadrecaja perdió el token de un negocio»,
   cuya recuperación es la de § La arruga conocida del recorte, y no esta ruta.
4. **§ Verificación** deja de presentar `npm run mint:token` como el único
   camino (I6).

**Despliegue.** `docs/despliegue.md` § 8.1 pasa a tener dos vías —la ruta, y el
guion como rescate—, § 9 punto 1 deja de decir «lo creó `mint:token`», y el
secreto nuevo se documenta con su generación, su reparto y su rotación (que es
un cambio coordinado: rotarlo deja a cuadrecaja sin poder dar de alta hasta que
guarde el nuevo, sin afectar a ningún sync en marcha).

## Criterios de aceptación propuestos

Los 14 de `features.json` van `[ya]`, literales, con lo que se ejecuta para cada
uno. `BASE` es `http://localhost:3000`, `SECRET` el secreto en claro
(`QAB_PROVISIONING_SECRET`), `SQL` una consulta contra la base local.

1. `[ya]` «POST a la ruta de aprovisionamiento con el secreto correcto y un
   externalId que no existe responde 201 con un token no vacio, y queda
   exactamente una fila nueva de Business con ese externalId.» →
   `curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/provisioning/credential" -H "authorization: Bearer $SECRET" -H 'content-type: application/json' -d '{"externalId":"f034-alta-1"}'`
   = `201`, cuerpo con `.token` de 48 caracteres, y
   `SELECT count(*) FROM "Business" WHERE "externalId" = 'f034-alta-1'` = 1.
2. `[ya]` «Ese token autentica de verdad: node scripts/send-catalog-batch.mjs
   --token=<el devuelto> responde 207.» → **ver I8**: el guion fija
   `businessId: "seed-negocio-1"`, así que se ejecuta con el token del criterio
   5 (`UPDATE "Business" SET "syncTokenHash" = NULL WHERE "externalId" = 'seed-negocio-1'`
   y luego el alta de ese `externalId`), no con el del criterio 1.
3. `[ya]` «Repetir la MISMA llamada responde 200 con token null, y el
   syncTokenHash de la base es identico antes y despues.» → el mismo `curl` otra
   vez = `200`, `.token` es `null`, y el `syncTokenHash` leído por `SQL` antes y
   después es la misma cadena.
4. `[ya]` «Tras esa repeticion, el token de la primera llamada sigue
   respondiendo 207: registrar no rota nunca.» →
   `node scripts/send-catalog-batch.mjs --token=<el del criterio 2>` = `207`
   después del criterio 3.
5. `[ya]` «Sobre un negocio que ya existe pero no tiene syncTokenHash, la
   llamada responde 201 con token y no crea ningun Business nuevo.» → con
   `syncTokenHash` a `NULL` por `SQL`, el `curl` = `201` con token, y
   `SELECT count(*) FROM "Business"` es el mismo antes y después.
6. `[ya]` «Sin el secreto configurado en el servidor la ruta responde 503 y no
   escribe nada, y las rutas de /api/internal/\* con un token valido siguen
   respondiendo lo suyo.» → con la variable sin definir, `curl` = `503` con
   `{"error":"PROVISIONING_NOT_CONFIGURED"}`, `SELECT count(*) FROM "Business"`
   sin cambio, y `node scripts/send-catalog-batch.mjs` = `207`.
7. `[ya]` «Con el secreto configurado, una cabecera ausente, con otro esquema y
   con un valor equivocado dan 401 con el mismo cuerpo en los tres casos, y no
   se escribe nada.» → tres `curl` (sin `-H authorization`, con
   `-H "authorization: Basic $SECRET"`, con
   `-H "authorization: Bearer no-es-el-secreto"`) = `401` los tres, y
   `diff` de los tres cuerpos vacío.
8. `[ya]` «Un cuerpo sin externalId, con externalId vacio, o que no es JSON,
   responde 400 y no crea ningun Business.» → tres `curl` (`-d '{}'`,
   `-d '{"externalId":"   "}'`, `-d 'no-json'`) = `400` los tres con
   `.error == "INVALID_BODY"`, y `SELECT count(*) FROM "Business"` sin cambio.
9. `[ya]` «Sobre un Business con active false la ruta responde 403 y no acuña:
   su syncTokenHash queda como estaba.» → se da de baja la fila por `SQL`
   (`SET "active" = false`), el `curl` = `403` con
   `{"error":"BUSINESS_INACTIVE"}`, y el `syncTokenHash` es idéntico antes y
   después.
10. `[ya]` «Dos llamadas concurrentes con el mismo externalId desconocido dejan
    UN solo Business, ninguna responde 500, y el token devuelto autentica.» →
    dos `curl` en paralelo con el mismo `externalId` nuevo: los códigos son
    `{201,200}`, `SELECT count(*)` = 1, y el token de la `201` autentica.
11. `[ya]` «El secreto de aprovisionamiento no autentica ninguna ruta de
    /api/internal/\*: enviarlo como Bearer a GET /api/internal/orders responde
    401.» →
    `curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/internal/orders?since=0" -H "authorization: Bearer $SECRET"`
    = `401`.
12. `[ya]` «La comparacion del secreto es en tiempo constante: grep de
    timingSafeEqual sobre el guard de la ruta no sale vacio.» →
    `grep -n timingSafeEqual src/app/api/provisioning/_lib/guard.ts` no vacío.
13. `[ya]` «La ruta, su cuerpo, sus codigos y el procedimiento de alta estan en
    docs/sync-contract.md con la version movida, y el secreto nuevo esta en
    docs/despliegue.md.» → `grep -n "Versión 10" docs/sync-contract.md` y
    `grep -n "PROVISIONING_SECRET_SHA256" docs/despliegue.md .env.example` no
    vacíos.
14. `[ya]` «bash .agent/verify.sh F-034 --full termina con codigo 0.»

Y los que se proponen al humano, todos ejecutables:

15. `[nuevo]` **La carrera del criterio 5.** Dos llamadas concurrentes sobre un
    negocio que existe **sin** `syncTokenHash`: exactamente una responde `201` y
    **su** token autentica (`207`); la otra responde `200` sin token. Es la única
    carrera que podría entregar un token que no resuelve (E11), y la que un
    `SELECT` seguido de un `UPDATE` incondicional perdería.
16. `[nuevo]` **La mitad simétrica del criterio 11.** El token de sync de
    `seed-negocio-1` presentado a `POST /api/provisioning/credential` responde
    `401` y no escribe nada (E14).
17. `[nuevo]` **`cache-control: no-store`** en las respuestas `201`, `200` y
    `401` de la ruta: `curl -sSD - -o /dev/null` los muestra (R10).
18. `[nuevo]` **Colisión del hash acuñado**: con `mintSyncToken` forzada a
    devolver un hash que ya está en la base, la ruta responde `503` con
    `{"error":"TOKEN_COLLISION"}` y `SELECT count(*) FROM "Business"` no cambia
    (E12). Es una prueba de unidad o de base, no un `curl`.
19. `[nuevo]` **El secreto configurado en claro por error** (no 64 hex) responde
    `503`, no `401` (E6, segunda mitad) — es el diagnóstico de R9.
20. `[nuevo]` **El nombre**: el alta de un `externalId` nuevo que lleve
    `"name": "Bodega La Rampa"` deja ese valor en `Business.name`; sin `name`,
    deja ahí el propio `externalId`; y sobre un negocio que ya existe, `name`
    **no** cambia la fila (E17).

## Incongruencias detectadas

**I1 — `scripts/mint-sync-token.ts:43-48` siempre rota, y es el código que
alguien va a copiar.** Su `update: { syncTokenHash: hash }` es correcto para un
comando que un humano ejecuta a sabiendas, y es un fallo silencioso en una ruta:
un reintento de cuadrecaja invalidaría el token que la primera llamada ya
entregó. R12 lo prohíbe explícitamente. **El código que sí hay que copiar es
`prisma/seed.ts:1051-1065`** (`ensureSyncToken`), que implementa exactamente la
semántica que este feature necesita —«acuña SOLO si todavía no tiene
`syncTokenHash`»— y que no se parece a la del guion.

**I2 — Habrá cuatro escritores de `syncTokenHash`.** Hoy son tres:
`scripts/mint-sync-token.ts:43`, `prisma/seed.ts:1058` y
`src/features/marketplace/server/dbFixtures.ts:197`. Este feature añade el
cuarto. Ninguno comparte código de escritura, aunque los cuatro comparten
`mintSyncToken()` (R2, y eso es lo que de verdad importa). No se propone
unificarlos aquí —el seed y las fixtures crean el negocio entero con muchas más
columnas, y el guion tiene que poder rotar, que la ruta no— pero conviene que la
arquitectura lo decida a propósito y no por omisión.

**I3 — `src/app/api/crons/_lib/guard.ts:14` compara con `!==` y responde 401 sin
secreto.** Dos divergencias respecto a lo que hace F-034, y las dos a propósito:

- La comparación **no** es en tiempo constante, lo que contradice
  [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md) § Detalle de
  implementación («comparado en tiempo constante»). El criterio 12 exige
  `timingSafeEqual` en el guard **nuevo**; el de crons queda como está.
- Con `CRON_SECRET` ausente responde **401**, no 503, lo que contradice la
  invariante de ADR 0008 («un token ausente jamás puede significar deja pasar
  todo, y un 401 escondería un deploy roto»). F-034 **diverge a propósito** y
  responde 503 (R8, E6): el llamante de crons es Vercel —que no sabe leer un
  503— mientras el de esta ruta es cuadrecaja, que sí, y para quien la
  diferencia entre «no me has configurado» y «tu secreto está mal» es la
  diferencia entre avisar al otro equipo y revisar su propia configuración.

**No se arregla aquí.** Es una incongruencia preexistente en una ruta con otro
llamante y otro alcance; tocarla mete a F-034 en el camino de los crons sin que
ningún criterio lo pida.

**I4 — `docs/sync-contract.md` § Autenticación dice algo que ya es falso.** «No
hay ninguna variable de entorno compartida entre los dos proyectos» — pero
`.env.example` dice de `SSO_JWT_SECRET`: «Must match cuadrecaja's own
SSO_JWT_SECRET exactly». Ya hay una hoy; F-034 añade la segunda. La v10 tiene
que **acotar** la frase a lo que quiso decir: no hay ninguna variable de entorno
compartida **para el token de negocio** — cada negocio guarda el suyo.

**I5 — § Vocabulario de errores dice «válido para las siete rutas de arriba».**
La ruta nueva es la octava, con **otra** autenticación y **otro** vocabulario
(`PROVISIONING_NOT_CONFIGURED` en vez de `SYNC_NOT_CONFIGURED`, `INVALID_BODY`
en vez de `INVALID_BATCH`). Si se mete en esa tabla, un lector aplicará el
`401`/`503` del sync a una ruta que no los usa. La v10 le da sección propia.

**I6 — Tres sitios presentan el guion como el único camino, y uno de ellos es
una precondición.** `docs/sync-contract.md` § Verificación
(«el token de seed-negocio-1 acuñado (`npm run mint:token -- seed-negocio-1`)»),
`docs/despliegue.md` § 8.1, y `docs/despliegue.md` § 9 punto 1 («El negocio
existe (lo creó `mint:token`, §8.1)»). Los tres dejan de ser la única verdad. El
criterio 13 cubre los dos documentos, no las tres frases: conviene que quien
implemente las busque una a una.

**I7 — `docs/despliegue.md` § 8.3 dice «La versión vigente es la v6 (F-031)» y
el contrato está en la v9.** Deriva preexistente, de tres versiones. F-034
escribe justo al lado (§ 8.1 y § 8.3) y va a publicar una v10: dejarla en v6
mientras se escribe la v10 es la clase de detalle que hace que el otro equipo
deje de creerse el documento. Se arregla de paso.

**I8 — El criterio 2 no se puede ejecutar con el token del criterio 1.**
`scripts/send-catalog-batch.mjs:56` fija `const businessId = "seed-negocio-1"`,
y `/api/internal/sync/catalog` responde **403 `BUSINESS_MISMATCH`** cuando el
`businessId` del cuerpo no es el del negocio autenticado
(`docs/sync-contract.md` § Vocabulario de errores). Un token acuñado para un
`externalId` **nuevo** —que es lo que pide el criterio 1— daría 403, no 207.

Dos formas de que el criterio se pueda ejecutar tal como está escrito:

- **(a) Recomendada.** Ejecutarlo sobre el camino del **criterio 5**: poner
  `syncTokenHash` a `NULL` en `seed-negocio-1` por SQL, dar de alta ese
  `externalId` por la ruta, y usar el token que devuelve. El comando del criterio
  2 vale **literal**, sin tocar ningún guion. Es el mismo patrón de «prepara el
  estado por SQL» que ya usa F-031 con el modo de envío cotizado
  (`docs/sync-contract.md` § El envío sin cotizar).
- **(b)** Añadir `--business=<externalId>` a `scripts/send-catalog-batch.mjs`.
  Es útil y barato, pero entonces el comando del criterio ya no es el que está
  escrito.

**Aviso para quien lo ejecute**: la vía (a) **rota el token de
`seed-negocio-1`**, que es el que llevan los `.env` de los demás worktrees.
Es exactamente la trampa de
`.agent/playbook/mint-token-rota-el-token-en-bd-compartida.md`, por otro camino:
hay que actualizar `QAB_BEARER_TOKEN` con el valor nuevo después.

**I9 — `console.error` está prohibido y el repo lo usa en los dos archivos que
esta ruta va a imitar.** AGENTS.md § Cosas que muerden es explícito: «toda
instrumentación de servidor usa `console.warn` con un prefijo `[scope]` literal,
nunca `console.error`», porque el guardián de las etapas que levantan la app
marca la etapa entera en rojo. Y aun así lo usan
`src/app/api/internal/_lib/guard.ts:36,48` y
`src/app/api/internal/realtime/credential/route.ts:24`. Hoy no ponen nada en
rojo por suerte —`SERVIDOR_ERROR_RE` (`.agent/verify.sh:43`) exige `⨯`,
`Unhandled` o una línea que **empiece** por algo acabado en `Error`, y esos
mensajes empiezan por `[internal]`/`[realtime]`—, pero es una bomba con la mecha
en el texto del mensaje. **El guard nuevo usa `console.warn` (R11)** aunque el
archivo del que copia la forma no lo haga. Los dos existentes no se tocan aquí.

**I10 — Ningún test de fronteras vigilará la ruta nueva.**
`src/app/api/internal/boundaries.test.ts:20-22` afirma, leyendo el disco, que
**toda** ruta bajo `/api/internal` exporta por `withInternalAuth` y que ninguna
importa Prisma. La ruta nueva vive fuera de ese directorio a propósito
(§ La objeción que todo lector va a tener), así que hereda **cero** de esas dos
garantías. Recomendación para arquitectura y pruebas: extender ese mismo test
—o uno gemelo— con `/api/provisioning`, exigiendo que toda ruta de ahí pase por
el guard nuevo y no importe Prisma (R13). Sin eso, la segunda ruta que alguien
añada ahí puede olvidarse el guard y nada se pondrá rojo.

**I11 — El `name: externalId` de relleno tiene sentido en un guion y menos en
una ruta.** En el guion lo ve la persona que lo ejecuta; en una ruta, cada
negocio que cuadrecaja dé de alta nace llamándose como su `Negocio.id` hasta el
primer evento `STORE`. Hoy el daño es cosmético —`Business.name` **no tiene
ningún lector** en la aplicación: su único escritor es
`src/features/sync/server/handlers/store.ts:74` y las vistas usan
`Storefront.name`— y por eso **no** se convierte en un campo obligatorio, que
sería contrato nuevo. Se resuelve con el `name` **opcional** del cuerpo (E17,
criterio 20). Cierra SP6 de la propuesta, que recomendaba llevarlo en el JWT.

**I12 — La palabra `credential` ya nombra otra cosa en el repo.**
`POST /api/internal/realtime/credential`
(`src/app/api/internal/realtime/credential/route.ts`) acuña la credencial de
Realtime, con otra autenticación y otro sujeto. La ruta nueva
—`/api/provisioning/credential`— es distinguible por su prefijo, y el prefijo es
lo que importa (es lo que decide qué guard corre). Se anota porque en una
conversación oral «el endpoint de credential» pasará a ser ambiguo, no porque
haya que renombrar nada.

**I13 — A favor de
[ADR 0002](../../../docs/adr/0002-el-pos-inicia-todas-las-llamadas.md) y de
[ADR 0005](../../../docs/adr/0005-dos-sistemas-de-auth.md).** Conviene decirlo
porque parece lo contrario: esta ruta **añade** una llamada en la dirección que
ADR 0002 ya fija (el POS llama, queandabuscando nunca llama a cuadrecaja), y el
comando manual es lo que hoy queda **fuera** de ese modelo. Y no crea una
tercera población de auth (ADR 0005): no hay sesión, no hay cookie, no hay
usuario — es una credencial de máquina a máquina más, como la de ADR 0008.

**I14 — La puerta comercial de hoy es involuntaria.** Que el alta exija un acto
manual de queandabuscando funciona, de facto, como control de admisión, y **no
lo decidió nadie**: no está en ADR 0013 —que decide el grano del token, no quién
puede obtenerlo— ni en ninguna otra. Construir esto **elimina** una barrera que
estaba ahí por accidente (D1 lo decide explícitamente, R16). Conviene contarlo
así y no como si se relajara algo que alguien acordó.

## Lo que esto no protege

Va aparte para que nadie lo lea de más. El secreto permite comprobar que una
petición de alta viene de cuadrecaja. No hace nada de esto:

- **No prueba que un humano autorizado lo disparó.** El secreto demuestra
  posesión del secreto. Que dentro de cuadrecaja el superadministrador pulsara
  el botón es responsabilidad de cuadrecaja, y D1 la puso allí a propósito.
- **No sobrevive a una filtración del lado de queandabuscando... salvo por R9.**
  Con el digest guardado en vez del secreto, un volcado de la configuración de
  queandabuscando **no** permite llamar a la ruta. Lo que sí basta es una
  filtración del lado de cuadrecaja, o del canal por donde se repartió. Es la
  diferencia que la firma asimétrica de D4 habría cerrado del todo y que D8
  aceptó a cambio de simplicidad, con el argumento de que los devs son los
  mismos a los dos lados.
- **No protege las siete rutas de sync.** Después del alta, todo sigue siendo un
  `Bearer` sin firma, sin marca de tiempo y sin ventana de replay. Eso lo cierra
  el HMAC de [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md), que
  sigue abierto.
- **Con el secreto filtrado, se pueden crear negocios** —filas huérfanas, ruido—
  y **acuñar el token de un negocio que existe sin token** (el caso E3), que es
  la única forma de robar el sync de un negocio ya conocido. Lo que **no** se
  puede es tocar un negocio que ya tiene token (R3/R4): eso es lo que convierte
  la idempotencia en una propiedad de seguridad.
- **No impide el acaparamiento de slugs**, pero tampoco lo abre: un `Business`
  no reserva slug ninguno (`prisma/schema.prisma:130-134`), así que acaparar
  exige además publicar tiendas por el sync. Quien tenga el secreto puede
  llegar hasta ahí, y
  [ADR 0018](../../../docs/adr/0018-registro-de-slugs-y-slug-canonico.md) (a)
  decide que un valor retirado **no vuelve al pool**: el daño sería
  irreversible.

## Huecos y preguntas al humano

**Ninguna bloqueante.** Las tres cosas que la propuesta dejaba abiertas para
esta mitad las cerró el humano el 2026-09-03 (D6, D7, D8) y el resto se ha
cerrado con recomendación, como pidió:

- **El nombre del negocio** (SP6 de la propuesta) → `name` opcional en el
  cuerpo, relleno `externalId`, ignorado si el negocio ya existe (E17, I11).
- **Cómo se ejecuta el criterio 2** → por el camino del criterio 5, sin tocar
  ningún guion (I8, vía (a)).
- **Si el secreto se guarda en claro o hasheado** → hasheado (R9). Es una línea
  del guard y un paso de `docs/despliegue.md`, y a cambio la configuración de
  queandabuscando deja de ser material con el que llamar a la ruta. **Si el
  orquestador prefiere el valor en claro**, lo que cambia es una línea del guard
  y el nombre de la variable; nada más de esta especificación depende de ello.

Dos avisos que **no** son preguntas pero necesitan una acción humana:

- La **v10 es mayor** y AGENTS.md § Documentación exige coordinarla con el
  equipo de cuadrecaja **antes** de publicarla. Hay precedente de publicar antes
  de implementar (la v6, marcada a propósito en la cabecera del contrato), pero
  la decisión es del humano.
- El **secreto hay que repartirlo**: sin que cuadrecaja lo tenga, la ruta existe
  y no la llama nadie.

## No decidido a propósito

- **Rotación y revocación del token de negocio.** Siguen en
  `.agent/specs/propuestas/credenciales-de-integracion.md` con su tabla, su
  solape y su tope de credenciales vivas. Si se construyen, **D8 se reabre**:
  ahí sí hay tres acciones con consecuencias distintas y quién decide cuál
  debería ser el firmante, no el transporte.
- **Rotación del secreto de aprovisionamiento.** Hoy es un cambio coordinado con
  corte, igual que el token de negocio. Admitir dos valores a la vez es aditivo
  (una lista de digests) y no hace falta hasta que alguien lo pida.
- **Consolidar los cuatro escritores de `syncTokenHash`** (I2). Lo decide
  arquitectura.
- **Un test de fronteras para `/api/provisioning`** (I10). Se recomienda; lo
  decide arquitectura y lo escribe pruebas.
- **Observabilidad**: cuántas altas, cuántos 401, cuántos 503. Encaja con lo que
  propone `.agent/specs/propuestas/enlace-de-pedido-observable.md` y no se
  adelanta aquí.
- **Borrar o desactivar un negocio por API.** No hay `DELETE` y no hay quien lo
  pida. Un `externalId` mal escrito se limpia por SQL.
