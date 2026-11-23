/**
 * Product Canvas — tool-local actions.
 *
 * Category: Strategic Planning (tools plan, phase 2)
 *
 * Agent surface: tool.product_canvas.*
 * Backing CRUD : workspace.product_canvas.* (create, list, update,
 *                delete): one ProductCanvas per canvas, under its own id
 *                ("pcanvas_…"), kind PRODUCT_CANVAS_KIND.
 *
 *   1. list_state    — the active Product Goal and the vision, every canvas
 *                      with how far along it is and its gaps, the idea
 *                      inbox's counts and the betting table's cycles; with
 *                      `id`, one canvas in full, with what its format works
 *                      out (the pitch, the fit meter, the hypotheses, the
 *                      press release's words and the hard questions, an
 *                      idea's intake and look-alikes, a business case's
 *                      decision, a pitch's appetite, bet and circuit breaker).
 *   2. create_canvas — a new canvas in a format, optionally started from
 *                      the Product Goal (the draft with no AI).
 *   3. add_items     — lines added to a list box.
 *   4. update_item   — one line's words, answer, fact-or-guess mark or links.
 *   5. set_field     — a one-line or paragraph box set or cleared.
 *   6. log_idea      — an idea into the inbox, with the open ideas like it.
 *   7. triage_idea   — an idea assessed, accepted, declined or merged.
 *   8. set_decision  — a business case's verdict.
 *   9. place_bet     — a Shape Up pitch's place on the betting table.
 *
 * Every write goes through lib/product-canvas (the model, intake.ts,
 * bets.ts), so the caps and refusals are the page's. The page logs history
 * and does every send (an accepted idea to the backlog or the Opportunity
 * Tree, a case to the Decision Log, a scope to the backlog); nothing here
 * reaches other people: every verb is the visitor's own data.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverGetEntity,
  serverGetUserStateBlob,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import {
  PRODUCT_BET_STATUSES,
  PRODUCT_CANVAS_EVIDENCE,
  PRODUCT_CANVAS_KIND,
  PRODUCT_CASE_VERDICTS,
  PRODUCT_GOAL_KIND,
  PRODUCT_IDEA_SOURCES,
  TOOL_LIST_MAX,
  type Hypothesis,
  type HypothesisTracker,
  type ProductCanvas,
  type ProductCanvasFormat,
  type ProductGoal,
  type Story,
} from "@/lib/stores/workspace-types";
import { circuitBreaker, cycles, placeBet } from "@/lib/product-canvas/bets";
import {
  CYCLE_MAX,
  NOTE_MAX,
  REQUESTER_MAX,
  WEEKS_MAX,
  cycleEnd,
  likelyDuplicates,
} from "@/lib/product-canvas/fields";
import { ideasOf, inboxCounts, mergeIdeas, rootOf, unmergeIdea } from "@/lib/product-canvas/intake";
import { HYPOTHESIS_TRACKER_ID, linkedTest } from "@/lib/hypotheses/model";
import { activeGoal } from "@/lib/product-goal/model";
import { PRODUCT_GOAL_STORE_KEY, visionFromBlob } from "@/lib/product-goal/prefs";
import { BUILT_FORMATS, PRODUCT_FORMATS } from "@/lib/product-canvas/formats";
import {
  DETAIL_MAX,
  ITEM_MAX,
  LINKS_MAX,
  LINK_ID_MAX,
  LONG_MAX,
  TITLE_MAX,
  boxesFilled,
  canvasGaps,
  fitLine,
  fitMeter,
  formatOf,
  hardQuestions,
  hypothesisPicks,
  itemCount,
  itemsOf,
  lineLinkedTo,
  newCanvas,
  newCanvasId,
  newIdea,
  pitchOf,
  pitchSentence,
  readCanvas,
  readCanvases,
  releaseWords,
  validateLaunchDate,
  withDecision,
  withDraftLines,
  withIdeaStatus,
  withItemPatch,
  withItems,
  withText,
  type CanvasWrite,
} from "@/lib/product-canvas/model";
import { draftOffer, starterDraft } from "@/lib/product-canvas/starter";
import { isExampleId } from "@/lib/utils/example-id";
import { todayIso } from "@/lib/sprints/series";

const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();
const KIND_STORY = "workspace:story";
const KIND_TRACKER = "workspace:hypothesisTracker";

/** Where the verbs read and write: the browser's store, or the user's rows on the server. */
interface Store {
  list: () => Promise<ProductCanvas[]>;
  get: (id: string) => Promise<ProductCanvas | null>;
  put: (c: ProductCanvas) => Promise<void>;
  goals: () => Promise<ProductGoal[]>;
  vision: () => Promise<string>;
  stories: () => Promise<Story[]>;
  hypotheses: () => Promise<Hypothesis[]>;
}

