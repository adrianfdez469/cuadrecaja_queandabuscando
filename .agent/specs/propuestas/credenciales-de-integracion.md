---
propuesta: credenciales-de-integracion
agente: orquestador
actualizado: 2026-09-03T00:00:00Z
estado: propuesta
---

> Tercera y última forma de esta propuesta, escrita el mismo día que las dos
> anteriores y con el mismo problema de fondo. `aprovisionamiento-desde-el-pos.md`
> lo encuadró como «dar de alta un negocio»;
> `clientes-autorizados-de-un-negocio.md` lo amplió a «registrar sistemas
> clientes» cuando el humano mencionó una APK o un tercero. Al responder SP3 —
> **«no va a existir un tercero: siempre serán CC y QAB»**— esa ampliación se
> quedó sin sujeto y esta versión la recorta. Las dos anteriores se borraron;
> ninguna llegó a estar en git.
>
> Origen: conversación con el humano el 2026-08-30. La escribe el orquestador,
> no `sdd-spec`: no ha pasado por el ciclo de spec.

> **Su primera mitad se aceptó y es F-034 (2026-09-03).** El humano recortó el
> alcance a **solo el alta** —«enfoquémonos en la primera parte»— y decidió las
> dos cosas que quedaban abiertas de ella: el disparador y la forma de la
> credencial (D6, D7, D8 abajo). Lo que **sigue siendo propuesta** es la segunda
> mitad: la tabla `BusinessCredential`, la rotación con solape y la revocación,
> o sea el problema 2 de § Problema. Esta propuesta no se archiva por eso —
> `Business.syncTokenHash` sigue siendo una columna y rotar sigue sin tener
> solape.
>
> Qué se movió a F-034 y qué se quedó aquí está en § El recorte de F-034.

## Decisiones ya tomadas

| Id     | Decisión                                                                      | Quién y cuándo                                           |
| ------ | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| **D1** | No hay puerta comercial del lado de QAB. La admisión existe y vive en CC      | humano, 2026-08-30 (SP1)                                 |
| **D2** | Credencial propia para esta ruta, distinta del secreto del SSO                | humano, 2026-08-30 (SP2)                                 |
| **D3** | **No habrá terceros. Siempre serán CC y QAB**                                 | humano, 2026-08-30 (SP3) — corrige la versión 2          |
| **D4** | Firma **asimétrica**: CC firma con su privada, QAB solo guarda la pública     | orquestador — **vetable**, ver abajo                     |
| **D5** | El futuro son tiendas nativas de QAB, y **no se prepara terreno ahora**       | humano + orquestador, 2026-08-30                         |
| **D6** | El alcance se parte: **solo el alta** es F-034; rotación y solape siguen aquí | humano, 2026-09-03                                       |
| **D7** | El disparador es el superadministrador de CC, **una vez por negocio**         | humano, 2026-09-03 — cierra la ambigüedad de § La trampa |
| **D8** | **D4 queda vetado para F-034**: secreto simétrico en una cabecera             | humano, 2026-09-03 (SP7)                                 |

**D4 dejó de ser una consecuencia forzada y es ahora un juicio de valor.** Su
argumento tenía dos patas y D3 le quitó una:

- ~~«hay que distinguir un cliente de otro y revocarlos por separado»~~ — sin
  terceros, no hay a quién distinguir.
- «volcar la configuración de queandabuscando no debe permitir falsificar
  peticiones» — **sigue en pie**, y es independiente de cuántos clientes haya.

Con un único cliente, un secreto simétrico también separa «CC» de «no CC». Lo
que no hace es sobrevivir a una filtración **del lado de QAB**: los dos
extremos guardarían el mismo valor. Como esa era literalmente la pregunta del
humano —«¿qué impide que este proceso lo ejecute alguien que no esté en CC?»—,
se recomienda asimétrica, y se marca vetable porque ya no la fuerza nada.

## Problema

**1. La credencial solo se puede acuñar a mano.**
`npm run mint:token -- <externalId>` (`scripts/mint-sync-token.ts`) es la única
vía: `mintSyncToken()` tiene tres puntos de llamada —el guion,
`prisma/seed.ts:1028` y las fixtures de
`src/features/marketplace/server/dbFixtures.ts:190`— y ninguno es una ruta. Y
como desde F-018 el sync ya no crea negocios
(`src/features/sync/server/handlers/store.ts:54-56`, R8/E16), ese comando **es
también el alta del negocio**. El paso 0 de toda la integración es un
desarrollador con `DATABASE_URL` de producción abriendo una terminal, una vez
por comercio.

