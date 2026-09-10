---
feature: F-043
agente: orquestador
actualizado: 2026-09-10T02:26:55Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Hoy, un `zoneCode` que este lado no reconoce mata el lote entero con un `400`, y
en el POS de cuadrecaja eso le suma un intento a **todas** las filas del lote:
con seis intentos, una sola divergencia de un municipio se lleva por delante
cada `PRODUCT` y cada `STORE` que viajara con ella, para siempre. Después de
esto, ese `zoneCode` falla **solo su evento** —`207` con la fila en `failed[]`—
y los otros 499 se aplican.

No cambia nada de la forma del payload: `zoneCode` sigue siendo una cadena
obligatoria en `ZONE_TARIFF` y opcional en `STORE`, con la misma semántica de
omisión, y los dos códigos de error que ya conoce cuadrecaja siguen llamándose
igual byte a byte y siguen siendo reintentables. Para ellos es estrictamente
mejor y no les obliga a cambiar nada que ya funcione.

Lo que **no** cambia: la precedencia, el catálogo de 184 zonas y su `sha256`, la
cascada `STORE → ZONE_TARIFF`, el aviso de «no emitáis `ZONE_TARIFF` todavía»
—la v13 sigue en borrador— y el camino del comprador, que valida su `zoneCode`
sin catálogo a propósito.

## Pasos

