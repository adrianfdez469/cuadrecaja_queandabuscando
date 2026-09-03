import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashSyncToken, mintSyncToken } from "@/lib/syncAuth";
import { makeToken } from "@/features/marketplace/server/dbFixtures";
import { resolveCaller } from "./caller";

/**
 * E1, E3, E4, E5, E9, E10, E11, E12 against real Postgres (architecture.md §
 * Pruebas → proyecto `db`) — the `@unique` compare-and-set of R12 cannot be
 * demonstrated with a mock.
 *
 * `vi.mock` here wraps the REAL `mintSyncToken` by default (spread of
 * `importOriginal()`), so every test but the collision one below runs with
 * genuine random tokens; only that one test overrides ONE call to force a
 * hash that already exists.
 */
vi.mock("@/lib/syncAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/syncAuth")>();
  return { ...actual, mintSyncToken: vi.fn(actual.mintSyncToken) };
});

const { provisionCredential } = await import("./provisioning");
const { mintSyncToken: mockedMintSyncToken } = await import("@/lib/syncAuth");

/**
 * Restricción dura de architecture.md § Pruebas: NINGÚN caso de este archivo
 * toca `seed-negocio-1`/`seed-negocio-2` (la base es compartida entre
 * worktrees). Cada `externalId` es propio, prefijado con `makeToken()`
 * (`qab_f015_<hex>`) para que `sweepStaleFixtures()` recoja los restos de una
 * corrida muerta, además del `afterAll` explícito de abajo.
 */
const RUN_TOKEN = makeToken();
let externalIdCounter = 0;
function nextExternalId(label: string): string {
  externalIdCounter += 1;
  return `${RUN_TOKEN}-${label}-${externalIdCounter}`;
}

afterAll(async () => {
  await prisma.business.deleteMany({ where: { externalId: { startsWith: RUN_TOKEN } } });
});

describe("provisionCredential() — E1: alta de un negocio desconocido", () => {
  it("minted, created: true, y queda EXACTAMENTE una fila Business con ese externalId", async () => {
    const externalId = nextExternalId("e1");

    const result = await provisionCredential({ externalId });

    expect(result).toEqual({ status: "minted", created: true, token: expect.any(String) });
    const count = await prisma.business.count({ where: { externalId } });
    expect(count).toBe(1);
  });

  it("la sustancia de E2 sin HTTP: el token acuñado resuelve por resolveCaller — autentica de verdad", async () => {
    const externalId = nextExternalId("e2");

    const result = await provisionCredential({ externalId });
    if (result.status !== "minted") throw new Error("expected minted");

    const resolution = await resolveCaller(hashSyncToken(result.token));
    expect(resolution.status).toBe("ok");
    if (resolution.status === "ok") {
      expect(resolution.caller.externalId).toBe(externalId);
    }
  });
});

describe("provisionCredential() — E3: negocio que existe y no tiene token", () => {
  it("minted, created: false, y no crea NINGUNA fila Business nueva", async () => {
    const externalId = nextExternalId("e3");
    await prisma.business.create({ data: { externalId, name: externalId } });

    const countBefore = await prisma.business.count();
    const result = await provisionCredential({ externalId });
    const countAfter = await prisma.business.count();

    expect(result).toEqual({ status: "minted", created: false, token: expect.any(String) });
    expect(countAfter).toBe(countBefore);
  });
});

describe("provisionCredential() — E4/E5: repetir sobre un negocio que ya tiene token no rota nunca", () => {
  it("already_minted, el syncTokenHash es byte a byte idéntico, y el token original sigue resolviendo", async () => {
    const externalId = nextExternalId("e4");
    const original = mintSyncToken();
    await prisma.business.create({
      data: { externalId, name: externalId, syncTokenHash: original.hash },
    });

    const result = await provisionCredential({ externalId });

    expect(result).toEqual({ status: "already_minted" });
    const row = await prisma.business.findUniqueOrThrow({
      where: { externalId },
      select: { syncTokenHash: true },
    });
    expect(row.syncTokenHash).toBe(original.hash);

    const resolution = await resolveCaller(hashSyncToken(original.token));
    expect(resolution.status).toBe("ok");
  });
});

