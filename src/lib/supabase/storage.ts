import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * The only module that talks to the Supabase Storage API (HD1, R17).
 *
 * Never throws: every failure — missing config, the emulator being down, the
 * API rejecting the object — comes back as a discriminated result, because
 * the caller (`features/admin/server/mutations.ts`) needs to turn it into a
 * 503 with a `reason`, not an uncaught 500 (I8).
 */

/** Why a Storage call could not even be attempted or was refused. */
export type StorageFailureReason =
  "missing_service_role_key" | "missing_supabase_url" | "unreachable" | "rejected";

export type StorageAvailability = { ok: true } | { ok: false; reason: StorageFailureReason };

/**
 * Config-only check: is there enough to even attempt to talk to Storage.
 * `SUPABASE_SERVICE_ROLE_KEY` stays `optional()` in `serverEnv()` (I8) —
 * making it required would break every route that never touches Storage.
 */
export function storageAvailability(): StorageAvailability {
  if (!publicEnv.supabaseUrl) return { ok: false, reason: "missing_supabase_url" };
  if (!serverEnv().SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, reason: "missing_service_role_key" };
  return { ok: true };
}

function serviceClient() {
  return createClient(publicEnv.supabaseUrl, serverEnv().SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false },
  });
}

export type UploadResult = { ok: true; url: string } | { ok: false; reason: StorageFailureReason };

export async function uploadStoreObject(
  path: string,
  bytes: Buffer,
  contentType: string,
  opts?: { upsert?: boolean },
): Promise<UploadResult> {
  const availability = storageAvailability();
  if (!availability.ok) return availability;

  try {
    const bucket = serverEnv().SUPABASE_STORAGE_BUCKET;
    const { error } = await serviceClient()
      .storage.from(bucket)
      .upload(path, bytes, { contentType, upsert: opts?.upsert ?? false });

    if (error) {
      console.error("[admin] storage upload rejected:", error.message);
      return { ok: false, reason: "rejected" };
    }
    return { ok: true, url: publicUrlFor(path) };
  } catch (error) {
    console.error("[admin] storage unreachable:", error);
    return { ok: false, reason: "unreachable" };
  }
}

export type UploadObjectInput = {
  path: string;
  bytes: Buffer;
  contentType: string;
  /** Seed-only (architecture.md § Sembrar una imagen de verdad): a
   *  deterministic directory means a second run re-writes the SAME five
   *  objects instead of erroring on "already exists". */
  upsert?: boolean;
};

export type UploadBatchResult =
  | { ok: true; urls: string[] }
  | { ok: false; reason: StorageFailureReason; uploadedPaths: string[] };

/**
 * F-023 R6/E2: all-or-nothing for the CALLER's own bookkeeping. This
 * function does not clean up after itself — it uploads every object in
 * parallel and, if any fails, reports back exactly which paths DID land
 * (`uploadedPaths`), so `appendProductImage` can hand them to
 * `removeStoreObjects()` and leave the row untouched (E2). Order of `urls`
 * matches the order of `objects` on success.
 */
export async function uploadStoreObjects(objects: UploadObjectInput[]): Promise<UploadBatchResult> {
  const availability = storageAvailability();
  if (!availability.ok) return { ...availability, uploadedPaths: [] };

  const results = await Promise.all(
    objects.map(async (object) => ({
      object,
      result: await uploadStoreObject(object.path, object.bytes, object.contentType, {
        upsert: object.upsert,
      }),
    })),
  );

  const uploadedPaths = results
    .filter((entry) => entry.result.ok)
    .map((entry) => entry.object.path);

  const failed = results.find((entry) => !entry.result.ok);
  if (failed) {
    const reason = (failed.result as { ok: false; reason: StorageFailureReason }).reason;
    return { ok: false, reason, uploadedPaths };
  }

  return { ok: true, urls: results.map((entry) => publicUrlFor(entry.object.path)) };
}

export type RemoveResult =
  { ok: true; removed: number } | { ok: false; reason: StorageFailureReason };