**2. Rotar tiene ventana de corte, y depende de la misma persona.** Rotar es la
recuperación que `docs/sync-contract.md` § Modos de falla prescribe para «el
token de un negocio se filtró». Hoy, además de exigir esa terminal, es un
cambio **instantáneo**: `Business.syncTokenHash` es una columna
(`prisma/schema.prisma:130`), así que el valor viejo deja de resolver en el
mismo instante en que se escribe el nuevo (`src/features/sync/server/caller.ts:33`
busca por hash exacto). Si CC no persiste el valor nuevo a tiempo, se queda sin
sync sin que nadie lo note hasta el siguiente `401`.

El segundo problema es el que decide la forma de la solución. El primero, solo,
admitía una ruta y nada más.

## Alcance

### Dentro

- **Una tabla de credenciales por negocio** que reemplaza a
  `Business.syncTokenHash`, con alta, rotación y revocación **independientes por
  fila**, y con las revocadas conservadas para poder auditar.
- **Rotación con solape**: durante una ventana acotada conviven la credencial
  vigente y la entrante, para que CC pueda recogerla y guardarla antes de
  retirar la vieja. Es la mitad valiosa de la versión anterior, y la única que
  sobrevive a D3.
- **Una ruta con tres acciones** —registrar, rotar, revocar— que CC llama
  firmando (D4). Registrar crea el `Business` si no existe (D1) y devuelve el
  token en claro **una sola vez**.
- **Semántica de crear-si-no-existe, NUNCA rotar.** Ver § La trampa.
- **La migración** de lo que ya existe: el `syncTokenHash` de cada negocio pasa
  a una fila de la tabla nueva, los tokens vivos siguen funcionando, y la
  columna se retira.
- **`resolveCaller()` resuelve contra la tabla**, ignorando las revocadas.
- **El comando sobrevive**, adaptado: es la vía de rescate cuando CC no puede
  llamar.
- **Una versión nueva de `docs/sync-contract.md`.**

### Fuera (explícito)

- **Cualquier preparación para tiendas nativas de QAB** (D5). Ver § El futuro
  que no se prepara aquí — es la sección que explica por qué esto sería trabajo
  perdido, no prudencia.
- **Una tabla de sistemas clientes con clave pública por integrador.** Era el
  centro de la versión anterior y D3 la deja sin sujeto: hay un cliente, su
  clave es una variable de entorno.
- **Alcances por credencial.** Con un solo cliente no hay dos perfiles de
  permiso que distinguir. Deja de ser una pregunta abierta: se cierra en
  § No decidido.
- **Ejercer o consultar la admisión de negocios** (D1). Preguntarla además
  violaría [ADR 0002](../../../docs/adr/0002-el-pos-inicia-todas-las-llamadas.md).
- **El HMAC de [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md) sobre
  las siete rutas.** D4 protege el **alta y la rotación**, no las llamadas de
  después. Esta propuesta **no cierra** ADR 0008. Ver § Lo que esto no protege.
- **Revocar desde el panel de administración.** Exigiría decidir qué
  administrador puede cortarle el sync a su propio negocio.
- **Tocar el SSO del panel.** Comparte el patrón; no comparte ruta, ni claves,
  ni payload.
- **Borrar `scripts/mint-sync-token.ts`.** Un aprovisionamiento que solo
  funciona si CC está bien configurado no es una vía de rescate.

## El recorte de F-034

D6 partió esta propuesta en dos. Lo que se construye ahora, y lo que se queda
esperando:

| Pieza                                               | Dónde vive ahora                     |
| --------------------------------------------------- | ------------------------------------ |
| Una ruta que da de alta el negocio y acuña su token | **F-034**                            |
| Crear el `Business` si no existe (D1)               | **F-034**                            |
| Idempotencia: registrar no rota jamás (R3)          | **F-034**                            |
| El token en claro una sola vez (R1, R2)             | **F-034**                            |
| Credencial propia, distinta del SSO (D2)            | **F-034**, ya como secreto simétrico |
| Tabla `BusinessCredential`                          | sigue aquí                           |
| Rotación con solape y revocación (E3, E4, E5, R9)   | sigue aquí                           |
| Retirar `Business.syncTokenHash`                    | sigue aquí                           |
| `resolveCaller()` contra la tabla                   | sigue aquí                           |
| El HMAC de ADR 0008 (SP5)                           | sigue aquí, sin decidir              |

**Qué cambia D7 en § La trampa.** Esa sección daba por hecho que el disparador
era «el administrador abre su tienda», o sea una llamada **por sucursal**. El
humano decidió lo contrario: lo dispara el superadministrador de cuadrecaja **una
vez por negocio**. El argumento del segundo `upsert` que rompe el sync de la
primera sucursal, por tanto, **no aplica a F-034** — pero R3 sigue siendo
obligatoria por una razón más simple: un reintento de CC (timeout, respuesta
perdida, doble pulsación) invalidaría el token que la primera llamada ya
entregó. La regla es la misma; el motivo que la sostiene, no.

