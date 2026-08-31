import { Container } from "@/components/ui/Container";

/**
 * Own `not-found.tsx` for `/[slug]/**` (I6, E15): a product that no longer
 * resolves (`/[slug]/p/no-existe`, and any other `notFound()` under this
 * segment without a closer `not-found.tsx` of its own) still renders inside
 * `src/app/[slug]/layout.tsx`, so the shopper keeps the store's header, its
 * theme and `data-store` instead of falling through to the platform's
 * generic 404 — measured, not assumed: architecture.md § El 404 dentro de
 * una tienda.
 *
 * No `<Link>` here, on purpose: the canonical way out is the header this
 * layout already renders (`src/app/[slug]/layout.tsx:85-90`), which is the
 * one place in the tree that has the canonical slug at hand. `not-found.tsx`
 * gets no `params` in this Next version — see the two `not-found.tsx`
 * siblings for why that rules out a slug-aware exit here — and a second,
 * un-slugged link would either resolve relative (I3/I10's mistake) or
 * duplicate the header's own destination.
 *
 * Synchronous, no dynamic API, no query (R18, architecture.md § Un efecto
 * secundario): this component gets serialized into EVERY page's payload of
 * this segment as a prop of the boundary, 404 or not, so anything dynamic
 * here would turn `/[slug]`, `/[slug]/p/[productSlug]` and
 * `/[slug]/c/[categorySlug]` from `●` to `ƒ` for every request, not just a
 * 404 one.
 */
export default function StoreNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold">Este producto ya no está</h1>
      <p className="text-fg-muted mt-3 max-w-md">
        Puede que la tienda lo haya quitado o que se haya quedado sin existencias. El resto del
        catálogo sigue disponible.
      </p>
    </Container>
  );
}
