---
slug: env-optional-secreto-vacio-rompe-serverenv
sintoma: "/admin (o cualquier ruta que lea getAdminSession()) redirige a /?admin=sesion-requerida con una cookie qab-admin-session firmada y válida — la sesión se ve 'null' sin ningún error visible"
firma: Invalid server environment —
etapa: smoke
visto_en: F-012
creado: 2026-08-29T16:16:29Z
promovido_a_agents: no
arreglo: node scripts/dev-secrets.mjs --write
---

## Qué pasa de verdad

`src/lib/env.ts` declara `CRON_SECRET: z.string().min(16).optional()`. `.optional()`
en Zod permite que la clave esté **ausente** (`undefined`); no permite que valga
`""`. `.env.example` (y por tanto todo `.env` copiado de él) trae
`CRON_SECRET=""`, `SSO_JWT_SECRET=""` y `ADMIN_SESSION_SECRET=""` — presentes,
con valor, solo que vacío — así que `serverSchema.safeParse(process.env)`
falla por **cualquiera** de los tres (SSO_JWT_SECRET y ADMIN_SESSION_SECRET ni
siquiera son `.optional()`, así que fallan siempre con `.env.example` tal cual).

`serverEnv()` lanza `Invalid server environment — …` en cuanto **cualquier**
ruta la llama por primera vez, y esa función vive detrás de un montón de
`try { … } catch { return null; }` — el más relevante,
`getAdminSession()` en `src/lib/auth/adminSession.ts`: `secret()` llama a
`serverEnv()`, `jwtVerify(token, secret())` está dentro del `try`, así que el
`throw` de `serverEnv()` se traga en silencio y la función devuelve `null`,
exactamente como si la cookie no existiera o estuviera caducada. El síntoma de
fuera (`/admin` redirige) es indistinguible de "no hay sesión", así que probar
con una cookie perfectamente válida y ver el mismo redirect de siempre no
descarta nada por sí solo.

## Cómo se arregla

Genera las tres claves con el comando dedicado (F-029), que escribe en `.env`
valores aleatorios que cumplen el mínimo de cada una y conserva por omisión
cualquiera que ya lo cumpla (nunca pisa un `SSO_JWT_SECRET` acordado con
cuadrecaja salvo que se pida `--force`):

```
node scripts/dev-secrets.mjs --write
```

Sin banderas imprime los tres valores sin escribir nada; `--check` responde
si las tres son utilizables sin escribir nada tampoco (lo usa
`bash .agent/init.sh` en su bloque `== Secretos de desarrollo ==`, y los dos
guiones de humo de F-029 y F-012 como guardián). Ya no hace falta rellenar
`.env` a mano.

Para confirmar la causa exacta antes de tocar nada: monta una ruta temporal
que llame a `serverEnv()` y lea el mensaje del error (o revisa el log del
`next dev`, que sí imprime el `Error: Invalid server environment — …`
completo con el campo culpable, aunque la ruta que lo disparó lo trague).

## Cuándo NO es esto

Si el log NO menciona `Invalid server environment`, el problema es otro
(cookie realmente ausente, secreto realmente distinto del que firmó el
token, JWT expirado). Este síntoma es específico de un `.env` recién copiado
de `.env.example` sin rellenar, que es exactamente el estado por defecto de
un worktree nuevo — `bash .agent/init.sh` avisa de las claves sin valor, pero
solo como advertencia, no como bloqueo.

## Cómo se evita

Cualquier clave `.optional()` en `serverSchema` que en la práctica llegue como
`""` desde `.env.example` se comporta como **obligatoria con un mensaje que no
llega a nadie**, porque casi todo lo que la usa está detrás de un `catch` que
convierte "falta configuración" en "no hay sesión". Si una clave es
verdaderamente opcional, `.env.example` no debería fijarla en `""` — mejor
comentada o ausente, para que `.optional()` haga lo que promete. Si es
obligatoria (como `SSO_JWT_SECRET`/`ADMIN_SESSION_SECRET`), un entorno de
desarrollo que necesite ejercitar admin/SSO tiene que rellenarla antes de
probar, no solo antes de tener el problema delante.
