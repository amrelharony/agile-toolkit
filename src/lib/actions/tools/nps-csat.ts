/**
 * NPS / CSAT Tracker — tool-local actions.
 *
 * Category: Outcomes & Pulse (squad S6)
 * Agent surface: tool.nps_csat.*
 * Backing CRUD : workspace.nps_response.* (auto-generated; tagging a stored
 *                response is workspace.nps_response.update {patch: {tags}}).
 *
 *   1. list_state — NPS (%promoters − %detractors, null with none) and CSAT
 *      as % satisfied (4–5 of 1–5), overall and per calendar week or month
 *      with each period's n and whether it meets the minimum, plus the tags.
 *   2. record     — add one response, its score checked against its kind's
 *      scale, with optional theme tags.
 *
 * Every number comes from lib/nps/score, which the page and its Markdown
 * share. Example rows (`example-` ids) are left out of list_state.
 *
 * Entity kind "workspace:npsResponse" (camelCase via kindFromToolId) matches
 * the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { NPS_TAG_LIMIT, NPS_TAG_MAX_LENGTH, type NpsResponse } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  SCORE_RANGE,
  isValidScore,
  latestEnough,
  normalizeTags,
  periodSeries,
  realResponses,
  hasTag,
  summarizeCsat,
  summarizeNps,
  tagCounts,
  tagsProblem,
  type SurveyPeriod,
} from "@/lib/nps/score";
import { isIsoDate } from "@/lib/sprints/calendar";
import { addDays } from "@/lib/impediments/model";
import { todayLocalISO } from "@/lib/utils/formatters";

const KIND_NPS = "workspace:npsResponse";

const ws = () => useWorkspaceStore.getState();

interface NpsStore {
  responses(): Promise<NpsResponse[]>;
  put(r: NpsResponse): Promise<void>;
}

const browserStore: NpsStore = {
  responses: async () => ws().npsResponses ?? [],
  put: async (r) => ws().upsertNpsResponse(r),
};

function serverStore(userId: string): NpsStore {
  return {
    responses: () => serverListEntities<NpsResponse>(userId, KIND_NPS),
    put: async (r) => {
      await serverUpsertEntity<NpsResponse>(userId, KIND_NPS, r);
    },
  };
}

/* ── list_state ─────────────────────────────────────────────────────── */

/** Periods list_state returns by default, the latest kept: a year of weeks, two of months. */
const DEFAULT_PERIODS: Record<SurveyPeriod, number> = { week: 52, month: 24 };

const listParams = z.object({
  by: z
    .enum(["week", "month"])
    .optional()
    .describe("Calendar periods: ISO weeks (Monday to Sunday) or months. Default month."),
  tag: z
    .string()
    .optional()
    .describe("Only responses with this theme tag (the totals, periods and headline)."),
  maxPeriods: z
    .number()
    .int()
    .min(1)
    .max(260)
    .optional()
    .describe("At most this many periods, the latest kept (default 52 weeks or 24 months)."),
});

type ListParams = z.infer<typeof listParams>;

async function listState(store: NpsStore, p: ListParams) {
  const by: SurveyPeriod = p.by ?? "month";
  const real = realResponses(await store.responses());
  const tag = p.tag?.trim() ? normalizeTags(p.tag)[0] : undefined;
  const matching = tag === undefined ? real : real.filter((r) => hasTag(r, tag));
  const nps = summarizeNps(matching);
  const csat = summarizeCsat(matching);
  // Run on to today's period, so a recent quiet stretch shows as empty periods.
  const series = periodSeries(matching, by, {
    maxPeriods: p.maxPeriods ?? DEFAULT_PERIODS[by],
    through: todayLocalISO(),
  });
  const npsHead = latestEnough(series.points, "nps");
  const csatHead = latestEnough(series.points, "csat");
  return {
    total: real.length,
    tag: tag ?? null,
    matching: matching.length,
    // `count` is the name these totals always had; `n` is the library's.
    nps: { ...nps, count: nps.n },
    csat: { ...csat, count: csat.n },
    by,
    minPerPeriod: MIN_SAMPLE.surveyPeriod,
    periods: series.points,
    headline: {
      nps: npsHead
        ? {
            period: npsHead.period,
            label: npsHead.label,
            score: npsHead.nps.score,
            n: npsHead.nps.n,
          }
        : null,
      csat: csatHead
        ? {
            period: csatHead.period,
            label: csatHead.label,
            satisfiedPct: csatHead.csat.satisfiedPct,
            n: csatHead.csat.n,
          }
        : null,
    },
    undated: series.undated,
    offScale: series.offScale,
    tags: tagCounts(real),
  };
}

