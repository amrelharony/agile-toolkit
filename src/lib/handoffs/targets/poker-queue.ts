/**
 * Hand-off target: the Planning Poker queue.
 *
 * Stories waiting for estimation live on the estimate log singleton
 * (`pokerEstimationLog:current`, its `queue`), not in the realtime session:
 * the session payload and its validator stay as they are. The host pulls
 * queued stories into a session, and an accepted estimate is written back
 * to where the story came from (see ../poker-writeback.ts).
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PokerEstimationLog, PokerQueueItem } from "@/lib/stores/workspace-types";
import type { HandoffRoute, HandoffSource } from "../types";

/** MUST match PE_ID in src/lib/actions/tools/planning-poker.ts. */
export const POKER_LOG_ID = "pokerEstimationLog:current";

/** The session validator's caps on a story's title and description. */
export const POKER_TITLE_MAX = 500;
export const POKER_DESCRIPTION_MAX = 5000;

export function currentPokerLog(): PokerEstimationLog | undefined {
  return (useWorkspaceStore.getState().pokerEstimationLogs ?? []).find(
    (d) => d.id === POKER_LOG_ID
  );
}

/** Write the log, reading it fresh first; `update` gets the current doc. */
export function updatePokerLog(update: (doc: PokerEstimationLog) => PokerEstimationLog): void {
  const doc = currentPokerLog() ?? { id: POKER_LOG_ID, estimates: [] };
  useWorkspaceStore.getState().upsertPokerEstimationLog({ ...update(doc), id: POKER_LOG_ID });
}

export function buildQueueItem(src: HandoffSource, id = crypto.randomUUID()): PokerQueueItem {
  const description = (src.description ?? "").trim().slice(0, POKER_DESCRIPTION_MAX);
  return {
    id,
    title: src.title.trim().slice(0, POKER_TITLE_MAX),
    ...(description ? { description } : {}),
    sourceRef: src.sourceRef,
    queuedAt: new Date().toISOString(),
  };
}

export const pokerQueueRoute: HandoffRoute = {
  id: "poker-queue",
  label: "Planning Poker",
  doneLabel: "Queued for Planning Poker",
  targetToolId: "planning-poker",
  targetHref: () => "/planning-poker",
  send: (src) => {
    const item = buildQueueItem(src);
    updatePokerLog((doc) => ({ ...doc, queue: [...(doc.queue ?? []), item] }));
    return item.id;
  },
  remove: (id) => {
    if (!currentPokerLog()?.queue?.some((q) => q.id === id)) return;
    updatePokerLog((doc) => ({ ...doc, queue: (doc.queue ?? []).filter((q) => q.id !== id) }));
  },
  // Still queued, or estimated already: the write-back logs the estimate
  // under the queue item's id.
  exists: (id) => {
    const doc = currentPokerLog();
    return Boolean(
      doc?.queue?.some((q) => q.id === id) || (doc?.estimates ?? []).some((e) => e.id === id)
    );
  },
};
