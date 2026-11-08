"use client";

/**
 * History log → XP ledger. The history log already records finished work
 * with ids (a retro reaching Actions, a risk closed, a sprint closed), so
 * outcomes are read from it instead of from clicks.
 *
 * Only events this browser just wrote count:
 *   - `clientId` is our own (cloud pulls from other devices are skipped);
 *   - no `squadProfileId` (a squad guest's work isn't the owner's XP);
 *   - it happened less than 60 s ago (rehydrated or backfilled events don't
 *     pay; clock skew past 60 s drops an outcome but never overpays).
 * Each is recorded with its entity key, or `h:<event id>`, so a replay can't
 * pay twice.
 */

import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import { matchHistoryOutcome } from "./outcomes";
import { recordOutcome } from "./ledger";

/** Events older than this when they reach the bridge don't pay. */
export const OUTCOME_MAX_AGE_MS = 60_000;

/** How far back from the tail a single store change is scanned. */
const TAIL_SCAN = 50;

/** True when a history event may pay outcome XP on this browser now. */
export function isFreshOwnEvent(
  e: HistoryEvent,
  ownClientId: string | null,
  now: number = Date.now()
): boolean {
  if (!ownClientId || e.clientId !== ownClientId) return false;
  if (e.squadProfileId) return false;
  const at = Date.parse(e.occurredAt);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age >= -OUTCOME_MAX_AGE_MS && age < OUTCOME_MAX_AGE_MS;
}

let detach: (() => void) | null = null;

export function installOutcomeBridge(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (detach) return detach;

  const seen = new Set<string>();
  const markAll = (events: HistoryEvent[]) => {
    for (const e of events) seen.add(e.id);
  };
  // Whatever is in the log at install time, or arrives by rehydration, is
  // the past: it never pays.
  markAll(useHistoryStore.getState().events);
  const unsubHydrate = useHistoryStore.persist?.onFinishHydration?.((s) => markAll(s.events));

  const onEvents = (events: HistoryEvent[]) => {
    const fresh: HistoryEvent[] = [];
    for (let i = events.length - 1, n = 0; i >= 0 && n < TAIL_SCAN; i--, n++) {
      const e = events[i];
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      fresh.push(e);
    }
    if (fresh.length === 0) return;
    const { clientId } = useHistoryStore.getState();
    const now = Date.now();
    for (const e of fresh.reverse()) {
      if (!isFreshOwnEvent(e, clientId, now)) continue;
      const match = matchHistoryOutcome(e);
      if (!match) continue;
      recordOutcome(match.id, {
        key: match.key,
        at: e.occurredAt,
        meta: { toolId: e.toolId, action: e.action },
      });
    }
    // Keep the seen set from growing past the log itself.
    if (seen.size > 4 * events.length + 100) {
      seen.clear();
      markAll(events);
    }
  };

  const unsub = useHistoryStore.subscribe((s, prev) => {
    if (s.events === prev.events) return;
    // persist writes the stored log with `set()` before its finish-hydration
    // listeners run, so a rehydrate (a backup restore, another tab) reaches
    // this subscriber first. Those events are the past too.
    const persist = useHistoryStore.persist;
    if (persist && !persist.hasHydrated()) {
      markAll(s.events);
      return;
    }
    onEvents(s.events);
  });

  detach = () => {
    unsub();
    unsubHydrate?.();
    detach = null;
  };
  return detach;
}
