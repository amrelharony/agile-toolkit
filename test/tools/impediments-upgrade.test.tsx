import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment, WhiteboardObject } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/impediments/model";
import { LEGACY_IMPEDIMENTS_KEY } from "@/lib/impediments/legacy-key";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Impediments on the one store: workspace.impediments, which agents and
 * hand-offs write too. Draft-then-save with no default severity, escalate /
 * resolve (on a day) / reopen, due dates with ageing and overdue flags, a
 * list that keeps its order while it changes, edit in place, delete with
 * Undo, example data, a verdict, and a Markdown export.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/impediments/charts", () => ({ WeeklyImpedimentsChart: () => null }));

import { ImpedimentsClient } from "@/app/(tools)/impediments/impediments-client";
import { buildExample } from "@/app/(tools)/impediments/example";
import { toMarkdown } from "@/app/(tools)/impediments/markdown";
import { impedimentVerdict } from "@/app/(tools)/impediments/verdict";
import {
  analyseImpediments,
  medianSentence,
  shiftSentence,
  trendSentence,
} from "@/app/(tools)/impediments/analysis";
import {
  applyValues,
  draftFrom,
  emptyDraft,
  newImpediment,
  validateImpediment,
  validateResolvedDay,
  type ImpedimentDraft,
} from "@/app/(tools)/impediments/form";
import {
  NO_FILTERS,
  WEEK_CAP,
  buildWeeklyImpedimentSeries,
  dayLabel,
  matchesFilters,
  openByCategory,
  resolutionDays,
  statusCounts,
  usableImpediments,
  weekStart,
  weeklyChartText,
  type WeekPoint,
} from "@/app/(tools)/impediments/helpers";

const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n);

const imp = (id: string, title: string, extra: Partial<Impediment> = {}): Impediment => ({
  id,
  title,
  severity: "medium",
  raisedAt: ago(2),
  source: "manual",
  ...extra,
});

const ws = () => useWorkspaceStore.getState();
const rows = () => ws().impediments;
const row = (id: string) => rows().find((i) => i.id === id);
const seed = (...list: Impediment[]) => useWorkspaceStore.setState({ impediments: list });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ImpedimentsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const card = (title: string) => screen.getByRole("article", { name: title });
const listTitles = () =>
  within(screen.getByRole("list", { name: "Impediments, escalated first" }))
    .getAllByRole("article")
    .map((a) => a.querySelector("h3")?.textContent);
const announced = () => screen.getByTestId("live-polite");

