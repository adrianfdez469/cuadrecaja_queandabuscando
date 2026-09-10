"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Field } from "@/components/ui/Field";
import { RadioCard } from "@/components/ui/RadioCard";
import { add, formatMoney, money, subtract } from "@/lib/money";
import { priceEquivalents, selectableCurrencies } from "@/lib/priceEquivalents";
import { REFERENCE_CURRENCY_NONE } from "@/constants/currency";
import {
  REFERENCE_CURRENCY_NOT_HYDRATED,
  useReferenceCurrencyPreference,
} from "@/features/currency/referenceCurrencyStore";
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
import { deliveryFeeForNewOrder, type ChosenZone } from "@/features/orders/deliveryOffer";
import type {
  CreateOrderBody,
  Fulfillment,
  PriceChangedDelivery,
  QuoteResponse,
} from "@/features/orders/types";
import type { DeliveryFeeModeName } from "@/features/orders/deliveryOffer";
import { resolveStoreClosureHeadline } from "@/lib/storeClosure";
import { findZoneInCoverage, type OfferableZone } from "@/features/zones/coverage";
import { ZonePicker } from "@/features/zones/components/ZonePicker";
import { useCart, useHydrated } from "../cartStore";
import { OrderSummary } from "./OrderSummary";

type QuoteState = "loading" | "ready" | "error" | "not-found" | "closed";

type FieldErrors = Partial<
  Record<"name" | "phone" | "email" | "deliveryAddress" | "notes" | "zoneCode", string>
>;

const FIELD_LABEL: Record<keyof FieldErrors, string> = {
  name: "Nombre",
  phone: "Teléfono",
  email: "Correo",
  deliveryAddress: "Dirección",
  notes: "Notas",
  zoneCode: "Municipio",
};

type SubmitOutcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "items_unavailable"; lines: { storeProductId: string; reason: string }[] }
  | {
      kind: "price_changed";
      lines: { storeProductId: string; was: string | null; now: string }[];
      total: string;
      delivery?: PriceChangedDelivery;
    }
  | { kind: "too_many_orders"; retryAfterSeconds: number }
  | { kind: "invalid_body" }
  | { kind: "store_not_found" }
  | { kind: "store_closed"; reasonCode: string | null; disabledAt: string | null }
  // F-042 — los dos errores nuevos de la ruta pública (E16, E20).
  | { kind: "delivery_zone_required" }
  | { kind: "delivery_zone_not_served"; zoneCode: string }
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
export function CheckoutForm({
  storeId,
  storeSlug,
  deliveryOffered,
  deliveryFeeMode,
  deliveryFlatFee,
  zoneCoverage,
}: {
  storeId: string;
  storeSlug: string;
  /** F-042 (D12, paso 15) — el hecho resuelto en SERVIDOR, para los TRES
   *  modos de envío: el `<fieldset>` de modalidad ya no cuelga de la
   *  cotización (`quoteState`). */
  deliveryOffered: boolean;
  deliveryFeeMode: DeliveryFeeModeName;
  /** Solo tiene sentido para `FLAT_RATE`; los otros dos modos lo ignoran
   *  (R11, `deliveryFeeForNewOrder`). */
  deliveryFlatFee: string | null;
  /** `null` salvo en una tienda `ZONE_BASED` con domicilio (D5): los
   *  nombres YA están en el HTML de esta respuesta. */
  zoneCoverage: readonly OfferableZone[] | null;
}) {
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
  // D11/PP3: una cobertura de un solo municipio llega YA elegida — inicializador
  // perezoso, no un efecto, así que no hay "setState en un efecto" que evitar.
  const [zoneCode, setZoneCode] = useState<string | null>(() =>
    zoneCoverage?.length === 1 ? zoneCoverage[0].code : null,
  );

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
      // F-042 (D12, riesgo 7 de architecture.md): `deliveryOffered` ya es un
      // hecho de SERVIDOR, resuelto en el render de la página — no en esta
      // cotización. Si el modo cambió justo en esa ventana de ~300 ms, lo
      // cierra el 409 al confirmar, no una re-lectura aquí.
      if (!deliveryOffered && fulfillment === "DELIVERY") setFulfillment("PICKUP");
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

  // F-039 (architecture.md AD3, spec.md R12 § excepción acotada): the SAME
  // rate table and declared list `quote` carries — never a second server
  // read — so the total's equivalent below can never disagree with the
  // total it sits under. The preference is read, never written, from here:
  // `referenceCurrencyStore.ts` is the single store the header selector
  // already writes to.
  const offeredCurrencies = quote
    ? selectableCurrencies(quote.store.displayCurrencies, quote.store.currencyCode, quote.rates)
    : [];
  const [referenceCurrency] = useReferenceCurrencyPreference(offeredCurrencies);

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

      // F-042 — en ZONE_BASED, el municipio es tan obligatorio como la
      // dirección (D3, R1).
      if (deliveryFeeMode === "ZONE_BASED" && !zoneCode) {
        errors.zoneCode = "Elige el municipio a donde enviamos.";
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

    // R8: la MISMA función que el servidor, nunca una segunda copia de la
    // precedencia aquí. `chosenZone` viene de las props del servidor
    // (D5) — nunca del índice ni de una consulta propia.
    const selectedZone = zoneCode ? findZoneInCoverage(zoneCoverage ?? [], zoneCode) : null;
    const chosenZone: ChosenZone | null = selectedZone
      ? { code: selectedZone.code, deliveryFee: selectedZone.deliveryFee }
      : null;
    const deliveryResult = deliveryFeeForNewOrder(
      { deliveryEnabled: true, deliveryFeeMode, deliveryFee: deliveryFlatFee },
      fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
      chosenZone,
    );
    const deliveryFee = money(
      deliveryResult.kind === "charged" ? deliveryResult.amount : "0",
      quote.store.currencyCode,
    );
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
      ...(fulfillment === "DELIVERY" && chosenZone ? { zoneCode: chosenZone.code } : {}),
      ...(fulfillment === "DELIVERY" && deliveryResult.kind === "charged"
        ? { expectedDeliveryFee: deliveryResult.amount }
        : {}),
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
        setOutcome({
          kind: "price_changed",
          lines: data.lines ?? [],
          total: data.total,
          delivery: data.delivery,
        });
        return;
      }
      if (response.status === 429) {
        setOutcome({ kind: "too_many_orders", retryAfterSeconds: data?.retryAfterSeconds ?? 60 });
        return;
      }
      // F-042 — E16: la zona dejó de servirse entre cargar y confirmar.
      // NUNCA se degrada a recogida en silencio: se deselecciona y se le
      // devuelve la decisión al comprador (design.md § 6).
      if (response.status === 409 && data?.error === "DELIVERY_ZONE_NOT_SERVED") {
        setZoneCode(null);
        setOutcome({ kind: "delivery_zone_not_served", zoneCode: data.zoneCode ?? "" });
        return;
      }
      if (response.status === 400 && data?.error === "DELIVERY_ZONE_REQUIRED") {
        setOutcome({ kind: "delivery_zone_required" });
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

  // F-042 (D12) — `deliveryOffered` YA llega como prop del servidor, para
  // los tres modos. R8: el importe que se muestra sale de la MISMA función
  // que cobra el servidor, nunca de una copia de la precedencia aquí.
  const selectedZone = zoneCode ? findZoneInCoverage(zoneCoverage ?? [], zoneCode) : null;
  const chosenZoneForDisplay: ChosenZone | null = selectedZone
    ? { code: selectedZone.code, deliveryFee: selectedZone.deliveryFee }
    : null;
  const deliveryResult = deliveryOffered
    ? deliveryFeeForNewOrder(
        { deliveryEnabled: true, deliveryFeeMode, deliveryFee: deliveryFlatFee },
        fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        chosenZoneForDisplay,
      )
    : null;
  // F-031 R20/E1: with QUOTED_PER_ORDER there is no fee to show for a NEW
  // order — the store sets it once it looks at the address. This is the
  // "sin cotizar" boolean for the checkout, before any order exists.
  const deliveryQuotePending = deliveryResult?.kind === "not_quoted";
  const deliveryFeeMoney =
    quote && deliveryResult?.kind === "charged"
      ? money(deliveryResult.amount, quote.store.currencyCode)
      : null;
  // design.md § 4: "Elige tu municipio" mientras no hay zona; "Gratis" con
  // importe cero (nunca "$0.00" en un envío a domicilio de ZONE_BASED, R11);
  // `null` mientras la cotización carga, para que OrderSummary pinte su
  // propio "Calculando…" — el mismo mientras no se sabe ni el subtotal.
  const deliveryFeeLabel: string | null | undefined = !deliveryOffered
    ? undefined
    : quoteState !== "ready"
      ? null
      : fulfillment === "PICKUP"
        ? formatMoney(money("0", quote?.store.currencyCode ?? "CUP"))
        : deliveryResult?.kind === "not_quoted"
          ? "Por confirmar"
          : deliveryResult?.kind === "zone_required"
            ? "Elige tu municipio"
            : deliveryFeeMoney
              ? deliveryFeeMoney.amount === "0.00"
                ? "Gratis"
                : formatMoney(deliveryFeeMoney)
              : formatMoney(money("0", quote?.store.currencyCode ?? "CUP"));
  const subtotalLabel = quote ? formatMoney(money(quote.subtotal, quote.store.currencyCode)) : null;
  const discountMoney =
    quote && quote.discountTotal !== "0.00" && quote.discountTotal !== "0"
      ? money(quote.discountTotal, quote.store.currencyCode)
      : null;
  const discountLabel = discountMoney ? `−${formatMoney(discountMoney)}` : undefined;
  const totalMoney =
    quote && quoteState === "ready"
      ? add(
          subtract(
            money(quote.subtotal, quote.store.currencyCode),
            discountMoney ?? money("0", quote.store.currencyCode),
          ),
          deliveryFeeMoney ?? money("0", quote.store.currencyCode),
        )
      : null;
  const totalLabel = totalMoney ? formatMoney(totalMoney) : null;
  // DH3: the equivalent of whatever total is being shown right now — final
  // or partial (design.md § 4: "un total parcial también lleva su
  // equivalente"), never the subtotal, the discount or the delivery fee
  // (DH4/SP3(a) applied inside this screen too). `undefined` while there is
  // nothing firm (still loading) or nothing chosen.
  const totalEquivalent =
    quote &&
    totalMoney &&
    referenceCurrency !== REFERENCE_CURRENCY_NOT_HYDRATED &&
    referenceCurrency !== REFERENCE_CURRENCY_NONE
      ? priceEquivalents(
          totalMoney,
          quote.store.displayCurrencies,
          quote.store.currencyCode,
          quote.rates,
        ).find((equivalent) => equivalent.currency === referenceCurrency)
      : undefined;
  const totalEquivalentLabel = totalEquivalent ? formatMoney(totalEquivalent) : null;

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
          <Alert
            tone="warning"
            title={
              outcome.delivery && outcome.lines.length === 0
                ? "El costo del envío cambió mientras hacías el pedido."
                : "El precio cambió mientras hacías el pedido."
            }
          >
            <p>No se creó ningún pedido. Este es el total actualizado.</p>
            <ul className="mt-2 space-y-1">
              {outcome.lines.map((line) => (
                <li key={line.storeProductId}>
                  {line.was && <span className="line-through">Antes {line.was}</span>} Ahora{" "}
                  {line.now}
                </li>
              ))}
              {outcome.delivery && (
                <li>
                  Envío:{" "}
                  {outcome.delivery.was && (
                    <span className="line-through">Antes {outcome.delivery.was}</span>
                  )}{" "}
                  Ahora {outcome.delivery.now}
                </li>
              )}
            </ul>
          </Alert>
        )}
        {outcome.kind === "delivery_zone_not_served" && (
          <Alert tone="danger" title="Esta tienda ya no hace envíos a ese municipio.">
            <p>No se creó ningún pedido. Elige otro municipio o recógelo en la tienda.</p>
          </Alert>
        )}
        {outcome.kind === "delivery_zone_required" && (
          <Alert tone="danger">Elige el municipio a donde enviamos.</Alert>
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

          {/* F-042 (D12, paso 15): ya NO cuelga de `quoteState` — el hecho
              de si hay domicilio lo resolvió el SERVIDOR (`deliveryOffered`
              prop), así que este bloque está en el HTML de la primera
              respuesta para los TRES modos de envío (criterio 1). */}
          {deliveryOffered && (
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
                    deliveryFeeMode === "QUOTED_PER_ORDER"
                      ? "Costo por confirmar"
                      : deliveryFeeMode === "ZONE_BASED"
                        ? // R9: JAMÁS el `deliveryFee` residual de la fila en
                          // ZONE_BASED — el importe vive en la línea del
                          // municipio y en el resumen (design.md § 0).
                          "El costo depende de tu municipio"
                        : deliveryFlatFee
                          ? `+ ${formatMoney(money(deliveryFlatFee, quote?.store.currencyCode ?? "CUP"))}`
                          : undefined
                  }
                  checked={fulfillment === "DELIVERY"}
                  onChange={() => setFulfillment("DELIVERY")}
                />
              </div>

              {/* F-042 (design.md § 2 "El HTML ya trae... el campo de
                  municipio con sus opciones dentro", criterio 1) — SIEMPRE en
                  el árbol, nunca un `&&` que lo quite del HTML: `curl` cuenta
                  municipios en la respuesta cruda, que no ejecuta CSS ni
                  JavaScript. `hidden` es el atributo nativo — el contenido
                  sigue estando en el marcado, solo no se pinta hasta que se
                  elige domicilio. */}
              <div className="mt-3 space-y-3" hidden={fulfillment !== "DELIVERY"}>
                {deliveryFeeMode === "ZONE_BASED" && (
                  <ZonePicker
                    zones={zoneCoverage ?? []}
                    currencyCode={quote?.store.currencyCode ?? "CUP"}
                    storeSlug={storeSlug}
                    value={zoneCode}
                    onChange={setZoneCode}
                    error={fieldErrors.zoneCode}
                  />
                )}
                <Field
                  id="field-deliveryAddress"
                  label="Dirección de entrega"
                  help="Calle, número y entre calles."
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
                {deliveryFeeMode === "QUOTED_PER_ORDER" && (
                  <p className="text-fg-muted text-sm">
                    Cuando la tienda revise tu pedido va a poner el costo del envío y te va a
                    contactar para que lo apruebes o lo rechaces. Hasta entonces no se prepara nada.
                  </p>
                )}
              </div>
            </fieldset>
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
          deliveryFeeLabel={deliveryFeeLabel}
          totalLabel={totalLabel}
          totalCaption={deliveryQuotePending ? "Total parcial" : undefined}
          partialNotice={deliveryQuotePending ? "más el envío por confirmar" : undefined}
          // DH3/D1/D2/D9: same "≈" + sr-only "aproximadamente" split
          // ProductCard uses, and the note only appears alongside it — never
          // on its own, so "Cobramos en CUP" without a number to explain
          // never shows up here.
          equivalentLabel={
            totalEquivalentLabel && (
              <>
                <span aria-hidden>≈</span> <span className="sr-only">aproximadamente </span>
                {totalEquivalentLabel}
              </>
            )
          }
          note={
            totalEquivalentLabel && quote
              ? `Cobramos en ${quote.store.currencyCode}; el equivalente es aproximado.`
              : undefined
          }
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
