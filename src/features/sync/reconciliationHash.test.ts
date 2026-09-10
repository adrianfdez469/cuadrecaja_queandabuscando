import { describe, expect, it } from "vitest";
import type { TariffRow } from "@/features/zones/precedence";
import {
  byteOrderedEntries,
  md5OfEntries,
  tariffEntry,
  tariffReconciliation,
} from "./reconciliationHash";
import { createHash } from "node:crypto";
import { extractPublishedSha256, extractVectorBlock, readContract } from "./contractVector";

const EMPTY_HASH = "d41d8cd98f00b204e9800998ecf8427e";

describe("tariffEntry (R4, R6, R7)", () => {
  it("R4: serializes exactly <zoneCode>:<rule>:<importe>|, nothing more", () => {
    expect(tariffEntry({ zoneCode: "21.05", rule: "FEE", deliveryFee: "300.00" })).toBe(
      "21.05:FEE:300|",
    );
  });

  it('R5: strips trailing zeroes idempotently, with the dot guard ("1000" stays "1000")', () => {
    expect(tariffEntry({ zoneCode: "21", rule: "FEE", deliveryFee: "1000" })).toBe("21:FEE:1000|");
    expect(tariffEntry({ zoneCode: "21", rule: "FEE", deliveryFee: "1000.00" })).toBe(
      "21:FEE:1000|",
    );
    expect(tariffEntry({ zoneCode: "21", rule: "FEE", deliveryFee: "250.50" })).toBe(
      "21:FEE:250.5|",
    );
    expect(tariffEntry({ zoneCode: "21", rule: "FEE", deliveryFee: "0.00" })).toBe("21:FEE:0|");
  });

  it("R6: the amount hole is the empty string, on rule !== FEE, coalesced explicitly", () => {
    expect(tariffEntry({ zoneCode: "21.05", rule: "NOT_SERVED", deliveryFee: null })).toBe(
      "21.05:NOT_SERVED:|",
    );
    expect(tariffEntry({ zoneCode: "21.05", rule: "NOT_SERVED" })).toBe("21.05:NOT_SERVED:|");
  });

  it("R6 caso límite 3: a FEE row with no amount (schema-unreachable) enters with the empty hole too, never crashes", () => {
    expect(tariffEntry({ zoneCode: "21.05", rule: "FEE", deliveryFee: null })).toBe("21.05:FEE:|");
    expect(tariffEntry({ zoneCode: "21.05", rule: "FEE" })).toBe("21.05:FEE:|");
  });

  it("R7: rule travels verbatim, never abbreviated or mapped", () => {
    expect(tariffEntry({ zoneCode: "21", rule: "FEE", deliveryFee: "0" })).toContain(":FEE:");
    expect(tariffEntry({ zoneCode: "21", rule: "NOT_SERVED" })).toContain(":NOT_SERVED:");
  });

  it("caso límite 4: envío gratis (FEE 0) and NOT_SERVED are distinct entries", () => {
    const free = tariffEntry({ zoneCode: "21", rule: "FEE", deliveryFee: "0.00" });
    const notServed = tariffEntry({ zoneCode: "21", rule: "NOT_SERVED" });
    expect(free).not.toBe(notServed);
  });
});

