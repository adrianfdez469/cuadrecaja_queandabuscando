import { Container } from "@/components/ui/Container";

/**
 * F-011 tanda 3 (DP12, design.md VE26/§ 10): `src/lib/slug.ts` reserved this
 * top-level slug from the ciclo 1, and `GroupStoresForm` already
 * `router.push`es here on a 401 — but until this page existed, that landed
 * on a 404. Server component, zero JavaScript: it only explains what
 * happened and where to go back to. No `redirect()` back to `/admin`: an
 * admin who just lost a session should not bounce through another
 * unauthenticated request.
 */
export default function SessionClosedPage() {
  return (
    <Container className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Tu sesión se cerró</h1>
      <p className="text-fg-muted mx-auto mt-3 max-w-md text-sm">
        Vuelve a entrar desde Cuadre de Caja para seguir administrando tu tienda.
      </p>
    </Container>
  );
}
