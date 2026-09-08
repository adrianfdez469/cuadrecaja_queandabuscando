---
feature: F-037
agente: orquestador
actualizado: 2026-09-07T18:52:05Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Hoy, cuando el POS manda un lote y una categoría falla, el producto que va
detrás y pertenece a esa categoría **se publica igual, sin categoría**, y el POS
recibe un «hecho» que le hace borrar ese evento de su cola: nadie repara ese
producto hasta que el comerciante lo vuelva a tocar. Después de este feature ese
producto **no se aplica en absoluto**: vuelve marcado como fallido con el código
`DEPENDENCY_FAILED_IN_BATCH`, el POS lo reintenta tal cual en la siguiente
corrida y entra bien cuando la categoría entre. Lo mismo con una moneda que
falla y la tasa de cambio que la sigue en el mismo lote.

Lo que **no** cambia: el resto del lote se aplica como siempre, un producto cuya
categoría simplemente no viene en el lote se sigue guardando sin categoría igual
que hoy, y no cambia ni un campo de lo que el POS envía o recibe. La regla ya
está publicada y acordada con el equipo de cuadrecaja en la v11 del contrato, así
que este feature **no mueve la versión** de `docs/sync-contract.md`.

El precio, que conviene leer entero antes de firmar: mientras la dependencia siga
fallando, el dependiente **deja de existir en vez de existir mal**. Si una
categoría agota los seis reintentos del outbox, sus productos los agotan detrás y
el comerciante no ve esos productos en absoluto, donde hoy los veía sin
categoría. Es la contrapartida que ya está escrita en el contrato y en las
`notes` del feature.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                                                                                                                                                                                                                                     | Archivos                                                                      | Criterio que acerca | Cómo se verifica                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| 1   | La constante `DEPENDENCY_FAILED_IN_BATCH`, con la forma exacta que ya tiene ahí `STORE_DELIVERY_CONFIG_INCONSISTENT`                                                                                                                                                                                                                                                                                                                            | `src/constants/sync.ts`                                                       | 1, 4                | `bash .agent/verify.sh F-037 --only typecheck`                                          |
| 2   | El módulo puro: `dependencyRoleOf` (el `switch` exhaustivo sobre `entity`, con guarda `never`) y `createBatchDependencies` (el `Set` de claves compuestas, con `blockedBy` y `note`). Sin Prisma, sin React, solo `import type`                                                                                                                                                                                                                 | src/features/sync/dependencies.ts (por crear)                                 | 1, 3, 4, 5, 6, 7    | `bash .agent/verify.sh F-037 --only typecheck`                                          |
| 3   | La unidad del álgebra de claves: mayúsculas y espacios distinguen (E11), `CATEGORY:USD` ≠ `CURRENCY:USD` (E16), `null`/ausente/`""` no participan (E12), ninguna entidad tiene los dos papeles (R11), `note` limpia con `processed` y con `stale` y no con `skipped_not_published` (R13)                                                                                                                                                        | src/features/sync/dependencies.test.ts (por crear)                            | 3, 5, 6             | `bash .agent/verify.sh F-037 --only test`                                               |
| 4   | La guarda del bucle: `blockedBy` antes de `applyEvent`, `console.warn` con prefijo `[sync]` y `throw new SyncEventFailure(...)` dentro del `try`; más los dos `note` (el del camino feliz y el del `catch`)                                                                                                                                                                                                                                     | `src/features/sync/server/processBatch.ts`                                    | 1, 4, 6, 7, 8       | `bash .agent/verify.sh F-037` en 0                                                      |
| 4b  | La corrección de R13 que salió al implementar: `note()` **no limpia** la clave cuando la entidad es `CATEGORY` y la operación es `DELETE` — un `DELETE` nunca prueba que la fila exista (la borra, o no encuentra nada y responde `processed` igual). `CURRENCY` sigue limpiando: su handler ignora la operación y siempre hace `upsert`, así que ahí la fila sí existe                                                                         | `src/features/sync/dependencies.ts`, `src/features/sync/dependencies.test.ts` | 1, 6, 7             | `bash .agent/verify.sh F-037 --only test`                                               |
| 5   | El `console.error` preexistente de `processBatch.ts` pasa a `console.warn("[sync] …")`, a nueve líneas de la línea nueva, para que nadie copie la forma que pone en rojo el guardián de servidor (AP2)                                                                                                                                                                                                                                          | `src/features/sync/server/processBatch.ts`                                    | 10                  | `bash .agent/verify.sh F-037 --full` en 0                                               |
| 6   | La línea de `AGENTS.md` § «Cosas que muerden» que hoy dice que el orden de entrega no importa: sigue siendo cierto para **lo que se escribe** y deja de serlo para **si un evento correcto se aplica**, dentro de un lote (AP1, I4)                                                                                                                                                                                                             | `AGENTS.md`                                                                   | 10                  | `npm run format:check` y `npm run check:harness`                                        |
| 7   | Extender la unidad del bucle: el handler del arrastrado **no se llamó** (R8), el arrastre solo hacia adelante en el orden recibido (E6, mitad), el resto del lote intacto (E7), `stale` y `skipped` no arrastran (E9, E10), no hay cadena (E13), una categoría arrastra a **todos** sus productos posteriores (E15), la clave reparada deja de arrastrar (E17), y las cuatro `revalidate*` reciben lo mismo que un lote sin el arrastrado (E14) | `src/features/sync/server/processBatch.test.ts`                               | 1, 5, 6, 7          | `bash .agent/verify.sh F-037 --only test`                                               |
| 8   | Los escenarios contra Postgres real, por el `POST` de verdad: qué filas **no** quedan, el `FAILED` del inbox, el reenvío que responde `processed`, y la otra mitad de E6 (la categoría **primero** en el array y el `occurredAt` menor en el producto)                                                                                                                                                                                          | src/features/sync/server/dependencyCascade.db.test.ts (por crear)             | 1, 2, 3, 4, 5, 6, 8 | `npm test -- --project db` y la casilla de cada criterio en `.agent/progress/F-037.md`  |
| 9   | El veredicto: `tests.md` con una casilla por criterio y el comando que lo verifica; `verify.sh pending F-037` vacío                                                                                                                                                                                                                                                                                                                             | `.agent/specs/F-037/tests.md`, `.agent/progress/F-037.md`                     | 9, 10               | `bash .agent/verify.sh F-037 --full` en 0 y `bash .agent/verify.sh pending F-037` vacío |