Cada paso deja el árbol verde por sí solo. El agente va marcado al principio:
**[impl]** `sdd-implementer`, **[test]** `sdd-tester`, **[orq]** yo. Nunca hay
dos escribiendo en `src/` a la vez.

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                                                                                  | Archivos                                                                                                                                                       | Criterio que acerca | Cómo se verifica                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **[impl]** La guarda nueva: `assertZoneKnown(zoneCode: string)` privada, no exportada, mismo nombre que la gemela de `store.ts`. Se llama en **un** sitio, entre el `return STALE` y el `upsert`. Va **primero**, antes de tocar el sobre, para que no exista ni un commit en el que nadie mire el catálogo                                                  | `src/features/sync/server/handlers/zoneTariff.ts` (`:84-93`)                                                                                                   | prepara C1, C2, C7  | `bash .agent/verify.sh F-043 --only test` → 0                                                                                             |
| 2   | **[impl]** El caso unitario que fija el orden: zona desconocida **después** del `STALE` y **antes** del `upsert`, comprobando que el upsert no se llamó                                                                                                                                                                                                      | `src/features/sync/server/handlers/zoneTariff.test.ts`                                                                                                         | C7                  | `bash .agent/verify.sh F-043 --only test` → 0                                                                                             |
| 3   | **[impl]** El sobre deja de juzgar el **valor**: fuera el import del catálogo, `zoneCode: z.string().nullish()` en `STORE`, borrar `const zoneCodeSchema` y dejar `z.string()` en las tres ramas de `ZONE_TARIFF`. Se le quita a la lista blanca de fronteras la línea `schemas.ts`, con el comentario de por qué salió                                      | `src/features/sync/schemas.ts` (`:8`, `:58`, `:170-173`, `:178`, `:189`, `:198`); `src/features/zones/boundaries.test.ts:97-119`                               | C3                  | `bash .agent/verify.sh F-043` → 0                                                                                                         |
| 4   | **[impl]** Los dos asertos de esquema que quedan falsos se **invierten** a `success === true`, y se les añade el que hoy no existe y es el que impide malinterpretarlos: `zoneCode: 2101` **numérico** sigue siendo `success === false`                                                                                                                      | `src/features/sync/schemas.test.ts:392-402`                                                                                                                    | C3 (lectura (a))    | `bash .agent/verify.sh F-043 --only test` → 0                                                                                             |
| 5   | **[impl]** `ZONE_CODE_PATTERN` se retira de la API del catálogo: se queda sin ningún importador en `src/` al terminar el paso 3, y dejarlo exportado al lado de la única pregunta buena es invitar a que alguien lo vuelva a enchufar                                                                                                                        | `src/features/zones/catalog.ts:22`                                                                                                                             | — (AD2)             | `grep -rn "ZONE_CODE_PATTERN" src/` solo devuelve el test del paso 6; `bash .agent/verify.sh F-043 --only test` → 0                       |
| 6   | **[test]** La forma DPA pasa de prosa a aserción: hoy **nada** comprueba que los 184 códigos del artefacto la cumplan. Va en el **mismo ciclo** que el paso 5 o la forma se pierde entre los dos                                                                                                                                                             | `src/features/zones/catalog.test.ts`                                                                                                                           | — (AD2)             | `bash .agent/verify.sh F-043 --only test` → 0                                                                                             |
| 7   | **[test]** La prueba que afirma el `400` se **reescribe, no se borra**: mismo lote, veredicto invertido a `207` / `failed[0]` / el `PRODUCT` en `ok` / `syncEvent.count() === 2` con el culpable en `FAILED` / cero tarifas. El nombre pasa a citar C1 y a decir que supera al criterio 6 de F-041                                                           | `src/features/sync/server/handlers/zoneTariff.db.test.ts:400-441`                                                                                              | C1                  | `bash .agent/verify.sh F-043 --only test` → 0, con Postgres arriba                                                                        |
| 8   | **[test]** Los casos nuevos de extremo a extremo, en el mismo archivo: mal formado (`"2101"`, `""`, `" 21.01"`); el lado `STORE` con `.not.toBe(400)`; `zoneCode: null` y la clave ausente, leyendo la columna después; `DELETE` con zona inválida; sucursal ajena → `skipped` en `ok`                                                                       | `src/features/sync/server/handlers/zoneTariff.db.test.ts`, `src/features/sync/server/handlers/business.db.test.ts` (el lado `STORE`)                           | C2, C3, C6, C7      | `bash .agent/verify.sh F-043 --only test` → 0                                                                                             |
| 9   | **[impl]** `markFailed` deja de hacer un `updateMany` **por fallo**: uno por mensaje **distinto**. Mismas filas, mismos estados, mismo `.slice(0, 500)`, cero cambio observable — 500 round-trips pasan a 1 en el escenario que motiva el feature                                                                                                            | `src/features/sync/server/inbox.ts:85-96`                                                                                                                      | — (AD5, AP2 = (a))  | `bash .agent/verify.sh F-043 --only test` → 0                                                                                             |
| 10  | **[test]** El caso que la agrupación del paso 9 podría romper y hoy no existe: **dos mensajes de error distintos en el mismo lote**, comprobando que cada fila queda con el suyo                                                                                                                                                                             | `src/features/sync/server/dependencyCascade.db.test.ts` (donde ya se lee la fila `FAILED` y su `error`, `:319-326`)                                            | — (AD5)             | `bash .agent/verify.sh F-043 --only test` → 0                                                                                             |
| 11  | **[impl]** El contrato sube a **v13.2** con los **siete sitios** que enumera `spec.md` § «Los siete sitios», más el **7-bis** de AD4: la promesa «ninguno de sus otros campos se aplica» pasa a «ninguno de sus otros campos **de la sucursal**», con la nota de que el nombre del negocio y su moneda base sí pueden haberse escrito                        | `docs/sync-contract.md` (`:3`, `:153`, `:214-219`, `:893`, `:897-920`, `:1251-1258`, `:1844-1846`, `:1869`, `:1871`, `:2202`, § «Cambios respecto a la v12.2») | C4                  | `sed -n 3p` contiene `13.2`; `grep -c 'que se lleva 499 eventos'` da `0`; ninguna línea con `ZONE_TARIFF_ZONE_UNKNOWN` dice `400` de lote |
| 12  | **[impl]** Los dos comentarios de las constantes, que hoy documentan el `400`: el de `ZONE_TARIFF_ZONE_UNKNOWN` pasa a nombrar el handler, las **dos** causas y el `failed[]`; el de `STORE_ZONE_UNKNOWN` gana la causa «mal formado» y pierde la promesa que I4 desmiente. **Los valores no cambian**: el POS los compara byte a byte                       | `src/constants/sync.ts:93`, `:134`                                                                                                                             | C4                  | `bash .agent/verify.sh F-043` → 0                                                                                                         |
| 13  | **[impl]** El docstring de la gemela de `handleStore` deja de decir «never in `storePayloadSchema` (I6: …)»: el sobre ya no opina sobre **ninguna** forma del campo y esta guarda es el único sitio donde se decide. Solo comentario, cero lógica                                                                                                            | `src/features/sync/server/handlers/store.ts:355-366`                                                                                                           | — (AD4)             | `bash .agent/verify.sh F-043 --only lint` → 0                                                                                             |
| 14  | **[impl]** La ADR **0034**, «Lo que valida el sobre y lo que valida el aplicador», con los seis puntos que AD3 fija: el corte en una frase, los tres precedentes que ya lo decidieron sin regla escrita, la premisa de SP1 corregida con los dos números, y por qué las cinco columnas de la 0028 **siguen** en `400` con el criterio nuevo y no por inercia | `docs/adr/0034-lo-que-valida-el-sobre-y-lo-que-valida-el-aplicador.md` (por crear)                                                                             | — (AD3, AP3 = (a))  | `bash .agent/verify.sh F-043 --full` → 0                                                                                                  |
| 15  | **[impl]** La 0028 gana la línea que apunta a la 0034, al lado de la que ya apunta a la 0033, y su cabecera pasa de «Propuesta» a **«Aceptada»**: su propio disparador era F-032, que ya tiene `passes: true`                                                                                                                                                | `docs/adr/0028-configuracion-de-compra-del-pos.md:3-5`, `:7-10`                                                                                                | — (AP4 = (a))       | `bash .agent/verify.sh F-043 --full` → 0                                                                                                  |
| 16  | **[orq]** La coordinación con cuadrecaja que pide el criterio 4, que no es un comando: la fila **S-007** anota que F-043 cerró el `400` de lote y que el borrador va por v13.2                                                                                                                                                                               | `.agent/solicitudes.md` (fila S-007)                                                                                                                           | C4                  | `bash .agent/solicitudes.sh` sin solicitudes sin postura                                                                                  |
| 17  | **[orq]** Al cerrar: anotar en los artefactos de F-041 que su criterio 6 quedó **superado** por F-043 (I1). Son de otro feature, por eso no los tocó nadie durante el ciclo                                                                                                                                                                                  | `.agent/specs/F-041/spec.md`, `.agent/specs/F-041/architecture.md`                                                                                             | — (I1)              | lectura; `bash .agent/sdd.sh done F-043` no lo comprueba, lo compruebo yo                                                                 |
| 18  | **[test]** La puerta                                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                                              | **C5**              | `bash .agent/verify.sh F-043 --full` → 0 y `bash .agent/verify.sh pending F-043` vacío                                                    |

