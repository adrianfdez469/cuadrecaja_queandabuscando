import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-019 architecture.md DA4, ADR 0024. `resolvePublicSlug` and
 * `respondToProposal` are the only DOMAIN mocks — this route imports no
 * Prisma of its own (ESLint's own boundary rule would fail the build
 * otherwise).
 *
 * F-020: `next/server`'s `after` is ALSO mocked, invoking its callback
 * synchronously — the real `after()` throws "called outside a request
 * scope" when a route handler is invoked directly like this test does, with
 * no actual Next request pipeline underneath. Invoking synchronously (rather
 * than swallowing it) is what lets the assertions below observe whether the
 * bell rang, same as production observes it after the real response left.
 * `ringOrderBell` is mocked too, so that synchronous call never reaches
 * Postgres.
 */

const respondToProposal = vi.fn();
const resolvePublicSlug = vi.fn();
const ringOrderBell = vi.fn();

vi.mock("@/features/orders/server/respond", () => ({
  respondToProposal: (...args: unknown[]) => respondToProposal(...args),
}));

vi.mock("@/features/storefront/server/resolve", () => ({
  resolvePublicSlug: (...args: unknown[]) => resolvePublicSlug(...args),
}));

vi.mock("@/features/orders/server/bell", () => ({
  ringOrderBell: (...args: unknown[]) => ringOrderBell(...args),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => unknown) => callback() };
});

const { POST } = await import("./route");

const CODE = "A7K3M9PQR2";
const URL = `http://localhost/tienda-demo/pedido/${CODE}/respuesta`;

function postForm(
  decision: string | null,
  {
    accept = "*/*",
    origin,
    // A real request always carries the `Host` of whatever actually served
    // it — this is what `isCrossOrigin()` compares `Origin` against, never
    // an env constant. Default matches `URL` below ("localhost").
    host = "localhost",
    padBytes,
  }: { accept?: string; origin?: string; host?: string; padBytes?: number } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept,
    host,
  };
  if (origin !== undefined) headers.origin = origin;

  let body = decision === null ? "" : `decision=${encodeURIComponent(decision)}`;
  // The Fetch API recomputes `Content-Length` from the real body on a Request
  // constructed like this (it is a forbidden header to set by hand), so
  // exceeding the cap is exercised with an actually oversized body.
  if (padBytes) body += `&pad=${"x".repeat(padBytes)}`;

  return POST(new Request(URL, { method: "POST", headers, body }), {
    params: Promise.resolve({ slug: "tienda-demo", code: CODE }),
  });
}

beforeEach(() => {
  respondToProposal.mockReset();
  resolvePublicSlug.mockReset().mockResolvedValue({ kind: "branch", storeId: "store-1" });
  ringOrderBell.mockReset();
});

describe("POST /[slug]/pedido/[code]/respuesta — aplicado (E5, E6)", () => {
  it("aprobar: JSON {status, applied:true} para una máquina (sin Accept: text/html)", async () => {
    respondToProposal.mockResolvedValue({
      kind: "applied",
      status: "CONFIRMED",
      businessId: "business-1",
    });
    const response = await postForm("aprobar");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "CONFIRMED", applied: true });
    expect(respondToProposal).toHaveBeenCalledWith({
      storeId: "store-1",
      code: CODE,
      decision: "aprobar",
    });
  });

  it("aprobar: 303 hacia ?r=aprobada para un navegador (Accept: text/html)", async () => {
    respondToProposal.mockResolvedValue({
      kind: "applied",
      status: "CONFIRMED",
      businessId: "business-1",
    });
    const response = await postForm("aprobar", { accept: "text/html" });

    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toContain(`/tienda-demo/pedido/${CODE}`);
    expect(location).toContain("r=aprobada");
  });

  it("rechazar: JSON {status, applied:true}", async () => {
    respondToProposal.mockResolvedValue({
      kind: "applied",
      status: "CANCELLED",
      businessId: "business-1",
    });
    const response = await postForm("rechazar");

    await expect(response.json()).resolves.toEqual({ status: "CANCELLED", applied: true });
  });
});

