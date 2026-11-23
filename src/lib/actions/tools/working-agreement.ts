/**
 * Working Agreement Builder — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     The team charter: rules, each person's consent to each rule,
 *           dated adoption check-ins, and published versions.
 *
 * Agent surface: tool.working_agreement.*
 * Backing CRUD : workspace.working_agreement.* (auto-generated). Singleton:
 *                one WorkingAgreement document under WORKING_AGREEMENT_ID.
 *
 *   1. list_state      — rules, consent, check-ins, versions, the verdict.
 *   2. add_rule        — add a charter rule.
 *   3. update_rule     — reword, recategorise or describe a rule.
 *   4. remove_rule     — remove a rule.
 *   5. set_consent     — one person's answer to a rule (or clear it).
 *   6. record_check_in — save a dated check-in round.
 *   7. remove_check_in — remove a saved round.
 *   8. publish         — snapshot the rules as the next version.
 *   9. list_templates  — the four charter templates, applied or not.
 *  10. apply_template  — write (or rewrite) a template's rules.
 *
 * Every number comes from lib/working-agreement/model, as on the page, so
 * an agent and a person read the same consent, adherence and changes.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  AI_USE_NEVER_IN,
  AI_USE_REVIEW,
  CHARTER_TEMPLATE_IDS,
  CHARTER_TEMPLATE_MAX,
  CORE_HOURS_PURPOSES,
  TEAM_TIME_MAX,
  type CharterCheckInResult,
  type CharterRule,
  type CharterRuleCategory,
  type Sprint,
  type TeamMember,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { TIME_PATTERN } from "@/lib/sprints/cadence";
import { findRosterMember } from "@/lib/team/names";
import {
  TEMPLATE_KEY,
  applyTemplate,
  templatesSummary,
  validateTemplate,
} from "@/lib/working-agreement/templates";
import { todayIso } from "@/lib/sprints/series";
import {
  CHARTER_CATEGORIES,
  CHECK_IN_NOTE_MAX,
  CHECK_IN_RESULTS,
  CONSENT_NOTE_MAX,
  RULE_DESCRIPTION_MAX,
  RULE_TEXT_MAX,
  WA_ID,
  WA_KIND,
  agreementConsent,
  agreementVerdict,
  canPublish,
  checkInAdherence,
  checkInTrend,
  consentLine,
  consentOf,
  diffIsEmpty,
  diffVersions,
  draftCheckIn,
  draftRules,
  emptyAgreement,
  hasUnpublishedChanges,
  lastCheckIn,
  latestVersion,
  markOfResult,
  needsSnapshot,
  normalizeAgreement,
  published,
  ruleKey,
  withCheckIn,
  withConsent,
  withRuleText,
} from "@/lib/working-agreement/model";

/** MUST match registerCollection("teamMember", …) in workspace-store.ts. */
const KIND_MEMBER = "workspace:teamMember";
/** MUST match registerCollection("sprint", …) in workspace-store.ts. */
const KIND_SPRINT = "workspace:sprint";

const CategorySchema = z.enum(
  CHARTER_CATEGORIES as [CharterRuleCategory, ...CharterRuleCategory[]]
);
const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

const ws = () => useWorkspaceStore.getState();

/** Where the agreement lives: the browser's workspace, or the user's rows on the server. */
interface AgreementStore {
  getDoc(): Promise<WorkingAgreement | null>;
  putDoc(doc: WorkingAgreement): Promise<void>;
  /** The roster, whose people consent is asked of. */
  roster(): Promise<TeamMember[]>;
  sprintExists(id: string): Promise<boolean>;
}

const browserStore: AgreementStore = {
  getDoc: async () => (ws().workingAgreements ?? []).find((d) => d.id === WA_ID) ?? null,
  putDoc: async (doc) => ws().upsertWorkingAgreement(doc),
  roster: async () => ws().teamMembers ?? [],
  sprintExists: async (id) => (ws().sprints ?? []).some((s) => s.id === id),
};