Reparto: los pasos 1-6 son de `sdd-implementer`; los pasos 7-9, de `sdd-tester`.
Un solo implementador a la vez, y el sensor lo corre quien está trabajando.

## De dónde sale cada paso

| Paso | De dónde sale                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `spec.md` R9 y R20 · `architecture.md` § AD4 · el vocabulario de errores de `docs/sync-contract.md`                                 |
| 2    | `spec.md` R3, R4, R5, R7, R11, R13 · `architecture.md` § AD1 y § AD3                                                                |
| 3    | `architecture.md` § AD6, fila 1 de la tabla                                                                                         |
| 4    | `spec.md` R1, R2, R8, R10, R12 · `architecture.md` § AD2 y § AD5                                                                    |
| 4b   | `impl.md` § Desviaciones, el hueco que encontró el `code-review` del implementador · decisión del humano de 2026-09-07 (abajo, PP5) |
| 5    | `architecture.md` § AP2 (a) · `AGENTS.md` § «Cosas que muerden», la ficha del guardián de servidor                                  |
| 6    | `spec.md` I4 · `architecture.md` § AP1 (a)                                                                                          |
| 7    | `architecture.md` § AD6, fila 2                                                                                                     |
| 8    | `architecture.md` § AD6, fila 3 y sus «reglas para el andamio» · `spec.md` C1-C8, I2, I3                                            |
| 9    | `.agent/README.md` § «Al completar un feature»                                                                                      |

Ningún paso sale de mi cabeza: si alguno no te cuadra, el sitio donde discutirlo
es el documento del que sale, no este plan.

## Qué queda fuera

1. **Reparar lo ya aplicado mal.** Una categoría que llega en otro lote no va a
   buscar los productos que se quedaron sin ella. La cascada evita aplicar mal;
   no repara. Está en el contrato con esas palabras.
2. **Arrastrar entre lotes distintos.** La memoria del arrastre nace y muere
   dentro de una llamada. Un `CATEGORY` que falló ayer no arrastra nada hoy.
3. **Arrastrar hacia atrás.** Un evento ya aplicado no se deshace porque otro
   posterior falle.
