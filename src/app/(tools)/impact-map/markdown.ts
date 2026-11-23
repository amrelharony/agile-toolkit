/**
 * An impact map as Markdown: the goal line (measure, date, the Product
 * Goal it serves), the map as nested bullets with the focus marked, a
 * "Paths" table with where each deliverable went, and the open checks.
 */

import type {
  Hypothesis,
  ProductGoal,
  StrategyMap,
  StrategyMapNode,
} from "@/lib/stores/workspace-types";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { mapChecks } from "@/lib/strategy-map/checks";
import { levelOf } from "@/lib/strategy-map/formats";
import { childrenOf, nodeTitle, rootOf } from "@/lib/strategy-map/model";
import { impactPaths } from "./view";

/** One line of text. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return oneLine(String(v ?? "")).replace(/\|/g, "\\|");
}

const orDash = (s: string | undefined) => (s && s.trim() ? md(s) : "—");

/** Where a part went, as the routes name it: "Backlog story, Epic on the roadmap". */
export function sentText(node: StrategyMapNode): string {
  const routes = (["backlog-story", "epic", "hypothesis"] as const).filter((r) =>
    liveLink(node.sentTo, r)
  );
  return routes.map((r) => getHandoffRoute(r).label).join(", ");
}

export function impactMapMarkdown(
  map: StrategyMap,
  opts: {
    goal?: ProductGoal;
    hypotheses?: readonly Pick<Hypothesis, "id" | "status">[];
    /** The export's day, YYYY-MM-DD. */
    today: string;
  }
): string {
  const lines = [`# Impact Map — ${oneLine(map.title)} — ${opts.today}`, ""];
  const root = rootOf(map);
  if (!root) {
    lines.push("No goal yet.");
    return `${lines.join("\n")}\n`;
  }
  const about = [
    root.measure?.trim() ? `Measure: ${oneLine(root.measure)}` : "No measure yet",
    map.targetDate ? `By ${map.targetDate}` : "",
    opts.goal ? `Product Goal: ${oneLine(opts.goal.statement)}` : "",
  ].filter(Boolean);
  lines.push(`**Goal:** ${oneLine(nodeTitle(root, map.format))} (${about.join(" · ")})`, "");

  const walk = (n: StrategyMapNode, depth: number) => {
    if (depth > 3) return;
    const label = levelOf(map.format, n.level).label;
    const marks = [n.focus ? "**work on this first**" : "", sentText(n)].filter(Boolean);
    lines.push(
      `${"  ".repeat(depth)}- **${label}:** ${oneLine(nodeTitle(n, map.format))}${marks.length > 0 ? ` (${marks.join(" · ")})` : ""}`
    );
    if (n.detail?.trim()) lines.push(`${"  ".repeat(depth + 1)}- ${oneLine(n.detail)}`);
    for (const c of childrenOf(map, n.id)) walk(c, depth + 1);
  };
  walk(root, 0);

  const paths = impactPaths(map).filter((p) => p.actor);
  if (paths.length > 0) {
    lines.push(
      "",
      "## Paths",
      "",
      "| Why | Who | How | What | Where it went |",
      "|---|---|---|---|---|"
    );
    for (const p of paths) {
      lines.push(
        `| ${md(nodeTitle(p.goal, map.format))} | ${orDash(p.actor?.text)} | ${orDash(p.impact?.text)}${p.focus ? " (focus)" : ""} | ${orDash(p.deliverable?.text)} | ${p.deliverable ? orDash(sentText(p.deliverable)) : "—"} |`
      );
    }
  }

  const checks = mapChecks(map, opts.hypotheses ?? []);
  if (checks.length > 0) {
    lines.push("", "## Open checks", "", ...checks.map((c) => `- ${oneLine(c.text)}`));
  }
  return `${lines.join("\n")}\n`;
}
