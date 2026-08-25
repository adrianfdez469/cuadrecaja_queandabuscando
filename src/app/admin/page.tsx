import { getAdminSession } from "@/lib/auth/adminSession";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  // The layout already guarantees a session; this is only for the display name.
  const session = await getAdminSession();

  return (
    <Container className="py-8">
      <h1 className="text-2xl font-semibold">Tus tiendas</h1>
      <p className="text-fg-muted mt-2">
        Acceso concedido desde Cuadre de Caja para {session?.storeIds.length ?? 0} tienda(s).
      </p>

      <Card className="mt-6 p-6">
        <p className="text-fg-muted">
          El panel todavía no tiene funcionalidad. Los features pendientes están en
          <code className="bg-surface-muted mx-1 rounded px-1.5 py-0.5 text-sm">
            .agent/features.json
          </code>
          .
        </p>
      </Card>
    </Container>
  );
}
