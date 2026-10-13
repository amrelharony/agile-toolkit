"use client";

import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import { useIsOwner, useOwnerState, OWNER_SEEN_KEY } from "@/lib/auth/use-is-owner";
import { useHistoryStore } from "@/lib/history/history-store";
import { resetKudosBackfillLatch } from "@/lib/kudos/backfill";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { emptyWorkspace } from "@/lib/stores/workspace-types";
import { clearLocalWorkspaceData } from "@/lib/utils/clear-local-data";
import { hasUnsyncedBlobData, isPreferenceBlob, subscribeUnsyncedBlobs } from "./unsynced-blobs";

/**
 * Shared-browser gate for owner-only cloud sync (CloudSyncProvider,
 * HistorySyncProvider, the kudos owner bridge).
 *
 * The site is public, so the owner and visitors can use the same browser.
 * Sync is local-first: once it starts, whatever sits in local storage gets
 * pushed to the owner's cloud workspace (anonymous history events are
 * stamped with the owner's id, local kudos are backfilled). That must not
 * happen silently for work a visitor created. So:
 *
 *   - While the app runs as a confirmed visitor (settled, not the owner,
 *     and not merely awaiting an owner re-check), the first write to the
 *     workspace or history store, or to a blob-synced tool (usePersisted),
 *     sets the `agile-toolkit:visitor-used` marker (useVisitorDataTracker,
 *     mounted once from the header).
 *   - When the owner is verified on a browser with the marker AND local
 *     data, the gate stays closed and the "Work created while signed out"
 *     dialog asks: merge it into the cloud workspace, or discard it?
 *   - Merge clears the marker and opens the gate; the existing
 *     stamp-and-push behaviour then uploads the data (blob-synced tools
 *     are merged with their cloud rows, see unsynced-blobs.ts, and the
 *     kudos backfill runs again). Discard clears all
 *     local data (other tabs reload) and keeps the gate closed until the
 *     caller reloads — the in-memory stores still hold the visitor's data,
 *     and opening the gate before the reload would upload it anyway.
 *
 * Sync consumers gate on `useOwnerSyncGate()`, never on `useIsOwner()`.
 */

export const VISITOR_USED_KEY = "agile-toolkit:visitor-used";

/**
 * unchecked  — no owner yet, or the owner was just verified
 * pending    — waiting for the owner's merge/discard answer
 * resolved   — nothing to ask, or the owner chose merge
 * discarding — local data cleared; waiting for the page reload
 */
export type VisitorDataDecision = "unchecked" | "pending" | "resolved" | "discarding";

interface OwnerSyncGateState {
  decision: VisitorDataDecision;
  /** The dialog can be closed without answering ("decide later"); sync
   *  stays paused and the header notice offers to reopen it. */
  promptOpen: boolean;
}

export const useOwnerSyncGateStore = create<OwnerSyncGateState>(() => ({
  decision: "unchecked",
  promptOpen: false,
}));

// ───────── storage markers ─────────

const markerListeners = new Set<() => void>();

