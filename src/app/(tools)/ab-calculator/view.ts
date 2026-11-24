/**
 * The A/B Calculator page's own reading: the details form of a saved test
 * and its check, the `?hypothesis=` link that opens a new plan for a
 * hypothesis, and how a test's hypothesis and metric read on its card.
 * Every number comes from lib/experiments; this file only arranges it.
 */

import type { AbTestStatus, Hypothesis, ProductMetric } from "@/lib/stores/workspace-types";
import { AB_TEST_STATUSES, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { emptyPlanDraft, type PlanDraft } from "@/lib/experiments/model";
import type { FormErrors, Validation } from "@/lib/utils/form";

/** A saved test's details, as typed. */
export interface DetailsDraft {
  name: string;
  question: string;
  metricName: string;
  /** A product metric's id, or "". */
  metricId: string;
  /** A hypothesis's id, or "". */
  hypothesisId: string;
  status: AbTestStatus;
}

export type DetailsField = keyof DetailsDraft;

export interface DetailsValues {
  name: string;
  question: string | undefined;
  metricName: string | undefined;
  metricId: string | undefined;
  hypothesisId: string | undefined;
  status: AbTestStatus;
}

export const emptyDetailsDraft = (): DetailsDraft => ({
  name: "",
  question: "",
  metricName: "",
  metricId: "",
  hypothesisId: "",
  status: "planned",
});

/** Check the details: a name, and each text within the workspace's caps. */
export function validateDetails(d: DetailsDraft): Validation<DetailsValues, DetailsField> {
  const errors: FormErrors<DetailsField> = {};
  const name = d.name.trim();
  const question = d.question.trim();
  const metricName = d.metricName.trim();
  if (!name) errors.name = "Name the test, e.g. “Shorter sign-up form”.";
  else if (name.length > TOOL_TEXT_MAX.short) {
    errors.name = `Keep it to ${TOOL_TEXT_MAX.short} characters or fewer.`;
  }
  if (question.length > TOOL_TEXT_MAX.text) {
    errors.question = `Keep it to ${TOOL_TEXT_MAX.text} characters or fewer.`;
  }
  if (metricName.length > TOOL_TEXT_MAX.short) {
    errors.metricName = `Keep it to ${TOOL_TEXT_MAX.short} characters or fewer.`;
  }
  if (!(AB_TEST_STATUSES as readonly string[]).includes(d.status)) errors.status = "Pick a status.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      question: question || undefined,
      metricName: metricName || undefined,
      metricId: d.metricId || undefined,
      hypothesisId: d.hypothesisId || undefined,
      status: d.status,
    },
  };
}

/** The hypothesis a `?hypothesis=<id>` link names, or null. */
export function readHypothesisParam(search: URLSearchParams): string | null {
  const id = search.get("hypothesis")?.trim();
  return id ? id : null;
}

const cut = (s: string | undefined, max: number) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * A new plan for a hypothesis: named after what it believes, linked to it,
 * and, when its target is in "%", starting from its baseline (a target
 * baseline of 9 with unit "%" is a current rate of 9%).
 */
export function planForHypothesis(h: Hypothesis): { plan: PlanDraft; details: DetailsDraft } {
  const plan = emptyPlanDraft();
  const t = h.target;
  if (
    t?.unit?.trim() === "%" &&
    typeof t.baseline === "number" &&
    Number.isFinite(t.baseline) &&
    t.baseline > 0 &&
    t.baseline < 100
  ) {
    plan.baselinePct = String(t.baseline);
  }
  return {
    plan,
    details: {
      ...emptyDetailsDraft(),
      name: cut(h.believe, TOOL_TEXT_MAX.short) || "A/B test",
      metricName: cut(h.successMetric, TOOL_TEXT_MAX.short),
      hypothesisId: h.id,
    },
  };
}

/** How a test's hypothesis reads on its card, its status read live. */
export function hypothesisLine(
  id: string | undefined,
  hypotheses: readonly Hypothesis[]
): { text: string; hypothesis: Hypothesis | null } | null {
  if (!id) return null;
  const h = hypotheses.find((x) => x.id === id) ?? null;
  if (!h) return { text: "Hypothesis removed", hypothesis: null };
  const status = h.status.charAt(0).toUpperCase() + h.status.slice(1);
  return {
    text: `Tests “${cut(h.believe, 80) || "Untitled hypothesis"}” · ${status}`,
    hypothesis: h,
  };
}

/** How a test's metric reads on its card: its name, or "metric removed". */
export function metricLine(
  id: string | undefined,
  name: string | undefined,
  metrics: readonly ProductMetric[]
): string | null {
  if (id) {
    const m = metrics.find((x) => x.id === id);
    return m ? m.name : `${name ? `${name}: ` : ""}metric removed`;
  }
  return name?.trim() || null;
}
