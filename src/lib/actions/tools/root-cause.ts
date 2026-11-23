/**
 * Root Cause — tool-local actions.
 *
 * Category: Root Cause Analysis (tools plan, phase 1)
 *
 * Agent surface: tool.root_cause.*
 * Backing CRUD : workspace.root_cause_analysis.* (create, list, update,
 *                delete): one RootCauseAnalysis per problem, under its own
 *                id ("rca_…"), kind ROOT_CAUSE_ANALYSIS_KIND.
 *
 *   1. list_state  — every analysis with where it stands (a root cause
 *                    named, a countermeasure agreed, sent to Retro
 *                    Actions: an action deleted there doesn't count), its
 *                    whys, its Pareto order and the page's one-line
 *                    verdict. Example analyses are listed and marked, but
 *                    left out of the totals and the verdict, as the page
 *                    does.
 *   2. add_why     — the next answer in an analysis's 5 Whys chain.
 *   3. add_cause   — a cause on its fishbone, under a category, with how
 *                    often it happened.
 *   4. set_outcome — the root cause and/or the countermeasure (null clears).
 *   5. add_loop_node — a thing that goes up or down on its causal loop.
 *   6. add_loop_link — an arrow between two of its things, + (same way) or
 *                    − (opposite ways), optionally taking time; says which
 *                    loops it closes.
 *
 * Every write goes through lib/root-cause/model, so the caps are the page's
 * and the CRUD's, and stamps updatedAt as the page does. Nothing here
 * reaches other people: every verb is the visitor's own data.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  LOOP_POLARITIES,
  LOOP_TEXT_MAX,
  ROOT_CAUSE_ANALYSIS_KIND,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type RetroBoard,
  type RootCauseAnalysis,
  type RootCauseLoop,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  CATEGORY_MAX,
  CAUSE_COUNT_MAX,
  STAGE_LABEL,
  analysisStage,
  cleanText,
  newestFirst,
  paretoRows,
  readAnalysis,
  liveOnBoards,
  rootCauseVerdict,
  sentLink,
  touched,
  withCause,
  withWhy,
  type LinkIsLive,
} from "@/lib/root-cause/model";
import {
  busiestNode,
  describeLoop,
  findLoops,
  loopName,
  loopPath,
  loopsUsing,
  withLoopLink,
  withLoopNode,
} from "@/lib/root-cause/loops";

const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();

/** Where the verbs read and write: the browser's store, or the user's rows on the server. */
interface Store {
  list: () => Promise<RootCauseAnalysis[]>;
  get: (id: string) => Promise<RootCauseAnalysis | null>;
  put: (a: RootCauseAnalysis) => Promise<void>;
}

const browserStore: Store = {
  list: async () => ws().rootCauseAnalyses ?? [],
  get: async (id) => (ws().rootCauseAnalyses ?? []).find((a) => a.id === id) ?? null,
  put: async (a) => ws().upsertRootCauseAnalysis(a),
};

const serverStore = (userId: string): Store => ({
  list: () => serverListEntities<RootCauseAnalysis>(userId, ROOT_CAUSE_ANALYSIS_KIND),
  get: (id) => serverGetEntity<RootCauseAnalysis>(userId, ROOT_CAUSE_ANALYSIS_KIND, id),
  put: async (a) => {
    await serverUpsertEntity<RootCauseAnalysis>(userId, ROOT_CAUSE_ANALYSIS_KIND, a);
  },
});

/** The retro boards, where a sent countermeasure's action lives (as tool.retro_actions reads them). */
const KIND_RETRO = "workspace:retroBoard";

/** An analysis's causal loop as list_state reports it; null with nothing on it. */
function loopSummary(loop: RootCauseLoop | undefined) {
  if (!loop || loop.nodes.length === 0) return null;
  const found = findLoops(loop);
  const busiest = busiestNode(loop, found);
  return {
    nodes: loop.nodes.map((n) => ({ id: n.id, text: n.text })),
    links: loop.links.map((l) => ({
      id: l.id,
      from: l.from,
      to: l.to,
      polarity: l.polarity,
      delay: l.delay === true,
    })),
    loops: found.loops.map((l) => ({
      key: l.key,
      label: l.label,
      kind: l.kind,
      name: loopName(loop, l.key),
      path: loopPath(loop, l),
      sentence: describeLoop(loop, l),
    })),
    truncated: found.truncated,
    busiest: busiest ? { id: busiest.id, text: busiest.text } : null,
  };
}

