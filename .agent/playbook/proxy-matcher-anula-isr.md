---
slug: proxy-matcher-anula-isr
sintoma: "la tienda deja de servirse desde caché y cada visita pega contra el servidor"
firma: —
etapa: review
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: sí
arreglo: saca `/[slug]` del `matcher` de `src/proxy.ts`
---

## Qué pasa de verdad

El proxy corre en **cada** petición que casa con su `matcher`, incluidas las
que el CDN habría servido de caché. Hacer match sobre `/[slug]` anula la
estrategia ISR completa de la tienda. `AGENTS.md` lo llama «el error más fácil
de cometer en este repo».

## Cómo se arregla

El `matcher` enumera lo que necesita sesión —admin, API privada— y nada más.
La tienda pública no pasa por el proxy.

## Cuándo NO es esto

No tiene firma automática: **ninguna etapa del sensor lo detecta**. Ni el
typecheck, ni los tests, ni el build fallan; la app funciona, solo que lenta y
cara. Se pesca leyendo el diff de `src/proxy.ts`, y por eso esta ficha existe
aunque `verify.sh` nunca la vaya a sugerir sola.

## Cómo se evita

Todo diff que toque `src/proxy.ts` se revisa mirando el `matcher` primero.
