/**
 * Hand-off target: an epic on the Epic Roadmap.
 *
 * A send adds an epic to the roadmap's document (`epicRoadmap:current`),
 * starting the document when there is none: next quarter, in the first
 * colour no epic uses yet, keeping where it came from (`sourceRef`: an impact
 * map's deliverable, a strategy tree's initiative), as
 * lib/roadmap/epic-source builds it. It is done once the epic is, as the
 * roadmap rolls it up from its stories. P2.4 owns it after the base,
 * keeping its exports.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { EpicRoadmap } from "@/lib/stores/workspace-types";
import { EPIC_ROADMAP_ID, buildEpicFromSource } from "@/lib/roadmap/epic-source";
import { epicRollup, linkedStories } from "@/lib/roadmap/rollup";
import type { HandoffRoute } from "../types";

/** Where "Open" goes for an epic: the Epic Roadmap, with that epic open. */
export function epicHref(id: string): string {
  return `/epic-roadmap?epic=${encodeURIComponent(id)}`;
}

const roadmap = (): EpicRoadmap | undefined =>
  (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === EPIC_ROADMAP_ID);

const find = (id: string) => roadmap()?.epics.find((e) => e.id === id);

export const epicRoute: HandoffRoute = {
  id: "epic",
  label: "Epic on the roadmap",
  doneLabel: "Put on the roadmap",
  targetToolId: "epic-roadmap",
  targetHref: epicHref,
  send: (src) => {
    const doc = roadmap() ?? { id: EPIC_ROADMAP_ID, epics: [] };
    const epic = buildEpicFromSource(src, doc.epics);
    useWorkspaceStore.getState().upsertEpicRoadmap({ ...doc, epics: [...doc.epics, epic] });
    return epic.id;
  },
  remove: (id) => {
    const doc = roadmap();
    if (!doc || !doc.epics.some((e) => e.id === id)) return;
    useWorkspaceStore
      .getState()
      .upsertEpicRoadmap({ ...doc, epics: doc.epics.filter((e) => e.id !== id) });
  },
  exists: (id) => Boolean(find(id)),
  isDone: (id) => {
    const epic = find(id);
    if (!epic) return false;
    return epicRollup(epic, linkedStories(epic.id, useWorkspaceStore.getState().stories)).done;
  },
};
