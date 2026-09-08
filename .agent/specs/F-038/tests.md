---
feature: F-038
agente: sdd-tester
actualizado: 2026-09-08T02:13:24Z
estado: listo
veredicto: listo
---

## Estrategia

El paso 10 del plan firmado, y solo ese: `src/features/sync/server/handlers/business.db.test.ts`
(por crear → creado en este ciclo), los trece escenarios de architecture.md
§ AD6 contra el `POST` real, leyendo la fila. Los pasos 1-9 y 11-13 (los seis
archivos de unidad, la migración, el guion de humo, la prosa) son del
implementador y no se repiten aquí — se **ejecutan** para el veredicto, no se
vuelven a escribir.

**`business.db.test.ts`**, entorno `db` (`*.db.test.ts` → proyecto `db`,
`fileParallelism: false`, AGENTS.md § Cosas que muerden). Trece escenarios,
diecisiete casos (`C3` está parametrizado sobre cinco códigos malformados:
`"usd"`, `"US1"`, `"€€€"`, `"USDD"`, `""`). Cada `it` usa una
`FixtureSession` **propia** (`beforeEach`/`afterEach`, nunca compartida): la
guarda de este handler vive en una sola columna de una sola fila
(`displayCurrenciesSourceUpdatedAt`), así que un test que dejara una marca
puesta cambiaría en silencio qué significa "rancio" para el siguiente — y E16
necesita explícitamente una fila cuya marca siga en `NULL`, que solo tiene una
sesión recién creada.

Tres decisiones de esta sesión, ninguna reabre nada de architecture.md:

1. **El código sintético de C7 es `"XTS"`** — literalmente el ejemplo de
   spec.md E9, y un código ISO 4217 reservado para pruebas. Comprobado libre
   contra `Currency` antes de escribir el test (`SELECT code FROM "Currency"
WHERE code IN ('XTS', ...)` → 0 filas) y contra la lista de § AD6. Sin
   `afterAll`: el handler no escribe `Currency`/`ExchangeRate` (R9), así que no
   hay nada que limpiar, y esa ausencia es lo que el criterio 7 demuestra.
2. **C4+E6 y C5+la retirada de R7 son un solo `it` cada uno**, no varios: el
   orden de las aserciones dentro del test es el propio contenido de la
   prueba (E6 depende de que la fila siga como en E4; la retirada de R7
   depende de la fila que dejaron los dos bordes de C5).
3. **E13 se prueba por el efecto, no leyendo el handler**: la mitad
   "duplicate" reenvía el mismo `eventId` con una lista **distinta** de la
   primera vez — si el handler se llamara de nuevo, la fila cambiaría; que
   sobreviva la primera lista es la prueba de que no se llamó. La mitad
   "failed no es duplicate" reenvía un evento que había fallado (`DELETE`) ya
   corregido, y comprueba que sí se reprocesa (AGENTS.md § «un evento fallido
   NO es un duplicado»).

Los criterios 11, 12, 13 y 14 no necesitan código de prueba nuevo: 11 y 12 los
verifica `.agent/specs/F-038/smoke.sh` (ya escrito por el implementador, AD7),
ejecutado en este ciclo, no solo leído; 13 se verifica leyendo los cuatro
documentos que I9 enumera y comprobando que ninguno sigue diciendo que
`entity` no admite `BUSINESS` (salvo la única frase que describe lo retirado,
que tiene que seguir ahí); 14 es `verify.sh --full`, ejecutado **con**
`business.db.test.ts` ya en el árbol — el criterio vale con el test dentro, no
sin él.

## Mapa criterio → prueba

