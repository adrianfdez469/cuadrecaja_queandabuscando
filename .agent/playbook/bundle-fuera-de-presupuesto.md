---
slug: bundle-fuera-de-presupuesto
sintoma: "check:bundle falla: el JS de cliente de una página creció por encima del presupuesto"
firma: client bundle grew past its budget|Heaviest page
etapa: bundle
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: no
arreglo: busca el `"use client"` que sobra antes de tocar BUNDLE_BUDGET_KB
---

## Qué pasa de verdad

El presupuesto existe para pescar regresiones, no para clavar un número. La
causa habitual es un componente que ganó un `"use client"` que no necesitaba
—porque hacía falta un `onClick` en una hoja del árbol— y arrastró consigo a
todos sus hijos al bundle.

## Cómo se arregla

Baja el `"use client"` a la hoja más pequeña que de verdad tiene estado o
eventos. `AGENTS.md` lo prohíbe explícitamente en cualquier cosa que renderice
catálogo: la tienda tiene que leerse sin esperar al JavaScript.

## Cuándo NO es esto

Si la página pesada no es una tienda sino el admin, el presupuesto puede estar
mal calibrado. Subir `BUNDLE_BUDGET_KB` es una decisión que se consulta con el
humano, no un arreglo.

## Cómo se evita

`npm run check:bundle` corre solo tras `build`: entra en el sensor con
`--full`, no en el ciclo rápido. Pásalo antes de entregar cualquier cosa que
añada interactividad.
