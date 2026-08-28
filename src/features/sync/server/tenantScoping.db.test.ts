import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashSyncToken, mintSyncToken } from "@/lib/syncAuth";
import {
  createFixtureSession,
  type FixtureSession,
} from "@/features/marketplace/server/dbFixtures";
import { resolveCaller, syncConfigured } from "./caller";
import { applyAvailability } from "./availability";
import { storeReconciliationHash } from "./reconciliation";
import { previewSlug } from "@/features/storefront/server/registry";

/**
 * Two REAL, isolated tenants (F-018, plan.md paso 5; architecture.md §
 * Pruebas: el corte entre mock y Postgres real, regla 2). Everything here
 * needs the `@unique` index and a real `findUnique`/`findFirst` against
 * Postgres — none of it can be demonstrated with a mock.
 */
describe("resolveCaller() / syncConfigured() — E1, E4, E5, E8, E24, E25", () => {
  let sessionA: FixtureSession;
  let sessionB: FixtureSession;

  beforeAll(async () => {
    sessionA = await createFixtureSession();
    sessionB = await createFixtureSession();
  });

  afterAll(async () => {
    await sessionA.cleanup();
    await sessionB.cleanup();
  });

  it("E1: el token de A resuelve la identidad de A, no la de B", async () => {
    const resolution = await resolveCaller(hashSyncToken(sessionA.syncToken));
    expect(resolution).toEqual({
      status: "ok",
      caller: { businessId: sessionA.businessId, externalId: sessionA.businessExternalId },
    });
  });

  it("E4: un token bien formado que no resuelve ningún negocio es unknown, no unconfigured", async () => {
    // Hay negocios con hash configurado (A y B mismos) — la sonda de
    // configuración es true, así que un hash que no cuadra es "unknown".
    expect(await syncConfigured()).toBe(true);
    const resolution = await resolveCaller(hashSyncToken("a-token-nadie-acuñó-nunca"));
    expect(resolution).toEqual({ status: "unknown" });
  });

  it("E5: un negocio con active:false resuelve inactive, no unknown ni ok", async () => {
    await prisma.business.update({ where: { id: sessionA.businessId }, data: { active: false } });
    try {
      const resolution = await resolveCaller(hashSyncToken(sessionA.syncToken));
      expect(resolution).toEqual({ status: "inactive" });
    } finally {
      await prisma.business.update({ where: { id: sessionA.businessId }, data: { active: true } });
    }
  });

  it("E8: Business.syncTokenHash = NULL nunca autentica, ni con el token viejo ni con cadenas vacías", async () => {
    const oldHash = hashSyncToken(sessionA.syncToken);
    await prisma.business.update({
      where: { id: sessionA.businessId },
      data: { syncTokenHash: null },
    });
    try {
      expect(await resolveCaller(oldHash)).toEqual({ status: "unknown" });
      expect(await resolveCaller(hashSyncToken(""))).toEqual({ status: "unknown" });
    } finally {
      // Deja A tal como lo esperan el resto de los tests de este archivo.
      await prisma.business.update({
        where: { id: sessionA.businessId },
        data: { syncTokenHash: oldHash },
      });
    }
  });

  it("Business.syncTokenHash es @unique (I4): dos negocios no pueden compartir hash", async () => {
    const hashOfA = hashSyncToken(sessionA.syncToken);
    await expect(
      prisma.business.update({
        where: { id: sessionB.businessId },
        data: { syncTokenHash: hashOfA },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // B no quedó tocado por el intento fallido.
    const resolution = await resolveCaller(hashSyncToken(sessionB.syncToken));
    expect(resolution).toEqual({
      status: "ok",
      caller: { businessId: sessionB.businessId, externalId: sessionB.businessExternalId },
    });
  });

  it("E24/E25: rotar el token de A no afecta a B — el viejo de A deja de resolver, el nuevo sí, B sigue igual", async () => {
    const oldHash = hashSyncToken(sessionA.syncToken);
    const rotated = mintSyncToken();
    await prisma.business.update({
      where: { id: sessionA.businessId },
      data: { syncTokenHash: rotated.hash },
    });

    try {
      expect(await resolveCaller(oldHash)).toEqual({ status: "unknown" });
      expect(await resolveCaller(rotated.hash)).toEqual({
        status: "ok",
        caller: { businessId: sessionA.businessId, externalId: sessionA.businessExternalId },
      });
      expect(await resolveCaller(hashSyncToken(sessionB.syncToken))).toEqual({
        status: "ok",
        caller: { businessId: sessionB.businessId, externalId: sessionB.businessExternalId },
      });
    } finally {
      await prisma.business.update({
        where: { id: sessionA.businessId },
        data: { syncTokenHash: oldHash },
      });
    }
  });
});

describe("applyAvailability() / storeReconciliationHash() / previewSlug() — E17, E19, E21", () => {
  let sessionA: FixtureSession;
  let sessionB: FixtureSession;
  let storeA: { id: string; externalId: string };
  let storeB: { id: string; externalId: string };

  beforeAll(async () => {
    sessionA = await createFixtureSession();
    sessionB = await createFixtureSession();
    storeA = await sessionA.createStore();
    storeB = await sessionB.createStore();
  });

  afterAll(async () => {
    await sessionA.cleanup();
    await sessionB.cleanup();
  });

  it("E17: un lote de disponibilidad con el negocio de A y un item de la tienda de B no lo confirma ni lo aplica", async () => {
    const canonical = await sessionB.createCanonical({ name: `Producto de B ${sessionB.token}` });
    const offer = await sessionB.createOffer(storeB.id, canonical.id);

    const result = await applyAvailability(sessionA.businessId, [
      { storeProductId: offer.id, storeId: storeB.externalId, availability: "OUT_OF_STOCK" },
    ]);

    expect(result.applied).toBe(0);
    expect(result.confirmed).toEqual([]);

    const untouched = await prisma.storeProduct.findUniqueOrThrow({
      where: { id: offer.id },
      select: { availability: true },
    });
    expect(untouched.availability).toBe("AVAILABLE");
  });

  it("E19: reconciliation con el token de A y el storeId de B responde null, idéntico a uno inexistente", async () => {
    const forOwnBusiness = await storeReconciliationHash(sessionA.businessId, storeB.externalId);
    expect(forOwnBusiness).toBeNull();

    const ownStore = await storeReconciliationHash(sessionA.businessId, storeA.externalId);
    expect(ownStore).not.toBeNull();
  });

  it("E21: previewSlug con el storeExternalId de B pero el businessId de A trata la tienda como desconocida", async () => {
    const result = await previewSlug({
      slug: null,
      name: `slug de prueba ${sessionA.token}`,
      storeExternalId: storeB.externalId,
      businessId: sessionA.businessId,
    });

    expect(result.storeKnown).toBe(false);
    expect(result.reason).not.toBe("own");
  });

  it("previewSlug con el storeExternalId propio de A sí lo reconoce", async () => {
    const result = await previewSlug({
      slug: null,
      name: `slug de prueba ${sessionA.token}`,
      storeExternalId: storeA.externalId,
      businessId: sessionA.businessId,
    });

    expect(result.storeKnown).toBe(true);
  });
});
