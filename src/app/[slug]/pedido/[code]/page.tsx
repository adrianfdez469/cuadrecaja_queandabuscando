import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatOrderCode } from "@/lib/orderCode";
import { getOrderByCode, orderWhatsappUrl } from "@/features/orders/server/read";
import { OrderStatusBadge } from "@/features/orders/components/OrderStatusBadge";
import { OrderLinesTable } from "@/features/orders/components/OrderLinesTable";
import { WhatsappOrderLink } from "@/features/orders/components/WhatsappOrderLink";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";

/**
 * The order confirmation / status page — 100% server, zero client modules of
 * its own (DP2, R18). Never cached: it shows a customer's name, phone and
 * address, and its status has to reflect what the POS just reported (E19).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { robots: { index: false } };

export default async function OrderPage({ params }: PageProps<"/[slug]/pedido/[code]">) {
  const { slug, code } = await params;
  const order = await getOrderByCode(slug, code);
  if (!order) notFound();

  const whatsappUrl = orderWhatsappUrl(order);

  return (
    <Container className="max-w-2xl py-8 lg:max-w-4xl">
      <div className="bg-positive/12 text-positive rounded-md p-4">
        <p className="text-lg font-semibold">¡Pedido recibido!</p>
      </div>

      <div className="mt-6">
        <p className="text-fg-muted text-sm">Tu código</p>
        <p
          className="text-3xl font-semibold tracking-[0.2em] sm:text-4xl"
          aria-label={`Código del pedido: ${formatOrderCode(order.code).split("").join(" ")}`}
        >
          {formatOrderCode(order.code)}
        </p>
        <p className="text-fg-muted mt-1 text-sm">
          Guarda este código: es la forma de encontrar tu pedido.
        </p>

        <div className="mt-4">
          <OrderStatusBadge status={order.status} hasDelivery={order.fulfillment === "DELIVERY"} />
        </div>
      </div>

      {order.checkoutMode === "WHATSAPP" && (
        <div className="mt-6">
          <WhatsappOrderLink url={whatsappUrl} />
        </div>
      )}

      <p className="text-fg-muted mt-6 text-sm">
        La tienda va a revisar tu pedido y te va a contactar por teléfono para confirmarlo. Al
        enviarlo no se reserva ninguna unidad ni se cobra nada.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-lg font-semibold">Entrega</h2>
          <p className="text-fg-muted mt-2 text-sm">
            {order.fulfillment === "DELIVERY"
              ? `Envío a ${order.deliveryAddress}`
              : "Recoger en la tienda"}
          </p>

          <h2 className="mt-6 text-lg font-semibold">Contacto</h2>
          <p className="text-fg-muted mt-2 text-sm">
            {order.contact.name}
            <br />
            {order.contact.phone}
            {order.contact.email && (
              <>
                <br />
                {order.contact.email}
              </>
            )}
          </p>
          {order.notes && (
            <>
              <h2 className="mt-6 text-lg font-semibold">Notas</h2>
              <p className="text-fg-muted mt-2 text-sm whitespace-pre-line">{order.notes}</p>
            </>
          )}
        </Card>

        <Card className="p-4">
          <OrderLinesTable
            items={order.items}
            currencyCode={order.currencyCode}
            subtotal={order.subtotal}
            deliveryFee={order.deliveryFee}
            total={order.total}
          />
        </Card>
      </div>

      <p className="text-fg-muted mt-6 text-xs">
        Actualiza la página para ver el estado más reciente.
      </p>

      <a href={`/${slug}`} className="text-brand mt-8 inline-block underline">
        Seguir comprando
      </a>
    </Container>
  );
}
