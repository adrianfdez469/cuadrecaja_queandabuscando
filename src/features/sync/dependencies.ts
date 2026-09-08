import type { EventStatus, SyncEventInput } from "./schemas";

/**
 * F-037: which events, of THIS batch, block which other events of the same
 * batch — the cascade the sync contract's v11 § «Cambios respecto a la
 * v10.1» ③ calls `DEPENDENCY_FAILED_IN_BATCH`. Pure: no Prisma, no React,
 * only `import type` of `./schemas` — the precedent for this shape is
 * `./identity.ts`. Nothing here queries the database (R7): the whole
 * decision is made from what THIS batch already saw.
 */

/** The two entities whose failure can block others (R3). */
export type DependencySource = Extract<SyncEventInput["entity"], "CATEGORY" | "CURRENCY">;

/**
 * A composite key: the entity pair is PART of the key (E16), so
 * `CATEGORY:USD` and `CURRENCY:USD` never collide, whatever the value.
 */
export type DependencyKey = `${DependencySource}:${string}`;

export type DependencyRole = {
  /** The key this event OWNS: if it fails, it blocks whoever requires it. */
  provides: DependencyKey | null;
  /** The key this event NEEDS already applied to be safe to apply. */
  requires: DependencyKey | null;
};

/**
 * Translates one event into the two dependency roles it can play (R3): the
 * table below, and no other pair. Exhaustive `switch` with a `never` guard —
 * if a future entity (e.g. `BUSINESS`) is added to `SyncEventInput` without a
 * case here, `npm run typecheck` fails on THIS line, naming the entity
 * (AD3). `applyEvent`'s own `switch` (`processBatch.ts`) has no `default`
 * and would instead fail on a different line, with a message that does not
 * name it — that one is a safety net, not a guard.
 *
 * | `entity`        | `provides`                           | `requires`                                                         |
 * | --------------- | ------------------------------------- | ------------------------------------------------------------------ |
 * | `CATEGORY`      | `CATEGORY:` + `payload.categoryId`    | `null`                                                              |
 * | `CURRENCY`      | `CURRENCY:` + `payload.code`          | `null`                                                              |
 * | `PRODUCT`       | `null`                                | `CATEGORY:` + `payload.localCategoryId`; `null` if falsy (R5)      |
 * | `EXCHANGE_RATE` | `null`                                | `CURRENCY:` + `payload.currency`                                   |
 * | `STORE`         | `null`                                | `null`                                                              |
 *
 * No row has both columns filled (R11): neither `PRODUCT` nor
 * `EXCHANGE_RATE` is ever a `provides`, so a dependent never itself blocks
 * anything — there is no chain (E13).
 */
export function dependencyRoleOf(event: SyncEventInput): DependencyRole {
  switch (event.entity) {
    case "CATEGORY":
      return { provides: `CATEGORY:${event.payload.categoryId}`, requires: null };
    case "CURRENCY":
      return { provides: `CURRENCY:${event.payload.code}`, requires: null };
    case "PRODUCT": {
      // R5/E12: null, absent and "" all mean "no category" and none of
      // them participate in the cascade — the falsy check covers the three.
      const categoryId = event.payload.localCategoryId;
      return { provides: null, requires: categoryId ? `CATEGORY:${categoryId}` : null };
    }
    case "EXCHANGE_RATE":
      return { provides: null, requires: `CURRENCY:${event.payload.currency}` };
    case "STORE":
      return { provides: null, requires: null };
    default: {
      const exhaustive: never = event;
      throw new Error(`dependencyRoleOf: unhandled entity ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The per-batch tracker (R7: created ONCE per `processCatalogBatch`
 * invocation, never at module level — the gemelo of
 * `createRenderableBranchLookup`, F-035). Nothing here survives past the
 * call that created it.
 */
export type BatchDependencies = {
  /** The key that blocks this event from being applied, or `null` (O(1)). */
  blockedBy(event: SyncEventInput): DependencyKey | null;
  /** How an event that WAS run ended up — feeds the next `blockedBy` (O(1)). */
  note(event: SyncEventInput, status: EventStatus): void;
};

/**
 * Creates an empty tracker. The `Set` of composite keys is what makes E16
 * true BY CONSTRUCTION: `DependencyKey` is a template literal type, so a raw
 * string cannot enter the `Set` without going through `dependencyRoleOf`,
 * and `CATEGORY:` is never a prefix of `CURRENCY:` or vice versa — the
 * comparison the `Set` makes is exact, byte for byte, with no `trim` and no
 * case folding anywhere (R4/E11).
 */
export function createBatchDependencies(): BatchDependencies {
  const failedKeys = new Set<DependencyKey>();

  return {
    blockedBy(event) {
      const { requires } = dependencyRoleOf(event);
      return requires !== null && failedKeys.has(requires) ? requires : null;
    },
    note(event, status) {
      const { provides } = dependencyRoleOf(event);
      if (provides === null) return;

      if (status === "failed") {
        // R2: only an event that ends up in failed[] can block others.
        failedKeys.add(provides);
      } else if (status === "processed" || status === "stale") {
        // R13/E17 (AD1, plan.md paso 4b): a key repaired within the same
        // batch stops dragging — UNLESS the event that just "repaired" it
        // cannot prove the row exists. Found while implementing (PP5):
        // `handleCategory` has a `DELETE` branch that answers "processed"
        // WITHOUT writing anything when the row was never there
        // (`if (!existing) return PROCESSED;`,
        // `src/features/sync/server/handlers/misc.ts`) — a `DELETE` either
        // removes the row or finds nothing, so it never proves the row
        // exists, whichever branch it took. `CURRENCY` has no such case:
        // `handleCurrency` ignores `operation` entirely and always
        // `upsert`s (same file), so after ANY `CURRENCY` event — including a
        // `DELETE` — the row genuinely exists and clearing is correct. The
        // human decided this exception (2026-09-07, PP5 of plan.md): only
        // `CATEGORY` + `DELETE` keeps the key blocking.
        if (event.entity === "CATEGORY" && event.operation === "DELETE") return;
        failedKeys.delete(provides);
      }
      // "skipped_not_published" and "duplicate" neither prove the row
      // exists nor that it is missing (conservative default, AD1 § Riesgos
      // 1): do nothing.
    },
  };
}
