import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublishedBranchesForParams,
  getStoreCategories,
  getStoreCategoryView,
  getStoreRates,
  requireStore,
} from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { publicEnv } from "@/lib/env";
import { CATALOG_EAGER_IMAGE_COUNT } from "@/constants/media";
import { Container } from "@/components/ui/Container";
import { ProductCard } from "@/components/store/ProductCard";
import { StoreCategoryNav } from "@/components/store/StoreCategoryNav";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { BranchBar } from "@/components/store/BranchBar";
import { StoreSearchBox } from "@/components/store/StoreSearchBox";

/**
 * F-026, architecture.md § El número que decide el pre-renderizado: built
 * exactly like `/[slug]/p/[productSlug]`'s own `generateStaticParams` — ONE
 * catalogue read per branch, reused for every slug variant it answers
 * under, never one read per (slug, category) pair. That doubling is what
 * exhausted the dev database's connection pool the first time this pattern
 * ran (ficha `prisma-p2037-too-many-connections-build-static-params`).
 */
export async function generateStaticParams() {
  const branches = await getPublishedBranchesForParams();
  const params = await Promise.all(
    branches.map(async (branch) => {
      const categories = await getStoreCategories(branch);
      return branch.slugs.flatMap((slug) =>
        categories.map((category) => ({ slug, categorySlug: category.slug })),
      );
    }),
  );
  return params.flat();
}

export async function generateMetadata({
  params,
}: PageProps<"/[slug]/c/[categorySlug]">): Promise<Metadata> {
  const { slug, categorySlug } = await params;
  const resolution = await requireResolution(slug);
  // E10: a brand's own slug has no catalogue, so it has no categories either.
  if (resolution.kind === "selector") notFound();

  const store = await requireStore(resolution);
  if (store.status !== "PUBLISHED") {
    return { title: `${store.name} · No disponible ahora`, robots: { index: false } };
  }

  const view = await getStoreCategoryView(resolution, categorySlug);
  if (!view) notFound(); // E5, E8, E9

  // RD7: same canonical-alternates rule `/[slug]` uses — both URLs still
  // respond 200, never a redirect (E2's "alias vivo").
  const canonical = resolution.isAlias
    ? new URL(`/${store.canonicalSlug}/c/${categorySlug}`, publicEnv.siteUrl).toString()
    : undefined;

  // R12/RD8: indexable on purpose, no `robots: { index: false }` — unlike
  // `/[slug]/buscar`, which sets it deliberately.
  return {
    title: `${view.category.name} en ${store.name}`,
    description: `Mira los productos de ${view.category.name} en ${store.name} y haz tu pedido.`,
    alternates: canonical ? { canonical } : undefined,
  };
}

export default async function StoreCategoryPage({ params }: PageProps<"/[slug]/c/[categorySlug]">) {
  const { slug, categorySlug } = await params;
  const resolution = await requireResolution(slug);
  // E10: no marca tiene catálogo ni categorías bajo su propio slug.
  if (resolution.kind === "selector") notFound();

  const store = await requireStore(resolution); // E12: DRAFT o inexistente → 404

  // E11: el aviso de cerrada va ANTES de tocar el catálogo. `loadCatalog` ya
  // filtra `store.status === "PUBLISHED"`, así que consultar aquí devolvería
  // una lista vacía y esta vista acabaría en un 404 en vez del aviso —
  // cualquier categorySlug bajo una tienda SUSPENDED enseña el aviso, exista
  // o no (architecture.md § La petición de /[slug]/c/[categorySlug]).
  if (store.status !== "PUBLISHED") {
    return (
      <>
        <Container className="py-8">
          <StoreClosedNotice
            storeName={store.name}
            disabledReasonCode={store.disabledReasonCode}
            disabledMessage={store.disabledMessage}
            disabledAt={store.disabledAt}
            whatsapp={store.whatsapp}
            phone={store.phone}
            address={store.address}
            extraNote="No se puede ver esta categoría mientras la tienda esté cerrada."
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

  const [view, rates, categories] = await Promise.all([
    getStoreCategoryView(resolution, categorySlug),
    getStoreRates(resolution),
    getStoreCategories(resolution),
  ]);
  // RD4: cero productos visibles ⇒ notFound(). No hay estado vacío para
  // esta vista — cubre a la vez el slug inexistente, el mal formado, el de
  // otra sucursal (E9) y el que se quedó sin productos (E5).
  if (!view) notFound();

  const { category, products } = view;
  const countLabel =
    products.length === 1
      ? `1 producto en ${store.name}.`
      : `${products.length} productos en ${store.name}.`;

  return (
    <>
      <BranchBar
        branchName={store.name}
        canonicalSlug={store.canonicalSlug}
        branchCount={resolution.branchCount}
        isOpen
      />
      <Container className="py-8">
        <StoreSearchBox storeSlug={store.canonicalSlug} storeName={store.name} />
        <h1 className="mt-8 text-2xl font-semibold break-words">{category.name}</h1>
        <p className="text-fg mt-2">{countLabel}</p>

        <StoreCategoryNav
          storeSlug={store.canonicalSlug}
          categories={categories}
          activeCategorySlug={category.slug}
        />

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
      </Container>
    </>
  );
}
