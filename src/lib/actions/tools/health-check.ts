/**
 * Squad Health Check — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Spotify-model health check — eight built-in dimensions plus the
 *           team's own, each rated green / yellow / red (by hand, or from a
 *           vote round's counts), a note per dimension, the check in
 *           progress ("current") and the saved checks. The trend of a
 *           dimension is derived from the previous saved check, never typed.
 *
 * Agent surface: tool.health_check.*
 * Backing CRUD : workspace.health_check.* (auto-generated). Singleton: one
 *                HealthCheck document ({current, history[], customDimensions})
 *                under HEALTH_CHECK_ID.
 *
 *   1. list_state        — the draft (rated lights only), its health, the
 *                          dimensions, and the saved checks with their health.
 *   2. set_sprint_name   — name the check (teams without shared sprints).
 *   3. set_sprint        — the shared sprint the check is for.
 *   4. set_dimension     — a dimension's light, note and/or vote counts.
 *   5. save_check        — save the draft (refused while one is unrated).
 *   6. remove_check      — remove one saved check.
 *   7. add_dimension     — a dimension of the team's own.
 *   8. archive_dimension — hide a custom dimension from new checks.
 *   9. reset             — clear the draft and every saved check.
 *
 * Every number comes from lib/health-check/score, as on the page: yellow
 * counts half, and only rated dimensions count, so a blank draft reads null
 * rather than the placeholder greens' 100%. Entity kind
 * "workspace:healthCheck" and HEALTH_CHECK_ID match the page, so MCP writes
 * round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { HealthCheck, HealthCheckEntry, Sprint } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  DIMENSION_DESCRIPTION_MAX,
  DIMENSION_NAME_MAX,
  HEALTH_CHECK_ID,
  HEALTH_NOTE_MAX,
  activeDimensions,
  allDimensions,
  checkLabel,
  checksByDate,
  dimensionNameProblem,
  draftLight,
  draftShare,
  emptyHealthCheck,
  entryShare,
  findDimension,
  isSplit,
  lightFromVotes,
  normalizeHealthCheck,
  previousSavedCheck,
  redDimensions,
  saveDraft,
  scoreOf,
  sharePct,
  storedLight,
  trendFor,
  trendsFor,
  unratedDimensions,
  votesTotal,
  withCustomDimension,
  withDimensionPatch,
  withNote,
  withRating,
  withSprint,
  withSprintName,
  withVotes,
  withoutCheck,
} from "@/lib/health-check/score";

const KIND_HC = "workspace:healthCheck";
const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

/** Where the document lives: the browser's workspace, or the user's rows on the server. */
interface HealthCheckStore {
  getDoc(): Promise<HealthCheck | null>;
  putDoc(doc: HealthCheck): Promise<void>;
  listSprints(): Promise<Sprint[]>;
}

const browserStore: HealthCheckStore = {
  getDoc: async () => (ws().healthChecks ?? []).find((d) => d.id === HEALTH_CHECK_ID) ?? null,
  putDoc: async (doc) => ws().upsertHealthCheck(doc),
  listSprints: async () => ws().sprints ?? [],
};

function serverStore(userId: string): HealthCheckStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<HealthCheck>(userId, KIND_HC, HEALTH_CHECK_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<HealthCheck>(userId, KIND_HC, doc);
    },
    listSprints: () => serverListEntities<Sprint>(userId, KIND_SPRINT),
  };
}

/** The stored doc, normalised; a fresh one when there is none. */
async function load(store: HealthCheckStore): Promise<HealthCheck> {
  return normalizeHealthCheck(await store.getDoc());
}

/* ── list_state ─────────────────────────────────────────────────────── */

function entryRow(doc: HealthCheck, e: HealthCheckEntry) {
  const keys = allDimensions(doc).map((d) => d.key);
  const prev = previousSavedCheck(doc, { date: e.date, id: e.id }, { includeExamples: true });
  const reds = redDimensions(e, doc);
  return {
    id: e.id,
    label: checkLabel(e),
    sprintName: e.sprintName,
    sprintId: e.sprintId ?? null,
    date: e.date,
    scores: e.scores,
    customScores: e.customScores ?? {},
    health: sharePct(entryShare(e)),
    trends: trendsFor(
      e,
      prev,
      keys.filter((k) => storedLight(e, k) !== null)
    ),
    source: e.source ?? null,
    responses: e.responses ?? null,
    reds: reds.map((d) => ({
      key: d.key,
      name: d.name,
      sent: (scoreOf(e, d.key)?.sentTo ?? []).length > 0,
    })),
  };
}

