import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { LLMEval } from "@/lib/stores/workspace-types";
import type { ActiveLlm } from "@/lib/llm/use-active-llm";
import { detectRegressions, rollingLowerBound } from "@/lib/analytics/eval-regression";

/**
 * LLM Eval Tracker: manual + live (BYOK) score logging with validation, the
 * KPI row, chart-data shaping, the newest-first table, regression alerts
 * (and their once-only signal), the CSV export, plus the pure regression
 * detector the page is built on.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));
const llm = vi.hoisted(() => ({ state: { isReady: false } as ActiveLlm }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/signals/signal-bus", () => ({ emitSignal: signals.emit }));
vi.mock("@/lib/llm/use-active-llm", () => ({ useActiveLlm: () => llm.state }));
vi.mock("@/lib/utils/toast", () => ({ toast: toasts }));
vi.mock("@/components/shared/ai-run-panel", () => ({
  default: ({ prompt, toolName }: { prompt: string; toolName: string }) => (
    <div data-testid="ai-run-panel" data-tool={toolName}>
      {prompt}
    </div>
  ),
}));
vi.mock("@/app/(tools)/llm-eval-tracker/charts", () => ({
  ScoreOverTimeChart: ({ data, series }: { data: unknown; series: unknown }) => (
    <pre data-testid="score-chart">{JSON.stringify({ data, series })}</pre>
  ),
}));

import { LLMEvalTrackerClient } from "@/app/(tools)/llm-eval-tracker/llm-eval-tracker-client";

const DEDUPE_KEY = "agile-toolkit:llm-eval:emitted-regressions:v1";

const openSettings = vi.fn();
const NOT_READY: ActiveLlm = {
  isReady: false,
  provider: null,
  providerName: null,
  model: null,
  openSettings,
};
const READY: ActiveLlm = {
  isReady: true,
  provider: "anthropic",
  providerName: "Anthropic",
  model: "claude-test",
  openSettings,
};

const ev = (id: string, score: number, recordedAt: string, p: Partial<LLMEval> = {}): LLMEval => ({
  id,
  model: "gpt-5",
  dataset: "faith",
  score,
  recordedAt,
  ...p,
});
const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T09:00:00.000Z`;

const state = () => useWorkspaceStore.getState().llmEvals ?? [];
const kpi = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const textbox = (name: string) => screen.getAllByRole("textbox", { name });
const scoreInputs = () => screen.getAllByRole("spinbutton", { name: "Score 0–1" });
/** Manual-form inputs (the live form, when shown, renders first). */
function manual() {
  const pv = textbox("Prompt version (optional)");
  const sc = scoreInputs();
  return {
    model: screen.getByRole("textbox", { name: "Model" }),
    dataset: screen.getByRole("textbox", { name: "Dataset" }),
    promptVersion: pv[pv.length - 1],
    score: sc[sc.length - 1],
    log: screen.getByRole("button", { name: "Log" }),
  };
}
/** Table body rows as [date, model, dataset, prompt v, score]. */
function tableRows() {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) =>
      within(r)
        .getAllByRole("cell")
        .slice(0, 5)
        .map((c) => c.textContent)
    );
}
function chart() {
  return JSON.parse(screen.getByTestId("score-chart").textContent ?? "{}") as {
    data: Record<string, string | number>[];
    series: { key: string; label: string }[];
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({ llmEvals: [] });
  localStorage.removeItem(DEDUPE_KEY);
  llm.state = NOT_READY;
  exported.csv = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
  toasts.success.mockClear();
  toasts.error.mockClear();
  openSettings.mockClear();
});

