/**
 * Hand-off target: a hypothesis to test.
 *
 * Adds a drafted hypothesis to the Hypothesis Tracker's document
 * (`hypothesisTracker:current`), newest first as the tracker adds its own:
 * the item's title fills the "We believe" line (the tracker's label holds
 * the words), its description the "To learn" line, and `src.hypothesis`
 * what we'll do, the experiment and the success metric when the source
 * has them (a riskiest assumption's test idea, an experiment's text). The
 * tracker asks for the rest ("Needs detail"). Keeps `sourceRef` (a
 * riskiest assumption, a complex Cynefin item, an experiment on the
 * opportunity tree, a Design Sprint finding).
 *
 * The hypothesis itself is built by lib/hypotheses/model
 * (hypothesisFromSource), which the agent actions call on the server too.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hypothesis, HypothesisTracker } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  HYPOTHESIS_TEXT_MAX,
  HYPOTHESIS_TRACKER_ID,
  hypothesisFromSource,
  isResolved,
} from "@/lib/hypotheses/model";
import type { HandoffRoute, HandoffSource } from "../types";

/** The tracker's document id and text cap, defined with the hypothesis model; re-exported for older callers. */
export { HYPOTHESIS_TEXT_MAX, HYPOTHESIS_TRACKER_ID };

export function currentHypothesisTracker(): HypothesisTracker | undefined {
  return (useWorkspaceStore.getState().hypothesisTrackers ?? []).find(
    (d) => d.id === HYPOTHESIS_TRACKER_ID
  );
}

function updateTracker(update: (hypotheses: Hypothesis[]) => Hypothesis[]): void {
  const hypotheses = currentHypothesisTracker()?.hypotheses ?? [];
  useWorkspaceStore
    .getState()
    .upsertHypothesisTracker({ id: HYPOTHESIS_TRACKER_ID, hypotheses: update(hypotheses) });
}

/** The drafted hypothesis a send makes, raised today (the browser's day). */
export function buildHypothesis(src: HandoffSource, id = nanoid(8)): Hypothesis {
  return hypothesisFromSource(src, id, todayLocalISO());
}

const find = (id: string) => currentHypothesisTracker()?.hypotheses.find((h) => h.id === id);

export const hypothesisRoute: HandoffRoute = {
  id: "hypothesis",
  label: "Hypothesis",
  doneLabel: "Added as a hypothesis",
  targetToolId: "hypothesis-tracker",
  targetHref: () => "/hypothesis-tracker",
  send: (src) => {
    const h = buildHypothesis(src);
    updateTracker((list) => [h, ...list]);
    return h.id;
  },
  remove: (id) => {
    if (!find(id)) return;
    updateTracker((list) => list.filter((h) => h.id !== id));
  },
  exists: (id) => Boolean(find(id)),
  // Tested either way: validated, invalidated or inconclusive.
  isDone: (id) => isResolved(find(id)?.status),
};
