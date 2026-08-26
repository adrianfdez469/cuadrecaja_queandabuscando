#!/usr/bin/env node
/**
 * Mint a one-time admin SSO token, the way cuadrecaja's "Ir a mi tienda online"
 * button will. Prints the URL to open.
 *
 *   node scripts/mint-sso-token.mjs                        # both seed stores, 60s
 *   node scripts/mint-sso-token.mjs --expired               # already expired
 *   node scripts/mint-sso-token.mjs --stores=seed-tienda-1  # only the first — the
 *                                                            # other becomes "ajena"
 */
import "dotenv/config";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const BASE = process.env.QAB_BASE_URL ?? "http://localhost:3000";
const expired = process.argv.includes("--expired");

const storesArg = process.argv.find((arg) => arg.startsWith("--stores="));
// externalId's, as cuadrecaja sends them — /admin/sso maps them to internal ids.
const storeIds = storesArg
  ? storesArg.slice("--stores=".length).split(",").filter(Boolean)
  : ["seed-tienda-1", "seed-tienda-2"];

const secret = process.env.SSO_JWT_SECRET;
if (!secret || secret.length < 32) {
  console.error("SSO_JWT_SECRET must be set and at least 32 characters. See .env.example.");
  process.exit(1);
}

const token = await new SignJWT({
  jti: randomUUID(),
  sub: "seed-usuario-1",
  name: "Ana Pérez",
  email: "ana@example.com",
  businessId: "seed-negocio-1",
  storeIds,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime(expired ? "-120s" : "60s")
  .sign(new TextEncoder().encode(secret));

console.log(`${BASE}/admin/sso?token=${token}`);
