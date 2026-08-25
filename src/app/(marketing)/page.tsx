import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "queandabuscando · Tiendas online para tu negocio",
  description:
    "Conecta tu negocio de Cuadre de Caja con una tienda online donde tus clientes hacen pedidos.",
};

export default function LandingPage() {
  return (
    <main className="flex-1">
      <Container className="py-20">
        <p className="text-brand text-sm font-medium tracking-wide uppercase">
          Complemento de Cuadre de Caja
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold text-balance sm:text-5xl">
          Tu inventario ya está listo. Ahora dale una tienda online.
        </h1>
        <p className="text-fg-muted mt-6 max-w-xl text-lg">
          Los productos, precios y disponibilidad que ya gestionas en Cuadre de Caja se publican
          solos. Tus clientes ven el catálogo y hacen pedidos desde el teléfono.
        </p>
      </Container>
    </main>
  );
}
