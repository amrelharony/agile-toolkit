import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment, Risk, WhiteboardObject } from "@/lib/stores/workspace-types";
import { RISK_REGISTER_KEY, RISK_REGISTER_MOVED_KEY } from "@/lib/risks/legacy-register";
import { closedOn, riskDaysOverdue, riskSummary, riskVerdict } from "@/lib/risks/model";
import { registry } from "@/lib/actions/registry";

/**
 * Risk Register on one store (Phase 8): workspace.risks, which agents, the
 * premortem's hand-off, the dashboards and the next steps read. A form
 * that saves nothing until the risk is named and rated; edit in place in a
 * stable order; the owner from the roster; overdue mitigations; the rating
 * after mitigation (both or neither, a warning when higher); "Raise as
 * impediment" and "Close the risk" once it is resolved; delete with Undo
 * (canvas cards too); a reopened risk counting as open; the statistics
 * behind their minimum samples; the one-time move of the old page's blob
 * (pending rows, deletes before the move, idempotence, conflicts, the
 * rows only the workspace had, the blob kept); the example; and the agent
 * saying what the page says.
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
vi.mock("@/app/(tools)/risk-register/charts", () => ({ OpenRisksChart: () => null }));

import { RiskRegisterClient } from "@/app/(tools)/risk-register/risk-register-client";
import {
  analyseRisks,
  closedUndatedCount,
  countedRisks,
  riskMatrix,
  timeToClose,
  undatedClosedNote,
  weeklyChartText,
  weeklyRiskSeries,
} from "@/app/(tools)/risk-register/analysis";
import { buildExample } from "@/app/(tools)/risk-register/example";
import { residualText, toMarkdown } from "@/app/(tools)/risk-register/markdown";
import {
  closedDayError,
  dueDayError,
  emptyRiskDraft,
  residualWarning,
  scorePreview,
  validateRiskDraft,
  type RiskDraft,
} from "@/app/(tools)/risk-register/risk-form";
import { conflictText, withBlobValue } from "@/app/(tools)/risk-register/conflict-notice";
import { risksCsv, withPatch, withStatus } from "@/app/(tools)/risk-register/view";
import { timeToClose as agentTimeToClose } from "@/lib/actions/tools/risk-register";
import "@/lib/actions/tools/risk-register";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-27";
const ago = (n: number) => {
  const d = new Date(2026, 9, 27 - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const risk = (over: Partial<Risk> = {}): Risk => ({
  id: "r1",
  title: "Vendor API rate limits",
  probability: 3,
  impact: 3,
  status: "open",
  raisedAt: ago(20),
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
    sourceRef: { tool: "risk", entityId },
  }) as unknown as WhiteboardObject;

const ws = () => useWorkspaceStore.getState();
const find = (id: string) => ws().risks.find((r) => r.id === id);
const seed = (risks: Risk[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    risks,
    impediments: [],
    whiteboardObjects: [],
    teamMembers: [
      { id: "m1", name: "Priya" },
      { id: "m2", name: "Sam" },
    ],
    ceremonyCadences: [],
    ...extra,
  });
const blob = (rows: unknown) => localStorage.setItem(RISK_REGISTER_KEY, JSON.stringify(rows));
const movedIds = (): unknown => JSON.parse(localStorage.getItem(RISK_REGISTER_MOVED_KEY) ?? "null");

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <RiskRegisterClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** The risks on screen, in order, by id. */
const order = () =>
  Array.from(document.querySelectorAll("[data-risk-title]")).map((b) =>
    b.getAttribute("data-risk-title")
  );
const row = (id: string) => document.getElementById(`risk-${id}`) as HTMLElement;
const ratings = (id: string, title: string) =>
  within(row(id)).getByRole("group", { name: `Ratings for ${title}` });
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

