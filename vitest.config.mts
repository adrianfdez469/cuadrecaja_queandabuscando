import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Three projects.
 *
 * Server code (crypto, jose, Prisma helpers) must run in the node environment:
 * jsdom installs its own Uint8Array, and `instanceof` checks inside libraries
 * like jose then fail against values created in the test realm.
 *
 * Component tests get jsdom. Splitting by extension keeps this automatic —
 * .test.tsx is a component test, .test.ts is not.
 *
 * `db` (F-015, architecture.md § Pruebas contra Postgres real) is the third:
 * `*.db.test.ts` files that talk to a real Postgres, never mocked. Still
 * node — the extension is what stays deducible at a glance
 * (AGENTS.md § Cosas que muerden, ficha `test-en-entorno-equivocado`) — but
 * with its own setup file, so `server`'s tests never pay for it and
 * `src/lib/prisma.test.ts`'s `DATABASE_URL` stub is never shadowed by a
 * global `dotenv/config`. `server` excludes `*.db.test.ts` so nothing runs
 * twice.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/features/**"],
      exclude: ["src/generated/**", "**/*.test.*"],
    },
    projects: [
      {
        extends: true,
        resolve: { tsconfigPaths: true },
        test: {
          name: "server",
          environment: "node",
          globals: true,
          include: ["src/**/*.test.ts"],
          exclude: ["src/generated/**", "src/**/*.db.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: "ui",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.tsx"],
          exclude: ["src/generated/**"],
          // The per-test ceiling, not Testing Library's own (that one is
          // `asyncUtilTimeout` in vitest.setup.ts). With a bigger suite and a
          // cold transform cache, a test with three sequential findBy*/waitFor
          // calls can add up past the 5s DEFAULT test timeout even though each
          // individual wait resolves in well under its own 5s ceiling — see
          // the playbook ficha `testing-library-timeout-1s-bajo-carga`.
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        resolve: { tsconfigPaths: true },
        test: {
          name: "db",
          environment: "node",
          globals: true,
          setupFiles: ["./vitest.setup.db.ts"],
          include: ["src/**/*.db.test.ts"],
          exclude: ["src/generated/**"],
          // Real network round trips against Postgres; the default 5s
          // ceiling is tuned for mocked server tests, not this project.
          testTimeout: 20_000,
          // Techo declarado (F-015 architecture.md § Escalabilidad): 6
          // `*.db.test.ts` files max in parallel, each its own PrismaClient
          // (max: 5) — ≤30 connections against a max_connections of 100
          // locally and in CI's postgres:16. F-019's expiry.db.test.ts is
          // the 7th file, past that ceiling, so this project now runs its
          // files serially instead of raising `max` on every client.
          fileParallelism: false,
        },
      },
    ],
  },
});
