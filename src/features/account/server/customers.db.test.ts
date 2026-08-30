import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CustomerUser } from "@/lib/auth/customerSession";
import { ensureCustomerForUser } from "./customers";

/**
 * Against real Postgres (F-015 pattern, vitest.config.mts's `db` project):
 * the property this exercises — "the unique index resolves the race, not
 * application code" — cannot be demonstrated against a mock.
 */

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length === 0) return;
  await prisma.customer.deleteMany({ where: { supabaseUserId: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

function fixtureUser(overrides: Partial<CustomerUser> = {}): CustomerUser {
  const id = randomUUID();
  createdUserIds.push(id);
  return { email: "ana@x.cu", fullName: "Ana Pérez", ...overrides, id };
}

describe("ensureCustomerForUser (R12, E5-E8)", () => {
  it("first login creates exactly one row, seeded from the provider (E5, R9)", async () => {
    const user = fixtureUser();

    await ensureCustomerForUser(user);

    const rows = await prisma.customer.findMany({ where: { supabaseUserId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Ana Pérez");
    expect(rows[0]?.email).toBe("ana@x.cu");
    expect(rows[0]?.phone).toBeNull(); // R9: never from the provider.
  });

  it("a second login with a different full_name does not create a row or touch name (E6, R10)", async () => {
    const user = fixtureUser({ fullName: "Ana Pérez" });
    await ensureCustomerForUser(user);

    await ensureCustomerForUser({ ...user, fullName: "Ana Distinta" });

    const rows = await prisma.customer.findMany({ where: { supabaseUserId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Ana Pérez");
  });

  it("an old row with the same email and a null supabaseUserId is left untouched; a new row is created (E7, R8)", async () => {
    const staleEmail = `stale-${randomUUID()}@x.cu`;
    const stale = await prisma.customer.create({
      data: { email: staleEmail, supabaseUserId: null },
    });

    const user = fixtureUser({ email: staleEmail, fullName: null });
    await ensureCustomerForUser(user);

    const staleRefreshed = await prisma.customer.findUnique({ where: { id: stale.id } });
    expect(staleRefreshed?.supabaseUserId).toBeNull();

    const newRows = await prisma.customer.findMany({ where: { supabaseUserId: user.id } });
    expect(newRows).toHaveLength(1);
    expect(newRows[0]?.id).not.toBe(stale.id);

    await prisma.customer.delete({ where: { id: stale.id } });
  });

  it("two concurrent first logins for the same user.id resolve to exactly one row, neither throwing (E8, R12)", async () => {
    const user = fixtureUser();

    const [a, b] = await Promise.all([ensureCustomerForUser(user), ensureCustomerForUser(user)]);

    expect(a).toEqual(b);
    const count = await prisma.customer.count({ where: { supabaseUserId: user.id } });
    expect(count).toBe(1);
  });
});
