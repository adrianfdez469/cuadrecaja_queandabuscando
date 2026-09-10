// F-040 — fixture de la "tienda muda" para `smoke.sh` y para el conteo
// manual de consultas del criterio 6.
//
// No usa `createFixtureSession` (`src/features/marketplace/server/dbFixtures.ts`):
// esa maquinaria no deja fijar `Business.baseCurrencyCode` ni crea la fila
// `Slug` que la resolución pública necesita (ver `createOrder.zone.db.test.ts`
// para el mismo hallazgo). Reescribe el mismo patrón — un negocio por
// escenario, IDs con un prefijo propio, limpieza explícita — directamente con
// Prisma, sin tocar ningún dato de `prisma/seed.ts`.
//
// Uso:
//   npx tsx .agent/specs/F-040/seed-muted-store.ts up   [sufijo]   # crea, imprime JSON
//   npx tsx .agent/specs/F-040/seed-muted-store.ts down <sufijo>   # borra todo lo creado
//
// El sufijo por defecto es `Date.now()`. `smoke.sh` lo captura del JSON de
// salida y lo reutiliza para `down`, así dos corridas concurrentes (dos
// worktrees contra el mismo Postgres compartido, AGENTS.md § Cosas que
// muerden) nunca colisionan.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../src/generated/prisma/client";
import {
  Availability,
  CheckoutMode,
  DeliveryFeeMode,
  StoreStatus,
  ZoneTariffRule,
} from "../../../src/generated/prisma/enums";
import { mintSyncToken } from "../../../src/lib/syncAuth";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set — see .env.example");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3 }) });

const PREFIX = "f040-smoke";

type Ids = {
  suffix: string;
  businessMudaId: string;
  /** F-040 (visual.mjs, paso 6/E14): externalId + token en claro del negocio
   *  mudo — el único que necesita autenticar un evento de sync para sembrar
   *  la tasa que le falta y disparar la invalidación real de R10. */
  businessMudaExternalId: string;
  businessMudaSyncToken: string;
  businessOtrosId: string;
  mudaBase: { slug: string; storeId: string; productSlugs: string[]; categorySlug: string };
  mudaE16: { slug: string; storeId: string };
  parcial: { slug: string; storeId: string };
  vacia: { slug: string; storeId: string };
};

async function createStorefrontWithSlug(
  businessId: string,
  name: string,
  slug: string,
  themeTokens?: Record<string, string>,
) {
  const storefront = await prisma.storefront.create({
    data: { businessId, name, slug, ...(themeTokens ? { themeTokens } : {}) },
    select: { id: true },
  });
  // La resolución pública (`resolvePublicSlug`) lee la tabla `Slug`, nunca
  // `Storefront.slug` directamente — el mismo hallazgo que documenta
  // `createOrder.zone.db.test.ts`. `kind: "STOREFRONT"` es la forma que
  // `prisma/seed.ts::seedStorefront` usa para una marca de una sola
  // sucursal: `canonicalSlug()` (`src/lib/publicSlug.ts`) resuelve esa marca
  // directamente al slug pedido, sin alias y sin redirect.
  await prisma.slug.create({
    data: { value: slug, kind: "STOREFRONT", storefrontId: storefront.id },
  });
  return storefront.id;
}

async function createPublishedStore(opts: {
  businessId: string;
  storefrontId: string;
  externalId: string;
  name: string;
  zoneBased?: boolean;
}) {
  const store = await prisma.store.create({
    data: {
      businessId: opts.businessId,
      storefrontId: opts.storefrontId,
      externalId: opts.externalId,
      name: opts.name,
      status: StoreStatus.PUBLISHED,
      publishedAt: new Date(),
      checkoutMode: CheckoutMode.WHATSAPP,
      whatsapp: "+5350000000",
      city: "La Habana",
      address: "Dirección de prueba F-040",
      ...(opts.zoneBased
        ? { deliveryEnabled: true, deliveryFeeMode: DeliveryFeeMode.ZONE_BASED }
        : {}),
    },
    select: { id: true },
  });
  return store.id;
}

