import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { CUSTOMER_COOKIE } from "@/constants/account";
import { isSupabaseAuthConfigured } from "./config";

/**
 * Supabase client for server components and route handlers.
 * Shopper auth only — admins use the SSO session in lib/auth/adminSession.
 *
 * `createServerClient` THROWS if the URL or the key is empty (verified in
 * `@supabase/ssr`'s source). Criterio 6 exercises exactly that environment,
 * so this returns `null` instead of letting the constructor throw —
 * everything downstream (`lib/auth/customerSession.ts`) treats `null` the
 * same as "no session possible".
 *
 * `cookieOptions.name` fixes the session cookie's name to `CUSTOMER_COOKIE`
 * (architecture.md § DA3): the library's default, `sb-<ref>-auth-token`,
 * depends on `NEXT_PUBLIC_SUPABASE_URL`, which is `""` in that same
 * environment and would leave nothing stable to compare against
 * `ADMIN_COOKIE` for R21.
 */
export async function createSupabaseServerClient() {
  if (!isSupabaseAuthConfigured()) return null;

  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookieOptions: { name: CUSTOMER_COOKIE },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Middleware refreshes the session instead; ignoring is correct here.
        }
      },
    },
  });
}