/** The Product Goal page's persisted vision, as this browser holds it, or null. */
function browserPrefsBlob(): unknown {
  try {
    const raw =
      typeof window === "undefined" ? null : window.localStorage.getItem(PRODUCT_GOAL_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const trackerHypotheses = (docs: readonly HypothesisTracker[] | undefined) =>
  (docs ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];

const browserStore: Store = {
  list: async () => ws().productCanvases ?? [],
  get: async (id) => (ws().productCanvases ?? []).find((c) => c.id === id) ?? null,
  put: async (c) => ws().upsertProductCanvas(c),
  goals: async () => ws().productGoals ?? [],
  vision: async () => visionFromBlob(browserPrefsBlob()),
  stories: async () => ws().stories ?? [],
  hypotheses: async () => trackerHypotheses(ws().hypothesisTrackers),
};

const serverStore = (userId: string): Store => ({
  list: () => serverListEntities<ProductCanvas>(userId, PRODUCT_CANVAS_KIND),
  get: (id) => serverGetEntity<ProductCanvas>(userId, PRODUCT_CANVAS_KIND, id),
  put: async (c) => {
    await serverUpsertEntity<ProductCanvas>(userId, PRODUCT_CANVAS_KIND, c);
  },
  goals: () => serverListEntities<ProductGoal>(userId, PRODUCT_GOAL_KIND),
  // The vision as the user's synced row holds it; none without one.
  vision: async () => {
    try {
      return visionFromBlob(await serverGetUserStateBlob(userId, PRODUCT_GOAL_STORE_KEY));
    } catch {
      return "";
    }
  },
  stories: () => serverListEntities<Story>(userId, KIND_STORY),
  hypotheses: async () =>
    trackerHypotheses(await serverListEntities<HypothesisTracker>(userId, KIND_TRACKER)),
});

const FormatEnum = z.enum(
  BUILT_FORMATS as unknown as [ProductCanvasFormat, ...ProductCanvasFormat[]]
);
const FORMAT_HELP = `The format: ${BUILT_FORMATS.map((id) => `'${id}' (${PRODUCT_FORMATS[id]?.name})`).join(", ")}.`;
const CanvasId = z.string().min(1).max(64).describe("The canvas's id (see list_state).");
const SectionId = z
  .string()
  .min(1)
  .max(32)
  .describe("A box's id in the canvas's format (list_state with the canvas's id lists them).");

/** The canvases a canvas is read beside: the example's with the example, the team's with theirs. */
const sameWorld = (c: Pick<ProductCanvas, "id">, all: readonly ProductCanvas[]) =>
  all.filter((x) => isExampleId(x.id) === isExampleId(c.id));

/** The fields an idea, a business case or a pitch carries, as list_state shows them (no names). */
function formatFields(c: ProductCanvas, all: readonly ProductCanvas[]) {
  if (c.format === "idea" && c.intake) {
    const { status, demand, source, requesters, mergedInto, note } = c.intake;
    return {
      intake: {
        status,
        demand,
        source,
        requesters: requesters.length,
        mergedInto: mergedInto ? (rootOf(c.id, sameWorld(c, all))?.id ?? mergedInto) : null,
        ...(note ? { note } : {}),
      },
    };
  }
  if (c.format === "business-case") {
    return { decision: c.decision ?? { verdict: "pending" as const } };
  }
  if (c.format === "shape-up") {
    const bet = c.bet;
    return {
      appetiteWeeks: c.appetiteWeeks ?? null,
      bet: bet
        ? {
            status: bet.status,
            cycle: bet.cycle ?? null,
            start: bet.start ?? null,
            weeks: bet.weeks ?? null,
            end: cycleEnd(bet.start, bet.weeks),
          }
        : { status: "table" as const, cycle: null, start: null, weeks: null, end: null },
    };
  }
  return {};
}

/** What the gap rules read beside a canvas. */
const gapContext = (
  c: ProductCanvas,
  all: readonly ProductCanvas[],
  hypotheses: readonly Hypothesis[],
  goal: ProductGoal | undefined
) => ({ goal, hypotheses, today: todayIso(), ideas: ideasOf(sameWorld(c, all)) });

/** One canvas, as list_state lists it. */
function summary(
  c: ProductCanvas,
  all: readonly ProductCanvas[],
  hypotheses: readonly Hypothesis[],
  goal: ProductGoal | undefined
) {
  const format = formatOf(c);
  return {
    id: c.id,
    example: isExampleId(c.id),
    format: c.format,
    formatName: format.name,
    title: c.title,
    boxes: boxesFilled(c),
    lines: itemCount(c),
    gaps: canvasGaps(c, gapContext(c, all, hypotheses, goal)).length,
    ...formatFields(c, all),
    productGoalId: c.productGoalId ?? null,
    updatedAt: c.updatedAt,
  };
}

/** One canvas in full, with what its format works out. */
function detail(
  c: ProductCanvas,
  all: readonly ProductCanvas[],
  hypotheses: readonly Hypothesis[],
  goal: ProductGoal | undefined
) {
  const format = formatOf(c);
  const boxes = format.sections.map((def) => ({
    id: def.id,
    label: def.label,
    kind: def.kind,
    max: def.max,
    required: def.required,
    marksFacts: Boolean(def.evidence),
    asksQuestions: Boolean(def.qa),
    marksNiceToHave: Boolean(def.niceToHave),
    linksTo: def.linksTo ?? [],
    lines: itemsOf(c, def.id).map((i) => ({
      id: i.id,
      text: i.text,
      ...(i.evidence ? { evidence: i.evidence } : {}),
      ...(i.detail ? { answer: i.detail } : {}),
      ...(i.links ? { links: i.links } : {}),
      ...(i.promptId ? { hardQuestion: i.promptId } : {}),
      ...(i.niceToHave ? { niceToHave: true } : {}),
      test: linkedTest(i.sentTo, hypotheses).state,
    })),
  }));
  const out: Record<string, unknown> = {
    ...summary(c, all, hypotheses, goal),
    boxes,
    gapList: canvasGaps(c, gapContext(c, all, hypotheses, goal)).map((g) => ({
      box: g.sectionId ?? null,
      text: g.text,
    })),
  };
  if (c.format === "idea") {
    // Amr works for the canvas's owner: the full detail names who asked.
    out.requesters = c.intake?.requesters ?? [];
    out.similar = likelyDuplicates(c.title, ideasOf(sameWorld(c, all)), { exclude: c.id }).map(
      (i) => ({ id: i.id, title: i.title })
    );
  }
  if (c.format === "shape-up") out.circuitBreaker = circuitBreaker(c, todayIso());
  if (c.format === "vision-board") out.pitch = pitchSentence(pitchOf(c)) || null;
  if (c.format === "value-proposition") {
    const meter = fitMeter(c, hypotheses);
    out.fit = { ...meter, line: fitLine(meter) };
  }
  if (c.format === "lean-ux") {
    out.hypotheses = itemsOf(c, "hypotheses").map((h) => {
      const picks = hypothesisPicks(c, h);
      return {
        id: h.id,
        text: h.text,
        outcome: picks.outcomes?.text ?? null,
        user: picks.users?.text ?? null,
        benefit: picks.benefits?.text ?? null,
        solution: picks.solutions?.text ?? null,
        learnFirst: lineLinkedTo(c, "learn-first", h.id)?.text ?? null,
        smallestTest: lineLinkedTo(c, "smallest-test", h.id)?.text ?? null,
        test: linkedTest(h.sentTo, hypotheses).state,
      };
    });
  }
  if (c.format === "pr-faq") {
    out.release = releaseWords(c);
    out.hardQuestions = hardQuestions(c);
  }
  return out;
}

const ListParams = z.object({
  format: FormatEnum.optional().describe(`Only canvases in this format. ${FORMAT_HELP}`),
  id: CanvasId.optional().describe("One canvas's id, to read it in full."),
});

async function listState(store: Store, p: z.infer<typeof ListParams>) {
  const [rows, goals, vision, hypotheses] = await Promise.all([
    store.list(),
    store.goals(),
    store.vision(),
    store.hypotheses(),
  ]);
  const goal = activeGoal(goals);
  const all = readCanvases(rows);
  const canvases = all.filter((c) => !p.format || c.format === p.format);
  const team = all.filter((c) => !isExampleId(c.id));
  const counts = inboxCounts(team);
  const base = {
    goal: goal ? { id: goal.id, statement: goal.statement } : null,
    vision,
    formats: BUILT_FORMATS.map((id) => ({ id, name: PRODUCT_FORMATS[id]?.name ?? id })),
    total: canvases.filter((c) => !isExampleId(c.id)).length,
    inbox: {
      open: counts.open,
      new: counts.new,
      assessing: counts.assessing,
      accepted: counts.accepted,
      declined: counts.declined,
      merged: counts.merged,
    },
    cycles: cycles(team).map((cy) => ({
      number: cy.number,
      name: cy.name,
      start: cy.start ?? null,
      weeks: cy.weeks ?? null,
      end: cy.end ?? null,
      bets: cy.bets.map((b) => ({ id: b.id, title: b.title, status: b.bet?.status ?? "table" })),
    })),
  };
  if (p.id) {
    const c = all.find((x) => x.id === p.id) ?? readCanvas(await store.get(p.id));
    if (!c) return { ...base, found: false as const };
    return { ...base, found: true as const, canvas: detail(c, all, hypotheses, goal) };
  }
  return { ...base, canvases: canvases.map((c) => summary(c, all, hypotheses, goal)) };
}

// ──────── tool.product_canvas.list_state ────────
registry.register({
  id: "tool.product_canvas.list_state",
  toolId: "tool.product_canvas",
  name: "list_state",
  category: "read",
  description:
    "Read Product Canvas: a product idea on one page, as a vision with its pitch, a Value Proposition, an idea in the inbox, a Lean UX canvas, a PR/FAQ, a lean business case or a Shape Up pitch. Returns {goal: {id, statement} | null (the active Product Goal), vision (the Product Goal page's vision, '' when none), formats: {id, name}[], total (canvases, examples left out), inbox: {open, new, assessing, accepted, declined, merged} (ideas by status, examples left out), cycles: {number, name, start, weeks, end, bets: {id, title, status}[]}[] (the betting table's cycles, newest first)} and, without `id`, canvases: {id, example, format, formatName, title, boxes: {filled, total}, lines, gaps (how many), productGoalId | null, updatedAt, and by format: intake {status, demand, source, requesters (how many), mergedInto (the idea it ended up in) | null, note?} (an idea), decision {verdict, note?, decidedAt?} (a business case), appetiteWeeks | null and bet {status, cycle, start, weeks, end} (a Shape Up pitch)}[] newest first. With `id`: {found, canvas} where canvas adds boxes: {id, label, kind ('list' | 'single' | 'long'), max, required, marksFacts, asksQuestions, marksNiceToHave (a Shape Up pitch's scopes), linksTo, lines: {id, text, evidence?, answer?, links?, hardQuestion?, niceToHave? (a scope marked nice to have, shown with ~), test ('none' | 'testing' | 'tested')}[]}[], gapList: {box | null, text}[], and per format: pitch (a vision), fit (a Value Proposition: pains eased, gains added, idle offer lines, confirmed), hypotheses (Lean UX, each with its picks, learn-first and smallest test), release {words, headline} and hardQuestions {id, text, asked, answered}[] (PR/FAQ), requesters (who asked) and similar {id, title}[] (open ideas that look like it) for an idea, circuitBreaker {due, end?} for a pitch (due: bet on a cycle that has ended). Create, rename or delete a canvas with workspace.product_canvas.*; sends (to the Hypothesis Tracker, the backlog, the Opportunity Tree, the Decision Log) are made on the page.",
  paramsSchema: ListParams,
  handler: (params) => listState(browserStore, params),
  mcpHandler: (params, ctx) => listState(serverStore(ctx.userId), params),
});

const CreateParams = z.object({
  format: FormatEnum.describe(FORMAT_HELP),
  title: z.string().trim().min(1).max(TITLE_MAX).describe("The canvas's name."),
  fromGoal: z
    .boolean()
    .optional()
    .describe(
      "Start from the Product Goal with no AI: its vision, statement, why and measures fill the boxes that start from them, and the other boxes get a [bracketed] starter line to fill in."
    ),
});

async function createCanvas(store: Store, p: z.infer<typeof CreateParams>) {
  const now = nowIso();
  let canvas = newCanvas({ id: newCanvasId(), format: p.format, title: p.title, now });
  if (p.fromGoal) {
    const [goals, vision, stories] = await Promise.all([
      store.goals(),
      store.vision(),
      store.stories(),
    ]);
    const goal = activeGoal(goals);
    const titles = stories
      .filter((s) => !isExampleId(s.id) && typeof s.title === "string" && s.title.trim())
      .slice(0, 20)
      .map((s) => s.title.slice(0, 200));
    const draft = starterDraft({
      format: p.format,
      title: canvas.title,
      ...(goal
        ? {
            goal: {
              statement: goal.statement.slice(0, 1000),
              why: (goal.why ?? "").slice(0, 1000),
              measures: goal.measures.slice(0, 10).map((m) => m.slice(0, 200)),
            },
          }
        : {}),
      vision: vision.slice(0, 2000),
      brief: "",
      fields: [],
      sections: [],
      stories: titles,
    });
    const offer = draftOffer(canvas, draft);
    const result = withDraftLines(canvas, offer.lines, now);
    if (result.write.ok) canvas = result.write.canvas;
    if (goal) canvas = { ...canvas, productGoalId: goal.id };
  }
  await store.put(canvas);
  return {
    created: true as const,
    id: canvas.id,
    format: canvas.format,
    lines: itemCount(canvas),
    fromGoal: Boolean(p.fromGoal),
  };
}

// ──────── tool.product_canvas.create_canvas ────────
registry.register({
  id: "tool.product_canvas.create_canvas",
  toolId: "tool.product_canvas",
  name: "create_canvas",
  category: "write",
  requiresConfirmation: false,
  description:
    "Start a product canvas in a format, by name. With fromGoal it starts from the Product Goal, the vision and the backlog's common theme (no AI): empty boxes get those words, or a starter line with [brackets] to fill in, and every drafted line on a fact-or-guess box is marked a guess. Returns {created: true, id, format, lines, fromGoal}.",
  paramsSchema: CreateParams,
  handler: (params) => createCanvas(browserStore, params),
  mcpHandler: (params, ctx) => createCanvas(serverStore(ctx.userId), params),
});

const refused = (w: Extract<CanvasWrite, { ok: false }>) => ({
  reason: w.reason,
  message: w.message,
});

const AddItemsParams = z.object({
  canvasId: CanvasId,
  section: SectionId,
  items: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(ITEM_MAX).describe("One idea, in plain words."),
        detail: z
          .string()
          .trim()
          .max(DETAIL_MAX)
          .optional()
          .describe("The answer, for a box that lists questions; ignored elsewhere."),
        evidence: z
          .enum(PRODUCT_CANVAS_EVIDENCE)
          .optional()
          .describe(
            "'fact' or 'assumption' (a guess), for a box that marks them; ignored elsewhere."
          ),
      })
    )
    .min(1)
    .max(12),
});