**Qué cambia D8.** Con el alcance recortado a una sola acción sin consecuencias
destructivas, la firma asimétrica dejó de pagar su complejidad: no hay `action`
que proteger dentro de un JWT, no hay rotación que un tercero pudiera disparar, y
el equipo es el mismo a los dos lados. F-034 usa un secreto compartido en una
cabecera, comparado en tiempo constante. **Si algún día se le añade la rotación
de esta propuesta, D8 se reabre**: ahí sí hay tres acciones con consecuencias
distintas y quién decide cuál debería ser el firmante, no el transporte.

**Lo que F-034 no puede hacer, y esta propuesta sí preveía.** Devolver el token
de un negocio que ya lo tiene. Sin la tabla no hay solape, así que la única forma
de darle a CC un token que perdió sigue siendo rotar con corte, desde el guion.
Es la arruga conocida del recorte y está anotada en el `spec.md` de F-034.

## La trampa que hace que esto no sea trivial

El comando de hoy hace, en `scripts/mint-sync-token.ts:43-46`:

```ts
await prisma.business.upsert({
  where: { externalId },
  create: { externalId, name: externalId, syncTokenHash: hash },
  update: { syncTokenHash: hash }, // ← sobre un negocio existente, SIEMPRE rota
});
```

Correcto para un comando que alguien ejecuta sabiendo lo que hace. Pero el
disparador natural del lado de CC —«el administrador abre su tienda»— **no
ocurre una vez por negocio: ocurre una vez por sucursal**. Una ruta que copiara
ese `upsert` rompería el sync en cuanto el negocio abriera su segunda tienda: el
token que la primera está usando dejaría de valer, en silencio, hasta que CC
recogiera el nuevo. El síntoma sería un `401` en el drenaje del outbox de una
sucursal que llevaba semanas funcionando.

De ahí R3: **registrar es idempotente y no rota jamás**. El criterio 4 existe
solo para fijarlo.

## La admisión: existe, y no vive aquí

D1 la resolvió, y queda escrita porque hasta ahora era una conducta de facto que
nadie había decidido (§ Incongruencias, 2).

**Hay control de admisión, pero es de cuadrecaja.** Un super-administrador
habilita «publicar en tienda» para negocios concretos, con una configuración a
nivel de sistema. Ocurre entero del otro lado: queandabuscando no lo ve, no lo
consulta y no lo replica. **Para queandabuscando, cualquier negocio que llegue
con una firma válida tiene luz verde.**

Es coherente con lo que la integración ya hace: la identidad del llamante sale
del token y el contenido de la decisión es de quien la toma
([ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md)). Replicar aquí
una lista de negocios permitidos sería la misma clase de error que replicar los
hashes de contraseña que
[ADR 0005](../../../docs/adr/0005-dos-sistemas-de-auth.md) descartó: duplicar
una fuente de verdad y quedarse con la copia rancia.

Con D3, la segunda puerta que la versión anterior destapó —«¿quién autoriza a un
integrador nuevo?»— **desaparece**: no hay integradores nuevos que autorizar.

## El futuro que no se prepara aquí

D5 merece su sección porque es lo que evita que alguien intente encajarlo en
esta propuesta más adelante.

El humano describió lo que sí podría venir: **tiendas que no estén asociadas a
ningún negocio en CC**, administradas desde un panel propio de queandabuscando.
Eso **no es otro cliente de la integración**: es que queandabuscando deje de ser
un espejo de cuadrecaja y pase a ser una plataforma por su cuenta. Cuatro cosas
lo bloquean hoy, y ninguna es una credencial:

1. **`externalId` es obligatorio.** `Business.externalId`
   (`prisma/schema.prisma:120`) y `Store.externalId` (`:205`) son
   `String @unique`, sin `?`. Una tienda nativa no tiene qué poner ahí.
2. **Nadie podría escribir su catálogo.** `StoreProduct` separa sus columnas de
   forma explícita: `localName`, `syncedPrice`, `availability` y
   `sourceUpdatedAt` van bajo `// --- owned by the sync; never edited here ---`,
   y la lista blanca del panel las prohíbe **por tipos** — ponerlas es un error
   de compilación, no un descuido (ADR 0017 (a),
   `src/features/admin/server/mutations.ts:57-59`). Una tienda sin sync no tiene
   quién le ponga nombre ni precio a un producto.
