import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { ResponsiveImage } from "@/components/ui/ResponsiveImage";
import { AVAILABILITY_LABEL, AVAILABILITY_TONE } from "@/lib/availability";
import type { AdminProductRow } from "../types";

/**
 * `/admin/tiendas/[storeId]/productos` listing (E14). Server component, zero
 * client JavaScript — the screen the admin opens the most.
 *
 * Bulk selection → "create a promotion with these" (design.md § 3) is out of
 * this cycle's scope: promotions ship in the next one. See `impl.md` §
 * Desviaciones.
 */
export function ProductTable({
  storeId,
  products,
  q,
  page,
  pageSize,
  total,
}: {
  storeId: string;
  products: AdminProductRow[];
  q: string;
  page: number;
  pageSize: number;
  total: number;
}) {
  if (total === 0 && !q) {
    return (
      <Alert tone="muted">
        <p>Todavía no hay productos en esta tienda.</p>
        <p>
          Los productos los crea Cuadre de Caja al sincronizar. Cuando aparezcan aquí vas a poder
          ponerles foto, descripción y precio online.
        </p>
      </Alert>
    );
  }

  if (products.length === 0 && q) {
    return (
      <div>
        <p>No encontramos ningún producto con «{q}».</p>
        <Link href={`/admin/tiendas/${storeId}/productos`} className="text-brand hover:underline">
          Ver todos los productos
        </Link>
      </div>
    );
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div>
      <ul className="divide-border divide-y">
        {products.map((product) => (
          <li
            key={product.id}
            className="flex items-center gap-3 py-3"
            data-store-product-id={product.id}
          >
            <div className="bg-surface-muted relative size-12 shrink-0 overflow-hidden rounded">
              {product.imageUrls[0] ? (
                <ResponsiveImage
                  src={product.imageUrls[0]}
                  alt=""
                  variant="card"
                  fetchPriority="low"
                />
              ) : (
                // design.md § 4 Accesibilidad: `text-[10px]` in a 48px box
                // does not read on screen — visually a clean gray box, still
                // announced to screen readers.
                <span className="sr-only">Sin imagen</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {product.deletedAt ? (
                <span className="text-fg-muted">{product.localName}</span>
              ) : (
                <Link
                  href={`/admin/tiendas/${storeId}/productos/${product.id}`}
                  className="font-medium hover:underline"
                >
                  {product.localName}
                </Link>
              )}
              {product.categoryName && (
                <p className="text-fg-muted text-sm">{product.categoryName}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {product.deletedAt ? (
                <Badge tone="danger">Borrado en Cuadre de Caja</Badge>
              ) : (
                <>
                  {!product.visible && <Badge tone="muted">Oculto</Badge>}
                  {product.featured && <Badge tone="warning">Destacado</Badge>}
                  {product.priceOverride !== null && <Badge tone="muted">Precio propio</Badge>}
                  {AVAILABILITY_LABEL[product.availability] !== "Disponible" && (
                    <Badge tone={AVAILABILITY_TONE[product.availability]}>
                      {AVAILABILITY_LABEL[product.availability]}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {total > pageSize && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <span className="text-fg-muted">
            {from}–{to} de {total}
          </span>
          <span className="flex gap-3">
            {page > 1 && (
              <Link href={pageHref(storeId, q, page - 1)} className="text-brand hover:underline">
                Anterior
              </Link>
            )}
            {to < total && (
              <Link href={pageHref(storeId, q, page + 1)} className="text-brand hover:underline">
                Siguiente
              </Link>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}

function pageHref(storeId: string, q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("pagina", String(page));
  return `/admin/tiendas/${storeId}/productos?${params.toString()}`;
}
