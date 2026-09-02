#!/usr/bin/env node
/**
 * Verify that what the harness documents matches what its scripts implement.
 *
 * This exists because the harness has one executable source of truth —
 * verify.sh and sdd.sh — and a dozen prose copies of its contracts. An audit
 * found the copies had already drifted, in ways that silently broke the loop:
 *
 *   1. verify.sh told the agent to run `sdd.sh dismiss`, a subcommand sdd.sh
 *      does not implement. It fell through to the help text and exited 0, so
 *      the agent believed it had dismissed a failure while nothing reached the
 *      journal — and `sdd.sh done` then refused to close the feature.
 *   2. sdd-tester listed the --full stages without `prisma`. It was the only
 *      copy that had drifted, and it belonged to the agent issuing the verdict.
 *   3. The protocol's own example of a "next concrete step" pointed at a file
 *      that does not exist.
 *
 * All three are the same failure: prose that no longer matches the code, with
 * nothing to notice. Each check below turns one class of that drift red.
 *
 * Reads only .agent/, .claude/, .opencode/, AGENTS.md and package.json — no build needed.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const problems = [];

const read = (p) => readFileSync(p, "utf8");

/** Every .md that documents the harness. */
function harnessDocs() {
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) found.push(full);
    }
  };
  walk(".agent");
  walk(".claude");
  walk(".opencode");
  found.push("AGENTS.md", "CLAUDE.md");
  return found.filter(existsSync);
}

const DOCS = harnessDocs();

// --- 1. Every documented subcommand exists in its script's dispatch ---------
// `sdd.sh dismiss` is exactly this bug: cited in prose, absent from the case.

/** Subcommands a script's `case "${1:-}"` actually handles. */
function dispatchOf(script) {
  const body = read(script);
  const start = body.indexOf('case "${1:-}"');
  if (start === -1) return null;
  const names = new Set();
  for (const line of body.slice(start).split("\n")) {
    // `  new)` or `  -h | --help | help)` — a case label, not a nested case.
    const m = line.match(/^ {2}([a-z|\s-]+)\)\s*$/);
    if (m) for (const name of m[1].split("|")) names.add(name.trim());
  }
  return names;
}

const DISPATCH = {
  "sdd.sh": dispatchOf(".agent/sdd.sh"),
  "verify.sh": dispatchOf(".agent/verify.sh"),
};

for (const [name, subcommands] of Object.entries(DISPATCH)) {
  if (!subcommands || subcommands.size === 0) {
    problems.push(`could not read the dispatch of .agent/${name}`);
  }
}