beforeEach(() => {
  toastSpy.mockReset();
  window.localStorage.removeItem(LEGACY_IMPEDIMENTS_KEY);
  useWorkspaceStore.setState({ impediments: [], whiteboardObjects: [] });
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("the log form's checks", () => {
  const draft = (patch: Partial<ImpedimentDraft> = {}): ImpedimentDraft => ({
    ...emptyDraft(TODAY),
    ...patch,
  });

  it("starts with nothing chosen and raised today", () => {
    expect(emptyDraft(TODAY)).toMatchObject({
      severity: null,
      category: "",
      raisedAt: TODAY,
      dueDate: "",
    });
  });

  it("requires a title and a severity instead of defaulting them", () => {
    const v = validateImpediment(draft(), TODAY);
    expect(v).toEqual({
      ok: false,
      errors: { title: "Enter a title.", severity: "Pick a severity." },
    });
    expect(validateImpediment(draft({ title: "   ", severity: "low" }), TODAY).ok).toBe(false);
  });

  it("backdates the raised day but never into the future", () => {
    const back = validateImpediment(
      draft({ title: "VPN", severity: "low", raisedAt: ago(30) }),
      TODAY
    );
    expect(back).toMatchObject({ ok: true, values: { raisedAt: ago(30) } });
    const future = validateImpediment(
      draft({ title: "VPN", severity: "low", raisedAt: addDays(TODAY, 1) }),
      TODAY
    );
    expect(future).toMatchObject({
      ok: false,
      errors: { raisedAt: "It can't be raised in the future." },
    });
    expect(
      validateImpediment(draft({ title: "VPN", severity: "low", raisedAt: "" }), TODAY)
    ).toMatchObject({ ok: false, errors: { raisedAt: "Enter the day it was raised." } });
    expect(
      validateImpediment(draft({ title: "VPN", severity: "low", raisedAt: "24/10/2026" }), TODAY)
    ).toMatchObject({ ok: false, errors: { raisedAt: "Use a date like 2026-10-24." } });
  });

  it("keeps a due date on or after the raised day, and allows one in the past", () => {
    const base = { title: "CI", severity: "high" as const, raisedAt: ago(5) };
    expect(validateImpediment(draft({ ...base, dueDate: ago(6) }), TODAY)).toMatchObject({
      ok: false,
      errors: { dueDate: "It can't be due before the day it was raised." },
    });
    expect(validateImpediment(draft({ ...base, dueDate: ago(3) }), TODAY)).toMatchObject({
      ok: true,
      values: { dueDate: ago(3) },
    });
  });

  it("checks the resolved day only for a resolved one", () => {
    const base = { title: "CI", severity: "high" as const, raisedAt: ago(5) };
    expect(validateImpediment(draft(base), TODAY, { resolved: true })).toMatchObject({
      ok: false,
      errors: { resolvedAt: "Enter the day it was resolved." },
    });
    expect(
      validateImpediment(draft({ ...base, resolvedAt: ago(6) }), TODAY, { resolved: true })
    ).toMatchObject({
      ok: false,
      errors: { resolvedAt: "It can't be resolved before it was raised." },
    });
    expect(
      validateImpediment(draft({ ...base, resolvedAt: ago(1) }), TODAY, { resolved: true })
    ).toMatchObject({ ok: true, values: { resolvedAt: ago(1) } });
    expect(validateImpediment(draft(base), TODAY).ok).toBe(true);
  });

  it("trims, caps and leaves blank optional fields out", () => {
    const v = validateImpediment(
      draft({
        title: `  ${"x".repeat(300)}  `,
        severity: "critical",
        description: "   ",
        owner: "  Priya ",
        raisedBy: "",
      }),
      TODAY
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.values.title).toHaveLength(240);
    expect(v.values.owner).toBe("Priya");
    expect(v.values).not.toHaveProperty("description");
    expect(v.values).not.toHaveProperty("raisedBy");
    expect(v.values).not.toHaveProperty("category");
  });

  it("checks the day picked for Resolve", () => {
    expect(validateResolvedDay(TODAY, ago(3), TODAY)).toEqual({ ok: true, values: TODAY });
    expect(validateResolvedDay(addDays(TODAY, 1), ago(3), TODAY).ok).toBe(false);
    expect(validateResolvedDay(ago(4), ago(3), TODAY).ok).toBe(false);
    // An agent's timestamp is read by its day.
    expect(validateResolvedDay(ago(3), `${ago(3)}T18:00:00.000Z`, TODAY).ok).toBe(true);
    expect(validateResolvedDay("", ago(3), TODAY).ok).toBe(false);
  });

  it("logs a new one as manual, with no resolved day", () => {
    const i = newImpediment(
      { title: "CI", severity: "high", raisedAt: ago(1), resolvedAt: TODAY },
      "n1"
    );
    expect(i).toEqual({
      id: "n1",
      title: "CI",
      severity: "high",
      raisedAt: ago(1),
      source: "manual",
    });
  });
});

describe("editing a stored impediment", () => {
  it("reads an agent's row: its timestamp's day, a due date from expected days, unknown values unset", () => {
    const d = draftFrom({
      id: "a",
      title: "Agent row",
      severity: "urgent" as Impediment["severity"],
      category: "people" as Impediment["category"],
      raisedAt: `${ago(4)}T09:30:00.000Z`,
      expectedResolutionDays: 3,
    });
    expect(d).toMatchObject({
      severity: null,
      category: "",
      raisedAt: ago(4),
      dueDate: ago(1),
      resolvedAt: "",
    });
  });

  it("returns the same row when nothing changed, keeping timestamps and expected days", () => {
    const stored = imp("a", "CI", {
      raisedAt: `${ago(4)}T09:30:00.000Z`,
      expectedResolutionDays: 3,
      owner: "Priya",
      tags: ["ci"],
      sourceRef: { tool: "standup", id: "e1" },
    });
    const v = validateImpediment(draftFrom(stored), TODAY);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(applyValues(stored, v.values)).toBe(stored);
  });

  it("writes only what changed and clears what was emptied", () => {
    const stored = imp("a", "CI", {
      raisedAt: `${ago(4)}T09:30:00.000Z`,
      expectedResolutionDays: 3,
      owner: "Priya",
      description: "Red since Tuesday",
      escalatedAt: ago(1),
      sourceRef: { tool: "retro", id: "c1" },
    });
    const moved = applyValues(stored, {
      title: "CI down",
      severity: "critical",
      raisedAt: ago(4),
      dueDate: TODAY,
      category: "technical",
    });
    expect(moved).toMatchObject({
      title: "CI down",
      severity: "critical",
      raisedAt: `${ago(4)}T09:30:00.000Z`,
      dueDate: TODAY,
      expectedResolutionDays: 3,
      category: "technical",
      escalatedAt: ago(1),
      sourceRef: { tool: "retro", id: "c1" },
    });
    expect(moved).not.toHaveProperty("owner");
    expect(moved).not.toHaveProperty("description");

    const noDue = applyValues(stored, { title: "CI", severity: "medium", raisedAt: ago(4) });
    expect(noDue).not.toHaveProperty("dueDate");
    expect(noDue).not.toHaveProperty("expectedResolutionDays");
  });

  it("moves the raised and resolved days only when they changed", () => {
    const stored = imp("a", "CI", {
      raisedAt: ago(6),
      resolvedAt: `${ago(2)}T10:00:00.000Z`,
    });
    const next = applyValues(stored, {
      title: "CI",
      severity: "medium",
      raisedAt: ago(8),
      resolvedAt: ago(2),
    });
    expect(next).toMatchObject({ raisedAt: ago(8), resolvedAt: `${ago(2)}T10:00:00.000Z` });
    expect(
      applyValues(stored, { title: "CI", severity: "medium", raisedAt: ago(6), resolvedAt: ago(1) })
    ).toMatchObject({ resolvedAt: ago(1) });
  });
});

describe("filters, counts and resolution times", () => {
  const list = [
    imp("o", "Open one", { category: "technical" }),
    imp("late", "Late one", { severity: "high", raisedAt: ago(5), dueDate: ago(1) }),
    imp("esc", "Escalated one", { escalatedAt: ago(1), category: "external" }),
    imp("done", "Done one", { raisedAt: ago(9), resolvedAt: ago(4), dueDate: ago(8) }),
  ];

  it("drops rows without an id and keeps the rest as stored", () => {
    const odd = { title: "no id" } as unknown as Impediment;
    expect(usableImpediments([odd, list[0]])).toEqual([list[0]]);
    expect(usableImpediments(undefined)).toEqual([]);
  });

  it("filters by status, overdue, category and severity", () => {
    const ids = (f: Partial<typeof NO_FILTERS>) =>
      list.filter((i) => matchesFilters(i, { ...NO_FILTERS, ...f }, TODAY)).map((i) => i.id);
    expect(ids({})).toEqual(["o", "late", "esc", "done"]);
    expect(ids({ status: "open" })).toEqual(["o", "late"]);
    expect(ids({ status: "escalated" })).toEqual(["esc"]);
    // A resolved one is never overdue, even past its due date.
    expect(ids({ status: "overdue" })).toEqual(["late"]);
    expect(ids({ status: "resolved" })).toEqual(["done"]);
    expect(ids({ category: "technical" })).toEqual(["o"]);
    expect(ids({ severity: "high" })).toEqual(["late"]);
  });

  it("counts each status and the unresolved per category", () => {
    expect(statusCounts(list, TODAY)).toEqual({
      all: 4,
      open: 2,
      escalated: 1,
      overdue: 1,
      resolved: 1,
    });
    expect(openByCategory(list)).toEqual([
      { label: "External", count: 1 },
      { label: "No category", count: 1 },
      { label: "Technical", count: 1 },
    ]);
  });

  it("measures resolution times from readable dates only", () => {
    expect(
      resolutionDays([
        ...list,
        imp("ts", "Timestamped", {
          raisedAt: `${ago(3)}T08:00:00Z`,
          resolvedAt: `${ago(1)}T20:00:00Z`,
        }),
        imp("bad", "Bad date", { raisedAt: "garbage", resolvedAt: ago(1) }),
      ])
    ).toEqual([5, 2]);
  });
});

describe("the weekly series", () => {
  it("anchors weeks on Mondays", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekStart("2026-10-24")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
  });

  it("counts raised per week and open at each week's end", () => {
    const today = "2026-10-24";
    const points = buildWeeklyImpedimentSeries(
      [
        imp("a", "A", { raisedAt: "2026-10-01T09:00:00.000Z", resolvedAt: "2026-10-08" }),
        imp("b", "B", { raisedAt: "2026-10-20" }),
        imp("c", "Bad", { raisedAt: "not a date" }),
      ],
      today
    );
    expect(points).toEqual([
      { start: "2026-09-28", raised: 1, open: 1 },
      { start: "2026-10-05", raised: 0, open: 0 },
      { start: "2026-10-12", raised: 0, open: 0 },
      { start: "2026-10-19", raised: 1, open: 1 },
    ]);
  });

  it("keeps the most recent weeks once the history is longer than the cap", () => {
    const today = "2026-10-24";
    const points = buildWeeklyImpedimentSeries(
      [imp("old", "Old", { raisedAt: "2025-01-06" }), imp("new", "New", { raisedAt: today })],
      today
    );
    expect(points).toHaveLength(WEEK_CAP);
    expect(points[WEEK_CAP - 1]).toEqual({ start: "2026-10-19", raised: 1, open: 2 });
    // The old one is outside every bucket's "raised" but still open in each.
    expect(points.slice(0, -1).every((p) => p.raised === 0 && p.open === 1)).toBe(true);
  });

  it("is empty with nothing raised, and ignores days after today", () => {
    expect(buildWeeklyImpedimentSeries([], TODAY)).toEqual([]);
    expect(
      buildWeeklyImpedimentSeries([imp("f", "Future", { raisedAt: addDays(TODAY, 30) })], TODAY)
    ).toEqual([{ start: weekStart(TODAY), raised: 0, open: 0 }]);
  });

  it("summarises the chart and gives its rows as a table", () => {
    const points: WeekPoint[] = [
      { start: "2026-09-28", raised: 3, open: 3 },
      { start: "2026-10-05", raised: 0, open: 1 },
      { start: "2026-10-12", raised: 1, open: 1 },
    ];
    const text = weeklyChartText(points);
    expect(text.summary).toBe(
      `4 raised over the last 3 weeks, 1 this week; the most in one week was 3, the week of ${dayLabel(
        "2026-09-28"
      )}. 1 is still open.`
    );
    expect(text.table.columns).toEqual(["Week of", "Raised", "Open at week end"]);
    expect(text.table.rows[0]).toEqual([dayLabel("2026-09-28", true), 3, 3]);
    expect(weeklyChartText([{ start: "2026-10-19", raised: 2, open: 2 }]).summary).toBe(
      "2 raised this week. 2 are still open."
    );
    expect(weeklyChartText([]).summary).toBe("No impediments raised yet.");
  });
});

describe("the verdict", () => {
  it("leads with the longest overdue one", () => {
    expect(impedimentVerdict(buildExample(TODAY), TODAY)).toBe(
      "4 open, 1 escalated; 1 overdue: Build server down, by 3 days."
    );
    const two = [
      imp("a", "A", { raisedAt: ago(5), dueDate: ago(1) }),
      imp("b", "B", { raisedAt: ago(9), dueDate: ago(4), escalatedAt: ago(3) }),
    ];
    expect(impedimentVerdict(two, TODAY)).toBe(
      "1 open, 1 escalated; 2 overdue, the longest: B, by 4 days."
    );
  });

  it("names the oldest when nothing is overdue", () => {
    expect(
      impedimentVerdict(
        [imp("a", "A", { raisedAt: ago(1) }), imp("b", "B", { raisedAt: ago(12) })],
        TODAY
      )
    ).toBe("2 open; none overdue. The oldest is B, open 12 days.");
    expect(impedimentVerdict([imp("a", "A", { raisedAt: TODAY, escalatedAt: TODAY })], TODAY)).toBe(
      "1 escalated; none overdue. The oldest is A, raised today."
    );
  });

  it("says when nothing is in the way, with the average once there are enough", () => {
    expect(impedimentVerdict([], TODAY)).toBe("No impediments logged yet.");
    const done = (id: string, took: number) =>
      imp(id, id, { raisedAt: ago(took + 1), resolvedAt: ago(1) });
    expect(impedimentVerdict([done("a", 2)], TODAY)).toBe(
      "Nothing in the way: the one impediment logged is resolved."
    );
    expect(impedimentVerdict([done("a", 2), done("b", 4)], TODAY)).toBe(
      "Nothing in the way: all 2 impediments are resolved."
    );
    expect(impedimentVerdict([done("a", 2), done("b", 4), done("c", 6)], TODAY)).toBe(
      "Nothing in the way: all 3 impediments are resolved, in 4 days on average."
    );
  });
});

describe("the Markdown export", () => {
  it("has escalated, open and resolved sections with age, owner and due", () => {
    const md = toMarkdown(buildExample(TODAY), TODAY);
    expect(md).toContain(`# Impediments — ${dayLabel(TODAY, true)}`);
    expect(md).toContain("**4 open, 1 escalated; 1 overdue: Build server down, by 3 days.**");
    const escalated = md.indexOf("## Escalated (1)");
    const open = md.indexOf("## Open (4)");
    const resolved = md.indexOf("## Resolved (3)");
    expect(escalated).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(escalated);
    expect(resolved).toBeGreaterThan(open);
    expect(md).toContain(
      `| Build server down | Critical | Technical | Priya | ${dayLabel(ago(5))} | 5 days | ${dayLabel(
        ago(3)
      )}, overdue by 3 days |`
    );
    // Due by its expected days; no owner shows a dash.
    expect(md).toContain(`| ${dayLabel(ago(3))} | 3 days | ${dayLabel(addDays(TODAY, 2))} |`);
    expect(md).toContain("| Flaky end-to-end tests on mobile Safari | Low | Technical | — |");
    expect(md).toContain(
      `| Design sign-off delayed | High | External | Sam | ${dayLabel(ago(20))} | ${dayLabel(
        ago(11)
      )} | 9 days |`
    );
  });

  it("escapes pipes, skips empty sections and handles an empty tracker", () => {
    const md = toMarkdown([imp("a", "Build | deploy\nbroken")], TODAY);
    expect(md).toContain("| Build \\| deploy broken |");
    expect(md).not.toContain("## Escalated");
    expect(md).not.toContain("## Resolved");
    expect(toMarkdown([], TODAY)).toContain("No impediments logged yet.");
  });
});

describe("the example", () => {
  it("uses example ids and dates relative to today", () => {
    const rows = buildExample(TODAY);
    expect(rows).toHaveLength(8);
    expect(rows.every((i) => i.id.startsWith("example-"))).toBe(true);
    expect(rows[0]).toMatchObject({ raisedAt: ago(5), dueDate: ago(3), severity: "critical" });
  });
});

describe("advanced analysis", () => {
  const weeks = (n: number, raised: (w: number) => number = (w) => w): WeekPoint[] =>
    Array.from({ length: n }, (_, w) => ({
      start: addDays("2026-01-05", w * 7),
      raised: raised(w),
      open: 0,
    }));

  it("waits for enough weeks and resolved impediments", () => {
    const a = analyseImpediments(weeks(5), [1, 2, 3, 4]);
    expect(a).toEqual({ weeks: 5, trend: null, shifts: null, resolvedCount: 4, median: null });
    const b = analyseImpediments(weeks(8), [1, 2, 3, 4, 5]);
    // Mann-Kendall never calls a trend below 10 points, so it waits for 10 weeks.
    expect(b.trend).toBeNull();
    expect(b.shifts).toMatch(/\(CUSUM\)\.$/);
    expect(b.median).toMatch(/^Median time to resolve: 3 days/);
    expect(analyseImpediments(weeks(10), []).trend).toMatch(/Mann-Kendall/);
  });

  it("words the trend, the shifts and the median", () => {
    const rising = Array.from({ length: 12 }, (_, w) => w);
    expect(trendSentence(rising)).toMatch(/^More impediments are being raised/);
    expect(trendSentence([...rising].reverse())).toMatch(/^Fewer impediments/);
    expect(trendSentence(Array(12).fill(2))).toMatch(/^No clear trend/);
    expect(shiftSentence(weeks(10, () => 1))).toBe(
      "No sustained shift in how many impediments are raised each week (CUSUM)."
    );
    expect(shiftSentence(weeks(20, (w) => (w < 10 ? 0 : 5)))).toMatch(
      /sustained rise from the week of/
    );
    expect(medianSentence([1, 1, 1, 1, 1])).toMatch(/^Median time to resolve: 1 day \(/);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("Impediments first run", () => {
  it("loads the example from the empty state and clears only example rows", () => {
    renderPage();
    expect(screen.getByText(/No impediments logged\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows()).toHaveLength(8);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText("4 open, 1 escalated; 1 overdue: Build server down, by 3 days.")
    ).toBeInTheDocument();
    expect(within(card("Build server down")).getByText("Overdue by 3 days")).toBeInTheDocument();

    act(() => ws().upsertImpediment(imp("mine", "My impediment")));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(rows().map((i) => i.id)).toEqual(["mine"]);
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
  });

  describe("while the old browser store is still being moved", () => {
    afterEach(() => vi.useRealTimers());

    it("says so instead of showing the empty state, until the move is done", () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      window.localStorage.setItem(LEGACY_IMPEDIMENTS_KEY, '{"state":{"impediments":[]}}');
      renderPage();
      expect(screen.getByText("Moving impediments saved in this browser…")).toBeInTheDocument();
      expect(screen.queryByText(/No impediments logged\./)).not.toBeInTheDocument();

      window.localStorage.removeItem(LEGACY_IMPEDIMENTS_KEY);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(
        screen.queryByText("Moving impediments saved in this browser…")
      ).not.toBeInTheDocument();
      expect(screen.getByText(/No impediments logged\./)).toBeInTheDocument();
    });
  });

  it("shows impediments that agents and other tools wrote", () => {
    seed(
      imp("agent", "Waiting on infra ticket", {
        raisedAt: `${ago(4)}T09:30:00.000Z`,
        source: "standup",
        sourceRef: { tool: "standup", id: "entry-1" },
      }),
      { id: "", title: "no id" } as unknown as Impediment,
      { id: "untitled", severity: "low", raisedAt: ago(1) } as unknown as Impediment
    );
    renderPage();
    const agent = card("Waiting on infra ticket");
    expect(within(agent).getByText("Open 4 days")).toBeInTheDocument();
    expect(within(agent).getByRole("link", { name: "From standup" })).toBeInTheDocument();
    // Raised on the timestamp's day.
    expect(within(agent).getByText(dayLabel(ago(4)))).toBeInTheDocument();
    expect(card("Untitled impediment")).toBeInTheDocument();
    expect(listTitles()).toHaveLength(2);
  });
});

describe("logging an impediment", () => {
  const openForm = () => {
    fireEvent.click(screen.getByRole("button", { name: "Log impediment" }));
    return screen.getByRole("button", { name: "Log impediment" }).closest("form")!;
  };

  it("saves nothing until the title and severity are set, then logs it", async () => {
    renderPage();
    const form = openForm();
    const title = within(form).getByLabelText(/^Impediment/);
    expect(title).toHaveFocus();
    fireEvent.submit(form);
    expect(within(form).getByText("Enter a title.")).toBeInTheDocument();
    expect(within(form).getByText("Pick a severity.")).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(title).toHaveFocus();

    fireEvent.change(title, { target: { value: "Build server down" } });
    fireEvent.click(within(form).getByRole("radio", { name: "Critical" }));
    fireEvent.change(within(form).getByLabelText(/^Raised on/), { target: { value: ago(3) } });
    fireEvent.change(within(form).getByLabelText(/^Owner/), { target: { value: "Priya" } });
    // Enter in a field submits the form.
    fireEvent.submit(form);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      title: "Build server down",
      severity: "critical",
      raisedAt: ago(3),
      owner: "Priya",
      source: "manual",
    });
    expect(rows()[0]).not.toHaveProperty("category");
    expect(rows()[0]).not.toHaveProperty("dueDate");
    expect(screen.getByRole("button", { name: "Log impediment" })).toHaveFocus();
    await waitFor(() => expect(announced()).toHaveTextContent("Logged “Build server down”"));
  });

  it("offers the team's average as a due date once enough are resolved", () => {
    const done = (id: string, took: number) =>
      imp(id, id, { raisedAt: ago(took + 1), resolvedAt: ago(1) });
    seed(done("a", 2), done("b", 4));
    renderPage();
    let form = openForm();
    expect(within(form).queryByRole("button", { name: /your average/ })).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));

    act(() => ws().upsertImpediment(done("c", 6)));
    form = openForm();
    fireEvent.click(within(form).getByRole("button", { name: /your average of 4 days/ }));
    expect(within(form).getByLabelText(/^Due by/)).toHaveValue(addDays(TODAY, 4));
  });

  it("closes on Escape without saving", () => {
    renderPage();
    const form = openForm();
    const title = within(form).getByLabelText(/^Impediment/);
    fireEvent.change(title, { target: { value: "Half typed" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(rows()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Log impediment" })).toHaveFocus();
  });
});

describe("status changes", () => {
  beforeEach(() => {
    seed(
      imp("crit", "Critical one", { severity: "critical", raisedAt: ago(1) }),
      imp("a", "Slow reviews", { severity: "medium", raisedAt: ago(4) })
    );
  });

  it("escalates without moving the card until Re-sort, then puts it first", async () => {
    renderPage();
    expect(listTitles()).toEqual(["Critical one", "Slow reviews"]);
    fireEvent.click(
      within(card("Slow reviews")).getByRole("button", { name: "Escalate Slow reviews" })
    );
    expect(row("a")?.escalatedAt).toBe(TODAY);
    expect(within(card("Slow reviews")).getByText("Escalated")).toBeInTheDocument();
    // Focus moves to the card's next action rather than dropping to the page.
    expect(
      within(card("Slow reviews")).getByRole("button", { name: "Resolve Slow reviews" })
    ).toHaveFocus();
    await waitFor(() => expect(announced()).toHaveTextContent("Escalated “Slow reviews”"));

    expect(listTitles()).toEqual(["Critical one", "Slow reviews"]);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(listTitles()).toEqual(["Slow reviews", "Critical one"]);

    fireEvent.click(screen.getByRole("button", { name: "De-escalate Slow reviews" }));
    expect(row("a")).not.toHaveProperty("escalatedAt");
    await waitFor(() =>
      expect(announced()).toHaveTextContent("Moved back to open: “Slow reviews”")
    );
  });

  it("resolves on today unless another day is picked, then reopens", async () => {
    renderPage();
    const a = card("Slow reviews");
    fireEvent.click(within(a).getByRole("button", { name: "Resolve Slow reviews" }));
    const day = within(a).getByLabelText(/^Resolved on/);
    expect(day).toHaveValue(TODAY);
    expect(day).toHaveFocus();
    fireEvent.change(day, { target: { value: ago(5) } });
    fireEvent.click(within(a).getByRole("button", { name: "Mark resolved" }));
    expect(within(a).getByText("It can't be resolved before it was raised.")).toBeInTheDocument();
    expect(row("a")).not.toHaveProperty("resolvedAt");

    fireEvent.change(day, { target: { value: ago(1) } });
    fireEvent.click(within(a).getByRole("button", { name: "Mark resolved" }));
    expect(row("a")?.resolvedAt).toBe(ago(1));
    expect(within(card("Slow reviews")).getByText("Took 3 days")).toBeInTheDocument();
    await waitFor(() => expect(announced()).toHaveTextContent("Resolved “Slow reviews”"));

    fireEvent.click(screen.getByRole("button", { name: "Reopen Slow reviews" }));
    expect(row("a")).not.toHaveProperty("resolvedAt");
    expect(within(card("Slow reviews")).getByText("Open")).toBeInTheDocument();
  });

  it("keeps the escalation day when an escalated one is resolved", () => {
    seed(imp("a", "Slow reviews", { raisedAt: ago(4), escalatedAt: ago(2) }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Resolve Slow reviews" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(row("a")).toMatchObject({ escalatedAt: ago(2), resolvedAt: TODAY });
  });
});

describe("ageing, due dates and filters", () => {
  beforeEach(() => {
    seed(
      imp("late", "Build server down", { severity: "critical", raisedAt: ago(5), dueDate: ago(4) }),
      imp("soon", "Shared test env", { raisedAt: ago(8), expectedResolutionDays: 9 }),
      imp("new", "Unclear criteria", { raisedAt: TODAY, dueDate: TODAY }),
      imp("done", "VPN drops", { raisedAt: ago(14), resolvedAt: ago(12), dueDate: ago(13) })
    );
  });

  it("flags overdue ones and shows each one's age and due date in words", () => {
    renderPage();
    expect(within(card("Build server down")).getByText("Overdue by 4 days")).toBeInTheDocument();
    expect(within(card("Build server down")).getByText("Open 5 days")).toBeInTheDocument();
    expect(
      within(card("Shared test env")).getByText(`Due ${dayLabel(addDays(TODAY, 1))}`)
    ).toBeInTheDocument();
    expect(within(card("Unclear criteria")).getByText("Due today")).toBeInTheDocument();
    expect(within(card("Unclear criteria")).getByText("Raised today")).toBeInTheDocument();
    // Resolved: how long it took, never overdue.
    expect(within(card("VPN drops")).getByText("Took 2 days")).toBeInTheDocument();
    expect(within(card("VPN drops")).queryByText(/Overdue/)).not.toBeInTheDocument();
    expect(
      screen.getByText("3 open; 1 overdue: Build server down, by 4 days.")
    ).toBeInTheDocument();
  });

  it("filters to overdue, by category and severity, and clears", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Overdue (1)" }));
    expect(listTitles()).toEqual(["Build server down"]);
    expect(screen.getByText(/Showing 1 of 4/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Resolved (1)" }));
    expect(listTitles()).toEqual(["VPN drops"]);
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    expect(screen.getByText("No impediments match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(listTitles()).toHaveLength(4);
  });
});

describe("edit in place and delete", () => {
  beforeEach(() => {
    seed(
      imp("a", "Slow reviews", {
        raisedAt: ago(4),
        owner: "Sam",
        sourceRef: { tool: "retro", id: "card-1" },
        source: "retro",
      })
    );
  });

  it("edits the fields in place and saves only on Save", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Slow reviews" }));
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    const title = within(form).getByLabelText(/^Impediment/);
    expect(title).toHaveFocus();
    expect(within(form).getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.change(title, { target: { value: "Reviews wait two days" } });
    fireEvent.change(within(form).getByLabelText(/^Due by/), {
      target: { value: addDays(TODAY, 2) },
    });
    fireEvent.change(within(form).getByLabelText(/^Category/), { target: { value: "process" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(row("a")).toMatchObject({
      title: "Reviews wait two days",
      dueDate: addDays(TODAY, 2),
      category: "process",
      owner: "Sam",
      source: "retro",
      sourceRef: { tool: "retro", id: "card-1" },
    });
    expect(screen.getByRole("button", { name: "Edit Reviews wait two days" })).toHaveFocus();
  });

  it("cancels an edit with Escape", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Slow reviews" }));
    const title = within(
      screen.getByRole("button", { name: "Save" }).closest("form")!
    ).getByLabelText(/^Impediment/);
    fireEvent.change(title, { target: { value: "Changed" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(row("a")?.title).toBe("Slow reviews");
    expect(screen.getByRole("button", { name: "Edit Slow reviews" })).toHaveFocus();
  });

  it("deletes with Undo, pinning canvas objects back", () => {
    const pinned = {
      id: "obj-1",
      boardId: "board",
      type: "card",
      version: 1,
      updatedAt: "2026-10-01T00:00:00.000Z",
      sourceRef: { tool: "impediment", entityId: "a" },
    } as unknown as WhiteboardObject;
    useWorkspaceStore.setState({ whiteboardObjects: [pinned] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Slow reviews" }));
    expect(rows()).toEqual([]);
    expect(ws().whiteboardObjects?.[0]?.sourceRef).toBeUndefined();

    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Deleted “Slow reviews”");
    act(() => opts.action.onClick());
    expect(row("a")).toMatchObject({
      title: "Slow reviews",
      sourceRef: { tool: "retro", id: "card-1" },
    });
    expect(ws().whiteboardObjects?.[0]).toMatchObject({
      sourceRef: { tool: "impediment", entityId: "a" },
      version: 3,
    });
  });

  it("deletes everything only after a confirm, with Undo", () => {
    act(() => ws().upsertImpediment(imp("b", "Flaky tests")));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete all 2 impediments?")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete all" }));
    expect(rows()).toEqual([]);

    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Deleted 2 impediments");
    act(() => opts.action.onClick());
    expect(
      rows()
        .map((i) => i.id)
        .sort()
    ).toEqual(["a", "b"]);
  });
});

describe("the tool's files", () => {
  const dir = path.resolve(__dirname, "../../src/app/(tools)/impediments");
  const files = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = path.join(d, n);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("has no store of its own any more", () => {
    expect(existsSync(path.join(dir, "use-impediment-store.ts"))).toBe(false);
    for (const f of files(dir))
      expect(readFileSync(f, "utf8")).not.toContain("agile-toolkit:impediments");
  });

  it("uses theme tokens, never hex colours", () => {
    for (const f of files(dir)) {
      expect(readFileSync(f, "utf8"), path.basename(f)).not.toMatch(
        /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i
      );
    }
  });
});