## De dónde sale cada paso

| Paso  | Línea que lo justifica                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 1, 2  | `architecture.md` § AD1 (la gemela privada, llamada en un sitio) + `spec.md` R7 paso 4 y C7                            |
| 3     | `architecture.md` § AD1 punto 3 (el guardián es la lista blanca, no el helper) y § Contratos 2; `spec.md` R1/R5 y C3   |
| 4     | `architecture.md` § «Pruebas que quedan falsas» 2 y 3; lectura (a) del humano, 2026-09-09                              |
| 5, 6  | `architecture.md` § AD2                                                                                                |
| 7, 8  | `architecture.md` § «Pruebas que quedan falsas» 1 y 5; `spec.md` C1, C2, C3, C6, C7                                    |
| 9, 10 | `architecture.md` § AD5 y § «Pruebas que quedan falsas» 6; **AP2 respondida (a)** por el humano el 2026-09-09          |
| 11    | `spec.md` § «Los siete sitios de `docs/sync-contract.md`» + `architecture.md` § AD4 (el 7-bis); **AP1 respondida (a)** |
| 12    | `spec.md` § «Los dos comentarios de `src/constants/sync.ts`»                                                           |
| 13    | `architecture.md` § AD4, primer párrafo                                                                                |
| 14    | `architecture.md` § AD3; **AP3 respondida (a)**                                                                        |
| 15    | `architecture.md` § AD3 punto 6 y su observación final; **AP4 respondida (a)**                                         |
| 16    | `acceptance_criteria` 4 («coordinada con cuadrecaja») + `.agent/README.md` § «Lo que nos pide el otro equipo»          |
| 17    | `spec.md` § I1 y § «No decidido a propósito» 3, que lo asigna al orquestador                                           |
| 18    | `acceptance_criteria` 5                                                                                                |

