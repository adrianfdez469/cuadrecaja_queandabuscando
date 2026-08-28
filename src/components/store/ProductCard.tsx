import Link from "next/link";
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, shouldShowBadge } from "@/lib/availability";
import { resolvePrice, type ResolvedPrice } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ResponsiveImage } from "@/components/ui/ResponsiveImage";
import type { CatalogProduct } from "@/features/catalog/server/queries";

/**
 * Server component. A product card is pure output — rendering it on the client
 * would ship the whole catalogue twice for no benefit.
 */
export function ProductCard({
  product,
  storeSlug,
  displayCurrency,
  rates,
  eager = false,
  priority = false,
}: {
  product: CatalogProduct;
  storeSlug: string;
  displayCurrency: string;
  rates: Record<string, string>;
  /** F-023 design.md § 1: above the fold (`CATALOG_EAGER_IMAGE_COUNT`) — the
   *  caller knows the card's position in the grid, this component does not. */
  eager?: boolean;
  /** F-023 design.md § 1: the page's own LCP candidate (index 0 only). */
  priority?: boolean;
}) {
  const resolved = safeResolve(product, displayCurrency, rates);
  const image = product.imageUrls[0];

  return (
    <Card className="h-full overflow-hidden transition-shadow hover:shadow-lg">
      {product.featured && (
        <span className="bg-accent text-accent-contrast block px-3 py-1 text-xs font-medium">
          Destacado
        </span>
      )}
      <Link href={`/${storeSlug}/p/${product.slug}`} className="block">
        <div className="bg-surface-muted relative aspect-square">
          {image ? (
            <ResponsiveImage
              src={image}
              alt={product.name}
              variant="card"
              eager={eager}
              priority={priority}
            />
          ) : (
            <div className="text-fg-muted flex h-full items-center justify-center text-sm">
              Sin imagen
            </div>
          )}
        </div>

        <div className="space-y-1.5 p-3">
          <h3 className="line-clamp-2 text-sm font-medium">{product.name}</h3>

          <p className="text-brand text-base font-semibold">
            {resolved ? (
              formatMoney(resolved.price)
            ) : (
              <span className="text-fg-muted font-normal">Consultar</span>
            )}
          </p>
          {resolved?.listPrice && (
            <p className="text-fg-muted text-xs">
              Antes <span className="line-through">{formatMoney(resolved.listPrice)}</span>
            </p>
          )}

          {shouldShowBadge(product.availability) && (
            <Badge tone={AVAILABILITY_TONE[product.availability]}>
              {AVAILABILITY_LABEL[product.availability]}
            </Badge>
          )}
        </div>
      </Link>
    </Card>
  );
}

/**
 * A product priced in a currency with no rate yet must not take the page down.
 * Showing "Consultar" is a worse experience than a price, and a much better one
 * than a 500.
 */
function safeResolve(
  product: CatalogProduct,
  displayCurrency: string,
  rates: Record<string, string>,
): ResolvedPrice | null {
  try {
    return resolvePrice(product, {
      targetCurrency: displayCurrency,
      rates,
      baseCurrency: displayCurrency,
      promotions: product.promotions,
    });
  } catch {
    return null;
  }
}