async function createCanonicalAndOffer(opts: {
  storeId: string;
  suffix: string;
  salt: number;
  name: string;
  currency: string;
  localCategoryId?: string | null;
}) {
  const ean =
    `9${String(opts.salt).padStart(3, "0")}${opts.suffix.slice(-8).padStart(8, "0")}`.slice(0, 13);
  const canonical = await prisma.canonicalProduct.create({
    data: { ean, name: opts.name, isExclusive: false },
    select: { id: true },
  });
  const suffixTag = `${PREFIX}-${opts.suffix}-${opts.salt}`;
  const offer = await prisma.storeProduct.create({
    data: {
      storeId: opts.storeId,
      canonicalProductId: canonical.id,
      externalId: suffixTag,
      slug: suffixTag,
      localName: opts.name,
      syncedPrice: "100.00",
      syncedPriceCurrency: opts.currency,
      availability: Availability.AVAILABLE,
      visible: true,
      localCategoryId: opts.localCategoryId ?? null,
      sourceUpdatedAt: new Date(),
    },
    select: { id: true, slug: true },
  });
  return { canonicalId: canonical.id, offerId: offer.id, slug: offer.slug };
}

async function up(suffix: string): Promise<Ids> {
  // ---- Negocio A: base XXX (bien formada, ficticia), sin ExchangeRate
  // propia — E1, criterio 1 literal. ZONE_BASED con un tarifario real para
  // que el criterio 5 ejercite también la cuota de domicilio (R13/I3).
  // `syncTokenHash` con el MISMO minter que usa el guardia real
  // (`src/lib/syncAuth.ts::mintSyncToken`, el mismo que `dbFixtures.ts`),
  // para que `visual.mjs` (paso 6/E14) pueda mandar un `EXCHANGE_RATE` real
  // por `/api/internal/sync/catalog` y disparar la invalidación de R10 tal
  // cual la dispara un evento del POS — no un `revalidateTag` de mentira.
  const { token: businessMudaSyncToken, hash: businessMudaSyncTokenHash } = mintSyncToken();
  const businessMuda = await prisma.business.create({
    data: {
      externalId: `${PREFIX}-biz-muda-${suffix}`,
      name: `F-040 smoke negocio mudo ${suffix}`,
      baseCurrencyCode: "XXX",
      syncTokenHash: businessMudaSyncTokenHash,
    },
    select: { id: true },
  });
  const mudaBaseSlug = `${PREFIX}-muda-base-${suffix}`;
  // F-040 (visual.mjs, paso 3): marca propia distinta de la paleta por
  // defecto, para comprobar que la cabecera/el botón de WhatsApp la usan y
  // que el aviso de cierre NO se recolorea (tono `warning` del sistema).
  const mudaBaseStorefrontId = await createStorefrontWithSlug(
    businessMuda.id,
    `F-040 muda base ${suffix}`,
    mudaBaseSlug,
    { brand: "oklch(0.55 0.2 250)", accent: "oklch(0.7 0.16 25)", radius: "round" },
  );
  const mudaBaseStoreId = await createPublishedStore({
    businessId: businessMuda.id,
    storefrontId: mudaBaseStorefrontId,
    externalId: `${PREFIX}-store-muda-base-${suffix}`,
    name: `F-040 muda base ${suffix}`,
    zoneBased: true,
  });
  await prisma.zoneTariff.create({
    data: {
      storeId: mudaBaseStoreId,
      zoneCode: "23.01",
      rule: ZoneTariffRule.FEE,
      deliveryFee: "50.00",
      sourceUpdatedAt: new Date(),
    },
  });
  const categorySlug = `${PREFIX}-categoria-${suffix}`;
  const category = await prisma.localCategory.create({
    data: {
      businessId: businessMuda.id,
      externalId: `${PREFIX}-cat-${suffix}`,
      name: `F-040 categoría ${suffix}`,
      slug: categorySlug,
    },
    select: { id: true },
  });
  const productSlugs: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { slug } = await createCanonicalAndOffer({
      storeId: mudaBaseStoreId,
      suffix,
      salt: 100 + i,
      name: `F-040 producto muda base ${suffix}-${i}`,
      currency: "CUP",
      localCategoryId: i === 0 ? category.id : null,
    });
    productSlugs.push(slug);
  }

  // ---- Negocio B: base CUP (por defecto), con tres sucursales — E16
  // (criterio 1, variante), parcial (criterio 2) y vacía (criterio 3).
  const businessOtros = await prisma.business.create({
    data: { externalId: `${PREFIX}-biz-otros-${suffix}`, name: `F-040 smoke negocio B ${suffix}` },
    select: { id: true },
  });

  const mudaE16Slug = `${PREFIX}-muda-e16-${suffix}`;
  const mudaE16StorefrontId = await createStorefrontWithSlug(
    businessOtros.id,
    `F-040 muda E16 ${suffix}`,
    mudaE16Slug,
  );
  const mudaE16StoreId = await createPublishedStore({
    businessId: businessOtros.id,
    storefrontId: mudaE16StorefrontId,
    externalId: `${PREFIX}-store-muda-e16-${suffix}`,
    name: `F-040 muda E16 ${suffix}`,
  });
  for (let i = 0; i < 3; i++) {
    await createCanonicalAndOffer({
      storeId: mudaE16StoreId,
      suffix,
      salt: 200 + i,
      name: `F-040 producto muda e16 ${suffix}-${i}`,
      currency: "EUR", // sin ExchangeRate para businessOtros: E16.
    });
  }

  const parcialSlug = `${PREFIX}-parcial-${suffix}`;
  const parcialStorefrontId = await createStorefrontWithSlug(
    businessOtros.id,
    `F-040 parcial ${suffix}`,
    parcialSlug,
  );
  const parcialStoreId = await createPublishedStore({
    businessId: businessOtros.id,
    storefrontId: parcialStorefrontId,
    externalId: `${PREFIX}-store-parcial-${suffix}`,
    name: `F-040 parcial ${suffix}`,
  });
  await createCanonicalAndOffer({
    storeId: parcialStoreId,
    suffix,
    salt: 300,
    name: `F-040 producto parcial resuelve 1 ${suffix}`,
    currency: "CUP",
  });
  await createCanonicalAndOffer({
    storeId: parcialStoreId,
    suffix,
    salt: 301,
    name: `F-040 producto parcial resuelve 2 ${suffix}`,
    currency: "CUP",
  });
  await createCanonicalAndOffer({
    storeId: parcialStoreId,
    suffix,
    salt: 302,
    name: `F-040 producto parcial sin precio ${suffix}`,
    currency: "EUR", // sin ExchangeRate para businessOtros.
  });

  const vaciaSlug = `${PREFIX}-vacia-${suffix}`;
  const vaciaStorefrontId = await createStorefrontWithSlug(
    businessOtros.id,
    `F-040 vacía ${suffix}`,
    vaciaSlug,
  );
  const vaciaStoreId = await createPublishedStore({
    businessId: businessOtros.id,
    storefrontId: vaciaStorefrontId,
    externalId: `${PREFIX}-store-vacia-${suffix}`,
    name: `F-040 vacía ${suffix}`,
  });

  return {
    suffix,
    businessMudaId: businessMuda.id,
    businessMudaExternalId: `${PREFIX}-biz-muda-${suffix}`,
    businessMudaSyncToken,
    businessOtrosId: businessOtros.id,
    mudaBase: { slug: mudaBaseSlug, storeId: mudaBaseStoreId, productSlugs, categorySlug },
    mudaE16: { slug: mudaE16Slug, storeId: mudaE16StoreId },
    parcial: { slug: parcialSlug, storeId: parcialStoreId },
    vacia: { slug: vaciaSlug, storeId: vaciaStoreId },
  };
}

