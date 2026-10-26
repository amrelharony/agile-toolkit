"use client";

import { useMemo } from "react";
import { ListChecks } from "lucide-react";
import { MethodTool, type MethodToolConfig } from "@/components/prioritization/method-tool";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateMoscowPrompts } from "@/lib/ai-prompts/moscow";
import { MOSCOW_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import { MOSCOW_BUCKETS, MOSCOW_LABEL } from "@/lib/prioritization/methods/moscow";
import type { RankedRow } from "@/lib/prioritization/rank";
import { MustBudgetPanel } from "./budget-panel";
import { bucketOf, effortOf } from "./budget";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { MoscowInputs, MoscowRowValues } from "./moscow-inputs";
import { moscowVerdict } from "./verdict";

const NO_ITEMS: BacklogItem[] = [];

/** The label of the group for rows without a bucket (legacy or agent rows). */
export const NOT_SORTED = "Not sorted yet";

/**
 * The rows by bucket, in Must, Should, Could, Won't order, then the ones
 * with no (or an unknown) bucket under "Not sorted yet", never under Must.
 */
export function moscowGroups(rows: readonly RankedRow[]) {
  const groups = MOSCOW_BUCKETS.map((b) => ({
    id: b,
    label: MOSCOW_LABEL[b],
    rows: rows.filter((r) => bucketOf(r) === b),
  }));
  const unsorted = rows.filter((r) => bucketOf(r) === null);
  return unsorted.length > 0
    ? [...groups, { id: "unsorted", label: NOT_SORTED, rows: unsorted }]
    : groups;
}

/** A row's values with its Move menu (a stable component, so rows don't remount). */
function RowValues({ ranked }: { ranked: RankedRow }) {
  return <MoscowRowValues ranked={ranked} config={MOSCOW_TOOL} />;
}

/**
 * MoSCoW on the shared method-tool shell: add (a bucket is required and
 * none is picked to start with), edit in place, Undo, the example, the
 * export and the live backlog binding come from MethodTool; the bucket and
 * its 4 / 3 / 2 / 1 priority from the method registry. The list groups by
 * bucket with a Move menu per row (no rank or score on a row: the bucket
 * is the answer), and the Must budget sits under it.
 */
export const MOSCOW_TOOL: MethodToolConfig = {
  methodId: "moscow",
  toolId: "moscow",
  title: "MoSCoW Matrix",
  description:
    "Bucket scope into Must / Should / Could / Won't to align cross-functional teams on what's in vs out, with Musts kept to about 60% of the planned effort.",
  icon: ListChecks,
  noun: { one: "scope item", many: "scope items" },
  titleLabel: "Scope item",
  titlePlaceholder: "e.g. Guest checkout",
  submitLabel: "Add",
  listLabel: "Scope items by bucket",
  emptyText: "Nothing sorted yet. Add a scope item above, or load an example release.",
  history: MOSCOW_ACTIONS,
  buildExample: () => buildExample(),
  csv: (rows) => ({
    headers: ["Bucket", "Title", "Effort", "Effort from"],
    rows: rows.map((r) => {
      const b = bucketOf(r);
      const { effort, source } = effortOf(r, useWorkspaceStore.getState().backlogItems ?? []);
      return [
        b ? MOSCOW_LABEL[b] : NOT_SORTED,
        r.row.title,
        effort ?? "",
        source === "backlog" ? "backlog job size" : source === "row" ? "row" : "",
      ];
    }),
  }),
  Inputs: MoscowInputs,
  RowValues,
  rowScore: false,
  groups: moscowGroups,
  Panels: MustBudgetPanel,
};

export function MoscowClient() {
  // The verdict, the export and the AI prompt count a linked item's job
  // size, so they read the backlog too.
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const config = useMemo<MethodToolConfig>(
    () => ({
      ...MOSCOW_TOOL,
      verdict: (rows) => moscowVerdict(rows, items),
      toMarkdown: (rows) => toMarkdown(rows, items),
      prompts: (rows, workspace) => generateMoscowPrompts({ rows, items }, workspace),
    }),
    [items]
  );
  return (
    // The app root has a provider; this one keeps the rows' icon-button
    // tooltips working wherever the page renders on its own.
    <TooltipProvider delayDuration={300}>
      <MethodTool config={config} />
    </TooltipProvider>
  );
}
