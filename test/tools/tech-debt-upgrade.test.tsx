import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type Story,
  type TechDebtItem,
  type WhiteboardObject,
} from "@/lib/stores/workspace-types";
import { CADENCE_KEY } from "@/lib/sprints/use-ceremony-cadence";
import { TECH_DEBT_KEY, TECH_DEBT_MOVED_KEY } from "@/lib/tech-debt/legacy";
import {
  INTEREST_CAP,
  debtAgeSprints,
  debtScore,
  debtSummary,
  debtVerdict,
  rankedDebt,
} from "@/lib/tech-debt/model";
import { registry } from "@/lib/actions/registry";
import { bootstrapPredictions } from "@/lib/predictions/bootstrap";

/**
 * Tech Debt on one store (Phase 8): workspace.techDebt, which agents, the
 * anti-patterns, the predictor and the next steps read. A form that saves
 * nothing until the debt is named and rated (no default interest); the
 * age in sprints of the team's cadence and the capped score; edit in
 * place in a stable order; clearing the interest leaves it unset; resolve
 * and reopen with Undo; "Add to backlog" and the nudge once its story is
 * done; delete with Undo (canvas cards too); the hotspot over open debt
 * only; the time to pay down behind its minimum sample; the one-time move
 * of the old page's blob; the example; and the agent saying what the
 * page says.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const migrationMode = vi.hoisted(() => ({ value: "off" as string }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/data/use-legacy-migration-mode", () => ({
  useLegacyMigrationMode: () => migrationMode.value,
}));
vi.mock("@/lib/sync/cloud-blobs", () => ({ readCloudBlobs: vi.fn(async () => null) }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, jsonData }: { markdown?: string; jsonData?: unknown }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <pre data-testid="export-json">{JSON.stringify(jsonData)}</pre>
    </>
  ),
}));
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/tech-debt/charts", () => ({ ResolutionSurvivalChart: () => null }));

import { TechDebtClient } from "@/app/(tools)/tech-debt/tech-debt-client";
import {
  ageLabel,
  countedDebt,
  heatTone,
  hotspotGrid,
  scoreSum,
  survivalChartText,
  timeToResolve,
} from "@/app/(tools)/tech-debt/analysis";
import { buildExample } from "@/app/(tools)/tech-debt/example";
import { toMarkdown } from "@/app/(tools)/tech-debt/markdown";
import {
  emptyDebtDraft,
  parseInterest,
  resolvedDayError,
  validateDebtDraft,
  type DebtDraft,
} from "@/app/(tools)/tech-debt/debt-form";
import { conflictText, withBlobValue } from "@/app/(tools)/tech-debt/conflict-notice";
import { debtCsv, withPatch } from "@/app/(tools)/tech-debt/view";
import { timeToResolve as agentTimeToResolve } from "@/lib/actions/tools/tech-debt";
import "@/lib/actions/tools/tech-debt";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-27";
const ago = (n: number) => {
  const d = new Date(2026, 9, 27 - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const debt = (over: Partial<TechDebtItem> = {}): TechDebtItem => ({
  id: "d1",
  title: "Flaky deploy script",
  impact: 3,
  effort: 3,
  raisedAt: ago(10),
  ...over,
});

const card = (id: string, entityId: string): WhiteboardObject =>
  ({
    id,
    boardId: "b",
    type: "card",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 0,
    version: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    title: "Card",
    sourceRef: { tool: "techDebt", entityId },
  }) as unknown as WhiteboardObject;

const ws = () => useWorkspaceStore.getState();
const find = (id: string) => ws().techDebt.find((t) => t.id === id);
const seed = (techDebt: TechDebtItem[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    techDebt,
    stories: [],
    whiteboardObjects: [],
    ceremonyCadences: [],
    ...extra,
  });
const cadence = (sprintLengthDays: number) => ({
  ceremonyCadences: [{ id: CEREMONY_CADENCE_ID, sprintLengthDays }],
});
const blob = (rows: unknown) => localStorage.setItem(TECH_DEBT_KEY, JSON.stringify(rows));
const movedIds = (): unknown => JSON.parse(localStorage.getItem(TECH_DEBT_MOVED_KEY) ?? "null");

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <TechDebtClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** The items on screen, in order, by id. */
const order = () =>
  Array.from(document.querySelectorAll("[data-debt-title]")).map((b) =>
    b.getAttribute("data-debt-title")
  );
