import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Migration and introspection commands connect through DIRECT_URL (port 5432).
 * The pooler (DATABASE_URL, port 6543, transaction mode) cannot run DDL.
 * The runtime client uses DATABASE_URL — see src/lib/prisma.ts.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
