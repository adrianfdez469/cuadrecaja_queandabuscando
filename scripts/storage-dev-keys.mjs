#!/usr/bin/env node
/**
 * Mint the local Storage emulator's dev credentials.
 *
 * The emulator (docker-compose.yml) speaks the real Supabase Storage API, so it
 * needs a JWT secret and two tokens signed with it. Those used to be hardcoded
 * in `.env.example` and `docker-compose.yml` using Supabase's public demo keys.
 * They were never real credentials, but committing key-shaped material teaches
 * the next person to paste the real thing in the same slot, and every secret
 * scanner flags it forever.
 *
 * So they are generated instead: unique per machine, living only in `.env`,
 * which is gitignored. `docker compose` reads that same file, so the app and the
 * emulator agree without either value existing in the repository.
 *
 *   node scripts/storage-dev-keys.mjs          # print the four lines
 *   node scripts/storage-dev-keys.mjs --write  # append/replace them in .env
 *
 * After changing them, the emulators must be recreated so they read the new
 * secret: `docker compose up -d --force-recreate storage supabase-gateway auth realtime`.
 * The Auth emulator (F-028) reads this SAME secret (R2) — forgetting to
 * recreate it too leaves it rejecting everything with an opaque 401, same as
 * Storage would. F-020's Realtime emulator reads it too, under a different
 * name (`SUPABASE_JWT_SECRET`, architecture.md DA5) — same value, four lines
 * instead of three.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SignJWT } from "jose";

// storage-api rejects a shorter secret outright.
const SECRET_BYTES = 48;
const YEARS = 10;

const VARS = [
  "STORAGE_JWT_SECRET",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  // F-020, architecture.md DA5: SAME value as STORAGE_JWT_SECRET, under the
  // name Realtime's own config (and src/lib/env.ts) expects. Not the same
  // variable reused under two names — this is a separate line so each can be
  // rotated independently in production, where they are NOT the same secret.
  "SUPABASE_JWT_SECRET",
];

async function sign(role, secret) {
  return new SignJWT({ role, iss: "queandabuscando-local" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${YEARS * 365}d`)
    .sign(new TextEncoder().encode(secret));
}

const secret = randomBytes(SECRET_BYTES).toString("base64url");
const lines = [
  `STORAGE_JWT_SECRET="${secret}"`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY="${await sign("anon", secret)}"`,
  `SUPABASE_SERVICE_ROLE_KEY="${await sign("service_role", secret)}"`,
  `SUPABASE_JWT_SECRET="${secret}"`,
];

if (!process.argv.includes("--write")) {
  console.log(lines.join("\n"));
  process.exit(0);
}

if (!existsSync(".env")) {
  console.error("No .env here. Copy .env.example first, then run this again.");
  process.exit(1);
}

// Replace in place when the key already exists, so the rest of .env is untouched
// and the file never grows a second definition of the same variable.
let env = readFileSync(".env", "utf8");
for (const [i, name] of VARS.entries()) {
  const line = lines[i];
  const existing = new RegExp(`^${name}=.*$`, "m");
  env = existing.test(env) ? env.replace(existing, line) : `${env.replace(/\n*$/, "\n")}${line}\n`;
}
writeFileSync(".env", env);

console.log(`Wrote ${VARS.length} local Storage keys to .env.`);
console.log("Now recreate the emulators so they read the new secret (Storage, Auth AND Realtime):");
console.log("  docker compose up -d --force-recreate storage supabase-gateway auth realtime");
