import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Decision, DecisionTemplate, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import {
  daysWaiting,
  decisionIssues,
  decisionLabel,
  decisionVerdict,
  templateOf,
  timeToDecide,
} from "../decisions/model";
import { DECISION_STATUS_LABEL, TEMPLATES } from "../decisions/templates";
import { isExampleId } from "../utils/example-id";
import { todayLocalISO } from "../utils/formatters";
import { byNumberDesc } from "@/app/(tools)/decision-log/view";

/**
 * Decision records as the Decision Log page reads them, on any of its
 * three routes: the records the prompt lists (workspace.decisions, read
 * through lib/decisions: the whole log, or one template's), the whole log
 * the page's verdict and time to decide count over on every route (`all`;
 * the listed records when left out), and today for how long a proposal has
 * waited.
 */
export interface DecisionRecordsData {
  decisions: readonly Decision[];
  all?: readonly Decision[];
  today?: string;
}

/** A table lists this many records, newest number first. */
const MAX_RECORDS = 15;

/** The records the table lists, in the log's order, and a note when some are left out. */
export function listedRecords(list: readonly Decision[]): { shown: Decision[]; note: string } {
  const shown = [...list].sort(byNumberDesc).slice(0, MAX_RECORDS);
  const note =
    list.length > shown.length ? `\n(Showing ${shown.length} of ${list.length} records)` : "";
  return { shown, note };
}

/**
 * The ADR lifecycle status as the card shows it, with DACI/RAPID's
 * "implemented" and "revisit" as the dates they are: "Accepted, carried out
 * 2026-10-01", "Proposed, reopened 2026-10-20".
 */
export function statusText(d: Decision): string {
  const label = DECISION_STATUS_LABEL[d.status] ?? String(d.status);
  if (d.status === "proposed" && d.reopenedAt) return `${label}, reopened ${d.reopenedAt}`;
  if (d.implementedAt) return `${label}, carried out ${d.implementedAt}`;
  return label;
}

/** How long a proposal has waited ("12 days", since it was raised or reopened); "—" otherwise. */
export function waitingText(d: Decision, today: string): string {
  const days = daysWaiting(d, today);
  return days === null ? "—" : `${days} ${days === 1 ? "day" : "days"}`;
}

/** The whole log, which the verdict and time to decide count over. */
const wholeLog = (data: DecisionRecordsData) => data.all ?? data.decisions;

/** True when the prompt lists one template's records out of a bigger log. */
const listsPart = (data: DecisionRecordsData) => wholeLog(data).length > data.decisions.length;

/**
 * The page's verdict and how long decisions take, as every route states
 * them: over the whole log (decisionVerdict over every record, timeToDecide
 * with examples left out), whichever records the prompt lists. The verdict
 * counts user-typed titles, so it goes inside the untrusted block.
 */
export function logSummary(data: DecisionRecordsData, today: string): string {
  const all = wholeLog(data);
  const speed = timeToDecide(all.filter((d) => !isExampleId(d.id)));
  const speedLine = speed
    ? `\nDecisions take ${speed.medianDays} ${speed.medianDays === 1 ? "day" : "days"} from raised to decided (median of ${speed.n}).`
    : "";
  const scope = listsPart(data) ? "The whole log, every template:\n" : "";
  return `${scope}Verdict: ${sanitizePromptCell(decisionVerdict(all, today), 400)}${speedLine}`;
}

/**
 * "The DACI records, 3 of the log's 6:" above a table that lists one
 * template's records, so it doesn't read as the whole log; "" when the
 * table lists every record.
 */
export function partLine(data: DecisionRecordsData, template: DecisionTemplate): string {
  return listsPart(data)
    ? `The ${TEMPLATES[template].label} records, ${data.decisions.length} of the log's ${wholeLog(data).length}:\n\n`
    : "";
}

/**
 * What the listed records still need (lib/decisions decisionIssues, the
 * card's checks), one line per record that needs something: "" when none
 * does. A list, not a table column, so no message is cut short.
 */
export function needsSection(shown: readonly Decision[], today: string): string {
  const lines = shown.flatMap((d) => {
    const issues = decisionIssues(d, today);
    return issues.length === 0
      ? []
      : [`- ${decisionLabel(d)}: ${issues.map((i) => i.message).join(" ")}`];
  });
  return lines.length === 0 ? "" : `\n\n## What records still need\n\n${lines.join("\n")}`;
}

/**
 * Which of a record's context and consequences are written down, so the
 * review question about them has something to read.
 */
function writtenUp(d: Pick<Decision, "context" | "consequences">): string {
  const context = !!d.context?.trim();
  const consequences = !!d.consequences?.trim();
  if (context && consequences) return "Context and consequences";
  if (context) return "Context only";
  if (consequences) return "Consequences only";
  return "Neither";
}

/**
 * The ADR prompts over the log: each record's number (one sequence across
 * the templates, ADR-0003 / DACI-0004), its template, the ADR lifecycle
 * status, who decided and what still needs doing, with the log's verdict
 * and how long decisions take, as the page states them. The page lists
 * every record on each route, so the log's prompts are given them all.
 */
export function generateDecisionLogPrompts(
  data: DecisionRecordsData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const list = data.decisions;
  if (list.length === 0) return [];
  const today = data.today ?? todayLocalISO();
  const context = buildWorkspaceContext(workspace);
  const { shown, note } = listedRecords(list);

  const table = formatTable(
    [
      "Number",
      "Template",
      "Title",
      "Status",
      "Raised",
      "Decided",
      "Decider",
      "Outcome",
      "Written up",
    ],
    shown.map((d) => [
      decisionLabel(d),
      TEMPLATES[templateOf(d)].label,
      d.title || "(untitled)",
      statusText(d),
      d.date,
      d.decidedAt ?? "—",
      d.decider?.trim() || "—",
      d.decision.trim() ? d.decision.slice(0, 80) : "Not written down",
      writtenUp(d),
    ])
  );
  // Titles, outcomes and names are user-typed, and the verdict counts them.
  const body = wrapUserContent(
    `${logSummary(data, today)}\n\n${partLine(data, "adr")}${table}${note}${needsSection(shown, today)}`
  );
  const lifecycle =
    "Each record is numbered in one sequence across the ADR, DACI and RAPID templates and moves through proposed → accepted → deprecated or superseded.";

  return [
    {
      id: "adr-review",
      title: "ADR Quality Review",
      description: "Coach on completeness and clarity of your architecture decisions.",
      prompt:
        buildPreamble(
          "Decision Log",
          `Each record captures the context, the options weighed, the outcome and its consequences. ${lifecycle}`
        ) +
        `## Decisions\n\n${body}${context}\n\n## Questions\n\n1. Which records have too little context or consequences written down, or an accepted outcome that isn't written down?\n2. Are any decisions clearly replaced but still accepted, or proposals that have waited too long?\n3. What patterns do you see in the team's decision-making?\n4. Suggest 3 improvements to how this team documents decisions.`,
    },
    {
      id: "adr-risk",
      title: "Risk Signals in ADRs",
      description: "Surface decisions that may be creating future risk.",
      prompt:
        buildPreamble(
          "Decision Log",
          `Architectural decisions often lock in future behaviors — some decisions create latent risk. ${lifecycle}`
        ) +
        `## Decisions\n\n${body}${context}\n\n## Questions\n\n1. Which decisions look high-risk (e.g., one-way doors, unclear trade-offs)?\n2. Where is consequence analysis thin or missing?\n3. Are any alternatives rejected too quickly without evidence?\n4. What should the team revisit at the next architecture review?`,
    },
  ];
}
