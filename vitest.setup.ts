import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

/**
 * Testing Library waits 1000 ms by default in `findBy*` and `waitFor`. This
 * raises that ceiling to 8 s.
 *
 * Read the history before trusting the number. It was introduced in F-007 for
 * a `CheckoutForm.test.tsx` flake diagnosed as the suite drifting past the
 * 1000 ms default under load — and that diagnosis was WRONG. The real cause
 * was a race the test lost, not a budget it exceeded: it clicked a submit
 * button still disabled while the quote loaded, so nothing was ever going to
 * render and no ceiling could have helped. Raising this to 8 s only made the
 * failure take 8 s to report; the flake survived every increase until the test
 * itself was fixed (see `enviarActivado()` there, and the ficha
 * `testing-library-timeout-1s-bajo-carga`).
 *
 * The ceiling stays because a ceiling is not a wait: an element that appears
 * in 40 ms still resolves at 40 ms, so it costs nothing on a green run. But it
 * is no longer load insurance for anything known, and if it ever gets in the
 * way of reading a real failure, lowering it back towards the default is the
 * right move — not raising it again.
 */
configure({ asyncUtilTimeout: 8000 });