// Flags and IDs are arguments, not subcommands.
const NOT_A_SUBCOMMAND = /^(-|#|F-\d{3}|F-NNN|<|\$)/;

for (const doc of DOCS) {
  for (const line of read(doc).split("\n")) {
    const calls = line.matchAll(/\.agent\/(sdd|verify)\.sh\s+([^\s`'"|)]+)/g);
    for (const [, script, word] of calls) {
      if (NOT_A_SUBCOMMAND.test(word)) continue;
      const subcommands = DISPATCH[`${script}.sh`];
      if (subcommands && !subcommands.has(word)) {
        problems.push(`${doc}: \`${script}.sh ${word}\` — no such subcommand`);
      }
    }
  }
}

// --- 2. Every repo path cited in the docs exists ---------------------------

// Harness files, plus any cited source file. A directory like `src/constants/`
// is a convention the docs prescribe, created when first needed — absence is
// not drift — but a named file that does not exist is a dead reference.
const CITED_PATH = /`((?:\.\.\/|\.agent|\.claude|scripts)?[\w.-]*(?:\/[\w.-]+)+(?::\d+)?)`/g;

// Created on demand by the scripts themselves, so absence proves nothing.
const ON_DEMAND = /^\.agent\/(runs|specs\/propuestas)\b/;

// `.agents/…` — with an s — is cuadrecaja's harness inside cuadrecaja's repo,
// not ours. Naming their request document is the whole point of
// .agent/solicitudes.md, and it can never exist here.
const OTHER_REPO = /^\.agents\//;

// A file an unfinished feature will create is a scheduled reference, not a dead
// one — as long as the line says which feature. Naming it is the whole point:
// the reader learns when it appears, and this check keeps holding it to that.
const PENDING = new Set(
  JSON.parse(read(".agent/features.json"))
    .features.filter((f) => !f.passes)
    .map((f) => f.id),
);
const scheduled = (line) => [...line.matchAll(/F-\d{3}/g)].some(([id]) => PENDING.has(id));

for (const doc of DOCS) {
  const byLine = read(doc).split("\n");
  for (const [, cited] of read(doc).matchAll(CITED_PATH)) {
    const context = byLine.find((l) => l.includes(`\`${cited}\``)) ?? "";
    if (scheduled(context)) continue;
    // Strip a trailing :line and placeholder segments we cannot resolve.
    const bare = cited.replace(/:\d+(-\d+)?$/, "");
    if (/[<>*]|F-NNN|F-XXX|F-\d{3}|NNNN/.test(bare)) continue;
    if (ON_DEMAND.test(bare)) continue;
    if (OTHER_REPO.test(bare)) continue;
    // A directory is a convention the docs prescribe, created when first
    // needed. Only a named file is a reference that can go dead.
    if (!/\.(ts|tsx|mjs|css|json|sh|prisma|md)$/.test(bare)) continue;
    const candidates = [
      bare,
      path.join(path.dirname(doc), bare), // written relative to its document
      path.join("src", bare), // docs often drop the `src/` prefix
    ];
    if (!candidates.some(existsSync)) {
      problems.push(`${doc}: \`${cited}\` does not exist`);
    }
  }
}

// --- 3. Documented stage lists match verify.sh -----------------------------
// sdd-tester's --full list is the copy that drifted, dropping `prisma`.

const verify = read(".agent/verify.sh");
const stagesOf = (name) =>
  verify.match(new RegExp(`^${name}="([^"]+)"`, "m"))?.[1].split(/\s+/) ?? [];

const RAPIDO = stagesOf("STAGES_RAPIDO");
const COMPLETO = stagesOf("STAGES_COMPLETO");

if (RAPIDO.length === 0 || COMPLETO.length === 0) {
  problems.push("could not read STAGES_RAPIDO/STAGES_COMPLETO from verify.sh");
}

// Command examples write stage lists as `typecheck · lint · format · test`,
// sometimes as a delta (`+ prisma · build · …`).
// The stage name is the last word of its segment: a comment may lead with
// prose ("antes de entregar: + prisma · build · …").
const asList = (text) =>
  text
    .split("·")
    .map((s) => s.trim().split(/\s+/).pop() ?? "")
    .filter((s) => /^[a-z]+$/.test(s));

for (const doc of DOCS) {
  const lines = read(doc).split("\n");
  for (const [i, line] of lines.entries()) {
    // Only invocation examples: a stale list there makes an agent run the
    // wrong thing. Prose that merely describes the stages is not executed.
    if (!line.includes("·") || !line.includes("verify.sh")) continue;
    const listed = asList(line.replace(/^.*?(?:#|—)\s*/, ""));
    if (listed.length < 3) continue;
    const isFull = /--full/.test(line);
    const expected = isFull ? COMPLETO : RAPIDO;
    // A `--full` line may be written as a delta ("+ prisma · build · …").
    const delta = isFull && /\+/.test(line);
    const target = delta ? COMPLETO.filter((s) => !RAPIDO.includes(s)) : expected;
    const missing = target.filter((s) => !listed.includes(s));
    if (missing.length > 0 && listed.every((s) => target.includes(s))) {
      problems.push(
        `${doc}:${i + 1}: stage list is missing ${missing.join(", ")} — ` +
          `verify.sh runs ${target.join(" · ")}`,
      );
    }
  }
}

// --- 4. The playbook's `etapa` values cover every real stage ---------------

const playbookTemplate = ".agent/playbook/TEMPLATE.md";
if (existsSync(playbookTemplate)) {
  const etapa = read(playbookTemplate).match(/^etapa:\s*(.+)$/m)?.[1] ?? "";
  const allowed = etapa.split("|").map((s) => s.trim());
  const uncoverable = COMPLETO.filter((s) => !allowed.includes(s));
  if (uncoverable.length > 0) {
    problems.push(
      `${playbookTemplate}: \`etapa\` cannot name ${uncoverable.join(", ")} — ` +
        `a real stage that can fail has no card to describe it`,
    );
  }
}

// --- 5. init.sh demands scripts that package.json defines -----------------

const declared = Object.keys(JSON.parse(read("package.json")).scripts ?? {});
const demanded =
  read(".agent/init.sh")
    .match(/^for s in ([^;]+); do$/m)?.[1]
    .split(/\s+/) ?? [];

if (demanded.length === 0) {
  problems.push("could not read the script list from .agent/init.sh");
}
for (const script of demanded) {
  if (!declared.includes(script)) {
    problems.push(`.agent/init.sh demands \`npm run ${script}\`, absent from package.json`);
  }
}

// Every stage the sensor runs must be a script the environment check covers.
for (const stage of COMPLETO) {
  const cmd = verify.match(new RegExp(`^\\s*${stage}\\)\\s*echo "([^"]+)"`, "m"))?.[1];
  const npmScript = cmd?.match(/^npm (?:run )?(\S+)/)?.[1];
  if (npmScript && npmScript !== "test" && !demanded.includes(npmScript)) {
    problems.push(
      `stage \`${stage}\` runs \`${cmd}\`, but .agent/init.sh does not check it — ` +
        `the environment can look ready and the stage still fail`,
    );
  }
}

// --- 6. Frontmatter fields the templates write are documented --------------

const specsReadme = ".agent/specs/README.md";
if (existsSync(specsReadme)) {
  const documented = read(specsReadme);
  for (const tpl of readdirSync(".agent/templates").filter((f) => f.endsWith(".md"))) {
    const front = read(path.join(".agent/templates", tpl)).split("---")[1] ?? "";
    for (const [, field] of front.matchAll(/^([a-z_]+):/gm)) {
      if (!documented.includes(`\`${field}\``)) {
        problems.push(
          `.agent/templates/${tpl} writes \`${field}:\`, undocumented in ${specsReadme}`,
        );
      }
    }
  }
}

// --------------------------------------------------------------------------

if (problems.length > 0) {
  console.error("✗ The harness documents something its scripts do not do:\n");
  for (const problem of problems) console.error(`    ${problem}`);
  console.error("\n  Fix the prose, not this check. An agent reads the prose and");
  console.error("  runs what it says — a command that does not exist fails silently.");
  process.exit(1);
}

console.log("✓ Harness prose matches its scripts");
console.log(
  `    ${DOCS.length} documents · ${COMPLETO.length} stages · ${demanded.length} required scripts`,
);
