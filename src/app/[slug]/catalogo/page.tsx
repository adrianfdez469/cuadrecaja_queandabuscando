import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getStoreCatalog,
  getStoreCategories,
  getStoreRates,
  requireStore,
} from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { branchTrailStore, filterTrail } from "@/features/storefront/trail";
import {
  applyCatalogFilters,
  catalogFilterHref,
  hasAnyCatalogFilter,
  parseCatalogFilters,
  type CatalogFilterContext,
} from "@/features/catalog/catalogFilters";
import { CATALOG_ROUTE_SEGMENT } from "@/constants/catalog";
import { publicEnv } from "@/lib/env";
import { Container } from "@/components/ui/Container";
import { Alert } from "@/components/ui/Alert";
import { StoreSearchBox } from "@/components/store/StoreSearchBox";
import { StoreFilterPanel } from "@/components/store/StoreFilterPanel";
import { StoreFilterChips } from "@/components/store/StoreFilterChips";
import { StoreCatalogResults } from "@/components/store/StoreCatalogResults";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { StoreTrail } from "@/components/store/StoreTrail";
import { BranchBar } from "@/components/store/BranchBar";

/**
 * F-027 (plan.md paso 9, architecture.md § Decisión punto 3): the filtered
 * catalogue's own dynamic route, hermana de `/[slug]/buscar`. Reads
 * `searchParams` (R15), never enters `src/lib/cache.ts` on its own, and
 * opens ZERO new Prisma queries — `getStoreCatalog`/`getStoreRates`/
 * `getStoreCategories` are the exact three reads `/[slug]` already pays for
 * (SP3). Both segment configs are LITERALS — Next analyses them statically
 * (`.agent/playbook/revalidate-no-literal.md`).
 *
 * NO `loading.tsx` in this segment: this page can call `notFound()` (E19),
 * and a `loading.tsx` would make that respond 200 with the 404's body
 * (`.agent/playbook/nextjs-loading-tsx-rompe-status-code-de-notfound.md`).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SECONDARY_LINK_CLASSES =
  "bg-surface-muted text-fg border-border focus-visible:outline-brand inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[slug]/catalogo">): Promise<Metadata> {
  const { slug } = await params;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // E19

  const store = await requireStore(resolution);
  // R14: noindex + canonical to /[slug] in EVERY response of this surface,
  // filtered or not — unlike /[slug]/buscar, which only sets the canonical
  // when the URL carries a filter or a sort.
  const canonical = new URL(`/${store.canonicalSlug}`, publicEnv.siteUrl).toString();

  if (store.status !== "PUBLISHED") {
    return {
      title: `${store.name} · No disponible ahora`,
      robots: { index: false },
      alternates: { canonical },
    };
  }

  const products = await getStoreCatalog(resolution);
  if (products.length === 0) {
    return {
      title: `Filtrar y ordenar · ${store.name}`,
      robots: { index: false },
      alternates: { canonical },
    };
  }

  const query = await searchParams;
  const state = parseCatalogFilters(query);
  if (!hasAnyCatalogFilter(state) && state.page === 1) {
    return {
      title: `Filtrar y ordenar · ${store.name}`,
      robots: { index: false },
      alternates: { canonical },
    };
  }

  const [rates, categories] = await Promise.all([
    getStoreRates(resolution),
    getStoreCategories(resolution),
  ]);
  const context: CatalogFilterContext = {
    displayCurrency: store.baseCurrencyCode,
    rates,
    categories,
    basePath: `/${store.canonicalSlug}/${CATALOG_ROUTE_SEGMENT}`,
  };
  const result = applyCatalogFilters(products, state, context);
  const plural = result.totalCount === 1 ? "producto" : "productos";
  return {
    title: `${result.totalCount} ${plural} · ${store.name}`,
    robots: { index: false },
    alternates: { canonical },
  };
}

export default async function StoreCatalogPage({
  params,
  searchParams,
}: PageProps<"/[slug]/catalogo">) {
  const { slug } = await params;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // E19

  const store = await requireStore(resolution); // DRAFT/inexistente → 404 ya dentro

  // E18: aviso de cerrada, ANTES de tocar el catálogo — ninguna consulta de
  // catálogo para una tienda cerrada.
  if (store.status !== "PUBLISHED") {
    const trail = filterTrail(branchTrailStore(resolution, store));
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
            extraNote="No se puede filtrar mientras la tienda esté cerrada."
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

  const trail = filterTrail(branchTrailStore(resolution, store));

  // E17: sin panel, mismo mensaje que /[slug], palabra por palabra.
  if (products.length === 0) {
    return (
      <>
        <BranchBar
          branchName={store.name}
          canonicalSlug={store.canonicalSlug}
          branchCount={resolution.branchCount}
          isOpen
        />
        <Container className="pt-4 pb-8">
          <StoreTrail trail={trail} />
          <StoreSearchBox storeSlug={store.canonicalSlug} storeName={store.name} />
          <h1 className="mt-8 text-2xl font-semibold">Filtrar y ordenar</h1>
          <p className="text-fg-muted mt-10">Esta tienda todavía no tiene productos publicados.</p>
        </Container>
      </>
    );
  }

  const query = await searchParams;
  const state = parseCatalogFilters(query);
  const basePath = `/${store.canonicalSlug}/${CATALOG_ROUTE_SEGMENT}`;
  const context: CatalogFilterContext = {
    displayCurrency: store.baseCurrencyCode,
    rates,
    categories,
    basePath,
  };
  const result = applyCatalogFilters(products, state, context);

  const removeAllHref = catalogFilterHref(basePath, result.applied, {
    categorySlugs: [],
    inStockOnly: false,
    promotedOnly: false,
    featuredOnly: false,
    priceMin: null,
    priceMax: null,
    sort: null,
  });

  const empty = result.totalCount === 0; // E16
  // Una página más allá de la última: sobrevive gracias a `totalCount`
  // (.agent/playbook/conteo-total-paginado-se-pierde-en-pagina-vacia.md).
  const outOfRange = !empty && result.items.length === 0;
  // design.md § Decisión 1: abierto sin nada aplicado, o con cero
  // resultados; plegado en cualquier otro caso.
  const panelOpen = !hasAnyCatalogFilter(result.applied) || empty;

  return (
    <>
      <BranchBar
        branchName={store.name}
        canonicalSlug={store.canonicalSlug}
        branchCount={resolution.branchCount}
        isOpen
      />
      <Container className="pt-4 pb-8">
        <StoreTrail trail={trail} />
        <StoreSearchBox storeSlug={store.canonicalSlug} storeName={store.name} />
        <h1 className="mt-8 text-2xl font-semibold">Filtrar y ordenar</h1>

        <StoreFilterChips
          applied={result.applied}
          context={context}
          removeAllHref={removeAllHref}
        />

        <StoreFilterPanel
          result={result}
          context={context}
          open={panelOpen}
          removeAllHref={removeAllHref}
          catalogHref={`/${store.canonicalSlug}`}
        />

        {empty ? (
          <div className="mt-10">
            <h2 className="text-xl font-semibold">Con estos filtros no queda ningún producto.</h2>
            <p className="text-fg-muted mt-2">Quita alguno para ver más productos.</p>
            <Link
              href={`/${store.canonicalSlug}`}
              prefetch={false}
              className={`${SECONDARY_LINK_CLASSES} mt-4`}
            >
              Ver todo el catálogo
            </Link>
          </div>
        ) : outOfRange ? (
          <Alert tone="muted" className="mt-6">
            <p>Esta página ya no tiene resultados.</p>
            <Link
              href={catalogFilterHref(basePath, result.applied, { page: 1 })}
              prefetch={false}
              className="mt-2 inline-block underline underline-offset-4"
            >
              Volver a la primera página
            </Link>
          </Alert>
        ) : (
          <StoreCatalogResults
            result={result}
            storeSlug={store.canonicalSlug}
            storeName={store.name}
            displayCurrency={store.baseCurrencyCode}
            rates={rates}
            basePath={basePath}
          />
        )}
      </Container>
    </>
  );
}
