"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Field } from "@/components/ui/Field";
import {
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "@/constants/account";
import type { OAuthProvider } from "../types";

/**
 * `/cuenta/entrar`, the whole screen (design.md §§ 1-2): both steps, the
 * four methods, the errors, the resend and its countdown. `fetch`es our own
 * routes only — NEVER imports `@supabase/*` (architecture.md § DA5,
 * `boundaries.test.ts`).
 */

const PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "facebook", label: "Facebook" },
  { id: "apple", label: "Apple" },
];

type Step = "email" | "code";

type FormAlert = { tone: "warning"; message: string } | { tone: "danger"; message: string } | null;

function emailLooksValid(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function postJson(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

export function SignInCard({
  next,
  authConfigured,
  aviso,
}: {
  next: string;
  authConfigured: boolean;
  aviso: "caducado" | "cancelado" | "sesion" | null;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [emailFieldError, setEmailFieldError] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState<OAuthProvider | null>(null);
  const [formAlert, setFormAlert] = useState<FormAlert>(null);

  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(OTP_MAX_ATTEMPTS);
  const [exhausted, setExhausted] = useState<"agotado" | "caducado" | null>(null);
  const [codeFieldError, setCodeFieldError] = useState<string | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const [resendAnnouncement, setResendAnnouncement] = useState<string | null>(null);

  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const exhaustedAlertRef = useRef<HTMLDivElement | null>(null);
  const wantsCodeFocusRef = useRef(false);
  const wantsExhaustedFocusRef = useRef(false);

  useEffect(() => {
    if (!wantsCodeFocusRef.current) return;
    wantsCodeFocusRef.current = false;
    codeInputRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!wantsExhaustedFocusRef.current) return;
    wantsExhaustedFocusRef.current = false;
    exhaustedAlertRef.current?.focus();
  }, [exhausted]);

  // Countdown for "Reenviar el código". The setState lives inside the
  // setInterval callback, not the effect body (ficha
  // set-state-en-efecto-prohibido) — the dependency only flips when the
  // countdown starts or ends, so the interval is not recreated every tick.
  const counting = resendSecondsLeft > 0;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => {
      setResendSecondsLeft((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [counting]);

  function startResendCooldown() {
    setResendSecondsLeft(OTP_RESEND_COOLDOWN_SECONDS);
  }

  async function requestCode(targetEmail: string, { isResend }: { isResend: boolean }) {
    setEmailBusy(true);
    setFormAlert(null);
    try {
      const { status } = await postJson("/api/account/otp", { email: targetEmail });
      if (status === 200) {
        setEmail(targetEmail);
        setCode("");
        setAttemptsLeft(OTP_MAX_ATTEMPTS);
        setExhausted(null);
        setCodeFieldError(null);
        startResendCooldown();
        if (isResend) {
          setResendAnnouncement("Te mandamos un código nuevo.");
          codeInputRef.current?.focus();
        } else {
          wantsCodeFocusRef.current = true;
          setStep("code");
        }
        return;
      }
      if (status === 429) {
        setFormAlert({
          tone: "warning",
          message: "Pediste varios códigos seguidos. Espera un minuto y vuelve a intentarlo.",
        });
        return;
      }
      setFormAlert({
        tone: "danger",
        message: "El acceso a tu cuenta no está disponible ahora mismo.",
      });
    } catch {
      setFormAlert({
        tone: "danger",
        message: "Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.",
      });
    } finally {
      setEmailBusy(false);
    }
  }

  function handleSendCode() {
    const trimmed = email.trim();
    if (!emailLooksValid(trimmed)) {
      setEmailFieldError("Escribe un correo válido. Ej.: ana@correo.cu");
      return;
    }
    setEmailFieldError(null);
    void requestCode(trimmed, { isResend: false });
  }

  async function startProvider(provider: OAuthProvider) {
    setProviderBusy(provider);
    setFormAlert(null);
    try {
      const { status, data } = await postJson("/api/account/oauth", { provider, next });
      if (status === 200 && data && typeof (data as { url?: unknown }).url === "string") {
        window.location.assign((data as { url: string }).url);
        return;
      }
      if (status === 409) {
        setFormAlert({
          tone: "danger",
          message: "Ese método de acceso no está disponible ahora mismo.",
        });
        return;
      }
      setFormAlert({
        tone: "danger",
        message: "El acceso a tu cuenta no está disponible ahora mismo.",
      });
    } catch {
      setFormAlert({
        tone: "danger",
        message: "Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.",
      });
    } finally {
      setProviderBusy(null);
    }
  }

  async function submitCode(candidate: string) {
    setCodeBusy(true);
    try {
      const { status, data } = await postJson("/api/account/otp/verify", {
        email,
        token: candidate,
      });
      if (status === 200) {
        // Hard navigation, deliberately: the session just changed, and what
        // has to be re-read is the server (design.md § 2).
        window.location.href = next;
        return;
      }
      if (status === 401) {
        const reason = (data as { reason?: string } | null)?.reason;
        if (reason === "email_not_confirmed") {
          setFormAlert({
            tone: "warning",
            message:
              "Todavía no confirmaste ese correo: busca el mensaje de confirmación o pide un código nuevo.",
          });
          return;
        }
        if (reason === "expired") {
          setExhausted("caducado");
          wantsExhaustedFocusRef.current = true;
          return;
        }
        const left = attemptsLeft - 1;
        setAttemptsLeft(left);
        if (left <= 0) {
          setExhausted("agotado");
          wantsExhaustedFocusRef.current = true;
          return;
        }
        setCodeFieldError(
          left === 1
            ? "Ese código no es correcto. Te queda 1 intento."
            : `Ese código no es correcto. Te quedan ${left} intentos.`,
        );
        return;
      }
      setFormAlert({
        tone: "danger",
        message: "El acceso a tu cuenta no está disponible ahora mismo.",
      });
    } catch {
      setFormAlert({
        tone: "danger",
        message: "Parece que se cortó la conexión. Revisa tu internet y vuelve a intentar.",
      });
    } finally {
      setCodeBusy(false);
    }
  }

  function handleCodeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH);
    const arrivedAllAtOnce = digits.length - code.length > 1;
    setCode(digits);
    setCodeFieldError(null);
    if (arrivedAllAtOnce && digits.length === OTP_CODE_LENGTH) {
      void submitCode(digits);
    }
  }

  function handleChangeEmail() {
    setStep("email");
    setFormAlert(null);
  }

  if (!authConfigured) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Entrar a tu cuenta</h1>
        <Alert tone="warning" id="signin-disabled-aviso">
          <p>El acceso a tu cuenta no está disponible ahora mismo.</p>
          <p>Puedes seguir comprando sin cuenta: tus pedidos funcionan igual.</p>
        </Alert>
        <div className="space-y-3">
          {PROVIDERS.map((provider) => (
            <Button
              key={provider.id}
              variant="secondary"
              size="lg"
              className="w-full"
              disabled
              aria-describedby="signin-disabled-aviso"
            >
              Continuar con {provider.label}
            </Button>
          ))}
        </div>
        <p className="text-fg-muted text-sm">
          No usamos contraseña: te mandamos un código de 6 dígitos.
        </p>
      </div>
    );
  }

  const avisoMessage =
    aviso === "caducado"
      ? "El acceso caducó. Vuelve a intentarlo."
      : aviso === "cancelado"
        ? "No se completó el acceso."
        : aviso === "sesion"
          ? "Tu sesión se cerró. Vuelve a entrar."
          : null;

  if (step === "email") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Entrar a tu cuenta</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Guarda tus datos una vez y no vuelvas a teclearlos en cada pedido.
          </p>
        </div>

        {avisoMessage && (
          <Alert tone={aviso === "cancelado" ? "warning" : "warning"}>{avisoMessage}</Alert>
        )}
        {formAlert && <Alert tone={formAlert.tone}>{formAlert.message}</Alert>}

        <noscript>
          <p className="text-fg-muted text-sm">
            Para entrar a tu cuenta necesitas activar JavaScript. Puedes seguir comprando sin
            cuenta: tus pedidos funcionan igual.
          </p>
        </noscript>

        <fieldset disabled={emailBusy || providerBusy !== null} className="space-y-3">
          {PROVIDERS.map((provider) => (
            <Button
              key={provider.id}
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              aria-busy={providerBusy === provider.id}
              onClick={() => void startProvider(provider.id)}
            >
              {providerBusy === provider.id
                ? `Abriendo ${provider.label}…`
                : `Continuar con ${provider.label}`}
            </Button>
          ))}
        </fieldset>

        <div className="text-fg-muted text-center text-sm">o</div>

        <fieldset disabled={emailBusy || providerBusy !== null} className="space-y-4">
          <Field
            id="signin-email"
            label="Correo"
            help="Te mandamos un código de 6 dígitos."
            error={emailFieldError ?? undefined}
          >
            {(props) => (
              <input
                {...props}
                type="email"
                autoComplete="email"
                enterKeyHint="go"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSendCode();
                }}
                className="border-border min-h-11 w-full rounded-md border px-3"
              />
            )}
          </Field>
          <Button
            type="button"
            size="lg"
            className="w-full"
            aria-busy={emailBusy}
            onClick={handleSendCode}
          >
            {emailBusy ? "Enviando el código…" : "Enviarme un código"}
          </Button>
        </fieldset>

        <p className="text-fg-muted text-center text-xs">No usamos contraseña.</p>
      </div>
    );
  }

  const showField = exhausted === null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Escribe el código</h2>
        {/* Su propio id, distinto del que compone `Field` para el campo de
            abajo (`${id}-help` = "signin-code-help", por su `help="Escribe
            los 6 dígitos."`). Antes ambos usaban "signin-code-help" — un id
            duplicado en el documento, que deja el `aria-describedby` del
            input apuntando a una referencia ambigua. El input abajo
            referencia AMBOS ids explícitamente (design.md § Accesibilidad
            punto 1: el lector de pantalla tiene que decir a quién se le
            mandó el código al recibir el foco). */}
        <p className="text-fg-muted mt-1 text-sm" id="signin-code-recipient">
          Te mandamos un código de 6 dígitos a {email}.
        </p>
        <button
          type="button"
          className="text-brand min-h-11 px-0 text-sm font-medium underline"
          onClick={handleChangeEmail}
        >
          Cambiar el correo
        </button>
      </div>

      {formAlert && <Alert tone={formAlert.tone}>{formAlert.message}</Alert>}

      {exhausted && (
        <div ref={exhaustedAlertRef} tabIndex={-1}>
          <Alert tone="danger">
            {exhausted === "agotado"
              ? "Ese código ya no sirve. Pide uno nuevo."
              : "El código caducó. Pide uno nuevo."}
          </Alert>
        </div>
      )}

      {showField && (
        <fieldset disabled={codeBusy} className="space-y-4">
          <Field
            id="signin-code"
            label="Código de 6 dígitos"
            help={codeFieldError ? undefined : "Escribe los 6 dígitos."}
            error={codeFieldError ?? undefined}
          >
            {(props) => (
              <input
                {...props}
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                enterKeyHint="go"
                // Sin `maxLength`: el navegador lo aplicaría al texto CRUDO
                // pegado, antes de que `handleCodeChange` filtre los
                // no-dígitos — pegar "123 456" (con espacio) o "Tu código es
                // 123456" perdía dígitos, truncado a 6 caracteres crudos
                // antes del filtrado (design.md § 2 exige que el pegado deje
                // los 6 dígitos limpios). `handleCodeChange` ya filtra y
                // recorta a `OTP_CODE_LENGTH` él mismo, así que el límite
                // sigue existiendo, solo que después de filtrar, no antes.
                value={code}
                aria-describedby={
                  ["signin-code-recipient", props["aria-describedby"]].filter(Boolean).join(" ") ||
                  undefined
                }
                onChange={handleCodeChange}
                className="border-border min-h-14 w-full rounded-md border px-3 text-center text-2xl tracking-[0.35em]"
              />
            )}
          </Field>
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={code.length !== OTP_CODE_LENGTH}
            aria-busy={codeBusy}
            aria-describedby={
              code.length !== OTP_CODE_LENGTH ? "signin-code-empty-help" : undefined
            }
            onClick={() => void submitCode(code)}
          >
            {codeBusy ? "Comprobando…" : "Entrar"}
          </Button>
          {code.length !== OTP_CODE_LENGTH && (
            <p id="signin-code-empty-help" className="sr-only">
              Escribe los 6 dígitos.
            </p>
          )}
        </fieldset>
      )}

      {exhausted && (
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => void requestCode(email, { isResend: true })}
        >
          Pedir un código nuevo
        </Button>
      )}

      {!exhausted && (
        <button
          type="button"
          className="text-fg-muted min-h-11 w-full px-3 text-center text-sm underline disabled:no-underline disabled:opacity-60"
          disabled={resendSecondsLeft > 0}
          aria-live="off"
          onClick={() => void requestCode(email, { isResend: true })}
        >
          {resendSecondsLeft > 0
            ? `Reenviar el código (${resendSecondsLeft} s)`
            : "Reenviar el código"}
        </button>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {resendAnnouncement}
      </p>
    </div>
  );
}
