import { describe, expect, it } from "vitest";
import { ADMIN_COOKIE } from "./adminSession";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_HINT_COOKIE,
  getCustomerUser,
  sendEmailOtp,
} from "./customerSession";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * R21: the client cookie's name and `ADMIN_COOKIE` are distinct, and neither
 * is a prefix of the other — cerrar una sesión no puede borrar cookies de la
 * otra. Compares all THREE constants (session, hint, admin), as
 * architecture.md § DA3 requires.
 */
describe("cookie names (R21, criterio 5)", () => {
  const names = [CUSTOMER_COOKIE, CUSTOMER_HINT_COOKIE, ADMIN_COOKIE];

  it("are pairwise distinct", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("no name is a prefix of another", () => {
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        expect(b.startsWith(a)).toBe(false);
      }
    }
  });

  it("CUSTOMER_COOKIE is qab-shopper-auth and CUSTOMER_HINT_COOKIE is qab-shopper-hint", () => {
    expect(CUSTOMER_COOKIE).toBe("qab-shopper-auth");
    expect(CUSTOMER_HINT_COOKIE).toBe("qab-shopper-hint");
  });
});

/**
 * Criterio 6: without `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` (this
 * process's default — nothing in this test file sets them), nobody
 * constructs a Supabase client, and everything downstream sees "no
 * session" instead of throwing.
 */
describe("sin Supabase Auth configurado (criterio 6, E26)", () => {
  it("createSupabaseServerClient() returns null instead of throwing", async () => {
    await expect(createSupabaseServerClient()).resolves.toBeNull();
  });

  it("getCustomerUser() resolves to null", async () => {
    await expect(getCustomerUser()).resolves.toBeNull();
  });

  it("sendEmailOtp() resolves to not_configured", async () => {
    await expect(sendEmailOtp("ana@x.cu")).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
  });
});
