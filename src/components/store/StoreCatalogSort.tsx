import { Button } from "@/components/ui/Button";
import {
  CATALOG_AVAILABILITY_HAY,
  CATALOG_FLAG_ON,
  CATALOG_PARAM_AVAILABILITY,
  CATALOG_PARAM_CATEGORY,
  CATALOG_PARAM_FEATURED,
  CATALOG_PARAM_PRICE_MAX,
  CATALOG_PARAM_PRICE_MIN,
  CATALOG_PARAM_PROMOTION,
  CATALOG_PARAM_SORT,
  CATALOG_PARAM_TERM,
  CATALOG_SORT_DEFAULT_VALUE,
  CATALOG_SORT_NOMBRE,
  CATALOG_SORT_PRECIO_ASC,
  CATALOG_SORT_PRECIO_DESC,
  CATALOG_SORT_RECIENTE,
  CATALOG_SORT_RELEVANCIA,
} from "@/constants/catalog";
import type { CatalogFilterState } from "@/features/catalog/catalogFilters";

/**
 * F-027 (design.md § Componentes de UI, C1 de plan.md): the order selector.
 * A `<select>` with its own "Ordenar" button (C1's resolution — architecture
 * proposed one link per criterion, design measured a `<select>`; the
 * orchestrator kept design's). Server component, no directive: submitting a
 * `<form method="get">` is what a `<select>` does natively.
 *
 * `standalone` mounts it with its OWN `<form>` and hidden inputs that carry
 * every other current parameter (`/[slug]/buscar`, which has no filter
 * panel, SP5). `!standalone` renders only the `<label>` + `<select>`, meant
 * to sit INSIDE the filter panel's own `<form>` on `/[slug]/catalogo` — a
 * nested `<form>` is invalid HTML, and the panel's single "Aplicar" already
 * covers it.
 */
const SORT_SELECT_CLASSES =
  "border-border bg-surface text-fg focus-visible:outline-brand min-h-11 w-full rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2";

type SortOption = { value: string; label: string };

const BUSCAR_SORT_OPTIONS: readonly SortOption[] = [
  { value: CATALOG_SORT_RELEVANCIA, label: "Más relevantes" },
  { value: CATALOG_SORT_PRECIO_ASC, label: "Precio: de menor a mayor" },
  { value: CATALOG_SORT_PRECIO_DESC, label: "Precio: de mayor a menor" },
  { value: CATALOG_SORT_NOMBRE, label: "Nombre: de la A a la Z" },
  { value: CATALOG_SORT_RECIENTE, label: "Últimos añadidos al catálogo" },
];

const CATALOGO_SORT_OPTIONS: readonly SortOption[] = [
  { value: CATALOG_SORT_DEFAULT_VALUE, label: "Destacados primero" },
  { value: CATALOG_SORT_PRECIO_ASC, label: "Precio: de menor a mayor" },
  { value: CATALOG_SORT_PRECIO_DESC, label: "Precio: de mayor a menor" },
  { value: CATALOG_SORT_NOMBRE, label: "Nombre: de la A a la Z" },
  { value: CATALOG_SORT_RECIENTE, label: "Últimos añadidos al catálogo" },
];

/** design.md § Decisión 3: only shown once "Últimos añadidos" is the
 *  applied order — honest about I9 instead of letting the label alone
 *  imply a freshly-stocked product. */
const RECIENTE_HELP_TEXT =
  "Ordenado por cuándo entró cada producto en este catálogo. Los que llegaron en el mismo envío salen juntos, por orden alfabético.";

export function StoreCatalogSort({
  state,
  basePath,
  variant,
  standalone = true,
}: {
  state: CatalogFilterState;
  basePath: string;
  variant: "buscar" | "catalogo";
  standalone?: boolean;
}) {
  const options = variant === "buscar" ? BUSCAR_SORT_OPTIONS : CATALOGO_SORT_OPTIONS;
  const selected =
    state.sort ?? (variant === "buscar" ? CATALOG_SORT_RELEVANCIA : CATALOG_SORT_DEFAULT_VALUE);

  const select = (
    <div className="flex flex-col gap-1">
      <label htmlFor={CATALOG_PARAM_SORT} className="text-sm font-medium">
        Ordenar por
      </label>
      <select
        id={CATALOG_PARAM_SORT}
        name={CATALOG_PARAM_SORT}
        defaultValue={selected}
        className={SORT_SELECT_CLASSES}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {state.sort === CATALOG_SORT_RECIENTE && (
        <p className="text-fg-muted text-xs">{RECIENTE_HELP_TEXT}</p>
      )}
    </div>
  );

  if (!standalone) return select;

  return (
    <form method="get" action={basePath} className="max-w-xs">
      {state.term && <input type="hidden" name={CATALOG_PARAM_TERM} value={state.term} />}
      {state.categorySlugs.map((slug) => (
        <input key={slug} type="hidden" name={CATALOG_PARAM_CATEGORY} value={slug} />
      ))}
      {state.inStockOnly && (
        <input type="hidden" name={CATALOG_PARAM_AVAILABILITY} value={CATALOG_AVAILABILITY_HAY} />
      )}
      {state.promotedOnly && (
        <input type="hidden" name={CATALOG_PARAM_PROMOTION} value={CATALOG_FLAG_ON} />
      )}
      {state.featuredOnly && (
        <input type="hidden" name={CATALOG_PARAM_FEATURED} value={CATALOG_FLAG_ON} />
      )}
      {state.priceMin !== null && (
        <input type="hidden" name={CATALOG_PARAM_PRICE_MIN} value={state.priceMin} />
      )}
      {state.priceMax !== null && (
        <input type="hidden" name={CATALOG_PARAM_PRICE_MAX} value={state.priceMax} />
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">{select}</div>
        <Button type="submit" className="shrink-0">
          Ordenar
        </Button>
      </div>
    </form>
  );
}
