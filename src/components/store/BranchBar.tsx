import Link from "next/link";
import { Container } from "@/components/ui/Container";
import type { PublicSlug } from "@/lib/publicSlug";

/**
 * The tira `Estás en … · Cambiar de sucursal` (design.md § 2). Server
 * component, `●`, zero client JavaScript: a single `<a>`, never an island —
 * that is what keeps it out of `check:bundle`'s measurement entirely.
 *
 * First child of the catalogue page (`/[slug]` in "branch" mode) and the
 * product page — the two "looking" pages, never `/carrito` or `/checkout`
 * (design.md: offering "change branch" two fields from paying pushes people
 * to abandon).
 */
export function BranchBar({
  branchName,
  canonicalSlug,
  branchCount,
  isOpen,
}: {
  branchName: string;
  canonicalSlug: PublicSlug;
  branchCount: number;
  isOpen: boolean;
}) {
  if (branchCount <= 1) return null;

  const others = branchCount - 1;
  const othersLabel = others === 1 ? "la otra sucursal" : `las otras ${others} sucursales`;

  return (
    <nav aria-label="Sucursal" className="bg-surface-muted">
      <Container className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span>{isOpen ? `Estás en ${branchName}.` : "Esta sucursal está cerrada."}</span>
        <Link href={`/${canonicalSlug}/sucursales`} className="text-brand min-h-11 font-medium">
          {isOpen ? "Cambiar de sucursal" : `Ver ${othersLabel}`}
        </Link>
      </Container>
    </nav>
  );
}
