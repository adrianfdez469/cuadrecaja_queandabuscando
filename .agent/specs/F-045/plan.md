---
feature: F-045
agente: orquestador
actualizado: 2026-09-10T04:38:58Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Hoy, cuando el POS de cuadrecaja manda un evento de sucursal, lo **primero** que
hacemos —antes de comprobar nada— es escribir el nombre del negocio y su moneda
base. Si el evento después se rechaza, se descarta o resulta ser una reentrega
vieja, esas dos columnas ya se escribieron igual. El caso que más duele es el de
la reentrega vieja: contestamos «lo ignoré, estaba rancio» y al mismo tiempo
retrocedemos la moneda del catálogo, en silencio y sin refrescar la portada.

Después de esto, esas dos columnas se escriben **si y solo si** el evento se
aplica de verdad. Ni una respuesta cambia: mismos códigos, mismos cuerpos,
mismos `ok`/`failed`. El POS no tiene que cambiar nada, y el contrato pasa a
prometer en firme lo que hasta ahora prometía con una salvedad.

Lo que **no** cambia: quién es dueño de esas dos columnas (las sigue escribiendo
el mismo evento, apuntando al negocio autenticado), ni ninguna de las guardas,
ni el número de consultas de un evento que sí se aplica.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                          | Archivos                                                        | Criterio que acerca | Cómo se verifica                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | El helper privado `applyBusinessFields` y sus **tres** llamadas, cada una la última línea antes de su escritura (entre `:139`/`:140`, `:221`/`:222`, `:270`/`:271`). Se va el comentario de `:71-73` | `src/features/sync/server/handlers/store.ts`                    | base de 1-6         | `npm run typecheck`; `npx vitest run --project server …/store.test.ts` verde; `npx vitest run --project db …/business.db.test.ts` falla **exactamente** en `:674-676` y en ningún otro sitio |
| 2   | El recuento de escrituras: cuatro `toHaveBeenCalledOnce()` y siete `not.toHaveBeenCalled()` sobre tests que ya existen, sin un solo `it` nuevo                                                       | `src/features/sync/server/handlers/store.test.ts`               | 6                   | `npx vitest run --project server src/features/sync/server/handlers/store.test.ts`                                                                                                            |
| 3   | Invertir el aserto de I4 de F-043 y preparar el arnés: `storeEvent` gana parámetros, nace `readBusinessIdentity`, se reescriben los docstrings de `:133-139`, `:646` y `:673`                        | `src/features/sync/server/handlers/business.db.test.ts`         | 1                   | `npx vitest run --project db src/features/sync/server/handlers/business.db.test.ts` vuelve a verde                                                                                           |
| 4   | Los siete `it` nuevos del `describe` de F-045, con sesión fresca por test y valores **distintos** de los de la fixture                                                                               | `src/features/sync/server/handlers/business.db.test.ts`         | 2(a) 2(b) 3 4 5     | El mismo comando; y `prisma.slug` sin filas con el `token` de la sesión al terminar                                                                                                          |
| 5   | El `it` propio de `STORE_TIMEZONE_INVALID`, con **un solo** evento en el lote                                                                                                                        | `src/features/sync/server/handlers/storePublishGate.db.test.ts` | 2(c)                | `npx vitest run --project db src/features/sync/server/handlers/storePublishGate.db.test.ts`                                                                                                  |
| 6   | La nota de I4 pasa a ser la promesa completa                                                                                                                                                         | `src/constants/sync.ts:136-139`                                 | —                   | `npm run typecheck` y `npm run lint` (es prosa, no hay test)                                                                                                                                 |
| 7   | El contrato a **v13.3**: línea 3, § `zoneCode` (`:230-240`), fila de `STORE_ZONE_UNKNOWN` (`:1892`) y entrada nueva en «Cambios respecto a la v12.2»                                                 | `docs/sync-contract.md`                                         | 7                   | `grep -n 'Versión 13.3'` → línea 3; `grep -c 'Business.name'` → `0`; `grep -c 'I4'` → `0`; el hook `sync-contract-version.sh` no protesta                                                    |
| 8   | `npm run format` sobre lo escrito, diffeado antes de aceptarlo, y el sensor completo                                                                                                                 | —                                                               | 8                   | `bash .agent/verify.sh F-045 --full; echo $?` → `0`                                                                                                                                          |

Dos commits (AGENTS.md § Git): `fix(sync): un STORE que no se aplica no escribe
el negocio (F-045)` con los pasos 1-6, y `docs(sync-contract): v13.3 …` con el 7.

## De dónde sale cada paso