3. **Sus pedidos no los vería nadie.** El pull lo hace CC, y CC no conoce ese
   negocio: se quedarían en `PENDING` para siempre. El panel de QAB **no tiene
   ninguna pantalla de pedidos**, porque hoy no hace falta.
4. **Su dueño no podría entrar al panel.** La sesión nace de un SSO firmado por
   CC, y `/admin/sso` deniega con `unknown_business` si el negocio no existe
   aquí (`src/app/admin/sso/route.ts:45`). Un comerciante sin `Negocio` en CC no
   tiene forma de iniciar sesión.
   [ADR 0005](../../../docs/adr/0005-dos-sistemas-de-auth.md) fija dos
   poblaciones —compradores y administradores vía cuadrecaja—; esta sería una
   tercera que ninguna cubre. Es una ADR nueva, no un ajuste.

**Por qué no se deja terreno preparado.** Solo (1) es una decisión de _forma_, y
volver `externalId` nullable más adelante es una migración aditiva barata. (2),
(3) y (4) son features enteros —autenticación propia, frontera de escritura sin
upstream, gestión de pedidos— y no hay ninguna forma que se pueda dejar
insinuada hoy que los abarate mañana. Lo único que de verdad era «barato ahora,
caro después» era la forma de la credencial, y es justo lo que esta propuesta
resuelve.

## Lo que esto no protege

Va aparte para que nadie lo lea de más. D4 permite comprobar que una petición de
alta o de rotación viene de cuadrecaja. No hace nada de esto:

- **No prueba que un humano autorizado lo disparó.** La firma demuestra
  posesión de la clave privada de CC. Que dentro de cuadrecaja un administrador
  legítimo pulsara el botón es responsabilidad de cuadrecaja, y D1 la puso allí
  a propósito. Si CC se compromete, QAB ve una petición impecable.
- **No protege las siete rutas de sync.** Después del alta, todo sigue siendo un
  `Bearer` sin firma, sin marca de tiempo y sin ventana de replay:
  `withInternalAuth` comprueba esquema, longitud y hash, y nada más. Quien
  filtre un token puede escribir catálogo y leer pedidos de ese negocio, igual
  que hoy. Eso lo cierra el HMAC de
  [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md), que sigue abierto
  (SP5).
- **No impide el acaparamiento de slugs.** Quien pueda firmar puede crear
  negocios y quedarse valores de slug. ADR 0018 (a) decide que un valor **no se
  reasigna nunca**: al desaparecer el dueño la fila sobrevive y el valor queda
  retirado, no libre — está en el código, no solo en la ADR
  (`src/features/storefront/server/registry.ts:194-197`, con el comentario
  `R13: a retired value never goes back into the pool`). El daño es
  irreversible.

## Actores y precondiciones

**Quién dispara**: cuadrecaja, cuando un administrador de negocio publica su
primera tienda. La decisión humana ya existe y ya está autenticada por las
credenciales de cuadrecaja; esto no crea una decisión nueva, mueve dónde se
ejecuta.

**Precondiciones**: queandabuscando tiene configurada la clave pública de
cuadrecaja; CC conoce el `Negocio.id`, que es el `externalId` con el que QAB
conoce al negocio; y CC puede persistir el token que reciba.

**Lo que NO hace falta**: que el negocio exista ya en queandabuscando, ni —a
diferencia de hoy— que CC persista el token en la misma transacción: para eso
está el solape (E3).

## Comportamiento esperado

**E1 — Alta de un negocio desconocido.** Dado un `externalId` que no existe en
`Business` y un JWT firmado y sin usar, entonces se crea el `Business`, se crea
su credencial y se acuña el token: `201` con el valor **en claro**, una sola vez.

**E2 — El mismo negocio, otra vez.** Dado un negocio que ya tiene credencial
viva, cuando se repite el alta —porque abrió su segunda sucursal, o porque
reintentó—, entonces **no se toca nada**: `200` con
`{ registered: true, token: null }`. El token vigente no se devuelve nunca: solo
existe su hash.

**E3 — Rotación con solape.** Dada una credencial viva, cuando CC pide rotar,
entonces se crea una **segunda** credencial y se devuelve su token: durante la
ventana, **los dos** autentican. Es lo que hoy es imposible y lo que elimina la
ventana de corte del problema 2.

**E4 — Retirar la vieja.** Cuando CC revoca la credencial anterior, esta deja de
resolver de inmediato y la nueva sigue funcionando. El negocio no se toca.

**E5 — Tope de credenciales vivas.** Cuando ya hay dos vivas y se pide rotar
otra vez, entonces `409 TOO_MANY_LIVE_CREDENTIALS` y no se acuña nada: hay que
revocar una primero. Evita que un bucle de reintentos deje diez credenciales
válidas olvidadas.

