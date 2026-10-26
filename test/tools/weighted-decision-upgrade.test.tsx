import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  WeightedCriterion,
  WeightedMatrix,
  WeightedOption,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";
import {
  DEFAULT_MATRIX_NAME,
  DEFAULT_WEIGHTED_MATRIX_ID,
  changePercent,
  decisionSourceOf,
  matricesOf,
  matrixResult,
  mergeOption,
  recommendationOf,
  rowsOf,
  scoreInputError,
  sendError,
  sensitivityText,
  sentText,
  weightError,
} from "@/lib/weighted/model";
import { registry } from "@/lib/actions/registry";

/**
 * Weighted Decision Matrix, upgraded (Phase 7): named matrices (rows from
 * before names are the default matrix's); an empty cell is not scored and
 * never 0, so a Total needs every weighted cell and only a complete option
 * can lead; ties within 5% and the weight changes that flip the leader are
 * named; rows keep their place while scored; cells save on leaving; Undo
 * on every delete; the result becomes a proposed decision record; and the
 * agent computes the same numbers.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
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
vi.mock("@/app/(tools)/weighted-decision/charts", () => ({ WeightedScoreChart: () => null }));

import {
  WeightedDecisionClient,
  readMatrixParam,
} from "@/app/(tools)/weighted-decision/weighted-decision-client";
import { buildExample } from "@/app/(tools)/weighted-decision/example";
import { matrixToMarkdown, totalsChartText } from "@/app/(tools)/weighted-decision/markdown";
import { validateCriterion } from "@/app/(tools)/weighted-decision/criteria-panel";
import "@/lib/actions/tools/weighted-decision";
import "@/lib/actions/tools/decision-log";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const M = "weightedMatrix_m1";
const matrix: WeightedMatrix = {
  id: M,
  name: "Hosting",
  question: "Where do we host?",
  createdAt: "2026-10-01T00:00:00.000Z",
};
const crit = (
  id: string,
  name: string,
  weight: number,
  matrixId: string | null = M
): WeightedCriterion => ({
  id,
  name,
  weight,
  ...(matrixId ? { matrixId } : {}),
});
const opt = (
  id: string,
  name: string,
  scores: Record<string, number>,
  matrixId: string | null = M
): WeightedOption => ({
  id,
  name,
  scores,
  ...(matrixId ? { matrixId } : {}),
});

const ws = () => useWorkspaceStore.getState();
const seed = (m: WeightedMatrix[], c: WeightedCriterion[], o: WeightedOption[]) =>
  useWorkspaceStore.setState({
    weightedMatrices: m,
    weightedCriteria: c,
    weightedOptions: o,
    decisions: [],
    daciDecisions: [],
    rapidDecisions: [],
    whiteboardObjects: [],
  });
const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <WeightedDecisionClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const cell = (c: string, o: string) => screen.getByLabelText(`${c} score for ${o}`);
const score = (c: string, o: string, v: string) => {
  fireEvent.change(cell(c, o), { target: { value: v } });
  fireEvent.blur(cell(c, o));
};
/** The option names in the order the rows are on screen. */
const rowOrder = () =>
  screen.getAllByLabelText(/^Name of the option /).map((el) => (el as HTMLInputElement).value);

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.weighted_decision.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  toastSpy.mockReset();
  window.history.replaceState(null, "", "/weighted-decision");
  seed([], [], []);
});
afterEach(() => vi.useRealTimers());

/* ── The rules (lib/weighted/model) ─────────────────────────────────── */

describe("named matrices", () => {
  it("rows without a matrixId belong to the default matrix, listed first until it is named", () => {
    const c = [crit("legacy-c", "Risk", 2, null), crit("c1", "Cost", 3)];
    const o = [opt("legacy-o", "On-prem", { "legacy-c": 4 }, null)];
    const list = matricesOf([matrix], o, c);
    expect(list.map((m) => [m.id, m.name])).toEqual([
      [DEFAULT_WEIGHTED_MATRIX_ID, DEFAULT_MATRIX_NAME],
      [M, "Hosting"],
    ]);
    expect(rowsOf(DEFAULT_WEIGHTED_MATRIX_ID, c).map((x) => x.id)).toEqual(["legacy-c"]);
    expect(rowsOf(M, c).map((x) => x.id)).toEqual(["c1"]);
    // No default rows: no default matrix.
    expect(matricesOf([matrix], [], [crit("c1", "Cost", 3)]).map((m) => m.id)).toEqual([M]);
  });
});