Ningún paso sale de mi cabeza. Los pasos 5, 6, 9, 10, 13, 14 y 15 no cierran
ninguno de los cinco criterios: salen de decisiones de la arquitectura y de tus
cuatro respuestas de hoy, y por eso van marcados con «—» en vez de con un
criterio.

## Qué queda fuera

- **El camino del comprador.** `src/features/orders/schemas.ts:109` valida el
  `zoneCode` con `min`/`max` y **sin** catálogo, a propósito. Retirar el
  `refine` del sync no lo toca, y nadie va a «aprovechar» para endurecerlo.
- **Los otros valores del sobre.** Un `rule` inválido, un `deliveryFee` donde
  `rule` lo prohíbe, un `updatedAt` que no es ISO, un `deliveryFeeMode` fuera
  del enum: **siguen siendo `400` de lote**. Este feature mueve `zoneCode` y
  nada más. Las cinco columnas de la ADR 0028 se quedan donde están, y la 0034
  escribe **por qué** (tu AP3).
- **El tipo JSON del `zoneCode`.** Un `"zoneCode": 2101` numérico, o la clave
  ausente en `ZONE_TARIFF`, siguen siendo `400 INVALID_BATCH`: es la única
  puerta que queda abierta al `400` por este campo, y es tu lectura (a).
- **I4, el defecto de verdad.** `handleStore` escribe `Business.name` y
  `baseCurrencyCode` (`store.ts:74-78`) **antes** de toda guarda, así que un
  `STORE` que falla por su zona ya dejó rastro. Es de la v9 y F-043 lo hace
  alcanzable con una causa más. **No se arregla aquí** (tu AP1): solo se deja de
  prometer lo contrario, en el contrato y en el comentario. Las dos contenciones
  baratas están prohibidas —llamar la guarda al principio convertiría `SKIPPED`
  y `STALE` en `failed[]`, y mover la escritura toca tres caminos de retorno de
  un handler que este feature no necesita tocar.
- **Publicar la v13.** Sigue en borrador. Este feature la deja en v13.2 y la
  publicación espera tu visto bueno y el de ellos.
- **Los otros siete puntos del veredicto de cuadrecaja.** El 2 es F-044; los 6,
  7 y 9 y los cinco menores se cierran dentro de F-041; la generalización del 4
  no entra.
- **Cualquier pantalla.** Backend puro: no hay ciclo de `sdd-designer` y
  `npm run check:bundle` no se mueve un byte.

## Riesgos y plan B

- **Cambia `docs/sync-contract.md`, y hay otro equipo al otro lado.** Es el
  paso 11 y es el que no se aprueba de pasada. Mitigación: el borrador de la v13
  **sigue sin publicar**, así que esto es una revisión del mismo borrador y un
  dígito menor (v13.2), no una versión mayor que renegociar. Para cuadrecaja el
  cambio es estrictamente mejor: un código que ya trataban como reintentable lo
  sigue siendo y deja de arrastrar al resto del lote. Marcha atrás: revertir el
  paso 11 devuelve el documento a v13.1 sin tocar código.