async function addItems(store: Store, p: z.infer<typeof AddItemsParams>) {
  const c = readCanvas(await store.get(p.canvasId));
  if (!c) return { added: false as const, reason: "not_found" as const };
  const w = withItems(c, p.section, p.items, nowIso());
  if (!w.ok) return { added: false as const, ...refused(w) };
  await store.put(w.canvas);
  return { added: true as const, ids: w.ids ?? [], lines: itemCount(w.canvas) };
}

// ──────── tool.product_canvas.add_items ────────
registry.register({
  id: "tool.product_canvas.add_items",
  toolId: "tool.product_canvas",
  name: "add_items",
  category: "write",
  requiresConfirmation: false,
  description: `Add up to 12 lines to the end of one list box on a product canvas, all or none. A line takes an answer only in a box that lists questions, and a fact-or-guess mark only in a box that marks them. A one-line or paragraph box is set with set_field. Returns {added: true, ids, lines}, or {added: false, reason: 'not_found' | 'unknown_section' | 'not_a_list' | 'section_full' | 'canvas_full' | 'too_big' | 'blank' | 'too_long', message} (each box holds its own number of lines, and a canvas ${TOOL_LIST_MAX.canvasItems} in all).`,
  paramsSchema: AddItemsParams,
  handler: (params) => addItems(browserStore, params),
  mcpHandler: (params, ctx) => addItems(serverStore(ctx.userId), params),
});

