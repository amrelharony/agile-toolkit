/**
 * What a product canvas hands to other tools: each a HandoffSource whose
 * `sourceRef` names the line and, in `doc`, its canvas, so the target's
 * "From product canvas" link opens that canvas (`?canvas=<id>`).
 *
 *   a guess on any canvas   → the Hypothesis Tracker, to test it
 *   a Lean UX hypothesis    → the Hypothesis Tracker, with what we'll do,
 *                             the smallest test and the outcome to watch
 *   an accepted idea        → a backlog story and/or an opportunity on
 *                             the Opportunity Tree (the canvas's own links)
 *   a business case         → a proposed record in the Decision Log, with
 *                             its options and the verdict as the proposal
 *   a Shape Up scope        → a backlog story
 *
 * No owner, requester or other name goes with a send: an idea's
 * description is its problem only. Pure and server-safe.
 */

import { believeLine } from "@/lib/hypotheses/model";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { ProductCanvas, ProductCanvasItem } from "@/lib/stores/workspace-types";
import { CASE_OPTIONS, VERDICT_LABEL, verdictOf } from "./fields";
import { answerOf, hypothesisPicks, lineLinkedTo } from "./model";

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

/**
 * An accepted idea, handed on as a backlog story or an opportunity: its
 * title as it is, and its problem as the description (the backlog's
 * description, the tree's evidence). Who asked never goes.
 */
export function ideaSource(canvas: ProductCanvas): HandoffSource {
  const problem = answerOf(canvas, "problem");
  return {
    title: canvas.title,
    ...(problem ? { description: problem } : {}),
    sourceRef: { tool: "product-canvas", id: canvas.id, doc: canvas.id },
  };
}

/**
 * A business case recorded in the Decision Log: "Business case: {epic}"
 * (or the canvas's name), what we expect as the context, and its options
 * weighed (go, no go, change and come back) with the verdict as the
 * proposal once there is one.
 */
export function caseDecisionSource(canvas: ProductCanvas): HandoffSource {
  const epic = answerOf(canvas, "epic") || canvas.title;
  const expect = answerOf(canvas, "expect");
  const verdict = verdictOf(canvas);
  return {
    title: `Business case: ${epic}`,
    ...(expect ? { description: expect } : {}),
    decision: {
      template: "adr",
      options: [...CASE_OPTIONS],
      ...(verdict !== "pending" ? { recommendation: VERDICT_LABEL[verdict] } : {}),
    },
    sourceRef: { tool: "product-canvas", id: canvas.id, doc: canvas.id },
  };
}

/** A Shape Up scope as a backlog story, in its own words. */
export function scopeSource(canvas: ProductCanvas, item: ProductCanvasItem): HandoffSource {
  return {
    title: item.text,
    sourceRef: { tool: "product-canvas", id: item.id, doc: canvas.id },
  };
}