describe("POST — repetido, idempotente (E7)", () => {
  it("200 applied:false para la máquina, mismo destino 303 para el navegador", async () => {
    respondToProposal.mockResolvedValue({ kind: "idempotent", status: "CONFIRMED" });

    const jsonResponse = await postForm("aprobar");
    expect(jsonResponse.status).toBe(200);
    await expect(jsonResponse.json()).resolves.toEqual({ status: "CONFIRMED", applied: false });

    const htmlResponse = await postForm("aprobar", { accept: "text/html" });
    expect(htmlResponse.headers.get("location")).toContain("r=aprobada");
  });
});

describe("POST — los tres 409 de DA4", () => {
  it("decisión contraria: 409 PROPOSAL_ALREADY_DECIDED / ?r=conflicto", async () => {
    respondToProposal.mockResolvedValue({ kind: "already_decided", status: "CANCELLED" });

    const response = await postForm("aprobar");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "PROPOSAL_ALREADY_DECIDED",
      status: "CANCELLED",
    });

    const html = await postForm("aprobar", { accept: "text/html" });
    expect(html.headers.get("location")).toContain("r=conflicto");
  });

  it("vencida: 409 PROPOSAL_EXPIRED / ?r=vencida (E11)", async () => {
    respondToProposal.mockResolvedValue({ kind: "expired", status: "AWAITING_CUSTOMER" });

    const response = await postForm("aprobar");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "PROPOSAL_EXPIRED",
      status: "AWAITING_CUSTOMER",
    });

    const html = await postForm("aprobar", { accept: "text/html" });
    expect(html.headers.get("location")).toContain("r=vencida");
  });

  it("sin propuesta viva: 409 NO_LIVE_PROPOSAL / ?r=no-disponible (E8)", async () => {
    respondToProposal.mockResolvedValue({ kind: "no_live_proposal", status: "REJECTED_BY_STORE" });

    const response = await postForm("aprobar");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "NO_LIVE_PROPOSAL",
      status: "REJECTED_BY_STORE",
    });
  });
});

describe("POST — código desconocido o de otra tienda (R22)", () => {
  it("404 UNKNOWN_ORDER para la máquina cuando el slug no resuelve", async () => {
    resolvePublicSlug.mockResolvedValue(null);
    const response = await postForm("aprobar");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "UNKNOWN_ORDER" });
    expect(respondToProposal).not.toHaveBeenCalled();
  });

  it("303 hacia la página (sin ?r=) para el navegador, que resuelve su propio 404", async () => {
    resolvePublicSlug.mockResolvedValue(null);
    const response = await postForm("aprobar", { accept: "text/html" });
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toContain(`/tienda-demo/pedido/${CODE}`);
    expect(location).not.toContain("r=");
  });

  it("404 cuando respondToProposal no encuentra la fila por (storeId, code)", async () => {
    respondToProposal.mockResolvedValue({ kind: "unknown_order" });
    const response = await postForm("aprobar");
    expect(response.status).toBe(404);
  });

  it("404 sin llamar a respondToProposal cuando el código ni siquiera tiene forma válida", async () => {
    const response = await POST(
      new Request(`http://localhost/tienda-demo/pedido/bad/respuesta`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "decision=aprobar",
      }),
      { params: Promise.resolve({ slug: "tienda-demo", code: "bad" }) },
    );
    expect(response.status).toBe(404);
    expect(respondToProposal).not.toHaveBeenCalled();
  });
});

describe("POST — cuerpo inválido (ADR 0024)", () => {
  it("400 INVALID_DECISION cuando falta decision", async () => {
    const response = await postForm(null);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_DECISION" });
    expect(respondToProposal).not.toHaveBeenCalled();
  });

  it("400 INVALID_DECISION cuando decision no es aprobar/rechazar", async () => {
    const response = await postForm("tal-vez");
    expect(response.status).toBe(400);
    expect(respondToProposal).not.toHaveBeenCalled();
  });

  it("400 cuando el body real excede el tope de 1 KB (ADR 0024 defensa 7)", async () => {
    const response = await postForm("aprobar", { padBytes: 2048 });
    expect(response.status).toBe(400);
    expect(respondToProposal).not.toHaveBeenCalled();
  });
});

