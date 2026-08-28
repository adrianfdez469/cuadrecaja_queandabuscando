---
propuesta: canonico-fusionado-por-ean-sucio
agente: orquestador
actualizado: 2026-08-27T23:59:00Z
estado: propuesta
---

> Origen: pregunta del humano al firmar el plan de F-018 (2026-08-27), y su
> respuesta a P1–P3 el mismo día, que **cambió el planteamiento**: lo que la
> primera versión de este documento llamaba «contaminación» el humano lo lee
> como **categorización**, y esa lectura es mejor. Ver § «El giro».
>
> **No es una fuga de aislamiento y por eso no entró en F-018**: es un problema
> de modelo de datos y de calidad del dato, no de seguridad.

## El hallazgo que ordena todo lo demás: los códigos no llegan

`docs/sync-contract.md:184` mapea el campo del wire así:

| Wire (inglés) | cuadrecaja (español)    |
| ------------- | ----------------------- |
| `barcode`     | `CodigoProducto.codigo` |

El campo del wire es **uno**, singular (`"barcode": "7501031311309"`, § `payload`
de `PRODUCT`). El origen es **`CodigoProducto`, una tabla**: cuadrecaja ya modela
varios códigos por producto y el contrato se queda con uno solo, sin que nada lo
diga y sin que nadie elija cuál.

**Consecuencia:** el escenario entero de esta propuesta hoy es **invisible** para
queandabuscando. No es que se resuelva mal; es que de tres códigos nos llega uno
y los otros dos se pierden en silencio.

Esto convierte una decisión de diseño en una **pérdida de datos que ya está
ocurriendo**, y es lo primero que hay que arreglar aunque no se construya nada
más de este documento.

## El giro

La primera versión de este documento decía: un negocio que usa mal los códigos
de barras **contamina** la ficha canónica compartida. Sigue siendo cierto, pero
es media verdad.

El humano propone la otra mitad: ese negocio **está categorizando**. «Refresco de
Pomo» con tres EAN distintos no es un producto mal introducido, es un **nodo
concentrador** que afirma que esos tres productos son parientes — información que
ningún negocio ordenado aporta, porque el que hace las cosas bien no relaciona
nada con nada.

El cambio de modelo que eso implica:

- **Hoy:** compartir EAN ⇒ _son el mismo producto_. Una sola ficha canónica.
- **Propuesto:** compartir EAN ⇒ _están relacionados_. Fichas distintas, unidas
  por una arista.

## El caso de prueba del humano

Es mejor banco de pruebas que el que traía este documento, y cualquier diseño
tiene que responderlo entero:

| Quién                | Producto                | Códigos          |
| -------------------- | ----------------------- | ---------------- |
| Negocio A            | «Refresco de Pomo»      | cod1, cod2, cod3 |
| Negocio B / Tienda 1 | «Coca cola 1.5 Lt»      | cod1             |
| Negocio B / Tienda 2 | «Sprite 1.5 Lt»         | cod2             |
| Negocio C            | «Refresco Naranja Pomo» | cod3             |

**Comportamiento deseado:** que las cuatro variantes aparezcan al buscar
«Refresco de Pomo», «Coca cola», «Sprite» o «Refresco Naranja». Buscando
exactamente «Coca cola», la primera opción es la Coca-Cola; después aparece
«Refresco de Pomo» porque comparten cod1; y después, como opciones secundarias,
los otros refrescos que comparten un EAN con «Refresco de Pomo».

### Qué hace el código de hoy con ese caso

Suponiendo que de A llegue cod1 (nadie decide cuál):

| Llega                            | Resultado                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A · «Refresco de Pomo» cod1      | Crea el canónico X, nombre «Refresco de Pomo»                                                                                                                       |
| B/T1 · «Coca cola 1.5 Lt» cod1   | `findUnique({ ean: cod1 })` (`src/features/sync/server/handlers/product.ts:172`) encuentra X → **se fusiona**. La ficha del marketplace se llama «Refresco de Pomo» |
| B/T2 · «Sprite 1.5 Lt» cod2      | cod2 nunca llegó de A → canónico nuevo, sin relación con nada                                                                                                       |
| C · «Refresco Naranja Pomo» cod3 | Igual → canónico nuevo, suelto                                                                                                                                      |

Y si el orden de sincronización fuera el inverso, la ficha se llamaría «Coca cola
1.5 Lt» y «Refresco de Pomo» quedaría como alias: **el nombre de la ficha
compartida lo decide una carrera**, no un criterio.

El resultado de hoy es exactamente el **inverso** del deseado: fusiona duro donde
solo habría que relacionar, y no relaciona nada donde habría que enlazar.

## Por qué NO se arregla acotando el canónico por negocio

