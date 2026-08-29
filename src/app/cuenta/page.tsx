import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { getCustomerUser, hasCustomerSessionCookie } from "@/lib/auth/customerSession";
import { ensureCustomerForUser } from "@/features/account/server/customers";
import { safeNextPath } from "@/lib/safeNextPath";
import { ProfileForm } from "@/features/account/components/ProfileForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * E24/E25: no "loading" state (NC5) — the profile is resolved server-side
 * and lands in the HTML already filled in. Without a session, redirects to
 * `/cuenta/entrar`; a stale hint cookie (E25) is the only thing that adds
 * `aviso=sesion` — a visitor who never had a cookie at all sees no aviso.
 */
export default async function AccountPage({ searchParams }: PageProps<"/cuenta">) {
  const query = await searchParams;
  const desde = safeNextPath(firstParam(query.desde));

  const user = await getCustomerUser();
  if (!user) {
    const hadCookie = await hasCustomerSessionCookie();
    const target = hadCookie
      ? "/cuenta/entrar?next=/cuenta&aviso=sesion"
      : "/cuenta/entrar?next=/cuenta";
    redirect(target);
  }

  const profile = await ensureCustomerForUser(user);
  const showBackToStore = desde !== "/cuenta";

  return (
    <div className="flex min-h-full flex-col">
      <div className="bg-surface border-border border-b">
        <Container className="flex items-center justify-between py-3 text-sm">
          <Link href="/" className="min-w-0 truncate font-medium">
            queandabuscando
          </Link>
          {showBackToStore && (
            <Link href={desde} className="shrink-0 underline">
              Volver a la tienda
            </Link>
          )}
        </Container>
      </div>

      <main className="flex-1">
        <Container className="py-10 sm:py-16">
          <div className="mx-auto w-full max-w-md">
            <h1 className="text-2xl font-semibold">Tu cuenta</h1>
            {!profile.name && !profile.phone && !profile.email && (
              <p className="text-fg-muted mt-2 text-sm">
                Completa tus datos y no vuelvas a teclearlos en cada pedido.
              </p>
            )}
            <Card className="mt-6 p-6">
              <ProfileForm initialProfile={profile} />
            </Card>
          </div>
        </Container>
      </main>
    </div>
  );
}
