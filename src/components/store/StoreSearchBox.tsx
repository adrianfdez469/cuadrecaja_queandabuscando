import { Button } from "@/components/ui/Button";
import { SEARCH_TERM_MAX_LENGTH } from "@/constants/search";
import type { PublicSlug } from "@/lib/publicSlug";

/**
 * F-021 (design.md § 0, R14). A `<form method="get">`, server component, no
 * directive: the ✕ of `type="search"` and the browser's own submit history
 * are what a JavaScript-free page can still offer for free. The SAME
 * component mounts on `/[slug]`, `/[slug]/buscar` and
 * `/[slug]/p/[productSlug]` — repeating this markup in three pages is how
 * one of the three quietly loses its `role="search"` or its `min-h-11`.
 */
export function StoreSearchBox({
  storeSlug,
  storeName,
  term,
  autoFocus,
  showHelp,
}: {
  storeSlug: PublicSlug;
  storeName: string;
  /** Pre-fills the input — the raw value the shopper typed, not necessarily
   *  normalized (E11: a truncated term still shows what the search ran
   *  with, via the caller passing `StoreSearchResult.term`). */
  term?: string;
  /** Only the empty-query state sets this (design.md § Accesibilidad):
   *  writing is the only thing to do on that screen. */
  autoFocus?: boolean;
  /** Only the empty-query state of `/[slug]/buscar` sets this — on the
   *  catalogue and the product page it would be noise on a screen that
   *  already explains itself. */
  showHelp?: boolean;
}) {
  return (
    <form
      method="get"
      action={`/${storeSlug}/buscar`}
      role="search"
      aria-label={`Buscar en ${storeName}`}
      className="max-w-2xl"
    >
      <label htmlFor="q" className="sr-only">
        Buscar productos en {storeName}
      </label>
      <div className="flex gap-2">
        <input
          id="q"
          name="q"
          type="search"
          enterKeyHint="search"
          maxLength={SEARCH_TERM_MAX_LENGTH}
          defaultValue={term}
          autoFocus={autoFocus}
          placeholder="Buscar en la tienda"
          className="border-border bg-surface text-fg placeholder:text-fg-muted focus-visible:outline-brand min-h-11 min-w-0 flex-1 rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <Button type="submit" className="shrink-0">
          Buscar
        </Button>
      </div>
      {showHelp && (
        <p className="text-fg-muted mt-2 text-sm">
          Escribe el nombre de un producto. Por ejemplo: arroz, refresco o jabón.
        </p>
      )}
    </form>
  );
}
