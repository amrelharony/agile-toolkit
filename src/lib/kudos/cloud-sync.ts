"use client";

/**
 * Cloud-sync side-channel for the workspace kudos store.
 *
 * Why a side-channel and not a direct call from `upsertKudos`:
 *   * The workspace store is a pure Zustand slice; importing fetch into
 *     it would couple the persistence layer to the network layer.
 *   * The signal-bridge already emits `kudos.sent` on every add. We
 *     subscribe to that and POST — one source of truth for "a kudos
 *     was just added".
 *
 * Hot path stays optimistic: the wall renders immediately from the
 * workspace store; this module is fire-and-forget. Failures retry with
 * exponential backoff up to 4 attempts, then drop. The backfill module
 * sweeps anything that didn't land on a subsequent owner login.
 *
 * Owner-only by design. Guest pages do NOT mount this — guest writes
 * go through `/api/guest/kudos` directly from the form submit handler
 * (no optimistic store, no debounce — guests want immediate confirm so
 * the wall doesn't appear empty for them).
 */

import { subscribeSignals, type Signal } from "@/lib/signals/signal-bus";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kudos } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

interface PendingPost {
  kudos: Kudos;
  /** Attempt count, 1-based. Capped at MAX_ATTEMPTS before drop. */
  attempt: number;
  /** Earliest wall-clock ms at which the post may run. */
  notBefore: number;
}

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const TICK_MS = 250;
const STORAGE_KEY = "agile-toolkit:kudos:pending-sync";

let installed = false;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let broadcastChannel: BroadcastChannel | null = null;
const pending = new Map<string, PendingPost>();
// Ids with a POST currently awaiting its response. `notBefore` only
// moves AFTER the fetch settles, so without an in-flight claim every
// 250 ms tick re-selects the same row and fires another POST (8
// concurrent POSTs for a 2 s response). Their settle callbacks then
// run back-to-back on the same object, burning all 4 attempts in one
// round-trip and dropping the kudos — the 0.5/1/2/4 s backoff never
// happens. Claimed here, released in the `finally` below.
const inFlight = new Set<string>();

function backoffMs(attempt: number): number {
  // 0.5s, 1s, 2s, 4s — bounded by MAX_ATTEMPTS so the queue can't grow
  // a stale row's wait indefinitely.
  return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

function pendingValues(): PendingPost[] {
  const out: PendingPost[] = [];
  pending.forEach((p) => out.push(p));
  return out;
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    // Persist the full PendingPost shape — not just `kudos` — so the
    // MAX_ATTEMPTS ceiling survives page reload. Earlier versions
    // re-seeded `attempt: 1` on rehydrate, letting unsendable rows
    // retry forever across reloads.
    const arr = pendingValues();
    if (arr.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    }
  } catch {
    // Quota errors are non-fatal; the in-memory queue still drains.
  }
}

function rehydrate(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    const now = Date.now();
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      // Backward-compat: the legacy persist shape stored bare Kudos
      // objects (no PendingPost wrapper). Detect by absence of
      // `kudos` field and re-seed with attempt=1.
      const wrapped = "kudos" in entry && entry.kudos && typeof entry.kudos === "object";
      const kudos = (wrapped ? entry.kudos : entry) as Kudos;
      if (typeof kudos.id !== "string") continue;
      const attempt =
        wrapped && typeof entry.attempt === "number" && entry.attempt >= 1
          ? Math.min(entry.attempt, MAX_ATTEMPTS)
          : 1;
      // Drop dead-lettered rows on rehydrate so they don't loop forever.
      if (attempt >= MAX_ATTEMPTS) continue;
      const notBefore = wrapped && typeof entry.notBefore === "number" ? entry.notBefore : now;
      pending.set(kudos.id, { kudos, attempt, notBefore });
    }
  } catch {
    // Corrupt payload — start clean rather than throwing on every install.
  }
}

async function attemptOne(post: PendingPost): Promise<"ok" | "retry" | "drop"> {
  try {
    const res = await fetch("/api/kudos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(post.kudos),
    });
    if (res.ok) return "ok";
    // 4xx other than 429 means the payload is unfixable by retry —
    // dropping silently is correct because the workspace store still
    // holds the row and the owner can re-author / debug from the UI.
    if (res.status === 429) return "retry";
    if (res.status >= 400 && res.status < 500) {
      // eslint-disable-next-line no-console
      console.warn("[kudos/cloud-sync] dropped after", res.status, "for", post.kudos.id);
      return "drop";
    }
    return "retry";
  } catch {
    // Network errors retry — most common case after a transient drop.
    return "retry";
  }
}

