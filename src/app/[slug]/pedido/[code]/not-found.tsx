import { Container } from "@/components/ui/Container";

/**
 * Own `not-found.tsx` for this segment (not the app-wide one): it renders
 * inside `[slug]/layout.tsx`, so a wrong or foreign code still shows the
 * store's own header instead of losing the tienda's frame entirely (E17).
 *
 * F-025: lost its own relative `<Link>` up a level. That link resolved
 * against whatever slug the browser was on, so entering through an alias
 * sent a shopper back to the alias instead of the canonical slug (I3) — and
 * `not-found.tsx` gets no `params` in this Next version, so it cannot know
 * which slug is canonical to build a better one itself. The way out is now
 * the header's own link (`src/app/[slug]/layout.tsx:85-90`), which does
 * have the canonical slug (architecture.md § Los dos `not-found.tsx` sin
 * `params`).
 */
export default function OrderNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold">No encontramos ese pedido.</h1>
      <p className="text-fg-muted mt-3">
        Revisa el código: son 10 caracteres y a veces se confunde un 0 con una O.
      </p>
    </Container>
  );
}