const UpdateItemParams = z.object({
  canvasId: CanvasId,
  itemId: z.string().min(1).max(64).describe("The line's id (list_state with the canvas's id)."),
  text: z
    .string()
    .trim()
    .min(1)
    .max(LONG_MAX)
    .optional()
    .describe("A list line's new words (a one-line or paragraph box takes set_field)."),
  detail: z
    .string()
    .trim()
    .max(DETAIL_MAX)
    .nullable()
    .optional()
    .describe("A question's answer; null or empty clears it."),
  evidence: z
    .enum(PRODUCT_CANVAS_EVIDENCE)
    .nullable()
    .optional()
    .describe("'fact', 'assumption' (a guess), or null to clear the mark."),
  links: z
    .array(z.string().min(1).max(LINK_ID_MAX))
    .max(LINKS_MAX)
    .optional()
    .describe(
      "The lines it links to, replacing its links ([] clears): a pain an ease takes away, a gain it adds, the hypothesis a learn-first or a smallest test is for."
    ),
  niceToHave: z
    .boolean()
    .optional()
    .describe(
      "A Shape Up scope: true marks it nice to have (shown with ~), false clears the mark; refused on other boxes."
    ),
});

async function updateItem(store: Store, p: z.infer<typeof UpdateItemParams>) {
  const c = readCanvas(await store.get(p.canvasId));
  if (!c) return { updated: false as const, reason: "not_found" as const };
  const w = withItemPatch(
    c,
    p.itemId,
    {
      ...(p.text !== undefined ? { text: p.text } : {}),
      ...(p.detail !== undefined ? { detail: p.detail || null } : {}),
      ...(p.evidence !== undefined ? { evidence: p.evidence } : {}),
      ...(p.links !== undefined ? { links: p.links } : {}),
      ...(p.niceToHave !== undefined ? { niceToHave: p.niceToHave } : {}),
    },
    nowIso()
  );
  if (!w.ok) return { updated: false as const, ...refused(w) };
  await store.put(w.canvas);
  return { updated: true as const };
}

