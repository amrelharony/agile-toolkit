"use client";

import { useEffect, useState } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { findRosterMember } from "./names";

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

// Pure, so they live in names.ts (server code imports them from there).
export { nameKey, findRosterMember } from "./names";

/**
 * Add a person to the workspace roster, or return the member who already
 * has that name. Tools call this only when the user asks for it ("Add to
 * the team") — typing a name somewhere must never change the team.
 */
export function addToRoster(name: string): TeamMember {
  const { teamMembers, upsertTeamMember } = useWorkspaceStore.getState();
  const existing = findRosterMember(teamMembers ?? EMPTY_ROSTER, name);
  if (existing) return existing;
  const member: TeamMember = { id: `member_${crypto.randomUUID()}`, name: name.trim() };
  upsertTeamMember(member);
  return member;
}
