import { beforeEach, describe, expect, it, vi } from "vitest";

const getCustomerUser = vi.fn();
const getProfileByUserId = vi.fn();
const updateProfileByUserId = vi.fn();

vi.mock("@/lib/auth/customerSession", () => ({
  getCustomerUser: (...args: unknown[]) => getCustomerUser(...args),
}));

vi.mock("@/features/account/server/customers", () => ({
  getProfileByUserId: (...args: unknown[]) => getProfileByUserId(...args),
  updateProfileByUserId: (...args: unknown[]) => updateProfileByUserId(...args),
}));

const { GET, PUT } = await import("./route");

const USER = { id: "u1", email: "ana@x.cu", fullName: "Ana Pérez" };
const PROFILE = { name: "Ana Pérez", phone: "+5355555555", email: "ana@x.cu" };

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/account/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  getCustomerUser.mockReset();
  getProfileByUserId.mockReset();
  updateProfileByUserId.mockReset();
});

describe("GET /api/account/profile — always 200", () => {
  it("sin sesión: { signedIn: false, profile: null }, sin tocar la base", async () => {
    getCustomerUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: false, profile: null });
    expect(getProfileByUserId).not.toHaveBeenCalled();
  });

  it("con sesión: { signedIn: true, profile }", async () => {
    getCustomerUser.mockResolvedValue(USER);
    getProfileByUserId.mockResolvedValue(PROFILE);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: true, profile: PROFILE });
    expect(getProfileByUserId).toHaveBeenCalledWith("u1");
  });

  it("nunca lleva id ni supabaseUserId en la respuesta", async () => {
    getCustomerUser.mockResolvedValue(USER);
    getProfileByUserId.mockResolvedValue(PROFILE);
    const response = await GET();
    const data = await response.json();
    expect(data.profile).not.toHaveProperty("id");
    expect(data.profile).not.toHaveProperty("supabaseUserId");
  });
});

describe("PUT /api/account/profile (E9, E10, E11, R20)", () => {
  it("401 UNAUTHORIZED sin sesión, sin llamar a updateProfileByUserId", async () => {
    getCustomerUser.mockResolvedValue(null);
    const response = await put({ name: "Ana", phone: "", email: "" });
    expect(response.status).toBe(401);
    expect(updateProfileByUserId).not.toHaveBeenCalled();
  });

  it("con sesión y datos válidos: 200 y guarda solo lo que la sesión determina", async () => {
    getCustomerUser.mockResolvedValue(USER);
    updateProfileByUserId.mockResolvedValue(PROFILE);
    const response = await put({ name: "Ana Pérez", phone: "+53 5555 5555", email: "ana@x.cu" });
    expect(response.status).toBe(200);
    expect(updateProfileByUserId).toHaveBeenCalledWith("u1", expect.any(Object));
  });

  it("400 con un teléfono de 3 dígitos, sin guardar nada (E10)", async () => {
    getCustomerUser.mockResolvedValue(USER);
    const response = await put({ name: "", phone: "123", email: "" });
    expect(response.status).toBe(400);
    expect(updateProfileByUserId).not.toHaveBeenCalled();
  });

  it("un id o supabaseUserId en el cuerpo se ignora — la fila la decide SOLO la sesión (E11, R20)", async () => {
    getCustomerUser.mockResolvedValue(USER);
    updateProfileByUserId.mockResolvedValue(PROFILE);
    await put({ name: "", phone: "", email: "", id: "otro-cliente", supabaseUserId: "otro-user" });
    expect(updateProfileByUserId).toHaveBeenCalledWith("u1", { name: "", phone: "", email: "" });
  });
});
