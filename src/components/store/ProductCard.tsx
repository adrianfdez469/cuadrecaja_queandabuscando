import Link from "next/link";
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, shouldShowBadge } from "@/lib/availability";
import { tryResolvePrice } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { priceEquivalents } from "@/lib/priceEquivalents";
import { EQUIVALENT_CURRENCY_ATTR } from "@/constants/currency";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ResponsiveImage } from "@/components/ui/ResponsiveImage";
import type { CatalogProduct } from "@/features/catalog/server/queries";

/**
 * Server component. A product card is pure output — rendering it on the client
 * would ship the whole catalogue twice for no benefit.
 *
 * F-039 (architecture.md AD1, R12): the equivalents are the SAME
 * `priceEquivalents()` the product page, the cart and the checkout call —
 * one compositor, so this card can never disagree with any of them on a
 * rounding. Still a server component: nothing here renders catalogue, and
 * AGENTS.md forbids `"use client"` on anything that does.
 */
export function ProductCard({
  product,
  storeSlug,
  displayCurrency,
  displayCurrencies,
  rates,
  eager = false,
  priority = false,
}: {
  product: CatalogProduct;
  storeSlug: string;
  displayCurrency: string;
  /** F-039 (AD5): `Business.displayCurrencies` as declared (R1), not the
   *  offered subset — `priceEquivalents` is what omits what it cannot
   *  calculate (R5), per product. */
  displayCurrencies: readonly string[];
  rates: Record<string, string>;
  /** F-023 design.md § 1: above the fold (`CATALOG_EAGER_IMAGE_COUNT`) — the
   *  caller knows the card's position in the grid, this component does not. */
  eager?: boolean;
  /** F-023 design.md § 1: the page's own LCP candidate (index 0 only). */
  priority?: boolean;
}) {
  const resolved = tryResolvePrice(product, {
    targetCurrency: displayCurrency,
    rates,
    baseCurrency: displayCurrency,
    promotions: product.promotions,
  });
  // R8: derived from the CHARGED amount (resolved.price), never
  // `beforeConversion` — two products showing the same principal can never
  // show different equivalents over a stray cent.
  const equivalents = resolved
    ? priceEquivalents(resolved.price, displayCurrencies, displayCurrency, rates)
    : [];
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
            {!resolved ? (
              <span className="text-fg-muted font-normal">Consultar</span>
            ) : equivalents.length === 0 ? (
              formatMoney(resolved.price)
            ) : (
              // design.md § 1: equivalents live INSIDE the price's own
              // paragraph, as siblings with a gap — never a `justify-between`
              // or a punctuation separator, so hiding one at hydration never
              // orphans anything (architecture.md § Restricciones, punto 2).
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span>{formatMoney(resolved.price)}</span>
                {equivalents.map((equivalent) => (
                  <span
                    key={equivalent.currency}
                    {...{ [EQUIVALENT_CURRENCY_ATTR]: equivalent.currency }}
                    className="text-fg-muted text-xs font-normal whitespace-nowrap"
                  >
                    {/* D1/D2: "≈" is aria-hidden and the sr-only word carries
                        its OWN trailing space, so the visible reading is
                        "≈ US$1.41" (one real space, before the sr-only text,
                        which has zero visual footprint) and the accessible
                        name is "aproximadamente US$1.41" (the sr-only text's
                        trailing space, then the amount) — never two spaces
                        fighting over which one renders. */}
                    <span aria-hidden>≈</span> <span className="sr-only">aproximadamente </span>
                    {formatMoney(equivalent)}
                  </span>
                ))}
              </span>
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
