#!/usr/bin/env node
/**
 * Generate the three server secrets `src/lib/env.ts` requires and
 * `.env.example` deliberately no longer assigns: SSO_JWT_SECRET,
 * ADMIN_SESSION_SECRET and CRON_SECRET. A `.env` copied from `.env.example`
 * used to bring them as `=""`, which made `serverEnv()` throw the first time
 * anything called it — and that throw was swallowed by every
 * `try { … } catch { return null; }` between it and the caller (F-029).
 *
 * ONLY node:crypto and node:fs — no dependency on node_modules at all. This
 * has to run from `.agent/init.sh` in a fresh clone, before `npm ci`, without
 * the check itself turning into an import error.
 *
 * Four modes:
 *
 *   node scripts/dev-secrets.mjs             # print the three lines, write nothing
 *   node scripts/dev-secrets.mjs --write      # write to .env, keeping what already
 *                                             # meets the minimum
 *   node scripts/dev-secrets.mjs --write --force
 *                                             # write to .env, regenerating everything
 *   node scripts/dev-secrets.mjs --check      # exit 0 if the three are usable, else
 *                                             # exit 1 and print one missing/short name
 *                                             # per line. Writes nothing. Tolerates a
 *                                             # missing .env (equivalent to all three
 *                                             # absent).
 *
 * Exit codes: 0 on success (print / write / check-passed), 1 when --write is
 * given without a .env (copy .env.example first) or when --check finds a
 * problem, 2 when --force is given without --write (it has no meaning alone).
 *
 * The stdout contract of --check — one bare name per line, in the order below
 * — is read by three other places: `.agent/init.sh`, `.agent/specs/F-029/smoke.sh`
 * and `.agent/specs/F-012/smoke.sh`. Changing it breaks all three.
 *
 * SSO_JWT_SECRET must match cuadrecaja's own SSO_JWT_SECRET exactly
 * (docs/despliegue.md), so unlike the other two it is NOT something this app
 * is free to invent — --write keeps it (and any key already meeting its
 * minimum) by default, and only --force overwrites it. Deliberately not
 * unified with scripts/storage-dev-keys.mjs: that one always rewrites all
 * three of its keys (they must be signed with the same freshly-made secret)
 * and needs the emulators recreated afterwards; this one does not.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Mirrors src/lib/env.ts:10-12. A drift case in src/lib/env.test.ts pins these
// three numbers so raising one in the schema turns that test red instead of
// leaving this generator producing values the schema rejects.
const SECRETS = [
  { name: "SSO_JWT_SECRET", min: 32 },
  { name: "ADMIN_SESSION_SECRET", min: 32 },
  { name: "CRON_SECRET", min: 16 },
];

const ENV_PATH = ".env";
const ENV_EXAMPLE_PATH = ".env.example";

function randomValue() {
  // 48 bytes of entropy, base64url-encoded: 64 characters, comfortably above
  // the largest minimum (32) and free of characters that would force quoting.
  return randomBytes(48).toString("base64url");
}

function readEnv() {
  if (!existsSync(ENV_PATH)) return null;
  return readFileSync(ENV_PATH, "utf8");
}

/** Same extraction rule as `.agent/init.sh:48`: strip surrounding quotes and whitespace. */
function currentValue(env, name) {
  const match = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) return undefined;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function usable(name, min, env) {
  if (env === null) return false;
  const value = currentValue(env, name);
  return typeof value === "string" && value.length >= min;
}

function writeInPlace(env, name, line) {
  const existing = new RegExp(`^${name}=.*$`, "m");
  return existing.test(env) ? env.replace(existing, line) : `${env.replace(/\n*$/, "\n")}${line}\n`;
}

function printWarnings(written) {
  if (written.has("SSO_JWT_SECRET")) {
    console.log(
      "SSO_JWT_SECRET: a random value works locally but BREAKS the real SSO against " +
        "cuadrecaja, which requires the exact same value on both sides (docs/despliegue.md).",
    );
  }
  if (written.has("ADMIN_SESSION_SECRET")) {
    console.log("ADMIN_SESSION_SECRET: regenerating it invalidates any open admin sessions.");
  }
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const force = args.includes("--force");
const check = args.includes("--check");

if (force && !write) {
  console.error("--force only makes sense together with --write.");
  process.exit(2);
}

if (check) {
  const env = readEnv();
  const missing = SECRETS.filter((s) => !usable(s.name, s.min, env)).map((s) => s.name);
  for (const name of missing) console.log(name);
  process.exit(missing.length === 0 ? 0 : 1);
}

if (!write) {
  console.log(SECRETS.map((s) => `${s.name}="${randomValue()}"`).join("\n"));
  process.exit(0);
}

let env = readEnv();
if (env === null) {
  console.error(`No ${ENV_PATH} here. Copy ${ENV_EXAMPLE_PATH} first, then run this again.`);
  process.exit(1);
}

let wrote = 0;
let kept = 0;
const written = new Set();
for (const { name, min } of SECRETS) {
  if (!force && usable(name, min, env)) {
    kept += 1;
    continue;
  }
  const line = `${name}="${randomValue()}"`;
  env = writeInPlace(env, name, line);
  written.add(name);
  wrote += 1;
}
writeFileSync(ENV_PATH, env);

console.log(`Wrote ${wrote} secret(s), kept ${kept} already meeting the minimum.`);
printWarnings(written);
