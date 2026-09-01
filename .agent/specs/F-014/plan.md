---
feature: F-014
agente: orquestador
actualizado: 2026-08-31T23:19:59Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Cuando la sincronización con cuadrecaja se rompe, hoy no falla nada: los precios
y la disponibilidad de la tienda pública se quedan viejos y nadie se entera hasta
que un comprador reclama. El endpoint que lo detecta ya existe, pero **nunca se
ha ejecutado y el otro lado no tiene cómo calcular el mismo hash**. Al terminar
este ciclo, el equipo de cuadrecaja podrá copiar de `docs/sync-contract.md` una
consulta SQL que produce exactamente el mismo hash que nuestro endpoint, y
nosotros tendremos ejecutado —no leído— que eso es cierto.

Lo que **no** cambia: ni el endpoint, ni su autenticación, ni la base de datos, ni
nada que vea un comprador. Un solo cambio de comportamiento, invisible desde
fuera: el orden en que se recorren los productos para calcular el hash deja de
depender de la configuración regional de la base de datos y pasa a estar fijado en
el código.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                                                          | Archivos                                                                | Criterio que acerca   | Cómo se verifica                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Comparador puro de bytes UTF-8 (`compareUtf8Bytes`), con su prueba. Prohibidos por contrato `<`, `.localeCompare()`, `.sort()` sin comparador e `Intl.Collator`. La prueba incluye el par `U+FFFD` / `U+10000`, el único oráculo que discrimina en cualquier máquina | src/lib/byteOrder.ts (por crear), src/lib/byteOrder.test.ts (por crear) | C12 (mitad pura)      | `bash .agent/verify.sh F-014` → 0. La prueba no toca la base: corre igual en musl, glibc y CI                     |
| 2   | `storeReconciliationHash()` pierde el `orderBy` y ordena en Node con el comparador del paso 1, con la clave `Buffer` precalculada por fila. Se extrae `reconciliationEntry(row)` como único sitio donde se escribe la forma `<id>:<precio>:<moneda>:<disp>\|`        | `src/features/sync/server/reconciliation.ts` (modificado)               | R8, base de C8        | `bash .agent/verify.sh F-014` → 0, con `tenantScoping.db.test.ts:157` (que ya existe) sin tocar y en verde        |
| 3   | **Dos** `overrides` opcionales en `createOffer`: `syncedPrice` y `syncedPriceCurrency`, el precio como texto decimal exacto (`"1990.00"`), nunca como `number`. `availability` ya es override desde F-015                                                            | `src/features/marketplace/server/dbFixtures.ts` (modificado)            | habilita 4 y 5        | Compila y la suite existente sigue en verde                                                                       |
| 4   | Script verificador del contrato HTTP, con siete modos. HTTP puro, **sin importar Prisma**, al estilo de `send-catalog-batch.mjs`                                                                                                                                     | scripts/check-reconciliation.mjs (por crear)                            | C1, C2, C5, C6, C10   | `node scripts/check-reconciliation.mjs --all` sale 0, con la app levantada y el token de `seed-negocio-1` acuñado |
| 5   | Los tres retoques aditivos de `docs/sync-contract.md`: el SQL espejo completo en § ⑤ con el límite de R15 escrito literal, la fila `400 MISSING_STORE_ID` en § «Vocabulario de errores (v5)», y la precondición de los ≤2 decimales en § ① y § ⑤                     | `docs/sync-contract.md`                                                 | C7                    | `bash .agent/verify.sh F-014 --full` → 0 (incluye `check:harness` y `format:check`, que es lo que valida el CI)   |
| 6   | Vector de prueba junto al SQL de § ⑤: cuatro filas (`1990.00`, `1990.50`, `1990.10`, `0.00`) y el md5 que tienen que obtener, para que cuadrecaja se autoverifique **sin** nuestra base                                                                              | `docs/sync-contract.md` § ⑤                                             | refuerza C7           | El md5 del vector se calcula ejecutando, no a mano, y se pega verificado                                          |
| 7   | El techo de catálogo en `docs/despliegue.md`: un renglón con 100 000 filas vivas por tienda y aviso a 50 000                                                                                                                                                         | `docs/despliegue.md`                                                    | ninguno (operación)   | `bash .agent/verify.sh F-014 --full` → 0                                                                          |
| 8   | Las pruebas del álgebra del hash contra Postgres real: campos del panel que no mueven el hash, las cuatro formas del precio contra literales, y el SQL espejo comparado con la función — incluida la comprobación de que la variante sin normalizar **difiere**      | src/features/sync/server/reconciliation.db.test.ts (por crear)          | C3, C4, C8, C9        | `bash .agent/verify.sh F-014 --only test` → 0. Presupuesto: ~2 s, decenas de filas, nunca miles                   |
| 9   | Prueba de la ruta con mocks, sin base: `200`, `400` sin `storeId`, `404`, y que sin cabecera responde `401` y no `400` (fijando `syncConfigured` para saber qué rama se simula)                                                                                      | src/app/api/internal/reconciliation/route.test.ts (por crear)           | C11                   | `bash .agent/verify.sh F-014` → 0. Es la única ruta de `/api/internal/*` sin prueba propia; deja de serlo         |
| 10  | Veredicto por criterio y casillas del progreso, cada una con el comando que la verifica                                                                                                                                                                              | `.agent/specs/F-014/tests.md`, `.agent/progress/F-014.md`               | los cinco del feature | `bash .agent/verify.sh F-014 --full` → 0 y `bash .agent/verify.sh pending F-014` vacío                            |