function serverStore(userId: string): AgreementStore {
  return {
    getDoc: async () => (await serverGetEntity<WorkingAgreement>(userId, WA_KIND, WA_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<WorkingAgreement>(userId, WA_KIND, doc);
    },
    roster: async () => serverListEntities<TeamMember>(userId, KIND_MEMBER),
    sprintExists: async (id) => (await serverGetEntity<Sprint>(userId, KIND_SPRINT, id)) !== null,
  };
}

/**
 * Change the agreement with `fn`, which gets the document as the page
 * reads it (normalizeAgreement; an empty one when none exists) and returns
 * the new document and the result, or a refusal to write nothing.
 */
async function change<T extends Record<string, unknown>>(
  store: AgreementStore,
  fn: (doc: WorkingAgreement) => { doc: WorkingAgreement; result: T } | { refuse: T }
): Promise<T> {
  const doc = normalizeAgreement((await store.getDoc()) ?? emptyAgreement());
  const out = fn(doc);
  if ("refuse" in out) return out.refuse;
  await store.putDoc({ ...out.doc, id: WA_ID });
  return out.result;
}

/* ── list_state ─────────────────────────────────────────────────────── */

function summarize(raw: WorkingAgreement | null, roster: readonly TeamMember[]) {
  const doc = normalizeAgreement(raw ?? emptyAgreement());
  const byCategory = Object.fromEntries(CHARTER_CATEGORIES.map((c) => [c, 0])) as Record<
    CharterRuleCategory,
    number
  >;
  let stillWorkingCount = 0;
  let partlyWorkingCount = 0;
  let notWorkingCount = 0;
  for (const r of doc.rules) {
    byCategory[r.category] += 1;
    if (r.stillWorking === true) stillWorkingCount += 1;
    else if (r.stillWorking === "partly") partlyWorkingCount += 1;
    else if (r.stillWorking === false) notWorkingCount += 1;
  }
  const consent = agreementConsent(doc, roster);
  const last = lastCheckIn(doc);
  const latest = latestVersion(doc);
  return {
    exists: raw !== null,
    total: doc.rules.length,
    byCategory,
    // The round in progress (each rule's draft mark), before it is saved.
    stillWorkingCount,
    partlyWorkingCount,
    notWorkingCount,
    meta: doc.meta,
    rules: doc.rules.map((r) => {
      const c = consentOf(r, roster);
      return {
        ...r,
        consentSummary: {
          line: consentLine(c),
          consented: c.consented,
          concerns: c.concerns,
          objections: c.objections,
          missing: c.missing,
          full: c.full,
        },
      };
    }),
    consent: {
      rosterSize: roster.length,
      fullyConsented: consent.fullyConsented,
      withObjection: consent.withObjection,
      missingPeople: consent.missingPeople,
      objections: consent.objections,
    },
    lastCheckIn: last
      ? { id: last.id, date: last.date, version: last.version, ...checkInAdherence(last) }
      : null,
    checkIns: checkInTrend(doc),
    versions: (doc.versions ?? []).map((v) => ({
      version: v.version,
      publishedAt: v.publishedAt,
      rules: v.rules.length,
    })),
    unpublishedChanges: hasUnpublishedChanges(doc),
    needsSnapshot: needsSnapshot(doc),
    changesSinceLatest: latest ? diffVersions(latest.rules, draftRules(doc)) : null,
    verdict: agreementVerdict(doc, roster),
  };
}

registry.register({
  id: "tool.working_agreement.list_state",
  toolId: "tool.working_agreement",
  name: "list_state",
  category: "read",
  description:
    "Summarise the working agreement with the page's numbers. Returns {exists, total, byCategory: {communication, meetings, decisions, work, conflict, other}, stillWorkingCount, partlyWorkingCount and notWorkingCount (the marks of the check-in in progress, not yet saved), meta: {teamName?, version (0 = never published), publishedAt?, description?}, rules: {id, category, text, description?, agreedBy (the names voting consent), consent: {name, vote: 'consent'|'concern'|'object', note?, at}[], stillWorking? (true, false or 'partly'), template? ({id, slot}: the charter template that wrote it; see list_templates), sourceRef? (the item it was sent from, such as a kickoff's rule), consentSummary: {line, consented, concerns, objections, missing (roster members who haven't answered), full (everyone answered, nobody objects)}}[], consent: {rosterSize, fullyConsented, withObjection, missingPeople, objections: {ruleId, text, names}[]}, lastCheckIn: null | {id, date, version, checked, working, partly, pct}, checkIns: {id, date, version, sprintId?, checked, working, partly, pct (a rule partly working counts as half; null when nothing was checked)}[] oldest first, versions: {version, publishedAt, rules}[], unpublishedChanges (the draft differs from the latest version, or was never published; false when there is no snapshot to compare with), needsSnapshot (published before versions were kept: publish once to keep one), changesSinceLatest: null | {added, removed, reworded, recategorised, redescribed}, verdict}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.getDoc(), await browserStore.roster()),
  mcpHandler: async (_params, ctx) => {
    const store = serverStore(ctx.userId);
    return summarize(await store.getDoc(), await store.roster());
  },
});

/* ── Rules ──────────────────────────────────────────────────────────── */

const AddRuleParams = z.object({
  category: CategorySchema,
  text: z.string().trim().min(1).max(RULE_TEXT_MAX),
  agreedBy: z
    .array(z.string().trim().min(1).max(60))
    .max(100)
    .optional()
    .describe("People who consent to it already; recorded as their consent."),
  description: z.string().trim().max(RULE_DESCRIPTION_MAX).optional(),
});

async function addRule(store: AgreementStore, params: z.infer<typeof AddRuleParams>) {
  const roster = await store.roster();
  const at = new Date().toISOString();
  return change(store, (doc) => {
    const dup = doc.rules.find((r) => ruleKey(r.text) === ruleKey(params.text));
    if (dup) return { refuse: { added: false, reason: "duplicate", id: dup.id } };
    let rule: CharterRule = {
      id: crypto.randomUUID(),
      category: params.category,
      text: params.text,
      agreedBy: [],
      consent: [],
      ...(params.description ? { description: params.description } : {}),
    };
    for (const name of params.agreedBy ?? []) {
      rule = withConsent(rule, findRosterMember(roster, name)?.name ?? name, "consent", at);
    }
    return { doc: { ...doc, rules: [...doc.rules, rule] }, result: { added: true, id: rule.id } };
  });
}

registry.register({
  id: "tool.working_agreement.add_rule",
  toolId: "tool.working_agreement",
  name: "add_rule",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a charter rule. Params: category (communication | meetings | decisions | work | conflict | other), text, agreedBy? (names who consent; recorded as their consent, with the roster's spelling), description?. Creates the agreement if absent. Returns {added: true, id}, or {added: false, reason: 'duplicate', id} when the charter already holds that rule (case, spacing and a closing full stop aside).",
  paramsSchema: AddRuleParams,
  handler: async (params) => addRule(browserStore, params),
  mcpHandler: async (params, ctx) => addRule(serverStore(ctx.userId), params),
});

const UpdateRuleParams = z.object({
  ruleId: z.string().min(1),
  text: z.string().trim().min(1).max(RULE_TEXT_MAX).optional(),
  category: CategorySchema.optional(),
  description: z
    .string()
    .trim()
    .max(RULE_DESCRIPTION_MAX)
    .optional()
    .describe("An empty string removes the description."),
});

async function updateRule(store: AgreementStore, params: z.infer<typeof UpdateRuleParams>) {
  return change(store, (doc) => {
    const rule = doc.rules.find((r) => r.id === params.ruleId);
    if (!rule) return { refuse: { updated: false, reason: "not_found" } };
    if (
      params.text &&
      doc.rules.some((r) => r.id !== rule.id && ruleKey(r.text) === ruleKey(params.text ?? ""))
    ) {
      return { refuse: { updated: false, reason: "duplicate" } };
    }
    // As a hand edit on the page: a changed rule leaves its charter template.
    const next: CharterRule = withRuleText(
      rule,
      params.text ?? rule.text,
      params.description,
      params.category
    );
    return {
      doc: { ...doc, rules: doc.rules.map((r) => (r.id === rule.id ? next : r)) },
      result: { updated: true },
    };
  });
}

registry.register({
  id: "tool.working_agreement.update_rule",
  toolId: "tool.working_agreement",
  name: "update_rule",
  category: "write",
  requiresConfirmation: false,
  description:
    "Reword, recategorise or describe a rule by id (ids are in list_state). Params: ruleId, text?, category?, description? ('' removes it). Consent is kept; publish to make the change a new version. A rule a charter template wrote (its `template` is set) becomes the team's own once changed: it loses `template`, so applying the template again won't overwrite it. Returns {updated: true}, or {updated: false, reason: 'not_found' | 'duplicate'}.",
  paramsSchema: UpdateRuleParams,
  handler: async (params) => updateRule(browserStore, params),
  mcpHandler: async (params, ctx) => updateRule(serverStore(ctx.userId), params),
});

async function removeRule(store: AgreementStore, ruleId: string) {
  return change(store, (doc) =>
    doc.rules.some((r) => r.id === ruleId)
      ? {
          doc: { ...doc, rules: doc.rules.filter((r) => r.id !== ruleId) },
          result: { removed: true },
        }
      : { refuse: { removed: false, reason: "not_found" } }
  );
}

registry.register({
  id: "tool.working_agreement.remove_rule",
  toolId: "tool.working_agreement",
  name: "remove_rule",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a rule by id. Saved check-ins and published versions keep their copy of it. Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: z.object({ ruleId: z.string().min(1) }),
  handler: async (params) => removeRule(browserStore, params.ruleId),
  mcpHandler: async (params, ctx) => removeRule(serverStore(ctx.userId), params.ruleId),
});

/* ── Consent ────────────────────────────────────────────────────────── */

const ConsentParams = z.object({
  ruleId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  vote: z
    .enum(["consent", "concern", "object"])
    .nullable()
    .describe("consent; concern (can live with it, with a reservation); object; null clears."),
  note: z
    .string()
    .trim()
    .max(CONSENT_NOTE_MAX)
    .optional()
    .describe("Why, for a concern or an objection (ignored with consent)."),
});

async function setConsent(store: AgreementStore, params: z.infer<typeof ConsentParams>) {
  const roster = await store.roster();
  const name = findRosterMember(roster, params.name)?.name ?? params.name;
  const at = new Date().toISOString();
  return change(store, (doc) => {
    const rule = doc.rules.find((r) => r.id === params.ruleId);
    if (!rule) return { refuse: { updated: false, reason: "not_found" } };
    const next = withConsent(rule, name, params.vote, at, params.note);
    return {
      doc: { ...doc, rules: doc.rules.map((r) => (r.id === rule.id ? next : r)) },
      result: {
        updated: true,
        name,
        onRoster: Boolean(findRosterMember(roster, name)),
        consent: consentLine(consentOf(next, roster)),
        agreedBy: next.agreedBy,
      },
    };
  });
}

registry.register({
  id: "tool.working_agreement.set_consent",
  toolId: "tool.working_agreement",
  name: "set_consent",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record one person's answer to a rule: vote 'consent', 'concern' (can live with it, with a reservation) or 'object', or null to clear it; note? says why for a concern or objection. One answer per person (matched by name, case-insensitive; a roster name gets the roster's spelling), so answering again replaces it. agreedBy follows (the names voting consent). Returns {updated: true, name, onRoster, consent (e.g. '5 of 6 consented · Sam objects'), agreedBy}, or {updated: false, reason: 'not_found'}.",
  paramsSchema: ConsentParams,
  handler: async (params) => setConsent(browserStore, params),
  mcpHandler: async (params, ctx) => setConsent(serverStore(ctx.userId), params),
});

/* ── Check-ins ──────────────────────────────────────────────────────── */

const CheckInParams = z.object({
  results: z
    .array(
      z.object({
        ruleId: z.string().min(1),
        result: z.enum(CHECK_IN_RESULTS as [CharterCheckInResult, ...CharterCheckInResult[]]),
      })
    )
    .min(1)
    .max(200),
  date: ISO_DATE.optional().describe("The day of the check-in; defaults to today, never after it."),
  sprintId: z.string().min(1).optional(),
  note: z.string().trim().max(CHECK_IN_NOTE_MAX).optional(),
});

async function recordCheckIn(store: AgreementStore, params: z.infer<typeof CheckInParams>) {
  const today = todayIso();
  const date = params.date ?? today;
  if (date > today) return { recorded: false, reason: "future_date" };
  if (params.sprintId && !(await store.sprintExists(params.sprintId))) {
    return { recorded: false, reason: "unknown_sprint" };
  }
  return change(store, (doc) => {
    const ids = new Set(doc.rules.map((r) => r.id));
    const unknown = params.results.filter((r) => !ids.has(r.ruleId)).map((r) => r.ruleId);
    if (unknown.length > 0) return { refuse: { recorded: false, reason: "unknown_rule", unknown } };
    // The round as the page saves one, from the agent's marks alone (the
    // page's draft marks on other rules aren't the agent's to save).
    const marks = new Map(params.results.map((r) => [r.ruleId, markOfResult(r.result)]));
    const agentMarks = {
      ...doc,
      rules: doc.rules.map((r) => {
        const { stillWorking, ...rest } = r;
        void stillWorking;
        return marks.has(r.id) ? { ...rest, stillWorking: marks.get(r.id) } : rest;
      }),
    };
    const round = draftCheckIn(agentMarks, {
      id: `checkIn_${nanoid(8)}`,
      date,
      sprintId: params.sprintId,
      note: params.note,
    });
    if (!round) return { refuse: { recorded: false, reason: "no_results" } };
    // Saving clears the marks of the rules it checked; the rest stay.
    const saved = withCheckIn(doc, round);
    return { doc: saved, result: { recorded: true, id: round.id, ...checkInAdherence(round) } };
  });
}

registry.register({
  id: "tool.working_agreement.record_check_in",
  toolId: "tool.working_agreement",
  name: "record_check_in",
  category: "write",
  requiresConfirmation: false,
  description:
    "Save a check-in round: how each rule is working in practice. Params: results: {ruleId, result: 'working' | 'partly' | 'not_working'}[] (a rule left out was skipped; 'partly' is kept some of the time, or by some of the team), date? (YYYY-MM-DD, defaults to today, can be backdated, never in the future), sprintId?, note?. It is stored against the current version, with each rule's text as it reads now, and clears those rules' marks from the round in progress on the page. Returns {recorded: true, id, checked, working, partly, pct (a rule partly working counts as half)}, or {recorded: false, reason: 'future_date' | 'unknown_sprint' | 'unknown_rule' (with unknown ids) | 'no_results'}.",
  paramsSchema: CheckInParams,
  handler: async (params) => recordCheckIn(browserStore, params),
  mcpHandler: async (params, ctx) => recordCheckIn(serverStore(ctx.userId), params),
});

async function removeCheckIn(store: AgreementStore, id: string) {
  return change(store, (doc) =>
    (doc.checkIns ?? []).some((c) => c.id === id)
      ? {
          doc: { ...doc, checkIns: (doc.checkIns ?? []).filter((c) => c.id !== id) },
          result: { removed: true },
        }
      : { refuse: { removed: false, reason: "not_found" } }
  );
}

registry.register({
  id: "tool.working_agreement.remove_check_in",
  toolId: "tool.working_agreement",
  name: "remove_check_in",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a saved check-in round by id (ids are in list_state checkIns). Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params) => removeCheckIn(browserStore, params.id),
  mcpHandler: async (params, ctx) => removeCheckIn(serverStore(ctx.userId), params.id),
});

