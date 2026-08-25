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
 */
import "dotenv/config";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const args = new Set(process.argv.slice(2));

const token = args.has("--bad-token")
  ? "wrong-token-value-that-is-long-enough"
  : process.env.SYNC_TOKEN;

const businessId = "seed-negocio-1";
const storeId = args.has("--unknown-store") ? "no-such-store" : "seed-tienda-1";

// A fixed id when repeating, so the second delivery is recognised as duplicate.
const suffix = args.has("--repeat") ? "fixed" : Date.now().toString(36);

// The stale case deliberately carries a timestamp older than what is stored.
const updatedAt = args.has("--stale") ? "2000-01-01T00:00:00.000Z" : new Date().toISOString();

const body = {
  businessId,
  events: [
    {
      eventId: `evt-product-${suffix}`,
      entity: "PRODUCT",
      operation: "UPDATE",
      occurredAt: new Date().toISOString(),
      payload: {
        storeProductId: "seed-tienda-1-p0",
        productId: "seed-producto-0",
        businessId,
        storeId,
        localName: "Refresco de cola 1.5 L",
        barcode: "7501031311309",
        localCategoryId: "seed-cat-bebidas",
        price: 499,
        currency: "CUP",
        canonicalProductId: null,
        imageUrl: null,
        publishToStore: true,
        updatedAt,
      },
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
