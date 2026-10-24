/**
 * Sprint Metrics — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.sprint_metrics.*
 *
 *   1. trend — the page's cross-sprint trend: per finished sprint the
 *              committed and completed points, the graded say/do, the
 *              carry-over and the scope churn, with the window's totals.
 *              The same lib/sprints/trends sprintTrends() the page runs,
 *              over the same rows (sprints, their stories' sprint moves,
 *              the daily logs), so the numbers match.
 *
 * Read only: sprints are created and closed through workspace.sprint.*
 * and the cockpit.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities } from "../server-store";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import {
  DEFAULT_TREND_WINDOW,
  sprintTrends,
  trendTests,
  type SprintTrendSummary,
} from "@/lib/sprints/trends";

/** MUST match the registerCollection(...) names in workspace-store.ts. */
const KIND = {
  sprint: "workspace:sprint",
  series: "workspace:sprintSeries",
  story: "workspace:story",
} as const;

interface TrendRows {
  sprints: Sprint[];
  stories: Story[];
  series: SprintSeries[];
}

const browserRows = async (): Promise<TrendRows> => {
  const ws = useWorkspaceStore.getState();
  return { sprints: ws.sprints ?? [], stories: ws.stories ?? [], series: ws.sprintSeries ?? [] };
};

const serverRows = async (userId: string): Promise<TrendRows> => {
  const [sprints, stories, series] = await Promise.all([
    serverListEntities<Sprint>(userId, KIND.sprint),
    serverListEntities<Story>(userId, KIND.story),
    serverListEntities<SprintSeries>(userId, KIND.series),
  ]);
  return { sprints, stories, series };
};

/** The summary with each sprint reduced to what identifies it, plus the drift tests. */
function serialize(summary: SprintTrendSummary) {
  const tests = trendTests(summary);
  const mk = (t: (typeof tests)["sayDo"]) =>
    t
      ? { trend: t.trend, significant: t.significant, pValue: Math.round(t.pValue * 1000) / 1000 }
      : null;
  return {
    ...summary,
    rows: summary.rows.map((r) => ({
      ...r,
      sprint: {
        id: r.sprint.id,
        name: r.sprint.name,
        startDate: r.sprint.startDate,
        endDate: r.sprint.endDate,
      },
    })),
    trends: { sayDo: mk(tests.sayDo), churn: mk(tests.churn) },
  };
}

function trend(rows: TrendRows, window: number | "all" | undefined) {
  return serialize(
    sprintTrends({
      sprints: rows.sprints,
      stories: rows.stories,
      series: rows.series,
      window: window === "all" ? null : (window ?? DEFAULT_TREND_WINDOW),
    })
  );
}

const paramsSchema = z.object({
  window: z
    .union([z.number().int().min(1).max(1000), z.literal("all")])
    .optional()
    .describe('How many of the latest finished sprints to look at (default 6), or "all".'),
});

// ──────── tool.sprint_metrics.trend ────────
registry.register({
  id: "tool.sprint_metrics.trend",
  toolId: "tool.sprint_metrics",
  name: "trend",
  category: "read",
  description:
    "Sprint Metrics' cross-sprint trend, as the page shows it. Params: {window?: number (1–1000, default 6) | \"all\"}. Returns {rows: {sprint: {id, name, startDate, endDate}, committed, completed, sayDo: {ratio, pct, grade: met (90–110%) | close (70–90%) | missed (<70%) | over (>110%), score} | null (no commitment), carryOver: {count (stories; null when only the numbers say), points, pct (of the commitment), source: history (the stories' sprint moves: carried at the close or moved out after the last day, plus stories still open) | stories (the stories left in the sprint) | numbers (committed − completed) | none}, scope: {added, removed (points that joined or left after day 0, carry-overs excluded), net, churnPct ((added + removed) ÷ committed; null without a commitment or a record), source: history | log (the daily log's scope readings) | none}}[] (finished sprints — completed with points — oldest first by end date, example sprints left out), window (null for all), finishedCount, sayDo {considered, met, close, missed, over, meanPct}, carryOver {meanPoints, count}, churn {meanPct, count} (means are null below 3 sprints), trends {sayDo, churn: {trend: up|down|none, significant, pValue} | null (Mann-Kendall, from 6 sprints)}}. Read only.",
  paramsSchema,
  handler: async (params) => trend(await browserRows(), params.window),
  mcpHandler: async (params, ctx) => trend(await serverRows(ctx.userId), params.window),
});
