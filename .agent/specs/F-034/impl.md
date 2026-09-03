---
feature: F-034
agente: sdd-implementer
actualizado: 2026-09-03T03:10:00Z
estado: listo
---

## Qué se construyó

Los pasos 1–8 de `plan.md`, en ese orden, cada uno verificado con
`bash .agent/verify.sh F-034` antes de pasar al siguiente. El paso 9
(`tests.md`, casillas por criterio) queda para `sdd-tester`.

### Paso 1 — el tope de bytes y el schema Zod

| Archivo                             | Qué hace                                                                                                                                                                                                                      | Criterio |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `src/constants/sync.ts`             | `PROVISIONING_MAX_BODY_BYTES = 4096`, junto a las demás constantes del área de sync.                                                                                                                                          | 8        |
| `src/features/sync/schemas.ts`      | `provisionCredentialSchema` (`externalId` obligatorio, `trim().min(1).max(128)`; `name` opcional, `trim().min(1).max(200)`; sin `.strict()`) y `ProvisionCredentialInput`.                                                    | 8        |
| `src/features/sync/schemas.test.ts` | Nuevo `describe` al final del archivo existente: acepta el caso normal, recorta espacios sin normalizar mayúsculas (R17), rechaza ausente/vacío/>128/>200, `strip` de claves desconocidas y el typo `external_id` → 400 (E8). | 8        |

### Paso 2 — el guard del secreto y el constructor de respuestas

