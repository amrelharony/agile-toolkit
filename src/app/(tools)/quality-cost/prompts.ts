import { generateQualityCostPrompts } from "@/lib/ai-prompts/quality-cost";
import type { PromptDefinition } from "@/lib/ai-prompts/types";
import { listAnd } from "@/lib/charts/chart-text";
import {
  COST_CATEGORY_LABEL,
  costBreakdown,
  type CostCategory,
  type QualityCostPeriod,
} from "@/lib/quality/cost";
import type { Workspace } from "@/lib/stores/workspace-types";

/**
 * The note on the categories of `period` that weren't entered, or null
 * when all four were.
 */
export function notEnteredNote(missing: readonly CostCategory[], period: string): string | null {
  if (missing.length === 0) return null;
  const one = missing.length === 1;
  const names = listAnd(missing.map((c) => COST_CATEGORY_LABEL[c]));
  return `## Not entered\n\n${names} ${one ? "wasn't" : "weren't"} entered for ${period}. Read ${one ? "its" : "their"} $0 above as unknown, not as zero spend, and say which conclusions that leaves open.`;
}

/**
 * The AI prompts for one logged quarter, from the figures the page shows.
 *
 * The shared generator takes all four costs as numbers, so a category that
 * wasn't entered goes in as $0 and reads as zero spend, the silent default
 * the page itself avoids ("Not entered"). Each prompt ends with a note that
 * names those categories as unknown. (Optional costs in the generator's
 * input would be the clean fix; it lives in lib/ai-prompts.)
 */
export function qualityCostPrompts(
  period: QualityCostPeriod,
  workspace?: Workspace | null
): PromptDefinition[] {
  const b = costBreakdown(period.costs);
  const prompts = generateQualityCostPrompts(
    {
      prevention: period.costs.prevention ?? 0,
      detection: period.costs.detection ?? 0,
      internalFailure: period.costs.internalFailure ?? 0,
      externalFailure: period.costs.externalFailure ?? 0,
      total: b.total,
      conformance: b.conformance,
      nonConformance: b.nonConformance,
      description: [period.period, period.note].filter(Boolean).join(": "),
    },
    workspace
  );
  const note = notEnteredNote(b.missing, period.period);
  return note
    ? prompts.map((p) => ({ ...p, prompt: `${p.prompt.trimEnd()}\n\n${note}` }))
    : prompts;
}
