import { getAdminSession } from "@/lib/auth/adminSession";
import { listManagedStores } from "@/features/admin/server/stores";
import { StoreList } from "@/features/admin/components/StoreList";
import { Container } from "@/components/ui/Container";

// Per-admin, authenticated content: never statically rendered or cached (R9).
export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  // The layout already redirects when there is no session.
  const session = (await getAdminSession())!;
  const stores = await listManagedStores(session);
  const missingCount = session.storeIds.length - stores.length;

  return (
    <Container className="py-8">
      <h1 className="text-2xl font-semibold">Tus tiendas</h1>
      <div className="mt-6">
        <StoreList stores={stores} missingCount={missingCount} />
      </div>
    </Container>
  );
}
