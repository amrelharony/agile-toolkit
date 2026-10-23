import type { Story } from "@/lib/stores/workspace-types";
import type { EstimationScale } from "@/lib/constants/scales";
import { defaultDescription, entryKey, readEntry } from "./entries";
import { isExampleNote } from "./example";
import { pinDrift, pinnedIds, resolveReferenceStories, type GuideEntries } from "./references";
import { guideCoverage, guideVerdict } from "./verdict";

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

const NONE = "—";
const EXAMPLE = " (example)";
const pts = (n: number | undefined) => (n === undefined ? "" : ` (${n} ${n === 1 ? "pt" : "pts"})`);

/**
 * The scale on screen as a Markdown table, for the team's wiki or a
 * refinement thread: what each card means, the team's example, and the
 * reference stories pinned on it. Example data is marked "(example)", so a
 * page made while the example is loaded never passes it off as the team's;
 * a pin whose story has moved off the card says so.
 */
export function toMarkdown(
  maps: GuideEntries,
  scale: EstimationScale,
  stories: readonly Story[],
  now: Date = new Date()
): string {
  const lines = [
    `# Estimation Guide — ${md(scale.name)} scale — ${mdDate(now)}`,
    "",
    `**${guideVerdict(guideCoverage(maps, scale, stories))}**`,
    "",
    "| Card | What it means | Team example | Reference stories |",
    "|---:|---|---|---|",
    ...scale.values.map((v) => {
      const meaning = readEntry(maps.descriptions ?? {}, scale.name, v, defaultDescription(v));
      const example = readEntry(maps.examples ?? {}, scale.name, v);
      const exampleCell = md(example)
        ? `${md(example)}${isExampleNote(entryKey(scale.name, v), example) ? EXAMPLE : ""}`
        : NONE;
      const refs = resolveReferenceStories(
        pinnedIds(maps.referenceStoryIds, scale.name, v),
        stories
      ).map((s) => {
        const drift = pinDrift(s, v);
        return `“${md(s.title)}”${pts(s.points)}${s.example ? EXAMPLE : ""}${drift ? `, ${drift}` : ""}`;
      });
      return `| ${md(v)} | ${md(meaning) || NONE} | ${exampleCell} | ${
        refs.length > 0 ? refs.join("; ") : NONE
      } |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}
