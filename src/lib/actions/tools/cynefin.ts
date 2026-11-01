/**
 * Cynefin Decision Picker — tool-local actions.
 *
 * Category: Decision Frameworks
 * Tool:     Snowden's Cynefin framework: place a problem in one of five
 *           domains (clear / complicated / complex / chaotic / confused)
 *           and act the way that domain needs. Guided questions suggest a
 *           domain; the team (or the agent, for them) confirms it.
 *
 * Agent surface: tool.cynefin.*
 *   1. classify               — pure: the domain the guided answers (or,
 *                               without answers, signal keywords) suggest,
 *                               why, and its recipe; the questions too.
 *   2. list_state             — the items grouped by domain, with the
 *                               verdict, the complex items no hypothesis
 *                               is testing, and each item's plan.
 *   3. record_domain          — file a problem (or move one) under the
 *                               domain the team confirmed: required, never
 *                               defaulted. Answers are kept.
 *   4. classify_and_persist   — kept: file from an explicit domain or from
 *                               signals/answers in one call.
 *   5. set_recommended_action — kept: write a plan for one item.
 *   6. send_to_hypothesis     — a complex item becomes a hypothesis in the
 *                               Hypothesis Tracker (once).
 *
 * Every recipe, question, suggestion and verdict comes from lib/cynefin,
 * which the page uses too. Entity kinds "workspace:cynefinItem" and
 * "workspace:hypothesisTracker" (the fixed hypothesisTracker:current doc)
 * match the browser sync and the generic CRUD.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type {
  CynefinDomain,
  CynefinItem,
  HandoffLink,
  HypothesisTracker,
} from "@/lib/stores/workspace-types";
import { CYNEFIN_ANSWERS } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { buildHypothesis, HYPOTHESIS_TRACKER_ID } from "@/lib/handoffs/targets/hypothesis";
import {
  ACTION_MAX,
  DOMAINS,
  DOMAIN_IDS,
  QUESTIONS,
  RATIONALE_MAX,
  TITLE_MAX,
  classifySignals,
  complexNotTested,
  cynefinVerdict,
  groupByDomain,
  hypothesisLinkOf,
  hypothesisSourceOf,
  hypothesisStateOf,
  normalizeAnswers,
  normalizeDomain,
  planOf,
  senseDomain,
  withSentLink,
  type CynefinAnswers,
} from "@/lib/cynefin/model";

/** MUST match registerCollection("cynefinItem", …) in workspace-store.ts. */
const KIND_CYNEFIN = "workspace:cynefinItem";
/** MUST match registerCollection("hypothesisTracker", …) in workspace-store.ts. */
const KIND_HT = "workspace:hypothesisTracker";

const DomainSchema = z.enum(DOMAIN_IDS);
const AnswerSchema = z.enum(CYNEFIN_ANSWERS);
const AnswersSchema = z
  .object({
    crisis: AnswerSchema.optional(),
    known: AnswerSchema.optional(),
    analysable: AnswerSchema.optional(),
    emergent: AnswerSchema.optional(),
    disagree: AnswerSchema.optional(),
  })
  .strict()
  .describe(
    `Answers to the guided questions, each yes | no | unsure: ${QUESTIONS.map((q) => `${q.id}: "${q.text}"`).join(" ")}`
  );

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter ───────────────────────────────────────────────── */

interface CynefinStore {
  items(): Promise<CynefinItem[]>;
  put(item: CynefinItem): Promise<void>;
  tracker(): Promise<HypothesisTracker | null>;
  putTracker(doc: HypothesisTracker): Promise<void>;
}

const browserStore: CynefinStore = {
  items: async () => ws().cynefinItems ?? [],
  put: async (item) => ws().upsertCynefinItem(item),
  tracker: async () =>
    (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID) ?? null,
  putTracker: async (doc) => ws().upsertHypothesisTracker(doc),
};

function serverStore(userId: string): CynefinStore {
  return {
    items: () => serverListEntities<CynefinItem>(userId, KIND_CYNEFIN),
    put: async (item) => {
      await serverUpsertEntity<CynefinItem>(userId, KIND_CYNEFIN, item);
    },
    tracker: async () =>
      (await serverGetEntity<HypothesisTracker>(userId, KIND_HT, HYPOTHESIS_TRACKER_ID)) ?? null,
    putTracker: async (doc) => {
      await serverUpsertEntity<HypothesisTracker>(userId, KIND_HT, doc);
    },
  };
}

/* ── classify (pure) ─────────────────────────────────────────────────── */

