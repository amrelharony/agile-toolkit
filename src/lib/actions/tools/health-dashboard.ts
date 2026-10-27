/**
 * Team Health Dashboard — tool-local actions.
 *
 * Category: Track delivery — a cross-tool roll-up. Its only state is the
 * team's settings (thresholds and windows, the workspace singleton
 * `healthDashboards` / HEALTH_DASHBOARD_ID); every number is worked out
 * from the synced entities by lib/health-dashboard, the same functions the
 * page runs, so the agent and the page agree.
 *
 * Agent surface: tool.health_dashboard.*
 *   1. get_summary     — the six KPIs with their lights under the team's
 *                        thresholds, the overall score and the verdict,
 *                        plus the older sprint, story, impediment, risk,
 *                        OKR and health-check roll-ups and triage flags.
 *   2. set_thresholds  — change the thresholds and windows, checked as the
 *                        page's form checks them.
 *
 * Example rows (`example-` ids) never count. Risks are read as the Risk
 * Register lists them (./risk-register's store), so the old register
 * page's rows still waiting for its one-time move count too.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  HEALTH_DASHBOARD_ID,
  KANBAN_BOARD_ID,
  type AsyncUpdate,
  type HealthCheck,
  type HealthDashboardConfig,
  type Impediment,
  type KanbanBoard,
  type Okr,
  type Risk,
  type Sprint,
  type StandupEntry,
  type Story,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { completionPct, predictability } from "@/lib/sprints/metrics";
import { impedimentSummary } from "@/lib/impediments/model";
import { overallProgress } from "@/lib/okrs/progress";
import { isActiveRisk, isHighRisk } from "@/lib/risks/model";
import {
  HEALTH_KPI_IDS,
  KPI_DEFINITIONS,
  WINDOW_KEYS,
  checkSettings,
  configFor,
  settingsInput,
  settingsOf,
  type HealthKpiId,
} from "@/lib/health-dashboard/settings";
import { dashboardKpis, overallHealth, type HealthKpi } from "@/lib/health-dashboard/kpis";
import { healthVerdict } from "@/lib/health-dashboard/verdict";
import { browserRiskStore, serverRiskStore } from "./risk-register";

const KIND_CONFIG = "workspace:healthDashboard";

const isExampleRow = (x: { id?: string } | null | undefined) =>
  typeof x?.id === "string" && x.id.startsWith("example-");

const real = <T extends { id: string }>(xs: readonly T[] | null | undefined): T[] =>
  (Array.isArray(xs) ? xs : []).filter((x) => x && typeof x === "object" && !isExampleRow(x));

interface DashboardInput {
  sprints: Sprint[];
  stories: Story[];
  impediments: Impediment[];
  risks: Risk[];
  okrs: Okr[];
  healthChecks: HealthCheck[];
  kanbanBoards: KanbanBoard[];
  standupEntries: StandupEntry[];
  asyncUpdates: AsyncUpdate[];
  config: HealthDashboardConfig | null;
}

/** Each KPI's flag when it isn't green under the team's thresholds. */
const KPI_FLAG: Record<HealthKpiId, string> = {
  predictability: "low_predictability",
  "team-health": "low_team_health",
  "open-impediments": "open_impediments_high",
  "critical-impediments": "critical_impediments_open",
  "open-blockers": "open_blockers_high",
  "cycle-time-p85": "cycle_time_high",
};

const kpiRow = (k: HealthKpi) => ({
  id: k.id,
  name: k.name,
  unit: k.unit,
  higherIsBetter: k.higherIsBetter,
  value: k.value,
  status: k.status,
  n: k.n,
  hasData: k.hasData,
  enough: k.enough,
  basis: k.basis,
  detail: k.detail ?? null,
  trend: k.trend ?? null,
  threshold: k.threshold,
  source: k.source.href,
  ...(k.olderOpen !== undefined ? { olderOpen: k.olderOpen } : {}),
});