describe("the New risk form's checks", () => {
  const draft = (patch: Partial<RiskDraft> = {}): RiskDraft => ({
    ...emptyRiskDraft(TODAY),
    ...patch,
  });

  it("starts unrated and raised today, and refuses a blank or unrated risk", () => {
    expect(emptyRiskDraft(TODAY)).toMatchObject({
      probability: null,
      impact: null,
      raisedAt: TODAY,
      residualProbability: null,
      residualImpact: null,
    });
    const v = validateRiskDraft(draft({ title: "   " }), TODAY);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toEqual({
        title: "Name the risk.",
        probability: "Rate how likely it is.",
        impact: "Rate the impact.",
      });
    }
  });

  it("dates: the raised day is backdatable, never later than today; the due day not before it", () => {
    const base = { title: "X", probability: 2, impact: 3 };
    const future = validateRiskDraft(draft({ ...base, raisedAt: "2026-10-28" }), TODAY);
    expect(future.ok || future.errors.raisedAt).toBe("Pick today or an earlier day.");
    const blank = validateRiskDraft(draft({ ...base, raisedAt: "" }), TODAY);
    expect(blank.ok || blank.errors.raisedAt).toBe("Pick the day it was raised.");
    const early = validateRiskDraft(
      draft({ ...base, raisedAt: "2026-10-10", mitigationDueAt: "2026-10-09" }),
      TODAY
    );
    expect(early.ok || early.errors.mitigationDueAt).toBe(
      "Pick a day on or after the day it was raised."
    );
    // A due day in the past is fine: it is overdue, not invalid.
    const backdated = validateRiskDraft(
      draft({ ...base, raisedAt: "2026-09-01", mitigationDueAt: "2026-09-20" }),
      TODAY
    );
    expect(backdated.ok).toBe(true);
    expect(dueDayError("", "2026-10-01")).toBeNull();
    expect(dueDayError("2026-02-30", "2026-10-01")).toBe("Pick a day, or leave it empty.");
    expect(closedDayError("2026-10-28", "2026-10-01", TODAY)).toBe("Pick today or an earlier day.");
    expect(closedDayError("2026-09-30", "2026-10-01", TODAY)).toBe(
      "Pick a day on or after the day it was raised."
    );
    expect(closedDayError("2026-10-01", "2026-10-01", TODAY)).toBeNull();
  });

  it("the rating after mitigation is both or neither, and a higher one only warns", () => {
    const base = { title: "X", probability: 2, impact: 2 };
    const half = validateRiskDraft(draft({ ...base, residualProbability: 3 }), TODAY);
    expect(half.ok || half.errors.residualImpact).toBe(
      "Rate the impact after mitigation too, or clear both."
    );
    const higher = validateRiskDraft(
      draft({ ...base, residualProbability: 3, residualImpact: 4 }),
      TODAY
    );
    expect(higher.ok).toBe(true);
    expect(residualWarning(2, 2, 3, 4)).toBe(
      "After mitigation it scores 12, higher than 4 now. Saved as it is; check the ratings."
    );
    expect(residualWarning(4, 4, 2, 3)).toBeNull();
    expect(scorePreview(4, null)).toBeNull();
    expect(scorePreview(4, 4)).toBe("Scores 16 (critical)");
  });

  it("keeps the roster's spelling of the owner, and only the fields given", () => {
    const v = validateRiskDraft(
      draft({
        title: "  Key  reviewer away \n for two weeks ",
        probability: 4,
        impact: 2,
        owner: "priya ",
      }),
      TODAY,
      [{ id: "m1", name: "Priya" }]
    );
    expect(v).toEqual({
      ok: true,
      values: {
        title: "Key  reviewer away for two weeks",
        probability: 4,
        impact: 2,
        raisedAt: TODAY,
        owner: "Priya",
      },
    });
  });
});

describe("edits", () => {
  it("withPatch removes an emptied optional field; withStatus stamps only a close", () => {
    const r = risk({ owner: "Sam", mitigation: "Plan", resolvedAt: "2026-10-01", status: "open" });
    const cleared = withPatch(r, { owner: "", mitigation: undefined });
    expect(cleared).not.toHaveProperty("owner");
    expect(cleared).not.toHaveProperty("mitigation");
    expect(withPatch(r, { title: "" }).title).toBe("");
    expect(withStatus(r, "closed", TODAY)).toMatchObject({ status: "closed", resolvedAt: TODAY });
    // Reopening keeps the first close day, which counts only while closed.
    const reopened = withStatus({ ...r, status: "closed" }, "mitigating", TODAY);
    expect(reopened.resolvedAt).toBe("2026-10-01");
    expect(closedOn(reopened)).toBeUndefined();
  });

  it("the old page's value goes back on the scale it was compared on", () => {
    const r = risk({ probability: 2 });
    expect(
      withBlobValue(r, { id: "r1", field: "probability", blob: 5, workspace: 2 })
    ).toMatchObject({ probability: 5 });
    expect(
      withBlobValue(r, { id: "r1", field: "title", blob: "Old", workspace: "New" }).title
    ).toBe("Old");
  });
});

describe("overdue", () => {
  it("is active with a due day before today: due today, closed or accepted is not", () => {
    expect(riskDaysOverdue(risk({ mitigationDueAt: ago(1) }), TODAY)).toBe(1);
    expect(riskDaysOverdue(risk({ mitigationDueAt: TODAY }), TODAY)).toBe(0);
    expect(riskDaysOverdue(risk({ mitigationDueAt: ago(5), status: "closed" }), TODAY)).toBe(0);
    expect(riskDaysOverdue(risk({ mitigationDueAt: ago(5), status: "accepted" }), TODAY)).toBe(0);
    expect(riskDaysOverdue(risk({}), TODAY)).toBe(0);
  });
});

