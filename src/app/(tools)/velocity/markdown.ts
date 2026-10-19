import { commitmentAccuracy, finishedRows, type VelocityRow } from "./view";

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

function outcome(r: VelocityRow): string {
  if (r.finished && r.completed !== null) {
    const pct = r.committed > 0 ? ` (${Math.round((r.completed / r.committed) * 100)}%)` : "";
    return `${r.completed >= r.committed ? "Yes" : "No"}${pct}`;
  }
  switch (r.status) {
    case "planned":
      return "Planned";
    case "active":
      return "In progress";
    case "cancelled":
      return "Cancelled";
    default:
      return "—";
  }
}

/**
 * Velocity as Markdown, for a sprint review page or a planning thread: the
 * average and how often the team met its commitment, then every sprint.
 * Like the KPI tiles, only finished sprints count: a planned or running
 * sprint can't have met or missed anything yet.
 */
export function toMarkdown(rows: readonly VelocityRow[], now: Date = new Date()): string {
  const title = `# Velocity — ${mdDate(now)}`;
  if (rows.length === 0) return `${title}\n\nNo sprints yet.\n`;

  const finished = finishedRows(rows);
  const lines = [title, ""];
  if (finished.length === 0) {
    lines.push("No finished sprints yet.");
  } else {
    const completed = finished.map((r) => r.completed);
    const avg = mean(completed);
    const recent = completed.slice(-3);
    const sd = Math.sqrt(mean(completed.map((v) => (v - avg) ** 2)));
    const accuracy = commitmentAccuracy(rows);
    const n = finished.length;
    lines.push(
      `**Average velocity:** ${round1(avg)} points over ${n} finished sprint${n === 1 ? "" : "s"}` +
        (n > 3 ? ` (last 3: ${round1(mean(recent))})` : ""),
      "",
      `**Predictability:** ${accuracy.met} of ${accuracy.considered} met their commitment (${Math.round(accuracy.pct)}%)`,
      "",
      `**Spread:** ±${round1(sd)} points (standard deviation)`
    );
  }

  lines.push(
    "",
    "## Sprints",
    "",
    "| Sprint | Committed | Completed | Met commitment | Goal |",
    "|---|---:|---:|---|---|",
    ...rows.map(
      (r) =>
        `| ${cell(r.name) || "—"} | ${r.committed} | ${r.completed ?? "—"} | ${outcome(r)} | ${cell(
          r.description
        )} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
