/**
 * `wa.me` link on `/[slug]/pedido/[code]` — an `<a>`, not a button, and a
 * server component: this page carries zero client modules (DP2). The link
 * is an atajo opcional (DP1), never presented as a pending step.
 */
export function WhatsappOrderLink({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="bg-surface-muted rounded-md p-4 text-sm">
        <p>
          Esta tienda todavía no tiene un número de WhatsApp publicado. Guarda tu código: la tienda
          ya recibió el pedido.
        </p>
      </div>
    );
  }

  return (
    <div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-brand text-brand-contrast inline-flex min-h-12 w-full items-center justify-center rounded-md px-6 text-lg font-medium hover:opacity-90 sm:w-auto"
      >
        Enviar el pedido por WhatsApp
      </a>
      <p className="text-fg-muted mt-2 text-sm">
        Si quieres, avísale también por WhatsApp: se abre con el mensaje ya escrito.
      </p>
    </div>
  );
}