Pasos 1–7 son del **implementador**; 8–10 del **probador**. Los tests de
verificación no los escribe quien escribió el código: C8 tiene que comparar dos
implementaciones independientes, y si las escribe la misma mano en la misma
sesión deja de ser una comparación.

## De dónde sale cada paso

| Paso | Sale de                                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` D1 y § Contratos (`compareUtf8Bytes`, implementación obligada y las cuatro prohibidas); `spec.md` R8, C12; riesgo R-A                                                                                     |
| 2    | `architecture.md` D1 y D3 (`reconciliationEntry` como sitio único); `spec.md` R1, R8                                                                                                                                        |
| 3    | `architecture.md` D6 y § Componentes (`createOffer(..., overrides)`). Eran tres en el borrador que se enseñó: `availability` ya existe (`dbFixtures.ts:268-277`) y `externalId` dejó de hacer falta al salir C12 de la base |
| 4    | `spec.md` HD6 y C1/C2/C5/C6/C10; `architecture.md` § Contratos → «El script HTTP», con la tabla de siete modos                                                                                                              |
| 5    | `spec.md` HD1 ampliada por HD4 y HD5, R13, R15, R18, C7                                                                                                                                                                     |
| 6    | `architecture.md` riesgo **R-D**, como recomendación al implementador. **Es el único paso que ningún criterio exige** — ver § Preguntas, PP1                                                                                |
| 7    | `architecture.md` D2 y § Escalabilidad. **Tampoco lo exige ningún criterio**: sale de PP3, que el humano aprobó                                                                                                             |
| 8    | `spec.md` C3, C4, C8, C9; `architecture.md` D3, § «El SQL espejo local (R15), tal cual va en el test», y los dos avisos de tipos (`bigint`)                                                                                 |
| 9    | `spec.md` C11, E10; `architecture.md` D4 y el matiz de `syncConfigured()`                                                                                                                                                   |
| 10   | `.agent/README.md` § «Al completar un feature»                                                                                                                                                                              |

## Qué queda fuera

- **El cron y la alerta.** Cada cuánto corre la reconciliación y qué pasa cuando
  los hashes difieren es del lado de cuadrecaja. El contrato ya dice «diario» y
  «alertar si no hubo corrida exitosa en 30 minutos»; este feature no lo toca.
- **Un endpoint de «resincroniza esta tienda».** La acción correctora
  (`dispPublicada = NULL`) la ejecuta el POS en su propia base. Si algún día
  hace falta que la pida desde aquí, es un feature nuevo tuyo (regla 4).
- **La ADR 0027 propuesta** por el arquitecto, sobre fijar en el código el orden
  de cualquier cadena canónica que cruce la frontera. Decidido en PP2: se escribe
  en un ciclo aparte, después de cerrar F-014. La regla no se pierde mientras
  tanto — está escrita y medida en `architecture.md` D1.
- **Cambiar md5 por sha256.** Rompería el contrato con un equipo externo por cero
  beneficio: el uso no es criptográfico. Queda escrito en la spec (R14) para que
  nadie lo «arregle».
- **Paginar la query o partir el hash.** Cambiaría la cadena canónica. El techo
  medido es 100 000 filas por tienda; la tienda más grande de hoy tiene 30.
- **Renombrar `MISSING_STORE_ID`** a algo más limpio: eso sí sería un cambio de
  contrato. Se documenta tal como está.
- **Migraciones e índices.** Ninguna, ninguno. `prisma/schema.prisma` no se toca.

## Riesgos y plan B

**Sí hay cambio en `docs/sync-contract.md`, y hay otro equipo al otro lado.** Es
el paso 5 (más el 6, si lo apruebas). Todo es **aditivo sobre la v5, sin bump de
versión**: no cambia ningún payload, ninguna respuesta ni ningún código de
estado. Lo que hace es escribir tres cosas que hoy el otro equipo no puede saber.
No hay migración de datos ni ningún comando de los que `AGENTS.md` marca como
prohibidos.

**El riesgo real es entregar un espejo roto.** Si el SQL que publicamos no
reproduce exactamente la serialización del precio, cuadrecaja calcula otro hash y
la reconciliación alerta todas las noches sin que nada esté roto — hasta que
alguien la silencia, y entonces sí deja de detectar la avería que existía para
detectar. Está medido que la lectura natural (`precio::text`) produce justo eso:
sobre `seed-tienda-1`, `c9ef1f16…` contra el correcto `e894ce15…`. Mitigación: el
paso 7 compara el SQL con la función ejecutándolos, y exige que la variante sin
normalizar **difiera** (si no difiere, es que la fixture no tiene ningún precio
con cero de cola y la prueba estaba pasando por casualidad). El paso 6 lleva la
mitigación al otro lado de la frontera.

**Lo que esa prueba NO cubre, y va escrito en el documento:** valida el orden, los
separadores y la serialización del precio; **no** valida los nombres de las
columnas de cuadrecaja, ni el `JOIN` con `Producto`, ni el `coalesce` de
`dispPublicada`. Eso solo lo puede verificar el otro equipo. Prefiero que el doc
lo diga a que la prueba se venda por más de lo que es.

**Ningún test local puede fallar por la colación.** La base local es musl y
colacciona como `C` aunque declare `en_US.utf8`; Supabase es glibc y no. Por eso
el paso 1 mueve la corrección al código y su prueba es pura: el par
`U+FFFD` / `U+10000` discrimina en cualquier máquina, y sin él el criterio pasaría
aunque alguien escribiera `.sort()`.

**La suite `db` se acerca a su límite** (7 archivos, 77 pruebas, 19,4 s, en serie
desde F-019). El paso 7 añade el octavo con ~2 s de presupuesto. **Plan B** si el
CI empieza a agotar tiempos: fundir las pruebas de C3/C4 dentro del `describe` que
ya existe en `tenantScoping.db.test.ts` y dejar el archivo nuevo solo con C8/C9.

**Plan B si una tienda superara las 100 000 filas** (hoy la mayor tiene 30): mover
el cómputo a un `$queryRaw` con el mismo SQL, que lo calcula dentro de Postgres en
83 ms con memoria constante. No altera la cadena canónica. Precio a pagar con los
ojos abiertos: ese día C8 pasaría a comparar el SQL consigo mismo, así que habría
que sustituirla por un hash dorado fijo.

## Coste

Dos ciclos de agente: implementador (pasos 1–6) y probador (7–9).

**De lo que ya funciona se toca poco y acotado:** un cambio de comportamiento
real —el orden— en `reconciliation.ts`, más una extracción de función en el mismo
archivo, más tres `overrides` opcionales en una fixture. El endpoint, el guard, el
schema, la firma y el retorno de `storeReconciliationHash()`, el `select` de
cuatro columnas y `tenantScoping.db.test.ts` **no se tocan**. Todo lo demás son
archivos nuevos y documentación.

**Marcha atrás a mitad:** barata y sin residuos. Los cinco archivos nuevos se
borran; `reconciliation.ts` y `dbFixtures.ts` vuelven con `git checkout`; los
retoques del contrato son tres bloques aditivos que se quitan enteros. No hay
migración que revertir, ni dato que se haya escrito, ni nada desplegado al otro
equipo hasta que el documento se publique.

## Preguntas antes de aprobar

Ninguna abierta. Las tres se resolvieron antes de firmar y el plan de arriba ya
las incorpora.

**PP1 — El vector de prueba en § ⑤ entra.** Respuesta del humano: «Sí, entra».
Es el paso 6. Motivo: el modo de fallo que más miedo da en este feature es que
cuadrecaja implemente el SQL y no coincida, y un vector de cuatro filas con su
md5 es lo más barato que lo previene — les deja autoverificarse sin nuestra base
y sin pedirnos nada. Ningún `acceptance_criteria` lo exige; es alcance aprobado
a propósito.

**PP2 — La ADR 0027 va en un ciclo aparte.** Respuesta del humano: «En un ciclo
aparte, tras cerrar F-014». Sigue en § «Qué queda fuera». Motivo: la regla ya
está escrita y medida en `architecture.md` D1, así que no corre peligro de
perderse, y meter la ADR dentro de este ciclo alargaría la firma de algo que ya
está decidido. Queda como trabajo pendiente para después de cerrar F-014.

**PP3 — El techo se anota en `docs/despliegue.md`.** Respuesta del humano: «Sí,
un renglón». Es el paso 7, y hace que los cambios documentales de este ciclo
sean **cuatro**, no tres. Motivo: un techo que solo existe en el
`architecture.md` de un feature no lo lee quien recibe la alerta a las tres de
la mañana. `docs/despliegue.md` no es el contrato con cuadrecaja, así que este
cuarto cambio no toca la frontera de HD1.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-014 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-08-31T23:19:59Z — aprobado por el humano: «PP1: "Sí, entra" — el vector de prueba en § ⑤ es el paso 6. PP2: "En un ciclo aparte, tras cerrar F-014" — la ADR 0027 queda fuera de este ciclo. PP3: "Sí, un renglón" — el techo de catálogo se anota en docs/despliegue.md, paso 7. Con eso, aprobado.»