Es la respuesta intuitiva y es la equivocada. Acotar el canónico por negocio no
corrige nada: **desactiva la fusión**, y con ella el marketplace entero. La
fusión no es el fallo — es el producto (F-015 se construyó sobre ella y F-002 la
verificó: 20 productos del seed dan 17 canónicos).

## Diseño propuesto

### 1. El contrato admite varios códigos

`barcode: string | null` pasa a `barcodes: string[]` (contrato **v4**).

**Esto es lo único urgente de todo el documento.** Hoy es casi gratis: en
cuadrecaja no hay nada desarrollado de esta integración (HD5 de F-018), así que
cambiar la forma del payload no rompe a ningún consumidor vivo. En cuanto haya un
cron en producción deja de serlo. Y sin esa lista **no se puede ni medir** si el
problema existe.

### 2. Un canónico tiene N códigos

Tabla `CanonicalBarcode(canonicalProductId, ean)` con `@@unique([canonicalProductId, ean])`
e índice por `ean`. `CanonicalProduct.ean String? @unique`
(`prisma/schema.prisma:301`) deja de ser la clave de fusión; la migración hace
backfill de lo que ya hay.

### 3. El criterio de fusión, que es la parte difícil

Si compartir EAN deja de implicar «mismo producto», hace falta un discriminador.

**Descartado — comparar los nombres.** Era la primera propuesta de este documento
(similitud por `pg_trgm`). Se descarta al explicársela al humano: es difusa,
exige calibrar un umbral, y produce el error caro. Dos tiendas que venden la
Coca-Cola de verdad con el mismo código pero llamándola «Coca cola 1.5Lt» y
«COCA-COLA 1500ML» acabarían en **dos fichas distintas del mismo producto**, y
comparar precios entre tiendas —lo que el marketplace existe para hacer— dejaría
de funcionar.

**Propuesto — contar los códigos.** Es la señal que el propio humano describió
sin nombrarla, y es estructural en vez de difusa:

- Un producto con **un** código afirma una identidad: «yo soy este».
- Un producto con **varios** códigos agrupa: «estos son parientes». Es el
  concentrador.

> **Un producto con un solo código se fusiona** con quien comparta ese código.
> **Un producto con varios códigos no se fusiona nunca: enlaza.**

Contra el caso de prueba del humano:

| Quién                         | Códigos          | Qué pasa                                                             |
| ----------------------------- | ---------------- | -------------------------------------------------------------------- |
| A · «Refresco de Pomo»        | cod1, cod2, cod3 | Varios → **concentrador**. No fusiona con nadie. Enlaza con los tres |
| B/T1 · «Coca cola 1.5 Lt»     | cod1             | Uno → ficha propia                                                   |
| B/T2 · «Sprite 1.5 Lt»        | cod2             | Uno → ficha propia                                                   |
| C · «Refresco Naranja Pomo»   | cod3             | Uno → ficha propia                                                   |
| _Otra tienda, Coca-Cola real_ | cod1             | Uno → **fusiona con la de B/T1** ✓                                   |

Cuatro fichas y el concentrador enlazado con las otras tres. Buscar «Coca cola»
da la Coca-Cola primero, «Refresco de Pomo» después (comparten cod1), y Sprite y
Naranja al final por el concentrador. **Es exactamente el comportamiento
deseado**, y el error caro desaparece por construcción: dos tiendas con la
Coca-Cola de verdad siempre caen en la misma ficha, se llame como se llame,
porque ninguna de las dos es un concentrador.

**El punto flaco, y es real:** un negocio que pone dos códigos a un producto
legítimo —el envase viejo y el nuevo de la misma Coca-Cola— quedaría marcado como
concentrador y dejaría de fusionar. Se corrige subiendo el corte (concentrador a
partir de **tres** códigos, no de dos), pero **dónde está ese número solo se sabe
viendo datos reales**, y por eso F-024 va primero.

### 4. La búsqueda, en tres anillos

Sobre la consulta de `src/features/marketplace/server/search.ts` (un solo
`$queryRaw` con `ts_rank`):

1. Coincidencia de texto, ordenada por `ts_rank` — lo de hoy, sin cambios.
2. Vecinos **a un salto**: canónicos que comparten un EAN con algo del anillo 1.
3. Vecinos **a dos saltos**, vía el concentrador, penalizados y al final.

## Rendimiento

**La consulta no es el problema.** Si las aristas se **precalculan** al
sincronizar en una tabla `(desde, hasta, saltos, peso)` con índice, buscar añade
un join indexado a la consulta que ya existe. Es lo correcto en este reparto:
buscar se hace mucho, sincronizar poco y por lotes.

**El problema es el abanico, y es estructural.** Un concentrador con _k_ códigos
genera del orden de _k²_ aristas a dos saltos:

| k (códigos del concentrador) | Aristas a dos saltos | Efecto                                                                       |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| 3 (el caso del humano)       | ~9                   | Invisible                                                                    |
| 20                           | ~400                 | Notable, manejable                                                           |
| 200 (un «Varios» mal puesto) | ~40 000              | **Un solo producto contamina toda búsqueda que roce cualquiera de esos 200** |

