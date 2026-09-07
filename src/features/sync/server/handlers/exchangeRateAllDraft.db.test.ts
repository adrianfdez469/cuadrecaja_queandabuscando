import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StoreStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";

/**
 * F-035 paso 6 (plan.md; spec.md C5/E5/R12; architecture.md § "Lo único que
 * queda equivocable" no habla de esto porque el hueco no es de la QUERY —
 * `businessBranches.test.ts` con `prisma` mockeado ya prueba que cero marcas
 * o solo marcas sin sucursales renderizables resuelven a `[]` — es de la
 * TUBERÍA completa: que un negocio real, contra Postgres real, con TODAS sus
 * sucursales en `DRAFT`, entre por el route handler de verdad, escriba su
 * `ExchangeRate`, responda `processed`, y no dispare NI UN `revalidateTag` —
 * ni siquiera el de los dos `Set` vacíos que `revalidateStores`/
 * `revalidateSlugs` reciben SIEMPRE al final del lote
 * (`processBatch.ts:93,100`; R12 mide la cuenta de `revalidateTag`, no de
 * `revalidateStores`, por esto exacto).
 *
 * La fixture (spec.md § No decidido a propósito, punto 3): sembrar un
 * negocio de dos sucursales `DRAFT` con `createFixtureSession().createStore`,
 * en vez de mockear `prisma` — lo que `businessBranches.test.ts` ya hace y no
 * necesita repetirse aquí.
 *
 * `next/cache` se mockea porque `revalidateTag` exige un "static generation
 * store" que solo existe dentro de un `next dev`/`next start` real — llamar
 * al `POST` de verdad desde Vitest sin este mock revienta con
 * `Invariant: static generation store missing` (ficha
 * `.agent/playbook/db-test-revalidatetag-static-generation-store-missing.md`).
 * A diferencia del passthrough de `storePublishGate.db.test.ts`, aquí el spy
 * SÍ importa: el conteo de sus llamadas es la aserción central de este
 * archivo, no un efecto secundario a silenciar.
 */
const revalidateTagSpy = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagSpy(...args),
  unstable_cache: (fn: unknown) => fn,
}));

const { POST } = await import("@/app/api/internal/sync/catalog/route");

describe("EXCHANGE_RATE against a business whose every branch is DRAFT (criterio 5, C5, E5)", () => {
  let session: FixtureSession;

  beforeAll(async () => {
    session = await createFixtureSession();
    // Two DRAFT branches — not one, not zero — so this also stands in for
    // "a business with several unpublished branches", not just the
    // single-branch edge of the criterion's wording.
    await session.createStore({ status: StoreStatus.DRAFT });
    await session.createStore({ status: StoreStatus.DRAFT });
  });

  afterAll(async () => {
    // ExchangeRate cascades on Business delete (`onDelete: Cascade`,
    // prisma/schema.prisma), so `session.cleanup()` alone already removes the
    // row this test writes — nothing extra to delete here.
    await prisma.syncEvent.deleteMany({ where: { businessId: session.businessExternalId } });
    await session.cleanup();
  });

  it("responds processed, writes the ExchangeRate row, and fires ZERO revalidateTag calls", async () => {
    revalidateTagSpy.mockClear();
    const eventId = `${session.token}-evt-rate`;
    const now = new Date().toISOString();

    const response = await POST(
      new Request("http://localhost/api/internal/sync/catalog", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.syncToken}`,
        },
        body: JSON.stringify({
          businessId: session.businessExternalId,
          events: [
            {
              eventId,
              entity: "EXCHANGE_RATE",
              operation: "CREATE",
              occurredAt: now,
              payload: {
                businessId: session.businessExternalId,
                currency: "ABC",
                rate: 123.45,
                updatedAt: now,
              },
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body.ok).toEqual([eventId]);
    expect(body.failed).toEqual([]);
    expect(body.results).toEqual([{ eventId, status: "processed" }]);

    const row = await prisma.exchangeRate.findFirst({
      where: { businessId: session.businessId, currencyCode: "ABC" },
      select: { rate: true },
    });
    expect(row).not.toBeNull();
    expect(row?.rate.toString()).toBe("123.45");

    // R12: not "revalidateStores was called once" (it always is, even with
    // an empty Set) — the count of ACTUAL revalidateTag calls, which for an
    // all-DRAFT business must be exactly zero.
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("a SECOND EXCHANGE_RATE for the same all-DRAFT business, in its own batch, still fires zero revalidateTag (R14: no batch-order dependence)", async () => {
    revalidateTagSpy.mockClear();
    const eventId = `${session.token}-evt-rate-2`;
    const now = new Date().toISOString();

    const response = await POST(
      new Request("http://localhost/api/internal/sync/catalog", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.syncToken}`,
        },
        body: JSON.stringify({
          businessId: session.businessExternalId,
          events: [
            {
              eventId,
              entity: "EXCHANGE_RATE",
              operation: "CREATE",
              occurredAt: now,
              payload: {
                businessId: session.businessExternalId,
                currency: "ABC",
                rate: 200,
                updatedAt: now,
              },
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body.results).toEqual([{ eventId, status: "processed" }]);
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });
});
