/**
 * What a product canvas hands to other tools: each a HandoffSource whose
 * `sourceRef` names the line and, in `doc`, its canvas, so the target's
 * "From product canvas" link opens that canvas (`?canvas=<id>`).
 *
 *   a guess on any canvas   → the Hypothesis Tracker, to test it
 *   a Lean UX hypothesis    → the Hypothesis Tracker, with what we'll do,
 *                             the smallest test and the outcome to watch
 *
 * No owner, requester or other name goes with a send. Pure and
 * server-safe.
 */

import { believeLine } from "@/lib/hypotheses/model";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { ProductCanvas, ProductCanvasItem } from "@/lib/stores/workspace-types";
import { hypothesisPicks, lineLinkedTo } from "./model";

/** A guess (a line in an evidence box) sent to be tested: its words are the "We believe". */
export function guessHypothesisSource(
  canvas: ProductCanvas,
  item: ProductCanvasItem
): HandoffSource {
  return {
    title: believeLine(item.text),
    sourceRef: { tool: "product-canvas", id: item.id, doc: canvas.id },
  };
}

/**
 * A Lean UX hypothesis sent to be tested: the sentence is the "We
 * believe", its learn-first line the "To learn", its solution what we'll
 * do, its smallest test the experiment and its outcome the success metric.
 * Parts it doesn't have stay blank for the tracker to ask.
 */
export function leanUxHypothesisSource(
  canvas: ProductCanvas,
  item: ProductCanvasItem
): HandoffSource {
  const picks = hypothesisPicks(canvas, item);
  const learn = lineLinkedTo(canvas, "learn-first", item.id)?.text.trim();
  const test = lineLinkedTo(canvas, "smallest-test", item.id)?.text.trim();
  const hypothesis: NonNullable<HandoffSource["hypothesis"]> = {};
  const willDo = picks.solutions?.text.trim();
  const metric = picks.outcomes?.text.trim();
  if (willDo) hypothesis.willDo = willDo;
  if (test) hypothesis.experiment = test;
  if (metric) hypothesis.successMetric = metric;
  return {
    title: believeLine(item.text),
    ...(learn ? { description: learn } : {}),
    ...(Object.keys(hypothesis).length > 0 ? { hypothesis } : {}),
    sourceRef: { tool: "product-canvas", id: item.id, doc: canvas.id },
  };
}
