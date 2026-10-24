import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HEALTH_DASHBOARD_ID,
  KANBAN_BOARD_ID,
  type AsyncUpdate,
  type HealthCheck,
  type HealthCheckEntry,
  type Impediment,
  type KanbanCard,
  type Sprint,
  type StandupEntry,
  type Story,
} from "@/lib/stores/workspace-types";
import { latestSavedCheck } from "@/lib/health-check/score";
import { addDays } from "@/lib/flow";
import { todayIso } from "@/lib/sprints/series";

/**
 * Team Dashboard: six KPIs from the shared libraries (predictability over
 * pointed sprints, the latest saved health check, impediments, recent open
 * standup blockers, cycle time P85 from the Sprint and Flow boards), each
 * lit against the team's own thresholds; example rows never counted; a
 * verdict, an overall score, a Markdown report; an in-memory example; and
 * the same numbers from tool.health_dashboard.get_summary.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
// The insights band has its own tests; it reads every tool.
vi.mock("@/app/(tools)/health-dashboard/components/full-insights-panel", () => ({
  FullInsightsPanel: () => null,
}));

import "@/lib/actions/tools/health-dashboard";
import { registry } from "@/lib/actions/registry";
import { HealthDashboardClient } from "@/app/(tools)/health-dashboard/health-dashboard-client";
import { buildExample } from "@/app/(tools)/health-dashboard/example";
import { toMarkdown } from "@/app/(tools)/health-dashboard/markdown";
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WINDOWS,
  HEALTH_KPI_IDS,
  checkSettings,
  configFor,
  isDefaultSettings,
  kpiStatus,
  settingsDraft,
  settingsInput,
  settingsOf,
  validateThresholds,
} from "@/lib/health-dashboard/settings";
import {
  countBlockers,
  dashboardKpis,
  overallHealth,
  savedHealthChecks,
  type DashboardSources,
  type HealthKpi,
} from "@/lib/health-dashboard/kpis";
import { healthVerdict, kpiReading } from "@/lib/health-dashboard/verdict";

const TODAY = todayIso();
const ago = (n: number) => addDays(TODAY, -n) as string;
const at = (daysAgo: number, hour = 10) => `${ago(daysAgo)}T${String(hour).padStart(2, "0")}:00:00`;

const sprint = (id: string, planned: number, done: number | undefined, endAgo: number): Sprint => ({
  id,
  name: id,
  startDate: ago(endAgo + 13),
  endDate: ago(endAgo),
  pointsPlanned: planned,
  ...(done === undefined ? {} : { pointsCompleted: done }),
  status: "completed",
});

const story = (id: string, startAgo: number, doneAgo: number): Story => ({
  id,
  title: id,
  status: "done",
  startedAt: at(startAgo),
  doneAt: at(doneAgo, 16),
});

const card = (id: string, startAgo: number, doneAgo: number): KanbanCard => ({
  id,
  title: id,
  column: "done",
  class: "standard",
  createdAt: at(startAgo + 1),
  startedAt: at(startAgo),
  completedAt: at(doneAgo, 15),
});

const entry = (
  id: string,
  member: string,
  daysAgo: number,
  blockers: string,
  extra: Partial<StandupEntry> = {}
): StandupEntry => ({
  id,
  member,
  date: ago(daysAgo),
  yesterday: "",
  today: "",
  blockers,
  timestamp: 0,
  ...extra,
});

const lights = (green: number, yellow: number, red: number) => {
  const dims = [
    "Delivering Value",
    "Easy to Release",
    "Fun",
    "Health of Codebase",
    "Learning",
    "Mission",
    "Speed",
    "Teamwork",
  ];
  const l = [
    ...Array(green).fill("green"),
    ...Array(yellow).fill("yellow"),
    ...Array(red).fill("red"),
  ];
  return Object.fromEntries(
    l.map((light, i) => [dims[i], { light, trend: "same" }])
  ) as unknown as HealthCheckEntry["scores"];
};

const kpiOf = (src: Partial<DashboardSources>, id: HealthKpi["id"], includeExamples = false) =>
  dashboardKpis({ today: TODAY, ...src }, { includeExamples }).find((k) => k.id === id)!;

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  useWorkspaceStore.setState({
    sprints: [],
    stories: [],
    kanbanBoards: [],
    healthChecks: [],
    impediments: [],
    standupEntries: [],
    asyncUpdates: [],
    healthDashboards: [],
    risks: [],
    okrs: [],
  });
});

/* ── Settings ───────────────────────────────────────────────────────── */

