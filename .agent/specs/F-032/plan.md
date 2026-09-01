---
feature: F-032
agente: orquestador
actualizado: 2026-09-01T21:13:24Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Que un negocio pueda configurar **cómo se compra en su tienda** desde cuadrecaja
—si el checkout va por WhatsApp o en el local, si hay domicilio, cuánto cuesta o
si se cotiza por pedido, y cuántas horas vive una propuesta— en vez de que
alguien con acceso a Postgres escriba un `UPDATE` a mano. Esas cinco columnas
pasan a viajar en el evento `STORE` del sync, opcionales las cinco.

La regla que manda es **omitir no es apagar**: el POS de hoy no conoce ninguna de
las cinco, y un evento que no las trae tiene que dejar la tienda exactamente como
estaba. Sin esa regla, la primera corrección de un teléfono en el POS apagaría el
domicilio de todas las tiendas configuradas a mano.

**Qué no cambia:** nada, hasta que cuadrecaja las emita. No hay pantalla nueva,
no hay migración, el panel sigue sin tocar esas columnas y una tienda existente
se comporta igual el día del despliegue que el anterior.

## Pasos

Cuatro etapas; cada una queda verde por sí sola. La 4 puede solaparse con la 3,
pero no adelantarse a la 1: el contrato no puede describir rangos que el schema
todavía no impone.

| Nº  | Qué se hace                                                                                                                                                                                                                            | Archivos                                                                                   | Criterio que acerca | Cómo se verifica                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Las cinco claves, opcionales y planas, en el payload de `STORE`, con sus rangos y vocabularios sacados del enum generado; más el `refine` de la contradicción visible solo en el payload                                               | `src/features/sync/schemas.ts`                                                             | 3, 4, 5             | src/features/sync/schemas.test.ts (por crear): los trece payloads y el payload v6 exacto                                                                    |
| 2   | El token del error por evento                                                                                                                                                                                                          | `src/constants/sync.ts`                                                                    | 5                   | Lo consumen el `refine` del paso 1 y el `throw` del paso 5; sin literal repetido en ningún sitio                                                            |
| 3   | El módulo puro del sync: `STORE_CONFIG_KEYS`, `pickDefined`, `storeConfigWrite`, `effectiveDeliveryConfig`, `NEW_STORE_DELIVERY_BASELINE`                                                                                              | src/features/sync/server/storeConfig.ts (por crear)                                        | 1, 5                | storeConfig.test.ts (por crear): ausente fuera, `null` dentro, mezcla con fila y sin fila, y la deriva de defaults leyendo `prisma/schema.prisma` del disco |
| 4   | El invariante `isDeliveryConfigInconsistent`, escrito **sobre** `isDeliveryOffered` para que no puedan divergir                                                                                                                        | `src/features/orders/deliveryOffer.ts`                                                     | 5                   | `src/features/orders/deliveryOffer.test.ts`: tabla de verdad, con `deliveryFee: 0` válido                                                                   |
| 5   | El handler: tres columnas más en el `select`, la guarda de consistencia llamada tres veces (una antes de cada escritura) y `...config` en los tres `data`; `SyncEventFailure` como transporte                                          | `src/features/sync/server/handlers/store.ts`, `src/features/sync/server/handlers/types.ts` | 1, 2, 5, 6, 15      | `src/features/sync/server/handlers/store.test.ts`: E1, E8, E9, E10, E11, E13                                                                                |
| 6   | El fixture compartido del evento `STORE`: contacto sembrado + los trece presets                                                                                                                                                        | scripts/store-event.mjs (por crear)                                                        | 1–6                 | Lo consumen los pasos 7 y 8                                                                                                                                 |
| 7   | `--store-config[=caso]` en el guion que nombran los criterios; no se envía `STORE` con `--unknown-store`                                                                                                                               | `scripts/send-catalog-batch.mjs`                                                           | 1, 2, 4, 5, 6       | Los criterios 1–6, ejecutados contra el servidor de desarrollo                                                                                              |
| 8   | Que `send-store-batch.mjs` deje de borrar los contactos de la tienda sembrada: importa el mismo fixture                                                                                                                                | `scripts/send-store-batch.mjs`                                                             | —                   | Ejecutarlo y comprobar con `psql` que `description`/`address`/`city`/`whatsapp` siguen ahí                                                                  |
| 9   | Las cinco en la lista negra del panel, y el aserto de deriva del fixture contra el seed                                                                                                                                                | `src/features/admin/server/boundaries.test.ts`, `src/app/api/internal/boundaries.test.ts`  | 7                   | `npm test -- boundaries`                                                                                                                                    |
| 10  | Que el `400` es del lote entero y que un `STORE` fallido convive con `PRODUCT`s procesados en el mismo `207`                                                                                                                           | `src/app/api/internal/sync/catalog/route.test.ts`                                          | 3, 4, 5             | `npm test`                                                                                                                                                  |
| 11  | El comentario `///` de `orderExpiryHours`, que hoy afirma lo contrario                                                                                                                                                                 | `prisma/schema.prisma`                                                                     | 8                   | `grep -n -A4 orderExpiryHours prisma/schema.prisma` nombra a cuadrecaja y ya no dice «the sync never sends it»                                              |
| 12  | La **v7** del contrato: las cinco claves con tipo y obligatoriedad, la tabla ausente/`null`/valor, la tabla de propiedad con sus cinco filas, el riesgo del 400 con ejemplo, el error por evento, y «Cambios requeridos en cuadrecaja» | `docs/sync-contract.md`                                                                    | 9                   | `head -3` dice Versión 7; el hook `.claude/hooks/sync-contract-version.sh` no protesta                                                                      |
| 13  | § 9.5 deja de mandar un `UPDATE` a mano y explica que la configuración llega por el sync                                                                                                                                               | `docs/despliegue.md`                                                                       | 14                  | `grep -n 'UPDATE "Store"' docs/despliegue.md` no devuelve nada                                                                                              |
| 14  | Verificación completa contra Postgres y el servidor de desarrollo                                                                                                                                                                      | —                                                                                          | 1–6, 10, 12, 13     | `bash .agent/verify.sh F-032 --full` y `bash .agent/verify.sh F-019 --full`, los dos en `0`                                                                 |

