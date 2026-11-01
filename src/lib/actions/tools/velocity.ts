/**
 * Velocity Tracker — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.velocity.*
 *
 * Read/compute over the SYNCED sprint entity (workspace.sprint.*), so an
 * agent that creates sprints via workspace.sprint.create can immediately
 * compute the numbers the Velocity page shows. The page's numbers come from
 * the shared libs and so do these: `velocity` is lib/sprints/metrics
 * velocity() (the last 3 finished sprints by END date), `sayDo` its graded
 * predictability() (90–110% = met, window 6) and `perPersonDay` lib/sprints/
 * capacity velocityPerPersonDay() over the sprints' own capacity plans.
 *
 * The older fields stay for callers that read them, now over the finished
 * sprints in end-date order (they used to follow store order): `average`
 * (every finished sprint), `rollingAverage` (last 3), `trend` (Mann-Kendall),
 * `predictability` (a CV-based CONSISTENCY score, not the page's say/do),
 * `commitmentReliability` (% that met or beat the commitment, pass/fail) and
 * `forecastNext` (Holt). Callers may pass an explicit `velocities` array to
 * compute ad-hoc (a what-if) without reading the workspace; it carries no
 * commitment or capacity, so those come back null.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities } from "../server-store";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { mannKendall } from "@/lib/analytics/trend-test";
import {
  DEFAULT_PREDICTABILITY_WINDOW,
  DEFAULT_VELOCITY_WINDOW,
  predictability,
  sprintsByEndDate,
  velocity,
  type SayDoGrade,
} from "@/lib/sprints/metrics";
import { velocityPerPersonDay, type PerPersonDay } from "@/lib/sprints/capacity";
import type { CapacityPlan, Sprint } from "@/lib/stores/workspace-types";

const KIND_SPRINT = "workspace:sprint";
/** MUST match registerCollection("capacityPlan", …) in workspace-store.ts. */
const KIND_CAPACITY = "workspace:capacityPlan";

const round1 = (n: number) => Math.round(n * 10) / 10;

const isFinished = (s: Sprint) =>
  s.status === "completed" &&
  typeof s.pointsCompleted === "number" &&
  Number.isFinite(s.pointsCompleted);

/** Finished sprints → parallel velocity + committed series, oldest first by end date. */
function seriesFrom(sprints: Sprint[]): { velocities: number[]; committed: number[] } {
  const done = sprintsByEndDate(sprints.filter(isFinished));
  return {
    velocities: done.map((s) => s.pointsCompleted ?? 0),
    committed: done.map((s) => (Number.isFinite(s.pointsPlanned) ? s.pointsPlanned : 0)),
  };
}

/** Commitment reliability — % of (non-empty) sprints that met or beat their
 *  commitment (pass/fail; the graded say/do is `sayDo`). Null when there is
 *  no commitment data to compare against (an explicit `velocities` array). */
function reliabilityOf(velocities: number[], committed: number[] | null): number | null {
  if (!committed || committed.length !== velocities.length) return null;
  let considered = 0;
  let met = 0;
  for (let i = 0; i < velocities.length; i++) {
    // Skip empty rows (no commitment AND no delivery).
    if (committed[i] <= 0 && velocities[i] <= 0) continue;
    considered++;
    if (velocities[i] >= committed[i]) met++;
  }
  return considered > 0 ? Math.round((met / considered) * 100) : 0;
}

function computeMetrics(velocities: number[], committed: number[] | null) {
  const n = velocities.length;
  const commitmentReliability = reliabilityOf(velocities, committed);
  if (n === 0) {
    return {
      count: 0,
      average: 0,
      rollingAverage: 0,
      trend: "none" as const,
      trendSignificant: false,
      predictability: 0,
      commitmentReliability,
      forecastNext: null as null | { yHat: number; lower80: number; upper80: number },
      velocities,
    };
  }
  const sum = velocities.reduce((a, b) => a + b, 0);
  const average = sum / n;
  const last3 = velocities.slice(-3);
  const rollingAverage = last3.reduce((a, b) => a + b, 0) / last3.length;
  const variance = velocities.reduce((a, v) => a + (v - average) ** 2, 0) / n;
  const cv = average > 0 ? Math.sqrt(variance) / average : 0;
  // Velocity consistency: 100 = perfectly steady; lower = noisier.
  // Coefficient-of-variation based, clamped to [0, 100].
  const consistency = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));
  const mk = mannKendall(velocities); // needs ≥5 points, else trend "none"
  const fc = forecastBayesianHolt(velocities, 1);
  const forecastNext = fc.length
    ? { yHat: round1(fc[0].yHat), lower80: round1(fc[0].lower80), upper80: round1(fc[0].upper80) }
    : null;
  return {
    count: n,
    average: round1(average),
    rollingAverage: round1(rollingAverage),
    trend: mk.trend,
    trendSignificant: mk.significant,
    predictability: consistency,
    commitmentReliability,
    forecastNext,
    velocities,
  };
}

