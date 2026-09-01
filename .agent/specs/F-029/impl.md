---
feature: F-029
agente: sdd-implementer
actualizado: 2026-09-01T02:03:56Z
estado: listo
---

## Qué se construyó

| Archivo                                                         | Qué hace                                                                                                                                                                                                                                                                                        | Criterio que cubre |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `scripts/dev-secrets.mjs`                                       | Generador de `SSO_JWT_SECRET`, `ADMIN_SESSION_SECRET` y `CRON_SECRET`. Cuatro modos: sin banderas imprime, `--write` escribe conservando lo que ya cumple el mínimo, `--write --force` regenera con avisos de E11, `--check` responde 0/1 sin escribir. Solo importa `node:crypto` y `node:fs`. | 1, 2, 6, 9         |
| `src/lib/env.ts`                                                | `let warned = false` hermano de `cached`; `console.warn` con prefijo `[env]` antes del `throw`, una vez por instancia de módulo. Firma y `ServerEnv` intactos.                                                                                                                                  | 3, 4               |
| `src/lib/env.test.ts`                                           | Seis casos: E6 (las tres vacías nombran a las tres), E7 (parsea con valores válidos y no avisa), E7b (`CRON_SECRET` ausente parsea), R7 (una sola línea por instancia, dos llamadas y reimport), R8 (texto plano, sin `⨯`/`Unhandled`/`Error:`), drift (mínimos 32/32/16 fijados).              | 3                  |
| `src/lib/auth/adminSession.test.ts`                             | Dos casos sin tocar `adminSession.ts`: con las tres vacías y cookie presente, `getAdminSession()` devuelve `null` y quedó la línea; con secretos válidos y cookie ilegible, `null` y silencio.                                                                                                  | 4                  |
| `.env.example`                                                  | Las tres claves dejan de ser `=""` y pasan a un bloque de comentarios que nombra las tres, dice para qué sirve cada una, cuál es obligatoria en producción y el comando para generarlas en local. `QAB_BEARER_TOKEN` y las claves de Storage intactas.                                          | 5                  |
| `.agent/init.sh`                                                | Bloque `== Secretos de desarrollo ==` (después de `== Variables de entorno ==`, antes de `== Base de datos ==`) que delega el predicado en `--check`, con tres ramas (`ok`/`warn` con nombres/`warn` "no se pudo comprobar"), nunca `bad`. Lista de exclusión de la línea 53 intacta.           | 6                  |
| `.agent/playbook/env-optional-secreto-vacio-rompe-serverenv.md` | `§ Cómo se arregla` deja de mandar rellenar `.env` a mano y nombra `node scripts/dev-secrets.mjs --write`; el frontmatter `arreglo:` también.                                                                                                                                                   | —                  |

## Desviaciones

Ninguna de fondo respecto a `plan.md`/`architecture.md`. Dos matices de redacción,
no de conducta:

- En `.env.example` el arquitecto describía "un bloque de comentarios" sin fijar
  el texto exacto por línea; escribí un párrafo por clave dentro de un único
  comentario largo (con el comando `node scripts/dev-secrets.mjs --write` una
  sola vez arriba, no repetido tres veces) porque las tres comparten el mismo
  comando y separar el aviso en tres bloques idénticos era ruido. Verificado con
  el mismo `grep` que exige el criterio 5.
- El playbook original también recomendaba, en `§ Cómo se arregla`, "montar una
  ruta temporal que llame a `serverEnv()`" para diagnosticar antes de arreglar;
  lo dejé intacto porque sigue siendo cierto (el `console.warn` que este ciclo
  añade es justamente lo que ese paso describe leer del log de `next dev`), y
  el paso 9 solo pedía que `§ Cómo se arregla` deje de mandar rellenar `.env` a
  mano — no reescribir el resto de la ficha.

No se tocó nada de lo prohibido: `src/lib/auth/adminSession.ts` sin diff
(verificado con `git diff --stat`), no se arregló I1 ni I2, `SSO_JWT_SECRET`
sigue en `serverSchema` y sus consumidores reales siguen leyendo
`process.env`, `CRON_SECRET` sigue `.optional()`, `QAB_BEARER_TOKEN` intacto,
la lista de exclusión de `.agent/init.sh:53` intacta, y no se tocó
`.github/workflows/ci.yml`, `docs/despliegue.md` ni `src/lib/supabase/storage.ts`.

## Comandos ejecutados

- `node scripts/dev-secrets.mjs` (sin banderas): imprime las tres líneas,
  `stat -f %m .env` idéntico antes y después.
- `node scripts/dev-secrets.mjs --check` sobre `.env` con las tres vacías:
  imprime `SSO_JWT_SECRET`, `ADMIN_SESSION_SECRET`, `CRON_SECRET`, sale 1.
- `node scripts/dev-secrets.mjs --force` (sin `--write`): sale 2 con el
  mensaje de uso.
- `node scripts/dev-secrets.mjs --write` sobre un directorio sin `.env`: sale
  1 pidiendo copiar `.env.example`.
