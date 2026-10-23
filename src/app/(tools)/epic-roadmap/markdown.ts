import { normalizeQuarter } from "./quarters";
import { SCHEDULE_LABEL, rollupLabel } from "./rollup";
import { byStart, epicName, roadmapVerdict, type EpicView } from "./view";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const orDash = (s: string | undefined) => (s && s.trim() ? md(s) : "—");

/** The roadmap as a Markdown table, earliest start first, for a planning doc or a stakeholder update. */
export function toMarkdown(views: readonly EpicView[], now: Date = new Date()): string {
  const title = `# Epic Roadmap — ${mdDate(now)}`;
  if (views.length === 0) return `${title}\n\nNo epics on the roadmap yet.\n`;

  const lines = [
    title,
    "",
    "Progress rolls up from each epic's linked stories; “Typed” means no stories are linked yet.",
    "",
    "| Epic | Start | End | Owner | Progress | From | Status |",
    "|---|---|---|---|---:|---|---|",
    ...[...views]
      .sort(byStart)
      .map(
        (v) =>
          `| ${md(epicName(v.epic))} | ${orDash(normalizeQuarter(v.epic.startQuarter))} | ${orDash(
            normalizeQuarter(v.epic.endQuarter)
          )} | ${orDash(v.epic.owner)} | ${v.rollup.pct}% | ${md(rollupLabel(v.rollup))} | ${
            SCHEDULE_LABEL[v.schedule]
          } |`
      ),
    "",
    `**${roadmapVerdict(views)}**`,
  ];
  return `${lines.join("\n")}\n`;
}
