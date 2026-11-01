import type { Hypothesis } from "@/lib/stores/workspace-types";
import { sourceLabel } from "@/lib/handoffs/registry";
import {
  HYPOTHESIS_STATUSES,
  formatMetric,
  hypothesisVerdict,
  missingFields,
  suggestionText,
  type ValidationRate,
} from "@/lib/hypotheses/model";
import { STATUS_LABEL, missingText, rateText, targetText } from "./view";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/**
 * The tracker as Markdown: the verdict and the validation rate (saying
 * that inconclusive results aren't counted), then one section per status
 * in lifecycle order. Each hypothesis lists its lines, target, measured
 * result and the verdict it suggests, what was learned, its days, where
 * it came from and what it still needs.
 */
export function hypothesesToMarkdown(list: readonly Hypothesis[], rate: ValidationRate): string {
  const lines = ["# Hypothesis Tracker", ""];
  if (list.length === 0) {
    lines.push("No hypotheses yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`> ${hypothesisVerdict(rate)}`, "");
  lines.push(
    rate.rate === null
      ? "Validation rate: — (no decisive result yet; inconclusive results aren't counted)"
      : `Validation rate: ${rateText(rate)} (${rate.validated} of ${rate.decisive} decisive; inconclusive results aren't counted)`,
    ""
  );
  const known = new Set<string>(HYPOTHESIS_STATUSES);
  const groups: [string, Hypothesis[]][] = HYPOTHESIS_STATUSES.map((s) => [
    STATUS_LABEL[s],
    list.filter((h) => h.status === s),
  ]);
  const other = list.filter((h) => !known.has(h.status));
  if (other.length > 0) groups.push(["Other", other]);
  for (const [label, rows] of groups) {
    if (rows.length === 0) continue;
    lines.push(`## ${label} (${rows.length})`, "");
    for (const h of rows) lines.push(...hypothesisLines(h), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function hypothesisLines(h: Hypothesis): string[] {
  const out = [`### We believe ${oneLine(h.believe || "(untitled)")}`];
  const item = (term: string, value: string | undefined) => {
    const text = oneLine(value ?? "");
    if (text) out.push(`- **${term}:** ${text}`);
  };
  item("We will", h.willDo);
  item("To learn", h.toLearn);
  item("Success looks like", h.successMetric);
  if (h.target) item("Target", targetText(h.target));
  if (typeof h.actual === "number" && Number.isFinite(h.actual)) {
    item("Measured", formatMetric(h.actual, h.target?.unit));
  }
  const suggestion = suggestionText(h);
  if (suggestion) item("Suggested", suggestion);
  item("Experiment", h.experiment);
  item("Context", h.description);
  item("What we learned", h.outcome);
  const days = [
    h.raisedAt ? `raised ${h.raisedAt.slice(0, 10)}` : null,
    h.resolvedAt ? `result ${h.resolvedAt.slice(0, 10)}` : null,
  ].filter(Boolean);
  if (days.length > 0) item("Days", days.join(" · "));
  item("Source", sourceLabel(h.sourceRef) ?? undefined);
  const missing = missingFields(h);
  if (missing.length > 0) item("Needs detail", missingText(missing));
  return out;
}
