"use client";

import { useMemo } from "react";
import { useHistoryStore } from "./history-store";
import type { HistoryEvent, ToolId } from "./types";

interface UseHistoryOptions {
  toolId?: ToolId;
  /** Cap on events returned (newest first). Default: no cap. */
  limit?: number;
  /** Filter to events with `occurredAt >= since`. ISO 8601 string. */
  since?: string;
  /** When true, filter to milestones only (used by replay UI). */
  milestonesOnly?: boolean;
}

export interface UseHistoryResult {
  events: HistoryEvent[];
  total: number;
}

/**
 * Read-side hook for the history store. Returns events newest-first,
 * optionally filtered by tool / time / milestone.
 *
 * Phase 3 will extend this with cloud-backed pagination; for now it reads
 * straight from the local Zustand store.
 */
export function useHistory(opts: UseHistoryOptions = {}): UseHistoryResult {
  const allEvents = useHistoryStore((s) => s.events);

  return useMemo(() => {
    let filtered = allEvents;
    if (opts.toolId) {
      filtered = filtered.filter((e) => e.toolId === opts.toolId);
    }
    if (opts.since) {
      filtered = filtered.filter((e) => e.occurredAt >= opts.since!);
    }
    if (opts.milestonesOnly) {
      filtered = filtered.filter((e) => e.isMilestone);
    }
    // Newest first.
    const sorted = [...filtered].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt)
    );
    const total = sorted.length;
    const events =
      typeof opts.limit === "number" ? sorted.slice(0, opts.limit) : sorted;
    return { events, total };
  }, [allEvents, opts.toolId, opts.since, opts.milestonesOnly, opts.limit]);
}
