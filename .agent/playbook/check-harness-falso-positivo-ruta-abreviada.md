---
slug: check-harness-falso-positivo-ruta-abreviada
sintoma: "check:harness dice que un archivo no existe, y el archivo real sí existe: la ruta estaba abreviada (tres puntos y el nombre, o una carpeta sin el prefijo src/)"
firma: `[A-Za-z0-9._/-]+\.(ts|tsx)` does not exist
etapa: harness
visto_en: F-010, F-007, F-011, F-017, PR #7, F-018, F-023
creado: 2026-08-26T05:00:00Z
actualizado: 2026-08-26T12:45:00Z
promovido_a_agents: sí
arreglo: si el archivo existe, escribe la ruta completa en el documento que abrevió — y si ese documento no es tuyo, escala a quien pueda editarlo; no lo des por bueno
---

## Qué pasa de verdad

`scripts/check-harness.mjs` § 2 busca rutas entre backticks en **todo** `.md`
bajo `.agent/` (recursivo, incluida esta misma carpeta de fichas) y comprueba
que existan probando tres candidatos: la ruta tal cual, la ruta relativa al
directorio del documento, y la ruta con `src/` antepuesto. Cuando quien
escribió la spec abrevia el nombre de archivo dentro de una tabla ancha (la
columna anterior ya da el directorio, así que la columna del archivo solo
pone tres puntos y el nombre), o menciona una ruta de carpeta en prosa sin el
prefijo `src/` completo, ninguno de los tres candidatos resuelve — y el
archivo, que existe de verdad, sale listado como referencia muerta.

En F-010, `architecture.md` § Componentes abrevia así los cuatro archivos de
las islas del carrito en su tabla (la columna "Capa" de esa misma fila ya da
el directorio completo), y su § Escalabilidad menciona la ruta del módulo de
consultas del catálogo en prosa sin el `src/` completo, mientras unas líneas
antes en el mismo documento la ruta completa de ese mismo archivo sí resuelve.

**Ojo al escribir esta ficha (o cualquiera) para el mismo síntoma**: los
ejemplos de rutas abreviadas van SIN backticks aquí a propósito. Envueltos en
backticks, el propio check los vuelve a pescar como referencias muertas —
`scripts/check-harness.mjs` no distingue una ficha que _describe_ el
problema de un documento que lo _comete_.

## Cómo se arregla

1. Verifica con `ls` o `find` que el archivo existe de verdad en la ruta
   completa que la columna "Capa" (o el contexto) implica.
2. Si existe: es un falso positivo de formato, no un archivo que falte.
3. **Arréglalo de verdad: escribe la ruta completa** en el documento que
   cometió la abreviatura, reemplazando el tres-puntos-y-nombre o la ruta sin
   `src/` por la ruta real desde la raíz del repo. Es lo que el propio check
   pide en su mensaje — «Fix the prose, not this check» — y dejarlo sin
   arreglar deja `bash .agent/verify.sh <ID> --full` en `ESTANCADO`: nadie
   declara que algo funciona sin que el sensor haya salido `0`, sea el
   motivo real o de formato.
4. **Si ese documento no es tuyo** (`spec.md`, `architecture.md`,
   `design.md` y `plan.md` no son del implementador — la guía de
   `sdd-implementer`), no lo edites tú, pero tampoco lo des por bueno:
   **escala al orquestador**, que es quien puede pedírselo a quien sea dueño
   del documento (al arquitecto, si es `architecture.md`). Anótalo también
   en `impl.md` § Desviaciones mientras se resuelve.
5. Si el archivo citado con ruta abreviada **de verdad no existe**, entonces
   sí es la referencia muerta que el check pretende cazar — trátalo como tal.

## Por qué la firma se ensanchó en F-007

La firma original solo pescaba el patrón tres-puntos-y-nombre. En F-007 el mismo
fallo llegó por la otra mitad del síntoma —una carpeta sin el prefijo `src/`,
escrita dentro de una tabla ancha— y el sensor **no imprimió esta ficha**, con lo
que la lección estaba escrita y nadie la vio. Costó un ciclo entero volver a
diagnosticar lo que ya estaba aquí.

La firma nueva pesca cualquier `does not exist` sobre un `.ts`/`.tsx`, que es lo
correcto: el arreglo de esta ficha cubre **las dos** ramas —si el archivo existe,
escribe la ruta completa; si de verdad no existe, es la referencia muerta que el
check pretende cazar— así que no hay caso en el que salga de más y estorbe. Una
ficha que solo reconoce la mitad de su propio síntoma vale la mitad.

## Cuándo NO es esto

Si el archivo citado no existe en ninguna ruta razonable (ni con `src/`, ni
relativo al documento, ni tal cual), es una referencia muerta real. La firma
de esta ficha solo pesca el patrón de tres-puntos-y-nombre-de-componente; una
ruta de carpeta abreviada sin ese patrón no la dispara, así que conviene leer
el mensaje completo del check igual.

## Cómo se evita

Quien escribe `spec.md`/`architecture.md`/`design.md` debería escribir la
ruta completa desde la raíz del repo la primera vez que cita un archivo entre
backticks, incluso dentro de una tabla ancha — es lo único que
`scripts/check-harness.mjs` sabe resolver hoy. Arreglar el script para que
entienda abreviaturas es otra opción, pero no se hizo aquí porque tocarlo no
era parte del alcance de F-010.
