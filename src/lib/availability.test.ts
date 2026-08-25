import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_LABEL,
  AVAILABILITY_TONE,
  isOrderable,
  shouldShowBadge,
} from "./availability";

describe("availability", () => {
  it("labels every state in Spanish", () => {
    expect(AVAILABILITY_LABEL.AVAILABLE).toBe("Disponible");
    expect(AVAILABILITY_LABEL.LOW_STOCK).toBe("Pocas unidades");
    expect(AVAILABILITY_LABEL.OUT_OF_STOCK).toBe("Agotado");
  });

  it("blocks ordering only when out of stock", () => {
    expect(isOrderable("AVAILABLE")).toBe(true);
    expect(isOrderable("LOW_STOCK")).toBe(true);
    expect(isOrderable("OUT_OF_STOCK")).toBe(false);
  });

  it("stays quiet when there is nothing to warn about", () => {
    expect(shouldShowBadge("AVAILABLE")).toBe(false);
    expect(shouldShowBadge("LOW_STOCK")).toBe(true);
    expect(shouldShowBadge("OUT_OF_STOCK")).toBe(true);
  });

  it("maps every state to a tone", () => {
    expect(Object.keys(AVAILABILITY_TONE).sort()).toEqual([
      "AVAILABLE",
      "LOW_STOCK",
      "OUT_OF_STOCK",
    ]);
  });
});
