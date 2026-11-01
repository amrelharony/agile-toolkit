import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { decisionLabel, roleHolders } from "../decisions/model";
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
 * The DACI prompt over the records raised in the DACI form: each one's
 * number, the ADR lifecycle status (proposed, accepted, deprecated,
 * superseded, with carried out and reopened as dates), its Driver,
 * Approver, Contributors and Informed, and what it still needs before
 * Decide (lib/decisions decisionIssues), as the Decision Log shows them,
 * under the verdict and time to decide over the whole log.
 */
export function generateDaciPrompts(
  data: DecisionRecordsData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const list = data.decisions;
  if (list.length === 0) return [];
  const today = data.today ?? todayLocalISO();
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const spec = TEMPLATES.daci;
  const { shown, note } = listedRecords(list);
  const table = formatTable(
    [
      "Number",
      "Title",
      "Status",
      "Driver",
      spec.deciderLabel,
      "Contributors",
      "Informed",
      "Waiting",
    ],
    shown.map((d) => [
      decisionLabel(d),
      d.title || "(untitled)",
      statusText(d),
      names(roleHolders(d, "driver")),
      d.decider?.trim() || "—",
      names(roleHolders(d, "contributor")),
      names(roleHolders(d, "informed")),
      waitingText(d, today),
    ])
  );
  // Titles and names are user-typed, and the verdict counts them.
  const body = wrapUserContent(
    `${logSummary(data, today)}\n\n${partLine(data, "daci")}${table}${note}${needsSection(shown, today)}`
  );
  return [
    {
      id: "daci-clarity",
      title: "Decision Clarity Audit",
      description: "Find decisions stuck open due to missing roles or unclear ownership.",
      prompt:
        buildPreamble(
          "DACI Decision Doc",
          "Each record names a Driver (runs the process), an Approver (the one person who makes the call), Contributors (consulted, no vote) and Informed (told once it's decided). Records share the Decision Log's numbering and its lifecycle: proposed → accepted → deprecated or superseded."
        ) +
        `${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Which proposed decisions are missing a Driver or an Approver?\n` +
        `2. Are any Approvers overloaded (named in many decisions)?\n` +
        `3. Which proposals have waited too long, and what unblocks them?\n` +
        `4. For decided records, which lacked enough Contributors or Informed before the call?\n` +
        `5. Recommend a default decision-making cadence to keep this list moving.`,
    },
  ];
}
