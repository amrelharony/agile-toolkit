import {
  LS_PURPOSE_LABEL,
  lsPeopleLabel,
  stepsMinutes,
  type LsStructure,
} from "@/lib/liberating-structures/catalog";
import { CEREMONY_LABEL } from "@/lib/sprints/cadence";
import { durationText, shortClock } from "@/app/(tools)/ceremony-timer/agenda";
import { TIMING_LABEL, isFiltered, type LsFilters } from "./filters";

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

/** "12 people, Ideas, Sprint Retrospective, Under 15 min" (the filters that are set). */
function filtersText(f: LsFilters): string {
  return [
    f.people !== null ? `${f.people} people` : "",
    f.purpose ? LS_PURPOSE_LABEL[f.purpose] : "",
    f.ceremony ? CEREMONY_LABEL[f.ceremony] : "",
    f.timing ? TIMING_LABEL[f.timing] : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** One structure as a facilitation plan: what it's for, who, and each step's start and length. */
function plan(s: LsStructure): string[] {
  const lines = [
    `## ${md(s.name)}`,
    "",
    md(s.purpose),
    "",
    `- **People:** ${lsPeopleLabel(s)}`,
    `- **Timing:** ${md(s.timing)}`,
    `- **Purpose:** ${s.purposes.map((p) => LS_PURPOSE_LABEL[p]).join(", ")}`,
  ];
  if (s.ceremonies.length > 0) {
    lines.push(`- **Fits:** ${s.ceremonies.map((c) => CEREMONY_LABEL[c]).join(", ")}`);
  }
  lines.push("", md(s.description), "");
  if (!s.steps) {
    lines.push("It runs as one open session, at the group's pace.", "");
    return lines;
  }
  let start = 0;
  lines.push("| Starts | Step | Length | What happens |", "|---:|---|---:|---|");
  for (const step of s.steps) {
    const seconds = step.minutes * 60;
    lines.push(
      `| ${shortClock(start)} | ${md(step.label)} | ${durationText(seconds)} | ${md(step.hint)} |`
    );
    start += seconds;
  }
  lines.push("", `Total: ${durationText((stepsMinutes(s) ?? 0) * 60)}.`, "");
  return lines;
}

/**
 * The structure on screen as a plan with its timed steps, then the saved
 * favourites: something to paste into the workshop invite or the retro
 * notes. CSV and JSON stay for the favourites list.
 */
export function toMarkdown(
  {
    selected,
    favorites,
    filters,
  }: { selected: LsStructure | null; favorites: readonly LsStructure[]; filters: LsFilters },
  now: Date = new Date()
): string {
  const lines = [`# Liberating Structures — ${mdDate(now)}`, ""];
  if (isFiltered(filters)) lines.push(`Filtered for: ${filtersText(filters)}.`, "");
  if (selected) lines.push(...plan(selected));

  lines.push("## Favorites", "");
  if (favorites.length === 0) lines.push("No favorites saved yet.");
  else {
    lines.push(
      ...favorites.map(
        (s) => `- **${md(s.name)}** (${md(s.timing)}, ${lsPeopleLabel(s)}): ${md(s.purpose)}`
      )
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
