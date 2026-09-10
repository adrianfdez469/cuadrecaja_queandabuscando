import { describe, expect, it } from "vitest";
import { foldForSearch, stripDiacritics } from "./text";

describe("stripDiacritics()", () => {
  it("strips Spanish accents and ñ", () => {
    expect(stripDiacritics("Café")).toBe("Cafe");
    expect(stripDiacritics("Holguín")).toBe("Holguin");
    expect(stripDiacritics("Ñico")).toBe("Nico");
  });

  it("leaves plain ASCII untouched", () => {
    expect(stripDiacritics("Playa")).toBe("Playa");
  });
});

describe("foldForSearch()", () => {
  it("R6 — finds 'Holguín' typing 'holguin', no tilde", () => {
    expect(foldForSearch("Holguín")).toBe(foldForSearch("holguin"));
  });

  it("R6 — finds 'Cienfuegos' typing 'CIENFUEGOS'", () => {
    expect(foldForSearch("Cienfuegos")).toBe(foldForSearch("CIENFUEGOS"));
  });

  it("R6 — finds 'La Habana Vieja' typing 'hab'", () => {
    expect(foldForSearch("La Habana Vieja").includes(foldForSearch("hab"))).toBe(true);
  });

  it("does not collapse spaces or punctuation (unlike slugify)", () => {
    // R6/§ Componentes de UI: "san jose" must keep matching "San José de las
    // Lajas" as a substring — a slug would have turned both into
    // "san-jose-de-las-lajas", diverging from a query that never gets
    // hyphenated.
    expect(foldForSearch("San José de las Lajas")).toContain(foldForSearch("san jose"));
  });
});
