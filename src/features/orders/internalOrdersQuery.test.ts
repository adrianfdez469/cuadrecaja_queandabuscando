import { describe, expect, it } from "vitest";
import { ORDER_QUERY_ISSUE } from "@/constants/orders";
import { parseInternalOrdersQuery } from "./internalOrdersQuery";

/**
 * `parseInternalOrdersQuery` puro — sin `Request`, sin mocks (F-033 plan.md
 * paso 9, architecture.md DA8). Criterios 6, 7, 8; los casos son E10-E15 de
 * `spec.md`.
 */

function params(query: string): URLSearchParams {
  // `query` viaja SIN el `?` inicial; `URLSearchParams` ya decodifica.
  return new URLSearchParams(query);
}

describe("parseInternalOrdersQuery() — modo pull, sin cambios (E15)", () => {
  it("sin ningún parámetro usa los defaults 0 y 100, modo pull", () => {
    const result = parseInternalOrdersQuery(params(""));
    expect(result).toEqual({ ok: true, query: { mode: "pull", since: 0n, limit: 100 } });
  });

  it("since y limit presentes viajan tal cual al modo pull", () => {
    const result = parseInternalOrdersQuery(params("since=42&limit=7"));
    expect(result).toEqual({ ok: true, query: { mode: "pull", since: 42n, limit: 7 } });
  });
});

describe("parseInternalOrdersQuery() — ?status= fuera del enum (E10, criterio 6)", () => {
  it.each([
    ["NOPE", "no es uno de los nueve"],
    ["", "vacío"],
    ["pulled", "en minúsculas"],
    ["PULLED,CONFIRMED", "dos estados separados por coma"],
  ])("%s (%s) responde ok:false, path:['status']", (value) => {
    const result = parseInternalOrdersQuery(params(`status=${value}`));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toEqual([{ path: ["status"], message: expect.any(String) }]);
  });

  it("un valor válido del enum, exacto y sensible a mayúsculas, sí pasa", () => {
    const result = parseInternalOrdersQuery(params("status=AWAITING_CUSTOMER"));
    expect(result).toEqual({
      ok: true,
      query: { mode: "status", status: "AWAITING_CUSTOMER", after: 0n, limit: 100 },
    });
  });
});

describe("parseInternalOrdersQuery() — ?ids= que no es una lista de enteros (E11, criterio 6)", () => {
  it.each([["abc"], ["1,,2"], ["1.5"], ["-1"], [""], ["1 2"]])(
    "%s responde ok:false, path:['ids']",
    (value) => {
      const result = parseInternalOrdersQuery(params(`ids=${encodeURIComponent(value)}`));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.issues).toEqual([{ path: ["ids"], message: expect.any(String) }]);
    },
  );

  it("una lista de enteros decimales válida entra en modo ids", () => {
    const result = parseInternalOrdersQuery(params("ids=1,2,3"));
    expect(result).toEqual({ ok: true, query: { mode: "ids", ids: [1n, 2n, 3n] } });
  });
});

describe("parseInternalOrdersQuery() — el tope de 100 ids (E12, criterio 7)", () => {
  it("101 ids responde 400 IDS_LIMIT_EXCEEDED, nunca la lista recortada", () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
    const result = parseInternalOrdersQuery(params(`ids=${ids}`));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toEqual([
      { path: ["ids"], message: ORDER_QUERY_ISSUE.IDS_LIMIT_EXCEEDED },
    ]);
  });

  it("exactamente 100 ids sí entra en modo ids", () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1).join(",");
    const result = parseInternalOrdersQuery(params(`ids=${ids}`));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.query.mode).toBe("ids");
    if (result.query.mode !== "ids") throw new Error("unreachable");
    expect(result.query.ids).toHaveLength(100);
  });
});

