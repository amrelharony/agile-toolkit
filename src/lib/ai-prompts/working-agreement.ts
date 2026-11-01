import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { CharterCheckInResult, Workspace } from "../stores/workspace-types";
// The agreement's own words (pure, server-safe): a day as the page shows it.
import { dayLabel } from "../working-agreement/model";

interface Rule {
  id: string;
  category: string;
  text: string;
  agreedBy: string[];
  description?: string;
  /** Its mark in the check-in in progress: working, not working, or "partly" working. */
  stillWorking?: boolean | "partly";
  /**
   * What the saved check-ins found when it wasn't working, newest first
   * (`slippingRun`): empty when the latest round that checked it found it
   * working; absent when no saved round has checked it.
   */
  slipping?: readonly Exclude<CharterCheckInResult, "working">[];
}

interface CharterMeta {
  teamName?: string;
  version: number;
  publishedAt?: string;
  description?: string;
}

/** A rule's saved check-ins as its card says them: "partly working in the last 2 check-ins". */
function checkInWords(slipping: Rule["slipping"]): string {
  if (slipping === undefined) return "not checked yet";
  if (slipping.length === 0) return "working in the last check-in";
  const how = slipping.every((r) => r === "not_working")
    ? "not working"
    : slipping.every((r) => r === "partly")
      ? "partly working"
      : "not fully working";
  return slipping.length >= 2
    ? `${how} in the last ${slipping.length} check-ins`
    : `${how} in the last check-in`;
}

/** A rule's mark in the round in progress. */
function markWords(mark: Rule["stillWorking"]): string {
  if (mark === undefined) return "not marked";
  return mark === "partly" ? "partly working" : mark ? "working" : "not working";
}

export function generateWorkingAgreementPrompts(
  data: {
    rules: Rule[];
    meta: CharterMeta;
    /** Whether the draft has changes not yet published (`hasUnpublishedChanges`). */
    unpublishedChanges?: boolean;
    /**
     * The latest saved check-in, in the page's words ("4 of 6 working, 1
     * partly": `adherencePhrase`), with its percentage when the page quotes
     * one; null before the first.
     */
    lastCheckIn: { summary: string; pct: number | null } | null;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.rules.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const byCat = new Map<string, number>();
  for (const r of data.rules) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
  const catSummary = Array.from(byCat.entries())
    .map(([c, n]) => `${c} ${n}`)
    .join(", ");

  // Published as the page's verdict reads it (agreementVerdict): a version
  // with a date. Version 0, or no date, is a draft nobody has published.
  const { meta } = data;
  const rules = `${data.rules.length} ${data.rules.length === 1 ? "rule" : "rules"}`;
  const charter =
    meta.version > 0 && meta.publishedAt
      ? `${rules} in v${meta.version} (published ${dayLabel(meta.publishedAt)})${
          data.unpublishedChanges ? ", with changes not yet published" : ""
        }`
      : `${rules}, not published yet`;

  const last = data.lastCheckIn;
  const checkIn = last
    ? `Latest check-in: ${last.summary}${last.pct !== null ? ` (${last.pct}% adherence, a rule partly working counting half)` : ""}.`
    : "No check-in saved yet.";

  // What the rule cards show: each rule's saved check-ins, and its mark in
  // the round in progress. A column nothing fills is left out.
  const anyChecked = data.rules.some((r) => r.slipping !== undefined);
  const anyMarked = data.rules.some((r) => r.stillWorking !== undefined);
  const ruleTable = formatTable(
    [
      "Category",
      "Rule",
      "Agreed by",
      ...(anyChecked ? ["Saved check-ins"] : []),
      ...(anyMarked ? ["This round"] : []),
    ],
    data.rules
      .slice(0, 20)
      .map((r) => [
        r.category,
        r.text.slice(0, 80),
        r.agreedBy.length > 0 ? r.agreedBy.join(", ") : "—",
        ...(anyChecked ? [checkInWords(r.slipping)] : []),
        ...(anyMarked ? [markWords(r.stillWorking)] : []),
      ])
  );
  const marksNote = anyMarked
    ? `\n\n_"This round" is the check-in in progress, not saved yet._`
    : "";

  // Rules that stop working: from what the check-ins found, or from how to
  // find out when there is none to quote.
  const renegotiate = last
    ? "4. How should the team revisit and renegotiate rules that stop working? Start from what the check-ins found: the latest round above, and each rule's saved check-ins in the table."
    : "4. How should the team check whether its rules still work (no check-in is saved yet), and revisit and renegotiate those that stop working?";

  return [
    {
      id: "wa-completeness",
      title: "Charter completeness review",
      description: "Audit gaps across communication, decisions, work norms, and conflict-handling.",
      prompt:
        buildPreamble(
          "Working Agreement Builder",
          `Team "${sanitizePromptCell(meta.teamName ?? "(unnamed)")}": ${charter}. Rules by category: ${catSummary}. ${checkIn}`
        ) +
        `## Rules\n\n${ruleTable}${marksNote}${context}\n\n## Questions\n\n1. Which categories are under-developed (e.g. no rule covers conflict)?\n2. Are any rules vague or unmeasurable (e.g. "be respectful" with no behavioural anchor)?\n3. Suggest 3-5 missing rules that would round out the charter.\n4. For rules with no \`agreedBy\` names, what would you do to drive explicit commitment?`,
    },
    {
      id: "wa-conflict",
      title: "Conflict-anticipation rules",
      description:
        "Generate concrete conflict-handling and decision-stalemate rules tailored to this team.",
      prompt:
        buildPreamble(
          "Working Agreement Builder",
          `${charter}. ${checkIn} The team has not yet stress-tested the charter against disagreement.`
        ) +
        `## Existing Rules\n\n${ruleTable}${marksNote}${context}\n\n## Questions\n\n1. Where is the charter silent on what happens when people disagree (technical decisions, sprint scope, on-call swaps)?\n2. Propose 3 specific conflict-handling rules with a clear escalation path.\n3. Suggest a decision-rights model (consent / consensus / advice) the team could adopt.\n${renegotiate}`,
    },
  ];
}
