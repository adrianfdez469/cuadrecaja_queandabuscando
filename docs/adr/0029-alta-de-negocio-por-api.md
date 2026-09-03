# 0029 — El alta de un negocio es una llamada de cuadrecaja, con un secreto de integrador

**Aceptada** · 2026-09-03 · F-034

Completa a [ADR 0013](0013-identidad-de-integracion.md), que decidió que la
identidad del llamante sale del token, nunca del payload, para un token que
**identifica a un negocio**. Esta ADR introduce una credencial de otra
naturaleza —un secreto que identifica al **integrador**, no a ningún
negocio— y decide, por escrito, dónde termina su autoridad para que nadie la
confunda con la que ADR 0013 ya fijó.

## Contexto

El alta de un negocio y la acuñación de su token de sync eran, hasta F-034,
un acto manual: un desarrollador de queandabuscando con `DATABASE_URL` de
producción en una terminal, ejecutando
`npm run mint:token -- <externalId>` una vez por comercio
(`scripts/mint-sync-token.ts`). Desde que el sync dejó de crear negocios
(F-018), ese comando **es también el alta del negocio**: sin él no hay
`Business`, sin `Business` no hay token, y sin token `/api/internal/*`
responde `401`.

Eso convertía un trámite de cuadrecaja —«este comercio publica en tienda»—
en una cita entre dos equipos, y de paso dejaba una puerta comercial que
nadie decidió: quien podía ejecutar ese comando decidía, de facto, qué
negocios entraban al sistema (spec.md I14). F-034 abre
`POST /api/provisioning/credential`, autenticada con un **segundo secreto de
plataforma** —`PROVISIONING_SECRET_SHA256`— comparado en tiempo constante,
igual que el `SYNC_TOKEN` único que [ADR 0013](0013-identidad-de-integracion.md)
retiró. Reintroducir un secreto de esa forma, en el mismo repo que lo acaba
de quitar, es exactamente la clase de decisión que un lector futuro va a
querer «arreglar» fusionándola con la que ya existe — y es precisamente eso
lo que esta ADR prohíbe.

## Decisión

**Seis puntos**, todos ya razonados en `architecture.md` § ¿Hace falta una
ADR? de F-034 y en `spec.md` § La objeción que todo lector va a tener:

1. **Hay dos credenciales con sujetos distintos y no se mezclan.**
   `Business.syncTokenHash` identifica a **un negocio** y sigue siendo la
   única identidad del sync — ADR 0013 sigue intacta. El secreto nuevo,
   `PROVISIONING_SECRET_SHA256`, identifica a **cuadrecaja como integrador**
   y solo vale en `/api/provisioning/*`. Que el `externalId` viaje en el
   cuerpo de la petición no contradice ADR 0013: ahí el negocio es el
   **objeto** de la operación, no el sujeto que la autentica. Si el
   `externalId` saliera del propio credencial, haría falta un secreto por
   negocio — que es justo lo que esta ruta existe para crear (huevo y
   gallina).

2. **La frase que cierra la trampa.** Es el motivo por el que esta ADR
   existe y no una línea en `docs/despliegue.md`:

   > El secreto de aprovisionamiento no autentica, ni autenticará, ninguna
   > ruta de `/api/internal/*`. Está **prohibido** pasarlo a
   > `resolveCaller()`, aceptarlo en `withInternalAuth`, escribir su digest
   > en `Business.syncTokenHash` o derivar de él un token de negocio. La
   > única forma de que una petición de sync se autentique es que su token
   > hashee a un `syncTokenHash` de una fila `Business`; si algún día hiciera
   > falta otra cosa, se supera esta ADR con otra, no se cablea el guard.

   El motivo es literal, no ceremonial: [ADR 0013](0013-identidad-de-integracion.md)
   retiró el `SYNC_TOKEN` único de plataforma precisamente porque una
   promesa de scoping a medias en el código de autenticación es peor que no
   hacerla, y dijo explícitamente que la alternativa de un secreto único era
   defendible **solo si se borraba del todo** — «no dejarlos como trampa».
   Reintroducir un segundo secreto de plataforma sin esta frase escrita
   sería dejar exactamente esa trampa otra vez, con una ruta nueva señalando
   el camino de vuelta. El corolario comprobable —el digest de
   `PROVISIONING_SECRET_SHA256` **nunca** aparece en la columna
   `Business.syncTokenHash`— lo comprueba el smoke de F-034
   (`.agent/specs/F-034/smoke.sh`) contra la base real en cada corrida.
   Compartir helpers **puros** (`hashSyncToken`, `readBearerToken`) no es
   cablear nada: la prohibición es sobre la **identidad**, no sobre el
   SHA-256 que la protege.

3. **queandabuscando no ejerce admisión de negocios** (D1 de la propuesta que
   originó F-034). Cualquier `externalId` que llegue con el secreto correcto
   tiene luz verde; la moderación de qué negocio puede entrar vive en
   cuadrecaja, y la única palanca de este lado es `Business.active`,
   **posterior** al alta. Dicho como lo que es: F-034 **elimina** una
   barrera que estaba ahí por accidente —nadie decidió que un comando manual
   fuera el control de admisión—, no relaja algo que alguien hubiera
   acordado.

