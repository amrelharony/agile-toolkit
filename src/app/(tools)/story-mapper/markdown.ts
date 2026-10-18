import type { StoryMapSlice, StoryMapStep } from "@/lib/stores/workspace-types";

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
 * The story map as Markdown, for a wiki page or a release-planning thread: a
 * steps × slices table (the map itself), then each slice's stories with their
 * descriptions. Slices read top to bottom in release order.
 */
export function toMarkdown(
  map: { steps: StoryMapStep[]; slices: StoryMapSlice[] },
  now: Date = new Date()
): string {
  const { steps, slices } = map;
  const title = `# User Story Map — ${mdDate(now)}`;
  const cardsIn = (slice: StoryMapSlice, step: StoryMapStep) => slice.cards[step.id] ?? [];
  const storyCount = slices.reduce(
    (n, sl) => n + steps.reduce((m, st) => m + cardsIn(sl, st).length, 0),
    0
  );
  if (storyCount === 0) return `${title}\n\nNo stories on the map yet.\n`;

  const lines = [
    title,
    "",
    `**Journey:** ${steps.map((s) => oneLine(s.name)).join(" → ")}`,
    "",
    `${steps.length} step${steps.length === 1 ? "" : "s"} · ${slices.length} slice${
      slices.length === 1 ? "" : "s"
    } · ${storyCount} ${storyCount === 1 ? "story" : "stories"}`,
    "",
    "## Map",
    "",
    `| Slice | ${steps.map((s) => cell(s.name)).join(" | ")} |`,
    `|---|${steps.map(() => "---").join("|")}|`,
    ...slices.map(
      (sl) =>
        `| **${cell(sl.name)}** | ${steps
          .map(
            (st) =>
              cardsIn(sl, st)
                .map((c) => cell(c.title))
                .join("<br>") || "—"
          )
          .join(" | ")} |`
    ),
  ];

  slices.forEach((sl, i) => {
    const count = steps.reduce((n, st) => n + cardsIn(sl, st).length, 0);
    lines.push(
      "",
      `## ${i + 1}. ${oneLine(sl.name)} (${count} ${count === 1 ? "story" : "stories"})`,
      ""
    );
    if (count === 0) {
      lines.push("_No stories yet._");
      return;
    }
    for (const st of steps) {
      for (const c of cardsIn(sl, st)) {
        const description = oneLine(c.description);
        lines.push(
          `- **${oneLine(st.name)}:** ${oneLine(c.title)}${description ? ` — ${description}` : ""}`
        );
      }
    }
  });

  return `${lines.join("\n")}\n`;
}