describe("the numbers behind the page", () => {
  it("a reopened risk counts as open in the weekly series and as waiting in the time to mitigate", () => {
    const reopened = risk({
      id: "a",
      raisedAt: ago(20),
      status: "mitigating",
      resolvedAt: ago(10),
    });
    const closed = risk({ id: "b", raisedAt: ago(20), status: "closed", resolvedAt: ago(10) });
    const points = weeklyRiskSeries([reopened, closed], TODAY);
    expect(points.at(-1)?.open).toBe(1);
    expect(timeToClose([reopened, closed], TODAY).closed).toBe(1);
  });

  it("leaves accepted risks out of 'open' and the time to mitigate; keeps quiet weeks", () => {
    const points = weeklyRiskSeries(
      [
        risk({ id: "a", raisedAt: ago(21) }),
        risk({ id: "b", raisedAt: ago(21), status: "accepted" }),
      ],
      TODAY
    );
    expect(points.map((p) => p.raised)).toEqual([2, 0, 0, 0]);
    expect(points.map((p) => p.open)).toEqual([1, 1, 1, 1]);
    expect(weeklyChartText(points).summary).toBe(
      "Over the last 4 weeks, 2 risks were raised and 1 open at the end of each week shown. Accepted risks aren't counted as open."
    );
    expect(weeklyRiskSeries([], TODAY)).toEqual([]);
    expect(weeklyRiskSeries([risk({ raisedAt: "soon" })], TODAY)).toEqual([]);
  });

  it("caps the series at the latest 26 weeks", () => {
    const points = weeklyRiskSeries([risk({ raisedAt: "2020-01-01" })], TODAY);
    expect(points).toHaveLength(26);
    expect((points.at(-1)?.to ?? "") >= TODAY).toBe(true);
  });

  it("the median time to mitigate waits for 3 closed risks", () => {
    const closed = (id: string, days: number) =>
      risk({ id, raisedAt: ago(days + 1), status: "closed", resolvedAt: ago(1) });
    expect(timeToClose([closed("a", 4), closed("b", 6)], TODAY)).toEqual({
      closed: 2,
      medianDays: null,
    });
    expect(timeToClose([closed("a", 4), closed("b", 6), closed("c", 8)], TODAY)).toEqual({
      closed: 3,
      medianDays: 6,
    });
  });

  it("the statistics need their minimum weeks", () => {
    const weeks = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        period: `2026-W${String(10 + i).padStart(2, "0")}`,
        from: "",
        to: "",
        raised: i % 3,
        open: i,
      }));
    expect(analyseRisks(weeks(3))).toEqual({ weeks: 3, trend: null, forecast: null, shifts: null });
    const four = analyseRisks(weeks(4));
    expect(four.forecast).toMatch(/^In 4 weeks, about \d+ risks? still open \(80% range/);
    expect(four.trend).toBeNull();
    const six = analyseRisks(weeks(6));
    expect(six.trend).toMatch(/Mann-Kendall p = /);
    expect(six.shifts).toBeNull();
    expect(analyseRisks(weeks(8)).shifts).toMatch(/CUSUM/);
  });

  it("the matrix places active risks now, and after mitigation only the assessed ones", () => {
    const list = [
      risk({ id: "a", probability: 4, impact: 4, residualProbability: 2, residualImpact: 3 }),
      risk({ id: "b", probability: 2, impact: 5 }),
      risk({ id: "c", probability: 5, impact: 5, status: "closed", resolvedAt: ago(1) }),
    ];
    const now = riskMatrix(list, "now");
    expect(now.placed).toBe(2);
    expect(now.grid[3][3]).toBe(1);
    expect(now.grid[1][4]).toBe(1);
    expect(now.grid[4][4]).toBe(0);
    const after = riskMatrix(list, "after");
    expect(after).toMatchObject({ placed: 1, unassessed: 1 });
    expect(after.grid[1][2]).toBe(1);
  });

  it("counts the team's risks, or the example's while it is all there is", () => {
    const example = buildExample(new Date(2026, 9, 27));
    expect(riskVerdict(example, TODAY)).toBe("No risks logged yet.");
    // The example's rows keep their own ids; the page counts them through the option.
    const counted = countedRisks(example);
    expect(counted.map((r) => r.id)).toEqual(example.map((r) => r.id));
    expect(riskVerdict(counted, TODAY, { includeExamples: true })).toMatch(
      /^1 mitigation is overdue/
    );
    const mixed = countedRisks([...example, risk({ id: "mine" })]);
    expect(mixed.map((r) => r.id)).toEqual(["mine"]);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("adding a risk", () => {
  it("saves nothing blank or unrated, focuses the first invalid field, then saves on Enter", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New risk" }));
    fireEvent.click(screen.getByRole("button", { name: "Add risk" }));
    expect(screen.getByText("Name the risk.")).toBeInTheDocument();
    expect(screen.getByText("Rate how likely it is.")).toBeInTheDocument();
    expect(screen.getByText("Rate the impact.")).toBeInTheDocument();
    expect(ws().risks).toEqual([]);
    const title = screen.getByRole("textbox", { name: "Risk" });
    expect(title).toHaveFocus();

    fireEvent.change(title, { target: { value: "Key reviewer away for two weeks" } });
    const form = title.closest("form") as HTMLElement;
    pick(form, "Likelihood", 4);
    pick(form, "Impact", 2);
    expect(within(form).getByText("Scores 8 (medium)")).toBeInTheDocument();
    fireEvent.change(within(form).getByRole("combobox", { name: "Owner" }), {
      target: { value: "sam" },
    });
    fireEvent.submit(form);

    expect(ws().risks).toHaveLength(1);
    expect(ws().risks[0]).toMatchObject({
      title: "Key reviewer away for two weeks",
      probability: 4,
      impact: 2,
      status: "open",
      raisedAt: TODAY,
      owner: "Sam",
    });
    expect(ws().risks[0].id).toMatch(/^risk_/);
    expect(typeof ws().risks[0].updatedAt).toBe("string");
    expect(logs.map((l) => l.action)).toContain("risk_added");
  });
});

describe("the list", () => {
  it("keeps its order while a rating changes, until Re-sort", () => {
    seed([
      risk({ id: "a", title: "Alpha", probability: 4, impact: 4 }),
      risk({ id: "b", title: "Beta", probability: 2, impact: 2 }),
    ]);
    renderPage();
    expect(order()).toEqual(["a", "b"]);
    pick(ratings("b", "Beta"), "Likelihood", 5);
    pick(ratings("b", "Beta"), "Impact", 5);
    expect(find("b")).toMatchObject({ probability: 5, impact: 5 });
    expect(order()).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(order()).toEqual(["b", "a"]);
  });

  it("flags an overdue mitigation on the row and in the verdict", () => {
    seed([risk({ id: "a", title: "Alpha", mitigationDueAt: ago(3), owner: "Priya" })]);
    renderPage();
    expect(within(row("a")).getByText("Mitigation 3 days overdue")).toBeInTheDocument();
    expect(screen.getByText(/^1 mitigation is overdue, “Alpha” by 3 days/)).toBeInTheDocument();
  });

  it("saves the owner from the roster in place, with its spelling", () => {
    seed([risk({ id: "a", title: "Alpha" })]);
    renderPage();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Owner: No owner. Change" }));
    const input = within(row("a")).getByRole("combobox", { name: "Owner" });
    fireEvent.change(input, { target: { value: "priya" } });
    fireEvent.submit(input.closest("form")!);
    expect(find("a")?.owner).toBe("Priya");
  });

  it("the rating after mitigation saves as a pair, and warns when it is higher", () => {
    seed([risk({ id: "a", title: "Alpha", probability: 4, impact: 4 })]);
    renderPage();
    const after = within(row("a")).getByRole("group", { name: "After mitigation: Alpha" });
    pick(after, "Likelihood after", 2);
    expect(find("a")).not.toHaveProperty("residualProbability");
    expect(within(after).getByText("Rate this too, or clear both.")).toBeInTheDocument();
    pick(after, "Impact after", 3);
    expect(find("a")).toMatchObject({ residualProbability: 2, residualImpact: 3 });
    expect(within(row("a")).getByText("Now 16 → after 6")).toBeInTheDocument();

    pick(after, "Likelihood after", 5);
    pick(after, "Impact after", 5);
    expect(find("a")).toMatchObject({ residualProbability: 5, residualImpact: 5 });
    expect(within(after).getByText(/higher than 16 now/)).toBeInTheDocument();

    fireEvent.click(within(after).getByRole("button", { name: "Clear Likelihood after" }));
    fireEvent.click(within(after).getByRole("button", { name: "Clear Impact after" }));
    expect(find("a")).not.toHaveProperty("residualProbability");
    expect(find("a")).not.toHaveProperty("residualImpact");
  });

  it("closes on a backdated day with Undo; a reopen keeps the day and reads as open", () => {
    seed([risk({ id: "a", title: "Alpha", raisedAt: ago(20) })]);
    renderPage();
    fireEvent.change(within(row("a")).getByRole("combobox", { name: "Status of Alpha" }), {
      target: { value: "closed" },
    });
    expect(find("a")).toMatchObject({ status: "closed", resolvedAt: TODAY });
    const day = within(row("a")).getByLabelText("Closed on, Alpha");
    fireEvent.change(day, { target: { value: ago(30) } });
    fireEvent.blur(day);
    expect(
      within(row("a")).getByText("Pick a day on or after the day it was raised.")
    ).toBeInTheDocument();
    expect(find("a")?.resolvedAt).toBe(TODAY);
    fireEvent.change(day, { target: { value: ago(2) } });
    fireEvent.blur(day);
    expect(find("a")?.resolvedAt).toBe(ago(2));

    fireEvent.change(within(row("a")).getByRole("combobox", { name: "Status of Alpha" }), {
      target: { value: "open" },
    });
    expect(find("a")).toMatchObject({ status: "open", resolvedAt: ago(2) });
    expect(closedOn(find("a")!)).toBeUndefined();
    undoLast();
    expect(find("a")).toMatchObject({ status: "closed", resolvedAt: ago(2) });
  });
});

describe("raise as impediment", () => {
  it("creates the impediment with the risk's level, owner and link; Undo takes both back", () => {
    seed([
      risk({
        id: "a",
        title: "Alpha",
        probability: 4,
        impact: 4,
        owner: "Priya",
        mitigation: "Stub the provider",
      }),
    ]);
    renderPage();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Raise as impediment: Alpha" }));
    const [imp] = ws().impediments;
    expect(imp).toMatchObject({
      title: "Alpha",
      severity: "critical",
      owner: "Priya",
      description: "Mitigation plan: Stub the provider",
      sourceRef: { tool: "risk-register", id: "a" },
    });
    expect(find("a")).toMatchObject({ status: "open" });
    expect(find("a")?.sentTo).toEqual([
      expect.objectContaining({ route: "impediment", targetId: imp.id }),
    ]);
    expect(within(row("a")).getByText("Raised as an impediment")).toBeInTheDocument();
    expect(logs.find((l) => l.action === "risk_escalated")?.payload).toEqual({
      riskId: "a",
      impedimentId: imp.id,
    });

    undoLast();
    expect(ws().impediments).toEqual([]);
    expect(find("a")).not.toHaveProperty("sentTo");
  });

  it("offers to close the risk once its impediment is resolved", () => {
    const impediment: Impediment = {
      id: "imp-1",
      title: "Alpha",
      severity: "high",
      raisedAt: ago(5),
      resolvedAt: ago(1),
      source: "manual",
    };
    seed(
      [
        risk({
          id: "a",
          title: "Alpha",
          sentTo: [{ route: "impediment", targetId: "imp-1", at: "2026-10-22T09:00:00.000Z" }],
        }),
      ],
      { impediments: [impediment] }
    );
    renderPage();
    expect(within(row("a")).getByText("Its impediment is resolved")).toBeInTheDocument();
    fireEvent.click(within(row("a")).getByRole("button", { name: "Close the risk: Alpha" }));
    expect(find("a")).toMatchObject({ status: "closed", resolvedAt: TODAY });
  });

  it("isn't offered for an example, a closed or an accepted risk", () => {
    seed([
      risk({ id: "example-r", title: "Sample" }),
      risk({ id: "c", title: "Done", status: "closed", resolvedAt: ago(1) }),
      risk({ id: "x", title: "Fine", status: "accepted" }),
    ]);
    renderPage();
    expect(screen.queryByRole("button", { name: /^Raise as impediment/ })).toBeNull();
  });
});

describe("delete", () => {
  it("removes the risk and unpins its canvas card; Undo puts both back", () => {
    seed([risk({ id: "a", title: "Alpha" }), risk({ id: "b", title: "Beta" })], {
      whiteboardObjects: [card("o1", "a")],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(ws().risks.map((r) => r.id)).toEqual(["b"]);
    expect(ws().whiteboardObjects).toHaveLength(1);
    expect(ws().whiteboardObjects?.[0]?.sourceRef).toBeUndefined();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted “Alpha”");
    undoLast();
    expect(
      ws()
        .risks.map((r) => r.id)
        .sort()
    ).toEqual(["a", "b"]);
    expect(ws().whiteboardObjects?.[0]?.sourceRef).toEqual({ tool: "risk", entityId: "a" });
  });
});

describe("the KPIs and the statistics on the page", () => {
  it("show '—' and what is missing below the minimum samples", () => {
    seed([risk({ id: "a", title: "Alpha", raisedAt: TODAY })]);
    renderPage();
    expect(screen.getByText("Shows once 3 are closed (0 so far)")).toBeInTheDocument();
    expect(screen.getByText(/to see the open risks week by week/)).toBeInTheDocument();
    expect(screen.getByText(/to see a trend test/)).toBeInTheDocument();
    expect(screen.getByText(/to see a forecast/)).toBeInTheDocument();
    expect(screen.getByText(/to see change points/)).toBeInTheDocument();
  });
});

/* ── The one-time move ──────────────────────────────────────────────── */

describe("the move from the old page's blob", () => {
  it("lists pending rows before the move, then moves them once and keeps the blob", async () => {
    const old = [
      {
        id: "old-1",
        title: "Old page risk",
        probability: 4,
        impact: 3,
        status: "open",
        raisedAt: ago(9),
      },
      { id: "blank", title: "", probability: 3, impact: 3, status: "open", raisedAt: ago(9) },
    ];
    blob(old);
    seed([]);
    const first = renderPage();
    expect(order()).toEqual(["old-1"]);
    expect(screen.getByText(/still moving in/)).toBeInTheDocument();
    expect(ws().risks).toEqual([]);
    first.unmount();

    migrationMode.value = "local";
    const second = renderPage();
    await waitFor(() => expect(movedIds()).toEqual(["old-1", "blank"]));
    expect(ws().risks.map((r) => r.id)).toEqual(["old-1"]);
    expect(typeof find("old-1")?.updatedAt).toBe("string");
    expect(JSON.parse(localStorage.getItem(RISK_REGISTER_KEY)!)).toEqual(old);
    expect(screen.queryByText(/still moving in/)).toBeNull();
    second.unmount();

    // Run again: nothing to plan, nothing written.
    const before = ws().risks;
    renderPage();
    expect(ws().risks).toBe(before);
  });

  it("a delete before the move stays deleted", async () => {
    blob([
      {
        id: "old-1",
        title: "Old page risk",
        probability: 2,
        impact: 2,
        status: "open",
        raisedAt: ago(9),
      },
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Old page risk" }));
    expect(movedIds()).toEqual(["old-1"]);
    expect(order()).toEqual([]);
    migrationMode.value = "local";
    renderPage();
    expect(ws().risks).toEqual([]);
  });

  it("shows a value edited on both sides once: Use this instead (with Undo) or Keep", async () => {
    blob([
      { id: "x", title: "Old title", probability: 5, impact: 3, status: "open", raisedAt: ago(9) },
    ]);
    seed([risk({ id: "x", title: "New title", probability: 2, impact: 3, raisedAt: ago(9) })]);
    migrationMode.value = "local";
    renderPage();
    const notice = await screen.findByRole("region", {
      name: "Edited on the old Risk Register page",
    });
    expect(within(notice).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(
      within(notice).getByRole("button", {
        name: "Use this instead: the old page's likelihood for New title",
      })
    );
    expect(find("x")?.probability).toBe(5);
    undoLast();
    expect(find("x")?.probability).toBe(2);
    fireEvent.click(
      within(
        screen.getByRole("region", { name: "Edited on the old Risk Register page" })
      ).getByRole("button", { name: "Keep the title in the register: New title" })
    );
    expect(
      screen.queryByRole("region", { name: "Edited on the old Risk Register page" })
    ).toBeNull();
    expect(find("x")?.title).toBe("New title");
  });

  it("names how many risks only the workspace had, once", async () => {
    blob([
      { id: "old-1", title: "Old", probability: 2, impact: 2, status: "open", raisedAt: ago(9) },
    ]);
    seed([
      risk({ id: "agent-1", title: "From an agent" }),
      risk({ id: "agent-2", title: "From a premortem" }),
    ]);
    migrationMode.value = "local";
    const first = renderPage();
    expect(
      await screen.findByText(/2 risks the old register page didn't list are now in the register/)
    ).toBeInTheDocument();
    first.unmount();
    renderPage();
    expect(screen.queryByText(/didn't list/)).toBeNull();
    expect(order().sort()).toEqual(["agent-1", "agent-2", "old-1"]);
  });
});

/* ── The example and the exports ────────────────────────────────────── */

describe("the example", () => {
  it("loads into an empty register, counts as the register while alone, and clears with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(ws().risks).toHaveLength(8);
    expect(ws().risks.every((r) => r.id.startsWith("example-"))).toBe(true);
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(
      screen.getByText(/^1 mitigation is overdue, “Payment provider sandbox outages/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Raise as impediment/ })).toBeNull();
    expect(logs).toEqual([]);

    act(() => seed([...ws().risks, risk({ id: "mine", title: "Mine" })]));
    expect(screen.getByText(/listed but not counted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(ws().risks.map((r) => r.id)).toEqual(["mine"]);
    undoLast();
    expect(ws().risks).toHaveLength(9);
  });

  it("has owners, two residual ratings, one overdue and one high risk with no owner", () => {
    const ex = buildExample(new Date(2026, 9, 27));
    expect(ex.filter((r) => r.owner).length).toBe(7);
    expect(ex.filter((r) => r.residualProbability !== undefined)).toHaveLength(2);
    expect(ex.filter((r) => riskDaysOverdue(r, TODAY) > 0).map((r) => r.id)).toEqual([
      "example-risk-1",
    ]);
    const s = riskSummary(countedRisks(ex), TODAY, { includeExamples: true });
    expect(s).toMatchObject({ active: 4, overdue: 1, unowned: 1 });
  });
});

describe("Markdown and CSV", () => {
  it("lead with the verdict and list each risk with owner, rating after, due and impediment", () => {
    const list = [
      risk({
        id: "a",
        title: "Vendor | lock-in",
        probability: 4,
        impact: 4,
        owner: "Priya",
        mitigation: "Abstract the API\nbehind a port",
        mitigationDueAt: ago(3),
        residualProbability: 2,
        residualImpact: 3,
      }),
      risk({ id: "b", title: "Done", status: "closed", resolvedAt: ago(1) }),
    ];
    const md = toMarkdown(list, new Date(2026, 9, 27), {
      impediment: (r) => (r.id === "a" ? "raised" : null),
    });
    expect(md).toMatch(/^# Risk Register — 27 Oct 2026\n\n1 mitigation is overdue/);
    expect(md).toContain(
      "2 risks: 1 open, 1 closed. Exposure of the active risks: 16 now, 6 after mitigation."
    );
    expect(md).toContain(
      "| 1 | Vendor \\| lock-in | Priya | 4 × 4 | 16 (critical) | 2 × 3 = 6 | Open | Abstract the API behind a port | 2026-10-24 (3 days overdue) | Raised |"
    );
    expect(md).toContain("| 2 | Done |  | 3 × 3 | 9 (medium) | Not assessed | Closed |  |  |  |");
    expect(toMarkdown([], new Date(2026, 9, 27))).toBe(
      "# Risk Register — 27 Oct 2026\n\nNo risks logged yet.\n"
    );
    const csv = risksCsv(list, TODAY);
    expect(csv.headers).toContain("Days overdue");
    expect(csv.rows[0]).toEqual(
      expect.arrayContaining(["Vendor | lock-in", "Priya", 16, "Critical", 2, 3, 6, 3])
    );
  });
});

/* ── The agent says what the page says ──────────────────────────────── */

describe("page and agent parity", () => {
  it("list_state gives the page's verdict, counts and time to mitigate for the same risks", async () => {
    const list = [
      risk({ id: "a", title: "Alpha", probability: 4, impact: 4, mitigationDueAt: ago(2) }),
      risk({ id: "b", title: "Beta", status: "closed", raisedAt: ago(9), resolvedAt: ago(2) }),
      risk({ id: "c", title: "Gamma", status: "closed", raisedAt: ago(12), resolvedAt: ago(2) }),
      risk({ id: "d", title: "Delta", status: "closed", raisedAt: ago(5), resolvedAt: ago(1) }),
      risk({ id: "example-z", title: "Sample", probability: 5, impact: 5 }),
    ];
    seed(list);
    const state = await run<{
      verdict: string;
      active: number;
      overdue: number;
      exposure: number;
      timeToClose: { closed: number; medianDays: number | null };
    }>("tool.risk_register.list_state", { today: TODAY });
    const page = countedRisks(list);
    expect(state.verdict).toBe(riskVerdict(page, TODAY));
    expect(state).toMatchObject({
      active: riskSummary(page, TODAY).active,
      overdue: 1,
      exposure: 16,
    });
    expect(state.timeToClose).toEqual(timeToClose(page, TODAY));
    expect(agentTimeToClose(page, TODAY)).toEqual(timeToClose(page, TODAY));
    renderPage();
    expect(screen.getByText(state.verdict)).toBeInTheDocument();
  });

  it("an agent's edit shows on the page at once (one store)", async () => {
    seed([risk({ id: "a", title: "Alpha" })]);
    renderPage();
    await act(async () => {
      await run("tool.risk_register.set_owner", { id: "a", owner: "sam" });
    });
    expect(
      within(row("a")).getByRole("button", { name: "Owner: Sam. Change" })
    ).toBeInTheDocument();
  });
});

/* ── After the review ───────────────────────────────────────────────── */

describe("the example's time to mitigate", () => {
  it("has three closed risks, so the median and the form's due-day suggestion show", () => {
    const ex = buildExample(new Date(2026, 9, 27));
    expect(ex.filter((r) => r.status === "closed")).toHaveLength(3);
    expect(timeToClose(countedRisks(ex), TODAY)).toEqual({ closed: 3, medianDays: 21 });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("21 days")).toBeInTheDocument();
    expect(screen.getByText("Over 3 closed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New risk" }));
    expect(screen.getByText("Risks here take 21 days to close.")).toBeInTheDocument();
  });
});

describe("the exports beside the example", () => {
  it("list and count only the team's risks, and say how many example risks are left out", () => {
    const now = new Date(2026, 9, 27);
    const list = [...buildExample(now), risk({ id: "mine", title: "Mine" })];
    const md = toMarkdown(list, now);
    expect(md).toContain(
      "1 risk: 1 open. Exposure of the active risks: 9 now, 9 after mitigation; the 1 not assessed counts at its current score. The example's 8 risks are left out."
    );
    expect(md).toContain("| 1 | Mine |");
    expect(md).not.toContain("Payment provider");
    expect(risksCsv(list, TODAY).rows.map((r) => r[0])).toEqual(["Mine"]);

    // The example alone is the register: listed and counted.
    const alone = toMarkdown(buildExample(now), now);
    expect(alone).toContain("8 risks: 2 open, 2 mitigating, 1 accepted, 3 closed.");
    expect(alone).not.toContain("left out");
    expect(risksCsv(buildExample(now), TODAY).rows).toHaveLength(8);
  });
});

describe("the conflict notice reads the register as it is now", () => {
  const old = { id: "x", title: "Old title", probability: 5, impact: 3, status: "open" };
  const notice = () =>
    screen.queryByRole("region", { name: "Edited on the old Risk Register page" });
  const setRisk = (patch: Partial<Risk>) =>
    act(() =>
      useWorkspaceStore.setState({
        risks: ws().risks.map((r) => (r.id === "x" ? { ...r, ...patch } : r)),
      })
    );

  it("shows an edit made while it is open, and Undo goes back to that value", async () => {
    blob([{ ...old, raisedAt: ago(9) }]);
    seed([risk({ id: "x", title: "New title", probability: 2, impact: 3, raisedAt: ago(9) })]);
    migrationMode.value = "local";
    renderPage();
    await screen.findByRole("region", { name: "Edited on the old Risk Register page" });
    // An agent rates it again while the notice is open.
    setRisk({ probability: 4 });
    expect(within(notice()!).getByText(conflictText("probability", 4))).toBeInTheDocument();
    expect(within(notice()!).queryByText(conflictText("probability", 2))).toBeNull();
    fireEvent.click(
      within(notice()!).getByRole("button", {
        name: "Use this instead: the old page's likelihood for New title",
      })
    );
    expect(find("x")?.probability).toBe(5);
    undoLast();
    expect(find("x")?.probability).toBe(4);
  });

  it("drops a value that now matches the old page's: there is nothing left to choose", async () => {
    blob([{ ...old, raisedAt: ago(9) }]);
    seed([risk({ id: "x", title: "New title", probability: 2, impact: 3, raisedAt: ago(9) })]);
    migrationMode.value = "local";
    renderPage();
    await screen.findByRole("region", { name: "Edited on the old Risk Register page" });
    expect(within(notice()!).getAllByRole("listitem")).toHaveLength(2);
    setRisk({ title: "Old title" });
    expect(within(notice()!).getAllByRole("listitem")).toHaveLength(1);
    setRisk({ probability: 5 });
    expect(notice()).toBeNull();
  });
});

describe("focus after an action replaces its button", () => {
  it("Raise as impediment lands on the link to it; Close the risk on the status", async () => {
    seed([risk({ id: "a", title: "Alpha" })]);
    renderPage();
    const raise = within(row("a")).getByRole("button", { name: "Raise as impediment: Alpha" });
    raise.focus();
    fireEvent.click(raise);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("a")).getByRole("link", { name: /Raised as an impediment/ })
      )
    );

    act(() =>
      useWorkspaceStore.setState({
        impediments: ws().impediments.map((i) => ({ ...i, resolvedAt: TODAY })),
      })
    );
    fireEvent.click(within(row("a")).getByRole("button", { name: "Close the risk: Alpha" }));
    expect(find("a")?.status).toBe("closed");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("a")).getByRole("combobox", { name: "Status of Alpha" })
      )
    );
  });

  it("settling a conflict lands on the next one, then on New risk", async () => {
    blob([
      { id: "x", title: "Old title", probability: 5, impact: 3, status: "open", raisedAt: ago(9) },
    ]);
    seed([risk({ id: "x", title: "New title", probability: 2, impact: 3, raisedAt: ago(9) })]);
    migrationMode.value = "local";
    renderPage();
    const notice = await screen.findByRole("region", {
      name: "Edited on the old Risk Register page",
    });
    fireEvent.click(
      within(notice).getByRole("button", { name: "Keep the title in the register: New title" })
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Keep the likelihood in the register: New title" })
      )
    );
    fireEvent.click(document.activeElement!);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "New risk" }))
    );
  });

  it("dismissing the appeared notice and clearing the example land on New risk", async () => {
    blob([
      { id: "old-1", title: "Old", probability: 2, impact: 2, status: "open", raisedAt: ago(9) },
    ]);
    seed([risk({ id: "agent-1", title: "From an agent" })]);
    migrationMode.value = "local";
    const first = renderPage();
    await screen.findByText(/1 risk the old register page didn't list/);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "New risk" }))
    );
    first.unmount();

    seed([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "New risk" }))
    );
  });
});

