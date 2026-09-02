---
slug: console-error-dispara-guardian-servidor
sintoma: "SMOKE FAIL/VISUAL FAIL/PROBE FAIL el servidor registró un error, aunque las peticiones respondieran" con una línea de log de APLICACIÓN debajo, no una traza
firma: registró un error, aunque las peticiones respondieran
etapa: smoke | visual | probe
visto_en: —
creado: 2026-09-02T01:16:51Z
promovido_a_agents: sí
arreglo: cambia `console.error` por `console.warn` (o reformatea para que la línea no EMPIECE por algo acabado en `Error`) — el prefijo de dominio (`[orders]`, `[catalog]`, `[realtime]`…) va primero, nunca la palabra `Error`
---

## Qué pasa de verdad

`guardian_servidor()` de `.agent/verify.sh` lee la salida cruda de `next dev`
tras cada etapa que levanta la app (`smoke`, `visual`, `probe`) y la compara
contra `SERVIDOR_ERROR_RE` — «la línea EMPIEZA por algo acabado en `Error`
(`TypeError`, `AuthApiError`, `Error` a secas) o contiene `⨯`/`Unhandled`».
Node imprime así sus excepciones sin capturar, así que el patrón es correcto
para detectarlas — pero `console.error("[scope] algo", …)` con un objeto
detrás **no** es una excepción, y si ese objeto se imprime en una posición o
con un salto de línea que hace que la línea normalizada empiece por una
palabra que termina en `Error` (o si se usa la palabra `console.error` para
loguear un desenlace válido y alguien reordena el mensaje algún día), la
etapa entera se pone roja **aunque todas las peticiones hayan respondido
200/201**. El mensaje que ves («el servidor registró un error, aunque las
peticiones respondieran») no dice qué línea de código lo causó ni si el
servidor de verdad se cayó: solo dice que algo casó con el patrón.

## Cómo se arregla

1. Abre el log de la etapa (`.agent/runs/<F-NNN>/<intento>-<etapa>.log`) y mira
   la línea exacta que `guardian_servidor` imprimió debajo del mensaje.
2. Si esa línea es tuya (un `console.error` o un log de instrumentación, no
   una traza de Node) — cámbiala a `console.warn`, con el mismo prefijo de
   dominio entre corchetes al principio (`[orders]`, `[catalog]`,
   `[realtime]`…). Es lo que ya hacen
   `src/features/orders/server/status.ts`,
   `src/features/orders/server/bell.ts`,
   `src/features/catalog/server/searchLog.ts` y
   `src/features/account/server/orderLinkObserver.ts` (F-030): **nunca**
   `console.error` para un desenlace esperado, y el prefijo de dominio va
   siempre primero, nunca la palabra `Error`.
3. Vuelve a correr la etapa. Si la línea sigue apareciendo tras el cambio, el
   servidor sí está fallando de verdad — sigue el punto siguiente.

## Cuándo NO es esto

Si la línea que `guardian_servidor` señala es una traza real de Node
(`Error: …` con un `at ` debajo, o `⨯` seguido de una excepción de Next), el
servidor **sí** se cayó y esto no es un falso positivo: arregla la causa real,
no el logging. La firma de esta ficha solo reconoce el MENSAJE del guardián,
no distingue por sí sola cuál de los dos casos es — mira siempre la línea que
imprime justo debajo.

## Cómo se evita

La convención está escrita en `AGENTS.md` § «Cosas que muerden»: toda
instrumentación de servidor usa `console.warn` con un prefijo `[scope]`
literal al principio de la línea, nunca `console.error` — precisamente porque
el guardián de `.agent/verify.sh` vigila la salida cruda de `next dev` y no
puede distinguir "aviso de dominio" de "excepción sin capturar" más que por
esa forma. Se promueve directo (`promovido_a_agents: sí`) sin esperar a que
`visto_en` acumule dos features: la convención ya la seguían cuatro piezas
del repo antes de esta ficha (`status.ts`, `bell.ts`, `searchLog.ts`,
`orderLinkObserver.ts` de F-030) y F-030 la deja escrita explícitamente
porque su propia etapa `probe` es la primera en depender de que nadie la
rompa (riesgo 4 de `.agent/specs/F-030/architecture.md`).
