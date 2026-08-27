import { Alert } from "@/components/ui/Alert";
import { resolveStoreClosureHeadline, buildStoreClosureWhatsappUrl } from "@/lib/storeClosure";

/**
 * HD11: what a shopper sees at a closed store — 200, with the name, the
 * reason and a way to reach the business, never a 404 (the QR is on a wall).
 * No directive: the closed page has to be the LIGHTEST page in the app, not
 * a heavier one (design.md § 8).
 */
export function StoreClosedNotice({
  storeName,
  disabledReasonCode,
  disabledMessage,
  disabledAt,
  whatsapp,
  phone,
  address,
  extraNote,
}: {
  storeName: string;
  disabledReasonCode: string | null;
  disabledMessage: string | null;
  disabledAt: Date | null;
  whatsapp?: string | null;
  phone?: string | null;
  address?: string | null;
  /** The extra line `/carrito` and `/checkout` add about a saved cart. */
  extraNote?: string;
}) {
  const headline = resolveStoreClosureHeadline({ disabledReasonCode, disabledAt });
  const whatsappUrl = buildStoreClosureWhatsappUrl({
    storeName,
    whatsapp: whatsapp ?? null,
    phone: phone ?? null,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">{storeName}</h1>

      <Alert tone="warning" className="mt-4">
        {headline}
      </Alert>

      {disabledMessage && <p className="mt-3 whitespace-pre-line">{disabledMessage}</p>}

      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="bg-brand text-brand-contrast mt-4 inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium hover:opacity-90"
        >
          Escribir por WhatsApp
        </a>
      )}

      {address && <p className="text-fg-muted mt-3">Dirección: {address}</p>}

      {extraNote && <p className="text-fg-muted mt-4">{extraNote}</p>}

      <p className="text-fg-muted mt-6 text-sm">
        Esta página se actualiza sola cuando la tienda vuelva a abrir.
      </p>
    </div>
  );
}
