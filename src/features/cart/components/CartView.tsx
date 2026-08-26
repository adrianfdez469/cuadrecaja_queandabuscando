"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatMoney, money } from "@/lib/money";
import { CART_QUOTE_DEBOUNCE_MS, CART_QUOTE_SLOW_MS } from "@/constants/cart";
import type { QuoteResponse } from "@/features/orders/types";
import { useCart, useHydrated } from "../cartStore";
import { CartLineRow } from "./CartLineRow";

type QuoteStatus = "loading" | "ready" | "error" | "not-found" | "closed";

/**
 * `/[slug]/carrito`. Cotiza against the server on mount and on every
 * quantity change (debounced), never trusting `localStorage`'s `display`
 * for anything that gets summed (R6, R7). The rule that governs every
 * state below: the list itself never moves — only the amounts appear.
 */
export function CartView({ storeId, storeSlug }: { storeId: string; storeSlug: string }) {
  const hydrated = useHydrated();
  const cart = useCart(storeId);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [status, setStatus] = useState<QuoteStatus>("loading");
  const [errorStreak, setErrorStreak] = useState(0);
  const [slow, setSlow] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const requestIdRef = useRef(0);
  const isFirstFetchRef = useRef(true);
  const itemsKey = cart.items.map((item) => `${item.storeProductId}:${item.qty}`).join(",");

  async function fetchQuote() {
    if (cart.items.length === 0) {
      setQuote(null);
      setStatus("ready");
      return;
    }
    const requestId = (requestIdRef.current += 1);
    setStatus("loading");
    try {
      const response = await fetch("/api/orders/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storeSlug,
          items: cart.items.map((item) => ({ storeProductId: item.storeProductId, qty: item.qty })),
        }),
      });
      if (requestId !== requestIdRef.current) return; // a newer request already answered

      if (response.status === 404) {
        setStatus("not-found");
        return;
      }
      if (response.status === 409) {
        const data = await response.json().catch(() => null);
        if (data?.error === "STORE_CLOSED") {
          setStatus("closed");
          return;
        }
      }
      if (!response.ok) {
        setErrorStreak((n) => n + 1);
        setStatus("error");
        return;
      }
      const data = (await response.json()) as QuoteResponse;
      if (requestId !== requestIdRef.current) return;
      setQuote(data);
      setStatus("ready");
      setErrorStreak(0);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setErrorStreak((n) => n + 1);
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!hydrated) return undefined;
    const delay = isFirstFetchRef.current ? 0 : CART_QUOTE_DEBOUNCE_MS;
    isFirstFetchRef.current = false;
    const timer = setTimeout(() => {
      void fetchQuote();
    }, delay);
    return () => clearTimeout(timer);
    // itemsKey captures every change that should re-quote; fetchQuote closes
    // over the same values, so it does not need to be a dependency itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, itemsKey]);

  useEffect(() => {
    if (status !== "loading") return undefined;
    const timer = setTimeout(() => setSlow(true), CART_QUOTE_SLOW_MS);
    // Cleanup, not the effect body, is what turns it back off: it runs when
    // `status` changes away from "loading" (or on unmount), which is the
    // sanctioned place for this — react-hooks/set-state-in-effect flags a
    // setState call in the body itself, not in the returned cleanup.
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [status]);

  if (!hydrated) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Tu carrito</h1>
        <p aria-busy="true" className="text-fg-muted mt-6">
          Cargando tu carrito…
        </p>
        <noscript>
          <p className="text-fg-muted mt-6">
            Para armar un pedido necesitas activar JavaScript. Puedes seguir viendo el catálogo.{" "}
            <Link href={`/${storeSlug}`} className="text-brand underline">
              Ver el catálogo
            </Link>
          </p>
        </noscript>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Tu carrito</h1>
        <p className="text-fg-muted mt-6">Todavía no agregaste nada.</p>
        <Link href={`/${storeSlug}`} className="mt-4 inline-block">
          <Button variant="secondary">Ver el catálogo</Button>
        </Link>
      </div>
    );
  }

  if (status === "not-found") {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Tu carrito</h1>
        <p className="text-fg-muted mt-6">Esta tienda ya no está disponible.</p>
        <Link href="/" className="text-brand mt-2 inline-block underline">
          Ir al inicio
        </Link>
      </div>
    );
  }

  if (status === "closed") {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Tu carrito</h1>
        <Alert tone="danger" className="mt-6">
          Esta tienda dejó de tomar pedidos.
        </Alert>
        <p className="text-fg-muted mt-3">
          Si tenías productos en el carrito, siguen guardados en este teléfono: cuando la tienda
          vuelva a abrir los vas a encontrar ahí.
        </p>
        <Link href={`/${storeSlug}`} className="text-brand mt-4 inline-block underline">
          Volver a la tienda
        </Link>
      </div>
    );
  }

  const unavailableLines = quote?.lines.filter((line) => !line.orderable) ?? [];
  const hasQuote = quote !== null;
  const firstLoad = status === "loading" && !hasQuote;
  const showContinueAnyway = status === "error" && errorStreak >= 2;

  const subtotalLabel =
    quote && !firstLoad ? formatMoney(money(quote.subtotal, quote.store.currencyCode)) : null;

  return (
    <div className="pb-28 lg:grid lg:grid-cols-[1fr_20rem] lg:items-start lg:gap-8 lg:pb-0">
      <div>
        <h1 className="text-2xl font-semibold">Tu carrito</h1>

        {unavailableLines.length > 0 && (
          <p role="status" className="bg-warning/15 text-warning mt-4 rounded-md p-3 text-sm">
            {unavailableLines.length === 1
              ? "Hay 1 producto que no se puede pedir. Quítalo para continuar."
              : `Hay ${unavailableLines.length} productos que no se pueden pedir. Quítalos para continuar.`}
          </p>
        )}

        {status === "error" && (
          <Alert
            tone="danger"
            title="No pudimos calcular los precios ahora mismo."
            className="mt-4"
          >
            <p>
              Revisa tu conexión. Los precios que ves son los de cuando agregaste y pueden haber
              cambiado.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => void fetchQuote()}>
                Reintentar
              </Button>
              {showContinueAnyway && (
                <Link href={`/${storeSlug}/checkout`} className="text-sm underline">
                  Continuar de todos modos
                </Link>
              )}
            </div>
          </Alert>
        )}

        {slow && status === "loading" && (
          <p className="text-fg-muted mt-4 text-sm">
            Estamos calculando los precios actuales. En una conexión lenta puede tardar un poco.
          </p>
        )}

        <ul className="mt-6">
          {cart.items.map((item) => {
            const quotedLine = quote?.lines.find(
              (line) => line.storeProductId === item.storeProductId,
            );
            const orderable = quotedLine?.orderable ?? true;
            const reason = quotedLine && !quotedLine.orderable ? quotedLine.reason : undefined;
            const status2 = !orderable && reason ? reason : "ok";

            const unitPriceLabel =
              quotedLine?.unitPrice && quotedLine.currencyCode
                ? formatMoney(money(quotedLine.unitPrice, quotedLine.currencyCode))
                : formatMoney(money(item.display.unitPrice, item.display.currency));
            const unitPriceMuted = !quotedLine?.unitPrice;
            const listUnitPriceLabel =
              orderable &&
              quotedLine?.orderable &&
              quotedLine.listUnitPrice &&
              quotedLine.currencyCode
                ? formatMoney(money(quotedLine.listUnitPrice, quotedLine.currencyCode))
                : undefined;

            const lineTotalLabel =
              orderable && quotedLine?.lineTotal && quotedLine.currencyCode && !firstLoad
                ? formatMoney(money(quotedLine.lineTotal, quotedLine.currencyCode))
                : null;

            return (
              <CartLineRow
                key={item.storeProductId}
                name={quotedLine?.name ?? item.display.name}
                storeSlug={storeSlug}
                productSlug={orderable ? (quotedLine?.slug ?? item.slug) : null}
                qty={item.qty}
                unitPriceLabel={unitPriceLabel}
                unitPriceMuted={unitPriceMuted}
                listUnitPriceLabel={listUnitPriceLabel}
                lineTotalLabel={lineTotalLabel}
                status={status2}
                onIncrement={() => cart.setQty(item.storeProductId, item.qty + 1)}
                onDecrement={() => cart.setQty(item.storeProductId, item.qty - 1)}
                onChangeQty={(qty) => cart.setQty(item.storeProductId, qty)}
                onRemove={() => cart.remove(item.storeProductId)}
              />
            );
          })}
        </ul>

        <div className="mt-6">
          {confirmingClear ? (
            <p className="text-sm">
              ¿Vaciar el carrito?{" "}
              <button
                type="button"
                className="text-danger font-medium underline"
                onClick={() => {
                  cart.clear();
                  setConfirmingClear(false);
                }}
              >
                Sí, vaciar
              </button>{" "}
              ·{" "}
              <button type="button" className="underline" onClick={() => setConfirmingClear(false)}>
                No
              </button>
            </p>
          ) : (
            <button
              type="button"
              className="text-fg-muted min-h-11 text-sm underline"
              onClick={() => setConfirmingClear(true)}
            >
              Vaciar carrito
            </button>
          )}
        </div>
      </div>

      <div className="bg-surface shadow-card border-border fixed bottom-0 left-0 z-10 w-full border-t p-4 lg:sticky lg:top-6 lg:rounded-lg lg:border">
        <div
          aria-live="polite"
          aria-busy={status === "loading"}
          className="flex items-baseline justify-between"
        >
          <span className="text-fg-muted text-sm">Subtotal</span>
          <span
            className={subtotalLabel ? "text-fg text-lg font-semibold" : "text-fg-muted text-sm"}
          >
            {subtotalLabel ?? "Calculando…"}
          </span>
          {subtotalLabel && <span className="sr-only">Subtotal actualizado: {subtotalLabel}.</span>}
        </div>
        <p className="text-fg-muted mt-1 text-xs">El envío se calcula en el siguiente paso.</p>

        <Link href={`/${storeSlug}/checkout`} className="mt-4 block">
          <Button
            size="lg"
            className="w-full"
            disabled={firstLoad || unavailableLines.length > 0 || status === "error"}
            aria-describedby="carrito-continuar-motivo"
          >
            Continuar
          </Button>
        </Link>
        {(firstLoad || unavailableLines.length > 0 || status === "error") && (
          <p id="carrito-continuar-motivo" className="sr-only">
            {firstLoad
              ? "Calculando el total…"
              : unavailableLines.length > 0
                ? "Hay productos que no se pueden pedir."
                : "No se pudo calcular el total."}
          </p>
        )}
      </div>
    </div>
  );
}
