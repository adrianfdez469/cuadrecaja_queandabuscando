import Link from "next/link";
import {
  describeCatalogFilters,
  type CatalogFilterContext,
  type CatalogFilterState,
} from "@/features/catalog/catalogFilters";

/**
 * F-027 (design.md § Decisión 5): one chip per filter APPLIED for real
 * (R18) — never one for a value R10 discarded — with an "X" that removes
 * just that filter. Mounted by BOTH `/[slug]/catalogo` and `/[slug]/buscar`
 * (Inventario 3): repeating this markup in two pages is how one of the two
 * quietly loses its `min-h-11` or its `aria-label`.
 *
 * The chip entire `<a>` is the button (design.md: a 16px "X" alone would be
 * an unreachable touch target on a phone) — same technique as F-026's own
 * category chips, but with the INACTIVE pair of colors (this says "this is
 * set, tap to remove", the opposite of "you are here").
 */
const CHIP_CLASSES =
  "bg-surface-muted text-fg border-border inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-surface focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2";

export function StoreFilterChips({
  applied,
  context,
  removeAllHref,
}: {
  applied: CatalogFilterState;
  context: CatalogFilterContext;
  /** Computed once by the caller (`applyCatalogFilters` already produced
   *  `applied`) so the catalogue page and the panel's own action row never
   *  build two slightly different "remove everything" URLs. */
  removeAllHref: string;
}) {
  const chips = describeCatalogFilters(applied, context);
  if (chips.length === 0) return null;

  return (
    <nav aria-label="Filtros aplicados" className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.removeHref}
              prefetch={false}
              aria-label={`Quitar el filtro ${chip.label}`}
              className={CHIP_CLASSES}
            >
              <span>{chip.label}</span>
              <span aria-hidden="true">✕</span>
            </Link>
          </li>
        ))}
        {chips.length >= 2 && (
          <li>
            <Link href={removeAllHref} prefetch={false} className={`${CHIP_CLASSES} font-medium`}>
              Quitar todos los filtros
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