describe("thresholds and windows", () => {
  it("defaults to the limits the dashboard always had", () => {
    expect(DEFAULT_THRESHOLDS).toMatchObject({
      predictability: { green: 80, amber: 60, higherIsBetter: true },
      "team-health": { green: 75, amber: 50, higherIsBetter: true },
      "open-impediments": { green: 0, amber: 3, higherIsBetter: false },
      "critical-impediments": { green: 0, amber: 0, higherIsBetter: false },
      "open-blockers": { green: 0, amber: 2, higherIsBetter: false },
      "cycle-time-p85": { green: 7, amber: 14, higherIsBetter: false },
    });
    expect(DEFAULT_WINDOWS).toEqual({ sprintWindow: 6, blockerWindowDays: 7, cycleWindowDays: 90 });
  });

  it("lights a value by the KPI's direction, and never colours a missing one", () => {
    expect(kpiStatus("predictability", 80)).toBe("green");
    expect(kpiStatus("predictability", 79)).toBe("amber");
    expect(kpiStatus("predictability", 59)).toBe("red");
    expect(kpiStatus("cycle-time-p85", 7)).toBe("green");
    expect(kpiStatus("cycle-time-p85", 14)).toBe("amber");
    expect(kpiStatus("cycle-time-p85", 15)).toBe("red");
    expect(kpiStatus("critical-impediments", 1)).toBe("red");
    // The old status-config called "no data" red.
    expect(kpiStatus("predictability", null)).toBeNull();
    expect(kpiStatus("open-blockers", Number.NaN)).toBeNull();
    expect(kpiStatus("predictability", 50, { green: 50, amber: 10 })).toBe("green");
  });

  it("checks every field: blanks, numbers, ranges, whole counts and the direction", () => {
    const draft = settingsDraft(settingsOf(null));
    expect(validateThresholds(draft).ok).toBe(true);
    const r = validateThresholds({
      ...draft,
      "predictability.green": "",
      "predictability.amber": "abc",
      "team-health.green": "101",
      "open-impediments.amber": "2.5",
      "cycle-time-p85.green": "0",
      "open-blockers.green": "3",
      "open-blockers.amber": "1",
      sprintWindow: "0",
      blockerWindowDays: "91",
      cycleWindowDays: "7.5",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      "predictability.green": "Enter a number.",
      "predictability.amber": "Enter a number.",
      "team-health.green": "Use a percentage from 0 to 100.",
      "open-impediments.amber": "Use a whole number, 0 or more.",
      "cycle-time-p85.green": "Use a whole number of days, 1 or more.",
      "open-blockers.amber": "Amber ends at or above green (3).",
      sprintWindow: "Use a whole number from 1 to 26.",
      blockerWindowDays: "Use a whole number from 1 to 90.",
      cycleWindowDays: "Use a whole number from 1 to 1000.",
    });
    const order = validateThresholds({
      ...draft,
      "team-health.green": "50",
      "team-health.amber": "60",
    });
    expect(!order.ok && order.errors["team-health.amber"]).toBe(
      "Amber starts at or below green (50)."
    );
  });

  it("reads a stored config, falling back per KPI where it is broken or legacy", () => {
    const s = settingsOf({
      id: HEALTH_DASHBOARD_ID,
      thresholds: {
        predictability: { green: 90, amber: 70 },
        "open-blockers": { green: 5, amber: 1 }, // backwards: default
        "cycle-time-p85": { green: "10", amber: 20 } as never, // a string: default
        unknown: { green: 1, amber: 2 },
      },
      sprintWindow: 0, // out of range: default
      cycleWindowDays: 30,
    });
    expect(s.thresholds.predictability).toEqual({ green: 90, amber: 70 });
    expect(s.thresholds["open-blockers"]).toEqual({ green: 0, amber: 2 });
    expect(s.thresholds["cycle-time-p85"]).toEqual({ green: 7, amber: 14 });
    expect(s.windows).toEqual({ sprintWindow: 6, blockerWindowDays: 7, cycleWindowDays: 30 });
    expect(settingsOf(undefined)).toEqual(settingsOf(null));
  });

  it("stores only what differs from the defaults, and reads back what it stored (twice)", () => {
    const input = settingsInput(settingsOf(null));
    input.thresholds["cycle-time-p85"] = { green: 5, amber: 10 };
    input.windows.blockerWindowDays = 3;
    const checked = checkSettings(input);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const doc = configFor(checked.values, "2026-10-24T10:00:00.000Z");
    expect(doc).toEqual({
      id: HEALTH_DASHBOARD_ID,
      updatedAt: "2026-10-24T10:00:00.000Z",
      thresholds: { "cycle-time-p85": { green: 5, amber: 10 } },
      blockerWindowDays: 3,
    });
    const again = configFor(settingsOf(doc), "2026-10-24T10:00:00.000Z");
    expect(again).toEqual(doc);
    expect(isDefaultSettings(settingsOf(doc))).toBe(false);
    expect(configFor(settingsOf(null), "t")).toEqual({ id: HEALTH_DASHBOARD_ID, updatedAt: "t" });
  });
});

