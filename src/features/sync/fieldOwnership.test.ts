import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PANEL_PRODUCT_COLUMNS } from "@/constants/admin";
import { Prisma } from "@/generated/prisma/client";

/**
 * Criterio 4 (F-022, architecture.md § La exhaustividad del criterio 4): the
 * 54-row property table of `docs/sync-contract.md` cross-checked against
 * `prisma/schema.prisma` — NOT the generated client, which is a subset that
 * silently drops `StoreProduct.searchVector` (`Unsupported("tsvector")` is
 * not a scalar field: `StoreProductScalarFieldEnum` has 22 keys for 23
 * columns). The generated enums are still used, but only as a "must be a
 * subset of" backstop against a broken regex returning an empty set.
 */

const ROOT = process.cwd();
const SCHEMA_PATH = join(ROOT, "prisma/schema.prisma");
const CONTRACT_PATH = join(ROOT, "docs/sync-contract.md");

/** Every top-level `model X { ... }` name declared in the schema, so a
 *  relation field (`business Business @relation(...)`) can be told apart
 *  from a real column by its type alone. */
function modelNames(schema: string): Set<string> {
  return new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
}

/** The `{ ... }` body of one `model NAME { ... }` block. Prisma model bodies
 *  never nest braces of their own (attribute arguments use parentheses), so
 *  a plain depth counter is exact, not just "good enough". */
function modelBody(schema: string, name: string): string {
  const start = new RegExp(`^model\\s+${name}\\s*\\{`, "m").exec(schema);
  if (!start) throw new Error(`fieldOwnership.test.ts: model ${name} not found in schema.prisma`);
  let depth = 1;
  let i = start.index + start[0].length;
  while (depth > 0) {
    if (schema[i] === "{") depth++;
    else if (schema[i] === "}") depth--;
    i++;
  }
  return schema.slice(start.index + start[0].length, i - 1);
}

/**
 * architecture.md § La exhaustividad del criterio 4, punto 1: a line is a
 * column when it matches `/^(\w+)\s+(\S+)/`, does not start with `//`/`///`,
 * does not start with `@@`, and its type — stripped of `?`/`[]` — is not one
 * of the file's own `model` names (which marks it as a relation, not a
 * column: `slugEntry Slug?`, `products StoreProduct[]`, `business Business`).
 */
function columnsOf(schema: string, models: Set<string>, name: string): string[] {
  const columns: string[] = [];
  for (const rawLine of modelBody(schema, name).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("///") || line.startsWith("//") || line.startsWith("@@")) {
      continue;
    }
    const match = /^(\w+)\s+(\S+)/.exec(line);
    if (!match) continue;
    const [, fieldName, rawType] = match;
    const type = rawType.replace(/\?$/, "").replace(/\[\]$/, "");
    if (models.has(type)) continue; // a relation, not a scalar column
    columns.push(fieldName);
  }
  return columns;
}

type ContractRow = { field: string; owner: string; note: string };

/**
 * architecture.md punto 2: the two property tables under the "Tabla de
 * propiedad de campos" heading, up to the next heading of level 2-5. Cells
 * are `| a | b | c |` rows; the first two lines of each table (header,
 * separator) are skipped, and the field name is the first backtick-quoted
 * identifier of the first cell.
 */
