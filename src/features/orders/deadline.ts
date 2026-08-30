/**
 * The proposal's clock — pure, no Prisma, no Date.now() default that would
 * make this untestable. R17/R18: the page recalculates this on every `GET`
 * (it is never cached) and shows a RELATIVE label, never a local time —
 * there is no store timezone to show one in (F-022 is still `passes: false`).
 */

export type DeadlineTone = "default" | "warning" | "danger";

export type RemainingTime = { label: string; tone: DeadlineTone };

/**
 * E12/R8: a proposal is expired the instant `expiresAt <= now`, matching the
 * `>` used the other way around in the write path's `WHERE expiresAt > now()`
 * (R8) — the two conditions partition time with no gap and no overlap.
 */
export function isProposalExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * design.md § 4.6, four tiers. `{N}` is the integer division of the minutes
 * left by 60 — with the 24h default, opening the link right away reads
 * "unas 24 horas". Only meaningful while the proposal is still live: call
 * `isProposalExpired` first.
 */
export function remainingTime(expiresAt: Date, now: Date = new Date()): RemainingTime {
  const minutesLeft = Math.floor((expiresAt.getTime() - now.getTime()) / 60_000);

  if (minutesLeft >= 120) {
    const hours = Math.floor(minutesLeft / 60);
    return { label: `Te quedan unas ${hours} horas para responder.`, tone: "default" };
  }
  if (minutesLeft >= 60) {
    return { label: "Te queda alrededor de 1 hora para responder.", tone: "warning" };
  }
  if (minutesLeft >= 15) {
    return { label: "Te queda menos de 1 hora para responder.", tone: "warning" };
  }
  return { label: "Te quedan pocos minutos para responder.", tone: "danger" };
}
