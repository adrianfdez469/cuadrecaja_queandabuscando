import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublishedStoreSlugs,
  getStoreCatalog,
  getStoreRates,
  requireStore,
} from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { publicEnv } from "@/lib/env";
import { Container } from "@/components/ui/Container";
import { ProductCard } from "@/components/store/ProductCard";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";

/**
 * Pre-render every published store at build time. New stores that appear later
 * are rendered on first request and then cached, so this is a warm-start
 * optimisation rather than a completeness requirement.
 */
export async function generateStaticParams() {
  const slugs = await getPublishedStoreSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // etapa 2, unreachable in this stage
  const store = await requireStore(resolution);
  // R22: a live branch alias (criterio 3) declares its canonical, so it
  // never competes with the brand's own URL in a search index — and never
  // redirects (HS4): both URLs still respond 200 with the same page.
  const canonical = resolution.isAlias
    ? new URL(`/${store.canonicalSlug}`, publicEnv.siteUrl).toString()
    : undefined;
  if (store.status !== "PUBLISHED") {
    return {
      title: `${store.name} · No disponible ahora`,
      description: store.disabledMessage ?? undefined,
      robots: { index: false },
      alternates: canonical ? { canonical } : undefined,
    };
  }
  return {
    title: store.name,
    description: store.description ?? `Catálogo y pedidos de ${store.name}.`,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title: store.name,
      description: store.description ?? undefined,
      images: store.coverUrl ? [store.coverUrl] : undefined,
    },
  };
}

export default async function StorePage({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // etapa 2, unreachable in this stage
  const store = await requireStore(resolution);

  // HD11: no catalog query at all for a closed store — one fewer query, and
  // no chance of ever leaking catalog data through this branch.
  if (store.status !== "PUBLISHED") {
    return (
      <Container className="py-8">
        <StoreClosedNotice
          storeName={store.name}
          disabledReasonCode={store.disabledReasonCode}
          disabledMessage={store.disabledMessage}
          disabledAt={store.disabledAt}
          whatsapp={store.whatsapp}
          phone={store.phone}
          address={store.address}
        />
      </Container>
    );
  }

  const [products, rates] = await Promise.all([
    getStoreCatalog(resolution),
    getStoreRates(resolution),
  ]);

  return (
    <Container className="py-8">
      <h1 className="text-2xl font-semibold">Catálogo</h1>
      {store.description && <p className="text-fg-muted mt-2 max-w-2xl">{store.description}</p>}

      {products.length === 0 ? (
        <p className="text-fg-muted mt-10">Esta tienda todavía no tiene productos publicados.</p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard
                product={product}
                storeSlug={store.canonicalSlug}
                displayCurrency={store.baseCurrencyCode}
                rates={rates}
              />
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
