import { Container } from "@/components/ui/Container";

/**
 * Two queries (`architecture.md` § Lectura de la pantalla), so this is
 * almost never seen — existing is what keeps a slow connection from
 * flashing a blank page instead. Zero JavaScript.
 */
export default function Loading() {
  return (
    <Container className="py-8">
      <h1 className="mt-1 text-2xl font-semibold">Colores de tu marca</h1>
      <p role="status" className="text-fg-muted mt-2 text-sm">
        Cargando los colores de tu marca…
      </p>
    </Container>
  );
}
