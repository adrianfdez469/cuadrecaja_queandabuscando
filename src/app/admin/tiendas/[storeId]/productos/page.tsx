import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { authorizeStore } from "@/features/admin/authorization";
import { listStoreProducts } from "@/features/admin/server/products";
import { ProductTable } from "@/features/admin/components/ProductTable";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

export default async function StoreProductsPage({
  params,
  searchParams,
}: PageProps<"/admin/tiendas/[storeId]/productos">) {
  const { storeId } = await params;
  const query = await searchParams;

  const session = await getAdminSession();
  const authorized = authorizeStore(session, storeId);
  if (!authorized.ok) notFound();

  const q = typeof query.q === "string" ? query.q : "";
  const page = Number(typeof query.pagina === "string" ? query.pagina : "1") || 1;

  const result = await listStoreProducts(authorized.storeId, { page, q: q || null });

  return (
    <Container className="py-8">
      <Link href={`/admin/tiendas/${storeId}`} className="text-fg-muted text-sm hover:underline">
        ← Tienda
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Productos</h1>

      <form method="get" className="mt-4 flex gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar por nombre
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre"
          className="border-border w-full max-w-sm rounded-md border px-3 py-2 text-sm"
        />
        <button type="submit" className="bg-surface-muted rounded-md border px-3 py-2 text-sm">
          Buscar
        </button>
      </form>

      <div className="mt-6">
        <ProductTable
          storeId={storeId}
          products={result.items}
          q={q}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
        />
      </div>
    </Container>
  );
}
