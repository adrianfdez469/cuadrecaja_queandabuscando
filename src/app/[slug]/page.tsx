import type { Metadata } from "next";
import Link from "next/link";
import {
  getPublishedStoreSlugs,
  getStoreCatalog,
  getStoreCategories,
  getStoreRates,
  requireStore,
} from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { branchTrailStore, brandTrailStore, catalogTrail } from "@/features/storefront/trail";
import { catalogEntryHref, shouldOfferCatalogEntryLink } from "@/features/catalog/catalogFilters";
import { CATALOG_ROUTE_SEGMENT } from "@/constants/catalog";
import { publicEnv } from "@/lib/env";
import { CATALOG_EAGER_IMAGE_COUNT } from "@/constants/media";
import { Container } from "@/components/ui/Container";
import { Alert } from "@/components/ui/Alert";
import { ProductCard } from "@/components/store/ProductCard";
import { StoreCategoryNav } from "@/components/store/StoreCategoryNav";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { StoreTrail } from "@/components/store/StoreTrail";
import { BranchBar } from "@/components/store/BranchBar";
import { BranchList } from "@/components/store/BranchList";
import { StoreSearchBox } from "@/components/store/StoreSearchBox";
import { StoreHoursNotice } from "@/components/store/StoreHoursNotice";
import { readWeeklySchedule } from "@/lib/openingHours";

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

  // Criterio 2, DP4: the selector is a real, indexable page — its own
  // title/description, and no `alternates.canonical` (nothing else claims to
  // be "the" URL for a brand's selector; unlike a branch, it has no alias).
  if (resolution.kind === "selector") {
    const count = resolution.branches.length;
    return {
      title: resolution.brandName,
      description: `Elige una de las ${count} sucursales de ${resolution.brandName} para ver su catálogo y hacer tu pedido.`,
    };
  }

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

  // Criterio 2 — modo selector: una marca con 2+ sucursales renderizables
  // muestra la lista en vez de un catálogo (design.md § 1). Cero módulos de
  // cliente: `BranchList` es de servidor.
  if (resolution.kind === "selector") {
    const allClosed = resolution.branches.every((branch) => branch.status !== "PUBLISHED");
    const trail = catalogTrail(brandTrailStore(resolution));
    return (
      <Container className="pt-4 pb-8">
        <StoreTrail trail={trail} />
        <h1 className="text-2xl font-semibold">Elige tu sucursal</h1>
        <p className="text-fg-muted mt-2 max-w-2xl">
          {resolution.brandName} tiene {resolution.branches.length} sucursales. Los precios y los
          productos pueden cambiar de una a otra.
        </p>
        {allClosed && (
          <Alert tone="warning" className="mt-4">
            <p className="font-medium">Ahora mismo no hay ninguna sucursal abierta.</p>
            <p className="mt-1">
              Las {resolution.branches.length} están cerradas. Puedes ver por qué en cada una, y
              esta página se actualiza sola cuando alguna vuelva a abrir.
            </p>
          </Alert>
        )}
        <BranchList branches={resolution.branches} variant="selector" />
      </Container>
    );
  }

  const store = await requireStore(resolution);

  // HD11: no catalog query at all for a closed store — one fewer query, and
  // no chance of ever leaking catalog data through this branch.
  if (store.status !== "PUBLISHED") {
    const trail = catalogTrail(branchTrailStore(resolution, store));
    return (
      <>
        <Container className="pt-4 pb-8">
          <StoreTrail trail={trail} />
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
        <BranchBar
          branchName={store.name}
          canonicalSlug={store.canonicalSlug}
          branchCount={resolution.branchCount}
          isOpen={false}
        />
      </>
    );
  }

  const [products, rates, categories] = await Promise.all([
    getStoreCatalog(resolution),
    getStoreRates(resolution),
    getStoreCategories(resolution),
  ]);

  const trail = catalogTrail(branchTrailStore(resolution, store));
  // F-022 R8/E8/E9: only reached in the PUBLISHED branch (the closed branch
  // returns earlier, above). `readWeeklySchedule` returns `null` for both
  // "no horario" and "horario ilegible" (E8, E12), and then nothing new is
  // painted — the page stays byte-for-byte what it was before this feature.
  const weeklySchedule = readWeeklySchedule(store.openingHours);

  return (
    <>
      <BranchBar
        branchName={store.name}
        canonicalSlug={store.canonicalSlug}
        branchCount={resolution.branchCount}
        isOpen
      />
      <Container className="pt-4 pb-8">
        <StoreTrail trail={trail} jsonLd />
        {weeklySchedule && <StoreHoursNotice schedule={weeklySchedule} />}
        <StoreSearchBox storeSlug={store.canonicalSlug} storeName={store.name} />
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Catálogo</h1>
          {/* design.md § Decisión 4/6: enlace de entrada, solo con 2+
              productos visibles — no toca el conjunto ni el orden (criterio 1)
              y va sin prefetch: apunta a una ruta dinámica (design.md § Coste
              de cliente). */}
          {shouldOfferCatalogEntryLink(products.length) && (
            <Link
              href={catalogEntryHref(`/${store.canonicalSlug}/${CATALOG_ROUTE_SEGMENT}`)}
              prefetch={false}
              className="text-brand min-h-11 content-center font-medium"
            >
              Filtrar y ordenar
            </Link>
          )}
        </div>
        {store.description && <p className="text-fg-muted mt-2 max-w-2xl">{store.description}</p>}

        {/* design.md § Inventario, umbral: with fewer than two categories the
            only choice would be "todo" or "esa una" — the same set, so it is
            not a choice (RD1, criterio 1). */}
        {categories.length >= 2 && (
          <StoreCategoryNav storeSlug={store.canonicalSlug} categories={categories} />
        )}

        {products.length === 0 ? (
          <p className="text-fg-muted mt-10">Esta tienda todavía no tiene productos publicados.</p>
        ) : (
          <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product, index) => (
              <li key={product.id}>
                <ProductCard
                  product={product}
                  storeSlug={store.canonicalSlug}
                  displayCurrency={store.baseCurrencyCode}
                  rates={rates}
                  eager={index < CATALOG_EAGER_IMAGE_COUNT}
                  priority={index === 0}
                />
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