No degrada en latencia: degrada en **relevancia**, que es peor, porque no se nota
en ninguna métrica y la búsqueda simplemente empieza a devolver todo.

**El freno es un tope de grado**: un canónico con más de N códigos se puede
_mostrar_ como vecino pero deja de **propagar** a dos saltos. Con eso el caso
principal (buscar «Coca cola» y ver también «Refresco de Pomo») sobrevive
siempre, y el secundario (y además Sprite y Naranja) funciona con concentradores
pequeños y se corta en los grandes. **Dónde está N se averigua midiendo.**

Coste de escritura: las aristas se recalculan al sincronizar. El sync es por
lotes de hasta 500 eventos, así que hay que medir que el recálculo no lo alargue
de forma desproporcionada — es el único punto donde este diseño puede volverse
caro en el lado que hoy está tranquilo.

## Tamaño

**Más grande que F-015**, y toca cuatro features ya verificados:

| Qué                                                            | A quién afecta                               |
| -------------------------------------------------------------- | -------------------------------------------- |
| Contrato v4 con `barcodes[]`                                   | El contrato, y cuadrecaja tiene que enviarlo |
| Migración: `CanonicalBarcode` + backfill + quitar el `@unique` | F-002                                        |
| Reescribir la resolución de identidad canónica                 | F-005 (verificado)                           |
| Calcular aristas al sincronizar                                | F-005, F-006                                 |
| Ampliar la búsqueda a tres anillos                             | F-015 (verificado)                           |
| El número «20 productos → 17 canónicos» deja de ser cierto     | F-002, criterio verificado                   |

## Lo que hay que medir antes de decidir nada

Los dos números, en este orden, y ninguno se puede obtener hoy:

1. **Cuántos productos de cuadrecaja tienen más de un `CodigoProducto`.** Se
   pregunta al POS; no hace falta código. Si la respuesta es «casi ninguno», todo
   este documento se archiva.
2. **Cuántos canónicos acaban con alias de más de un negocio con nombres que no
   se parecen.** Solo medible **después** del punto 1 del diseño (los códigos
   tienen que llegar).

Sin esos dos números, el umbral de similitud y el tope de grado serían
inventados.

## Preguntas al humano

- **P1 — ¿Es un problema real de tu mercado?** **Respondida (2026-08-27):** no se
  ha dado todavía, pero el humano conoce al menos un negocio que asocia varios
  códigos reales («Coca cola 1.5 Lt», «Sprite 1.5 Lt») a un producto genérico
  («Refresco de Pomo»). Es decir: **el patrón existe en el mercado real**, no es
  un caso de laboratorio.
- **P2 — Cuando dos negocios chocan, ¿quién gana?** **Reformulada tras el giro:**
  ya no es «quién gana» sino «cuándo se fusiona y cuándo se enlaza», y el error
  que se prefiere cometer (§ Diseño propuesto, punto 3). **Sigue abierta.**
- **P3 — ¿Hay que avisar al negocio que lo hace mal?** **Respondida por
  implicación:** no lo hace mal. Es un concentrador y aporta información que
  nadie más aporta. No hay a quién avisar.
- **P4 — ¿Se cambia `barcode` por `barcodes[]` en el contrato ya**, aunque no se
  construya el resto? **Respondida (2026-08-27): sí.** Palabras del humano: «Si
  seria bueno recibir barcode[] en vez de un solo barcode». Entra al backlog como
  **F-024**, deliberadamente pequeño: solo el contrato y el almacenamiento, sin
  concentradores ni aristas ni búsqueda, y **sin cambiar el comportamiento de
  fusión** que F-002 y F-015 verificaron. Su criterio 6 es el que produce el
  número que decide si el resto de este documento se construye o se archiva.
- **P5 `[nueva]` — ¿Cuál es el tope de grado**, o mejor dicho, se acepta que haya
  uno? Sin tope, un solo producto mal configurado degrada la búsqueda de todos.
  Con tope, el segundo salto no siempre funciona. No hay tercera opción.

## Estado

**F-024 ya está en el backlog** y cubre el punto 1 del diseño (el contrato) y el
punto 2 (la tabla de códigos). Lo que queda en este documento sin decidir es el
punto 3 (el corte de concentrador) y el punto 4 (la búsqueda en tres anillos), y
las dos decisiones esperan al número que F-024 va a medir. **No se empieza el
grafo antes de tener ese número**: sería fijar un umbral por intuición.

## Fuera

- El reuso de canónico **huérfano** sin acotar por tienda. Era otra rama,
  era un bug claro, y **se arregló en F-018** (acotado por `storeId`).
- La búsqueda **dentro** de una tienda: es F-021, otro feature del backlog.
