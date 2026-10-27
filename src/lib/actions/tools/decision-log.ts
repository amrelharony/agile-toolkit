/**
 * Decision Log — tool-local actions, the one agent surface of the decision
 * record shared by the Decision Log (ADR), DACI and RAPID.
 *
 * Category: Risk & Governance
 * Tool:     Decision records (workspace.decisions). `template` says which
 *           form a record was raised with (adr | daci | rapid; absent:
 *           adr), every record follows the ADR lifecycle (proposed →
 *           accepted → deprecated / superseded), and one number sequence
 *           runs across the forms (ADR-0003, DACI-0004).
 *
 * Agent surface: tool.decision_log.*
 *   1. list_state      — the records as the page lists them: numbers and
 *                        labels, forms, options, people, what each still
 *                        needs (issues), the verdict and the time to decide.
 *   2. add_decision    — raise a record in any form, numbered.
 *   3. decide          — record the outcome, the option chosen, the decider
 *                        and the day (accepts the record).
 *   4. supersede       — name the record that replaces this one.
 *   5. reopen          — back to proposed (DACI's "revisit").
 *   6. set_status      — kept: any lifecycle status; terminal ones confirm.
 *   7. add_alternative — kept: append an option (an old ADR's alternative).
 *   8. add_option      — append an option, with a note.
 *   9. assign_role     — put a person in one of the form's roles.
 *  10. set_decider     — the one person with the final say.
 *  11. delete          — remove a record as the page's delete does: from
 *                        all three collections, so an old DACI / RAPID row
 *                        can't read back in (workspace.decision.delete
 *                        removes the workspace row only).
 *
 * Reads go through lib/decisions exactly as the page does: the stored
 * records, the old DACI and RAPID rows read through as records under their
 * own ids, and the old Decision Log blob's rows still waiting for the
 * page's one-time move (read only), so an agent sees what the page lists.
 * A write saves a Decision under the record's id; an old DACI/RAPID row
 * stays behind as the backup, shadowed. tool.daci.* and
 * tool.rapid_decision.* are aliases onto the same records (daci.ts,
 * rapid-decision.ts), through the store adapter exported here.
 *
 * Entity kinds: "workspace:decision" (plus "workspace:daciDecision" and
 * "workspace:rapidDecision" read through), matching the browser sync and
 * the generic workspace.decision.* CRUD.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import type { ActionContext } from "../context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverDeleteEntity,
  serverGetEntity,
  serverGetUserStateBlob,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import type {
  DACIDecision,
  Decision,
  DecisionRole,
  DecisionStatus,
  DecisionTemplate,
  RAPIDDecision,
  TeamMember,
} from "@/lib/stores/workspace-types";
import {
  DECISION_ROLES,
  DECISION_STATUSES,
  DECISION_TEMPLATES,
  DECISION_TEXT_MAX,
  DECISION_TITLE_MAX,
  allDecisions,
  decide,
  decideError,
  decisionIssues,
  decisionLabel,
  decisionVerdict,
  nextDecisionNumber,
  optionsOf,
  reopen,
  roleHolders,
  supersede,
  templateOf,
  timeToDecide,
} from "@/lib/decisions/model";
import { SINGLE_ROLES, TEMPLATES } from "@/lib/decisions/templates";
import {
  DECISION_LOG_KEY,
  DECISION_LOG_MOVED_KEY,
  isPendingDecisionLogRow,
  withPendingDecisionLog,
} from "@/lib/decisions/legacy-log";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { isIsoDate } from "@/lib/sprints/calendar";
import { addDays } from "@/lib/impediments/model";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";

/** MUST match registerCollection("decision", …) in workspace-store.ts. */
export const KIND_DECISION = "workspace:decision";
const KIND_DACI = "workspace:daciDecision";
const KIND_RAPID = "workspace:rapidDecision";
const KIND_MEMBER = "workspace:teamMember";

const NAME_MAX = 120;

/**
 * A new record's id: the shape the page and the hand-offs use
 * (lib/decisions/store newDecisionId), made here so the server path never
 * loads that browser module.
 */
export const newRecordId = (): string => nanoid(8);

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter (shared with the DACI and RAPID aliases) ───────── */

export interface DecisionRecords {
  /** Every record as the Decision Log lists it. */
  records: Decision[];
  /** Ids of rows of the old Decision Log blob still waiting for the page's move. */
  pendingIds: string[];
}

/** Where the records live: the browser's workspace, or the user's rows on the server. */
export interface DecisionStore {
  list(): Promise<DecisionRecords>;
  /** Save a record under its id. */
  put(d: Decision): Promise<void>;
  /**
   * Remove the id from all three collections (the record, and an old DACI
   * or RAPID row under it, which would otherwise read back in).
   */
  remove(id: string): Promise<void>;
  roster(): Promise<TeamMember[]>;
}