async function down(suffix: string): Promise<void> {
  const businesses = await prisma.business.findMany({
    where: { externalId: { contains: `${PREFIX}-biz-`, endsWith: `-${suffix}` } },
    select: { id: true },
  });
  const businessIds = businesses.map((b) => b.id);
  if (businessIds.length === 0) return;

  const stores = await prisma.store.findMany({
    where: { businessId: { in: businessIds } },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  if (storeIds.length > 0) {
    // Order antes que Store: la FK es RESTRICT (mismo orden que
    // `dbFixtures.ts::cleanup`).
    await prisma.order.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.zoneTariff.deleteMany({ where: { storeId: { in: storeIds } } });
    const offers = await prisma.storeProduct.findMany({
      where: { storeId: { in: storeIds } },
      select: { id: true, canonicalProductId: true },
    });
    const canonicalIds = [...new Set(offers.map((o) => o.canonicalProductId))];
    await prisma.storeProduct.deleteMany({ where: { storeId: { in: storeIds } } });
    if (canonicalIds.length > 0) {
      await prisma.canonicalProduct.deleteMany({ where: { id: { in: canonicalIds } } });
    }
  }
  await prisma.localCategory.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.slug.deleteMany({
    where: { value: { contains: `${PREFIX}-`, endsWith: `-${suffix}` } },
  });
  if (storeIds.length > 0) {
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }
  await prisma.storefront.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
}

async function main() {
  const [, , mode, arg] = process.argv;
  if (mode === "up") {
    const suffix = arg ?? String(Date.now());
    const ids = await up(suffix);
    console.log(JSON.stringify(ids));
  } else if (mode === "down") {
    if (!arg) throw new Error("down requiere el sufijo devuelto por up");
    await down(arg);
    console.log(JSON.stringify({ ok: true }));
  } else {
    throw new Error("Uso: seed-muted-store.ts up [sufijo] | down <sufijo>");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
