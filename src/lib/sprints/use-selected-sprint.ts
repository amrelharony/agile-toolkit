"use client";

/**
 * Which sprint the sprint tools are looking at. One choice is shared by
 * Burndown, Burnup, Velocity, Sprint Comparison and the Sprint Metrics hub:
 * pick a sprint in one and the others open on it.
 *
 * Order: a `?sprint=<id>` link, then the choice remembered in this browser,
 * then the active sprint, then the newest. A choice that no longer exists
 * (the sprint was deleted) falls through to the next.
 */

import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { sprintsNewestFirst } from "./series";

export const SELECTED_SPRINT_KEY = "agile-toolkit:sprint-metrics:selected";
export const SPRINT_PARAM = "sprint";

const NO_SPRINTS: Sprint[] = [];

/** The choice, shared by every sprint tool in this tab. */
const useSprintChoice = create<{ id: string | null; set: (id: string | null) => void }>((set) => ({
  id: null,
  set: (id) => set({ id }),
}));

/** Test helper: forget the in-memory choice. */
export function resetSelectedSprint(): void {
  useSprintChoice.setState({ id: null });
}

function readPref(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_SPRINT_KEY);
  } catch {
    return null;
  }
}

function writePref(id: string): void {
  try {
    window.localStorage.setItem(SELECTED_SPRINT_KEY, id);
  } catch {
    /* private mode or full storage: the choice lasts this visit only */
  }
}

/** `?sprint=<id>` from a query string, or null. */
export function readSprintParam(search: string): string | null {
  const v = new URLSearchParams(search).get(SPRINT_PARAM);
  return v && v.length <= 128 ? v : null;
}

/** A link to `path` that opens on `sprintId`. */
export function sprintHref(path: string, sprintId: string | undefined): string {
  return sprintId ? `${path}?${SPRINT_PARAM}=${encodeURIComponent(sprintId)}` : path;
}

/** The chosen sprint if it exists, else the active one, else the newest (not cancelled). */
export function pickDefaultSprint(
  sprints: readonly Sprint[],
  chosenId: string | null
): Sprint | undefined {
  if (chosenId) {
    const chosen = sprints.find((s) => s.id === chosenId);
    if (chosen) return chosen;
  }
  const newest = sprintsNewestFirst(sprints);
  return (
    newest.find((s) => s.status === "active") ??
    newest.find((s) => s.status !== "cancelled") ??
    newest[0]
  );
}

export interface SelectedSprint {
  /** Every sprint, newest first. */
  sprints: Sprint[];
  selected: Sprint | undefined;
  /** Choose a sprint here and in every other sprint tool. */
  select: (id: string) => void;
}

export function useSelectedSprint(): SelectedSprint {
  const sprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const chosen = useSprintChoice((s) => s.id);
  const setChosen = useSprintChoice((s) => s.set);

  // On arrival: a ?sprint= link wins, else the choice remembered here.
  useEffect(() => {
    const fromUrl = readSprintParam(window.location.search);
    if (fromUrl) {
      setChosen(fromUrl);
      writePref(fromUrl);
      return;
    }
    if (useSprintChoice.getState().id === null) {
      const pref = readPref();
      if (pref) setChosen(pref);
    }
  }, [setChosen]);

  const ordered = useMemo(() => sprintsNewestFirst(sprints), [sprints]);
  const selected = useMemo(() => pickDefaultSprint(sprints, chosen), [sprints, chosen]);

  const select = useCallback(
    (id: string) => {
      setChosen(id);
      writePref(id);
      // Keep a ?sprint= link in the address bar pointing at the new choice,
      // so a refresh doesn't jump back to the sprint the link named.
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has(SPRINT_PARAM)) {
          url.searchParams.set(SPRINT_PARAM, id);
          window.history.replaceState(window.history.state, "", url);
        }
      } catch {
        /* no history API: the in-memory choice still applies */
      }
    },
    [setChosen]
  );

  return { sprints: ordered, selected, select };
}
