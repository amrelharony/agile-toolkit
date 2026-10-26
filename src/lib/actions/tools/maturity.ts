/**
 * Agile Maturity Assessment — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Score 8 Agile dimensions 1-5 in a draft, save it as a dated
 *           assessment; the latest saved one gives the team's level, a
 *           0-100% overall score and the improvement roadmap.
 *
 * Agent surface: tool.maturity.*
 * Backing CRUD : workspace.maturity_assessment.* (auto-generated). Singleton:
 *                one MaturityAssessment document (the draft scores, the
 *                target, the saved history) under MATURITY_ID.
 *
 *   1. list_state         — unassessed or the latest assessment (%, level),
 *                           the history, what changed, the roadmap, the draft.
 *   2. set_score          — score (or clear) one dimension in the draft.
 *   3. set_target_level   — the roadmap's target (2-5).
 *   4. save_assessment    — save the draft (plus any scores given) on a day.
 *   5. remove_assessment  — delete a saved assessment.
 *   6. send_roadmap_step  — a roadmap step as a retro action.
 *   7. reset              — no draft, no history, target 4.
 *
 * The maturity level has one owner: `Workspace.maturityLevel` is
 * maturityLevelOf(the doc) (lib/maturity/assessment), so every verb that
 * changes the saved history keeps it in step, in the browser store or the
 * user's scalar blob (null clears it: an unassessed team has no level).
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverGetEntity,
  serverListEntities,
  serverPatchWorkspaceBlob,
  serverUpsertEntity,
} from "../server-store";
import type { MaturityAssessment, MaturityLevel, RetroBoard } from "@/lib/stores/workspace-types";
import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";
import { todayLocalISO } from "@/lib/utils/formatters";
import { actionCard, quickAddBoard, withAddedAction } from "@/lib/retro/actions";
import { retroColumnFor } from "@/lib/handoffs/targets/retro-board";
import {
  MATURITY_ID,
  MATURITY_KIND,
  NOTE_MAX,
  assessedAtError,
  assessmentDeltas,
  averageOf,
  emptyMaturity,
  isLegacyDraft,
  latestAssessment,
  maturityLevelOf,
  maturityVerdict,
  missingDimensions,
  newAssessment,
  normalizeMaturity,
  previousAssessment,
  roadmapCards,
  roadmapFor,
  roadmapTitle,
  savedAssessments,
  scoredCount,
  summarizeEntry,
  targetOf,
  withAssessment,
  withoutAssessment,
} from "@/lib/maturity/assessment";

const KIND_RETRO = "workspace:retroBoard";
const KNOWN_DIM_IDS = new Set(MATURITY_DIMENSIONS.map((d) => d.id));

const ws = () => useWorkspaceStore.getState();

/** Where the assessment lives: the browser's workspace, or the user's rows on the server. */
interface MaturityStore {
  getDoc(): Promise<MaturityAssessment | null>;
  putDoc(doc: MaturityAssessment): Promise<void>;
  /** Write the team's level (undefined = unassessed). */
  setLevel(level: MaturityLevel | undefined): Promise<void>;
  retroBoards(): Promise<RetroBoard[]>;
  putRetroBoard(board: RetroBoard): Promise<void>;
}

const browserStore: MaturityStore = {
  getDoc: async () => (ws().maturityAssessments ?? []).find((d) => d.id === MATURITY_ID) ?? null,
  putDoc: async (doc) => ws().upsertMaturityAssessment(doc),
  setLevel: async (level) => ws().setMaturityLevel(level),
  retroBoards: async () => ws().retroBoards ?? [],
  putRetroBoard: async (board) => ws().upsertRetroBoard(board),
};

