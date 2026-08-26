import type { Metadata } from "next";
import { requireStore } from "@/features/catalog/server/queries";
import { Container } from "@/components/ui/Container";
import { CheckoutForm } from "@/features/cart/components/CheckoutForm";

/**
 * Dynamic on purpose (R19): the checkout re-prices against the server on
 * every visit (delivery options and totals both come from `quote`, never
 * from a cached shell). Literal, not imported — revalidate-no-literal.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { robots: { index: false } };

export default async function CheckoutPage({ params }: PageProps<"/[slug]/checkout">) {
  const { slug } = await params;
  const store = await requireStore(slug);

  return (
    <Container className="py-8">
      <CheckoutForm storeId={store.id} storeSlug={store.slug} />
    </Container>
  );
}
