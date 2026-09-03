---
feature: F-034
agente: orquestador
actualizado: 2026-09-03T05:41:40Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cuando el superadministrador de cuadrecaja habilite un negocio, cuadrecaja va a
poder pedirle a queandabuscando el token de sync de ese negocio con una llamada
HTTP, y recibirlo en la respuesta. Deja de hacer falta que un desarrollador de
queandabuscando abra una terminal con la base de producción y corra
`npm run mint:token` una vez por comercio.

Lo que **no** cambia: el token sigue siendo por negocio, sigue siendo el mismo
valor y el mismo hash, y las ocho rutas de `/api/internal/*` no cambian de forma
ni de significado. Un token acuñado a mano el mes pasado sigue valiendo. El
guion sigue existiendo como vía de rescate.

Lo que sigue sin poder hacerse: si cuadrecaja **pierde** el token de un negocio
que ya lo tiene, esta ruta no le da otro. Eso necesita rotación con solape, que
se queda en la propuesta.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                | Archivos                                                                                                                                              | Criterio que acerca | Cómo se verifica                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| 1   | El tope de bytes del cuerpo y el schema Zod: `PROVISIONING_MAX_BODY_BYTES = 4096` y `provisionCredentialSchema` (`externalId` obligatorio con `trim` y ≤128, `name` opcional ≤200, `strip` y no `strict`)                  | `src/constants/sync.ts`, `src/features/sync/schemas.ts`, `src/features/sync/schemas.test.ts`                                                          | 8                   | `bash .agent/verify.sh F-034`                                                       |
| 2   | El guard del secreto y el constructor de respuestas del área: 503 si falta o no es 64 hex, 401 en los tres fallos de cabecera con **un solo** cuerpo, `timingSafeEqual` sobre 32 bytes, `cache-control: no-store` en todas | src/app/api/provisioning/\_lib/guard.ts, src/app/api/provisioning/\_lib/respond.ts, src/app/api/provisioning/\_lib/guard.test.ts (los tres por crear) | 7, 12               | `bash .agent/verify.sh F-034`                                                       |
| 3   | El módulo de servidor: `create` → compare-and-set sobre `syncTokenHash IS NULL` → lectura de desempate, con las dos ramas de P2002 distinguidas por `isUniqueViolation`. Lo único que toca Prisma                          | src/features/sync/server/provisioning.ts, src/features/sync/server/provisioning.db.test.ts (por crear)                                                | 1, 3, 4, 5, 9, 10   | `npx vitest run --project db src/features/sync/server/provisioning.db.test.ts`      |
| 4   | La ruta: solo `POST`, guard → `readJsonBody(4096)` → schema → módulo → código de estado. Cero Prisma                                                                                                                       | src/app/api/provisioning/credential/route.ts, src/app/api/provisioning/credential/route.test.ts (por crear)                                           | 6, 8                | `bash .agent/verify.sh F-034`                                                       |
| 5   | El test de fronteras del área: ninguna ruta de `/api/provisioning` importa Prisma, todas pasan por el guard, y el guard sigue comparando en tiempo constante                                                               | src/app/api/provisioning/boundaries.test.ts (por crear)                                                                                               | 11, 12              | `bash .agent/verify.sh F-034`                                                       |
| 6   | `QAB_BUSINESS_ID` (con `seed-negocio-1` por omisión) en el guion de lote y en el constructor de eventos, para que el argv del criterio 2 quede byte a byte y nada del seed se rote                                         | `scripts/send-catalog-batch.mjs`, `scripts/store-event.mjs`                                                                                           | 2                   | `QAB_BUSINESS_ID=<nuevo> node scripts/send-catalog-batch.mjs --token=<el devuelto>` |
| 7   | El smoke: los criterios que solo se ven por HTTP, sobre `f034-smoke-<epoch>`, con guardián de precondición que aborta en rojo si el secreto no está, y limpieza de lo suyo al final                                        | .agent/specs/F-034/smoke.sh (por crear)                                                                                                               | 1-5, 7-11           | `bash .agent/verify.sh F-034 --smoke`                                               |
| 8   | La documentación: ADR 0029 con la frase que cierra la trampa, la **v10** del contrato (mayor), `docs/despliegue.md` §5/§8.1 con el secreto nuevo y el procedimiento, y `.env.example`                                      | docs/adr/0029-alta-de-negocio-por-api.md (por crear), `docs/sync-contract.md`, `docs/despliegue.md`, `.env.example`                                   | 13                  | `node scripts/check-harness.mjs` y el hook de versión del contrato                  |
| 9   | Cierre: `impl.md` con lo construido y lo desviado, `tests.md` con una casilla por criterio, y el sensor completo                                                                                                           | `.agent/specs/F-034/impl.md`, `.agent/specs/F-034/tests.md`, `.agent/progress/F-034.md`                                                               | 14                  | `bash .agent/verify.sh F-034 --full` sale 0                                         |

