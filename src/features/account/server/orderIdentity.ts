import { after } from "next/server";
import { ORDER_CUSTOMER_LINK_TIMEOUT_MS } from "@/constants/account";
import { getCustomerUser, hasCustomerSessionCookie } from "@/lib/auth/customerSession";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { findCustomerIdByUserId } from "./customers";
import { startOrderLinkWatch, type OrderLinkResolution } from "./orderLinkObserver";

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
 *
 * F-030 wires in a passive observer of the same race (architecture.md § DA1):
 * it can only ever add a `console.warn`, never change the value returned
 * here or how long it takes.
 */
export async function resolveOrderCustomerId(): Promise<string | null> {
  try {
    // Fast path: no cookie of ours at all costs 0 ms, no network, no SQL —
    // the guest checkout pays nothing extra (R14, F-030 R4). Checked BEFORE
    // `isSupabaseAuthConfigured()` on purpose (F-030 DA5): the guest does not
    // pay even a `process.env` read.
    if (!(await hasCustomerSessionCookie())) return null;

    // F-030 R12/DA5: "Auth not configured" is decided here, not deduced from
    // `getCustomerUser()`'s `null` — the two look identical from the outside
    // (its own doc comment says so) and deducing it would emit `unverified`
    // on every order of a deployment with no Auth at all.
    const watch = isSupabaseAuthConfigured() ? startOrderLinkWatch() : null;

    const resolveOnce = async (): Promise<OrderLinkResolution> => {
      const user = await getCustomerUser();
      if (!user) return { kind: "unverified" };
      const customerId = await findCustomerIdByUserId(user.id);
      return customerId ? { kind: "linked", customerId } : { kind: "no_customer" };
    };

    // The `.catch` is attached in the SAME expression that creates the
    // branch: from this instant `attempt` can never reject, whether it wins
    // or loses the race (R13, architecture.md DA2).
    const attempt: Promise<OrderLinkResolution> = resolveOnce().catch(
      () => ({ kind: "error" }) as const,
    );
    const timeout = new Promise<null>((resolvePromise) => {
      setTimeout(() => resolvePromise(null), ORDER_CUSTOMER_LINK_TIMEOUT_MS);
    });

    const winner = await Promise.race([attempt, timeout]);
    if (winner === null) {
      // Emits `timeout` now, while the request is still alive, and attaches
      // the `late` continuation to `attempt` on its own.
      watch?.timedOut(attempt);
      try {
        // Keeps THIS invocation alive until `attempt` settles, so the `late`
        // continuation above gets to run before a serverless runtime freezes
        // it (architecture.md DA2). Outside a request scope — exactly what
        // happens when this function is called directly from a unit test —
        // `after()` throws, and swallowing that does not lose the line: the
        // continuation is already attached to `attempt` regardless of
        // whether this call succeeds.
        after(() => attempt);
      } catch {
        // See above.
      }
      return null;
    }
    watch?.settled(winner);
    return winner.kind === "linked" ? winner.customerId : null;
  } catch {
    return null; // includes hasCustomerSessionCookie() throwing: 0 lines emitted
  }
}