El ADR 0028 ya está escrito (`docs/adr/0028-configuracion-de-compra-del-pos.md`,
en estado **Propuesta**), así que el criterio 11 no tiene paso propio: lo que
queda es que lo citen el contrato (paso 12) y el comentario del schema (paso 11).

## De dónde sale cada paso

| Paso | Línea que lo justifica                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | spec R2 (planas), R3 (`null` solo en el importe), R4 (toda la validación en Zod), R5 (rangos), R19 (vocabulario del enum); arquitectura § Contratos |
| 2    | AGENTS.md § Prohibiciones (magic strings a `src/constants/`); arquitectura DA4                                                                      |
| 3    | spec R1 (ausente = no toques), R7 (valor efectivo); arquitectura DA2 y DA3                                                                          |
| 4    | spec R8 (el invariante); arquitectura DA1                                                                                                           |
| 5    | spec R9, R10.2, R11, R14; arquitectura DA1, DA4 y § Flujo de datos                                                                                  |
| 6–7  | spec R20 (el instrumento crece con el feature) y R21 (los contactos o borra la tienda); arquitectura DA5                                            |
| 8    | arquitectura § Estado actual (el guion ya borra cuatro columnas hoy) y AP1                                                                          |
| 9    | criterio 7 de `features.json`; arquitectura DA7                                                                                                     |
| 10   | criterios 3, 4 y 5; arquitectura DA7                                                                                                                |
| 11   | criterio 8; spec I2                                                                                                                                 |
| 12   | criterio 9; spec I1, I4 e I8                                                                                                                        |
| 13   | criterio 14 de la spec, que sale de AGENTS.md § Documentación                                                                                       |
| 14   | criterios 12 y 13                                                                                                                                   |

