---
slug: prisma-migrate-diff-nunca-da-cero-por-indices-no-declarados
sintoma: "`prisma migrate diff --exit-code` informa diferencias y devuelve 2 en un repo donde nadie cambió el schema, y el criterio que lo usaba para probar que un cambio es aditivo parece fallar"
firma: —
etapa: prisma
visto_en: F-032 (sdd-tester, verificando el criterio 10)
creado: 2026-09-01T22:30:00Z
promovido_a_agents: no
arreglo: no es tu cambio y no lo arregles ahí — comprueba lo que el criterio quiere de verdad con `git diff main --stat -- prisma/migrations` (vacío = ninguna migración nueva) y `git diff main -- prisma/schema.prisma` (que el cambio sea el que dices). Y ojo con los flags: Prisma 7 retiró `--from-schema-datasource` y `--to-schema-datamodel`; hoy son `--from-config-datasource --to-schema`.
---

## Qué pasa de verdad

`prisma/schema.prisma` **no representa cinco índices GIN/parciales que sí
existen en la base**. Es un desajuste conocido y anterior a cualquier feature en
curso: `AGENTS.md` ya lo ficha, y la ficha
`prisma-migrate-dev-borra-indices-gin-no-declarados` explica la otra mitad del
problema — que `prisma migrate dev` propone **borrarlos**.

La consecuencia para quien verifica: `prisma migrate diff --exit-code` compara
schema contra base, encuentra esos cinco índices de más, y devuelve `2`. Con o
sin tu cambio. Siempre.

Eso convierte el comando en un **sensor que no distingue** entre «tu cambio
introdujo deriva» y «este repo tiene deriva desde antes». Un criterio de
aceptación que lo use como prueba de que un cambio es aditivo no está probando
nada: falla igual cuando el cambio es perfecto.

## Por qué muerde justo al verificar

Aparece en el peor momento: cuando todo lo demás está en verde y solo queda
firmar que el cambio no toca la estructura de la base. El instinto es creer al
comando y ponerse a buscar qué rompiste. En F-032 el único cambio del schema era
**un comentario `///`**, que no genera SQL — y el comando informaba diferencias
igual.

## Cómo se comprueba lo que el criterio quería

Dos comandos que sí distinguen tu cambio del ruido de fondo:

```bash
git diff main --stat -- prisma/migrations   # vacío = no añadiste ninguna migración
git diff main -- prisma/schema.prisma       # que lo que cambió sea lo que dices
```

Si lo que necesitas es afirmar que **ninguna fila cambió de comportamiento**,
eso no lo dice ningún diff de estructura: se cuenta por columna antes y después,
contra la base, con `psql`.

## Cuándo NO es esto

- **Si `git diff` de `prisma/migrations` NO está vacío**, entonces sí añadiste
  una migración y el comando te está avisando de algo real.
- **Si el error menciona tablas o columnas** en vez de índices, no es este
  desajuste: mira qué schema estás comparando contra qué base.

## Cómo se evita

No escribas `prisma migrate diff --exit-code` como criterio de aceptación en una
spec de este repo mientras el desajuste siga ahí. La alternativa de arriba es
más específica y no miente. Arreglar el desajuste de raíz —declarar los cinco
índices en el schema— es trabajo sobre migraciones que el humano decidió no
hacer al cerrar F-032; hasta entonces, esta ficha es lo que hay.
