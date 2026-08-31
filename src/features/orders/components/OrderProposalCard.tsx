import { compare, formatMoney, money, subtract } from "@/lib/money";
import { ORDER_PROPOSAL_DECISION } from "@/constants/orders";
import { Button } from "@/components/ui/Button";
import { isProposalExpired, remainingTime } from "../deadline";

/**
 * The proposal panel (design.md § 4.3-4.6; architecture.md DA4). Server
 * component, no directive: the two revelations are native `<details>` and
 * the two actions are native `<form method="post">` — R16, zero bytes of
 * client JavaScript (design.md § Coste de cliente).
 *
 * Scope note (impl.md § Desviaciones): design.md's DP3 sketches a radio
 * list + optional free-text reason for a rejection. architecture.md DA4 and
 * ADR 0024 defensa 6 are explicit that this route's body is `decision` and
 * NOTHING else — "el comprador no aporta texto" — so this card does not
 * collect one; `cancelReason` on a rejection is the fixed server constant
 * `ORDER_REJECTED_BY_CUSTOMER_REASON`.
 */

const TONE_CLASS = { default: "text-fg", warning: "text-warning", danger: "text-danger" } as const;

export function OrderProposalCard({
  responsePath,
  currencyCode,
  message,
  expiresAt,
  previousTotal,
  proposedTotal,
  diff,
  storeContactUrl,
  now = new Date(),
}: {
  /** `/[slug]/pedido/[code]/respuesta` — the form's `action`. */
  responsePath: string;
  currencyCode: string;
  message: string | null;
  expiresAt: Date;
  previousTotal: string;
  proposedTotal: string;
  /** Lines from `buildProposalDiff` — already plain sentences. */
  diff: string[];
  /** "Escribirle a la tienda" (wa.me), `null` with no usable number. */
  storeContactUrl: string | null;
  now?: Date;
}) {
  const expired = isProposalExpired(expiresAt, now);
  const previous = money(previousTotal, currencyCode);
  const proposed = money(proposedTotal, currencyCode);
  const comparison = compare(proposed, previous);
  const totalUnchanged = comparison === 0;
  const difference = comparison >= 0 ? subtract(proposed, previous) : subtract(previous, proposed);

  if (expired) {
    return (
      <section
        aria-labelledby="propuesta-titulo"
        className="border-border bg-surface-muted mt-6 rounded-lg border p-4 sm:p-6"
      >
        <h2 id="propuesta-titulo" className="text-lg font-semibold">
          Esta propuesta venció
        </h2>
        <p className="text-fg-muted mt-2 text-sm">
          El plazo para responder se acabó, así que ya no se puede aprobar ni rechazar. La tienda va
          a cancelar el pedido.
        </p>
        <p className="text-fg-muted mt-2 text-sm">
          Si todavía lo quieres, escríbele a la tienda o haz el pedido de nuevo.
        </p>
        {storeContactUrl && (
          <a href={storeContactUrl} className="text-brand mt-3 inline-block underline">
            Escribirle a la tienda
          </a>
        )}
      </section>
    );
  }

  const remaining = remainingTime(expiresAt, now);

  return (
    <section
      id="propuesta"
      aria-labelledby="propuesta-titulo"
      className="border-warning/30 bg-surface mt-6 rounded-lg border p-4 sm:p-6"
    >
      <h2 id="propuesta-titulo" className="text-lg font-semibold">
        La tienda propone un cambio
      </h2>

      <p className={`mt-2 text-sm font-medium ${TONE_CLASS[remaining.tone]}`}>
        <time dateTime={expiresAt.toISOString()}>{remaining.label}</time>
      </p>

      {message ? (
        <blockquote className="border-border text-fg mt-4 border-l-2 pl-3 text-sm">
          <span className="text-fg-muted">La tienda dice:</span> {message}
        </blockquote>
      ) : (
        <p className="text-fg-muted mt-4 text-sm">La tienda no dejó un mensaje.</p>
      )}

      {diff.length > 0 && (
        <div className="mt-4">
          <h3 className="text-fg-muted text-sm font-medium">Qué cambia</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {diff.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-fg-muted text-sm font-medium">Lo que pagarías</h3>
        {totalUnchanged ? (
          <p className="text-fg mt-2 text-sm">
            El total no cambia: sigue siendo {formatMoney(proposed)}.
          </p>
        ) : (
          <dl className="mt-2 space-y-1 text-sm sm:grid sm:grid-cols-[1fr_auto] sm:space-y-2 sm:gap-x-4">
            <dt className="text-fg-muted">Total actual</dt>
            <dd>{formatMoney(previous)}</dd>
            <dt className="text-fg-muted">Total propuesto</dt>
            <dd className="text-fg text-2xl font-semibold">{formatMoney(proposed)}</dd>
            <dt className="text-fg-muted">Diferencia</dt>
            <dd>
              {formatMoney(difference)} {comparison > 0 ? "más" : "menos"}
            </dd>
          </dl>
        )}
      </div>

      <div className="mt-6 space-y-3">
        <details className="border-border rounded-md border p-3">
          <summary className="min-h-12 cursor-pointer list-none px-1 py-2 font-medium">
            Aprobar el cambio
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-fg-muted text-sm">
              Vas a aceptar el cambio: pagarías {formatMoney(proposed)} en vez de{" "}
              {formatMoney(previous)}. La tienda prepara tu pedido con estos importes y te contacta
              por teléfono.
            </p>
            <form method="post" action={responsePath}>
              <input type="hidden" name="decision" value={ORDER_PROPOSAL_DECISION.APPROVE} />
              <Button type="submit" size="lg" variant="primary">
                Sí, acepto pagar {formatMoney(proposed)}
              </Button>
            </form>
            <p className="text-fg-muted text-xs">
              Se paga contra entrega, como siempre: aquí no se cobra nada.
            </p>
          </div>
        </details>

        <details className="border-border rounded-md border p-3">
          <summary className="min-h-12 cursor-pointer list-none px-1 py-2 font-medium">
            Rechazar el cambio
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-fg-muted text-sm">
              Si rechazas, el pedido se cancela y la tienda no lo prepara. No pasa nada: puedes
              hacer otro cuando quieras.
            </p>
            <form method="post" action={responsePath}>
              <input type="hidden" name="decision" value={ORDER_PROPOSAL_DECISION.REJECT} />
              <Button type="submit" size="lg" variant="secondary">
                Sí, rechazar y cancelar el pedido
              </Button>
            </form>
          </div>
        </details>
      </div>

      <div className="border-border mt-6 space-y-2 border-t pt-4 text-sm">
        {storeContactUrl && (
          <a href={storeContactUrl} className="text-brand inline-block underline">
            Escribirle a la tienda
          </a>
        )}
        <p className="text-fg-muted">
          Si no respondes antes de que se acabe el plazo, el pedido se cancela solo.
        </p>
      </div>
    </section>
  );
}