const row = (id: string) => document.getElementById(`debt-${id}`) as HTMLElement;
const pick = (scope: HTMLElement, group: string, value: number) =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: String(value),
    })
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(id: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(id)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 9, 0, 0));
  toastSpy.mockReset();
  logs.length = 0;
  migrationMode.value = "off";
  localStorage.clear();
  seed([]);
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("the New debt form's checks", () => {
  const draft = (patch: Partial<DebtDraft> = {}): DebtDraft => ({
    ...emptyDebtDraft(TODAY),
    ...patch,
  });

  it("starts unrated with no interest, and refuses a blank or unrated item", () => {
    expect(emptyDebtDraft(TODAY)).toMatchObject({
      impact: null,
      effort: null,
      interestRate: "",
      raisedAt: TODAY,
    });
    const v = validateDebtDraft(draft({ title: " " }), TODAY);
    expect(v.ok || v.errors).toEqual({
      title: "Name the debt.",
      impact: "Rate how much it slows the team.",
      effort: "Rate the effort to pay it down.",
    });
  });

  it("an empty interest is 'not estimated', never 0; a bad one says why", () => {
    expect(parseInterest("")).toEqual({});
    expect(parseInterest("  ")).toEqual({});
    expect(parseInterest("0")).toEqual({ value: 0 });
    expect(parseInterest("1.5")).toEqual({ value: 1.5 });
    expect(parseInterest("-1")).toEqual({ error: "It can't be negative." });
    expect(parseInterest("101")).toEqual({ error: "Keep it to 100 or less." });
    expect(parseInterest("abc")).toEqual({ error: "Enter a number, or leave it empty." });
    const v = validateDebtDraft(draft({ title: "X", impact: 4, effort: 2 }), TODAY);
    expect(v).toEqual({
      ok: true,
      values: { title: "X", impact: 4, effort: 2, raisedAt: TODAY },
    });
  });

  it("dates: the raised day is backdatable, never later than today", () => {
    const base = { title: "X", impact: 2, effort: 2 };
    const future = validateDebtDraft(draft({ ...base, raisedAt: "2026-10-28" }), TODAY);
    expect(future.ok || future.errors.raisedAt).toBe("Pick today or an earlier day.");
    expect(validateDebtDraft(draft({ ...base, raisedAt: "2025-01-02" }), TODAY).ok).toBe(true);
    expect(resolvedDayError("2026-09-30", "2026-10-01", TODAY)).toBe(
      "Pick a day on or after the day it was raised."
    );
    expect(resolvedDayError("2026-10-28", "2026-10-01", TODAY)).toBe(
      "Pick today or an earlier day."
    );
    expect(resolvedDayError("2026-10-01", "2026-10-01", TODAY)).toBeNull();
  });
});

describe("age in sprints and the capped score", () => {
  it("counts whole sprints of the cadence, and stops when paid down", () => {
    expect(debtAgeSprints(debt({ raisedAt: TODAY }), 14, TODAY)).toBe(0);
    expect(debtAgeSprints(debt({ raisedAt: ago(13) }), 14, TODAY)).toBe(0);
    expect(debtAgeSprints(debt({ raisedAt: ago(14) }), 14, TODAY)).toBe(1);
    expect(debtAgeSprints(debt({ raisedAt: ago(21) }), 7, TODAY)).toBe(3);
    expect(debtAgeSprints(debt({ raisedAt: ago(21) }), 21, TODAY)).toBe(1);
    expect(debtAgeSprints(debt({ raisedAt: "soon" }), 14, TODAY)).toBeNull();
    expect(debtAgeSprints(debt({ raisedAt: "2026-11-30" }), 14, TODAY)).toBe(0);
    expect(debtAgeSprints(debt({ raisedAt: ago(100), resolvedAt: ago(72) }), 14, TODAY)).toBe(2);
  });

  it("labels the age with the sprint length, and the score with how it adds up", () => {
    expect(ageLabel(4, 14)).toBe("≈ 4 sprints (14-day sprints)");
    expect(ageLabel(1, 7)).toBe("≈ 1 sprint (7-day sprints)");
    expect(ageLabel(0, 14)).toBe("Under a sprint old (14-day sprints)");
    expect(ageLabel(null, 14)).toBe("Age unknown: no raised day");
    const capped = debtScore({ impact: 4, effort: 2, interestRate: 3 }, 20);
    expect(capped).toEqual({ base: 14, interest: INTEREST_CAP, capped: true, total: 24 });
    expect(scoreSum({ impact: 4, effort: 2 }, capped)).toBe(
      "4 × 4 − 2 + 10 interest (capped at 10)"
    );
    expect(scoreSum({ impact: 4, effort: 2 }, debtScore({ impact: 4, effort: 2 }, 3))).toBe(
      "4 × 4 − 2"
    );
  });

  it("an old trivial item never outranks a fresh critical one", () => {
    const old = debt({
      id: "old",
      title: "Old",
      impact: 1,
      effort: 5,
      interestRate: 100,
      raisedAt: "2016-01-01",
    });
    const fresh = debt({ id: "new", title: "New", impact: 5, effort: 1, raisedAt: TODAY });
    expect(debtScore(old, 1000).total).toBe(-1 + INTEREST_CAP);
    expect(rankedDebt([old, fresh], 14, TODAY).map((r) => r.item.id)).toEqual(["new", "old"]);
  });

  it("the hotspot reads open debt only", () => {
    const list = [
      debt({ id: "a", area: "billing", impact: 5, effort: 1 }),
      debt({ id: "b", area: "search", impact: 2, effort: 1, resolvedAt: ago(1) }),
      debt({ id: "c", area: "search", impact: 2, effort: 2 }),
    ];
    expect(debtSummary(list, 14, TODAY).hotspot).toEqual({ area: "billing", impact: 5 });
    const { grid, open } = hotspotGrid(list);
    expect(open).toBe(2);
    expect(grid[4][0]).toBe(1);
    expect(grid[1][0]).toBe(0);
    expect(heatTone(0)).toBe("border-border text-sub");
    expect(heatTone(3)).toContain("bg-accent/30");
  });

  it("the time to pay down waits for 5 paid-down items", () => {
    const paid = (id: string, days: number) =>
      debt({ id, raisedAt: ago(days + 1), resolvedAt: ago(1) });
    const four = [paid("a", 2), paid("b", 4), paid("c", 6), paid("d", 8)];
    expect(timeToResolve(four, TODAY)).toEqual({
      resolved: 4,
      points: [],
      medianDays: null,
      interval: null,
    });
    const five = timeToResolve([...four, paid("e", 10)], TODAY);
    expect(five.resolved).toBe(5);
    expect(five.medianDays).toBe(6);
    expect(five.points[0]).toEqual({ t: 0, survival: 1 });
    expect(survivalChartText(five).summary).toMatch(/^Half the items are paid down within 6 days/);
  });

  it("counts the team's items, or the example's while it is all there is", () => {
    const example = buildExample(new Date(2026, 9, 27));
    expect(debtVerdict(example, 14, TODAY)).toBe("No tech debt logged yet.");
    expect(debtVerdict(countedDebt(example), 14, TODAY)).toMatch(/^5 open items cost about/);
    expect(countedDebt([...example, debt({ id: "mine" })]).map((t) => t.id)).toEqual(["mine"]);
  });
});