/** The suggestion for answers (when any) or signals, in classify's shape. */
function classifyFrom(signals: readonly string[] | undefined, answers: CynefinAnswers | undefined) {
  const a = normalizeAnswers(answers);
  if (Object.keys(a).length > 0) {
    const s = senseDomain(a);
    return {
      recommendedDomain: s.domain,
      rationale: s.reason,
      recommendedAction: s.domain ? DOMAINS[s.domain].recipe : null,
      from: "answers" as const,
      answered: s.answered,
    };
  }
  const c = classifySignals(signals ?? []);
  return {
    recommendedDomain: c.recommendedDomain,
    rationale: c.rationale,
    recommendedAction: c.recommendedAction,
    from: "signals" as const,
    matched: c.matched,
  };
}

registry.register({
  id: "tool.cynefin.classify",
  toolId: "tool.cynefin",
  name: "classify",
  category: "read",
  description:
    "Suggest a Cynefin domain (clear / complicated / complex / chaotic / confused) for a problem. Pure: nothing is stored, and a suggestion isn't a decision (record_domain files the confirmed one). With answers to the guided questions it uses the page's rules (crisis yes → chaotic; disagreement or contradiction → confused; known best practice → clear; only trying will tell → complex; experts can analyse → complicated; fewer than 2 answers → no suggestion, recommendedDomain null). Without answers it reads signal keywords ('known-knowns' → clear, 'known-unknowns' → complicated, 'unknown-unknowns' → complex, 'urgent'/'chaos' → chaotic, 'undecided' → confused; chaotic > complex > complicated > clear > confused). Params: title, signals?, answers?. Returns {recommendedDomain, rationale, recommendedAction, from: 'answers' | 'signals', questions}, plus answered (from answers: the questions answered, Not sure included) or matched (from signals: false when no keyword matched, so the 'confused' returned is a placeholder, not a suggestion).",
  paramsSchema: z.object({
    title: z
      .string()
      .min(1)
      .max(TITLE_MAX)
      .describe("Short label for the problem being classified"),
    signals: z
      .array(z.string())
      .optional()
      .describe("Keywords describing what's known/unknown about the problem. Case-insensitive."),
    answers: AnswersSchema.optional(),
  }),
  handler: async (params) => ({
    ...classifyFrom(params.signals, params.answers),
    questions: QUESTIONS,
  }),
  // No mcpHandler — pure compute runs identically on server and client.
});

/* ── list_state ──────────────────────────────────────────────────────── */

async function listState(store: CynefinStore) {
  const [items, tracker] = await Promise.all([store.items(), store.tracker()]);
  const hypotheses = tracker?.hypotheses ?? [];
  const withPlan = items.map((it) => ({
    ...it,
    plan: planOf(it).text,
    customPlan: planOf(it).custom,
    hypothesis: hypothesisStateOf(it, hypotheses),
  }));
  const grouped = groupByDomain(withPlan);
  return {
    ...grouped,
    total: items.length,
    verdict: cynefinVerdict(items, hypotheses),
    complexNotTested: complexNotTested(items, hypotheses).map((it) => it.id),
    questions: QUESTIONS,
  };
}

