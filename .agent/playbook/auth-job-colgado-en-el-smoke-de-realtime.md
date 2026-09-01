---
slug: auth-job-colgado-en-el-smoke-de-realtime
sintoma: "el trabajo `auth` del CI se queda en el paso «Realtime bell smoke» durante decenas de minutos sin fallar ni terminar, mientras `verify` y `visual` ya salieron en verde"
firma: —
etapa: smoke
visto_en: F-032 (PR #31, al esperar el CI)
creado: 2026-09-01T23:10:00Z
promovido_a_agents: no
arreglo: cancela la corrida y relanza SOLO lo que falló con `gh run cancel <id>` y `gh run rerun <id> --failed` — un trabajo cancelado cuenta como fallido, así que `--failed` no repite `verify` ni `visual`, que ya estaban en verde. En F-032 el reintento pasó en 3m9s, el tiempo normal.
---

## Qué pasa de verdad

El paso es `bash .agent/verify.sh F-020 --only smoke`, que ejecuta
`scripts/realtime-bell.mjs`. **Dos de sus nueve modos paran y vuelven a
levantar el contenedor `realtime`** (criterios 3 y 11, ver el cabecero de
`.agent/specs/F-020/smoke.sh`). Ahí es donde se queda: no falla, no sigue,
se cuelga esperando algo que ya no va a llegar.

Lo que lo hace caro no es el cuelgue, es **dónde aparece**: al final, cuando
todo lo demás está verde, y sin mensaje de error. La tentación es asumir que
tu cambio lo rompió y ponerte a leer tu propio diff.

## Cómo se descarta que sea tuyo, antes de reintentar

Tres comprobaciones, todas baratas, y en F-032 las tres dijeron que no:

1. **Compara el tiempo con una corrida verde anterior.** `auth` tarda ~3
   minutos. Si el tuyo lleva 30, no es lentitud.

   ```bash
   gh api repos/<owner>/<repo>/actions/runs/<run-verde>/jobs \
     --jq '.jobs[]|select(.name=="auth")|{started_at,completed_at,conclusion}'
   ```

2. **Mira en qué paso está**, que los logs no se pueden leer hasta que el
   trabajo termina:

   ```bash
   gh api repos/<owner>/<repo>/actions/jobs/<job-id> \
     --jq '.steps[]|select(.status!="completed")|.name+" :: "+.status'
   ```

   Si los pasos anteriores —migraciones a base vacía, `npm run seed`, smoke de
   Auth— están en `success`, el entorno se montó bien.

3. **Pregúntate si tu cambio tiene camino hasta ahí.** El smoke de F-020 no
   toca el sync, ni el catálogo, ni el panel: solo `realtime-bell.mjs`. Y si
   `verify` pasó, la aplicación compila y el `next dev` del smoke puede
   levantar.

## Cuándo NO es esto

- **Si `verify` también falló**, empieza por ahí: el cuelgue puede ser
  consecuencia de que la aplicación no arranca.
- **Si se cuelga dos veces seguidas en el mismo paso**, deja de ser flake.
  Eso es `ESTANCADO` y la decisión ya no es de quien entrega el PR.
- **Si el smoke FALLA en vez de colgarse**, con `SMOKE FAIL`, es otra cosa:
  mira `realtime-bell-close-clock-skew`, que sí tiene firma propia.
