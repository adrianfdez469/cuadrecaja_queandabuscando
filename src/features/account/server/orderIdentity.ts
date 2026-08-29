import { ORDER_CUSTOMER_LINK_TIMEOUT_MS } from "@/constants/account";
import { getCustomerUser, hasCustomerSessionCookie } from "@/lib/auth/customerSession";
import { findCustomerIdByUserId } from "./customers";

/**
 * Resolves the signed-in shopper's `Customer.id` for a pending order
 * (architecture.md § DA2, D6/R14). Called from `src/app/api/orders/route.ts`
 * — never from `src/features/orders/**` or `src/app/[slug]/**`, which is
 * what keeps the fila 4 of F-010 green (`boundaries.test.ts`).
 *
 * NEVER rejects and NEVER takes longer than `ORDER_CUSTOMER_LINK_TIMEOUT_MS`:
 * whatever goes wrong — no cookie, an expired token, Supabase unreachable, a
 * slow `Customer` lookup — resolves to `null`, exactly like a guest (E17).
 * Resolving identity can never impede, delay visibly or fail the order.
 */
export async function resolveOrderCustomerId(): Promise<string | null> {
  try {
    // Fast path: no cookie of ours at all costs 0 ms, no network, no SQL —
    // the guest checkout pays nothing extra (R14).
    if (!(await hasCustomerSessionCookie())) return null;

    const resolve = (async (): Promise<string | null> => {
      const user = await getCustomerUser();
      if (!user) return null;
      return findCustomerIdByUserId(user.id);
    })();

    const timeout = new Promise<null>((resolvePromise) => {
      setTimeout(() => resolvePromise(null), ORDER_CUSTOMER_LINK_TIMEOUT_MS);
    });

    return await Promise.race([resolve, timeout]);
  } catch {
    return null;
  }
}