Ningún paso sale de otro sitio. Los tres que **no** están en los trece criterios
del backlog van marcados aquí a propósito, con su motivo, en § Alcance añadido.

## Alcance añadido, y por qué

Tres cosas que el humano no pidió literalmente y que este plan sí hace:

1. **Paso 13 — `docs/despliegue.md` § 9.5.** Ese documento manda hoy escribir a
   mano el `UPDATE` que este feature vuelve innecesario. Dejarlo sería publicar
   una instrucción operativa falsa el mismo día que deja de ser cierta;
   AGENTS.md § Documentación dice que un paso operativo se anota en el ciclo que
   lo cambia.
2. **Paso 8 — arreglar `scripts/send-store-batch.mjs`.** Ese guion existe hoy,
   manda eventos `STORE` sin los campos de contacto y, como el handler escribe
   `?? null`, **borra** `description`, `address`, `city` y `whatsapp` de la
   tienda sembrada en cada ejecución. Es exactamente la trampa que R21 obliga a
   evitar en el guion hermano; dejar una de las dos armada garantiza que alguien
   la pise, y el arreglo es un `import` y un spread en la misma etapa.
3. **Los tests de los pasos 5, 9 y 10.** Sin ellos, la regla que da nombre al
   feature —«omitir no es apagar»— no la sostiene nada frente a la siguiente
   refactorización.

## Qué queda fuera

- **`Store.timezone` y el resto de F-022.** Aquí se escriben las **cinco filas**
  de la tabla de propiedad, no la tabla exhaustiva: esa es el criterio 4 de
  F-022.
- **Pantalla de panel.** Decisión SP3 de F-031, mantenida: no hay editor, y el
  panel sigue sin tocar ninguna de las cinco.
- **El bucle de renegociación de F-019.** `orderExpiryHours` cambia de dueño; lo
  que `expiry.ts` y `proposal.ts` hacen con ese número no se toca.
- **El umbral de stock bajo.** Por ADR 0003 se queda en cuadrecaja.
- **Reparar filas ya inconsistentes.** Ninguna tienda que hoy tenga domicilio
  encendido sin forma de cobrarlo se corrige sola; el criterio 10 exige
  justamente que nada existente cambie.
- **Arreglar el `?? null` de los campos de contacto.** El contrato promete desde
  la v2 que omitir un campo lo deja como está, y el código lo **borra** (spec
  I1). Este ciclo corrige **la prosa del contrato**, no el comportamiento: hacer
  que el código cumpla la promesa es un cambio de conducta que nadie pidió y que
  merece su propio feature. Queda señalado abajo.
- **Que cuadrecaja lo emita.** Es de otro repo. Mientras no lo haga, aquí no
  cambia nada —esa es toda la gracia— y se verifica con lotes simulados.
- **Ninguna migración.** Las cinco columnas y los dos enums existen desde F-031.

## Riesgos y plan B

- **Cambia `docs/sync-contract.md`, y hay otro equipo al otro lado.** Sube a la
  **v7**, que es la versión que el propio contrato ya anunció por su nombre y con
  estas cinco columnas (`docs/sync-contract.md:68-74`). El cambio es **aditivo**:
  un POS que implemente la v6 y no envíe nada de esto sigue siendo un emisor
  correcto. Plan B si el otro equipo objeta: nada que revertir aquí, porque hasta
  que ellos emitan, el comportamiento es idéntico.
- **Un valor mal formado tumba el lote entero con `400`** (decisión SP1), y el
  reintento vuelve a fallar: el outbox del negocio se para hasta que se corrija
  en el POS. Va documentado en el contrato con el payload que lo provoca. Plan B
  registrado en la ADR 0028: aplicar el evento degradado a
  `deliveryEnabled = false` en vez de fallar, que es un cambio de una línea.
