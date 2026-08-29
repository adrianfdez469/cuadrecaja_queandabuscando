import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * E26: `/cuenta/entrar` never throws and never redirects when Supabase Auth
 * is unconfigured — the closest a unit test gets to "responds 200" for a
 * Server Component, which this repo does not otherwise unit-test (no HTTP
 * harness inside Vitest). The literal HTTP status is checked at the build +
 * smoke-test layer (criterio 6).
 */

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});

describe("/cuenta/entrar sin Supabase Auth configurado (E26, criterio 6)", () => {
  it("renders without throwing, with the four methods disabled", async () => {
    const { default: SignInPage } = await import("./page");
    const element = await SignInPage({
      searchParams: Promise.resolve({}),
      params: Promise.resolve({}),
    });

    render(element);

    expect(screen.getByRole("heading", { name: "Entrar a tu cuenta" })).toBeInTheDocument();
    expect(
      screen.getByText("El acceso a tu cuenta no está disponible ahora mismo."),
    ).toBeInTheDocument();
  });
});
