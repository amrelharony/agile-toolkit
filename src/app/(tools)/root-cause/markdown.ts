import type { RootCauseAnalysis } from "@/lib/stores/workspace-types";
import {
  ROOT_CAUSE_METHOD_LABEL,
  STAGE_LABEL,
  analysisStage,
  categoriesOf,
  causesIn,
  paretoRows,
} from "@/lib/root-cause/model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

export interface RootCauseMarkdownOptions {
  /** The page's one-sentence verdict, quoted under the heading. */
  verdict?: string;
  /** The post-mortem each analysis links to, by its id. */
  postMortemTitle?: (id: string) => string | undefined;
}

/** One analysis: the problem, its whys, its fishbone with the Pareto order, the outcome. */
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
