import { Container } from "@/components/ui/Container";

/**
 * F-027 (plan.md paso 9): own `not-found.tsx` for this segment, the same
 * mechanism as its siblings (`src/app/[slug]/not-found.tsx`,
 * `src/app/[slug]/c/[categorySlug]/not-found.tsx`) — it renders inside
 * `[slug]/layout.tsx`, so a slug that resolves to a brand's selector (E19:
 * there is no catalogue of its own to filter under it) still keeps the
 * store's own header and theme instead of falling through to the
 * platform's generic 404.
 *
 * Synchronous, no dynamic API (architecture.md § Patrones a seguir): this
 * component gets serialized into every 404 of this segment, so anything
 * dynamic here would cost more than the boundary is worth.
 */
export default function CatalogNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold">Este catálogo no está disponible</h1>
      <p className="text-fg-muted mt-3 max-w-md">
        Elige una sucursal para ver y filtrar su catálogo.
      </p>
    </Container>
  );
}
