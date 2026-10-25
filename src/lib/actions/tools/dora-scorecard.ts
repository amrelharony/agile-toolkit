/**
 * DORA Scorecard — tool-local actions.
 *
 * Category: Track delivery
 * Tool:     One sample per quarter of the four DORA metrics, banded by the
 *           2023 Accelerate State of DevOps Report's clusters, typed or
 *           derived from the team's releases, boards and incidents.
 *
 * Agent surface: tool.dora_scorecard.*
 * Backing CRUD : workspace.dora_scorecard.* (auto-generated). Singleton: one
 *                DoraScorecard document (samples[]) under DORA_DOC_ID.
 *
 *   1. list_state     — samples by quarter, the latest quarter with its
 *                       bands, averages, the verdict, the band table cited.
 *   2. add_sample     — log a quarter ("YYYY-Qn", started, not logged yet).
 *   3. update_sample  — edit a sample in place, under the same checks.
 *   4. remove_sample  — remove a sample (returns it, to add back).
 *   5. derive_sample  — work a quarter's numbers out from the data (read).
 *
 * The page and these actions share lib/dora (bands, checks, latest by
 * quarter, derivation), so an agent reads and writes what the page shows.
 * Entity kind "workspace:doraScorecard" + DORA_DOC_ID match the page.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  KANBAN_BOARD_ID,
  type DoraSample,
  type DoraScorecard,
  type IncidentCommander,
  type KanbanBoard,
  type ReleaseReadiness,
  type Story,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { cardItems, storyItems } from "@/lib/flow";
import {
  DORA_BANDS,
  DORA_METRICS,
  bandRanges,
  bandsCitation,
  doraBand,
  type DoraMetric,
} from "@/lib/dora/bands";
import {
  DORA_DESCRIPTION_MAX,
  DORA_DOC_ID,
  numberErrors,
  quarterError,
  sampleCoverage,
  sampleFor,
  scorecardSummary,
  usableSamples,
  weakestMetrics,
} from "@/lib/dora/samples";
import {
  INCIDENT_DOC_ID,
  deriveDoraSample,
  derivedMetrics,
  editedSource,
  sampleOrigin,
  type DoraDerivation,
} from "@/lib/dora/derive";
import { doraVerdict } from "@/lib/dora/verdict";

const KIND_DORA = "workspace:doraScorecard";
const KIND_RELEASES = "workspace:releaseReadiness";
const KIND_STORY = "workspace:story";
const KIND_KANBAN = "workspace:kanbanBoard";
const KIND_INCIDENTS = "workspace:incidentCommander";

const ws = () => useWorkspaceStore.getState();

/** What a derivation reads, wherever it lives. */
interface DeriveSources {
  releases: ReleaseReadiness | null;
  stories: Story[];
  board: KanbanBoard | null;
  incidents: IncidentCommander | null;
}

/** Where the scorecard lives: the browser's workspace, or the user's rows on the server. */
interface DoraStore {
  getDoc(): Promise<DoraScorecard | null>;
  putDoc(doc: DoraScorecard): Promise<void>;
  sources(): Promise<DeriveSources>;
}

const browserStore: DoraStore = {
  getDoc: async () => (ws().doraScorecards ?? []).find((d) => d.id === DORA_DOC_ID) ?? null,
  putDoc: async (doc) => ws().upsertDoraScorecard(doc),
  sources: async () => {
    const s = ws();
    return {
      releases: (s.releaseReadinesses ?? []).find((d) => d.id === RELEASE_DOC_ID) ?? null,
      stories: s.stories ?? [],
      board: (s.kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID) ?? null,
      incidents: (s.incidentCommanders ?? []).find((d) => d.id === INCIDENT_DOC_ID) ?? null,
    };
  },
};

