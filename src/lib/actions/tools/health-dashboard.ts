/**
 * Team Health Dashboard — tool-local actions.
 *
 * Category: Team Health & Maturity — a cross-tool aggregator. It has NO state
 * of its own; the client reads each tool's localStorage, but for the agent we
 * compute from the SYNCED workspace entities (the authoritative source of
 * truth post-migration), so the summary stays correct even where a tool's
 * old localStorage blob is stale.
 *
 * Agent surface: tool.health_dashboard.*
 *   1. get_summary — read-only KPI roll-up + risk flags. No persistence.
 *
 * Pure read: aggregates sprints/stories/impediments/risks/okrs/healthChecks.
 * Velocity/predictability is derived from the synced sprints' planned vs
 * completed points (no separate velocity entity exists).
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities } from "../server-store";
import type {
  Sprint,
  Story,
  Impediment,
  Risk,
  Okr,
  HealthCheck,
} from "@/lib/stores/workspace-types";

interface DashboardInput {
  sprints: Sprint[];
  stories: Story[];
  impediments: Impediment[];
  risks: Risk[];
  okrs: Okr[];
  healthChecks: HealthCheck[];
}

const HEALTH_CHECK_ID = "healthCheck:current";
const LIGHT_SCORE: Record<string, number> = { green: 2, yellow: 1, red: 0 };

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

function buildSummary(d: DashboardInput) {
  // ── Sprints + predictability (planned vs completed points) ──
  const completedSprints = d.sprints.filter((s) => s.status === "completed");
  const predictable = completedSprints.filter(
    (s) => (s.pointsCompleted ?? 0) >= s.pointsPlanned
  ).length;
  const sprints = {
    total: d.sprints.length,
    active: d.sprints.filter((s) => s.status === "active").length,
    completed: completedSprints.length,
    predictability: completedSprints.length > 0 ? pct(predictable, completedSprints.length) : null,
  };

  // ── Stories ──
  const done = d.stories.filter((s) => s.status === "done").length;
  const stories = {
    total: d.stories.length,
    done,
    inProgress: d.stories.filter((s) => s.status === "in_progress").length,
    completionPct: pct(done, d.stories.length),
  };

  // ── Impediments (open = unresolved) ──
  const openImps = d.impediments.filter((i) => !i.resolvedAt);
  const impediments = {
    total: d.impediments.length,
    open: openImps.length,
    critical: openImps.filter((i) => i.severity === "critical").length,
  };

  // ── Risks (open = open|mitigating; exposure = probability * impact) ──
  const openRisks = d.risks.filter((r) => r.status === "open" || r.status === "mitigating");
  const risks = {
    total: d.risks.length,
    open: openRisks.length,
    high: openRisks.filter((r) => r.probability * r.impact >= 15).length,
  };

  // ── OKRs (mean key-result attainment) ──
  let krCount = 0;
  let krSum = 0;
  for (const o of d.okrs) {
    for (const kr of o.keyResults) {
      krCount += 1;
      krSum += kr.target > 0 ? Math.max(0, Math.min(1, kr.current / kr.target)) : 0;
    }
  }
  const okrs = {
    total: d.okrs.length,
    avgProgress: krCount > 0 ? Math.round((krSum / krCount) * 100) : null,
  };

  // ── Team health (latest squad health check; weighted green/yellow/red) ──
  const hc = d.healthChecks.find((h) => h.id === HEALTH_CHECK_ID) ?? d.healthChecks[0];
  let healthPct: number | null = null;
  if (hc) {
    const scores = Object.values(hc.current?.scores ?? {});
    if (scores.length > 0) {
      const total = scores.reduce((sum, s) => sum + (LIGHT_SCORE[s.light] ?? 0), 0);
      healthPct = Math.round((total / (scores.length * 2)) * 100);
    }
  }

  // ── Triage flags ──
  const flags: string[] = [];
  if (impediments.critical > 0) flags.push("critical_impediments_open");
  if (risks.high > 0) flags.push("high_risks_open");
  if (stories.total > 0 && stories.completionPct !== null && stories.completionPct < 50)
    flags.push("low_story_completion");
  if (sprints.predictability !== null && sprints.predictability < 70)
    flags.push("low_predictability");
  if (healthPct !== null && healthPct < 60) flags.push("low_team_health");

  return {
    sprints,
    stories,
    impediments,
    risks,
    okrs,
    healthCheck: { exists: hc !== undefined, healthPct },
    flags,
  };
}

// ──────── tool.health_dashboard.get_summary ────────
registry.register({
  id: "tool.health_dashboard.get_summary",
  toolId: "tool.health_dashboard",
  name: "get_summary",
  category: "read",
  description:
    "Cross-tool health roll-up computed from the synced workspace entities. Returns {sprints: {total, active, completed, predictability% (completed sprints hitting their planned points)}, stories: {total, done, inProgress, completionPct}, impediments: {total, open, critical}, risks: {total, open, high (exposure >= 15)}, okrs: {total, avgProgress% (mean key-result attainment)}, healthCheck: {exists, healthPct}, flags: string[] (e.g. critical_impediments_open, high_risks_open, low_predictability, low_story_completion, low_team_health)}.",
  paramsSchema: z.object({}),
  handler: async () => {
    const s = useWorkspaceStore.getState();
    return buildSummary({
      sprints: s.sprints ?? [],
      stories: s.stories ?? [],
      impediments: s.impediments ?? [],
      risks: s.risks ?? [],
      okrs: s.okrs ?? [],
      healthChecks: s.healthChecks ?? [],
    });
  },
  mcpHandler: async (_params, ctx) => {
    const [sprints, stories, impediments, risks, okrs, healthChecks] = await Promise.all([
      serverListEntities<Sprint>(ctx.userId, "workspace:sprint"),
      serverListEntities<Story>(ctx.userId, "workspace:story"),
      serverListEntities<Impediment>(ctx.userId, "workspace:impediment"),
      serverListEntities<Risk>(ctx.userId, "workspace:risk"),
      serverListEntities<Okr>(ctx.userId, "workspace:okr"),
      serverListEntities<HealthCheck>(ctx.userId, "workspace:healthCheck"),
    ]);
    return buildSummary({ sprints, stories, impediments, risks, okrs, healthChecks });
  },
});