// ──────── tool.product_canvas.update_item ────────
registry.register({
  id: "tool.product_canvas.update_item",
  toolId: "tool.product_canvas",
  name: "update_item",
  category: "write",
  requiresConfirmation: false,
  description:
    "Change one line on a product canvas: its words, a question's answer, its fact-or-guess mark, the lines it links to (checked against the boxes it may link to), or a Shape Up scope's nice-to-have mark. Fields left out stay. New words go only on a list box's line: a one-line or paragraph box (the launch date among them) is set with set_field, and its words here are refused as 'not_a_list'. Returns {updated: true}, or {updated: false, reason: 'not_found' | 'not_a_list' | 'blank' | 'too_long' | 'bad_field' | 'too_big', message}.",
  paramsSchema: UpdateItemParams,
  handler: (params) => updateItem(browserStore, params),
  mcpHandler: (params, ctx) => updateItem(serverStore(ctx.userId), params),
});

const SetFieldParams = z.object({
  canvasId: CanvasId,
  field: SectionId.describe("A one-line or paragraph box's id."),
  text: z
    .string()
    .max(LONG_MAX)
    .nullable()
    .describe(
      "The box's words; null or empty clears it. A launch date is a day (YYYY-MM-DD), today or later."
    ),
});

async function setField(store: Store, p: z.infer<typeof SetFieldParams>) {
  const c = readCanvas(await store.get(p.canvasId));
  if (!c) return { set: false as const, reason: "not_found" as const };
  let text = p.text;
  if (p.field === "launch-date" && text) {
    const v = validateLaunchDate(text, todayIso(), { typed: true });
    if (!v.ok) return { set: false as const, reason: "bad_date" as const, message: v.errors.date };
    text = v.values;
  }
  const w = withText(c, p.field, text, nowIso());
  if (!w.ok) return { set: false as const, ...refused(w) };
  await store.put(w.canvas);
  return { set: true as const, cleared: !text?.trim() };
}