| Paso | Línea que lo justifica                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 1    | `spec.md` R1, R2; `architecture.md` AD1 (el helper) y AD2 (la tabla de las tres líneas exactas)                   |
| 2    | Criterio 6 de `features.json`; `architecture.md` AD5, fila «6» y su lista de los once tests                       |
| 3    | Criterio 1; `spec.md` R10 y SP3 del humano; `architecture.md` AD5 fila 1 y AD7 filas 3 y 4                        |
| 4    | Criterios 2(a), 2(b), 3, 4 y 5; `architecture.md` AD5 (reparto, anti-vacuidad, el `Slug` huérfano); `spec.md` CL2 |
| 5    | Criterio 2(c); `architecture.md` AD5 fila «2 (c)» y la segunda trampa de su § final                               |
| 6    | `spec.md` SI6; `architecture.md` AD7 fila 2                                                                       |
| 7    | Criterio 7; `spec.md` R9, SI7; `architecture.md` AD6                                                              |
| 8    | Criterio 8                                                                                                        |

Ningún paso sale de otro sitio. El paso 6 es el único que no cierra un criterio
por sí solo: está porque su texto afirma hoy un defecto que el paso 1 borra, y
dejarlo sería documentación que miente al revés.

## Qué queda fuera

- **Mover, adelantar o retrasar cualquier guarda.** `assertZoneKnown`,
  `assertDeliveryConsistent`, `assertOpeningHoursValid` y las dos del `timezone`
  se quedan donde están. Adelantarlas convertiría `stale` y
  `skipped_not_published` en `failed[]`, que es un cambio de contrato disfrazado
  de refactor (AD4 de F-043, E9/E12 de F-041).
- **El `.default("CUP")` de `baseCurrency`** (`src/features/sync/schemas.ts:42`).
  Un `STORE` que **omite** la moneda seguirá poniendo el negocio en `CUP` aunque
  fuera `USD` — solo que ya no lo hará desde un evento que no se aplica. Quitarlo
  cambia lo que el POS puede omitir: es versión **mayor** y va como F-046, que ya
  tiene propuesta escrita. Decisión suya del 2026-09-10 (SP5).
- **La transacción.** Cerrar del todo la ventana de un error de base entre las
  dos escrituras exige `$transaction`, y el pooler de Supabase lo prohíbe con el
  cliente global (AGENTS.md § Cosas que muerden). Se acepta por escrito una
  ventana **más pequeña que la de hoy**: hoy las dos columnas se escriben
  siempre; después, solo justo antes de una escritura de sucursal que podría
  fallar (SI8, CL6, CL7).
- **El `nested write`.** Ahorraría un round-trip en los dos caminos de
  actualización, pero el de alta pasa por `createStorefrontWithStore` y no tiene
  dónde plegarse: quedaría una doctrina «según el camino». Queda disponible como
  optimización posterior, sin puertas cerradas (SP2).
- **Una marca anti-rancio propia para el negocio.** Dos sucursales del mismo
  negocio entregadas fuera de orden se siguen resolviendo por «gana la última»,
  que es lo que el contrato ya declara asumido. Costaría columna nueva y
  migración.
- **Reparar los negocios que hoy tengan la moneda mal por este defecto.** No hay
  forma de saber cuáles son sin comparar contra el POS, y el siguiente `STORE`
  que se aplique los deja bien solos.
- **Dejar de escribir `Business.name`** aunque tenga cero lectores en `src/`. Es
  una decisión de propiedad de campos con el otro equipo, no de posición de una
  escritura.
- **`handleBusiness`** y las dos filas del contrato que hoy mienten
  (`STORE_OPENING_HOURS_INVALID`, `STORE_DELIVERY_CONFIG_INCONSISTENT`): el
  arreglo las vuelve verdad **sin tocarlas**, y que no haya que debilitarlas es
  la señal más barata de que va en la dirección correcta.

## Riesgos y plan B

**Sí hay cambio en `docs/sync-contract.md`, y hay otro equipo al otro lado.**
Sube a v13.3, dígito **menor**: el POS no envía ni recibe nada distinto y no
tiene forma de observar esas dos columnas. Las tres ediciones **quitan**
salvedades, ninguna añade una obligación. La v13 sigue sin publicar, así que
cuadrecaja nunca llegará a leer la versión débil — que es justo por lo que usted
puso este feature antes de F-044.

**No hay migración de datos, ni cambio de schema, ni ningún comando de los que
`AGENTS.md` marca como prohibidos.**

| Riesgo                                                                                         | Cómo se notaría                                           | Qué se hace                                                                         |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Colocar la llamada «al lado de `assertZoneKnown`» y dejar `STORE_TIMEZONE_INVALID` escribiendo | El aserto de `store.test.ts:234` del paso 2, en segundos  | Es la trampa que AD2 documenta con las tres líneas exactas; el paso 2 la caza antes |
| Una guarda futura añadida **debajo** de la llamada reabre el defecto en pequeño                | No se notaría sola                                        | El docstring dice «una guarda nueva va ENCIMA de esta llamada»; los siete asertos   |
| El test del alta deja un `Slug` huérfano en la base de cada dev y del CI                       | Basura acumulada, y un valor de slug ocupado para siempre | `slug` derivado del token + `deleteMany` antes de `cleanup()` (AD5.4)               |
| El aserto de F-043 se «arregla» borrándolo en vez de invirtiéndolo                             | Se perdería el criterio 3 de F-043                        | R10: las otras tres aserciones de ese `it` no se tocan                              |
| Los tests nuevos pasan sin probar nada (la fixture ya deja `CUP`)                              | Verde falso                                               | AD5.3: todo evento que no debe escribir viaja con `"USD"` y otro nombre             |

