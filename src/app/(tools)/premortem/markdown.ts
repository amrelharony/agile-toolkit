import { linkText, type ResolvedLink } from "./links";
import {
  PHASE_LABEL,
  causeScore,
  rankCauses,
  votesOf,
  type Premortem,
  type PremortemCause,
} from "./model";
import { premortemVerdict } from "./verdict";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line: newlines collapsed. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return oneLine(v).replace(/\|/g, "\\|");
}

/** A rating for a table: the number, or a dash when it isn't rated yet. */
const rated = (v: number | undefined) => (v === undefined ? "—" : String(v));

/** The cause, its description and the duplicates grouped into it, for one cell. */
function causeCell(c: PremortemCause): string {
  const text = cell(c.text) || "(untitled)";
  const description = c.description?.trim() ? ` — ${cell(c.description)}` : "";
  const merged = (c.merged ?? []).map((m) => `“${cell(m.text) || "(untitled)"}”`);
  return `${text}${description}${merged.length > 0 ? ` (also: ${merged.join("; ")})` : ""}`;
}

export interface PremortemMarkdownOptions {
  /** The premortem's link as it reads today (renamed, or removed). */
  link?: ResolvedLink | null;
  /** Whether a cause is in the Risk Register. */
  isSent?: (c: PremortemCause) => boolean;
  now?: Date;
}

/**
 * One premortem as Markdown, for the project page or a kickoff thread: what
 * it is about, the imagined failure, the causes in rank order (votes, then
 * likelihood × impact) with the duplicates grouped into each and whether it
 * went to the Risk Register, the verdict, then the preventive actions as a
 * checklist with owners.
 */
export function toMarkdown(p: Premortem, opts: PremortemMarkdownOptions = {}): string {
  const { link = null, isSent = () => false, now = new Date() } = opts;
  const title = `# Premortem: ${oneLine(p.title) || "Premortem"} — ${mdDate(now)}`;
  const lines = [title, ""];
  if (link) lines.push(`**For:** ${linkText(link)}  `);
  lines.push(`**Phase:** ${PHASE_LABEL[p.phase]}`, "");
  lines.push("## Imagined failure", "", oneLine(p.scenario) || "_Not described yet._");

  lines.push("", "## Causes", "");
  const causes = rankCauses(p.causes);
  if (causes.length === 0) {
    lines.push("_No causes yet._");
  } else {
    lines.push(
      "| # | Cause | Votes | Likelihood | Impact | Score | Preventive action | Owner | Risk Register |",
      "|---:|---|---:|---:|---:|---:|---|---|---|",
      ...causes.map((c, i) => {
        const score = causeScore(c);
        return `| ${i + 1} | ${causeCell(c)} | ${votesOf(c)} | ${rated(c.likelihood)} | ${rated(
          c.impact
        )} | ${score === null ? "Not scored" : score} | ${cell(c.preventiveAction)} | ${cell(
          c.owner
        )} | ${isSent(c) ? "Added" : ""} |`;
      })
    );
    lines.push("", `**${premortemVerdict(p, isSent)}**`);
  }

  const actions = causes.filter((c) => c.preventiveAction?.trim());
  if (actions.length > 0) {
    lines.push(
      "",
      "## Preventive actions",
      "",
      ...actions.map(
        (c) =>
          `- [ ] ${oneLine(c.preventiveAction)}${c.owner?.trim() ? ` — **${oneLine(c.owner)}**` : ""}`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