interface SayDoOut {
  perSprint: {
    sprintId: string;
    name: string;
    committed: number;
    completed: number;
    pct: number;
    grade: SayDoGrade;
  }[];
  met: number;
  close: number;
  missed: number;
  over: number;
  considered: number;
  /** % of them that met it (90–110%); null with none. */
  metPct: number | null;
  meanPct: number | null;
  window: number;
}

/** The page's numbers, from the shared libs (see the file comment). */
function sharedNumbers(sprints: Sprint[], plans: CapacityPlan[]) {
  const v = velocity(sprints, { window: DEFAULT_VELOCITY_WINDOW });
  const p = predictability(sprints, { window: DEFAULT_PREDICTABILITY_WINDOW });
  const byId = new Map(sprints.map((s) => [s.id, s]));
  const sayDo: SayDoOut = {
    perSprint: p.sprints.map((s) => ({
      sprintId: s.sprintId,
      name: s.name,
      committed: byId.get(s.sprintId)?.pointsPlanned ?? 0,
      completed: byId.get(s.sprintId)?.pointsCompleted ?? 0,
      pct: s.pct,
      grade: s.grade,
    })),
    ...p.byGrade,
    considered: p.count,
    metPct: p.pct,
    meanPct: p.meanSayDoPct,
    window: DEFAULT_PREDICTABILITY_WINDOW,
  };
  const pd = velocityPerPersonDay(sprints, plans, { window: DEFAULT_VELOCITY_WINDOW });
  return {
    velocity: {
      average: v.average,
      count: v.count,
      window: DEFAULT_VELOCITY_WINDOW,
      sprintIds: v.sprintIds,
    },
    sayDo: sayDo as SayDoOut | null,
    perPersonDay: pd as { average: number | null; count: number; perSprint: PerPersonDay[] } | null,
  };
}

/** For an explicit array: the shared velocity over it (oldest first), no say/do or capacity. */
function sharedFromArray(velocities: number[]) {
  const sprints: Sprint[] = velocities.map((p, i) => ({
    id: `v${i + 1}`,
    name: `Sprint ${i + 1}`,
    startDate: "",
    endDate: "",
    pointsPlanned: 0,
    pointsCompleted: p,
    status: "completed",
  }));
  const v = velocity(sprints, { window: DEFAULT_VELOCITY_WINDOW });
  return {
    velocity: {
      average: v.average,
      count: v.count,
      window: DEFAULT_VELOCITY_WINDOW,
      sprintIds: [] as string[],
    },
    sayDo: null,
    perPersonDay: null,
  };
}

function compute(sprints: Sprint[], plans: CapacityPlan[]) {
  const { velocities, committed } = seriesFrom(sprints);
  return { ...computeMetrics(velocities, committed), ...sharedNumbers(sprints, plans) };
}

const paramsSchema = z.object({
  velocities: z
    .array(z.number())
    .optional()
    .describe(
      "Explicit per-sprint completed points (oldest→newest) to compute on. Omit to use the finished sprints from the workspace."
    ),
});

// ──────── tool.velocity.compute ────────
registry.register({
  id: "tool.velocity.compute",
  toolId: "tool.velocity",
  name: "compute",
  category: "read",
  description:
    "Velocity as the Velocity page shows it, from the workspace's finished sprints (status completed with pointsCompleted), oldest first by END date — or from an explicit `velocities` array. Params: {velocities?: number[]}. Returns the page's numbers: velocity {average (mean completed points of the last 3 finished sprints by end date; null with none), count, window: 3, sprintIds}; sayDo {perSprint: {sprintId, name, committed, completed, pct, grade: met (90–110%) | close (70–90%) | missed (<70%) | over (>110%)}[], met, close, missed, over, considered, metPct, meanPct, window: 6} over the latest 6 pointed sprints (null for an explicit array); perPersonDay {average (Σ points ÷ Σ available person-days over the last 3 finished sprints that have their own capacity plan, 2 dp; null with none), count, perSprint: {sprintId, points, personDays, perDay}[]} (null for an explicit array). Also the older fields: count, average (every finished sprint), rollingAverage (last 3), trend (up/down/none, Mann-Kendall), trendSignificant, predictability (0-100 velocity CONSISTENCY, coefficient-of-variation based — not the page's say/do), commitmentReliability (0-100, % that met or beat the commitment, pass/fail; null for an explicit array), forecastNext {yHat, lower80, upper80} | null, velocities. Quote averages from 3 sprints, spread from 5, a forecast from 4 and a trend from 6 (MIN_SAMPLE). Read only.",
  paramsSchema,
  handler: async (params) => {
    if (params.velocities) {
      return { ...computeMetrics(params.velocities, null), ...sharedFromArray(params.velocities) };
    }
    const ws = useWorkspaceStore.getState();
    return compute(ws.sprints ?? [], ws.capacityPlans ?? []);
  },
  mcpHandler: async (params, ctx) => {
    if (params.velocities) {
      return { ...computeMetrics(params.velocities, null), ...sharedFromArray(params.velocities) };
    }
    const [sprints, plans] = await Promise.all([
      serverListEntities<Sprint>(ctx.userId, KIND_SPRINT),
      serverListEntities<CapacityPlan>(ctx.userId, KIND_CAPACITY),
    ]);
    return compute(sprints, plans);
  },
});
