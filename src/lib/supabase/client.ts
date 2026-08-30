import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { CUSTOMER_COOKIE } from "@/constants/account";
import { isSupabaseAuthConfigured } from "./config";

/**
 * Supabase client for client components. F-012 does NOT call this — Auth is
 * called from the server (architecture.md § DA5) so that zero bytes of
 * `@supabase/*` reach the browser. Kept in sync anyway (same cookie name,
 * same "not configured" guard) so whoever imports it next does not write a
 * session under a different name than `lib/auth/customerSession.ts` expects.
 */
export function createSupabaseBrowserClient() {
  if (!isSupabaseAuthConfigured()) return null;
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookieOptions: { name: CUSTOMER_COOKIE },
  });
}
