import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/** Supabase client for client components (sign-in buttons, account pages). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
