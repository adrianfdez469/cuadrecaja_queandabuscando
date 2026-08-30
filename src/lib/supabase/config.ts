/**
 * "Is Supabase Auth configured?" — read directly from `process.env`, without
 * `zod` and without importing `@/lib/env` (architecture.md § Componentes,
 * § Criterio 6 — con Supabase Auth sin configurar).
 *
 * `@/lib/env` is fine on the server, but its `publicEnv` object is built by
 * parsing the FULL server schema with Zod at module scope in some import
 * paths, and Zod is ~13 KB gzip we do not want anywhere near a client
 * island (`AccountBadge`, the account store). This module has to be safely
 * importable from `"use client"` code, so it reads `process.env.NEXT_PUBLIC_*`
 * directly — Next inlines those at build time in both places.
 */
export function isSupabaseAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