/* ── The KPIs ───────────────────────────────────────────────────────── */

describe("predictability", () => {
  it("uses only pointed sprints, names the ones left out, and needs three", () => {
    const two = kpiOf(
      { sprints: [sprint("a", 10, 10, 30), sprint("b", 10, 5, 16), sprint("c", 0, 0, 2)] },
      "predictability"
    );
    expect(two.value).toBeNull();
    expect(two.status).toBeNull();
    expect(two.need).toMatchObject({ have: 2, need: "average" });
    expect(two.basis).toContain("1 unpointed sprint left out");

    const three = kpiOf(
      {
        sprints: [
          sprint("a", 10, 10, 44),
          sprint("b", 10, 5, 30),
          sprint("c", 10, 9, 16),
          // A finished sprint without a completed number is not pointed (it isn't 0).
          sprint("d", 10, undefined, 2),
        ],
      },
      "predictability"
    );
    expect(three.value).toBe(67); // a and c met (90–110%), b missed
    expect(three.status).toBe("amber");
    expect(three.series).toEqual([100, 50, 90]);
    expect(three.basis).toContain("1 unpointed sprint left out");
  });

  it("reads the latest sprints by end date, in the configured window", () => {
    const sprints = [
      sprint("old-miss", 10, 2, 60),
      sprint("met-1", 10, 10, 44),
      sprint("met-2", 10, 10, 30),
      sprint("met-3", 10, 10, 16),
    ];
    expect(kpiOf({ sprints }, "predictability").value).toBe(75);
    const windowed = kpiOf(
      { sprints, config: { id: HEALTH_DASHBOARD_ID, sprintWindow: 3 } },
      "predictability"
    );
    expect(windowed.value).toBe(100);
    expect(windowed.n).toBe(3);
  });
});

