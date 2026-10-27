/**
 * Code Review Metrics — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     Time to first review and cycle time (open → merge) in working
 *           hours, review depth and PR size, from logged or pasted pull
 *           requests; a team-level view by PR size.
 *
 * Agent surface: tool.code_review_metrics.*
 * Backing CRUD : workspace.code_review_log.* (auto-generated). Singleton: one
 *                CodeReviewLog document (samples[]) under a fixed id.
 *
 *   1. list_state          — counts, medians in working hours (and elapsed),
 *                            P85, the size bands, the weekly medians, the
 *                            verdict, plus the older means.
 *   2. add_sample          — record a PR, checked as the page checks it.
 *   3. remove_sample       — delete a PR.
 *   4. set_working_window  — the working hours a day counts, or whole days.
 *
 * Working hours come from the team calendar (the ceremony cadence's working
 * days and holidays) and the log's working window. The maths lives in
 * lib/quality/review, which the page reads too, and CODE_REVIEW_LOG_KIND +
 * CODE_REVIEW_LOG_ID match the page, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import {
  CEREMONY_CADENCE_ID,
  type CeremonyCadenceDoc,
  type CodeReviewLog,
  type PrSample,
} from "@/lib/stores/workspace-types";
import { cadenceCalendar, normalizeCadence } from "@/lib/sprints/cadence";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import {
  CODE_REVIEW_LOG_ID,
  CODE_REVIEW_LOG_KIND,
  REVIEW_AUTHOR_MAX,
  REVIEW_DESCRIPTION_MAX,
  REVIEW_PR_NUMBER_MAX,
  latestWallClock,
  newSampleId,
  reviewSummary,
  reviewVerdict,
  sampleErrorMessage,
  sampleErrors,
  sampleFromDraft,
  windowMinutes,
  workingBasisLabel,
  workingWindowError,
} from "@/lib/quality/review";

/** MUST match registerCollection("ceremonyCadence", …) in workspace-store.ts. */
const KIND_CADENCE = "workspace:ceremonyCadence";

const ws = () => useWorkspaceStore.getState();

const round1 = (n: number) => Math.round(n * 10) / 10;
const round1OrNull = (n: number | null) => (n === null ? null : round1(n));

/** Where the log lives: the browser's workspace, or the user's rows on the server. */
interface ReviewStore {
  getDoc(): Promise<CodeReviewLog | null>;
  putDoc(doc: CodeReviewLog): Promise<void>;
  /** The team's working days and holidays, which working hours count. */
  calendar(): Promise<WorkingCalendar>;
}

const browserStore: ReviewStore = {
  getDoc: async () => (ws().codeReviewLogs ?? []).find((d) => d.id === CODE_REVIEW_LOG_ID) ?? null,
  putDoc: async (doc) => ws().upsertCodeReviewLog(doc),
  calendar: async () =>
    cadenceCalendar(
      normalizeCadence((ws().ceremonyCadences ?? []).find((d) => d.id === CEREMONY_CADENCE_ID))
    ),
};

function serverStore(userId: string): ReviewStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<CodeReviewLog>(userId, CODE_REVIEW_LOG_KIND, CODE_REVIEW_LOG_ID)) ??
      null,
    putDoc: async (doc) => {
      await serverUpsertEntity<CodeReviewLog>(userId, CODE_REVIEW_LOG_KIND, doc);
    },
    calendar: async () =>
      cadenceCalendar(
        normalizeCadence(
          await serverGetEntity<CeremonyCadenceDoc>(userId, KIND_CADENCE, CEREMONY_CADENCE_ID)
        )
      ),
  };
}

const samplesOf = (doc: CodeReviewLog | null) => (Array.isArray(doc?.samples) ? doc.samples : []);

/** Mean of `values`, or null when empty (avoids a misleading 0). */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