describe("LLM Eval Tracker: empty state", () => {
  it("shows zero KPIs (0.0%, not NaN%) and no chart or table", () => {
    render(<LLMEvalTrackerClient />);
    expect(kpi("Total runs")).toBe("0");
    expect(kpi("Datasets")).toBe("0");
    expect(kpi("Last 5 mean")).toBe("0.0%");
    expect(kpi("Regressions")).toBe("0");
    expect(screen.queryByText("Score over time")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Detected regressions")).not.toBeInTheDocument();
  });

  it("asks for a BYOK provider instead of showing the live form", () => {
    render(<LLMEvalTrackerClient />);
    expect(screen.getByText("No BYOK provider configured yet.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Dataset name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});

describe("LLM Eval Tracker: manual logging", () => {
  it("logs a trimmed eval, keeps model/dataset/version for the next run and clears the score", () => {
    render(<LLMEvalTrackerClient />);
    const f = manual();
    fireEvent.change(f.model, { target: { value: "  gpt-5 " } });
    fireEvent.change(f.dataset, { target: { value: " faith " } });
    fireEvent.change(f.promptVersion, { target: { value: " v2 " } });
    fireEvent.change(f.score, { target: { value: "0.875" } });
    fireEvent.click(f.log);

    expect(state()).toHaveLength(1);
    expect(state()[0]).toMatchObject({
      model: "gpt-5",
      dataset: "faith",
      promptVersion: "v2",
      score: 0.875,
    });
    expect(Number.isNaN(Date.parse(state()[0].recordedAt))).toBe(false);
    expect(manual().score).toHaveValue(null);
    expect(manual().model).toHaveValue("  gpt-5 ");
    expect(manual().dataset).toHaveValue(" faith ");
    expect(signals.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "llmEval.recorded", toolId: "llm-eval-tracker" })
    );
    expect(history.log).toHaveBeenCalledWith("eval_logged", { model: "gpt-5", score: 0.875 });
    expect(kpi("Total runs")).toBe("1");
    expect(kpi("Last 5 mean")).toBe("87.5%");
  });

  it("accepts the boundary scores 0 and 1", () => {
    render(<LLMEvalTrackerClient />);
    const f = manual();
    fireEvent.change(f.model, { target: { value: "m" } });
    fireEvent.change(f.dataset, { target: { value: "d" } });
    fireEvent.change(f.score, { target: { value: "0" } });
    fireEvent.click(f.log);
    fireEvent.change(manual().score, { target: { value: "1" } });
    fireEvent.click(manual().log);
    expect(state().map((e) => e.score)).toEqual([0, 1]);
    expect(state()[0].promptVersion).toBeUndefined();
  });

  it("rejects a missing model or dataset, a blank score, and scores outside 0–1", () => {
    render(<LLMEvalTrackerClient />);
    const f = manual();
    fireEvent.change(f.score, { target: { value: "0.5" } });
    fireEvent.click(f.log); // no model / dataset
    fireEvent.change(f.model, { target: { value: "m" } });
    fireEvent.click(f.log); // no dataset
    fireEvent.change(f.dataset, { target: { value: "   " } });
    fireEvent.click(f.log); // blank dataset
    fireEvent.change(f.dataset, { target: { value: "d" } });
    for (const bad of ["", "1.5", "-0.1"]) {
      fireEvent.change(f.score, { target: { value: bad } });
      fireEvent.click(f.log);
    }
    expect(state()).toHaveLength(0);
    expect(signals.emit).not.toHaveBeenCalled();
  });
});

describe("LLM Eval Tracker: KPIs, chart and table", () => {
  it("counts runs and distinct datasets", () => {
    useWorkspaceStore.setState({
      llmEvals: [
        ev("e1", 0.8, day(1)),
        ev("e2", 0.6, day(2), { dataset: "mmlu" }),
        ev("e3", 0.7, day(3)),
      ],
    });
    render(<LLMEvalTrackerClient />);
    expect(kpi("Total runs")).toBe("3");
    expect(kpi("Datasets")).toBe("2");
    expect(kpi("Last 5 mean")).toBe("70.0%");
  });

  // Bug: "Last 5 mean" averaged the last five rows in STORE order, so an eval
  // backfilled with an old recordedAt (agent / sync) counted as one of the
  // latest five while a genuinely recent run was dropped.
  it("averages the five most recent runs by recordedAt, not by store order", () => {
    useWorkspaceStore.setState({
      llmEvals: [
        ev("e1", 0.9, day(1)),
        ev("e2", 0.9, day(2)),
        ev("e3", 0.9, day(3)),
        ev("e4", 0.9, day(4)),
        ev("e5", 0.9, day(5)),
        ev("old", 0.1, "2026-01-01T09:00:00.000Z"),
      ],
    });
    render(<LLMEvalTrackerClient />);
    expect(kpi("Last 5 mean")).toBe("90.0%");
  });

  it("lists runs newest first with formatted scores and removes the clicked one", () => {
    useWorkspaceStore.setState({
      llmEvals: [
        ev("e1", 0.8, day(1), { promptVersion: "v1" }),
        ev("e2", 0.1234, day(3), { model: "claude" }),
        ev("e3", 1, day(2)),
      ],
    });
    render(<LLMEvalTrackerClient />);
    expect(screen.getByText("Eval log (3)")).toBeInTheDocument();
    expect(tableRows()).toEqual([
      ["2026-10-03", "claude", "faith", "—", "12.3%"],
      ["2026-10-02", "gpt-5", "faith", "—", "100.0%"],
      ["2026-10-01", "gpt-5", "faith", "v1", "80.0%"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove eval: claude on faith" }));
    expect(state().map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(history.log).toHaveBeenCalledWith("eval_removed", { id: "e2" });
    // Display sort never reorders the store.
    expect(tableRows()).toHaveLength(2);
  });

  // Bug: the newest-first sort subtracted raw Date values, so one unparseable
  // recordedAt (record_eval accepts any string) made the comparator
  // inconsistent and left valid rows out of order.
  it("keeps valid runs newest first and sinks an unparseable date", () => {
    useWorkspaceStore.setState({
      llmEvals: [
        ev("old", 0.5, day(1), { model: "old" }),
        ev("bad", 0.5, "yesterday", { model: "bad" }),
        ev("new", 0.5, day(9), { model: "new" }),
      ],
    });
    render(<LLMEvalTrackerClient />);
    expect(tableRows().map((r) => r[1])).toEqual(["new", "old", "bad"]);
  });

  it("feeds the chart chronological points with sanitised per-dataset keys", async () => {
    useWorkspaceStore.setState({
      llmEvals: [
        ev("e1", 0.7, day(3), { dataset: "faith.v2" }),
        ev("e2", 0.9, day(1), { dataset: "mmlu[5-shot]" }),
        ev("e3", 0.8, day(2), { dataset: "faith.v2" }),
      ],
    });
    render(<LLMEvalTrackerClient />);
    await screen.findByTestId("score-chart");
    const { data, series } = chart();
    expect(series).toEqual([
      { key: "ds0", label: "faith.v2" },
      { key: "ds1", label: "mmlu[5-shot]" },
    ]);
    expect(data).toEqual([
      { idx: 1, date: "2026-10-01", ds1: 0.9 },
      { idx: 2, date: "2026-10-02", ds0: 0.8 },
      { idx: 3, date: "2026-10-03", ds0: 0.7 },
    ]);
  });

  it("exports one CSV row per run", () => {
    useWorkspaceStore.setState({
      llmEvals: [ev("e1", 0.8, day(1), { promptVersion: "v1" }), ev("e2", 0.5, day(2))],
    });
    render(<LLMEvalTrackerClient />);
    expect(exported.csv?.headers).toEqual(["Date", "Model", "Dataset", "Prompt Version", "Score"]);
    expect(exported.csv?.rows).toEqual([
      ["2026-10-01", "gpt-5", "faith", "v1", 0.8],
      ["2026-10-02", "gpt-5", "faith", "", 0.5],
    ]);
  });
});

describe("LLM Eval Tracker: regressions", () => {
  const regressing = () => [
    ev("b1", 0.9, day(1)),
    ev("b2", 0.91, day(2)),
    ev("b3", 0.89, day(3)),
    ev("r1", 0.6, day(4)),
    ev("r2", 0.61, day(5)),
    ev("r3", 0.59, day(6)),
  ];

  it("shows a detected regression with its baseline → recent means", () => {
    useWorkspaceStore.setState({ llmEvals: regressing() });
    render(<LLMEvalTrackerClient />);
    expect(kpi("Regressions")).toBe("1");
    expect(screen.getByText("Detected regressions")).toBeInTheDocument();
    expect(screen.getByText("default|faith").parentElement).toHaveTextContent(
      "default|faith — 90.0% → 60.0%"
    );
    expect(screen.getByText(/^Δ -30\.0 pts · t=36\.\d\d · 99% conf$/)).toBeInTheDocument();
  });

  it("does not flag an improvement or too few samples", () => {
    useWorkspaceStore.setState({
      llmEvals: [
        ev("b1", 0.6, day(1)),
        ev("b2", 0.61, day(2)),
        ev("b3", 0.59, day(3)),
        ev("r1", 0.9, day(4)),
        ev("r2", 0.91, day(5)),
        ev("r3", 0.89, day(6)),
        ev("x1", 0.9, day(1), { dataset: "small" }),
        ev("x2", 0.1, day(2), { dataset: "small" }),
      ],
    });
    render(<LLMEvalTrackerClient />);
    expect(kpi("Regressions")).toBe("0");
    expect(screen.queryByText("Detected regressions")).not.toBeInTheDocument();
  });

  it("emits the regression signal once, remembered across page loads", () => {
    useWorkspaceStore.setState({ llmEvals: regressing() });
    const regressionSignals = () =>
      signals.emit.mock.calls.filter(
        ([s]) => (s as { kind: string }).kind === "llmEval.regressionDetected"
      );
    const first = render(<LLMEvalTrackerClient />);
    expect(regressionSignals()).toHaveLength(1);
    expect(regressionSignals()[0][0]).toMatchObject({
      payload: { group: "default|faith", baselineN: 3, recentN: 3 },
    });
    expect(JSON.parse(localStorage.getItem(DEDUPE_KEY) ?? "[]")).toHaveLength(1);

    first.unmount();
    render(<LLMEvalTrackerClient />);
    expect(regressionSignals()).toHaveLength(1);
  });

  it("starts fresh when the persisted dedupe set is corrupted", () => {
    localStorage.setItem(DEDUPE_KEY, "{not json");
    useWorkspaceStore.setState({ llmEvals: regressing() });
    render(<LLMEvalTrackerClient />);
    expect(
      signals.emit.mock.calls.filter(
        ([s]) => (s as { kind: string }).kind === "llmEval.regressionDetected"
      )
    ).toHaveLength(1);
  });
});

describe("LLM Eval Tracker: live eval run (BYOK)", () => {
  function live() {
    return {
      dataset: screen.getByRole("textbox", { name: "Dataset name" }),
      promptVersion: textbox("Prompt version (optional)")[0],
      prompt: screen.getByRole("textbox", { name: "Prompt to test" }),
      score: scoreInputs()[0],
      log: screen.getByRole("button", { name: "Log score for Anthropic" }),
    };
  }

  it("shows the active model and runs the typed prompt only once there is one", async () => {
    llm.state = READY;
    render(<LLMEvalTrackerClient />);
    expect(screen.getByText("claude-test")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-run-panel")).not.toBeInTheDocument();
    fireEvent.change(live().prompt, { target: { value: "Summarise this" } });
    const panel = await screen.findByTestId("ai-run-panel");
    expect(panel).toHaveTextContent("Summarise this");
    expect(panel).toHaveAttribute("data-tool", "LLM Eval Tracker (live)");
  });

  it("logs the score against the provider's model and keeps the dataset for the next run", () => {
    llm.state = READY;
    render(<LLMEvalTrackerClient />);
    fireEvent.change(live().dataset, { target: { value: " faith " } });
    fireEvent.change(live().promptVersion, { target: { value: " greet@1 " } });
    fireEvent.change(live().score, { target: { value: "0.85" } });
    fireEvent.click(live().log);

    expect(state()).toHaveLength(1);
    expect(state()[0]).toMatchObject({
      model: "claude-test",
      dataset: "faith",
      promptVersion: "greet@1",
      score: 0.85,
    });
    expect(toasts.success).toHaveBeenCalledWith("Logged 85% for claude-test on faith");
    expect(live().score).toHaveValue(null);
    expect(live().dataset).toHaveValue(" faith ");
    expect(signals.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "llmEval.recorded" })
    );
  });

  it("accepts a live score of 0", () => {
    llm.state = READY;
    render(<LLMEvalTrackerClient />);
    fireEvent.change(live().dataset, { target: { value: "faith" } });
    fireEvent.change(live().score, { target: { value: "0" } });
    fireEvent.click(live().log);
    expect(state().map((e) => e.score)).toEqual([0]);
  });

  it("explains why nothing was logged", () => {
    llm.state = READY;
    render(<LLMEvalTrackerClient />);
    fireEvent.change(live().score, { target: { value: "0.5" } });
    fireEvent.click(live().log);
    expect(toasts.error).toHaveBeenLastCalledWith("Set a dataset name first");

    fireEvent.change(live().dataset, { target: { value: "faith" } });
    for (const bad of ["", "2", "-1"]) {
      fireEvent.change(live().score, { target: { value: bad } });
      fireEvent.click(live().log);
      expect(toasts.error).toHaveBeenLastCalledWith("Score must be a number between 0 and 1");
    }
    expect(state()).toHaveLength(0);
  });

  it("refuses to log when the provider has no model selected", () => {
    llm.state = { ...READY, model: null };
    render(<LLMEvalTrackerClient />);
    fireEvent.change(live().dataset, { target: { value: "faith" } });
    fireEvent.change(live().score, { target: { value: "0.5" } });
    fireEvent.click(live().log);
    expect(toasts.error).toHaveBeenLastCalledWith("No active AI provider");
    expect(state()).toHaveLength(0);
  });
});

describe("detectRegressions (pure)", () => {
  const s = (group: string, score: number, d: number) => ({ group, score, recordedAt: day(d) });

  it("needs at least minSamples on both sides", () => {
    expect(detectRegressions([])).toEqual([]);
    expect(
      detectRegressions([s("g", 0.9, 1), s("g", 0.9, 2), s("g", 0.1, 3), s("g", 0.1, 4)])
    ).toEqual([]);
  });

  it("reports a significant drop with means, delta and sample sizes", () => {
    const [f] = detectRegressions([
      s("g", 0.9, 1),
      s("g", 0.91, 2),
      s("g", 0.89, 3),
      s("g", 0.6, 4),
      s("g", 0.61, 5),
      s("g", 0.59, 6),
    ]);
    expect(f.group).toBe("g");
    expect(f.baselineMean).toBeCloseTo(0.9, 10);
    expect(f.recentMean).toBeCloseTo(0.6, 10);
    expect(f.delta).toBeCloseTo(-0.3, 10);
    expect(f.tStat).toBeCloseTo(36.742, 2);
    expect(f.confidence).toBe(0.99);
    expect(f).toMatchObject({ baselineN: 3, recentN: 3 });
  });

  it("orders samples by recordedAt, not input order", () => {
    // Same data as above, shuffled: the three newest are still the low ones.
    const findings = detectRegressions([
      s("g", 0.6, 4),
      s("g", 0.9, 1),
      s("g", 0.59, 6),
      s("g", 0.91, 2),
      s("g", 0.61, 5),
      s("g", 0.89, 3),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].recentMean).toBeCloseTo(0.6, 10);
  });

  it("ignores unchanged groups and noisy drops below the confidence bar", () => {
    const flat = [1, 2, 3, 4, 5, 6].map((d) => s("flat", 0.9, d));
    const noisy = [
      s("noisy", 0.2, 1),
      s("noisy", 0.95, 2),
      s("noisy", 0.6, 3),
      s("noisy", 0.1, 4),
      s("noisy", 0.9, 5),
      s("noisy", 0.5, 6),
    ];
    expect(detectRegressions([...flat, ...noisy])).toEqual([]);
  });

  // welchT used to return t=0 when both windows had exactly zero variance, so
  // 1,1,1 → 0.5,0.5,0.5 was never flagged while 0.9,0.9,0.9 → 0.8,0.8,0.8 was
  // (float noise made its variance non-zero).
  it("flags a drop between two exactly-constant windows (1,1,1 → 0.5,0.5,0.5)", () => {
    const [f, ...rest] = detectRegressions([
      s("g", 1, 1),
      s("g", 1, 2),
      s("g", 1, 3),
      s("g", 0.5, 4),
      s("g", 0.5, 5),
      s("g", 0.5, 6),
    ]);
    expect(rest).toEqual([]);
    expect(f.delta).toBeCloseTo(-0.5, 10);
    expect(f.tStat).toBe(Number.POSITIVE_INFINITY);
    expect(f.confidence).toBe(0.99);
  });

  it("windows by recordedAt even when one timestamp is unparseable", () => {
    const [f] = detectRegressions([
      s("g", 0.9, 4),
      { group: "g", score: 0.9, recordedAt: "not a date" },
      s("g", 0.31, 6),
      s("g", 0.9, 2),
      s("g", 0.3, 7),
      s("g", 0.32, 5),
    ]);
    expect(f.baselineMean).toBeCloseTo(0.9, 10);
    expect(f.recentMean).toBeCloseTo(0.31, 10);
  });

  it("sorts multiple regressions most-negative first", () => {
    const drop = (g: string, from: number, to: number) => [
      s(g, from, 1),
      s(g, from + 0.01, 2),
      s(g, from - 0.01, 3),
      s(g, to, 4),
      s(g, to + 0.01, 5),
      s(g, to - 0.01, 6),
    ];
    const groups = detectRegressions([...drop("small", 0.9, 0.8), ...drop("big", 0.9, 0.4)]).map(
      (f) => f.group
    );
    expect(groups).toEqual(["big", "small"]);
  });

  it("rollingLowerBound needs 4 scores and returns mean − k·std", () => {
    expect(rollingLowerBound([0.9, 0.9, 0.9])).toBeNull();
    expect(rollingLowerBound([0.8, 0.8, 0.8, 0.8])).toBeCloseTo(0.8, 10);
    // mean 0.5, sample std ≈ 0.2582 → 0.5 − 2·0.2582
    expect(rollingLowerBound([0.2, 0.4, 0.6, 0.8])).toBeCloseTo(0.5 - 2 * 0.258199, 5);
  });
});
