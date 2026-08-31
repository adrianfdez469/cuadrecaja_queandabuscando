import Link from "next/link";
import type { StoreCategory } from "@/features/catalog/storeCategories";
import { storeCategoryPath } from "@/features/catalog/storeCategories";
import type { PublicSlug } from "@/lib/publicSlug";

/**
 * F-026, design.md § Decisión 1: the category row. A single `<nav>` of
 * `<a>`, mounted by BOTH `/[slug]` and `/[slug]/c/[categorySlug]` (RD6),
 * never by the layout — same reasoning F-021 wrote for `StoreSearchBox`.
 *
 * Server component, no client directive (AGENTS.md § Prohibiciones: never
 * on anything that renders catalogue). A slidable row at 360px that wraps
 * from `sm:`, by CSS alone — no JavaScript follows the active chip into
 * view, and none is added to.
 */
export function StoreCategoryNav({
  storeSlug,
  categories,
  activeCategorySlug,
}: {
  storeSlug: PublicSlug;
  categories: readonly StoreCategory[];
  /** Omitted on `/[slug]`, where "Todo el catálogo" is the active chip. */
  activeCategorySlug?: string;
}) {
  return (
    <nav
      aria-label="Categorías"
      className="-mx-4 mt-6 overflow-x-auto px-4 py-1 sm:mx-0 sm:overflow-visible sm:px-0"
    >
      <ul className="flex gap-2 sm:flex-wrap">
        <li className="shrink-0">
          <CategoryChip
            href={`/${storeSlug}`}
            label="Todo el catálogo"
            active={activeCategorySlug === undefined}
          />
        </li>
        {categories.map((category) => (
          <li key={category.slug} className="shrink-0">
            <CategoryChip
              href={storeCategoryPath(storeSlug, category.slug)}
              label={category.name}
              active={category.slug === activeCategorySlug}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

const CHIP_BASE_CLASSES =
  "inline-flex min-h-11 items-center rounded-md border px-3 text-sm whitespace-nowrap sm:whitespace-normal focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2";
const CHIP_INACTIVE_CLASSES = "bg-surface-muted text-fg border-border font-medium hover:bg-surface";
const CHIP_ACTIVE_CLASSES = "bg-brand text-brand-contrast border-transparent font-semibold";

function CategoryChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      // RD5: 15 categories prefetching their RSC payload on scroll into
      // view is 15 unrequested round trips for a navigation the CDN
      // already serves in one hop (design.md § Coste de cliente).
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`${CHIP_BASE_CLASSES} ${active ? CHIP_ACTIVE_CLASSES : CHIP_INACTIVE_CLASSES}`}
    >
      {label}
    </Link>
  );
}
