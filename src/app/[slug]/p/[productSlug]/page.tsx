import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, isOrderable } from "@/lib/availability";
import { displayPrice } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import {
  getPublishedStoreSlugs,
  getStoreCatalog,
  getStoreRates,
  requireStore,
} from "@/features/catalog/server/queries";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

/**
 * Pre-render the catalogue of every published store. Like the store page, this
 * is a warm-start optimisation: anything missed renders on first request.
 */
export async function generateStaticParams() {
  const slugs = await getPublishedStoreSlugs();
  const params = await Promise.all(
    slugs.map(async (slug) => {
      const catalog = await getStoreCatalog(slug);
      return catalog.map((product) => ({ slug, productSlug: product.slug }));
    }),
  );
  return params.flat();
}

export async function generateMetadata({
  params,
}: PageProps<"/[slug]/p/[productSlug]">): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const product = (await getStoreCatalog(slug)).find((p) => p.slug === productSlug);
  if (!product) return { title: "Producto no encontrado" };

  return {
    title: product.name,
    description: product.description ?? undefined,
    openGraph: {
      title: product.name,
      images: product.imageUrls.slice(0, 1),
    },
  };
}

export default async function ProductPage({ params }: PageProps<"/[slug]/p/[productSlug]">) {
  const { slug, productSlug } = await params;
  const [store, catalog, rates] = await Promise.all([
    requireStore(slug),
    getStoreCatalog(slug),
    getStoreRates(slug),
  ]);

  const product = catalog.find((candidate) => candidate.slug === productSlug);
  if (!product) notFound();

  let price: string | null;
  try {
    price = formatMoney(displayPrice(product, store.baseCurrencyCode, rates));
  } catch {
    price = null;
  }

  const image = product.imageUrls[0];

  return (
    <Container className="grid gap-8 py-8 md:grid-cols-2">
      <div className="bg-surface-muted relative aspect-square overflow-hidden rounded-lg">
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            priority
          />
        ) : (
          <div className="text-fg-muted flex h-full items-center justify-center">Sin imagen</div>
        )}
      </div>

      <div>
        {product.categoryName && <p className="text-fg-muted text-sm">{product.categoryName}</p>}
        <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>

        <p className="text-brand mt-4 text-3xl font-semibold">
          {price ?? <span className="text-fg-muted">Consultar precio</span>}
        </p>

        <div className="mt-3">
          <Badge tone={AVAILABILITY_TONE[product.availability]}>
            {AVAILABILITY_LABEL[product.availability]}
          </Badge>
        </div>

        {product.description && (
          <p className="text-fg-muted mt-6 whitespace-pre-line">{product.description}</p>
        )}

        <div className="mt-8">
          <Button size="lg" disabled={!isOrderable(product.availability)}>
            {isOrderable(product.availability) ? "Agregar al carrito" : "Agotado"}
          </Button>
        </div>
      </div>
    </Container>
  );
}
