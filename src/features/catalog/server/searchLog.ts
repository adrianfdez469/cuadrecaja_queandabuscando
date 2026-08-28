import { prisma } from "@/lib/prisma";

/**
 * F-021 (R4, R5): one row per query that reached the database. `term` is
 * already normalized (never as it arrived), `resultCount` is the total of
 * the three layers, not the page. NEVER throws (R13, E16): a caller
 * schedules this with `after()`, after the response already left, so a
 * failure here must not surface to the shopper.
 */
export async function recordStoreSearchQuery(input: {
  storeId: string;
  term: string;
  resultCount: number;
}): Promise<void> {
  try {
    await prisma.storeSearchQuery.create({
      data: {
        storeId: input.storeId,
        term: input.term,
        resultCount: input.resultCount,
      },
    });
  } catch (error) {
    console.warn("[catalog] could not record a store search query:", error);
  }
}