describe("tariffReconciliation (R3, R8, R9, R10)", () => {
  it("R3: INHERIT rows do not enter tariffs nor tariffHash", () => {
    const rows: TariffRow[] = [
      { zoneCode: "21", rule: "FEE", deliveryFee: "300.00" },
      { zoneCode: "21.05", rule: "INHERIT", deliveryFee: null },
    ];
    const withInherit = tariffReconciliation(rows);
    const withoutInherit = tariffReconciliation([rows[0]!]);
    expect(withInherit).toEqual(withoutInherit);
    expect(withInherit.tariffs).toBe(1);
  });

  it("E10: a store whose only rows are INHERIT gives the same result as zero rows", () => {
    const rows: TariffRow[] = [
      { zoneCode: "21", rule: "INHERIT", deliveryFee: null },
      { zoneCode: "21.05", rule: "INHERIT", deliveryFee: null },
    ];
    expect(tariffReconciliation(rows)).toEqual({
      tariffs: 0,
      entries: [],
      tariffHash: EMPTY_HASH,
    });
  });

  it("R9: zero rows gives tariffs: 0 and the md5 of the empty string, no special case", () => {
    expect(tariffReconciliation([])).toEqual({ tariffs: 0, entries: [], tariffHash: EMPTY_HASH });
  });

  it("R8: order is by BYTES of zoneCode, never insertion order (E4)", () => {
    const ascending: TariffRow[] = [
      { zoneCode: "21", rule: "FEE", deliveryFee: "100" },
      { zoneCode: "21.05", rule: "FEE", deliveryFee: "200" },
      { zoneCode: "23.01", rule: "FEE", deliveryFee: "300" },
    ];
    const reversed = [...ascending].reverse();
    expect(tariffReconciliation(reversed)).toEqual(tariffReconciliation(ascending));
    expect(tariffReconciliation(ascending).entries).toEqual([
      "21:FEE:100|",
      "21.05:FEE:200|",
      "23.01:FEE:300|",
    ]);
  });

  it("R10: tariffHash is md5 in lowercase hex, 32 characters", () => {
    const { tariffHash } = tariffReconciliation([
      { zoneCode: "21", rule: "FEE", deliveryFee: "100" },
    ]);
    expect(tariffHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("E3: two different sets of rows give different tariffHash", () => {
    const a = tariffReconciliation([{ zoneCode: "21", rule: "FEE", deliveryFee: "100" }]);
    const b = tariffReconciliation([{ zoneCode: "21", rule: "FEE", deliveryFee: "200" }]);
    expect(a.tariffHash).not.toBe(b.tariffHash);
  });

  it("E8: NOT_SERVED over FEE changes tariffHash without changing the count", () => {
    const fee = tariffReconciliation([{ zoneCode: "21", rule: "FEE", deliveryFee: "100" }]);
    const notServed = tariffReconciliation([{ zoneCode: "21", rule: "NOT_SERVED" }]);
    expect(fee.tariffs).toBe(notServed.tariffs);
    expect(fee.tariffHash).not.toBe(notServed.tariffHash);
  });
});

describe("byteOrderedEntries / md5OfEntries — the shared skeleton (R14)", () => {
  it("golden: the four literal rows the contract's products vector already publishes still give the same hash after the D1 extraction", () => {
    // docs/sync-contract.md § ⑤, "Vector de prueba, para autoverificarse sin
    // nuestra base": id in {a,b,c,d}, CUP, AVAILABLE, prices 1990.00 /
    // 1990.50 / 1990.10 / 0.00 — hash = 62e399684e3a8eafadaae58391537955.
    // This is NOT a call through `reconciliationEntry` (that function is
    // untouched and its own guardian is reconciliation.db.test.ts, which
    // this feature does not touch); it is the literal shape
    // `<externalId>:<price>:<currency>:<availability>|` fed through the
    // EXTRACTED skeleton, to prove the extraction preserves the bytes.
    type Row = { id: string; price: string; currency: string; availability: string };
    const rows: Row[] = [
      { id: "a", price: "1990.00", currency: "CUP", availability: "AVAILABLE" },
      { id: "b", price: "1990.50", currency: "CUP", availability: "AVAILABLE" },
      { id: "c", price: "1990.10", currency: "CUP", availability: "AVAILABLE" },
      { id: "d", price: "0.00", currency: "CUP", availability: "AVAILABLE" },
    ];
    const entryOf = (row: Row) => {
      const price = row.price.includes(".")
        ? row.price.replace(/0+$/, "").replace(/\.$/, "")
        : row.price;
      return `${row.id}:${price}:${row.currency}:${row.availability}|`;
    };
    const entries = byteOrderedEntries(rows, (row) => row.id, entryOf);
    expect(md5OfEntries(entries)).toBe("62e399684e3a8eafadaae58391537955");
  });

  it("md5OfEntries on zero entries gives the md5 of the empty string", () => {
    expect(md5OfEntries([])).toBe(EMPTY_HASH);
  });
});

/**
 * F-044 (plan.md paso 8; spec.md E15a, E16; architecture.md § D4): the
 * tariff vector lives in docs/sync-contract.md itself, under
 * `#### Vector del hash del tarifario (v13.4)`, and this test reads it FROM
 * THE DOCUMENT — never a transcribed copy — through the same mechanism
 * `src/features/zones/precedence.test.ts` already uses (recorte de sección,
 * captura del único bloque json, recálculo del sha256).
 */
type TariffVectorRow = { zoneCode: string; rule: TariffRow["rule"]; deliveryFee: string | null };
type TariffVectorCase = {
  id: string;
  rows: TariffVectorRow[];
  expected: { tariffs: number; entries: string[]; tariffHash: string };
};
type TariffVector = { version: string; cases: TariffVectorCase[] };

const HEADING = "#### Vector del hash del tarifario (v13.4)";
const HASH_LABEL_RE =
  /\*\*sha256 del bloque JSON del vector del tarifario \(v13\.4\):\*\*\s*\n`([0-9a-f]{64})`/;

const contract = readContract();
const { rawBlock, parsed } = extractVectorBlock<TariffVector>(contract, HEADING);
const publishedHash = extractPublishedSha256(contract, HASH_LABEL_RE, HEADING);

let executed = 0;

describe("tariff hash vector, read from docs/sync-contract.md itself (E15a, E16, R12, R13)", () => {
  it("declares exactly two cases", () => {
    expect(parsed.cases.length).toBe(2);
  });

  it.each(parsed.cases.map((c) => [c.id, c] as const))(
    "%s: tariffReconciliation() matches the contract's own published entries, tariffs and tariffHash",
    (_id, testCase) => {
      executed += 1;
      const actual = tariffReconciliation(testCase.rows);
      expect(actual.entries).toEqual(testCase.expected.entries);
      expect(actual.tariffs).toBe(testCase.expected.tariffs);
      expect(actual.tariffHash).toBe(testCase.expected.tariffHash);
    },
  );

  it("ran exactly as many cases as the document declares", () => {
    expect(executed).toBe(parsed.cases.length);
  });

  it("E16: the contract's published sha256 matches this block's actual bytes", () => {
    const actualHash = createHash("sha256").update(rawBlock, "utf8").digest("hex");
    expect(actualHash).toBe(publishedHash);
  });
});
