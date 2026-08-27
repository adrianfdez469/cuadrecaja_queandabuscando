// Loaded explicitly: `tsx prisma/seed.ts` does not go through prisma.config.ts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { buildSearchDocument } from "../src/lib/canonical";
import { RESERVED_SLUGS, slugify } from "../src/lib/slug";
import { writeSearchDocument } from "../src/features/marketplace/server/searchVector";

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
  category: string;
  price: string;
  currency: string;
  availability: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK";
  description?: string;
  featured?: boolean;
  priceOverride?: string;
};

const CATEGORIES = ["Bebidas", "Alimentos", "Aseo", "Panadería"];

const DEMO_PRODUCTS: SeedProduct[] = [
  {
    name: "Refresco de cola 1.5 L",
    ean: "7501031311309",
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

  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    const category = await prisma.localCategory.upsert({
      where: {
        businessId_externalId: { businessId: business.id, externalId: `seed-cat-${slugify(name)}` },
      },
      create: {
        businessId: business.id,
        externalId: `seed-cat-${slugify(name)}`,
        name,
        slug: slugify(name),
      },
      update: { name },
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
  });

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
  });

  const counts = {
    stores: await prisma.store.count(),
    storefronts: await prisma.storefront.count(),
    canonical: await prisma.canonicalProduct.count(),
    aliases: await prisma.productAlias.count(),
    products: await prisma.storeProduct.count(),
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
}) {
  const { products, categories, themeTokens, slug, ownSlug, ...storeFields } = input;

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
    const canonical = await upsertCanonical(product, input.businessId);

    await prisma.storeProduct.upsert({
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
  }
}

async function upsertCanonical(product: SeedProduct, businessId: string): Promise<string> {
  const existing = product.ean
    ? await prisma.canonicalProduct.findUnique({ where: { ean: product.ean } })
    : await prisma.canonicalProduct.findFirst({
        where: { name: product.name, isExclusive: true },
      });

  const canonical =
    existing ??
    (await prisma.canonicalProduct.create({
      data: {
        ean: product.ean ?? null,
        name: product.name,
        // No barcode means no shared identity: exclusive to its own store.
        isExclusive: !product.ean,
      },
    }));

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

  return canonical.id;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