describe("totals, the leader and ties", () => {
  const c = [crit("cost", "Cost", 3), crit("speed", "Speed", 1)];

  it("an unscored cell is not 0: a partial total, and never the leader", () => {
    const r = matrixResult(M, c, [
      opt("a", "A", { cost: 6 }), // partial 18: at least 19 once Speed is scored
      opt("b", "B", { cost: 5, speed: 5 }), // 20, complete
    ]);
    const a = r.options.find((o) => o.id === "a")!;
    expect(a).toMatchObject({
      total: null,
      partialTotal: 18,
      unscored: ["speed"],
      complete: false,
      rank: null,
    });
    expect(r.leaderId).toBe("b");
    expect(r.options.map((o) => o.id)).toEqual(["b", "a"]);
    // A could still finish below B (19 with a 1), so B's lead stands.
    expect(r.overtakers).toEqual([]);
    expect(r.verdict).toBe("B leads with 20. 1 option isn't fully scored yet.");
  });

  it("names an unfinished option certain to overtake the leader, and holds the send", () => {
    const r = matrixResult(M, c, [
      opt("a", "A", { cost: 10 }), // partial 30: at least 31, whatever Speed gets
      opt("b", "B", { cost: 5, speed: 5 }), // 20, complete
    ]);
    // The star rule stands (only a complete option leads)…
    expect(r.leaderId).toBe("b");
    expect(r.options.find((o) => o.id === "a")?.total).toBeNull();
    // …but the lead isn't the result.
    expect(r.overtakers).toEqual([
      { id: "a", name: "A", partialTotal: 30, minTotal: 31, unscored: ["speed"] },
    ]);
    expect(r.verdict).toBe(
      "A will overtake B once Speed is scored: its scores so far (30) already beat B's Total of 20."
    );
    expect(sendError(matrix, r)).toBe("Score A's empty cells first: it will overtake the leader.");
    // A minimum that only draws level isn't certain to overtake.
    const level = matrixResult(
      M,
      [crit("cost", "Cost", 1), crit("speed", "Speed", 1)],
      [
        opt("a", "A", { cost: 9 }), // 9 + at least 1 = 10
        opt("b", "B", { cost: 5, speed: 5 }), // 10
      ]
    );
    expect(level.overtakers).toEqual([]);
    expect(sendError(matrix, level)).toBeNull();
    // Two of them, and another unfinished option that could still lose.
    const many = matrixResult(
      M,
      [crit("cost", "Cost", 3), crit("speed", "Speed", 1), crit("risk", "Risk", 1)],
      [
        opt("a", "A", { cost: 9 }), // 27 + 2 = 29
        opt("b", "B", { cost: 3, speed: 3, risk: 3 }), // 15
        opt("c", "C", { cost: 8, speed: 1 }), // 25 + 1 = 26
        opt("d", "D", { cost: 1 }), // 3 + 2 = 5
      ]
    );
    expect(many.overtakers.map((o) => [o.id, o.minTotal])).toEqual([
      ["a", 29],
      ["c", 26],
    ]);
    expect(many.verdict).toBe(
      "A and C will overtake B once their empty cells are scored: their scores so far already beat B's Total of 15. 1 other option isn't fully scored yet."
    );
  });

  it("no complete option: no leader, and the verdict counts the empty cells", () => {
    const r = matrixResult(M, c, [opt("a", "A", { cost: 4 }), opt("b", "B", {})]);
    expect(r.leaderId).toBeNull();
    expect(r.emptyCells).toBe(3);
    expect(r.verdict).toBe("No option is fully scored yet: 3 cells are empty.");
  });

  it("a weight of 0 doesn't count, and all-zero weights mean no totals", () => {
    const r = matrixResult(
      M,
      [crit("cost", "Cost", 3), crit("speed", "Speed", 0)],
      [opt("a", "A", { cost: 4 })]
    );
    expect(r.options[0]).toMatchObject({ total: 12, complete: true });
    expect(r.criteria.map((x) => [x.id, x.active, x.share])).toEqual([
      ["cost", true, 1],
      ["speed", false, 0],
    ]);
    const zero = matrixResult(M, [crit("cost", "Cost", 0)], [opt("a", "A", { cost: 4 })]);
    expect(zero.leaderId).toBeNull();
    expect(zero.verdict).toBe("Every weight is 0: give at least one criterion a weight above 0.");
  });

  it("a stored score off the 1–10 scale is flagged and not counted", () => {
    const r = matrixResult(M, c, [opt("a", "A", { cost: 15, speed: 2 })]);
    expect(r.options[0]).toMatchObject({
      total: null,
      partialTotal: 2,
      offScale: ["cost"],
      unscored: ["cost"],
    });
  });

  it("names a tie within 5% of the leader, and copes with huge weights", () => {
    const big = [crit("x", "X", 1000), crit("y", "Y", 1000)];
    const r = matrixResult(M, big, [
      opt("a", "A", { x: 10, y: 10 }),
      opt("b", "B", { x: 10, y: 9.5 }),
    ]);
    expect(r.tie).toEqual({ ids: ["a", "b"], gap: 500 });
    expect(r.verdict).toMatch(
      /^A and B are too close to call: 500 apart, within 5% of the top total\./
    );
    const clear = matrixResult(M, big, [
      opt("a", "A", { x: 10, y: 10 }),
      opt("b", "B", { x: 9, y: 9 }),
    ]);
    expect(clear.tie).toBeNull();
  });

  it("equal totals share a dense rank", () => {
    const r = matrixResult(M, c, [
      opt("a", "A", { cost: 2, speed: 2 }),
      opt("b", "B", { cost: 2, speed: 2 }),
      opt("z", "Z", { cost: 1, speed: 1 }),
    ]);
    expect(r.options.map((o) => o.rank)).toEqual([1, 1, 2]);
  });
});