const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/** The records as the page reads them, from the three collections and the old blob. */
function recordsFrom(
  decisions: readonly Decision[] | undefined,
  daci: readonly DACIDecision[] | undefined,
  rapid: readonly RAPIDDecision[] | undefined,
  blob: unknown,
  movedRaw: unknown
): DecisionRecords {
  const moved = idsOf(movedRaw);
  const records = withPendingDecisionLog(allDecisions(decisions, daci, rapid), blob, moved);
  return {
    records,
    pendingIds: records.filter((d) => isPendingDecisionLogRow(d.id, blob, moved)).map((d) => d.id),
  };
}

/** A usePersisted blob as this browser holds it (it mirrors the cloud row), or null. */
function browserBlob(key: string): unknown {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const browserDecisionStore: DecisionStore = {
  list: async () => {
    const s = ws();
    return recordsFrom(
      s.decisions,
      s.daciDecisions,
      s.rapidDecisions,
      browserBlob(DECISION_LOG_KEY),
      browserBlob(DECISION_LOG_MOVED_KEY)
    );
  },
  put: async (d) => ws().upsertDecision(d),
  // As lib/decisions/store removeDecisionRecord does (the store's removes
  // unpin the canvas cards), without its browser-only blob write: a row
  // still waiting for the move is refused before this runs.
  remove: async (id) => {
    const s = ws();
    if (s.decisions.some((d) => d.id === id)) s.removeDecision(id);
    if ((s.daciDecisions ?? []).some((d) => d.id === id)) s.removeDACIDecision(id);
    if ((s.rapidDecisions ?? []).some((r) => r.id === id)) s.removeRAPIDDecision(id);
  },
  roster: async () => ws().teamMembers ?? [],
};

export function serverDecisionStore(userId: string): DecisionStore {
  return {
    list: async () => {
      const [decisions, daci, rapid, blob, moved] = await Promise.all([
        serverListEntities<Decision>(userId, KIND_DECISION),
        serverListEntities<DACIDecision>(userId, KIND_DACI),
        serverListEntities<RAPIDDecision>(userId, KIND_RAPID),
        serverGetUserStateBlob(userId, DECISION_LOG_KEY),
        serverGetUserStateBlob(userId, DECISION_LOG_MOVED_KEY),
      ]);
      return recordsFrom(decisions, daci, rapid, blob, moved);
    },
    put: async (d) => {
      await serverUpsertEntity<Decision>(userId, KIND_DECISION, d);
    },
    // A tombstone per collection that holds the id (none for one that doesn't).
    remove: async (id) => {
      const kinds = [KIND_DECISION, KIND_DACI, KIND_RAPID];
      const held = await Promise.all(
        kinds.map((kind) => serverGetEntity<{ id: string }>(userId, kind, id))
      );
      await Promise.all(
        kinds.filter((_, i) => held[i]).map((kind) => serverDeleteEntity(userId, kind, id))
      );
    },
    roster: async () => serverListEntities<TeamMember>(userId, KIND_MEMBER),
  };
}

/** The roster's spelling of a name, or the name as given (trimmed). */
export function rosterName(name: string, roster: readonly TeamMember[]): string {
  const t = name.trim();
  return findRosterMember(roster, t)?.name ?? t;
}

/**
 * Save a new record with the next number in the log (one past the highest
 * across every form, examples aside), as the page's createDecision does.
 */
export async function createRecord(
  store: DecisionStore,
  input: Omit<Decision, "number">
): Promise<Decision> {
  const { records } = await store.list();
  const d: Decision = { ...input, number: nextDecisionNumber(records) };
  await store.put(d);
  return d;
}

type Out = Record<string, unknown>;

/**
 * Change one record with `fn` (given the record as the page reads it and
 * every record); `{refuse}` writes nothing, and `{same}` reports success
 * without a write. Unknown ids answer `missing`.
 */
export async function changeRecord(
  store: DecisionStore,
  id: string,
  missing: Out,
  fn: (
    d: Decision,
    all: readonly Decision[],
    roster: readonly TeamMember[]
  ) =>
    | { next: Decision; result: Out }
    | { refuse: Out }
    | { same: Out }
    | Promise<{ next: Decision; result: Out } | { refuse: Out } | { same: Out }>
): Promise<Out> {
  const { records } = await store.list();
  const d = records.find((x) => x.id === id);
  if (!d) return missing;
  const out = await fn(d, records, await store.roster());
  if ("refuse" in out) return out.refuse;
  if ("same" in out) return out.same;
  await store.put(out.next);
  return out.result;
}

/** Whether each person named on the record is on the roster (by name). */
function onTeam(d: Decision, roster: readonly TeamMember[]): Record<string, boolean> {
  const names = [d.decider ?? "", ...DECISION_ROLES.flatMap((r) => roleHolders(d, r))].filter((n) =>
    n.trim()
  );
  return Object.fromEntries(names.map((n) => [n, Boolean(findRosterMember(roster, n))]));
}

/** One record as list_state returns it: the stored fields plus what the page shows. */
export function recordView(
  d: Decision,
  all: readonly Decision[],
  roster: readonly TeamMember[],
  today: string,
  pendingIds: readonly string[] = []
) {
  return {
    ...d,
    template: templateOf(d),
    label: decisionLabel(d),
    options: optionsOf(d),
    issues: decisionIssues(d, today),
    supersedes: all.filter((x) => x.supersededBy === d.id && x.id !== d.id).map((x) => x.id),
    onTeam: onTeam(d, roster),
    example: isExampleId(d.id),
    pending: pendingIds.includes(d.id),
  };
}

/* ── Schemas ─────────────────────────────────────────────────────────── */

const TemplateSchema = z.enum(DECISION_TEMPLATES);
const StatusSchema = z.enum(DECISION_STATUSES);
const RoleSchema = z.enum(DECISION_ROLES);
const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe(
    "YYYY-MM-DD, the user's local day; today or earlier (it can be backdated). Pass the user's date: over MCP the server's day may be a day behind theirs, so the day after the server's is taken too."
  );
const PersonSchema = z.string().trim().min(1).max(NAME_MAX);

/** The roles a record can name; driver and recommend hold one person at most. */
const RolesSchema = z
  .object({
    driver: z.array(PersonSchema).max(1).optional(),
    contributor: z.array(PersonSchema).max(50).optional(),
    informed: z.array(PersonSchema).max(50).optional(),
    recommend: z.array(PersonSchema).max(1).optional(),
    agree: z.array(PersonSchema).max(50).optional(),
    perform: z.array(PersonSchema).max(50).optional(),
    input: z.array(PersonSchema).max(50).optional(),
  })
  .strict()
  .describe(
    "People per role (roster spellings are used when the name is on the team). DACI: driver (one), contributor, informed. RAPID: recommend (one), agree, perform, input."
  );

/** Lifecycle-terminal statuses ask for confirmation when the caller can confirm. */
const TERMINAL = new Set<DecisionStatus>(["deprecated", "superseded"]);

/**
 * The latest day a decision verb takes. In the browser, today; on the
 * server, whose day (UTC on a typical deploy) isn't the user's, the day
 * after it, so a user ahead of UTC can date a move on their own today, as
 * the page does with the browser's day (mood check-ins and the vote
 * rounds do the same).
 */
export const latestDay = (today: string, onServer: boolean): string =>
  onServer ? addDays(today, 1) : today;

/** Why `day` can't be used (after `latest`, from latestDay), or null. */
function futureDay(day: string | undefined, latest: string): string | null {
  if (day === undefined) return null;
  if (!isIsoDate(day)) return "not_a_day";
  return day > latest ? "future_day" : null;
}

const ONE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a lifecycle move on `d` is stamped with when the caller names
 * none: today, or the latest day the record already carries (raised,
 * decided, reopened, carried out) when that is after today and still
 * allowed (`latest`, from latestDay). On the server today can be the
 * user's yesterday, and a record they raised or decided on the page on
 * their own today carries that day: a move stamped before it would read as
 * decided before it was raised. In the browser `latest` is today, so this
 * is today, as the page's own forms default to.
 */
export function stampDay(d: Decision, today: string, latest: string): string {
  let day = today;
  for (const v of [d.date, d.decidedAt, d.reopenedAt, d.implementedAt]) {
    if (v && ONE_DAY.test(v) && isIsoDate(v) && v > day && v <= latest) day = v;
  }
  return day;
}

/**
 * Why a proposal can't be accepted yet, or null, as the page's decide form
 * (and decide, through decideError) refuses it: DACI and RAPID need their
 * Approver / Decide (D) named first, since the role is the point of the
 * form. For the status verbs (set_status here, the DACI and RAPID
 * aliases), which accept a record without the decide form. A record
 * already decided is left alone: carrying it out needs no decider.
 */
export function deciderRefusal(d: Decision): { reason: "no_decider"; message: string } | null {
  if (d.status !== "proposed") return null;
  const spec = TEMPLATES[templateOf(d)];
  if (!spec.deciderRequiredToDecide || d.decider?.trim()) return null;
  return { reason: "no_decider", message: `Name the ${spec.deciderLabel} before deciding.` };
}

/** Whether following `from`'s "superseded by" links reaches `id`. */
function leadsTo(all: readonly Decision[], from: Decision, id: string): boolean {
  const seen = new Set<string>();
  let at: Decision | undefined = from;
  while (at?.supersededBy && !seen.has(at.id)) {
    if (at.supersededBy === id) return true;
    seen.add(at.id);
    const next: string = at.supersededBy;
    at = all.find((x) => x.id === next);
  }
  return false;
}

/**
 * Why the record `byId` can't replace `d`, or null: the page's rules (its
 * picker offers only these; src/app/(tools)/decision-log/view.ts
 * replacementError, which an agent module can't import). Another record of
 * the same kind (an example only by an example: its link would break when
 * the example is cleared), still in force (proposed or accepted), and not
 * one `d` already replaced, directly or down a chain (A by B, then B by A,
 * would leave nothing in force).
 */
function replacementRefusal(
  all: readonly Decision[],
  d: Decision,
  byId: string
):
  | "replacement_not_found"
  | "example_mismatch"
  | "replacement_not_in_force"
  | "supersede_loop"
  | null {
  const by = all.find((x) => x.id === byId);
  if (!by || by.id === d.id) return "replacement_not_found";
  if (isExampleId(by.id) !== isExampleId(d.id)) return "example_mismatch";
  if (by.status === "superseded" || by.status === "deprecated") return "replacement_not_in_force";
  if (leadsTo(all, by, d.id)) return "supersede_loop";
  return null;
}

/* ── tool.decision_log.list_state ────────────────────────────────────── */

async function listState(
  store: DecisionStore,
  params: { template?: DecisionTemplate; status?: DecisionStatus }
) {
  const today = todayLocalISO();
  const [{ records, pendingIds }, roster] = await Promise.all([store.list(), store.roster()]);
  const items = records.filter(
    (d) =>
      (!params.template || templateOf(d) === params.template) &&
      (!params.status || d.status === params.status)
  );
  const byStatus: Record<DecisionStatus, number> = {
    proposed: 0,
    accepted: 0,
    deprecated: 0,
    superseded: 0,
  };
  // A status outside the lifecycle (a hand-crafted row) is listed but not counted.
  for (const d of items) if (d.status in byStatus) byStatus[d.status] += 1;
  const byTemplate: Record<DecisionTemplate, number> = { adr: 0, daci: 0, rapid: 0 };
  for (const d of records) byTemplate[templateOf(d)] += 1;
  return {
    total: items.length,
    byStatus,
    byTemplate,
    pending: pendingIds.length,
    items: items.map((d) => recordView(d, records, roster, today, pendingIds)),
    verdict: decisionVerdict(records, today),
    timeToDecide: timeToDecide(records.filter((d) => !isExampleId(d.id))),
  };
}

registry.register({
  id: "tool.decision_log.list_state",
  toolId: "tool.decision_log",
  name: "list_state",
  category: "read",
  description:
    "List the decision records (Decision Log, DACI and RAPID share them) as the Decision Log page shows them. Params: template? (adr|daci|rapid) and status? (proposed|accepted|deprecated|superseded) filter the items. Returns {total, byStatus, byTemplate, pending (old Decision Log rows not moved in yet), items: Decision & {template, label ('ADR-0003'), options [{id,text,note?}], issues [{kind,message}], supersedes: ids, onTeam: {name: boolean}, example, pending}, verdict, timeToDecide: {medianDays, n} | null (null below 3 decided records)}.",
  paramsSchema: z.object({
    template: TemplateSchema.optional(),
    status: StatusSchema.optional(),
  }),
  handler: async (params) => listState(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => listState(serverDecisionStore(ctx.userId), params),
});

/* ── tool.decision_log.add_decision ──────────────────────────────────── */

const AddSchema = z.object({
  template: TemplateSchema.optional().describe("The form: adr (default), daci or rapid"),
  title: z.string().trim().min(1).max(DECISION_TITLE_MAX),
  context: z.string().max(DECISION_TEXT_MAX).optional(),
  options: z
    .array(z.string().trim().min(1).max(DECISION_TEXT_MAX))
    .max(20)
    .optional()
    .describe("The options weighed, in order"),
  recommendation: z
    .string()
    .max(DECISION_TEXT_MAX)
    .optional()
    .describe(
      "What is proposed: DACI's Driver or RAPID's Recommend; an ADR keeps one too (the page shows it whenever it is set)"
    ),
  decider: PersonSchema.optional().describe(
    "The one person with the final say (DACI Approver, RAPID Decide)"
  ),
  roles: RolesSchema.optional(),
  date: DaySchema.optional().describe("The day it was raised (default today)"),
});

async function addDecision(
  store: DecisionStore,
  p: z.infer<typeof AddSchema>,
  onServer: boolean
): Promise<Out> {
  const today = todayLocalISO();
  const template = p.template ?? "adr";
  const spec = TEMPLATES[template];
  const why = futureDay(p.date, latestDay(today, onServer));
  if (why) return { created: false, reason: why };
  const roster = await store.roster();
  const roles: Partial<Record<DecisionRole, string[]>> = {};
  for (const [role, names] of Object.entries(p.roles ?? {}) as [DecisionRole, string[]][]) {
    if (!spec.roles.some((r) => r.role === role)) {
      return { created: false, reason: "role_not_in_template", role, template };
    }
    const seen = new Set<string>();
    const clean = names
      .map((n) => rosterName(n, roster))
      .filter((n) => n && !seen.has(nameKey(n)) && seen.add(nameKey(n)));
    if (clean.length > 0) roles[role] = clean;
  }
  // As the page's form: two options that say the same thing are one option.
  const seenOptions = new Set<string>();
  for (const text of p.options ?? []) {
    const key = text.trim().toLowerCase();
    if (seenOptions.has(key)) return { created: false, reason: "duplicate_option", option: text };
    seenOptions.add(key);
  }
  const id = newRecordId();
  const options = (p.options ?? []).map((text, i) => ({ id: `${id}-o${i}`, text: text.trim() }));
  const context = p.context?.trim();
  // Kept on any form: the page shows an ADR's recommendation whenever it is set.
  const recommendation = p.recommendation?.trim();
  const decider = p.decider ? rosterName(p.decider, roster) : "";
  const d = await createRecord(store, {
    id,
    title: p.title.trim(),
    ...(context ? { context } : {}),
    decision: "",
    status: "proposed",
    date: p.date ?? today,
    template,
    ...(options.length > 0 ? { options } : {}),
    ...(recommendation ? { recommendation } : {}),
    ...(decider ? { decider } : {}),
    ...(Object.keys(roles).length > 0 ? { roles } : {}),
  });
  return { created: true, id: d.id, number: d.number, label: decisionLabel(d) };
}

registry.register({
  id: "tool.decision_log.add_decision",
  toolId: "tool.decision_log",
  name: "add_decision",
  category: "write",
  requiresConfirmation: false,
  description:
    "Raise a proposed decision record, numbered in the log's one sequence. Params: template? (adr default | daci | rapid), title, context?, options? (texts in order; no two alike, ignoring case), recommendation? (what is proposed; any form), decider?, roles? (only the form's roles; driver and recommend hold one person), date? (YYYY-MM-DD, the user's local day it was raised; default today, not in the future: over MCP the day after the server's is taken, as the server's day may be behind the user's). Names on the team are stored with the roster's spelling. Returns {created: true, id, number, label} or {created: false, reason: 'future_day' | 'not_a_day' | 'role_not_in_template' | 'duplicate_option', option?}.",
  paramsSchema: AddSchema,
  handler: async (params) => addDecision(browserDecisionStore, params, false),
  mcpHandler: async (params, ctx) => addDecision(serverDecisionStore(ctx.userId), params, true),
});

/* ── tool.decision_log.decide ────────────────────────────────────────── */

const DecideSchema = z.object({
  id: z.string(),
  outcome: z.string().trim().min(1).max(DECISION_TEXT_MAX).describe("What was decided"),
  chosenOption: z.string().optional().describe("The option picked: its id, or its exact text"),
  decider: PersonSchema.optional().describe(
    "Who made the call (required on DACI/RAPID if none is named)"
  ),
  date: DaySchema.optional().describe("The day it was decided (default today)"),
});

async function decideRecord(
  store: DecisionStore,
  p: z.infer<typeof DecideSchema>,
  onServer: boolean
) {
  const today = todayLocalISO();
  const latest = latestDay(today, onServer);
  return changeRecord(store, p.id, { decided: false, reason: "not_found" }, (d, _all, roster) => {
    // Never before it was raised, as the page's decide form starts at the later of the two days.
    const date = p.date ?? stampDay(d, today, latest);
    const why = futureDay(date, latest);
    if (why) return { refuse: { decided: false, reason: why } };
    if (d.date && date < d.date) return { refuse: { decided: false, reason: "before_raised" } };
    const options = optionsOf(d);
    const chosen = p.chosenOption
      ? (options.find((o) => o.id === p.chosenOption) ??
        options.find((o) => o.text.toLowerCase() === p.chosenOption!.trim().toLowerCase()))
      : undefined;
    if (p.chosenOption && !chosen) {
      return { refuse: { decided: false, reason: "unknown_option", options } };
    }
    const input = {
      outcome: p.outcome,
      ...(chosen ? { chosenOptionId: chosen.id } : {}),
      ...(p.decider ? { decider: rosterName(p.decider, roster) } : {}),
      date,
    };
    const error = decideError(d, input);
    if (error) return { refuse: { decided: false, reason: "invalid", message: error } };
    const next = decide(d, input);
    return {
      next,
      result: { decided: true, label: decisionLabel(next), decidedAt: next.decidedAt },
    };
  });
}

registry.register({
  id: "tool.decision_log.decide",
  toolId: "tool.decision_log",
  name: "decide",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a decision: accepts the record with its outcome. Params: id, outcome, chosenOption? (an option id or its exact text), decider? (DACI Approver / RAPID Decide must be named here or already), date? (YYYY-MM-DD, the user's local day; default today, or the record's own later day when the server's today is behind it; not in the future, not before it was raised). Clears a reopen and a replacement. Returns {decided: true, label, decidedAt} or {decided: false, reason: 'not_found' | 'future_day' | 'before_raised' | 'unknown_option' | 'invalid', message?}.",
  paramsSchema: DecideSchema,
  handler: async (params) => decideRecord(browserDecisionStore, params, false),
  mcpHandler: async (params, ctx) => decideRecord(serverDecisionStore(ctx.userId), params, true),
});

/* ── tool.decision_log.supersede ─────────────────────────────────────── */

const SupersedeSchema = z.object({
  id: z.string().describe("Id of the record being replaced (the old one)"),
  supersededBy: z.string().describe("Id of the record that replaces it (the new one)"),
  reason: z
    .string()
    .max(DECISION_TEXT_MAX)
    .optional()
    .describe("Why; added to the old record's consequences when given"),
});

async function supersedeRecord(store: DecisionStore, p: z.infer<typeof SupersedeSchema>) {
  return changeRecord(store, p.id, { superseded: false, reason: "not_found" }, (d, all) => {
    // A repeat is a no-op before the rules: the replacement may be superseded itself by now.
    if (d.status === "superseded" && d.supersededBy === p.supersededBy) {
      return { same: { superseded: false, alreadySuperseded: true } };
    }
    const why = replacementRefusal(all, d, p.supersededBy);
    if (why) return { refuse: { superseded: false, reason: why } };
    const by = all.find((x) => x.id === p.supersededBy)!;
    const next = supersede(d, by.id);
    if (!next) return { same: { superseded: false, alreadySuperseded: true } };
    const note = p.reason?.trim();
    const consequences = note
      ? [d.consequences?.trim(), `Superseded by ${decisionLabel(by)}. ${note}`]
          .filter(Boolean)
          .join("\n\n")
      : d.consequences;
    return {
      next: { ...next, ...(consequences ? { consequences } : {}) },
      result: { superseded: true, label: decisionLabel(d), by: decisionLabel(by) },
    };
  });
}

registry.register({
  id: "tool.decision_log.supersede",
  toolId: "tool.decision_log",
  name: "supersede",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a record superseded by another record: sets status 'superseded' and supersededBy (the page shows 'Superseded by ADR-0004' and, on the new one, 'Supersedes …'). The replacement follows the page's rules: another record, an example only for an example (and a team's only for a team's), still in force (proposed or accepted), and not one this record already replaced, directly or down a chain. Params: id (the old record), supersededBy (the new record's id), reason? (added to the old record's consequences). Idempotent. Returns {superseded: true, label, by} or {superseded: false, reason: 'not_found' | 'replacement_not_found' | 'example_mismatch' | 'replacement_not_in_force' | 'supersede_loop'} or {superseded: false, alreadySuperseded: true}.",
  paramsSchema: SupersedeSchema,
  handler: async (params) => supersedeRecord(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => supersedeRecord(serverDecisionStore(ctx.userId), params),
});

/* ── tool.decision_log.reopen ────────────────────────────────────────── */

const ReopenSchema = z.object({
  id: z.string(),
  date: DaySchema.optional().describe("The day it was reopened (default today)"),
});

async function reopenRecord(
  store: DecisionStore,
  p: z.infer<typeof ReopenSchema>,
  onServer: boolean
) {
  const today = todayLocalISO();
  const latest = latestDay(today, onServer);
  return changeRecord(store, p.id, { reopened: false, reason: "not_found" }, (d) => {
    const why = futureDay(p.date, latest);
    if (why) return { refuse: { reopened: false, reason: why } };
    if (d.status === "proposed") return { same: { reopened: false, reason: "already_proposed" } };
    const next = reopen(d, p.date ?? stampDay(d, today, latest));
    return { next, result: { reopened: true, label: decisionLabel(next) } };
  });
}

registry.register({
  id: "tool.decision_log.reopen",
  toolId: "tool.decision_log",
  name: "reopen",
  category: "write",
  requiresConfirmation: false,
  description:
    "Take a decided record back to proposed (DACI's 'revisit'): sets reopenedAt and drops 'carried out' and any replacement; the outcome written stays as what is being revisited. Params: id, date? (YYYY-MM-DD, the user's local day; default today, or the record's own later day when the server's today is behind it; not in the future). Returns {reopened: true, label} or {reopened: false, reason: 'not_found' | 'already_proposed' | 'future_day'}.",
  paramsSchema: ReopenSchema,
  handler: async (params) => reopenRecord(browserDecisionStore, params, false),
  mcpHandler: async (params, ctx) => reopenRecord(serverDecisionStore(ctx.userId), params, true),
});

/* ── tool.decision_log.set_status (kept) ─────────────────────────────── */

const SetStatusSchema = z.object({
  id: z.string(),
  status: StatusSchema,
  supersededBy: z
    .string()
    .optional()
    .describe("With status 'superseded': the id of the record that replaces it"),
});

/**
 * The record in `status`, the way the page's own controls move it. Its form
 * is written out too (`template`, which only post-merge code writes:
 * lib/decisions/legacy-log POST_MERGE_FIELDS), so a row of the old Decision
 * Log still waiting for the page's move keeps this status: the reads and
 * the move otherwise take the blob's when it ranks as late (accepted back
 * from deprecated, or deprecated ↔ superseded), as for a row nobody has
 * saved since the merge.
 */
function withStatus(d: Decision, status: DecisionStatus, today: string): Decision {
  if (status === d.status) return d;
  const template = templateOf(d);
  if (status === "proposed") return { ...reopen(d, today), template };
  if (status === "accepted") {
    const next: Decision = { ...d, status: "accepted", template };
    delete next.supersededBy;
    delete next.reopenedAt;
    return d.status === "proposed" ? { ...next, decidedAt: today } : next;
  }
  return { ...d, status, template };
}

async function setStatus(
  store: DecisionStore,
  p: z.infer<typeof SetStatusSchema>,
  ctx: ActionContext,
  onServer: boolean
) {
  const today = todayLocalISO();
  const latest = latestDay(today, onServer);
  return changeRecord(store, p.id, { updated: false }, async (d, all) => {
    // Refusals first, so nobody is asked to confirm a move that can't happen.
    if (p.status === "accepted") {
      const why = deciderRefusal(d);
      if (why) return { refuse: { updated: false, ...why } };
    }
    const repeat =
      p.status === "superseded" && d.status === "superseded" && d.supersededBy === p.supersededBy;
    if (p.status === "superseded" && p.supersededBy && !repeat) {
      const why = replacementRefusal(all, d, p.supersededBy);
      if (why) return { refuse: { updated: false, reason: why } };
    }
    if (TERMINAL.has(p.status) && ctx.confirm && !repeat) {
      const ok = await ctx.confirm(
        `Mark ${decisionLabel(d)} "${d.title || d.id}" as ${p.status}? This is a lifecycle-terminal transition.`
      );
      if (!ok) return { refuse: { updated: false, confirmed: false } };
    }
    if (p.status === "superseded" && p.supersededBy) {
      const next = repeat ? null : supersede(d, p.supersededBy);
      return next ? { next, result: { updated: true } } : { same: { updated: true } };
    }
    const next = withStatus(d, p.status, stampDay(d, today, latest));
    return next === d ? { same: { updated: true } } : { next, result: { updated: true } };
  });
}

registry.register({
  id: "tool.decision_log.set_status",
  toolId: "tool.decision_log",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a record's lifecycle status (proposed | accepted | deprecated | superseded) on any form's record. Proposed reopens it (reopenedAt); accepted from proposed dates decidedAt today (or the record's own later day, when the server's today is behind the user's; use decide to write the outcome and the day), and a DACI or RAPID proposal needs its Approver / Decide (D) named first, as on the page; superseded with supersededBy links the replacement (supersede's rules). Deprecated and superseded ask for confirmation when the caller can confirm. Returns {updated: boolean, confirmed?: false, reason?: 'no_decider' | 'replacement_not_found' | 'example_mismatch' | 'replacement_not_in_force' | 'supersede_loop', message?}.",
  paramsSchema: SetStatusSchema,
  handler: async (params, ctx) => setStatus(browserDecisionStore, params, ctx, false),
  mcpHandler: async (params, ctx) => setStatus(serverDecisionStore(ctx.userId), params, ctx, true),
});

/* ── tool.decision_log.add_alternative (kept) and add_option ─────────── */

const AlternativeSchema = z.object({
  id: z.string(),
  alternative: z.string().min(1).max(500),
});

async function addAlternative(store: DecisionStore, p: z.infer<typeof AlternativeSchema>) {
  return changeRecord(store, p.id, { added: false }, (d) => {
    const text = p.alternative.trim();
    if (optionsOf(d).some((o) => o.text === text)) return { same: { added: false } };
    // An old ADR keeps its alternatives (which read as its options) until
    // its options are first saved; a record with options gains one more.
    const next: Decision = d.options
      ? { ...d, options: [...d.options, { id: `${d.id}-o${newRecordId()}`, text }] }
      : { ...d, alternatives: [...(d.alternatives ?? []), text] };
    return { next, result: { added: true } };
  });
}

registry.register({
  id: "tool.decision_log.add_alternative",
  toolId: "tool.decision_log",
  name: "add_alternative",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append an option considered to a record (an ADR's alternatives). Idempotent: skips text already listed. Params: id, alternative. Returns {added: false} when the id is unknown or the option is already there.",
  paramsSchema: AlternativeSchema,
  handler: async (params) => addAlternative(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => addAlternative(serverDecisionStore(ctx.userId), params),
});

const OptionSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1).max(DECISION_TEXT_MAX),
  note: z.string().max(DECISION_TEXT_MAX).optional().describe("Its trade-offs, or why not"),
});

async function addOption(store: DecisionStore, p: z.infer<typeof OptionSchema>) {
  return changeRecord(store, p.id, { added: false, reason: "not_found" }, (d) => {
    const text = p.text.trim();
    const options = optionsOf(d);
    if (options.some((o) => o.text.toLowerCase() === text.toLowerCase())) {
      return { same: { added: false, reason: "already_listed" } };
    }
    const note = p.note?.trim();
    const option = { id: `${d.id}-o${newRecordId()}`, text, ...(note ? { note } : {}) };
    return {
      next: { ...d, options: [...options, option] },
      result: { added: true, optionId: option.id },
    };
  });
}

registry.register({
  id: "tool.decision_log.add_option",
  toolId: "tool.decision_log",
  name: "add_option",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an option to a record's options (an old ADR's alternatives become options, keeping their ids). Params: id, text, note?. Returns {added: true, optionId} or {added: false, reason: 'not_found' | 'already_listed'}.",
  paramsSchema: OptionSchema,
  handler: async (params) => addOption(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => addOption(serverDecisionStore(ctx.userId), params),
});

/* ── tool.decision_log.assign_role and set_decider ───────────────────── */

const AssignSchema = z.object({
  id: z.string(),
  role: RoleSchema,
  person: PersonSchema,
  replace: z
    .boolean()
    .optional()
    .describe("For a one-person role (driver, recommend): replace whoever holds it"),
});

/** Put `person` in `role` on a record: shared with the DACI and RAPID aliases. */
export function withRole(
  d: Decision,
  role: DecisionRole,
  person: string,
  replace = false
): { next: Decision } | { refuse: Out } | { same: Out } {
  const spec = TEMPLATES[templateOf(d)];
  if (!spec.roles.some((r) => r.role === role)) {
    return { refuse: { assigned: false, reason: "role_not_in_template", template: templateOf(d) } };
  }
  const holders = roleHolders(d, role);
  if (holders.some((h) => nameKey(h) === nameKey(person))) {
    return { same: { assigned: false, reason: "already_assigned" } };
  }
  if (SINGLE_ROLES.has(role) && holders.length > 0 && !replace) {
    return { refuse: { assigned: false, reason: "single_role_taken", holder: holders[0] } };
  }
  const names = SINGLE_ROLES.has(role) ? [person] : [...holders, person];
  return { next: { ...d, roles: { ...(d.roles ?? {}), [role]: names } } };
}

async function assignRole(store: DecisionStore, p: z.infer<typeof AssignSchema>) {
  return changeRecord(store, p.id, { assigned: false, reason: "not_found" }, (d, _all, roster) => {
    const person = rosterName(p.person, roster);
    const out = withRole(d, p.role, person, p.replace);
    if (!("next" in out)) return out;
    return { next: out.next, result: { assigned: true, role: p.role, person } };
  });
}

registry.register({
  id: "tool.decision_log.assign_role",
  toolId: "tool.decision_log",
  name: "assign_role",
  category: "write",
  requiresConfirmation: false,
  description:
    "Name a person in one of the record's roles (DACI: driver, contributor, informed; RAPID: recommend, agree, perform, input). The roster's spelling is used. driver and recommend hold one person: pass replace=true to swap. Params: id, role, person, replace?. Returns {assigned: true, role, person} or {assigned: false, reason: 'not_found' | 'role_not_in_template' | 'already_assigned' | 'single_role_taken', holder?}.",
  paramsSchema: AssignSchema,
  handler: async (params) => assignRole(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => assignRole(serverDecisionStore(ctx.userId), params),
});

const DeciderSchema = z.object({ id: z.string(), person: PersonSchema });

async function setDecider(store: DecisionStore, p: z.infer<typeof DeciderSchema>) {
  return changeRecord(store, p.id, { updated: false }, (d, _all, roster) => {
    const person = rosterName(p.person, roster);
    if (d.decider === person) return { same: { updated: true, decider: person } };
    return { next: { ...d, decider: person }, result: { updated: true, decider: person } };
  });
}

registry.register({
  id: "tool.decision_log.set_decider",
  toolId: "tool.decision_log",
  name: "set_decider",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the one person with the final say (DACI Approver, RAPID Decide, an ADR's decider), with the roster's spelling. Params: id, person. Returns {updated: true, decider} or {updated: false} when the id is unknown.",
  paramsSchema: DeciderSchema,
  handler: async (params) => setDecider(browserDecisionStore, params),
  mcpHandler: async (params, ctx) => setDecider(serverDecisionStore(ctx.userId), params),
});

/* ── tool.decision_log.delete ────────────────────────────────────────── */

/**
 * Delete a record the way the page does: from the workspace's records and
 * the old DACI and RAPID collections alike, so an old row under the id
 * can't read back in with its pre-merge text (or be copied back by the
 * page's one-time move, with a new number). A row of the old Decision
 * Log page still waiting for that move is refused: deleting it has to
 * mark it moved in this browser's storage, which only the page can do.
 * Other records' "superseded by" links to it stay, as on the page (they
 * read as "superseded by a deleted record"), and a deleted top number can
 * be given to the next record.
 */
async function deleteRecord(store: DecisionStore, id: string, ctx: ActionContext): Promise<Out> {
  const { records, pendingIds } = await store.list();
  const d = records.find((x) => x.id === id);
  if (!d) return { deleted: false, reason: "not_found" };
  if (pendingIds.includes(id)) {
    return {
      deleted: false,
      reason: "pending_move",
      message:
        "This record is still moving in from the old Decision Log page: open the Decision Log once, then delete it (or delete it there).",
    };
  }
  if (ctx.confirm) {
    const ok = await ctx.confirm(
      `Delete ${decisionLabel(d)} "${d.title || d.id}"? An agent's delete can't be undone.`
    );
    if (!ok) return { deleted: false, confirmed: false };
  }
  await store.remove(id);
  return { deleted: true, id, label: decisionLabel(d) };
}

registry.register({
  id: "tool.decision_log.delete",
  toolId: "tool.decision_log",
  name: "delete",
  category: "write",
  requiresConfirmation: true,
  description:
    "Delete a decision record of any form, as the page's delete does: removes the id from the records and from the old DACI and RAPID collections, so an old row can't come back. Use this, not workspace.decision.delete (which removes only the workspace row, so an old DACI or RAPID row reads back in). Final for an agent (the page offers Undo): confirm with the user first. Params: id. Returns {deleted: true, id, label} or {deleted: false, reason: 'not_found' | 'pending_move', message?} or {deleted: false, confirmed: false}. 'pending_move': a row of the old Decision Log page not moved in yet; open the Decision Log once, then delete it.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params, ctx) => deleteRecord(browserDecisionStore, params.id, ctx),
  mcpHandler: async (params, ctx) => deleteRecord(serverDecisionStore(ctx.userId), params.id, ctx),
});