**Plan B:** no hay sobre la forma del arreglo — la (a) la eligió usted y la (d)
la prohíbe el pooler. Si el criterio 5(b) saliera inestable, la causa sería que
los dos eventos apuntan a la misma sucursal, no el arreglo (CL2).

**Marcha atrás:** un `git revert` de los dos commits. No hay estado que
deshacer: sin migración, sin datos escritos, sin API nueva. Lo único que
sobreviviría es la v13.3 del contrato, que se retiraría con su propia entrada.

## Coste

Dos ciclos de agente: `sdd-implementer` (pasos 1-3 y 6-7) y `sdd-tester` (pasos
4-5 y el sensor del 8). Unas doce líneas de producto en un archivo; el resto es
prueba y prosa.

**De lo que ya funciona se toca:** `store.ts` (tres inserciones y un comentario
que se va), un `it` de F-043 que se invierte, once tests de `store.test.ts` que
ganan un aserto cada uno, el arnés de `business.db.test.ts`, una nota en
`src/constants/sync.ts` y cuatro sitios del contrato. Los `*.db.test.ts` corren
en serie, así que los ocho `it` nuevos cuestan ≈0,5 s por ejecución del sensor.

## Preguntas antes de aprobar

> **Las dos contestadas por el humano el 2026-09-10, antes de firmar.**
> **`PP1` → (a), mencionarlo.** La entrada de la v13.3 lleva la frase que
> reconoce que las filas de `STORE_OPENING_HOURS_INVALID` y
> `STORE_DELIVERY_CONFIG_INCONSISTENT` prometían desde la v9 algo que hasta esta
> revisión no era exacto. Afecta al paso 7 y a nada más.
> **`PP2` → (a), editar el criterio.** El criterio 7 de `.agent/features.json`
> ya pide **los dos** greps (`Business.name` y `I4`, ambos a `0`), editado por
> el humano con el feature sin empezar. La spec no se ablandó en ningún momento;
> lo que cambia es que el criterio dice ahora lo que de verdad se comprueba.

**`PP1` (era `AP1` del arquitecto) — La entrada de la v13.3, ¿confiesa que había
otras dos filas optimistas, o habla solo de lo que se edita?** Las filas de
`STORE_OPENING_HOURS_INVALID` y `STORE_DELIVERY_CONFIG_INCONSISTENT` prometen
desde la v9 que un evento fallido no escribe nada, y hasta hoy era falso por esta
misma causa; el arreglo las vuelve verdad sin tocarlas. El criterio 7 se cumple
con las dos respuestas.

- **(a) Mencionarlo**, una frase en la entrada de la v13.3. **Recomendada**: la
  v13 sigue sin publicar, la confesión cuesta una línea y llega antes de que
  nadie construya encima; y cuadrecaja clasifica sus reintentos por lo que el
  contrato promete que se escribió, así que puede explicarles un dato viejo que
  ya vieron.
- **(b) No mencionarlo**: la entrada habla solo de los dos sitios que se editan.

**`PP2` — El criterio 7 pide un `grep` que no cubre lo que el propio criterio
nombra.** `grep -c 'Business.name' docs/sync-contract.md` solo ve la fila
`:1892`; la salvedad del § `zoneCode` (`:234-238`) está escrita en prosa
castellana y ese grep la deja pasar a `0` **sin haberla tocado**. `sdd-spec` no
lo ablandó (regla 3) y le sumó la comprobación que sí lo cubre,
`grep -c 'I4' docs/sync-contract.md` a `0`. El criterio no está **mal**, está
**incompleto**, y `features.json` es suyo.

- **(a) Editar el criterio 7** para que pida los dos greps. **Recomendada**: es
  su archivo, el feature está sin empezar y así el criterio dice lo que de verdad
  se comprueba, en vez de dejar la mitad en la spec.
- **(b) Dejarlo como está**: la spec y el plan ya exigen los dos greps, y el
  criterio se cumple de sobra. Cuesta que dentro de seis meses alguien lea el
  criterio y crea que basta con uno.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-045 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-10T04:38:58Z — aprobado por el humano: «Apruébalo. PP1: mencionarlo, la entrada de la v13.3 confiesa que las otras dos filas también mentían. PP2: editar el criterio 7 para que pida los dos greps.»
