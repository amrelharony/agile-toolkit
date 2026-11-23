import { normalizeQuarter } from "@/lib/roadmap/quarters";
import { SCHEDULE_LABEL, rollupLabel } from "@/lib/roadmap/rollup";
import {
  HORIZON_LABEL,
  horizonColumns,
  horizonOf,
  type HorizonColumn,
} from "@/lib/roadmap/horizons";
import { boardItems, byStart, epicName, roadmapVerdict, type EpicView } from "./view";

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
    "",
    ...horizonsMarkdown(views, now),
  ];
  return `${lines.join("\n")}\n`;
}

const COLUMN_ORDER: readonly HorizonColumn[] = ["now", "next", "later", "done"];

/**
 * The Now, Next, Later section after the verdict: each horizon with its
 * epics, earliest start first, their quarters, progress and whether the
 * place was set by hand. An empty horizon says so.
 */
export function horizonsMarkdown(views: readonly EpicView[], now: Date = new Date()): string[] {
  const columns = horizonColumns(boardItems(views), now);
  const lines = ["## Now, Next, Later"];
  for (const column of COLUMN_ORDER) {
    const items = columns[column];
    if (column === "done" && items.length === 0) continue;
    lines.push("", `### ${HORIZON_LABEL[column]} (${items.length})`, "");
    if (items.length === 0) {
      lines.push("Nothing here yet.");
      continue;
    }
    for (const item of items) {
      const start = normalizeQuarter(item.epic.startQuarter);
      const end = normalizeQuarter(item.epic.endQuarter);
      const quarters =
        !start || !end ? "no valid quarters" : start === end ? start : `${start} → ${end}`;
      const set = horizonOf(item, now).from === "set" ? ", set by hand" : "";
      lines.push(`- ${md(epicName(item.epic))} (${quarters}), ${item.view.rollup.pct}%${set}`);
    }
  }
  return lines;
}