registry.register({
  id: "tool.cynefin.list_state",
  toolId: "tool.cynefin",
  name: "list_state",
  category: "read",
  description:
    "List the Cynefin items grouped by domain, as the page shows them. An unknown or legacy domain (e.g. 'simple') reads as confused. Returns {clear, complicated, complex, chaotic, confused: (CynefinItem & {plan, customPlan, hypothesis: 'none' | 'testing' | 'tested'})[], total, verdict, complexNotTested: ids of complex items no hypothesis is testing, questions}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── record_domain ───────────────────────────────────────────────────── */

const RecordSchema = z
  .object({
    id: z.string().optional().describe("An existing item to move; omit to file a new problem"),
    title: z.string().trim().min(1).max(TITLE_MAX).optional().describe("Required for a new item"),
    domain: DomainSchema.describe("The domain the team confirmed (required: never defaulted)"),
    rationale: z.string().max(RATIONALE_MAX).optional(),
    answers: AnswersSchema.optional(),
  })
  .refine((p) => p.id !== undefined || p.title !== undefined, {
    message: "Give an id to move an item, or a title to file a new one.",
  });

async function recordDomain(store: CynefinStore, p: z.infer<typeof RecordSchema>) {
  const answers = normalizeAnswers(p.answers);
  const hasAnswers = Object.keys(answers).length > 0;
  const rationale = p.rationale?.trim();
  if (p.id) {
    const current = (await store.items()).find((x) => x.id === p.id);
    if (!current) return { recorded: false, reason: "not_found" };
    const next: CynefinItem = {
      ...current,
      domain: p.domain,
      ...(p.title ? { title: p.title.trim() } : {}),
      ...(rationale ? { rationale } : {}),
      ...(hasAnswers ? { answers } : {}),
    };
    // A plan written for the item survives a move; a recipe copy follows the domain.
    if (!planOf(current).custom) delete next.recommendedAction;
    await store.put(next);
    return { recorded: true, id: current.id, domain: p.domain, created: false };
  }
  const item: CynefinItem = {
    id: `cynefin_${nanoid(8)}`,
    title: (p.title ?? "").trim(),
    domain: p.domain,
    ...(rationale ? { rationale } : {}),
    ...(hasAnswers ? { answers } : {}),
    loggedAt: new Date().toISOString(),
  };
  await store.put(item);
  return { recorded: true, id: item.id, domain: item.domain, created: true };
}

registry.register({
  id: "tool.cynefin.record_domain",
  toolId: "tool.cynefin",
  name: "record_domain",
  category: "write",
  requiresConfirmation: false,
  description:
    "File a problem under the domain the team confirmed, or move an item to another domain (a plan written for it is kept). The domain is required: use classify for a suggestion first. Params: id? (move) or title (new), domain, rationale?, answers? (the guided answers it was placed with). Returns {recorded: true, id, domain, created} or {recorded: false, reason: 'not_found'}.",
  paramsSchema: RecordSchema,
  handler: async (params) => recordDomain(browserStore, params),
  mcpHandler: async (params, ctx) => recordDomain(serverStore(ctx.userId), params),
});

/* ── classify_and_persist (kept) ─────────────────────────────────────── */

const PersistSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    domain: DomainSchema.optional().describe(
      "Explicit Cynefin domain — overrides classification when both this and signals/answers are supplied"
    ),
    signals: z
      .array(z.string())
      .optional()
      .describe(
        "Signal keywords to classify from (see tool.cynefin.classify). Ignored when domain is supplied."
      ),
    answers: AnswersSchema.optional().describe(
      "Guided answers to classify from (they win over signals); stored with the item"
    ),
    rationale: z
      .string()
      .max(RATIONALE_MAX)
      .optional()
      .describe("Why this domain? Overrides the classifier's reason when present."),
    recommendedAction: z
      .string()
      .max(ACTION_MAX)
      .optional()
      .describe("A plan for this item. Without one the item shows its domain's recipe."),
  })
  .refine(
    (p) =>
      p.domain !== undefined ||
      (p.signals && p.signals.length > 0) ||
      Object.keys(normalizeAnswers(p.answers)).length > 0,
    { message: "Must supply an explicit `domain`, a non-empty `signals` array, or `answers`." }
  );

/**
 * The item classify_and_persist files: the explicit domain, else the
 * answers' suggestion, else the signals'. The rationale is the caller's,
 * or the classifier's reason when it classified; an explicit domain with
 * no rationale gets none (it used to be a placeholder the page showed).
 * Nothing is filed by default: answers that suggest no domain, or signals
 * no keyword matches (classifySignals then falls back to Confused, which
 * is a placeholder, not a suggestion), are refused like the page refuses
 * an item without a domain.
 */
function buildItem(p: z.infer<typeof PersistSchema>): CynefinItem | { refuse: string } {
  const answers = normalizeAnswers(p.answers);
  const hasAnswers = Object.keys(answers).length > 0;
  let domain: CynefinDomain;
  let derived: string | undefined;
  if (p.domain) {
    domain = p.domain;
  } else {
    const c = classifyFrom(p.signals, hasAnswers ? answers : undefined);
    if (!c.recommendedDomain) return { refuse: c.rationale };
    if (c.from === "signals" && !c.matched) {
      return {
        refuse:
          "No signal matches a domain's keywords, so there is nothing to suggest: file it with tool.cynefin.record_domain and the domain the team confirmed, or classify from the guided answers.",
      };
    }
    domain = c.recommendedDomain;
    derived = c.rationale;
  }
  const rationale = p.rationale?.trim() || derived;
  const plan = p.recommendedAction?.trim();
  return {
    id: `cynefin_${nanoid(8)}`,
    title: p.title.slice(0, TITLE_MAX),
    domain,
    ...(rationale ? { rationale } : {}),
    // A plan given is the item's; otherwise the recipe of its domain, as before.
    recommendedAction: plan || DOMAINS[domain].recipe,
    ...(hasAnswers ? { answers } : {}),
    loggedAt: new Date().toISOString(),
  };
}

