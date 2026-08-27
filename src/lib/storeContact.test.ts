import { describe, expect, it } from "vitest";
import { presentationContact, routingWhatsappNumber } from "./storeContact";

const branch = { phone: "+5350000001", whatsapp: "+5350000002", email: "branch@example.com" };
const noBrand = { contactPhone: null, contactWhatsapp: null, contactEmail: null };
const fullBrand = {
  contactPhone: "+5350000009",
  contactWhatsapp: "+5350000008",
  contactEmail: "brand@example.com",
};

describe("presentationContact() — R14", () => {
  it("falls back to the branch when the brand has nothing (E19)", () => {
    expect(presentationContact({ brand: noBrand, branch })).toEqual({
      phone: branch.phone,
      whatsapp: branch.whatsapp,
      email: branch.email,
    });
  });

  it("prefers the brand field by field when it has one (E20)", () => {
    expect(presentationContact({ brand: fullBrand, branch })).toEqual({
      phone: fullBrand.contactPhone,
      whatsapp: fullBrand.contactWhatsapp,
      email: fullBrand.contactEmail,
    });
  });

  it("mixes: a brand with only a phone still falls back for the rest", () => {
    const partialBrand = { contactPhone: "+5350000009", contactWhatsapp: null, contactEmail: null };
    expect(presentationContact({ brand: partialBrand, branch })).toEqual({
      phone: partialBrand.contactPhone,
      whatsapp: branch.whatsapp,
      email: branch.email,
    });
  });

  it("both empty resolves to nulls, never throws", () => {
    expect(
      presentationContact({ brand: noBrand, branch: { phone: null, whatsapp: null, email: null } }),
    ).toEqual({ phone: null, whatsapp: null, email: null });
  });
});

describe("routingWhatsappNumber() — R15", () => {
  it("is always the branch's own number, even when the brand has one", () => {
    expect(routingWhatsappNumber(branch)).toBe(branch.whatsapp);
  });

  it("falls back to phone when the branch has no whatsapp", () => {
    expect(routingWhatsappNumber({ whatsapp: null, phone: "+5350000001" })).toBe("+5350000001");
  });

  it("is null when the branch has neither", () => {
    expect(routingWhatsappNumber({ whatsapp: null, phone: null })).toBeNull();
  });
});