describe("provisionCredential() — E9: negocio dado de baja", () => {
  it("inactive y NO acuña, con syncTokenHash nulo intacto", async () => {
    const externalId = nextExternalId("e9-null");
    await prisma.business.create({ data: { externalId, name: externalId, active: false } });

    const result = await provisionCredential({ externalId });

    expect(result).toEqual({ status: "inactive" });
    const row = await prisma.business.findUniqueOrThrow({
      where: { externalId },
      select: { syncTokenHash: true, active: true },
    });
    expect(row.syncTokenHash).toBeNull();
    expect(row.active).toBe(false); // esta ruta nunca reactiva
  });

  it("inactive con un token YA poblado: el hash queda exactamente como estaba", async () => {
    const externalId = nextExternalId("e9-hash");
    const existing = mintSyncToken();
    await prisma.business.create({
      data: { externalId, name: externalId, active: false, syncTokenHash: existing.hash },
    });

    const result = await provisionCredential({ externalId });

    expect(result).toEqual({ status: "inactive" });
    const row = await prisma.business.findUniqueOrThrow({
      where: { externalId },
      select: { syncTokenHash: true, active: true },
    });
    expect(row.syncTokenHash).toBe(existing.hash);
    expect(row.active).toBe(false);
  });
});

describe("provisionCredential() — E10: dos altas concurrentes con el mismo externalId desconocido", () => {
  it("queda UN solo Business, ninguna lanza, una es minted y la otra already_minted, y el token de la minted autentica", async () => {
    const externalId = nextExternalId("e10");

    const [a, b] = await Promise.all([
      provisionCredential({ externalId }),
      provisionCredential({ externalId }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["already_minted", "minted"]);

    const count = await prisma.business.count({ where: { externalId } });
    expect(count).toBe(1);

    const winner = a.status === "minted" ? a : b;
    if (winner.status !== "minted") throw new Error("expected exactly one minted result");
    const resolution = await resolveCaller(hashSyncToken(winner.token));
    expect(resolution.status).toBe("ok");
  });
});

describe("provisionCredential() — E11 (criterio 15): dos acuñaciones concurrentes sobre un negocio existente sin token", () => {
  it("exactamente una es minted, y el hash guardado es el de ESA, nunca el de la otra", async () => {
    const externalId = nextExternalId("e11");
    await prisma.business.create({ data: { externalId, name: externalId } });

    const [a, b] = await Promise.all([
      provisionCredential({ externalId }),
      provisionCredential({ externalId }),
    ]);

    const minted = [a, b].filter((r) => r.status === "minted");
    const alreadyMinted = [a, b].filter((r) => r.status === "already_minted");
    expect(minted).toHaveLength(1);
    expect(alreadyMinted).toHaveLength(1);

    const winner = minted[0];
    if (winner.status !== "minted") throw new Error("expected exactly one minted result");
    const row = await prisma.business.findUniqueOrThrow({
      where: { externalId },
      select: { syncTokenHash: true },
    });
    expect(row.syncTokenHash).toBe(hashSyncToken(winner.token));
  });
});

describe("provisionCredential() — E12 (criterio 18): colisión del hash acuñado", () => {
  it("collision y NADA queda escrito — ni siquiera el Business del caso E1", async () => {
    // A real, already-persisted hash to collide against.
    const victimExternalId = nextExternalId("e12-victim");
    const victim = await provisionCredential({ externalId: victimExternalId });
    if (victim.status !== "minted") throw new Error("expected the victim to be minted");
    const collidingHash = hashSyncToken(victim.token);

    vi.mocked(mockedMintSyncToken).mockReturnValueOnce({
      token: "forced-collision-token-value-not-random-but-32+chars",
      hash: collidingHash,
    });

    const externalId = nextExternalId("e12");
    const result = await provisionCredential({ externalId });

    expect(result).toEqual({ status: "collision" });
    const count = await prisma.business.count({ where: { externalId } });
    expect(count).toBe(0);
  });
});