function summarize(raw: HealthCheck | null) {
  const doc = normalizeHealthCheck(raw);
  const current = doc.current;
  const today = todayLocalISO();
  const prev = previousSavedCheck(doc, { date: current.date ?? today });
  const dims = activeDimensions(doc);
  const lights = Object.fromEntries(dims.map((d) => [d.key, draftLight(current, d.key)]));
  const unrated = unratedDimensions(doc);
  const history = checksByDate(doc, { includeExamples: true });
  return {
    exists: raw !== null,
    current: {
      sprintName: current.sprintName,
      sprintId: current.sprintId ?? null,
      date: current.date ?? null,
      scores: current.scores,
      customScores: current.customScores ?? {},
      rated: dims.filter((d) => lights[d.key] !== null).map((d) => d.key),
      source: current.source ?? null,
      responses: current.responses ?? null,
    },
    lights,
    notes: Object.fromEntries(
      dims.flatMap((d) => {
        const note = scoreOf(current, d.key)?.note;
        return note ? [[d.key, note]] : [];
      })
    ),
    votes: Object.fromEntries(
      dims.flatMap((d) => {
        const v = scoreOf(current, d.key)?.votes;
        return v ? [[d.key, { ...v, total: votesTotal(v), split: isSplit(v) }]] : [];
      })
    ),
    trends: Object.fromEntries(
      dims.map((d) => [
        d.key,
        lights[d.key] ? trendFor(storedLight(prev ?? undefined, d.key), lights[d.key]) : null,
      ])
    ),
    currentHealth: sharePct(draftShare(doc)),
    ratedCount: dims.length - unrated.length,
    unrated: unrated.map((d) => d.name),
    dimensions: dims.map((d) => ({
      key: d.key,
      name: d.name,
      custom: d.custom,
      ...(d.description ? { description: d.description } : {}),
    })),
    archivedDimensions: allDimensions(doc)
      .filter((d) => d.archived)
      .map((d) => ({ key: d.key, name: d.name })),
    checkCount: doc.history.length,
    history: history.map((e) => entryRow(doc, e)),
  };
}

registry.register({
  id: "tool.health_check.list_state",
  toolId: "tool.health_check",
  name: "list_state",
  category: "read",
  description:
    "Summarise the squad health check as the page shows it. Returns {exists, current: {sprintName, sprintId|null, date|null (the day it will be saved under; null = the day it is saved), scores (built-in name -> {light, trend, votes?, note?}; unrated dimensions hold a placeholder green, so read `lights`), customScores, rated: string[] (keys rated), source: room|facilitator|null, responses|null}, lights: {key -> green|yellow|red|null (null = not rated)}, notes: {key -> text}, votes: {key -> {green, yellow, red, total, split}}, trends: {key -> up|same|down|null} (derived against the previous saved check), currentHealth: 0-100|null (rated dimensions only; green 1, yellow 1/2, red 0), ratedCount, unrated: string[] (dimension names still to rate), dimensions: {key, name, custom, description?}[] (built-in keys are their names; custom keys are ids), archivedDimensions: {key, name}[], checkCount, history: {id, label, sprintName, sprintId|null, date, scores, customScores, health (same rule), trends, source, responses, reds: {key, name, sent}[]}[] oldest first by date}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.getDoc()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).getDoc()),
});

/* ── set_sprint_name ────────────────────────────────────────────────── */

async function setSprintName(store: HealthCheckStore, sprintName: string) {
  const doc = await load(store);
  await store.putDoc(withSprintName(doc, sprintName));
  return { set: true };
}

registry.register({
  id: "tool.health_check.set_sprint_name",
  toolId: "tool.health_check",
  name: "set_sprint_name",
  category: "write",
  requiresConfirmation: false,
  description:
    "Name the check in progress (for teams without shared sprints; with sprints, prefer set_sprint). Params: {sprintName (≤200)}. Creates the check if absent. Returns {set: true}.",
  paramsSchema: z.object({ sprintName: z.string().max(200) }),
  handler: (params) => setSprintName(browserStore, params.sprintName),
  mcpHandler: (params, ctx) => setSprintName(serverStore(ctx.userId), params.sprintName),
});

/* ── set_sprint ─────────────────────────────────────────────────────── */

async function setSprint(store: HealthCheckStore, sprintId: string | null) {
  const doc = await load(store);
  if (sprintId === null) {
    await store.putDoc(withSprint(doc, null));
    return { set: true, sprintId: null };
  }
  const sprint = (await store.listSprints()).find((s) => s.id === sprintId);
  if (!sprint) return { set: false, reason: `No sprint with id "${sprintId}".` };
  await store.putDoc(withSprint(doc, sprint));
  return { set: true, sprintId: sprint.id, sprintName: sprint.name };
}

