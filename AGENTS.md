# queandabuscando — guía de trabajo

Tiendas online para los negocios que ya usan **Cuadre de Caja** (POS + inventario).
Cada local publicado vive en `dominio/[slug]`. A futuro, un marketplace.

Este es el **único** documento de convenciones. `CLAUDE.md` apunta aquí.
El backlog y el protocolo de progreso están en [`.agent/`](.agent/README.md).

---

## Cómo se trabaja

Desarrollo dirigido por especificación: un orquestador reparte a cinco agentes
especialistas —especificación, arquitectura, diseño, implementación y pruebas—
que se coordinan por los archivos de `.agent/`. El humano abre con `/sdd F-NNN`.

Quién es quién y dónde escribe cada uno: [`.agent/README.md`](.agent/README.md).

---

## Stack

Versiones **reales**, no rangos. Actualiza esta tabla cuando cambien.

| Pieza      | Versión | Nota                                            |
| ---------- | ------- | ----------------------------------------------- |
| Next.js    | 16.3.2  | App Router. cuadrecaja usa 15.2.6               |
| React      | 19.2.8  |                                                 |
| TypeScript | 5.9.3   | `strict: true` — cuadrecaja lo tiene en `false` |
| Node       | 24.13.1 | `.nvmrc` = `v24`. cuadrecaja usa v20            |
| Prisma     | 7.9.1   | Driver adapter obligatorio. cuadrecaja usa 6.x  |
| Postgres   | 14+     | Supabase. Extensiones: `unaccent`, `pg_trgm`    |
| Tailwind   | 4       | Sin librería de componentes                     |
| Vitest     | 4.1.11  | Dos proyectos: `server` (node) y `ui` (jsdom)   |
| Zod        | 4.4.3   |                                                 |

## Comandos

```bash
bash .agent/init.sh    # comprobar el entorno — hazlo primero
bash .agent/verify.sh  # el sensor: typecheck·lint·format·test, y qué hacer si falla
npm run dev            # servidor de desarrollo
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --write
npm run format:check   # prettier --check — es lo que valida el CI
npm test               # vitest run
npm run test:coverage
npm run db:migrate     # prisma migrate dev
npm run seed           # datos de desarrollo (idempotente)
npm run build
npm run check:theme    # los tokens de tema resuelven a var() (tras build)
npm run check:bundle   # presupuesto de JS de cliente (tras build)
```

`verify.sh` se para en lo primero que falla y busca ese fallo en
`.agent/playbook/` antes de que te pongas a depurar. Después de cada cambio se
ejecuta él, no los comandos sueltos. Sin banderas corre
typecheck·lint·format·test; con `--full` añade prisma·build·theme·bundle, que es
todo lo que comprueba el CI salvo `prisma migrate deploy` y el `seed` doble —
esos dos necesitan Postgres y solo se ven allí. El ciclo completo —captura del
error, reintento, cuándo dejar de insistir— está en
[`.agent/README.md`](.agent/README.md) § «Cuando algo falla».

### Comandos prohibidos

- `prisma migrate reset` — destruye datos.
- `prisma db push` — desincroniza el schema de las migraciones versionadas.

Si una migración parece necesitar cualquiera de los dos, **pregunta**.

---

## Arquitectura

| Capa                                        | Responsabilidad                                   |
| ------------------------------------------- | ------------------------------------------------- |
| `src/app/`                                  | Rutea y compone. Nada de lógica de negocio        |
| `src/features/*/server/`                    | **Lo único que toca Prisma**                      |
| `src/features/*/`                           | Lógica y componentes de un dominio                |
| `src/components/ui/`                        | Primitivos sin conocimiento del dominio           |
| `src/components/store/`                     | Componentes de la tienda pública                  |
| `src/lib/`                                  | Lógica pura y reutilizable. Sin Prisma, sin React |
| `src/schemas/`, `src/features/*/schemas.ts` | Zod                                               |
| `src/generated/prisma/`                     | Generado. No editar, no lintar                    |

ESLint impone la regla de que `components/` y `app/**/*.tsx` no importen Prisma.

### Prohibiciones

- **Prisma en componentes.** Pasa por `features/*/server/`.
- **`"use client"` sin estado ni eventos.** Y **nunca** en algo que renderice
  catálogo: el objetivo es que la tienda se lea sin esperar el JavaScript.
- **`any`.** Es error de ESLint.
- **Magic strings y números.** A `src/constants/` o a un enum.
- **Duplicar interfaces** entre la capa de datos y la vista.
- **Leer cookies de sesión a mano.** Solo `lib/auth/adminSession.ts` y, en
  cuanto F-012 lo cree, `lib/auth/customerSession.ts`.

---

## Cosas que muerden

Lo de esta sección se lee **antes** de fallar. Lo que ya nos hizo fallar alguna
vez, con su arreglo, está fichado en [`.agent/playbook/`](.agent/playbook/README.md)
y lo saca el sensor solo: `bash .agent/sdd.sh playbook` los lista. Una ficha que
muerde en dos features distintos sube aquí.

**El pooler de Supabase corre en modo transacción.** Ninguna query puede usar el
cliente global dentro de un `$transaction`: hace deadlock contra la conexión
del pool. Batchea en un solo round-trip. Es la misma restricción que arrastra
cuadrecaja y está documentada en su código.

**El `matcher` de `src/proxy.ts` no debe tocar `/[slug]`.** El proxy (antes
`middleware`) corre en cada petición, incluidas las que el CDN serviría de
caché. Hacer match sobre la tienda anula la estrategia ISR completa. Es el error
más fácil de cometer en este repo.

**`export const revalidate` tiene que ser un literal.** Next analiza los
segment config exports estáticamente; una constante importada rompe el build con
un mensaje que no dice cuál es el archivo.

**Los tests de servidor corren en el proyecto `node`, no en jsdom.** jsdom
instala su propio `Uint8Array` y librerías como `jose` fallan el `instanceof`.
`*.test.ts` → node; `*.test.tsx` → jsdom. Es automático por extensión.

**Todo lo que el sync escribe es idempotente y va guardado contra escrituras
rancias** (`sourceUpdatedAt`). Gracias a eso el orden de entrega no importa. Si
agregas un handler, mantén ambas propiedades o el reintento corrompe datos.

**Un evento fallido NO es un duplicado.** Reportarlo en `ok` haría que el POS
marque su outbox como procesado y la actualización se pierda en silencio. Ver
`features/sync/server/inbox.ts` y sus tests.

---

## Idioma

**Código en inglés**: identificadores, comentarios, mensajes de error, logs,
nombres de rama y de commit. Misma regla que cuadrecaja para código nuevo.

**Español** en la UI y en la documentación (este archivo, ADRs, `progress/`).

El formato de intercambio con cuadrecaja es **inglés** (`entity`, `payload`,
`canonicalProductId`), aunque el schema del POS esté en español. El mapeo está
en `docs/sync-contract.md`.

---

## Git

Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `style:`, `chore:`,
`test:`. Ramas: `feature/descripcion`, `fix/descripcion`.

Un commit por unidad coherente. El hook de pre-commit corre `lint-staged`.

---

## Documentación

- **Decisión estructural nueva** → una ADR en `docs/adr/`.
- **Fallo que volverá a pasar** → una ficha en `.agent/playbook/`,
  con `bash .agent/sdd.sh learn <slug>`.
- **Convención que se repite en review** → una línea aquí.
- **Feature nuevo** → entrada en `.agent/features.json`, **escrita por el humano**.
- **Cambio en el contrato** → versión nueva en `docs/sync-contract.md`,
  coordinada con el equipo de cuadrecaja.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