describe("edits", () => {
  it("withPatch removes an emptied optional field", () => {
    const t = debt({ area: "ci", interestRate: 2, resolvedAt: ago(1) });
    const next = withPatch(t, { area: "", interestRate: undefined, resolvedAt: undefined });
    expect(next).not.toHaveProperty("area");
    expect(next).not.toHaveProperty("interestRate");
    expect(next).not.toHaveProperty("resolvedAt");
  });

  it("the old page's value goes back on the scale it was compared on", () => {
    const t = debt({ impact: 2, interestRate: 1 });
    expect(withBlobValue(t, { id: "d1", field: "impact", blob: 5, workspace: 2 }).impact).toBe(5);
    expect(
      withBlobValue(t, { id: "d1", field: "interestRate", blob: 3, workspace: 1 }).interestRate
    ).toBe(3);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("adding debt", () => {
  it("saves nothing blank or unrated, then saves without inventing an interest", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New debt" }));
    fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
    expect(screen.getByText("Name the debt.")).toBeInTheDocument();
    expect(screen.getByText("Rate how much it slows the team.")).toBeInTheDocument();
    expect(screen.getByText("Rate the effort to pay it down.")).toBeInTheDocument();
    expect(ws().techDebt).toEqual([]);
    const title = screen.getByRole("textbox", { name: "Debt" });
    expect(title).toHaveFocus();

    fireEvent.change(title, { target: { value: "Old ORM" } });
    const form = title.closest("form") as HTMLElement;
    pick(form, "Impact", 3);
    pick(form, "Effort", 4);
    fireEvent.submit(form);
    expect(ws().techDebt).toHaveLength(1);
    expect(ws().techDebt[0]).toMatchObject({
      title: "Old ORM",
      impact: 3,
      effort: 4,
      raisedAt: TODAY,
    });
    expect(ws().techDebt[0]).not.toHaveProperty("interestRate");
    expect(ws().techDebt[0].id).toMatch(/^td_/);
    expect(typeof ws().techDebt[0].updatedAt).toBe("string");
    expect(logs.map((l) => l.action)).toContain("item_added");
  });
});

describe("the list", () => {
  it("shows the age in the cadence's sprints and the capped score", () => {
    seed(
      [debt({ id: "a", title: "Alpha", impact: 4, effort: 2, interestRate: 3, raisedAt: ago(70) })],
      cadence(7)
    );
    renderPage();
    expect(within(row("a")).getByText("≈ 10 sprints (7-day sprints)")).toBeInTheDocument();
    expect(within(row("a")).queryByText("Tags:")).toBeNull();
    expect(within(row("a")).getByText("capped")).toBeInTheDocument();
    expect(
      within(row("a")).getByText("4 × 4 − 2 + 10 interest (capped at 10)")
    ).toBeInTheDocument();
  });

  it("keeps its order while a rating changes, until Re-sort", () => {
    seed([
      debt({ id: "a", title: "Alpha", impact: 5, effort: 1 }),
      debt({ id: "b", title: "Beta", impact: 1, effort: 5 }),
    ]);
    renderPage();
    expect(order()).toEqual(["a", "b"]);
    const beta = within(row("b")).getByRole("group", { name: "Ratings for Beta" });
    pick(beta, "Impact", 5);
    pick(beta, "Effort", 1);
    pick(within(row("a")).getByRole("group", { name: "Ratings for Alpha" }), "Impact", 1);
    expect(order()).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(order()).toEqual(["b", "a"]);
  });

  it("clearing the interest leaves it unset, never 0", () => {
    seed([debt({ id: "a", title: "Alpha", interestRate: 2 })]);
    renderPage();
    const input = within(row("a")).getByRole("textbox", {
      name: "Interest per sprint for Alpha",
    });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(find("a")).not.toHaveProperty("interestRate");
    expect(within(row("a")).getByText("Interest not estimated")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.blur(input);
    expect(find("a")?.interestRate).toBe(1.5);
  });

  it("resolves on today with Undo, backdates, and reopens with Undo", () => {
    seed([debt({ id: "a", title: "Alpha", raisedAt: ago(30) })]);
    renderPage();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Mark resolved: Alpha" }));
    expect(find("a")?.resolvedAt).toBe(TODAY);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Resolved “Alpha”");
    const day = within(row("a")).getByLabelText("Paid down on, Alpha");
    fireEvent.change(day, { target: { value: ago(40) } });
    fireEvent.blur(day);
    expect(
      within(row("a")).getByText("Pick a day on or after the day it was raised.")
    ).toBeInTheDocument();
    fireEvent.change(day, { target: { value: ago(3) } });
    fireEvent.blur(day);
    expect(find("a")?.resolvedAt).toBe(ago(3));

    fireEvent.click(within(row("a")).getByRole("button", { name: "Reopen: Alpha" }));
    expect(find("a")).not.toHaveProperty("resolvedAt");
    undoLast();
    expect(find("a")?.resolvedAt).toBe(ago(3));
  });

  it("deletes with Undo, the canvas card unpinned and pinned back", () => {
    seed([debt({ id: "a", title: "Alpha" }), debt({ id: "b", title: "Beta" })], {
      whiteboardObjects: [card("o1", "a")],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(ws().techDebt.map((t) => t.id)).toEqual(["b"]);
    expect(ws().whiteboardObjects).toHaveLength(1);
    expect(ws().whiteboardObjects?.[0]?.sourceRef).toBeUndefined();
    undoLast();
    expect(
      ws()
        .techDebt.map((t) => t.id)
        .sort()
    ).toEqual(["a", "b"]);
    expect(ws().whiteboardObjects?.[0]?.sourceRef).toEqual({ tool: "techDebt", entityId: "a" });
  });
});

describe("add to backlog", () => {
  it("creates an unestimated backlog story linked back; Undo removes both", () => {
    seed([debt({ id: "a", title: "Alpha", impact: 4, effort: 2 })]);
    renderPage();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Add to backlog: Alpha" }));
    const [story] = ws().stories;
    expect(story).toMatchObject({
      title: "Alpha",
      status: "backlog",
      sourceRef: { tool: "tech-debt", id: "a" },
    });
    expect(story).not.toHaveProperty("points");
    expect(find("a")?.sentTo).toEqual([
      expect.objectContaining({ route: "backlog-story", targetId: story.id }),
    ]);
    expect(within(row("a")).getByText("On the backlog")).toBeInTheDocument();
    expect(logs.find((l) => l.action === "item_sent_to_backlog")?.payload).toEqual({
      itemId: "a",
      storyId: story.id,
    });
    undoLast();
    expect(ws().stories).toEqual([]);
    expect(find("a")).not.toHaveProperty("sentTo");
  });

  it("says when its story is done, and isn't offered for an example or paid-down item", () => {
    const story: Story = { id: "s1", title: "Alpha", status: "done" };
    seed(
      [
        debt({
          id: "a",
          title: "Alpha",
          sentTo: [{ route: "backlog-story", targetId: "s1", at: "2026-10-20T09:00:00.000Z" }],
        }),
        debt({ id: "example-x", title: "Sample" }),
        debt({ id: "p", title: "Paid", resolvedAt: ago(1) }),
      ],
      { stories: [story] }
    );
    renderPage();
    expect(within(row("a")).getByText("Its backlog story is done")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add to backlog/ })).toBeNull();
  });
});

describe("the statistics on the page", () => {
  it("show what is missing below the minimum", () => {
    seed([debt({ id: "a", title: "Alpha", resolvedAt: ago(1) })]);
    renderPage();
    expect(
      screen.getByText("Pay down 4 more paid-down items to see how long debt takes to pay down.")
    ).toBeInTheDocument();
  });

  it("read '—' for the interest when nothing is estimated", () => {
    seed([debt({ id: "a", title: "Alpha" })]);
    renderPage();
    expect(screen.getByText("None estimated yet")).toBeInTheDocument();
  });
});

/* ── The one-time move ──────────────────────────────────────────────── */

describe("the move from the old page's blob", () => {
  it("lists pending rows before the move, then moves them once and keeps the blob", async () => {
    const old = [
      {
        id: "old-1",
        title: "Old page debt",
        impact: 4,
        effort: 2,
        interestRate: 1,
        raisedAt: ago(9),
      },
      { id: "blank", title: "", impact: 3, effort: 3, interestRate: 1, raisedAt: ago(9) },
    ];
    blob(old);
    const first = renderPage();
    expect(order()).toEqual(["old-1"]);
    expect(screen.getByText(/still moving in/)).toBeInTheDocument();
    first.unmount();

    migrationMode.value = "local";
    const second = renderPage();
    await waitFor(() => expect(movedIds()).toEqual(["old-1", "blank"]));
    expect(ws().techDebt.map((t) => t.id)).toEqual(["old-1"]);
    expect(JSON.parse(localStorage.getItem(TECH_DEBT_KEY)!)).toEqual(old);
    second.unmount();

    const before = ws().techDebt;
    renderPage();
    expect(ws().techDebt).toBe(before);
  });

  it("a delete before the move stays deleted", () => {
    blob([{ id: "old-1", title: "Old page debt", impact: 2, effort: 2, raisedAt: ago(9) }]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Old page debt" }));
    expect(movedIds()).toEqual(["old-1"]);
    migrationMode.value = "local";
    renderPage();
    expect(ws().techDebt).toEqual([]);
  });

  it("keeps a resolve made on the old page, and offers a value edited on both sides once", async () => {
    blob([
      { id: "x", title: "Old title", impact: 5, effort: 2, raisedAt: ago(9), resolvedAt: ago(2) },
    ]);
    seed([debt({ id: "x", title: "New title", impact: 2, effort: 2, raisedAt: ago(9) })]);
    migrationMode.value = "local";
    renderPage();
    const notice = await screen.findByRole("region", { name: "Edited on the old Tech Debt page" });
    expect(find("x")?.resolvedAt).toBe(ago(2));
    fireEvent.click(
      within(notice).getByRole("button", {
        name: "Use this instead: the old page's impact for New title",
      })
    );
    expect(find("x")?.impact).toBe(5);
    undoLast();
    expect(find("x")?.impact).toBe(2);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Edited on the old Tech Debt page" })).getByRole(
        "button",
        { name: "Keep the title in the tracker: New title" }
      )
    );
    expect(screen.queryByRole("region", { name: "Edited on the old Tech Debt page" })).toBeNull();
  });

  it("names how many items only the workspace had, once", async () => {
    blob([{ id: "old-1", title: "Old", impact: 2, effort: 2, raisedAt: ago(9) }]);
    seed([debt({ id: "agent-1", title: "From an agent" })]);
    migrationMode.value = "local";
    const first = renderPage();
    expect(
      await screen.findByText(/1 item the old Tech Debt page didn't list is now here/)
    ).toBeInTheDocument();
    first.unmount();
    renderPage();
    expect(screen.queryByText(/didn't list/)).toBeNull();
  });
});

/* ── The example and the exports ────────────────────────────────────── */

describe("the example", () => {
  it("loads, counts while alone, isn't sent to the backlog, and clears with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(ws().techDebt).toHaveLength(6);
    expect(ws().techDebt.every((t) => t.id.startsWith("example-"))).toBe(true);
    expect(screen.getByText(/^5 open items cost about/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add to backlog/ })).toBeNull();
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(ws().techDebt).toEqual([]);
    undoLast();
    expect(ws().techDebt).toHaveLength(6);
  });

  it("has one resolved, one unestimated and capped items, and the cap keeps the SDK on top", () => {
    const ex = countedDebt(buildExample(new Date(2026, 9, 27)));
    const ranked = rankedDebt(ex, 14, TODAY);
    expect(ex.filter((t) => t.resolvedAt)).toHaveLength(1);
    expect(ex.filter((t) => t.interestRate === undefined)).toHaveLength(1);
    expect(ranked.filter((r) => r.score.capped).length).toBeGreaterThanOrEqual(2);
    const sdk = ranked.findIndex((r) => r.item.title.startsWith("Payment SDK"));
    const forms = ranked.findIndex((r) => r.item.title.startsWith("Copy-pasted"));
    expect(sdk).toBeLessThan(forms);
  });
});

describe("Markdown and CSV", () => {
  it("lead with the verdict and list each item with its age, capped score and backlog", () => {
    const list = [
      debt({
        id: "a",
        title: "Date | maths",
        area: "billing",
        impact: 4,
        effort: 2,
        interestRate: 3,
        raisedAt: ago(300),
      }),
      debt({ id: "b", title: "Search", impact: 3, effort: 1, raisedAt: ago(20) }),
      debt({
        id: "c",
        title: "Logging",
        impact: 2,
        effort: 3,
        raisedAt: ago(60),
        resolvedAt: ago(5),
      }),
    ];
    const md = toMarkdown(list, new Date(2026, 9, 27), {
      backlog: (t) => (t.id === "a" ? "sent" : null),
    });
    expect(md).toMatch(/^# Tech Debt — 27 Oct 2026\n\n2 open items cost about 3 points a sprint/);
    expect(md).toContain(
      "3 items: 2 open, 1 paid down. Interest on the open debt: about 3 points a sprint (1 not estimated). Ages are in 14-day sprints (the default: the team hasn't set a sprint length)."
    );
    expect(toMarkdown(list, new Date(2026, 9, 27), { sprintLengthDays: 14 })).toContain(
      "Ages are in 14-day sprints.\n"
    );
    expect(md).toContain(
      "| 1 | Date \\| maths | billing | 4 | 2 | 3 | 21 | 24 (capped) | On the backlog | Open |"
    );
    expect(md).toContain("| 2 | Search |  | 3 | 1 | Not estimated | 1 | 11 |  | Open |");
    expect(md).toContain(
      `| 3 | Logging |  | 2 | 3 | Not estimated | 3 | 5 |  | Paid down ${ago(5)} |`
    );
    expect(toMarkdown([], new Date(2026, 9, 27))).toBe(
      "# Tech Debt — 27 Oct 2026\n\nNo tech debt logged yet.\n"
    );
    const csv = debtCsv(list, 14, TODAY);
    expect(csv.headers).toEqual(expect.arrayContaining(["Age (sprints)", "Score", "Capped"]));
    expect(csv.rows[0]).toEqual(expect.arrayContaining(["Date | maths", 21, 14, 10, 24, "yes"]));
  });
});

/* ── The agent says what the page says ──────────────────────────────── */

describe("page and agent parity", () => {
  it("list_state gives the page's verdict, ages, scores and time to pay down", async () => {
    const paid = (id: string, days: number) =>
      debt({ id, title: id, raisedAt: ago(days + 1), resolvedAt: ago(1) });
    const list = [
      debt({ id: "a", title: "Alpha", impact: 4, effort: 2, interestRate: 2, raisedAt: ago(90) }),
      paid("p1", 3),
      paid("p2", 5),
      paid("p3", 7),
      paid("p4", 9),
      paid("p5", 11),
      debt({ id: "example-z", title: "Sample", impact: 5, effort: 1 }),
    ];
    seed(list, cadence(7));
    const state = await run<{
      sprintLengthDays: number;
      verdict: string;
      items: { id: string; ageSprints: number | null; score: { total: number; capped: boolean } }[];
      timeToResolve: { resolved: number; medianDays: number | null };
    }>("tool.tech_debt.list_state", { today: TODAY });
    const page = countedDebt(list);
    expect(state.sprintLengthDays).toBe(7);
    expect(state.verdict).toBe(debtVerdict(page, 7, TODAY));
    expect(state.items.find((i) => i.id === "a")).toMatchObject({
      ageSprints: 12,
      score: { total: 24, capped: true },
    });
    const ours = timeToResolve(page, TODAY);
    expect(state.timeToResolve).toEqual({ resolved: ours.resolved, medianDays: ours.medianDays });
    expect(agentTimeToResolve(page, TODAY).medianDays).toBe(ours.medianDays);
    renderPage();
    expect(screen.getByText(state.verdict)).toBeInTheDocument();
  });

  it("an agent's add_to_backlog shows on the page at once (one store)", async () => {
    seed([debt({ id: "a", title: "Alpha" })]);
    renderPage();
    await act(async () => {
      await run("tool.tech_debt.add_to_backlog", { id: "a" });
      await run("tool.tech_debt.add_tag", { id: "a", tag: "billing" });
    });
    expect(within(row("a")).getByText("On the backlog")).toBeInTheDocument();
    // A tag an agent added shows on the row.
    expect(within(row("a")).getByText("billing")).toBeInTheDocument();
  });
});

/* ── After the review ───────────────────────────────────────────────── */

describe("the interest field takes what was typed", () => {
  it("is a text field: typed junk says why and keeps the estimate, never erases it", () => {
    seed([debt({ id: "a", title: "Alpha", interestRate: 2 })]);
    renderPage();
    const input = within(row("a")).getByRole("textbox", { name: "Interest per sprint for Alpha" });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "decimal");
    for (const junk of ["1,5", "1e", "-"]) {
      fireEvent.change(input, { target: { value: junk } });
      fireEvent.blur(input);
      expect(find("a")?.interestRate).toBe(2);
      const error = within(row("a")).getByRole("alert");
      expect(error).toHaveTextContent("Enter a number, or leave it empty.");
      expect(input).toHaveAttribute("aria-describedby", error.id);
      expect(input).toHaveAttribute("aria-invalid", "true");
    }
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.blur(input);
    expect(find("a")?.interestRate).toBe(1.5);
    expect(within(row("a")).queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("the New debt form refuses typed junk instead of saving 'not estimated'", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New debt" }));
    const title = screen.getByRole("textbox", { name: "Debt" });
    fireEvent.change(title, { target: { value: "Old ORM" } });
    const form = title.closest("form") as HTMLElement;
    pick(form, "Impact", 3);
    pick(form, "Effort", 4);
    const interest = within(form).getByRole("textbox", { name: "Interest per sprint" });
    expect(interest).toHaveAttribute("type", "text");
    fireEvent.change(interest, { target: { value: "1,5" } });
    fireEvent.submit(form);
    expect(ws().techDebt).toEqual([]);
    expect(within(form).getByText("Enter a number, or leave it empty.")).toBeInTheDocument();
    fireEvent.change(interest, { target: { value: "1.5" } });
    fireEvent.submit(form);
    expect(ws().techDebt[0]).toMatchObject({ title: "Old ORM", interestRate: 1.5 });
  });
});

describe("the Markdown when nothing is estimated", () => {
  it("never writes 'about 0 points': it says none of the open debt is estimated", () => {
    const md = toMarkdown(
      [debt({ id: "a", title: "Alpha" }), debt({ id: "b", title: "Beta" })],
      new Date(2026, 9, 27),
      { sprintLengthDays: 14 }
    );
    expect(md).toContain(
      "2 items: 2 open, 0 paid down. None of the open debt has an interest estimate. Ages are in 14-day sprints."
    );
    expect(md).not.toContain("about 0");
    // Nothing open: no interest sentence at all.
    expect(
      toMarkdown([debt({ id: "c", title: "Gone", resolvedAt: ago(1) })], new Date(2026, 9, 27), {
        sprintLengthDays: 14,
      })
    ).toContain("1 item: 0 open, 1 paid down. Ages are in 14-day sprints.");
  });
});

describe("the exports beside the example", () => {
  it("list and count only the team's items, and say how many example items are left out", () => {
    const now = new Date(2026, 9, 27);
    const list = [
      ...buildExample(now),
      debt({ id: "mine", title: "Mine", interestRate: 1, raisedAt: ago(28) }),
    ];
    const md = toMarkdown(list, now, { sprintLengthDays: 14 });
    expect(md).toContain(
      "1 item: 1 open, 0 paid down. Interest on the open debt: about 1 point a sprint. Ages are in 14-day sprints. The example's 6 items are left out."
    );
    expect(md).toContain("| 1 | Mine |");
    expect(md).not.toContain("billing");
    expect(debtCsv(list, 14, TODAY).rows.map((r) => r[0])).toEqual(["Mine"]);

    // The example alone is the tracker: listed and counted.
    const alone = toMarkdown(buildExample(now), now, { sprintLengthDays: 14 });
    expect(alone).toContain("6 items: 5 open, 1 paid down.");
    expect(alone).not.toContain("left out");
    expect(debtCsv(buildExample(now), 14, TODAY).rows).toHaveLength(6);
  });
});

describe("the sprint length the ages use", () => {
  it("says when it is the default, and the example's note names the team's length", () => {
    seed([debt({ id: "a", title: "Alpha" })]);
    const first = renderPage();
    expect(
      screen.getByText("14-day sprints, the default: the team hasn't set a sprint length")
    ).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "Ages are in 14-day sprints (the default: the team hasn't set a sprint length)."
    );
    first.unmount();

    seed([], cadence(7));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("7-day sprints")).toBeInTheDocument();
    expect(screen.getByText(/aged in your 7-day sprints/)).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "Ages are in 7-day sprints."
    );
  });

  it("moves a cadence still in the old per-browser blob in, as the other cadence readers do", () => {
    localStorage.setItem(CADENCE_KEY, JSON.stringify({ sprintLengthDays: 7 }));
    seed([debt({ id: "a", title: "Alpha", raisedAt: ago(21) })]);
    renderPage();
    expect(ws().ceremonyCadences).toEqual([
      expect.objectContaining({ id: CEREMONY_CADENCE_ID, sprintLengthDays: 7 }),
    ]);
    expect(within(row("a")).getByText("≈ 3 sprints (7-day sprints)")).toBeInTheDocument();
  });
});

describe("the re-sort chip", () => {
  it("names statuses too: resolving an item moves it below the open ones", () => {
    seed([
      debt({ id: "a", title: "Alpha", impact: 5, effort: 1 }),
      debt({ id: "b", title: "Beta", impact: 1, effort: 5 }),
    ]);
    renderPage();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Mark resolved: Alpha" }));
    expect(screen.getByText(/Scores or statuses changed since the last sort/)).toBeInTheDocument();
  });
});

describe("the conflict notice reads the tracker as it is now", () => {
  const notice = () => screen.queryByRole("region", { name: "Edited on the old Tech Debt page" });
  const setItem = (patch: Partial<TechDebtItem>) =>
    act(() =>
      useWorkspaceStore.setState({
        techDebt: ws().techDebt.map((t) => (t.id === "x" ? { ...t, ...patch } : t)),
      })
    );
  const start = async () => {
    blob([{ id: "x", title: "Old title", impact: 5, effort: 2, raisedAt: ago(9) }]);
    seed([debt({ id: "x", title: "New title", impact: 2, effort: 2, raisedAt: ago(9) })]);
    migrationMode.value = "local";
    renderPage();
    await screen.findByRole("region", { name: "Edited on the old Tech Debt page" });
  };

  it("shows an edit made while it is open, and Undo goes back to that value", async () => {
    await start();
    setItem({ impact: 4 });
    expect(within(notice()!).getByText(conflictText("impact", 4))).toBeInTheDocument();
    expect(within(notice()!).queryByText(conflictText("impact", 2))).toBeNull();
    fireEvent.click(
      within(notice()!).getByRole("button", {
        name: "Use this instead: the old page's impact for New title",
      })
    );
    expect(find("x")?.impact).toBe(5);
    undoLast();
    expect(find("x")?.impact).toBe(4);
  });

  it("drops a value that now matches the old page's", async () => {
    await start();
    expect(within(notice()!).getAllByRole("listitem")).toHaveLength(2);
    setItem({ title: "Old title" });
    expect(within(notice()!).getAllByRole("listitem")).toHaveLength(1);
    setItem({ impact: 5 });
    expect(notice()).toBeNull();
  });

  it("settling one lands on the next, then on New debt", async () => {
    await start();
    fireEvent.click(
      within(notice()!).getByRole("button", { name: "Keep the title in the tracker: New title" })
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Keep the impact in the tracker: New title" })
      )
    );
    fireEvent.click(document.activeElement!);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "New debt" }))
    );
  });
});

