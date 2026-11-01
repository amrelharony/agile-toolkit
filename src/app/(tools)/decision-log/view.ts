/**
 * What the Decision Log page shows, per route and per record: which tool a
 * route is, the template filter, the list order, the links between records
 * and the exports. Pure: the records come from lib/decisions.
 */

import type { Decision, DecisionTemplate } from "@/lib/stores/workspace-types";
import {
  DECISION_TEXT_MAX,
  DECISION_TITLE_MAX,
  decisionLabel,
  optionsOf,
  roleHolders,
  templateOf,
} from "@/lib/decisions/model";
import { TEMPLATES } from "@/lib/decisions/templates";
import { isIsoDate } from "@/lib/sprints/calendar";
import { isExampleId } from "@/lib/utils/example-id";
import { DACI_ACTIONS, DECISION_ACTIONS, RAPID_ACTIONS } from "@/lib/history/event-actions";

export { DECISION_TEXT_MAX, DECISION_TITLE_MAX };

/** A person's name, as the pickers keep it. */
export const NAME_MAX = 120;

/**
 * Each route is its own tool page (its own title, history and next steps),
 * opening the merged log with its template as the default for New, as the
 * standup's two modes keep their two pages.
 */
export const PAGE: Readonly<
  Record<DecisionTemplate, { toolId: string; title: string; description: string }>
> = {
  adr: {
    toolId: "decision-log",
    title: "Decision Log (ADR)",
    description:
      "Record architecture and product decisions with their options, outcome and consequences, numbered, so the team's reasoning outlives any one person.",
  },
  daci: {
    toolId: "daci",
    title: "DACI Decision Doc",
    description:
      "Name a Driver, an Approver, Contributors and Informed for each decision. The same records as the Decision Log, raised in the DACI form.",
  },
  rapid: {
    toolId: "rapid-decision",
    title: "RAPID Decision Matrix",
    description:
      "Name who Recommends, Agrees, Performs, gives Input and Decides. The same records as the Decision Log, raised in the RAPID form.",
  },
};

/** The history events each route logs (the three tools' own vocabularies). */
export const HISTORY: Readonly<
  Record<DecisionTemplate, { added: string; updated: string; removed: string; decided: string }>
> = {
  adr: {
    added: DECISION_ACTIONS.DECISION_ADDED,
    updated: DECISION_ACTIONS.DECISION_UPDATED,
    removed: DECISION_ACTIONS.DECISION_REMOVED,
    decided: DECISION_ACTIONS.STATUS_CHANGED,
  },
  daci: {
    added: DACI_ACTIONS.DECISION_ADDED,
    updated: DACI_ACTIONS.DECISION_UPDATED,
    removed: DACI_ACTIONS.DECISION_REMOVED,
    decided: DACI_ACTIONS.DECISION_DECIDED,
  },
  rapid: {
    added: RAPID_ACTIONS.DECISION_ADDED,
    updated: RAPID_ACTIONS.DECISION_UPDATED,
    removed: RAPID_ACTIONS.DECISION_REMOVED,
    decided: RAPID_ACTIONS.DECISION_DECIDED,
  },
};

/** The template filter: every record, or one template's. */
export type TemplateFilter = "all" | DecisionTemplate;

export function matchesTemplate(d: Decision, filter: TemplateFilter): boolean {
  return filter === "all" || templateOf(d) === filter;
}

/** Records per template, for the filter chips' counts. */
export function countByTemplate(list: readonly Decision[]): Record<TemplateFilter, number> {
  const out: Record<TemplateFilter, number> = { all: list.length, adr: 0, daci: 0, rapid: 0 };
  for (const d of list) out[templateOf(d)] += 1;
  return out;
}

/**
 * The log's order: newest number first (the number is fixed once given,
 * so editing never moves a record); records still waiting for a number
 * after them, newest day first.
 */
