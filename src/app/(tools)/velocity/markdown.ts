/** A velocity row, as the client stores it. */
export interface Sprint {
  id: string;
  name: string;
  description?: string;
  committed: number;
  completed: number;
}

/** "18 Oct 2026" */
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

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function outcome(s: Sprint): string {
  if (s.completed <= 0) return s.committed > 0 ? "Planned" : "—";
  const pct = s.committed > 0 ? ` (${Math.round((s.completed / s.committed) * 100)}%)` : "";
  return `${s.completed >= s.committed ? "Yes" : "No"}${pct}`;
}

/**
 * Velocity as Markdown, for a sprint review page or a planning thread: the
 * average and how often the team met its commitment, then every sprint.
 * Like the KPI tiles, only finished sprints (completed > 0) count: a planned
 * row can't have met or missed anything yet.
 */
export function toMarkdown(sprints: readonly Sprint[], now: Date = new Date()): string {
  const title = `# Velocity — ${mdDate(now)}`;
  if (sprints.length === 0) return `${title}\n\nNo sprints yet.\n`;

  const finished = sprints.filter((s) => s.completed > 0);
  const lines = [title, ""];
  if (finished.length === 0) {
    lines.push("No finished sprints yet.");
  } else {
    const completed = finished.map((s) => s.completed);
    const avg = mean(completed);
    const recent = completed.slice(-3);
    const sd = Math.sqrt(mean(completed.map((v) => (v - avg) ** 2)));
    const met = finished.filter((s) => s.completed >= s.committed).length;
    const n = finished.length;
    lines.push(
      `**Average velocity:** ${round1(avg)} points over ${n} finished sprint${n === 1 ? "" : "s"}` +
        (n > 3 ? ` (last 3: ${round1(mean(recent))})` : ""),
      "",
      `**Predictability:** ${met} of ${n} met their commitment (${Math.round((met / n) * 100)}%)`,
      "",
      `**Spread:** ±${round1(sd)} points (standard deviation)`
    );
  }

  lines.push(
    "",
    "## Sprints",
    "",
    "| Sprint | Committed | Completed | Met commitment | Notes |",
    "|---|---:|---:|---|---|",
    ...sprints.map(
      (s) =>
        `| ${cell(s.name) || "—"} | ${s.committed} | ${s.completed > 0 ? s.completed : "—"} | ${outcome(
          s
        )} | ${cell(s.description)} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