/** R12: idempotent — removing an already-absent key is success. */
export async function removeStoreObjects(paths: string[]): Promise<RemoveResult> {
  if (paths.length === 0) return { ok: true, removed: 0 };

  const availability = storageAvailability();
  if (!availability.ok) return availability;

  try {
    const bucket = serverEnv().SUPABASE_STORAGE_BUCKET;
    const { data, error } = await serviceClient().storage.from(bucket).remove(paths);
    if (error) {
      console.error("[admin] storage remove rejected:", error.message);
      return { ok: false, reason: "rejected" };
    }
    return { ok: true, removed: data?.length ?? 0 };
  } catch (error) {
    console.error("[admin] storage unreachable:", error);
    return { ok: false, reason: "unreachable" };
  }
}

// architecture.md § Escalabilidad — Borrado por prefijo: a hard cap so an
// unexpectedly huge prefix cannot turn one sync event into a request storm.
const REMOVE_UNDER_MAX_SUBDIRS = 64;
const REMOVE_UNDER_MAX_KEYS = 512;

/**
 * F-023 R9/E11: deletes every object under `prefix`, in ANY layout —
 * F-023's own image directories (`<uuid>/original.<ext>` + variants) AND
 * F-011's flat objects (`<uuid>.<ext>`), because a product can carry both
 * after an upload that failed halfway (a directory left orphaned mid-set).
 *
 * `.list()` is NOT recursive (architecture.md § Cinco cosas…, punto 3): it
 * returns one level, with sub-"folders" as entries whose `id` is `null`.
 * Two levels are all this layout ever has, so one `.list(prefix)` plus one
 * `.list(prefix + folderName + "/")` per folder is enough — at most
 * 1 + (images per product) calls, capped defensively above.
 */
export async function removeStoreObjectsUnder(prefix: string): Promise<RemoveResult> {
  const availability = storageAvailability();
  if (!availability.ok) return availability;

  try {
    const bucket = serverEnv().SUPABASE_STORAGE_BUCKET;
    const client = serviceClient().storage.from(bucket);

    const top = await client.list(prefix);
    if (top.error) {
      console.error("[admin] storage list rejected:", top.error.message);
      return { ok: false, reason: "rejected" };
    }

    const keys: string[] = [];
    const folders = (top.data ?? [])
      .filter((entry) => entry.id === null)
      .slice(0, REMOVE_UNDER_MAX_SUBDIRS);
    const flatObjects = (top.data ?? []).filter((entry) => entry.id !== null);
    for (const entry of flatObjects) keys.push(`${prefix}${entry.name}`);

    for (const folder of folders) {
      const nested = await client.list(`${prefix}${folder.name}/`);
      if (nested.error) {
        console.error("[admin] storage list rejected:", nested.error.message);
        return { ok: false, reason: "rejected" };
      }
      for (const entry of nested.data ?? []) {
        if (entry.id !== null) keys.push(`${prefix}${folder.name}/${entry.name}`);
      }
      if (keys.length >= REMOVE_UNDER_MAX_KEYS) break;
    }

    if (keys.length === 0) return { ok: true, removed: 0 };
    return await removeStoreObjects(keys.slice(0, REMOVE_UNDER_MAX_KEYS));
  } catch (error) {
    console.error("[admin] storage unreachable:", error);
    return { ok: false, reason: "unreachable" };
  }
}

/** Everything up to and including the bucket name. Used to keep `imageUrls`
 *  restricted to objects actually under our bucket (R21). */
export function publicUrlPrefix(): string {
  const bucket = serverEnv().SUPABASE_STORAGE_BUCKET;
  return `${publicEnv.supabaseUrl}/storage/v1/object/public/${bucket}/`;
}

export function publicUrlFor(path: string): string {
  return `${publicUrlPrefix()}${path}`;
}

/** F-023: the inverse of `publicUrlFor` — `null` for anything not under our
 *  own bucket (a foreign URL), which is exactly what makes purging a
 *  legacy/foreign URL in `saveProduct` a safe no-op instead of a crash. */
export function objectPathOf(publicUrl: string): string | null {
  const prefix = publicUrlPrefix();
  if (!publicUrl.startsWith(prefix)) return null;
  return publicUrl.slice(prefix.length);
}