- **Un evento contradictorio contra la fila se reintenta para siempre.** Se
  vigila con `SELECT count(*) FROM "SyncEvent" WHERE status = 'FAILED'`.
- **Resembrar entre las dos lecturas invalida el criterio 1.** `prisma/seed.ts`
  reescribe las cinco y adelanta `sourceUpdatedAt`: **no se ejecuta `npm run
seed` entre el «antes» y el «después»**. Es precondición del paso 14, no una
  nota al pie.
- **Verificar exige acuñar el token del sync**, que es una escritura en una base
  **compartida** entre worktrees: rota `seed-negocio-1` y deja en 401 a quien
  tuviera el anterior. Comprobado antes de decidirlo: de los tres worktrees, solo
  este tiene `.env` y su `QAB_BEARER_TOKEN` está **vacío**; `surgeonfish` no
  tiene `.env` y `tuskfish` solo el ejemplo. **Nadie sostiene un token ahora, así
  que acuñar no deja fuera a nadie.** Plan B si aparece otra sesión usando el
  sync: `seed-negocio-2` existe en el seed y da un token independiente.
- **Ninguna migración, ningún comando prohibido.** No se ejecuta `npm run
db:migrate`, ni `prisma migrate reset`, ni `prisma db push`. El único cambio en
  `prisma/schema.prisma` es un comentario `///`, que no genera SQL; el criterio
  10 se comprueba con `prisma migrate diff --exit-code` dando 0.
- **Preparar el caso E8 exige dejar una fila inconsistente a mano.** Es el único
  `UPDATE` manual del ciclo y es montaje de prueba, no configuración: el código
  nuevo impide que el sync cree ese estado, así que hay que fabricarlo con SQL
  para comprobar que se rechaza.

## Coste

- **Dos ciclos de agente**: `sdd-implementer` (pasos 1–13) y `sdd-tester`
  (verificación de los criterios 1–6 y 10 contra Postgres, más el veredicto).
- **Lo que se toca de lo que ya funciona**: el handler del sync, que corre con
  cada lote real del POS. La mitigación es que todo lo nuevo es aditivo y va
  detrás de «la clave está presente»; el camino de un lote v6 no cambia de forma.
  `processBatch.ts` **no se toca**, y eso es deliberado: es la señal de que el
  transporte del error elegido es el correcto.
- **Marcha atrás a mitad**: barata. Nada de esto tiene estado persistente propio
  —no hay migración, no hay columna nueva, no hay dato que convertir—, así que
  revertir los commits deja el repo exactamente como está hoy. Lo único que
  sobreviviría es el token reacuñado, que no es un daño sino un valor nuevo.

## Preguntas antes de aprobar

Ninguna abierta.

- **SP1–SP4** las cerró el humano antes de empezar (bitácora, 2026-09-01).
- **AP1** (¿se arregla el borrado de `send-store-batch.mjs`?) se resuelve en el
  paso 8, la opción que recomendaba el arquitecto, y queda declarada como
  alcance añadido.
- **AP2** (¿con qué token se verifica?) se resuelve acuñando, tras comprobar que
  ningún otro worktree sostiene uno.
- **I5** (que el caso dependiente de la fila falle en vez de aplicarse degradado)
  queda como está y con su alternativa escrita en la ADR 0028 y en § Riesgos.

Lo único que este plan deja sobre la mesa sin resolver, a propósito y porque el
backlog es del humano: **el `?? null` de los campos de contacto** (spec I1). Aquí
se corrige la prosa del contrato; que el código cumpla lo prometido sería un
feature nuevo.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-032 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-01T21:13:24Z — aprobado por el humano: «aprueba el plan tu mismo si crees que es coherente, sino muestrame el resumen y el porque no crees que deberias aprobarlo tu, para revisarlo y aprobarlo yo o revocarlo — (delegacion expresa del humano; el orquestador lo reviso paso por paso contra spec.md y architecture.md y lo firma en su nombre, dejando I1 senalado para que pueda revocarlo)»
