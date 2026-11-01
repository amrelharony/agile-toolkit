import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { BacklogItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { formatNumber } from "../prioritization/methods/fields";
import {
  MOSCOW_BUCKETS,
  MOSCOW_LABEL,
  MUST_BUDGET_MIN_SIZED,
  MUST_BUDGET_SHARE,
} from "../prioritization/methods/moscow";
import type { RankedRow } from "../prioritization/rank";
import { bucketOf, budgetOf, effortOf } from "@/app/(tools)/moscow/budget";
import {
  bucketCounts,
  budgetLine,
  moscowVerdict,
  unsizedMustsText,
} from "@/app/(tools)/moscow/verdict";

/**
 * The scope as the MoSCoW page reads it: its rows, read through to their
 * backlog items (rankMethodRows), and the backlog items, whose job size is
 * a linked row's effort for the Must budget.
 */
interface MoscowData {
  rows: readonly RankedRow[];
  items?: readonly BacklogItem[];
}

/** A bucket lists this many items. */
const MAX_PER_BUCKET = 40;

/** The rows' group label when they have no bucket (legacy or agent rows), never Must. */
const NOT_SORTED = "Not sorted yet";

/**
 * The scope balance prompt over the buckets as the page shows them: no
 * default bucket (a row without one is "Not sorted yet"), each item's
 * effort and where it comes from (the linked item's job size, else the
 * row's own), and the Must budget as the panel states it: the Musts' share
 * of the planned effort (Must + Should + Could) against about 60%, from 3
 * sized items.
 */
export function generateMoscowPrompts(
  data: MoscowData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { rows } = data;
  if (rows.length === 0) return [];
  const items = data.items ?? [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const line = (r: RankedRow) => {
    const { effort, source } = effortOf(r, items);
    const at =
      effort === null
        ? "no effort yet"
        : `effort ${formatNumber(effort, 2)}${source === "backlog" ? ", the backlog job size" : ""}`;
    return `- ${sanitizePromptCell(r.row.title, 120)} (${at})`;
  };
  const groups = [
    ...MOSCOW_BUCKETS.map((b) => ({
      label: MOSCOW_LABEL[b],
      rows: rows.filter((r) => bucketOf(r) === b),
    })),
    { label: NOT_SORTED, rows: rows.filter((r) => bucketOf(r) === null) },
  ].filter((g) => g.label !== NOT_SORTED || g.rows.length > 0);
  const sections = groups
    .map((g) => {
      const more =
        g.rows.length > MAX_PER_BUCKET ? `\n(and ${g.rows.length - MAX_PER_BUCKET} more)` : "";
      const list = g.rows.slice(0, MAX_PER_BUCKET).map(line).join("\n") || "(none)";
      return `### ${g.label.toUpperCase()} (${g.rows.length})\n${list}${more}`;
    })
    .join("\n\n");

  const budget = budgetOf(rows, items);
  const musts = bucketCounts(rows).must;
  const budgetText =
    budgetLine(budget, musts) ??
    (budget.share === null
      ? `Must budget: it shows from ${MUST_BUDGET_MIN_SIZED} planned items with an effort; ${budget.sized} so far.`
      : `Must budget: ${unsizedMustsText(budget, musts)}, so it can't be judged yet.`);

  // Titles are user-typed: the buckets go inside the untrusted block, with the verdict.
  const body = wrapUserContent(
    `Verdict: ${sanitizePromptCell(moscowVerdict(rows, items), 400)}\n${budgetText}\n\n${sections}`
  );
  return [
    {
      id: "moscow-balance",
      title: "Scope Balance Check",
      description: "Audit the Must/Should/Could/Won't ratio for realism.",
      prompt:
        buildPreamble(
          "MoSCoW Matrix",
          `It buckets scope into Must have, Should have, Could have and Won't have (this time); an item with no bucket yet is "Not sorted yet". The Musts should take about ${Math.round(MUST_BUDGET_SHARE * 100)}% of the planned effort at most (Must + Should + Could; Won't is out of the plan).`
        ) +
        `${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Is the Must list too long against the Must budget above?\n` +
        `2. Are 'Won't have (this time)' items rationalised — could any actually be Musts?\n` +
        `3. What item, if dropped from Must, would unblock the timeline most?\n` +
        `4. Recommend a stakeholder communication script for the Won't list.\n` +
        `5. Are there missing items in any bucket, or items not sorted yet that belong in one?`,
    },
  ];
}