function buildSummary(d: DashboardInput) {
  const today = todayLocalISO();
  const settings = settingsOf(d.config);
  const kpis = dashboardKpis({
    sprints: d.sprints,
    stories: d.stories,
    kanbanBoards: d.kanbanBoards,
    healthChecks: d.healthChecks,
    impediments: d.impediments,
    standupEntries: d.standupEntries,
    asyncUpdates: d.asyncUpdates,
    config: d.config,
    today,
  });
  const byId = new Map(kpis.map((k) => [k.id, k]));
  const overall = overallHealth(kpis);

  // ── The older roll-ups, kept for agents that read them; examples left out ──
  const sprintList = real(d.sprints);
  const p = predictability(sprintList, { window: settings.windows.sprintWindow });
  const sprints = {
    total: sprintList.length,
    active: sprintList.filter((s) => s.status === "active").length,
    completed: sprintList.filter((s) => s.status === "completed").length,
    // The page's predictability, before the minimum sample: kpis says whether it may be quoted.
    predictability: p.pct,
  };

  const storyList = real(d.stories);
  const done = storyList.filter((s) => s.status === "done").length;
  const stories = {
    total: storyList.length,
    done,
    inProgress: storyList.filter((s) => s.status === "in_progress").length,
    completionPct: completionPct(done, storyList.length),
  };

  const impList = real(d.impediments);
  const imp = impedimentSummary(impList, today);
  const impediments = {
    total: impList.length,
    open: imp.open + imp.escalated,
    critical: imp.critical,
    overdue: imp.overdue,
  };

  const riskList = real(d.risks);
  const openRisks = riskList.filter(isActiveRisk);
  const risks = {
    total: riskList.length,
    open: openRisks.length,
    // The register's one meaning of high: rated high or critical (lib/risks).
    high: openRisks.filter(isHighRisk).length,
  };

  // The OKR page's overall progress (lib/okrs: baseline → target, per
  // objective), so the dashboard and the page agree.
  const okrList = real(d.okrs).filter((o) => Array.isArray(o.keyResults));
  const withKrs = okrList.filter((o) => o.keyResults.length > 0);
  const okrs = {
    total: okrList.length,
    avgProgress: withKrs.length > 0 ? Math.round(overallProgress(withKrs) * 100) : null,
  };

  const team = byId.get("team-health");
  const healthCheck = {
    exists: d.healthChecks.length > 0,
    // The latest SAVED check, as the page reads it (never the draft in progress).
    healthPct: team?.value ?? null,
  };

  const flags: string[] = [];
  for (const k of kpis) if (k.status === "red" || k.status === "amber") flags.push(KPI_FLAG[k.id]);
  if (risks.high > 0) flags.push("high_risks_open");
  if (stories.completionPct !== null && stories.completionPct < 50)
    flags.push("low_story_completion");

  return {
    sprints,
    stories,
    impediments,
    risks,
    okrs,
    healthCheck,
    flags,
    kpis: kpis.map(kpiRow),
    overall,
    verdict: healthVerdict(kpis),
    thresholds: settings.thresholds,
    windows: settings.windows,
  };
}

// ──────── tool.health_dashboard.get_summary ────────
registry.register({
  id: "tool.health_dashboard.get_summary",
  toolId: "tool.health_dashboard",
  name: "get_summary",
  category: "read",
  description:
    "The team dashboard as the page shows it, from the synced workspace (example- rows left out). Returns {kpis: [{id (predictability | team-health | open-impediments | critical-impediments | open-blockers | cycle-time-p85), name, unit (percent|count|days), higherIsBetter, value (null without data or below the minimum sample), status (green|amber|red, null without a value), n, hasData, enough, basis (where it comes from), detail, trend (up|down|same, null with nothing to compare: team health against the check before; predictability by a Mann-Kendall test over every pointed sprint, from 6 of them, \"same\" until it confirms a direction), threshold {green, amber}, source (the tool's path), olderOpen (blockers only)}], overall {score (% of the lit KPIs' lights, green 100 / amber 50 / red 0), status, counted, total}, verdict (one sentence), thresholds {kpiId: {green, amber}}, windows {sprintWindow, blockerWindowDays, cycleWindowDays}, sprints {total, active, completed, predictability (% of the latest pointed sprints that met their commitment, 90–110%)}, stories {total, done, inProgress, completionPct}, impediments {total, open (incl. escalated), critical, overdue}, risks {total, open, high (active and rated high or critical: probability × impact >= 10, the Risk Register's bands)} (the risks the Risk Register lists, rows of the old register page not moved in yet included), okrs {total, avgProgress}, healthCheck {exists, healthPct (latest saved check: green 1, yellow ½, red 0)}, flags: one per KPI that isn't green (low_predictability, low_team_health, open_impediments_high, critical_impediments_open, open_blockers_high, cycle_time_high), plus high_risks_open and low_story_completion}.",
  paramsSchema: z.object({}),
  handler: async () => {
    const s = useWorkspaceStore.getState();
    return buildSummary({
      sprints: s.sprints ?? [],
      stories: s.stories ?? [],
      impediments: s.impediments ?? [],
      risks: (await browserRiskStore.list()).records,
      okrs: s.okrs ?? [],
      healthChecks: s.healthChecks ?? [],
      kanbanBoards: s.kanbanBoards ?? [],
      standupEntries: s.standupEntries ?? [],
      asyncUpdates: s.asyncUpdates ?? [],
      config: (s.healthDashboards ?? []).find((c) => c.id === HEALTH_DASHBOARD_ID) ?? null,
    });
  },
  mcpHandler: async (_params, ctx) => {
    const u = ctx.userId;
    const [
      sprints,
      stories,
      impediments,
      risks,
      okrs,
      healthChecks,
      board,
      standupEntries,
      asyncUpdates,
      config,
    ] = await Promise.all([
      serverListEntities<Sprint>(u, "workspace:sprint"),
      serverListEntities<Story>(u, "workspace:story"),
      serverListEntities<Impediment>(u, "workspace:impediment"),
      serverRiskStore(u)
        .list()
        .then((r) => r.records),
      serverListEntities<Okr>(u, "workspace:okr"),
      serverListEntities<HealthCheck>(u, "workspace:healthCheck"),
      serverGetEntity<KanbanBoard>(u, "workspace:kanbanBoard", KANBAN_BOARD_ID),
      serverListEntities<StandupEntry>(u, "workspace:standupEntry"),
      serverListEntities<AsyncUpdate>(u, "workspace:asyncUpdate"),
      serverGetEntity<HealthDashboardConfig>(u, KIND_CONFIG, HEALTH_DASHBOARD_ID),
    ]);
    return buildSummary({
      sprints,
      stories,
      impediments,
      risks,
      okrs,
      healthChecks,
      kanbanBoards: board ? [board] : [],
      standupEntries,
      asyncUpdates,
      config: config ?? null,
    });
  },
});

