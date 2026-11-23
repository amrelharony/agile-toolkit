/**
 * Flow Insights' AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `flow-insights.ts` and loads on first AI use): the caps,
 * the sort without AI, `fitClassifyInput`, reading an answer against the
 * items sent, and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { guessWorkType, keywordWorkType } from "@/lib/flow/distribution";
import type { Story, WorkType } from "@/lib/stores/workspace-types";
import type { ClassifyInput, ClassifyOutput, ClassifiedItem } from "./flow-insights";
export type { ClassifyInput, ClassifyOutput, ClassifiedItem } from "./flow-insights";

export const CLASSIFY_ITEMS_MAX = 60;
/** Short ids ("i1" … "i60"): row ids never leave the browser, and the answer stays small. */
export const CLASSIFY_ID_MAX = 8;
export const CLASSIFY_TITLE_MAX = 200;
export const CLASSIFY_TEXT_MAX = 200;
export const CLASSIFY_TAGS_MAX = 10;
export const CLASSIFY_TAG_MAX = 40;
export const CLASSIFY_FROM_MAX = 40;
export const CLASSIFY_REASON_MAX = 120;

const RULE_REASON = {
  kind: "Its title or tags mark it as a fix.",
  tag: "Its tags say so.",
  source: "It came from a tool that tracks this kind of work.",
  set: "Its type was already set.",
} as const;

const KEYWORD_REASON: Record<WorkType, string> = {
  feature: "Nothing in its words says fix, debt or risk, so it reads as new value.",
  defect: "Its words say it fixes something that broke.",
  debt: "Its words say it cleans up or upgrades existing work.",
  risk: "Its words say it reduces a risk or an unknown.",
};

/**
 * The sort without AI: the page's own rules first (its story kind, tags,
 * where it came from), then title words (fix, bug, broken, error or crash:
 * a defect; refactor, upgrade, clean or migrate: debt; security, audit,
 * compliance, risk or spike: risk; else a feature). Repeat work is a
 * defect or a reopened item. The reason says which rule fired. With nothing
 * to sort it throws (the schema refuses that input).
 */
export function classifyFallback({ items }: ClassifyInput): ClassifyOutput {
  if (items.length === 0) throw new Error("There is nothing to sort.");
  return {
    items: items.slice(0, CLASSIFY_ITEMS_MAX).map((it) => {
      const row = {
        id: it.id,
        title: it.title,
        status: "done",
        tags: it.tags,
        ...(it.from ? { sourceRef: { tool: it.from, id: it.id } } : {}),
      } as Story;
      const rule = guessWorkType(row);
      const type = rule?.type ?? keywordWorkType(it.title, it.text ?? "");
      const failure = type === "defect" || it.reopened;
      const why = rule ? RULE_REASON[rule.by as keyof typeof RULE_REASON] : KEYWORD_REASON[type];
      const reason =
        it.reopened && type !== "defect" ? `${why} It was reopened, so it is repeat work.` : why;
      return { id: it.id, type, failure, reason: reason.slice(0, CLASSIFY_REASON_MAX) };
    }),
  };
}

export const flowInsightsClassifyTask = lazyAiTask<ClassifyInput, ClassifyOutput>(
  { id: "flow-insights.classify", toolId: "flow-insights", fallback: classifyFallback },
  () => import("./flow-insights").then((m) => m.flowInsightsClassifyTask)
);

/**
 * The input trimmed until its request (`{task, input}`) fits `budget`
 * bytes: tags go first, from the last item up, then the note, then whole
 * items from the end. The input as it is when it already fits. The page
 * says how many items didn't fit, to sort next.
 */
export function fitClassifyInput(
  input: ClassifyInput,
  budget: number = TOOL_AI_BODY_BUDGET
): ClassifyInput {
  const size = (items: ClassifyInput["items"]) =>
    jsonBytes({ task: "flow-insights.classify", input: { ...input, items } });
  let items = input.items;
  if (size(items) <= budget) return input;
  items = items.map((it) => ({ ...it, tags: [...it.tags] }));
  for (let i = items.length - 1; i >= 0 && size(items) > budget; i--) {
    items[i].tags = [];
    delete items[i].text;
  }
  while (items.length > 1 && size(items) > budget) items = items.slice(0, -1);
  return { ...input, items };
}

/** An answer's items against the ids sent: unknown ids dropped, each id once (the first). */
export function cleanClassified(
  items: readonly ClassifiedItem[],
  sent: ReadonlySet<string>
): ClassifiedItem[] {
  const seen = new Set<string>();
  const out: ClassifiedItem[] = [];
  for (const it of items) {
    if (!sent.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}
