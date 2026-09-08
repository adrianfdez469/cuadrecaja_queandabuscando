---
slug: vi-spyon-constructor-necesita-function-keyword
sintoma: "un `new` sobre un constructor espiado con `vi.spyOn` devuelve un objeto sin sus métodos, o Vitest se queja de que el mock no usa 'function' o 'class'"
firma: (primary\.format is not a function|did not use 'function' or 'class' in its implementation)
etapa: test
visto_en: F-039
creado: 2026-09-08T12:38:22Z
promovido_a_agents: no
arreglo: escribe el `mockImplementation` con `function (...args) { ... }`, nunca con una arrow function, cuando el espiado se invoca con `new`
---

## Qué pasa de verdad

`vi.spyOn(Intl, "NumberFormat")` reemplaza la propiedad por un mock, pero
**no** llama a la implementación original por su cuenta cuando el código bajo
prueba hace `new Intl.NumberFormat(...)`: el objeto resultante no tiene
`.format` (ni ningún método del original), porque el mock, sin
`mockImplementation`, no reconstruye nada. Y si le das un
`mockImplementation` escrito como arrow function
(`(...args) => Reflect.construct(Original, args)`), Vitest tira un error
distinto y más claro: «The NumberFormat mock did not use 'function' or
'class' in its implementation, see https://vitest.dev/api/vi#vi-spyon for
examples» — una arrow function no tiene su propio `[[Construct]]`, así que
no es invocable con `new`, y Vitest lo detecta.

## Cómo se arregla

Captura el original ANTES de espiar, y dale al mock una implementación con
`function`, no una arrow function, que reconstruya de verdad con
`Reflect.construct`:

```ts
const Original = Intl.NumberFormat;
const spy = vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
  ...args: ConstructorParameters<typeof Intl.NumberFormat>
) {
  return Reflect.construct(Original, args) as Intl.NumberFormat;
});
```

Así el mock sigue siendo invocable con `new` (comportamiento real, no un
stub vacío) y `spy` sigue contando las llamadas para el aserto de
`toHaveBeenCalledTimes`.

## Cuándo NO es esto

Si lo que espías es un método normal (no un constructor invocado con `new`
en el código bajo prueba), el `vi.spyOn` por defecto ya llama a través del
original sin nada de esto: la trampa es específica de constructores nativos
(`Intl.NumberFormat`, `Date`, etc.) usados con `new`.

## Cómo se evita

Cuando la prueba necesita contar construcciones de una clase nativa
(`vi.spyOn(Intl, "NumberFormat")` es el caso de F-039 AD6, para el memo de
`src/lib/money.ts`), escribe el `mockImplementation` con `function` desde el
principio y verifica con un experimento aislado antes de confiar en el
conteo — no asumas que el spy llama a través por defecto.