describe("team health", () => {
  const doc = (history: HealthCheckEntry[]): HealthCheck => ({
    id: "healthCheck:current",
    current: { sprintName: "", scores: lights(8, 0, 0) },
    history,
  });

  it("reads the latest saved check (never the all-green draft), green 1 · yellow ½ · red 0", () => {
    const hc = doc([
      { id: "h2", sprintName: "Sprint 2", date: "2026-03-01", scores: lights(2, 2, 4) },
      { id: "h1", sprintName: "Sprint 1", date: "2026-02-01", scores: lights(6, 2, 0) },
    ]);
    const k = kpiOf({ healthChecks: [hc] }, "team-health");
    expect(k.value).toBe(38); // (2 + 1) / 8
    expect(k.status).toBe("red");
    expect(k.basis).toContain("“Sprint 2” on 2026-03-01");
    expect(k.detail).toBe("Down 50 points since the check before.");
    expect(k.series).toEqual([88, 38]);
  });

  it("matches lib/health-check/score's latest saved check, examples left out", () => {
    const hc = doc([
      { id: "a", sprintName: "A", date: "2026-03-01", scores: lights(8, 0, 0) },
      { id: "b", sprintName: "B", date: "2026-03-01", scores: lights(4, 0, 4) },
      { id: "example-c", sprintName: "Ex", date: "2026-04-01", scores: lights(0, 0, 8) },
    ]);
    const mine = savedHealthChecks(hc);
    expect(mine[mine.length - 1]).toBe(latestSavedCheck(hc));
    expect(kpiOf({ healthChecks: [hc] }, "team-health").value).toBe(50);
    // The page's in-memory example counts its own rows.
    expect(kpiOf({ healthChecks: [hc] }, "team-health", true).value).toBe(0);
  });
});

describe("impediments and standup blockers", () => {
  it("counts open and escalated, and critical, through the shared summary", () => {
    const list: Impediment[] = [
      { id: "1", title: "a", severity: "critical", raisedAt: ago(3) },
      {
        id: "2",
        title: "b",
        severity: "low",
        raisedAt: ago(20),
        escalatedAt: ago(5),
        dueDate: ago(1),
      },
      { id: "3", title: "c", severity: "high", raisedAt: ago(9), resolvedAt: ago(2) },
      { id: "example-4", title: "d", severity: "critical", raisedAt: ago(1) },
    ];
    const open = kpiOf({ impediments: list }, "open-impediments");
    expect(open.value).toBe(2);
    expect(open.status).toBe("amber");
    expect(open.detail).toBe("1 overdue; the oldest has been open 20 days.");
    expect(kpiOf({ impediments: list }, "critical-impediments").value).toBe(1);
  });

  it("leaves out exactly the rows example-data's isExampleId calls examples", () => {
    const ids = ["example-1", "Example-2", "example", "x-example-3", "4"];
    const list: Impediment[] = ids.map((id) => ({
      id,
      title: id,
      severity: "low",
      raisedAt: ago(1),
    }));
    expect(kpiOf({ impediments: list }, "open-impediments").value).toBe(
      ids.filter((id) => !isExampleId(id)).length
    );
  });

  it("counts recent, open blockers once each, leaving out impediments, resolved and old ones", () => {
    const entries: StandupEntry[] = [
      entry("1", "Ana", 1, "Waiting on design"),
      entry("2", "ana ", 2, "waiting  on design"), // the same blocker, repeated
      entry("3", "Ben", 0, "VPN down", {
        sentTo: [{ route: "impediment", targetId: "i", at: ago(0) }],
      }),
      entry("4", "Ben", 3, "VPN down"), // raised as an impediment on another day
      entry("5", "Cy", 2, "Flaky CI", { blockerResolved: true }),
      entry("6", "Dee", 12, "No test data"),
      entry("7", "Eve", 2, ""),
      entry("example-8", "Fay", 1, "Example blocker"),
    ];
    const async: AsyncUpdate[] = [
      {
        id: "u1",
        member: "Gus",
        date: ago(1),
        yesterday: "",
        today: "",
        blockers: "Laptop broken",
      },
    ] as AsyncUpdate[];
    const c = countBlockers(entries, async, TODAY, 7);
    expect(c).toEqual({ recent: 2, olderOpen: 1, raised: 1, entries: 8 });
    const k = kpiOf({ standupEntries: entries, asyncUpdates: async }, "open-blockers");
    expect(k.value).toBe(2);
    expect(k.status).toBe("amber"); // green up to 0, amber up to 2
    expect(k.olderOpen).toBe(1);
    expect(k.detail).toMatch(/^\+1 older unresolved blocker/);
    // A wider window takes the old one in.
    expect(countBlockers(entries, async, TODAY, 14).recent).toBe(3);
  });
});

