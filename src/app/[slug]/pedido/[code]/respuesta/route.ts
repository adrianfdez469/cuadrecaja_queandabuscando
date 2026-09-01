import { NextResponse, after } from "next/server";
import { resolvePublicSlug } from "@/features/storefront/server/resolve";
import { respondToProposal } from "@/features/orders/server/respond";
import { ringOrderBell } from "@/features/orders/server/bell";
import type { ProposalDecision } from "@/features/orders/types";
import { isOrderCode, normalizeOrderCode } from "@/lib/orderCode";
import {
  ORDER_PROPOSAL_DECISION,
  ORDER_RESPONSE_MAX_BODY_BYTES,
  ORDER_RESPONSE_OUTCOME,
  type OrderResponseOutcome,
} from "@/constants/orders";

export const dynamic = "force-dynamic";

/**
 * The customer's response to a proposal (architecture.md DA4, ADR 0024). The
 * SECOND public write route of the whole system — no session, `code` is the
 * only credential, exactly like the page it answers to.
 *
 * One contract, two representations, decided by `Accept` (never by a query
 * param a caller could spoof into skipping validation): a `<form
 * method="post">` gets `303` (POST/Redirect/GET — no "resend form?" dialog,
 * R16 needs no JavaScript for any of this), `curl` and the smoke script get
 * plain JSON with a real status code, unwrapped by a redirect.
 */

const DECISION_VALUES: readonly string[] = Object.values(ORDER_PROPOSAL_DECISION);

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** ADR 0024 defensa 8: a cross-origin `Origin` gets nothing — it does not
 *  ride on any ambient credential (there is no cookie here), so this only
 *  frames a "click here" page that already knew the code.
 *
 * Compared against the request's OWN `Host` header, never against a static
 * env constant (`NEXT_PUBLIC_SITE_URL`): a real browser sends `Origin` on
 * every non-GET/HEAD request, including a perfectly same-origin one, and any
 * dev port, preview deploy, or canonical-domain drift from that constant
 * would otherwise 403 a legitimate submission
 * (`.agent/playbook/origin-header-contra-env-estatico-no-el-real.md`). */
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function parseDecision(value: string | null): ProposalDecision | null {
  return value !== null && DECISION_VALUES.includes(value) ? (value as ProposalDecision) : null;
}

/**
 * ADR 0024 defensa 7: hard cap on the body. Reads the raw body ONCE and
 * measures it directly — `Content-Length` is not trustworthy input (chunked
 * transfer omits it, and nothing stops a caller from lying about it), so the
 * actual byte count is what decides, not a header.
 */
async function readDecision(request: Request): Promise<ProposalDecision | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > ORDER_RESPONSE_MAX_BODY_BYTES) return null;

  return parseDecision(new URLSearchParams(text).get("decision"));
}

function redirectTo(
  request: Request,
  slug: string,
  code: string,
  outcome?: OrderResponseOutcome,
): NextResponse {
  const url = new URL(`/${slug}/pedido/${code}`, request.url);
  if (outcome) url.searchParams.set("r", outcome);
  return NextResponse.redirect(url, 303);
}

function reply(
  html: boolean,
  request: Request,
  slug: string,
  code: string,
  outcome: OrderResponseOutcome | undefined,
  json: Record<string, unknown>,
  status = 200,
): NextResponse {
  return html ? redirectTo(request, slug, code, outcome) : NextResponse.json(json, { status });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/[slug]/pedido/[code]/respuesta">,
) {
  const { slug, code: rawCode } = await params;
  const html = wantsHtml(request);

  if (isCrossOrigin(request)) {
    return NextResponse.json({ error: "FORBIDDEN_ORIGIN" }, { status: 403 });
  }

  const code = normalizeOrderCode(rawCode);
  if (!isOrderCode(code)) {
    // R22: an unrecognizable code answers exactly like an unknown one.
    return html
      ? redirectTo(request, slug, rawCode)
      : NextResponse.json({ error: "UNKNOWN_ORDER" }, { status: 404 });
  }

  const decision = await readDecision(request);
  if (!decision) {
    return reply(
      html,
      request,
      slug,
      rawCode,
      ORDER_RESPONSE_OUTCOME.UNAVAILABLE,
      { error: "INVALID_DECISION" },
      400,
    );
  }

  const resolution = await resolvePublicSlug(slug);
  if (!resolution || resolution.kind !== "branch") {
    return html
      ? redirectTo(request, slug, rawCode)
      : NextResponse.json({ error: "UNKNOWN_ORDER" }, { status: 404 });
  }

  const result = await respondToProposal({ storeId: resolution.storeId, code, decision });
  // F-020: the SECOND trigger (architecture.md DA2). ONLY on "applied" —
  // R8/E14: an idempotent 200 (the same decision repeated) writes nothing
  // new, so it never rings. Same payload as the first trigger (R14): the
  // channel does not say which of the two fired.
  if (result.kind === "applied") after(() => ringOrderBell(result.businessId));
  const appliedOutcome =
    decision === ORDER_PROPOSAL_DECISION.APPROVE
      ? ORDER_RESPONSE_OUTCOME.APPROVED
      : ORDER_RESPONSE_OUTCOME.REJECTED;

  switch (result.kind) {
    case "applied":
      return reply(html, request, slug, rawCode, appliedOutcome, {
        status: result.status,
        applied: true,
      });
    case "idempotent":
      return reply(html, request, slug, rawCode, appliedOutcome, {
        status: result.status,
        applied: false,
      });
    case "already_decided":
      return reply(
        html,
        request,
        slug,
        rawCode,
        ORDER_RESPONSE_OUTCOME.CONFLICT,
        { error: "PROPOSAL_ALREADY_DECIDED", status: result.status },
        409,
      );
    case "expired":
      return reply(
        html,
        request,
        slug,
        rawCode,
        ORDER_RESPONSE_OUTCOME.EXPIRED,
        { error: "PROPOSAL_EXPIRED", status: result.status },
        409,
      );
    case "no_live_proposal":
      return reply(
        html,
        request,
        slug,
        rawCode,
        ORDER_RESPONSE_OUTCOME.UNAVAILABLE,
        { error: "NO_LIVE_PROPOSAL", status: result.status },
        409,
      );
    case "unknown_order":
      return html
        ? redirectTo(request, slug, rawCode)
        : NextResponse.json({ error: "UNKNOWN_ORDER" }, { status: 404 });
  }
}
