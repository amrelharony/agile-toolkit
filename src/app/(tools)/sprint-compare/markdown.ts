import { DIMENSIONS, averageOf, pointsDone, type CompareRow } from "./view";

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

const NOT_RATED = "–";

/**
 * The comparison as Markdown, for a retro page or a review thread: each
 * dimension's rating per sprint (oldest first), the average and the points
 * done. Dimensions nobody rated show a dash.
 */
export function toMarkdown(
  rows: readonly Pick<CompareRow, "name" | "ratings" | "sprint">[],
  now: Date = new Date()
): string {
  const title = `# Sprint comparison — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo sprints pinned yet.\n`;

  const header = `| Dimension | ${rows.map((r) => cell(r.name)).join(" | ")} |`;
  const sep = `| --- | ${rows.map(() => "---:").join(" | ")} |`;
  const body = DIMENSIONS.map(
    (dim) => `| ${dim} | ${rows.map((r) => r.ratings[dim] ?? NOT_RATED).join(" | ")} |`
  );
  const avg = `| **Average** | ${rows
    .map((r) => {
      const a = averageOf(r.ratings);
      return a === null ? NOT_RATED : `**${a.toFixed(1)}**`;
    })
    .join(" | ")} |`;
  const points = `| Points done | ${rows.map((r) => pointsDone(r.sprint) ?? NOT_RATED).join(" | ")} |`;

  const anyRated = rows.some((r) => averageOf(r.ratings) !== null);
  const note = anyRated
    ? "Ratings are 1 to 10. A dash means not rated."
    : "No ratings yet. A dash means not rated.";

  return [title, "", note, "", header, sep, ...body, avg, points, ""].join("\n");
}
