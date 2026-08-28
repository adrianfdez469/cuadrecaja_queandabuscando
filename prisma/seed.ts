// Loaded explicitly: `tsx prisma/seed.ts` does not go through prisma.config.ts.
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { buildSearchDocument, normalizeBarcodes } from "../src/lib/canonical";
import { RESERVED_SLUGS, slugify } from "../src/lib/slug";
import { writeSearchDocument } from "../src/features/marketplace/server/searchVector";
import { reindexStoreProduct } from "../src/features/catalog/server/searchIndex";
import {
  countCanonicalBarcodes,
  recordCanonicalBarcodes,
} from "../src/features/sync/server/canonicalBarcodes";
import { mintSyncToken } from "../src/lib/syncAuth";
import { detectImageMime, extensionForMime, isAllowedImageMime } from "../src/lib/imageType";
import { encodeImageVariants } from "../src/lib/imageEncoder";
import { publicUrlFor, storageAvailability, uploadStoreObjects } from "../src/lib/supabase/storage";
import { IMAGE_ORIGINAL_BASENAME } from "../src/constants/media";

/**
 * Development seed.
 *
 * Two stores belonging to one business, with deliberately different palettes —
 * that is what makes per-tenant theming verifiable by eye. Products are shared
 * at the canonical level between them where the barcode matches, which
 * exercises the identity resolution the sync depends on.
 *
 * Idempotent: safe to run repeatedly.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set — see .env.example");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const now = new Date();

const CURRENCIES = [
  { code: "CUP", name: "Peso cubano", symbol: "$" },
  { code: "USD", name: "Dólar estadounidense", symbol: "US$" },
  { code: "MLC", name: "Moneda libremente convertible", symbol: "MLC" },
];

/** rate = CUP per 1 unit. CUP is the anchor and never gets a row. */
const RATES = [
  { currencyCode: "USD", rate: "440.000000" },
  { currencyCode: "MLC", rate: "210.500000" },
];

type SeedProduct = {
  name: string;
  ean?: string;
  /** F-024: extra barcodes the same physical product also carries, beyond
   *  `ean` (still the fusion key — never turned into an `eans: string[]`,
   *  which would force twenty fixtures to pick which entry is the key and
   *  could move a canonical C9 requires invariant). Recorded through the
   *  same writer the sync uses (`recordCanonicalBarcodes`), never a bespoke
   *  `createMany`. */
  extraEans?: readonly string[];
  category: string;
  price: string;
  currency: string;
  availability: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK";
  description?: string;
  featured?: boolean;
  priceOverride?: string;
};

const CATEGORIES = ["Bebidas", "Alimentos", "Aseo", "Panadería"];

/**
 * F-021 (spec.md SP3, architecture.md § "El delta del seed"): a minimal
 * global taxonomy that mirrors the four local categories the seed already
 * creates, one-to-one by name/slug. Nothing here is a production
 * classification pipeline — this exists ONLY so the third search layer
 * (category expansion) has data in development, and so criterion 2 is
 * verifiable. `LocalCategory.globalCategoryId` gets filled from this same
 * list too, which is what turns R17's cascade into three usable steps
 * without a second seed to maintain.
 */
const GLOBAL_CATEGORIES = CATEGORIES;

const DEMO_PRODUCTS: SeedProduct[] = [
  {
    name: "Refresco de cola 1.5 L",
    ean: "7501031311309",
    // F-024 (architecture.md § Qué cambia en los datos sembrados): the demo
    // product with three codes, so criterio 6's histogram has a hole at 3
    // without moving the canonical/StoreProduct counts C4/C9 require
    // invariant — these two never collide with any other `ean` in this file.
    extraEans: ["7501031318888", "7501031319999"],
    category: "Bebidas",
    price: "450",
    currency: "CUP",
    availability: "AVAILABLE",
    featured: true,
    description: "Botella de 1.5 litros, bien fría.",
  },
  {
    name: "Agua natural 500 ml",
    ean: "7501055300150",
    category: "Bebidas",
    price: "120",
    currency: "CUP",
    availability: "AVAILABLE",
  },
  {
    name: "Cerveza Cristal",
    ean: "7501234567890",
    category: "Bebidas",
    price: "1.20",
    currency: "USD",
    availability: "LOW_STOCK",
    description: "Precio en divisa.",
  },
  {
    name: "Jugo de mango 1 L",
    category: "Bebidas",
    price: "380",
    currency: "CUP",
    availability: "OUT_OF_STOCK",
  },
  {
    name: "Arroz blanco 1 kg",
    ean: "7501000110018",
    category: "Alimentos",
    price: "620",
    currency: "CUP",
    availability: "AVAILABLE",
    featured: true,
  },
  {
    name: "Frijol negro 1 kg",
    ean: "7501000110025",
    category: "Alimentos",
    price: "780",
    currency: "CUP",
    availability: "LOW_STOCK",
  },
  {
    name: "Aceite de girasol 900 ml",
    category: "Alimentos",
    price: "1250",
    currency: "CUP",
    availability: "AVAILABLE",
    priceOverride: "1150",
  },
  {
    name: "Pasta corta 500 g",
    category: "Alimentos",
    price: "410",
    currency: "CUP",
    availability: "AVAILABLE",
  },
  {
    name: "Leche en polvo 400 g",
    ean: "7501000110032",
    category: "Alimentos",
    price: "3.50",
    currency: "MLC",
    availability: "LOW_STOCK",
  },
  {
    name: "Jabón de baño",
    ean: "7501000220017",
    category: "Aseo",
    price: "230",
    currency: "CUP",
    availability: "AVAILABLE",
  },
  {
    name: "Detergente líquido 1 L",
    category: "Aseo",
    price: "890",
    currency: "CUP",
    availability: "AVAILABLE",
  },
  {
    name: "Papel sanitario x4",
    ean: "7501000220024",
    category: "Aseo",
    price: "540",
    currency: "CUP",
    availability: "OUT_OF_STOCK",
  },
  {
    name: "Pan suave",
    category: "Panadería",
    price: "90",
    currency: "CUP",
    availability: "AVAILABLE",
    featured: true,
  },
  {
    name: "Pan de molde",
    category: "Panadería",
    price: "350",
    currency: "CUP",
    availability: "LOW_STOCK",
  },
  {
    name: "Galletas de sal",
    ean: "7501000330011",
    category: "Panadería",
    price: "260",
    currency: "CUP",
    availability: "AVAILABLE",
  },
];