describe("cycle time P85 from the boards", () => {
  const cards = (list: KanbanCard[]) => [
    {
      id: KANBAN_BOARD_ID,
      cards: list,
      wipLimits: { backlog: 9, ready: 9, in_progress: 9, review: 9, done: 99 },
    },
  ];

  it("reads finished stories and Flow-board cards, a same-day item as 1 day", () => {
    const k = kpiOf(
      {
        stories: [
          story("s1", 5, 5),
          story("s2", 10, 8),
          story("s3", 20, 11),
          story("example-s", 50, 1),
        ],
        kanbanBoards: cards([card("c1", 9, 7), card("c2", 30, 21)]),
      },
      "cycle-time-p85"
    );
    // 1, 3, 10, 3, 10 days.
    expect(k.n).toBe(5);
    expect(k.value).toBe(10);
    expect(k.status).toBe("amber");
    expect(k.basis).toContain("3 stories and 2 cards");
    expect(k.detail).toBe("Median 3 days.");
  });

  it("needs five finished items, inside the window", () => {
    const k = kpiOf(
      {
        stories: [story("s1", 5, 5), story("s2", 10, 8), story("old", 200, 150)],
        config: { id: HEALTH_DASHBOARD_ID, cycleWindowDays: 30 },
      },
      "cycle-time-p85"
    );
    expect(k.value).toBeNull();
    expect(k.status).toBeNull();
    expect(k.need).toMatchObject({ have: 2, need: "distribution" });
    expect(k.basis).toContain("last 30 days");
  });

  it("never reads another tool's localStorage", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/health-dashboard");
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = path.join(d, n);
        return statSync(p).isDirectory() ? files(p) : [p];
      });
    for (const f of files(dir)) expect(readFileSync(f, "utf8"), f).not.toMatch(/localStorage/);
    window.localStorage.setItem(
      "agile-toolkit:cycle-time",
      JSON.stringify({
        state: { items: [{ id: "x", startDate: "2026-01-01", endDate: "2026-01-09" }] },
      })
    );
    expect(kpiOf({}, "cycle-time-p85").value).toBeNull();
    window.localStorage.removeItem("agile-toolkit:cycle-time");
  });
});

describe("overall, verdict and export", () => {
  it("averages the lit KPIs only, and has no score without one", () => {
    expect(overallHealth(dashboardKpis({ today: TODAY }))).toEqual({
      score: null,
      status: null,
      counted: 0,
      total: 6,
    });
    const kpis = dashboardKpis({
      today: TODAY,
      impediments: [{ id: "1", title: "a", severity: "critical", raisedAt: ago(1) }],
    });
    // open 1 (amber) and critical 1 (red): (1 + 0) / 4.
    expect(overallHealth(kpis)).toMatchObject({ score: 25, status: "red", counted: 2 });
  });

  it("names the worst KPIs against their limits", () => {
    expect(healthVerdict(dashboardKpis({ today: TODAY }))).toBe("No KPI has enough data yet.");
    const kpis = dashboardKpis({
      today: TODAY,
      impediments: [{ id: "1", title: "a", severity: "critical", raisedAt: ago(1) }],
    });
    expect(healthVerdict(kpis)).toBe(
      "2 of 2 KPIs need attention: 1 critical impediment is open (green up to 0) and 1 impediment is open (green up to 0); 4 more need data."
    );
    const calm = dashboardKpis({
      today: TODAY,
      impediments: [{ id: "1", title: "a", severity: "low", raisedAt: ago(9), resolvedAt: ago(2) }],
    });
    expect(healthVerdict(calm)).toBe("All 2 KPIs with data are on track; 4 more need data.");
    const p85 = kpiOf(
      {
        stories: [1, 2, 3, 4, 5].map((i) => story(`s${i}`, 20, 2)),
      },
      "cycle-time-p85"
    );
    expect(kpiReading(p85)).toBe("cycle time P85 is 19 days (green up to 7 days)");
  });

  it("exports a KPI table with the team's limits and the windows", () => {
    const config = {
      id: HEALTH_DASHBOARD_ID,
      thresholds: { "open-impediments": { green: 1, amber: 4 } },
    };
    const kpis = dashboardKpis({
      today: TODAY,
      config,
      impediments: [{ id: "1", title: "a", severity: "low", raisedAt: ago(1) }],
    });
    const md = toMarkdown({
      kpis,
      overall: overallHealth(kpis),
      verdict: healthVerdict(kpis),
      settings: settingsOf(config),
      today: TODAY,
    });
    expect(md).toContain(`# Team health — ${TODAY}`);
    expect(md).toContain("| Open impediments | 1 | On track | up to 1 | up to 4 |");
    expect(md).toContain("| Predictability | No data | — | from 80% | from 60% |");
    expect(md).toContain("standup blockers from the last 7 days");
    // The old summary hard-coded "(target: 80%)".
    expect(md).not.toContain("target: 80%");
  });
});