function serverStore(userId: string): MaturityStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<MaturityAssessment>(userId, MATURITY_KIND, MATURITY_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<MaturityAssessment>(userId, MATURITY_KIND, doc);
    },
    // The scalar blob drops an undefined key, so "unassessed" is sent as null.
    setLevel: async (level) => serverPatchWorkspaceBlob(userId, { maturityLevel: level ?? null }),
    retroBoards: async () => serverListEntities<RetroBoard>(userId, KIND_RETRO),
    putRetroBoard: async (board) => {
      await serverUpsertEntity<RetroBoard>(userId, KIND_RETRO, board);
    },
  };
}

/** Save the doc and, when its saved history changed the level, the level with it. */
async function commit(store: MaturityStore, doc: MaturityAssessment, levelToo: boolean) {
  await store.putDoc({ ...doc, id: MATURITY_ID });
  if (levelToo) await store.setLevel(maturityLevelOf(doc));
}

/* ── list_state ─────────────────────────────────────────────────────── */

function summarize(raw: MaturityAssessment | null, boards: readonly RetroBoard[]) {
  const doc = normalizeMaturity(raw);
  const latest = latestAssessment(doc);
  const summary = latest ? summarizeEntry(latest) : null;
  const target = targetOf(doc);
  const roadmap = roadmapFor(latest, target).map((step) => {
    const cards = roadmapCards(boards, step.key);
    return {
      ...step,
      // Kept for agents that read the old shape.
      nextLevel: { level: step.toLevel, label: step.toLabel, description: step.description },
      sent: cards.length > 0,
      retroCards: cards,
    };
  });
  return {
    exists: raw !== null,
    assessed: latest !== null,
    draft: {
      scores: doc.scores,
      scored: scoredCount(doc.scores),
      missing: missingDimensions(doc.scores),
      legacy: isLegacyDraft(raw),
    },
    latest: summary,
    assessments: savedAssessments(doc).map(summarizeEntry),
    deltas: assessmentDeltas(previousAssessment(doc), latest),
    // The old flat fields, now from the latest saved assessment (null when unassessed).
    scores: doc.scores,
    targetLevel: target,
    averageLevel: summary?.averageLevel ?? null,
    percentage: summary?.percentage ?? null,
    level: summary?.level ?? null,
    label: summary?.label ?? null,
    roadmap,
    verdict: maturityVerdict(doc),
  };
}

async function listState(store: MaturityStore) {
  return summarize(await store.getDoc(), await store.retroBoards());
}

