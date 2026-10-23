import type { StoryMapCard, StoryMapSlice, StoryMapStep } from "@/lib/stores/workspace-types";
import { fmt, plural } from "@/lib/charts/chart-text";
import {
  estimateKind,
  estimatePoints,
  sliceTotals,
  storyMapVerdict,
  type SliceTotals,
} from "./estimate";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line: newlines collapsed. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return oneLine(v).replace(/\|/g, "\\|");
}

/**
 * The cards left out of a slice's points, split as the board's slice
 * summary splits them: "2 unestimated, 1 custom". Empty when none are.
 */
function notInPoints(t: SliceTotals): string {
  const parts: string[] = [];
  if (t.unestimated > 0) parts.push(`${t.unestimated} unestimated`);
  if (t.custom > 0) parts.push(`${t.custom} custom`);
  return parts.join(", ");
}

/** A slice's points for the table: "8", "8 (2 unestimated, 1 custom)", "— (1 custom)", or "—" with no stories. */
function pointsCell(t: SliceTotals): string {
  if (t.cards === 0) return "—";
  const open = notInPoints(t);
  if (t.estimated === 0) return `— (${open})`;
  return open ? `${fmt(t.points)} (${open})` : fmt(t.points);
}

/** " (5 points)" or " (XL, custom)" after a story's title; nothing when unsized. */
function estimateNote(card: StoryMapCard): string {
  const kind = estimateKind(card.estimate);
  if (kind === "points") return ` (${plural(estimatePoints(card.estimate) as number, "point")})`;
  if (kind === "custom") return ` (${oneLine(card.estimate)}, custom)`;
  return "";
}

/**
 * The story map as Markdown, for a wiki page or a release-planning thread: a
 * steps × slices table (the map itself, with each slice's points), then each
 * slice's stories with their estimates and descriptions. Slices read top to
 * bottom in release order.
 */
export function toMarkdown(
  map: { steps: StoryMapStep[]; slices: StoryMapSlice[] },
  now: Date = new Date()
): string {
  const { steps, slices } = map;
  const title = `# User Story Map — ${mdDate(now)}`;
  const cardsIn = (slice: StoryMapSlice, step: StoryMapStep) => slice.cards[step.id] ?? [];
  const totals = slices.map((sl) => sliceTotals(sl, steps));
  const storyCount = totals.reduce((n, t) => n + t.cards, 0);
  if (storyCount === 0) return `${title}\n\nNo stories on the map yet.\n`;
  const points = totals.reduce((n, t) => n + t.points, 0);

  const lines = [
    title,
    "",
    `**Journey:** ${steps.map((s) => oneLine(s.name)).join(" → ")}`,
    "",
    `${steps.length} step${steps.length === 1 ? "" : "s"} · ${slices.length} slice${
      slices.length === 1 ? "" : "s"
    } · ${storyCount} ${storyCount === 1 ? "story" : "stories"} · ${plural(points, "point")}`,
    "",
    `**${storyMapVerdict(map)}**`,
    "",
    "## Map",
    "",
    `| Slice | ${steps.map((s) => cell(s.name)).join(" | ")} | Points |`,
    `|---|${steps.map(() => "---").join("|")}|---:|`,
    ...slices.map(
      (sl, i) =>
        `| **${cell(sl.name)}** | ${steps
          .map(
            (st) =>
              cardsIn(sl, st)
                .map((c) => cell(c.title))
                .join("<br>") || "—"
          )
          .join(" | ")} | ${pointsCell(totals[i])} |`
    ),
  ];

  slices.forEach((sl, i) => {
    const t = totals[i];
    const sized = t.estimated > 0 ? ` · ${plural(t.points, "point")}` : "";
    const open = t.estimated > 0 && notInPoints(t) ? `, ${notInPoints(t)}` : "";
    lines.push(
      "",
      `## ${i + 1}. ${oneLine(sl.name)} (${t.cards} ${t.cards === 1 ? "story" : "stories"})${sized}${open}`,
      ""
    );
    if (t.cards === 0) {
      lines.push("_No stories yet._");
      return;
    }
    for (const st of steps) {
      for (const c of cardsIn(sl, st)) {
        const description = oneLine(c.description);
        lines.push(
          `- **${oneLine(st.name)}:** ${oneLine(c.title)}${estimateNote(c)}${
            description ? ` — ${description}` : ""
          }`
        );
      }
    }
  });

  return `${lines.join("\n")}\n`;
}