// ──────── tool.product_canvas.set_field ────────
registry.register({
  id: "tool.product_canvas.set_field",
  toolId: "tool.product_canvas",
  name: "set_field",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set or clear a one-line or paragraph box on a product canvas (the vision, a pitch part, the customer group, the business problem, a press release part, the launch date, an idea's problem and our idea, a business case's epic, expectations and costs, a Shape Up pitch's problem and solution). Returns {set: true, cleared}, or {set: false, reason: 'not_found' | 'unknown_section' | 'not_an_answer' | 'too_long' | 'bad_date' | 'canvas_full' | 'too_big', message}.",
  paramsSchema: SetFieldParams,
  handler: (params) => setField(browserStore, params),
  mcpHandler: (params, ctx) => setField(serverStore(ctx.userId), params),
});

/* ── The idea inbox, the business case and the betting table ──────── */

const LogIdeaParams = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX).describe("The idea, in a line."),
  requester: z
    .string()
    .trim()
    .max(REQUESTER_MAX)
    .optional()
    .describe("Who asked for it: a role or a name, as the team writes it."),
  source: z
    .enum(PRODUCT_IDEA_SOURCES)
    .optional()
    .describe(
      "Where it came from: 'customer', 'stakeholder', 'team', 'data' or 'other' (default)."
    ),
  problem: z
    .string()
    .trim()
    .max(ITEM_MAX)
    .optional()
    .describe("The problem it answers, in a line: its box on the idea."),
});

async function logIdea(store: Store, p: z.infer<typeof LogIdeaParams>) {
  const rows = readCanvases(await store.list());
  const open = ideasOf(rows.filter((c) => !isExampleId(c.id)));
  const similar = likelyDuplicates(p.title, open).map((i) => ({ id: i.id, title: i.title }));
  const goal = activeGoal(await store.goals());
  const w = newIdea({
    id: newCanvasId(),
    now: nowIso(),
    title: p.title,
    ...(p.requester ? { requester: p.requester } : {}),
    ...(p.source ? { source: p.source } : {}),
    ...(p.problem ? { problem: p.problem } : {}),
    ...(goal ? { productGoalId: goal.id } : {}),
  });
  if (!w.ok) return { logged: false as const, ...refused(w) };
  await store.put(w.canvas);
  return { logged: true as const, id: w.canvas.id, similar };
}

