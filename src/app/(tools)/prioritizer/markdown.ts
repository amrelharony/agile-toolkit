/**
 * Backlog Prioritizer — the Markdown export: the decided order with every
 * method's result ("Not scored" where a method hasn't scored an item), the
 * items not ordered yet, and each method's place for every item next to
 * the consensus, as the Decide order step shows them.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { decidedOrder } from "@/lib/prioritization/rank";
import { evaluateItem, method } from "@/lib/prioritization/methods";
import { HUB_METHODS, countText, listText, methodText } from "./method-text";
import { consensusPlaces, consensusScore, placeText, rankOf } from "./order";
import type { OrderAnalysis } from "./verdict";

/** A table cell: pipes escaped and line breaks flattened, so a name can't break the row. */
const cell = (s: string | number): string =>
  String(s)
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ");

const row = (cells: (string | number)[]) => `| ${cells.map(cell).join(" | ")} |`;

function table(headers: string[], rows: (string | number)[][]): string {
  return [row(headers), row(headers.map(() => "---")), ...rows.map(row)].join("\n");
}

const METHOD_HEADERS = HUB_METHODS.map((id) => method(id).label);

function scoresRow(item: BacklogItem, rows: readonly PrioritizationItem[]): string[] {
  const all = evaluateItem(item, rows);
  return HUB_METHODS.map((id) => methodText(id, all[id]));
}

export function toMarkdown(input: {
  items: readonly BacklogItem[];
  rows: readonly PrioritizationItem[];
  analysis: OrderAnalysis;
  verdict: string;
}): string {
  const { items, rows, analysis, verdict } = input;
  const ordered = decidedOrder(items);
  const ranked = ordered.filter((i) => rankOf(i) !== undefined);
  const unranked = ordered.filter((i) => rankOf(i) === undefined);
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name.trim() || "Untitled item";

  const out: string[] = ["# Backlog Prioritizer", "", verdict, "", "## Decided order", ""];
  out.push(
    ranked.length === 0
      ? "No order decided yet."
      : table(
          ["#", "Item", ...METHOD_HEADERS],
          ranked.map((i) => [rankOf(i) as number, nameOf(i.id), ...scoresRow(i, rows)])
        )
  );

  out.push("", "## Not ordered yet", "");
  out.push(
    unranked.length === 0
      ? "Every item is ordered."
      : table(
          ["Item", ...METHOD_HEADERS],
          unranked.map((i) => [nameOf(i.id), ...scoresRow(i, rows)])
        )
  );

  out.push("", "## Rank per method", "");
  const used = analysis.used;
  const skipped = analysis.skipped.map(
    (s) => `${method(s.method).label} (${s.n === 0 ? "no item scored" : "only 1 item scored"})`
  );
  out.push(
    used.length === 0
      ? "No method has 2 or more items scored yet."
      : `Combined: ${listText(used.map((r) => method(r.method).label))}.` +
          (skipped.length > 0 ? ` Left out: ${listText(skipped)}.` : "")
  );
  const places = consensusPlaces(analysis.consensus).filter((p) => p.place !== null);
  if (used.length > 0 && places.length > 0) {
    out.push(
      "",
      table(
        ["Consensus", "Item", ...used.map((r) => method(r.method).label), "Score", "Scored in"],
        places.map((p) => [
          p.tied ? `${p.place} (tie)` : (p.place as number),
          nameOf(p.row.itemId),
          ...used.map((r) => placeText(r, p.row.itemId) ?? "—"),
          consensusScore(p.row.borda) ?? "—",
          `${p.row.coverage} of ${used.length}`,
        ])
      )
    );
  }
  if (analysis.unscored.length > 0 && used.length > 0) {
    out.push(
      "",
      `Not scored by any of these methods (${countText(analysis.unscored.length, "item")}): ${listText(analysis.unscored.map(nameOf))}.`
    );
  }
  return out.join("\n") + "\n";
}
