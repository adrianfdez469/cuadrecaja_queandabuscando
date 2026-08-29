"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Field } from "@/components/ui/Field";
import { RadioCard } from "@/components/ui/RadioCard";
import { add, formatMoney, money, subtract } from "@/lib/money";
import { getAccountProfile } from "@/features/account/accountStore";
import {
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_NAME_MIN_LENGTH,
  CONTACT_PHONE_MAX_DIGITS,
  CONTACT_PHONE_MIN_DIGITS,
  DELIVERY_ADDRESS_MIN_LENGTH,
  ORDER_NOTES_MAX_LENGTH,
} from "@/constants/orders";
import {
  CART_QUOTE_DEBOUNCE_MS,
  CART_QUOTE_SLOW_MS,
  CHECKOUT_KEY_STORAGE_PREFIX,
} from "@/constants/cart";
import { generateUuidV4 } from "@/features/orders/idempotencyKey";
import type { CreateOrderBody, Fulfillment, QuoteResponse } from "@/features/orders/types";
import { resolveStoreClosureHeadline } from "@/lib/storeClosure";
import { useCart, useHydrated } from "../cartStore";
import { OrderSummary } from "./OrderSummary";

type QuoteState = "loading" | "ready" | "error" | "not-found" | "closed";

type FieldErrors = Partial<
  Record<"name" | "phone" | "email" | "deliveryAddress" | "notes", string>
>;

const FIELD_LABEL: Record<keyof FieldErrors, string> = {
  name: "Nombre",
  phone: "Teléfono",
  email: "Correo",
  deliveryAddress: "Dirección",
  notes: "Notas",
};

type SubmitOutcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "items_unavailable"; lines: { storeProductId: string; reason: string }[] }
  | {
      kind: "price_changed";
      lines: { storeProductId: string; was: string | null; now: string }[];
      total: string;
    }
  | { kind: "too_many_orders"; retryAfterSeconds: number }
  | { kind: "invalid_body" }
  | { kind: "store_not_found" }
  | { kind: "store_closed"; reasonCode: string | null; disabledAt: string | null }
  | { kind: "failed" }
  | { kind: "network_error" };

