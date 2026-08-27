import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_SLUGS, isReservedSlug, isValidSlug, slugify, uniqueSlug } from "./slug";

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

/** Criterio 5 / criterio propuesto 14 (spec.md): `admin`, `api` and `buscar`
 *  are rejected, and `sesion-cerrada` — I3, the reservation F-011 skipped
 *  when it built the page — is reserved too. */
describe("RESERVED_SLUGS (criterio 5, I3)", () => {
  it("rejects admin, api and buscar as proposable slugs", () => {
    for (const word of ["admin", "api", "buscar"]) {
      expect(isReservedSlug(word)).toBe(true);
      expect(isValidSlug(word)).toBe(false);
    }
  });

  it("reserves sesion-cerrada, the top-level route F-011 built without reserving it", () => {
    expect(isReservedSlug("sesion-cerrada")).toBe(true);
  });

  it("reserves sucursales, the segment etapa 2 introduces", () => {
    expect(isReservedSlug("sucursales")).toBe(true);
  });

  it("never drops a word that was already reserved (R11)", () => {
    const original = [
      "admin",
      "api",
      "app",
      "auth",
      "buscar",
      "carrito",
      "checkout",
      "cuenta",
      "login",
      "logout",
      "pedido",
      "public",
      "static",
      "_next",
    ];
    for (const word of original) expect(RESERVED_SLUGS).toContain(word);
  });

  /**
   * The real backstop: every literal top-level directory under `src/app/`
   * that could shadow a slug is in the list. A route group like
   * `(marketing)` is not a URL segment and is excluded; `[slug]` is the
   * dynamic catch-all itself. A new top-level route that nobody reserves
   * would otherwise be a silent 404 in production the day a brand takes it.
   */
  it("contains every real top-level literal segment of src/app/", () => {
    const appDir = join(process.cwd(), "src/app");
    const literalSegments = readdirSync(appDir).filter((entry) => {
      if (entry.startsWith("(") || entry.startsWith("[") || entry.includes(".")) return false;
      return statSync(join(appDir, entry)).isDirectory();
    });
    for (const segment of literalSegments) {
      expect(RESERVED_SLUGS).toContain(segment);
    }
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
