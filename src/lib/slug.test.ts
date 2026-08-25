import { describe, expect, it } from "vitest";
import { isReservedSlug, isValidSlug, slugify, uniqueSlug } from "./slug";

describe("slugify()", () => {
  it("strips Spanish accents", () => {
    expect(slugify("Café Habana")).toBe("cafe-habana");
    expect(slugify("Almacén Ñico")).toBe("almacen-nico");
    expect(slugify("Bodegón Güines")).toBe("bodegon-guines");
  });

  it("collapses punctuation and whitespace", () => {
    expect(slugify("  El  Rápido -- #1  ")).toBe("el-rapido-1");
  });

  it("never leaves a leading or trailing dash", () => {
    expect(slugify("!!!hola!!!")).toBe("hola");
  });

  it("returns empty for input with nothing slug-able", () => {
    expect(slugify("¡!¿?")).toBe("");
  });

  it("truncates without leaving a trailing dash", () => {
    const slug = slugify("a".repeat(78) + " " + "b".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("isValidSlug()", () => {
  it("accepts well-formed slugs", () => {
    expect(isValidSlug("cafe-habana")).toBe(true);
    expect(isValidSlug("tienda1")).toBe(true);
  });

  it("rejects malformed slugs", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("double--dash")).toBe(false);
    expect(isValidSlug("Upper")).toBe(false);
  });

  it("rejects slugs that would shadow a real route", () => {
    expect(isReservedSlug("admin")).toBe(true);
    expect(isValidSlug("admin")).toBe(false);
    expect(isValidSlug("carrito")).toBe(false);
  });
});

describe("uniqueSlug()", () => {
  it("returns the base slug when free", async () => {
    expect(await uniqueSlug("Café Habana", () => false)).toBe("cafe-habana");
  });

  it("suffixes until it finds a free one", async () => {
    const used = new Set(["cafe-habana", "cafe-habana-2"]);
    expect(await uniqueSlug("Café Habana", (c) => used.has(c))).toBe("cafe-habana-3");
  });

  it("escapes reserved words instead of failing", async () => {
    expect(await uniqueSlug("Admin", () => false)).toBe("admin-tienda");
  });

  it("uses the fallback when the name slugifies to nothing", async () => {
    expect(await uniqueSlug("¿?", () => false, { fallback: "tienda" })).toBe("tienda");
  });

  it("supports an async predicate", async () => {
    const used = new Set(["x"]);
    expect(await uniqueSlug("X", async (c) => used.has(c))).toBe("x-2");
  });
});