El orden importa en un sitio: el paso 3 antes del 4, porque la ruta mockea el
módulo de servidor en sus pruebas y necesita su contrato ya fijado. El resto es
de coste creciente, que es como el sensor los va a ejecutar.

## De dónde sale cada paso

| Paso | Lo justifica                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `spec.md` § Datos y contrato (cuerpo de la petición, «Por qué el schema no es `strict`») · `architecture.md` § Componentes y § Contratos → El schema |
| 2    | `spec.md` R7, R8, R9, R10, E6, E7, E14 · `architecture.md` § Contratos → El guard, y su decisión 2 (el compare vive en el guard, no en `src/lib/`)   |
| 3    | `spec.md` R12, E1, E3, E4, E9, E10, E11, E12 · `architecture.md` § R12: crear-si-no-existe + compare-and-set, sin transacción                        |
| 4    | `spec.md` § Datos y contrato (respuestas y tabla de errores), R13, E8, E16, E17 · `architecture.md` § Componentes y § Flujo de datos                 |
| 5    | `spec.md` I10 (ningún test de fronteras cubre `/api/provisioning`) · `architecture.md` § Pruebas → Proyecto `server`                                 |
| 6    | `spec.md` I8 (el criterio 2 no se puede ejecutar con el token del criterio 1) · `architecture.md` § Cómo se ejecuta el criterio 2 (I8), de verdad    |
| 7    | `architecture.md` § Pruebas → Solo en el smoke · la restricción de la base compartida, ficha `mint-token-rota-el-token-en-bd-compartida`             |
| 8    | `spec.md` I4, I6, I7 y § Datos y contrato · `architecture.md` § ¿Hace falta una ADR? · `AGENTS.md` § Documentación (contrato, despliegue, ADR)       |
| 9    | `.agent/README.md` § Al completar un feature                                                                                                         |

## Qué queda fuera

- **La tabla `BusinessCredential`, la rotación con solape y la revocación.** Es
  la segunda mitad de `.agent/specs/propuestas/credenciales-de-integracion.md`
  y sigue siendo propuesta (D6). Consecuencia concreta y aceptada: a un negocio
  que **ya** tiene token esta ruta no le puede dar otro, y rotar sigue teniendo
  ventana de corte y sigue exigiendo la terminal.
- **Retirar `Business.syncTokenHash`.** Sigue siendo una columna. Sin migración
  en este feature.
- **Firma asimétrica.** D8 la vetó para este alcance. Lo que sí se conserva de
  su argumento es R9: queandabuscando guarda el **SHA-256** del secreto, no el
  secreto, así que un volcado de su configuración no permite llamar a la ruta.
- **El HMAC de [ADR 0008](../../../docs/adr/0008-bearer-token-baseline.md) sobre
  las rutas de sync.** Después del alta, todo sigue siendo un `Bearer` sin
  firma, sin marca de tiempo y sin ventana de replay. Este feature **no** cierra
  ADR 0008, y conviene que eso se decida a propósito y no por olvido.
- **Límite de tasa en la ruta.** `architecture.md` § Escalabilidad y límites lo
  descarta con argumento —el rechazo cuesta 0 sentencias porque el guard corre
  antes de tocar Prisma, el secreto son 256 bits, y R3/R4 acotan el daño— y deja
  escritos los umbrales que lo reabrirían. Se recomienda en su lugar una línea de
  firewall en `docs/despliegue.md`.
- **Borrar o cambiar `scripts/mint-sync-token.ts`.** R18: sobrevive sin tocarlo.
  Un aprovisionamiento que solo funciona si cuadrecaja está bien configurado no
  es una vía de rescate.
- **Unificar los cuatro escritores de `syncTokenHash`** (I2). No se extrae
  código común: el guion **tiene** que rotar, el seed no es importable desde la
  app y las fixtures crean el negocio entero. Lo que importaba compartir
  —`mintSyncToken()`— ya está compartido, y el test de fronteras del paso 5 fija
  la lista blanca de sus llamantes.
- **Arreglar el `!==` del guard de crons** (I3). Es una incongruencia que ya
  existe; queda anotada en `spec.md`, no se toca aquí.
- **Pantalla de aprovisionamiento en el panel.** El botón vive en cuadrecaja
  (D1). Ver `design.md`.

## Riesgos y plan B

