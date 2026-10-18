"use client";

import { useEffect, useState } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";

/**
 * The workspace team roster (`teamMembers`): one list of people that the
 * Team page edits and Standup, Mood Tracker, Kudos, Canvas, Capacity Planner
 * and Ceremony Timer read.
 */

// A stable empty list: zustand 5 re-renders forever on a selector that
// returns a fresh array each call.
const EMPTY_ROSTER: TeamMember[] = [];

/** The roster, in store order. */
export function useTeamRoster(): TeamMember[] {
  return useWorkspaceStore((s) => s.teamMembers ?? EMPTY_ROSTER);
}

/**
 * True once the workspace has loaded from this browser's storage.
 *
 * Starts false on every render path (server and first client paint) so the
 * markup matches, then flips in an effect. Use it to hold back an empty
 * state that would otherwise flash before saved members load.
 */
export function useWorkspaceHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const persist = useWorkspaceStore.persist;
    if (!persist || persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}

/** Name key for matching people across tools: trimmed, case-insensitive. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}