**E6 — Firma inválida.** Un JWT mal firmado, caducado, o firmado con una clave
cuya pública no está configurada: `401`, con el mismo cuerpo en todos los casos
— quien prueba no aprende cuál de las tres falló.

**E7 — Replay.** Un `jti` ya consumido: `401`, y no se acuña nada. Lo garantiza
la clave primaria de `SsoTokenUse`, no una comprobación en código.

**E8 — Sin clave configurada.** `503`, nunca `200` y nunca `401` — misma
invariante que `SYNC_NOT_CONFIGURED` en
`src/app/api/internal/_lib/guard.ts:37`: una credencial ausente jamás significa
«deja pasar todo».

**E9 — Negocio dado de baja.** Dado un `Business` con `active: false`, la ruta
responde `403 BUSINESS_INACTIVE` y no acuña. **No contradice D1**: es moderación de un
negocio que ya existe, no admisión de uno nuevo, y esta ruta no es la vía para
revertir una baja.

**E10 — Dos altas concurrentes del mismo negocio.** Una gana y la otra responde
como E2, sin `500` y sin dejar dos negocios.

**E11 — Colisión del hash acuñado.** Se aborta sin escribir nada y se responde
`503`; reintentar acuña otro valor. Mismo manejo que
`scripts/mint-sync-token.ts:54`.

## Reglas de negocio

- **R1.** El token en claro se devuelve **exactamente una vez**, en la respuesta
  que lo acuña. Nunca se guarda: solo su SHA-256. Es la invariante que el
  comando ya cumple (R11 de F-018) y no se relaja por cambiar de superficie.
- **R2.** El token lo acuña queandabuscando con `mintSyncToken()`. Nunca lo
  propone quien llama: la entropía de una credencial la elige quien la verifica.
- **R3.** Registrar es **idempotente y no rota jamás**.
- **R4.** Rotar y revocar son acciones **distintas y explícitas**, nunca el
  efecto de repetir un alta.
- **R5.** La identidad del negocio sale del JWT verificado, nunca del cuerpo ni
  de la query. Misma regla que
  [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md) fija para el
  resto de la integración.
- **R6.** Un JWT es de un solo uso, por `jti`, con la unicidad en la base.
- **R7.** TTL corto (~60 s) y tolerancia de reloj: son máquinas distintas.
- **R8.** _(D4, vetable)_ Queandabuscando guarda **solo la clave pública** de
  cuadrecaja, y nunca una privada ni un secreto simétrico compartido con ella.
  Un volcado completo de la configuración de queandabuscando no permite firmar
  nada.
- **R9.** Como mucho **dos credenciales vivas por negocio**: la vigente y la
  entrante. Las revocadas se conservan.
- **R10.** Rotar o revocar la credencial de un negocio **no afecta a ningún
  otro**.
- **R11.** _(D1)_ Queandabuscando **no ejerce ni consulta admisión de negocios**.
  No hay lista de permitidos, ni campo que la exprese, ni llamada a cuadrecaja
  para preguntarla. La única palanca de este lado es `Business.active`, y es
  posterior (E9).
- **R12.** Las respuestas llevan `cache-control: no-store`. Devuelven una
  credencial.

## Casos límite y errores

| Caso                                            | Respuesta                               | Se escribe algo             |
| ----------------------------------------------- | --------------------------------------- | --------------------------- |
| JWT ausente, mal firmado, caducado o malformado | `401 UNAUTHORIZED`                      | no                          |
| `jti` ya consumido                              | `401 UNAUTHORIZED`                      | no                          |
| Clave pública no configurada                    | `503 SIGNING_KEY_NOT_CONFIGURED`        | no                          |
| Negocio con `active: false`                     | `403 BUSINESS_INACTIVE`                 | no                          |
| Negocio ya registrado                           | `200 { registered: true, token: null }` | no                          |
| Rotar con una viva                              | `201` con token nuevo                   | sí, una fila más            |
| Rotar con dos vivas                             | `409 TOO_MANY_LIVE_CREDENTIALS`         | no                          |
| Revocar una credencial ya revocada              | `200`, idempotente                      | no                          |
| Revocar la última credencial viva               | `200` — el negocio queda sin sync       | sí, `revokedAt`             |
| Dos altas concurrentes del mismo negocio        | una `201`, otra `200` como E2           | un solo `Business`          |
| Colisión de `tokenHash`                         | `503`                                   | no — todo queda como estaba |

