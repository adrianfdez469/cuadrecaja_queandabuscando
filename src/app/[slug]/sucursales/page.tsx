import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireResolution } from "@/features/storefront/server/resolve";
import { Alert } from "@/components/ui/Alert";
import { Container } from "@/components/ui/Container";
import { BranchList } from "@/components/store/BranchList";
import { BranchSwitchNotice } from "@/features/cart/components/BranchSwitchNotice";

/**
 * Criterio 6: cambiar de sucursal, con el aviso del carrito ANTES de aplicar
 * nada (architecture.md § Cambiar de sucursal con el carrito lleno).
 *
 * `force-dynamic`/`revalidate = 0` LITERALES (ficha `revalidate-no-literal`):
 * pantalla de tránsito, como `/carrito` y `/checkout`. Nada se re-precia, se
 * traslada ni se vacía (HS5) — solo se informa.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { robots: { index: false } };

export default async function BranchSwitchPage({ params }: PageProps<"/[slug]/sucursales">) {
  const { slug } = await params;
  const resolution = await requireResolution(slug);

  const branches =
    resolution.kind === "selector" ? resolution.branches : (resolution.branches ?? []);

  // Una marca de una sola sucursal no tiene nada que elegir: el enlace que
  // llega aquí solo existe cuando hay 2+ sucursales renderizables (design.md
  // § 3).
  if (branches.length <= 1) notFound();

  const current =
    resolution.kind === "branch"
      ? branches.find((branch) => branch.storeId === resolution.storeId)
      : undefined;

  const anyClosed = branches.some((branch) => branch.status !== "PUBLISHED");

  return (
    <Container className="py-8">
      <Link
        href={current ? `/${current.canonicalSlug}` : `/${resolution.brandSlug}`}
        className="text-fg-muted text-sm hover:underline"
      >
        {current ? `← Volver a ${current.name}` : "← Volver"}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Cambiar de sucursal</h1>

      <Alert tone="muted" className="mt-4">
        <p>Tu carrito no se mueve: cada sucursal guarda el suyo.</p>
        <noscript>
          <p className="mt-1">
            Sin JavaScript no podemos contarte lo que tienes en cada carrito. No se borra nada: cada
            sucursal guarda el suyo.
          </p>
        </noscript>
      </Alert>

      {current && <BranchSwitchNotice storeId={current.storeId} branchName={current.name} />}

      {anyClosed && (
        <p className="text-fg-muted mt-2 text-sm">
          Una sucursal cerrada guarda su carrito igual: cuando vuelva a abrir, lo que armaste va a
          estar ahí.
        </p>
      )}

      <BranchList branches={branches} variant="switch" currentStoreId={current?.storeId} />
    </Container>
  );
}
