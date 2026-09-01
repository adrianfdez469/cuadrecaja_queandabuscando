---
slug: guardian-de-servidor-grep-tras-rm
sintoma: "una etapa smoke o visual sale VERDE aunque el log del servidor, impreso ahí mismo bajo «--- salida del servidor (runtime feedback) ---», contenga un ⨯ TypeError o un Unhandled"
firma: (SMOKE|VISUAL) FAIL el servidor registró un error
etapa: smoke
visto_en: F-029, F-012
creado: 2026-09-01T03:18:57Z
promovido_a_agents: no
arreglo: "en el sensor, el guardián de errores de servidor solo cuenta si su grep se ejecuta ANTES del rm del log y si su patrón casa con la línea real; comprueba las dos cosas en correr_smoke y en correr_visual antes de creerte un verde"
---

## Qué pasa de verdad

Dos fallos independientes, y cada uno basta para que el guardián «un error en el
servidor cuenta como fallo aunque las peticiones respondan» no proteja nada.

**1. El orden.** `correr_smoke` y `correr_visual` volcaban el log al informe,
hacían `rm -f "$srvlog"` y **después** el `grep` sobre ese mismo archivo. El
`grep` salía 2 («No such file»), el `2>/dev/null` se tragaba el aviso, el `&&`
no se cumplía y `code=1` no se asignaba jamás. Nació así: `git log -S` da
`87d8ce2` (que lo introduce ya con el `rm` delante) y `b7dafab` (que lo copia
literal a la ruta visual). **No funcionó un solo día** sobre 13 `smoke.sh` y 10
`visual.mjs`.

**2. El patrón.** Era `(⨯|Unhandled|Error:)`, y fallaba por los dos lados sobre
un error real de Supabase Auth:

```
Error [AuthApiError]: Refresh token is not valid   ← la que importa: NO casa
  __isAuthError: true,                             ← relleno del volcado: SÍ casa
```

`Error:` es subcadena, así que pescaba nombres de campo acabados en `Error`
mientras la cabecera del error se le escapaba. Un guardián que dispara por la
línea equivocada da una firma equivocada, y con eso el corte a los tres intentos
(`ESTANCADO`) deja de cortar.

**3. El corolario.** Cuando `correr_visual` reutiliza el `next dev` del worktree
crea el log con `mktemp` y `pid=""`: nadie escribe en él. Un archivo vacío no
casa con nada, así que ahí el verde tampoco significaba «el servidor calló», sino
«nadie miró».

## Cómo se arregla

En `.agent/verify.sh`:

1. El `grep` va **antes** del `rm -f "$srvlog"`, en `correr_smoke` y en
   `correr_visual`.
2. El patrón vive en una sola constante, `SERVIDOR_ERROR_RE`, y exige que la
   línea **empiece** por algo acabado en `Error` con mayúscula inicial:
   `(⨯|Unhandled|^[[:space:]]*([A-Z][A-Za-z]*)?Error([^A-Za-z0-9_]|$))`. ERE
   POSIX puro — nada de `\b` ni `\w`, ver `playbook-firma-grep-bsd-no-gnu`.
3. El guardián imprime **siempre** una línea con el prefijo de fallo de su etapa
   (`SMOKE FAIL` / `VISUAL FAIL`) y la línea culpable. Sin ella,
   `extract_signature` no encuentra prefijo y la firma cambia entre corridas.
4. Con el servidor reutilizado (`pid` vacío) el guardián **no se aplica** y el
   informe lo dice con todas las letras, en vez de imprimir una sección vacía.

## Cuándo NO es esto

Si la etapa sale **roja** y el log del servidor está limpio, no es esto: es una
aserción del propio `smoke.sh`, y la firma llevará su prefijo `SMOKE FAIL`.

Y si sale roja por una línea de una **librería** que registra por su cuenta una
condición esperada, tampoco: el guardián está haciendo su trabajo, pero el
error no es de este repo. El caso conocido es
`Error [AuthApiError]: Refresh token is not valid` tras un logout, que registra
`@supabase/auth-js` —no código nuestro— porque el emulador local
(`supabase/auth:v2.196.0`) responde `error_code: validation_failed` y auth-js
solo baja a `console.warn` los códigos `refresh_token_not_found`,
`refresh_token_already_used` y `session_expired`
(`GoTrueClient.js:3663-3676`). Comprobado con una petición directa al emulador.

## Cómo se evita

Un guardián que nunca dispara es indistinguible de uno que no existe, y este
llevaba desde el primer commit sin disparar. Cuando se escriba el próximo,
**se prueba haciéndolo fallar a propósito** —meterle un `TypeError` real al
servidor y comprobar que la etapa se pone roja— antes de darlo por bueno. La
prueba de que estaba muerto no vino de leer el código: vino de ver un
`⨯ TypeError` en un informe verde.
