import Link from "next/link";
import { Container } from "@/components/ui/Container";

export default function NotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-3xl font-semibold">No encontramos esta página</h1>
      <p className="text-fg-muted mt-3">
        Puede que la tienda no exista o que ya no esté publicada.
      </p>
      <Link href="/" className="text-brand mt-8 underline underline-offset-4">
        Volver al inicio
      </Link>
    </Container>
  );
}
