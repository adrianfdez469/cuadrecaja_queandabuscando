import { describe, expect, it } from "vitest";
import { isStoreDisabledReasonCode } from "@/constants/storeClosure";
import { storeStatusBodySchema } from "@/features/admin/schemas";
import {
  buildStoreClosureWhatsappUrl,
  resolveStoreClosureClosingLine,
  resolveStoreClosureHeadline,
} from "./storeClosure";

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

  it("F-040 (AD8): returns the unpriced-catalogue phrase for PRICES_UNAVAILABLE, even with no disabledAt — the store never closed", () => {
    expect(
      resolveStoreClosureHeadline({ disabledReasonCode: "PRICES_UNAVAILABLE", disabledAt: null }),
    ).toBe(
      "Esta tienda no puede mostrar sus precios ahora mismo, así que no está tomando pedidos.",
    );
  });
});

describe("F-040 (criterio 4, E19): PRICES_UNAVAILABLE is not a writable reason", () => {
  it("isStoreDisabledReasonCode rejects it — the panel's list never offers it", () => {
    expect(isStoreDisabledReasonCode("PRICES_UNAVAILABLE")).toBe(false);
  });

  it("storeStatusBodySchema rejects it — the panel's own endpoint cannot write it", () => {
    const result = storeStatusBodySchema.safeParse({
      enabled: false,
      reasonCode: "PRICES_UNAVAILABLE",
    });
    expect(result.success).toBe(false);
  });
});

describe("resolveStoreClosureClosingLine()", () => {
  it("keeps today's line for a real closure", () => {
    expect(resolveStoreClosureClosingLine("VACACIONES")).toBe(
      "Esta página se actualiza sola cuando la tienda vuelva a abrir.",
    );
    expect(resolveStoreClosureClosingLine(null)).toBe(
      "Esta página se actualiza sola cuando la tienda vuelva a abrir.",
    );
  });

  it("F-040: promises the render-time recovery instead, only for PRICES_UNAVAILABLE", () => {
    expect(resolveStoreClosureClosingLine("PRICES_UNAVAILABLE")).toBe(
      "Esta página se actualiza sola en cuanto la tienda vuelva a mostrar precios.",
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

  it("F-040 (DP3): the prescribed message changes ONLY for PRICES_UNAVAILABLE", () => {
    const url = buildStoreClosureWhatsappUrl({
      storeName: "La Rampa",
      whatsapp: "+53 5555-5555",
      phone: null,
      disabledReasonCode: "PRICES_UNAVAILABLE",
    });
    expect(url).toContain(
      encodeURIComponent(
        "Hola La Rampa, vi su tienda online pero no me aparecen los precios. ¿Me los pueden decir?",
      ),
    );
  });

  it("F-040: a real closure keeps today's message untouched", () => {
    const url = buildStoreClosureWhatsappUrl({
      storeName: "La Rampa",
      whatsapp: "+53 5555-5555",
      phone: null,
      disabledReasonCode: "VACACIONES",
    });
    expect(url).toContain(encodeURIComponent("¿Cuándo vuelven a tomar pedidos?"));
  });
});
