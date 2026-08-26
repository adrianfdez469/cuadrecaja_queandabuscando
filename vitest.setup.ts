import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

/**
 * Testing Library waits 1000 ms by default in `findBy*` and `waitFor`, and that
 * default is what makes this suite flaky rather than slow.
 *
 * Measured in F-007: `CheckoutForm.test.tsx` finishes in 86 ms on its own, but
 * with a cold Vitest transform cache and the whole suite running in parallel it
 * drifts to ~1000-1100 ms and loses by a hair — twice in seven runs of one
 * cycle, on either of its two tests indifferently. CI is exactly those
 * conditions: a shared runner, always cold.
 *
 * The timeout is a **ceiling, not a wait**. An element that shows up in 40 ms
 * still resolves at 40 ms, so raising it costs nothing on a green run — it only
 * changes how long a slow one is allowed to take before giving up. A real
 * missing element now takes 5 s to report instead of 1 s, which is the whole
 * price.
 *
 * Full diagnosis, and how to tell this apart from an element that genuinely
 * never renders: .agent/playbook/testing-library-timeout-1s-bajo-carga.md
 */
configure({ asyncUtilTimeout: 5000 });