const SECOND_STORE_PRODUCTS: SeedProduct[] = [
  // Same barcodes on purpose: these must resolve to the SAME canonical product,
  // which is what makes a marketplace listing possible later.
  {
    name: "Coca-Cola 1.5L",
    ean: "7501031311309",
    category: "Bebidas",
    price: "470",
    currency: "CUP",
    availability: "AVAILABLE",
    featured: true,
  },
  {
    name: "Arroz 1 kg",
    ean: "7501000110018",
    category: "Alimentos",
    price: "600",
    currency: "CUP",
    availability: "AVAILABLE",
  },
  {
    name: "Jabón",
    ean: "7501000220017",
    category: "Aseo",
    price: "245",
    currency: "CUP",
    availability: "LOW_STOCK",
  },
  {
    name: "Café molido 250 g",
    category: "Alimentos",
    price: "1400",
    currency: "CUP",
    availability: "AVAILABLE",
    featured: true,
  },
  {
    name: "Chocolate en barra",
    category: "Alimentos",
    price: "2.00",
    currency: "USD",
    availability: "OUT_OF_STOCK",
  },
];

/**
 * F-018 (E26, C1): a second, fully independent business — its own store,
 * its own products, its own token. Ids and slug deliberately new
 * (`seed-negocio-2`, `seed-tienda-7`) so this fixture never crosses the one
 * F-004/F-010/F-011/F-017 already read (risk table, plan.md).
 */
const OTHER_BUSINESS_PRODUCTS: SeedProduct[] = [
  {
    name: "Miel de abeja 250 g",
    category: "Otro negocio",
    price: "890",
    currency: "CUP",
    availability: "AVAILABLE",
    featured: true,
  },
  {
    name: "Vinagre de manzana 500 ml",
    category: "Otro negocio",
    price: "410",
    currency: "CUP",
    availability: "AVAILABLE",
  },
];

