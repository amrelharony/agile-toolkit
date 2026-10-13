"use client";

/**
 * One-shot kudos backfill: on owner login, POST every kudos in the
 * workspace store that hasn't already been mirrored to the cloud.
 *
 * The server upserts by id so this is safe to run repeatedly — re-
 * posting a row that already exists is a no-op. We still gate the run
 * to once-per-session to keep network noise down.
 *
 * Started by `<KudosOwnerBridge/>` once the verified owner is signed in
 * (alongside `installKudosCloudSync`). Run AFTER the workspace store has
 * rehydrated from persist (the shell does that on mount).
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const BACKFILL_SESSION_KEY = "agile-toolkit:kudos:backfilled";
const POST_TIMEOUT_MS = 8_000;

let inFlight = false;

async function postOne(kudos: unknown): Promise<boolean> {
  // AbortController bounds the wait so a slow connection doesn't pin
  // the backfill behind a single hung request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch("/api/kudos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(kudos),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function runKudosBackfillIfNeeded(): Promise<void> {
  if (inFlight) return;
  if (typeof window === "undefined") return;
  // Re-run is OK at the server (idempotent upsert) but wasteful — guard
  // per-session so a route navigation doesn't fan out N POSTs.
  if (window.sessionStorage.getItem(BACKFILL_SESSION_KEY) === "1") return;
  inFlight = true;
  try {
    const kudos = useWorkspaceStore.getState().kudos ?? [];
    // Owner-authored rows only. Guest-authored rows (fromProfileId set)
    // were written server-side via /api/guest/kudos with squad_id pinned
    // from the guest cookie; re-POSTing them to /api/kudos would full-row
    // upsert squad_id back to null (and clobber reactions with our local
    // snapshot). Mirrors the same gate in cloud-sync.ts.
    // Reverse so newest goes first — fastest convergence for the
    // owner's wall on the secondary device the backfill is targeting.
    const batch = kudos.filter((k) => !k.fromProfileId).reverse();
    // Cap batched concurrency at 4 — the typical workspace has at most
    // a few hundred kudos, so we accept ~50 sequential rounds rather
    // than overwhelming the function.
    const CONCURRENCY = 4;
    let cursor = 0;
    let anyPosted = false;
    const worker = async (): Promise<void> => {
      while (cursor < batch.length) {
        const idx = cursor++;
        // Individual failures aren't retried here; after a partial
        // success they go out on the next session's run (the server
        // upserts by id, so re-sending the rest is harmless).
        if (await postOne(batch[idx])) anyPosted = true;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    // Latch only when the run did something useful. If every POST failed
    // (offline, server down) the next run — a reload or the owner
    // signing in again — must try again instead of skipping the backfill
    // for the rest of the tab session.
    if (batch.length === 0 || anyPosted) {
      window.sessionStorage.setItem(BACKFILL_SESSION_KEY, "1");
    }
  } finally {
    inFlight = false;
  }
}

/**
 * Re-arm the backfill for this tab session. Called whenever the owner gate
 * closes and when signed-out work is merged: kudos sent while the gate was
 * closed never reached the cloud-sync queue, and only the backfill uploads
 * them — but the latch (sessionStorage) outlives sign-out and the OAuth
 * round trip.
 */
export function resetKudosBackfillLatch(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(BACKFILL_SESSION_KEY);
  } catch {
    /* storage blocked: there is no latch to clear */
  }
}

/** Test-only: clear the per-session backfill latch. */
export function __resetKudosBackfill(): void {
  resetKudosBackfillLatch();
}