async function listState(store: ReviewStore) {
  const doc = await store.getDoc();
  const calendar = await store.calendar();
  const samples = samplesOf(doc);
  const window = doc?.workingWindow;
  const s = reviewSummary(samples, calendar, windowMinutes(window));
  const h = s.headline;
  return {
    exists: doc !== null,
    total: s.total,
    mergedCount: s.merged,
    openCount: s.open,
    invalidCount: s.invalid,
    awaitingReviewCount: s.awaitingReview,
    medianCycleWorkingHours: round1OrNull(h.medianCycleWorkingH),
    medianFirstReviewWorkingHours: round1OrNull(h.medianFirstReviewWorkingH),
    medianCycleHours: round1OrNull(h.medianCycleH),
    medianFirstReviewHours: round1OrNull(h.medianFirstReviewH),
    p85CycleWorkingHours: round1OrNull(h.p85CycleWorkingH),
    p85FirstReviewWorkingHours: round1OrNull(h.p85FirstReviewWorkingH),
    workingBasis: {
      label: workingBasisLabel(calendar, window),
      workingDays: [...calendar.workingDays],
      holidays: calendar.holidays.length,
      window: windowMinutes(window) && window ? { start: window.start, end: window.end } : null,
    },
    bySize: s.bySize.map((b) => ({
      band: b.band,
      label: b.label,
      n: b.n,
      merged: b.merged,
      medianCycleWorkingHours: round1OrNull(b.medianCycleWorkingH),
      medianFirstReviewWorkingHours: round1OrNull(b.medianFirstReviewWorkingH),
      medianComments: b.medianComments,
    })),
    largeNoComments: s.largeNoComments,
    weekly: s.weekly.map((w) => ({
      week: w.week,
      n: w.n,
      medianCycleWorkingHours: round1OrNull(w.medianCycleWorkingH),
    })),
    verdict: reviewVerdict(s),
    // The means from before the medians, kept for older agents: elapsed
    // hours over merged PRs, and the counts over every PR.
    avgCycleTimeHours: s.cycleElapsed.average === null ? null : round1(s.cycleElapsed.average),
    avgReviewers: mean(samples.map((x) => x.reviewerCount)),
    avgComments: mean(samples.map((x) => x.commentCount)),
    avgLinesChanged: mean(samples.map((x) => x.linesChanged)),
    samples,
  };
}

