"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Field } from "@/components/ui/Field";
import type { AccountProfile } from "../types";

type FieldErrors = Partial<Record<"name" | "phone" | "email", string>>;

const FIELD_LABEL: Record<keyof FieldErrors, string> = {
  name: "Nombre y apellidos",
  phone: "Teléfono",
  email: "Correo",
};

type SaveOutcome =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "network_error" }
  | { kind: "session_expired" };

/**
 * `/cuenta`'s form (design.md § 4). The server already resolved the profile
 * (NC5) — this island only edits, saves and signs out; it never fetches on
 * mount.
 */
export function ProfileForm({ initialProfile }: { initialProfile: AccountProfile }) {
  const [name, setName] = useState(initialProfile.name ?? "");
  const [phone, setPhone] = useState(initialProfile.phone ?? "");
  const [email, setEmail] = useState(initialProfile.email ?? "");
  const [outcome, setOutcome] = useState<SaveOutcome>({ kind: "idle" });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  const dirty =
    name !== (initialProfile.name ?? "") ||
    phone !== (initialProfile.phone ?? "") ||
    email !== (initialProfile.email ?? "");

  async function save() {
    setOutcome({ kind: "saving" });
    try {
      const response = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, email }),
      });
      if (response.status === 200) {
        setOutcome({ kind: "saved" });
        return;
      }
      if (response.status === 401) {
        setOutcome({ kind: "session_expired" });
        return;
      }
      if (response.status === 400) {
        const data = (await response.json().catch(() => null)) as {
          issues?: { path?: unknown[]; message: string }[];
        } | null;
        const errors: FieldErrors = {};
        for (const issue of data?.issues ?? []) {
          const field = issue.path?.[0];
          if (field === "name" || field === "phone" || field === "email") {
            errors[field] = issue.message;
          }
        }
        setOutcome({ kind: "invalid", errors });
        return;
      }
      setOutcome({ kind: "network_error" });
    } catch {
      setOutcome({ kind: "network_error" });
    }
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/account/logout", { method: "POST" });
      if (response.ok || response.redirected) {
        // Hard navigation, deliberately: the session just ended (E4).
        window.location.href = "/";
        return;
      }
      setSignOutError(true);
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  const fieldErrors = outcome.kind === "invalid" ? outcome.errors : {};
  const saving = outcome.kind === "saving";

  return (
    <div className="space-y-6">
      {outcome.kind === "saved" && <Alert tone="positive">Guardamos tus datos.</Alert>}
      {outcome.kind === "invalid" && Object.keys(fieldErrors).length > 0 && (
        <div
          role="alert"
          tabIndex={-1}
          className="bg-danger/12 border-danger/30 rounded-md border p-4 text-sm"
        >
          <p className="font-medium">
            Revisa {Object.keys(fieldErrors).length} dato
            {Object.keys(fieldErrors).length > 1 ? "s" : ""} antes de guardar
          </p>
          <ul className="mt-2 list-inside list-disc">
            {(Object.keys(fieldErrors) as (keyof FieldErrors)[]).map((field) => (
              <li key={field}>
                <a href={`#profile-${field}`} className="underline">
                  {FIELD_LABEL[field]}: {fieldErrors[field]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {outcome.kind === "network_error" && (
        <Alert tone="danger">
          <p>No pudimos guardar tus datos. Revisa tu conexión y vuelve a intentar.</p>
          <Button size="sm" className="mt-3" onClick={() => void save()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {outcome.kind === "session_expired" && (
        <Alert tone="warning">
          <p>Tu sesión se cerró mientras editabas. Vuelve a entrar y guarda otra vez.</p>
          <Link
            href="/cuenta/entrar?next=/cuenta"
            className="text-brand mt-2 inline-block underline"
          >
            Entrar de nuevo
          </Link>
        </Alert>
      )}

      <fieldset disabled={saving} className="space-y-4">
        <Field id="profile-name" label="Nombre y apellidos" error={fieldErrors.name}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-border min-h-11 w-full rounded-md border px-3"
            />
          )}
        </Field>
        <Field
          id="profile-phone"
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
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="border-border min-h-11 w-full rounded-md border px-3"
            />
          )}
        </Field>
        <Field id="profile-email" label="Correo" error={fieldErrors.email}>
          {(props) => (
            <input
              {...props}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="border-border min-h-11 w-full rounded-md border px-3"
            />
          )}
        </Field>

        <Button
          type="button"
          size="lg"
          disabled={!dirty}
          aria-busy={saving}
          aria-describedby={!dirty ? "profile-save-help" : undefined}
          onClick={() => void save()}
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
        {!dirty && (
          <p id="profile-save-help" className="text-fg-muted text-xs">
            No hay cambios que guardar.
          </p>
        )}
      </fieldset>

      <div className="border-border mt-8 border-t pt-6">
        {signOutError && (
          <Alert tone="danger" className="mb-3">
            No pudimos cerrar tu sesión. Revisa tu conexión y vuelve a intentar.
          </Alert>
        )}
        <Button
          type="button"
          variant="secondary"
          aria-busy={signingOut}
          onClick={() => void signOut()}
        >
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </Button>
        <p className="text-fg-muted mt-2 text-xs">Cerrar sesión no borra tu carrito.</p>
      </div>
    </div>
  );
}
