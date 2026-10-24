import type { Sprint, SprintReview, StoryStatus } from "@/lib/stores/workspace-types";
import type { ReviewFacts } from "@/lib/sprints/review-doc";
import { GOAL_OUTCOME_LABEL } from "@/lib/sprints/goal-doc";
import { SAY_DO_GRADE_LABEL } from "@/lib/sprints/metrics";
import { storyPoints } from "@/lib/sprints/plan";
import { fmt } from "@/lib/charts/chart-text";
import { CATEGORY_HEADINGS, FEEDBACK_CATEGORIES } from "./constants";
import { demoLength, demoMinutes } from "./doc";
import {
  notDoneSummary,
  pointsLabel,
  sourceNote,
  type BacklogProgress,
  type ReviewNumbers,
} from "./numbers";
import { reviewVerdict } from "./verdict";

/** "24 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A stored "YYYY-MM-DD" as "23 Oct 2026"; null when it isn't one. */
export function dayLabel(iso: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return mdDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** One line of text: newlines collapsed. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

export const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

export interface MarkdownContext {
  /** The sprint under review; absent for the draft. */
  sprint?: Pick<Sprint, "name">;
  facts: ReviewFacts | null;
  numbers: ReviewNumbers;
  /** All stories' points, when the numbers come from stories. */
  backlog?: BacklogProgress | null;
  /** The title of a story feedback was sent to, if it still exists. */
  storyTitle?: (id: string) => string | undefined;
}

/**
 * The whole review as one Markdown page, for the wiki or the stakeholders'
 * thread: the verdict, the goal and whether it was met, the demo script,
 * the numbers, the feedback (and which became backlog stories) and the
 * showcase checklist.
 */
export function toMarkdown(
  doc: SprintReview,
  { sprint, facts, numbers, backlog, storyTitle }: MarkdownContext,
  now: Date = new Date()
): string {
  const name = sprint?.name ?? (oneLine(doc.sprintName) || null);
  const lines: string[] = [
    name
      ? `# Sprint Review — ${oneLine(name)} · ${mdDate(now)}`
      : `# Sprint Review — ${mdDate(now)}`,
  ];
  const held = dayLabel(doc.meetingDate);
  if (held) lines.push("", `Review on ${held}`);
  lines.push("", `**${reviewVerdict({ doc, sprint, facts, numbers })}**`);

  // ── Goal ──
  if (sprint) {
    lines.push("", "## Sprint goal", "");
    if (facts?.goal) lines.push(`> ${oneLine(facts.goal)}`, "");
    const outcome = facts?.goalOutcome;
    if (outcome) {
      const note = oneLine(outcome.note);
      lines.push(`Goal met? **${GOAL_OUTCOME_LABEL[outcome.met]}**${note ? ` · ${note}` : ""}`);
    } else {
      lines.push(facts?.goal ? "Goal met? Not answered yet." : "No sprint goal was set.");
    }
  }

  // ── Demo script ──
  const { minutes, untimed } = demoLength(doc.features);
  const length = [
    minutes > 0 ? `${fmt(minutes)} min` : "",
    untimed > 0 ? `${untimed} not timed` : "",
  ]
    .filter(Boolean)
    .join(", ");
  lines.push("", `## Demo script${length ? ` (${length})` : ""}`, "");
  if (doc.features.length === 0) {
    lines.push("_Nothing on the demo script._");
  } else {
    doc.features.forEach((f, i) => {
      const m = demoMinutes(f);
      lines.push(
        `${i + 1}. **${oneLine(f.name) || "Untitled item"}**${m === null ? "" : ` · ${fmt(m)} min`}`
      );
      if (f.description.trim()) lines.push(`   - What: ${oneLine(f.description)}`);
      if (f.acceptanceCriteria.trim())
        lines.push(`   - Acceptance: ${oneLine(f.acceptanceCriteria)}`);
    });
  }

  // ── Numbers ──
  lines.push("", "## Numbers", "", `_${sourceNote(numbers, sprint?.name)}_`);
  if (numbers.committed > 0 || (numbers.completed ?? 0) > 0) {
    const done = numbers.completed;
    lines.push(
      "",
      "| Measure | Points |",
      "|---|---:|",
      `| Committed | ${numbers.committed > 0 ? fmt(numbers.committed) : "—"} |`,
      `| Completed | ${done === null ? "—" : fmt(done)} |`
    );
    if (numbers.sayDo) {
      lines.push(
        "",
        `Say/do: ${numbers.sayDo.pct}%, ${SAY_DO_GRADE_LABEL[numbers.sayDo.grade].toLowerCase()}.`
      );
    }
  }
  if (numbers.storyCount > 0) {
    lines.push("", `Stories: ${numbers.doneCount} of ${numbers.storyCount} done.`);
    if (facts && facts.unestimatedDone > 0) {
      lines.push(
        `${facts.unestimatedDone} done ${facts.unestimatedDone === 1 ? "story has" : "stories have"} no points.`
      );
    }
  }
  if (numbers.source === "stories" && backlog && backlog.total > 0) {
    lines.push("", `Product backlog: ${fmt(backlog.done)} of ${fmt(backlog.total)} points done.`);
  } else if (numbers.source !== "stories" && doc.totalBacklog > 0) {
    lines.push(
      "",
      `Release progress: ${fmt(doc.backlogDone)} of ${fmt(doc.totalBacklog)} points done.`
    );
  }
  if (facts && facts.notDone.length > 0) {
    lines.push(
      "",
      `### Not done (${notDoneSummary(facts.notDone)})`,
      "",
      ...facts.notDone.map((s) => {
        const estimate =
          typeof s.points === "number" ? pointsLabel(storyPoints(s)) : "not estimated";
        return `- ${oneLine(s.title)} · ${estimate} · ${STORY_STATUS_LABEL[s.status] ?? s.status}`;
      })
    );
  }

  // ── Feedback ──
  lines.push("", "## Stakeholder feedback");
  const written = doc.feedbackItems.filter((f) => f.feedback.trim());
  if (written.length === 0) {
    lines.push("", "_No feedback recorded._");
  } else {
    for (const cat of FEEDBACK_CATEGORIES) {
      const items = written.filter((f) => f.category === cat);
      if (items.length === 0) continue;
      lines.push("", `### ${CATEGORY_HEADINGS[cat]}`, "");
      for (const f of items) {
        const link = (f.sentTo ?? []).find((l) => l.route === "backlog-story");
        const title = link ? storyTitle?.(link.targetId) : undefined;
        const sent = title ? ` _(on the backlog: “${oneLine(title)}”)_` : "";
        lines.push(`- **${oneLine(f.stakeholder) || "Unnamed"}:** ${oneLine(f.feedback)}${sent}`);
      }
    }
    const other = written.filter((f) => !FEEDBACK_CATEGORIES.includes(f.category));
    if (other.length > 0) {
      lines.push("", "### Not categorised", "");
      for (const f of other) {
        lines.push(`- **${oneLine(f.stakeholder) || "Unnamed"}:** ${oneLine(f.feedback)}`);
      }
    }
  }

  // ── Checklist ──
  const ready = doc.checklistItems.filter((c) => c.checked).length;
  if (doc.checklistItems.length > 0) {
    lines.push(
      "",
      `## Showcase checklist (${ready} of ${doc.checklistItems.length} ready)`,
      "",
      ...doc.checklistItems.map((c) => `- [${c.checked ? "x" : " "}] ${oneLine(c.label)}`)
    );
  }

  return `${lines.join("\n")}\n`;
}

/** The demo script alone, for the meeting invite or the presenter's notes. */
export function demoScript(doc: SprintReview, sprintName?: string): string {
  const name = sprintName ?? (oneLine(doc.sprintName) || null);
  const { minutes, untimed } = demoLength(doc.features);
  const lines = [name ? `# Demo script — ${oneLine(name)}` : "# Demo script", ""];
  lines.push(
    `Estimated length: ${fmt(minutes)} min${
      untimed > 0 ? ` (${untimed} ${untimed === 1 ? "item" : "items"} not timed)` : ""
    }`
  );
  doc.features.forEach((f, i) => {
    const m = demoMinutes(f);
    lines.push(
      "",
      `## ${i + 1}. ${oneLine(f.name) || "Untitled item"}${m === null ? "" : ` (${fmt(m)} min)`}`
    );
    if (f.description.trim()) lines.push(`What: ${oneLine(f.description)}`);
    if (f.acceptanceCriteria.trim()) {
      lines.push(`Acceptance criteria: ${oneLine(f.acceptanceCriteria)}`);
    }
  });
  return `${lines.join("\n")}\n`;
}