4. **Registrar es idempotente y no rota jamás** (R3/R4 de `spec.md`), y eso
   no es higiene sino una **propiedad de seguridad**: con el secreto
   filtrado, quien lo tenga no puede pedir el token de un negocio que **ya**
   tiene uno, así que no puede secuestrar el sync de un comercio en marcha.
   El precio es que un token perdido solo se recupera **rotando con
   corte** desde `npm run mint:token -- <externalId>`, que sigue siendo la
   vía de rescate y la única forma de rotar (R18).

5. **El verificador guarda el digest, no el secreto** (R9): queandabuscando
   guarda el SHA-256 de `PROVISIONING_SECRET_SHA256`, nunca el valor en
   claro, y la comparación es en tiempo constante sobre dos buffers de 32
   bytes — el mismo patrón que el token de negocio, heredando
   [ADR 0008](0008-bearer-token-baseline.md) § Detalle de implementación. La
   invariante del `503` de ADR 0008 —un secreto ausente jamás significa
   «deja pasar todo»— se aplica también a este secreto, y se diverge **a
   propósito** de `src/app/api/crons/_lib/guard.ts`, que responde `401` sin
   `CRON_SECRET`: el llamante de crons es Vercel, que no sabe leer un `503`;
   el de esta ruta es cuadrecaja, que sí, y para quien la diferencia entre
   «no me has configurado» y «tu secreto está mal» es la diferencia entre
   avisar al otro equipo y revisar su propia configuración.

6. **El grano y cuándo se reabre.** Un solo secreto para un solo
   integrador. El día que haya un segundo integrador, o que se quiera
   rotación o revocación con solape, se retoma
   `.agent/specs/propuestas/credenciales-de-integracion.md` con su tabla
   `BusinessCredential`, y entonces sí se reabre
   [ADR 0008](0008-bearer-token-baseline.md) (a) sobre quién firma cada
   credencial — no antes, y no cableando esta.

## Consecuencias

- **Un desarrollador de queandabuscando deja de ser parte del camino
  crítico del alta de un negocio.** `npm run mint:token` sigue existiendo,
  sin cambios de comportamiento, como vía de rescate y como la única forma
  de rotar (R18) — no se borra ni se le quita ninguna capacidad.
- **`docs/sync-contract.md` pasa a v10 (mayor)**: hay una ruta nueva, con su
  propio vocabulario de errores, fuera de la tabla de las siete rutas de
  sync existentes — que no cambian de forma ni de significado.
- **El test de fronteras de `/api/provisioning`**
  (`src/app/api/provisioning/boundaries.test.ts`) es la comprobación
  automática, en cada corrida, de que ninguna ruta de esta área usa
  `withInternalAuth` ni importa Prisma directamente — el mismo tipo de
  guarda que ya vigila `/api/internal/*` desde F-018.
- **Un negocio que ya tiene token nunca recibe otro por esta vía** (R3/R4):
  si cuadrecaja pierde el valor, la única salida sigue siendo rotar con
  corte, con la ventana de outbox acumulado que eso implica
  (`docs/despliegue.md` § 11).
- **`Business.syncTokenHash` sigue siendo una columna compartida por cuatro
  escritores** (`scripts/mint-sync-token.ts`, `prisma/seed.ts`,
  `src/features/marketplace/server/dbFixtures.ts` y, desde F-034,
  `src/features/sync/server/provisioning.ts`). No se consolidan: el guion
  tiene que poder rotar y la ruta tiene prohibido hacerlo. Lo único que
  comparten, a propósito, es `mintSyncToken()`.
- **El HMAC de [ADR 0008](0008-bearer-token-baseline.md) sobre las rutas de
  sync sigue sin cerrarse.** F-034 no lo adelanta ni lo retrasa: después del
  alta, `/api/internal/*` sigue siendo un `Bearer` sin firma, sin marca de
  tiempo y sin ventana de replay.

## Alternativas descartadas

- **Resolver el secreto de aprovisionamiento contra `Business` y dejar que
  autentique también el sync.** Es exactamente la trampa que el punto 2
  prohíbe: colapsaría las dos identidades que el punto 1 mantiene separadas
  a propósito, y un volcado de la configuración de queandabuscando dejaría
  de ser inofensivo (R9).
- **Envolver la ruta nueva en `withInternalAuth`.** Imposible sin rehacer su
  contrato: ese guard existe para **entregar una identidad** resuelta del
  token, y aquí no viaja ninguna — el secreto autentica al integrador, no a
  un negocio. Forzarlo rompería además la frase de su propio docstring,
  «the shared envelope for EVERY `/api/internal/*` route», y el test de
  fronteras que la vigila.
- **Firma asimétrica en vez de un secreto compartido.** Vetada para este
  alcance (D8 de la propuesta que originó F-034): con los mismos
  desarrolladores a los dos lados y sin rotación con solape todavía, la
  simplicidad de un secreto simétrico gana. Se reabre si algún día hay un
  segundo integrador (punto 6).

## Reabrir cuando

- **Un segundo integrador necesite dar de alta negocios.** El grano de hoy
  —un secreto, un integrador— deja de bastar, y hace falta decidir cómo se
  distinguen y cómo se revocan por separado.
- **Se construya `BusinessCredential`** (rotación y revocación con solape,
  `.agent/specs/propuestas/credenciales-de-integracion.md`). Esa tabla
  cambia quién firma cada credencial, no solo su transporte, así que
  reabre [ADR 0008](0008-bearer-token-baseline.md) (a).
- **Alguien proponga que el secreto de aprovisionamiento resuelva un
  `Business`.** Es la trampa del punto 2: se supera esta ADR con otra
  explícita, nunca con un cambio silencioso al guard.