**Sobre el tope de R9 y dónde se hace cumplir.** El resto del repo pone la
exclusividad en la base y no en un `SELECT` previo
([ADR 0018](../../../docs/adr/0018-registro-de-slugs-y-slug-canonico.md) (a):
«nunca un `SELECT` previo en código»). Aquí no se puede: Postgres sabe expresar
«como mucho una» con un índice único parcial, pero **no sabe expresar «como
mucho dos»** sin un disparador. Se acepta a sabiendas, y se puede porque **el
tope no es una invariante de seguridad, es higiene**: la que importa —que un
token resuelva a lo sumo una credencial— la sigue garantizando el `@unique` de
`tokenHash`. Perder la carrera produce una tercera credencial viva, todas
legítimamente de cuadrecaja, y la siguiente revocación la limpia.

**Reintentos.** Un reintento tras una `201` que CC no llegó a leer deja el token
acuñado y perdido: el `jti` está consumido, así que cae en E7. Con el solape ya
no es grave —la credencial anterior sigue viva—, pero deja una fila que ocupa
sitio en el tope de R9. Se limpia revocándola. Es también el caso para el que el
comando sigue existiendo.

## Datos y contrato

**Esquema.** Una tabla nueva y una columna que se retira.

```prisma
model BusinessCredential {
  id         String    @id @default(uuid())
  businessId String
  /// Etiqueta libre, para el rastro de auditoría: "cuadrecaja", "rescate manual".
  label      String?
  tokenHash  String    @unique        // SHA-256, como hoy
  createdAt  DateTime  @default(now())
  revokedAt  DateTime?
  lastUsedAt DateTime?

  business Business @relation(fields: [businessId], references: [id])

  @@index([businessId, revokedAt])
}
```

`Business.syncTokenHash` (`prisma/schema.prisma:130`) **se retira**.

**Payload del JWT** (validado con Zod estricto, como `ssoPayloadSchema` en
`src/lib/auth/ssoToken.ts:12`):

```jsonc
{
  "jti": "…", // ≥ 8 caracteres, único
  "businessId": "<Negocio.id>", // el externalId del negocio
  "action": "register", // "register" | "rotate" | "revoke"
  "exp": 1756590000,
}
```

`action` **dentro del JWT firmado**, no en el cuerpo ni en la URL: las tres
tienen consecuencias muy distintas y quien decide cuál es el firmante, no el
transporte.

**Respuesta de alta o rotación** (`201`):

```jsonc
{
  "registered": true,
  "businessId": "<Negocio.id>",
  "token": "<valor en claro, la única vez que se ve>",
  "created": true, // ¿se creó también el Business?
  "liveCredentials": 2, // cuántas quedan vivas, para que CC sepa que debe revocar
}
```

De repetición (`200`): igual, con `"token": null` y `"created": false`.

**Migración de lo que ya existe.** El `syncTokenHash` de cada negocio pasa a una
fila de `BusinessCredential` con `label: "cuadrecaja"`. Los tokens vivos
**siguen funcionando**: es la misma cadena y el mismo hash, en otra fila.
Después se retira la columna. Hoy son dos negocios sembrados.

**Puntos de código que cambian.** Muy acotados, porque el módulo se escribió
para esto: `resolveCaller()` y `syncConfigured()` en
`src/features/sync/server/caller.ts` —el único sitio que resuelve un token a un
negocio (R9 de F-018)—, que pasan a consultar la tabla ignorando las revocadas.
`src/lib/syncAuth.ts` **no se toca**: sigue siendo puro y sigue sin saber qué es
un `Business`. Y `lastUsedAt` se escribe desde ahí, o desde ningún sitio: ver
§ No decidido.

**Contrato con cuadrecaja.** Es una **v6** de `docs/sync-contract.md`, aditiva
para las siete rutas: ninguna cambia de forma ni de significado, y un token
acuñado a mano sigue funcionando igual. Cambia § Autenticación —que hoy dice
«queandabuscando lo acuña, entrega el valor en claro una sola vez» sin decir por
dónde— y § Modos de falla, cuya receta para un token filtrado pasa de «re-acuñar»
a «rotar, recoger, revocar», que es la secuencia sin corte.

**Configuración.** La clave pública de cuadrecaja. Como el resto de secretos
opcionales, **no obligatoria** en `serverEnv()`: ese esquema se parsea
**completo** (`src/lib/env.ts:8-15`) y lanza si falta un campo requerido, así que
declararla obligatoria rompería todas las rutas que llaman a `serverEnv()` en
cualquier despliegue que aún no la tenga. Interacciona con F-029
(`passes: false`), que va exactamente de eso.

## Criterios de aceptación propuestos

Todos `[nuevo]`: esto no es un feature todavía.

1. `[nuevo]` Con un `externalId` que no existe, un JWT firmado responde `201` con
   un `token` no vacío, y queda una fila viva en `BusinessCredential`.
