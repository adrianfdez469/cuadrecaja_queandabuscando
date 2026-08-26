import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { AdminSession } from "@/lib/auth/adminSession";
import type { AuthorizedStoreId } from "../authorization";
import type { AdminStoreListItem } from "../types";

/**
 * Read side of the panel's tienda scope.
 *
 * `listManagedStores` filters strictly by `session.storeIds` (never
 * `businessId` — criterio 1) and does zero queries for an empty session.
 */
export async function listManagedStores(session: AdminSession): Promise<AdminStoreListItem[]> {
  if (session.storeIds.length === 0) return [];

  const stores = await prisma.store.findMany({
    where: { id: { in: session.storeIds } },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      city: true,
      address: true,
      disabledReasonCode: true,
      disabledMessage: true,
      disabledAt: true,
    },
    orderBy: { name: "asc" },
  });

  return stores.map((store) => ({
    ...store,
    disabledAt: store.disabledAt ? store.disabledAt.toISOString() : null,
  }));
}

export type ManagedStoreDetail = AdminStoreListItem & {
  description: string | null;
  province: string | null;
  whatsapp: string | null;
  phone: string | null;
  /** HD3: the currency a FIXED promotion's `value` is denominated in (R27). */
  baseCurrencyCode: string;
};

async function findManagedStore(storeId: AuthorizedStoreId): Promise<ManagedStoreDetail | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      city: true,
      address: true,
      description: true,
      province: true,
      whatsapp: true,
      phone: true,
      disabledReasonCode: true,
      disabledMessage: true,
      disabledAt: true,
      business: { select: { baseCurrencyCode: true } },
    },
  });
  if (!store) return null;
  const { business, ...rest } = store;
  return {
    ...rest,
    disabledAt: store.disabledAt ? store.disabledAt.toISOString() : null,
    baseCurrencyCode: business.baseCurrencyCode,
  };
}

/**
 * Gemelo of `catalog/server/queries.ts::requireStore`: throws the Next
 * not-found boundary. The caller already authorized `storeId` — this only
 * covers the row disappearing between two logins (spec § Casos límite).
 */
export async function requireManagedStore(storeId: AuthorizedStoreId): Promise<ManagedStoreDetail> {
  const store = await findManagedStore(storeId);
  if (!store) notFound();
  return store;
}
