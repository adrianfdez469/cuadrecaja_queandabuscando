import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrderProposalCard } from "./OrderProposalCard";

const NOW = new Date("2026-08-30T12:00:00.000Z");

function baseProps(overrides: Partial<Parameters<typeof OrderProposalCard>[0]> = {}) {
  return {
    responsePath: "/tienda-demo/pedido/A7K3M9PQR2/respuesta",
    currencyCode: "CUP",
    message: "El envío a Playa cuesta 180.",
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000),
    previousTotal: "880.00",
    proposedTotal: "1180.00",
    diff: ["Envío: antes sin costo, ahora $180.00."],
    storeContactUrl: "https://wa.me/5350000001?text=hola",
    now: NOW,
    ...overrides,
  };
}

/**
 * F-019 design.md § 4.3-4.6, criterio 1 (los dos totales en el HTML), R16
 * (sin JavaScript). Este componente es el que `--propose` del guion de
 * humo va a `grep`ear.
 */
describe("OrderProposalCard — propuesta viva", () => {
  it("muestra los dos totales, distintos y presentes (criterio 1)", () => {
    render(<OrderProposalCard {...baseProps()} />);
    expect(screen.getByText("$880.00")).toBeInTheDocument();
    expect(screen.getByText("$1,180.00")).toBeInTheDocument();
  });

  it('los dos <form method="post"> existen sin JavaScript (R16, E9)', () => {
    const { container } = render(<OrderProposalCard {...baseProps()} />);
    const forms = container.querySelectorAll('form[method="post"]');
    expect(forms).toHaveLength(2);
    expect(container.querySelectorAll("details")).toHaveLength(2);
  });

  it("el formulario de aprobar lleva decision=aprobar oculto; el de rechazar, decision=rechazar", () => {
    const { container } = render(<OrderProposalCard {...baseProps()} />);
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[name="decision"]')];
    expect(inputs.map((input) => input.value).sort()).toEqual(["aprobar", "rechazar"]);
  });

  it("el mensaje de la tienda se cita literal", () => {
    render(<OrderProposalCard {...baseProps()} />);
    expect(screen.getByText(/El envío a Playa cuesta 180\./)).toBeInTheDocument();
  });

  it("sin mensaje: 'La tienda no dejó un mensaje.'", () => {
    render(<OrderProposalCard {...baseProps({ message: null })} />);
    expect(screen.getByText("La tienda no dejó un mensaje.")).toBeInTheDocument();
  });

  it("el plazo se lee en texto real dentro de un <time>", () => {
    render(<OrderProposalCard {...baseProps()} />);
    expect(screen.getByText("Te quedan unas 24 horas para responder.")).toBeInTheDocument();
  });

  it("las frases de 'Qué cambia' aparecen", () => {
    render(<OrderProposalCard {...baseProps()} />);
    expect(screen.getByText("Envío: antes sin costo, ahora $180.00.")).toBeInTheDocument();
  });

  it("el total sin cambio no inventa un antes/ahora falso (estado 3 de design.md)", () => {
    render(
      <OrderProposalCard {...baseProps({ previousTotal: "900.00", proposedTotal: "900.00" })} />,
    );
    expect(screen.getByText("El total no cambia: sigue siendo $900.00.")).toBeInTheDocument();
  });

  it("'Escribirle a la tienda' solo aparece cuando hay un enlace", () => {
    const { rerender } = render(<OrderProposalCard {...baseProps()} />);
    expect(screen.getByRole("link", { name: "Escribirle a la tienda" })).toBeInTheDocument();

    rerender(<OrderProposalCard {...baseProps({ storeContactUrl: null })} />);
    expect(screen.queryByRole("link", { name: "Escribirle a la tienda" })).not.toBeInTheDocument();
  });
});

describe("OrderProposalCard — propuesta vencida (E12, estado 5)", () => {
  it("sin formularios y sin <details>", () => {
    const { container } = render(
      <OrderProposalCard {...baseProps({ expiresAt: new Date(NOW.getTime() - 60 * 60_000) })} />,
    );
    expect(screen.getByText("Esta propuesta venció")).toBeInTheDocument();
    expect(container.querySelectorAll('form[method="post"]')).toHaveLength(0);
    expect(container.querySelectorAll("details")).toHaveLength(0);
  });
});