describe("focus after an action replaces its button", () => {
  it("Mark resolved lands on the paid-down day, Reopen on Mark resolved", async () => {
    seed([debt({ id: "a", title: "Alpha", raisedAt: ago(30) })]);
    renderPage();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Mark resolved: Alpha" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(row("a")).getByLabelText("Paid down on, Alpha"))
    );
    fireEvent.click(within(row("a")).getByRole("button", { name: "Reopen: Alpha" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("a")).getByRole("button", { name: "Mark resolved: Alpha" })
      )
    );
  });

  it("Add to backlog lands on the link to the story", async () => {
    seed([debt({ id: "a", title: "Alpha" })]);
    renderPage();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Add to backlog: Alpha" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("a")).getByRole("link", { name: /On the backlog/ })
      )
    );
  });

  it("dismissing the appeared notice and clearing the example land on New debt", async () => {
    blob([{ id: "old-1", title: "Old", impact: 2, effort: 2, raisedAt: ago(9) }]);
    seed([debt({ id: "agent-1", title: "From an agent" })]);
    migrationMode.value = "local";
    const first = renderPage();
    await screen.findByText(/1 item the old Tech Debt page didn't list/);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "New debt" }))
    );
    first.unmount();

    seed([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "New debt" }))
    );
  });
});