function notifyMarkers() {
  markerListeners.forEach((l) => l());
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function subscribeMarkers(onChange: () => void): () => void {
  markerListeners.add(onChange);
  // Another tab setting or clearing a marker (or clearing everything).
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === OWNER_SEEN_KEY || e.key === VISITOR_USED_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    markerListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function hasVisitorMarker(): boolean {
  return readFlag(VISITOR_USED_KEY);
}

function setVisitorMarker(): void {
  try {
    window.localStorage.setItem(VISITOR_USED_KEY, "1");
  } catch {
    /* storage blocked: nothing persists for a later sign-in to merge */
  }
  notifyMarkers();
}

function clearVisitorMarker(): void {
  try {
    window.localStorage.removeItem(VISITOR_USED_KEY);
  } catch {
    /* storage blocked */
  }
  notifyMarkers();
}

/**
 * True once the verified owner has used this browser. The visitor UI uses
 * it to say "Sign in to sync" after the owner's session lapses.
 */
export function useOwnerSeen(): boolean {
  return useSyncExternalStore(
    subscribeMarkers,
    () => readFlag(OWNER_SEEN_KEY),
    () => false
  );
}

// ───────── local data probe ─────────

const WORKSPACE_DATA_KEYS = Object.keys(emptyWorkspace);

function isFilled(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

/**
 * Whether this browser holds anything a merge would upload: workspace
 * entities (incl. kudos), history events not yet attributed to a user, or
 * blob-synced tool data edited while sync was off.
 */
export function hasLocalVisitorData(): boolean {
  if (hasUnsyncedBlobData()) return true;
  // Not hydrated yet means "can't tell" — ask rather than merge silently.
  if (!useWorkspaceStore.persist.hasHydrated()) return true;
  const ws = useWorkspaceStore.getState() as unknown as Record<string, unknown>;
  if (WORKSPACE_DATA_KEYS.some((k) => isFilled(ws[k]))) return true;
  return useHistoryStore.getState().events.some((e) => e.userId === null);
}

const WORKSPACE_STORE_KEY = "agile-toolkit:workspace";
const HISTORY_STORE_KEY = "agile-toolkit:history";

/** A zustand-persist blob's `state`: null when absent, undefined when unreadable. */
function persistedState(key: string): Record<string, unknown> | null | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const state = (parsed as { state?: unknown } | null)?.state;
    return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
  } catch {
    return undefined;
  }
}

/**
 * The same question asked of localStorage, which every tab shares. This
 * tab's in-memory stores can be stale — the history store never re-reads
 * another tab's writes — so a tab opened before a visitor worked in
 * another one would otherwise see "nothing to merge" and drop the marker.
 * Unreadable storage counts as data: ask rather than merge silently.
 */
function hasPersistedVisitorData(): boolean {
  const history = persistedState(HISTORY_STORE_KEY);
  const workspace = persistedState(WORKSPACE_STORE_KEY);
  if (history === undefined || workspace === undefined) return true;
  const events = history?.events;
  if (
    Array.isArray(events) &&
    events.some((e) => (e as { userId?: unknown } | null)?.userId === null)
  ) {
    return true;
  }
  return !!workspace && WORKSPACE_DATA_KEYS.some((k) => isFilled(workspace[k]));
}

// ───────── decision actions ─────────

function evaluate(): void {
  if (useOwnerSyncGateStore.getState().decision !== "unchecked") return;
  if (!hasVisitorMarker()) {
    useOwnerSyncGateStore.setState({ decision: "resolved" });
    return;
  }
  if (!hasLocalVisitorData() && !hasPersistedVisitorData()) {
    // The visitor wrote something and later removed it: nothing to merge.
    clearVisitorMarker();
    useOwnerSyncGateStore.setState({ decision: "resolved" });
    return;
  }
  useOwnerSyncGateStore.setState({ decision: "pending", promptOpen: true });
}

/** Keep the visitor's work: upload it to the owner's cloud workspace. */
export function mergeVisitorData(): void {
  if (useOwnerSyncGateStore.getState().decision !== "pending") return;
  clearVisitorMarker();
  // Kudos sent while signed out never reached the cloud-sync queue (it
  // only runs for the owner); the backfill is what uploads them. Its
  // per-tab latch may still be set from an earlier owner session in this
  // tab (sessionStorage survives the OAuth round trip), so re-arm it before
  // the gate opens and the owner bridge runs it.
  resetKudosBackfillLatch();
  useOwnerSyncGateStore.setState({ decision: "resolved", promptOpen: false });
}

/**
 * Drop the visitor's work: clear all local data (other tabs reload) and
 * keep the gate closed. The caller reloads this tab; afterwards there is no
 * marker, so the gate opens and the owner's cloud workspace pulls into an
 * empty browser.
 */
export function discardVisitorData(): void {
  if (useOwnerSyncGateStore.getState().decision !== "pending") return;
  useOwnerSyncGateStore.setState({ decision: "discarding", promptOpen: false });
  clearLocalWorkspaceData({ broadcast: true });
  notifyMarkers();
}

export function setVisitorDataPromptOpen(open: boolean): void {
  const { decision } = useOwnerSyncGateStore.getState();
  if (decision !== "pending") return;
  useOwnerSyncGateStore.setState({ promptOpen: open });
}

// ───────── hooks ─────────

/**
 * True only when the verified owner is signed in AND no merge/discard
 * question is outstanding — the moment owner-only cloud sync may start.
 */
export function useOwnerSyncGate(): boolean {
  const { isOwner, settled } = useOwnerState();
  const decision = useOwnerSyncGateStore((s) => s.decision);

  // Idempotent, so every gate consumer may run it. A non-owner resets the
  // decision so a later sign-in in the same page session asks again.
  useEffect(() => {
    if (isOwner) evaluate();
    else if (settled && useOwnerSyncGateStore.getState().decision !== "discarding") {
      useOwnerSyncGateStore.setState({ decision: "unchecked", promptOpen: false });
    }
  }, [isOwner, settled]);

  return isOwner && decision === "resolved";
}

/** The owner owes an answer about work created while signed out. */
export function useVisitorDataPending(): boolean {
  const isOwner = useIsOwner();
  const decision = useOwnerSyncGateStore((s) => s.decision);
  return isOwner && decision === "pending";
}

/**
 * Sets the visitor marker on the first write a confirmed visitor makes to
 * the workspace or history store, or to a blob-synced tool. Not while an
 * owner check is merely unanswered (OWNER_UNVERIFIED): that session is
 * almost always the owner's, and its writes sync once the retry confirms
 * it. Mount once (the header does).
 */
export function useVisitorDataTracker(): void {
  const { visitor } = useOwnerState();

  useEffect(() => {
    if (!visitor || hasVisitorMarker()) return;
    let done = false;
    const unsubs: Array<() => void> = [];
    const stop = () => {
      done = true;
      unsubs.forEach((u) => u());
    };
    const mark = () => {
      if (done) return;
      stop();
      setVisitorMarker();
    };
    unsubs.push(
      useWorkspaceStore.subscribe((s, prev) => {
        // The skipHydration rehydrate also fires subscribers; loading what
        // is already stored is not a write.
        if (!useWorkspaceStore.persist.hasHydrated()) return;
        const curr = s as unknown as Record<string, unknown>;
        const before = prev as unknown as Record<string, unknown>;
        if (WORKSPACE_DATA_KEYS.some((k) => curr[k] !== before[k])) mark();
      }),
      // Only `events` — sync status, cursors and the client id change
      // without the visitor doing anything.
      useHistoryStore.subscribe((s, prev) => {
        if (s.events !== prev.events) mark();
      }),
      // usePersisted tools and other blob stores (UI preferences aside).
      subscribeUnsyncedBlobs((storeKey) => {
        if (!isPreferenceBlob(storeKey)) mark();
      })
    );
    return stop;
  }, [visitor]);
}
