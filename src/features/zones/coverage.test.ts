import { describe, expect, it } from "vitest";
import {
  distinctProvinces,
  findZoneInCoverage,
  matchesZoneQuery,
  type OfferableZone,
} from "./coverage";

/**
 * F-042 (architecture.md § Componentes, fila `coverage.test.ts`) — las
 * cuatro funciones PURAS de `coverage.ts`: sin catálogo, sin Prisma, sin
 * React (R1, R5, R6, R7). El filtrado que decide QUÉ entra en el conjunto
 * ofrecible (R1(1)-R1(3): nivel MUNICIPALITY, no retirada, `served: true`)
 * vive en `src/features/zones/server/coverage.ts` y se prueba contra
 * Postgres real en `server/coverage.db.test.ts` — este fichero da por hecho
 * que el `OfferableZone[]` que recibe YA es el conjunto ofrecible, y prueba
 * lo que se hace con él.
 */

function zone(overrides: Partial<OfferableZone> = {}): OfferableZone {
  return {
    code: "23.01",
    name: "Playa",
    provinceCode: "23",
    provinceName: "La Habana",
    deliveryFee: "300.00",
    ...overrides,
  };
}

describe("distinctProvinces() — R5: uno, no hay paso; dos o más, lo hay", () => {
  it("una sola provincia en la cobertura -> una sola entrada", () => {
    const zones = [zone(), zone({ code: "23.11", name: "Marianao" })];
    expect(distinctProvinces(zones)).toEqual([{ code: "23", name: "La Habana" }]);
  });

  it("dos provincias -> dos entradas, ordenadas por nombre con colación española", () => {
    const zones = [
      zone(),
      zone({ code: "21.01", name: "Sandino", provinceCode: "21", provinceName: "Pinar del Río" }),
    ];
    expect(distinctProvinces(zones)).toEqual([
      { code: "23", name: "La Habana" },
      { code: "21", name: "Pinar del Río" },
    ]);
  });

  it("la Isla de la Juventud cuenta como su PROPIA provincia — el caso explícito de R5", () => {
    const zones = [
      zone(),
      zone({
        code: "40.01",
        name: "Isla de la Juventud",
        provinceCode: "40",
        provinceName: "Isla de la Juventud",
      }),
    ];
    // Orden alfabético español: "Isla..." precede a "La Habana".
    expect(distinctProvinces(zones)).toEqual([
      { code: "40", name: "Isla de la Juventud" },
      { code: "23", name: "La Habana" },
    ]);
  });

  it("una provincia repetida en varias zonas no duplica su entrada", () => {
    const zones = [
      zone(),
      zone({ code: "23.02", name: "Playa del Este" }),
      zone({ code: "23.11", name: "Marianao" }),
    ];
    expect(distinctProvinces(zones)).toHaveLength(1);
  });

  it("cobertura vacía -> lista vacía", () => {
    expect(distinctProvinces([])).toEqual([]);
  });
});

describe("findZoneInCoverage() — R1/R2, R4: el code es la única identidad", () => {
  const zones = [zone(), zone({ code: "23.11", name: "Marianao" })];

  it("devuelve la zona cuyo code coincide", () => {
    expect(findZoneInCoverage(zones, "23.11")).toEqual(zones[1]);
  });

  it("null para un code que NO está en la cobertura de esta tienda — una NOT_SERVED o retirada nunca resuelve por aquí (R1)", () => {
    expect(findZoneInCoverage(zones, "23.05")).toBeNull();
  });

  it("null para un code que no existe en el catálogo en absoluto — el mismo hecho que un code no ofrecible, para quien llama (E18)", () => {
    expect(findZoneInCoverage(zones, "99.99")).toBeNull();
  });

  it("null sobre una cobertura vacía", () => {
    expect(findZoneInCoverage([], "23.01")).toBeNull();
  });
});

describe("matchesZoneQuery() — R6: el filtro ignora tildes y mayúsculas, sobre la cadena YA plegada", () => {
  it("una query vacía no descarta nada", () => {
    expect(matchesZoneQuery(zone({ name: "Holguín" }), "")).toBe(true);
  });

  it('"holguin" (plegada, sin tilde) encuentra "Holguín" — R6 con letra', () => {
    expect(matchesZoneQuery(zone({ name: "Holguín" }), "holguin")).toBe(true);
  });

  it('"cienfuegos" en mayúsculas plegadas encuentra "Cienfuegos" — R6, el otro ejemplo de la letra', () => {
    expect(matchesZoneQuery(zone({ name: "Cienfuegos" }), "cienfuegos")).toBe(true);
  });

  it('subcadena: "hab" encuentra "La Habana Vieja" (E3)', () => {
    expect(matchesZoneQuery(zone({ name: "La Habana Vieja" }), "hab")).toBe(true);
  });

  it("una query no plegada (con tilde o mayúscula) es responsabilidad de quien llama, no de esta función — no hay fold interno aquí", () => {
    // El contrato es "foldedQuery ya plegado por foldForSearch" (R6): pasar
    // una query cruda demuestra por qué el llamador tiene que plegar ANTES
    // de invocar esto, y no que la función sea insensible por sí sola.
    expect(matchesZoneQuery(zone({ name: "Holguín" }), "HOLGUIN")).toBe(false);
  });

  it("sin coincidencia devuelve false", () => {
    expect(matchesZoneQuery(zone({ name: "Playa" }), "regla")).toBe(false);
  });
});
