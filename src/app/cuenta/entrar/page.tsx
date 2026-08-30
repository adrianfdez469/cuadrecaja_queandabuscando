import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { safeNextPath, DEFAULT_NEXT } from "@/lib/safeNextPath";
import { SignInCard } from "@/features/account/components/SignInCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const KNOWN_AVISOS = new Set(["caducado", "cancelado", "sesion"]);

/**
 * E26: responds 200 even with Supabase Auth unconfigured — `SignInCard`
 * itself decides what to render, the page never redirects or 404s.
 */
export default async function SignInPage({ searchParams }: PageProps<"/cuenta/entrar">) {
  const query = await searchParams;
  const next = safeNextPath(firstParam(query.next));
  const rawAviso = firstParam(query.aviso);
  const aviso =
    rawAviso && KNOWN_AVISOS.has(rawAviso)
      ? (rawAviso as "caducado" | "cancelado" | "sesion")
      : null;
  const authConfigured = isSupabaseAuthConfigured();
  const showBackToStore = next !== DEFAULT_NEXT;

  return (
    <div className="flex min-h-full flex-col">
      <div className="bg-surface border-border border-b">
        <Container className="flex items-center justify-between py-3 text-sm">
          <Link href="/" className="min-w-0 truncate font-medium">
            queandabuscando
          </Link>
          {showBackToStore && (
            <Link href={next} className="shrink-0 underline">
              Volver a la tienda
            </Link>
          )}
        </Container>
      </div>

      <main className="flex-1">
        <Container className="py-10 sm:py-16">
          <Card className="mx-auto w-full max-w-sm p-6">
            <SignInCard next={next} authConfigured={authConfigured} aviso={aviso} />
          </Card>
        </Container>
      </main>
    </div>
  );
}
