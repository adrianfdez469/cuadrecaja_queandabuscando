import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrderStatusBadge } from "./OrderStatusBadge";

/**
 * F-019 spec.md I1: the `switch` in `describe()` is exhaustive WITHOUT a
 * `default` — a guardrail, not a nuisance. These tests exercise the three
 * new cases plus the corrected READY-with-delivery copy (criterio 9), and
 * PP4: nothing changes for the six F-010 texts that keep showing as-is.
 */

describe("OrderStatusBadge", () => {
  it("PENDING, PULLED, CONFIRMED, DELIVERED: literal F-010 copy, unchanged (PP4)", () => {
    const { rerender } = render(<OrderStatusBadge status="PENDING" hasDelivery={false} />);
    expect(screen.getByText("Pendiente de confirmación")).toBeInTheDocument();
    expect(screen.getByText("La tienda todavía no lo revisó.")).toBeInTheDocument();

    rerender(<OrderStatusBadge status="PULLED" hasDelivery={false} />);
    expect(screen.getByText("Recibido por la tienda")).toBeInTheDocument();

    rerender(<OrderStatusBadge status="CONFIRMED" hasDelivery={false} />);
    expect(screen.getByText("Confirmado")).toBeInTheDocument();

    rerender(<OrderStatusBadge status="DELIVERED" hasDelivery={false} />);
    expect(screen.getByText("Entregado")).toBeInTheDocument();
  });

  it("READY con envío ya NO dice 'Va en camino.' (criterio 9)", () => {
    render(<OrderStatusBadge status="READY" hasDelivery />);
    expect(screen.getByText("Listo para enviar")).toBeInTheDocument();
    expect(screen.getByText("La tienda lo tiene listo para salir.")).toBeInTheDocument();
    expect(screen.queryByText("Va en camino.")).not.toBeInTheDocument();
  });

  it("READY para recoger: copia intacta", () => {
    render(<OrderStatusBadge status="READY" hasDelivery={false} />);
    expect(screen.getByText("Listo para recoger")).toBeInTheDocument();
  });

  it("IN_TRANSIT con envío: 'En camino', distinta de READY", () => {
    render(<OrderStatusBadge status="IN_TRANSIT" hasDelivery />);
    expect(screen.getByText("En camino")).toBeInTheDocument();
    expect(screen.queryByText("La tienda lo tiene listo para salir.")).not.toBeInTheDocument();
  });

  it("IN_TRANSIT para recoger (E22): copia propia de aviso, no la de envío", () => {
    render(<OrderStatusBadge status="IN_TRANSIT" hasDelivery={false} />);
    expect(screen.getByText("La tienda lo puso en camino")).toBeInTheDocument();
    expect(screen.queryByText("En camino")).not.toBeInTheDocument();
  });

  it("AWAITING_CUSTOMER con plazo vivo: 'Esperando tu respuesta'", () => {
    render(<OrderStatusBadge status="AWAITING_CUSTOMER" hasDelivery={false} />);
    expect(screen.getByText("Esperando tu respuesta")).toBeInTheDocument();
  });

  it("AWAITING_CUSTOMER con plazo vencido (E12): 'Sin respuesta a tiempo'", () => {
    render(<OrderStatusBadge status="AWAITING_CUSTOMER" hasDelivery={false} proposalExpired />);
    expect(screen.getByText("Sin respuesta a tiempo")).toBeInTheDocument();
  });

  it("F-031: AWAITING_CUSTOMER sobre un pedido sin cotizar dice 'La tienda ya puso el costo del envío'", () => {
    render(<OrderStatusBadge status="AWAITING_CUSTOMER" hasDelivery deliveryFeePending />);
    expect(screen.getByText("Esperando tu respuesta")).toBeInTheDocument();
    expect(
      screen.getByText("La tienda ya puso el costo del envío. Apruébalo o recházalo aquí abajo."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "La tienda propuso un cambio en tu pedido. Apruébalo o recházalo aquí abajo.",
      ),
    ).not.toBeInTheDocument();
  });

  it("CANCELLED distingue las tres atribuciones (R9) por la etiqueta", () => {
    const { rerender } = render(
      <OrderStatusBadge status="CANCELLED" hasDelivery={false} cancelledBy="CUSTOMER" />,
    );
    expect(screen.getByText("Cancelado por ti")).toBeInTheDocument();

    rerender(<OrderStatusBadge status="CANCELLED" hasDelivery={false} cancelledBy="EXPIRY" />);
    expect(screen.getByText("Cancelado: no respondiste a tiempo")).toBeInTheDocument();

    rerender(<OrderStatusBadge status="CANCELLED" hasDelivery={false} cancelledBy="STORE" />);
    expect(screen.getByText("Cancelado por la tienda")).toBeInTheDocument();
  });

  it("F-031 I7: CANCELLED/EXPIRY sobre un pedido sin cotizar dice 'se venció el plazo', no 'no respondiste a tiempo'", () => {
    render(
      <OrderStatusBadge
        status="CANCELLED"
        hasDelivery={false}
        cancelledBy="EXPIRY"
        deliveryFeePending
      />,
    );
    expect(screen.getByText("Cancelado: se venció el plazo")).toBeInTheDocument();
    expect(
      screen.getByText(
        "La tienda no llegó a confirmar el costo del envío y el plazo del pedido se acabó. No se te cobró nada; si todavía lo quieres, escríbele.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cancelado: no respondiste a tiempo")).not.toBeInTheDocument();
    // Nunca le habla de una propuesta que el comprador no llegó a ver.
    expect(screen.queryByText(/propuesta/i)).not.toBeInTheDocument();
  });

  it("CANCELLED sin atribución (filas anteriores a la migración): texto de F-010, intacto", () => {
    render(<OrderStatusBadge status="CANCELLED" hasDelivery={false} />);
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
    expect(
      screen.getByText("La tienda canceló este pedido. Si no sabes por qué, contáctala."),
    ).toBeInTheDocument();
  });

  it("REJECTED_BY_STORE: cuarto desenlace distinguible", () => {
    render(<OrderStatusBadge status="REJECTED_BY_STORE" hasDelivery={false} />);
    expect(screen.getByText("Rechazado por la tienda")).toBeInTheDocument();
  });
});