/* ── Page and agent agree ───────────────────────────────────────────── */

describe("page and agent parity", () => {
  it("get_summary returns the lib's KPIs for the same workspace", async () => {
    const ex = buildExample();
    // The example as if it were the team's own rows (ids without the prefix).
    const strip = <T extends { id: string }>(xs: readonly T[]) =>
      xs.map((x) => ({ ...x, id: x.id.replace(/^example-/, "") }));
    const ws = {
      sprints: strip(ex.sprints),
      stories: strip(ex.stories),
      kanbanBoards: ex.kanbanBoards.map((b) => ({ ...b, cards: strip(b.cards) })),
      healthChecks: ex.healthChecks.map((h) => ({ ...h, history: strip(h.history) })),
      impediments: strip(ex.impediments),
      standupEntries: strip(ex.standupEntries),
      asyncUpdates: [],
      healthDashboards: [
        { id: HEALTH_DASHBOARD_ID, thresholds: { predictability: { green: 60, amber: 40 } } },
      ],
    };
    useWorkspaceStore.setState(ws);
    const page = dashboardKpis({ ...ws, config: ws.healthDashboards[0], today: TODAY });
    const r = (await registry.get("tool.health_dashboard.get_summary")!.handler(
      {},
      {
        userId: "u",
        source: "agent",
        squadProfileIds: [],
      }
    )) as { kpis: { id: string; value: number | null; status: string | null }[]; verdict: string };
    expect(r.kpis.map((k) => [k.id, k.value, k.status])).toEqual(
      page.map((k) => [k.id, k.value, k.status])
    );
    expect(r.verdict).toBe(healthVerdict(page));
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <HealthDashboardClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () =>
  act(() => (lastToast()[1] as { action: { onClick: () => void } }).action.onClick());
const config = () =>
  (useWorkspaceStore.getState().healthDashboards ?? []).find((c) => c.id === HEALTH_DASHBOARD_ID);

describe("the page", () => {
  it("starts with an empty state, and an example that never reaches the workspace", () => {
    renderPage();
    expect(screen.getByText(/Nothing to show yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Predictability" })).toHaveTextContent("67%");
    expect(screen.getByRole("article", { name: "Cycle time P85" })).toHaveTextContent("12 days");
    expect(screen.getByRole("article", { name: "Open standup blockers" })).toHaveTextContent(
      "+1 older unresolved blocker"
    );
    // The verdict, and the export quotes it.
    expect(screen.getAllByText(/^5 of 6 KPIs need attention/)[0].tagName).toBe("P");
    const s = useWorkspaceStore.getState();
    for (const list of [s.sprints, s.stories, s.impediments, s.standupEntries, s.healthChecks]) {
      expect(list ?? []).toEqual([]);
    }
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.getByText(/Nothing to show yet/)).toBeInTheDocument();
  });

  it("the example's ids are all example ids", () => {
    const ex = buildExample();
    const ids = [
      ...ex.sprints,
      ...ex.stories,
      ...ex.kanbanBoards[0].cards,
      ...ex.healthChecks,
      ...ex.healthChecks[0].history,
      ...ex.impediments,
      ...ex.standupEntries,
    ].map((x) => x.id);
    expect(ids.every(isExampleId)).toBe(true);
    expect(ex.kanbanBoards[0].id).toBe(KANBAN_BOARD_ID);
  });

  it("shows the team's data with each card's basis and limits, and the overall score", () => {
    useWorkspaceStore.setState({
      impediments: [{ id: "1", title: "a", severity: "critical", raisedAt: ago(1) }],
    });
    renderPage();
    const critical = screen.getByRole("article", { name: "Critical impediments" });
    expect(critical).toHaveTextContent("At risk");
    expect(critical).toHaveTextContent("Green up to 0 · amber up to 0");
    const pred = screen.getByRole("article", { name: "Predictability" });
    expect(pred).toHaveTextContent("No data");
    expect(screen.getByText(/Average of 2 KPIs/)).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "| Critical impediments | 1 |"
    );
  });

  it("saves thresholds only when valid, focusing the first wrong field, with Undo", () => {
    useWorkspaceStore.setState({
      impediments: [{ id: "1", title: "a", severity: "low", raisedAt: ago(1) }],
    });
    renderPage();
    const form = screen.getByRole("button", { name: "Save thresholds" }).closest("form")!;
    const open = within(form).getByRole("group", { name: "Open impediments" });
    const green = within(open).getByLabelText(/^Green up to/);
    fireEvent.change(green, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save thresholds" }));
    const amber = within(open).getByLabelText(/^Amber up to/);
    expect(amber).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(amber);
    expect(within(open).getByText("Amber ends at or above green (5).")).toBeInTheDocument();
    expect(config()).toBeUndefined();

    fireEvent.change(green, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save thresholds" }));
    expect(config()?.thresholds).toEqual({ "open-impediments": { green: 1, amber: 3 } });
    expect(screen.getByRole("article", { name: "Open impediments" })).toHaveTextContent("On track");
    expect(logs.some((l) => l.action === "thresholds_updated")).toBe(true);
    expect(lastToast()[0]).toBe("Saved the dashboard thresholds");
    undoLast();
    expect(config()).toBeUndefined();
    expect(screen.getByRole("article", { name: "Open impediments" })).toHaveTextContent(
      "Needs attention"
    );
  });

  it("resets the thresholds after a confirm, with Undo", () => {
    useWorkspaceStore.setState({
      impediments: [{ id: "1", title: "a", severity: "low", raisedAt: ago(1) }],
      healthDashboards: [
        { id: HEALTH_DASHBOARD_ID, thresholds: { "open-impediments": { green: 1, amber: 3 } } },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reset thresholds" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset thresholds" })
    );
    expect(config()?.thresholds).toBeUndefined();
    expect(screen.getByRole("article", { name: "Open impediments" })).toHaveTextContent(
      "Needs attention"
    );
    undoLast();
    expect(config()?.thresholds).toEqual({ "open-impediments": { green: 1, amber: 3 } });
  });

  it("follows an agent's write to the settings without a refresh", () => {
    useWorkspaceStore.setState({
      impediments: [{ id: "1", title: "a", severity: "low", raisedAt: ago(1) }],
    });
    renderPage();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    act(() => {
      useWorkspaceStore.setState({
        healthDashboards: [
          { id: HEALTH_DASHBOARD_ID, thresholds: { "open-impediments": { green: 1, amber: 3 } } },
        ],
      });
    });
    expect(screen.getByRole("article", { name: "Open impediments" })).toHaveTextContent("On track");
  });

  it("keeps every KPI id it lists", () => {
    expect(dashboardKpis({ today: TODAY }).map((k) => k.id)).toEqual([...HEALTH_KPI_IDS]);
  });
});