describe("the owner names its risk", () => {
  it("sits in a group named for the risk", () => {
    seed([risk({ id: "a", title: "Alpha", owner: "Priya" })]);
    renderPage();
    const group = within(row("a")).getByRole("group", { name: "Owner of Alpha" });
    expect(within(group).getByRole("button", { name: "Owner: Priya. Change" })).toBeInTheDocument();
  });
});

/* ── After the second review ────────────────────────────────────────── */

describe("the JSON export beside the example", () => {
  it("lists the team's risks only, as the Markdown and the CSV do", () => {
    const now = new Date(2026, 9, 27);
    seed([...buildExample(now), risk({ id: "mine", title: "Mine" })]);
    renderPage();
    const json = JSON.parse(screen.getByTestId("export-json").textContent ?? "[]") as Risk[];
    expect(json.map((r) => r.id)).toEqual(["mine"]);
  });

  it("lists the example's while it is all there is", () => {
    seed(buildExample(new Date(2026, 9, 27)));
    renderPage();
    const json = JSON.parse(screen.getByTestId("export-json").textContent ?? "[]") as Risk[];
    expect(json).toHaveLength(8);
  });
});

describe("a closed risk with no close day", () => {
  // Closed through the old generic CRUD: no resolvedAt.
  const undated = (over: Partial<Risk> = {}) =>
    risk({ id: "u", title: "Undated", status: "closed", raisedAt: ago(21), ...over });
  const closed = (id: string, days: number) =>
    risk({ id, raisedAt: ago(days + 1), status: "closed", resolvedAt: ago(1) });

  it("isn't counted open in every week, and the chart says how many", () => {
    const list = [risk({ id: "a", raisedAt: ago(21) }), undated()];
    const points = weeklyRiskSeries(list, TODAY);
    // Still raised that week; never open, as the matrix and the KPIs read it.
    expect(points.map((p) => p.raised)).toEqual([2, 0, 0, 0]);
    expect(points.map((p) => p.open)).toEqual([1, 1, 1, 1]);
    expect(closedUndatedCount(list)).toBe(1);
    expect(closedUndatedCount([risk(), closed("b", 3)])).toBe(0);
    expect(weeklyChartText(points, 1).summary).toBe(
      "Over the last 4 weeks, 2 risks were raised and 1 open at the end of each week shown. Accepted risks aren't counted as open. 1 closed risk has no close day, so it isn't counted as open or in the time to mitigate: give it one under its “Closed on”."
    );
    expect(undatedClosedNote(2)).toBe(
      "2 closed risks have no close day, so they aren't counted as open or in the time to mitigate: give each one under its “Closed on”."
    );
    expect(undatedClosedNote(0)).toBe("");
    // A timestamp that isn't a day reads as no close day too.
    expect(closedUndatedCount([undated({ resolvedAt: "soon" })])).toBe(1);
  });

  it("is left out of the time to mitigate, on the page and for the agent", () => {
    const done = [closed("b", 4), closed("c", 6), closed("d", 8), closed("e", 10)];
    const withUndated = [...done, undated({ raisedAt: ago(30) })];
    expect(timeToClose(withUndated, TODAY)).toEqual({ closed: 4, medianDays: 6 });
    expect(timeToClose(withUndated, TODAY)).toEqual(timeToClose(done, TODAY));
    // Counted as still waiting, it would have moved the median.
    expect(timeToClose([...done, risk({ id: "u", raisedAt: ago(30) })], TODAY).medianDays).toBe(8);
    expect(agentTimeToClose(withUndated, TODAY)).toEqual(timeToClose(withUndated, TODAY));
  });

  it("is named under the chart on the page", () => {
    seed([risk({ id: "a", title: "Alpha", raisedAt: ago(21) }), undated()]);
    renderPage();
    expect(screen.getByText(/1 closed risk has no close day/)).toBeInTheDocument();
    expect(within(row("u")).getByLabelText("Closed on, Undated")).toHaveValue("");
  });
});