function parseContractTables(contract: string): {
  store: ContractRow[];
  storeProduct: ContractRow[];
} {
  const headingIndex = contract.indexOf("##### Tabla de propiedad de campos");
  if (headingIndex === -1) {
    throw new Error("fieldOwnership.test.ts: property table heading not found in sync-contract.md");
  }
  const rest = contract.slice(headingIndex);
  const nextHeading = /\n#{2,5} /.exec(rest.slice(1));
  const section = nextHeading ? rest.slice(0, nextHeading.index + 1) : rest;

  const tables: string[][] = [];
  let current: string[] = [];
  for (const line of section.split("\n")) {
    if (line.trim().startsWith("|")) {
      current.push(line);
    } else if (current.length) {
      tables.push(current);
      current = [];
    }
  }
  if (current.length) tables.push(current);
  if (tables.length < 2) {
    throw new Error(`fieldOwnership.test.ts: expected 2 property tables, found ${tables.length}`);
  }

  function parseTable(lines: string[]): ContractRow[] {
    return lines.slice(2).map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const backtick = /`([^`]+)`/.exec(cells[0] ?? "");
      return { field: backtick?.[1] ?? "", owner: cells[1] ?? "", note: cells[2] ?? "" };
    });
  }

  return { store: parseTable(tables[0]), storeProduct: parseTable(tables[1]) };
}

const schemaSource = readFileSync(SCHEMA_PATH, "utf8");
const contractSource = readFileSync(CONTRACT_PATH, "utf8");
const models = modelNames(schemaSource);

const schemaStoreColumns = columnsOf(schemaSource, models, "Store");
const schemaStoreProductColumns = columnsOf(schemaSource, models, "StoreProduct");
const contractTables = parseContractTables(contractSource);

/** Set equality in both directions, formatted so a failure names the exact
 *  offending column instead of just "not equal". */
function expectSameFields(schemaColumns: string[], contractRows: ContractRow[], model: string) {
  const schemaSet = new Set(schemaColumns);
  const contractFields = contractRows.map((r) => r.field);
  const contractSet = new Set(contractFields);

  const missingFromContract = schemaColumns.filter((c) => !contractSet.has(c));
  const missingFromSchema = contractFields.filter((f) => !schemaSet.has(f));

  expect(missingFromContract, `${model}: columns not documented in the contract`).toEqual([]);
  expect(missingFromSchema, `${model}: contract rows that name no real column`).toEqual([]);
}

describe("field ownership table (F-022, criterio 4) — docs/sync-contract.md vs. prisma/schema.prisma", () => {
  it("measured counts match the spec: Store 31, StoreProduct 23", () => {
    expect(schemaStoreColumns.length).toBe(31);
    expect(schemaStoreProductColumns.length).toBe(23);
    expect(contractTables.store.length).toBe(31);
    expect(contractTables.storeProduct.length).toBe(23);
  });

  it("Store: every schema column is documented, and no documented row names a column that does not exist", () => {
    expectSameFields(schemaStoreColumns, contractTables.store, "Store");
  });

  it("StoreProduct: every schema column is documented, and no documented row names a column that does not exist", () => {
    expectSameFields(schemaStoreProductColumns, contractTables.storeProduct, "StoreProduct");
  });

  it("R3: no field name appears twice in either table (exactly one owner each)", () => {
    for (const rows of [contractTables.store, contractTables.storeProduct]) {
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.field, (counts.get(row.field) ?? 0) + 1);
      const repeated = [...counts.entries()].filter(([, n]) => n > 1).map(([f]) => f);
      expect(repeated).toEqual([]);
    }
  });

  it("all three cells (field, owner, note) are non-empty in all 54 rows", () => {
    for (const row of [...contractTables.store, ...contractTables.storeProduct]) {
      expect(row.field, "field").not.toBe("");
      expect(row.owner, `owner of ${row.field}`).not.toBe("");
      expect(row.note, `note of ${row.field}`).not.toBe("");
    }
  });

  it("guarda contra falso verde: the schema-parsed set is a SUPERSET of the generated client's own scalar enum", () => {
    // `searchVector` is `Unsupported("tsvector")`, which is why it is
    // absent from `StoreProductScalarFieldEnum` (22 keys, not 23) — if this
    // file's own regex broke and returned an empty set, this assertion
    // would be the one to catch it, since an empty set cannot be a
    // superset of a non-empty one.
    const storeEnumKeys = Object.values(Prisma.StoreScalarFieldEnum);
    const storeProductEnumKeys = Object.values(Prisma.StoreProductScalarFieldEnum);
    const storeSet = new Set(schemaStoreColumns);
    const storeProductSet = new Set(schemaStoreProductColumns);

    for (const key of storeEnumKeys) expect(storeSet.has(key), `Store.${key}`).toBe(true);
    for (const key of storeProductEnumKeys) {
      expect(storeProductSet.has(key), `StoreProduct.${key}`).toBe(true);
    }
    // And the escape hatch itself: searchVector is a REAL column the
    // client's own enum does not know about.
    expect(storeProductSet.has("searchVector")).toBe(true);
    expect(storeProductEnumKeys).not.toContain("searchVector");
  });

  it("simulates tomorrow's new column: an undocumented schema column is caught, not silently ignored", () => {
    const withFakeColumn = [...schemaStoreColumns, "aBrandNewColumnNobodyDocumentedYet"];
    const contractSet = new Set(contractTables.store.map((r) => r.field));
    const missing = withFakeColumn.filter((c) => !contractSet.has(c));
    expect(missing).toEqual(["aBrandNewColumnNobodyDocumentedYet"]);
  });

  it("AC5: PANEL_PRODUCT_COLUMNS is exactly the six StoreProduct fields the contract marks as panel-owned", () => {
    const panelRows = contractTables.storeProduct.filter((row) => row.owner.includes("panel"));
    const panelFieldsInContract = panelRows.map((row) => row.field).sort();
    expect(panelFieldsInContract).toEqual([...PANEL_PRODUCT_COLUMNS].sort());
  });
});