async function main() {
  console.log("Seeding…");

  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      create: currency,
      update: currency,
    });
  }

  // F-017/R12: every reserved word gets its own row before anything else,
  // so a slug that would collide fails at the same primary key a live
  // collision would. `skipDuplicates` keeps this idempotent without a
  // read-then-write race.
  await prisma.slug.createMany({
    data: RESERVED_SLUGS.map((value) => ({ value, kind: "RESERVED" as const })),
    skipDuplicates: true,
  });

  const business = await prisma.business.upsert({
    where: { externalId: "seed-negocio-1" },
    create: {
      externalId: "seed-negocio-1",
      name: "Distribuidora La Rampa",
      baseCurrencyCode: "CUP",
    },
    update: {},
  });

  for (const rate of RATES) {
    const exists = await prisma.exchangeRate.findFirst({
      where: { businessId: business.id, currencyCode: rate.currencyCode },
    });
    if (!exists) {
      await prisma.exchangeRate.create({ data: { businessId: business.id, ...rate } });
    }
  }

  // F-021 (SP3): one GlobalCategory per name in GLOBAL_CATEGORIES, upserted
  // by `slug` (already `@unique`) BEFORE the LocalCategory loop below, so
  // each local row can be created with its `globalCategoryId` already
  // filled — R17's cascade needs both to exist from the very first seed.
  const globalCategories = new Map<string, string>();
  for (const name of GLOBAL_CATEGORIES) {
    const globalCategory = await prisma.globalCategory.upsert({
      where: { slug: slugify(name) },
      create: { slug: slugify(name), name },
      update: { name },
    });
    globalCategories.set(name, globalCategory.id);
  }

  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    // F-021: rellena LocalCategory.globalCategoryId desde la misma lista —
    // no lo lee la consulta de F-021 (R17 solo mira el canónico), pero deja
    // la taxonomía coherente para el día que exista un escalón intermedio.
    const globalCategoryId = globalCategories.get(name) ?? null;
    const category = await prisma.localCategory.upsert({
      where: {
        businessId_externalId: { businessId: business.id, externalId: `seed-cat-${slugify(name)}` },
      },
      create: {
        businessId: business.id,
        externalId: `seed-cat-${slugify(name)}`,
        name,
        slug: slugify(name),
        globalCategoryId,
      },
      update: { name, globalCategoryId },
    });
    categories.set(name, category.id);
  }

  await seedStore({
    businessId: business.id,
    externalId: "seed-tienda-1",
    slug: "tienda-demo",
    name: "La Rampa · Vedado",
    description: "Todo para la casa, a dos cuadras de 23 y L.",
    city: "La Habana",
    address: "Calle 23 esq. L, Vedado",
    whatsapp: "+5350000001",
    // Default palette — no overrides.
    themeTokens: null,
    // F-010 fixture (I4): checkout by WhatsApp, no delivery — E8, E18 with link.
    checkoutMode: "WHATSAPP",
    deliveryEnabled: false,
    deliveryFee: null,
    products: DEMO_PRODUCTS,
    categories,
    globalCategories,
  });

  // F-023 (I5, criterio 3): the ONLY store whose products get a real image —
  // exactly the 15 of `tienda-demo`, the catalog the 300 KB budget's own
  // arithmetic (300 KB ÷ 15 ≈ 20 KB/variante) is written against.
  await seedProductImages("seed-tienda-1");

  await seedStore({
    businessId: business.id,
    externalId: "seed-tienda-2",
    slug: "tienda-dos",
    name: "La Rampa · Playa",
    description: "Sucursal de Playa. Entregas en toda la zona.",
    city: "La Habana",
    address: "Ave. 31 e/ 42 y 44, Playa",
    whatsapp: "+5350000002",
    // A visibly different brand, to prove per-tenant theming works.
    themeTokens: { brand: "oklch(0.62 0.17 145)", accent: "oklch(0.7 0.16 25)", radius: "round" },
    // F-010 fixture (I4): checkout on-site with a flat delivery fee — E9, E18
    // with no link.
    checkoutMode: "ONSITE",
    deliveryEnabled: true,
    deliveryFee: "500",
    products: SECOND_STORE_PRODUCTS,
    categories,
    globalCategories,
  });

  // HD12/F-011 fixture: a third store, deliberately never opened to the
  // public. It is the "tienda ajena" 403 fixture (I7) that does not depend
  // on scripts/mint-sso-token.mjs's --stores= flag, and it is what makes
  // HD11's closed page verifiable right after `npm run seed`, with no
  // endpoint call. Not in the SSO token, and not a store any other feature
  // (F-004/F-005/F-006/F-010) reads.
  await seedClosedStore({
    businessId: business.id,
    externalId: "seed-tienda-3",
    slug: "tienda-cerrada",
    name: "La Rampa · Marianao",
    city: "La Habana",
    address: "Calle 100, Marianao",
  });

  // F-017 (criterio 3, E2, E21): the ONLY fixture whose branch keeps a live
  // `Store.slug` of its own (kind `STORE` in the registry) — without it,
  // the "resolve by branch alias, canonical = brand slug" path is a branch
  // nobody's data ever exercises. `ownSlug` here is what a `Store.slug`
  // looked like before this feature moved it to the brand.
  await seedStore({
    businessId: business.id,
    externalId: "seed-tienda-4",
    slug: "bodega-central",
    ownSlug: "bodega-central-vedado",
    name: "Bodega Central · Vedado",
    description: "La bodega de siempre, ahora con marca propia.",
    city: "La Habana",
    address: "Calle 21, Vedado",
    whatsapp: "+5350000004",
    themeTokens: null,
    checkoutMode: "WHATSAPP",
    deliveryEnabled: false,
    deliveryFee: null,
    products: [DEMO_PRODUCTS[0], DEMO_PRODUCTS[1]],
    categories,
    globalCategories,
  });

  // F-017 (criterios 2 y 6, etapa 2): dos tiendas de un solo uso, del mismo
  // negocio, dedicadas a agrupar. NO se leen desde ningún otro feature —
  // agrupar `tienda-demo` con `tienda-dos` rompería el criterio 3 de F-004,
  // el smoke.sh de F-010 y `check:bundle` (architecture.md § prisma/seed.ts).
  // La etapa 1 solo las siembra como marcas de una sucursal cada una; la
  // acción de agrupar (etapa 2, sin construir aquí) es lo que las junta.
  await seedStore({
    businessId: business.id,
    externalId: "seed-tienda-5",
    slug: "bodega-uno",
    name: "Bodega Uno",
    description: "Fixture de un solo uso para agrupar (etapa 2).",
    city: "La Habana",
    address: "Calle 5, Vedado",
    whatsapp: "+5350000005",
    themeTokens: null,
    checkoutMode: "WHATSAPP",
    deliveryEnabled: false,
    deliveryFee: null,
    products: [DEMO_PRODUCTS[0], DEMO_PRODUCTS[4]],
    categories,
    globalCategories,
  });

  await seedStore({
    businessId: business.id,
    externalId: "seed-tienda-6",
    slug: "bodega-dos",
    name: "Bodega Dos",
    description: "Fixture de un solo uso para agrupar (etapa 2).",
    city: "La Habana",
    address: "Calle 7, Vedado",
    whatsapp: "+5350000006",
    themeTokens: null,
    checkoutMode: "WHATSAPP",
    deliveryEnabled: false,
    deliveryFee: null,
    products: [DEMO_PRODUCTS[2], DEMO_PRODUCTS[5]],
    categories,
    globalCategories,
  });

  // F-011 tanda 3 (HD18): a brand of THREE branches, sembrada YA agrupada —
  // agrupar no tiene vuelta (ADR 0018 (f)) y el sensor tiene que poder correr
  // dos veces seguidas. De un solo uso: ningún otro feature lee `el-trebol*`,
  // y NO toca `seedStore`/`seedClosedStore` ni `bodega-uno`/`bodega-dos`
  // (fixtures de agrupar de F-017, que verifican otra cosa). `themeTokens`
  // se siembra `null` a propósito: `seedStorefront()` solo escribe branding
  // cuando le llega algo truthy, así que un `npm run seed` posterior NO pisa
  // lo que el sensor de branding acaba de guardar — es lo que deja correr
  // `.agent/specs/F-011/smoke.sh` dos veces seguidas sin resembrar.
  await seedBrandWithBranches({
    businessId: business.id,
    brandSlug: "el-trebol",
    name: "El Trébol",
    branches: [
      {
        externalId: "seed-tienda-8",
        ownSlug: "el-trebol-centro",
        status: "PUBLISHED",
        name: "El Trébol · Centro Habana",
        city: "La Habana",
      },
      {
        externalId: "seed-tienda-9",
        ownSlug: "el-trebol-playa",
        status: "SUSPENDED",
        name: "El Trébol · Playa",
        city: "La Habana",
        disabledReasonCode: "VACACIONES",
        disabledMessage: "Volvemos en septiembre.",
      },
      {
        externalId: "seed-tienda-10",
        ownSlug: null,
        status: "DRAFT",
        name: "El Trébol · Almacén",
        city: "La Habana",
      },
    ],
  });

  // F-018 (E26, C1, C7): a second business, fully independent — what makes
  // "the pull of A never sees B's orders" verifiable against real seeded
  // data, not only against the `db` project's own fixtures.
  const otherBusiness = await prisma.business.upsert({
    where: { externalId: "seed-negocio-2" },
    create: {
      externalId: "seed-negocio-2",
      name: "Colmado El Faro",
      baseCurrencyCode: "CUP",
    },
    update: {},
  });

  const otherCategoryName = "Otro negocio";
  const otherCategory = await prisma.localCategory.upsert({
    where: {
      businessId_externalId: {
        businessId: otherBusiness.id,
        externalId: `seed-cat-${slugify(otherCategoryName)}`,
      },
    },
    create: {
      businessId: otherBusiness.id,
      externalId: `seed-cat-${slugify(otherCategoryName)}`,
      name: otherCategoryName,
      slug: slugify(otherCategoryName),
    },
    update: { name: otherCategoryName },
  });
  const otherCategories = new Map([[otherCategoryName, otherCategory.id]]);

  await seedStore({
    businessId: otherBusiness.id,
    externalId: "seed-tienda-7",
    slug: "el-faro",
    name: "Colmado El Faro",
    description: "Un negocio totalmente distinto, para probar el aislamiento por token.",
    city: "Santiago de Cuba",
    address: "Calle Enramada, Santiago de Cuba",
    whatsapp: "+5350000007",
    themeTokens: null,
    checkoutMode: "WHATSAPP",
    deliveryEnabled: false,
    deliveryFee: null,
    products: OTHER_BUSINESS_PRODUCTS,
    categories: otherCategories,
    // GlobalCategory is a platform-wide taxonomy (no businessId column), so
    // the SAME map from the first business is reused here — "Otro negocio"
    // just never matches any of its four names, and stays uncategorised
    // globally, same as any orphan canonical would in production.
    globalCategories,
  });

  // HD4/E23/E26/E27: acuña solo si el negocio todavía no tiene hash, para
  // que `npm run seed && npm run seed` (el CI siembra dos veces) no rote el
  // token que el desarrollador ya guardó (C15).
  await ensureSyncToken(business);
  await ensureSyncToken(otherBusiness);

  const counts = {
    stores: await prisma.store.count(),
    storefronts: await prisma.storefront.count(),
    canonical: await prisma.canonicalProduct.count(),
    aliases: await prisma.productAlias.count(),
    products: await prisma.storeProduct.count(),
    barcodes: await countCanonicalBarcodes(prisma),
  };
  console.log("Done:", counts);
}

