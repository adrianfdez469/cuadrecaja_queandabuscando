import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { classifyStoreClosure } from "@/lib/storeClosure";
import type { AdminStoreListItem } from "../types";

/**
 * `/admin` listing (E1). Server component, zero client JavaScript: this is
 * the screen `curl -b <cookie>` exercises for criterio 1.
 */
export function StoreList({
  stores,
  missingCount,
}: {
  stores: AdminStoreListItem[];
  missingCount: number;
}) {
  if (stores.length === 0) {
    return (
      <Alert tone="muted">
        <p>Todavía no tienes ninguna tienda asignada.</p>
        <p>Publica un local desde Cuadre de Caja y va a aparecer aquí.</p>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {missingCount > 0 && (
        <p className="text-fg-muted text-sm">
          Una de las tiendas de tu acceso ya no está disponible.
        </p>
      )}
      <ul className="space-y-3">
        {stores.map((store) => (
          <li key={store.id}>
            <Card className="p-4" data-store-id={store.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    <Link href={`/admin/tiendas/${store.id}`} className="hover:underline">
                      {store.name}
                    </Link>
                  </h2>
                  <p className="text-fg-muted truncate text-sm">
                    {[store.city, store.address].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Badge tone={publicBadgeTone(store)}>{publicBadgeLabel(store)}</Badge>
              </div>

              {publicBadgeSecondLine(store) && (
                <p className="text-fg-muted mt-2 text-sm">{publicBadgeSecondLine(store)}</p>
              )}

              <div className="mt-3 flex gap-4 text-sm">
                <Link
                  href={`/admin/tiendas/${store.id}/productos`}
                  className="text-brand font-medium hover:underline"
                >
                  Productos
                </Link>
                {store.status !== "DRAFT" && (
                  <a
                    href={`/${store.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Ver la tienda en una pestaña nueva"
                    className="text-brand font-medium hover:underline"
                  >
                    Ver la tienda ↗
                  </a>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * HD10-HD15: the listing's single `Badge` answers "can my customers buy
 * right now" (design.md § 1/§ 9), not the raw `Store.status` enum — a
 * SUSPENDED store closed from the panel or the POS is "Cerrada", never
 * "Suspendida" (that word is reserved for a platform-level suspension,
 * which nothing in this feature produces yet).
 */
function publicBadgeLabel(store: AdminStoreListItem): string {
  if (store.status === "DRAFT") return "Borrador";
  if (store.status === "PUBLISHED") return "Abierta";
  const attribution = classifyStoreClosure(store);
  return attribution === "platform" ? "Suspendida" : "Cerrada";
}

function publicBadgeTone(store: AdminStoreListItem): "positive" | "warning" | "muted" | "danger" {
  if (store.status === "DRAFT") return "muted";
  if (store.status === "PUBLISHED") return "positive";
  return classifyStoreClosure(store) === "platform" ? "danger" : "warning";
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-CU", { day: "numeric", month: "short" });
}

function publicBadgeSecondLine(store: AdminStoreListItem): string | null {
  if (store.status === "DRAFT") return "Se publica desde Cuadre de Caja.";
  if (store.status === "PUBLISHED") return null;
  switch (classifyStoreClosure(store)) {
    case "admin":
      return `La cerraste tú el ${shortDate(store.disabledAt)}.`;
    case "pos":
      return `La cerró Cuadre de Caja el ${shortDate(store.disabledAt)}.`;
    case "never_opened":
      return "Nunca la abriste al público.";
    case "platform":
      return "Escribe a soporte.";
  }
}