function serverStore(userId: string): DoraStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<DoraScorecard>(userId, KIND_DORA, DORA_DOC_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<DoraScorecard>(userId, KIND_DORA, doc);
    },
    sources: async () => {
      const [releases, stories, board, incidents] = await Promise.all([
        serverGetEntity<ReleaseReadiness>(userId, KIND_RELEASES, RELEASE_DOC_ID),
        serverListEntities<Story>(userId, KIND_STORY),
        serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID),
        serverGetEntity<IncidentCommander>(userId, KIND_INCIDENTS, INCIDENT_DOC_ID),
      ]);
      return {
        releases: releases ?? null,
        stories: stories ?? [],
        board: board ?? null,
        incidents: incidents ?? null,
      };
    },
  };
}

/** The stored list as it is (non-objects included), so a write never drops a row it can't read. */
const rawSamples = (doc: DoraScorecard | null): DoraSample[] =>
  Array.isArray(doc?.samples) ? doc.samples : [];

async function putSamples(store: DoraStore, doc: DoraScorecard | null, samples: DoraSample[]) {
  await store.putDoc({ ...(doc ?? {}), id: DORA_DOC_ID, samples });
}

/* ── list_state ─────────────────────────────────────────────────────── */

function listState(doc: DoraScorecard | null) {
  const summary = scorecardSummary(doc);
  const weakest = summary.latest ? weakestMetrics(summary.latest) : { metrics: [], band: null };
  const bandTable = {} as Record<DoraMetric, ReturnType<typeof bandRanges>>;
  for (const m of DORA_METRICS) bandTable[m] = bandRanges(m);
  const today = todayLocalISO();
  // The samples that cover part of their quarter, and where each one's
  // numbers came from, as the page's rows say.
  const partial = summary.samples.flatMap((s) => {
    const coverage = sampleCoverage(s, today);
    return coverage ? [{ id: s.id, quarter: s.quarter, coverage }] : [];
  });
  const origins = summary.samples.map((s) => {
    const origin = sampleOrigin(s);
    const fromData =
      origin === "typed" ? [] : s.derivedFrom ? derivedMetrics(s.derivedFrom) : [...DORA_METRICS];
    return { id: s.id, origin, fromData };
  });
  return {
    ...summary,
    weakest,
    verdict: doraVerdict(summary.samples),
    bandsSource: { ...summary.bandsSource, citation: bandsCitation(), cut: DORA_BANDS.cut },
    bandTable,
    partial,
    origins,
  };
}

registry.register({
  id: "tool.dora_scorecard.list_state",
  toolId: "tool.dora_scorecard",
  name: "list_state",
  category: "read",
  description:
    'Summarise the DORA scorecard as the page shows it. Returns {exists, total, latest (the sample for the latest QUARTER, not the last added; null when none), averages: {deployFreqPerWeek, leadTimeHours, changeFailRate (0..1), mttrHours} (null each when there are no samples), samples (oldest quarter first; example- rows left out), examplesLeftOut, bands (the latest sample\'s Elite|High|Medium|Low per metric, null for a missing value; null with no latest), weakest {metrics[], band}, verdict (the page\'s one sentence), bandsSource {report, publisher, year, note, citation, cut (where each band starts per metric: deploys a week, hours, a 0..1 rate)}, bandTable (per metric: [{band, range, cluster}] best first), partial ([{id, quarter, coverage: "running" (the quarter is still on: numbers so far) | "early" (last saved before its quarter ended)}]), origins ([{id, origin: "derived" | "partly" | "typed", fromData: the metrics worked out from the data}])}.',
  paramsSchema: z.object({}),
  handler: async () => listState(await browserStore.getDoc()),
  mcpHandler: async (_params, ctx) => listState(await serverStore(ctx.userId).getDoc()),
});

/* ── add_sample ─────────────────────────────────────────────────────── */

const Quarter = z
  .string()
  .regex(/^\d{4}-Q[1-4]$/, "A quarter like 2026-Q3")
  .describe('The quarter, "YYYY-Qn" (e.g. "2026-Q3"). It must have started.');

const DerivedFromSchema = z.object({
  releases: z.number().int().min(0),
  rolledBack: z.number().int().min(0),
  items: z.number().int().min(0),
  incidents: z.number().int().min(0),
});