describe("parseInternalOrdersQuery() — since junto a status o ids, por presencia (E13, R6, criterio 8)", () => {
  it.each([
    ["since=5&status=PULLED", "since=5 + status"],
    ["since=0&status=PULLED", "since=0 (R6: se detecta por presencia, no por valor)"],
    ["since=5&ids=1,2", "since=5 + ids"],
    ["since=0&ids=1,2", "since=0 + ids (R6)"],
  ])("%s (%s) responde 400 SINCE_WITH_LATERAL_READ", (query) => {
    const result = parseInternalOrdersQuery(params(query));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toContainEqual({
      path: [],
      message: ORDER_QUERY_ISSUE.SINCE_WITH_LATERAL_READ,
    });
  });
});

describe("parseInternalOrdersQuery() — las otras tres combinaciones ambiguas (E14, SP6, criterio 8)", () => {
  it("status y ids a la vez responde 400 STATUS_WITH_IDS", () => {
    const result = parseInternalOrdersQuery(params("status=PULLED&ids=1,2"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toContainEqual({
      path: [],
      message: ORDER_QUERY_ISSUE.STATUS_WITH_IDS,
    });
  });

  it("after sin status responde 400 AFTER_WITHOUT_STATUS", () => {
    const result = parseInternalOrdersQuery(params("after=7"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toContainEqual({
      path: [],
      message: ORDER_QUERY_ISSUE.AFTER_WITHOUT_STATUS,
    });
  });

  it("limit junto a ids responde 400 LIMIT_WITH_IDS — nunca 1 de los 2 ids", () => {
    const result = parseInternalOrdersQuery(params("ids=1,2&limit=1"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues).toContainEqual({ path: [], message: ORDER_QUERY_ISSUE.LIMIT_WITH_IDS });
  });

  it("after con status sí es válido", () => {
    const result = parseInternalOrdersQuery(params("status=PULLED&after=7"));
    expect(result).toEqual({
      ok: true,
      query: { mode: "status", status: "PULLED", after: 7n, limit: 100 },
    });
  });
});

describe("parseInternalOrdersQuery() — issues siempre con exactamente message y path (criterio 6)", () => {
  it("cada issue de cada rechazo tiene únicamente esas dos claves", () => {
    const queries = [
      "status=NOPE",
      "ids=abc",
      "since=5&status=PULLED",
      "status=PULLED&ids=1",
      "after=1",
      "ids=1,2&limit=1",
    ];
    for (const query of queries) {
      const result = parseInternalOrdersQuery(params(query));
      expect(result.ok, query).toBe(false);
      if (result.ok) continue;
      for (const issue of result.issues) {
        expect(Object.keys(issue).sort(), query).toEqual(["message", "path"]);
      }
    }
  });

  it("varias violaciones a la vez emiten TODOS los issues, en el orden fijo", () => {
    const result = parseInternalOrdersQuery(params("since=0&status=PULLED&ids=1,2&limit=5"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.issues.map((i) => i.message)).toEqual([
      ORDER_QUERY_ISSUE.SINCE_WITH_LATERAL_READ,
      ORDER_QUERY_ISSUE.STATUS_WITH_IDS,
      ORDER_QUERY_ISSUE.LIMIT_WITH_IDS,
    ]);
  });
});

describe("parseInternalOrdersQuery() — limit fuera de rango (R12)", () => {
  it("limit=0 y limit=501 responden 400 en modo pull, igual que hoy", () => {
    expect(parseInternalOrdersQuery(params("limit=0")).ok).toBe(false);
    expect(parseInternalOrdersQuery(params("limit=501")).ok).toBe(false);
  });

  it("limit=0 y limit=501 responden 400 en modo status también (R12: mismo rango)", () => {
    expect(parseInternalOrdersQuery(params("status=PULLED&limit=0")).ok).toBe(false);
    expect(parseInternalOrdersQuery(params("status=PULLED&limit=501")).ok).toBe(false);
  });
});

describe("parseInternalOrdersQuery() — after fuera de rango (DA3)", () => {
  it("after negativo o no numérico responde 400 path:['after']", () => {
    for (const value of ["-1", "x"]) {
      const result = parseInternalOrdersQuery(params(`status=PULLED&after=${value}`));
      expect(result.ok, value).toBe(false);
      if (result.ok) continue;
      expect(result.issues).toEqual([{ path: ["after"], message: expect.any(String) }]);
    }
  });
});