4. **`CURRENCY → PRODUCT`.** No es una dependencia de este lado: un producto
   guarda el código de moneda como texto plano, sin clave ajena y sin consulta.
   Un producto en una moneda que nadie declaró se publica bien.
5. **Mover la versión de `docs/sync-contract.md`.** Criterio 9.
6. **Cambiar el orden de aplicación de `recordBatch`** (SP1, ver abajo).
7. **Tocar el cable ni la lógica interna de los handlers.** Ni un campo nuevo, ni
   una validación nueva; las guardas anti-rancias, el corte de `CUP` y la
   resolución de categoría siguen exactamente como están. Lo que cambia es
   **quién llega** a ellos.
8. **El `console.error` gemelo de `src/app/api/internal/sync/catalog/route.ts`.**
   Está fuera del archivo que este feature toca; se arregla con un `/fix` aparte
   (AP2 (c)).

## Riesgos y plan B

- **Sin migración, sin cambio de esquema, sin cambio de contrato.** Nada que
  revertir en la base y nada que coordinar con cuadrecaja: la regla ya está
  publicada en la v11 y su lado emisor ya la contempla.
- **Ninguno de los dos comandos prohibidos** de `AGENTS.md` entra en juego.
- **El riesgo real es un falso positivo:** arrastrar un evento que se habría
  aplicado bien. Se notaría como productos que dejan de aparecer tras un lote con
  un fallo. Lo acotan tres cosas: la cascada solo se dispara cuando algo **ya**
  falló, la clave se compara byte a byte (nada de coincidencias por parecido), y
  una clave reparada dentro del mismo lote deja de arrastrar (SP3).
- **Marcha atrás:** revertir el commit. El módulo nuevo no tiene lectores fuera
  del bucle, la constante no la usa nadie más, y ninguna fila de la base cambia
  de forma — un evento arrastrado queda `FAILED` en `SyncEvent`, que es
  exactamente lo que ya queda hoy cuando un handler lanza.
- **Riesgo de proceso, no de producto:** el `*.db.test.ts` escribe en `Currency`,
  que es una tabla **global sin `businessId`**, así que su código de moneda tiene
  que ser propio y borrarse en el `afterAll`. Es la lección que dejó F-035. Está
  en el paso 8 y el arquitecto ya dejó elegido un código libre.

## Coste

Dos ciclos de agente: `sdd-implementer` (pasos 1-6) y `sdd-tester` (pasos 7-9).
Se toca un archivo que ya funciona y que está en el camino de **todos** los lotes
del sync (`processBatch.ts`, nueve líneas nuevas), más dos archivos nuevos y una
constante. Lo que protege contra la regresión es que sus doce casos de unidad
actuales tienen que seguir verdes sin tocarlos (E18), y eso es un paso explícito.
Dar marcha atrás a mitad es revertir el commit: no hay estado intermedio en la
base ni nada que el POS haya visto.

## Preguntas antes de aprobar

**Las cuatro están respondidas** (el humano, 2026-09-07). Cada una lleva su
respuesta al pie, y todas coinciden con la recomendación: **el plan no cambia de
forma respecto a lo que se le enseñó**, los nueve pasos siguen siendo los mismos
y ninguno se cae.

**PP1 (= SP2) — ¿se arrastra un `PRODUCT` cuya operación es `DELETE`, o que
viene con `publishToStore: false`?**
Ese camino **no lee la categoría**, así que arrastrarlo no evita ningún dato a
medias: lo que hace es **retrasar una entrega la desaparición de un producto de
la vitrina**, que es dejar visible algo que el comerciante quiso quitar.
(a) arrastrar por clave, sin mirar la operación — es el literal del contrato, que
no distingue; (b) excluir esos dos casos, que cuesta una condición en una función
pura. **Recomendación: (a)**, porque el contrato es vinculante; si prefieres (b),
cambia una línea y un caso de prueba.

> **Respondido: (a)**, arrastrar por clave sin mirar la operación.
> El literal del contrato, sin ramas nuevas. Queda como R19 de la spec.

**PP2 (= SP3) — ¿una clave reparada dentro del mismo lote deja de arrastrar?**
Si una categoría falla y más adelante, en el mismo lote, entra bien otro evento
de esa misma categoría, la fila **existe** cuando se aplique el producto que
viene detrás. (a) la clave se limpia y ese producto se aplica; (b) el conjunto es
de solo crecer: más simple de explicar, y falla productos que se habrían
aplicado bien. **Recomendación: (a)** — es la lectura precisa de «los posteriores
que dependían **de él**», y fallar de más es justo lo que este feature intenta
no hacer.

