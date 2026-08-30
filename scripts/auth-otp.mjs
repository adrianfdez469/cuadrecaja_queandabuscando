#!/usr/bin/env node
/**
 * Run the whole email-OTP cycle against the local Auth emulator (F-028),
 * with no human in the loop: request the 6-digit code, read it from the
 * captured inbox (Mailpit), redeem it, print the resulting `user.id`.
 *
 * No `pg`, no Prisma, no `@supabase/*` — plain `fetch` and `node:*` only
 * (architecture.md § El guion). Two modes:
 *
 *   --mode gotrue (default)  talks to Supabase Auth directly
 *                            (`POST /auth/v1/otp`, `POST /auth/v1/verify`) —
 *                            what criterio 2 exercises.
 *   --mode app                talks to F-012's OWN routes
 *                            (`POST /api/account/otp`,
 *                            `POST /api/account/otp/verify`) — what
 *                            criterio 3 exercises. `--cookie-jar <f>` writes
 *                            the session cookie there as a `Cookie:` header
 *                            value, ready for `curl -H "Cookie: $(cat <f>)"`.
 *
 * Usage:
 *   node scripts/auth-otp.mjs [--email <addr>] [--mode gotrue|app]
 *     [--app <url>] [--cookie-jar <file>] [--timeout <seconds>]
 *     [--mailpit <url>] [--json] [--quiet]
 *
 * Exit codes — one per cause, so the next person does not have to guess
 * (architecture.md § El guion, tabla; this is the mitigation the whole
 * feature exists for, riesgo 1):
 *   0  cycle completed
 *   1  missing configuration (.env)
 *   2  the emulator (Auth or Mailpit) is unreachable
 *   3  the email never arrived
 *   4  it arrived, but the BODY has no 6-digit code (template not loaded)
 *   5  the redemption call itself failed (GoTrue's or the app's own error)
 *   6  more than one message arrived for this recipient (R10)
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const EXIT = {
  OK: 0,
  CONFIG: 1,
  UNREACHABLE: 2,
  NO_EMAIL: 3,
  NO_CODE: 4,
  EXCHANGE_FAILED: 5,
  DUPLICATE: 6,
};

const HEALTH_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 250;

function parseArgs(argv) {
  const opts = { mode: "gotrue", timeout: 15, json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--email":
        opts.email = argv[++i];
        break;
      case "--mode":
        opts.mode = argv[++i];
        break;
      case "--app":
        opts.app = argv[++i];
        break;
      case "--cookie-jar":
        opts.cookieJar = argv[++i];
        break;
      case "--timeout":
        opts.timeout = Number(argv[++i]);
        break;
      case "--mailpit":
        opts.mailpit = argv[++i];
        break;
      case "--json":
        opts.json = true;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      default:
        console.error(`opción desconocida: ${arg}`);
        process.exit(EXIT.CONFIG);
    }
  }
  if (opts.mode !== "gotrue" && opts.mode !== "app") {
    console.error(`--mode debe ser "gotrue" o "app", recibí "${opts.mode}"`);
    process.exit(EXIT.CONFIG);
  }
  return opts;
}

function log(quiet, ...lines) {
  if (!quiet) for (const line of lines) console.error(line);
}

function fail(code, ...lines) {
  for (const line of lines) console.error(line);
  process.exit(code);
}

/** `fetch` that never throws — a network error becomes `{ok:false}` like an HTTP one. */
async function tryFetch(url, init, timeoutMs) {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await fetch(url, { ...init, signal: controller?.signal });
    return response;
  } catch (error) {
    return { ok: false, status: 0, networkError: error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractSixDigitCode(text) {
  const match = /\b(\d{6})\b/.exec(text ?? "");
  return match ? match[1] : null;
}

/** Netscape jar files bite (curl treats a filename arg as one); a raw `Cookie:` value does not. */
function toCookieHeaderValue(setCookieHeaders) {
  return setCookieHeaders.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function waitForMessages(mailpitUrl, email, timeoutSeconds, quiet) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const query = encodeURIComponent(`to:${email}`);
  log(quiet, `> esperando el correo de ${email} en ${mailpitUrl} (hasta ${timeoutSeconds}s)`);
  while (Date.now() < deadline) {
    const response = await tryFetch(`${mailpitUrl}/api/v1/search?query=${query}`);
    if (response.ok) {
      const body = await response.json();
      if (body.messages?.length > 0) return body.messages;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const email = opts.email ?? `prueba+${Date.now()}@local.test`;
  const appUrl = opts.app ?? "http://localhost:3000";
  const mailpitUrl = opts.mailpit ?? process.env.MAILPIT_URL ?? "http://localhost:54324";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    fail(
      EXIT.CONFIG,
      `Falta en .env: ${missing.join(", ")}`,
      "Ejecuta: node scripts/storage-dev-keys.mjs --write",
    );
  }

  // --- Reachability (código 2) — comprobado ANTES de pedir nada, para no
  // confundir "el emulador no responde" con "el correo no llega" (E2 de la
  // tabla de estados de error de spec.md).
  const health = await tryFetch(`${supabaseUrl}/auth/v1/health`, undefined, HEALTH_TIMEOUT_MS);
  if (!health.ok) {
    fail(
      EXIT.UNREACHABLE,
      `El emulador de Auth no responde en ${supabaseUrl}/auth/v1/health`,
      "Ejecuta: docker compose up -d",
    );
  }
  const mailpitHealth = await tryFetch(`${mailpitUrl}/readyz`, undefined, HEALTH_TIMEOUT_MS);
  if (!mailpitHealth.ok) {
    fail(
      EXIT.UNREACHABLE,
      `Mailpit no responde en ${mailpitUrl}/readyz`,
      "Ejecuta: docker compose up -d",
    );
  }

  // --- R10: bandeja vacía para ESTE destinatario antes de pedir nada.
  await tryFetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, {
    method: "DELETE",
  });

  // --- Pedir el código ---------------------------------------------------
  log(opts.quiet, `> pidiendo el código para ${email} (modo ${opts.mode})`);
  const sendResponse =
    opts.mode === "gotrue"
      ? await tryFetch(`${supabaseUrl}/auth/v1/otp`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: anonKey },
          body: JSON.stringify({ email }),
        })
      : await tryFetch(`${appUrl}/api/account/otp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
  if (!sendResponse.ok) {
    const bodyText = await sendResponse.text?.().catch(() => "");
    fail(
      EXIT.EXCHANGE_FAILED,
      `Pedir el código falló: HTTP ${sendResponse.status}`,
      bodyText || String(sendResponse.networkError ?? ""),
    );
  }

  // --- Leer el correo ------------------------------------------------------
  const messages = await waitForMessages(mailpitUrl, email, opts.timeout, opts.quiet);
  if (messages.length === 0) {
    fail(
      EXIT.NO_EMAIL,
      `El correo no llegó tras ${opts.timeout}s, destinatario ${email}`,
      `Mira la bandeja: ${mailpitUrl}`,
      'Revisa GOTRUE_SMTP_HOST/GOTRUE_SMTP_PORT y que GOTRUE_MAILER_AUTOCONFIRM sea "false" (R9).',
    );
  }
  if (messages.length > 1) {
    fail(
      EXIT.DUPLICATE,
      `Llegaron ${messages.length} mensajes para ${email}, se esperaba exactamente 1.`,
      "Usa --email con una marca de tiempo (R10) para evitar leer un correo de otra corrida.",
    );
  }

  const detailResponse = await tryFetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`);
  const message = await detailResponse.json();
  const bodyCode = extractSixDigitCode(message.Text) ?? extractSixDigitCode(message.HTML);
  const subjectCode = extractSixDigitCode(message.Subject);

  if (!bodyCode) {
    const snippet = (message.Text || message.HTML || "").slice(0, 200);
    if (subjectCode) {
      fail(
        EXIT.NO_CODE,
        `El ASUNTO trae un código (${subjectCode}) pero el CUERPO no.`,
        "La plantilla no se cargó: revisa GOTRUE_MAILER_TEMPLATES_* y que " +
          "http://supabase-gateway/dev-mail/otp.html responda 200 (architecture.md § Riesgos, riesgo 1).",
        `Asunto: ${message.Subject}`,
        `Cuerpo (200 chars): ${snippet}`,
      );
    }
    fail(
      EXIT.NO_CODE,
      "Ni el asunto ni el cuerpo traen un código de 6 dígitos.",
      "Revisa GOTRUE_MAILER_SUBJECTS_* y GOTRUE_MAILER_TEMPLATES_*.",
      `Asunto: ${message.Subject}`,
      `Cuerpo (200 chars): ${snippet}`,
    );
  }

  // --- Canjearlo -----------------------------------------------------------
  log(opts.quiet, `> canjeando el código (modo ${opts.mode})`);
  let userId;
  let profile;
  let cookieHeaderValue;

  if (opts.mode === "gotrue") {
    const verifyResponse = await tryFetch(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email, token: bodyCode, type: "email" }),
    });
    const verifyBody = await verifyResponse.json?.().catch(() => ({}));
    if (!verifyResponse.ok) {
      fail(
        EXIT.EXCHANGE_FAILED,
        `El canje falló: HTTP ${verifyResponse.status}`,
        JSON.stringify(verifyBody ?? {}),
      );
    }
    userId = verifyBody.user?.id;
  } else {
    const verifyResponse = await tryFetch(`${appUrl}/api/account/otp/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, token: bodyCode }),
    });
    const setCookies =
      typeof verifyResponse.headers?.getSetCookie === "function"
        ? verifyResponse.headers.getSetCookie()
        : [];
    const verifyBody = await verifyResponse.json?.().catch(() => ({}));
    if (!verifyResponse.ok) {
      fail(
        EXIT.EXCHANGE_FAILED,
        `El canje falló: HTTP ${verifyResponse.status}`,
        JSON.stringify(verifyBody ?? {}),
      );
    }
    profile = verifyBody.profile;
    cookieHeaderValue = toCookieHeaderValue(setCookies);
    if (opts.cookieJar) writeFileSync(opts.cookieJar, cookieHeaderValue);
  }

  const result = {
    email,
    token: bodyCode,
    mode: opts.mode,
    message_id: messages[0].ID,
    ...(userId ? { user_id: userId } : {}),
    ...(profile ? { profile } : {}),
    ...(cookieHeaderValue ? { cookie: cookieHeaderValue } : {}),
  };

  if (opts.json) {
    console.log(JSON.stringify(result));
  } else {
    for (const [key, value] of Object.entries(result)) {
      console.log(`${key}=${typeof value === "object" ? JSON.stringify(value) : value}`);
    }
  }
  process.exit(EXIT.OK);
}

main();
