import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Two projects, because the two kinds of test need different globals.
 *
 * Server code (crypto, jose, Prisma helpers) must run in the node environment:
 * jsdom installs its own Uint8Array, and `instanceof` checks inside libraries
 * like jose then fail against values created in the test realm.
 *
 * Component tests get jsdom. Splitting by extension keeps this automatic —
 * .test.tsx is a component test, .test.ts is not.
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
          exclude: ["src/generated/**"],
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
        },
      },
    ],
  },
});
