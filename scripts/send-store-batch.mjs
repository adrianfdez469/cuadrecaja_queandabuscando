#!/usr/bin/env node
/**
 * Send a STORE sync event to the local sync endpoint, the way cuadrecaja's
 * cron will. Used to verify AP5(b)/AP6 (features/sync/server/handlers/store.ts)
 * without the other system existing yet — mirrors send-catalog-batch.mjs.
 *
 *   node scripts/send-store-batch.mjs                 # routine edit: same
 *                                                       publishToStore, phone
 *                                                       changes, fresh updatedAt
 *                                                       (AP5(b): must NOT touch
 *                                                       status/disabled*)
 *   node scripts/send-store-batch.mjs --unpublish      # real opt-in flip to
 *                                                       false, fresh updatedAt
 *   node scripts/send-store-batch.mjs --republish       # real opt-in flip to
 *                                                       true, fresh updatedAt
 *   node scripts/send-store-batch.mjs --stale-unpublish # opt-in flip to false
 *                                                       but with a STALE
 *                                                       updatedAt (AP6: must be
 *                                                       rejected, never applied)
 *   node scripts/send-store-batch.mjs --store=seed-tienda-2  # target another
 *                                                       seed store (default:
 *                                                       seed-tienda-1)
 *   node scripts/send-store-batch.mjs --token=<token>  # F-018: seed-negocio-1's own token
 *
 * F-018: `QAB_BEARER_TOKEN` (or `--token=`) has to be seed-negocio-1's own
 * token — minted with `npm run mint:token -- seed-negocio-1` — or the
 * server answers 403 BUSINESS_MISMATCH.
 */
import "dotenv/config";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const args = new Set(process.argv.slice(2));
const token =
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--token="))
    ?.split("=")[1] ?? process.env.QAB_BEARER_TOKEN;

const storeArg = process.argv.find((arg) => arg.startsWith("--store="));
const storeId = storeArg ? storeArg.slice("--store=".length) : "seed-tienda-1";

const publishToStore = args.has("--unpublish") || args.has("--stale-unpublish") ? false : true;

const updatedAt = args.has("--stale-unpublish")
  ? "2000-01-01T00:00:00.000Z"
  : new Date().toISOString();

const suffix = Date.now().toString(36);

const body = {
  businessId: "seed-negocio-1",
  events: [
    {
      eventId: `evt-store-${suffix}`,
      entity: "STORE",
      operation: "UPDATE",
      occurredAt: new Date().toISOString(),
      payload: {
        storeId,
        businessId: "seed-negocio-1",
        businessName: "Distribuidora La Rampa",
        name: "La Rampa · Vedado",
        // The one field a "routine" POS edit changes — proves AP5(b) is
        // about the opt-in flag, not "did anything change at all".
        phone: `+53555${suffix.slice(-4)}`,
        baseCurrency: "CUP",
        publishToStore,
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
