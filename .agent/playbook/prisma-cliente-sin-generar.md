---
slug: prisma-cliente-sin-generar
sintoma: "no se encuentra el cliente de Prisma, o dice que no se inicializó"
firma: did not initialize yet|Cannot find module.*generated/prisma|@prisma/client.*generate
etapa: typecheck
visto_en: —
creado: 2026-08-25T19:11:02Z
promovido_a_agents: no
arreglo: npm run db:generate
---

## Qué pasa de verdad

`src/generated/prisma/` está en `.gitignore` y lo escribe `prisma generate`
en el `postinstall`. Tras cambiar `schema.prisma`, cambiar de rama o instalar
con la caché fría, el cliente puede no existir o no incluir el modelo nuevo.
El typecheck se queja de un módulo o de un campo, no de Prisma.

## Cómo se arregla

```bash
npm run db:generate
```

## Cuándo NO es esto

Si el campo que falta lo acabas de añadir al schema y `db:generate` no lo trae,
el problema es que la migración no está aplicada: `npm run db:migrate`. Nunca
`prisma db push` ni `prisma migrate reset` — `AGENTS.md` los prohíbe.

## Cómo se evita

`bash .agent/init.sh` lo comprueba al empezar la sesión. Si no terminó en
`ENTORNO LISTO`, no empieces a programar: arregla eso primero.