registry.register({
  id: "tool.health_check.set_sprint",
  toolId: "tool.health_check",
  name: "set_sprint",
  category: "write",
  requiresConfirmation: false,
  description:
    "Say which shared sprint the check in progress is for (it is saved with the check, and Sprint Comparison reads the check for that sprint). Params: {sprintId: string | null (null clears it)}. Returns {set: true, sprintId, sprintName} or {set: false, reason} for an unknown sprint.",
  paramsSchema: z.object({ sprintId: z.string().max(128).nullable() }),
  handler: (params) => setSprint(browserStore, params.sprintId),
  mcpHandler: (params, ctx) => setSprint(serverStore(ctx.userId), params.sprintId),
});

/* ── set_dimension ──────────────────────────────────────────────────── */

const votesSchema = z.object({
  green: z.number().int().min(0).max(999),
  yellow: z.number().int().min(0).max(999),
  red: z.number().int().min(0).max(999),
});

const setDimensionParams = z.object({
  dimension: z
    .string()
    .describe(
      "A built-in dimension's name (e.g. 'Fun', 'Teamwork'), or a custom dimension's key or name."
    ),
  light: z.enum(["green", "yellow", "red"]).optional(),
  note: z.string().max(HEALTH_NOTE_MAX).optional().describe("What the team said; '' clears it."),
  votes: votesSchema
    .optional()
    .describe(
      `Anonymous vote counts. From ${MIN_SAMPLE.anonymous} votes they set the light (mean of green 1, yellow 1/2, red 0: >= 0.75 green, < 0.25 red, else yellow) unless light is given.`
    ),
  trend: z
    .enum(["up", "same", "down"])
    .optional()
    .describe("Ignored: the trend is derived from the previous saved check."),
});

async function setDimension(store: HealthCheckStore, params: z.infer<typeof setDimensionParams>) {
  const doc = await load(store);
  const dim = findDimension(doc, params.dimension);
  if (!dim) return { set: false, reason: `No active dimension "${params.dimension}".` };
  if (!params.light && params.note === undefined && !params.votes) {
    return { set: false, reason: "Pass a light, a note or votes." };
  }
  if (params.votes && votesTotal(params.votes) < MIN_SAMPLE.anonymous) {
    return {
      set: false,
      reason: `Votes count from ${MIN_SAMPLE.anonymous} people, so no one's light can be singled out.`,
    };
  }
  let next = doc;
  if (params.votes) next = withVotes(next, dim.key, params.votes);
  if (params.light) next = withRating(next, dim.key, params.light);
  if (params.note !== undefined) next = withNote(next, dim.key, params.note);
  await store.putDoc(next);
  return {
    set: true,
    key: dim.key,
    light: draftLight(next.current, dim.key),
    ...(params.votes ? { lightFromVotes: lightFromVotes(params.votes) } : {}),
    ...(params.trend ? { trendIgnored: true } : {}),
  };
}

registry.register({
  id: "tool.health_check.set_dimension",
  toolId: "tool.health_check",
  name: "set_dimension",
  category: "write",
  requiresConfirmation: false,
  description:
    "Rate a dimension of the check in progress: its light (green/yellow/red), a note (≤500; '' clears) and/or anonymous vote counts {green, yellow, red} (totals only, from 3 votes; they set the light unless light is given). A passed trend is ignored: trends are derived from the previous saved check. Returns {set: true, key, light, lightFromVotes?, trendIgnored?} or {set: false, reason} (unknown or archived dimension, nothing to set, under 3 votes).",
  paramsSchema: setDimensionParams,
  handler: (params) => setDimension(browserStore, params),
  mcpHandler: (params, ctx) => setDimension(serverStore(ctx.userId), params),
});

/* ── save_check ─────────────────────────────────────────────────────── */

async function save(store: HealthCheckStore, date: string | undefined) {
  const doc = await load(store);
  const today = todayLocalISO();
  const dated = date ? { ...doc, current: { ...doc.current, date } } : doc;
  const result = saveDraft(dated, {
    id: crypto.randomUUID(),
    today,
    sprints: await store.listSprints(),
  });
  if (!result.ok) {
    return {
      saved: false,
      unrated: result.unrated.map((d) => d.name),
      ...(result.dateProblem ? { reason: result.dateProblem } : {}),
    };
  }
  await store.putDoc(result.doc);
  return {
    saved: true,
    id: result.entry.id,
    date: result.entry.date,
    health: sharePct(entryShare(result.entry)),
    checkCount: result.doc.history.length,
  };
}

registry.register({
  id: "tool.health_check.save_check",
  toolId: "tool.health_check",
  name: "save_check",
  category: "write",
  requiresConfirmation: false,
  description:
    "Save the check in progress and start a new one. Refused while any active dimension is unrated. Params: {date?: YYYY-MM-DD (backdate; not in the future; default the draft's date, else today)}. Each dimension's trend is stamped against the previous saved check. Returns {saved: true, id, date, health (0-100, yellow 1/2), checkCount} or {saved: false, unrated: string[] (names), reason?}.",
  paramsSchema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  handler: (params) => save(browserStore, params.date),
  mcpHandler: (params, ctx) => save(serverStore(ctx.userId), params.date),
});