2. `[nuevo]` Ese token autentica de verdad:
   `node scripts/send-catalog-batch.mjs --token=<ese token>` responde `207`.
3. `[nuevo]` Repetir el alta con un `jti` nuevo responde `200` con
   `"token": null`, y el `tokenHash` de la base es **idéntico** antes y después.
4. `[nuevo]` Tras el criterio 3, el token del criterio 1 **sigue respondiendo
   `207`**. Es el criterio que fija § La trampa.
5. `[nuevo]` **Solape**: tras rotar, **los dos** tokens responden `207` en la
   misma corrida. Es el criterio que hoy es imposible de pasar.
6. `[nuevo]` Revocada la credencial vieja, su token responde `401` y el nuevo
   sigue en `207`.
7. `[nuevo]` Con dos credenciales vivas, rotar otra vez responde
   `409 TOO_MANY_LIVE_CREDENTIALS` y no crea ninguna fila.
8. `[nuevo]` Rotar la credencial del negocio A no afecta a la de B: el token de
   B sigue en `207`.
9. `[nuevo]` Un JWT firmado con una clave privada cuya pública no está
   configurada responde `401`; uno caducado, `401`. Los dos cuerpos son byte a
   byte iguales.
10. `[nuevo]` Reusar el mismo `jti` responde `401` y el `tokenHash` es idéntico
    antes y después.
11. `[nuevo]` `grep -rniE "privateKey|PRIVATE KEY" src/ prisma/` no devuelve
    nada: queandabuscando no guarda ninguna clave privada (R8).
12. `[nuevo]` Sobre un `Business` con `active: false`, la ruta responde
    `403 BUSINESS_INACTIVE` y no acuña.
13. `[nuevo]` Dos altas concurrentes del mismo `externalId` dejan **un solo**
    `Business` (`SELECT count(*)` = 1) y ninguna responde `500`.
14. `[nuevo]` Tras la migración, los tokens acuñados antes con
    `npm run mint:token` **siguen respondiendo `207`**, y
    `grep -n "syncTokenHash" prisma/schema.prisma` no devuelve nada.
15. `[nuevo]` Sin clave pública configurada, la ruta responde `503` y las siete
    rutas de sync con un token válido siguen respondiendo lo suyo.
16. `[nuevo]` La ruta, la tabla y la secuencia «rotar, recoger, revocar» están
    en `docs/sync-contract.md`: `grep -n "Versión 6" docs/sync-contract.md` no
    vacío.
17. `[nuevo]` `bash .agent/verify.sh <ID> --full` termina con código 0.

## Incongruencias detectadas

1. **`scripts/mint-sync-token.ts:46` siempre rota.** Su rama `update` no
   distingue «este negocio ya tiene credencial» de «hay que darle una».
   Correcto para un comando, fallo silencioso para una ruta llamada una vez por
   sucursal (§ La trampa).

2. **La puerta comercial de hoy es involuntaria, y D1 dice que no debe
   existir.** Que el alta exija un acto manual de queandabuscando funciona hoy,
   de facto, como control de admisión. No lo decidió nadie: no aparece en
   [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md) —que decide el
   grano del token, no quién puede obtenerlo— ni en ninguna otra ADR. Construir
   esto **elimina** una barrera que estaba ahí por accidente; conviene decirlo
   así en el informe, no como si se relajara algo decidido.

3. **`Business.syncTokenHash` hace imposible rotar sin corte.** Una columna solo
   admite un valor: no hay forma de que el token entrante y el saliente
   coexistan ni un segundo. Nadie lo decidió tampoco — F-018 la introdujo cuando
   la rotación era un trámite de terminal y la ventana de corte no molestaba a
   nadie. Es la misma clase de trampa que
   [ADR 0013](../../../docs/adr/0013-identidad-de-integracion.md) señaló en su
   momento: una forma que promete menos de lo que el sistema va a necesitar.

4. **El panel no puede registrar nada, y por eso el disparador es CC.**
   `src/app/admin/sso/route.ts:45` deniega con `unknown_business` cuando el
   `businessId` del token SSO no existe en `Business`: no hay forma de tener
   sesión de panel para un negocio que aún no está en esta base.

5. **A favor de [ADR 0002](../../../docs/adr/0002-el-pos-inicia-todas-las-llamadas.md).**
   «El POS hace las llamadas; queandabuscando nunca llama a cuadrecaja.» Esta
   propuesta añade llamadas en la dirección que la ADR ya fija. El comando
   manual es lo que hoy queda **fuera** del modelo.

6. **F-029 está abierto y toca lo mismo.** Añadir configuración nueva sin
   resolverlo antes reproduce el fallo que F-029 describe. R8 y § Datos lo
   evitan declarándola opcional, pero conviene ordenar las dos cosas a
   propósito.

