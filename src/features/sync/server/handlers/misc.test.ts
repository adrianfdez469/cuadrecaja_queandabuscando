import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-026 paso 2/3: `handleCategory` gana un slug sin colisión acotado al
 * negocio (con reintento ante violación de `slug` @unique), deja el slug
 * INTOCADO en el `UPDATE` (R8/E7), una guarda anti-rancia contra
 * `sourceUpdatedAt` (I8), y reporta `touchedStoreSlugs` — las sucursales
 * afectadas, resueltas ANTES de escribir (y, en el `DELETE`, antes de
 * borrar: la FK es `ON DELETE SET NULL`) — que `processBatch.ts` funde en
 * el mismo `Set` que ya alimenta `revalidateStores` (probado ahí, no aquí:
 * este archivo solo prueba lo que el propio handler DEVUELVE).
 */

const localCategoryFindUnique = vi.fn();
const localCategoryCount = vi.fn();
const localCategoryCreate = vi.fn();
const localCategoryUpdate = vi.fn();
const localCategoryDelete = vi.fn();
const storeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    localCategory: {
      findUnique: (...a: unknown[]) => localCategoryFindUnique(...a),
      count: (...a: unknown[]) => localCategoryCount(...a),
      create: (...a: unknown[]) => localCategoryCreate(...a),
      update: (...a: unknown[]) => localCategoryUpdate(...a),
      delete: (...a: unknown[]) => localCategoryDelete(...a),
    },
    store: {
      findMany: (...a: unknown[]) => storeFindMany(...a),
    },
  },
}));

const { handleCategory } = await import("./misc");

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    categoryId: "ext-cat-1",
    businessId: "seed-negocio-1",
    name: "Bebidas",
    color: null,
    updatedAt: "2026-08-31T12:00:00.000Z",
    ...overrides,
  };
}

function uniqueViolation(target: string) {
  return { code: "P2002", meta: { target: [target] } };
}

beforeEach(() => {
  localCategoryFindUnique.mockReset().mockResolvedValue(null);
  localCategoryCount.mockReset().mockResolvedValue(0);
  localCategoryCreate.mockReset();
  localCategoryUpdate.mockReset();
  localCategoryDelete.mockReset();
  storeFindMany.mockReset().mockResolvedValue([]);
});

describe("handleCategory() — CREATE: slug without collision, scoped to the business", () => {
  it("generates a slug from the name when the row does not exist yet", async () => {
    localCategoryCreate.mockResolvedValue({ id: "cat-1" });

    await handleCategory(payload(), "CREATE", "business-1");

    expect(localCategoryCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        businessId: "business-1",
        externalId: "ext-cat-1",
        name: "Bebidas",
        slug: "bebidas",
        color: null,
        sourceUpdatedAt: new Date("2026-08-31T12:00:00.000Z"),
      },
      select: { id: true },
    });
  });

  it("two names that slugify to the same base get two different slugs", async () => {
    // The base "bebidas" is already taken in this business.
    localCategoryCount.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === "bebidas" ? 1 : 0,
    );
    localCategoryCreate.mockResolvedValue({ id: "cat-2" });

    await handleCategory(payload({ name: "Bébidas" }), "CREATE", "business-1");

    expect(localCategoryCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ data: expect.objectContaining({ slug: "bebidas-2" }) }),
    );
  });

  it("retries with a fresh candidate after losing a race against a concurrent CREATE", async () => {
    // `count` says the seed is free (no other event has landed yet), but the
    // actual write loses a race against a concurrent event deriving the
    // same candidate — the DB's own unique constraint is what catches it,
    // not this handler's own pre-check.
    localCategoryCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    localCategoryCreate
      .mockRejectedValueOnce(uniqueViolation("slug"))
      .mockResolvedValueOnce({ id: "cat-3" });

    const outcome = await handleCategory(payload(), "CREATE", "business-1");

    expect(outcome.status).toBe("processed");
    expect(localCategoryCreate).toHaveBeenCalledTimes(2);
    expect(localCategoryCreate.mock.calls[0][0].data.slug).toBe("bebidas");
    expect(localCategoryCreate.mock.calls[1][0].data.slug).toBe("bebidas-2");
  });

  it("does not swallow a P2002 that is not about the slug column", async () => {
    localCategoryCreate.mockRejectedValue(uniqueViolation("businessId_externalId"));

    await expect(handleCategory(payload(), "CREATE", "business-1")).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("a category named after a reserved first-level word keeps its literal slug (honorReserved: false)", async () => {
    localCategoryCreate.mockResolvedValue({ id: "cat-4" });

    await handleCategory(payload({ name: "Buscar" }), "CREATE", "business-1");

    // NOT "buscar-tienda": `/tienda/c/buscar` does not compete with
    // `/tienda/buscar` (R11), so `RESERVED_SLUGS` does not apply here.
    expect(localCategoryCreate.mock.calls[0][0].data.slug).toBe("buscar");
  });

  it("a brand-new category with no product yet reports no touched store (R1)", async () => {
    localCategoryCreate.mockResolvedValue({ id: "cat-1" });
    storeFindMany.mockResolvedValue([]);

    const outcome = await handleCategory(payload(), "CREATE", "business-1");

    expect(outcome).toEqual({ status: "processed" });
  });
});

