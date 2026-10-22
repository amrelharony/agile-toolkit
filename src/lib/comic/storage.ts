/**
 * Where the "Agile at Work" PDF lives: a PRIVATE Supabase Storage bucket.
 * There is no public URL for it. The reader page (/comic/<token>) checks
 * the token, then asks for a short-lived signed URL and hands only that to
 * the browser.
 *
 * Why service-role: the bucket has no RLS policies for anon or
 * authenticated users, so only the service role can sign URLs for it. The
 * token check in the page is the authorization boundary — which only holds
 * while the bucket itself stays private (getComicSignedUrl checks).
 */

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const COMIC_BUCKET = "comics";
export const COMIC_OBJECT = "agile-at-work.pdf";
/** Long enough for a reading session; a reload mints a fresh URL. */
export const COMIC_SIGNED_URL_TTL_SECONDS = 12 * 60 * 60;

export type ComicSignedUrl =
  /** `url` is an absolute https://<project>.supabase.co/storage/v1/object/sign/… URL. */
  | { status: "ready"; url: string }
  /** The bucket or the object doesn't exist yet. */
  | { status: "missing" }
  /** Storage isn't configured, or Supabase failed. */
  | { status: "unavailable" };

let cachedAdmin: SupabaseClient | null = null;

/**
 * Service-role client, cached per process. Null when env vars are missing
 * so the page can degrade instead of throwing into the response stream.
 */
function getComicStorageClient(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

/**
 * Storage answers a missing object or bucket with `statusCode: "404"` in
 * the JSON body (over HTTP 400 or 404, depending on the server version) and
 * "Object not found" / "Bucket not found" as the message. storage-js copies
 * those onto StorageApiError as `statusCode`, `status` and `message`.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, statusCode, message } = error as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  if (status === 404 || String(statusCode) === "404") return true;
  return typeof message === "string" && /\b(object|bucket) not found\b/i.test(message);
}

/** Name, status and message only — never a URL, a key or the token. */
function errorSummary(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error).slice(0, 200);
  const { name, status, message } = error as {
    name?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return [name, status, typeof message === "string" ? message.slice(0, 200) : undefined]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
}

/**
 * A fresh signed URL for the comic PDF. Called per request (the page is
 * force-dynamic); supabase-js signs with a POST, which Next's data cache
 * never stores, so no URL is ever served stale.
 *
 * Fails closed if the bucket is not private. Signing still works on a
 * public bucket, so nothing else would notice — yet the PDF would then be
 * open to anyone at /storage/v1/object/public/comics/agile-at-work.pdf (the
 * project URL ships in every client bundle). Refusing to serve can't close
 * that hole, but it turns a silent leak into a broken link and a `[comic]`
 * warning in the logs. Checked on every request, alongside the signing,
 * so flipping the switch is caught at once and costs no extra round trip.
 */
export async function getComicSignedUrl(): Promise<ComicSignedUrl> {
  const client = getComicStorageClient();
  if (!client) {
    console.warn(
      "[comic] storage is not configured: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing"
    );
    return { status: "unavailable" };
  }
  try {
    const [bucketResult, { data, error }] = await Promise.all([
      client.storage.getBucket(COMIC_BUCKET),
      client.storage.from(COMIC_BUCKET).createSignedUrl(COMIC_OBJECT, COMIC_SIGNED_URL_TTL_SECONDS),
    ]);
    if (bucketResult.error) {
      if (isNotFound(bucketResult.error)) return { status: "missing" };
      console.warn(
        `[comic] could not check that the bucket is private: ${errorSummary(bucketResult.error)}`
      );
      return { status: "unavailable" };
    }
    // Only an explicit `public: false` counts as private.
    if (bucketResult.data?.public !== false) {
      console.warn(
        `[comic] bucket "${COMIC_BUCKET}" is PUBLIC (or its visibility is unknown); refusing to serve. Supabase → Storage → ${COMIC_BUCKET} → Edit bucket → turn "Public bucket" off.`
      );
      return { status: "unavailable" };
    }
    if (error) {
      if (isNotFound(error)) return { status: "missing" };
      console.warn(`[comic] could not sign the comic URL: ${errorSummary(error)}`);
      return { status: "unavailable" };
    }
    if (!data?.signedUrl) {
      console.warn("[comic] could not sign the comic URL: empty response");
      return { status: "unavailable" };
    }
    return { status: "ready", url: data.signedUrl };
  } catch (err) {
    console.warn(`[comic] could not sign the comic URL: ${errorSummary(err)}`);
    return { status: "unavailable" };
  }
}