/* ── After the second review ────────────────────────────────────────── */

describe("the JSON export beside the example", () => {
  it("lists the team's items only, as the Markdown and the CSV do", () => {
    seed([...buildExample(new Date(2026, 9, 27)), debt({ id: "mine", title: "Mine" })]);
    renderPage();
    const json = JSON.parse(
      screen.getByTestId("export-json").textContent ?? "[]"
    ) as TechDebtItem[];
    expect(json.map((t) => t.id)).toEqual(["mine"]);
  });

  it("lists the example's while it is all there is", () => {
    seed(buildExample(new Date(2026, 9, 27)));
    renderPage();
    const json = JSON.parse(
      screen.getByTestId("export-json").textContent ?? "[]"
    ) as TechDebtItem[];
    expect(json).toHaveLength(buildExample(new Date(2026, 9, 27)).length);
  });
});

describe("the interest suggestion beside the example", () => {
  const interest = (id: string, title: string) =>
    within(row(id)).getByRole("textbox", { name: `Interest per sprint for ${title}` });

  it("is offered from the team's own items, and Tab takes it", () => {
    bootstrapPredictions();
    seed([
      ...[2, 1, 1, 1, 1].map((rate, i) =>
        debt({ id: `r${i}`, title: `Rated ${i}`, interestRate: rate })
      ),
      debt({ id: "mine", title: "Mine" }),
    ]);
    renderPage();
    const input = interest("mine", "Mine");
    expect(input).toHaveAttribute("placeholder", "1.2");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(find("mine")?.interestRate).toBe(1.2);
  });

  it("isn't offered while the example is loaded: its made-up rates never reach the team's item", () => {
    bootstrapPredictions();
    // The example alone gives the predictor 5 rates (mean 0.9, medium).
    seed([...buildExample(new Date(2026, 9, 27)), debt({ id: "mine", title: "Mine" })]);
    renderPage();
    const input = interest("mine", "Mine");
    expect(input).toHaveAttribute("placeholder", "Not estimated");
    expect(
      within(row("mine")).queryByRole("button", { name: /^(Predicted|Suggested):/ })
    ).toBeNull();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(find("mine")).not.toHaveProperty("interestRate");
  });
});

describe("the items the move found only in the workspace", () => {
  it("are named with a link to each row; one deleted leaves the notice", async () => {
    blob([{ id: "old-1", title: "Old", impact: 2, effort: 2, raisedAt: ago(9) }]);
    seed(
      Array.from({ length: 7 }, (_, i) =>
        debt({ id: `agent-${i + 1}`, title: `From an agent ${i + 1}` })
      )
    );
    migrationMode.value = "local";
    renderPage();
    await screen.findByText(/7 items the old Tech Debt page didn't list are now here/);
    const named = () => within(screen.getByRole("list", { name: "Now on the page" }));
    const links = named().getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAccessibleName("From an agent 1");
    expect(links[0].getAttribute("href")).toBe("#debt-agent-1");
    expect(document.getElementById("debt-agent-1")).not.toBeNull();
    expect(named().getByText("and 2 more")).toBeInTheDocument();

    fireEvent.click(within(row("agent-1")).getByRole("button", { name: "Delete From an agent 1" }));
    expect(screen.getByText(/6 items the old Tech Debt page didn't list/)).toBeInTheDocument();
    expect(named().queryByRole("link", { name: "From an agent 1" })).toBeNull();
    expect(named().getByText("and 1 more")).toBeInTheDocument();
  });
});
