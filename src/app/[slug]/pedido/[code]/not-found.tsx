import Link from "next/link";
import { Container } from "@/components/ui/Container";

/**
 * Own `not-found.tsx` for this segment (not the app-wide one): it renders
 * inside `[slug]/layout.tsx`, so a wrong or foreign code still shows the
 * store's own header instead of losing the tienda's frame entirely (E17).
 */
export default function OrderNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold">No encontramos ese pedido.</h1>
      <p className="text-fg-muted mt-3">
        Revisa el código: son 10 caracteres y a veces se confunde un 0 con una O.
      </p>
      <Link href=".." className="text-brand mt-8 underline underline-offset-4">
        Ver el catálogo
      </Link>
    </Container>
  );
}
