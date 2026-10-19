/** The burndown's shapes, as the client stores them. */
export interface DayEntry {
  id: string;
  day: number;
  remaining: number | null;
  scopeChange: boolean;
  description?: string;
}

export interface BurndownConfig {
  totalPoints: number;
  sprintDays: number;
  sprintStartDate: string;
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

/** "2026-10-12" as a local calendar date, or the raw string if it isn't one. */
function startDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? mdDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : iso;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Same ideal line as the chart. */
function ideal(day: number, { totalPoints, sprintDays }: BurndownConfig): number {
  if (!Number.isFinite(sprintDays) || sprintDays <= 0) return totalPoints;
  return Math.max(0, totalPoints - (totalPoints / sprintDays) * day);
}

/** A day with anything logged past the day-0 scope. */
const isLogged = (e: DayEntry) =>
  (e.day > 0 && e.remaining !== null) || !!e.description || e.scopeChange;

/**
 * The burndown as Markdown, for a sprint review page or a stand-up thread:
 * where the sprint stands against the ideal line, the scope changes, then
 * every day of the sprint.
 */
export function toMarkdown(
  { config, entries }: { config: BurndownConfig; entries: DayEntry[] },
  now: Date = new Date()
): string {
  const title = `# Burndown — ${mdDate(now)}`;
  if (!entries.some(isLogged)) return `${title}\n\nNo days logged yet.\n`;

  const sorted = [...entries].sort((a, b) => a.day - b.day);
  const filled = sorted.filter((e) => e.remaining !== null && Number.isFinite(e.remaining));
  const lines = [
    title,
    "",
    `**Sprint:** ${config.totalPoints} points over ${config.sprintDays} days, starting ${startDate(
      config.sprintStartDate
    )}`,
  ];

  // Same reading as the KPI tiles: a trend needs a second logged day.
  if (filled.length >= 2) {
    const last = filled[filled.length - 1];
    const remaining = last.remaining as number;
    const target = round1(ideal(last.day, config));
    const variance = round1(target - remaining);
    const trend =
      variance > 0.5
        ? `${variance} points ahead of ideal`
        : variance < -0.5
          ? `${-variance} points behind ideal`
          : "on track";
    const done =
      config.totalPoints > 0
        ? Math.max(
            0,
            Math.min(100, Math.round(((config.totalPoints - remaining) / config.totalPoints) * 100))
          )
        : 0;
    lines.push(
      `**Day ${last.day}:** ${remaining} points left, ideal ${target}: ${trend} (${done}% done)`
    );
  }

  const scopeChanges = sorted.filter((e) => e.scopeChange);
  if (scopeChanges.length > 0) {
    lines.push(
      "",
      "## Scope changes",
      "",
      ...scopeChanges.map((e) => `- Day ${e.day}${e.description ? `: ${cell(e.description)}` : ""}`)
    );
  }

  lines.push(
    "",
    "## Daily progress",
    "",
    "| Day | Ideal | Remaining | Scope change | Note |",
    "|---:|---:|---:|---|---|",
    ...sorted.map(
      (e) =>
        `| ${e.day} | ${round1(ideal(e.day, config))} | ${e.remaining ?? "—"} | ${
          e.scopeChange ? "Yes" : ""
        } | ${cell(e.description)} |`
    )
  );
  return `${lines.join("\n")}\n`;
}
