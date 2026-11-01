"use client";

import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";

/**
 * The cloud's copy of some of the user's cloud-synced blobs (their
 * user_state rows, by store key), read straight from Supabase with the
 * client the sync engine uses, for a one-time move that has to plan on the
 * cloud's copy rather than this device's (the feature flags' move into the
 * workspace, the Definition of Done's).
 *
 * A blob hook's adapter registers as the hook mounts. When sync is already
 * running (an in-app visit, the usual way in), that adapter pulls in the
 * background after syncEngine.whenReady() has resolved, so for a while the
 * hook still holds what this device last saw. Returns the rows found (a
 * key with no row is missing from the map), or null when it can't read (no
 * client, an error), and the caller falls back to what the hooks hold.
 */
export async function readCloudBlobs(
  userId: string,
  keys: readonly string[]
): Promise<Map<string, unknown> | null> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("user_state")
      .select("store_key, payload")
      .eq("user_id", userId)
      .in("store_key", [...keys]);
    if (error || !Array.isArray(data)) return null;
    return new Map(
      (data as { store_key: string; payload: unknown }[]).map((row) => [row.store_key, row.payload])
    );
  } catch {
    return null;
  }
}
