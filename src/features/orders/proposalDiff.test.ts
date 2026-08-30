import { describe, expect, it } from "vitest";
import { buildProposalDiff, type ProposalDiffInput } from "./proposalDiff";

function baseInput(overrides: Partial<ProposalDiffInput> = {}): ProposalDiffInput {
  return {
    currencyCode: "CUP",
    currentItems: [
      { storeProductId: "sp-1", name: "Café Cubita", quantity: "2", unitPrice: "450.00" },
    ],
    proposedItems: [
      { storeProductId: "sp-1", name: "Café Cubita", quantity: "2", unitPrice: "450.00" },
    ],
    currentSubtotal: "900.00",
    proposedSubtotal: "900.00",
    currentDeliveryFee: "0.00",
    proposedDeliveryFee: "0.00",
    ...overrides,
  };
}

describe("buildProposalDiff() — design.md § 4.4", () => {
  it("emits nothing when nothing changed", () => {
    expect(buildProposalDiff(baseInput())).toEqual([]);
  });

  it("a line that quits: 'sale del pedido (eran N unidades)'", () => {
    const diff = buildProposalDiff(baseInput({ proposedItems: [] }));
    expect(diff).toContain("Café Cubita: sale del pedido (eran 2 unidades).");
  });

  it("a line that enters: 'se agrega al pedido (N unidad/unidades)', singular for 1", () => {
    const diff = buildProposalDiff(
      baseInput({
        proposedItems: [
          { storeProductId: "sp-1", name: "Café Cubita", quantity: "2", unitPrice: "450.00" },
          { storeProductId: "sp-2", name: "Agua mineral 1.5 L", quantity: "1", unitPrice: "80.00" },
        ],
      }),
    );
    expect(diff).toContain("Agua mineral 1.5 L: se agrega al pedido (1 unidad).");
  });

  it("quantity change: 'antes N unidades, ahora M'", () => {
    const diff = buildProposalDiff(
      baseInput({
        proposedItems: [
          { storeProductId: "sp-1", name: "Café Cubita", quantity: "3", unitPrice: "450.00" },
        ],
      }),
    );
    expect(diff).toContain("Café Cubita: antes 2 unidades, ahora 3.");
  });

  it("price change: 'antes $x c/u, ahora $y c/u'", () => {
    const diff = buildProposalDiff(
      baseInput({
        proposedItems: [
          { storeProductId: "sp-1", name: "Café Cubita", quantity: "2", unitPrice: "480.00" },
        ],
      }),
    );
    expect(diff.some((line) => line.includes("c/u"))).toBe(true);
  });

  it("quantity AND price change: two separate phrases, not one condensed", () => {
    const diff = buildProposalDiff(
      baseInput({
        proposedItems: [
          { storeProductId: "sp-1", name: "Café Cubita", quantity: "3", unitPrice: "480.00" },
        ],
      }),
    );
    expect(diff).toHaveLength(2);
  });

  it("delivery: 'Envío: antes sin costo, ahora $y' when it was free", () => {
    const diff = buildProposalDiff(baseInput({ proposedDeliveryFee: "500.00" }));
    expect(diff.some((line) => line.startsWith("Envío: antes sin costo, ahora"))).toBe(true);
  });

  it("delivery: both amounts named when neither is zero", () => {
    const diff = buildProposalDiff(
      baseInput({ currentDeliveryFee: "300.00", proposedDeliveryFee: "500.00" }),
    );
    expect(diff.some((line) => /^Envío: antes .+, ahora .+\.$/.test(line))).toBe(true);
    expect(diff.some((line) => line.includes("sin costo"))).toBe(false);
  });

  it("subtotal changes ONLY when it changed", () => {
    const unchanged = buildProposalDiff(baseInput());
    expect(unchanged.some((line) => line.startsWith("Subtotal"))).toBe(false);

    const changed = buildProposalDiff(
      baseInput({ currentSubtotal: "900.00", proposedSubtotal: "1000.00" }),
    );
    expect(changed.some((line) => line.startsWith("Subtotal: antes"))).toBe(true);
  });

  it("a line with no storeProductId on either side never matches — reads as add + remove", () => {
    const diff = buildProposalDiff(
      baseInput({
        currentItems: [
          { storeProductId: null, name: "Producto suelto", quantity: "1", unitPrice: "10.00" },
        ],
        proposedItems: [
          { storeProductId: null, name: "Producto suelto", quantity: "1", unitPrice: "10.00" },
        ],
      }),
    );
    expect(diff).toContain("Producto suelto: sale del pedido (eran 1 unidad).");
    expect(diff).toContain("Producto suelto: se agrega al pedido (1 unidad).");
  });
});
