/**
 * Hand-off target: a hypothesis to test.
 *
 * Adds a drafted hypothesis to the Hypothesis Tracker's document
 * (`hypothesisTracker:current`), newest first as the tracker adds its own:
 * the item becomes "We believe …", its description the "To learn" line, and
 * the tracker asks for the rest (what we'll do, the success metric). Keeps
 * `sourceRef` (a riskiest assumption, a complex Cynefin item, an experiment
 * on the opportunity tree).
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hypothesis, HypothesisTracker } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { HandoffRoute, HandoffSource } from "../types";

/** MUST match HT_ID in hypothesis-tracker-client.tsx and src/lib/actions/tools/hypothesis-tracker.ts. */
export const HYPOTHESIS_TRACKER_ID = "hypothesisTracker:current";

export const HYPOTHESIS_TEXT_MAX = 1000;

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

export function buildHypothesis(src: HandoffSource, id = nanoid(8)): Hypothesis {
  return {
    id,
    believe: src.title.trim().slice(0, HYPOTHESIS_TEXT_MAX),
    willDo: "",
    toLearn: (src.description ?? "").trim().slice(0, HYPOTHESIS_TEXT_MAX),
    successMetric: "",
    status: "drafted",
    raisedAt: todayLocalISO(),
    sourceRef: src.sourceRef,
  };
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
  isDone: (id) => {
    const status = find(id)?.status;
    return status === "validated" || status === "invalidated" || status === "inconclusive";
  },
};
