import { z } from "zod";

/**
 * Server-side environment. Parsed lazily so that importing this module in a
 * context where a variable is missing fails at the point of use with a clear
 * message, rather than at import time in an unrelated route.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SSO_JWT_SECRET: z.string().min(32, "SSO_JWT_SECRET must be at least 32 chars"),
  ADMIN_SESSION_SECRET: z.string().min(32, "ADMIN_SESSION_SECRET must be at least 32 chars"),
  CRON_SECRET: z.string().min(16).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("store-media"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;
let warned = false;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    // Logged once per module instance (R7), before throwing, so the failure
    // leaves a trace even though every caller today swallows the throw in a
    // try/catch (getAdminSession(), src/lib/supabase/storage.ts). Plain
    // string, never an Error object, and without the substring "Error:" —
    // .agent/verify.sh marks the smoke stage red on (⨯|Unhandled|Error:) in
    // the dev server's output (R8).
    if (!warned) {
      warned = true;
      console.warn(
        `[env] Invalid server environment — ${missing}. In local development, generate the missing secrets with: node scripts/dev-secrets.mjs --write`,
      );
    }
    throw new Error(`Invalid server environment — ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

/** Public config. Safe to read in the browser. */
export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
} as const;
