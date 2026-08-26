import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/adminSession";
import { Container } from "@/components/ui/Container";

/** Never cached: this is per-admin, authenticated content. */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await getAdminSession();
  if (!session) redirect("/?admin=sesion-requerida");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-border bg-surface border-b">
        <Container className="flex items-center justify-between py-4">
          <Link href="/admin" className="font-semibold hover:underline">
            Panel de administración
          </Link>
          <span className="text-fg-muted text-sm">{session.name}</span>
        </Container>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