describe("handleCategory() — UPDATE never moves the slug (R8/E7)", () => {
  it("a rename changes only name/color, never slug", async () => {
    localCategoryFindUnique.mockResolvedValue({
      id: "cat-1",
      sourceUpdatedAt: new Date("2026-08-30T00:00:00.000Z"),
    });
    localCategoryUpdate.mockResolvedValue({ id: "cat-1" });

    await handleCategory(payload({ name: "Bebidas y Refrescos" }), "UPDATE", "business-1");

    expect(localCategoryUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: "cat-1" },
      data: {
        name: "Bebidas y Refrescos",
        color: null,
        sourceUpdatedAt: new Date("2026-08-31T12:00:00.000Z"),
      },
      select: { id: true },
    });
    expect(localCategoryCreate).not.toHaveBeenCalled();
  });
});

describe("handleCategory() — the stale-write guard (I8)", () => {
  it("an event whose updatedAt does not move the clock forward is STALE and writes nothing", async () => {
    localCategoryFindUnique.mockResolvedValue({
      id: "cat-1",
      sourceUpdatedAt: new Date("2026-08-31T12:00:00.000Z"), // == payload's updatedAt
    });

    const outcome = await handleCategory(payload(), "UPDATE", "business-1");

    expect(outcome).toEqual({ status: "stale" });
    expect(localCategoryUpdate).not.toHaveBeenCalled();
    expect(localCategoryCreate).not.toHaveBeenCalled();
    expect(storeFindMany).not.toHaveBeenCalled();
  });

  it("a row that predates the migration (sourceUpdatedAt null) accepts the first delivery", async () => {
    localCategoryFindUnique.mockResolvedValue({ id: "cat-1", sourceUpdatedAt: null });
    localCategoryUpdate.mockResolvedValue({ id: "cat-1" });

    const outcome = await handleCategory(payload(), "UPDATE", "business-1");

    expect(outcome.status).not.toBe("stale");
    expect(localCategoryUpdate).toHaveBeenCalledOnce();
  });

  it("a stale DELETE never queries affected stores nor deletes the row", async () => {
    localCategoryFindUnique.mockResolvedValue({
      id: "cat-1",
      sourceUpdatedAt: new Date("2026-08-31T13:00:00.000Z"), // newer than the payload
    });

    const outcome = await handleCategory(payload(), "DELETE", "business-1");

    expect(outcome).toEqual({ status: "stale" });
    expect(localCategoryDelete).not.toHaveBeenCalled();
    expect(storeFindMany).not.toHaveBeenCalled();
  });
});

describe("handleCategory() — DELETE resolves affected stores BEFORE deleting", () => {
  it("queries affected stores before the delete call, and reports their canonical slugs", async () => {
    localCategoryFindUnique.mockResolvedValue({ id: "cat-1", sourceUpdatedAt: null });
    storeFindMany.mockResolvedValue([
      { slug: null, storefront: { slug: "tienda-uno", stores: [{ id: "s1" }] } },
    ]);

    const callOrder: string[] = [];
    storeFindMany.mockImplementation(async () => {
      callOrder.push("findMany");
      return [{ slug: null, storefront: { slug: "tienda-uno", stores: [{ id: "s1" }] } }];
    });
    localCategoryDelete.mockImplementation(async () => {
      callOrder.push("delete");
      return { id: "cat-1" };
    });

    const outcome = await handleCategory(payload(), "DELETE", "business-1");

    expect(callOrder).toEqual(["findMany", "delete"]);
    expect(outcome).toEqual({ status: "processed", touchedStoreSlugs: ["tienda-uno"] });
  });

  it("a DELETE for a category with no product anywhere reports no touched store", async () => {
    localCategoryFindUnique.mockResolvedValue({ id: "cat-1", sourceUpdatedAt: null });
    storeFindMany.mockResolvedValue([]);
    localCategoryDelete.mockResolvedValue({ id: "cat-1" });

    const outcome = await handleCategory(payload(), "DELETE", "business-1");

    expect(outcome).toEqual({ status: "processed" });
  });

  it("a repeated DELETE (already gone) is processed without touching the database again", async () => {
    localCategoryFindUnique.mockResolvedValue(null);

    const outcome = await handleCategory(payload(), "DELETE", "business-1");

    expect(outcome).toEqual({ status: "processed" });
    expect(storeFindMany).not.toHaveBeenCalled();
    expect(localCategoryDelete).not.toHaveBeenCalled();
  });

  it("a multi-branch brand's own branch is reported by its OWN slug, not the brand's", async () => {
    localCategoryFindUnique.mockResolvedValue({ id: "cat-1", sourceUpdatedAt: null });
    storeFindMany.mockResolvedValue([
      {
        slug: "sucursal-centro",
        storefront: { slug: "marca", stores: [{ id: "s1" }, { id: "s2" }] },
      },
    ]);
    localCategoryDelete.mockResolvedValue({ id: "cat-1" });

    const outcome = await handleCategory(payload(), "DELETE", "business-1");

    expect(outcome).toEqual({ status: "processed", touchedStoreSlugs: ["sucursal-centro"] });
  });
});