function summarize(rows: readonly RootCauseAnalysis[], isLive: LinkIsLive) {
  const analyses = newestFirst(
    rows.flatMap((r) => {
      const a = readAnalysis(r);
      return a ? [a] : [];
    })
  );
  // The example is listed (marked) but, as on the page, not counted.
  const real = analyses.filter((a) => !isExampleId(a.id));
  const byStage = { started: 0, "root-cause": 0, countermeasure: 0, sent: 0 };
  for (const a of real) byStage[analysisStage(a, isLive)]++;
  return {
    total: real.length,
    byStage,
    verdict: rootCauseVerdict(real, isLive),
    analyses: analyses.map((a) => ({
      id: a.id,
      example: isExampleId(a.id),
      title: a.title,
      problem: a.problem,
      method: a.method,
      stage: analysisStage(a, isLive),
      stageLabel: STAGE_LABEL[analysisStage(a, isLive)],
      whys: a.whys.map((w) => ({ id: w.id, text: w.text })),
      causeCount: a.causes.length,
      pareto: paretoRows(a.causes)
        .slice(0, 10)
        .map((r) => ({
          id: r.id,
          text: r.text,
          category: r.category,
          count: r.count,
          cumulativePct: Math.round(r.cumulative * 100),
          vital: r.vital,
        })),
      rootCause: a.rootCause ?? null,
      countermeasure: a.countermeasure ?? null,
      postMortemId: a.postMortemId ?? null,
      retroBoardId: a.retroBoardId ?? null,
      sourceRef: a.sourceRef ?? null,
      sentToRetroActions: sentLink(a, isLive) !== undefined,
      loop: loopSummary(a.loop),
      updatedAt: a.updatedAt,
    })),
  };
}

// ──────── tool.root_cause.list_state ────────
registry.register({
  id: "tool.root_cause.list_state",
  toolId: "tool.root_cause",
  name: "list_state",
  category: "read",
  description:
    "Summarise the root-cause analyses, newest change first. Returns {total, byStage:{started,'root-cause',countermeasure,sent}, verdict (the page's one line) (total, byStage and verdict leave example analyses out), analyses:{id, example (true for an example analysis from Load example), title, problem, method ('five-whys'|'fishbone'|'causal-loop') (the view it started in; every analysis keeps all three), stage, stageLabel, whys:{id,text}[] (in order; the first answers why the problem happened), causeCount, pareto:{id,text,category,count,cumulativePct,vital}[] (fishbone causes by count, top 10; vital = among the few behind 80%), rootCause|null, countermeasure|null, postMortemId|null, retroBoardId|null, sourceRef|null, sentToRetroActions, loop: null (nothing on its causal loop) | {nodes:{id,text}[], links:{id,from,to,polarity:'same'|'opposite',delay}[], loops:{key, label (R1… reinforcing, B1… balancing; shortest first), kind:'reinforcing'|'balancing', name|null, path (its things in order, back to the first), sentence}[] (the 20 shortest), truncated (true: there may be more loops than listed), busiest:{id,text}|null (the thing in the most loops, from two loops: where acting may change the most)}, updatedAt}[]}. Create, edit or delete an analysis with workspace.root_cause_analysis.*.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.list(), liveOnBoards(ws().retroBoards)),
  mcpHandler: async (_params, ctx) => {
    const [rows, boards] = await Promise.all([
      serverStore(ctx.userId).list(),
      serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO),
    ]);
    return summarize(rows, liveOnBoards(boards));
  },
});

const AddWhyParams = z.object({
  analysisId: z.string().min(1).describe("The analysis's id (see list_state)."),
  text: z
    .string()
    .trim()
    .min(1)
    .max(TOOL_TEXT_MAX.text)
    .describe("Why the last answer (or the problem, for the first) happened, as one fact."),
});

async function addWhy(store: Store, params: z.infer<typeof AddWhyParams>) {
  const raw = await store.get(params.analysisId);
  const a = raw ? readAnalysis(raw) : null;
  if (!a) return { added: false as const, reason: "not_found" as const };
  const whyId = nanoid(8);
  const next = withWhy(a, params.text, whyId, nowIso());
  if (!next) return { added: false as const, reason: "chain_full" as const };
  await store.put(next);
  return { added: true as const, whyId, count: next.whys.length };
}