function emailLooksValid(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * `/[slug]/checkout`. Cotiza on mount just like `CartView`, but here a
 * failed quote does NOT let the shopper through: `expectedTotal` is
 * mandatory (R6, R7), so without a fresh quote there is nothing honest to
 * send. The contact fields are usable from the very first paint — they are
 * plain HTML, not gated on the quote.
 */
export function CheckoutForm({ storeId, storeSlug }: { storeId: string; storeSlug: string }) {
  const hydrated = useHydrated();
  const cart = useCart(storeId);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteState, setQuoteState] = useState<QuoteState>("loading");
  const [slow, setSlow] = useState(false);

  // `null` means "still nothing" — distinct from "" (a field the shopper
  // cleared on purpose). What renders is `typed ?? profile value ?? ""`
  // (design.md § 5, DA1): derived in render, never a `setState` inside the
  // effect that fetches the profile.
  const [name, setNameState] = useState<string | null>(null);
  const [phone, setPhoneState] = useState<string | null>(null);
  const [email, setEmailState] = useState<string | null>(null);
  const nameRef = useRef<string | null>(null);
  const phoneRef = useRef<string | null>(null);
  const emailRef = useRef<string | null>(null);
  function setName(value: string | null) {
    nameRef.current = value;
    setNameState(value);
  }
  function setPhone(value: string | null) {
    phoneRef.current = value;
    setPhoneState(value);
  }
  function setEmail(value: string | null) {
    emailRef.current = value;
    setEmailState(value);
  }
  const [contactStatus, setContactStatus] = useState<"initial" | "applied" | "signed_in_no_fill">(
    "initial",
  );
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const hasLoadedProfileRef = useRef(false);
  const [notes, setNotes] = useState("");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("PICKUP");
  const [deliveryAddress, setDeliveryAddress] = useState("");

  const [attempted, setAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [outcome, setOutcome] = useState<SubmitOutcome>({ kind: "idle" });

  const summaryRef = useRef<HTMLDivElement | null>(null);
  // The error summary is rendered conditionally, so it does not exist yet when
  // submit() decides the form is invalid: focusing the ref there only worked
  // from the SECOND failed submit on, and a keyboard or screen-reader user got
  // no feedback at all the first time. Focus has to wait for React to commit
  // the render that mounts the summary.
  //
  // A ref and not state on purpose: `react-hooks/set-state-in-effect` forbids
  // clearing a state flag from inside the effect that consumes it, and this is
  // not rendered data — it is a one-shot intent that must not survive to the
  // next render or it would steal focus back from the user.
  const wantsSummaryFocusRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const isFirstFetchRef = useRef(true);
  const storageKey = `${CHECKOUT_KEY_STORAGE_PREFIX}${storeId}`;

  const itemsKey = cart.items.map((item) => `${item.storeProductId}:${item.qty}`).join(",");

  // `lo tecleado ?? lo del perfil ?? ""` (design.md § 5): derived every
  // render, never written into a `setState` of its own.
  const displayName = name ?? "";
  const displayPhone = phone ?? "";
  const displayEmail = email ?? "";

  async function fetchQuote() {
    if (cart.items.length === 0) return;
    setQuoteState("loading");
    try {
      const response = await fetch("/api/orders/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storeSlug,
          items: cart.items.map((item) => ({ storeProductId: item.storeProductId, qty: item.qty })),
        }),
      });
      if (response.status === 404) {
        setQuoteState("not-found");
        return;
      }
      if (response.status === 409) {
        const data = await response.json().catch(() => null);
        if (data?.error === "STORE_CLOSED") {
          setQuoteState("closed");
          return;
        }
      }
      if (!response.ok) {
        setQuoteState("error");
        return;
      }
      const data = (await response.json()) as QuoteResponse;
      setQuote(data);
      setQuoteState("ready");
      if (data.store.deliveryEnabled === false && fulfillment === "DELIVERY")
        setFulfillment("PICKUP");
    } catch {
      setQuoteState("error");
    }
  }

  useEffect(() => {
    if (!hydrated) return undefined;
    // Deferred to a timer, never called synchronously in the effect body:
    // fetchQuote's first line is a setState (react-hooks/set-state-in-effect).
    // Immediate on first mount; a short debounce afterwards (e.g. removing an
    // unavailable line re-quotes) so it never fires once per keystroke-speed
    // change.
    const delay = isFirstFetchRef.current ? 0 : CART_QUOTE_DEBOUNCE_MS;
    isFirstFetchRef.current = false;
    const timer = setTimeout(() => {
      void fetchQuote();
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, itemsKey]);

  // DA1 (architecture.md): fetched once, in parallel with the quote — never
  // in `src/app/[slug]/checkout/page.tsx`, which is what keeps the fila 4 of
  // F-010's grep clean. Deferred to a timer for the same reason as
  // `fetchQuote` above: nothing here may run synchronously in the effect
  // body. If it never resolves, or resolves to "no session", the line under
  // "Tus datos de contacto" simply never changes (E16, E17) — nobody waits
  // and nobody sees an error for this.
  useEffect(() => {
    if (!hydrated || hasLoadedProfileRef.current) return undefined;
    hasLoadedProfileRef.current = true;
    const timer = setTimeout(() => {
      void getAccountProfile().then((state) => {
        if (!state.signedIn || !state.profile) return;
        const profile = state.profile;
        const applied =
          (nameRef.current === null && Boolean(profile.name)) ||
          (phoneRef.current === null && Boolean(profile.phone)) ||
          (emailRef.current === null && Boolean(profile.email));
        if (nameRef.current === null && profile.name) setName(profile.name);
        if (phoneRef.current === null && profile.phone) setPhone(profile.phone);
        if (emailRef.current === null && profile.email) setEmail(profile.email);
        setContactStatus(applied ? "applied" : "signed_in_no_fill");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [hydrated]);

  useEffect(() => {
    if (quoteState !== "loading") return undefined;
    const timer = setTimeout(() => setSlow(true), CART_QUOTE_SLOW_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [quoteState]);

  // Runs after the commit that mounted the summary, so the node exists even on
  // the first failed submit. `fieldErrors` gets a fresh object on every submit,
  // so its identity change is what re-runs this.
  useEffect(() => {
    if (!wantsSummaryFocusRef.current) return;
    wantsSummaryFocusRef.current = false;
    summaryRef.current?.focus();
  }, [attempted, fieldErrors]);

  function getOrCreateIdempotencyKey(): string {
    if (idempotencyKeyRef.current) return idempotencyKeyRef.current;
    try {
      const existing = window.sessionStorage.getItem(storageKey);
      if (existing) {
        idempotencyKeyRef.current = existing;
        return existing;
      }
    } catch {
      // sessionStorage blocked: fall through to an in-memory key, same as E21.
    }
    const created = generateUuidV4();
    idempotencyKeyRef.current = created;
    try {
      window.sessionStorage.setItem(storageKey, created);
    } catch {
      // Nothing durable to write to; the in-memory ref still protects retries
      // within this page load.
    }
    return created;
  }

  function clearIdempotencyKey() {
    idempotencyKeyRef.current = null;
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Nothing to clear.
    }
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const trimmedName = displayName.trim();
    if (!trimmedName) errors.name = "Escribe tu nombre.";
    else if (trimmedName.length < CONTACT_NAME_MIN_LENGTH)
      errors.name = "El nombre es demasiado corto.";
    else if (trimmedName.length > CONTACT_NAME_MAX_LENGTH) {
      errors.name = "El nombre no puede pasar de 80 caracteres.";
    }

    const digits = displayPhone.replace(/\D/g, "");
    if (!displayPhone.trim())
      errors.phone = "Escribe un teléfono para que la tienda pueda contactarte.";
    else if (digits.length < CONTACT_PHONE_MIN_DIGITS || digits.length > CONTACT_PHONE_MAX_DIGITS) {
      errors.phone = "El teléfono tiene que tener entre 8 y 15 dígitos.";
    }

    if (displayEmail.trim() && !emailLooksValid(displayEmail.trim()))
      errors.email = "Ese correo no parece válido.";

    if (fulfillment === "DELIVERY") {
      const address = deliveryAddress.trim();
      if (!address)
        errors.deliveryAddress = "Escribe la dirección donde quieres recibir el pedido.";
      else if (address.length < DELIVERY_ADDRESS_MIN_LENGTH) {
        errors.deliveryAddress = "La dirección es demasiado corta: agrega calle y número.";
      }
    }

    if (notes.length > ORDER_NOTES_MAX_LENGTH)
      errors.notes = "Las notas no pueden pasar de 500 caracteres.";

    return errors;
  }

  async function submit(expectedTotalOverride?: string) {
    const errors = validate();
    setFieldErrors(errors);
    setAttempted(true);
    if (Object.keys(errors).length > 0) {
      wantsSummaryFocusRef.current = true;
      return;
    }
    if (!quote || quoteState !== "ready") return;

    const deliveryFee =
      fulfillment === "DELIVERY" && quote.store.deliveryFee
        ? money(quote.store.deliveryFee, quote.store.currencyCode)
        : money("0", quote.store.currencyCode);
    const subtotalMoney = money(quote.subtotal, quote.store.currencyCode);
    const discountMoney = money(quote.discountTotal, quote.store.currencyCode);
    // R29: subtotal - discountTotal + deliveryFee. Without subtracting the
    // ORDER-scope discount here, every checkout with one active would send a
    // stale expectedTotal and get a 409 PRICE_CHANGED on a price that never
    // actually changed (architecture.md hallazgo 2).
    const expectedTotal =
      expectedTotalOverride ?? add(subtract(subtotalMoney, discountMoney), deliveryFee).amount;
    const idempotencyKey = getOrCreateIdempotencyKey();

    const body: CreateOrderBody = {
      storeSlug,
      items: cart.items.map((item) => {
        const quotedLine = quote.lines.find((line) => line.storeProductId === item.storeProductId);
        return {
          storeProductId: item.storeProductId,
          qty: item.qty,
          ...(quotedLine?.orderable && quotedLine.unitPrice
            ? { expectedUnitPrice: quotedLine.unitPrice }
            : {}),
        };
      }),
      contact: {
        name: displayName.trim(),
        phone: displayPhone.trim(),
        ...(displayEmail.trim() ? { email: displayEmail.trim() } : {}),
      },
      fulfillment,
      ...(fulfillment === "DELIVERY" ? { deliveryAddress: deliveryAddress.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      expectedTotal,
      idempotencyKey,
    };

    setOutcome({ kind: "submitting" });
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);

      if (response.status === 201 || response.status === 200) {
        clearIdempotencyKey();
        cart.clear();
        // Hard navigation on purpose (design.md): the back button must not
        // land on a form whose cart is already empty.
        window.location.href = data.orderUrl;
        return;
      }
      if (response.status === 409 && data?.error === "ITEMS_UNAVAILABLE") {
        setOutcome({ kind: "items_unavailable", lines: data.lines ?? [] });
        return;
      }
      if (response.status === 409 && data?.error === "PRICE_CHANGED") {
        setOutcome({ kind: "price_changed", lines: data.lines ?? [], total: data.total });
        return;
      }
      if (response.status === 429) {
        setOutcome({ kind: "too_many_orders", retryAfterSeconds: data?.retryAfterSeconds ?? 60 });
        return;
      }
      if (response.status === 400) {
        setOutcome({ kind: "invalid_body" });
        return;
      }
      if (response.status === 404) {
        setOutcome({ kind: "store_not_found" });
        return;
      }
      if (response.status === 409 && data?.error === "STORE_CLOSED") {
        setOutcome({
          kind: "store_closed",
          reasonCode: data.reasonCode ?? null,
          disabledAt: data.disabledAt ?? null,
        });
        setQuoteState("closed");
        return;
      }
      setOutcome({ kind: "failed" });
    } catch {
      setOutcome({ kind: "network_error" });
    }
  }

  // The contact fields render regardless of hydration (design.md F0: "no
  // dependen de nada" — it is time not wasted while the quote loads). Only
  // the empty-cart replacement waits for `hydrated`: before that, `cart.items`
  // is always [] (useCart's server snapshot), and showing "empty" then would
  // be a guess, not a fact.
  if (hydrated && cart.items.length === 0) {
    return <EmptyCart storeSlug={storeSlug} />;
  }

  const unavailableIds =
    outcome.kind === "items_unavailable"
      ? new Set(outcome.lines.map((l) => l.storeProductId))
      : null;
  const stillHasUnavailable = unavailableIds
    ? cart.items.some((item) => unavailableIds.has(item.storeProductId))
    : false;

  const deliveryOffered = quote
    ? quote.store.deliveryEnabled && quote.store.deliveryFee !== null
    : false;
  const deliveryFeeMoney =
    quote && deliveryOffered && fulfillment === "DELIVERY"
      ? money(quote.store.deliveryFee as string, quote.store.currencyCode)
      : null;
  const subtotalLabel = quote ? formatMoney(money(quote.subtotal, quote.store.currencyCode)) : null;
  const discountMoney =
    quote && quote.discountTotal !== "0.00" && quote.discountTotal !== "0"
      ? money(quote.discountTotal, quote.store.currencyCode)
      : null;
  const discountLabel = discountMoney ? `−${formatMoney(discountMoney)}` : undefined;
  const totalLabel =
    quote && quoteState === "ready"
      ? formatMoney(
          add(
            subtract(
              money(quote.subtotal, quote.store.currencyCode),
              discountMoney ?? money("0", quote.store.currencyCode),
            ),
            deliveryFeeMoney ?? money("0", quote.store.currencyCode),
          ),
        )
      : null;

  const submitting = outcome.kind === "submitting";
  const canSubmit =
    quoteState === "ready" &&
    !submitting &&
    !(outcome.kind === "items_unavailable" && stillHasUnavailable) &&
    outcome.kind !== "too_many_orders";

  const primaryLabel =
    outcome.kind === "items_unavailable"
      ? "Quitar y volver a confirmar"
      : outcome.kind === "price_changed"
        ? "Confirmar con el total nuevo"
        : submitting
          ? "Enviando pedido…"
          : "Confirmar pedido";

  function handlePrimaryClick() {
    if (outcome.kind === "price_changed") {
      void submit(outcome.total);
    } else {
      void submit();
    }
  }

  return (
    <div className="lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-8">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Confirmar pedido</h1>

        <noscript>
          <p className="text-fg-muted">
            Para armar un pedido necesitas activar JavaScript. Puedes seguir viendo el catálogo.{" "}
            <a href={`/${storeSlug}`} className="text-brand underline">
              Ver el catálogo
            </a>
          </p>
        </noscript>

        <details className="border-border rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {!hydrated
              ? "Cargando tu pedido…"
              : `Tu pedido · ${cart.items.length} producto${cart.items.length === 1 ? "" : "s"}${subtotalLabel ? ` · ${subtotalLabel}` : ""}`}
          </summary>
          <ul className="mt-3 space-y-2">
            {cart.items.map((item) => {
              const quotedLine = quote?.lines.find(
                (line) => line.storeProductId === item.storeProductId,
              );
              const flagged = unavailableIds?.has(item.storeProductId) ?? false;
              const lineTotal =
                quotedLine?.orderable && quotedLine.lineTotal && quotedLine.currencyCode
                  ? formatMoney(money(quotedLine.lineTotal, quotedLine.currencyCode))
                  : null;

              return (
                <li
                  key={item.storeProductId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className={flagged ? "text-danger" : undefined}>
                    {item.qty} x {quotedLine?.name ?? item.display.name}
                    {flagged && " — ya no está disponible"}
                  </span>
                  {flagged ? (
                    <button
                      type="button"
                      className="text-danger min-h-11 shrink-0 px-2 underline"
                      onClick={() => cart.remove(item.storeProductId)}
                    >
                      Quitar
                    </button>
                  ) : (
                    <span className="shrink-0">{lineTotal ?? ""}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>

        {attempted && Object.keys(fieldErrors).length > 0 && (
          <div
            ref={summaryRef}
            role="alert"
            tabIndex={-1}
            className="bg-danger/12 border-danger/30 rounded-md border p-4 text-sm"
          >
            <p className="font-medium">
              Revisa {Object.keys(fieldErrors).length} dato
              {Object.keys(fieldErrors).length > 1 ? "s" : ""} antes de continuar
            </p>
            <ul className="mt-2 list-inside list-disc">
              {(Object.keys(fieldErrors) as (keyof FieldErrors)[]).map((field) => (
                <li key={field}>
                  <a href={`#field-${field}`} className="underline">
                    {FIELD_LABEL[field]}: {fieldErrors[field]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {outcome.kind === "items_unavailable" && (
          <Alert tone="danger" title="Algo cambió mientras hacías el pedido.">
            <p>
              No se creó ningún pedido. Quita lo que ya no está disponible y vuelve a confirmar.
            </p>
          </Alert>
        )}
        {outcome.kind === "price_changed" && (
          <Alert tone="warning" title="El precio cambió mientras hacías el pedido.">
            <p>No se creó ningún pedido. Este es el total actualizado.</p>
            <ul className="mt-2 space-y-1">
              {outcome.lines.map((line) => (
                <li key={line.storeProductId}>
                  {line.was && <span className="line-through">Antes {line.was}</span>} Ahora{" "}
                  {line.now}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {outcome.kind === "too_many_orders" && (
          <Alert tone="warning" title="Ya enviaste varios pedidos en los últimos minutos.">
            <p>
              Espera unos {Math.ceil(outcome.retryAfterSeconds / 60)} minutos e intenta de nuevo. Si
              es un error, llama a la tienda.
            </p>
          </Alert>
        )}
        {outcome.kind === "invalid_body" && (
          <Alert tone="danger">Revisa los datos del pedido.</Alert>
        )}
        {outcome.kind === "store_not_found" && (
          <Alert tone="danger">Esta tienda ya no está disponible.</Alert>
        )}
        {outcome.kind === "store_closed" && (
          <Alert id="checkout-store-closed" tone="danger">
            <p>Esta tienda dejó de tomar pedidos.</p>
            <p>
              {resolveStoreClosureHeadline({
                disabledReasonCode: outcome.reasonCode,
                disabledAt: outcome.disabledAt,
              })}
            </p>
            <p>No se creó ningún pedido.</p>
          </Alert>
        )}
        {outcome.kind === "failed" && (
          <Alert tone="danger">
            No pudimos guardar tu pedido. No se te cobró nada y tu carrito sigue completo.
          </Alert>
        )}
        {outcome.kind === "network_error" && (
          <Alert tone="danger">
            Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.
          </Alert>
        )}

        <div>
          <h2 className="font-medium">Tus datos de contacto</h2>
          <p className="text-fg-muted min-h-10 text-xs" aria-live="polite">
            {contactStatus === "applied" ? (
              "Rellenamos tus datos guardados. Puedes cambiarlos."
            ) : contactStatus === "signed_in_no_fill" ? (
              "La tienda te va a contactar por aquí."
            ) : (
              <>
                La tienda te va a contactar por aquí. Si ya tienes cuenta,{" "}
                <Link
                  href={`/cuenta/entrar?next=/${storeSlug}/checkout`}
                  className="underline"
                  onClick={(event) => {
                    const hasSomethingTyped = Boolean(
                      displayName.trim() || displayPhone.trim() || displayEmail.trim(),
                    );
                    if (hasSomethingTyped) {
                      event.preventDefault();
                      setShowLeaveConfirm(true);
                    }
                  }}
                >
                  entra
                </Link>{" "}
                y los rellenamos.
              </>
            )}
          </p>
          {showLeaveConfirm && (
            <p className="text-fg-muted mt-1 text-xs">
              Si entras ahora se pierde lo que escribiste aquí.{" "}
              <Link href={`/cuenta/entrar?next=/${storeSlug}/checkout`} className="underline">
                Sí, entrar
              </Link>{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setShowLeaveConfirm(false)}
              >
                No
              </button>
            </p>
          )}
        </div>

        <fieldset disabled={submitting} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="field-name" label="Nombre y apellidos" error={fieldErrors.name}>
              {(props) => (
                <input
                  {...props}
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onFocus={() => {
                    if (name === null) setName(displayName);
                  }}
                  onChange={(event) => setName(event.target.value)}
                  className="border-border min-h-11 w-full rounded-md border px-3"
                />
              )}
            </Field>

            <Field
              id="field-phone"
              label="Teléfono"
              help="Por aquí te va a contactar la tienda. Ej.: +53 5555 5555"
              error={fieldErrors.phone}
            >
              {(props) => (
                <input
                  {...props}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  value={displayPhone}
                  onFocus={() => {
                    if (phone === null) setPhone(displayPhone);
                  }}
                  onChange={(event) => setPhone(event.target.value)}
                  className="border-border min-h-11 w-full rounded-md border px-3"
                />
              )}
            </Field>
          </div>

          <Field id="field-email" label="Correo (opcional)" error={fieldErrors.email}>
            {(props) => (
              <input
                {...props}
                type="email"
                autoComplete="email"
                value={displayEmail}
                onFocus={() => {
                  if (email === null) setEmail(displayEmail);
                }}
                onChange={(event) => setEmail(event.target.value)}
                className="border-border min-h-11 w-full rounded-md border px-3"
              />
            )}
          </Field>

          <Field
            id="field-notes"
            label="Notas para la tienda (opcional)"
            help="Por ejemplo: tocar el timbre de abajo."
            error={fieldErrors.notes}
          >
            {(props) => (
              <textarea
                {...props}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="border-border min-h-20 w-full rounded-md border px-3 py-2"
              />
            )}
          </Field>

          {quoteState === "ready" && deliveryOffered && (
            <fieldset>
              <legend className="text-fg mb-2 text-sm font-medium">
                ¿Cómo lo quieres recibir?
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <RadioCard
                  name="fulfillment"
                  label="Recoger en la tienda"
                  description="Sin costo de envío"
                  checked={fulfillment === "PICKUP"}
                  onChange={() => setFulfillment("PICKUP")}
                />
                <RadioCard
                  name="fulfillment"
                  label="Envío a domicilio"
                  description={
                    quote?.store.deliveryFee
                      ? `+ ${formatMoney(money(quote.store.deliveryFee, quote.store.currencyCode))}`
                      : undefined
                  }
                  checked={fulfillment === "DELIVERY"}
                  onChange={() => setFulfillment("DELIVERY")}
                />
              </div>

              {fulfillment === "DELIVERY" && (
                <div className="mt-3">
                  <Field
                    id="field-deliveryAddress"
                    label="Dirección de entrega"
                    help="Calle, número, entre calles y municipio."
                    error={fieldErrors.deliveryAddress}
                  >
                    {(props) => (
                      <input
                        {...props}
                        type="text"
                        autoComplete="street-address"
                        value={deliveryAddress}
                        onChange={(event) => setDeliveryAddress(event.target.value)}
                        className="border-border min-h-11 w-full rounded-md border px-3"
                      />
                    )}
                  </Field>
                </div>
              )}
            </fieldset>
          )}
          {quoteState === "loading" && (
            <p className="text-fg-muted text-sm">Cargando las opciones de entrega…</p>
          )}

          <p className="text-fg-muted text-sm">
            La tienda va a revisar tu pedido y te va a contactar por teléfono para confirmarlo. Al
            enviarlo no se reserva ninguna unidad ni se cobra nada.
          </p>
        </fieldset>
      </div>

      <div className="bg-surface shadow-card border-border mt-6 rounded-lg border p-4 lg:sticky lg:top-6 lg:mt-0">
        {quoteState === "error" && (
          <Alert tone="danger" title="No pudimos calcular el total." className="mb-4">
            <p>
              Sin el total actualizado no podemos crear el pedido. Revisa tu conexión y vuelve a
              intentar.
            </p>
            <Button size="sm" className="mt-3" onClick={() => void fetchQuote()}>
              Reintentar
            </Button>
          </Alert>
        )}
        {quoteState === "not-found" && (
          <Alert tone="danger">Esta tienda ya no está disponible.</Alert>
        )}
        {quoteState === "closed" && (
          <Alert id="checkout-store-closed" tone="danger">
            Esta tienda dejó de tomar pedidos.
          </Alert>
        )}
        {slow && quoteState === "loading" && (
          <p className="text-fg-muted mb-3 text-sm">
            Estamos calculando el total. En una conexión lenta puede tardar un poco.
          </p>
        )}

        <OrderSummary
          subtotalLabel={subtotalLabel}
          discountLabel={discountLabel}
          deliveryFeeLabel={
            deliveryOffered
              ? deliveryFeeMoney
                ? formatMoney(deliveryFeeMoney)
                : formatMoney(money("0", quote?.store.currencyCode ?? "CUP"))
              : undefined
          }
          totalLabel={totalLabel}
          busy={quoteState === "loading"}
        />

        <Button
          size="lg"
          className="mt-4 w-full"
          disabled={!canSubmit}
          aria-busy={submitting}
          aria-describedby={quoteState === "closed" ? "checkout-store-closed" : undefined}
          onClick={handlePrimaryClick}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}

function EmptyCart({ storeSlug }: { storeSlug: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Confirmar pedido</h1>
      <p className="text-fg-muted mt-6">Tu carrito está vacío.</p>
      <a href={`/${storeSlug}`} className="mt-4 inline-block">
        <Button variant="secondary">Ver el catálogo</Button>
      </a>
    </div>
  );
}