## Huecos y preguntas al humano

**SP1 — ¿Hay puerta comercial de negocios?** · **RESUELTA (D1)**

Decisión del humano, 2026-08-30: **no la hay del lado de QAB**. En sus palabras:
«esto será manejado desde CC, con una configuración a nivel de sistema, donde el
super-administrador habilita esta opción para negocios específicos, pero es solo
a nivel de funcionalidad en CC; para QAB cualquier negocio o tienda que se cree
desde CC tiene luz verde».

**SP2 — ¿Credencial propia o la del SSO?** · **RESUELTA (D2)**

Decisión del humano, 2026-08-30: **propia**. Reutilizar `SSO_JWT_SECRET`
convertiría una filtración de la llave del panel en acceso de escritura al
catálogo y de lectura a los pedidos de todos los negocios;
`src/lib/auth/ssoToken.ts:8` lo describe como «la única relación de confianza
entrante para la identidad de administrador», y eso debe seguir siendo cierto.

**SP3 — ¿Quién autoriza a un sistema cliente nuevo?** · **RESUELTA (D3): no
aplica**

Decisión del humano, 2026-08-30: **no va a existir un tercero; siempre serán CC
y QAB**. La pregunta se queda sin sujeto y con ella cae la tabla de sistemas
clientes que la versión anterior proponía. Se conserva anotada porque explica
por qué esta versión es más pequeña que la que la precede.

**SP4 — ¿Puede cuadrecaja rotar cuando quiera?** _(abierta)_

Con el solape, rotar deja de ser peligroso para el propio negocio: la credencial
vieja sigue viva hasta que CC la revoque. Queda la pregunta de si se limita la
frecuencia, o si basta con el tope de dos vivas (R9, E5).

**Recomendación**: basta con el tope. Limitar la frecuencia añade estado que
nadie va a mirar, y el tope ya impide el único desenlace malo —una pila de
credenciales válidas olvidadas—.

**SP5 — ¿Se adelanta el HMAC de [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md)?**
_(abierta)_

D4 protege el alta y la rotación, **no** las siete rutas (§ Lo que esto no
protege), que siguen con `Bearer` sin firma ni ventana de replay.

**Recomendación**: **no meterlo en el alcance de esto**. Mezclarlos convierte
una tabla y una ruta en un feature de autenticación completo, y el HMAC se puede
añadir encima sin rehacer nada de aquí. Pero conviene que se decida a propósito
y no por olvido: es el hueco de seguridad conocido más antiguo del proyecto.

**SP6 — ¿El `name` del negocio?** _(abierta)_ El comando pone
`name: externalId` como relleno y el primer evento `STORE` lo corrige con
`payload.businessName` (`src/features/sync/server/handlers/store.ts:57-59`).
¿La ruta hace lo mismo, o el JWT lo lleva?

**Recomendación**: que el JWT lo lleve, opcional. Evita una fila con un uuid por
nombre durante lo que tarde el primer cron.

**SP7 — ¿Se veta D4?** _(abierta, y es la única que cambia el diseño)_ Con D3,
la firma asimétrica dejó de estar forzada. Sigue siendo lo que responde a la
pregunta que originó todo esto —«¿qué impide que lo ejecute alguien que no esté
en CC?»—, pero un secreto simétrico es más simple y con un solo cliente también
distingue CC de no-CC.

**Recomendación**: **asimétrica**. `jose` ya está en el proyecto y ya se usa
para verificar el SSO; es `importSPKI` en vez de `TextEncoder`, y a cambio la
configuración de queandabuscando deja de ser material falsificable.

## No decidido a propósito

- **Alcances por credencial.** Con un único cliente no hay dos perfiles de
  permiso que separar. Si algún día lo hay, el campo cabe en
  `BusinessCredential` sin migración destructiva.
- **Quién escribe `lastUsedAt`.** Está en el esquema porque sin él no se puede
  saber qué credencial sigue en uso antes de revocarla, pero escribirlo en cada
  petición es un `UPDATE` por llamada en la ruta más caliente de la
  integración. Lo razonable es escribirlo con granularidad gruesa —una vez por
  hora y credencial— y eso es una decisión propia.
- **Rotación de la clave pública de cuadrecaja.** Las claves caducan. La forma
  natural es admitir varias claves activas y elegir por `kid`, aditivo sobre
  esto.
- **Observabilidad.** Cuántas altas, cuántas rotaciones, cuántos `401` por
  replay. Encaja con lo que propone `enlace-de-pedido-observable.md`.
- **El orden respecto a F-029.** Las dos tocan `src/lib/env.ts`.
