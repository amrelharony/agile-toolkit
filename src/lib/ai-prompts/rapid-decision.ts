import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { MANY_AGREE, decisionLabel, roleHolders } from "../decisions/model";
import { TEMPLATES } from "../decisions/templates";
import { todayLocalISO } from "../utils/formatters";
import {
  listedRecords,
  logSummary,
  needsSection,
  partLine,
  statusText,
  waitingText,
  type DecisionRecordsData,
} from "./decision-log";

const names = (list: readonly string[]) => (list.length === 0 ? "—" : list.join(", "));

/**
 * The RAPID prompt over the records raised in the RAPID form: each one's
 * number, the ADR lifecycle status (carried out as a date), who
 * Recommends, Agrees, Performs, gives Input and Decides, and what it still
 * needs (lib/decisions decisionIssues: a missing D or R, an Agree list
 * over MANY_AGREE), as the Decision Log shows them, under the verdict and
 * time to decide over the whole log.
 */
export function generateRapidPrompts(
  data: DecisionRecordsData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const list = data.decisions;
  if (list.length === 0) return [];
  const today = data.today ?? todayLocalISO();
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const spec = TEMPLATES.rapid;
  const label = (role: "recommend" | "agree" | "perform" | "input") =>
    spec.roles.find((r) => r.role === role)?.label ?? role;
  const { shown, note } = listedRecords(list);
  const table = formatTable(
    [
      "Number",
      "Title",
      "Status",
      label("recommend"),
      label("agree"),
      label("perform"),
      label("input"),
      spec.deciderLabel,
      "Waiting",
    ],
    shown.map((d) => [
      decisionLabel(d),
      d.title || "(untitled)",
      statusText(d),
      names(roleHolders(d, "recommend")),
      names(roleHolders(d, "agree")),
      names(roleHolders(d, "perform")),
      names(roleHolders(d, "input")),
      d.decider?.trim() || "—",
      waitingText(d, today),
    ])
  );
  // Titles and names are user-typed, and the verdict counts them.
  const body = wrapUserContent(
    `${logSummary(data, today)}\n\n${partLine(data, "rapid")}${table}${note}${needsSection(shown, today)}`
  );
  return [
    {
      id: "rapid-friction",
      title: "Decision Friction Audit",
      description: "Find decisions stuck because Agree-list is too long or roles conflict.",
      prompt:
        buildPreamble(
          "RAPID Decision Matrix",
          `Each record names who Recommends (R), who must Agree (A: each one is a veto, so ${MANY_AGREE} or fewer), who Performs (P), who gives Input (I) and the one person who Decides (D). Records share the Decision Log's numbering and its lifecycle: proposed → accepted → deprecated or superseded.`
        ) +
        `${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Which decisions have an over-large Agree list — friction risk?\n` +
        `2. Is the same person both Recommend and Decide on several records? Conflict.\n` +
        `3. Recommend a default escalation path when an Agree blocks a decision.\n` +
        `4. For records carried out, did Perform actually receive enough Input?\n` +
        `5. Recommend a quarterly review cadence for this set.`,
    },
  ];
}
