import Link from "next/link";
import { requireStore } from "@/features/catalog/server/queries";
import { renderStoreTheme } from "@/features/theming/storeTheme";
import { Container } from "@/components/ui/Container";
import { CartBadge } from "@/features/cart/components/CartBadge";

/**
 * ISR floor, in seconds. On-demand `revalidateTag` from the sync is what
 * actually keeps these pages fresh; this is only the backstop for a store
 * nobody has touched.
 *
 * Must be a literal: Next statically analyses segment config exports, and an
 * imported constant fails the build. Keep in sync with STOREFRONT_REVALIDATE
 * in @/lib/cache.
 */
export const revalidate = 3600;

export default async function StoreLayout({ children, params }: LayoutProps<"/[slug]">) {
  const { slug } = await params;
  const store = await requireStore(slug);

  // Branding is plain CSS in the HTML: no JavaScript, no flash of the wrong
  // palette, and it is cached by the CDN along with the rest of the page.
  const themeCss = renderStoreTheme(store.slug, store.themeTokens);

  // HD11: a closed store's header carries its name and city, same as always,
  // but never the cart — there is nothing to buy here right now — and the
  // name is text, not a link: there is nowhere else on this page to go to.
  const closed = store.status !== "PUBLISHED";

  return (
    <div data-store={store.slug} className="flex min-h-full flex-col">
      {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}

      {/* The brand colour has to land somewhere the shopper actually looks, or
          per-store theming is a mechanism with no visible effect. */}
      <header className="bg-brand text-brand-contrast">
        <Container className="flex items-center gap-3 py-5">
          {closed ? (
            <span className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
              {store.name}
            </span>
          ) : (
            <Link
              href={`/${store.slug}`}
              className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight"
            >
              {store.name}
            </Link>
          )}
          {store.city && (
            <span className="hidden text-sm opacity-80 sm:inline">· {store.city}</span>
          )}
          {!closed && <CartBadge storeId={store.id} storeSlug={store.slug} />}
        </Container>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-border border-t py-8">
        <Container className="text-fg-muted text-sm">
          {store.address && <p>{store.address}</p>}
          <p className="mt-2">Publicado con queandabuscando</p>
        </Container>
      </footer>
    </div>
  );
}
