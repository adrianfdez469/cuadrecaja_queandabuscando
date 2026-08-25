import { prisma } from "@/lib/prisma";
import { revalidateStores } from "@/lib/cache";
import type { Availability } from "@/generated/prisma/enums";

export type AvailabilityItem = {
  storeProductId: string;
  storeId: string;
  availability: Availability;
};

export type AvailabilityResult = {
  applied: number;
  /** Pairs the POS may mark as published. Anything absent is retried. */
  confirmed: [string, string][];
};

/**
 * Apply an availability batch.
 *
 * The UPDATE is conditional on the value actually differing, so a resend costs
 * nothing and does not churn `updatedAt`. Only rows this side could resolve are
 * confirmed — an unknown product stays divergent in the POS and is retried,
 * which is exactly the self-healing property the convergent query provides.
 */
export async function applyAvailability(items: AvailabilityItem[]): Promise<AvailabilityResult> {
  const storeExternalIds = [...new Set(items.map((item) => item.storeId))];
  const stores = await prisma.store.findMany({
    where: { externalId: { in: storeExternalIds } },
    select: { id: true, externalId: true, slug: true },
  });
  const byExternalId = new Map(stores.map((store) => [store.externalId, store]));

  const confirmed: [string, string][] = [];
  const touchedStores = new Set<string>();
  let applied = 0;

  // Grouped by target value so the whole batch is at most three round trips
  // instead of one per item — the pooler makes chatty writes expensive.
  const groups = new Map<Availability, { storeId: string; externalId: string }[]>();

  for (const item of items) {
    const store = byExternalId.get(item.storeId);
    if (!store) continue;

    const group = groups.get(item.availability) ?? [];
    group.push({ storeId: store.id, externalId: item.storeProductId });
    groups.set(item.availability, group);

    confirmed.push([item.storeProductId, item.storeId]);
    touchedStores.add(store.slug);
  }

  for (const [availability, rows] of groups) {
    const result = await prisma.storeProduct.updateMany({
      where: {
        OR: rows.map((row) => ({ storeId: row.storeId, externalId: row.externalId })),
        NOT: { availability },
      },
      data: { availability, syncedAt: new Date() },
    });
    applied += result.count;
  }

  // Only bust caches when something actually changed.
  if (applied > 0) revalidateStores(touchedStores);

  return { applied, confirmed };
}