async function classifyAndPersist(store: CynefinStore, p: z.infer<typeof PersistSchema>) {
  const item = buildItem(p);
  if ("refuse" in item) return { persisted: false, reason: "no_suggestion", message: item.refuse };
  await store.put(item);
  return { id: item.id, domain: item.domain, recommendedAction: item.recommendedAction };
}

registry.register({
  id: "tool.cynefin.classify_and_persist",
  toolId: "tool.cynefin",
  name: "classify_and_persist",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a new Cynefin item in one call. Supply an explicit `domain` (already decided), or `answers` / `signals` to classify from (tool.cynefin.classify); domain wins over answers, and answers over signals. Answers are stored with the item. The rationale is yours, or the classifier's reason; an explicit domain without one stores none. Returns {id, domain, recommendedAction}, or {persisted: false, reason: 'no_suggestion', message} (nothing stored) when the answers don't point to a domain or no signal matches a keyword: nothing is filed under a default domain, so use record_domain with the domain the team confirmed.",
  paramsSchema: PersistSchema,
  handler: async (params) => classifyAndPersist(browserStore, params),
  mcpHandler: async (params, ctx) => classifyAndPersist(serverStore(ctx.userId), params),
});

/* ── set_recommended_action (kept) ───────────────────────────────────── */

async function setAction(store: CynefinStore, p: { id: string; recommendedAction: string }) {
  const current = (await store.items()).find((c) => c.id === p.id);
  if (!current) return { updated: false };
  await store.put({ ...current, recommendedAction: p.recommendedAction });
  return { updated: true };
}

registry.register({
  id: "tool.cynefin.set_recommended_action",
  toolId: "tool.cynefin",
  name: "set_recommended_action",
  category: "write",
  requiresConfirmation: false,
  description:
    "Write a plan for one Cynefin item (its recommendedAction), e.g. refining 'Probe → Sense → Respond' into the experiment to run. The page shows it as a custom plan, and it survives a change of domain. Params: id, recommendedAction. Returns {updated: false} when the id is unknown.",
  paramsSchema: z.object({
    id: z.string(),
    recommendedAction: z.string().min(1).max(ACTION_MAX),
  }),
  handler: async (params) => setAction(browserStore, params),
  mcpHandler: async (params, ctx) => setAction(serverStore(ctx.userId), params),
});

/* ── send_to_hypothesis ──────────────────────────────────────────────── */

async function sendToHypothesis(store: CynefinStore, id: string) {
  const [items, tracker] = await Promise.all([store.items(), store.tracker()]);
  const item = items.find((x) => x.id === id);
  if (!item) return { sent: false, reason: "not_found" };
  if (normalizeDomain(item.domain) !== "complex") return { sent: false, reason: "not_complex" };
  if (isExampleId(item.id)) return { sent: false, reason: "example" };
  const hypotheses = tracker?.hypotheses ?? [];
  if (hypothesisStateOf(item, hypotheses) !== "none") {
    return { sent: false, reason: "already_sent", hypothesisId: hypothesisLinkOf(item)?.targetId };
  }
  const h = buildHypothesis(hypothesisSourceOf(item));
  // Newest first, as the tracker (and the hand-off) add them.
  await store.putTracker({
    ...(tracker ?? {}),
    id: HYPOTHESIS_TRACKER_ID,
    hypotheses: [h, ...hypotheses],
  });
  const link: HandoffLink = { route: "hypothesis", targetId: h.id, at: new Date().toISOString() };
  await store.put({ ...item, sentTo: withSentLink(item.sentTo, link) });
  return { sent: true, hypothesisId: h.id, believe: h.believe };
}

registry.register({
  id: "tool.cynefin.send_to_hypothesis",
  toolId: "tool.cynefin",
  name: "send_to_hypothesis",
  category: "write",
  requiresConfirmation: false,
  description:
    "Turn a complex Cynefin item into a drafted hypothesis in the Hypothesis Tracker (its title as the 'We believe' line, without a leading 'We believe' since the tracker labels the field so; its rationale as what to learn), linked both ways, as the page's 'Turn into a hypothesis' does. Once per item while that hypothesis exists; complex items only. Params: id. Returns {sent: true, hypothesisId, believe} or {sent: false, reason: 'not_found' | 'not_complex' | 'example' | 'already_sent', hypothesisId?}.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => sendToHypothesis(browserStore, params.id),
  mcpHandler: async (params, ctx) => sendToHypothesis(serverStore(ctx.userId), params.id),
});