describe("POST — Origin cruzado (ADR 0024 defensa 8)", () => {
  it("403 cuando Origin no coincide con el Host real de la petición", async () => {
    const response = await postForm("aprobar", { origin: "https://evil.example.com" });
    expect(response.status).toBe(403);
    expect(respondToProposal).not.toHaveBeenCalled();
  });

  it("procede normalmente sin cabecera Origin (curl, la mayoría de los POST de formulario)", async () => {
    respondToProposal.mockResolvedValue({
      kind: "applied",
      status: "CONFIRMED",
      businessId: "business-1",
    });
    const response = await postForm("aprobar");
    expect(response.status).toBe(200);
  });

  // Regresión: isCrossOrigin() comparaba contra publicEnv.siteUrl (una
  // constante de entorno), no contra el origen REAL de la petición. Un
  // navegador real en cualquier host:puerto que no fuera exactamente el de
  // esa constante — un `next dev` en otro puerto, un deploy de preview —
  // recibía 403 FORBIDDEN_ORIGIN en un envío perfectamente same-origin.
  // `.agent/playbook/origin-header-contra-env-estatico-no-el-real.md`.
  it("no rechaza un Origin con host:puerto distinto de NEXT_PUBLIC_SITE_URL cuando coincide con el Host real (regresión)", async () => {
    respondToProposal.mockResolvedValue({
      kind: "applied",
      status: "CONFIRMED",
      businessId: "business-1",
    });
    // NEXT_PUBLIC_SITE_URL (.env) es "http://localhost:3000". Un navegador
    // real sirviendo la app en el puerto 3101 (el que usa
    // `verify.sh --visual` por defecto) manda Origin/Host "localhost:3101" —
    // same-origin de verdad, distinto solo de la constante estática. Con la
    // comparación vieja (contra `publicEnv.siteUrl`) esto daba 403.
    const response = await postForm("aprobar", {
      origin: "http://localhost:3101",
      host: "localhost:3101",
    });
    expect(response.status).toBe(200);
    expect(respondToProposal).toHaveBeenCalled();
  });
});

describe("POST — el timbre, segundo disparador (F-020, architecture.md DA2)", () => {
  it("aprobar (kind applied) programa after(() => ringOrderBell(businessId))", async () => {
    respondToProposal.mockResolvedValue({
      kind: "applied",
      status: "CONFIRMED",
      businessId: "business-1",
    });
    await postForm("aprobar");

    expect(ringOrderBell).toHaveBeenCalledTimes(1);
    expect(ringOrderBell).toHaveBeenCalledWith("business-1");
  });

  it("rechazar (kind applied) también programa el timbre, con el mismo businessId", async () => {
    respondToProposal.mockResolvedValue({
      kind: "applied",
      status: "CANCELLED",
      businessId: "business-2",
    });
    await postForm("rechazar");

    expect(ringOrderBell).toHaveBeenCalledWith("business-2");
  });

  // R8/E14: repetir la misma decisión ya resuelta no escribe nada nuevo, así
  // que no hay novedad que timbrar.
  it("E14 — repetir la misma decisión (kind idempotent) NO timbra", async () => {
    respondToProposal.mockResolvedValue({ kind: "idempotent", status: "CONFIRMED" });
    await postForm("aprobar");

    expect(ringOrderBell).not.toHaveBeenCalled();
  });

  it("un 409 (already_decided/expired/no_live_proposal) no timbra", async () => {
    respondToProposal.mockResolvedValue({ kind: "already_decided", status: "CANCELLED" });
    await postForm("aprobar");

    expect(ringOrderBell).not.toHaveBeenCalled();
  });

  it("unknown_order no timbra", async () => {
    respondToProposal.mockResolvedValue({ kind: "unknown_order" });
    await postForm("aprobar");

    expect(ringOrderBell).not.toHaveBeenCalled();
  });
});
