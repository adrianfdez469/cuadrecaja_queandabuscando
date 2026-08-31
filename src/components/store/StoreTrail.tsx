import Link from "next/link";
import { backTarget, breadcrumbList, type Trail } from "@/features/storefront/trail";
import { jsonLdScriptContent } from "@/lib/jsonLd";
import { publicEnv } from "@/lib/env";

/**
 * The navigation trail (design.md § Decisiones 1-5, architecture.md §
 * Contratos § El componente). A single `<nav aria-label="Ruta">` with an
 * `<ol>` of `<li>`, one per `Crumb`. The "back" control is not a separate
 * piece: it is the penultimate crumb, styled differently, derived INSIDE
 * from `backTarget(trail)` — no page ever paints it by hand, which is what
 * keeps R2 a structural guarantee instead of a rule someone has to remember.
 *
 * Server component. No `"use client"`: AGENTS.md § Prohibiciones forbids it
 * on anything that renders catalogue, and this mounts inside it (R8).
 */
export function StoreTrail({
  trail,
  jsonLd = false,
}: {
  trail: Trail;
  /** Only the three indexable screens ask for it (R13). The safe default is
   *  not to declare structured data. */
  jsonLd?: boolean;
}) {
  const back = backTarget(trail);
  const structuredData = jsonLd ? breadcrumbList(trail, publicEnv.siteUrl) : null;

  return (
    <>
      <nav aria-label="Ruta" className="mb-4">
        <ol className="flex min-h-11 min-w-0 items-center">
          {trail.map((crumb, index) => {
            const isFirst = index === 0;
            const isBack = back !== null && index === trail.length - 2;

            return (
              <li
                key={`${index}-${crumb.label}`}
                className={crumbListItemClasses({ isBack, crumb, trail })}
              >
                {!isFirst && (
                  <span aria-hidden="true" className="text-fg-muted shrink-0 px-1.5">
                    ›
                  </span>
                )}
                {crumb.href === null ? (
                  <span aria-current="page" className={CURRENT_CLASSES}>
                    <span className="truncate">{crumb.label}</span>
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className={isBack ? BACK_LINK_CLASSES : ANCESTOR_LINK_CLASSES}
                  >
                    <span className="truncate">{crumb.label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {structuredData !== null && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(structuredData) }}
        />
      )}
    </>
  );
}

const LINK_BASE_CLASSES =
  "flex min-h-11 min-w-0 items-center focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-2";
const ANCESTOR_LINK_CLASSES = `${LINK_BASE_CLASSES} text-fg-muted hover:text-fg hover:underline hover:underline-offset-4`;
const BACK_LINK_CLASSES = `${LINK_BASE_CLASSES} text-fg font-medium underline underline-offset-4 hover:decoration-2`;
const CURRENT_CLASSES = `${LINK_BASE_CLASSES} text-fg-muted`;

/**
 * design.md § Decisión 2: the "back" crumb's cap, `100% − 3rem × (n−1)` —
 * exactly what is left once every other crumb has claimed its `min-w-12`
 * floor, so the sum of floors is 100% and the row can never overflow.
 * Written literal per crumb, not composed at runtime: Tailwind only emits a
 * class it can find written whole in the source. The trail never grows past
 * four crumbs (architecture.md § Cómo se construye el rastro…), so a length
 * past 4 falls back to 4's cap rather than composing a new one.
 */
const BACK_MAX_WIDTH_CLASS: Record<number, string> = {
  2: "max-w-[calc(100%-3rem)]",
  3: "max-w-[calc(100%-6rem)]",
  4: "max-w-[calc(100%-9rem)]",
};

function crumbListItemClasses({
  isBack,
  crumb,
  trail,
}: {
  isBack: boolean;
  crumb: Trail[number];
  trail: Trail;
}): string {
  if (isBack) {
    const cap = BACK_MAX_WIDTH_CLASS[trail.length] ?? BACK_MAX_WIDTH_CLASS[4];
    return `flex min-w-12 shrink-0 items-center ${cap}`;
  }
  if (crumb.href === null) {
    return "flex min-w-12 shrink-[9999] items-center";
  }
  return "flex min-w-12 shrink items-center";
}
