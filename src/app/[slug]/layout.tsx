import Link from "next/link";
import { requireStore } from "@/features/catalog/server/queries";
import { renderStoreTheme } from "@/features/theming/storeTheme";
import { Container } from "@/components/ui/Container";

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

  return (
    <div data-store={store.slug} className="flex min-h-full flex-col">
      {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}

      {/* The brand colour has to land somewhere the shopper actually looks, or
          per-store theming is a mechanism with no visible effect. */}
      <header className="bg-brand text-brand-contrast">
        <Container className="flex items-center gap-3 py-5">
          <Link href={`/${store.slug}`} className="text-xl font-semibold tracking-tight">
            {store.name}
          </Link>
          {store.city && <span className="text-sm opacity-80">· {store.city}</span>}
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
