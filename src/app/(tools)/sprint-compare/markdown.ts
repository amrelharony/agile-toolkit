import { sourceLabel } from "@/lib/sprints/compare";
import { DIMENSIONS, pointsDone, type CompareRow } from "./view";

/** "19 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const NOT_SCORED = "–";

/**
 * The comparison as Markdown, for a retro page or a review thread: each
 * dimension's score per sprint (oldest first), the average and the points
 * done, then where every score came from. Dimensions with nothing to go on
 * show a dash.
 */
export function toMarkdown(
  rows: readonly Pick<CompareRow, "name" | "scores" | "average" | "sprint">[],
  now: Date = new Date(),
  { verdict }: { verdict?: string } = {}
): string {
  const title = `# Sprint comparison — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo sprints pinned yet.\n`;

  const header = `| Dimension | ${rows.map((r) => cell(r.name)).join(" | ")} |`;
  const sep = `| --- | ${rows.map(() => "---:").join(" | ")} |`;
  const body = DIMENSIONS.map(
    (dim) => `| ${dim} | ${rows.map((r) => r.scores[dim].value ?? NOT_SCORED).join(" | ")} |`
  );
  const avg = `| **Average** | ${rows
    .map((r) => (r.average === null ? NOT_SCORED : `**${r.average.toFixed(1)}**`))
    .join(" | ")} |`;
  const points = `| Points done | ${rows.map((r) => pointsDone(r.sprint) ?? NOT_SCORED).join(" | ")} |`;

  const anyScored = rows.some((r) => r.average !== null);
  const note = anyScored
    ? "Scores are 1 to 10. Velocity, Scope Stability, Goal Achievement and Predictability are computed from each sprint's data; Team Happiness and Quality are prefilled from Mood Tracker and the Squad Health Check unless the team rated them. A dash means not scored."
    : "Nothing scored yet. A dash means not scored.";

  const sources = rows.flatMap((r) => [
    "",
    `### ${cell(r.name) || "Sprint"}`,
    "",
    ...DIMENSIONS.map((dim) => {
      const s = r.scores[dim];
      return `- **${dim}:** ${sourceLabel(s)} · ${cell(s.basis)}`;
    }),
  ]);

  return [
    title,
    "",
    ...(verdict ? [verdict, ""] : []),
    note,
    "",
    header,
    sep,
    ...body,
    avg,
    points,
    "",
    "## Where each score came from",
    ...sources,
    "",
  ].join("\n");
}
