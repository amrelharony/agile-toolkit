import type { Release, ReleaseGateDef } from "@/lib/stores/workspace-types";
import type { GateResult } from "@/lib/releases/auto-gates";
import type { ReleaseStats } from "@/lib/releases/model";
import { enoughData, MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { NO_VALUE, fmt } from "@/lib/charts/chart-text";
import type { SkippedRow } from "./analysis";
import { STATUS_LABEL, dayLabel, nameOf } from "./text";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const orDash = (v: string | undefined) => md(v) || NO_VALUE;

export interface ReleaseMarkdownInput {
  today: string;
  verdict: string;
  releases: readonly { release: Release; results: readonly GateResult[] }[];
  stats: ReleaseStats;
  skipped: readonly SkippedRow[];
  gates: readonly ReleaseGateDef[];
}

/**
 * Release readiness for a release review or a go/no-go thread: the verdict,
 * the stats (the rate only once enough ships back it), every release with
 * its open gates by name, the most-skipped gates and the team's gate list.
 */
export function toMarkdown(input: ReleaseMarkdownInput): string {
  const { today, verdict, releases, stats, skipped, gates } = input;
  const title = `# Release readiness — ${dayLabel(today, true)}`;
  if (releases.length === 0) return `${title}\n\nNo releases yet.\n`;

  // Both rates wait for the page's minimum sample: quoted from fewer ships they're noise.
  const quotable = enoughData(stats.shipped, "average");
  const notYet = `${NO_VALUE} (shows after ${MIN_SAMPLE.average} ships)`;
  const rate = quotable
    ? `${fmt(stats.pct ?? 0, 0)}% (${stats.onTime} of ${stats.shipped})`
    : notYet;
  const avgOpen = quotable && stats.avgGatesOpen !== null ? fmt(stats.avgGatesOpen) : notYet;
  // Days with their year: a release review thread outlives the year it started in.
  const day = (v: string | undefined) => dayLabel(v, true);
  const lines = [
    title,
    "",
    `**${md(verdict)}**`,
    "",
    "## Stats",
    "",
    `- Went out: ${stats.shipped}${stats.rolledBack > 0 ? ` (${stats.rolledBack} rolled back)` : ""}`,
    `- On time: ${rate}`,
    `- Average gates open at ship: ${avgOpen}`,
    "",
    "## Releases",
    "",
    "| Release | Status | Planned | Shipped | Rolled back | Gates passed | Open gates |",
    "|---|---|---|---|---|---:|---|",
    ...releases.map(({ release: r, results }) => {
      const open = results.filter((g) => !g.passed).map((g) => g.label);
      const passed = results.length - open.length;
      return `| ${md(nameOf(r))} | ${STATUS_LABEL[r.status]} | ${day(r.plannedDate)} | ${day(
        r.shippedDate
      )} | ${day(r.rolledBackAt)} | ${passed} / ${results.length} | ${orDash(open.join(", "))} |`;
    }),
  ];

  const earlier = releases.flatMap(({ release: r }) =>
    (r.previousShips ?? []).map((s) => ({ r, s }))
  );
  if (earlier.length > 0) {
    lines.push(
      "",
      "## Earlier ships of reopened releases",
      "",
      "| Release | Shipped | Rolled back | Gates open |",
      "|---|---|---|---:|",
      ...earlier.map(
        ({ r, s }) =>
          `| ${md(nameOf(r))} | ${day(s.shippedDate)} | ${day(s.rolledBackAt)} | ${
            s.gatesOpenAtShip ?? NO_VALUE
          } |`
      )
    );
  }

  if (skipped.some((g) => g.skipped > 0)) {
    lines.push(
      "",
      "## Most-skipped gates",
      "",
      "| Gate | Open at ship | Of ships |",
      "|---|---:|---:|",
      ...skipped
        .filter((g) => g.skipped > 0)
        .map((g) => `| ${md(g.label)} | ${g.skipped} | ${g.of} |`)
    );
  }

  lines.push(
    "",
    "## Gates",
    "",
    ...gates.map(
      (g, i) =>
        `${i + 1}. ${md(g.label)}${g.description ? ` — ${md(g.description)}` : ""}${
          g.auto === "flags"
            ? " (checked from the Feature Flag Tracker)"
            : g.auto === "dod"
              ? " (checked from the Definition of Done)"
              : ""
        }`
    )
  );
  return `${lines.join("\n")}\n`;
}
