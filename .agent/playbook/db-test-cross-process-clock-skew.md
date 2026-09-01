---
slug: db-test-cross-process-clock-skew
sintoma: un *.db.test.ts falla comparando un timestamp de Postgres contra Date.now() del proceso de test, con una diferencia de pocos milisegundos
firma: expected [0-9]{10,} to be greater than or equal to [0-9]{10,}
etapa: test
visto_en: —
creado: 2026-09-01T05:42:37Z
promovido_a_agents: no
arreglo: compara contra un valor leído de la MISMA base (otra fila, o el valor anterior de la misma columna), nunca contra Date.now() del proceso de Node
---

## Qué pasa de verdad

Postgres corre en su propio contenedor con su propio reloj de sistema. `now()`
de esa Postgres y `Date.now()` del proceso de `vitest` no son la misma fuente
de tiempo: pueden diferir por decenas de milisegundos, en cualquier
dirección. Un test que hace `const before = Date.now()`, escribe una fila con
SQL usando `now()`, y luego afirma `row.timestamp.getTime() >=
before` es una carrera contra ese desfase — pasa la mayoría de las veces y
falla de forma intermitente, con un margen de unos pocos milisegundos, sin
ningún cambio en el código bajo prueba.

## Cómo se arregla

No compares un timestamp de Postgres contra `Date.now()` del proceso de test.
Compara contra otro timestamp que también salga de Postgres: lee el valor
ANTES del cambio (`SELECT ... antes`), aplica la operación, lee el valor
DESPUÉS, y afirma `after > before` — las dos lecturas comparten el mismo
reloj, así que el desfase entre máquinas deja de importar.

## Cuándo NO es esto

Si la diferencia es de segundos u órdenes de magnitud mayores (no
milisegundos), no es desfase de reloj: es un bug real en la lógica de fechas
bajo prueba. Revisa la condición `WHERE` de la sentencia SQL antes de asumir
que es esto.

## Cómo se evita

En cualquier `*.db.test.ts` que afirme algo sobre un timestamp que escribió
Postgres (`now()`, `default(now())`, una columna `DateTime`), lee el "antes"
y el "después" con la misma conexión a la misma base — nunca mezcles
`Date.now()` de Node con un valor que vino de una sentencia SQL.