const AddParams = z.object({
  quarter: Quarter,
  deployFreqPerWeek: z.number().min(0).describe("Deployments to production per week."),
  leadTimeHours: z.number().min(0).describe("Hours from commit (or start of work) to production."),
  changeFailRate: z.number().min(0).max(1).describe("Share of deployments that failed, 0..1."),
  mttrHours: z.number().min(0).describe("Hours to restore service after a failure."),
  description: z.string().max(DORA_DESCRIPTION_MAX).optional(),
  source: z
    .enum(["manual", "derived"])
    .optional()
    .describe('"derived" when the numbers came from derive_sample; default "manual".'),
  derivedFrom: DerivedFromSchema.optional().describe(
    "derive_sample's derivedFrom, with source derived. Set a count to 0 for a number you typed instead of taking derive_sample's (releases covers deploy frequency and change failure rate, items lead time, incidents time to restore); with every count 0 the sample is saved as manual."
  ),
});

type AddInput = z.infer<typeof AddParams>;

async function addSample(store: DoraStore, params: AddInput) {
  const doc = await store.getDoc();
  const samples = rawSamples(doc);
  const usable = usableSamples(doc, { includeExamples: true });
  const today = todayLocalISO();
  const existing = sampleFor(usable, params.quarter);
  if (existing) {
    return {
      added: false as const,
      reason: "duplicate" as const,
      id: existing.id,
      message: `${params.quarter} already has a sample; edit it with update_sample.`,
    };
  }
  const why = quarterError(params.quarter, usable, today);
  if (why) return { added: false as const, reason: "not_started" as const, message: why };
  const description = params.description?.trim();
  // As the page saves it: derived only with something from the data (a
  // derivedFrom with every count 0 is a typed sample).
  const derived =
    params.source === "derived" &&
    (!params.derivedFrom || derivedMetrics(params.derivedFrom).length > 0);
  const sample: DoraSample = {
    id: crypto.randomUUID(),
    quarter: params.quarter,
    deployFreqPerWeek: params.deployFreqPerWeek,
    leadTimeHours: params.leadTimeHours,
    changeFailRate: params.changeFailRate,
    mttrHours: params.mttrHours,
    ...(description ? { description } : {}),
    source: derived ? "derived" : "manual",
    ...(derived && params.derivedFrom ? { derivedFrom: params.derivedFrom } : {}),
    // When it was saved: a quarter still running is partial (list_state's `partial`).
    updatedAt: new Date().toISOString(),
  };
  await putSamples(store, doc, [...samples, sample]);
  return { added: true as const, id: sample.id };
}

registry.register({
  id: "tool.dora_scorecard.add_sample",
  toolId: "tool.dora_scorecard",
  name: "add_sample",
  category: "write",
  requiresConfirmation: false,
  description:
    'Log a quarter\'s DORA sample. quarter = "YYYY-Qn" (a quarter that has started); deployFreqPerWeek = deployments a week; leadTimeHours = commit → production; changeFailRate = 0..1; mttrHours = hours to restore; optional description, and source "derived" + derivedFrom when the numbers came from derive_sample (a count 0 for each number typed instead). One sample per quarter; stamps updatedAt (a quarter still running reads as partial). Creates the doc if absent. Returns {added: true, id}, or {added: false, reason: "duplicate", id (the existing sample: edit it with update_sample), message} or {added: false, reason: "not_started", message}.',
  paramsSchema: AddParams,
  handler: async (params) => addSample(browserStore, params),
  mcpHandler: async (params, ctx) => addSample(serverStore(ctx.userId), params),
});

/* ── update_sample ──────────────────────────────────────────────────── */

