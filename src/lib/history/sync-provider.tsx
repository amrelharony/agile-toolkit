"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOwnerSyncGate } from "@/lib/sync/owner-sync-gate";
import { useHistoryStore } from "./history-store";
import { pushEvents, pullEvents, nextPullCursor, subscribeToHistory } from "./sync";

const PUSH_DEBOUNCE_MS = 800;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000; // 5 min cap

/**
 * Drives cloud sync for the history store.
 *
 * Lifecycle:
 *   - On `SIGNED_IN`: stamp anonymous local events with userId, push them,
 *     then pull anything newer from cloud, then subscribe to realtime.
 *     "Signed in" is the owner sync gate (see owner-sync-gate.ts): the
 *     verified owner, after any "work created while signed out: merge or
 *     discard?" question is answered. The anonymous-event stamp therefore
 *     only ever runs for events the owner chose to keep.
 *   - On `SIGNED_OUT`: stop the realtime channel; keep local events.
 *   - On every store change (debounced): push any new events with userId
 *     that aren't yet `syncedAt` set.
 *   - On push error: exponential backoff (1s → 2s → 4s … capped at 5 min)
 *     instead of a tight retry loop.
 *   - On realtime reconnect: pull events that arrived during the gap.
 */
export function HistorySyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const gateOpen = useOwnerSyncGate();
  const userId = user?.id ?? null;
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track consecutive failures for exponential backoff.
  const failureCountRef = useRef(0);
  // When non-null, no new push is scheduled until this timestamp passes.
  const backoffUntilRef = useRef<number>(0);

  const setSyncStatus = useHistoryStore((s) => s.setSyncStatus);
  const setLastSyncAt = useHistoryStore((s) => s.setLastSyncAt);
  const addEvents = useHistoryStore((s) => s.addEvents);
  const markSynced = useHistoryStore((s) => s.markSynced);
  const setUserOnAnonymousEvents = useHistoryStore((s) => s.setUserOnAnonymousEvents);

  // Initial sign-in / sign-out handling
  useEffect(() => {
    if (unsubscribeRef.current && lastUserIdRef.current !== userId) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!gateOpen || !userId) {
      lastUserIdRef.current = null;
      setSyncStatus("idle");
      failureCountRef.current = 0;
      backoffUntilRef.current = 0;
      return;
    }

    lastUserIdRef.current = userId;

    let cancelled = false;

    const fullPullAndPush = async (reason: "initial" | "reconnect") => {
      if (cancelled) return;
      setSyncStatus("syncing");
      try {
        // Stamp anonymous events with userId on the initial run.
        const stamped = reason === "initial" ? setUserOnAnonymousEvents(userId) : [];
        const allEvents = useHistoryStore.getState().events;
        // Owner client only re-pushes events it authored itself; guest-
        // authored rows (squadProfileId !== null) arrive via realtime
        // onInsert and never need re-pushing. Without this filter, a
        // guest-authored event sitting in the local store with a null
        // syncedAt could be re-emitted by the owner — and since the
        // owner has no permission to claim guest attribution, the DB
        // would either reject it (with the H13 policy) or accept a
        // forged row (pre-policy).
        const unsynced = allEvents.filter(
          (e) => e.userId === userId && !e.syncedAt && e.squadProfileId == null
        );
        const stampedIds = new Set(stamped.map((e) => e.clientEventId));
        const toPush = [...stamped, ...unsynced.filter((e) => !stampedIds.has(e.clientEventId))];
        if (toPush.length > 0) {
          const written = await pushEvents(toPush, userId);
          if (written.length > 0) {
            markSynced(written, new Date().toISOString());
          }
        }

        const since = useHistoryStore.getState().lastSyncAt;
        const pulled = await pullEvents(userId, since);
        if (cancelled) return;
        if (pulled.length > 0) addEvents(pulled);
        // Advance the cursor to the newest server `created_at` we actually
        // pulled — NOT the client clock, which skips events under clock skew
        // (see nextPullCursor). Unchanged when nothing was pulled.
        const cursor = nextPullCursor(pulled, since);
        if (cursor) setLastSyncAt(cursor);
        setSyncStatus("idle");
        failureCountRef.current = 0;
        backoffUntilRef.current = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failureCountRef.current += 1;
        const wait = Math.min(
          BACKOFF_BASE_MS * 2 ** Math.min(failureCountRef.current - 1, 8),
          BACKOFF_MAX_MS
        );
        backoffUntilRef.current = Date.now() + wait;
        setSyncStatus("error", msg);
      }
    };

    void fullPullAndPush("initial").then(() => {
      if (cancelled) return;
      unsubscribeRef.current = subscribeToHistory({
        userId,
        onInsert: (event) => addEvents([event]),
        onResubscribe: () => {
          // Backfill events that arrived while we were disconnected.
          void fullPullAndPush("reconnect");
        },
        onError: (err) => {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[history] realtime error", err);
          }
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    gateOpen,
    userId,
    addEvents,
    markSynced,
    setLastSyncAt,
    setSyncStatus,
    setUserOnAnonymousEvents,
  ]);

  // Debounced push on store changes.
  useEffect(() => {
    if (!gateOpen || !userId) return;
    const unsub = useHistoryStore.subscribe((s, prev) => {
      if (s.events === prev.events) return;
      const newOnes = s.events.filter(
        (e) => e.userId === userId && !e.syncedAt && e.squadProfileId == null
      );
      if (newOnes.length === 0) return;
      // Respect the backoff window: don't schedule a push until we're past it.
      const now = Date.now();
      const delay =
        backoffUntilRef.current > now ? backoffUntilRef.current - now : PUSH_DEBOUNCE_MS;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      pushTimerRef.current = setTimeout(() => {
        void (async () => {
          // Re-read at fire time so we push the freshest set.
          const fresh = useHistoryStore
            .getState()
            .events.filter((e) => e.userId === userId && !e.syncedAt && e.squadProfileId == null);
          if (fresh.length === 0) return;
          try {
            const written = await pushEvents(fresh, userId);
            if (written.length > 0) {
              markSynced(written, new Date().toISOString());
            }
            failureCountRef.current = 0;
            backoffUntilRef.current = 0;
            setSyncStatus("idle");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failureCountRef.current += 1;
            const wait = Math.min(
              BACKOFF_BASE_MS * 2 ** Math.min(failureCountRef.current - 1, 8),
              BACKOFF_MAX_MS
            );
            backoffUntilRef.current = Date.now() + wait;
            setSyncStatus("error", msg);
          }
        })();
      }, delay);
    });
    return () => {
      unsub();
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [gateOpen, userId, markSynced, setSyncStatus]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  return <>{children}</>;
}