> **Respondido: (a)**, la clave se limpia cuando un evento posterior de la
> misma entidad y clave termina no-fallido. Queda como R13 de la spec, y E17 es
> su escenario.

**PP3 (= SP1) — ¿arregla este feature el orden de `recordBatch`?**
Ese orden decide quién es «posterior», y hoy se calcula comparando **cadenas**;
si el POS enviara una fecha con desfase horario en vez de `Z`, el orden no sería
cronológico. Todos los ejemplos del contrato usan `Z` y no se ha visto otra cosa
nunca. (a) no tocarlo y dejarlo documentado; (b) arreglarlo aquí, una línea que
cambia el orden de aplicación de **todas** las entidades y merecería su propia
no-regresión; (c) un feature aparte, que lo escribes tú. **Recomendación: (a)
ahora, (c) si cuadrecaja llega a emitir desfases** — meterlo aquí mezcla dos
cambios en un feature que ya cambia cuándo un evento correcto falla.

> **Respondido: (a)**, no se toca `recordBatch` y la limitación queda
> documentada (I1 de la spec, R17). Si cuadrecaja llega a emitir desfases
> horarios, es un feature aparte que escribe el humano.

**PP4 (= AP1 y AP2) — los dos arreglos adyacentes, que son de una línea cada
uno.** El primero: `AGENTS.md` dice hoy que «el orden de entrega no importa», y a
partir de aquí importa **dentro** de un lote — un agente que lea solo esa frase
diseñará mal el próximo handler (paso 6). El segundo: `processBatch.ts` tiene un
`console.error` preexistente a nueve líneas de donde va la línea nueva, y esa
forma pone en rojo las etapas que levantan la app por «el servidor se cayó»
aunque todo haya respondido bien (paso 5). **Recomendación: los dos, en el mismo
commit**; si prefieres alcance estricto, se quitan los pasos 5 y 6 y el segundo
se va a un `/fix`.

> **Respondido: los dos**, en el mismo commit. Los pasos 5 y 6 del plan se
> quedan. El `console.error` gemelo de
> `src/app/api/internal/sync/catalog/route.ts` sigue fuera, para un `/fix`
> aparte.

**PP5 — ¿un `CATEGORY` con `operation: DELETE` limpia la clave?** (Surgió al
implementar, no antes: `handleCategory` responde `processed` **sin escribir
nada** cuando un `DELETE` no encuentra la categoría. En un mismo lote —una
categoría que falla, su `DELETE` detrás, y un producto de esa categoría al
final— la R13 firmada limpiaba una clave cuya fila sigue sin existir, y el
producto se aplicaba sin categoría: el fallo que este feature existe para
cerrar.)

> **Respondido: sí, deja de limpiar, y solo para `CATEGORY`.** Un `DELETE`
> nunca prueba que la fila exista. `CURRENCY` sigue limpiando porque
> `handleCurrency` ignora la operación y siempre hace `upsert`, así que ahí la
> fila sí existe. Es el paso 4b, y **R13 de `spec.md` queda con esta
> excepción**.

Resuelto por mí, para que no te ocupe una pregunta: el diagnóstico del arrastre
es **una línea de `console.warn` por evento arrastrado** con su `eventId`, y no
una agregada por lote — solo se dispara cuando algo ya falló, y el `eventId` es
lo que hay que cruzar con el POS (AP3).

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-037 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-07T18:25:13Z — aprobado por el humano: «Aprobado, adelante. PP1 (a) arrastrar por clave sin mirar la operacion; PP2 (a) la clave reparada se limpia; PP3 (a) no se toca recordBatch, se documenta; PP4 los dos arreglos adyacentes (la linea de AGENTS.md y el console.error de processBatch.ts) en el mismo commit.»

- 2026-09-07T18:52:05Z — aprobado por el humano: «Si, y solo para CATEGORY: un CATEGORY con operation DELETE deja de limpiar la clave, y CURRENCY sigue limpiando porque su handler ignora la operacion y siempre hace upsert. El resto del plan, igual que lo aprobe antes.»