/* ── Publish ────────────────────────────────────────────────────────── */

async function publish(store: AgreementStore) {
  const at = new Date().toISOString();
  return change(store, (doc) => {
    if (doc.rules.length === 0) return { refuse: { published: false, reason: "no_rules" } };
    if (!canPublish(doc)) {
      return { refuse: { published: false, reason: "nothing_changed", version: doc.meta.version } };
    }
    const latest = latestVersion(doc);
    const diff = latest ? diffVersions(latest.rules, draftRules(doc)) : null;
    const next = published(doc, at);
    return {
      doc: next,
      result: {
        published: true,
        version: next.meta.version,
        publishedAt: at,
        changes: diff && !diffIsEmpty(diff) ? diff : null,
      },
    };
  });
}

registry.register({
  id: "tool.working_agreement.publish",
  toolId: "tool.working_agreement",
  name: "publish",
  category: "write",
  requiresConfirmation: false,
  description:
    "Publish the agreement: snapshot the rules (with the team name and description) as the next version, as the page's Publish does. Refused when nothing changed since the latest version, or with no rules; allowed once for a charter published before versions were kept (needsSnapshot), to keep its first snapshot. Returns {published: true, version, publishedAt, changes: null | {added, removed, reworded, recategorised, redescribed} (against the previous version)}, or {published: false, reason: 'nothing_changed' (with version) | 'no_rules'}.",
  paramsSchema: z.object({}),
  handler: async () => publish(browserStore),
  mcpHandler: async (_params, ctx) => publish(serverStore(ctx.userId)),
});

