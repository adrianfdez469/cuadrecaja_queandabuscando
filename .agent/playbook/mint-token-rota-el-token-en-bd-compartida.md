---
slug: mint-token-rota-el-token-en-bd-compartida
sintoma: un guion o un smoke que funcionaba responde 401 UNAUTHORIZED con un token que nadie cambió, en otro worktree
firma: (UNAUTHORIZED|401).*(token|bearer)
etapa: smoke
visto_en: F-031
creado: 2026-09-01T17:12:57Z
promovido_a_agents: no
arreglo: reacuña el token de ese negocio, npm run mint:token -- seed-negocio-1, y expórtalo como QAB_BEARER_TOKEN; el valor viejo no se recupera
---

## Qué pasa de verdad

`npm run mint:token -- <externalId>` no es una consulta: **rota**. Escribe un
`syncTokenHash` nuevo en `Business` y el valor anterior deja de resolver en el
mismo instante, porque el guard busca por hash exacto y el hash es de un solo
sentido — el token viejo no se puede recuperar de la base.

Lo que convierte eso en un problema de otra sesión es que **Postgres es un
contenedor compartido** entre el checkout principal y todos los worktrees
(`localhost:5433`, `docker-compose.yml`). Cada worktree tiene su `.env`, pero
todos apuntan a la misma fila de `Business`. Así que un agente que acuña un
token en su worktree para probar el pull le deja un `401` a cualquier otra
sesión que tuviera el anterior exportado, sin tocar ni un archivo suyo. El log
del que lo sufre no dice nada de rotación: dice `401`.

No se pierden datos y no hay nada que revertir. Lo que se pierde es el valor,
y el trabajo de la otra sesión hasta que lo reacuñe.

## Cómo se arregla

En la sesión que se quedó fuera:

```bash
npm run mint:token -- seed-negocio-1   # imprime el token en claro, una sola vez
export QAB_BEARER_TOKEN=<lo que imprimió>
```

Y ojo: eso rota otra vez. Si hay dos sesiones probando el sync a la vez contra
la misma base, se van a pisar en bucle. Entonces el arreglo no es reacuñar más
rápido: es que **una sola sesión acuñe y pase el valor**, o que cada una use un
negocio distinto (`seed-negocio-2` existe en `prisma/seed.ts`).

## Cuándo NO es esto

La firma pesca cualquier `401` de las rutas de sync, y hay dos causas mucho más
comunes que esta:

- **`QAB_BEARER_TOKEN` vacío o sin exportar** — es la ficha
  `smoke-sin-token-de-sync`, y su síntoma lo dice explícitamente.
- **Token de otro negocio** — eso responde `403 BUSINESS_MISMATCH`, no `401`
  (`docs/sync-contract.md` § Vocabulario de errores).

Descártalas así: si `SELECT "syncTokenHash" FROM "Business" WHERE
"externalId" = 'seed-negocio-1'` cambió de valor y tú no acuñaste, fue otra
sesión. Si es `NULL`, nadie ha acuñado nunca y no hubo rotación.

## Cómo se evita

Antes de acuñar en un worktree, asumir que la base **no es tuya**: acuñar es
una escritura con efecto fuera de tu copia del repo, igual que una migración.
Si lo único que necesitas es leer el pull, mira primero si ya tienes un token
válido exportado, y avisa cuando rotes. Es el mismo razonamiento de
`docker-compose-container-name-fijo-choca-entre-worktrees` y de
`prisma-migrate-dev-checksum-drift-bd-compartida`: lo que muerde no es el
comando, es que el recurso esté compartido y el comando no lo diga.