- `node scripts/dev-secrets.mjs --write` sobre `.env` con las tres vacías:
  las escribe, `git status --porcelain` queda vacío, `git check-ignore .env`
  sale 0.
- Repetido `--write`: `Wrote 0 secret(s), kept 3…`, `grep -c` de cada clave en
  `.env` da 1.
- `--write --force`: regenera las tres, `SSO_JWT_SECRET` cambia de valor, avisa
  de E11 (SSO rompe contra cuadrecaja, sesiones de admin invalidadas).
- `npx vitest run src/lib/env.test.ts` → 1 archivo, 6 tests, PASA.
- `npx vitest run src/lib/auth/adminSession.test.ts` → 1 archivo, 2 tests,
  PASA. `git diff --stat src/lib/auth/adminSession.ts` → vacío.
- `npm run typecheck` → 0.
- `grep -nE '^(SSO_JWT_SECRET|ADMIN_SESSION_SECRET|CRON_SECRET)=' .env.example`
  → sin coincidencias (exit 1 de grep, ninguna línea). `grep -c` de los tres
  nombres dentro de comentarios → 2, 1, 1 respectivamente.
- `bash .agent/init.sh` sobre una copia de `.env` con las tres claves vacías →
  `ENTORNO LISTO`, código 0, bloque `== Secretos de desarrollo ==` en `warn`
  nombrando `node scripts/dev-secrets.mjs --write`.
- `bash .agent/init.sh` con las tres generadas → el bloque pasa a
  `ok "secretos de desarrollo con valor válido…"`.
- `bash .agent/verify.sh F-029` (rápido) → `typecheck·lint·format·test` en 0.
- `bash .agent/verify.sh F-029 --full` → **0** en las nueve etapas
  (`harness·typecheck·lint·format·test·prisma·build·theme·bundle`), criterio 8
  cumplido.

## Deuda dejada

Ninguna de mis seis pasos. Quedan explícitamente para el probador (pasos 6-8
del plan, que no me tocan):

- `.agent/specs/F-029/smoke.sh` (por crear): guardián `--check`, testigo
  `sha256` de `.env`, 307 sin cookie, acuñar y canjear SSO, 200 con cookie,
  307 con cookie basura, limpieza de `SsoTokenUse`.
- `.agent/specs/F-012/smoke.sh`: mover el guardián `--check` al principio del
  guion (junto al `cd`, aborto duro con `SMOKE FAIL`) y quitar el
  `ADMIN_SECRET_LEN`/`wc -c` de la línea 405 para que las cuatro aserciones del
  criterio 5 queden incondicionales.
- Ejecutar `bash .agent/verify.sh F-029 --smoke` y
  `bash .agent/verify.sh F-012 --smoke` de verdad, con Postgres, seed y
  emuladores arriba.
- La mitad negativa del criterio 9 (`ADMIN_SESSION_SECRET` vacío → línea
  `SMOKE FAIL`), que según AP2 del arquitecto y PP3 del plan se ejecuta con
  copia de `.env` + `trap` de restauración, verificando al final con
  `node scripts/dev-secrets.mjs --check` en 0.

## Qué necesita quien pruebe

- Entorno: `bash .agent/init.sh` debe llegar a `ENTORNO LISTO`; Postgres arriba
  y `npm run seed` aplicado (usa `seed-negocio-1`, `seed-usuario-1`,
  `seed-tienda-1`), como ya exige `architecture.md § Pruebas → smoke de F-029`.
- El generador ya existe y su contrato de `--check` es estable: un nombre por
  línea de cada clave ausente o corta (`SSO_JWT_SECRET`, `ADMIN_SESSION_SECRET`,
  `CRON_SECRET`, en ese orden), código 0 si las tres son utilizables, 1 si no.
  Es el mismo contrato que consumen `.agent/init.sh`, y que consumirán los dos
  guiones de humo.
- `scripts/mint-sso-token.mjs` sigue igual (no lo tocué); acuña el token del
  negocio del seed y respeta `QAB_BASE_URL`.
- Frágil a vigilar: si el probador cambia la redacción de la línea de
  `console.warn` en `src/lib/env.ts`, el test R8 de `src/lib/env.test.ts` la
  vuelve a comprobar contra `⨯`/`Unhandled`/`Error:` — no hace falta releer
  `.agent/verify.sh` para confiar en que sigue segura, pero si el test cambia
  de forma, sí.
- El `.env` de este worktree quedó con las tres claves generadas por mí durante
  la verificación manual (valores nuevos, no los que traía antes de empezar).
  Es gitignored y no afecta a nada versionado; el probador puede regenerarlas
  o dejarlas, `--write` las conserva si ya cumplen el mínimo.

## Preguntas al humano

Ninguna. Las tres preguntas del plan (PP1, PP2, PP3) ya estaban resueltas antes
de firmar, y AP1/AP2 del arquitecto llevaban recomendación aceptada por el
plan; ninguna de las dos toca los seis pasos que me correspondían. No tengo
`IP1` que devolver.
