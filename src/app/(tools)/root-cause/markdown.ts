import type { RootCauseAnalysis } from "@/lib/stores/workspace-types";
import {
  ROOT_CAUSE_METHOD_LABEL,
  STAGE_LABEL,
  analysisStage,
  categoriesOf,
  causesIn,
  paretoRows,
} from "@/lib/root-cause/model";
import { LOOPS_TRUNCATED_NOTE, describeLoop, findLoops, loopName } from "@/lib/root-cause/loops";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

export interface RootCauseMarkdownOptions {
  /** The page's one-sentence verdict, quoted under the heading. */
  verdict?: string;
  /** The post-mortem each analysis links to, by its id. */
  postMortemTitle?: (id: string) => string | undefined;
}

/**
 * The causal loop: its things, its arrows ("A → B (same way, takes time)")
 * and the loops they close, each with its name and its path. Nothing when
 * the analysis has no thing on a loop.
 */
export function loopToMarkdown(a: RootCauseAnalysis): string[] {
  const loop = a.loop;
  if (!loop || loop.nodes.length === 0) return [];
  const text = new Map(loop.nodes.map((n) => [n.id, oneLine(n.text)]));
  const lines = ["### Causal loop", "", "**Things that go up or down**", ""];
  for (const n of loop.nodes) lines.push(`- ${oneLine(n.text)}`);
  lines.push("");
  if (loop.links.length > 0) {
    lines.push("**Arrows**", "");
    for (const l of loop.links) {
      const how = [
        l.polarity === "same" ? "same way" : "opposite ways",
        l.delay ? "takes time" : "",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`- ${text.get(l.from) ?? "?"} → ${text.get(l.to) ?? "?"} (${how})`);
    }
    lines.push("");
  }
  const found = findLoops(loop);
  if (found.loops.length === 0) {
    lines.push("No loop closes yet.", "");
    return lines;
  }
  lines.push("**Loops**", "");
  for (const l of found.loops) {
    const name = loopName(loop, l.key);
    lines.push(`- ${l.label}${name ? ` “${oneLine(name)}”` : ""}: ${describeLoop(loop, l)}`);
  }
  if (found.truncated) lines.push("", LOOPS_TRUNCATED_NOTE);
  lines.push("");
  return lines;
}

/** One analysis: the problem, its whys, its fishbone with the Pareto order, its loop, the outcome. */
export function analysisToMarkdown(
  a: RootCauseAnalysis,
  { postMortemTitle }: Pick<RootCauseMarkdownOptions, "postMortemTitle"> = {}
): string[] {
  const lines = [`## ${oneLine(a.title)}`, ""];
  lines.push(`${ROOT_CAUSE_METHOD_LABEL[a.method]} · ${STAGE_LABEL[analysisStage(a)]}`, "");
  if (a.problem.trim()) lines.push(`**Problem:** ${oneLine(a.problem)}`, "");
  const pm = a.postMortemId ? postMortemTitle?.(a.postMortemId) : undefined;
  if (pm) lines.push(`**Post-mortem:** ${oneLine(pm)}`, "");
  if (a.whys.length > 0) {
    lines.push("### 5 Whys", "");
    a.whys.forEach((w, i) => lines.push(`${i + 1}. Why? ${oneLine(w.text)}`));
    lines.push("");
  }
  if (a.causes.length > 0) {
    lines.push("### Fishbone", "");
    for (const category of categoriesOf(a.causes)) {
      const list = causesIn(a.causes, category);
      if (list.length === 0) continue;
      lines.push(`**${category}**`, "");
      for (const c of list) lines.push(`- ${oneLine(c.text)} (${c.count})`);
      lines.push("");
    }
    const rows = paretoRows(a.causes);
    if (rows.length > 0) {
      lines.push(
        "### Pareto",
        "",
        "| Cause | Category | Count | Cumulative |",
        "| --- | --- | --- | --- |",
        ...rows.map(
          (r) =>
            `| ${cell(r.text)}${r.vital ? " (vital few)" : ""} | ${cell(r.category)} | ${r.count} | ${Math.round(r.cumulative * 100)}% |`
        ),
        ""
      );
    }
  }
  lines.push(...loopToMarkdown(a));
  if (a.rootCause?.trim()) lines.push(`**Root cause:** ${oneLine(a.rootCause)}`, "");
  if (a.countermeasure?.trim()) {
    lines.push("**Countermeasure:**", "", ...a.countermeasure.trim().split("\n"), "");
  }
  return lines;
}

/** Every analysis, newest first as the page lists them. */
export function rootCauseToMarkdown(
  analyses: readonly RootCauseAnalysis[],
  { verdict, postMortemTitle }: RootCauseMarkdownOptions = {}
): string {
  const lines = ["# Root-cause analyses", ""];
  if (verdict) lines.push(`> ${oneLine(verdict)}`, "");
  if (analyses.length === 0) {
    lines.push("No analysis yet.");
    return `${lines.join("\n")}\n`;
  }
  for (const a of analyses) lines.push(...analysisToMarkdown(a, { postMortemTitle }));
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