// ──────── tool.root_cause.add_why ────────
registry.register({
  id: "tool.root_cause.add_why",
  toolId: "tool.root_cause",
  name: "add_why",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add the next answer to an analysis's 5 Whys chain (at the end). Blameless: name a process, check or condition, not a person. Returns {added: true, whyId, count}, or {added: false, reason: 'not_found' | 'chain_full'} (20 whys at most).",
  paramsSchema: AddWhyParams,
  handler: (params) => addWhy(browserStore, params),
  mcpHandler: (params, ctx) => addWhy(serverStore(ctx.userId), params),
});

const AddCauseParams = z.object({
  analysisId: z.string().min(1).describe("The analysis's id (see list_state)."),
  category: z
    .string()
    .trim()
    .min(1)
    .max(CATEGORY_MAX)
    .describe("People, Process, Tools, Environment, Measurement, Other, or the team's own."),
  text: z.string().trim().min(1).max(TOOL_TEXT_MAX.text).describe("The cause, as a fact."),
  count: z
    .number()
    .int()
    .min(0)
    .max(CAUSE_COUNT_MAX)
    .optional()
    .describe("How often it happened (default 1); the Pareto chart orders causes by it."),
});

async function addCause(store: Store, params: z.infer<typeof AddCauseParams>) {
  const raw = await store.get(params.analysisId);
  const a = raw ? readAnalysis(raw) : null;
  if (!a) return { added: false as const, reason: "not_found" as const };
  const causeId = nanoid(8);
  const next = withCause(
    a,
    { category: params.category, text: params.text, count: params.count ?? 1 },
    causeId,
    nowIso()
  );
  if (!next) return { added: false as const, reason: "fishbone_full" as const };
  await store.put(next);
  return { added: true as const, causeId, count: next.causes.length };
}

// ──────── tool.root_cause.add_cause ────────
registry.register({
  id: "tool.root_cause.add_cause",
  toolId: "tool.root_cause",
  name: "add_cause",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a cause to an analysis's fishbone under a category, with how often it happened. Returns {added: true, causeId, count}, or {added: false, reason: 'not_found' | 'fishbone_full'} (100 causes at most).",
  paramsSchema: AddCauseParams,
  handler: (params) => addCause(browserStore, params),
  mcpHandler: (params, ctx) => addCause(serverStore(ctx.userId), params),
});

const OutcomeParams = z.object({
  analysisId: z.string().min(1).describe("The analysis's id (see list_state)."),
  rootCause: z
    .string()
    .trim()
    .max(TOOL_TEXT_MAX.text)
    .nullable()
    .optional()
    .describe("The root cause the team settled on; null or empty clears it."),
  countermeasure: z
    .string()
    .trim()
    .max(TOOL_TEXT_MAX.text)
    .nullable()
    .optional()
    .describe("What the team will change, ideally with a check line; null or empty clears it."),
});

async function setOutcome(store: Store, params: z.infer<typeof OutcomeParams>) {
  const raw = await store.get(params.analysisId);
  const a = raw ? readAnalysis(raw) : null;
  if (!a) return { updated: false as const, reason: "not_found" as const };
  const next = touched(a, {}, nowIso());
  for (const field of ["rootCause", "countermeasure"] as const) {
    const value = params[field];
    if (value === undefined) continue;
    const clean = cleanText(value ?? "", TOOL_TEXT_MAX.text);
    if (clean) next[field] = clean;
    else delete next[field];
  }
  await store.put(next);
  return { updated: true as const, stage: analysisStage(next) };
}

// ──────── tool.root_cause.set_outcome ────────
registry.register({
  id: "tool.root_cause.set_outcome",
  toolId: "tool.root_cause",
  name: "set_outcome",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an analysis's root cause and/or countermeasure (fields left out stay; null or empty clears). Sending the countermeasure to Retro Actions is done on the page. Returns {updated: true, stage}, or {updated: false, reason: 'not_found'}.",
  paramsSchema: OutcomeParams,
  handler: (params) => setOutcome(browserStore, params),
  mcpHandler: (params, ctx) => setOutcome(serverStore(ctx.userId), params),
});