registry.register({
  id: "tool.maturity.list_state",
  toolId: "tool.maturity",
  name: "list_state",
  category: "read",
  description:
    "Summarise the agile maturity assessment, as the page does. A team is unassessed until it saves an assessment (every dimension scored, dated); the latest saved one gives the level and the roadmap. Returns {exists, assessed, draft: {scores (dimensionId -> 1-5; missing = not scored), scored, missing: {id, name}[], legacy (scores from before dated assessments, not counted)}, latest: null | {id, assessedAt, averageLevel, percentage (0-100: all 1s = 0, all 5s = 100), level, label, tone, note}, assessments (oldest first, same shape), deltas: {dimensionId, name, from, to}[] (latest vs the one before), scores (the draft), targetLevel, averageLevel, percentage, level, label (the latest's, null when unassessed), roadmap: {key, dimensionId, name, current, toLevel, toLabel, description, target, nextLevel: {level, label, description}, sent, retroCards: {id, boardId, done}[]}[] (dimensions below the target, weakest first, from the latest saved assessment), verdict}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── set_score / set_target_level ───────────────────────────────────── */

const DIMENSION_LIST =
  "scrum-practices, team-collaboration, technical-excellence, product-management, metrics-transparency, continuous-improvement, stakeholder-engagement, agile-culture";

const ScoreParams = z.object({
  dimensionId: z.string().describe(`One of: ${DIMENSION_LIST}.`),
  level: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .describe("1-5, or null to clear it to Not scored."),
});

async function setScore(store: MaturityStore, p: z.infer<typeof ScoreParams>) {
  if (!KNOWN_DIM_IDS.has(p.dimensionId)) return { set: false };
  const doc = normalizeMaturity(await store.getDoc());
  const scores = { ...doc.scores };
  if (p.level === null) delete scores[p.dimensionId];
  else scores[p.dimensionId] = p.level;
  await commit(store, { ...doc, scores }, false);
  return { set: true, scored: scoredCount(scores) };
}

registry.register({
  id: "tool.maturity.set_score",
  toolId: "tool.maturity",
  name: "set_score",
  category: "write",
  requiresConfirmation: false,
  description: `Score one dimension (1-5) in the draft, or clear it with null. The draft counts only once saved (save_assessment). dimensionId is one of: ${DIMENSION_LIST}. Creates the assessment if absent. Returns {set: false} for an unknown dimensionId, else {set: true, scored} (dimensions scored in the draft).`,
  paramsSchema: ScoreParams,
  handler: async (params) => setScore(browserStore, params),
  mcpHandler: async (params, ctx) => setScore(serverStore(ctx.userId), params),
});

const TargetParams = z.object({ level: z.number().int().min(2).max(5) });

async function setTarget(store: MaturityStore, p: z.infer<typeof TargetParams>) {
  const doc = normalizeMaturity(await store.getDoc());
  await commit(store, { ...doc, targetLevel: p.level }, false);
  return { set: true, targetLevel: p.level };
}

registry.register({
  id: "tool.maturity.set_target_level",
  toolId: "tool.maturity",
  name: "set_target_level",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the improvement target level (2-5). Dimensions of the latest saved assessment below it appear on the roadmap. Returns {set: true, targetLevel}.",
  paramsSchema: TargetParams,
  handler: async (params) => setTarget(browserStore, params),
  mcpHandler: async (params, ctx) => setTarget(serverStore(ctx.userId), params),
});

/* ── save_assessment / remove_assessment ────────────────────────────── */

const SaveParams = z.object({
  scores: z
    .record(z.string(), z.number().int().min(1).max(5))
    .optional()
    .describe("dimensionId -> 1-5, laid over the draft. Every dimension must end up scored."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("YYYY-MM-DD it was taken; defaults to today, never after it."),
  targetLevel: z
    .number()
    .int()
    .min(2)
    .max(5)
    .optional()
    .describe("Also sets the roadmap's target."),
  note: z.string().max(NOTE_MAX).optional(),
});

async function saveAssessment(store: MaturityStore, p: z.infer<typeof SaveParams>) {
  const unknown = Object.keys(p.scores ?? {}).filter((id) => !KNOWN_DIM_IDS.has(id));
  if (unknown.length > 0) return { saved: false, reason: "unknown_dimension", unknown };
  const today = todayLocalISO();
  const day = p.date ?? today;
  const dateError = assessedAtError(day, today);
  if (dateError) return { saved: false, reason: "invalid_date", message: dateError };
  const doc = normalizeMaturity(await store.getDoc());
  const scores = { ...doc.scores, ...(p.scores ?? {}) };
  if (averageOf(scores) === null) {
    return { saved: false, reason: "incomplete", missing: missingDimensions(scores) };
  }
  const targetLevel = p.targetLevel ?? targetOf(doc);
  const entry = newAssessment(
    { scores, assessedAt: day, targetLevel, note: p.note },
    `maturity_${crypto.randomUUID()}`
  );
  const next = { ...withAssessment(doc, entry), targetLevel };
  await commit(store, next, true);
  return { saved: true, ...summarizeEntry(entry), maturityLevel: maturityLevelOf(next) ?? null };
}

registry.register({
  id: "tool.maturity.save_assessment",
  toolId: "tool.maturity",
  name: "save_assessment",
  category: "write",
  requiresConfirmation: false,
  description:
    "Save the draft as a dated assessment: the draft's scores with any `scores` given laid over them. Refuses an incomplete set (every one of the 8 dimensions needs a score), an unknown dimension, and a day in the future (backdating is fine). Clears the draft for the next assessment and sets the team's maturity level from the latest saved assessment. Returns {saved: false, reason: 'incomplete' (with missing: {id, name}[]) | 'unknown_dimension' | 'invalid_date', …} or {saved: true, id, assessedAt, averageLevel, percentage, level, label, tone, note, maturityLevel}.",
  paramsSchema: SaveParams,
  handler: async (params) => saveAssessment(browserStore, params),
  mcpHandler: async (params, ctx) => saveAssessment(serverStore(ctx.userId), params),
});

const IdParams = z.object({ id: z.string() });

async function removeAssessment(store: MaturityStore, { id }: z.infer<typeof IdParams>) {
  const out = withoutAssessment(normalizeMaturity(await store.getDoc()), id);
  if (!out) return { removed: false };
  await commit(store, out.doc, true);
  return { removed: true, maturityLevel: maturityLevelOf(out.doc) ?? null };
}

registry.register({
  id: "tool.maturity.remove_assessment",
  toolId: "tool.maturity",
  name: "remove_assessment",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete a saved assessment by id. The team's maturity level follows the latest one left (none left: unassessed, level null). Returns {removed: false} for an unknown id, else {removed: true, maturityLevel}.",
  paramsSchema: IdParams,
  handler: async (params) => removeAssessment(browserStore, params),
  mcpHandler: async (params, ctx) => removeAssessment(serverStore(ctx.userId), params),
});

/* ── send_roadmap_step ──────────────────────────────────────────────── */

const SendParams = z.object({
  key: z.string().describe("A roadmap step's key from list_state (dimensionId:toLevel)."),
  owner: z.string().trim().max(60).optional().describe("Who will act on it."),
});

async function sendStep(store: MaturityStore, p: z.infer<typeof SendParams>) {
  const doc = normalizeMaturity(await store.getDoc());
  const step = roadmapFor(latestAssessment(doc), targetOf(doc)).find((s) => s.key === p.key);
  if (!step) return { sent: false, reason: "not_on_roadmap" };
  const boards = await store.retroBoards();
  const already = roadmapCards(boards, step.key)[0];
  if (already) return { sent: false, reason: "already_sent", cardId: already.id };
  const board = quickAddBoard(boards);
  if (!board) return { sent: false, reason: "no_retro" };
  // As the page's "Send to… Retro action" files it: a concern's column.
  const card = {
    ...actionCard({ text: roadmapTitle(step), assignee: p.owner }, retroColumnFor(board.format)),
    sourceRef: { tool: "maturity", id: step.key, doc: MATURITY_ID },
  };
  await store.putRetroBoard(withAddedAction(board, card));
  return { sent: true, cardId: card.id, boardId: board.id };
}

registry.register({
  id: "tool.maturity.send_roadmap_step",
  toolId: "tool.maturity",
  name: "send_roadmap_step",
  category: "write",
  requiresConfirmation: false,
  description:
    "Send a roadmap step to Retro Actions: an action item 'Maturity: <dimension> to level <n>' on the current retro (else the newest archived one), linked back to the step, so list_state shows it as sent. Returns {sent: false, reason: 'not_on_roadmap' | 'already_sent' (with cardId) | 'no_retro'} or {sent: true, cardId, boardId}.",
  paramsSchema: SendParams,
  handler: async (params) => sendStep(browserStore, params),
  mcpHandler: async (params, ctx) => sendStep(serverStore(ctx.userId), params),
});

/* ── reset ──────────────────────────────────────────────────────────── */

async function reset(store: MaturityStore) {
  await commit(store, emptyMaturity(), true);
  return { reset: true };
}

registry.register({
  id: "tool.maturity.reset",
  toolId: "tool.maturity",
  name: "reset",
  category: "write",
  requiresConfirmation: true,
  description:
    "Clear the assessment: the draft, every saved assessment, and the target back to 4. The team becomes unassessed (maturity level cleared). Returns {reset: true}.",
  paramsSchema: z.object({}),
  handler: async () => reset(browserStore),
  mcpHandler: async (_params, ctx) => reset(serverStore(ctx.userId)),
});
