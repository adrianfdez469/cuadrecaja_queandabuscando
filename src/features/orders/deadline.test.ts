import { describe, expect, it } from "vitest";
import { isProposalExpired, remainingTime } from "./deadline";

const NOW = new Date("2026-08-30T12:00:00.000Z");

describe("isProposalExpired (E12, R8)", () => {
  it("is false while expiresAt is in the future", () => {
    expect(isProposalExpired(new Date("2026-08-30T13:00:00.000Z"), NOW)).toBe(false);
  });

  it("is true the instant expiresAt equals now — no gap with the write path's `> now()`", () => {
    expect(isProposalExpired(NOW, NOW)).toBe(true);
  });

  it("is true once expiresAt is in the past", () => {
    expect(isProposalExpired(new Date("2026-08-30T11:00:00.000Z"), NOW)).toBe(true);
  });
});

describe("remainingTime (design.md § 4.6)", () => {
  it("≥2h: 'Te quedan unas {N} horas para responder.' with integer division", () => {
    const expiresAt = new Date(NOW.getTime() + 24 * 60 * 60_000);
    expect(remainingTime(expiresAt, NOW)).toEqual({
      label: "Te quedan unas 24 horas para responder.",
      tone: "default",
    });
  });

  it("60–119 min: 'Te queda alrededor de 1 hora para responder.'", () => {
    const expiresAt = new Date(NOW.getTime() + 90 * 60_000);
    expect(remainingTime(expiresAt, NOW)).toEqual({
      label: "Te queda alrededor de 1 hora para responder.",
      tone: "warning",
    });
  });

  it("15–59 min: 'Te queda menos de 1 hora para responder.'", () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60_000);
    expect(remainingTime(expiresAt, NOW)).toEqual({
      label: "Te queda menos de 1 hora para responder.",
      tone: "warning",
    });
  });

  it("<15 min: 'Te quedan pocos minutos para responder.'", () => {
    const expiresAt = new Date(NOW.getTime() + 5 * 60_000);
    expect(remainingTime(expiresAt, NOW)).toEqual({
      label: "Te quedan pocos minutos para responder.",
      tone: "danger",
    });
  });

  it("boundary at exactly 120 minutes reads 'unas 2 horas', not the 1h bucket", () => {
    const expiresAt = new Date(NOW.getTime() + 120 * 60_000);
    expect(remainingTime(expiresAt, NOW).label).toBe("Te quedan unas 2 horas para responder.");
  });
});
