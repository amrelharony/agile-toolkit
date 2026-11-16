import { isExampleId } from "@/components/tool-frame/example-data";
import type { Story } from "@/lib/stores/workspace-types";
import { criteriaMarkdownLines, gwtLines } from "@/lib/stories/fields";
import { metCriteria, readinessState, type RefinementSession } from "./session";
import type { Criterion, StorySave } from "./store";
import { refinementVerdict } from "./verdict";

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

/**
 * Long text on one line and kept short, as Backlog Health's Markdown does:
 * the Markdown also travels in a share link, which is capped.
 */
function cap(v: string, max: number): string {
  const t = v.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A code fence longer than any run of backticks in `lines`, so none can end it early. */
function fenceFor(lines: readonly string[]): string {
  const longest = Math.max(0, ...lines.flatMap((l) => (l.match(/`+/g) ?? []).map((m) => m.length)));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * About how many characters the criteria section may take. The Markdown
 * also travels in a share link, capped at 32 KB, and the story tables need
 * room there too: unlike Backlog Health, which shows only its top stories
 * (10 by default), Refinement lists every story not started yet.
 */
export const CRITERIA_SECTION_MAX = 12_000;

/** One story's criteria under its title, both ways; nothing when it has neither. */
function storyCriteria(s: Story): string[] {
  const free = s.acceptanceCriteria?.trim();
  const gwt = gwtLines(s.gwt).map((l) => cap(l, 300));
  if (!free && gwt.length === 0) return [];
  const out = ["", `### ${cap(s.title, 200)}${isExampleId(s.id) ? " (example)" : ""}`, ""];
  if (free) out.push(...criteriaMarkdownLines(free));
  if (free && gwt.length > 0) out.push("");
  if (gwt.length > 0) {
    const fence = fenceFor(gwt);
    out.push(`${fence}gherkin`, ...gwt, fence);
  }
  return out;
}

/**
 * Each story's acceptance criteria, both ways: the free text (its own
 * lines, so a list stays a list), then the Given/When/Then scenarios. A
 * story with neither is left out, and with none at all there is no section.
 * Stories go in, in order, until about CRITERIA_SECTION_MAX characters. The
 * first always does: even at their longest, one story's criteria fit a
 * share link. A line counts the stories left out; the CSV has them whole.
 */
function criteriaSection(stories: readonly Story[]): string[] {
  const out: string[] = [];
  let size = 0;
  let more = 0;
  for (const s of stories) {
    const block = storyCriteria(s);
    if (block.length === 0) continue;
    const length = block.reduce((n, l) => n + l.length + 1, 0);
    if (more > 0 || (out.length > 0 && size + length > CRITERIA_SECTION_MAX)) {
      more++;
      continue;
    }
    out.push(...block);
    size += length;
  }
  if (out.length === 0) return [];
  if (more > 0) {
    out.push(
      "",
      `_Acceptance criteria for ${more} more ${more === 1 ? "story" : "stories"} are in the CSV export._`
    );
  }
  return ["", "## Acceptance criteria", ...out];
}

const points = (s: Story) =>
  typeof s.points === "number" && s.points > 0 ? String(s.points) : "Unsized";

/** The readiness badge's words, shared by the CSV and the Markdown. */
export const STATE_LABEL = {
  ready: "Ready",
  "needs-points": "Ready once sized",
  partial: "Partial",
  "not-ready": "Not ready",
  unchecked: "Not checked",
} as const;

function met(s: Story, criteria: readonly Criterion[]): string {
  if (!s.readiness || criteria.length === 0) return "—";
  return `${metCriteria(s.readiness.checked, criteria).length}/${criteria.length}`;
}

function storyTable(stories: readonly Story[], criteria: readonly Criterion[]): string[] {
  return [
    "| Story | Points | Criteria met | Status |",
    "|---|---:|---:|---|",
    ...stories.map(
      (s) =>
        `| ${md(s.title)}${isExampleId(s.id) ? " (example)" : ""} | ${points(s)} | ${met(s, criteria)} | ${
          STATE_LABEL[readinessState(s, criteria)]
        } |`
    ),
  ];
}

/**
 * The session as Markdown, for the refinement notes or the planning thread:
 * the verdict, the Definition of Ready, what's left to refine, what's
 * ready, those stories' acceptance criteria (as many as there is room
 * for), and the checks saved by name.
 */
export function toMarkdown(
  session: RefinementSession,
  criteria: readonly Criterion[],
  history: readonly StorySave[],
  now: Date = new Date()
): string {
  const lines = [`# Backlog refinement — ${mdDate(now)}`, "", `**${refinementVerdict(session)}**`];
  // An example left loaded beside the team's own stories mustn't read as their notes.
  if ([...session.toRefine, ...session.ready].some((s) => isExampleId(s.id))) {
    lines.push("", "_Includes example stories, marked (example)._");
  }

  lines.push("", "## Definition of Ready", "");
  if (criteria.length === 0) lines.push("No criteria yet.");
  else
    for (const c of criteria) {
      lines.push(`- ${md(c.label)}${c.description ? ` — ${md(c.description)}` : ""}`);
    }

  if (session.toRefine.length > 0) {
    lines.push(
      "",
      `## To refine (${session.toRefine.length})`,
      "",
      ...storyTable(session.toRefine, criteria)
    );
  }
  if (session.ready.length > 0) {
    lines.push(
      "",
      `## Ready (${session.ready.length})`,
      "",
      ...storyTable(session.ready, criteria)
    );
  }
  lines.push(...criteriaSection([...session.toRefine, ...session.ready]));
  if (history.length > 0) {
    lines.push(
      "",
      `## Earlier checks (${history.length})`,
      "",
      "| Story | Date | Criteria met | % ready |",
      "|---|---|---:|---:|",
      ...history.map(
        (h) =>
          `| ${md(h.storyName)} | ${md(h.date)} | ${h.metCount}/${h.totalCriteria} | ${h.passRate}% |`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
