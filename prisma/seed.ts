// Loaded explicitly: `tsx prisma/seed.ts` does not go through prisma.config.ts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { buildSearchDocument } from "../src/lib/canonical";
import { slugify } from "../src/lib/slug";

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

  const business = await prisma.business.upsert({
    where: { externalId: "seed-negocio-1" },
    create: {
      externalId: "seed-negocio-1",
      name: "Distribuidora La Rampa",
      slug: "la-rampa",
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
    products: SECOND_STORE_PRODUCTS,
    categories,
  });

  const counts = {
    stores: await prisma.store.count(),
    canonical: await prisma.canonicalProduct.count(),
    aliases: await prisma.productAlias.count(),
    products: await prisma.storeProduct.count(),
  };
  console.log("Done:", counts);
}

async function seedStore(input: {
  businessId: string;
  externalId: string;
  slug: string;
  name: string;
  description: string;
  city: string;
  address: string;
  whatsapp: string;
  themeTokens: unknown;
  products: SeedProduct[];
  categories: Map<string, string>;
}) {
  const { products, categories, themeTokens, ...storeFields } = input;

  const store = await prisma.store.upsert({
    where: { externalId: storeFields.externalId },
    create: {
      ...storeFields,
      status: "PUBLISHED",
      publishedAt: now,
      ...(themeTokens ? { themeTokens: themeTokens as object } : {}),
    },
    update: {
      ...storeFields,
      status: "PUBLISHED",
      ...(themeTokens ? { themeTokens: themeTokens as object } : {}),
    },
  });

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
        searchDocument: buildSearchDocument(product.name, []),
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

  await prisma.canonicalProduct.update({
    where: { id: canonical.id },
    data: {
      searchDocument: buildSearchDocument(
        canonical.name,
        aliases.map((alias) => alias.text),
      ),
    },
  });

  return canonical.id;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