| #   | Criterio de aceptación (literal de `features.json`)                                                                                                                                                                                                  | Prueba                                                                                                                             | Archivo                                                                             | Resultado  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------- |
| 1   | «Un lote con un evento de entity BUSINESS y una lista valida responde 207 con ese evento en ok y status processed, y la lista queda guardada para ese negocio, verificado leyendo la fila.»                                                          | C1 (E1)                                                                                                                            | `business.db.test.ts` → `"C1 (E1): ..."`                                            | PASA       |
| 2   | «Un evento con un entity que el contrato no define (por ejemplo ZONE_TARIFF) sigue respondiendo 400 INVALID_BATCH del lote entero: aceptar BUSINESS no abre el sobre a cualquier cosa.»                                                              | C2 (E2), las dos mitades: unitaria en `schemas.test.ts` (ya existía) + `business.db.test.ts` → `"C2 (mitad POST, E2): ..."`        | `schemas.test.ts`, `business.db.test.ts`                                            | PASA       |
| 3   | «Un miembro malformado de displayCurrencies devuelve SOLO ese evento en failed[] con BUSINESS_DISPLAY_CURRENCIES_INVALID, el resto del lote se aplica, y la lista guardada queda como estaba.»                                                       | C3 (E3), parametrizado ×5                                                                                                          | `business.db.test.ts` → `"C3 (E3): ..."` (`it.each`)                                | PASA       |
| 4   | «Un BUSINESS con operation DELETE devuelve failed[] con BUSINESS_DELETE_NOT_SUPPORTED y no escribe nada, comprobado leyendo la lista antes y despues.»                                                                                               | C4 (E4) + E6 (el mismo `it`, dos bordes)                                                                                           | `business.db.test.ts` → `"C4 (E4) + E6: ..."`                                       | PASA       |
| 5   | «Un BUSINESS con updatedAt menor o igual al guardado responde stale, viaja en ok y no pisa la lista nueva.»                                                                                                                                          | C5 (E5), `<` y `==`, más la retirada de R7                                                                                         | `business.db.test.ts` → `"C5 (E5) + R7's retirada: ..."`                            | PASA       |
| 6   | «Una lista con codigos repetidos se guarda deduplicada y responde processed, sin error.»                                                                                                                                                             | C6 (E8)                                                                                                                            | `business.db.test.ts` → `"C6 (E8): ..."`                                            | PASA       |
| 7   | «Un BUSINESS que cita una moneda que no tiene fila en Currency ni ninguna tasa responde processed: no falla y no crea ninguna moneda provisional.»                                                                                                   | C7 (E9)                                                                                                                            | `business.db.test.ts` → `"C7 (E9): ..."`                                            | PASA       |
| 8   | «displayCurrencies con lista vacia se acepta y deja la lista vacia, que significa 'solo la moneda base'.»                                                                                                                                            | C8 (E10)                                                                                                                           | `business.db.test.ts` → `"C8 (E10): ..."`                                           | PASA       |
| 9   | «Un BUSINESS cuyo businessId no es el del token responde 403 BUSINESS_MISMATCH del lote entero y no escribe nada.»                                                                                                                                   | C9 (E11), las dos mitades: unitaria en `identity.test.ts` (ya existía, I6) + `business.db.test.ts` → `"C9 (mitad POST, E11): ..."` | `identity.test.ts`, `business.db.test.ts`                                           | PASA       |
| 10  | «Cuarenta codigos validos en la misma lista se aceptan: no hay tope de longitud.»                                                                                                                                                                    | C10 (E12)                                                                                                                          | `business.db.test.ts` → `"C10 (E12): ..."`                                          | PASA       |
| 11  | «Este feature no pinta nada en la tienda publica: las paginas de la tienda del seed muestran exactamente lo que mostraban antes, comprobado con el mismo catalogo.»                                                                                  | C11(a) estática (`git diff --stat`) + C11(b) dinámica (`.agent/specs/F-038/smoke.sh`, control de determinismo + diff)              | `git diff`, `.agent/specs/F-038/smoke.sh`                                           | PASA       |
| 12  | «node scripts/send-catalog-batch.mjs gana una bandera que envia un BUSINESS contra el servidor levantado y su salida distingue processed, stale, failed y duplicate.»                                                                                | Los seis comandos de R22, ejecutados por `.agent/specs/F-038/smoke.sh`                                                             | `.agent/specs/F-038/smoke.sh` (los seis `--business*`)                              | PASA       |
| 13  | «Al cerrarlo: se retira de la cabecera de docs/sync-contract.md el aviso de que entity todavia no acepta BUSINESS, se mueve la version del documento, y se avisa al equipo de cuadrecaja de que ya pueden dejar de filtrar el evento en su drenaje.» | Lectura + `grep` de los cuatro sitios (I9 + el cuarto de architecture.md)                                                          | `docs/sync-contract.md`, `docs/despliegue.md`, `.agent/solicitudes.md`, `AGENTS.md` | PASA       |
| 14  | «bash .agent/verify.sh F-038 --full termina con codigo 0.»                                                                                                                                                                                           | `verify.sh --full`, con `business.db.test.ts` ya en el árbol                                                                       | —                                                                                   | PASA (`0`) |

