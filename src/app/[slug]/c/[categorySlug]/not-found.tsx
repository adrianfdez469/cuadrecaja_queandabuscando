import { Container } from "@/components/ui/Container";

/**
 * Own `not-found.tsx` for this segment, exactly like
 * `src/app/[slug]/pedido/[code]/not-found.tsx`: it renders inside
 * `[slug]/layout.tsx`, so a categorySlug that no longer resolves — usually
 * because the merchant deleted the category in the POS (E8, I4) — still
 * shows the store's own header instead of losing the tienda's frame
 * entirely (R6).
 *
 * F-025: lost its own relative `<Link>` up a level. That link resolved
 * against whatever slug the browser was on, so entering through an alias
 * sent a shopper back to the alias instead of the canonical slug (I10, the
 * same defect I3 already named) — and `not-found.tsx` gets no `params` in
 * this Next version, so it cannot know which slug is canonical to build a
 * better one itself. The way out is now the header's own link
 * (`src/app/[slug]/layout.tsx:85-90`), which does have the canonical slug
 * (architecture.md § Los dos `not-found.tsx` sin `params`).
 */
export default function CategoryNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold">Esta categoría ya no está</h1>
      <p className="text-fg-muted mt-3 max-w-md">
        Puede que la tienda la haya quitado o que sus productos hayan cambiado de sitio. Siguen en
        el catálogo.
      </p>
    </Container>
  );
}
