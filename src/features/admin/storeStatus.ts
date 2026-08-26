import type { StoreStatus } from "@/generated/prisma/enums";

/**
 * `Store.status` presentation for the panel.
 *
 * This maps ONLY the publication state the sync owns (`DRAFT` / `PUBLISHED` /
 * `SUSPENDED`). The open/closed-to-the-public switch (HD10) is a separate
 * axis that ships in the next cycle — see `impl.md` § Desviaciones — so this
 * badge answers "did cuadrecaja publish it", not "can a shopper buy right
 * now".
 */
export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  DRAFT: "Borrador",
  PUBLISHED: "Publicada",
  SUSPENDED: "Suspendida",
};

export type StoreStatusTone = "positive" | "muted" | "danger";

export const STORE_STATUS_TONE: Record<StoreStatus, StoreStatusTone> = {
  DRAFT: "muted",
  PUBLISHED: "positive",
  SUSPENDED: "danger",
};
