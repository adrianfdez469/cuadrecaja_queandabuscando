import { describe, expect, it } from "vitest";
import { buildStoreClosureWhatsappUrl, resolveStoreClosureHeadline } from "./storeClosure";

describe("resolveStoreClosureHeadline()", () => {
  it("returns the fixed phrase for one of the six admin reasons", () => {
    expect(
      resolveStoreClosureHeadline({ disabledReasonCode: "VACACIONES", disabledAt: new Date() }),
    ).toBe("Cerrado por vacaciones. Volvemos pronto.");
  });

  it("returns the HD12 retroactive phrase for the migration's own marker", () => {
    expect(
      resolveStoreClosureHeadline({
        disabledReasonCode: "PLATFORM_ROLLOUT",
        disabledAt: new Date(),
      }),
    ).toBe("Esta tienda todavía no está tomando pedidos por internet.");
  });

  it("returns the POS phrase when the sync closed it without a reason", () => {
    expect(resolveStoreClosureHeadline({ disabledReasonCode: null, disabledAt: new Date() })).toBe(
      "Esta tienda no está tomando pedidos por ahora.",
    );
  });

  it("falls back to the neutral platform phrase with neither a code nor a disabledAt", () => {
    expect(resolveStoreClosureHeadline({ disabledReasonCode: null, disabledAt: null })).toBe(
      "Esta tienda no está disponible en este momento.",
    );
  });
});

describe("buildStoreClosureWhatsappUrl()", () => {
  it("builds a wa.me link from whatsapp, preferring it over phone", () => {
    const url = buildStoreClosureWhatsappUrl({
      storeName: "La Rampa",
      whatsapp: "+53 5555-5555",
      phone: "+53 4444-4444",
    });
    expect(url).toContain("https://wa.me/5355555555?text=");
    expect(url).toContain(encodeURIComponent("La Rampa"));
  });

  it("returns null with neither number", () => {
    expect(
      buildStoreClosureWhatsappUrl({ storeName: "La Rampa", whatsapp: null, phone: null }),
    ).toBeNull();
  });
});
