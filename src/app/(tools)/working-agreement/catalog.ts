import type { CharterRuleCategory } from "@/lib/stores/workspace-types";

/** The categories in charter order, each with its label and theme-token badge colours. */
export const CATEGORIES: { id: CharterRuleCategory; label: string; className: string }[] = [
  {
    id: "communication",
    label: "Communication",
    className: "border-accent/40 bg-accent/10 text-accent",
  },
  { id: "meetings", label: "Meetings", className: "border-warning/40 bg-warning/10 text-warning" },
  {
    id: "decisions",
    label: "Decisions",
    className: "border-accent-magenta/40 bg-accent-magenta/10 text-accent-magenta",
  },
  { id: "work", label: "Work", className: "border-success/40 bg-success/10 text-success" },
  { id: "conflict", label: "Conflict", className: "border-danger/40 bg-danger/10 text-danger" },
  { id: "other", label: "Other", className: "border-border bg-surface text-sub" },
];

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<
  CharterRuleCategory,
  string
>;

export const CATEGORY_CLASS = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.className])
) as Record<CharterRuleCategory, string>;

export interface StarterRule {
  category: CharterRuleCategory;
  text: string;
}

/** Rules many teams start from; picking one adds it as the team's own. */
export const STARTER_CATALOG: StarterRule[] = [
  {
    category: "communication",
    text: "Default to async comms; use sync only when alignment is needed",
  },
  { category: "communication", text: "Acknowledge messages within 4 working hours" },
  {
    category: "communication",
    text: "No back-channel decisions — bring discussions to the team channel",
  },
  { category: "meetings", text: "Cameras-on for retros and 1:1s, optional otherwise" },
  { category: "meetings", text: "Every meeting has a written agenda 24h before" },
  { category: "meetings", text: "Standups are timeboxed to 15 min, no exceptions" },
  {
    category: "decisions",
    text: "Use the consent model — silence is consent if you're in the meeting",
  },
  { category: "decisions", text: "Reversible decisions ship today; irreversible ones get an RFC" },
  { category: "work", text: "PRs are reviewed within one working day" },
  { category: "work", text: "No solo merges to main — at least one approval required" },
  { category: "work", text: "Friday afternoons are protected for deep work / no meetings" },
  { category: "conflict", text: "Disagree in private, decide in public, commit publicly" },
  { category: "conflict", text: "If two people are stuck, escalate to the EM/coach within 24h" },
  { category: "conflict", text: "Critique the work, not the person" },
];

/** A rule's text as a dedupe key: case, spacing and a closing full stop don't make a new rule. */
export const ruleKey = (text: string): string =>
  text.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