// ──────── tool.health_dashboard.set_thresholds ────────

const ThresholdSchema = z.object({
  green: z.number().optional(),
  amber: z.number().optional(),
});

const SetParams = z.object({
  thresholds: z
    .object(
      Object.fromEntries(HEALTH_KPI_IDS.map((id) => [id, ThresholdSchema.optional()])) as Record<
        HealthKpiId,
        z.ZodOptional<typeof ThresholdSchema>
      >
    )
    .optional()
    .describe(
      "Per KPI id, the limits to change: {green?, amber?}. Higher-is-better KPIs (predictability, team-health: percentages 0–100): green from `green`, amber from `amber`, so green >= amber. Lower-is-better (open-impediments, critical-impediments, open-blockers: whole counts; cycle-time-p85: whole days >= 1): green up to `green`, amber up to `amber`, so green <= amber."
    ),
  sprintWindow: z.number().optional().describe("Pointed sprints predictability reads (1–26)."),
  blockerWindowDays: z.number().optional().describe("Days a standup blocker stays recent (1–90)."),
  cycleWindowDays: z
    .number()
    .optional()
    .describe("Days of finished work cycle time reads (1–1000)."),
  reset: z
    .boolean()
    .optional()
    .describe("true: back to the defaults first (then any values given apply)."),
});

type SetInput = z.infer<typeof SetParams>;

interface ConfigStore {
  get(): Promise<HealthDashboardConfig | null>;
  put(config: HealthDashboardConfig): Promise<void>;
}

const browserConfig: ConfigStore = {
  get: async () =>
    (useWorkspaceStore.getState().healthDashboards ?? []).find(
      (c) => c.id === HEALTH_DASHBOARD_ID
    ) ?? null,
  put: async (config) => useWorkspaceStore.getState().upsertHealthDashboard(config),
};

const serverConfig = (userId: string): ConfigStore => ({
  get: async () =>
    (await serverGetEntity<HealthDashboardConfig>(userId, KIND_CONFIG, HEALTH_DASHBOARD_ID)) ??
    null,
  put: async (config) => {
    await serverUpsertEntity<HealthDashboardConfig>(userId, KIND_CONFIG, config);
  },
});

async function setThresholds(store: ConfigStore, params: SetInput) {
  const stored = await store.get();
  const input = settingsInput(settingsOf(params.reset ? null : stored));
  for (const id of HEALTH_KPI_IDS) {
    const patch = params.thresholds?.[id];
    if (!patch) continue;
    input.thresholds[id] = {
      green: patch.green ?? input.thresholds[id].green,
      amber: patch.amber ?? input.thresholds[id].amber,
    };
  }
  for (const key of WINDOW_KEYS) {
    const v = params[key];
    if (v !== undefined) input.windows[key] = v;
  }
  const checked = checkSettings(input);
  if (!checked.ok)
    return { saved: false as const, reason: "invalid" as const, errors: checked.errors };
  const config = configFor(checked.values, new Date().toISOString());
  await store.put(config);
  return {
    saved: true as const,
    thresholds: checked.values.thresholds,
    windows: checked.values.windows,
    directions: Object.fromEntries(
      HEALTH_KPI_IDS.map((id) => [id, KPI_DEFINITIONS[id].higherIsBetter ? "higher" : "lower"])
    ),
  };
}

registry.register({
  id: "tool.health_dashboard.set_thresholds",
  toolId: "tool.health_dashboard",
  name: "set_thresholds",
  category: "write",
  requiresConfirmation: false,
  description:
    'Change the dashboard\'s thresholds and windows (the team\'s settings, as on the page\'s Thresholds form). {thresholds?: {kpiId: {green?, amber?}}, sprintWindow?, blockerWindowDays?, cycleWindowDays?, reset?}. Values left out keep what is set; the whole set is checked as the page checks it (percentages 0–100, whole counts >= 0, whole days >= 1, green and amber in the KPI\'s direction, windows in range) and nothing is saved on an error. Only values that differ from the defaults are stored. Returns {saved: true, thresholds, windows, directions} or {saved: false, reason: "invalid", errors: {"<kpiId>.green" | "<kpiId>.amber" | window: message}}.',
  paramsSchema: SetParams,
  handler: async (params) => setThresholds(browserConfig, params),
  mcpHandler: async (params, ctx) => setThresholds(serverConfig(ctx.userId), params),
});