**El contrato pasa a v10 y es una MAYOR.** Endpoint nuevo, códigos nuevos. Por
§ Versionado del propio contrato, una mayor «se coordina con el equipo de
cuadrecaja **antes** de publicarla». Como los desarrolladores de los dos lados
son los mismos, el humano es ese equipo, y firmar este plan es la coordinación.
Queda dicho para que no parezca un descuido. Marcha atrás: la v10 es **aditiva**
—ninguna de las ocho rutas cambia—, así que revertirla es borrar una sección.

**El secreto hay que generarlo y repartirlo, y eso ningún sensor lo comprueba.**
Va a `docs/despliegue.md` § 5 y § 8.1, que es exactamente la clase de paso que
AGENTS.md manda anotar ahí («un secreto, un cron, un bucket… cualquier cosa que
haya que hacer al desplegar o al dar de alta un negocio»). Si no se reparte, la
ruta responde 503 y nada más se rompe: el guion sigue siendo la vía.

**Reusar `readBearerToken` impone un mínimo de 32 caracteres al secreto.** Un
secreto correcto pero más corto responde 401, no 503, y el mensaje no lo dice.
Se paga con una línea en `docs/despliegue.md` y un caso en la prueba del guard.

**La base es compartida entre worktrees.** Ninguna prueba ni el smoke pueden
rotar ni anular el `syncTokenHash` de `seed-negocio-1`: rompería el
`QAB_BEARER_TOKEN` de otras sesiones con un 401 que no menciona la rotación
(ficha `mint-token-rota-el-token-en-bd-compartida`). De ahí el paso 6 —en vez de
la vía que `spec.md` I8 proponía— y los `externalId` propios y desechables del
paso 7. Si el smoke deja restos, se limpian con el `delete … like 'f034-smoke-%'`
que él mismo trae.

**Sin migración y sin comandos prohibidos.** No hay `prisma migrate`, no hay
`db push`, no hay `migrate reset`. Se escriben tres columnas que ya existen.

**Lo que se deshace si hay marcha atrás a mitad**: borrar
`src/app/api/provisioning/` y `src/features/sync/server/provisioning.ts`,
revertir los dos guiones, el `.env.example`, la ADR y la sección del contrato.
Nada de lo que ya funciona depende de ello: ningún archivo existente cambia de
comportamiento, y los dos que se editan (`schemas.ts`, `sync.ts`) solo **ganan**
un export.

## Coste

Dos ciclos de agente: `sdd-implementer` para los pasos 1-8 y `sdd-tester` para
la verificación y el paso 9. Se toca de lo que ya funciona: dos exports nuevos en
archivos existentes, dos guiones de verificación que ganan una variable de
entorno con valor por omisión —así que quien no la ponga ve exactamente lo de
antes— y tres documentos. Ningún archivo de producción existente cambia de
comportamiento.

## Preguntas antes de aprobar

Las tres que quedaban de `architecture.md` las cierra el orquestador, porque el
humano pidió explícitamente que no se le consultara cada detalle («el plan que me
vayas a presentar apruebalo de una»). Quedan escritas aquí porque son decisiones,
no obviedades:

- **AP1 — ¿Cómo se genera y se reparte el secreto?** **Resuelta**: se documenta
  el par de comandos en `docs/despliegue.md` y en `.env.example` —generar 36
  bytes aleatorios, y su SHA-256 hex es lo que va al entorno de queandabuscando—
  y **no** se extiende `scripts/dev-secrets.mjs`, cuyo contrato de stdout y cuyas
  tres claves fijas los comprueban los criterios de F-029. Sin guion nuevo.
- **AP2 — ¿Quién escribe la ADR 0029 y cuándo?** **Resuelta**: la escribe
  `sdd-implementer` en el paso 8, junto al código que decide. El humano la
  acepta al aceptar el feature; su estado nace `Aceptada` como el resto de ADRs
  del repo.
- **AP3 — ¿Cómo se verifica el criterio 6?** **Resuelta**: en dos mitades. La
  primera —la ruta responde 503 sin el secreto y el escritor no se llama— en
  `route.test.ts` con la variable borrada del entorno, que además prueba «no se
  escribe nada» más fuerte que un `count(*)`. La segunda —«las rutas de
  `/api/internal/*` con un token válido siguen respondiendo lo suyo»— en el
  smoke. No se pide una pasada manual con el servidor levantado sin el secreto:
  costaría un reinicio del servidor dentro del smoke y no añade nada que la
  prueba de la ruta real no demuestre ya.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-XXX '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-03T05:41:40Z — aprobado por el humano: «el plan que me vayas a presentar apruebalo de una. Solo deja el codigo listo para comitear y me pasas un informe acotado con lo que cambio y como funciona.»
