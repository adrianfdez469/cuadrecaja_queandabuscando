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

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
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
