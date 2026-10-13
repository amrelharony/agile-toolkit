import { useHistoryStore } from "@/lib/history/history-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import { resetCloudPersistedRegistry } from "@/lib/sync/use-cloud-persisted";

/**
 * "Clear data on this browser".
 *
 * The site is public, so a visitor and the owner may share one browser.
 * This wipes everything the toolkit keeps on the device: every key under
 * the `agile-toolkit:` prefix in localStorage AND sessionStorage (tool
 * stores, workspace, history, BYOK API keys, markers), plus the few
 * app-owned keys that predate the prefix. The theme (`ae-theme`) survives —
 * it is a display preference, not data. Supabase's own session storage is
 * left to `auth.signOut()`.
 *
 * In-memory state is NOT fully reset here. Most stores are registered with
 * the cloud sync engine, and resetting e.g. the workspace store while the
 * engine still runs would push tombstones that wipe the owner's cloud copy.
 * Removing storage keys never notifies a store, so it is safe whatever the
 * engine is doing. Every caller therefore reloads right afterwards, which
 * drops the in-memory copies; only the stores that hold sensitive data or
 * would otherwise write themselves straight back are reset first. Other
 * open tabs do the same for themselves when told (see
 * installLocalDataChannelListener).
 */

export const LOCAL_DATA_CHANNEL = "agile-toolkit:local-data";

const APP_KEY_PREFIX = "agile-toolkit:";

/** App-owned keys written before the `agile-toolkit:` prefix convention. */
export const LEGACY_APP_KEYS: readonly string[] = [
  "mascot_appearance", // lib/agent/mascot/store.ts
  "icebreaker-favorites", // icebreaker-client.tsx (migrated on read, may linger)
  "canvas:touchGestureHintSeen:v1", // canvas/components/whiteboard-canvas.tsx
];

type ClearedMessage = { type: "cleared"; at?: number };

/**
 * The stores clearLocalWorkspaceData() resets in memory (history, BYOK
 * keys): the only localStorage keys a "tab"-scoped clear removes.
 */
const RESET_STORE_KEYS: readonly string[] = ["agile-toolkit:history", "agile-toolkit:llm"];

/**
 * A "cleared" message older than this reached a tab that was frozen in the
 * background. That tab still clears ITSELF, but leaves the rest of
 * localStorage alone: by now it may hold someone else's newer work.
 */
const FRESH_CLEAR_MS = 30_000;

// One channel object per tab, used both to post and to listen: a
// BroadcastChannel never delivers to the object that posted, so the tab
// that clears doesn't also get told to reload by its own message.
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(LOCAL_DATA_CHANNEL);
  } catch {
    return null;
  }
  return channel;
}

function isAppKey(key: string): boolean {
  return key.startsWith(APP_KEY_PREFIX) || LEGACY_APP_KEYS.includes(key);
}

function clearStorage(getStorage: () => Storage): void {
  let storage: Storage;
  try {
    // The getter itself throws SecurityError when site data is blocked.
    storage = getStorage();
  } catch {
    return;
  }
  // Collect first: removing while indexing shifts `key(i)`.
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && isAppKey(key)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* keep going — clear as much as the browser allows */
    }
  }
}

function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    /* a store that failed to load must not block clearing the rest */
  }
}

function removeKeys(getStorage: () => Storage, keys: readonly string[]): void {
  let storage: Storage;
  try {
    storage = getStorage();
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* keep going */
    }
  }
}

/**
 * `scope`:
 *  - "browser" (default): sweep every app key from localStorage and this
 *    tab's sessionStorage.
 *  - "tab": a late "cleared" message (see FRESH_CLEAR_MS). Reset this tab's
 *    in-memory stores and sweep its own sessionStorage, but remove from
 *    localStorage only what those stores may have written back.
 */
export function clearLocalWorkspaceData(
  opts: { broadcast?: boolean; scope?: "browser" | "tab" } = {}
): void {
  if (typeof window === "undefined") return;

  // Store resets first: their persist middleware writes the emptied state
  // straight back to storage, and the sweep below then removes it.
  // - history: owner-stamped events and anything a visitor logged
  // - llm: BYOK API keys ("device" mode keeps them in localStorage)
  // - cloud-persisted registry: in-memory snapshots of per-key blobs
  attempt(() => useHistoryStore.getState().clearAll());
  attempt(() => useLlmStore.getState().clearAll());
  attempt(() => resetCloudPersistedRegistry());

  if (opts.scope === "tab") removeKeys(() => window.localStorage, RESET_STORE_KEYS);
  else clearStorage(() => window.localStorage);
  // sessionStorage belongs to this tab alone, so it is always swept.
  clearStorage(() => window.sessionStorage);

  if (opts.broadcast !== false) {
    // Other open tabs still hold the data in memory (and in their own
    // sessionStorage, which this tab can't reach — "session" mode BYOK
    // keys live there) and would write it back on their next store
    // update; tell them to clear themselves and reload.
    const message: ClearedMessage = { type: "cleared", at: Date.now() };
    attempt(() => getChannel()?.postMessage(message));
  }
}

/**
 * Default reaction to another tab's clear. Reloading alone is not enough:
 *  - a reload keeps THIS tab's sessionStorage, where "session"-mode BYOK
 *    keys, comment drafts and the kudos latch live;
 *  - this tab may already have written its in-memory data back after the
 *    other tab's sweep (e.g. the history store persisting the owner's
 *    events when its sync status flips on SIGNED_OUT).
 * So reset this tab's sensitive stores and sweep, then reload.
 */
function clearThisTabAndReload({ fresh }: { fresh: boolean }): void {
  clearLocalWorkspaceData({ broadcast: false, scope: fresh ? "browser" : "tab" });
  window.location.reload();
}

/**
 * Clear this tab and reload when another tab clears the local data.
 * Returns the uninstaller. Mounted once from the app header.
 */
export function installLocalDataChannelListener(
  onCleared: (info: { fresh: boolean }) => void = clearThisTabAndReload
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const onMessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<ClearedMessage> | null;
    if (!data || typeof data !== "object" || data.type !== "cleared") return;
    // Same machine, same clock. A message without a timestamp (an older
    // build in another tab) counts as fresh.
    const fresh = typeof data.at !== "number" || Math.abs(Date.now() - data.at) < FRESH_CLEAR_MS;
    onCleared({ fresh });
  };
  ch.addEventListener("message", onMessage);
  return () => ch.removeEventListener("message", onMessage);
}
