import type { BacklogItem } from "@/lib/stores/workspace-types";
import { formatNumber } from "@/lib/prioritization/methods/fields";
import { MOSCOW_BUCKETS, MOSCOW_LABEL } from "@/lib/prioritization/methods/moscow";
import type { RankedRow } from "@/lib/prioritization/rank";
import { bucketOf, budgetOf, effortOf } from "./budget";
import { budgetLine, moscowVerdict } from "./verdict";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line of text, for a list item. */
function line(v: string): string {
  return v.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * The scope as Markdown, for a release page or a stakeholder thread: one
 * section per bucket with its count (each item with its effort and where
 * the effort came from), unsorted items last, then the Must budget and the
 * verdict. A linked row's bucket is its backlog item's, as on the page.
 */
export function toMarkdown(
  rows: readonly RankedRow[],
  items: readonly BacklogItem[] = [],
  now: Date = new Date()
): string {
  const title = `# MoSCoW — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNothing sorted yet.\n`;

  const item = (r: RankedRow) => {
    const { effort, source } = effortOf(r, items);
    const size =
      effort === null
        ? ""
        : ` (${formatNumber(effort, 2)} ${effort === 1 ? "point" : "points"}${
            source === "backlog" ? ", backlog job size" : ""
          })`;
    return `- ${line(r.row.title)}${size}`;
  };
  const section = (heading: string, list: readonly RankedRow[]) => [
    `## ${heading} (${list.length})`,
    "",
    ...(list.length > 0 ? list.map(item) : ["_None._"]),
    "",
  ];

  const lines = [title, ""];
  for (const b of MOSCOW_BUCKETS) {
    lines.push(
      ...section(
        MOSCOW_LABEL[b],
        rows.filter((r) => bucketOf(r) === b)
      )
    );
  }
  const unsorted = rows.filter((r) => bucketOf(r) === null);
  if (unsorted.length > 0) lines.push(...section("Not sorted yet", unsorted));
  const budget = budgetLine(budgetOf(rows, items));
  if (budget) lines.push(budget, "");
  lines.push(`**${moscowVerdict(rows, items)}**`);
  return `${lines.join("\n")}\n`;
}
