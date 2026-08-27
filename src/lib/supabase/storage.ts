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
): Promise<UploadResult> {
  const availability = storageAvailability();
  if (!availability.ok) return availability;

  try {
    const bucket = serverEnv().SUPABASE_STORAGE_BUCKET;
    const { error } = await serviceClient()
      .storage.from(bucket)
      .upload(path, bytes, { contentType, upsert: false });

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

/** Everything up to and including the bucket name. Used to keep `imageUrls`
 *  restricted to objects actually under our bucket (R21). */
export function publicUrlPrefix(): string {
  const bucket = serverEnv().SUPABASE_STORAGE_BUCKET;
  return `${publicEnv.supabaseUrl}/storage/v1/object/public/${bucket}/`;
}

export function publicUrlFor(path: string): string {
  return `${publicUrlPrefix()}${path}`;
}
