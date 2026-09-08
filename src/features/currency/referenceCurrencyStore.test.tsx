import { JSDOM } from "jsdom";
import { renderToString } from "react-dom/server";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFERENCE_CURRENCY_STORAGE_KEY } from "@/constants/currency";
import { REFERENCE_CURRENCY_BOOT_SCRIPT } from "./reveal";
import {
  REFERENCE_CURRENCY_NOT_HYDRATED,
  resolveReferenceCurrency,
  useReferenceCurrencyPreference,
} from "./referenceCurrencyStore";

/**
 * F-039 (architecture.md AD9, § Pruebas: el reparto entre archivos).
 *
 * Two unrelated things share this file on purpose (the fourth "decisión
 * dentro de este reparto" of architecture.md § Pruebas): the React store
 * itself, AND the five branches of `REFERENCE_CURRENCY_BOOT_SCRIPT`
 * (reveal.ts) — that needs its OWN DOM to execute a real `<script>` in, not
 * just the ambient jsdom environment `renderHook` uses, so it lives here
 * rather than in reveal.test.ts (`.test.ts`, node project).
 */

let urlCounter = 0;
/** A fresh origin per JSDOM instance — jsdom's `localStorage` is scoped by
 *  origin, and reusing one across instances lets one test's write leak into
 *  the next. */
function freshUrl(): string {
  urlCounter += 1;
  return `https://example.org/store-${urlCounter}`;
}

function runBootScript(options: {
  stored?: string;
  choices: string;
  defaultCurrency: string;
  blocked?: boolean;
}): string | null {
  const html = `<!doctype html><html><body><div data-ref-choices="${options.choices}" data-ref-default="${options.defaultCurrency}"><script>${REFERENCE_CURRENCY_BOOT_SCRIPT}</script></div></body></html>`;
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: freshUrl(),
    beforeParse(window) {
      if (options.blocked) {
        Object.defineProperty(window, "localStorage", {
          value: {
            getItem() {
              throw new Error("blocked — private browsing or a full quota");
            },
            setItem() {},
            removeItem() {},
          },
          configurable: true,
        });
        return;
      }
      if (options.stored !== undefined) {
        window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, options.stored);
      }
    },
  });
  return dom.window.document.documentElement.getAttribute("data-ref-currency");
}

describe("REFERENCE_CURRENCY_BOOT_SCRIPT, the five branches (architecture.md AD4 table)", () => {
  it("empty storage -> data-ref-default (SP1(a))", () => {
    expect(runBootScript({ choices: "USD MLC", defaultCurrency: "USD" })).toBe("USD");
  });

  it('a stored, OFFERED code -> itself (DH1/DH2: "lo que el comprador eligió")', () => {
    expect(runBootScript({ stored: "MLC", choices: "USD MLC", defaultCurrency: "USD" })).toBe(
      "MLC",
    );
  });

  it('"none" -> "none" (SP1(a): "solo la moneda base")', () => {
    expect(runBootScript({ stored: "none", choices: "USD MLC", defaultCurrency: "USD" })).toBe(
      "none",
    );
  });

  it("a stored code this store does NOT offer -> none (E17, DH5 with a lapsed rate)", () => {
    expect(runBootScript({ stored: "EUR", choices: "USD MLC", defaultCurrency: "USD" })).toBe(
      "none",
    );
  });

  it("garbage that is not a three-letter code -> data-ref-default, and it is never erased (R17)", () => {
    expect(runBootScript({ stored: '{"a":1}', choices: "USD MLC", defaultCurrency: "USD" })).toBe(
      "USD",
    );
  });

  it("localStorage throwing (private browsing, full quota) also falls to data-ref-default", () => {
    expect(runBootScript({ blocked: true, choices: "USD MLC", defaultCurrency: "USD" })).toBe(
      "USD",
    );
  });
});

