"use client";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-3xl font-semibold">Algo salió mal</h1>
      <p className="text-fg-muted mt-3">Vuelve a intentarlo en un momento.</p>
      <Button className="mt-8" onClick={reset}>
        Reintentar
      </Button>
    </Container>
  );
}
