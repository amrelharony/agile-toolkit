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
 *                      with how far along it is and its gaps; with `id`,
 *                      one canvas in full, with what its format works out
 *                      (the pitch, the fit meter, the hypotheses, the press
 *                      release's words and the hard questions).
 *   2. create_canvas — a new canvas in a format, optionally started from
 *                      the Product Goal (the draft with no AI).
 *   3. add_items     — lines added to a list box.
 *   4. update_item   — one line's words, answer, fact-or-guess mark or links.
 *   5. set_field     — a one-line or paragraph box set or cleared.
 *
 * Every write goes through lib/product-canvas/model, so the caps and
 * refusals are the page's. The page logs history and does every send;
 * nothing here reaches other people: every verb is the visitor's own data.
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
  PRODUCT_CANVAS_EVIDENCE,
  PRODUCT_CANVAS_KIND,
  PRODUCT_GOAL_KIND,
  TOOL_LIST_MAX,
  type Hypothesis,
  type HypothesisTracker,
  type ProductCanvas,
  type ProductCanvasFormat,
  type ProductGoal,
  type Story,
} from "@/lib/stores/workspace-types";
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
  pitchOf,
  pitchSentence,
  readCanvas,
  readCanvases,
  releaseWords,
  validateLaunchDate,
  withDraftLines,
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

/** One canvas, as list_state lists it. */
function summary(
  c: ProductCanvas,
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
    gaps: canvasGaps(c, { goal, hypotheses, today: todayIso() }).length,
    productGoalId: c.productGoalId ?? null,
    updatedAt: c.updatedAt,
  };
}

/** One canvas in full, with what its format works out. */
function detail(
  c: ProductCanvas,
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
    linksTo: def.linksTo ?? [],
    lines: itemsOf(c, def.id).map((i) => ({
      id: i.id,
      text: i.text,
      ...(i.evidence ? { evidence: i.evidence } : {}),
      ...(i.detail ? { answer: i.detail } : {}),
      ...(i.links ? { links: i.links } : {}),
      ...(i.promptId ? { hardQuestion: i.promptId } : {}),
      test: linkedTest(i.sentTo, hypotheses).state,
    })),
  }));
  const out: Record<string, unknown> = {
    ...summary(c, hypotheses, goal),
    boxes,
    gapList: canvasGaps(c, { goal, hypotheses, today: todayIso() }).map((g) => ({
      box: g.sectionId ?? null,
      text: g.text,
    })),
  };
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
  const canvases = readCanvases(rows).filter((c) => !p.format || c.format === p.format);
  const base = {
    goal: goal ? { id: goal.id, statement: goal.statement } : null,
    vision,
    formats: BUILT_FORMATS.map((id) => ({ id, name: PRODUCT_FORMATS[id]?.name ?? id })),
    total: canvases.filter((c) => !isExampleId(c.id)).length,
  };
  if (p.id) {
    const c = canvases.find((x) => x.id === p.id) ?? readCanvas(await store.get(p.id));
    if (!c) return { ...base, found: false as const };
    return { ...base, found: true as const, canvas: detail(c, hypotheses, goal) };
  }
  return { ...base, canvases: canvases.map((c) => summary(c, hypotheses, goal)) };
}

// ──────── tool.product_canvas.list_state ────────
registry.register({
  id: "tool.product_canvas.list_state",
  toolId: "tool.product_canvas",
  name: "list_state",
  category: "read",
  description:
    "Read Product Canvas: a product idea on one page, as a vision with its pitch, a Value Proposition, a Lean UX canvas or a PR/FAQ. Returns {goal: {id, statement} | null (the active Product Goal), vision (the Product Goal page's vision, '' when none), formats: {id, name}[], total (canvases, examples left out)} and, without `id`, canvases: {id, example, format, formatName, title, boxes: {filled, total}, lines, gaps (how many), productGoalId | null, updatedAt}[] newest first. With `id`: {found, canvas} where canvas adds boxes: {id, label, kind ('list' | 'single' | 'long'), max, required, marksFacts, asksQuestions, linksTo, lines: {id, text, evidence?, answer?, links?, hardQuestion?, test ('none' | 'testing' | 'tested')}[]}[], gapList: {box | null, text}[], and per format: pitch (a vision), fit (a Value Proposition: pains eased, gains added, idle offer lines, confirmed), hypotheses (Lean UX, each with its picks, learn-first and smallest test), release {words, headline} and hardQuestions {id, text, asked, answered}[] (PR/FAQ). Create, rename or delete a canvas with workspace.product_canvas.*; sends to the Hypothesis Tracker are made on the page.",
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
    "Change one line on a product canvas: its words, a question's answer, its fact-or-guess mark, or the lines it links to (checked against the boxes it may link to). Fields left out stay. New words go only on a list box's line: a one-line or paragraph box (the launch date among them) is set with set_field, and its words here are refused as 'not_a_list'. Returns {updated: true}, or {updated: false, reason: 'not_found' | 'not_a_list' | 'blank' | 'too_long' | 'bad_field' | 'too_big', message}.",
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
    "Set or clear a one-line or paragraph box on a product canvas (the vision, a pitch part, the customer group, the business problem, a press release part, the launch date). Returns {set: true, cleared}, or {set: false, reason: 'not_found' | 'unknown_section' | 'not_an_answer' | 'too_long' | 'bad_date' | 'canvas_full' | 'too_big', message}.",
  paramsSchema: SetFieldParams,
  handler: (params) => setField(browserStore, params),
  mcpHandler: (params, ctx) => setField(serverStore(ctx.userId), params),
});