- **Sin migración de datos.** `prisma/schema.prisma` no se toca: cero `ALTER`,
  cero índices, y ninguno de los comandos que `AGENTS.md` marca como prohibidos
  entra en el plan.
- **Un lote divergente ahora se procesa, y eso cuesta.** Antes costaba **0**
  consultas porque el `400` cortaba en la puerta; ahora un lote de 500
  `ZONE_TARIFF` todos con zona desconocida cuesta ≈502 round-trips contra un
  pool de `max: 5` que es el mismo que sirve la tienda pública. Sin el paso 9
  serían ≈1002. Cómo se notaría: latencia del endpoint de sync en lotes con
  muchos fallos. Plan B si molestara: el techo ya existe
  (`MAX_CATALOG_EVENTS = 500`) y el siguiente corte sería agrupar también el
  `findUnique` del handler — no está en este plan.
- **Un valor que el sobre rechazaba ahora llega a disco.** Sin `max()`, un
  `zoneCode` larguísimo se persiste en `SyncEvent.payload` aunque el evento
  falle. El límite real lo pone el tamaño del cuerpo de la plataforma, así que
  hoy no es un riesgo; si algún día hiciera falta un tope va en el **cuerpo** o
  en una poda de `SyncEvent`, **nunca** de vuelta en `zoneCode`.
- **La prueba que se pone roja sola.** En cuanto el paso 3 quite el import,
  `src/features/zones/boundaries.test.ts` falla con un diff de arrays que no
  dice por qué. Por eso el paso 3 la arregla **en el mismo paso**, no después.
- **Las pruebas contra Postgres corren aquí.** `npm test` incluye los
  `*.db.test.ts` y `sdd.sh start` confirma Postgres alcanzable, así que el
  paso 7 no tiene punto ciego local. Si Postgres se cayera a mitad, el sensor lo
  diría como fallo de etapa `test`, no como verde.
- **Los emuladores de Auth y Realtime no responden** en este worktree. Ninguna
  etapa de este plan los necesita, y **no se levantan desde aquí**: comparten
  contenedores con los otros worktrees.

## Coste

Cinco o seis ciclos de agente: `sdd-implementer` para los pasos de código y
documento, `sdd-tester` para los de prueba, y los dos últimos son míos. Nunca
hay dos escribiendo en `src/` a la vez.

De lo que ya funciona se toca poco y bien acotado: un handler (una función
privada y una llamada), el esquema del sobre (tres sitios), una función de
`inbox.ts` (cinco líneas, cero cambio observable), dos comentarios de
constantes y un docstring. Lo demás son pruebas y documentos.

Marcha atrás a mitad: revertir es limpio hasta el paso 10 —nada de lo tocado
tiene estado persistente y no hay migración—. A partir del paso 11 lo que hay
que deshacer es el contrato, que se revierte a v13.1 con un `git revert` de ese
commit. El único punto sin vuelta atrás barata sería publicar la v13, y eso no
está en este plan.

## Preguntas antes de aprobar

**Ninguna.** Las siete decisiones que este feature necesitaba están tomadas y
escritas: el código de error reutilizado y la variante simple (tú, 2026-09-09),
la versión v13.2 (ya escrita en el propio contrato), las tres lecturas (a), (b)
y (c) de `spec.md` § Huecos (tú, 2026-09-09) y las cuatro AP1–AP4 de
`architecture.md`, todas con la opción (a) (tú, 2026-09-09). Están recogidas una
a una en `.agent/progress/F-043.md`.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-043 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-10T02:26:55Z — aprobado por el humano: «Apruebo, adelante»
