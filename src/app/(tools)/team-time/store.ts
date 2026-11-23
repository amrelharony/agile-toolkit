/**
 * Team Time's own view state (this browser only): which tab is open, the
 * clock the times are shown on and the week the strips show. The team's
 * people, polls and rotations are the workspace's; the example lives in the
 * page's memory only.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamTimePerson, TeamTimePoll, TeamTimeRotation } from "@/lib/stores/workspace-types";
import type { TeamTimeExample } from "@/lib/team-time/example";
import { isTimeZone } from "@/lib/team-time/zones";

export const TEAM_TIME_TABS = ["people", "shared", "find", "rotate", "office"] as const;
export type TeamTimeTab = (typeof TEAM_TIME_TABS)[number];

export const TAB_LABEL: Record<TeamTimeTab, string> = {
  people: "People",
  shared: "Shared hours",
  find: "Find a time",
  rotate: "Rotate",
  office: "Office days",
};

export interface TeamTimeView {
  /** The clock times are shown on: null for the viewer's own. */
  displayZone: string | null;
  tab: TeamTimeTab;
  /** Weeks from this one, for the strips. */
  weekOffset: number;
}

export const DEFAULT_VIEW: TeamTimeView = { displayZone: null, tab: "people", weekOffset: 0 };

/** The view as stored, made usable: an unknown tab or zone falls back, the week stays within a year. */
export function normalizeView(raw: unknown): TeamTimeView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tab = (TEAM_TIME_TABS as readonly unknown[]).includes(r.tab)
    ? (r.tab as TeamTimeTab)
    : DEFAULT_VIEW.tab;
  const displayZone = isTimeZone(r.displayZone) ? r.displayZone : null;
  const week = Number(r.weekOffset);
  const weekOffset = Number.isInteger(week) ? Math.max(-52, Math.min(52, week)) : 0;
  return { displayZone, tab, weekOffset };
}

export const useTeamTimeView = createPersistedStore<TeamTimeView>("team-time", DEFAULT_VIEW);

/* ── Writes ───────────────────────────────────────────────────────────── */

export interface TeamTimeRows {
  people: TeamTimePerson;
  polls: TeamTimePoll;
  rotations: TeamTimeRotation;
}
export type TeamTimeCollection = keyof TeamTimeRows;

/** Where the page writes: the workspace, or the example in its memory. */
export interface TeamTimeWriter {
  put<C extends TeamTimeCollection>(collection: C, row: TeamTimeRows[C]): void;
  remove(collection: TeamTimeCollection, id: string): void;
}

const ws = () => useWorkspaceStore.getState();

export const workspaceWriter: TeamTimeWriter = {
  put: (collection, row) => {
    if (collection === "people") ws().upsertTeamTimePerson(row as TeamTimePerson);
    else if (collection === "polls") ws().upsertTeamTimePoll(row as TeamTimePoll);
    else ws().upsertTeamTimeRotation(row as TeamTimeRotation);
  },
  remove: (collection, id) => {
    if (collection === "people") ws().removeTeamTimePerson(id);
    else if (collection === "polls") ws().removeTeamTimePoll(id);
    else ws().removeTeamTimeRotation(id);
  },
};

/** The same writes on the example (nothing reaches the workspace). */
export function exampleWriter(
  update: (fn: (ex: TeamTimeExample) => TeamTimeExample) => void
): TeamTimeWriter {
  return {
    put: (collection, row) =>
      update((ex) => {
        const list = ex[collection] as { id: string }[];
        const at = list.findIndex((x) => x.id === row.id);
        const next = at < 0 ? [...list, row] : list.map((x, i) => (i === at ? row : x));
        return { ...ex, [collection]: next };
      }),
    remove: (collection, id) =>
      update((ex) => ({
        ...ex,
        [collection]: (ex[collection] as { id: string }[]).filter((x) => x.id !== id),
      })),
  };
}
