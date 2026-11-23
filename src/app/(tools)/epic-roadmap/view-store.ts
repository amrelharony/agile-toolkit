/**
 * Which view the Roadmap card shows, remembered on this device: the
 * quarterly Timeline (the default) or the Now, Next, Later board. Only the
 * view: the epics and their horizons are workspace records.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";

export const ROADMAP_VIEWS = ["timeline", "horizons"] as const;
export type RoadmapView = (typeof ROADMAP_VIEWS)[number];

export interface RoadmapViewPrefs {
  view: RoadmapView;
}

export const useRoadmapView = createPersistedStore<RoadmapViewPrefs>("epic-roadmap-view", {
  view: "timeline",
});

/** A stored view as read back: anything but the board is the timeline. */
export function readRoadmapView(value: unknown): RoadmapView {
  return value === "horizons" ? "horizons" : "timeline";
}