registry.register({
  id: "tool.nps_csat.list_state",
  toolId: "tool.nps_csat",
  name: "list_state",
  category: "read",
  description: `Summarise NPS/CSAT responses as the page reads them. Params: {by?: 'week' | 'month' (default month), tag? (only responses with it), maxPeriods? (1-260; default 52 weeks or 24 months, the latest kept)}. Returns {total (the team's responses), tag | null, matching (with the tag), nps: {n, count (= n), score (−100..100 = %promoters − %detractors; null with no NPS responses), promoters (9-10), passives (7-8), detractors (0-6)}, csat: {n, count (= n), satisfied (4-5), satisfiedPct (0-100; null with none), average (1-5 to one decimal; null with none)}, by, minPerPeriod (${MIN_SAMPLE.surveyPeriod}: below it a period's score reads with a warning, one answer moving it by about 100/n points), periods: {period ('2026-W42' | '2026-10'), label, from, to, nps, csat, enoughNps, enoughCsat}[] (oldest first, from the first response's period to today's, empty periods kept with n 0), headline: {nps: {period, label, score, n} | null, csat: {period, label, satisfiedPct, n} | null} (the latest period with enough responses), undated (responses with no readable day: in the totals, in no period), offScale (scores off their kind's scale, saved before Phase 8: left out of every number), tags: {tag, n, promoters, detractors, satisfied, dissatisfied (CSAT 1-2), unhappy (detractors + dissatisfied), nps, csat}[] (over every response, most unhappy first)}. Example rows are left out.`,
  paramsSchema: listParams,
  handler: (params) => listState(browserStore, params),
  mcpHandler: (params, ctx) => listState(serverStore(ctx.userId), params),
});

/* ── record ─────────────────────────────────────────────────────────── */

const recordParams = z.object({
  kind: z.enum(["nps", "csat"]),
  score: z
    .number()
    .describe("A whole number on the kind's scale: NPS 0-10, CSAT 1-5 (4-5 counts as satisfied)."),
  respondent: z.string().optional(),
  verbatim: z.string().optional(),
  tags: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe(
      `Theme tags on the verbatim, a list or one comma-separated string; stored lower-case and once each, at most ${NPS_TAG_LIMIT} of up to ${NPS_TAG_MAX_LENGTH} characters.`
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
    .refine((d) => isIsoDate(d), "Not a day on the calendar")
    .optional()
    .describe(
      "YYYY-MM-DD, the day the answer was given (backdate freely; never a future day). Default today: over MCP the server's (UTC) day, and the day after it is still taken, as the user's day may be ahead."
    ),
});

type RecordParams = z.infer<typeof recordParams>;

/**
 * The latest day a response may be dated. In the browser, today; on the
 * server, whose day (UTC on a typical deploy) isn't the user's, the day
 * after it, so a user ahead of UTC can log an answer from their own today.
 */
const latestDay = (today: string, onServer: boolean) => (onServer ? addDays(today, 1) : today);

type RecordResult =
  | { added: true; id: string; date: string; tags: string[] }
  | { added: false; reason: "off_scale" | "future_day" | "tags"; message: string };

async function record(store: NpsStore, p: RecordParams, onServer: boolean): Promise<RecordResult> {
  if (!isValidScore(p.kind, p.score)) {
    const { min, max } = SCORE_RANGE[p.kind];
    return {
      added: false,
      reason: "off_scale",
      message: `${p.kind === "nps" ? "An NPS" : "A CSAT"} score is a whole number from ${min} to ${max}.`,
    };
  }
  const today = todayLocalISO();
  const date = p.date ?? today;
  if (date > latestDay(today, onServer)) {
    return {
      added: false,
      reason: "future_day",
      message: `${date} is in the future; a response is dated the day it was given.`,
    };
  }
  const problem = p.tags === undefined ? null : tagsProblem(p.tags);
  if (problem) return { added: false, reason: "tags", message: problem };
  const tags = p.tags === undefined ? [] : normalizeTags(p.tags);
  const entry: NpsResponse = {
    id: `nps_${nanoid(8)}`,
    kind: p.kind,
    score: p.score,
    date,
    ...(p.respondent?.trim() ? { respondent: p.respondent.trim() } : {}),
    ...(p.verbatim?.trim() ? { verbatim: p.verbatim.trim() } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
  await store.put(entry);
  return { added: true, id: entry.id, date, tags };
}

registry.register({
  id: "tool.nps_csat.record",
  toolId: "tool.nps_csat",
  name: "record",
  category: "write",
  requiresConfirmation: false,
  description: `Record one survey response. Params: {kind: 'nps' (score a whole number 0-10) | 'csat' (1-5), score, respondent?, verbatim?, tags? (a list or a comma-separated string; at most ${NPS_TAG_LIMIT} of up to ${NPS_TAG_MAX_LENGTH} characters), date? (YYYY-MM-DD; default today; never a future day; over MCP the day after the server's is taken too)}. Returns {added: true, id, date, tags (as stored: lower-case, once each)} or {added: false, reason: 'off_scale' | 'future_day' | 'tags', message}.`,
  paramsSchema: recordParams,
  handler: (params) => record(browserStore, params, false),
  mcpHandler: (params, ctx) => record(serverStore(ctx.userId), params, true),
});
