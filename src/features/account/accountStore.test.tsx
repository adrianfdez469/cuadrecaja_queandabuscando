import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionHint } from "./accountStore";

afterEach(() => {
  document.cookie = "qab-shopper-hint=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  vi.unstubAllGlobals();
  vi.resetModules();
});

function HintProbe() {
  return <span>{useSessionHint()}</span>;
}

describe("useSessionHint (NC1)", () => {
  it("sin cookie: guest", () => {
    render(<HintProbe />);
    expect(screen.getByText("guest")).toBeInTheDocument();
  });

  it("con la cookie qab-shopper-hint=1: signed-in", () => {
    document.cookie = "qab-shopper-hint=1; path=/";
    render(<HintProbe />);
    expect(screen.getByText("signed-in")).toBeInTheDocument();
  });
});

describe("getAccountProfile (DA1) — deduplicated per page load", () => {
  it("dos llamadas dentro de la misma carga hacen UNA sola petición", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ signedIn: false, profile: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { getAccountProfile: freshGetAccountProfile } = await import("./accountStore");
    const [a, b] = await Promise.all([freshGetAccountProfile(), freshGetAccountProfile()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("nunca rechaza: una red caída resuelve a signedIn: false (E17)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const { getAccountProfile: freshGetAccountProfile } = await import("./accountStore");
    await expect(freshGetAccountProfile()).resolves.toEqual({ signedIn: false, profile: null });
  });
});
