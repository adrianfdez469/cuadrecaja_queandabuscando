import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountBadge } from "./AccountBadge";

/**
 * design.md § 0, D7, R23. Zero network: the only signal is the
 * `qab-shopper-hint` cookie, read synchronously.
 */

afterEach(() => {
  document.cookie = "qab-shopper-hint=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("AccountBadge", () => {
  it("no se renderiza con Auth sin configurar (E26)", () => {
    render(<AccountBadge storeSlug="tienda-demo" authConfigured={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("sin la cookie de pista: enlaza a entrar, conservando el origen (E29)", () => {
    render(<AccountBadge storeSlug="tienda-demo" authConfigured />);
    const link = screen.getByRole("link", { name: "Entrar a tu cuenta" });
    expect(link).toHaveAttribute("href", "/cuenta/entrar?next=/tienda-demo");
  });

  it("con la cookie de pista: enlaza a /cuenta y pinta el punto", () => {
    document.cookie = "qab-shopper-hint=1; path=/";
    render(<AccountBadge storeSlug="tienda-demo" authConfigured />);
    const link = screen.getByRole("link", { name: "Tu cuenta" });
    expect(link).toHaveAttribute("href", "/cuenta?desde=/tienda-demo");
  });

  it("el rótulo visible es siempre 'Cuenta', igual en los dos estados", () => {
    const { rerender } = render(<AccountBadge storeSlug="tienda-demo" authConfigured />);
    expect(screen.getByText("Cuenta")).toBeInTheDocument();

    document.cookie = "qab-shopper-hint=1; path=/";
    rerender(<AccountBadge storeSlug="tienda-demo" authConfigured />);
    expect(screen.getByText("Cuenta")).toBeInTheDocument();
  });
});
