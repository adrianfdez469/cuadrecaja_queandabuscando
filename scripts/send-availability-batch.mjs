#!/usr/bin/env node
/**
 * Send an availability batch, the way cuadrecaja's convergent query will.
 *
 *   node scripts/send-availability-batch.mjs [AVAILABLE|LOW_STOCK|OUT_OF_STOCK] [--token=<token>]
 *
 * F-018: `QAB_BEARER_TOKEN` (or `--token=`) has to be seed-negocio-1's own
 * token — minted with `npm run mint:token -- seed-negocio-1` — or the
 * server answers 403 BUSINESS_MISMATCH instead of applying the batch.
 */
import "dotenv/config";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const availability = positional[0] ?? "LOW_STOCK";
const token =
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--token="))
    ?.split("=")[1] ?? process.env.QAB_BEARER_TOKEN;

const response = await fetch(`${BASE}/api/internal/sync/availability`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    businessId: "seed-negocio-1",
    items: [
      { storeProductId: "seed-tienda-1-p0", storeId: "seed-tienda-1", availability },
      { storeProductId: "seed-tienda-1-p1", storeId: "seed-tienda-1", availability },
    ],
  }),
});

console.log("HTTP", response.status);
console.log(JSON.stringify(await response.json(), null, 2));
