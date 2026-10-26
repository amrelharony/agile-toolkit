"use client";

import { Hash } from "lucide-react";
import { MethodTool, type MethodToolConfig } from "@/components/prioritization/method-tool";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateIcePrompts } from "@/lib/ai-prompts/ice-score";
import { ICE_ACTIONS } from "@/lib/history/event-actions";
import { buildExample } from "./example";
import { IceInputs, IceRowValues } from "./ice-inputs";
import { toMarkdown } from "./markdown";
import { iceVerdict } from "./verdict";

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
  // The rows as they read: ICE to two places, unscored ideas named, never 0.
  prompts: (rows, workspace) => generateIcePrompts({ rows, verdict: iceVerdict(rows) }, workspace),
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
