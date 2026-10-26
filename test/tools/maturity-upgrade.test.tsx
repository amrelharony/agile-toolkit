import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  MaturityAssessment,
  MaturityAssessmentEntry,
  RetroBoard,
} from "@/lib/stores/workspace-types";
import { MATURITY_DIMENSIONS, getMaturityScore } from "@/lib/constants/maturity-model";
import {
  MATURITY_ID,
  assessmentDeltas,
  averageOf,
  latestAssessment,
  maturityLevelOf,
  maturityPct,
  maturityVerdict,
  normalizeMaturity,
  restoreAssessment,
  roadmapCards,
  roadmapFor,
  savedAssessments,
  scoredCount,
  withoutAssessment,
} from "@/lib/maturity/assessment";
import { registry } from "@/lib/actions/registry";

/**
 * Maturity, upgraded: an unassessed team has no level (the page no longer
 * pushes level 1 for anyone who opens it), a draft scored dimension by
 * dimension and saved as a dated (backdatable) assessment, a 0-100% scale,
 * the trend behind a minimum sample, the roadmap from the latest saved
 * assessment sent to Retro Actions, Undo on delete, save and reset, an
 * example that never touches the team's level, and the agent saying the
 * same.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
// Recharts has nothing to measure in jsdom; the charts' text is tested directly.
vi.mock("@/app/(tools)/maturity/charts", () => ({
  MaturityRadarChart: () => null,
  MaturityTrendChart: () => null,
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { MaturityTool } from "@/app/(tools)/maturity/maturity-client";
import { buildExample } from "@/app/(tools)/maturity/example";
import { maturityToMarkdown } from "@/app/(tools)/maturity/markdown";
import { validateAssessment } from "@/app/(tools)/maturity/assessment-form";
import { radarText, trendSlopeText, trendText } from "@/app/(tools)/maturity/chart-text";
import "@/lib/actions/tools/maturity";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const all = (level: number) => Object.fromEntries(MATURITY_DIMENSIONS.map((d) => [d.id, level]));
const entry = (
  id: string,
  assessedAt: string,
  scores: Record<string, number>,
  extra: Partial<MaturityAssessmentEntry> = {}
): MaturityAssessmentEntry => ({ id, assessedAt, scores, ...extra });
const doc = (history: MaturityAssessmentEntry[], extra: Partial<MaturityAssessment> = {}) => ({
  id: MATURITY_ID,
  scores: {},
  targetLevel: 4,
  history,
  ...extra,
});
const ws = () => useWorkspaceStore.getState();
const stored = () => ws().maturityAssessments?.find((d) => d.id === MATURITY_ID);
const seed = (d: MaturityAssessment | null, extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    maturityAssessments: d ? [d] : [],
    retroBoards: [],
    ...extra,
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <MaturityTool />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

/** Pick a dimension's level in the draft. */
const score = (name: string, option: string) =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name })).getByRole("radio", { name: option })
  );

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.maturity.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 9, 0, 0));
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  logs.length = 0;
  seed(null, { maturityLevel: undefined });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    maturityAssessments: [],
    retroBoards: [],
    maturityLevel: undefined,
  });
});

/* ── The rules (lib/maturity/assessment) ────────────────────────────── */

