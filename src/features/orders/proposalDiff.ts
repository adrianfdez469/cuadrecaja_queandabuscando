import { formatMoney, isZero, money } from "@/lib/money";

/**
 * "Qué cambia" (design.md § 4.4) — the plain-language diff between the
 * order's CURRENT lines/delivery/subtotal and the PROPOSED ones. Pure: the
 * server already has both snapshots, so the comparison happens here instead
 * of asking the customer to eyeball two full lists (design.md's whole
 * argument against two side-by-side tables).
 *
 * A5 (design.md, applied): lines are matched by `storeProductId` — the same
 * key the order already uses. A line with no key on either side (or no
 * match) cannot be paired, so it reads as a plain add/remove rather than a
 * false "changed" — the safer failure when a key is missing.
 */

export type DiffableItem = {
  storeProductId: string | null;
  name: string;
  quantity: string;
  unitPrice: string;
};

export type ProposalDiffInput = {
  currencyCode: string;
  currentItems: readonly DiffableItem[];
  proposedItems: readonly DiffableItem[];
  currentSubtotal: string;
  proposedSubtotal: string;
  currentDeliveryFee: string;
  proposedDeliveryFee: string;
};

function unitLabel(quantity: string): string {
  return `${quantity} ${Number(quantity) === 1 ? "unidad" : "unidades"}`;
}

export function buildProposalDiff(input: ProposalDiffInput): string[] {
  const { currencyCode } = input;
  const phrases: string[] = [];

  const currentByKey = new Map<string, DiffableItem>();
  for (const item of input.currentItems) {
    if (item.storeProductId) currentByKey.set(item.storeProductId, item);
  }
  const matchedKeys = new Set<string>();

  for (const proposed of input.proposedItems) {
    const match = proposed.storeProductId ? currentByKey.get(proposed.storeProductId) : undefined;

    if (!match) {
      phrases.push(`${proposed.name}: se agrega al pedido (${unitLabel(proposed.quantity)}).`);
      continue;
    }
    matchedKeys.add(match.storeProductId!);

    if (match.quantity !== proposed.quantity) {
      phrases.push(
        `${proposed.name}: antes ${match.quantity} unidades, ahora ${proposed.quantity}.`,
      );
    }
    if (match.unitPrice !== proposed.unitPrice) {
      phrases.push(
        `${proposed.name}: antes ${formatMoney(money(match.unitPrice, currencyCode))} c/u, ` +
          `ahora ${formatMoney(money(proposed.unitPrice, currencyCode))} c/u.`,
      );
    }
  }

  for (const current of input.currentItems) {
    // A line with no key can never be matched by construction (it never
    // entered `currentByKey`), so it always reads as removed here — paired
    // with the "added" phrase the loop above already emitted for its
    // proposed twin, if any. Noisier than silence, but never a false
    // "nothing changed" on a line this function cannot actually verify.
    const unmatched = !current.storeProductId || !matchedKeys.has(current.storeProductId);
    if (unmatched) {
      phrases.push(`${current.name}: sale del pedido (eran ${unitLabel(current.quantity)}).`);
    }
  }

  if (input.currentDeliveryFee !== input.proposedDeliveryFee) {
    const currentFee = money(input.currentDeliveryFee, currencyCode);
    const before = isZero(currentFee) ? "sin costo" : formatMoney(currentFee);
    phrases.push(
      `Envío: antes ${before}, ahora ${formatMoney(money(input.proposedDeliveryFee, currencyCode))}.`,
    );
  }

  if (input.currentSubtotal !== input.proposedSubtotal) {
    phrases.push(
      `Subtotal: antes ${formatMoney(money(input.currentSubtotal, currencyCode))}, ` +
        `ahora ${formatMoney(money(input.proposedSubtotal, currencyCode))}.`,
    );
  }

  return phrases;
}