describe("resolveReferenceCurrency() — the same five branches, mirrored for React", () => {
  it("empty read -> the default", () => {
    expect(resolveReferenceCurrency("", ["USD", "MLC"], "USD")).toBe("USD");
  });

  it("an offered code -> itself", () => {
    expect(resolveReferenceCurrency("MLC", ["USD", "MLC"], "USD")).toBe("MLC");
  });

  it('"none" -> "none"', () => {
    expect(resolveReferenceCurrency("none", ["USD", "MLC"], "USD")).toBe("none");
  });

  it("a code this store does not offer -> none", () => {
    expect(resolveReferenceCurrency("EUR", ["USD", "MLC"], "USD")).toBe("none");
  });
});

describe("useReferenceCurrencyPreference()", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("getServerSnapshot is the not-hydrated sentinel, never a resolved value", () => {
    function Probe() {
      const [preference] = useReferenceCurrencyPreference(["USD", "MLC"]);
      return <span>{preference}</span>;
    }
    // `renderToString` is the one render path that actually calls
    // `getServerSnapshot` — `render()` from Testing Library uses
    // `createRoot`, which never does.
    const html = renderToString(<Probe />);
    expect(html).toContain(REFERENCE_CURRENCY_NOT_HYDRATED);
  });

  it("writes and reads under the exact AD9 storage key", () => {
    const { result } = renderHook(() => useReferenceCurrencyPreference(["USD", "MLC"]));
    act(() => result.current[1]("MLC"));
    expect(window.localStorage.getItem(REFERENCE_CURRENCY_STORAGE_KEY)).toBe("MLC");
    expect(result.current[0]).toBe("MLC");
  });

  it("an unreadable value is treated as no preference, and is never erased (R17)", () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "not-json-and-not-a-code");
    const { result } = renderHook(() => useReferenceCurrencyPreference(["USD", "MLC"]));
    expect(result.current[0]).toBe("USD"); // the default, first offered
    expect(window.localStorage.getItem(REFERENCE_CURRENCY_STORAGE_KEY)).toBe(
      "not-json-and-not-a-code",
    );
  });

  it("a stored preference this store does not offer shows only the base, and survives in the key", () => {
    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "EUR");
    const { result } = renderHook(() => useReferenceCurrencyPreference(["USD", "MLC"]));
    expect(result.current[0]).toBe("none");
    expect(window.localStorage.getItem(REFERENCE_CURRENCY_STORAGE_KEY)).toBe("EUR");
  });

  it("reacts to a storage event from another tab", () => {
    const { result } = renderHook(() => useReferenceCurrencyPreference(["USD", "MLC"]));
    expect(result.current[0]).toBe("USD");

    window.localStorage.setItem(REFERENCE_CURRENCY_STORAGE_KEY, "MLC");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: REFERENCE_CURRENCY_STORAGE_KEY }));
    });
    expect(result.current[0]).toBe("MLC");
  });

  it("writes data-ref-currency on <html> after a change (AD4: único escritor tras el arranque)", () => {
    const { result } = renderHook(() => useReferenceCurrencyPreference(["USD", "MLC"]));
    act(() => result.current[1]("MLC"));
    expect(document.documentElement.getAttribute("data-ref-currency")).toBe("MLC");
  });
});

describe("degradation when localStorage throws (same discipline as cartStorage.ts:24-38)", () => {
  // A fresh module instance per test (`vi.resetModules()` + dynamic
  // `import()`, the same technique `cartStorage.test.tsx` already uses):
  // `isStorageAvailable()` memoizes its probe at module scope, so blocking
  // `setItem` AFTER some earlier test already proved storage works would
  // read a stale cached `true` instead of exercising the fallback.
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);

  afterEach(() => {
    window.localStorage.setItem = originalSetItem;
    vi.resetModules();
  });

  it("falls back to memory and never throws when localStorage is blocked", async () => {
    vi.resetModules();
    const fresh = await import("./referenceCurrencyStore");
    window.localStorage.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };

    const { result } = renderHook(() => fresh.useReferenceCurrencyPreference(["USD"]));
    expect(() => act(() => result.current[1]("USD"))).not.toThrow();
    expect(result.current[0]).toBe("USD");
  });
});