/**
 * F-017: the SINGLE place the seed creates a brand. Idempotent by
 * `Storefront.slug` (unique). The branding that used to live on `Store`
 * (`themeTokens`, `logoUrl`, `coverUrl`) now lives here.
 *
 * On `update` this only ever touches `name`/branding — never `slug` — so
 * re-running the seed cannot move a brand's URL out from under a QR that
 * might already be printed against it.
 *
 * Etapa 2: after "agrupar" (`groupStoreIntoBrand`), a fixture like
 * `bodega-dos` no longer OWNS a `Storefront` at all — its brand slug was
 * reassigned to the branch itself (kind `STOREFRONT` → `STORE`) and the
 * emptied `Storefront` row was deleted (architecture.md § Qué les pasa a
 * los slugs). Re-running the seed after that must not try to CREATE a new
 * `Storefront` under that slug: the `Slug` row already exists with a
 * DIFFERENT owner, and `slugEntry: { create: … } }` would collide with its
 * primary key. So: no `Storefront` AND the slug already belongs to a
 * `Store` → resolve THAT store's current `storefrontId` (whatever brand it
 * ended up under) and change nothing — there is no brand left to rename or
 * rebrand under a slug this run no longer owns.
 */
async function seedStorefront(input: {
  businessId: string;
  slug: string;
  name: string;
  themeTokens?: unknown;
}): Promise<string> {
  const existing = await prisma.storefront.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (existing) {
    await prisma.storefront.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        ...(input.themeTokens ? { themeTokens: input.themeTokens as object } : {}),
      },
    });
    return existing.id;
  }

  const registryRow = await prisma.slug.findUnique({
    where: { value: input.slug },
    select: { storeId: true },
  });
  if (registryRow?.storeId) {
    const groupedStore = await prisma.store.findUnique({
      where: { id: registryRow.storeId },
      select: { storefrontId: true },
    });
    if (groupedStore) return groupedStore.storefrontId;
  }

  const created = await prisma.storefront.create({
    data: {
      businessId: input.businessId,
      name: input.name,
      slug: input.slug,
      ...(input.themeTokens ? { themeTokens: input.themeTokens as object } : {}),
      slugEntry: { create: { value: input.slug, kind: "STOREFRONT" } },
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * HD11 fixture: a store the panel closed, with a fixed reason. No products
 * — nothing that reads the closed page is supposed to reach the catalogue
 * query at all (architecture.md § La lectura pública).
 */
async function seedClosedStore(input: {
  businessId: string;
  externalId: string;
  slug: string;
  name: string;
  city: string;
  address: string;
}) {
  const storefrontId = await seedStorefront({
    businessId: input.businessId,
    slug: input.slug,
    name: input.name,
  });

  // Regla del seed (architecture.md § prisma/seed.ts): la rama `update` NUNCA
  // escribe `slug` ni `storefrontId`, o `npm run seed` desharía una
  // agrupación de la etapa 2. `slug` sale del objeto `input` a propósito.
  const { slug: _brandSlug, ...storeFields } = input;
  await prisma.store.upsert({
    where: { externalId: input.externalId },
    create: {
      ...storeFields,
      storefrontId,
      status: "SUSPENDED",
      disabledReasonCode: "VACACIONES",
      disabledMessage: "Volvemos pronto — gracias por tu paciencia.",
      disabledAt: now,
      sourceOptIn: false,
      sourceUpdatedAt: now,
    },
    update: {
      ...storeFields,
      status: "SUSPENDED",
      disabledReasonCode: "VACACIONES",
      disabledMessage: "Volvemos pronto — gracias por tu paciencia.",
      sourceOptIn: false,
      sourceUpdatedAt: now,
    },
  });
}

async function seedStore(input: {
  businessId: string;
  /** The BRAND's slug (F-017: the marca owns the slug, not the branch). */
  slug: string;
  /** Only the fixture that proves the "alias" resolution path (E2/E21) sets
   *  this — a branch keeping its own first-level slug after the brand owns
   *  the canonical one. Every other fixture leaves it `undefined` (null). */
  ownSlug?: string;
  externalId: string;
  name: string;
  description: string;
  city: string;
  address: string;
  whatsapp: string;
  themeTokens: unknown;
  /** F-010 fixture (I4): needed to exercise E8/E9/E18 and criteria 11/12. */
  checkoutMode: "WHATSAPP" | "ONSITE";
  deliveryEnabled: boolean;
  deliveryFee: string | null;
  products: SeedProduct[];
  categories: Map<string, string>;
  /** F-021 (SP3): name -> GlobalCategory id, so `upsertCanonical` can assign
   *  `globalCategoryId` to the canonicals that have an `ean`. */
  globalCategories: Map<string, string>;
}) {
  const { products, categories, globalCategories, themeTokens, slug, ownSlug, ...storeFields } =
    input;

  const storefrontId = await seedStorefront({
    businessId: input.businessId,
    slug,
    name: input.name,
    themeTokens,
  });

  // Deliberately fights HD12's migration (`_store_public_switch`), which
  // closes every PUBLISHED store retroactively: F-010's checkout fixtures
  // (I4) need `tienda-demo` and `tienda-dos` open, so re-running the seed
  // re-opens them on purpose. `sourceOptIn`/`sourceUpdatedAt` are set too,
  // so the very next real STORE event from the sync does not read as an
  // opt-in "change" and second-guess this (AP5(b), `handlers/store.ts`).
  // If this ever gets "fixed" to respect HD12, F-004/F-007/F-010's fixtures
  // break along with `check:bundle` (architecture.md § Qué se rompe).
  //
  // F-017 § prisma/seed.ts, la trampa: `update` NUNCA escribe `slug` ni
  // `storefrontId`. Sin esta regla, re-sembrar desharía una agrupación de la
  // etapa 2 y el criterio 2 se pondría rojo sin que nadie tocara código.
  const store = await prisma.store.upsert({
    where: { externalId: storeFields.externalId },
    create: {
      ...storeFields,
      storefrontId,
      slug: ownSlug ?? null,
      status: "PUBLISHED",
      publishedAt: now,
      sourceOptIn: true,
      sourceUpdatedAt: now,
    },
    update: {
      ...storeFields,
      status: "PUBLISHED",
      disabledReasonCode: null,
      disabledMessage: null,
      disabledAt: null,
      sourceOptIn: true,
      sourceUpdatedAt: now,
    },
  });

  // F-017: `Store.slug` alone resolves NOTHING — the registry (`Slug`) is
  // the only table the resolver reads (I6). Without this row,
  // `bodega-central-vedado` 404s even though the branch's own column is
  // set, which is exactly the "fifth writer" bug the registry exists to
  // prevent. Only the fixture that sets `ownSlug` needs this.
  if (ownSlug) {
    await prisma.slug.upsert({
      where: { value: ownSlug },
      create: { value: ownSlug, kind: "STORE", storeId: store.id },
      update: {},
    });
  }

  for (const [index, product] of products.entries()) {
    const canonical = await upsertCanonical(product, input.businessId, globalCategories);

    const storeProduct = await prisma.storeProduct.upsert({
      where: {
        storeId_externalId: {
          storeId: store.id,
          externalId: `${storeFields.externalId}-p${index}`,
        },
      },
      create: {
        storeId: store.id,
        canonicalProductId: canonical,
        externalId: `${storeFields.externalId}-p${index}`,
        slug: slugify(product.name) || `producto-${index}`,
        localName: product.name,
        description: product.description ?? null,
        syncedPrice: product.price,
        syncedPriceCurrency: product.currency,
        priceOverride: product.priceOverride ?? null,
        availability: product.availability,
        featured: product.featured ?? false,
        localCategoryId: categories.get(product.category) ?? null,
        sourceUpdatedAt: now,
      },
      update: {
        localName: product.name,
        syncedPrice: product.price,
        syncedPriceCurrency: product.currency,
        availability: product.availability,
        sourceUpdatedAt: now,
      },
    });

    // F-021: a freshly-seeded StoreProduct is buscable from its first row —
    // same reasoning `upsertCanonical`'s own `writeSearchDocument` call
    // already applies to the canonical (R3, criterio 6/10's precondition).
    await reindexStoreProduct(prisma, storeProduct.id);
  }
}

/**
 * HD4/E23/E26/E27: acuña un token de sync SOLO si `business` todavía no
 * tiene `syncTokenHash`. Usa la MISMA `mintSyncToken` que el script de
 * acuñación y el guard (PP2) — nunca una reimplementación. Idempotente por
 * diseño: la segunda corrida del seed no toca el hash ya poblado, así que
 * el token que el desarrollador ya guardó de la primera corrida sigue
 * sirviendo (C15).
 */
/**
 * F-011 tanda 3 (HD18, architecture.md § La fixture de HD18): a brand
 * already grouped, with THREE branches — one of each status that matters to
 * "renderable" (`status != DRAFT`): `PUBLISHED` and `SUSPENDED` both count,
 * `DRAFT` counts for neither. Reuses `seedStorefront()` (idempotent against
 * the `Slug` registry) and never touches `seedStore()`/`seedClosedStore()`.
 *
 * Each RENDERABLE branch needs its OWN `Store.slug` (`canonicalSlug()`
 * throws otherwise, once the brand has more than one) — so, unlike
 * `seedStore()`'s single optional `ownSlug`, every renderable branch here
 * gets one, each with its own `Slug` registry row (kind `STORE`), same
 * pattern as `bodega-central`/`bodega-central-vedado`.
 */
async function seedBrandWithBranches(input: {
  businessId: string;
  brandSlug: string;
  name: string;
  branches: {
    externalId: string;
    ownSlug: string | null;
    status: "PUBLISHED" | "SUSPENDED" | "DRAFT";
    name: string;
    city: string;
    disabledReasonCode?: string;
    disabledMessage?: string;
  }[];
}) {
  const storefrontId = await seedStorefront({
    businessId: input.businessId,
    slug: input.brandSlug,
    name: input.name,
    // themeTokens intentionally omitted (undefined): seedStorefront() only
    // ever WRITES branding when it is truthy, so this never overwrites what
    // the branding sensor just saved on a previous run.
  });

  for (const branch of input.branches) {
    const suspended = branch.status === "SUSPENDED";
    const published = branch.status === "PUBLISHED";

    const store = await prisma.store.upsert({
      where: { externalId: branch.externalId },
      create: {
        businessId: input.businessId,
        storefrontId,
        externalId: branch.externalId,
        name: branch.name,
        city: branch.city,
        slug: branch.ownSlug,
        status: branch.status,
        publishedAt: published || suspended ? now : null,
        disabledReasonCode: suspended ? (branch.disabledReasonCode ?? null) : null,
        disabledMessage: suspended ? (branch.disabledMessage ?? null) : null,
        disabledAt: suspended ? now : null,
        sourceOptIn: published || suspended,
        sourceUpdatedAt: now,
      },
      // Regla del seed (§ prisma/seed.ts, ya documentada arriba): `update`
      // NUNCA escribe `slug` ni `storefrontId` — de un solo uso o no, es la
      // misma trampa que desharía una agrupación si alguien la rompiera.
      update: {
        name: branch.name,
        city: branch.city,
        status: branch.status,
        disabledReasonCode: suspended ? (branch.disabledReasonCode ?? null) : null,
        disabledMessage: suspended ? (branch.disabledMessage ?? null) : null,
        disabledAt: suspended ? now : null,
        sourceOptIn: published || suspended,
        sourceUpdatedAt: now,
      },
    });

    if (branch.ownSlug) {
      await prisma.slug.upsert({
        where: { value: branch.ownSlug },
        create: { value: branch.ownSlug, kind: "STORE", storeId: store.id },
        update: {},
      });
    }
  }
}

/**
 * F-023 (I5, architecture.md § Sembrar una imagen de verdad): uploads the
 * SAME encoded fixture (`prisma/fixtures/producto-demo.jpg`) under every
 * product of `tienda-demo`, by the panel's own pipeline (encode once, upload
 * the full five-object set per image). Two things that make this survive a
 * repeated `npm run seed` and a CI with no Storage at all:
 *
 * 1. **Skips entirely when Storage isn't reachable** — the same discipline
 *    `.agent/init.sh` already applies to the emulator: a warning, never a
 *    failed seed. The CI runs `npm run seed` twice and has no `docker
 *    compose` at all.
 * 2. **A deterministic directory per product** (`deterministicImageUuid`,
 *    NOT `randomUUID()`) plus `{ upsert: true }` and an ASSIGNED array
 *    (`imageUrls: [url]`, never `push`): the second run re-writes the exact
 *    same five objects per product and leaves `imageUrls` exactly as long as
 *    the first run did.
 */
async function seedProductImages(storeExternalId: string): Promise<void> {
  const availability = storageAvailability();
  if (!availability.ok) {
    console.log(
      `Seed: Storage no disponible (${availability.reason}) — se omiten las imágenes de ${storeExternalId}.`,
    );
    return;
  }

  const store = await prisma.store.findUnique({
    where: { externalId: storeExternalId },
    select: { id: true },
  });
  if (!store) return;

  const fixturePath = path.join(__dirname, "fixtures", "producto-demo.jpg");
  const bytes = await readFile(fixturePath);
  const mime = detectImageMime(bytes);
  if (!mime || !isAllowedImageMime(mime)) {
    console.error(`Seed: ${fixturePath} no es una imagen reconocida — se omite.`);
    return;
  }

  const encoded = await encodeImageVariants(bytes, mime);
  if (!encoded.ok) {
    console.error(`Seed: no se pudo codificar el fixture de imagen (${encoded.reason}).`);
    return;
  }
  const ext = extensionForMime(mime);

  const products = await prisma.storeProduct.findMany({
    where: { storeId: store.id },
    select: { id: true },
  });

  for (const product of products) {
    const uuid = deterministicImageUuid(product.id);
    const dir = `stores/${store.id}/products/${product.id}/${uuid}/`;
    const originalPath = `${dir}${IMAGE_ORIGINAL_BASENAME}.${ext}`;

    const uploaded = await uploadStoreObjects([
      { path: originalPath, bytes, contentType: mime, upsert: true },
      ...encoded.variants.map((variant) => ({
        path: `${dir}w${variant.width}.${variant.format}`,
        bytes: variant.bytes,
        contentType: variant.contentType,
        upsert: true,
      })),
    ]);
    if (!uploaded.ok) {
      console.error(`Seed: fallo subiendo imágenes de ${product.id}: ${uploaded.reason}`);
      continue;
    }

    await prisma.storeProduct.update({
      where: { id: product.id },
      // Assignment, never `push` (architecture.md): a second seed run must
      // land on the SAME single-element array, not grow it.
      data: { imageUrls: [publicUrlFor(originalPath)] },
    });
  }
}

/**
 * Deterministic, UUID v4-SHAPED directory name derived from `seed` (never
 * `randomUUID()`, which would make every seed run produce a fresh, growing
 * set of orphaned objects). `deriveImageVariants` (`src/lib/imageVariants.ts`)
 * requires the exact v4 nibbles (version `4`, variant `8`/`9`/`a`/`b`) to
 * recognize a directory as a F-023 image — this mirrors that shape by
 * construction, from a SHA-256 of the input, so two runs with the same
 * `storeProductId` always produce the same directory.
 */
function deterministicImageUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variantNibble = "89ab"[parseInt(hex[16], 16) % 4];
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

async function ensureSyncToken(business: { id: string; externalId: string }): Promise<void> {
  const current = await prisma.business.findUniqueOrThrow({
    where: { id: business.id },
    select: { syncTokenHash: true },
  });
  if (current.syncTokenHash) return;

  const { token, hash } = mintSyncToken();
  await prisma.business.update({ where: { id: business.id }, data: { syncTokenHash: hash } });

  console.log(
    `Sync token minted for ${business.externalId} (save it now — it will not be shown again):`,
  );
  console.log(token);
}

async function upsertCanonical(
  product: SeedProduct,
  businessId: string,
  globalCategories: Map<string, string>,
): Promise<string> {
  const existing = product.ean
    ? await prisma.canonicalProduct.findUnique({ where: { ean: product.ean } })
    : await prisma.canonicalProduct.findFirst({
        where: { name: product.name, isExclusive: true },
      });

  // F-021 (SP3, architecture.md § "El delta del seed"): only a canonical
  // WITH an ean gets a global category — an orphan (`isExclusive: true`) is
  // outside the marketplace by definition, and the global taxonomy belongs
  // to the marketplace. This also leaves "Jugo de mango 1 L" (no ean, in the
  // seed's own Bebidas) as a real example of the OTHER half of R17's
  // cascade: no global category, found through its LocalCategory instead.
  const globalCategoryId = product.ean ? (globalCategories.get(product.category) ?? null) : null;

  const canonical =
    existing ??
    (await prisma.canonicalProduct.create({
      data: {
        ean: product.ean ?? null,
        name: product.name,
        // No barcode means no shared identity: exclusive to its own store.
        isExclusive: !product.ean,
        globalCategoryId,
      },
    }));

  // Idempotent, and re-applied even when `existing` already had a row: a
  // re-seed after this feature's own change must not leave a stale
  // `globalCategoryId` on a canonical the seed already created before F-021.
  if (canonical.globalCategoryId !== globalCategoryId) {
    await prisma.canonicalProduct.update({
      where: { id: canonical.id },
      data: { globalCategoryId },
    });
  }

  await prisma.productAlias.upsert({
    where: {
      canonicalProductId_text_businessId: {
        canonicalProductId: canonical.id,
        text: product.name,
        businessId,
      },
    },
    create: { canonicalProductId: canonical.id, text: product.name, businessId },
    update: {},
  });

  const aliases = await prisma.productAlias.findMany({
    where: { canonicalProductId: canonical.id },
    select: { text: true },
  });

  // F-015 (R14): the same writer the sync uses, so the seed never leaves a
  // canonical with an out-of-date searchDocument or a null searchVector — a
  // freshly-seeded database is buscable, and the CI seeds twice.
  await writeSearchDocument(
    prisma,
    canonical.id,
    buildSearchDocument(
      canonical.name,
      aliases.map((alias) => alias.text),
    ),
  );

  // F-024: same writer the sync uses (never a bespoke `createMany`), fed
  // `ean` plus whatever `extraEans` this fixture declares. Additive and
  // idempotent (R6/R8): a second `npm run seed` inserts 0 new rows (E17).
  await recordCanonicalBarcodes(
    prisma,
    canonical.id,
    normalizeBarcodes([product.ean, ...(product.extraEans ?? [])]),
  );

  return canonical.id;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
