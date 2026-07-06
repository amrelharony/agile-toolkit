"use client";

/**
 * One-shot kudos backfill: on owner login, POST every kudos in the
 * workspace store that hasn't already been mirrored to the cloud.
 *
 * The server upserts by id so this is safe to run repeatedly — re-
 * posting a row that already exists is a no-op. We still gate the run
 * to once-per-session to keep network noise down.
 *
 * Mounted in the app shell alongside `installKudosCloudSync`. Run AFTER
 * the workspace store has rehydrated from persist (the shell does that
 * before mounting the kudos page anyway).
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
    const worker = async (): Promise<void> => {
      while (cursor < batch.length) {
        const idx = cursor++;
        // We don't propagate the boolean — failures will be picked up
        // by the periodic cloud-sync tick on next add.
        await postOne(batch[idx]);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    window.sessionStorage.setItem(BACKFILL_SESSION_KEY, "1");
  } finally {
    inFlight = false;
  }
}

/** Test-only: clear the per-session backfill latch. */
export function __resetKudosBackfill(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(BACKFILL_SESSION_KEY);
}