describe("the exposure after mitigation", () => {
  it("says the risks not assessed count at their current score", () => {
    expect(residualText({ active: 3, residualAssessed: 3, residualExposure: 12 })).toBe(
      "12 after mitigation"
    );
    expect(residualText({ active: 3, residualAssessed: 2, residualExposure: 12 })).toBe(
      "12 after mitigation; the 1 not assessed counts at its current score"
    );
    expect(residualText({ active: 5, residualAssessed: 2, residualExposure: 30 })).toBe(
      "30 after mitigation; the 3 not assessed count at their current score"
    );
  });

  it("on the page's KPI and in the Markdown alike", () => {
    seed([
      risk({ id: "a", title: "Alpha", probability: 4, impact: 4 }),
      risk({ id: "b", title: "Beta", residualProbability: 1, residualImpact: 2 }),
      risk({ id: "c", title: "Gamma", probability: 2, impact: 2 }),
    ]);
    renderPage();
    // 16 + 2 + 4: Alpha and Gamma at their current score.
    const text = "22 after mitigation; the 2 not assessed count at their current score";
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      `Exposure of the active risks: 29 now, ${text}.`
    );
  });
});

describe("the due-day suggestion", () => {
  it("is a short button, with the reason under it as its description", () => {
    seed(buildExample(new Date(2026, 9, 27)));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New risk" }));
    const use = screen.getByRole("button", { name: /^Use \d{4}-\d{2}-\d{2}$/ });
    const reason = screen.getByText("Risks here take 21 days to close.");
    expect(use.getAttribute("aria-describedby")).toBe(reason.id);
    expect(use.className).not.toContain("mb-6");
  });
});

describe("the risks the move found only in the workspace", () => {
  it("are named with a link to each row; one deleted leaves the notice", async () => {
    blob([
      { id: "old-1", title: "Old", probability: 2, impact: 2, status: "open", raisedAt: ago(9) },
    ]);
    seed(
      Array.from({ length: 7 }, (_, i) =>
        risk({ id: `agent-${i + 1}`, title: `From an agent ${i + 1}` })
      )
    );
    migrationMode.value = "local";
    renderPage();
    await screen.findByText(/7 risks the old register page didn't list/);
    const named = () => within(screen.getByRole("list", { name: "Now in the register" }));
    const links = named().getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAccessibleName("From an agent 1");
    expect(links[0].getAttribute("href")).toBe("#risk-agent-1");
    expect(document.getElementById("risk-agent-1")).not.toBeNull();
    expect(named().getByText("and 2 more")).toBeInTheDocument();

    fireEvent.click(within(row("agent-1")).getByRole("button", { name: "Delete From an agent 1" }));
    expect(screen.getByText(/6 risks the old register page didn't list/)).toBeInTheDocument();
    expect(named().queryByRole("link", { name: "From an agent 1" })).toBeNull();
    expect(named().getByText("and 1 more")).toBeInTheDocument();
  });
});
