---
slug: dos-smokes-un-puerto
sintoma: "EADDRINUSE en el log del servidor de una etapa smoke, con 0 aserciones fallidas justo encima"
firma: EADDRINUSE
etapa: smoke
visto_en: F-020
creado: 2026-09-01T14:11:15Z
promovido_a_agents: no
arreglo: dale su propio puerto a cada etapa smoke del mismo trabajo de CI — SMOKE_PORT=31NN bash .agent/verify.sh F-NNN --only smoke
---

## Qué pasa de verdad

Dos etapas `smoke` en el **mismo trabajo** de `.github/workflows/ci.yml` pelean
por el puerto 3100. `puerto_libre()` (`.agent/verify.sh`) pregunta con `lsof`, y
`lsof` **no ve un servidor que está cerrando pero todavía no ha soltado el
socket**, así que la comprobación pasa y el `next dev` de la segunda etapa muere
con `EADDRINUSE`.

Lo caro no es que falle: es **cómo** falla. El `curl` de espera responde —lo
contesta el servidor de la etapa ANTERIOR, que sigue vivo—, el guion de runtime
corre contra él y asierta `0 aserciones fallidas`. Solo el guardián de errores de
servidor pesca el `⨯ Failed to start server` y pone la etapa roja. Un verde
construido así estaría verificando la aplicación de otro feature, que es
exactamente lo que AGENTS.md § Cosas que muerden llama «comprueba de cuál es».

## Cómo se arregla

Puerto propio para cada etapa smoke del mismo trabajo. `verify.sh:23` ya lee la
variable:

```yaml
- name: … smoke (F-NNN …)
  run: SMOKE_PORT=3102 bash .agent/verify.sh F-NNN --only smoke
```

No hace falta tocar el guion del feature: `correr_smoke` exporta
`SMOKE_BASE_URL` con el puerto que toque, y los guiones lo respetan
(`.agent/specs/F-020/smoke.sh:26`, `.agent/specs/F-028/smoke.sh:18`).

## Cuándo NO es esto

`EADDRINUSE` pesca cualquier puerto ocupado. Si es **en local**, casi nunca es
esto: es otro `next dev` en el mismo puerto y muy posiblemente **de otro
worktree** —y entonces lo grave es que podrías estar verificando contra otra
copia del repositorio—. Comprueba el directorio del proceso
(`ps -p <pid> -o command=`) antes de aplicar nada de aquí. Y si el mensaje viene
del puerto 3101, es la etapa `visual`, no dos smokes.

## Cómo se evita

Al añadir una etapa smoke a un trabajo de CI que **ya tiene una**, dale su puerto
en la misma línea que la añades. Añadirla y confiar en `puerto_libre()` no basta:
esa función protege del caso en que el puerto está ocupado y quieto, no del que
se está liberando mientras la pregunta se hace.