// ──────── tool.code_review_metrics.list_state ────────
registry.register({
  id: "tool.code_review_metrics.list_state",
  toolId: "tool.code_review_metrics",
  name: "list_state",
  category: "read",
  description:
    "Summarise code-review metrics. Times are wall-clock as written; working hours count the team's working days (the ceremony cadence, holidays excluded) within the log's working window, else whole working days. Returns {exists, total, mergedCount, openCount, invalidCount (dates unreadable or merged before opened; total = merged + open + invalid), awaitingReviewCount, medianCycleWorkingHours, medianFirstReviewWorkingHours, medianCycleHours (elapsed), medianFirstReviewHours (elapsed) — each a nearest-rank median, null below 3 PRs —, p85CycleWorkingHours, p85FirstReviewWorkingHours (null below 5), workingBasis: {label, workingDays (0 = Sunday), holidays (count), window: {start, end} | null}, bySize: {band ('small' ≤100 | 'medium' 101-400 | 'large' >400 lines), label, n, merged, medianCycleWorkingHours, medianFirstReviewWorkingHours, medianComments (each null below 3)}[], largeNoComments (large PRs merged with 0 comments), weekly: {week ('2026-W42'), n, medianCycleWorkingHours (null below 3 merges that week)}[] (by merge week, quiet weeks included), verdict, avgCycleTimeHours (mean elapsed hours over merged PRs, null without), avgReviewers, avgComments, avgLinesChanged (means over every PR, null when empty), samples}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

// ──────── tool.code_review_metrics.add_sample ────────

const WallClock = z
  .string()
  .describe('Local wall-clock "YYYY-MM-DDTHH:MM" (a zone suffix is dropped, not converted).');

const AddParams = z.object({
  author: z.string().min(1).max(REVIEW_AUTHOR_MAX).describe("Stored without a leading '@'."),
  openedAt: WallClock,
  firstReviewAt: WallClock.optional().describe(
    "When the first review landed: between openedAt and mergedAt."
  ),
  mergedAt: WallClock.optional().describe("Enables cycle time; not before openedAt."),
  reviewerCount: z.number().int().min(0),
  commentCount: z.number().int().min(0),
  linesChanged: z.number().int().min(0),
  prNumber: z.string().max(REVIEW_PR_NUMBER_MAX).optional(),
  description: z.string().max(REVIEW_DESCRIPTION_MAX).optional(),
});

async function addSample(store: ReviewStore, params: z.infer<typeof AddParams>) {
  // The server doesn't know the person's zone: only what is in the future
  // in every zone is refused.
  const errors = sampleErrors(params, latestWallClock());
  const message = sampleErrorMessage(errors);
  if (message) return { added: false as const, reason: "invalid" as const, message, errors };
  const doc = await store.getDoc();
  const prNumber = params.prNumber?.trim();
  const dup = prNumber ? samplesOf(doc).find((s) => (s.prNumber ?? "").trim() === prNumber) : null;
  if (dup) return { added: false as const, reason: "duplicate" as const, id: dup.id };
  const sample: PrSample = sampleFromDraft(params, newSampleId());
  await store.putDoc({
    ...(doc ?? {}),
    id: CODE_REVIEW_LOG_ID,
    samples: [...samplesOf(doc), sample],
  });
  return { added: true as const, id: sample.id };
}

registry.register({
  id: "tool.code_review_metrics.add_sample",
  toolId: "tool.code_review_metrics",
  name: "add_sample",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a pull request. Times are local wall-clock 'YYYY-MM-DDTHH:MM' (a bare date is its midnight; a zone suffix is dropped), in the order openedAt ≤ firstReviewAt ≤ mergedAt, none in the future. firstReviewAt enables time to first review, mergedAt cycle time. commentCount is the review depth; linesChanged sets the size band. A prNumber already logged is refused. Creates the log if absent. Returns {added: true, id}, or {added: false, reason: 'invalid', message (names each field), errors} | {added: false, reason: 'duplicate', id}.",
  paramsSchema: AddParams,
  handler: async (params) => addSample(browserStore, params),
  mcpHandler: async (params, ctx) => addSample(serverStore(ctx.userId), params),
});

// ──────── tool.code_review_metrics.remove_sample ────────

const RemoveParams = z.object({ sampleId: z.string().min(1) });

async function removeSample(store: ReviewStore, params: z.infer<typeof RemoveParams>) {
  const doc = await store.getDoc();
  if (!doc || !samplesOf(doc).some((s) => s.id === params.sampleId)) {
    return { removed: false, reason: "not_found" as const };
  }
  await store.putDoc({
    ...doc,
    samples: samplesOf(doc).filter((s) => s.id !== params.sampleId),
  });
  return { removed: true };
}

registry.register({
  id: "tool.code_review_metrics.remove_sample",
  toolId: "tool.code_review_metrics",
  name: "remove_sample",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete a logged pull request by id. Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: RemoveParams,
  handler: async (params) => removeSample(browserStore, params),
  mcpHandler: async (params, ctx) => removeSample(serverStore(ctx.userId), params),
});

// ──────── tool.code_review_metrics.set_working_window ────────

const WindowParams = z.object({
  start: z.string().nullable().optional().describe('"HH:MM" (24-hour) the working day starts.'),
  end: z.string().nullable().optional().describe('"HH:MM" it ends; after start.'),
});

async function setWorkingWindow(store: ReviewStore, params: z.infer<typeof WindowParams>) {
  const start = params.start?.trim() || null;
  const end = params.end?.trim() || null;
  if ((start === null) !== (end === null)) {
    return {
      updated: false,
      reason: "invalid_window" as const,
      message: "Give both start and end, or neither to count whole working days.",
    };
  }
  if (start !== null && end !== null) {
    const error = workingWindowError(start, end);
    if (error) return { updated: false, reason: "invalid_window" as const, message: error };
  }
  const doc = await store.getDoc();
  const next: CodeReviewLog = { ...(doc ?? {}), id: CODE_REVIEW_LOG_ID, samples: samplesOf(doc) };
  if (start !== null && end !== null) next.workingWindow = { start, end };
  else delete next.workingWindow;
  await store.putDoc(next);
  return { updated: true, workingWindow: next.workingWindow ?? null };
}

registry.register({
  id: "tool.code_review_metrics.set_working_window",
  toolId: "tool.code_review_metrics",
  name: "set_working_window",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the hours of a working day the working-hours medians count (start and end as 'HH:MM', end after start), or clear it with neither (whole working days count). Creates the log if absent. Returns {updated: true, workingWindow: {start, end} | null}, or {updated: false, reason: 'invalid_window', message}.",
  paramsSchema: WindowParams,
  handler: async (params) => setWorkingWindow(browserStore, params),
  mcpHandler: async (params, ctx) => setWorkingWindow(serverStore(ctx.userId), params),
});
