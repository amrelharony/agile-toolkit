"use client";

import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { useHistoryStore } from "./history-store";
import { sanitizePayload } from "./sanitize";
import { isMilestoneAction } from "./event-actions";
import { useAuth } from "@/lib/auth/auth-provider";
import { timeTravelRegistry } from "@/lib/stores/with-time-travel";
import type { HistoryEvent, ToolId } from "./types";

interface LogOptions {
  /** Force a milestone flag regardless of catalog default. */
  milestone?: boolean;
  /** Optional snapshots used by `/insights` and replay. */
  beforeState?: unknown;
  afterState?: unknown;
  /** Override the timestamp (defaults to now). Useful for backfill/imports. */
  occurredAt?: Date;
}

export interface HistoryLogger {
  log: (action: string, payload?: Record<string, unknown>, opts?: LogOptions) => void;
  /** Per-mount nanoid — for tools that want to correlate events themselves. */
  toolRunId: string;
}

/**
 * Per-tool logger hook. Each tool calls this once at the top of its client
 * component:
 *
 *     const { log } = useHistoryLogger("retro");
 *     log(RETRO_ACTIONS.CARD_ADDED, { cardId, columnKey, text });
 *
 * The hook stamps every event with the user's id (when signed in), the
 * per-browser clientId, and a per-mount toolRunId so analytics can group
 * events by session.
 */
export function useHistoryLogger(toolId: ToolId): HistoryLogger {
  const { user, status } = useAuth();
  const toolRunIdRef = useRef<string>("");
  if (!toolRunIdRef.current) toolRunIdRef.current = nanoid();

  const ensureClientId = useHistoryStore((s) => s.ensureClientId);
  const addEvent = useHistoryStore((s) => s.addEvent);

  // Make sure clientId exists once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    ensureClientId();
  }, [ensureClientId]);

  const log = useCallback(
    (
      action: string,
      payload: Record<string, unknown> = {},
      opts: LogOptions = {}
    ) => {
      if (typeof window === "undefined") return;
      const clientId = ensureClientId();
      const id = nanoid();
      // Capture the snapshot-stack length AT EMIT TIME so the history drawer
      // can compute an exact step count for "Restore to here" later. The
      // mutation that the caller is about to issue will push a new snapshot;
      // recording it here means undoIndex == "snapshots that exist BEFORE
      // this event's mutation lands". restore-to-here = pastLength_now -
      // event.undoIndex.
      const undoIndex = timeTravelRegistry.get(toolId)?.pastLength();
      const event: HistoryEvent = {
        id,
        clientEventId: id,
        clientId,
        toolRunId: toolRunIdRef.current,
        userId: status === "authenticated" ? user?.id ?? null : null,
        toolId,
        action,
        payload: sanitizePayload(payload),
        beforeState: opts.beforeState,
        afterState: opts.afterState,
        isMilestone: opts.milestone ?? isMilestoneAction(toolId, action),
        occurredAt: (opts.occurredAt ?? new Date()).toISOString(),
        syncedAt: null,
        undoIndex,
      };
      addEvent(event);
    },
    [toolId, status, user, addEvent, ensureClientId]
  );

  return { log, toolRunId: toolRunIdRef.current };
}
