import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatOrderCode } from "@/lib/orderCode";
import { getOrderByCode, orderWhatsappUrl } from "@/features/orders/server/read";
import { OrderStatusBadge } from "@/features/orders/components/OrderStatusBadge";
import { OrderLinesTable } from "@/features/orders/components/OrderLinesTable";
import { OrderProposalCard } from "@/features/orders/components/OrderProposalCard";
import { WhatsappOrderLink } from "@/features/orders/components/WhatsappOrderLink";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { requireStore } from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { branchTrailStore, orderTrail } from "@/features/storefront/trail";
import { StoreTrail } from "@/components/store/StoreTrail";
import { buildCustomerContactUrl } from "@/features/orders/whatsapp";
import { buildProposalDiff } from "@/features/orders/proposalDiff";
import { isProposalExpired } from "@/features/orders/deadline";
import { ORDER_RESPONSE_OUTCOME, type OrderResponseOutcome } from "@/constants/orders";

/**
 * The order confirmation / status page — 100% server, zero client modules of
 * its own (DP2, R18). Never cached: it shows a customer's name, phone and
 * address, and its status has to reflect what the POS just reported (E19).
 *
 * F-019: extended with the proposal panel (design.md § 4.1-4.6). PP4: the
 * F-010 expectation paragraph keeps showing, literally unchanged, for
 * `PENDING`/`PULLED`/`CONFIRMED`/`READY`/`DELIVERED` — it is only false, and
 * only removed, for `AWAITING_CUSTOMER`/`CANCELLED`/`REJECTED_BY_STORE`.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { robots: { index: false } };

const EXPECTATION_PARAGRAPH_STATUSES = new Set([
  "PENDING",
  "PULLED",
  "CONFIRMED",
  "READY",
  "DELIVERED",
]);

const RESPONSE_BANNERS: Record<
  OrderResponseOutcome,
  { tone: "positive" | "muted" | "warning" | "danger"; text: string }
> = {
  [ORDER_RESPONSE_OUTCOME.APPROVED]: {
    tone: "positive",
    text: "Aprobaste el cambio. La tienda ya lo sabe y prepara tu pedido con los importes nuevos.",
  },
  [ORDER_RESPONSE_OUTCOME.REJECTED]: {
    tone: "muted",
    text: "Rechazaste el cambio y el pedido quedó cancelado. La tienda ya lo sabe.",
  },
  [ORDER_RESPONSE_OUTCOME.EXPIRED]: {
    tone: "danger",
    text: "No pudimos registrar tu respuesta: el plazo ya se había acabado.",
  },
  [ORDER_RESPONSE_OUTCOME.CONFLICT]: {
    tone: "warning",
    text: "Este pedido ya tenía una respuesta registrada, y no era esa.",
  },
  [ORDER_RESPONSE_OUTCOME.UNAVAILABLE]: {
    tone: "danger",
    text: "No pudimos registrar tu respuesta. Este pedido no tiene una propuesta esperando tu decisión.",
  },
  [ORDER_RESPONSE_OUTCOME.RATE_LIMITED]: {
    tone: "warning",
    text: "Recibimos varias respuestas seguidas. Espera un momento y vuelve a intentarlo.",
  },
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isKnownOutcome(value: string | undefined): value is OrderResponseOutcome {
  return value !== undefined && (Object.values(ORDER_RESPONSE_OUTCOME) as string[]).includes(value);
}

export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/[slug]/pedido/[code]">) {
  const { slug, code } = await params;
  const query = await searchParams;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // etapa 2, unreachable in this stage
  const [store, order] = await Promise.all([
    requireStore(resolution),
    getOrderByCode(resolution.storeId, code),
  ]);
  if (!order) notFound();

  const whatsappUrl = orderWhatsappUrl(order);
  const hasDelivery = order.fulfillment === "DELIVERY";
  const isAwaitingCustomer = order.status === "AWAITING_CUSTOMER";
  const proposalExpired =
    isAwaitingCustomer && order.proposal
      ? isProposalExpired(new Date(order.proposal.expiresAt))
      : false;

  const rawOutcome = firstParam(query.r);
  const banner = isKnownOutcome(rawOutcome) ? RESPONSE_BANNERS[rawOutcome] : null;

  const storeContactUrl = buildCustomerContactUrl({
    storeWhatsappNumber: order.whatsappNumber,
    storeName: order.storeName,
    code: order.code,
  });

  const diff =
    isAwaitingCustomer && order.proposal
      ? buildProposalDiff({
          currencyCode: order.currencyCode,
          currentItems: order.items,
          proposedItems: order.proposal.items,
          currentSubtotal: order.subtotal,
          proposedSubtotal: order.proposal.subtotal,
          currentDeliveryFee: order.deliveryFee,
          proposedDeliveryFee: order.proposal.deliveryFee,
        })
      : [];

  const trail = orderTrail(branchTrailStore(resolution, store), order.code);

  return (
    <Container className="max-w-2xl pt-4 pb-8 lg:max-w-4xl">
      <StoreTrail trail={trail} />
      {/* HD11: an order already placed stays fully visible even after the
          store closes — the receipt is the shopper's, not the storefront's. */}
      {store.status !== "PUBLISHED" && (
        <Alert tone="muted" className="mb-6">
          <p>Esta tienda cerró sus pedidos online por ahora.</p>
          <p>
            Este pedido ya lo tiene la tienda. Si necesitas hablar con ellos, aquí abajo están sus
            datos.
          </p>
        </Alert>
      )}

      {banner && (
        <div id="respuesta" tabIndex={-1} className="mb-6">
          {/* design.md § «Tokens y tema»: the long body goes in `text-fg`,
              never inheriting the tone color — `Alert`'s outer element still
              carries `text-{tone}` as its OWN computed color (`role`, not the
              child), so a plain child override alone leaves that outer
              element's color unchanged; `!text-fg` here forces it on THIS
              one usage only, without touching `Alert` itself. */}
          <Alert tone={banner.tone} className="!text-fg">
            <p className="text-fg">{banner.text}</p>
          </Alert>
        </div>
      )}

      {isAwaitingCustomer ? (
        <div className="bg-warning/15 text-fg rounded-md p-4">
          <p className="text-lg font-semibold">La tienda propone un cambio en tu pedido</p>
          <p className="text-fg-muted mt-1 text-sm">
            Revísalo y responde. Si no respondes a tiempo, el pedido se cancela.
          </p>
          <a href="#propuesta" className="text-brand mt-2 inline-block text-sm underline">
            Ver el cambio y responder
          </a>
        </div>
      ) : (
        <div className="bg-positive/12 text-positive rounded-md p-4">
          <p className="text-lg font-semibold">¡Pedido recibido!</p>
        </div>
      )}

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
          <OrderStatusBadge
            status={order.status}
            hasDelivery={hasDelivery}
            cancelledBy={order.cancelledBy}
            proposalExpired={proposalExpired}
          />
        </div>
      </div>

      {/* DP1: hidden while a proposal is live — its message carries the OLD
          amounts, and offering it here invites resending a pedido that is
          under discussion. */}
      {order.checkoutMode === "WHATSAPP" && !isAwaitingCustomer && (
        <div className="mt-6">
          <WhatsappOrderLink url={whatsappUrl} />
        </div>
      )}

      {isAwaitingCustomer && order.proposal && (
        <OrderProposalCard
          responsePath={`/${store.canonicalSlug}/pedido/${order.code}/respuesta`}
          currencyCode={order.currencyCode}
          message={order.proposal.message}
          expiresAt={new Date(order.proposal.expiresAt)}
          previousTotal={order.proposal.previousTotal}
          proposedTotal={order.proposal.total}
          diff={diff}
          storeContactUrl={storeContactUrl}
        />
      )}

      {EXPECTATION_PARAGRAPH_STATUSES.has(order.status) && (
        <p className="text-fg-muted mt-6 text-sm">
          La tienda va a revisar tu pedido y te va a contactar por teléfono para confirmarlo. Al
          enviarlo no se reserva ninguna unidad ni se cobra nada.
        </p>
      )}

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
          {isAwaitingCustomer && order.proposal ? (
            <>
              <OrderLinesTable
                items={order.proposal.items.map((item) => ({
                  storeProductId: item.storeProductId ?? null,
                  name: item.name,
                  unitPrice: item.unitPrice,
                  currencyCode: item.currencyCode,
                  quantity: item.quantity,
                  lineTotal: item.lineTotal,
                }))}
                currencyCode={order.currencyCode}
                subtotal={order.proposal.subtotal}
                deliveryFee={order.proposal.deliveryFee}
                total={order.proposal.total}
                title="Tu pedido si aceptas el cambio"
                badge={<Badge tone="warning">Propuesta</Badge>}
              />
              <details className="mt-4">
                <summary className="cursor-pointer text-sm underline">
                  Ver tu pedido tal como está ahora
                </summary>
                <div className="mt-3">
                  <OrderLinesTable
                    items={order.items}
                    currencyCode={order.currencyCode}
                    subtotal={order.subtotal}
                    deliveryFee={order.deliveryFee}
                    total={order.total}
                  />
                </div>
              </details>
            </>
          ) : (
            <OrderLinesTable
              items={order.items}
              currencyCode={order.currencyCode}
              subtotal={order.subtotal}
              deliveryFee={order.deliveryFee}
              total={order.total}
            />
          )}
        </Card>
      </div>

      <p className="text-fg-muted mt-6 text-xs">
        Actualiza la página para ver el estado más reciente.
      </p>

      <Link href={`/${store.canonicalSlug}`} className="text-brand mt-8 inline-block underline">
        Seguir comprando
      </Link>
    </Container>
  );
}
