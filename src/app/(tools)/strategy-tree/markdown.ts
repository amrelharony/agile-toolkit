/**
 * A strategy tree as Markdown: nested bullets with each part's level,
 * measure, owner and status; for Hoshin Kanri the targets as a table, one
 * row per path from the breakthrough objective; and the open checks.
 */

import type { Hypothesis, StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { mapChecks } from "@/lib/strategy-map/checks";
import { STATUS_LABEL, STRATEGY_FORMATS, levelOf } from "@/lib/strategy-map/formats";
import { childrenOf, nodeTitle, pathOf, rootOf } from "@/lib/strategy-map/model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return oneLine(String(v ?? "")).replace(/\|/g, "\\|");
}

const orDash = (s: string | undefined) => (s && s.trim() ? md(s) : "—");
const status = (n: StrategyMapNode | undefined) => (n ? STATUS_LABEL[n.status ?? "proposed"] : "—");

export function strategyTreeMarkdown(
  tree: StrategyMap,
  opts: { hypotheses?: readonly Pick<Hypothesis, "id" | "status">[]; today: string }
): string {
  const format = STRATEGY_FORMATS[tree.format];
  const lines = [`# ${format.label} — ${oneLine(tree.title)} — ${opts.today}`, ""];
  const root = rootOf(tree);
  if (!root) {
    lines.push("No root yet.");
    return `${lines.join("\n")}\n`;
  }
  const walk = (n: StrategyMapNode, depth: number) => {
    if (depth > 3) return;
    const marks = [
      n.measure?.trim() ? `measure: ${oneLine(n.measure)}` : "",
      n.owner?.trim() ? `owner: ${oneLine(n.owner)}` : "",
      STATUS_LABEL[n.status ?? "proposed"],
    ].filter(Boolean);
    lines.push(
      `${"  ".repeat(depth)}- **${levelOf(tree.format, n.level).label}:** ${oneLine(nodeTitle(n, tree.format))} (${marks.join(" · ")})`
    );
    if (n.note?.trim()) lines.push(`${"  ".repeat(depth + 1)}- Question: ${oneLine(n.note)}`);
    if (n.detail?.trim()) lines.push(`${"  ".repeat(depth + 1)}- ${oneLine(n.detail)}`);
    for (const c of childrenOf(tree, n.id)) walk(c, depth + 1);
  };
  walk(root, 0);

  if (tree.format === "hoshin") {
    // One row per target, or per deepest part on a path that has no target yet.
    const leaves = tree.nodes.filter((n) => n.level > 0 && childrenOf(tree, n.id).length === 0);
    if (leaves.length > 0) {
      lines.push(
        "",
        "## Targets",
        "",
        "| Breakthrough | Annual objective | Priority | Target | Owner | Status |",
        "|---|---|---|---|---|---|"
      );
      for (const leaf of leaves) {
        const path = pathOf(tree, leaf);
        const at = (level: number) => path.find((p) => p.level === level);
        const target = at(3);
        const priority = at(2);
        lines.push(
          `| ${orDash(at(0)?.text)} | ${orDash(at(1)?.text)} | ${orDash(priority?.text)} | ${orDash(target?.text)}${target?.measure ? ` (${md(target.measure)})` : ""} | ${orDash(target?.owner ?? priority?.owner)} | ${status(target ?? priority ?? at(1))} |`
        );
      }
    }
  }

  const checks = mapChecks(tree, opts.hypotheses ?? []);
  if (checks.length > 0) {
    lines.push("", "## Open checks", "", ...checks.map((c) => `- ${oneLine(c.text)}`));
  }
  return `${lines.join("\n")}\n`;
}