describe("sensitivity", () => {
  it("finds the exact weight change that flips the leader (the example: Self-hosting 13% less)", () => {
    const ex = buildExample("2026-10-27T09:00:00.000Z");
    const r = matrixResult(ex.matrix.id, ex.criteria, ex.options);
    expect(r.leaderId).toBe("example-opt-unleash");
    expect(r.options.map((o) => [o.name, o.total])).toEqual([
      ["Unleash", 59],
      ["LaunchDarkly", 58],
      ["Build our own", null],
    ]);
    expect(r.tie?.ids).toEqual(["example-opt-unleash", "example-opt-launchdarkly"]);
    const first = r.sensitivity[0];
    expect(first).toMatchObject({
      criterion: "Self-hosting",
      direction: "less",
      newLeader: "LaunchDarkly",
    });
    expect(first.changePct).toBeCloseTo(-0.125, 10);
    expect(first.weightAt).toBeCloseTo(1.75, 10);
    expect(sensitivityText(first)).toBe(
      "Weighting Self-hosting 13% less makes LaunchDarkly the winner."
    );
    expect(r.sensitivity.map((s) => s.criterion)).toEqual([
      "Self-hosting",
      "Support",
      "Cost",
      "SDK coverage",
    ]);
    expect(changePercent(-0.1666666)).toBe(17);
  });

  it("is only worked out with 2 complete options and 2 weighted criteria, within ±50%", () => {
    const one = matrixResult(
      M,
      [crit("c", "C", 1), crit("d", "D", 1)],
      [opt("a", "A", { c: 5, d: 5 })]
    );
    expect(one.sensitivityChecked).toBe(false);
    const far = matrixResult(
      M,
      [crit("c", "C", 1), crit("d", "D", 1)],
      [opt("a", "A", { c: 10, d: 10 }), opt("b", "B", { c: 1, d: 2 })]
    );
    expect(far.sensitivityChecked).toBe(true);
    expect(far.sensitivity).toEqual([]);
  });
});