Cobertura adicional, sin criterio numerado propio: la mitad "un evento FAILED
no es duplicate y se reprocesa" de E13 (AGENTS.md § Cosas que muerden) y E17
(dos `BUSINESS` del mismo negocio en el mismo lote, gana el segundo) — ambas
en `business.db.test.ts`, porque son exactamente el tipo de borde que R7 y la
regla del inbox existen para proteger y ninguna de las dos tiene su propio
número en `features.json`.

## Ejecuciones

Todo corrido desde la raíz del repo, con el Postgres de `docker-compose.yml`
ya levantado y **migrado** (comprobado: la migración del implementador ya
estaba aplicada a la base compartida antes de empezar — el error «does not
exist in the current database» de la ficha
`code-ahead-of-shared-db-migration-rompe-db-tests` no apareció en ningún
momento).

```
$ npx vitest run src/features/sync/server/handlers/business.db.test.ts --project db
 Test Files  1 passed (1)
      Tests  17 passed (17)

$ npx vitest run \
    src/features/sync/server/handlers/business.test.ts \
    src/features/sync/server/handlers/business.db.test.ts \
    src/features/sync/schemas.test.ts \
    src/features/sync/identity.test.ts \
    src/features/sync/dependencies.test.ts \
    src/features/sync/displayCurrencies.test.ts \
    src/features/sync/server/processBatch.test.ts \
    --project server --project db
 Test Files  7 passed (7)
      Tests  144 passed (144)

$ npx vitest run --project server --project db
 Test Files  124 passed (124)
      Tests  1394 passed (1394)

$ bash .agent/verify.sh F-038 --full ; echo "EXIT: $?"
== Verificación F-038 · intento 27 ==
  ✓ harness    1s
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     8s
  ✓ test       25s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s
PASA
EXIT: 0

$ bash .agent/verify.sh F-038 --smoke ; echo "EXIT: $?"
== Verificación F-038 · intento 28 ==
  ✓ typecheck  1s
  ✓ lint       4s
  ✓ format     8s
  ✓ test       27s
  ✓ smoke      4s
PASA
EXIT: 0

$ cat .agent/runs/F-038/028-smoke.log        # criterios 11(b) y 12, con la app en pie
--- control C11(b) ---
  aviso dos peticiones seguidas de /tienda-demo YA difieren sin que este guion
  haya tocado nada — next dev no es determinista para esta página; la
  comparación de más abajo se normaliza en las DOS mitades
--- criterio 12 ---
  ok   criterio 12 (1/6) — HTTP 207
  ok   criterio 12 (1/6) — --business responde processed
  ok   criterio 12 (2/6) — --business=invalid responde failed BUSINESS_DISPLAY_CURRENCIES_INVALID
  ok   criterio 12 (3/6) — --business=delete responde failed BUSINESS_DELETE_NOT_SUPPORTED
  ok   criterio 12 (4/6) — --business --stale responde stale
  ok   criterio 12 (5/6) — --business --repeat (primera vez) responde processed
  ok   criterio 12 (6/6) — --business --repeat (segunda vez) responde duplicate
--- criterio 11(b) ---
  ok   criterio 11(b) — /tienda-demo antes y después de un BUSINESS son
  idénticas (este feature no pinta nada)
0 aserciones fallidas
--- salida del servidor (runtime feedback) ---
[sync] BUSINESS event rejected: malformed displayCurrencies member {...}
[sync] BUSINESS event rejected: DELETE is not an operation of this entity {...}
(sin ninguna línea que dispare SERVIDOR_ERROR_RE — los dos console.warn llevan
el prefijo [sync], nunca console.error, R21)

$ git diff --stat main -- src/app src/components src/features/catalog src/features/storefront
(vacío)                                                              # C11(a)

$ head -3 docs/sync-contract.md | grep -c '12.2'
1
$ grep -c 'todavía no admite' docs/sync-contract.md
0
$ grep -n 'no lo emitáis hasta' docs/sync-contract.md
51:  § «Cambios requeridos en cuadrecaja» y de § Verificación —«no lo emitáis hasta
    # única aparición: dentro de § «Cambios respecto a la v12.1», describiendo
    # lo RETIRADO — exactamente la excepción que C13 permite (spec.md, la
    # propia § que enumera qué se quitó tiene que seguir mencionándolo)

$ bash .agent/verify.sh pending F-038
(vacío)
```