/* ── Charter templates ──────────────────────────────────────────────── */

registry.register({
  id: "tool.working_agreement.list_templates",
  toolId: "tool.working_agreement",
  name: "list_templates",
  category: "read",
  description:
    "The four charter templates (urgency-ladder, core-hours, focus-time, ai-use) and whether the charter has each one. Returns {templates: {id, name, applied, appliedAt?, values? (the answers it was applied with), ruleIds (the rules it wrote that are still its own; a rule edited by hand leaves its template)}[]}.",
  paramsSchema: z.object({}),
  handler: async () => ({
    templates: templatesSummary(
      normalizeAgreement((await browserStore.getDoc()) ?? emptyAgreement())
    ),
  }),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverStore(ctx.userId).getDoc();
    return { templates: templatesSummary(normalizeAgreement(doc ?? emptyAgreement())) };
  },
});

const M = CHARTER_TEMPLATE_MAX;
const Time = z.string().regex(TIME_PATTERN).describe("HH:MM");
const Days = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .describe("0 Sunday to 6 Saturday");
const Zone = z
  .string()
  .trim()
  .min(1)
  .max(TEAM_TIME_MAX.zone)
  .describe('An IANA time zone, such as "Europe/London".');

const ApplyTemplateParams = z
  .object({
    template: z.enum(CHARTER_TEMPLATE_IDS),
    urgencyLadder: z
      .object({
        levels: z
          .array(
            z.object({
              id: z.string().trim().max(64).optional(),
              label: z.string().trim().min(1).max(M.levelLabel),
              when: z.string().trim().min(1).max(M.levelWhen),
              channel: z.string().trim().min(1).max(M.levelChannel),
              replyWithin: z
                .string()
                .trim()
                .min(1)
                .max(M.levelReplyWithin)
                .describe('Free text, such as "15 minutes, any time" or "No reply needed".'),
            })
          )
          .min(M.levelsMin)
          .max(M.levels)
          .describe("Most urgent first."),
        afterHours: z
          .boolean()
          .optional()
          .describe("Add the rule that outside working hours only the first level can't wait."),
      })
      .optional(),
    coreHours: z
      .object({
        start: Time,
        end: Time,
        timeZone: Zone.optional().describe(
          "The zone the hours are in; defaults to the browser's (UTC over MCP)."
        ),
        days: Days,
        purposes: z.array(z.enum(CORE_HOURS_PURPOSES)).min(1).max(CORE_HOURS_PURPOSES.length),
        anchorDays: z
          .array(z.object({ site: z.string().trim().min(1).max(M.site), days: Days }))
          .max(M.anchorDays)
          .optional()
          .describe("Office anchor days per site, such as Team Time's."),
      })
      .optional(),
    focusTime: z
      .object({
        days: Days,
        start: Time,
        end: Time,
        timeZone: Zone.nullable()
          .optional()
          .describe("One shared zone, or null (the default) for each person's own clock."),
        weeklyMinHours: z.number().min(M.weeklyMinHoursMin).max(M.weeklyMinHours).optional(),
      })
      .optional(),
    aiUse: z
      .object({
        tools: z.array(z.string().trim().min(1).max(M.aiTool)).max(M.aiTools).optional(),
        neverIn: z.array(z.enum(AI_USE_NEVER_IN)).max(AI_USE_NEVER_IN.length).optional(),
        neverInOther: z.string().trim().max(M.aiNote).optional(),
        review: z.enum(AI_USE_REVIEW),
        customerFacing: z.boolean().optional(),
        shareWhere: z.string().trim().max(M.aiNote).optional(),
      })
      .optional(),
  })
  .refine((p) => p[TEMPLATE_KEY[p.template]] !== undefined, {
    message:
      "Give the answers for the template you apply: urgencyLadder for urgency-ladder, coreHours for core-hours, focusTime for focus-time, aiUse for ai-use.",
  });