describe("the 0-100% scale", () => {
  it("runs from all 1s at 0% to all 5s at 100%", () => {
    expect(maturityPct(1)).toBe(0);
    expect(maturityPct(3)).toBe(50);
    expect(maturityPct(5)).toBe(100);
    expect(maturityPct(1.5)).toBe(13);
    expect(maturityPct(7)).toBe(100);
    expect(maturityPct(0)).toBe(0);
    expect(maturityPct(Number.NaN)).toBe(0);
  });

  it("names a tone token, never a hex colour", () => {
    expect(getMaturityScore(1)).toEqual({
      percentage: 0,
      level: 1,
      label: "Initial",
      tone: "danger",
    });
    expect(getMaturityScore(4.6).tone).toBe("accent");
    expect(JSON.stringify(getMaturityScore(3))).not.toMatch(/#/);
  });
});

describe("unassessed until saved", () => {
  it("averages only a complete set, clamping stored levels", () => {
    expect(averageOf(undefined)).toBeNull();
    expect(averageOf({ ...all(3), "agile-culture": undefined as never })).toBeNull();
    expect(averageOf({ ...all(3), "agile-culture": 9 })).toBe(3.25);
    expect(scoredCount({ "scrum-practices": 2, ghost: 4 })).toBe(1);
  });

  it("has no level for no doc, a draft alone, or a legacy doc", () => {
    expect(maturityLevelOf(undefined)).toBeUndefined();
    expect(maturityLevelOf(doc([], { scores: all(4) }))).toBeUndefined();
    expect(maturityLevelOf({ id: MATURITY_ID, scores: all(1), targetLevel: 4 })).toBeUndefined();
  });

  it("takes the latest saved assessment by day, ignoring incomplete and undated entries", () => {
    const d = doc([
      entry("b", "2026-10-01", all(2)),
      entry("a", "2026-05-01", all(4)),
      entry("broken", "2026-10-20", { "scrum-practices": 5 }),
      entry("undated", "someday", all(5)),
    ]);
    expect(savedAssessments(d).map((e) => e.id)).toEqual(["a", "b"]);
    expect(latestAssessment(d)?.id).toBe("b");
    expect(maturityLevelOf(d)).toBe(2);
    // Same day: the one saved last wins.
    const tie = doc([entry("x", "2026-10-01", all(2)), entry("y", "2026-10-01", all(5))]);
    expect(latestAssessment(tie)?.id).toBe("y");
  });

  it("normalises a doc: known dimensions only, levels clamped, the target 2-5", () => {
    expect(
      normalizeMaturity({
        id: MATURITY_ID,
        scores: { ghost: 3, "scrum-practices": 0 },
        targetLevel: 9,
      })
    ).toEqual({
      id: MATURITY_ID,
      scores: { "scrum-practices": 1 },
      targetLevel: 4,
      history: [],
    });
  });
});

describe("the roadmap and what changed", () => {
  const latest = entry("l", "2026-10-01", {
    ...all(3),
    "technical-excellence": 1,
    "agile-culture": 2,
  });

  it("lists one step per dimension below the target, weakest first, with keys", () => {
    const steps = roadmapFor(latest, 4);
    expect(steps.map((s) => s.key).slice(0, 2)).toEqual([
      "technical-excellence:2",
      "agile-culture:3",
    ]);
    expect(steps).toHaveLength(8);
    expect(steps[0]).toMatchObject({ current: 1, toLevel: 2, toLabel: "Developing", target: 4 });
    expect(roadmapFor(latest, 3).map((s) => s.dimensionId)).toEqual([
      "technical-excellence",
      "agile-culture",
    ]);
    expect(roadmapFor(null, 4)).toEqual([]);
  });

  it("finds the retro cards sent from a step on any board, each once", () => {
    const card = {
      id: "c1",
      columnKey: "start",
      text: "Maturity: Technical Excellence to level 2",
      votes: 0,
      groupedWith: null,
      isActionItem: true,
      assignee: "",
      discussing: false,
      sourceRef: { tool: "maturity", id: "technical-excellence:2", doc: MATURITY_ID },
    };
    const boards = [
      { id: "retro:current", cards: [card] },
      {
        id: "retro:archived",
        cards: [card, { ...card, id: "c2", sourceRef: { tool: "retro", id: "x" } }],
      },
    ] as unknown as RetroBoard[];
    expect(roadmapCards(boards, "technical-excellence:2")).toEqual([
      { id: "c1", boardId: "retro:current", done: false },
    ]);
    expect(roadmapCards(undefined, "x")).toEqual([]);
  });

  it("names the dimensions that moved", () => {
    const before = entry("p", "2026-05-01", all(3));
    expect(assessmentDeltas(before, latest)).toEqual([
      { dimensionId: "technical-excellence", name: "Technical Excellence", from: 3, to: 1 },
      { dimensionId: "agile-culture", name: "Agile Culture", from: 3, to: 2 },
    ]);
    expect(assessmentDeltas(null, latest)).toEqual([]);
  });

  it("puts a deleted assessment back where it was", () => {
    const d = doc([entry("a", "2026-05-01", all(2)), entry("b", "2026-06-01", all(3))]);
    const out = withoutAssessment(d, "a")!;
    expect(out.index).toBe(0);
    expect(restoreAssessment(out.doc, out.entry, out.index).history?.map((e) => e.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("the verdict", () => {
  it("reads unassessed with how far the draft is", () => {
    expect(maturityVerdict(undefined)).toBe(
      "Not assessed yet. Score the eight dimensions together, then save the assessment with the day you took it."
    );
    expect(maturityVerdict(doc([], { scores: { "scrum-practices": 2 } }))).toBe(
      "Not assessed yet: 1 of 8 dimensions scored in the draft."
    );
    expect(maturityVerdict(doc([], { scores: all(2) }))).toBe(
      "Not assessed yet: all 8 dimensions are scored. Save the assessment to count it."
    );
  });

  it("gives the level, the day, the move since the last one and the weakest", () => {
    const first = entry("a", "2026-05-12", { ...all(2), "technical-excellence": 1 });
    expect(maturityVerdict(doc([first]))).toBe(
      "Level 2 · Developing (22%), assessed on May 12, 2026. Weakest: Technical Excellence (1)."
    );
    const second = entry("b", "2026-10-03", { ...all(3), "technical-excellence": 1 });
    expect(maturityVerdict(doc([first, second]))).toBe(
      "Level 3 · Defined (44%) on Oct 3, 2026, up from 22% on May 12, 2026. Weakest: Technical Excellence (1)."
    );
    expect(maturityVerdict(doc([second, entry("c", "2026-10-20", second.scores)]))).toMatch(
      /the same as on Oct 3, 2026/
    );
  });
});

describe("saving checks", () => {
  it("needs every dimension, a real day not in the future, and a short note", () => {
    const bad = validateAssessment(
      { "scrum-practices": 3 },
      { assessedAt: "2026-10-27", note: "" },
      "2026-10-26"
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors)).toHaveLength(8);
      expect(bad.errors["team-collaboration"]).toBe("Score Team Collaboration before saving.");
      expect(bad.errors.assessedAt).toBe("It can't be taken in the future.");
    }
    expect(validateAssessment(all(3), { assessedAt: "", note: "" }, "2026-10-26")).toMatchObject({
      ok: false,
      errors: { assessedAt: "Pick the day you took it." },
    });
    expect(
      validateAssessment(all(3), { assessedAt: "2026-01-05", note: " Baseline " }, "2026-10-26")
    ).toEqual({
      ok: true,
      values: { scores: all(3), assessedAt: "2026-01-05", note: "Baseline" },
    });
  });
});

describe("the charts' text and the trend's minimum sample", () => {
  const six = [1, 1.5, 2, 2.5, 3, 3.5].map((lvl, i) =>
    entry(`e${i}`, `2026-0${i + 1}-01`, all(Math.round(lvl)))
  );

  it("summarises the trend and tables every assessment", () => {
    const t = trendText(six.slice(0, 2));
    expect(t.summary).toBe(
      "Overall maturity went from 0% (Jan 1, 2026) to 25% (Feb 1, 2026) over 2 assessments."
    );
    expect(t.table.columns.slice(0, 2)).toEqual(["Date", "Overall %"]);
    expect(t.table.rows[1].slice(0, 3)).toEqual(["Feb 1, 2026", 25, 2]);
    expect(trendText([]).summary).toBe("No saved assessments yet.");
  });

  it("states a direction only from six assessments", () => {
    expect(trendSlopeText(six.slice(0, 5))).toBeNull();
    expect(trendSlopeText(six)).toMatch(/^Across 6 assessments the overall score rises by about/);
  });

  it("names the strongest and weakest, and tables previous vs latest vs target", () => {
    const latest = entry("l", "2026-10-01", {
      ...all(3),
      "agile-culture": 5,
      "technical-excellence": 1,
    });
    const r = radarText(latest, entry("p", "2026-05-01", all(2)), 4);
    expect(r.summary).toBe(
      "Strongest: Agile Culture (5); weakest: Technical Excellence (1). 1 of 8 dimensions are at or above the target level 4."
    );
    expect(r.table.rows[2]).toEqual(["Technical Excellence", 2, 1, 4]);
    expect(radarText(latest, null, 4).table.rows[0][1]).toBe("—");
  });
});

describe("the example and the export", () => {
  it("is three dated assessments with example- ids and no draft", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    expect(ex.doc.history?.every((e) => isExampleId(e.id))).toBe(true);
    expect(savedAssessments(ex.doc)).toHaveLength(3);
    expect(ex.doc.scores).toEqual({});
  });

  it("exports the verdict, the latest against the one before, the history and the roadmap", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    const md = maturityToMarkdown(ex.doc);
    expect(md).toContain("# Agile maturity assessment");
    expect(md).toContain(
      "> Level 2 · Developing (31%) on Oct 16, 2026, up from 25% on Aug 7, 2026."
    );
    expect(md).toContain("| Scrum Practices | 2 | 3 Defined | 4 |");
    expect(md).toContain(
      "- Oct 16, 2026: 31% · Level 2 (Developing) · After the retro on our ceremonies"
    );
    expect(md).toContain("- Technical Excellence: 1 → 2 (Developing)");
    expect(maturityToMarkdown(doc([]))).toBe(
      "# Agile maturity assessment\n\n> Not assessed yet. Score the eight dimensions together, then save the assessment with the day you took it.\n"
    );
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("clears a stale level 1 for a team that never assessed, and writes no assessment", async () => {
    seed(null, { maturityLevel: 1 });
    renderPage();
    expect(screen.getByText("Not assessed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    await waitFor(() => expect(ws().maturityLevel).toBeUndefined());
    expect(ws().maturityAssessments).toEqual([]);
  });

  it("shows a legacy doc's scores as a draft to date, never as an assessment", async () => {
    seed({ id: MATURITY_ID, scores: all(2), targetLevel: 4 }, { maturityLevel: 2 });
    renderPage();
    expect(screen.getByText(/These are your earlier scores/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Not assessed yet: all 8 dimensions are scored. Save the assessment to count it."
      )
    ).toBeInTheDocument();
    await waitFor(() => expect(ws().maturityLevel).toBeUndefined());
  });

  it("saves nothing until every dimension is scored, focusing the first missing one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    expect(screen.getByText("Score Scrum Practices before saving.")).toBeInTheDocument();
    expect(screen.getAllByText(/before saving\.$/)).toHaveLength(8);
    const first = within(screen.getByRole("radiogroup", { name: "Scrum Practices" })).getAllByRole(
      "radio"
    )[0];
    expect(first).toHaveFocus();
    expect(stored()?.history ?? []).toEqual([]);
  });

  it("scores, backdates and saves an assessment, sets the level, and Undo takes it back", async () => {
    renderPage();
    for (const d of MATURITY_DIMENSIONS) score(d.name, "3 Defined");
    score("Technical Excellence", "1 Initial");
    expect(stored()?.scores["technical-excellence"]).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear Agile Culture" }));
    expect(stored()?.scores["agile-culture"]).toBeUndefined();
    score("Agile Culture", "4 Managed");
    fireEvent.change(screen.getByLabelText(/^Taken on/), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    expect(screen.getByText("It can't be taken in the future.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Taken on/), { target: { value: "2026-09-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));

    expect(stored()?.history).toHaveLength(1);
    expect(stored()?.history?.[0]).toMatchObject({ assessedAt: "2026-09-15", targetLevel: 4 });
    expect(stored()?.scores).toEqual({});
    await waitFor(() => expect(ws().maturityLevel).toBe(3));
    expect(logs.map((l) => l.action)).toContain("assessment_saved");
    expect(screen.getAllByText("Level 3 · Defined").length).toBeGreaterThan(0);
    expect(screen.getByText("Save 1 more assessment to see the trend.")).toBeInTheDocument();

    undoLast();
    expect(stored()?.history).toEqual([]);
    expect(stored()?.scores).toMatchObject({ "technical-excellence": 1, "agile-culture": 4 });
    await waitFor(() => expect(ws().maturityLevel).toBeUndefined());
  });

  it("starts a new draft from the last assessment only when asked", () => {
    seed(doc([entry("a", "2026-09-01", all(2))]));
    renderPage();
    expect(stored()?.scores).toEqual({});
    fireEvent.click(screen.getByRole("button", { name: "Start from the last assessment" }));
    expect(stored()?.scores).toEqual(all(2));
    undoLast();
    expect(stored()?.scores).toEqual({});
  });

  it("charts the trend from two assessments and names what changed", () => {
    seed(
      doc([
        entry("a", "2026-05-01", all(2)),
        entry("b", "2026-10-01", { ...all(2), "agile-culture": 3 }),
      ])
    );
    renderPage();
    expect(
      screen.getByText(
        "Overall maturity went from 25% (May 1, 2026) to 28% (Oct 1, 2026) over 2 assessments."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Agile Culture: 2 → 3")).toBeInTheDocument();
    // A direction of travel needs six assessments.
    expect(
      screen.getByText("Save 4 more assessments to see the direction of travel.")
    ).toBeInTheDocument();
  });

  it("deletes a saved assessment with Undo, the level following the latest left", async () => {
    seed(doc([entry("a", "2026-05-01", all(4)), entry("b", "2026-10-01", all(2))]), {
      maturityLevel: 2,
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete the assessment of Oct 1, 2026" }));
    expect(stored()?.history?.map((e) => e.id)).toEqual(["a"]);
    await waitFor(() => expect(ws().maturityLevel).toBe(4));
    undoLast();
    expect(stored()?.history?.map((e) => e.id)).toEqual(["a", "b"]);
    await waitFor(() => expect(ws().maturityLevel).toBe(2));
  });

  it("edits a saved assessment's day in place, refusing the future", () => {
    seed(doc([entry("a", "2026-05-01", all(4))]));
    renderPage();
    const day = screen.getByLabelText("Day of the assessment of May 1, 2026");
    fireEvent.change(day, { target: { value: "2027-01-01" } });
    expect(toastSpy.error).toHaveBeenCalledWith("It can't be taken in the future.");
    expect(stored()?.history?.[0].assessedAt).toBe("2026-05-01");
    fireEvent.change(day, { target: { value: "2026-04-20" } });
    expect(stored()?.history?.[0].assessedAt).toBe("2026-04-20");
  });

  it("resets only after confirming, the team unassessed, and Undo brings it all back", async () => {
    const before = doc([entry("a", "2026-05-01", all(4))]);
    seed(before, { maturityLevel: 4 });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset assessment" }));
    expect(stored()).toEqual({ id: MATURITY_ID, scores: {}, targetLevel: 4, history: [] });
    await waitFor(() => expect(ws().maturityLevel).toBeUndefined());
    undoLast();
    expect(stored()).toEqual(before);
    await waitFor(() => expect(ws().maturityLevel).toBe(4));
  });

  it("sends a roadmap step to Retro Actions, linked back, with Undo", () => {
    seed(doc([entry("a", "2026-10-01", { ...all(4), "technical-excellence": 2 })]));
    renderPage();
    const send = screen.getByRole("button", {
      name: "Send to… Maturity: Technical Excellence to level 3",
    });
    fireEvent.pointerDown(send, { button: 0, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Retro action" }));
    const cards = ws().retroBoards?.[0]?.cards ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      text: "Maturity: Technical Excellence to level 3",
      isActionItem: true,
      sourceRef: { tool: "maturity", id: "technical-excellence:3", doc: MATURITY_ID },
    });
    expect(
      screen.getByRole("button", {
        name: "Send to… Maturity: Technical Excellence to level 3 (sent)",
      })
    ).toBeInTheDocument();
    undoLast();
    expect(ws().retroBoards ?? []).toEqual([]);
  });

  it("shows the example without touching the workspace or the team's level", async () => {
    seed(null, { maturityLevel: undefined });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText("Level 2 · Developing").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /^Send to… Maturity: Technical Excellence to level 2/ })
    ).toBeDisabled();
    score("Scrum Practices", "5 Optimizing");
    expect(ws().maturityAssessments).toEqual([]);
    expect(ws().maturityLevel).toBeUndefined();
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    await waitFor(() => expect(screen.getByText("Not assessed")).toBeInTheDocument());
  });

  it("says the same as the agent for the same data", async () => {
    seed(
      doc([
        entry("a", "2026-05-01", all(2)),
        entry("b", "2026-10-01", { ...all(3), "agile-culture": 1 }),
      ])
    );
    renderPage();
    const state = await run<{ verdict: string; percentage: number }>("list_state");
    expect(screen.getByText(state.verdict)).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(`> ${state.verdict}`);
    expect(state.percentage).toBe(44);
  });
});