// ──────── tool.product_canvas.log_idea ────────
registry.register({
  id: "tool.product_canvas.log_idea",
  toolId: "tool.product_canvas",
  name: "log_idea",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log an idea or a request in Product Canvas's idea inbox: one record per idea, asked for once (demand 1), status 'new'. Returns {logged: true, id, similar: {id, title}[]} (up to 3 open ideas that look like it, most asked for first: check them with the user, and merge with triage_idea instead of keeping both), or {logged: false, reason: 'blank' | 'too_long' | 'too_big', message}.",
  paramsSchema: LogIdeaParams,
  handler: (params) => logIdea(browserStore, params),
  mcpHandler: (params, ctx) => logIdea(serverStore(ctx.userId), params),
});

const TriageParams = z.object({
  canvasId: CanvasId.describe("The idea's id (list_state with format 'idea')."),
  status: z
    .enum(["assessing", "accepted", "declined", "merged"])
    .describe(
      "'assessing' (looking into it), 'accepted' (worth doing), 'declined' (not now: give a note saying why) or 'merged' (a repeat of another idea: give mergeInto)."
    ),
  mergeInto: CanvasId.optional().describe(
    "For 'merged': the idea it repeats. Its demand and who asked move there (to the idea that one was merged into, if it was)."
  ),
  note: z
    .string()
    .trim()
    .max(NOTE_MAX)
    .optional()
    .describe("Why: needed to decline. Left out, the idea's note stays."),
});

async function triageIdea(store: Store, p: z.infer<typeof TriageParams>) {
  const rows = readCanvases(await store.list());
  const idea = rows.find((c) => c.id === p.canvasId) ?? readCanvas(await store.get(p.canvasId));
  if (!idea) return { triaged: false as const, reason: "not_found" as const };
  if (idea.format !== "idea") {
    return {
      triaged: false as const,
      reason: "wrong_format" as const,
      message: "Only an idea in the inbox is triaged.",
    };
  }
  const now = nowIso();
  if (p.status === "merged") {
    if (!p.mergeInto) {
      return {
        triaged: false as const,
        reason: "needs_target" as const,
        message: "Say which idea it repeats (mergeInto).",
      };
    }
    const into = rows.find((c) => c.id === p.mergeInto);
    if (!into || into.format !== "idea") {
      return {
        triaged: false as const,
        reason: "not_found" as const,
        message: "There's no idea with that id to merge into.",
      };
    }
    if (isExampleId(into.id) !== isExampleId(idea.id)) {
      return {
        triaged: false as const,
        reason: "wrong_format" as const,
        message: "An example idea and one of the team's don't merge.",
      };
    }
    const m = mergeIdeas(idea, into, sameWorld(idea, rows), now);
    if (!m.ok) return { triaged: false as const, ...refused(m) };
    await store.put(m.root);
    await store.put(m.duplicate);
    return {
      triaged: true as const,
      status: "merged" as const,
      into: m.root.id,
      demand: m.root.intake?.demand ?? 1,
    };
  }
  if (idea.intake?.status === "merged") {
    // Out of its merge: the ideas it went into give its demand back.
    const u = unmergeIdea(idea, p.status, p.note, sameWorld(idea, rows), now);
    if (!u.ok) return { triaged: false as const, ...refused(u) };
    for (const c of u.carriers) await store.put(c);
    await store.put(u.duplicate);
    const root = u.carriers.at(-1);
    return { triaged: true as const, status: p.status, ...(root ? { outOf: root.id } : {}) };
  }
  const w = withIdeaStatus(idea, p.status, p.note, now);
  if (!w.ok) return { triaged: false as const, ...refused(w) };
  await store.put(w.canvas);
  return { triaged: true as const, status: p.status };
}

// ──────── tool.product_canvas.triage_idea ────────
registry.register({
  id: "tool.product_canvas.triage_idea",
  toolId: "tool.product_canvas",
  name: "triage_idea",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an idea's status in the inbox: assessing, accepted, declined (with a note saying why) or merged into the idea it repeats (mergeInto; its demand and who asked move to that idea's root). Any other status on a merged idea takes it out of its merge: the ideas it went into give its demand back (who asked stays listed there), and outOf names the root it left. It sets the status only and sends nothing: an accepted idea goes to the backlog or the Opportunity Tree from the page. Returns {triaged: true, status, into?, demand?, outOf?}, or {triaged: false, reason: 'not_found' | 'wrong_format' | 'needs_target' | 'needs_note' | 'merged' | 'self_merge' | 'too_long' | 'too_big', message}.",
  paramsSchema: TriageParams,
  handler: (params) => triageIdea(browserStore, params),
  mcpHandler: (params, ctx) => triageIdea(serverStore(ctx.userId), params),
});