/** The browser's own zone, or UTC when it has none. */
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

async function applyTemplateVerb(
  store: AgreementStore,
  params: z.infer<typeof ApplyTemplateParams>,
  defaultZone: string
) {
  const id = params.template;
  const given = (params[TEMPLATE_KEY[id]] ?? {}) as Record<string, unknown>;
  const raw =
    id === "core-hours"
      ? { ...given, timeZone: given.timeZone ?? defaultZone }
      : id === "focus-time"
        ? { ...given, timeZone: given.timeZone ?? null }
        : given;
  const checked = validateTemplate(id, raw);
  if (!checked.ok) return { applied: false, reason: "invalid", errors: checked.errors };
  const at = new Date().toISOString();
  return change(store, (doc) => {
    const out = applyTemplate(doc, id, checked.values, () => crypto.randomUUID(), at);
    return {
      doc: out.doc,
      result: {
        applied: true,
        added: out.added,
        updated: out.updated,
        removed: out.removed,
        skipped: out.skipped.map((s) => ({ slot: s.slot, reason: s.reason, ruleId: s.ruleId })),
        ruleIds: out.ruleIds,
      },
    };
  });
}

registry.register({
  id: "tool.working_agreement.apply_template",
  toolId: "tool.working_agreement",
  name: "apply_template",
  category: "write",
  requiresConfirmation: false,
  description:
    "Apply a charter template, as the page's Templates do: the answers are saved with the charter and turned into two or three plain rules (eight at most for all four templates). Params: template (urgency-ladder | core-hours | focus-time | ai-use) and its answers under the matching key: urgencyLadder {levels: {label, when, channel, replyWithin}[] (2–6, most urgent first), afterHours?}; coreHours {start, end (HH:MM), timeZone? (default the browser's, UTC over MCP), days (0 Sunday–6 Saturday), purposes (meetings | quick-replies | pairing, at least one), anchorDays?: {site, days}[] (at most 4)}; focusTime {days, start, end, timeZone? (null, the default: each person's own clock), weeklyMinHours? (1–40)}; aiUse {neverIn? (customer-data | secrets | confidential), neverInOther?, review (as-any-work | closer-look | not-production), customerFacing?, tools? (at most 5, kept with the charter, not as rules), shareWhere?}. Applying again matches the template's rules by line: the same rule is updated in place and keeps its consent (ask the team again if the change matters), a new line is added, a line no longer written is removed; a rule edited by hand is the team's own and isn't touched. A line whose text is already in the charter (a Kickoff rule included) is skipped. Returns {applied: true, added, updated, removed (rule ids), skipped: {slot, reason: 'duplicate', ruleId}[], ruleIds (the template's rules now)}, or {applied: false, reason: 'invalid', errors (by field)}.",
  paramsSchema: ApplyTemplateParams,
  handler: async (params) => applyTemplateVerb(browserStore, params, browserZone()),
  mcpHandler: async (params, ctx) => applyTemplateVerb(serverStore(ctx.userId), params, "UTC"),
});
