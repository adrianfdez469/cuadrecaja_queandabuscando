---
feature: F-007
agente: sdd-designer
actualizado: 2026-08-26T11:50:00Z
estado: no aplica
---

## No aplica

F-007 no tiene interfaz. Sus dos endpoints son máquina a máquina: los llama
cuadrecaja con un `Authorization: Bearer`, y ninguna sesión de navegador los
alcanza (`src/app/api/internal/_lib/guard.ts`). No hay pantalla, ni breakpoint,
ni token de tema, ni un byte de JavaScript de cliente que diseñar — el bundle no
se mueve con este feature.

La única pantalla que aparece en el camino del pedido es
`/[slug]/pedido/[code]`, y **es de F-010**: ya está especificada en
`.agent/specs/F-010/design.md` y verificada allí. Lo que F-007 sí garantiza
sobre ella es que el pull **no la rompe**, porque no borra el pedido (spec `R4`);
eso se comprueba ejecutando, no diseñando.

Por eso el orquestador no llamó a `sdd-designer` en este ciclo, y por eso
`bash .agent/verify.sh F-007 --visual` no tiene nada que ejecutar: el arnés de
este feature es `smoke.sh`, no un guion visual.
