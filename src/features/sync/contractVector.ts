import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * F-044 (architecture.md § D4): the ONE mechanism that reads a contract
 * vector — section recorte, single json block capture, published sha256 —
 * shared by every test that has to prove it executed against
 * `docs/sync-contract.md` ITSELF, never a transcribed copy. Support module
 * for tests, not a production path (precedent: no path under `src/app/` or
 * under any feature's `server/` directory imports this, the same boundary
 * `src/features/marketplace/server/dbFixtures.ts` already sits inside).
 *
 * Copied line by line from `src/features/zones/precedence.test.ts`'s own
 * inline versions of these three functions (F-041) — that file is not
 * refactored to use this module (architecture.md § Qué queda fuera 8, it is
 * F-041's and it is green); this is the version F-044's own vector test
 * uses.
 */

const CONTRACT_PATH = join(process.cwd(), "docs/sync-contract.md");

export function readContract(): string {
  return readFileSync(CONTRACT_PATH, "utf8");
}

/** The section between `heading` and the next level 2-4 heading (or the end
 *  of the document) — used ONLY to bound the search for the single json
 *  block, never for the published hash line, which can sit under its own
 *  (also level-4) sub-heading right after (same reason
 *  `precedence.test.ts`'s `extractPublishedHash` searches the whole
 *  document instead of the section it just carved out). */
function vectorSection(contract: string, heading: string): string {
  const headingIndex = contract.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error(
      `contractVector: heading "${heading}" not found in docs/sync-contract.md — did it move or get renamed?`,
    );
  }
  const rest = contract.slice(headingIndex + heading.length);
  const nextHeading = /\n#{2,4} /.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

/**
 * Captures the section's single ```json block, parses it, and returns both
 * the parsed value and the RAW captured text — the same bytes a published
 * sha256 has to be recomputed over, never re-serialized. Zero, two-or-more,
 * or invalid JSON are each their own loud failure, never a silently empty
 * test.
 */
export function extractVectorBlock<T>(
  contract: string,
  heading: string,
): { rawBlock: string; parsed: T } {
  const section = vectorSection(contract, heading);
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (blocks.length === 0) {
    throw new Error(
      `contractVector: no \`\`\`json block found under "${heading}" in docs/sync-contract.md`,
    );
  }
  if (blocks.length > 1) {
    throw new Error(
      `contractVector: expected EXACTLY one \`\`\`json block under "${heading}", found ${blocks.length}`,
    );
  }
  const rawBlock = blocks[0]![1]!;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBlock);
  } catch (cause) {
    throw new Error(
      `contractVector: the block under "${heading}" is not valid JSON: ${(cause as Error).message}`,
    );
  }
  return { rawBlock, parsed: parsed as T };
}

/**
 * The contract's own published hash, read as text from the WHOLE document
 * (never scoped to `vectorSection`'s cut, and never hand-copied into a
 * second constant here — that second constant is exactly the drift a
 * published hash exists to catch).
 */
export function extractPublishedSha256(contract: string, labelRe: RegExp, heading: string): string {
  const match = labelRe.exec(contract);
  if (!match) {
    throw new Error(
      `contractVector: the published sha256 line for "${heading}" was not found or is not a 64-char hex string`,
    );
  }
  return match[1]!;
}
