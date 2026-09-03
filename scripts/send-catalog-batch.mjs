#!/usr/bin/env node
/**
 * Send a catalog batch to the local sync endpoint, the way cuadrecaja's cron
 * will. Used to verify the contract without the other system existing yet.
 *
 *   node scripts/send-catalog-batch.mjs                  # a normal batch
 *   node scripts/send-catalog-batch.mjs --repeat         # same ids, tests idempotency
 *   node scripts/send-catalog-batch.mjs --bad-token      # expect 401
 *   node scripts/send-catalog-batch.mjs --unknown-store  # expect skipped_not_published
 *   node scripts/send-catalog-batch.mjs --stale          # expect stale
 *   node scripts/send-catalog-batch.mjs --singular-barcode  # F-024: expect 400 INVALID_BATCH
 *   node scripts/send-catalog-batch.mjs --token=<token>  # F-018: seed-negocio-1's own token
 *   node scripts/send-catalog-batch.mjs --store-config             # F-032: all five, criterion 2
 *   node scripts/send-catalog-batch.mjs --store-config=partial     # F-032: E3
 *   node scripts/send-catalog-batch.mjs --store-config=<caso>      # F-032: see scripts/store-event.mjs
 *   node scripts/send-catalog-batch.mjs --stale --store-config     # F-032: E9, criterion 6
 *
 * F-018: the token is per business — `QAB_BEARER_TOKEN` (or `--token=`) has to
 * be the token of `businessId` below (`seed-negocio-1`), minted with
 * `npm run mint:token -- seed-negocio-1`, or the server answers 403
 * BUSINESS_MISMATCH instead of the cases this script means to exercise.
 *
 * F-034: `QAB_BUSINESS_ID` overrides `businessId` (default unchanged:
 * `seed-negocio-1`), so this script's own `argv` can stay literal while it
 * targets a business provisioned by `POST /api/provisioning/credential`
 * instead of the seed — see spec.md I8, "cómo se ejecuta el criterio 2".
 *
 * F-024: the `PRODUCT` payload sends `barcodes` (a list), never `barcode` —
 * v4 rejects the singular key outright. `--singular-barcode` deliberately
 * sends the old shape to demonstrate the whole-batch 400 (E10).
 *
 * F-032 (R20, architecture.md § DA5): every run also sends a STORE event —
 * `none` (no `--store-config` at all, E14) unless told otherwise — EXCEPT
 * with `--unknown-store`, which would create a junk store and break the
 * `skipped_not_published` case F-005 already verifies. The STORE payload's
 * contact fields and the thirteen `--store-config` presets live in
 * scripts/store-event.mjs, shared with send-store-batch.mjs (R21).
 */
import "dotenv/config";
import { buildStoreEvent } from "./store-event.mjs";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const args = new Set(process.argv.slice(2));

const explicitToken = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--token="))
  ?.split("=")[1];

const token = args.has("--bad-token")
  ? "wrong-token-value-that-is-long-enough"
  : (explicitToken ?? process.env.QAB_BEARER_TOKEN);

const businessId = process.env.QAB_BUSINESS_ID ?? "seed-negocio-1";
const storeId = args.has("--unknown-store") ? "no-such-store" : "seed-tienda-1";

// A fixed id when repeating, so the second delivery is recognised as duplicate.
const suffix = args.has("--repeat") ? "fixed" : Date.now().toString(36);

// The stale case deliberately carries a timestamp older than what is stored.
const updatedAt = args.has("--stale") ? "2000-01-01T00:00:00.000Z" : new Date().toISOString();

// F-032: `--store-config` alone means `all`; `--store-config=<caso>` picks
// one of the thirteen presets in scripts/store-event.mjs; no flag at all
// means `none` — a STORE event with the v6 shape (E14).
const explicitStoreConfigCase = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--store-config="))
  ?.split("=")[1];
const storeConfigCase = explicitStoreConfigCase ?? (args.has("--store-config") ? "all" : "none");

const productPayload = {
  storeProductId: "seed-tienda-1-p0",
  productId: "seed-producto-0",
  businessId,
  storeId,
  localName: "Refresco de cola 1.5 L",
  // F-024 v4: `barcodes` is the list; `--singular-barcode` sends the
  // removed v3 key instead, to demonstrate the whole-batch 400 (E10).
  ...(args.has("--singular-barcode")
    ? { barcode: "7501031311309" }
    : { barcodes: ["7501031311309"] }),
  localCategoryId: "seed-cat-bebidas",
  price: 499,
  currency: "CUP",
  canonicalProductId: null,
  imageUrl: null,
  publishToStore: true,
  updatedAt,
};

// F-032 (R20/R21): --unknown-store never gets a STORE event — creating one
// for a storeId nobody owns would break the skipped_not_published case
// F-005 already verifies.
const storeEvent = args.has("--unknown-store")
  ? null
  : buildStoreEvent(`evt-store-${suffix}`, { businessId, updatedAt, configCase: storeConfigCase });

const body = {
  businessId,
  events: [
    {
      eventId: `evt-product-${suffix}`,
      entity: "PRODUCT",
      operation: "UPDATE",
      occurredAt: new Date().toISOString(),
      payload: productPayload,
    },
    ...(storeEvent ? [storeEvent] : []),
  ],
};

const response = await fetch(`${BASE}/api/internal/sync/catalog`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

console.log("HTTP", response.status);
console.log(JSON.stringify(await response.json(), null, 2));
