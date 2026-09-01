import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { listManagedStores } from "@/features/admin/server/stores";
import { StoreList } from "@/features/admin/components/StoreList";
import { Container } from "@/components/ui/Container";

// Per-admin, authenticated content: never statically rendered or cached (R9).
export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  // The layout redirects too, but a layout and its page render in PARALLEL:
  // the page can reach this line before that redirect takes effect. It only
  // shows when the layout's path is the slower one — with an unreadable
  // cookie, `getAdminSession()` awaits `jwtVerify` and loses the race, so a
  // non-null assertion here threw `Cannot read properties of null` on every
  // request carrying a stale or tampered cookie. The redirect is the answer,
  // not the assertion.
  const session = await getAdminSession();
  if (!session) redirect("/?admin=sesion-requerida");
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