async function tick(): Promise<void> {
  if (pending.size === 0) return;
  const now = Date.now();
  // Grab up to 8 ready rows per tick to bound parallelism. The owner
  // is one user; bursts are typically << 8.
  const batch: PendingPost[] = [];
  pending.forEach((p) => {
    if (p.notBefore > now) return;
    // Skip rows whose POST hasn't come back yet — see `inFlight`.
    if (inFlight.has(p.kudos.id)) return;
    if (batch.length >= 8) return;
    batch.push(p);
  });
  if (batch.length === 0) return;
  // Claim BEFORE awaiting: ticks that land while these are outstanding
  // must not re-select them.
  for (const post of batch) inFlight.add(post.kudos.id);

  await Promise.all(
    batch.map(async (post) => {
      let result: "ok" | "retry" | "drop";
      try {
        result = await attemptOne(post);
      } finally {
        // Release the claim in every path (including an unexpected
        // throw) so a row can never be stranded un-retryable.
        inFlight.delete(post.kudos.id);
      }
      if (result === "ok" || result === "drop") {
        pending.delete(post.kudos.id);
        if (result === "ok") {
          // Tell sibling tabs the id has landed so they can prune
          // their queues. Without this every owner tab would re-POST
          // every kudos (idempotent at the DB level, but wasted
          // rate-limit headroom). The receive-side listener at
          // install time calls `pending.delete(id)` on match.
          broadcastChannel?.postMessage(post.kudos.id);
        }
        return;
      }
      // retry
      if (post.attempt >= MAX_ATTEMPTS) {
        pending.delete(post.kudos.id);
        // eslint-disable-next-line no-console
        console.warn(
          "[kudos/cloud-sync] gave up after",
          MAX_ATTEMPTS,
          "attempts for",
          post.kudos.id
        );
        return;
      }
      post.attempt += 1;
      post.notBefore = Date.now() + backoffMs(post.attempt);
    })
  );
  persist();
}

function enqueue(k: Kudos): void {
  // If the same id is already pending, leave the older attempt alone —
  // the payloads are identical (workspace store rows are immutable
  // after upsert) and resetting attempt would extend a stale row's
  // retry budget.
  if (pending.has(k.id)) return;
  pending.set(k.id, { kudos: k, attempt: 1, notBefore: Date.now() });
  persist();
}

function lookupKudos(id: string): Kudos | undefined {
  const list = useWorkspaceStore.getState().kudos ?? [];
  return list.find((k) => k.id === id);
}

export function installKudosCloudSync(): void {
  if (installed) return;
  installed = true;
  rehydrate();

  // Cross-tab dedup: if a sibling tab already POSTed the same id, drop
  // ours so we don't double-attempt. The other tab broadcasts the id
  // on success.
  if (typeof BroadcastChannel === "function") {
    broadcastChannel = new BroadcastChannel("agile-toolkit:kudos:cloud-sync");
    broadcastChannel.onmessage = (e) => {
      const id = typeof e.data === "string" ? e.data : null;
      if (id) {
        pending.delete(id);
        persist();
      }
    };
  }

  unsubscribe = subscribeSignals(["kudos.sent"], (s: Signal) => {
    const payload = s.payload as { id?: unknown } | null;
    const id = payload && typeof payload.id === "string" ? payload.id : null;
    if (!id) return;
    const kudos = lookupKudos(id);
    if (!kudos) return;
    // Guest-authored rows (fromProfileId set) have their own server
    // write path through `/api/guest/kudos` — the guest client POSTs
    // directly from its handleSubmit. Owner tabs that receive the
    // realtime broadcast end up with the row in their workspace store
    // too, and without this gate every owner tab would re-POST the
    // same guest-authored row to `/api/kudos` (idempotent at the DB,
    // but burns the owner's rate-limit budget and produces a misleading
    // squad_id=null on a row the guest endpoint already pinned to a
    // squad). Skip them.
    if (kudos.fromProfileId) return;
    // Example kudos (Kudos' "Load an example") never reach the kudos
    // table: Clear example removes them here, and nothing would remove
    // them there. The bridge doesn't signal them; this guards a direct emit.
    if (isExampleId(kudos.id)) return;
    enqueue(kudos);
    // Trigger a tick immediately so the typical case (one send → POST
    // ~250ms later) doesn't wait for the interval.
    void tick();
  });

  timer = setInterval(() => {
    void tick().then(() => {
      // Tell sibling tabs about every successful drain so they can
      // prune their queues.
      // (No-op when broadcastChannel is unavailable.)
    });
  }, TICK_MS);
}

export function uninstallKudosCloudSync(): void {
  unsubscribe?.();
  if (timer) clearInterval(timer);
  broadcastChannel?.close();
  unsubscribe = null;
  timer = null;
  broadcastChannel = null;
  installed = false;
}

/** Test-only: drain the queue + reset state. */
export function __resetKudosCloudSync(): void {
  pending.clear();
  // Drop any claims too — a leftover id would block the next install
  // from ever re-selecting that row.
  inFlight.clear();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* swallow */
    }
  }
}

/** Test-only inspector. */
export function __pendingKudosSyncSize(): number {
  return pending.size;
}
