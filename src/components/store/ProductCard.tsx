import Image from "next/image";
import Link from "next/link";
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, shouldShowBadge } from "@/lib/availability";
import { displayPrice } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
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
}: {
  product: CatalogProduct;
  storeSlug: string;
  displayCurrency: string;
  rates: Record<string, string>;
}) {
  const price = safePrice(product, displayCurrency, rates);
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
            <Image
              src={image}
              alt={product.name}
              fill
              // Two columns on phones, four on desktop. Getting this wrong is
              // the single easiest way to waste bandwidth on a slow connection.
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover"
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
            {price ?? <span className="text-fg-muted font-normal">Consultar</span>}
          </p>

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
function safePrice(
  product: CatalogProduct,
  displayCurrency: string,
  rates: Record<string, string>,
): string | null {
  try {
    return formatMoney(displayPrice(product, displayCurrency, rates));
  } catch {
    return null;
  }
}