/* ── remove_check ───────────────────────────────────────────────────── */

async function removeCheck(store: HealthCheckStore, id: string) {
  const doc = await load(store);
  const next = withoutCheck(doc, id);
  if (!next) return { removed: false };
  await store.putDoc(next);
  return { removed: true, checkCount: next.history.length };
}

registry.register({
  id: "tool.health_check.remove_check",
  toolId: "tool.health_check",
  name: "remove_check",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove one saved check by id (the page offers Undo; an agent's removal is final, so confirm with the user first). Returns {removed: true, checkCount} or {removed: false} for an unknown id.",
  paramsSchema: z.object({ id: z.string() }),
  handler: (params) => removeCheck(browserStore, params.id),
  mcpHandler: (params, ctx) => removeCheck(serverStore(ctx.userId), params.id),
});

/* ── add_dimension / archive_dimension ──────────────────────────────── */

async function addDimension(store: HealthCheckStore, name: string, description?: string) {
  const doc = await load(store);
  const archived = findDimension(doc, name, { includeArchived: true });
  if (archived?.archived) {
    const next = withDimensionPatch(doc, archived.key, { archived: false });
    if (next) await store.putDoc(next);
    return { added: true, id: archived.key, restored: true };
  }
  const problem = dimensionNameProblem(doc, name);
  if (problem) return { added: false, reason: problem };
  const id = `custom-${nanoid(8)}`;
  const clean = description?.trim();
  await store.putDoc(
    withCustomDimension(doc, { id, name: name.trim(), ...(clean ? { description: clean } : {}) })
  );
  return { added: true, id };
}

registry.register({
  id: "tool.health_check.add_dimension",
  toolId: "tool.health_check",
  name: "add_dimension",
  category: "write",
  requiresConfirmation: false,
  description: `Add a dimension of the team's own to every new check. Params: {name (≤${DIMENSION_NAME_MAX}, unique among the dimensions, any case), description? (≤${DIMENSION_DESCRIPTION_MAX})}. Naming an archived dimension restores it. Returns {added: true, id ('custom-…', its key), restored?} or {added: false, reason}.`,
  paramsSchema: z.object({
    name: z.string().min(1).max(DIMENSION_NAME_MAX),
    description: z.string().max(DIMENSION_DESCRIPTION_MAX).optional(),
  }),
  handler: (params) => addDimension(browserStore, params.name, params.description),
  mcpHandler: (params, ctx) =>
    addDimension(serverStore(ctx.userId), params.name, params.description),
});

async function archiveDimension(store: HealthCheckStore, idOrName: string) {
  const doc = await load(store);
  const dim = findDimension(doc, idOrName);
  if (!dim?.custom) {
    return {
      archived: false,
      reason: dim ? "Built-in dimensions can't be archived." : `No active dimension "${idOrName}".`,
    };
  }
  const next = withDimensionPatch(doc, dim.key, { archived: true });
  if (!next) return { archived: false, reason: `No active dimension "${idOrName}".` };
  await store.putDoc(next);
  return { archived: true, id: dim.key };
}

registry.register({
  id: "tool.health_check.archive_dimension",
  toolId: "tool.health_check",
  name: "archive_dimension",
  category: "write",
  requiresConfirmation: false,
  description:
    "Hide a custom dimension from new checks; saved checks keep its lights (nothing is deleted). Params: {id (its key, or its name)}. Returns {archived: true, id} or {archived: false, reason} (built-in or unknown). add_dimension with its name restores it.",
  paramsSchema: z.object({ id: z.string() }),
  handler: (params) => archiveDimension(browserStore, params.id),
  mcpHandler: (params, ctx) => archiveDimension(serverStore(ctx.userId), params.id),
});

/* ── reset ──────────────────────────────────────────────────────────── */

async function reset(store: HealthCheckStore) {
  const doc = await load(store);
  // The team's own dimensions are settings, not results: they stay.
  await store.putDoc({
    ...emptyHealthCheck(),
    ...(doc.customDimensions ? { customDimensions: doc.customDimensions } : {}),
  });
  return { reset: true };
}

registry.register({
  id: "tool.health_check.reset",
  toolId: "tool.health_check",
  name: "reset",
  category: "write",
  requiresConfirmation: true,
  description:
    "Clear the check in progress and every saved check (custom dimensions stay). Destructive and final for an agent: confirm with the user first. Returns {reset: true}.",
  paramsSchema: z.object({}),
  handler: () => reset(browserStore),
  mcpHandler: (_params, ctx) => reset(serverStore(ctx.userId)),
});