export function byNumberDesc(a: Decision, b: Decision): number {
  const na = a.number ?? 0;
  const nb = b.number ?? 0;
  if (na !== nb) return nb - na;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The records `d` replaced (their supersededBy is d). */
export function supersededRecords(list: readonly Decision[], id: string): Decision[] {
  return list.filter((x) => x.supersededBy === id && x.id !== id);
}

/** Why one record can't replace another (replacementError). */
export type ReplacementError = "self" | "not_found" | "example_mismatch" | "not_in_force" | "loop";

/** Whether following `from`'s "superseded by" links reaches `id`. */
function leadsTo(list: readonly Decision[], from: Decision, id: string): boolean {
  const seen = new Set<string>();
  let at: Decision | undefined = from;
  while (at?.supersededBy && !seen.has(at.id)) {
    if (at.supersededBy === id) return true;
    seen.add(at.id);
    const next: string = at.supersededBy;
    at = list.find((x) => x.id === next);
  }
  return false;
}

/**
 * Why the record `byId` can't replace `d`, or null. A replacement is
 * another record of the same kind (an example only by an example, a
 * team's only by the team's: an example's link would break when the
 * example is cleared), still in force (proposed or accepted: a deprecated
 * or replaced record replaces nothing), and not one `d` already replaced,
 * directly or down a chain (A by B, then B by A, would leave nothing in
 * force). tool.decision_log's supersede and set_status apply the same
 * rules (lib/actions/tools/decision-log replacementRefusal).
 */
export function replacementError(
  list: readonly Decision[],
  d: Decision,
  byId: string
): ReplacementError | null {
  if (byId === d.id) return "self";
  const by = list.find((x) => x.id === byId);
  if (!by) return "not_found";
  if (isExampleId(by.id) !== isExampleId(d.id)) return "example_mismatch";
  if (by.status === "superseded" || by.status === "deprecated") return "not_in_force";
  if (leadsTo(list, by, d.id)) return "loop";
  return null;
}

/** The records that can replace `d` (replacementError), newest first. */
export function replacementsFor(list: readonly Decision[], d: Decision): Decision[] {
  return list.filter((x) => replacementError(list, d, x.id) === null).sort(byNumberDesc);
}

/**
 * "ADR-0004 · Host on AWS" for a picker or a link; "a deleted record" for
 * an id no longer in the list (a replacement deleted since keeps its id
 * on the record it replaced).
 */
export function recordName(list: readonly Decision[], id: string): string {
  const d = list.find((x) => x.id === id);
  return d ? `${decisionLabel(d)} · ${d.title || "Untitled"}` : "a deleted record";
}

/** Why a typed day can't be the day a decision was reopened, or null. */
export function reopenedDayError(day: string, d: Decision, today: string): string | null {
  if (!day || !isIsoDate(day)) return "Pick the day it was reopened.";
  if (day > today) return "Pick today or an earlier day.";
  const from = d.decidedAt ?? d.date;
  if (from && isIsoDate(from) && day < from) {
    return d.decidedAt
      ? "It can't be reopened before it was decided."
      : "It can't be reopened before it was raised.";
  }
  return null;
}

/** Why a typed day can't be the day a record was raised, or null. */
export function raisedDayError(day: string, today: string): string | null {
  if (!day || !isIsoDate(day)) return "Pick the day it was raised.";
  if (day > today) return "Pick today or an earlier day.";
  return null;
}

/** Why a typed day can't be the day it was decided, or null. */
export function decidedDayError(day: string, raised: string, today: string): string | null {
  if (!day || !isIsoDate(day)) return "Pick the day it was decided.";
  if (day > today) return "Pick today or an earlier day.";
  if (raised && isIsoDate(raised) && day < raised)
    return "It can't be decided before it was raised.";
  return null;
}

/** Why a typed day can't be the day it was carried out, or null. */
export function implementedDayError(day: string, d: Decision, today: string): string | null {
  if (!day || !isIsoDate(day)) return "Pick the day it was carried out.";
  if (day > today) return "Pick today or an earlier day.";
  const from = d.decidedAt ?? d.date;
  if (from && isIsoDate(from) && day < from)
    return "It can't be carried out before it was decided.";
  return null;
}

/* ── Exports ─────────────────────────────────────────────────────────── */

const roleText = (d: Decision, role: Parameters<typeof roleHolders>[1]) =>
  roleHolders(d, role).join("; ");

/**
 * The CSV: one row per record of `list`, every field the three forms hold.
 * `all` names the records they link to (with a filter chip on, a
 * replacement of another form isn't in `list`).
 */
export function decisionsCsv(
  list: readonly Decision[],
  all: readonly Decision[] = list
): {
  headers: string[];
  rows: string[][];
} {
  return {
    headers: [
      "Number",
      "Template",
      "Title",
      "Status",
      "Date",
      "Decided",
      "Implemented",
      "Decider",
      "Driver",
      "Contributors",
      "Informed",
      "Recommend",
      "Agree",
      "Perform",
      "Input",
      "Context",
      "Options",
      "Chosen option",
      "Recommendation",
      "Outcome",
      "Consequences",
      "Superseded by",
      "ID",
    ],
    rows: list.map((d) => {
      const options = optionsOf(d);
      return [
        decisionLabel(d),
        TEMPLATES[templateOf(d)].label,
        d.title,
        d.status,
        d.date,
        d.decidedAt ?? "",
        d.implementedAt ?? "",
        d.decider ?? "",
        roleText(d, "driver"),
        roleText(d, "contributor"),
        roleText(d, "informed"),
        roleText(d, "recommend"),
        roleText(d, "agree"),
        roleText(d, "perform"),
        roleText(d, "input"),
        d.context ?? "",
        // "; " keeps each cell on one line for tools that expect that.
        options.map((o) => o.text).join("; "),
        options.find((o) => o.id === d.chosenOptionId)?.text ?? "",
        d.recommendation ?? "",
        d.decision,
        d.consequences ?? "",
        d.supersededBy ? recordName(all, d.supersededBy) : "",
        d.id,
      ];
    }),
  };
}
