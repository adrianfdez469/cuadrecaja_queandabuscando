import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { buildWhatsappUrl, type WhatsappOrderInput } from "./whatsapp";

const baseInput: WhatsappOrderInput = {
  storeName: "La Rampa · Vedado",
  whatsappNumber: "+5350000001",
  code: "A7K3M9PQR2",
  lines: [{ quantity: "2", name: "Café Cubita", lineTotal: money("900", "CUP") }],
  subtotal: money("900", "CUP"),
  deliveryFee: money("0", "CUP"),
  total: money("900", "CUP"),
  fulfillment: "PICKUP",
  deliveryAddress: null,
  contactName: "Ana Pérez",
  contactPhone: "+5355555555",
  orderUrl: "https://tienda-demo.example.com/tienda-demo/pedido/A7K3M9PQR2",
};

describe("buildWhatsappUrl()", () => {
  it("returns null when there is no number", () => {
    expect(buildWhatsappUrl({ ...baseInput, whatsappNumber: null })).toBeNull();
  });

  it("returns a wa.me link with digits only, no +", () => {
    const url = buildWhatsappUrl(baseInput);
    expect(url).toMatch(/^https:\/\/wa\.me\/5350000001\?text=/);
  });

  it("includes the formatted code, the total and the order URL", () => {
    const url = buildWhatsappUrl(baseInput)!;
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("Código: A7K3M-9PQR2");
    expect(decoded).toContain(baseInput.orderUrl);
    expect(decoded).toContain("Entrega: Recoger en la tienda");
  });

  it("adds the shipping line only when fulfillment is DELIVERY", () => {
    const pickup = decodeURIComponent(buildWhatsappUrl(baseInput)!.split("text=")[1]);
    expect(pickup).not.toContain("Envío:");

    const delivery = decodeURIComponent(
      buildWhatsappUrl({
        ...baseInput,
        fulfillment: "DELIVERY",
        deliveryAddress: "Calle 23 esq. L, Vedado",
        deliveryFee: money("500", "CUP"),
      })!.split("text=")[1],
    );
    expect(delivery).toContain("Envío:");
    expect(delivery).toContain("Envío a Calle 23 esq. L, Vedado");
  });

  it("summarizes past the first 10 lines instead of listing all of them", () => {
    const manyLines = Array.from({ length: 15 }, (_, i) => ({
      quantity: "1",
      name: `Producto ${i}`,
      lineTotal: money("100", "CUP"),
    }));
    const decoded = decodeURIComponent(
      buildWhatsappUrl({ ...baseInput, lines: manyLines })!.split("text=")[1],
    );
    expect(decoded).toContain("Producto 9");
    expect(decoded).not.toContain("Producto 10");
    expect(decoded).toContain("… y 5 productos más (están en el enlace).");
  });
});
