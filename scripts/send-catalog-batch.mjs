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
 *
 * F-018: the token is per business — `QAB_BEARER_TOKEN` (or `--token=`) has to
 * be the token of `businessId` below (`seed-negocio-1`), minted with
 * `npm run mint:token -- seed-negocio-1`, or the server answers 403
 * BUSINESS_MISMATCH instead of the cases this script means to exercise.
 *
 * F-024: the `PRODUCT` payload sends `barcodes` (a list), never `barcode` —
 * v4 rejects the singular key outright. `--singular-barcode` deliberately
 * sends the old shape to demonstrate the whole-batch 400 (E10).
 */
import "dotenv/config";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const args = new Set(process.argv.slice(2));

const explicitToken = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--token="))
  ?.split("=")[1];

const token = args.has("--bad-token")
  ? "wrong-token-value-that-is-long-enough"
  : (explicitToken ?? process.env.QAB_BEARER_TOKEN);

const businessId = "seed-negocio-1";
const storeId = args.has("--unknown-store") ? "no-such-store" : "seed-tienda-1";

// A fixed id when repeating, so the second delivery is recognised as duplicate.
const suffix = args.has("--repeat") ? "fixed" : Date.now().toString(36);

// The stale case deliberately carries a timestamp older than what is stored.
const updatedAt = args.has("--stale") ? "2000-01-01T00:00:00.000Z" : new Date().toISOString();

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
  ],
};

const response = await fetch(`${BASE}/api/internal/sync/catalog`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

console.log("HTTP", response.status);
console.log(JSON.stringify(await response.json(), null, 2));
