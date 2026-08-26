import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AddToCartButton } from "./AddToCartButton";
import { readCart } from "../cartStorage";

// Criterio de aceptación 2(b) de spec.md: "Un producto con availability
// OUT_OF_STOCK no se puede agregar" — probado a nivel de componente porque
// `cartStore.add()` en sí mismo NO conoce disponibilidad (architecture.md: el
// módulo de carrito es puramente de líneas, sin conocimiento de dominio). La
// única barrera real contra agregar un producto agotado es que el `disabled`
// que calcula el SERVIDOR (`isOrderable()`) llegue hasta el <button> nativo y
// el click handler nunca llame a `cart.add()`. Este test ejercita justo esa
// barrera con un click de verdad, no leyendo el JSX.

function props(overrides: Partial<Parameters<typeof AddToCartButton>[0]> = {}) {
  return {
    storeId: "store-agotado-test",
    storeSlug: "tienda-demo",
    storeProductId: "sp-agotado",
    slug: "producto-agotado",
    name: "Jugo de mango 1 L",
    unitPrice: "150.00",
    currencyCode: "CUP",
    disabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("AddToCartButton — OUT_OF_STOCK no se puede agregar (criterio 2b)", () => {
  it("renders a native disabled button when disabled=true (criterio 2a, mirrored client-side)", () => {
    render(<AddToCartButton {...props()} />);
    const button = screen.getByRole("button", { name: "Agotado" });
    expect(button).toBeDisabled();
  });

  it("clicking a disabled button does NOT add the line to the cart", () => {
    const { storeId, storeProductId } = props();
    render(<AddToCartButton {...props()} />);
    const button = screen.getByRole("button", { name: "Agotado" });

    fireEvent.click(button);

    expect(readCart(storeId)).toBeNull();
    expect(window.localStorage.getItem(`qab.cart.v1.${storeId}`)).toBeNull();
    // La línea nunca llegó a existir para este storeProductId.
    expect(readCart(storeId)?.items.some((i) => i.storeProductId === storeProductId)).toBeFalsy();
  });

  it("an orderable product (disabled=false) DOES get added on click", () => {
    const { storeId, storeProductId } = props({
      disabled: false,
      storeId: "store-disponible-test",
    });
    render(<AddToCartButton {...props({ disabled: false, storeId: "store-disponible-test" })} />);
    const button = screen.getByRole("button", { name: "Agregar al carrito" });

    fireEvent.click(button);

    const cart = readCart(storeId);
    expect(cart?.items).toHaveLength(1);
    expect(cart?.items[0].storeProductId).toBe(storeProductId);
  });
});