describe("input checks", () => {
  it("scores run 1–10; blank clears; weights are required and 0 or more", () => {
    expect(scoreInputError("")).toBeNull();
    expect(scoreInputError("7.5")).toBeNull();
    expect(scoreInputError("0")).toBe("Scores run from 1 to 10.");
    expect(scoreInputError("abc")).toBe("Scores run from 1 to 10.");
    expect(weightError("")).toBe("Give it a weight (0 or more).");
    expect(weightError("-1")).toBe("A weight is a number, 0 or more.");
    expect(weightError("0")).toBeNull();
    expect(validateCriterion({ name: "cost", weight: "2", low: "", high: "" }, ["Cost"]).ok).toBe(
      false
    );
  });

  it("re-saving an option keeps its matrix and note", () => {
    const stored = { ...opt("a", "A", { c: 1 }), note: "Kept" };
    expect(mergeOption(stored, { id: "a", name: "A2", scores: { c: 3 } })).toEqual({
      id: "a",
      name: "A2",
      scores: { c: 3 },
      matrixId: M,
      note: "Kept",
    });
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  const c = [crit("cost", "Cost", 3), crit("speed", "Speed", 1)];
  const o = [opt("a", "Alpha", { cost: 5, speed: 5 }), opt("b", "Bravo", { cost: 4, speed: 4 })];

  it("creates a named matrix and opens it (?matrix= opens one too)", () => {
    expect(readMatrixParam("?matrix=abc")).toBe("abc");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New matrix" }));
    fireEvent.click(screen.getByRole("button", { name: "Create matrix" }));
    expect(screen.getByText("Name the matrix.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Matrix name/), { target: { value: "Vendors" } });
    fireEvent.click(screen.getByRole("button", { name: "Create matrix" }));
    const m = ws().weightedMatrices?.[0];
    expect(m?.name).toBe("Vendors");
    expect(window.location.search).toBe(`?matrix=${m?.id}`);
    expect((screen.getByLabelText("Matrix") as HTMLSelectElement).value).toBe(m?.id);
  });

  it("legacy rows open as the Untitled matrix, and naming it writes its document", () => {
    seed([], [crit("cost", "Cost", 1, null)], [opt("a", "Alpha", { cost: 5 }, null)]);
    renderPage();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe(DEFAULT_MATRIX_NAME);
    fireEvent.change(name, { target: { value: "Old matrix" } });
    fireEvent.blur(name);
    expect(ws().weightedMatrices?.[0]).toMatchObject({
      id: DEFAULT_WEIGHTED_MATRIX_ID,
      name: "Old matrix",
    });
  });

  it("rows keep their place while scoring, with a Re-sort chip; the star needs a full row", () => {
    seed([matrix], c, [...o, opt("c", "Charlie", { cost: 10 })]);
    renderPage();
    expect(rowOrder()).toEqual(["Alpha", "Bravo", "Charlie"]);
    // Charlie's partial 30 doesn't take the star from Alpha's complete 20.
    const alpha = screen.getByDisplayValue("Alpha").closest("tr")!;
    expect(within(alpha).getByText("(top option)")).toBeInTheDocument();
    const charlie = screen.getByDisplayValue("Charlie").closest("tr")!;
    expect(within(charlie).getByText("Partial: 30")).toBeInTheDocument();
    expect(within(charlie).queryByText("(top option)")).not.toBeInTheDocument();

    score("Speed", "Bravo", "10");
    expect(ws().weightedOptions?.find((x) => x.id === "b")?.scores).toEqual({ cost: 4, speed: 10 });
    expect(rowOrder()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(screen.getByText("Scores changed since the last sort.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(rowOrder()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("deleting a criterion takes its scores, and Undo puts both back", () => {
    seed([matrix], c, o);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete the criterion Speed" }));
    expect(ws().weightedCriteria?.map((x) => x.id)).toEqual(["cost"]);
    expect(ws().weightedOptions?.find((x) => x.id === "a")?.scores).toEqual({ cost: 5 });
    undoLast();
    expect(
      ws()
        .weightedCriteria?.map((x) => x.id)
        .sort()
    ).toEqual(["cost", "speed"]);
    expect(ws().weightedOptions?.find((x) => x.id === "a")?.scores).toEqual({ cost: 5, speed: 5 });
  });

  it("deletes an option and a whole matrix with Undo (the matrix asks first)", () => {
    seed([matrix], c, o);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete the option Bravo" }));
    expect(ws().weightedOptions?.map((x) => x.id)).toEqual(["a"]);
    undoLast();
    expect(
      ws()
        .weightedOptions?.map((x) => x.id)
        .sort()
    ).toEqual(["a", "b"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete the matrix Hosting" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete matrix" }));
    expect(ws().weightedMatrices).toEqual([]);
    expect(ws().weightedOptions).toEqual([]);
    expect(ws().weightedCriteria).toEqual([]);
    undoLast();
    expect(ws().weightedMatrices?.map((m) => m.id)).toEqual([M]);
    expect(ws().weightedOptions?.length).toBe(2);
    expect(ws().weightedCriteria?.length).toBe(2);
  });

  it("adds criteria and options only when valid; a cleared weight is an error, not 1", () => {
    seed([matrix], [], []);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Criterion name/), { target: { value: "Cost" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getByText("Give it a weight (0 or more).")).toBeInTheDocument();
    expect(ws().weightedCriteria).toEqual([]);
    fireEvent.change(screen.getByLabelText(/^Criterion weight/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(ws().weightedCriteria?.[0]).toMatchObject({ name: "Cost", weight: 2, matrixId: M });
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    expect(screen.getByText("Name the option.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Option name/), { target: { value: "Vendor A" } });
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    expect(ws().weightedOptions?.[0]).toMatchObject({ name: "Vendor A", scores: {}, matrixId: M });
  });

  it("sends the result to a proposed decision record, options in rank order", () => {
    seed([matrix], c, o);
    renderPage();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Send to…/ }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Decision record (proposed)" }));
    const d = ws().decisions[0];
    expect(d).toMatchObject({
      title: "Where do we host?",
      status: "proposed",
      decision: "",
      template: "adr",
      number: 1,
      recommendation: "Alpha (weighted total 20)",
      sourceRef: { tool: "weighted-decision", id: M, doc: M },
    });
    expect(d.options?.map((x) => x.text)).toEqual(["Alpha", "Bravo"]);
    expect(ws().weightedMatrices?.[0].sentTo?.[0]).toMatchObject({
      route: "decision",
      targetId: d.id,
    });
    expect(
      screen.getByRole("link", { name: /Proposed in the Decision Log · Open/ })
    ).toHaveAttribute("href", `/decision-log?id=${encodeURIComponent(d.id)}`);
  });

  it("can't send without a complete leader, or from the example", () => {
    const r = matrixResult(M, c, [opt("a", "A", { cost: 1 })]);
    expect(sendError(matrix, r)).toBe(
      "Score every cell of one option first: the record needs a leader."
    );
    const ex = buildExample("2026-10-27T00:00:00.000Z");
    expect(sendError(ex.matrix, matrixResult(ex.matrix.id, ex.criteria, ex.options))).toBe(
      "Example matrices stay out of the Decision Log."
    );
  });

  it("loads and clears the example; the verdict names the tie", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(
      screen.getAllByText(/Unleash and LaunchDarkly are too close to call/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("status").some((el) => /^Too close to call/.test(el.textContent ?? ""))
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(ws().weightedMatrices).toEqual([]);
    expect(ws().weightedOptions).toEqual([]);
    expect(ws().weightedCriteria).toEqual([]);
  });
});

describe("Markdown and the chart's text", () => {
  it("shows — for unscored cells, totals or partials, the star and the sensitivity", () => {
    const ex = buildExample("2026-10-27T00:00:00.000Z");
    const r = matrixResult(ex.matrix.id, ex.criteria, ex.options);
    const md = matrixToMarkdown(ex.matrix, r, ex.options);
    expect(md).toContain("# Which feature-flag service do we adopt?");
    expect(md).toContain("| Unleash | 8 | 7 | 9 | 3 | 59 ★ |");
    expect(md).toContain("| Build our own | 6 | 4 | 10 | — | partial 46 (1 not scored) |");
    expect(md).toContain("| Cost | 3 | 38% | Over budget | Well under budget |");
    expect(md).toContain("- Weighting Self-hosting 13% less makes LaunchDarkly the winner.");
    const text = totalsChartText(r);
    expect(text.table.rows).toEqual([
      ["Unleash", "59", 1],
      ["LaunchDarkly", "58", 2],
    ]);
    expect(text.summary).toMatch(/1 option isn't charted until every cell is scored/);
  });
});

/* ── The agent ──────────────────────────────────────────────────────── */

describe("the agent computes what the page shows", () => {
  it("list_state carries the page's totals, leader, tie and verdict", async () => {
    const ex = buildExample("2026-10-27T00:00:00.000Z");
    seed([ex.matrix], ex.criteria, ex.options);
    renderPage();
    const state = await run<{
      matrices: { id: string; verdict: string; leaderId: string; tie: unknown }[];
    }>("list_state", { matrixId: ex.matrix.id });
    const m = state.matrices[0];
    expect(m.leaderId).toBe("example-opt-unleash");
    expect(screen.getAllByText(m.verdict).length).toBeGreaterThan(0);
    expect(m).toEqual(expect.objectContaining(matrixResult(ex.matrix.id, ex.criteria, ex.options)));
  });

  it("set_score refuses off-scale scores; persisting keeps the matrix and the note", async () => {
    seed([matrix], [crit("cost", "Cost", 1)], [{ ...opt("a", "Alpha", {}), note: "Ours" }]);
    expect(await run("set_score", { optionId: "a", criterionId: "cost", score: 11 })).toMatchObject(
      {
        updated: false,
        reason: "off_scale",
      }
    );
    expect(await run("set_score", { optionId: "a", criterionId: "cost", score: 7 })).toEqual({
      updated: true,
    });
    const saved = await run<{ offScale: string[] }>("score_and_persist_option", {
      id: "a",
      name: "Alpha",
      scores: { cost: 12 },
    });
    expect(saved.offScale).toEqual(["cost"]);
    expect(ws().weightedOptions?.[0]).toEqual({
      id: "a",
      name: "Alpha",
      scores: { cost: 12 },
      matrixId: M,
      note: "Ours",
    });
    await run("persist_options", { options: [{ id: "a", name: "Alpha", scores: { cost: 3 } }] });
    expect(ws().weightedOptions?.[0]).toMatchObject({
      matrixId: M,
      note: "Ours",
      scores: { cost: 3 },
    });
  });

  it("builds a matrix and sends it to a decision record, once", async () => {
    const m = await run<{ id: string }>("create_matrix", { name: "Pick", question: "Which one?" });
    const cost = await run<{ id: string }>("add_criterion", {
      matrixId: m.id,
      name: "Cost",
      weight: 2,
    });
    expect(await run("add_criterion", { matrixId: m.id, name: "cost", weight: 1 })).toMatchObject({
      added: false,
      reason: "name_taken",
    });
    const a = await run<{ id: string }>("add_option", { matrixId: m.id, name: "A" });
    const b = await run<{ id: string }>("add_option", { matrixId: m.id, name: "B" });
    expect(await run("send_to_decision", { matrixId: m.id })).toMatchObject({
      sent: false,
      reason: "no_leader",
    });
    await run("set_score", { optionId: a.id, criterionId: cost.id, score: 4 });
    await run("set_score", { optionId: b.id, criterionId: cost.id, score: 9 });
    const sent = await run<{ sent: boolean; decisionId: string; status: string }>(
      "send_to_decision",
      {
        matrixId: m.id,
      }
    );
    expect(sent).toMatchObject({ sent: true, status: "proposed" });
    const d = ws().decisions.find((x) => x.id === sent.decisionId)!;
    expect(d.options?.map((x) => x.text)).toEqual(["B", "A"]);
    expect(d.title).toBe("Which one?");
    expect(await run("send_to_decision", { matrixId: m.id })).toMatchObject({
      sent: false,
      reason: "already_sent",
    });
    expect(
      decisionSourceOf(
        ws().weightedMatrices!.find((x) => x.id === m.id)!,
        matrixResult(m.id, ws().weightedCriteria, ws().weightedOptions)
      ).decision?.recommendation
    ).toBe("B (weighted total 18)");
  });

  it("compute verbs say which options are complete", async () => {
    const out = await run<{ ranked: { id: string; complete: boolean; unscored: string[] }[] }>(
      "compute_and_rank",
      {
        options: [
          { id: "x", name: "X", scores: { c: 5 } },
          { id: "y", name: "Y", scores: { c: 4, d: 4 } },
        ],
        criteriaWeights: { c: 1, d: 1 },
      }
    );
    expect(out.ranked.map((r) => [r.id, r.complete, r.unscored])).toEqual([
      ["y", true, []],
      ["x", false, ["d"]],
    ]);
    const one = await run<{ complete: boolean; unscored: string[] }>("compute_option_score", {
      optionScores: { c: 5 },
      criteriaWeights: { c: 1, d: 0 },
    });
    expect(one).toMatchObject({ complete: true, unscored: [] });
  });
});

/* ── Review fixes ───────────────────────────────────────────────────── */

const card = (id: string, sourceRef?: { tool: string; entityId: string }): WhiteboardObject =>
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
    ...(sourceRef ? { sourceRef } : {}),
  }) as unknown as WhiteboardObject;

describe("review fixes: the result and the record", () => {
  const c = [crit("cost", "Cost", 3), crit("speed", "Speed", 1)];

  it("the agent refuses to send a matrix whose leader is certain to be overtaken", async () => {
    seed([matrix], c, [opt("a", "A", { cost: 10 }), opt("b", "B", { cost: 5, speed: 5 })]);
    expect(await run("send_to_decision", { matrixId: M })).toMatchObject({
      sent: false,
      reason: "overtaken",
      message: "Score A's empty cells first: it will overtake the leader.",
    });
    expect(ws().decisions).toEqual([]);
    // The page says the same, and keeps the send closed.
    renderPage();
    expect(
      screen.getByText(/^A will overtake B once Speed is scored/, { selector: "p" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Send to…/ })).toBeDisabled();
    expect(
      screen.getByText("Score A's empty cells first: it will overtake the leader.")
    ).toBeInTheDocument();
  });

  it("a tie recommends the tied options, not the alphabetically first", () => {
    const ex = buildExample("2026-10-27T00:00:00.000Z");
    const r = matrixResult(ex.matrix.id, ex.criteria, ex.options);
    expect(r.tie).not.toBeNull();
    expect(recommendationOf(r)).toBe(
      "Too close to call: Unleash (59) and LaunchDarkly (58) are within 5% of each other. Talk it through."
    );
    expect(decisionSourceOf(ex.matrix, r).decision?.recommendation).toBe(recommendationOf(r));
    // No tie: the leader with its Total.
    const clear = matrixResult(M, c, [
      opt("a", "A", { cost: 5, speed: 5 }),
      opt("b", "B", { cost: 1, speed: 1 }),
    ]);
    expect(recommendationOf(clear)).toBe("A (weighted total 20)");
    expect(recommendationOf(matrixResult(M, c, []))).toBeUndefined();
  });

  it("the export stars every tied option, as the table does", () => {
    const ex = buildExample("2026-10-27T00:00:00.000Z");
    const md = matrixToMarkdown(
      ex.matrix,
      matrixResult(ex.matrix.id, ex.criteria, ex.options),
      ex.options
    );
    expect(md).toContain("| Unleash | 8 | 7 | 9 | 3 | 59 ★ |");
    expect(md).toMatch(/\| LaunchDarkly \|[^\n]*\| 58 ★ \|/);
  });

  it("once sent, the record's link stays when the matrix loses its leader", () => {
    seed([matrix], c, [opt("a", "Alpha", { cost: 5, speed: 5 }), opt("b", "Bravo", { cost: 4 })]);
    renderPage();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Send to…/ }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Decision record (proposed)" }));
    const id = ws().decisions[0].id;
    // A new criterion leaves every option partly scored: no leader any more.
    fireEvent.change(screen.getByLabelText(/^Criterion name/), { target: { value: "Risk" } });
    fireEvent.change(screen.getByLabelText(/^Criterion weight/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(
      screen.getByRole("link", { name: /Proposed in the Decision Log · Open/ })
    ).toHaveAttribute("href", `/decision-log?id=${encodeURIComponent(id)}`);
    expect(
      screen.queryByText("Score every cell of one option first: the record needs a leader.")
    ).not.toBeInTheDocument();
    // The menu, with its "Sent · Open", stays reachable.
    expect(screen.getByRole("button", { name: /^Send to…/ })).toBeEnabled();
  });

  it("a deleted record reads as not sent, to the agent and in the export, as on the page", async () => {
    seed([matrix], c, [opt("a", "Alpha", { cost: 5, speed: 5 })]);
    const sent = await run<{ decisionId: string }>("send_to_decision", { matrixId: M });
    const state = await run<{
      matrices: { sentToDecision: string | null; sentDecision: unknown }[];
    }>("list_state", { matrixId: M });
    expect(state.matrices[0].sentToDecision).toBe(sent.decisionId);
    expect(state.matrices[0].sentDecision).toMatchObject({
      id: sent.decisionId,
      label: "ADR-0001",
      status: "proposed",
      decided: false,
    });

    // Decided in the Decision Log: the export says so.
    act(() =>
      useWorkspaceStore.setState((s) => ({
        decisions: s.decisions.map((d) => ({ ...d, status: "accepted" as const })),
      }))
    );
    const view = renderPage();
    expect(screen.getByTestId("export-markdown").textContent).toContain(sentText(true));
    expect(
      (
        await run<{ matrices: { sentDecision: { decided: boolean } }[] }>("list_state", {
          matrixId: M,
        })
      ).matrices[0].sentDecision.decided
    ).toBe(true);
    view.unmount();

    // Deleted: not sent, anywhere.
    act(() => useWorkspaceStore.setState({ decisions: [] }));
    renderPage();
    expect(screen.getByTestId("export-markdown").textContent).not.toContain(
      "Sent to the Decision Log"
    );
    const after = await run<{
      matrices: { sentToDecision: string | null; sentDecision: unknown }[];
    }>("list_state", { matrixId: M });
    expect(after.matrices[0]).toMatchObject({ sentToDecision: null, sentDecision: null });
    expect(await run("send_to_decision", { matrixId: M })).toMatchObject({ sent: true });
  });
});

describe("review fixes: agent writes land in a matrix", () => {
  it("score_and_persist_option and persist_options refuse an unknown matrixId, writing nothing", async () => {
    seed([matrix], [crit("cost", "Cost", 1)], [opt("a", "Alpha", {})]);
    expect(
      await run("score_and_persist_option", {
        name: "Ghost",
        scores: { cost: 3 },
        matrixId: "weightedMatrix_nope",
      })
    ).toEqual({ persisted: false, reason: "matrix_not_found", matrixId: "weightedMatrix_nope" });
    expect(
      await run("persist_options", {
        options: [
          { id: "a", name: "Alpha", scores: { cost: 4 } },
          { name: "Ghost", scores: {}, matrixId: "weightedMatrix_nope" },
        ],
      })
    ).toMatchObject({
      written: [],
      count: 0,
      persisted: false,
      reason: "matrix_not_found",
      matrixIds: ["weightedMatrix_nope"],
    });
    // All or nothing: Alpha wasn't re-scored either.
    expect(ws().weightedOptions).toEqual([opt("a", "Alpha", {})]);
    // A known matrix, or the default one, is fine.
    const ok = await run<{ id: string }>("score_and_persist_option", {
      name: "Beta",
      scores: { cost: 2 },
      matrixId: M,
    });
    expect(ws().weightedOptions?.find((o) => o.id === ok.id)?.matrixId).toBe(M);
    const legacy = await run<{ written: string[] }>("persist_options", {
      options: [{ name: "Old", scores: {}, matrixId: DEFAULT_WEIGHTED_MATRIX_ID }],
    });
    expect(ws().weightedOptions?.find((o) => o.id === legacy.written[0])?.matrixId).toBeUndefined();
  });
});

describe("review fixes: editing in place", () => {
  const c = [crit("cost", "Cost", 3), crit("speed", "Speed", 1)];
  const o = [opt("a", "Alpha", { cost: 5, speed: 5 }), opt("b", "Bravo", { cost: 4, speed: 4 })];

  it("a blanked or repeated option name isn't saved: the field shows the stored name and why", () => {
    seed([matrix], c, o);
    renderPage();
    const name = screen.getByLabelText("Name of the option Bravo") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);
    expect(name.value).toBe("Bravo");
    expect(screen.getByText("Name the option. It's still called “Bravo”.")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name.getAttribute("aria-describedby")).toBe(
      screen.getByText("Name the option. It's still called “Bravo”.").id
    );
    fireEvent.change(name, { target: { value: "alpha" } });
    fireEvent.blur(name);
    expect(name.value).toBe("Bravo");
    expect(
      screen.getByText(
        "This matrix already has an option with that name. It's still called “Bravo”."
      )
    ).toBeInTheDocument();
    expect(ws().weightedOptions?.find((x) => x.id === "b")?.name).toBe("Bravo");
    fireEvent.change(name, { target: { value: "Bravo 2" } });
    fireEvent.blur(name);
    expect(ws().weightedOptions?.find((x) => x.id === "b")?.name).toBe("Bravo 2");
    expect(screen.queryByText(/It's still called/)).not.toBeInTheDocument();
  });

  it("a criterion's rename and weight follow the add form's rules, with the error tied to the field", () => {
    seed([matrix], c, o);
    renderPage();
    const name = screen.getByLabelText("Name of the criterion Speed") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "COST" } });
    fireEvent.blur(name);
    expect(name.value).toBe("Speed");
    expect(
      screen.getByText(
        "This matrix already has a criterion with that name. It's still called “Speed”."
      )
    ).toBeInTheDocument();
    expect(ws().weightedCriteria?.find((x) => x.id === "speed")?.name).toBe("Speed");

    const weight = screen.getByLabelText("Weight of Cost") as HTMLInputElement;
    fireEvent.change(weight, { target: { value: "" } });
    fireEvent.blur(weight);
    expect(weight.value).toBe("3");
    const error = screen.getByText("Give it a weight (0 or more). It stays at 3.");
    expect(weight.getAttribute("aria-describedby")).toBe(error.id);
    expect(ws().weightedCriteria?.find((x) => x.id === "cost")?.weight).toBe(3);
    fireEvent.change(weight, { target: { value: "4" } });
    fireEvent.blur(weight);
    expect(ws().weightedCriteria?.find((x) => x.id === "cost")?.weight).toBe(4);
  });

  it("the matrix's question hint is tied to its field, and a blanked name says why", () => {
    seed([matrix], c, o);
    renderPage();
    const question = screen.getByLabelText("What are you deciding?");
    expect(question.getAttribute("aria-describedby")).toBe(
      screen.getByText("Becomes the decision record's title.").id
    );
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.blur(name);
    expect(name.value).toBe("Hosting");
    expect(screen.getByText("A matrix needs a name: it's still “Hosting”.")).toBeInTheDocument();
  });
});

describe("review fixes: focus and Undo after a delete", () => {
  const c = [crit("cost", "Cost", 3), crit("speed", "Speed", 1)];
  const o = [opt("a", "Alpha", { cost: 5, speed: 5 }), opt("b", "Bravo", { cost: 4, speed: 4 })];

  it("deleting an option or a criterion moves focus to its neighbour, then to the add field", () => {
    seed([matrix], c, o);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete the option Alpha" }));
    expect(screen.getByRole("button", { name: "Delete the option Bravo" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete the option Bravo" }));
    expect(screen.getByLabelText(/^Option name/)).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Delete the criterion Speed" }));
    expect(screen.getByRole("button", { name: "Delete the criterion Cost" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete the criterion Cost" }));
    expect(screen.getByLabelText(/^Criterion name/)).toHaveFocus();
  });

  it("Undo of an option delete, or a matrix delete, pins the canvas cards back", () => {
    seed([matrix], c, o);
    act(() =>
      useWorkspaceStore.setState({
        whiteboardObjects: [
          card("k1", { tool: "weightedOption", entityId: "a" }),
          card("k2", { tool: "weightedOption", entityId: "b" }),
          card("k3"),
        ],
      })
    );
    renderPage();
    const linkOf = (id: string) =>
      ws().whiteboardObjects?.find((x) => x.id === id)?.sourceRef?.entityId;
    fireEvent.click(screen.getByRole("button", { name: "Delete the option Alpha" }));
    expect(linkOf("k1")).toBeUndefined();
    undoLast();
    expect(linkOf("k1")).toBe("a");

    fireEvent.click(screen.getByRole("button", { name: "Delete the matrix Hosting" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete matrix" }));
    expect([linkOf("k1"), linkOf("k2")]).toEqual([undefined, undefined]);
    undoLast();
    expect([linkOf("k1"), linkOf("k2"), linkOf("k3")]).toEqual(["a", "b", undefined]);
  });
});
