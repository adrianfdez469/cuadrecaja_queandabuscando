"use client";

import Link from "next/link";
import { useSessionHint } from "../accountStore";

/**
 * The header's account icon (design.md § 0, D7, R23). Same technique as
 * `CartBadge`: `"use client"`, starts at "unknown" on the server and on the
 * first client render — no mismatch — and only paints the dot once the
 * cookie read resolves. Zero requests, zero `@supabase/*` (NC1;
 * `boundaries.test.ts` is what actually enforces the second one).
 */
export function AccountBadge({
  storeSlug,
  authConfigured,
}: {
  storeSlug: string;
  authConfigured: boolean;
}) {
  const hint = useSessionHint();

  // E26: with Auth unconfigured, `authConfigured` is `false` for everyone —
  // computed server-side, so the ISR HTML stays the same for all visitors.
  if (!authConfigured) return null;

  const knownGuest = hint === "guest";
  const href = knownGuest ? `/cuenta/entrar?next=/${storeSlug}` : `/cuenta?desde=/${storeSlug}`;
  const label = knownGuest ? "Entrar a tu cuenta" : "Tu cuenta";

  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap"
    >
      <span className="relative -my-2 inline-flex h-11 w-11 items-center justify-center">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width={24}
          height={24}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5 20c0-3.6 3.13-6.5 7-6.5s7 2.9 7 6.5" />
        </svg>
        {hint === "signed-in" && (
          <span
            aria-hidden
            className="bg-brand-contrast absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
          />
        )}
      </span>
      <span className="hidden sm:inline">Cuenta</span>
    </Link>
  );
}