| Archivo                                               | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                   | Criterio         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/app/api/provisioning/_lib/respond.ts` (nuevo)    | `NO_STORE` y `provisioningResponse(body, status)`: el único constructor de `NextResponse` del área, para que `cache-control: no-store` sea estructural (R10).                                                                                                                                                                                                                                                              | 17               |
| `src/app/api/provisioning/_lib/guard.ts` (nuevo)      | `verifyProvisioningSecret(request)`: 503 si `PROVISIONING_SECRET_SHA256` falta o no es 64 hex (con `console.warn("[provisioning] …")` una sola vez por proceso, bandera de módulo); 401 (cuerpo único, función local `unauthorized()`) en los tres fallos de cabecera; `timingSafeEqual` sobre dos buffers de 32 bytes; `null` si cuadra.                                                                                  | 7, 12, 19        |
| `src/app/api/provisioning/_lib/guard.test.ts` (nuevo) | 14 casos, cada uno con `vi.resetModules()` + import dinámico (así la bandera de "avisar una sola vez" no se contamina entre tests): secreto correcto → `null`; ausente/63-hex/vacío/en-claro → 503 sin `console.error`; las tres formas de fallar la cabecera → 401 con el mismo cuerpo; un token de sync (48 base64url) → 401 (E14 sin base); el aviso nombra la variable y nunca el secreto, y solo una vez por proceso. | 6, 7, 12, 17, 19 |

### Paso 3 — el módulo de servidor y su prueba contra Postgres real

| Archivo                                                    | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Criterio                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `src/features/sync/server/provisioning.ts` (nuevo)         | `provisionCredential(input, attempt?)`: `create` → si P2002 en `externalId` cae al `updateMany({ where: { externalId, syncTokenHash: null, active: true }, data: { syncTokenHash } })` (compare-and-set, sin `$transaction`) → si `count === 0`, lectura de desempate (`active` antes que `syncTokenHash`, para que E9 gane a E4) → reintento acotado a 1 si la fila cambió de forma entremedias. `isUniqueViolation(error, "syncTokenHash")` en las dos sentencias → `collision` (E12), sin dejar nada escrito. | 1, 3, 4, 5, 9, 10, 12, 18    |
| `src/features/sync/server/provisioning.db.test.ts` (nuevo) | `vi.mock("@/lib/syncAuth")` envolviendo la implementación real (`vi.fn(actual.mintSyncToken)`) para poder forzar UNA colisión sin tocar el resto de los tests. Externalid propios con `makeToken()` (prefijo `qab_f015_`), `afterAll` con `deleteMany` por ese prefijo. Cubre E1, la sustancia de E2 (`resolveCaller`), E3, E4/E5, E9 (dos variantes), E10, E11 y E12.                                                                                                                                           | 1, 2, 3, 4, 5, 9, 10, 15, 18 |

### Paso 4 — la ruta HTTP

| Archivo                                                     | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                         | Criterio    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `src/app/api/provisioning/credential/route.ts` (nuevo)      | Solo exporta `POST`. `verifyProvisioningSecret` → `readJsonBody(4096)` → `provisionCredentialSchema` → `provisionCredential` → `switch` **sin `default`** sobre `ProvisionResult["status"]` a 201/200/403/503. Cero Prisma, cero lógica.                                                                                                                                                                         | 6, 7, 8, 16 |
| `src/app/api/provisioning/credential/route.test.ts` (nuevo) | Mockea `@/features/sync/server/provisioning` (no Prisma), como `src/app/api/internal/sync/catalog/route.test.ts`. Los cuatro resultados → sus cuatro respuestas; las cinco formas de E8 → 400 sin llamar al módulo; el guard (503/401 con `PROVISIONING_SECRET_SHA256` borrada) sin llamar al módulo (criterio 6, primera mitad, AP3); `name`/`externalId` recortados y reenviados; solo `POST` exportado (E16). | 6, 7, 8, 16 |

### Paso 5 — el test de fronteras del área

| Archivo                                               | Qué hace                                                                                                                                                                                                                                                                                                                                                                | Criterio |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `src/app/api/provisioning/boundaries.test.ts` (nuevo) | Gemelo de `src/app/api/internal/boundaries.test.ts` para I10: ninguna ruta de `/api/provisioning` importa Prisma; toda ruta llama a `verifyProvisioningSecret(` y ninguna a `withInternalAuth(`; el guard sigue conteniendo `timingSafeEqual` (backstop del criterio 12); y (I2) `mintSyncToken(` solo aparece en su lista blanca de cinco archivos fuera de los tests. | 11, 12   |

### Paso 6 — `QAB_BUSINESS_ID` en el guion de lote

| Archivo                          | Qué hace                                                                                                                                                                                                           | Criterio |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `scripts/send-catalog-batch.mjs` | `const businessId = process.env.QAB_BUSINESS_ID ?? "seed-negocio-1"`, reenviado a `buildStoreEvent(..., { businessId, ... })`. Con la variable sin definir, comportamiento idéntico al de antes (default intacto). | 2        |

### Paso 7 — el smoke

| Archivo                               | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Criterio              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `.agent/specs/F-034/smoke.sh` (nuevo) | Guardián de precondición (aborta con `SMOKE FAIL` y exit 1 si `QAB_PROVISIONING_SECRET`/`PROVISIONING_SECRET_SHA256` faltan o no cuadran). Todo sobre `f034-smoke-<epoch>` y sus sufijos. Criterios 1, 3, 5, 7, 8, 9, 10, 11 y los propuestos 16, 17, 20; criterios 2 y 4 con `QAB_BUSINESS_ID=<el mismo externalId>` + `send-catalog-batch.mjs --token=<el devuelto>` (I8, sin tocar `seed-negocio-1`); la consulta extra que la ADR 0029 exige (el digest del secreto nunca es un `syncTokenHash`); limpieza `SyncEvent`/`Business` por el prefijo al final. | 1–5, 7–11, 16, 17, 20 |

35 aserciones, 0 fallidas, en dos corridas (antes y después de tocar la
documentación del paso 8).

### Paso 8 — documentación

| Archivo                                            | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/adr/0029-alta-de-negocio-por-api.md` (nueva) | **Aceptada** · 2026-09-03. Los seis puntos de `architecture.md` § ¿Hace falta una ADR?, con la frase que cierra la trampa (punto 2) literal y su motivo: ADR 0013 retiró el `SYNC_TOKEN` único de plataforma explícitamente para no dejarlo como trampa, y esta ADR es la que impide reintroducir esa misma trampa con un secreto nuevo.                                                                                                                                                                                                               |
| `docs/sync-contract.md`                            | **Versión 10** (línea 3 movida). Nueva `## Cambios respecto a la v9` (justo antes de la v8), nueva `## Aprovisionamiento de negocios (v10)` con el cuerpo, las dos respuestas y su tabla de códigos, una fila nueva en § Modos de falla, § Autenticación reescrita con las dos vías de acuñar y la corrección de I4, § Endpoints con la nota de la octava ruta, § Vocabulario de errores acotado (I5), y § Verificación actualizada.                                                                                                                   |
| `docs/despliegue.md`                               | §5: fila `PROVISIONING_SECRET_SHA256` en la tabla y un párrafo sobre la asimetría del secreto (cuadrecaja en claro, queandabuscando el hash). §7: punto 6, la regla de firewall recomendada por `architecture.md` § Escalabilidad. §8.1: reescrito con las dos vías (la ruta como normal, `mint:token` como rescate), el par de comandos de AP1, y el aviso del mínimo de 32 caracteres de `readBearerToken`. §8.3: `la versión vigente` corregida de v6 a v10 (I7), con la salvedad de que v10 sí es aditiva. §9 punto 1: la ruta como camino normal. |
| `.env.example`                                     | `PROVISIONING_SECRET_SHA256`/`QAB_PROVISIONING_SECRET` documentadas en prosa, sin asignar (como `CRON_SECRET`, AP1(b) descartada): el par de comandos (`randomBytes(36)` + su SHA-256 hex), qué guarda cada lado, y el mínimo de 32 caracteres.                                                                                                                                                                                                                                                                                                        |

## Desviaciones

- **`scripts/store-event.mjs` no se tocó**, aunque `plan.md` lo lista entre
  los archivos del paso 6. Leído su código: `buildStoreEvent(eventId,
options)` ya reenvía `options` completo a `buildStorePayload`, que acepta
  `businessId` como override con el mismo valor por defecto
  (`seed-negocio-1`). Bastó con pasar `{ businessId, ... }` desde
  `send-catalog-batch.mjs` — no había nada que cambiar en el otro archivo.
- **El criterio 19 (`[nuevo]`, no es uno de los 14 de `features.json`) no se
  ejecuta en el smoke**, aunque `architecture.md` § Pruebas → Solo en el
  smoke lo lista junto a 16, 17 y 20. Ejecutarlo por HTTP exigiría reconfigurar
  `PROVISIONING_SECRET_SHA256` del proceso de `next dev` **ya levantado** y
  releerlo sin reiniciar el servidor — no hay forma de hacer eso desde un
  script bash externo, es la misma clase de problema que AP3 ya resolvió para
  la segunda mitad del criterio 6 sin tocar el servidor a media corrida.
  Queda cubierto, determinista y sin servidor, en `guard.test.ts`
  (`src/app/api/provisioning/_lib/guard.test.ts`), que es donde
  `architecture.md` § Pruebas → proyecto `server` **también** lo lista.
- **Los criterios 2 y 4 se ejecutan sobre el MISMO negocio del criterio 1**,
  no sobre uno separado. `architecture.md` § Cómo se ejecuta el criterio 2
  describe la mecánica (`QAB_BUSINESS_ID` + el token devuelto) sin fijar si
  es el externalId de la criterio 1 u otro dedicado; usar el mismo evita una
  llamada de aprovisionamiento extra y prueba exactamente lo mismo que pedía
  I8 — nunca se tocó `seed-negocio-1`.
- **`provisioning.db.test.ts` crea los negocios "ya existentes" con
  `prisma.business.create` directo**, no con `createFixtureSession()`, para
  los casos E3/E4/E9: esos casos no necesitan `Storefront` ni `Store`, y
  crearlos habría sido limpieza de más sin ganar ninguna garantía adicional.
  `makeToken()` sí se reutiliza, para el prefijo que `sweepStaleFixtures()`
  reconoce.
- **`business_create()` del smoke inserta `"updatedAt"` explícitamente.**
  `Business.updatedAt` es `@updatedAt` (gestionado por Prisma en cada
  escritura, sin default a nivel de columna); un `INSERT` por SQL crudo tiene
  que ponerlo él mismo o Postgres rechaza la fila por `NOT NULL`. Encontrado
  y corregido durante la primera corrida real del smoke (`--smoke`,
  intento 12 → 13).

## Comandos ejecutados

- `bash .agent/verify.sh F-034` — verde después de cada uno de los pasos 1–6
  (typecheck·lint·format·test).
- `bash .agent/verify.sh F-034 --smoke` — verde tras el paso 7 y de nuevo tras
  el paso 8; log completo en `.agent/runs/F-034/013-smoke.log` (0 aserciones
  fallidas de 35) y `.agent/runs/F-034/016-smoke.log` (repetición tras la
  documentación).
- `bash .agent/verify.sh F-034 --full` — verde tras el paso 7 (intento 14) y
  de nuevo tras el paso 8 (intento 15): harness·typecheck·lint·format·test·
  prisma·build·theme·bundle.
- `node scripts/check-harness.mjs` — verde (249 documentos, 9 etapas, 14
  guiones requeridos).
- `bash .agent/verify.sh pending F-034` — vacío: las dos firmas que aparecieron
  durante el ciclo (`prettier-sin-formatear`, `boundaries-guard-cruzado-por-
patron-de-texto`) ya estaban fichadas en el playbook, se arreglaron sobre el
  error real (formatear el archivo; renombrar `ALLOWED_MINT_SYNC_TOKEN_CALLERS`
  para no cruzar el patrón `SYNC_TOKEN` que vigila
  `src/app/api/internal/boundaries.test.ts`) y el sensor las marcó resueltas
  solo, sin necesitar `learn` ni `dismiss`.

## Deuda dejada

Ninguna dentro del alcance de `plan.md`. Lo que queda fuera es lo que
`spec.md` § Fuera y `plan.md` § Qué queda fuera ya dejaban explícito: la tabla
`BusinessCredential`, la rotación con solape y la revocación (propuesta
`credenciales-de-integracion.md`); el HMAC de ADR 0008 sobre las rutas de
sync; y límite de tasa en código (la mitigación es la regla de firewall de
`docs/despliegue.md` §7).

## Qué necesita quien pruebe

- **Levantar el entorno**: `bash .agent/init.sh`, Postgres compartido ya
  corriendo (memoria: no lo levantes desde un worktree nuevo).
- **El secreto de aprovisionamiento en `.env` local** (gitignorado, no viaja
  con el commit): generarlo con el par de comandos de `docs/despliegue.md`
  §8.1 / `.env.example`, y añadir las dos líneas
  (`PROVISIONING_SECRET_SHA256=…`, `QAB_PROVISIONING_SECRET=…`) al `.env` de
  esta sesión de trabajo. Sin esto, `bash .agent/verify.sh F-034 --smoke`
  aborta en rojo con el comando de arreglo — nunca en verde.
- **Nunca** `npm run mint:token` ni tocar `seed-negocio-1`/`seed-negocio-2`:
  ninguna prueba de este feature lo necesita, y el smoke crea y limpia sus
  propios negocios bajo el prefijo `f034-smoke-`.
- Ejemplo de petición real, una vez el secreto está en `.env`:

  ```bash
  curl -X POST http://localhost:3000/api/provisioning/credential \
    -H "authorization: Bearer $QAB_PROVISIONING_SECRET" \
    -H 'content-type: application/json' \
    -d '{"externalId":"prueba-manual-1"}'
  ```

  Limpieza manual si hace falta:
  `DELETE FROM "Business" WHERE "externalId" = 'prueba-manual-1'`.

## Preguntas al humano

Ninguna. Las tres de `architecture.md` (AP1–AP3) ya las cerró el orquestador
en `plan.md`, y esta implementación las siguió sin desviarse de sus
recomendaciones.