const UpdateParams = z.object({
  id: z.string().min(1),
  patch: z
    .object({
      quarter: Quarter.optional(),
      deployFreqPerWeek: z.number().min(0).optional(),
      leadTimeHours: z.number().min(0).optional(),
      changeFailRate: z.number().min(0).max(1).optional(),
      mttrHours: z.number().min(0).optional(),
      description: z
        .string()
        .max(DORA_DESCRIPTION_MAX)
        .nullable()
        .optional()
        .describe("null or an empty string removes it."),
      source: z
        .enum(["manual", "derived"])
        .optional()
        .describe(
          'Where the numbers come from now: "derived" with derivedFrom after a fresh derive_sample, "manual" to mark them typed.'
        ),
      derivedFrom: DerivedFromSchema.optional().describe(
        "derive_sample's derivedFrom for the saved numbers (0 for each one typed instead)."
      ),
    })
    .describe(
      "Only the fields to change. Without source/derivedFrom, a derived number that changes counts as typed from then on (its derivedFrom count goes to 0), as on the page."
    ),
});

type UpdateInput = z.infer<typeof UpdateParams>;

/**
 * Where an updated sample's numbers come from: as the patch says (after a
 * fresh derive_sample), else as the edit leaves them (lib/dora/derive
 * editedSource, the page editor's rule). Derived needs a count above 0.
 */
function patchedOrigin(
  current: DoraSample,
  next: DoraSample,
  source: DoraSample["source"],
  derivedFrom: DoraSample["derivedFrom"]
): Pick<DoraSample, "source" | "derivedFrom"> {
  if (source === undefined && derivedFrom === undefined) return editedSource(current, next);
  // derivedFrom alone means derived.
  if ((source ?? "derived") === "manual") return { source: "manual" };
  const from = derivedFrom ?? current.derivedFrom;
  if (!from) return { source: "derived" };
  return derivedMetrics(from).length > 0
    ? { source: "derived", derivedFrom: from }
    : { source: "manual" };
}

async function updateSample(store: DoraStore, { id, patch }: UpdateInput) {
  const doc = await store.getDoc();
  const samples = rawSamples(doc);
  const at = samples.findIndex((s) => s && typeof s === "object" && s.id === id);
  if (at < 0) return { updated: false as const, reason: "not_found" as const };
  const current = samples[at];
  const { description: newDescription, source, derivedFrom, ...numbers } = patch;
  const next: DoraSample = { ...current, ...numbers };
  if (newDescription !== undefined) {
    const d = (newDescription ?? "").trim();
    if (d) next.description = d;
    else delete next.description;
  }
  const origin = patchedOrigin(current, next, source, derivedFrom);
  delete next.source;
  delete next.derivedFrom;
  Object.assign(next, origin);
  const errors: Record<string, string> = { ...numberErrors(next) };
  // A quarter left as stored isn't judged again (an old free-text one stays until changed).
  if (patch.quarter !== undefined) {
    const why = quarterError(
      patch.quarter,
      usableSamples(doc, { includeExamples: true }),
      todayLocalISO(),
      id
    );
    if (why) errors.quarter = why;
  }
  if (Object.keys(errors).length > 0) {
    return { updated: false as const, reason: "invalid" as const, errors };
  }
  next.updatedAt = new Date().toISOString();
  await putSamples(
    store,
    doc,
    samples.map((s, i) => (i === at ? next : s))
  );
  return { updated: true as const, sample: next };
}

registry.register({
  id: "tool.dora_scorecard.update_sample",
  toolId: "tool.dora_scorecard",
  name: "update_sample",
  category: "write",
  requiresConfirmation: false,
  description:
    'Edit a sample in place: {id, patch: {quarter? ("YYYY-Qn", started, not another sample\'s), deployFreqPerWeek?, leadTimeHours?, changeFailRate? (0..1), mttrHours?, description? (null clears), source? ("manual" | "derived"), derivedFrom? (from derive_sample, 0 for a number typed instead)}}, checked as the page checks it; stamps updatedAt. Without source/derivedFrom, a derived number that changes becomes typed (its count goes to 0; a new quarter makes them all typed; none left: source "manual"), as the editor on the page does. Returns {updated: true, sample}, {updated: false, reason: "not_found"} or {updated: false, reason: "invalid", errors: {field: message}}.',
  paramsSchema: UpdateParams,
  handler: async (params) => updateSample(browserStore, params),
  mcpHandler: async (params, ctx) => updateSample(serverStore(ctx.userId), params),
});

