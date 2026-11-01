/**
 * Sprint Comparison — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.sprint_compare.*
 *
 *   1. list_state — the page's six scores for each compared sprint, from
 *                   lib/sprints/compare sprintScores() over the same
 *                   workspace rows: Velocity, Scope Stability, Goal
 *                   Achievement and Predictability computed; Team Happiness
 *                   and Quality prefilled from Mood Tracker and the Squad
 *                   Health Check unless the team typed a rating
 *                   (SprintSeries.ratings, via workspace.sprint_series.*).
 *   2. compute    — pure: compare sprints scored by the caller.
 *
 * Which sprints the page compares is a per-browser choice (its pins), so
 * list_state takes the ids to score and defaults to what the page compares
 * when nothing is pinned (lib/sprints/compare defaultComparedIds): the
 * five newest finished sprints, else the three newest sprints.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities } from "../server-store";
import type {
  HealthCheck,
  MoodEntry,
  MoodPulse,
  Sprint,
  SprintGoal,
  SprintSeries,
  Story,
} from "@/lib/stores/workspace-types";
import { MOOD_PULSE_KIND } from "@/lib/stores/workspace-types";
import {
  averageScore,
  defaultComparedIds,
  isFinishedSprint,
  sprintScores,
  type SprintScores,
} from "@/lib/sprints/compare";
import { isExampleSprintId } from "@/lib/sprints/example";
import { sprintsByEndDate } from "@/lib/sprints/metrics";
import { SPRINT_RATING_DIMENSIONS, sprintsNewestFirst } from "@/lib/sprints/series";

/** MUST match the registerCollection(...) names in workspace-store.ts. */
const KIND = {
  sprint: "workspace:sprint",
  series: "workspace:sprintSeries",
  story: "workspace:story",
  goal: "workspace:sprintGoal",
  mood: "workspace:moodEntry",
  health: "workspace:healthCheck",
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface CompareRows {
  sprints: Sprint[];
  series: SprintSeries[];
  stories: Story[];
  goals: SprintGoal[];
  moodEntries: MoodEntry[];
  moodPulses: MoodPulse[];
  healthChecks: HealthCheck[];
}

const browserRows = async (): Promise<CompareRows> => {
  const ws = useWorkspaceStore.getState();
  return {
    sprints: ws.sprints ?? [],
    series: ws.sprintSeries ?? [],
    stories: ws.stories ?? [],
    goals: ws.sprintGoals ?? [],
    moodEntries: ws.moodEntries ?? [],
    moodPulses: ws.moodPulses ?? [],
    healthChecks: ws.healthChecks ?? [],
  };
};

const serverRows = async (userId: string): Promise<CompareRows> => {
  const [sprints, series, stories, goals, moodEntries, moodPulses, healthChecks] =
    await Promise.all([
      serverListEntities<Sprint>(userId, KIND.sprint),
      serverListEntities<SprintSeries>(userId, KIND.series),
      serverListEntities<Story>(userId, KIND.story),
      serverListEntities<SprintGoal>(userId, KIND.goal),
      serverListEntities<MoodEntry>(userId, KIND.mood),
      serverListEntities<MoodPulse>(userId, MOOD_PULSE_KIND),
      serverListEntities<HealthCheck>(userId, KIND.health),
    ]);
  return { sprints, series, stories, goals, moodEntries, moodPulses, healthChecks };
};

function serializeScores(scores: SprintScores) {
  return Object.fromEntries(
    SPRINT_RATING_DIMENSIONS.map((d) => {
      const s = scores[d];
      return [
        d,
        {
          value: s.value,
          source: s.source,
          ...(s.from ? { from: s.from } : {}),
          basis: s.basis,
          editable: s.editable,
          ...(s.typed !== undefined ? { typed: s.typed } : {}),
          ...(s.missing ? { missing: s.missing } : {}),
        },
      ];
    })
  );
}

function listState(rows: CompareRows, sprintIds: string[] | undefined) {
  const sprints = rows.sprints.filter((s) => !isExampleSprintId(s.id));
  const byId = new Map(sprints.map((s) => [s.id, s]));
  // The page's default comparison, oldest first by end date as velocity reads them.
  const defaults = (): string[] => {
    const picked = new Set(defaultComparedIds(sprintsNewestFirst(sprints), isFinishedSprint));
    return sprintsByEndDate(sprints.filter((s) => picked.has(s.id))).map((s) => s.id);
  };
  const ids = sprintIds?.length ? sprintIds : defaults();
  const missing = ids.filter((id) => !byId.has(id));
  const out = ids.flatMap((id) => {
    const sprint = byId.get(id);
    if (!sprint) return [];
    const scores = sprintScores({
      sprint,
      sprints,
      stories: rows.stories,
      series: rows.series,
      goals: rows.goals,
      moodEntries: rows.moodEntries,
      moodPulses: rows.moodPulses,
      healthChecks: rows.healthChecks,
    });
    return [
      {
        id: sprint.id,
        name: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        status: sprint.status,
        scores: serializeScores(scores),
        average: averageScore(scores),
      },
    ];
  });
  return { sprints: out, ...(missing.length ? { notFound: missing } : {}) };
}

// ──────── tool.sprint_compare.list_state ────────
registry.register({
  id: "tool.sprint_compare.list_state",
  toolId: "tool.sprint_compare",
  name: "list_state",
  category: "read",
  description:
    "Sprint Comparison's six scores (1–10, one decimal) for the given sprints, as the page shows them. Params: {sprintIds?: string[]} (default: what the page compares when nothing is pinned — the five newest finished sprints, else the three newest sprints — oldest first by end date). Returns {sprints: {id, name, startDate, endDate, status, scores: {[dimension]: {value (null = not scored), source: computed | prefilled | typed | none, from? (the tool it was read from), basis (how it was worked out, in words), editable (true for Team Happiness and Quality, which a typed rating overrides), typed? (the stored rating, kept even when unused), missing? (points | commitment | history | goal | scope | mood | health | dates: what the score needs)}}, average (mean of the scored dimensions; null when none)}[], notFound?: string[]}. Dimensions: Velocity (completed ÷ the team's best, from 3 finished sprints), Quality (Squad Health Check code and release lights, yellow = half), Scope Stability (1 − churn after day 0), Team Happiness (Mood Tracker check-ins during the sprint, named and anonymous pulse answers alike, from 3), Goal Achievement (met 10, partly 5.5, not met 1), Predictability (graded say/do). To rate Team Happiness or Quality, write SprintSeries.ratings[dimension] via workspace.sprint_series.update. Read only.",
  paramsSchema: z.object({
    sprintIds: z
      .array(z.string().min(1).max(128))
      .max(20)
      .optional()
      .describe(
        "Sprints to score, in order. Omit for the page's default: the five newest finished sprints, else the three newest."
      ),
  }),
  handler: async (params) => listState(await browserRows(), params.sprintIds),
  mcpHandler: async (params, ctx) => listState(await serverRows(ctx.userId), params.sprintIds),
});

const computeSchema = z.object({
  sprints: z
    .array(
      z.object({
        name: z.string(),
        dimensions: z.record(z.string(), z.number()),
      })
    )
    .min(1),
});

function compute({ sprints }: z.infer<typeof computeSchema>) {
  // Union of all dimension keys across sprints.
  const dimKeys = Array.from(new Set(sprints.flatMap((s) => Object.keys(s.dimensions))));

  const dimensions = dimKeys.map((dim) => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    let leader: string | null = null;
    for (const s of sprints) {
      const v = s.dimensions[dim];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) {
        max = v;
        leader = s.name;
      }
      sum += v;
      count += 1;
    }
    // Nobody scored it: no min, max or average, never a 0.
    return {
      dim,
      min: count ? min : null,
      max: count ? max : null,
      average: count ? round2(sum / count) : null,
      leader,
    };
  });

  const perSprint = sprints.map((s) => {
    const vals = dimKeys
      .map((d) => s.dimensions[d])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const total = vals.reduce((a, b) => a + b, 0);
    return {
      name: s.name,
      total: round2(total),
      average: vals.length ? round2(total / vals.length) : null,
    };
  });

  const overallLeader = perSprint.reduce<{ name: string; average: number } | null>(
    (best, s) =>
      s.average !== null && (best === null || s.average > best.average)
        ? { name: s.name, average: s.average }
        : best,
    null
  );

  return { dimensions, perSprint, overallLeader: overallLeader?.name ?? null };
}

// ──────── tool.sprint_compare.compute ────────
registry.register({
  id: "tool.sprint_compare.compute",
  toolId: "tool.sprint_compare",
  name: "compute",
  category: "read",
  description:
    "Compare sprints scored by the caller across shared dimensions. Params: {sprints: {name, dimensions: {[dim]: number}}[]}. Returns {dimensions: {dim, min, max, average, leader}[] (min, max and average are null and leader null for a dimension nobody scored), perSprint: {name, total, average}[] (average across its scored dimensions; null when it has none), overallLeader (the sprint with the highest average; null when none is scored)}. For the page's own scores use tool.sprint_compare.list_state. Pure.",
  paramsSchema: computeSchema,
  handler: async (params) => compute(params),
  mcpHandler: async (params) => compute(params),
});