const DecisionParams = z.object({
  canvasId: CanvasId.describe("The business case's id."),
  verdict: z
    .enum(PRODUCT_CASE_VERDICTS)
    .describe("'go', 'no-go', 'change' (change it and come back) or 'pending' (not decided yet)."),
  note: z
    .string()
    .trim()
    .max(NOTE_MAX)
    .nullable()
    .optional()
    .describe("Why, in the team's words; null or empty clears it, left out it stays."),
});

async function setDecision(store: Store, p: z.infer<typeof DecisionParams>) {
  const c = readCanvas(await store.get(p.canvasId));
  if (!c) return { decided: false as const, reason: "not_found" as const };
  const w = withDecision(c, p.verdict, p.note === undefined ? undefined : p.note || null, nowIso());
  if (!w.ok) return { decided: false as const, ...refused(w) };
  await store.put(w.canvas);
  return {
    decided: true as const,
    verdict: p.verdict,
    decidedAt: w.canvas.decision?.decidedAt ?? null,
  };
}

// ──────── tool.product_canvas.set_decision ────────
registry.register({
  id: "tool.product_canvas.set_decision",
  toolId: "tool.product_canvas",
  name: "set_decision",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record the verdict on a lean business case: go, no-go, change (change it and come back) or pending, with a note. The day it was decided is stamped when the verdict changes. A record in the Decision Log is made on the page. Returns {decided: true, verdict, decidedAt}, or {decided: false, reason: 'not_found' | 'wrong_format' | 'too_long' | 'too_big', message}.",
  paramsSchema: DecisionParams,
  handler: (params) => setDecision(browserStore, params),
  mcpHandler: (params, ctx) => setDecision(serverStore(ctx.userId), params),
});

const BetParams = z.object({
  canvasId: CanvasId.describe("The Shape Up pitch's id."),
  status: z
    .enum(PRODUCT_BET_STATUSES)
    .describe(
      "'table' (on the table, its cycle cleared), 'bet' (bet on a cycle), 'passed' (not this time), 'shipped' or 'cut'."
    ),
  cycle: z
    .number()
    .int()
    .min(1)
    .max(CYCLE_MAX)
    .optional()
    .describe("The cycle's number ('Cycle 4' is 4). A bet needs one; list_state lists the cycles."),
  start: z
    .string()
    .max(10)
    .optional()
    .describe(
      "The day the cycle starts (YYYY-MM-DD): needed for a new cycle, taken from a known one."
    ),
  weeks: z
    .number()
    .int()
    .min(1)
    .max(WEEKS_MAX)
    .optional()
    .describe("The cycle's weeks: taken from a known cycle, 6 for a new one unless given."),
});

async function setBet(store: Store, p: z.infer<typeof BetParams>) {
  const rows = readCanvases(await store.list());
  const pitch = rows.find((c) => c.id === p.canvasId) ?? readCanvas(await store.get(p.canvasId));
  if (!pitch) return { placed: false as const, reason: "not_found" as const };
  const w = placeBet(
    pitch,
    sameWorld(pitch, rows),
    {
      status: p.status,
      ...(p.cycle !== undefined ? { cycle: p.cycle } : {}),
      ...(p.start !== undefined ? { start: p.start } : {}),
      ...(p.weeks !== undefined ? { weeks: p.weeks } : {}),
    },
    nowIso()
  );
  if (!w.ok) return { placed: false as const, ...refused(w) };
  await store.put(w.canvas);
  const bet = w.canvas.bet;
  return {
    placed: true as const,
    status: bet?.status ?? ("table" as const),
    cycle: bet?.cycle ?? null,
    start: bet?.start ?? null,
    weeks: bet?.weeks ?? null,
    end: cycleEnd(bet?.start, bet?.weeks),
  };
}

// ──────── tool.product_canvas.place_bet ────────
registry.register({
  id: "tool.product_canvas.place_bet",
  toolId: "tool.product_canvas",
  name: "place_bet",
  category: "write",
  requiresConfirmation: false,
  description:
    "Place a Shape Up pitch on the betting table: on the table, bet on a cycle, not this time (passed), shipped or cut. A bet needs a cycle: a known cycle's start and weeks are taken when left out, and dates that disagree with it are refused (every bet in a cycle shares its dates); a new cycle needs its start day. Once a cycle ends, a pitch still bet on it is out of time: ship what's done, cut it, or put it back on the table to reshape it. Bets don't roll over. Returns {placed: true, status, cycle, start, weeks, end}, or {placed: false, reason: 'not_found' | 'wrong_format' | 'bad_bet' | 'too_big', message}.",
  paramsSchema: BetParams,
  handler: (params) => setBet(browserStore, params),
  mcpHandler: (params, ctx) => setBet(serverStore(ctx.userId), params),
});
