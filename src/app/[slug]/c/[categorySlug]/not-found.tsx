import Link from "next/link";
import { Container } from "@/components/ui/Container";

/**
 * Own `not-found.tsx` for this segment, exactly like
 * `src/app/[slug]/pedido/[code]/not-found.tsx`: it renders inside
 * `[slug]/layout.tsx`, so a categorySlug that no longer resolves — usually
 * because the merchant deleted the category in the POS (E8, I4) — still
 * shows the store's own header instead of losing the tienda's frame
 * entirely (R6).
 *
 * `not-found.tsx` receives no `params` in Next, so the way out is a
 * RELATIVE link, resolved by the browser against the current URL
 * (`/[slug]/c/[categorySlug]`, three path segments): a single `href=".."`
 * lands on `/[slug]` — verified with `new URL("..", currentUrl)`, the same
 * WHATWG resolution `next/link` hands straight to the `<a>` it renders in
 * the app router. Same single level as
 * `src/app/[slug]/pedido/[code]/not-found.tsx`, whose own segment sits at
 * the same depth.
 */
export default function CategoryNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold">Esta categoría ya no está</h1>
      <p className="text-fg-muted mt-3 max-w-md">
        Puede que la tienda la haya quitado o que sus productos hayan cambiado de sitio. Siguen en
        el catálogo.
      </p>
      <Link href=".." className="text-brand mt-8 underline underline-offset-4">
        Ver todo el catálogo
      </Link>
    </Container>
  );
}
