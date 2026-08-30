import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./prismaErrors";

function knownError(code: string, target?: unknown) {
  return { code, meta: target === undefined ? undefined : { target } };
}

describe("isUniqueViolation()", () => {
  it("recognizes a P2002 with a string target, exact match only", () => {
    expect(isUniqueViolation(knownError("P2002", "Order_code_key"), "code")).toBe(false);
    expect(isUniqueViolation(knownError("P2002", "code"), "code")).toBe(true);
  });

  it("recognizes a P2002 with an array target (Postgres connector shape)", () => {
    expect(
      isUniqueViolation(knownError("P2002", ["storeId", "idempotencyKey"]), "idempotencyKey"),
    ).toBe(true);
    expect(isUniqueViolation(knownError("P2002", ["code"]), "idempotencyKey")).toBe(false);
  });

  it("recognizes the driver-adapter shape (Prisma 7 + @prisma/adapter-pg, no top-level meta.target)", () => {
    const driverAdapterError = {
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: { constraint: { fields: ['"supabaseUserId"'] } },
        },
      },
    };
    expect(isUniqueViolation(driverAdapterError, "supabaseUserId")).toBe(true);
    expect(isUniqueViolation(driverAdapterError, "code")).toBe(false);
  });

  it("rejects a different error code", () => {
    expect(isUniqueViolation(knownError("P2025", "code"), "code")).toBe(false);
  });

  it("rejects anything that is not Prisma-error-shaped", () => {
    expect(isUniqueViolation(new Error("boom"), "code")).toBe(false);
    expect(isUniqueViolation(null, "code")).toBe(false);
    expect(isUniqueViolation("nope", "code")).toBe(false);
    expect(isUniqueViolation(undefined, "code")).toBe(false);
  });

  it("handles a missing meta gracefully", () => {
    expect(isUniqueViolation({ code: "P2002" }, "code")).toBe(false);
  });
});
