"use client";

import { Hash } from "lucide-react";
import { MethodTool, type MethodToolConfig } from "@/components/prioritization/method-tool";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateIcePrompts } from "@/lib/ai-prompts/ice-score";
import type { RankedItem } from "@/lib/analytics/scoring-rubric";
import { ICE_ACTIONS } from "@/lib/history/event-actions";
import { ICE } from "@/lib/prioritization/methods";
import type { RankedRow } from "@/lib/prioritization/rank";
import { buildExample } from "./example";
import { IceInputs, IceRowValues } from "./ice-inputs";
import { toMarkdown } from "./markdown";
import { iceVerdict } from "./verdict";

/** The scored rows as the AI prompts read them (rank and score from the registry). */
function promptItems(rows: readonly RankedRow[]): RankedItem<Record<string, number | string>>[] {
  const scored = rows.filter((r) => r.result.score !== null && r.rank !== null);
  const last = scored.reduce((n, r) => Math.max(n, r.rank as number), 0);
  return scored.map((r) => ({
    id: r.row.id,
    title: r.row.title,
    fields: ICE.write(r.row.fields, r.values),
    score: r.result.score as number,
    rank: r.rank as number,
    percentile: last <= 1 ? 1 : (last - (r.rank as number) + 1) / last,
  }));
}

/**
 * ICE on the shared method-tool shell: the add form, edit in place, Undo,
 * the example, the export and the backlog link all come from MethodTool;
 * every score and rank comes from the method registry.
 */
export const ICE_TOOL: MethodToolConfig = {
  methodId: "ice",
  toolId: "ice-score",
  title: "ICE Score Card",
  description:
    "Lightweight Impact × Confidence × Ease scoring (each 1–10). Best for fast prioritisation of growth experiments and quick wins.",
  icon: Hash,
  noun: { one: "idea", many: "ideas" },
  titleLabel: "Idea or experiment",
  titlePlaceholder: "e.g. Onboarding email with a setup checklist",
  addTitle: "Add experiment / idea",
  listLabel: "Ideas, highest ICE first",
  emptyText: "No ideas yet. Add one above, or load an example to see a scored list.",
  history: ICE_ACTIONS,
  buildExample: () => buildExample(),
  verdict: iceVerdict,
  toMarkdown: (rows) => toMarkdown(rows),
  csv: (rows) => ({
    headers: ["Rank", "Title", "Impact", "Confidence", "Ease", "ICE"],
    rows: rows.map((r) => [
      r.rank ?? "",
      r.row.title,
      r.values.impact ?? "",
      r.values.confidence ?? "",
      r.values.ease ?? "",
      r.result.score ?? "",
    ]),
  }),
  prompts: (rows, workspace) => generateIcePrompts({ items: promptItems(rows) }, workspace),
  Inputs: IceInputs,
  RowValues: IceRowValues,
};

export function IceScoreClient() {
  return (
    // The app root has a provider; this one keeps the rows' icon-button
    // tooltips working wherever the page renders on its own.
    <TooltipProvider delayDuration={300}>
      <MethodTool config={ICE_TOOL} />
    </TooltipProvider>
  );
}
