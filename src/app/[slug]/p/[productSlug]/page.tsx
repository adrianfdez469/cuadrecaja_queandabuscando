import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, isOrderable } from "@/lib/availability";
import { resolvePrice, type ResolvedPrice } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { deriveImageVariants, socialImageUrl } from "@/lib/imageVariants";
import { IMAGE_VARIANT_WIDTH_DETAIL } from "@/constants/media";
import {
  getPublishedBranchesForParams,
  getStoreCatalog,
  getStoreRates,
  requireStore,
} from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { ResponsiveImage } from "@/components/ui/ResponsiveImage";
import { AddToCartButton } from "@/features/cart/components/AddToCartButton";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { BranchBar } from "@/components/store/BranchBar";
import { StoreSearchBox } from "@/components/store/StoreSearchBox";

/** design.md § 2: the geometry of the two-column detail layout, expressed
 *  with `calc()` so it accounts for the container's own gutters instead of
 *  the naive "100vw below the breakpoint" that over-requests. */
const DETAIL_IMAGE_SIZES =
  "(min-width: 1152px) 536px, (min-width: 768px) calc(50vw - 40px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

/**
 * Pre-render the catalogue of every published store. Like the store page, this
 * is a warm-start optimisation: anything missed renders on first request.
 *
 * ONE catalogue fetch per branch, reused for every slug it answers under
 * (canonical + a live alias, if any) — resolving and fetching separately
 * per slug variant doubled every query for an aliased branch and, combined
 * with the build's parallel workers, exhausted the dev database's
 * connection pool (ficha `prisma-p2037-too-many-connections-build-static-params`).
 */
export async function generateStaticParams() {
  const branches = await getPublishedBranchesForParams();
  const params = await Promise.all(
    branches.map(async (branch) => {
      const catalog = await getStoreCatalog(branch);
      return branch.slugs.flatMap((slug) =>
        catalog.map((product) => ({ slug, productSlug: product.slug })),
      );
    }),
  );
  return params.flat();
}

export async function generateMetadata({
  params,
}: PageProps<"/[slug]/p/[productSlug]">): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const resolution = await requireResolution(slug);
  // A brand's OWN slug never has a catalogue to iterate under `/p/*` once it
  // groups 2+ branches (criterio 2) — that URL now serves the selector, not
  // a product page.
  if (resolution.kind === "selector") notFound();
  const store = await requireStore(resolution);
  // HD11: never read the product for a closed store — not even to build
  // metadata. A closed store's product pages all share the store's own
  // "closed" metadata, exactly like `/[slug]` itself.
  if (store.status !== "PUBLISHED") {
    return { title: `${store.name} · No disponible ahora`, robots: { index: false } };
  }

  const product = (await getStoreCatalog(resolution)).find((p) => p.slug === productSlug);
  if (!product) return { title: "Producto no encontrado" };

  // R15: openGraph never points at AVIF or the (up to 4 MB) original — social
  // crawlers don't reliably accept AVIF, and a raw original would be huge.
  // A legacy F-011 URL (no variants) passes through unchanged, with no
  // declared dimensions, exactly as it did before this feature (design.md § 2).
  const originalUrl = product.imageUrls[0];
  const hasVariants = originalUrl ? deriveImageVariants(originalUrl) !== null : false;
  const ogImage = originalUrl ? socialImageUrl(originalUrl) : undefined;

  return {
    title: product.name,
    description: product.description ?? undefined,
    openGraph: {
      title: product.name,
      images: ogImage
        ? hasVariants
          ? [
              {
                url: ogImage,
                width: IMAGE_VARIANT_WIDTH_DETAIL,
                height: IMAGE_VARIANT_WIDTH_DETAIL,
              },
            ]
          : [ogImage]
        : undefined,
    },
  };
}

export default async function ProductPage({ params }: PageProps<"/[slug]/p/[productSlug]">) {
  const { slug, productSlug } = await params;
  const resolution = await requireResolution(slug);
  // A brand's OWN slug never has a catalogue to iterate under `/p/*` once it
  // groups 2+ branches (criterio 2) — that URL now serves the selector.
  if (resolution.kind === "selector") notFound();
  const store = await requireStore(resolution);

  // HD11: the closed notice, WITHOUT reading the product — not even to
  // decide it exists. One fewer query, and no way to leak whether a given
  // productSlug exists in a store nobody can browse right now.
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

  const [catalog, rates] = await Promise.all([
    getStoreCatalog(resolution),
    getStoreRates(resolution),
  ]);

  const product = catalog.find((candidate) => candidate.slug === productSlug);
  if (!product) notFound();

  // R11: a price is part of what makes a product orderable, alongside
  // availability. A product whose price cannot be resolved (no exchange
  // rate) is not addable, even if it is technically in stock.
  let resolved: ResolvedPrice | null;
  try {
    resolved = resolvePrice(product, {
      targetCurrency: store.baseCurrencyCode,
      rates,
      baseCurrency: store.baseCurrencyCode,
      promotions: product.promotions,
    });
  } catch {
    resolved = null;
  }
  const price = resolved ? formatMoney(resolved.price) : null;
  const canOrder = isOrderable(product.availability) && resolved !== null;
  const winningPromotion = product.promotions.find((p) => p.id === resolved?.promotionId) ?? null;

  const image = product.imageUrls[0];

  return (
    <>
      <BranchBar
        branchName={store.name}
        canonicalSlug={store.canonicalSlug}
        branchCount={resolution.branchCount}
        isOpen
      />
      <Container className="pt-6">
        <StoreSearchBox storeSlug={store.canonicalSlug} storeName={store.name} />
      </Container>
      <Container className="grid gap-8 py-8 md:grid-cols-2">
        <div className="bg-surface-muted relative aspect-square overflow-hidden rounded-lg">
          {image ? (
            <ResponsiveImage
              src={image}
              alt={product.name}
              variant="detail"
              sizes={DETAIL_IMAGE_SIZES}
              priority
            />
          ) : (
            <div className="text-fg-muted flex h-full items-center justify-center">Sin imagen</div>
          )}
        </div>

        <div>
          {product.categoryName && <p className="text-fg-muted text-sm">{product.categoryName}</p>}
          <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>

          <p className="text-brand mt-4 text-3xl font-semibold">
            {price ?? <span className="text-fg-muted">Consultar precio</span>}
          </p>
          {resolved?.listPrice && (
            <p className="text-fg-muted text-sm">
              Antes <span className="line-through">{formatMoney(resolved.listPrice)}</span>
            </p>
          )}
          {winningPromotion && (
            <p className="text-fg-muted text-sm">
              Promoción:{" "}
              {winningPromotion.type === "PERCENTAGE"
                ? `${winningPromotion.value}% de descuento.`
                : `${winningPromotion.value} de descuento.`}
            </p>
          )}

          <div className="mt-3">
            <Badge tone={AVAILABILITY_TONE[product.availability]}>
              {AVAILABILITY_LABEL[product.availability]}
            </Badge>
          </div>

          {product.description && (
            <p className="text-fg-muted mt-6 whitespace-pre-line">{product.description}</p>
          )}

          <div className="mt-8">
            <AddToCartButton
              storeId={store.id}
              storeSlug={store.canonicalSlug}
              storeProductId={product.id}
              slug={product.slug}
              name={product.name}
              unitPrice={resolved?.price.amount ?? "0.00"}
              currencyCode={resolved?.price.currency ?? store.baseCurrencyCode}
              disabled={!canOrder}
            />
          </div>
        </div>
      </Container>
    </>
  );
}