Leídos a mano, no solo grepeados, los cuatro sitios de C13: la cabecera de
`docs/sync-contract.md` (línea 3, v12.2, y el párrafo que dice «ya están en
pie... podéis emitirla desde ahora»), § «Cambios requeridos en cuadrecaja» →
«De la v12» punto 1 («el lado receptor ya está en pie... ese riesgo ya no
existe»), § Verificación (las seis líneas `--business` en el bloque de
comandos), `docs/despliegue.md` § 8.3 («ya hecha (F-038, 2026-09-08)»),
`.agent/solicitudes.md` § Cerradas, S-008 (la línea fechada 2026-09-08,
añadida sin sustituir el registro del 2026-09-06) y `AGENTS.md` § Cosas que
muerden (la enumeración ya dice `STORE`, `CATEGORY`, `PRODUCT`, `BUSINESS`).
Ninguno de los cuatro sigue afirmando que `entity` no admite `BUSINESS`.

`npm test` dentro de `--full` corre los tres proyectos de una vez: 1394
pruebas, todas en verde, incluidas las 17 nuevas de `business.db.test.ts` y
las que el implementador ya dejó verdes en los otros seis archivos.

## Fallos encontrados

Ninguno de producto. Una nota de proceso, no un fallo: la primera pasada de
`business.db.test.ts` no estaba formateada (`npx prettier --check` en rojo);
corregido con `npx prettier --write` sobre **este único archivo** —el que yo
escribí— antes de correr `--full`, siguiendo AGENTS.md § Cosas que muerden
(nunca formatear a ciegas un documento ajeno; este sí era mío). Confirmado con
`npx prettier --check` en verde después, y el propio archivo re-corrido en
verde tras el reformateo.

`bash .agent/verify.sh pending F-038` sale vacío: no queda ninguna lección de
este ciclo sin fichar.

## Huecos de cobertura

- **El `console.warn` de los dos rechazos** (R21, AD5) no se afirma en
  `business.db.test.ts` — sí se afirma, con `vi.spyOn`, en `business.test.ts`
  (unidad, ya escrito por el implementador). No es un hueco de este archivo:
  duplicar esa aserción contra Postgres real no prueba nada que la unidad no
  pruebe ya, y `--smoke` sí demuestra que la línea real que sale por
  `console.warn` no dispara `SERVIDOR_ERROR_RE` (visto en el log de arriba).
- **SP1 (si este feature invalida caché)** sigue sin código ni prueba, por
  diseño (D4/R13): no hay lector, así que no hay nada que revalidar. Fuera de
  alcance de este feature, heredado por F-039.
- **E15 = criterio 11** ya está en la tabla — no es un hueco, se nombra aquí
  solo para que quede explícito que E15 y el criterio 11 son el mismo
  escenario con dos nombres.

## Veredicto

**LISTO.** Los catorce `acceptance_criteria` de `.agent/features.json` se
verificaron ejecutando algo: los trece escenarios nuevos contra Postgres real
(`business.db.test.ts`, paso 10, 17 casos), los seis archivos de unidad que ya
estaban verdes y se volvieron a correr (144 casos en total con los de este
archivo), el guion de humo con la app en pie (`--smoke`, 0 aserciones
fallidas), la lectura de los cuatro documentos de la prosa (C13) y
`bash .agent/verify.sh F-038 --full` en `0` **con el archivo de este ciclo ya
en el árbol** (C14). `bash .agent/verify.sh pending F-038` está vacío.

## Preguntas al humano

Ninguna. Los catorce criterios se pudieron verificar tal como están escritos,
y no hubo ningún fallo cuya gravedad fuera una decisión de producto.