/* ── remove_sample ──────────────────────────────────────────────────── */

async function removeSample(store: DoraStore, id: string) {
  const doc = await store.getDoc();
  const samples = rawSamples(doc);
  const removed = samples.find((s) => s && typeof s === "object" && s.id === id);
  if (!removed) return { removed: false as const };
  await putSamples(
    store,
    doc,
    samples.filter((s) => s !== removed)
  );
  return { removed: true as const, sample: removed };
}

registry.register({
  id: "tool.dora_scorecard.remove_sample",
  toolId: "tool.dora_scorecard",
  name: "remove_sample",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a sample by id. Returns {removed: true, sample} (pass its fields to add_sample to put it back), or {removed: false} when the id is unknown.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params) => removeSample(browserStore, params.id),
  mcpHandler: async (params, ctx) => removeSample(serverStore(ctx.userId), params.id),
});

/* ── derive_sample ──────────────────────────────────────────────────── */

function derivationResult(
  d: DoraDerivation,
  existing: DoraSample | undefined
): DoraDerivation & {
  bands: Record<DoraMetric, ReturnType<typeof doraBand>>;
  logged: { id: string } | null;
} {
  const bands = {} as Record<DoraMetric, ReturnType<typeof doraBand>>;
  for (const m of DORA_METRICS) bands[m] = doraBand(m, d[m]);
  return { ...d, bands, logged: existing ? { id: existing.id } : null };
}

async function deriveSample(store: DoraStore, quarter: string) {
  const [doc, src] = await Promise.all([store.getDoc(), store.sources()]);
  const d = deriveDoraSample({
    quarter,
    releases: src.releases,
    items: [
      ...storyItems(src.stories),
      ...cardItems(Array.isArray(src.board?.cards) ? src.board.cards : []),
    ],
    incidents: src.incidents,
    today: todayLocalISO(),
  });
  if (!d) return { derived: false as const, reason: "bad_quarter" as const };
  const existing = sampleFor(usableSamples(doc, { includeExamples: true }), quarter);
  return { derived: true as const, ...derivationResult(d, existing) };
}

registry.register({
  id: "tool.dora_scorecard.derive_sample",
  toolId: "tool.dora_scorecard",
  name: "derive_sample",
  category: "read",
  description:
    'Work a quarter\'s DORA numbers out from the workspace, as the page\'s "Fill from your data" does; writes nothing. {quarter: "YYYY-Qn"}. Deploy frequency = ships in the quarter (Release Readiness, reopened releases\' earlier ships included) per week elapsed; change failure rate = rolled back ÷ shipped; lead time = median hours from the start of work to the release that shipped it, over the work SHIPPED in the quarter (by ship day, as deploys are counted; Release.storyIds, else the first ship on/after done; start to done over the work done in the quarter when no releases are tracked; needs 3 items, and derivedFrom.items is 0 without a lead time); time to restore = mean hours opened → resolved of incidents resolved in the quarter (Incident Commander). Returns {derived: true, quarter, from, to, inProgress, weeks, deployFreqPerWeek, changeFailRate, leadTimeHours, mttrHours (null each when the data can\'t give it), missing {metric: why}, derivedFrom {releases, rolledBack, items, incidents}, lead {basis, measured, linked, notShipped}, bands, logged ({id} of the sample already logged for the quarter, or null)}, or {derived: false, reason: "bad_quarter"}. A count of 0 in derivedFrom means that number wasn\'t worked out. Save with add_sample, or update_sample for a quarter already logged, passing source "derived" and derivedFrom (set the count of any number you change to 0).',
  paramsSchema: z.object({ quarter: Quarter }),
  handler: async (params) => deriveSample(browserStore, params.quarter),
  mcpHandler: async (params, ctx) => deriveSample(serverStore(ctx.userId), params.quarter),
});