const AddLoopNodeParams = z.object({
  analysisId: z.string().min(1).describe("The analysis's id (see list_state)."),
  text: z
    .string()
    .trim()
    .min(1)
    .max(LOOP_TEXT_MAX.node)
    .describe(
      "A thing that goes up or down, as a noun phrase: 'Support tickets', 'Time spent firefighting'."
    ),
});

async function addLoopNode(store: Store, params: z.infer<typeof AddLoopNodeParams>) {
  const raw = await store.get(params.analysisId);
  const a = raw ? readAnalysis(raw) : null;
  if (!a) return { added: false as const, reason: "not_found" as const };
  const nodeId = nanoid(8);
  const next = withLoopNode(a, params.text, nodeId, nowIso());
  if (!next.ok) return { added: false as const, reason: next.reason };
  await store.put(next.analysis);
  return { added: true as const, nodeId, count: next.analysis.loop?.nodes.length ?? 0 };
}

// ──────── tool.root_cause.add_loop_node ────────
registry.register({
  id: "tool.root_cause.add_loop_node",
  toolId: "tool.root_cause",
  name: "add_loop_node",
  category: "write",
  requiresConfirmation: false,
  description: `Add a thing that goes up or down to an analysis's causal loop (at the end of its list). Returns {added: true, nodeId, count}, or {added: false, reason: 'not_found' | 'loop_full' (${TOOL_LIST_MAX.loopNodes} things at most) | 'duplicate' (a thing with the same words, in any case, is on it already) | 'too_big' (the analysis can't grow)}.`,
  paramsSchema: AddLoopNodeParams,
  handler: (params) => addLoopNode(browserStore, params),
  mcpHandler: (params, ctx) => addLoopNode(serverStore(ctx.userId), params),
});

const AddLoopLinkParams = z.object({
  analysisId: z.string().min(1).describe("The analysis's id (see list_state)."),
  from: z.string().min(1).max(64).describe("The cause: a node id on its loop (see list_state)."),
  to: z.string().min(1).max(64).describe("What it changes: another node id on its loop."),
  polarity: z
    .enum(LOOP_POLARITIES)
    .describe(
      "same (+): more of 'from' brings more of 'to'; opposite (−): more of 'from' brings less of 'to'."
    ),
  delay: z.boolean().optional().describe("True when the effect takes noticeable time."),
});

async function addLoopLink(store: Store, params: z.infer<typeof AddLoopLinkParams>) {
  const raw = await store.get(params.analysisId);
  const a = raw ? readAnalysis(raw) : null;
  if (!a) return { added: false as const, reason: "not_found" as const };
  const linkId = nanoid(8);
  const next = withLoopLink(
    a,
    {
      from: params.from,
      to: params.to,
      polarity: params.polarity,
      ...(params.delay ? { delay: true } : {}),
    },
    linkId,
    nowIso()
  );
  if (!next.ok) return { added: false as const, reason: next.reason };
  await store.put(next.analysis);
  const loop = next.analysis.loop!;
  const closed = loopsUsing(findLoops(loop), linkId);
  return {
    added: true as const,
    linkId,
    loops: closed.map((l) => ({ label: l.label, kind: l.kind, path: loopPath(loop, l) })),
  };
}

// ──────── tool.root_cause.add_loop_link ────────
registry.register({
  id: "tool.root_cause.add_loop_link",
  toolId: "tool.root_cause",
  name: "add_loop_link",
  category: "write",
  requiresConfirmation: false,
  description: `Add an arrow from one thing to another on an analysis's causal loop. Returns {added: true, linkId, loops: {label, kind: 'reinforcing'|'balancing', path}[] (the loops this arrow closes; labels as list_state numbers them)}, or {added: false, reason: 'not_found' | 'unknown_node' (from or to isn't on the loop) | 'self_link' | 'duplicate' (that from→to is drawn already; flip a sign on the page) | 'links_full' (${TOOL_LIST_MAX.loopLinks} arrows at most) | 'too_big'}.`,
  paramsSchema: AddLoopLinkParams,
  handler: (params) => addLoopLink(browserStore, params),
  mcpHandler: (params, ctx) => addLoopLink(serverStore(ctx.userId), params),
});
