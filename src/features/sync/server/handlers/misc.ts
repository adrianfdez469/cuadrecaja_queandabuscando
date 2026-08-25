import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import type { CategoryPayload, CurrencyPayload, ExchangeRatePayload } from "../../schemas";
import { PROCESSED, SKIPPED, type HandlerOutcome } from "./types";

export async function handleCategory(
  payload: CategoryPayload,
  operation: "CREATE" | "UPDATE" | "DELETE",
): Promise<HandlerOutcome> {
  const business = await prisma.business.findUnique({
    where: { externalId: payload.businessId },
    select: { id: true },
  });
  if (!business) return SKIPPED;

  if (operation === "DELETE") {
    // Products keep their categoryId pointing at nothing rather than being
    // reassigned; detaching them is a product-level decision the POS will send.
    await prisma.localCategory.deleteMany({
      where: { businessId: business.id, externalId: payload.categoryId },
    });
    return PROCESSED;
  }

  await prisma.localCategory.upsert({
    where: {
      businessId_externalId: { businessId: business.id, externalId: payload.categoryId },
    },
    create: {
      businessId: business.id,
      externalId: payload.categoryId,
      name: payload.name,
      slug: slugify(payload.name) || "categoria",
      color: payload.color ?? null,
    },
    update: { name: payload.name, color: payload.color ?? null },
  });

  return PROCESSED;
}

export async function handleCurrency(payload: CurrencyPayload): Promise<HandlerOutcome> {
  await prisma.currency.upsert({
    where: { code: payload.code },
    create: {
      code: payload.code,
      name: payload.name,
      symbol: payload.symbol,
      active: payload.active,
    },
    update: { name: payload.name, symbol: payload.symbol, active: payload.active },
  });
  return PROCESSED;
}

/**
 * Rates are append-only, mirroring cuadrecaja. `rate` is CUP per 1 unit and CUP
 * itself never has a row — writing one would make the anchor ambiguous.
 */
export async function handleExchangeRate(payload: ExchangeRatePayload): Promise<HandlerOutcome> {
  if (payload.currency === "CUP") return SKIPPED;

  const business = await prisma.business.findUnique({
    where: { externalId: payload.businessId },
    select: { id: true },
  });
  if (!business) return SKIPPED;

  await prisma.currency.upsert({
    where: { code: payload.currency },
    create: { code: payload.currency, name: payload.currency, symbol: payload.currency },
    update: {},
  });

  await prisma.exchangeRate.create({
    data: {
      businessId: business.id,
      currencyCode: payload.currency,
      rate: payload.rate.toFixed(6),
    },
  });

  return PROCESSED;
}
